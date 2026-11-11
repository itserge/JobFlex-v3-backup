"use server";
// THE NEW PLANS' PRICES — Admin → Plans (Base + Tools, part 2, 2026-11-10; platform admin only), and the prices a
// new-plan shop's offer card reads (part 3a, any signed-in member). lib/toolPlans/prices.
import { requireOrg, requirePlatformAdmin } from "@/lib/orgContext";
import { readToolCatalog, setToolPrices, type ToolPriceSetting } from "@/lib/toolPlans/prices";
import type { ToolId, ToolPlanId } from "@/lib/toolPlans/shared";

export async function saveToolPricesAction(input: unknown): Promise<{ ok: true; setting: ToolPriceSetting } | { ok: false; problems: string[] }> {
  const admin = await requirePlatformAdmin();
  try {
    return await setToolPrices(input, admin.name || admin.email || null);
  } catch {
    return { ok: false, problems: ["The prices could not be saved. Try again."] };
  }
}

/** The tools' and sizes' monthly prices in force (Admin → Plans), for the card a new-plan shop sees at a page its
 *  plan doesn't hold (components/v3/upgrade-gate). Signed-in members only; null for anyone else. */
export async function toolGatePrices(): Promise<{ tools: Partial<Record<ToolId, number>>; plans: Partial<Record<ToolPlanId, number>> } | null> {
  try {
    await requireOrg();
  } catch {
    return null;
  }
  const cat = await readToolCatalog();
  return {
    tools: Object.fromEntries(cat.tools.map((t) => [t.id, t.cents])) as Partial<Record<ToolId, number>>,
    plans: Object.fromEntries(cat.plans.map((p) => [p.id, p.cents])) as Partial<Record<ToolPlanId, number>>,
  };
}
