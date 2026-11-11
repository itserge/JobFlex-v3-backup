// STRAIGHT TO PROFESSIONAL (owner, 2026-10-15: "when they sign up with Google and the seven-day trial, they go
// automatically into the Professional plan — they don't have to choose and scroll around picking plans — add the
// card, and once they're in, tell them they can adjust the plan any time"). Pure, browser-safe.
//
// The admin switch on /admin/trials (lib/trialPolicyServer readSignupPlan) is "pick" (the plan cards, as built) or
// "auto": the sign-up skips the company screen and the plan cards and opens the card page for one plan. Which plan:
//   1. the one the visitor already chose (?plan= from a pricing page) — their choice wins;
//   2. Professional — unless the ad sold a tool Professional doesn't have: then the cheapest plan that has it (a
//      tool sold as an add-on on any plan, the Deck Studio, moves nothing — lib/planSpotlight isAddOnTool);
//   3. Professional missing from the catalog: the highlighted plan, else the first.
import { SPOTLIGHT, isAddOnTool, type SpotlightTool } from "./planSpotlight";
import type { ToolId } from "./toolPlans/shared";

export const AUTO_PLAN_SLUG = "professional";
export type SignupPlanMode = "pick" | "auto";

export type AutoPlanInput = {
  plans: ReadonlyArray<{ slug: string; features: readonly string[]; priceCents: number; highlight?: boolean }>;
  preferred?: string;
  tool?: SpotlightTool | null;
  /** A plan the visitor chose before the sign-up (?plan=). */
  asked?: string | null;
};
export type AutoPlanPick = { slug: string; why: "asked" | "tool" | "default" | "fallback" };

/** What the register page hands the form when the rule is "auto": the plan the server picked, to say on step 1 and
 *  to open the card page for. */
export type AutoPlanOffer = {
  slug: string;
  name: string;
  priceCents: number;
  why: AutoPlanPick["why"];
  /** THE NEW PLANS (Plans switch on, Base + Tools part 4): the offer is Professional + the ad's tool (`priceCents` is
   *  both), `fromCents` the smallest card (Basic + the tool) for step 1's "Plans start at". The sign-up then opens its
   *  own card page (the tool and the size can change there) instead of handing straight off to Stripe. */
  tools?: { main: ToolId | null; fromCents: number };
};

/** "$79" — the plan's monthly amount alone, for "then $79 (with this plan)". */
export function autoPlanAmount(o: Pick<AutoPlanOffer, "priceCents">): string {
  const d = o.priceCents / 100;
  return `$${Number.isInteger(d) ? d : d.toFixed(2)}`;
}

/** "$79/mo" — the price after the free days, as step 1 says it. */
export function autoPlanPrice(o: Pick<AutoPlanOffer, "priceCents">): string {
  return `${autoPlanAmount(o)}/mo`;
}

/** Each plan's features, with "Everything in Starter" rolled up the way the plan cards read it. */
export function includedFeatures(plans: AutoPlanInput["plans"]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  let inherited: string[] = [];
  for (const p of plans) {
    const own = p.features.map((f) => f.trim()).filter(Boolean);
    const rollsUp = own.some((f) => f.toLowerCase().startsWith("everything in"));
    const list = [...(rollsUp ? inherited : []), ...own.filter((f) => !f.toLowerCase().startsWith("everything in"))];
    map.set(p.slug, list);
    inherited = list;
  }
  return map;
}

/** The plan the sign-up opens the card page for. Null only for an empty catalog. */
export function autoPlanFor(input: AutoPlanInput): AutoPlanPick | null {
  const { plans } = input;
  if (!plans.length) return null;
  const has = (slug: string | null | undefined) => !!slug && plans.some((p) => p.slug === slug);
  if (has(input.asked)) return { slug: input.asked!, why: "asked" };
  const preferredSlug = input.preferred ?? AUTO_PLAN_SLUG;
  const preferred = plans.find((p) => p.slug === preferredSlug);
  const base = preferred ?? plans.find((p) => p.highlight) ?? plans[0];
  if (input.tool && !isAddOnTool(input.tool)) {
    const included = includedFeatures(plans);
    const carries = (slug: string) => (included.get(slug) ?? []).some((f) => SPOTLIGHT[input.tool!].match.test(f));
    if (!carries(base.slug)) {
      const withTool = plans.filter((p) => carries(p.slug)).sort((a, b) => a.priceCents - b.priceCents)[0];
      if (withTool) return { slug: withTool.slug, why: "tool" };
    }
  }
  return { slug: base.slug, why: preferred ? "default" : "fallback" };
}
