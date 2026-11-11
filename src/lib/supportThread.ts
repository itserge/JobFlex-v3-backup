import "server-only";
// THE CONVERSATION UNDER A SUPPORT TICKET (owner, 2026-10-17: "one dialog per
// ticket that can be written to from anywhere") — the rows and the sends.
//
// A message is kept FIRST and then told to the other side by email: the
// conversation in the app is the record, the email is the notice. So a failed
// send never loses the words — the result says it didn't go, and the console
// says so beside the message. Who writes:
//   · the customer — /dashboard/support (actions/support postSupportReply) or,
//     once stage 2 is on, a reply to any letter (/api/support/inbound);
//   · the team — /admin/support (actions/admin replyToSupportTicket) or a reply
//     to the letter about the customer's message;
//   · the support AI — lib/support/aiSupport, signed "JobFlex support".
// What each message does to the ticket: a customer's opens a resolved or
// closed one again, makes it unread for the admins and lifts it to the top of
// the queue; a person's answer moves Open to In progress and counts as read;
// the AI's moves Open to In progress and leaves it unread (the admins should
// see what it said). The words and the letter are the pure lib/supportReply.
import { db } from "@/lib/db";
import { appBaseUrl } from "@/lib/appUrl";
import { isEmailEnabled, sendEmail } from "@/lib/sdk/resend";
import { supportRecipients, supportTicketRef } from "@/lib/notify";
import { plusReplyAddress, replyAddress } from "@/lib/supportInbound";
import { supportMailConfig } from "@/lib/supportMail/config";
import {
  conversationLetter,
  messageFrom,
  openingMessage,
  statusAfterCustomerMessage,
  statusAfterReply,
  type AiKind,
  type LetterMessage,
  type MessageChannel,
  type MessageFrom,
  type ThreadMessage,
} from "@/lib/supportReply";

/** Where a reply to a letter goes until stage 2 is switched on — the team's mailbox, as before. */
export const SUPPORT_INBOX = "support@jobflex.app";

// ── Stage 2: the ticket's own Reply-To ───────────────────────────────────────

/**
 * Replies by email are ON when SUPPORT_REPLY_DOMAIN names the domain whose MX
 * points at the inbound service (reply.jobflex.app). The address is signed
 * with SUPPORT_REPLY_SECRET, else the app's AUTH_SECRET (one secret fewer to
 * keep; the HMAC is labelled, so it can't be replayed as anything else).
 * Without the webhook's secret nothing could be received, so the letters keep
 * support@jobflex.app — a half-configured server never sends replies nowhere.
 */
export function inboundConfig(): { domain: string; secret: string } | null {
  if (!process.env.RESEND_INBOUND_WEBHOOK_SECRET?.trim()) return null;
  const domain = process.env.SUPPORT_REPLY_DOMAIN?.trim().toLowerCase();
  const secret = process.env.SUPPORT_REPLY_SECRET?.trim() || process.env.AUTH_SECRET?.trim() || process.env.NEXTAUTH_SECRET?.trim();
  return domain && secret ? { domain, secret } : null;
}

/**
 * The ticket's own reply address, or null while replies by email are off.
 * Gmail first (owner, 2026-10-18): the platform mailbox's plus-address, read by
 * /api/cron/support-mail — production only (lib/supportMail/config). The
 * Resend inbound address above stays wired but is off without its variables.
 */
export function ticketReplyTo(ticketId: string): string | null {
  const mail = supportMailConfig();
  if (mail.ok) return plusReplyAddress(ticketId, { mailbox: mail.config.user, secret: mail.config.secret });
  const cfg = inboundConfig();
  return cfg ? replyAddress(ticketId, cfg) : null;
}

// ── Reading ──────────────────────────────────────────────────────────────────

type Row = {
  id: string;
  from: string;
  authorName: string | null;
  body: string;
  channel: string;
  kind: string | null;
  sentTo: string | null;
  createdAt: Date;
};

const SELECT = { id: true, ticketId: true, from: true, authorName: true, body: true, channel: true, kind: true, sentTo: true, createdAt: true } as const;

function view(r: Row): ThreadMessage {
  const from = messageFrom(r.from);
  const kind = r.kind === "answer" || r.kind === "ack" || r.kind === "fixed" ? (r.kind as AiKind) : undefined;
  return {
    id: r.id,
    at: r.createdAt.toISOString(),
    from,
    by: r.authorName?.trim() || (from === "customer" ? "Customer" : "JobFlex support"),
    to: r.sentTo,
    body: r.body,
    channel: r.channel === "email" ? "email" : "app",
    ...(kind ? { kind } : {}),
  };
}

/** The messages after the ticket's own words, oldest first. */
export async function threadOf(ticketId: string): Promise<ThreadMessage[]> {
  const rows = await db.supportMessage.findMany({ where: { ticketId }, orderBy: { createdAt: "asc" }, select: SELECT });
  return rows.map(view);
}

/** The conversations of many tickets in one read, keyed by ticket id (a ticket with none is absent). */
export async function threadsFor(ticketIds: string[]): Promise<Record<string, ThreadMessage[]>> {
  if (!ticketIds.length) return {};
  const rows = await db.supportMessage.findMany({ where: { ticketId: { in: ticketIds } }, orderBy: { createdAt: "asc" }, select: SELECT });
  const out: Record<string, ThreadMessage[]> = {};
  for (const r of rows) (out[r.ticketId] ??= []).push(view(r));
  return out;
}

/** How the customer is named in the conversation: their name, else their address, else the company. */
export function customerLabel(t: { user?: { name?: string | null; email?: string | null } | null; organization?: { name?: string | null } | null }): string {
  return t.user?.name?.trim() || t.user?.email || t.organization?.name || "Customer";
}

// ── Who it goes to ───────────────────────────────────────────────────────────

/** Where a ticket's answers go: whoever filed it; else the account's owner; else its billing address. */
export async function recipientForTicket(ticket: { organizationId: string; user?: { email: string | null } | null; organization?: { billingEmail: string | null } | null }): Promise<string | null> {
  if (ticket.user?.email) return ticket.user.email;
  const owner = await db.membership.findFirst({ where: { organizationId: ticket.organizationId, role: "OWNER" }, orderBy: { createdAt: "asc" }, select: { user: { select: { email: true } } } }).catch(() => null);
  return owner?.user.email ?? ticket.organization?.billingEmail ?? null;
}

/** The same, for a page listing many tickets: one read for the owners. */
export async function recipientsForTickets(tickets: Array<{ id: string; organizationId: string; user?: { email: string | null } | null; organization?: { billingEmail: string | null } | null }>): Promise<Record<string, string | null>> {
  const orgIds = [...new Set(tickets.filter((t) => !t.user?.email).map((t) => t.organizationId))];
  const owners = new Map<string, string>();
  if (orgIds.length) {
    const rows = await db.membership.findMany({ where: { organizationId: { in: orgIds }, role: "OWNER" }, orderBy: { createdAt: "asc" }, select: { organizationId: true, user: { select: { email: true } } } }).catch(() => []);
    for (const r of rows) if (r.user.email && !owners.has(r.organizationId)) owners.set(r.organizationId, r.user.email);
  }
  const out: Record<string, string | null> = {};
  for (const t of tickets) out[t.id] = t.user?.email ?? owners.get(t.organizationId) ?? t.organization?.billingEmail ?? null;
  return out;
}

function loadTicket(ticketId: string) {
  return db.supportTicket.findUnique({
    where: { id: ticketId },
    include: {
      user: { select: { id: true, email: true, name: true } },
      organization: { select: { name: true, billingEmail: true } },
    },
  });
}
type TicketRow = NonNullable<Awaited<ReturnType<typeof loadTicket>>>;

/**
 * Who an inbound letter's sender is on this ticket: its customer (whoever
 * filed it — or, for a ticket nobody filed, the address its answers go to), or
 * the support inbox (lib/notify supportRecipients — the admins' settings), as
 * the team. Anyone else: null, and the letter is dropped.
 */
export async function senderOnTicket(
  ticketId: string,
  address: string,
): Promise<{ from: "customer" | "team"; authorUserId: string | null; authorName: string } | null> {
  const t = await loadTicket(ticketId);
  if (!t) return null;
  const sender = address.trim().toLowerCase();
  const customer = (t.user?.email ?? (await recipientForTicket(t)) ?? "").toLowerCase();
  if (customer && sender === customer) return { from: "customer", authorUserId: t.user?.id ?? null, authorName: customerLabel(t) };
  const team = (await supportRecipients().catch(() => [] as string[])).map((e) => e.toLowerCase());
  if (team.includes(sender)) {
    const admin = await db.user.findFirst({ where: { email: sender, isPlatformAdmin: true }, select: { id: true, name: true } }).catch(() => null);
    return { from: "team", authorUserId: admin?.id ?? null, authorName: admin?.name?.trim() || "JobFlex support" };
  }
  return null;
}

// ── Writing ──────────────────────────────────────────────────────────────────

export interface PostMessageInput {
  ticketId: string;
  from: MessageFrom;
  body: string;
  channel: MessageChannel;
  authorUserId?: string | null;
  authorName?: string | null;
  kind?: AiKind;
  /** An inbound letter's Message-ID — the same letter delivered twice is kept once. */
  emailMessageId?: string | null;
  /** False: keep it without emailing the other side (the caller tells them its own way). */
  notify?: boolean;
}

export interface PostMessageResult {
  message: ThreadMessage;
  /** The ticket's status after the message. */
  status: string;
  /** The other side was emailed. */
  emailed: boolean;
  /** Why not, in words for the console. */
  emailNote?: string;
}

/** Keep a message, move the ticket, tell the other side. Null: the ticket is gone. */
export async function postSupportMessage(input: PostMessageInput): Promise<PostMessageResult | null> {
  const t = await loadTicket(input.ticketId);
  if (!t) return null;
  const before = await threadOf(t.id);
  const row = await db.supportMessage.create({
    data: {
      ticketId: t.id,
      from: input.from,
      authorUserId: input.authorUserId ?? null,
      authorName: input.authorName ?? (input.from === "customer" ? customerLabel(t) : "JobFlex support"),
      body: input.body,
      channel: input.channel,
      kind: input.kind ?? null,
      emailMessageId: input.emailMessageId ?? null,
    },
    select: SELECT,
  });
  const status = input.from === "customer" ? statusAfterCustomerMessage(t.status) : statusAfterReply(t.status);
  await db.supportTicket.update({
    where: { id: t.id },
    data: {
      status,
      lastMessageAt: row.createdAt,
      // The customer wrote: unread for the admins again. A person answered: read. The AI: as it was.
      ...(input.from === "customer" ? { adminReadAt: null } : input.from === "team" ? { adminReadAt: t.adminReadAt ?? new Date() } : {}),
    },
  });
  let message = view(row);
  if (input.notify === false) return { message, status, emailed: false };

  const told = await tellOtherSide(t, message, before);
  if (told.sentTo || told.providerId) {
    const updated = await db.supportMessage
      .update({ where: { id: row.id }, data: { sentTo: told.sentTo, ...(told.providerId && !input.emailMessageId ? { emailMessageId: told.providerId } : {}) }, select: SELECT })
      .catch(() => null);
    if (updated) message = view(updated);
  }
  return { message, status, emailed: told.emailed, ...(told.note ? { emailNote: told.note } : {}) };
}

async function tellOtherSide(
  t: TicketRow,
  message: ThreadMessage,
  before: ThreadMessage[],
): Promise<{ emailed: boolean; note?: string; sentTo: string | null; providerId: string | null }> {
  if (!isEmailEnabled()) return { emailed: false, note: "Email isn't set up on this server, so nobody was emailed.", sentTo: null, providerId: null };
  const base = (await appBaseUrl()).replace(/\/$/, "");
  const ref = supportTicketRef(t.id);
  const opening = openingMessage({ id: t.id, body: t.body, createdAt: t.createdAt.toISOString(), by: customerLabel(t) });
  const history: LetterMessage[] = [opening, ...before];
  const own = ticketReplyTo(t.id);

  if (message.from === "customer") {
    const to = await supportRecipients().catch(() => [] as string[]);
    if (!to.length) return { emailed: false, note: "Nobody is set to receive support mail.", sentTo: null, providerId: null };
    const letter = conversationLetter({
      to: "team",
      message,
      ticket: { subject: t.subject, ref, orgName: t.organization.name, customerEmail: t.user?.email ?? null },
      history,
      link: `${base}/admin/support?ticket=${t.id}`,
      replyByEmail: Boolean(own),
    });
    // One send per address, as notifySupportTicket does — one bad address never silences the rest.
    let sent = 0;
    for (const address of to) {
      try {
        await sendEmail({ mailClass: "transactional", to: address, subject: letter.subject, html: letter.html, text: letter.text, replyTo: own ?? t.user?.email ?? undefined, kind: "support" });
        sent += 1;
      } catch (err) {
        console.error(`[support] ${ref}: the customer's message to ${address} failed:`, err instanceof Error ? err.message : err);
      }
    }
    return sent ? { emailed: true, sentTo: null, providerId: null } : { emailed: false, note: "The email to the support inbox didn't go out.", sentTo: null, providerId: null };
  }

  const to = await recipientForTicket(t);
  if (!to) return { emailed: false, note: "This ticket has no address to email: nobody is on it, and the account has no owner or billing email.", sentTo: null, providerId: null };
  // Every role can open its own tickets at /dashboard/support (2026-10-17), so the button always goes.
  const letter = conversationLetter({
    to: "customer",
    message,
    ticket: { subject: t.subject, ref },
    history,
    link: `${base}/dashboard/support?ticket=${t.id}`,
    replyByEmail: Boolean(own),
  });
  try {
    const r = await sendEmail({ mailClass: "transactional", to, subject: letter.subject, html: letter.html, text: letter.text, replyTo: own ?? SUPPORT_INBOX, kind: "support" });
    const id = r && typeof r === "object" && "id" in r && typeof r.id === "string" && !("skipped" in r && r.skipped) ? r.id : null;
    return { emailed: true, sentTo: to, providerId: id };
  } catch (err) {
    console.error(`[support] ${ref}: the email to ${to} failed:`, err instanceof Error ? err.message : err);
    return { emailed: false, note: `The email to ${to} didn't go out — the message is in the conversation.`, sentTo: null, providerId: null };
  }
}
