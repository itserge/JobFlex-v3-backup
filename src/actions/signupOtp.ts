"use server";
// The passwordless sign-up's and "Email me a code"'s server actions (lib/signupOtp
// holds the machine). Every refusal is RETURNED as words, never thrown: a
// production build withholds a thrown server-action message (2026-10-07).
import { cookies } from "next/headers";
import { keptAdTool } from "@/lib/planSpotlight";
import { z } from "zod";
import { TRADE_TYPES } from "@/lib/tradeTypes";
import { trafficIdentitySchema } from "@/lib/traffic-capture-server";
import { signupTrialOffer } from "@/lib/trialOfferServer";
import { DISPOSABLE_EMAIL_MESSAGE, isDisposableEmail } from "@/lib/disposableEmail";
import { readGoogleSignup } from "@/lib/googleSignup";
import { mintSigninTicket } from "@/lib/signinTicket";
import { readSignupPlan, signupTrialMode } from "@/lib/trialPolicyServer";
import { db } from "@/lib/db";
import {
  GONE,
  OTP_DRAFT_COOKIE,
  SERVER_TROUBLE,
  deleteDraft,
  draftClock,
  loadDraft,
  newAccountBrake,
  newDraftToken,
  nextForUser,
  pendingSignupLive,
  pendingStateOf,
  saveDraft,
  sendCode,
  verifyCode,
  verifyLink,
  writeVerifiedPending,
  type OtpDraft,
  type OtpOutcome,
} from "@/lib/signupOtp";

const utmSchema = z
  .object({
    utm_source: z.string().trim().max(120).optional(),
    utm_medium: z.string().trim().max(120).optional(),
    utm_campaign: z.string().trim().max(120).optional(),
    utm_content: z.string().trim().max(120).optional(),
    utm_term: z.string().trim().max(120).optional(),
  })
  .optional()
  .catch(undefined);
/** What the register form carries besides the name and email. */
const carriedSchema = z.object({
  analytics: trafficIdentitySchema.optional().catch(undefined),
  displayedTrialDays: z.union([z.literal(3), z.literal(7)]).optional().catch(undefined),
  industry: z.enum(TRADE_TYPES).optional().catch(undefined),
  /** The tool the ad sold (lib/planSpotlight), parsed on the way in. */
  tool: z.string().max(40).optional().catch(undefined),
  utm: utmSchema,
  attribution: z
    .object({ kind: z.enum(["promo", "ref"]), code: z.string().trim().min(3).max(40) })
    .nullish()
    .catch(null),
  fbclid: z.string().regex(/^[\w-]{1,500}$/).optional().catch(undefined),
});
const startSchema = carriedSchema.extend({
  name: z.string().trim().min(1, "Enter your name.").max(120, "That name is too long."),
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(200),
});

type Sent = { ok: true; draft: string; email: string; resendAt: number; expiresAt: number };
type Refused = { ok: false; error: string; resendAt?: number };

async function draftCookie(): Promise<string | null> {
  try {
    return (await cookies()).get(OTP_DRAFT_COOKIE)?.value ?? null;
  } catch {
    return null;
  }
}

/** Step 1's Continue: the checks, the draft, the code email. The same answer
 *  for an address with an account and one without — the code signs the first
 *  in and starts the sign-up for the second. */
export async function startOtpSignup(raw: unknown): Promise<Sent | Refused> {
  try {
    const parsed = startSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message || "Check your name and email." };
    const data = parsed.data;
    if (isDisposableEmail(data.email)) return { ok: false, error: DISPOSABLE_EMAIL_MESSAGE };
    const offered = await signupTrialOffer();
    if (data.displayedTrialDays !== undefined && data.displayedTrialDays > offered.days) {
      return { ok: false, error: "Your trial offer changed. Reload this page to review the current offer before continuing." };
    }
    // The same address typed again (back from "Use a different email", a
    // reload): the same draft, so its resend clock still holds.
    const prevToken = await draftCookie();
    const prev = await loadDraft(prevToken);
    const reuse = prev && !prev.verifiedAt && prev.kind === "signup" && prev.email === data.email;
    const token = reuse && prevToken ? prevToken : newDraftToken();
    const draft: OtpDraft = {
      v: 1,
      kind: "signup",
      email: data.email,
      name: data.name,
      createdAt: reuse && prev ? prev.createdAt : Date.now(),
      industry: data.industry,
      tool: keptAdTool(data.tool),
      utm: data.utm,
      attribution: data.attribution ?? null,
      fbclid: data.fbclid,
      analytics: data.analytics,
      trialOffer: offered,
      code: reuse && prev ? prev.code : null,
      lastSentAt: reuse && prev ? prev.lastSentAt : 0,
      linkHash: reuse && prev ? prev.linkHash : null,
    };
    await saveDraft(token, draft);
    // A live code for this address went out seconds ago: show the code screen
    // with its clock rather than refuse the second Continue.
    if (reuse && draft.code && Date.now() - draft.lastSentAt < 30_000 && Date.now() < draft.code.exp) {
      return { ok: true, draft: token, email: draft.email, ...draftClock(draft) };
    }
    const sent = await sendCode(token, draft);
    if (!sent.ok) return sent;
    return { ok: true, draft: token, email: draft.email, resendAt: sent.resendAt, expiresAt: sent.expiresAt };
  } catch (err) {
    console.error("[otp] start failed:", err);
    return { ok: false, error: SERVER_TROUBLE };
  }
}

/** "Email me a code" on the sign-in page. Same words whether or not the
 *  address has an account; the email tells the truth. */
export async function startOtpLogin(raw: unknown): Promise<Sent | Refused> {
  try {
    const parsed = z.object({ email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(200) }).safeParse(raw);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message || "Enter a valid email address." };
    const token = newDraftToken();
    const draft: OtpDraft = { v: 1, kind: "login", email: parsed.data.email, name: "", createdAt: Date.now(), code: null, lastSentAt: 0, linkHash: null };
    await saveDraft(token, draft);
    const sent = await sendCode(token, draft);
    if (!sent.ok) return sent;
    return { ok: true, draft: token, email: draft.email, resendAt: sent.resendAt, expiresAt: sent.expiresAt };
  } catch (err) {
    console.error("[otp] login start failed:", err);
    return { ok: false, error: SERVER_TROUBLE };
  }
}

/** "Resend code": a new code and button; the old ones stop working. */
export async function resendOtpCode(draftToken: string): Promise<{ ok: true; resendAt: number; expiresAt: number } | Refused> {
  try {
    const d = await loadDraft(draftToken);
    if (!d) return { ok: false, error: GONE };
    if (d.verifiedAt) return { ok: false, error: "This email is already confirmed." };
    return await sendCode(draftToken, d);
  } catch (err) {
    console.error("[otp] resend failed:", err);
    return { ok: false, error: SERVER_TROUBLE };
  }
}

/** The six digits. A new address answers its pending signup's token (the plan
 *  step); an account answers a one-time sign-in ticket and where to go. */
export async function verifyOtpCode(draftToken: string, code: string): Promise<OtpOutcome> {
  try {
    return await verifyCode(draftToken, code);
  } catch (err) {
    console.error("[otp] verify failed:", err);
    return { ok: false, error: SERVER_TROUBLE };
  }
}

/** The email's button (/auth/register/code?k=…), in whatever browser opened it. */
export async function confirmOtpLink(secret: string): Promise<OtpOutcome & { query?: string }> {
  try {
    return await verifyLink(secret);
  } catch (err) {
    console.error("[otp] link failed:", err);
    return { ok: false, error: SERVER_TROUBLE };
  }
}

/** The waiting tab asks how its draft stands — on a timer, on coming back to
 *  the tab and on a back/forward-cache restore. The pending signup's token
 *  (or a sign-in ticket) is handed only to the browser holding the draft's
 *  cookie: the address bar alone is not enough. */
export async function otpDraftStatus(draftToken: string): Promise<
  | { stage: "gone" }
  | { stage: "code"; email: string; name: string; resendAt: number; expiresAt: number; burned: boolean }
  | { stage: "verified"; email: string; signupToken?: string; ticket?: string; next?: string }
> {
  try {
    const d = await loadDraft(draftToken);
    if (!d) return { stage: "gone" };
    if (!d.verifiedAt) return { stage: "code", email: d.email, name: d.name, ...draftClock(d), burned: !d.code };
    const own = (await draftCookie()) === draftToken;
    if (!own) return { stage: "verified", email: d.email };
    if (d.signupToken) return { stage: "verified", email: d.email, signupToken: d.signupToken };
    // Signed in from the email's button in another browser: this tab gets one
    // ticket of its own, once, within ten minutes.
    if (d.userId && !d.ticketHandedAt && Date.now() - d.verifiedAt < 10 * 60_000) {
      await saveDraft(draftToken, { ...d, ticketHandedAt: Date.now() });
      return { stage: "verified", email: d.email, ticket: await mintSigninTicket(d.userId), next: await nextForUser(d.userId) };
    }
    return { stage: "verified", email: d.email };
  } catch {
    return { stage: "gone" };
  }
}

/** THE PLAN STEP, before it sells and when a sale was refused (2026-10-14):
 *  how the pending signup stands. The full answer — an account exists for
 *  the address — only for the draft this browser's cookie names AND only for
 *  that draft's own pending signup, so it never says whether some other
 *  address has an account. Any other token (a Google arrival, a reload with
 *  `?signup=`) learns only whether its own intent is still alive. An expired
 *  draft is deleted; the browser drops its cookie. */
export async function otpPendingState(signupToken: string): Promise<
  { state: "live" } | { state: "expired"; name: string; email: string } | { state: "taken"; email: string }
> {
  try {
    const own = await draftCookie();
    const d = await loadDraft(own);
    if (own && d && d.kind === "signup" && d.verifiedAt && d.signupToken === signupToken) {
      const state = await pendingStateOf(d);
      if (state === "taken") return { state, email: d.email };
      if (state === "expired") {
        await deleteDraft(own);
        return { state, name: d.name, email: d.email };
      }
      return { state };
    }
    return (await pendingSignupLive(signupToken)) ? { state: "live" } : { state: "expired", name: "", email: "" };
  } catch {
    // A hiccup here must not block a sale: the payment path asks again.
    return { state: "live" };
  }
}

/** "Use a different email": the draft and its cookie go. */
export async function forgetOtpDraft(draftToken: string | null): Promise<{ ok: true }> {
  try {
    const own = await draftCookie();
    if (draftToken && own === draftToken) await deleteDraft(draftToken);
  } catch {
    /* nothing to forget */
  }
  return { ok: true };
}

/** Back from Google in the passwordless sign-up: Google proved the address and
 *  gave the name, so there is nothing left to ask — straight to the plan. */
export async function startOtpGoogleSignup(raw: unknown): Promise<{ ok: true; signupToken: string } | { ok: false; error: string; taken?: boolean }> {
  try {
    const parsed = carriedSchema.extend({ handle: z.string().min(20).max(80), name: z.string().trim().max(120).optional() }).safeParse(raw);
    if (!parsed.success) return { ok: false, error: "Your Google sign-in expired. Continue with Google again." };
    const data = parsed.data;
    const g = await readGoogleSignup(data.handle);
    if (!g) return { ok: false, error: "Your Google sign-in expired. Continue with Google again." };
    if (isDisposableEmail(g.email)) return { ok: false, error: DISPOSABLE_EMAIL_MESSAGE };
    if (await db.user.findUnique({ where: { email: g.email }, select: { id: true } })) {
      return { ok: false, error: "That email already has an account. Sign in with Google.", taken: true };
    }
    const offered = await signupTrialOffer();
    if (data.displayedTrialDays !== undefined && data.displayedTrialDays > offered.days) {
      return { ok: false, error: "Your trial offer changed. Reload this page to review the current offer before continuing." };
    }
    const braked = await newAccountBrake();
    if (braked) return { ok: false, error: braked };
    const signupToken = await writeVerifiedPending(
      {
        email: g.email,
        name: g.name || data.name || "",
        industry: data.industry,
        tool: keptAdTool(data.tool),
        utm: data.utm,
        attribution: data.attribution ?? null,
        analytics: data.analytics,
        trialOffer: offered,
      },
      { viaGoogle: true, image: g.image, autoPlan: (await readSignupPlan()).mode === "auto" },
    );
    return { ok: true, signupToken };
  } catch (err) {
    console.error("[otp] google start failed:", err);
    return { ok: false, error: SERVER_TROUBLE };
  }
}

/**
 * THE SHORT SIGN-UP WITH A CARD (owner, 2026-10-15, lib/signupAutoPlan): name and email — no password, no code; the
 * card at Stripe is the proof a real person is signing up, and the next screen is Stripe's card page for the plan.
 * Only while the plan rule is "auto" AND a card is required (asked here, never taken from the browser): without a
 * card the emailed code is the only check, so it stays. The address is unproven — the account waits for a sign-in
 * that proves it (lib/accountClaim).
 */
export async function startQuickSignup(raw: unknown): Promise<{ ok: true; signupToken: string; email: string } | { ok: false; error: string; taken?: boolean; needsCode?: boolean }> {
  try {
    const parsed = startSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message || "Check your name and email." };
    const data = parsed.data;
    const [plan, trial] = await Promise.all([readSignupPlan(), signupTrialMode()]);
    if (plan.mode !== "auto" || trial !== "card") return { ok: false, needsCode: true, error: "The sign-up just changed — we'll email you a code instead." };
    if (isDisposableEmail(data.email)) return { ok: false, error: DISPOSABLE_EMAIL_MESSAGE };
    if (await db.user.findUnique({ where: { email: data.email }, select: { id: true } })) {
      return { ok: false, error: "That email already has an account. Sign in instead.", taken: true };
    }
    const offered = await signupTrialOffer();
    if (data.displayedTrialDays !== undefined && data.displayedTrialDays > offered.days) {
      return { ok: false, error: "Your trial offer changed. Reload this page to review the current offer before continuing." };
    }
    const braked = await newAccountBrake();
    if (braked) return { ok: false, error: braked };
    const signupToken = await writeVerifiedPending(
      {
        email: data.email,
        name: data.name,
        industry: data.industry,
        tool: keptAdTool(data.tool),
        utm: data.utm,
        attribution: data.attribution ?? null,
        analytics: data.analytics,
        trialOffer: offered,
      },
      { viaGoogle: false, image: null, autoPlan: true, unproven: true },
    );
    return { ok: true, signupToken, email: data.email };
  } catch (err) {
    console.error("[otp] quick start failed:", err);
    return { ok: false, error: SERVER_TROUBLE };
  }
}
