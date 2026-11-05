"use server";

// PROJECTS ↔ CLIENTS ↔ PROPOSALS (owner, 2026-09-18: "give me the option to
// move the client to the project, and keep all his proposals under the same
// project and under the same client").
//
// A project may name ONE client (Project.clientId) and holds proposals
// directly (Proposal.projectId). What a proposal brings with it follows it:
// its change orders hang off the proposal already, and the job it became is
// moved alongside (Job.projectId) so the project's schedule and contract lines
// stay whole. Moving never touches money, status or the client's copy.
//
// Guard: estimators and managers, the same door every other project write
// uses (actions/projects.ts). Every id that arrives is checked against the
// caller's organization before anything is written.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isSalesRole, requireEstimatorOrManager, requireOrg, requireRouteAccess } from "@/lib/orgContext";
import { db } from "@/lib/db";
import { enforcePlanLimit } from "@/lib/limitsEngine";

/** Proposals a project does not gather: withdrawn ones stay where they are. */
const SETTLED_OUT = ["ARCHIVED"];

export type ClientProjectOptions = {
  client: { id: string; name: string; address: string };
  /** The client's proposals, newest first, with the project each is in now. */
  proposals: Array<{
    id: string;
    title: string;
    status: string;
    total: number;
    projectId: string | null;
    projectName: string | null;
  }>;
  /** Open projects, the ones already for this client first. */
  projects: Array<{
    id: string;
    name: string;
    status: string;
    clientName: string | null;
    forThisClient: boolean;
    proposalCount: number;
  }>;
  /** A name for a new project: the client and the street, when there is one. */
  suggestedName: string;
};

/** A sales rep opens Clients but not Projects (lib/roleRoutes): the sheet says who runs projects instead of failing.
 *  Returned, not thrown — a production build hides a thrown message behind a generic one (2026-11-04). */
export type ClientProjectRefusal = { refused: string };

/** Everything the "Add to project" sheet shows, in one read. */
export async function clientProjectOptions(clientId: string): Promise<ClientProjectOptions | ClientProjectRefusal> {
  if (isSalesRole((await requireOrg()).role)) {
    return { refused: "Projects are run by the owner and managers. Ask one of them to put this client in a project." };
  }
  const { organizationId } = await requireEstimatorOrManager();
  await requireRouteAccess("/dashboard/clients", "/dashboard/client-detail");
  const client = await db.client.findFirst({
    where: { id: clientId, organizationId, deletedAt: null },
    select: { id: true, name: true, address: true, city: true },
  });
  if (!client) throw new Error("Client not found");

  const [proposals, projects] = await Promise.all([
    db.proposal.findMany({
      where: { organizationId, clientId, status: { notIn: SETTLED_OUT } },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true, status: true, total: true, projectId: true, project: { select: { name: true } } },
    }),
    db.project.findMany({
      where: { organizationId, status: { not: "ARCHIVED" } },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        name: true,
        status: true,
        clientId: true,
        client: { select: { name: true } },
        _count: { select: { proposals: true } },
      },
    }),
  ]);

  const street = (client.address ?? "").split("\n")[0]?.trim() ?? "";
  return {
    client: { id: client.id, name: client.name, address: [street, client.city].filter(Boolean).join(", ") },
    proposals: proposals.map((p) => ({
      id: p.id,
      title: p.title,
      status: p.status,
      total: p.total,
      projectId: p.projectId,
      projectName: p.project?.name ?? null,
    })),
    projects: projects
      .map((p) => ({
        id: p.id,
        name: p.name,
        status: p.status,
        clientName: p.client?.name ?? null,
        forThisClient: p.clientId === client.id,
        proposalCount: p._count.proposals,
      }))
      .sort((a, b) => Number(b.forThisClient) - Number(a.forThisClient)),
    suggestedName: street ? `${client.name} — ${street}` : client.name,
  };
}

const addInput = z
  .object({
    clientId: z.string().min(1),
    projectId: z.string().min(1).optional(),
    newProject: z.object({ name: z.string().trim().min(1).max(160) }).optional(),
    proposalIds: z.array(z.string().min(1)).max(200).default([]),
  })
  .refine((d) => Boolean(d.projectId) !== Boolean(d.newProject), "Pick a project or name a new one.");

/**
 * Put a client in a project: an existing one, or a new one made here. The
 * picked proposals move in (with their jobs); the project takes the client
 * when it has none yet. Returns the project so the caller can open it.
 */
export async function addClientToProject(raw: unknown): Promise<{ projectId: string; projectName: string; moved: number }> {
  const { organizationId, user } = await requireEstimatorOrManager();
  const data = addInput.parse(raw);

  const client = await db.client.findFirst({
    where: { id: data.clientId, organizationId, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!client) throw new Error("Client not found");

  // Only this client's own proposals, in this org, may be moved by this call.
  const proposals = data.proposalIds.length
    ? await db.proposal.findMany({
        where: { id: { in: data.proposalIds }, organizationId, clientId: client.id },
        select: { id: true, projectId: true },
      })
    : [];
  if (proposals.length !== new Set(data.proposalIds).size) throw new Error("A proposal on the list is not this client's.");

  let project: { id: string; name: string; clientId: string | null };
  if (data.newProject) {
    await enforcePlanLimit(organizationId, "projects");
    project = await db.project.create({
      data: { organizationId, name: data.newProject.name, clientId: client.id, status: "ACTIVE" },
      select: { id: true, name: true, clientId: true },
    });
  } else {
    const found = await db.project.findFirst({
      where: { id: data.projectId, organizationId },
      select: { id: true, name: true, clientId: true },
    });
    if (!found) throw new Error("Project not found");
    project = found;
    if (!found.clientId) await db.project.update({ where: { id: found.id }, data: { clientId: client.id } });
  }

  const ids = proposals.map((p) => p.id);
  const previous = new Set(proposals.map((p) => p.projectId).filter((v): v is string => !!v && v !== project.id));
  if (ids.length) {
    await db.proposal.updateMany({ where: { id: { in: ids }, organizationId }, data: { projectId: project.id } });
    await db.job.updateMany({ where: { proposalId: { in: ids }, organizationId }, data: { projectId: project.id } });
  }

  await db.activityEvent.create({
    data: {
      organizationId,
      actorId: user.id,
      clientId: client.id,
      kind: "UPDATED",
      summary: `Added ${client.name} to project "${project.name}"${ids.length ? ` with ${ids.length} proposal${ids.length === 1 ? "" : "s"}` : ""}`,
    },
  });

  revalidatePath("/dashboard/projects");
  revalidatePath(`/dashboard/projects/${project.id}`);
  for (const id of previous) revalidatePath(`/dashboard/projects/${id}`);
  revalidatePath("/dashboard/proposals");
  revalidatePath("/dashboard/clients");
  revalidatePath("/dashboard/client-detail");
  return { projectId: project.id, projectName: project.name, moved: ids.length };
}

const moveInput = z.object({
  proposalId: z.string().min(1),
  projectId: z.string().min(1).nullable(),
});

/** Move one proposal (and its job) into a project, or take it out (null). */
export async function setProposalProject(raw: unknown): Promise<{ projectId: string | null }> {
  const { organizationId } = await requireEstimatorOrManager();
  const data = moveInput.parse(raw);
  const proposal = await db.proposal.findFirst({
    where: { id: data.proposalId, organizationId },
    select: { id: true, projectId: true, clientId: true },
  });
  if (!proposal) throw new Error("Proposal not found");
  if (data.projectId) {
    const project = await db.project.findFirst({ where: { id: data.projectId, organizationId }, select: { id: true, clientId: true } });
    if (!project) throw new Error("Project not found");
    // The first proposal filed with a client names the project's client.
    if (!project.clientId && proposal.clientId) {
      await db.project.update({ where: { id: project.id }, data: { clientId: proposal.clientId } });
    }
  }
  await db.proposal.update({ where: { id: proposal.id }, data: { projectId: data.projectId } });
  await db.job.updateMany({ where: { proposalId: proposal.id, organizationId }, data: { projectId: data.projectId } });

  revalidatePath("/dashboard/projects");
  if (data.projectId) revalidatePath(`/dashboard/projects/${data.projectId}`);
  if (proposal.projectId && proposal.projectId !== data.projectId) revalidatePath(`/dashboard/projects/${proposal.projectId}`);
  revalidatePath("/dashboard/proposals");
  return { projectId: data.projectId };
}
