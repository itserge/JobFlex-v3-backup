"use server";
// SELECTIONS — the writes (2026-11-07, part 3 of the plan "Projects: Remodel and New construction"). Projects are
// estimators' and managers' (actions/projects), so every write is requireEstimatorOrManager and every row is
// checked against the caller's company; the database work is lib/projectSelections/server, the rules
// lib/projectSelections/shared.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireEstimatorOrManager } from "@/lib/orgContext";
import { addSelection, chooseSelection, deleteSelection, reopenSelection, updateSelection } from "@/lib/projectSelections/server";

const ID = z.string().min(1).max(64);
const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function touched(projectId: string) {
  revalidatePath("/dashboard/projects");
  revalidatePath(`/dashboard/projects/${projectId}`);
  revalidatePath(`/mobile-project-detail-v2/${projectId}`);
}

const selectionInput = z.object({
  name: z.string().trim().min(1).max(120),
  stageId: ID.nullable().optional(),
  leadDays: z.number().int().min(0).max(365).nullable().optional(),
  dueBy: DAY.nullable().optional(),
  allowance: z.number().min(0).max(10_000_000).nullable().optional(),
  note: z.string().trim().max(1000).nullable().optional(),
});

const pickInput = z.object({
  chosen: z.string().trim().max(500).nullable().optional(),
  vendor: z.string().trim().max(120).nullable().optional(),
  price: z.number().min(0).max(10_000_000).nullable().optional(),
});

export async function addProjectSelection(projectId: string, raw: unknown): Promise<{ id: string; name: string }> {
  const { organizationId, user } = await requireEstimatorOrManager();
  const r = await addSelection(organizationId, projectId, selectionInput.parse(raw), user.id);
  touched(projectId);
  return r;
}

export async function updateProjectSelection(projectId: string, selectionId: string, raw: unknown): Promise<void> {
  const { organizationId, user } = await requireEstimatorOrManager();
  await updateSelection(organizationId, selectionId, selectionInput.partial().parse(raw), user.id);
  touched(projectId);
}

export async function chooseProjectSelection(projectId: string, selectionId: string, raw: unknown): Promise<{ words: string }> {
  const { organizationId, user } = await requireEstimatorOrManager();
  const d = pickInput.parse(raw);
  const r = await chooseSelection(organizationId, selectionId, { chosen: d.chosen ?? null, vendor: d.vendor ?? null, price: d.price ?? null }, user.id);
  touched(projectId);
  return { words: r.words };
}

export async function reopenProjectSelection(projectId: string, selectionId: string): Promise<void> {
  const { organizationId, user } = await requireEstimatorOrManager();
  await reopenSelection(organizationId, selectionId, user.id);
  touched(projectId);
}

export async function deleteProjectSelection(projectId: string, selectionId: string): Promise<void> {
  const { organizationId } = await requireEstimatorOrManager();
  await deleteSelection(organizationId, selectionId);
  touched(projectId);
}
