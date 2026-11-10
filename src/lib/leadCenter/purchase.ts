// PAID LEADS (2026-10-02) — a Lead Center lead an admin put a price on opens
// only when the shop pays for it.
//
// THE RULE. A priced offer carries city, trade and scope and no contacts. The
// shop's Accept is a payment: the card the organization keeps on file in
// Stripe, charged off-session on the PLATFORM account after a "Charge $45 to
// Visa •4242?" confirmation; Stripe Checkout (mode=payment) when there is no
// card, when the bank asks for 3-D Secure, or when the card is declined. The
// contacts open on the FACT of payment and nothing else:
//   · the PaymentIntent's own synchronous "succeeded" (card on file),
//   · checkout.session.completed / payment_intent.succeeded at the webhook,
//   · the Checkout session read back from Stripe on the return page — the
//     same fact, asked for directly, because the live endpoint never sees a
//     sandbox payment and a webhook can arrive after the shop is back.
// All of them land in completeLeadPurchase, which is idempotent per offer.
//
// NO DOUBLE CHARGE. The off-session PaymentIntent and the Checkout session are
// created with idempotency keys derived from the offer and its price: a double
// click or a retry returns the first answer from Stripe, never a second
// charge. A second, DIFFERENT payment for an offer already unlocked (two
// people paying through two routes at once) is refunded automatically, and so
// is a payment for a lead that went to another shop before the money arrived.
//
// WHERE IT IS RECORDED — no migration (production does not push the schema):
//   · LeadOffer.priceCents / unlockedAt — the price asked, the moment paid;
//   · PlatformLead.priceCents — the price every offer of the lead carries;
//   · SyncState `leadPurchase:<offerId>` — the payment: PaymentIntent id,
//     amount, date, organization, payer, mode, and a refund when one is made;
//   · JobExpense, purpose LEAD, category "Lead purchase" — the contractor's
//     own books (Financials), APPROVED at once, REJECTED if JobFlex refunds.
//
// NO REFUNDS by policy: the paid lead's card says "Contact not real? Contact
// support". A platform admin can refund from the Lead Center with a reason;
// that goes to Stripe, to the record and to the organization's activity log.
import "server-only";
import type Stripe from "stripe";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { getStripeClient, stripeClientForMode } from "@/lib/sdk/stripe";
import type { StripeMode } from "@/lib/stripeMode";
import { assertStripeWriteAllowed } from "@/lib/stripeSafety";
import { refId } from "@/lib/stripeCompat";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { ExpensePaidBy, ExpenseStatus } from "@/lib/prismaEnums";
import { acceptOfferTx, afterOfferAccepted, OfferUnavailableError } from "./accept";
import { CARD_ONLY_CHECKOUT } from "@/lib/stripeCheckoutCard";

/** `metadata.jf_purpose` on every PaymentIntent and Checkout session made here. */
export const LEAD_PURPOSE = "lead-purchase";
/** The expense purpose the contractor's Financials files a lead under. */
export const LEAD_EXPENSE_PURPOSE = "LEAD";
export const LEAD_EXPENSE_CATEGORY = "Lead purchase";

/** An admin's price, in cents: $1 – $1,000. Stripe's floor is $0.50. */
export const MIN_LEAD_PRICE_CENTS = 100;
export const MAX_LEAD_PRICE_CENTS = 100_000;

export function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

export interface LeadPurchase {
  offerId: string;
  platformLeadId: string;
  organizationId: string;
  /** The org Lead the payment opened; null only while the record is being written. */
  leadId: string | null;
  payerUserId: string | null;
  amountCents: number;
  currency: string;
  paymentIntentId: string;
  checkoutSessionId: string | null;
  mode: StripeMode;
  via: "card-on-file" | "checkout";
  paidAt: string;
  receiptEmail: string | null;
  expenseId: string | null;
  refund: {
    refundId: string;
    amountCents: number;
    reason: string;
    /** The admin who made it; null when the app refunded on its own. */
    adminId: string | null;
    at: string;
  } | null;
}

const recordKey = (offerId: string) => `leadPurchase:${offerId}`;

export async function readPurchase(offerId: string): Promise<LeadPurchase | null> {
  const row = await db.syncState.findUnique({ where: { key: recordKey(offerId) } });
  return parseRecord(row?.cursor);
}

function parseRecord(raw: string | null | undefined): LeadPurchase | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as LeadPurchase;
    return v && typeof v.paymentIntentId === "string" ? v : null;
  } catch {
    return null;
  }
}

async function writeRecord(rec: LeadPurchase): Promise<void> {
  await db.syncState.update({ where: { key: recordKey(rec.offerId) }, data: { cursor: JSON.stringify(rec) } });
}

/** Every payment for these platform leads, keyed by platform lead (admin ledger). */
export async function purchasesByPlatformLead(platformLeadIds: string[]): Promise<Map<string, LeadPurchase>> {
  const out = new Map<string, LeadPurchase>();
  if (!platformLeadIds.length) return out;
  const wanted = new Set(platformLeadIds);
  const rows = await db.syncState.findMany({ where: { key: { startsWith: "leadPurchase:" } } });
  for (const r of rows) {
    const rec = parseRecord(r.cursor);
    if (rec && wanted.has(rec.platformLeadId) && rec.leadId) out.set(rec.platformLeadId, rec);
  }
  return out;
}

// ── the card on file ────────────────────────────────────────────────────────

export interface CardOnFile {
  customerId: string;
  paymentMethodId: string;
  brand: string;
  last4: string;
}

const BRAND: Record<string, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "Amex",
  discover: "Discover",
  diners: "Diners",
  jcb: "JCB",
  unionpay: "UnionPay",
};
export function brandLabel(brand: string): string {
  return BRAND[brand] ?? brand.charAt(0).toUpperCase() + brand.slice(1);
}

/** The organization's Stripe customer — the one its subscription bills. */
async function customerIdFor(organizationId: string): Promise<{ customerId: string | null; subId: string | null }> {
  const sub = await db.subscription.findUnique({
    where: { organizationId },
    select: { provider: true, externalCustomerId: true, externalSubId: true },
  });
  if (!sub || sub.provider !== "STRIPE") return { customerId: null, subId: null };
  return { customerId: sub.externalCustomerId, subId: sub.externalSubId };
}

function asCard(pm: Stripe.PaymentMethod | string | null | undefined): Stripe.PaymentMethod | null {
  return pm && typeof pm !== "string" && pm.type === "card" && pm.card ? pm : null;
}

/**
 * The default card: the customer's invoice default, else the subscription's.
 * Null when there is none — a card-less trial, a customer from the other mode
 * (a live customer is not in the sandbox), or Stripe unreachable — and the
 * purchase goes to Checkout.
 */
export async function cardOnFile(stripe: Stripe, organizationId: string): Promise<CardOnFile | null> {
  const { customerId, subId } = await customerIdFor(organizationId);
  if (!customerId) return null;
  try {
    const c = await stripe.customers.retrieve(customerId, { expand: ["invoice_settings.default_payment_method"] });
    if ("deleted" in c && c.deleted) return null;
    let pm = asCard((c as Stripe.Customer).invoice_settings?.default_payment_method);
    if (!pm && subId) {
      const sub = await stripe.subscriptions.retrieve(subId, { expand: ["default_payment_method"] });
      pm = asCard(sub.default_payment_method);
    }
    if (!pm?.card) return null;
    return { customerId, paymentMethodId: pm.id, brand: pm.card.brand, last4: pm.card.last4 };
  } catch {
    return null;
  }
}

// ── starting a purchase ─────────────────────────────────────────────────────

export type PurchaseStep =
  | { kind: "free" }
  | { kind: "unlocked"; leadId: string }
  | { kind: "confirm"; amountCents: number; brand: string; last4: string }
  | { kind: "checkout"; url: string; reason?: string };

export interface Buyer {
  organizationId: string;
  userId: string;
  email: string | null;
}

async function loadPricedOffer(buyer: Buyer, offerId: string) {
  const offer = await db.leadOffer.findUnique({ where: { id: offerId }, include: { platformLead: true } });
  if (!offer || offer.organizationId !== buyer.organizationId) throw new OfferUnavailableError();
  return offer;
}
type PricedOffer = Awaited<ReturnType<typeof loadPricedOffer>>;

/** Already paid → the lead; free → null; not open → throws. */
async function gate(offer: PricedOffer): Promise<PurchaseStep | null> {
  const prior = await readPurchase(offer.id);
  if (prior?.leadId) return { kind: "unlocked", leadId: prior.leadId };
  if (!offer.priceCents || offer.priceCents <= 0) return { kind: "free" };
  if (offer.status !== "OFFERED" || offer.expiresAt <= new Date()) throw new OfferUnavailableError();
  return null;
}

function purchaseMetadata(offer: PricedOffer, buyer: Buyer, via: LeadPurchase["via"]): Record<string, string> {
  return {
    jf_purpose: LEAD_PURPOSE,
    jf_via: via,
    offerId: offer.id,
    platformLeadId: offer.platformLeadId,
    organizationId: buyer.organizationId,
    userId: buyer.userId,
    priceCents: String(offer.priceCents ?? 0),
  };
}

function describe(offer: PricedOffer): string {
  const pl = offer.platformLead;
  const where = [pl.city, pl.state].filter(Boolean).join(", ") || pl.zip || "";
  return ["JobFlex lead", pl.detectedTrade ?? pl.projectType ?? "project", where].filter(Boolean).join(" · ");
}

/** What the shop's Accept does next: confirm a card, go to Checkout, or nothing to pay. */
export async function startPurchase(buyer: Buyer, offerId: string, baseUrl: string): Promise<PurchaseStep> {
  const offer = await loadPricedOffer(buyer, offerId);
  const early = await gate(offer);
  if (early) return early;
  const { stripe } = await getStripeClient();
  const card = await cardOnFile(stripe, buyer.organizationId);
  if (card) return { kind: "confirm", amountCents: offer.priceCents!, brand: brandLabel(card.brand), last4: card.last4 };
  return { kind: "checkout", url: await checkoutUrl(stripe, offer, buyer, null, baseUrl) };
}

/** Stripe Checkout, mode=payment — one session per offer, price, payer and host. */
async function checkoutUrl(
  stripe: Stripe,
  offer: PricedOffer,
  buyer: Buyer,
  customerId: string | null,
  baseUrl: string,
): Promise<string> {
  const amount = offer.priceCents!;
  const cust = customerId ?? (await customerIdFor(buyer.organizationId)).customerId;
  const metadata = purchaseMetadata(offer, buyer, "checkout");
  // Checkout sessions live 30 minutes to 24 hours. Ending with the offer is
  // the honest window; a shorter remainder keeps Stripe's default, and a
  // payment that clears after the offer lapsed is still honoured if nobody
  // else took the lead (acceptOfferTx allowLapsed). The value is fixed per
  // offer, so a retry sends the same parameters under the same key.
  const until = Math.floor(offer.expiresAt.getTime() / 1000);
  const nowS = Math.floor(Date.now() / 1000);
  const expiresAt = until - nowS > 35 * 60 && until - nowS < 23.5 * 3600 ? until : undefined;
  const params: Stripe.Checkout.SessionCreateParams = {
    mode: "payment",
    // Cards only: the lead opens the moment the payment is final, and a bank
    // debit or a pay-later method settles days later (a different event).
    ...CARD_ONLY_CHECKOUT,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: amount,
          product_data: {
            name: describe(offer),
            description: "The homeowner's contact details for a JobFlex Lead Center lead.",
          },
        },
      },
    ],
    ...(cust ? { customer: cust } : buyer.email ? { customer_email: buyer.email } : {}),
    payment_intent_data: {
      description: describe(offer),
      metadata,
      ...(buyer.email ? { receipt_email: buyer.email } : {}),
    },
    metadata,
    client_reference_id: offer.id,
    success_url: `${baseUrl}/dashboard/leads?lead_paid=${encodeURIComponent(offer.id)}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/dashboard/leads?lead_checkout=cancelled`,
    ...(expiresAt ? { expires_at: expiresAt } : {}),
  };
  const salt = createHash("sha256").update([buyer.userId, cust ?? "", baseUrl, expiresAt ?? ""].join("|")).digest("hex").slice(0, 16);
  const session = await withIdempotencyRetry(() =>
    stripe.checkout.sessions.create(params, { idempotencyKey: `jf-lead-checkout-${offer.id}-${amount}-${salt}` }),
  );
  if (!session.url) throw new Error("Stripe did not return a checkout page.");
  return session.url;
}

/** A second request under the same key while the first is still in flight is
 *  answered 409 by Stripe; once the first lands, the replay is its answer. */
async function withIdempotencyRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err) {
      const e = err as { type?: string; code?: string };
      const inFlight = e?.type === "StripeIdempotencyError" || e?.code === "idempotency_key_in_use";
      if (!inFlight || i >= 4) throw err;
      await new Promise((r) => setTimeout(r, 700 * (i + 1)));
    }
  }
}

/**
 * "Charge $45 to Visa •4242" — the off-session PaymentIntent. Succeeded opens
 * the lead at once; 3-D Secure or a decline sends the shop to Checkout.
 */
export async function chargeCardOnFile(buyer: Buyer, offerId: string, baseUrl: string): Promise<PurchaseStep> {
  const offer = await loadPricedOffer(buyer, offerId);
  const early = await gate(offer);
  if (early) return early;
  const { stripe, mode } = await getStripeClient();
  const card = await cardOnFile(stripe, buyer.organizationId);
  if (!card) return { kind: "checkout", url: await checkoutUrl(stripe, offer, buyer, null, baseUrl) };

  const amount = offer.priceCents!;
  let pi: Stripe.PaymentIntent | null = null;
  let reason = "";
  try {
    pi = await withIdempotencyRetry(() =>
      stripe.paymentIntents.create(
        {
          amount,
          currency: "usd",
          customer: card.customerId,
          payment_method: card.paymentMethodId,
          off_session: true,
          confirm: true,
          description: describe(offer),
          metadata: purchaseMetadata(offer, buyer, "card-on-file"),
          ...(buyer.email ? { receipt_email: buyer.email } : {}),
        },
        // One charge per offer and price, whoever clicks and however often.
        { idempotencyKey: `jf-lead-pi-${offer.id}-${amount}` },
      ),
    );
  } catch (err) {
    const e = err as { type?: string; code?: string; message?: string; raw?: { payment_intent?: { id?: string } } };
    if (e?.type !== "StripeCardError") throw err;
    reason =
      e.code === "authentication_required"
        ? "Your bank wants to confirm this payment — finish it on Stripe's page."
        : "The card on file was declined — pay on Stripe's page with another card.";
    await cancelQuietly(stripe, e.raw?.payment_intent?.id);
  }

  if (pi?.status === "succeeded") {
    const done = await completeLeadPurchase({
      offerId: offer.id,
      paymentIntentId: pi.id,
      amountCents: pi.amount_received || pi.amount,
      currency: pi.currency,
      mode,
      checkoutSessionId: null,
      payerUserId: buyer.userId,
      receiptEmail: buyer.email,
      via: "card-on-file",
    });
    if (done.leadId) return { kind: "unlocked", leadId: done.leadId };
    throw new OfferUnavailableError();
  }
  if (pi) {
    // requires_action (3-D Secure) — never confirmed here; Checkout asks for it.
    reason ||= "Your bank wants to confirm this payment — finish it on Stripe's page.";
    await cancelQuietly(stripe, pi.id);
  }
  return { kind: "checkout", url: await checkoutUrl(stripe, offer, buyer, card.customerId, baseUrl), reason };
}

async function cancelQuietly(stripe: Stripe, id: string | null | undefined) {
  if (!id) return;
  await stripe.paymentIntents.cancel(id).catch(() => {});
}

// ── the fact of payment ────────────────────────────────────────────────────

export interface PaymentFact {
  offerId: string;
  paymentIntentId: string;
  amountCents: number;
  currency: string;
  mode: StripeMode;
  checkoutSessionId: string | null;
  payerUserId: string | null;
  receiptEmail: string | null;
  via: LeadPurchase["via"];
}

export type CompleteResult =
  | { leadId: string; status: "unlocked" | "already" }
  | { leadId: null; status: "refunded" | "unknown-offer" };

/**
 * The money has arrived: open the lead. Idempotent per offer — the sync
 * answer, the return page and two webhook events may all call it.
 */
export async function completeLeadPurchase(fact: PaymentFact): Promise<CompleteResult> {
  const offer = await db.leadOffer.findUnique({ where: { id: fact.offerId }, include: { platformLead: true } });
  if (!offer) return { leadId: null, status: "unknown-offer" };

  const prior = await readPurchase(fact.offerId);
  if (prior) return settlePrior(prior, fact);

  const payer = fact.payerUserId
    ? await db.user.findUnique({ where: { id: fact.payerUserId }, select: { id: true, email: true } })
    : null;
  const base: LeadPurchase = {
    offerId: offer.id,
    platformLeadId: offer.platformLeadId,
    organizationId: offer.organizationId,
    leadId: null,
    payerUserId: payer?.id ?? null,
    amountCents: fact.amountCents,
    currency: fact.currency,
    paymentIntentId: fact.paymentIntentId,
    checkoutSessionId: fact.checkoutSessionId,
    mode: fact.mode,
    via: fact.via,
    paidAt: new Date().toISOString(),
    receiptEmail: fact.receiptEmail ?? payer?.email ?? null,
    expenseId: null,
    refund: null,
  };
  // The claim: one record per offer, made first. A concurrent completion for
  // the same offer loses on the key and settles against the winner's record.
  try {
    await db.syncState.create({ data: { key: recordKey(offer.id), cursor: JSON.stringify(base) } });
  } catch {
    const winner = await readPurchase(offer.id);
    if (winner) return settlePrior(winner, fact);
    throw new Error("Could not record the lead payment.");
  }

  const now = new Date();
  const pl = offer.platformLead;
  try {
    const { leadId, expenseId } = await db.$transaction(async (tx) => {
      const { leadId } = await acceptOfferTx(tx, {
        offerId: offer.id,
        organizationId: offer.organizationId,
        userId: payer?.id ?? null,
        now,
        unlock: true,
        allowLapsed: true,
      });
      const where = [pl.city, pl.state].filter(Boolean).join(", ");
      const expense = await tx.jobExpense.create({
        data: {
          organizationId: offer.organizationId,
          jobId: null,
          category: LEAD_EXPENSE_CATEGORY,
          amount: fact.amountCents / 100,
          note: [`${pl.name} · ${pl.detectedTrade ?? pl.projectType ?? "project"}`, where, `Stripe ${fact.paymentIntentId}`]
            .filter(Boolean)
            .join(" · "),
          vendor: "JobFlex",
          paidBy: ExpensePaidBy.COMPANY,
          status: ExpenseStatus.APPROVED,
          purpose: LEAD_EXPENSE_PURPOSE,
          submittedById: payer?.id ?? null,
          spentAt: now,
        },
      });
      return { leadId, expenseId: expense.id };
    });
    await writeRecord({ ...base, leadId, expenseId, paidAt: now.toISOString() });
    await afterOfferAccepted({
      organizationId: offer.organizationId,
      userId: payer?.id ?? null,
      leadId,
      platformLeadId: offer.platformLeadId,
      paidCents: fact.amountCents,
    });
    return { leadId, status: "unlocked" };
  } catch (err) {
    if (!(err instanceof OfferUnavailableError)) {
      // Unknown failure: let the claim go so a retry (Stripe resends the
      // webhook on a 500) can try again from the top.
      await db.syncState.delete({ where: { key: recordKey(offer.id) } }).catch(() => {});
      throw err;
    }
    // Paid for a lead another shop holds — nothing to hand over, so the money
    // goes back. A refund that fails lets the claim go too: the webhook's
    // retry must find no record and try the refund again.
    let refund: LeadPurchase["refund"];
    try {
      refund = await refundPayment(fact.mode, fact.paymentIntentId, "the lead went to another shop before the payment arrived", null);
    } catch (refundErr) {
      await db.syncState.delete({ where: { key: recordKey(offer.id) } }).catch(() => {});
      throw refundErr;
    }
    await writeRecord({ ...base, refund });
    return { leadId: null, status: "refunded" };
  }
}

async function settlePrior(prior: LeadPurchase, fact: PaymentFact): Promise<CompleteResult> {
  if (prior.paymentIntentId === fact.paymentIntentId) {
    // The same payment, being written right now by the other delivery (a
    // double click's twin, the webhook racing the sync answer): wait for it.
    let rec: LeadPurchase | null = prior;
    for (let i = 0; rec && !rec.leadId && !rec.refund && i < 20; i++) {
      await new Promise((r) => setTimeout(r, 250));
      rec = await readPurchase(fact.offerId);
    }
    if (rec?.leadId) return { leadId: rec.leadId, status: "already" };
    if (rec?.refund) return { leadId: null, status: "refunded" };
    throw new Error("The payment is still being recorded — refresh in a moment.");
  }
  // A second, different payment for an offer already paid: give it back. The
  // second payment is not recorded beyond the log line — the first one stands.
  await refundPayment(fact.mode, fact.paymentIntentId, "a second payment for a lead already paid for", null).catch((err) =>
    console.error(`[lead-purchase] duplicate payment ${fact.paymentIntentId} for offer ${fact.offerId} NOT refunded:`, err),
  );
  console.warn(`[lead-purchase] duplicate payment ${fact.paymentIntentId} for offer ${fact.offerId} refunded`);
  return prior.leadId ? { leadId: prior.leadId, status: "already" } : { leadId: null, status: "refunded" };
}

async function refundPayment(
  mode: StripeMode,
  paymentIntentId: string,
  reason: string,
  adminId: string | null,
): Promise<NonNullable<LeadPurchase["refund"]>> {
  const stripe = stripeClientForMode(mode);
  if (!stripe) throw new Error(`Stripe ${mode} mode is not configured`);
  const refund = await stripe.refunds.create(
    {
      payment_intent: paymentIntentId,
      reason: "requested_by_customer",
      metadata: { jf_purpose: LEAD_PURPOSE, note: reason.slice(0, 450), ...(adminId ? { adminId } : {}) },
    },
    { idempotencyKey: `jf-lead-refund-${paymentIntentId}` },
  );
  return {
    refundId: refund.id,
    amountCents: refund.amount,
    reason,
    adminId,
    at: new Date().toISOString(),
  };
}

// ── the three ways the fact arrives ────────────────────────────────────────

/** checkout.session.completed (webhook) — false when the session is not ours. */
export async function completeFromCheckoutSession(session: Stripe.Checkout.Session): Promise<boolean> {
  if (session.metadata?.jf_purpose !== LEAD_PURPOSE) return false;
  const offerId = session.metadata.offerId;
  const pi = refId(session.payment_intent);
  if (!offerId || !pi || session.payment_status !== "paid") return true;
  await completeLeadPurchase({
    offerId,
    paymentIntentId: pi,
    amountCents: session.amount_total ?? 0,
    currency: session.currency ?? "usd",
    mode: session.livemode ? "live" : "test",
    checkoutSessionId: session.id,
    payerUserId: session.metadata.userId ?? null,
    receiptEmail: session.customer_details?.email ?? null,
    via: "checkout",
  });
  return true;
}

/** payment_intent.succeeded (webhook) — the backstop for a card-on-file charge
 *  whose synchronous answer never got written. False when not ours. */
export async function completeFromPaymentIntent(pi: Stripe.PaymentIntent): Promise<boolean> {
  if (pi.metadata?.jf_purpose !== LEAD_PURPOSE) return false;
  const offerId = pi.metadata.offerId;
  if (!offerId || pi.status !== "succeeded") return true;
  await completeLeadPurchase({
    offerId,
    paymentIntentId: pi.id,
    amountCents: pi.amount_received || pi.amount,
    currency: pi.currency,
    mode: pi.livemode ? "live" : "test",
    checkoutSessionId: null,
    payerUserId: pi.metadata.userId ?? null,
    receiptEmail: pi.receipt_email ?? null,
    via: pi.metadata.jf_via === "checkout" ? "checkout" : "card-on-file",
  });
  return true;
}

/**
 * The return page: read the Checkout session back from Stripe. Only the
 * shop's own session counts (organizationId in its metadata).
 */
export async function finishCheckoutReturn(
  organizationId: string,
  sessionId: string,
): Promise<{ status: "unlocked" | "pending" | "refunded" | "invalid"; leadId?: string }> {
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return { status: "invalid" };
  const { stripe } = await getStripeClient();
  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch {
    return { status: "invalid" };
  }
  if (session.metadata?.jf_purpose !== LEAD_PURPOSE || session.metadata.organizationId !== organizationId) {
    return { status: "invalid" };
  }
  if (session.payment_status !== "paid") return { status: "pending" };
  const pi = refId(session.payment_intent);
  if (!pi || !session.metadata.offerId) return { status: "invalid" };
  const done = await completeLeadPurchase({
    offerId: session.metadata.offerId,
    paymentIntentId: pi,
    amountCents: session.amount_total ?? 0,
    currency: session.currency ?? "usd",
    mode: session.livemode ? "live" : "test",
    checkoutSessionId: session.id,
    payerUserId: session.metadata.userId ?? null,
    receiptEmail: session.customer_details?.email ?? null,
    via: "checkout",
  });
  return done.leadId ? { status: "unlocked", leadId: done.leadId } : { status: "refunded" };
}

// ── the admin's refund ─────────────────────────────────────────────────────

export async function adminRefund(
  offerId: string,
  reason: string,
  admin: { id: string; email?: string | null },
): Promise<LeadPurchase> {
  const rec = await readPurchase(offerId);
  if (!rec || !rec.leadId) throw new Error("No payment for this lead.");
  if (rec.refund) throw new Error("This payment was already refunded.");
  if (rec.mode === "live") assertStripeWriteAllowed("refund a lead payment");
  const refund = await refundPayment(rec.mode, rec.paymentIntentId, reason, admin.id);
  const next: LeadPurchase = { ...rec, refund };
  await writeRecord(next);
  // The contractor's books: the expense stops counting, with the reason on it.
  if (rec.expenseId) {
    await db.jobExpense
      .updateMany({
        where: { id: rec.expenseId },
        data: { status: ExpenseStatus.REJECTED, rejectReason: `Refunded by JobFlex — ${reason}`.slice(0, 500), reviewedAt: new Date() },
      })
      .catch(() => {});
  }
  await logActivity({
    organizationId: rec.organizationId,
    // A platform admin is not a member of the shop: named in meta, not as actor.
    actorId: null,
    kind: TRAIL_KINDS.PAY,
    summary: `JobFlex refunded ${dollars(refund.amountCents)} for a Lead Center lead — ${reason}`,
    leadId: rec.leadId,
    meta: {
      area: "lead purchase",
      offerId,
      paymentIntentId: rec.paymentIntentId,
      refundId: refund.refundId,
      adminId: admin.id,
      adminEmail: admin.email ?? null,
    },
  });
  return next;
}
