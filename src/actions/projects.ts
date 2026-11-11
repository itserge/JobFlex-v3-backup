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
import { createProjectAs, requireProjectKind } from "@/lib/projectCore";
import { PROJECT_KINDS, parseAnswers, serializeAnswers, kindOf, kindsSwap } from "@/lib/projectKind";

/** A new build's start questions (part 4, lib/projectPhases), each optional — the defaults are the common lot. (Not
 *  exported: a "use server" file may export only async functions.) */
const buildAnswersInput = z.object({
  sewer: z.enum(["SEWER", "SEPTIC"]).optional(),
  water: z.enum(["WATER", "WELL"]).optional(),
  foundation: z.enum(["SLAB", "CRAWL", "BASEMENT"]).optional(),
  stories: z.union([z.literal(1), z.literal(2)]).optional(),
  garage: z.boolean().optional(),
  shop: z.boolean().optional(),
  lender: z.boolean().optional(),
  power: z.enum(["AT_LOT", "POLE"]).optional(),
  gas: z.boolean().optional(),
  fiber: z.boolean().optional(),
});

const projectInput = z.object({
  name: z.string().min(1),
  // Remodel or New construction (2026-11-07, lib/projectKind); `occupied`: a remodel's client lives there during the work.
  kind: z.enum(PROJECT_KINDS).default("REMODEL"),
  occupied: z.boolean().optional(),
  // A new build's start questions (part 4): the phases are shaped from them.
  build: buildAnswersInput.optional(),
  // Who it is for and how the money is made (part 5, lib/projectMoneyPlan).
  forWhom: z.enum(["CLIENT", "SELF"]).optional(),
  moneyMode: z.enum(["PROJECT_MARGIN", "JOB_MARGIN", "COST_PLUS", "NONE"]).optional(),
  marginPct: z.number().min(0).max(100).nullable().optional(),
  feeAmount: z.number().min(0).max(100_000_000).nullable().optional(),
  salePrice: z.number().min(0).max(100_000_000).nullable().optional(),
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
  await enforcePlanLimit(organizationId, "projects", 1, { actorId: user.id });
  const data = projectInput.parse(raw);
  // A remodel needs Remodeler and a new build Home Builder on the new plans (lib/projectCore).
  await requireProjectKind(organizationId, data.kind);
  const clientId = await clientInOrg(organizationId, data.clientId);
  const p = await createProjectAs({ organizationId, actorId: user.id }, { ...data, clientId });
  revalidatePath("/dashboard/projects");
  return { id: p.id };
}

const updateInput = projectInput.partial().extend({ id: z.string() });

export async function updateProject(raw: unknown) {
  const { organizationId, user } = await requireEstimatorOrManager();
  const data = updateInput.parse(raw);
  const existing = await db.project.findUnique({ where: { id: data.id } });
  if (!existing || existing.organizationId !== organizationId) throw new Error("Not found");
  const { id, ...rest } = data;
  // The kind can change until a stage is done: the templates, and soon the gates and the money, hang on it.
  // A remodel and a job project trade places at any time (2026-11-09): they work alike and differ only in workspace.
  // Moving a project into a workspace the plan doesn't hold is refused on the new plans (lib/projectCore).
  if (rest.kind !== undefined && rest.kind !== existing.kind) await requireProjectKind(organizationId, rest.kind);
  if (rest.kind !== undefined && rest.kind !== existing.kind && !kindsSwap(kindOf(existing.kind), rest.kind)) {
    const done = await db.projectStage.count({ where: { projectId: id, status: "DONE" } });
    if (done) throw new Error("The kind can't change once a stage is done.");
  }
  const answers = rest.occupied !== undefined ? serializeAnswers({ ...parseAnswers(existing.answersJson), occupied: rest.occupied }) : undefined;
  await db.project.update({
    where: { id },
    data: {
      ...(rest.kind !== undefined && { kind: rest.kind }),
      ...(answers !== undefined && { answersJson: answers }),
      ...(rest.name !== undefined && { name: rest.name }),
      ...(rest.description !== undefined && { description: rest.description }),
      ...(rest.status !== undefined && { status: rest.status }),
      ...(rest.startsAt !== undefined && { startsAt: rest.startsAt }),
      ...(rest.endsAt !== undefined && { endsAt: rest.endsAt }),
      ...(rest.budget !== undefined && { budget: rest.budget }),
      ...(rest.clientId !== undefined && { clientId: await clientInOrg(organizationId, rest.clientId) }),
      // The money settings (part 5): one's own build never has a mode.
      ...(rest.forWhom !== undefined && { forWhom: rest.forWhom, ...(rest.forWhom === "SELF" ? { moneyMode: "NONE" } : {}) }),
      ...(rest.moneyMode !== undefined && (rest.forWhom ?? existing.forWhom) !== "SELF" && { moneyMode: rest.moneyMode }),
      ...(rest.marginPct !== undefined && { marginPct: rest.marginPct }),
      ...(rest.feeAmount !== undefined && { feeAmount: rest.feeAmount }),
      ...(rest.salePrice !== undefined && { salePrice: rest.salePrice }),
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
