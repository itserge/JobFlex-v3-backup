"use client";

// Viewport switch for /auth/register.
//
// One URL, two designs: the blueprint page above 768px, and at or below it the
// phone sign-up — the same form in a bottom sheet over the live phone Overview
// (components/v3/auth-register-mobile, 2026-10-23, the trial's variant D). The
// switch is a MEDIA QUERY, never the user agent — the mobile-first rule forbids
// UA detection, and a query is also the only thing that makes DevTools' device
// toolbar work: drag the viewport under 768px and the surface swaps live.
//
// ONE FORM, NEVER RE-MOUNTED. The sheet's frame (RegisterSheet) is always
// drawn around the form and is `display: contents` above 768px, so crossing
// the line changes the frame's stylesheet, not the form's place in the tree:
// what was typed before the script arrived stays, and the form's
// once-per-load events go once. The server cannot know the viewport, so it
// draws the frame as it stands before the script: the sheet open with the
// whole form, which posts to ./checkout without JavaScript.
//
// THE APP BEHIND THE SHEET is the only handheld code that is fetched apart:
// a lazy chunk, `ssr: false`, loaded once the switch says "phone". A desktop
// visitor never downloads it or its stylesheet.

import type { EditionId } from "@/lib/editions";
import type { AutoPlanOffer } from "@/lib/signupAutoPlan";
import dynamic from "next/dynamic";
import { useSyncExternalStore } from "react";
import { RegisterContent } from "@/components/v3/auth-register-blueprint/register-content";
import { RegisterSheet } from "@/components/v3/auth-register-mobile/register-sheet";
import type { InAppBrowser } from "@/lib/inAppBrowser";
import type { TradeType } from "@/lib/tradeTypes";
import type { SpotlightTool } from "@/lib/planSpotlight";
import type { ToolId } from "@/lib/toolPlans/shared";
import type { UtmParams } from "@/components/v3/landing-e/landing-variants";
import type { SignupMode } from "@/lib/signupMode";
import type { OtpRestore } from "@/lib/signupOtp";

/** CLAUDE.md's handheld target: ≤768px. Matches the mobile module's own scale. */
const HANDHELD = "(max-width: 768px)";

const PhoneBackdrop = dynamic(() => import("@/components/v3/auth-register-mobile/phone-backdrop").then((m) => m.PhoneBackdrop), { ssr: false });

// Module scope so the identities are stable across renders — a fresh
// `subscribe` on every render makes useSyncExternalStore re-subscribe each
// time, which on a resize-driven store means tearing down the listener in the
// middle of the resize that triggered the render.
function subscribe(onStoreChange: () => void) {
  const mq = window.matchMedia(HANDHELD);
  mq.addEventListener("change", onStoreChange);
  return () => mq.removeEventListener("change", onStoreChange);
}
const getSnapshot = () => window.matchMedia(HANDHELD).matches;
// The server cannot know the viewport: it answers "not a phone", and the frame
// it draws is the one that stands before the script (the sheet open, on a
// phone, by its stylesheet alone). The client corrects right after hydration.
const getServerSnapshot = () => false;

/** A Google identity resolved ON THE SERVER from `?gsu=`, so the first paint
 *  is already step 2. Reading it client-side meant one frame of step 1 before
 *  the fetch resolved — the "shows step 1 for a second" the owner reported
 *  (2026-09-03). */
export interface GooglePrefill {
  handle: string;
  email: string;
  name: string;
}

/** What a Google signup already gave us: the page opens on step 2 with it. */
export interface SetupPrefill {
  name: string;
  email: string;
  phone: string;
  businessName: string;
  companyPhone: string;
}

function RegisterSwitch({
  setup,
  google,
  industry,
  spotlight = null,
  spotlightNarrow = false,
  spotlightUrl = null,
  toolsMain = null,
  edition = null,
  utm,
  inAppBrowser,
  requiresCard,
  initialError,
  prefill = null,
  offerCustom,
  steps,
  mode,
  otpRestore,
  autoPlan,
  appView = false,
}: {
  mode: SignupMode;
  /** The sign-up screen is "inside the app" (lib/signupView): the form is a card over the app's picture. */
  appView?: boolean;
  autoPlan: AutoPlanOffer | null;
  otpRestore: OtpRestore | null;
  offerCustom: boolean;
  /** The sign-up's steps, the owner's switch (lib/trialPolicyServer): 3 as built, or 2. */
  steps: 2 | 3;
  setup: SetupPrefill | null;
  google: GooglePrefill | null;
  industry: TradeType | null;
  /** The tool the visitor came for (lib/planSpotlight): marked on the plan step. */
  spotlight?: SpotlightTool | null;
  spotlightNarrow?: boolean;
  spotlightUrl?: SpotlightTool | null;
  /** The new plans (Plans switch on): the ad's tool the card page opens with. */
  toolsMain?: ToolId | null;
  /** The door the visitor came in by (2026-10-11, lib/editions). */
  edition: EditionId | null;
  utm: UtmParams | null;
  inAppBrowser: InAppBrowser | null;
  requiresCard: boolean;
  initialError: string | null;
  prefill?: { name: string; email: string } | null;
}) {
  const isHandheld = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return (
    <RegisterSheet live={isHandheld} backdrop={isHandheld ? <PhoneBackdrop trade={industry} /> : null}>
      <RegisterContent setup={setup} google={google} industry={industry} spotlight={spotlight} spotlightNarrow={spotlightNarrow} spotlightUrl={spotlightUrl} toolsMain={toolsMain}
        edition={edition} utm={utm} inAppBrowser={inAppBrowser} requiresCard={requiresCard} initialError={initialError} prefill={prefill} offerCustom={offerCustom} steps={steps} mode={mode} autoPlan={autoPlan} otpRestore={otpRestore} appView={appView} />
    </RegisterSheet>
  );
}

// NO SUSPENSE BOUNDARY (2026-10-19). The page is dynamic (it reads cookies and
// headers), so useSearchParams needs none — and the one that stood here made
// React stream the form as a separate chunk that only a script reveals (a
// boundary's content over ~12 KB is sent apart from the shell): with
// JavaScript off, step 1 was a blank sheet. Without it the form is in the
// first HTML and posts to ./checkout on its own.
export function RegisterResponsive({
  setup = null,
  google = null,
  industry = null,
  spotlight = null,
  spotlightNarrow = false,
  spotlightUrl = null,
  toolsMain = null,
  edition = null,
  utm = null,
  inAppBrowser = null,
  requiresCard = true,
  initialError = null,
  prefill = null,
  offerCustom = false,
  steps = 3,
  mode = "password",
  otpRestore = null,
  autoPlan = null,
  appView = false,
}: {
  /** The sign-up screen is "inside the app" (lib/signupView): the form is a card over the app's picture. */
  appView?: boolean;
  /** The sign-up's mode (lib/signupMode): password as built, or passwordless. */
  mode?: SignupMode;
  /** Straight to Professional (lib/signupAutoPlan): the plan the server picked, or null for the plan cards. */
  autoPlan?: AutoPlanOffer | null;
  /** Where a passwordless sign-up was left (lib/signupOtp draftRestore). */
  otpRestore?: OtpRestore | null;
  /** CUSTOM_PLAN_ENABLED, read on the server (lib/customPlanFlag). */
  offerCustom?: boolean;
  /** The sign-up's steps (lib/trialPolicyServer): 3 as built, or 2. */
  steps?: 2 | 3;
  setup?: SetupPrefill | null;
  google?: GooglePrefill | null;
  /** The landing's trade variant, resolved by the page — see page.tsx. */
  industry?: TradeType | null;
  /* The tool the visitor came for (lib/planSpotlight): marked on the plan step. */
  spotlight?: SpotlightTool | null;
  /* Hide the other trade estimators — only during the ad visit (lib/planSpotlight spotlightNarrows). */
  spotlightNarrow?: boolean;
  /* The spotlight this page's URL carried, remembered for the browser session. */
  spotlightUrl?: SpotlightTool | null;
  /** The new plans (Plans switch on): the ad's tool the card page opens with. */
  toolsMain?: ToolId | null;
  /* The door the visitor came in by (2026-10-11, lib/editions). */
  edition?: EditionId | null;
  /** The visit's utm_*, resolved by the page the same way. */
  utm?: UtmParams | null;
  /** The in-app browser the request's user agent names (lib/inAppBrowser). */
  inAppBrowser?: InAppBrowser | null;
  /** signupTrialMode (lib/trialPolicyServer) is "card", read on the server. */
  requiresCard?: boolean;
  /** Step 1's error on arrival — a refused Google address (lib/disposableEmail). */
  initialError?: string | null;
  /** Step 1's name and email, back after a refusal of the form sent without JavaScript. */
  prefill?: { name: string; email: string } | null;
}) {
  return (
    <RegisterSwitch setup={setup} google={google} industry={industry} spotlight={spotlight} spotlightNarrow={spotlightNarrow} spotlightUrl={spotlightUrl} toolsMain={toolsMain}
        edition={edition} utm={utm} inAppBrowser={inAppBrowser} requiresCard={requiresCard} initialError={initialError} prefill={prefill} offerCustom={offerCustom} steps={steps} mode={mode} autoPlan={autoPlan} otpRestore={otpRestore} appView={appView} />
  );
}
