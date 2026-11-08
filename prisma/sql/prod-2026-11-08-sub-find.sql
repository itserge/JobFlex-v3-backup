-- PRODUCTION SCHEMA, 2026-11-08 — the subcontractors plan, part 3 (lib/subFinder): Find — the state register's word
-- on a saved sub, and the company's JobFlex Network opt-in. Apply BEFORE the deploy that reads these.
-- Postgres (Neon).
--
-- ADDITIONS ONLY: three nullable columns. No backfill. Re-runnable.
-- Prisma names: quoted camelCase.

BEGIN;

ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "networkJson"       TEXT;
ALTER TABLE "Contractor"   ADD COLUMN IF NOT EXISTS "registerJson"      TEXT;
ALTER TABLE "Contractor"   ADD COLUMN IF NOT EXISTS "registerCheckedAt" TIMESTAMP(3);

COMMIT;
