// SUPPORT · THE AI'S STATE, as both sides read it (2026-10-15) — client-safe:
// no handbook, no prompts, no model. The switch's words, what is kept per
// ticket, the admin row badges, and what the customer's Help window shows
// while the AI answers and after (owner: "show the answer right there, with
// 'That solved it' and 'I still need help'"). lib/support/aiReply holds the
// prompts and letters and re-exports all of this for the server.

import type { ThreadMessage } from "@/lib/supportReply";
import { replyBlocks, type ReplyCardKind } from "./replyCards";

// ── The switch ───────────────────────────────────────────────────────────────

export const SUPPORT_AI_MODES = ["auto", "draft", "off"] as const;
export type SupportAiMode = (typeof SUPPORT_AI_MODES)[number];
export const SUPPORT_AI_MODE_LABEL: Record<SupportAiMode, string> = {
  auto: "Answers on its own",
  draft: "Drafts for you",
  off: "Off",
};
/** The owner asked for automatic answers. */
export const DEFAULT_SUPPORT_AI_MODE: SupportAiMode = "auto";

export function supportAiMode(raw: unknown): SupportAiMode {
  return SUPPORT_AI_MODES.includes(raw as SupportAiMode) ? (raw as SupportAiMode) : DEFAULT_SUPPORT_AI_MODE;
}

// ── What the AI makes of a ticket ────────────────────────────────────────────

export const SUPPORT_AI_CATEGORIES = ["how-to", "billing", "account", "bug", "feature-request", "feedback", "other"] as const;
export type SupportAiCategory = (typeof SUPPORT_AI_CATEGORIES)[number];
export const SUPPORT_AI_CATEGORY_LABEL: Record<SupportAiCategory, string> = {
  "how-to": "How-to",
  billing: "Billing",
  account: "Account",
  bug: "Bug",
  "feature-request": "Feature request",
  feedback: "Feedback",
  other: "Other",
};

export const SEVERITIES = ["low", "normal", "high"] as const;
export type Severity = (typeof SEVERITIES)[number];

/** A bug, as the AI hands it to the team. */
export interface SupportAiBug {
  title: string;
  symptoms: string;
  likelyCause: string;
  proposedFix: string;
  areas: string[];
  severity: Severity;
  workaround?: string;
}

// ── What is kept per ticket (SyncState `supportAi:<ticketId>`) ───────────────

export type SupportAiOutcome = "sent" | "held" | "drafted" | "failed";
export type FixStatus = "awaiting" | "approved" | "declined" | "done";

export interface SupportAiFix extends SupportAiBug {
  status: FixStatus;
  decidedBy?: string;
  decidedAt?: string;
  note?: string;
  doneBy?: string;
  doneAt?: string;
}

/** The customer's word on the answer, from the Help window. */
export type CustomerVerdict = { verdict: "solved" | "needs-person"; note?: string; at: string };

export interface SupportAiRecord {
  v: 1;
  at: string;
  model: string;
  outcome: SupportAiOutcome;
  /** Why it was held or drafted, or what failed. */
  reason?: string;
  category: SupportAiCategory;
  summary: string;
  confidence: number;
  language: string;
  /** The answer the AI wrote — sent, or waiting in admin. */
  reply: string;
  /** For a held answer: the "we've got it" note went to the customer. */
  ackSent?: boolean;
  internalNotes: string;
  factsUsed: string[];
  fix: SupportAiFix | null;
  /** The copy to the support inbox went out. */
  copied?: boolean;
  /** "That solved it" / "I still need help" from the Help window. */
  customer?: CustomerVerdict;
}

export function parseSupportAiRecord(raw: string | null | undefined): SupportAiRecord | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as SupportAiRecord;
    return v && v.v === 1 && typeof v.outcome === "string" ? v : null;
  } catch {
    return null;
  }
}

// ── The admin row badge ──────────────────────────────────────────────────────

export type SupportAiBadge = { label: string; tone: "ok" | "warn" | "danger" | "info" | "muted" };

/** When the last thing that asks for a person happened: the AI's reading, or
 *  the customer's "I still need help" after it. A person's reply after this
 *  means it is handled. */
export function needsPersonSince(r: SupportAiRecord): string {
  return r.customer?.verdict === "needs-person" && r.customer.at > r.at ? r.customer.at : r.at;
}

/** `answeredByPerson`: an admin replied after needsPersonSince(r) — a held,
 *  drafted or still-stuck ticket is then handled, not waiting. */
export function badgeFor(r: SupportAiRecord | null, answeredByPerson = false): SupportAiBadge | null {
  if (!r) return null;
  if (r.customer?.verdict === "needs-person" && !answeredByPerson) return { label: "Needs you — still stuck", tone: "warn" };
  if (r.fix) {
    if (r.fix.status === "awaiting") return { label: "Fix waiting for OK", tone: "danger" };
    if (r.fix.status === "approved") return { label: "Fix approved", tone: "info" };
    if (r.fix.status === "done") return { label: "Fixed", tone: "ok" };
  }
  if (r.customer?.verdict === "solved") return { label: "Solved by AI", tone: "ok" };
  if (r.outcome === "sent") return { label: answeredByPerson && r.customer ? "Answered" : "AI answered", tone: "ok" };
  if (answeredByPerson && (r.outcome === "held" || r.outcome === "drafted")) return { label: "Answered", tone: "ok" };
  if (r.outcome === "held") return { label: "Needs you", tone: "warn" };
  if (r.outcome === "drafted") return { label: "AI draft", tone: "info" };
  return { label: "AI couldn't answer", tone: "muted" };
}

/** Waiting for a person: held or drafted, or the customer said it isn't
 *  solved — and nobody has replied since. */
export function waitingForPerson(r: SupportAiRecord | null, answeredByPerson: boolean): boolean {
  if (!r || answeredByPerson) return false;
  return r.outcome === "held" || r.outcome === "drafted" || r.customer?.verdict === "needs-person";
}

// ── May the AI write in the conversation? ───────────────────────────────────

/** The AI's own messages a ticket may carry before it is left to the team. */
export const AI_MESSAGES_MAX = 6;

/**
 * The AI answers in the conversation (owner, 2026-10-17) only while no person
 * leads it: no one on the team has written, it didn't already hand the ticket
 * to a person (a held answer), the customer didn't ask for one ("I still need
 * help"), and it hasn't said its share already. Why not, when not.
 */
export function aiMayAnswer(thread: Array<{ from: string }>, r: SupportAiRecord | null): { ok: true } | { ok: false; why: string } {
  if (thread.some((m) => m.from === "team")) return { ok: false, why: "a person on the team leads this ticket" };
  if (r?.outcome === "held") return { ok: false, why: "it was handed to a person" };
  if (r?.customer?.verdict === "needs-person") return { ok: false, why: "the customer asked for a person" };
  if (thread.filter((m) => m.from === "ai").length >= AI_MESSAGES_MAX) return { ok: false, why: `the AI already wrote ${AI_MESSAGES_MAX} messages here` };
  return { ok: true };
}

// ── The Help window, while and after the AI answers ─────────────────────────

export type LiveState =
  /** The AI is reading it — ask again in a moment. */
  | { state: "pending" }
  /** The answer that went out, as the customer got it by email. */
  | { state: "answer"; body: string; verdict?: CustomerVerdict["verdict"] }
  /** A person will answer; the customer already got the "we're on it" note. */
  | { state: "held" }
  /** No AI answer is coming (switched off, drafts only, or it couldn't). */
  | { state: "none" };

/** What the Help window shows for a ticket, from its AI record and thread. */
export function liveStateOf(r: SupportAiRecord | null, thread: ThreadMessage[], o: { mode: SupportAiMode; aiOn: boolean }): LiveState {
  if (!r) return o.mode === "auto" && o.aiOn ? { state: "pending" } : { state: "none" };
  if (r.outcome === "sent") {
    const sent = [...thread].reverse().find((x) => x.from === "ai" && x.kind === "answer");
    if (!sent) return { state: "none" };
    return r.customer ? { state: "answer", body: sent.body, verdict: r.customer.verdict } : { state: "answer", body: sent.body };
  }
  if (r.outcome === "held" && r.ackSent) return { state: "held" };
  return { state: "none" };
}

/** A piece of an answer's paragraph: words, a line break, or a link to one of JobFlex's own pages. */
export type AnswerPiece = { text: string } | { br: true } | { path: string; label: string };

const OWN_LINK = /https?:\/\/(?:www\.)?jobflex\.app(\/[^\s<>"'()]*)?/gi;

/** One paragraph's pieces: words, line breaks, JobFlex's own links as clickable paths (any other address stays text). */
function piecesOf(p: string): AnswerPiece[] {
  const out: AnswerPiece[] = [];
  const words = (s: string) => {
    s.split("\n").forEach((line, i) => {
      if (i > 0) out.push({ br: true });
      if (line) out.push({ text: line });
    });
  };
  let last = 0;
  for (const m of p.matchAll(OWN_LINK)) {
    const at = m.index ?? 0;
    if (at > last) words(p.slice(last, at));
    let label = m[0];
    const trail = label.match(/[.,;:!?]+$/)?.[0] ?? "";
    if (trail) label = label.slice(0, -trail.length);
    const path = (m[1] ?? "/").slice(0, (m[1] ?? "/").length - (m[1] ? trail.length : 0)) || "/";
    out.push({ path, label });
    if (trail) out.push({ text: trail });
    last = at + m[0].length;
  }
  if (last < p.length) words(p.slice(last));
  return out;
}

/** The email's closing "just reply to this email" line, dropped in the app — the window has its own "I still need help". */
const isReplyLine = (p: string) => /reply to this email/i.test(p) && p.length < 200;

/**
 * The answer as the Help window and the support page draw it: paragraphs, and the cards (lib/support/replyCards —
 * "[offer] …" / "[note] …") as cards with their title. Links to JobFlex's own pages become clickable PATHS — they open
 * on whatever host the customer is on — and any other address stays plain text: an answer never links off the app.
 */
export type AnswerBlock = { kind: "text"; parts: AnswerPiece[] } | { kind: ReplyCardKind; title: string; parts: AnswerPiece[] };
export function answerBlocks(body: string): AnswerBlock[] {
  const blocks = replyBlocks(body);
  const lastB = blocks[blocks.length - 1];
  if (blocks.length > 1 && lastB.kind === "text" && isReplyLine(lastB.text)) blocks.pop();
  return blocks.map((b) => (b.kind === "text" ? { kind: "text", parts: piecesOf(b.text) } : { kind: b.kind, title: b.title, parts: piecesOf(b.text) }));
}

/** The answer's paragraphs, flat (a card's title and text as one paragraph) — answerBlocks draws the cards. */
export function answerParts(body: string): AnswerPiece[][] {
  return answerBlocks(body).map((b) => (b.kind === "text" ? b.parts : [{ text: b.title }, ...(b.parts.length ? [{ br: true } as AnswerPiece, ...b.parts] : [])]));
}
