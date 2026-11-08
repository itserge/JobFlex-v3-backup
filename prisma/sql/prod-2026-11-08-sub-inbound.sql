-- PRODUCTION SCHEMA, 2026-11-08 — the subcontractors plan, part 2 (lib/subInbound, lib/subQuotes): quotes that come
-- in by email, the AI's read of each estimate, the comparison words on a request, and the one deadline reminder.
-- Apply BEFORE the deploy that reads these.
-- Postgres (Neon).
--
-- ADDITIONS ONLY: nullable or defaulted columns on four existing tables, one new table (InboundEmail) with its
-- indexes and foreign keys (ON DELETE CASCADE from Organization, SET NULL on the optional links). No backfill: nothing
-- existing changes meaning. Re-runnable: every statement guards itself.
--
-- Prisma names: quoted camelCase.

BEGIN;

-- ── ProjectSubQuote: the reminder stamp ──
ALTER TABLE "ProjectSubQuote" ADD COLUMN IF NOT EXISTS "remindedAt" TIMESTAMP(3);

-- ── SubRequest: the AI's comparison ──
ALTER TABLE "SubRequest" ADD COLUMN IF NOT EXISTS "compareJson" TEXT;
ALTER TABLE "SubRequest" ADD COLUMN IF NOT EXISTS "comparedAt"  TIMESTAMP(3);

-- ── SubQuoteVersion: the reader's bookkeeping ──
ALTER TABLE "SubQuoteVersion" ADD COLUMN IF NOT EXISTS "readAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "SubQuoteVersion" ADD COLUMN IF NOT EXISTS "readError"    TEXT;

-- ── SubDocument: the email it came in ──
ALTER TABLE "SubDocument" ADD COLUMN IF NOT EXISTS "inboundEmailId" TEXT;
CREATE INDEX IF NOT EXISTS "SubDocument_inboundEmailId_idx" ON "SubDocument" ("inboundEmailId");

-- ── InboundEmail ──
CREATE TABLE IF NOT EXISTS "InboundEmail" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT,
  "providerId"     TEXT NOT NULL,
  "fromAddr"       TEXT NOT NULL,
  "toJson"         TEXT NOT NULL,
  "subject"        TEXT,
  "messageId"      TEXT,
  "text"           TEXT,
  "rawUrl"         TEXT,
  "receivedAt"     TIMESTAMP(3) NOT NULL,
  "quoteId"        TEXT,
  "requestId"      TEXT,
  "versionId"      TEXT,
  "state"          TEXT NOT NULL DEFAULT 'REVIEW',
  "note"           TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InboundEmail_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "InboundEmail_providerId_key" ON "InboundEmail" ("providerId");
CREATE INDEX IF NOT EXISTS "InboundEmail_organizationId_state_receivedAt_idx" ON "InboundEmail" ("organizationId", "state", "receivedAt");
CREATE INDEX IF NOT EXISTS "InboundEmail_quoteId_idx" ON "InboundEmail" ("quoteId");

-- ── foreign keys ──
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'InboundEmail_organizationId_fkey') THEN
    ALTER TABLE "InboundEmail" ADD CONSTRAINT "InboundEmail_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'InboundEmail_quoteId_fkey') THEN
    ALTER TABLE "InboundEmail" ADD CONSTRAINT "InboundEmail_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "ProjectSubQuote"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SubDocument_inboundEmailId_fkey') THEN
    ALTER TABLE "SubDocument" ADD CONSTRAINT "SubDocument_inboundEmailId_fkey" FOREIGN KEY ("inboundEmailId") REFERENCES "InboundEmail"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
