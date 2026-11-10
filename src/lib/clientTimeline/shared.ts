// THE CLIENT'S TIMELINE — THE PURE PART (Smart CRM part 1, 2026-11-08; the plan doc "JobFlex Smart CRM — plan").
// One ordered story per client: every proposal, visit, call, text, email, payment, invoice, review, project step
// and trail line, newest first. The server part (./server) fetches the rows; everything here is pure and proved by
// qa/tests/logic/client-timeline.check.ts.

export type TimelineTone = "ink" | "accent" | "good" | "warn" | "bad";

export type TimelineKind =
  | "LEAD"
  | "PROPOSAL"
  | "PAYMENT"
  | "INVOICE"
  | "VISIT"
  | "EMAIL"
  | "TEXT"
  | "CALL"
  | "REVIEW"
  | "PROJECT"
  | "SERVICE"
  | "TRAIL";

export interface TimelineEvent {
  /** `${kind}:${source id}:${facet}` — stable, so a re-read never doubles a line. */
  id: string;
  at: Date;
  kind: TimelineKind;
  /** The stamp's word on the page: "Email in", "Signed", "Payment"… */
  stamp: string;
  tone: TimelineTone;
  title: string;
  detail?: string | null;
  href?: string | null;
}

/** The last ten digits — how two spellings of one phone number meet. */
export function digits10(s: string | null | undefined): string {
  return (s ?? "").replace(/\D/g, "").slice(-10);
}

/** The two share a phone: both have at least 7 digits and one ends with the other. */
export function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = digits10(a);
  const y = digits10(b);
  if (x.length < 7 || y.length < 7) return false;
  return x.endsWith(y) || y.endsWith(x);
}

export function sameEmail(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = (a ?? "").trim().toLowerCase();
  const y = (b ?? "").trim().toLowerCase();
  return !!x && x === y;
}

/** One line of a message or summary, cut for a timeline row. */
export function clip(s: string | null | undefined, max = 110): string {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** Every source's events folded into one story: newest first, one line per id, capped. */
export function mergeTimeline(lists: TimelineEvent[][], cap = 250): TimelineEvent[] {
  const seen = new Set<string>();
  const all: TimelineEvent[] = [];
  for (const list of lists) {
    for (const e of list) {
      if (!e || Number.isNaN(e.at.getTime()) || seen.has(e.id)) continue;
      seen.add(e.id);
      all.push(e);
    }
  }
  all.sort((a, b) => b.at.getTime() - a.at.getTime());
  return all.slice(0, cap);
}

/** Trail kinds whose stories the structured tables already tell — kept off the timeline so nothing shows twice. */
export const TRAIL_KINDS_COVERED = new Set(["ESTIMATE", "PAY", "APPOINTMENT"]);

export const TIMELINE_FILTERS = [
  { key: "all", label: "All", kinds: null as readonly TimelineKind[] | null },
  { key: "messages", label: "Messages", kinds: ["EMAIL", "TEXT", "CALL"] as readonly TimelineKind[] },
  { key: "money", label: "Money", kinds: ["PAYMENT", "INVOICE"] as readonly TimelineKind[] },
  { key: "jobs", label: "Jobs", kinds: ["PROPOSAL", "VISIT", "PROJECT", "SERVICE", "REVIEW"] as readonly TimelineKind[] },
] as const;

/** A rebuild is skipped while the brief is this fresh, whatever landed — the page must not call the model on every load. */
export const BRIEF_REBUILD_FLOOR_MS = 5 * 60_000;

/** Whether the saved brief still tells the story: false once the timeline holds something newer. */
export function briefCurrent(brief: { builtAt: Date } | null, timeline: readonly TimelineEvent[], now = new Date()): boolean {
  if (!brief) return false;
  if (now.getTime() - brief.builtAt.getTime() < BRIEF_REBUILD_FLOOR_MS) return true;
  const newest = timeline[0]?.at;
  return !newest || newest.getTime() <= brief.builtAt.getTime();
}

/** The memory's categories (lib/clientMemory) — here because the page's client components list them too. */
export const FACT_CATEGORIES = ["CONTACT", "PROJECT", "DECISION", "COMMITMENT", "MONEY", "PREFERENCE", "HOUSE"] as const;
export type FactCategory = (typeof FACT_CATEGORIES)[number];
