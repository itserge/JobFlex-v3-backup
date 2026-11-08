import "server-only";
// WHO IT IS FOR, AND THE MONEY — the database half (2026-11-07, the plan "Projects: Remodel and New construction",
// part 5). The rules are ./shared.ts.
//
//   · moneyPlanOf      — the Money card's read: the settings, every phase's budget / spent / committed / left / heading-
//                        for (spent from the costs logged on the phase; committed from the orders placed and the sub
//                        quotes awarded on its stages, not yet paid; the pace from its stages' tasks), what is on no
//                        phase (labor, stock, receipts, a cost logged without one), the totals, the contract and the
//                        margin at this pace (or a spec house's profit), and the advisor's list.
//   · layoutBudget     — the phases' budgets from the project's cost budget by their shares, to the dollar.
//   · setPhaseBudget / setMoneySettings — the office's own figures.
//   · applyAdvice      — one tap: lower an allowance, re-bid a sub, move the slack, defer the shop — and the decision
//                        in the trail.

import { db } from "@/lib/db";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { localDayKey } from "@/lib/jobProgressShared";
import { projectMoney } from "@/lib/projectMoney";
import { percentDone } from "@/lib/projectStages/shared";
import { phaseStatus } from "@/lib/projectPhases/shared";
import { selectionsOf, updateSelection } from "@/lib/projectSelections/server";
import { askQuotes, contractorsOf } from "@/lib/projectSubs/server";
import { replyByDefault, scopeFor } from "@/lib/projectSubs/shared";
import { advise, dollars, layoutPhaseBudgets, marginAtPace, moneyTotals, parseMoneySettings, phaseHeading, phaseMoney, priceFromCost, settingsWords, type Advice, type MoneySettings, type MoneyTotals, type PhaseMoney } from "./shared";

async function tzOf(organizationId: string): Promise<string> {
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } });
  return org?.timezone || "America/New_York";
}
const r2 = (n: number) => Math.round(n * 100) / 100;
const isContingency = (category: string) => /^contingency$/i.test(category.trim());

/** Work days (Mon–Fri) between two ISO days, both ends in. */
function workDaysBetween(from: Date | null, to: Date | null): number {
  if (!from) return 0;
  const a = new Date(from.toISOString().slice(0, 10) + "T00:00:00Z");
  const b = new Date((to ?? from).toISOString().slice(0, 10) + "T00:00:00Z");
  let n = 0;
  for (let t = a.getTime(); t <= b.getTime(); t += 86_400_000) {
    const d = new Date(t).getUTCDay();
    if (d !== 0 && d !== 6) n++;
  }
  return n;
}

// ── the read ─────────────────────────────────────────────────────────────────

export type PhaseMoneyRow = PhaseMoney & { key: string; lane: string | null; laidOut: boolean; stageIds: string[] };

export type MoneyPlanRead = {
  settings: MoneySettings;
  words: string;
  kind: string;
  /** The project's cost budget (Project.budget) — the total the phases are laid out from. */
  costBudget: number;
  /** True once any phase carries a budget of its own. */
  laidOut: boolean;
  phases: PhaseMoneyRow[];
  /** Spent and committed on no phase: labor, stock, the crew's receipts, a cost logged without a phase. */
  loose: { spent: number; committed: number };
  totals: MoneyTotals;
  /** The sold proposals' revenue (before tax, approved change orders in), or null with none sold. */
  contract: number | null;
  /** What the cost budget implies the client pays under the settings — used when nothing is sold yet. */
  impliedPrice: number | null;
  /** A client build: the contract (or the implied price) less the heading-for. */
  margin: { amount: number; pct: number; against: "contract" | "implied" } | null;
  /** One's own build with a sale price: the sale price less the heading-for. */
  profit: { amount: number; pct: number } | null;
  contingency: { budget: number; spent: number } | null;
  advice: Advice[];
  today: string;
};

export async function moneyPlanOf(organizationId: string, projectId: string): Promise<MoneyPlanRead> {
  const tz = await tzOf(organizationId);
  const today = localDayKey(new Date(), tz);
  const [p, moneyAll, selections] = await Promise.all([
    db.project.findFirst({
      where: { id: projectId, organizationId },
      select: {
        id: true,
        kind: true,
        budget: true,
        forWhom: true,
        moneyMode: true,
        marginPct: true,
        feeAmount: true,
        salePrice: true,
        budgetLines: { where: { label: null }, select: { category: true, amount: true } },
        phases: { orderBy: { position: "asc" }, select: { id: true, key: true, name: true, position: true, share: true, lane: true, budget: true } },
        stages: { orderBy: { position: "asc" }, select: { id: true, phaseId: true, status: true, weight: true, startsAt: true, endsAt: true, name: true, tasks: { select: { doneAt: true, title: true } } } },
        expenses: { select: { amount: true, category: true, phaseId: true } },
        orders: { where: { status: { in: ["ORDERED", "SHIPPED", "DELIVERED", "PARTIAL"] }, expenseId: null }, select: { quotedTotal: true, stageId: true } },
        subQuotes: { where: { status: { in: ["AWARDED", "INVOICED"] } }, select: { id: true, status: true, amount: true, invoiceAmount: true, stageId: true, contractor: { select: { name: true, trade: true } }, stage: { select: { name: true, weight: true } } } },
      },
    }),
    projectMoney(organizationId, [projectId]),
    selectionsOf(organizationId, projectId),
  ]);
  if (!p) throw new Error("Project not found");
  const money = moneyAll.get(p.id);
  const settings = parseMoneySettings(p);
  const phaseOfStage = new Map(p.stages.map((s) => [s.id, s.phaseId]));

  // Spent per phase: the costs logged on it. Committed: the orders placed and the quotes awarded on its stages.
  const spentBy = new Map<string, number>();
  for (const e of p.expenses) if (e.phaseId) spentBy.set(e.phaseId, (spentBy.get(e.phaseId) ?? 0) + e.amount);
  const committedBy = new Map<string, number>();
  let looseCommitted = 0;
  for (const o of p.orders) {
    const ph = o.stageId ? phaseOfStage.get(o.stageId) : null;
    const v = o.quotedTotal ?? 0;
    if (ph) committedBy.set(ph, (committedBy.get(ph) ?? 0) + v);
    else looseCommitted += v;
  }
  for (const q of p.subQuotes) {
    const ph = q.stageId ? phaseOfStage.get(q.stageId) : null;
    const v = (q.status === "INVOICED" ? (q.invoiceAmount ?? q.amount) : q.amount) ?? 0;
    if (ph) committedBy.set(ph, (committedBy.get(ph) ?? 0) + v);
    else looseCommitted += v;
  }

  const phases: PhaseMoneyRow[] = p.phases.map((ph) => {
    const mine = p.stages.filter((s) => s.phaseId === ph.id);
    const like = mine.map((s) => ({ status: s.status, weight: s.weight, tasks: s.tasks.map((t) => ({ done: Boolean(t.doneAt) })) }));
    const status = phaseStatus(mine.map((s) => ({ phaseId: s.phaseId, status: s.status })));
    const done = mine.length ? (percentDone(like) ?? 0) / 100 : 0;
    const row = phaseMoney({ id: ph.id, name: ph.name, status, budget: r2(ph.budget ?? 0), spent: r2(spentBy.get(ph.id) ?? 0), committed: r2(committedBy.get(ph.id) ?? 0), done });
    return { ...row, key: ph.key, lane: ph.lane, laidOut: ph.budget != null, stageIds: mine.map((s) => s.id) };
  });
  const phaseSpent = phases.reduce((n, x) => n + x.spent, 0);
  const spentAll = r2(money?.spent ?? p.expenses.reduce((n, e) => n + e.amount, 0));
  const loose = { spent: r2(Math.max(0, spentAll - phaseSpent)), committed: r2(looseCommitted) };
  const laidOut = phases.some((x) => x.laidOut);
  const costBudget = r2(p.budget);

  // The totals: with phases, the phases plus the loose figures against what the layout left out; without phases, the
  // whole project at its stages' pace.
  let totals: MoneyTotals;
  if (phases.length) {
    const laidBudget = phases.reduce((n, x) => n + x.budget, 0);
    totals = moneyTotals(phases, { budget: r2(Math.max(0, costBudget - laidBudget)), spent: loose.spent, committed: loose.committed });
  } else {
    const like = p.stages.map((s) => ({ status: s.status, weight: s.weight, tasks: s.tasks.map((t) => ({ done: Boolean(t.doneAt) })) }));
    const status = phaseStatus(p.stages.map((s) => ({ phaseId: null, status: s.status })));
    const done = p.stages.length ? (percentDone(like) ?? 0) / 100 : 0;
    const headingFor = phaseHeading({ status, budget: costBudget, spent: loose.spent, committed: loose.committed, done });
    totals = { budget: costBudget, spent: loose.spent, committed: loose.committed, left: r2(costBudget - loose.spent - loose.committed), headingFor, over: r2(headingFor - costBudget) };
  }

  const contract = money && money.contract > 0 ? r2(money.contract) : null;
  const impliedPrice = priceFromCost(costBudget, settings);
  const marginBase = settings.forWhom === "CLIENT" && settings.moneyMode !== "NONE" ? (contract ?? impliedPrice) : contract;
  const m = marginAtPace(marginBase, totals.headingFor);
  const margin = settings.forWhom === "CLIENT" && m ? { ...m, pct: m.pct ?? 0, against: contract != null ? ("contract" as const) : ("implied" as const) } : null;
  const pr = settings.forWhom === "SELF" ? marginAtPace(settings.salePrice, totals.headingFor) : null;
  const profit = pr ? { amount: pr.amount, pct: pr.pct ?? 0 } : null;

  const contLines = p.budgetLines.filter((l) => isContingency(l.category));
  const contingency = contLines.length ? { budget: r2(contLines.reduce((n, l) => n + l.amount, 0)), spent: r2(p.expenses.filter((e) => isContingency(e.category)).reduce((n, e) => n + e.amount, 0)) } : null;

  // Self-perform: a planned phase with an awarded trade bid, against the crew's hours at the company's usual rate.
  const rateAgg = await db.workerProfile.aggregate({ where: { organizationId, hourlyRate: { gt: 0 } }, _avg: { hourlyRate: true } }).catch(() => null);
  const rate = rateAgg?._avg.hourlyRate ?? null;
  const selfPerform: Array<{ phaseId: string; phaseName: string; bid: number; crew: number; hours: number; rate: number }> = [];
  if (rate) {
    for (const ph of phases) {
      if (ph.status !== "PLANNED") continue;
      const bids = p.subQuotes.filter((q) => q.status === "AWARDED" && q.stageId && ph.stageIds.includes(q.stageId));
      const bid = bids.reduce((n, q) => n + (q.amount ?? 0), 0);
      if (bid <= 0) continue;
      const days = p.stages.filter((s) => ph.stageIds.includes(s.id)).reduce((n, s) => n + workDaysBetween(s.startsAt, s.endsAt), 0);
      if (!days) continue;
      const hours = days * 8 * 2;
      selfPerform.push({ phaseId: ph.id, phaseName: ph.name, bid: r2(bid), crew: r2(hours * rate), hours, rate: r2(rate) });
    }
  }
  const stageName = new Map(p.stages.map((s) => [s.id, s.name]));
  const phaseName = new Map(phases.map((x) => [x.id, x.name]));
  const advice = advise({
    settings,
    totals,
    phases,
    selections: selections.selections.map((s) => ({ id: s.id, name: s.name, allowance: s.allowance, chosen: s.state === "chosen", price: s.price, cheaper: s.allowanceSuggested, phaseName: s.stageId ? (phaseName.get(phaseOfStage.get(s.stageId) ?? "") ?? null) : null })),
    quotes: p.subQuotes.map((q) => ({ id: q.id, stageId: q.stageId, stageName: q.stageId ? (stageName.get(q.stageId) ?? null) : null, contractor: q.contractor.name, amount: q.status === "INVOICED" ? (q.invoiceAmount ?? q.amount) : q.amount, line: lineFor(q.stage?.weight ?? null, p.stages, p.budgetLines), status: q.status, trade: q.contractor.trade })),
    swaps: [],
    selfPerform,
    contingency,
  });

  return { settings, words: settingsWords(settings), kind: p.kind, costBudget, laidOut, phases, loose, totals, contract, impliedPrice, margin, profit, contingency, advice, today };
}

/** A stage's share of the Subcontractors line, the way the Contractors card compares a quote (lib/projectSubs stageSubsBudget). */
function lineFor(stageWeight: number | null, stages: ReadonlyArray<{ weight: number }>, lines: ReadonlyArray<{ category: string; amount: number }>): number | null {
  if (stageWeight == null) return null;
  const subs = lines.filter((l) => l.category === "SUBCONTRACTORS").reduce((n, l) => n + l.amount, 0);
  if (subs <= 0) return null;
  const total = stages.reduce((n, s) => n + Math.max(0, s.weight), 0);
  return total > 0 ? r2((subs * stageWeight) / total) : null;
}

// ── the writes ───────────────────────────────────────────────────────────────

async function projectOf(organizationId: string, projectId: string) {
  const p = await db.project.findFirst({ where: { id: projectId, organizationId }, select: { id: true, name: true, clientId: true, budget: true } });
  if (!p) throw new Error("Project not found");
  return p;
}

/** The phases' budgets from the cost budget by their shares (a total given replaces the cost budget first). */
export async function layoutBudget(organizationId: string, projectId: string, total: number | null, actorId: string | null): Promise<{ total: number; phases: Array<{ id: string; name: string; budget: number }> }> {
  const p = await projectOf(organizationId, projectId);
  const phases = await db.projectPhase.findMany({ where: { projectId: p.id }, orderBy: { position: "asc" }, select: { id: true, name: true, share: true } });
  if (!phases.length) throw new Error("This project has no phases — a budget is laid out over a new build's phases.");
  const sum = total != null && total > 0 ? r2(total) : r2(p.budget);
  if (!(sum > 0)) throw new Error("Set the cost budget first — the phases take their shares of it.");
  const laid = layoutPhaseBudgets(sum, phases);
  await db.$transaction([
    ...laid.map((x) => db.projectPhase.update({ where: { id: x.id }, data: { budget: x.budget } })),
    ...(sum !== r2(p.budget) ? [db.project.update({ where: { id: p.id }, data: { budget: sum } })] : []),
  ]);
  await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.PROJECT, summary: `Laid out ${dollars(sum)} over ${phases.length} phases of ${p.name}`, clientId: p.clientId, meta: { projectId: p.id, total: sum } });
  return { total: sum, phases: laid.map((x) => ({ id: x.id, name: phases.find((y) => y.id === x.id)?.name ?? "", budget: x.budget })) };
}

export async function setPhaseBudget(organizationId: string, phaseId: string, budget: number, actorId: string | null): Promise<void> {
  const ph = await db.projectPhase.findFirst({ where: { id: phaseId, organizationId }, select: { id: true, name: true, budget: true, project: { select: { id: true, name: true, clientId: true } } } });
  if (!ph) throw new Error("Phase not found");
  const amt = r2(Math.max(0, budget));
  await db.projectPhase.update({ where: { id: ph.id }, data: { budget: amt } });
  await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.PROJECT, summary: `${ph.name} budget ${ph.budget != null ? `${dollars(ph.budget)} → ` : ""}${dollars(amt)} on ${ph.project.name}`, clientId: ph.project.clientId, meta: { projectId: ph.project.id, phaseId: ph.id, budget: amt } });
}

export type MoneyPatch = Partial<MoneySettings>;

export async function setMoneySettings(organizationId: string, projectId: string, patch: MoneyPatch, actorId: string | null): Promise<MoneySettings> {
  const p = await db.project.findFirst({ where: { id: projectId, organizationId }, select: { id: true, name: true, clientId: true, forWhom: true, moneyMode: true, marginPct: true, feeAmount: true, salePrice: true } });
  if (!p) throw new Error("Project not found");
  const next = parseMoneySettings({ ...p, ...patch });
  await db.project.update({ where: { id: p.id }, data: { forWhom: next.forWhom, moneyMode: next.moneyMode, marginPct: next.marginPct, feeAmount: next.feeAmount, salePrice: next.salePrice } });
  await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.PROJECT, summary: `${p.name} is ${settingsWords(next)}`, clientId: p.clientId, meta: { projectId: p.id, ...next } });
  return next;
}

/** One tap on the advisor's list. Returns the words for the card's note. */
export async function applyAdvice(organizationId: string, projectId: string, kind: Advice["kind"], ref: Record<string, string | number | null>, actorId: string | null): Promise<string> {
  const p = await projectOf(organizationId, projectId);
  const tz = await tzOf(organizationId);
  const today = localDayKey(new Date(), tz);
  if (kind === "lower_allowance") {
    const id = String(ref.selectionId ?? "");
    const allowance = Number(ref.allowance);
    if (!id || !(allowance >= 0)) throw new Error("Which selection, and to what?");
    const before = await db.projectSelection.findFirst({ where: { id, projectId: p.id }, select: { name: true, allowance: true } });
    if (!before) throw new Error("Selection not found");
    await updateSelection(organizationId, id, { allowance }, actorId);
    const words = `${before.name} allowance ${before.allowance != null ? `${dollars(before.allowance)} → ` : ""}${dollars(allowance)}`;
    await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.PROJECT, summary: `Advisor: ${words} on ${p.name}`, clientId: p.clientId, meta: { projectId: p.id, advice: kind } });
    return `${words}. The client picks within it.`;
  }
  if (kind === "rebid_sub") {
    const quoteId = String(ref.quoteId ?? "");
    const q = await db.projectSubQuote.findFirst({ where: { id: quoteId, projectId: p.id }, select: { stageId: true, contractorId: true, contractor: { select: { trade: true } }, stage: { select: { id: true, name: true, tasks: { select: { title: true } } } } } });
    if (!q?.stage) throw new Error("That quote has no stage to re-bid");
    const asked = new Set((await db.projectSubQuote.findMany({ where: { projectId: p.id, stageId: q.stage.id }, select: { contractorId: true } })).map((x) => x.contractorId));
    const all = await contractorsOf(organizationId);
    const trade = q.contractor.trade;
    const pool = all.filter((c) => !asked.has(c.id) && (c.phone || c.email) && (!trade || c.trade === trade));
    const pick = pool.slice(0, 2);
    if (!pick.length) throw new Error(`Nobody else ${trade ? `in ${trade.toLowerCase()} ` : ""}on your list with a phone or an email who has not been asked — add a contractor on the Contractors card first.`);
    const r = await askQuotes(organizationId, actorId, { projectId: p.id, stageId: q.stage.id, contractorIds: pick.map((c) => c.id), scope: scopeFor(q.stage.name, q.stage.tasks.map((t) => t.title)), dueBy: replyByDefault(today) });
    await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.PROJECT, summary: `Advisor: re-bid ${q.stage.name} on ${p.name} — asked ${r.asked.map((a) => a.contractor).join(" and ")}`, clientId: p.clientId, meta: { projectId: p.id, advice: kind, stageId: q.stage.id } });
    return `Asked ${r.asked.map((a) => a.contractor).join(" and ")} to quote ${q.stage.name}. A quote under the line replaces the award when you award it.`;
  }
  if (kind === "move_contingency") {
    const fromIds = String(ref.fromPhaseIds ?? "").split(",").filter(Boolean);
    const amount = Number(ref.amount);
    if (!fromIds.length || !(amount > 0)) throw new Error("Nothing to move");
    const read = await moneyPlanOf(organizationId, p.id);
    const from = read.phases.filter((x) => fromIds.includes(x.id) && x.left > 0);
    const to = read.phases.filter((x) => x.over > 0).sort((a, b) => b.over - a.over);
    if (!from.length || !to.length) throw new Error("Nothing to move — no slack, or nothing over");
    let left = amount;
    const moves: Array<{ id: string; delta: number }> = [];
    for (const f of from) {
      const take = r2(Math.min(f.left, left));
      if (take <= 0) continue;
      moves.push({ id: f.id, delta: -take });
      left = r2(left - take);
      if (left <= 0) break;
    }
    const moved = r2(amount - left);
    let give = moved;
    for (const t of to) {
      const put = r2(Math.min(t.over, give));
      if (put <= 0) continue;
      moves.push({ id: t.id, delta: put });
      give = r2(give - put);
      if (give <= 0) break;
    }
    if (give > 0 && to.length) moves.push({ id: to[0].id, delta: give });
    await db.$transaction(moves.map((m) => db.projectPhase.update({ where: { id: m.id }, data: { budget: { increment: m.delta } } })));
    const words = `Moved ${dollars(moved)} from ${from.map((f) => f.name).join(", ")} to ${to.slice(0, moves.filter((m) => m.delta > 0).length).map((t) => t.name).join(", ")}`;
    await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.PROJECT, summary: `Advisor: ${words} on ${p.name}`, clientId: p.clientId, meta: { projectId: p.id, advice: kind, moved } });
    return `${words}.`;
  }
  if (kind === "defer_scope") {
    const phaseId = String(ref.phaseId ?? "");
    const ph = await db.projectPhase.findFirst({ where: { id: phaseId, projectId: p.id }, select: { id: true, name: true, budget: true } });
    if (!ph) throw new Error("Phase not found");
    const out = r2(ph.budget ?? 0);
    await db.projectPhase.update({ where: { id: ph.id }, data: { budget: 0 } });
    await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.PROJECT, summary: `Advisor: deferred ${ph.name} on ${p.name} — ${dollars(out)} out of the plan; its stages stay to pick up later`, clientId: p.clientId, meta: { projectId: p.id, advice: kind, phaseId: ph.id, budget: out } });
    return `${ph.name} deferred — ${dollars(out)} out of the plan. Its stages stay; give it a budget again to bring it back.`;
  }
  throw new Error("That suggestion is a thing to do, not a tap.");
}
