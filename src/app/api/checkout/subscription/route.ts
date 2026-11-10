import { NextResponse } from "next/server";
import { appBaseUrl } from "@/lib/appUrl";
import { requireOwner } from "@/lib/orgContext";
import { trialEndedResponse } from "@/lib/trialState";
import { db } from "@/lib/db";
import { getStripeClient, isStripeEnabled } from "@/lib/sdk/stripe";
import { INFLUENCER_LIVE_STATUSES, readAttributionCookie, validateAttribution } from "@/lib/attribution";
import { promotionCodeIdForMode, type PromoForCheckout } from "@/lib/influencerPromoMode";
import { checkoutDiscount } from "@/lib/checkoutDiscount";
import { getPlanBySlug } from "@/lib/planCatalogServer";
import { ensureRecurringPrice } from "@/lib/stripePriceCache";
import { REFERRAL_DISCOUNT_PCT, ensureReferralCoupon, referralCouponMonths } from "@/lib/referralDiscount";
import { ensureYearFirstMonthCoupon, promoPercentOff } from "@/lib/yearDiscount";
import { trialDaysFor } from "@/lib/trialEligibility";
import { storedTrialOffer } from "@/lib/trialOffer";
import { CUSTOM_PLAN_SLUG, customPriceCents, normalizeCustomPages } from "@/lib/customPlan";
import { getCustomPlanTrialDays } from "@/lib/customPlanConfig";
import { customLineItems, customMetadata } from "@/lib/customBilling";
import { CUSTOM_PLAN_OFF_SALE, customPlanOffered } from "@/lib/customPlanFlag";
import { deckAddonCheckoutItems, heldDeckAddonPrice } from "@/lib/deckAddonBilling";
import { heldWebAddonPrices } from "@/lib/webAddonBilling";
import { CARD_ONLY_CHECKOUT } from "@/lib/stripeCheckoutCard";

// Real SaaS subscription checkout. A captured influencer promo (the org's
// permanent signup stamp, falling back to the 30-day capture cookie) is
// auto-applied as the Stripe discount; otherwise allow_promotion_codes lets the
// customer type a code at Stripe. Either way, attribution-of-record is read
// back off the resulting subscription in the webhook (never from this request).
// Billing is owner-only: managers run operations, not the money.
export async function POST(req: Request) {
  const { organizationId, user } = await requireOwner();
  // Past a card-less trial the card goes through /dashboard/trial (the same
  // plan, no new trial) — not a fresh plan checkout from here.
  const locked = await trialEndedResponse(organizationId);
  if (locked) return locked;
  if (!isStripeEnabled()) {
    return NextResponse.json({ error: "Stripe is not configured." }, { status: 503 });
  }

  const { planSlug, interval, customPages, deckAddon } = await req.json().catch(() => ({}));
  if (!planSlug || !interval) {
    return NextResponse.json({ error: "planSlug and interval are required." }, { status: 400 });
  }
  if (interval !== "MONTH" && interval !== "YEAR") {
    return NextResponse.json({ error: "interval must be MONTH or YEAR." }, { status: 400 });
  }

  /* THE CUSTOM PLAN can be bought here by a shop on a catalog plan (or none)
     — base + page × quantity on one subscription (lib/customBilling). A shop
     ALREADY on the custom plan never comes here: its pages change in place on
     the subscription it has (actions/billing.updateCustomPages), so a second
     Checkout can no longer replace it and bill the base twice. */
  const isCustom = String(planSlug) === CUSTOM_PLAN_SLUG;
  if (isCustom) {
    const current = await db.subscription.findUnique({ where: { organizationId }, select: { plan: true } });
    if ((current?.plan ?? "").toUpperCase() === "CUSTOM") {
      return NextResponse.json(
        { error: "Your pages change from Add or remove pages — nothing new to check out." },
        { status: 409 },
      );
    }
    // Off sale (lib/customPlanFlag): no switch to the custom plan.
    if (!customPlanOffered()) return NextResponse.json({ error: CUSTOM_PLAN_OFF_SALE }, { status: 410 });
  }
  const pages = isCustom
    ? normalizeCustomPages(Array.isArray(customPages) ? customPages.map(String) : [])
    : [];
  // A catalog row, or the custom plan's synthetic equivalent. The PricingPlan
  // row is the source of truth for what's sellable; the PlanPrice mirror
  // below is only the Stripe charge handle.
  const plan = isCustom
    ? {
        slug: CUSTOM_PLAN_SLUG,
        name: "Custom plan",
        priceCents: customPriceCents(pages),
        yearlyPriceCents: customPriceCents(pages, "YEAR"),
        // The length the admin set in /admin/plans, not a literal.
        trialDays: await getCustomPlanTrialDays(),
        active: true,
        isFree: false,
      }
    : await getPlanBySlug(String(planSlug), { includeInactive: true });
  if (!plan) {
    return NextResponse.json({ error: "Unknown plan." }, { status: 404 });
  }
  if (!plan.active) {
    return NextResponse.json({ error: "This plan is no longer available." }, { status: 410 });
  }
  if (plan.isFree) {
    // $0 plans have nothing to charge — they cannot form a Stripe Checkout
    // Session. Not reachable from the UI (no $0 plan is offered), kept as
    // defense against a hand-crafted request.
    return NextResponse.json(
      { error: "This plan can't be purchased through checkout." },
      { status: 400 },
    );
  }
  if (interval === "YEAR" && !plan.yearlyPriceCents) {
    return NextResponse.json({ error: "This plan has no yearly option." }, { status: 400 });
  }

  // Mode-aware: the admin's live/sandbox switch (lib/stripeMode) decides which
  // account this session lands on. Resolved BEFORE the mirror lookup, because
  // only the live path needs a mirror at all.
  const { stripe, mode } = await getStripeClient();

  /* The PlanPrice mirror is the LIVE account's price of record; the sandbox
     has no such ids, so test mode prices inline from the catalog row instead —
     which also means a plan that was never synced can still be TRIALLED in the
     sandbox, and only its live checkout says "not available yet". */
  let livePriceId: string | null = null;
  if (mode === "live" && !isCustom) {
    const price = await db.planPrice.findFirst({
      where: { planSlug: plan.slug, interval, active: true },
    });
    if (!price) {
      return NextResponse.json({ error: "That plan isn't available for checkout yet." }, { status: 404 });
    }
    livePriceId = price.stripePriceId;
  }

  const [sub, org, priorAttribution] = await Promise.all([
    db.subscription.findUnique({ where: { organizationId } }),
    db.organization.findUnique({
      where: { id: organizationId },
      select: { signupPromoCodeId: true },
    }),
    db.attribution.findFirst({ where: { organizationId }, select: { id: true } }),
  ]);

  // An organisation that has ever had a Stripe subscription is buying a
  // successor (an upgrade) or coming back — not a first month. Read from what
  // lasts, not from the mirror's current link: an admin comp clears
  // externalSubId on purpose (actions/adminUsers, DETACH_FROM_STRIPE) and keeps
  // the customer, and a client with an attribution has subscribed before.
  // lib/checkoutDiscount then offers no code at all — neither pre-applied nor
  // through the typed field (a code is accepted at signup, nowhere else); a
  // partner's attribution moves to the new subscription on its own (lib/stripeSync).
  const everSubscribed = Boolean(sub?.externalSubId || sub?.externalCustomerId || priorAttribution);

  // Resolve a promo to auto-apply. Both paths re-validate against the DB (the
  // cookie is untrusted input); a dead/suspended code simply resolves to null.
  // local_promo_* synthetics (Stripe-disabled dev) never reach Stripe.
  let promoForCheckout: PromoForCheckout | null = null;
  if (org?.signupPromoCodeId && !everSubscribed) {
    const stamped = await db.promoCode.findUnique({
      where: { id: org.signupPromoCodeId },
      select: {
        id: true,
        code: true,
        active: true,
        customerPercentOff: true,
        stripeCouponId: true,
        stripePromotionCodeId: true,
        influencer: { select: { status: true } },
      },
    });
    if (stamped?.active && (INFLUENCER_LIVE_STATUSES as readonly string[]).includes(stamped.influencer.status)) {
      promoForCheckout = {
        id: stamped.id,
        code: stamped.code,
        stripeCouponId: stamped.stripeCouponId,
        stripePromotionCodeId: stamped.stripePromotionCodeId,
        customerPercentOff: stamped.customerPercentOff,
      };
    }
  }
  if (!promoForCheckout && !everSubscribed) {
    const captured = await readAttributionCookie();
    if (captured?.k === "promo") {
      const validated = await validateAttribution("promo", captured.c);
      if (validated?.kind === "promo") {
        promoForCheckout = {
          id: validated.promoId,
          code: validated.code,
          stripeCouponId: validated.stripeCouponId,
          stripePromotionCodeId: validated.stripePromotionCodeId,
          customerPercentOff: validated.percentOff,
        };
      }
    }
  }


  // Redirect targets come from the platform-set host, never the caller's
  // Origin header — a forged Origin minted a real, contractor-branded checkout
  // whose post-payment landing page was an attacker domain.
  const origin = await appBaseUrl();
  /* THE STORED promo_… ID BELONGS TO THE LIVE ACCOUNT, so on the sandbox it
     would 400 the session. This used to null the promo outright, which left a
     shop that carries a permanent signup stamp paying list price in a test run
     with nothing in the log to explain it — and the influencer earning nothing,
     since the attribution is only ever created from a Stripe-issued discount.
     lib/influencerPromoMode returns the stored id unchanged on live and a
     cached test twin in the sandbox. */
  const autoApplyPromotionCode = promoForCheckout
    ? await promotionCodeIdForMode(stripe, mode, promoForCheckout)
    : null;
  if (promoForCheckout && !autoApplyPromotionCode) {
    console.warn(
      `[checkout/subscription] promo ${promoForCheckout.code} is not applicable in ${mode} mode`,
    );
  }

  /* THE REFERRED SHOP'S DISCOUNT (lib/referralDiscount) — ONCE, on the first
     bill only (owner, 2026-09-04: an Enterprise upgrade was getting the 10%
     again). It applies here only when this checkout IS the shop's first
     subscription: no Stripe subscription has ever been recorded for the org
     and its referral (if any) is still PENDING — settleReferrals marks it
     CONVERTED the moment a subscription starts, and a replacement checkout
     (upgrade) never qualifies. The signup route is the usual first bill;
     this path covers a referred shop that skipped the plan at signup. Promo
     wins when both apply — one discount per session at Stripe. */
  let referralCoupon: string | null = null;
  if (!autoApplyPromotionCode && !everSubscribed) {
    const conversion = await db.referralConversion.findFirst({
      where: { signupOrgId: organizationId },
      orderBy: { createdAt: "desc" },
      select: { status: true },
    });
    let referred = conversion?.status === "PENDING";
    if (!conversion) {
      const captured = await readAttributionCookie();
      if (captured?.k === "ref") referred = Boolean(await validateAttribution("ref", captured.c));
    }
    if (referred) {
      try {
        referralCoupon = await ensureReferralCoupon(stripe, mode);
      } catch (err) {
        console.warn("[checkout/subscription] referral coupon unavailable:", err);
      }
    }
  }
  const cents = interval === "YEAR" ? (plan.yearlyPriceCents ?? 0) : plan.priceCents;
  // Sandbox path: a REUSED test-account price (lib/stripePriceCache), never
  // inline price_data — inline mints a fresh Product per checkout and would
  // litter the dashboard.
  const lineItems = isCustom
    ? await customLineItems(stripe, mode, interval, pages)
    : [
        livePriceId
          ? { price: livePriceId, quantity: 1 }
          : {
              price: await ensureRecurringPrice({
                stripe,
                mode,
                kind: plan.slug,
                name: `JobFlex ${plan.name}`,
                interval,
                cents,
              }),
              quantity: 1,
            },
      ];
  /* REPLACING, NOT ADDING. A shop that already holds a live subscription is
     buying its successor: the new one is paid for on Stripe's page (the
     owner's rule for upgrades, 2026-09-02) and the return leg cancels the old
     one (upgrade/page.tsx verifyReturn), so an org never carries two. No
     trial on a replacement — the trial was the first subscription's. */
  const replacesSubId =
    sub?.externalSubId && (sub.status === "ACTIVE" || sub.status === "TRIALING")
      ? sub.externalSubId
      : null;
  /* ONE TRIAL PER COMPANY (owner, 2026-10-12; lib/trialEligibility). A
     company that has had any subscription — paid, trialing, cancelled, ended
     for non-payment, a grant — or a card-less trial pays at once when it buys
     again. Until this, "Restart subscription" after a cancellation (even one
     for not paying) opened Checkout with the catalog's trial again.
     THE LENGTH IS THE TRIAL OFFER'S (2026-10-26, audit §4) — the sign-up's
     seven days — never PricingPlan.trialDays, which is unused. */
  const trialDays = replacesSubId ? 0 : await trialDaysFor(organizationId, storedTrialOffer().days);
  /* DECK STUDIO ON STRIPE'S PAGE (owner, 2026-10-26; lib/deckAddonBilling): "Add Deck Studio" ticked puts the add-on
     on the order; otherwise it is an optional row Stripe's page lets the owner switch on. A replaced subscription
     that holds it on this term passes ITS line's price on — a shop that bought it at $49 keeps $49. */
  const keepDeckPrice = replacesSubId ? await heldDeckAddonPrice(stripe, replacesSubId, interval) : null;
  const deck = await deckAddonCheckoutItems({ stripe, mode, interval, chosen: deckAddon === true, keepPriceId: keepDeckPrice });
  // The website estimators' lines (lib/webAddonBilling, 2026-10-27) ride a replacement the same way: a shop keeps its
  // estimators, at the prices it bought them at, through a plan bought again on this term.
  const keepWebPrices = replacesSubId ? await heldWebAddonPrices(stripe, replacesSubId, interval) : [];
  const baseParams = {
    mode: "subscription" as const,
    // Cards only — the card form, not Link (lib/stripeCheckoutCard).
    ...CARD_ONLY_CHECKOUT,
    line_items: [...lineItems, ...deck.lineItems, ...keepWebPrices.map((price) => ({ price, quantity: 1 }))],
    ...(deck.optionalItems.length ? { optional_items: deck.optionalItems } : {}),
    ...(sub?.externalCustomerId && mode === "live"
      ? { customer: sub.externalCustomerId }
      : { customer_email: user.email ?? undefined }),
    subscription_data: {
      // The custom plan's pages ride the SUBSCRIPTION (lib/customBilling):
      // the return leg reads them from there, matched to its page quantity.
      metadata: isCustom ? customMetadata(organizationId, pages) : { organizationId },
      ...(trialDays > 0 ? { trial_period_days: trialDays } : {}),
    },
    // planSlug/interval ride the session so the upgrade page can verify the
    // return and write the plan change itself — the live webhook cannot see
    // sandbox events, and even live, the page landing first beats waiting.
    metadata: {
      organizationId,
      planSlug: plan.slug,
      interval,
      replacesSubId: replacesSubId ?? "",
      ...(deck.lineItems.length ? { deckAddon: keepDeckPrice ? "kept" : "1" } : {}),
      ...(keepWebPrices.length ? { webAddons: "kept" } : {}),
      ...(isCustom ? { customPages: pages.join(",") } : {}),
    },
    success_url: `${origin}/dashboard/upgrade?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/dashboard/upgrade?checkout=cancelled`,
  };

  // Stripe forbids combining `discounts` with `allow_promotion_codes`, so it's
  // one or the other — or, on a replacement, neither. If Stripe rejects a
  // pre-applied discount (deactivated or expired on their side) the first bill
  // falls back to manual code entry, and says so in the log: silently dropping
  // the discount the plan step promised was the bug the owner reported.
  /* A FIRST-MONTH CODE ON A YEARLY BILL (owner, 2026-10-12): the percent of
     ONE month of this plan, as a fixed amount (lib/yearDiscount) — Stripe would
     take a percent coupon off the whole year. No code field on a yearly
     checkout for the same reason. */
  const monthlyCents = isCustom ? customPriceCents(pages) : plan.priceCents;
  let yearCoupon: string | null = null;
  if (interval === "YEAR" && !everSubscribed && (autoApplyPromotionCode || referralCoupon)) {
    try {
      if (autoApplyPromotionCode && promoForCheckout) {
        const pct = await promoPercentOff(stripe, autoApplyPromotionCode, promoForCheckout.customerPercentOff);
        if (pct) yearCoupon = await ensureYearFirstMonthCoupon(stripe, mode, { kind: "promo", pct, monthlyCents, months: referralCouponMonths(trialDays), promoCodeId: promoForCheckout.id, code: promoForCheckout.code });
      } else if (referralCoupon) {
        yearCoupon = await ensureYearFirstMonthCoupon(stripe, mode, { kind: "referral", pct: REFERRAL_DISCOUNT_PCT, monthlyCents, months: referralCouponMonths(trialDays) });
      }
    } catch (err) {
      console.warn("[checkout/subscription] yearly first-month coupon unavailable:", err);
    }
  }
  const discount = checkoutDiscount({
    everSubscribed,
    promotionCode: autoApplyPromotionCode,
    referralCoupon,
    year: interval === "YEAR",
    yearCoupon,
  });
  let session;
  try {
    session = await stripe.checkout.sessions.create({ ...baseParams, ...discount.params });
  } catch (err) {
    if (discount.kind !== "promo" && discount.kind !== "referral") throw err;
    console.warn(`[checkout/subscription] Stripe refused the ${discount.kind} discount, falling back to manual entry:`, err);
    session = await stripe.checkout.sessions.create({ ...baseParams, ...(interval === "MONTH" ? { allow_promotion_codes: true } : {}) });
  }

  return NextResponse.json({ url: session.url });
}
