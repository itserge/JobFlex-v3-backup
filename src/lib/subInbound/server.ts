import "server-only";
// QUOTES BY EMAIL — the database half (2026-11-08, the subcontractors plan, part 2). The rules are ./shared, the
// switch ./config, the webhook /api/inbound/email.
//
//   · ingestReceivedEmail — one received letter: the recipient row from the token in the address it was sent to;
//                           the words and the attachments read back from Resend (or carried in a signed test payload);
//                           the raw message and every document kept in the private store; a version on the row with
//                           the first document, its AI read queued; the office told. A letter with no token, a closed
//                           request, a stranger's address or an auto-reply is kept for review instead — nothing is
//                           discarded, and the provider's id makes a redelivery a no-op.
//   · inboundReview        — the company's letters waiting for a person, with their documents.
//   · attachInbound        — a person matches a held letter to a quote: its document becomes the version.
//   · ignoreInbound        — a person sets a held letter aside.
//   · inboundCounts        — the numbers the admin's health page watches.

import { db } from "@/lib/db";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { localDayKey } from "@/lib/jobProgressShared";
import { putPrivate, safePathname } from "@/lib/media/privateStore";
import { isoDay } from "@/lib/projectTimeline/shared";
import { getResendInbound, isResendInboundEnabled } from "@/lib/sdk/resend";
import { isAutoReply } from "@/lib/supportInbound";
import { linkClosed } from "@/lib/projectSubs/shared";
import { addVersionFromEmail, quoteByToken, tellOffice, SUB_EVENT_KIND } from "@/lib/projectSubs/server";
import { DOC_SELECT, docRow, recordDocument, type DocRow } from "@/lib/subDocs/server";
import { MAX_DOC_BYTES, docPathname, safeDocName } from "@/lib/subDocs/shared";
import { inboundConfig } from "./config";
import { excerptOf, inboundLine, pickDocuments, requestNumberFromSubject, senderMatches, sniffType, tokenFromAddresses, whyWords, type InboundAttachmentIn, type InboundWhy } from "./shared";

export type { InboundConfig } from "./config";
export { inboundConfig, inboundReplyTo } from "./config";

/** What Resend posts for `email.received` (metadata only), plus the fields a signed test payload may carry so the
 *  stand needs no Resend: the words, the headers, and attachments with a `download_url` (a data URL will do). */
export type ReceivedEmail = {
  email_id: string;
  from: string;
  to?: string[] | null;
  cc?: string[] | null;
  bcc?: string[] | null;
  received_for?: string[] | null;
  subject?: string | null;
  message_id?: string | null;
  created_at?: string | null;
  attachments?: Array<{ id: string; filename?: string | null; content_type?: string | null; size?: number | null; content_disposition?: string | null; content_id?: string | null; download_url?: string | null }> | null;
  text?: string | null;
  html?: string | null;
  headers?: Record<string, string> | null;
  raw_url?: string | null;
};

export type IngestResult = { outcome: "duplicate" | "matched" | "note" | "review" | "ignored"; inboundId: string | null; versionId: string | null; why: InboundWhy; words: string };

const MAX_RAW_BYTES = 25 * 1024 * 1024;

/** The bytes behind a link (the provider's temporary URL, or a data URL in a test), within `max`. */
async function fetchBytes(url: string, max: number): Promise<{ buf: Buffer; contentType: string | null } | null> {
  const r = await fetch(url).catch(() => null);
  if (!r || !r.ok) return null;
  const len = Number(r.headers.get("content-length") ?? "0");
  if (len > max) return null;
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.byteLength > max || !buf.byteLength) return null;
  return { buf, contentType: r.headers.get("content-type") };
}

/** The optional scan (SUBS_SCAN_URL, a ClamAV REST endpoint): CLEAN, FLAGGED, FAILED — or SKIPPED without one. */
async function scanBytes(buf: Buffer): Promise<"CLEAN" | "FLAGGED" | "FAILED" | "SKIPPED"> {
  const url = process.env.SUBS_SCAN_URL?.trim();
  if (!url) return "SKIPPED";
  try {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/octet-stream" }, body: new Uint8Array(buf), signal: AbortSignal.timeout(20_000) });
    if (!r.ok) return "FAILED";
    const j = (await r.json().catch(() => null)) as { clean?: boolean; infected?: boolean; result?: string } | null;
    if (!j) return "FAILED";
    if (j.clean === true || j.result === "clean") return "CLEAN";
    if (j.infected === true || j.clean === false || j.result === "infected") return "FLAGGED";
    return "FAILED";
  } catch {
    return "FAILED";
  }
}

type Kept = { url: string; name: string; contentType: string; bytes: number; scan: Awaited<ReturnType<typeof scanBytes>> };

/** A picked attachment into the private store under the company's folder, its bytes checked first. */
async function keepAttachment(organizationId: string, projectId: string | null, a: InboundAttachmentIn & { type: string; name: string }, fallbackContent: Map<string, Buffer>): Promise<Kept | { skipped: string }> {
  const got = a.downloadUrl ? await fetchBytes(a.downloadUrl, MAX_DOC_BYTES) : fallbackContent.has(a.id) ? { buf: fallbackContent.get(a.id)!, contentType: a.contentType } : null;
  if (!got) return { skipped: "could not be downloaded" };
  const sniffed = sniffType(got.buf);
  if (!sniffed) return { skipped: "not a PDF or a picture by its bytes" };
  const type = sniffed === "image/heic" ? (a.type.startsWith("image/hei") ? a.type : "image/heic") : sniffed;
  const scan = await scanBytes(got.buf);
  if (scan === "FLAGGED") return { skipped: "flagged by the malware scan" };
  const name = safeDocName(a.name, type === "application/pdf" ? "estimate.pdf" : "page.jpg");
  const put = await putPrivate(safePathname(docPathname(organizationId, projectId, name)), got.buf, type);
  return { url: put.url, name, contentType: type, bytes: got.buf.byteLength, scan };
}

/** The raw message (.eml) into the store — under the company when known, else the review folder. */
async function keepRaw(url: string | null | undefined, organizationId: string | null, emailId: string): Promise<string | null> {
  if (!url) return null;
  const got = await fetchBytes(url, MAX_RAW_BYTES);
  if (!got) return null;
  const folder = organizationId ? `subs/${organizationId}/inbound` : "subs/_inbound";
  const put = await putPrivate(safePathname(`${folder}/${Date.now()}-${emailId.replace(/[^A-Za-z0-9_-]/g, "")}.eml`), got.buf, "message/rfc822");
  return put.url;
}

export async function ingestReceivedEmail(d: ReceivedEmail): Promise<IngestResult> {
  const providerId = d.email_id?.trim();
  if (!providerId) throw new Error("The letter has no id.");
  const seen = await db.inboundEmail.findUnique({ where: { providerId }, select: { id: true, versionId: true, state: true } });
  if (seen) return { outcome: "duplicate", inboundId: seen.id, versionId: seen.versionId, why: "matched", words: "Delivered before." };

  const cfg = inboundConfig();
  const addresses = [...(d.to ?? []), ...(d.cc ?? []), ...(d.bcc ?? []), ...(d.received_for ?? [])];
  const token = tokenFromAddresses(addresses, cfg.domain);
  const door = token ? await quoteByToken(token) : null;

  // The words and the attachments: carried in a signed payload (a test), else read back from Resend.
  let text = d.text ?? null;
  let html = d.html ?? null;
  let headers = d.headers ?? null;
  let subject = d.subject ?? null;
  let rawUrl: string | null | undefined = d.raw_url ?? null;
  let attachments: InboundAttachmentIn[] = (d.attachments ?? []).map((a) => ({ id: a.id, filename: a.filename ?? null, contentType: a.content_type ?? null, size: a.size ?? null, disposition: a.content_disposition ?? null, contentId: a.content_id ?? null, downloadUrl: a.download_url ?? null }));
  const carried = text != null || html != null || attachments.some((a) => a.downloadUrl);
  if (!carried && isResendInboundEnabled()) {
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
    attachments = got.data.attachments.map((a) => ({ id: a.id, filename: a.filename, contentType: a.content_type, size: a.size, disposition: a.content_disposition, contentId: a.content_id, downloadUrl: links.get(a.id) ?? null }));
  }

  const excerpt = excerptOf(text, html, 4000);
  const now = new Date();
  const receivedAt = d.created_at ? new Date(d.created_at) : now;
  const organizationId = door?.organizationId ?? null;

  // Part 5a: on awarded work the request is closed for prices but open for invoices — a letter with a document there
  // is the sub's invoice.
  const invoicing = !!door && (door.status === "AWARDED" || door.status === "INVOICED");
  // Why it would wait for a person.
  let why: InboundWhy = "matched";
  if (!token) why = "no-address";
  else if (!door) why = "no-such-request";
  else if (door.closed && !invoicing) why = "request-closed";
  else if (senderMatches(d.from, door.contractorEmail) === "other") why = "stranger";
  if (isAutoReply(subject ?? "", headers)) why = "auto-reply";
  const state = why === "matched" ? "MATCHED" : why === "auto-reply" ? "IGNORED" : "REVIEW";

  const keptRaw = await keepRaw(rawUrl, organizationId, providerId);
  const row = await db.inboundEmail
    .create({
      data: {
        organizationId,
        providerId,
        fromAddr: d.from.slice(0, 320),
        toJson: JSON.stringify(addresses.slice(0, 20)),
        subject: subject?.slice(0, 500) ?? null,
        messageId: d.message_id?.slice(0, 500) ?? null,
        text: excerpt || null,
        rawUrl: keptRaw,
        receivedAt,
        quoteId: door?.quoteId ?? null,
        requestId: door?.requestId ?? null,
        state,
        note: whyWords(why) || null,
      },
      select: { id: true },
    })
    .catch(async (err: unknown) => {
      const again = await db.inboundEmail.findUnique({ where: { providerId }, select: { id: true } });
      if (again) return null;
      throw err;
    });
  if (!row) return { outcome: "duplicate", inboundId: null, versionId: null, why: "matched", words: "Delivered before." };

  // The documents: kept under the company's folder when the company is known (a held letter keeps them too, so a
  // person can match it without the provider's links, which die in an hour).
  const picked = pickDocuments(attachments);
  const kept: Array<Kept & { id: string }> = [];
  if (organizationId) {
    for (const a of picked.docs.slice(0, 6)) {
      const k = await keepAttachment(organizationId, door?.projectId ?? null, a, new Map());
      if ("skipped" in k) {
        picked.skipped.push({ name: a.name, why: k.skipped });
        continue;
      }
      kept.push({ ...k, id: a.id });
    }
  }

  if (state !== "MATCHED" || !door) {
    // Held: its documents are recorded as the company's (kind OTHER) so Attach can use them later.
    if (organizationId) {
      for (const k of kept) {
        const doc = await recordDocument({ organizationId, projectId: door?.projectId ?? null, contractorId: door?.contractorId ?? null, requestId: null, kind: "OTHER", name: k.name, url: k.url, contentType: k.contentType, bytes: k.bytes, uploadedVia: "EMAIL", uploadedById: null, inboundEmailId: row.id });
        if (k.scan !== "SKIPPED") await db.subDocument.update({ where: { id: doc.id }, data: { scanStatus: k.scan } }).catch(() => undefined);
      }
      if (door && state === "REVIEW") {
        await tellOffice(organizationId, door.projectId, `An email about ${door.what} on ${door.projectName} from ${d.from} needs a look — ${whyWords(why).replace(/\.$/, "")}. Quotes & Proposals → Mail to match.`, { inboundId: row.id, quoteId: door.quoteId, requestId: door.requestId }, "/dashboard/quotes").catch(() => undefined);
      }
    }
    return { outcome: state === "IGNORED" ? "ignored" : "review", inboundId: row.id, versionId: null, why, words: whyWords(why) };
  }

  // Matched. The first document becomes the version (its read is queued); the others are kept on the letter.
  const [first, ...rest] = kept;
  if (first && invoicing) {
    // An invoice on awarded work: the document recorded as an INVOICE, the invoice made (lib/subInvoices — numbered,
    // checked, its read queued, the office told), the other files kept on the letter.
    const doc = await recordDocument({ organizationId: door.organizationId, projectId: door.projectId, contractorId: door.contractorId, requestId: null, kind: "INVOICE", name: first.name, url: first.url, contentType: first.contentType, bytes: first.bytes, uploadedVia: "EMAIL", uploadedById: null, inboundEmailId: row.id });
    if (first.scan !== "SKIPPED") await db.subDocument.update({ where: { id: doc.id }, data: { scanStatus: first.scan } }).catch(() => undefined);
    for (const k of rest) {
      const other = await recordDocument({ organizationId: door.organizationId, projectId: door.projectId, contractorId: door.contractorId, requestId: null, kind: "OTHER", name: k.name, url: k.url, contentType: k.contentType, bytes: k.bytes, uploadedVia: "EMAIL", uploadedById: null, inboundEmailId: row.id });
      if (k.scan !== "SKIPPED") await db.subDocument.update({ where: { id: other.id }, data: { scanStatus: k.scan } }).catch(() => undefined);
    }
    const { invoiceFromEmail } = await import("@/lib/subInvoices/server");
    const inv = await invoiceFromEmail(door.quoteId, { documentId: doc.id, inboundEmailId: row.id, note: excerpt ? excerpt.slice(0, 1000) : null });
    return { outcome: "matched", inboundId: row.id, versionId: null, why, words: inv ? `${first.name} is ${door.contractorName}'s invoice SI-${inv.number}; the figures are being read.` : `${first.name} is kept on the letter.` };
  }
  if (first) {
    const r = await addVersionFromEmail(door.quoteId, { note: excerpt ? excerpt.slice(0, 1000) : null, file: { url: first.url, name: first.name, contentType: first.contentType, bytes: first.bytes }, documentId: null, inboundEmailId: row.id });
    if (first.scan !== "SKIPPED" && r.version.document) await db.subDocument.update({ where: { id: r.version.document.id }, data: { scanStatus: first.scan } }).catch(() => undefined);
    for (const k of rest) {
      const doc = await recordDocument({ organizationId: door.organizationId, projectId: door.projectId, contractorId: door.contractorId, requestId: null, kind: "OTHER", name: k.name, url: k.url, contentType: k.contentType, bytes: k.bytes, uploadedVia: "EMAIL", uploadedById: null, inboundEmailId: row.id });
      if (k.scan !== "SKIPPED") await db.subDocument.update({ where: { id: doc.id }, data: { scanStatus: k.scan } }).catch(() => undefined);
    }
    await db.inboundEmail.update({ where: { id: row.id }, data: { versionId: r.version.id } });
    await tellOffice(door.organizationId, door.projectId, inboundLine(door.contractorName, door.what, door.projectName, first.name, excerpt), { quoteId: door.quoteId, requestId: door.requestId, versionId: r.version.id, inboundId: row.id });
    return { outcome: "matched", inboundId: row.id, versionId: r.version.id, why, words: `${first.name} is on ${door.contractorName}'s quote as V${r.version.version}; the figures are being read.` };
  }

  // No document: the words are kept as a note on the quote.
  await logActivity({ organizationId: door.organizationId, actorId: null, kind: SUB_EVENT_KIND, summary: inboundLine(door.contractorName, door.what, door.projectName, null, excerpt), meta: { projectId: door.projectId, quoteId: door.quoteId, requestId: door.requestId, inboundId: row.id, href: `/dashboard/projects/${door.projectId}/subs?tab=quotes` } });
  return { outcome: "note", inboundId: row.id, versionId: null, why, words: "Kept as a note on the quote — no file was attached." };
}

// ── the review queue ─────────────────────────────────────────────────────────

export type InboundRow = {
  id: string;
  from: string;
  subject: string | null;
  receivedAt: string;
  excerpt: string | null;
  note: string | null;
  state: string;
  quoteId: string | null;
  requestNumber: number | null;
  documents: DocRow[];
  rawHref: string | null;
};

/** The company's letters that wait for a person (newest first), with the documents they carried. */
export async function inboundReview(organizationId: string): Promise<InboundRow[]> {
  const rows = await db.inboundEmail.findMany({
    where: { organizationId, state: "REVIEW" },
    orderBy: { receivedAt: "desc" },
    take: 50,
    select: { id: true, fromAddr: true, subject: true, receivedAt: true, text: true, note: true, state: true, quoteId: true, rawUrl: true, quote: { select: { request: { select: { number: true } } } }, documents: { select: DOC_SELECT } },
  });
  return rows.map((r) => ({
    id: r.id,
    from: r.fromAddr,
    subject: r.subject,
    receivedAt: r.receivedAt.toISOString(),
    excerpt: r.text ? r.text.slice(0, 400) : null,
    note: r.note,
    state: r.state,
    quoteId: r.quoteId,
    requestNumber: r.quote?.request?.number ?? requestNumberFromSubject(r.subject),
    documents: r.documents.map(docRow),
    rawHref: r.rawUrl ? `/api/subs/inbound/${r.id}/raw` : null,
  }));
}

/** A person matches a held letter to a quote: its first document becomes a version (read queued); the letter is
 *  marked matched. A letter without a document is kept as a note on the quote. */
export async function attachInbound(organizationId: string, inboundId: string, quoteId: string, actorId: string | null): Promise<{ projectId: string; versionId: string | null }> {
  const row = await db.inboundEmail.findFirst({ where: { id: inboundId, organizationId }, select: { id: true, state: true, text: true, fromAddr: true, documents: { select: { id: true, kind: true }, orderBy: { createdAt: "asc" } } } });
  if (!row) throw new Error("That letter is not here.");
  if (row.state === "MATCHED") throw new Error("That letter is matched already.");
  const q = await db.projectSubQuote.findFirst({ where: { id: quoteId, organizationId }, select: { id: true, projectId: true, requestId: true, status: true, contractor: { select: { name: true } }, stage: { select: { name: true } }, project: { select: { name: true } } } });
  if (!q) throw new Error("Quote not found");
  if (!["ASKED", "VIEWED", "QUOTED", "REVISION", "AWARDED"].includes(q.status)) throw new Error("That quote is closed.");
  const doc = row.documents[0] ?? null;
  const what = q.stage?.name ?? "the work";
  if (doc) {
    const r = await addVersionFromEmail(q.id, { note: row.text ? row.text.slice(0, 1000) : null, file: null, documentId: doc.id, inboundEmailId: row.id });
    await db.inboundEmail.update({ where: { id: row.id }, data: { state: "MATCHED", quoteId: q.id, requestId: q.requestId, versionId: r.version.id, note: null } });
    await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.PROJECT, summary: `Matched an email from ${row.fromAddr} to ${q.contractor.name}'s quote on ${q.project.name} (V${r.version.version})`, meta: { projectId: q.projectId, quoteId: q.id, requestId: q.requestId, versionId: r.version.id, inboundId: row.id } });
    return { projectId: q.projectId, versionId: r.version.id };
  }
  await db.inboundEmail.update({ where: { id: row.id }, data: { state: "MATCHED", quoteId: q.id, requestId: q.requestId, note: null } });
  await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.PROJECT, summary: inboundLine(q.contractor.name, what, q.project.name, null, row.text ?? ""), meta: { projectId: q.projectId, quoteId: q.id, requestId: q.requestId, inboundId: row.id } });
  return { projectId: q.projectId, versionId: null };
}

export async function ignoreInbound(organizationId: string, inboundId: string, actorId: string | null): Promise<void> {
  const r = await db.inboundEmail.updateMany({ where: { id: inboundId, organizationId, state: "REVIEW" }, data: { state: "IGNORED" } });
  if (!r.count) throw new Error("That letter is not waiting.");
  await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.PROJECT, summary: "Set an inbound email aside", meta: { inboundId } });
}

/** One held letter's raw message, for the office's download. */
export async function inboundRawFor(organizationId: string, inboundId: string): Promise<{ url: string; name: string } | null> {
  const r = await db.inboundEmail.findFirst({ where: { id: inboundId, organizationId }, select: { rawUrl: true, subject: true } });
  return r?.rawUrl ? { url: r.rawUrl, name: `${(r.subject ?? "email").replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 60) || "email"}.eml` } : null;
}

/** What the admin's health page watches: letters nobody matched, letters that fit no company, reads that failed. */
export async function inboundCounts(): Promise<{ review: number; unowned: number; failedReads: number; pendingReads: number }> {
  const [review, unowned, failedReads, pendingReads] = await Promise.all([
    db.inboundEmail.count({ where: { state: "REVIEW" } }),
    db.inboundEmail.count({ where: { state: "REVIEW", organizationId: null } }),
    db.subQuoteVersion.count({ where: { reviewStatus: "FAILED" } }),
    db.subQuoteVersion.count({ where: { reviewStatus: "PENDING" } }),
  ]);
  return { review, unowned, failedReads, pendingReads };
}

/** For the sweep's log line and the checks: a request's "closed" the way the door sees it. */
export function doorClosed(status: string, expiresAt: Date | null, timezone: string | null): boolean {
  const today = localDayKey(new Date(), timezone || "America/New_York");
  return linkClosed(status, isoDay(expiresAt), today) || !["ASKED", "VIEWED", "QUOTED", "REVISION"].includes(status);
}
