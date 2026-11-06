-- PRODUCTION SCHEMA, 2026-11-05 — stages and tasks of a project (lib/projectStages).
-- ProjectStage: the order of work on a project ("Footings", "Framing"), from a trade template or drafted by the
-- AI. ProjectTask: the tasks inside a stage, ticked on the desk or the crew's phone. Project.number: the
-- project's own number per company (#1042). Project.stagesDraftedAt: AI-drafted stages nobody has kept yet.
-- Organization.projectSettingsJson: the Automatic projects switch and its trades.
-- Postgres (Neon). Apply BEFORE the deploy that reads them: the project page, the list and the Operator read
-- these.
--
-- ADDITIONS ONLY: two new tables with their indexes and foreign keys (ON DELETE CASCADE from Project, so an
-- archived-and-purged project takes its stages with it), three nullable columns, one unique index. The only rows
-- touched are the one-time numbering of existing projects (each company's projects in the order they were made,
-- from 1001), which fills a column that was null. Re-runnable: every statement is IF NOT EXISTS or guarded; the
-- numbering only touches rows still null.
--
-- Prisma names: quoted camelCase.

BEGIN;

ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "number" INTEGER;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "stagesDraftedAt" TIMESTAMP(3);
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "projectSettingsJson" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Project_organizationId_number_key" ON "Project" ("organizationId", "number");

CREATE TABLE IF NOT EXISTS "ProjectStage" (
  "id"        TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "position"  INTEGER NOT NULL DEFAULT 0,
  "status"    TEXT NOT NULL DEFAULT 'PLANNED',          -- PLANNED | ACTIVE | DONE
  "startsAt"  TIMESTAMP(3),
  "endsAt"    TIMESTAMP(3),
  "doneAt"    TIMESTAMP(3),
  "doneById"  TEXT,
  "weight"    DOUBLE PRECISION NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectStage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ProjectStage_projectId_position_idx" ON "ProjectStage" ("projectId", "position");

CREATE TABLE IF NOT EXISTS "ProjectTask" (
  "id"          TEXT NOT NULL,
  "projectId"   TEXT NOT NULL,
  "stageId"     TEXT NOT NULL,
  "title"       TEXT NOT NULL,
  "position"    INTEGER NOT NULL DEFAULT 0,
  "photoNeeded" BOOLEAN NOT NULL DEFAULT false,
  "doneAt"      TIMESTAMP(3),
  "doneById"    TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectTask_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ProjectTask_stageId_position_idx" ON "ProjectTask" ("stageId", "position");
CREATE INDEX IF NOT EXISTS "ProjectTask_projectId_idx" ON "ProjectTask" ("projectId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProjectStage_projectId_fkey') THEN
    ALTER TABLE "ProjectStage" ADD CONSTRAINT "ProjectStage_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProjectTask_projectId_fkey') THEN
    ALTER TABLE "ProjectTask" ADD CONSTRAINT "ProjectTask_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProjectTask_stageId_fkey') THEN
    ALTER TABLE "ProjectTask" ADD CONSTRAINT "ProjectTask_stageId_fkey"
      FOREIGN KEY ("stageId") REFERENCES "ProjectStage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- The one-time numbering: each company's existing projects, oldest first, from 1001. New projects count on from
-- the company's highest number (lib/projectStages/server nextProjectNumber).
UPDATE "Project" AS p
SET "number" = n.rn + 1000
FROM (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "organizationId" ORDER BY "createdAt", "id") AS rn
  FROM "Project"
  WHERE "number" IS NULL
) AS n
WHERE p."id" = n."id"
  AND p."number" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "Project" q WHERE q."organizationId" = p."organizationId" AND q."number" IS NOT NULL);

COMMIT;
