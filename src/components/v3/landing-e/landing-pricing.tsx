import type { PlanDTO } from "@/lib/planCatalog";
import { PricingPlans } from "./pricing-plans";
import { Reveal } from "./reveal";
import { REGISTER } from "./routes";
import "./pricing-faq.css";
import { CustomPlanBlock } from "@/components/v3/pricing-d/custom-plan-block";
import { DeckAddonPlate } from "@/components/v3/pricing-d/deck-addon-plate";
import { showsTool, type SpotlightTool } from "@/lib/planSpotlight";
import { isToolsCatalog } from "@/lib/toolPlans/cards";
import type { Catalog, ToolId } from "@/lib/toolPlans/shared";
import { VisitorToolsBuilder } from "@/components/v3/tools-plan/tools-builder";

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
  mainTool = null,
  toolsCatalog = null,
}: {
  plans: PlanDTO[];
  /** The new plans (Plans switch on): the ad's tool — ticked in the builder when the page opens. */
  mainTool?: ToolId | null;
  /** The new plans: the sizes and tools at the prices in force (lib/toolPlans/prices) — the builder draws from it. */
  toolsCatalog?: Catalog | null;
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
  /* THE NEW PLANS (Base + Tools; the builder, owner 2026-11-12): no cards priced with a tool — the visitor builds the
     plan: a size at its own price, the tools they want to try ticked on top (the ad's tool comes ticked), and one
     start button that carries it all to the sign-up. Deck Studio is one of the tools, not the Classic add-on, and
     the Classic custom plan is not sold beside them — both plates stay off. */
  const tools = isToolsCatalog(sellable) && toolsCatalog ? { catalog: toolsCatalog, main: mainTool } : undefined;

  return (
    <section id="pricing" className="lp-price relative overflow-hidden px-5 py-[8vmin] sm:px-6">
      <div className="relative z-[1] mx-auto lp-wrap">
        <Reveal>
          <h2 className="lp-sec-title lp-sec-title--on-ink">Subscription plans</h2>
          {/* U+2011 non-breaking hyphens: the line never breaks at "per-/seat" or "add-/ons". */}
          {/* The new plans sell people past a size's own and tools on top: the Classic line would not be true of them. */}
          <p className="lp-sec-lede lp-sec-lede--on-ink">{tools ? "Build your plan · try it free · keep only what you use" : "Flat monthly price · no per‑seat add‑ons"}</p>
        </Reveal>

        <Reveal delay={120} className="mt-9 sm:mt-11">
          {tools ? (
            <VisitorToolsBuilder catalog={tools.catalog} adTool={tools.main} registerHref={registerHref} narrow={narrow} tone="ink" />
          ) : (
            <PricingPlans plans={sellable} registerHref={registerHref} tone="ink" spotlight={spotlight} narrow={narrow} fromUrl={fromUrl} />
          )}
        </Reveal>

        {/* The Deck Studio add-on (owner, 2026-10-26): on any plan, in the trial. A trade estimator: hidden while a
            roofer/fencer/HVAC ad visit narrows the cards (lib/planSpotlight, owner 2026-11-07). */}
        {!tools && showsTool("deck", narrow ? spotlight : null) ? (
          <div className="mt-8 sm:mt-10">
            <DeckAddonPlate registerHref={registerHref} cta="landing-deck" delay={150} />
          </div>
        ) : null}

        {customOffered && !tools ? (
          <div className="mt-10 sm:mt-14">
            <CustomPlanBlock registerHref={registerHref} cta="landing-custom" delay={180} />
          </div>
        ) : null}
      </div>
    </section>
  );
}
