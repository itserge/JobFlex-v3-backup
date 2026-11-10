import "server-only";
// FIRST OPEN TIMES, FOR THE OPERATOR (calendar part 1, 2026-11-09): "when can Alex do a 4-hour job", "first open
// time for the Lee install", "when's the next free visit" — the same finder the calendar's "First open times" button
// runs (lib/calendar/openTimes), read on the company's own clock. It only offers; booking stays schedule_job /
// book_visit, read back and done on a yes.

import { z } from "zod";
import { db } from "@/lib/db";
import type { ReadTool } from "@/lib/assistant/tools";
import { lengthWords, openTimesFor } from "@/lib/calendar/openTimesServer";
import { isPageLocked } from "@/lib/customPageAccess";

const ID = z.string().min(1).max(64);
const CREW_ROLES = ["INSTALLER"];
const VISIT_ROLES = ["SALES", "ESTIMATOR", "OWNER", "MANAGER", "ADMIN"];

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

    const slots = await openTimesFor({ organizationId: org, tz, now, people, durMin, count: 3 });
    const len = lengthWords(durMin);
    if (!slots.length) return { say: `No open ${len} in the next three weeks for ${people.map((p) => p.name).join(", ")}.` };
    return {
      for: jobTitle ?? (args.kind === "visit" ? "a visit" : "a job"),
      length: len,
      times: slots.map((s) => ({ workerId: s.workerId, who: s.who, day: s.day, start: s.start, words: s.words })),
      page: "/dashboard/calendar",
    };
  },
};

export const OPEN_TIME_TOOLS = [openTimes] as const;
