// THE SELLABLE PLANS' FEATURE LINES, AS PRODUCTION PRINTS THEM (read off jobflex.app/pricing, 2026-11-07). The seed
// creates the plans with these (prisma/seed.ts), and prisma/seed-plan-features.ts brings an existing LOCAL dev.db's
// lines back to them — so the plan cards' spotlight rows (lib/planSpotlight: Roof, HVAC and Fence estimators) are
// there to check locally. The Deck Studio "Add-on" line is drawn by the cards themselves, never a feature line.
// Display only: what a plan opens is read off the gates (lib/customPageAccess, lib/editions), not this text.

/** The paid features' lines (owner, 2026-11-09): SmartBook here is the text-and-email booking — its call stays with
 *  "AI phone answering" on Advanced (lib/smartbook/engine smartBookCallOnPlan). */
export const PAID_LINES = ["AI Operator & SmartBook", "Projects: stages, buying & crew tools"] as const;

export const PLAN_FEATURES: Record<"starter" | "professional" | "enterprise", string[]> = {
  // The paid features' two lines (owner, 2026-11-09; lib/customPlan PAID_FEATURES), added at the END of every sellable
  // plan's list — on Professional and Advanced they repeat what "Everything in" already carries, so the cards print
  // them once, after Starter's rows. Production gets them from prisma/sql/prod-2026-11-09-plan-features.sql.
  starter: ["Proposal management", "Client management", "CRM", "Calendar", "Workers management", "Financials", "Messages", "1 user", ...PAID_LINES],
  professional: [
    "Everything in Starter",
    "Smart proposal generation",
    "Roof estimator",
    "Fence estimator",
    "HVAC estimator",
    "Blueprints estimator (coming soon)",
    "Up to 3 users",
    ...PAID_LINES,
  ],
  enterprise: ["Everything in Professional", "Video estimator", "AI phone answering", "Custom branding & domain", "Unlimited users", ...PAID_LINES],
};
