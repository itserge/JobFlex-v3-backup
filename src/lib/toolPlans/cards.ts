// THE NEW PLANS' CARDS AND THE SIGN-UP'S CARD PAGE (Base + Tools, part 4 — owner, 2026-11-10). Pure, client-safe.
//
// THE PLAN CARDS. With the Plans switch on (lib/toolPlans/server), the public plan cards — the landing's, /pricing's,
// the sign-up's — are Basic, Professional, Advanced and Complete, each priced with the tool the ad sold
// (lib/planSpotlight parseAdTool → toolForAdKey): a Deck Studio ad shows "Professional · $154" with "+ Deck Studio
// ($79/mo)" as the card's first line, Advanced "Deck Studio included". They are handed to the card components as the
// same PlanDTO the Classic catalog gives (lib/planCatalog), so the cards draw them with their own frame, price and
// Monthly | Annual switch; a year is ten months (YEAR_MONTHS). The switch off: these are never built — the surfaces
// read the Classic catalog exactly as before (lib/toolPlans/publicPlans).
//
// THE CARD PAGE. The sign-up opens on Professional + the ad's tool (owner's choice); a smaller switch moves between
// Professional and Basic ("Working alone? Basic + Deck Studio, $118.99"), "Change tool" picks any of the twelve (or
// none), and the price follows. What the page shows is exactly what the checkout bills — no pick-boxes — and the
// server prices it again from the plan and the tool alone (toolsSignupPick), never from a number the browser sent.

import type { PlanDTO } from "@/lib/planCatalog";
import { adToolFor, parseAdTool } from "@/lib/planSpotlight";
import {
  cardCents,
  cardLines,
  DEFAULT_CATALOG,
  isToolId,
  isToolsSlug,
  money,
  PLAN_TRIAL_DAYS,
  toolForAdKey,
  toolPlanBySlug,
  YEAR_MONTHS,
  type Catalog,
  type ToolId,
  type ToolPlanId,
} from "./shared";

/** The size the sign-up opens on, and the one the cards mark "Most picked". */
export const TOOLS_DEFAULT_PLAN: ToolPlanId = "professional";

/** The four cards as PlanDTOs, priced with the main tool (null: the sizes alone). */
export function toolsPlanDTOs(tool: ToolId | null, cat: Catalog = DEFAULT_CATALOG, trialDays: number = PLAN_TRIAL_DAYS): PlanDTO[] {
  return cat.plans.map((p, i) => {
    const cents = cardCents(p.id, tool, cat);
    return {
      id: p.slug,
      slug: p.slug,
      name: p.name,
      description: null,
      priceCents: cents,
      yearlyPriceCents: cents * YEAR_MONTHS,
      trialDays,
      order: i,
      features: cardLines(p.id, tool, cat),
      limits: {},
      active: true,
      highlight: p.id === TOOLS_DEFAULT_PLAN,
      isFree: false,
    };
  });
}

/** True when a card list is the new plans' (every slug "tools-…"): the surfaces draw the tools cards then. */
export function isToolsCatalog(plans: ReadonlyArray<{ slug: string }>): boolean {
  return plans.length > 0 && plans.every((p) => isToolsSlug(p.slug));
}

/** The main tool a visit carries, for the new plans: the link's `?tool=` (any ad key), else the landing trade's tool,
 *  else the 30-day cookie (lib/planSpotlight SPOTLIGHT_COOKIE). Null: no tool — the sizes alone. */
export function mainToolFor(input: { tool?: string | string[] | null; industry?: string | null; cookie?: string | null }): ToolId | null {
  const key = adToolFor({ tool: input.tool, industry: input.industry }) ?? parseAdTool(input.cookie) ?? null;
  return toolForAdKey(key)?.id ?? null;
}

/** The ad key a main tool's links carry (`?tool=`): the tool's own key. */
export function adKeyOf(tool: ToolId | null | undefined, cat: Catalog = DEFAULT_CATALOG): string | null {
  return tool ? (cat.tools.find((t) => t.id === tool)?.adKey ?? null) : null;
}

/** Does this size include the tool (so it is no line of its own)? Advanced: the office tools and a trade tool as one of
 *  its two; Complete: every tool. */
export function sizeIncludes(planId: ToolPlanId, tool: ToolId, cat: Catalog = DEFAULT_CATALOG): boolean {
  const plan = cat.plans.find((p) => p.id === planId);
  const t = cat.tools.find((x) => x.id === tool);
  if (!plan || !t) return false;
  return plan.includedTrade === "all" || (plan.officeIncluded && t.kind === "office") || (typeof plan.includedTrade === "number" && plan.includedTrade > 0 && t.kind === "trade");
}

export interface ToolsChoice {
  plan: ToolPlanId;
  slug: string;
  main: ToolId | null;
  /** "Professional + Deck Studio" · "Advanced" (the tool included) · "Basic". */
  label: string;
  /** "Deck Studio included" when the size holds the tool. */
  includedNote: string | null;
  /** The month, in cents: the size plus the tool unless it includes it. */
  cents: number;
  /** The year: ten months. */
  yearlyCents: number;
  /** The card's lines, the tool's first. */
  lines: string[];
}

/** One plan with one main tool: the name, the price and the lines the card page draws. */
export function toolsChoice(planId: ToolPlanId, main: ToolId | null, cat: Catalog = DEFAULT_CATALOG): ToolsChoice {
  const plan = cat.plans.find((p) => p.id === planId)!;
  const t = main ? cat.tools.find((x) => x.id === main) ?? null : null;
  const included = !!t && sizeIncludes(planId, t.id, cat);
  const cents = cardCents(planId, main, cat);
  return {
    plan: planId,
    slug: plan.slug,
    main,
    label: t && !included ? `${plan.name} + ${t.label}` : plan.name,
    includedNote: t && included ? `${t.label} included` : null,
    cents,
    yearlyCents: cents * YEAR_MONTHS,
    lines: cardLines(planId, main, cat),
  };
}

/** THE SMALLER SWITCH (owner, 2026-11-10): on Professional "Working alone? Basic + Deck Studio, $118.99"; on Basic
 *  "Have a team? Professional + Deck Studio, $154". The bigger sizes have none (the plan row lists them). */
export function toolsSizeSwitch(planId: ToolPlanId, main: ToolId | null, cat: Catalog = DEFAULT_CATALOG): { to: ToolPlanId; ask: string; label: string; cents: number; words: string } | null {
  const to: ToolPlanId | null = planId === "professional" ? "basic" : planId === "basic" ? "professional" : null;
  if (!to) return null;
  const c = toolsChoice(to, main, cat);
  const ask = to === "basic" ? "Working alone?" : "Have a team?";
  return { to, ask, label: c.label, cents: c.cents, words: `${ask} ${c.label}, ${money(c.cents)}` };
}

/** The line over the public cards when the visit carries a tool: "Every plan is priced with Deck Studio: $79/mo on
 *  Basic and Professional, included in Advanced and Complete." */
export function toolsBanner(tool: ToolId, cat: Catalog = DEFAULT_CATALOG): string {
  const t = cat.tools.find((x) => x.id === tool)!;
  const adds = cat.plans.filter((p) => !sizeIncludes(p.id, tool, cat)).map((p) => p.name);
  const holds = cat.plans.filter((p) => sizeIncludes(p.id, tool, cat)).map((p) => p.name);
  const and = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
  const parts = [adds.length ? `${money(t.cents)}/mo on ${and(adds)}` : "", holds.length ? `included in ${and(holds)}` : ""].filter(Boolean);
  return `Every plan is priced with ${t.label}: ${parts.join(", ")}.`;
}

/** The size a sign-up opens on: the one asked for (?plan= from a card), else Professional. */
export function toolsPlanFromAsk(asked: string | null | undefined): ToolPlanId {
  return toolPlanBySlug(asked)?.id ?? TOOLS_DEFAULT_PLAN;
}

/**
 * THE SERVER'S READ OF A SIGN-UP'S PICK — the only way a plan and a tool reach the checkout. The plan must be one of
 * the four "tools-…" slugs; the tool one of the twelve, or nothing ("", "none", null, undefined). Anything else — a
 * made-up slug, a Classic slug, a tool that does not exist — is refused (null), never guessed at.
 */
export function toolsSignupPick(input: { plan: string | null | undefined; tool: string | null | undefined }): { plan: ToolPlanId; main: ToolId | null } | null {
  const plan = isToolsSlug(input.plan) ? toolPlanBySlug(input.plan) : null;
  if (!plan) return null;
  const raw = typeof input.tool === "string" ? input.tool.trim().toLowerCase() : input.tool;
  if (raw === null || raw === undefined || raw === "" || raw === "none") return { plan: plan.id, main: null };
  return isToolId(raw) ? { plan: plan.id, main: raw } : null;
}

/** A link with `plan=` (and `tool=`) set, the rest of its query kept: a card's start button. */
export function withPlanQuery(href: string, plan: string, tool?: string | null): string {
  const hashAt = href.indexOf("#");
  const path = hashAt < 0 ? href : href.slice(0, hashAt);
  const hash = hashAt < 0 ? "" : href.slice(hashAt);
  const [base, query = ""] = path.split("?");
  const q = new URLSearchParams(query);
  q.set("plan", plan);
  if (tool) q.set("tool", tool);
  return `${base}?${q.toString()}${hash}`;
}
