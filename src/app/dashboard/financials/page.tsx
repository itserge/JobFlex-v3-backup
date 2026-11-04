// Main financials — Blueprint edition. Pixel-identical port of the canonical
// financials donor (jobflex-financials-blueprint_7.html).
//
// The sidebar, topbar and sprite come from the shared shell mounted in
// ../layout.tsx, so this page renders only the donor's `.content` children.
//
// NOTHING ON THIS PAGE IS A FIXTURE ANY MORE. The chart, the margin gauge, the
// stat strip, the attention list and all three books are read from the
// database, through the same queries the classic financials pages use:
//   - overview          → old-design-pages/dashboard/financials/page.tsx
//   - expenses book     → (dashboard)/dashboard/financials/expenses/page.tsx
//   - change-order book → (dashboard)/dashboard/financials/change-orders/page.tsx
//   - invoices book     → (dashboard)/dashboard/financials/invoices/page.tsx
// The row actions (delete expense, send / delete change order) call the same
// server actions those tables call — see financials-behavior.ts.
//
// That read now lives in lib/financialsSnapshot, because the HANDHELD edition
// of this same route is mounted props-less by the responsive shell and has to
// ask for the data itself (src/actions/financialsMobile.ts). One module, two
// editions, no chance of the phone and the desk describing different books.
// Dates are still formatted on the server, inside that module, so the ledger
// plates ("Jul 22") are produced once, by one clock, for every row.

import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { requireOrg, NoOrgError, UnauthorizedError } from "@/lib/orgContext";
import { getMonthlyRollup } from "@/actions/financials";
import { getFinancialsSnapshot } from "@/lib/financialsSnapshot";
import { getOverheadSheets, toOverheadMonths } from "@/lib/overhead";
import { FinancialsContent } from "@/components/v3/financials-blueprint/financials-content";
import type { WhoMark } from "@/components/v3/financials-blueprint/financials-data";
import { getFinancialsWho } from "./financials-who";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "JobFlex · Financials",
  description:
    "Financials — revenue against expenses, margin gauge, receipt capture and the expense, change-order and invoice books on one sheet.",
};

export default async function FinancialsPage() {
  let organizationId: string;
  try {
    const ctx = await requireOrg();
    organizationId = ctx.organizationId;
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login?next=%2Fdashboard%2Ffinancials");
    if (err instanceof NoOrgError) redirect("/dashboard?error=forbidden");
    throw err;
  }

  const [snapshot, overheadSheets, monthlyRaw, who] = await Promise.all([
    // The chart, the gauge, the stat strip, the attention list and all three
    // books — the read the handheld edition makes too.
    getFinancialsSnapshot(organizationId),
    // Every sheet the org has saved. A dozen small rows — cheaper to hand over
    // whole than to round-trip each time the Overhead tab steps a month.
    getOverheadSheets(organizationId),
    // The Overhead tab walks the SAME twelve months the chart draws, but needs
    // the raw figures the chart's MonthPoint drops: the month key it saves
    // against, and the net the work actually cleared. Read alongside the
    // snapshot rather than through it — the snapshot's contract is the six
    // books both editions share, and the Overhead tab is desktop-side here.
    getMonthlyRollup(organizationId, 12),
    // WHO DID IT: the trail's person on each row — who recorded the payment,
    // logged the expense, drafted the change order — and the 30-day
    // by-person split. Read beside the snapshot, never through it: the
    // snapshot is the book, the marks are the initials in its margin.
    getFinancialsWho(organizationId),
  ]);

  const overheadMonths = toOverheadMonths(monthlyRaw);
  const marked = <T extends { id: string }>(rows: T[], marks: Record<string, WhoMark>) =>
    rows.map((r) => (marks[r.id] ? { ...r, ...marks[r.id] } : r));

  return (
    <FinancialsContent
      jobs={snapshot.jobs}
      monthly={snapshot.monthly}
      rollup={snapshot.rollup}
      expenses={marked(snapshot.expenses, who.expenses)}
      orders={marked(snapshot.orders, who.orders)}
      invoices={marked(snapshot.invoices, who.invoices)}
      byPerson={who.byPerson}
      invoiceTargets={snapshot.invoiceTargets}
      overheadMonths={overheadMonths}
      overheadSheets={overheadSheets}
      office={snapshot.office}
      projects={snapshot.projects}
    />
  );
}
