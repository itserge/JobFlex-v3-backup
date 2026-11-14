// THE NEW PLANS' NUMBERS (Base + Tools, part 5 — owner, 2026-11-10: "the numbers: MRR by tool, tries kept, Classic
// vs new"). Pure and client-safe: the subscriber rows (lib/subscribersRead — the very rows Admin → Revenue's MRR is
// the sum of) and the shops' records (SyncState `orgTools:<orgId>`) go in, the figures Admin → Revenue's "New plans"
// section prints come out. lib/toolPlans/numbersServer reads the two and calls this.
//
//   shops      live subscriptions (active, trialing, past due) on a "tools-" slug, by size
//   MRR        the MRR rule's own sum (countsTowardMrr, after coupons), split new plans vs Classic
//   by size    the plan's line and the extra-people line of each subscription that counts toward MRR
//   by tool    each "tool-<id>" line of those subscriptions, a month's worth (a yearly line ÷ 12)
//   tries      every free try in every record: started, still open, kept (billed — or it became the main tool, or
//              the size now includes it), removed, declined (the card failed), and the reminders sent
//
// The by-size and by-tool amounts are the lines' list amounts, before any coupon; when a coupon makes the MRR smaller
// than its lines, `coupons` says by how much, so the page never shows two totals that silently disagree.

import {
  DEFAULT_CATALOG,
  SEAT_KIND,
  TOOL_PLANS,
  TOOLS,
  chosenTradeFor,
  emptyToolsRecord,
  isToolsSlug,
  planIdOfKind,
  toolById,
  toolIdOfKind,
  toolKind,
  toolPlanBySlug,
  toolsOpen,
  money,
  YEAR_MONTHS,
  type Catalog,
  type ToolId,
  type ToolPlanId,
  type ToolsRecord,
  type ToolTry,
} from "./shared";

/** One line of a new-plan subscription as Stripe holds it: its kind (price metadata.jfKind), its own price and term. */
export interface ToolsLine {
  kind: string;
  /** The price's amount for one unit and one term, in cents (Stripe's unit_amount). */
  unitCents: number;
  quantity: number;
  interval: "day" | "week" | "month" | "year";
  intervalCount: number;
}

/** A month's worth of a line, in cents: a yearly line ÷ 12, the quantity counted — the subscribers read's own rule. */
export function lineMonthlyCents(line: ToolsLine): number {
  const count = line.intervalCount > 0 ? line.intervalCount : 1;
  const amt = line.unitCents;
  const perMonth =
    line.interval === "year" ? amt / (12 * count) : line.interval === "week" ? (amt * 52) / (12 * count) : line.interval === "day" ? (amt * 365) / (12 * count) : amt / count;
  return Math.round(perMonth * Math.max(0, line.quantity));
}

/** What the numbers read off a subscriber row (lib/subscribersRead SubscriberRow has every field). */
export interface NumbersRow {
  id: string;
  organizationId: string | null;
  plan: string;
  status: string;
  countsTowardMrr: boolean;
  amountCents: number;
  /** A new-plan subscription's lines; absent on a Classic row and on a row nobody could price. */
  toolsLines?: readonly ToolsLine[] | null;
  /** The Free plan's ended row (lib/freePlan) — not a shop on a plan. */
  onFree?: boolean;
  /** Stripe's own subscription, or the platform's record of one (lib/subscribersRead). */
  source?: "stripe" | "record";
}

export interface TryStats {
  started: number;
  /** Not decided yet: running, or ended a moment ago and not swept onto the bill yet. */
  open: number;
  kept: number;
  removed: number;
  declined: number;
  /** kept ÷ (kept + removed + declined); null before any try is decided. */
  keepRate: number | null;
}

export interface SizeNumbers {
  plan: ToolPlanId;
  name: string;
  /** Live subscriptions on this size (active, trialing, past due). */
  shops: number;
  /** Of those, counted in MRR (active and billed). */
  paying: number;
  trialing: number;
  /** People paid for past the size's own, over the paying shops. */
  extraPeople: number;
  /** The plan's line and the extra-people line, a month, over the paying shops. */
  mrrCents: number;
}

export interface ToolNumbers {
  tool: ToolId;
  label: string;
  /** Paying shops with the tool's line on their bill. */
  paying: number;
  /** Its lines, a month, over the paying shops. */
  mrrCents: number;
  /** Live new-plan shops that signed up for it (their main tool). */
  mainOf: number;
  tries: TryStats;
}

export interface ToolPlansNumbers {
  /** No shop on the new plans and no record: the page says so in one line. */
  empty: boolean;
  shops: number;
  paying: number;
  trialing: number;
  bySize: SizeNumbers[];
  mrr: {
    newCents: number;
    classicCents: number;
    /** newCents ÷ (newCents + classicCents); null when both are 0. */
    newShare: number | null;
    newSubs: number;
    classicSubs: number;
  };
  /** Every tool, in the catalog's order. */
  byTool: ToolNumbers[];
  tries: TryStats & { reminded: number };
  /** Paying new-plan subscriptions whose MRR is below their lines (a coupon), and by how much a month. */
  coupons: { rows: number; gapCents: number };
  /** Paying new-plan subscriptions with no lines to read (counted in MRR, left out of by size and by tool). */
  unpriced: number;
}

/** What Admin → Revenue keeps and draws (lib/toolPlans/numbersServer): the figures, the Plans switch, the rows' source. */
export type ToolPlansReport = ToolPlansNumbers & {
  /** The Plans switch (Admin → Trial watch): whether new sign-ups get the new plans now. */
  switchOn: boolean;
  /** Where the rows came from: Stripe, or the platform's own record (Stripe not set up, or not reachable). */
  source: "stripe" | "record";
};

const LIVE = new Set(["ACTIVE", "TRIALING", "PAST_DUE"]);

function emptyTries(): TryStats {
  return { started: 0, open: 0, kept: 0, removed: 0, declined: 0, keepRate: null };
}

function withRate(t: TryStats): TryStats {
  const decided = t.kept + t.removed + t.declined;
  return { ...t, keepRate: decided ? t.kept / decided : null };
}

/** How a try ended (or that it hasn't): billed, declined, removed — and a try whose tool became the shop's main tool
 *  or one its size now includes counts as kept (lib/toolPlans/billing switchMainTool stamps it removed so it is never
 *  billed twice; the shop kept the tool all the same). */
export function tryOutcome(id: ToolId, tr: ToolTry, record: Pick<ToolsRecord, "plan" | "main" | "chosenTrade">): "kept" | "declined" | "removed" | "open" {
  if (tr.billedAt) return "kept";
  if (tr.failedAt) return "declined";
  const holds = toolsOpen({ plan: record.plan, main: null, kept: [], chosenTrade: record.chosenTrade });
  if (id === record.main || holds.has(id)) return "kept";
  if (tr.removedAt) return "removed";
  return "open";
}

export function toolPlansNumbers(input: { rows: readonly NumbersRow[]; records: ReadonlyArray<{ organizationId: string; record: ToolsRecord }> }): ToolPlansNumbers {
  const rows = input.rows.filter((r) => !r.onFree);
  // A shop is counted once: the subscribers read can list a company twice — Stripe's subscription and the platform's
  // record of an older one Stripe didn't return (never in MRR). The row that counts toward MRR wins, then Stripe's.
  const rank = (r: NumbersRow) => (r.countsTowardMrr ? 3 : r.source === "stripe" ? 2 : 1);
  const byShop = new Map<string, NumbersRow>();
  for (const r of rows) {
    if (!isToolsSlug(r.plan) || !LIVE.has(r.status.toUpperCase())) continue;
    const k = r.organizationId ?? `row:${r.id}`;
    const cur = byShop.get(k);
    if (!cur || rank(r) > rank(cur)) byShop.set(k, r);
  }
  const live = [...byShop.values()];
  // MRR is per subscription, as the rule counts it.
  const paying = rows.filter((r) => isToolsSlug(r.plan) && r.countsTowardMrr);

  // ── MRR, the rule's own rows ──
  const mrrRows = rows.filter((r) => r.countsTowardMrr);
  const newRows = mrrRows.filter((r) => isToolsSlug(r.plan));
  const classicRows = mrrRows.filter((r) => !isToolsSlug(r.plan));
  const newCents = newRows.reduce((n, r) => n + r.amountCents, 0);
  const classicCents = classicRows.reduce((n, r) => n + r.amountCents, 0);

  // ── by size ──
  const bySize: SizeNumbers[] = TOOL_PLANS.map((p) => ({ plan: p.id, name: p.name, shops: 0, paying: 0, trialing: 0, extraPeople: 0, mrrCents: 0 }));
  const size = (slug: string) => {
    const id = toolPlanBySlug(slug)?.id;
    return id ? bySize.find((s) => s.plan === id)! : null;
  };
  for (const r of live) {
    const s = size(r.plan);
    if (!s) continue;
    s.shops++;
    if (r.status.toUpperCase() === "TRIALING") s.trialing++;
  }

  // ── by tool ──
  const byTool: ToolNumbers[] = TOOLS.map((t) => ({ tool: t.id, label: t.label, paying: 0, mrrCents: 0, mainOf: 0, tries: emptyTries() }));
  const tool = (id: ToolId) => byTool.find((t) => t.tool === id)!;

  const coupons = { rows: 0, gapCents: 0 };
  let unpriced = 0;
  for (const r of paying) {
    const s = size(r.plan);
    if (s) s.paying++;
    const lines = r.toolsLines ?? [];
    if (!lines.length) {
      unpriced++;
      continue;
    }
    let gross = 0;
    const seen = new Set<ToolId>();
    for (const line of lines) {
      const cents = lineMonthlyCents(line);
      gross += cents;
      const t = toolIdOfKind(line.kind);
      if (t) {
        tool(t).mrrCents += cents;
        if (!seen.has(t)) {
          seen.add(t);
          tool(t).paying++;
        }
      } else if (s && (planIdOfKind(line.kind) || line.kind === SEAT_KIND)) {
        s.mrrCents += cents;
        if (line.kind === SEAT_KIND) s.extraPeople += Math.max(0, line.quantity);
      }
    }
    if (r.amountCents < gross) {
      coupons.rows++;
      coupons.gapCents += gross - r.amountCents;
    }
  }

  // ── the main tools and the tries, from the records ──
  const liveOrgs = new Set(live.map((r) => r.organizationId).filter((id): id is string => !!id));
  const all = emptyTries();
  let reminded = 0;
  for (const { organizationId, record } of input.records) {
    if (record.main && liveOrgs.has(organizationId)) tool(record.main).mainOf++;
    for (const [id, tr] of Object.entries(record.tries) as Array<[ToolId, ToolTry]>) {
      const t = tool(id).tries;
      const outcome = tryOutcome(id, tr, record);
      t.started++;
      all.started++;
      t[outcome]++;
      all[outcome]++;
      if (tr.remindedAt) reminded++;
    }
  }
  for (const t of byTool) t.tries = withRate(t.tries);

  const shops = live.length;
  return {
    empty: live.length === 0 && input.records.length === 0,
    shops,
    paying: paying.length,
    trialing: live.filter((r) => r.status.toUpperCase() === "TRIALING").length,
    bySize,
    mrr: {
      newCents,
      classicCents,
      newShare: newCents + classicCents > 0 ? newCents / (newCents + classicCents) : null,
      newSubs: newRows.length,
      classicSubs: classicRows.length,
    },
    byTool,
    tries: { ...withRate(all), reminded },
    coupons,
    unpriced,
  };
}

/**
 * A new-plan subscription's name on the subscribers list and Admin → Revenue: "Professional · new plans", then the
 * tools on its bill and the extra people — "Professional · new plans · Deck Studio + Roof estimator · +2 people".
 * `lines` are its kinds as Stripe holds them (the plan's line is named by its own kind, never by its amount).
 */
export function toolsRowLabel(plan: string, lines: ReadonlyArray<Pick<ToolsLine, "kind" | "quantity">> = []): string {
  const kindPlan = lines.map((l) => planIdOfKind(l.kind)).find((id): id is ToolPlanId => !!id) ?? null;
  const size = kindPlan ? TOOL_PLANS.find((p) => p.id === kindPlan)! : toolPlanBySlug(plan);
  const head = `${size?.name ?? "New plan"} · new plans`;
  const tools = TOOLS.filter((t) => lines.some((l) => toolIdOfKind(l.kind) === t.id && l.quantity > 0)).map((t) => t.label);
  const extra = lines.filter((l) => l.kind === SEAT_KIND).reduce((n, l) => n + Math.max(0, l.quantity), 0);
  return [head, tools.length ? tools.join(" + ") : null, extra ? `+${extra} ${extra === 1 ? "person" : "people"}` : null].filter(Boolean).join(" · ");
}

/** A tool on a sign-up's card in Admin (owner, 2026-11-12: "show what tool he picked up when he signs up"). */
export interface SignupTool {
  id: ToolId;
  label: string;
  /** main: the shop's main tool · try: ticked beside it, free until the trial ends · bill: on the bill · included: one
   *  of the size's own trade tools · removed: taken off before it was billed. */
  state: "main" | "try" | "bill" | "included" | "removed";
}

/**
 * WHAT A NEW-PLAN SIGN-UP PICKED, for Admin's sign-up cards: the size by its name ("Basic", never the stored
 * "TOOLS-BASIC") and the tools on its record — the main tool first, then the others in the catalog's order, each with
 * what it is now. A size's office set and Complete's "everything" are not listed (the size's name says them); the
 * trade tools an Advanced shop chose as its own are. Null for a Classic slug.
 */
/** The words after a tool's name on a sign-up card: nothing for the main tool, else what it is now. */
export const SIGNUP_TOOL_WORDS: Record<SignupTool["state"], string> = { main: "main tool", try: "free try", bill: "on the bill", included: "in the plan", removed: "removed" };

/** "Deck Studio (main tool), Fence estimator (free try)" · "no tool, the plan alone". */
export function signupToolsLine(tools: readonly SignupTool[]): string {
  return tools.length ? tools.map((t) => `${t.label} (${SIGNUP_TOOL_WORDS[t.state]})`).join(", ") : "no tool, the plan alone";
}

export function signupTools(record: ToolsRecord | null, planSlug: string | null | undefined, now: Date): { size: string; tools: SignupTool[] } | null {
  const def = isToolsSlug(planSlug) ? toolPlanBySlug(planSlug) : null;
  if (!def) return null;
  const r = record ?? emptyToolsRecord(def.id);
  const t = now.getTime();
  const out: SignupTool[] = [];
  const add = (id: ToolId, state: SignupTool["state"]) => {
    if (!out.some((x) => x.id === id)) out.push({ id, label: toolById(id).label, state });
  };
  if (r.main && TOOLS.some((x) => x.id === r.main)) add(r.main, "main");
  for (const tool of TOOLS) {
    const tr = r.tries[tool.id];
    if (tr?.removedAt && !tr.billedAt) add(tool.id, "removed");
    else if (tr && !tr.billedAt && !tr.failedAt && Date.parse(tr.endsAt) > t) add(tool.id, "try");
    else if (r.lines[tool.id]) add(tool.id, "bill");
    else if (def.includedTrade !== "all" && r.chosenTrade.includes(tool.id)) add(tool.id, "included");
  }
  return { size: def.name, tools: out };
}

/**
 * A new-plan shop's lines at the prices in force, for the platform's own record when Stripe isn't read (dev, or Stripe
 * unreachable — lib/subscribersRead fromRecord, where a Classic row is priced from the catalog the same way): the
 * plan, the main tool and the tools on its bill that the size doesn't include, and the extra people. Their sum is the
 * Subscription page's "the month's bill" (shared monthlyCents) — a list price, monthly, never Stripe's word.
 */
export function catalogToolsLines(record: ToolsRecord | null, planSlug: string, cat: Catalog = DEFAULT_CATALOG): ToolsLine[] {
  const def = toolPlanBySlug(planSlug);
  if (!def) return [];
  const plan = cat.plans.find((p) => p.id === def.id) ?? def;
  const r = record ?? emptyToolsRecord(def.id);
  const lineIds = TOOLS.map((t) => t.id).filter((id) => r.lines[id]);
  const picks = typeof plan.includedTrade === "number" && plan.includedTrade > 0;
  const chosen = picks ? (r.chosenTrade.length ? r.chosenTrade : chosenTradeFor(def.id, r.main, lineIds, cat)) : [];
  const included = toolsOpen({ plan: def.id, main: null, kept: [], chosenTrade: chosen });
  const billed = [...new Set<ToolId>([...(r.main ? [r.main] : []), ...lineIds])].filter((id) => !included.has(id));
  const month = (kind: string, unitCents: number, quantity: number): ToolsLine => ({ kind, unitCents, quantity, interval: "month", intervalCount: 1 });
  const extra = plan.seatCents === null ? 0 : Math.max(0, r.seat?.quantity ?? 0);
  return [
    month(plan.slug, plan.cents, 1),
    ...billed.map((id) => month(toolKind(id), (cat.tools.find((t) => t.id === id) ?? toolById(id)).cents, 1)),
    ...(extra && plan.seatCents ? [month(SEAT_KIND, plan.seatCents, extra)] : []),
  ];
}

/** A line's name in words: "Professional", "Deck Studio", "2 more people". */
function lineWords(line: ToolsLine, cat: Catalog): string {
  const plan = planIdOfKind(line.kind);
  if (plan) return (cat.plans.find((p) => p.id === plan) ?? TOOL_PLANS.find((p) => p.id === plan)!).name;
  const tool = toolIdOfKind(line.kind);
  if (tool) return (cat.tools.find((t) => t.id === tool) ?? toolById(tool)).label;
  return `${line.quantity} more ${line.quantity === 1 ? "person" : "people"}`;
}

export interface ToolsFirstBill {
  /** "Professional + Deck Studio" — the Subscription page's name for the plan (the size alone when it includes the
   *  main tool). */
  name: string;
  /** The whole first bill, in cents: the size, the main tool, the tools on the bill, the extra people. */
  cents: number;
  /** "$154/month" · "$1,540/year". */
  price: string;
  /** What it is made of: "Professional $75", "Deck Studio $79", "2 more people $19.98". */
  parts: string[];
  /** Every tool the shop has when the free days end, in the catalog's order (its size's included tools too). */
  tools: string[];
}

/**
 * A NEW-PLAN SHOP'S FIRST BILL, in words (Base + Tools, part 5 — the "two days left" letter, lib/trialEndingMail): the
 * Subscription page's month at the prices in force (catalogToolsLines — the tries that rode the trial are lines on
 * the bill by then, a removed one isn't), a yearly term ten months for twelve. Null for a Classic slug.
 */
export function toolsFirstBill(record: ToolsRecord | null, planSlug: string, cat: Catalog = DEFAULT_CATALOG, yearly = false): ToolsFirstBill | null {
  const def = toolPlanBySlug(planSlug);
  if (!def || !isToolsSlug(planSlug)) return null;
  const size = cat.plans.find((p) => p.id === def.id) ?? def;
  const r = record ?? emptyToolsRecord(def.id);
  const lines = catalogToolsLines(r, planSlug, cat);
  const mult = yearly ? YEAR_MONTHS : 1;
  const priced = lines.map((l) => ({ words: lineWords(l, cat), cents: lineMonthlyCents(l) * mult }));
  const cents = priced.reduce((n, p) => n + p.cents, 0);
  const main = r.main ? (cat.tools.find((t) => t.id === r.main) ?? toolById(r.main)) : null;
  const mainBilled = !!main && lines.some((l) => toolIdOfKind(l.kind) === main.id);
  const lineIds = TOOLS.map((t) => t.id).filter((id) => r.lines[id]);
  const picks = typeof size.includedTrade === "number" && size.includedTrade > 0;
  const chosen = picks ? (r.chosenTrade.length ? r.chosenTrade : chosenTradeFor(def.id, r.main, lineIds, cat)) : [];
  const has = toolsOpen({ plan: def.id, main: r.main, kept: lineIds, chosenTrade: chosen });
  return {
    name: main && mainBilled ? `${size.name} + ${main.label}` : size.name,
    cents,
    price: `${money(cents)}/${yearly ? "year" : "month"}`,
    parts: priced.map((p) => `${p.words} ${money(p.cents)}`),
    tools: TOOLS.filter((t) => has.has(t.id)).map((t) => (cat.tools.find((x) => x.id === t.id) ?? t).label),
  };
}
