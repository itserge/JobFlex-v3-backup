// A job's own money (2026-09-20): the contract, what the estimate said the
// work would cost, what the crew and the receipts actually cost, and the
// profit between them. Pure math, no database, no model call.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/job-money.check.ts
import { crewTotals, jobMoney, type CostingLine } from "../../../src/lib/jobCosting";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

// A 12x8 bath: the estimate's own cost side is 8,000 material + 12,000 labor.
const lines: CostingLine[] = [
  { quantity: 96, materialCost: 50, laborCost: 75 },
  { quantity: 1, materialCost: 3200, laborCost: 4800 },
];
const contract = 38_000;

const planned = jobMoney({ contract, collected: 0, lines, crewPay: [], expenses: [] });
check("the planned cost is the estimate's own material and labor, never the client price",
  planned.planned.material === 8000 && planned.planned.labor === 12000 && planned.planned.total === 20000, JSON.stringify(planned.planned));
check("nothing booked yet: the job is costed at the estimate, and says so",
  planned.cost === 20000 && planned.costIsPlanned && planned.profit === 18000 && planned.marginPct === 47.4, `${planned.cost} ${planned.profit} ${planned.marginPct}%`);

const running = jobMoney({ contract, collected: 11_400, lines, crewPay: [6000, 3500], expenses: [7200, 640.5] });
check("with crew pay and receipts booked, they are the cost — the estimate steps aside",
  !running.costIsPlanned && running.crew === 9500 && running.expenses === 7840.5 && running.cost === 17340.5, JSON.stringify({ crew: running.crew, exp: running.expenses, cost: running.cost }));
check("profit and margin follow the contract", running.profit === 20659.5 && running.marginPct === 54.4, `${running.profit} ${running.marginPct}%`);
check("the estimate stays as the plan to compare against", running.plannedProfit === 18000 && running.costVariance === -2659.5, `${running.plannedProfit} ${running.costVariance}`);
check("what is still to collect", running.collected === 11400 && running.outstanding === 26600);

const over = jobMoney({ contract, collected: contract, lines, crewPay: [9000], expenses: [14_000] });
check("a job that ran over shows it: cost above plan, margin down", over.costVariance === 3000 && over.profit === 15000 && over.outstanding === 0, `${over.costVariance} ${over.profit}`);

const withStock = jobMoney({ contract, collected: 0, lines, crewPay: [6000], expenses: [500], stock: 1200 });
check("materials taken from the warehouse count as cost at the items' last cost", withStock.stock === 1200 && withStock.cost === 7700 && withStock.profit === 30300, `${withStock.cost} ${withStock.profit}`);

const bare = jobMoney({ contract: 0, collected: 0, lines: [], crewPay: [], expenses: [] });
check("no contract, no lines: zeros, no division by zero", bare.cost === 0 && bare.profit === 0 && bare.marginPct === 0 && !bare.costIsPlanned);
const junk = jobMoney({ contract: -5, collected: -2, lines: [{ quantity: -3, materialCost: 10, laborCost: 10 }], crewPay: [-100, 50], expenses: [Number.NaN, 25] });
check("negatives and nonsense never make money", junk.contract === 0 && junk.collected === 0 && junk.planned.total === 0 && junk.crew === 50 && junk.expenses === 25);

// 2026-11-04: the builder's material / labor columns split the PRICE, so the job page passes the plan itself (a
// project job's share of the project's cost budget) and works the profit before sales tax.
const priced: CostingLine[] = [{ quantity: 1, materialCost: 6000, laborCost: 4000 }];
const share = jobMoney({ contract: 10_825, revenue: 10_000, collected: 2000, lines: priced, plannedCost: 7000, crewPay: [], expenses: [] });
check("a project job is planned at its budget share, split like its lines — never at the price",
  share.planned.total === 7000 && share.planned.material === 4200 && share.planned.labor === 2800 && share.costIsPlanned, JSON.stringify(share.planned));
check("the profit is worked before sales tax; the tax is shown apart",
  share.revenue === 10_000 && share.salesTax === 825 && share.profit === 3000 && share.marginPct === 30, `${share.revenue} ${share.salesTax} ${share.profit} ${share.marginPct}%`);
check("what is still to collect keeps the tax — the client pays it", share.outstanding === 8825, String(share.outstanding));
const lone = jobMoney({ contract: 10_825, revenue: 10_000, collected: 0, lines: priced, plannedCost: 0, crewPay: [], expenses: [] });
check("a lone job with nothing booked has no cost yet — its profit is not called the whole price",
  !lone.costKnown && !lone.costIsPlanned && lone.planned.total === 0 && lone.cost === 0, JSON.stringify({ known: lone.costKnown, cost: lone.cost }));
const lonePaid = jobMoney({ contract: 10_825, revenue: 10_000, collected: 0, lines: priced, plannedCost: 0, crewPay: [3000], expenses: [2500] });
check("once crew pay and receipts are booked it is known", lonePaid.costKnown && lonePaid.profit === 4500 && lonePaid.marginPct === 45, `${lonePaid.profit}`);
const odd = jobMoney({ contract: 500, revenue: 900, collected: 0, lines: [], crewPay: [], expenses: [] });
check("the before-tax figure is never above the contract", odd.revenue === 500 && odd.salesTax === 0);

const crew = crewTotals([
  { assignmentId: "a1", workerId: "w1", name: "Ivan", pay: 6000, paidAt: "2026-09-19T00:00:00.000Z" },
  { assignmentId: "a2", workerId: "w2", name: "Pete", pay: 3500, paidAt: null },
]);
check("the crew card: what they earn, what is paid, what is still owed", crew.pay === 9500 && crew.paid === 6000 && crew.unpaid === 3500, JSON.stringify(crew));

console.log(bad ? `\n${bad} check(s) FAILED` : "\nall checks passed");
process.exit(bad ? 1 : 0);
