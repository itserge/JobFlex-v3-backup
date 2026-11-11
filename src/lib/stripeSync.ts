// Server-only: reconcile Stripe → our cached mirror + commission ledger.
// Shared by the webhook (event-driven) and the reconciliation cron (backstop),
// so the ledger is fully rebuildable from Stripe. Every money effect is keyed by
// a unique idempotencyKey, so re-processing the same invoice/refund is a no-op.

import type Stripe from "stripe";
import { db } from "@/lib/db";
import {
  AttributionStatus,
  LedgerEntryType,
  LedgerEntryState,
  SubscriptionStatus,
  PayoutTransferStatus,
  ConnectStatus,
  Role,
  InfluencerStatus,
  CommissionType,
  PayoutRequestStatus,
} from "@/lib/prismaEnums";
import {
  computeCommissionCents,
  commissionBasisCents,
  isWithinCommissionWindow,
} from "@/lib/commission";
import { planSnapshot, reportPlanChange } from "@/lib/activation-events";
import { alertTrialCanceled, alertTrialConverted } from "@/lib/adminAlerts";
import { isCardlessTrialLapse, mirrorPeriodEnd, mirrorStatusFor } from "@/lib/stripeStatus";
import { mirrorSubAtKey, recordMirrorReference } from "@/lib/subscriptionRecord";
import { patchCardlessRecord, readCardlessRecord } from "@/lib/trialState";
import { mailChargeback, mailCommissionHeld } from "@/lib/influencerMail";
import { planLine } from "@/lib/deckAddon";
import { planIdOfKind } from "@/lib/toolPlans/shared";
import {
  chargeIsInvoiceBacked,
  invoiceChargeId,
  invoiceIsPaid,
  invoiceSubscriptionId,
  subscriptionDiscounts,
  type DiscountRef,
} from "@/lib/stripeCompat";

// ── small helpers ─────────────────────────────────────
function idOf(v: string | { id: string } | null | undefined): string | null {
  if (!v) return null;
  return typeof v === "string" ? v : v.id;
}

// The status ladder and the card-less trial's lapse: lib/stripeStatus, shared
// with every other path that writes the mirror from Stripe.
export { isCardlessTrialLapse, mirrorStatusFor };

async function planSlugForPrice(price: Stripe.Price | null | undefined): Promise<string | null> {
  const stripePriceId = price?.id ?? null;
  if (!stripePriceId) return null;
  const pp = await db.planPrice.findUnique({ where: { stripePriceId } });
  // Store whatever slug was purchased (uppercased to match existing rows like
  // "STARTER") — custom admin-created plans must not collapse to FREE. Feature
  // gating resolves custom slugs to ENTERPRISE (orgPlan.ts) and their quotas
  // come from the plan's own limitsJson; readers match case-insensitively.
  if (pp) return pp.planSlug.toUpperCase();
  /* A price the app minted itself (lib/stripePriceCache: the sandbox's catalog
     prices, the custom plan's base) names its plan in metadata.jfKind. Read
     so a change Stripe makes on its own — a booked YEAR → MONTH switch
     (lib/planChange) — moves the mirror's plan in the sandbox as the ledger
     does on live (2026-10-12). Only a slug the catalog knows is taken. */
  const kind = price?.metadata?.jfKind ?? "";
  if (kind === "custom" || kind === "custom-base") return "CUSTOM";
  // The new plans (lib/toolPlans, 2026-11-10) are priced by the app itself and are not catalog rows: the plan's line
  // names it ("tools-professional"). Tool and extra-people lines are add-ons and never reach here (planLine).
  if (planIdOfKind(kind)) return kind.toUpperCase();
  if (kind && (await db.pricingPlan.findUnique({ where: { slug: kind }, select: { slug: true } }))) return kind.toUpperCase();
  return null;
}

/**
 * SELF-REFERRAL — the influencer IS the organization paying the invoice.
 *
 * Without this the commission is a standing discount on the partner's own
 * subscription: they pay list-minus-coupon and we hand a share of it back every
 * month, for as long as the promo's window runs. On a $79 plan with a 20%-off
 * code and 20% NET commission that is $63.20 out and $12.64 back — $50.56 a
 * month, forever, off a public-facing referral programme.
 *
 * Two legs, because neither alone is enough:
 *   · the LINKED ACCOUNT — Influencer.userId owning the org (the strong leg;
 *     set when the partner also has an app login);
 *   · the EMAIL — an OWNER membership whose user email is the influencer's
 *     (catches the common case where the two accounts were never linked).
 *
 * What it cannot catch, and the owner should know: a partner who signs up with
 * a different email address and never links the accounts. That needs payment
 * -instrument or identity matching, which is Stripe Radar's job, not ours. This
 * closes the open door, it is not proof of identity.
 */
export async function isSelfReferral(
  influencerId: string,
  organizationId: string | null | undefined,
): Promise<boolean> {
  if (!organizationId) return false;
  const inf = await db.influencer.findUnique({
    where: { id: influencerId },
    select: { userId: true, email: true },
  });
  if (!inf) return false;

  const owners = await db.membership.findMany({
    where: { organizationId, role: Role.OWNER },
    select: { userId: true, user: { select: { email: true } } },
  });
  const email = inf.email.toLowerCase();
  return owners.some(
    (m) =>
      (inf.userId && m.userId === inf.userId) ||
      (m.user.email ?? "").toLowerCase() === email,
  );
}

// Resolve a Stripe discount (promotion_code preferred, else coupon) to our PromoCode.
export async function resolvePromoCode(discount: DiscountRef | null | undefined, stripe?: Stripe | null) {
  if (!discount) return null;
  const promoId = discount.promotionCodeId;
  if (promoId) {
    const byPromo = await db.promoCode.findUnique({ where: { stripePromotionCodeId: promoId } });
    if (byPromo) return byPromo;
  }
  const couponId = discount.couponId;
  if (couponId) {
    const byCoupon = await db.promoCode.findFirst({ where: { stripeCouponId: couponId } });
    if (byCoupon) return byCoupon;
  }
  // A SANDBOX TWIN has neither stored id — it was minted on the test account by
  // lib/influencerPromoMode and carries the PromoCode row's id in its coupon
  // metadata instead. A live coupon is created without metadata
  // (actions/influencers.ts), so on live this branch cannot fire; it is reached
  // only after both lookups above have already missed.
  // Clover sends the coupon as an id, so its metadata takes one retrieve.
  let couponMeta = discount.couponMetadata;
  if (!couponMeta && couponId && stripe) {
    couponMeta = await stripe.coupons.retrieve(couponId).then((c) => c.metadata ?? null, () => null);
  }
  const metaPromoId = couponMeta?.jfPromoCodeId;
  if (metaPromoId) {
    const byMeta = await db.promoCode.findUnique({ where: { id: metaPromoId } });
    if (byMeta) return byMeta;
  }
  return null;
}

/* ── THE COMMISSION WINDOW BELONGS TO THE CLIENT, NOT TO A STRIPE SUBSCRIPTION ──
 *
 * The owner's decision (2026-09-22). An upgrade through our Checkout creates a
 * NEW Stripe subscription and cancels the old one. Attribution was keyed on the
 * subscription id, so the upgrade either minted a fresh attribution with
 * qualifyingMonths = 0 (the window restarted — a "20% for 6 months" code paid
 * 6 + 6) or, once the code is no longer re-applied at checkout, found no
 * attribution at all (commission simply stopped at the upgrade).
 *
 * Now the organisation's attribution — with its months already counted — moves
 * onto the new subscription. The row stays one row: its promo, its partner, its
 * qualifyingMonths, its firstPaidInvoiceAt all travel. A 7th month is refused
 * even though the subscription is new.
 *
 * ONLY FORWARD. The reconcile cron re-syncs every subscription it lists,
 * cancelled ones included and newest first — so the OLD subscription is synced
 * after the new one. Moving the row to "whatever subscription was just synced"
 * would drag it back onto a dead subscription and stop the commission. So a row
 * moves onto a subscription only if that subscription is live AND was created
 * after the one the row is on now. The reference time is kept in SyncState
 * (attributionSubAt:<attributionId>); a row that predates this rule falls back
 * to its own createdAt, which is after its first subscription was created.
 *
 * Called from syncSubscriptionFromStripe (customer.subscription.created, and any
 * later sync) and from accrueForInvoice — the new subscription's first invoice
 * can be delivered before its created event, and must not be skipped for it.
 */
const attrSubAtKey = (attributionId: string) => `attributionSubAt:${attributionId}`;
/** Which client row a subscription it has moved on from belongs to — so an
 *  invoice of that old subscription, delivered or replayed after the move, is
 *  still accrued to it (accrueForInvoice). */
const attrFromKey = (subId: string) => `attributionFrom:${subId}`;

async function carryAttributionToSubscription(opts: {
  toSubId: string;
  organizationId: string | null;
  customerId: string | null;
  /** When the destination subscription was created (ms) — or, from an invoice,
   *  when that invoice was created, which is never earlier. */
  subCreatedMs: number;
  subCanceled: boolean;
}): Promise<boolean> {
  if (opts.subCanceled) return false; // never move a client onto a dead subscription
  const own = await db.attribution.findUnique({ where: { stripeSubscriptionId: opts.toSubId }, select: { id: true } });
  if (own) return false;
  const or = [
    ...(opts.organizationId ? [{ organizationId: opts.organizationId }] : []),
    ...(opts.customerId ? [{ stripeCustomerId: opts.customerId }] : []),
  ];
  if (!or.length) return false;
  const prior = await db.attribution.findFirst({
    where: { OR: or, stripeSubscriptionId: { not: opts.toSubId } },
    orderBy: { createdAt: "desc" },
  });
  if (!prior) return false;

  const refRow = await db.syncState.findUnique({ where: { key: attrSubAtKey(prior.id) } }).catch(() => null);
  const refMs = refRow ? Number(refRow.cursor) : prior.createdAt.getTime();
  // Strictly later than where the row is now. From an invoice this is the
  // invoice's own creation time: the reconcile cron replays the last 100 paid
  // invoices, the OLD subscription's among them, and every one of those predates
  // the replacement — so an old invoice can never pull the row back.
  const destMs = opts.subCreatedMs;
  if (Number.isFinite(refMs) && destMs <= refMs) return false;

  if (prior.stripeSubscriptionId) {
    await db.syncState
      .upsert({
        where: { key: attrFromKey(prior.stripeSubscriptionId) },
        update: { cursor: prior.id },
        create: { key: attrFromKey(prior.stripeSubscriptionId), cursor: prior.id },
      })
      .catch(() => {});
  }
  await db.attribution.update({
    where: { id: prior.id },
    data: {
      stripeSubscriptionId: opts.toSubId,
      ...(opts.customerId ? { stripeCustomerId: opts.customerId } : {}),
      // VOID is the self-referral verdict and stays VOID; anything else is live
      // again on a live subscription. qualifyingMonths is NOT touched.
      ...(prior.status === AttributionStatus.VOID ? {} : { status: AttributionStatus.ACTIVE, endedAt: null }),
    },
  });
  await db.syncState
    .upsert({
      where: { key: attrSubAtKey(prior.id) },
      update: { cursor: String(destMs) },
      create: { key: attrSubAtKey(prior.id), cursor: String(destMs) },
    })
    .catch(() => {});
  return true;
}

/* ── THE BILLING MIRROR MOVES ONLY FORWARD TOO ──
 *
 * The mirror was upserted by organisation with whatever subscription was being
 * synced. After an upgrade the reconcile replay syncs the cancelled predecessor
 * last, so every run ended with the mirror naming the OLD subscription as
 * CANCELED: the organisation dropped to FREE limits while paying for Pro, and
 * the next checkout, seeing no live subscription to replace, left the real one
 * running — two subscriptions billing at once.
 *
 * A subscription other than the one mirrored may write the mirror only if:
 *   · it is not a cancelled one replacing a live mirror (an operator's comp
 *     counts as live — that is the same overwrite, reached by another road);
 *   · it is not older than the newest subscription the mirror has followed
 *     (lib/subscriptionRecord, mirrorSubAt:<orgId>). After a comp detached the
 *     mirror, only a subscription created after it.
 * The attribution logic below still runs for every subscription — it has its
 * own forward-only rule.
 */
const LIVE_MIRROR: string[] = [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING, SubscriptionStatus.PAST_DUE];
const ENDED: string[] = [SubscriptionStatus.CANCELED, SubscriptionStatus.TRIAL_ENDED, SubscriptionStatus.UNPAID];

async function mirrorAccepts(organizationId: string, externalSubId: string, status: string, createdMs: number) {
  const mirror = await db.subscription.findUnique({
    where: { organizationId },
    select: { externalSubId: true, status: true, provider: true, updatedAt: true },
  });
  if (!mirror || mirror.externalSubId === externalSubId) return true;
  if (ENDED.includes(status) && LIVE_MIRROR.includes(mirror.status)) return false;
  const ref = await db.syncState.findUnique({ where: { key: mirrorSubAtKey(organizationId) } }).catch(() => null);
  const refMs = ref ? Number(ref.cursor) : mirror.provider === "MANUAL" ? mirror.updatedAt.getTime() : NaN;
  if (!Number.isFinite(refMs)) return true;
  return mirror.externalSubId ? createdMs >= refMs : createdMs > refMs;
}

/** The organisation whose mirror holds THIS subscription as ended by Stripe
 *  (CANCELED, or a card-less trial's TRIAL_ENDED) while the payload says it
 *  is live — or null. Only the same subscription: a new one may always
 *  replace an ended record (mirrorAccepts). */
async function endedMirrorRevived(sub: Stripe.Subscription): Promise<string | null> {
  if (sub.status === "canceled" || sub.status === "incomplete_expired") return null;
  const row = await db.subscription.findFirst({
    where: { externalSubId: sub.id, provider: "STRIPE", status: { in: [SubscriptionStatus.CANCELED, SubscriptionStatus.TRIAL_ENDED] } },
    select: { organizationId: true },
  });
  return row?.organizationId ?? null;
}

// ── subscription lifecycle → Subscription mirror + Attribution ──
/** `stripe` reads what a clover payload leaves as ids (the discounts, a
 *  coupon's metadata); every production caller passes the client it holds. */
export type SubscriptionSyncResult =
  | { synced: true; organizationId: string }
  | { synced: false; reason: "unmapped" | "organization-missing"; organizationId: string | null };

export async function syncSubscriptionFromStripe(
  sub: Stripe.Subscription,
  stripe?: Stripe | null,
): Promise<SubscriptionSyncResult> {
  const externalSubId = sub.id;
  const customerId = idOf(sub.customer);
  const metaOrg = sub.metadata?.organizationId ?? null;

  // Resolve which org this subscription belongs to: metadata first, then an
  // existing mirror row keyed by the Stripe subscription id.
  let organizationId: string | null = metaOrg;
  if (!organizationId) {
    const existing = await db.subscription.findFirst({ where: { externalSubId } });
    organizationId = existing?.organizationId ?? null;
  }
  if (!organizationId && customerId) {
    // A subscription the mirror has moved on from is still this customer's. A
    // signup-checkout subscription carries no organisation in its metadata, so
    // once the org upgrades, the old one could no longer be mapped at all — and
    // a referred signup whose first sync came before its organisation existed
    // lost its partner for good.
    const byCustomer = await db.subscription.findFirst({ where: { externalCustomerId: customerId } });
    organizationId = byCustomer?.organizationId ?? null;
  }
  if (!organizationId) return { synced: false, reason: "unmapped", organizationId: null }; // can't map — leave for reconciliation once metadata is present

  // THE ORGANIZATION CAN BE GONE. A deleted account (deleteMyAccount, the
  // 30-day purge) leaves its cancelled subscription in Stripe with
  // metadata.organizationId still naming it; the mirror upsert below would
  // then fail the foreign key, and that one subscription took the whole
  // reconcile run down with it every six hours. Nothing is left to mirror.
  const orgExists = await db.organization.findUnique({ where: { id: organizationId }, select: { id: true } });
  if (!orgExists) {
    console.warn(`[stripe-sync] ${externalSubId} (${sub.status}) names organization ${organizationId}, which no longer exists — skipped`);
    return { synced: false, reason: "organization-missing", organizationId };
  }

  /* AN ENDED SUBSCRIPTION DOES NOT COME BACK (owner, 2026-10-13). Stripe
     never revives a cancelled subscription, so a "live" payload for one the
     mirror already holds as ended is an old event — delivered again, or
     after the deletion. Written as it came it put a company that had moved
     to the Free plan back on its paid plan. Stripe is asked what is true
     now; with no client to ask, the ended row stands. */
  const stale = await endedMirrorRevived(sub);
  if (stale) {
    const live = stripe ? await stripe.subscriptions.retrieve(sub.id).catch(() => null) : null;
    if (!live || live.status === "canceled" || live.status === "incomplete_expired") {
      console.info(`[stripe-sync] ${sub.id}: ${sub.status} payload for an ended subscription — not written`);
      return { synced: true, organizationId: stale };
    }
    sub = live;
  }

  // The plan's own line — never the Deck Studio add-on's (lib/deckAddon), whichever order Stripe lists them in.
  const planItem = planLine(sub.items.data);
  const stripePriceId = planItem?.price?.id ?? null;
  const planSlug = await planSlugForPrice(planItem?.price);
  const discounts = await subscriptionDiscounts(sub, stripe);
  let promo: Awaited<ReturnType<typeof resolvePromoCode>> = null;
  for (const d of discounts) {
    promo = await resolvePromoCode(d, stripe);
    if (promo) break;
  }
  const discount = discounts[0] ?? null;
  const currentPeriodEnd = mirrorPeriodEnd(sub);
  const status = mirrorStatusFor(sub);
  // The trial's end, while it is one — Stripe moves it (an operator, a test
  // clock), and the card-less trial's banner and lock read it from the row.
  const trialEndsAt = sub.status === "trialing" && sub.trial_end ? new Date(sub.trial_end * 1000) : undefined;

  const subCreatedMs = (sub.created ?? Math.floor(Date.now() / 1000)) * 1000;
  if (await mirrorAccepts(organizationId, externalSubId, status, subCreatedMs)) {
    const planWas = await planSnapshot(organizationId);
    // What the mirror held before this write — the team's alert texts read the
    // transition off it (lib/adminAlerts), not PostHog's snapshot above.
    const beforeWrite = await db.subscription
      .findUnique({ where: { organizationId }, select: { status: true, canceledAt: true, createdAt: true } })
      .catch(() => null);
    await db.subscription.upsert({
      where: { organizationId },
      update: {
        status,
        provider: "STRIPE",
        externalCustomerId: customerId,
        externalSubId,
        stripePriceId,
        ...(planSlug && { plan: planSlug }),
        currentPeriodEnd,
        canceledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000) : null,
        ...(trialEndsAt && { trialEndsAt }),
        appliedPromotionCodeId: discount?.promotionCodeId ?? null,
        appliedCouponId: discount?.couponId ?? null,
      },
      create: {
        organizationId,
        plan: planSlug ?? "FREE",
        status,
        provider: "STRIPE",
        externalCustomerId: customerId,
        externalSubId,
        stripePriceId,
        currentPeriodEnd,
        trialEndsAt: trialEndsAt ?? null,
        appliedPromotionCodeId: discount?.promotionCodeId ?? null,
        appliedCouponId: discount?.couponId ?? null,
      },
    });
    reportPlanChange(organizationId, "stripe", planWas);
    await recordMirrorReference(organizationId, subCreatedMs);
    /* THE DECK STUDIO ADD-ON'S RECORD FOLLOWS THE LINES (lib/deckAddonBilling) — here, where the organization is
       known: a sign-up's subscription names none in its metadata, so the webhook's own mirror could not place an
       add-on bought on the sign-up's checkout page (owner, 2026-10-26). Loaded late: that module reaches back here. */
    await import("@/lib/deckAddonBilling")
      .then((m) => m.mirrorDeckAddon(sub, false, organizationId))
      .catch((err) => console.warn("[stripe-sync] deck add-on mirror:", err));
    // The new plans' lines (lib/toolPlans/billing), placed here for the same reason — a sign-up's subscription names
    // no organization in its metadata. A Classic subscription is left alone.
    await import("@/lib/toolPlans/billing")
      .then((m) => m.mirrorToolLines(sub, false, organizationId))
      .catch((err) => console.warn("[stripe-sync] tool lines mirror:", err));

    // The team's alert texts (lib/adminAlerts), best effort, never the sync's problem:
    //  · a trial that now pays — the mirror moved TRIALING → ACTIVE;
    //  · a trial canceled to end at its period end — still trialing on Stripe, but
    //    canceled_at just appeared (the immediate cancel lands in markSubscriptionCanceled).
    try {
      const daysIn = beforeWrite?.createdAt ? Math.max(0, Math.floor((Date.now() - beforeWrite.createdAt.getTime()) / 86_400_000)) : null;
      if (beforeWrite?.status === SubscriptionStatus.TRIALING && status === SubscriptionStatus.ACTIVE) {
        const org = await db.organization.findUnique({ where: { id: organizationId }, select: { name: true } }).catch(() => null);
        await alertTrialConverted({ orgName: org?.name ?? "A company", plan: planSlug });
      } else if (beforeWrite?.status === SubscriptionStatus.TRIALING && !beforeWrite.canceledAt && sub.canceled_at && sub.status === "trialing") {
        const org = await db.organization.findUnique({ where: { id: organizationId }, select: { name: true } }).catch(() => null);
        await alertTrialCanceled({ orgName: org?.name ?? "A company", daysIn });
      }
    } catch (err) {
      console.warn("[adminAlerts] subscription text:", err instanceof Error ? err.message : err);
    }

    // A card may have been attached through Stripe's subscription/card-update
    // flow rather than our trial Checkout. The trial meter reads this local
    // marker, so mirror a payment method only for this exact subscription and
    // customer. A contractor's separate Stripe Connect account cannot set it.
    if (sub.status === "trialing" && sub.default_payment_method && customerId) {
      const trial = await readCardlessRecord(organizationId);
      if (trial?.subId === externalSubId && trial.customerId === customerId && !trial.cardAt) {
        await patchCardlessRecord(organizationId, { cardAt: new Date().toISOString() });
      }
    }
  }

  // The client's attribution — months already counted — moves onto this
  // subscription first, so the branches below find it by subscription id and
  // update it instead of starting a fresh window.
  await carryAttributionToSubscription({
    toSubId: externalSubId,
    organizationId,
    customerId,
    subCreatedMs,
    subCanceled: ENDED.includes(status),
  });

  // ONE CLIENT, ONE ATTRIBUTION. If this subscription has no row of its own but
  // the organisation already has one on another subscription, the carry above
  // declined to move it here — this subscription is older or dead (the reconcile
  // replay of a pre-upgrade subscription that still carried the month-1
  // discount). Creating a second, fresh row would restart the window on it.
  let promoApplies = Boolean(promo && customerId);
  if (promoApplies) {
    const own = await db.attribution.findUnique({ where: { stripeSubscriptionId: externalSubId }, select: { id: true } });
    if (!own) {
      const elsewhere = await db.attribution.findFirst({ where: { organizationId }, select: { id: true } });
      if (elsewhere) promoApplies = false;
    }
  }

  if (promo && customerId && promoApplies) {
    // A partner's own organization is recorded, not paid: the row still exists
    // so the admin can see the code was used, but VOID keeps it out of every
    // accrual. The upsert rewrites status on every subscription.updated, so the
    // verdict is recomputed here each time rather than being set once — and
    // accrueForInvoice re-checks anyway, because this state is not durable.
    const selfReferral = await isSelfReferral(promo.influencerId, organizationId);
    // Named apart from `status` above — that one is the SUBSCRIPTION's state.
    const attrStatus = selfReferral ? AttributionStatus.VOID : AttributionStatus.ACTIVE;
    const attribution = await db.attribution.upsert({
      where: { stripeSubscriptionId: externalSubId },
      update: {
        organizationId,
        status: attrStatus,
        influencerId: promo.influencerId,
        promoCodeId: promo.id,
      },
      create: {
        influencerId: promo.influencerId,
        promoCodeId: promo.id,
        organizationId,
        stripeCustomerId: customerId,
        stripeSubscriptionId: externalSubId,
        status: attrStatus,
      },
    });
    // The "only forward" reference for carrying this client to a later
    // subscription: this subscription's own creation time, recorded once. The
    // row's createdAt is when WE first synced it, which can be later.
    await db.syncState
      .create({
        data: {
          key: attrSubAtKey(attribution.id),
          cursor: String((sub.created ?? Math.floor(Date.now() / 1000)) * 1000),
        },
      })
      .catch(() => {
        /* already recorded — keep the earliest */
      });
    await db.subscription.update({ where: { organizationId }, data: { attributionId: attribution.id } });
  } else if (promo && customerId && !promoApplies) {
    // The client's attribution lives on a newer subscription; nothing to do here.
  } else {
    /* NO DISCOUNT ON THE SUBSCRIPTION ANY MORE — WHICH IS THE NORMAL CASE.
     *
     * The customer's coupon is minted for ONE month (actions/influencers.ts,
     * "FIRST MONTH ONLY", owner 2026-09-02), so from the second billing cycle
     * Stripe removes it and every referred subscription arrives here with
     * `sub.discount === null`. This branch used to read that as "discount
     * removed → stop future accrual" and ENDED the attribution. The result: a
     * "20% for 6 months" code paid exactly ONE month — $12.64 instead of $91.64
     * on a $79 plan, short $79.00 on every single subscriber, with nothing on
     * either portal to say so. The commission window is documented as DECOUPLED
     * from the customer's discount (prismaEnums PromoDurationType) and was in
     * fact killed by it. The reconcile cron re-runs this function over the last
     * 100 subscriptions every six hours, so it ENDED them even without a webhook.
     *
     * A discount that expired on schedule and one an admin removed look exactly
     * the same in `sub.discount`, so this branch cannot be made clever. The
     * discount no longer decides anything: an attribution is bounded by the
     * promo's own window (isWithinCommissionWindow, at accrual) and ended by the
     * SUBSCRIPTION ending.
     *
     * DECIDED, NOT INFERRED: removing a customer's discount no longer stops the
     * partner's commission. The levers that do are suspending the partner
     * (accrueForInvoice refuses SUSPENDED/TERMINATED) and the window itself.
     */
    const existing = await db.attribution.findUnique({
      where: { stripeSubscriptionId: externalSubId },
      select: { id: true, status: true },
    });
    if (existing) {
      if (status === SubscriptionStatus.CANCELED) {
        // A subscription can reach "canceled" through customer.subscription
        // .updated without markSubscriptionCanceled ever running, so this is the
        // one place that closes it — the job the old blanket ENDED was doing by
        // accident.
        if (existing.status === AttributionStatus.ACTIVE) {
          await db.attribution.update({
            where: { id: existing.id },
            data: { status: AttributionStatus.ENDED, endedAt: new Date() },
          });
        }
      } else if (existing.status === AttributionStatus.ENDED) {
        // THE REPAIR. Every live referred subscription past its first month is
        // already ENDED by the old rule, and nothing else would ever lift it: the
        // only ACTIVE writer is the promo branch above, which cannot fire once the
        // coupon is gone. Its promoCodeId and qualifyingMonths are intact, and
        // the money is still gated at accrual by the window, the partner's
        // status and the self-referral check.
        //
        // VOID is deliberately left alone — that is the self-referral verdict,
        // not an expiry, and lifting it would mislead the admin page even though
        // the accrual would still refuse it.
        await db.attribution.update({
          where: { id: existing.id },
          data: { status: AttributionStatus.ACTIVE, endedAt: null },
        });
      }
    }
  }
  return { synced: true, organizationId };
}

export async function markSubscriptionCanceled(sub: Stripe.Subscription) {
  const externalSubId = sub.id;
  // plan_changed → "CANCELED" is per organization; a subscription never mirrored has none.
  const mirror = await db.subscription.findFirst({ where: { externalSubId }, select: { organizationId: true, status: true, canceledAt: true, createdAt: true } });
  const planWas = mirror ? await planSnapshot(mirror.organizationId) : undefined;
  /* CANCELED is the Free plan (lib/freePlan). The row keeps when the owner
     asked (Stripe's canceled_at) and when it ended (currentPeriodEnd) — both
     from Stripe, so a second delivery writes the same dates, not today's. */
  const endedAt = mirrorPeriodEnd(sub);
  await db.subscription.updateMany({
    where: { externalSubId },
    data: {
      status: mirrorStatusFor(sub) === SubscriptionStatus.TRIAL_ENDED ? SubscriptionStatus.TRIAL_ENDED : SubscriptionStatus.CANCELED,
      canceledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000) : new Date(),
      ...(endedAt ? { currentPeriodEnd: endedAt } : {}),
    },
  });
  if (mirror) reportPlanChange(mirror.organizationId, "stripe", planWas);
  // The team's "Trial cancels" text — only when this cancellation is news (the
  // scheduled cancel during the trial already told them, and left canceledAt set).
  if (mirror && mirror.status === SubscriptionStatus.TRIALING && !mirror.canceledAt && mirrorStatusFor(sub) !== SubscriptionStatus.TRIAL_ENDED) {
    try {
      const daysIn = mirror.createdAt ? Math.max(0, Math.floor((Date.now() - mirror.createdAt.getTime()) / 86_400_000)) : null;
      const org = await db.organization.findUnique({ where: { id: mirror.organizationId }, select: { name: true } }).catch(() => null);
      await alertTrialCanceled({ orgName: org?.name ?? "A company", daysIn });
    } catch (err) {
      console.warn("[adminAlerts] cancel text:", err instanceof Error ? err.message : err);
    }
  }
  await db.attribution.updateMany({
    where: { stripeSubscriptionId: externalSubId, status: AttributionStatus.ACTIVE },
    data: { status: AttributionStatus.ENDED, endedAt: new Date() },
  });
}

/** A failed charge: PAST_DUE while Stripe retries. Only a running plan is
 *  moved — the final failure's invoice.payment_failed can arrive after the
 *  subscription event that already ended it (UNPAID / CANCELED), and must not
 *  reopen it. */
export async function markSubscriptionPastDue(invoice: Stripe.Invoice) {
  const subId = invoiceSubscriptionId(invoice);
  if (!subId) return;
  await db.subscription.updateMany({
    where: { externalSubId: subId, status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING, SubscriptionStatus.PAST_DUE] } },
    data: { status: SubscriptionStatus.PAST_DUE },
  });
}

// ── commission accrual (the trigger: a successfully PAID invoice) ──
/** `stripe` finds the paying charge when a clover invoice does not carry it. */
export async function accrueForInvoice(invoice: Stripe.Invoice, eventId?: string, stripe?: Stripe | null) {
  if (!invoiceIsPaid(invoice) || (invoice.amount_paid ?? 0) <= 0) return { skipped: "not-paid" as const };
  const subId = invoiceSubscriptionId(invoice);
  if (!subId) return { skipped: "no-subscription" as const };

  let attribution = await db.attribution.findUnique({
    where: { stripeSubscriptionId: subId },
    include: { promoCode: true, influencer: true },
  });
  if (!attribution) {
    // The first invoice of a replacement subscription can arrive before its
    // customer.subscription.created — carry the client's attribution here too,
    // or that month would be skipped for want of a row.
    const carried = await carryAttributionToSubscription({
      toSubId: subId,
      organizationId: null,
      customerId: idOf(invoice.customer),
      subCreatedMs: (invoice.created ?? Math.floor(Date.now() / 1000)) * 1000,
      subCanceled: false,
    });
    if (carried) {
      attribution = await db.attribution.findUnique({
        where: { stripeSubscriptionId: subId },
        include: { promoCode: true, influencer: true },
      });
    } else {
      // An invoice of a subscription this client has already moved on from —
      // the month before an upgrade, delivered late or replayed by the reconcile
      // cron. It is still the client's month: accrued to the same row, inside
      // the same window, without moving the row back. Refusing it lost that
      // month's commission and let a 7th month be paid in its place.
      const from = await db.syncState.findUnique({ where: { key: attrFromKey(subId) } }).catch(() => null);
      if (from) {
        attribution = await db.attribution.findUnique({
          where: { id: from.cursor },
          include: { promoCode: true, influencer: true },
        });
      }
    }
  }
  if (!attribution || attribution.status !== AttributionStatus.ACTIVE) {
    return { skipped: "no-active-attribution" as const };
  }

  // Checked at the money moment, not only when the attribution was written:
  // syncSubscriptionFromStripe's upsert rewrites status on every
  // subscription.updated, so a VOID stamp is not something to rely on.
  if (await isSelfReferral(attribution.influencerId, attribution.organizationId)) {
    return { skipped: "self-referral" as const };
  }

  // A suspended or terminated partner stops earning. requireInfluencer already
  // refuses them the portal, so without this the ledger kept growing money they
  // could not see, request or be told about — and the admin's owed-across-all
  // -partners total kept climbing for a relationship that had ended.
  //
  // PENDING is deliberately NOT here: that is a partner who has an invite out
  // and has not set a password yet. Their code can already be live, and the
  // referral they brought in is owed to them.
  //
  // PromoCode.active is also deliberately not checked. Switching a code off
  // stops NEW signups (validateAttribution refuses it) and leaves existing
  // subscribers earning — a different lever from ending the relationship, and
  // the one an admin reaches for when they only want to close the code.
  const infStatus = attribution.influencer.status;
  if (infStatus === InfluencerStatus.SUSPENDED || infStatus === InfluencerStatus.TERMINATED) {
    return { skipped: "influencer-inactive" as const };
  }

  const promo = attribution.promoCode;
  if (!isWithinCommissionWindow(promo, attribution.qualifyingMonths)) {
    return { skipped: "outside-window" as const };
  }

  /* A PRORATION IS NOT A MONTH. A mid-cycle plan change bills an immediate
   * proration invoice (billing_reason "subscription_update") with its own id,
   * and the window counted INVOICES, not billing periods — so one upgrade paid
   * commission twice in a month and ended a 6-month window a month early. Worse
   * for FLAT: $10 flat on a $4.30 proration, and a month of the window gone.
   *
   *   · PERCENT still accrues on a proration — it is money actually collected —
   *     but does not consume a window month (see the increment below).
   *   · FLAT does not accrue on a proration at all: "$10 per payment" means per
   *     billing period, which is what the admin preview promises.
   */
  const isProration = invoice.billing_reason === "subscription_update";
  if (isProration && promo.commissionType === CommissionType.FLAT) {
    return { skipped: "flat-on-proration" as const };
  }

  const basisCents = commissionBasisCents(promo, {
    amountPaidCents: invoice.amount_paid,
    subtotalCents: invoice.subtotal ?? invoice.amount_paid,
  });
  // Never more than the invoice actually collected. computeCommissionCents clamps
  // FLAT to its basis, but on a GROSS code that basis is the pre-discount
  // subtotal, which can exceed what was paid; the cash is the only bound that
  // holds for every basis.
  const commissionCents = Math.min(computeCommissionCents(promo, basisCents), invoice.amount_paid);
  if (commissionCents <= 0) return { skipped: "zero-commission" as const };

  const clearsAt = new Date(Date.now() + attribution.influencer.holdDays * 24 * 60 * 60 * 1000);
  const idempotencyKey = `accrue:${invoice.id}`;
  // Refunds and disputes find this accrual by its charge — on a clover invoice
  // that is a Stripe call, so a replay that already accrued skips it.
  const accrued = await db.commissionLedger.findUnique({ where: { idempotencyKey }, select: { id: true } });
  if (accrued) return { skipped: "already-accrued" as const };
  const chargeId = await invoiceChargeId(invoice, stripe);

  try {
    await db.commissionLedger.create({
      data: {
        influencerId: attribution.influencerId,
        attributionId: attribution.id,
        entryType: LedgerEntryType.ACCRUED,
        amountCents: commissionCents,
        currency: (invoice.currency ?? "usd").toLowerCase(),
        stripeInvoiceId: invoice.id,
        stripeChargeId: chargeId,
        stripeEventId: eventId ?? null,
        clearsAt,
        state: LedgerEntryState.PENDING,
        idempotencyKey,
      },
    });
  } catch (e: unknown) {
    // Unique-violation on idempotencyKey = already accrued for this invoice → no-op.
    if (isUniqueViolation(e)) return { skipped: "already-accrued" as const };
    throw e;
  }

  await db.attribution.update({
    where: { id: attribution.id },
    data: {
      // A proration is paid on, but is not a billing period of its own.
      ...(isProration ? {} : { qualifyingMonths: { increment: 1 } }),
      firstPaidInvoiceAt: attribution.firstPaidInvoiceAt ?? new Date(),
    },
  });

  // A refund that arrived before this invoice parked its numbers; settle it now
  // that there is something to reverse. Both this and the reversal are keyed, so
  // a redelivery of either event cannot double-reverse.
  const reversedFromPark = await drainParkedRefund(chargeId, eventId);

  // A dispute can outrun its invoice as well: this commission is born into it —
  // frozen while it is open, charged back if it was already lost. Without this
  // the accrual stood PENDING with its clock running, and a lost dispute whose
  // closed event had come first was never applied: redeliveries of it are
  // skipped as already closed.
  const dispute = await applyDisputesToNewAccrual(chargeId, eventId);

  return {
    accruedCents: commissionCents,
    ...(reversedFromPark ? { reversedCents: reversedFromPark } : {}),
    ...(dispute ? { dispute } : {}),
  };
}

async function applyDisputesToNewAccrual(chargeId: string | null, eventId?: string) {
  if (!chargeId) return null;
  const records = await disputesOnCharge(chargeId);
  const lost = records.find((d) => d.status === "lost");
  if (lost) {
    await reverseForLostDispute(chargeId, lost.id, eventId);
    return "lost" as const;
  }
  if (records.some((d) => d.status === "open")) {
    await holdChargeRows(chargeId);
    return "held" as const;
  }
  return null;
}

// ── refund / dispute → reverse commission (proportional, idempotent) ──

/* A REFUND CAN OUTRUN THE INVOICE IT REFUNDS.
 *
 * Stripe does not order webhook deliveries, and charge.refunded and invoice.paid
 * are separate events. When the refund is processed first there is no accrual to
 * reverse, the handler found nothing and returned, and the accrual that landed a
 * moment later stood forever: full commission owed on a fully refunded charge.
 * Nothing repaired it — the reconcile cron re-runs accrueForInvoice over recent
 * paid invoices (lib/reconcile.ts) but never re-runs a reversal.
 *
 * So an unmatched refund parks its numbers under this key and the accrual
 * consumes them the moment it arrives. Written only for invoice-backed charges,
 * so the one-off proposal payments that share this webhook never touch it, and
 * deleted on use. An unconsumed row is inert: a plain key/value in SyncState
 * that nothing else reads.
 */
const refundParkKey = (chargeId: string) => `refundPending:${chargeId}`;

/** Settle a refund that outran its invoice. Returns the cents reversed, or 0. */
async function drainParkedRefund(chargeId: string | null, eventId?: string): Promise<number> {
  if (!chargeId) return 0;
  const key = refundParkKey(chargeId);
  const parked = await db.syncState.findUnique({ where: { key } }).catch(() => null);
  if (!parked) return 0;
  const parts = parked.cursor.split(":");
  const amount = Number(parts[0]);
  const refunded = Number(parts[1]);
  // Drop the row first: a malformed value must not be retried forever, and the
  // reversal below is idempotent on its own key, so losing the race with a
  // redelivered charge.refunded costs nothing.
  await db.syncState.delete({ where: { key } }).catch(() => {});
  if (!Number.isFinite(amount) || !Number.isFinite(refunded)) return 0;
  const res = await applyRefundReversal({
    chargeId,
    chargeAmountCents: amount,
    refundedCents: refunded,
    invoiceBacked: true,
    eventId,
  });
  const reversed = (res as { reversedCents?: number }).reversedCents;
  return typeof reversed === "number" ? reversed : 0;
}

export async function reverseForCharge(charge: Stripe.Charge, eventId?: string, stripe?: Stripe | null) {
  return applyRefundReversal({
    chargeId: charge.id,
    chargeAmountCents: charge.amount,
    refundedCents: charge.amount_refunded ?? 0,
    invoiceBacked: await chargeIsInvoiceBacked(charge, stripe),
    eventId,
  });
}

async function applyRefundReversal(opts: {
  chargeId: string;
  chargeAmountCents: number;
  refundedCents: number;
  invoiceBacked: boolean;
  eventId?: string;
}) {
  const { chargeId, chargeAmountCents, refundedCents, eventId } = opts;
  if (refundedCents <= 0 || chargeAmountCents <= 0) return { skipped: "no-refund" as const };
  const ratio = Math.min(1, refundedCents / chargeAmountCents);

  // Accruals tied to this charge (one per invoice).
  const accruals = await db.commissionLedger.findMany({
    where: { stripeChargeId: chargeId, entryType: LedgerEntryType.ACCRUED },
  });

  if (!accruals.length) {
    // Nothing to reverse YET. Park it if a commission could still be accrued
    // against this charge; a charge with no invoice never accrues one.
    if (!opts.invoiceBacked) return { skipped: "no-accrual" as const };
    await db.syncState
      .upsert({
        where: { key: refundParkKey(chargeId) },
        update: { cursor: `${chargeAmountCents}:${refundedCents}` },
        create: { key: refundParkKey(chargeId), cursor: `${chargeAmountCents}:${refundedCents}` },
      })
      .catch(() => {
        /* best effort — a parked refund is a repair, never a reason to 500 the webhook */
      });
    return { skipped: "parked-until-accrual" as const };
  }

  let reversedTotal = 0;
  for (const accrual of accruals) {
    // VOID is closed: a written-off commission (lib/payouts) was never received,
    // and a charged-back one is already netted to zero. Reversing it again would
    // charge the partner for money they never had — and its offset is an
    // ADJUSTMENT, which the sum below does not see.
    if (accrual.state === LedgerEntryState.VOID) continue;
    const desiredReversed = Math.round(accrual.amountCents * ratio);

    // How much we've already reversed for this accrual's invoice.
    const priorReversals = await db.commissionLedger.aggregate({
      where: { stripeInvoiceId: accrual.stripeInvoiceId, entryType: LedgerEntryType.REVERSED },
      _sum: { amountCents: true },
    });
    const alreadyReversed = -(priorReversals._sum.amountCents ?? 0); // stored negative
    const delta = desiredReversed - alreadyReversed;
    if (delta <= 0) continue;

    // Match the bucket so pending/cleared math stays consistent; a clawback on an
    // already-PAID accrual lands as CLEARED so it nets against the next payout.
    // An accrual whose transfer was reversed is waiting on an admin; its refund
    // waits with it, tied to the same transfer, so Retry payout releases the net
    // and Write off closes the net — never one without the other.
    const reversalState =
      accrual.state === LedgerEntryState.PAID ? LedgerEntryState.CLEARED : accrual.state;
    const reversalTransferId =
      accrual.state === LedgerEntryState.REVERSED_TRANSFER ? accrual.payoutTransferId : null;

    try {
      await db.commissionLedger.create({
        data: {
          influencerId: accrual.influencerId,
          attributionId: accrual.attributionId,
          entryType: LedgerEntryType.REVERSED,
          amountCents: -delta,
          currency: accrual.currency,
          stripeInvoiceId: accrual.stripeInvoiceId,
          stripeChargeId: chargeId,
          stripeEventId: eventId ?? null,
          state: reversalState,
          payoutTransferId: reversalTransferId,
          // A reversal of a still-pending accrual clears with it, so the clear
          // cron's "flip PENDING where clearsAt<=now" rule nets them together.
          clearsAt: reversalState === LedgerEntryState.PENDING ? accrual.clearsAt : null,
          idempotencyKey: `reverse:${chargeId}:${accrual.id}:${refundedCents}`,
          memo: `Refund reversal (${Math.round(ratio * 100)}% of charge ${chargeId})`,
        },
      });
      reversedTotal += delta;
    } catch (e: unknown) {
      if (!isUniqueViolation(e)) throw e; // duplicate refund event → skip
    }
  }
  return { reversedCents: reversedTotal };
}

// ── chargebacks: a disputed payment takes its commission with it ──
/*
 * THE OWNER'S RULE (2026-09-22): a chargeback removes the commission exactly as
 * a full refund does. Until then only charge.refunded was handled, and a dispute
 * does not move charge.amount_refunded — so a lost chargeback left the accrual
 * standing, it cleared after the hold, and it was paid out.
 *
 *   charge.dispute.created  → the commission on that payment is HELD: out of
 *                             pending, the hold clock stopped, out of any payout.
 *   charge.dispute.closed   → lost: a REVERSED entry for the whole commission on
 *                             that payment (less anything a refund already took),
 *                             keyed by the dispute id.
 *                             won (or an inquiry closed with no chargeback):
 *                             nothing is reversed, the HELD rows go back to
 *                             PENDING and the hold starts again from the day the
 *                             dispute closed.
 *
 * AFTER A PAYOUT the commission is no longer ours to freeze, so nothing is held;
 * if the dispute is lost the reversal lands CLEARED — the partner's balance goes
 * negative and the next commissions pay it back before anything is transferred
 * (runApprovedPayouts always nets negative rows into a payout).
 *
 * The dispute's own state is kept in SyncState, one record per dispute under
 * dispute:<chargeId>:<disputeId> — a payment can be disputed again after an
 * inquiry closes, and each dispute runs its own open → won/lost course. The
 * record is what makes this idempotent by dispute id and safe against the two
 * events arriving in the wrong order: a created that lands after its closed is
 * ignored rather than freezing the money again forever.
 *
 * A DISPUTE CAN OUTRUN ITS INVOICE, like a refund can: accrueForInvoice reads
 * these records and holds, or charges back, a commission that arrives late.
 */
const disputeKey = (chargeId: string, disputeId: string) => `dispute:${chargeId}:${disputeId}`;

export interface DisputeRecord {
  id: string;
  status: "open" | "won" | "lost";
  openedAt: string;
  closedAt?: string;
}

function parseDispute(cursor: string): DisputeRecord | null {
  try {
    return JSON.parse(cursor) as DisputeRecord;
  } catch {
    return null;
  }
}

export async function readDispute(chargeId: string, disputeId: string): Promise<DisputeRecord | null> {
  const row = await db.syncState.findUnique({ where: { key: disputeKey(chargeId, disputeId) } }).catch(() => null);
  return row ? parseDispute(row.cursor) : null;
}

/** Every dispute this payment has had, open or closed. */
export async function disputesOnCharge(chargeId: string): Promise<DisputeRecord[]> {
  const rows = await db.syncState
    .findMany({ where: { key: { startsWith: `dispute:${chargeId}:` } } })
    .catch(() => []);
  return rows.map((r) => parseDispute(r.cursor)).filter((r): r is DisputeRecord => r !== null);
}

async function writeDispute(chargeId: string, rec: DisputeRecord) {
  const cursor = JSON.stringify(rec);
  await db.syncState.upsert({
    where: { key: disputeKey(chargeId, rec.id) },
    update: { cursor },
    create: { key: disputeKey(chargeId, rec.id), cursor },
  });
}

/** Rows that are still ours to freeze or void: not paid, not in a payout. */
const unpaidRows = {
  OR: [
    { state: LedgerEntryState.PENDING },
    { state: LedgerEntryState.HELD },
    { state: LedgerEntryState.CLEARED, payoutTransferId: null },
  ],
};

function isUnpaid(row: { state: string; payoutTransferId: string | null }): boolean {
  return (
    row.state === LedgerEntryState.PENDING ||
    row.state === LedgerEntryState.HELD ||
    (row.state === LedgerEntryState.CLEARED && !row.payoutTransferId)
  );
}

/**
 * Freeze the commission on a payment that nobody has been paid yet: each unpaid
 * accrual with its refund reversals, so a partial refund cannot clear on its own
 * while the commission it reduces is frozen.
 *
 * A commission already paid out is left alone, and so is its refund clawback:
 * that clawback is money the partner owes back, and a debt is never frozen. It
 * goes on netting against the next payout — freezing it, as the first version
 * did, left it HELD for good once the dispute was lost, and that part of the
 * chargeback was never recovered.
 */
async function holdChargeRows(chargeId: string): Promise<number> {
  const accruals = await db.commissionLedger.findMany({
    where: { stripeChargeId: chargeId, entryType: LedgerEntryType.ACCRUED },
    select: { influencerId: true, stripeInvoiceId: true, state: true, payoutTransferId: true },
  });
  let held = 0;
  for (const a of accruals) {
    if (!a.stripeInvoiceId || !isUnpaid(a)) continue;
    const r = await db.commissionLedger.updateMany({
      where: {
        influencerId: a.influencerId,
        stripeInvoiceId: a.stripeInvoiceId,
        ...unpaidRows,
        NOT: { state: LedgerEntryState.HELD },
      },
      data: { state: LedgerEntryState.HELD, clearsAt: null },
    });
    held += r.count;
  }
  return held;
}

/**
 * Freeze again whatever these payments released while a dispute on them is
 * still open. The hold runs once, when the dispute opens, and skips money that
 * is in a payout at that moment — so a payout that is then refused, or a
 * reversed transfer an admin retries, hands those rows back as CLEARED. Called
 * by lib/payouts on every path that frees rows, and before rows are reserved.
 */
export async function holdOpenDisputes(chargeIds: Array<string | null>): Promise<number> {
  const wanted = new Set(chargeIds.filter((c): c is string => Boolean(c)));
  if (!wanted.size) return 0;
  const records = await db.syncState
    .findMany({ where: { key: { startsWith: "dispute:" } }, select: { key: true, cursor: true } })
    .catch(() => []);
  const open = new Set<string>();
  for (const r of records) {
    const chargeId = r.key.split(":")[1];
    if (wanted.has(chargeId) && parseDispute(r.cursor)?.status === "open") open.add(chargeId);
  }
  let held = 0;
  for (const chargeId of open) held += await holdChargeRows(chargeId);
  return held;
}

export async function holdForDispute(dispute: Stripe.Dispute, openedAt: Date = new Date()) {
  const chargeId = idOf(dispute.charge);
  if (!chargeId) return { skipped: "no-charge" as const };
  const known = await readDispute(chargeId, dispute.id);
  if (known && known.status !== "open") return { skipped: "already-closed" as const };
  if (!known) {
    await writeDispute(chargeId, { id: dispute.id, status: "open", openedAt: openedAt.toISOString() });
  }
  const heldRows = await holdChargeRows(chargeId);
  // Told once, when the freeze happens (a redelivered created event holds
  // nothing new and says nothing). Best-effort, after the ledger.
  if (heldRows > 0) await mailCommissionHeld(chargeId, openedAt);
  return { heldRows };
}

export async function settleDispute(dispute: Stripe.Dispute, eventId?: string, closedAt: Date = new Date()) {
  const chargeId = idOf(dispute.charge);
  if (!chargeId) return { skipped: "no-charge" as const };
  const known = await readDispute(chargeId, dispute.id);
  if (known && known.status !== "open") return { skipped: "already-closed" as const };
  const lost = dispute.status === "lost";
  // Written LAST, after the ledger has moved: if this run dies half way, the
  // webhook retry must find the dispute still open and finish the job. Every
  // step below is safe to repeat — releases only touch rows still HELD, and
  // each chargeback row is keyed by dispute + accrual.
  const closeRecord = () =>
    writeDispute(chargeId, {
      id: dispute.id,
      status: lost ? "lost" : "won",
      openedAt: known?.openedAt ?? new Date(dispute.created * 1000).toISOString(),
      closedAt: closedAt.toISOString(),
    });

  if (!lost) {
    // WON, or an inquiry closed without a chargeback: nothing is reversed. The
    // frozen rows go back to PENDING and the hold runs again from today — a
    // dispute that took six weeks must not let the money clear the day it ends.
    // Unless another dispute on the same payment is still open: the money stays
    // frozen for that one.
    const otherOpen = (await disputesOnCharge(chargeId)).some((d) => d.id !== dispute.id && d.status === "open");
    const held = otherOpen
      ? []
      : await db.commissionLedger.findMany({
          where: { stripeChargeId: chargeId, state: LedgerEntryState.HELD },
          select: { id: true, influencer: { select: { holdDays: true } } },
        });
    for (const r of held) {
      await db.commissionLedger.update({
        where: { id: r.id },
        data: {
          state: LedgerEntryState.PENDING,
          clearsAt: new Date(closedAt.getTime() + r.influencer.holdDays * 24 * 60 * 60 * 1000),
        },
      });
    }
    await closeRecord();
    return { released: held.length };
  }

  const reversedCents = await reverseForLostDispute(chargeId, dispute.id, eventId);
  await closeRecord();
  if (reversedCents > 0) await mailChargeback(dispute.id, closedAt);
  return { reversedCents };
}

/**
 * LOST: reverse the whole commission on this payment, like a full refund. Keyed
 * by dispute + accrual, so it runs from the closed event and again, harmlessly,
 * from an accrual that arrives after it (accrueForInvoice).
 */
async function reverseForLostDispute(chargeId: string, disputeId: string, eventId?: string): Promise<number> {
  const accruals = await db.commissionLedger.findMany({
    where: { stripeChargeId: chargeId, entryType: LedgerEntryType.ACCRUED },
  });
  let reversedTotal = 0;
  for (const accrual of accruals) {
    if (accrual.state === LedgerEntryState.VOID || !accrual.stripeInvoiceId) continue; // already settled
    const invoiceRows = { stripeInvoiceId: accrual.stripeInvoiceId, influencerId: accrual.influencerId };
    const row = {
      influencerId: accrual.influencerId,
      attributionId: accrual.attributionId,
      currency: accrual.currency,
      stripeInvoiceId: accrual.stripeInvoiceId,
      stripeChargeId: chargeId,
      stripeEventId: eventId ?? null,
      clearsAt: null,
    };

    const reversed = await db.$transaction(async (tx) => {
      if (isUnpaid(accrual)) {
        // Never paid: the accrual, its unpaid refund reversals and the chargeback
        // net to zero, so they are closed together as VOID — nothing clears,
        // nothing is paid, and the journal still shows what happened.
        const open = await tx.commissionLedger.findMany({
          where: { ...invoiceRows, ...unpaidRows },
          select: { amountCents: true },
        });
        const openCents = open.reduce((n, r) => n + r.amountCents, 0);
        await tx.commissionLedger.updateMany({
          where: { ...invoiceRows, ...unpaidRows },
          data: { state: LedgerEntryState.VOID, clearsAt: null },
        });
        if (openCents > 0) {
          await tx.commissionLedger.create({
            data: {
              ...row,
              entryType: LedgerEntryType.REVERSED,
              amountCents: -openCents,
              state: LedgerEntryState.VOID,
              idempotencyKey: `dispute:${disputeId}:${accrual.id}`,
              memo: `Chargeback — dispute ${disputeId} lost`,
            },
          });
        }
        // A refund of this payment that was already netted into a payout took
        // real money off the partner — for a commission that will now never be
        // paid. It comes back. Tied to its transfer if that transfer was
        // reversed, so it follows the admin's Retry or Write off with it.
        const settled = await tx.commissionLedger.findMany({
          where: {
            ...invoiceRows,
            entryType: LedgerEntryType.REVERSED,
            OR: [
              { state: LedgerEntryState.PAID },
              { state: LedgerEntryState.CLEARED, payoutTransferId: { not: null } },
              { state: LedgerEntryState.REVERSED_TRANSFER },
            ],
          },
          select: { id: true, amountCents: true, state: true, payoutTransferId: true },
        });
        let returned = 0;
        for (const r of settled) {
          const onReversed = r.state === LedgerEntryState.REVERSED_TRANSFER;
          await tx.commissionLedger.create({
            data: {
              ...row,
              entryType: LedgerEntryType.ADJUSTMENT,
              amountCents: -r.amountCents,
              state: onReversed ? LedgerEntryState.REVERSED_TRANSFER : LedgerEntryState.CLEARED,
              payoutTransferId: onReversed ? r.payoutTransferId : null,
              idempotencyKey: `dispute:${disputeId}:${accrual.id}:${r.id}`,
              memo: `Refund deduction returned — the commission it reduced was lost to dispute ${disputeId} and never paid`,
            },
          });
          returned += -r.amountCents;
        }
        return Math.max(0, openCents - returned);
      }

      // Paid already (or in a payout in flight): the chargeback is owed back, so
      // it waits CLEARED and nets against the next payout. On a reversed
      // transfer it waits with that transfer for the admin.
      const prior = await tx.commissionLedger.aggregate({
        where: { stripeInvoiceId: accrual.stripeInvoiceId, entryType: LedgerEntryType.REVERSED },
        _sum: { amountCents: true },
      });
      const delta = accrual.amountCents + (prior._sum.amountCents ?? 0); // reversals are negative
      // A clawback frozen by the first version of the hold goes back to netting.
      await tx.commissionLedger.updateMany({
        where: { ...invoiceRows, state: LedgerEntryState.HELD },
        data: { state: LedgerEntryState.CLEARED, payoutTransferId: null },
      });
      if (delta <= 0) return 0;
      const onReversed = accrual.state === LedgerEntryState.REVERSED_TRANSFER;
      await tx.commissionLedger.create({
        data: {
          ...row,
          entryType: LedgerEntryType.REVERSED,
          amountCents: -delta,
          state: onReversed ? LedgerEntryState.REVERSED_TRANSFER : LedgerEntryState.CLEARED,
          payoutTransferId: onReversed ? accrual.payoutTransferId : null,
          idempotencyKey: `dispute:${disputeId}:${accrual.id}`,
          memo: `Chargeback — dispute ${disputeId} lost`,
        },
      });
      return delta;
    }).catch((e: unknown) => {
      if (!isUniqueViolation(e)) throw e; // this dispute was already settled for this accrual
      return 0;
    });
    reversedTotal += reversed;
  }
  return reversedTotal;
}

// ── Connect account + transfer webhooks (Phase 4 reconcile) ──
export async function handleConnectAccountUpdate(account: Stripe.Account) {
  const inf = await db.influencer.findUnique({ where: { connectAccountId: account.id } });
  if (!inf) return;
  const enabled = Boolean(account.payouts_enabled);
  await db.influencer.update({
    where: { id: inf.id },
    data: {
      payoutsEnabled: enabled,
      connectStatus: enabled
        ? ConnectStatus.ENABLED
        : account.details_submitted
          ? ConnectStatus.RESTRICTED
          : ConnectStatus.ONBOARDING,
    },
  });
}

/*
 * A REVERSED TRANSFER — NOT PAID TWICE, AND NOT LOST (owner, 2026-09-22).
 *
 * Before this, transfer.reversed set the transfer row to REVERSED and stopped:
 * the ledger still said PAID, "Paid out" still counted it, and the partner's
 * money was simply gone. Crediting it straight back to CLEARED is the opposite
 * mistake — a platform-initiated reversal (wrong payee, fraud, a recovered
 * dispute) would then be paid out again on the next run.
 *
 * So the rows this transfer paid move to REVERSED_TRANSFER: owed, visible, and
 * payable only after an admin chooses Retry payout (lib/payouts,
 * releaseReversedPayout) or Write off (writeOffReversedPayout). The request is
 * marked REVERSED for that decision.
 *
 * The books stay honest by appending, never editing: the transfer's PAID entry
 * (−X) stays as history and an ADJUSTMENT of +X in state PAID offsets it, so the
 * balance is again X owed, "paid out" drops by X, and the PAID bucket nets to
 * zero. Idempotent by transfer id: a transfer already REVERSED is left alone,
 * and the offset is keyed transfer-reversed:<tr_id>.
 *
 * A PARTIAL reversal is not guessed at: the rows cannot be split, so the
 * transfer is annotated and the Health row asks a person to settle it.
 */
export async function handleTransferEvent(transfer: Stripe.Transfer, reversed: boolean, at: Date = new Date()) {
  const row = await db.payoutTransfer.findUnique({ where: { stripeTransferId: transfer.id } });
  if (!row || !reversed) return { skipped: "not-ours-or-not-reversed" as const };
  if (row.status === PayoutTransferStatus.REVERSED) return { skipped: "already-reversed" as const };

  const reversedCents = transfer.amount_reversed ?? 0;
  const whole = transfer.reversed === true || reversedCents >= row.amountCents;
  if (!whole) {
    await db.payoutTransfer.update({
      where: { id: row.id },
      data: {
        failureReason: `Partially reversed: $${(reversedCents / 100).toFixed(2)} of $${(row.amountCents / 100).toFixed(2)} — settle it in Stripe, then here.`,
      },
    });
    return { skipped: "partial-reversal" as const };
  }

  const when = at.toISOString().slice(0, 10);

  const moved = await db.$transaction(async (tx) => {
    // Re-read inside the transaction: the payout run closing its books and this
    // reversal can land together, and each must see what the other wrote.
    const current = await tx.payoutTransfer.findUnique({ where: { id: row.id }, select: { status: true } });
    if (current?.status === PayoutTransferStatus.REVERSED) return null;
    const booksClosed = await tx.commissionLedger.findFirst({
      where: { payoutTransferId: row.id, entryType: LedgerEntryType.PAID },
      select: { id: true },
    });
    // The rows this transfer paid (or had reserved, if the books never closed).
    const paidRows = {
      payoutTransferId: row.id,
      entryType: { not: LedgerEntryType.PAID },
      state: { in: [LedgerEntryState.PAID, LedgerEntryState.CLEARED] },
    };
    const accruals = await tx.commissionLedger.findMany({
      where: { ...paidRows, entryType: LedgerEntryType.ACCRUED },
      select: { stripeInvoiceId: true },
    });
    const movedRows = await tx.commissionLedger.updateMany({
      where: paidRows,
      data: { state: LedgerEntryState.REVERSED_TRANSFER },
    });
    // A refund or a lost chargeback of a commission this transfer paid, written
    // after the payout, is a clawback not tied to any transfer. It waits with the
    // transfer too, so Retry payout returns the NET and Write off closes the NET
    // whichever order the events came in — left behind, it went on deducting
    // from later commissions after the commission itself was written off.
    const invoices = accruals.map((a) => a.stripeInvoiceId).filter((id): id is string => Boolean(id));
    if (invoices.length) {
      await tx.commissionLedger.updateMany({
        where: {
          influencerId: row.influencerId,
          stripeInvoiceId: { in: invoices },
          entryType: { in: [LedgerEntryType.REVERSED, LedgerEntryType.ADJUSTMENT] },
          state: LedgerEntryState.CLEARED,
          payoutTransferId: null,
        },
        data: { state: LedgerEntryState.REVERSED_TRANSFER, payoutTransferId: row.id },
      });
    }
    if (booksClosed) {
      await tx.commissionLedger.create({
        data: {
          influencerId: row.influencerId,
          attributionId: null,
          entryType: LedgerEntryType.ADJUSTMENT,
          amountCents: row.amountCents,
          currency: row.currency,
          state: LedgerEntryState.PAID,
          payoutTransferId: row.id,
          idempotencyKey: `transfer-reversed:${transfer.id}`,
          memo: `Transfer ${transfer.id} reversed by Stripe on ${when} — offsets its payout entry`,
        },
      });
    }
    await tx.payoutTransfer.update({
      where: { id: row.id },
      data: { status: PayoutTransferStatus.REVERSED, failureReason: `Reversed by Stripe on ${when}` },
    });
    if (row.payoutRequestId) {
      await tx.payoutRequest.update({
        where: { id: row.payoutRequestId },
        data: {
          status: PayoutRequestStatus.REVERSED,
          rejectedReason: `Transfer reversed by Stripe on ${when} — the money did not arrive.`,
        },
      });
    }
    return movedRows.count;
  }).catch((e: unknown) => {
    if (!isUniqueViolation(e)) throw e; // the offset for this transfer already exists
    return null;
  });
  if (moved === null) return { skipped: "already-reversed" as const };
  return { reversedRows: moved };
}

function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code?: string }).code === "P2002"
  );
}
