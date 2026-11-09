-- PRODUCTION SCHEMA, 2026-11-08 — the subcontractors plan, part 4 (lib/subContracts): the subcontract drafted from an
-- awarded quote, signed by the sub on its own page, and its change orders.
-- Apply BEFORE the deploy that reads these.
-- Postgres (Neon).
--
-- ADDITIONS ONLY: two new tables (Subcontract, SubcontractChangeOrder) with their indexes and foreign keys (ON DELETE
-- CASCADE from Organization, Project, Contractor and the quote; SET NULL on the optional links). No existing table
-- changes. Re-runnable: every statement guards itself.
--
-- Prisma names: quoted camelCase.

BEGIN;

-- ── Subcontract ──
CREATE TABLE IF NOT EXISTS "Subcontract" (
  "id"                TEXT NOT NULL,
  "organizationId"    TEXT NOT NULL,
  "projectId"         TEXT NOT NULL,
  "stageId"           TEXT,
  "contractorId"      TEXT NOT NULL,
  "quoteId"           TEXT NOT NULL,
  "versionId"         TEXT,
  "number"            INTEGER NOT NULL,
  "status"            TEXT NOT NULL DEFAULT 'DRAFT',
  "title"             TEXT NOT NULL,
  "amount"            DOUBLE PRECISION NOT NULL,
  "scope"             TEXT NOT NULL,
  "startsAt"          TIMESTAMP(3),
  "endsAt"            TIMESTAMP(3),
  "depositPct"        DOUBLE PRECISION,
  "milestonesJson"    TEXT NOT NULL DEFAULT '[]',
  "terms"             TEXT NOT NULL,
  "attachmentIdsJson" TEXT NOT NULL DEFAULT '[]',
  "publicToken"       TEXT NOT NULL,
  "sentAt"            TIMESTAMP(3),
  "viewedAt"          TIMESTAMP(3),
  "companySignedName" TEXT,
  "companySignedAt"   TIMESTAMP(3),
  "companySignedById" TEXT,
  "signedName"        TEXT,
  "signedAt"          TIMESTAMP(3),
  "signedIp"          TEXT,
  "signedUserAgent"   TEXT,
  "executedAt"        TIMESTAMP(3),
  "cancelledAt"       TIMESTAMP(3),
  "cancelReason"      TEXT,
  "pdfDocumentId"     TEXT,
  "createdById"       TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Subcontract_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Subcontract_publicToken_key" ON "Subcontract" ("publicToken");
CREATE UNIQUE INDEX IF NOT EXISTS "Subcontract_organizationId_number_key" ON "Subcontract" ("organizationId", "number");
CREATE INDEX IF NOT EXISTS "Subcontract_projectId_status_idx" ON "Subcontract" ("projectId", "status");
CREATE INDEX IF NOT EXISTS "Subcontract_organizationId_status_idx" ON "Subcontract" ("organizationId", "status");
CREATE INDEX IF NOT EXISTS "Subcontract_quoteId_idx" ON "Subcontract" ("quoteId");

-- ── SubcontractChangeOrder ──
CREATE TABLE IF NOT EXISTS "SubcontractChangeOrder" (
  "id"               TEXT NOT NULL,
  "organizationId"   TEXT NOT NULL,
  "contractId"       TEXT NOT NULL,
  "number"           INTEGER NOT NULL,
  "status"           TEXT NOT NULL DEFAULT 'PROPOSED',
  "amount"           DOUBLE PRECISION NOT NULL,
  "scope"            TEXT NOT NULL,
  "reason"           TEXT,
  "proposedById"     TEXT,
  "proposedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decidedAt"        TIMESTAMP(3),
  "decidedName"      TEXT,
  "decidedIp"        TEXT,
  "decidedUserAgent" TEXT,
  "decidedVia"       TEXT,
  "declineReason"    TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SubcontractChangeOrder_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "SubcontractChangeOrder_contractId_status_idx" ON "SubcontractChangeOrder" ("contractId", "status");
CREATE INDEX IF NOT EXISTS "SubcontractChangeOrder_organizationId_status_idx" ON "SubcontractChangeOrder" ("organizationId", "status");

-- ── foreign keys ──
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Subcontract_organizationId_fkey') THEN
    ALTER TABLE "Subcontract" ADD CONSTRAINT "Subcontract_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Subcontract_projectId_fkey') THEN
    ALTER TABLE "Subcontract" ADD CONSTRAINT "Subcontract_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Subcontract_stageId_fkey') THEN
    ALTER TABLE "Subcontract" ADD CONSTRAINT "Subcontract_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "ProjectStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Subcontract_contractorId_fkey') THEN
    ALTER TABLE "Subcontract" ADD CONSTRAINT "Subcontract_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Subcontract_quoteId_fkey') THEN
    ALTER TABLE "Subcontract" ADD CONSTRAINT "Subcontract_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "ProjectSubQuote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Subcontract_versionId_fkey') THEN
    ALTER TABLE "Subcontract" ADD CONSTRAINT "Subcontract_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "SubQuoteVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Subcontract_pdfDocumentId_fkey') THEN
    ALTER TABLE "Subcontract" ADD CONSTRAINT "Subcontract_pdfDocumentId_fkey" FOREIGN KEY ("pdfDocumentId") REFERENCES "SubDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SubcontractChangeOrder_contractId_fkey') THEN
    ALTER TABLE "SubcontractChangeOrder" ADD CONSTRAINT "SubcontractChangeOrder_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Subcontract"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
