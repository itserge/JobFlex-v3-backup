// WHAT A JOB HAS COST (stage D, 2026-09-30) — server, ONE function for the
// job page and Financials.
//
// The owner's rule, "job or stock": the company's totals count money once,
// the day it is spent (lib/expenseTotals, actions/financials); a job's cost
// counts what the job CONSUMED:
//
//   crew     — the pay on its assignments (all of it, paid or not), plus the
//              hours the crew typed at the rate of the day (CrewHours, the crew
//              build 2026-11-05 — lib/crewField hoursCostByJob);
//   receipts — its approved receipts (APPROVED + REIMBURSED; a receipt on
//              review stands apart and is never added);
//   stock    — what was issued to it from the warehouse: PICKED and USED
//              movements, less what was RETURNED, each at the movement's own
//              unitCost, else the item's lastCost, else 0 — and a line with
//              no price at all is named in `unpriced`, so the page can say so.
//
// A purchase FOR STOCK is a company expense and the warehouse's value; it is
// never a job's cost until the stock is issued, so nothing is counted twice.
// Financials' "Cost by job" and the job page's money card both read this, so
// the two agree to the cent — scripts/qa/worker-expenses.check.ts proves it.
//
// REPAIRS (2026-11-09, the ProSmart gaps plan, part 2): a come-back is its own
// job (kind REPAIR) with its own crew pay and receipts, and what it cost lands
// on the job that came back — `repairs` / `repairsCount`, inside `total`. A
// list of every job drops the repair's own entry (each dollar once, under the
// job it belongs to); a caller who asks for the repair by id still gets it.
// crew / receipts / stock stay the job's OWN, so a caller summing those over a
// project's jobs (lib/projectMoney) counts a repair once, through its own row.

import { db } from "@/lib/db";
import { cents, countsInTotals, isPending } from "@/lib/expenseTotals";
import { hoursCostByJob } from "@/lib/crewField/server";
import { foldRepairCosts } from "@/lib/repairs/shared";

export type StockLine = {
  itemId: string;
  name: string;
  unit: string;
  /** Issued to the job (PICKED + USED), in units. */
  taken: number;
  returned: number;
  /** What the net issue cost, at the movements' prices. */
  cost: number;
  /** True when no movement and not the item carried a price — counted at 0. */
  unpriced: boolean;
};

export type JobCost = {
  jobId: string;
  crew: number;
  receipts: number;
  receiptsCount: number;
  /** Receipts on review — shown apart, never in `total`. */
  receiptsPending: number;
  stock: number;
  stockLines: StockLine[];
  /** Names of stock lines counted at $0 because nothing carried a price. */
  unpriced: string[];
  /** What its repairs (come-backs) cost — their crew, receipts and stock — and how many there are. */
  repairs: number;
  repairsCount: number;
  /** crew + receipts + stock + repairs. */
  total: number;
};

const ISSUED = ["PICKED", "USED"];

/** The unit price a movement moved at: its own, else the item's last, else 0. */
export function movementPrice(unitCost: number | null | undefined, lastCost: number | null | undefined): { price: number; priced: boolean } {
  if (unitCost != null && Number.isFinite(unitCost)) return { price: unitCost, priced: true };
  if (lastCost != null && Number.isFinite(lastCost)) return { price: lastCost, priced: true };
  return { price: 0, priced: false };
}

/** The job costs of the given jobs of one company (every job with any cost when `jobIds` is omitted). */
export async function jobCosts(organizationId: string, jobIds?: string[]): Promise<Map<string, JobCost>> {
  // The repairs of the asked jobs come along, so their cost can be folded in (all of them when nothing is asked).
  const repairs = (
    await db.job.findMany({
      where: { organizationId, repairOfId: jobIds ? { in: jobIds } : { not: null } },
      select: { id: true, repairOfId: true },
    })
  ).filter((j): j is { id: string; repairOfId: string } => !!j.repairOfId);
  const ids = jobIds ? [...new Set([...jobIds, ...repairs.map((j) => j.id)])] : undefined;
  const scope = ids ? { id: { in: ids } } : {};
  const [assignments, expenses, moves, hours] = await Promise.all([
    db.jobAssignment.findMany({ where: { job: { organizationId, ...scope } }, select: { jobId: true, pay: true } }),
    db.jobExpense.findMany({ where: { job: { organizationId, ...scope } }, select: { jobId: true, amount: true, status: true } }),
    db.inventoryMovement.findMany({
      where: { kind: { in: [...ISSUED, "RETURNED"] }, item: { organizationId }, ...(ids ? { jobId: { in: ids } } : { jobId: { not: null } }) },
      select: { jobId: true, itemId: true, kind: true, quantity: true, unitCost: true, item: { select: { name: true, unit: true, lastCost: true } } },
    }),
    // The hours the crew typed, at the rate of the day (the crew build, 2026-11-05).
    hoursCostByJob(organizationId, ids),
  ]);

  const out = new Map<string, JobCost>();
  const blank = (jobId: string): JobCost => ({ jobId, crew: 0, receipts: 0, receiptsCount: 0, receiptsPending: 0, stock: 0, stockLines: [], unpriced: [], repairs: 0, repairsCount: 0, total: 0 });
  const get = (jobId: string) => {
    let c = out.get(jobId);
    if (!c) out.set(jobId, (c = blank(jobId)));
    return c;
  };
  for (const id of ids ?? []) get(id);

  for (const a of assignments) get(a.jobId).crew += Math.max(0, a.pay ?? 0);
  for (const [jobId, cost] of hours) get(jobId).crew += cost;
  for (const e of expenses) {
    if (!e.jobId) continue;
    const c = get(e.jobId);
    const amt = Math.max(0, e.amount);
    if (countsInTotals(e.status)) {
      c.receipts += amt;
      c.receiptsCount++;
    } else if (isPending(e.status)) c.receiptsPending += amt;
  }

  // Stock, per job and item: the value issued less the value returned, never below 0.
  const lines = new Map<string, StockLine & { jobId: string; value: number }>();
  for (const m of moves) {
    if (!m.jobId) continue;
    const key = `${m.jobId}|${m.itemId}`;
    const line = lines.get(key) ?? { jobId: m.jobId, itemId: m.itemId, name: m.item.name, unit: m.item.unit, taken: 0, returned: 0, cost: 0, value: 0, unpriced: false };
    const { price, priced } = movementPrice(m.unitCost, m.item.lastCost);
    const qty = Math.abs(m.quantity);
    if (ISSUED.includes(m.kind)) {
      line.taken += qty;
      line.value += qty * price;
      if (!priced && qty > 0) line.unpriced = true;
    } else {
      line.returned += qty;
      line.value -= qty * price;
    }
    lines.set(key, line);
  }
  for (const l of lines.values()) {
    const c = get(l.jobId);
    const cost = cents(Math.max(0, l.value));
    c.stock += cost;
    c.stockLines.push({ itemId: l.itemId, name: l.name, unit: l.unit, taken: l.taken, returned: l.returned, cost, unpriced: l.unpriced });
    if (l.unpriced) c.unpriced.push(l.name);
  }

  for (const c of out.values()) {
    c.crew = cents(c.crew);
    c.receipts = cents(c.receipts);
    c.receiptsPending = cents(c.receiptsPending);
    c.stock = cents(c.stock);
    c.total = cents(c.crew + c.receipts + c.stock);
  }
  // A repair's cost goes to the job that came back; its own entry stays only when it was asked for by id.
  return foldRepairCosts(out, repairs, blank, new Set(jobIds ?? []));
}

/** One job's cost. */
export async function jobCostOf(organizationId: string, jobId: string): Promise<JobCost> {
  return (await jobCosts(organizationId, [jobId])).get(jobId)!;
}
