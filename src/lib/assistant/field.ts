import "server-only";
// THE FIELD FOR THE AI OPERATOR (the crew build, 2026-11-05) — "Who's at Smith's today?", "Any problems on site?",
// "Mark the subfloor problem resolved". Two reads and one write, thin calls into lib/crewField; a change is read
// back for a yes like every other (lib/assistant/tools).

import { z } from "zod";
import { db } from "@/lib/db";
import type { ReadTool, WriteTool } from "@/lib/assistant/tools";
import { resolveFlag } from "@/lib/crewField/server";
import { hoursWords } from "@/lib/crewField/shared";
import { localDayKey } from "@/lib/jobProgressShared";

const ID = z.string().min(1).max(64);

const whoIsOnSite: ReadTool<{ projectId: string | null; jobId: string | null }> = {
  kind: "read",
  name: "who_is_on_site",
  need: "crew.read",
  description:
    "Who is on site today: every job with a day open today (or the one project's / job's), the crew on it, who opened the day, the hours typed so far, the weather noted. Use for: who's at Smith's today, who's working, is anyone on the deck job, how many hours did Mike put in.",
  params: z.object({ projectId: ID.nullable(), jobId: ID.nullable() }),
  async run({ actor }, args) {
    const org = actor.organizationId;
    const today = localDayKey(new Date(), actor.timezone);
    const days = await db.workDay.findMany({
      where: { organizationId: org, date: today, ...(args.jobId ? { jobId: args.jobId } : {}), ...(args.projectId ? { job: { projectId: args.projectId } } : {}) },
      select: { jobId: true, status: true, weather: true, dayNumber: true, openedById: true, job: { select: { title: true, client: { select: { name: true } }, project: { select: { name: true, number: true } }, assignments: { where: { status: { in: ["ACCEPTED", "COMPLETED"] } }, select: { workerId: true, worker: { select: { displayName: true } } } } } } },
      take: 30,
    });
    const hours = days.length ? await db.crewHours.findMany({ where: { organizationId: org, date: today, jobId: { in: days.map((d) => d.jobId) } }, select: { jobId: true, workerId: true, hours: true } }) : [];
    const openers = days.length ? await db.user.findMany({ where: { id: { in: days.map((d) => d.openedById).filter(Boolean) as string[] } }, select: { id: true, name: true } }) : [];
    const nameOf = new Map(openers.map((u) => [u.id, u.name]));
    return {
      today,
      onSite: days.map((d) => ({
        job: d.job.title,
        client: d.job.client?.name ?? null,
        project: d.job.project ? `${d.job.project.name}${d.job.project.number ? ` (#${d.job.project.number})` : ""}` : null,
        day: d.dayNumber,
        state: d.status === "OPEN" ? "on site" : d.status === "CLOSED" ? "day closed" : "day open, not closed",
        openedBy: d.openedById ? (nameOf.get(d.openedById) ?? null) : null,
        crew: d.job.assignments.map((a) => `${a.worker.displayName}${(() => {
          const h = hours.find((x) => x.jobId === d.jobId && x.workerId === a.workerId);
          return h ? ` (${hoursWords(h.hours)})` : "";
        })()}`),
        weather: d.weather,
      })),
      note: days.length ? null : "Nobody has opened a day on site today.",
    };
  },
};

const siteProblems: ReadTool<{ projectId: string | null }> = {
  kind: "read",
  name: "site_problems",
  need: "projects.read",
  description: "Problems flagged from site that are still open (the whole company, or one project): what, on which job, who flagged it, when, whether the work stopped. Use for: any problems on site, what's wrong at Smith's, is anything blocking the crew.",
  params: z.object({ projectId: ID.nullable() }),
  async run({ actor }, args) {
    const flags = await db.jobFlag.findMany({
      where: { organizationId: actor.organizationId, status: "OPEN", ...(args.projectId ? { projectId: args.projectId } : {}) },
      orderBy: [{ blocking: "desc" }, { createdAt: "desc" }],
      take: 20,
      select: { id: true, note: true, blocking: true, createdAt: true, raisedById: true, job: { select: { title: true, project: { select: { name: true } } } } },
    });
    const users = flags.length ? await db.user.findMany({ where: { id: { in: flags.map((f) => f.raisedById).filter(Boolean) as string[] } }, select: { id: true, name: true } }) : [];
    const nameOf = new Map(users.map((u) => [u.id, u.name]));
    return {
      problems: flags.map((f) => ({ id: f.id, what: f.note, job: f.job.title, project: f.job.project?.name ?? null, by: f.raisedById ? (nameOf.get(f.raisedById) ?? null) : null, when: f.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: actor.timezone }), workStopped: f.blocking })),
      note: flags.length ? null : "No open problems from site.",
    };
  },
};

const resolveProblem: WriteTool<{ flagId: string; resolution: string | null }, { flagId: string; resolution: string | null; words: string }> = {
  kind: "write",
  name: "resolve_problem",
  need: "projects.write",
  description: "Mark a problem flagged from site resolved, with a word on what was done (the id from site_problems). Use for: the subfloor is sorted, mark that resolved, we fixed the power.",
  params: z.object({ flagId: ID, resolution: z.string().max(300).nullable() }),
  payload: z.object({ flagId: ID, resolution: z.string().max(300).nullable(), words: z.string() }),
  async plan({ actor }, args) {
    const f = await db.jobFlag.findFirst({ where: { id: args.flagId, organizationId: actor.organizationId }, select: { id: true, note: true, status: true, job: { select: { title: true } } } });
    if (!f) return { ok: false, say: "I couldn't find that problem." };
    if (f.status === "RESOLVED") return { ok: false, say: "That one is resolved already." };
    const words = `Mark "${f.note.slice(0, 80)}" on ${f.job.title} resolved${args.resolution ? ` — ${args.resolution}` : ""}`;
    return { ok: true, payload: { flagId: f.id, resolution: args.resolution, words }, readback: `${words}? The project stops showing it.` };
  },
  async execute({ actor }, payload) {
    await resolveFlag(actor.organizationId, payload.flagId, payload.resolution, actor.userId);
    return { say: `Done — ${payload.words.replace(/^Mark /, "marked ")}.` };
  },
};

export const FIELD_TOOLS = [whoIsOnSite, siteProblems, resolveProblem] as const;
