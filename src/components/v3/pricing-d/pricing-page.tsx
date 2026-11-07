// /pricing — rebuilt in the landing's editorial-blueprint language.
//
// It previously ran the pre-blueprint marketing design (paper-card, font-display,
// the old grey plate) which is why it read as a different product to anyone
// arriving from the landing. Same shell as `/` now: the landing's Nav and
// CtaFooter, the `jf-lp` root and its tokens, so the two pages are one site.
//
// EVERY NUMBER IS READ, NEVER WRITTEN. The plans come from the catalog
// (/admin/plans is the single source of truth for every plan surface) and the
// custom plan's price and trial come from lib/customPlan + lib/customPlanConfig
// — the same values the signup step and both checkout routes use. Nothing here
// is a copy an admin edit could leave behind.
//
// THE PLAN CARDS ARE THE LANDING'S (2026-10-01). The landing's pricing section
// took the register's step-3 cards on 2026-09-26 (landing-e/pricing-plans.tsx:
// white, 2px ink frame, hard ink offset, blue on Most picked, one shared
// feature list, a swipe carousel on a phone). This page renders that same
// component instead of its own plates, and the build-your-own plate wears the
// same frame, price and start button (pricing.css).

import { Nav } from "@/components/v3/landing-e/nav";
import { CtaFooter } from "@/components/v3/landing-e/cta-footer";
import { Reveal } from "@/components/v3/landing-e/reveal";
import { REGISTER } from "@/components/v3/landing-e/routes";
import { PricingPlans } from "@/components/v3/landing-e/pricing-plans";
import type { SpotlightTool } from "@/lib/planSpotlight";
import { PricingVisit } from "./pricing-visit";
import { CustomPlanBlock } from "./custom-plan-block";
import { DeckAddonPlate } from "./deck-addon-plate";
import type { PlanDTO } from "@/lib/planCatalog";
import "@/components/v3/landing-e/landing-e.css";
import "./pricing.css";

export function PricingPage({
  plans,
  customOffered = false,
  spotlight = null,
  narrow = false,
  spotlightUrl = null,
}: {
  /** CUSTOM_PLAN_ENABLED (lib/customPlanFlag): false hides "Build your plan". */
  customOffered?: boolean;
  /** The tool the visitor came for (lib/planSpotlight), marked on every card. */
  spotlight?: SpotlightTool | null;
  /** Hide the other trade estimators — only during the ad visit (lib/planSpotlight spotlightNarrows). */
  narrow?: boolean;
  /** The spotlight this page's URL carried, remembered for the browser session. */
  spotlightUrl?: SpotlightTool | null;
  plans: PlanDTO[];
}) {
  // A $0 tier is what happens when somebody skips, not something to sell here.
  const sellable = plans.filter((p) => !p.isFree);

  return (
    <div className="jf-lp min-h-full bg-white">
      <Nav />
      <main>
        {/* Masthead. The rule under it is the page's spine — the same hairline
            the plates and the ledger rows are drawn with. */}
        <section className="px-5 sm:px-6">
          <div className="mx-auto lp-wrap py-[9vmin]">
            <Reveal>
              <p className="lp-eyebrow text-lp-blue">Pricing</p>
              <h1 className="mt-6 max-w-[22ch] text-[clamp(38px,5.4vw,72px)] font-bold leading-[1.04] tracking-[-0.03em]">
                Pay for the shop you run.
              </h1>
              <p className="mt-6 max-w-[52ch] text-[16px] leading-[1.65] text-slate-500 sm:text-[17px]">
                Every plan carries unlimited clients and the client portal. Move up, move down, or
                build your own from the pages you actually open. No setup fee, cancel whenever.
              </p>
            </Reveal>
          </div>
        </section>

        {/* The plates */}
        <section className="px-5 sm:px-6">
          <div className="mx-auto lp-wrap">
            <div className="border-t border-slate-900/10 pt-[6vmin]">
              {sellable.length > 0 ? (
                <>
                  <Reveal className="pr-plans">
                    <PricingPlans plans={sellable} registerHref={REGISTER} spotlight={spotlight} narrow={narrow} fromUrl={spotlightUrl} />
                  </Reveal>
                  {/* The Deck Studio add-on (owner, 2026-10-26): on any plan, in the trial. */}
                  <div className="mt-10 sm:mt-12">
                    <DeckAddonPlate registerHref={REGISTER} cta="pricing-deck" delay={120} />
                  </div>
                </>
              ) : (
                <p className="py-12 text-center text-[15px] text-slate-500">
                  Plans are being updated. Check back shortly.
                </p>
              )}
            </div>
          </div>
        </section>

        {/* Build your own — the page that prices itself. Off sale unless
            CUSTOM_PLAN_ENABLED (lib/customPlanFlag). */}
        {customOffered ? (
          <section className="px-5 sm:px-6">
            <div className="mx-auto lp-wrap py-[8vmin]">
              <CustomPlanBlock registerHref={REGISTER} cta="pricing-custom" />
            </div>
          </section>
        ) : null}

        <CtaFooter />
      </main>
      <PricingVisit />
    </div>
  );
}
