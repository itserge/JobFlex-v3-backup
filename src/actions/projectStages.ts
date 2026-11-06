"use server";
// STAGES AND TASKS OF A PROJECT — the writes (the stages build, 2026-11-05). Projects are estimators' and
// managers' (actions/projects), so every write here is requireEstimatorOrManager; every row is checked against
// the caller's company through its project. The rules are lib/projectStages/shared, the database work
// lib/projectStages/server.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireEstimatorOrManager } from "@/lib/orgContext";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { draftStagesWithAi, markStage, markTask, projectForJob, stagesFromTemplate } from "@/lib/projectStages/server";
import { PROJECT_TRADES_DEFAULT, parseProjectSettings, templateByKey, type ProjectSettings } from "@/lib/projectStages/shared";
import { TRADE_TYPES, type TradeType } from "@/lib/tradeTypes";

const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();

/** The project, when it is the caller's. */
async function projectOf(organizationId: string, projectId: string) {
  const p = await db.project.findFirst({ where: { id: projectId, organizationId }, select: { id: true, name: true, clientId: true, stagesDraftedAt: true } });
  if (!p) throw new Error("Project not found");
  return p;
}

async function stageOf(organizationId: string, stageId: string) {
  const s = await db.projectStage.findFirst({ where: { id: stageId, project: { organizationId } }, select: { id: true, name: true, status: true, projectId: true, position: true, project: { select: { name: true, clientId: true } } } });
  if (!s) throw new Error("Stage not found");
  return s;
}

function touched(projectId: string) {
  revalidatePath("/dashboard/projects");
  revalidatePath(`/dashboard/projects/${projectId}`);
  revalidatePath(`/mobile-project-detail-v2/${projectId}`);
}

/** Any edit by a person keeps an AI draft: the "drafted" notice goes. */
async function keptByEdit(projectId: string) {
  await db.project.updateMany({ where: { id: projectId, stagesDraftedAt: { not: null } }, data: { stagesDraftedAt: null } });
}

/** A day typed in the form → UTC midnight, like Project.startsAt (read back by the page as a local day). */
const dayOf = (s: string | null | undefined) => (s ? new Date(`${s}T00:00:00.000Z`) : null);

// ── stages from a template, or drafted ──────────────────────────────────────

export async function addStagesFromTemplate(projectId: string, key: string): Promise<{ added: number }> {
  const { organizationId, user } = await requireEstimatorOrManager();
  const p = await projectOf(organizationId, projectId);
  const tpl = templateByKey(key);
  if (!tpl) throw new Error("No such template");
  const added = await stagesFromTemplate(p.id, tpl.stages);
  await keptByEdit(p.id);
  await logActivity({ organizationId, actorId: user.id, kind: TRAIL_KINDS.PROJECT, summary: `Added the ${tpl.label} stages to ${p.name}`, clientId: p.clientId, meta: { projectId: p.id, template: key } });
  touched(p.id);
  return { added };
}

export async function draftStages(projectId: string): Promise<{ added: number } | { error: string }> {
  const { organizationId, user } = await requireEstimatorOrManager();
  const p = await db.project.findFirst({
    where: { id: projectId, organizationId },
    select: { id: true, name: true, description: true, clientId: true, proposals: { where: { status: { not: "ARCHIVED" } }, select: { scopeOfWork: true, trade: true, lineItems: { select: { name: true, quantity: true } } } } },
  });
  if (!p) throw new Error("Project not found");
  const draft = await draftStagesWithAi({
    name: p.name,
    scope: [p.description, ...p.proposals.map((x) => x.scopeOfWork)].filter(Boolean).join("\n").slice(0, 2000) || null,
    lines: p.proposals.flatMap((x) => x.lineItems.map((l) => `${l.name} × ${l.quantity}`)),
    trade: p.proposals.find((x) => x.trade)?.trade ?? null,
  });
  if (!draft) return { error: "The AI couldn't draft stages right now — pick a template or add them by hand." };
  const added = await stagesFromTemplate(p.id, draft.stages);
  await db.project.update({ where: { id: p.id }, data: { stagesDraftedAt: new Date() } });
  await logActivity({ organizationId, actorId: user.id, kind: TRAIL_KINDS.PROJECT, summary: `The AI drafted ${added} stages for ${p.name}`, clientId: p.clientId, meta: { projectId: p.id } });
  touched(p.id);
  return { added };
}

/** "Keep these stages": the AI's draft stands as the owner's own. */
export async function keepDraftedStages(projectId: string): Promise<void> {
  const { organizationId } = await requireEstimatorOrManager();
  const p = await projectOf(organizationId, projectId);
  await db.project.update({ where: { id: p.id }, data: { stagesDraftedAt: null } });
  touched(p.id);
}

// ── one stage ────────────────────────────────────────────────────────────────

const stageInput = z.object({ name: z.string().trim().min(1).max(120), startsAt: DAY.optional(), endsAt: DAY.optional(), weight: z.number().min(0).max(1000).optional() });

export async function addStage(projectId: string, raw: unknown): Promise<{ id: string }> {
  const { organizationId } = await requireEstimatorOrManager();
  const p = await projectOf(organizationId, projectId);
  const data = stageInput.parse(raw);
  if (data.startsAt && data.endsAt && data.endsAt < data.startsAt) throw new Error("The stage ends before it starts");
  // A hand-added stage weighs what the others weigh on average (a template's shares are fractions), so it
  // neither dominates nor vanishes from % done.
  const [top, avg] = await Promise.all([
    db.projectStage.aggregate({ where: { projectId: p.id }, _max: { position: true } }),
    db.projectStage.aggregate({ where: { projectId: p.id }, _avg: { weight: true } }),
  ]);
  const s = await db.projectStage.create({
    data: { projectId: p.id, name: data.name, position: (top._max.position ?? -1) + 1, startsAt: dayOf(data.startsAt), endsAt: dayOf(data.endsAt), weight: data.weight ?? avg._avg.weight ?? 1 },
    select: { id: true },
  });
  await keptByEdit(p.id);
  touched(p.id);
  return { id: s.id };
}

export async function updateStage(stageId: string, raw: unknown): Promise<void> {
  const { organizationId } = await requireEstimatorOrManager();
  const s = await stageOf(organizationId, stageId);
  const data = stageInput.partial().parse(raw);
  if (data.startsAt && data.endsAt && data.endsAt < data.startsAt) throw new Error("The stage ends before it starts");
  await db.projectStage.update({
    where: { id: s.id },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.startsAt !== undefined && { startsAt: dayOf(data.startsAt) }),
      ...(data.endsAt !== undefined && { endsAt: dayOf(data.endsAt) }),
      ...(data.weight !== undefined && { weight: data.weight }),
    },
  });
  await keptByEdit(s.projectId);
  touched(s.projectId);
}

/** Planned → in progress → done, and back (lib/projectStages/server markStage — the Operator's set_stage runs the same). */
export async function setStageStatus(stageId: string, status: "PLANNED" | "ACTIVE" | "DONE"): Promise<void> {
  const { organizationId, user } = await requireEstimatorOrManager();
  if (!["PLANNED", "ACTIVE", "DONE"].includes(status)) throw new Error("Bad status");
  const r = await markStage(organizationId, stageId, status, user.id);
  touched(r.projectId);
}

export async function deleteStage(stageId: string): Promise<void> {
  const { organizationId } = await requireEstimatorOrManager();
  const s = await stageOf(organizationId, stageId);
  await db.projectStage.delete({ where: { id: s.id } });
  await keptByEdit(s.projectId);
  touched(s.projectId);
}

/** One step up or down the order. */
export async function moveStage(stageId: string, dir: "up" | "down"): Promise<void> {
  const { organizationId } = await requireEstimatorOrManager();
  const s = await stageOf(organizationId, stageId);
  const all = await db.projectStage.findMany({ where: { projectId: s.projectId }, orderBy: { position: "asc" }, select: { id: true } });
  const i = all.findIndex((x) => x.id === s.id);
  const j = dir === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= all.length) return;
  [all[i], all[j]] = [all[j], all[i]];
  await db.$transaction(all.map((x, position) => db.projectStage.update({ where: { id: x.id }, data: { position } })));
  await keptByEdit(s.projectId);
  touched(s.projectId);
}

// ── tasks ────────────────────────────────────────────────────────────────────

const taskInput = z.object({ title: z.string().trim().min(1).max(200), photoNeeded: z.boolean().optional() });

export async function addTask(stageId: string, raw: unknown): Promise<{ id: string }> {
  const { organizationId } = await requireEstimatorOrManager();
  const s = await stageOf(organizationId, stageId);
  const data = taskInput.parse(raw);
  const top = await db.projectTask.aggregate({ where: { stageId: s.id }, _max: { position: true } });
  const t = await db.projectTask.create({ data: { projectId: s.projectId, stageId: s.id, title: data.title, photoNeeded: Boolean(data.photoNeeded), position: (top._max.position ?? -1) + 1 }, select: { id: true } });
  await keptByEdit(s.projectId);
  touched(s.projectId);
  return { id: t.id };
}

export async function updateTask(taskId: string, raw: unknown): Promise<void> {
  const { organizationId } = await requireEstimatorOrManager();
  const t = await db.projectTask.findFirst({ where: { id: taskId, project: { organizationId } }, select: { id: true, projectId: true } });
  if (!t) throw new Error("Task not found");
  const data = taskInput.partial().parse(raw);
  await db.projectTask.update({ where: { id: t.id }, data: { ...(data.title !== undefined && { title: data.title }), ...(data.photoNeeded !== undefined && { photoNeeded: data.photoNeeded }) } });
  await keptByEdit(t.projectId);
  touched(t.projectId);
}

/** Tick or untick (lib/projectStages/server markTask — the Operator's tick_task runs the same). */
export async function setTaskDone(taskId: string, done: boolean): Promise<void> {
  const { organizationId, user } = await requireEstimatorOrManager();
  const r = await markTask(organizationId, taskId, done, user.id);
  touched(r.projectId);
}

export async function deleteTask(taskId: string): Promise<void> {
  const { organizationId } = await requireEstimatorOrManager();
  const t = await db.projectTask.findFirst({ where: { id: taskId, project: { organizationId } }, select: { id: true, projectId: true } });
  if (!t) throw new Error("Task not found");
  await db.projectTask.delete({ where: { id: t.id } });
  await keptByEdit(t.projectId);
  touched(t.projectId);
}

// ── "Make it a project" on a job ─────────────────────────────────────────────

export async function makeProjectFromJob(jobId: string): Promise<{ id: string; created: boolean }> {
  const { organizationId, user } = await requireEstimatorOrManager();
  const r = await projectForJob(organizationId, jobId, user.id);
  revalidatePath("/dashboard/projects");
  revalidatePath(`/dashboard/jobs/${jobId}`);
  return r;
}

// ── Automatic projects (the switch) ──────────────────────────────────────────

export async function readProjectSettings(): Promise<ProjectSettings & { allTrades: readonly TradeType[]; defaults: readonly TradeType[] }> {
  const { organizationId } = await requireEstimatorOrManager();
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { projectSettingsJson: true } });
  return { ...parseProjectSettings(org?.projectSettingsJson), allTrades: TRADE_TYPES, defaults: PROJECT_TRADES_DEFAULT };
}

const settingsInput = z.object({ auto: z.boolean(), trades: z.array(z.string()).max(40) });

export async function saveProjectSettings(raw: unknown): Promise<ProjectSettings> {
  const { organizationId, user } = await requireEstimatorOrManager();
  const data = settingsInput.parse(raw);
  const trades = data.trades.filter((x): x is TradeType => (TRADE_TYPES as readonly string[]).includes(x));
  const next: ProjectSettings = { auto: data.auto, trades };
  await db.organization.update({ where: { id: organizationId }, data: { projectSettingsJson: JSON.stringify(next) } });
  await logActivity({ organizationId, actorId: user.id, kind: TRAIL_KINDS.SETTINGS, summary: data.auto ? `Automatic projects on for ${trades.length} trade${trades.length === 1 ? "" : "s"}` : "Automatic projects off", meta: next });
  revalidatePath("/dashboard/projects");
  return next;
}
