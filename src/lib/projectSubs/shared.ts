// CONTRACTORS: QUOTES AND INVOICES — the pure half (2026-11-07, the plan "Projects: Remodel and New construction",
// part 2). The company keeps a list of its contractors; from a project the office asks one or several for a quote
// on a stage, awards one, then asks for the invoice. This file holds the statuses, the scope a stage reads as, the
// reply-by rule, the comparison against the budget, the overdue rule and the list's flags; it imports nothing that
// touches the server, so the card, the contractor's page, the Operator and the checks read one definition. The
// database half is ./server.ts.

import { addWorkDays } from "@/lib/projectTimeline/shared";

export const QUOTE_STATUSES = ["ASKED", "QUOTED", "AWARDED", "DECLINED", "INVOICED", "PAID"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const QUOTE_LABEL: Record<QuoteStatus, string> = {
  ASKED: "Asked",
  QUOTED: "Quoted",
  AWARDED: "Awarded",
  DECLINED: "Declined",
  INVOICED: "Invoice in",
  PAID: "Paid",
};

export function quoteStatusOf(s: string): QuoteStatus {
  return (QUOTE_STATUSES as readonly string[]).includes(s) ? (s as QuoteStatus) : "ASKED";
}

/** Still waiting on the contractor, or on the office: not declined, not paid. */
export const QUOTE_OPEN: readonly QuoteStatus[] = ["ASKED", "QUOTED", "AWARDED", "INVOICED"];

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

/** Reply by: five work days out (Monday to Friday), from an ISO day. */
export const REPLY_DAYS = 5;
export function replyByDefault(todayIso: string): string {
  return addWorkDays(todayIso, REPLY_DAYS);
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
 *  ones over the budget line are flagged with how far. Declined quotes keep their place but never win. */
export function compareQuotes<T extends QuoteLike>(quotes: readonly T[], line: number | null): Compared<T>[] {
  const priced = quotes.filter((q) => q.amount != null && q.status !== "DECLINED");
  const awarded = priced.find((q) => q.status === "AWARDED" || q.status === "INVOICED" || q.status === "PAID");
  const lowest = priced.reduce<T | null>((best, q) => (best == null || (q.amount ?? Infinity) < (best.amount ?? Infinity) ? q : best), null);
  const winner = awarded ?? lowest;
  return quotes.map((q) => {
    const over = line != null && q.amount != null && q.amount > line;
    return { quote: q, best: winner != null && q.id === winner.id, over, overBy: over ? Math.round((q.amount ?? 0) - (line ?? 0)) : null };
  });
}

/** Asked, and the reply-by day has passed. */
export function overdue(q: QuoteLike, todayIso: string): boolean {
  return q.status === "ASKED" && !!q.dueBy && q.dueBy < todayIso;
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
