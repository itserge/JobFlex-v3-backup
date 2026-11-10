// Plan-based feature gating. Derived at runtime from Subscription.plan — no DB table needed.

export const PLAN_TIERS = ["FREE", "STARTER", "PROFESSIONAL", "ENTERPRISE"] as const;
export type Plan = (typeof PLAN_TIERS)[number];

export const ALL_FEATURES = [
  "unlimited_proposals",
  "ai_proposals",
  "advanced_estimator",
  "proposal_templates",
  "pdf_export",
  "follow_ups",
  "sms_notifications",
  "csv_export",
  "multi_org",
  "custom_domain",
  "white_label",
  // Subcontractors plan, part 5a (2026-11-09): recording payments to subs, releasing retainage, paying through Ramp.
  "sub_payments",
] as const;
export type Feature = (typeof ALL_FEATURES)[number];

export const FEATURE_LABELS: Record<Feature, string> = {
  unlimited_proposals: "Unlimited proposals",
  ai_proposals: "AI proposal drafts",
  advanced_estimator: "Advanced AI estimator",
  proposal_templates: "Proposal templates",
  pdf_export: "Branded PDF export",
  follow_ups: "Follow-up automation",
  sms_notifications: "SMS notifications",
  csv_export: "CSV report exports",
  multi_org: "Multiple organizations",
  custom_domain: "Custom domain",
  white_label: "White-label client portal",
  sub_payments: "Subcontractor payments",
};

// Minimum plan that unlocks each feature.
// 2026-08-14 (owner's call): every feature unlocked on every plan — plan-gating
// upsells removed app-wide. To restore gating, put the old minimums back
// (unlimited_proposals/ai_proposals/advanced_estimator/proposal_templates/
// follow_ups/csv_export: PROFESSIONAL · pdf_export: STARTER ·
// sms_notifications/multi_org/custom_domain/white_label: ENTERPRISE).
export const MINIMUM_PLAN_FOR: Record<Feature, Plan> = {
  unlimited_proposals: "FREE",
  ai_proposals: "FREE",
  advanced_estimator: "FREE",
  proposal_templates: "FREE",
  pdf_export: "FREE",
  follow_ups: "FREE",
  sms_notifications: "FREE",
  csv_export: "FREE",
  multi_org: "FREE",
  custom_domain: "FREE",
  white_label: "FREE",
  // The plan said paid plans; free with everything else under the 2026-08-14 call until the owner says otherwise.
  sub_payments: "FREE",
};

/** Texts a company sends each calendar month (UTC) within its plan (2026-09-24).
 *  At the allowance texting stops until the next month — a soft stop, nothing
 *  is billed (owner, 2026-10-26; lib/sms/send). */
export const SMS_ALLOWANCE: Record<Plan, number> = {
  FREE: 50,
  STARTER: 250,
  PROFESSIONAL: 1000,
  ENTERPRISE: 4000,
};
export function smsAllowanceFor(plan: Plan | string | null | undefined): number {
  // Subscription.plan as stored may be lower-case or "CUSTOM"; the custom plan
  // rides on Professional (lib/customPlan CUSTOM_PLAN_TIER).
  const upper = (plan ?? "FREE").toUpperCase();
  const tier = upper === "CUSTOM" ? "PROFESSIONAL" : upper;
  return SMS_ALLOWANCE[tier as Plan] ?? SMS_ALLOWANCE.FREE;
}

const RANK: Record<Plan, number> = {
  FREE: 0,
  STARTER: 1,
  PROFESSIONAL: 2,
  ENTERPRISE: 3,
};

export function hasFeature(plan: Plan | string | null | undefined, feature: Feature): boolean {
  const p = (plan as Plan) ?? "FREE";
  const required = MINIMUM_PLAN_FOR[feature];
  return (RANK[p] ?? 0) >= RANK[required];
}

export function requireFeatureOrThrow(plan: Plan | string | null | undefined, feature: Feature) {
  if (!hasFeature(plan, feature)) {
    const err = new Error(
      `${FEATURE_LABELS[feature]} requires the ${MINIMUM_PLAN_FOR[feature]} plan.`,
    );
    const gated = err as Error & { code?: string; feature?: Feature; requiredPlan?: Plan };
    gated.code = "FEATURE_GATED";
    gated.feature = feature;
    gated.requiredPlan = MINIMUM_PLAN_FOR[feature];
    throw err;
  }
}

// NOTE: the old sync `getOrgPlan(sub)` helper was removed — it couldn't resolve
// custom admin-created plan slugs (that needs a DB lookup) and was case-sensitive.
// Use getOrgPlanContext (planCatalogServer) or getOrgPlanById (orgPlan) instead.
