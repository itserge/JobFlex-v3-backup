import "server-only";
// THE CLIENT'S PAYMENT LETTERS (2026-11-09, the ProSmart gaps plan, part 3) — one builder each, used by the
// automatic receipt on payment (lib/notify notifyPaymentReceived), the Payments panel's Preview / Send / Resend, and
// the "order placed" notice (by hand, or by itself on the first payment when the company switches that on).
//
// Every letter that goes out is written to the proposal's trail (ActivityEvent kind EMAIL) with what it was in
// `meta` — { receipt: <paymentId> } or { orderNotice: true } — which is what the panel's log and "sent Nov 3" read.

import { db } from "@/lib/db";
import { appBaseUrl } from "@/lib/appUrl";
import { contractSchedule } from "@/lib/contractTotal";
import { resolveSchedule, fromMinor } from "@/lib/paymentSchedule";
import { renderEmail } from "@/lib/email/renderEmail";
import { buildOrderNotice, buildPaymentReceipt } from "@/lib/email/build/client";
import { sendOrgEmail, type OrgEmailSender } from "@/lib/email/orgSend";

/** "card", "bank transfer", "check" — how the receipt names the money. */
export function methodPhrase(provider: string, method: string | null): string {
  if (method === "us_bank_account") return "bank account";
  if (provider === "STRIPE" || provider === "SQUARE" || provider === "STAX") return "card";
  if (method === "BANK_TRANSFER") return "bank transfer";
  if (method === "CASH") return "cash";
  if (method === "CHECK") return "check";
  return "";
}

const ORG_SELECT = { id: true, name: true, billingEmail: true, gmailSettingsJson: true, gmailTokensJson: true, logoUrl: true, phone: true, paymentSettingsJson: true } as const;
type OrgRow = { id: string; name: string; billingEmail: string | null; gmailSettingsJson: string | null; gmailTokensJson: string | null; logoUrl: string | null; phone: string | null; paymentSettingsJson: string | null };

export type ClientLetter = {
  organizationId: string;
  proposalId: string;
  clientId: string | null;
  /** The client's email, or null — then it can be previewed, not sent. */
  to: string | null;
  subject: string;
  html: string;
  org: OrgRow;
};

async function moneyOf(proposalId: string) {
  const p = await db.proposal.findUnique({
    where: { id: proposalId },
    select: { total: true, currency: true, installments: true, changeOrders: { where: { status: "APPROVED" }, select: { status: true, total: true } } },
  });
  if (!p) return { paidToDate: 0, remaining: 0 };
  const s = resolveSchedule({ ...contractSchedule(p.total, p.changeOrders), currency: p.currency, installments: p.installments });
  return { paidToDate: fromMinor(s.paidMinor), remaining: fromMinor(s.remainingMinor) };
}

/** The receipt for one payment, as it reads now. Null when the payment is not a live payment on a proposal. */
export async function receiptLetter(paymentId: string, organizationId?: string): Promise<ClientLetter | null> {
  const payment = await db.payment.findFirst({
    where: { id: paymentId, ...(organizationId ? { organizationId } : {}) },
    include: {
      installments: { select: { label: true } },
      client: { select: { name: true, email: true } },
      proposal: { select: { id: true, title: true, publicId: true, clientId: true, client: { select: { name: true, email: true } }, organization: { select: ORG_SELECT } } },
    },
  });
  if (!payment || !payment.proposal || payment.status === "VOID") return null;
  const proposal = payment.proposal;
  const client = payment.client ?? proposal.client;
  const { paidToDate, remaining } = await moneyOf(proposal.id);
  const stageLabel = payment.installments.length === 0 ? "Payment" : payment.installments.length === 1 ? payment.installments[0].label : "Remaining balance";
  const ref = payment.id.slice(-8).toUpperCase();
  const org = proposal.organization;
  const { subject, html } = renderEmail(
    buildPaymentReceipt({
      org: { id: org.id, name: org.name, logoUrl: org.logoUrl, phone: org.phone },
      clientName: client?.name ?? "there",
      title: proposal.title,
      stageLabel,
      amount: payment.amount,
      method: methodPhrase(payment.provider, payment.method) || "",
      paidAt: payment.paidAt ?? payment.createdAt,
      paidToDate,
      remaining,
      href: `${await appBaseUrl()}/portal/q/${proposal.publicId}`,
      ref,
    }),
  );
  return { organizationId: payment.organizationId, proposalId: proposal.id, clientId: proposal.clientId, to: client?.email ?? null, subject, html, org };
}

/** The "order placed" letter for a proposal, with the office's own line. */
export async function orderNoticeLetter(proposalId: string, note: string | null, organizationId?: string): Promise<ClientLetter | null> {
  const proposal = await db.proposal.findFirst({
    where: { id: proposalId, ...(organizationId ? { organizationId } : {}) },
    select: { id: true, organizationId: true, title: true, publicId: true, clientId: true, client: { select: { name: true, email: true } }, organization: { select: ORG_SELECT } },
  });
  if (!proposal) return null;
  const { paidToDate, remaining } = await moneyOf(proposal.id);
  const org = proposal.organization;
  const { subject, html } = renderEmail(
    buildOrderNotice({
      org: { id: org.id, name: org.name, logoUrl: org.logoUrl, phone: org.phone },
      clientName: proposal.client?.name ?? "there",
      title: proposal.title,
      note: note?.trim().slice(0, 600) || null,
      paidToDate,
      remaining,
      href: `${await appBaseUrl()}/portal/q/${proposal.publicId}`,
      ref: proposal.id.slice(-8).toUpperCase(),
    }),
  );
  return { organizationId: proposal.organizationId, proposalId: proposal.id, clientId: proposal.clientId, to: proposal.client?.email ?? null, subject, html, org };
}

export type LetterReport = { sent: boolean; to: string | null; why: string | null };

async function sendLetter(letter: ClientLetter, log: { actorId: string | null; summary: string; meta: Record<string, unknown> }): Promise<LetterReport> {
  if (!letter.to) return { sent: false, to: null, why: "The client has no email on file — add one on the client's record." };
  try {
    await sendOrgEmail(letter.org as OrgEmailSender, { mailClass: "transactional", to: letter.to, subject: letter.subject, html: letter.html, clientId: letter.clientId, organizationId: letter.organizationId, kind: "receipt" });
  } catch (err) {
    console.warn("[clientMail] send failed", err);
    return { sent: false, to: letter.to, why: "The email didn't go out — try again in a minute." };
  }
  await db.activityEvent
    .create({
      data: {
        organizationId: letter.organizationId,
        actorId: log.actorId,
        proposalId: letter.proposalId,
        clientId: letter.clientId,
        kind: "EMAIL",
        summary: log.summary.slice(0, 500),
        meta: JSON.stringify(log.meta),
      },
    })
    .catch(() => undefined);
  return { sent: true, to: letter.to, why: null };
}

/** Email a payment's receipt (on payment, or again from the panel) and log it. */
export async function sendReceipt(paymentId: string, opts: { actorId: string | null; source: "auto" | "manual"; organizationId?: string }): Promise<LetterReport> {
  const letter = await receiptLetter(paymentId, opts.organizationId);
  if (!letter) return { sent: false, to: null, why: "That payment isn't on file any more." };
  const p = await db.payment.findUnique({ where: { id: paymentId }, select: { amount: true } });
  return sendLetter(letter, {
    actorId: opts.actorId,
    summary: `Receipt (${opts.source}) · $${(p?.amount ?? 0).toFixed(2)} — emailed to ${letter.to}`,
    meta: { receipt: paymentId, source: opts.source },
  });
}

/** Email the "order placed" notice and log it. */
export async function sendOrderNotice(proposalId: string, opts: { note: string | null; actorId: string | null; source: "auto" | "manual"; organizationId?: string }): Promise<LetterReport> {
  const letter = await orderNoticeLetter(proposalId, opts.note, opts.organizationId);
  if (!letter) return { sent: false, to: null, why: "That proposal isn't on file." };
  return sendLetter(letter, { actorId: opts.actorId, summary: `Order placed notice (${opts.source}) — emailed to ${letter.to}`, meta: { orderNotice: true, source: opts.source } });
}

/** When the order notice last went out for a proposal, or null. */
export async function orderNoticeSentAt(proposalId: string): Promise<Date | null> {
  const rows = await db.activityEvent.findMany({ where: { proposalId, kind: "EMAIL", summary: { startsWith: "Order placed notice" } }, orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } });
  return rows[0]?.createdAt ?? null;
}
