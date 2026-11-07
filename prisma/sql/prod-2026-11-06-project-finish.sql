-- PRODUCTION SCHEMA, 2026-11-06 — the timeline, inspections and the finish line (lib/projectFinish). Apply
-- AFTER prod-2026-11-05-crew-field.sql and BEFORE the deploy that reads these.
-- ProjectInspection: an inspection on a project (its day, what to have ready, pass/fail). PunchItem: a punch-list
-- item, with its "after" photo. Project: the client's sign-off, the warranty's last day, the finish day.
-- Postgres (Neon).
--
-- ADDITIONS ONLY: two new tables with their indexes and foreign keys (ON DELETE CASCADE from Project; SET NULL
-- from a stage, a job or a photo that goes), four nullable columns. No existing row is touched. Re-runnable.
--
-- Prisma names: quoted camelCase.

BEGIN;

ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "signedOffAt"   TIMESTAMP(3);
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "signedOffBy"   TEXT;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "warrantyUntil" TIMESTAMP(3);
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "finishedAt"    TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "ProjectInspection" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId"      TEXT NOT NULL,
  "stageId"        TEXT,
  "name"           TEXT NOT NULL,
  "date"           TIMESTAMP(3),                         -- the day, UTC midnight
  "readyNote"      TEXT,
  "isFinal"        BOOLEAN NOT NULL DEFAULT false,
  "result"         TEXT NOT NULL DEFAULT 'PENDING',      -- PENDING | PASSED | FAILED
  "resultNote"     TEXT,
  "resultAt"       TIMESTAMP(3),
  "resultById"     TEXT,
  "createdById"    TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectInspection_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ProjectInspection_projectId_date_idx" ON "ProjectInspection" ("projectId", "date");
CREATE INDEX IF NOT EXISTS "ProjectInspection_organizationId_date_idx" ON "ProjectInspection" ("organizationId", "date");

CREATE TABLE IF NOT EXISTS "PunchItem" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId"      TEXT NOT NULL,
  "jobId"          TEXT,
  "note"           TEXT NOT NULL,
  "position"       INTEGER NOT NULL DEFAULT 0,
  "doneAt"         TIMESTAMP(3),
  "doneById"       TEXT,
  "photoId"        TEXT,
  "createdById"    TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PunchItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PunchItem_photoId_key" ON "PunchItem" ("photoId");
CREATE INDEX IF NOT EXISTS "PunchItem_projectId_position_idx" ON "PunchItem" ("projectId", "position");
CREATE INDEX IF NOT EXISTS "PunchItem_jobId_idx" ON "PunchItem" ("jobId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProjectInspection_projectId_fkey') THEN
    ALTER TABLE "ProjectInspection" ADD CONSTRAINT "ProjectInspection_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProjectInspection_stageId_fkey') THEN
    ALTER TABLE "ProjectInspection" ADD CONSTRAINT "ProjectInspection_stageId_fkey"
      FOREIGN KEY ("stageId") REFERENCES "ProjectStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PunchItem_projectId_fkey') THEN
    ALTER TABLE "PunchItem" ADD CONSTRAINT "PunchItem_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PunchItem_jobId_fkey') THEN
    ALTER TABLE "PunchItem" ADD CONSTRAINT "PunchItem_jobId_fkey"
      FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PunchItem_photoId_fkey') THEN
    ALTER TABLE "PunchItem" ADD CONSTRAINT "PunchItem_photoId_fkey"
      FOREIGN KEY ("photoId") REFERENCES "JobPhoto"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
