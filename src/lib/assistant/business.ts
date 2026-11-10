import "server-only";
// BUSINESS QUESTIONS (2026-11-06, the owner's spec §12): "which jobs are losing money", "what did we spend on
// materials this month" — answered from the same arithmetic the job page and the Financials page use, never a
// figure of the model's own. The job's money is lib/jobCosting over lib/jobCost (crew pay, approved receipts, stock
// issued) and the contract before sales tax (lib/contractTotal); the spending is the Financials' own expense rows,
// counted the way it counts them (lib/expenseTotals), on the company's clock.
import { z } from "zod";
import { db } from "@/lib/db";
import type { ReadTool } from "@/lib/assistant/tools";
import { money } from "@/lib/assistant/shared";
import { zonedInstant, zonedParts } from "@/lib/booking";
import { jobCosts } from "@/lib/jobCost";
import { jobMoney } from "@/lib/jobCosting";
import { contractRevenue, contractTotal } from "@/lib/contractTotal";
import { EXPENSE_COUNTED } from "@/lib/expenseTotals";

const DAY_MS = 86_400_000;
const OPEN_STATUSES = ["SCHEDULED", "IN_PROGRESS", "PENDING"];

const jobsMoney: ReadTool<{ which: "losing" | "best" | "open" }> = {
  kind: "read",
  name: "jobs_money",
  need: "money.read",
  card: {
    label: "Job profit",
    purpose: "Each job's revenue, cost and profit — the job page's own money, for every job at once.",
    when: "'Which jobs are losing money', 'what did the Lee job make', 'how are the open jobs doing': jobs_money(which) — losing (cost over revenue, worst first), best (most profit first), open (the jobs under way). Say the figures as given; a job with nothing booked yet is not losing, it is unmeasured.",
    objects: ["job", "money", "client"],
    effect: "read",
    group: "lookups",
    version: 1,
    since: "2026-11-06",
    samples: [
      { say: "which jobs are losing money?", args: { which: "losing" } },
      { say: "how are the open jobs doing?", args: { which: "open" } },
    ],
  },
  description:
    "Every recent job's money from the job costing: the contract before sales tax (revenue), what was collected, the cost booked so far (crew pay, approved receipts, stock issued), the profit and margin. which = losing (the jobs whose booked cost is over their revenue, worst first), best (most profit first), open (the jobs scheduled or under way, newest first). Use for: which jobs are losing money, what did the Lee job make, how are the open jobs doing.",
  params: z.object({ which: z.enum(["losing", "best", "open"]).describe("losing = cost over revenue, worst first; best = most profit first; open = the jobs under way, newest first") }),
  async run({ actor, now }, args) {
    const org = actor.organizationId;
    const jobs = await db.job.findMany({
      where: {
        organizationId: org,
        status: args.which === "open" ? { in: OPEN_STATUSES } : { not: "CANCELED" },
        ...(args.which === "open" ? {} : { createdAt: { gte: new Date(now.getTime() - 120 * DAY_MS) } }),
      },
      orderBy: { createdAt: "desc" },
      take: 80,
      select: {
        id: true,
        title: true,
        status: true,
        client: { select: { name: true } },
        proposal: {
          select: {
            total: true,
            taxTotal: true,
            currency: true,
            lineItems: { select: { quantity: true, materialCost: true, laborCost: true } },
            payments: { where: { status: { in: ["PAID", "PARTIAL", "PARTIALLY_REFUNDED"] } }, select: { amount: true, refundedAmount: true } },
            changeOrders: { select: { status: true, total: true, amount: true } },
          },
        },
      },
    });
    const priced = jobs.filter((j) => j.proposal);
    const costs = priced.length ? await jobCosts(org, priced.map((j) => j.id)) : new Map();
    const rows = priced.map((j) => {
      const p = j.proposal!;
      const c = costs.get(j.id);
      const m = jobMoney({
        contract: contractTotal(p.total, p.changeOrders),
        revenue: contractRevenue(p.total, p.taxTotal, p.changeOrders),
        collected: p.payments.reduce((a, x) => a + Math.max(0, x.amount - (x.refundedAmount ?? 0)), 0),
        lines: p.lineItems,
        plannedCost: 0,
        crewPay: [c?.crew ?? 0],
        expenses: [c?.receipts ?? 0],
        pendingExpenses: [c?.receiptsPending ?? 0],
        stock: c?.stock ?? 0,
        repairs: c?.repairs ?? 0,
      });
      const booked = (c?.total ?? 0) > 0;
      return {
        jobId: j.id,
        title: j.title,
        client: j.client?.name ?? null,
        status: j.status,
        revenue: money(m.revenue, p.currency),
        collected: money(m.collected, p.currency),
        cost: booked ? money(m.cost, p.currency) : "nothing booked yet",
        profit: booked ? money(m.profit, p.currency) : "not measured yet",
        marginPct: booked ? Math.round(m.marginPct) : null,
        _profit: m.profit,
        _booked: booked,
      };
    });
    const sorted =
      args.which === "losing"
        ? rows.filter((r) => r._booked && r._profit < 0).sort((a, b) => a._profit - b._profit)
        : args.which === "best"
          ? rows.filter((r) => r._booked).sort((a, b) => b._profit - a._profit)
          : rows;
    const unmeasured = rows.filter((r) => !r._booked).length;
    return {
      which: args.which,
      jobs: sorted.slice(0, 12).map((r) => ({ jobId: r.jobId, title: r.title, client: r.client, status: r.status, revenue: r.revenue, collected: r.collected, cost: r.cost, profit: r.profit, marginPct: r.marginPct })),
      counted: rows.length,
      unmeasured,
      note:
        args.which === "losing" && !sorted.length
          ? `No job has a booked cost over its revenue${unmeasured ? ` (${unmeasured} ${unmeasured === 1 ? "job has" : "jobs have"} nothing booked yet, so ${unmeasured === 1 ? "its" : "their"} profit isn't measured)` : ""}.`
          : "Revenue is the contract before sales tax; cost is crew pay, approved receipts and stock issued to the job (the job page's own figures). Jobs without a proposal are left out.",
    };
  },
};

const PERIODS = ["this_month", "last_month", "last_30_days"] as const;

function periodRange(period: (typeof PERIODS)[number], now: Date, tz: string): { from: Date; to: Date; label: string } {
  if (period === "last_30_days") return { from: new Date(now.getTime() - 30 * DAY_MS), to: now, label: "the last 30 days" };
  const p = zonedParts(now, tz);
  const startOfThis = zonedInstant(p.y, p.m, 1, 0, 0, tz);
  const monthName = (y: number, m: number) => new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  if (period === "this_month") return { from: startOfThis, to: now, label: monthName(p.y, p.m) };
  const y = p.m === 1 ? p.y - 1 : p.y;
  const m = p.m === 1 ? 12 : p.m - 1;
  return { from: zonedInstant(y, m, 1, 0, 0, tz), to: startOfThis, label: monthName(y, m) };
}

const spending: ReadTool<{ period: (typeof PERIODS)[number]; category: string | null }> = {
  kind: "read",
  name: "spending",
  need: "money.read",
  card: {
    label: "Spending",
    purpose: "What was spent in a period — receipts by category, stock purchases, crew pay — from the Financials' own rows.",
    when: "'What did we spend on materials this month', 'how much went to fuel last month', 'what are we spending on': spending(period, category or null for everything).",
    objects: ["money", "job"],
    effect: "read",
    group: "lookups",
    version: 1,
    since: "2026-11-06",
    samples: [
      { say: "what did we spend on materials this month?", args: { period: "this_month", category: "materials" } },
      { say: "what are we spending on?", args: { period: "last_30_days", category: null } },
    ],
  },
  description:
    "What the company spent in a period, from the approved and reimbursed expense rows the Financials page counts: by category (materials, fuel, equipment, permits…), the biggest jobs, stock purchases apart, and the crew pay paid out. category = one word to narrow it ('materials'), or null for everything. Use for: what did we spend on materials, how much went to fuel last month, what are we spending on.",
  params: z.object({ period: z.enum(PERIODS), category: z.string().max(40).nullable().describe("a category in their words, or null for all") }),
  async run({ actor, now }, args) {
    const org = actor.organizationId;
    const { from, to, label } = periodRange(args.period, now, actor.timezone);
    const inRange = { OR: [{ spentAt: { gte: from, lt: to } }, { spentAt: null, createdAt: { gte: from, lt: to } }] };
    const [rows, paid] = await Promise.all([
      db.jobExpense.findMany({
        where: { status: { in: [...EXPENSE_COUNTED] }, AND: [{ OR: [{ organizationId: org }, { job: { organizationId: org } }] }, inRange] },
        select: { amount: true, category: true, purpose: true, vendor: true, job: { select: { title: true } } },
        take: 2000,
      }),
      db.jobAssignment.findMany({ where: { job: { organizationId: org }, paidAt: { gte: from, lt: to } }, select: { pay: true } }).catch(() => []),
    ]);
    const want = args.category?.trim().toLowerCase() ?? null;
    const mine = want ? rows.filter((r) => (r.category ?? "").toLowerCase().includes(want) || (r.vendor ?? "").toLowerCase().includes(want)) : rows;
    const byCategory = new Map<string, { amount: number; count: number }>();
    const byJob = new Map<string, number>();
    let stock = 0;
    for (const r of mine) {
      const cat = (r.category?.trim() || "Uncategorised").replace(/^./, (c) => c.toUpperCase());
      const b = byCategory.get(cat) ?? { amount: 0, count: 0 };
      b.amount += r.amount;
      b.count += 1;
      byCategory.set(cat, b);
      if (r.purpose === "STOCK") stock += r.amount;
      else byJob.set(r.job?.title ?? "Stock", (byJob.get(r.job?.title ?? "Stock") ?? 0) + r.amount);
    }
    const total = mine.reduce((a, r) => a + r.amount, 0);
    const crewPay = paid.reduce((a, x) => a + (x.pay ?? 0), 0);
    return {
      period: label,
      category: want,
      total: money(total),
      byCategory: [...byCategory.entries()].sort((a, b) => b[1].amount - a[1].amount).slice(0, 10).map(([category, v]) => ({ category, amount: money(v.amount), receipts: v.count })),
      byJob: [...byJob.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([job, amount]) => ({ job, amount: money(amount) })),
      stockPurchases: money(stock),
      crewPayPaid: want ? null : money(crewPay),
      receipts: mine.length,
      source: "approved and reimbursed expense rows by the date spent (the Financials page's own count); crew pay by the date it was paid",
    };
  },
};

export const BUSINESS_TOOLS = [jobsMoney, spending];
