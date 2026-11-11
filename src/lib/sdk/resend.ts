import { Resend } from "resend";
import { IntegrationDisabledError } from "./base";
import { isSmtpEnabled, sendViaSmtp } from "./smtp";
import { withEmailRetry, recipientLabel } from "./emailRetry";
import { isQaEmail } from "@/lib/qaEmail";
import { previewRecipients } from "@/lib/emailPreviewGuard";
import type { EmailLogEntry, EmailKind } from "@/lib/emailLog";
import { activeCapture } from "@/lib/leadCenter/outboxContext";

let client: Resend | null = null;

export function isResendEnabled() {
  return Boolean(process.env.RESEND_API_KEY);
}

export function getResend() {
  if (!process.env.RESEND_API_KEY) {
    throw new IntegrationDisabledError("Resend", "RESEND_API_KEY");
  }
  if (!client) client = new Resend(process.env.RESEND_API_KEY);
  return client;
}

// INBOUND MAIL (2026-11-08, the subcontractors plan, part 2, lib/subInbound). Reading a received letter and its
// attachments needs a Resend API key too — but `isResendEnabled()` above moves EVERY outgoing letter onto Resend
// the moment RESEND_API_KEY is set, and production sends through Gmail SMTP (docs/email-dns.md). So the inbound side
// reads its own key, RESEND_INBOUND_API_KEY (a key with receiving permissions), falling back to RESEND_API_KEY only
// where that is already the sending transport. Sending stays exactly as it was.
let inboundClient: Resend | null = null;
export function inboundApiKey(): string | null {
  return process.env.RESEND_INBOUND_API_KEY?.trim() || process.env.RESEND_API_KEY?.trim() || null;
}
export function isResendInboundEnabled() {
  return Boolean(inboundApiKey());
}
export function getResendInbound() {
  const key = inboundApiKey();
  if (!key) throw new IntegrationDisabledError("Resend inbound", "RESEND_INBOUND_API_KEY");
  if (!inboundClient) inboundClient = new Resend(key);
  return inboundClient;
}

// Unified default sender. EMAIL_FROM wins; FROM_EMAIL is the SMTP-style alias
// some environments set; otherwise the platform address.
export const EMAIL_FROM =
  process.env.EMAIL_FROM ?? process.env.FROM_EMAIL ?? "JobFlex <app@jobflex.app>";

// True when ANY transport is configured (Resend in prod, SMTP locally).
export function isEmailEnabled() {
  return isResendEnabled() || isSmtpEnabled();
}

/**
 * Send a transactional email through whichever transport is configured.
 *
 * Precedence: Resend (production — key lives on Vercel) → SMTP (local/dev, e.g.
 * a Gmail app password in .env.local) → no-op stub when neither is set.
 *
 * `replyTo` lets customer-facing mail send from the platform address while
 * routing replies back to the contractor.
 */
/** The last message this deployment got out, for the integrations-health
 *  panel (lib/integrationsHealth). Best-effort: bookkeeping never fails a send. */
async function stampSent(): Promise<void> {
  try {
    const { db } = await import("@/lib/db");
    await db.syncState.upsert({
      where: { key: "email:last-sent" },
      update: { cursor: new Date().toISOString() },
      create: { key: "email:last-sent", cursor: new Date().toISOString() },
    });
  } catch {
    /* the panel will say "nothing yet" */
  }
}

/** The mail log (lib/emailLog, 2026-10-21): every branch of sendEmail files
 *  one row — sent, failed after the retries, or skipped. Loaded lazily so this
 *  module stays importable anywhere; never fails or holds up a send. */
async function logEmail(entry: Omit<EmailLogEntry, "durationMs">, started: number): Promise<void> {
  try {
    const { recordEmail } = await import("@/lib/emailLog");
    await recordEmail({ ...entry, durationMs: Date.now() - started });
  } catch (err) {
    console.warn("[email-log] not recorded:", err instanceof Error ? err.message : err);
  }
}

/** The platform's own mailbox (the one SMTP signs in as and support-mail reads); null when none is configured. */
export function platformMailbox(): string | null {
  const raw = (process.env.IMAP_USER || process.env.SMTP_USER || "").trim() || (EMAIL_FROM.match(/<([^>]+)>/)?.[1] ?? EMAIL_FROM).trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw) && !/@resend\.dev$/i.test(raw) ? raw.toLowerCase() : null;
}

/** The recipients not on the do-not-email list; all of them for an essential letter. Throws when the list can't be read. */
export async function withoutBlocked(recipients: readonly string[], kind?: string | null): Promise<string[]> {
  const { isEssentialKind } = await import("@/lib/mailBlockShared");
  if (isEssentialKind(kind) || !recipients.length) return [...recipients];
  const { blockedAmong } = await import("@/lib/mailBlock");
  const { normalizeEmail } = await import("@/lib/mailBlockShared");
  let blocked: Set<string>;
  try {
    blocked = await blockedAmong(recipients);
  } catch (err) {
    throw new Error(`The do-not-email list could not be read, so the letter was not sent: ${err instanceof Error ? err.message : String(err)}`);
  }
  return recipients.filter((r) => !blocked.has(normalizeEmail(r) ?? r.trim().toLowerCase()));
}

export async function sendEmail(opts: {
  to: string | string[];
  subject: string;
  html: string;
  from?: string;
  replyTo?: string;
  /** The plain-text twin (2026-10-08): a letter with only HTML scores worse with spam filters. */
  text?: string;
  /** Extra headers, e.g. List-Unsubscribe (lib/adminMail/optout). */
  headers?: Record<string, string>;
  /** What the letter is, for the mail log (/admin/mail/log). Default "other". */
  kind?: EmailKind;
  /** The company it is for, when the caller knows and the request does not
   *  (a cron). Otherwise the request's organization (requireOrg). */
  organizationId?: string | null;
}) {
  const started = Date.now();
  const log = (to: string | string[], rest: Pick<EmailLogEntry, "transport" | "status" | "providerId" | "error">) =>
    logEmail({ to, subject: opts.subject, kind: opts.kind, organizationId: opts.organizationId, ...rest }, started);

  // QA Lab test mode (lib/qaTestMode, 2026-10-14): nothing is sent to the
  // automated checks' @qa.jobflex.test addresses. Same gate as qaTestModeOn,
  // read here without the database so this module stays importable anywhere.
  const recipients = Array.isArray(opts.to) ? opts.to : [opts.to];

  // THE LEAD CENTER TEST ENVIRONMENT (lib/leadCenter/sandbox, 2026-10-29): a test-environment lead's letters are
  // recorded on the Lead Center, whole, and never sent. The mail log still gets its row, marked skipped.
  const capture = activeCapture();
  if (capture && recipients.length > 0) {
    await capture.record({ channel: "email", to: recipients.join(", "), subject: opts.subject, body: opts.html, what: opts.kind ?? null });
    await log(recipients, { transport: "skipped", status: "skipped", providerId: "lead-test:captured" });
    return { id: "lead-test:captured", skipped: true as const };
  }
  if (process.env.QA_TEST_MODE === "1" && !!process.env.QA_SECRET && process.env.VERCEL_ENV !== "production" && recipients.length > 0 && recipients.every((r) => isQaEmail(r))) {
    await log(recipients, { transport: "skipped", status: "skipped", providerId: "qa-test-mode:skipped" });
    return { id: "qa-test-mode:skipped", skipped: true as const };
  }

  // THE DO-NOT-EMAIL LIST (lib/mailBlock, 2026-11-11): a listed address is left out of every letter but the few a
  // person asks for or is owed on money (lib/mailBlockShared ESSENTIAL_KINDS). A letter left with nobody is logged
  // as skipped and returns a skip, never an error. A list that cannot be read stops the letter (it throws).
  const kept = await withoutBlocked(recipients, opts.kind);
  if (kept.length < recipients.length) {
    if (!kept.length) {
      await log(recipients, { transport: "skipped", status: "skipped", providerId: "mail-block:skipped" });
      return { id: "mail-block:skipped", skipped: true as const };
    }
    await log(recipients.filter((r) => !kept.includes(r)), { transport: "skipped", status: "skipped", providerId: "mail-block:skipped" });
    opts = { ...opts, to: kept };
  }
  // Replies to JobFlex's own letters come back to the platform mailbox, where /api/cron/support-mail reads a "stop".
  if (!opts.replyTo && !opts.from) {
    const box = platformMailbox();
    if (box) opts = { ...opts, replyTo: box };
  }

  // A PREVIEW DEPLOYMENT (2026-10-18, lib/emailPreviewGuard): the same Gmail
  // box as production, so only our own addresses (PREVIEW_EMAIL_ALLOW) get a
  // letter; anyone else is dropped, and a letter left with nobody is logged.
  const previewTo = previewRecipients(recipients);
  if (previewTo) {
    if (!previewTo.length) {
      console.info(`[email] preview: not sent — "${opts.subject}" to ${recipients.length} address(es) outside PREVIEW_EMAIL_ALLOW`);
      await log(recipients, { transport: "skipped", status: "skipped", providerId: "preview:skipped" });
      return { id: "preview:skipped", skipped: true as const };
    }
    if (previewTo.length < recipients.length) console.info(`[email] preview: "${opts.subject}" sent to ${previewTo.length} of ${recipients.length} address(es)`);
    opts = { ...opts, to: previewTo };
  }

  // Dev preview: when DEV_EMAIL_OVERRIDE is set, redirect every email to that one
  // inbox so you can see the design without a verified domain (Resend's test
  // sender only delivers to your own address). The original recipient is shown
  // in the subject. Never set this in production.
  const override = process.env.DEV_EMAIL_OVERRIDE?.trim();
  const to = override || opts.to;
  const subject = override
    ? `[→ ${Array.isArray(opts.to) ? opts.to.join(", ") : opts.to}] ${opts.subject}`
    : opts.subject;

  // DEV OUTBOX (2026-09-11). In development only, EMAIL_DEV_OUTBOX=<dir>
  // writes every email as an .html file in that folder INSTEAD of sending
  // it — the words and links can be checked without an inbox and without
  // mail leaving the machine. Never read in production.
  const outbox = process.env.NODE_ENV !== "production" ? process.env.EMAIL_DEV_OUTBOX?.trim() : "";
  if (outbox) {
    const { mkdir, writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    await mkdir(outbox, { recursive: true });
    const name = `${new Date().toISOString().replace(/[:.]/g, "-")}-${subject.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 60)}.html`;
    const label = Array.isArray(to) ? to.join(", ") : to;
    const extra = [opts.from ? `<!-- from: ${opts.from} -->` : "", opts.replyTo ? `<!-- reply-to: ${opts.replyTo} -->` : "", opts.headers ? `<!-- headers: ${JSON.stringify(opts.headers)} -->` : ""].filter(Boolean).join("\n");
    const textPart = opts.text ? `\n<!-- text:\n${opts.text.replace(/-->/g, "—>")}\n-->` : "";
    await writeFile(join(outbox, name), `<!-- to: ${label} | subject: ${subject} -->\n${extra ? `${extra}\n` : ""}${opts.html}${textPart}`, "utf8");
    await log(opts.to, { transport: "skipped", status: "skipped", providerId: "dev-outbox:" + name });
    return { id: "dev-outbox:" + name, skipped: true as const };
  }

  if (isResendEnabled()) {
    // Retry transient provider failures (network, 429, 5xx) up to 3 attempts with
    // backoff; a permanent error (bad address / invalid key) is re-thrown at once.
    try {
      const sent = await withEmailRetry(`resend → ${recipientLabel(to)}`, async () => {
        const r = await getResend().emails.send({
          from: opts.from ?? EMAIL_FROM,
          to,
          subject,
          html: opts.html,
          replyTo: opts.replyTo,
          ...(opts.text ? { text: opts.text } : {}),
          ...(opts.headers ? { headers: opts.headers } : {}),
        });
        // Resend returns { data, error } — it does NOT throw. Convert a failure to a
        // throw so retry can classify + back off (and so callers see it, never a
        // silent "looks like success"). Carry error.name so the classifier can tell
        // a transient rate-limit from a permanent validation/auth error.
        if (r.error) {
          const err = new Error(r.error.message ?? r.error.name ?? "Email failed to send.");
          err.name = r.error.name ?? "resend_error";
          throw err;
        }
        void stampSent();
        return { id: r.data?.id ?? "", skipped: false as const };
      });
      await log(opts.to, { transport: "resend", status: "sent", providerId: sent.id });
      return sent;
    } catch (err) {
      await log(opts.to, { transport: "resend", status: "failed", error: err });
      throw err;
    }
  }
  if (isSmtpEnabled()) {
    try {
      const sent = await sendViaSmtp({ ...opts, to, subject, from: opts.from ?? EMAIL_FROM });
      await log(opts.to, { transport: "smtp", status: "sent", providerId: sent.id });
      return sent;
    } catch (err) {
      await log(opts.to, { transport: "smtp", status: "failed", error: err });
      throw err;
    }
  }
  console.warn(
    "[email] No transport configured (set RESEND_API_KEY or SMTP_*) — would send:",
    opts.subject,
    "→",
    opts.to,
  );
  await log(opts.to, { transport: "skipped", status: "skipped", providerId: "disabled" });
  return { id: "disabled", skipped: true as const };
}
