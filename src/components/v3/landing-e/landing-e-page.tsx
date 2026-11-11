/* LANDING-E — THE landing, mounted at `/` (owner, 2026-09-16). It began as
   the test copy of landing-d (2026-09-10) and won: honest trial copy, the
   three-field register, the first-estimate card, the welcome email, Google
   One Tap, the neutral ink palette and the phone pass. landing-d is gone;
   the trade data (landing-variants, landing-groups, smart-scenarios) lives
   here now. Its events still carry `variant: "e"` so the admin's d-vs-e
   history reads on. */
/* The landing itself, as one component; the CSS import lives here so any
   entry point pulls it in by rendering this.

   Section order is the argument the page makes: what it is (hero, intro), what
   it does (estimators, the wall of real work), then the four surfaces a shop
   lives in (proposals, portal, jobs, money), then proof and the close.

   TRADE VARIANTS (2026-09-06). An ad link carrying `?industry=fencing` swaps
   the hero and the showcase's opening slide; every register link on the page
   then carries the industry (and the visit's utm_*) into /auth/register. The
   variant is resolved by the entry point on the server and handed down as
   props — nothing in this tree reads the URL — so the first paint is already
   the right one. With no variant every prop below is its default and the
   page renders exactly as it did before.

   THE ORDER IS A LIST, AND A LANDING MAY HAVE ITS OWN (2026-10-04). The
   blocks below are keyed by section and laid out in landingSectionOrder()
   (lib/landing-sections) — the list the section tracker and the admin's
   analyst read too. Every landing but roofing, HVAC and fencing gets the
   order above, to the byte. Those three are where the trade ads land, and the
   analyst's reading of the ads was: the demo is the third screen, behind
   the comparison; the hero does not continue the ad's line; no price in the
   first screen. So there the estimators come directly under the hero and
   the comparison moves down beside the pricing; `?hook=` puts the ad's
   opening line in the headline; the hero carries the estimator's plan price
   (when the plan cards name it), plays its sequence on a phone and has a
   sign-up button under the shot (landing-variants.ts). */

import { Fragment, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { landingSectionOrder } from "@/lib/landing-sections";
import { CrewGuide } from "./crew-guide";
import { CtaFooter } from "./cta-footer";
import { LandingFaq } from "./landing-faq";
import { groupContentFor } from "./landing-groups";
import { LandingPricing } from "./landing-pricing";
import { CtaTracker } from "./cta-tracker";
import { SectionTracker } from "./section-tracker";
import { LandingTiming } from "./landing-timing";
import { pageClockScript } from "@/lib/pageClock";
import { LazyBg } from "./lazy-bg";
import { WarmLayout } from "./warm-layout";
import { Hero } from "./hero";
import { Intro } from "./intro";
import { firstPersonCta } from "./cta-copy";
import { LandingVariantEffects } from "./landing-variant-effects";
import { parseSpotlightTool, spotlightFor, spotlightNarrows, type SpotlightTool } from "@/lib/planSpotlight";
import { adToolFor, type AdTool } from "@/lib/planSpotlight";
import { getPublicPlans } from "@/lib/toolPlans/publicPlans";
import { toolsPlansOn } from "@/lib/toolPlans/server";
import { mainToolFor } from "@/lib/toolPlans/cards";

/* CRO stage 1 (2026-09-09): everything under the intro is code-split. The
   sections still render on the server (the HTML is byte-for-byte what it
   was), but their JavaScript — the estimator sequences, the GSAP scroll
   effects, the integrations field, the proposal and portal mock-ups — no
   longer sits on the main thread before the hero has painted: Lighthouse
   put 2–4 s of the mobile LCP in render delay from script work alone. */
const EstimatorsShowcase = dynamic(() => import("./estimators-showcase").then((m) => m.EstimatorsShowcase));
import { DeckShots } from "./deck-shots";
import { isEditionOpen } from "@/lib/editions";
const Montage = dynamic(() => import("./montage").then((m) => m.Montage));
// The HVAC page's own section (2026-10-01): plans, visits, units, menu, the tech's phone.
const HvacServiceSection = dynamic(() => import("./hvac-service-section").then((m) => m.HvacServiceSection));
const ProposalsSection = dynamic(() => import("./proposals-section").then((m) => m.ProposalsSection));
const PortalSection = dynamic(() => import("./portal-section").then((m) => m.PortalSection));
const JobsSection = dynamic(() => import("./jobs-section").then((m) => m.JobsSection));
const FlowFeatures = dynamic(() => import("./flow-features").then((m) => m.FlowFeatures));
const Integrations = dynamic(() => import("./integrations").then((m) => m.Integrations));
const StatsSection = dynamic(() => import("./stats-section").then((m) => m.StatsSection));
const BuiltSection = dynamic(() => import("./built-section").then((m) => m.BuiltSection));
const ScrollFx = dynamic(() => import("./scroll-fx").then((m) => m.ScrollFx));
import {
  hookContent,
  isVariantReady,
  signupHref,
  variantContent,
  withHook,
  type LandingVariantKey,
  type UtmParams,
} from "./landing-variants";
import { MobileCta } from "./mobile-cta";
import { GoogleOneTap } from "@/components/auth/google-one-tap";
import { Nav } from "./nav";
import { PRICING, REGISTER } from "./routes";
import { SmoothWheel } from "./smooth-wheel";
import { signupTrialOffer } from "@/lib/trialOfferServer";
import { TrialOfferProvider } from "@/components/providers/trial-offer";
import { signupTrialMode } from "@/lib/trialPolicyServer";
import { customPlanOffered } from "@/lib/customPlanFlag";
import type { InAppBrowser } from "@/lib/inAppBrowser";
import "./landing-e.css";

export interface LandingEProps {
  /** Resolved trade variant; undefined is the default page. */
  variant?: LandingVariantKey;
  /** The tool the ad link said it sold (`?tool=`, lib/planSpotlight). */
  tool?: SpotlightTool;
  /** The same `?tool=` read for the new plans (lib/planSpotlight parseAdTool): any ad's key, used only while the
   *  Plans switch is on (lib/toolPlans/server) — the plan cards are priced with its tool. */
  adTool?: AdTool;
  /** True when the variant came from the URL rather than the memory cookie. */
  explicitVariant?: boolean;
  /** utm_* the visit arrived with — carried into the register links. */
  utm?: UtmParams;
  /** Meta's click id from an ad link — carried into the register links. */
  fbclid?: string;
  /** The in-app browser the request's user agent names (lib/inAppBrowser).
   *  Unread since 2026-10-19: the hero has no Google button on any browser. */
  inAppBrowser?: InAppBrowser | null;
  /** The ad's opening line for the headline: a key of the trade's own table
   *  (LANDING_HOOKS), resolved by the entry point. Absent: the trade's hero. */
  hook?: string;
  /** The 30-day SPOTLIGHT_COOKIE (lib/planSpotlight): an earlier ad visit's tool, for the plan cards only. */
  rememberedTool?: string;
  /** The ad visit's session cookie (SPOTLIGHT_VISIT_COOKIE): the other trades stay hidden while it lives. */
  visitTool?: string;
}

export async function LandingE({ variant, explicitVariant = false, utm = {}, fbclid, hook, tool, adTool, rememberedTool, visitTool }: LandingEProps) {
  // What the plan cards mark for this visitor: the ad's tool, else the trade's own estimator — from this URL, else
  // the 30-day memory of an earlier ad visit (lib/planSpotlight). The hero reads the URL only.
  const spotlightUrl = spotlightFor({ tool, industry: variant });
  const spotlight = spotlightUrl ?? parseSpotlightTool(rememberedTool) ?? null;
  // The other trade estimators hide only during the ad visit: this URL, or the visit's session cookie (owner, 2026-11-07).
  const narrow = spotlightNarrows(spotlight, spotlightUrl, visitTool);
  /* THE NEW PLANS (Base + Tools, part 4 — owner, 2026-11-10): with the Plans switch on, the plan cards are Basic,
     Professional, Advanced and Complete priced with the ad's tool — this URL's `?tool=` (any ad's key) or trade, else
     the 30-day memory — and every link carries that key on. Off: nothing below reads it; the page is today's. */
  const toolsOn = await toolsPlansOn();
  const mainTool = toolsOn ? mainToolFor({ tool: adTool, industry: variant, cookie: rememberedTool }) : null;
  const adToolUrl = toolsOn ? adToolFor({ tool: adTool, industry: variant }) : null;
  const linkTool = toolsOn ? (adTool ?? tool) : tool;
  // The trade's hero — with the ad's two lines in place of its own when the
  // link carried a `?hook=` the trade knows.
  const base = withHook(variantContent(variant), hookContent(variant, hook));
  // THE DECK STUDIO, COMING SOON (lib/editions EDITION_OPEN, owner 2026-10-11):
  // the decking landing still shows the studio, says it is coming, and signs a
  // decking shop up to JobFlex itself — Smart Proposal prices a deck today.
  const deckSoon = variant === "decking" && !isEditionOpen("deck");
  const v = deckSoon
    ? { ...base, h1: ["Deck Studio is coming soon.", "The deck in 3D, to your state's code."] as [string, string], primaryCta: "Start with JobFlex — free trial", heroCta: "Start with JobFlex — free trial" }
    : base;
  // signupTrialMode (lib/trialPolicyServer) — the same answer the plan step
  // reads: the hero's trial line, the plan cards, the FAQ's card answer and
  // the footer.
  const requiresCard = (await signupTrialMode()) === "card";
  const offer = await signupTrialOffer();
  // Every register link carries the trade, the visit's utm_* and the fbclid.
  const registerPlain = signupHref(REGISTER, { industry: variant, utm, fbclid, tool: linkTool });
  // THE DECK DOOR (2026-10-11, lib/editions): the decking landing is the Deck Studio's; its sign-up carries the edition.
  const register = variant === "decking" && !deckSoon ? `${registerPlain}${registerPlain.includes("?") ? "&" : "?"}edition=deck` : registerPlain;
  // …and so does the nav's Pricing link, for /pricing to hand on (pricing-visit.tsx).
  const pricing = signupHref(PRICING, { industry: variant, utm, fbclid, tool: linkTool });
  // The price anchor shows the Subscription page's own catalogue (CRO stage
  // 2); a catalogue read that fails leaves the section out rather than the
  // page down.
  // The switch off: the Classic catalog, exactly as before (lib/toolPlans/publicPlans).
  const plans = await getPublicPlans({ tool: mainTool }).catch(() => []);
  // The trade group's data for the sections under the hero (CRO stage 3):
  // undefined for the default page and the interior trades, which keep the
  // sections' own built-in kitchen.
  const g = groupContentFor(variant);
  // CTA copy (pass B): first person with the trade's outcome at the top of
  // the page, "Start my free trial" from Proposals down. The hero's solid
  // button, the nav's and the sticky phone bar's say the trial on every
  // landing (owner, 2026-10-16); the trade's words stay on the button under
  // the product shot and in the showcase.
  // "FREE TRIAL" in capitals, in the text itself (owner, 2026-10-16), on every
  // button that says this line — hero, nav, sticky bar, Proposals, the final
  // block (and the default page's showcase). The FAQ's button keeps the
  // sentence-case line; the plan cards have their own ("Start 7-day …").
  const top = variant ? firstPersonCta(variant) : `Start my ${offer.days}-day FREE TRIAL`;
  const low = `Start my ${offer.days}-day FREE TRIAL`;
  const faqCta = `Start my ${offer.days}-day free trial`;
  // The showcase's Smart slide plays the trade's own job: the variant's
  // scenario, or the roofing / fencing scenarios written for the pages whose
  // hero is the roof or fence shot (smart-scenarios.ts).
  const smart = v.scenario ?? (variant === "roofing" || variant === "fencing" ? variant : undefined);
  // Below the intro every section is wrapped in `.lp-cv` plus its own name,
  // which is what the stylesheet hangs that section's intrinsic height on
  // (landing-e.css, `--lp-cv`) — a shared guess made the page grow ~2,800px
  // under the reader as they scrolled.
  // Below the intro every section is wrapped in `.lp-cv`
  // (content-visibility: auto): the browser skips its style and layout until
  // it is near the viewport — the mobile LCP's render delay was style/layout
  // of the whole page.

  // The line under the hero's button (owner, 2026-10-16): one sentence, the
  // same for every trade, where the price line was (.lp-hero-price) — the
  // button says the trial. The price line (hero-price.ts heroPriceLine) and the
  // Deck Studio's coming-soon note are off. Since 2026-10-19 the default page
  // carries it too: the first screen is one order on every landing. The
  // trial's terms are never here — they are on Stripe's page.
  const heroLine = "Build your free estimates";
  // THE BLOCKS BY SECTION KEY, LAID OUT IN THE LANDING'S ORDER (the header
  // above; lib/landing-sections). A block that this landing does not show is
  // null. The comparison is on the second screen in the usual order and is
  // rendered as it always was; a landing that moves it down the page gives
  // it a content-visibility box like every other section under the fold.
  const order = landingSectionOrder(variant);
  const compareBelow = order.indexOf("compare") > 1;
  const blocks: Record<string, ReactNode> = {
    // The hook goes to the demo film's events (demo-film.tsx).
    hero: <Hero variant={v} variantKey={variant} registerHref={register} cta={top} trialCta={low} priceLine={heroLine} hook={v.film ? hook : undefined} />,
    compare: compareBelow ? <div className="lp-cv lp-cv--compare"><Intro /></div> : <Intro />,
    // The Deck Studio's landing shows its own three shots where the other landings show the estimators (owner, 2026-10-11).
    showcase: variant === "decking" ? <div className="lp-cv lp-cv--showcase"><DeckShots registerHref={register} cta={top} /></div> : <div className="lp-cv lp-cv--showcase"><EstimatorsShowcase slides={variant && isVariantReady(variant) ? v.showcaseSlides : undefined} ownSlide={variant && isVariantReady(variant) ? v.showcaseSlide : undefined} scenario={smart} registerHref={register} cta={top} /></div>,
    hvac: variant === "hvac" ? <div className="lp-cv lp-cv--hvac"><HvacServiceSection registerHref={register} cta={top} /></div> : null,
    // The Deck Studio's film plays in the hero now (demo-media "deck", 2026-10-19), so no landing renders
    // its own section (deck-demo-video.tsx, kept to bring back); the key stays in lib/landing-sections.
    demo: null,
    montage: (g?.montage ?? true) ? <div className="lp-cv lp-cv--montage"><Montage /></div> : null,
    proposals: <div className="lp-cv lp-cv--proposals"><ProposalsSection proposal={g?.proposal} registerHref={register} cta={low} /></div>,
    portal: <div className="lp-cv lp-cv--portal"><PortalSection portal={g?.portal} client={g?.proposal?.client} /></div>,
    // One content-visibility box for the two sections the guide line runs
    // through, so both are laid out together and the line can be measured.
    crew: (
      <div className="lp-cv lp-cv--crew">
        <CrewGuide>
          <JobsSection crew={g?.crew} phoneLanes={g?.phoneLanes} />
          <FlowFeatures />
        </CrewGuide>
      </div>
    ),
    integrations: <div className="lp-cv lp-cv--integrations"><Integrations registerHref={register} /></div>,
    stats: <div className="lp-cv lp-cv--stats"><StatsSection rows={g?.stats} /></div>,
    built: <div className="lp-cv lp-cv--built"><BuiltSection jobs={g?.jobs} phoneJobs={g?.phoneJobs} /></div>,
    pricing: <div className="lp-cv lp-cv--pricing"><LandingPricing plans={plans} registerHref={register} cta={low} customOffered={customPlanOffered()} spotlight={spotlight} narrow={narrow} fromUrl={spotlightUrl} mainTool={mainTool} /></div>,
    faq: <div className="lp-cv lp-cv--faq"><LandingFaq variant={variant} registerHref={register} cta={faqCta} requiresCard={requiresCard} /></div>,
    final: <CtaFooter registerHref={register} cta={low} />,
  };
  return (
    <TrialOfferProvider offer={offer}>
    <div className="jf-lp min-h-full bg-white">
      {/* The page's clock, first in the HTML (lib/pageClock): LandingTiming measures only the load it ran in, in visible time. */}
      <script dangerouslySetInnerHTML={{ __html: pageClockScript("landing") }} />
      <Nav registerHref={register} pricingHref={pricing} cta={low} />
      <main>
        {order.map((key) => (blocks[key] ? <Fragment key={key}>{blocks[key]}</Fragment> : null))}
      </main>
      <MobileCta registerHref={register} cta={low} />
      <ScrollFx />
      <SmoothWheel />
      <LazyBg />
      <WarmLayout />
      <CtaTracker industry={variant} />
      {/* Which sections the visitor reaches, for the admin's analyst (2026-10-02). */}
      <SectionTracker industry={variant} />
      {/* When the first screen really showed on this visitor's phone (2026-10-04). */}
      <LandingTiming industry={variant} />
      <LandingVariantEffects industry={variant} remember={explicitVariant} utm={utm} hook={hook} tool={toolsOn ? adToolUrl : spotlightUrl} />
      {/* Google One Tap (pass A): only when NEXT_PUBLIC_GOOGLE_CLIENT_ID is set;
          loads after the page is idle, so it never competes with the hero. */}
      <GoogleOneTap />
    </div>
    </TrialOfferProvider>
  );
}
