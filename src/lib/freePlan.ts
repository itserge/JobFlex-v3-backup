// THE FREE PLAN (owner, 2026-10-13) — what a cancelled company is.
//
// Cancelling no longer leaves a company "cancelled": at the end of the cycle
// it has paid for, it moves to the Free plan. Nothing more is billed, nothing
// is refunded, and every proposal, job and client stays where it is.
//
// FREE OPENS NOTHING A CANCELLED COMPANY COULD NOT OPEN. Three mirror
// statuses are the Free plan, and lib/planStatus closes every door for each
// of them alike (the page gate, the feature tier, the limits engine at the
// "free" catalog row, the paid services, texting, the parcel tiles):
//   · CANCELED    — the subscription ended (the owner cancelled, support
//                   ended it, Stripe gave up on payment);
//   · TRIAL_ENDED — a card-less trial ran out with no card (owner,
//                   2026-10-14: Free, no longer a read-only lock);
//   · FREE        — a complimentary plan ran out onto "free" (lib/planGrant).
// Free is how that state is NAMED — on the subscription page, the settings,
// the sidebar, the emails and the admin.
//
// The plan the company had stays on the row (Subscription.plan), the day it
// asked to leave on canceledAt and the day it moved to Free on
// currentPeriodEnd — the churn reports read them ("Free (was Professional)").
//
// Database-free and client-safe: the screens and the server share it.

export const FREE_PLAN_NAME = "Free";

/** Statuses a subscription can still be cancelled from (or kept in). */
export const LIVE_STATUSES = ["ACTIVE", "TRIALING", "PAST_DUE"] as const;

/** Marked on the Stripe subscription while the switch to Free is booked:
 *  its end is the company moving to Free, not a card-less trial running out
 *  (lib/stripeStatus isCardlessTrialLapse). Cleared by "Keep". */
export const FREE_SWITCH_META = "jf_to_free";

export type FreePlanRow = {
  status: string;
  canceledAt: Date | string | null;
  currentPeriodEnd: Date | string | null;
  trialEndsAt?: Date | string | null;
  provider?: string | null;
};

const at = (d: Date | string | null | undefined): Date | null => (d ? new Date(d) : null);

/** The mirror statuses that are the Free plan (see the head of this file). */
export const FREE_STATUSES = ["CANCELED", "TRIAL_ENDED", "FREE"] as const;

/** The company is on the Free plan. */
export function onFreePlan(sub: Pick<FreePlanRow, "status"> | null | undefined): boolean {
  return (FREE_STATUSES as readonly string[]).includes((sub?.status ?? "").toUpperCase());
}

/** The switch to Free is booked: still live, set to end with the cycle. */
export function freeSwitchBooked(sub: Pick<FreePlanRow, "status" | "canceledAt"> | null | undefined): boolean {
  return !!sub && (LIVE_STATUSES as readonly string[]).includes(sub.status.toUpperCase()) && !!sub.canceledAt;
}

/** The day a booked switch happens: the end of the paid cycle (or of the trial). */
export function freeSwitchDate(sub: Pick<FreePlanRow, "currentPeriodEnd" | "trialEndsAt"> | null | undefined): Date | null {
  return at(sub?.currentPeriodEnd) ?? at(sub?.trialEndsAt);
}

/** The day the company moved to Free: the end of its last cycle, as the
 *  mirror wrote it when Stripe ended the subscription. */
export function freeSince(sub: Pick<FreePlanRow, "currentPeriodEnd" | "canceledAt"> | null | undefined): Date | null {
  return at(sub?.currentPeriodEnd) ?? at(sub?.canceledAt);
}

/** "Free (was Professional)" — the admin's word for a company that left. */
export function freeWasLabel(wasPlanName: string | null | undefined): string {
  const was = (wasPlanName ?? "").trim();
  return was && was.toLowerCase() !== "free" ? `${FREE_PLAN_NAME} (was ${was})` : FREE_PLAN_NAME;
}

/* ── "BEFORE YOU GO" — what the plan gives that Free does not ─────────────
   Read from what the company actually holds and what Free actually closes
   (lib/customPlan: a lapsed plan closes every add-on page; lib/paidCaps: no
   texts once the plan has ended; the "free" catalog row's proposal cap) —
   never a promise or a number typed here. A custom plan lists only the pages
   it bought. Online payments are not on the list: Free keeps them. */

export interface FreeLoss {
  /** A symbol in the shell's sprite (desktop and handheld carry the same ids). */
  icon: "i-roof" | "i-file" | "i-target" | "i-cal" | "i-msg";
  text: string;
  /** The square's tool colour when it is not the icon's own (the Deck Studio add-on's line). */
  tone?: "deck";
}

const ESTIMATORS: Array<[string, string]> = [
  ["smart-proposal", "Smart Proposal"],
  ["roof-estimator", "roof"],
  ["fence-estimator", "fence"],
  ["hvac-estimator", "HVAC"],
  ["video-estimator", "video"],
];

const listWords = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/**
 * At most five lines, one each: the Deck Studio add-on when it is on the
 * subscription (it ends with the plan — owner, 2026-10-20), estimators,
 * proposals past Free's cap, leads, calendar and crews, texts.
 *   pages          — the custom plan's pages, or null on a catalog plan (every page open);
 *   planProposals  — the plan's own monthly proposal cap (null = none);
 *   freeProposals  — the Free plan's (null = none, then nothing is lost there);
 *   deckAddon      — the add-on's price words ("$79/mo"), or null when it is not on the plan.
 */
export function freePlanLosses(opts: { pages: readonly string[] | null; planProposals: number | null; freeProposals: number | null; deckAddon?: string | null }): FreeLoss[] {
  const has = (id: string) => opts.pages === null || opts.pages.includes(id);
  const out: FreeLoss[] = [];
  if (opts.deckAddon) out.push({ icon: "i-roof", tone: "deck", text: `Deck Studio — your ${opts.deckAddon} add-on ends with the plan` });
  const est = ESTIMATORS.filter(([id]) => has(id)).map(([, name]) => name);
  if (est.length) {
    const smart = est[0] === "Smart Proposal";
    const trades = smart ? est.slice(1) : est;
    out.push({
      icon: "i-roof",
      text: trades.length
        ? `${smart ? "Smart Proposal and the " : "The "}${listWords(trades)} estimator${trades.length === 1 ? "" : "s"}`
        : "Smart Proposal",
    });
  }
  // The paid features (owner, 2026-11-09; lib/customPlan PAID_FEATURES): every live plan holds them, Free closes them.
  out.push({ icon: "i-cal", text: "AI Operator & SmartBook, and projects: stages, buying & crew tools" });
  const free = opts.freeProposals;
  if (free !== null && (opts.planProposals === null || opts.planProposals > free)) {
    out.push({ icon: "i-file", text: `More than ${free} proposal${free === 1 ? "" : "s"} a month` });
  }
  if (has("leads")) out.push({ icon: "i-target", text: "Your leads inbox and lead matching" });
  const cal = has("calendar"), crew = has("workers");
  if (cal || crew) out.push({ icon: "i-cal", text: cal && crew ? "Calendar and crews" : cal ? "Calendar and scheduling" : "Crews and their portals" });
  out.push({ icon: "i-msg", text: "Texts to your clients" });
  return out.slice(0, 5);
}

/** The company's own numbers in "Before you go" — read from its rows, never
 *  estimated. `quoted` is the total of the proposals it sent, or null when
 *  they are in more than one currency (no sum across currencies). */
export interface FreeTally {
  proposalsSent: number;
  quoted: { amount: number; currency: string } | null;
  clients: number;
}

/** The tally as tiles, largest-meaning first; a zero is left out, and an
 *  empty list means the window shows no numbers at all. */
export function freeTallyTiles(t: FreeTally | null | undefined): Array<{ key: "sent" | "quoted" | "clients"; value: string; label: string }> {
  if (!t) return [];
  const out: Array<{ key: "sent" | "quoted" | "clients"; value: string; label: string }> = [];
  const n = (x: number) => new Intl.NumberFormat("en-US").format(x);
  if (t.proposalsSent > 0) out.push({ key: "sent", value: n(t.proposalsSent), label: t.proposalsSent === 1 ? "proposal sent" : "proposals sent" });
  if (t.quoted && t.quoted.amount >= 1) {
    const big = t.quoted.amount >= 100_000;
    const value = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: t.quoted.currency,
      maximumFractionDigits: big ? 1 : 0,
      ...(big ? { notation: "compact" as const } : {}),
    }).format(t.quoted.amount);
    out.push({ key: "quoted", value, label: "quoted to clients" });
  }
  if (t.clients > 0) out.push({ key: "clients", value: n(t.clients), label: t.clients === 1 ? "client" : "clients" });
  return out;
}
