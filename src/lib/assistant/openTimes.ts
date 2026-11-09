import "server-only";
// FIRST OPEN TIMES, FOR THE OPERATOR (calendar part 1, 2026-11-09): "when can Alex do a 4-hour job", "first open
// time for the Lee install", "when's the next free visit" — the same finder the calendar's "First open times" button
// runs (lib/calendar/openTimes), read on the company's own clock. It only offers; booking stays schedule_job /
// book_visit, read back and done on a yes.

import { z } from "zod";
import { db } from "@/lib/db";
import type { ReadTool } from "@/lib/assistant/tools";
import { dayOf, dayWords, timeOf, wallInstant, clockWords } from "@/lib/assistant/shared";
import { findOpenTimes, type OpenBusy } from "@/lib/calendar/openTimes";
import { isPageLocked } from "@/lib/customPageAccess";

const ID = z.string().min(1).max(64);
const CREW_ROLES = ["INSTALLER"];
const VISIT_ROLES = ["SALES", "ESTIMATOR", "OWNER", "MANAGER", "ADMIN"];
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

type Args = { who: string | null; kind: "job" | "visit"; hours: number | null; jobId: string | null };

const openTimes: ReadTool<Args> = {
  kind: "read",
  name: "open_times",
  need: "schedule.read",
  card: {
    label: "First open times",
    purpose: "When the crew or a rep is next free for a job or a visit of a given length — three real choices, one per person per day.",
    when: "'When can Alex do a 4-hour job', 'first open time for the Lee install', 'when's the next free visit slot': open_times(who, kind, hours, jobId). Offer the times as given; on a yes book with schedule_job (a job) or book_visit (a visit).",
    objects: ["calendar", "worker", "job"],
    effect: "read",
    group: "schedule",
    version: 1,
    since: "2026-11-09",
    samples: [
      { say: "when can Alex do a 4 hour job?", args: { who: "Alex", kind: "job", hours: 4, jobId: null } },
      { say: "what's the first open time for a site visit?", args: { who: null, kind: "visit", hours: null, jobId: null } },
    ],
  },
  description:
    "The first open times in the next three weeks for a job (the crew) or a visit (sales and the office): working hours 8 AM–5 PM, Sundays off, everyone's booked jobs, visits and blocked time (a company-wide block closes the day). who = a person's name or null for anyone in the right role; hours = how long (null = the job's planned length, else 4 h for a job, 1 h for a visit); jobId = the job when it's for one.",
  params: z.object({
    who: z.string().max(80).nullable().describe("a person's name, or null for anyone who does this kind of work"),
    kind: z.enum(["job", "visit"]),
    hours: z.number().min(0.5).max(240).nullable().describe("how long it takes, in hours; null = the job's own length or the default"),
    jobId: ID.nullable().describe("the job, when the times are for one (from find); else null"),
  }),
  async run({ actor, now }, args) {
    const org = actor.organizationId;
    const tz = actor.timezone;
    if (await isPageLocked(org, "calendar")) return { say: "The calendar isn't in your plan yet (Settings → Billing)." };
    const [workers, members] = await Promise.all([
      db.workerProfile.findMany({ where: { organizationId: org, inviteStatus: { not: "DECLINED" } }, select: { id: true, displayName: true, userId: true } }),
      db.membership.findMany({ where: { organizationId: org }, select: { userId: true, role: true } }),
    ]);
    const roleOf = new Map(members.map((m) => [m.userId, m.role]));
    let people = workers.map((w) => ({ id: w.id, name: w.displayName, role: roleOf.get(w.userId) ?? "INSTALLER", userId: w.userId }));
    if (args.who) {
      const q = args.who.trim().toLowerCase();
      const named = people.filter((p) => p.name.toLowerCase().includes(q));
      if (!named.length) return { say: `No one called ${args.who} on the team.`, team: people.map((p) => p.name) };
      people = named;
    } else {
      const want = args.kind === "job" ? CREW_ROLES : VISIT_ROLES;
      const fit = people.filter((p) => want.includes(p.role));
      if (fit.length) people = fit;
    }
    if (!people.length) return { say: "There's no one on the team to send yet — add people on the Workers page." };

    let durMin = args.hours ? Math.round(args.hours * 60) : args.kind === "visit" ? 60 : 240;
    let jobTitle: string | null = null;
    if (args.jobId) {
      const job = await db.job.findFirst({ where: { id: args.jobId, organizationId: org }, select: { title: true, startsAt: true, endsAt: true } });
      if (!job) return { say: "That job isn't in this company." };
      jobTitle = job.title;
      if (!args.hours && job.startsAt && job.endsAt && job.endsAt > job.startsAt) durMin = Math.round((job.endsAt.getTime() - job.startsAt.getTime()) / 60_000);
    }

    const until = new Date(now.getTime() + (LOOK_DAYS + 2) * 86_400_000);
    const ids = people.map((p) => p.id);
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

    const slots = findOpenTimes({ from: toWall(new Date(now.getTime() + 30 * 60_000), tz), people, busy, durationMin: durMin, days: LOOK_DAYS, count: 3 });
    const len = durMin >= 1440 ? `${Math.round(durMin / 1440)} day${durMin >= 2880 ? "s" : ""}` : durMin % 60 ? `${(durMin / 60).toFixed(1)} h` : `${durMin / 60} h`;
    if (!slots.length) return { say: `No open ${len} in the next three weeks for ${people.map((p) => p.name).join(", ")}.` };
    return {
      for: jobTitle ?? (args.kind === "visit" ? "a visit" : "a job"),
      length: len,
      times: slots.map((s) => {
        const at = fromWall(s.start, tz) ?? s.start;
        return { workerId: s.personId, who: s.name, day: dayOf(at, tz), start: timeOf(at, tz), words: `${dayWords(at, tz)} at ${clockWords(at, tz)} — ${s.name}` };
      }),
      page: "/dashboard/calendar",
    };
  },
};

export const OPEN_TIME_TOOLS = [openTimes] as const;
