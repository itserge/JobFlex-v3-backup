// Pure, client-safe plan-catalog definitions.
//
// NO server imports here (no Prisma, no "use server") — the pattern mirrors
// planLimits.ts (client-safe half) vs limitsEngine.ts (server half). The server
// fetchers live in planCatalogServer.ts; every surface that *renders* plan data
// consumes the PlanDTO + helpers from this file.
//
// PricingPlan (the /admin/plans table) is the single source of truth for plan
// names, prices, feature copy, limits, and visibility. Boolean feature *gating*
// stays code-driven in entitlements.ts (MINIMUM_PLAN_FOR).

import { PLAN_TIERS, type Plan } from "@/lib/entitlements";
import type { PlanLimits } from "@/lib/planLimits";
import { isToolsSlug } from "@/lib/toolPlans/shared";

export interface PlanDTO {
  id: string;
  slug: string; // canonical lowercase; join key to PlanPrice.planSlug + Subscription.plan
  name: string;
  description: string | null;
  priceCents: number; // monthly
  yearlyPriceCents: number | null;
  trialDays: number;
  order: number;
  features: string[]; // parsed from the JSON `features` column
  limits: PlanLimits; // parsed from limitsJson; absent key = unlimited
  active: boolean;
  highlight: boolean; // "Most popular" badge
  isFree: boolean; // priceCents === 0 — no Stripe checkout, assigned via setOrgPlan
}

/** "$0" / "$29" / "$29.99" — every surface renders a plan price through this. */
export function formatPlanPrice(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}

/** Cadence copy next to a price: "per month" (or "/mo"). */
export function priceCadence(short = false): string {
  return short ? "/mo" : "per month";
}

/**
 * CTA label for a plan's buy button: "Start N-day trial" when the plan has a
 * trial, else "Subscribe".
 */
export function planCtaLabel(trialDays: number): string {
  if (trialDays > 0) return `Start ${trialDays}-day trial`;
  return "Subscribe";
}

/**
 * Client-safe mirror of getOrgPlanById's rule: a built-in tier slug maps to its
 * own tier; any custom admin-created slug gets ENTERPRISE-level boolean features
 * (its numeric quotas come from the plan's own limits via the Limits engine).
 */
export function featureTierForSlug(slug: string): Plan {
  const upper = slug.toUpperCase();
  if (upper === "CUSTOM") return "PROFESSIONAL"; // lib/customPlan CUSTOM_PLAN_TIER
  // The new plans (Base + Tools): every boolean feature on — the page gate opens and closes their tools.
  if (isToolsSlug(slug)) return "ENTERPRISE";
  return (PLAN_TIERS as readonly string[]).includes(upper) ? (upper as Plan) : "ENTERPRISE";
}

/**
 * THE ONE NAME A PLAN HAS ON SCREEN (owner, 2026-09-25). The catalog's
 * `PricingPlan.name` is what people see — the slug `enterprise` is sold as
 * "Advanced" — and the slug stays technical: Stripe prices, limitsJson,
 * entitlements and the stored `Subscription.plan` keep using it, the
 * interface never prints it. `names` is the catalog's slug → name map
 * (lowercase slugs; planCatalogServer.getPlanNamesBySlug, or a PlanDTO list);
 * a slug the catalog no longer knows falls back to its title-cased form.
 */
export function planDisplayName(
  slug: string | null | undefined,
  names?: ReadonlyMap<string, string> | Record<string, string> | readonly { slug: string; name: string }[] | null,
): string {
  if (!slug) return "—";
  const key = slug.trim().toLowerCase();
  if (!key) return "—";
  if (names) {
    if (Array.isArray(names)) {
      const hit = (names as readonly { slug: string; name: string }[]).find((p) => p.slug.toLowerCase() === key);
      if (hit) return hit.name;
    } else if (names instanceof Map) {
      const hit = names.get(key);
      if (hit) return hit;
    } else {
      const hit = (names as Record<string, string>)[key];
      if (hit) return hit;
    }
  }
  return titleCaseSlug(key);
}

/** Single home for the built-in tier display labels: the catalog's names. */
export function labelForTier(
  tier: Plan | string | null | undefined,
  names?: ReadonlyMap<string, string> | Record<string, string> | readonly { slug: string; name: string }[] | null,
): string {
  // No-subscription orgs have no tier to name (the Free tier is gone).
  return tier ? planDisplayName(tier, names) : "—";
}

/** Display fallback for a subscription pointing at a slug no longer in the catalog. */
export function titleCaseSlug(slug: string): string {
  return slug
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Feature inheritance for display. Catalog features may carry the roll-up line
 * "Everything in <plan>" — a plan with it inherits every feature of the plans
 * BEFORE it in catalog order (the same rule the signup step applies; a naive
 * per-plan lookup read Professional as WORSE than Starter). Returns the
 * de-duplicated display rows (original casing, first seen wins, roll-up lines
 * excluded) and, per slug, the lowercase set of what that plan includes.
 */
export function expandPlanFeatures(plans: { slug: string; features: string[] }[]): {
  rows: string[];
  included: Map<string, Set<string>>;
} {
  const rows: string[] = [];
  const seen = new Set<string>();
  const included = new Map<string, Set<string>>();
  let inherited = new Set<string>();
  for (const p of plans) {
    const own = p.features.map((f) => f.trim());
    const rollsUp = own.some((f) => f.toLowerCase().startsWith("everything in"));
    const set = new Set<string>(rollsUp ? inherited : []);
    for (const f of own) {
      const low = f.toLowerCase();
      if (!low || low.startsWith("everything in")) continue;
      set.add(low);
      if (!seen.has(low)) {
        seen.add(low);
        rows.push(f);
      }
    }
    included.set(p.slug, set);
    inherited = set;
  }
  return { rows, included };
}
