import "server-only";
import type { AdTool } from "@/lib/planSpotlight";
// PASSWORDLESS SIGN-UP AND SIGN-IN BY EMAIL CODE (owner, 2026-10-10).
//
// Step 1 asks for a name and an email. The address is proven by a six-digit
// code emailed to it — or by the email's "Continue in browser" button, which
// does the same in whatever browser opens it — and then:
//   · a NEW address becomes a pending signup exactly like a Google one
//     (actions/signupCheckout's `signup:<token>` intent: no password, the
//     address marked as proven), and goes to the plan step; the account is
//     created where it always is, when checkout returns or the card-less trial
//     starts;
//   · an address that already has an account is simply signed in, by the
//     same one-time ticket the signup hand-off uses (lib/signinTicket).
// The sign-in page's "Email me a code" runs the same machine (kind "login").
//
// THE DRAFT. Everything typed and carried in (name, email, trade, utm_*,
// fbclid, the referral, the trial offer shown) is kept in a
// SyncState row `otp:<draft>` for a day, so leaving for the mail app, a reload
// or the in-app browser being thrown away loses nothing: the draft token rides
// in a cookie and in the page address. The code itself is never stored — only
// a salted hash, for ten minutes, burned after five wrong tries.
//
// THE BRAKES, all answered in words and never thrown (a production build
// withholds a thrown server-action message):
//   · five code emails an hour per address, sixty per network (IP), thirty
//     seconds between two for one draft;
//   · twenty NEW accounts an hour per network AND browser — the IP paired
//     with the User-Agent (owner, 2026-10-10: a mobile carrier puts thousands
//     of people behind one address) — counted when an address is proven, not
//     when a code is asked for (lib/signupBrake; the password sign-up keeps
//     its own counter under the same rule);
//   · nothing in any answer says whether an address has an account: the same
//     "we sent a code" for both, and the email says what is true.
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { HOUR, clientIp, rateLimitShared, retryInWords } from "@/lib/rateLimit";
import { hashToken, tokensEqual } from "@/lib/tokens";
import { mintSigninTicket } from "@/lib/signinTicket";
import { signupNetworkBrake } from "@/lib/signupBrake";
import { readSignupPlan, signupTrialMode } from "@/lib/trialPolicyServer";
import { claimIfUnclaimed } from "@/lib/accountClaim";
import { appBaseUrl } from "@/lib/appUrl";
import { renderEmail } from "@/lib/email/renderEmail";
import { buildOtpCode, buildOtpNoAccount } from "@/lib/email/build/otp";
import { sendEmail } from "@/lib/sdk/resend";
import { storedTrialOffer, type TrialOffer } from "@/lib/trialOffer";
import type { TradeType } from "@/lib/tradeTypes";
import type { PendingRecord } from "@/actions/signupCheckout";
import { pendingSignupAlive } from "@/lib/pendingSignup";
import { keepQaCode, qaCaptures } from "@/lib/qaTestMode";

export const OTP_MINUTES = 10;
const CODE_TTL_MS = OTP_MINUTES * 60_000;
export const OTP_MAX_TRIES = 5;
export const OTP_RESEND_MS = 30_000;
const MAILS_PER_ADDRESS_HOUR = 5;
const MAILS_PER_NETWORK_HOUR = 60;
const DRAFT_TTL_MS = 24 * HOUR;
export { OTP_DRAFT_COOKIE } from "@/lib/signupMode";
export const SUPPORT_REPLY_TO = "support@jobflex.app";

export type OtpKind = "signup" | "login";
type Utm = Partial<Record<"utm_source" | "utm_medium" | "utm_campaign" | "utm_content" | "utm_term", string>>;

export interface OtpDraft {
  v: 1;
  kind: OtpKind;
  email: string;
  /** "" on a sign-in. */
  name: string;
  createdAt: number;
  industry?: TradeType;
  /** The tool the ad sold (lib/planSpotlight keptAdTool): a Classic key, or one of the new plans' keys. */
  tool?: AdTool;
  utm?: Utm;
  attribution?: { kind: "promo" | "ref"; code: string } | null;
  /** The ad's click id (`?fbclid=`), back on the register address the emailed button opens. */
  fbclid?: string;
  analytics?: unknown;
  trialOffer?: TrialOffer;
  /** The salted hash of the live code; null once used, burned or replaced by nothing. */
  code: { salt: string; hash: string; exp: number; tries: number } | null;
  lastSentAt: number;
  /** sha256 of the emailed button's secret (row `otp-link:<hash>`). */
  linkHash: string | null;
  /** A sign-in for an address with no account: the email said so and carried no code. */
  noAccount?: boolean;
  verifiedAt?: number;
  via?: "code" | "link";
  /** The pending signup a proven new address became. */
  signupToken?: string;
  /** The account a proven address already had. */
  userId?: string;
  /** When the waiting tab was handed its sign-in ticket after the link was used elsewhere. */
  ticketHandedAt?: number;
}

export type OtpOutcome =
  | { ok: true; kind: "signup"; signupToken: string; email: string }
  | { ok: true; kind: "signin"; ticket: string; next: string; email: string }
  | { ok: false; error: string; burned?: boolean; expired?: boolean; gone?: boolean };

const draftKey = (token: string) => `otp:${token}`;
const linkKey = (hash: string) => `otp-link:${hash}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GONE = "This sign-up timed out. Start again with your email.";
export const SERVER_TROUBLE = "Something went wrong on our side. Try again in a minute.";

export function newDraftToken(): string {
  return randomUUID();
}

export async function loadDraft(token: string | null | undefined): Promise<OtpDraft | null> {
  if (!token || !UUID.test(token)) return null;
  const row = await db.syncState.findUnique({ where: { key: draftKey(token) } }).catch(() => null);
  if (!row) return null;
  try {
    const d = JSON.parse(row.cursor) as OtpDraft;
    if (d?.v !== 1 || !d.email || Date.now() - (d.createdAt ?? 0) > DRAFT_TTL_MS) return null;
    return d;
  } catch {
    return null;
  }
}

export async function saveDraft(token: string, d: OtpDraft): Promise<void> {
  const cursor = JSON.stringify(d);
  await db.syncState.upsert({ where: { key: draftKey(token) }, update: { cursor }, create: { key: draftKey(token), cursor } });
}

export async function deleteDraft(token: string): Promise<void> {
  const d = await loadDraft(token);
  if (d?.linkHash) await db.syncState.deleteMany({ where: { key: linkKey(d.linkHash) } }).catch(() => {});
  await db.syncState.deleteMany({ where: { key: draftKey(token) } }).catch(() => {});
}

const codeHash = (salt: string, code: string) => hashToken(`${salt}:${code}`);

/** When the resend button may be pressed again, and when the code stops working. */
export function draftClock(d: OtpDraft): { resendAt: number; expiresAt: number } {
  return { resendAt: d.lastSentAt + OTP_RESEND_MS, expiresAt: d.code?.exp ?? 0 };
}

/**
 * A fresh code (and button) for this draft, emailed. The old code and the old
 * button stop working. Returns the clock, or the brake's words.
 */
export async function sendCode(
  token: string,
  d: OtpDraft,
): Promise<{ ok: true; resendAt: number; expiresAt: number } | { ok: false; error: string; resendAt?: number }> {
  const now = Date.now();
  if (d.lastSentAt && now - d.lastSentAt < OTP_RESEND_MS) {
    const resendAt = d.lastSentAt + OTP_RESEND_MS;
    return { ok: false, error: `Wait ${Math.ceil((resendAt - now) / 1000)} s before sending another code.`, resendAt };
  }
  const ip = await clientIp();
  const [byAddress, byNetwork] = await Promise.all([
    rateLimitShared(`otp-mail:${d.email}`, MAILS_PER_ADDRESS_HOUR, HOUR),
    rateLimitShared(`otp-mail-ip:${ip}`, MAILS_PER_NETWORK_HOUR, HOUR),
  ]);
  if (!byAddress.ok) return { ok: false, error: `Too many codes for this address. Try again in ${retryInWords(byAddress.retryAfterMs)}.` };
  if (!byNetwork.ok) return { ok: false, error: `Too many codes from this network. Try again in ${retryInWords(byNetwork.retryAfterMs)}.` };

  const user = await db.user.findUnique({ where: { email: d.email }, select: { id: true, name: true } });
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const salt = randomBytes(16).toString("hex");
  const secret = randomBytes(32).toString("base64url");
  const linkHash = hashToken(secret);
  if (d.linkHash) await db.syncState.deleteMany({ where: { key: linkKey(d.linkHash) } }).catch(() => {});
  const next: OtpDraft = {
    ...d,
    code: { salt, hash: codeHash(salt, code), exp: now + CODE_TTL_MS, tries: 0 },
    lastSentAt: now,
    linkHash,
    noAccount: d.kind === "login" && !user ? true : undefined,
  };
  await saveDraft(token, next);
  await db.syncState.upsert({ where: { key: linkKey(linkHash) }, update: { cursor: token }, create: { key: linkKey(linkHash), cursor: token } });

  // QA Lab test mode (lib/qaTestMode): a @qa.jobflex.test address gets no
  // email — the code (and the button's link) is kept for GET /api/qa/otp.
  if (qaCaptures(d.email)) {
    await keepQaCode({ email: d.email, kind: d.kind, code: next.noAccount ? null : code, link: next.noAccount ? null : `/auth/register/code?k=${secret}`, draft: token, at: now });
    // The mail log files it as skipped, the same as sendEmail's own QA gate.
    const { recordEmail } = await import("@/lib/emailLog");
    await recordEmail({ to: d.email, subject: `${d.kind === "login" ? "Sign-in" : "Sign-up"} code — kept for the QA Lab`, kind: "otp", transport: "skipped", status: "skipped", providerId: "qa-test-mode:skipped", durationMs: 0 });
    return { ok: true, ...draftClock(next) };
  }

  const base = (await appBaseUrl()).replace(/\/$/, "");
  const doc = next.noAccount
    ? buildOtpNoAccount({ email: d.email, href: `${base}/auth/register?flow=otp` })
    : buildOtpCode({ code, email: d.email, name: d.name || user?.name || null, minutes: OTP_MINUTES, href: `${base}/auth/register/code?k=${secret}` });
  const { subject, html, text } = renderEmail(doc);
  // Local only: the code in the server's log, beside EMAIL_DEV_OUTBOX's copy.
  if (process.env.NODE_ENV !== "production") console.info(`[otp] ${d.kind} code for ${d.email}: ${next.noAccount ? "(no account — no code sent)" : code}`);
  // The shared sender (lib/sdk/resend sendEmail): Resend when RESEND_API_KEY is
  // set, else SMTP (production: Gmail SMTP, from app@jobflex.app). The send is
  // awaited — Continue waits for it — so its time is logged, without the address.
  const sentFrom = Date.now();
  try {
    await sendEmail({ to: d.email, subject, html, text, replyTo: SUPPORT_REPLY_TO, kind: "otp" });
    console.info(`[otp] ${d.kind} ${next.noAccount ? "no-account" : "code"} email handed to the transport in ${Date.now() - sentFrom} ms`);
  } catch (err) {
    console.error("[otp] code email failed:", err);
    return { ok: false, error: "Couldn't send the email. Check the address and try again." };
  }
  return { ok: true, ...draftClock(next) };
}

/** The six digits typed on the code screen. */
export async function verifyCode(token: string, raw: string): Promise<OtpOutcome> {
  const code = String(raw ?? "").replace(/\D/g, "");
  if (code.length !== 6) return { ok: false, error: "Enter the 6-digit code from the email." };
  const d = await loadDraft(token);
  if (!d) return { ok: false, error: GONE, gone: true };
  if (d.verifiedAt) return outcomeOf(d);
  if (!d.code) return { ok: false, error: "That code can't be used any more. Send a new code.", burned: true };
  if (Date.now() > d.code.exp) return { ok: false, error: `That code expired — codes last ${OTP_MINUTES} minutes. Send a new code.`, expired: true };
  const right = !d.noAccount && tokensEqual(codeHash(d.code.salt, code), d.code.hash);
  if (!right) {
    const tries = d.code.tries + 1;
    if (tries >= OTP_MAX_TRIES) {
      if (d.linkHash) await db.syncState.deleteMany({ where: { key: linkKey(d.linkHash) } }).catch(() => {});
      await saveDraft(token, { ...d, code: null, linkHash: null });
      return { ok: false, error: `That code is used up after ${OTP_MAX_TRIES} wrong tries. Send a new code.`, burned: true };
    }
    await saveDraft(token, { ...d, code: { ...d.code, tries } });
    const left = OTP_MAX_TRIES - tries;
    return { ok: false, error: `That code isn't right. ${left} ${left === 1 ? "try" : "tries"} left.` };
  }
  return finalize(token, d, "code");
}

/** The email's "Continue in browser" button, opened in any browser. */
export async function verifyLink(secret: string): Promise<OtpOutcome & { query?: string }> {
  if (!secret || secret.length < 20 || secret.length > 200) return { ok: false, error: "That link is not valid." };
  const hash = hashToken(secret);
  const row = await db.syncState.findUnique({ where: { key: linkKey(hash) } }).catch(() => null);
  if (!row) return { ok: false, error: "That link was already used or a newer code replaced it. Use the latest email, or start again.", gone: true };
  const d = await loadDraft(row.cursor);
  if (!d || d.linkHash !== hash) return { ok: false, error: GONE, gone: true };
  if (!d.code || Date.now() > d.code.exp) return { ok: false, error: `That link expired — it lasts ${OTP_MINUTES} minutes. Ask for a new code.`, expired: true };
  const res = await finalize(row.cursor, d, "link");
  return res.ok && res.kind === "signup" ? { ...res, query: carriedQuery(d) } : res;
}

/** The trade and campaign, back on the register address the button opens. */
function carriedQuery(d: OtpDraft): string {
  const q = new URLSearchParams();
  if (d.industry) q.set("industry", d.industry.toLowerCase());
  if (d.tool) q.set("tool", d.tool);
  for (const [k, v] of Object.entries(d.utm ?? {})) if (v) q.set(k, v);
  if (d.fbclid) q.set("fbclid", d.fbclid);
  return q.toString();
}

/** What a proven draft led to, again (a second press, a reload). */
function outcomeOf(d: OtpDraft): OtpOutcome {
  if (d.signupToken) return { ok: true, kind: "signup", signupToken: d.signupToken, email: d.email };
  return { ok: false, error: "This code was already used. Sign in to continue.", burned: true };
}

/** The address is proven: a sign-in for an account, a pending signup for a new address. */
async function finalize(token: string, d: OtpDraft, via: "code" | "link"): Promise<OtpOutcome> {
  const user = await db.user.findUnique({ where: { email: d.email }, select: { id: true, emailVerified: true } });
  if (user) {
    if (d.linkHash) await db.syncState.deleteMany({ where: { key: linkKey(d.linkHash) } }).catch(() => {});
    await saveDraft(token, { ...d, code: null, linkHash: null, verifiedAt: Date.now(), via, userId: user.id });
    if (!user.emailVerified) await db.user.update({ where: { id: user.id }, data: { emailVerified: new Date() } }).catch(() => {});
    // The code proved the address: an account from the short sign-up is theirs now (lib/accountClaim).
    await claimIfUnclaimed(user.id);
    return { ok: true, kind: "signin", ticket: await mintSigninTicket(user.id), next: await nextForUser(user.id), email: d.email };
  }
  if (d.kind === "login" || d.noAccount) return { ok: false, error: "That code isn't right." };
  // A new account from this network: the five-an-hour brake counts here. The
  // code stays good while it is refused — the visitor can try again within it.
  const braked = await newAccountBrake();
  if (braked) return { ok: false, error: braked };
  const signupToken = await writeVerifiedPending(d, { viaGoogle: false, image: null, autoPlan: (await readSignupPlan()).mode === "auto" });
  if (d.linkHash) await db.syncState.deleteMany({ where: { key: linkKey(d.linkHash) } }).catch(() => {});
  await saveDraft(token, { ...d, code: null, linkHash: null, verifiedAt: Date.now(), via, signupToken });
  return { ok: true, kind: "signup", signupToken, email: d.email };
}

/** Where a signed-in account goes: the plan picker when the owner's shop has
 *  no plan, the dashboard otherwise. While the sign-up opens the card page by
 *  itself ("auto" with a card), that owner goes straight to Stripe's card page
 *  instead (app/dashboard/upgrade/checkout — its back arrow is the plan cards). */
export async function nextForUser(userId: string): Promise<string> {
  try {
    const m = await db.membership.findFirst({
      where: { userId, organization: { deletedAt: null } },
      orderBy: { createdAt: "asc" },
      select: { role: true, organization: { select: { subscription: { select: { id: true } } } } },
    });
    if (m?.role === "OWNER" && !m.organization.subscription) {
      const [rule, trial] = await Promise.all([readSignupPlan(), signupTrialMode()]);
      return rule.mode === "auto" && trial === "card" ? "/dashboard/upgrade/checkout?reason=relogin" : "/dashboard/upgrade";
    }
  } catch {
    /* the dashboard sorts it out */
  }
  return "/dashboard";
}

/**
 * The pending signup a proven address becomes — the same `signup:<token>`
 * intent actions/signupCheckout writes for a password or Google sign-up, read
 * by the plan step, /api/checkout/signup and the account creation. The
 * business is named after the person for now (`nameUnset`), and its trade is
 * the one the landing was opened on, or none.
 */
export async function writeVerifiedPending(
  d: Pick<OtpDraft, "email" | "name" | "industry" | "tool" | "utm" | "attribution" | "analytics" | "trialOffer">,
  opts: { viaGoogle: boolean; image: string | null; autoPlan?: boolean; unproven?: boolean },
): Promise<string> {
  const token = randomUUID();
  const name = d.name.trim() || d.email.split("@")[0];
  const record: PendingRecord = {
    trialOffer: d.trialOffer ? storedTrialOffer(d.trialOffer) : { variant: "b", days: 7 },
    analytics: d.analytics as PendingRecord["analytics"],
    name,
    businessName: name,
    email: d.email,
    tradeTypes: d.industry ? [d.industry] : [],
    landingIndustry: d.industry,
    landingTool: d.tool,
    signupVariant: "e",
    utm: d.utm,
    attribution: d.attribution ?? null,
    customPages: [],
    hashedPassword: null,
    viaGoogle: opts.viaGoogle,
    image: opts.image,
    createdAt: Date.now(),
    // The short sign-up with a card proves nothing about the address (lib/accountClaim).
    ...(opts.unproven ? { quick: true } : { emailVerifiedAt: Date.now() }),
    nameUnset: true,
    signupMode: "passwordless",
    ...(opts.autoPlan ? { autoPlan: true } : {}),
  } as PendingRecord;
  await db.syncState.upsert({
    where: { key: `signup:${token}` },
    update: { cursor: JSON.stringify(record) },
    create: { key: `signup:${token}`, cursor: JSON.stringify(record) },
  });
  return token;
}

/** One brake on the new-account count, shared by the Google arrival. */
export async function newAccountBrake(): Promise<string | null> {
  return signupNetworkBrake("otp-signup");
}

/** What the register page opens on for a draft (from `?d=` or the cookie):
 *  the code screen with its clock, or — for the browser holding the cookie —
 *  the plan step of the pending signup the draft became. Null: step 1.
 *
 *  THE RETURN A DAY LATER (2026-10-14): the plan step opens only over an
 *  intent the payment still honours (lib/pendingSignup — the same rule). One
 *  that ran out is "expired": the draft is deleted and step 1 opens with the
 *  name and email filled (the browser drops the cookie). An address that has
 *  an account by now is "taken": the plan step says so and offers sign-in —
 *  only ever for the draft this browser's own cookie names, so no address is
 *  confirmed to anybody who did not prove it from here. */
export interface OtpRestore {
  draft: string;
  name: string;
  email: string;
  stage: "code" | "verified" | "expired" | "taken";
  resendAt: number;
  expiresAt: number;
  /** The server's clock when this was read. The code screen starts its resend
   *  countdown from it, so the server's HTML and the hydrating page print the
   *  same "Resend code in N s" (a Date.now() on each side drifted a second
   *  apart — QA F-c53b585f); the page ticks on its own clock after mount. */
  now: number;
  burned: boolean;
  signupToken: string | null;
}
export async function draftRestore(token: string | null, cookieToken: string | null): Promise<OtpRestore | null> {
  const t = token || cookieToken;
  const d = await loadDraft(t);
  if (!t || !d || d.kind !== "signup") return null;
  const own = cookieToken === t;
  if (d.verifiedAt) {
    if (!own || !d.signupToken) return null;
    const at = { draft: t, name: d.name, email: d.email, resendAt: 0, expiresAt: 0, now: Date.now(), burned: true };
    const state = await pendingStateOf(d);
    if (state === "taken") return { ...at, stage: "taken", signupToken: null };
    if (state === "expired") {
      await deleteDraft(t);
      return { ...at, stage: "expired", signupToken: null };
    }
    return { ...at, stage: "verified", signupToken: d.signupToken };
  }
  return { draft: t, name: d.name, email: d.email, stage: "code", ...draftClock(d), now: Date.now(), burned: !d.code, signupToken: null };
}

/** How the pending signup a proven draft became stands: the address has an
 *  account by now (this signup finished, Google, a second tab), the intent
 *  ran out, or the plan step can sell. Callers check the draft is the
 *  browser's own before they say "taken". */
export async function pendingStateOf(d: OtpDraft): Promise<"live" | "expired" | "taken"> {
  if (await db.user.findUnique({ where: { email: d.email }, select: { id: true } })) return "taken";
  return d.signupToken && (await pendingSignupLive(d.signupToken)) ? "live" : "expired";
}

/** The intent behind a token, by the payment's own rule (lib/pendingSignup). */
export async function pendingSignupLive(signupToken: string): Promise<boolean> {
  const row = await db.syncState.findUnique({ where: { key: `signup:${signupToken}` } }).catch(() => null);
  if (!row) return false;
  try {
    return pendingSignupAlive(JSON.parse(row.cursor));
  } catch {
    return false;
  }
}
