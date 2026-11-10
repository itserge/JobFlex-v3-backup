"use server";
// DRAWS — the writes (2026-11-07, part 6 of the plan "Projects: Remodel and New construction"). Projects are
// estimators' and managers' (actions/projects), so every write is requireEstimatorOrManager and checked against the
// caller's company; the database work is lib/projectDraws/server, the rules lib/projectDraws/shared.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireEstimatorOrManager } from "@/lib/orgContext";
import { fundDraw, layoutDraws, requestDraw, resetDraw, setDraw } from "@/lib/projectDraws/server";
import { parseSchedule } from "@/lib/projectDraws/shared";
import { withFeature } from "@/lib/customPageAccess";

const ID = z.string().min(1).max(64);
const MONEY = z.number().min(0).max(100_000_000);

function touched(projectId: string) {
  revalidatePath("/dashboard/projects");
  revalidatePath(`/dashboard/projects/${projectId}`);
  revalidatePath(`/mobile-project-detail-v2/${projectId}`);
  revalidatePath("/dashboard/financials");
}

export async function layoutProjectDraws(projectId: string, raw: unknown): Promise<{ total: number; draws: Array<{ number: number; name: string; amount: number }> }> {
  const { organizationId, user } = await withFeature(requireEstimatorOrManager(), "project-tools");
  const d = z.object({ total: MONEY.nullable().optional(), schedule: z.unknown().optional(), retainagePct: z.number().min(0).max(50).nullable().optional() }).parse(raw ?? {});
  const r = await layoutDraws(organizationId, projectId, { total: d.total ?? null, schedule: d.schedule !== undefined ? parseSchedule(d.schedule) : null, retainagePct: d.retainagePct ?? null }, user.id);
  touched(projectId);
  return r;
}

const drawPatch = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  amount: MONEY.optional(),
  retainagePct: z.number().min(0).max(50).optional(),
  afterPhase: z.string().max(20).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});

export async function setProjectDraw(projectId: string, drawId: string, raw: unknown): Promise<void> {
  const { organizationId, user } = await withFeature(requireEstimatorOrManager(), "project-tools");
  await setDraw(organizationId, ID.parse(drawId), drawPatch.parse(raw), user.id);
  touched(projectId);
}

export async function requestProjectDraw(projectId: string, drawId: string): Promise<{ words: string }> {
  const { organizationId, user } = await withFeature(requireEstimatorOrManager(), "project-tools");
  const r = await requestDraw(organizationId, ID.parse(drawId), user.id);
  touched(projectId);
  return { words: r.snapshot.words };
}

export async function fundProjectDraw(projectId: string, drawId: string, amount: number | null): Promise<{ funded: number }> {
  const { organizationId, user } = await withFeature(requireEstimatorOrManager(), "project-tools");
  const r = await fundDraw(organizationId, ID.parse(drawId), amount != null ? MONEY.parse(amount) : null, user.id);
  touched(projectId);
  return { funded: r.funded };
}

export async function resetProjectDraw(projectId: string, drawId: string): Promise<void> {
  const { organizationId, user } = await withFeature(requireEstimatorOrManager(), "project-tools");
  await resetDraw(organizationId, ID.parse(drawId), user.id);
  touched(projectId);
}
