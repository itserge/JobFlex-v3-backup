-- PRODUCTION SCHEMA, 2026-11-04 — the JobFlex Assistant (lib/assistant).
-- AssistantLink: a phone allowed to text or call the Assistant number as a
-- person in a company (proved by a code texted from it). AssistantMessage:
-- every turn in and out — memory, log and the `assistantCommands` meter.
-- AssistantAction: a change the Assistant proposed, waiting for YES, then run.
-- Postgres (Neon). Apply BEFORE the deploy that reads them: the panel and the
-- meter read these tables.
--
-- ADDITIONS ONLY: three new tables, their indexes and their foreign keys
-- (ON DELETE CASCADE from Organization and User, so a purged company or a
-- deleted account takes its Assistant rows with it). No existing table,
-- column, index or constraint is altered, renamed or dropped, and no row is
-- touched. Re-runnable: every statement is IF NOT EXISTS or guarded, so a
-- second run changes nothing.
--
-- Prisma names: quoted camelCase.

BEGIN;

CREATE TABLE IF NOT EXISTS "AssistantLink" (
  "id"             TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "phone"          TEXT NOT NULL,                      -- E.164
  "verifiedAt"     TIMESTAMP(3),
  "pinHash"        TEXT,
  "active"         BOOLEAN NOT NULL DEFAULT true,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AssistantLink_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AssistantLink_phone_key" ON "AssistantLink" ("phone");
CREATE INDEX IF NOT EXISTS "AssistantLink_userId_idx" ON "AssistantLink" ("userId");
CREATE INDEX IF NOT EXISTS "AssistantLink_organizationId_idx" ON "AssistantLink" ("organizationId");

CREATE TABLE IF NOT EXISTS "AssistantMessage" (
  "id"              TEXT NOT NULL,
  "organizationId"  TEXT NOT NULL,
  "userId"          TEXT NOT NULL,
  "channel"         TEXT NOT NULL,                     -- app | sms | voice
  "direction"       TEXT NOT NULL,                     -- IN | OUT
  "body"            TEXT NOT NULL,
  "externalId"      TEXT,                              -- Twilio MessageSid
  "countsAsCommand" BOOLEAN NOT NULL DEFAULT false,
  "actionId"        TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AssistantMessage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AssistantMessage_externalId_key" ON "AssistantMessage" ("externalId");
CREATE INDEX IF NOT EXISTS "AssistantMessage_organizationId_createdAt_idx" ON "AssistantMessage" ("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "AssistantMessage_userId_createdAt_idx" ON "AssistantMessage" ("userId", "createdAt");

CREATE TABLE IF NOT EXISTS "AssistantAction" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "channel"        TEXT NOT NULL,
  "tool"           TEXT NOT NULL,
  "argsJson"       TEXT NOT NULL,
  "readback"       TEXT NOT NULL,
  "status"         TEXT NOT NULL DEFAULT 'AWAITING',  -- AWAITING | QUEUED | RUNNING | DONE | FAILED | CANCELED | EXPIRED
  "resultJson"     TEXT,
  "error"          TEXT,
  "executeAfter"   TIMESTAMP(3),
  "approvedAt"     TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AssistantAction_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AssistantAction_organizationId_status_idx" ON "AssistantAction" ("organizationId", "status");
CREATE INDEX IF NOT EXISTS "AssistantAction_userId_status_idx" ON "AssistantAction" ("userId", "status");
CREATE INDEX IF NOT EXISTS "AssistantAction_status_executeAfter_idx" ON "AssistantAction" ("status", "executeAfter");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AssistantLink_userId_fkey') THEN
    ALTER TABLE "AssistantLink" ADD CONSTRAINT "AssistantLink_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AssistantLink_organizationId_fkey') THEN
    ALTER TABLE "AssistantLink" ADD CONSTRAINT "AssistantLink_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AssistantMessage_userId_fkey') THEN
    ALTER TABLE "AssistantMessage" ADD CONSTRAINT "AssistantMessage_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AssistantMessage_organizationId_fkey') THEN
    ALTER TABLE "AssistantMessage" ADD CONSTRAINT "AssistantMessage_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AssistantAction_userId_fkey') THEN
    ALTER TABLE "AssistantAction" ADD CONSTRAINT "AssistantAction_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AssistantAction_organizationId_fkey') THEN
    ALTER TABLE "AssistantAction" ADD CONSTRAINT "AssistantAction_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
