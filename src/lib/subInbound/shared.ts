// QUOTES BY EMAIL — the rules (2026-11-08, the subcontractors plan, part 2). A request's email carries a Reply-To of
// rfq-<token>@<the inbound domain>, so a sub who answers with their estimate attached lands on the right recipient
// row without a login; the subject carries [RFQ-1042] as the fallback when a forward loses our address. The database
// half is ./server; the webhook is /api/inbound/email. Pure, so the checks run it without a database.

import { MAX_DOC_BYTES, docTypeOf } from "@/lib/subDocs/shared";
import { emailAddressOf, htmlToText, trimQuoted } from "@/lib/supportInbound";

export const INBOUND_PREFIX = "rfq-";

/** The address a sub replies to: the token names the recipient row, the domain is the inbound subdomain. */
export function inboundAddress(token: string, domain: string): string {
  return `${INBOUND_PREFIX}${token}@${domain.trim().toLowerCase()}`;
}

const TOKEN_RE = /^rfq-([a-z0-9]{10,40})$/i;

/** The token in one of our addresses ("Name <rfq-abc…@quotes.jobflex.app>" or the bare address); null for any other
 *  address. With a domain given, the host must be that domain (case does not matter). */
export function tokenFromAddress(raw: string | null | undefined, domain: string | null): string | null {
  const addr = emailAddressOf(raw ?? null);
  if (!addr) return null;
  const at = addr.lastIndexOf("@");
  if (at < 0) return null;
  const local = addr.slice(0, at);
  const host = addr.slice(at + 1).toLowerCase();
  if (domain && host !== domain.trim().toLowerCase()) return null;
  const m = TOKEN_RE.exec(local);
  return m ? m[1] : null;
}

/** The first of our addresses among To, Cc and the envelope's recipients. */
export function tokenFromAddresses(addrs: ReadonlyArray<string | null | undefined>, domain: string | null): string | null {
  for (const a of addrs) {
    const t = tokenFromAddress(a, domain);
    if (t) return t;
  }
  return null;
}

/** The subject tag on every request email — the fallback when a reply loses our address. */
export const subjectTag = (requestNumber: number) => `[RFQ-${requestNumber}]`;

export function requestNumberFromSubject(subject: string | null | undefined): number | null {
  const m = /\bRFQ-(\d{3,8})\b/i.exec(subject ?? "");
  return m ? Number(m[1]) : null;
}

// ── the attachments ──────────────────────────────────────────────────────────

export type InboundAttachmentIn = {
  id: string;
  filename: string | null;
  contentType: string | null;
  size: number | null;
  disposition?: string | null;
  contentId?: string | null;
  /** The provider's temporary link (an hour), or a data URL in a test. */
  downloadUrl?: string | null;
};

export type PickedAttachment = InboundAttachmentIn & { type: string; name: string };

/** The smallest picture that could be a page; anything inline under it is a signature's logo. */
export const MIN_INLINE_PICTURE_BYTES = 20_000;

/** Which attachments are documents worth keeping — a PDF or a picture by type or by name, within the size cap; the
 *  signature's inline logos and anything else are left aside with the reason. PDFs first. */
export function pickDocuments(atts: ReadonlyArray<InboundAttachmentIn>): { docs: PickedAttachment[]; skipped: Array<{ name: string; why: string }> } {
  const docs: PickedAttachment[] = [];
  const skipped: Array<{ name: string; why: string }> = [];
  for (const a of atts) {
    const label = a.filename?.trim() || "(unnamed)";
    const type = docTypeOf(a.contentType, a.filename);
    if (!type) {
      skipped.push({ name: label, why: "not a PDF or a picture" });
      continue;
    }
    if (a.size != null && a.size > MAX_DOC_BYTES) {
      skipped.push({ name: label, why: "larger than 25 MB" });
      continue;
    }
    const inline = (a.disposition ?? "").toLowerCase() === "inline" || Boolean(a.contentId);
    if (type !== "application/pdf" && inline && a.size != null && a.size < MIN_INLINE_PICTURE_BYTES) {
      skipped.push({ name: label, why: "an inline picture (a logo)" });
      continue;
    }
    docs.push({ ...a, type, name: a.filename?.trim() || (type === "application/pdf" ? "estimate.pdf" : "page.jpg") });
  }
  docs.sort((x, y) => Number(y.type === "application/pdf") - Number(x.type === "application/pdf"));
  return { docs, skipped };
}

/** The first bytes decide what a file is, whatever its name says. */
export function sniffType(bytes: Uint8Array): "application/pdf" | "image/jpeg" | "image/png" | "image/webp" | "image/heic" | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "application/pdf";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ascii(4, 8) === "ftyp" && /^(heic|heix|hevc|hevx|mif1|msf1|heim|heis|avif)$/.test(ascii(8, 12))) return "image/heic";
  return null;
}

// ── the sender ───────────────────────────────────────────────────────────────

const PUBLIC_MAIL = new Set(["gmail.com", "googlemail.com", "yahoo.com", "hotmail.com", "outlook.com", "live.com", "msn.com", "icloud.com", "me.com", "mac.com", "aol.com", "comcast.net", "proton.me", "protonmail.com", "ymail.com", "att.net", "verizon.net"]);

export type SenderMatch = "match" | "other" | "unknown";

/** Whether the letter came from the sub on file: the same address, or another box at the same company domain
 *  (never a public mail domain); "unknown" when the sub has no email on file. */
export function senderMatches(from: string | null | undefined, contractorEmail: string | null | undefined): SenderMatch {
  const a = emailAddressOf(from ?? null)?.toLowerCase() ?? null;
  const b = emailAddressOf(contractorEmail ?? null)?.toLowerCase() ?? null;
  if (!b) return "unknown";
  if (!a) return "other";
  if (a === b) return "match";
  const da = a.slice(a.lastIndexOf("@") + 1);
  const dbm = b.slice(b.lastIndexOf("@") + 1);
  return da && da === dbm && !PUBLIC_MAIL.has(da) ? "match" : "other";
}

// ── the words ────────────────────────────────────────────────────────────────

/** The sub's own words, without the letter they quote, trimmed to `max`. */
export function excerptOf(text: string | null | undefined, html: string | null | undefined, max = 1500): string {
  const words = trimQuoted(text?.trim() ? text : html ? htmlToText(html) : "").trim();
  return words.length > max ? `${words.slice(0, max - 1).trimEnd()}…` : words;
}

export const INBOUND_STATES = ["MATCHED", "REVIEW", "IGNORED"] as const;
export type InboundState = (typeof INBOUND_STATES)[number];
export const INBOUND_STATE_LABEL: Record<InboundState, string> = { MATCHED: "Matched", REVIEW: "To match", IGNORED: "Ignored" };
export const inboundStateOf = (s: string | null | undefined): InboundState => ((INBOUND_STATES as readonly string[]).includes(s ?? "") ? (s as InboundState) : "REVIEW");

export type InboundWhy = "matched" | "no-address" | "no-such-request" | "request-closed" | "stranger" | "auto-reply";

/** Why a letter waits for a person, in the office's words. */
export function whyWords(why: InboundWhy): string {
  switch (why) {
    case "no-address":
      return "No request address on it — match it to a request by hand.";
    case "no-such-request":
      return "The address names a request that does not exist.";
    case "request-closed":
      return "The request is closed; the sub answered late.";
    case "stranger":
      return "Sent from another address than the sub's on file.";
    case "auto-reply":
      return "An automatic reply.";
    default:
      return "";
  }
}

/** The office's line for a matched letter. */
export function inboundLine(contractor: string, what: string, project: string, docName: string | null, excerpt: string): string {
  if (docName) return `${contractor} replied by email about ${what} on ${project} — ${docName} attached; the figures are being read.`;
  const words = excerpt.replace(/\s+/g, " ").trim();
  return words ? `${contractor} replied by email about ${what} on ${project}: “${words.length > 160 ? `${words.slice(0, 159)}…` : words}”` : `${contractor} replied by email about ${what} on ${project} (no words, no file).`;
}

/** One sentence in the request email when replies by email are on. */
export const REPLY_HINT = "You can also reply to this email with your estimate attached — it lands on the request by itself.";
