-- PRODUCTION SCHEMA, 2026-11-07 (f) — Draws (lib/projectDraws), part 6 of the plan "Projects: Remodel and New
-- construction". Apply AFTER prod-2026-11-07-project-phases.sql (a draw follows a phase) and BEFORE the deploy that
-- reads these. It does not depend on part 5's file.
-- ProjectDraw: a lender's draw on a new build — its number and name, the phase whose close releases it, its percent
-- and dollars, planned → requested → funded with the days, the retainage held back, and the bundle sent with the
-- request (the inspections passed, the photos, % done, what was spent) as JSON.
-- Postgres (Neon).
--
-- ADDITIONS ONLY: one new table with its indexes and foreign keys (ON DELETE CASCADE from Project, SET NULL from
-- ProjectPhase). No existing row is touched. Re-runnable.
--
-- Prisma names: quoted camelCase.

BEGIN;

CREATE TABLE IF NOT EXISTS "ProjectDraw" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId"      TEXT NOT NULL,
  "phaseId"        TEXT,
  "afterPhase"     TEXT,
  "number"         INTEGER NOT NULL DEFAULT 1,
  "name"           TEXT NOT NULL,
  "pct"            DOUBLE PRECISION NOT NULL DEFAULT 0,
  "amount"         DOUBLE PRECISION NOT NULL DEFAULT 0,
  "status"         TEXT NOT NULL DEFAULT 'PLANNED',
  "retainagePct"   DOUBLE PRECISION NOT NULL DEFAULT 10,
  "requestedAt"    TIMESTAMP(3),
  "fundedAt"       TIMESTAMP(3),
  "fundedAmount"   DOUBLE PRECISION,
  "snapshotJson"   TEXT,
  "note"           TEXT,
  "createdById"    TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectDraw_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ProjectDraw_projectId_number_idx" ON "ProjectDraw" ("projectId", "number");
DO $$ BEGIN
  ALTER TABLE "ProjectDraw" ADD CONSTRAINT "ProjectDraw_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ProjectDraw" ADD CONSTRAINT "ProjectDraw_phaseId_fkey"
    FOREIGN KEY ("phaseId") REFERENCES "ProjectPhase" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;
