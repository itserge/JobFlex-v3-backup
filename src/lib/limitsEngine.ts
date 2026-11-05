// ─────────────────────────────────────────────────────────────────────────
// Limits Engine — per-plan NUMERIC quota enforcement.
//
// Distinct from src/lib/entitlements.ts, which handles boolean FEATURE gating
// (does this plan unlock AI proposals?). This engine answers "how many?" and is
// SERVER-ONLY (imports Prisma) — never import it from a client component. For
// shared key/scope definitions a client can read, import src/lib/planLimits.ts.
//
// Usage (wired into user-facing actions in a later step):
//   await enforcePlanLimit(organizationId, "proposalsCreated");
//   // …throws Error("Plan limit reached") when the org is at/over its cap.
//
// Resolution order for an org:
//   1. Load Subscription → `plan` + `status` + `currentPeriodEnd` + `trialEndsAt`.
//   2. Lapsed check: PAST_DUE/CANCELED/EXPIRED — or ACTIVE past periodEnd +
//      3-day grace, or TRIALING past trialEndsAt — resolves to the "free"
//      catalog plan (DEFAULT_FREE_LIMITS if no such row) instead of the paid one.
//   3. Load the matching PricingPlan and parse its limitsJson.
//   4. Unlimited (absent/null/-1) → allow immediately, no count query.
//   5. Otherwise count usage (windowed for "monthly", lifetime for "absolute")
//      and compare.
//
// Intentional ALLOW-BUT-COUNT paths (client/public-triggered creation is never
// blocked; the rows still count toward usage so the org hits its cap on its
// own actions). Keep this list current — it is the audit point:
//   - public quote accept → src/lib/jobFromProposal.ts (Job + JobEvent)
//   - public homeowner form → src/actions/homeowner.ts + api/homeowner-request (Lead)
//   - AI-call lead capture → createLeadFromCall (Lead)
//   - auto job-completion review ask → src/lib/reviewRequestInternal.ts
//   - auto job-crew thread → src/lib/jobConversation.ts (JOB kind, excluded
//     from the conversationsStarted counter entirely)
// Exception by product decision: over-limit inbound AI phone calls ARE blocked
// (polite unavailable TwiML in api/twilio/voice).
//
// THERE ARE NO COUNTERS. Usage is never stored: every check COUNTS the rows
// themselves (proposals, estimates, calls …) created since the start of the
// current cycle. A "reset" therefore cannot zero a number — it moves the
// point the count starts from. The admin's reset (lib/usageReset) writes a
// SyncState mark `usageResetAt:<orgId>:<key>` and the count for that key
// begins at the mark instead of at the cycle start. The mark holds only
// while it lies inside the current cycle (see usageResetInForce), so it
// burns by itself when the next cycle begins; nothing is deleted.
//
// PLATFORM ADMINS IN THEIR ORGANIZATION (owner, 2026-09-22; any seat since
// 2026-10-17). When the current user carries isPlatformAdmin and holds a seat
// in the organization being checked, the plan's caps do not apply: every key
// resolves unlimited, enforcePlanLimit passes, and the sidebar and the plans
// page say "Unlimited · platform admin" instead of counting. The rule is
// lib/fullAccess hasFullAccess — the one every access check asks — and the
// engine reads the session itself (no caller passes a user), so no action
// needs a check of its own. Where there is no session — a cron, an inbound
// phone call, a public form — there is no current user and the caps apply.
// Money is untouched: paid providers (EagleView, ReportAll …) keep their own
// budgets and ledgers; this is the plan's caps only.
// ─────────────────────────────────────────────────────────────────────────
import { planLapsed } from "@/lib/planStatus";
import { readAccessSubscription } from "@/lib/subscriptionAccess";
import { db } from "@/lib/db";
import { hasFullAccess } from "@/lib/fullAccess";
import {
  parsePlanLimits,
  withPaidCallDefaults,
  isUnlimited,
  DEFAULT_FREE_LIMITS,
  LIMIT_DEFS,
  PLAN_LIMIT_MESSAGE,
  type LimitKey,
  type LimitScope,
  type PlanLimits,
} from "@/lib/planLimits";
import { CUSTOM_PLAN_LIMITS_SLUG, CUSTOM_PLAN_SLUG } from "@/lib/customPlan";

/** lib/eagleview PD_PACK.ROOF_AREA — spelled here so the engine does not load the EagleView client. */
const ROOF_AREA_PACK = "property_data_id_001";

export type LimitResource = LimitKey;

/** Roles that hold full manager access (everything requireManager admits
 *  except OWNER). The "managers" seat meter counts all of them. */
export const MANAGER_EQUIVALENT_ROLES = ["MANAGER", "ADMIN", "ACCOUNTANT", "USER"] as const;
export function isManagerEquivalentRole(role: string | null | undefined): boolean {
  return (MANAGER_EQUIVALENT_ROLES as readonly string[]).includes(role ?? "");
}

export interface LimitStatus {
  resource: LimitResource;
  /** ISO time of the admin's usage reset the count starts from, when one is
   *  in force this cycle (monthly keys only). Absent otherwise. */
  resetAt?: string;
  /** Set when the caps do not apply to the current user here: a platform
   *  admin in an organization they own. Every such status is unlimited. */
  exempt?: true;
  /** The configured cap, or null when unlimited. */
  limit: number | null;
  /** Current usage within the relevant window. 0 when unlimited (count skipped). */
  used: number;
  /**
   * Effective remaining. Normally limit - used (floored at 0), but for a
   * "capped by" resource (see CAPPED_BY) it can be lowered by the capping
   * resource's remaining. null when unlimited.
   */
  remaining: number | null;
  /** False when the next create(s) would exceed this OR its capping resource. */
  allowed: boolean;
  /**
   * Set when another resource's remaining is the tighter constraint on this
   * one (e.g. estimatorUses limited by proposalsCreated because every estimate
   * becomes a proposal). Drives the "tied to proposals" upsell copy and the
   * blocking-resource attribution.
   */
  cappedBy?: LimitResource;
}

const SCOPE_BY_KEY = new Map<LimitKey, LimitScope>(LIMIT_DEFS.map((d) => [d.key, d.scope]));

/** Start of the calendar month containing `d` (local time). */
function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/** Day-clamped date for (year, month) — month over/underflow normalizes. */
function atAnchorDay(year: number, month: number, day: number): Date {
  const base = new Date(year, month, 1); // normalizes month rollover (e.g. -1 → prev Dec)
  const y = base.getFullYear();
  const m = base.getMonth();
  const lastDay = new Date(y, m + 1, 0).getDate();
  return new Date(y, m, Math.min(day, lastDay));
}

/**
 * Start of the monthly usage window containing `now`, anchored to the billing
 * day-of-month from `anchor` (the subscription's period end). Returns the most
 * recent anchor-day boundary on or before `now`, so it is always day-safe and
 * never in the future — correct for monthly, annual, and lapsed subscriptions
 * alike. Falls back to the calendar month when there is no anchor (e.g. FREE).
 */
function monthlyCycleStart(anchor: Date | null, now: Date): Date {
  if (!anchor) return startOfMonth(now);
  const day = anchor.getDate();
  const thisMonth = atAnchorDay(now.getFullYear(), now.getMonth(), day);
  if (thisMonth.getTime() > now.getTime()) {
    return atAnchorDay(now.getFullYear(), now.getMonth() - 1, day);
  }
  return thisMonth;
}

/* ── The admin's usage reset marks ────────────────────────────────────────
   One SyncState row per (organization, key): `usageResetAt:<orgId>:<key>`,
   JSON. Written by lib/usageReset with an author and a reason; read here on
   every plan resolution. */

export const usageResetKey = (organizationId: string, key: LimitKey) => `usageResetAt:${organizationId}:${key}`;
export const usageResetPrefix = (organizationId: string) => `usageResetAt:${organizationId}:`;

export interface UsageResetMark {
  /** When the reset was made — the count for the key starts here. */
  at: string;
  /** The cycle start the engine saw at the time, for the record. */
  cycleStart: string;
  actorId: string;
  actorEmail: string;
  reason: string;
  /** What the meter read just before the reset. */
  before: { used: number; limit: number | null };
}

export type UsageResetMarks = Partial<Record<LimitKey, UsageResetMark>>;

/** Every mark on the organization, in force or not. */
export async function readUsageResetMarks(organizationId: string): Promise<UsageResetMarks> {
  const rows = await db.syncState.findMany({ where: { key: { startsWith: usageResetPrefix(organizationId) } } }).catch(() => []);
  const out: UsageResetMarks = {};
  const known = new Set<string>(LIMIT_DEFS.map((d) => d.key));
  for (const r of rows) {
    const key = r.key.slice(usageResetPrefix(organizationId).length);
    if (!known.has(key)) continue;
    try {
      out[key as LimitKey] = JSON.parse(r.cursor) as UsageResetMark;
    } catch {
      /* an unreadable mark is no mark */
    }
  }
  return out;
}

/**
 * A mark counts only while it lies inside the current cycle: `at` on or after
 * the cycle start. At the next cycle the cycle start moves past it and the
 * count begins at the cycle start again, as if the mark were gone. The mark
 * is keyed by TIME, not by plan, so a plan change in the same cycle keeps it
 * (the change moves the cap, not the past); if the change moves the billing
 * anchor so far that the new cycle start passes the mark, the mark is over —
 * and the rows before that start would not have counted anyway.
 */
export function usageResetInForce(mark: UsageResetMark | undefined, cycleStart: Date): Date | null {
  if (!mark) return null;
  const at = new Date(mark.at);
  if (Number.isNaN(at.getTime())) return null;
  return at.getTime() >= cycleStart.getTime() ? at : null;
}

/* ── Who is asking ────────────────────────────────────────────────────────
   The engine resolves the current user on its own, from the session, so the
   platform-admin rule needs no caller to pass one. `actorId` is for contexts
   that know better than the session: the QA harness (an explicit user), or a
   caller that must count as nobody (`null`). Undefined = read the session. */

export interface LimitActor {
  actorId?: string | null;
}

/**
 * A lapsed subscription is enforced at FREE limits — this is what closes the
 * "cancel/stop paying, keep the paid quotas" hole. The rule is lib/planStatus,
 * shared with the feature tier and the page gate: PAST_DUE keeps the plan
 * while Stripe retries (owner, 2026-10-07); CANCELED, UNPAID, EXPIRED and
 * TRIAL_ENDED lapse at once.
 */
const isLapsed = planLapsed;

/**
 * Resolve the org's effective limits + the start of the current monthly window.
 * The window is anchored to the subscription's billing day but always contains
 * `now` (see monthlyCycleStart). With no subscription / no period end (e.g.
 * FREE), it falls back to the calendar month. Lapsed subscriptions resolve to
 * the "free" catalog plan (see isLapsed).
 */
async function resolvePlan(
  organizationId: string,
  actor?: LimitActor,
): Promise<{ limits: PlanLimits; cycleStart: Date; resets: UsageResetMarks; exempt: boolean }> {
  const [sub, resets, exempt] = await Promise.all([
    readAccessSubscription(organizationId),
    readUsageResetMarks(organizationId),
    hasFullAccess(organizationId, actor && "actorId" in actor ? (actor.actorId ?? null) : undefined),
  ]);

  const now = new Date();
  const cycleStart = monthlyCycleStart(
    sub?.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : null,
    now,
  );

  const lapsed = isLapsed(sub, now);
  // The custom plan has no catalog row of its own: it is metered by
  // Professional's limits (lib/customPlan CUSTOM_PLAN_LIMITS_SLUG).
  const storedKey = (sub?.plan ?? "FREE").toLowerCase();
  const planKey = lapsed ? "free" : storedKey === CUSTOM_PLAN_SLUG ? CUSTOM_PLAN_LIMITS_SLUG : storedKey;
  // Subscription.plan casing (e.g. "PROFESSIONAL") may differ from the
  // admin-entered PricingPlan.slug, and SQLite has no case-insensitive `mode`.
  // There are few plans, so match case-insensitively in JS to avoid a
  // mixed-case slug (e.g. "Professional") silently failing open to unlimited.
  const plans = await db.pricingPlan.findMany({ select: { slug: true, limitsJson: true } });
  const plan = plans.find((p) => p.slug.toLowerCase() === planKey) ?? null;

  // A lapsed org with no "free" catalog row must not fail open to unlimited.
  // A platform admin in their organization: no caps, whatever the plan (lib/fullAccess).
  if (exempt) return { limits: {}, cycleStart, resets, exempt };
  if (lapsed && !plan) return { limits: { ...DEFAULT_FREE_LIMITS }, cycleStart, resets, exempt };

  // The paid lookups never fall open on a row that predates them (planLimits PAID_CALL_DEFAULTS).
  return { limits: withPaidCallDefaults(parsePlanLimits(plan?.limitsJson ?? null), planKey), cycleStart, resets, exempt };
}

type ResolvedPlan = Awaited<ReturnType<typeof resolvePlan>>;

/** The organization's current cycle start, for surfaces that show the marks. */
export async function getOrgCycleStart(organizationId: string): Promise<Date> {
  return (await resolvePlan(organizationId, { actorId: null })).cycleStart;
}

/** Count current usage for a resource. `cycleStart` is ignored for absolute scopes. */
async function countUsage(
  resource: LimitResource,
  organizationId: string,
  cycleStart: Date,
  strict = false,
): Promise<number> {
  const since = { gte: cycleStart };
  switch (resource) {
    case "proposalsCreated":
      return db.proposal.count({ where: { organizationId, createdAt: since } });
    case "proposalsAccepted":
      // Count by the real acceptance timestamp so usage lands in the cycle it
      // actually happened (not whenever the row was last touched). Accepted
      // OR paid both imply acceptance.
      return db.proposal.count({
        where: { organizationId, OR: [{ acceptedAt: since }, { paidAt: since }] },
      });
    case "proposalsCompleted":
      // "Completed" === paid in this schema; count by the real paid timestamp.
      return db.proposal.count({
        where: { organizationId, paidAt: since },
      });
    case "calendarCards":
      return db.appointment.count({ where: { organizationId, startsAt: since } });
    case "calendarEvents":
      // JobEvent has no createdAt; window by the event's scheduled start.
      return db.jobEvent.count({ where: { organizationId, startsAt: since } });
    case "projects":
      return db.project.count({ where: { organizationId, createdAt: since } });
    case "jobs":
      return db.job.count({ where: { organizationId, createdAt: since } });
    case "workers":
      // Absolute — total seats regardless of cycle. A DECLINED invite frees its
      // seat, so it must not count against the plan limit.
      return db.workerProfile.count({
        where: { organizationId, inviteStatus: { not: "DECLINED" } },
      });
    case "clients":
      // Absolute — live client records; soft-deleted rows freed their slot.
      return db.client.count({ where: { organizationId, deletedAt: null } });
    case "estimatorUses":
      return db.aiEstimate.count({ where: { organizationId, createdAt: since } });
    case "hvacEstimates":
      // Saved HVAC estimates: a re-save updates its row, so only new ones count.
      // A database without the HVAC tables yet counts none (the estimator
      // answers its defaults there too) instead of failing every check.
      return strict
        ? db.hvacEstimate.count({ where: { organizationId, createdAt: since } })
        : db.hvacEstimate.count({ where: { organizationId, createdAt: since } }).catch(() => 0);
    case "roofMeasurements":
      // Paid EagleView measurements: an order that bought the roof-area pack
      // (one per measurement — the detail packs of the same click are rows of
      // their own) or a pre-2026-09-08 seven-pack order (packs null). A failed
      // order delivered nothing and is not counted.
      return db.instantOrder.count({
        where: {
          organizationId,
          createdAt: since,
          status: { not: "failed" },
          OR: [{ packs: null }, { packs: { contains: ROOF_AREA_PACK } }],
        },
      });
    case "manualJReports": {
      // Cool Calc reports requested this cycle: the estimate's permitJson
      // carries requestedAt (actions/hvacEstimator). updatedAt ≥ requestedAt,
      // so it narrows the read; requestedAt decides.
      const read = db.hvacEstimate.findMany({
        where: { organizationId, permitJson: { not: null }, updatedAt: since },
        select: { permitJson: true },
      });
      const rows = strict ? await read : await read.catch(() => []);
      return rows.filter((r) => {
        try {
          const at = Date.parse(String((JSON.parse(r.permitJson as string) as { requestedAt?: string }).requestedAt ?? ""));
          return Number.isFinite(at) && at >= cycleStart.getTime();
        } catch {
          return false;
        }
      }).length;
    }
    case "conversationsStarted":
      // JOB-kind threads are auto-created from a job's crew (ensureJobConversation)
      // and must not burn quota; only user-started threads count.
      return db.conversation.count({
        where: { organizationId, createdAt: since, kind: { not: "JOB" } },
      });
    case "messagesSent":
      // Message carries no organizationId; scope through its conversation.
      return db.message.count({
        where: { createdAt: since, conversation: { organizationId } },
      });
    case "leads":
      return db.lead.count({ where: { organizationId, createdAt: since } });
    case "aiPhoneCalls":
      return db.aiPhoneCall.count({ where: { organizationId, startedAt: since } });
    case "deskMinutes": {
      // The desk's own month row (calendar month), not the cycle — lib/aiDesk/usage.
      if (strict) {
        const { monthKey, parseDeskUse, EMPTY_USE, minutesOf } = await import("@/lib/aiDesk/shared");
        const row = await db.syncState.findUnique({ where: { key: `deskuse:${organizationId}:${monthKey(new Date())}` }, select: { cursor: true } });
        // A missing row means no use; a failed read is unavailable, never zero.
        if (row) JSON.parse(row.cursor);
        const use = row ? parseDeskUse(row.cursor) : EMPTY_USE;
        return minutesOf(use.callSeconds + use.testSeconds);
      }
      const { readDeskUse } = await import("@/lib/aiDesk/usage");
      const { minutesOf } = await import("@/lib/aiDesk/shared");
      const use = await readDeskUse(organizationId);
      return minutesOf(use.callSeconds + use.testSeconds);
    }
    case "reviewRequests":
      return db.reviewRequest.count({ where: { organizationId, createdAt: since } });
    case "managers": {
      // Absolute — manager-equivalent seats held plus such invites still in
      // flight (a pending invite reserves its seat, same rule as teamSeats).
      // Counts every role requireManager admits except OWNER — ADMIN /
      // ACCOUNTANT / USER carry full manager access, so metering only the
      // literal "MANAGER" string let an org sidestep the seat cap by picking
      // a synonym.
      const [managers, pendingMgr] = await Promise.all([
        db.membership.count({
          where: { organizationId, role: { in: [...MANAGER_EQUIVALENT_ROLES] } },
        }),
        db.invite.count({
          where: {
            organizationId,
            acceptedAt: null,
            expiresAt: { gt: new Date() },
            role: { in: [...MANAGER_EQUIVALENT_ROLES] },
          },
        }),
      ]);
      return managers + pendingMgr;
    }
    case "teamSeats": {
      // Absolute — office seats: non-INSTALLER members plus live pending
      // invites (a pending invite reserves its seat so acceptInvite never gets
      // stranded by a limit lowered after the invite went out). INSTALLER
      // seats are metered separately by "workers" (WorkerProfile).
      // The OWNER is not a seat (owner's rule, 2026-09-04): a fresh account
      // read "Office team seats 1 / 1" before anyone was invited, because the
      // founder's own membership was counted against the plan's seat cap.
      const [members, pending] = await Promise.all([
        db.membership.count({ where: { organizationId, role: { notIn: ["INSTALLER", "OWNER"] } } }),
        db.invite.count({
          where: {
            organizationId,
            acceptedAt: null,
            expiresAt: { gt: new Date() },
            role: { not: "INSTALLER" },
          },
        }),
      ]);
      return members + pending;
    }
    case "assistantCommands":
      // Requests the Assistant's model read this cycle (lib/assistant/engine). A YES,
      // a NO or a reply digit is answered without the model and is not a command.
      // A database without the table yet counts none instead of failing every check.
      return strict
        ? db.assistantMessage.count({ where: { organizationId, countsAsCommand: true, createdAt: since } })
        : db.assistantMessage.count({ where: { organizationId, countsAsCommand: true, createdAt: since } }).catch(() => 0);
    default: {
      // Exhaustiveness guard: a new LimitKey without a counter is a bug.
      const _never: never = resource;
      throw new Error(`No usage counter for limit "${String(_never)}"`);
    }
  }
}

// Cross-resource caps. A key here has its effective remaining bounded by the
// remaining of its capping resource, because consuming one consumes the other
// downstream. AI / roof / fence estimates (all metered as "estimatorUses") each
// get converted into a proposal, so an org can never have more estimate
// headroom than proposal headroom — even with estimate quota untouched. The
// bound is one-directional: burning proposals shrinks estimate headroom, but
// running an estimate does NOT consume a proposal until it's converted.
const CAPPED_BY: Partial<Record<LimitResource, LimitResource>> = {
  estimatorUses: "proposalsCreated",
};

/** Own status for one resource (before any cross-resource cap is applied). */
async function rawStatusFor(
  plan: ResolvedPlan,
  organizationId: string,
  resource: LimitResource,
  needed = 1,
): Promise<LimitStatus> {
  const { limits, cycleStart, resets } = plan;
  const cap = limits[resource];
  const scope = SCOPE_BY_KEY.get(resource);
  // A reset moves the start of the count. Seats (absolute keys) are live
  // counts and are never reset.
  const resetAt = scope === "absolute" ? null : usageResetInForce(resets[resource], cycleStart);
  const marked = { ...(resetAt ? { resetAt: resetAt.toISOString() } : {}), ...(plan.exempt ? { exempt: true as const } : {}) };

  if (isUnlimited(cap)) {
    return { resource, limit: null, used: 0, remaining: null, allowed: true, ...marked };
  }

  const limit = cap as number;
  const used = await countUsage(
    resource,
    organizationId,
    scope === "absolute" ? new Date(0) : (resetAt ?? cycleStart),
  );

  return {
    resource,
    limit,
    used,
    remaining: Math.max(0, limit - used),
    allowed: used + needed <= limit,
    ...marked,
  };
}

/** Fold a capping resource's headroom into a resource's own status. */
function applyCap(own: LimitStatus, cap: LimitStatus, needed: number): LimitStatus {
  // An unlimited capping resource never constrains.
  if (cap.remaining === null) return own;
  const ownRemaining = own.remaining === null ? Infinity : own.remaining;
  const effRemaining = Math.min(ownRemaining, cap.remaining);
  return {
    ...own,
    remaining: effRemaining === Infinity ? null : effRemaining,
    // Blocked if EITHER resource lacks headroom for `needed`.
    allowed: own.allowed && cap.remaining >= needed,
    // Annotate only when the cap is the strictly tighter constraint, so the UI
    // and blocking attribution point at the resource actually running out.
    cappedBy: cap.remaining < ownRemaining ? cap.resource : own.cappedBy,
  };
}

/** Status for one resource, with any cross-resource cap (CAPPED_BY) applied. */
async function statusFor(
  plan: ResolvedPlan,
  organizationId: string,
  resource: LimitResource,
  needed = 1,
): Promise<LimitStatus> {
  const own = await rawStatusFor(plan, organizationId, resource, needed);
  const capKey = CAPPED_BY[resource];
  if (!capKey) return own;
  // The capping resource is never itself capped, so this doesn't recurse.
  const cap = await rawStatusFor(plan, organizationId, capKey, needed);
  return applyCap(own, cap, needed);
}

/**
 * Non-throwing check. Returns the org's current status for a single resource.
 * Skips the count query entirely when the resource is unlimited. `needed` is
 * the headroom required (bulk creates like CSV imports pass their row count).
 */
// 2026-08-14 the engine was switched off app-wide (no upsells during testing).
// 2026-09-02 (owner's call): back ON — the caps set in /admin/plans are meant
// to hold, and the sidebar draws what is left of each. Flip to true to mute
// every cap except "managers" again without touching the engine below.
const LIMITS_DISABLED = false;

export async function checkPlanLimit(
  organizationId: string,
  resource: LimitResource,
  needed = 1,
  actor?: LimitActor,
): Promise<LimitStatus> {
  // "managers" is carved out of the app-wide quota switch-off: it is plan
  // COMPOSITION (which plans sell manager seats at all), not a usage upsell,
  // and it only bites when /admin/plans sets a number for the plan.
  if (LIMITS_DISABLED && resource !== "managers") {
    return { resource, limit: null, used: 0, remaining: null, allowed: true };
  }
  const plan = await resolvePlan(organizationId, actor);
  return statusFor(plan, organizationId, resource, needed);
}

/**
 * Throwing enforcement. Call before creating a limited resource.
 * Throws Error("Plan limit reached") when the org is at/over its cap; otherwise
 * returns the LimitStatus so callers can surface remaining quota if useful.
 * `needed` = how many the caller is about to create (default 1).
 */
export async function enforcePlanLimit(
  organizationId: string,
  resource: LimitResource,
  needed = 1,
  actor?: LimitActor,
): Promise<LimitStatus> {
  const status = await checkPlanLimit(organizationId, resource, needed, actor);
  if (!status.allowed) {
    // Stable message so the client can detect this and raise the upgrade dialog.
    const err = new Error(PLAN_LIMIT_MESSAGE) as Error & {
      code?: string;
      resource?: string;
      limit?: number | null;
      used?: number;
    };
    err.code = "PLAN_LIMIT_REACHED";
    // Attribute the block to whatever actually ran out: the capping resource
    // (e.g. proposals) when it's the tighter constraint, else this resource.
    err.resource = status.cappedBy ?? resource;
    err.limit = status.limit;
    err.used = status.used;
    throw err;
  }
  return status;
}

/**
 * Convenience: full usage snapshot across every limit for an org. Resolves the
 * plan ONCE and runs one COUNT per *limited* key (unlimited keys cost zero
 * queries), so it is cheap enough for per-render use (sidebar counters).
 */
export async function getOrgLimitUsage(organizationId: string, actor?: LimitActor): Promise<LimitStatus[]> {
  if (LIMITS_DISABLED) {
    return LIMIT_DEFS.map((d) => ({
      resource: d.key,
      limit: null,
      used: 0,
      remaining: null,
      allowed: true,
    }));
  }
  const plan = await resolvePlan(organizationId, actor);
  return Promise.all(LIMIT_DEFS.map((d) => statusFor(plan, organizationId, d.key)));
}

/**
 * The snapshot plus whether the caps apply to the asker at all — for the
 * surfaces that say "Unlimited · platform admin" rather than count.
 */
export type UsageSnapshot = Omit<LimitStatus, "used"> & { used: number | null };

export function getOrgLimitOverview(
  organizationId: string,
  actor?: LimitActor,
): Promise<{ exempt: boolean; usage: LimitStatus[] }>;
export function getOrgLimitOverview(
  organizationId: string,
  actor: LimitActor | undefined,
  options: { includeUnlimitedUsage: true },
): Promise<{ exempt: boolean; usage: UsageSnapshot[] }>;
export async function getOrgLimitOverview(
  organizationId: string,
  actor?: LimitActor,
  options?: { includeUnlimitedUsage: true },
): Promise<{ exempt: boolean; usage: UsageSnapshot[] }> {
  if (options?.includeUnlimitedUsage) {
    // Billing-only read: count every resource with the very same counters,
    // windows and reset marks enforcement uses. Sidebar/enforcement callers
    // keep their cheap unlimited fast path. A failed count stays unknown.
    const plan = await resolvePlan(organizationId, actor);
    const own = await Promise.all(LIMIT_DEFS.map(async (def): Promise<UsageSnapshot> => {
      const resetAt = def.scope === "absolute" ? null : usageResetInForce(plan.resets[def.key], plan.cycleStart);
      const configured = LIMITS_DISABLED ? undefined : plan.limits[def.key];
      const limit = isUnlimited(configured) ? null : configured as number;
      const used = await countUsage(def.key, organizationId, resetAt ?? plan.cycleStart, true).catch(() => null);
      return {
        resource: def.key,
        limit,
        used,
        remaining: limit === null || used === null ? null : Math.max(0, limit - used),
        allowed: used === null || limit === null || used < limit,
        ...(resetAt ? { resetAt: resetAt.toISOString() } : {}),
        ...(plan.exempt ? { exempt: true as const } : {}),
      };
    }));
    const usage = own.map((entry) => {
      const cap = own.find((item) => item.resource === CAPPED_BY[entry.resource]);
      if (entry.used === null || !cap || cap.used === null) return entry;
      return applyCap(entry as LimitStatus, cap as LimitStatus, 1);
    });
    return { exempt: plan.exempt, usage };
  }
  const usage = await getOrgLimitUsage(organizationId, actor);
  return { exempt: usage.some((u) => u.exempt === true), usage };
}
