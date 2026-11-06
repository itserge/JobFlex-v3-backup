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
  /** `pin`: four digits with the yes ("YES 1234", 2026-11-05); `bare`: the digits alone, which are a PIN only when a
   *  read-back waits for one — otherwise "2200" answers a question about square feet and is the model's. */
  | { kind: "yes"; pin?: string; bare?: boolean }
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
  const yp = /^(?:(y|yes|yeah|yep|yup|ok|okay|do it|send it|approve|confirm)\s+)?(?:pin\s*)?(\d{4})$/.exec(t);
  if (yp) return { kind: "yes", pin: yp[2], bare: !yp[1] };
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
export function confirmPrompt(channel: AssistantChannel, pin = false): string {
  if (pin) return channel === "app" ? "Enter your PIN and tap Do it, or Cancel." : "Reply YES and your PIN (like YES 1234), or NO.";
  return channel === "app" ? "Tap Do it to go ahead, or Cancel." : "Reply YES to do it, or NO.";
}

/** The changes that move money (2026-11-05): read back and waiting for the yes AND the person's PIN (lib/assistant/pin). */
export const PIN_TOOLS: readonly string[] = ["send_invoice", "financing_link"];
export function needsPin(tool: string): boolean {
  return PIN_TOOLS.includes(tool);
}

/** The changes that run at their own time with no yes (a reminder to oneself): queued means set, not working. */
export const SCHEDULED_TOOLS: readonly string[] = ["remind_me"];

// ── the morning briefing and the alerts (2026-11-05) ────────────────────────

/** The times Settings offers for the briefing, on the company's clock. */
export const BRIEFING_TIMES: readonly string[] = ["05:00", "05:30", "06:00", "06:30", "07:00", "07:30", "08:00", "08:30", "09:00"];

/** "06:30" → "6:30 AM". */
export function clock12(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** Due once the company clock has passed its time today and it hasn't gone today (`sentDay`, YYYY-MM-DD). */
export function briefingDue(time: string, now: Date, tz: string, sentDay: string | null): boolean {
  if (!/^\d{2}:\d{2}$/.test(time)) return false;
  if (sentDay === dayOf(now, tz)) return false;
  return timeOf(now, tz) >= time;
}

/** No alert texts late at night: 9 PM to 7 AM on the company's clock (the line still lands in the Operator). */
export function quietHours(now: Date, tz: string): boolean {
  const h = Number(timeOf(now, tz).slice(0, 2));
  return h >= 21 || h < 7;
}

// ── what the panel reads ─────────────────────────────────────────────────────

export interface FeedAction {
  id: string;
  tool: string;
  status: ActionStatus;
  readback: string;
  result: string | null;
  createdAt: string;
  /** What the Operator understood, from the stored arguments (factsOf) — the spec sheet on a phone (2026-11-05). */
  facts: Fact[];
  /** A running build's last step (BUILD_STEPS), else null. */
  progress: string | null;
  /** The record it made or sent, when there is one: a proposal's page. */
  link: string | null;
}

// ── the sheet: what was understood, and how far a build is (2026-11-05, batch 4) ──

export interface Fact {
  k: string;
  v: string;
}

/** A build's steps in order, as the trace names them; a running build reports the one it is on. */
export const BUILD_STEPS: Record<string, readonly string[]> = {
  build_deck: ["Deck Studio", "Rate book", "Priced", "Saved"],
  change_deck: ["Deck Studio", "Rate book", "Priced", "Saved"],
  build_estimate: ["Smart Proposal", "Priced", "Saved"],
  change_estimate: ["Smart Proposal", "Priced", "Saved"],
  build_fence: ["Lot & house", "Layout", "Priced", "Saved"],
};

/** Where a running build is: the index of its step, −1 before the first. */
export function stepIndex(tool: string, progress: string | null): number {
  const steps = BUILD_STEPS[tool];
  if (!steps || !progress) return -1;
  return steps.findIndex((s) => s.toLowerCase() === progress.toLowerCase());
}

/** What the Operator understood, from a change's stored arguments: the code's words, never the model's. */
export function factsOf(tool: string, args: unknown): Fact[] {
  const a = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const out: Fact[] = [];
  if (tool === "build_deck") {
    const w = n(a.widthFt);
    const d = n(a.depthFt);
    if (w && d) out.push({ k: "Deck", v: `${w} × ${d} ft · ${Math.round(w * d)} sq ft` });
    const h = n(a.heightFt);
    if (h) out.push({ k: "Height", v: `${h} ft${h * 12 > 30 ? " · rail required" : ""}` });
    const cover = s(a.cover);
    if (cover && cover !== "none") out.push({ k: "Cover", v: cover === "roof" ? "Roof" : cover === "pergola" ? "Pergola" : "Gazebo" });
    const boards = s(a.boards);
    if (boards) out.push({ k: "Boards", v: boards });
    const rail = s(a.rail);
    if (rail) out.push({ k: "Rail", v: rail });
    if (a.stairs === true) out.push({ k: "Stairs", v: "Yes" });
    const more = s(a.more);
    if (more) out.push({ k: "Also", v: more });
  } else if (tool === "change_deck") {
    const c = s(a.change);
    if (c) out.push({ k: "Change", v: c });
  } else if (tool === "build_fence") {
    const where = s(a.siteAddress) ?? s(a.address);
    if (where) out.push({ k: "Where", v: where });
    const off = n(a.rearOffsetFt);
    out.push({ k: "Rear", v: a.rearOnLotLine === true ? "On the rear lot line" : `${off ?? 20} ft out from the house` });
    out.push({ k: "Sides", v: "Along the lot lines to the house" });
    const gates = Array.isArray(a.gates) ? (a.gates as Array<{ where?: unknown; widthFt?: unknown }>) : [];
    out.push({ k: "Gates", v: gates.length ? gates.map((g) => `${typeof g.widthFt === "number" ? g.widthFt : 4} ft on the ${typeof g.where === "string" ? g.where : "right"}`).join(", ") : "None" });
    const h = n(a.heightFt) ?? 6;
    out.push({ k: "Fence", v: `${h} ft ${s(a.type) ?? "cedar privacy"}` });
    if (a.removeExisting === true) out.push({ k: "Also", v: "Take out the old fence" });
  } else if (tool === "build_estimate" || tool === "change_estimate") {
    const t = s(a.projectType);
    if (t) out.push({ k: "Job", v: t });
    const d = s(a.description) ?? "";
    const change = /Change:\s*([^\n]+)\s*$/.exec(d)?.[1]?.trim() ?? null;
    if (change) out.push({ k: "Change", v: change });
    else if (d) out.push({ k: "Details", v: d.length > 140 ? `${d.slice(0, 137)}…` : d });
    const addr = s(a.address);
    if (addr) out.push({ k: "Where", v: addr });
  }
  return out;
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
