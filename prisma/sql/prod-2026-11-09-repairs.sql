-- REPAIRS AND COME-BACKS (2026-11-09, the ProSmart gaps plan, part 2) — production (Neon Postgres).
-- A repair is a real crew job (Job.kind = 'REPAIR') linked to the job that came back (Job.repairOfId), with its
-- reasons, why it came back, and who pays. Additive and re-runnable: every column, index and key is guarded, and the
-- defaults leave every existing job as ordinary work ('WORK', not billable). Written from `prisma migrate diff`
-- (origin/main → this branch's schema.production.prisma).
BEGIN;

ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'WORK';
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "repairOfId" TEXT;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "repairReasons" TEXT;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "repairCause" TEXT;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "repairBillable" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "repairCharge" DOUBLE PRECISION;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "repairChangeOrderId" TEXT;

CREATE INDEX IF NOT EXISTS "Job_repairOfId_idx" ON "Job"("repairOfId");
CREATE INDEX IF NOT EXISTS "Job_organizationId_kind_idx" ON "Job"("organizationId", "kind");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Job_repairOfId_fkey') THEN
    ALTER TABLE "Job" ADD CONSTRAINT "Job_repairOfId_fkey" FOREIGN KEY ("repairOfId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
