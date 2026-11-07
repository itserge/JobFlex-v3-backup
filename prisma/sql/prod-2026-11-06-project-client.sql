-- PRODUCTION SCHEMA, 2026-11-06 (b) — the client's project page and Files (lib/projectClient). Apply AFTER
-- prod-2026-11-06-project-finish.sql and BEFORE the deploy that reads these.
-- Project: the homeowner's link key, when it was shared, when the last update went out. JobPhoto.sharedAt: a photo
-- chosen for the client's page. ProjectFile: the contract, permits, plans, warranties — uploaded or linked.
-- Postgres (Neon).
--
-- ADDITIONS ONLY: one new table with its index and foreign key (ON DELETE CASCADE from Project), four nullable
-- columns and one unique index. No existing row is touched. Re-runnable.
--
-- Prisma names: quoted camelCase.

BEGIN;

ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "publicToken"  TEXT;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "sharedAt"     TIMESTAMP(3);
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "updateSentAt" TIMESTAMP(3);
CREATE UNIQUE INDEX IF NOT EXISTS "Project_publicToken_key" ON "Project" ("publicToken");

ALTER TABLE "JobPhoto" ADD COLUMN IF NOT EXISTS "sharedAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "ProjectFile" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId"      TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "kind"           TEXT NOT NULL DEFAULT 'OTHER',          -- CONTRACT | PERMIT | PLAN | WARRANTY | INVOICE | OTHER
  "url"            TEXT NOT NULL,
  "contentType"    TEXT,
  "bytes"          INTEGER,
  "isLink"         BOOLEAN NOT NULL DEFAULT false,
  "clientVisible"  BOOLEAN NOT NULL DEFAULT false,
  "uploadedById"   TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectFile_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ProjectFile_projectId_createdAt_idx" ON "ProjectFile" ("projectId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProjectFile_projectId_fkey') THEN
    ALTER TABLE "ProjectFile" ADD CONSTRAINT "ProjectFile_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
