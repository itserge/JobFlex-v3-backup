// WHY A PLAN WAS CANCELLED — the flat reason keys kept on
// CancellationFeedback.reasons (a JSON array), read by /admin/cancellations,
// the /admin/users sheet, lib/custDev and lib/cameBack. Pure: the client imports it.
//
// Since 2026-11-09 the owner answers a tree of questions (lib/cancelTree) and
// the whole answer is CancellationFeedback.answersJson; `reasons` keeps the
// flat keys beside it: ["no_time"] for A1, ["tools"] for A2, B3's own keys for
// A3. Rows written before that (2026-10-20 → 2026-11-08) carry the window's
// old keys, two of which are no longer offered (missing_feature, hard_to_use)
// — they are still labelled here so old rows read as they were.

export const CANCEL_REASONS = [
  { key: "no_time", label: "Didn't have time to try it" },
  { key: "tools", label: "Tools didn't work" },
  { key: "too_expensive", label: "Too expensive" },
  { key: "not_enough_jobs", label: "Not enough jobs right now" },
  { key: "switched_tool", label: "Switched to another tool" },
  { key: "just_testing", label: "Just testing, not ready to buy" },
  { key: "business_closed", label: "Business closed / changed" },
  { key: "missing_feature", label: "Missing a feature I need" },
  { key: "hard_to_use", label: "Hard to use / took too long to learn" },
  { key: "other", label: "Other" },
] as const;

export type CancelReason = (typeof CANCEL_REASONS)[number]["key"];

const KEYS = new Set<string>(CANCEL_REASONS.map((r) => r.key));

export function isCancelReason(v: unknown): v is CancelReason {
  return typeof v === "string" && KEYS.has(v);
}

/** Written by a platform admin's cancel (lib/adminCancel, 2026-11-01) with the
 *  admin's own words as otherText. Read back like the others, but never in
 *  the owner's questions. */
export const ADMIN_REASON = "admin";
export type StoredReason = CancelReason | typeof ADMIN_REASON;
/** The admin's own words (otherText) — the window and the server check the same bounds. */
export const ADMIN_NOTE_MIN = 3;
export const ADMIN_NOTE_MAX = 300;

export function reasonLabel(key: string): string {
  if (key === ADMIN_REASON) return "Cancelled by JobFlex admin";
  return CANCEL_REASONS.find((r) => r.key === key)?.label ?? key;
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
