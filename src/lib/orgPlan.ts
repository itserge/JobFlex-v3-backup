import { db } from "@/lib/db";
import { PLAN_TIERS, type Plan } from "@/lib/entitlements";
import { CUSTOM_PLAN_TIER } from "@/lib/customPlan";
import { planLapsed } from "@/lib/planStatus";
import { readAccessSubscription } from "@/lib/subscriptionAccess";
import { hasFullAccess } from "@/lib/fullAccess";
import { isToolsSlug } from "@/lib/toolPlans/shared";

/**
 * Resolve an org's effective feature tier.
 *
 * Two plan systems coexist: the built-in tier ladder (FREE/STARTER/PROFESSIONAL/
 * ENTERPRISE) that boolean feature-gating understands, and admin-defined
 * PricingPlans (arbitrary slugs) whose quotas are enforced by the numeric Limits
 * engine. When an org is assigned a custom PricingPlan, its slug won't match a
 * built-in tier — but it still means the org is on a real plan, so features are
 * unlocked here and the Limits engine (PricingPlan.limitsJson) does the metering.
 *
 * A LAPSED plan is FREE here whatever its name (owner, 2026-10-07): CANCELED,
 * UNPAID, EXPIRED, TRIAL_ENDED, or a period long over — lib/planStatus. A
 * failed renewal Stripe is still retrying (PAST_DUE) keeps its tier.
 *
 * A platform admin in the org (lib/fullAccess, the session's user) has the
 * top tier whatever the subscription says (owner, 2026-10-17).
 */
export async function getOrgPlanById(organizationId: string): Promise<Plan> {
  if (await hasFullAccess(organizationId)) return "ENTERPRISE";
  const sub = await readAccessSubscription(organizationId);
  if (!sub?.plan || planLapsed(sub)) return "FREE";

  const upper = sub.plan.toUpperCase();
  // Built-in tier name → use it as-is.
  if ((PLAN_TIERS as readonly string[]).includes(upper)) return upper as Plan;
  // The custom plan rides on Professional (lib/customPlan CUSTOM_PLAN_TIER).
  if (upper === "CUSTOM") return CUSTOM_PLAN_TIER;
  // The new plans (Base + Tools, lib/toolPlans/shared): every boolean feature on — the page gate
  // (lib/customPageAccess) is what opens and closes their tools, and they have no PricingPlan row.
  if (isToolsSlug(sub.plan)) return "ENTERPRISE";

  // Custom assigned plan: confirm it maps to a real PricingPlan (case-insensitive),
  // then grant full feature access. Quotas come from that plan's limits, not here.
  // Deliberately does NOT filter on PricingPlan.active — subscribers on a
  // deactivated plan are grandfathered and keep their entitlements.
  const matched = await db.pricingPlan.findFirst({
    where: { slug: { in: [sub.plan, upper, sub.plan.toLowerCase()] } },
    select: { id: true },
  });
  return matched ? "ENTERPRISE" : "FREE";
}
