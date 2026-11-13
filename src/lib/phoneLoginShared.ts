// SIGN-UP AND SIGN-IN BY TEXT (owner, 2026-11-12) — the half the browser and the server share: what a number is, how
// it reads, and the words. No "server-only": step 1, the sign-in form and the setup sheet format with it.
//
// A US mobile only (lib/phone isUsCanadaNumber: +1, a real area code and exchange, no Caribbean or premium-rate code),
// so a sign-up can never be made to text abroad. The code itself goes through Twilio Verify (lib/sms/verify); the
// machine is lib/signupOtp's (channel "sms"); the number → account index is lib/phoneLogin.
import { isUsCanadaNumber, toE164 } from "@/lib/phone";

/** The number as E.164 (+1XXXXXXXXXX) when it is a US / Canadian one; null otherwise. */
export function usMobileE164(raw: string | null | undefined): string | null {
  const e164 = toE164(raw);
  return e164 && isUsCanadaNumber(e164) ? e164 : null;
}

/** "+12015550123" → "(201) 555-0123"; anything else as it came. */
export function prettyUsPhone(e164: string | null | undefined): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec((e164 ?? "").trim());
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : (e164 ?? "");
}

/** The field as it is typed: digits only, a leading 1 dropped, shaped "(201) 555-0123" as they come. */
export function typingUsPhone(raw: string): string {
  let d = raw.replace(/\D/g, "");
  if (d.length > 10 && d.startsWith("1")) d = d.slice(1);
  d = d.slice(0, 10);
  if (d.length === 0) return "";
  if (d.length < 4) return `(${d}`;
  if (d.length < 7) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

/** Under the phone field, word for word (owner, 2026-11-12). */
export const PHONE_CONSENT_LINE = "We'll text you a code. Msg & data rates may apply.";
export const PHONE_INVALID = "Enter a US mobile number, like (555) 123-4567.";
/** Step 1 with a number that already has an account: no text goes out, sign-in is offered instead. */
export const PHONE_TAKEN = "That number already has a JobFlex account. Sign in with it instead.";
/** The sign-in form with a number no account uses (no text goes out). */
export const PHONE_NO_ACCOUNT = "No JobFlex account uses this number. Sign in with your email, or create an account.";

/**
 * BACK FROM STRIPE WITHOUT AN ADDRESS WE CAN USE. A sign-up by text has no email until Stripe's card page asks for one;
 * the account takes that address. When it cannot (another account has it, a throwaway inbox, none at all) no account
 * is made, that Checkout's subscription is cancelled, and the card page opens again with one of these lines — keyed by
 * the code the server keeps (lib/signupCardHold refuseSignupCheckout) and the address carries (`why=`).
 */
export const STRIPE_EMAIL_LINES: Readonly<Record<string, string>> = {
  email_taken: "That email already has a JobFlex account. Sign in with it, or use a different email on the card page.",
  email_disposable: "That email is a throwaway inbox. Use the email you work from on the card page.",
  email_missing: "The card page didn't give us an email. Try again.",
};
export const isStripeEmailCode = (code: string | null | undefined): boolean => !!code && code in STRIPE_EMAIL_LINES;
