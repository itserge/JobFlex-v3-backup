// STRIPE MOCK — a development stand-in for the Stripe client.
//
// WHY. `.env.local` carries the LIVE key, so every admin rehearsal that touches
// a subscription (the plan editor, the reconcile cron, the subscribers list)
// would otherwise reach the real account. With STRIPE_MOCK_FILE=<path> every
// client `lib/sdk/stripe` hands out is this one instead: a JSON file holds the
// customers, prices, subscriptions and invoices, and every call is appended to
// `calls`, so a harness can assert what Stripe was asked to do — and what it
// was NOT asked to do. Nothing here is ever reached in production: the switch
// in lib/sdk/stripe refuses the mock under NODE_ENV=production.
//
// WHAT IT KNOWS. The subset the subscription paths use — subscriptions
// retrieve / update / cancel / list, invoices list / createPreview, customers,
// prices, accounts; and the refunds and disputes lists the investor page reads
// (lib/investorPayments), from rows a harness writes; the charges and invoice
// payments lists Admin → Revenue reads (empty unless a harness writes them).
// The lists page as the real client's do: awaited, one page; `for await`, every row. Anything else throws loudly ("not implemented"), which is
// the point: a path that reaches Stripe unexpectedly fails the rehearsal
// instead of quietly doing nothing.
//
// TIME. `store.clock` (unix seconds) is "now" for the mock when set, so a
// harness can walk the account forward. `runMockBilling(file)` does what
// Stripe's billing engine would do at that moment: a trial past its end goes
// active and is invoiced, an active period past its end renews (or ends, when
// cancel_at_period_end was booked). That is how "what happens at the end of
// the trial" is answered without waiting for it.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import type Stripe from "stripe";

type Meta = Record<string, string>;

export interface MockPrice {
  id: string;
  unit_amount: number | null;
  currency: string;
  recurring: { interval: "day" | "week" | "month" | "year"; interval_count: number } | null;
  nickname?: string | null;
  metadata?: Meta;
  product?: string;
  active?: boolean;
}

export interface MockCustomer {
  id: string;
  email: string | null;
  name?: string | null;
  metadata?: Meta;
  balance?: number;
  deleted?: boolean;
  /** The card on file (invoice default). `declines` makes every off-session charge fail. */
  card?: { id: string; brand: string; last4: string; declines?: boolean } | null;
}

/** An off-session or Checkout payment (lib/aiDesk/packs; lib/leadCenter/purchase). */
export interface MockPaymentIntent {
  id: string;
  object: "payment_intent";
  status: "succeeded" | "canceled" | "requires_payment_method";
  amount: number;
  amount_received: number;
  currency: string;
  customer: string | null;
  description?: string | null;
  metadata: Meta;
  created: number;
}

export interface MockCheckoutSession {
  id: string;
  object: "checkout.session";
  mode: string;
  url: string;
  payment_status: "unpaid" | "paid";
  payment_intent: string | null;
  amount_total: number;
  currency: string;
  customer: string | null;
  customer_details: { email: string | null } | null;
  metadata: Meta;
  client_reference_id: string | null;
  success_url: string;
  cancel_url: string;
  livemode: false;
  created: number;
}

export interface MockItem {
  id: string;
  price: MockPrice;
  quantity: number;
}

export interface MockSubscription {
  id: string;
  customer: string;
  status: Stripe.Subscription.Status;
  created: number;
  currency: string;
  current_period_start: number;
  current_period_end: number;
  trial_start: number | null;
  trial_end: number | null;
  cancel_at_period_end: boolean;
  canceled_at: number | null;
  ended_at: number | null;
  metadata: Meta;
  items: { data: MockItem[] };
  discount: null;
  default_payment_method: string | null;
  pause_collection: null;
  /** Proration lines booked by `create_prorations`, waiting for the next invoice. */
  pending_proration_cents?: number;
}

export interface MockInvoice {
  id: string;
  customer: string;
  subscription: string | null;
  status: "paid" | "open" | "draft";
  paid: boolean;
  amount_paid: number;
  amount_due: number;
  subtotal: number;
  total: number;
  currency: string;
  created: number;
  billing_reason: string;
  charge: string | null;
  number: string | null;
  hosted_invoice_url: string | null;
  invoice_pdf: string | null;
  lines: { data: Array<{ description: string; amount: number; period: { start: number; end: number }; proration?: boolean }> };
  description?: string;
}

/** A refund or a dispute as the investor page reads it: the payment it names, how much, and where it stands. */
export interface MockMoneyBack {
  id: string;
  amount: number;
  /** Refund: succeeded | pending | failed | canceled. Dispute: needs_response | under_review | won | lost … */
  status: string;
  charge: string | null;
  payment_intent: string | null;
  created: number;
}

export interface MockCall {
  at: number;
  method: string;
  args: unknown[];
}

export interface MockStore {
  /** Unix seconds; "now" for every call when set. */
  clock?: number;
  account?: { default_currency: string };
  customers: Record<string, MockCustomer>;
  prices: Record<string, MockPrice>;
  subscriptions: Record<string, MockSubscription>;
  invoices: MockInvoice[];
  calls: MockCall[];
  paymentIntents: Record<string, MockPaymentIntent>;
  checkouts: Record<string, MockCheckoutSession>;
  refunds?: MockMoneyBack[];
  disputes?: MockMoneyBack[];
  charges?: Array<{ id: string; created: number } & Record<string, unknown>>;
  invoicePayments?: Array<{ id: string; created: number } & Record<string, unknown>>;
}

export class MockStripeError extends Error {
  code: string;
  type: string;
  statusCode: number;
  constructor(message: string, code = "resource_missing", statusCode = 404) {
    super(message);
    this.name = "StripeInvalidRequestError";
    this.code = code;
    this.type = "StripeInvalidRequestError";
    this.statusCode = statusCode;
  }
}

const INTERVAL_SECONDS: Record<string, number> = {
  day: 86400,
  week: 7 * 86400,
  month: 30 * 86400,
  year: 365 * 86400,
};

export function emptyMockStore(): MockStore {
  return { customers: {}, prices: {}, subscriptions: {}, invoices: [], calls: [], paymentIntents: {}, checkouts: {} };
}

export function readMockStore(file: string): MockStore {
  if (!existsSync(file)) return emptyMockStore();
  const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<MockStore>;
  return { ...emptyMockStore(), ...raw };
}

export function writeMockStore(file: string, store: MockStore): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(store, null, 2), "utf8");
}

function nowOf(store: MockStore): number {
  return store.clock ?? Math.floor(Date.now() / 1000);
}

function periodSeconds(price: MockPrice): number {
  const r = price.recurring;
  if (!r) return INTERVAL_SECONDS.month;
  return INTERVAL_SECONDS[r.interval] * (r.interval_count || 1);
}

function subAmountCents(sub: MockSubscription): number {
  return sub.items.data.reduce((n, i) => n + (i.price.unit_amount ?? 0) * (i.quantity || 1), 0);
}

let invoiceSeq = 0;
function newInvoice(store: MockStore, sub: MockSubscription, amount: number, reason: string, lines: MockInvoice["lines"]["data"]): MockInvoice {
  const at = nowOf(store);
  invoiceSeq += 1;
  const id = `in_mock_${at}_${invoiceSeq}`;
  const inv: MockInvoice = {
    id,
    customer: sub.customer,
    subscription: sub.id,
    status: "paid",
    paid: true,
    amount_paid: amount,
    amount_due: amount,
    subtotal: amount,
    total: amount,
    currency: sub.currency,
    created: at,
    billing_reason: reason,
    charge: amount > 0 ? `ch_${id}` : null,
    number: `MOCK-${String(store.invoices.length + 1).padStart(4, "0")}`,
    hosted_invoice_url: null,
    invoice_pdf: null,
    lines: { data: lines },
  };
  store.invoices.push(inv);
  return inv;
}

/** Stripe's billing engine at `store.clock`: trials end, periods renew or end. */
export function runMockBilling(file: string): { invoiced: MockInvoice[]; ended: string[]; activated: string[] } {
  const store = readMockStore(file);
  const now = nowOf(store);
  const invoiced: MockInvoice[] = [];
  const ended: string[] = [];
  const activated: string[] = [];
  for (const sub of Object.values(store.subscriptions)) {
    if (sub.status === "canceled" || sub.status === "incomplete_expired") continue;
    if (sub.status === "trialing" && sub.trial_end !== null && sub.trial_end <= now) {
      if (sub.cancel_at_period_end) {
        sub.status = "canceled";
        sub.ended_at = now;
        ended.push(sub.id);
        continue;
      }
      sub.status = "active";
      sub.current_period_start = sub.trial_end;
      sub.current_period_end = sub.trial_end + periodSeconds(sub.items.data[0].price);
      activated.push(sub.id);
      const amount = subAmountCents(sub) + (sub.pending_proration_cents ?? 0);
      sub.pending_proration_cents = 0;
      invoiced.push(
        newInvoice(store, sub, amount, "subscription_cycle", [
          { description: `${sub.items.data[0].price.nickname ?? sub.items.data[0].price.id} — first paid period`, amount, period: { start: sub.current_period_start, end: sub.current_period_end } },
        ]),
      );
      continue;
    }
    if ((sub.status === "active" || sub.status === "past_due") && sub.current_period_end <= now) {
      if (sub.cancel_at_period_end) {
        sub.status = "canceled";
        sub.ended_at = sub.current_period_end;
        ended.push(sub.id);
        continue;
      }
      sub.current_period_start = sub.current_period_end;
      sub.current_period_end = sub.current_period_start + periodSeconds(sub.items.data[0].price);
      const amount = subAmountCents(sub) + (sub.pending_proration_cents ?? 0);
      sub.pending_proration_cents = 0;
      invoiced.push(
        newInvoice(store, sub, amount, "subscription_cycle", [
          { description: `${sub.items.data[0].price.nickname ?? sub.items.data[0].price.id} — renewal`, amount, period: { start: sub.current_period_start, end: sub.current_period_end } },
        ]),
      );
    }
  }
  writeMockStore(file, store);
  return { invoiced, ended, activated };
}

function expandCustomer(store: MockStore, sub: MockSubscription, expand: string[] | undefined) {
  const wants = (expand ?? []).some((e) => e === "customer" || e === "data.customer");
  if (!wants) return { ...sub };
  const c = store.customers[sub.customer];
  // A real customer always carries its invoice settings (Admin → Revenue reads the default method there).
  return { ...sub, customer: c ? { invoice_settings: { default_payment_method: null }, ...c, object: "customer" } : sub.customer };
}

type Params = Record<string, unknown>;

function record(store: MockStore, method: string, args: unknown[]) {
  store.calls.push({ at: nowOf(store), method, args: JSON.parse(JSON.stringify(args)) });
}

/** The proration Stripe would book for swapping `sub`'s price to `next` now. */
function prorationCents(store: MockStore, sub: MockSubscription, next: MockPrice): number {
  if (sub.status === "trialing") return 0; // nothing was paid for the trial period
  const now = nowOf(store);
  const total = Math.max(1, sub.current_period_end - sub.current_period_start);
  const remaining = Math.max(0, Math.min(total, sub.current_period_end - now));
  const oldCents = subAmountCents(sub);
  const newCents = (next.unit_amount ?? 0) * (sub.items.data[0]?.quantity || 1);
  return Math.round(((newCents - oldCents) * remaining) / total);
}

/** A NEW line's share of the rest of the period (0 in a trial), as Stripe prorates an added item. */
function addedLineCents(store: MockStore, sub: MockSubscription, price: MockPrice, quantity: number): number {
  if (sub.status === "trialing") return 0;
  const now = nowOf(store);
  const total = Math.max(1, sub.current_period_end - sub.current_period_start);
  const remaining = Math.max(0, Math.min(total, sub.current_period_end - now));
  return Math.round(((price.unit_amount ?? 0) * quantity * remaining) / total);
}

/** Build the client. Every call reads the file, acts, and writes it back. */
export function mockStripeClient(file: string): Stripe {
  const load = () => readMockStore(file);
  const save = (s: MockStore) => writeMockStore(file, s);

  const subscriptions = {
    async retrieve(id: string, params?: Params) {
      const s = load();
      record(s, "subscriptions.retrieve", [id, params]);
      save(s);
      const sub = s.subscriptions[id];
      if (!sub) throw new MockStripeError(`No such subscription: '${id}'`);
      return expandCustomer(s, sub, params?.expand as string[] | undefined);
    },
    async list(params?: Params) {
      const s = load();
      record(s, "subscriptions.list", [params]);
      save(s);
      let rows = Object.values(s.subscriptions);
      if (params?.customer) rows = rows.filter((r) => r.customer === params.customer);
      const status = params?.status as string | undefined;
      if (status && status !== "all") rows = rows.filter((r) => r.status === status);
      else if (!status) rows = rows.filter((r) => r.status !== "canceled");
      rows.sort((a, b) => b.created - a.created);
      // Pages, as Stripe does: `starting_after` an id, newest first.
      const after = params?.starting_after as string | undefined;
      if (after) rows = rows.slice(rows.findIndex((r) => r.id === after) + 1);
      const limit = Number(params?.limit ?? 10);
      const data = rows.slice(0, limit).map((r) => expandCustomer(s, r, params?.expand as string[] | undefined));
      return { object: "list", data, has_more: rows.length > limit, url: "/v1/subscriptions" };
    },
    async update(id: string, params: Params) {
      const s = load();
      record(s, "subscriptions.update", [id, params]);
      const sub = s.subscriptions[id];
      if (!sub) {
        save(s);
        throw new MockStripeError(`No such subscription: '${id}'`);
      }
      if (sub.status === "canceled") {
        save(s);
        throw new MockStripeError("A canceled subscription can only update its metadata.", "invalid_request", 400);
      }
      const now = nowOf(s);
      const invoiceLines: MockInvoice["lines"]["data"] = [];
      let invoiceNow = 0;

      const items = params.items as Array<{ id?: string; price?: string; quantity?: number; deleted?: boolean }> | undefined;
      if (items?.length) {
        const behavior = (params.proration_behavior as string | undefined) ?? "create_prorations";
        for (const it of items) {
          // As Stripe: `deleted` takes the line off; a line with a price and no id is a NEW line (the custom plan's
          // page quantity, the Deck Studio add-on — 2026-10-19; it used to overwrite the first line). A bare
          // quantity with no id still means the first line, as before.
          if (it.deleted && it.id) {
            sub.items.data = sub.items.data.filter((d) => d.id !== it.id);
            continue;
          }
          if (!it.id && it.price && sub.items.data.length) {
            const price = s.prices[it.price];
            if (!price) {
              save(s);
              throw new MockStripeError(`No such price: '${it.price}'`);
            }
            const line: MockItem = { id: `si_mock_${Date.now().toString(36)}_${sub.items.data.length}`, price: { ...price }, quantity: it.quantity ?? 1 };
            const delta = addedLineCents(s, sub, price, line.quantity);
            if (behavior === "always_invoice" && delta > 0) {
              invoiceNow += delta;
              invoiceLines.push({ description: `Proration — new line ${price.id}`, amount: delta, period: { start: now, end: sub.current_period_end }, proration: true });
            }
            sub.items.data.push(line);
            continue;
          }
          const target = it.id ? sub.items.data.find((d) => d.id === it.id) : sub.items.data[0];
          if (!target) throw new MockStripeError(`No such subscription item: '${it.id}'`);
          if (it.price && it.price !== target.price.id) {
            const price = s.prices[it.price];
            if (!price) {
              save(s);
              throw new MockStripeError(`No such price: '${it.price}'`);
            }
            const delta = prorationCents(s, sub, price);
            if (behavior === "create_prorations") sub.pending_proration_cents = (sub.pending_proration_cents ?? 0) + delta;
            else if (behavior === "always_invoice") {
              invoiceNow += delta;
              invoiceLines.push({ description: `Proration ${target.price.id} → ${price.id}`, amount: delta, period: { start: now, end: sub.current_period_end } });
            }
            target.price = { ...price };
            sub.currency = price.currency;
          }
          if (typeof it.quantity === "number") target.quantity = it.quantity;
        }
      }

      if (params.trial_end === "now" && sub.status === "trialing") {
        sub.status = "active";
        sub.trial_end = now;
        sub.current_period_start = now;
        sub.current_period_end = now + periodSeconds(sub.items.data[0].price);
        const amount = subAmountCents(sub);
        invoiceNow += amount;
        invoiceLines.push({ description: `${sub.items.data[0].price.nickname ?? sub.items.data[0].price.id} — trial ended early`, amount, period: { start: now, end: sub.current_period_end } });
      } else if (typeof params.trial_end === "number") {
        sub.trial_end = params.trial_end;
        if (sub.status === "trialing") sub.current_period_end = params.trial_end;
      }

      if (typeof params.cancel_at_period_end === "boolean") {
        sub.cancel_at_period_end = params.cancel_at_period_end;
        sub.canceled_at = params.cancel_at_period_end ? now : null;
      }
      if (params.metadata && typeof params.metadata === "object") {
        sub.metadata = { ...sub.metadata, ...(params.metadata as Meta) };
      }
      if (invoiceNow !== 0 || invoiceLines.length) {
        newInvoice(s, sub, Math.max(0, invoiceNow), "subscription_update", invoiceLines);
      }
      save(s);
      return { ...sub };
    },
    async cancel(id: string, params?: Params) {
      const s = load();
      record(s, "subscriptions.cancel", [id, params]);
      const sub = s.subscriptions[id];
      if (!sub) {
        save(s);
        throw new MockStripeError(`No such subscription: '${id}'`);
      }
      const now = nowOf(s);
      sub.status = "canceled";
      sub.canceled_at = now;
      sub.ended_at = now;
      sub.cancel_at_period_end = false;
      save(s);
      return { ...sub };
    },
  };

  const invoices = {
    async list(params?: Params) {
      const s = load();
      record(s, "invoices.list", [params]);
      save(s);
      let rows = s.invoices.slice();
      if (params?.customer) rows = rows.filter((r) => r.customer === params.customer);
      if (params?.subscription) rows = rows.filter((r) => r.subscription === params.subscription);
      if (params?.status) rows = rows.filter((r) => r.status === params.status);
      const created = params?.created as { gte?: number } | undefined;
      if (typeof created?.gte === "number") rows = rows.filter((r) => r.created >= created.gte!);
      rows.sort((a, b) => b.created - a.created);
      const after = params?.starting_after as string | undefined;
      if (after) rows = rows.slice(rows.findIndex((r) => r.id === after) + 1);
      const limit = Number(params?.limit ?? 10);
      return { object: "list", data: rows.slice(0, limit), has_more: rows.length > limit, url: "/v1/invoices" };
    },
    /** The next bill, with or without a proposed change (`subscription_details`). */
    async createPreview(params: Params) {
      const s = load();
      record(s, "invoices.createPreview", [params]);
      save(s);
      const subId = params.subscription as string | undefined;
      const sub = subId ? s.subscriptions[subId] : undefined;
      if (!sub) throw new MockStripeError(`No such subscription: '${subId ?? ""}'`);
      if (sub.status === "canceled") throw new MockStripeError("No upcoming invoices for customer", "invoice_upcoming_none", 404);
      const now = nowOf(s);
      const details = (params.subscription_details ?? {}) as {
        items?: Array<{ id?: string; price?: string }>;
        proration_behavior?: string;
        trial_end?: "now" | number;
      };
      let price = sub.items.data[0].price;
      // A line with a price and no id is a NEW line (2026-10-19, as Stripe): it adds its share of the rest of the
      // period, and its price to the next bill. A line with an id and a price swaps that line's price.
      const addedRow = details.items?.find((i) => i.price && !i.id);
      const added = addedRow?.price ? s.prices[addedRow.price] : undefined;
      if (addedRow && !added) throw new MockStripeError(`No such price: '${addedRow.price}'`);
      const proposed = details.items?.find((i) => i.price && i.id)?.price;
      if (proposed) {
        const p = s.prices[proposed];
        if (!p) throw new MockStripeError(`No such price: '${proposed}'`);
        price = p;
      }
      const behavior = details.proration_behavior ?? "create_prorations";
      const endsTrialNow = details.trial_end === "now" && sub.status === "trialing";
      const base = (price.unit_amount ?? 0) * (sub.items.data[0].quantity || 1) + (added?.unit_amount ?? 0);
      const lines: MockInvoice["lines"]["data"] = [];
      let periodStart: number;
      let periodEnd: number;
      let due: number;
      if (endsTrialNow) {
        periodStart = now;
        periodEnd = now + periodSeconds(price);
        due = now;
      } else if (sub.status === "trialing") {
        periodStart = sub.trial_end ?? sub.current_period_end;
        periodEnd = periodStart + periodSeconds(price);
        due = periodStart;
      } else {
        periodStart = sub.current_period_end;
        periodEnd = periodStart + periodSeconds(price);
        due = periodStart;
      }
      let proration = sub.pending_proration_cents ?? 0;
      if (proposed && proposed !== sub.items.data[0].price.id && behavior !== "none" && !endsTrialNow) {
        proration += prorationCents(s, sub, price);
      }
      if (added && behavior !== "none" && !endsTrialNow) proration += addedLineCents(s, sub, added, 1);
      if (proration !== 0) lines.push({ description: added ? "Proration for the new line" : "Proration for the plan change", amount: proration, period: { start: now, end: sub.current_period_end }, proration: true });
      lines.push({ description: price.nickname ?? price.id, amount: base, period: { start: periodStart, end: periodEnd } });
      const subtotal = base + proration;
      const balance = s.customers[sub.customer]?.balance ?? 0;
      const credit = balance < 0 ? Math.min(subtotal, -balance) : 0;
      return {
        object: "invoice",
        customer: sub.customer,
        subscription: sub.id,
        currency: sub.currency,
        subtotal,
        total: subtotal,
        amount_due: Math.max(0, subtotal - credit),
        starting_balance: balance,
        next_payment_attempt: due,
        period_end: periodEnd,
        total_discount_amounts: [],
        discounts: [],
        lines: { data: lines },
      };
    },
  };

  const customers = {
    async retrieve(id: string, params?: Params) {
      const s = load();
      record(s, "customers.retrieve", [id, params]);
      save(s);
      const c = s.customers[id];
      if (!c) throw new MockStripeError(`No such customer: '${id}'`);
      const expand = (params?.expand as string[] | undefined) ?? [];
      const pm = c.card ? (expand.includes("invoice_settings.default_payment_method") ? { id: c.card.id, object: "payment_method", type: "card", card: { brand: c.card.brand, last4: c.card.last4 } } : c.card.id) : null;
      return { ...c, object: "customer", invoice_settings: { default_payment_method: pm } };
    },
  };

  /** A charge to the card on file, confirmed at once: succeeded, or the card's refusal. */
  const paymentIntents = {
    async create(params: Params, opts?: Params) {
      const s = load();
      record(s, "paymentIntents.create", [params, opts]);
      const key = opts?.idempotencyKey as string | undefined;
      const prior = key ? Object.values(s.paymentIntents).find((p) => p.metadata.__idem === key) : undefined;
      if (prior) {
        save(s);
        return prior;
      }
      const customer = (params.customer as string | undefined) ?? null;
      const card = customer ? s.customers[customer]?.card : null;
      if (card?.declines) {
        save(s);
        const err = new MockStripeError("Your card was declined.", "card_declined", 402);
        err.type = "StripeCardError";
        err.name = "StripeCardError";
        throw err;
      }
      const amount = Number(params.amount ?? 0);
      const pi: MockPaymentIntent = {
        id: `pi_mock_${Object.keys(s.paymentIntents).length + 1}_${Date.now().toString(36)}`,
        object: "payment_intent",
        status: "succeeded",
        amount,
        amount_received: amount,
        currency: String(params.currency ?? "usd"),
        customer,
        description: (params.description as string | undefined) ?? null,
        metadata: { ...((params.metadata as Meta | undefined) ?? {}), ...(key ? { __idem: key } : {}) },
        created: s.clock ?? Math.floor(Date.now() / 1000),
      };
      s.paymentIntents[pi.id] = pi;
      save(s);
      return pi;
    },
    async retrieve(id: string) {
      const s = load();
      record(s, "paymentIntents.retrieve", [id]);
      save(s);
      const pi = s.paymentIntents[id];
      if (!pi) throw new MockStripeError(`No such payment_intent: '${id}'`);
      return pi;
    },
    async cancel(id: string) {
      const s = load();
      record(s, "paymentIntents.cancel", [id]);
      const pi = s.paymentIntents[id];
      if (pi) pi.status = "canceled";
      save(s);
      return pi ?? { id, status: "canceled" };
    },
  };

  /** Checkout, mode=payment: the session is a record; a walk marks it paid by editing the store. */
  const checkout = {
    sessions: {
      async create(params: Params, opts?: Params) {
        const s = load();
        record(s, "checkout.sessions.create", [params, opts]);
        const key = opts?.idempotencyKey as string | undefined;
        const prior = key ? Object.values(s.checkouts).find((c) => c.metadata.__idem === key) : undefined;
        if (prior) {
          save(s);
          return prior;
        }
        const items = (params.line_items as Array<{ quantity?: number; price_data?: { unit_amount?: number; currency?: string } }> | undefined) ?? [];
        const amount = items.reduce((n, it) => n + (it.price_data?.unit_amount ?? 0) * (it.quantity ?? 1), 0);
        const id = `cs_mock_${Object.keys(s.checkouts).length + 1}_${Date.now().toString(36)}`;
        const session: MockCheckoutSession = {
          id,
          object: "checkout.session",
          mode: String(params.mode ?? "payment"),
          url: `https://checkout.stripe.mock/c/pay/${id}`,
          payment_status: "unpaid",
          payment_intent: null,
          amount_total: amount,
          currency: String(items[0]?.price_data?.currency ?? "usd"),
          customer: (params.customer as string | undefined) ?? null,
          customer_details: { email: (params.customer_email as string | undefined) ?? null },
          metadata: { ...((params.metadata as Meta | undefined) ?? {}), ...(key ? { __idem: key } : {}) },
          client_reference_id: (params.client_reference_id as string | undefined) ?? null,
          success_url: String(params.success_url ?? ""),
          cancel_url: String(params.cancel_url ?? ""),
          livemode: false,
          created: s.clock ?? Math.floor(Date.now() / 1000),
        };
        s.checkouts[id] = session;
        save(s);
        return session;
      },
      async retrieve(id: string) {
        const s = load();
        record(s, "checkout.sessions.retrieve", [id]);
        save(s);
        const c = s.checkouts[id];
        if (!c) throw new MockStripeError(`No such checkout.session: '${id}'`);
        return c;
      },
    },
  };

  const prices = {
    async retrieve(id: string) {
      const s = load();
      record(s, "prices.retrieve", [id]);
      save(s);
      const p = s.prices[id];
      if (!p) throw new MockStripeError(`No such price: '${id}'`);
      return { ...p, object: "price" };
    },
    async list(params?: Params) {
      const s = load();
      record(s, "prices.list", [params]);
      save(s);
      return { object: "list", data: Object.values(s.prices), has_more: false, url: "/v1/prices" };
    },
  };

  const accounts = {
    async retrieve() {
      const s = load();
      record(s, "accounts.retrieve", []);
      save(s);
      return { object: "account", id: "acct_mock", default_currency: s.account?.default_currency ?? "usd" };
    },
  };

  // The refunds and disputes a harness wrote, newest first, as Stripe lists them.
  const moneyBack = (what: "refunds" | "disputes") => ({
    async list(params?: Params) {
      const s = load();
      record(s, `${what}.list`, [params]);
      save(s);
      let rows = (s[what] ?? []).slice();
      const created = params?.created as { gte?: number } | undefined;
      if (typeof created?.gte === "number") rows = rows.filter((r) => r.created >= created.gte!);
      rows.sort((a, b) => b.created - a.created);
      const after = params?.starting_after as string | undefined;
      if (after) rows = rows.slice(rows.findIndex((r) => r.id === after) + 1);
      const limit = Number(params?.limit ?? 10);
      return { object: "list", data: rows.slice(0, limit).map((r) => ({ ...r, object: what === "refunds" ? "refund" : "dispute" })), has_more: rows.length > limit, url: `/v1/${what}` };
    },
  });
  const refunds = moneyBack("refunds");
  const disputes = moneyBack("disputes");
  // Admin → Revenue's charges and invoice payments, as a harness wrote them (none by default), newest first.
  const written = (what: "charges" | "invoicePayments", object: string) => ({
    async list(params?: Params) {
      const s = load();
      record(s, `${what}.list`, [params]);
      save(s);
      let rows = (s[what] ?? []).slice().sort((a, b) => b.created - a.created);
      const after = params?.starting_after as string | undefined;
      if (after) rows = rows.slice(rows.findIndex((r) => r.id === after) + 1);
      const limit = Number(params?.limit ?? 10);
      return { object: "list", data: rows.slice(0, limit).map((r) => ({ ...r, object })), has_more: rows.length > limit, url: `/v1/${what === "charges" ? "charges" : "invoice_payments"}` };
    },
  });
  const charges = written("charges", "charge");
  const invoicePayments = written("invoicePayments", "invoice_payment");

  // Awaited, a list is one page; iterated with `for await`, every row, page after page — as the real client's.
  type Page = { data: Array<{ id: string }>; has_more: boolean };
  const paged = <P extends Page>(list: (params?: Params) => Promise<P>) => (params?: Params) => {
    const first = list(params);
    return Object.assign(first, {
      async *[Symbol.asyncIterator]() {
        let page: Page = await first;
        for (;;) {
          yield* page.data;
          if (!page.has_more || !page.data.length) return;
          page = await list({ ...params, starting_after: page.data[page.data.length - 1].id });
        }
      },
    });
  };
  for (const r of [subscriptions, invoices, refunds, disputes, charges, invoicePayments] as Array<{ list: (params?: Params) => Promise<Page> }>) r.list = paged(r.list);

  const implemented: Record<string, unknown> = { subscriptions, invoices, customers, prices, accounts, paymentIntents, checkout, refunds, disputes, charges, invoicePayments };

  const guard = (path: string, target: unknown): unknown =>
    new Proxy(target as object, {
      get(t, prop) {
        if (typeof prop === "symbol" || prop === "then") return undefined;
        const v = (t as Record<string, unknown>)[prop];
        if (v === undefined) {
          const full = `${path}.${String(prop)}`;
          return () => {
            throw new Error(`[stripe-mock] not implemented: ${full} — the rehearsal reached a Stripe call the mock does not cover`);
          };
        }
        return typeof v === "object" && v !== null && typeof v !== "function" ? guard(`${path}.${String(prop)}`, v) : v;
      },
    });

  return guard("stripe", implemented) as unknown as Stripe;
}
