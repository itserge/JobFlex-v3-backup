// THE TOOL THE VISITOR CAME FOR, MARKED ON EVERY PLAN (owner, 2026-10-14:
// "a roofer comes from the roofing ad, scrolls the plans, and with so much in
// every plan he doesn't see the roof estimator — highlight it for him; same
// for HVAC, fence, and the ads we'll run for Smart Proposal, blueprints, the
// AI desk and Deck Studio").
//
// Pure and client-safe. One map from an ad's tool to the feature line it
// sells; the plan surfaces (the landing's pricing, /pricing, the signup plan
// step, Subscription and Upgrade in the app) pin that line to the top of
// every card and mark it, and say so when a plan lacks it.
//
// Where the tool comes from, in order: the link's own `?tool=` (an ad for a
// tool), else the trade the landing was opened on (`?industry=roofing` means
// the roof estimator), else nothing — a visitor with no ad behind them sees
// the plans as they are. The landing remembers it for 30 days in a cookie
// beside the trade; the signup writes it on the company (SyncState, no
// schema change), so the Subscription page keeps marking it for the trial.

import { deckAddonPriceWords } from "@/lib/deckAddon";
import { CUSTOM_PLAN_SLUG, type CustomPageId } from "@/lib/customPlan";

export type SpotlightTool = "roof" | "hvac" | "fence" | "smart" | "blueprint" | "aidesk" | "deck";

export const SPOTLIGHT_TOOLS: readonly SpotlightTool[] = ["roof", "hvac", "fence", "smart", "blueprint", "aidesk", "deck"];

export const SPOTLIGHT_COOKIE = "jf_tool";
export const SPOTLIGHT_MAX_AGE_S = 60 * 60 * 24 * 30; // 30 days, the trade cookie's life

export interface SpotlightDef {
  /** The tool's name as the sheet says it. */
  label: string;
  /** "the Roof estimator" — mid-sentence. */
  the: string;
  /** Who the ad speaks to: "roofers". */
  who: string;
  /** Finds the feature line that sells this tool, however the catalog words it. */
  match: RegExp;
  /** The landing trades whose ads mean this tool, by variant key. */
  trades: readonly string[];
  /** Other spellings a link may carry. */
  aliases: readonly string[];
}

export const SPOTLIGHT: Record<SpotlightTool, SpotlightDef> = {
  roof: { label: "Roof estimator", the: "the Roof estimator", who: "roofers", match: /\broof(ing)?\b/i, trades: ["roofing"], aliases: ["roofing", "roof-estimator", "roofer"] },
  hvac: { label: "HVAC estimator", the: "the HVAC estimator", who: "HVAC shops", match: /\bhvac\b|heat pump|furnace/i, trades: ["hvac"], aliases: ["hvac-estimator", "heating", "cooling"] },
  fence: { label: "Fence estimator", the: "the Fence estimator", who: "fence builders", match: /\bfenc(e|ing)\b/i, trades: ["fencing"], aliases: ["fencing", "fence-estimator"] },
  smart: { label: "Smart Proposal", the: "Smart Proposal", who: "contractors who write proposals", match: /smart proposal|smart estimat|proposal generation|ai proposal/i, trades: [], aliases: ["smart-proposal", "smartproposal", "proposal", "smart-estimator"] },
  blueprint: { label: "Blueprint estimator", the: "the Blueprint estimator", who: "builders working from plans", match: /blueprint|from plans|plan set/i, trades: [], aliases: ["blueprints", "blueprint-estimator", "plans"] },
  aidesk: { label: "AI desk", the: "the AI desk", who: "shops that miss calls", match: /ai desk|ai phone|phone answering|receptionist|answers (the|every) call/i, trades: [], aliases: ["ai-desk", "desk", "phone", "receptionist"] },
  deck: { label: "Deck Studio", the: "Deck Studio", who: "deck builders", match: /deck studio|\bdeck(s|ing)?\b/i, trades: ["decking"], aliases: ["decking", "deck-studio", "decks"] },
};

/** `?tool=` on a link: a key, or one of its spellings; anything else is nothing. */
export function parseSpotlightTool(raw: string | string[] | null | undefined): SpotlightTool | undefined {
  const v = (Array.isArray(raw) ? raw[0] : raw)?.trim().toLowerCase();
  if (!v) return undefined;
  for (const key of SPOTLIGHT_TOOLS) {
    if (v === key || SPOTLIGHT[key].aliases.includes(v)) return key;
  }
  return undefined;
}

/** The tool a landing trade's ad is selling: "roofing" / "Roofing" → roof. */
export function spotlightFromTrade(industry: string | null | undefined): SpotlightTool | undefined {
  const v = industry?.trim().toLowerCase();
  if (!v) return undefined;
  for (const key of SPOTLIGHT_TOOLS) {
    const def = SPOTLIGHT[key];
    if (def.trades.includes(v) || def.trades.some((t) => t.replace(/ing$/, "") === v.replace(/ing$/, ""))) return key;
  }
  return undefined;
}

/** What to mark, from everything the visit carried. The tool wins over the trade. */
export function spotlightFor(input: { tool?: string | string[] | null; industry?: string | null }): SpotlightTool | null {
  return parseSpotlightTool(input.tool) ?? spotlightFromTrade(input.industry) ?? null;
}

/** The feature line that sells the tool, out of the plans' shared rows; null when no plan lists it — and always for a
 *  tool sold as an add-on (no plan carries it, whatever a feature line says). */
export function spotlightRow(rows: readonly string[], tool: SpotlightTool | null | undefined): string | null {
  if (!tool || isAddOnTool(tool)) return null;
  const def = SPOTLIGHT[tool];
  return rows.find((r) => def.match.test(r)) ?? null;
}

/** The rows with the tool's line first; the rest in their order. */
export function withSpotlightFirst(rows: readonly string[], tool: SpotlightTool | null | undefined): string[] {
  const hit = spotlightRow(rows, tool);
  if (!hit) return [...rows];
  return [hit, ...rows.filter((r) => r !== hit)];
}

/* ONE TRADE, ONE ESTIMATOR (owner, 2026-11-07: "a visitor who came for ONE trade sees only that trade's estimator in
   the plan cards"). The trade estimators are roof, hvac, fence and deck. A visitor whose spotlight is roof, hvac or
   fence sees only that one among them — the other trade rows (and the Deck Studio add-on line) are hidden; every row
   that is not a trade estimator stays. Deck, smart, blueprint, aidesk, or no spotlight: every row, as before. Rows
   are found by the SPOTLIGHT map's own match, never by free text. Public plan cards only (landing, /pricing, the
   signup plan step); Subscription and Upgrade in the app keep every row. */
const TRADE_TOOLS: readonly SpotlightTool[] = ["roof", "hvac", "fence", "deck"];
const NARROWING: ReadonlySet<SpotlightTool> = new Set<SpotlightTool>(["roof", "hvac", "fence"]);

/** Whether a trade tool's line shows for this visitor (any non-trade tool always does). */
export function showsTool(tool: SpotlightTool, spotlight: SpotlightTool | null | undefined): boolean {
  if (!spotlight || !NARROWING.has(spotlight)) return true;
  return tool === spotlight || !TRADE_TOOLS.includes(tool);
}

/** The rows a visitor sees: minus the other trades' estimator rows when the spotlight narrows. A row that also
 *  matches the spotlighted tool stays. Order kept. */
export function visibleRows(rows: readonly string[], spotlight: SpotlightTool | null | undefined): string[] {
  if (!spotlight || !NARROWING.has(spotlight)) return [...rows];
  const own = SPOTLIGHT[spotlight].match;
  return rows.filter((r) => own.test(r) || !TRADE_TOOLS.some((t) => t !== spotlight && SPOTLIGHT[t].match.test(r)));
}

/** Tools sold as an add-on to any plan, never by a plan: the Deck Studio (owner-locked 2026-10-20 — the free trial
 *  holds it, then $79/month on any plan; lib/deckAddon). */
const ADD_ON: Partial<Record<SpotlightTool, string>> = { deck: `the trial includes it, then it's ${deckAddonPriceWords("MONTH")} on any plan` };

export function isAddOnTool(tool: SpotlightTool): boolean {
  return ADD_ON[tool] !== undefined;
}

/** The line over the cards. */
export function spotlightLine(tool: SpotlightTool, listed: boolean): string {
  const def = SPOTLIGHT[tool];
  const addOn = ADD_ON[tool];
  if (addOn) return `You came for ${def.the} — ${addOn}.`;
  return listed ? `You came for ${def.the} — it's marked on every plan below.` : `You came for ${def.the} — it comes with every plan's trial; ask us which plan carries it.`;
}

export const SPOTLIGHT_TAG = "The tool you came for";
export const SPOTLIGHT_MISSING = "Not in this plan";

/** The page each tool opens (lib/customPlan CUSTOM_PAGES; the blueprint estimator is Smart Proposal's). */
const SPOTLIGHT_PAGE: Record<SpotlightTool, CustomPageId> = {
  roof: "roof-estimator",
  hvac: "hvac-estimator",
  fence: "fence-estimator",
  smart: "smart-proposal",
  blueprint: "smart-proposal",
  aidesk: "phone",
  deck: "deck-estimator",
};

/**
 * IS THE TOOL IN THIS PLAN — read off the real gates, never the card's text (owner, 2026-10-26 — audit §7). Every
 * catalog plan opens every page (lib/customPageAccess: readCustomPages is null off the Custom plan), so the tool is
 * in Starter, Professional and Advanced alike. "Not in this plan" is only ever Deck Studio — an add-on, never a
 * plan's (lib/editions hasEdition) — and a Custom plan's page it did not buy. The feature lines stay display.
 */
export function spotlightInPlan(tool: SpotlightTool, plan: { slug: string; customPages?: readonly string[] | null }): boolean {
  if (isAddOnTool(tool)) return false;
  if (plan.slug.toLowerCase() !== CUSTOM_PLAN_SLUG) return true;
  return Boolean(plan.customPages?.includes(SPOTLIGHT_PAGE[tool]));
}
