-- PRODUCTION SCHEMA, 2026-11-08 — the lender's page (part 7 of the plan "Projects: Remodel and New construction",
-- lib/projectClient). Apply BEFORE the deploy that reads these.
-- Project: the lender's read-only link key (/l/<token>) and when it was made.
-- Postgres (Neon).
--
-- ADDITIONS ONLY: two nullable columns and one unique index. No existing row is touched. Re-runnable.
--
-- Prisma names: quoted camelCase.

BEGIN;

ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "lenderToken"    TEXT;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "lenderSharedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX IF NOT EXISTS "Project_lenderToken_key" ON "Project" ("lenderToken");

COMMIT;
