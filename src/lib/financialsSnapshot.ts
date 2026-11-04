// THE FINANCIALS READ — one query set, two editions.
//
// These queries and the mapping into the page's row shapes used to live inline
// in src/app/dashboard/financials/page.tsx, which was fine while the desktop
// sheet was the only surface reading them. The handheld edition of the same
// route is mounted PROPS-LESS by the responsive shell
// (components/v3/responsive-shell/responsive-dashboard-shell.tsx), so it cannot
// be handed the page's data — it has to ask for it. Rather than let a second
// copy of these queries drift away from the first, both editions read this
// module: the desktop page calls it directly, the handheld one through the
// org-scoped `loadFinancials()` action (src/actions/financialsMobile.ts).
//
// SERVER ONLY — it touches Prisma. A client component wanting these shapes
// imports the TYPES from components/v3/financials-blueprint/financials-data
// (or the handheld copy in (mobile)/mobile-financials-v2/financials-data),
// never this file.

import { db } from "@/lib/db";
import { mediaHref } from "@/lib/media/signedLink";
import { getOfficeMoney } from "@/lib/officeMoney";
import type { OfficeMoney } from "@/components/v3/crew-board/office-review-data";
import { getFinancialsRollup, getMonthlyRollup } from "@/actions/financials";
import { contractSchedule } from "@/lib/contractTotal";
import { fromMinor, resolveSchedule } from "@/lib/paymentSchedule";
import { projectMoney } from "@/lib/projectMoney";
import type {
  ChangeOrder,
  Expense,
  FinancialsProject,
  Invoice,
  InvoiceTarget,
  MonthPoint,
  Rollup,
} from "@/components/v3/financials-blueprint/financials-data";

/** A job a receipt can be charged to. Mirrors `FinancialsJob` in
 *  components/v3/financials-blueprint/financials-behavior.ts. */
export type FinancialsJob = { id: string; title: string; status: string };

/** Everything either edition of the Financials surface draws, except the
 *  Overhead tab — that one is its own read (lib/overhead.ts) on both. */
export type FinancialsSnapshot = {
  jobs: FinancialsJob[];
  monthly: MonthPoint[];
  rollup: Rollup;
  expenses: Expense[];
  orders: ChangeOrder[];
  invoices: Invoice[];
  /** What "New invoice" can bill — read from the CONTRACTS, not from the book. */
  invoiceTargets: InvoiceTarget[];
  /** The review queue, what is owed to workers, the cost of each job and the
   *  purchases for stock (stage D, lib/officeMoney). */
  office: OfficeMoney;
  /** What each live project makes (lib/projectMoney) — the overview's Projects card (2026-11-04). */
  projects: FinancialsProject[];
};

/** The ledger plate the tables print: "Jul 22", never a full date. Formatted
 *  here rather than on the client so every row is stamped by ONE clock. */
function plate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "2-digit" });
}

export async function getFinancialsSnapshot(
  organizationId: string,
): Promise<FinancialsSnapshot> {
  const [rollupRaw, monthlyRaw, expenseRows, orderRows, invoiceRows, jobs, openContracts, office, projects] = await Promise.all([
    getFinancialsRollup(organizationId),
    getMonthlyRollup(organizationId, 12),
    // Receipts for jobs AND purchases for stock (no job) — stage D.
    db.jobExpense.findMany({
      where: { OR: [{ organizationId }, { job: { organizationId } }] },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { job: { select: { id: true, title: true } } },
    }),
    db.changeOrder.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        job: { select: { id: true, title: true } },
        proposal: { select: { title: true } },
      },
    }),
    db.invoice.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    // Jobs a receipt can be charged to. Live work first — a receipt in hand
    // almost always belongs to something open — then the rest, newest first.
    db.job.findMany({
      where: { organizationId },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      select: { id: true, title: true, status: true },
      take: 200,
    }),
    // What "New invoice" can bill. Read from the CONTRACTS — every accepted
    // proposal that still owes money — and NOT from the invoice book: deriving
    // the list from rows that already exist made the first invoice on a
    // proposal impossible to raise from this page.
    db.proposal.findMany({
      where: { organizationId, status: "ACCEPTED" },
      orderBy: { acceptedAt: "desc" },
      take: 200,
      select: {
        id: true,
        title: true,
        total: true,
        currency: true,
        client: { select: { name: true } },
        installments: { orderBy: { position: "asc" } },
        changeOrders: { where: { status: "APPROVED" }, select: { status: true, total: true } },
      },
    }),
    getOfficeMoney(organizationId),
    projectRows(organizationId),
  ]);

  // Invoices carry a clientId, not a client relation, so the names are looked
  // up in one extra query — same shape as the classic invoices page.
  const clientIds = Array.from(
    new Set(invoiceRows.map((i) => i.clientId).filter((x): x is string => Boolean(x))),
  );
  const clients = clientIds.length
    ? await db.client.findMany({ where: { id: { in: clientIds } }, select: { id: true, name: true } })
    : [];
  const clientName = new Map(clients.map((c) => [c.id, c.name]));

  const now = new Date();

  const monthly: MonthPoint[] = monthlyRaw.map((m) => ({
    m: m.label,
    revenue: m.revenue,
    expenses: m.expenses,
  }));

  const rollup: Rollup = { ...rollupRaw };

  const expenses: Expense[] = expenseRows.map((e) => ({
    id: e.id,
    jobId: e.jobId,
    // No job: a purchase for stock, or a Lead Center lead the shop paid for
    // (purpose LEAD, lib/leadCenter/purchase).
    job: e.job?.title ?? (e.purpose === "LEAD" ? "Lead purchase" : e.purpose === "DESK" ? "AI desk minutes" : "Stock purchase"),
    category: e.category,
    amount: e.amount,
    note: e.note ?? "",
    when: plate(e.spentAt ?? e.createdAt),
    // A private receipt is read through a short signed link (stage B).
    receiptUrl: mediaHref(e.receiptUrl),
    status: e.status,
    paidBy: e.paidBy,
    vendor: e.vendor,
    purpose: e.purpose,
  }));

  const orders: ChangeOrder[] = orderRows.map((c) => ({
    id: c.id,
    title: c.title,
    jobId: c.jobId,
    // A change order hangs off a job OR a proposal; name whichever it amends.
    job: c.job?.title ?? c.proposal?.title ?? "—",
    status: c.status,
    when: plate(c.createdAt),
    // Tax-inclusive when itemized (2026-09-13); the legacy signed amount otherwise.
    amount: c.total ?? c.amount,
  }));

  const invoices: Invoice[] = invoiceRows.map((i) => ({
    id: i.id,
    num: i.number,
    client: i.clientId ? (clientName.get(i.clientId) ?? "—") : "—",
    status: i.status,
    provider: i.provider,
    due: plate(i.dueDate),
    amount: i.amount,
    // What the client was asked for. Only carried when it differs from what the
    // row is worth now, so a renderer can print the pair without comparing
    // floats itself; null on a receipt row and on anything older than the
    // column.
    billed:
      i.billedAmount != null && Math.abs(i.billedAmount - i.amount) > 0.005 ? i.billedAmount : null,
    proposalId: i.proposalId,
    overdue: i.status === "PENDING" && !!i.dueDate && i.dueDate < now,
  }));

  // The balance each contract still owes, resolved the way every other money
  // read resolves it (contract value + approved change orders, percent stages
  // against the ORIGINAL total). A contract with nothing left to collect drops
  // off the list rather than offering a $0 invoice.
  const invoiceTargets: InvoiceTarget[] = openContracts
    .map((p) => {
      const schedule = resolveSchedule({
        ...contractSchedule(p.total, p.changeOrders),
        currency: p.currency,
        installments: p.installments,
      });
      return {
        id: p.id,
        label: `${p.client?.name ?? "—"} · ${p.title}`,
        owed: fromMinor(schedule.remainingMinor),
      };
    })
    .filter((t) => t.owed > 0);

  return { jobs, monthly, rollup, expenses, orders, invoices, invoiceTargets, office, projects };
}

/** The live projects (not archived), the most recently touched first, with their money. */
async function projectRows(organizationId: string): Promise<FinancialsProject[]> {
  const rows = await db.project.findMany({
    where: { organizationId, status: { not: "ARCHIVED" } },
    orderBy: { updatedAt: "desc" },
    take: 30,
    select: { id: true, name: true, status: true, client: { select: { name: true } } },
  });
  const money = await projectMoney(organizationId, rows.map((r) => r.id));
  return rows.flatMap((r) => {
    const m = money.get(r.id);
    if (!m) return [];
    return [
      {
        id: r.id,
        name: r.name,
        clientName: r.client?.name ?? null,
        status: r.status,
        contract: m.contract,
        pipeline: m.pipeline,
        spent: m.spent,
        budget: m.budget,
        margin: m.margin,
        marginPct: m.marginPct,
        marginState: m.marginState,
        uncovered: m.uncovered,
        collected: m.collected,
        owed: m.owed,
      },
    ];
  });
}
