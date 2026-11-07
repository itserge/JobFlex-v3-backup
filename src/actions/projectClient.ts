"use server";
// THE CLIENT'S PROJECT PAGE AND FILES — the writes (the client build, 2026-11-06): the link, the update, which photos
// the homeowner sees, the files. Projects are estimators' and managers' (actions/projects), so every write is
// requireEstimatorOrManager; the database work is lib/projectClient/server.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireEstimatorOrManager } from "@/lib/orgContext";
import { addFile, ensureShare, projectPhotos, removeFile, sendUpdate, setFileVisible, setPhotosShared, type PhotoRow, type UpdateResult } from "@/lib/projectClient/server";
import { FILE_KINDS } from "@/lib/projectClient/shared";

function touched(projectId: string) {
  revalidatePath(`/dashboard/projects/${projectId}`);
  revalidatePath(`/mobile-project-detail-v2/${projectId}`);
}

export async function shareProjectPage(projectId: string): Promise<{ href: string }> {
  const { organizationId, user } = await requireEstimatorOrManager();
  const r = await ensureShare(organizationId, projectId, user.id);
  touched(projectId);
  return { href: r.href };
}

export async function sendClientUpdate(projectId: string, note: string | null): Promise<UpdateResult> {
  const { organizationId, user } = await requireEstimatorOrManager();
  const r = await sendUpdate(organizationId, projectId, user.id, z.string().max(600).nullable().parse(note));
  touched(projectId);
  return r;
}

export async function loadProjectPhotos(projectId: string): Promise<PhotoRow[]> {
  const { organizationId } = await requireEstimatorOrManager();
  return projectPhotos(organizationId, projectId);
}

export async function setClientPhotos(projectId: string, photoIds: string[], shared: boolean): Promise<{ changed: number }> {
  const { organizationId } = await requireEstimatorOrManager();
  const r = await setPhotosShared(organizationId, z.array(z.string().min(1)).max(200).parse(photoIds), shared);
  touched(projectId);
  return r;
}

const fileInput = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(FILE_KINDS),
  dataUrl: z.string().max(12 * 1024 * 1024).nullable().optional(),
  link: z.string().max(2000).nullable().optional(),
  clientVisible: z.boolean(),
});

export async function addProjectFile(projectId: string, raw: unknown): Promise<{ id: string }> {
  const { organizationId, user } = await requireEstimatorOrManager();
  const r = await addFile(organizationId, projectId, fileInput.parse(raw), user.id);
  touched(projectId);
  return r;
}

export async function setProjectFileVisible(fileId: string, visible: boolean): Promise<void> {
  const { organizationId } = await requireEstimatorOrManager();
  const r = await setFileVisible(organizationId, fileId, visible);
  touched(r.projectId);
}

export async function removeProjectFile(fileId: string): Promise<void> {
  const { organizationId } = await requireEstimatorOrManager();
  const r = await removeFile(organizationId, fileId);
  touched(r.projectId);
}
