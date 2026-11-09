// THE INBOX — THE PURE RULES (Smart CRM part 2, 2026-11-08; the plan doc "JobFlex Smart CRM — plan").
// One thread per client. A client's email reply reaches us at c-<token>@<the receiving domain> — the same receiving
// domain and webhook the subcontractors' quotes-by-email use (lib/subInbound), a different prefix. Everything here
// is pure and proved by qa/tests/logic/inbox.check.ts; the database half is ./server.

import { emailAddressOf } from "@/lib/supportInbound";

export const THREAD_PREFIX = "c-";

/** The Reply-To a client's email carries: the token names the thread, the domain is the receiving subdomain. */
export function threadAddress(token: string, domain: string): string {
  return `${THREAD_PREFIX}${token}@${domain.trim().toLowerCase()}`;
}

const TOKEN_RE = /^c-([a-z0-9]{10,40})$/i;

/** The thread token in one of our addresses; null for any other address (an rfq- address among them). */
export function threadTokenFromAddress(raw: string | null | undefined, domain: string | null): string | null {
  const addr = emailAddressOf(raw ?? null);
  if (!addr) return null;
  const at = addr.lastIndexOf("@");
  if (at < 0) return null;
  if (domain && addr.slice(at + 1).toLowerCase() !== domain.trim().toLowerCase()) return null;
  const m = TOKEN_RE.exec(addr.slice(0, at));
  return m ? m[1] : null;
}

/** The first thread token among To, Cc and the envelope's recipients. */
export function threadTokenFromAddresses(addrs: ReadonlyArray<string | null | undefined>, domain: string | null): string | null {
  for (const a of addrs) {
    const t = threadTokenFromAddress(a, domain);
    if (t) return t;
  }
  return null;
}

export type ThreadStatus = "OPEN" | "NEEDS_REPLY" | "WAITING" | "CLOSED";

/** Where the thread stands after a message: an inbound message needs an answer (and reopens a closed thread);
 *  an outbound one means we are waiting on the client. */
export function statusAfter(current: string, direction: "IN" | "OUT"): ThreadStatus {
  if (direction === "IN") return "NEEDS_REPLY";
  return current === "CLOSED" ? "CLOSED" : "WAITING";
}

/** One line for the thread list. */
export function preview(s: string | null | undefined, max = 120): string {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** The thread list's filters — the plan's words. */
export const INBOX_FILTERS = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "needs", label: "Needs answer" },
  { key: "urgent", label: "Urgent" },
  { key: "mine", label: "Mine" },
  { key: "waiting", label: "Waiting on client" },
  { key: "closed", label: "Closed" },
] as const;
export type InboxFilter = (typeof INBOX_FILTERS)[number]["key"];

/** What the reader hands back for one inbound message (lib/inbox/reader): the page's "what this means" panel. */
export interface MessageRead {
  intent: string | null;
  urgent: boolean;
  needsReply: boolean;
  summary: string | null;
  requests: string[];
  changes: string[];
  deadlines: Array<{ what: string; date: string | null }>;
  questions: string[];
  money: string[];
  complaints: string[];
  promises: Array<{ text: string; due: string | null }>;
  suggested: string | null;
}

/** The model's answer, checked field by field — anything malformed becomes the empty shape, never a throw. */
export function parseMessageRead(raw: unknown): MessageRead {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown, max = 200) => (typeof v === "string" && v.trim() ? v.replace(/\s+/g, " ").trim().slice(0, max) : null);
  const list = (v: unknown, max = 6) => (Array.isArray(v) ? v.map((x) => str(x)).filter((x): x is string => !!x).slice(0, max) : []);
  const dated = (v: unknown, key: string, max = 4) =>
    Array.isArray(v)
      ? v
          .map((x) => {
            const r = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
            const what = str(r[key], 160);
            const d = str(r.date ?? r.due, 24);
            return what ? { [key === "what" ? "what" : "text"]: what, [key === "what" ? "date" : "due"]: d && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null } : null;
          })
          .filter((x): x is never => !!x)
          .slice(0, max)
      : [];
  return {
    intent: str(o.intent, 80),
    urgent: o.urgent === true,
    needsReply: o.needsReply !== false,
    summary: str(o.summary, 300),
    requests: list(o.requests),
    changes: list(o.changes),
    deadlines: dated(o.deadlines, "what") as MessageRead["deadlines"],
    questions: list(o.questions),
    money: list(o.money),
    complaints: list(o.complaints),
    promises: dated(o.promises, "text") as MessageRead["promises"],
    suggested: str(o.suggested, 200),
  };
}
