// THE STRIPE COUPON BEHIND A PARTNER CODE — ONE SHAPE, WHEREVER IT IS MINTED.
//
// Three places mint one: the code itself (actions/influencers provisionStripePromo),
// its replacement (replacePromoDiscount), and the sandbox twin of a live code
// (lib/influencerPromoMode). All three read the shape from here, so a rehearsal
// in test mode discounts exactly as live does.
//
// `repeating`, not `once` or `forever`. Stripe counts a repeating coupon's months
// from the day it lands on the subscription — the first day of the trial — and
// discounts every invoice raised before they run out. With a 7-day trial the
// paid invoices fall on day 7, 7 + 1 month, …, so N months cover exactly N of
// them and the (N+1)th is full price. A trial of 28 days or more pushes the
// first paid invoice past month one and needs one month more: the correction
// the member referral already makes (lib/referralDiscount referralCouponMonths),
// applied the same way at any N.
//
// The trial a code is minted for is the sign-up's offer in force
// (lib/trialOffer, seven days since 2026-10-11): the coupon is minted once, with
// the code, and every sign-up of that offer shares it.
import type Stripe from "stripe";
import { referralCouponMonths } from "@/lib/referralDiscount";
import { storedTrialOffer } from "@/lib/trialOffer";
import { discountMonths } from "@/lib/promoDiscount";

/** duration_in_months for a code that discounts `months` PAID invoices after a `trialDays` trial. */
export function promoCouponMonths(months: number | null | undefined, trialDays: number = storedTrialOffer().days): number {
  return discountMonths(months) - 1 + referralCouponMonths(trialDays);
}

/** The coupon parameters for a partner code: its percent, for its months. */
export function promoCouponParams(o: {
  percentOff: number;
  months: number | null | undefined;
  name: string;
  metadata?: Record<string, string>;
}): Stripe.CouponCreateParams {
  const months = discountMonths(o.months);
  return {
    percent_off: o.percentOff,
    duration: "repeating",
    duration_in_months: promoCouponMonths(months),
    // Stripe caps a coupon's name at 40 characters; it is what the invoice prints.
    name: o.name.slice(0, 40),
    metadata: { discountMonths: String(months), ...(o.metadata ?? {}) },
  };
}
