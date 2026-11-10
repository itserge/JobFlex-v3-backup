// THE FOLLOW-UP AGENT — the deciding half (Smart CRM part 4, 2026-11-10; the owner's spec §11).
//
// A rule used to be a timer: N days after the status changed, the standard words went out, whatever had happened
// in between. Now each queued follow-up is looked at when its time comes, with what is known about the client:
//   · the proposal moved on, the deal was marked lost, or the client wrote back  → it is closed unsent;
//   · a person just wrote to them, we still owe them something, or another follow-up just went → it waits;
//   · it is night on the company's clock → it waits for the morning (8:00–20:00 only);
//   · otherwise it goes — on its own (AUTO), or to a person first: a prepared draft waiting for a yes (ASK), or a
//     plain reminder to follow up (SUGGEST).
// And the words can be the standard ones (lib/followUps/copy) or written for this client from their history
// (lib/followUps/writer) — kept only when they pass `draftOk` below.
//
// PURE — no I/O, no `db`. Imported by the editors (desk and phone CRM), the engine and the logic checks.

export type FollowUpMode = "AUTO" | "ASK" | "SUGGEST";
export type FollowUpWords = "STANDARD" | "AI";

export const FOLLOW_UP_MODES: Array<{ value: FollowUpMode; label: string; hint: string }> = [
  { value: "AUTO", label: "Send on its own", hint: "Goes out at its time. Stops by itself when the client replies, signs or pays." },
  { value: "ASK", label: "Ask me first", hint: "The message is prepared and waits on the Today tab for your OK." },
  { value: "SUGGEST", label: "Just remind me", hint: "Nothing is written or sent — you get a reminder to follow up yourself." },
];

export const FOLLOW_UP_WORDS: Array<{ value: FollowUpWords; label: string; hint: string }> = [
  { value: "STANDARD", label: "Standard words", hint: "The same message for every client — the preview below." },
  { value: "AI", label: "Written by AI", hint: "AI writes it from the client's history. If it can't, the standard words go." },
];

export function parseMode(stored: string | null | undefined): FollowUpMode {
  return stored === "ASK" || stored === "SUGGEST" ? stored : "AUTO";
}
export function parseWords(stored: string | null | undefined): FollowUpWords {
  return stored === "AI" ? "AI" : "STANDARD";
}
export function modeLabel(m: FollowUpMode): string {
  return m === "ASK" ? "Asks you first" : m === "SUGGEST" ? "Reminds you" : "Sends on its own";
}
export function wordsLabel(w: FollowUpWords): string {
  return w === "AI" ? "AI words" : "Standard words";
}

// ── the decision ─────────────────────────────────────────────────────────────

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** A person wrote to the client this recently: the agent stays out of the conversation. */
export const HAND_WRITTEN_QUIET_MS = 2 * DAY;
/** No client hears from two follow-ups closer together than this, whatever the rules say. */
export const BETWEEN_FOLLOW_UPS_MS = 20 * HOUR;
/** An open promise of ours holds a chase only this long past its due day — a promise nobody closes never blocks forever. */
export const PROMISE_HOLD_MS = 3 * DAY;
/** A draft nobody acted on is closed after this. */
export const READY_EXPIRES_MS = 7 * DAY;
/** Follow-ups go out between these hours on the company's clock. */
export const SEND_FROM_HOUR = 8;
export const SEND_UNTIL_HOUR = 20;

/** The triggers that chase an answer. A thank-you (ACCEPTED, PAID) is not stopped by a reply or held by a promise. */
const CHASES = new Set(["SENT", "VIEWED", "DECLINED"]);
/** "Haven't heard back" is wrong once they wrote. A DECLINED client who wrote back is talking to a person too. */
const STOPS_ON_REPLY = new Set(["SENT", "VIEWED", "DECLINED"]);

/** The statuses in which a queued follow-up still makes sense, by the trigger that queued it (moved here from the
 *  engine). A client opening the quote (VIEWED) is still no answer. */
const STILL_CURRENT: Record<string, readonly string[]> = {
  SENT: ["SENT", "VIEWED"],
  PAID: ["PAID", "COMPLETED"],
};
export function stillCurrent(trigger: string, status: string): boolean {
  return (STILL_CURRENT[trigger] ?? [trigger]).includes(status);
}

export interface AgentFacts {
  now: Date;
  /** The company's time zone. */
  tz: string;
  trigger: string;
  proposalStatus: string;
  mode: FollowUpMode;
  state: "QUEUED" | "READY";
  readyAt: Date | null;
  /** When the proposal reached the moment this follow-up is about (it was sent). Null = unknown, no reply check. */
  since: Date | null;
  /** The client's newest message, text or call to the company. */
  lastInboundAt: Date | null;
  /** A person marked the deal lost on the pipeline board. */
  dealLost: boolean;
  /** The newest message a person (not a rule) wrote to this client. */
  lastHandWrittenAt: Date | null;
  /** The newest follow-up that actually went to this client, on any proposal. */
  lastFollowUpAt: Date | null;
  /** Our oldest open promise to this client, if any. */
  ourPromise: { text: string; dueAt: Date | null; createdAt: Date } | null;
}

export type AgentDecision =
  /** Close it unsent; `why` goes on the row. */
  | { do: "stop"; why: string }
  /** Not now: look again at `until`; `why` shows on the queue row. */
  | { do: "wait"; until: Date; why: string }
  /** A waiting draft stays waiting. */
  | { do: "keep" }
  /** Hand it to a person (ASK / SUGGEST). */
  | { do: "ready" }
  | { do: "send" };

function hourIn(now: Date, tz: string): number {
  try {
    const h = new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: tz }).format(now);
    return Number(h) % 24;
  } catch {
    return now.getUTCHours();
  }
}

function shortDay(d: Date, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: tz }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** What to do with one follow-up whose time has come (or one that is waiting for a person). */
export function decide(f: AgentFacts): AgentDecision {
  const trigger = (f.trigger || "SENT").toUpperCase();
  const t = f.now.getTime();

  // 1. It no longer makes sense — closed, never sent.
  if (!stillCurrent(trigger, f.proposalStatus)) return { do: "stop", why: f.proposalStatus };
  if (f.dealLost && CHASES.has(trigger)) return { do: "stop", why: "deal marked lost" };
  if (STOPS_ON_REPLY.has(trigger) && f.since && f.lastInboundAt && f.lastInboundAt.getTime() > f.since.getTime()) {
    return { do: "stop", why: `client replied ${shortDay(f.lastInboundAt, f.tz)}` };
  }

  // 2. Already in a person's hands.
  if (f.state === "READY") {
    if (f.readyAt && t - f.readyAt.getTime() > READY_EXPIRES_MS) return { do: "stop", why: "nobody sent it in 7 days" };
    return { do: "keep" };
  }

  // 3. Not now.
  if (CHASES.has(trigger)) {
    if (f.lastHandWrittenAt && t - f.lastHandWrittenAt.getTime() < HAND_WRITTEN_QUIET_MS) {
      return { do: "wait", until: new Date(f.lastHandWrittenAt.getTime() + HAND_WRITTEN_QUIET_MS), why: `Someone wrote to them ${shortDay(f.lastHandWrittenAt, f.tz)} — waiting 2 days` };
    }
    if (f.ourPromise) {
      const anchor = (f.ourPromise.dueAt ?? f.ourPromise.createdAt).getTime();
      if (t < anchor + PROMISE_HOLD_MS) {
        return { do: "wait", until: new Date(Math.min(t + DAY, anchor + PROMISE_HOLD_MS)), why: `We still owe them: ${f.ourPromise.text.slice(0, 80)}` };
      }
    }
  }
  if (f.lastFollowUpAt && t - f.lastFollowUpAt.getTime() < BETWEEN_FOLLOW_UPS_MS) {
    return { do: "wait", until: new Date(f.lastFollowUpAt.getTime() + BETWEEN_FOLLOW_UPS_MS), why: "Another follow-up just went to them" };
  }

  // 4. A person decides at any hour; the agent itself sends by day only.
  if (f.mode !== "AUTO") return { do: "ready" };
  const h = hourIn(f.now, f.tz);
  if (h < SEND_FROM_HOUR || h >= SEND_UNTIL_HOUR) {
    // Pushed to the top of the first sending hour, so a night's worth of rows never crowds the hourly run.
    const hours = h >= SEND_UNTIL_HOUR ? 24 - h + SEND_FROM_HOUR : SEND_FROM_HOUR - h;
    const until = new Date(t + hours * HOUR);
    until.setUTCMinutes(0, 0, 0);
    return { do: "wait", until, why: "Night — it goes in the morning" };
  }
  return { do: "send" };
}

// ── AI words: what is allowed out ────────────────────────────────────────────

/** The numbers a text states: "$14,850" → "14850", "3 days" → "3". */
export function numbersIn(s: string): string[] {
  return (s.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((x) => String(Number(x.replace(/,/g, ""))));
}

export const DRAFT_MAX = { EMAIL: 900, TEXT: 300 } as const;

/**
 * A written-for-this-client draft is used only when it is safe to send without a person reading it first:
 * the right length, no link or address of its own (the code adds the proposal link), nothing that looks like a
 * placeholder, and every number in it is one the facts gave. Anything else → the standard words go instead.
 */
export function draftOk(body: string, channel: "EMAIL" | "TEXT", facts: string): boolean {
  const t = body.trim();
  if (t.length < 20 || t.length > DRAFT_MAX[channel]) return false;
  if (/https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|app|io)\b/i.test(t)) return false;
  if (/[\[\]{}<>]|\bTBD\b|\bXX+\b/.test(t)) return false;
  if (/\S+@\S+\.\S+/.test(t)) return false;
  const allowed = new Set(numbersIn(facts));
  return numbersIn(t).every((n) => allowed.has(n));
}

/** A draft's paragraphs, for the email frame. */
export function draftParagraphs(body: string): string[] {
  return body
    .split(/\n\s*\n|\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, 6);
}

/** A text draft with the proposal link the code adds — once. Thank-yous carry no link. */
export function textWithLink(body: string, trigger: string, href: string): string {
  const t = body.trim();
  if (!CHASES.has((trigger || "SENT").toUpperCase()) || t.includes(href)) return t;
  return `${t} ${href}`;
}

// ── the row, as the lists show it ────────────────────────────────────────────

export interface WaitingFollowUp {
  id: string;
  clientId: string | null;
  client: string;
  proposalId: string | null;
  title: string;
  total: number;
  trigger: string;
  channel: "EMAIL" | "TEXT";
  mode: FollowUpMode;
  /** "ai" | "rules" | "person" | null (SUGGEST: nothing written yet). */
  draftBy: string | null;
  draftSubject: string | null;
  draftBody: string | null;
  /** The rule's name ("Sent · day 2"). */
  rule: string;
  readyAt: number;
}

/** One line for the Operator and the briefing: "Olga Petrova — Rear deck ($14,850), email ready". */
export function waitingLine(w: WaitingFollowUp, money: (n: number) => string): string {
  const what = w.mode === "SUGGEST" && !w.draftBody ? "follow up yourself" : `${w.channel === "TEXT" ? "text" : "email"} ready`;
  return `${w.client} — ${w.title} (${money(w.total)}), ${what}`;
}
