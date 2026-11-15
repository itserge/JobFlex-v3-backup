// WHAT A SIGNUP IS BILLED: the Stripe price for the plan picked on the plan
// step, and the discount its stored code earns. Both signup paths read this:
// the card checkout (/api/checkout/signup, TRIAL_REQUIRES_CARD=true) and the
// card-less trial (lib/cardlessTrial). Moved here from the checkout route
// unchanged (2026-10-01), so the two can never price the same plan apart.
//
// Everything is read from the pending intent and the catalog — never from a
// request body, so a doctored request cannot name its own price.
import "server-only";
import type Stripe from "stripe";
import { db } from "@/lib/db";
import { getPlanBySlug } from "@/lib/planCatalogServer";
import { CUSTOM_PLAN_SLUG, customPriceCents } from "@/lib/customPlan";
import { storedTrialOffer, type TrialOffer } from "@/lib/trialOffer";
import { ensureRecurringPrice } from "@/lib/stripePriceCache";
import { customLineItems } from "@/lib/customBilling";
import { validateAttribution } from "@/lib/attribution";
import { promotionCodeIdForMode } from "@/lib/influencerPromoMode";
import { REFERRAL_DISCOUNT_PCT, ensureReferralCoupon, referralCouponMonths } from "@/lib/referralDiscount";
import { ensureYearFirstMonthCoupon, promoPercentOff } from "@/lib/yearDiscount";
import type { StripeMode } from "@/lib/stripeMode";
import { toolsPlansOn } from "@/lib/toolPlans/server";
import { readToolCatalog } from "@/lib/toolPlans/prices";
import { toolsCheckoutItems } from "@/lib/toolPlans/billing";
import { toolsBuild, toolsSignupPick } from "@/lib/toolPlans/cards";
import { isToolsSlug, toolPlanById, YEAR_MONTHS, type ToolId } from "@/lib/toolPlans/shared";

export type SignupInterval = "MONTH" | "YEAR";

export type SignupPrice =
  | {
      ok: true;
      /** The subscription's lines: one price for a catalog plan; the custom
       *  plan's base + page × quantity (lib/customBilling). */
      lineItems: { price: string; quantity: number }[];
      /** The signup's saved trial offer, shared across plans and billing intervals. */
      trialDays: number;
      /** The slug recorded on the session / subscription metadata. */
      planLabel: string;
      isCustom: boolean;
      /** What the plan costs per interval, in cents. */
      cents: number;
      /** The term actually billed — MONTH for a plan with no yearly price,
       *  whatever was asked (owner, 2026-10-12). */
      interval: SignupInterval;
      /** One month of the plan, in cents: what a first-month code is a
       *  percent of on a yearly bill (lib/firstMonthDiscount). */
      monthlyCents: number;
      /** The new plans only: the main tool billed with the size (null: none). Absent on a Classic plan. */
      mainTool?: ToolId | null;
      /** The new plans only: the other tools ticked in the builder, each a line riding the trial. */
      extraTools?: ToolId[];
    }
  | { ok: false; status: number; error: string };

/**
 * THE CUSTOM PLAN has no catalog row and no Stripe price: its amount is the
 * base plus the pages the shop ticked, priced from the selection stored with
 * the pending intent. A REUSED price, not inline price_data: inline data mints
 * a fresh Product+Price per checkout and would litter the Stripe dashboard with
 * a product per signup. The custom price space is tiny ($20 + $10 × 0–9 pages),
 * so lib/stripePriceCache keeps ONE "JobFlex Custom" product per account and
 * reuses a price per distinct amount.
 *
 * Mode-aware: the admin's live/sandbox switch (lib/stripeMode) decides which
 * account the price lives on, and only the LIVE path requires a PlanPrice
 * mirror — the sandbox has no such ids, so test mode prices from the catalog
 * row (one product per plan slug on the test account, one price per amount).
 */
export async function resolveSignupPrice(opts: {
  stripe: Stripe;
  mode: StripeMode;
  planSlug: string;
  interval: SignupInterval;
  customPages: string[];
  trialOffer?: TrialOffer;
  /** The new plans: the pick — tool ids, comma-separated, the first the main tool (lib/toolPlans/cards): a "tool-…"
   *  line each unless the size includes it. Validated here with the plan (toolsSignupPick); ignored for a Classic plan. */
  mainTool?: string | null;
}): Promise<SignupPrice> {
  const { stripe, mode } = opts;
  const trialDays = storedTrialOffer(opts.trialOffer).days;
  /* THE NEW PLANS (Base + Tools, part 4; the builder 2026-11-12): the size's line and a line for each tool ticked that
     the size doesn't include — exactly what the builder showed (lib/toolPlans/cards toolsBuild), priced here from the
     prices in force (Admin → Plans), never from the browser. A slug or a tool that isn't one of ours is refused. One
     person: the sign-up is the owner alone. */
  if (isToolsSlug(opts.planSlug)) {
    const pick = toolsSignupPick({ plan: opts.planSlug, tool: opts.mainTool });
    if (!pick) return { ok: false, status: 404, error: "That plan is not available." };
    const catalog = await readToolCatalog();
    const interval = opts.interval;
    const lineItems = await toolsCheckoutItems({ deps: { stripe, mode }, plan: pick.plan, main: pick.main, extras: pick.extras, interval, people: 1, catalog });
    const monthly = toolsBuild(pick.plan, [...(pick.main ? [pick.main] : []), ...pick.extras], catalog).cents;
    return {
      ok: true,
      lineItems,
      trialDays,
      planLabel: toolPlanById(pick.plan).slug,
      isCustom: false,
      cents: interval === "YEAR" ? monthly * YEAR_MONTHS : monthly,
      interval,
      monthlyCents: monthly,
      mainTool: pick.main,
      extraTools: pick.extras,
    };
  }
  if (opts.planSlug === CUSTOM_PLAN_SLUG) {
    const interval = opts.interval;
    const cents = customPriceCents(opts.customPages, interval);
    const lineItems = await customLineItems(stripe, mode, interval, opts.customPages);
    return { ok: true, lineItems, trialDays, planLabel: CUSTOM_PLAN_SLUG, isCustom: true, cents, interval, monthlyCents: customPriceCents(opts.customPages) };
  }
  const plan = await getPlanBySlug(opts.planSlug);
  if (!plan || !plan.active || plan.isFree) {
    return { ok: false, status: 404, error: "That plan is not available." };
  }
  /* A YEAR asked for a plan with no yearly price is billed MONTHLY (owner,
     2026-10-12) — not refused ("That plan is not available"), and never the
     archived yearly price a PlanPrice row may still hold on live. */
  const interval: SignupInterval = opts.interval === "YEAR" && plan.yearlyPriceCents ? "YEAR" : "MONTH";
  const cents = interval === "YEAR" ? (plan.yearlyPriceCents ?? 0) : plan.priceCents;
  if (mode === "live") {
    const row = await db.planPrice.findFirst({
      where: { planSlug: plan.slug, interval, active: true },
    });
    if (!row) {
      return { ok: false, status: 404, error: "That plan isn't available for checkout yet." };
    }
    return { ok: true, lineItems: [{ price: row.stripePriceId, quantity: 1 }], trialDays, planLabel: plan.slug, isCustom: false, cents, interval, monthlyCents: plan.priceCents };
  }
  if (cents <= 0) {
    return { ok: false, status: 404, error: "That plan is not available." };
  }
  const price = await ensureRecurringPrice({
    stripe,
    mode,
    kind: plan.slug,
    name: `JobFlex ${plan.name}`,
    interval,
    cents,
  });
  return { ok: true, lineItems: [{ price, quantity: 1 }], trialDays, planLabel: plan.slug, isCustom: false, cents, interval, monthlyCents: plan.priceCents };
}

/** What the sign-up says when the plans changed under an open page (the Plans switch flipped after it was drawn). */
export const PLANS_CHANGED = "Our plans just changed. Reload the page to see them — nothing was charged.";

/**
 * WHICH PLANS A NEW SIGN-UP MAY START (owner, 2026-11-10): with the Plans switch on, only the new plans ("tools-…");
 * with it off, only the Classic ones — the new plans can't be bought before the owner turns them on, and a page drawn
 * under the other setting is told to reload rather than sold the wrong kind. Null: allowed. Asked where a sign-up
 * starts (the card checkout, the card-less trial), never where a Classic shop restarts its own trial.
 */
export async function signupPlanRefusal(planSlug: string): Promise<string | null> {
  const on = await toolsPlansOn();
  if (isToolsSlug(planSlug)) return on ? null : "That plan is not available.";
  return on ? PLANS_CHANGED : null;
}

/** The discount a signup's stored code earns: an influencer promo becomes its
 *  Stripe promotion code, a member referral the referral coupon. */
export type SignupDiscount = { promotion_code: string } | { coupon: string };

/* THE CODE TYPED ON THE PLAN STEP IS APPLIED — for real. Until 2026-09-02
   this only opened Stripe's own promo field, so "code applied" on our page met
   a full price on Stripe's (owner's report). The validated code rides with the
   pending intent.

   THE MODE GATE THAT USED TO BE HERE. `&& mode === "live"` made the promo a
   no-op in the sandbox, because the stored promo_… ids belong to the live
   account and passing one to a test session 400s the whole checkout. True,
   but the remedy reproduced the 2026-09-02 defect in test mode: the plan step
   promises "20% off · $63.20" and Stripe charges $79. lib/influencerPromoMode
   resolves the id per mode instead — the stored one on live, byte for byte,
   and a cached test twin in the sandbox. */
export async function resolveSignupDiscount(opts: {
  stripe: Stripe;
  mode: StripeMode;
  attribution: { kind: "promo" | "ref"; code: string } | null;
  trialDays: number;
  /** For the log line. */
  where: string;
  /** A yearly bill takes a first-month code as one month's worth (lib/yearDiscount). */
  interval?: SignupInterval;
  monthlyCents?: number;
}): Promise<SignupDiscount | null> {
  const { stripe, mode, attribution: attr } = opts;
  const year = opts.interval === "YEAR" && (opts.monthlyCents ?? 0) > 0;
  const months = referralCouponMonths(opts.trialDays);
  if (attr?.kind === "promo") {
    const v = await validateAttribution("promo", attr.code);
    if (v?.kind === "promo") {
      const promotionCode = await promotionCodeIdForMode(stripe, mode, {
        id: v.promoId,
        code: v.code,
        stripeCouponId: v.stripeCouponId,
        stripePromotionCodeId: v.stripePromotionCodeId,
        customerPercentOff: v.percentOff,
        customerDiscountMonths: v.discountMonths,
      });
      if (promotionCode && year) {
        const pct = await promoPercentOff(stripe, promotionCode, v.percentOff);
        // N months' worth on the one yearly bill, N up to 12 (lib/firstMonthDiscount).
        const coupon = pct
          ? await ensureYearFirstMonthCoupon(stripe, mode, { kind: "promo", pct, monthlyCents: opts.monthlyCents!, months, periodMonths: v.discountMonths, promoCodeId: v.promoId, code: v.code }).catch((err) => {
              console.warn(`[${opts.where}] yearly first-month coupon unavailable:`, err);
              return null;
            })
          : null;
        if (coupon) return { coupon };
        // Never the percent off a whole year: without its one-month coupon the code is not applied.
        console.warn(`[${opts.where}] promo ${v.code}: ${pct ? "the yearly coupon could not be made" : "no percent known"} — not applied to a yearly bill`);
        return null;
      }
      if (promotionCode) return { promotion_code: promotionCode };
      // Never silently: the plan step has already shown this visitor a price
      // with the discount in it, so a drop here is a promise being broken and
      // the operator must be able to find out why.
      console.warn(`[${opts.where}] promo ${v.code} is not applicable in ${mode} mode`);
    }
  } else if (attr?.kind === "ref") {
    const v = await validateAttribution("ref", attr.code);
    if (v) {
      try {
        if (year) {
          const coupon = await ensureYearFirstMonthCoupon(stripe, mode, { kind: "referral", pct: REFERRAL_DISCOUNT_PCT, monthlyCents: opts.monthlyCents!, months });
          return coupon ? { coupon } : null;
        }
        return { coupon: await ensureReferralCoupon(stripe, mode, months) };
      } catch (err) {
        console.warn(`[${opts.where}] referral coupon unavailable:`, err);
      }
    }
  }
  return null;
}
