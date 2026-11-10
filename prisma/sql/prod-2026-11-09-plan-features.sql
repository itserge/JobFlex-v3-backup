-- PRODUCTION DATA, 2026-11-09 — the plan cards' lines for the paid features (lib/customPlan PAID_FEATURES).
-- Postgres (Neon). Display only: what a plan opens is decided by the gate (lib/customPageAccess), never by this
-- text — apply it whenever the cards should print the lines; nothing breaks before or after.
--
-- ADDITIONS ONLY: two lines appended to the END of "PricingPlan"."features" (a JSON array kept as text) on the
-- sellable plans — Starter, Professional, Advanced (slug "enterprise") and Custom (slug "custom", when such a row
-- exists; the Custom card is otherwise drawn from code, lib/customPlan). No other column and no other line is
-- touched; a line already there is not added again, so the file is re-runnable.
--   "AI Operator & SmartBook"                 — SmartBook here books by text and email; its AI call stays with
--                                               "AI phone answering" on Advanced (lib/smartbook/engine).
--   "Projects: stages, buying & crew tools"
-- On Professional and Advanced they repeat what "Everything in …" already carries: the cards print each line once,
-- after Starter's own rows (lib/planCatalog expandPlanFeatures). Local mirror: prisma/plan-features.ts.
--
-- Before (read only) — every row must be a JSON array, or the cast below stops the transaction:
--   SELECT "slug", "features" FROM "PricingPlan" WHERE "slug" IN ('starter', 'professional', 'enterprise', 'custom') ORDER BY "order";

BEGIN;

UPDATE "PricingPlan"
SET "features" = ("features"::jsonb || '["AI Operator & SmartBook"]'::jsonb)::text,
    "updatedAt" = NOW()
WHERE "slug" IN ('starter', 'professional', 'enterprise', 'custom')
  AND jsonb_typeof("features"::jsonb) = 'array'
  AND NOT ("features"::jsonb ? 'AI Operator & SmartBook');

UPDATE "PricingPlan"
SET "features" = ("features"::jsonb || '["Projects: stages, buying & crew tools"]'::jsonb)::text,
    "updatedAt" = NOW()
WHERE "slug" IN ('starter', 'professional', 'enterprise', 'custom')
  AND jsonb_typeof("features"::jsonb) = 'array'
  AND NOT ("features"::jsonb ? 'Projects: stages, buying & crew tools');

COMMIT;

-- Check (read only): the last two elements of each plan's list.
--   SELECT "slug", ("features"::jsonb) -> -2 AS "second_last", ("features"::jsonb) -> -1 AS "last"
--   FROM "PricingPlan" WHERE "slug" IN ('starter', 'professional', 'enterprise', 'custom') ORDER BY "order";
--   → "AI Operator & SmartBook", "Projects: stages, buying & crew tools" on every row that exists.
