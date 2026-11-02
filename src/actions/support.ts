"use server";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { requireOrg, requirePlatformAdmin } from "@/lib/orgContext";
import { db } from "@/lib/db";
import { notifySupportTicket, supportTicketRef } from "@/lib/notify";
import { rateLimitShared, retryInWords } from "@/lib/rateLimit";
import { answerTicketWithAi, markSmartHelpTicket, readSupportAi } from "@/lib/support/aiSupport";
import { setQuestionOutcome } from "@/lib/smarthelp/server";
import { alertSupportTicket } from "@/lib/adminAlerts";
import { acceptSupportMessage } from "@/lib/support/acceptMessage";
import { checkReply, openingMessage, type ThreadMessage } from "@/lib/supportReply";
import { customerLabel, threadOf, ticketReplyTo } from "@/lib/supportThread";
import type { SupportAiRecord } from "@/lib/support/aiState";

// Support taxonomy — kept in lockstep with the customer form's chips, the
// corner Help widget's categories and the admin triage tags. Not exported: a
// "use server" module may only export async functions, and these are used
// internally by the validators below.
const SUPPORT_CATEGORIES = ["billing", "technical", "account", "feature", "general"] as const;
const SUPPORT_PRIORITIES = ["low", "normal", "high"] as const;

const ticketInput = z.object({
  // Optional since the Help widget landed: that composer is one message field
  // and one button, deliberately — a subject line is a form asking the user to
  // summarise their own problem before they have described it. When it is
  // absent the subject is taken from the message's own first line (below), so
  // the column stays a real, human-written summary rather than a placeholder.
  subject: z.string().max(200).optional(),
  // Trimmed BEFORE the length check: a body of spaces satisfied `min(1)`, and
  // the derived subject below then came out empty — a blank row in the admin
  // queue that no filter or search could reach.
  body: z.string().trim().min(1, "Describe the issue").max(5000),
  category: z.enum(SUPPORT_CATEGORIES).default("general"),
  priority: z.enum(SUPPORT_PRIORITIES).default("normal"),
  // SmartHelp's "Ask a person" (2026-10-30): the composer it opened pre-filled marks the ticket as its hand-off, with
  // the SmartHelp question it carries — the support AI then only drafts for it, and a person sends.
  origin: z.literal("smarthelp").optional(),
  smartHelpLogId: z.string().max(80).optional(),
});

/** The message's first line, clipped to a subject-sized string. The user's own
 *  words — nothing is generated. Falls back to the whole message when it is a
 *  single unbroken paragraph. */
function subjectFromBody(body: string): string {
  const firstLine = body.split(/\r?\n/).find((l) => l.trim().length > 0)?.trim() ?? body.trim();
  if (firstLine.length <= 80) return firstLine;
  const cut = firstLine.slice(0, 80);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** A SmartHelp hand-off's question is marked "person" — only its asker's own counts (lib/smarthelp/server). Runs after
 *  the response, best-effort: a failure is a log line, never the ticket's. */
async function markQuestionForPerson(logId: string, userId: string, ref: string): Promise<void> {
  try {
    const r = await setQuestionOutcome(logId, userId, "person");
    if (r !== "ok") console.warn(`[support] ${ref}: its SmartHelp question was not marked "person" (${r}).`);
  } catch (err) {
    console.warn(`[support] ${ref}: its SmartHelp question was not marked "person":`, err instanceof Error ? err.message : err);
  }
}

export interface SubmitTicketResult {
  id: string;
  /** Short human reference, shown to the submitter and printed on the alert. */
  ref: string;
  /** Whether the operator alert actually went out. False is not a failure of
   *  the submission — the ticket is filed either way — but the caller is told
   *  the truth rather than a blanket success. */
  notified: boolean;
}

/**
 * Raise a support ticket.
 *
 * GUARD: `requireOrg`, not `requireManager` (changed with the Help widget). The
 * widget is mounted for every signed-in user on every surface, crew included,
 * and a field worker who cannot open the app is exactly the person who needs to
 * say so. Manager-only was never a security property here — a ticket is the
 * submitter's own words about their own org, scoped to their own membership;
 * it read no data and wrote nothing a limited role can reach. The ticket
 * HISTORY at /dashboard/support is open to every role too (2026-10-17), and
 * shows only the viewer's own tickets.
 *
 * RATE LIMIT: widening the guard to every org member also widened who can make
 * this write a row and send mail, and the composer is two taps from every
 * screen in the app. Five in ten minutes per user — far above anyone with a
 * real problem to report, far below a stuck retry loop. Counted BEFORE the
 * validator so a malformed body cannot be replayed for free.
 */
const TICKETS_PER_WINDOW = 5;
const TICKET_WINDOW_MS = 10 * 60 * 1000;

export async function submitSupportTicket(raw: unknown): Promise<SubmitTicketResult> {
  const { organizationId, user } = await requireOrg();

  const gate = await rateLimitShared(`support:${user.id}`, TICKETS_PER_WINDOW, TICKET_WINDOW_MS);
  if (!gate.ok) {
    throw new Error(
      `That is several tickets in a row. Try again in ${retryInWords(gate.retryAfterMs)}.`,
    );
  }

  const data = ticketInput.parse(raw);
  const subject = data.subject?.trim() || subjectFromBody(data.body);

  const fields = {
    organizationId,
    userId: user.id,
    subject,
    body: data.body,
    category: data.category,
    priority: data.priority,
    status: "OPEN",
  };
  // A SmartHelp hand-off is created and marked in one transaction (lib/support/aiSupport): none exists unmarked, so
  // the support AI never answers one on its own. Every other ticket is created as it always was.
  const handoff = data.origin === "smarthelp" ? { logId: data.smartHelpLogId || null } : null;
  const ticket = handoff
    ? await db.$transaction(async (tx) => {
        const created = await tx.supportTicket.create({ data: fields });
        await markSmartHelpTicket(tx, created.id, handoff.logId);
        return created;
      })
    : await db.supportTicket.create({ data: fields });

  // Heads-up to the operator. Best-effort by contract — notifySupportTicket
  // never throws, so a dead transport cannot fail a submission that is already
  // in the database — but it no longer fails SILENTLY either: it logs, and it
  // reports back so this return can say what actually happened.
  const [org, submitter] = await Promise.all([
    db.organization.findUnique({ where: { id: organizationId }, select: { name: true } }),
    db.user.findUnique({ where: { id: user.id }, select: { email: true } }),
  ]);
  const ref = supportTicketRef(ticket.id);
  const alert = await notifySupportTicket({
    ticketId: ticket.id,
    // Stage 2: a reply to the alert lands in the conversation as the team's message.
    replyTo: ticketReplyTo(ticket.id),
    ref,
    subject,
    body: data.body,
    category: data.category,
    priority: data.priority,
    orgName: org?.name ?? "A customer",
    submitterEmail: submitter?.email ?? null,
  });
  // The team's "Support" alert texts (lib/adminAlerts) — best-effort like the email.
  await alertSupportTicket({ orgName: org?.name ?? "A customer", subject, ref });

  // The support AI reads it and answers (owner, 2026-10-15) — after the
  // response, so "Send" never waits on a model. What it may send on its own,
  // and the copy every outcome sends to the support inbox: lib/support. A
  // SmartHelp hand-off's question is marked "person" first, here too.
  after(async () => {
    if (handoff?.logId) await markQuestionForPerson(handoff.logId, user.id, ref);
    await answerTicketWithAi(ticket.id, { trigger: "new" }).then(
      () => undefined,
      (err) => console.error(`[support-ai] ticket ${ref} was not answered:`, err instanceof Error ? err.message : err),
    );
  });

  revalidatePath("/dashboard/support");
  revalidatePath("/admin/support");
  revalidatePath("/admin");
  return { id: ticket.id, ref, notified: alert.sent };
}

// ── Admin notification feed (platform-admin only) ─────────────────────────────
//
// `recentSupportTickets` used to live here — a cross-org feed of every ticket's
// subject, org and submitter. Its one consumer (the admin header bell's inline
// list) was replaced by the /admin/support queue, and every export of a
// "use server" module is a live POST endpoint whether or not any component
// imports it. An unused one is an endpoint nobody is reading the guard on, so
// it is gone rather than kept warm. The queue's own page loader is the feed.

/** Count of tickets the admin hasn't seen yet — drives the nav + bell badges. */
export async function unreadSupportCount(): Promise<number> {
  await requirePlatformAdmin();
  return db.supportTicket.count({ where: { adminReadAt: null } });
}

/** Mark every unread ticket as seen. Called when the admin opens the inbox or
 *  clears the bell. Idempotent — a no-op once nothing is unread. */
export async function markSupportTicketsRead(): Promise<void> {
  await requirePlatformAdmin();
  await db.supportTicket.updateMany({
    where: { adminReadAt: null },
    data: { adminReadAt: new Date() },
  });
  revalidatePath("/admin/support");
  revalidatePath("/admin");
}

// ── The conversation (owner, 2026-10-17: one dialog per ticket) ──────────────
//
// The customer's side: /dashboard/support opens a ticket as a chat — every
// message in order (theirs, ours, the AI's), the box at the bottom — and asks
// for news every few seconds while it is open. Only the person who filed a
// ticket reads or writes it (the page's own rule: "Only you and our team can
// see this"). The rows and the letters are lib/supportThread.

const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 64;

/** Twenty in ten minutes per person — a conversation, not a flood. */
const MESSAGES_PER_WINDOW = 20;

export interface ConversationView {
  ticketId: string;
  status: string;
  /** ISO — the poll's "anything new?" stamp. */
  lastMessageAt: string;
  /** The ticket's own words first, then every message, oldest first. */
  messages: ThreadMessage[];
}

async function ownTicket(ticketId: string) {
  const { organizationId, user } = await requireOrg();
  const t = await db.supportTicket.findUnique({
    where: { id: ticketId },
    include: { user: { select: { name: true, email: true } }, organization: { select: { name: true } } },
  });
  return t && t.organizationId === organizationId && t.userId === user.id ? { t, userId: user.id } : null;
}

async function conversationOf(t: { id: string; body: string; status: string; createdAt: Date; lastMessageAt: Date; user: { name: string | null; email: string | null } | null; organization: { name: string } }): Promise<ConversationView> {
  const opening = openingMessage({ id: t.id, body: t.body, createdAt: t.createdAt.toISOString(), by: customerLabel(t) });
  return { ticketId: t.id, status: t.status, lastMessageAt: t.lastMessageAt.toISOString(), messages: [opening, ...(await threadOf(t.id))] };
}

/**
 * The open ticket's conversation, for the chat's poll. `since` is the
 * lastMessageAt the page already has: unchanged (and the status too) →
 * `{ changed: false }`, one indexed read and nothing more. Null: not theirs.
 */
export async function supportConversation(ticketId: unknown, since?: unknown, status?: unknown): Promise<ConversationView | { changed: false } | null> {
  if (!isId(ticketId)) return null;
  const own = await ownTicket(ticketId);
  if (!own) return null;
  if (typeof since === "string" && since === own.t.lastMessageAt.toISOString() && status === own.t.status) return { changed: false };
  return conversationOf(own.t);
}

export type PostReplyResult = { ok: true; conversation: ConversationView } | { ok: false; error: string };

/**
 * The customer writes in their ticket. Kept, then the support inbox is emailed
 * (lib/supportThread); a resolved or closed ticket opens again; the ticket is
 * unread for the admins and on top of their queue; the team's alert texts
 * hear of it; and the support AI may answer — after the response, and only
 * while no person on the team leads the ticket (lib/support aiMayAnswer).
 */
export async function postSupportReply(ticketId: unknown, raw: unknown): Promise<PostReplyResult> {
  if (!isId(ticketId)) return { ok: false, error: "That ticket is gone." };
  const own = await ownTicket(ticketId);
  if (!own) return { ok: false, error: "That ticket isn't one of yours." };
  const gate = await rateLimitShared(`support-msg:${own.userId}`, MESSAGES_PER_WINDOW, TICKET_WINDOW_MS);
  if (!gate.ok) return { ok: false, error: `That is a lot of messages in a row. Try again in ${retryInWords(gate.retryAfterMs)}.` };
  const check = checkReply(raw);
  if (!check.ok) return check;

  // The one path every door takes (lib/support/acceptMessage): kept, the inbox
  // emailed, unread for the admins, the team's alert text, the AI's follow-up.
  const r = await acceptSupportMessage({ ticketId: own.t.id, from: "customer", body: check.body, channel: "app", authorUserId: own.userId, authorName: customerLabel(own.t) });
  if (!r) return { ok: false, error: "That ticket is gone." };
  const fresh = await db.supportTicket.findUnique({
    where: { id: own.t.id },
    include: { user: { select: { name: true, email: true } }, organization: { select: { name: true } } },
  });
  return { ok: true, conversation: await conversationOf(fresh ?? own.t) };
}

// ── The admins' side of the conversation (platform admins only) ─────────────

export interface AdminConversationView extends ConversationView {
  /** Still unread (no adminReadAt). */
  unread: boolean;
  /** The support AI's record — it may have written meanwhile. */
  ai: SupportAiRecord | null;
}

/** The open ticket in /admin/support, for the sheet's poll — same `since` rule as the customer's. */
export async function adminSupportConversation(ticketId: unknown, since?: unknown, status?: unknown): Promise<AdminConversationView | { changed: false } | null> {
  await requirePlatformAdmin();
  if (!isId(ticketId)) return null;
  const t = await db.supportTicket.findUnique({
    where: { id: ticketId },
    include: { user: { select: { name: true, email: true } }, organization: { select: { name: true } } },
  });
  if (!t) return null;
  if (typeof since === "string" && since === t.lastMessageAt.toISOString() && status === t.status) return { changed: false };
  const [view, ai] = await Promise.all([conversationOf(t), readSupportAi(t.id)]);
  return { ...view, unread: t.adminReadAt === null, ai };
}

/** Opening a ticket in the console reads it. */
export async function markSupportTicketRead(ticketId: unknown): Promise<void> {
  await requirePlatformAdmin();
  if (!isId(ticketId)) return;
  await db.supportTicket.updateMany({ where: { id: ticketId, adminReadAt: null }, data: { adminReadAt: new Date() } });
  revalidatePath("/admin");
}

/** The queue's "anything new?" stamp: its latest message and how many are unread. */
export async function supportQueueStamp(): Promise<{ latest: string | null; unread: number }> {
  await requirePlatformAdmin();
  const [top, unread] = await Promise.all([
    db.supportTicket.findFirst({ orderBy: { lastMessageAt: "desc" }, select: { lastMessageAt: true } }),
    db.supportTicket.count({ where: { adminReadAt: null } }),
  ]);
  return { latest: top?.lastMessageAt.toISOString() ?? null, unread };
}
