// THE SELLABLE PLANS' FEATURE LINES, AS PRODUCTION PRINTS THEM (read off jobflex.app/pricing, 2026-11-07). The seed
// creates the plans with these (prisma/seed.ts), and prisma/seed-plan-features.ts brings an existing LOCAL dev.db's
// lines back to them — so the plan cards' spotlight rows (lib/planSpotlight: Roof, HVAC and Fence estimators) are
// there to check locally. The Deck Studio "Add-on" line is drawn by the cards themselves, never a feature line.
// Display only: what a plan opens is read off the gates (lib/customPageAccess, lib/editions), not this text.

export const PLAN_FEATURES: Record<"starter" | "professional" | "enterprise", string[]> = {
  starter: ["Proposal management", "Client management", "CRM", "Calendar", "Workers management", "Financials", "Messages", "1 user"],
  professional: [
    "Everything in Starter",
    "Smart proposal generation",
    "Roof estimator",
    "Fence estimator",
    "HVAC estimator",
    "Blueprints estimator (coming soon)",
    "Up to 3 users",
  ],
  enterprise: ["Everything in Professional", "Video estimator", "AI phone answering", "Custom branding & domain", "Unlimited users"],
};
