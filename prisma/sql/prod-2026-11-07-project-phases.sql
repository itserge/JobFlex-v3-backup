-- PRODUCTION SCHEMA, 2026-11-07 (d) — New construction: the phases (lib/projectPhases), part 4 of the plan "Projects:
-- Remodel and New construction". Apply AFTER prod-2026-11-07-project-selections.sql (it depends on none of the
-- earlier files, but the deploy that reads it also reads those) and BEFORE the deploy that reads these.
-- ProjectPhase: the ten phases of a new build (land → design → permits → site work → foundation → framing and dry-in →
-- rough-ins → insulation and drywall → finishes → final and keys, plus a Shop lane), each with its share and its gate;
-- `budget` and `margin` are filled by part 5 (the money). ProjectStage gains the phase it belongs to, the lane it is
-- drawn in, and the stage it cannot start before (Shift the rest moves only what depends on the slipped stage).
-- Project gains the lot's record (the parcel, the utilities, the permits with their numbers) as JSON.
-- Postgres (Neon).
--
-- ADDITIONS ONLY: one new table with its indexes and foreign keys (ON DELETE CASCADE from Project), three nullable
-- columns on ProjectStage (SET NULL foreign keys to ProjectPhase and to ProjectStage itself) and one nullable column on
-- Project. No existing row is touched. Re-runnable.
--
-- Prisma names: quoted camelCase.

BEGIN;

CREATE TABLE IF NOT EXISTS "ProjectPhase" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId"      TEXT NOT NULL,
  "key"            TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "position"       INTEGER NOT NULL DEFAULT 0,
  "share"          DOUBLE PRECISION NOT NULL DEFAULT 0,
  "gateKind"       TEXT NOT NULL DEFAULT 'CLIENT',
  "gateWords"      TEXT,
  "lane"           TEXT,
  "leadsJson"      TEXT,
  "budget"         DOUBLE PRECISION,
  "margin"         DOUBLE PRECISION,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectPhase_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ProjectPhase_projectId_position_idx" ON "ProjectPhase" ("projectId", "position");
DO $$ BEGIN
  ALTER TABLE "ProjectPhase" ADD CONSTRAINT "ProjectPhase_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "ProjectStage" ADD COLUMN IF NOT EXISTS "phaseId" TEXT;
ALTER TABLE "ProjectStage" ADD COLUMN IF NOT EXISTS "lane" TEXT;
ALTER TABLE "ProjectStage" ADD COLUMN IF NOT EXISTS "afterId" TEXT;
CREATE INDEX IF NOT EXISTS "ProjectStage_phaseId_idx" ON "ProjectStage" ("phaseId");
DO $$ BEGIN
  ALTER TABLE "ProjectStage" ADD CONSTRAINT "ProjectStage_phaseId_fkey"
    FOREIGN KEY ("phaseId") REFERENCES "ProjectPhase" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ProjectStage" ADD CONSTRAINT "ProjectStage_afterId_fkey"
    FOREIGN KEY ("afterId") REFERENCES "ProjectStage" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "lotJson" TEXT;

COMMIT;
