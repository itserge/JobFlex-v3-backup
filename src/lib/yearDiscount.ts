// THE FIRST-MONTH CODE ON A YEARLY BILL, AT STRIPE (owner, 2026-10-12).
//
// A partner's percent code and the member-referral coupon are percent-off
// coupons for the first month. On a yearly price Stripe applies that percent
// to the whole year. So a yearly checkout carries, instead, a fixed-amount
// coupon worth the percent of ONE month of the plan (lib/firstMonthDiscount),
// `repeating` for the same months as the percent coupon (a trial's $0 invoice
// must not spend it). A partner's coupon carries the PromoCode row's id in its
// metadata, which is how the attribution and the commission still find their
// partner (lib/stripeSync resolvePromoCode). Reused per amount, not minted per
// checkout.
//
// A CODE FOR N MONTHS (owner, 2026-11-14): the amount is the percent of N
// months of the monthly price, N up to 12 (lib/firstMonthDiscount yearOffCents)
// — one discount on the one yearly invoice, never more than a year's worth.
import type Stripe from "stripe";
import { db } from "@/lib/db";
import type { StripeMode } from "@/lib/stripeMode";
import { yearOffCents } from "@/lib/firstMonthDiscount";
import { yearDiscountMonths } from "@/lib/promoDiscount";

export async function ensureYearFirstMonthCoupon(
  stripe: Stripe,
  mode: StripeMode,
  o: {
    kind: "promo" | "referral";
    pct: number;
    /** One month of the plan being bought (custom: its pages' monthly price). */
    monthlyCents: number;
    months: number;
    /** A partner code's discount months (PromoCode.customerDiscountMonths): N months' worth, up to 12. The referral is one. */
    periodMonths?: number | null;
    /** The partner's PromoCode row (kind "promo"). */
    promoCodeId?: string;
    code?: string;
  },
): Promise<string | null> {
  const n = yearDiscountMonths(o.periodMonths);
  const amount = yearOffCents(o.monthlyCents, o.pct, n);
  if (amount <= 0) return null;
  // One month keeps the key every coupon minted before the field was cached under.
  const key = `stripeCoupon:${mode}:${o.kind}-year:${o.promoCodeId ?? "ref"}:${amount}:m${o.months}${n > 1 ? `:n${n}` : ""}`;
  const cached = await db.syncState.findUnique({ where: { key } }).catch(() => null);
  if (cached?.cursor) {
    const c = await stripe.coupons.retrieve(cached.cursor).catch(() => null);
    if (c && !c.deleted && c.valid) return c.id;
  }
  const coupon = await stripe.coupons.create({
    amount_off: amount,
    currency: "usd",
    duration: "repeating",
    duration_in_months: o.months,
    // Stripe caps a coupon's name at 40 characters; it is what the invoice prints.
    name: (o.kind === "promo"
      ? `${o.code ?? "Partner code"} · ${o.pct}% of ${n === 1 ? "a month" : `${n} months`}`
      : `JobFlex referral · ${o.pct}% of a month`).slice(0, 40),
    metadata: {
      jfKind: o.kind === "promo" ? "promo-year" : "referral",
      pct: String(o.pct),
      monthlyCents: String(o.monthlyCents),
      ...(o.kind === "promo" ? { discountMonths: String(n) } : {}),
      ...(o.promoCodeId ? { jfPromoCodeId: o.promoCodeId } : {}),
    },
  });
  await db.syncState.upsert({ where: { key }, update: { cursor: coupon.id }, create: { key, cursor: coupon.id } }).catch(() => {});
  return coupon.id;
}

/** A partner code's percent: the catalog mirror, else the Stripe coupon behind the promotion code. */
export async function promoPercentOff(stripe: Stripe, promotionCodeId: string | null, mirror: number | null | undefined): Promise<number | null> {
  if (mirror) return mirror;
  if (!promotionCodeId) return null;
  try {
    const pc = await stripe.promotionCodes.retrieve(promotionCodeId);
    const ref = (pc as unknown as { promotion?: { coupon?: string | Stripe.Coupon | null }; coupon?: string | Stripe.Coupon | null });
    const raw = ref.promotion?.coupon ?? ref.coupon ?? null;
    const coupon = typeof raw === "string" ? await stripe.coupons.retrieve(raw) : raw;
    return coupon?.percent_off ?? null;
  } catch {
    return null;
  }
}
