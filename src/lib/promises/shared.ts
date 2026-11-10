// THE PROMISE TRACKER — THE PURE RULES (Smart CRM part 4, 2026-11-10; the owner's spec §12).
//
// A promise is one sentence somebody committed to: ours ("I'll send the revised quote Friday") or the client's
// ("I'll pay Friday"). Promises are caught when a person writes to a client (./server `catchPromises`), when a
// client writes in (lib/inbox/reader) or typed by hand on the client's page. This file decides, with no I/O:
//   · whether a message is worth reading for a promise at all (`mayPromise`), and what a read may contain;
//   · which list a promise shows in — Overdue · Due today · Open · Waiting on client · Kept;
//   · which later event proves it was kept (a proposal sent, an invoice made, a job booked, a payment, a signature,
//     the client writing back) — things like "I'll check with my supplier" close by hand only;
//   · when its owner is reminded: the morning it is due, and once more — with the office — the day after.
// Proved by qa/tests/logic/promises.check.ts.

export const PROMISE_KINDS = ["PROPOSAL", "INVOICE", "CALL", "SCHEDULE", "INFO", "PAY", "SIGN", "DECIDE", "OTHER"] as const;
export type PromiseKind = (typeof PROMISE_KINDS)[number];

export function parseKind(stored: string | null | undefined): PromiseKind {
  const k = String(stored ?? "").toUpperCase();
  return (PROMISE_KINDS as readonly string[]).includes(k) ? (k as PromiseKind) : "OTHER";
}

/** The kind, read from the words — for promises nobody labelled (typed by hand, or a client's own). */
export function guessKind(text: string, direction: "OURS" | "THEIRS"): PromiseKind {
  const t = text.toLowerCase();
  if (direction === "THEIRS") {
    if (/\b(pay|payment|deposit|check|cheque|zelle|venmo|wire|transfer)\b/.test(t)) return "PAY";
    if (/\b(sign|signed|signature|approve|accept)\b/.test(t)) return "SIGN";
    if (/\b(decide|decision|let you know|get back|think (it|about)|talk (to|with) (my|the))\b/.test(t)) return "DECIDE";
    return "OTHER";
  }
  if (/\b(quote|proposal|estimate|bid|pricing|price|numbers)\b/.test(t)) return "PROPOSAL";
  if (/\b(invoice|bill|receipt)\b/.test(t)) return "INVOICE";
  if (/\b(schedule|book|calendar|come (out|by)|stop by|visit|crew (out|there)|start date)\b/.test(t)) return "SCHEDULE";
  if (/\b(call|phone|ring)\b/.test(t)) return "CALL";
  if (/\b(check|find out|ask|confirm|look into|photos?|pictures?|samples?|color|colour|warranty|permit)\b/.test(t)) return "INFO";
  return "OTHER";
}

// ── catching ─────────────────────────────────────────────────────────────────

const COMMITS = /\b(i['’]?ll|i will|we['’]?ll|we will|i['’]?m going to|we['’]?re going to|i am going to|we are going to|let me|i can (get|send|have|call|stop|come|drop)|we can (get|send|have|call|stop|come|drop)|will (send|call|get|have|drop|email|text|be there|follow|let you know|confirm|check)|get back to you|follow up|you['’]?ll have (it|them|that))\b/i;

/** Worth a model call? Only a message in which somebody commits to something ("I'll…", "we will…", "let me…"). */
export function mayPromise(body: string | null | undefined): boolean {
  const t = (body ?? "").trim();
  if (t.length < 12) return false;
  return COMMITS.test(t);
}

export interface CaughtPromise {
  text: string;
  /** "YYYY-MM-DD" on the company's calendar, or null when the message pinned no day. */
  due: string | null;
  kind: PromiseKind;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * What a promise read may contain: at most three, each a short sentence, a due day only when it is a real calendar
 * day from today to a year out (a model that answers "last Friday" or 2099 gets no day, not a wrong one).
 */
export function parseCaught(raw: unknown, today: string): CaughtPromise[] {
  const list = Array.isArray((raw as { promises?: unknown })?.promises) ? ((raw as { promises: unknown[] }).promises as unknown[]) : [];
  const out: CaughtPromise[] = [];
  const seen = new Set<string>();
  const limit = DAY_RE.test(today) ? `${Number(today.slice(0, 4)) + 1}${today.slice(4)}` : "9999-12-31";
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const text = typeof o.text === "string" ? o.text.replace(/\s+/g, " ").trim() : "";
    if (text.length < 6 || text.length > 200) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const d = typeof o.due === "string" && DAY_RE.test(o.due) && !Number.isNaN(Date.parse(`${o.due}T12:00:00Z`)) ? o.due : null;
    const due = d && d >= today && d <= limit ? d : null;
    const kind = typeof o.kind === "string" && (PROMISE_KINDS as readonly string[]).includes(o.kind.toUpperCase()) ? (o.kind.toUpperCase() as PromiseKind) : guessKind(text, "OURS");
    out.push({ text, due, kind });
    if (out.length >= 3) break;
  }
  return out;
}

/** A caught day → the stored instant: 5 PM UTC of that day, the same calendar day in every US time zone (the
 *  reader's promises are stored the same way). */
export function dueInstant(day: string): Date {
  return new Date(`${day}T17:00:00Z`);
}

// ── the lists ────────────────────────────────────────────────────────────────

function parts(d: Date, tz: string): { day: string; hour: number } {
  try {
    const f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(d);
    const get = (t: string) => f.find((p) => p.type === t)?.value ?? "";
    return { day: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) % 24 };
  } catch {
    return { day: d.toISOString().slice(0, 10), hour: d.getUTCHours() };
  }
}

/** The company's calendar day of an instant: "2026-11-10". */
export function dayKey(d: Date, tz: string): string {
  return parts(d, tz).day;
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}

export type PromiseBucket = "overdue" | "today" | "open" | "waiting" | "kept";

export const BUCKETS: Array<{ key: PromiseBucket; label: string }> = [
  { key: "overdue", label: "Overdue" },
  { key: "today", label: "Due today" },
  { key: "open", label: "Open" },
  { key: "waiting", label: "Waiting on client" },
  { key: "kept", label: "Kept" },
];

export interface TrackedPromise {
  id: string;
  clientId: string;
  client: string;
  direction: "OURS" | "THEIRS";
  text: string;
  kind: PromiseKind;
  ownerId: string | null;
  owner: string | null;
  dueAt: number | null;
  status: string;
  keptAt: number | null;
  evidence: string | null;
  createdAt: number;
  /** The client's conversation in the inbox, when there is one. */
  threadId: string | null;
  /** Where it was caught: "EMAIL" | "SMS" | "PORTAL" | "PERSON" | "OPERATOR" | null. */
  sourceKind: string | null;
}

/** Which list a promise shows in. A client's promise is always "waiting on client" — its row says when it is late. */
export function bucketOf(p: Pick<TrackedPromise, "direction" | "status" | "dueAt">, now: Date, tz: string): PromiseBucket | null {
  if (p.status === "KEPT") return "kept";
  if (p.status !== "OPEN") return null;
  if (p.direction === "THEIRS") return "waiting";
  if (p.dueAt == null) return "open";
  const due = dayKey(new Date(p.dueAt), tz);
  const today = dayKey(now, tz);
  return due < today ? "overdue" : due === today ? "today" : "open";
}

/** "due today" · "due tomorrow" · "due Fri, Nov 13" · "1 day late" · "no date". */
export function dueWords(dueAt: number | null, now: Date, tz: string): string {
  if (dueAt == null) return "no date";
  const due = dayKey(new Date(dueAt), tz);
  const n = daysBetween(dayKey(now, tz), due);
  if (n === 0) return "due today";
  if (n === 1) return "due tomorrow";
  if (n < 0) return `${-n} day${n === -1 ? "" : "s"} late`;
  // The day is a calendar day, not an instant: worded from the key, so no zone can shift it.
  return `due ${new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(new Date(`${due}T12:00:00Z`))}`;
}

export interface PromiseTracker {
  overdue: TrackedPromise[];
  today: TrackedPromise[];
  open: TrackedPromise[];
  waiting: TrackedPromise[];
  kept: TrackedPromise[];
}

/** Sort into the five lists: the most pressing first in each. */
export function trackerOf(rows: TrackedPromise[], now: Date, tz: string): PromiseTracker {
  const t: PromiseTracker = { overdue: [], today: [], open: [], waiting: [], kept: [] };
  for (const r of rows) {
    const b = bucketOf(r, now, tz);
    if (b) t[b].push(r);
  }
  const byDue = (a: TrackedPromise, b: TrackedPromise) => (a.dueAt ?? Number.MAX_SAFE_INTEGER) - (b.dueAt ?? Number.MAX_SAFE_INTEGER) || a.createdAt - b.createdAt;
  t.overdue.sort(byDue);
  t.today.sort(byDue);
  t.open.sort(byDue);
  t.waiting.sort(byDue);
  t.kept.sort((a, b) => (b.keptAt ?? 0) - (a.keptAt ?? 0));
  return t;
}

// ── proof it was kept ────────────────────────────────────────────────────────

export type EvidenceKind = "PROPOSAL_SENT" | "INVOICE_MADE" | "CALL_OUT" | "JOB_BOOKED" | "PAYMENT" | "SIGNED" | "INBOUND";

export interface EvidenceEvent {
  kind: EvidenceKind;
  at: number;
  /** What the row will say: "Proposal sent — Rear deck". The day is added here. */
  label: string;
}

/** What proves each kind. INFO and OTHER have no proof a machine can see: a person ticks them. */
const PROOF: Record<PromiseKind, { direction: "OURS" | "THEIRS"; by: EvidenceKind[] } | null> = {
  PROPOSAL: { direction: "OURS", by: ["PROPOSAL_SENT"] },
  INVOICE: { direction: "OURS", by: ["INVOICE_MADE"] },
  CALL: { direction: "OURS", by: ["CALL_OUT"] },
  SCHEDULE: { direction: "OURS", by: ["JOB_BOOKED"] },
  PAY: { direction: "THEIRS", by: ["PAYMENT"] },
  SIGN: { direction: "THEIRS", by: ["SIGNED"] },
  DECIDE: { direction: "THEIRS", by: ["SIGNED", "INBOUND"] },
  INFO: null,
  OTHER: null,
};

/** Does this kind close on its own at all? (The tracker says "tick it when done" on the ones that don't.) */
export function closesItself(kind: PromiseKind, direction: "OURS" | "THEIRS"): boolean {
  const proof = PROOF[kind];
  return Boolean(proof && proof.direction === direction);
}

/** An event counts only when it happened after the promise was made — a minute's grace keeps the message that
 *  carried the promise from proving it. */
const GRACE_MS = 60_000;

/**
 * The first later event that proves the promise was kept, as the words the row shows ("Proposal sent — Rear deck ·
 * Nov 12") — or null.
 */
export function evidenceFor(p: { kind: PromiseKind; direction: "OURS" | "THEIRS"; since: number }, events: EvidenceEvent[], tz: string): { words: string; at: number } | null {
  const proof = PROOF[p.kind];
  if (!proof || proof.direction !== p.direction) return null;
  const hit = events
    .filter((e) => proof.by.includes(e.kind) && e.at > p.since + GRACE_MS)
    .sort((a, b) => a.at - b.at)[0];
  if (!hit) return null;
  let day = "";
  try {
    day = new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric" }).format(new Date(hit.at));
  } catch {
    day = new Date(hit.at).toISOString().slice(0, 10);
  }
  return { words: `${hit.label} · ${day}`.slice(0, 160), at: hit.at };
}

// ── reminders ────────────────────────────────────────────────────────────────

/** The morning reminder goes from this hour on the company's clock; a same-day promise is nudged in the afternoon. */
export const REMIND_FROM_HOUR = 8;
export const SAME_DAY_NUDGE_HOUR = 15;
export const LATE_FROM_HOUR = 9;

export type ReminderStep = "due" | "late" | null;

/**
 * Is a reminder owed right now? Only our own open promises with a day.
 *  · "due"  — the day it is due, from 8:00 (a promise made that same day: from 15:00, they only just said it).
 *  · "late" — any later day from 9:00, once: to its owner and the office.
 * `remindedAt` is the last reminder of either kind; one per step, never a third.
 */
export function reminderDue(p: { direction: string; status: string; dueAt: Date | null; createdAt: Date; remindedAt: Date | null }, now: Date, tz: string): ReminderStep {
  if (p.status !== "OPEN" || p.direction !== "OURS" || !p.dueAt) return null;
  const due = dayKey(p.dueAt, tz);
  const { day: today, hour } = parts(now, tz);
  const reminded = p.remindedAt ? dayKey(p.remindedAt, tz) : null;
  if (today > due) {
    if (reminded && reminded > due) return null;
    return hour >= LATE_FROM_HOUR ? "late" : null;
  }
  if (today < due || reminded) return null;
  const madeToday = dayKey(p.createdAt, tz) === due;
  return hour >= (madeToday ? SAME_DAY_NUDGE_HOUR : REMIND_FROM_HOUR) ? "due" : null;
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

/** The reminder's words. `mine` = it goes to the person who made the promise. */
export function reminderWords(step: "due" | "late", p: { client: string; text: string; dueAt: Date; owner: string | null }, mine: boolean, now: Date, tz: string): string {
  const said = `"${p.text.slice(0, 160)}"`;
  if (step === "due") {
    return mine
      ? `Due today — you told ${p.client}: ${said}. Tell me "kept my promise to ${firstName(p.client)}" when it's done.`
      : `A promise to ${p.client} is due today${p.owner ? ` (${p.owner}'s)` : ""}: ${said}.`;
  }
  const late = dueWords(p.dueAt.getTime(), now, tz);
  return mine
    ? `Late — you told ${p.client}: ${said} (${late}). Do it or tell them the new day; say "kept my promise to ${firstName(p.client)}" when it's done.`
    : `${p.owner ? `${p.owner}'s promise` : "A promise"} to ${p.client} is ${late}: ${said}.`;
}

/** One line for the briefing and the Operator: "Olga Petrova — send the revised quote (due today, Dana)". */
export function promiseLine(p: TrackedPromise, now: Date, tz: string): string {
  const when = p.status === "KEPT" ? `kept${p.evidence ? ` — ${p.evidence}` : ""}` : dueWords(p.dueAt, now, tz);
  return `${p.client} — ${p.text} (${when}${p.direction === "OURS" && p.owner ? `, ${p.owner}` : ""})`;
}
