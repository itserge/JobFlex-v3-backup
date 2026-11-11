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
import { readToolCatalog } from "./prices";
import {
  emptyToolsRecord,
  isToolsSlug,
  kindName,
  parseToolsRecord,
  planIdOfKind,
  SEAT_KIND,
  shopFromRecord,
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
  interval: Interval;
  people?: number;
  catalog?: Catalog;
}): Promise<Array<{ price: string; quantity: number }>> {
  const cat = opts.catalog ?? (await readToolCatalog());
  const plan = cat.plans.find((p) => p.id === opts.plan)!;
  const items: Array<{ price: string; quantity: number }> = [{ price: await priceFor(opts.deps, cat, plan.slug, opts.interval), quantity: 1 }];
  const included = toolsOpen({ plan: opts.plan, main: null, kept: [], chosenTrade: opts.main ? [opts.main] : [] });
  if (opts.main && !included.has(opts.main)) items.push({ price: await priceFor(opts.deps, cat, toolKind(opts.main), opts.interval), quantity: 1 });
  const extra = plan.seatCents === null ? 0 : Math.max(0, (opts.people ?? 1) - plan.seats);
  if (extra > 0) items.push({ price: await priceFor(opts.deps, cat, SEAT_KIND, opts.interval, opts.plan), quantity: extra });
  return items;
}

// ── the shop's subscription ──────────────────────────────────────────────────

export type ToolsFailure = "not-tools" | "no-subscription" | "unreachable" | "not-live" | "past-due" | "declined" | "failed" | "already" | "tried" | "included" | "main" | "not-held" | "basic";

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

/** Add one line. In a trial: no proration (billed with the plan). After it: the rest of the period now, all or nothing. */
async function addLine(deps: Deps, sub: Stripe.Subscription, organizationId: string, price: string, quantity = 1): Promise<{ ok: true; sub: Stripe.Subscription } | { ok: false; code: ToolsFailure; error: string }> {
  const trialing = sub.status === "trialing";
  let next: Stripe.Subscription;
  try {
    next = await deps.stripe.subscriptions.update(sub.id, {
      items: [{ price, quantity }],
      proration_behavior: trialing ? "none" : "always_invoice",
      ...(trialing ? {} : { payment_behavior: "pending_if_incomplete" as const }),
      metadata: { ...(sub.metadata ?? {}), organizationId },
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
 *  and the tool stays open until the paid period ends. The main tool is switched, not removed (part 4). */
export async function removeTool(organizationId: string, tool: ToolId, now = new Date(), deps?: Deps): Promise<{ ok: true; openUntil: string | null } | { ok: false; code: ToolsFailure; error: string }> {
  const r = await ready(organizationId, deps, { allowCardless: true });
  if (!r.ok) return r;
  const record = r.record;
  if (record.main === tool) return { ok: false, code: "main", error: "That's your main tool. Switch it on Subscription instead." };
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
  await writeToolsRecord(organizationId, record);
  return { ok: true, openUntil };
}

// ── people ───────────────────────────────────────────────────────────────────

/** HOW MANY PEOPLE: the extra-people line follows (quantity = people past the plan's). Basic has no extra people. */
export async function setPeople(organizationId: string, people: number, deps?: Deps): Promise<{ ok: true; extra: number } | { ok: false; code: ToolsFailure; error: string }> {
  const r = await ready(organizationId, deps);
  if (!r.ok) return r;
  if (!("sub" in r)) return { ok: false, code: "no-subscription", error: "Add a card on Subscription first." };
  const cat = await readToolCatalog();
  const plan = cat.plans.find((p) => p.id === r.record.plan)!;
  if (plan.seatCents === null) return { ok: false, code: "basic", error: "Basic is just you. Move to Professional to add people." };
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
    if (existing && existing.subId === sub.id && (Object.keys(existing.lines).length || existing.seat)) {
      await writeToolsRecord(organizationId, { ...existing, lines: {}, seat: null });
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
