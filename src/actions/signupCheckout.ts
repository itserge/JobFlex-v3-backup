"use server";

// PAY FIRST, THEN THE ACCOUNT EXISTS.
//
// Until 2026-08-28 the flow created the workspace at the end of step 2 and only
// then showed the plan — so a visitor who never subscribed still had an account,
// a login and an org that would show up in the Lead Center's shop list. The
// owner's rule now: no subscription, no account.
//
// HOW IT WORKS WITHOUT INVENTING A TABLE
// A signup that has not been paid for is not a User and not an Organization; it
// is a PENDING intent. It is parked in `SyncState` — the app's existing
// key→string store, the same one the Lead Center's routing mode uses — under
// `signup:<token>`, holding the details plus a BCRYPT HASH of the password (the
// plaintext never leaves the browser's request, and nothing readable is stored).
// The row expires on read; a stale one is simply refused.
//
//   1. `startPendingSignup` validates and parks the intent, returns a token.
//   2. The plan step asks `/api/checkout/signup` for a Stripe Checkout session
//      carrying that token; Stripe collects the card and starts the trial.
//   3. `completePendingSignup(token, sessionId)` verifies the session with
//      Stripe, creates Organization + owner User + Membership, records the
//      Subscription, and consumes the token.
//
// The skip path (testing only) calls `completePendingSignup(token, null)`,
// which creates the same account with no subscription attached.
import { alertSignup } from "@/lib/adminAlerts";
import { HOUSE_SLUG } from "@/lib/webEstimator";
import { randomUUID, randomBytes, createHash } from "crypto";
import { SPOTLIGHT_KEY } from "@/lib/planSpotlightServer";
import { parseSpotlightTool } from "@/lib/planSpotlight";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { ensureDefaultFollowUpRules } from "@/lib/followUps/defaults";
import { TRADE_TYPES, type TradeType } from "@/lib/tradeTypes";
import type Stripe from "stripe";
import { bindAttributionToOrg } from "@/lib/attribution";
import { syncSubscriptionFromStripe } from "@/lib/stripeSync";
import { subscriptionPeriodEndDate } from "@/lib/stripeCompat";
import { getStripeClient, isStripeEnabled } from "@/lib/sdk/stripe";
import { getPlanBySlug } from "@/lib/planCatalogServer";
import { CUSTOM_PLAN_SLUG, normalizeCustomPages } from "@/lib/customPlan";
import { CUSTOM_PLAN_OFF_SALE, customPlanOffered } from "@/lib/customPlanFlag";
import { stampCustomSubscription } from "@/lib/customBilling";
import { SubscriptionStatus } from "@/lib/prismaEnums";
import { enforceRateLimit, clientIp, HOUR } from "@/lib/rateLimit";
import { mintSigninTicket } from "@/lib/signinTicket";
import { readGoogleSignup } from "@/lib/googleSignup";
import { settleReferralsForSignupOrg } from "@/lib/referralRewards";
import { after } from "next/server";
import { isQaEmail } from "@/lib/qaEmail";
/** A QA Lab sign-up (its address, or its test number): no analytics. */
const isQaSignup = (rec: { email?: string; phone?: string }) => isQaEmail(rec.email) || isQaPhone(rec.phone);
import { captureSignupOutcome, captureTrafficEvent, identityFromCookie, trafficIdentitySchema } from "@/lib/traffic-capture-server";
import { cookies, headers } from "next/headers";
import { TRAFFIC_EVENTS } from "@/lib/traffic-contract";
import { cancelDeclinedSubscription, checkSignupCard, noteCardHoldAccount, readCardHold, refuseSignupCheckout } from "@/lib/signupCardHold";
import { isStripeEmailCode, prettyUsPhone, STRIPE_EMAIL_LINES } from "@/lib/phoneLoginShared";
import { linkPhoneLogin, phoneAccountOf, releaseStalePhoneLogin } from "@/lib/phoneLogin";
import { markPhoneSetupDue } from "@/lib/phoneSetup";
import { addressTaken, keepWelcomeLater, markEmailUnproven, releaseUnprovenEmail } from "@/lib/emailProof";
import { isQaPhone } from "@/lib/qaEmail";
import { CARD_DECLINED_LINE } from "@/lib/signupCardHoldWords";
import { orgNameUnsetKey } from "@/lib/orgName";
import { signupNetworkBrake } from "@/lib/signupBrake";
import type { SignupModeLabel } from "@/lib/signupMode";
import { sendWelcomeFirstEstimate } from "@/lib/email/welcome";
import { trackActivation } from "@/lib/activation-events";
import { signupTrialState } from "@/lib/trialPolicyServer";
import { createCardlessSubscription, nameOrgOnSubscription } from "@/lib/cardlessTrial";
import { writeCardlessRecord } from "@/lib/trialState";
import { cardlessTrialRefusal, markCardlessTrialUsed, trialRequestsPerIpHour } from "@/lib/trialGuard";
import { DISPOSABLE_EMAIL_MESSAGE, isDisposableEmail } from "@/lib/disposableEmail";
import { cardlessTrialsPaused, noteCardlessTrialStarted, TRIALS_PAUSED_MESSAGE } from "@/lib/trialDailyCap";
import { appBaseUrl } from "@/lib/appUrl";
import { renderEmail } from "@/lib/email/renderEmail";
import { sendEmail } from "@/lib/sdk/resend";
import { signupTrialOffer } from "@/lib/trialOfferServer";
import { storedTrialOffer, TRIAL_TEST_ENDED, type TrialOffer } from "@/lib/trialOffer";
import { buildTrialConfirm } from "@/lib/email/build/trial";
import { pendingSignupAlive } from "@/lib/pendingSignup";
import { markUnclaimed } from "@/lib/accountClaim";
import { autoPlanWelcomeKey } from "@/lib/autoPlanWelcome";
import { timezoneFor } from "@/lib/usTimezone";
import { signupPlanRefusal } from "@/lib/signupPricing";
import { firstToolsRecord, pickWire, toolsBuild, toolsSignupPick } from "@/lib/toolPlans/cards";
import { isToolId, toolPlanBySlug, type ToolId } from "@/lib/toolPlans/shared";
import { writeToolsRecord } from "@/lib/toolPlans/billing";

const pendingSchema = z.object({
  analytics: trafficIdentitySchema.optional().catch(undefined),
  displayedTrialDays: z.union([z.literal(3), z.literal(7)]).optional(),
  name: z.string().trim().min(1, "Enter your name").max(120),
  businessName: z.string().trim().min(1, "Enter your business name").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  // One of the two: a password, or the handle of a parked Google identity
  // (lib/googleSignup) whose email must match.
  password: z.string().min(8, "Password must be at least 8 characters").max(200).optional(),
  googleToken: z.string().min(20).max(80).optional(),
  companyAddress: z.string().trim().max(240).optional(),
  companyPhone: z.string().trim().max(40).optional(),
  tradeTypes: z.array(z.enum(TRADE_TYPES)).max(TRADE_TYPES.length).optional(),
  otherTrade: z.string().trim().max(80).optional(),
  /** The trade hero the visitor arrived through (`?industry=` on the landing),
   *  kept next to the promo/referral attribution so the signup can be read
   *  back to its campaign. Advisory only — never overrides tradeTypes. */
  landingIndustry: z.enum(TRADE_TYPES).optional(),
  /** The tool the ad sold (lib/planSpotlight) — written on the company so the
   *  Subscription page keeps marking it. */
  landingTool: z.string().max(40).optional(),
  /** The signup flow, recorded on the organization and carried on the
   *  completion event. "e" — landing-e's arm (pass A, 2026-09-11) — is the
   *  only flow since 2026-09-16; older organizations carry null ("d"). */
  signupVariant: z.enum(["e"]).optional(),
  /** The sign-up's mode, as the reports split completions (lib/signupMode):
   *  the password form sends "3-step" or "2-step"; the passwordless one writes
   *  its own intents (lib/signupOtp). */
  signupMode: z.enum(["3-step", "2-step"]).optional().catch(undefined),
  /** The visit's utm_*, as the landing carried them (CRO stage 1, 2026-09-09). */
  utm: z
    .object({
      utm_source: z.string().trim().max(120).optional(),
      utm_medium: z.string().trim().max(120).optional(),
      utm_campaign: z.string().trim().max(120).optional(),
      utm_content: z.string().trim().max(120).optional(),
      utm_term: z.string().trim().max(120).optional(),
    })
    .optional(),
  attribution: z
    .object({ kind: z.enum(["promo", "ref"]), code: z.string().trim().min(3).max(40) })
    .nullish(),
  /** Add-on pages, when the custom plan is the one being bought. Stored with
   *  the intent so checkout and account creation price and record the SAME
   *  selection — the client never gets to name a price. */
  customPages: z.array(z.string().max(40)).max(40).optional(),
});

export type PendingRecord = z.infer<typeof pendingSchema> extends infer T
  ? Omit<Extract<T, object>, "password" | "googleToken" | "signupMode"> & {
      /** Null for a Google-backed signup — the finished account signs in with Google. */
      hashedPassword: string | null;
      viaGoogle?: boolean;
      image?: string | null;
      createdAt: number;
      trialOffer?: TrialOffer;
      /** Set by requestCardlessTrial: the plan the card-less trial is for, and
       *  when the confirmation link went out (the intent then lives 24 hours). */
      cardless?: { planSlug: string; interval?: "MONTH" | "YEAR"; requestedAt: number; /** The new plans' pick: tool ids, comma-separated, the first the main tool ("" none). */ mainTool?: string | null };
      /** The passwordless sign-up (lib/signupOtp, 2026-10-10): when the address
       *  was proven — by the emailed code or link, or by Google — before this
       *  intent was written. Only that server code sets it; the card-less
       *  trial then starts without a second email (startVerifiedCardlessTrial). */
      emailVerifiedAt?: number;
      /** The business name is the person's name for now (no company name was
       *  asked): the org is marked `orgNameUnset:<orgId>` (lib/orgName). */
      nameUnset?: boolean;
      /** Which of the owner's three sign-ups this came through (lib/signupMode). */
      signupMode?: SignupModeLabel;
      /** A SIGN-UP BY TEXT (owner, 2026-11-12, lib/signupOtp channel "sms"): the US mobile (E.164) a texted code
       *  proved, and when. Its `email` is "" until the return from Stripe's card page fills it with the address typed
       *  there (completePendingSignup); the account then signs in by this number too (lib/phoneLogin). */
      phone?: string;
      phoneVerifiedAt?: number;
      /** Straight to Professional (lib/signupAutoPlan): the org gets the welcome card that says the plan can change. */
      autoPlan?: boolean;
      /** The short sign-up with a card: no code, so the address is unproven until a sign-in proves it (lib/accountClaim). */
      quick?: boolean;
    }
  : never;

function key(token: string): string {
  return `signup:${token}`;
}

/**
 * Step 2's "Create account". Every refusal is RETURNED, never thrown: a
 * production build withholds a server action's thrown message (only a digest
 * crosses), so step 2 read "Minified React error #441" instead of the brake's
 * "Too many sign-ups. Try again in 34 minutes." (prod, 2026-10-07).
 */
export async function startPendingSignup(raw: unknown): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  const parsed = pendingSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message || "Check this step and try again." };
  const data = parsed.data;
  const offered = await signupTrialOffer();
  // A stale tab must see changed terms before any shorter trial is created
  // (a tab still showing 3 days from the ended test simply gets the 7).
  if (data.displayedTrialDays !== undefined && data.displayedTrialDays > offered.days) {
    return { ok: false, error: "Your trial offer changed. Reload this page to review the current offer before continuing." };
  }
  // Twenty an hour per IP + User-Agent (lib/signupBrake; was five per IP).
  const braked = await signupNetworkBrake("signup-start");
  if (braked) return { ok: false, error: braked };

  // Google-backed: the address is the one Google verified, whatever the form
  // says, and there is no password to hash.
  let google: { email: string; image: string | null } | null = null;
  if (data.googleToken) {
    const g = await readGoogleSignup(data.googleToken);
    if (!g) return { ok: false, error: "Your Google sign-in expired. Continue with Google again." };
    google = { email: g.email, image: g.image };
    data.email = g.email;
  } else if (!data.password) {
    return { ok: false, error: "Choose a password, or continue with Google." };
  }
  // Step 1 refused a throwaway inbox already; this is the server's own word.
  if (isDisposableEmail(data.email)) return { ok: false, error: DISPOSABLE_EMAIL_MESSAGE };

  // Same answer as registration gives, at the same point in the flow: you
  // cannot hide that an address is taken when the next step would collide.
  const existing = await db.user.findUnique({ where: { email: data.email }, select: { id: true } });
  if (existing) {
    return { ok: false, error: "That email is already registered. Try signing in instead." };
  }

  const token = randomUUID();
  const record: PendingRecord = {
    trialOffer: data.displayedTrialDays === undefined ? { variant: "b", days: 7 } : offered,
    analytics: data.analytics,
    name: data.name,
    businessName: data.businessName,
    email: data.email,
    companyAddress: data.companyAddress,
    companyPhone: data.companyPhone,
    tradeTypes: data.tradeTypes,
    otherTrade: data.otherTrade,
    landingIndustry: data.landingIndustry,
    signupVariant: data.signupVariant,
    signupMode: data.signupMode,
    utm: data.utm,
    attribution: data.attribution ?? null,
    customPages: normalizeCustomPages(data.customPages),
    hashedPassword: google ? null : await bcrypt.hash(data.password as string, 10),
    viaGoogle: Boolean(google),
    image: google?.image ?? null,
    createdAt: Date.now(),
  } as PendingRecord;

  await db.syncState.upsert({
    where: { key: key(token) },
    update: { cursor: JSON.stringify(record) },
    create: { key: key(token), cursor: JSON.stringify(record) },
  });
  return { ok: true, token };
}

/** Read a live intent, or null when it is missing or stale. */
export async function readPendingSignup(token: string): Promise<{
  /** "" for a sign-up by text until the card page gives the address. */
  email: string;
  /** A sign-up by text: the proven number (E.164); null otherwise. */
  phone: string | null;
  /** The person's name and the trade they arrived on: the app behind the sign-up (lib/signupView) keeps showing them
   *  after a trip to the card page and back. */
  name: string;
  landingIndustry: TradeType | null;
  /** The ad's `?tool=` key as the sign-up kept it (the new plans' card page falls back to it for the main tool). */
  landingTool: string | null;
  businessName: string;
  trialOffer: TrialOffer;
  customPages: string[];
  attribution: { kind: "promo" | "ref"; code: string } | null;
} | null> {
  const rec = await loadPending(token);
  return rec
    ? {
        email: rec.email,
        phone: rec.phone ?? null,
        name: rec.name,
        landingIndustry: rec.landingIndustry ?? null,
        landingTool: rec.landingTool ?? null,
        businessName: rec.businessName,
        trialOffer: storedTrialOffer(rec.trialOffer),
        customPages: normalizeCustomPages(rec.customPages),
        attribution: rec.attribution ?? null,
      }
    : null;
}

/* THE RELOAD PROBLEM. The intent is spent by its first completion, so a
   reload of the return URL found nothing and said "That signup expired" over
   a shop that had just been created (owner's report, 2026-09-02). Completion
   now leaves a DONE marker behind the spent token for a day: a reload within
   REPLAY_WINDOW_MS, carrying the same Stripe session id, is handed a fresh
   sign-in ticket and lands where it left off; later reloads are told the shop
   is already set up and pointed at sign-in. The marker never recreates
   anything — the account exists exactly once. */
const DONE_TTL_MS = 24 * 60 * 60 * 1000;
const REPLAY_WINDOW_MS = 15 * 60 * 1000;

type DoneRecord = { userId: string; email: string; sessionId: string | null; at: number };

function doneKey(token: string): string {
  return `signup-done:${token}`;
}

async function loadDone(token: string): Promise<DoneRecord | null> {
  const row = await db.syncState.findUnique({ where: { key: doneKey(token) } }).catch(() => null);
  if (!row) return null;
  try {
    const rec = JSON.parse(row.cursor) as DoneRecord;
    if (!rec?.userId || Date.now() - (rec.at ?? 0) > DONE_TTL_MS) return null;
    return rec;
  } catch {
    return null;
  }
}

/**
 * Update the page selection on a live pending intent.
 *
 * THE $30-CHARGED-$20 BUG this closes: the intent is parked at the END OF STEP
 * 2, but the pages are picked on STEP 3 — so the selection stored with the
 * intent was whatever it held when the account form was submitted (empty), and
 * the checkout route, which prices ONLY from the intent (never the request
 * body, so a doctored request can't name its own price), charged the $20 base
 * no matter what was ticked. The client now calls this right before asking for
 * checkout; the same normalize-and-store, the same server-side pricing.
 */
export async function updatePendingSignupPages(
  token: string,
  pages: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const rec = await loadPending(token);
  if (!rec) return { ok: false, error: "That signup expired. Start again." };
  const next: PendingRecord = {
    ...rec,
    customPages: normalizeCustomPages(Array.isArray(pages) ? pages.map(String) : []),
  };
  await db.syncState.upsert({
    where: { key: key(token) },
    update: { cursor: JSON.stringify(next) },
    create: { key: key(token), cursor: JSON.stringify(next) },
  });
  return { ok: true };
}

/**
 * Stamp (or clear) the validated code on a live intent. The intent is parked
 * at the END of step 2 and the code is typed on step 3 — so until 2026-09-02
 * the checkout route, which reads attribution ONLY from the intent, never saw
 * a code applied on the plan step, and Stripe charged full price under a
 * "10% off" line (owner's report). The client calls this right before it asks
 * for checkout, the same way it re-stamps the custom pages.
 */
export async function updatePendingSignupAttribution(
  token: string,
  attribution: { kind: "promo" | "ref"; code: string } | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const rec = await loadPending(token);
  if (!rec) return { ok: false, error: "That signup expired. Start again." };
  const parsed = pendingSchema.shape.attribution.safeParse(attribution);
  const next: PendingRecord = { ...rec, attribution: parsed.success ? (parsed.data ?? null) : null };
  await db.syncState.upsert({
    where: { key: key(token) },
    update: { cursor: JSON.stringify(next) },
    create: { key: key(token), cursor: JSON.stringify(next) },
  });
  return { ok: true };
}

async function loadPending(token: string): Promise<PendingRecord | null> {
  if (!token) return null;
  const row = await db.syncState.findUnique({ where: { key: key(token) } }).catch(() => null);
  if (!row) return null;
  try {
    const rec = JSON.parse(row.cursor) as PendingRecord;
    // How long an unpaid intent is honoured (a day; a card-less trial's day
    // counts from the latest link sent) — the one rule the register page's
    // passwordless return reads too (lib/pendingSignup).
    return pendingSignupAlive(rec) ? rec : null;
  } catch {
    return null;
  }
}

/**
 * Turn a paid (or skipped) intent into a real workspace.
 *
 * `sessionId` is a Stripe Checkout session; when present it is verified against
 * Stripe AND against this token before anything is written — a guessed session
 * id belonging to somebody else's checkout creates nothing.
 */
export async function completePendingSignup(
  token: string,
  sessionId: string | null,
): Promise<
  | { ok: true; email: string; ticket: string | null }
  | { ok: false; error: string; done?: boolean; email?: string; declined?: { plan: string | null; interval: string | null; tool: string | null; why?: string | null } }
> {
  let rec = await loadPending(token);
  if (!rec) {
    const done = await loadDone(token);
    if (done && sessionId && done.sessionId === sessionId) {
      if (Date.now() - done.at <= REPLAY_WINDOW_MS) {
        return { ok: true, email: done.email, ticket: await mintSigninTicket(done.userId) };
      }
      return {
        ok: false,
        done: true,
        email: done.email,
        error: "This signup is already complete. Sign in to open your shop.",
      };
    }
    return { ok: false, error: "That signup expired. Start again." };
  }

  // The skip path ("create the account with no subscription") is a testing
  // exit. It is a public server action, so it is gated HERE, not in the UI:
  // production never honours it, and outside production only when the
  // operator opts in with SIGNUP_ALLOW_SKIP=true. Otherwise the paywall this
  // file exists to enforce could be walked around with one call.
  if (!sessionId) {
    const skipAllowed =
      process.env.NODE_ENV !== "production" && process.env.SIGNUP_ALLOW_SKIP === "true";
    if (!skipAllowed) return { ok: false, error: "Choose a plan to finish creating your account." };
    // A sign-up by text has no email until Stripe's card page asks for one: the skip has nothing to make it with.
    if (!rec.email) return { ok: false, error: "A sign-up by text finishes on the card page — it asks for your email." };
  }

  let stripeCustomerId: string | null = null;
  let stripeSubscriptionId: string | null = null;
  let stripeSubscription: Stripe.Subscription | null = null;
  let planSlug: string | null = null;
  let trialEnd: Date | null = null;
  let periodEnd: Date | null = null;
  let analyticsOutcome = "subscription_activated";
  let analyticsLive = false;
  // The page selection the customer actually PAID for. Stamped into the
  // Checkout session's metadata by the checkout route from the intent as it
  // was when the price was computed; read back from Stripe (immutable to the
  // client) rather than from the intent, which updatePendingSignupPages can
  // still rewrite after the session was priced.
  let paidCustomPages: string[] | null = null;
  // The new plans' main tool and the other tools ticked, as the session was priced with them (lib/signupCheckoutSession)
  // — Stripe's copy, not ours.
  let mainTool: ToolId | null = null;
  let extraTools: ToolId[] = [];

  if (sessionId) {
    if (!isStripeEnabled()) return { ok: false, error: "Checkout is not configured." };
    try {
      // Same mode the session was created under, as long as the admin switch
      // has not been flipped mid-checkout; a cross-mode session id simply
      // fails to retrieve, which reads as "couldn't verify" — correct.
      const { stripe, mode } = await getStripeClient();
      const session = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ["subscription"],
      });
      // The session must be THIS signup's, and it must have actually started.
      if (session.client_reference_id !== token) {
        return { ok: false, error: "That checkout does not belong to this signup." };
      }
      const paid = session.status === "complete" || session.payment_status === "paid";
      if (!paid) return { ok: false, error: "The payment has not completed yet." };
      analyticsLive = session.livemode;
      if (session.payment_status === "paid" && (session.amount_total ?? 0) > 0) analyticsOutcome = "subscription_purchased";
      stripeCustomerId = typeof session.customer === "string" ? session.customer : null;
      const sub = session.subscription;
      if (sub && typeof sub !== "string") {
        if (sub.status === "trialing") analyticsOutcome = "trial_started";
        stripeSubscriptionId = sub.id;
        stripeSubscription = sub;
        trialEnd = sub.trial_end ? new Date(sub.trial_end * 1000) : null;
        periodEnd = subscriptionPeriodEndDate(sub);
      } else if (typeof sub === "string") {
        stripeSubscriptionId = sub;
      }
      planSlug = (session.metadata?.planSlug as string | undefined) ?? null;
      /* A SIGN-UP BY TEXT TAKES STRIPE'S EMAIL (owner, 2026-11-12). The intent has the proven number and no address;
         the card page asked for one (the session carried no customer_email). It becomes the account's address —
         unless another account has it, it is a throwaway inbox, or none came back: then no account, no card check,
         and this Checkout's subscription cancelled as a declined card's is (lib/signupCardHold refuseSignupCheckout);
         the card page opens again with the reason, and the name and number stay on the intent. */
      if (!rec.email) {
        const picked = (session.customer_details?.email ?? session.customer_email ?? "").trim().toLowerCase();
        const why = !picked || !z.string().email().safeParse(picked).success
          ? "email_missing"
          : isDisposableEmail(picked)
            ? "email_disposable"
            : (await db.user.findUnique({ where: { email: picked }, select: { id: true } }))
              ? "email_taken"
              : null;
        if (why) {
          const refused = await refuseSignupCheckout({ stripe, session, sub: stripeSubscription, email: picked, code: why });
          console.warn(`[signup] ${session.id}: sign-up by text refused — ${why}`);
          return { ok: false, error: STRIPE_EMAIL_LINES[why], declined: { plan: refused.plan, interval: refused.interval, tool: refused.tool ?? null, why } };
        }
        rec = { ...rec, email: picked };
      }
      const metaTool = session.metadata?.mainTool;
      mainTool = isToolId(metaTool) ? metaTool : null;
      extraTools = extrasOf(session.metadata?.extraTools, mainTool);
      const metaPages = session.metadata?.customPages;
      if (typeof metaPages === "string") {
        paidCustomPages = normalizeCustomPages(metaPages.split(",").filter(Boolean));
      }
      /* THE $1 CARD CHECK (owner, 2026-11-11 — lib/signupCardHold): the trial took the card without charging it, so
         the bank is asked for a $1 hold, released at once. A refusal of the card: no account, this Checkout's
         subscription cancelled, the card page again with one line. Anything else that goes wrong with the check lets
         the sign-up through (it never throws). Once per Checkout Session, however often this runs. */
      // A Checkout already checked is read back whatever its subscription says now: a declined card's subscription is
      // cancelled by then, and that return must still make no account.
      if (stripeSubscription?.status === "trialing" || (await readCardHold(session.id))) {
        const { fresh, ...hold } = await checkSignupCard({ stripe, mode, session, sub: stripeSubscription, token, email: rec.email });
        // An earlier return of this Checkout refused its Stripe email (above): the same words again, whatever the
        // address says now — that subscription is cancelled.
        if (hold.result === "declined" && isStripeEmailCode(hold.code)) {
          const why = hold.code as string;
          return { ok: false, error: STRIPE_EMAIL_LINES[why], declined: { plan: hold.plan, interval: hold.interval, tool: hold.tool ?? null, why } };
        }
        if (hold.result === "declined") {
          if (!hold.subCanceled && !(await cancelDeclinedSubscription(stripe, hold))) {
            console.warn(`[signup] declined sign-up's subscription ${hold.subId} still standing — the trials cron cancels it`);
          }
          // Told to the analyst once: by the call that met the refusal, not by a reload reading it back.
          if (fresh && !isQaSignup(rec)) {
            const props = { code: hold.code ?? "card_declined", plan: hold.plan, interval: hold.interval, livemode: session.livemode };
            // The sign-up's own identity, else this browser's PostHog cookie (as the hand-off to Stripe reads it).
            const identity =
              rec.analytics ??
              identityFromCookie((await cookies()).get(`ph_${process.env.NEXT_PUBLIC_POSTHOG_KEY}_posthog`)?.value, (await headers()).get("host")?.split(":")[0] ?? "");
            after(() => captureTrafficEvent(identity, TRAFFIC_EVENTS.cardDeclined, props));
          }
          return { ok: false, error: CARD_DECLINED_LINE, declined: { plan: hold.plan, interval: hold.interval, tool: hold.tool ?? null } };
        }
      } else if (stripeSubscription && (stripeSubscription.status === "canceled" || stripeSubscription.status === "incomplete_expired")) {
        // A trial sign-up whose subscription is already gone (its decline's record unwritten, or cancelled at Stripe
        // in the meantime): no account on a dead subscription — the card page again, as a declined card would.
        console.warn(`[signup] ${session.id}: subscription ${stripeSubscription.id} is ${stripeSubscription.status} — no account`);
        return {
          ok: false,
          error: CARD_DECLINED_LINE,
          declined: {
            plan: planSlug,
            interval: (session.metadata?.interval as string | undefined) ?? null,
            tool: session.metadata?.mainTool !== undefined ? [session.metadata.mainTool, session.metadata.extraTools].filter(Boolean).join(",") : null,
          },
        };
      }
    } catch (err) {
      console.warn("[signup] checkout verify failed:", err);
      return { ok: false, error: "Couldn't verify the payment. Try again." };
    }
  }

  const made = await createAccountFromPending(token, rec, {
    flow: sessionId ? "checkout" : "skip",
    sessionId,
    stripeCustomerId,
    stripeSubscriptionId,
    stripeSubscription,
    planSlug,
    trialEnd,
    periodEnd,
    paidCustomPages,
    analyticsOutcome,
    analyticsLive,
    mainTool,
    extraTools,
  });
  // Admin → Trial watch: the shop this card check let in.
  if (made.ok && sessionId) await noteCardHoldAccount(sessionId, made.orgId).catch(() => {});
  return made;
}

/**
 * THE NEW PLANS AT THE CARD-LESS TRIAL'S START: which plans a sign-up may start now (lib/signupPricing
 * signupPlanRefusal), and for a new plan its size and its pick, read again on the server (never the browser's price).
 * `mainTool` is the pick as it goes on (ids, comma-separated, the first the main tool); `name` is what the confirmation
 * email calls it ("Professional + Deck Studio + Fence estimator").
 */
async function cardlessPlanCheck(planSlug: string, mainTool: string | null | undefined): Promise<{ ok: true; mainTool: string | null; name: string | null } | { ok: false; error: string }> {
  const refusal = await signupPlanRefusal(planSlug);
  if (refusal) return { ok: false, error: refusal };
  const tools = toolPlanBySlug(planSlug);
  if (!tools) return { ok: true, mainTool: null, name: null };
  const pick = toolsSignupPick({ plan: planSlug, tool: mainTool });
  if (!pick) return { ok: false, error: "That plan is not available." };
  const picks = [...(pick.main ? [pick.main] : []), ...pick.extras];
  return { ok: true, mainTool: picks.length ? pickWire(picks) : null, name: toolsBuild(pick.plan, picks).label };
}

/**
 * THE CARD-LESS TRIAL, STEP ONE (signupTrialMode "no-card" — lib/trialPolicyServer).
 * The plan step's "Start free trial" lands here instead of at Stripe
 * Checkout. Nothing is created yet (owner, 2026-10-01: "confirm before the
 * dashboard"): the brakes are checked (lib/trialGuard — per IP, per address,
 * per company domain), the plan is stamped on the intent, and a confirmation
 * link is emailed. Calling it again sends a fresh link (the old one stops
 * working). The account and the trial are created by confirmCardlessTrial.
 */
export async function requestCardlessTrial(
  token: string,
  planSlug: string,
  /** The term picked on the plan step (owner, 2026-10-12): kept with the
   *  trial, so a card added later starts the plan on it. Monthly when absent
   *  (a page loaded before the term was sent) or the plan has no yearly price. */
  interval: "MONTH" | "YEAR" = "MONTH",
  /** The new plans: the main tool picked on the card page (checked again here and priced at the trial's start). */
  mainTool?: string | null,
): Promise<{ ok: true; email: string; resendAt: number } | { ok: false; error: string; resendAt?: number; requiresCard?: true }> {
  // THE ONE ANSWER (lib/trialPolicyServer), read fresh: the switch, else the
  // deployment's default, and the day's ceiling on card-less trials. "card"
  // moves the plan step to Checkout — no brake is spent on this answer.
  const trial = await signupTrialState({ fresh: true });
  if (trial.mode === "card") {
    return { ok: false, error: trial.capReached ? TRIALS_PAUSED_MESSAGE : TRIAL_NOW_TAKES_CARD, requiresCard: true };
  }
  if (planSlug === CUSTOM_PLAN_SLUG && !customPlanOffered()) return { ok: false, error: CUSTOM_PLAN_OFF_SALE };
  const rec = await loadPending(token);
  if (!rec) return { ok: false, error: "That signup expired. Start again." };
  // A sign-up by text has no address to confirm: its trial starts with a card, at Stripe (which asks for the email).
  if (!rec.email) return { ok: false, error: PHONE_TRIAL_TAKES_CARD, requiresCard: true };
  // An address another account holds unproven (a sign-up by text, lib/emailProof) blocks only an unproven sign-up.
  if (await addressTaken(rec.email, Boolean(rec.emailVerifiedAt))) return { ok: false, error: "That email is already registered. Try signing in." };
  // THE BRAKES. A first request counts against the network (trials per IP per
  // hour); a resend counts against this signup only — RESEND_COOLDOWN_MS
  // between two links, RESEND_MAX in an hour — so asking for the email again
  // never spends a neighbour's trial.
  if (rec.cardless) {
    const wait = rec.cardless.requestedAt + RESEND_COOLDOWN_MS - Date.now();
    if (wait > 0) {
      return { ok: false, error: `Wait ${Math.ceil(wait / 1000)} s before sending another link.`, resendAt: rec.cardless.requestedAt + RESEND_COOLDOWN_MS };
    }
    try {
      await enforceRateLimit(`cardless-resend:${token}`, RESEND_MAX, HOUR, "confirmation emails");
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Too many confirmation emails. Try again later." };
    }
  } else {
    try {
      await enforceRateLimit(`cardless-trial:${await clientIp()}`, trialRequestsPerIpHour(), HOUR, "free trials from this network");
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Too many free trials. Try again later." };
    }
  }
  const refusal = await cardlessTrialRefusal(rec.email);
  if (refusal) return { ok: false, error: refusal };
  let planName = "Custom";
  const toolsCheck = await cardlessPlanCheck(planSlug, mainTool);
  if (!toolsCheck.ok) return { ok: false, error: toolsCheck.error };
  if (toolsCheck.name) planName = toolsCheck.name;
  else if (planSlug !== CUSTOM_PLAN_SLUG) {
    const plan = await getPlanBySlug(planSlug);
    if (!plan || !plan.active || plan.isFree) return { ok: false, error: "That plan is not available." };
    planName = plan.name;
  }

  // The link: a random secret in the email, its hash in the store, pointing
  // at this intent. A new request replaces the old link.
  const secret = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(secret).digest("hex");
  const prev = await db.syncState.findUnique({ where: { key: confirmIndexKey(token) } }).catch(() => null);
  if (prev) await db.syncState.delete({ where: { key: confirmKey(prev.cursor) } }).catch(() => {});
  const next: PendingRecord = { ...rec, cardless: { planSlug, interval: interval === "YEAR" ? "YEAR" : "MONTH", requestedAt: Date.now(), ...(toolsCheck.name ? { mainTool: toolsCheck.mainTool ?? "" } : {}) } };
  await db.syncState.upsert({ where: { key: key(token) }, update: { cursor: JSON.stringify(next) }, create: { key: key(token), cursor: JSON.stringify(next) } });
  await db.syncState.upsert({ where: { key: confirmKey(hash) }, update: { cursor: token }, create: { key: confirmKey(hash), cursor: token } });
  await db.syncState.upsert({ where: { key: confirmIndexKey(token) }, update: { cursor: hash }, create: { key: confirmIndexKey(token), cursor: hash } });

  const base = (await appBaseUrl()).replace(/\/$/, "");
  const { subject, html } = renderEmail(
    buildTrialConfirm({ name: rec.name, planName, trialDays: storedTrialOffer(rec.trialOffer).days, href: `${base}/auth/register/confirm?t=${secret}` }),
  );
  try {
    await sendEmail({ mailClass: "transactional", to: rec.email, subject, html, kind: "otp" });
  } catch (err) {
    console.error("[signup] trial confirmation email failed:", err);
    return { ok: false, error: "Couldn't send the confirmation email. Try again." };
  }
  return { ok: true, email: rec.email, resendAt: next.cardless!.requestedAt + RESEND_COOLDOWN_MS };
}

/** A sign-up by text on the plan step while the trial takes no card: the card page is the one way on — it asks for
 *  the email the account needs (owner, 2026-11-12). */
const PHONE_TRIAL_TAKES_CARD = "A sign-up by text starts its free trial with a card on file — nothing is charged until the trial ends. Press Start free trial again to continue.";

/** What the plan step says when the switch went to "card" after the page loaded. */
const TRIAL_NOW_TAKES_CARD =
  "The free trial now starts with a card on file — nothing is charged until your displayed trial ends. Press Start free trial again to continue.";

/** A minute between two confirmation emails, and three resends an hour. */
const RESEND_COOLDOWN_MS = 60 * 1000;
const RESEND_MAX = 3;

/**
 * THE CARD-LESS TRIAL WITHOUT A SECOND EMAIL (passwordless sign-up,
 * 2026-10-10). The address was already proven by the code — or the link, or
 * Google — when this intent was written (`emailVerifiedAt`, set only by
 * lib/signupOtp), so the plan step's "Start free trial" creates the trial and
 * the account at once: the same brakes requestCardlessTrial checks, then the
 * same finishCardlessTrial the emailed link runs. Answers a sign-in ticket.
 */
export async function startVerifiedCardlessTrial(
  token: string,
  planSlug: string,
  /** The term picked on the plan step — see requestCardlessTrial. */
  interval: "MONTH" | "YEAR" = "MONTH",
  /** The new plans' main tool — see requestCardlessTrial. */
  mainTool?: string | null,
): Promise<
  | { ok: true; email: string; ticket: string | null; subscriptionId: string | null; signupMode: string | null }
  | { ok: false; error: string; requiresCard?: true; done?: boolean; email?: string }
> {
  try {
    const trial = await signupTrialState({ fresh: true });
    if (trial.mode === "card") {
      return { ok: false, error: trial.capReached ? TRIALS_PAUSED_MESSAGE : TRIAL_NOW_TAKES_CARD, requiresCard: true };
    }
    if (planSlug === CUSTOM_PLAN_SLUG && !customPlanOffered()) return { ok: false, error: CUSTOM_PLAN_OFF_SALE };
    const rec = await loadPending(token);
    if (!rec) return { ok: false, error: "That signup expired. Start again." };
    if (!rec.email) return { ok: false, error: PHONE_TRIAL_TAKES_CARD, requiresCard: true };
    if (!rec.emailVerifiedAt) return { ok: false, error: "Confirm your email first." };
    if (await addressTaken(rec.email, true)) return { ok: false, error: "That email is already registered. Try signing in." };
    try {
      await enforceRateLimit(`cardless-trial:${await clientIp()}`, trialRequestsPerIpHour(), HOUR, "free trials from this network");
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Too many free trials. Try again later." };
    }
    const refusal = await cardlessTrialRefusal(rec.email);
    if (refusal) return { ok: false, error: refusal };
    const toolsCheck = await cardlessPlanCheck(planSlug, mainTool);
    if (!toolsCheck.ok) return { ok: false, error: toolsCheck.error };
    if (!toolsCheck.name && planSlug !== CUSTOM_PLAN_SLUG) {
      const plan = await getPlanBySlug(planSlug);
      if (!plan || !plan.active || plan.isFree) return { ok: false, error: "That plan is not available." };
    }
    const next: PendingRecord = { ...rec, cardless: { planSlug, interval: interval === "YEAR" ? "YEAR" : "MONTH", requestedAt: Date.now(), ...(toolsCheck.name ? { mainTool: toolsCheck.mainTool ?? "" } : {}) } };
    await db.syncState.upsert({ where: { key: key(token) }, update: { cursor: JSON.stringify(next) }, create: { key: key(token), cursor: JSON.stringify(next) } });
    const res = await finishCardlessTrial(token);
    if (!res.ok) return { ok: false, error: res.error, done: res.done, email: res.email, ...(res.cardHref ? { requiresCard: true as const } : {}) };
    return res;
  } catch (err) {
    console.error("[signup] verified card-less trial failed:", err);
    return { ok: false, error: "Couldn't start the trial. Try again." };
  }
}

/**
 * THE CARD-LESS TRIAL, STEP TWO: the link from the email. Proves the address,
 * then creates the trialing subscription (no payment method —
 * lib/cardlessTrial) and the same account the paid return creates, with
 * everything that waited for completePendingSignup — the welcome email, the
 * attribution. Answers a
 * sign-in ticket the confirmation page redeems. Reusing the link sends the
 * visitor to sign-in without issuing another ticket or changing the trial.
 */
export async function confirmCardlessTrial(
  secret: string,
): Promise<
  | { ok: true; email: string; ticket: string | null; subscriptionId: string | null; signupMode: string | null }
  | { ok: false; error: string; done?: boolean; email?: string; cardHref?: string }
> {
  if (!secret || secret.length > 200) return { ok: false, error: "That link is not valid." };
  const hash = createHash("sha256").update(secret).digest("hex");
  const row = await db.syncState.findUnique({ where: { key: confirmKey(hash) } }).catch(() => null);
  if (!row) return { ok: false, error: "That link has expired or was replaced by a newer one. Start the signup again." };
  const res = await finishCardlessTrial(row.cursor);
  // Used once: the link is gone, and opening it again goes to sign-in (the
  // done marker answers `done`) instead of signing anybody in a second time.
  if (res.ok) await db.syncState.delete({ where: { key: confirmIndexKey(row.cursor) } }).catch(() => {});
  return res;
}

const confirmKey = (hash: string) => `signup-confirm:${hash}`;
const confirmIndexKey = (token: string) => `signup-confirm-of:${token}`;

function cardlessSignupAlreadyUsed(email: string) {
  return { ok: false as const, done: true, email, error: "This link was already used. Sign in to open your shop." };
}

/** The account and the trial, from a confirmed intent. Not exported: the
 *  only way in is the emailed link (confirmCardlessTrial). */
async function finishCardlessTrial(
  token: string,
): Promise<
  | { ok: true; email: string; ticket: string | null; subscriptionId: string | null; signupMode: string | null }
  | { ok: false; error: string; done?: boolean; email?: string; cardHref?: string }
> {
  const rec = await loadPending(token);
  if (!rec?.cardless) {
    const done = await loadDone(token);
    if (done && done.sessionId === CARDLESS_SESSION) {
      return cardlessSignupAlreadyUsed(done.email);
    }
    return { ok: false, error: "This link has expired — links last 24 hours. Start the signup again." };
  }
  if (!rec.email) return { ok: false, error: PHONE_TRIAL_TAKES_CARD, cardHref: `/auth/register?signup=${encodeURIComponent(token)}` };
  if (await addressTaken(rec.email, Boolean(rec.emailVerifiedAt))) return cardlessSignupAlreadyUsed(rec.email);
  const refusal = await cardlessTrialRefusal(rec.email);
  if (refusal) return { ok: false, error: refusal };
  // The day's ceiling filled while the link sat in the inbox: the same
  // signup goes on at the plan step, with a card (lib/trialDailyCap). The
  // owner's switch is deliberately not read here — signupTrialMode decided
  // when the link was sent, and a link already emailed is honoured.
  if (await cardlessTrialsPaused()) return { ok: false, error: TRIALS_PAUSED_MESSAGE, cardHref: `/auth/register?signup=${encodeURIComponent(token)}` };

  const planSlug = rec.cardless.planSlug;
  // The term picked on the plan step; lib/signupPricing bills a plan with no
  // yearly price monthly whatever this says (started.interval is the truth).
  const asked = rec.cardless.interval === "YEAR" ? ("YEAR" as const) : ("MONTH" as const);
  const customPages = planSlug === CUSTOM_PLAN_SLUG ? normalizeCustomPages(rec.customPages) : [];
  const started = await createCardlessSubscription({
    token,
    email: rec.email,
    businessName: rec.businessName,
    planSlug,
    interval: asked,
    customPages,
    attribution: rec.attribution ?? null,
    trialOffer: rec.trialOffer,
    mainTool: rec.cardless.mainTool ?? null,
  });
  if (!started.ok) return { ok: false, error: started.error };
  const sub = started.subscription;
  const trialEnd = sub.trial_end ? new Date(sub.trial_end * 1000) : null;

  const created = await createAccountFromPending(token, rec, {
    flow: "cardless",
    sessionId: CARDLESS_SESSION,
    stripeCustomerId: started.customerId,
    stripeSubscriptionId: sub.id,
    stripeSubscription: sub,
    planSlug: started.planLabel,
    trialEnd,
    periodEnd: subscriptionPeriodEndDate(sub),
    paidCustomPages: started.customPages,
    analyticsOutcome: "trial_started",
    analyticsLive: sub.livemode,
    mainTool: started.mainTool ?? null,
    extraTools: started.extraTools ?? [],
  });
  if (!created.ok) {
    // Stripe's per-token idempotency key makes overlapping confirmations share
    // one trial. A losing account-create request must never cancel it: the
    // winner may have committed its User but not its Subscription row yet.
    // Even an absent mirror cannot prove the trial is orphaned. Leave cleanup
    // to the card-less trial's automatic expiry; no payment method was added.
    const registered = await db.user.findUnique({ where: { email: rec.email }, select: { id: true } });
    if (registered) return cardlessSignupAlreadyUsed(rec.email);
    return created;
  }
  await writeCardlessRecord(created.orgId, {
    subId: sub.id,
    customerId: started.customerId,
    planSlug: started.planLabel,
    interval: started.interval,
    customPages: started.customPages,
    mode: started.mode,
    trialDays: storedTrialOffer(rec.trialOffer).days,
    startedAt: new Date().toISOString(),
    endsAt: (trialEnd ?? new Date()).toISOString(),
  });
  // The address is proven — the link was opened from it.
  await db.user.update({ where: { id: created.userId }, data: { emailVerified: new Date() } }).catch(() => {});
  await markCardlessTrialUsed(rec.email, created.orgId);
  // Counted against the day's ceiling; support hears at 80% (lib/trialDailyCap).
  await noteCardlessTrialStarted(created.orgId);
  after(() => nameOrgOnSubscription(sub.id, created.orgId));
  return { ok: true, email: created.email, ticket: created.ticket, subscriptionId: sub.id, signupMode: rec.signupMode ?? null };
}

/** The done record's "session" for a card-less trial — there is no Checkout. */
const CARDLESS_SESSION = "cardless";

/** What the account is created WITH: the Stripe side of a paid checkout, of
 *  a card-less trial, or nothing at all (the non-production skip). */
type AccountBilling = {
  flow: "checkout" | "cardless" | "skip";
  /** The Stripe Checkout session (paid flow), or the marker the done record
   *  replays against (card-less: "cardless"); null on the skip. */
  sessionId: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripeSubscription: Stripe.Subscription | null;
  planSlug: string | null;
  trialEnd: Date | null;
  periodEnd: Date | null;
  /** The page selection the subscription was priced with (custom plan). */
  paidCustomPages: string[] | null;
  analyticsOutcome: string;
  analyticsLive: boolean;
  /** The new plans: the main tool the subscription was priced with (null: none, or a Classic plan). */
  mainTool?: ToolId | null;
  /** The new plans: the other tools ticked in the builder — lines riding the trial, written as its free tries. */
  extraTools?: ToolId[];
};

/** The other tools ticked, from Stripe's metadata ("fence,roof"): our tool ids only, each once, never the main tool. */
function extrasOf(raw: unknown, main: ToolId | null): ToolId[] {
  if (typeof raw !== "string") return [];
  return [...new Set(raw.split(",").map((w) => w.trim()).filter(isToolId))].filter((id) => id !== main);
}


/**
 * The account itself: Organization + owner User + Membership, the
 * Subscription row, the Lead Center pin, the custom pages, the attribution,
 * the done marker, the sign-in ticket, and after the response the welcome
 * email and the analytics outcome.
 * Shared by the paid return (completePendingSignup) and the card-less trial
 * (completeCardlessSignup) — split out of completePendingSignup unchanged
 * (2026-10-01), so the two flows create the same account.
 */
async function createAccountFromPending(
  token: string,
  rec: PendingRecord,
  billing: AccountBilling,
): Promise<
  | { ok: true; email: string; ticket: string | null; orgId: string; userId: string }
  | { ok: false; error: string }
> {
  const {
    sessionId,
    stripeCustomerId,
    stripeSubscriptionId,
    stripeSubscription,
    planSlug,
    trialEnd,
    periodEnd,
    paidCustomPages,
    analyticsOutcome,
    analyticsLive,
  } = billing;
  // A sign-up by text reaches here only with the address Stripe's card page gave (completePendingSignup).
  if (!rec.email) return { ok: false, error: "That signup has no email yet. Start again." };
  // Re-check the address: somebody may have registered it while the card was
  // being typed. An account that holds it UNPROVEN (a sign-up by text whose code never came back — lib/emailProof)
  // gives it up to a sign-up that proved it (an email code, Google); an unproven sign-up is refused as ever.
  const proven = Boolean(rec.emailVerifiedAt);
  if (await addressTaken(rec.email, proven)) return { ok: false, error: "That email is already registered. Try signing in." };
  // ONE NUMBER, ONE ACCOUNT (lib/phoneLogin): a sign-up by text whose number found an account meanwhile makes none.
  const phone = rec.phone ?? null;
  if (phone) {
    if (await phoneAccountOf(phone)) return { ok: false, error: PHONE_TAKEN_LATE };
    await releaseStalePhoneLogin(phone);
  }
  const phoneShown = phone ? prettyUsPhone(phone) : null;
  /* THE NEW PLANS (Base + Tools, part 4): the slug the subscription was priced with ("tools-professional") is the
     plan — never the Classic fallback — and the main tool rides with it (billing.mainTool, from Stripe's copy). */
  const toolsPlan = toolPlanBySlug(planSlug);
  const toolsMain: ToolId | null = toolsPlan && isToolId(billing.mainTool) ? billing.mainTool : null;
  const toolsExtras: ToolId[] = toolsPlan ? (billing.extraTools ?? []).filter((id) => isToolId(id) && id !== toolsMain) : [];

  const slug = await uniqueSlug(slugify(rec.businessName));
  let orgId: string;
  let userId: string;
  try {
    const created = await db.$transaction(async (tx) => {
      if (proven) await releaseUnprovenEmail(tx, rec.email);
      const org = await tx.organization.create({
        data: {
          name: rec.businessName,
          slug,
          billingEmail: rec.email,
          address: rec.companyAddress || null,
          // A sign-up by text: the proven number is the office phone until the owner changes it (owner, 2026-11-12).
          phone: rec.companyPhone || phoneShown || null,
          // The zone the address or the phone says (lib/usTimezone, 2026-11-07); the default otherwise.
          timezone: timezoneFor({ address: rec.companyAddress, phone: rec.companyPhone || phoneShown || undefined }) ?? undefined,
          tradeTypesJson: JSON.stringify(rec.tradeTypes ?? []),
          otherTrade:
            rec.otherTrade && rec.tradeTypes?.includes("Other") ? rec.otherTrade : null,
          // Where the signup came from — the landing's trade hero and the
          // visit's utm_*, first write, never overwritten (CRO stage 1).
          landingIndustry: rec.landingIndustry ?? null,
          signupVariant: rec.signupVariant ?? null,
          utmSource: rec.utm?.utm_source || null,
          utmMedium: rec.utm?.utm_medium || null,
          utmCampaign: rec.utm?.utm_campaign || null,
          utmContent: rec.utm?.utm_content || null,
        },
        select: { id: true },
      });
      const user = await tx.user.create({
        data: {
          email: rec.email,
          name: rec.name,
          hashedPassword: rec.hashedPassword,
          image: rec.image ?? null,
          activeOrgId: org.id,
          // The passwordless sign-up proved the address before the intent existed.
          ...(rec.emailVerifiedAt ? { emailVerified: new Date() } : {}),
          // A sign-up by text: the person's phone (the address from Stripe stays unproven until a code from it).
          ...(phoneShown ? { phone: phoneShown } : {}),
        },
        select: { id: true },
      });
      // A sign-up by text: the number signs in to this account from now on, and the company screen asks for the
      // company email before the app is theirs (lib/phoneLogin, lib/phoneSetup).
      // Its address is Stripe's, unproven until the code on that screen (lib/emailProof): it signs nothing in and gets
      // no welcome or marketing until then.
      if (phone) {
        await linkPhoneLogin(tx, user.id, phone);
        await markPhoneSetupDue(tx, org.id);
        await markEmailUnproven(tx, user.id, rec.email);
      }
      await tx.membership.create({
        data: { userId: user.id, organizationId: org.id, role: "OWNER" },
      });
      // Retain the offered terms after the browser cookie and signup intent
      // expire — while the test runs; after it, no shop is put in a variant.
      if (!TRIAL_TEST_ENDED) {
        await tx.syncState.upsert({
          where: { key: `signupTrialOffer:${org.id}` },
          create: {
            key: `signupTrialOffer:${org.id}`,
            cursor: JSON.stringify({ ...storedTrialOffer(rec.trialOffer), recordedAt: new Date().toISOString() }),
          },
          update: {},
        });
      }
      // No business name was asked (passwordless): the person's name stands in,
      // marked so the company page, the banner and the first send ask for it.
      if (rec.nameUnset) {
        await tx.syncState.upsert({ where: { key: orgNameUnsetKey(org.id) }, create: { key: orgNameUnsetKey(org.id), cursor: "1" }, update: { cursor: "1" } });
      }

      // Straight to Professional (lib/signupAutoPlan): the dashboard's welcome card says the plan can change any time.
      // Not on the new plans: their own welcome page says it (lib/toolPlans/view toolsWelcomeDue).
      if (rec.autoPlan && !toolsPlan) {
        await tx.syncState.upsert({ where: { key: autoPlanWelcomeKey(org.id) }, create: { key: autoPlanWelcomeKey(org.id), cursor: JSON.stringify({ at: new Date().toISOString() }) }, update: {} });
      }
      // No code at sign-up: the address waits for a sign-in that proves it (lib/accountClaim).
      if (rec.quick) await markUnclaimed(tx, user.id);

      // THE TOOL THE VISITOR CAME FOR (lib/planSpotlight, 2026-10-14): on the
      // company, no schema change, read by lib/planSpotlightServer.
      const spotTool = parseSpotlightTool(rec.landingTool);
      if (spotTool) {
        await tx.syncState.upsert({ where: { key: SPOTLIGHT_KEY(org.id) }, create: { key: SPOTLIGHT_KEY(org.id), cursor: spotTool }, update: { cursor: spotTool } });
      }

      return { orgId: org.id, userId: user.id };
    });
    orgId = created.orgId;
    userId = created.userId;
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code;
    if (code === "P2002") {
      if (phone && (await phoneAccountOf(phone).catch(() => null))) return { ok: false, error: PHONE_TAKEN_LATE };
      return { ok: false, error: "That email is already registered. Try signing in." };
    }
    throw e;
  }

  // Follow-ups work from the first proposal sent (lib/followUps/defaults).
  // Never in the way of the account: /dashboard/crm writes them on the
  // first visit if this fails.
  await ensureDefaultFollowUpRules(orgId).catch((err) => console.warn("[signup] follow-up defaults:", err));

  // Sent after the response, so it reads the subscription row written below.
  trackActivation("organization_created", orgId, { flow: billing.flow === "cardless" ? "cardless" : "checkout" });
  // The team's "Sign-ups" alert texts (lib/adminAlerts) — after the response; the
  // name is read back so the passwordless stand-in name is what the text carries.
  {
    const signupFlow = billing.flow === "cardless" ? "cardless" : "checkout";
    const alertOrgId = orgId;
    after(async () => {
      const org = await db.organization.findUnique({ where: { id: alertOrgId }, select: { name: true } }).catch(() => null);
      await alertSignup({ orgName: org?.name ?? "A new company", flow: signupFlow }).catch((err) => console.warn("[adminAlerts] signup text:", err));
    });
  }

  // The subscription row, written here rather than by the webhook: at session
  // creation there was no organization for the webhook's metadata to name.
  if (stripeSubscriptionId || stripeCustomerId) {
    const plan =
      planSlug && planSlug !== CUSTOM_PLAN_SLUG && !toolsPlan ? await getPlanBySlug(planSlug) : null;
    // The Classic fallback ("PRO") is for a Classic slug the catalog no longer knows — never for the new plans.
    const storedPlan = planSlug === CUSTOM_PLAN_SLUG ? "CUSTOM" : toolsPlan ? toolsPlan.slug.toUpperCase() : (plan?.slug.toUpperCase() ?? "PRO");
    await db.subscription
      .upsert({
        where: { organizationId: orgId },
        // Status uses the canonical enum casing — the limits engine compares
        // against SubscriptionStatus.ACTIVE/TRIALING and treated the old
        // lowercase values as LAPSED (free quotas for a paying customer until
        // the webhook happened to overwrite the row). currentPeriodEnd makes
        // the row self-expiring if the webhook never arrives.
        update: {
          plan: storedPlan,
          status: trialEnd ? SubscriptionStatus.TRIALING : SubscriptionStatus.ACTIVE,
          provider: "STRIPE",
          externalCustomerId: stripeCustomerId,
          externalSubId: stripeSubscriptionId,
          trialEndsAt: trialEnd,
          currentPeriodEnd: periodEnd,
        },
        create: {
          organizationId: orgId,
          plan: storedPlan,
          status: trialEnd ? SubscriptionStatus.TRIALING : SubscriptionStatus.ACTIVE,
          provider: "STRIPE",
          externalCustomerId: stripeCustomerId,
          externalSubId: stripeSubscriptionId,
          trialEndsAt: trialEnd,
          currentPeriodEnd: periodEnd,
        },
      })
      .catch((err) => console.warn("[signup] subscription record failed:", err));
    /* THE SHOP'S RECORD (SyncState `orgTools:<orgId>`, lib/toolPlans/billing): the size, the main tool, the
       subscription its lines live on; Advanced's main trade tool is one of its two. Written before the mirror below
       (syncSubscriptionFromStripe → mirrorToolLines) so the lines join this record, main tool kept. `toolsWelcome` is
       left unset: the first Overview opens the welcome page. */
    if (toolsPlan) {
      const record = firstToolsRecord({ plan: toolsPlan.id, main: toolsMain, extras: toolsExtras, subId: stripeSubscriptionId, trialEnd, now: new Date() });
      await writeToolsRecord(orgId, record).catch((err) => console.warn("[signup] tools record failed:", err));
    }
  }

  // LEAD CENTER ELIGIBILITY. The matcher hard-filters on a geocoded address
  // (lib/leadCenter/matching), so the pin has to be placed by the action that
  // CREATES the shop. This path never did it — only the legacy free-signup
  // action geocoded — so every shop created through checkout was born
  // invisible to routing while its own Company page read "Matching on".
  //
  // Same routine the Company profile save runs (lib/leadCenter/eligibility),
  // with one difference: a shop that cannot be placed is created with lead
  // offers OFF and the reason recorded, rather than left switched on and
  // silently unreachable. Best-effort — the account is already committed.
  try {
    const { geocodeOrgAddress } = await import("@/lib/leadCenter/eligibility");
    const geo = await geocodeOrgAddress(orgId, rec.companyAddress, { gateOnFailure: true });
    if (!geo.ok) {
      console.warn(`[signup] org ${orgId} not routable at creation: ${geo.reason}`);
    }
  } catch (err) {
    console.warn("[signup] geocode step failed:", err);
  }

  // The custom plan's page selection belongs to the workspace it was bought
  // for, so it is written the moment that workspace exists.
  // Paid selection wins; the intent's copy is only used on the (non-prod) skip
  // path where nothing was priced at all.
  const chosen = paidCustomPages ?? (sessionId ? [] : normalizeCustomPages(rec.customPages));
  if (chosen.length || planSlug === CUSTOM_PLAN_SLUG) {
    await db.syncState
      .upsert({
        where: { key: `orgPages:${orgId}` },
        update: { cursor: JSON.stringify(chosen) },
        create: { key: `orgPages:${orgId}`, cursor: JSON.stringify(chosen) },
      })
      .catch((err) => console.warn("[signup] page selection not recorded:", err));
  }
  // Name the workspace on the custom subscription made before it existed
  // (lib/customBilling): organizationId + the pages, in Stripe metadata.
  if (planSlug === CUSTOM_PLAN_SLUG && stripeSubscriptionId) {
    await stampCustomSubscription(stripeSubscriptionId, orgId, chosen);
  }

  if (rec.attribution) {
    await bindAttributionToOrg(orgId, rec.email, rec.attribution.kind, rec.attribution.code).catch(
      () => {},
    );
    // A referral counts the moment the referred shop's subscription exists
    // (see lib/referralRewards). Skipped on the no-subscription testing exit.
    if (rec.attribution.kind === "ref" && stripeSubscriptionId) {
      await settleReferralsForSignupOrg(orgId).catch((err) =>
        console.warn("[signup] referral settle failed:", err),
      );
    }
  }

  // THE PARTNER'S ATTRIBUTION, written now rather than left to the webhook. At
  // session creation there was no organisation for the subscription's metadata
  // to name, so customer.subscription.created could not be mapped and wrote
  // nothing; the next event used to repair it — unless the shop upgraded first,
  // and the replacement carries no code. The subscription came back expanded
  // with the session above; on clover its discounts are ids, which takes one
  // Stripe call when a code was used. Best-effort: the webhook and the
  // reconcile cron still get their turn.
  if (stripeSubscription) {
    const client = isStripeEnabled() ? ((await getStripeClient().catch(() => null))?.stripe ?? null) : null;
    await syncSubscriptionFromStripe(stripeSubscription, client).catch((err) =>
      console.warn("[signup] subscription sync failed:", err),
    );
  }

  // The intent is spent; the done marker takes its place (see loadDone).
  await db.syncState.delete({ where: { key: key(token) } }).catch(() => {});
  const doneRec: DoneRecord = { userId, email: rec.email, sessionId, at: Date.now() };
  await db.syncState
    .upsert({
      where: { key: doneKey(token) },
      update: { cursor: JSON.stringify(doneRec) },
      create: { key: doneKey(token), cursor: JSON.stringify(doneRec) },
    })
    .catch(() => {});
  // The session hand-off: the client redeems this through the `signup-ticket`
  // provider so the shop lands on its dashboard already signed in, instead of
  // at the login wall with a password it typed two screens and one Stripe
  // round-trip ago.
  const ticket = await mintSigninTicket(userId);
  // Not for the QA Lab's own accounts (@qa.jobflex.test, lib/qaTestMode).
  if (sessionId && rec.analytics && !isQaSignup(rec)) {
    after(() => captureSignupOutcome(rec.analytics, billing.flow === "cardless" && stripeSubscriptionId ? stripeSubscriptionId : sessionId, analyticsOutcome, planSlug, analyticsLive, rec.landingIndustry ?? null, rec.utm ?? null, rec.signupVariant ?? null, rec.signupMode ?? null));
  }
  // The welcome email (landing-e pass A; every signup since 2026-09-16). Sent
  // after the response; a failure is logged, never shown — the account
  // already exists.
  {
    const welcome = {
      to: rec.email,
      name: rec.name,
      tradeTypes: rec.tradeTypes ?? [],
      landingIndustry: rec.landingIndustry ?? null,
      firstChargeAt: trialEnd ?? new Date(Date.now() + storedTrialOffer(rec.trialOffer).days * 24 * 60 * 60 * 1000),
      trialDays: storedTrialOffer(rec.trialOffer).days,
      cardless: billing.flow === "cardless",
      pages: planSlug === CUSTOM_PLAN_SLUG ? chosen : null,
    };
    // A sign-up by text: the welcome waits for the address to be proven (actions/phoneSetup sends it then).
    if (phone) {
      const { to: _to, firstChargeAt, ...rest } = welcome;
      void _to;
      await keepWelcomeLater(db, userId, { ...rest, tradeTypes: [...rest.tradeTypes], pages: rest.pages ? [...rest.pages] : null, firstChargeAt: firstChargeAt.toISOString() }).catch((e) => console.warn("[signup] welcome not kept:", e));
    } else after(() => sendWelcomeFirstEstimate(welcome).catch((e) => console.warn("[signup] welcome email failed:", e)));
  }
  return { ok: true, email: rec.email, ticket, orgId, userId };
}

/** A number that found an account between its code and the card page's return. */
const PHONE_TAKEN_LATE = "That number already has a JobFlex account. Sign in with it — nothing was charged here.";

/* ── local helpers (the auth action's, kept private to this file) ───────── */

function slugify(v: string): string {
  return (
    v
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "shop"
  );
}

async function uniqueSlug(base: string): Promise<string> {
  let candidate = base;
  for (let i = 0; i < 40; i++) {
    // `jobflex` is the house's own address (/estimate/jobflex/<trade>, lib/webEstimator): never a shop's.
    const hit = candidate === HOUSE_SLUG || (await db.organization.findUnique({ where: { slug: candidate }, select: { id: true } }));
    if (!hit) return candidate;
    candidate = `${base}-${createHash("sha1").update(base + i).digest("hex").slice(0, 4)}`;
  }
  return `${base}-${randomUUID().slice(0, 6)}`;
}
