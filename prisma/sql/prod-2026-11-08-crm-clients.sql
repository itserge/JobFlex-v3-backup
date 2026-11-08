-- PRODUCTION SCHEMA, 2026-11-08 — Smart CRM part 1: the client's memory, promises, the saved brief and the merge
-- log (lib/clientTimeline, lib/clientMemory, lib/clientMerge; the plan doc "JobFlex Smart CRM — plan").
-- Apply BEFORE the deploy that reads these. Postgres (Neon).
--
-- ADDITIONS ONLY: four new tables with their indexes and foreign keys (ON DELETE CASCADE from Organization and
-- Client; SET NULL from User on a promise's owner). No existing row or column is touched. Re-runnable.
--
-- Prisma names: quoted camelCase.

BEGIN;

CREATE TABLE IF NOT EXISTS "ClientFact" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "clientId"       TEXT NOT NULL,
  "category"       TEXT NOT NULL,
  "fact"           TEXT NOT NULL,
  "status"         TEXT NOT NULL DEFAULT 'CURRENT',
  "supersededById" TEXT,
  "sourceKind"     TEXT,
  "sourceId"       TEXT,
  "sourceAt"       TIMESTAMP(3),
  "byAi"           BOOLEAN NOT NULL DEFAULT true,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ClientFact_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ClientFact_organizationId_clientId_status_idx"
  ON "ClientFact"("organizationId", "clientId", "status");

CREATE TABLE IF NOT EXISTS "ClientPromise" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "clientId"       TEXT NOT NULL,
  "direction"      TEXT NOT NULL DEFAULT 'OURS',
  "text"           TEXT NOT NULL,
  "ownerId"        TEXT,
  "dueAt"          TIMESTAMP(3),
  "status"         TEXT NOT NULL DEFAULT 'OPEN',
  "keptAt"         TIMESTAMP(3),
  "sourceKind"     TEXT,
  "sourceId"       TEXT,
  "sourceAt"       TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ClientPromise_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ClientPromise_organizationId_status_dueAt_idx"
  ON "ClientPromise"("organizationId", "status", "dueAt");
CREATE INDEX IF NOT EXISTS "ClientPromise_organizationId_clientId_idx"
  ON "ClientPromise"("organizationId", "clientId");

CREATE TABLE IF NOT EXISTS "ClientBrief" (
  "clientId"       TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "summary"        TEXT NOT NULL,
  "nextAction"     TEXT,
  "builtAt"        TIMESTAMP(3) NOT NULL,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ClientBrief_pkey" PRIMARY KEY ("clientId")
);
CREATE INDEX IF NOT EXISTS "ClientBrief_organizationId_idx"
  ON "ClientBrief"("organizationId");

CREATE TABLE IF NOT EXISTS "ClientMerge" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "keptId"         TEXT NOT NULL,
  "mergedId"       TEXT NOT NULL,
  "mergedName"     TEXT NOT NULL,
  "mergedEmail"    TEXT,
  "mergedPhone"    TEXT,
  "movedJson"      TEXT,
  "byUserId"       TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClientMerge_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ClientMerge_organizationId_keptId_idx"
  ON "ClientMerge"("organizationId", "keptId");

DO $$ BEGIN
  ALTER TABLE "ClientFact" ADD CONSTRAINT "ClientFact_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ClientFact" ADD CONSTRAINT "ClientFact_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ClientPromise" ADD CONSTRAINT "ClientPromise_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ClientPromise" ADD CONSTRAINT "ClientPromise_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ClientPromise" ADD CONSTRAINT "ClientPromise_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ClientBrief" ADD CONSTRAINT "ClientBrief_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ClientBrief" ADD CONSTRAINT "ClientBrief_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ClientMerge" ADD CONSTRAINT "ClientMerge_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;
