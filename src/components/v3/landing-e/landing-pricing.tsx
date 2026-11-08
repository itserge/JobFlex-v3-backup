import type { PlanDTO } from "@/lib/planCatalog";
import { PricingPlans } from "./pricing-plans";
import { Reveal } from "./reveal";
import { REGISTER } from "./routes";
import "./pricing-faq.css";
import { CustomPlanBlock } from "@/components/v3/pricing-d/custom-plan-block";
import { DeckAddonPlate } from "@/components/v3/pricing-d/deck-addon-plate";
import { showsTool, type SpotlightTool } from "@/lib/planSpotlight";

/* The price anchor before the footer (CRO stage 2, 2026-09-09). The plans
   are the Subscription page's own catalogue (PricingPlan, via
   getPlanCatalog on the server) — nothing here names a plan or a price.
   THE INK SHEET (owner, 2026-09-10): lp-base under the showcase's drafting
   grid (landing-e.css, .lp-price).
   SUBSCRIPTION PLANS (owner, 2026-09-26): the section's headline is the
   title, set large; the cards are the register's step-3 plan cards
   (pricing-plans.tsx), each with its own start button, so the section has
   no separate CTA — `cta` is still accepted from the page and unused.
   A $0 tier, when one exists in the catalogue, is what a skipped checkout
   leaves behind and is not sold. */
export function LandingPricing({
  plans,
  registerHref = REGISTER,
  customOffered = false,
  spotlight = null,
  narrow = false,
  fromUrl = null,
}: {
  plans: PlanDTO[];
  /** The tool the visitor came for (lib/planSpotlight): pinned and marked on every card. */
  spotlight?: SpotlightTool | null;
  /** Hide the other trade estimators — only during the ad visit (lib/planSpotlight spotlightNarrows). */
  narrow?: boolean;
  /** The spotlight this page's URL carried, remembered for the browser session. */
  fromUrl?: SpotlightTool | null;
  /** CUSTOM_PLAN_ENABLED (lib/customPlanFlag), read on the server per request:
   *  "Build your plan" under the cards while the custom plan is on sale. */
  customOffered?: boolean;
  registerHref?: string;
  cta?: string;
}) {
  const sellable = plans.filter((p) => !p.isFree);
  if (!sellable.length) return null;

  return (
    <section id="pricing" className="lp-price relative overflow-hidden px-5 py-[8vmin] sm:px-6">
      <div className="relative z-[1] mx-auto lp-wrap">
        <Reveal>
          <h2 className="lp-sec-title lp-sec-title--on-ink">Subscription plans</h2>
          {/* U+2011 non-breaking hyphens: the line never breaks at "per-/seat" or "add-/ons". */}
          <p className="lp-sec-lede lp-sec-lede--on-ink">Flat monthly price · no per‑seat add‑ons</p>
        </Reveal>

        <Reveal delay={120} className="mt-9 sm:mt-11">
          <PricingPlans plans={sellable} registerHref={registerHref} tone="ink" spotlight={spotlight} narrow={narrow} fromUrl={fromUrl} />
        </Reveal>

        {/* The Deck Studio add-on (owner, 2026-10-26): on any plan, in the trial. A trade estimator: hidden while a
            roofer/fencer/HVAC ad visit narrows the cards (lib/planSpotlight, owner 2026-11-07). */}
        {showsTool("deck", narrow ? spotlight : null) ? (
          <div className="mt-8 sm:mt-10">
            <DeckAddonPlate registerHref={registerHref} cta="landing-deck" delay={150} />
          </div>
        ) : null}

        {customOffered ? (
          <div className="mt-10 sm:mt-14">
            <CustomPlanBlock registerHref={registerHref} cta="landing-custom" delay={180} />
          </div>
        ) : null}
      </div>
    </section>
  );
}
