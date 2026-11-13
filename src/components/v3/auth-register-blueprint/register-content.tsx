"use client";

// Auth · Create account — Blueprint edition. Pixel-identical port of
// `jobflex-auth-register-blueprint.html`.
//
// This page is STANDALONE: an auth surface ships its own chrome (brand lockup,
// split layout, dark drafting-sheet right panel) and does NOT mount inside
// components/v3/blueprint-shell — that shell's sidebar + topbar belong to the
// signed-in contractor dashboard. `.bp` is the wrapper that carries the donor's
// `:root` tokens and `body` rules — see the header of auth-register.module.css.
//
// The markup below is the donor's <body> verbatim, in source order:
//   sprite · main.auth ( section.auth-form [ brand · ref-banner · stepper ·
//   step1 · step2 · stepDone ] · aside.auth-side [ side-wash · side-perk ·
//   side-card ] )
//
// Adaptations (format only): HTML attributes become their JSX spellings
// (class → className, …), the donor's HTML entities (&amp; …) become the
// characters they encode, and the donor's three inert `href="…html"` links
// become the app routes they name.
//
// BEHAVIOUR. The donor's own script is ported in full — show/hide password,
// chip toggling with its live counter, the two-step progression with its
// literal validation strings, the perk/Google button label swaps, and the
// `--news-h` measurement that positions the perk block above the quote card.
// Grafted onto it, unchanged, is the live registration wiring the classic
// /auth/register page carried: registerAccount (server action) → next-auth
// signIn, the promo/referral attribution capture, and the Google OAuth entry.
// No server action, API route or Prisma call was added or altered.

import { PlanConfetti } from "@/components/billing/PlanConfetti";
import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import { getSession, signIn } from "next-auth/react";
import { trackTraffic, trafficIdentity } from "@/lib/traffic-client";
import { setSignupPosition, signupLeavingTo, signupProblem, startSignupWatch } from "@/lib/signup-watch";
import { claimPageLoad, hiddenBefore } from "@/lib/pageClock";
import { reasonOfMessage } from "@/lib/signup-watch-shared";
import { TRAFFIC_EVENTS } from "@/lib/traffic-contract";
import { createPortal } from "react-dom";
// The store, not Toast.tsx: its re-export still carried the host's framer-motion and tailwind-merge into the
// sign-up's first JavaScript (~42 KB gzip, 2026-10-23). The root layout's lazy host draws the toast.
import { toast } from "@/components/ui/toast-store";
import { checkEmailAvailable, completeCompanySetup } from "@/actions/auth";
import type { GooglePrefill, SetupPrefill } from "@/app/(auth)/auth/register/register-responsive";
import { TRADE_TYPES, type TradeType } from "@/lib/tradeTypes";
import type { EditionId } from "@/lib/editions";
import { annualDeal, dealDollars, offersYearly, planTerm, sharedDealWords, termFromParam, BILLING_PARAM, type BillingTerm } from "@/lib/planDeal";
import { firstBillCents } from "@/lib/firstMonthDiscount";
import { PlanCardHead, PlanDealSlot, PlanPrice, PlanTermSwitch, recalledBillingTerm, rememberBillingTerm } from "@/components/billing/PlanTermSwitch";
import type { UtmParams } from "@/components/v3/landing-e/landing-variants";
import { GoogleOneTap } from "@/components/auth/google-one-tap";
import { OpenInBrowser } from "@/components/auth/open-in-browser";
import { useInAppBrowser } from "@/components/auth/use-in-app-browser";
import type { InAppBrowser } from "@/lib/inAppBrowser";
import { trackMetaLeadOnce } from "@/lib/metaLead";
import { RegisterSprite } from "./register-sprite";
import { ReferralBanner, type RegisterAttribution } from "./referral-banner";
import { PasswordlessStep } from "./passwordless-step";
import { autoPlanFor, type AutoPlanOffer } from "@/lib/signupAutoPlan";
import { rememberOtpDraft, rememberSignupMode, type SignupMode } from "@/lib/signupMode";
import { forgetOtpDraft, otpPendingState } from "@/actions/signupOtp";
import { SPOTLIGHT, SPOTLIGHT_MISSING, SPOTLIGHT_TAG, keptAdTool, spotlightInPlan, planCardRows, rememberSpotlightVisit, spotlightBanner, type SpotlightTool } from "@/lib/planSpotlight";
import type { OtpRestore } from "@/lib/signupOtp";
import {
  applySignupPromo,
  googleSignupIdentity,
  signupPlans,
  type SignupPlan,
  type SignupPromo,
} from "@/actions/signupPaywall";
import { useTrialOffer, useTrialOfferExposure } from "@/components/providers/trial-offer";
import { trialLine } from "@/lib/trialPolicy";
import {
  completePendingSignup,
  requestCardlessTrial,
  startPendingSignup,
  startVerifiedCardlessTrial,
  updatePendingSignupAttribution,
  updatePendingSignupPages,
} from "@/actions/signupCheckout";
import {
  CUSTOM_BASE_CENTS,
  CUSTOM_BASE_FEATURES,
  CUSTOM_PAGES,
  CUSTOM_PAGE_CENTS,
  CUSTOM_PLAN_SLUG,
  customPriceCents,
} from "@/lib/customPlan";
import styles from "./auth-register.module.css";
import { ProductMark } from "@/components/brand/ProductMark";
import { markQaVisitor } from "@/lib/qaEmail";
import { homeownerDoorFor } from "@/lib/home/homeownerDoor";
import { ToolsCardPage } from "./tools-card-page";
import { CARD_DECLINED_LINE, CARD_HOLD_NOTICE } from "@/lib/signupCardHoldWords";
import { isStripeEmailCode, prettyUsPhone, STRIPE_EMAIL_LINES } from "@/lib/phoneLoginShared";
import { isToolsSlug, toolPlanById, type Catalog, type ToolId, type ToolPlanId } from "@/lib/toolPlans/shared";

/* A PHONE (≤768px) — the plan step's cards are a two-column grid there
   (auth-register.module.css); a few behaviours follow the width too. A media
   query, never the user agent; the server draws the desk's, the client
   corrects on its first frame (the plans arrive after). */
const HANDHELD = "(max-width: 768px)";
function subscribeHandheld(onChange: () => void) {
  const mq = window.matchMedia(HANDHELD);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
/* The plan this tab last chose, so a cancelled Checkout (or the Google return)
   reopens the phone's plan step on it; `?plan=<slug>` names one from a link. */
const PLAN_KEY = "jf_signup_plan";
/* Straight to Professional bills monthly — the price step 1 prints (app/(auth)/auth/register/checkout picks the month). */
const AUTO_TERM: BillingTerm = "MONTH";
function rememberPlan(slug: string | null) {
  try {
    if (slug) sessionStorage.setItem(PLAN_KEY, slug);
  } catch {
    /* storage blocked: the link alone decides */
  }
}
function recalledPlan(): string | null {
  try {
    return sessionStorage.getItem(PLAN_KEY);
  } catch {
    return null;
  }
}
/* THE HAND-OFF TO STRIPE IS THE SERVER'S (owner, 2026-10-19). The browser goes to ./checkout
   (app/(auth)/auth/register/checkout) and the answer is a 303 to Stripe's card page — or to the plan cards with a line
   when the page did not open. Nothing is kept in the browser to tell a back-out apart: Stripe's back arrow and the
   browser's Back both land on the plan cards (`checkout=cancelled`). */
type HandOffReason = "step1" | "google" | "plan_pick" | "card_declined";
/** The bank refused the $1 card check (lib/signupCardHold): the plan that Checkout was for, to open it again. */
/** `why`: absent for a card the bank refused; a code of lib/phoneLoginShared STRIPE_EMAIL_LINES when a sign-up by text
 *  came back from Stripe with an email its account cannot take (owner, 2026-11-12). */
type DeclinedPick = { plan: string | null; interval: string | null; tool: string | null; why?: string | null };
function checkoutHref(token: string, reason: HandOffReason, pick?: { slug: string; term: BillingTerm; tool?: string }): string {
  const q = new URLSearchParams({ signup: token, reason });
  if (pick) {
    q.set("plan", pick.slug);
    q.set("interval", pick.term);
    // The new plans' main tool ("" none); the server prices it again (lib/signupPricing).
    if (pick.tool !== undefined) q.set("tool", pick.tool);
  }
  return `/auth/register/checkout?${q.toString()}`;
}

/* THE LANDING'S COOKIE WRITERS, for the Google button only — they and the landing's variant table behind them
   (~50 KB raw) left step 1's first JavaScript on 2026-10-23. Fetched once the form is live, so a press finds them
   loaded; a fetch that fails still lets the press go on to Google. */
let landingMemory: Promise<[typeof import("@/components/v3/landing-e/landing-variant-effects"), typeof import("@/components/v3/landing-e/landing-variants")]> | null = null;
function loadLandingMemory() {
  landingMemory ??= Promise.all([import("@/components/v3/landing-e/landing-variant-effects"), import("@/components/v3/landing-e/landing-variants")]);
  return landingMemory;
}

// 1 account · 2 company · 3 THE PLAN (the paywall) · 4 done.
/** The picker's exit, in step with the 0.22s transform in the stylesheet. */
const PICKER_EXIT_MS = 220;

type Step = 1 | 2 | 3 | 4;

/** What a step says when its server action THREW. A production build withholds
 *  a thrown message (the visitor read "Minified React error #441", 2026-10-07),
 *  so a refusal the visitor should read is returned by the action, and a throw
 *  means our side failed. */
const SERVER_TROUBLE = "Something went wrong on our side. Try again in a minute.";

// How long the "Your shop is live" panel holds before it hands over to the
// dashboard. Shared by both register surfaces.
export const REDIRECT_SECONDS = 5;

// Donor `setStep`: items[0] is `on` at step 1 and `done` after it; items[1] is
// `on` at step 2, `done` at step 3, and bare at step 1.
function stItem(index: 0 | 1 | 2, step: Step): string {
  if (index === 0) return "st-item" + (step === 1 ? " on" : " done");
  if (index === 1) return "st-item" + (step === 2 ? " on" : step > 2 ? " done" : "");
  return "st-item" + (step === 3 ? " on" : step > 3 ? " done" : "");
}

/* THE CUSTOM PLAN AT SIGNUP is offered beside the catalogue cards only while
   CUSTOM_PLAN_ENABLED is on (lib/customPlanFlag, owner 2026-10-06: off sale
   until the custom plan's billing and page gate are rebuilt). The page reads
   the flag on the server and hands it in as `offerCustom`; the checkout
   routes refuse a custom purchase on their own when it is off. */

// Donor `#tradeNote`, verbatim.
function tradeNote(n: number): string {
  return n === 0
    ? "Pick at least one — leads are matched to these."
    : n + (n === 1 ? " trade" : " trades") + " selected — leads will be matched to these.";
}

export function RegisterContent({
  setup = null,
  google: googlePrefill = null,
  industry = null,
  spotlight = null,
  spotlightNarrow = false,
  spotlightUrl = null,
  edition = null,
  utm = null,
  inAppBrowser: inAppInitial = null,
  requiresCard: requiresCardInitial = true,
  initialError = null,
  offerCustom = false,
  steps = 3,
  mode = "password",
  otpRestore = null,
  autoPlan = null,
  prefill = null,
  appView = false,
  toolsMain = null,
}: {
  /* THE NEW PLANS (Base + Tools, part 4 — the Plans switch on): the ad's tool the card page opens with (the register
     page's read of the link, its trade, the 30-day memory). Null otherwise; the plan step asks the server again. */
  toolsMain?: ToolId | null;
  /* Step 1's name and email, back after the server refused a step 1 sent without JavaScript (?e1=). */
  prefill?: { name: string; email: string } | null;
  /* THE SIGN-UP SCREEN "inside the app" (owner, 2026-10-22, lib/signupView): the page's paper and photo give way to
     a picture of the app (app-preview.tsx, drawn by the page behind this) and the column becomes a card in the middle
     of it — a sheet on a phone. `data-appview` on the root; the rules are at the end of auth-register.module.css.
     (Not `inApp` — that is the Instagram/Facebook browser, below.) */
  appView?: boolean;
  /* STRAIGHT TO PROFESSIONAL (owner, 2026-10-15, lib/signupAutoPlan): the plan
     the server picked when the admin rule is "auto" — the short sign-up, then
     the card page for it (handed off by the server, ./checkout). Null: the plan
     cards, as built. */
  autoPlan?: AutoPlanOffer | null;
  /* THE PASSWORDLESS SIGN-UP (2026-10-10, lib/signupMode): step 1 is
     ./passwordless-step — name, email, a code from an email — and the plan
     follows; no password, no company screen. "password" is the sign-up as
     built, untouched. */
  mode?: SignupMode;
  /* Where a passwordless sign-up was left: the code screen, or the plan step
     of the pending signup it became (lib/signupOtp draftRestore). */
  otpRestore?: OtpRestore | null;
  /* THE SIGN-UP'S STEPS (owner, 2026-10-07, lib/trialPolicyServer): 3 =
     account · company · plan as built; 2 = step 1 also takes the business
     name and the trades (folded — what the shop does, not lead matching:
     leads come once specialties and the address are set in Settings) and
     goes straight to the plan; the company screen is never drawn. */
  steps?: 2 | 3;
  /* CUSTOM_PLAN_ENABLED (lib/customPlanFlag), read on the server: the custom
     plan's card and page picker on the plan step. */
  offerCustom?: boolean;
  /* signupTrialMode (lib/trialPolicyServer), read on the server. True: the plan
     step opens Stripe Checkout and the card is taken there, as it always was.
     False: the plan step starts the assigned trial with no card (onStartCardless). */
  requiresCard?: boolean;
  setup?: SetupPrefill | null;
  /* Instagram / Facebook / LINE / TikTok webview, read from the request's
     user agent on the server (lib/inAppBrowser), so the first paint already
     has no Google button. Corrected in the browser either way. */
  inAppBrowser?: InAppBrowser | null;
  /* The visit's utm_*, resolved on the server (query, else the landing's
     cookie). Rides into the signup intent and onto the organization. */
  utm?: UtmParams | null;
  /* Resolved from `?gsu=` on the server, so step 2 is what the first frame
     paints. Null on every other arrival. */
  google?: GooglePrefill | null;
  /* The trade the landing was opened on (`?industry=fencing`), resolved on
     the server. Pre-selects that chip on step 2 — a suggestion the visitor
     can change, never a lock — and rides along into the signup intent. */
  industry?: TradeType | null;
  /* THE TOOL THE VISITOR CAME FOR (lib/planSpotlight, owner 2026-10-14): its
     feature line is pinned first and marked on every plan card, so a roofer
     off the roofing ad sees the Roof estimator without reading the list. */
  spotlight?: SpotlightTool | null;
  /* NARROWING ONLY DURING THE AD VISIT (lib/planSpotlight spotlightNarrows, owner 2026-11-07): the other trade
     estimators hide while this URL or the visit's session cookie says roof / hvac / fence / deck. */
  spotlightNarrow?: boolean;
  /* The spotlight this page's own URL carried — remembered for the browser session. */
  spotlightUrl?: SpotlightTool | null;
  /* THE DOOR THE VISITOR CAME IN BY (2026-10-11, lib/editions): `?edition=deck`
     from the Deck Studio landing. Its plan is pre-selected and drawn first on
     the plan step; the trade chip comes with `industry`. */
  edition?: EditionId | null;
  /* Step 1's error on arrival: a Google address the server refused (a
     throwaway-mail domain — lib/disposableEmail). */
  initialError?: string | null;
}) {
  const offer = useTrialOffer();
  const router = useRouter();
  /* The trial takes a card when the server says so on the first render
     (signupTrialMode — the switch, the deployment's default and the day's
     ceiling on card-less trials, lib/trialPolicyServer), or when the plan step's request is told so later. */
  const [requiresCard, setRequiresCard] = React.useState(requiresCardInitial);
  /* IN-APP BROWSERS (2026-10-01): Google refuses its sign-in inside them
     ("403 disallowed_useragent") and One Tap does not render, so step 1 is
     the email form alone, with a quiet "Open in Safari / Chrome for Google
     sign-in" under it (components/auth/open-in-browser). */
  const inApp = useInAppBrowser(inAppInitial);
  /* SETUP MODE: a Google signup finishing step 2. Step 1 is done (Google did
     it), the plan step follows in the app (/dashboard/upgrade), and there is
     no pending-signup intent to park: the account already exists. */
  const setupMode = setup !== null;
  /* The two-step sign-up: the company's part folds into step 1 (never in
     setup mode, which is the company screen on its own). */
  const otp = mode === "otp" && !setupMode;
  const twoStep = steps === 2 && !setupMode && !otp;
  /* Straight to the card page (lib/signupAutoPlan): only ever a new sign-up. The page's answer is from when it was
     drawn; the plan step asks the server again as it opens (signupPlans → `liveAuto`), and that answer wins — a tab
     drawn before the owner turned the switch on (or off), a draft restored, an intent from an earlier visit all get
     what the switch says now (2026-10-17: a returning visitor was shown the plan cards). */
  const [liveAuto, setLiveAuto] = React.useState<AutoPlanOffer | null | undefined>(undefined);
  const auto = setupMode ? null : liveAuto !== undefined ? liveAuto : autoPlan;
  const planMode = auto ? "auto" : "pick";
  /* THE FORM (landing-e pass A, 2026-09-11; the only form since 2026-09-16):
     step 1 is name, email, password and — since 2026-09-26 (owner) — a
     password confirmation, checked here in the browser only; the business
     name is on step 2 — the progress shows all three steps from the first
     screen, every analytics event carries `variant: "e"` and the pending
     signup records it (the admin's d-vs-e history reads on). */
  const rootRef = React.useRef<HTMLDivElement>(null);
  const addrRef = React.useRef<HTMLInputElement>(null);

  /* THE RETURN FROM STRIPE. `?signup=<token>&session_id=…` is the success URL
     the checkout route set, and it is the only input this needs. Read through
     useSearchParams — NOT window.location: the window read returned null on
     the server render, so the server drew step 1 and the client drew step 3,
     and React threw the hydration-mismatch that made the whole return from a
     PAID checkout arrive as a crash-and-regenerate (owner's report,
     2026-08-31). useSearchParams gives both renders the same answer; the
     page is dynamic, so it needs no Suspense boundary (register-responsive). */
  const searchParams = useSearchParams();
  const ret = React.useMemo<{ token: string; sessionId: string | null; cancelled: boolean; failed: boolean; declined: DeclinedPick | null } | null>(() => {
    const t = searchParams?.get("signup");
    if (!t) return null;
    return {
      token: t,
      sessionId: searchParams.get("session_id"),
      cancelled: searchParams.get("checkout") === "cancelled",
      // ./checkout could not open Stripe's card page (an error, or nothing within eight seconds).
      failed: searchParams.get("checkout") === "failed",
      // The bank refused the $1 card check (a reload of that answer — the address the return wrote, below).
      declined:
        searchParams.get("checkout") === "declined"
          ? { plan: searchParams.get("plan"), interval: searchParams.get("interval"), tool: searchParams.get("tool"), why: searchParams.get("why") }
          : null,
    };
    // Read once: the params only change via full navigations on this page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* A PAID RETURN OPENS ON THE DONE PANEL, not on the plan page. Until
     2026-09-02 the plan step was drawn while completePendingSignup ran, so the
     visitor saw the pricing they had just paid for flash past before "Your
     shop is live" — which read as being sent back (owner's report). The done
     panel now carries a finalizing state (`payBusy`) for that second. */
  const [step, setStep] = React.useState<Step>(
    setupMode ? 2 : ret ? (ret.sessionId && !ret.cancelled ? 4 : 3) : otpRestore?.signupToken || otpRestore?.stage === "taken" ? 3 : googlePrefill ? (twoStep || otp ? 1 : 2) : 1,
  );
  useTrialOfferExposure(step === 3);
  /* GOOGLE ON THIS PAGE proves who the visitor is and nothing more (owner,
     2026-09-03). The auth callback parks the verified identity and comes back
     here with ?gsu=<handle>; the handle is read once and step 1 is filled
     from it, with the password fields replaced by a "verified" note. */
  const gsu = React.useMemo(() => searchParams?.get("gsu") ?? null, [searchParams]);
  const [google, setGoogle] = React.useState<{ handle: string; email: string } | null>(
    googlePrefill ? { handle: googlePrefill.handle, email: googlePrefill.email } : null,
  );
  const lastTrackedStep = React.useRef("");
  /* The passwordless sign-up's email path reads "otp" (traffic page: Email
     code signup); every step event also says which mode it ran in. */
  const trafficFlow = setupMode ? "setup" : google ? "google" : otp ? "otp" : "standard";
  const signupMode: SignupMode = otp ? "otp" : "password";
  /* THE FORM, WATCHED (owner, 2026-10-14: "where exactly do they stop, and is it us?"): which box, how long, every
     refusal with whose side it is, the tab going away and the page closing — lib/signup-watch. */
  React.useEffect(() => startSignupWatch(), []);
  React.useEffect(() => {
    // The email-code screens are the passwordless step's own to name; here the step and the flow.
    const screen = step >= 4 ? "done" : step === 3 ? "plan" : step === 2 ? "company" : otp ? "" : "account";
    setSignupPosition({ step: String(step), flow: trafficFlow, ...(screen ? { screen } : {}) });
  }, [step, trafficFlow, otp]);
  React.useEffect(() => {
    if (step === 4) return;
    const key = `${trafficFlow}:${step}`;
    if (lastTrackedStep.current === key) return;
    // Parent route effects must record the entry pageview before this screen.
    const timer = window.setTimeout(() => {
      lastTrackedStep.current = key;
      trackTraffic(TRAFFIC_EVENTS.step, { plan_mode: planMode, step, flow: trafficFlow, variant: "e", steps: twoStep || otp ? 2 : 3, mode: signupMode });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [step, trafficFlow, twoStep, otp, signupMode, planMode]);
  /* `?flow=otp` / `?flow=off` are kept for this browser (lib/signupMode). */
  React.useEffect(() => {
    rememberSignupMode(searchParams?.get("flow") ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, as the page opens
  }, []);
  /* True once the ticket minted by completePendingSignup has been redeemed:
     the browser holds a session, and step 4 may point at the dashboard. */
  const [signedIn, setSignedIn] = React.useState(false);

  /* THE PLAN STEP. Everything here is read from the live catalog after the
     account exists — the step cannot price itself before there is an org to
     price for, and `signupPlans` is owner-scoped. */
  const [plans, setPlans] = React.useState<SignupPlan[]>([]);
  /* Every plan as the catalog orders it — no plan is an edition's own (lib/editions: Deck Studio is an add-on). */
  const orderedPlans = plans;
  /* THE NEW PLANS' CARD PAGE (Base + Tools, part 4): set when signupPlans answers `tools` (the Plans switch on). The
     size and the main tool picked here go to the checkout as they are; it prices them again itself. */
  const [toolsCatalog, setToolsCatalog] = React.useState<Catalog | null>(null);
  const [toolsPick, setToolsPick] = React.useState<{ plan: ToolPlanId; main: ToolId | null }>({ plan: "professional", main: toolsMain });
  /* THE AD KEY THE SIGN-UP KEEPS (Base + Tools, part 5 — lib/planSpotlight keptAdTool): the new plans' main tool
     as its ad key ("video", "crm"), else the Classic spotlight — what the draft, the pending sign-up and the Google
     button's cookie carry, so a new plans' ad survives a trip to Google and back. Switch off: toolsMain is null and
     this is the spotlight, exactly as before. */
  const adToolKept = keptAdTool(toolsPick.main ?? toolsMain, spotlight) ?? null;
  /** What the checkout is told about the main tool: the pick on a new plan, nothing on a Classic one. */
  const toolFor = (slug: string | null | undefined): string | undefined => (isToolsSlug(slug) ? (toolsPick.main ?? "") : undefined);
  /* Custom and catalog plans share the saved offer returned by signupPlans. */
  const [customTrialDays, setCustomTrialDays] = React.useState<number>(offer.days);
  /* The row of cards. On a phone it is a swiped row again (owner, 2026-10-14):
     one full card in the middle, its neighbours at the edges, dots under it
     (auth-register.module.css). See the rail's effects below. */
  const plansRef = React.useRef<HTMLDivElement>(null);
  const handheld = React.useSyncExternalStore(subscribeHandheld, () => window.matchMedia(HANDHELD).matches, () => false);
  const isClient = React.useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [planSlug, setPlanSlug] = React.useState<string | null>(null);
  /* MONTHLY ONLY for now (owner, 2026-09-04): the yearly tier is unreviewed,
     so the billing switch is gone from every plan surface. The type is kept
     wide so the price math below stays ready for the day it comes back. */
  /* ANNUAL IS BACK (owner, 2026-10-11), AS ONE SWITCH (owner, 2026-10-12): Monthly | Annual over the
     cards (components/billing/PlanTermSwitch), the same switch the landing, /pricing and the upgrade page
     draw. Monthly unless the visitor picked Annual on the landing or /pricing — the start link carries
     ?billing=annual — or earlier in this tab (sessionStorage, so the Google return, the emailed code and
     a cancelled Checkout come back to it). The checkout bills the term the card shows: a plan with no
     yearly price bills monthly (lib/planDeal planTerm). */
  const [interval, setIntervalState] = React.useState<BillingTerm>(() => termFromParam(searchParams?.get(BILLING_PARAM)) ?? "MONTH");
  const setInterval = React.useCallback((t: BillingTerm) => {
    setIntervalState(t);
    rememberBillingTerm(t);
  }, []);
  React.useEffect(() => {
    const fromLink = termFromParam(searchParams?.get(BILLING_PARAM));
    if (fromLink) rememberBillingTerm(fromLink);
    else {
      const kept = recalledBillingTerm();
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sessionStorage exists only in the browser; this is the one read of it
      if (kept) setIntervalState(kept);
    }
    // once, as the page opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [plansErr, setPlansErr] = React.useState<string | null>(
    // Straight-to-Professional says it calmly in its own note over the cards (data-auto-plan-back), not as an error.
    ret?.cancelled && !auto ? "Checkout was cancelled — your account has not been created yet." : null,
  );
  /* THE BANK SAID NO TO THE $1 CARD CHECK (owner, 2026-11-11 — lib/signupCardHold): no account, the subscription of
     that Checkout cancelled. The plan step opens with one line and one button, which opens a new Checkout for the same
     plan; the name and the email stay on the pending sign-up, nothing is typed again. */
  const [declined, setDeclined] = React.useState<DeclinedPick | null>(ret?.declined ?? null);
  /* THE PLAN STEP WITH NOTHING TO SELL (passwordless, 2026-10-14): the
     address has an account by now ("taken" — the plan step offers sign-in),
     or the pending signup ran out ("expired" — back to step 1, the fields
     filled). Read as the page opens (lib/signupOtp draftRestore), before a
     plan is started and when one is refused (otpPendingState). */
  const [gate, setGate] = React.useState<{ kind: "taken"; email: string; phone?: string } | { kind: "expired" } | null>(
    otpRestore?.stage === "taken" ? { kind: "taken", email: otpRestore.email, phone: otpRestore.phone || undefined } : null,
  );
  const [checkoutReady, setCheckoutReady] = React.useState(true);
  const [promo, setPromo] = React.useState<SignupPromo | null>(null);
  const [promoText, setPromoText] = React.useState("");
  const [promoBusy, setPromoBusy] = React.useState(false);
  const [promoErr, setPromoErr] = React.useState<string | null>(null);
  /* THE FIRST CHARGE'S DATE (owner, 2026-10-10): "Free until Oct 13, then
     $95/mo" beside every price — the server's today plus the saved offer's
     days, the same days Stripe is given. The cards arrive with it. */
  const [firstChargeAt, setFirstChargeAt] = React.useState<number | null>(null);
  const freeUntil = firstChargeAt ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(firstChargeAt)) : null;
  /** "Free until Oct 13, then $95/mo" — the price after a code's discount, to
   *  the cent as Stripe charges it; without a card, "… No card needed." */
  const freeUntilLine = (cents: number, per: string, monthlyCents: number) => {
    if (!freeUntil) return null;
    if (!requiresCard) return `Free until ${freeUntil}. No card needed.`;
    // A first-month code takes one month's worth off a yearly bill (lib/firstMonthDiscount).
    const v = firstBillCents(per === "/yr" ? "YEAR" : "MONTH", cents, monthlyCents, promo?.percentOff ?? 0) / 100;
    return `Free until ${freeUntil}, then $${Number.isInteger(v) ? v.toFixed(0) : v.toFixed(2)}${per}`;
  };
  /** The card's "Free until Oct 19, then $405/yr" — the date and the price only (the
   *  free months are the head's stamp and the saving line, owner 2026-10-12). The
   *  other term's line lies in the same cell unpainted, so the row is one height on
   *  either side of the switch. */
  const whenLine = (monthlyCents: number, yearlyCents: number | null | undefined) => {
    const lineFor = (t: BillingTerm) => {
      const y = planTerm(t, yearlyCents) === "YEAR";
      return freeUntilLine(y ? (yearlyCents ?? 0) : monthlyCents, y ? "/yr" : "/mo", monthlyCents) ?? "";
    };
    return (
      <span className="pw-when">
        <span className="pw-when-now">{lineFor(interval)}</span>
        <span className="pw-when-ghost" aria-hidden="true">
          <span className="jf-ghost-t" data-c={lineFor(interval === "YEAR" ? "MONTH" : "YEAR")} />
        </span>
      </span>
    );
  };
  /* True from the first frame when Stripe has just sent them back: the account
     is being created before anything else can be clicked. Initial state rather
     than a setState inside the effect below. */
  const [payBusy, setPayBusy] = React.useState(Boolean(ret?.sessionId && !ret.cancelled));
  /* THE CARD WHOSE START BUTTON WAS PRESSED (owner, 2026-09-26: the active
     state landed on another card, not the one clicked). That button — and
     only that one — wears the pressed, busy state while checkout opens; the
     other start buttons dim behind it. Kept apart from `planSlug` so "Skip for
     now", which is busy too, never labels a card "Opening checkout…". */
  const [startingSlug, setStartingSlug] = React.useState<string | null>(null);
  /* Set once the browser is on its way to Stripe (./checkout). The busy state then stays up until Stripe's page
     replaces this one — resetting it straight away put every button back to idle (and clickable) for the second the
     browser spends loading Stripe. The address was turned into the plan cards' before leaving, so a page brought back
     by the Back button from the back/forward cache is drawn again by the server: the cards (2026-10-19). */
  const leavingRef = React.useRef(false);
  const [leaving, setLeaving] = React.useState(false);
  React.useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (!e.persisted || !leavingRef.current) return;
      leavingRef.current = false;
      window.location.reload();
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);
  /* THE CUSTOM PLAN. Not a catalog row — a base price plus the add-on pages
     the shop picks, so it is held here and priced by lib/customPlan (the same
     module the checkout route re-prices with, because a client number is never
     what gets charged). */
  const [customPages, setCustomPages] = React.useState<string[]>([]);
  /* THE PICKER OPENS AND CLOSES ON A CURVE, which takes two flags because it
     is mounted and unmounted rather than hidden: `pickerOpen` decides whether
     the dialog is in the tree at all, `pickerOn` is added one frame later so
     the enter transition has a start state to leave from, and dropped FIRST on
     the way out so the exit can play before the node goes. Same arrangement as
     the support composer — a dialog that pops in and vanishes reads as a
     glitch, and this one is opened by a card the shop is mid-comparison on. */
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [pickerOn, setPickerOn] = React.useState(false);
  const pickerExit = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  /* FOCUS GOES INTO THE PICKER AND COMES BACK OUT. The dialog is portalled to
     <body>, so with focus left on the card that opened it, Escape (heard on
     the dialog) did nothing and Tab walked the page behind the scrim. */
  const pickerBoxRef = React.useRef<HTMLDivElement>(null);
  const pickerReturn = React.useRef<HTMLElement | null>(null);

  const openPicker = React.useCallback(() => {
    if (pickerExit.current) {
      clearTimeout(pickerExit.current);
      pickerExit.current = null;
    }
    pickerReturn.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPickerOpen(true);
  }, []);

  const closePicker = React.useCallback(() => {
    setPickerOn(false);
    pickerExit.current = setTimeout(() => {
      setPickerOpen(false);
      pickerExit.current = null;
      pickerReturn.current?.focus({ preventScroll: true });
      pickerReturn.current = null;
    }, PICKER_EXIT_MS);
  }, []);

  // One frame after the node exists, not in the same commit: a class set in the
  // render that mounts it is the element's FIRST style, and there is nothing to
  // transition from.
  React.useEffect(() => {
    if (!pickerOpen) return;
    const id = requestAnimationFrame(() => {
      setPickerOn(true);
      pickerBoxRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(id);
  }, [pickerOpen]);

  React.useEffect(
    () => () => {
      if (pickerExit.current) clearTimeout(pickerExit.current);
    },
    [],
  );

  /* THE YEARLY SAVING, read off the catalog rather than written into the
     label. It is taken from the RECOMMENDED plan (the one the switch is most
     likely to be pressed against) and not from the biggest number in the list:
     a seeded $1 tier whose annual price is two dollars discounts by 83%, and
     advertising that against a $79 plan that saves 17% is a promise the
     checkout will not keep. Null when nothing in the catalog prices a year. */

  /** The pending signup this plan step belongs to. Parked by step 2, or carried
   *  back from Stripe on the return URL. */
  const [token, setToken] = React.useState<string | null>(ret?.token ?? otpRestore?.signupToken ?? null);

  /** Step 1's outcome for the analyst: passed, or refused and why. */
  const step1Outcome = (outcome: "continue" | "error", reason = "", message = "") => {
    trackTraffic(TRAFFIC_EVENTS.signupStep1, { plan_mode: planMode, outcome, reason, variant: "e", steps: twoStep ? 2 : 3, mode: signupMode });
    if (outcome === "error") signupProblem(reason, { message });
  };
  const trialDays =
    planSlug === CUSTOM_PLAN_SLUG
      ? customTrialDays
      : plans.find((p) => p.slug === planSlug)?.trialDays || offer.days;
  const customCents = customPriceCents(customPages, interval);
  /** The term a card is billed on: the switch's, or the month for a plan with no yearly price. */
  const termFor = (slug: string): BillingTerm =>
    slug === CUSTOM_PLAN_SLUG ? interval : planTerm(interval, plans.find((p) => p.slug === slug)?.yearlyPriceCents);
  /* The switch is drawn only when a card has a year to show; its "N months free" tag only when every
     yearly card (the custom one included, when drawn) gives the same whole months. */
  const showTerms = offersYearly(plans);
  const termTag = sharedDealWords([
    ...plans.filter((p) => p.yearlyPriceCents).map((p) => annualDeal(p.priceCents, p.yearlyPriceCents)),
    ...(offerCustom && plans.length > 0 ? [annualDeal(customPriceCents(customPages), customPriceCents(customPages, "YEAR"))] : []),
  ]);
  /* Every feature any plan lists, in the order the catalog gives them, and
     de-duplicated case-insensitively ("Everything in Starter" is a plan's own
     roll-up line and is dropped — it describes the column, not a feature). */
  const featureCard = React.useMemo(() => {
    const seen = new Set<string>();
    const rows: string[] = [];
    for (const p of plans) {
      for (const f of p.features) {
        const key = f.trim().toLowerCase();
        if (!key || key.startsWith("everything in") || seen.has(key)) continue;
        seen.add(key);
        rows.push(f.trim());
      }
    }
    /* The spotlighted tool's row, always drawn and pinned, marked by its gate; during the ad visit a roofer, fencer
       or HVAC visitor sees only their own estimator among the trade rows (lib/planSpotlight planCardRows, owner
       2026-11-07). */
    return planCardRows(rows, spotlight, spotlightNarrow);
  }, [plans, spotlight, spotlightNarrow]);
  const featureRows = featureCard.rows;
  /* The row the spotlight marks — null for no spotlight or an add-on tool. */
  const spotRow = featureCard.spot;
  React.useEffect(() => rememberSpotlightVisit(spotlightUrl), [spotlightUrl]);

  /* WHAT EACH PLAN ACTUALLY INCLUDES. The catalog writes the inheritance as a
     line of prose — "Everything in Starter" — so a naive per-plan lookup marked
     the cheaper plans' features as MISSING from the dearer ones, which read as
     Professional being worse than Starter. A plan carrying that roll-up
     inherits every feature of the plans before it, in catalog order. */
  const includedBySlug = React.useMemo(() => {
    const map = new Map<string, Set<string>>();
    let inherited = new Set<string>();
    for (const p of plans) {
      const own = p.features.map((f) => f.trim().toLowerCase());
      const rollsUp = own.some((f) => f.startsWith("everything in"));
      const set = new Set<string>(rollsUp ? inherited : []);
      for (const f of own) {
        if (!f || f.startsWith("everything in")) continue;
        set.add(f);
      }
      map.set(p.slug, set);
      inherited = set;
    }
    return map;
  }, [plans]);

  const [name, setName] = React.useState(setup?.name ?? googlePrefill?.name ?? prefill?.name ?? "");
  const [biz, setBiz] = React.useState(setup?.businessName ?? "");
  const [email, setEmail] = React.useState(setup?.email ?? googlePrefill?.email ?? prefill?.email ?? "");
  const [password, setPassword] = React.useState("");
  const [showPw, setShowPw] = React.useState(false);
  /* THE CONFIRMATION (owner, 2026-09-26). Checked here in the browser only —
     the server still receives the one password. Its error belongs to the
     field and prints under it: shown once the visitor leaves the field having
     typed something, or presses Continue, and gone the moment the two match. */
  const [password2, setPassword2] = React.useState("");
  const [showPw2, setShowPw2] = React.useState(false);
  const [pw2Checked, setPw2Checked] = React.useState(false);
  const pw2Ref = React.useRef<HTMLInputElement>(null);
  const pw2Err = !pw2Checked
    ? null
    : !password2
      ? "Type your password again to confirm it."
      : password2 !== password
        ? "Passwords do not match."
        : null;
  // Step 1 is now gated on a server answer (is this email free?), so it has a
  // pending state the Continue button reads.
  const [checking, setChecking] = React.useState(false);
  /* THE FORM BEFORE THE JAVASCRIPT (2026-10-04; the inline prelude in
     app/(auth)/auth/register/page.tsx). On a phone the fields are drawn ~3 s
     before this script takes them over. Whatever was typed in that window is
     put back (React's hydration had reset the fields), a Continue pressed
     then is noted, and the analyst hears once per form load how long the
     form took to be usable and whether the visitor was ahead of it. */
  const step1Live = React.useRef(false);
  React.useEffect(() => {
    if (step1Live.current || setupMode || googlePrefill) return;
    step1Live.current = true;
    const w = window as Window & { __jfStep1?: { typedAt: number; submitAt: number; values: Record<string, string>; ready: boolean } };
    const pre = w.__jfStep1;
    /* Measured once, on the load the prelude ran in (lib/pageClock, 2026-10-17). A form reached without a reload —
       the logo, Back — finds the prelude spent or absent and sends nothing: its document's clock started earlier, on
       another page (a 23 ms remount was reported as "ready after 1364.6 s"). */
    const firstLoad = !!pre && !pre.ready && claimPageLoad("register");
    if (pre) {
      pre.ready = true;
      const v = { ...pre.values };
      pre.values = {};
      // On the next tick, not in the effect itself: the fields are restored once the form is live.
      window.setTimeout(() => {
        if (v.name) setName(v.name);
        if (v.email) setEmail(v.email);
        if (v.password) setPassword(v.password);
        if (v.password2) setPassword2(v.password2);
      }, 0);
    }
    if (!firstLoad) return;
    // Visible time since the load: the minutes the tab spent hidden are not the form's.
    const at = performance.now();
    const hidden = hiddenBefore(at);
    const readyMs = Math.round(at - hidden);
    const secs = (ms: number) => Math.round(ms / 100) / 10;
    // A form that took more than five seconds to come alive is ours to fix, whatever they did next — unless most of
    // the wait was a background tab, which the browser slows on purpose: said, but not ours.
    if (readyMs > 5000) {
      signupProblem("slow_form", {
        message: `ready after ${secs(readyMs)} s${hidden >= 1000 ? ` (+${secs(hidden)} s in a background tab)` : ""}`,
        ...(hidden > at / 2 ? { side: "outside" as const } : {}),
      });
    }
    trackTraffic(TRAFFIC_EVENTS.signupStep1, { plan_mode: planMode,
      outcome: "ready", ready_ms: readyMs,
      typed_before_ready: !!pre?.typedAt, typed_ms: pre?.typedAt || -1,
      early_submit: !!pre?.submitAt, submit_ms: pre?.submitAt || -1,
      variant: "e", mode: signupMode,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, as the form becomes live
  }, []);
  // The Google button's cookie writers, fetched once the form is live (loadLandingMemory).
  React.useEffect(() => {
    void loadLandingMemory().catch(() => {});
  }, []);

  const [addr, setAddr] = React.useState("");
  const [phone, setPhone] = React.useState(setup?.companyPhone || setup?.phone || "");
  const [trades, setTrades] = React.useState<TradeType[]>(industry ? [industry] : []);
  // A homeowner who came in on a trade's contractor ad: the way to a quote instead (lib/home/homeownerDoor, 2026-10-16).
  const homeDoor = homeownerDoorFor(industry);
  /* The two-step sign-up's trades fold: open until something is picked (a
     landing's ?industry= pre-picks one, so that visitor sees it folded). */
  const [foldOpen, setFoldOpen] = React.useState(!industry);
  // "Other" is the one chip that cannot say what it means on its own. Picking it
  // opens a free-text line so the trade the taxonomy has no word for still
  // reaches the company record instead of being flattened into a shrug.
  const [otherTrade, setOtherTrade] = React.useState("");
  const otherRef = React.useRef<HTMLInputElement>(null);

  // The success panel holds for five seconds before it hands over to the
  // dashboard — long enough to read that the shop is live, short enough that
  // nobody has to hunt for the button. The button is still there for anyone who
  // does not want to wait.
  const [countdown, setCountdown] = React.useState(REDIRECT_SECONDS);

  const [attribution, setAttribution] = React.useState<RegisterAttribution | null>(null);
  const [err1, setErr1] = React.useState<string | null>(initialError);
  const [err2, setErr2] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [doneNote, setDoneNote] = React.useState("");
  /* The first name on the done panel. Typed on step 1, or given by Google;
     absent on a Stripe return (a fresh load) so the heading drops the comma. */
  const doneName = name.trim().split(/\s+/)[0] || "";
  const [googleBusy, setGoogleBusy] = React.useState(false);

  React.useEffect(() => {
    /* Already resolved on the server (the normal path) — nothing to fetch, and
       nothing to move: the page opened on step 2. This effect is only the
       fallback for a client-side arrival at `?gsu=`, where no server render
       ran for this URL. */
    if (!gsu || googlePrefill || initialError) return;
    let live = true;
    void googleSignupIdentity(gsu).then(async (g) => {
      if (!live) return;
      if (!g) {
        setErr1("Your Google sign-in expired. Continue with Google again.");
        return;
      }
      setGoogle({ handle: gsu, email: g.email });
      setEmail(g.email);
      if (g.name) setName(g.name);
      /* STRAIGHT TO STEP 2 (owner's report, 2026-09-03). Coming back from
         Google used to land on step 1 with the fields filled in, which reads
         as being sent back to the start — the visitor has just told us who
         they are. Google supplies everything step 1 asks for EXCEPT the
         business name, so that one field is drawn on step 2 instead (the same
         `biz2` field the setup mode already uses) and step 1 is skipped.
         The email-availability check step 1 would have run happens here; a
         taken address stops on step 1 with the reason, which is the one case
         where the visitor still has something to do there. */
      try {
        const res = await checkEmailAvailable(g.email);
        if (!live) return;
        if (!res.available) {
          setErr1(res.message || "That email is already registered. Try signing in instead.");
          return;
        }
      } catch {
        /* The check is a courtesy — startPendingSignup re-checks server-side
           before anything is created, so a failed lookup must not strand a
           verified visitor on a step they cannot complete. */
      }
      if (live) setStep(twoStep || otp ? 1 : 2);
    });
    return () => {
      live = false;
    };
  }, [gsu, googlePrefill, initialError, twoStep, otp]);

  /* ADDRESS SUGGESTIONS on the company address (owner, 2026-09-02). The same
     Google Places attach every blueprint page uses; the list is appended to
     <body>, so it carries its own class and its own styles (auth-register
     .module.css, `.jf-reg-sug`) — the shell's `.bp-sug` sheet is not loaded
     here. Free typing is left alone (`typed` picks are ignored); a chosen
     suggestion writes the formatted address into the field. The attach is
     loaded when step 2 opens, not with step 1's first JavaScript (2026-10-23). */
  React.useEffect(() => {
    if (step !== 2) return;
    const el = addrRef.current;
    if (!el) return;
    let live = true;
    let detach: (() => void) | null = null;
    void import("@/components/v3/blueprint-shell/places-suggest").then(({ attachPlacesSuggest }) => {
      if (!live) return;
      detach = attachPlacesSuggest(el, {
        className: "jf-reg-sug",
        onPick: (p) => {
          if (p.typed) return;
          setAddr(p.formatted);
        },
      });
    });
    return () => {
      live = false;
      detach?.();
    };
  }, [step]);

  /* The catalog is read when the plan step opens, not on mount: before the
     account exists there is no owner to read it as. */
  React.useEffect(() => {
    if (step !== 3) return;
    let live = true;
    void signupPlans(token ?? undefined, { asked: searchParams?.get("plan") ?? null, edition: edition === "deck" ? "deck" : null, tool: spotlight, mainTool: toolsPick.main })
      .then((res) => {
        if (!live) return;
        setPlans(res.plans);
        // The switch as it stands now (an older server sends no `autoPlan`: the page's own answer stays). Straight to
        // Professional opens on its plan — a card this tab remembered (Starter, say) does not override it.
        const nowAuto = "autoPlan" in res ? (res.autoPlan ?? null) : autoPlan;
        setLiveAuto(nowAuto);
        // A tab drawn before the switch went on, its code typed after: the switch as it stands now — off to Stripe by
        // the server, as step 1 would have gone (no plan screen, no cards). Not a return: that one is the cards.
        // Nor a declined card: that one waits on the line and its button.
        if (nowAuto && requiresCard && token && !(ret && !ret.sessionId) && !declined && !res.tools) {
          leaveForCheckout(token, "step1");
          return;
        }
        // …and on Monthly: a remembered or linked Annual is not this tab's choice on this page (it can switch on the cards).
        if (nowAuto) setIntervalState(AUTO_TERM);
        if (nowAuto && res.plans.some((p) => p.slug === nowAuto.slug)) setPlanSlug(nowAuto.slug);
        // The new plans: one card page, on the size asked for (else Professional) and the ad's tool.
        if (res.tools) {
          setToolsCatalog(res.tools.catalog);
          setToolsPick({ plan: res.tools.plan, main: res.tools.main });
          setPlanSlug(toolPlanById(res.tools.plan).slug);
        } else setToolsCatalog(null);
        // A phone reopens on the plan named by the link (?plan=) or chosen before in this
        // tab — a cancelled Checkout comes back to it (2026-10-12); the desk as before.
        const asked = window.matchMedia(HANDHELD).matches ? (searchParams?.get("plan") ?? recalledPlan()) : null;
        const known = asked && (res.plans.some((p) => p.slug === asked) || (asked === CUSTOM_PLAN_SLUG && offerCustom && res.plans.length > 0)) ? asked : null;
        if (known) setPlanSlug((cur) => cur ?? known);
        setCustomTrialDays(res.customTrialDays);
        setFirstChargeAt(res.firstChargeAt);
        setCheckoutReady(res.checkoutReady);
        if (res.promo) setPromo(res.promo);
        // Pre-select what the catalog marks as the one to pick, else the first
        // — on every width now (owner, 2026-09-04: "arrive already looking at
        // the most-picked plan").
        const pick = (res.plans.find((p) => p.highlight) ?? res.plans[0])?.slug ?? null;
        setPlanSlug((cur) => cur ?? pick);
      })
      .catch(() => {
        if (live) setPlansErr("Couldn't load the plans. You can pick one later in Subscription.");
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the link and the flag are read once, as the catalog arrives
  }, [step, token, edition]);

  /* The phone's choice, kept for this tab (a cancelled Checkout reopens on it). */
  React.useEffect(() => {
    if (step === 3 && handheld) rememberPlan(planSlug);
  }, [step, handheld, planSlug]);

  /* THE PHONE'S RAIL (owner, 2026-10-14). The card in the middle is the choice:
     the rail opens on the chosen card — the most-picked one, or the plan the link
     or this tab named — centred before the first paint (a layout effect, so there
     is no visible jump), and is set again whenever the rail changes size until a
     finger, a wheel or a key touches it (the sheet's slide-in and the fonts
     arriving can move a card under it). A swipe that settles on a card makes that
     card the choice; a tap on a card, or on its start button, chooses it and
     brings it to the middle. The dots follow the card in the middle as it moves. */
  const planSlugRef = React.useRef(planSlug);
  React.useLayoutEffect(() => {
    planSlugRef.current = planSlug;
  }, [planSlug]);
  const railTouched = React.useRef(false);
  const [railAt, setRailAt] = React.useState<number | null>(null);
  const centreCard = React.useCallback((slug: string | null, smooth: boolean) => {
    const rail = plansRef.current;
    const card = slug ? rail?.querySelector<HTMLElement>(`[data-plan-card="${slug}"]`) : null;
    if (!rail || !card) return;
    // The rail is `position: relative` on a phone, so offsetLeft is in its own scroll space.
    const left = Math.max(0, card.offsetLeft - (rail.clientWidth - card.offsetWidth) / 2);
    if (Math.abs(rail.scrollLeft - left) <= 1) return;
    if (smooth && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) rail.scrollTo({ left, behavior: "smooth" });
    else rail.scrollLeft = left;
  }, []);
  const cardCount = orderedPlans.length + (offerCustom && plans.length > 0 ? 1 : 0);
  React.useLayoutEffect(() => {
    const rail = plansRef.current;
    if (step !== 3 || !handheld || !rail || cardCount === 0) return;
    railTouched.current = false;
    const place = () => {
      if (!railTouched.current) centreCard(planSlugRef.current, false);
    };
    place();
    const timers = [window.setTimeout(place, 120), window.setTimeout(place, 520)];
    const ro = new ResizeObserver(place);
    ro.observe(rail);
    const mark = () => {
      railTouched.current = true;
    };
    const MARKS = ["pointerdown", "touchstart", "wheel", "keydown"] as const;
    for (const ev of MARKS) rail.addEventListener(ev, mark, { passive: true });
    // The card nearest the middle: the dots now, the choice once the rail is still.
    const nearest = () => {
      const mid = rail.scrollLeft + rail.clientWidth / 2;
      const cards = Array.from(rail.querySelectorAll<HTMLElement>("[data-plan-card]"));
      let best = 0;
      cards.forEach((c, i) => {
        if (Math.abs(c.offsetLeft + c.offsetWidth / 2 - mid) < Math.abs(cards[best].offsetLeft + cards[best].offsetWidth / 2 - mid)) best = i;
      });
      return { i: best, slug: cards[best]?.dataset.planCard ?? null };
    };
    let frame = 0;
    let still = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setRailAt(nearest().i));
      window.clearTimeout(still);
      still = window.setTimeout(() => {
        const { slug } = nearest();
        if (slug && railTouched.current) setPlanSlug(slug);
      }, 140);
    };
    rail.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      timers.forEach(clearTimeout);
      ro.disconnect();
      cancelAnimationFrame(frame);
      window.clearTimeout(still);
      for (const ev of MARKS) rail.removeEventListener(ev, mark);
      rail.removeEventListener("scroll", onScroll);
    };
  }, [step, handheld, cardCount, centreCard]);
  /** A card chosen by a tap (the card or its start button): on a phone it comes to the middle. */
  const choosePlan = (slug: string) => {
    setPlanSlug(slug);
    if (!handheld) return;
    railTouched.current = true;
    centreCard(slug, true);
  };

  async function onApplyPromo() {
    if (promoBusy) return;
    setPromoBusy(true);
    setPromoErr(null);
    try {
      const res = await applySignupPromo(promoText);
      if (res.ok) {
        setPromo(res.promo);
        // Carried into account creation as the signup's attribution — there is
        // no organization to stamp until checkout returns.
        setAttribution({ kind: res.promo.kind, code: res.promo.code });
      } else setPromoErr(res.error);
    } catch {
      setPromoErr("Couldn't check that code.");
    } finally {
      setPromoBusy(false);
    }
  }

  /* The trial starts at Stripe. A plan card pressed goes to ./checkout with the plan and the term, and the server's
     303 opens Stripe's card page for it (2026-10-19: the browser no longer hands itself over). Codes and pages are
     stamped on the intent first — the session is priced from the intent alone. */
  async function onStartTrial(slug: string | null = planSlug, termAsked?: BillingTerm) {
    if (payBusy || !slug) return;
    // The clicked card can differ from the selection until React commits it.
    const clickedTrialDays = slug === CUSTOM_PLAN_SLUG
      ? customTrialDays
      : plans.find((p) => p.slug === slug)?.trialDays ?? 0;
    const term = termAsked ?? termFor(slug);
    trackTraffic(TRAFFIC_EVENTS.attempt, { plan_mode: planMode, plan: slug, interval: term, intent: clickedTrialDays > 0 ? "trial" : "purchase", flow: trafficFlow });
    setPayBusy(true);
    setStartingSlug(slug);
    setPlansErr(null);
    try {
      /* THE INTENT IS RE-STAMPED WITH THE PAGES FIRST. It was parked at the
         end of step 2, before any page was ticked, and the checkout route
         prices ONLY from the intent — so without this the custom plan always
         charged the bare $20 base whatever was selected. */
      if (slug === CUSTOM_PLAN_SLUG && token) {
        const upd = await updatePendingSignupPages(token, customPages);
        if (!upd.ok) {
          await planRefused(upd.error);
          return;
        }
      }
      /* THE CODE GOES WITH IT. Typed on this step, after the intent was
         parked — the checkout route prices from the intent alone. */
      if (token) {
        const stamped = await updatePendingSignupAttribution(token, attribution);
        if (!stamped.ok) {
          await planRefused(stamped.error);
          return;
        }
      }
      if (!token) {
        trackTraffic(TRAFFIC_EVENTS.error, { step: 3, reason: "checkout_rejected" }); signupProblem("checkout_rejected");
        await planRefused("That signup expired. Start again.");
        return;
      }
      leaveForCheckout(token, "plan_pick", { slug, term, ...(toolFor(slug) !== undefined ? { tool: toolFor(slug) } : {}) });
    } catch {
      trackTraffic(TRAFFIC_EVENTS.error, { step: 3, reason: "checkout_unavailable" }); signupProblem("checkout_unavailable");
      setPlansErr("Couldn't reach checkout — your account has not been created.");
    } finally {
      if (!leavingRef.current) {
        setPayBusy(false);
        setStartingSlug(null);
      }
    }
  }

  /** Off to ./checkout, whose 303 is Stripe's card page. The address becomes the plan cards' first, so Back from Stripe
   *  (the browser's, or a page restored later) lands on the cards, as Stripe's own back arrow does. */
  function leaveForCheckout(t: string, reason: HandOffReason, pick?: { slug: string; term: BillingTerm; tool?: string }) {
    signupLeavingTo("checkout");
    leavingRef.current = true;
    // From the plan step without a press (a stale tab): it is not drawn on the way out.
    if (!pick) setLeaving(true);
    try {
      // window.history.state, not null: the router's own state is kept, so it does not re-read the address (and redraw).
      // The new plans' card page comes back on the size and the tool picked.
      const back: Record<string, string> = { signup: t, checkout: "cancelled", ...(pick?.tool !== undefined ? { plan: pick.slug, ...(pick.tool ? { tool: pick.tool } : {}) } : {}) };
      window.history.replaceState(window.history.state, "", `/auth/register?${new URLSearchParams(back).toString()}`);
    } catch {
      /* Back then reopens the page it left; the server still sends ?signup= on to the cards */
    }
    window.location.assign(checkoutHref(t, reason, pick));
    /* A hand-off stopped in the browser (the stop button, no network) must not leave the cards busy for good. */
    window.setTimeout(() => {
      if (!leavingRef.current) return;
      leavingRef.current = false;
      setPayBusy(false);
      setStartingSlug(null);
    }, 20000);
  }

  /* "Try another card" (the $1 card check refused): a new Checkout for the plan the refused one was for. */
  function onTryAnotherCard() {
    if (!token || leavingRef.current) return;
    const d = declined;
    setPayBusy(true);
    if (d?.plan) leaveForCheckout(token, "card_declined", { slug: d.plan, term: d.interval === "YEAR" ? "YEAR" : "MONTH", ...(d.tool !== null ? { tool: d.tool } : {}) });
    else leaveForCheckout(token, "step1");
  }

  /* TESTING EXIT (owner's call, while the product is in testing). It creates
     the workspace WITHOUT a subscription — the only path that does. Everything
     else about it is the same as the paid return: the pending intent is spent,
     the account is created, the session is established here. */
  async function onSkipPlan() {
    if (payBusy || !token) return;
    setPayBusy(true);
    setPlansErr(null);
    try {
      const res = await completePendingSignup(token, null);
      if (!res.ok) {
        setPlansErr(res.error);
        return;
      }
      const auth = res.ticket
        ? await signIn("signup-ticket", { ticket: res.ticket, redirect: false })
        : null;
      setSignedIn(Boolean(auth && !auth.error));
      setDoneNote("Your workspace is ready to send its first proposal.");
      toast.success("Welcome to JobFlex", "Your workspace is ready.");
      setStep(4);
    } catch {
      setPlansErr("Couldn't finish the signup. Try again.");
    } finally {
      setPayBusy(false);
    }
  }

  /* THE CARD-LESS TRIAL (TRIAL_REQUIRES_CARD off). The same two re-stamps
     the checkout needs, then a confirmation link is emailed
     (requestCardlessTrial): the account and its assigned trial are created when
     the link is opened (/auth/register/confirm), not here — the owner's rule,
     2026-10-01: the address is confirmed before the dashboard opens. The plan
     step then says where the link went, with a way to send it again. */
  const [confirmSentTo, setConfirmSentTo] = React.useState<string | null>(null);
  const [confirmSlug, setConfirmSlug] = React.useState<string | null>(null);
  const [resent, setResent] = React.useState(false);
  /* The resend brake, shown: the server allows a link a minute (and three
     an hour); the button counts the minute down instead of failing. */
  const [resendAt, setResendAt] = React.useState(0);
  const [nowTick, setNowTick] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!confirmSentTo || resendAt <= Date.now()) return;
    const t = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [confirmSentTo, resendAt, nowTick]);
  const resendIn = Math.max(0, Math.ceil((resendAt - nowTick) / 1000));
  async function onStartCardless(slug: string | null = planSlug, termAsked?: BillingTerm) {
    if (payBusy || !slug || !token) return;
    const term = termAsked ?? termFor(slug);
    trackTraffic(TRAFFIC_EVENTS.attempt, { plan_mode: planMode, plan: slug, interval: term, intent: "trial", flow: trafficFlow, card: false });
    setPayBusy(true);
    setStartingSlug(slug);
    setPlansErr(null);
    try {
      if (slug === CUSTOM_PLAN_SLUG) {
        const upd = await updatePendingSignupPages(token, customPages);
        if (!upd.ok) {
          setPlansErr(upd.error);
          return;
        }
      }
      const stamped = await updatePendingSignupAttribution(token, attribution);
      if (!stamped.ok) {
        setPlansErr(stamped.error);
        return;
      }
      const res = await requestCardlessTrial(token, slug, term, toolFor(slug));
      if (!res.ok) {
        trackTraffic(TRAFFIC_EVENTS.error, { step: 3, reason: res.requiresCard ? "trial_needs_card" : "trial_rejected" }); signupProblem(res.requiresCard ? "trial_needs_card" : "trial_rejected");
        // The day's card-less trials are taken: the same plan step now opens
        // Stripe Checkout, and the line under it says why.
        if (res.requiresCard) setRequiresCard(true);
        if (res.resendAt) {
          setResendAt(res.resendAt);
          setNowTick(Date.now());
        }
        setPlansErr(res.error);
        return;
      }
      setResendAt(res.resendAt);
      setNowTick(Date.now());
      setResent(confirmSentTo !== null);
      setConfirmSlug(slug);
      setConfirmSentTo(res.email);
    } catch {
      trackTraffic(TRAFFIC_EVENTS.error, { step: 3, reason: "trial_unavailable" }); signupProblem("trial_unavailable");
      setPlansErr("Couldn't start the trial. Try again.");
    } finally {
      setPayBusy(false);
      setStartingSlug(null);
    }
  }
  /* The passwordless plan step asks first whether there is still something
     to sell (otpPendingState): an account for the address by now, or an
     intent that ran out, answers with the gate instead of a payment. */
  const gatingRef = React.useRef(false);
  /** `term`: the term to bill when it is not the one the cards show (straight to Professional: AUTO_TERM). */
  async function onStartPlan(slug: string, term?: BillingTerm) {
    if (otp && token && !payBusy) {
      if (gatingRef.current) return;
      gatingRef.current = true;
      setStartingSlug(slug);
      const shut = await otpGate().finally(() => {
        gatingRef.current = false;
        setStartingSlug(null);
      });
      if (shut) return;
    }
    void (requiresCard ? onStartTrial(slug, term) : otp ? onStartCardlessVerified(slug, term) : onStartCardless(slug, term));
  }

  /** The gate, when the passwordless intent has nothing left to sell. True: shown. */
  async function otpGate(): Promise<boolean> {
    if (!otp || !token) return false;
    const st = await otpPendingState(token).catch(() => null);
    if (!st || st.state === "live") return false;
    trackTraffic(TRAFFIC_EVENTS.error, { step: 3, reason: st.state === "taken" ? "pending_taken" : "pending_expired", mode: signupMode }); signupProblem(st.state === "taken" ? "pending_taken" : "pending_expired");
    setPlansErr(null);
    if (st.state === "taken") {
      setGate({ kind: "taken", email: st.email, phone: st.phone });
      return true;
    }
    if (st.name) setName(st.name);
    if (st.email) setEmail(st.email);
    rememberOtpDraft(null);
    setGate({ kind: "expired" });
    return true;
  }
  /** A refusal on the plan step: the gate when that is what it means, the words otherwise. */
  async function planRefused(error: string) {
    if (await otpGate()) return;
    setPlansErr(error);
  }
  const busyLabel = requiresCard ? "Opening checkout…" : "Starting your trial…";

  /* STRAIGHT TO PROFESSIONAL (owner, 2026-10-15, lib/signupAutoPlan) HAS NO SCREEN OF ITS OWN (owner, 2026-10-19).
     With a card, the server hands the sign-up to Stripe's card page after step 1, after Google and on a return
     (./checkout); this step is only ever the plan cards — Stripe's back arrow or Back (`checkout=cancelled`, with a
     calm note), or a card page that did not open (`checkout=failed`, with a line to try again). The "Add your card"
     screen of e7a88994 is gone: on a phone it was what a person saw on coming back from Stripe, and it read as the
     step after step 1. */
  const autoSlug = React.useMemo(() => {
    if (!auto || plans.length === 0) return null;
    if (plans.some((p) => p.slug === auto.slug)) return auto.slug;
    return autoPlanFor({ plans, tool: spotlight, asked: searchParams?.get("plan") ?? null })?.slug ?? null;
  }, [auto, plans, spotlight, searchParams]);
  const returned = !!ret && !ret.sessionId;
  /* …WITHOUT A CARD (the trial switch at "no card"): the picked plan's trial starts as the step opens, and the done
     panel follows. The step stays blank meanwhile — no plan screen; a refusal shows the cards with its reason. */
  // Not on the new plans: their card page is drawn first (the size and the tool can change there).
  const autoStart = !!auto && !auto.tools && !toolsCatalog && !requiresCard && step === 3 && !returned && !gate && !confirmSentTo && !plansErr;
  const autoRan = React.useRef(false);
  React.useEffect(() => {
    if (!autoStart || autoRan.current || !autoSlug || !token) return;
    autoRan.current = true;
    // After this render, not in it (the start sets state as it goes).
    void Promise.resolve().then(() => onStartPlan(autoSlug, AUTO_TERM));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the plan and the intent are both in
  }, [autoStart, autoSlug, token]);
  /* The cards drawn without a press, once per load for the analyst: back from Stripe, or its page did not open. */
  const plansShownSent = React.useRef(false);
  React.useEffect(() => {
    if (step !== 3 || plans.length === 0 || !returned || plansShownSent.current) return;
    const reason = ret?.failed ? "checkout_failed" : ret?.cancelled ? "returned" : null;
    if (!reason) return;
    plansShownSent.current = true;
    trackTraffic(TRAFFIC_EVENTS.plansShown, { reason, plan_mode: planMode, flow: trafficFlow });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, as the cards arrive
  }, [step, plans.length]);

  /* ONCE. The intent is spent by its first completion, and React's development
     StrictMode mounts effects twice — the second call came back "That signup
     expired" and threw the plan sheet over a shop that had just been created
     and signed in. A ref survives the simulated remount; a `live` flag would
     not. */
  const completedRef = React.useRef(false);
  React.useEffect(() => {
    if (!ret?.sessionId || ret.cancelled) return;
    if (completedRef.current) return;
    completedRef.current = true;
    void completePendingSignup(ret.token, ret.sessionId)
      .then(async (res) => {
        if (!res.ok) {
          /* A RELOAD after completion (see completePendingSignup): the shop
             exists. If the browser still holds its session, carry on to the
             dashboard; otherwise say so and point at sign-in. Never back to
             the plan page — nothing is left to buy. */
          if (res.done) {
            const s = await getSession().catch(() => null);
            const ok = Boolean(
              s?.user?.email && res.email && s.user.email.toLowerCase() === res.email.toLowerCase(),
            );
            setSignedIn(ok);
            setDoneNote(
              ok
                ? `Your subscription is active and your workspace is ready for ${res.email}.`
                : `Your shop is already set up for ${res.email}. Sign in to open it.`,
            );
            return;
          }
          /* The bank refused the $1 card check: the card page again, one line and its button. The address is written
             so a reload draws the same (and never runs this Checkout's return a second time). */
          if (res.declined) {
            const d = res.declined;
            try {
              const q: Record<string, string> = { signup: ret.token, checkout: "declined", ...(d.plan ? { plan: d.plan } : {}), ...(d.interval ? { interval: d.interval } : {}), ...(d.tool !== null ? { tool: d.tool } : {}), ...(d.why ? { why: d.why } : {}) };
              window.history.replaceState(window.history.state, "", `/auth/register?${new URLSearchParams(q).toString()}`);
            } catch {
              /* a reload then runs the return again, and the kept answer says "declined" again */
            }
            setDeclined(d);
            setStep(3);
            return;
          }
          // Back to the plan page, with the reason on it.
          setPlansErr(res.error);
          setStep(3);
          return;
        }
        if (!res.ticket) {
          setSignedIn(false);
          setDoneNote(`Your workspace is ready for ${res.email}. Sign in to open it.`);
          return;
        }
        /* THE SESSION IS ESTABLISHED HERE. The password typed on step 1 is
           gone on this fresh load, so the account is signed in with the
           single-use ticket the server minted alongside it (lib/signinTicket).
           Being sent to the login wall after paying read as the signup
           FAILING (owner's reports, 2026-08-31 and 2026-09-02). */
        const auth = await signIn("signup-ticket", { ticket: res.ticket, redirect: false });
        const ok = Boolean(auth && !auth.error);
        setSignedIn(ok);
        setDoneNote(
          ok
            ? `Your subscription is active and your workspace is ready for ${res.email}.`
            : `Your subscription is active and your workspace is ready for ${res.email}. Sign in to open it.`,
        );
      })
      .catch(() => {
        setPlansErr("Couldn't finish the signup. Try again.");
        setStep(3);
      })
      .finally(() => setPayBusy(false));
  }, [ret, router]);

  // Tick the countdown down on the success step, then leave — TO SIGN-IN. In
  // the pay-first flow nobody at step 4 holds a session (the account was
  // created seconds ago and no credentials were ever posted to NextAuth), so
  // the old /dashboard target only bounced through the middleware to a bare
  // login wall, which read as the signup failing. `next` carries them on to
  // the dashboard the moment they sign in. Gated on `step` so the clock cannot
  // start before the account exists, and cleared on unmount so a person who
  // clicks the button first is not navigated a second time.
  // A plain string here, a Route where it is used: a Route in the effect's dependency array made TypeScript build a
  // union past its 100,000-member limit (TS2590) once the app passed ~300 pages (2026-11-05).
  const doneHref: string = signedIn ? "/dashboard" : "/auth/login?next=%2Fdashboard";
  React.useEffect(() => {
    if (step !== 4 || payBusy) return;
    if (countdown <= 0) {
      router.push(doneHref as Route);
      return;
    }
    const t = window.setTimeout(() => setCountdown((n) => n - 1), 1000);
    return () => window.clearTimeout(t);
  }, [step, payBusy, countdown, router, doneHref]);

  function toggleTrade(t: TradeType) {
    setTrades((prev) => {
      const on = prev.includes(t);
      // Turning "Other" back off throws away whatever was typed under it, so a
      // stale label cannot be submitted for a chip that is no longer selected.
      if (t === "Other" && on) setOtherTrade("");
      // Focus the revealed input on the way in — the whole point of the chip is
      // that there is something else to say.
      if (t === "Other" && !on) window.setTimeout(() => otherRef.current?.focus(), 0);
      return on ? prev.filter((x) => x !== t) : [...prev, t];
    });
  }

  // Donor `#step1Form` submit. The donor's checks were client-side only, which
  // meant the one failure a person cannot fix by looking at the form — an email
  // that is already registered — was not reported until AFTER they had filled in
  // step 2 and pressed Create account, by which point the message pointed at a
  // field two screens back. Step 1 now also asks the server whether the address
  // is free, and only advances on a clean answer.
  async function onStep1(e: React.FormEvent) {
    e.preventDefault();
    if (checking) return;
    const n = name.trim();
    const em = email.trim();
    if (!n || !em) {
      setErr1("Name and email are required.");
      step1Outcome("error", "missing");
      return;
    }
    if (em.indexOf("@") === -1) {
      setErr1("Enter a valid email address.");
      step1Outcome("error", "email_invalid");
      return;
    }
    if (!google) {
      if (password.length < 8) {
        setErr1("Password must be at least 8 characters.");
        step1Outcome("error", "password_short");
        return;
      }
      /* The two must match before anything is asked of the server. The
         message is the confirmation field's own (pw2Err), so the general
         error block is cleared rather than saying it twice. */
      if (password2 !== password) {
        setPw2Checked(true);
        setErr1(null);
        pw2Ref.current?.focus();
        step1Outcome("error", "password_mismatch");
        return;
      }
    }
    setErr1(null);
    setChecking(true);
    try {
      const res = await checkEmailAvailable(em);
      if (!res.available) {
        const msg = res.message || "That email is already registered. Try signing in instead.";
        // The Google button that message points at is not on this screen in
        // an in-app browser.
        setErr1(
          inApp && /Continue with Google/.test(msg)
            ? "That email signs in with Google. Open this page in your browser (below) to continue with Google."
            : msg,
        );
        step1Outcome("error", /Google/.test(msg) ? "email_google" : /temporary|throwaway|disposable/i.test(msg) ? "email_disposable" : /Too many/.test(msg) ? "rate_limited" : /valid email/.test(msg) ? "email_invalid" : "email_taken", msg);
        return;
      }
    } catch {
      setErr1(SERVER_TROUBLE);
      step1Outcome("error", "check_failed");
      return;
    } finally {
      setChecking(false);
    }
    step1Outcome("continue");
    trackMetaLeadOnce(); // Meta Lead: step 1 passed with an address (lib/metaLead)
    if (twoStep) {
      /* The company's part of the one step: the business name and the
         trades are checked and the pending signup starts right here. */
      await finish(setErr1);
      return;
    }
    setStep(2);
  }

  /* Donor `finish(withCompany)` — but NOTHING IS CREATED HERE any more.
     Until 2026-08-28 this wrote the Organization, the owner User and the
     Membership, signed them in, and only then showed the plan: a visitor who
     never subscribed still ended up with a workspace. The details are parked as
     a PENDING INTENT instead (actions/signupCheckout), and the account is
     created when checkout comes back — or when the testing skip is used. */
  /* STEP 2 IS REQUIRED (owner's call, 2026-09-02): the address and at least
     one trade are what the Lead Center matches on, so a shop without them is a
     shop that never receives the free leads the step promises. The
     "Skip — set this up later" exit is gone with it. */
  async function finish(report: (message: string | null) => void = setErr2) {
    if (creating) return;
    /* The business name is asked for on this step, so it is validated here. */
    if (!biz.trim()) {
      report("Enter your business name.");
      signupProblem("biz_missing");
      return;
    }
    /* The two-step sign-up asks for the address later, in Settings. */
    if (!twoStep && !addr.trim()) {
      report("Enter your company address — leads are matched by distance.");
      signupProblem("addr_missing");
      return;
    }
    if (trades.length === 0) {
      report(twoStep ? "Pick at least one trade — what you do." : "Pick at least one trade — leads are matched to it.");
      setFoldOpen(true);
      signupProblem("trades_missing");
      return;
    }
    setCreating(true);
    report(null);
    try {
      if (setupMode) {
        await completeCompanySetup({
          businessName: biz.trim(),
          companyAddress: addr.trim(),
          companyPhone: phone.trim() || undefined,
          phone: phone.trim() || undefined,
          tradeTypes: trades,
          otherTrade:
            trades.includes("Other") && otherTrade.trim() ? otherTrade.trim() : undefined,
        });
        toast.success("Welcome to JobFlex", "Your company is set up. Pick a plan to go live.");
        router.push("/dashboard/upgrade" as Route);
        return;
      }
      setDoneNote(biz.trim() + " is ready to send its first proposal.");
      markQaVisitor(email); // a QA Lab address: no analytics from this browser (lib/qaEmail)
      const res = await startPendingSignup({
        analytics: trafficIdentity(),
        displayedTrialDays: offer.days,
        name: name.trim(),
        businessName: biz.trim(),
        email: email.trim(),
        ...(google ? { googleToken: google.handle } : { password }),
        companyAddress: addr.trim() || undefined,
        companyPhone: phone.trim() || undefined,
        tradeTypes: trades,
        otherTrade:
          trades.includes("Other") && otherTrade.trim() ? otherTrade.trim() : undefined,
        attribution: attribution ?? undefined,
        landingIndustry: industry ?? undefined,
        landingTool: adToolKept ?? undefined,
        utm: utm ?? undefined,
        signupVariant: "e",
        signupMode: twoStep ? "2-step" : "3-step",
      });
      if (!res.ok) {
        report(res.error);
        toast.error("Couldn't continue", res.error);
        signupProblem(reasonOfMessage(res.error), { message: res.error });
        return;
      }
      setToken(res.token);
      setStep(3);
    } catch {
      report(SERVER_TROUBLE);
      toast.error("Couldn't continue", SERVER_TROUBLE);
      signupProblem("pending_failed", { message: SERVER_TROUBLE });
    } finally {
      setCreating(false);
    }
  }


  // Donor `#googleBtn`: swaps its label for 1600ms. Here the swap accompanies
  // the real next-auth redirect instead of standing in for it.
  function onGoogle() {
    if (googleBusy) return;
    setGoogleBusy(true);
    window.setTimeout(() => setGoogleBusy(false), 1600);
    // A new address comes back here with ?gsu= (auth callback); an address
    // that already has an account signs in and lands on the dashboard. The
    // ad's click id rides to that return in a cookie (2026-10-01).
    signupLeavingTo("google");
    void loadLandingMemory()
      .then(([{ rememberFbclidForGoogle, writeLandingCookies }, { resolveLandingVariant }]) => {
        rememberFbclidForGoogle(searchParams?.get("fbclid"));
        // The return of a new address is built from cookies (lib/googleSignup):
        // the trade and the campaign this page came in on, and the mode — a
        // page handed over from an in-app browser has none of the landing's.
        if (otp) writeLandingCookies(industry ? resolveLandingVariant(industry) : undefined, utm ?? undefined, adToolKept);
      })
      .catch(() => {})
      .finally(() => {
        if (otp) rememberSignupMode(searchParams?.get("flow") ?? null);
        void signIn("google", { callbackUrl: "/auth/register" });
      });
  }

  /* THE PASSWORDLESS PATH'S PLAN STEP WITHOUT A CARD: the address is already
     proven (the code, the link or Google), so the trial and the account are
     created at once — no "Check your email" here (actions/signupCheckout
     startVerifiedCardlessTrial). The browser's CompleteRegistration and
     StartTrial carry the ids the server's copies used. */
  async function onStartCardlessVerified(slug: string | null = planSlug, termAsked?: BillingTerm) {
    if (payBusy || !slug || !token) return;
    const term = termAsked ?? termFor(slug);
    trackTraffic(TRAFFIC_EVENTS.attempt, { plan_mode: planMode, plan: slug, interval: term, intent: "trial", flow: trafficFlow, card: false, mode: signupMode });
    setPayBusy(true);
    setStartingSlug(slug);
    setPlansErr(null);
    try {
      if (slug === CUSTOM_PLAN_SLUG) {
        const upd = await updatePendingSignupPages(token, customPages);
        if (!upd.ok) {
          await planRefused(upd.error);
          return;
        }
      }
      const stamped = await updatePendingSignupAttribution(token, attribution);
      if (!stamped.ok) {
        await planRefused(stamped.error);
        return;
      }
      const res = await startVerifiedCardlessTrial(token, slug, term, toolFor(slug));
      if (!res.ok) {
        trackTraffic(TRAFFIC_EVENTS.error, { step: 3, reason: res.requiresCard ? "trial_needs_card" : "trial_rejected", mode: signupMode }); signupProblem(res.requiresCard ? "trial_needs_card" : "trial_rejected");
        if (res.requiresCard) setRequiresCard(true);
        if (res.done && res.email) {
          router.replace(`/auth/login?${new URLSearchParams({ next: "/dashboard", email: res.email }).toString()}` as Route);
          return;
        }
        await planRefused(res.error);
        return;
      }
      const auth = res.ticket ? await signIn("signup-ticket", { ticket: res.ticket, redirect: false }) : null;
      const ok = Boolean(auth && !auth.error);
      setSignedIn(ok);
      setDoneNote(`Your ${trialDays}-day free trial is on for ${res.email}. No card needed.`);
      setStep(4);
    } catch {
      trackTraffic(TRAFFIC_EVENTS.error, { step: 3, reason: "trial_unavailable", mode: signupMode }); signupProblem("trial_unavailable");
      setPlansErr("Couldn't start the trial. Try again.");
    } finally {
      setPayBusy(false);
      setStartingSlug(null);
    }
  }

  /* Back to step 1 from the gate: a fresh email step (remounted), the name
     and email still in the fields, no draft, no intent in the address. */
  const [otpEpoch, setOtpEpoch] = React.useState(0);
  function otpStartAgain(keepFields: boolean) {
    if (gate?.kind === "taken" && otpRestore?.draft) void forgetOtpDraft(otpRestore.draft);
    rememberOtpDraft(null);
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("signup");
      url.searchParams.delete("d");
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    } catch {
      /* step 1 works without it */
    }
    if (!keepFields) {
      setName("");
      setEmail("");
    }
    setGate(null);
    setPlansErr(null);
    setToken(null);
    setOtpEpoch((n) => n + 1);
    setStep(1);
  }

  /* The address is proven (code, link or Google) and the pending signup
     exists: the plan step, with the intent's token in the address so a
     reload opens it again. */
  function onOtpVerified(signupToken: string, via: "email" | "google" | "phone" = "email") {
    /* Straight to Professional with a card: no plan step — the server opens Stripe's card page (./checkout). The
       analyst still hears the plan stage reached, as when its screen flashed by on the way (`screen` says how). */
    if (auto && requiresCard && !auto.tools) {
      setToken(signupToken);
      trackTraffic(TRAFFIC_EVENTS.step, { plan_mode: planMode, step: 3, flow: trafficFlow, variant: "e", steps: 2, mode: signupMode, screen: "checkout" });
      trackTraffic(TRAFFIC_EVENTS.attempt, { plan_mode: planMode, plan: auto.slug, interval: AUTO_TERM, intent: "trial", flow: trafficFlow });
      leaveForCheckout(signupToken, via === "google" ? "google" : "step1");
      return;
    }
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("d");
      url.searchParams.delete("gsu");
      url.searchParams.set("signup", signupToken);
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    } catch {
      /* the plan step works without it */
    }
    setToken(signupToken);
    setStep(3);
  }

  const brand = (
    <Link className="brand" href={"/" as Route}>
      <ProductMark />
      <span className="brand-name">JobFlex</span>
    </Link>
  );

  /* The step indicator. Drawn twice — in the form column and on the plan
     sheet — because the two are separate layers that slide past each other;
     only one is ever visible. */
  /* The trade chips, the same on the company screen and inside step 1's
     fold — with their own note: the company screen's promises lead matching,
     the fold's says what you do and sends lead matching to Settings
     (owner, 2026-10-07). */
  const tradeChips = (note: string) => (
    <>
      <div className="chips" role="group" aria-label="Your trades">
        {TRADE_TYPES.map((t) => (
          <button
            key={t}
            className={trades.includes(t) ? "chip on" : "chip"}
            type="button"
            aria-pressed={trades.includes(t)}
            onClick={() => toggleTrade(t)}
          >
            {t}
          </button>
        ))}
      </div>
      {trades.includes("Other") && (
        <input
          ref={otherRef}
          className="fld-in fld-in--other"
          type="text"
          maxLength={80}
          placeholder="Name the trade — e.g. epoxy & garage floor coatings"
          aria-label="Your other trade"
          value={otherTrade}
          onChange={(e) => setOtherTrade(e.target.value)}
        />
      )}
      <span className="fld-note" id="tradeNote">
        {note}
      </span>
    </>
  );

  const stepper = twoStep || otp ? (
    <div className="stepper" id="stepper" data-steps="2">
      <div className={stItem(0, step)} data-step="1">
        <span className="st-n">1</span>
        <span className="st-txt">
          <span className="st-t">Account</span>
          <span className="st-h">Required</span>
        </span>
      </div>
      <span className="st-line"></span>
      <div className={stItem(2, step)} data-step="3">
        <span className="st-n">2</span>
        <span className="st-txt">
          <span className="st-t">Plan</span>
          <span className="st-h">Free trial</span>
        </span>
      </div>
    </div>
  ) : (
    <div className="stepper" id="stepper" data-steps="3">
      <div className={stItem(0, step)} data-step="1">
        <span className="st-n">1</span>
        <span className="st-txt">
          <span className="st-t">Account</span>
          <span className="st-h">Required</span>
        </span>
      </div>
      <span className="st-line"></span>
      <div className={stItem(1, step)} data-step="2">
        <span className="st-n">2</span>
        <span className="st-txt">
          <span className="st-t">Company</span>
          <span className="st-h">Required</span>
        </span>
      </div>
      {/* All three steps from the first screen (pass A). The sub-line names
          no number: the trial's length is set per plan in /admin/plans (7
          days as of 2026-09-26), and "14 days free" had gone stale. */}
      <span className="st-line"></span>
      <div className={stItem(2, step)} data-step="3">
        <span className="st-n">3</span>
        <span className="st-txt">
          <span className="st-t">Plan</span>
          <span className="st-h">Free trial</span>
        </span>
      </div>
    </div>
  );

  return (
    <div className={styles.bp} ref={rootRef} data-appview={appView ? "" : undefined}>
      <RegisterSprite />

      {/* TWO LAYERS, ONE MOTION. The account/company/done column and its art
          panel are `.auth`; the plan is its own full-width sheet. Entering the
          plan slides the whole screen off to the left while the sheet follows
          it in from the right — one strip, one curve, one duration — instead
          of the old arrangement where the art panel slid out on its own and
          the grid collapsed under it on a second timer. */}
      <main className={step === 3 ? "auth is-gone" : "auth"} aria-hidden={step === 3}>
        <section className="auth-form">
          {brand}

          <div className="auth-body">
          {/* A code carried in by the link (or the 30-day cookie) prices the
              Plan step too — the same `promo` a typed code sets in
              onApplyPromo, so the cards show "20% off · $63.20" rather than
              list price under a "code applied" banner two steps back. */}
          <ReferralBanner onChange={setAttribution} onResolved={setPromo} />

          {stepper}

          {/* ───── ШАГ 1 ───── */}
          {/* The donor's "Get started" kicker is gone (owner's call) — the
              stepper above already says which step this is, so the badge only
              repeated it. Same for step 2's "Almost there". */}
          <div className={step === 1 ? "step" : "step is-hidden"} id="step1">
            {otp ? (
              <>
                <PasswordlessStep
                  key={otpEpoch}
                  name={name}
                  setName={setName}
                  email={email}
                  setEmail={setEmail}
                  restore={otpEpoch ? null : otpRestore}
                  google={google}
                  inApp={inApp}
                  requiresCard={requiresCard}
                  auto={auto}
                  quick={!!auto && requiresCard}
                  planMode={planMode}
                  trialDays={offer.days}
                  industry={industry}
                  tool={adToolKept}
                  utm={utm}
                  attribution={attribution}
                  analytics={trafficIdentity}
                  fbclid={searchParams?.get("fbclid") || undefined}
                  initialError={err1}
                  onGoogle={onGoogle}
                  onVerified={onOtpVerified}
                />
                {step === 1 && !google && !inApp ? <GoogleOneTap /> : null}
              </>
            ) : (
            <>
            <h1 className="auth-h1">Register.</h1>

            <form id="step1Form" noValidate onSubmit={(e) => void onStep1(e)}>
              {/* The business name is asked for on step 2, so the name
                  stands alone here, full width. */}
              <div>
                <label className="fld">
                  <span className="fld-lbl">Your name</span>
                  <input
                    className="fld-in"
                    id="name"
                    placeholder="First and last"
                    autoComplete="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
              </div>
              <label className="fld">
                <span className="fld-lbl">Email</span>
                <input
                  className="fld-in"
                  type="email"
                  id="email"
                  placeholder="you@yourshop.com"
                  autoComplete="email"
                  inputMode="email"
                  value={email}
                  readOnly={Boolean(google)}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              {google ? (
                <div className="gsu-note" role="status">
                  <svg className="ic ic--brand">
                    <use href="#i-google" />
                  </svg>
                  <span>
                    Verified by Google as <b>{google.email}</b>. No password needed — you&apos;ll
                    sign in with Google.
                  </span>
                </div>
              ) : null}
              {!google ? (
              <>
              <label className="fld">
                <span className="fld-lbl">Password</span>
                <span className="pw-wrap">
                  <input
                    className="fld-in"
                    type={showPw ? "text" : "password"}
                    id="password"
                    placeholder="••••••••"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <button
                    className="pw-toggle"
                    type="button"
                    aria-label={showPw ? "Hide password" : "Show password"}
                    aria-pressed={showPw}
                    onClick={() => setShowPw((v) => !v)}
                  >
                    <svg className="ic" aria-hidden="true">
                      <use href={showPw ? "#i-eye-off" : "#i-eye"} />
                    </svg>
                  </button>
                </span>
                <span className="fld-note">At least 8 characters.</span>
              </label>
              {/* CONFIRM PASSWORD (owner, 2026-09-26): the same field, the
                  same eye, and its own error line under it. */}
              <label className="fld">
                <span className="fld-lbl">Confirm password</span>
                <span className="pw-wrap">
                  <input
                    ref={pw2Ref}
                    className="fld-in"
                    type={showPw2 ? "text" : "password"}
                    id="password2"
                    placeholder="••••••••"
                    autoComplete="new-password"
                    value={password2}
                    aria-invalid={pw2Err ? true : undefined}
                    aria-describedby="password2Note"
                    onChange={(e) => setPassword2(e.target.value)}
                    onBlur={() => {
                      if (password2) setPw2Checked(true);
                    }}
                  />
                  <button
                    className="pw-toggle"
                    type="button"
                    aria-label={showPw2 ? "Hide confirmation password" : "Show confirmation password"}
                    aria-pressed={showPw2}
                    onClick={() => setShowPw2((v) => !v)}
                  >
                    <svg className="ic" aria-hidden="true">
                      <use href={showPw2 ? "#i-eye-off" : "#i-eye"} />
                    </svg>
                  </button>
                </span>
                <span
                  className={pw2Err ? "fld-note fld-note--err" : "fld-note"}
                  id="password2Note"
                  aria-live="polite"
                >
                  {pw2Err ?? "Type it again to confirm."}
                </span>
              </label>
              </>
              ) : null}

              {twoStep ? (
                <>
                  <label className="fld">
                    <span className="fld-lbl">Business name</span>
                    <input
                      className="fld-in"
                      id="biz1"
                      placeholder="Company name"
                      autoComplete="organization"
                      value={biz}
                      onChange={(e) => setBiz(e.target.value)}
                    />
                  </label>
                  <details
                    className="fold"
                    id="tradesFold"
                    open={foldOpen}
                    onToggle={(e) => setFoldOpen((e.currentTarget as HTMLDetailsElement).open)}
                  >
                    <summary className="fold-sum">
                      <span className="fld-lbl">What you do</span>
                      <span className="fold-val">{trades.length ? trades.join(", ") : "Pick your trades"}</span>
                      <svg className="ic fold-ic" aria-hidden="true">
                        <use href="#i-arrow-r" />
                      </svg>
                    </summary>
                    {tradeChips("What you do — your estimators and proposals follow it. To receive leads, set your specialties and address in Settings after you sign in.")}
                  </details>
                </>
              ) : null}

              <button className="btn" type="submit" id="nextBtn" disabled={checking || creating}>
                {checking ? "Checking…" : creating ? "Creating…" : "Continue"}
                <svg className="ic">
                  <use href="#i-arrow-r" />
                </svg>
              </button>
              {/* The "Step 1 of 3 · 14 days free · card at step 3" line that
                  sat here is gone (owner, 2026-09-26). The trial terms are
                  stated on the plan step, beside the cards they apply to. */}
              <div className={err1 ? "err" : "err is-hidden"} id="err1">
                {err1}
              </div>
            </form>

            {inApp ? (
              <OpenInBrowser app={inApp} />
            ) : (
            <>
            <div className="divider">
              <span className="kpi-lbl">Have Gmail or a Google account?</span>
            </div>
            <button className="btn btn--ghost" type="button" id="googleBtn" onClick={onGoogle}>
              {googleBusy ? (
                <>
                  <svg className="ic">
                    <use href="#i-check" />
                  </svg>
                  Redirecting to Google…
                </>
              ) : (
                <>
                  <svg className="ic ic--brand">
                    <use href="#i-google" />
                  </svg>
                  Sign up with Google
                </>
              )}
            </button>
            </>
            )}

            <div className="foot">
              Already have an account?{" "}
              <Link className="link-ink" href={"/auth/login" as Route}>
                Sign in
              </Link>
            </div>
            {homeDoor ? (
              <div className="foot foot-home" data-home-door={homeDoor.key}>
                Homeowner looking for {homeDoor.thing}?{" "}
                <a className="link-ink" href={homeDoor.href}>
                  Get quotes from local pros
                </a>
              </div>
            ) : null}
            {/* Google One Tap (pass A): step 1 only, and only with
                NEXT_PUBLIC_GOOGLE_CLIENT_ID set. */}
            {step === 1 && !google && !setupMode && !inApp ? <GoogleOneTap /> : null}
            </>
            )}
          </div>

          {/* ───── ШАГ 2 ───── */}
          <div className={step === 2 ? "step" : "step is-hidden"} id="step2">
            <h1 className="auth-h1">
              {setupMode || google
                ? `Welcome${name.trim() ? `, ${name.trim().split(" ")[0]}` : ""}. Tell us about your company.`
                : "Tell us what you do."}
            </h1>
            {setupMode ? (
              <p className="auth-lede">{`Signed in with Google as ${email}. One more step and your shop is live.`}</p>
            ) : google ? (
              /* The account does NOT exist yet on this path — it is created
                 when checkout returns — so this says verified, not signed in. */
              <p className="auth-lede">{`Verified by Google as ${email}. No password needed.`}</p>
            ) : null}

            <form
              id="step2Form"
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                void finish();
              }}
            >
              <label className="fld">
                <span className="fld-lbl">Business name</span>
                <input
                  className="fld-in"
                  id="biz2"
                  placeholder="Company name"
                  autoComplete="organization"
                  value={biz}
                  onChange={(e) => setBiz(e.target.value)}
                />
              </label>
              <div className="grid2">
                <label className="fld">
                  <span className="fld-lbl">Company address</span>
                  <input
                    ref={addrRef}
                    className="fld-in"
                    id="addr"
                    placeholder="Street, city, state, ZIP"
                    autoComplete="off"
                    value={addr}
                    onChange={(e) => setAddr(e.target.value)}
                  />
                </label>
                <label className="fld">
                  <span className="fld-lbl">Company phone</span>
                  <input
                    className="fld-in"
                    type="tel"
                    id="phone"
                    placeholder="Phone number"
                    autoComplete="tel"
                    inputMode="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </label>
              </div>

              <div className="fld">
                <span className="fld-lbl">Trades you take</span>
                {tradeChips(tradeNote(trades.length))}
              </div>

              <div className="btn-pair">
                {setupMode ? null : (
                  <button
                    className="btn btn--ghost"
                    type="button"
                    id="backBtn"
                    onClick={() => setStep(1)}
                  >
                    <svg className="ic">
                      <use href="#i-back" />
                    </svg>
                    Back
                  </button>
                )}
                <button className="btn" type="submit" id="createBtn" disabled={creating}>
                  {creating ? (setupMode ? "Saving…" : "Creating…") : setupMode ? "Continue" : "Create account"}
                </button>
              </div>
              <div className={err2 ? "err" : "err is-hidden"} id="err2">
                {err2}
              </div>
              <p className="step-note">
                By creating an account, you agree to our{" "}
                <Link href="/terms" target="_blank" rel="noopener noreferrer"><u>Terms of service</u></Link>
                {" "}and acknowledge our{" "}
                <Link href="/privacy" target="_blank" rel="noopener noreferrer"><u>Privacy policy</u></Link>.
              </p>
            </form>

          </div>

          <div className={step === 4 ? "step" : "step is-hidden"} id="stepDone">
            {/* The plan turning on, once, when the workspace has settled —
                the same side-cannon confetti as the upgrade page's return leg. */}
            <PlanConfetti active={step === 4 && !payBusy} />
            <div className={payBusy ? "done-mark is-busy" : "done-mark"}>
              <svg className="ic">
                <use href="#i-check" />
              </svg>
            </div>
            {payBusy ? (
              <>
                <h1 className="auth-h1">Setting up your shop…</h1>
                <p className="auth-lede">Payment confirmed. Building your workspace.</p>
              </>
            ) : (
              <>
                <h1 className="auth-h1">{doneName ? `You're all set, ${doneName}.` : "You're all set."}</h1>
                <p className="auth-lede" id="doneNote">
                  {doneNote}
                </p>
                {auto ? (
                  <p className="fld-note" id="doneAutoNote">
                    Need different tools or another package? You can change your plan any time in Subscription.
                  </p>
                ) : null}
                <div className="btn-pair">
                  <Link className="btn" href={doneHref as Route}>
                    {signedIn ? "Open your dashboard" : "Sign in to your dashboard"}
                  </Link>
                </div>
                <p className="fld-note" role="status" id="doneCountdown">
                  {signedIn
                    ? countdown > 0
                      ? `Opening your dashboard in ${countdown}…`
                      : "Opening your dashboard…"
                    : countdown > 0
                      ? `Taking you to sign-in in ${countdown}…`
                      : "Taking you to sign-in…"}
                </p>
              </>
            )}
          </div>
          </div>
        </section>

        <aside className="auth-side">
          <div className="side-wash"></div>
          {/* THE PROMISE. One paper card on the ink field, top right, three
              lines long: what you get, why this step. It enters with step 2
              and leaves with it. */}
          <div className={step === 2 ? "side-perk is-on" : "side-perk"} id="sidePerk" aria-hidden={step !== 2}>
            <div className="pk">
              <span className="pk-eyebrow">
                <svg className="ic">
                  <use href="#i-gift" />
                </svg>
                Free leads
              </span>
              <h2 className="pk-h">Fill this out and you get free leads.</h2>
              <p className="pk-p">
                Homeowner jobs near you, matched to your trades and address. No cost, no cap.
              </p>
            </div>
          </div>

          {/* THE ART PANEL — see the note in the login page: a picture in the
              product's own drawing language instead of an invented quote.
              DESK ONLY, AND LIGHT (2026-10-16): a phone hides this panel under
              1000px, yet the plain <img> made every phone download the 1.3 MB
              PNG first thing — React preloads a shell image at high priority —
              and on an iPhone over cellular the form came alive after 13.9 s
              ("The form was slow to start"). The <picture> sources match only
              a desk, so a phone gets the 1×1 placeholder; the desk gets a 60 KB
              WebP of the same picture (PNG for a browser without WebP). */}
          <picture>
            <source media="(min-width: 1001px)" srcSet="/auth/side-site-2.webp" type="image/webp" />
            <source media="(min-width: 1001px)" srcSet="/auth/side-site-2.png" />
            <img
              className="side-art"
              id="sideCard"
              src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
              alt=""
              aria-hidden="true"
              decoding="async"
            />
          </picture>
        </aside>
      </main>

      <section className={step === 3 ? "plan-sheet is-in" : "plan-sheet"} aria-hidden={step !== 3}>
        {/* ONE COLUMN (owner, 2026-10-12): the sheet is as wide as the row of cards
            (`--pw-cols`), so the logo, the steps, the head, the cards and the foot
            share one left and one right edge. */}
        <div
          className="plan-sheet-in"
          style={{ "--pw-cols": toolsCatalog ? 2 : Math.max(1, orderedPlans.length + (offerCustom && plans.length > 0 ? 1 : 0)) } as React.CSSProperties}
        >
          {brand}
          {stepper}

          {/* ───── ШАГ 3 · THE PLAN ─────
              INDUSTRIAL DRAFTING BRUTALISM, the page's own language, pushed
              harder because this is the one screen that has to sell:
                · FULL BLEED. The art panel slides out and the comparison takes
                  the screen — three plans read as a table, and half a screen is
                  where that goes wrong.
                · ONE SHARED FEATURE LIST. Every plan prints the SAME rows: the
                  ones it includes in ink with a tick, the ones it does not in
                  grey with a dash. The gap between the columns is the argument
                  for the bigger plan, and it is visible without reading.
                · LESS TEXT, LOUDER TYPE. The per-plan paragraphs are gone; the
                  price is 44px, the plan name is the mono annotation layer, and
                  nothing on the card is a sentence.
                · The promo field carries its own APPLY inside the frame, so the
                  row is one object instead of a field and a stray button. */}
          <div
            className={step === 3 ? "step" : "step is-hidden"}
            id="stepPlan"
            style={autoStart || leaving || (otp && !returned && plans.length === 0 && !plansErr && !gate && !declined) ? { visibility: "hidden" } : undefined}
          >
            {/* Title and the billing switch on ONE line: the switch is the
                control that rewrites every price under it, so it belongs beside
                the question, not stacked under it where it read as a third
                heading. The trial sentence moved to the fine print above the
                CTA, where the rest of the terms are. */}
            {/* THE HEADING SITS ON THE CARDS (owner, 2026-09-26): "Pick a
                plan." stands clear of the stepper and directly over the cards
                it asks about. The terms paragraph that used to sit between
                the two moved under the cards, beside the start buttons it
                speaks for. */}
            {/* ONE ROW ON A DESK (owner, 2026-10-12): the question on the left; the trial's
                stamp and the Monthly | Annual switch side by side on the right, so the head
                takes one row (two when the window is narrow) and the cards fit the screen. */}
            {/* THE ONE LINE OVER THE CARDS (owner, 2026-10-19): Stripe's card page did not open — the only time the cards
                come up without being asked for; or, back from it, the plan that was picked. */}
            {/* The bank refused the $1 card check (lib/signupCardHold): one line and the button to a new Checkout. */}
            {declined && !gate ? (
              <div className="pw-confirm" role="alert" id="cardDeclined" data-card-declined={declined.why || "card"}>
                <p className="pw-confirm-h">{isStripeEmailCode(declined.why) ? STRIPE_EMAIL_LINES[declined.why as string] : CARD_DECLINED_LINE}</p>
                <div className="pw-confirm-row">
                  <button type="button" className="btn pw-go" id="tryAnotherCard" onClick={onTryAnotherCard} disabled={payBusy}>
                    {payBusy ? "Opening checkout…" : isStripeEmailCode(declined.why) ? "Back to the card page" : "Try another card"}
                  </button>
                </div>
              </div>
            ) : returned && ret?.failed && !gate ? (
              <p className="pw-autonote" role="status" data-checkout-failed>
                Secure checkout didn&apos;t open — pick a plan to try again
              </p>
            ) : toolsCatalog && returned && ret?.cancelled && !gate ? (
              <p className="pw-autonote" data-auto-plan-back>
                No card yet, nothing charged. Your plan is below — start it, or change the plan or the tool.
              </p>
            ) : auto && returned && ret?.cancelled && !gate ? (
              <p className="pw-autonote" data-auto-plan-back>
                No card yet, nothing charged. <b>{auto.name}</b> is picked for you — start it below, or choose another plan.
              </p>
            ) : null}
            {spotlight && !toolsCatalog ? (
              <p className="pw-spot" data-plan-spotlight={spotlight} data-plan-spotlight-row={spotRow ?? ""}>
                <span className="pw-spot-k">{SPOTLIGHT[spotlight].label}</span>
                {spotlightBanner(spotlight, plans)}
              </p>
            ) : null}
            <div className="pw-head">
              <h1 className="auth-h1">{toolsCatalog ? "Your plan." : "Pick a plan."}</h1>
              <div className="pw-head-r">
                {/* The trial's promise (owner, 2026-10-01) — the stamp the landing carries, in the
                    words of signupTrialMode (lib/trialPolicyServer; words: lib/trialPolicy trialLine). */}
                {!gate ? (
                  <p className="pw-trial">
                    <svg className="ic" aria-hidden>
                      <use href="#i-check" />
                    </svg>
                    {trialLine(requiresCard, trialDays)}
                  </p>
                ) : null}
                {/* MONTHLY | ANNUAL (owner, 2026-10-12): one switch over the row, the landing's and
                    the upgrade page's own (components/billing/PlanTermSwitch). Not drawn when no
                    plan prices a year. */}
                {showTerms && !confirmSentTo && !gate ? (
                  <PlanTermSwitch className="pw-termsw" value={interval} onChange={setInterval} tag={termTag} />
                ) : null}
              </div>
            </div>

            {plansErr ? (
              <div className="err" role="alert">
                {plansErr}
              </div>
            ) : null}

            {gate ? (
              <div className="pw-confirm" role="status" id="planGate" data-gate={gate.kind}>
                <span className="pw-confirm-k">{gate.kind === "taken" ? "Account found" : "Timed out"}</span>
                <p className="pw-confirm-h">
                  {gate.kind === "taken" ? "You already have an account" : "Your signup timed out — enter your email again"}
                </p>
                <p className="pw-confirm-p">
                  {gate.kind === "taken" ? (
                    <>
                      <b>{gate.phone ? prettyUsPhone(gate.phone) : gate.email}</b> already has a JobFlex account. Sign in to open it — nothing was charged here.
                    </>
                  ) : (
                    "Nothing was charged. Your name and email are kept — we'll send a new code, then pick your plan."
                  )}
                </p>
                <div className="pw-confirm-row">
                  {gate.kind === "taken" ? (
                    <>
                      <Link
                        className="btn pw-go"
                        id="gateSignIn"
                        href={`/auth/login?${new URLSearchParams(gate.phone ? { phone: gate.phone, next: "/dashboard" } : { email: gate.email, next: "/dashboard" }).toString()}` as Route}
                      >
                        Sign in
                      </Link>
                      <button type="button" className="pw-confirm-back" onClick={() => otpStartAgain(false)}>
                        {gate.phone ? "Use a different number" : "Use a different email"}
                      </button>
                    </>
                  ) : (
                    <button type="button" className="btn pw-go" id="gateAgain" onClick={() => otpStartAgain(true)}>
                      Enter your email again
                    </button>
                  )}
                </div>
              </div>
            ) : null}

            {confirmSentTo ? (
              <div className="pw-confirm" role="status">
                <span className="pw-confirm-k">Check your email</span>
                <p className="pw-confirm-h">
                  We sent a link to <b>{confirmSentTo}</b>.
                </p>
                <p className="pw-confirm-p">
                  Open it to create your shop and start the {trialDays}-day free trial — no card needed. The link works for 24 hours{resent ? "; the one sent before it no longer does" : ""}.
                </p>
                <div className="pw-confirm-row">
                  <button
                    type="button"
                    className="btn pw-go"
                    onClick={() => void onStartCardless(confirmSlug)}
                    disabled={payBusy || resendIn > 0}
                    aria-busy={payBusy || undefined}
                  >
                    {payBusy ? "Sending…" : resendIn > 0 ? `Resend in ${resendIn} s` : "Resend the link"}
                  </button>
                  <button type="button" className="pw-confirm-back" onClick={() => setConfirmSentTo(null)} disabled={payBusy}>
                    Pick another plan
                  </button>
                </div>
              </div>
            ) : null}

            {/* ONE GRID (owner, 2026-10-12): each card is a subgrid of the row's tracks — name, price,
                deal, the free-until line and the code's line when there are any, the full feature list,
                the start button — so prices and first rows stand on one line and every card is the
                row's height. Nothing folds: every list is drawn whole. As many columns as cards
                (`--pw-cols`, set on the sheet so every edge lines up with the row), the row centred,
                a card no wider than the stylesheet's cap. */}
            {/* THE NEW PLANS' CARD PAGE (Base + Tools, part 4): one card — the size with the main tool — "Working
                alone?", Change tool and the four sizes, in place of the Classic cards. */}
            {toolsCatalog && !confirmSentTo && !gate ? (
              <ToolsCardPage
                catalog={toolsCatalog}
                plan={toolsPick.plan}
                main={toolsPick.main}
                term={interval}
                onPlan={(id) => {
                  setToolsPick((cur) => ({ ...cur, plan: id }));
                  setPlanSlug(toolPlanById(id).slug);
                }}
                onMain={(tool) => setToolsPick((cur) => ({ ...cur, main: tool }))}
                onStart={() => void onStartPlan(toolPlanById(toolsPick.plan).slug)}
                when={(monthly, yearly) => (freeUntil ? whenLine(monthly, yearly) : null)}
                codeLine={
                  promo?.percentOff
                    ? (monthly, yearly) => {
                        const cents = interval === "YEAR" ? yearly : monthly;
                        const v = firstBillCents(interval, cents, monthly, promo.percentOff ?? 0) / 100;
                        return (
                          <span className="pw-save pw-save--code">
                            <s>{dealDollars(cents)}</s> {promo.percentOff}% off{interval === "YEAR" ? " your first month" : ""} · ${Number.isInteger(v) ? v.toFixed(0) : v.toFixed(2)}
                            {interval === "YEAR" ? "/yr" : "/mo"}
                          </span>
                        );
                      }
                    : undefined
                }
                busy={startingSlug === toolPlanById(toolsPick.plan).slug}
                disabled={payBusy || !checkoutReady}
                startLabel={
                  startingSlug === toolPlanById(toolsPick.plan).slug ? busyLabel : !checkoutReady ? "Checkout is not configured" : `Start ${trialDays}-day free trial`
                }
              />
            ) : null}
            <div
              className={"pw-plans" + (confirmSentTo || gate || toolsCatalog ? " is-hidden" : "")}
              ref={plansRef}
              style={{ "--pw-rows": 5 + (freeUntil ? 1 : 0) + (promo?.percentOff ? 1 : 0) } as React.CSSProperties}
            >
              {orderedPlans.map((p) => {
                const term = planTerm(interval, p.yearlyPriceCents);
                const cents = term === "YEAR" ? (p.yearlyPriceCents ?? 0) : p.priceCents;
                const per = term === "YEAR" ? "/yr" : "/mo";
                const on = planSlug === p.slug;
                const has = includedBySlug.get(p.slug) ?? new Set<string>();
                return (
                  <div
                    key={p.slug}
                    role="button"
                    tabIndex={0}
                    className={"pw-plan" + (on ? " on" : "") + (p.highlight ? " pw-plan--hero" : "")}
                    aria-pressed={on}
                    data-plan-card={p.slug}
                    data-monthly-cents={p.priceCents}
                    data-yearly-cents={p.yearlyPriceCents ?? undefined}
                    onClick={() => choosePlan(p.slug)}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget) return;
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        choosePlan(p.slug);
                      }
                    }}
                  >
                    {p.highlight ? <span className="pw-tag">Most picked</span> : null}
                    {/* The name, and the "N MONTHS FREE" stamp at the card's right edge on a year
                        (PlanCardHead); the price alone on its line; under it "You save $N a year",
                        or "Billed monthly" (PlanDealSlot, lib/planDeal). */}
                    <PlanCardHead
                      term={interval}
                      monthlyCents={p.priceCents}
                      yearlyCents={p.yearlyPriceCents}
                      name={<span className="pw-plan-n">{p.name}</span>}
                    />
                    <PlanPrice term={interval} monthlyCents={p.priceCents} yearlyCents={p.yearlyPriceCents} figureClassName="pw-price" />
                    <PlanDealSlot term={interval} monthlyCents={p.priceCents} yearlyCents={p.yearlyPriceCents} />
                    {freeUntil ? whenLine(p.priceCents, p.yearlyPriceCents) : null}
                    {/* THE CODE'S EFFECT ON THIS PRICE. "Code applied" over an
                        unchanged number read as nothing happening (owner,
                        2026-09-02); the same percent checkout applies is
                        shown here, against the price it applies to. */}
                    {promo?.percentOff ? (
                      <span className="pw-save pw-save--code">
                        <s>{dealDollars(cents)}</s> {promo.percentOff}% off{term === "YEAR" ? " your first month" : ""} · $
                        {(() => {
                          // Stripe's own number, to the cent: $22.50, not $23. On a year,
                          // one month's percent off the year (lib/firstMonthDiscount).
                          const v = firstBillCents(term, cents, p.priceCents, promo.percentOff) / 100;
                          return Number.isInteger(v) ? v.toFixed(0) : v.toFixed(2);
                        })()}
                        {per}
                      </span>
                    ) : null}
                    <span className="pw-feats" data-plan-feats>
                      {featureRows.map((f) => {
                        const lit = spotRow !== null && f === spotRow;
                        // The tool the visitor came for is in the plan when its gate says so, whatever the line reads (lib/planSpotlight).
                        const included = lit && spotlight ? spotlightInPlan(spotlight, p) : has.has(f.toLowerCase());
                        return (
                          <span key={f} className={(included ? "pw-f" : "pw-f pw-f--no") + (lit ? " pw-f--spot" : "")} data-plan-spot-row={lit ? (included ? "in" : "out") : undefined}>
                            <svg className="ic">
                              <use href={included ? "#i-check" : "#i-minus"} />
                            </svg>
                            {/* The name and its tag (.pw-ft): the tag drops under the
                                name when the line cannot hold both, and the name never
                                breaks inside a word. */}
                            <span className="pw-ft">
                              <span className="pw-fn">{f}</span>
                              {lit ? <span className="pw-spot-tag">{included ? SPOTLIGHT_TAG : SPOTLIGHT_MISSING}</span> : null}
                            </span>
                          </span>
                        );
                      })}
                    </span>
                    {/* THE START BUTTON LIVES IN THE CARD (owner, 2026-09-05):
                        choosing and committing are one reach. Starting from a
                        card that is not yet the selection selects it first. The
                        card is a div-as-button for this reason — a button
                        cannot hold a button. */}
                    <span className="pw-acts">
                      <button
                        type="button"
                        className={"btn pw-go" + (startingSlug === p.slug ? " is-busy" : "")}
                        aria-busy={startingSlug === p.slug || undefined}
                        onClick={(e) => {
                          e.stopPropagation();
                          choosePlan(p.slug);
                          void onStartPlan(p.slug);
                        }}
                        disabled={payBusy || !checkoutReady}
                      >
                        {startingSlug === p.slug
                          ? busyLabel
                          : !checkoutReady
                            ? "Checkout is not configured"
                            : `Start ${trialDays}-day free trial`}
                      </button>
                    </span>
                  </div>
                );
              })}
              {/* THE CUSTOM PLAN — the same card shape, priced by what is
                  ticked rather than by a tier somebody else drew. Drawn only
                  when offerCustom says so (see the flag), and only
                  once the catalogue has answered: drawn alone before it, it
                  was the card the phone carousel snapped to, and on a desk it
                  jumped from the first column to the last when the rest
                  arrived. A year is CUSTOM_YEAR_MULTIPLIER months of its own
                  price (lib/customPlan); its deal is read like the catalog's. */}
              {offerCustom && plans.length > 0 ? (
              <div
                role="button"
                tabIndex={0}
                className={
                  "pw-plan pw-plan--custom" + (planSlug === CUSTOM_PLAN_SLUG ? " on" : "")
                }
                aria-pressed={planSlug === CUSTOM_PLAN_SLUG}
                data-plan-card={CUSTOM_PLAN_SLUG}
                data-monthly-cents={customPriceCents(customPages)}
                data-yearly-cents={customPriceCents(customPages, "YEAR")}
                // A phone: the card is the choice, like every card; its "Select pages" opens the picker.
                onClick={() => {
                  choosePlan(CUSTOM_PLAN_SLUG);
                  if (!handheld) openPicker();
                }}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    choosePlan(CUSTOM_PLAN_SLUG);
                    if (!handheld) openPicker();
                  }
                }}
              >
                <PlanCardHead
                  term={interval}
                  monthlyCents={customPriceCents(customPages)}
                  yearlyCents={customPriceCents(customPages, "YEAR")}
                  name={<span className="pw-plan-n">Custom</span>}
                />
                <PlanPrice
                  term={interval}
                  monthlyCents={customPriceCents(customPages)}
                  yearlyCents={customPriceCents(customPages, "YEAR")}
                  figureClassName="pw-price"
                  // a phone: before any page is ticked the price is a floor, "from $20/mo"
                  figure={(num, per) => (
                    <>
                      {handheld && customPages.length === 0 ? <small className="pw-from">from </small> : null}
                      {num}
                      <i>{per}</i>
                    </>
                  )}
                />
                <PlanDealSlot term={interval} monthlyCents={customPriceCents(customPages)} yearlyCents={customPriceCents(customPages, "YEAR")} />
                {freeUntil ? whenLine(customPriceCents(customPages), customPriceCents(customPages, "YEAR")) : null}
                {/* the code's line has a row in this grid; the custom card keeps it empty */}
                {promo?.percentOff ? <span aria-hidden="true" /> : null}
                <span className="pw-feats" data-plan-feats>
                  {CUSTOM_BASE_FEATURES.map((f) => (
                    <span key={f} className="pw-f">
                      <svg className="ic">
                        <use href="#i-check" />
                      </svg>
                      {f}
                    </span>
                  ))}
                  <span className="pw-f pw-f--add">
                    <svg className="ic">
                      <use href="#i-plus" />
                    </svg>
                    {customPages.length === 0
                      ? `Add pages · $${(CUSTOM_PAGE_CENTS / 100).toFixed(0)} each`
                      : `${customPages.length} page${customPages.length === 1 ? "" : "s"} added`}
                  </span>
                  {customPages.map((id) => {
                    const page = CUSTOM_PAGES.find((x) => x.id === id);
                    return page ? (
                      <span key={id} className="pw-f">
                        <svg className="ic">
                          <use href="#i-check" />
                        </svg>
                        {page.label}
                      </span>
                    ) : null;
                  })}
                </span>
                {/* TWO CONTROLS, two looks (owner, 2026-09-04): the page
                    picker is the ghost, the plan's state label is the blue
                    plate every other card ends on. */}
                <span className="pw-acts">
                  <span
                    className="pw-edit"
                    role="presentation"
                    onClick={(e) => {
                      e.stopPropagation();
                      choosePlan(CUSTOM_PLAN_SLUG);
                      openPicker();
                    }}
                  >
                    Select pages
                  </span>
                  <button
                    type="button"
                    className={"btn pw-go" + (startingSlug === CUSTOM_PLAN_SLUG ? " is-busy" : "")}
                    aria-busy={startingSlug === CUSTOM_PLAN_SLUG || undefined}
                    onClick={(e) => {
                      e.stopPropagation();
                      choosePlan(CUSTOM_PLAN_SLUG);
                      void onStartPlan(CUSTOM_PLAN_SLUG);
                    }}
                    disabled={payBusy || !checkoutReady}
                  >
                    {startingSlug === CUSTOM_PLAN_SLUG
                      ? busyLabel
                      : !checkoutReady
                        ? "Checkout is not configured"
                        : `Start ${trialDays}-day free trial`}
                  </button>
                </span>
              </div>
              ) : null}

              {plans.length === 0 && !plansErr ? (
                <div className="fld-note">Loading plans…</div>
              ) : null}
            </div>

            {/* THE DOTS under the phone's rail: one per card, the one in the middle filled; a
                press brings that card to the middle (and the choice follows it there). */}
            {handheld && cardCount > 1 && !confirmSentTo && !gate && !toolsCatalog ? (
              <div className="pw-dots" data-plan-dots>
                {[...orderedPlans.map((p) => ({ slug: p.slug, name: p.name })), ...(cardCount > orderedPlans.length ? [{ slug: CUSTOM_PLAN_SLUG, name: "Custom" }] : [])].map((d, i) => {
                  const at = railAt ?? Math.max(0, [...orderedPlans.map((p) => p.slug), CUSTOM_PLAN_SLUG].indexOf(planSlug ?? ""));
                  return (
                    <button
                      key={d.slug}
                      type="button"
                      className="pw-dot"
                      data-plan-dot={d.slug}
                      aria-label={`Show the ${d.name} plan`}
                      aria-current={i === at ? "true" : undefined}
                      onClick={() => {
                        railTouched.current = true;
                        centreCard(d.slug, true);
                      }}
                    >
                      <span aria-hidden />
                    </button>
                  );
                })}
              </div>
            ) : null}

            {/* The code and the terms share one row on a desk (2026-10-12): the field on the left,
                the fine print beside it. On a phone the wrappers step aside (display: contents). */}
            <div className="pw-bottom">
            <div className="pw-bottom-l">
            <div className={"pw-foot" + (planSlug ? " is-armed" : "")}>
              {/* PROMO — the same codes the ?promo / ?ref links carry. Applying
                  one stamps it on the shop and checkout picks it up there. */}
              <div className={"pw-promo" + (promo ? " is-on" : "")}>
                <input
                  className="pw-promo-in"
                  value={promo ? promo.code : promoText}
                  onChange={(e) => setPromoText(e.target.value.toUpperCase())}
                  placeholder="Promo or referral code"
                  aria-label="Promo or referral code"
                  disabled={promoBusy || Boolean(promo)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void onApplyPromo();
                    }
                  }}
                />
                <button
                  className="pw-promo-b"
                  type="button"
                  onClick={() => void onApplyPromo()}
                  disabled={promoBusy || Boolean(promo) || promoText.trim().length === 0}
                >
                  {promoBusy ? "…" : promo ? "✓" : "Apply"}
                </button>
              </div>
            </div>

            {promo ? (
              <p className="pw-promo-ok" role="status">
                <b>{promo.code}</b>
                {promo.percentOff ? ` · ${promo.percentOff}% off` : ""} · {promo.displayName}
              </p>
            ) : promoErr ? (
              <p className="err" role="alert">
                {promoErr}
              </p>
            ) : null}
            </div>

            {/* One disclosure below the promo field, matching the saved offer. */}
            <p className="pw-terms" id="pwTerms">
              {requiresCard
                ? `Your ${trialDays}-day free trial renews automatically at the selected plan price and billing interval shown above, unless you cancel before it ends. No charge today. Cancel from the Subscription page.`
                : `No card needed: the trial is ${trialDays} days, and you add a card only if you keep the plan.`}
              {/* The $1 card check on the return from Stripe (lib/signupCardHold), said before the card is asked for. */}
              {requiresCard ? (
                <>
                  {" "}
                  <span id="cardHoldNoticePlan">{CARD_HOLD_NOTICE}</span>
                </>
              ) : null}
              {" "}By starting a trial, you agree to our{" "}
              <Link href="/terms" target="_blank" rel="noopener noreferrer"><u>Terms of service</u></Link>
              {" "}and acknowledge our{" "}
              <Link href="/privacy" target="_blank" rel="noopener noreferrer"><u>Privacy policy</u></Link>.
            </p>

            {/* The testing exit. Small, quiet, at the right end of the terms' row — an
                escape, not an offer. Development builds only: the server refuses the
                no-subscription path in production regardless (see
                completePendingSignup), so the button is not drawn there. */}
            {process.env.NODE_ENV !== "production" ? (
              <button className="pw-skip" type="button" onClick={() => void onSkipPlan()} disabled={payBusy}>
                Skip for now
              </button>
            ) : null}
            </div>

            {/* THE PAGE PICKER. Hand-rolled (no Radix here, same as every other
                dialog in this fleet): a scrim, one panel, Escape closes it. The
                price in its foot is the same function the server charges by. */}
            {offerCustom && pickerOpen && isClient ? createPortal(
              <div className={styles.bp + " pwp-host"}>
              <div
                className={"pwp" + (pickerOn ? " is-on" : "")}
                role="dialog"
                aria-modal="true"
                aria-label="Choose the pages in your plan"
                onKeyDown={(e) => {
                  if (e.key === "Escape") closePicker();
                }}
              >
                <div className="pwp-scrim" onClick={() => closePicker()} />
                <div className="pwp-box" ref={pickerBoxRef} tabIndex={-1}>
                  <div className="pwp-head">
                    <div>
                      <div className="pwp-kick">Custom plan</div>
                      <h2 className="pwp-h">Pick the pages you want.</h2>
                    </div>
                    <button
                      className="pwp-x"
                      type="button"
                      aria-label="Close"
                      onClick={() => closePicker()}
                    >
                      ×
                    </button>
                  </div>

                  <p className="pwp-lede">
                    ${(CUSTOM_BASE_CENTS / 100).toFixed(0)}/mo covers the everyday workspace —
                    proposals, clients, projects, jobs, invoices. Everything below is $
                    {(CUSTOM_PAGE_CENTS / 100).toFixed(0)}/mo each.
                  </p>

                  <div className="pwp-list">
                    {CUSTOM_PAGES.map((page) => {
                      const on = customPages.includes(page.id);
                      return (
                        <button
                          key={page.id}
                          type="button"
                          className={"pwp-row" + (on ? " on" : "")}
                          aria-pressed={on}
                          onClick={() =>
                            setCustomPages((cur) =>
                              cur.includes(page.id)
                                ? cur.filter((x) => x !== page.id)
                                : [...cur, page.id],
                            )
                          }
                        >
                          <span className="pwp-box-t" aria-hidden="true">
                            {on ? (
                              <svg className="ic">
                                <use href="#i-check" />
                              </svg>
                            ) : null}
                          </span>
                          <span className="pwp-txt">
                            <span className="pwp-n">{page.label}</span>
                            <span className="pwp-note">{page.note}</span>
                          </span>
                          <span className="pwp-p">
                            +${(CUSTOM_PAGE_CENTS / 100).toFixed(0)}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  <div className="pwp-foot">
                    <span className="pwp-total">
                      ${(customCents / 100).toFixed(0)}
                      <i>{interval === "YEAR" ? "/yr" : "/mo"}</i>
                    </span>
                    <button
                      className="btn pwp-done"
                      type="button"
                      onClick={() => closePicker()}
                    >
                      Done
                    </button>
                  </div>
                </div>
              </div>
              </div>,
              document.body,
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}
