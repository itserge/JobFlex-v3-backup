// MORE TRIAL DAYS, ASKED FROM THE CANCEL QUESTIONS (owner, 2026-10-20; screen
// C1 of lib/cancelTree since 2026-11-09). Pure — the rule and the words;
// lib/trialExtensionServer reads and writes.
//
// WHO SEES "Want 7 or 14 more days?": an owner on the cancel path ("I didn't
// have enough time") whose
// plan is on its trial now, or whose trial ended at most 14 days ago — read
// off the Subscription mirror (status TRIALING, or trialEndsAt within the last
// 14 days; the mirror keeps trialEndsAt once the trial is over). Nobody else.
// One open (PENDING) request per organization: a second press reads "Request
// pending". A platform admin approves 7 or 14 days, or denies with a reason,
// in /admin/trial-requests. Nothing here cancels or changes the plan.

export const EXTENSION_DAYS = [7, 14] as const;
export type ExtensionDays = (typeof EXTENSION_DAYS)[number];
export const NOTE_MAX = 500;
export const DENY_REASON_MAX = 300;
/** How long after the trial's end the button is still offered. */
export const ENDED_WINDOW_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export const TRIAL_REQUEST_STATUSES = ["PENDING", "APPROVED", "DENIED"] as const;
export type TrialRequestStatus = (typeof TRIAL_REQUEST_STATUSES)[number];

export function isExtensionDays(v: unknown): v is ExtensionDays {
  return v === 7 || v === 14;
}

/** On its trial now, or the trial ended no more than 14 days ago. */
export function trialExtensionEligible(
  sub: { status: string; trialEndsAt: Date | null } | null | undefined,
  now = Date.now(),
): boolean {
  if (!sub) return false;
  if (sub.status === "TRIALING") return true;
  if (!sub.trialEndsAt) return false;
  const ended = sub.trialEndsAt.getTime();
  return ended <= now && now - ended <= ENDED_WINDOW_DAYS * DAY_MS;
}

/** Where the added days start: the trial's end while it runs; for a plan
 *  already paying after its trial, the end of the period it has paid for —
 *  the days push the next charge back, so nothing is charged twice; otherwise
 *  now (extendedTrialEnd never starts in the past). */
export function extensionBase(sub: { status: string; trialEndsAt: Date | null; currentPeriodEnd: Date | null }): Date | null {
  if (sub.status === "TRIALING") return sub.trialEndsAt;
  if (sub.status === "ACTIVE") return sub.currentPeriodEnd;
  return null;
}

/** The new trial end: N days past `base`, or past now when that is over. */
export function extendedTrialEnd(trialEndsAt: Date | null, days: number, now = Date.now()): Date {
  const base = Math.max(trialEndsAt?.getTime() ?? 0, now);
  return new Date(base + days * DAY_MS);
}

/** What the Before-you-go window knows about the button (lib/settings). */
export interface TrialExtensionOffer {
  /** An open request: its days and when it was sent (ISO). */
  pending: { days: number; at: string } | null;
}

export const REQUEST_SENT_TITLE = "Request sent";
export const REQUEST_SENT_BODY = "We'll answer by email within one business day.";
