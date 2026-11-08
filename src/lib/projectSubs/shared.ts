// CONTRACTORS: QUOTES AND INVOICES — the pure half (2026-11-07, the plan "Projects: Remodel and New construction",
// part 2; grown 2026-11-08 by part 1 of the subcontractors plan). The company keeps a list of its contractors; from
// a project the office sends a request for quotes on a stage's work to one or several of them, each answers on
// their own page with a price and a document (every price a version), the office compares, awards, then asks for
// the invoice. This file holds the statuses, the request's words and numbers, the scope a stage reads as, the
// reply-by and expiry rules, the comparison against the budget, the overdue rule, the directory's words and the
// list's flags; it imports nothing that touches the server, so the cards, the pages, the Operator and the checks read
// one definition. The database half is ./server.ts.

import { addWorkDays } from "@/lib/projectTimeline/shared";

export const QUOTE_STATUSES = ["ASKED", "VIEWED", "QUOTED", "REVISION", "AWARDED", "DECLINED", "EXPIRED", "CANCELLED", "INVOICED", "PAID"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const QUOTE_LABEL: Record<QuoteStatus, string> = {
  ASKED: "Sent",
  VIEWED: "Viewed",
  QUOTED: "Quoted",
  REVISION: "Revision asked",
  AWARDED: "Awarded",
  DECLINED: "Declined",
  EXPIRED: "Expired",
  CANCELLED: "Cancelled",
  INVOICED: "Invoice in",
  PAID: "Paid",
};

export function quoteStatusOf(s: string): QuoteStatus {
  return (QUOTE_STATUSES as readonly string[]).includes(s) ? (s as QuoteStatus) : "ASKED";
}

/** Still moving: not declined, expired, cancelled or paid. */
export const QUOTE_OPEN: readonly QuoteStatus[] = ["ASKED", "VIEWED", "QUOTED", "REVISION", "AWARDED", "INVOICED"];
/** The sub's turn: the request is with them. */
export const WAITING_ON_SUB: readonly QuoteStatus[] = ["ASKED", "VIEWED", "REVISION"];
/** Out of the running: a price from one of these never wins a comparison. */
export const QUOTE_OUT: readonly QuoteStatus[] = ["DECLINED", "EXPIRED", "CANCELLED"];

/** What the arithmetic needs of a quote — the card's shape and the database row both fit. */
export type QuoteLike = {
  id: string;
  status: string;
  amount: number | null;
  /** ISO day. */
  dueBy: string | null;
  stageId: string | null;
  contractorName: string;
};

// ── the request ──────────────────────────────────────────────────────────────

export const REQUEST_STATUSES = ["DRAFT", "SENT", "CLOSED", "CANCELLED"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];
/** A company's requests count from here: the first is RFQ-1001. */
export const REQUEST_FIRST_NUMBER = 1001;
/** "RFQ-1042". */
export const requestNo = (n: number) => `RFQ-${n}`;

/** The request's title: the stage's name, else the trade, else the project. */
export function requestTitleFor(stageName: string | null, trade: string | null, projectName: string): string {
  return (stageName?.trim() || trade?.trim() || projectName.trim()).slice(0, 120);
}

/** Reply by: five work days out (Monday to Friday), from an ISO day. */
export const REPLY_DAYS = 5;
export function replyByDefault(todayIso: string): string {
  return addWorkDays(todayIso, REPLY_DAYS);
}

/** A sub's link stops answering this many days after the deadline (or after the send, with no deadline). */
export const LINK_DAYS_AFTER = 30;
const plusDays = (iso: string, days: number) => new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)) + days)).toISOString().slice(0, 10);
/** The ISO day a recipient's link closes: the deadline (else the day it was sent) plus 30 days. */
export function linkExpiry(dueBy: string | null, sentIso: string): string {
  return plusDays(dueBy ?? sentIso.slice(0, 10), LINK_DAYS_AFTER);
}
/** Closed for the sub: finished one way or another, or past its expiry. */
export function linkClosed(status: string, expiresAt: string | null, todayIso: string): boolean {
  const st = quoteStatusOf(status);
  if (st === "PAID" || QUOTE_OUT.includes(st)) return true;
  if ((st === "ASKED" || st === "VIEWED" || st === "REVISION" || st === "QUOTED") && expiresAt && expiresAt.slice(0, 10) < todayIso) return true;
  return false;
}

/** The scope a stage reads as when the office asks — the stage's name, then its tasks one per line, the ones that
 *  are the contractor's work (an inspection, a photo or the final payment are the office's). */
export function scopeFor(stageName: string, tasks: readonly string[]): string {
  const theirs = tasks.filter((t) => !/^(inspection|final photos|collect the final|walk-through|punch list|final inspection)/i.test(t.trim())).slice(0, 12);
  return [stageName.trim(), ...theirs.map((t) => `- ${t.trim()}`)].join("\n").slice(0, 2000);
}

// The trade a stage's name points at, for the list of contractors to ask first (lib/tradeTypes words).
const STAGE_TRADES: ReadonlyArray<[RegExp, string]> = [
  [/framing|frame|structural|tie-in|trusses/i, "Carpentry"],
  [/plumb/i, "Plumbing"],
  [/electric|panel|service upgrade/i, "Electrical"],
  [/hvac|furnace|heat pump|mechanical|equipment/i, "HVAC"],
  [/roof|shingle|dry-in/i, "Roofing"],
  [/foundation|footings|slab|concrete|site work|excavat|grading/i, "Concrete"],
  [/drywall|insulation|tape/i, "Drywall"],
  [/paint|prime|finish coats/i, "Painting"],
  [/tile|waterproof/i, "Tile"],
  [/floor/i, "Flooring"],
  [/cabinet|counter|kitchen/i, "Countertops"],
  [/siding|wrap|exterior/i, "Siding"],
  [/window|door/i, "Windows"],
  [/fence|posts|panels/i, "Fencing"],
  [/deck|railing/i, "Decking"],
  [/landscap|lawn|driveway|drainfield|final grade/i, "Landscaping"],
  [/demolition|tear-off|tear out/i, "Demolition"],
];

/** The trade a stage's work is, else null (the whole list is shown then). */
export function tradeForStage(stageName: string): string | null {
  return STAGE_TRADES.find(([re]) => re.test(stageName))?.[1] ?? null;
}

/** A stage's share of the Subcontractors budget: its weight's share of the project's, times the subs line; null when
 *  there is no subs budget or no weight. The line a quote is compared against. */
export function stageSubsBudget(stageWeight: number, totalWeight: number, subsBudget: number): number | null {
  if (!(subsBudget > 0) || !(totalWeight > 0) || !(stageWeight > 0)) return null;
  return Math.round((subsBudget * stageWeight) / totalWeight);
}

export type Compared<T extends QuoteLike> = { quote: T; best: boolean; over: boolean; overBy: number | null };

/** The quotes of one stage compared: the lowest priced one is best (an awarded one leads whatever its price), the
 *  ones over the budget line are flagged with how far. Declined, expired and cancelled quotes keep their place but
 *  never win. */
export function compareQuotes<T extends QuoteLike>(quotes: readonly T[], line: number | null): Compared<T>[] {
  const priced = quotes.filter((q) => q.amount != null && !QUOTE_OUT.includes(quoteStatusOf(q.status)));
  const awarded = priced.find((q) => q.status === "AWARDED" || q.status === "INVOICED" || q.status === "PAID");
  const lowest = priced.reduce<T | null>((best, q) => (best == null || (q.amount ?? Infinity) < (best.amount ?? Infinity) ? q : best), null);
  const winner = awarded ?? lowest;
  return quotes.map((q) => {
    const over = line != null && q.amount != null && q.amount > line;
    return { quote: q, best: winner != null && q.id === winner.id, over, overBy: over ? Math.round((q.amount ?? 0) - (line ?? 0)) : null };
  });
}

/** With the sub, and the reply-by day has passed. */
export function overdue(q: QuoteLike, todayIso: string): boolean {
  return WAITING_ON_SUB.includes(quoteStatusOf(q.status)) && !!q.dueBy && q.dueBy < todayIso;
}

/** What the list and the page flag a project for, from its quotes alone. */
export function quoteFlags(quotes: readonly QuoteLike[], todayIso: string): Array<{ kind: "quote-overdue" | "quote-in" | "invoice-in"; text: string }> {
  const out: Array<{ kind: "quote-overdue" | "quote-in" | "invoice-in"; text: string }> = [];
  const late = quotes.filter((q) => overdue(q, todayIso));
  if (late.length) out.push({ kind: "quote-overdue", text: late.length === 1 ? `Quote overdue from ${late[0].contractorName}` : `${late.length} quotes overdue` });
  const quoted = quotes.filter((q) => q.status === "QUOTED");
  if (quoted.length) out.push({ kind: "quote-in", text: quoted.length === 1 ? `Quote in from ${quoted[0].contractorName}` : `${quoted.length} quotes in` });
  const invoiced = quotes.filter((q) => q.status === "INVOICED");
  if (invoiced.length) out.push({ kind: "invoice-in", text: invoiced.length === 1 ? `Invoice in from ${invoiced[0].contractorName}` : `${invoiced.length} invoices in` });
  return out;
}

// ── the directory ────────────────────────────────────────────────────────────

export const LICENSE_STATUSES = ["UNKNOWN", "ACTIVE", "EXPIRED", "SUSPENDED", "NONE"] as const;
export type LicenseStatus = (typeof LICENSE_STATUSES)[number];
export const LICENSE_LABEL: Record<LicenseStatus, string> = { UNKNOWN: "Not checked", ACTIVE: "Active", EXPIRED: "Expired", SUSPENDED: "Suspended", NONE: "No license" };
export const licenseStatusOf = (s: string | null | undefined): LicenseStatus => ((LICENSE_STATUSES as readonly string[]).includes(s ?? "") ? (s as LicenseStatus) : "UNKNOWN");

export const W9_STATUSES = ["NONE", "REQUESTED", "ON_FILE"] as const;
export type W9Status = (typeof W9_STATUSES)[number];
export const W9_LABEL: Record<W9Status, string> = { NONE: "No W-9", REQUESTED: "W-9 asked for", ON_FILE: "W-9 on file" };
export const w9StatusOf = (s: string | null | undefined): W9Status => ((W9_STATUSES as readonly string[]).includes(s ?? "") ? (s as W9Status) : "NONE");

export const CONTRACTOR_SOURCES = ["MINE", "NETWORK", "SEARCH"] as const;
export type ContractorSource = (typeof CONTRACTOR_SOURCES)[number];

/** The insurance's state against today: none on file, fine, expiring within 30 days, expired. */
export type InsuranceState = "none" | "ok" | "soon" | "expired";
const utcDays = (iso: string) => Math.floor(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86_400_000);
export function insuranceState(until: string | null, todayIso: string): InsuranceState {
  if (!until) return "none";
  const days = utcDays(until.slice(0, 10)) - utcDays(todayIso);
  if (days < 0) return "expired";
  if (days <= 30) return "soon";
  return "ok";
}
const shortDay = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
/** "insured to Mar 4, 2027" · "insurance expires Nov 20, 2026" · "insurance expired Oct 1, 2026" · "no insurance on file". */
export function insuranceWords(until: string | null, todayIso: string): string {
  const st = insuranceState(until, todayIso);
  if (st === "none") return "no insurance on file";
  if (st === "expired") return `insurance expired ${shortDay(until!)}`;
  if (st === "soon") return `insurance expires ${shortDay(until!)}`;
  return `insured to ${shortDay(until!)}`;
}

export type ContractorLike = { insuranceUntil: string | null; licenseStatus: string; w9Status: string; bondUntil?: string | null };
/** What the directory flags a sub for: an expired or expiring insurance, a license not active, no W-9. */
export function contractorFlags(c: ContractorLike, todayIso: string): Array<{ kind: "insurance" | "license" | "w9"; text: string; late: boolean }> {
  const out: Array<{ kind: "insurance" | "license" | "w9"; text: string; late: boolean }> = [];
  const ins = insuranceState(c.insuranceUntil, todayIso);
  if (ins === "expired") out.push({ kind: "insurance", text: insuranceWords(c.insuranceUntil, todayIso), late: true });
  else if (ins === "soon") out.push({ kind: "insurance", text: insuranceWords(c.insuranceUntil, todayIso), late: false });
  const lic = licenseStatusOf(c.licenseStatus);
  if (lic === "EXPIRED" || lic === "SUSPENDED") out.push({ kind: "license", text: `license ${LICENSE_LABEL[lic].toLowerCase()}`, late: true });
  if (w9StatusOf(c.w9Status) === "NONE") out.push({ kind: "w9", text: "no W-9", late: false });
  return out;
}

/** The trades a sub works: the main one first, then the others, each once. */
export function tradesOf(trade: string | null, tradesJson: string | null): string[] {
  const extra = (() => {
    try {
      const v = JSON.parse(tradesJson ?? "[]");
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : [];
    } catch {
      return [];
    }
  })();
  return [...new Set([trade?.trim(), ...extra.map((t) => t.trim())].filter((t): t is string => Boolean(t)))];
}

// ── words and texts ──────────────────────────────────────────────────────────

/** "$4,200" — whole dollars, the way the cards print money. */
export const dollars = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

/** The text a contractor gets with the link (a text is short; the email carries the scope). */
export function askText(company: string, project: string, replyByWords: string | null, link: string): string {
  return `${company}: could you quote the work on ${project}?${replyByWords ? ` Reply by ${replyByWords}.` : ""} Details and a price box: ${link}`;
}

/** The text after an award: the link now asks for the invoice. */
export function awardText(company: string, project: string, link: string): string {
  return `${company}: you've got the work on ${project} — thank you. When it's done, send your invoice here: ${link}`;
}

/** The text when the office asks for a revision: the link takes a new price. */
export function revisionText(company: string, project: string, note: string | null, link: string): string {
  return `${company}: could you revise your quote on ${project}?${note ? ` ${note.slice(0, 120)}` : ""} A new price here: ${link}`;
}
