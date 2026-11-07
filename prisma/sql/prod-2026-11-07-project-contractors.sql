-- PRODUCTION SCHEMA, 2026-11-07 (b) — Contractors: quotes and invoices (lib/projectSubs), part 2 of the plan
-- "Projects: Remodel and New construction". Apply AFTER prod-2026-11-07-project-kind.sql (or on its own — the two are
-- independent) and BEFORE the deploy that reads these.
-- Contractor: the company's subs, a list per company. ProjectSubQuote: a quote asked of a contractor for a stage's
-- work, through its award and its invoice; the contractor answers on /q/<publicToken>.
-- Postgres (Neon).
--
-- ADDITIONS ONLY: two new tables with their indexes and foreign keys (ON DELETE CASCADE from Organization, Project
-- and Contractor; SET NULL from ProjectStage). No existing row is touched. Re-runnable.
--
-- Prisma names: quoted camelCase.

BEGIN;

CREATE TABLE IF NOT EXISTS "Contractor" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "company"        TEXT,
  "trade"          TEXT,
  "phone"          TEXT,
  "email"          TEXT,
  "license"        TEXT,
  "insuranceUntil" TIMESTAMP(3),
  "notes"          TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Contractor_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Contractor_organizationId_name_idx" ON "Contractor" ("organizationId", "name");
DO $$ BEGIN
  ALTER TABLE "Contractor" ADD CONSTRAINT "Contractor_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "ProjectSubQuote" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId"      TEXT NOT NULL,
  "stageId"        TEXT,
  "contractorId"   TEXT NOT NULL,
  "number"         INTEGER NOT NULL DEFAULT 1,
  "scope"          TEXT NOT NULL,
  "status"         TEXT NOT NULL DEFAULT 'ASKED',
  "dueBy"          TIMESTAMP(3),
  "askedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "amount"         DOUBLE PRECISION,
  "note"           TEXT,
  "quotedAt"       TIMESTAMP(3),
  "awardedAt"      TIMESTAMP(3),
  "declinedAt"     TIMESTAMP(3),
  "invoiceAmount"  DOUBLE PRECISION,
  "invoiceUrl"     TEXT,
  "invoicedAt"     TIMESTAMP(3),
  "paidAt"         TIMESTAMP(3),
  "expenseId"      TEXT,
  "publicToken"    TEXT NOT NULL,
  "createdById"    TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectSubQuote_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ProjectSubQuote_publicToken_key" ON "ProjectSubQuote" ("publicToken");
CREATE INDEX IF NOT EXISTS "ProjectSubQuote_projectId_status_idx" ON "ProjectSubQuote" ("projectId", "status");
CREATE INDEX IF NOT EXISTS "ProjectSubQuote_organizationId_status_idx" ON "ProjectSubQuote" ("organizationId", "status");
DO $$ BEGIN
  ALTER TABLE "ProjectSubQuote" ADD CONSTRAINT "ProjectSubQuote_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ProjectSubQuote" ADD CONSTRAINT "ProjectSubQuote_stageId_fkey"
    FOREIGN KEY ("stageId") REFERENCES "ProjectStage" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ProjectSubQuote" ADD CONSTRAINT "ProjectSubQuote_contractorId_fkey"
    FOREIGN KEY ("contractorId") REFERENCES "Contractor" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;
