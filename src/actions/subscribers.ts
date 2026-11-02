"use server";
import type Stripe from "stripe";
import { requirePlatformAdmin } from "@/lib/orgContext";
import { getStripe, isStripeEnabled } from "@/lib/sdk/stripe";
import { discountRef, subscriptionPeriodEndDate } from "@/lib/stripeCompat";
import { readSubscribersData, subscriptionDiscount, type SubscribersData } from "@/lib/subscribersRead";

// The rows: lib/subscribersRead (the read, unguarded — guarded here); the MRR rule: billing-metrics.
export type { SubscriberRow, SubscribersData } from "@/lib/subscribersRead";

/** `cards`: also read how each subscription pays (the Card column on
 *  /admin/subscribers). Off for the pages that only need the billing figures —
 *  it widens the Stripe read and may add a round of payment-method lookups. */
export async function getSubscribersData(opts: { cards?: boolean } = {}): Promise<SubscribersData> {
  await requirePlatformAdmin();
  return readSubscribersData(opts);
}

// Live Stripe status for one subscriber's subscription — powers the row detail
// sheet's "verified through Stripe" confirmation (not assumed from the record).
// `found: false` is its own answer: Stripe replied and holds no such
// subscription, which is not the same as Stripe failing to reply.
export type SubscriberStripeStatus =
  | { found: false }
  | {
      found: true;
      status: string;
      paused: boolean;
      currentPeriodEnd: string | null;
      cancelAtPeriodEnd: boolean;
      promotionCode: string | null;
      couponId: string | null;
    };

export async function getSubscriberStripeStatus(
  externalSubId: string,
): Promise<SubscriberStripeStatus | null> {
  await requirePlatformAdmin();
  if (!isStripeEnabled() || !externalSubId) return null;
  const stripe = getStripe();
  let sub: Stripe.Subscription;
  try {
    sub = await stripe.subscriptions.retrieve(externalSubId, { expand: ["discounts"] });
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (code === "resource_missing") return { found: false };
    throw err;
  }
  const discount = discountRef(subscriptionDiscount(sub));
  return {
    found: true,
    status: sub.status,
    paused: Boolean(sub.pause_collection),
    currentPeriodEnd: subscriptionPeriodEndDate(sub)?.toISOString() ?? null,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    promotionCode: discount?.promotionCodeId ?? null,
    couponId: discount?.couponId ?? null,
  };
}
