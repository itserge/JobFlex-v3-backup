-- THE PROPOSAL ROW AND SALES COMMISSION (2026-11-10, the ProSmart gaps plan, part 4) — production (Neon Postgres).
-- A member's commission percent; a proposal's own frozen percent, its cancelled-after-sold date and reason, and the
-- "call the rep first" flag. Additive and re-runnable: every column is guarded; existing rows read as no commission,
-- not cancelled, no call-first. Written from `prisma migrate diff` (origin/main → this branch's production schema).
BEGIN;

ALTER TABLE "Membership" ADD COLUMN IF NOT EXISTS "commissionPct" DOUBLE PRECISION;

ALTER TABLE "Proposal" ADD COLUMN IF NOT EXISTS "commissionPct" DOUBLE PRECISION;
ALTER TABLE "Proposal" ADD COLUMN IF NOT EXISTS "canceledAt" TIMESTAMP(3);
ALTER TABLE "Proposal" ADD COLUMN IF NOT EXISTS "cancelReason" TEXT;
ALTER TABLE "Proposal" ADD COLUMN IF NOT EXISTS "callRepFirst" BOOLEAN NOT NULL DEFAULT false;

COMMIT;
