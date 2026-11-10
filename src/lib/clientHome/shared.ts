// THE CLIENT'S HOME PAGE (2026-11-10, Smart CRM part 5) — pure rules, shared by the page, the server and the checks
// (qa/tests/logic/client-home.check.ts).
//
// One lasting link per client — /c/<token> — instead of a new link for every proposal, change order, project page,
// plan and review: their proposals with what is paid and what is left (and a Pay button), what waits for their OK,
// their projects, the next visits and work days, their documents, plan visits, a review if one was asked, the
// messages with the company (they can write back — it lands in the office's Inbox), and a button to book a visit.

/** A home token: 24+ URL-safe characters. Anything else is never looked up. */
export function isHomeToken(t: string | null | undefined): t is string {
  return typeof t === "string" && /^[A-Za-z0-9_-]{24,64}$/.test(t);
}

/** What the client sees a proposal as. A draft is never shown. */
export function proposalWords(status: string): { label: string; tone: "wait" | "ok" | "done" | "off" } | null {
  switch (status) {
    case "SENT":
    case "VIEWED":
      return { label: "Waiting for your OK", tone: "wait" };
    case "ACCEPTED":
      return { label: "Signed", tone: "ok" };
    case "COMPLETED":
      return { label: "Work done", tone: "done" };
    case "PAID":
      return { label: "Paid in full", tone: "done" };
    case "DECLINED":
      return { label: "Declined", tone: "off" };
    case "EXPIRED":
      return { label: "Expired", tone: "off" };
    default:
      return null; // DRAFT, ARCHIVED and anything new stay off the client's page
  }
}

export const MESSAGE_MAX = 2000;
/** A client may write this many messages an hour from their page — enough for a conversation, not for a flood. */
export const MESSAGES_PER_HOUR = 6;

/** The client's words, cleaned: trimmed, line breaks kept (at most two in a row), within the limit. Null = nothing. */
export function cleanMessage(v: string | null | undefined): string | null {
  const t = (v ?? "").replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (t.length < 2) return null;
  return t.slice(0, MESSAGE_MAX);
}

/** "opened today", "opened 3d ago", "never opened" — the office's line under the client's page button. */
export function openedWords(at: Date | null, now = new Date()): string {
  if (!at) return "never opened";
  const days = Math.floor((now.getTime() - at.getTime()) / 86_400_000);
  if (days <= 0) return "opened today";
  if (days === 1) return "opened yesterday";
  if (days < 30) return `opened ${days}d ago`;
  return `opened ${at.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

/** The first name the page greets ("Hi Lee"), or a plain hello. */
export function greeting(name: string | null | undefined): string {
  const first = (name ?? "").trim().split(/\s+/)[0];
  return first ? `Hi ${first}` : "Hello";
}

/** The text the office sends with the link — short enough for one text message. */
export function pageInvite(company: string, href: string): string {
  return `${company}: everything for your job in one place — your proposals, payments, schedule and messages. Save this link: ${href}`;
}
