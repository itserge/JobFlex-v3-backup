import "server-only";
// PUTTING A JOB ON THE CALENDAR, WITHOUT A BROWSER SESSION (2026-11-04) — for
// the JobFlex Assistant: "put the Lee fence on Thursday with Mike". The same
// writes the calendar's own actions make (actions/jobs scheduleJobFromTray,
// rescheduleJobEventTime, assignEventWorker) with the instants worked out by
// the caller in the COMPANY's time zone — those actions set hours on the
// server's clock, which on Vercel is UTC. The crew hears by text exactly as
// from the calendar (lib/sms/schedule, lib/sms/crew), after the response.
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { enforcePlanLimit } from "@/lib/limitsEngine";
import { afterResponse } from "@/lib/server-events";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { textJobScheduled } from "@/lib/sms/schedule";
import { textAssignmentCreated, textJobEventMoved } from "@/lib/sms/crew";

export interface JobActor {
  organizationId: string;
  userId: string;
}

export interface ScheduleInput {
  jobId: string;
  startsAt: Date;
  endsAt: Date;
  /** Workers to put on the job (added; nobody already on it is taken off). */
  workerIds?: string[];
}

export interface ScheduleResult {
  eventId: string;
  /** true = the job already had a calendar entry and it was moved. */
  moved: boolean;
  /** Names of the workers newly put on the job. */
  added: string[];
}

/** Someone already booked in that window: another job's entry, or time off. */
export interface Conflict {
  workerId: string;
  name: string;
  what: string;
  startsAt: Date;
  endsAt: Date;
}

function revalidate(paths: string[]) {
  for (const p of paths) {
    try {
      revalidatePath(p);
    } catch {
      /* outside a request */
    }
  }
}

function when(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(d);
}

/**
 * Who of these workers is already busy between `startsAt` and `endsAt`: on
 * another job's calendar entry (a canceled job is not busy), or on time off
 * they or the whole company blocked. The job being scheduled is left out.
 */
export async function crewConflicts(
  organizationId: string,
  workerIds: string[],
  startsAt: Date,
  endsAt: Date,
  exceptJobId?: string | null,
): Promise<Conflict[]> {
  if (!workerIds.length) return [];
  const workers = await db.workerProfile.findMany({
    where: { organizationId, id: { in: workerIds } },
    select: { id: true, userId: true, displayName: true },
  });
  if (!workers.length) return [];
  const [events, blocks] = await Promise.all([
    db.jobEvent.findMany({
      where: {
        organizationId,
        startsAt: { lt: endsAt },
        endsAt: { gt: startsAt },
        ...(exceptJobId ? { NOT: { jobId: exceptJobId } } : {}),
        job: { status: { not: "CANCELED" }, assignments: { some: { workerId: { in: workers.map((w) => w.id) } } } },
      },
      select: { title: true, startsAt: true, endsAt: true, job: { select: { assignments: { select: { workerId: true } } } } },
      take: 50,
    }),
    db.blockedTime.findMany({
      where: { organizationId, startsAt: { lt: endsAt }, endsAt: { gt: startsAt }, OR: [{ ownerId: null }, { ownerId: { in: workers.map((w) => w.userId) } }] },
      select: { ownerId: true, reason: true, startsAt: true, endsAt: true },
      take: 50,
    }),
  ]);
  const out: Conflict[] = [];
  for (const w of workers) {
    for (const e of events) {
      if (e.job?.assignments.some((a) => a.workerId === w.id)) out.push({ workerId: w.id, name: w.displayName, what: e.title, startsAt: e.startsAt, endsAt: e.endsAt });
    }
    for (const b of blocks) {
      if (b.ownerId === null || b.ownerId === w.userId) out.push({ workerId: w.id, name: w.displayName, what: b.reason || "Time off", startsAt: b.startsAt, endsAt: b.endsAt });
    }
  }
  return out;
}

/**
 * Put a job on the calendar at `startsAt`–`endsAt`, or move it there when it
 * already has an entry, and add the named workers. Each worker must be this
 * company's (a foreign id is refused, as the calendar refuses it).
 */
export async function scheduleJobAs(actor: JobActor, input: ScheduleInput): Promise<ScheduleResult> {
  const { organizationId, userId } = actor;
  const job = await db.job.findFirst({
    where: { id: input.jobId, organizationId },
    include: { events: { orderBy: { startsAt: "asc" }, take: 1 }, assignments: { select: { workerId: true } } },
  });
  if (!job) throw new Error("Not found");
  if (!(input.endsAt.getTime() > input.startsAt.getTime())) throw new Error("The end has to be after the start.");
  // Product rule (actions/jobs): at the calendar cap, moves are blocked too.
  await enforcePlanLimit(organizationId, "calendarEvents", 1, { actorId: userId });
  const tz = (await db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } }))?.timezone || "America/New_York";

  const wanted = [...new Set(input.workerIds ?? [])];
  const workers = wanted.length
    ? await db.workerProfile.findMany({ where: { organizationId, id: { in: wanted } }, select: { id: true, displayName: true } })
    : [];
  if (workers.length !== wanted.length) throw new Error("Not found");

  const existing = job.events[0] ?? null;
  let eventId: string;
  if (existing) {
    await db.jobEvent.update({ where: { id: existing.id }, data: { startsAt: input.startsAt, endsAt: input.endsAt } });
    await db.job.update({ where: { id: job.id }, data: { startsAt: input.startsAt, endsAt: input.endsAt } });
    eventId = existing.id;
    afterResponse(() => textJobEventMoved(existing.id));
    await logActivity({
      organizationId,
      actorId: userId,
      kind: TRAIL_KINDS.JOB,
      summary: `Moved ${existing.title} from ${when(existing.startsAt, tz)} to ${when(input.startsAt, tz)}`,
      meta: { jobId: job.id, jobEventId: existing.id, from: existing.startsAt.toISOString(), to: input.startsAt.toISOString(), endsAt: input.endsAt.toISOString(), via: "assistant" },
    });
  } else {
    await db.job.update({
      where: { id: job.id },
      data: { startsAt: input.startsAt, endsAt: input.endsAt, status: job.status === "CANCELED" ? "SCHEDULED" : job.status },
    });
    const event = await db.jobEvent.create({
      data: { organizationId, jobId: job.id, title: job.title, startsAt: input.startsAt, endsAt: input.endsAt, notes: "Scheduled by the JobFlex Assistant." },
    });
    eventId = event.id;
    await db.activityEvent.create({
      data: {
        organizationId,
        actorId: userId,
        proposalId: job.proposalId ?? null,
        clientId: job.clientId ?? null,
        kind: "SCHEDULED",
        summary: `Scheduled "${job.title}" for ${when(input.startsAt, tz)}`,
      },
    });
    const startsAt = input.startsAt;
    const endsAt = input.endsAt;
    afterResponse(() => textJobScheduled(job.id, startsAt, endsAt, userId));
  }

  const added: string[] = [];
  for (const w of workers) {
    if (job.assignments.some((a) => a.workerId === w.id)) continue;
    const created = await db.jobAssignment.create({ data: { jobId: job.id, workerId: w.id, status: "PENDING" } });
    afterResponse(() => textAssignmentCreated(created.id));
    added.push(w.displayName);
  }
  if (added.length) {
    await logActivity({
      organizationId,
      actorId: userId,
      kind: TRAIL_KINDS.JOB,
      summary: `Put ${added.join(", ")} on ${job.title}`,
      meta: { jobId: job.id, jobEventId: eventId, via: "assistant" },
    });
  }

  revalidate(["/dashboard/calendar", "/dashboard/jobs", `/dashboard/jobs/${job.id}`]);
  return { eventId, moved: Boolean(existing), added };
}
