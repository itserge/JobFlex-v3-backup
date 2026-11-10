// THE CUSTOM PLAN — pay for the pages you actually open.
//
// Every other plan is a bundle somebody else decided. This one starts at
// BASE_CENTS with the everyday workspace included, and each of the pages below
// is a PAID ADD-ON at PAGE_CENTS. A shop that only wants the manual builder and
// the client book pays the base; one that wants the estimators and the crew
// tools pays for exactly those.
//
// WHAT IS IN THE BASE, and why these are the ones that are not:
// the base is the paperwork a contractor cannot work without — the dashboard,
// proposals (manual builder included), clients, projects, CRM, jobs, messages,
// financials, announcements, reviews. The add-ons are the machines and the
// team surfaces: every ESTIMATOR except the manual builder, plus Company,
// Workers, Phone, Calendar and Leads.
//
// Shared by the signup picker (client) and the checkout route (server). The
// server NEVER prices from the client's number: it re-runs `customPriceCents`
// over the stored selection, so a doctored request buys nothing cheaper.

/** Base price of the custom plan, per month, in cents. */
export const CUSTOM_BASE_CENTS = 2000;
/** Each add-on page, per month, in cents. */
export const CUSTOM_PAGE_CENTS = 1000;
/** Yearly is ten months — two free, the same ~17% the catalog plans save and
 *  the same number the signup switch reads off them. */
export const CUSTOM_YEAR_MULTIPLIER = 10;

/** The add-on pages (and the retired deck page, RETIRED_PAGES), by the id stored with the subscription. */
export type CustomPageId =
  | "smart-proposal"
  | "roof-estimator"
  | "fence-estimator"
  | "deck-estimator"
  | "video-estimator"
  | "hvac-estimator"
  | "calendar"
  | "leads"
  | "workers"
  | "company"
  | "phone";

export interface CustomPage {
  /** Stable id stored with the subscription. */
  id: CustomPageId;
  label: string;
  /** What the page is, in three or four words — the picker shows this. */
  note: string;
  /** The route it unlocks, for the gate that reads this selection. */
  href: string;
  /** Every OTHER address that opens the same page: legacy aliases, the v3
   *  sandbox copy and the standalone handheld URL. A path belongs to the page
   *  whose href-or-alias is its LONGEST matching prefix (pageForPath), so
   *  /dashboard/advanced-ai/roof is the roof estimator, not Smart Proposal. */
  aliases: string[];
}

export const CUSTOM_PAGES: CustomPage[] = [
  { id: "smart-proposal", label: "Smart Proposal", note: "AI estimate from a prompt", href: "/dashboard/advanced-ai",
    // The blueprint estimator is Smart Proposal's plan set as its own tool (2026-10-13).
    aliases: ["/dashboard/proposals/ai", "/mobile-advanced-ai-v2", "/mobile-smart-estimate-v1", "/dashboard/blueprint-estimator"] },
  { id: "roof-estimator", label: "Roof estimator", note: "Aerial roof takeoff", href: "/dashboard/roof-estimator",
    aliases: ["/dashboard/advanced-ai/roof", "/mobile-roof-estimator-v2"] },
  { id: "fence-estimator", label: "Fence estimator", note: "Draw the fence on a map", href: "/dashboard/fence-estimator",
    aliases: ["/dashboard/advanced-ai/fence", "/mobile-fence-estimator-v2"] },
  { id: "video-estimator", label: "Video estimator", note: "Estimate from a walkthrough", href: "/dashboard/video-estimator",
    aliases: ["/mobile-video-estimator-v1"] },
  { id: "hvac-estimator", label: "HVAC estimator", note: "Load, unit and price for a replacement", href: "/dashboard/hvac-estimator",
    aliases: [] },
  { id: "calendar", label: "Calendar", note: "Scheduling and crew days", href: "/dashboard/calendar",
    aliases: ["/v3/calendar-a", "/mobile-calendar-v2"] },
  { id: "leads", label: "Leads", note: "Inbox and platform leads", href: "/dashboard/leads",
    aliases: ["/mobile-leads-v2"] },
  { id: "workers", label: "Workers", note: "Crew, roles and portals", href: "/dashboard/workers",
    aliases: ["/v3/workers-new", "/mobile-workers-v2"] },
  { id: "company", label: "Company", note: "Branding and lead matching", href: "/dashboard/company",
    aliases: ["/mobile-company-v2"] },
  { id: "phone", label: "AI desk", note: "Answers calls, books visits, takes messages — the call log", href: "/dashboard/phone",
    aliases: ["/mobile-phone-v2"] },
];

// ── PAID FEATURES (owner, 2026-11-09) ───────────────────────────────────────
// What the other developers built in the two weeks to 2026-11-09 opens on every LIVE plan — Starter,
// Professional, Advanced, a Custom plan, a trial, a grant — and the Free plan closes it, the way Free closes
// the estimators. They are not sold page by page: no price, never in the Custom plan's picker, never in
// blockedCustomHrefs (a Custom plan holds them all). The one gate is the add-on gate (lib/customPageAccess:
// requirePage / pageLockedResponse / isPageLocked, customPageGate for a page), so a lapsed plan, a platform
// admin (hasFullAccess) and a grant are answered exactly as they are for the estimators.
//   href  — the feature's own page, gated at its URL by the layouts and marked in the nav; null when the
//           feature lives inside an older page (a project's stages, a job's field tools, the booking page's
//           SmartBook) and only its actions, routes and section are gated.
export type PaidFeatureId =
  | "operator"
  | "subcontractors"
  | "smart-crm"
  | "project-tools"
  | "crew-field"
  | "smartbook"
  | "smarthelp";

export interface PaidFeature {
  id: PaidFeatureId;
  label: string;
  note: string;
  href: string | null;
  aliases: string[];
}

export const PAID_FEATURES: PaidFeature[] = [
  { id: "operator", label: "AI Operator", note: "Ask, approve and undo by voice or text", href: "/mobile-assistant-v1", aliases: [] },
  { id: "subcontractors", label: "Subcontractors", note: "Requests, quotes, subcontracts and invoices", href: "/dashboard/subcontractors",
    aliases: ["/dashboard/quotes", "/mobile-subcontractors-v1", "/mobile-quotes-v1", "/mobile-project-subs-v1"] },
  { id: "smart-crm", label: "Smart CRM", note: "Inbox, pipeline and the client 360", href: "/dashboard/pipeline", aliases: ["/dashboard/inbox"] },
  { id: "project-tools", label: "Project stages & buying", note: "Stages, tasks, buying and deliveries", href: null, aliases: [] },
  { id: "crew-field", label: "Crew field tools", note: "Tasks, deliveries, hours and flags on the job", href: null, aliases: [] },
  { id: "smartbook", label: "SmartBook", note: "New leads book a visit by text, email or call", href: null, aliases: [] },
  { id: "smarthelp", label: "SmartHelp", note: "Guides and answers inside JobFlex", href: null, aliases: [] },
];

/** Every id the gate answers for: a sellable add-on page or a paid feature. */
export type GatedPageId = CustomPageId | PaidFeatureId;
export type GatedPage = CustomPage | PaidFeature;

const PAID_IDS = new Set<string>(PAID_FEATURES.map((f) => f.id));
export function isPaidFeature(id: string): id is PaidFeatureId {
  return PAID_IDS.has(id);
}

/** The page or feature behind an id, for its label and its href. */
export function gatedPage(id: GatedPageId): GatedPage | null {
  return CUSTOM_PAGES.find((p) => p.id === id) ?? PAID_FEATURES.find((f) => f.id === id) ?? null;
}

/** Addresses under an add-on's prefix that belong to the BASE workspace: the
 *  old Company → Subscription link (a redirect to /dashboard/subscription) and
 *  the team list, which /dashboard/settings/team serves to every plan anyway.
 *  Also the old inventory boards, which the middleware redirects to each trade's
 *  inventory — that page sits under its estimator and is locked with it (2026-10-10). */
const BASE_EXCEPTIONS = [
  "/dashboard/company/subscription",
  "/dashboard/company/team",
  "/dashboard/roof-estimator/board",
  "/dashboard/fence-estimator/board",
  "/dashboard/hvac-estimator/board",
  "/dashboard/hvac-estimator/services",
];

function underPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix + "/");
}

/** The add-on page a path opens, or null for the base workspace. Longest
 *  matching prefix wins across every page's href and aliases. */
export function pageForPath(pathname: string): GatedPage | null {
  const path = pathname.split("?")[0];
  let best: { page: GatedPage | null; len: number } = { page: null, len: -1 };
  for (const ex of BASE_EXCEPTIONS) {
    if (underPrefix(path, ex) && ex.length > best.len) best = { page: null, len: ex.length };
  }
  for (const page of [...CUSTOM_PAGES, ...PAID_FEATURES]) {
    for (const prefix of [page.href, ...page.aliases]) {
      if (prefix && underPrefix(path, prefix) && prefix.length > best.len) best = { page, len: prefix.length };
    }
  }
  return best.page;
}

/** What every custom plan includes before a single add-on is picked. */
export const CUSTOM_BASE_FEATURES = [
  "Dashboard, clients & projects",
  "Manual proposal builder",
  "Invoices & online payments",
  "Jobs, messages & financials",
];

/** Pages no longer sold but still read off a stored selection, so a plan that holds one keeps its price.
 *  The Deck estimator (2026-10-19): not sold as a page any more — Deck Studio is its own $79/month add-on on
 *  any plan (lib/deckAddon). A stored selection still reads (the plan keeps its price) and counts as the add-on
 *  bought as a page: the whole Deck Studio, no second add-on line (owner, 2026-10-20 — lib/editions). */
export const CUSTOM_DECK_PAGE: CustomPageId = "deck-estimator";
const RETIRED_PAGES: readonly CustomPageId[] = [CUSTOM_DECK_PAGE];

const VALID = new Set<string>([...CUSTOM_PAGES.map((p) => p.id), ...RETIRED_PAGES]);

/** Drop anything that is not a real add-on id, and de-duplicate. */
export function normalizeCustomPages(pages: readonly string[] | null | undefined): string[] {
  if (!Array.isArray(pages)) return [];
  const out: string[] = [];
  for (const p of pages) {
    const id = String(p);
    if (VALID.has(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

/** Monthly price in cents for a selection. Yearly is ten of these. */
export function customPriceCents(
  pages: readonly string[] | null | undefined,
  interval: "MONTH" | "YEAR" = "MONTH",
): number {
  const monthly = CUSTOM_BASE_CENTS + normalizeCustomPages(pages).length * CUSTOM_PAGE_CENTS;
  return interval === "YEAR" ? monthly * CUSTOM_YEAR_MULTIPLIER : monthly;
}

/** The slug the rest of the app recognises for this plan. */
export const CUSTOM_PLAN_SLUG = "custom";

/** WHAT A CUSTOM PLAN IS ENTITLED TO, beyond its pages (owner, 2026-10-06):
 *  Professional's limits (the "professional" catalog row's limitsJson —
 *  workers, seats, proposals…) and Professional's feature tier (SMS
 *  allowance, the company's own texting number), whatever pages it holds.
 *  Before this the custom plan had no catalog row, so every limit read as
 *  unlimited and its tier as FREE. */
export const CUSTOM_PLAN_TIER = "PROFESSIONAL" as const;
export const CUSTOM_PLAN_LIMITS_SLUG = "professional";

/** Trial length when nothing has been set in /admin/plans. The admin value
 *  lives in SyncState (lib/customPlanConfig) because the custom plan has no
 *  PricingPlan row to hold a trialDays column; this is the client-safe floor
 *  the signup step labels itself with until the server answers. */
export const DEFAULT_CUSTOM_TRIAL_DAYS = 7;

// ── Access, derived from the selection ──────────────────────────────────────
// Pure helpers, shared by the server gate (lib/customPageAccess) and the nav
// filters, which are client components. The DB read stays server-side; what a
// selection MEANS is decided in exactly one place, here.

/** The add-on hrefs a custom-plan org did NOT buy — the list every gate and
 *  nav filter blocks on. Anything not in CUSTOM_PAGES is base and never here. */
/** A marker the blocked list carries when the org's plan has LAPSED
 *  (lib/planStatus — cancelled, unpaid, expired, a card-less trial run out):
 *  every add-on is closed because the plan ended, not because it was not
 *  bought, and the gate says so (upgrade-gate). Not a page href, so the nav
 *  and isCustomBlockedPath never match it. */
export const PLAN_ENDED_MARK = "#plan-ended";

export function blockedCustomHrefs(bought: readonly string[] | null | undefined): string[] {
  const have = new Set(normalizeCustomPages(bought));
  return CUSTOM_PAGES.filter((p) => !have.has(p.id)).map((p) => p.href);
}

/** What a LAPSED plan blocks (lib/planStatus — the Free plan among them): every add-on page and every paid
 *  feature that has a page of its own. The gate's list carries PLAN_ENDED_MARK beside these. */
export function lapsedBlockedHrefs(): string[] {
  return [...CUSTOM_PAGES.map((p) => p.href), ...PAID_FEATURES.flatMap((f) => (f.href ? [f.href] : []))];
}

/** Whether a path opens a page in the blocked list (the hrefs
 *  blockedCustomHrefs returns). The path is resolved to its page first —
 *  aliases and handheld URLs included, longest prefix wins — so an alias is
 *  blocked exactly when the page it opens is. */
export function isCustomBlockedPath(
  blocked: readonly string[] | null | undefined,
  pathname: string,
): boolean {
  if (!blocked?.length) return false;
  const page = pageForPath(pathname);
  return Boolean(page?.href && blocked.includes(page.href));
}

/* WHAT THE CUSTOM PLAN TICKS on the compare matrix (subscription page).
   The matrix rows are the catalog's benefit strings; the custom plan is base
   + pages, so each is mapped to the row it opens. Lower-cased to match the
   matrix's own lookup. If a benefit is renamed in /admin/plans, rename it
   here too or its tick goes missing — the matrix is text-keyed. */
const CUSTOM_BASE_ROWS = [
  "proposal management",
  "client management",
  "crm",
  "financials",
  "messages",
  "1 user",
  // The paid features (2026-11-09, PAID_FEATURES): a Custom plan holds them all.
  "ai operator",
  "project stages & buying",
  "crew field tools",
  "smartbook",
];
const CUSTOM_PAGE_ROWS: Record<string, string[]> = {
  "smart-proposal": ["smart proposal generation"],
  "roof-estimator": ["roof estimator"],
  "fence-estimator": ["fence estimator"],
  "video-estimator": ["video estimator"],
  "hvac-estimator": ["hvac estimator"],
  "deck-estimator": ["deck estimator"],
  calendar: ["calendar"],
  leads: ["free leads"],
  workers: ["workers management"],
  company: [],
  phone: ["ai phone answering"],
};

/** Rows a custom plan with these pages includes (lower-cased). */
export function customPlanIncludes(pages: readonly string[] | null | undefined): Set<string> {
  const out = new Set<string>(CUSTOM_BASE_ROWS);
  for (const id of normalizeCustomPages(pages)) {
    for (const row of CUSTOM_PAGE_ROWS[id] ?? []) out.add(row);
  }
  return out;
}

/** Rows that a custom plan COULD add (any page's row), lower-cased. */
export function customPlanAddable(): Set<string> {
  const out = new Set<string>();
  for (const rows of Object.values(CUSTOM_PAGE_ROWS)) for (const r of rows) out.add(r);
  return out;
}
