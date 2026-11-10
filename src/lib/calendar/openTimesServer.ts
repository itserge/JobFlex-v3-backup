import "server-only";
// FIRST OPEN TIMES ON THE COMPANY'S CLOCK (2026-11-09) — the busy spans of the given people (their booked jobs,
// their visits, their own and the company's blocked time) read from the database and handed to the pure finder
// (lib/calendar/openTimes). Shared by the Operator's open_times (lib/assistant/openTimes) and the repair sheet
// (lib/repairs/server), so "when can Alex come back" has one answer everywhere.

import { db } from "@/lib/db";
import { dayOf, dayWords, timeOf, wallInstant, clockWords } from "@/lib/assistant/shared";
import { findOpenTimes, type OpenBusy } from "@/lib/calendar/openTimes";

const LOOK_DAYS = 21;

/** The company's wall clock as a plain local Date — the finder thinks in local days and hours, and the server's own
 *  zone must not leak into "8 AM". Read back with `fromWall`. */
function toWall(d: Date, tz: string): Date {
  return new Date(`${dayOf(d, tz)}T${timeOf(d, tz)}:00`);
}
function fromWall(w: Date, tz: string): Date | null {
  const day = `${w.getFullYear()}-${String(w.getMonth() + 1).padStart(2, "0")}-${String(w.getDate()).padStart(2, "0")}`;
  return wallInstant(day, `${String(w.getHours()).padStart(2, "0")}:${String(w.getMinutes()).padStart(2, "0")}`, tz);
}

export type OpenTimeOffer = { workerId: string; who: string; day: string; start: string; words: string; startsAt: Date; endsAt: Date };

/** The first `count` open starts of `durMin` minutes for these people over the next three weeks (one per person per day). */
export async function openTimesFor(input: {
  organizationId: string;
  tz: string;
  now: Date;
  people: Array<{ id: string; name: string }>;
  durMin: number;
  count?: number;
}): Promise<OpenTimeOffer[]> {
  const { organizationId: org, tz, now, people, durMin } = input;
  if (!people.length) return [];
  const until = new Date(now.getTime() + (LOOK_DAYS + 2) * 86_400_000);
  const ids = people.map((p) => p.id);
  const workers = await db.workerProfile.findMany({ where: { organizationId: org }, select: { id: true, userId: true } });
  const workerOfUser = new Map(workers.map((w) => [w.userId, w.id]));
  const [jobEvents, visits, blocks] = await Promise.all([
    db.jobEvent.findMany({
      where: { organizationId: org, startsAt: { lt: until }, endsAt: { gt: now }, job: { status: { not: "CANCELED" }, assignments: { some: { workerId: { in: ids } } } } },
      select: { startsAt: true, endsAt: true, job: { select: { assignments: { select: { workerId: true } } } } },
    }),
    db.appointment.findMany({
      where: { organizationId: org, status: { notIn: ["CANCELED", "NO_SHOW"] }, startsAt: { lt: until }, endsAt: { gt: now }, assignments: { some: { workerId: { in: ids } } } },
      select: { startsAt: true, endsAt: true, assignments: { select: { workerId: true } } },
    }),
    db.blockedTime.findMany({ where: { organizationId: org, startsAt: { lt: until }, endsAt: { gt: now } }, select: { ownerId: true, startsAt: true, endsAt: true } }),
  ]);
  const busy: OpenBusy[] = [];
  for (const e of jobEvents) for (const a of e.job?.assignments ?? []) busy.push({ personId: a.workerId, start: toWall(e.startsAt, tz), end: toWall(e.endsAt, tz) });
  for (const v of visits) for (const a of v.assignments) busy.push({ personId: a.workerId, start: toWall(v.startsAt, tz), end: toWall(v.endsAt, tz) });
  for (const b of blocks) {
    const who = b.ownerId ? workerOfUser.get(b.ownerId) : null;
    if (b.ownerId && !who) continue;
    busy.push({ personId: who ?? null, start: toWall(b.startsAt, tz), end: toWall(b.endsAt, tz) });
  }
  const slots = findOpenTimes({ from: toWall(new Date(now.getTime() + 30 * 60_000), tz), people, busy, durationMin: durMin, days: LOOK_DAYS, count: input.count ?? 3 });
  return slots.map((s) => {
    const at = fromWall(s.start, tz) ?? s.start;
    return { workerId: s.personId, who: s.name, day: dayOf(at, tz), start: timeOf(at, tz), words: `${dayWords(at, tz)} at ${clockWords(at, tz)} — ${s.name}`, startsAt: at, endsAt: new Date(at.getTime() + durMin * 60_000) };
  });
}

/** "4 h", "1.5 h", "3 days" — a length in words. */
export function lengthWords(durMin: number): string {
  return durMin >= 1440 ? `${Math.round(durMin / 1440)} day${durMin >= 2880 ? "s" : ""}` : durMin % 60 ? `${(durMin / 60).toFixed(1)} h` : `${durMin / 60} h`;
}
