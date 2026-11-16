-- PRODUCTION SCHEMA, 2026-11-16 — "Do it for me" (CRM migration plan part 4; lib/import/requests, requestServer):
-- a contractor sends the files their old program exported and a platform admin brings them in for the company
-- (Admin → Imports). One row per request. Apply BEFORE the deploy that reads it. Postgres (Neon).
--
-- ADDITIONS ONLY: one new table, its indexes and its foreign key. No existing row or column is changed; the code live
-- today never names it. Re-runnable.

BEGIN;

CREATE TABLE IF NOT EXISTS "ImportRequest" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "byUserId"       TEXT,
  "source"         TEXT NOT NULL,
  "note"           TEXT,
  "filesJson"      TEXT NOT NULL,
  "status"         TEXT NOT NULL DEFAULT 'NEW',
  "workerId"       TEXT,
  "importId"       TEXT,
  "reason"         TEXT,
  "dueAt"          TIMESTAMP(3) NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "doneAt"         TIMESTAMP(3),
  "filesDeletedAt" TIMESTAMP(3),
  CONSTRAINT "ImportRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ImportRequest_organizationId_createdAt_idx" ON "ImportRequest" ("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "ImportRequest_status_dueAt_idx" ON "ImportRequest" ("status", "dueAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ImportRequest_organizationId_fkey') THEN
    ALTER TABLE "ImportRequest" ADD CONSTRAINT "ImportRequest_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
