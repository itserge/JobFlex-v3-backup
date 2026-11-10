import "server-only";
// THE AI OPERATOR AND THE PROJECT OVERVIEW (Project Overview part 3, 2026-11-09): two reads over the same Overview the
// project page shows (lib/projectOverview), so what the Operator says matches the screen —
//   project_overview   "what's going on with the Lee house?", "what's holding up framing on the Lee house?"
//   projects_overview  "what do I need to do this week?", "which projects are behind / over budget / at risk?"
// A numbered to-do list is kept as the person's numbered replies (lib/assistant/projectsBrief savePicks), so "1" or
// "do the first one" runs that row's step with the usual read-back (lib/assistant/engine planPick).
import { z } from "zod";
import type { ReadTool } from "@/lib/assistant/tools";
import { dayOf } from "@/lib/assistant/shared";
import { projectNamed, stageNamed } from "@/lib/assistant/projects";
import { orgOverviews, savePicks } from "@/lib/assistant/projectsBrief";
import { loadProjectRules } from "@/components/v3/project-detail-blueprint/project-detail-load";
import { readSnoozes, readSnoozesFor } from "@/lib/projectOverview/server";
import { holdupOf } from "@/lib/projectOverview/shared";
import { boardAnswer, holdupAnswer, overviewAnswer, weekAnswer, type BoardAsk } from "@/lib/projectOverview/operator";

const ID = z.string().min(1).max(64);

type OneArgs = { query: string | null; projectId: string | null; stage: string | null };

const projectOverview: ReadTool<OneArgs> = {
  kind: "read",
  name: "project_overview",
  need: "projects.read",
  card: {
    label: "Project overview",
    purpose: "One project's Overview: at risk, needs you or on track, the to-do list numbered, the next 14 days, who waits on whom, the money — or what holds one stage up.",
    when: "'What's going on with the Lee house', 'what do I need to do on the Smith kitchen', 'what's late on it', 'what's next', 'what's holding up framing on the Lee house': project_overview with the project id (find, kind project) or words from its name; the stage as said for 'what's holding up …'. Show its to-do list with the numbers as given — a number or 'do the first one' then runs that row.",
    objects: ["project", "money"],
    effect: "read",
    group: "projects",
    version: 1,
    since: "2026-11-09",
    samples: [
      { say: "what's going on with the Lee house?", args: { query: "Lee house", projectId: null, stage: null } },
      { say: "what's holding up framing on the Lee house?", args: { query: "Lee house", projectId: null, stage: "framing" } },
    ],
  },
  description:
    "One project's Overview, the same as the top of its page: the status (At risk / Needs you / On track) with days behind and dollars over, one sentence, the to-do list worst first and NUMBERED (each with what a reply does), the next 14 days (what each stage still needs before it starts), who waits on whom, the money (budget, spent, signed not paid, heading for, contract, margin, paid, owed), what happened last. With a stage ('framing', 'rough-in'): what holds that stage up — inspections not passed, what it still needs, tasks left, the crew stuck. Give the project id (from find, kind project) or words from its name, client or number. Use for: what's going on with X, what do I need to do on X, what's late or next on X, what's holding up <stage>. Show the to-do numbers exactly as given: the person can answer with a number, or 'do the first one', and that row's step runs.",
  params: z.object({
    query: z.string().max(80).nullable().describe("words from the project's name, client or number; null when projectId is given"),
    projectId: ID.nullable(),
    stage: z.string().max(80).nullable().describe("the stage as said, for 'what's holding up …'; null for the whole project"),
  }),
  async run({ actor, now }, args) {
    const org = actor.organizationId;
    const r = await projectNamed(org, { query: args.query, projectId: args.projectId });
    if ("several" in r) return { several: r.several, ask: "Which one?" };
    if (!("one" in r) || !r.one) return { error: "No project matched. Try the client's name or the project's number." };
    const read = await loadProjectRules(r.one.id, org);
    if (!read) return { error: "That project couldn't be read just now." };
    const p = { id: r.one.id, name: r.one.name };
    if (args.stage) {
      const st = stageNamed(read.props.stages.stages, args.stage);
      if (!st) return { error: `No stage like "${args.stage}" on ${p.name}.`, stages: read.props.stages.stages.map((s) => s.name) };
      const h = holdupOf(read.input, st.id);
      return h ? holdupAnswer(p, h) : { error: "That stage couldn't be read just now." };
    }
    const snoozes = await readSnoozes(org, actor.userId, p.id).catch(() => ({}));
    const a = overviewAnswer(p, read.props.overview, snoozes);
    await savePicks(org, actor.userId, dayOf(now, actor.timezone), a.picks).catch(() => undefined);
    return a.answer;
  },
};

type ManyArgs = { ask: BoardAsk | "week" };

const projectsOverview: ReadTool<ManyArgs> = {
  kind: "read",
  name: "projects_overview",
  need: "projects.read",
  card: {
    label: "Projects overview",
    purpose: "Every open project at once: this week's to-do list numbered across projects with what starts, or which projects are behind, over budget, at risk or need you.",
    when: "'What do I need to do this week', 'what's on my plate on the projects': projects_overview ask week. 'Which projects are behind' → behind; 'over budget' → over_budget; 'at risk' → at_risk; 'which need me' → needs_me; 'how are my projects' → all. Show a to-do list with its numbers as given.",
    objects: ["project", "money"],
    effect: "read",
    group: "projects",
    version: 1,
    since: "2026-11-09",
    samples: [
      { say: "what do I need to do this week?", args: { ask: "week" } },
      { say: "which projects are over budget?", args: { ask: "over_budget" } },
    ],
  },
  description:
    "Every open project's Overview at once (the newest 20). ask week: the to-do list across projects, NUMBERED, the worst project first and every urgent row before the rest (each with what a reply does), and what starts, arrives or is inspected in the next 7 days with what's missing. ask behind / over_budget / at_risk / needs_me / all: a short list of those projects worst first, with days behind, dollars over, where each stands and its first to-do. Use for: what do I need to do this week, which projects are behind, which are over budget, which are at risk, how are my projects. Show the to-do numbers exactly as given: a number or 'do the first one' runs that row's step.",
  params: z.object({ ask: z.enum(["week", "behind", "over_budget", "at_risk", "needs_me", "all"]) }),
  async run({ actor, now }, args) {
    const org = actor.organizationId;
    const list = await orgOverviews(org);
    if (!list.length) return { note: "No open projects." };
    const today = dayOf(now, actor.timezone);
    const snoozes = await readSnoozesFor(org, actor.userId, list.map((x) => x.id), today).catch(() => new Map());
    const withSnoozes = list.map((x) => ({ ...x, snoozes: snoozes.get(x.id) ?? {} }));
    if (args.ask !== "week") return boardAnswer(withSnoozes, args.ask);
    const a = weekAnswer(withSnoozes, today);
    await savePicks(org, actor.userId, today, a.picks).catch(() => undefined);
    return a.answer;
  },
};

export const OVERVIEW_TOOLS = [projectOverview, projectsOverview] as const;
