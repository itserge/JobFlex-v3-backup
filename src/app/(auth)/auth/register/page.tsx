// Create account — Blueprint edition. Pixel-identical port of the donor
// `jobflex-auth-register-blueprint.html`.
//
// REPLACED IN PLACE, not forked. /auth/register is the live registration
// surface and now serves the blueprint build directly; there is deliberately no
// parallel /auth/register-blueprint route. This REVERSES the earlier
// side-by-side convention recorded in the header of
// /dashboard/subscription-blueprint/page.tsx ("a donor surface is never
// overwritten by its successor") — replacement is the instruction now.
//
// Public route: registration necessarily runs before a session exists, so there
// is no auth check here, exactly as before.
//
// All registration logic is unchanged — registerAccount (server action) +
// next-auth signIn + the promo/referral attribution capture. No server action,
// API route or Prisma model was added or altered by the restyle.

// VIEWPORT SWITCH: this route now serves the handheld rebuild at ≤768px and the
// blueprint desktop build above it, from this one URL — see
// ./register-responsive.tsx for the mechanism and why it is a sibling file
// rather than inline. /mobile-v1/auth/register remains as a direct preview URL.

import type { Metadata, Viewport } from "next";
import { SPOTLIGHT_COOKIE, SPOTLIGHT_VISIT_COOKIE, spotlightFor, spotlightNarrows } from "@/lib/planSpotlight";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { isPlaceholderOrgName, needsCompanySetup } from "@/lib/orgSetup";
import { readGoogleSignup } from "@/lib/googleSignup";
import { detectInAppBrowser } from "@/lib/inAppBrowser";
import { signupTrialOffer } from "@/lib/trialOfferServer";
import { readPendingSignup } from "@/actions/signupCheckout";
import { TrialOfferProvider } from "@/components/providers/trial-offer";
import { readSignupFlow, readSignupView, signupTrialMode } from "@/lib/trialPolicyServer";
import { SIGNUP_VIEW_COOKIE, resolveSignupView, signupViewCoin } from "@/lib/signupView";
import { identityFromCookie } from "@/lib/traffic-capture-server";
import { clientIp } from "@/lib/rateLimit";
import { SignupAppPreview } from "@/components/v3/auth-register-blueprint/app-preview";
import { SignupViewBeacon } from "@/components/v3/auth-register-blueprint/signup-view-beacon";
import { SIGNUP_MODE_COOKIE, resolveSignupMode } from "@/lib/signupMode";
import { OTP_DRAFT_COOKIE, draftRestore } from "@/lib/signupOtp";
import { DISPOSABLE_EMAIL_MESSAGE, isDisposableEmail } from "@/lib/disposableEmail";
import { customPlanOffered } from "@/lib/customPlanFlag";
import type { AutoPlanOffer } from "@/lib/signupAutoPlan";
import { autoPlanOffer } from "@/lib/signupAutoPlanServer";
import { pageClockScript } from "@/lib/pageClock";
import { RegisterResponsive, type GooglePrefill, type SetupPrefill } from "./register-responsive";
import {
  INDUSTRY_COOKIE,
  UTM_COOKIE,
  hasUtm,
  parseUtmCookie,
  pickUtm,
  resolveLandingVariant,
  variantTrade,
} from "@/components/v3/landing-e/landing-variants";

// Title is the donor's <head> verbatim. The mockup ships no <meta
// name="description">; the line below is this repo's own convention.
/* STEP 1 BEFORE THE JAVASCRIPT (2026-10-04). On a phone the fields are drawn
   about three seconds before the page's script takes them over, and until
   then a Continue press was a plain browser submit — the page reloaded empty,
   the ad's tags gone — and anything typed was wiped the moment React took
   over. This runs as the HTML streams in, ahead of the form: it holds an
   early Continue, keeps what was typed and notes both moments;
   register-content restores the fields when it is live and reports them to
   the analyst as `signup_step1`. Plain script on purpose: it has to run
   before any bundle has arrived.
   THE PAGE'S CLOCK goes first (lib/pageClock, 2026-10-17): the moments are
   visible time since the load — a hidden tab's minutes are not the form's —
   and the form measures itself only on the load this script ran in.
   A FORM THAT POSTS IS LET GO (2026-10-23). The short sign-up's step 1 posts to
   ./checkout and works without the script; held, its button did nothing until
   the bundle arrived — 14 s in Facebook's browser on a phone. Its first press
   now goes to the server as the browser sends it; a second press before the
   form is live is held, so one tap is one sign-up. */
const STEP1_PRELUDE = `${pageClockScript("register")}(function(){var s={typedAt:0,submitAt:0,values:{},ready:false};window.__jfStep1=s;
function v(){var c=window.__jfClock,t=performance.now(),h=0;if(c){for(var i=0;i<c.spans.length;i++)h+=c.spans[i][1]-c.spans[i][0];if(c.since>=0)h+=t-c.since;}return Math.max(1,Math.round(t-h));}
document.addEventListener("input",function(e){var el=e.target;if(s.ready||!el||!el.form||el.form.id!=="step1Form"||!el.id)return;if(!s.typedAt)s.typedAt=v();s.values[el.id]=el.value;},true);
document.addEventListener("submit",function(e){var f=e.target;if(s.ready||!f||f.id!=="step1Form")return;if(!s.submitAt)s.submitAt=v();if(f.getAttribute("method")==="post"&&!s.sent){s.sent=1;return;}e.preventDefault();},true);})();`;

/** ./checkout's refusals of a step 1 sent without JavaScript, by their code in `?e1=`. */
const STEP1_REFUSALS: Record<string, string> = {
  taken: "That email already has an account. Sign in instead.",
  disposable: DISPOSABLE_EMAIL_MESSAGE,
  busy: "Too many sign-ups from this network just now. Try again in a little while.",
  invalid: "Enter your name and a valid email address.",
  trouble: "Something went wrong on our side. Try again in a minute.",
};

export const metadata: Metadata = {
  title: "JobFlex · Create account",
  description: "Set up your shop — your organization, your login, your first quote.",
};

/* THE PHONE SIGN-UP'S SHEET (components/v3/auth-register-mobile) hangs from a fixed layer: the keyboard shrinks the
   visual viewport only, never the layout, so the open sheet does not move when the keyboard rises (Chrome's default,
   said out loud), and a tap into a field does not zoom the page out of the sheet. */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-visual",
};

// GOOGLE SIGNUPS finish here. The auth callback provisions the account + a
// placeholder org and signs the person in; the dashboard layout sends an
// owner whose org still has no address/trades to this URL, and this page
// opens straight on step 2 with what Google gave us (name, email) filled in.
// A signed-in owner whose org IS set up, arriving here without a Stripe
// return token, belongs in the app.
export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;

  /* THE TRADE THE VISITOR CAME IN ON. A landing opened with `?industry=fencing`
     carries it into every register link; a visitor who lands here later with
     no parameter still has the landing's 30-day memory cookie. Resolved here
     so step 2's chips are right on the first paint. Advisory only: it
     pre-selects a chip the visitor can un-pick. */
  const jar = await cookies();
  const industryParam = sp.industry ?? sp.trade;
  const industryKey = industryParam !== undefined ? resolveLandingVariant(industryParam) : resolveLandingVariant(jar.get(INDUSTRY_COOKIE)?.value);
  const industry = variantTrade(industryKey);
  /* THE TOOL THE VISITOR CAME FOR (lib/planSpotlight, 2026-10-14): the link's
     `?tool=` or the landing's memory of it, else the trade's own estimator.
     The plan step pins and marks it on every card. */
  const spotlightUrl = spotlightFor({ tool: sp.tool, industry: industryParam !== undefined ? resolveLandingVariant(industryParam) : undefined });
  const spotlight = spotlightUrl ?? spotlightFor({ tool: jar.get(SPOTLIGHT_COOKIE)?.value, industry: industryKey });
  // The other trade estimators hide only during the ad visit: this URL, or the visit's session cookie (owner, 2026-11-07).
  const spotlightNarrow = spotlightNarrows(spotlight, spotlightUrl, jar.get(SPOTLIGHT_VISIT_COOKIE)?.value);
  /* THE CAMPAIGN THE VISITOR CAME IN ON: utm_* from the register link, else
     the landing's memory cookie (the Google return, and an older link in a
     mail or an ad that carries no utm_*, arrive with no query). Stamped on
     the organization at creation (CRO stage 1). */
  const utmFromQuery = pickUtm(sp);
  const utm = hasUtm(utmFromQuery) ? utmFromQuery : parseUtmCookie(jar.get(UTM_COOKIE)?.value);
  /* THE RETURN FROM GOOGLE, resolved HERE rather than in the browser. The
     client used to fetch the parked identity after mount, so the first frame
     was step 1 and the jump to step 2 happened a beat later — it read as
     being bounced back to the start (owner's report, 2026-09-03). Reading it
     on the server means the first paint IS step 2, with the name and address
     Google gave us already in place. An expired or unknown handle simply
     yields null and the normal signup renders. */
  const gsuParam = typeof sp.gsu === "string" ? sp.gsu : null;
  let google: GooglePrefill | null = null;
  /* A Google address on a throwaway-mail domain comes back as ?gerr=disposable
     (lib/auth, One Tap): step 1 opens with the reason instead of step 2. */
  let googleError: string | null = sp.gerr === "disposable" ? DISPOSABLE_EMAIL_MESSAGE : null;
  if (gsuParam) {
    const identity = await readGoogleSignup(gsuParam);
    if (identity && isDisposableEmail(identity.email)) {
      googleError = DISPOSABLE_EMAIL_MESSAGE;
    } else if (identity) {
      google = { handle: gsuParam, email: identity.email, name: identity.name ?? "" };
    }
  }

  let setup: SetupPrefill | null = null;
  let sendToApp = false;
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (userId && session.user.principal !== "INFLUENCER") {
      const m = await db.membership.findFirst({
        where: { userId, role: "OWNER", organization: { deletedAt: null } },
        orderBy: { createdAt: "asc" },
        select: {
          user: { select: { name: true, email: true, phone: true } },
          organization: { select: { name: true, address: true, phone: true, tradeTypesJson: true } },
        },
      });
      if (m && needsCompanySetup(m.organization)) {
        setup = {
          name: m.user.name ?? "",
          email: m.user.email ?? "",
          phone: m.user.phone ?? "",
          businessName: isPlaceholderOrgName(m.organization.name) ? "" : m.organization.name,
          companyPhone: m.organization.phone ?? "",
        };
      } else if (m && !sp.signup && !google) {
        /* A signed-in owner arriving with a FRESH Google identity (a Google
           account JobFlex has never seen) is here to start a second shop with
           it, not to be bounced into the app they are already in — the Google
           return wins over the "you belong in the app" rule (owner, 2026-09-04). */
        sendToApp = true;
      }
    }
  } catch {
    // Session read hiccup: render the normal signup.
  }
  if (sendToApp) redirect("/dashboard");
  /* Instagram / Facebook / LINE / TikTok webview: read here (the page is
     dynamic already, for the cookies above) so step 1 is drawn without the
     Google button from the first paint (lib/inAppBrowser). */
  const inAppBrowser = detectInAppBrowser((await headers()).get("user-agent"));
  /* THE MODE (2026-10-10, lib/signupMode): the owner's switch, or ?flow=otp
     in this browser. The passwordless sign-up reopens where it was left
     (lib/signupOtp): the draft named by ?d= or this browser's cookie. */
  const signupFlow = await readSignupFlow();
  /* STRAIGHT TO PROFESSIONAL (owner, 2026-10-15, lib/signupAutoPlan): the
     short sign-up — name and email, or Google — and the card page for the
     plan, no company screen and no plan cards. It is the passwordless form
     (the code only when no card is taken), whatever the steps switch says. */
  // The plan is picked here by the same rule the form uses (lib/signupAutoPlanServer), so step 1 can name it and its
  // price; the plan step asks again as it opens (signupPlans), so this page's answer is never the last word.
  const autoPlan: AutoPlanOffer | null = setup
    ? null
    : await autoPlanOffer({ asked: typeof sp.plan === "string" ? sp.plan : null, edition: sp.edition === "deck" ? "deck" : null, tool: spotlight });
  const mode = autoPlan ? "otp" : resolveSignupMode(sp.flow, jar.get(SIGNUP_MODE_COOKIE)?.value, signupFlow.passwordless);
  const otpRestore =
    mode === "otp" && !setup && !google && typeof sp.signup !== "string"
      ? await draftRestore(typeof sp.d === "string" ? sp.d : null, jar.get(OTP_DRAFT_COOKIE)?.value ?? null).catch(() => null)
      : null;
  const requiresCard = (await signupTrialMode()) === "card";
  /* STRAIGHT TO STRIPE, BY THE SERVER (owner, 2026-10-19). With the plan picked for them and a card to take, a sign-up
     that is ready to pay never draws a screen of its own: the plan step's address (`?signup=` — the emailed code's
     button, a reload, a link opened later) and this browser's proven draft both go to ./checkout, whose answer is a
     303 to Stripe's card page. Stripe's back arrow (`checkout=cancelled`), a card page that did not open
     (`checkout=failed`) and the switch turned off (`checkout=pick`) draw the plan cards instead; a paid return
     (`session_id`) the done panel. */
  if (autoPlan && requiresCard && !google) {
    const reopen =
      typeof sp.signup === "string" && !sp.checkout && !sp.session_id
        ? sp.signup
        : typeof sp.signup !== "string" && otpRestore?.stage === "verified"
          ? otpRestore.signupToken
          : null;
    if (reopen) {
      const q = new URLSearchParams({ signup: reopen, reason: sp.via === "link" ? "step1" : "relogin" });
      if (typeof sp.plan === "string") q.set("plan", sp.plan);
      if (sp.edition === "deck") q.set("edition", "deck");
      redirect(`/auth/register/checkout?${q.toString()}`);
    }
  }
  /* Step 1 sent without JavaScript and refused (./checkout POST): the reason, and the name and email back in place. */
  const e1 = typeof sp.e1 === "string" ? STEP1_REFUSALS[sp.e1] : undefined;
  const step1Prefill = e1 ? { name: typeof sp.name === "string" ? sp.name.slice(0, 120) : "", email: typeof sp.email === "string" ? sp.email.slice(0, 200) : "" } : null;
  const pendingToken = typeof sp.signup === "string" ? sp.signup : (otpRestore?.signupToken ?? null);
  const pending = pendingToken ? await readPendingSignup(pendingToken) : null;
  /* THE SIGN-UP SCREEN (owner, 2026-10-22, lib/signupView): the page as built, or the same form in the middle of a
     picture of the app — the overview with sample work for the trade they came in on, nothing to click. The owner's
     switch, a `?view=` link, and under the half-and-half split the screen this browser was given. Only the drawing
     changes: every step, check and redirect above is the same in both. */
  const viewSetting = await readSignupView();
  const visitor = identityFromCookie(jar.get(`ph_${process.env.NEXT_PUBLIC_POSTHOG_KEY}_posthog`)?.value, "")?.distinctId ?? `${await clientIp()}|${(await headers()).get("user-agent") ?? ""}`;
  const viewChoice = resolveSignupView(viewSetting.mode, sp.view, jar.get(SIGNUP_VIEW_COOKIE)?.value, signupViewCoin(visitor));
  const appView = viewChoice.view === "app";
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: STEP1_PRELUDE }} />
      {appView ? <SignupAppPreview trade={industry ?? pending?.landingIndustry ?? null} name={google?.name ?? setup?.name ?? pending?.name ?? null} /> : null}
      <SignupViewBeacon view={viewChoice.view} source={viewChoice.source} />
      <TrialOfferProvider trackExposure={false} offer={pending?.trialOffer ?? await signupTrialOffer()}>
      <RegisterResponsive
        requiresCard={requiresCard}
        appView={appView}
        steps={signupFlow.steps}
        mode={mode}
        autoPlan={autoPlan}
        otpRestore={otpRestore}
        offerCustom={customPlanOffered()}
        initialError={googleError ?? e1 ?? null}
        prefill={step1Prefill}
        setup={setup}
        google={google}
        industry={industry}
        spotlight={spotlight}
        spotlightNarrow={spotlightNarrow}
        spotlightUrl={spotlightUrl}
        edition={sp.edition === "deck" ? "deck" : null}
        utm={hasUtm(utm) ? utm : null}
        inAppBrowser={inAppBrowser}
      />
      </TrialOfferProvider>
    </>
  );
}
