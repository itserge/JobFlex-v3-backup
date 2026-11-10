// ACTIVATION EVENTS (2026-09-20) — what an organization actually DID, sent
// from the server at the point the write succeeded. Never from a click: a
// button that failed validation is not a sent proposal.
//
// Identity is the ORGANIZATION: distinct_id = organizationId, no person
// profile. Every event carries the same four facts — organizationId, plan,
// specialty, days since the org was created — plus at most a closed-vocabulary
// label (`estimator`, `source`, `provider`, `from`/`to`). Never an amount, an
// address, a client or user name, an email.
//
// The read and the send both happen after the response (lib/server-events'
// afterResponse), and nothing here can fail its caller: a missing key, a slow
// PostHog or a failed read is a dropped event.

import { db } from "@/lib/db";
import { afterResponse, captureServerEvent } from "@/lib/server-events";
import { isQaOrg } from "@/lib/qaTestMode";

export type ActivationEvent =
  | "organization_created"
  | "first_proposal_created"
  | "proposal_sent"
  | "proposal_approved"
  | "invoice_sent"
  | "payment_recorded"
  | "estimator_used"
  | "plan_changed"
  // The cancel window's reasons and the ask for more trial days (2026-10-20):
  // the reason keys and the days asked, never the owner's own words.
  | "subscription_cancel_reason"
  | "trial_extension_requested"
  // The cancel questions (2026-11-09, lib/cancelTree): each screen shown, and
  // the screen a window was closed on without cancelling — step and path only.
  | "cancel_flow_step"
  | "cancel_flow_abandoned"
  // The first-estimate tour (2026-10-26, actions/onboarding): the path and the
  // step's id (lib/onboarding/tour-paths), never what was typed.
  | "tour_started"
  | "tour_step"
  | "tour_completed"
  | "tour_skipped";

export type EstimatorKind = "smart" | "roof" | "fence" | "hvac" | "video";
/** Where a proposal came from; "duplicate" can never be an org's first. */
export type ProposalSource = "editor" | "template" | EstimatorKind;

type Extra = Record<string, string | number | boolean | null>;

/** The org's own facts, read once per event. */
async function organizationFacts(organizationId: string): Promise<Extra> {
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { createdAt: true, tradeTypesJson: true, subscription: { select: { plan: true } } },
  });
  if (!org) return { organizationId };
  let trades: string[] = [];
  try { const parsed: unknown = JSON.parse(org.tradeTypesJson ?? "[]"); if (Array.isArray(parsed)) trades = parsed.filter((t): t is string => typeof t === "string"); } catch { /* unreadable → none */ }
  return {
    organizationId,
    plan: org.subscription?.plan ?? "FREE",
    // The closed TRADE_TYPES vocabulary only; the free-text "Other" trade is not sent.
    specialty: trades[0] ?? "none",
    specialties: trades.slice(0, 8).join(","),
    days_since_signup: Math.max(0, Math.floor((Date.now() - org.createdAt.getTime()) / 86_400_000)),
  };
}

export function trackActivation(event: ActivationEvent, organizationId: string | null | undefined, extra: Extra = {}): void {
  if (!organizationId || !process.env.NEXT_PUBLIC_POSTHOG_KEY) return;
  afterResponse(async () => {
    if (await isQaOrg(organizationId)) return; // the QA Lab's own accounts (lib/qaTestMode)
    await captureServerEvent(event, organizationId, { ...(await organizationFacts(organizationId)), ...extra });
  });
}

/** Call after a proposal row is written. Fires only when it is the org's first. */
export function trackProposalCreated(organizationId: string, source: ProposalSource): void {
  if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) return;
  afterResponse(async () => {
    // take 2: "is there more than one" without counting a large table.
    const rows = await db.proposal.findMany({ where: { organizationId }, select: { id: true }, take: 2 });
    if (rows.length !== 1 || (await isQaOrg(organizationId))) return;
    await captureServerEvent("first_proposal_created", organizationId, { ...(await organizationFacts(organizationId)), source });
  });
}

export type PlanChangeVia = "checkout" | "self_serve" | "stripe" | "admin";

type PlanSnapshot = { plan: string; status: string } | null | undefined;

/** The stored plan BEFORE a subscription write: null = no row yet, undefined =
 *  not tracking (no key, or the read failed — the write goes ahead regardless). */
export async function planSnapshot(organizationId: string): Promise<PlanSnapshot> {
  if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) return undefined;
  return db.subscription.findUnique({ where: { organizationId }, select: { plan: true, status: true } }).catch(() => undefined);
}

/** Call after the write, with the snapshot taken before it. Reports
 *  `plan_changed` only when the stored slug is different now: several writers
 *  can land the same change — the checkout return page, then Stripe's webhook —
 *  and only the one that actually moved the row reports it. */
export function reportPlanChange(organizationId: string, via: PlanChangeVia, before: PlanSnapshot): void {
  if (before === undefined) return;
  afterResponse(async () => {
    const after = await db.subscription.findUnique({ where: { organizationId }, select: { plan: true, status: true } });
    const from = before?.plan ?? "FREE";
    // A cancellation keeps the slug on the row; the status is what changed.
    const to = after?.status === "CANCELED" && before?.status !== "CANCELED" ? "CANCELED" : after?.plan ?? "FREE";
    if (from.toUpperCase() === to.toUpperCase() || (await isQaOrg(organizationId))) return;
    await captureServerEvent("plan_changed", organizationId, { ...(await organizationFacts(organizationId)), from, to, via });
  });
}
