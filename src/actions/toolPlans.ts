"use server";
// THE NEW PLANS' PRICES — Admin → Plans (Base + Tools, part 2, 2026-11-10). Platform admin only; lib/toolPlans/prices.
import { requirePlatformAdmin } from "@/lib/orgContext";
import { setToolPrices, type ToolPriceSetting } from "@/lib/toolPlans/prices";

export async function saveToolPricesAction(input: unknown): Promise<{ ok: true; setting: ToolPriceSetting } | { ok: false; problems: string[] }> {
  const admin = await requirePlatformAdmin();
  try {
    return await setToolPrices(input, admin.name || admin.email || null);
  } catch {
    return { ok: false, problems: ["The prices could not be saved. Try again."] };
  }
}
