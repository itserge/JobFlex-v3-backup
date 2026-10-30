// THE SIGN-UP FORM, WATCHED — the shared words (owner, 2026-10-14: "we need to see in real time what they're doing
// exactly, at which point they're leaving, and whether the problem is on our side").
//
// Pure, no imports: the browser's watcher (lib/signup-watch) names what it sends with these, and the live panel,
// the form report and the alerts read them back the same way. A box is named by its element id and never by what was
// typed; a refusal is named by a reason, and every reason says whose side it is on:
//   ours   — the visitor did nothing wrong: our server failed, the code email did not go, a rule of ours blocked a
//            real person, the page broke or was slow;
//   theirs — the form refused what they gave it (an empty box, a wrong code, an address already in use) or they chose
//            to go.

//   outside — the browser failed, not our code: a script from another site (a cross-origin "Script error." — Google
//            sign-in, the Meta pixel), a Facebook or Instagram in-app browser's own bridge ("Java object is gone"), the
//            ResizeObserver notice: neither ours to fix nor the visitor's doing, and never the verdict on why they
//            stopped (2026-10-16; by its words too since 2026-10-30, see problemOf).
export type SignupSide = "ours" | "theirs" | "outside";
/** A side read back from an event or a row; anything unknown is the reason's own side. */
export function sideOf(raw: unknown, reason: string): SignupSide {
  return raw === "ours" || raw === "theirs" || raw === "outside" ? raw : reasonSide(reason);
}
/** The browser's whole word on a cross-origin script failure: "Script error." with no file, no line — nothing to act on. */
export function isOutsideScriptError(message: string | null | undefined, filename?: string | null, lineno?: number | null): boolean {
  return /^\s*script error\.?\s*$/i.test(message ?? "") && !filename && !lineno;
}

// The browser's own failures, by their words (2026-10-30): an Android webview's JS bridge torn down under the page
// (Facebook's and Instagram's in-app browsers — "Error invoking postMessage: Java object is gone"), a cross-origin
// "Script error." with no stack, the browser's ResizeObserver loop notice. Lower case, one source for the browser's
// RegExp and the PostHog query's match(lower(message), …) — re2 and JS read it the same.
export const BROWSER_NOISE_PATTERN = "java object is gone|error invoking postmessage|resizeobserver loop|^\\s*(uncaught\\s+)?script error\\.?\\s*$";
const BROWSER_NOISE = new RegExp(BROWSER_NOISE_PATTERN, "i");
/** True when the words are the browser's (or the in-app webview's) own failure, never our code's. */
export function isBrowserNoise(message: string | null | undefined): boolean {
  return BROWSER_NOISE.test(message ?? "");
}
/** True when the failing script's file is on another site (a pixel, Google sign-in, the in-app browser's injected
 *  code). No file at all is not "another site": that is the words' call. */
export function isForeignFile(filename: string | null | undefined, ourHost: string): boolean {
  if (!filename || /^(blob|data):/i.test(filename)) return false;
  try {
    return new URL(filename).host.toLowerCase() !== ourHost.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * A problem as stored, read back: a page error in the browser's words (or an outside script) is "browser_error" on
 * the outside — the events sent before 2026-10-30 said "page_error · ours" for it; anything else keeps its reason and
 * its side.
 */
export function problemOf(reason: string, rawSide: unknown, message: string | null | undefined): { reason: string; side: SignupSide } {
  if (reason === "browser_error" || reason === "outside_script" || isBrowserNoise(message)) return { reason: "browser_error", side: "outside" };
  return { reason, side: sideOf(rawSide, reason) };
}
/** "Browser error (Facebook in-app), not ours" — the app named when the visit's browser was one's webview. */
export function browserErrorWords(app?: string | null): string {
  const name = app ? `${app.charAt(0).toUpperCase()}${app.slice(1)} in-app` : "";
  return `Browser error${name ? ` (${name})` : ""}, not ours`;
}

/** Element id → the box's name on the admin's screen. */
export const SIGNUP_FIELDS: Readonly<Record<string, string>> = {
  name: "Name",
  email: "Email",
  password: "Password",
  pw: "Password",
  pw1: "Password",
  pw2: "Confirm password",
  password2: "Confirm password",
  biz1: "Business name",
  biz2: "Business name",
  addr: "Address",
  phone: "Phone",
  otherTrade: "Other trade",
  otpCode: "Code",
  code: "Code",
  trades: "Trades",
  promo: "Promo code",
};

/** A box's name from its id; null for anything the watcher should not name. */
export function fieldName(id: string): string | null {
  if (!id) return null;
  if (SIGNUP_FIELDS[id]) return SIGNUP_FIELDS[id];
  if (/^otp|code/i.test(id)) return "Code";
  if (/^trade/i.test(id)) return "Trades";
  return null;
}

/** The screens of the sign-up, by the watcher's own names. "checkout" is the hand-off to Stripe's card page — not a
 *  finish; "done" is the account made, and reads so (owner, 2026-10-28: "Finished" beside a visitor who had only gone
 *  to Stripe read as a sign-up). */
export const SIGNUP_SCREENS: Readonly<Record<string, string>> = {
  account: "Account",
  code: "Email code",
  company: "Company",
  plan: "Plan",
  google: "Google sign-in",
  checkout: "Stripe card page",
  done: "Account made",
};
export const screenName = (s: string) => SIGNUP_SCREENS[s] ?? (s ? s.replace(/^\w/, (c) => c.toUpperCase()) : "Sign-up form");

/** Every reason the form can refuse or fail, in the admin's words, and whose side it is. */
export const SIGNUP_REASONS: Readonly<Record<string, { words: string; side: SignupSide }>> = {
  // theirs — the form refused what was given
  missing: { words: "Left a box empty", side: "theirs" },
  email_invalid: { words: "Email isn't a valid address", side: "theirs" },
  password_short: { words: "Password too short", side: "theirs" },
  password_mismatch: { words: "Passwords didn't match", side: "theirs" },
  email_taken: { words: "Email already has an account", side: "theirs" },
  email_taken_google: { words: "Email already has an account (Google)", side: "theirs" },
  email_google: { words: "Email signs in with Google", side: "theirs" },
  email_disposable: { words: "Used a throwaway email", side: "theirs" },
  pending_taken: { words: "Email taken while signing up", side: "theirs" },
  biz_missing: { words: "No business name", side: "theirs" },
  addr_missing: { words: "No company address", side: "theirs" },
  trades_missing: { words: "No trade picked", side: "theirs" },
  wrong: { words: "Wrong code", side: "theirs" },
  burned: { words: "Code used up — needs a new one", side: "theirs" },
  expired: { words: "Code expired", side: "theirs" },
  gone: { words: "Sign-up timed out", side: "theirs" },
  pending_expired: { words: "Sign-up timed out before the plan", side: "theirs" },
  google_expired: { words: "Google sign-in expired", side: "theirs" },
  trial_needs_card: { words: "The trial asked for a card", side: "theirs" },
  refused: { words: "The form refused it", side: "theirs" },
  // ours — the visitor did nothing wrong
  server_error: { words: "Our server failed", side: "ours" },
  check_failed: { words: "Email check failed on our side", side: "ours" },
  start_failed: { words: "Couldn't reach our server", side: "ours" },
  email_send_failed: { words: "The code email didn't send", side: "ours" },
  offer_changed: { words: "The trial offer changed under them", side: "ours" },
  rate_limited: { words: "Blocked by our too-many-tries rule", side: "ours" },
  resend_limited: { words: "New code blocked by our limit", side: "ours" },
  resend_rejected: { words: "A new code couldn't be sent", side: "ours" },
  google_rejected: { words: "Google sign-in refused", side: "ours" },
  google_failed: { words: "Google sign-in broke on our side", side: "ours" },
  pending_failed: { words: "Saving the sign-up failed", side: "ours" },
  checkout_rejected: { words: "Checkout refused", side: "ours" },
  checkout_unavailable: { words: "Checkout unavailable", side: "ours" },
  trial_rejected: { words: "Trial start refused", side: "ours" },
  trial_unavailable: { words: "Trial start unavailable", side: "ours" },
  page_error: { words: "The page threw an error", side: "ours" },
  // outside — the browser's, never the verdict (problemOf folds outside_script, sent before 2026-10-30, into it)
  browser_error: { words: "Browser error, not ours", side: "outside" },
  outside_script: { words: "Browser error, not ours", side: "outside" },
  page_crash: { words: "The page crashed", side: "ours" },
  slow_form: { words: "The form was slow to start", side: "ours" },
  network: { words: "The connection dropped mid-step", side: "ours" },
};

export function reasonWords(reason: string): string {
  return SIGNUP_REASONS[reason]?.words ?? reason.replace(/_/g, " ");
}
export function reasonSide(reason: string): SignupSide {
  return SIGNUP_REASONS[reason]?.side ?? "theirs";
}

/** A refusal's reason from the words the server sent back (the actions answer in words, not codes). */
export function reasonOfMessage(message: string): string {
  const m = message || "";
  if (/on our side|something went wrong/i.test(m)) return "server_error";
  if (/couldn.t send the email/i.test(m)) return "email_send_failed";
  if (/offer changed/i.test(m)) return "offer_changed";
  if (/too many/i.test(m)) return "rate_limited";
  if (/temporary|throwaway|disposable/i.test(m)) return "email_disposable";
  if (/google sign-in expired/i.test(m)) return "google_expired";
  if (/sign(s)? in with google|continue with google/i.test(m)) return "email_google";
  if (/already (registered|has an account|in use|exists)|already have an account/i.test(m)) return "email_taken";
  if (/valid email/i.test(m)) return "email_invalid";
  if (/timed out|expired/i.test(m)) return "expired";
  return "refused";
}

/** What may leave the browser of a message the visitor saw: no addresses, no long digit runs, 140 characters. */
export function scrubWords(message: string): string {
  return String(message ?? "")
    .replace(/[^\s@"'<>,;]+@[^\s@"'<>,;]+\.[^\s@"'<>,;]+/g, "[email]")
    .replace(/\d{5,}/g, "[n]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
}

/** "42 s", "3 min", "1 h 5 min". */
export function durationWords(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`;
}
