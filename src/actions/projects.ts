"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
// Projects are open to estimators as well as managers (full access — projects
// aren't per-user scoped, so estimators manage all org projects).
import { requireEstimatorOrManager, requireRouteAccess } from "@/lib/orgContext";
import { db } from "@/lib/db";
import { enforcePlanLimit } from "@/lib/limitsEngine";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { loadProjectBook } from "@/components/v3/projects-blueprint/project-book-load";
import type { Project } from "@/components/v3/projects-blueprint/projects-data";
import { numbered } from "@/lib/projectStages/server";

const projectInput = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  status: z.enum(["ACTIVE", "ON_HOLD", "COMPLETED", "ARCHIVED"]).default("ACTIVE"),
  startsAt: z.coerce.date().optional().nullable(),
  endsAt: z.coerce.date().optional().nullable(),
  budget: z.number().min(0).default(0),
  // The client the project is for (2026-09-18). Checked against the org.
  clientId: z.string().min(1).optional().nullable(),
});

/** The client, when it is this organization's and not deleted; else null. */
async function clientInOrg(organizationId: string, clientId: string | null | undefined): Promise<string | null> {
  if (!clientId) return null;
  const c = await db.client.findFirst({ where: { id: clientId, organizationId, deletedAt: null }, select: { id: true } });
  if (!c) throw new Error("Client not found");
  return c.id;
}

/** One row of the project book — the data module's own shape, so the two
 *  editions of /dashboard/projects read one definition. */
export type ProjectBookRow = Project;

/**
 * The org's project book, for surfaces that cannot be handed the server
 * component's rows as props — the handheld build of /dashboard/projects is
 * mounted by the responsive shell with no props, so it reads the book itself
 * and re-reads it after every write. One loader with the desktop page
 * (projects-blueprint/project-book-load), so the two never disagree.
 * Every role that can open the page may read it (lib/roleRoutes — 2026-10-12,
 * before which any member could); the writes below keep their stricter guard.
 */
export async function listProjects(): Promise<ProjectBookRow[]> {
  const { organizationId } = await requireRouteAccess("/dashboard/projects");
  return loadProjectBook(organizationId);
}

/** The org's clients for a New Project form that loads its own data (the
 *  handheld projects page is mounted with no props). Read-only. */
export async function listProjectClients(): Promise<Array<{ id: string; name: string; street: string }>> {
  const { organizationId } = await requireRouteAccess("/dashboard/projects");
  const rows = await db.client.findMany({
    where: { organizationId, deletedAt: null },
    orderBy: { name: "asc" },
    select: { id: true, name: true, address: true },
    take: 1000,
  });
  return rows.map((c) => ({ id: c.id, name: c.name, street: (c.address ?? "").split("\n")[0]?.trim() ?? "" }));
}

export async function createProject(raw: unknown) {
  const { organizationId, user } = await requireEstimatorOrManager();
  await enforcePlanLimit(organizationId, "projects");
  const data = projectInput.parse(raw);
  const clientId = await clientInOrg(organizationId, data.clientId);
  // Numbered per company from 1001 (2026-11-05).
  const p = await numbered(organizationId, (number) =>
    db.project.create({
      data: {
        organizationId,
        clientId,
        number,
        name: data.name,
        description: data.description ?? null,
        status: data.status,
        startsAt: data.startsAt ?? null,
        endsAt: data.endsAt ?? null,
        budget: data.budget,
      },
    }),
  );
  revalidatePath("/dashboard/projects");
  await logActivity({
    organizationId,
    actorId: user.id,
    kind: TRAIL_KINDS.PROJECT,
    summary: `Created project ${p.name}`,
    clientId,
    meta: { projectId: p.id, budget: data.budget },
  });
  return { id: p.id };
}

const updateInput = projectInput.partial().extend({ id: z.string() });

export async function updateProject(raw: unknown) {
  const { organizationId, user } = await requireEstimatorOrManager();
  const data = updateInput.parse(raw);
  const existing = await db.project.findUnique({ where: { id: data.id } });
  if (!existing || existing.organizationId !== organizationId) throw new Error("Not found");
  const { id, ...rest } = data;
  await db.project.update({
    where: { id },
    data: {
      ...(rest.name !== undefined && { name: rest.name }),
      ...(rest.description !== undefined && { description: rest.description }),
      ...(rest.status !== undefined && { status: rest.status }),
      ...(rest.startsAt !== undefined && { startsAt: rest.startsAt }),
      ...(rest.endsAt !== undefined && { endsAt: rest.endsAt }),
      ...(rest.budget !== undefined && { budget: rest.budget }),
      ...(rest.clientId !== undefined && { clientId: await clientInOrg(organizationId, rest.clientId) }),
    },
  });
  revalidatePath("/dashboard/projects");
  revalidatePath(`/dashboard/projects/${id}`);
  const changed = Object.keys(rest).filter((k) => rest[k as keyof typeof rest] !== undefined);
  await logActivity({
    organizationId,
    actorId: user.id,
    kind: TRAIL_KINDS.PROJECT,
    summary:
      rest.status !== undefined && rest.status !== existing.status
        ? `Set project ${rest.name ?? existing.name} to ${rest.status.replace("_", " ").toLowerCase()}`
        : `Updated project ${rest.name ?? existing.name}${changed.length ? ` — ${changed.join(", ")}` : ""}`,
    clientId: rest.clientId !== undefined ? rest.clientId : existing.clientId,
    meta: { projectId: id, changed },
  });
}

export async function archiveProject(id: string) {
  const { organizationId, user } = await requireEstimatorOrManager();
  const p = await db.project.findUnique({ where: { id } });
  if (!p || p.organizationId !== organizationId) throw new Error("Not found");
  await db.project.update({ where: { id }, data: { status: "ARCHIVED" } });
  revalidatePath("/dashboard/projects");
  await logActivity({
    organizationId,
    actorId: user.id,
    kind: TRAIL_KINDS.PROJECT,
    summary: `Archived project ${p.name}`,
    clientId: p.clientId,
    meta: { projectId: id },
  });
}

export async function attachJob(projectId: string, jobId: string) {
  const { organizationId } = await requireEstimatorOrManager();
  const [p, j] = await Promise.all([
    db.project.findUnique({ where: { id: projectId } }),
    db.job.findUnique({ where: { id: jobId } }),
  ]);
  if (!p || p.organizationId !== organizationId) throw new Error("Project not found");
  if (!j || j.organizationId !== organizationId) throw new Error("Job not found");
  await db.job.update({ where: { id: jobId }, data: { projectId } });
  revalidatePath(`/dashboard/projects/${projectId}`);
  revalidatePath(`/dashboard/jobs/${jobId}`);
}

export async function detachJob(jobId: string) {
  const { organizationId } = await requireEstimatorOrManager();
  const j = await db.job.findUnique({ where: { id: jobId } });
  if (!j || j.organizationId !== organizationId) throw new Error("Not found");
  const previousProjectId = j.projectId;
  await db.job.update({ where: { id: jobId }, data: { projectId: null } });
  if (previousProjectId) revalidatePath(`/dashboard/projects/${previousProjectId}`);
  revalidatePath(`/dashboard/jobs/${jobId}`);
}
