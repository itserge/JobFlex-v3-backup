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

import { db } from "@/lib/db";
import { cents, countsInTotals, isPending } from "@/lib/expenseTotals";
import { hoursCostByJob } from "@/lib/crewField/server";

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
  /** crew + receipts + stock. */
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
  const scope = jobIds ? { id: { in: jobIds } } : {};
  const [assignments, expenses, moves, hours] = await Promise.all([
    db.jobAssignment.findMany({ where: { job: { organizationId, ...scope } }, select: { jobId: true, pay: true } }),
    db.jobExpense.findMany({ where: { job: { organizationId, ...scope } }, select: { jobId: true, amount: true, status: true } }),
    db.inventoryMovement.findMany({
      where: { kind: { in: [...ISSUED, "RETURNED"] }, item: { organizationId }, ...(jobIds ? { jobId: { in: jobIds } } : { jobId: { not: null } }) },
      select: { jobId: true, itemId: true, kind: true, quantity: true, unitCost: true, item: { select: { name: true, unit: true, lastCost: true } } },
    }),
    // The hours the crew typed, at the rate of the day (the crew build, 2026-11-05).
    hoursCostByJob(organizationId, jobIds),
  ]);

  const out = new Map<string, JobCost>();
  const get = (jobId: string) => {
    let c = out.get(jobId);
    if (!c) out.set(jobId, (c = { jobId, crew: 0, receipts: 0, receiptsCount: 0, receiptsPending: 0, stock: 0, stockLines: [], unpriced: [], total: 0 }));
    return c;
  };
  for (const id of jobIds ?? []) get(id);

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
  return out;
}

/** One job's cost. */
export async function jobCostOf(organizationId: string, jobId: string): Promise<JobCost> {
  return (await jobCosts(organizationId, [jobId])).get(jobId)!;
}
