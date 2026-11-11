// THE CUSTOM PLAN'S PAGE GATE — the server half.
//
// A custom-plan org paid for the base workspace plus the add-on pages it
// picked (lib/customPlan). The selection lives in SyncState
// `orgPages:<orgId>` and is the source of truth: Stripe's page quantity and
// metadata follow it (lib/customBilling), never the other way round.
//
// THREE DOORS, ONE ANSWER (owner, 2026-10-06 — the audit found the layouts
// were the only door that asked):
//   · the layouts (src/app/dashboard/layout.tsx, src/app/(dashboard)/layout.tsx,
//     src/app/(mobile)/layout.tsx) draw the offer at a blocked URL and hand
//     the list to the nav (getBlockedCustomPages — courtesy, fail-open once);
//   · every page server component of an add-on calls customPageGate
//     (components/v3/upgrade-gate/custom-page-gate) BEFORE it loads anything,
//     so a client-side navigation, which skips the layout, still loads no data;
//   · every server action and API route of an add-on calls requirePage — the
//     boundary. It fails CLOSED: an unreadable plan is a refusal.
// The middleware takes no part: it is edge-runtime and cannot read the DB.
//
// A LAPSED PLAN CLOSES EVERY ADD-ON (owner, 2026-10-07), whatever the plan:
// a cancelled Professional shop no longer opens the roof estimator. The rule
// is lib/planStatus — the one the limits engine and the feature tier read;
// PAST_DUE keeps the pages while Stripe retries the card.
//
// A PLATFORM ADMIN IN THE ORGANIZATION OPENS EVERY PAGE (owner, 2026-10-17),
// whatever the plan and its status — lib/fullAccess hasFullAccess, asked as
// the session's user. With no session (a cron) the organization decides.

//
// THE NEW PLANS (Base + Tools, part 3a — owner, 2026-11-10). A shop whose Subscription.plan is a "tools-" slug
// (lib/toolPlans/shared isToolsSlug) opens exactly what its size and tools hold (toolsPagesOpen over SyncState
// `orgTools:<orgId>`): no paid-feature shortcut, and the ids only the new plans sell (lib/customPlan TOOLS_PAGES) are
// closed unless held. A Classic shop answers those ids through classicEquivalent — the blueprint estimator as Smart
// Proposal, the Meta import as Leads, everything else open as it is today — so nothing changes for it.

import { db } from "@/lib/db";
import {
  CUSTOM_DECK_PAGE,
  PLAN_ENDED_MARK,
  blockedCustomHrefs,
  classicPageId,
  gatedPage,
  isPaidFeature,
  lapsedBlockedHrefs,
  normalizeCustomPages,
  toolsBlockedHrefs,
  type GatedPageId,
} from "@/lib/customPlan";
import { planLapsed } from "@/lib/planStatus";
import { readAccessSubscription } from "@/lib/subscriptionAccess";
import { hasFullAccess } from "@/lib/fullAccess";
import { isToolsSlug, parseToolsRecord, toolsPagesOpen } from "@/lib/toolPlans/shared";

/** The error an add-on's server code throws for an org that did not buy it. */
export class CustomPageLockedError extends Error {
  readonly code = "CUSTOM_PAGE_LOCKED";
  constructor(
    readonly page: GatedPageId,
    /** "ended": the plan lapsed (lib/planStatus), not a page left unbought. */
    readonly reason: "not-included" | "ended" = "not-included",
    /** The shop is on the new plans: the way in is the Subscription page's Upgrade your plan. */
    readonly tools = false,
  ) {
    const label = gatedPage(page)?.label ?? "This page";
    super(
      reason === "ended"
        ? `Your plan has ended, so ${label} is closed. Choose a plan on Subscription to open it again.`
        : tools
          ? `${label} isn't on your plan — add it under Upgrade your plan.`
          : `${label} isn't in your plan.`,
    );
    this.name = "CustomPageLockedError";
  }
}

export function isCustomPageLockedError(err: unknown): err is CustomPageLockedError {
  return err instanceof Error && (err as { code?: string }).code === "CUSTOM_PAGE_LOCKED";
}

/** The org's pages: null when the org is not on the custom plan, else the
 *  pages it holds; `lapsed` when its plan no longer opens anything; `tools`
 *  when it is on the new plans (`pages` is then everything it can open).
 *  Throws when the plan cannot be read — callers that must fail closed
 *  (requirePage) let it propagate. */
type PageAccess = { lapsed: boolean; pages: string[] | null; tools: boolean };

async function readPageAccess(organizationId: string, as?: string | null): Promise<PageAccess> {
  if (await hasFullAccess(organizationId, as)) return { lapsed: false, pages: null, tools: false };
  const sub = await readAccessSubscription(organizationId);
  const tools = isToolsSlug(sub?.plan);
  if (planLapsed(sub)) return { lapsed: true, pages: [], tools };
  if (tools) return { lapsed: false, pages: [...(await readToolsPages(organizationId, sub?.plan ?? null))], tools };
  return { lapsed: false, pages: await readCustomPages(organizationId, sub?.plan ?? null), tools };
}

/** What a new-plan shop can open now (lib/toolPlans/shared toolsPagesOpen) — its record read straight from
 *  SyncState (lib/toolPlans/billing writes it; that module brings Stripe, so it is not imported here). A missing or
 *  unreadable record opens the size alone. */
async function readToolsPages(organizationId: string, plan: string | null): Promise<Set<string>> {
  const row = await db.syncState.findUnique({ where: { key: `orgTools:${organizationId}` }, select: { cursor: true } });
  return toolsPagesOpen(parseToolsRecord(row?.cursor), plan, new Date());
}

/** The organization is on the new plans (Base + Tools): its Subscription.plan is a "tools-" slug. Never throws: an
 *  unreadable plan reads as Classic — the callers ask it only to pick a Classic-safe path. */
export async function isToolsShop(organizationId: string): Promise<boolean> {
  const sub = await readAccessSubscription(organizationId).catch(() => null);
  return isToolsSlug(sub?.plan);
}

/** The organization is on the Custom plan and its bought pages include the Deck estimator — the Deck Studio
 *  add-on bought as a page (lib/editions). `plan` when the caller has read it already. */
export async function customDeckPageHeld(organizationId: string, plan?: string | null): Promise<boolean> {
  if (plan !== undefined && (plan ?? "").toUpperCase() !== "CUSTOM") return false;
  const pages = await readCustomPages(organizationId, plan).catch(() => null);
  return !!pages?.includes(CUSTOM_DECK_PAGE);
}

/** The pages a custom-plan org holds (null when the org is not on it). */
export async function readCustomPages(organizationId: string, knownPlan?: string | null): Promise<string[] | null> {
  const plan =
    knownPlan !== undefined
      ? knownPlan
      : (await db.subscription.findUnique({ where: { organizationId }, select: { plan: true } }))?.plan ?? null;
  if ((plan ?? "").toUpperCase() !== "CUSTOM") return null;
  const row = await db.syncState.findUnique({ where: { key: `orgPages:${organizationId}` } });
  if (!row) return [];
  try {
    return normalizeCustomPages(JSON.parse(row.cursor) as string[]);
  } catch {
    return [];
  }
}

/**
 * The hrefs this org may NOT open, or null when the org is not on the custom
 * plan — null, not [], so callers can tell "unrestricted" from "bought
 * everything" without a second read. For the layouts and the nav.
 *
 * One retry: dev SQLite throws transient "database is locked" under a
 * dashboard's burst of parallel reads. Two misses in a row read as
 * unrestricted HERE — a layout that bricks every org on a flaky DB is worse —
 * because the page gate and requirePage below fail closed behind it.
 */
export async function getBlockedCustomPages(
  organizationId: string | null | undefined,
): Promise<string[] | null> {
  if (!organizationId) return null;
  const access = await readPageAccess(organizationId).catch(() =>
    readPageAccess(organizationId).catch(() => null),
  );
  if (!access) return null;
  // A lapsed new-plan shop is answered as a lapsed Classic one (the plan-ended card), its own pages closed too.
  if (access.lapsed) return [...lapsedBlockedHrefs(access.tools), PLAN_ENDED_MARK];
  if (access.tools && access.pages) return toolsBlockedHrefs(access.pages);
  return access.pages === null ? null : blockedCustomHrefs(access.pages);
}

/** Who is asking (lib/fullAccess hasFullAccess): undefined = the session's user; null = nobody — a public link
 *  opened by an outside person, an inbound text, a cron: the organization's own plan decides, never the
 *  visitor's session. A user id = that member (the AI Operator's linked phone). */
export type GateAs = { as?: string | null };

/** Why `pages` are closed to the org, or null when one of them is open:
 *  "ended" — its plan lapsed; "not-included" — on the custom plan without
 *  them, or on the new plans without them (`tools`). A paid feature (lib/customPlan PAID_FEATURES) is open on
 *  every live Classic plan, a Custom plan too; on the new plans only when held. A new-plan id asked of a Classic
 *  shop is answered as its Classic twin (classicPageId) — and one with no twin is not this gate's to close.
 *  Fails closed: an unreadable plan counts as not included (one retry) — except for an id with no Classic twin. */
type LockState = { reason: "ended" | "not-included" | null; tools: boolean };

async function lockState(
  organizationId: string,
  pages: GatedPageId | readonly GatedPageId[],
  as?: string | null,
): Promise<LockState> {
  const wanted = typeof pages === "string" ? [pages] : pages;
  let access: PageAccess;
  try {
    access = await readPageAccess(organizationId, as).catch(() => readPageAccess(organizationId, as));
  } catch {
    // An id no Classic plan ever closed (team messages, Hire, a workspace…) stays open on an unreadable plan, as it
    // was before the new plans: failing it closed would take it from a Classic shop on a database hiccup.
    if (wanted.some((p) => classicPageId(p) === null)) return { reason: null, tools: false };
    return { reason: "not-included", tools: false };
  }
  if (access.tools) {
    if (access.lapsed) return { reason: "ended", tools: true };
    const held = access.pages;
    return { reason: held === null || wanted.some((p) => held.includes(p)) ? null : "not-included", tools: true };
  }
  // Classic: the new plans' ids by their Classic answer. One with none was never closed by a Classic plan (the Free
  // plan included), so it stays open whatever the plan's status — exactly as before the new plans.
  const classic = wanted.map(classicPageId);
  if (classic.some((p) => p === null)) return { reason: null, tools: false };
  if (access.lapsed) return { reason: "ended", tools: false };
  const owned = access.pages;
  if (owned === null) return { reason: null, tools: false };
  return { reason: classic.some((p) => p !== null && (isPaidFeature(p) || owned.includes(p))) ? null : "not-included", tools: false };
}

async function lockReason(
  organizationId: string,
  pages: GatedPageId | readonly GatedPageId[],
  as?: string | null,
): Promise<"ended" | "not-included" | null> {
  return (await lockState(organizationId, pages, as)).reason;
}

/** Why the org may not open `pages` and whether it is on the new plans — for a refusal worded per plan (the AI
 *  Operator's). `reason` null = open. Fails closed, as isPageLocked. */
export async function pageLock(
  organizationId: string,
  pages: GatedPageId | readonly GatedPageId[],
  opts: GateAs = {},
): Promise<LockState> {
  return lockState(organizationId, pages, opts.as);
}

/** True when the org's plan has lapsed, or it is on the custom plan and holds
 *  NONE of `pages`, or on the new plans without them. Fails closed: an
 *  unreadable plan counts as locked. */
export async function isPageLocked(
  organizationId: string,
  pages: GatedPageId | readonly GatedPageId[],
  opts: GateAs = {},
): Promise<boolean> {
  return (await lockReason(organizationId, pages, opts.as)) !== null;
}

/**
 * THE SERVER BOUNDARY. Throws CustomPageLockedError when the org is on the
 * custom plan and holds none of `pages` (an array is "any of" — the HVAC
 * estimator reads the fence's lot lookup, the video estimator runs Smart
 * Proposal's engine), or when its plan lapsed (the Free plan). Every server action and API route of an
 * add-on or a paid feature calls this right after it resolves the org.
 */
export async function requirePage(
  organizationId: string,
  pages: GatedPageId | readonly GatedPageId[],
  opts: GateAs = {},
): Promise<void> {
  const { reason, tools } = await lockState(organizationId, pages, opts.as);
  if (reason) throw new CustomPageLockedError(typeof pages === "string" ? pages : pages[0], reason, tools);
}

/** For API routes: the 403 a locked add-on answers with, or null to go on. */
export async function pageLockedResponse(
  organizationId: string,
  pages: GatedPageId | readonly GatedPageId[],
  opts: GateAs = {},
): Promise<Response | null> {
  const { reason, tools } = await lockState(organizationId, pages, opts.as);
  if (!reason) return null;
  const err = new CustomPageLockedError(typeof pages === "string" ? pages : pages[0], reason, tools);
  return Response.json({ ok: false, error: err.message, code: err.code }, { status: 403 });
}

/** For a server action that answers with a result: the refusal a person reads, or null to go on. */
export async function pageLockedResult(
  organizationId: string,
  pages: GatedPageId | readonly GatedPageId[],
  opts: GateAs = {},
): Promise<{ ok: false; error: string; code: "CUSTOM_PAGE_LOCKED" } | null> {
  const { reason, tools } = await lockState(organizationId, pages, opts.as);
  if (!reason) return null;
  const err = new CustomPageLockedError(typeof pages === "string" ? pages : pages[0], reason, tools);
  return { ok: false, error: err.message, code: err.code };
}

/** A PUBLIC LINK an outside person opens (/buy/<token>, /w/<token>, a sub's page, the lender's page, a booking
 *  pick): paused while the organization that owns it is on the Free plan. Asked as nobody — the visitor's own
 *  session (a platform admin testing the link) never opens it. The page then says "This link is paused" and
 *  shows nothing of the owner's (components/v3/upgrade-gate/link-paused). */
export async function linkPaused(organizationId: string, feature: GatedPageId | readonly GatedPageId[]): Promise<boolean> {
  return isPageLocked(organizationId, feature, { as: null });
}

/** A server action's guard and the feature's gate in one step: the role guard's context back, after
 *  requirePage — `const { organizationId } = await withFeature(requireManager(), "smartbook")`. */
export async function withFeature<T extends { organizationId: string }>(
  ctx: T | Promise<T>,
  feature: GatedPageId | readonly GatedPageId[],
): Promise<T> {
  const c = await ctx;
  await requirePage(c.organizationId, feature);
  return c;
}

/** For a sweep across every company (a cron): the organizations whose plan has lapsed — the Free plan among them —
 *  so their rows are left alone (no model read, no reminder, nothing sent). The subscription rows are read once;
 *  each lapsed-looking one is confirmed through the same answer the gate gives (a grant's own terms included). */
export async function lapsedOrgIds(): Promise<string[]> {
  const rows = await db.subscription.findMany({ select: { organizationId: true, status: true, currentPeriodEnd: true, trialEndsAt: true } });
  const maybe = rows.filter((r) => planLapsed(r)).map((r) => r.organizationId);
  const out: string[] = [];
  for (const org of maybe) {
    if ((await lockReason(org, "operator", null).catch(() => "ended" as const)) === "ended") out.push(org);
  }
  return out;
}
