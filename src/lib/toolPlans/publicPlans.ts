import "server-only";
// THE PUBLIC PLAN CARDS' ONE READ (Base + Tools, part 4 — owner, 2026-11-10). Only the surfaces a visitor sees before
// there is an account read this: the landing's pricing section, /pricing, and the sign-up's plan step
// (actions/signupPaywall, lib/signupAutoPlanServer). The admin's plan editor, the investor pages and an existing
// shop's Subscription and Upgrade pages keep reading the Classic catalog themselves (lib/planCatalogServer).
//
//   switch off — getPlanCatalog(), untouched: the same rows, the same order, the same errors.
//   switch on  — the four new plans as PlanDTOs, each size at its own price in force (Admin → Plans,
//                lib/toolPlans/prices) — lib/toolPlans/cards toolsPlanDTOs. Tools are ticked on top in the builder
//                (owner, 2026-11-12), never folded into a size's price; `tool` is kept for the callers and unused.

import { getPlanCatalog } from "@/lib/planCatalogServer";
import type { PlanDTO } from "@/lib/planCatalog";
import { readToolCatalog } from "./prices";
import { toolsPlansOn } from "./server";
import { toolsPlanDTOs } from "./cards";
import type { ToolId } from "./shared";

export async function getPublicPlans(opts: { tool?: ToolId | null; trialDays?: number } = {}): Promise<PlanDTO[]> {
  if (!(await toolsPlansOn())) return getPlanCatalog();
  return toolsPlanDTOs(await readToolCatalog(), opts.trialDays);
}
