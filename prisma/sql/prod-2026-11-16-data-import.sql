-- PRODUCTION SCHEMA, 2026-11-16 — bringing a contractor's book over from another program (Housecall Pro, Jobber,
-- ServiceTitan, QuickBooks, a spreadsheet; lib/import). One DataImport row per import (for "Undo this import"),
-- ClientHistory for each client's past jobs, invoices and estimates from that program, and on Client, Job and
-- Invoice the import that made the row (importId) and its number in the other program (importKey).
-- Apply BEFORE the deploy that reads it. Postgres (Neon).
--
-- ADDITIONS ONLY: two new tables, six nullable columns, their indexes and foreign keys. No existing row is changed;
-- the code live today never names any of these. Re-runnable.

BEGIN;

CREATE TABLE IF NOT EXISTS "DataImport" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "byUserId"       TEXT,
  "source"         TEXT NOT NULL,
  "status"         TEXT NOT NULL DEFAULT 'RUNNING',
  "filesJson"      TEXT,
  "countsJson"     TEXT,
  "filledJson"     TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "undoneAt"       TIMESTAMP(3),
  CONSTRAINT "DataImport_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "DataImport_organizationId_createdAt_idx" ON "DataImport" ("organizationId", "createdAt");

CREATE TABLE IF NOT EXISTS "ClientHistory" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "clientId"       TEXT NOT NULL,
  "importId"       TEXT,
  "importKey"      TEXT,
  "kind"           TEXT NOT NULL,
  "number"         TEXT,
  "title"          TEXT NOT NULL,
  "status"         TEXT,
  "amount"         DOUBLE PRECISION,
  "paid"           DOUBLE PRECISION,
  "due"            DOUBLE PRECISION,
  "date"           TIMESTAMP(3),
  "by"             TEXT,
  "notes"          TEXT,
  "source"         TEXT NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClientHistory_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ClientHistory_organizationId_clientId_date_idx" ON "ClientHistory" ("organizationId", "clientId", "date");
CREATE INDEX IF NOT EXISTS "ClientHistory_importId_idx" ON "ClientHistory" ("importId");
CREATE INDEX IF NOT EXISTS "ClientHistory_organizationId_importKey_idx" ON "ClientHistory" ("organizationId", "importKey");

ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "importId"  TEXT;
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "importKey" TEXT;
CREATE INDEX IF NOT EXISTS "Client_importId_idx" ON "Client" ("importId");
CREATE INDEX IF NOT EXISTS "Client_organizationId_importKey_idx" ON "Client" ("organizationId", "importKey");

ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "importId"  TEXT;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "importKey" TEXT;
CREATE INDEX IF NOT EXISTS "Job_importId_idx" ON "Job" ("importId");
CREATE INDEX IF NOT EXISTS "Job_organizationId_importKey_idx" ON "Job" ("organizationId", "importKey");

ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "importId"  TEXT;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "importKey" TEXT;
CREATE INDEX IF NOT EXISTS "Invoice_importId_idx" ON "Invoice" ("importId");
CREATE INDEX IF NOT EXISTS "Invoice_organizationId_importKey_idx" ON "Invoice" ("organizationId", "importKey");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DataImport_organizationId_fkey') THEN
    ALTER TABLE "DataImport" ADD CONSTRAINT "DataImport_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ClientHistory_organizationId_fkey') THEN
    ALTER TABLE "ClientHistory" ADD CONSTRAINT "ClientHistory_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ClientHistory_clientId_fkey') THEN
    ALTER TABLE "ClientHistory" ADD CONSTRAINT "ClientHistory_clientId_fkey"
      FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
