// AN INFLUENCER PROMO CODE, ON WHICHEVER STRIPE ACCOUNT THE APP IS POINTED AT.
//
// THE PROBLEM. PromoCode.stripeCouponId / .stripePromotionCodeId are minted by
// actions/influencers.ts through getStripe(), which is
// `STRIPE_SECRET_KEY || STRIPE_SECRET_KEY_TEST` — the LIVE key whenever one is
// set, with the admin's live/sandbox switch never consulted. Checkout spends
// them through getStripeClient(), which IS mode-aware. So on a deployment with
// both keys the stored ids belong to exactly one account: the live one. Stripe
// object ids are scoped per account and per mode, and passing a live `promo_…`
// to a test-mode session answers:
//
//   400 invalid_request_error · resource_missing · discounts[0][promotion_code]
//   "No such promotion code: 'promo_…'; a similar object exists in live mode,
//    but a test mode key was used to make this request."
//
// which in checkout/signup lands in the catch and returns 502 "Couldn't open
// checkout" — the visitor cannot buy anything at all. That is why both checkout
// routes simply DROPPED the discount in test mode. The diagnosis was right; the
// remedy was not. Dropping it silently reproduces, in sandbox, the exact defect
// the owner reported for live on 2026-09-02: the plan step promises "20% off ·
// $63.20" and Stripe charges $79. It also means the influencer path cannot be
// rehearsed before it runs with real money — the one thing a sandbox is for.
//
// THE FIX. Resolve the promotion-code id PER MODE, minting a test twin on first
// use and caching it in SyncState. That is the pattern this codebase already
// uses twice for exactly this reason — lib/stripePriceCache for products and
// prices, lib/referralDiscount for the referral coupon — so there is no new
// mechanism here and no schema change to approve.
//
// LIVE IS UNTOUCHED. The live branch returns the stored id under the identical
// `startsWith("promo_")` predicate the two call sites used inline, makes no
// Stripe call and writes nothing. The mint can only run under mode === "test".
//
// NO assertStripeWriteAllowed HERE. lib/stripeSafety keys off the live key being
// PRESENT, not off where a write goes, so in production with the switch on test
// it would refuse a write that lands in the sandbox. Neither stripePriceCache
// nor referralDiscount uses it either. The safety is structural: the client is
// the one getStripeClient() returned together with mode === "test".

import type Stripe from "stripe";
import { db } from "@/lib/db";
import { stripeClientForMode } from "@/lib/sdk/stripe";
import type { StripeMode } from "@/lib/stripeMode";
import { promoCouponParams } from "@/lib/promoCoupon";
import { discountMonths } from "@/lib/promoDiscount";

export interface PromoForCheckout {
  /** PromoCode.id — our row, the cache key and the metadata back-reference. */
  id: string;
  /** The redeemable string, e.g. "JAMIE20". The twin reuses it. */
  code: string;
  stripeCouponId: string;
  stripePromotionCodeId: string;
  /** Mirror of the live coupon's percent_off. */
  customerPercentOff: number | null;
  /** PAID months the discount lasts (PromoCode.customerDiscountMonths; null = 1). */
  customerDiscountMonths?: number | null;
}

/* THE MONTHS ARE IN THE KEY (owner, 2026-11-14): a twin is the live coupon's
   shape, months included, so a twin cached for other months is not this code's.
   A twin cached before the field (`stripePromo:test:<id>:promo`, one month) is
   not read: the first checkout finds its string taken and adopts it below. */
const cacheKey = (promo: Pick<PromoForCheckout, "id" | "customerDiscountMonths">, what: "coupon" | "promo") =>
  `stripePromo:test:${promo.id}:m${discountMonths(promo.customerDiscountMonths)}:${what}`;
const legacyKey = (promoId: string, what: "coupon" | "promo") => `stripePromo:test:${promoId}:${what}`;

async function readKey(key: string): Promise<string | null> {
  const row = await db.syncState.findUnique({ where: { key } }).catch(() => null);
  return row?.cursor || null;
}

async function writeKey(key: string, value: string): Promise<void> {
  await db.syncState
    .upsert({ where: { key }, update: { cursor: value }, create: { key, cursor: value } })
    .catch(() => {
      /* a cache write that fails costs one extra mint, never a failed checkout */
    });
}

/**
 * The promotion-code id valid on the account `stripe` reaches, or null when
 * this promo cannot be applied there (a `local_` synthetic from a keyless dev
 * environment, or a percent we cannot determine).
 */
export async function promotionCodeIdForMode(
  stripe: Stripe,
  mode: StripeMode,
  promo: PromoForCheckout,
): Promise<string | null> {
  // LIVE — character for character what the call sites did inline. No call, no write.
  if (mode === "live") {
    return promo.stripePromotionCodeId.startsWith("promo_") ? promo.stripePromotionCodeId : null;
  }

  // TEST, first: the stored id may already BE a test id. getStripe() falls back
  // to STRIPE_SECRET_KEY_TEST when no live key is set, so a staging deployment
  // with only a test key minted its codes on the test account — and the old
  // gate refused a discount that would have worked. One read settles it.
  if (promo.stripePromotionCodeId.startsWith("promo_")) {
    const own = await retrieveActive(stripe, promo.stripePromotionCodeId);
    if (own) return own;
  }

  const cached = await readKey(cacheKey(promo, "promo"));
  if (cached) {
    const still = await retrieveActive(stripe, cached);
    if (still) return still;
    // Wiped sandbox, or someone archived it — fall through and mint again.
  }

  const percentOff = await percentOffFor(promo);
  if (percentOff === null || percentOff <= 0) return null;

  const couponId = await ensureTestCoupon(stripe, promo, percentOff);
  if (!couponId) return null;

  let created: Stripe.PromotionCode | null = null;
  try {
    created = await stripe.promotionCodes.create({
      promotion: { type: "coupon", coupon: couponId },
      // The SAME redeemable string as live, so a code typed from an influencer's
      // post behaves identically in a rehearsal.
      code: promo.code,
      metadata: { jfKind: "influencerPromo", jfPromoCodeId: promo.id, jfCode: promo.code },
    });
  } catch {
    // The string is already taken on this account — an earlier twin whose cache
    // row was lost. Adopt it rather than fail the checkout. A twin that names
    // ANOTHER row is the code's replaced terms (actions/influencers
    // replacePromoDiscount), left on in a sandbox where the twin was never
    // switched off: switch it off and mint this row's once.
    const found = await stripe.promotionCodes
      .list({ code: promo.code, active: true, limit: 1 })
      .catch(() => null);
    const other = found?.data[0] ?? null;
    const owner = other?.metadata?.jfPromoCodeId;
    if (other && owner && owner !== promo.id) {
      await stripe.promotionCodes.update(other.id, { active: false }).catch(() => null);
      created = await stripe.promotionCodes
        .create({
          promotion: { type: "coupon", coupon: couponId },
          code: promo.code,
          metadata: { jfKind: "influencerPromo", jfPromoCodeId: promo.id, jfCode: promo.code },
        })
        .catch(() => null);
    } else {
      created = other;
    }
  }
  if (!created || !created.active) return null;

  await writeKey(cacheKey(promo, "promo"), created.id);
  return created.id;
}

async function retrieveActive(stripe: Stripe, id: string): Promise<string | null> {
  try {
    const pc = await stripe.promotionCodes.retrieve(id);
    return pc && pc.active ? pc.id : null;
  } catch {
    return null;
  }
}

async function ensureTestCoupon(
  stripe: Stripe,
  promo: PromoForCheckout,
  percentOff: number,
): Promise<string | null> {
  const key = cacheKey(promo, "coupon");
  const cached = await readKey(key);
  if (cached) {
    try {
      const c = await stripe.coupons.retrieve(cached);
      if (c && !c.deleted && c.valid) return c.id;
    } catch {
      /* gone — mint a fresh one */
    }
  }
  try {
    // THE SAME SHAPE AS LIVE (actions/influencers.ts, lib/promoCoupon): the
    // percent, repeating for the code's N paid months. `repeating` rather than
    // `once` because a trial's $0 first invoice spends a once-coupon. A twin
    // that discounted differently would make the rehearsal a lie.
    const coupon = await stripe.coupons.create(
      promoCouponParams({
        percentOff,
        months: promo.customerDiscountMonths,
        name: `TEST ${promo.code}`,
        metadata: { jfKind: "influencerPromo", jfPromoCodeId: promo.id, jfCode: promo.code },
      }),
    );
    await writeKey(key, coupon.id);
    return coupon.id;
  } catch (err) {
    console.warn(`[influencerPromoMode] could not mint a test coupon for ${promo.code}:`, err);
    return null;
  }
}

/**
 * The percent the live coupon carries. The mirror column first — it exists so
 * the signup pill can say "20% off" without a Stripe call. Only when it is null
 * (a row from before that column was filled) do we READ the live coupon, which
 * is a read: no dashboard step, no live write.
 */
async function percentOffFor(promo: PromoForCheckout): Promise<number | null> {
  if (promo.customerPercentOff && promo.customerPercentOff > 0) return promo.customerPercentOff;
  if (promo.stripeCouponId.startsWith("local_")) return null;
  const live = stripeClientForMode("live");
  if (!live) return null;
  try {
    const c = await live.coupons.retrieve(promo.stripeCouponId);
    return typeof c.percent_off === "number" ? c.percent_off : null;
  } catch {
    return null;
  }
}

/**
 * Switch the test twin off alongside the live code. Best-effort and silent, the
 * same posture actions/influencers.ts takes for the live mirror: local state is
 * the source of truth for the UI and reconciliation can repair Stripe. Without
 * this a deactivated code stays redeemable in the sandbox, which is the kind of
 * difference that makes a rehearsal worthless.
 */
export async function setTestTwinActive(promoId: string, active: boolean): Promise<void> {
  // The row's months pick its key; read them rather than guess.
  const row = await db.promoCode.findUnique({ where: { id: promoId }, select: { customerDiscountMonths: true } }).catch(() => null);
  const keys = [cacheKey({ id: promoId, customerDiscountMonths: row?.customerDiscountMonths }, "promo"), legacyKey(promoId, "promo")];
  const test = stripeClientForMode("test");
  if (!test) return;
  for (const key of keys) {
    const twin = await readKey(key);
    if (!twin) continue;
    try {
      await test.promotionCodes.update(twin, { active });
    } catch {
      /* best effort */
    }
  }
}
