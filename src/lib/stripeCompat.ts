// Readers for the Stripe fields that moved between API versions.
//
/* THE CLOVER TRANSITION (2026-10-01). The SDK and the webhook endpoints move
 * from 2024-06-20 to 2025-11-17.clover. Two releases of breaking changes sit
 * between them (2025-03-31.basil, 2025-09-30.clover), and every field below
 * vanished WITHOUT an error: a removed field reads as undefined, so the old
 * code skipped every paid invoice as "not paid" and wrote null over every
 * renewal date.
 *
 * For the length of the transition an event can arrive in either shape — a
 * resend of an event created under the old version keeps its old payload, and
 * an endpoint can be on either version — so each reader takes the OLD field
 * when the payload carries it and the new location otherwise. When every
 * endpoint has been on clover for longer than Stripe keeps events (30 days),
 * the legacy branches can go.
 *
 *   old (2024-06-20)                 new (clover)
 *   invoice.paid                     invoice.status === "paid"
 *   invoice.subscription             invoice.parent.subscription_details.subscription
 *   invoice.charge                   invoice payments (InvoicePayment → PaymentIntent → latest_charge)
 *   charge.invoice                   an InvoicePayment for the charge's PaymentIntent
 *   subscription.current_period_*    subscription.items.data[].current_period_*
 *   subscription.discount            subscription.discounts[] (ids unless expanded)
 *   discount.coupon (expanded)       discount.source.coupon (an id unless expanded)
 *   line_item.proration              line_item.parent.*_details.proration
 */

import type Stripe from "stripe";

type Ref = string | { id: string } | null | undefined;

export function refId(v: Ref | unknown): string | null {
  if (!v) return null;
  if (typeof v === "string") return v;
  const id = (v as { id?: unknown }).id;
  return typeof id === "string" ? id : null;
}

/** The fields an old-version payload still carries. */
type LegacyCoupon = { id: string; metadata?: Record<string, string> | null };
type LegacyDiscount = { promotion_code?: Ref; coupon?: LegacyCoupon | null; source?: { coupon?: string | Stripe.Coupon | null } };
type LegacySubscription = {
  current_period_start?: number | null;
  current_period_end?: number | null;
  discount?: LegacyDiscount | null;
};
type LegacyInvoice = { paid?: boolean; subscription?: Ref; charge?: Ref };
type LegacyCharge = { invoice?: Ref };
type LegacyLine = { proration?: boolean };

const legacy = <T>(o: unknown) => o as T;

// ── subscription ───────────────────────────────────────

/** The current period's end (unix seconds): the old top-level field, else the
 *  latest end among the items — a single-price subscription has one item. */
export function subscriptionPeriodEnd(sub: Stripe.Subscription): number | null {
  const old = legacy<LegacySubscription>(sub).current_period_end;
  if (typeof old === "number") return old;
  const ends = (sub.items?.data ?? []).map((i) => i.current_period_end).filter((n): n is number => typeof n === "number");
  return ends.length ? Math.max(...ends) : null;
}

/** The current period's start (unix seconds). */
export function subscriptionPeriodStart(sub: Stripe.Subscription): number | null {
  const old = legacy<LegacySubscription>(sub).current_period_start;
  if (typeof old === "number") return old;
  const starts = (sub.items?.data ?? []).map((i) => i.current_period_start).filter((n): n is number => typeof n === "number");
  return starts.length ? Math.min(...starts) : null;
}

export function subscriptionPeriodEndDate(sub: Stripe.Subscription): Date | null {
  const s = subscriptionPeriodEnd(sub);
  return s ? new Date(s * 1000) : null;
}

/** A discount reduced to what our lookups use. */
export type DiscountRef = {
  promotionCodeId: string | null;
  couponId: string | null;
  /** Present only when the coupon object itself was in the payload. */
  couponMetadata: Record<string, string> | null;
};

export function discountRef(d: Stripe.Discount | LegacyDiscount | null | undefined): DiscountRef | null {
  if (!d) return null;
  const l = d as LegacyDiscount;
  const coupon = l.coupon ?? l.source?.coupon ?? null;
  return {
    promotionCodeId: refId(l.promotion_code),
    couponId: refId(coupon),
    couponMetadata: coupon && typeof coupon === "object" ? (coupon.metadata ?? null) : null,
  };
}

/**
 * The subscription's discounts. The old payload's single `discount` when it
 * carries one; else `discounts`, which clover sends as ids — those are
 * expanded with one retrieve when a client is given. Without a client an
 * unexpanded list reads as no discount, so every production caller passes one.
 */
export async function subscriptionDiscounts(sub: Stripe.Subscription, stripe?: Stripe | null): Promise<DiscountRef[]> {
  const old = legacy<LegacySubscription>(sub).discount;
  if (old) return [discountRef(old)!];
  let list: Array<string | Stripe.Discount> = sub.discounts ?? [];
  if (list.some((d) => typeof d === "string") && stripe && sub.id) {
    const full = await stripe.subscriptions.retrieve(sub.id, { expand: ["discounts"] });
    list = full.discounts ?? [];
  }
  return list.filter((d): d is Stripe.Discount => typeof d === "object" && d !== null).map((d) => discountRef(d)!);
}

// ── invoice ────────────────────────────────────────────

/** Paid in full: the old boolean when present, else the status. */
export function invoiceIsPaid(inv: Stripe.Invoice): boolean {
  const old = legacy<LegacyInvoice>(inv).paid;
  if (typeof old === "boolean") return old;
  return inv.status === "paid";
}

/** The subscription that billed this invoice. */
export function invoiceSubscriptionId(inv: Stripe.Invoice): string | null {
  const old = refId(legacy<LegacyInvoice>(inv).subscription);
  if (old) return old;
  return refId(inv.parent?.subscription_details?.subscription);
}

function chargeOfPayments(payments: Stripe.InvoicePayment[]): { chargeId: string | null; pendingIntent: string | null } {
  const paid = payments.filter((p) => p.status === "paid");
  for (const p of paid.length ? paid : payments) {
    if (p.payment.type === "charge") return { chargeId: refId(p.payment.charge), pendingIntent: null };
    if (p.payment.type === "payment_intent") {
      const pi = p.payment.payment_intent;
      if (pi && typeof pi === "object") return { chargeId: refId(pi.latest_charge), pendingIntent: null };
      if (typeof pi === "string") return { chargeId: null, pendingIntent: pi };
    }
  }
  return { chargeId: null, pendingIntent: null };
}

/**
 * The charge that paid this invoice — the key refunds and disputes are matched
 * on. The old `charge` field when the payload has it (null included: an old
 * unpaid invoice has no charge, and that needs no lookup). Otherwise the
 * invoice's payments: from the payload if expanded, else listed with the client.
 */
export async function invoiceChargeId(inv: Stripe.Invoice, stripe?: Stripe | null): Promise<string | null> {
  const l = legacy<LegacyInvoice>(inv);
  if (l.charge !== undefined) return refId(l.charge);
  let found = inv.payments?.data?.length ? chargeOfPayments(inv.payments.data) : null;
  if (!found?.chargeId && !found?.pendingIntent) {
    if (!stripe || !inv.id || (inv.amount_paid ?? 0) <= 0) return null;
    const list = await stripe.invoicePayments.list({
      invoice: inv.id,
      limit: 10,
      expand: ["data.payment.payment_intent"],
    });
    found = chargeOfPayments(list.data);
  }
  if (found.chargeId) return found.chargeId;
  if (found.pendingIntent && stripe) {
    const pi = await stripe.paymentIntents.retrieve(found.pendingIntent);
    return refId(pi.latest_charge);
  }
  return null;
}

/**
 * Every payment this invoice names — charge and PaymentIntent ids — with no
 * lookup: the old `charge` / `payment_intent` fields when the payload has
 * them, and the invoice's payments when expanded (`expand: ["payments"]`).
 * The keys a refund or a dispute of the invoice is matched on: each of those
 * names its charge and, when it has one, its PaymentIntent.
 */
export function invoicePaymentKeys(inv: Stripe.Invoice): string[] {
  const l = legacy<LegacyInvoice & { payment_intent?: Ref }>(inv);
  const keys = [refId(l.charge), refId(l.payment_intent)];
  for (const p of inv.payments?.data ?? []) keys.push(refId(p.payment?.charge), refId(p.payment?.payment_intent));
  return [...new Set(keys.filter((k): k is string => !!k))];
}

// ── charge ─────────────────────────────────────────────

/**
 * Whether a charge pays an invoice. The old `charge.invoice` when present;
 * else whether an InvoicePayment points at the charge's PaymentIntent. When
 * that cannot be asked, the answer is yes: the only use is parking a refund
 * that outran its accrual, and a parked row nothing consumes is inert.
 */
export async function chargeIsInvoiceBacked(charge: Stripe.Charge, stripe?: Stripe | null): Promise<boolean> {
  const l = legacy<LegacyCharge>(charge);
  if (l.invoice !== undefined) return Boolean(refId(l.invoice));
  const pi = refId(charge.payment_intent);
  if (!pi) return false;
  if (!stripe) return true;
  try {
    const list = await stripe.invoicePayments.list({ payment: { type: "payment_intent", payment_intent: pi }, limit: 1 });
    return list.data.length > 0;
  } catch {
    return true;
  }
}

// ── invoice line ───────────────────────────────────────

/** A proration line: the old flag, else the parent's details. */
export function lineIsProration(line: Stripe.InvoiceLineItem): boolean {
  const old = legacy<LegacyLine>(line).proration;
  if (typeof old === "boolean") return old;
  return Boolean(line.parent?.subscription_item_details?.proration ?? line.parent?.invoice_item_details?.proration);
}
