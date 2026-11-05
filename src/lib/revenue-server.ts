import "server-only";
import type Stripe from "stripe";
import { requirePlatformAdmin } from "@/lib/orgContext";
import { readSubscribersData } from "@/lib/subscribersRead";
import { getStripe } from "@/lib/sdk/stripe";
import { invoiceSubscriptionId } from "@/lib/stripeCompat";
import { CARD_EXPAND } from "@/lib/paymentCard";
import { computeMetrics } from "@/components/v3/admin-subscribers/billing-metrics";
import { revenueDate, type RevenueCustomer, type RevenuePoint, type RevenueReport } from "./revenue-contract";

const idOf = (v: string | { id: string } | null | undefined) => typeof v === "string" ? v : v?.id ?? null;
const CAP = 10000;
/** Each Stripe request gives up after this long (Stripe's own default is 80 s, retried twice — one slow call could
 *  outlast the page). The read runs behind a saved copy (lib/revenueSaved), so a slow one only delays the next figures. */
const REQ = { timeout: 30_000 } as const;
/** How long each part of the read took, in the server log: a slow read says which part was slow. */
async function timed<T>(name: string, work: Promise<T>): Promise<T> {
  const t = Date.now();
  try { return await work; } finally { console.info(`[revenue] ${name} ${Date.now() - t}ms`); }
}
async function collect<T>(list: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const item of list) {
    if (result.length >= CAP) throw new Error("Stripe scan limit reached. Revenue totals are unavailable rather than partial.");
    result.push(item);
  }
  return result;
}
async function pool<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const output: R[] = new Array(items.length); let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(6, items.length) }, async () => {
    while (cursor < items.length) { const i = cursor++; output[i] = await fn(items[i]); }
  }));
  return output;
}

/** Read-only. Authorization is checked before any Stripe or customer data is read.
 * No synthetic historic snapshots: history is reconstructed from paid recurring
 * invoice coverage. Today's MRR uses the same facts/rule as Subscribers. */
export async function getRevenueReport(): Promise<RevenueReport> {
  await requirePlatformAdmin();
  return readRevenueReport();
}

/** The read itself, unguarded: the page checks the platform admin first, then this runs — inline or after the
 *  response (lib/revenueSaved), where the request's cookies are gone. */
export async function readRevenueReport(): Promise<RevenueReport> {
  const started = Date.now();
  const stripe = getStripe();
  const [billing, subscriptions, invoices, payments, charges, refunds, disputes] = await Promise.all([
    timed("subscribers", readSubscribersData()),
    timed("subscriptions", collect(stripe.subscriptions.list({ status: "all", limit: 100, expand: [...CARD_EXPAND, "data.default_source"] }, REQ))),
    timed("invoices", collect(stripe.invoices.list({ limit: 100 }, REQ))),
    timed("invoice payments", collect(stripe.invoicePayments.list({ limit: 100 }, REQ))),
    timed("charges", collect(stripe.charges.list({ limit: 100 }, REQ))),
    timed("refunds", collect(stripe.refunds.list({ limit: 100 }, REQ))),
    timed("disputes", collect(stripe.disputes.list({ limit: 100 }, REQ))),
  ]);
  if (!billing.stripeLive || billing.truncated) throw new Error("A complete Stripe subscription read is required.");
  const now = Math.floor(Date.now() / 1000), today = revenueDate(now), currency = billing.metrics.currency;
  const warnings = new Set<string>();
  const facts = new Map(billing.rows.filter(r => r.source === "stripe").map(r => [r.id, r]));
  const subById = new Map(subscriptions.map(s => [s.id, s]));
  const invoiceById = new Map(invoices.filter(i => invoiceSubscriptionId(i)).map(i => [i.id, i]));
  const customerBook = new Map<string, RevenueCustomer>();
  for (const s of subscriptions) {
    const id = idOf(s.customer)!; const f = facts.get(s.id);
    const c = typeof s.customer === "object" && !s.customer.deleted ? s.customer : null;
    if (!customerBook.has(id)) customerBook.set(id, { id, name: f?.orgName || c?.name || c?.email || "Deleted customer", email: c?.email || f?.customerEmail || "", plans: "", status: "", paymentMethod: "None", monthly: 0, collected: 0, refunded: 0, overdue: 0, nextDate: null, nextAmount: null, forecast: "Excluded" });
    const row = customerBook.get(id)!;
    const plans = new Set(row.plans ? row.plans.split(" · ") : []); plans.add(f?.planName || s.items.data[0]?.price.nickname || "Legacy plan"); row.plans = [...plans].join(" · ");
    const statuses = new Set(row.status ? row.status.split(" / ") : []); statuses.add(s.status); row.status = [...statuses].join(" / ");
    if (f?.countsTowardMrr) row.monthly += f.amountCents;
  }
  // Match actual successful charges to subscription invoices, including split
  // payments. This excludes proposals, one-off payments and marked-paid invoices.
  const byIntent = new Map<string, string>(), byCharge = new Map<string, string>();
  for (const p of payments) {
    const inv = idOf(p.invoice); if (!inv || !invoiceById.has(inv) || p.status !== "paid") continue;
    if (p.payment.type === "payment_intent") { const pi = idOf(p.payment.payment_intent); if (pi) byIntent.set(pi, inv); }
    if (p.payment.type === "charge") { const ch = idOf(p.payment.charge); if (ch) byCharge.set(ch, inv); }
  }
  type Movement = { at: number; amount: number; customer: string };
  const movements: Movement[] = []; const matchedCharges = new Map<string, string>(); let gross = 0, refunded = 0;
  for (const ch of charges) {
    const legacy = (ch as Stripe.Charge & { invoice?: string | null }).invoice;
    const invoiceId = byCharge.get(ch.id) || byIntent.get(idOf(ch.payment_intent) || "") || legacy;
    if (!invoiceId || !invoiceById.has(invoiceId) || !ch.paid || !ch.captured) continue;
    if (ch.currency !== currency) { warnings.add("Other-currency payments are excluded; no exchange rates are assumed."); continue; }
    const customer = idOf(invoiceById.get(invoiceId)!.customer)!;
    const amount = ch.amount_captured; matchedCharges.set(ch.id, customer); gross += amount;
    movements.push({ at: ch.created, amount, customer });
  }
  for (const r of refunds) {
    const customer = matchedCharges.get(idOf(r.charge) || "");
    if (!customer || r.status !== "succeeded" || r.currency !== currency) continue;
    refunded += r.amount; movements.push({ at: r.created, amount: -r.amount, customer });
    const row = customerBook.get(customer); if (row) row.refunded += r.amount;
  }
  for (const d of disputes) {
    const customer = matchedCharges.get(idOf(d.charge) || ""); if (!customer) continue;
    for (const tx of d.balance_transactions) {
      if (tx.currency === currency) movements.push({ at: tx.created, amount: tx.amount, customer });
    }
  }
  for (const m of movements) { const row = customerBook.get(m.customer); if (row) row.collected += m.amount; }
  let overdue = 0;
  for (const inv of invoiceById.values()) if (inv.currency === currency && inv.status === "open" && inv.amount_remaining > 0 && (inv.attempted || (inv.due_date && inv.due_date < now))) {
    overdue += inv.amount_remaining; const row = customerBook.get(idOf(inv.customer)!); if (row) row.overdue += inv.amount_remaining;
  }
  const historic = await timed("invoice lines", pool([...invoiceById.values()].filter(i => i.status === "paid" && i.currency === currency), async i => {
    const lines = i.lines.has_more ? await collect(stripe.invoices.listLineItems(i.id, { limit: 100 }, REQ)) : i.lines.data;
    return { i, lines };
  }));
  const priceIds = new Set(historic.flatMap(({ lines }) => lines.map(l => l.pricing?.price_details?.price).filter((p): p is string => typeof p === "string")));
  const priceBook = new Map((await timed("prices", pool([...priceIds], id => stripe.prices.retrieve(id, {}, REQ)))).map(p => [p.id, p]));
  const coverage: { start: number; end: number; amount: number }[] = [];
  for (const { i, lines } of historic) for (const line of lines) {
    const detail = line.parent?.subscription_item_details;
    const price = priceBook.get(line.pricing?.price_details?.price || "");
    if (!detail || detail.proration || !price?.recurring || price.recurring.usage_type === "metered") continue;
    const sub = subById.get(invoiceSubscriptionId(i)!);
    const end = Math.min(line.period.end, sub?.ended_at || Infinity);
    const start = Math.max(line.period.start, i.status_transitions.paid_at || i.created);
    const net = Math.max(0, line.amount - (line.discount_amounts || []).reduce((a, d) => a + d.amount, 0));
    const r = price.recurring; const months = r.interval_count * ({ month: 1, year: 12, week: 12 / 52, day: 12 / 365 }[r.interval]);
    coverage.push({ start, end, amount: net / months });
  }
  const horizon = now + 30 * 86400;
  type Future = { at: number; mrrDelta: number; cash: number };
  const future: Future[] = []; let eligibleTrials = 0, excludedTrials = 0;
  await timed("upcoming invoices", pool(subscriptions, async s => {
    const f = facts.get(s.id); const row = customerBook.get(idOf(s.customer)!)!;
    const trial = s.status === "trialing";
    const stop = s.cancel_at || (s.cancel_at_period_end ? Math.min(...s.items.data.map(i => i.current_period_end)) : null);
    if (f?.countsTowardMrr && stop) future.push({ at: stop, mrrDelta: -f.amountCents, cash: 0 });
    const c = typeof s.customer === "object" && !s.customer.deleted ? s.customer : null;
    const pm = s.default_payment_method || c?.invoice_settings.default_payment_method;
    const source = s.default_source || c?.default_source;
    const methodName = pm && typeof pm === "object" ? (pm.type === "card" ? "Card" : pm.type === "link" ? "Link" : pm.type.replaceAll("_", " ")) : pm ? "Saved method" : source ? "Saved source" : "None";
    if (row.paymentMethod === "None" || s.status === "trialing" || s.status === "active") row.paymentMethod = methodName;
    const date = trial ? s.trial_end : Math.min(...s.items.data.map(i => i.current_period_end));
    const card = pm && typeof pm === "object" ? pm.card : source && typeof source === "object" && source.object === "card" ? source : null;
    const cardExpiry = card ? Date.UTC(card.exp_year, card.exp_month, 1) / 1000 : null;
    const hasMethod = Boolean(pm || source) && (!cardExpiry || cardExpiry > (date || now)) && (!card || !("checks" in card) || card.checks?.cvc_check !== "fail");
    const eligible = f && f.currency === currency && !f.paused && !f.comped && hasMethod && s.collection_method === "charge_automatically" && (s.status === "active" || trial) && date && (!stop || stop > date);
    if (!eligible) { if (trial) excludedTrials++; return; }
    try {
      const p = await stripe.invoices.createPreview({ subscription: s.id }, REQ);
      if (p.currency !== currency) { if (trial) excludedTrials++; return; }
      const at = Math.max(date, p.next_payment_attempt || date);
      if (trial) {
        eligibleTrials++; future.push({ at: date, mrrDelta: f.amountCents, cash: 0 });
        if (stop) future.push({ at: stop, mrrDelta: -f.amountCents, cash: 0 });
      }
      if (at > now && at <= horizon && (!stop || at < stop)) future.push({ at, mrrDelta: 0, cash: p.amount_due });
      if (!row.nextDate || at < Date.parse(row.nextDate) / 1000) { row.nextDate = new Date(at * 1000).toISOString(); row.nextAmount = p.amount_due; }
      row.forecast = trial ? "Trial → paid" : "Renewal";
      if (s.items.data.some(i => !["month", "year"].includes(i.price.recurring?.interval || ""))) warnings.add("Cash forecast includes the next invoice only for short billing intervals.");
    } catch {
      if (trial) excludedTrials++;
      warnings.add("Some upcoming invoices could not be previewed and are excluded from the forecast.");
    }
  }));
  const metrics = computeMetrics(billing.rows, currency), mrr = metrics.mrrCents;
  if (metrics.mrrUnpriced || metrics.mrrPartlyPriced || metrics.mrrRestrictedDiscount) warnings.add("Some recurring prices or restricted discounts are incomplete; MRR is a floor. See Subscribers.");
  const collected = movements.reduce((a, m) => a + m.amount, 0);
  const first = Math.min(now, ...movements.map(m => m.at), ...coverage.map(c => c.start));
  const startDay = revenueDate(first), endDay = revenueDate(horizon);
  const points: RevenuePoint[] = [];
  // Date labels are Pacific. Each historical point samples the end of that
  // Pacific calendar day (offset is resolved for DST, never host timezone).
  for (let day = startDay; day <= endDay;) {
    const offset = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", timeZoneName: "shortOffset" }).formatToParts(new Date(day + "T20:00:00Z")).find(p => p.type === "timeZoneName")?.value;
    const hours = Number(offset?.replace("GMT", "") || -8);
    const end = Date.parse(day + "T23:59:59Z") / 1000 - hours * 3600;
    const actual = day <= today, current = day === today;
    const at = current ? now : end;
    const histMrr = current ? mrr : coverage.filter(c => c.start <= at && c.end > at).reduce((a, c) => a + c.amount, 0);
    const projected = mrr + future.filter(e => e.at <= at).reduce((a, e) => a + e.mrrDelta, 0);
    const cash = collected + future.filter(e => e.at <= at).reduce((a, e) => a + e.cash, 0);
    points.push({ date: day, mrr: actual ? Math.round(histMrr) : null, arr: actual ? Math.round(histMrr * 12) : null, collected: actual ? movements.filter(m => revenueDate(m.at) <= day).reduce((a, m) => a + m.amount, 0) : null, daily: actual ? movements.filter(m => revenueDate(m.at) === day).reduce((a, m) => a + m.amount, 0) : null, forecastMrr: !actual || current ? Math.round(projected) : null, forecastArr: !actual || current ? Math.round(projected * 12) : null, forecastCollected: !actual || current ? cash : null });
    day = new Date(Date.parse(day + "T12:00:00Z") + 86400000).toISOString().slice(0, 10);
  }
  const last = points.at(-1)!;
  console.info(`[revenue] read ${Date.now() - started}ms — ${subscriptions.length} subscriptions, ${invoices.length} invoices, ${charges.length} charges, ${points.length} days`);
  return { asOf: new Date(now * 1000).toISOString(), currency, live: subscriptions[0]?.livemode ?? !process.env.STRIPE_SECRET_KEY_TEST, mrr, arr: mrr * 12, gross, refunds: refunded, collected, projectedMrr: last.forecastMrr ?? mrr, projectedCollected: last.forecastCollected ?? collected, eligibleTrials, excludedTrials, overdue, points, customers: [...customerBook.values()].sort((a, b) => b.collected - a.collected), warnings: [...warnings] };
}
