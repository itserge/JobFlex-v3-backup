"use server";
// THE FINISH LINE — the writes (the timeline build, 2026-11-06): inspections, the punch list and the seven steps
// to the end of a project. Projects are estimators' and managers' (actions/projects), so every write is
// requireEstimatorOrManager; the database work is lib/projectFinish/server. The crew ticks punch items through
// /api/crew/<job>/punch instead (their door).

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireEstimatorOrManager } from "@/lib/orgContext";
import {
  addInspection,
  addPunchItems,
  archiveProjectRow,
  askReview,
  clearSignOff,
  deleteInspection,
  deletePunchItem,
  finishProject,
  recordInspection,
  reopenProject,
  setWarranty,
  signOff,
  tickPunch,
  updateInspection,
} from "@/lib/projectFinish/server";
import { withFeature } from "@/lib/customPageAccess";

const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function touched(projectId: string) {
  revalidatePath("/dashboard/projects");
  revalidatePath(`/dashboard/projects/${projectId}`);
  revalidatePath(`/mobile-project-detail-v2/${projectId}`);
}

// ── inspections ──────────────────────────────────────────────────────────────

const inspectionInput = z.object({
  name: z.string().min(1).max(120),
  date: DAY.nullable().optional(),
  readyNote: z.string().max(1000).nullable().optional(),
  stageId: z.string().min(1).nullable().optional(),
  isFinal: z.boolean().optional(),
  kind: z.string().max(40).nullable().optional(),
  gate: z.boolean().nullable().optional(),
});

export async function addProjectInspection(projectId: string, raw: unknown): Promise<{ id: string }> {
  const { organizationId, user } = await withFeature(requireEstimatorOrManager(), "project-tools");
  const r = await addInspection(organizationId, projectId, inspectionInput.parse(raw), user.id);
  touched(projectId);
  return r;
}

export async function updateProjectInspection(projectId: string, inspectionId: string, raw: unknown): Promise<void> {
  const { organizationId, user } = await withFeature(requireEstimatorOrManager(), "project-tools");
  await updateInspection(organizationId, inspectionId, inspectionInput.partial().parse(raw), user.id);
  touched(projectId);
}

export async function recordProjectInspection(inspectionId: string, result: "PASSED" | "FAILED" | "PENDING", note: string | null): Promise<void> {
  const { organizationId, user } = await withFeature(requireEstimatorOrManager(), "project-tools");
  const r = await recordInspection(organizationId, inspectionId, z.enum(["PASSED", "FAILED", "PENDING"]).parse(result), note, user.id);
  touched(r.projectId);
}

export async function deleteProjectInspection(inspectionId: string): Promise<void> {
  const { organizationId } = await withFeature(requireEstimatorOrManager(), "project-tools");
  const r = await deleteInspection(organizationId, inspectionId);
  touched(r.projectId);
}

// ── punch list ───────────────────────────────────────────────────────────────

export async function addPunchList(projectId: string, notes: string[], jobId: string | null): Promise<{ added: number }> {
  const { organizationId, user } = await withFeature(requireEstimatorOrManager(), "project-tools");
  const r = await addPunchItems(organizationId, projectId, z.array(z.string().max(500)).min(1).max(60).parse(notes), jobId, user.id);
  touched(projectId);
  return r;
}

export async function setPunchDone(itemId: string, done: boolean, photoId: string | null): Promise<{ openLeft: number }> {
  const { organizationId, user } = await withFeature(requireEstimatorOrManager(), "project-tools");
  const r = await tickPunch(organizationId, itemId, done, photoId, user.id, user.name);
  touched(r.projectId);
  return { openLeft: r.openLeft };
}

export async function removePunchItem(itemId: string): Promise<void> {
  const { organizationId } = await withFeature(requireEstimatorOrManager(), "project-tools");
  const r = await deletePunchItem(organizationId, itemId);
  touched(r.projectId);
}

// ── the steps ────────────────────────────────────────────────────────────────

export async function clientSignedOff(projectId: string, by: string | null): Promise<void> {
  const { organizationId, user } = await withFeature(requireEstimatorOrManager(), "project-tools");
  await signOff(organizationId, projectId, z.string().max(120).nullable().parse(by), user.id);
  touched(projectId);
}

export async function undoClientSignOff(projectId: string): Promise<void> {
  const { organizationId } = await withFeature(requireEstimatorOrManager(), "project-tools");
  await clearSignOff(organizationId, projectId);
  touched(projectId);
}

export async function setProjectWarranty(projectId: string, until: string | null): Promise<void> {
  const { organizationId, user } = await withFeature(requireEstimatorOrManager(), "project-tools");
  await setWarranty(organizationId, projectId, DAY.nullable().parse(until), user.id);
  touched(projectId);
}

export async function askProjectReview(projectId: string): Promise<{ href: string; emailed: boolean; created: boolean }> {
  const { organizationId, user } = await withFeature(requireEstimatorOrManager(), "project-tools");
  const r = await askReview(organizationId, projectId, user.id);
  touched(projectId);
  revalidatePath("/dashboard/reviews");
  return { href: `/review/${r.publicToken}`, emailed: r.emailed, created: r.created };
}

export async function markProjectFinished(projectId: string): Promise<void> {
  const { organizationId, user } = await withFeature(requireEstimatorOrManager(), "project-tools");
  await finishProject(organizationId, projectId, user.id);
  touched(projectId);
}

export async function reopenFinishedProject(projectId: string): Promise<void> {
  const { organizationId, user } = await withFeature(requireEstimatorOrManager(), "project-tools");
  await reopenProject(organizationId, projectId, user.id);
  touched(projectId);
}

export async function archiveFinishedProject(projectId: string): Promise<void> {
  const { organizationId, user } = await withFeature(requireEstimatorOrManager(), "project-tools");
  await archiveProjectRow(organizationId, projectId, user.id);
  touched(projectId);
}
