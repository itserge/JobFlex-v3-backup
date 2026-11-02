// WHY A PLAN WAS CANCELLED (owner, 2026-10-20). The last cancel window,
// "Cancel <plan>?" (components/billing/FreeSwitch), asks "Why are you
// cancelling?" — one or more of the reasons below, and "Other" with its own
// words. The button stays off until the answer is whole; the server checks the
// same rule (actions/billing cancelSubscription) before anything is cancelled.
// Stored on CancellationFeedback as a JSON array of the keys, read by
// /admin/cancellations and the /admin/users sheet. Pure: the client imports it.

export const CANCEL_REASONS = [
  { key: "too_expensive", label: "Too expensive" },
  { key: "not_enough_jobs", label: "Not enough jobs right now" },
  { key: "missing_feature", label: "Missing a feature I need" },
  { key: "hard_to_use", label: "Hard to use / took too long to learn" },
  { key: "switched_tool", label: "Switched to another tool" },
  { key: "just_testing", label: "Just testing, not ready to buy" },
  { key: "other", label: "Other" },
] as const;

export type CancelReason = (typeof CANCEL_REASONS)[number]["key"];

export const OTHER_MIN = 3;
export const OTHER_MAX = 500;

const KEYS = new Set<string>(CANCEL_REASONS.map((r) => r.key));

export function isCancelReason(v: unknown): v is CancelReason {
  return typeof v === "string" && KEYS.has(v);
}

/** Written by a platform admin's cancel (lib/adminCancel, 2026-11-01) with the
 *  admin's own words as otherText. Read back like the others, but never in
 *  the owner's list and never accepted from the window (checkCancelFeedback). */
export const ADMIN_REASON = "admin";
export type StoredReason = CancelReason | typeof ADMIN_REASON;
/** The admin's own words (otherText) — the window and the server check the same bounds. */
export const ADMIN_NOTE_MIN = 3;
export const ADMIN_NOTE_MAX = 300;

export function reasonLabel(key: string): string {
  if (key === ADMIN_REASON) return "Cancelled by JobFlex admin";
  return CANCEL_REASONS.find((r) => r.key === key)?.label ?? key;
}

export interface CancelFeedbackInput {
  reasons: CancelReason[];
  otherText?: string | null;
}

/** What the window may send: known keys, in the list's order, once each;
 *  the "Other" words only when Other is ticked. */
export type CancelFeedbackCheck =
  | { ok: true; reasons: CancelReason[]; otherText: string | null }
  | { ok: false; error: string };

export function checkCancelFeedback(raw: unknown): CancelFeedbackCheck {
  const r = (raw && typeof raw === "object" ? raw : {}) as { reasons?: unknown; otherText?: unknown };
  const picked = new Set(Array.isArray(r.reasons) ? r.reasons.filter(isCancelReason) : []);
  const reasons = CANCEL_REASONS.map((x) => x.key).filter((k) => picked.has(k));
  if (!reasons.length) return { ok: false, error: "Pick at least one reason." };
  if (!picked.has("other")) return { ok: true, reasons, otherText: null };
  const text = typeof r.otherText === "string" ? r.otherText.trim() : "";
  if (text.length < OTHER_MIN) return { ok: false, error: `Tell us a little more under Other (at least ${OTHER_MIN} characters).` };
  if (text.length > OTHER_MAX) return { ok: false, error: `Keep Other under ${OTHER_MAX} characters.` };
  return { ok: true, reasons, otherText: text };
}

/** CancellationFeedback.reasons → the keys it holds (unknown words dropped). */
export function parseReasons(json: string | null | undefined): StoredReason[] {
  try {
    const v: unknown = JSON.parse(json ?? "[]");
    return Array.isArray(v) ? v.filter((k): k is StoredReason => isCancelReason(k) || k === ADMIN_REASON) : [];
  } catch {
    return [];
  }
}
