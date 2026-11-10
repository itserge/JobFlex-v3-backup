-- PRODUCTION SCHEMA, 2026-11-08 (c) — Smart CRM part 3: the Pipeline. DealState keeps only what a person set on a
-- board card (a dragged stage, owner, expected close, lost reason); the board itself is worked out from leads and
-- proposals (lib/pipeline). Apply BEFORE the deploy that reads it. Postgres (Neon).
--
-- ADDITIONS ONLY: one new table with its index and foreign key (ON DELETE CASCADE from Organization). No existing
-- row or column is touched. Re-runnable.

BEGIN;

CREATE TABLE IF NOT EXISTS "DealState" (
  "key"            TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "stage"          TEXT,
  "stageAt"        TIMESTAMP(3),
  "ownerId"        TEXT,
  "expectedClose"  TIMESTAMP(3),
  "lostReason"     TEXT,
  "movedById"      TEXT,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DealState_pkey" PRIMARY KEY ("key")
);
CREATE INDEX IF NOT EXISTS "DealState_organizationId_idx" ON "DealState"("organizationId");

DO $$ BEGIN
  ALTER TABLE "DealState" ADD CONSTRAINT "DealState_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;
