"use server";
// THE PROJECT TIMELINE — the writes (the timeline build, 2026-11-06): "Shift the rest" from a stage that slipped,
// "Lay out the days" for stages with none, and the Schedule & crew sheet's question "is anyone already booked?".
// Projects are estimators' and managers' (actions/projects), so every write is requireEstimatorOrManager; the
// database work is lib/projectTimeline/server.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireEstimatorOrManager } from "@/lib/orgContext";
import { busyWords, crewBusy, layoutStages, planShift, shiftRest, type BusyDay } from "@/lib/projectTimeline/server";
import type { ShiftPlan } from "@/lib/projectTimeline/shared";
import { withFeature } from "@/lib/customPageAccess";

const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function touched(projectId: string) {
  revalidatePath("/dashboard/projects");
  revalidatePath(`/dashboard/projects/${projectId}`);
  revalidatePath(`/mobile-project-detail-v2/${projectId}`);
  revalidatePath("/dashboard/calendar");
  revalidatePath("/dashboard/jobs");
}

/** What a shift would move — the sheet shows it before the person says yes. */
export async function previewShift(projectId: string, stageId: string, days: number): Promise<ShiftPlan | { error: string }> {
  const { organizationId } = await withFeature(requireEstimatorOrManager(), "project-tools");
  return planShift(organizationId, projectId, stageId, Math.round(days));
}

export async function shiftTheRest(projectId: string, stageId: string, days: number): Promise<{ words: string[] }> {
  const { organizationId, user } = await withFeature(requireEstimatorOrManager(), "project-tools");
  const r = await shiftRest(organizationId, projectId, stageId, Math.round(days), user.id);
  touched(projectId);
  return { words: r.words };
}

const layoutInput = z.object({ from: DAY, workDays: z.number().int().min(1).max(400).nullable().optional(), perWeight: z.number().min(0.5).max(30).nullable().optional() });

export async function layOutStages(projectId: string, raw: unknown): Promise<{ dated: number }> {
  const { organizationId, user } = await withFeature(requireEstimatorOrManager(), "project-tools");
  const data = layoutInput.parse(raw);
  const r = await layoutStages(organizationId, projectId, data.from, { workDays: data.workDays ?? null, perWeight: data.perWeight ?? null }, user.id);
  touched(projectId);
  return { dated: r.length };
}

const busyInput = z.object({
  jobId: z.string().min(1).nullable(),
  days: z.array(z.object({ startsAt: z.string().datetime(), endsAt: z.string().datetime() })).min(1).max(120),
  workerIds: z.array(z.string().min(1)).max(40),
});

/** Who of these workers is already somewhere else on these days (the sheet asks as the dates and crew change). */
export async function crewAlreadyBooked(raw: unknown): Promise<{ rows: BusyDay[]; words: string[] }> {
  const { organizationId } = await withFeature(requireEstimatorOrManager(), "project-tools");
  const data = busyInput.parse(raw);
  const rows = await crewBusy(
    organizationId,
    data.workerIds,
    data.days.map((d) => ({ startsAt: new Date(d.startsAt), endsAt: new Date(d.endsAt) })),
    data.jobId,
  );
  return { rows, words: busyWords(rows) };
}
