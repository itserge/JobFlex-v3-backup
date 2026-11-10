"use server";
// WHO IT IS FOR, AND THE MONEY — the writes (2026-11-07, part 5 of the plan "Projects: Remodel and New construction").
// Projects are estimators' and managers' (actions/projects), so every write is requireEstimatorOrManager and checked
// against the caller's company; the database work is lib/projectMoneyPlan/server, the rules lib/projectMoneyPlan/shared.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireEstimatorOrManager } from "@/lib/orgContext";
import { applyAdvice, layoutBudget, setMoneySettings, setPhaseBudget } from "@/lib/projectMoneyPlan/server";
import type { MoneySettings } from "@/lib/projectMoneyPlan/shared";
import { withFeature } from "@/lib/customPageAccess";

const ID = z.string().min(1).max(64);

function touched(projectId: string) {
  revalidatePath("/dashboard/projects");
  revalidatePath(`/dashboard/projects/${projectId}`);
  revalidatePath(`/mobile-project-detail-v2/${projectId}`);
}

export async function layoutProjectBudget(projectId: string, total: number | null): Promise<{ total: number; phases: Array<{ id: string; name: string; budget: number }> }> {
  const { organizationId, user } = await withFeature(requireEstimatorOrManager(), "project-tools");
  const r = await layoutBudget(organizationId, projectId, total != null ? z.number().min(0).max(100_000_000).parse(total) : null, user.id);
  touched(projectId);
  return r;
}

export async function setProjectPhaseBudget(projectId: string, phaseId: string, budget: number): Promise<void> {
  const { organizationId, user } = await withFeature(requireEstimatorOrManager(), "project-tools");
  await setPhaseBudget(organizationId, ID.parse(phaseId), z.number().min(0).max(100_000_000).parse(budget), user.id);
  touched(projectId);
}

const moneyInput = z.object({
  forWhom: z.enum(["CLIENT", "SELF"]).optional(),
  moneyMode: z.enum(["PROJECT_MARGIN", "JOB_MARGIN", "COST_PLUS", "NONE"]).optional(),
  marginPct: z.number().min(0).max(100).nullable().optional(),
  feeAmount: z.number().min(0).max(100_000_000).nullable().optional(),
  salePrice: z.number().min(0).max(100_000_000).nullable().optional(),
});

export async function setProjectMoney(projectId: string, raw: unknown): Promise<MoneySettings> {
  const { organizationId, user } = await withFeature(requireEstimatorOrManager(), "project-tools");
  const r = await setMoneySettings(organizationId, projectId, moneyInput.parse(raw), user.id);
  touched(projectId);
  return r;
}

const adviceInput = z.object({
  kind: z.enum(["change_order", "lower_allowance", "rebid_sub", "swap_material", "self_perform", "defer_scope", "move_contingency"]),
  ref: z.record(z.string(), z.union([z.string(), z.number(), z.null()])),
});

export async function applyProjectAdvice(projectId: string, raw: unknown): Promise<{ words: string }> {
  const { organizationId, user } = await withFeature(requireEstimatorOrManager(), "project-tools");
  const d = adviceInput.parse(raw);
  const words = await applyAdvice(organizationId, projectId, d.kind, d.ref, user.id);
  touched(projectId);
  return { words };
}
