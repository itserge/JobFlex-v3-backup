-- PRODUCTION SCHEMA, 2026-11-07 (e) — Who it is for, and the money (lib/projectMoneyPlan), part 5 of the plan
-- "Projects: Remodel and New construction". Apply AFTER prod-2026-11-07-project-phases.sql (the phase columns below
-- point at ProjectPhase) and BEFORE the deploy that reads these.
-- Project: who the build is for (CLIENT | SELF), how the money is made (PROJECT_MARGIN | JOB_MARGIN | COST_PLUS |
-- NONE), the margin or fee, and a spec house's sale price. ProjectExpense: the phase a cost belongs to, so spent reads per phase
-- (a phase's budget lives on ProjectPhase.budget, laid out from the total by the phases' shares).
-- Postgres (Neon).
--
-- ADDITIONS ONLY: five nullable columns on Project (two with defaults every existing project keeps: for a client, no
-- margin mode), one nullable column with a SET NULL foreign key on ProjectExpense. No existing
-- row is touched. Re-runnable.
--
-- Prisma names: quoted camelCase.

BEGIN;

ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "forWhom" TEXT NOT NULL DEFAULT 'CLIENT';
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "moneyMode" TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "marginPct" DOUBLE PRECISION;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "feeAmount" DOUBLE PRECISION;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "salePrice" DOUBLE PRECISION;

ALTER TABLE "ProjectExpense" ADD COLUMN IF NOT EXISTS "phaseId" TEXT;
CREATE INDEX IF NOT EXISTS "ProjectExpense_phaseId_idx" ON "ProjectExpense" ("phaseId");
DO $$ BEGIN
  ALTER TABLE "ProjectExpense" ADD CONSTRAINT "ProjectExpense_phaseId_fkey"
    FOREIGN KEY ("phaseId") REFERENCES "ProjectPhase" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;
