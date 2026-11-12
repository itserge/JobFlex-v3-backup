import "server-only";
// THE NEW PLANS ON THE BILL (Base + Tools, part 2 — owner, 2026-11-10). One Stripe subscription per shop, the way the
// Deck Studio line already works (lib/deckAddonBilling): the plan's line, one line per tool on the bill, and one
// extra-people line whose quantity is the people past the plan's. Lines are told by their price's jfKind
// (lib/toolPlans/shared: "tools-<plan>", "tool-<id>", "seat") and keep the price they were bought at.
//
// ONLY THE NEW PLANS. Every function here refuses a shop whose plan isn't a "tools-" slug: a Classic shop's bill is
// never touched (code "not-tools").
//
// FREE TRIES (owner, 2026-11-10: "if they didn't cancel any add-ons, it should charge"):
//   · inside the sign-up's 7 free days a try ends WITH them — its line goes on the trialing subscription at once with
//     no proration, so Stripe bills it with the plan when the trial ends, unless it was removed before;
//   · after the free days a try runs 3 days with nothing on the bill; then the sweep (billEndedTries, hourly from
//     /api/cron/trials) puts the line on, charging the rest of the period at once — all or nothing on the card
//     (pending_if_incomplete: a declined card adds nothing, the tool closes).
// REMOVING: in a trial the line just goes; after it the line goes with no refund and the tool stays open until the
// paid period ends (`closing`). PEOPLE: more → the rest of the period charged at once; fewer → no refund.

import type Stripe from "stripe";
import { db } from "@/lib/db";
import { getStripeClient, isStripeEnabled } from "@/lib/sdk/stripe";
import type { StripeMode } from "@/lib/stripeMode";
import { ensureRecurringPrice } from "@/lib/stripePriceCache";
import { countPeoplePool } from "@/lib/limitsEngine";
import { readToolCatalog } from "./prices";
import {
  chosenTradeFor,
  emptyToolsRecord,
  isToolsSlug,
  kindName,
  parseToolsRecord,
  planIdOfKind,
  SEAT_KIND,
  shopFromRecord,
  sizeRank,
  toolById,
  tryDayWords,
  tryReminderAt,
  tryReminderWords,
  toolIdOfKind,
  toolKind,
  toolPlanBySlug,
  toolsOpen,
  tryEndsAt,
  tryWords,
  triesToBill,
  YEAR_MONTHS,
  type Catalog,
  type ToolId,
  type ToolPlanId,
  type ToolsRecord,
  type ToolTry,
} from "./shared";

export type Deps = { stripe: Stripe; mode: StripeMode };
type Interval = "MONTH" | "YEAR";

const LIVE = new Set(["active", "trialing"]);
export const TOOLS_RECORD_PREFIX = "orgTools:";
const keyOf = (organizationId: string) => `${TOOLS_RECORD_PREFIX}${organizationId}`;

// ── the record ───────────────────────────────────────────────────────────────

export async function readToolsRecord(organizationId: string): Promise<ToolsRecord | null> {
  const row = await db.syncState.findUnique({ where: { key: keyOf(organizationId) }, select: { cursor: true } });
  return parseToolsRecord(row?.cursor);
}

export async function writeToolsRecord(organizationId: string, record: ToolsRecord): Promise<void> {
  const cursor = JSON.stringify(record);
  await db.syncState.upsert({ where: { key: keyOf(organizationId) }, create: { key: keyOf(organizationId), cursor }, update: { cursor } });
}

// ── prices and lines ─────────────────────────────────────────────────────────

function kindCents(cat: Catalog, kind: string, interval: Interval, plan?: ToolPlanId): number {
  const monthly = (() => {
    const planId = planIdOfKind(kind);
    if (planId) return cat.plans.find((p) => p.id === planId)!.cents;
    const tool = toolIdOfKind(kind);
    if (tool) return cat.tools.find((t) => t.id === tool)!.cents;
    if (kind === SEAT_KIND && plan) return cat.plans.find((p) => p.id === plan)!.seatCents ?? 0;
    throw new Error(`No price for ${kind}`);
  })();
  return interval === "YEAR" ? monthly * YEAR_MONTHS : monthly;
}

async function priceFor(deps: Deps, cat: Catalog, kind: string, interval: Interval, plan?: ToolPlanId): Promise<string> {
  return ensureRecurringPrice({ stripe: deps.stripe, mode: deps.mode, kind, name: kindName(kind), interval, cents: kindCents(cat, kind, interval, plan) });
}

const kindOf = (item: Stripe.SubscriptionItem) => item.price?.metadata?.jfKind ?? "";

function termOf(sub: Stripe.Subscription): Interval {
  const plan = sub.items.data.find((i) => planIdOfKind(kindOf(i))) ?? sub.items.data[0];
  return plan?.price?.recurring?.interval === "year" ? "YEAR" : "MONTH";
}

/** Every line on the subscription (Stripe pages a long list). */
async function allItems(stripe: Stripe, sub: Stripe.Subscription): Promise<Stripe.SubscriptionItem[]> {
  if (!sub.items?.has_more) return sub.items?.data ?? [];
  const out: Stripe.SubscriptionItem[] = [];
  for await (const item of stripe.subscriptionItems.list({ subscription: sub.id, limit: 100 })) out.push(item);
  return out;
}

/**
 * THE SIGN-UP'S LINES (used by the checkout in part 4): the plan, the main tool unless the plan includes it, and the
 * extra people. Optional pick-boxes never — the card page shows exactly what will be billed.
 */
export async function toolsCheckoutItems(opts: {
  deps: Deps;
  plan: ToolPlanId;
  main: ToolId | null;
  /** The other tools ticked in the builder (owner, 2026-11-12): each its own line, riding the trial with the plan. */
  extras?: readonly ToolId[];
  interval: Interval;
  people?: number;
  catalog?: Catalog;
}): Promise<Array<{ price: string; quantity: number }>> {
  const cat = opts.catalog ?? (await readToolCatalog());
  const plan = cat.plans.find((p) => p.id === opts.plan)!;
  const items: Array<{ price: string; quantity: number }> = [{ price: await priceFor(opts.deps, cat, plan.slug, opts.interval), quantity: 1 }];
  // The same tools the builder priced (lib/toolPlans/cards toolsBuild): Advanced holds the dearest two trade tools ticked.
  const picks = [...new Set([...(opts.main ? [opts.main] : []), ...(opts.extras ?? [])])];
  const included = toolsOpen({ plan: opts.plan, main: null, kept: [], chosenTrade: chosenTradeFor(opts.plan, null, picks, cat) });
  for (const id of picks) if (!included.has(id)) items.push({ price: await priceFor(opts.deps, cat, toolKind(id), opts.interval), quantity: 1 });
  const extra = plan.seatCents === null ? 0 : Math.max(0, (opts.people ?? 1) - plan.seats);
  if (extra > 0) items.push({ price: await priceFor(opts.deps, cat, SEAT_KIND, opts.interval, opts.plan), quantity: extra });
  return items;
}

// ── the shop's subscription ──────────────────────────────────────────────────

export type ToolsFailure = "not-tools" | "no-subscription" | "unreachable" | "not-live" | "past-due" | "declined" | "failed" | "already" | "tried" | "included" | "main" | "not-held" | "basic" | "not-trial" | "people";
type Fail = { ok: false; code: ToolsFailure; error: string };

type Ready =
  | { ok: true; deps: Deps; sub: Stripe.Subscription; record: ToolsRecord; row: { plan: string; status: string; trialEndsAt: Date | null; externalSubId: string | null } }
  | { ok: false; code: ToolsFailure; error: string };

async function ready(organizationId: string, deps?: Deps, opts: { allowCardless?: boolean } = {}): Promise<Ready | { ok: true; cardless: true; record: ToolsRecord; row: { plan: string; status: string; trialEndsAt: Date | null; externalSubId: string | null } }> {
  const row = await db.subscription.findUnique({ where: { organizationId }, select: { plan: true, status: true, trialEndsAt: true, externalSubId: true, provider: true } });
  const planDef = toolPlanBySlug(row?.plan);
  if (!row || !isToolsSlug(row.plan) || !planDef) return { ok: false, code: "not-tools", error: "This works on the new plans only." };
  const record = (await readToolsRecord(organizationId)) ?? emptyToolsRecord(planDef.id);
  record.plan = planDef.id;
  if (!row.externalSubId) {
    if (opts.allowCardless && row.status === "TRIALING") return { ok: true, cardless: true, record, row };
    return { ok: false, code: "no-subscription", error: "Your plan isn't billed to a card yet. Add a card on Subscription first." };
  }
  if (row.provider !== "STRIPE" || !isStripeEnabled()) return { ok: false, code: "no-subscription", error: "Your plan isn't billed to a card on file, so this can't be changed from here. Write to us from Help." };
  const d = deps ?? (await getStripeClient());
  let sub: Stripe.Subscription;
  try {
    sub = await d.stripe.subscriptions.retrieve(row.externalSubId);
  } catch {
    return { ok: false, code: "unreachable", error: "Couldn't reach your subscription. Try again in a minute." };
  }
  if (!LIVE.has(sub.status)) {
    return sub.status === "past_due" || sub.status === "unpaid"
      ? { ok: false, code: "past-due", error: "Your last payment didn't go through. Update the card on Subscription first." }
      : { ok: false, code: "not-live", error: "Your subscription isn't active, so nothing can be changed on it." };
  }
  record.subId = sub.id;
  return { ok: true, deps: d, sub, record, row };
}

/** Add one line. In a trial: no proration (billed with the plan). After it: the rest of the period now, all or nothing.
 *  `charge: false` puts it on with no proration after the trial too (a tool already paid for this period, put back).
 *  A charging call carries no metadata: Stripe takes only a short list of fields with pending_if_incomplete. */
async function addLine(deps: Deps, sub: Stripe.Subscription, organizationId: string, price: string, quantity = 1, opts: { charge?: boolean } = {}): Promise<{ ok: true; sub: Stripe.Subscription } | Fail> {
  const charge = sub.status !== "trialing" && opts.charge !== false;
  let next: Stripe.Subscription;
  try {
    next = await deps.stripe.subscriptions.update(sub.id, {
      items: [{ price, quantity }],
      proration_behavior: charge ? "always_invoice" : "none",
      ...(charge ? { payment_behavior: "pending_if_incomplete" as const } : { metadata: { ...(sub.metadata ?? {}), organizationId } }),
      expand: ["latest_invoice"],
    });
  } catch (err) {
    console.warn("[toolPlans] adding a line failed:", err);
    return { ok: false, code: "failed", error: "Couldn't change your plan. Try again." };
  }
  if (next.pending_update) {
    const inv = next.latest_invoice;
    const invId = typeof inv === "string" ? inv : inv?.id;
    if (invId) await deps.stripe.invoices.voidInvoice(invId).catch((err) => console.warn("[toolPlans] void failed:", err));
    return { ok: false, code: "declined", error: "The card on file was declined. Nothing was added and nothing was charged." };
  }
  return { ok: true, sub: next };
}

function lineOf(sub: Stripe.Subscription, kind: string): Stripe.SubscriptionItem | undefined {
  return sub.items.data.find((i) => kindOf(i) === kind);
}

// ── free tries ───────────────────────────────────────────────────────────────

export type TryResult = { ok: true; endsAt: string; words: string; onLine: boolean } | { ok: false; code: ToolsFailure; error: string };

/** START A FREE TRY. One per tool per company. Its end and what happens then: lib/toolPlans/shared tryEndsAt. */
export async function startToolTry(organizationId: string, tool: ToolId, now = new Date(), deps?: Deps): Promise<TryResult> {
  const r = await ready(organizationId, deps, { allowCardless: true });
  if (!r.ok) return r;
  const record = r.record;
  if (toolsOpen({ plan: record.plan, main: null, kept: [], chosenTrade: record.chosenTrade }).has(tool)) return { ok: false, code: "included", error: "Your plan already includes it." };
  if (toolsOpen(shopFromRecord(record, now)).has(tool)) return { ok: false, code: "already", error: "It's already on your plan." };
  if (record.tries[tool]) return { ok: false, code: "tried", error: "You've already had a free try of this one. Add it from Subscription." };
  const cat = await readToolCatalog();
  const inTrial = r.row.status === "TRIALING" && !!r.row.trialEndsAt && r.row.trialEndsAt.getTime() > now.getTime();
  const endsAt = tryEndsAt(now, inTrial ? r.row.trialEndsAt : null);
  let onLine = false;
  if ("sub" in r && r.sub.status === "trialing") {
    // Inside the free days: the line rides the trial and is billed with the plan — unless removed before.
    const interval = termOf(r.sub);
    let price: string;
    try {
      price = await priceFor(r.deps, cat, toolKind(tool), interval);
    } catch (err) {
      console.warn("[toolPlans] the price could not be made:", err);
      return { ok: false, code: "failed", error: "Couldn't start the try. Try again." };
    }
    const added = await addLine(r.deps, r.sub, organizationId, price);
    if (!added.ok) return added;
    const line = lineOf(added.sub, toolKind(tool));
    if (line) record.lines[tool] = { itemId: line.id, cents: line.price?.unit_amount ?? 0, since: now.toISOString() };
    onLine = true;
  }
  record.tries[tool] = { startedAt: now.toISOString(), endsAt: endsAt.toISOString(), onLine };
  await writeToolsRecord(organizationId, record);
  return { ok: true, endsAt: endsAt.toISOString(), words: tryWords(tool, endsAt, undefined, cat), onLine };
}

/** REMOVE A TOOL. A try: it won't be billed and stays open until its end. On the bill: the line goes now, no refund,
 *  and the tool stays open until the paid period ends. THE MAIN TOOL (owner, 2026-11-12: "during the trial they can
 *  remove and leave what they needed"): in the sign-up's free days it comes off like a try — its line goes, nothing was
 *  paid, it stays open until the free days end and can be added back; the shop is left with no main tool (the other
 *  tools it ticked stay as they are). After the free days the main tool is a tool on the bill like any other. */
export async function removeTool(organizationId: string, tool: ToolId, now = new Date(), deps?: Deps): Promise<{ ok: true; openUntil: string | null; wasTry: boolean } | Fail> {
  const r = await ready(organizationId, deps, { allowCardless: true });
  if (!r.ok) return r;
  const record = r.record;
  const freeDays = r.row.status === "TRIALING" && !!r.row.trialEndsAt && r.row.trialEndsAt.getTime() > now.getTime();
  const isMain = record.main === tool;
  if (isMain && sizeHolds(record).has(tool)) return { ok: false, code: "included", error: "Your plan includes it, so there's nothing to remove." };
  if (isMain && freeDays && !record.tries[tool]) {
    // In the free days the main tool is free like a try that ends with them: removed below as one.
    record.tries[tool] = { startedAt: now.toISOString(), endsAt: r.row.trialEndsAt!.toISOString(), onLine: !!record.lines[tool] };
  }
  const tr = record.tries[tool];
  const trying = !!tr && !tr.billedAt && !tr.failedAt && !tr.removedAt && Date.parse(tr.endsAt) > now.getTime();
  const line = record.lines[tool];
  if (!trying && !line) return { ok: false, code: "not-held", error: "It isn't on your plan." };
  let openUntil: string | null = null;
  if (line && "sub" in r) {
    try {
      await r.deps.stripe.subscriptions.update(r.sub.id, { items: [{ id: line.itemId, deleted: true }], proration_behavior: "none" });
    } catch (err) {
      console.warn("[toolPlans] removing a line failed:", err);
      return { ok: false, code: "failed", error: "Couldn't remove it. Try again." };
    }
    delete record.lines[tool];
    if (!trying) {
      // Paid for this period: open until it ends, never refunded.
      const periodEnd = r.sub.items.data.find((i) => i.id === line.itemId)?.current_period_end ?? (r.sub as unknown as { current_period_end?: number }).current_period_end;
      openUntil = periodEnd ? new Date(periodEnd * 1000).toISOString() : now.toISOString();
      record.closing[tool] = openUntil;
    }
  }
  if (trying && tr) {
    tr.removedAt = now.toISOString();
    openUntil = tr.endsAt;
  }
  // The main tool removed: the shop has none now (it is open through its try or its paid month, as any removed tool).
  if (isMain) record.main = null;
  await writeToolsRecord(organizationId, record);
  return { ok: true, openUntil, wasTry: trying };
}

// ── people ───────────────────────────────────────────────────────────────────

/** HOW MANY PEOPLE: the extra-people line follows (quantity = people past the plan's). Basic has no extra people. */
export async function setPeople(organizationId: string, people: number, deps?: Deps): Promise<{ ok: true; extra: number } | { ok: false; code: ToolsFailure; error: string }> {
  const r = await ready(organizationId, deps, { allowCardless: true });
  if (!r.ok) return r;
  const cat = await readToolCatalog();
  const plan = cat.plans.find((p) => p.id === r.record.plan)!;
  // Basic is said first, whatever the card: the answer is the same with one or without.
  if (plan.seatCents === null) return { ok: false, code: "basic", error: "Basic is just you. Move to Professional to add people." };
  if (!("sub" in r)) return { ok: false, code: "no-subscription", error: "Adding people needs a card on file. Add a card on Subscription first." };
  const extra = Math.max(0, Math.floor(people) - plan.seats);
  const line = lineOf(r.sub, SEAT_KIND);
  const have = line?.quantity ?? 0;
  if (extra === have) return { ok: true, extra };
  const trialing = r.sub.status === "trialing";
  if (!line) {
    const price = await priceFor(r.deps, cat, SEAT_KIND, termOf(r.sub), r.record.plan);
    const added = await addLine(r.deps, r.sub, organizationId, price, extra);
    if (!added.ok) return added;
    const l = lineOf(added.sub, SEAT_KIND);
    r.record.seat = l ? { itemId: l.id, quantity: extra, cents: l.price?.unit_amount ?? 0 } : null;
  } else {
    const more = extra > have;
    try {
      const next = await r.deps.stripe.subscriptions.update(r.sub.id, {
        items: [extra === 0 ? { id: line.id, deleted: true } : { id: line.id, quantity: extra }],
        proration_behavior: more && !trialing ? "always_invoice" : "none",
        ...(more && !trialing ? { payment_behavior: "pending_if_incomplete" as const } : {}),
        expand: ["latest_invoice"],
      });
      if (next.pending_update) {
        const inv = next.latest_invoice;
        const invId = typeof inv === "string" ? inv : inv?.id;
        if (invId) await r.deps.stripe.invoices.voidInvoice(invId).catch(() => undefined);
        return { ok: false, code: "declined", error: "The card on file was declined. Nobody was added and nothing was charged." };
      }
    } catch (err) {
      console.warn("[toolPlans] changing people failed:", err);
      return { ok: false, code: "failed", error: "Couldn't change the number of people. Try again." };
    }
    r.record.seat = extra === 0 ? null : { itemId: line.id, quantity: extra, cents: line.price?.unit_amount ?? 0 };
  }
  await writeToolsRecord(organizationId, r.record);
  return { ok: true, extra };
}

// ── buying a tool, switching the main tool, changing the size (part 3b) ───────

const running = (tr: ToolTry | undefined, now: Date): tr is ToolTry => !!tr && !tr.billedAt && !tr.failedAt && Date.parse(tr.endsAt) > now.getTime();
const sizeHolds = (record: ToolsRecord, plan: ToolPlanId = record.plan, chosenTrade: readonly ToolId[] = record.chosenTrade) =>
  toolsOpen({ plan, main: null, kept: [], chosenTrade });
/** The paid period's end on a line (or the subscription), as an ISO date; null when Stripe gave none. */
function periodEndOf(sub: Stripe.Subscription, item?: Stripe.SubscriptionItem): string | null {
  const end = item?.current_period_end ?? (sub as unknown as { current_period_end?: number }).current_period_end;
  return end ? new Date(end * 1000).toISOString() : null;
}

export type AddResult = { ok: true; chargedNow: boolean; backOnTry: boolean } | Fail;

/**
 * ADD A TOOL NOW (owner, 2026-11-10) — without a try, or after its try was used. In the sign-up's free days it rides
 * the trial (billed with the plan); after them the rest of the month is charged at once, all or nothing on the card.
 * A tool removed from the bill but still open to the month's end goes back on with no second charge for the month.
 * A try removed but still running is simply taken back (it bills at its end, as if never removed). Buying needs a card:
 * a card-less trial is refused in words.
 */
export async function addTool(organizationId: string, tool: ToolId, now = new Date(), deps?: Deps): Promise<AddResult> {
  const r = await ready(organizationId, deps, { allowCardless: true });
  if (!r.ok) return r;
  const record = r.record;
  if (record.main === tool) return { ok: false, code: "main", error: "That's your main tool. It's on your plan already." };
  if (sizeHolds(record).has(tool)) return { ok: false, code: "included", error: "Your plan already includes it." };
  if (record.lines[tool] && !running(record.tries[tool], now)) return { ok: false, code: "already", error: "It's on your bill already." };
  const tr = record.tries[tool];
  if (running(tr, now)) {
    if (!tr.removedAt) return { ok: false, code: "already", error: "It's on a free try. It goes on your bill by itself when the try ends." };
    // Taken back: a try that rode the trial needs its line again; one after the free days bills at its end anyway.
    if (tr.onLine && !record.lines[tool]) {
      if (!("sub" in r)) return { ok: false, code: "no-subscription", error: "Adding a tool needs a card on file. Add a card on Subscription first." };
      const cat = await readToolCatalog();
      let price: string;
      try {
        price = await priceFor(r.deps, cat, toolKind(tool), termOf(r.sub));
      } catch {
        return { ok: false, code: "failed", error: "Couldn't add it. Try again." };
      }
      const added = await addLine(r.deps, r.sub, organizationId, price, 1, { charge: false });
      if (!added.ok) return added;
      const line = lineOf(added.sub, toolKind(tool));
      if (line) record.lines[tool] = { itemId: line.id, cents: line.price?.unit_amount ?? 0, since: now.toISOString() };
    }
    delete tr.removedAt;
    await writeToolsRecord(organizationId, record);
    return { ok: true, chargedNow: false, backOnTry: true };
  }
  if (!("sub" in r)) return { ok: false, code: "no-subscription", error: "Adding a tool needs a card on file. Add a card on Subscription first." };
  const until = record.closing[tool];
  const paidThisMonth = !!until && Date.parse(until) > now.getTime();
  const cat = await readToolCatalog();
  let price: string;
  try {
    price = await priceFor(r.deps, cat, toolKind(tool), termOf(r.sub));
  } catch (err) {
    console.warn("[toolPlans] the price could not be made:", err);
    return { ok: false, code: "failed", error: "Couldn't add it. Try again." };
  }
  const added = await addLine(r.deps, r.sub, organizationId, price, 1, { charge: !paidThisMonth });
  if (!added.ok) return added;
  const line = lineOf(added.sub, toolKind(tool));
  if (line) record.lines[tool] = { itemId: line.id, cents: line.price?.unit_amount ?? 0, since: now.toISOString() };
  delete record.closing[tool];
  await writeToolsRecord(organizationId, record);
  return { ok: true, chargedNow: r.sub.status !== "trialing" && !paidThisMonth, backOnTry: false };
}

/**
 * SWITCH THE MAIN TOOL — only in the sign-up's free days (owner, 2026-11-10: "the 7 days keep counting; switch as
 * often as they like"). The old main tool's line goes and the new one's goes on, with no proration (nothing has been
 * paid yet); a line the size includes is never put on, and one it now includes comes off. Advanced's two included
 * trade tools follow the main tool. A card-less trial: the record alone. After the free days: refused in words.
 */
export async function switchMainTool(organizationId: string, tool: ToolId, now = new Date(), deps?: Deps): Promise<{ ok: true; main: ToolId } | Fail> {
  const r = await ready(organizationId, deps, { allowCardless: true });
  if (!r.ok) return r;
  const freeDays = r.row.status === "TRIALING" && !!r.row.trialEndsAt && r.row.trialEndsAt.getTime() > now.getTime();
  if (!freeDays) return { ok: false, code: "not-trial", error: "After your free days, add the new tool and remove the old one." };
  const record = r.record;
  const old = record.main;
  if (old === tool) return { ok: false, code: "already", error: "That's your main tool already." };
  if (sizeHolds(record, record.plan, []).has(tool)) return { ok: false, code: "included", error: "Your plan already includes it, so it can't be the main tool." };
  const cat = await readToolCatalog();
  const size = cat.plans.find((p) => p.id === record.plan)!;
  let chosen = record.chosenTrade;
  if (typeof size.includedTrade === "number" && size.includedTrade > 0) {
    const others = chosen.filter((id) => id !== old && id !== tool);
    chosen = [...(toolById(tool).kind === "trade" ? [tool] : []), ...others].slice(0, size.includedTrade);
  }
  const holds = sizeHolds(record, record.plan, chosen);
  const drop = (Object.keys(record.lines) as ToolId[]).filter((id) => id === old || holds.has(id));
  const needLine = !holds.has(tool) && !record.lines[tool];
  if ("sub" in r && (drop.length || needLine)) {
    let price: string | null = null;
    try {
      if (needLine) price = await priceFor(r.deps, cat, toolKind(tool), termOf(r.sub));
    } catch {
      return { ok: false, code: "failed", error: "Couldn't switch your main tool. Try again." };
    }
    let next: Stripe.Subscription;
    try {
      next = await r.deps.stripe.subscriptions.update(r.sub.id, {
        items: [...drop.map((id) => ({ id: record.lines[id]!.itemId, deleted: true })), ...(price ? [{ price, quantity: 1 }] : [])],
        proration_behavior: "none",
        metadata: { ...(r.sub.metadata ?? {}), organizationId },
      });
    } catch (err) {
      console.warn("[toolPlans] switching the main tool failed:", err);
      return { ok: false, code: "failed", error: "Couldn't switch your main tool. Try again." };
    }
    for (const id of drop) delete record.lines[id];
    const line = price ? lineOf(next, toolKind(tool)) : undefined;
    if (line) record.lines[tool] = { itemId: line.id, cents: line.price?.unit_amount ?? 0, since: now.toISOString() };
  }
  // The new main tool and the tools the size now includes are never billed as tries.
  for (const id of [tool, ...holds]) {
    const tr = record.tries[id];
    if (running(tr, now) && !tr.removedAt) tr.removedAt = now.toISOString();
  }
  record.main = tool;
  record.chosenTrade = chosen;
  await writeToolsRecord(organizationId, record);
  return { ok: true, main: tool };
}

export type PlanChangeResult = { ok: true; plan: ToolPlanId; chargedNow: boolean; leftover: boolean } | Fail;

/**
 * MOVE TO ANOTHER SIZE (owner, 2026-11-10). The plan's line takes the new size's price: up, the rest of the month is
 * charged at once, all or nothing (in the free days, nothing); down, no proration and no refund. The tool lines the
 * new size includes come off (no proration); Advanced picks its two trade tools — the main tool if it is one, then the
 * dearest on the bill. The people line follows the people on the team at the new size's price (Basic: the owner alone,
 * so a team must go first). Going down, the tools the old size included close at the end of the paid month (at once in
 * the free days, when nothing was paid) — except the main tool, which goes on the bill. Subscription.plan moves too.
 */
export async function changeToolsPlan(organizationId: string, toPlan: ToolPlanId, deps?: Deps, now = new Date()): Promise<PlanChangeResult> {
  const r = await ready(organizationId, deps, { allowCardless: true });
  if (!r.ok) return r;
  const record = r.record;
  const from = record.plan;
  const cat = await readToolCatalog();
  const target = cat.plans.find((p) => p.id === toPlan);
  if (!target) return { ok: false, code: "failed", error: "That plan doesn't exist." };
  if (from === toPlan) return { ok: false, code: "already", error: `You're on ${target.name} already.` };
  const people = (await countPeoplePool(organizationId)) + 1;
  if (target.seatCents === null && people > 1) {
    const n = people - 1;
    return { ok: false, code: "people", error: `Basic is just you. Remove the other ${n} ${n === 1 ? "person" : "people"} first, then switch.` };
  }
  const up = sizeRank(toPlan) > sizeRank(from);
  const lineIds = Object.keys(record.lines) as ToolId[];
  const chosen = chosenTradeFor(toPlan, record.main, lineIds, cat);
  const holdsAfter = sizeHolds(record, toPlan, chosen);
  const before = record.chosenTrade.length ? record.chosenTrade : chosenTradeFor(from, record.main, lineIds, cat);
  const holdsBefore = sizeHolds(record, from, before);
  const drop = lineIds.filter((id) => holdsAfter.has(id));
  const main = record.main;
  const mainNeedsLine = !!main && !holdsAfter.has(main) && !record.lines[main];
  const lost = [...holdsBefore].filter((id) => id !== main && !holdsAfter.has(id) && !record.lines[id]);
  const extra = target.seatCents === null ? 0 : Math.max(0, people - target.seats);
  const finish = async (chargedNow: boolean, leftover: boolean, closeAt: string | null, planPrice: string | null) => {
    record.plan = toPlan;
    record.chosenTrade = chosen;
    for (const id of lost) {
      if (closeAt && Date.parse(closeAt) > now.getTime()) record.closing[id] = closeAt;
    }
    for (const id of holdsAfter) {
      const tr = record.tries[id];
      if (running(tr, now) && !tr.removedAt) tr.removedAt = now.toISOString();
    }
    await db.subscription.update({ where: { organizationId }, data: { plan: target.slug.toUpperCase(), ...(planPrice ? { stripePriceId: planPrice } : {}) } });
    await writeToolsRecord(organizationId, record);
    return { ok: true as const, plan: toPlan, chargedNow, leftover };
  };
  // A card-less trial: nothing is billed yet, the record and the plan alone.
  if (!("sub" in r)) return finish(false, false, null, null);

  const sub = r.sub;
  const trialing = sub.status === "trialing";
  const interval = termOf(sub);
  const planItem = sub.items.data.find((i) => planIdOfKind(kindOf(i)));
  if (!planItem) return { ok: false, code: "failed", error: "Couldn't find your plan on the bill. Write to us from Help." };
  let planPrice: string;
  let seatPrice: string | null = null;
  let mainPrice: string | null = null;
  try {
    planPrice = await priceFor(r.deps, cat, target.slug, interval);
    if (extra > 0) seatPrice = await priceFor(r.deps, cat, SEAT_KIND, interval, toPlan);
    if (mainNeedsLine) mainPrice = await priceFor(r.deps, cat, toolKind(main!), interval);
  } catch (err) {
    console.warn("[toolPlans] the price could not be made:", err);
    return { ok: false, code: "failed", error: "Couldn't change your plan. Try again." };
  }
  const seatLine = lineOf(sub, SEAT_KIND);
  type Item = Stripe.SubscriptionUpdateParams.Item;
  const swap: Item[] = [{ id: planItem.id, price: planPrice }];
  const seat: Item[] = seatPrice ? [seatLine ? { id: seatLine.id, price: seatPrice, quantity: extra } : { price: seatPrice, quantity: extra }] : [];
  const rest: Item[] = [
    ...(!seatPrice && seatLine ? [{ id: seatLine.id, deleted: true }] : []),
    ...drop.map((id) => ({ id: record.lines[id]!.itemId, deleted: true })),
    ...(mainPrice ? [{ price: mainPrice, quantity: 1 }] : []),
  ];
  const metadata = { ...(sub.metadata ?? {}), organizationId, planSlug: target.slug };
  const charge = up && !trialing;
  let next: Stripe.Subscription;
  let leftover = false;
  try {
    if (charge) {
      // The charge first, all or nothing (only the fields a pending update takes); then what comes off, no proration.
      next = await r.deps.stripe.subscriptions.update(sub.id, { items: [...swap, ...seat], proration_behavior: "always_invoice", payment_behavior: "pending_if_incomplete", expand: ["latest_invoice"] });
      if (next.pending_update) {
        const inv = next.latest_invoice;
        const invId = typeof inv === "string" ? inv : inv?.id;
        if (invId) await r.deps.stripe.invoices.voidInvoice(invId).catch((err) => console.warn("[toolPlans] void failed:", err));
        return { ok: false, code: "declined", error: "The card on file was declined. Your plan didn't change and nothing was charged." };
      }
      try {
        next = await r.deps.stripe.subscriptions.update(sub.id, { ...(rest.length ? { items: rest } : {}), proration_behavior: "none", metadata });
      } catch (err) {
        // On the bigger plan already; a line it includes could not come off. Said to the owner, mirrored as it is.
        console.warn("[toolPlans] taking included lines off failed:", err);
        leftover = rest.length > 0;
      }
    } else {
      next = await r.deps.stripe.subscriptions.update(sub.id, { items: [...swap, ...seat, ...rest], proration_behavior: "none", metadata });
    }
  } catch (err) {
    console.warn("[toolPlans] changing the plan failed:", err);
    return { ok: false, code: "failed", error: "Couldn't change your plan. Try again." };
  }
  if (!leftover) for (const id of drop) delete record.lines[id];
  if (mainPrice && main && !leftover) {
    const line = lineOf(next, toolKind(main));
    if (line) record.lines[main] = { itemId: line.id, cents: line.price?.unit_amount ?? 0, since: now.toISOString() };
  }
  const seatNow = lineOf(next, SEAT_KIND);
  record.seat = extra > 0 && seatNow ? { itemId: seatNow.id, quantity: extra, cents: seatNow.price?.unit_amount ?? 0 } : leftover ? record.seat : null;
  // Going down: the old size's tools were paid to the month's end (in the free days nothing was — they close now).
  return finish(charge, leftover, trialing ? null : periodEndOf(sub, planItem), planPrice);
}

// ── the reminder a day before a try ends (part 3b) ───────────────────────────

export const TRY_REMINDER_KIND = "PLAN_TOOL_TRY";
export const TOOLS_SUBSCRIPTION_HREF = "/dashboard/subscription#tools";

export interface ReminderResult {
  scanned: number;
  sent: number;
  skipped: number;
  failed: number;
}

/**
 * "FREE UNTIL TOMORROW" (owner, 2026-11-10: "a reminder a day before (email + the in-app bell)"). Hourly from
 * /api/cron/trials: for each shop, the tries that end within a day, not removed, not billed and not reminded yet —
 * ONE email to the owner and ONE bell row (the owner's only) naming them all, then each try is stamped remindedAt so
 * it is never sent twice (stamped before the send, as lib/trialEndingMail does). A card-less trial is left to its own
 * letters (nothing is billed without a card), a Classic or lapsed shop to nothing.
 */
export async function sendTryReminders(now = new Date()): Promise<ReminderResult> {
  const out: ReminderResult = { scanned: 0, sent: 0, skipped: 0, failed: 0 };
  const rows = await db.syncState.findMany({ where: { key: { startsWith: TOOLS_RECORD_PREFIX } }, select: { key: true, cursor: true } });
  const dueOf = (record: ToolsRecord) => {
    const holds = sizeHolds(record);
    return (Object.entries(record.tries) as Array<[ToolId, ToolTry]>)
      .filter(([id, tr]) => id !== record.main && !holds.has(id) && !tr.removedAt && !tr.billedAt && !tr.failedAt && !tr.remindedAt)
      .filter(([, tr]) => Date.parse(tr.endsAt) > now.getTime() && tryReminderAt(new Date(tr.startedAt), new Date(tr.endsAt)).getTime() <= now.getTime())
      .map(([id]) => id);
  };
  for (const row of rows) {
    const organizationId = row.key.slice(TOOLS_RECORD_PREFIX.length);
    const first = parseToolsRecord(row.cursor);
    if (!first) continue;
    out.scanned++;
    if (!dueOf(first).length) continue;
    try {
      const sub = await db.subscription.findUnique({ where: { organizationId }, select: { plan: true, status: true, externalSubId: true } });
      if (!sub || !isToolsSlug(sub.plan) || !sub.externalSubId || !["TRIALING", "ACTIVE", "PAST_DUE"].includes(sub.status)) {
        out.skipped++;
        continue;
      }
      // Read again just before the stamp, so a Remove made a moment ago isn't written over.
      const record = (await readToolsRecord(organizationId)) ?? first;
      const due = dueOf(record);
      if (!due.length) continue;
      for (const id of due) record.tries[id]!.remindedAt = now.toISOString();
      await writeToolsRecord(organizationId, record);

      const [cat, org] = await Promise.all([
        readToolCatalog(),
        db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } }),
      ]);
      const tz = org?.timezone || undefined;
      const items = due.map((id) => ({
        label: cat.tools.find((t) => t.id === id)!.label,
        cents: cat.tools.find((t) => t.id === id)!.cents,
        day: tryDayWords(new Date(record.tries[id]!.endsAt), now, tz),
      }));
      const words = tryReminderWords(items);
      await db.activityEvent.create({
        data: { organizationId, actorId: null, kind: TRY_REMINDER_KIND, summary: words.line, meta: JSON.stringify({ href: TOOLS_SUBSCRIPTION_HREF, tools: due }) },
      });
      const [{ ownerContact }, { isQaEmail }, { appBaseUrl }, { renderEmail }, { sendEmail }, { buildToolTryEnding }] = await Promise.all([
        import("@/lib/cardUpdate"),
        import("@/lib/qaEmail"),
        import("@/lib/appUrl"),
        import("@/lib/email/renderEmail"),
        import("@/lib/sdk/resend"),
        import("@/lib/email/build/trial"),
      ]);
      const to = await ownerContact(organizationId);
      if (to && !isQaEmail(to.email)) {
        const base = (await appBaseUrl()).replace(/\/$/, "");
        const { subject, html } = renderEmail(buildToolTryEnding({ name: to.name, subject: words.subject, line: words.line, items, href: `${base}${TOOLS_SUBSCRIPTION_HREF}` }));
        await sendEmail({ mailClass: "transactional", to: to.email, subject, html, kind: "dunning", organizationId });
      }
      out.sent++;
    } catch (err) {
      out.failed++;
      console.warn(`[toolPlans] try reminder ${organizationId}:`, err instanceof Error ? err.message : err);
    }
  }
  return out;
}

// ── the hourly sweep ─────────────────────────────────────────────────────────

export interface SweepResult {
  scanned: number;
  billed: number;
  declined: number;
  settled: number;
  closed: number;
  failed: number;
}

/** TRIES THAT ENDED: not removed → on the bill (the owner's rule). A try that rode the trial is already a line —
 *  it is marked billed. Removed-from-bill tools whose paid period ran out are closed. */
export async function billEndedTries(now = new Date(), deps?: Deps): Promise<SweepResult> {
  const out: SweepResult = { scanned: 0, billed: 0, declined: 0, settled: 0, closed: 0, failed: 0 };
  const rows = await db.syncState.findMany({ where: { key: { startsWith: TOOLS_RECORD_PREFIX } }, select: { key: true, cursor: true } });
  for (const row of rows) {
    const organizationId = row.key.slice(TOOLS_RECORD_PREFIX.length);
    const record = parseToolsRecord(row.cursor);
    if (!record) continue;
    out.scanned++;
    let changed = false;
    // Rode the trial: the line is on the subscription already; the trial's end bills it.
    for (const [id, tr] of Object.entries(record.tries) as Array<[ToolId, NonNullable<ToolsRecord["tries"][ToolId]>]>) {
      if (tr.onLine && !tr.removedAt && !tr.billedAt && !tr.failedAt && Date.parse(tr.endsAt) <= now.getTime() && record.lines[id]) {
        tr.billedAt = tr.endsAt;
        out.settled++;
        changed = true;
      }
    }
    for (const [id, until] of Object.entries(record.closing) as Array<[ToolId, string]>) {
      if (Date.parse(until) <= now.getTime()) {
        delete record.closing[id];
        out.closed++;
        changed = true;
      }
    }
    if (changed) await writeToolsRecord(organizationId, record);
    const due = triesToBill(record, now);
    if (!due.length) continue;
    const r = await ready(organizationId, deps);
    if (!r.ok || !("sub" in r)) {
      out.failed++;
      continue;
    }
    const cat = await readToolCatalog();
    let sub = r.sub;
    for (const id of due) {
      const tr = r.record.tries[id]!;
      let price: string;
      try {
        price = await priceFor(r.deps, cat, toolKind(id), termOf(sub));
      } catch {
        out.failed++;
        continue;
      }
      const added = await addLine(r.deps, sub, organizationId, price);
      if (!added.ok) {
        if (added.code === "declined") {
          tr.failedAt = now.toISOString();
          out.declined++;
        } else out.failed++;
        continue;
      }
      sub = added.sub;
      const line = lineOf(sub, toolKind(id));
      if (line) r.record.lines[id] = { itemId: line.id, cents: line.price?.unit_amount ?? 0, since: now.toISOString() };
      tr.billedAt = now.toISOString();
      out.billed++;
    }
    await writeToolsRecord(organizationId, r.record);
  }
  return out;
}

// ── the webhook's side ───────────────────────────────────────────────────────

/** KEEP THE RECORD TO WHAT STRIPE HOLDS: the tool lines and the people line on the shop's subscription. A Classic
 *  subscription (no line of the new plans) is left alone without a database read. */
export async function mirrorToolLines(sub: Stripe.Subscription, ended = false, knownOrganizationId?: string | null, stripe?: Stripe): Promise<void> {
  const items = stripe ? await allItems(stripe, sub) : (sub.items?.data ?? []);
  const planItem = items.find((i) => planIdOfKind(kindOf(i)));
  if (!planItem && !ended) return;
  const organizationId =
    knownOrganizationId ||
    sub.metadata?.organizationId ||
    (await db.subscription.findFirst({ where: { externalSubId: sub.id }, select: { organizationId: true } }))?.organizationId;
  if (!organizationId) return;
  const existing = await readToolsRecord(organizationId);
  const over = ended || sub.status === "canceled" || sub.status === "incomplete_expired";
  if (over) {
    if (existing && existing.subId === sub.id) {
      /* THE PLAN ENDED (a trial that ran out with no card, a cancellation): its lines are gone, and so is every free try
         still waiting to be billed — marked removed, so a plan started again later (lib/cardlessTrial's restart bills
         the size and the main tool it shows) is never charged, a day on, for tools ticked in a trial that lapsed
         (owner, 2026-11-12: the builder makes several tools on a trial the usual case). */
      const stamp = new Date().toISOString();
      let closed = false;
      for (const tr of Object.values(existing.tries)) {
        if (tr && !tr.billedAt && !tr.failedAt && !tr.removedAt) {
          tr.removedAt = stamp;
          closed = true;
        }
      }
      if (closed || Object.keys(existing.lines).length || existing.seat) await writeToolsRecord(organizationId, { ...existing, lines: {}, seat: null });
    }
    return;
  }
  const current = await db.subscription.findUnique({ where: { organizationId }, select: { externalSubId: true } });
  if (current?.externalSubId && current.externalSubId !== sub.id) return;
  const planId = planIdOfKind(kindOf(planItem!))!;
  const record: ToolsRecord = existing ?? emptyToolsRecord(planId);
  record.plan = planId;
  record.subId = sub.id;
  const lines: ToolsRecord["lines"] = {};
  let seat: ToolsRecord["seat"] = null;
  for (const item of items) {
    const tool = toolIdOfKind(kindOf(item));
    if (tool) lines[tool] = { itemId: item.id, cents: item.price?.unit_amount ?? 0, since: record.lines[tool]?.since ?? new Date().toISOString() };
    else if (kindOf(item) === SEAT_KIND) seat = { itemId: item.id, quantity: item.quantity ?? 0, cents: item.price?.unit_amount ?? 0 };
  }
  // A try that rode the trial and was removed in Stripe directly: it is removed here too.
  for (const [id, tr] of Object.entries(record.tries) as Array<[ToolId, NonNullable<ToolsRecord["tries"][ToolId]>]>) {
    if (tr.onLine && !tr.billedAt && !tr.removedAt && record.lines[id] && !lines[id]) tr.removedAt = new Date().toISOString();
  }
  const same = JSON.stringify({ l: record.lines, s: record.seat }) === JSON.stringify({ l: lines, s: seat }) && existing?.subId === sub.id;
  if (same && existing) return;
  record.lines = lines;
  record.seat = seat;
  await writeToolsRecord(organizationId, record);
}
