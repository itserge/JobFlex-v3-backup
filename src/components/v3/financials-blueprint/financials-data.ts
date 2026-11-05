// Blueprint financials — the SHAPES the page renders, and the one genuine
// constant it owns.
//
// This file used to hold the donor's demo book: twelve hardcoded months, a
// hardcoded roll-up and three hardcoded tables that the page mutated in memory
// and forgot on navigation. Every one of those arrays now comes from the
// database in src/app/dashboard/financials/page.tsx, so the fixtures are gone —
// leaving them exported invites the next edit to re-point a control at one.
//
// (The mobile edition keeps its own copy of the fixture at
// src/app/(mobile)/mobile-financials-v2/financials-data.ts; it is a separate
// file and is untouched by this.)

import type { WhoLike } from "@/lib/team/who";

/** One column pair in the revenue-vs-expenses chart. */
export type MonthPoint = { m: string; revenue: number; expenses: number };

/* ============================================================
   WHO DID IT (2026-09-24) — the mark on a ledger row.

   A member (their color, name and role), the client (paid online through
   their link — grey "Client"), or the system. Resolved from the trail on the
   server (src/app/dashboard/financials/financials-who.ts); a row the trail
   cannot place carries no mark and draws nothing.
   ============================================================ */
export type WhoKind = "member" | "client" | "system";
export type WhoMark = { who: WhoLike | null; whoKind: WhoKind };
/** One person's share of a book over the 30-day window. `who` null = the client. */
export type WhoShare = { who: WhoLike | null; whoKind: WhoKind; amount: number; count: number };
export type FinancialsByPerson = { payments: WhoShare[]; expenses: WhoShare[] };

/** The 30-day roll-up behind the gauge, the stat strip and the attention list.
 *  Mirrors `FinancialsRollup` in src/actions/financials.ts. */
export type Rollup = {
  revenue30d: number;
  expenses30d: number;
  profit30d: number;
  marginPct: number;
  pipelineValue: number;
  invoicesPending: number;
  invoicesOverdue: number;
  changeOrdersPending: number;
  /** Stage A (2026-09-30): receipts on review, apart from expenses30d; what is owed to workers. */
  expensesOnReview?: number;
  expensesOnReviewCount?: number;
  owedToWorkers?: number;
};

/**
 * Expense categories offered in the staged-receipt form.
 *
 * The union of the two lists that already existed: the donor's seven, plus
 * `Tools` and `Subcontractor`, which are values the vision prompt in
 * src/actions/receiptOcr.ts is explicitly allowed to return. Without them an
 * OCR result of "Tools" fell out of the <select> and was silently saved as
 * "Materials".
 */
export const EXPENSE_CATEGORIES = [
  'Materials',
  'Labor',
  'Equipment',
  'Subcontractor',
  'Tools',
  'Permits',
  'Fuel',
  'Disposal',
  'Other',
];

/** A row of the expenses book — one `JobExpense`. */
export type Expense = {
  /** The real `JobExpense.id`; `deleteJobExpense` is called with it. */
  id: string;
  jobId: string | null;
  job: string;
  category: string;
  amount: number;
  note: string;
  /** Pre-formatted "Jul 22" — the ledger plate, not a full date. */
  when: string;
  /** Blob (or data) URL of the attached receipt image, when there is one. */
  receiptUrl: string | null;
  /** Stage A (2026-09-30): SUBMITTED | APPROVED | REJECTED | REIMBURSED — only APPROVED and REIMBURSED are in a total. */
  status?: string;
  paidBy?: string;
  vendor?: string | null;
  /** Stage D: "JOB" (a receipt for a job) or "STOCK" (a purchase for the warehouse, no job). */
  purpose?: string;
  /** Who logged it — the mark. Absent when the trail cannot say. */
  who?: WhoLike | null;
  whoKind?: WhoKind;
};

/** A row of the change-order book — one `ChangeOrder`. */
export type ChangeOrder = {
  id: string;
  title: string;
  jobId: string | null;
  job: string;
  /** DRAFT | SENT | APPROVED | DECLINED. Only DRAFT can be sent or deleted. */
  status: string;
  when: string;
  amount: number;
  /** Who drafted it. Absent when the trail cannot say. */
  who?: WhoLike | null;
  whoKind?: WhoKind;
};

/** One line in the "New invoice" picker: a contract that still owes money.
 *  Read from the proposals, never from the invoice book — otherwise the first
 *  invoice on a proposal could never be raised from this page. */
export type InvoiceTarget = {
  id: string;
  /** "Client · Proposal title". */
  label: string;
  /** What the schedule still says is owed, in dollars. */
  owed: number;
};

/** A row of the invoices book — one `Invoice`. Read-only on this page. */
export type Invoice = {
  id: string;
  num: string;
  client: string;
  status: string;
  provider: string;
  due: string;
  /** What the row is worth: the ask while open, what landed once settled. */
  amount: number;
  /** What the client was ASKED for, when that is not what landed — the book
   *  prints "billed $X · paid $Y". Null when they agree. */
  billed: number | null;
  proposalId: string | null;
  overdue: boolean;
  /** Who recorded the payment (PAID) or sent the invoice (open); the client
   *  when they paid online. Absent when the trail cannot say. */
  who?: WhoLike | null;
  whoKind?: WhoKind;
};

/* ============================================================
   OVERHEAD — the recurring cost of keeping the business alive.

   Per-job math ("job paid $10k, materials $6k, made $4k") says whether the
   WORK paid. It cannot say whether the COMPANY paid, because rent, insurance,
   the truck and the software never touch a job. These types carry the other
   half: one sheet per calendar month, split fixed vs scaling, and the coverage
   figure that compares the month's net profit from jobs against it.
   ============================================================ */

/** Fixed lines — flat dollars, unmoved by how much work came in. */
export type OverheadFixedKey =
  | "rent"
  | "office"
  | "insurance"
  | "vehicles"
  | "software"
  | "warehouse"
  | "utilities"
  | "other";

/** Lines that can scale with revenue. Each has a dollar field and a boolean
 *  saying whether that number is dollars or a percent of revenue. */
export type OverheadScalingKey = "workers" | "sales" | "marketing";
export type OverheadPctKey = "workersPct" | "salesPct" | "marketingPct";

/** A line the contractor named themself — a yard lease, a bookkeeper, a
 *  storage unit. Always fixed: a custom line never scales with revenue. */
export type OverheadCustomLine = { id: string; label: string; amount: number };

/** Most custom lines one month may carry. Past this the sheet stops being a
 *  glance and becomes a ledger, which is what Expenses is for. */
export const OVERHEAD_CUSTOM_MAX = 12;

/** One month's sheet, exactly as it is stored. */
export type OverheadSheet = { year: number; month: number } & Record<
  OverheadFixedKey | OverheadScalingKey,
  number
> &
  Record<OverheadPctKey, boolean> & { custom: OverheadCustomLine[] };

/** The fixed inputs, in the order they are drawn. One word each — the sheet is
 *  read at a glance, not studied. `icon` is a sprite symbol id: the shell's
 *  shared set plus the five the financials sprite adds for this tab. */
export const OVERHEAD_FIXED: ReadonlyArray<{
  key: OverheadFixedKey;
  label: string;
  icon: string;
}> = [
  { key: "rent", label: "Rent", icon: "i-building" },
  { key: "insurance", label: "Insurance", icon: "i-shield" },
  { key: "vehicles", label: "Vehicles", icon: "i-truck" },
  { key: "software", label: "Software", icon: "i-laptop" },
  { key: "office", label: "Office", icon: "i-briefcase" },
  { key: "warehouse", label: "Warehouse", icon: "i-box" },
  { key: "utilities", label: "Utilities", icon: "i-bolt" },
  { key: "other", label: "Other", icon: "i-dots" },
];

/** The scaling inputs. `pctKey` is the flag that decides whether `key` is read
 *  as dollars or as a percent of the month's revenue. */
export const OVERHEAD_SCALING: ReadonlyArray<{
  key: OverheadScalingKey;
  pctKey: OverheadPctKey;
  label: string;
  icon: string;
}> = [
  { key: "workers", pctKey: "workersPct", label: "Workers", icon: "i-hardhat" },
  { key: "sales", pctKey: "salesPct", label: "Sales", icon: "i-target" },
  { key: "marketing", pctKey: "marketingPct", label: "Marketing", icon: "i-megaphone" },
];

/** An empty sheet for a month nothing has been entered against. Every figure
 *  zero, every line in dollars — the honest starting state, not a fixture. */
export function emptyOverheadSheet(year: number, month: number): OverheadSheet {
  return {
    year,
    month,
    rent: 0,
    office: 0,
    insurance: 0,
    vehicles: 0,
    software: 0,
    warehouse: 0,
    utilities: 0,
    other: 0,
    workers: 0,
    workersPct: false,
    sales: 0,
    salesPct: false,
    marketing: 0,
    marketingPct: false,
    custom: [],
  };
}

/** One month of job-side money, as the Overhead tab needs it. `key` is
 *  "YYYY-MM" — the same key `getMonthlyRollup` produces. */
export type OverheadMonth = {
  key: string;
  /** "Aug 2026" — written once, on the server, by one clock. */
  label: string;
  year: number;
  month: number;
  revenue: number;
  expenses: number;
  /** revenue − expenses: what the WORK cleared, before any overhead. */
  net: number;
};

/** What the coverage bar reports. */
export type OverheadTotals = {
  fixed: number;
  variable: number;
  total: number;
  /** Net profit from jobs this month — the money available to pay the bills. */
  net: number;
  /** Net − total. Positive is true profit; negative is the month's shortfall. */
  left: number;
  /** 0–100, clamped. 100 means the bills are paid. */
  pct: number;
  covered: boolean;
  /** Nothing entered for the month. `covered` is true here by arithmetic —
   *  zero bills are always paid — but a surface must NOT read that as a win:
   *  an unfilled sheet is a question, not an answer. Draw the empty state. */
  empty: boolean;
};

/**
 * Fold a sheet against a month's revenue and net.
 *
 * A percent line is a percent OF REVENUE, not of net or of overhead — that is
 * what "marketing = 5% of revenue" means to the person typing it, and it is
 * why a big month costs more marketing than a quiet one.
 */
export function overheadTotals(
  sheet: OverheadSheet,
  month: { revenue: number; net: number },
): OverheadTotals {
  let fixed = 0;
  for (const f of OVERHEAD_FIXED) fixed += sheet[f.key] || 0;
  for (const c of sheet.custom ?? []) fixed += c.amount || 0;

  let variable = 0;
  for (const f of OVERHEAD_SCALING) {
    const v = sheet[f.key] || 0;
    variable += sheet[f.pctKey] ? (month.revenue * v) / 100 : v;
  }

  const total = fixed + variable;
  const net = month.net;
  const left = net - total;
  // Nothing entered = nothing to cover. Saying "0% covered" against an empty
  // sheet would read as a failing month when it is really an unfilled one, so
  // an empty sheet reads as covered.
  const pct = total <= 0 ? 100 : Math.max(0, Math.min(100, (net / total) * 100));

  return { fixed, variable, total, net, left, pct, covered: net >= total, empty: total <= 0 };
}

/** One project on the overview's Projects card (2026-11-04) — lib/projectMoney's figures, before sales tax. */
export type FinancialsProject = {
  id: string;
  name: string;
  clientName: string | null;
  status: string;
  contract: number;
  pipeline: number;
  spent: number;
  budget: number;
  margin: number | null;
  marginPct: number | null;
  marginState: "none" | "short" | "projected" | "sold";
  uncovered: number;
  collected: number;
  owed: number;
};
