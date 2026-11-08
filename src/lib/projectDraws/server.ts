import "server-only";
// DRAWS — the database half (2026-11-07, the plan "Projects: Remodel and New construction", part 6). The rules are
// ./shared.ts.
//
//   · drawsOf      — the Payments card's read: every draw with where it stands against the phases (ready when its
//                    phase is closed and every inspection passed), what is funded, requested and held, the total the
//                    schedule is drawn on, and whether the build has a lender at all.
//   · layoutDraws  — the usual five draws (or the office's own schedule) on the loan's total, to the dollar; planned
//                    draws are replaced, requested and funded ones kept.
//   · setDraw      — a draw's name, dollars, retainage or phase by hand.
//   · requestDraw  — planned → requested, with the lender's bundle taken now: the phases and their % done, the
//                    inspections and their results, the photos on file, what was spent and committed.
//   · fundDraw     — requested → funded, with what the lender released; resetDraw puts a mistake back.

import { db } from "@/lib/db";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { appBaseUrl } from "@/lib/appUrl";
import { localDayKey } from "@/lib/jobProgressShared";
import { mediaOf } from "@/lib/jobMediaShared";
import { parseAnswers } from "@/lib/projectKind";
import { projectMoney } from "@/lib/projectMoney";
import { phasesOf } from "@/lib/projectPhases/server";
import { percentDone } from "@/lib/projectStages/shared";
import { stagesOf } from "@/lib/projectStages/server";
import { DEFAULT_DRAWS, DEFAULT_RETAINAGE_PCT, dollars, drawAmounts, parseSnapshot, readDraws, snapshotFrom, type DrawRead, type DrawSnapshot, type DrawTemplate } from "./shared";

async function tzOf(organizationId: string): Promise<string> {
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } });
  return org?.timezone || "America/New_York";
}
const r2 = (n: number) => Math.round(n * 100) / 100;

// ── the read ─────────────────────────────────────────────────────────────────

export type DrawRow = DrawRead & { snapshot: DrawSnapshot | null; fundedAmount: number | null; note: string | null };

export type DrawsRead = {
  /** The build has a lender (the start questions), so draws are its way of being paid. */
  lender: boolean;
  draws: DrawRow[];
  next: DrawRow | null;
  funded: number;
  requested: number;
  held: number;
  total: number;
  /** What a layout would draw on: the sold contract, else the cost budget. */
  basis: { amount: number; from: "contract" | "budget" | "none" };
  /** The lender's read-only page (part 7), once the office made it (lib/projectClient ensureLenderShare). */
  lenderPage: string | null;
  today: string;
};

export async function drawsOf(organizationId: string, projectId: string): Promise<DrawsRead> {
  const tz = await tzOf(organizationId);
  const today = localDayKey(new Date(), tz);
  const [p, rows, phases, moneyAll] = await Promise.all([
    db.project.findFirst({ where: { id: projectId, organizationId }, select: { id: true, kind: true, budget: true, answersJson: true, lenderToken: true } }),
    db.projectDraw.findMany({ where: { projectId, organizationId }, orderBy: { number: "asc" }, select: { id: true, number: true, name: true, afterPhase: true, pct: true, amount: true, status: true, requestedAt: true, fundedAt: true, fundedAmount: true, retainagePct: true, snapshotJson: true, note: true } }),
    phasesOf(projectId),
    projectMoney(organizationId, [projectId]),
  ]);
  if (!p) throw new Error("Project not found");
  const money = moneyAll.get(p.id);
  const read = readDraws(
    rows.map((d) => ({ id: d.id, number: d.number, name: d.name, afterPhase: d.afterPhase, pct: d.pct, amount: d.amount, status: d.status, requestedAt: d.requestedAt ? d.requestedAt.toISOString() : null, fundedAt: d.fundedAt ? d.fundedAt.toISOString() : null, retainagePct: d.retainagePct })),
    phases.phases.map((ph) => ({ key: ph.key, name: ph.name, status: ph.status, holding: ph.holding })),
  );
  const byId = new Map(rows.map((d) => [d.id, d]));
  const draws: DrawRow[] = read.draws.map((d) => ({ ...d, snapshot: parseSnapshot(byId.get(d.id)?.snapshotJson), fundedAmount: byId.get(d.id)?.fundedAmount ?? null, note: byId.get(d.id)?.note ?? null }));
  const contract = money && money.contract > 0 ? r2(money.contract) : 0;
  const basis = contract > 0 ? { amount: contract, from: "contract" as const } : p.budget > 0 ? { amount: r2(p.budget), from: "budget" as const } : { amount: 0, from: "none" as const };
  const lenderPage = p.lenderToken ? `${await appBaseUrl()}/l/${p.lenderToken}` : null;
  return { lender: parseAnswers(p.answersJson).build?.lender === true, draws, next: draws.find((d) => d.state !== "FUNDED") ?? null, funded: read.funded, requested: read.requested, held: read.held, total: read.total, basis, lenderPage, today };
}

// ── the writes ───────────────────────────────────────────────────────────────

async function projectOf(organizationId: string, projectId: string) {
  const p = await db.project.findFirst({ where: { id: projectId, organizationId }, select: { id: true, name: true, clientId: true, budget: true } });
  if (!p) throw new Error("Project not found");
  return p;
}

/** The usual five draws (or the schedule given) on the loan's total. Planned draws are replaced; a requested or
 *  funded one stays, and its dollars are left out of what the new ones share. */
export async function layoutDraws(organizationId: string, projectId: string, input: { total: number | null; schedule?: DrawTemplate[] | null; retainagePct?: number | null }, actorId: string | null): Promise<{ total: number; draws: Array<{ number: number; name: string; amount: number }> }> {
  const p = await projectOf(organizationId, projectId);
  const read = await drawsOf(organizationId, p.id);
  const total = input.total != null && input.total > 0 ? r2(input.total) : read.basis.amount;
  if (!(total > 0)) throw new Error("Nothing to draw on yet — a sold proposal or a cost budget gives the total.");
  const kept = read.draws.filter((d) => d.state !== "PLANNED");
  const keptSum = kept.reduce((n, d) => n + d.amount, 0);
  const schedule = (input.schedule?.length ? input.schedule : [...DEFAULT_DRAWS]).filter((t) => !kept.some((k) => k.number === t.number));
  const amounts = drawAmounts(Math.max(0, total - keptSum), schedule);
  const phases = await db.projectPhase.findMany({ where: { projectId: p.id }, select: { id: true, key: true } });
  const phaseId = new Map(phases.map((ph) => [ph.key, ph.id]));
  const retainage = input.retainagePct != null ? Math.max(0, Math.min(50, input.retainagePct)) : DEFAULT_RETAINAGE_PCT;
  await db.$transaction([
    db.projectDraw.deleteMany({ where: { projectId: p.id, status: "PLANNED" } }),
    ...schedule.map((t) =>
      db.projectDraw.create({
        data: { organizationId, projectId: p.id, phaseId: phaseId.get(t.afterPhase) ?? null, afterPhase: t.afterPhase, number: t.number, name: t.name, pct: t.pct, amount: amounts.find((a) => a.number === t.number)?.amount ?? 0, retainagePct: retainage, createdById: actorId },
      }),
    ),
  ]);
  await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.PROJECT, summary: `Laid out ${schedule.length} draws on ${dollars(total)} for ${p.name}`, clientId: p.clientId, meta: { projectId: p.id, total, draws: schedule.length } });
  return { total, draws: schedule.map((t) => ({ number: t.number, name: t.name, amount: amounts.find((a) => a.number === t.number)?.amount ?? 0 })) };
}

export type DrawPatch = { name?: string; amount?: number; retainagePct?: number; afterPhase?: string | null; note?: string | null };

export async function setDraw(organizationId: string, drawId: string, patch: DrawPatch, actorId: string | null): Promise<void> {
  const d = await db.projectDraw.findFirst({ where: { id: drawId, organizationId }, select: { id: true, number: true, name: true, status: true, projectId: true, project: { select: { name: true, clientId: true } } } });
  if (!d) throw new Error("Draw not found");
  if (d.status === "FUNDED" && patch.amount !== undefined) throw new Error("A funded draw's amount stays.");
  let phaseId: string | null | undefined;
  if (patch.afterPhase !== undefined) phaseId = patch.afterPhase ? ((await db.projectPhase.findFirst({ where: { projectId: d.projectId, key: patch.afterPhase }, select: { id: true } }))?.id ?? null) : null;
  await db.projectDraw.update({
    where: { id: d.id },
    data: {
      ...(patch.name !== undefined ? { name: patch.name.trim().slice(0, 80) || d.name } : {}),
      ...(patch.amount !== undefined ? { amount: r2(Math.max(0, patch.amount)) } : {}),
      ...(patch.retainagePct !== undefined ? { retainagePct: Math.max(0, Math.min(50, patch.retainagePct)) } : {}),
      ...(patch.afterPhase !== undefined ? { afterPhase: patch.afterPhase, phaseId } : {}),
      ...(patch.note !== undefined ? { note: patch.note?.trim() || null } : {}),
    },
  });
  await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.PROJECT, summary: `Changed draw ${d.number} (${patch.name?.trim() || d.name}) on ${d.project.name}`, clientId: d.project.clientId, meta: { projectId: d.projectId, drawId: d.id } });
}

/** The lender's bundle as the project stands now. */
export async function takeSnapshot(organizationId: string, projectId: string, draw: { number: number; name: string; amount: number }): Promise<DrawSnapshot> {
  const [stageRead, phases, inspections, photosAll, moneyAll, orders, quotes] = await Promise.all([
    stagesOf(projectId),
    phasesOf(projectId),
    db.projectInspection.findMany({ where: { projectId }, orderBy: [{ date: "asc" }, { createdAt: "asc" }], select: { name: true, result: true, date: true, stage: { select: { name: true } } } }),
    db.jobPhoto.findMany({ where: { job: { projectId, organizationId } }, select: { url: true, media: true, analysis: true } }),
    projectMoney(organizationId, [projectId]),
    db.projectOrder.findMany({ where: { projectId, status: { in: ["ORDERED", "SHIPPED", "DELIVERED", "PARTIAL"] }, expenseId: null }, select: { quotedTotal: true } }),
    db.projectSubQuote.findMany({ where: { projectId, status: { in: ["AWARDED", "INVOICED"] } }, select: { status: true, amount: true, invoiceAmount: true } }),
  ]);
  const money = moneyAll.get(projectId);
  const photos = photosAll.filter((ph) => mediaOf(ph).media === "photo").length;
  const committed = orders.reduce((n, o) => n + (o.quotedTotal ?? 0), 0) + quotes.reduce((n, q) => n + ((q.status === "INVOICED" ? (q.invoiceAmount ?? q.amount) : q.amount) ?? 0), 0);
  return snapshotFrom({
    takenAt: new Date().toISOString(),
    done: stageRead.done ?? 0,
    phases: phases.phases.map((ph) => {
      const mine = stageRead.stages.filter((s) => s.phaseId === ph.id);
      return { name: ph.name, status: ph.status, done: mine.length ? (percentDone(mine) ?? 0) : 0 };
    }),
    inspections: inspections.map((i) => ({ name: i.name, result: i.result, date: i.date ? i.date.toISOString().slice(0, 10) : null, stage: i.stage?.name ?? null })),
    photos,
    spent: money?.spent ?? 0,
    committed,
    draw,
  });
}

export async function requestDraw(organizationId: string, drawId: string, actorId: string | null): Promise<{ projectId: string; number: number; name: string; amount: number; snapshot: DrawSnapshot }> {
  const d = await db.projectDraw.findFirst({ where: { id: drawId, organizationId }, select: { id: true, number: true, name: true, amount: true, status: true, projectId: true, project: { select: { name: true, clientId: true } } } });
  if (!d) throw new Error("Draw not found");
  if (d.status !== "PLANNED") throw new Error(d.status === "FUNDED" ? "That draw is funded already." : "That draw is requested already.");
  const snapshot = await takeSnapshot(organizationId, d.projectId, { number: d.number, name: d.name, amount: d.amount });
  await db.projectDraw.update({ where: { id: d.id }, data: { status: "REQUESTED", requestedAt: new Date(), snapshotJson: JSON.stringify(snapshot) } });
  await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.PROJECT, summary: `Requested draw ${d.number} (${d.name}, ${dollars(d.amount)}) on ${d.project.name}`, clientId: d.project.clientId, meta: { projectId: d.projectId, drawId: d.id, amount: d.amount } });
  return { projectId: d.projectId, number: d.number, name: d.name, amount: d.amount, snapshot };
}

export async function fundDraw(organizationId: string, drawId: string, amount: number | null, actorId: string | null): Promise<{ projectId: string; number: number; name: string; funded: number }> {
  const d = await db.projectDraw.findFirst({ where: { id: drawId, organizationId }, select: { id: true, number: true, name: true, amount: true, status: true, retainagePct: true, projectId: true, project: { select: { name: true, clientId: true } } } });
  if (!d) throw new Error("Draw not found");
  if (d.status === "FUNDED") throw new Error("That draw is funded already.");
  const read = await drawsOf(organizationId, d.projectId);
  const row = read.draws.find((x) => x.id === d.id);
  const funded = r2(amount != null && amount > 0 ? amount : (row?.payout.released ?? d.amount));
  await db.projectDraw.update({ where: { id: d.id }, data: { status: "FUNDED", fundedAt: new Date(), fundedAmount: funded, ...(d.status === "PLANNED" ? { requestedAt: new Date() } : {}) } });
  await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.PROJECT, summary: `Draw ${d.number} (${d.name}) funded — ${dollars(funded)} on ${d.project.name}`, clientId: d.project.clientId, meta: { projectId: d.projectId, drawId: d.id, funded } });
  return { projectId: d.projectId, number: d.number, name: d.name, funded };
}

/** A mistake put back: requested or funded → planned, the bundle dropped. */
export async function resetDraw(organizationId: string, drawId: string, actorId: string | null): Promise<{ projectId: string }> {
  const d = await db.projectDraw.findFirst({ where: { id: drawId, organizationId }, select: { id: true, number: true, name: true, projectId: true, project: { select: { name: true, clientId: true } } } });
  if (!d) throw new Error("Draw not found");
  await db.projectDraw.update({ where: { id: d.id }, data: { status: "PLANNED", requestedAt: null, fundedAt: null, fundedAmount: null, snapshotJson: null } });
  await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.PROJECT, summary: `Draw ${d.number} (${d.name}) put back to planned on ${d.project.name}`, clientId: d.project.clientId, meta: { projectId: d.projectId, drawId: d.id } });
  return { projectId: d.projectId };
}

/** Draws funded and requested per project, for the Financials card. */
export async function drawTotals(organizationId: string, projectIds: string[]): Promise<Map<string, { funded: number; requested: number; count: number }>> {
  if (!projectIds.length) return new Map();
  const rows = await db.projectDraw.findMany({ where: { organizationId, projectId: { in: projectIds } }, select: { projectId: true, status: true, amount: true, fundedAmount: true } });
  const out = new Map<string, { funded: number; requested: number; count: number }>();
  for (const r of rows) {
    const cur = out.get(r.projectId) ?? { funded: 0, requested: 0, count: 0 };
    cur.count += 1;
    if (r.status === "FUNDED") cur.funded = r2(cur.funded + (r.fundedAmount ?? r.amount));
    else if (r.status === "REQUESTED") cur.requested = r2(cur.requested + r.amount);
    out.set(r.projectId, cur);
  }
  return out;
}
