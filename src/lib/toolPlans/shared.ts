// BASE + TOOLS — THE NEW PLANS (owner, 2026-11-10; the plan "JobFlex Base + Tools",
// https://claude.ai/artifact/YWxFUapYJR1p5etHbWcbun). Pure and client-safe: no database, no server imports.
//
// WHO GETS IT. Everyone with a subscription on switch day keeps exactly what they have ("Classic": Starter,
// Professional, Advanced, Custom, the $79 Deck Studio line). New sign-ups after the owner turns the switch on
// (Admin → Trial watch → "Plans", lib/toolPlans/server) get these plans. The two never mix: a new plan's slug starts
// with "tools-", so a stored Subscription.plan says by itself which rules it lives by (isToolsSlug) — no stamp, no
// migration, nothing changes for a Classic shop.
//
// THE SHAPE. Three sizes and a top bundle, and twelve tools sold one by one on top of any size:
//   Basic         $39.99  the owner alone — no workers, no managers; leads by hand, pasted text or a CSV file
//   Professional  $75     up to 5 people, workers included, then $9.99 each; automatic Meta leads; the team pages
//   Advanced      $249    up to 10 people, then $7.99 each; the four office tools and any 2 trade tools included
//   Complete      $449    Advanced and every tool
// Each tool is a line on the shop's one subscription (the way Deck Studio's line already works). The ad a shop came
// from picks its MAIN tool; the card page prices the size with that tool ("Professional + Deck Studio · $154").
//
// THE RULE THE PRICES KEEP (owner, 2026-11-10): a bundle always costs less than its parts — Professional less than
// Basic plus 4 people, Advanced less than the same on Professional, Complete less than Advanced plus the rest.
// ladderChecks() proves it for whatever prices are set; qa/tests/logic/tool-plans.check.ts runs it.
//
// NO LOCKS (owner, 2026-11-10): the menu shows only what the shop has. Everything else lives on the Subscription
// page, reached from an "Upgrade your plan" button at the bottom of the menu, where one click starts a 3-day try or
// adds the tool — and it appears in the menu right away.

// ── the tools ────────────────────────────────────────────────────────────────

export type ToolId =
  | "roof"
  | "fence"
  | "hvac"
  | "deck"
  | "blueprint"
  | "video"
  | "aidesk"
  | "texting"
  | "smartcrm"
  | "operator"
  | "builder"
  | "remodeler";

/** "trade" tools are the ones an Advanced plan picks two of; "office" tools come with Advanced as a set. */
export type ToolKind = "trade" | "office";

export interface ToolDef {
  id: ToolId;
  label: string;
  /** One line for a card: what it does, in the contractor's words. */
  note: string;
  kind: ToolKind;
  /** The monthly price, in cents (an example until Admin → Plans sets it). */
  cents: number;
  /** The ad link's `?tool=` key (lib/planSpotlight). Null: no ad link yet — part 4 adds it. */
  adKey: string | null;
  /** The gated pages and features this tool opens (lib/customPlan CUSTOM_PAGES / PAID_FEATURES ids, and the new
   *  ids parts 2–3 add: blueprint-estimator, texting, home-builder, remodeler). */
  opens: readonly string[];
  /** "Works well with" — what the welcome page and the Subscription page put first next to this tool. */
  pairs: readonly ToolId[];
}

export const TOOLS: readonly ToolDef[] = [
  { id: "roof", label: "Roof estimator", note: "Measure any roof from the sky and price it with your materials.", kind: "trade", cents: 4900, adKey: "roof", opens: ["roof-estimator"], pairs: ["aidesk", "texting", "smartcrm"] },
  { id: "fence", label: "Fence estimator", note: "Draw the fence on a map, get the bill of materials.", kind: "trade", cents: 4900, adKey: "fence", opens: ["fence-estimator"], pairs: ["texting", "smartcrm", "video"] },
  { id: "hvac", label: "HVAC estimator", note: "Load, unit and price for a replacement, plus HVAC services and memberships.", kind: "trade", cents: 4900, adKey: "hvac", opens: ["hvac-estimator"], pairs: ["aidesk", "texting", "smartcrm"] },
  { id: "deck", label: "Deck Studio", note: "3D deck design, permit set, materials and price.", kind: "trade", cents: 7900, adKey: "deck", opens: ["deck-estimator"], pairs: ["texting", "smartcrm", "operator"] },
  { id: "blueprint", label: "Blueprint estimator", note: "Upload the plans, ask for any job off them, measured and priced.", kind: "trade", cents: 5900, adKey: "blueprint", opens: ["blueprint-estimator"], pairs: ["builder", "remodeler", "smartcrm"] },
  { id: "video", label: "Video estimator", note: "Walk the job on video, get the estimate.", kind: "trade", cents: 3900, adKey: null, opens: ["video-estimator"], pairs: ["smartcrm", "texting", "remodeler"] },
  { id: "aidesk", label: "AI desk", note: "Answers calls, books visits, takes messages.", kind: "office", cents: 9900, adKey: "aidesk", opens: ["phone"], pairs: ["texting", "smartcrm", "operator"] },
  { id: "texting", label: "Text messaging", note: "Texts to clients and leads, 1,000 a month.", kind: "office", cents: 2900, adKey: null, opens: ["texting"], pairs: ["smartcrm", "aidesk", "operator"] },
  { id: "smartcrm", label: "Smart CRM", note: "One Inbox for every conversation; AI reads, drafts replies and follows up.", kind: "office", cents: 3900, adKey: null, opens: ["smart-crm"], pairs: ["texting", "operator", "aidesk"] },
  { id: "operator", label: "AI Operator", note: "Run the business by voice or text: ask, approve, undo.", kind: "office", cents: 4900, adKey: null, opens: ["operator"], pairs: ["smartcrm", "aidesk", "texting"] },
  { id: "builder", label: "Home Builder", note: "New-construction projects: phases, lot, draws, lender's page, subs.", kind: "trade", cents: 9900, adKey: null, opens: ["home-builder", "subcontractors", "project-tools"], pairs: ["blueprint", "remodeler", "smartcrm"] },
  { id: "remodeler", label: "Remodeler", note: "Remodel projects: stages, selections, buying, subs, client page.", kind: "trade", cents: 7900, adKey: null, opens: ["remodeler", "subcontractors", "project-tools"], pairs: ["blueprint", "video", "smartcrm"] },
];

const TOOL_BY_ID = new Map<ToolId, ToolDef>(TOOLS.map((t) => [t.id, t]));

export function isToolId(value: unknown): value is ToolId {
  return typeof value === "string" && TOOL_BY_ID.has(value as ToolId);
}

export function toolById(id: ToolId): ToolDef {
  const t = TOOL_BY_ID.get(id);
  if (!t) throw new Error(`Unknown tool: ${id}`);
  return t;
}

/** The tool an ad's `?tool=` key sells (lib/planSpotlight's keys); null when no tool answers to it. */
export function toolForAdKey(key: string | null | undefined): ToolDef | null {
  if (!key) return null;
  return TOOLS.find((t) => t.adKey === key) ?? null;
}

/** "Works well with" for a main tool, then every other tool — the order the welcome and Subscription pages use. */
export function toolsInOfferOrder(main: ToolId | null, have: readonly ToolId[] = []): ToolDef[] {
  const owned = new Set<ToolId>([...(main ? [main] : []), ...have]);
  const first = main ? toolById(main).pairs.filter((id) => !owned.has(id)).map(toolById) : [];
  const firstIds = new Set(first.map((t) => t.id));
  return [...first, ...TOOLS.filter((t) => !owned.has(t.id) && !firstIds.has(t.id))];
}

// ── the sizes ────────────────────────────────────────────────────────────────

export type ToolPlanId = "basic" | "professional" | "advanced" | "complete";

/** What a size opens beyond Basic's pages, by gated id. */
export type SizeFeature =
  | "meta-leads"
  | "workers"
  | "crew-field"
  | "team-messages"
  | "hire"
  | "roles"
  | "commission"
  | "smartbook"
  | "custom-domain"
  | "multi-org"
  | "priority-support";

export interface ToolPlanDef {
  id: ToolPlanId;
  /** The slug stored on Subscription.plan and used for Stripe prices — "tools-…", never a Classic slug. */
  slug: string;
  name: string;
  /** Monthly price in cents. */
  cents: number;
  /** People included, the owner counted. */
  seats: number;
  /** Each person after `seats`, per month, in cents; null = no more people (Basic: upgrade instead). */
  seatCents: number | null;
  /** Trade tools included by choice (Advanced: 2). "all" = every tool (Complete). */
  includedTrade: number | "all";
  /** The office set (AI desk, Texting, Smart CRM, Operator) included. */
  officeIncluded: boolean;
  features: readonly SizeFeature[];
  /** The card's own lines (the plan cards render them as they render the Classic plans' lines). */
  lines: readonly string[];
}

const TEAM: readonly SizeFeature[] = ["meta-leads", "workers", "crew-field", "team-messages", "hire", "roles", "commission", "smartbook"];
const ADV_ONLY: readonly SizeFeature[] = ["custom-domain", "multi-org", "priority-support"];

export const TOOL_PLANS: readonly ToolPlanDef[] = [
  {
    id: "basic",
    slug: "tools-basic",
    name: "Basic",
    cents: 3999,
    seats: 1,
    seatCents: null,
    includedTrade: 0,
    officeIncluded: false,
    features: [],
    lines: [
      "Just you: 1 user, the owner",
      "Smart Proposal and manual proposals",
      "Basic CRM: fresh leads, follow-up rules",
      "Leads by hand, pasted text or a CSV file",
      "Calendar, jobs and repairs",
      "Payments, invoices and the client's page",
      "Reviews, reports and financials",
    ],
  },
  {
    id: "professional",
    slug: "tools-professional",
    name: "Professional",
    cents: 7500,
    seats: 5,
    seatCents: 999,
    includedTrade: 0,
    officeIncluded: false,
    features: TEAM,
    lines: [
      "Everything in Basic",
      "Up to 5 people, workers included",
      "Automatic Meta leads",
      "Workers, the crew app and field tools",
      "Managers, office and sales roles, commission",
      "Team messages, Hire board, SmartBook",
    ],
  },
  {
    id: "advanced",
    slug: "tools-advanced",
    name: "Advanced",
    cents: 24900,
    seats: 10,
    seatCents: 799,
    includedTrade: 2,
    officeIncluded: true,
    features: [...TEAM, ...ADV_ONLY],
    lines: [
      "Everything in Professional",
      "Up to 10 people",
      "AI desk, Text messaging, Smart CRM and AI Operator included",
      "Any 2 trade tools included",
      "Custom branding and domain, several companies",
      "Priority support and a setup call",
    ],
  },
  {
    id: "complete",
    slug: "tools-complete",
    name: "Complete",
    cents: 44900,
    seats: 10,
    seatCents: 799,
    includedTrade: "all",
    officeIncluded: true,
    features: [...TEAM, ...ADV_ONLY],
    lines: ["Everything in Advanced", "Every tool, all twelve", "Up to 10 people"],
  },
];

const PLAN_BY_ID = new Map<ToolPlanId, ToolPlanDef>(TOOL_PLANS.map((p) => [p.id, p]));
const PLAN_BY_SLUG = new Map<string, ToolPlanDef>(TOOL_PLANS.map((p) => [p.slug, p]));

export const TOOLS_SLUG_PREFIX = "tools-";

/** A stored plan slug (any case) that belongs to the new plans. Everything else is Classic. */
export function isToolsSlug(slug: string | null | undefined): boolean {
  return !!slug && slug.trim().toLowerCase().startsWith(TOOLS_SLUG_PREFIX);
}

export function toolPlanById(id: ToolPlanId): ToolPlanDef {
  const p = PLAN_BY_ID.get(id);
  if (!p) throw new Error(`Unknown plan: ${id}`);
  return p;
}

export function toolPlanBySlug(slug: string | null | undefined): ToolPlanDef | null {
  return slug ? PLAN_BY_SLUG.get(slug.trim().toLowerCase()) ?? null : null;
}

/** Yearly = ten months for twelve, the add-on lines' rule (lib/customPlan CUSTOM_YEAR_MULTIPLIER). */
export const YEAR_MONTHS = 10;
/** The main tool's free trial, and a tool's free try, in days. */
export const PLAN_TRIAL_DAYS = 7;
export const TOOL_TRY_DAYS = 3;

const DAY_MS = 86_400_000;

/**
 * When a free try ends (owner, 2026-11-10). Inside the sign-up's 7 free days it ends WITH them, so everything picked
 * on the welcome page is billed on the same day as the plan: a try started on day 3 runs 4 days. After the free days
 * (and for a Classic shop) it runs 3 days. Either way, at the end it goes on the bill AUTOMATICALLY unless the shop
 * removed it — the owner's rule: "if they didn't cancel any add-ons, it should charge". The price and the date are on
 * the button, a reminder goes a day before, and Remove is one click.
 */
export function tryEndsAt(now: Date, planTrialEndsAt: Date | null): Date {
  if (planTrialEndsAt && planTrialEndsAt.getTime() > now.getTime()) return new Date(planTrialEndsAt.getTime());
  return new Date(now.getTime() + TOOL_TRY_DAYS * DAY_MS);
}

/** When the "free until tomorrow" reminder goes: a day before the end, or at once when less than a day is left. */
export function tryReminderAt(now: Date, endsAt: Date): Date {
  const dayBefore = endsAt.getTime() - DAY_MS;
  return new Date(Math.max(now.getTime(), dayBefore));
}

/** The words on the try button and in the reminder: "Free until Nov 17, then $49/mo on your bill." */
export function tryWords(tool: ToolId, endsAt: Date, timeZone?: string, cat: Catalog = DEFAULT_CATALOG): string {
  const day = endsAt.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(timeZone ? { timeZone } : {}) });
  return `Free until ${day}, then ${money(catTool(cat, tool).cents)}/mo on your bill. Remove it any time before.`;
}

// ── what a shop has ──────────────────────────────────────────────────────────

export interface ShopTools {
  plan: ToolPlanId;
  /** The tool the shop signed up for (the ad's), or picked on the card page / switched to in the free days. */
  main: ToolId | null;
  /** Tools on the bill, beyond what the size includes. */
  kept: readonly ToolId[];
  /** Advanced's two chosen trade tools. */
  chosenTrade?: readonly ToolId[];
  /** Free tries running now. */
  trying?: readonly ToolId[];
}

/** Every tool a shop can open: the main tool, what its size includes, what it keeps, what it is trying. */
export function toolsOpen(shop: ShopTools): Set<ToolId> {
  const plan = toolPlanById(shop.plan);
  const open = new Set<ToolId>();
  if (plan.includedTrade === "all") TOOLS.forEach((t) => open.add(t.id));
  if (plan.officeIncluded) TOOLS.filter((t) => t.kind === "office").forEach((t) => open.add(t.id));
  if (typeof plan.includedTrade === "number" && plan.includedTrade > 0) {
    (shop.chosenTrade ?? []).filter((id) => toolById(id).kind === "trade").slice(0, plan.includedTrade).forEach((id) => open.add(id));
  }
  if (shop.main) open.add(shop.main);
  shop.kept.forEach((id) => open.add(id));
  (shop.trying ?? []).forEach((id) => open.add(id));
  return open;
}

/** The gated page / feature ids a shop can open (the menu shows these; the server refuses the rest). */
export function pagesOpen(shop: ShopTools): Set<string> {
  const ids = new Set<string>(toolPlanById(shop.plan).features);
  toolsOpen(shop).forEach((t) => toolById(t).opens.forEach((p) => ids.add(p)));
  return ids;
}

// ── prices ───────────────────────────────────────────────────────────────────

/** The monthly bill, in cents: the size, extra people, and the tools on the bill that the size doesn't include. */
export function monthlyCents(shop: ShopTools, people: number, cat: Catalog = DEFAULT_CATALOG): number {
  const plan = catPlan(cat, shop.plan);
  const extra = plan.seatCents === null ? 0 : Math.max(0, people - plan.seats) * plan.seatCents;
  const included = toolsOpen({ ...shop, main: null, kept: [], trying: [] });
  const billed = new Set<ToolId>([...(shop.main ? [shop.main] : []), ...shop.kept].filter((id) => !included.has(id)));
  return plan.cents + extra + [...billed].reduce((n, id) => n + catTool(cat, id).cents, 0);
}

/** "$39.99" · "$75" · "$1,234.50". */
export function money(cents: number): string {
  const d = cents / 100;
  return `$${d.toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

/** A plan card's price with the ad's tool: the size plus the tool, unless the size already includes it. */
export function cardCents(planId: ToolPlanId, tool: ToolId | null, cat: Catalog = DEFAULT_CATALOG): number {
  return monthlyCents({ plan: planId, main: tool, kept: [], chosenTrade: tool ? [tool] : [] }, 1, cat);
}

/** A plan card's lines with the ad's tool first. */
export function cardLines(planId: ToolPlanId, tool: ToolId | null, cat: Catalog = DEFAULT_CATALOG): string[] {
  const plan = catPlan(cat, planId);
  // The extra-person price is said from the price in force, never typed into a line (Admin → Plans can change it).
  const seats = plan.seatCents ? [`${money(plan.seatCents)} for each person after ${plan.seats}`] : [];
  if (!tool) return [...plan.lines, ...seats];
  const t = catTool(cat, tool);
  const included = plan.includedTrade === "all" || (plan.officeIncluded && t.kind === "office") || (typeof plan.includedTrade === "number" && plan.includedTrade > 0 && t.kind === "trade");
  return [included ? `${t.label} included` : `+ ${t.label} (${money(t.cents)}/mo)`, ...plan.lines, ...seats];
}

// ── the rule the prices keep ─────────────────────────────────────────────────

export interface LadderCheck {
  label: string;
  /** What the same costs bought in parts (the cheapest way), in cents. */
  parts: number;
  /** The bundle's price, in cents. */
  bundle: number;
  ok: boolean;
}

/** A bundle always costs less than its parts. Each check compares the bundle with the CHEAPEST way to buy the same. */
export function ladderChecks(plans: readonly ToolPlanDef[] = TOOL_PLANS, tools: readonly ToolDef[] = TOOLS): LadderCheck[] {
  const by = (id: ToolPlanId) => plans.find((p) => p.id === id)!;
  const basic = by("basic");
  const pro = by("professional");
  const adv = by("advanced");
  const complete = by("complete");
  const sum = (list: readonly ToolDef[]) => list.reduce((n, t) => n + t.cents, 0);
  const office = sum(tools.filter((t) => t.kind === "office"));
  const trade = tools.filter((t) => t.kind === "trade").map((t) => t.cents).sort((a, b) => a - b);
  const twoCheapest = (trade[0] ?? 0) + (trade[1] ?? 0);
  const twoDearest = (trade[trade.length - 1] ?? 0) + (trade[trade.length - 2] ?? 0);
  const proSeat = pro.seatCents ?? 0;
  const proTo = (people: number) => pro.cents + Math.max(0, people - pro.seats) * proSeat;
  const checks: LadderCheck[] = [
    // Basic can't add people, so "Basic + 4 people" prices them at Professional's extra-person rate.
    { label: "Professional vs Basic + 4 more people", parts: basic.cents + (pro.seats - basic.seats) * proSeat, bundle: pro.cents, ok: false },
    { label: "A person inside Professional vs an extra one", parts: proSeat * (pro.seats - basic.seats), bundle: pro.cents - basic.cents, ok: false },
    { label: "Advanced vs the same on Professional", parts: proTo(adv.seats) + office + twoCheapest, bundle: adv.cents, ok: false },
    { label: "Complete vs Advanced + the other trade tools", parts: adv.cents + sum(tools.filter((t) => t.kind === "trade")) - twoDearest, bundle: complete.cents, ok: false },
    { label: "Complete vs everything on Professional", parts: proTo(complete.seats) + sum(tools), bundle: complete.cents, ok: false },
  ];
  return checks.map((c) => ({ ...c, ok: c.bundle < c.parts }));
}

// ── prices set in Admin → Plans ──────────────────────────────────────────────

/** The plans and tools with the prices in force. The code's prices are the defaults; Admin → Plans can change them
 *  (lib/toolPlans/prices, SyncState `toolPrices`). A shop keeps the price its Stripe line was bought at. */
export interface Catalog {
  plans: readonly ToolPlanDef[];
  tools: readonly ToolDef[];
}

export const DEFAULT_CATALOG: Catalog = { plans: TOOL_PLANS, tools: TOOLS };

function catTool(cat: Catalog, id: ToolId): ToolDef {
  const t = cat.tools.find((x) => x.id === id);
  if (!t) throw new Error(`Unknown tool: ${id}`);
  return t;
}

function catPlan(cat: Catalog, id: ToolPlanId): ToolPlanDef {
  const p = cat.plans.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown plan: ${id}`);
  return p;
}

/** The sizes that sell extra people. */
export type SeatPlanId = "professional" | "advanced" | "complete";

/** What Admin → Plans stores: only the prices it changed, in cents. */
export interface PriceSet {
  plans?: Partial<Record<ToolPlanId, number>>;
  seats?: Partial<Record<SeatPlanId, number>>;
  tools?: Partial<Record<ToolId, number>>;
}

/** A sane monthly price in cents: $1 to $10,000, whole cents. */
export function isPriceCents(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 1_000_000;
}

/** The catalog with a price set applied (anything missing or not a sane price keeps the default). */
export function withPrices(prices: PriceSet | null | undefined, base: Catalog = DEFAULT_CATALOG): Catalog {
  if (!prices) return base;
  return {
    plans: base.plans.map((p) => {
      const cents = prices.plans?.[p.id];
      const seat = p.seatCents === null ? undefined : prices.seats?.[p.id as SeatPlanId];
      return { ...p, cents: isPriceCents(cents) ? cents : p.cents, seatCents: p.seatCents === null ? null : isPriceCents(seat) ? seat : p.seatCents };
    }),
    tools: base.tools.map((t) => {
      const cents = prices.tools?.[t.id];
      return { ...t, cents: isPriceCents(cents) ? cents : t.cents };
    }),
  };
}

/** Why a price set can't be saved: a price out of range, or a bundle that would cost more than its parts. Empty = OK. */
export function priceProblems(prices: PriceSet): string[] {
  const out: string[] = [];
  const all: Array<[string, unknown]> = [
    ...Object.entries(prices.plans ?? {}).map(([k, v]) => [`the ${k} plan`, v] as [string, unknown]),
    ...Object.entries(prices.seats ?? {}).map(([k, v]) => [`an extra person on ${k}`, v] as [string, unknown]),
    ...Object.entries(prices.tools ?? {}).map(([k, v]) => [`the ${k} tool`, v] as [string, unknown]),
  ];
  for (const [what, v] of all) if (!isPriceCents(v)) out.push(`The price for ${what} must be between $1 and $10,000.`);
  if (out.length) return out;
  const cat = withPrices(prices);
  for (const c of ladderChecks(cat.plans, cat.tools)) {
    if (!c.ok) out.push(`${c.label}: the bundle (${money(c.bundle)}) must cost less than its parts (${money(c.parts)}).`);
  }
  return out;
}

// ── the lines on the Stripe subscription ─────────────────────────────────────
// One subscription per shop, as Deck Studio's line already works: the plan's line ("tools-professional"), one line
// per tool on the bill ("tool-roof"), and one line for the extra people ("seat", quantity = people past the plan's).
// Each price names its kind in metadata.jfKind (lib/stripePriceCache), so a line is always told by its kind, never by
// its amount, and keeps the price it was bought at.

export const SEAT_KIND = "seat";
export const TOOL_KIND_PREFIX = "tool-";

export function toolKind(id: ToolId): string {
  return `${TOOL_KIND_PREFIX}${id}`;
}

/** The tool a line's kind names, or null. */
export function toolIdOfKind(kind: string | null | undefined): ToolId | null {
  if (!kind || !kind.startsWith(TOOL_KIND_PREFIX)) return null;
  const id = kind.slice(TOOL_KIND_PREFIX.length);
  return isToolId(id) ? id : null;
}

/** The plan a line's kind names ("tools-professional" → professional), or null. */
export function planIdOfKind(kind: string | null | undefined): ToolPlanId | null {
  return toolPlanBySlug(kind)?.id ?? null;
}

/** A tool's line or the extra-people line — an add-on line, never the plan's own (lib/deckAddon isAddonLine). */
export function isToolsExtraKind(kind: string | null | undefined): boolean {
  return kind === SEAT_KIND || toolIdOfKind(kind) !== null;
}

/** The product name a kind's Stripe price is minted under. */
export function kindName(kind: string): string {
  const plan = toolPlanBySlug(kind);
  if (plan) return `JobFlex ${plan.name}`;
  if (kind === SEAT_KIND) return "JobFlex extra person";
  const tool = toolIdOfKind(kind);
  return tool ? `JobFlex ${toolById(tool).label}` : `JobFlex ${kind}`;
}

// ── what we keep per shop (SyncState `orgTools:<orgId>`, lib/toolPlans/billing) ──────────────────────────────

export interface ToolTry {
  startedAt: string;
  endsAt: string;
  /** Put on the subscription at once (inside the sign-up's free days: it rides the trial and is billed with it). */
  onLine: boolean;
  removedAt?: string;
  billedAt?: string;
  /** The card was declined when the try ended: nothing was added, the tool closed. */
  failedAt?: string;
}

export interface ToolsRecord {
  /** The Stripe subscription the lines live on; null before there is one (a card-less trial). */
  subId: string | null;
  plan: ToolPlanId;
  main: ToolId | null;
  chosenTrade: ToolId[];
  /** Tools on the bill: their line, the price it bills, since when. */
  lines: Partial<Record<ToolId, { itemId: string; cents: number; since: string }>>;
  /** The extra-people line: its quantity is the people past the plan's. */
  seat: { itemId: string; quantity: number; cents: number } | null;
  tries: Partial<Record<ToolId, ToolTry>>;
  /** Removed from the bill: open until the paid month ends (no refund — the owner's rule). */
  closing: Partial<Record<ToolId, string>>;
}

export function emptyToolsRecord(plan: ToolPlanId, main: ToolId | null = null): ToolsRecord {
  return { subId: null, plan, main, chosenTrade: [], lines: {}, seat: null, tries: {}, closing: {} };
}

/** A stored record, or null when it isn't one (a row edited by hand never opens a tool it doesn't name properly). */
export function parseToolsRecord(raw: string | null | undefined): ToolsRecord | null {
  if (!raw) return null;
  try {
    const r = JSON.parse(raw) as Partial<ToolsRecord>;
    if (!r || !r.plan || !TOOL_PLANS.some((p) => p.id === r.plan)) return null;
    const toolKeys = <T>(o: unknown): Partial<Record<ToolId, T>> => {
      const out: Partial<Record<ToolId, T>> = {};
      for (const [k, v] of Object.entries((o && typeof o === "object" ? o : {}) as Record<string, T>)) if (isToolId(k)) out[k] = v;
      return out;
    };
    return {
      subId: typeof r.subId === "string" ? r.subId : null,
      plan: r.plan,
      main: isToolId(r.main) ? r.main : null,
      chosenTrade: Array.isArray(r.chosenTrade) ? r.chosenTrade.filter(isToolId) : [],
      lines: toolKeys(r.lines),
      seat: r.seat && typeof r.seat.itemId === "string" && Number.isInteger(r.seat.quantity) ? r.seat : null,
      tries: toolKeys(r.tries),
      closing: toolKeys(r.closing),
    };
  } catch {
    return null;
  }
}

/** What the shop can open right now: its plan, main tool, the tools on its bill, the ones closing at the month's end,
 *  and the tries still running (a removed try stays open until its end: "remove it any time before"). */
export function shopFromRecord(record: ToolsRecord, now: Date): ShopTools {
  const t = now.getTime();
  const kept = [
    ...(Object.keys(record.lines) as ToolId[]),
    ...(Object.entries(record.closing) as Array<[ToolId, string]>).filter(([, until]) => Date.parse(until) > t).map(([id]) => id),
  ];
  const trying = (Object.entries(record.tries) as Array<[ToolId, ToolTry]>)
    .filter(([, x]) => !x.billedAt && !x.failedAt && Date.parse(x.endsAt) > t)
    .map(([id]) => id);
  return { plan: record.plan, main: record.main, kept, chosenTrade: record.chosenTrade, trying };
}

// ── the gate (part 3a) ───────────────────────────────────────────────────────
// What a new-plan shop may open, in the page gate's ids (lib/customPlan, lib/customPageAccess). Every new plan
// opens the base pages; the size, the main tool, the tools on the bill and the tries open the rest. Everything
// else is left out of the menu and refused on the server (owner, 2026-11-10: no locks, no grey rows).

/** The gated ids every new plan opens: the office a contractor can't work without. */
export const TOOLS_BASE_PAGES = ["smart-proposal", "calendar", "leads", "company"] as const;

/** The ids the gate answers only on the new plans (lib/customPlan TOOLS_PAGES): a Classic shop answers them through
 *  classicEquivalent, so nothing changes for it. TOOLS[].opens and SizeFeature use the same ids. */
export const TOOLS_ONLY_PAGE_IDS = [
  "deck-estimator",
  "blueprint-estimator",
  "texting",
  "team-messages",
  "hire",
  "home-builder",
  "remodeler",
  "meta-leads",
  "roles",
  "commission",
  "custom-domain",
  "multi-org",
  "priority-support",
] as const;
export type ToolsOnlyPageId = (typeof TOOLS_ONLY_PAGE_IDS)[number];

const TOOLS_ONLY = new Set<string>(TOOLS_ONLY_PAGE_IDS);
export function isToolsOnlyPageId(id: unknown): id is ToolsOnlyPageId {
  return typeof id === "string" && TOOLS_ONLY.has(id);
}

/**
 * How a CLASSIC shop answers one of the new ids — so a gate added for the new plans changes nothing for it:
 *   "blueprint-estimator" → "smart-proposal" (it was Smart Proposal's page, and a Custom plan sells it as that);
 *   "meta-leads"          → "leads" (the Meta import files into Leads, which a Custom plan sells);
 *   everything else       → null: not decided by the page gate for a Classic shop — open, as it is today (Deck
 *                           Studio stays with lib/editions; texting, team messages, Hire, commission, the project
 *                           workspaces and the rest were never gated by a Classic plan, the Free plan included).
 */
export function classicEquivalent(id: ToolsOnlyPageId): "smart-proposal" | "leads" | null {
  if (id === "blueprint-estimator") return "smart-proposal";
  if (id === "meta-leads") return "leads";
  return null;
}

/**
 * The gated ids a new-plan shop can open now: the base pages, what its size opens, and what its tools open — the
 * main tool, the tools on the bill, the ones closing at the month's end and the tries still running. The slug's size
 * wins over the record's (Subscription.plan is what Stripe bills); with no record, the size alone.
 */
export function toolsPagesOpen(record: ToolsRecord | null, planSlug: string | null | undefined, now: Date): Set<string> {
  const ids = new Set<string>(TOOLS_BASE_PAGES);
  const size = toolPlanBySlug(planSlug);
  const base = record ? (size && record.plan !== size.id ? { ...record, plan: size.id } : record) : size ? emptyToolsRecord(size.id) : null;
  if (!base) return ids;
  const shop = shopFromRecord(base, now);
  pagesOpen(shop).forEach((id) => ids.add(id));
  if (shop.main) toolById(shop.main).opens.forEach((id) => ids.add(id));
  return ids;
}

/** What sells a gated id: the tools that open it (the first is the one to offer), else the first size that does. */
export type ToolOffering = { kind: "tool"; tool: ToolDef; also: ToolDef[] } | { kind: "size"; plan: ToolPlanDef } | null;

export function toolOffering(id: string, cat: Catalog = DEFAULT_CATALOG): ToolOffering {
  const tools = cat.tools.filter((t) => t.opens.includes(id));
  if (tools.length) return { kind: "tool", tool: tools[0], also: tools.slice(1) };
  const plan = cat.plans.find((p) => (p.features as readonly string[]).includes(id));
  return plan ? { kind: "size", plan } : null;
}

/** The workspace tool a project kind needs on a new plan (lib/projectKind): a remodel Remodeler, a new build Home
 *  Builder; a job project (and any other kind) is the base workspace's. */
export function projectKindPage(kind: string | null | undefined): "remodeler" | "home-builder" | null {
  if (kind === "REMODEL") return "remodeler";
  if (kind === "NEW_BUILD") return "home-builder";
  return null;
}

/** Texts a month with Text messaging on a new plan; without it the shop texts only its own team (lib/sms/send). */
export const TOOLS_TEXT_ALLOWANCE = 1000;
/** AI desk minutes a month on a new plan: Advanced and Complete include the desk; a size that adds it gets fewer. */
export const TOOLS_DESK_MINUTES_INCLUDED = 500;
export const TOOLS_DESK_MINUTES_ADDED = 150;

/** Tries whose time is up and that nobody removed: the sweep puts them on the bill (lib/toolPlans/billing). */
export function triesToBill(record: ToolsRecord, now: Date): ToolId[] {
  return (Object.entries(record.tries) as Array<[ToolId, ToolTry]>)
    .filter(([id, x]) => !x.removedAt && !x.billedAt && !x.failedAt && Date.parse(x.endsAt) <= now.getTime() && !record.lines[id])
    .map(([id]) => id);
}
