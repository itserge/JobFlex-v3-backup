// THE CONVERSATION UNDER A SUPPORT TICKET — pure. What a message must be, who
// it is from, where a message moves a ticket, and the letter that tells the
// other side about it. The rows and the sends are lib/supportThread; the
// customer's and the admins' writes are actions/support and actions/admin.
//
// One dialog per ticket (owner, 2026-10-17): the customer writes in the app or
// by email, the team in /admin/support or by email, the support AI from
// lib/support. Every new message goes by email to the OTHER side — our answer
// to the customer, the customer's reply to the support inbox — with the
// message, a short history and an "Open conversation" button on the ticket.

import { replyBlocks, replyPlainText } from "./support/replyCards";

export const REPLY_LIMITS = { min: 2, body: 4000 } as const;

export const MESSAGE_FROM = ["customer", "team", "ai"] as const;
export type MessageFrom = (typeof MESSAGE_FROM)[number];
export type MessageChannel = "app" | "email";
/** The support AI's sends: the answer, the "a person is on it" note, the "it's fixed" note. */
export type AiKind = "answer" | "ack" | "fixed";

/** One message in a ticket's conversation, as both consoles and the AI read it. */
export interface ThreadMessage {
  id: string;
  at: string;
  from: MessageFrom;
  /** As shown: the admin's name, "JobFlex support", or the customer's name or address. */
  by: string;
  /** Where the email about it went (team and AI messages: the customer's address). */
  to: string | null;
  body: string;
  /** Where it was written. */
  channel: MessageChannel;
  kind?: AiKind;
}

export function messageFrom(raw: unknown): MessageFrom {
  return MESSAGE_FROM.includes(raw as MessageFrom) ? (raw as MessageFrom) : "team";
}

/** The ticket's own words are the conversation's first message (they are not copied into the table). */
export function openingMessage(ticket: { id: string; body: string; createdAt: string; by: string }): ThreadMessage {
  return { id: `ticket:${ticket.id}`, at: ticket.createdAt, from: "customer", by: ticket.by, to: null, body: ticket.body, channel: "app" };
}

/** A person on our side has written in the ticket — from then on it is theirs, and the AI keeps out. */
export function personLeads(messages: Array<{ from: MessageFrom }>): boolean {
  return messages.some((m) => m.from === "team");
}

/** The message as typed, tidied — or why it cannot go. */
export function checkReply(raw: unknown): { ok: true; body: string } | { ok: false; error: string } {
  const body = typeof raw === "string" ? raw.replace(/\r\n/g, "\n").trim() : "";
  if (body.length < REPLY_LIMITS.min) return { ok: false, error: "Write the message first." };
  if (body.length > REPLY_LIMITS.body) return { ok: false, error: `Keep it under ${REPLY_LIMITS.body.toLocaleString("en-US")} characters.` };
  return { ok: true, body };
}

/** "Re: Bad sizing [JobFlex J7RCFS]" — the ref keeps a reply findable, and one subject keeps one email thread. */
export function replySubject(ticket: { subject: string; ref: string }): string {
  const subject = ticket.subject.replace(/\s+/g, " ").trim().slice(0, 120) || "Your message";
  return `Re: ${subject} [JobFlex ${ticket.ref}]`;
}

/** An answered ticket is being handled: Open becomes In progress; a resolved or closed one stays where it is. */
export function statusAfterReply(status: string): string {
  return status === "OPEN" ? "IN_PROGRESS" : status;
}

/** The customer writes again: a resolved or closed ticket opens again; an open one stays as it is. */
export function statusAfterCustomerMessage(status: string): string {
  return status === "RESOLVED" || status === "CLOSED" ? "OPEN" : status;
}

/** Paragraphs: blank lines split them; a single line break stays inside one. */
export function paragraphsOf(body: string): string[] {
  return body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

// ── The letter to the other side ─────────────────────────────────────────────

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const br = (t: string) => esc(t).replace(/\n/g, "<br>");
/** How much of the conversation a letter carries under the message. */
export const HISTORY_IN_LETTER = 3;
const HISTORY_CLIP = 400;
/** The line a reply by email is cut at (lib/supportInbound trimQuoted). */
export const REPLY_ABOVE = "## Reply above this line ##";

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function clip(body: string, n: number): string {
  const t = body.trim();
  return t.length > n ? `${t.slice(0, n).trimEnd()}…` : t;
}

/** UTC, as the consoles show times — the same words wherever the server runs. */
function dayOf(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export interface LetterMessage {
  from: MessageFrom;
  by: string;
  body: string;
  at: string;
}

export interface ConversationLetter {
  subject: string;
  html: string;
  text: string;
}

/**
 * The email about one new message, to the side that did not write it.
 *
 * To the CUSTOMER (a team or AI message): a plain letter — the message's
 * paragraphs, signed by the admin over "JobFlex support" (the team and the AI
 * sign as "JobFlex support"), the "Open conversation" button, and the last few
 * messages under it. To the TEAM (a customer message): the same shape, headed
 * with who wrote, the button going to the ticket in /admin/support.
 *
 * `link` null: no page to send them to — no dead button, just the ticket's
 * number. (Every role opens its own tickets at /dashboard/support since
 * 2026-10-17, so the app always passes one.) `replyByEmail`: the letter's Reply-To is the
 * ticket's own address (lib/supportInbound), so a reply lands in the
 * conversation — the letter says so and carries the line it is cut at.
 */
export function conversationLetter(input: {
  to: "customer" | "team";
  message: LetterMessage;
  ticket: { subject: string; ref: string; orgName?: string; customerEmail?: string | null };
  /** The conversation before this message, oldest first (the opening included). */
  history: LetterMessage[];
  link: string | null;
  replyByEmail?: boolean;
}): ConversationLetter {
  const { message, ticket } = input;
  const toCustomer = input.to === "customer";
  // Paragraphs, and the cards an answer may carry ("[offer]" / "[note]", lib/support/replyCards) — only in our letters.
  const blocks = toCustomer ? replyBlocks(message.body) : paragraphsOf(message.body).map((text) => ({ kind: "text" as const, text }));
  // The team and the AI sign as the team on one line; a person signs over the team.
  const sender = message.by.trim();
  const team = message.from === "ai" || !sender || /jobflex/i.test(sender);
  const signName = team ? "JobFlex support" : sender;
  const signLine = team ? "jobflex.app" : "JobFlex support · jobflex.app";
  const who = (m: LetterMessage) => (m.from === "customer" ? (toCustomer ? "You" : m.by || "The customer") : m.from === "ai" ? "JobFlex support" : `${m.by || "JobFlex support"}${toCustomer ? " · JobFlex support" : ""}`);
  const earlier = input.history.slice(-HISTORY_IN_LETTER);
  const omitted = input.history.length - earlier.length;
  const subject = toCustomer ? replySubject(ticket) : `${replySubject(ticket)} — ${ticket.orgName ?? "customer"} replied`;
  const head = toCustomer
    ? ""
    : `${ticket.orgName ?? "The customer"}${ticket.customerEmail ? ` (${ticket.customerEmail})` : ""} wrote in ${ticket.ref}:`;
  const replyLine = input.replyByEmail
    ? toCustomer
      ? "Reply to this email or in JobFlex — it all stays in one conversation."
      : "Reply to this email and it goes to the customer, in the conversation."
    : toCustomer
      ? "Reply to this email and it reaches us."
      : "";
  const where = input.link ? "" : toCustomer ? `Your ticket is ${ticket.ref}.` : "";

  const P = `style="margin:0 0 16px;font:15px/1.6 ${FONT};color:#1a1a1a;"`;
  const SMALL = `font:13px/1.5 ${FONT};color:#6a6a6a;`;
  const html = [
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>`,
    '<body style="margin:0;padding:0;background:#ffffff;">',
    '<div style="max-width:560px;margin:0 auto;padding:28px 20px;">',
    input.replyByEmail ? `<p style="margin:0 0 20px;font:11px/1.4 ${FONT};color:#9a9a9a;">${esc(REPLY_ABOVE)}</p>` : "",
    head ? `<p style="margin:0 0 14px;font:600 13px/1.5 ${FONT};color:#1a1a1a;">${esc(head)}</p>` : "",
    ...blocks.map((b) =>
      b.kind === "text"
        ? `<p ${P}>${br(b.text)}</p>`
        : `<div style="margin:4px 0 20px;padding:16px 18px;border:2px solid ${b.kind === "offer" ? "#1854a0" : "#0a0a0a"};border-radius:3px;background:${b.kind === "offer" ? "#eef4fc" : "#f6f4ef"};">` +
          `<div style="margin:0 0 6px;font:800 16px/1.3 ${FONT};color:${b.kind === "offer" ? "#10223d" : "#0a0a0a"};">${esc(b.title)}</div>` +
          (b.text ? `<div style="font:15px/1.55 ${FONT};color:#1a1a1a;">${br(b.text)}</div>` : "") +
          "</div>",
    ),
    toCustomer
      ? `<p style="margin:24px 0 0;font:15px/1.5 ${FONT};color:#1a1a1a;">${esc(signName)}<br><span style="color:#6a6a6a;">${esc(signLine)}</span></p>`
      : "",
    input.link
      ? `<p style="margin:24px 0 0;"><a href="${esc(input.link)}" style="display:inline-block;padding:12px 20px;background:#1854a0;border:1.5px solid #10223d;border-radius:2px;color:#ffffff;text-decoration:none;font:700 14px/1 ${FONT};">Open conversation</a></p>`
      : "",
    replyLine || where ? `<p style="margin:20px 0 0;${SMALL}">${esc([replyLine, where].filter(Boolean).join(" "))}</p>` : "",
    earlier.length
      ? [
          `<div style="margin:28px 0 0;padding:12px 0 0 14px;border-left:3px solid #e5e5e5;${SMALL}">`,
          `<div style="margin:0 0 8px;color:#8a8a8a;">Earlier in this conversation${omitted > 0 ? ` (last ${earlier.length} of ${input.history.length})` : ""}</div>`,
          ...earlier.map(
            (m) =>
              `<div style="margin:0 0 12px;"><b style="color:#4a4a4a;">${esc(who(m))}</b>${dayOf(m.at) ? ` · ${esc(dayOf(m.at))}` : ""}<br>${br(clip(m.body, HISTORY_CLIP))}</div>`,
          ),
          "</div>",
        ].join("\n")
      : "",
    "</div></body></html>",
  ]
    .filter(Boolean)
    .join("\n");

  const text = [
    input.replyByEmail ? REPLY_ABOVE : "",
    head,
    toCustomer ? replyPlainText(message.body) : paragraphsOf(message.body).join("\n\n"),
    toCustomer ? `${signName}\n${signLine}` : "",
    input.link ? `Open conversation: ${input.link}` : "",
    [replyLine, where].filter(Boolean).join(" "),
    earlier.length
      ? `--\nEarlier in this conversation:\n\n${earlier
          .map((m) => `${who(m)}${dayOf(m.at) ? ` · ${dayOf(m.at)}` : ""}\n${clip(m.body, HISTORY_CLIP).split("\n").map((l) => `> ${l}`).join("\n")}`)
          .join("\n\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  return { subject, html, text };
}
