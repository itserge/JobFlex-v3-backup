// THE JOBFLEX ASSISTANT · THE PURE PART (2026-11-04). What every channel
// shares and the checks pin (qa/tests/logic/assistant.check.ts): the short
// replies answered without the model, the life of a proposed change, the
// undo window, dates on the company's clock, money words, and what the panel
// reads. No database, no model — safe on the client too.
import { zonedInstant, zonedParts } from "@/lib/booking";

export type AssistantChannel = "app" | "sms" | "voice";

/** A proposed change's life: read back and waiting → approved and waiting out
 *  the undo window → claimed → done or failed; or called off / never answered. */
export type ActionStatus = "AWAITING" | "QUEUED" | "RUNNING" | "DONE" | "FAILED" | "CANCELED" | "EXPIRED";

/** How long a read-back waits for its YES. */
export const APPROVAL_TTL_MS = 30 * 60_000;
/** A RUNNING action older than this was lost mid-way (a crashed request): it is
 *  marked FAILED and never retried — a send must not go out twice. */
export const RUNNING_STALE_MS = 5 * 60_000;

/** The undo window. In the app the person tapped "Do it" on the full read-back,
 *  so it runs at once; a one-word YES by text or by voice waits two minutes. */
export function undoWindowMs(channel: AssistantChannel): number {
  return channel === "app" ? 0 : 2 * 60_000;
}

export type QuickReply =
  | { kind: "yes" }
  | { kind: "no" }
  | { kind: "undo" }
  | { kind: "stop" }
  | { kind: "help" }
  | { kind: "digit"; n: number };

const YES = /^(y|yes|yeah|yep|yup|ok|okay|sure|confirm|confirmed|do it|go|go ahead|send it|send|approve|approved|correct|right|si|sí|да)$/;
const NO = /^(n|no|nope|nah|cancel|don'?t|do not|never ?mind|no thanks|нет)$/;

/** A reply short enough to be answered without the model: YES / NO to a
 *  read-back, UNDO, STOP / HELP (texting's keywords), or a single choice digit.
 *  "yes please" and "ok thanks" are a yes; "no, make it Friday" is not a bare
 *  no — it is a new request, and the model's. Anything longer is the model's. */
export function quickReply(raw: string): QuickReply | null {
  const t = raw
    .trim()
    .toLowerCase()
    .replace(/[.!,]+/g, " ")
    .replace(/\b(please|pls|plz|thanks|thank you|thx|now)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t || t.length > 24 || (t.includes("?") && t !== "?")) return null;
  if (YES.test(t)) return { kind: "yes" };
  if (NO.test(t)) return { kind: "no" };
  if (/^(undo|stop it|wait|hold on|don'?t send)$/.test(t)) return { kind: "undo" };
  if (/^(stop|stopall|unsubscribe|end|quit)$/.test(t)) return { kind: "stop" };
  if (/^(help|info|\?)$/.test(t)) return { kind: "help" };
  const d = /^(?:#|no\.? ?|number )?([1-9])$/.exec(t);
  if (d) return { kind: "digit", n: Number(d[1]) };
  return null;
}

/** May this status move to that one? The executor and the approvals ask it. */
export function canMove(from: ActionStatus, to: ActionStatus): boolean {
  switch (from) {
    case "AWAITING":
      return to === "QUEUED" || to === "CANCELED" || to === "EXPIRED";
    case "QUEUED":
      return to === "RUNNING" || to === "CANCELED";
    case "RUNNING":
      return to === "DONE" || to === "FAILED";
    default:
      return false;
  }
}

/** Is a read-back still waiting for its answer at `now`? */
export function stillAwaiting(a: { status: string; createdAt: Date | string }, now = Date.now()): boolean {
  return a.status === "AWAITING" && now - new Date(a.createdAt).getTime() < APPROVAL_TTL_MS;
}

// ── dates on the company's clock ─────────────────────────────────────────────

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** "2026-11-06" → [the instant that day starts, the instant the next starts) in `tz`. */
export function dayRange(day: string, tz: string): { from: Date; to: Date } | null {
  const m = DAY_RE.exec(day);
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const from = zonedInstant(y, mo, d, 0, 0, tz);
  const next = new Date(Date.UTC(y, mo - 1, d + 1));
  const to = zonedInstant(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, 0, tz);
  return { from, to };
}

/** "2026-11-06" + "09:30" on the company's clock → the instant. */
export function wallInstant(day: string, time: string, tz: string): Date | null {
  const m = DAY_RE.exec(day);
  const t = TIME_RE.exec(time);
  if (!m || !t) return null;
  return zonedInstant(+m[1], +m[2], +m[3], +t[1], +t[2], tz);
}

/** The company's calendar day of an instant: "2026-11-06". */
export function dayOf(d: Date, tz: string): string {
  const p = zonedParts(d, tz);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

/** The company's wall-clock time of an instant: "09:30". */
export function timeOf(d: Date, tz: string): string {
  const p = zonedParts(d, tz);
  return `${String(p.h).padStart(2, "0")}:${String(p.min).padStart(2, "0")}`;
}

/** "Thu, Nov 6" */
export function dayWords(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" }).format(d);
}

/** "9:00 AM" */
export function clockWords(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(d);
}

/** "Thu, Nov 6, 9:00 AM–2:00 PM" (one day) or both ends in full. */
export function spanWords(from: Date, to: Date, tz: string): string {
  if (dayOf(from, tz) === dayOf(to, tz)) return `${dayWords(from, tz)}, ${clockWords(from, tz)}–${clockWords(to, tz)}`;
  return `${dayWords(from, tz)}, ${clockWords(from, tz)} – ${dayWords(to, tz)}, ${clockWords(to, tz)}`;
}

/** The line every prompt starts from: "Tuesday, November 4, 2026, 3:45 PM". */
export function nowWords(now: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(now);
}

// ── money and lists ──────────────────────────────────────────────────────────

/** $16,164 — whole dollars when there are no cents. */
export function money(amount: number, currency = "USD"): string {
  const whole = Math.abs(amount - Math.round(amount)) < 0.005;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 }).format(amount);
  } catch {
    return `$${amount.toFixed(whole ? 0 : 2)}`;
  }
}

/** "Mike", "Mike and Ana", "Mike, Ana and Joe" */
export function andList(names: string[]): string {
  const n = names.filter(Boolean);
  if (n.length <= 1) return n[0] ?? "";
  return `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`;
}

/** What a read-back ends with, by channel. */
export function confirmPrompt(channel: AssistantChannel): string {
  return channel === "app" ? "Tap Do it to go ahead, or Cancel." : "Reply YES to do it, or NO.";
}

// ── what the panel reads ─────────────────────────────────────────────────────

export interface FeedAction {
  id: string;
  tool: string;
  status: ActionStatus;
  readback: string;
  result: string | null;
  createdAt: string;
}

export interface FeedMessage {
  id: string;
  direction: "IN" | "OUT";
  body: string;
  createdAt: string;
  action: FeedAction | null;
}

export interface AssistantFeed {
  messages: FeedMessage[];
  /** The read-back waiting for an answer, if any (also inside `messages`). */
  awaiting: FeedAction | null;
  /** This cycle's commands: used / the plan's number (null = unlimited). */
  usage: { used: number; limit: number | null };
}

/** A text message in the plain GSM alphabet (2026-11-05): one ×, — or curly quote turns a whole text into UCS-2,
 *  70 characters a segment instead of 160 — a build's reply (the deck's facts) would cost three times over. */
export function smsPlain(text: string): string {
  return text
    .replace(/[\u201C\u201D\u201E\u00AB\u00BB]/g, '"')
    .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
    .replace(/\s*[\u2014\u2013]\s*/g, " - ")
    .replace(/\u00D7/g, "x")
    .replace(/\s*\u00B7\s*/g, ", ")
    .replace(/\u2026/g, "...")
    .replace(/[\u2022\u25AA]/g, "-")
    .replace(/[\u00A0\u2009\u202F]/g, " ")
    .replace(/\u2192/g, "->");
}
