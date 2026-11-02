import "server-only";
// THE SUBSCRIBERS READ (moved out of actions/subscribers on 2026-11-02, unchanged): the Stripe subscriptions, or
// the platform's own record, as rows — the facts the MRR rule (billing-metrics) reads. A "use server" file makes
// every export a public action, so the unguarded read lives here and each caller guards it.
import { onFreePlan } from "@/lib/freePlan";
import type Stripe from "stripe";
import { db } from "@/lib/db";
import { getStripe, isStripeEnabled } from "@/lib/sdk/stripe";
import { mirrorStatusFor } from "@/lib/stripeStatus";
import { discountRef, subscriptionPeriodEndDate } from "@/lib/stripeCompat";
import { getMonthlyCentsBySlugUpper, getPlanNamesBySlug } from "@/lib/planCatalogServer";
import { planDisplayName } from "@/lib/planCatalog";
import {
  computeMetrics,
  modalValue,
  PAID_STATUSES,
  STRIPE_MAX_PAGES,
  STRIPE_PAGE_SIZE,
  type BillingFacts,
  type BillingMetrics,
  type ChangeKind,
  type MatchedBy,
  type MrrExclusion,
  type PricedBy,
} from "@/components/v3/admin-subscribers/billing-metrics";
import { customPriceCents, normalizeCustomPages } from "@/lib/customPlan";
import { CARD_EXPAND, expandedCustomer, NO_CARD, paymentCardOf, paymentCardsFor, type PaymentCard } from "@/lib/paymentCard";
import { planLine } from "@/lib/deckAddon";

// The MRR rule itself lives in that module — see its header. This file only
// establishes the FACTS each rule reads: which organization a subscription
// belongs to, what it bills a month, in what currency, and when it last moved.
// No price is ever invented here: a plan whose amount no source can name
// contributes 0 and is counted, not guessed at.

export interface SubscriberRow extends BillingFacts {
  /** Stripe subscription id when Stripe-sourced; the Subscription row id otherwise. */
  id: string;
  /** The plan's catalog name — what the page prints; `plan` (the slug) stays a key. */
  planName: string;
  source: "stripe" | "record";
  organizationId: string | null;
  /** Org name when linked, else the Stripe customer's name/email. */
  orgName: string;
  ownerEmail: string | null;
  customerEmail: string | null;
  /** "STRIPE" | "MANUAL". */
  provider: string;
  stripeBacked: boolean;
  externalSubId: string | null;
  stripeCustomerId: string | null;
  influencerName: string | null;
  currentPeriodEnd: Date | null;
  createdAt: Date;
  /** The newest timestamp the source actually reports — never a synthesised now(). */
  changedAt: Date;
  /** What that timestamp IS, so no creation date reads as a change. */
  changeKind: ChangeKind;
  /** How it pays (lib/paymentCard), read live from Stripe. "No card" for a row
   *  with no Stripe subscription behind it; null when cards were not asked
   *  for, Stripe was not read, or its subscription was not in the read —
   *  unknown, not "No card". */
  card: PaymentCard | null;
  /** The organization is on the Free plan (lib/freePlan): this is its
   *  current subscription, ended. The page lists it as "Free (was <plan>)";
   *  any other ended subscription (one an upgrade replaced) stays hidden. */
  onFree: boolean;
}

export interface SubscribersData {
  rows: SubscriberRow[];
  metrics: BillingMetrics;
  /** STRIPE_SECRET_KEY is set. */
  stripeEnabled: boolean;
  /** The rows + metrics came from a live Stripe call. */
  stripeLive: boolean;
  /** Set only when Stripe IS configured and the live call failed. */
  stripeError: string | null;
  /** More Stripe subscriptions exist than were fetched — the metrics are partial. */
  truncated: boolean;
}

/** One organization, however it was reached. */
interface OrgInfo {
  id: string;
  name: string;
  billingEmail: string | null;
  ownerEmail: string | null;
}


/** Owner email + billing email for a row's "who is this" line. */
const ORG_FIELDS = {
  id: true,
  name: true,
  billingEmail: true,
  memberships: {
    where: { role: "OWNER" },
    orderBy: { createdAt: "asc" },
    take: 1,
    select: { user: { select: { email: true } } },
  },
} as const;

type OrgShape = {
  id: string;
  name: string;
  billingEmail: string | null;
  memberships: { user: { email: string } | null }[];
};

function orgInfo(o: OrgShape): OrgInfo {
  return {
    id: o.id,
    name: o.name,
    billingEmail: o.billingEmail,
    ownerEmail: o.memberships[0]?.user?.email ?? null,
  };
}

/**
 * Index rows by a Stripe id, DROPPING any id two rows share. Neither
 * `externalSubId` nor `externalCustomerId` is @unique in the schema while
 * `organizationId` is — so a shared id means two organizations claim the same
 * Stripe object. Keeping whichever row came back last is how a paid plan lands
 * on the wrong org; an ambiguous id resolves to nobody instead.
 */
function uniqueBy<T>(rows: readonly T[], key: (r: T) => string | null): Map<string, T> {
  const map = new Map<string, T>();
  const shared = new Set<string>();
  for (const r of rows) {
    const k = key(r);
    if (!k) continue;
    if (map.has(k)) shared.add(k);
    else map.set(k, r);
  }
  for (const k of shared) map.delete(k);
  return map;
}

/** Normalize a monthly-equivalent amount (cents) for any recurring Stripe price. */
function monthlyCentsFor(price: Stripe.Price | null | undefined, quantity: number): number {
  if (!price || !price.recurring) return 0; // one-time prices don't recur
  const amt = price.unit_amount ?? 0;
  const count = price.recurring.interval_count ?? 1;
  const perMonth =
    price.recurring.interval === "year"
      ? amt / (12 * count)
      : price.recurring.interval === "week"
        ? (amt * 52) / (12 * count)
        : price.recurring.interval === "day"
          ? (amt * 365) / (12 * count)
          : amt / count;
  return Math.round(perMonth * quantity);
}

/** A PlanPrice ledger row, normalised to one month. */
function monthlyCentsFromPlanPrice(unitAmountCents: number, interval: string): number {
  return interval.toUpperCase() === "YEAR"
    ? Math.round(unitAmountCents / 12)
    : unitAmountCents;
}

/**
 * The coupon that keeps reducing the run rate. A subscription discount
 * overrides a customer-wide one (Stripe's own precedence); a `once` coupon
 * reduces a single invoice, not recurring revenue; a repeating coupon whose
 * run has ended reduces nothing.
 */
type StandingDiscount = { discount: Stripe.Discount; coupon: Stripe.Coupon };

/* Clover sends a discount's coupon as an id under `source` (the old payload
   carried the object as `discount.coupon`), so the coupons are fetched once
   per page load and looked up here. */
type CouponBook = Map<string, Stripe.Coupon>;

function couponIdOf(d: Stripe.Discount | null | undefined): string | null {
  return d ? discountRef(d)?.couponId ?? null : null;
}

function couponOf(d: Stripe.Discount, coupons: CouponBook): Stripe.Coupon | null {
  const old = (d as unknown as { coupon?: Stripe.Coupon | null }).coupon;
  if (old && typeof old === "object") return old;
  const c = d.source?.coupon;
  if (c && typeof c === "object") return c;
  return typeof c === "string" ? (coupons.get(c) ?? null) : null;
}

/** The subscription's own discount: the old single field, else the first
 *  expanded entry of `discounts`. */
export function subscriptionDiscount(sub: Stripe.Subscription): Stripe.Discount | null {
  const old = (sub as unknown as { discount?: Stripe.Discount | null }).discount;
  if (old) return old;
  return (sub.discounts ?? []).find((d): d is Stripe.Discount => typeof d === "object" && d !== null) ?? null;
}

async function loadCoupons(stripe: Stripe, ids: Iterable<string>): Promise<CouponBook> {
  const book: CouponBook = new Map();
  await Promise.all(
    [...new Set(ids)].map((id) =>
      stripe.coupons
        .retrieve(id, { expand: ["applies_to"] })
        .then((c) => void book.set(id, c))
        .catch(() => {}),
    ),
  );
  return book;
}

function standingDiscount(
  sub: Stripe.Subscription,
  cust: Stripe.Customer | null,
  coupons: CouponBook,
): StandingDiscount | null {
  const d = subscriptionDiscount(sub) ?? cust?.discount ?? null;
  if (!d) return null;
  const coupon = couponOf(d, coupons);
  if (!coupon) return null;
  if (coupon.duration === "once") return null;
  if (d.end && d.end * 1000 <= Date.now()) return null;
  return { discount: d, coupon };
}

/**
 * A coupon narrowed by `applies_to.products` reduces only the items carrying
 * those products, but nothing here knows which item is which product (the
 * product is two expansion levels past what Stripe will return in one call).
 * The coupon is still taken off the whole subscription — the pre-existing
 * behaviour, so the total does not move — and the row is counted as understated
 * rather than left looking exact.
 */
function isProductRestricted(d: StandingDiscount | null): boolean {
  const products = d?.coupon.applies_to?.products;
  return Array.isArray(products) && products.length > 0;
}

function afterDiscount(cents: number, currency: string, d: StandingDiscount | null): number {
  const c = d?.coupon;
  if (!c) return cents;
  if (c.percent_off) return Math.round(cents * (1 - c.percent_off / 100));
  // A fixed coupon is denominated in its own currency — subtracting euros
  // from dollars would be worse than reporting the undiscounted amount.
  if (c.amount_off && (!c.currency || c.currency.toLowerCase() === currency)) {
    return Math.max(0, cents - c.amount_off);
  }
  return cents;
}

/**
 * The newest timestamp Stripe reports, and which one it is.
 *
 * `canceled_at` is NOT the moment a subscription ended. Stripe stamps it when
 * a cancellation is BOOKED, so a trialing subscription with
 * `cancel_at_period_end: true` carries it while still running and still
 * billing — reading it as "canceled" printed CANCELED beside a live TRIALING
 * badge. A subscription is over only when `ended_at` is set or the status
 * itself says `canceled`; the booking is a real event with its own wording.
 */
function lastEventOf(sub: Stripe.Subscription): { at: Date; kind: ChangeKind } {
  const ended = sub.ended_at ?? 0;
  const canceled = sub.canceled_at ?? 0;
  const over = Boolean(ended) || sub.status === "canceled";
  if (ended && ended >= canceled && ended >= sub.created) {
    return { at: new Date(ended * 1000), kind: "ended" };
  }
  if (canceled && canceled >= sub.created) {
    return { at: new Date(canceled * 1000), kind: over ? "canceled" : "cancel-scheduled" };
  }
  return { at: new Date(sub.created * 1000), kind: "created" };
}

/**
 * Plan label. The PlanPrice ledger comes first: it is what every write path
 * (the webhooks, the reconcile cron, the admin sync) names a plan by, so the
 * badge here must say the same thing — a subscription on an older Stripe price
 * otherwise read as one plan in this list and another in its stored row. Only
 * a price the ledger has never seen falls through to the checkout metadata.
 */
function planFor(sub: Stripe.Subscription, slugByPrice: ReadonlyMap<string, string>): string {
  const priceId = planLine(sub.items.data)?.price?.id;
  const ledgerSlug = priceId ? slugByPrice.get(priceId) : undefined;
  if (ledgerSlug) return ledgerSlug;
  const m = sub.metadata ?? {};
  // The custom plan's prices are not in the ledger (lib/customBilling).
  if (sub.items.data.some((i) => /^custom(-base|-page)?$/.test(i.price?.metadata?.jfKind ?? ""))) return "CUSTOM";
  if (m.planTier) return m.planTier.toUpperCase();
  if (m.planName) return m.planName.toUpperCase();
  if (m.planSlug) return m.planSlug.toUpperCase();
  const price = planLine(sub.items.data)?.price;
  const pm = price?.metadata ?? {};
  if (pm.planName) return pm.planName.toUpperCase();
  if (pm.planSlug) return pm.planSlug.toUpperCase();
  return price?.nickname?.toUpperCase() ?? "—";
}

function customerIdOf(sub: Stripe.Subscription): string {
  return typeof sub.customer === "string" ? sub.customer : sub.customer.id;
}

/** A metadata key off the subscription, falling back to its expanded customer. */
function metaOf(sub: Stripe.Subscription, key: string): string | null {
  return sub.metadata?.[key] || expandedCustomer(sub)?.metadata?.[key] || null;
}

/** The one deterministic membership: an OWNER seat, else the oldest seat. */
function pickMembership<T extends { role: string }>(memberships: T[]): T | undefined {
  return memberships.find((m) => m.role === "OWNER") ?? memberships[0];
}

/** The subscribers read, unguarded: each caller guards it — getSubscribersData (a platform admin) and the
 *  investor figures (lib/investors, totals only). `cards`: also read how each subscription pays (the Card column
 *  on /admin/subscribers). Off for the pages that only need the billing figures — it widens the Stripe read and
 *  may add a round of payment-method lookups. */
export async function readSubscribersData(opts: { cards?: boolean } = {}): Promise<SubscribersData> {
  const stripeEnabled = isStripeEnabled();

  if (stripeEnabled) {
    try {
      return await labelCustomRows(await fromStripe(Boolean(opts.cards)));
    } catch (err) {
      // Configured but unreachable is NOT the same as not configured, and the
      // page says which. Fall through to the platform's own record so the
      // list still renders.
      const message = err instanceof Error ? err.message : String(err);
      console.error("[subscribers] live Stripe fetch failed, using the platform record:", err);
      return await labelCustomRows(await fromRecord(true, message.slice(0, 300)));
    }
  }
  return await labelCustomRows(await fromRecord(false, null));
}

/** "Custom · 3 pages · $50" (owner, 2026-10-06): a custom plan's row names
 *  the pages the org holds (our record, lib/customBilling) and what it bills.
 *  When the bill is not what those pages cost, the row says so. */
async function labelCustomRows(data: SubscribersData): Promise<SubscribersData> {
  const custom = data.rows.filter((r) => r.plan.toUpperCase() === "CUSTOM" && r.organizationId);
  if (!custom.length) return data;
  const pageRows = await db.syncState.findMany({
    where: { key: { in: custom.map((r) => `orgPages:${r.organizationId}`) } },
    select: { key: true, cursor: true },
  });
  const pagesByOrg = new Map(
    pageRows.map((r) => {
      let pages: string[] = [];
      try {
        pages = normalizeCustomPages(JSON.parse(r.cursor) as string[]);
      } catch {
        pages = [];
      }
      return [r.key.slice("orgPages:".length), pages] as const;
    }),
  );
  const money = (c: number) => (Number.isInteger(c / 100) ? `$${c / 100}` : `$${(c / 100).toFixed(2)}`);
  for (const r of custom) {
    const pages = pagesByOrg.get(r.organizationId!) ?? [];
    const priced = customPriceCents(pages);
    const billed = r.source === "stripe" ? r.amountCents : priced;
    const n = pages.length;
    r.planName = `Custom · ${n} page${n === 1 ? "" : "s"} · ${money(billed)}${r.source === "stripe" && billed !== priced && !r.comped ? ` (pages cost ${money(priced)})` : ""}`;
  }
  return data;
}

// ── Stripe-sourced: the list IS the set of Stripe subscriptions ────────────

async function fromStripe(withCards: boolean): Promise<SubscribersData> {
  const stripe = getStripe();
  const subs: Stripe.Subscription[] = [];
  let startingAfter: string | undefined;
  let truncated = false;
  // Only expand the customer (and, for the Card column, the payment methods the
  // subscription and its customer point at — lib/paymentCard CARD_EXPAND, four
  // levels at the deepest). Price/plan are included by default on items; expanding
  // `data.items.data.price.product` is 5 levels deep and Stripe rejects
  // expansion beyond 4.
  for (let page = 0; page < STRIPE_MAX_PAGES; page++) {
    const res = await stripe.subscriptions.list({
      status: "all",
      limit: STRIPE_PAGE_SIZE,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
      expand: withCards ? [...CARD_EXPAND, "data.discounts"] : ["data.customer", "data.discounts"],
    });
    subs.push(...res.data);
    if (!res.has_more || res.data.length === 0) break;
    startingAfter = res.data[res.data.length - 1].id;
    if (page === STRIPE_MAX_PAGES - 1) truncated = true;
  }

  // Step 4 of the card rule (one attached card) for the customers the list left
  // empty — one parallel round, run beside the coupon and database reads.
  // Canceled subscriptions are not listed on the page, so they are not asked about.
  const cardsPending = withCards
    ? paymentCardsFor(stripe, subs.filter((sub) => sub.status !== "canceled"))
    : Promise.resolve(null);

  const coupons = await loadCoupons(
    stripe,
    subs.flatMap((sub) =>
      [subscriptionDiscount(sub), expandedCustomer(sub)?.discount ?? null]
        .map(couponIdOf)
        .filter((id): id is string => Boolean(id)),
    ),
  );

  // Link keys, in the order they are trusted.
  const metaOrgIds = new Set<string>();
  const metaUserIds = new Set<string>();
  const subIds: string[] = [];
  for (const sub of subs) {
    const o = metaOf(sub, "organizationId");
    if (o) metaOrgIds.add(o);
    const u = metaOf(sub, "userId");
    if (u) metaUserIds.add(u);
    subIds.push(sub.id);
  }

  const [accountCurrency, orgs, users, records, attributions] = await Promise.all([
    accountDefaultCurrency(stripe),
    metaOrgIds.size
      ? db.organization.findMany({ where: { id: { in: [...metaOrgIds] } }, select: ORG_FIELDS })
      : Promise.resolve([]),
    metaUserIds.size
      ? db.user.findMany({
          where: { id: { in: [...metaUserIds] } },
          select: {
            id: true,
            memberships: {
              // Deterministic: the same membership every time this runs.
              orderBy: [{ createdAt: "asc" }, { organizationId: "asc" }],
              select: { role: true, organization: { select: ORG_FIELDS } },
            },
          },
        })
      : Promise.resolve([]),
    // Every record row, not just the ones Stripe can be matched to: the
    // admin grants among them have no Stripe subscription by definition, and
    // leaving them out is what let this page and /admin/users disagree about
    // who is on a plan.
    db.subscription.findMany({ include: { organization: { select: ORG_FIELDS } } }),
    db.attribution.findMany({
      where: { stripeSubscriptionId: { in: subIds } },
      include: {
        promoCode: { select: { code: true } },
        influencer: { select: { displayName: true } },
      },
    }),
  ]);

  const orgById = new Map(orgs.map((o) => [o.id, orgInfo(o)]));
  const userById = new Map(users.map((u) => [u.id, u]));
  // Neither externalSubId nor externalCustomerId is @unique in the schema, so
  // two record rows can hold the same Stripe id. A plain Map would keep
  // whichever Prisma returned last and hand this subscription to a coin-flip
  // organization; an ambiguous key resolves to nobody instead.
  const recordBySubId = uniqueBy(records, (r) => r.externalSubId);
  const recordByCustId = uniqueBy(records, (r) => r.externalCustomerId);
  const attrBySub = new Map(attributions.map((a) => [a.stripeSubscriptionId, a]));
  // Small table, read whole: the ledger names a plan for any price it knows,
  // archived rows included — an old price that still bills is still that plan.
  const ledger = await db.planPrice.findMany({ select: { stripePriceId: true, planSlug: true } });
  const slugByPrice = new Map(ledger.map((p) => [p.stripePriceId, p.planSlug.toUpperCase()]));
  const planNames = await getPlanNamesBySlug();
  const cardBook = (await cardsPending)?.cards ?? null;

  // The account's own currency decides what the total is denominated in. A
  // restricted key may not read the account; the commonest currency on the
  // subscriptions themselves answers instead.
  const primaryCurrency =
    accountCurrency ?? modalValue(subs.map((s) => s.currency ?? "")) ?? "usd";

  const rows: SubscriberRow[] = subs.map((sub) => {
    const cust = expandedCustomer(sub);
    const custEmail = cust?.email ?? null;
    const attr = attrBySub.get(sub.id);

    // ── the link, most direct first ──────────────────────────────────
    // 1. organizationId, stamped on the subscription at checkout
    //    (src/app/api/checkout/subscription/route.ts).
    // 2. the platform's own Subscription row, keyed by the Stripe ids.
    // 3. metadata.userId — legacy; this deployment has never written it.
    // Never by name or email.
    let org: OrgInfo | null = null;
    let matchedBy: MatchedBy = "none";
    // Did Stripe name ANYONE? "named an id this database can't resolve" and
    // "named nobody" are different failures and the operator has to tell them
    // apart — one is a data-migration problem, the other is a checkout that
    // never stamped its metadata.
    const metaOrgId = metaOf(sub, "organizationId");
    const metaUserId = metaOf(sub, "userId");

    if (metaOrgId) {
      const hit = orgById.get(metaOrgId);
      if (hit) {
        org = hit;
        matchedBy = "stripe-org";
      }
    }
    if (!org) {
      const record = recordBySubId.get(sub.id) ?? recordByCustId.get(customerIdOf(sub));
      if (record) {
        org = orgInfo(record.organization);
        matchedBy = "record";
      }
    }
    if (!org) {
      const user = metaUserId ? userById.get(metaUserId) : undefined;
      const membership = user ? pickMembership(user.memberships) : undefined;
      if (membership) {
        org = orgInfo(membership.organization);
        matchedBy = "stripe-user";
      }
    }
    if (!org && (metaOrgId || metaUserId)) matchedBy = "stale-id";

    // ── the amount ────────────────────────────────────────────────────
    const currency = (sub.currency || primaryCurrency).toLowerCase();
    // Only recurring items belong in a run rate. Of those, one that prices at
    // null (metered, tiered) contributes nothing it can name — the subscription
    // is then priced from the REST, which is a floor, and the row says so
    // instead of reading as an exact figure.
    const recurringItems = sub.items.data.filter((i) => i.price?.recurring);
    const priceable = recurringItems.filter((i) => i.price?.unit_amount != null);
    const gross = priceable.reduce((a, i) => a + monthlyCentsFor(i.price, i.quantity ?? 1), 0);
    const discount = standingDiscount(sub, cust, coupons);
    const amountCents = afterDiscount(gross, currency, discount);
    const pricedBy: PricedBy =
      priceable.length === 0
        ? "none"
        : priceable.length < recurringItems.length
          ? "stripe-partial"
          : "stripe";

    // ── the rule ──────────────────────────────────────────────────────
    const status = mirrorStatusFor(sub);
    const paused = Boolean(sub.pause_collection);
    const mrrExcludedFor: MrrExclusion =
      status !== "ACTIVE"
        ? "status"
        : paused
          ? "paused"
          : currency !== primaryCurrency
            ? "currency"
            : null;

    const event = lastEventOf(sub);

    const plan = planFor(sub, slugByPrice);
    return {
      id: sub.id,
      source: "stripe",
      organizationId: org?.id ?? null,
      orgName: org?.name ?? cust?.name ?? custEmail ?? "Unknown customer",
      ownerEmail: org?.ownerEmail ?? org?.billingEmail ?? custEmail,
      customerEmail: custEmail,
      plan,
      planName: plan === "—" ? "—" : planDisplayName(plan, planNames),
      status,
      paid: PAID_STATUSES.has(status) && !paused,
      paused,
      comped: false, // a Stripe subscription is an invoice, never a grant
      stripeConfirmed: true,
      restrictedDiscount: isProductRestricted(discount),
      countsTowardMrr: mrrExcludedFor === null,
      mrrExcludedFor,
      matchedBy,
      pricedBy,
      provider: "STRIPE",
      stripeBacked: true,
      externalSubId: sub.id,
      stripeCustomerId: customerIdOf(sub),
      amountCents,
      currency,
      promoCode: attr?.promoCode.code ?? null,
      influencerName: attr?.influencer.displayName ?? null,
      currentPeriodEnd: subscriptionPeriodEndDate(sub),
      createdAt: new Date(sub.created * 1000),
      changedAt: event.at,
      changeKind: event.kind,
      card: cardBook ? (cardBook.has(sub.id) ? cardBook.get(sub.id)! : paymentCardOf(sub, cust)) : null,
      onFree: isFreeRecord(status, recordBySubId.get(sub.id), sub.id),
    };
  });

  // ── the platform's own rows, reconciled against what Stripe returned ──
  //
  // A MIRROR row survives unless the Stripe read already returned the very
  // subscription it mirrors. A HAND GRANT always survives — see the hand-grant
  // rule in billing-metrics.ts. Two kinds of row reach the list this way and
  // both used to vanish:
  //   · an admin grant (provider MANUAL). It was dropped whenever it carried
  //     the id of a subscription Stripe returned — which is exactly the
  //     churn-then-comp case: the org checked out, canceled, and was comped on
  //     top of the row that still named the canceled `sub_…`. The limits engine
  //     goes on obeying the grant, so dropping it made this page contradict
  //     both the product and /admin/users;
  //   · a provider "STRIPE" row whose subscription the account did not return
  //     (key rotation, a deleted subscription). It vanished here while
  //     /admin/users still showed it — the disagreement this read model exists
  //     to end.
  // Neither is ever added to MRR: a grant is not an invoice, and an
  // unconfirmed row is money the account we just read did not confirm.
  const returnedSubIds = new Set(rows.map((r) => r.externalSubId).filter(Boolean) as string[]);
  for (const r of records) {
    const comped = r.provider === "MANUAL";
    if (!comped && r.externalSubId && returnedSubIds.has(r.externalSubId)) continue;
    const org = orgInfo(r.organization);
    const status = r.status.toUpperCase();
    const attr = r.externalSubId ? attrBySub.get(r.externalSubId) : undefined;
    rows.push({
      id: r.id,
      source: "record",
      organizationId: org.id,
      orgName: org.name,
      ownerEmail: org.ownerEmail ?? org.billingEmail,
      customerEmail: null,
      plan: r.plan,
      planName: planDisplayName(r.plan, planNames),
      status,
      // Stripe is the source on this path and it did not bill for this row.
      paid: false,
      paused: false,
      comped,
      // Stripe was read. It confirmed this row only if it returned the very
      // subscription the row names — and a grant mirrors no subscription, so
      // it is not something Stripe can confirm or deny at all, whether or not
      // it still carries an id from before it was granted.
      stripeConfirmed: comped ? null : false,
      restrictedDiscount: false,
      countsTowardMrr: false,
      mrrExcludedFor: status !== "ACTIVE" ? "status" : comped ? "comped" : "unconfirmed",
      matchedBy: "record",
      pricedBy: "none",
      provider: r.provider,
      // A grant mirrors no subscription, even when an older write left an id on it.
      stripeBacked: !comped && Boolean(r.externalSubId),
      externalSubId: r.externalSubId,
      stripeCustomerId: r.externalCustomerId,
      amountCents: 0,
      currency: primaryCurrency,
      promoCode: attr?.promoCode.code ?? null,
      influencerName: attr?.influencer.displayName ?? null,
      currentPeriodEnd: r.currentPeriodEnd,
      createdAt: r.createdAt,
      changedAt: r.updatedAt,
      changeKind: "updated",
      // A grant, a carried-over v2 record or a free row has no subscription to
      // pay with: "No card". A row naming a subscription this read did not
      // return is unknown, not "No card" — the account may hold it where a
      // list cannot see it (a sandbox subscription on a test clock is left out
      // of every list that does not name the clock or the customer).
      card: withCards && (comped || !r.externalSubId) ? NO_CARD : null,
      onFree: onFreePlan(r),
    });
  }

  return {
    rows,
    metrics: computeMetrics(rows, primaryCurrency),
    stripeEnabled: true,
    stripeLive: true,
    stripeError: null,
    truncated,
  };
}

/**
 * The account's own currency, or null when the key may not read the account
 * (a restricted key often cannot) — the commonest currency on the
 * subscriptions then answers instead. Memoised: an account's currency does
 * not change, and three admin pages each ask on every render.
 */
let currencyMemo: { at: number; value: string | null } | null = null;
const CURRENCY_TTL_MS = 10 * 60 * 1000;

async function accountDefaultCurrency(stripe: Stripe): Promise<string | null> {
  if (currencyMemo && Date.now() - currencyMemo.at < CURRENCY_TTL_MS) return currencyMemo.value;
  let value: string | null = null;
  try {
    const account = await stripe.accounts.retrieve();
    value = account.default_currency?.toLowerCase() ?? null;
  } catch {
    value = null;
  }
  currencyMemo = { at: Date.now(), value };
  return value;
}

/** A Stripe row is the org's Free plan when the org's own record still names
 *  this very subscription and holds it as ended (lib/freePlan). */
function isFreeRecord(status: string, record: { status: string; provider: string; externalSubId: string | null } | undefined, subId: string): boolean {
  return onFreePlan({ status }) && !!record && record.provider === "STRIPE" && record.externalSubId === subId && onFreePlan(record);
}

// ── The platform's own record: dev without Stripe, or Stripe unreachable ───

async function fromRecord(
  stripeEnabled: boolean,
  stripeError: string | null,
): Promise<SubscribersData> {
  const records = await db.subscription.findMany({
    include: { organization: { select: ORG_FIELDS } },
  });
  const priceIds = [
    ...new Set(records.map((r) => r.stripePriceId).filter(Boolean) as string[]),
  ];

  const [attributions, planPrices, catalogCents, planNames] = await Promise.all([
    db.attribution.findMany({
      include: {
        promoCode: { select: { code: true } },
        influencer: { select: { displayName: true } },
      },
    }),
    priceIds.length
      ? db.planPrice.findMany({
          where: { stripePriceId: { in: priceIds } },
          select: { stripePriceId: true, unitAmountCents: true, interval: true, currency: true },
        })
      : Promise.resolve([]),
    getMonthlyCentsBySlugUpper(),
    getPlanNamesBySlug(),
  ]);

  const attrBySub = new Map(attributions.map((a) => [a.stripeSubscriptionId, a]));
  const priceById = new Map(planPrices.map((p) => [p.stripePriceId, p]));
  const primaryCurrency = modalValue(planPrices.map((p) => p.currency)) ?? "usd";

  const rows: SubscriberRow[] = records.map((r) => {
    const org = orgInfo(r.organization);
    const attr = r.externalSubId ? attrBySub.get(r.externalSubId) : undefined;
    const status = r.status.toUpperCase();
    const comped = r.provider === "MANUAL";

    // The price the subscription actually carries, normalised to a month.
    // Only when there is no price link does the catalog's list price stand in
    // — and then the row says so, because a yearly plan priced from the
    // monthly catalog would overstate by a fifth.
    let amountCents = 0;
    let pricedBy: PricedBy = "none";
    let currency = primaryCurrency;
    const priceRow = r.stripePriceId ? priceById.get(r.stripePriceId) : undefined;
    if (priceRow) {
      amountCents = monthlyCentsFromPlanPrice(priceRow.unitAmountCents, priceRow.interval);
      currency = priceRow.currency.toLowerCase();
      pricedBy = "price-row";
    } else {
      const key = r.plan.toUpperCase();
      if (Object.prototype.hasOwnProperty.call(catalogCents, key)) {
        amountCents = catalogCents[key];
        pricedBy = "catalog";
      }
    }
    // A comp bills nothing, whatever the plan lists at.
    if (comped) {
      amountCents = 0;
      pricedBy = "none";
    }

    const mrrExcludedFor: MrrExclusion =
      status !== "ACTIVE"
        ? "status"
        : comped
          ? "comped"
          : currency !== primaryCurrency
            ? "currency"
            : null;

    return {
      id: r.id,
      source: "record",
      organizationId: org.id,
      orgName: org.name,
      ownerEmail: org.ownerEmail ?? org.billingEmail,
      customerEmail: null,
      plan: r.plan,
      planName: planDisplayName(r.plan, planNames),
      status,
      paid: PAID_STATUSES.has(status) && !comped,
      paused: false, // the record has no pause column; only Stripe knows
      comped,
      // Stripe was never read on this path, so nothing here confirms or
      // denies the row — that is not the same as Stripe denying it.
      stripeConfirmed: null,
      restrictedDiscount: false, // the record stores no coupon terms
      countsTowardMrr: mrrExcludedFor === null,
      mrrExcludedFor,
      matchedBy: "record",
      pricedBy,
      provider: r.provider,
      // A grant mirrors no subscription, even when an older write left an id on it.
      stripeBacked: !comped && Boolean(r.externalSubId),
      externalSubId: r.externalSubId,
      stripeCustomerId: r.externalCustomerId,
      amountCents,
      currency,
      promoCode: attr?.promoCode.code ?? null,
      influencerName: attr?.influencer.displayName ?? null,
      currentPeriodEnd: r.currentPeriodEnd,
      createdAt: r.createdAt,
      changedAt: r.updatedAt,
      changeKind: "updated",
      card: null, // Stripe was not read
      onFree: onFreePlan(r),
    };
  });

  return {
    rows,
    metrics: computeMetrics(rows, primaryCurrency),
    stripeEnabled,
    stripeLive: false,
    stripeError,
    truncated: false,
  };
}
