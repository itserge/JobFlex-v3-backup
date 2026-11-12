// THE NEW PLANS' CARDS, THE PLAN BUILDER AND THE SIGN-UP'S PICK (Base + Tools — owner, 2026-11-10; the builder
// 2026-11-12). Pure, client-safe.
//
// BUILD YOUR PLAN (owner, 2026-11-12: "the user will come and see the basic cost, professional, and then they can add
// what they want to test … they can choose it from the landing page how they build it, and during the trial they can
// remove and leave what they needed"). The landing's pricing section, /pricing and the sign-up's plan step are one
// builder: a size (Basic, Professional, Advanced, Complete — each at its own price, with its own lines) and the tools
// ticked on top. The ad's tool comes ticked (a Deck Studio ad: Professional + Deck Studio); everything else is the
// visitor's. toolsBuild prices a pick — the size, each ticked tool unless the size includes it (Advanced's office set
// and two trade tools, the dearest ticked; Complete everything) — and says when a bigger size costs less for it.
//
// THE PICK ON THE WIRE. A pick travels as the tools' ids, comma-separated, in the order ticked ("deck,fence"): the
// register link's `?tools=`, the sign-up's `tool` on its way to the checkout, the pending card-less trial and the
// Stripe metadata (`mainTool` the first, `extraTools` the rest). The first is the shop's main tool; the others ride
// the 7 free days as free tries (lib/toolPlans/billing) — each on the bill when the trial ends unless removed before.
// The server prices a pick again from the plan and the ids alone (toolsSignupPick), never from a number the browser
// sent. The switch off: nothing here is read; the surfaces show the Classic catalog exactly as before.

import type { PlanDTO } from "@/lib/planCatalog";
import { adToolFor, parseAdTool } from "@/lib/planSpotlight";
import {
  cardLines,
  chosenTradeFor,
  DEFAULT_CATALOG,
  emptyToolsRecord,
  isToolId,
  isToolsSlug,
  money,
  monthlyCents,
  PLAN_TRIAL_DAYS,
  sizeRank,
  toolForAdKey,
  toolPlanBySlug,
  toolsOpen,
  YEAR_MONTHS,
  type Catalog,
  type ToolId,
  type ToolKind,
  type ToolPlanId,
  type ToolsRecord,
} from "./shared";

/** The size the builder and the sign-up open on, and the one the cards mark "Most picked". */
export const TOOLS_DEFAULT_PLAN: ToolPlanId = "professional";

/** The four sizes as PlanDTOs, each at its own price with its own lines — never priced with a tool (owner,
 *  2026-11-12: "basic should show what's in the basic"). What the plan step's and the auto plan's readers get. */
export function toolsPlanDTOs(cat: Catalog = DEFAULT_CATALOG, trialDays: number = PLAN_TRIAL_DAYS): PlanDTO[] {
  return cat.plans.map((p, i) => ({
    id: p.slug,
    slug: p.slug,
    name: p.name,
    description: null,
    priceCents: p.cents,
    yearlyPriceCents: p.cents * YEAR_MONTHS,
    trialDays,
    order: i,
    features: cardLines(p.id, null, cat),
    limits: {},
    active: true,
    highlight: p.id === TOOLS_DEFAULT_PLAN,
    isFree: false,
  }));
}

/** True when a card list is the new plans' (every slug "tools-…"): the surfaces draw the builder then. */
export function isToolsCatalog(plans: ReadonlyArray<{ slug: string }>): boolean {
  return plans.length > 0 && plans.every((p) => isToolsSlug(p.slug));
}

/** The main tool a visit carries, for the new plans: the link's `?tool=` (any ad key), else the landing trade's tool,
 *  else the 30-day cookie (lib/planSpotlight SPOTLIGHT_COOKIE). Null: no tool. */
export function mainToolFor(input: { tool?: string | string[] | null; industry?: string | null; cookie?: string | null }): ToolId | null {
  const key = adToolFor({ tool: input.tool, industry: input.industry }) ?? parseAdTool(input.cookie) ?? null;
  return toolForAdKey(key)?.id ?? null;
}

/** The ad key a main tool's links carry (`?tool=`): the tool's own key. */
export function adKeyOf(tool: ToolId | null | undefined, cat: Catalog = DEFAULT_CATALOG): string | null {
  return tool ? (cat.tools.find((t) => t.id === tool)?.adKey ?? null) : null;
}

// ── a pick ───────────────────────────────────────────────────────────────────

/** A pick as the pages read it from a link: tool ids or ad keys ("deck", "crm", "home-builder"), one or several,
 *  comma-separated or repeated. Lenient — an unknown word is dropped, never guessed into a tool; each tool once, in
 *  the order given. The server's read is toolsSignupPick (strict). */
export function parseToolPicks(raw: string | readonly string[] | null | undefined): ToolId[] {
  const words = (Array.isArray(raw) ? raw : [raw]).flatMap((r) => (typeof r === "string" ? r.split(",") : []));
  const out: ToolId[] = [];
  for (const w of words) {
    const v = w.trim().toLowerCase();
    if (!v) continue;
    const id = isToolId(v) ? v : (toolForAdKey(parseAdTool(v))?.id ?? null);
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/** A pick on the wire: "deck,fence" ("" for none). */
export function pickWire(picks: readonly ToolId[]): string {
  return picks.join(",");
}

export interface ToolsBuildTool {
  id: ToolId;
  label: string;
  note: string;
  kind: ToolKind;
  /** The price in force, a month. */
  cents: number;
  /** Ticked by the visitor. */
  picked: boolean;
  /** The size holds it — its office set, one of its chosen trade tools, or everything (Complete). */
  included: boolean;
}

export interface ToolsBuild {
  plan: ToolPlanId;
  slug: string;
  name: string;
  /** The size alone, a month. */
  sizeCents: number;
  /** The ticked tools, each once, in the order ticked. */
  picks: ToolId[];
  /** The first ticked: the shop's main tool. */
  main: ToolId | null;
  /** The rest: free tries in the trial, on the bill after it unless removed. */
  extras: ToolId[];
  /** Advanced's two included trade tools: the dearest ticked (the most the size can save). */
  chosenTrade: ToolId[];
  /** The ticked tools with a line of their own (the size doesn't include them). */
  billed: Array<{ id: ToolId; label: string; cents: number }>;
  /** Every tool, in the catalog's order, with its state on this size. */
  tools: ToolsBuildTool[];
  /** A month: the size and the billed tools (one person — the sign-up is the owner alone). */
  cents: number;
  /** A year: ten months. */
  yearlyCents: number;
  /** "Professional + Deck Studio + Fence estimator" · "Advanced" (everything ticked included) · "Basic". */
  label: string;
  /** The size's own lines, the extra-person price last. */
  lines: string[];
  /** A bigger size that costs less for the same tools, or very little more — null when none does. */
  better: { plan: ToolPlanId; name: string; cents: number; less: boolean; adds: string[]; /** The hint, in words. */ words: { lead: string; rest: string } } | null;
}

/** "a, b and c". */
function and(items: readonly string[]): string {
  return items.length < 2 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** "Advanced costs less for these tools: $249/mo, and it adds AI desk, Smart CRM and up to 10 people." — or, when it
 *  is a little dearer, "For $17 more a month, Advanced: $249/mo, …". */
function betterWords(name: string, cents: number, now: number, adds: readonly string[]): { lead: string; rest: string } {
  const lead = cents < now ? `${name} costs less for these tools:` : cents === now ? `${name} costs the same for these tools:` : `For ${money(cents - now)} more a month, ${name}:`;
  return { lead, rest: `${money(cents)}/mo${adds.length ? `, and it adds ${and(adds)}` : ""}.` };
}

/** How much more a bigger size may cost and still be pointed at: $30 a month. */
export const BETTER_SIZE_MARGIN_CENTS = 3000;

function buildOne(planId: ToolPlanId, picks: readonly ToolId[], cat: Catalog): Omit<ToolsBuild, "better"> {
  const plan = cat.plans.find((p) => p.id === planId)!;
  const valid = picks.filter((id, i) => isToolId(id) && cat.tools.some((t) => t.id === id) && picks.indexOf(id) === i);
  const main = valid[0] ?? null;
  const extras = valid.slice(1);
  // The dearest ticked trade tools ride free on a size that includes some (Advanced: 2) — not the first ticked.
  const chosenTrade = chosenTradeFor(planId, null, valid, cat);
  const holds = toolsOpen({ plan: planId, main: null, kept: [], chosenTrade });
  const tools: ToolsBuildTool[] = cat.tools.map((t) => ({ id: t.id, label: t.label, note: t.note, kind: t.kind, cents: t.cents, picked: valid.includes(t.id), included: holds.has(t.id) }));
  const billed = valid.filter((id) => !holds.has(id)).map((id) => {
    const t = cat.tools.find((x) => x.id === id)!;
    return { id, label: t.label, cents: t.cents };
  });
  const cents = monthlyCents({ plan: planId, main, kept: extras, chosenTrade }, 1, cat);
  return {
    plan: planId,
    slug: plan.slug,
    name: plan.name,
    sizeCents: plan.cents,
    picks: valid,
    main,
    extras,
    chosenTrade,
    billed,
    tools,
    cents,
    yearlyCents: cents * YEAR_MONTHS,
    label: billed.length ? `${plan.name} + ${billed.map((b) => b.label).join(" + ")}` : plan.name,
    lines: cardLines(planId, null, cat),
  };
}

/** THE BUILDER'S PRICE: a size with the ticked tools — and a bigger size to point at when it costs less for the same
 *  tools, or at most BETTER_SIZE_MARGIN_CENTS more ("Advanced costs less: $249/mo, and adds AI desk, …"). */
export function toolsBuild(planId: ToolPlanId, picks: readonly ToolId[], cat: Catalog = DEFAULT_CATALOG): ToolsBuild {
  const here = buildOne(planId, picks, cat);
  let better: ToolsBuild["better"] = null;
  if (here.picks.length) {
    for (const p of cat.plans) {
      if (sizeRank(p.id) <= sizeRank(planId)) continue;
      const there = buildOne(p.id, here.picks, cat);
      if (there.cents > here.cents + BETTER_SIZE_MARGIN_CENTS) continue;
      const gained = there.tools.filter((t) => t.included && !here.tools.find((h) => h.id === t.id)!.picked && !here.tools.find((h) => h.id === t.id)!.included).map((t) => t.label);
      const adds = [...(gained.length > 4 ? [`${gained.length} more tools`] : gained), ...(p.seats > (cat.plans.find((x) => x.id === planId)?.seats ?? 1) ? [`up to ${p.seats} people`] : [])];
      better = { plan: p.id, name: p.name, cents: there.cents, less: there.cents <= here.cents, adds, words: betterWords(p.name, there.cents, here.cents, adds) };
      break;
    }
  }
  return { ...here, better };
}

/** The size a sign-up opens on: the one asked for (?plan= from the builder), else Professional. */
export function toolsPlanFromAsk(asked: string | null | undefined): ToolPlanId {
  return toolPlanBySlug(asked)?.id ?? TOOLS_DEFAULT_PLAN;
}

/**
 * THE SERVER'S READ OF A SIGN-UP'S PICK — the only way a plan and tools reach the checkout. The plan must be one of
 * the four "tools-…" slugs; the tools tool ids, comma-separated, the first the main tool ("" / "none" / null: no
 * tool). Anything else — a made-up slug, a Classic slug, a word that is no tool of ours — is refused (null), never
 * guessed at. A tool named twice counts once.
 */
export function toolsSignupPick(input: { plan: string | null | undefined; tool: string | null | undefined }): { plan: ToolPlanId; main: ToolId | null; extras: ToolId[] } | null {
  const plan = isToolsSlug(input.plan) ? toolPlanBySlug(input.plan) : null;
  if (!plan) return null;
  const raw = typeof input.tool === "string" ? input.tool.trim().toLowerCase() : input.tool;
  if (raw === null || raw === undefined || raw === "" || raw === "none") return { plan: plan.id, main: null, extras: [] };
  const words = raw.split(",").map((w) => w.trim()).filter(Boolean);
  if (!words.length || words.length > 40 || !words.every(isToolId)) return null;
  const ids = [...new Set(words)] as ToolId[];
  return { plan: plan.id, main: ids[0], extras: ids.slice(1) };
}

/** What a shop on the new plans will pay when its free days end: the size, its main tool and the tools still on the
 *  bill (a removed try has no line) — "Professional + Deck Studio + Fence estimator", a month. */
export function recordBill(record: ToolsRecord, cat: Catalog = DEFAULT_CATALOG): { label: string; cents: number } {
  const kept = (Object.keys(record.lines) as ToolId[]).filter((id) => id !== record.main && isToolId(id));
  const picks = [...(record.main ? [record.main] : []), ...kept];
  const shop = { plan: record.plan, main: record.main, kept, chosenTrade: record.chosenTrade };
  const holds = toolsOpen({ ...shop, main: null, kept: [] });
  const plan = cat.plans.find((p) => p.id === record.plan)!;
  const billed = picks.filter((id) => !holds.has(id)).map((id) => cat.tools.find((t) => t.id === id)?.label ?? id);
  return { label: billed.length ? `${plan.name} + ${billed.join(" + ")}` : plan.name, cents: monthlyCents(shop, 1, cat) };
}

/**
 * THE SHOP'S FIRST RECORD ON THE NEW PLANS (lib/toolPlans/billing): the size, the main tool, Advanced's two included
 * trade tools (the dearest ticked, as the builder priced it — lib/toolPlans/cards toolsBuild) and, for each other tool
 * ticked that has a line of its own, a free try that ends with the trial: removed before then it is never billed;
 * otherwise the trial's end bills it with the plan (owner, 2026-11-12: "during the trial they can remove and leave
 * what they needed"). No trial (a plan bought outright): those tools are simply on the bill. The lines themselves
 * join from Stripe (mirrorToolLines). Written by the sign-up (actions/signupCheckout createAccountFromPending).
 */
export function firstToolsRecord(input: { plan: ToolsRecord["plan"]; main: ToolId | null; extras: readonly ToolId[]; subId: string | null; trialEnd: Date | null; now: Date }): ToolsRecord {
  const picks = [...new Set([...(input.main ? [input.main] : []), ...input.extras])];
  const chosenTrade = chosenTradeFor(input.plan, null, picks);
  const record: ToolsRecord = { ...emptyToolsRecord(input.plan, input.main), subId: input.subId, chosenTrade };
  const build = toolsBuild(input.plan, picks);
  if (input.trialEnd && input.trialEnd.getTime() > input.now.getTime()) {
    for (const b of build.billed) {
      if (b.id === input.main) continue;
      record.tries[b.id] = { startedAt: input.now.toISOString(), endsAt: input.trialEnd.toISOString(), onLine: !!input.subId };
    }
  }
  return record;
}

/** A link with `plan=` set and the pick's `tools=` ("deck,fence"; "none" when nothing is ticked, so the sign-up
 *  doesn't tick the ad's tool again), the rest of its query kept: the builder's start button. No picks given: the
 *  link's own `tools=` is left as it is. */
export function withPlanQuery(href: string, plan: string, picks?: readonly ToolId[] | null): string {
  const hashAt = href.indexOf("#");
  const path = hashAt < 0 ? href : href.slice(0, hashAt);
  const hash = hashAt < 0 ? "" : href.slice(hashAt);
  const [base, query = ""] = path.split("?");
  const q = new URLSearchParams(query);
  q.set("plan", plan);
  if (picks) q.set("tools", picks.length ? pickWire(picks) : "none");
  return `${base}?${q.toString().replace(/%2C/g, ",")}${hash}`;
}
