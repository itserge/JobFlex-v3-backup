-- PRODUCTION SCHEMA, 2026-11-07 (c) — Selections and gates (lib/projectSelections, lib/projectGates), part 3 of the
-- plan "Projects: Remodel and New construction". Apply AFTER prod-2026-11-07-project-kind.sql and
-- prod-2026-11-07-project-contractors.sql (or on its own — it depends on neither) and BEFORE the deploy that reads these.
-- ProjectSelection: what the client has to choose (cabinets, counters, tile…), the stage that needs it, its lead time,
-- the allowance, and what was chosen. ProjectInspection gains `kind` (the inspection's key — FRAMING, ROUGH_IN,
-- FINAL…) and `gate` (it holds its stage: the stage cannot be marked done until it passes).
-- Postgres (Neon).
--
-- ADDITIONS ONLY: one new table with its indexes and foreign keys (ON DELETE CASCADE from Project; SET NULL from
-- ProjectStage) and two columns on ProjectInspection with defaults (every existing inspection keeps kind NULL and
-- gate false, so nothing already live starts holding a stage). No existing row is touched otherwise. Re-runnable.
--
-- Prisma names: quoted camelCase.

BEGIN;

ALTER TABLE "ProjectInspection" ADD COLUMN IF NOT EXISTS "kind" TEXT;
ALTER TABLE "ProjectInspection" ADD COLUMN IF NOT EXISTS "gate" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "ProjectSelection" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId"      TEXT NOT NULL,
  "stageId"        TEXT,
  "name"           TEXT NOT NULL,
  "leadDays"       INTEGER NOT NULL DEFAULT 14,
  "dueBy"          TIMESTAMP(3),
  "allowance"      DOUBLE PRECISION,
  "chosen"         TEXT,
  "vendor"         TEXT,
  "price"          DOUBLE PRECISION,
  "chosenAt"       TIMESTAMP(3),
  "chosenById"     TEXT,
  "note"           TEXT,
  "position"       INTEGER NOT NULL DEFAULT 0,
  "createdById"    TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectSelection_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ProjectSelection_projectId_position_idx" ON "ProjectSelection" ("projectId", "position");
CREATE INDEX IF NOT EXISTS "ProjectSelection_organizationId_idx" ON "ProjectSelection" ("organizationId");
DO $$ BEGIN
  ALTER TABLE "ProjectSelection" ADD CONSTRAINT "ProjectSelection_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ProjectSelection" ADD CONSTRAINT "ProjectSelection_stageId_fkey"
    FOREIGN KEY ("stageId") REFERENCES "ProjectStage" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;
