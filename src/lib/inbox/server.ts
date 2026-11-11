import "server-only";
// THE INBOX — THE DATABASE HALF (Smart CRM part 2, 2026-11-08). One thread per client; the thread view merges what
// each channel's own table holds (texts in SmsMessage, desk calls in AiPhoneCall, outbound letters in EmailLog) with
// ClientMessage, which keeps what has no other home: inbound emails with their words and original kept, and replies
// sent from the inbox (EmailLog has no body). Inbound email rides the SAME receiving domain and webhook as the
// subcontractors' quotes-by-email (lib/subInbound; /api/inbound/email dispatches by the address's prefix).

import { db } from "@/lib/db";
import { getResendInbound, isResendInboundEnabled, sendEmail } from "@/lib/sdk/resend";
import { inboundConfig } from "@/lib/subInbound/config";
import type { ReceivedEmail } from "@/lib/subInbound/server";
import { excerptOf } from "@/lib/subInbound/shared";
import { emailAddressOf, isAutoReply } from "@/lib/supportInbound";
import { putPrivate, safePathname } from "@/lib/media/privateStore";
import { sendOrgEmail, type OrgEmailResult } from "@/lib/email/orgSend";
import { sendText, type SendTextResult } from "@/lib/sms/send";
import { digits10, samePhone } from "@/lib/clientTimeline/shared";
import { preview, statusAfter, threadAddress, threadTokenFromAddresses, type InboxFilter } from "./shared";
import { readInboundMessage } from "./reader";

export interface ThreadWho {
  clientId?: string | null;
  leadId?: string | null;
  name: string;
  email?: string | null;
  phone?: string | null;
}

/** The client's one thread (made on first need), or an unlinked thread for a sender no client matches yet. */
export async function ensureThread(organizationId: string, who: ThreadWho) {
  if (who.clientId) {
    const have = await db.clientThread.findUnique({ where: { organizationId_clientId: { organizationId, clientId: who.clientId } } });
    if (have) {
      // The record's contact may have filled in since.
      if ((who.email && !have.email) || (who.phone && !have.phone)) {
        return db.clientThread.update({ where: { id: have.id }, data: { email: have.email ?? who.email ?? null, phone: have.phone ?? who.phone ?? null } });
      }
      return have;
    }
    return db.clientThread.create({ data: { organizationId, clientId: who.clientId, leadId: who.leadId ?? null, name: who.name, email: who.email ?? null, phone: who.phone ?? null } });
  }
  // No client: one thread per address, found by email or phone digits.
  const email = who.email?.trim().toLowerCase() || null;
  const phone7 = digits10(who.phone).slice(-7);
  const rows = await db.clientThread.findMany({
    where: { organizationId, clientId: null, OR: [...(email ? [{ email }] : []), ...(phone7.length >= 7 ? [{ phone: { not: null } }] : [])] },
    orderBy: { lastAt: "desc" },
    take: 50,
  });
  const hit = rows.find((t) => (email && t.email?.toLowerCase() === email) || (who.phone && samePhone(t.phone, who.phone)));
  if (hit) return hit;
  return db.clientThread.create({ data: { organizationId, leadId: who.leadId ?? null, name: who.name, email, phone: who.phone ?? null } });
}

/** A message landed: the thread's spine moves. */
async function bump(threadId: string, m: { direction: "IN" | "OUT"; channel: string; preview: string; urgent?: boolean }) {
  const t = await db.clientThread.findUnique({ where: { id: threadId }, select: { status: true, unread: true, urgent: true } });
  if (!t) return;
  await db.clientThread.update({
    where: { id: threadId },
    data: {
      status: statusAfter(t.status, m.direction),
      unread: m.direction === "IN" ? t.unread + 1 : 0,
      urgent: m.urgent ? true : m.direction === "OUT" ? t.urgent : t.urgent,
      lastAt: new Date(),
      lastPreview: preview(m.preview),
      lastDirection: m.direction,
      lastChannel: m.channel,
    },
  });
}

// ── inbound email (from /api/inbound/email) ──────────────────────────────────

const MAX_ATTACH = 5;
const MAX_ATTACH_BYTES = 15 * 1024 * 1024;
const KEEP_TYPES = /^(application\/pdf|image\/)/;

export type InboxIngest = { outcome: "filed" | "duplicate" | "ignored"; threadId: string | null; words: string };

/** Could this letter be a client's? The thread token says so outright; with no token at all, a single live client
 *  with the sender's address does. Never claims an rfq- letter. */
export async function claimsClientEmail(d: ReceivedEmail): Promise<{ thread?: { id: string }; client?: { id: string; organizationId: string; name: string; email: string | null; phone: string | null } } | null> {
  const cfg = inboundConfig();
  const addresses = [...(d.to ?? []), ...(d.cc ?? []), ...(d.bcc ?? []), ...(d.received_for ?? [])];
  const token = threadTokenFromAddresses(addresses, cfg.domain);
  if (token) {
    const thread = await db.clientThread.findUnique({ where: { replyToken: token }, select: { id: true } });
    if (thread) return { thread };
  }
  const from = emailAddressOf(d.from);
  if (!from) return null;
  const clients = await db.client.findMany({
    where: { deletedAt: null, email: { in: [from, from.toLowerCase()] } },
    select: { id: true, organizationId: true, name: true, email: true, phone: true },
    take: 2,
  });
  // Exactly one live client anywhere wears this address — more than one is ambiguous, and the subs' review queue
  // holds the letter for a person instead.
  return clients.length === 1 ? { client: clients[0] } : null;
}

/** File a client's letter: the words read back from Resend, the original kept, attachments (PDFs and pictures)
 *  stored, a copy forwarded to the company's own mailbox, and the AI read run on it. */
export async function fileInboundEmail(d: ReceivedEmail, hint: Awaited<ReturnType<typeof claimsClientEmail>>): Promise<InboxIngest> {
  const providerId = d.email_id?.trim();
  if (!providerId) throw new Error("The letter has no id.");
  const seen = await db.clientMessage.findUnique({ where: { externalId: providerId }, select: { id: true, threadId: true } });
  if (seen) return { outcome: "duplicate", threadId: seen.threadId, words: "Delivered before." };

  // The words: carried in a test's payload, else read back from Resend.
  let text = d.text ?? null;
  let html = d.html ?? null;
  let headers = d.headers ?? null;
  let subject = d.subject ?? null;
  let rawUrl: string | null | undefined = d.raw_url ?? null;
  let attachments = (d.attachments ?? []).map((a) => ({ id: a.id, filename: a.filename ?? null, contentType: a.content_type ?? null, size: a.size ?? null, downloadUrl: a.download_url ?? null }));
  if (text == null && html == null && isResendInboundEnabled()) {
    const resend = getResendInbound();
    const got = await resend.emails.receiving.get(providerId);
    if (got.error || !got.data) throw new Error(`Reading the letter back failed: ${got.error?.message ?? "no data"}`);
    text = got.data.text;
    html = got.data.html;
    headers = got.data.headers;
    subject = got.data.subject || subject;
    rawUrl = got.data.raw?.download_url ?? null;
    const list = await resend.emails.receiving.attachments.list({ emailId: providerId });
    const links = new Map((list.data?.data ?? []).map((x) => [x.id, x.download_url]));
    attachments = got.data.attachments.map((a) => ({ id: a.id, filename: a.filename, contentType: a.content_type, size: a.size, downloadUrl: links.get(a.id) ?? null }));
  }
  const words = excerptOf(text, html, 6000);
  const fromAddr = emailAddressOf(d.from) ?? d.from;
  const auto = isAutoReply(subject ?? "", headers);

  // Whose thread.
  let thread: { id: string; organizationId: string; clientId: string | null } | null = null;
  if (hint?.thread) thread = await db.clientThread.findUnique({ where: { id: hint.thread.id }, select: { id: true, organizationId: true, clientId: true } });
  if (!thread && hint?.client) {
    const t = await ensureThread(hint.client.organizationId, { clientId: hint.client.id, name: hint.client.name, email: hint.client.email, phone: hint.client.phone });
    thread = { id: t.id, organizationId: t.organizationId, clientId: t.clientId };
  }
  if (!thread) return { outcome: "ignored", threadId: null, words: "No thread claims it." };
  const organizationId = thread.organizationId;

  // The original and the attachments, kept.
  let keptRaw: string | null = null;
  if (rawUrl) {
    const got = await fetch(rawUrl).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null);
    if (got && got.byteLength <= 25 * 1024 * 1024) {
      keptRaw = (await putPrivate(safePathname(`inbox/${organizationId}/${Date.now()}-${providerId.replace(/[^A-Za-z0-9_-]/g, "")}.eml`), Buffer.from(got), "message/rfc822")).url;
    }
  }
  const kept: Array<{ name: string; url: string; contentType: string; bytes: number }> = [];
  for (const a of attachments.slice(0, MAX_ATTACH)) {
    if (!a.downloadUrl || !a.contentType || !KEEP_TYPES.test(a.contentType)) continue;
    const got = await fetch(a.downloadUrl).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null);
    if (!got || !got.byteLength || got.byteLength > MAX_ATTACH_BYTES) continue;
    const name = (a.filename ?? "file").replace(/[^A-Za-z0-9._ -]/g, "_").slice(0, 120) || "file";
    const put = await putPrivate(safePathname(`inbox/${organizationId}/${Date.now()}-${name}`), Buffer.from(got), a.contentType);
    kept.push({ name, url: put.url, contentType: a.contentType, bytes: got.byteLength });
  }

  const msg = await db.clientMessage.create({
    data: {
      organizationId,
      threadId: thread.id,
      direction: "IN",
      channel: "EMAIL",
      fromAddr: fromAddr.slice(0, 320),
      subject: subject?.slice(0, 500) ?? null,
      body: words || "(no words — see the original)",
      attachmentsJson: kept.length ? JSON.stringify(kept) : null,
      rawUrl: keptRaw,
      externalId: providerId,
      emailMessageId: d.message_id?.slice(0, 500) ?? null,
      status: "RECEIVED",
    },
    select: { id: true },
  });
  await bump(thread.id, { direction: "IN", channel: "EMAIL", preview: words || subject || "(empty letter)" });

  // The copy to the company's own mailbox (the plan: their inbox stays in the loop), never for auto-replies.
  if (!auto) {
    const org = await db.organization.findUnique({ where: { id: organizationId }, select: { billingEmail: true, gmailSettingsJson: true } });
    const own = (org && (JSON.parse(org.gmailSettingsJson ?? "{}") as { replyTo?: string }).replyTo?.trim()) || org?.billingEmail || null;
    if (own && own.toLowerCase() !== fromAddr.toLowerCase()) {
      await sendEmail({ mailClass: "transactional",
        to: own,
        subject: `Fwd: ${subject ?? "(no subject)"}`,
        html: `<p><b>${fromAddr}</b> wrote to you through JobFlex:</p><blockquote style="border-left:3px solid #ccc;margin:8px 0;padding:4px 12px;white-space:pre-wrap">${(words || "(no words)").replace(/</g, "&lt;").slice(0, 8000)}</blockquote><p>Answer it in JobFlex → CRM → Inbox so the thread stays whole.</p>`,
        text: `${fromAddr} wrote:\n\n${words}\n\nAnswer it in JobFlex → CRM → Inbox so the thread stays whole.`,
        kind: "inbox-forward",
        organizationId,
      }).catch((err) => console.warn("[inbox] forward not sent:", err instanceof Error ? err.message : err));
    }
  }

  // The AI read: facts, promises, what it means. An auto-reply is filed and never read.
  if (!auto && words) {
    await readInboundMessage({ threadId: thread.id, organizationId, clientId: thread.clientId, channel: "EMAIL", subject, body: words, sourceId: msg.id }).catch((err) => console.warn("[inbox] read failed:", err instanceof Error ? err.message : err));
  }
  return { outcome: "filed", threadId: thread.id, words: preview(words || subject || "", 80) };
}

// ── inbound text (from /api/twilio/sms) ──────────────────────────────────────

/** A client's (or an unknown number's) text just landed in SmsMessage: move the thread and read it. */
export async function fileInboundText(organizationId: string, who: { clientId: string | null; name: string; phone: string }, body: string, smsId: string | null): Promise<void> {
  const t = await ensureThread(organizationId, { clientId: who.clientId, name: who.name, phone: who.phone });
  await bump(t.id, { direction: "IN", channel: "SMS", preview: body });
  await readInboundMessage({ threadId: t.id, organizationId, clientId: t.clientId, channel: "SMS", subject: null, body, sourceId: smsId ?? undefined }).catch((err) => console.warn("[inbox] text read failed:", err instanceof Error ? err.message : err));
}

/** A message the client wrote on their own page (/c/<token>, Smart CRM part 5): on their thread as PORTAL, read like
 *  any other inbound message. Returns the message's id. */
export async function fileInboundPortal(organizationId: string, client: { id: string; name: string; email: string | null; phone: string | null }, body: string): Promise<string> {
  const t = await ensureThread(organizationId, { clientId: client.id, name: client.name, email: client.email, phone: client.phone });
  const m = await db.clientMessage.create({ data: { organizationId, threadId: t.id, direction: "IN", channel: "PORTAL", body, status: "RECEIVED" } });
  await bump(t.id, { direction: "IN", channel: "PORTAL", preview: body });
  await readInboundMessage({ threadId: t.id, organizationId, clientId: t.clientId, channel: "PORTAL", subject: null, body, sourceId: m.id }).catch((err) => console.warn("[inbox] portal read failed:", err instanceof Error ? err.message : err));
  return m.id;
}

// ── replies ──────────────────────────────────────────────────────────────────

/** A message sent to a client from outside the inbox (the client page's Message dialog): its words go on the
 *  client's thread, since the mail log keeps only the subject. Texts need none of this — SmsMessage holds them. */
export async function recordOutbound(
  organizationId: string,
  client: { id: string; name: string; email: string | null; phone: string | null },
  m: { channel: "EMAIL" | "NOTE"; subject?: string | null; body: string; toAddr?: string | null; userId?: string | null },
): Promise<void> {
  const t = await ensureThread(organizationId, { clientId: client.id, name: client.name, email: client.email, phone: client.phone });
  await db.clientMessage.create({
    data: { organizationId, threadId: t.id, direction: "OUT", channel: m.channel, toAddr: m.toAddr?.slice(0, 320) ?? null, subject: m.subject?.slice(0, 500) ?? null, body: m.body, sentById: m.userId ?? null, status: "SENT" },
  });
  await bump(t.id, { direction: "OUT", channel: m.channel, preview: m.body });
}

/** A person wrote to a client: lib/promises reads it for a commitment, after the response. Never in the way of
 *  the send — a failure here is logged and forgotten. */
async function notePromises(input: { organizationId: string; clientId: string | null; userId: string | null; body: string; channel: "EMAIL" | "SMS"; sourceId?: string | null }): Promise<void> {
  if (!input.clientId) return;
  try {
    const { catchPromisesLater } = await import("@/lib/promises/server");
    catchPromisesLater(input);
  } catch (err) {
    console.warn("[inbox] promise read skipped:", err instanceof Error ? err.message : err);
  }
}

/** The inbox's email reply: sent with the thread's own Reply-To and the mail threading headers, body kept here. */
export async function replyByEmail(threadId: string, organizationId: string, userId: string, input: { body: string; subject?: string | null }): Promise<{ ok: boolean; error?: string; via?: OrgEmailResult["via"] }> {
  const thread = await db.clientThread.findUnique({ where: { id: threadId }, include: { client: { select: { email: true, name: true } } } });
  if (!thread || thread.organizationId !== organizationId) return { ok: false, error: "No such thread." };
  const to = thread.client?.email?.trim() || thread.email?.trim();
  if (!to) return { ok: false, error: "This thread has no email address." };
  const cfg = inboundConfig();
  const last = await db.clientMessage.findFirst({ where: { threadId, direction: "IN", channel: "EMAIL", emailMessageId: { not: null } }, orderBy: { createdAt: "desc" }, select: { emailMessageId: true, subject: true } });
  const subject = input.subject?.trim() || (last?.subject ? (last.subject.startsWith("Re:") ? last.subject : `Re: ${last.subject}`) : `Message from your contractor`);
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { id: true, name: true, billingEmail: true, gmailSettingsJson: true, gmailTokensJson: true } });
  if (!org) return { ok: false, error: "No company." };
  const body = input.body.trim();
  const html = `<div style="font:14px/1.6 -apple-system,Segoe UI,sans-serif;white-space:pre-wrap">${body.replace(/</g, "&lt;")}</div>`;
  const res = await sendOrgEmail(
    org,
    {
      to,
      subject,
      html,
      kind: "inbox",
      // A person's own reply from the Inbox (2026-11-11): it goes whatever any list says.
      mailClass: "transactional",
      replyTo: cfg.enabled && cfg.domain ? threadAddress(thread.replyToken, cfg.domain) : undefined,
      headers: last?.emailMessageId ? { "In-Reply-To": last.emailMessageId, References: last.emailMessageId } : undefined,
    },
  );
  const sent = await db.clientMessage.create({
    data: { organizationId, threadId, direction: "OUT", channel: "EMAIL", toAddr: to.slice(0, 320), subject: subject.slice(0, 500), body, sentById: userId, status: "SENT" },
    select: { id: true },
  });
  await bump(threadId, { direction: "OUT", channel: "EMAIL", preview: body });
  // THE PROMISE TRACKER (part 4): what the person just committed to is written down, after the response.
  await notePromises({ organizationId, clientId: thread.clientId, userId, body, channel: "EMAIL", sourceId: sent.id });
  return { ok: true, via: res.via };
}

/** The inbox's text reply: through the company's number (sendText logs the SmsMessage row the view merges). */
export async function replyByText(threadId: string, organizationId: string, input: { body: string; userId?: string | null }): Promise<SendTextResult> {
  const thread = await db.clientThread.findUnique({ where: { id: threadId }, include: { client: { select: { phone: true } } } });
  if (!thread || thread.organizationId !== organizationId) return { ok: false, reason: "failed" };
  const to = thread.client?.phone?.trim() || thread.phone?.trim();
  if (!to) return { ok: false, reason: "invalid-number" };
  const r = await sendText({ organizationId, to, body: input.body.trim(), kind: "reply" });
  if (r.ok && r.status !== "SKIPPED") {
    await bump(threadId, { direction: "OUT", channel: "SMS", preview: input.body });
    await notePromises({ organizationId, clientId: thread.clientId, userId: input.userId ?? null, body: input.body, channel: "SMS" });
  }
  return r;
}

// ── the list and the view ────────────────────────────────────────────────────

export interface ThreadListRow {
  id: string;
  clientId: string | null;
  name: string;
  status: string;
  urgent: boolean;
  unread: number;
  lastAt: Date;
  lastPreview: string | null;
  lastDirection: string | null;
  lastChannel: string | null;
  assignedToId: string | null;
}

export async function readThreads(organizationId: string, filter: InboxFilter, userId: string): Promise<ThreadListRow[]> {
  const where = {
    organizationId,
    ...(filter === "unread" ? { unread: { gt: 0 } } : {}),
    ...(filter === "needs" ? { status: "NEEDS_REPLY" } : {}),
    ...(filter === "urgent" ? { urgent: true, status: { not: "CLOSED" } } : {}),
    ...(filter === "mine" ? { assignedToId: userId, status: { not: "CLOSED" } } : {}),
    ...(filter === "waiting" ? { status: "WAITING" } : {}),
    ...(filter === "closed" ? { status: "CLOSED" } : {}),
    ...(filter === "all" ? { status: { not: "CLOSED" } } : {}),
  };
  return db.clientThread.findMany({
    where,
    orderBy: [{ lastAt: "desc" }],
    take: 80,
    select: { id: true, clientId: true, name: true, status: true, urgent: true, unread: true, lastAt: true, lastPreview: true, lastDirection: true, lastChannel: true, assignedToId: true },
  });
}

export async function inboxCounts(organizationId: string, userId: string): Promise<Record<InboxFilter, number>> {
  const [all, unread, needs, urgent, mine, waiting, closed] = await Promise.all([
    db.clientThread.count({ where: { organizationId, status: { not: "CLOSED" } } }),
    db.clientThread.count({ where: { organizationId, unread: { gt: 0 } } }),
    db.clientThread.count({ where: { organizationId, status: "NEEDS_REPLY" } }),
    db.clientThread.count({ where: { organizationId, urgent: true, status: { not: "CLOSED" } } }),
    db.clientThread.count({ where: { organizationId, assignedToId: userId, status: { not: "CLOSED" } } }),
    db.clientThread.count({ where: { organizationId, status: "WAITING" } }),
    db.clientThread.count({ where: { organizationId, status: "CLOSED" } }),
  ]);
  return { all, unread, needs, urgent, mine, waiting, closed };
}

export interface ThreadMessage {
  id: string;
  at: Date;
  direction: "IN" | "OUT";
  channel: "EMAIL" | "SMS" | "CALL" | "PORTAL" | "NOTE";
  subject: string | null;
  body: string;
  detail: string | null;
  attachments: Array<{ name: string; url: string }>;
}

/** Everything said with this person, oldest first: ClientMessage + the channel tables, merged by identity. */
export async function readThreadMessages(thread: { id: string; organizationId: string; email: string | null; phone: string | null }, cap = 200): Promise<ThreadMessage[]> {
  const email = thread.email?.trim().toLowerCase() || null;
  const phone = thread.phone ?? null;
  const phone7 = digits10(phone).slice(-7);
  const [own, texts, calls, letters] = await Promise.all([
    db.clientMessage.findMany({ where: { threadId: thread.id }, orderBy: { createdAt: "desc" }, take: cap }),
    phone7.length >= 7
      ? db.smsMessage.findMany({ where: { organizationId: thread.organizationId, kind: { notIn: ["crew", "verify"] } }, orderBy: { createdAt: "desc" }, take: 400, select: { id: true, direction: true, to: true, from: true, body: true, status: true, createdAt: true } })
      : Promise.resolve([]),
    phone7.length >= 7
      ? db.aiPhoneCall.findMany({ where: { organizationId: thread.organizationId }, orderBy: { startedAt: "desc" }, take: 100, select: { id: true, direction: true, fromNumber: true, toNumber: true, durationSeconds: true, summary: true, transcript: true, startedAt: true } })
      : Promise.resolve([]),
    email
      ? db.emailLog.findMany({ where: { organizationId: thread.organizationId, to: { in: [email, thread.email!.trim()] }, kind: { notIn: ["inbox", "inbox-forward"] } }, orderBy: { createdAt: "desc" }, take: 80, select: { id: true, subject: true, status: true, createdAt: true } })
      : Promise.resolve([]),
  ]);
  const out: ThreadMessage[] = [];
  for (const m of own) {
    out.push({
      id: `own:${m.id}`,
      at: m.createdAt,
      direction: m.direction as "IN" | "OUT",
      channel: m.channel as ThreadMessage["channel"],
      subject: m.subject,
      body: m.body,
      detail: m.status === "FAILED" ? "failed" : null,
      attachments: m.attachmentsJson ? (JSON.parse(m.attachmentsJson) as Array<{ name: string; url: string }>) : [],
    });
  }
  for (const m of texts) {
    if (!(samePhone(phone, m.to) || samePhone(phone, m.from))) continue;
    out.push({ id: `sms:${m.id}`, at: m.createdAt, direction: m.direction === "IN" ? "IN" : "OUT", channel: "SMS", subject: null, body: m.body, detail: m.status === "SKIPPED" ? "not sent" : null, attachments: [] });
  }
  for (const c of calls) {
    if (!(samePhone(phone, c.fromNumber) || samePhone(phone, c.toNumber))) continue;
    const mins = c.durationSeconds ? `${Math.max(1, Math.round(c.durationSeconds / 60))} min` : null;
    out.push({ id: `call:${c.id}`, at: c.startedAt, direction: c.direction === "OUT" ? "OUT" : "IN", channel: "CALL", subject: null, body: c.summary ?? "Call", detail: mins, attachments: [] });
  }
  for (const l of letters) {
    out.push({ id: `mail:${l.id}`, at: l.createdAt, direction: "OUT", channel: "EMAIL", subject: l.subject, body: l.subject, detail: l.status === "sent" ? null : l.status, attachments: [] });
  }
  out.sort((a, b) => a.at.getTime() - b.at.getTime());
  return out.slice(-cap);
}

// ── small levers ─────────────────────────────────────────────────────────────

export async function threadSeen(threadId: string, organizationId: string): Promise<void> {
  await db.clientThread.updateMany({ where: { id: threadId, organizationId }, data: { unread: 0 } });
}

export async function setThreadStatus(threadId: string, organizationId: string, status: "OPEN" | "CLOSED"): Promise<void> {
  await db.clientThread.updateMany({ where: { id: threadId, organizationId }, data: { status, ...(status === "CLOSED" ? { urgent: false } : {}) } });
}

export async function setThreadUrgent(threadId: string, organizationId: string, urgent: boolean): Promise<void> {
  await db.clientThread.updateMany({ where: { id: threadId, organizationId }, data: { urgent } });
}

/** The Reply-To for a client-facing letter when the inbox can receive (else null keeps the company's own). */
export async function clientReplyTo(organizationId: string, clientId: string): Promise<string | null> {
  const cfg = inboundConfig();
  if (!cfg.enabled || !cfg.domain) return null;
  const client = await db.client.findFirst({ where: { id: clientId, organizationId, deletedAt: null }, select: { id: true, name: true, email: true, phone: true } });
  if (!client) return null;
  const t = await ensureThread(organizationId, { clientId: client.id, name: client.name, email: client.email, phone: client.phone });
  return threadAddress(t.replyToken, cfg.domain);
}
