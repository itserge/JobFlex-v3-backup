import "server-only";
// STAGES AND TASKS OF A PROJECT — the database half (the stages build, 2026-11-05). The rules are ./shared.ts.
//
//   · nextProjectNumber / numbered  — "#1042": each company counts from 1001 (a unique index keeps two writes apart).
//   · stagesFromTemplate            — a trade template's stages and tasks onto a project, after any it has.
//   · draftStagesWithAi             — the model drafts stages from the proposal lines when no template fits
//                                     (JSON only, checked with zod; null when the model is off or answers badly).
//   · projectForSoldProposal        — the automatic project: a sold proposal in no project, in a trade the company
//                                     has on (parseProjectSettings), gets a project, its stages, its job filed there.
//   · projectForJob                 — "Make it a project" on any job.
//   · stagesOf                      — the page's read: the stages with their tasks, in order, and the % done.

import { z } from "zod";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { getOpenAI, isOpenAIEnabled, resolveOpenAIModel, samplingOptions } from "@/lib/sdk/openai";
import { parseTradeTypes } from "@/lib/tradeTypes";
import { BUDGET_CATEGORIES } from "@/lib/projectBudget";
import { kindForTemplate, templatesFor, makesProject, parseProjectSettings, percentDone, proposalTrade, templateByKey, templateFor, type StageTemplate, type TemplateStage } from "./shared";
import { KIND_LABEL, kindOf, livingInPlaceTasks, onSiteStageIndex, parseAnswers, serializeAnswers } from "@/lib/projectKind";
import { INSPECTION_NAME, gateHolds, gateWords } from "@/lib/projectGates";
import { isPageLocked } from "@/lib/customPageAccess";

const FIRST_NUMBER = 1001;

type Tx = Prisma.TransactionClient;

/** The company's next project number: one past its highest, from 1001. */
export async function nextProjectNumber(tx: Tx | typeof db, organizationId: string): Promise<number> {
  const top = await tx.project.aggregate({ where: { organizationId }, _max: { number: true } });
  return Math.max(FIRST_NUMBER, (top._max.number ?? FIRST_NUMBER - 1) + 1);
}

/**
 * Create a project with its number. Two projects made in the same instant would draw the same number; the unique
 * index refuses the second, which tries again with the next one (three tries, then it is made unnumbered rather
 * than refused — the one-time numbering fills it later).
 */
export async function numbered<T extends { id: string; number: number | null }>(
  organizationId: string,
  create: (number: number | null) => Promise<T>,
): Promise<T> {
  for (let i = 0; i < 3; i++) {
    try {
      return await create(await nextProjectNumber(db, organizationId));
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
    }
  }
  return create(null);
}

/** What a created stage is told about its place (part 4, 2026-11-07): the phase it belongs to, the lane it is drawn
 *  in, and the stage it cannot start before (`prevId` is the stage created just before it in this call). */
export type StageMeta = (index: number, prevId: string | null) => { phaseId?: string | null; lane?: string | null; afterId?: string | null };

/** The stages of a template (or of a phase) onto a project, after any stages it already has, with their tasks; since
 *  part 3 (2026-11-07) the template's inspections land as gates on their stage, in the county's words
 *  (lib/projectGates; the first FINAL is the project's final inspection when it has none yet), and its selections as
 *  rows with their lead time (lib/projectSelections). Returns the created stages' ids, in order. Every door a template
 *  comes through (the card, the Operator, the automatic project, a new build's phases) ends here. */
export async function createStageRows(projectId: string, stages: readonly TemplateStage[], tx: Tx | typeof db = db, meta?: StageMeta): Promise<string[]> {
  const top = await tx.projectStage.aggregate({ where: { projectId }, _max: { position: true } });
  let position = (top._max.position ?? -1) + 1;
  const extras = stages.some((st) => st.inspections?.length || st.selections?.length);
  const org = extras ? await tx.project.findUnique({ where: { id: projectId }, select: { organizationId: true } }) : null;
  let hasFinal = extras ? (await tx.projectInspection.count({ where: { projectId, isFinal: true } })) > 0 : true;
  let selPos = extras ? ((await tx.projectSelection.aggregate({ where: { projectId }, _max: { position: true } }))._max.position ?? -1) + 1 : 0;
  const ids: string[] = [];
  for (const [i, st] of stages.entries()) {
    const m = meta ? meta(i, ids[ids.length - 1] ?? null) : {};
    const row = await tx.projectStage.create({
      data: { projectId, name: st.name.slice(0, 120), position: position++, weight: st.share > 0 ? st.share : 1, phaseId: m.phaseId ?? null, lane: m.lane ?? null, afterId: m.afterId ?? null },
      select: { id: true },
    });
    ids.push(row.id);
    if (st.tasks.length) {
      await tx.projectTask.createMany({
        data: st.tasks.map((task, k) => ({ projectId, stageId: row.id, title: task.title.slice(0, 200), position: k, photoNeeded: Boolean(task.photoNeeded) })),
      });
    }
    if (org && st.inspections?.length) {
      await tx.projectInspection.createMany({
        data: st.inspections.map((x) => {
          const isFinal = x.kind === "FINAL" && !hasFinal;
          if (isFinal) hasFinal = true;
          return { organizationId: org.organizationId, projectId, stageId: row.id, name: INSPECTION_NAME[x.kind], kind: x.kind, gate: x.gate !== false, isFinal };
        }),
      });
    }
    if (org && st.selections?.length) {
      await tx.projectSelection.createMany({
        data: st.selections.map((x) => ({ organizationId: org.organizationId, projectId, stageId: row.id, name: x.name.slice(0, 120), leadDays: Math.max(0, Math.round(x.leadDays)), position: selPos++ })),
      });
    }
  }
  return ids;
}

/** A template's stages onto a project (the count), see createStageRows. */
export async function stagesFromTemplate(projectId: string, stages: readonly TemplateStage[], tx: Tx | typeof db = db): Promise<number> {
  return (await createStageRows(projectId, stages, tx)).length;
}

/** The gating inspections still holding a stage (lib/projectGates), as the sentence a refused Done gets — null when
 *  nothing holds it. */
export async function stageHeldBy(stageId: string, stageName: string): Promise<string | null> {
  const rows = await db.projectInspection.findMany({ where: { stageId }, select: { name: true, result: true, date: true, gate: true } });
  const holding = gateHolds(rows.map((r) => ({ ...r, date: r.date ? r.date.toISOString().slice(0, 10) : null })));
  return holding.length ? gateWords(holding, stageName) : null;
}

/** A template's stages onto a project (2026-11-07): refused across kinds (a kitchen onto a new build); an occupied
 *  remodel's first on-site stage gets the living-in-place tasks it lacks; the template is remembered on the project
 *  (answersJson) for the budget's contingency rate. */
export async function addTemplate(project: { id: string; kind: string; answersJson: string | null }, key: string): Promise<{ added: number; template: StageTemplate }> {
  const tpl = templateByKey(key);
  if (!tpl) throw new Error("No such template");
  const kind = kindOf(project.kind);
  // A job project takes the trade templates; a remodel those and its own (2026-11-09, templatesFor).
  if (!templatesFor(kind).some((x) => x.key === tpl.key)) throw new Error(`${tpl.label} is a ${KIND_LABEL[tpl.kind].toLowerCase()} template; this project is a ${KIND_LABEL[kind].toLowerCase()}.`);
  const answers = parseAnswers(project.answersJson);
  let stages: readonly TemplateStage[] = tpl.stages;
  if (kind === "REMODEL" && answers.occupied) {
    const i = onSiteStageIndex(tpl.stages.map((s) => s.name));
    stages = tpl.stages.map((st, k) => (k === i ? { ...st, tasks: [...livingInPlaceTasks(st.tasks.map((x) => x.title)).map((title) => ({ title })), ...st.tasks] } : st));
  }
  const added = await stagesFromTemplate(project.id, stages);
  await db.project.update({ where: { id: project.id }, data: { answersJson: serializeAnswers({ ...answers, template: tpl.key }) } });
  return { added, template: tpl };
}

// ── the AI draft ─────────────────────────────────────────────────────────────

const draftSchema = z.object({
  stages: z
    .array(
      z.object({
        name: z.string().min(2).max(60),
        share: z.number().min(0).max(1),
        tasks: z.array(z.object({ title: z.string().min(2).max(120), photoNeeded: z.boolean().optional() })).max(8),
      }),
    )
    .min(2)
    .max(9),
});

function replyObject(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    const a = text.indexOf("{");
    const b = text.lastIndexOf("}");
    if (a >= 0 && b > a) {
      try {
        return JSON.parse(text.slice(a, b + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Stages drafted from what was sold: the proposal's title, scope and lines. The model answers JSON only; a bad
 * answer, or no model, is null and the project is left for the owner to stage by hand.
 */
export async function draftStagesWithAi(input: { name: string; scope: string | null; lines: string[]; trade: string | null }): Promise<StageTemplate | null> {
  if (!isOpenAIEnabled()) return null;
  try {
    const client = getOpenAI();
    const model = await resolveOpenAIModel();
    const system = [
      "You plan the order of work for a small construction or remodeling company's project. Answer with JSON only:",
      '{"stages":[{"name":"Footings","share":0.15,"tasks":[{"title":"Dig and pour the footings","photoNeeded":true}]}]}',
      "Rules: 3 to 7 stages in the order the work happens, each a short name (2 to 4 words), 2 to 5 tasks each, one short",
      "task per line of work. share = that stage's share of the whole job's cost, all shares adding to 1. photoNeeded",
      "true only where a photo proves the work before it is covered (footings, waterproofing, rough-in). The last stage",
      "ends with the final walk-through and collecting the final payment. Plain words, no numbers invented, nothing",
      "the proposal does not sell.",
    ].join(" ");
    const user = [`PROJECT: ${input.name}`, input.trade ? `TRADE: ${input.trade}` : "", input.scope ? `SCOPE: ${input.scope.slice(0, 1200)}` : "", input.lines.length ? `LINES:\n${input.lines.slice(0, 40).join("\n")}` : ""]
      .filter(Boolean)
      .join("\n\n");
    const completion = await client.chat.completions.create({
      model,
      ...(await samplingOptions(0)),
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
    });
    const parsed = draftSchema.safeParse(replyObject(completion.choices[0]?.message?.content ?? ""));
    if (!parsed.success) return null;
    const total = parsed.data.stages.reduce((n, s) => n + s.share, 0);
    return {
      key: "ai",
      label: "Drafted by AI",
      // The draft reads a sold proposal's lines: remodel work.
      kind: "REMODEL",
      stages: parsed.data.stages.map((s) => ({ name: s.name, share: total > 0 ? s.share / total : 1, tasks: s.tasks.map((x) => ({ title: x.title, photoNeeded: Boolean(x.photoNeeded) })) })),
    };
  } catch (err) {
    console.warn(`[projectStages] AI draft failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

// ── the automatic project ────────────────────────────────────────────────────

const proposalSelect = {
  id: true,
  organizationId: true,
  title: true,
  scopeOfWork: true,
  trade: true,
  status: true,
  projectId: true,
  clientId: true,
  total: true,
  client: { select: { name: true } },
  lineItems: { select: { name: true, quantity: true, materialCost: true, laborCost: true, total: true }, orderBy: { position: "asc" as const } },
  organization: { select: { tradeTypesJson: true, projectSettingsJson: true } },
} satisfies Prisma.ProposalSelect;

type SoldProposal = Prisma.ProposalGetPayload<{ select: typeof proposalSelect }>;

/** The cost budget a sold proposal implies: its lines' material and labor costs, when they are a real split under the price. */
function costOf(p: SoldProposal): number {
  const cost = p.lineItems.reduce((n, l) => n + Math.max(0, l.materialCost) + Math.max(0, l.laborCost), 0);
  return cost > 0 && cost < p.total ? Math.round(cost * 100) / 100 : 0;
}

/** "Smith — Composite deck": the client's name in front unless the title already carries it. */
function projectName(p: { title: string; client: { name: string } | null }): string {
  const client = p.client?.name?.trim() ?? "";
  if (!client) return p.title.slice(0, 120);
  const last = client.split(/\s+/).pop()?.toLowerCase() ?? "";
  if (last && p.title.toLowerCase().includes(last)) return p.title.slice(0, 120);
  return `${client} — ${p.title}`.slice(0, 120);
}

/**
 * A project for a proposal that just sold, when the company's Automatic projects say so. Idempotent: a proposal
 * already in a project is left there (its job is filed there by jobFromProposal). Returns the project id, or null
 * when no project was made. Never throws into the accept path: a failure is logged and the sale stands.
 */
export async function projectForSoldProposal(proposalId: string, actorId: string | null = null): Promise<string | null> {
  try {
    const p = await db.proposal.findUnique({ where: { id: proposalId }, select: proposalSelect });
    if (!p || p.projectId) return null;
    if (!["ACCEPTED", "COMPLETED", "PAID"].includes(p.status)) return null;
    const settings = parseProjectSettings(p.organization.projectSettingsJson);
    const orgTrades = parseTradeTypes(p.organization.tradeTypesJson);
    const trade = proposalTrade({ estimator: p.trade, title: p.title, scope: p.scopeOfWork, orgTrades });
    if (!makesProject(settings, trade)) return null;
    // Automatic projects are a project tool (owner, 2026-11-09): none on the Free plan — the company's plan decides,
    // whoever accepted the proposal (a client on the public page has no session).
    if (await isPageLocked(p.organizationId, "project-tools", { as: null })) return null;
    return await makeProject(p, { actorId, orgTrades, trade });
  } catch (err) {
    console.warn(`[projectStages] automatic project for ${proposalId} failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** "Make it a project" on a job (its proposal's project, or a bare one for a job with no proposal). */
export async function projectForJob(organizationId: string, jobId: string, actorId: string | null): Promise<{ id: string; created: boolean }> {
  const job = await db.job.findFirst({ where: { id: jobId, organizationId }, select: { id: true, title: true, projectId: true, proposalId: true, clientId: true, client: { select: { name: true } } } });
  if (!job) throw new Error("Job not found");
  if (job.projectId) return { id: job.projectId, created: false };
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { tradeTypesJson: true } });
  const orgTrades = parseTradeTypes(org?.tradeTypesJson);
  if (job.proposalId) {
    const p = await db.proposal.findUnique({ where: { id: job.proposalId }, select: proposalSelect });
    if (p) {
      if (p.projectId) {
        await db.job.update({ where: { id: job.id }, data: { projectId: p.projectId } });
        return { id: p.projectId, created: false };
      }
      const id = await makeProject(p, { actorId, orgTrades, trade: proposalTrade({ estimator: p.trade, title: p.title, scope: p.scopeOfWork, orgTrades }) });
      return { id, created: true };
    }
  }
  // A job with no proposal says only its title; the company's trade is not read for it (a gutter repair would
  // get a roofer's roof stages) — the owner picks a template or lets the AI draft.
  const tpl = templateFor({ title: job.title });
  const project = await numbered(organizationId, (number) =>
    db.project.create({ data: { organizationId, number, name: projectName({ title: job.title, client: job.client }), clientId: job.clientId, status: "ACTIVE", kind: kindForTemplate(tpl) }, select: { id: true, number: true } }),
  );
  await db.job.update({ where: { id: job.id }, data: { projectId: project.id } });
  if (tpl) await stagesFromTemplate(project.id, tpl.stages);
  await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.PROJECT, summary: `Made the project ${projectName({ title: job.title, client: job.client })} from the job`, clientId: job.clientId, meta: { projectId: project.id, jobId: job.id } });
  return { id: project.id, created: true };
}

async function makeProject(p: SoldProposal, ctx: { actorId: string | null; orgTrades: string[]; trade: string | null }): Promise<string> {
  const name = projectName(p);
  const budget = costOf(p);
  // The stages' template, read first so the project lands in its workspace (2026-11-09): a trade's sale is a job
  // project, a kitchen or a bath a remodel.
  const tpl = templateFor({ estimator: p.trade, title: p.title, scope: p.scopeOfWork, orgTrades: ctx.orgTrades });
  const project = await numbered(p.organizationId, (number) =>
    db.project.create({
      data: { organizationId: p.organizationId, number, name, clientId: p.clientId, status: "ACTIVE", budget, kind: kindForTemplate(tpl) },
      select: { id: true, number: true },
    }),
  );
  // The budget in the two halves the proposal was priced in (2026-11-06): the Budget card opens on Materials and
  // Labor, and splitting it further starts from them instead of six empty boxes.
  if (budget > 0) {
    const halves = [
      { category: "MATERIALS" as const, amount: p.lineItems.reduce((n, l) => n + Math.max(0, l.materialCost), 0) },
      { category: "LABOR" as const, amount: p.lineItems.reduce((n, l) => n + Math.max(0, l.laborCost), 0) },
    ].filter((h) => h.amount > 0);
    if (halves.length) {
      await db.projectBudgetLine.createMany({ data: halves.map((h) => ({ projectId: project.id, category: h.category, amount: Math.round(h.amount * 100) / 100, position: BUDGET_CATEGORIES.indexOf(h.category) })) });
    }
  }
  // The proposal and its job (when the accept already made one) are filed under it.
  await db.proposal.update({ where: { id: p.id }, data: { projectId: project.id } });
  await db.job.updateMany({ where: { proposalId: p.id, organizationId: p.organizationId, projectId: null }, data: { projectId: project.id } });
  // The stages: a trade template, else the model's draft (kept as "drafted" until someone keeps or edits it).
  let how = "no stages yet";
  if (tpl) {
    await stagesFromTemplate(project.id, tpl.stages);
    how = `${tpl.stages.length} stages (${tpl.label})`;
  } else {
    const draft = await draftStagesWithAi({ name, scope: p.scopeOfWork, lines: p.lineItems.map((l) => `${l.name} × ${l.quantity}`), trade: ctx.trade });
    if (draft) {
      await stagesFromTemplate(project.id, draft.stages);
      await db.project.update({ where: { id: project.id }, data: { stagesDraftedAt: new Date() } });
      how = `${draft.stages.length} stages drafted by AI`;
    }
  }
  await logActivity({
    organizationId: p.organizationId,
    actorId: ctx.actorId,
    kind: TRAIL_KINDS.PROJECT,
    summary: `Made the project ${name}${project.number ? ` (#${project.number})` : ""} from the sold proposal — ${how}`,
    proposalId: p.id,
    clientId: p.clientId,
    meta: { projectId: project.id, budget },
  });
  return project.id;
}

// ── marking (the page's actions and the Operator share these) ────────────────

/** A stage planned → in progress → done, and back. Done ticks its open tasks. Checked against the company. */
export async function markStage(organizationId: string, stageId: string, status: "PLANNED" | "ACTIVE" | "DONE", actorId: string | null): Promise<{ projectId: string; projectName: string; name: string; changed: boolean }> {
  const s = await db.projectStage.findFirst({ where: { id: stageId, project: { organizationId } }, select: { id: true, name: true, status: true, projectId: true, project: { select: { name: true, clientId: true } } } });
  if (!s) throw new Error("Stage not found");
  // The gate (part 3, 2026-11-07): a stage with an inspection that has not passed cannot be marked done.
  if (status === "DONE") {
    const held = await stageHeldBy(s.id, s.name);
    if (held) throw new Error(held);
  }
  const now = new Date();
  await db.projectStage.update({ where: { id: s.id }, data: { status, doneAt: status === "DONE" ? now : null, doneById: status === "DONE" ? actorId : null } });
  if (status === "DONE") await db.projectTask.updateMany({ where: { stageId: s.id, doneAt: null }, data: { doneAt: now, doneById: actorId } });
  await db.project.updateMany({ where: { id: s.projectId, stagesDraftedAt: { not: null } }, data: { stagesDraftedAt: null } });
  if (status !== s.status) {
    await logActivity({
      organizationId,
      actorId,
      kind: TRAIL_KINDS.PROJECT,
      summary: status === "DONE" ? `${s.name} done on ${s.project.name}` : status === "ACTIVE" ? `Started ${s.name} on ${s.project.name}` : `Reopened ${s.name} on ${s.project.name}`,
      clientId: s.project.clientId,
      meta: { projectId: s.projectId, stageId: s.id, status },
    });
  }
  return { projectId: s.projectId, projectName: s.project.name, name: s.name, changed: status !== s.status };
}

/** Tick or untick a task. The last tick of a stage marks it done — unless a gating inspection still holds the stage
 *  (part 3): then it stays in progress and `held` says what must pass; an untick on a done stage reopens it; the
 *  first tick starts a planned one. */
export async function markTask(organizationId: string, taskId: string, done: boolean, actorId: string | null): Promise<{ projectId: string; projectName: string; title: string; stageDone: boolean; held: string | null }> {
  const t = await db.projectTask.findFirst({ where: { id: taskId, project: { organizationId } }, select: { id: true, title: true, projectId: true, stageId: true, stage: { select: { status: true, name: true } }, project: { select: { name: true } } } });
  if (!t) throw new Error("Task not found");
  const now = new Date();
  await db.projectTask.update({ where: { id: t.id }, data: { doneAt: done ? now : null, doneById: done ? actorId : null } });
  const open = await db.projectTask.count({ where: { stageId: t.stageId, doneAt: null } });
  let stageDone = false;
  let held: string | null = null;
  if (done && open === 0 && t.stage.status !== "DONE") {
    held = await stageHeldBy(t.stageId, t.stage.name);
    if (held) {
      if (t.stage.status === "PLANNED") await db.projectStage.update({ where: { id: t.stageId }, data: { status: "ACTIVE" } });
    } else {
      await db.projectStage.update({ where: { id: t.stageId }, data: { status: "DONE", doneAt: now, doneById: actorId } });
      stageDone = true;
    }
  } else if (!done && t.stage.status === "DONE") {
    await db.projectStage.update({ where: { id: t.stageId }, data: { status: "ACTIVE", doneAt: null, doneById: null } });
  } else if (done && t.stage.status === "PLANNED") {
    await db.projectStage.update({ where: { id: t.stageId }, data: { status: "ACTIVE" } });
  }
  await db.project.updateMany({ where: { id: t.projectId, stagesDraftedAt: { not: null } }, data: { stagesDraftedAt: null } });
  return { projectId: t.projectId, projectName: t.project.name, title: t.title, stageDone, held };
}

/**
 * "Collect the final payment" ticks itself when the money is in (2026-11-06): once a proposal is paid in full and no
 * other sold proposal on its project still owes, the project's open final-payment tasks are done. Called after every
 * settled payment (lib/payments/settle); never throws into it.
 */
export async function tickFinalPayment(proposalId: string): Promise<number> {
  try {
    const p = await db.proposal.findUnique({ where: { id: proposalId }, select: { projectId: true, organizationId: true } });
    if (!p?.projectId) return 0;
    const owing = await db.proposal.count({ where: { projectId: p.projectId, status: { in: ["ACCEPTED", "COMPLETED"] } } });
    if (owing > 0) return 0;
    const tasks = await db.projectTask.findMany({ where: { projectId: p.projectId, doneAt: null, title: { startsWith: "Collect the final payment" } }, select: { id: true } });
    for (const t of tasks) await markTask(p.organizationId, t.id, true, null);
    return tasks.length;
  } catch (err) {
    console.warn(`[projectStages] final payment tick for ${proposalId} failed: ${err instanceof Error ? err.message : String(err)}`);
    return 0;
  }
}

// ── the read ─────────────────────────────────────────────────────────────────

export type StageRow = {
  id: string;
  name: string;
  position: number;
  status: string;
  /** ISO days (UTC midnight), or null. */
  startsAt: string | null;
  endsAt: string | null;
  doneAt: string | null;
  weight: number;
  tasks: Array<{ id: string; title: string; position: number; photoNeeded: boolean; done: boolean; doneAt: string | null }>;
  /** The inspections that gate the stage (part 3): it cannot be marked done until each has PASSED. */
  gates?: Array<{ id: string; name: string; result: string; date: string | null }>;
  /** A new build (part 4): the phase the stage belongs to, the lane it is drawn in, the stage it cannot start before. */
  phaseId?: string | null;
  lane?: string | null;
  afterId?: string | null;
};

/** A project's stages with their tasks, in order, and what they add up to. */
export async function stagesOf(projectId: string): Promise<{ stages: StageRow[]; done: number | null }> {
  const [rows, gates] = await Promise.all([
    db.projectStage.findMany({
      where: { projectId },
      orderBy: { position: "asc" },
      include: { tasks: { orderBy: { position: "asc" }, select: { id: true, title: true, position: true, photoNeeded: true, doneAt: true } } },
    }),
    db.projectInspection.findMany({ where: { projectId, gate: true, stageId: { not: null } }, orderBy: [{ date: "asc" }, { createdAt: "asc" }], select: { id: true, name: true, result: true, date: true, stageId: true } }),
  ]);
  const stages: StageRow[] = rows.map((s) => ({
    id: s.id,
    name: s.name,
    position: s.position,
    status: s.status,
    startsAt: s.startsAt ? s.startsAt.toISOString() : null,
    endsAt: s.endsAt ? s.endsAt.toISOString() : null,
    doneAt: s.doneAt ? s.doneAt.toISOString() : null,
    weight: s.weight,
    tasks: s.tasks.map((t) => ({ id: t.id, title: t.title, position: t.position, photoNeeded: t.photoNeeded, done: Boolean(t.doneAt), doneAt: t.doneAt ? t.doneAt.toISOString() : null })),
    gates: gates.filter((g) => g.stageId === s.id).map((g) => ({ id: g.id, name: g.name, result: g.result, date: g.date ? g.date.toISOString().slice(0, 10) : null })),
    phaseId: s.phaseId,
    lane: s.lane,
    afterId: s.afterId,
  }));
  return { stages, done: percentDone(stages) };
}
