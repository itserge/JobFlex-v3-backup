import "server-only";
// A PROJECT'S MONEY, READ ONCE (owner, 2026-11-04: "make it a smart projects hub … the budgets and financials, and
// make sure it reflects on the Financials page"). The one server read behind the project page's Budget card, the
// Projects list and Financials' projects, so the three can never tell a different story. The arithmetic is
// lib/projectBudget summarizeBudget (pure); this file only gathers its rows:
//
//   contract  — each sold proposal before sales tax (total − taxTotal) plus its approved change orders before tax
//               (`amount`); `billed` keeps the tax. A legacy approved order with no `total` was folded into the
//               proposal's total by the old code, so it adds nothing here either (lib/contractTotal's rule);
//   spent     — every cost logged on the project (summed in the database, never a page of the newest rows), the
//               project's jobs' approved receipts by their own category, the crew's pay on those jobs (Labor) and
//               the warehouse stock issued to them (Materials) — lib/jobCost, the same figures the job page shows;
//   uncosted  — approved change orders with no budget line under their label (lib/projectBudget changeLineLabel);
//   collected — what the client has paid on the project's proposals (Payment rows paid or part-paid, less refunds).
import { contractRevenue } from "@/lib/contractTotal";
import { db } from "@/lib/db";
import { jobCosts } from "@/lib/jobCost";
import { changeLineLabel, summarizeBudget, type BudgetSummary, type ContractIn, type SpendIn, type UncostedChange } from "@/lib/projectBudget";

export type ProjectMoney = BudgetSummary & {
  /** Paid by the client on the project's proposals. */
  collected: number;
  /** What is billed (with tax) and not yet paid. */
  owed: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Each project's money, by id. Projects outside the organization are left out. */
export async function projectMoney(organizationId: string, projectIds: string[]): Promise<Map<string, ProjectMoney>> {
  const out = new Map<string, ProjectMoney>();
  if (!projectIds.length) return out;
  const projects = await db.project.findMany({
    where: { organizationId, id: { in: projectIds } },
    select: {
      id: true,
      budget: true,
      budgetLines: { select: { category: true, amount: true, label: true } },
      proposals: {
        where: { status: { not: "ARCHIVED" } },
        select: {
          id: true,
          status: true,
          total: true,
          taxTotal: true,
          changeOrders: { where: { status: "APPROVED" }, select: { id: true, status: true, number: true, title: true, amount: true, total: true } },
        },
      },
      jobs: { select: { id: true } },
    },
  });
  if (!projects.length) return out;

  const jobIds = projects.flatMap((p) => p.jobs.map((j) => j.id));
  const proposalIds = projects.flatMap((p) => p.proposals.map((x) => x.id));
  const [projectSpends, jobReceipts, costs, paid] = await Promise.all([
    db.projectExpense.groupBy({ by: ["projectId", "category"], where: { projectId: { in: projects.map((p) => p.id) } }, _sum: { amount: true } }),
    jobIds.length
      ? db.jobExpense.groupBy({ by: ["jobId", "category"], where: { jobId: { in: jobIds }, status: { in: ["APPROVED", "REIMBURSED"] } }, _sum: { amount: true } })
      : Promise.resolve([] as Array<{ jobId: string | null; category: string | null; _sum: { amount: number | null } }>),
    jobIds.length ? jobCosts(organizationId, jobIds) : Promise.resolve(new Map()),
    proposalIds.length
      ? db.payment.groupBy({ by: ["proposalId"], where: { proposalId: { in: proposalIds }, status: { in: ["PAID", "PARTIAL", "PARTIALLY_REFUNDED"] } }, _sum: { amount: true, refundedAmount: true } }).catch(() => [])
      : Promise.resolve([]),
  ]);
  const paidBy = new Map<string, number>();
  for (const row of paid as Array<{ proposalId: string | null; _sum: { amount: number | null; refundedAmount: number | null } }>) {
    if (row.proposalId) paidBy.set(row.proposalId, Math.max(0, (row._sum.amount ?? 0) - (row._sum.refundedAmount ?? 0)));
  }

  for (const p of projects) {
    const jobsHere = new Set(p.jobs.map((j) => j.id));
    const spends: SpendIn[] = [
      ...projectSpends.filter((s) => s.projectId === p.id).map((s) => ({ category: s.category, amount: s._sum.amount ?? 0 })),
      ...jobReceipts.filter((s) => !!s.jobId && jobsHere.has(s.jobId)).map((s) => ({ category: s.category ?? "OTHER", amount: s._sum.amount ?? 0 })),
    ];
    for (const id of jobsHere) {
      const c = costs.get(id);
      if (!c) continue;
      if (c.crew > 0) spends.push({ category: "LABOR", amount: c.crew });
      if (c.stock > 0) spends.push({ category: "MATERIALS", amount: c.stock });
    }
    const costed = new Set(p.budgetLines.filter((l) => l.label).map((l) => l.label as string));
    const uncosted: UncostedChange[] = [];
    let billedAll = 0;
    let collected = 0;
    const proposals: ContractIn[] = p.proposals.map((x) => {
      const cos = x.changeOrders.filter((c) => c.total != null);
      for (const c of cos) {
        const label = changeLineLabel(c.number, c.title);
        if (!costed.has(label) && c.amount > 0) uncosted.push({ id: c.id, label, amount: c.amount });
      }
      const revenue = contractRevenue(x.total ?? 0, x.taxTotal, x.changeOrders);
      const billed = Math.max(0, x.total ?? 0) + cos.reduce((n, c) => n + (c.total ?? 0), 0);
      if (["ACCEPTED", "COMPLETED", "PAID"].includes(x.status)) {
        billedAll += billed;
        collected += paidBy.get(x.id) ?? 0;
      }
      return { status: x.status, revenue, billed };
    });
    const summary = summarizeBudget({ lines: p.budgetLines, projectBudget: p.budget, spends, proposals, uncosted });
    out.set(p.id, { ...summary, collected: r2(collected), owed: r2(Math.max(0, billedAll - collected)) });
  }
  return out;
}
