// THE COMPLIMENTARY PLAN (a "grant") AND THE SYNCING MARK — the two records
// behind the admin's subscription editor (actions/adminSubscription).
//
// AN ORGANIZATION HAS ONE SUBSCRIPTION OF RECORD. Subscription.organizationId
// is @unique, so the database cannot hold two rows — the two-subscription
// failure of 2026-09-22 was one row here and one subscription THERE, on
// Stripe: the old sheet stamped the row MANUAL and let go of the Stripe
// subscription without touching it, and Stripe billed the trial at its end
// while the product read the row as a comp. The rule this module keeps is
// therefore about the pair, not the row:
//
//   · provider STRIPE  — the row mirrors exactly one live Stripe subscription
//                        (externalSubId), and Stripe is the truth for it;
//   · provider MANUAL  — the row is the operator's own grant: it names NO
//                        Stripe subscription, and no live Stripe subscription
//                        may exist for the organization (the editor cancels
//                        it first; the check below refuses when it cannot).
//
// WHERE THE GRANT LIVES. No schema change: production stopped pushing the
// schema (2451309), so a new column would break every subscription read until
// the owner pushed it by hand. The grant's terms — end date, what comes after,
// reason, author, the paid subscription it replaced — are a SyncState row
// (`planGrant:<orgId>`, JSON), the same store the mirror reference and the
// custom plan's pages use. The Subscription row itself carries what the
// product reads: plan, status ACTIVE, provider MANUAL, and the grant's end
// date on currentPeriodEnd, so the limits engine lapses the org to FREE caps
// on its own even if the cron that ends the grant never ran.
//
// THE SYNCING MARK (`subSyncing:<orgId>`) is set when the editor changed a
// Stripe subscription and the mirror was written from Stripe's reply; it is
// cleared when Stripe itself reports the subscription back in that state —
// through the webhook, the reconcile cron, or the editor's own "Verify"
// read. While it stands, the editor refuses a second change.

import { planLine } from "@/lib/deckAddon";
import type Stripe from "stripe";
import { db } from "@/lib/db";
import { ActivityKind, SubscriptionStatus } from "@/lib/prismaEnums";
import { getStripe, isStripeEnabled } from "@/lib/sdk/stripe";
import { mirrorStatusFor } from "@/lib/stripeStatus";
import { sendEmail } from "@/lib/sdk/resend";
import { renderEmail } from "@/lib/email/renderEmail";
import { buildComplimentaryEnding } from "@/lib/email/build/planGrant";
import { appBaseUrl } from "@/lib/appUrl";
import { getPlanDisplayName } from "@/lib/planCatalogServer";

export const planGrantKey = (organizationId: string) => `planGrant:${organizationId}`;
export const subSyncingKey = (organizationId: string) => `subSyncing:${organizationId}`;

/** What comes after a grant ends. Both are non-paying and honest: a paid
 *  plan without a Stripe subscription would be another open-ended comp. */
export type GrantFallback = "free" | "expired";

export interface PlanGrant {
  /** Uppercase catalog slug, the way Subscription.plan stores it. */
  plan: string;
  grantedAt: string;
  /** ISO end; null only when the operator chose "no end date" explicitly. */
  endsAt: string | null;
  fallback: GrantFallback;
  reason: string;
  actorId: string;
  actorEmail: string;
  /** The Stripe subscription the grant replaced, and what was done to it. */
  replaced: {
    subId: string;
    status: string;
    action: "canceled_now" | "cancel_at_period_end" | "left_alone";
    /** When that subscription stops (its period end), if it was left to run out. */
    endsAt: string | null;
  } | null;
  /** The 7-day notice, once. */
  noticeSentAt: string | null;
}

export interface SyncingMark {
  since: string;
  subId: string;
  priceId: string | null;
  /** Mirror status expected back from Stripe (ACTIVE / TRIALING …). */
  status: string;
  by: string;
  note: string;
}

const NOTICE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

async function readJson<T>(key: string): Promise<T | null> {
  const row = await db.syncState.findUnique({ where: { key } }).catch(() => null);
  if (!row) return null;
  try {
    return JSON.parse(row.cursor) as T;
  } catch {
    return null;
  }
}

async function writeJson(key: string, value: unknown) {
  const cursor = JSON.stringify(value);
  await db.syncState.upsert({ where: { key }, update: { cursor }, create: { key, cursor } });
}

export async function readPlanGrant(organizationId: string): Promise<PlanGrant | null> {
  return readJson<PlanGrant>(planGrantKey(organizationId));
}

export async function writePlanGrant(organizationId: string, grant: PlanGrant): Promise<void> {
  await writeJson(planGrantKey(organizationId), grant);
}

export async function clearPlanGrant(organizationId: string): Promise<void> {
  await db.syncState.deleteMany({ where: { key: planGrantKey(organizationId) } });
}

export async function readSyncingMark(organizationId: string): Promise<SyncingMark | null> {
  return readJson<SyncingMark>(subSyncingKey(organizationId));
}

export async function writeSyncingMark(organizationId: string, mark: SyncingMark): Promise<void> {
  await writeJson(subSyncingKey(organizationId), mark);
}

export async function clearSyncingMark(organizationId: string): Promise<void> {
  await db.syncState.deleteMany({ where: { key: subSyncingKey(organizationId) } });
}

/** Grants and marks for many organizations at once (the admin table). */
export async function readGrantsAndMarks(organizationIds: string[]): Promise<{
  grants: Map<string, PlanGrant>;
  marks: Map<string, SyncingMark>;
}> {
  const grants = new Map<string, PlanGrant>();
  const marks = new Map<string, SyncingMark>();
  if (!organizationIds.length) return { grants, marks };
  const keys = organizationIds.flatMap((id) => [planGrantKey(id), subSyncingKey(id)]);
  const rows = await db.syncState.findMany({ where: { key: { in: keys } } });
  for (const r of rows) {
    const [kind, orgId] = r.key.split(":");
    try {
      const v = JSON.parse(r.cursor);
      if (kind === "planGrant") grants.set(orgId, v as PlanGrant);
      else if (kind === "subSyncing") marks.set(orgId, v as SyncingMark);
    } catch {
      /* an unreadable record is reported as none */
    }
  }
  return { grants, marks };
}

/** A grant that is still running at `now`. */
export function grantInForce(grant: PlanGrant | null | undefined, now = new Date()): boolean {
  if (!grant) return false;
  return grant.endsAt === null || new Date(grant.endsAt).getTime() > now.getTime();
}

/* ── THE INVARIANT, AS A CHECK ────────────────────────────────────────── */

export const LIVE_STRIPE_STATUSES = new Set<Stripe.Subscription.Status>(["active", "trialing", "past_due", "unpaid", "incomplete"]);

export interface MirrorShape {
  plan: string;
  status: string;
  provider: string;
  externalSubId: string | null;
  externalCustomerId: string | null;
}

/**
 * The row-level half of the invariant — what can be checked without Stripe.
 * Returns the sentences that describe each violation; empty = consistent.
 */
export function mirrorInvariantViolations(row: MirrorShape | null, grant: PlanGrant | null): string[] {
  const out: string[] = [];
  if (!row) {
    if (grant) out.push("A grant record exists but the organization has no Subscription row.");
    return out;
  }
  const live = row.status === SubscriptionStatus.ACTIVE || row.status === SubscriptionStatus.TRIALING || row.status === SubscriptionStatus.PAST_DUE;
  if (row.provider === "MANUAL" && row.externalSubId) {
    out.push(`A hand grant (MANUAL) still names Stripe subscription ${row.externalSubId}.`);
  }
  if (row.provider === "MANUAL" && live && row.status !== SubscriptionStatus.ACTIVE) {
    out.push(`A hand grant is ${row.status}; a grant is either ACTIVE or over.`);
  }
  if (row.provider === "STRIPE" && live && !row.externalSubId) {
    out.push(`A live STRIPE row names no subscription (a demo/self-serve row, or a broken mirror).`);
  }
  if (grant && row.provider !== "MANUAL") {
    out.push(`A grant record exists while the row is provider ${row.provider}.`);
  }
  return out;
}

/**
 * The Stripe half: every live subscription the account holds for this
 * organization — by its customer id, and by the subscription id the mirror
 * names (a subscription can sit on another customer after a data migration).
 * Read-only.
 */
export async function liveStripeSubscriptionsFor(
  stripe: Stripe,
  row: { externalSubId: string | null; externalCustomerId: string | null } | null,
  extraSubIds: string[] = [],
): Promise<Stripe.Subscription[]> {
  const seen = new Map<string, Stripe.Subscription>();
  if (row?.externalCustomerId) {
    const list = await stripe.subscriptions.list({ customer: row.externalCustomerId, status: "all", limit: 100 });
    for (const s of list.data) if (LIVE_STRIPE_STATUSES.has(s.status)) seen.set(s.id, s);
  }
  for (const id of [row?.externalSubId, ...extraSubIds]) {
    if (!id || seen.has(id)) continue;
    try {
      const s = await stripe.subscriptions.retrieve(id);
      if (LIVE_STRIPE_STATUSES.has(s.status)) seen.set(s.id, s);
    } catch (err) {
      if ((err as { code?: string } | null)?.code !== "resource_missing") throw err;
    }
  }
  return [...seen.values()].sort((a, b) => b.created - a.created);
}

/* ── ACTIVITY ─────────────────────────────────────────────────────────── */

export async function recordPlanActivity(opts: {
  organizationId: string;
  actorId: string | null;
  summary: string;
  meta: Record<string, unknown>;
}) {
  await db.activityEvent
    .create({
      data: {
        organizationId: opts.organizationId,
        actorId: opts.actorId,
        kind: ActivityKind.PLAN_CHANGE,
        summary: opts.summary,
        meta: JSON.stringify(opts.meta),
      },
    })
    .catch((err) => console.warn("[planGrant] activity event failed:", err));
}

/* ── THE SYNCING MARK, CONFIRMED BY STRIPE ────────────────────────────── */

/**
 * A subscription Stripe reported (webhook, cron, or a verify read) confirms
 * the mark when it is the one the editor changed, on the price the editor
 * set, in the status the mirror expects. Returns true when the mark was cleared.
 */
export async function confirmSyncingFromStripe(sub: Stripe.Subscription, organizationIdHint?: string | null): Promise<boolean> {
  let organizationId: string | null = organizationIdHint ?? sub.metadata?.organizationId ?? null;
  if (!organizationId) {
    const mirror = await db.subscription.findFirst({ where: { externalSubId: sub.id }, select: { organizationId: true } });
    organizationId = mirror?.organizationId ?? null;
  }
  if (!organizationId) return false;
  const mark = await readSyncingMark(organizationId);
  if (!mark || mark.subId !== sub.id) return false;
  const priceId = planLine(sub.items.data)?.price?.id ?? null;
  if (mark.priceId && priceId !== mark.priceId) return false;
  if (mirrorStatusFor(sub) !== mark.status) return false;
  await clearSyncingMark(organizationId);
  return true;
}

/** The cron's pass over every standing mark: a read of each subscription. */
export async function confirmPendingSyncMarks(): Promise<{ checked: number; confirmed: number }> {
  const rows = await db.syncState.findMany({ where: { key: { startsWith: "subSyncing:" } } });
  if (!rows.length || !isStripeEnabled()) return { checked: 0, confirmed: 0 };
  const stripe = getStripe();
  let confirmed = 0;
  for (const r of rows) {
    const organizationId = r.key.slice("subSyncing:".length);
    let mark: SyncingMark;
    try {
      mark = JSON.parse(r.cursor) as SyncingMark;
    } catch {
      continue;
    }
    try {
      const sub = await stripe.subscriptions.retrieve(mark.subId);
      if (await confirmSyncingFromStripe(sub, organizationId)) confirmed += 1;
    } catch (err) {
      console.warn(`[planGrant] verify ${mark.subId} failed:`, err);
    }
  }
  return { checked: rows.length, confirmed };
}

/* ── THE GRANT'S END: NOTICE AT 7 DAYS, REVERT ON THE DAY ─────────────── */

export interface GrantExpiryResult {
  scanned: number;
  noticed: number;
  ended: number;
  /** Grants dropped because the row is no longer a hand grant (the org subscribed). */
  superseded: number;
}

async function ownerEmails(organizationId: string): Promise<{ to: string[]; name: string | null; orgName: string }> {
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: {
      name: true,
      billingEmail: true,
      memberships: { where: { role: "OWNER" }, select: { user: { select: { email: true, name: true } } } },
    },
  });
  const to = new Set<string>();
  let name: string | null = null;
  for (const m of org?.memberships ?? []) {
    if (m.user?.email) to.add(m.user.email.toLowerCase());
    if (!name && m.user?.name) name = m.user.name;
  }
  if (org?.billingEmail) to.add(org.billingEmail.toLowerCase());
  return { to: [...to], name, orgName: org?.name ?? "" };
}

/** What the fallback reads as, for people. */
export function fallbackLabel(f: GrantFallback): string {
  return f === "free" ? "the Free plan" : "no plan (subscribe to continue)";
}

/**
 * Called by the reconcile cron (every six hours). Idempotent: the notice is
 * stamped on the grant, the revert removes the grant.
 */
export async function runPlanGrantExpiry(now = new Date()): Promise<GrantExpiryResult> {
  const rows = await db.syncState.findMany({ where: { key: { startsWith: "planGrant:" } } });
  const result: GrantExpiryResult = { scanned: rows.length, noticed: 0, ended: 0, superseded: 0 };
  for (const r of rows) {
    const organizationId = r.key.slice("planGrant:".length);
    let grant: PlanGrant;
    try {
      grant = JSON.parse(r.cursor) as PlanGrant;
    } catch {
      continue;
    }
    const mirror = await db.subscription.findUnique({ where: { organizationId } });
    // The organization subscribed (recordPlanChange clears the grant, but a
    // webhook write can land first): the grant is over, the paid plan stands.
    if (!mirror || mirror.provider !== "MANUAL") {
      await clearPlanGrant(organizationId);
      result.superseded += 1;
      await recordPlanActivity({
        organizationId,
        actorId: null,
        summary: `Complimentary ${await getPlanDisplayName(grant.plan)} ended — the organization is on a paid subscription`,
        meta: { mode: "grant-superseded", grant },
      });
      continue;
    }
    if (grant.endsAt === null) continue;
    const endsAt = new Date(grant.endsAt);

    if (endsAt.getTime() <= now.getTime()) {
      await endPlanGrant(organizationId, grant, mirror.plan, "expired", null);
      result.ended += 1;
      continue;
    }
    if (!grant.noticeSentAt && endsAt.getTime() - now.getTime() <= NOTICE_DAYS * DAY_MS) {
      const { to, name } = await ownerEmails(organizationId);
      if (to.length) {
        try {
          const base = (await appBaseUrl()).replace(/\/$/, "");
          const doc = buildComplimentaryEnding({
            name,
            planName: await getPlanDisplayName(grant.plan),
            endsAt,
            fallback: fallbackLabel(grant.fallback),
            href: `${base}/dashboard/subscription`,
          });
          const { subject, html } = renderEmail(doc);
          await sendEmail({ mailClass: "transactional", to, subject, html });
        } catch (err) {
          console.warn(`[planGrant] notice for ${organizationId} failed:`, err);
          continue;
        }
      }
      await writePlanGrant(organizationId, { ...grant, noticeSentAt: now.toISOString() });
      result.noticed += 1;
    }
  }
  return result;
}

/**
 * End a grant: the row goes to the fallback, the record is removed, the
 * activity says so. Used by the cron on the end date and by the editor's
 * "End now". `by` null = the cron.
 */
export async function endPlanGrant(
  organizationId: string,
  grant: PlanGrant,
  currentPlan: string,
  how: "expired" | "ended-by-admin",
  by: { id: string; email: string } | null,
): Promise<void> {
  const now = new Date();
  const toFree = grant.fallback === "free";
  await db.subscription.update({
    where: { organizationId },
    data: toFree
      ? {
          plan: "FREE",
          status: SubscriptionStatus.FREE,
          provider: "MANUAL",
          currentPeriodEnd: null,
          trialEndsAt: null,
          canceledAt: null,
          externalSubId: null,
          stripePriceId: null,
        }
      : {
          status: SubscriptionStatus.EXPIRED,
          provider: "MANUAL",
          currentPeriodEnd: now,
          trialEndsAt: null,
          canceledAt: now,
          externalSubId: null,
          stripePriceId: null,
        },
  });
  await clearPlanGrant(organizationId);
  const planName = await getPlanDisplayName(currentPlan);
  await recordPlanActivity({
    organizationId,
    actorId: by?.id ?? null,
    summary:
      how === "expired"
        ? `Complimentary ${planName} ended — now on ${fallbackLabel(grant.fallback)}`
        : `Complimentary ${planName} ended by JobFlex support — now on ${fallbackLabel(grant.fallback)}`,
    meta: { mode: "grant-ended", how, grant, actorEmail: by?.email ?? null },
  });
}
