// Mobile financials (mobile-financials-v2) — the SHAPES the page renders, and
// the constants the handheld build owns.
//
// This file used to hold the desktop donor's demo book, carried over verbatim:
// twelve hardcoded months, a hardcoded roll-up and three hardcoded tables that
// the component cloned per mount, mutated in memory and forgot on navigation.
// The owner was reading $536,650 of revenue that did not exist.
//
// Every one of those arrays now comes from the database, through
// `loadFinancials()` (src/actions/financialsMobile.ts → src/lib/
// financialsSnapshot.ts) — the SAME read src/app/dashboard/financials/page.tsx
// makes — so the phone and the desk describe one book. The fixtures are gone
// rather than merely unused: leaving them exported invites the next edit to
// re-point a control at one.
//
// The row types below are the desktop's, field for field
// (components/v3/financials-blueprint/financials-data.ts), because one snapshot
// feeds both editions. Everything under the "MOBILE ADDITIONS" rule is
// handheld-only: the tab map, the page size, the per-tab filter options and the
// client-side matchers that back the search box.

import type { OfficeMoney } from "@/components/v3/crew-board/office-review-data";
import type { WhoLike } from "@/lib/team/who";

/** One column pair in the revenue-vs-expenses chart. */
export type MonthPoint = { m: string; revenue: number; expenses: number };

/** WHO DID IT (2026-09-24) — the mark on a ledger row: a member (their color,
 *  name, role), the client who paid online (grey "Client"), or the system.
 *  Read beside the book through ./who-action.ts; a row the trail cannot place
 *  carries none and draws nothing. Mirrors the desk's shapes. */
export type WhoKind = "member" | "client" | "system";
export type WhoMark = { who: WhoLike | null; whoKind: WhoKind };
export type WhoShare = { who: WhoLike | null; whoKind: WhoKind; amount: number; count: number };
export type FinancialsWho = {
  expenses: Record<string, WhoMark>;
  invoices: Record<string, WhoMark>;
  orders: Record<string, WhoMark>;
  byPerson: { payments: WhoShare[]; expenses: WhoShare[] };
};
export const EMPTY_WHO: FinancialsWho = { expenses: {}, invoices: {}, orders: {}, byPerson: { payments: [], expenses: [] } };

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
};

/** A job a receipt can be charged to — the picker in the expense form. */
export type FinancialsJob = { id: string; title: string; status: string };

export const EXPENSE_CATEGORIES = [
  'Materials',
  'Labor',
  'Equipment',
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
  /** Stage A: SUBMITTED | APPROVED | REJECTED | REIMBURSED — only APPROVED and REIMBURSED count. */
  status?: string;
  paidBy?: string;
  vendor?: string | null;
  /** Stage D: JOB or STOCK. */
  purpose?: string;
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
};

/** What one `loadFinancials()` call hands back. Structurally the server's
 *  `FinancialsSnapshot` — declared here so no client module has to import a
 *  file that touches Prisma. */
export type FinancialsSnapshot = {
  jobs: FinancialsJob[];
  monthly: MonthPoint[];
  rollup: Rollup;
  expenses: Expense[];
  orders: ChangeOrder[];
  invoices: Invoice[];
  invoiceTargets: InvoiceTarget[];
  /** Stage D: the review queue, owed to workers, cost by job (lib/officeMoney). */
  office?: OfficeMoney;
  /** What each project makes (lib/projectMoney, 2026-11-04). */
  projects?: import("@/components/v3/financials-blueprint/financials-data").FinancialsProject[];
};

/** The honest starting state: no revenue, no expenses, no pipeline. What the
 *  page holds before the first read lands, and after one that failed. */
export const EMPTY_ROLLUP: Rollup = {
  revenue30d: 0,
  expenses30d: 0,
  profit30d: 0,
  marginPct: 0,
  pipelineValue: 0,
  invoicesPending: 0,
  invoicesOverdue: 0,
  changeOrdersPending: 0,
};

/* ============================================================
   MOBILE ADDITIONS
   ============================================================ */

export type TabKey = 'overview' | 'expenses' | 'orders' | 'invoices';

export const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'expenses', label: 'Expenses' },
  { key: 'orders', label: 'Change orders' },
  { key: 'invoices', label: 'Invoices' },
];

/**
 * The desktop tables show every row at once. A handheld row is three lines
 * tall, so the ledgers page — same reasoning that took the proposals ledger
 * from 8 to 6 and the client book from 12 to 8.
 */
export const PAGE_SIZE = 6;

/** The filter key that is not a literal category or status. */
export const ALL = 'ALL';

export const CO_STATUSES = ['DRAFT', 'SENT', 'APPROVED', 'DECLINED'];
export const INV_STATUSES = ['PENDING', 'PAID', 'FAILED', 'REFUNDED', 'VOID'];

/**
 * Two letters, so a page of invoices is scannable: "M. Henderson" → MH,
 * "Cascade PM" → CP, a single word → its first two letters. Punctuation is
 * stripped first, which keeps the "M." initial from becoming ".".
 */
export function initials(name: string): string {
  const parts = name.replace(/[^A-Za-z ]/g, ' ').split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const hit = (query: string, ...fields: string[]) => {
  if (!query) return true;
  const q = query.toLowerCase();
  return fields.some((f) => f.toLowerCase().includes(q));
};

/** Job, vendor note, category and the logged date all answer the search box. */
export function matchesExpense(e: Expense, query: string): boolean {
  return hit(query, e.job, e.note, e.category, e.when);
}

export function matchesOrder(o: ChangeOrder, query: string): boolean {
  return hit(query, o.title, o.job, o.status, o.when);
}

export function matchesInvoice(i: Invoice, query: string): boolean {
  return hit(query, i.num, i.client, i.status, i.provider, i.due);
}
