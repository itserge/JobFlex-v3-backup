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
      "$9.99 for each person after 5",
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
      "$7.99 for each person after 10",
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
    lines: ["Everything in Advanced", "Every tool, all twelve", "Up to 10 people, $7.99 each after"],
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
export function monthlyCents(shop: ShopTools, people: number): number {
  const plan = toolPlanById(shop.plan);
  const extra = plan.seatCents === null ? 0 : Math.max(0, people - plan.seats) * plan.seatCents;
  const included = toolsOpen({ ...shop, main: null, kept: [], trying: [] });
  const billed = new Set<ToolId>([...(shop.main ? [shop.main] : []), ...shop.kept].filter((id) => !included.has(id)));
  return plan.cents + extra + [...billed].reduce((n, id) => n + toolById(id).cents, 0);
}

/** "$39.99" · "$75" · "$1,234.50". */
export function money(cents: number): string {
  const d = cents / 100;
  return `$${d.toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

/** A plan card's price with the ad's tool: the size plus the tool, unless the size already includes it. */
export function cardCents(planId: ToolPlanId, tool: ToolId | null): number {
  return monthlyCents({ plan: planId, main: tool, kept: [], chosenTrade: tool ? [tool] : [] }, 1);
}

/** A plan card's lines with the ad's tool first. */
export function cardLines(planId: ToolPlanId, tool: ToolId | null): string[] {
  const plan = toolPlanById(planId);
  if (!tool) return [...plan.lines];
  const t = toolById(tool);
  const included = plan.includedTrade === "all" || (plan.officeIncluded && t.kind === "office") || (typeof plan.includedTrade === "number" && plan.includedTrade > 0 && t.kind === "trade");
  return [included ? `${t.label} included` : `+ ${t.label} (${money(t.cents)}/mo)`, ...plan.lines];
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
