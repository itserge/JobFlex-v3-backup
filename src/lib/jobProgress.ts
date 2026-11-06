// THE CREW ON SITE (2026-09-27) — server. One rule behind both doors.
//
// The worker portal's status route and the dashboard's setJobProgress used
// to each move the job and write their own trail row; neither told the
// office. Now both call `recordJobProgress`: it moves the status, writes the
// STARTED / COMPLETED row the bell and the job trail read (with the day
// number), promotes the proposal and sends the review request on
// completion, and — after the response — texts the owner and the manager.
//
// Stage A (2026-09-30): the days are WorkDay rows (lib/workDays), not the
// STARTED rows of the trail. A Start or a Back on site opens today's day,
// "closed" closes it (a note or a file of the day is required), Complete
// closes today's. The office moving the status goes through here too, with
// `silent` — the day counts, nobody is texted. The STARTED / COMPLETED rows
// and the texts are written exactly as before.

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { afterResponse } from "@/lib/server-events";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { progressSummary, type ProgressWhat } from "@/lib/jobProgressShared";
import { closeDaySummary, type WorkDayLike } from "@/lib/workDaysShared";
import { closeTodayOnCompletion, closeWorkDay, openWorkDay, workDayCount, type WorkDayRow, type WorkDaySource } from "@/lib/workDays";

export type ProgressResult =
  | { ok: true; status: string; day: number; what: ProgressWhat; workDayId?: string }
  | { ok: false; error: string; code: "not-found" | "closed" | "not-started" | "already-today" | "no-day" | "already-closed" | "needs-note-or-file" };

export interface ProgressActor {
  userId: string;
  /** The name the trail and the text use. */
  name: string;
}

/** Where a job stands for the crew's buttons: the day number, whether
 *  today has a start, how many days so far — and, since stage A, the day
 *  open today and the days that passed unclosed. */
export interface ProgressInfo {
  day: number;
  startedToday: boolean;
  daysSoFar: number;
  openDay: WorkDayLike | null;
  pendingDays: WorkDayLike[];
  days: WorkDayRow[];
}

export async function jobProgressInfo(organizationId: string, jobId: string): Promise<ProgressInfo> {
  try {
    const c = await workDayCount(organizationId, jobId);
    return { day: c.day, startedToday: c.startedToday, daysSoFar: c.daysSoFar, openDay: c.openDay, pendingDays: c.pendingDays, days: c.days };
  } catch {
    return { day: 1, startedToday: false, daysSoFar: 0, openDay: null, pendingDays: [], days: [] };
  }
}

export async function recordJobProgress(input: {
  organizationId: string;
  jobId: string;
  actor: ProgressActor;
  what: ProgressWhat;
  via: "worker-portal" | "dashboard";
  /** Who opened the day: the crew, or the office moving the status. Defaults by the door. */
  source?: WorkDaySource;
  /** The office's status change: the day counts, no text and no text rule. */
  silent?: boolean;
  /** For "closed": the note, and the date of a past (PENDING) day to close; today when empty. */
  note?: string | null;
  date?: string | null;
}): Promise<ProgressResult> {
  const { organizationId, jobId, actor, what, via } = input;
  const source: WorkDaySource = input.source ?? (via === "worker-portal" ? "worker" : "office");
  const job = await db.job.findFirst({
    where: { id: jobId, organizationId },
    select: { id: true, title: true, status: true, proposalId: true, clientId: true },
  });
  if (!job) return { ok: false, error: "Job not found.", code: "not-found" };

  // ── close a day: today's, or a past one by its date ──
  if (what === "closed") {
    if (job.status === "CANCELED") return { ok: false, error: "This job is closed.", code: "closed" };
    const r = await closeWorkDay({ organizationId, jobId, actorUserId: actor.userId, note: input.note, date: input.date });
    if (!r.ok) return { ok: false, error: r.error, code: r.code };
    await logActivity({
      organizationId,
      actorId: actor.userId,
      kind: TRAIL_KINDS.JOB,
      summary: closeDaySummary(actor.name, job.title, r.day.dayNumber, r.day.mediaCount, !!r.day.note),
      proposalId: job.proposalId,
      clientId: job.clientId,
      meta: { jobId, workDayId: r.day.id, day: r.day.dayNumber, date: r.day.date, closed: true, via },
    });
    revalidateJob(jobId, false);
    return { ok: true, status: job.status, day: r.day.dayNumber, what: "closed", workDayId: r.day.id };
  }

  if (job.status === "CANCELED" || job.status === "COMPLETED") return { ok: false, error: "This job is closed.", code: "closed" };
  if (what === "continued" && job.status !== "IN_PROGRESS") return { ok: false, error: "Start the job first.", code: "not-started" };

  const info = await workDayCount(organizationId, jobId);
  if (what === "continued" && info.startedToday) return { ok: false, error: "Today is already on the clock.", code: "already-today" };
  // A Start on a job that is already in progress on a new day counts as a day back.
  const effective: ProgressWhat = what === "started" && job.status === "IN_PROGRESS" && !info.startedToday && info.daysSoFar > 0 ? "continued" : what;
  const nextStatus = effective === "completed" ? "COMPLETED" : "IN_PROGRESS";

  // The day itself: opened by a start or a day back (a crewmate's press the
  // same day finds it open), closed by the finish line.
  let workDayId: string | undefined;
  let day: number;
  if (effective === "completed") {
    await closeTodayOnCompletion(organizationId, jobId, actor.userId);
    day = Math.max(1, info.daysSoFar);
  } else {
    const opened = await openWorkDay({ organizationId, jobId, actorUserId: actor.userId, source });
    workDayId = opened.day.id;
    day = opened.day.dayNumber;
    // The weather on a new day on site, noted by itself after the press is answered (the crew build, 2026-11-05).
    if (opened.created) {
      const dayId = opened.day.id;
      afterResponse(async () => {
        const { noteWeather } = await import("@/lib/crewField/server");
        await noteWeather(organizationId, dayId);
      });
    }
  }

  if (job.status !== nextStatus) await db.job.update({ where: { id: jobId }, data: { status: nextStatus } });
  if (effective === "completed") {
    // Same finish-line side effects as updateJob: the ACCEPTED proposal reads
    // COMPLETED, the review request goes out.
    if (job.proposalId) {
      await db.proposal.updateMany({ where: { id: job.proposalId, organizationId, status: "ACCEPTED" }, data: { status: "COMPLETED" } });
      // A client paying with a Wisetack loan is asked to confirm the job is done — the contractor's payout follows.
      const financedId = job.proposalId;
      afterResponse(async () => {
        const { askClientDone } = await import("@/lib/financing/service");
        await askClientDone(organizationId, financedId);
      });
    }
    try {
      const { createReviewRequestInternal } = await import("@/lib/reviewRequestInternal");
      await createReviewRequestInternal(jobId, actor.userId);
    } catch (err) {
      console.warn("[jobProgress] review request failed:", err);
    }
  }
  // One row the bell, the overview and the job trail all read: STARTED for a
  // start and for a day back (the day number in meta), COMPLETED at the end.
  // (A start that repeats on the same day writes no second row.)
  const skipRow = effective === "started" && info.startedToday;
  if (!skipRow) {
    await db.activityEvent.create({
      data: {
        organizationId,
        actorId: actor.userId,
        proposalId: job.proposalId,
        clientId: job.clientId,
        kind: effective === "completed" ? "COMPLETED" : "STARTED",
        summary: progressSummary(actor.name, job.title, effective, day),
        meta: JSON.stringify({ jobId, status: nextStatus, day, continued: effective === "continued", via, source, ...(workDayId ? { workDayId } : {}) }),
      },
    });
  }
  revalidateJob(jobId, effective === "completed");
  // The owner and the manager hear about it — after the response, never on
  // it. The office's own status move (silent) tells nobody.
  if (!skipRow && !input.silent) {
    afterResponse(async () => {
      const { notifyJobProgress } = await import("@/lib/notify");
      await notifyJobProgress(jobId, actor, effective, day);
    });
  }
  return { ok: true, status: nextStatus, day, what: effective, workDayId };
}

function revalidateJob(jobId: string, completed: boolean) {
  try {
    revalidatePath(`/dashboard/jobs/${jobId}`);
    revalidatePath("/dashboard/jobs");
    // The calendar's chips carry the status; the old action refreshed it too.
    revalidatePath("/dashboard/calendar");
    if (completed) {
      revalidatePath("/dashboard/proposals");
      revalidatePath("/dashboard/reviews");
    }
  } catch {
    /* outside a request */
  }
}
