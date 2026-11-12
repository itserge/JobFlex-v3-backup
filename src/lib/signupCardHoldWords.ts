// THE $1 CARD CHECK'S WORDS (owner, 2026-11-11) — one file, read by the browser (step 1, the plan step) and the
// server (the sign-up's Stripe Checkout custom_text). The rule itself: lib/signupCardHold.

/** Said on Stripe's sign-up page and on our step just before it. */
export const CARD_HOLD_NOTICE = "We place a temporary $1 hold to verify your card. It's released right away — you're not charged during the trial.";

/** The one line when the bank refuses the hold: no account, back to the card page. */
export const CARD_DECLINED_LINE = "Your card was declined by your bank. Try another card.";

/** The suffix Stripe prints after the account's short descriptor on the bank statement ("JOBFLEX* CARD CHECK"). */
export const CARD_HOLD_STATEMENT_SUFFIX = "CARD CHECK";
