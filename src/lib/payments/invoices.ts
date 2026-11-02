// Sending an INVOICE for one stage on the rail the office chose — the
// SmartSpace Pro pattern, on JobFlex's own rails: "card" hands the client to
// the hosted checkout (Stripe / Square / Stax, whichever the org has on), "bank"
// mails the org's transfer instructions and shows only those on the portal,
// "any" lets the client pick. The link carries the choice (?pay=&method=),
// the stage is stamped, and an activity line records what went where.
import { db } from "@/lib/db";
import { appBaseUrl } from "@/lib/appUrl";
import { renderEmail } from "@/lib/email/renderEmail";
import { buildInvoice } from "@/lib/email/build/client";
import { noteGmailFallback, sendOrgEmail } from "@/lib/email/orgSend";
import { isTwilioEnabled } from "@/lib/sdk/twilio";
import { sendText } from "@/lib/sms/send";
import { toE164 } from "@/lib/phone";
import { fromMinor, resolveSchedule } from "@/lib/paymentSchedule";
import { contractSchedule, contractTotal } from "@/lib/contractTotal";
import { ensureSchedule } from "@/lib/payments/settle";
import { parsePaymentSettings } from "@/lib/settings";
import { getConnections } from "@/lib/payments/connections";
import { getStripeMode } from "@/lib/stripeMode";
import { resolvePayOptions } from "@/lib/payments/payOptions";
import { recordInvoiceSent } from "@/lib/payments/invoiceRecord";
import { trackActivation } from "@/lib/activation-events";
import { trialBlocksText } from "@/lib/trialMeter";

export type InvoiceMethod = "card" | "bank" | "any";

export interface InvoiceOptions {
  /** A hosted card checkout is on (Stripe, Square or Stax). */
  card: boolean;
  /** Bank-transfer instructions are set in Settings → Payments. */
  bank: boolean;
  cardVia: string[];
}

export async function invoiceOptionsFor(organizationId: string, currency = "USD"): Promise<InvoiceOptions> {
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { paymentSettingsJson: true } });
  const [conns, mode] = await Promise.all([getConnections(organizationId), getStripeMode()]);
  const options = resolvePayOptions({
    settings: parsePaymentSettings(org?.paymentSettingsJson),
    stripeConn: conns.stripe,
    squareConn: conns.square,
    staxConn: conns.stax,
    proposalCurrency: currency,
    stripeMode: mode,
  });
  const cardVia = [options.stripe.ok ? "Stripe" : null, options.square.ok ? "Square" : null, options.stax.ok ? "Stax" : null].filter((v): v is string => !!v);
  return { card: options.anyHosted, bank: options.bankTransfer.ok, cardVia };
}

export interface InvoiceReport {
  ok: boolean;
  error?: string;
  email: "sent" | "no-email" | "failed";
  sms: "sent" | "no-phone" | "failed" | "disabled";
  label: string;
  amount: number;
  href: string | null;
  /** The number of the row this send wrote into the invoice book. Absent only
   *  when the send failed, or when the bookkeeping write itself did. */
  number?: string;
}

/** The rail the client will pay on, in the Invoices tab's vocabulary. */
function invoiceProvider(method: InvoiceMethod, opts: InvoiceOptions): string {
  if (method === "bank" || !opts.cardVia.length) return "MANUAL";
  return opts.cardVia[0].toUpperCase();
}

/** A stage carries its own due date. Anything else is due on the org's terms
 *  — "Net 14" in Settings → Payments — rather than on an invented one. */
function netTermsDue(netTerms: string): Date {
  const parsed = Number(/(\d+)/.exec(netTerms ?? "")?.[1]);
  const days = Number.isFinite(parsed) && parsed > 0 && parsed <= 180 ? parsed : 14;
  const due = new Date();
  due.setDate(due.getDate() + days);
  return due;
}

/** `actorId`: the member who pressed Send, so the trail carries their name; null when a cron or the system sent it. */
export async function sendInvoice(input: { proposalId: string; installmentId: string | null; method: InvoiceMethod; organizationId: string; actorId?: string | null }): Promise<InvoiceReport> {
  const fail = (error: string): InvoiceReport => ({ ok: false, error, email: "no-email", sms: "no-phone", label: "", amount: 0, href: null });
  const proposal = await db.proposal.findFirst({
    where: { id: input.proposalId, organizationId: input.organizationId },
    include: {
      client: true,
      organization: { select: { id: true, name: true, billingEmail: true, gmailSettingsJson: true, gmailTokensJson: true, logoUrl: true, phone: true, paymentSettingsJson: true } },
      installments: { orderBy: { position: "asc" } },
      changeOrders: { where: { status: "APPROVED" }, select: { status: true, total: true } },
    },
  });
  if (!proposal) return fail("Not found");
  if (!proposal.client?.email && !toE164(proposal.client?.phone)) return fail("The client has no email or phone on file.");
  const settings = parsePaymentSettings(proposal.organization.paymentSettingsJson);
  const opts = await invoiceOptionsFor(proposal.organizationId, proposal.currency);
  if (input.method === "card" && !opts.card) return fail("No card processor is connected (Settings → Integrations / Payments).");
  if (input.method === "bank" && !opts.bank) return fail("Bank-transfer instructions aren't set (Settings → Integrations / Payments).");

  const installments = proposal.installments.length ? proposal.installments : await ensureSchedule(proposal.id);
  const schedule = resolveSchedule({ ...contractSchedule(proposal.total, proposal.changeOrders), currency: proposal.currency, installments });
  if (schedule.remainingMinor <= 0) return fail("Nothing is owed on this proposal.");
  const stageRow = input.installmentId ? installments.find((i) => i.id === input.installmentId) ?? null : null;
  if (input.installmentId && !stageRow) return fail("That stage no longer exists.");
  const stage = stageRow ? schedule.stages.find((s) => s.id === stageRow.id) ?? null : null;
  if (stageRow && (stage?.status === "PAID" || stage?.status === "WAIVED")) return fail("That stage is already paid.");
  const amount = stage ? fromMinor(stage.amountMinor) : fromMinor(schedule.remainingMinor);
  if (amount <= 0) return fail("That stage has nothing to collect right now.");
  const label = stageRow?.label ?? (schedule.unpaidCount > 1 ? "Remaining balance" : "Payment");

  const appUrl = await appBaseUrl();
  const params = new URLSearchParams();
  if (stageRow) params.set("pay", stageRow.id);
  params.set("method", input.method);
  const href = `${appUrl}/portal/q/${proposal.publicId}?${params.toString()}`;
  const org = proposal.organization;
  const report: InvoiceReport = { ok: true, email: "no-email", sms: "no-phone", label, amount, href };

  if (proposal.client?.email) {
    try {
      const { subject, html } = renderEmail(
        buildInvoice({
          org: { name: org.name, logoUrl: org.logoUrl, phone: org.phone },
          clientName: proposal.client.name,
          title: proposal.title,
          label,
          amount,
          dueDate: stageRow?.dueDate ?? null,
          agreedTotal: contractTotal(proposal.total, proposal.changeOrders),
          paidToDate: fromMinor(schedule.paidMinor),
          href,
          method: input.method,
          bankInstructions: input.method === "bank" ? settings.bankTransferInstructions : null,
        }),
      );
      const sent = await sendOrgEmail(org, { to: proposal.client.email, subject, html });
      report.email = "sent";
      await noteGmailFallback(sent, { organizationId: org.id, proposalId: proposal.id, clientId: proposal.clientId, what: "The invoice email" });
    } catch (err) {
      console.warn("[invoices] email failed:", err);
      report.email = "failed";
    }
  }
  const phone = toE164(proposal.client?.phone);
  if (phone) {
    if (!await isTwilioEnabled()) report.sms = "disabled";
    // The card-less trial sends no texts (lib/trialMeter); the email went.
    else if (await trialBlocksText(proposal.organizationId, "invoice")) report.sms = "disabled";
    else {
      try {
        const how = input.method === "bank" ? "Bank-transfer details are in your email." : input.method === "card" ? "Pay by card here:" : "Pay here:";
        // From the company's own number to a client who said yes (lib/sms/send, 2026-10-02).
        const sent = await sendText({ organizationId: proposal.organizationId, to: phone, body: `${org.name}: invoice for ${label.toLowerCase()} on ${proposal.title} — $${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}. ${how} ${href}`, kind: "invoice" });
        report.sms = !sent.ok ? "failed" : sent.status === "SKIPPED" ? "disabled" : "sent";
      } catch (err) {
        console.warn("[invoices] sms failed:", err);
        report.sms = "failed";
      }
    }
  }
  const sent = report.email === "sent" || report.sms === "sent";
  if (!sent) return { ...report, ok: false, error: "Nothing could be sent — no working email or phone." };
  // It reached the client by at least one channel. The method is the label; never the amount.
  trackActivation("invoice_sent", proposal.organizationId, { method: input.method, by_email: report.email === "sent", by_sms: report.sms === "sent" });
  if (stageRow) {
    await db.installment.update({ where: { id: stageRow.id }, data: { invoiceMethod: input.method, invoiceSentAt: new Date() } }).catch(() => {});
  }
  await db.activityEvent.create({
    data: {
      organizationId: proposal.organizationId,
      actorId: input.actorId ?? null,
      proposalId: proposal.id,
      clientId: proposal.clientId ?? null,
      kind: "EMAIL",
      summary: `Invoice (${input.method}) · ${label} · $${amount.toFixed(2)} — email ${report.email}, text ${report.sms}`,
      meta: JSON.stringify({ amount, method: input.method, installmentId: stageRow?.id ?? null }),
    },
  });
  // The book. An invoice that went out is a row in the Invoices tab, not just
  // a stamp on the stage — but the money is already asked for by this point,
  // so a bookkeeping failure is logged, never raised at the sender.
  try {
    // What this invoice bills: the one stage named, or every stage the balance
    // covers. The book keys on those ids, so a later invoice over the same
    // stages replaces this claim instead of billing the money twice.
    const billed = stageRow
      ? [stageRow.id]
      : schedule.stages
          .filter((s) => !s.synthetic && (s.status === "UNPAID" || s.status === "PENDING"))
          .map((s) => s.id);
    report.number = await recordInvoiceSent({
      organizationId: proposal.organizationId,
      proposalId: proposal.id,
      clientId: proposal.clientId,
      stageIds: billed,
      stages: schedule.stages,
      amount,
      provider: invoiceProvider(input.method, opts),
      dueDate: stageRow?.dueDate ?? netTermsDue(settings.netTerms),
    });
  } catch (err) {
    console.warn("[invoices] could not write the invoice row:", err);
  }
  return report;
}
