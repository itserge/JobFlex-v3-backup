// What a job makes — the one place the money of a single job is worked out
// (2026-09-20).
//
// Owner: "make same to job flex that will reflect financials to the each
// job." The company's Financials page answers for the month; nobody could
// answer for a job. Every number below already exists in the app, so this
// module only puts them together:
//
//   contract   = the proposal's total plus the approved change orders —
//                what the client owes (lib/contractTotal).
//   collected  = the payments that landed against it.
//   planned    = the estimate's own cost side: every line's quantity times
//                its material and labor COST, the figures the markup was
//                applied to. The client price is never read as a cost.
//                BUT the builder's material / labor columns split the PRICE
//                (unitPrice = material + labor), so a priced proposal's lines
//                carry no cost at all (owner walk, 2026-11-04: the job "made"
//                its sales tax). The job page passes `plannedCost` instead —
//                a project job's share of the project's cost budget, else 0 —
//                and the lines only divide it into material and labor.
//   revenue    = the contract before sales tax: the tax is the state's, so
//                the profit is worked from this, never from `contract`.
//   crew       = what the workers on the job are paid (JobAssignment.pay).
//   expenses   = the receipts booked against the job (JobExpense).
//   repairs    = what its come-backs cost (their own crew, receipts, stock —
//                lib/jobCost folds them in; 2026-11-09).
//   cost       = crew + expenses + repairs once anything is booked; until
//                then the planned cost stands in, marked as planned.
//   profit     = revenue − cost.
//
// Pure: no database, no server imports, so the job page, the Financials
// page and the QA all agree on one arithmetic.

export type CostingLine = {
  quantity: number;
  /** Per unit, before markup — what the work costs us. */
  materialCost: number;
  laborCost: number;
};

export type JobCostingInput = {
  /** The client's contract: the proposal total with approved change orders. */
  contract: number;
  /** The same before sales tax — what the profit is worked from. Defaults to `contract`. */
  revenue?: number;
  /** Payments received against it. */
  collected: number;
  /** The proposal's line items, for the planned cost. */
  lines: readonly CostingLine[];
  /** The planned cost from elsewhere (a project job: its share of the project's cost budget). Overrides the lines'
   *  own figures, which then only split it into material and labor. */
  plannedCost?: number;
  /** Every worker's pay on this job. */
  crewPay: readonly number[];
  /** Expenses booked against the job — the APPROVED and REIMBURSED ones (lib/expenseTotals). */
  expenses: readonly number[];
  /** Receipts on review (SUBMITTED): shown apart, never in the cost. */
  pendingExpenses?: readonly number[];
  /** Materials taken from the warehouse for the job, at the items' last cost (2026-09-20). */
  stock?: number;
  /** What the job's repairs (come-backs) cost (lib/jobCost `repairs`). */
  repairs?: number;
};

export type JobMoney = {
  contract: number;
  /** The contract before sales tax. */
  revenue: number;
  /** contract − revenue: collected for the state, never profit. */
  salesTax: number;
  collected: number;
  /** Still to collect on the contract, never negative. */
  outstanding: number;
  planned: { material: number; labor: number; total: number };
  crew: number;
  expenses: number;
  /** Receipts on review — apart from the cost. */
  expensesPending: number;
  /** Warehouse materials on the job, at cost. */
  stock: number;
  /** Its come-backs' cost. */
  repairs: number;
  /** What the job has cost: crew + expenses + stock + repairs, or the planned cost until one is booked. */
  cost: number;
  /** True while the cost is the estimate's, because nothing is booked yet. */
  costIsPlanned: boolean;
  /** False while nothing is booked and there is no plan: the profit is not known yet. */
  costKnown: boolean;
  profit: number;
  /** profit ÷ revenue, 0 when there is no contract. */
  marginPct: number;
  /** What the estimate said the job would make. */
  plannedProfit: number;
  plannedMarginPct: number;
  /** Booked cost less planned cost: over on the job when positive. */
  costVariance: number;
};

const money = (n: number) => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
const sum = (xs: readonly number[]) => xs.reduce((a, x) => a + (Number.isFinite(x) ? x : 0), 0);

export function jobMoney(input: JobCostingInput): JobMoney {
  const contract = money(Math.max(0, input.contract));
  const revenue = money(Math.min(contract, Math.max(0, input.revenue ?? contract)));
  const collected = money(Math.max(0, input.collected));
  const lineMaterial = sum(input.lines.map((l) => Math.max(0, l.quantity) * Math.max(0, l.materialCost)));
  const lineLabor = sum(input.lines.map((l) => Math.max(0, l.quantity) * Math.max(0, l.laborCost)));
  let material = money(lineMaterial);
  let labor = money(lineLabor);
  if (input.plannedCost !== undefined) {
    const plan = money(Math.max(0, input.plannedCost));
    const both = lineMaterial + lineLabor;
    material = money(both > 0 ? (plan * lineMaterial) / both : plan);
    labor = money(plan - material);
  }
  const plannedTotal = money(material + labor);
  const crew = money(sum(input.crewPay.map((p) => Math.max(0, p))));
  const expenses = money(sum(input.expenses.map((e) => Math.max(0, e))));
  const expensesPending = money(sum((input.pendingExpenses ?? []).map((e) => Math.max(0, e))));
  const stock = money(Math.max(0, input.stock ?? 0));
  const repairs = money(Math.max(0, input.repairs ?? 0));
  const booked = money(crew + expenses + stock + repairs);
  const costIsPlanned = booked <= 0 && plannedTotal > 0;
  const cost = costIsPlanned ? plannedTotal : booked;
  const profit = money(revenue - cost);
  const plannedProfit = money(revenue - plannedTotal);
  return {
    contract,
    revenue,
    salesTax: money(contract - revenue),
    collected,
    outstanding: money(Math.max(0, contract - collected)),
    planned: { material, labor, total: plannedTotal },
    crew,
    expenses,
    expensesPending,
    stock,
    repairs,
    cost,
    costIsPlanned,
    costKnown: booked > 0 || plannedTotal > 0,
    profit,
    marginPct: revenue > 0 ? Math.round((profit / revenue) * 1000) / 10 : 0,
    plannedProfit,
    plannedMarginPct: revenue > 0 ? Math.round((plannedProfit / revenue) * 1000) / 10 : 0,
    costVariance: money(booked - plannedTotal),
  };
}

/** One line of the money card, for a worker on the job. */
export type CrewShare = { assignmentId: string; workerId: string; name: string; pay: number; paidAt: string | null };

/** What the crew costs and how much of it is still owed. */
export function crewTotals(crew: readonly CrewShare[]): { pay: number; unpaid: number; paid: number } {
  const pay = money(sum(crew.map((c) => Math.max(0, c.pay))));
  const paid = money(sum(crew.filter((c) => c.paidAt).map((c) => Math.max(0, c.pay))));
  return { pay, paid, unpaid: money(pay - paid) };
}
