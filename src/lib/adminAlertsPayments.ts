import "server-only";
// PAYMENT ALERT TEXTS — the Stripe webhook's half of lib/adminAlerts (owner, 2026-10-17:
// "text when payment got charged in Stripe or failed").
//
//   Payments         every charge that lands on JobFlex's Stripe: a plan invoice paid
//                    (invoice.paid, $0 trial invoices skipped), a Lead Center lead, an AI
//                    desk minute pack (checkout.session.completed or payment_intent.succeeded
//                    — both arrive for one charge, the payment intent's id makes it one text).
//   Failed payments  a plan charge Stripe could not take (invoice.payment_failed), told on
//                    the FIRST failed try and on the LAST one (no retry left: the plan
//                    closes) — the retries in between say nothing new. Only real missed
//                    bills: the webhook already skips a declined plan change and an old
//                    failure delivered after the invoice was paid.
//
// Every text is claimed once per charge / per try (SyncState), so a redelivered event is
// silent. The decline reason is asked of Stripe best-effort with a short budget; without
// it the text still goes. A test-mode event says so in the text.
import type Stripe from "stripe";
import { db } from "@/lib/db";
import { invoiceSubscriptionId, refId } from "@/lib/stripeCompat";
import { getPlanDisplayName } from "@/lib/planCatalogServer";
import { admin, fireAdminAlert, short } from "@/lib/adminAlerts";
import { disputeClosedText, disputeOpenedKey, disputeOpenedText, type DisputeInfo } from "@/lib/disputeWords";

const LEAD_PURPOSE = "lead-purchase";
const PACK_PURPOSE = "desk-pack";

function money(cents: number, currency = "usd"): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
  } catch {
    return `$${(cents / 100).toFixed(2)}`;
  }
}

const day = (unix: number) => new Date(unix * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Los_Angeles" });
const testMark = (live: boolean | null | undefined) => (live === false ? " [TEST MODE]" : "");

/** Whose invoice this is: the subscription's mirror first, then the customer's. */
async function invoiceOwner(invoice: Stripe.Invoice): Promise<{ orgName: string; plan: string | null }> {
  const subId = invoiceSubscriptionId(invoice);
  const customerId = refId(invoice.customer);
  const mirror =
    (subId ? await db.subscription.findFirst({ where: { externalSubId: subId }, select: { organizationId: true, plan: true } }).catch(() => null) : null) ??
    (customerId ? await db.subscription.findFirst({ where: { externalCustomerId: customerId }, select: { organizationId: true, plan: true } }).catch(() => null) : null);
  const org = mirror ? await db.organization.findUnique({ where: { id: mirror.organizationId }, select: { name: true } }).catch(() => null) : null;
  const fallback = invoice.customer_name || invoice.customer_email || "A customer";
  return { orgName: org?.name ?? fallback, plan: mirror?.plan ?? null };
}

async function planWords(slug: string | null): Promise<string | null> {
  if (!slug) return null;
  return getPlanDisplayName(slug).catch(() => slug);
}

const REASON_WORDS: Record<string, string> = {
  subscription_create: "first charge",
  subscription_cycle: "renewal",
  subscription_update: "plan change",
  subscription_threshold: "usage",
  manual: "invoice",
};

/** Why the card was declined, in the bank's words — best effort, three seconds at most. */
async function declineWords(invoice: Stripe.Invoice, stripe: Stripe | null): Promise<string | null> {
  if (!stripe || !invoice.id) return null;
  const id = invoice.id;
  const ask = (async () => {
    // The API version decides where the attempt lives: the old invoice.charge /
    // invoice.payment_intent, or the newer invoice payments list.
    const old = invoice as unknown as { charge?: unknown; payment_intent?: unknown };
    const legacyCharge = refId(old.charge);
    if (legacyCharge) {
      const c = await stripe.charges.retrieve(legacyCharge);
      return c.failure_message || c.outcome?.seller_message || null;
    }
    const legacyPi = refId(old.payment_intent);
    if (legacyPi) {
      const e = (await stripe.paymentIntents.retrieve(legacyPi)).last_payment_error;
      return e ? e.message || e.decline_code || e.code || null : null;
    }
    type PaymentRow = { payment?: { payment_intent?: unknown } };
    const ip = (stripe as unknown as { invoicePayments?: { list: (q: Record<string, unknown>) => Promise<{ data: PaymentRow[] }> } }).invoicePayments;
    if (!ip) return null;
    const list = await ip.list({ invoice: id, limit: 3, expand: ["data.payment.payment_intent"] });
    for (const row of list.data) {
      const pi = row.payment?.payment_intent as Stripe.PaymentIntent | string | undefined;
      if (pi && typeof pi === "object" && pi.last_payment_error) {
        const e = pi.last_payment_error;
        return e.message || e.decline_code || e.code || null;
      }
    }
    return null;
  })();
  const timeout = new Promise<null>((r) => setTimeout(() => r(null), 3000));
  try {
    const words = await Promise.race([ask, timeout]);
    return words ? short(words.replace(/\.$/, ""), 70) : null;
  } catch {
    return null;
  }
}

/** invoice.paid — a plan charge went through. */
export async function alertInvoicePaid(invoice: Stripe.Invoice, livemode: boolean): Promise<void> {
  const cents = invoice.amount_paid ?? 0;
  if (cents <= 0 || !invoice.id) return; // a trial's $0 invoice is not a payment
  const { orgName, plan } = await invoiceOwner(invoice);
  const planName = await planWords(plan);
  const why = REASON_WORDS[invoice.billing_reason ?? ""] ?? null;
  const tries = invoice.attempt_count ?? 1;
  const bits = [planName, why].filter(Boolean).join(" · ");
  const recovered = tries > 1 ? ` — went through on try ${tries} after a decline` : "";
  await fireAdminAlert(
    "paid",
    `JobFlex: payment received — ${money(cents, invoice.currency)} from ${short(orgName)}${bits ? ` (${bits})` : ""}${recovered}.${testMark(livemode)} ${await admin("/admin/revenue")}`,
    `paid:inv:${invoice.id}`,
  );
}

/** invoice.payment_failed, after the webhook decided it is a real missed bill. */
export async function alertInvoiceFailed(invoice: Stripe.Invoice, livemode: boolean, stripe: Stripe | null): Promise<void> {
  const cents = invoice.amount_due ?? 0;
  if (cents <= 0 || !invoice.id) return;
  const final = !invoice.next_payment_attempt;
  const tries = invoice.attempt_count ?? 1;
  if (!final && tries > 1) return; // the retries in between: nothing new to say
  const [{ orgName, plan }, reason] = await Promise.all([invoiceOwner(invoice), declineWords(invoice, stripe)]);
  const planName = await planWords(plan);
  const head = final ? "LAST payment try FAILED" : "payment FAILED";
  const next = final
    ? " Stripe has stopped retrying — the plan closes."
    : invoice.next_payment_attempt
      ? ` Stripe tries again ${day(invoice.next_payment_attempt)}; the owner got the update-your-card email.`
      : "";
  await fireAdminAlert(
    "failed",
    `JobFlex: ${head} — ${money(cents, invoice.currency)} from ${short(orgName)}${planName ? ` (${planName})` : ""}${reason ? `: ${reason}` : ""}.${next}${testMark(livemode)} ${await admin("/admin/subscribers")}`,
    `failed:inv:${invoice.id}:${final ? "final" : "first"}`,
  );
}

/** A one-time charge — a Lead Center lead or an AI desk minute pack — that went through.
 *  Fed by both checkout.session.completed and payment_intent.succeeded; the payment
 *  intent's id makes it one text. */
export async function alertOneTimeCharge(info: {
  paymentIntentId: string | null;
  purpose: string | null | undefined;
  organizationId: string | null | undefined;
  cents: number;
  currency: string | null | undefined;
  livemode: boolean;
}): Promise<void> {
  if (!info.paymentIntentId || info.cents <= 0) return;
  const what = info.purpose === LEAD_PURPOSE ? "Lead Center lead" : info.purpose === PACK_PURPOSE ? "AI desk minutes" : null;
  if (!what) return; // not one of JobFlex's own one-time purchases
  const org = info.organizationId ? await db.organization.findUnique({ where: { id: info.organizationId }, select: { name: true } }).catch(() => null) : null;
  await fireAdminAlert(
    "paid",
    `JobFlex: payment received — ${money(info.cents, info.currency ?? "usd")} from ${short(org?.name ?? "A company")} (${what}).${testMark(info.livemode)} ${await admin("/admin/revenue")}`,
    `paid:pi:${info.paymentIntentId}`,
  );
}

/** Whose charge a dispute is about: the charge's customer → the subscription mirror → the company. Best effort, three
 *  seconds at most (the dispute carries only the charge's id); without it the text still goes. */
async function disputeOwner(dispute: Stripe.Dispute, stripe: Stripe | null): Promise<{ orgName: string; plan: string | null }> {
  const ask = (async () => {
    const chargeId = refId(dispute.charge);
    if (!stripe || !chargeId) return null;
    const charge = await stripe.charges.retrieve(chargeId);
    const customerId = refId(charge.customer);
    const mirror = customerId ? await db.subscription.findFirst({ where: { externalCustomerId: customerId }, select: { organizationId: true, plan: true } }).catch(() => null) : null;
    const org = mirror ? await db.organization.findUnique({ where: { id: mirror.organizationId }, select: { name: true } }).catch(() => null) : null;
    return { orgName: org?.name ?? charge.billing_details?.name ?? charge.billing_details?.email ?? charge.receipt_email ?? null, plan: mirror?.plan ?? null };
  })();
  const timeout = new Promise<null>((r) => setTimeout(() => r(null), 3000));
  try {
    const found = await Promise.race([ask, timeout]);
    return { orgName: found?.orgName ?? "A customer", plan: found?.plan ? await planWords(found.plan) : null };
  } catch {
    return { orgName: "A customer", plan: null };
  }
}

async function disputeInfo(dispute: Stripe.Dispute, livemode: boolean, stripe: Stripe | null): Promise<DisputeInfo> {
  const { orgName, plan } = await disputeOwner(dispute, stripe);
  return {
    id: dispute.id,
    orgName: short(orgName),
    plan,
    cents: dispute.amount ?? 0,
    currency: dispute.currency ?? "usd",
    reason: dispute.reason ?? "general",
    status: dispute.status ?? "needs_response",
    dueBy: dispute.evidence_details?.due_by ?? null,
    livemode,
    adminUrl: await admin("/admin/subscribers"),
  };
}

/** charge.dispute.created / funds_withdrawn — a company took a JobFlex charge to its bank (owner, 2026-10-29): the
 *  inquiry, and the chargeback (an escalated inquiry included), one text each. */
export async function alertDisputeOpened(dispute: Stripe.Dispute, livemode: boolean, stripe: Stripe | null): Promise<void> {
  const once = dispute.id ? disputeOpenedKey(dispute.id, dispute.status ?? "needs_response") : null;
  if (!once) return;
  await fireAdminAlert("dispute", disputeOpenedText(await disputeInfo(dispute, livemode, stripe)), once);
}

/** charge.dispute.closed — won, lost, or the inquiry closed. */
export async function alertDisputeClosed(dispute: Stripe.Dispute, livemode: boolean, stripe: Stripe | null): Promise<void> {
  if (!dispute.id) return;
  const feeCents = (dispute.balance_transactions ?? []).reduce((n, b) => n + (b.fee ?? 0), 0);
  await fireAdminAlert("dispute", disputeClosedText({ ...(await disputeInfo(dispute, livemode, stripe)), feeCents }), `dispute:closed:${dispute.id}`);
}
