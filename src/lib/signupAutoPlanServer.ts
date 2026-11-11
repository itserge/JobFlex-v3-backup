import "server-only";
// STRAIGHT TO PROFESSIONAL, ASKED NOW (2026-10-17). The plan the sign-up opens the card page for — or null for the
// plan cards — read from the admin switch (lib/trialPolicyServer readSignupPlan) at the moment it is asked, by the
// one rule (lib/signupAutoPlan autoPlanFor). The register page asks it as the page is drawn (step 1 names the plan);
// the plan step asks it again as it opens (actions/signupPaywall signupPlans), so a tab drawn before the switch was
// turned on — or off — and a draft or intent saved under the other setting still get what the switch says today.
import { readSignupPlan } from "@/lib/trialPolicyServer";
import type { PlanDTO } from "@/lib/planCatalog";
import { autoPlanFor, type AutoPlanOffer } from "@/lib/signupAutoPlan";
import type { SpotlightTool } from "@/lib/planSpotlight";
import { toolsPlansOn } from "@/lib/toolPlans/server";
import { getPublicPlans } from "@/lib/toolPlans/publicPlans";
import { isToolsCatalog } from "@/lib/toolPlans/cards";
import { isToolId } from "@/lib/toolPlans/shared";

export type AutoPlanAsk = {
  /** ?plan= — a plan the visitor chose on a pricing page, this visit. */
  asked?: string | null;
  edition?: "deck" | null;
  /** The tool the ad sold (lib/planSpotlight). */
  tool?: SpotlightTool | null;
  /** The new plans' main tool (lib/toolPlans/cards mainToolFor) — read only while the Plans switch is on. */
  mainTool?: string | null;
};

type Catalog = PlanDTO[];

export async function autoPlanOffer(ask: AutoPlanAsk, catalog?: Catalog): Promise<AutoPlanOffer | null> {
  if ((await readSignupPlan()).mode !== "auto") return null;
  /* THE NEW PLANS (owner, 2026-11-10): Professional + the ad's tool — every tool is sold on every size, so the tool
     never moves the plan; a plan asked for (?plan=tools-basic from a card) wins. The public cards' one read
     (lib/toolPlans/publicPlans); a Classic catalog handed in is used only while the switch is off, as before. */
  const main = isToolId(ask.mainTool) ? ask.mainTool : null;
  const cards = catalog && !(await toolsPlansOn()) ? catalog : await getPublicPlans({ tool: main }).catch(() => []);
  if (isToolsCatalog(cards)) {
    const pick = autoPlanFor({ plans: cards, tool: null, asked: ask.asked ?? null, preferred: "tools-professional" });
    const plan = pick ? cards.find((p) => p.slug === pick.slug) : null;
    if (!pick || !plan) return null;
    return { slug: plan.slug, name: plan.name, priceCents: plan.priceCents, why: pick.why, tools: { main, fromCents: Math.min(...cards.map((p) => p.priceCents)) } };
  }
  const plans = cards.filter((p) => !p.isFree);
  const pick = autoPlanFor({ plans, tool: ask.tool ?? null, asked: ask.asked ?? null });
  const plan = pick ? plans.find((p) => p.slug === pick.slug) : null;
  return pick && plan ? { slug: plan.slug, name: plan.name, priceCents: plan.priceCents, why: pick.why } : null;
}
