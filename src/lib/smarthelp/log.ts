// SmartHelp · THE SERVER'S PURE HALF (lib/smarthelp/server does the reads, the model call and the writes): the question
// log's keys and record, the text of a reply, the guide counters, what the panel may send, and the answer given
// without asking the model. Pure — no server-only, no database, only types from ./answer (which carries the handbook)
// — so the panel imports replyText for "Ask a person" and qa/tests/logic/smarthelp-log.check.ts runs it all.
//
// THE QUESTION LOG (SyncState, no schema change): one row per typed question, key `smarthelp:q:<ISO time>-<rand>`, so
// the keys sort by time as strings; the cursor is a QuestionLog as JSON. Kept 90 days. A question that carries a
// secret is never stored: HELD_QUESTION stands in its place. Each guide's counters sit in `smarthelp:g:<id>`.
import { PERSON_REPLY, personTopic, secretTopic, type PersonTopic } from "./personTopic";
import type { SmartHelpReply } from "./answer";

export const LOG_PREFIX = "smarthelp:q:";
export const GUIDE_PREFIX = "smarthelp:g:";
/** How long a question is kept (counted from its row's last update). */
export const LOG_KEEP_DAYS = 90;
/** The longest question SmartHelp takes. */
export const QUESTION_MAX = 1000;
/** The longest a reply's text runs — the log's answer, and an earlier answer sent back with the next question. */
export const REPLY_TEXT_MAX = 2000;
/** What the log keeps instead of a question that looked like it carried a secret. */
export const HELD_QUESTION = "(held: looked like a password, card or code)";
/** The turns of the conversation the panel may send back (it keeps 20; the model reads the last 6). */
const HISTORY_KEEP = 20;

// ── Keys ─────────────────────────────────────────────────────────────────────

/** A log entry's id, `<ISO time>-<rand>`: its key without the prefix — what the panel holds and sends back to rate it.
 *  The one place an id is made. */
export function logIdOf(at: Date, rand: string): string {
  return `${at.toISOString()}-${rand}`;
}

/** `smarthelp:q:<ISO time>-<rand>` — an ISO time has a fixed width, so the keys sort by time as strings. */
export function logKey(at: Date, rand: string): string {
  return `${LOG_PREFIX}${logIdOf(at, rand)}`;
}

const LOG_ID = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z-[a-z0-9]{4,16}$/;

/** True for the id of a log entry, and nothing else — the panel's id never names another row. */
export function isLogId(v: unknown): v is string {
  return typeof v === "string" && LOG_ID.test(v);
}

export function guideKey(id: string): string {
  return `${GUIDE_PREFIX}${id}`;
}

// ── The record ───────────────────────────────────────────────────────────────

export type QuestionLog = {
  id: string;
  at: string;
  orgId: string;
  orgName: string;
  userId: string;
  userName: string | null;
  role: string | null;
  plan: string | null;
  page: string;
  question: string;
  answer: string;
  kind: SmartHelpReply["kind"];
  outcome: "none" | "up" | "down" | "person";
};

const KINDS: ReadonlyArray<SmartHelpReply["kind"]> = ["steps", "explain", "person", "unknown"];
const OUTCOMES: ReadonlyArray<QuestionLog["outcome"]> = ["none", "up", "down", "person"];

/** The row for one typed question: SmartHelp's reply as text, no rating yet. A secret in the question is not kept. */
export function questionLog(input: {
  at: Date;
  rand: string;
  orgId: string;
  orgName: string;
  userId: string;
  userName: string | null;
  role: string | null;
  plan: string | null;
  page: string;
  question: string;
  reply: SmartHelpReply;
}): QuestionLog {
  const { at, question, reply } = input;
  return {
    id: logIdOf(at, input.rand),
    at: at.toISOString(),
    orgId: input.orgId,
    orgName: input.orgName,
    userId: input.userId,
    userName: input.userName,
    role: input.role,
    plan: input.plan,
    page: cleanPage(input.page),
    question: secretTopic(question) ? HELD_QUESTION : question.trim().slice(0, QUESTION_MAX),
    answer: replyText(reply),
    kind: reply.kind,
    outcome: "none",
  };
}

/** A log row as written by questionLog, or null for junk. A field it can't read is mended, never guessed. */
export function parseQuestionLog(cursor: string): QuestionLog | null {
  let v: unknown;
  try {
    v = JSON.parse(cursor);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  const str = (k: string): string | null => (typeof r[k] === "string" ? (r[k] as string) : null);
  const [id, at, orgId, userId] = [str("id"), str("at"), str("orgId"), str("userId")];
  if (!id || !at || !orgId || !userId) return null;
  const kind = KINDS.find((k) => k === r.kind) ?? "unknown";
  const outcome = OUTCOMES.find((o) => o === r.outcome) ?? "none";
  return {
    id,
    at,
    orgId,
    orgName: str("orgName") ?? "",
    userId,
    userName: str("userName"),
    role: str("role"),
    plan: str("plan"),
    page: str("page") ?? "",
    question: str("question") ?? "",
    answer: str("answer") ?? "",
    kind,
    outcome,
  };
}

/** The entry after a 👍 / 👎 or an "Ask a person". A rating replaces a rating; once they asked a person, that stays —
 *  it is the strongest thing the owner can learn about an answer. */
export function withOutcome(rec: QuestionLog, outcome: Exclude<QuestionLog["outcome"], "none">): QuestionLog {
  return rec.outcome === "person" ? rec : { ...rec, outcome };
}

// ── The text of a reply ──────────────────────────────────────────────────────

/** A reply as plain text: the title, the steps numbered "1. …" (their words only — no Open or Show me), the note.
 *  At most REPLY_TEXT_MAX characters. */
export function replyText(r: SmartHelpReply): string {
  const blocks = [r.title.trim(), r.steps.map((s, i) => `${i + 1}. ${s.text.trim()}`).join("\n"), r.note?.trim() ?? ""];
  const text = blocks.filter(Boolean).join("\n\n");
  return text.length <= REPLY_TEXT_MAX ? text : `${text.slice(0, REPLY_TEXT_MAX - 1).trimEnd()}…`;
}

/** What SmartHelp says to a person topic it answers without the model: the topic's line, no steps. */
export function personReply(topic: PersonTopic): SmartHelpReply {
  return { kind: "person", title: PERSON_REPLY[topic], steps: [], note: null };
}

// ── The answer given without the model ───────────────────────────────────────

/** A question SmartHelp answers without asking the model, or null when the model answers it.
 *  A secret is always caught (security, never forced: it must not reach OpenAI); a person topic is caught unless the
 *  person pressed "Answer it anyway" (`force`) — the model's own rules and cleanAnswer's guards still bind then. */
export function replyWithoutModel(question: string, force: boolean): { reply: SmartHelpReply; canForce: boolean } | null {
  if (secretTopic(question)) return { reply: personReply("security"), canForce: false };
  if (force) return null;
  const topic = personTopic(question);
  return topic ? { reply: personReply(topic), canForce: true } : null;
}

// ── Guide counters ───────────────────────────────────────────────────────────

export type GuideCounts = { opens: number; up: number; down: number };

/** A guide's counters from its row; none yet, or junk, is all zero. */
export function parseGuideCounts(cursor: string | null | undefined): GuideCounts {
  const zero: GuideCounts = { opens: 0, up: 0, down: 0 };
  if (!cursor) return zero;
  let v: unknown;
  try {
    v = JSON.parse(cursor);
  } catch {
    return zero;
  }
  if (!v || typeof v !== "object") return zero;
  const r = v as Record<string, unknown>;
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x > 0 ? Math.floor(x) : 0);
  return { opens: n(r.opens), up: n(r.up), down: n(r.down) };
}

export function bumpGuideCount(c: GuideCounts, field: keyof GuideCounts): GuideCounts {
  return { ...c, [field]: c[field] + 1 };
}

// ── What the panel sends ─────────────────────────────────────────────────────

/** The question as typed, trimmed: 1 to QUESTION_MAX characters. */
export function questionOf(raw: unknown): { question: string } | { error: string } {
  const question = typeof raw === "string" ? raw.trim() : "";
  if (!question) return { error: "Type your question first." };
  if (question.length > QUESTION_MAX) return { error: "That's over 1,000 characters — shorten it a little and ask again." };
  return { question };
}

const HOME = "/dashboard";
/** A settings pane's key, as in /dashboard/settings?pane=payments. */
const PANE = /^[a-z-]{1,30}$/;

/** The page the panel says it is on. Context words for the model and the log only — never a link: an app path of up
 *  to 300 characters with no spaces, plus its settings pane (`?pane=<key>`) if it names one. Every other query and the
 *  hash are dropped — a sign-in code, a token or a search for a client never reaches the prompt or the log. Anything
 *  else is the Overview. */
export function cleanPage(page: unknown): string {
  if (typeof page !== "string") return HOME;
  const noHash = page.split("#")[0];
  const q = noHash.indexOf("?");
  const path = q < 0 ? noHash : noHash.slice(0, q);
  if (!/^\/\S{0,299}$/.test(path)) return HOME;
  const pane = q < 0 ? null : new URLSearchParams(noHash.slice(q + 1)).get("pane");
  const withPane = pane && PANE.test(pane) ? `${path}?pane=${pane}` : path;
  return withPane.length <= 300 ? withPane : path;
}

export type Turn = { q: string; a: string };

/** The conversation the panel sends back: well-formed turns, trimmed and clipped, the last HISTORY_KEEP — and never a
 *  turn with a secret in it. The panel keeps what was typed; a password pasted three questions ago must not reach the
 *  model with the next one. */
export function cleanHistory(raw: unknown): Turn[] {
  if (!Array.isArray(raw)) return [];
  const turns: Turn[] = [];
  for (const item of raw.slice(-HISTORY_KEEP)) {
    if (!item || typeof item !== "object") continue;
    const { q, a } = item as { q?: unknown; a?: unknown };
    if (typeof q !== "string" || typeof a !== "string" || !q.trim()) continue;
    if (secretTopic(q) || secretTopic(a)) continue;
    turns.push({ q: q.trim().slice(0, QUESTION_MAX), a: a.trim().slice(0, REPLY_TEXT_MAX) });
  }
  return turns;
}

// ── What the owner sees (/admin/support → SmartHelp) ─────────────────────────

const WEEK_MS = 7 * 86_400_000;

/** The SmartHelp tab's four facts over the last 7 days (a question exactly 7 days old still counts): questions asked,
 *  👍, 👎, sent to a person — and the questions SmartHelp didn't answer (it left them to a person, wasn't sure, or got
 *  a 👎), newest first, so the owner sees which guide to write next. A row that can't say when it was asked is left
 *  out. */
export function smartHelpSummary(
  questions: QuestionLog[],
  now: Date,
): { week: number; up: number; down: number; person: number; unanswered: QuestionLog[] } {
  const since = now.getTime() - WEEK_MS;
  const recent = questions
    .filter((q) => {
      const t = Date.parse(q.at);
      return Number.isFinite(t) && t >= since;
    })
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const count = (outcome: QuestionLog["outcome"]) => recent.filter((q) => q.outcome === outcome).length;
  return {
    week: recent.length,
    up: count("up"),
    down: count("down"),
    person: count("person"),
    unanswered: recent.filter((q) => q.kind === "unknown" || q.kind === "person" || q.outcome === "down"),
  };
}
