// A DAY ON SITE (stage A, 2026-09-30) — server.
//
// The WorkDay rows behind the crew's Start / Back on site / Close day /
// Complete. `recordJobProgress` (lib/jobProgress) opens and closes them; the
// job pages read them through `listWorkDays`. Every function takes plain ids,
// so the token door, the session door and the QA scripts share one rule.

import { db } from "@/lib/db";
import { localDayKey } from "@/lib/jobProgressShared";
import { canCloseDay, dayCount, effectiveDayStatus, type WorkDayLike } from "@/lib/workDaysShared";

export type WorkDaySource = "worker" | "office";

export interface WorkDayRow extends WorkDayLike {
  id: string;
  jobId: string;
  organizationId: string;
  openedById: string | null;
  closedById: string | null;
  closedAt: Date | null;
  note: string | null;
  source: string;
  mediaCount: number;
  /** The weather the day it was opened, noted by itself (the crew build, 2026-11-05). */
  weather: string | null;
}

export async function tzOf(organizationId: string): Promise<string> {
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } });
  return org?.timezone || "America/New_York";
}

/** OPEN days whose date has passed become PENDING. One job, or the whole
 *  organization (the daily cron), in the organization's own clock. */
export async function sweepPendingDays(organizationId: string, jobId?: string, now = new Date()): Promise<number> {
  const today = localDayKey(now, await tzOf(organizationId));
  const r = await db.workDay.updateMany({
    where: { organizationId, ...(jobId ? { jobId } : {}), status: "OPEN", date: { lt: today } },
    data: { status: "PENDING" },
  });
  return r.count;
}

/** Every organization's open days that passed — for the daily cron. */
export async function sweepPendingDaysEverywhere(now = new Date()): Promise<number> {
  const orgs = await db.workDay.findMany({ where: { status: "OPEN" }, select: { organizationId: true }, distinct: ["organizationId"] });
  let n = 0;
  for (const o of orgs) n += await sweepPendingDays(o.organizationId, undefined, now);
  return n;
}

/** A job's days, oldest first, with how many files each holds. Sweeps first,
 *  so a day that passed reads PENDING on every screen. */
export async function listWorkDays(organizationId: string, jobId: string, now = new Date()): Promise<WorkDayRow[]> {
  await sweepPendingDays(organizationId, jobId, now);
  const rows = await db.workDay.findMany({
    where: { organizationId, jobId },
    orderBy: { date: "asc" },
    include: { _count: { select: { photos: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    jobId: r.jobId,
    organizationId: r.organizationId,
    date: r.date,
    dayNumber: r.dayNumber,
    status: r.status,
    openedById: r.openedById,
    closedById: r.closedById,
    closedAt: r.closedAt,
    note: r.note,
    source: r.source,
    mediaCount: r._count.photos,
    weather: r.weather,
  }));
}

/** The day open on this job today (OPEN or PENDING-by-date), for a file to hang on. */
export async function openDayOf(organizationId: string, jobId: string, now = new Date()): Promise<{ id: string; date: string; dayNumber: number } | null> {
  const today = localDayKey(now, await tzOf(organizationId));
  const row = await db.workDay.findUnique({ where: { jobId_date: { jobId, date: today } }, select: { id: true, date: true, dayNumber: true, status: true } });
  if (!row || row.status === "CLOSED") return null;
  return { id: row.id, date: row.date, dayNumber: row.dayNumber };
}

/** Today's day on the job: made if missing (numbered after the days before
 *  it), returned as is when it exists — a second press the same day, or a
 *  crewmate's, opens nothing new. */
export async function openWorkDay(input: { organizationId: string; jobId: string; actorUserId: string; source: WorkDaySource; now?: Date }): Promise<{ day: WorkDayRow; created: boolean }> {
  const { organizationId, jobId, actorUserId, source } = input;
  const now = input.now ?? new Date();
  const today = localDayKey(now, await tzOf(organizationId));
  const existing = await db.workDay.findUnique({ where: { jobId_date: { jobId, date: today } } });
  if (existing) return { day: await rowOf(existing.id), created: false };
  const before = await db.workDay.count({ where: { jobId, date: { lt: today } } });
  // Two crew pressing in the same second: the unique key lets one through,
  // the other reads the row the first one made.
  try {
    const made = await db.workDay.create({ data: { organizationId, jobId, date: today, dayNumber: before + 1, status: "OPEN", openedById: actorUserId, source } });
    return { day: await rowOf(made.id), created: true };
  } catch {
    const again = await db.workDay.findUnique({ where: { jobId_date: { jobId, date: today } } });
    if (!again) throw new Error("Could not open the day.");
    return { day: await rowOf(again.id), created: false };
  }
}

export type CloseDayResult =
  | { ok: true; day: WorkDayRow }
  | { ok: false; error: string; code: "no-day" | "already-closed" | "needs-note-or-file" };

/** Close a day — today's, or a past one by its date (backdating a PENDING
 *  day). Any crew on the job or the office; the rule is a note or a file. */
export async function closeWorkDay(input: { organizationId: string; jobId: string; actorUserId: string; note?: string | null; date?: string | null; now?: Date }): Promise<CloseDayResult> {
  const { organizationId, jobId, actorUserId } = input;
  const now = input.now ?? new Date();
  const date = input.date || localDayKey(now, await tzOf(organizationId));
  const row = await db.workDay.findFirst({ where: { organizationId, jobId, date }, include: { _count: { select: { photos: true } } } });
  if (!row) return { ok: false, error: "There is no day on site to close for that date.", code: "no-day" };
  if (row.status === "CLOSED") return { ok: false, error: "That day is already closed.", code: "already-closed" };
  const note = (input.note ?? "").trim() || null;
  const rule = canCloseDay({ note, mediaCount: row._count.photos });
  if (!rule.ok) return { ok: false, error: rule.error, code: "needs-note-or-file" };
  await db.workDay.update({ where: { id: row.id }, data: { status: "CLOSED", closedById: actorUserId, closedAt: now, note } });
  return { ok: true, day: await rowOf(row.id) };
}

/** Completing the job closes the day open today, note or not — the finish
 *  line is the stronger statement. Days that passed unclosed stay PENDING. */
export async function closeTodayOnCompletion(organizationId: string, jobId: string, actorUserId: string, now = new Date()): Promise<void> {
  const today = localDayKey(now, await tzOf(organizationId));
  await db.workDay.updateMany({ where: { organizationId, jobId, date: today, status: { not: "CLOSED" } }, data: { status: "CLOSED", closedById: actorUserId, closedAt: now } });
}

/** Where a job stands for the crew's buttons, off the WorkDay rows. */
export async function workDayCount(organizationId: string, jobId: string, now = new Date()) {
  const [tz, days] = await Promise.all([tzOf(organizationId), listWorkDays(organizationId, jobId, now)]);
  const c = dayCount(days, tz, now);
  return { ...c, days, today: localDayKey(now, tz), effective: (d: WorkDayLike) => effectiveDayStatus(d, localDayKey(now, tz)) };
}

async function rowOf(id: string): Promise<WorkDayRow> {
  const r = await db.workDay.findUniqueOrThrow({ where: { id }, include: { _count: { select: { photos: true } } } });
  return { id: r.id, jobId: r.jobId, organizationId: r.organizationId, date: r.date, dayNumber: r.dayNumber, status: r.status, openedById: r.openedById, closedById: r.closedById, closedAt: r.closedAt, note: r.note, source: r.source, mediaCount: r._count.photos, weather: r.weather };
}
