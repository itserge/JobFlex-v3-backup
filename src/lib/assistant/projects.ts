import "server-only";
// PROJECTS FOR THE AI OPERATOR (the stages build, 2026-11-05) — "What's happening with Smith's deck?", "Mark
// footings done", "Log that the joists are set". One read tool and two writes, each a thin call into what the
// project page already runs (lib/projectStages): the Operator never computes a percent of its own, and a change
// is read back for a yes like every other (lib/assistant/tools).

import { z } from "zod";
import { db } from "@/lib/db";
import type { ReadTool, WriteTool } from "@/lib/assistant/tools";
import { findClients, findProjects } from "@/lib/assistant/find";
import { dayWords, money, spanWords } from "@/lib/assistant/shared";
import { categoryLabel } from "@/lib/projectBudget";
import { projectMoney } from "@/lib/projectMoney";
import { markStage, markTask, stageHeldBy, stagesOf, type StageRow } from "@/lib/projectStages/server";
import { addTemplateOrPhases } from "@/lib/projectPhases/server";
import { answersWords, parseBuildAnswers, phasesFor, type BuildAnswers } from "@/lib/projectPhases/shared";
import { currentStage, lateStages, lateWords, percentDone, projectNo, templatesFor, type StageTemplate } from "@/lib/projectStages/shared";
import { KIND_LABEL, type ProjectKind } from "@/lib/projectKind";
import { createProjectAs } from "@/lib/projectCore";
import { enforcePlanLimit } from "@/lib/limitsEngine";
import { appBaseUrl } from "@/lib/appUrl";

const ID = z.string().min(1).max(64);

const dayOnly = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : null);

/** The project the person named: by id, else by words — several matches come back for the model to ask about. */
export async function projectNamed(organizationId: string, args: { projectId: string | null; query: string | null }) {
  const select = { id: true, number: true, name: true, status: true, client: { select: { name: true } }, stagesDraftedAt: true };
  if (args.projectId) {
    const p = await db.project.findFirst({ where: { id: args.projectId, organizationId }, select });
    return p ? { one: p } : { none: true as const };
  }
  if (args.query) {
    const found = await findProjects(organizationId, args.query);
    if (found.length === 1) return { one: await db.project.findFirst({ where: { id: found[0].id }, select }) };
    if (found.length > 1) return { several: found.map((p) => ({ id: p.id, number: p.number, name: p.name, client: p.client?.name ?? null })) };
  }
  return { none: true as const };
}

/** The stage the person named: "footings", "the framing", "decking and railings". The best word overlap wins. */
export function stageNamed(stages: StageRow[], words: string): StageRow | null {
  const q = words.toLowerCase().replace(/[^a-z0-9 ]/g, " ");
  const terms = q.split(/\s+/).filter((w) => w.length > 2 && !["the", "stage", "and", "done", "mark", "start", "finished", "finish"].includes(w));
  let best: { stage: StageRow; score: number } | null = null;
  for (const st of stages) {
    const name = st.name.toLowerCase();
    let score = name === q.trim() ? 100 : 0;
    for (const t of terms) if (name.includes(t)) score += t.length;
    if (score > 0 && (!best || score > best.score)) best = { stage: st, score };
  }
  return best?.stage ?? null;
}

const projectStatus: ReadTool<{ query: string | null; projectId: string | null }> = {
  kind: "read",
  name: "project_status",
  need: "projects.read",
  card: {
    "label": "Project status",
    "purpose": "Where a project stands: % done, the stage it is on, what is late, the money, its jobs and crew.",
    "when": "'What's happening with Smith's deck', 'how far along is the kitchen', 'is anything late', 'how much does Smith still owe on the project': project_status with the project id (find, kind project) or words from its name, client or number.",
    "objects": [
      "job",
      "client",
      "money"
    ],
    "effect": "read",
    "group": "projects",
    "version": 1,
    "since": "2026-11-05",
    "samples": [
      {
        "say": "how far along is the Smith kitchen?",
        "args": {
          "query": "Smith kitchen",
          "projectId": null
        }
      }
    ]
  },
  description:
    "Where a project stands: its number, % done, the stage it is on, every stage with its days, tasks and what is late, the money (contract, spent, margin, owed), its jobs and crew. Give the project id (from find, kind project) or words from its name, its client or its number. Use for: what's happening with Smith's deck, how far along is the kitchen, is anything late, how much does Smith still owe, what's next on the project.",
  params: z.object({ query: z.string().max(80).nullable().describe("words from the project's name, client or number; null when projectId is given"), projectId: ID.nullable() }),
  async run({ actor }, args) {
    const org = actor.organizationId;
    const tz = actor.timezone;
    const r = await projectNamed(org, args);
    if ("several" in r) return { several: r.several, ask: "Which one?" };
    if (!("one" in r) || !r.one) return { error: "No project matched. Try the client's name or the project's number." };
    const p = r.one;
    const [read, moneyAll, jobs] = await Promise.all([
      stagesOf(p.id),
      projectMoney(org, [p.id]),
      db.job.findMany({
        where: { projectId: p.id, status: { not: "CANCELED" } },
        select: { title: true, status: true, startsAt: true, endsAt: true, assignments: { select: { status: true, worker: { select: { displayName: true } } } } },
        orderBy: [{ startsAt: "asc" }, { createdAt: "asc" }],
        take: 12,
      }),
    ]);
    const m = moneyAll.get(p.id);
    const now = currentStage(read.stages);
    const late = lateStages(read.stages, new Date());
    return {
      id: p.id,
      number: projectNo(p.number) || null,
      name: p.name,
      client: p.client?.name ?? null,
      status: p.status,
      done: read.done != null ? `${read.done}%` : "no stages yet",
      stageNow: now?.name ?? (read.stages.length ? "all stages done" : null),
      late: late.map((x) => `${x.stage.name} ${lateWords(x.days)}`),
      draftedByAi: Boolean(p.stagesDraftedAt),
      stages: read.stages.map((s) => ({
        name: s.name,
        status: s.status.toLowerCase(),
        days: s.startsAt || s.endsAt ? [dayOnly(s.startsAt), dayOnly(s.endsAt)].filter(Boolean).join(" to ") : null,
        tasks: s.tasks.length ? `${s.tasks.filter((t) => t.done).length} of ${s.tasks.length} done` : null,
        tasksLeft: s.tasks.filter((t) => !t.done).slice(0, 6).map((t) => t.title),
      })),
      money: m
        ? { contract: money(m.contract), spent: money(m.spent), margin: m.margin != null ? money(m.margin) : null, marginState: m.marginState, owed: money(m.owed), collected: money(m.collected), overBudget: m.overCategories.map(categoryLabel) }
        : null,
      jobs: jobs.map((j) => ({
        title: j.title,
        status: j.status,
        when: j.startsAt && j.endsAt ? spanWords(j.startsAt, j.endsAt, tz) : j.startsAt ? dayWords(j.startsAt, tz) : "no dates yet",
        crew: j.assignments.map((a) => `${a.worker.displayName}${a.status === "ACCEPTED" ? "" : a.status === "DECLINED" ? " (declined)" : " (asked)"}`),
      })),
    };
  },
};

type StageArgs = { projectId: string; stage: string; status: "DONE" | "ACTIVE" | "PLANNED" };
type StagePayload = { stageId: string; status: "DONE" | "ACTIVE" | "PLANNED"; words: string };

const setStage: WriteTool<StageArgs, StagePayload> = {
  kind: "write",
  name: "set_stage",
  need: "projects.write",
  card: {
    "label": "Project stage",
    "purpose": "Mark a project's stage done, started or reopened.",
    "when": "'Footings are done', 'start the decking', 'reopen the tile': set_stage with the project id (find or project_status) and the stage as said.",
    "objects": [
      "job"
    ],
    "effect": "record",
    "group": "projects",
    "version": 1,
    "since": "2026-11-05",
    "samples": [
      {
        "say": "the footings on the Smith deck are done",
        "args": {
          "projectId": "proj_1",
          "stage": "footings",
          "status": "DONE"
        }
      }
    ]
  },
  description:
    "Mark a stage of a project DONE, started (ACTIVE) or reopened (PLANNED). Give the project id (from find or project_status) and the stage as the person said it ('footings', 'framing', 'decking'). Use for: footings are done, mark framing finished, start the decking, reopen the tile.",
  params: z.object({ projectId: ID, stage: z.string().min(2).max(80), status: z.enum(["DONE", "ACTIVE", "PLANNED"]) }),
  payload: z.object({ stageId: ID, status: z.enum(["DONE", "ACTIVE", "PLANNED"]), words: z.string() }),
  async plan({ actor }, args) {
    const p = await db.project.findFirst({ where: { id: args.projectId, organizationId: actor.organizationId }, select: { id: true, name: true, number: true } });
    if (!p) return { ok: false, say: "I couldn't find that project." };
    const read = await stagesOf(p.id);
    if (!read.stages.length) return { ok: false, say: `${p.name} has no stages yet — add them on the project page (a template, or Draft with AI).` };
    const st = stageNamed(read.stages, args.stage);
    if (!st) return { ok: false, say: `Which stage? ${p.name} has: ${read.stages.map((s) => s.name).join(", ")}.` };
    if (st.status === args.status) return { ok: false, say: `"${st.name}" is already ${args.status === "DONE" ? "done" : args.status === "ACTIVE" ? "in progress" : "planned"}.` };
    // The gate (part 3, 2026-11-07): an inspection on the stage that has not passed holds it.
    if (args.status === "DONE") {
      const held = await stageHeldBy(st.id, st.name);
      if (held) return { ok: false, say: `Not yet — ${held}` };
    }
    const after = percentDone(read.stages.map((s) => (s.id === st.id ? { ...s, status: args.status, tasks: args.status === "DONE" ? s.tasks.map((t) => ({ ...t, done: true })) : s.tasks } : s)));
    const verb = args.status === "DONE" ? "Mark" : args.status === "ACTIVE" ? "Start" : "Reopen";
    const tail = args.status === "DONE" ? " done" : "";
    const project = `${p.name}${p.number ? ` (#${p.number})` : ""}`;
    const words = `${verb} "${st.name}"${tail} on ${project}`;
    return {
      ok: true,
      payload: { stageId: st.id, status: args.status, words },
      readback: `${words}? Done goes from ${read.done ?? 0}% to ${after ?? 0}%.${args.status === "DONE" && st.tasks.some((t) => !t.done) ? " Its open tasks get ticked too." : ""}`,
    };
  },
  async execute({ actor }, payload) {
    const r = await markStage(actor.organizationId, payload.stageId, payload.status, actor.userId);
    const read = await stagesOf(r.projectId);
    const now = currentStage(read.stages);
    return { say: `Done — ${payload.words.replace(/^(Mark|Start|Reopen) /, (m) => m.toLowerCase())}. ${r.projectName} is ${read.done ?? 0}% done${now ? `, on ${now.name}` : ""}.`, result: r };
  },
};

type TaskArgs = { projectId: string; task: string; done: boolean };
type TaskPayload = { taskId: string; done: boolean; words: string };

const tickTask: WriteTool<TaskArgs, TaskPayload> = {
  kind: "write",
  name: "tick_task",
  need: "projects.write",
  card: {
    "label": "Project task",
    "purpose": "Tick or untick one task on a project; the last task ticked marks its stage done.",
    "when": "'Log that the joists are set', 'the permit is pulled', 'cabinets are ordered': tick_task with the project id and the task in their words.",
    "objects": [
      "job"
    ],
    "effect": "record",
    "group": "projects",
    "version": 1,
    "since": "2026-11-05",
    "samples": [
      {
        "say": "log that the permit is pulled on the Smith deck",
        "args": {
          "projectId": "proj_1",
          "task": "pull the permit",
          "done": true
        }
      }
    ]
  },
  description:
    "Tick (or untick) one task on a project, by its words ('joists', 'pull the permit', 'order cabinets'). Give the project id. Ticking the last task of a stage marks the stage done. Use for: log that the joists are set, the permit is pulled, cabinets are ordered.",
  params: z.object({ projectId: ID, task: z.string().min(2).max(120), done: z.boolean() }),
  payload: z.object({ taskId: ID, done: z.boolean(), words: z.string() }),
  async plan({ actor }, args) {
    const p = await db.project.findFirst({ where: { id: args.projectId, organizationId: actor.organizationId }, select: { id: true, name: true, number: true } });
    if (!p) return { ok: false, say: "I couldn't find that project." };
    const read = await stagesOf(p.id);
    const all = read.stages.flatMap((s) => s.tasks.map((t) => ({ ...t, stage: s })));
    if (!all.length) return { ok: false, say: `${p.name} has no tasks yet.` };
    const q = args.task.toLowerCase().replace(/[^a-z0-9 ]/g, " ");
    const terms = q.split(/\s+/).filter((w) => w.length > 2 && !["the", "that", "log", "tick", "done", "and", "are", "was", "were"].includes(w));
    let best: { t: (typeof all)[number]; score: number } | null = null;
    for (const t of all) {
      const title = t.title.toLowerCase();
      let score = 0;
      for (const w of terms) if (title.includes(w)) score += w.length;
      if (score > 0 && (!best || score > best.score)) best = { t, score };
    }
    if (!best) return { ok: false, say: `Which task? ${p.name}'s open tasks: ${all.filter((t) => !t.done).slice(0, 8).map((t) => t.title).join("; ")}.` };
    const t = best.t;
    if (t.done === args.done) return { ok: false, say: `"${t.title}" is already ${args.done ? "ticked" : "open"}.` };
    const lastOne = args.done && t.stage.tasks.filter((x) => !x.done && x.id !== t.id).length === 0;
    const held = lastOne ? await stageHeldBy(t.stage.id, t.stage.name) : null;
    const project = `${p.name}${p.number ? ` (#${p.number})` : ""}`;
    const words = `${args.done ? "Tick" : "Untick"} "${t.title}" (${t.stage.name}) on ${project}`;
    return { ok: true, payload: { taskId: t.id, done: args.done, words }, readback: `${words}?${lastOne ? (held ? ` That's the last task, but the stage stays open: ${held}` : ` That's the last one — ${t.stage.name} gets marked done.`) : ""}${t.photoNeeded && args.done ? " This task wants a photo; add it on the job page." : ""}` };
  },
  async execute({ actor }, payload) {
    const r = await markTask(actor.organizationId, payload.taskId, payload.done, actor.userId);
    const read = await stagesOf(r.projectId);
    return { say: `Done — ${payload.words.replace(/^(Tick|Untick) /, (m) => m.toLowerCase())}. ${r.projectName} is ${read.done ?? 0}% done.${r.held ? ` ${r.held}` : ""}`, result: r };
  },
};

// ── start a project (2026-11-07, the plan "Projects: Remodel and New construction", part 1) ───────────────────
// "Start a kitchen remodel for the Bennetts", "start a new build for Sarah Lee": the project is made the way the
// New project dialog makes it (lib/projectCore) and its stages come from the kind's template (addTemplate), after
// the person's yes. The client is found by name here, so the model needs no find first.

type StartArgs = { name: string; kind: ProjectKind; client: string | null; template: string | null; occupied: boolean | null; sewer: "SEWER" | "SEPTIC" | null; water: "WATER" | "WELL" | null; foundation: "SLAB" | "CRAWL" | "BASEMENT" | null; stories: 1 | 2 | null; garage: boolean | null; shop: boolean | null; lender: boolean | null; power: "AT_LOT" | "POLE" | null; gas: boolean | null; fiber: boolean | null };
type StartPayload = { name: string; kind: ProjectKind; clientId: string | null; clientName: string | null; template: string | null; occupied: boolean; build: BuildAnswers | null };

const buildArgs = {
  sewer: z.enum(["SEWER", "SEPTIC"]).nullable(),
  water: z.enum(["WATER", "WELL"]).nullable(),
  foundation: z.enum(["SLAB", "CRAWL", "BASEMENT"]).nullable(),
  stories: z.union([z.literal(1), z.literal(2)]).nullable(),
  garage: z.boolean().nullable(),
  shop: z.boolean().nullable(),
  lender: z.boolean().nullable(),
  power: z.enum(["AT_LOT", "POLE"]).nullable(),
  gas: z.boolean().nullable(),
  fiber: z.boolean().nullable(),
};
const buildPayload = z.object({ sewer: z.enum(["SEWER", "SEPTIC"]).optional(), water: z.enum(["WATER", "WELL"]).optional(), foundation: z.enum(["SLAB", "CRAWL", "BASEMENT"]).optional(), stories: z.union([z.literal(1), z.literal(2)]).optional(), garage: z.boolean().optional(), shop: z.boolean().optional(), lender: z.boolean().optional(), power: z.enum(["AT_LOT", "POLE"]).optional(), gas: z.boolean().optional(), fiber: z.boolean().optional() });

/** The template a word points at, within the kind: its key, its label, or a word of either; a new build's "house",
 *  "home" or "build" is the custom home. Null when nothing matches. */
export function templateNamed(kind: ProjectKind, word: string | null | undefined): StageTemplate | null {
  const w = (word ?? "").toLowerCase().trim();
  if (!w) return null;
  const list = templatesFor(kind);
  return (
    list.find((x) => x.key === w) ??
    list.find((x) => x.label.toLowerCase() === w) ??
    list.find((x) => x.label.toLowerCase().includes(w) || w.includes(x.key)) ??
    (kind === "NEW_BUILD" && /house|home|build|construction/.test(w) ? (list[0] ?? null) : null)
  );
}

const startProject: WriteTool<StartArgs, StartPayload> = {
  kind: "write",
  name: "start_project",
  need: "projects.write",
  card: {
    label: "Start a project",
    purpose: "Make a project — a remodel with its stages from a template, or a new build with its phases from the lot to the keys shaped by the start questions.",
    when: "'Start a kitchen remodel for the Bennetts', 'new project: Lee basement finish', 'start a new build for Sarah Lee on septic with a well and a basement': start_project(name, kind, client, template, occupied, + the lot's answers). kind is NEW_BUILD only when they say new construction, new build or a new house. template is the job's word (kitchen, bath, deck, roof, fence, floors, hvac, siding, remodel, addition, basement, whole house, adu, windows, painting, service; home for a new build) or null. occupied when they say the client lives there during the work. For a new build, the questions as said or null for each (sewer SEWER|SEPTIC, water WATER|WELL, foundation SLAB|CRAWL|BASEMENT, stories 1|2, garage, shop, lender, power AT_LOT|POLE, gas, fiber) — ASK about the lot one or two at a time when nothing was said, or go with the defaults when told to. The client is found by name here — no find first.",
    objects: ["project", "client"],
    effect: "record",
    group: "projects",
    version: 2,
    since: "2026-11-07",
    samples: [
      { say: "start a kitchen remodel for the Bennetts", args: { name: "Bennett kitchen remodel", kind: "REMODEL", client: "Bennett", template: "kitchen", occupied: null, sewer: null, water: null, foundation: null, stories: null, garage: null, shop: null, lender: null, power: null, gas: null, fiber: null } },
      { say: "start a new build for Sarah Lee, call it the Lee house — septic, a well, a basement, two stories, the bank is financing it", args: { name: "Lee house", kind: "NEW_BUILD", client: "Sarah Lee", template: "home", occupied: null, sewer: "SEPTIC", water: "WELL", foundation: "BASEMENT", stories: 2, garage: null, shop: null, lender: true, power: null, gas: null, fiber: null } },
    ],
  },
  description:
    "Make a project for a client: a REMODEL (the house stands) or a NEW_BUILD (a lot, then a house). name = what to call it; client = the client's name as said, or null; template = the job's word (kitchen, bath, deck, roof, fence, floors, hvac, siding, remodel, addition, basement, wholehouse, adu, windows, painting, service; home for a new build) or null to add the stages later; occupied = true when they say the client lives there during the work. A new build's phases (land → design → permits → site work → foundation → framing → rough-ins → drywall → finishes → keys) are shaped by the lot's answers: sewer, water, foundation, stories, garage, shop, lender, power, gas, fiber — each as said or null (the defaults: sewer and water at the street, a crawl space, one story, a garage, no shop, no lender, power at the lot, gas, no fiber; the read-back says them). Read back for a yes; the answer links the project page.",
  params: z.object({
    name: z.string().min(2).max(120),
    kind: z.enum(["REMODEL", "NEW_BUILD"]),
    client: z.string().max(120).nullable(),
    template: z.string().max(40).nullable(),
    occupied: z.boolean().nullable(),
    ...buildArgs,
  }),
  payload: z.object({
    name: z.string(),
    kind: z.enum(["REMODEL", "NEW_BUILD"]),
    clientId: z.string().nullable(),
    clientName: z.string().nullable(),
    template: z.string().nullable(),
    occupied: z.boolean(),
    build: buildPayload.nullable(),
  }),
  async plan({ actor }, a) {
    try {
      await enforcePlanLimit(actor.organizationId, "projects", 1, { actorId: actor.userId });
    } catch (err) {
      const m = err instanceof Error ? err.message : "";
      return { ok: false, say: /limit/i.test(m) ? "Your plan's project limit is reached for this month — the Billing page has the plans." : m || "The project can't be started right now." };
    }
    let clientId: string | null = null;
    let clientName: string | null = null;
    const who = a.client?.trim() ?? "";
    if (who) {
      const found = await findClients(actor.organizationId, who);
      if (!found.length) return { ok: false, say: `I don't see a client named ${who}. Add them first, or start the project without one.` };
      if (found.length > 1) return { ok: false, say: `Several clients match ${who}: ${found.slice(0, 4).map((c) => c.name).join(", ")}. Which one?` };
      clientId = found[0].id;
      clientName = found[0].name;
    }
    const tpl = templateNamed(a.kind, a.template);
    if (a.template && !tpl) return { ok: false, say: `There is no ${KIND_LABEL[a.kind].toLowerCase()} template called ${a.template}; the stages can be added on the project page.` };
    const occupied = a.kind === "REMODEL" && a.occupied === true;
    const name = a.name.trim();
    // A new build's start questions (part 4): what was said; the defaults fill the rest and are read back.
    const build: BuildAnswers | null = a.kind === "NEW_BUILD" ? parseBuildAnswers({ sewer: a.sewer ?? undefined, water: a.water ?? undefined, foundation: a.foundation ?? undefined, stories: a.stories ?? undefined, garage: a.garage ?? undefined, shop: a.shop ?? undefined, lender: a.lender ?? undefined, power: a.power ?? undefined, gas: a.gas ?? undefined, fiber: a.fiber ?? undefined }) : null;
    const phasesWords = a.kind === "NEW_BUILD" && tpl ? ` — ${phasesFor(build).length} phases from the lot to the keys: ${answersWords(build)}` : "";
    const readback = `Start the ${KIND_LABEL[a.kind].toLowerCase()} project "${name}"${clientName ? ` for ${clientName}` : ""}${tpl ? (a.kind === "NEW_BUILD" ? phasesWords : `, with the ${tpl.label} stages (${tpl.stages.length})`) : ", stages to be added"}${occupied ? " — the client lives there during the work" : ""}.${a.kind === "NEW_BUILD" && tpl && build && Object.keys(build).length < 10 ? " Say otherwise on anything not said; I went with the usual." : ""}`;
    return { ok: true, payload: { name, kind: a.kind, clientId, clientName, template: tpl?.key ?? null, occupied, build }, readback };
  },
  async execute({ actor }, p) {
    const made = await createProjectAs({ organizationId: actor.organizationId, actorId: actor.userId }, { name: p.name, clientId: p.clientId, kind: p.kind, occupied: p.occupied, build: p.build ?? undefined });
    let stages = "";
    if (p.template) {
      const row = await db.project.findUnique({ where: { id: made.id }, select: { id: true, organizationId: true, kind: true, answersJson: true } });
      const r = await addTemplateOrPhases(row ?? { id: made.id, organizationId: actor.organizationId, kind: p.kind, answersJson: null }, p.template);
      stages = r.phases ? ` with its ${r.phases} phases and ${r.added} stages` : ` with the ${r.template.label} stages (${r.added})`;
    }
    const link = `${(await appBaseUrl()).replace(/\/$/, "")}/dashboard/projects/${made.id}`;
    return { say: `Started ${projectNo(made.number)} ${made.name}${p.clientName ? ` for ${p.clientName}` : ""}${stages}. Open it: ${link}`, result: { projectId: made.id, number: made.number } };
  },
};

export const PROJECT_TOOLS = [projectStatus, setStage, tickTask, startProject] as const;
