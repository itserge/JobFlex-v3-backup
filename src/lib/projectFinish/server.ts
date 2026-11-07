import "server-only";
// THE FINISH LINE — the database half (the timeline build, 2026-11-06). The rules are ./shared.ts.
//
//   · inspections — addInspection / updateInspection / recordInspection (pass, fail, with a note) / deleteInspection.
//   · punch list  — addPunchItems / tickPunch (done, with the "after" photo when one was taken) / deletePunchItem;
//                   punchForJob is what the crew's board lists.
//   · the steps   — finishOf collects the state the seven steps read; signOff, setWarranty, askReview,
//                   finishProject and archiveProject are the steps' writes.

import { db } from "@/lib/db";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { mediaHref } from "@/lib/media/signedLink";
import { projectMoney } from "@/lib/projectMoney";
import { ensureReviewRequestForProposal } from "@/lib/reviews/requestForProposal";
import { createReviewRequestInternal } from "@/lib/reviewRequestInternal";
import { isoDay } from "@/lib/projectTimeline/shared";
import { inspectionKindOf, isInspectionKind } from "@/lib/projectGates";
import type { FinishRead } from "./shared";

const SOLD = ["ACCEPTED", "COMPLETED", "PAID"];
const dayOf = (s: string | null | undefined) => (s ? new Date(`${s.slice(0, 10)}T00:00:00.000Z`) : null);

async function projectOf(organizationId: string, projectId: string) {
  const p = await db.project.findFirst({ where: { id: projectId, organizationId }, select: { id: true, name: true, clientId: true, status: true, endsAt: true, finishedAt: true } });
  if (!p) throw new Error("Project not found");
  return p;
}

// ── inspections ──────────────────────────────────────────────────────────────

/** `kind` (lib/projectGates) is read off the name when not given; `gate` — the stage cannot be marked done until this
 *  passes — defaults to on when the inspection sits on a stage (part 3, 2026-11-07). */
export type InspectionInput = { name: string; date?: string | null; readyNote?: string | null; stageId?: string | null; isFinal?: boolean; kind?: string | null; gate?: boolean | null };

const kindOf = (name: string, given: string | null | undefined) => (given && isInspectionKind(given) ? given : inspectionKindOf(name));

export async function addInspection(organizationId: string, projectId: string, input: InspectionInput, actorId: string | null): Promise<{ id: string }> {
  const p = await projectOf(organizationId, projectId);
  const name = input.name.trim();
  if (!name) throw new Error("Name the inspection");
  if (input.stageId) {
    const st = await db.projectStage.findFirst({ where: { id: input.stageId, projectId }, select: { id: true } });
    if (!st) throw new Error("That stage is not on this project");
  }
  // One final inspection per project: a new one marked final takes the mark from the old.
  if (input.isFinal) await db.projectInspection.updateMany({ where: { projectId, isFinal: true }, data: { isFinal: false } });
  const row = await db.projectInspection.create({
    data: { organizationId, projectId, name, date: dayOf(input.date), readyNote: input.readyNote?.trim() || null, stageId: input.stageId ?? null, isFinal: Boolean(input.isFinal), kind: kindOf(name, input.kind), gate: input.gate ?? Boolean(input.stageId), createdById: actorId },
    select: { id: true },
  });
  await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.PROJECT, summary: `Added ${name}${input.date ? ` on ${input.date}` : ""} to ${p.name}`, clientId: p.clientId, meta: { projectId, inspectionId: row.id } });
  return row;
}

export async function updateInspection(organizationId: string, inspectionId: string, patch: Partial<InspectionInput>, actorId: string | null): Promise<void> {
  const row = await db.projectInspection.findFirst({ where: { id: inspectionId, organizationId }, select: { id: true, projectId: true, name: true, project: { select: { name: true, clientId: true } } } });
  if (!row) throw new Error("Inspection not found");
  if (patch.stageId) {
    const st = await db.projectStage.findFirst({ where: { id: patch.stageId, projectId: row.projectId }, select: { id: true } });
    if (!st) throw new Error("That stage is not on this project");
  }
  if (patch.isFinal) await db.projectInspection.updateMany({ where: { projectId: row.projectId, isFinal: true, id: { not: row.id } }, data: { isFinal: false } });
  await db.projectInspection.update({
    where: { id: row.id },
    data: {
      ...(patch.name !== undefined ? { name: patch.name.trim() || row.name } : {}),
      ...(patch.date !== undefined ? { date: dayOf(patch.date) } : {}),
      ...(patch.readyNote !== undefined ? { readyNote: patch.readyNote?.trim() || null } : {}),
      ...(patch.stageId !== undefined ? { stageId: patch.stageId } : {}),
      ...(patch.isFinal !== undefined ? { isFinal: patch.isFinal } : {}),
      ...(patch.kind !== undefined || patch.name !== undefined ? { kind: kindOf(patch.name?.trim() || row.name, patch.kind) } : {}),
      ...(patch.gate !== undefined && patch.gate !== null ? { gate: patch.gate } : patch.stageId === null ? { gate: false } : {}),
    },
  });
  await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.PROJECT, summary: `Changed ${patch.name?.trim() || row.name} on ${row.project.name}`, clientId: row.project.clientId, meta: { projectId: row.projectId, inspectionId: row.id } });
}

/** The inspector's word: passed, failed (with what they said), or back to pending for a re-inspection. */
export async function recordInspection(organizationId: string, inspectionId: string, result: "PASSED" | "FAILED" | "PENDING", note: string | null, actorId: string | null): Promise<{ projectId: string; name: string; isFinal: boolean; gate: boolean; stageName: string | null }> {
  const row = await db.projectInspection.findFirst({ where: { id: inspectionId, organizationId }, select: { id: true, projectId: true, name: true, isFinal: true, gate: true, stage: { select: { name: true } }, project: { select: { name: true, clientId: true } } } });
  if (!row) throw new Error("Inspection not found");
  await db.projectInspection.update({
    where: { id: row.id },
    data: { result, resultNote: note?.trim() || null, resultAt: result === "PENDING" ? null : new Date(), resultById: result === "PENDING" ? null : actorId },
  });
  await logActivity({
    organizationId,
    actorId,
    kind: TRAIL_KINDS.PROJECT,
    summary: result === "PENDING" ? `Reopened ${row.name} on ${row.project.name}` : `${row.name} ${result === "PASSED" ? "passed" : "failed"} on ${row.project.name}${note?.trim() ? ` — ${note.trim()}` : ""}`,
    clientId: row.project.clientId,
    meta: { projectId: row.projectId, inspectionId: row.id, result },
  });
  return { projectId: row.projectId, name: row.name, isFinal: row.isFinal, gate: row.gate, stageName: row.stage?.name ?? null };
}

export async function deleteInspection(organizationId: string, inspectionId: string): Promise<{ projectId: string }> {
  const row = await db.projectInspection.findFirst({ where: { id: inspectionId, organizationId }, select: { id: true, projectId: true } });
  if (!row) throw new Error("Inspection not found");
  await db.projectInspection.delete({ where: { id: row.id } });
  return { projectId: row.projectId };
}

// ── punch list ───────────────────────────────────────────────────────────────

export type PunchRow = { id: string; note: string; jobId: string | null; jobTitle: string | null; done: boolean; doneAt: string | null; by: string | null; photo: { id: string; href: string } | null };

/** Several at once: one line each ("Touch up the paint by the pantry door"). */
export async function addPunchItems(organizationId: string, projectId: string, notes: string[], jobId: string | null, actorId: string | null): Promise<{ added: number }> {
  const p = await projectOf(organizationId, projectId);
  const clean = notes.map((n) => n.trim()).filter((n) => n.length > 0 && n.length <= 500).slice(0, 60);
  if (!clean.length) throw new Error("Nothing to add");
  if (jobId) {
    const j = await db.job.findFirst({ where: { id: jobId, organizationId, projectId }, select: { id: true } });
    if (!j) throw new Error("That job is not on this project");
  }
  const last = await db.punchItem.findFirst({ where: { projectId }, orderBy: { position: "desc" }, select: { position: true } });
  let position = (last?.position ?? -1) + 1;
  await db.punchItem.createMany({ data: clean.map((note) => ({ organizationId, projectId, jobId, note, position: position++, createdById: actorId })) });
  await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.PROJECT, summary: `Added ${clean.length} punch item${clean.length === 1 ? "" : "s"} to ${p.name}`, clientId: p.clientId, meta: { projectId, count: clean.length } });
  return { added: clean.length };
}

/** Ticked (with the after photo when one was taken), or unticked. The photo must be one of this company's job
 *  photos; it stays on the job's gallery either way. */
export async function tickPunch(organizationId: string, itemId: string, done: boolean, photoId: string | null, actorId: string | null, actorName?: string | null): Promise<{ projectId: string; note: string; openLeft: number }> {
  const item = await db.punchItem.findFirst({ where: { id: itemId, organizationId }, select: { id: true, projectId: true, note: true, project: { select: { name: true, clientId: true } } } });
  if (!item) throw new Error("Punch item not found");
  if (photoId) {
    const photo = await db.jobPhoto.findFirst({ where: { id: photoId, job: { organizationId } }, select: { id: true } });
    if (!photo) throw new Error("That photo is not on one of your jobs");
  }
  await db.punchItem.update({
    where: { id: item.id },
    data: done ? { doneAt: new Date(), doneById: actorId, ...(photoId ? { photoId } : {}) } : { doneAt: null, doneById: null, photoId: null },
  });
  const openLeft = await db.punchItem.count({ where: { projectId: item.projectId, doneAt: null } });
  await logActivity({
    organizationId,
    actorId,
    kind: TRAIL_KINDS.PROJECT,
    summary: done ? `${actorName ? `${actorName} ` : ""}${done ? "finished" : "reopened"} "${item.note}" on ${item.project.name}${photoId ? " — with a photo" : ""}${openLeft === 0 ? " — the punch list is clear" : ""}` : `Reopened "${item.note}" on ${item.project.name}`,
    clientId: item.project.clientId,
    meta: { projectId: item.projectId, punchItemId: item.id, done, photoId: photoId ?? undefined },
  });
  return { projectId: item.projectId, note: item.note, openLeft };
}

export async function deletePunchItem(organizationId: string, itemId: string): Promise<{ projectId: string }> {
  const item = await db.punchItem.findFirst({ where: { id: itemId, organizationId }, select: { id: true, projectId: true } });
  if (!item) throw new Error("Punch item not found");
  await db.punchItem.delete({ where: { id: item.id } });
  return { projectId: item.projectId };
}

export async function punchOf(projectId: string): Promise<PunchRow[]> {
  const rows = (
    await db.punchItem.findMany({
      where: { projectId },
      orderBy: { position: "asc" },
      select: { id: true, note: true, jobId: true, doneAt: true, doneById: true, job: { select: { title: true } }, photo: { select: { id: true, url: true } } },
    })
  ).sort((a, b) => Number(Boolean(a.doneAt)) - Number(Boolean(b.doneAt)));
  const users = rows.length ? await db.user.findMany({ where: { id: { in: rows.map((r) => r.doneById).filter((x): x is string => !!x) } }, select: { id: true, name: true } }) : [];
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  return rows.map((r) => ({
    id: r.id,
    note: r.note,
    jobId: r.jobId,
    jobTitle: r.job?.title ?? null,
    done: Boolean(r.doneAt),
    doneAt: r.doneAt ? r.doneAt.toISOString() : null,
    by: r.doneById ? (nameOf.get(r.doneById) ?? null) : null,
    photo: r.photo ? { id: r.photo.id, href: mediaHref(r.photo.url) ?? r.photo.url } : null,
  }));
}

/** The items the crew on a job sees: the project's open ones for this job or for no job in particular. */
export async function punchForJob(projectId: string, jobId: string): Promise<Array<{ id: string; note: string; done: boolean }>> {
  const rows = await db.punchItem.findMany({ where: { projectId, OR: [{ jobId }, { jobId: null }] }, orderBy: { position: "asc" }, select: { id: true, note: true, doneAt: true } });
  return rows.map((r) => ({ id: r.id, note: r.note, done: Boolean(r.doneAt) }));
}

// ── the steps ────────────────────────────────────────────────────────────────

export type FinishFull = FinishRead & { punchItems: PunchRow[]; clientName: string | null; reviewHref: string | null };

export async function finishOf(organizationId: string, projectId: string): Promise<FinishFull> {
  const p = await db.project.findFirst({
    where: { id: projectId, organizationId },
    select: {
      id: true,
      status: true,
      signedOffAt: true,
      signedOffBy: true,
      warrantyUntil: true,
      finishedAt: true,
      client: { select: { name: true, email: true } },
      stages: { select: { status: true } },
      jobs: { select: { id: true, status: true } },
      proposals: { where: { status: { in: SOLD } }, select: { id: true } },
      inspections: { where: { isFinal: true }, take: 1, select: { id: true, name: true, date: true, result: true, resultAt: true, readyNote: true } },
    },
  });
  if (!p) throw new Error("Project not found");
  const [punchItems, moneyAll, review] = await Promise.all([
    punchOf(p.id),
    projectMoney(organizationId, [p.id]),
    db.reviewRequest.findFirst({
      where: { organizationId, OR: [{ proposalId: { in: p.proposals.map((x) => x.id) } }, { jobId: { in: p.jobs.map((j) => j.id) } }] },
      orderBy: { createdAt: "asc" },
      select: { status: true, sentAt: true, createdAt: true, rating: true, completedAt: true, publicToken: true },
    }),
  ]);
  const m = moneyAll.get(p.id);
  const fi = p.inspections[0] ?? null;
  const read: FinishFull = {
    status: p.status,
    stageCount: p.stages.length,
    stagesDone: p.stages.every((s) => s.status === "DONE"),
    jobsOpen: p.jobs.filter((j) => j.status !== "COMPLETED" && j.status !== "CANCELED").length,
    punch: { open: punchItems.filter((x) => !x.done).length, total: punchItems.length, withPhoto: punchItems.filter((x) => x.photo).length },
    finalInspection: fi ? { id: fi.id, name: fi.name, date: isoDay(fi.date), result: fi.result, resultAt: fi.resultAt ? fi.resultAt.toISOString() : null, readyNote: fi.readyNote } : null,
    signedOffAt: p.signedOffAt ? p.signedOffAt.toISOString() : null,
    signedOffBy: p.signedOffBy,
    payment: { proposals: p.proposals.length, billed: (m?.collected ?? 0) + (m?.owed ?? 0), paid: m?.collected ?? 0, owed: m?.owed ?? 0 },
    review: review ? { askedAt: review.sentAt ? review.sentAt.toISOString() : null, rating: review.rating, completedAt: review.completedAt ? review.completedAt.toISOString() : null, publicToken: review.publicToken } : null,
    clientEmail: p.client?.email?.trim() || null,
    warrantyUntil: p.warrantyUntil ? p.warrantyUntil.toISOString() : null,
    finishedAt: p.finishedAt ? p.finishedAt.toISOString() : null,
    punchItems,
    clientName: p.client?.name ?? null,
    reviewHref: review ? `/review/${review.publicToken}` : null,
  };
  return read;
}

export async function signOff(organizationId: string, projectId: string, by: string | null, actorId: string | null): Promise<void> {
  const p = await projectOf(organizationId, projectId);
  const name = by?.trim() || null;
  await db.project.update({ where: { id: p.id }, data: { signedOffAt: new Date(), signedOffBy: name } });
  await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.PROJECT, summary: `${name ?? "The client"} signed off on ${p.name}`, clientId: p.clientId, meta: { projectId } });
}

export async function clearSignOff(organizationId: string, projectId: string): Promise<void> {
  const p = await projectOf(organizationId, projectId);
  await db.project.update({ where: { id: p.id }, data: { signedOffAt: null, signedOffBy: null } });
}

export async function setWarranty(organizationId: string, projectId: string, until: string | null, actorId: string | null): Promise<void> {
  const p = await projectOf(organizationId, projectId);
  await db.project.update({ where: { id: p.id }, data: { warrantyUntil: dayOf(until) } });
  await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.PROJECT, summary: until ? `Warranty on ${p.name} runs until ${until.slice(0, 10)}` : `Warranty on ${p.name} cleared`, clientId: p.clientId, meta: { projectId, until } });
}

/** The review ask: through the project's sold proposal (the request the proposal's own completion would make),
 *  else through a job with a client. Idempotent — an ask already made is handed back. */
export async function askReview(organizationId: string, projectId: string, actorId: string | null): Promise<{ publicToken: string; emailed: boolean; created: boolean }> {
  const p = await db.project.findFirst({
    where: { id: projectId, organizationId },
    select: { name: true, clientId: true, proposals: { where: { status: { in: SOLD } }, orderBy: { total: "desc" }, take: 1, select: { id: true, jobs: { take: 1, select: { id: true } } } }, jobs: { where: { clientId: { not: null } }, take: 1, orderBy: { createdAt: "asc" }, select: { id: true } } },
  });
  if (!p) throw new Error("Project not found");
  const prop = p.proposals[0];
  if (prop) {
    const r = await ensureReviewRequestForProposal(prop.id, { jobId: prop.jobs[0]?.id ?? null, actorId });
    if (!r) throw new Error("Could not make the review request");
    if (r.created) await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.PROJECT, summary: `Asked for a review on ${p.name}${r.emailed ? "" : " — no client email, send the link by hand"}`, clientId: p.clientId, meta: { projectId } });
    return { publicToken: r.publicToken, emailed: r.emailed, created: r.created };
  }
  const job = p.jobs[0];
  if (!job) throw new Error("No sold proposal and no job with a client on this project — nobody to ask");
  const r = await createReviewRequestInternal(job.id, actorId);
  if (!r) throw new Error("Could not make the review request");
  const row = await db.reviewRequest.findUnique({ where: { id: r.id }, select: { publicToken: true, sentAt: true } });
  return { publicToken: row?.publicToken ?? "", emailed: Boolean(row?.sentAt), created: true };
}

/** The project is over: status COMPLETED, the finish day set, the last day filled in when none was. Open jobs
 *  block it — their close-out is where hours, reviews and invoices flow from. */
export async function finishProject(organizationId: string, projectId: string, actorId: string | null): Promise<{ name: string }> {
  const p = await db.project.findFirst({ where: { id: projectId, organizationId }, select: { id: true, name: true, clientId: true, status: true, endsAt: true, jobs: { where: { status: { notIn: ["COMPLETED", "CANCELED"] } }, select: { title: true } } } });
  if (!p) throw new Error("Project not found");
  if (p.jobs.length) throw new Error(`${p.jobs.length === 1 ? `"${p.jobs[0].title}" is` : `${p.jobs.length} jobs are`} still open — close ${p.jobs.length === 1 ? "it" : "them"} on the job page first`);
  const now = new Date();
  await db.project.update({ where: { id: p.id }, data: { status: "COMPLETED", finishedAt: now, endsAt: p.endsAt ?? new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`) } });
  await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.PROJECT, summary: `Finished project ${p.name}`, clientId: p.clientId, meta: { projectId } });
  return { name: p.name };
}

export async function reopenProject(organizationId: string, projectId: string, actorId: string | null): Promise<void> {
  const p = await projectOf(organizationId, projectId);
  await db.project.update({ where: { id: p.id }, data: { status: "ACTIVE", finishedAt: null } });
  await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.PROJECT, summary: `Reopened project ${p.name}`, clientId: p.clientId, meta: { projectId } });
}

export async function archiveProjectRow(organizationId: string, projectId: string, actorId: string | null): Promise<{ name: string }> {
  const p = await projectOf(organizationId, projectId);
  await db.project.update({ where: { id: p.id }, data: { status: "ARCHIVED", finishedAt: p.finishedAt ?? new Date() } });
  await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.PROJECT, summary: `Archived project ${p.name}`, clientId: p.clientId, meta: { projectId } });
  return { name: p.name };
}
