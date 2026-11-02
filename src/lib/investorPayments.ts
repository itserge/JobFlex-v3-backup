import "server-only";
// WHAT CUSTOMERS HAVE PAID (owner, 2026-10-17; back 2026-10-24: "show the current paying stats against what was
// spent") — the money Stripe took for JobFlex subscriptions since the investors' start day: paid subscription
// invoices on the platform's own account, for the accounts the page counts (hidden and test accounts out), by the
// day each was paid. Shown beside the list-price revenue as what actually came in. Read at most every ten minutes
// per instance; a failure or a slow answer is "not read", said so on the page — never a guess.
//
// WHAT WENT BACK (owner, 2026-11-02: "they got paid, and after a week they got refunded — do you track those from
// Stripe?"): Stripe keeps a refunded invoice "paid" with its amount_paid untouched, so the refunds (done or on the
// way) and the chargebacks lost since the start day are read beside the invoices, matched on the payment they went
// back on, and each invoice carries what of it went back. A lead or a minute pack refunded names no invoice and
// is left out, as its charge is.
import type Stripe from "stripe";
import { getStripeClient, isStripeEnabled } from "@/lib/sdk/stripe";
import { invoicePaymentKeys, invoiceSubscriptionId, refId } from "@/lib/stripeCompat";

/** One paid invoice: the day it was paid (the page's zone), what was taken, what of it went back since, and from
 *  whom (Stripe's customer id). */
export interface PaymentIn {
  date: string;
  cents: number;
  /** Refunded, or lost to a chargeback — at most `cents`. */
  refundedCents: number;
  customer: string;
}

export type PaymentRead = { ok: true; payments: PaymentIn[] } | { ok: false; error: string };

const FRESH_MS = 10 * 60_000;
/** A failed read is retried after a minute, not on every page view. */
const RETRY_MS = 60_000;
const WAIT_MS = 8_000;
const MAX_PAGES = 30;
let kept: { key: string; at: number; value: PaymentRead } | null = null;

/** Every page of one of Stripe's lists, up to MAX_PAGES. */
async function everyPage<T extends { id: string }>(page: (after: string | undefined) => Promise<Stripe.ApiList<T>>): Promise<T[]> {
  const out: T[] = [];
  let after: string | undefined;
  for (let n = 0; n < MAX_PAGES; n++) {
    const res = await page(after);
    out.push(...res.data);
    if (!res.has_more || res.data.length === 0) break;
    after = res.data.at(-1)?.id;
  }
  return out;
}

export async function readSubscriptionPayments(sinceMs: number, customers: ReadonlySet<string>, dayOf: (ms: number) => string): Promise<PaymentRead> {
  if (!isStripeEnabled()) return { ok: false, error: "Stripe is not connected on this deployment." };
  if (customers.size === 0) return { ok: true, payments: [] };
  const key = `${sinceMs}|${[...customers].sort().join(",")}`;
  if (kept && kept.key === key && Date.now() - kept.at < (kept.value.ok ? FRESH_MS : RETRY_MS)) return kept.value;
  const read = async (): Promise<PaymentRead> => {
    const { stripe } = await getStripeClient();
    const created = { gte: Math.floor(sinceMs / 1000) };
    const from = (after: string | undefined) => (after ? { starting_after: after } : {});
    const [invoices, refunds, disputes] = await Promise.all([
      everyPage((after) => stripe.invoices.list({ status: "paid", created, limit: 100, expand: ["data.payments"], ...from(after) })),
      everyPage((after) => stripe.refunds.list({ created, limit: 100, ...from(after) })),
      everyPage((after) => stripe.disputes.list({ created, limit: 100, ...from(after) })),
    ]);
    // What went back, under each payment it names (its charge, its PaymentIntent) — once per refund or dispute.
    const back = new Map<string, Map<string, number>>();
    const wentBack = (id: string, cents: number, ...on: unknown[]) => {
      for (const k of on.map((v) => refId(v))) if (k) back.set(k, (back.get(k) ?? new Map()).set(id, cents));
    };
    for (const r of refunds) if (r.status === "succeeded" || r.status === "pending") wentBack(r.id, r.amount, r.charge, r.payment_intent);
    for (const d of disputes) if (d.status === "lost") wentBack(d.id, d.amount, d.charge, d.payment_intent);
    const out: PaymentIn[] = [];
    for (const inv of invoices) {
      const customer = typeof inv.customer === "string" ? inv.customer : inv.customer?.id;
      if (!customer || !customers.has(customer) || !invoiceSubscriptionId(inv)) continue;
      if ((inv.currency ?? "usd").toLowerCase() !== "usd" || !(inv.amount_paid > 0)) continue;
      const mine = new Map<string, number>();
      for (const k of invoicePaymentKeys(inv)) for (const [id, cents] of back.get(k) ?? []) mine.set(id, cents);
      const refunded = Math.min(inv.amount_paid, [...mine.values()].reduce((a, c) => a + c, 0));
      out.push({ date: dayOf((inv.status_transitions?.paid_at ?? inv.created) * 1000), cents: inv.amount_paid, refundedCents: refunded, customer });
    }
    return { ok: true, payments: out };
  };
  let value: PaymentRead;
  try {
    value = await Promise.race([read(), new Promise<PaymentRead>((resolve) => setTimeout(() => resolve({ ok: false, error: "Stripe took too long to answer." }), WAIT_MS))]);
  } catch (err) {
    value = { ok: false, error: err instanceof Error ? `Stripe: ${err.message.slice(0, 140)}` : "Stripe did not answer." };
  }
  kept = { key, at: Date.now(), value };
  return value;
}
