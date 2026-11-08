-- PRODUCTION SCHEMA, 2026-11-08 — the subcontractors plan, part 1 (lib/projectSubs, lib/subDocs): the directory's
-- profile fields on Contractor, the request stamps and version pointers on ProjectSubQuote, and three new tables —
-- SubRequest (the RFQ), SubQuoteVersion (every price a sub sent), SubDocument (the estimates and other files in the
-- private store). Apply BEFORE the deploy that reads these.
-- Postgres (Neon).
--
-- ADDITIONS ONLY: nullable or defaulted columns, three new tables with their indexes and foreign keys (ON DELETE
-- CASCADE from Organization and Project, SET NULL on the optional links). Then a ONE-TIME BACKFILL that gives every
-- existing quote row a request of its own (numbered per company from 1001 in the order they were asked) and a
-- version 1 where a price was sent — inserts and updates of empty columns only; no existing value is changed.
-- Re-runnable: every statement guards itself.
--
-- Prisma names: quoted camelCase.

BEGIN;

-- ── Contractor: the profile ──
ALTER TABLE "Contractor" ADD COLUMN IF NOT EXISTS "contactName"       TEXT;
ALTER TABLE "Contractor" ADD COLUMN IF NOT EXISTS "website"           TEXT;
ALTER TABLE "Contractor" ADD COLUMN IF NOT EXISTS "address"           TEXT;
ALTER TABLE "Contractor" ADD COLUMN IF NOT EXISTS "serviceAreas"      TEXT;
ALTER TABLE "Contractor" ADD COLUMN IF NOT EXISTS "tradesJson"        TEXT;
ALTER TABLE "Contractor" ADD COLUMN IF NOT EXISTS "licenseStatus"     TEXT NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE "Contractor" ADD COLUMN IF NOT EXISTS "licenseVerifiedAt" TIMESTAMP(3);
ALTER TABLE "Contractor" ADD COLUMN IF NOT EXISTS "licenseSource"     TEXT;
ALTER TABLE "Contractor" ADD COLUMN IF NOT EXISTS "insuranceCarrier"  TEXT;
ALTER TABLE "Contractor" ADD COLUMN IF NOT EXISTS "insurancePolicy"   TEXT;
ALTER TABLE "Contractor" ADD COLUMN IF NOT EXISTS "bondAmount"        DOUBLE PRECISION;
ALTER TABLE "Contractor" ADD COLUMN IF NOT EXISTS "bondUntil"         TIMESTAMP(3);
ALTER TABLE "Contractor" ADD COLUMN IF NOT EXISTS "w9Status"          TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE "Contractor" ADD COLUMN IF NOT EXISTS "w9DocumentId"      TEXT;
ALTER TABLE "Contractor" ADD COLUMN IF NOT EXISTS "source"            TEXT NOT NULL DEFAULT 'MINE';
ALTER TABLE "Contractor" ADD COLUMN IF NOT EXISTS "placeId"           TEXT;
ALTER TABLE "Contractor" ADD COLUMN IF NOT EXISTS "textsOptOut"       BOOLEAN NOT NULL DEFAULT false;

-- ── ProjectSubQuote: the request stamps and the version pointers ──
ALTER TABLE "ProjectSubQuote" ADD COLUMN IF NOT EXISTS "requestId"         TEXT;
ALTER TABLE "ProjectSubQuote" ADD COLUMN IF NOT EXISTS "sentAt"            TIMESTAMP(3);
ALTER TABLE "ProjectSubQuote" ADD COLUMN IF NOT EXISTS "viewedAt"          TIMESTAMP(3);
ALTER TABLE "ProjectSubQuote" ADD COLUMN IF NOT EXISTS "expiresAt"         TIMESTAMP(3);
ALTER TABLE "ProjectSubQuote" ADD COLUMN IF NOT EXISTS "currentVersionId"  TEXT;
ALTER TABLE "ProjectSubQuote" ADD COLUMN IF NOT EXISTS "approvedVersionId" TEXT;
ALTER TABLE "ProjectSubQuote" ADD COLUMN IF NOT EXISTS "declineReason"     TEXT;
ALTER TABLE "ProjectSubQuote" ADD COLUMN IF NOT EXISTS "revisionNote"      TEXT;
CREATE INDEX IF NOT EXISTS "ProjectSubQuote_requestId_idx" ON "ProjectSubQuote" ("requestId");

-- ── SubRequest ──
CREATE TABLE IF NOT EXISTS "SubRequest" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId"      TEXT NOT NULL,
  "stageId"        TEXT,
  "number"         INTEGER NOT NULL,
  "trade"          TEXT,
  "title"          TEXT NOT NULL,
  "scope"          TEXT NOT NULL,
  "description"    TEXT,
  "materials"      TEXT,
  "labor"          TEXT,
  "fileIdsJson"    TEXT,
  "startsAt"       TIMESTAMP(3),
  "endsAt"         TIMESTAMP(3),
  "dueBy"          TIMESTAMP(3),
  "instructions"   TEXT,
  "status"         TEXT NOT NULL DEFAULT 'SENT',
  "sentAt"         TIMESTAMP(3),
  "createdById"    TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SubRequest_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SubRequest_organizationId_number_key" ON "SubRequest" ("organizationId", "number");
CREATE INDEX IF NOT EXISTS "SubRequest_projectId_status_idx" ON "SubRequest" ("projectId", "status");

-- ── SubQuoteVersion ──
CREATE TABLE IF NOT EXISTS "SubQuoteVersion" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "quoteId"        TEXT NOT NULL,
  "version"        INTEGER NOT NULL,
  "amount"         DOUBLE PRECISION,
  "note"           TEXT,
  "documentId"     TEXT,
  "source"         TEXT NOT NULL DEFAULT 'PORTAL',
  "submittedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "submittedById"  TEXT,
  "extractedJson"  TEXT,
  "extractedAt"    TIMESTAMP(3),
  "reviewStatus"   TEXT NOT NULL DEFAULT 'NONE',
  "reviewedById"   TEXT,
  "reviewedAt"     TIMESTAMP(3),
  "approved"       BOOLEAN NOT NULL DEFAULT false,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SubQuoteVersion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SubQuoteVersion_quoteId_version_key" ON "SubQuoteVersion" ("quoteId", "version");
CREATE INDEX IF NOT EXISTS "SubQuoteVersion_organizationId_submittedAt_idx" ON "SubQuoteVersion" ("organizationId", "submittedAt");

-- ── SubDocument ──
CREATE TABLE IF NOT EXISTS "SubDocument" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId"      TEXT,
  "contractorId"   TEXT,
  "requestId"      TEXT,
  "kind"           TEXT NOT NULL DEFAULT 'QUOTE',
  "name"           TEXT NOT NULL,
  "url"            TEXT NOT NULL,
  "contentType"    TEXT,
  "bytes"          INTEGER,
  "sha256"         TEXT,
  "scanStatus"     TEXT NOT NULL DEFAULT 'SKIPPED',
  "uploadedVia"    TEXT NOT NULL DEFAULT 'OFFICE',
  "uploadedById"   TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SubDocument_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "SubDocument_organizationId_createdAt_idx" ON "SubDocument" ("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "SubDocument_projectId_kind_idx" ON "SubDocument" ("projectId", "kind");
CREATE INDEX IF NOT EXISTS "SubDocument_requestId_idx" ON "SubDocument" ("requestId");

-- ── foreign keys ──
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SubRequest_organizationId_fkey') THEN
    ALTER TABLE "SubRequest" ADD CONSTRAINT "SubRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SubRequest_projectId_fkey') THEN
    ALTER TABLE "SubRequest" ADD CONSTRAINT "SubRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SubRequest_stageId_fkey') THEN
    ALTER TABLE "SubRequest" ADD CONSTRAINT "SubRequest_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "ProjectStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SubDocument_organizationId_fkey') THEN
    ALTER TABLE "SubDocument" ADD CONSTRAINT "SubDocument_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SubDocument_projectId_fkey') THEN
    ALTER TABLE "SubDocument" ADD CONSTRAINT "SubDocument_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SubDocument_contractorId_fkey') THEN
    ALTER TABLE "SubDocument" ADD CONSTRAINT "SubDocument_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SubDocument_requestId_fkey') THEN
    ALTER TABLE "SubDocument" ADD CONSTRAINT "SubDocument_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "SubRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SubQuoteVersion_quoteId_fkey') THEN
    ALTER TABLE "SubQuoteVersion" ADD CONSTRAINT "SubQuoteVersion_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "ProjectSubQuote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SubQuoteVersion_documentId_fkey') THEN
    ALTER TABLE "SubQuoteVersion" ADD CONSTRAINT "SubQuoteVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "SubDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProjectSubQuote_requestId_fkey') THEN
    ALTER TABLE "ProjectSubQuote" ADD CONSTRAINT "ProjectSubQuote_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "SubRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ── one-time backfill: every quote asked before this gets its request, numbered per company from 1001 ──
INSERT INTO "SubRequest" ("id", "organizationId", "projectId", "stageId", "number", "title", "scope", "dueBy", "status", "sentAt", "createdById", "createdAt", "updatedAt")
SELECT 'req_' || q."id", q."organizationId", q."projectId", q."stageId",
       1000 + ROW_NUMBER() OVER (PARTITION BY q."organizationId" ORDER BY q."askedAt", q."id")
         + COALESCE((SELECT MAX(r."number") - 1000 FROM "SubRequest" r WHERE r."organizationId" = q."organizationId"), 0),
       COALESCE(NULLIF(split_part(q."scope", E'\n', 1), ''), 'Quote request'), q."scope", q."dueBy", 'SENT', q."askedAt", q."createdById", q."askedAt", q."askedAt"
FROM "ProjectSubQuote" q
WHERE q."requestId" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "SubRequest" r WHERE r."id" = 'req_' || q."id");

UPDATE "ProjectSubQuote" q
SET "requestId" = 'req_' || q."id", "sentAt" = COALESCE(q."sentAt", q."askedAt")
WHERE q."requestId" IS NULL AND EXISTS (SELECT 1 FROM "SubRequest" r WHERE r."id" = 'req_' || q."id");

-- a version 1 for every quote that already carries a price
INSERT INTO "SubQuoteVersion" ("id", "organizationId", "quoteId", "version", "amount", "note", "source", "submittedAt", "approved", "createdAt")
SELECT 'ver_' || q."id", q."organizationId", q."id", 1, q."amount", q."note", 'PORTAL', COALESCE(q."quotedAt", q."updatedAt"),
       q."status" IN ('AWARDED', 'INVOICED', 'PAID'), COALESCE(q."quotedAt", q."updatedAt")
FROM "ProjectSubQuote" q
WHERE q."amount" IS NOT NULL AND q."currentVersionId" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "SubQuoteVersion" v WHERE v."quoteId" = q."id");

UPDATE "ProjectSubQuote" q
SET "currentVersionId" = 'ver_' || q."id",
    "approvedVersionId" = CASE WHEN q."status" IN ('AWARDED', 'INVOICED', 'PAID') THEN 'ver_' || q."id" END
WHERE q."currentVersionId" IS NULL AND EXISTS (SELECT 1 FROM "SubQuoteVersion" v WHERE v."id" = 'ver_' || q."id");

COMMIT;
