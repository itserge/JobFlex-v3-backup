"use server";
// THE OVERVIEW'S "NOT NOW" (2026-11-09, lib/projectOverview): anyone who can open the project hides a row for
// themselves; the project must be the company's.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireOrg } from "@/lib/orgContext";
import { clearSnoozes, snooze } from "@/lib/projectOverview/server";

const input = z.object({ projectId: z.string().min(1).max(64), key: z.string().min(1).max(120), tone: z.enum(["red", "amber"]) });

async function ownProject(organizationId: string, projectId: string) {
  const p = await db.project.findFirst({ where: { id: projectId, organizationId }, select: { id: true } });
  if (!p) throw new Error("Project not found");
}

export async function snoozeOverviewItem(raw: unknown): Promise<void> {
  const { organizationId, user } = await requireOrg();
  const data = input.parse(raw);
  await ownProject(organizationId, data.projectId);
  await snooze(organizationId, user.id, data.projectId, data.key, data.tone);
  revalidatePath(`/dashboard/projects/${data.projectId}`);
}

export async function showOverviewItems(projectId: string): Promise<void> {
  const { organizationId, user } = await requireOrg();
  await ownProject(organizationId, z.string().min(1).max(64).parse(projectId));
  await clearSnoozes(organizationId, user.id, projectId);
  revalidatePath(`/dashboard/projects/${projectId}`);
}
