"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireManager, requireJobEventCreator, requireOrg, isWorkerRole } from "@/lib/orgContext";
import { db } from "@/lib/db";
import { JobStatus } from "@/lib/prismaEnums";
import { enforcePlanLimit } from "@/lib/limitsEngine";
import { assertLinksInOrg } from "@/lib/assertLinksInOrg";
import { afterResponse } from "@/lib/server-events";
import { textJobScheduled } from "@/lib/sms/schedule";
import { crewOfJobEvent, textAssignmentCreated, textCrewCancelled, textJobEventMoved } from "@/lib/sms/crew";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { recordJobProgress } from "@/lib/jobProgress";

const when = (d: Date) =>
  d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const jobInput = z.object({
  title: z.string().min(1),
  clientId: z.string().optional().nullable(),
  proposalId: z.string().optional().nullable(),
  status: z.enum(["SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELED"]).optional(),
  notes: z.string().optional().nullable(),
  scopeOfWork: z.string().optional().nullable(),
  startsAt: z.union([z.string(), z.date()]).optional().nullable(),
  endsAt: z.union([z.string(), z.date()]).optional().nullable(),
  workerIds: z.array(z.string()).optional().nullable(),
});

function toDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null;
  return v instanceof Date ? v : new Date(v);
}

export async function createJob(raw: unknown) {
  // Installers may create jobs too (manager + installer role); the guard blocks
  // sales/estimator. An installer-created job is auto-assigned to them and can't
  // staff anyone else.
  const { organizationId, user, role } = await requireJobEventCreator();
  await enforcePlanLimit(organizationId, "jobs");
  const data = jobInput.parse(raw);
  const starts = toDate(data.startsAt);
  const ends = toDate(data.endsAt);
  // A dated job auto-creates its calendar event below — that seat must exist too.
  if (starts) await enforcePlanLimit(organizationId, "calendarEvents");

  // Effective crew: installers are forced to self (any passed ids ignored);
  // managers use whatever was picked. An installer with no WorkerProfile can't
  // be assigned, which would leave the new job invisible to them — refuse
  // up front rather than create an orphan.
  const installer = isWorkerRole(role);
  let effectiveWorkerIds = data.workerIds ?? [];
  if (installer) {
    const self = await db.workerProfile.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    if (!self) {
      throw new Error(
        "Your account isn't set up as a worker yet — ask a manager to add you to the team roster.",
      );
    }
    effectiveWorkerIds = [self.id];
  }

  // The linked client/proposal must be this org's — see lib/assertLinksInOrg.
  await assertLinksInOrg(organizationId, {
    clientId: data.clientId,
    proposalId: data.proposalId,
  });

  // A proposal in a project makes its job there (2026-11-04: this path left it out, so the job's crew pay and receipts
  // never reached the project's money).
  const projectId = data.proposalId
    ? ((await db.proposal.findUnique({ where: { id: data.proposalId }, select: { projectId: true } }))?.projectId ?? null)
    : null;

  const job = await db.job.create({
    data: {
      organizationId,
      title: data.title,
      clientId: data.clientId ?? null,
      proposalId: data.proposalId ?? null,
      projectId,
      status: data.status ?? JobStatus.SCHEDULED,
      scopeOfWork: data.scopeOfWork ?? null,
      notes: data.notes ?? null,
      startsAt: starts,
      endsAt: ends,
    },
  });

  if (starts) {
    await db.jobEvent.create({
      data: {
        organizationId,
        jobId: job.id,
        createdById: user.id,
        title: job.title,
        startsAt: starts,
        endsAt: ends ?? new Date(starts.getTime() + 1000 * 60 * 60 * 4),
        notes: data.notes ?? null,
      },
    });
    await db.activityEvent.create({
      data: {
        organizationId,
        actorId: user.id,
        proposalId: job.proposalId ?? null,
        clientId: job.clientId ?? null,
        kind: "SCHEDULED",
        summary: `Scheduled "${job.title}" — starts ${starts.toLocaleDateString()}`,
      },
    });
    afterResponse(() => textJobScheduled(job.id, starts, ends ?? null, user.id));
  }

  // Crew picked at creation. Only workers that belong to this org are attached
  // (guards a tampered payload); ids are de-duped before insert.
  //
  // The created rows are read back and returned: a caller that keeps the new
  // job in local state (the blueprint jobs board) manages crew through
  // `unassignAssignment`, which takes an ASSIGNMENT id — without this the one
  // job created in a session is the only row whose crew can be added to but
  // never removed. Additive: `{ id }` is unchanged for every existing caller.
  let assignments: { id: string; workerId: string }[] = [];
  if (effectiveWorkerIds.length) {
    const ids = Array.from(new Set(effectiveWorkerIds));
    const valid = await db.workerProfile.findMany({
      where: { organizationId, id: { in: ids } },
      select: { id: true, userId: true },
    });
    if (valid.length) {
      // Manager-invited crew starts PENDING (they accept via the worker portal);
      // an installer's own job needs no self-invite — it's ACCEPTED outright,
      // so it doesn't ping their own Jobs badge.
      await db.jobAssignment.createMany({
        data: valid.map((w) => ({
          jobId: job.id,
          workerId: w.id,
          ...(installer ? { status: "ACCEPTED" } : {}),
        })),
      });
      assignments = await db.jobAssignment.findMany({
        where: { jobId: job.id },
        select: { id: true, workerId: true },
      });
      // Auto-create the job's group chat with the invited crew + the manager who
      // built it, so it shows up on the Messages page ready to use. Skipped when
      // the creator would be the only member (installer self-created job) — a
      // solo thread is just noise.
      const chatUserIds = Array.from(new Set([user.id, ...valid.map((w) => w.userId)]));
      if (chatUserIds.length > 1) {
        const { ensureJobConversation } = await import("@/lib/jobConversation");
        await ensureJobConversation({
          jobId: job.id,
          organizationId,
          title: job.title,
          userIds: chatUserIds,
        });
      }
    }
  }

  revalidatePath("/dashboard/jobs");
  revalidatePath("/dashboard/calendar");
  return { id: job.id, assignments };
}

/**
 * Delete a job outright — the row menu's one irreversible item on
 * /dashboard/jobs, behind its own confirm dialog.
 *
 * Cancelling (`updateJob({ status: "CANCELED" })`) is the non-destructive
 * option and is what the menu offers first; this is for the mistyped record
 * that should never have existed. Manager-only, org-scoped, and the dependent
 * rows go with it: assignments, photos, expenses, messages, the group
 * conversation, change orders and review requests all cascade in the schema.
 * `JobEvent.jobId` is optional and NULLs out instead, so a calendar entry the
 * crew is standing in front of is not silently erased — it is unlinked.
 */
export async function deleteJob(id: string) {
  const { organizationId, user } = await requireManager();
  const job = await db.job.findUnique({
    where: { id },
    select: { id: true, organizationId: true, title: true, proposalId: true, clientId: true },
  });
  if (!job || job.organizationId !== organizationId) throw new Error("Not found");

  await db.job.delete({ where: { id } });

  revalidatePath("/dashboard/jobs");
  revalidatePath("/dashboard/calendar");
  await logActivity({
    organizationId,
    actorId: user.id,
    kind: TRAIL_KINDS.JOB,
    summary: `Deleted job ${job.title}`,
    proposalId: job.proposalId,
    clientId: job.clientId,
    meta: { jobId: id, deleted: true },
  });
}

export async function updateJob(id: string, raw: Partial<z.infer<typeof jobInput>>) {
  const { organizationId, user } = await requireManager();
  const existing = await db.job.findUnique({ where: { id } });
  if (!existing || existing.organizationId !== organizationId) throw new Error("Not found");

  // The office moving the status to IN_PROGRESS or COMPLETED goes through the
  // crew's own rule (stage A, 2026-09-30): the day on site counts, the
  // STARTED / COMPLETED row is written — and nobody is texted (silent).
  const wantsProgress: "started" | "completed" | null =
    raw.status === "IN_PROGRESS" && existing.status !== "IN_PROGRESS" ? "started" : raw.status === "COMPLETED" && existing.status !== "COMPLETED" ? "completed" : null;
  let progressed = false;
  if (wantsProgress) {
    const r = await recordJobProgress({ organizationId, jobId: id, actor: { userId: user.id, name: await actorName(user.id) }, what: wantsProgress, via: "dashboard", source: "office", silent: true });
    progressed = r.ok;
  }

  await db.job.update({
    where: { id },
    data: {
      title: raw.title ?? undefined,
      status: progressed ? undefined : raw.status ?? undefined,
      notes: raw.notes === null ? null : raw.notes ?? undefined,
      startsAt:
        raw.startsAt === null ? null : raw.startsAt ? toDate(raw.startsAt) ?? undefined : undefined,
      endsAt:
        raw.endsAt === null ? null : raw.endsAt ? toDate(raw.endsAt) ?? undefined : undefined,
    },
  });

  // Auto-create review request when the job transitions to COMPLETED — the
  // crew's rule already did all of this when it took the move above.
  if (raw.status === "COMPLETED" && existing.status !== "COMPLETED" && !progressed) {
    // The proposal follows its job across the finish line: an ACCEPTED
    // proposal whose work is done now reads COMPLETED everywhere (proposals
    // list, calendar link picker) instead of sitting on "Accepted" forever.
    // Only ACCEPTED is promoted — PAID is further along (money landed) and a
    // draft/declined proposal was never this job's mandate.
    if (existing.proposalId) {
      await db.proposal.updateMany({
        where: { id: existing.proposalId, organizationId, status: "ACCEPTED" },
        data: { status: "COMPLETED" },
      });
      revalidatePath("/dashboard/proposals");
    }
    // The client's review link — through the proposal when there is one (one
    // request per proposal, whichever door finished it), else per job.
    try {
      const { createReviewRequestInternal } = await import("@/lib/reviewRequestInternal");
      await createReviewRequestInternal(id, user.id);
    } catch (err) {
      console.warn("[updateJob] review request failed:", err);
    }
    await db.activityEvent.create({
      data: {
        organizationId,
        actorId: user.id,
        proposalId: existing.proposalId ?? null,
        clientId: existing.clientId ?? null,
        kind: "COMPLETED",
        summary: `Completed "${existing.title}"`,
        meta: JSON.stringify({ jobId: id }),
      },
    });
  } else {
    // Every other change leaves its own line in the trail: a rename, a new
    // status, a moved date, edited notes.
    const changes: string[] = [];
    if (raw.title !== undefined && raw.title !== existing.title) changes.push(`renamed to ${raw.title}`);
    if (raw.status !== undefined && raw.status !== existing.status && !progressed)
      changes.push(`status ${raw.status.replace("_", " ").toLowerCase()}`);
    const newStart = raw.startsAt === undefined ? undefined : toDate(raw.startsAt);
    if (newStart !== undefined && (newStart?.getTime() ?? null) !== (existing.startsAt?.getTime() ?? null))
      changes.push(newStart ? `starts ${when(newStart)}` : "start date cleared");
    const newEnd = raw.endsAt === undefined ? undefined : toDate(raw.endsAt);
    if (newEnd !== undefined && (newEnd?.getTime() ?? null) !== (existing.endsAt?.getTime() ?? null))
      changes.push(newEnd ? `ends ${when(newEnd)}` : "end date cleared");
    if (raw.notes !== undefined && (raw.notes ?? null) !== (existing.notes ?? null)) changes.push("notes");
    if (changes.length) {
      await logActivity({
        organizationId,
        actorId: user.id,
        kind: TRAIL_KINDS.JOB,
        summary: `Updated ${existing.title} — ${changes.join(", ")}`,
        proposalId: existing.proposalId,
        clientId: existing.clientId,
        meta: { jobId: id, changes, status: raw.status ?? undefined },
      });
    }
  }

  revalidatePath("/dashboard/jobs");
  revalidatePath(`/dashboard/jobs/${id}`);
  revalidatePath("/dashboard/calendar");
  revalidatePath("/dashboard/reviews");
}

// Crew-side job progress (2026-08-21, owner request): a worker moves the work
// forward — start it, finish it — from the job page they already stand on.
// Mirrors the token portal's /api/worker/job/[jobId]/status rules on the
// SESSION instead of the magic link: forward-only (no reschedule, no cancel),
// and only on a job they hold a live assignment for. Managers may call it too
// (it is just a narrower updateJob), so the shared UI needs one action.
export async function setJobProgress(id: string, status: "IN_PROGRESS" | "COMPLETED") {
  if (status !== "IN_PROGRESS" && status !== "COMPLETED") throw new Error("Invalid status");
  const { organizationId, user, role } = await requireOrg();
  const existing = await db.job.findUnique({ where: { id }, select: { organizationId: true } });
  if (!existing || existing.organizationId !== organizationId) throw new Error("Not found");
  if (isWorkerRole(role)) {
    const assigned = await db.jobAssignment.findFirst({
      where: { jobId: id, worker: { userId: user.id }, status: { not: "DECLINED" } },
      select: { id: true },
    });
    if (!assigned) throw new Error("You can only update jobs assigned to you");
  }
  // One rule for both doors (lib/jobProgress, 2026-09-27): the status, the
  // day count, the trail row, the proposal promotion, the review request and
  // the text to the owner and the manager.
  const r = await recordJobProgress({
    organizationId,
    jobId: id,
    actor: { userId: user.id, name: await actorName(user.id) },
    what: status === "COMPLETED" ? "completed" : "started",
    via: "dashboard",
    source: isWorkerRole(role) ? "worker" : "office",
  });
  if (!r.ok) throw new Error(r.error);
  revalidatePath(`/dashboard/jobs/${id}`);
  revalidatePath("/dashboard/jobs");
  return { ok: true as const, day: r.day, what: r.what };
}

/**
 * "Close the day" (stage A, 2026-09-30): the crew closes today's day on site
 * — or a past day that stayed open (PENDING), by its date — with a note or
 * at least one photo / video of the day. One day per job: any crew member
 * on it closes it for all; the office may too. Crew-gated like the rest.
 */
export async function closeJobDay(id: string, input: { note?: string | null; date?: string | null } = {}) {
  const { organizationId, user, role } = await requireOrg();
  const existing = await db.job.findUnique({ where: { id }, select: { organizationId: true } });
  if (!existing || existing.organizationId !== organizationId) throw new Error("Not found");
  if (isWorkerRole(role)) {
    const assigned = await db.jobAssignment.findFirst({
      where: { jobId: id, worker: { userId: user.id }, status: { not: "DECLINED" } },
      select: { id: true },
    });
    if (!assigned) throw new Error("You can only update jobs assigned to you");
  }
  const r = await recordJobProgress({ organizationId, jobId: id, actor: { userId: user.id, name: await actorName(user.id) }, what: "closed", via: "dashboard", source: isWorkerRole(role) ? "worker" : "office", note: input.note ?? null, date: input.date ?? null });
  if (!r.ok) throw new Error(r.error);
  revalidatePath(`/dashboard/jobs/${id}`);
  return { ok: true as const, day: r.day, workDayId: r.workDayId ?? null };
}

/**
 * "Back on site" (2026-09-27): a crew member on a job that runs more than a
 * day marks the new day. Crew-gated like setJobProgress; the office may
 * press it too. Refused when today is already on the clock.
 */
export async function continueJobDay(id: string) {
  const { organizationId, user, role } = await requireOrg();
  const existing = await db.job.findUnique({ where: { id }, select: { organizationId: true } });
  if (!existing || existing.organizationId !== organizationId) throw new Error("Not found");
  if (isWorkerRole(role)) {
    const assigned = await db.jobAssignment.findFirst({
      where: { jobId: id, worker: { userId: user.id }, status: { not: "DECLINED" } },
      select: { id: true },
    });
    if (!assigned) throw new Error("You can only update jobs assigned to you");
  }
  const r = await recordJobProgress({ organizationId, jobId: id, actor: { userId: user.id, name: await actorName(user.id) }, what: "continued", via: "dashboard", source: isWorkerRole(role) ? "worker" : "office" });
  if (!r.ok) throw new Error(r.error);
  revalidatePath(`/dashboard/jobs/${id}`);
  return { ok: true as const, day: r.day };
}

/** The name the trail and the text call this member by: the crew profile's, else the account's. */
async function actorName(userId: string): Promise<string> {
  const [wp, u] = await Promise.all([
    db.workerProfile.findUnique({ where: { userId }, select: { displayName: true } }),
    db.user.findUnique({ where: { id: userId }, select: { name: true, email: true } }),
  ]);
  return wp?.displayName?.trim() || u?.name?.trim() || u?.email || "A member";
}

export async function createJobFromProposal(proposalId: string) {
  const { organizationId, user } = await requireManager();
  const proposal = await db.proposal.findUnique({ where: { id: proposalId } });
  if (!proposal || proposal.organizationId !== organizationId) throw new Error("Not found");

  // Avoid duplicate jobs for the same proposal
  const existing = await db.job.findFirst({
    where: { organizationId, proposalId: proposal.id },
  });
  if (existing) return { id: existing.id, created: false as const };

  // Creates a Job AND its auto-scheduled JobEvent — both quotas must clear.
  await enforcePlanLimit(organizationId, "jobs");
  await enforcePlanLimit(organizationId, "calendarEvents");

  const startsAt = new Date();
  startsAt.setDate(startsAt.getDate() + 7);
  startsAt.setHours(9, 0, 0, 0);
  const endsAt = new Date(startsAt);
  endsAt.setHours(14, 0, 0, 0);

  const job = await db.job.create({
    data: {
      organizationId,
      title: proposal.title,
      clientId: proposal.clientId,
      proposalId: proposal.id,
      // A proposal in a project makes its job there.
      projectId: proposal.projectId ?? null,
      status: JobStatus.SCHEDULED,
      scopeOfWork: proposal.scopeOfWork ?? null,
      startsAt,
      endsAt,
    },
  });

  await db.jobEvent.create({
    data: {
      organizationId,
      jobId: job.id,
      title: proposal.title,
      startsAt,
      endsAt,
      notes: "Auto-scheduled from accepted proposal — reschedule as needed.",
    },
  });

  await db.activityEvent.create({
    data: {
      organizationId,
      actorId: user.id,
      proposalId: proposal.id,
      clientId: proposal.clientId,
      kind: "SCHEDULED",
      summary: `Scheduled "${proposal.title}" — starts ${startsAt.toLocaleDateString()}`,
    },
  });
  afterResponse(() => textJobScheduled(job.id, startsAt, endsAt, user.id));

  revalidatePath("/dashboard/jobs");
  revalidatePath("/dashboard/calendar");
  return { id: job.id, created: true as const };
}

// (moved) createJobFromProposalInternal now lives in src/lib/jobFromProposal.ts
// — a plain server module, not a "use server" export — so it's no longer a
// POST-invokable action, and it derives the org from the proposal rather than a
// caller parameter.

// ── JobEvent (calendar-level) ────────────────────

const eventInput = z.object({
  title: z.string().min(1),
  jobId: z.string().optional().nullable(),
  // Scheduling a proposal with no job yet: the action gets-or-creates the Job
  // for it (so it appears in Jobs and under the proposal's client), then hangs
  // the event off that job. Mutually exclusive with jobId.
  proposalId: z.string().optional().nullable(),
  startsAt: z.union([z.string(), z.date()]),
  endsAt: z.union([z.string(), z.date()]),
  notes: z.string().optional().nullable(),
});

export async function createJobEvent(raw: unknown) {
  const { organizationId, role, user } = await requireJobEventCreator();
  await enforcePlanLimit(organizationId, "calendarEvents");
  const data = eventInput.parse(raw);
  const startsAt = toDate(data.startsAt)!;
  const endsAt = toDate(data.endsAt)!;

  // Installers: the job is now OPTIONAL (a jobless event is allowed — it renders
  // on their calendar via createdById below). If they DO link a job it must be
  // one they're assigned to. Proposal-to-job creation stays manager-only.
  const installer = isWorkerRole(role);
  if (installer && data.jobId) {
    const assigned = await db.jobAssignment.findFirst({
      where: { jobId: data.jobId, worker: { userId: user.id } },
      select: { id: true },
    });
    if (!assigned) throw new Error("You can only add events to jobs assigned to you");
  }

  let jobId = data.jobId ?? null;
  if (jobId) {
    const job = await db.job.findUnique({ where: { id: jobId } });
    if (!job || job.organizationId !== organizationId) throw new Error("Job not found");
  } else if (!installer && data.proposalId) {
    const proposal = await db.proposal.findUnique({ where: { id: data.proposalId } });
    if (!proposal || proposal.organizationId !== organizationId)
      throw new Error("Proposal not found");
    const existing = await db.job.findFirst({
      where: { organizationId, proposalId: proposal.id },
    });
    if (existing) {
      jobId = existing.id;
    } else {
      // This branch creates a NEW Job (not just the event) — check its quota too.
      await enforcePlanLimit(organizationId, "jobs");
      // Unlike createJobFromProposal (7-days-out default), the job schedule
      // mirrors the event the user is creating right now.
      const job = await db.job.create({
        data: {
          organizationId,
          title: proposal.title,
          clientId: proposal.clientId,
          proposalId: proposal.id,
          // A proposal in a project makes its job there.
          projectId: proposal.projectId ?? null,
          status: JobStatus.SCHEDULED,
          scopeOfWork: proposal.scopeOfWork ?? null,
          startsAt,
          endsAt,
        },
      });
      jobId = job.id;
    }
  }

  // IDEMPOTENCY GUARD (2026-08-21). A double-fired submit (double-tap on the
  // handheld sheet, a retried network call) minted two byte-identical rows
  // milliseconds apart, and the job detail's Schedule tab then showed one
  // booking twice. An event with the same title and exact same span (and the
  // same job link) IS the same booking — return the existing row instead of
  // minting a twin. Deliberately exact-match: two different crews genuinely
  // working the same job at the same hour still differ by title.
  const dup = await db.jobEvent.findFirst({
    where: { organizationId, jobId, title: data.title, startsAt, endsAt },
    select: { id: true },
  });
  if (dup) return { id: dup.id, jobId };

  const ev = await db.jobEvent.create({
    data: {
      organizationId,
      createdById: user.id,
      title: data.title,
      jobId,
      startsAt,
      endsAt,
      notes: data.notes ?? null,
    },
  });
  revalidatePath("/dashboard/calendar");
  revalidatePath("/dashboard/jobs");
  if (jobId) revalidatePath(`/dashboard/jobs/${jobId}`);
  await logActivity({
    organizationId,
    actorId: user.id,
    kind: TRAIL_KINDS.JOB,
    summary: `Put ${data.title} on the calendar for ${when(startsAt)}`,
    proposalId: data.proposalId ?? null,
    meta: { jobId: jobId ?? undefined, jobEventId: ev.id, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() },
  });
  return { id: ev.id, jobId };
}

export async function rescheduleJobEvent(id: string, newStartISO: string) {
  const { organizationId, user } = await requireManager();
  const ev = await db.jobEvent.findUnique({ where: { id } });
  if (!ev || ev.organizationId !== organizationId) throw new Error("Not found");
  // Product rule: at the calendar cap, drag/drop moves are blocked too, even
  // though a move creates no new row.
  await enforcePlanLimit(organizationId, "calendarEvents");
  const newStart = new Date(newStartISO);
  // preserve event duration
  const duration = ev.endsAt.getTime() - ev.startsAt.getTime();
  // preserve time-of-day when dropping to a different date
  newStart.setHours(ev.startsAt.getHours(), ev.startsAt.getMinutes(), 0, 0);
  const newEnd = new Date(newStart.getTime() + duration);
  await db.jobEvent.update({
    where: { id },
    data: { startsAt: newStart, endsAt: newEnd },
  });
  // The crew hears about the move by text (2026-09-24), after the response.
  afterResponse(() => textJobEventMoved(id));
  revalidatePath("/dashboard/calendar");
  if (ev.jobId) revalidatePath(`/dashboard/jobs/${ev.jobId}`);
  await logActivity({
    organizationId,
    actorId: user.id,
    kind: TRAIL_KINDS.JOB,
    summary: `Moved ${ev.title} from ${when(ev.startsAt)} to ${when(newStart)}`,
    meta: { jobId: ev.jobId ?? undefined, jobEventId: id, from: ev.startsAt.toISOString(), to: newStart.toISOString() },
  });
}

export async function deleteJobEvent(id: string) {
  const { organizationId, user } = await requireManager();
  const ev = await db.jobEvent.findUnique({ where: { id } });
  if (!ev || ev.organizationId !== organizationId) throw new Error("Not found");
  const crew = await crewOfJobEvent(id).catch(() => null);
  await db.jobEvent.delete({ where: { id } });
  afterResponse(() => textCrewCancelled(crew));
  revalidatePath("/dashboard/calendar");
  if (ev.jobId) revalidatePath(`/dashboard/jobs/${ev.jobId}`);
  await logActivity({
    organizationId,
    actorId: user.id,
    kind: TRAIL_KINDS.JOB,
    summary: `Took ${ev.title} (${when(ev.startsAt)}) off the calendar`,
    meta: { jobId: ev.jobId ?? undefined, jobEventId: id, startsAt: ev.startsAt.toISOString(), deleted: true },
  });
}

// Edit a job event's own fields (title / notes) from the calendar detail sheet.
// Time, worker assignment, and job status are handled by their own actions.
export async function updateJobEvent(
  id: string,
  data: { title?: string; notes?: string | null },
) {
  const { organizationId, user } = await requireManager();
  const ev = await db.jobEvent.findUnique({ where: { id } });
  if (!ev || ev.organizationId !== organizationId) throw new Error("Not found");
  await db.jobEvent.update({
    where: { id },
    data: {
      title: data.title?.trim() ? data.title.trim() : undefined,
      notes: data.notes === undefined ? undefined : data.notes,
    },
  });
  revalidatePath("/dashboard/calendar");
  if (ev.jobId) revalidatePath(`/dashboard/jobs/${ev.jobId}`);
  const newTitle = data.title?.trim();
  const changes: string[] = [];
  if (newTitle && newTitle !== ev.title) changes.push(`renamed to ${newTitle}`);
  if (data.notes !== undefined && (data.notes ?? null) !== (ev.notes ?? null)) changes.push("notes");
  if (changes.length) {
    await logActivity({
      organizationId,
      actorId: user.id,
      kind: TRAIL_KINDS.JOB,
      summary: `Edited the calendar entry ${ev.title} — ${changes.join(", ")}`,
      meta: { jobId: ev.jobId ?? undefined, jobEventId: id, changes },
    });
  }
}

// Reschedule with explicit start AND end times (in addition to the legacy
// preserve-duration variant above). Snaps to 15-minute granularity.
export async function rescheduleJobEventTime(
  id: string,
  newStartISO: string,
  newEndISO: string,
) {
  const { organizationId, user } = await requireManager();
  const ev = await db.jobEvent.findUnique({ where: { id } });
  if (!ev || ev.organizationId !== organizationId) throw new Error("Not found");
  // Product rule: at the calendar cap, time moves are blocked too (see
  // rescheduleJobEvent).
  await enforcePlanLimit(organizationId, "calendarEvents");
  const start = roundTo15(new Date(newStartISO));
  let end = roundTo15(new Date(newEndISO));
  // Enforce minimum 15-minute duration
  if (end.getTime() - start.getTime() < 15 * 60 * 1000) {
    end = new Date(start.getTime() + 15 * 60 * 1000);
  }
  await db.jobEvent.update({
    where: { id },
    data: { startsAt: start, endsAt: end },
  });
  afterResponse(() => textJobEventMoved(id));
  revalidatePath("/dashboard/calendar");
  if (ev.jobId) revalidatePath(`/dashboard/jobs/${ev.jobId}`);
  await logActivity({
    organizationId,
    actorId: user.id,
    kind: TRAIL_KINDS.JOB,
    summary: `Moved ${ev.title} from ${when(ev.startsAt)} to ${when(start)}`,
    meta: { jobId: ev.jobId ?? undefined, jobEventId: id, from: ev.startsAt.toISOString(), to: start.toISOString(), endsAt: end.toISOString() },
  });
}

function roundTo15(d: Date): Date {
  const r = new Date(d);
  const m = r.getMinutes();
  const snapped = Math.round(m / 15) * 15;
  r.setMinutes(snapped, 0, 0);
  return r;
}

// Drag a job from the unscheduled tray onto a calendar date — creates a
// JobEvent at 9am-2pm by default, links it to the job.
export async function scheduleJobFromTray(jobId: string, dateISO: string) {
  const { organizationId, user } = await requireManager();
  const job = await db.job.findUnique({ where: { id: jobId } });
  if (!job || job.organizationId !== organizationId) throw new Error("Not found");
  await enforcePlanLimit(organizationId, "calendarEvents");

  const day = new Date(dateISO);
  const startsAt = new Date(day);
  startsAt.setHours(9, 0, 0, 0);
  const endsAt = new Date(day);
  endsAt.setHours(14, 0, 0, 0);

  // Update the job's primary schedule too
  await db.job.update({
    where: { id: jobId },
    data: { startsAt, endsAt, status: job.status === "CANCELED" ? "SCHEDULED" : job.status },
  });

  const event = await db.jobEvent.create({
    data: {
      organizationId,
      jobId: job.id,
      title: job.title,
      startsAt,
      endsAt,
      notes: "Scheduled from dispatch tray.",
    },
  });

  await db.activityEvent.create({
    data: {
      organizationId,
      actorId: user.id,
      proposalId: job.proposalId ?? null,
      clientId: job.clientId ?? null,
      kind: "SCHEDULED",
      summary: `Scheduled "${job.title}" for ${day.toLocaleDateString()}`,
    },
  });
  afterResponse(() => textJobScheduled(job.id, startsAt, endsAt, user.id));

  revalidatePath("/dashboard/calendar");
  revalidatePath("/dashboard/jobs");
  revalidatePath(`/dashboard/jobs/${jobId}`);
  return { id: event.id };
}

// Assign all crew on the linked job to a target worker (or unassign if null).
// Used by the swimlane Team view drag-to-assign interaction.
export async function assignEventWorker(
  eventId: string,
  workerId: string | null,
  newDateISO?: string,
) {
  const { organizationId, user } = await requireManager();
  const ev = await db.jobEvent.findUnique({
    where: { id: eventId },
    include: { job: { include: { assignments: true } } },
  });
  if (!ev || ev.organizationId !== organizationId) throw new Error("Not found");

  // Optional date move (mirror of rescheduleJobEvent — preserves duration + time of day)
  if (newDateISO) {
    // Same product rule as rescheduleJobEvent: moves are blocked at the cap.
    await enforcePlanLimit(organizationId, "calendarEvents");
    const newStart = new Date(newDateISO);
    newStart.setHours(ev.startsAt.getHours(), ev.startsAt.getMinutes(), 0, 0);
    const duration = ev.endsAt.getTime() - ev.startsAt.getTime();
    const newEnd = new Date(newStart.getTime() + duration);
    await db.jobEvent.update({
      where: { id: eventId },
      data: { startsAt: newStart, endsAt: newEnd },
    });
    afterResponse(() => textJobEventMoved(eventId));
  }

  // Manage JobAssignment rows on the linked job
  if (ev.jobId) {
    if (workerId === null) {
      // unassign all (Team view "Unassigned" row)
      await db.jobAssignment.deleteMany({ where: { jobId: ev.jobId } });
    } else {
      // The workerId is client-supplied — verify it belongs to THIS org before
      // attaching (mirrors createJob's tamper guard), or a manager could pin a
      // foreign org's worker to their job and leak the job to that worker's
      // portal.
      const validWorker = await db.workerProfile.findFirst({
        where: { id: workerId, organizationId },
        select: { id: true },
      });
      if (!validWorker) throw new Error("Not found");
      // ensure target worker is assigned (don't strip others)
      const exists = ev.job?.assignments.find((a) => a.workerId === workerId);
      if (!exists) {
        const created = await db.jobAssignment.create({
          data: {
            jobId: ev.jobId,
            workerId,
            status: "PENDING",
          },
        });
        afterResponse(() => textAssignmentCreated(created.id));
      }
    }
  }

  await db.activityEvent.create({
    data: {
      organizationId,
      actorId: user.id,
      kind: "UPDATED",
      summary:
        workerId === null
          ? `Unassigned event "${ev.title}"`
          : `Reassigned event "${ev.title}"`,
    },
  });

  revalidatePath("/dashboard/calendar");
  if (ev.jobId) revalidatePath(`/dashboard/jobs/${ev.jobId}`);
}
