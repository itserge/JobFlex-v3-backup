import "server-only";
// NEW CONSTRUCTION — THE PHASES, the database half (2026-11-07, the plan "Projects: Remodel and New construction",
// part 4). The rules are ./shared.ts.
//
//   · addBuildPhases — a new build's phases and their stages, shaped by the start questions, onto a project that has
//                      none yet: ProjectPhase rows, then each phase's stages (lib/projectStages createStageRows) with
//                      the phase, the lane and the stage each cannot start before; the answers remembered on the
//                      project (answersJson.build).
//   · phasesOf       — the strip's read: the phases with their state read off the stages, and the one the project is
//                      on with its gate's words.
//   · the lot        — parseLot / saveLot: the parcel record, the utilities and the permits on the project (lotJson).

import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { parseAnswers, serializeAnswers } from "@/lib/projectKind";
import { addTemplate, createStageRows, stagesOf } from "@/lib/projectStages/server";
import { templateByKey, type StageTemplate } from "@/lib/projectStages/shared";
import { phasesFor, readPhases, type BuildAnswers, type PhaseRead } from "./shared";

type Tx = Prisma.TransactionClient;

// ── the phases ───────────────────────────────────────────────────────────────

/**
 * The phases of a new build onto a project. Refused when the project already has phases (add stages by hand, or
 * remove them first). The stages chain: each after the one before it in its phase; a phase's first stage after the
 * last stage of the phase it follows (the site work after the design, beside the permits; the shop after the site).
 */
export async function addBuildPhases(project: { id: string; organizationId: string; answersJson: string | null }, answers: BuildAnswers, tx: Tx | typeof db = db): Promise<{ phases: number; stages: number }> {
  const have = await tx.projectPhase.count({ where: { projectId: project.id } });
  if (have > 0) throw new Error("This project already has its phases");
  const plan = phasesFor(answers);
  const lastStageOf = new Map<string, string>();
  let stages = 0;
  for (const [i, ph] of plan.entries()) {
    const row = await tx.projectPhase.create({
      data: {
        organizationId: project.organizationId,
        projectId: project.id,
        key: ph.key,
        name: ph.name,
        position: i,
        share: ph.share,
        gateKind: ph.gate.kind,
        gateWords: ph.gate.words,
        lane: ph.lane,
        leadsJson: ph.leads.length ? JSON.stringify(ph.leads) : null,
      },
      select: { id: true },
    });
    const afterStage = ph.after ? (lastStageOf.get(ph.after) ?? null) : null;
    const ids = await createStageRows(project.id, ph.stages, tx, (k, prevId) => ({ phaseId: row.id, lane: ph.lane, afterId: prevId ?? afterStage }));
    if (ids.length) lastStageOf.set(ph.key, ids[ids.length - 1]);
    stages += ids.length;
  }
  const prior = parseAnswers(project.answersJson);
  await tx.project.update({ where: { id: project.id }, data: { answersJson: serializeAnswers({ ...prior, template: "home", build: answers }) } });
  return { phases: plan.length, stages };
}

/** A template's stages onto a project — or, for a new build asked for the custom home, its phases shaped by the start
 *  questions (the answers stored on the project; the defaults when none were). The Stages card, the Operator and the
 *  dialogs come through here. */
export async function addTemplateOrPhases(project: { id: string; organizationId: string; kind: string; answersJson: string | null }, key: string): Promise<{ added: number; template: StageTemplate; phases: number }> {
  if (project.kind === "NEW_BUILD" && key === "home") {
    const answers = parseAnswers(project.answersJson).build ?? {};
    const r = await addBuildPhases(project, answers);
    const tpl = templateByKey("home")!;
    return { added: r.stages, template: tpl, phases: r.phases };
  }
  const r = await addTemplate(project, key);
  return { ...r, phases: 0 };
}

export type PhasesRead = { phases: PhaseRead[]; current: PhaseRead | null };

/** The phases with their state, in order, and the one the project is on. Empty for a remodel. */
export async function phasesOf(projectId: string): Promise<PhasesRead> {
  const rows = await db.projectPhase.findMany({ where: { projectId }, orderBy: { position: "asc" }, select: { id: true, key: true, name: true, position: true, share: true, gateKind: true, gateWords: true, lane: true, leadsJson: true } });
  if (!rows.length) return { phases: [], current: null };
  const { stages } = await stagesOf(projectId);
  return readPhases(rows, stages.map((s) => ({ phaseId: s.phaseId ?? null, status: s.status, gates: s.gates })));
}

// ── the lot ──────────────────────────────────────────────────────────────────

export type LotPermit = { name: string; number?: string | null; issued?: string | null; expires?: string | null; status?: string | null };
export type LotRecord = {
  parcel?: { number?: string | null; zoning?: string | null; setbacks?: string | null; acres?: number | null; floodZone?: string | null; address?: string | null; owner?: string | null; lookedUpAt?: string | null; source?: string | null };
  utilities?: { sewer?: string | null; water?: string | null; power?: string | null; gas?: string | null; fiber?: string | null };
  permits?: LotPermit[];
  note?: string | null;
};

const str = (v: unknown, max = 200) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/** The lot's record read tolerantly: anything odd is dropped. */
export function parseLot(json: string | null | undefined): LotRecord {
  if (!json) return {};
  try {
    const raw = JSON.parse(json) as Record<string, unknown> | null;
    if (!raw || typeof raw !== "object") return {};
    const out: LotRecord = {};
    if (raw.parcel && typeof raw.parcel === "object") {
      const p = raw.parcel as Record<string, unknown>;
      out.parcel = { number: str(p.number, 60), zoning: str(p.zoning, 80), setbacks: str(p.setbacks, 200), acres: typeof p.acres === "number" && Number.isFinite(p.acres) ? Math.round(p.acres * 1000) / 1000 : null, floodZone: str(p.floodZone, 80), address: str(p.address, 200), owner: str(p.owner, 120), lookedUpAt: str(p.lookedUpAt, 40), source: str(p.source, 40) };
    }
    if (raw.utilities && typeof raw.utilities === "object") {
      const u = raw.utilities as Record<string, unknown>;
      out.utilities = { sewer: str(u.sewer, 80), water: str(u.water, 80), power: str(u.power, 80), gas: str(u.gas, 80), fiber: str(u.fiber, 80) };
    }
    if (Array.isArray(raw.permits)) {
      out.permits = raw.permits
        .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
        .map((x) => ({ name: str(x.name, 120) ?? "", number: str(x.number, 60), issued: str(x.issued, 10), expires: str(x.expires, 10), status: str(x.status, 40) }))
        .filter((x) => x.name)
        .slice(0, 40);
    }
    if (typeof raw.note === "string") out.note = str(raw.note, 2000);
    return out;
  } catch {
    return {};
  }
}

export const serializeLot = (lot: LotRecord): string | null => {
  const clean: LotRecord = {};
  if (lot.parcel && Object.values(lot.parcel).some((v) => v != null)) clean.parcel = lot.parcel;
  if (lot.utilities && Object.values(lot.utilities).some((v) => v != null)) clean.utilities = lot.utilities;
  if (lot.permits?.length) clean.permits = lot.permits;
  if (lot.note) clean.note = lot.note;
  return Object.keys(clean).length ? JSON.stringify(clean) : null;
};

/** The lot's record, or {} for a remodel. */
export async function lotOf(projectId: string): Promise<LotRecord> {
  const p = await db.project.findUnique({ where: { id: projectId }, select: { lotJson: true } });
  return parseLot(p?.lotJson);
}

/** A patch on the lot's record: the parcel typed or looked up, the utilities, the permits list (replaced whole), the note. */
export async function saveLot(organizationId: string, projectId: string, patch: LotRecord, actorId: string | null): Promise<LotRecord> {
  const p = await db.project.findFirst({ where: { id: projectId, organizationId }, select: { id: true, name: true, clientId: true, lotJson: true } });
  if (!p) throw new Error("Project not found");
  const cur = parseLot(p.lotJson);
  const next: LotRecord = {
    parcel: patch.parcel !== undefined ? { ...cur.parcel, ...patch.parcel } : cur.parcel,
    utilities: patch.utilities !== undefined ? { ...cur.utilities, ...patch.utilities } : cur.utilities,
    permits: patch.permits !== undefined ? patch.permits : cur.permits,
    note: patch.note !== undefined ? patch.note : cur.note,
  };
  const clean = parseLot(JSON.stringify(next));
  await db.project.update({ where: { id: p.id }, data: { lotJson: serializeLot(clean) } });
  const what = patch.parcel !== undefined ? "the parcel" : patch.permits !== undefined ? "the permits" : patch.utilities !== undefined ? "the utilities" : "the lot's note";
  await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.PROJECT, summary: `Changed ${what} on ${p.name}'s lot`, clientId: p.clientId, meta: { projectId: p.id } });
  return clean;
}
