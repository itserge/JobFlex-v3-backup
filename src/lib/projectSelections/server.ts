import "server-only";
// SELECTIONS ON A PROJECT — the database half (2026-11-07, the plan "Projects: Remodel and New construction",
// part 3). The rules are ./shared.ts.
//
//   · selectionsOf     — the card's read: every selection with the stage that needs it, its due day (set by hand or
//                        read from the stage's first day less the lead time), its state, the allowance set and the
//                        one the proposal's material lines suggest, and what was chosen.
//   · addSelection / updateSelection / deleteSelection — the office's own rows (the templates seed the usual ones
//                        through lib/projectStages stagesFromTemplate).
//   · chooseSelection  — the choice is in: what, from whom, at what price — with the allowance read against it.
//   · reopenSelection  — the client changed their mind.

import { db } from "@/lib/db";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { localDayKey } from "@/lib/jobProgressShared";
import { DEFAULT_SELECTION_LEAD, allowanceFromMaterials, allowanceWords, dollars, isoDay, leadDaysFor, selectionDue, selectionState, type SelectionState } from "./shared";

async function tzOf(organizationId: string): Promise<string> {
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } });
  return org?.timezone || "America/New_York";
}

const dayOf = (s: string | null | undefined) => (s ? new Date(`${s.slice(0, 10)}T00:00:00.000Z`) : null);

// ── the read ─────────────────────────────────────────────────────────────────

export type SelectionRow = {
  id: string;
  name: string;
  stageId: string | null;
  stageName: string | null;
  /** The stage's first day (ISO day) or null while it has none. */
  stageStart: string | null;
  stageDone: boolean;
  leadDays: number;
  /** The due day set by hand, or null. */
  dueBy: string | null;
  /** The day the choice must be in — by hand, else from the stage — or null while neither is known. */
  due: string | null;
  state: SelectionState;
  allowance: number | null;
  /** What the proposal's material lines add up to for it, offered when no allowance is set. */
  allowanceSuggested: number | null;
  chosen: string | null;
  vendor: string | null;
  price: number | null;
  chosenAt: string | null;
  /** Chosen from the client's own page (part 7, 2026-11-08): the choice carries no office actor. */
  byClient: boolean;
  note: string | null;
  position: number;
};

export type SelectionsRead = {
  /** Today in the company's time zone (ISO day). */
  today: string;
  selections: SelectionRow[];
  open: number;
  late: number;
  chosen: number;
};

export async function selectionsOf(organizationId: string, projectId: string): Promise<SelectionsRead> {
  const tz = await tzOf(organizationId);
  const today = localDayKey(new Date(), tz);
  const [rows, materials] = await Promise.all([
    db.projectSelection.findMany({
      where: { projectId, organizationId },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        name: true,
        stageId: true,
        leadDays: true,
        dueBy: true,
        allowance: true,
        chosen: true,
        vendor: true,
        price: true,
        chosenAt: true,
        chosenById: true,
        note: true,
        position: true,
        stage: { select: { name: true, startsAt: true, status: true, position: true } },
      },
    }),
    db.projectMaterial.findMany({ where: { projectId }, select: { name: true, quantity: true, unitCost: true } }),
  ]);
  // In the stages' order, the project-wide ones last, each group as the office ordered it.
  const sorted = [...rows].sort((a, b) => (a.stage?.position ?? 1e9) - (b.stage?.position ?? 1e9) || a.position - b.position);
  const selections: SelectionRow[] = sorted.map((r) => {
    const like = { name: r.name, leadDays: r.leadDays, dueBy: isoDay(r.dueBy), chosenAt: r.chosenAt ? r.chosenAt.toISOString() : null, stageStart: isoDay(r.stage?.startsAt), stageDone: r.stage?.status === "DONE", stageName: r.stage?.name ?? null };
    return {
      id: r.id,
      name: r.name,
      stageId: r.stageId,
      stageName: r.stage?.name ?? null,
      stageStart: like.stageStart,
      stageDone: like.stageDone,
      leadDays: r.leadDays,
      dueBy: like.dueBy,
      due: selectionDue(like),
      state: selectionState(like, today),
      allowance: r.allowance,
      allowanceSuggested: r.allowance == null ? allowanceFromMaterials(r.name, materials) : null,
      chosen: r.chosen,
      vendor: r.vendor,
      price: r.price,
      chosenAt: like.chosenAt,
      byClient: Boolean(r.chosenAt) && !r.chosenById,
      note: r.note,
      position: r.position,
    };
  });
  return {
    today,
    selections,
    open: selections.filter((s) => s.state !== "chosen" && !s.stageDone).length,
    late: selections.filter((s) => s.state === "late" && !s.stageDone).length,
    chosen: selections.filter((s) => s.state === "chosen").length,
  };
}

// ── the writes ───────────────────────────────────────────────────────────────

export type SelectionInput = { name: string; stageId?: string | null; leadDays?: number | null; dueBy?: string | null; allowance?: number | null; note?: string | null };

async function projectOf(organizationId: string, projectId: string) {
  const p = await db.project.findFirst({ where: { id: projectId, organizationId }, select: { id: true, name: true, clientId: true } });
  if (!p) throw new Error("Project not found");
  return p;
}

async function stageOn(projectId: string, stageId: string | null | undefined): Promise<string | null> {
  if (!stageId) return null;
  const st = await db.projectStage.findFirst({ where: { id: stageId, projectId }, select: { id: true } });
  if (!st) throw new Error("That stage is not on this project");
  return st.id;
}

export async function addSelection(organizationId: string, projectId: string, input: SelectionInput, actorId: string | null): Promise<{ id: string; name: string }> {
  const p = await projectOf(organizationId, projectId);
  const name = input.name.trim().slice(0, 120);
  if (!name) throw new Error("Name the selection — Cabinets, Tile, Paint colors");
  const stageId = await stageOn(p.id, input.stageId);
  const last = await db.projectSelection.findFirst({ where: { projectId: p.id }, orderBy: { position: "desc" }, select: { position: true } });
  const row = await db.projectSelection.create({
    data: {
      organizationId,
      projectId: p.id,
      stageId,
      name,
      leadDays: input.leadDays != null ? Math.max(0, Math.min(365, Math.round(input.leadDays))) : leadDaysFor(name) || DEFAULT_SELECTION_LEAD,
      dueBy: dayOf(input.dueBy),
      allowance: input.allowance != null && input.allowance >= 0 ? Math.round(input.allowance * 100) / 100 : null,
      note: input.note?.trim() || null,
      position: (last?.position ?? -1) + 1,
      createdById: actorId,
    },
    select: { id: true, name: true },
  });
  await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.PROJECT, summary: `Added the ${name} selection to ${p.name}`, clientId: p.clientId, meta: { projectId: p.id, selectionId: row.id } });
  return row;
}

export async function updateSelection(organizationId: string, selectionId: string, patch: Partial<SelectionInput>, actorId: string | null): Promise<void> {
  const row = await db.projectSelection.findFirst({ where: { id: selectionId, organizationId }, select: { id: true, projectId: true, name: true, project: { select: { name: true, clientId: true } } } });
  if (!row) throw new Error("Selection not found");
  const stageId = patch.stageId !== undefined ? await stageOn(row.projectId, patch.stageId) : undefined;
  await db.projectSelection.update({
    where: { id: row.id },
    data: {
      ...(patch.name !== undefined ? { name: patch.name.trim().slice(0, 120) || row.name } : {}),
      ...(stageId !== undefined ? { stageId } : {}),
      ...(patch.leadDays !== undefined && patch.leadDays !== null ? { leadDays: Math.max(0, Math.min(365, Math.round(patch.leadDays))) } : {}),
      ...(patch.dueBy !== undefined ? { dueBy: dayOf(patch.dueBy) } : {}),
      ...(patch.allowance !== undefined ? { allowance: patch.allowance != null && patch.allowance >= 0 ? Math.round(patch.allowance * 100) / 100 : null } : {}),
      ...(patch.note !== undefined ? { note: patch.note?.trim() || null } : {}),
    },
  });
  await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.PROJECT, summary: `Changed the ${patch.name?.trim() || row.name} selection on ${row.project.name}`, clientId: row.project.clientId, meta: { projectId: row.projectId, selectionId: row.id } });
}

export type Pick = { chosen: string | null; vendor: string | null; price: number | null };

/** The choice is in. The words come back for the card's note and the Operator: what, from whom, the price against
 *  the allowance. */
export async function chooseSelection(organizationId: string, selectionId: string, pick: Pick, actorId: string | null): Promise<{ projectId: string; name: string; words: string }> {
  const row = await db.projectSelection.findFirst({ where: { id: selectionId, organizationId }, select: { id: true, projectId: true, name: true, allowance: true, project: { select: { name: true, clientId: true } } } });
  if (!row) throw new Error("Selection not found");
  const chosen = pick.chosen?.trim().slice(0, 500) || null;
  const vendor = pick.vendor?.trim().slice(0, 120) || null;
  const price = pick.price != null && pick.price >= 0 ? Math.round(pick.price * 100) / 100 : null;
  if (!chosen && !vendor && price == null) throw new Error("Say what was chosen — or from whom, or at what price");
  await db.projectSelection.update({ where: { id: row.id }, data: { chosen, vendor, price, chosenAt: new Date(), chosenById: actorId } });
  const against = allowanceWords(price, row.allowance);
  const words = `${row.name} chosen${chosen ? `: ${chosen}` : ""}${vendor ? ` from ${vendor}` : ""}${price != null ? `, ${dollars(price)}` : ""}${against ? ` — ${against}` : ""}`;
  await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.PROJECT, summary: `${words} on ${row.project.name}`, clientId: row.project.clientId, meta: { projectId: row.projectId, selectionId: row.id, price } });
  return { projectId: row.projectId, name: row.name, words };
}

export async function reopenSelection(organizationId: string, selectionId: string, actorId: string | null): Promise<{ projectId: string }> {
  const row = await db.projectSelection.findFirst({ where: { id: selectionId, organizationId }, select: { id: true, projectId: true, name: true, project: { select: { name: true, clientId: true } } } });
  if (!row) throw new Error("Selection not found");
  await db.projectSelection.update({ where: { id: row.id }, data: { chosenAt: null, chosenById: null } });
  await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.PROJECT, summary: `Reopened the ${row.name} selection on ${row.project.name}`, clientId: row.project.clientId, meta: { projectId: row.projectId, selectionId: row.id } });
  return { projectId: row.projectId };
}

export async function deleteSelection(organizationId: string, selectionId: string): Promise<{ projectId: string }> {
  const row = await db.projectSelection.findFirst({ where: { id: selectionId, organizationId }, select: { id: true, projectId: true } });
  if (!row) throw new Error("Selection not found");
  await db.projectSelection.delete({ where: { id: row.id } });
  return { projectId: row.projectId };
}
