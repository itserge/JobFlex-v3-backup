// WHEN A PENDING SIGNUP IS STILL ALIVE — one rule (2026-10-14).
//
// A `signup:<token>` row (actions/signupCheckout) is an unpaid intent; it
// expires on read. The plan step's payment path (loadPending) and the
// passwordless sign-up's return (lib/signupOtp draftRestore) ask the same
// question here, so the register page never opens the plan step over an
// intent the payment would refuse ("That signup expired", owner's report:
// the draft lived a day, the intent two hours).
//
// A day, like the passwordless draft and its cookie: a code received and the
// plan picked in the evening still works. A card-less trial waiting on its
// emailed link counts the day from the latest link sent.
const HOUR_MS = 60 * 60 * 1000;
export const PENDING_TTL_MS = 24 * HOUR_MS;
/** How long a card-less trial's confirmation link stays good. */
export const CONFIRM_TTL_MS = 24 * HOUR_MS;

export function pendingSignupAlive(
  rec: { email?: string; phone?: string; createdAt?: number; cardless?: { requestedAt: number } } | null | undefined,
  now = Date.now(),
): boolean {
  // A sign-up by text (2026-11-12) has its number and no email until Stripe's card page gives one.
  if (!rec?.email && !rec?.phone) return false;
  return rec.cardless ? now - rec.cardless.requestedAt <= CONFIRM_TTL_MS : now - (rec.createdAt ?? 0) <= PENDING_TTL_MS;
}
