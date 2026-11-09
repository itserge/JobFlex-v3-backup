-- PRODUCTION SCHEMA, 2026-11-08 (b) — Smart CRM part 2: the Inbox. One thread per client (ClientThread) and the
-- messages that have no other home (ClientMessage: inbound emails with the body kept, replies sent from the inbox,
-- portal notes). Texts and desk calls stay in SmsMessage / AiPhoneCall and are merged into the view by phone.
-- Apply BEFORE the deploy that reads these. Postgres (Neon).
--
-- ADDITIONS ONLY: two new tables with their indexes and foreign keys (ON DELETE CASCADE from Organization and
-- ClientThread; SET NULL from Client and User). No existing row or column is touched. Re-runnable.
--
-- Prisma names: quoted camelCase.

BEGIN;

CREATE TABLE IF NOT EXISTS "ClientThread" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "clientId"       TEXT,
  "leadId"         TEXT,
  "name"           TEXT NOT NULL,
  "email"          TEXT,
  "phone"          TEXT,
  "replyToken"     TEXT NOT NULL,
  "status"         TEXT NOT NULL DEFAULT 'OPEN',
  "urgent"         BOOLEAN NOT NULL DEFAULT false,
  "assignedToId"   TEXT,
  "unread"         INTEGER NOT NULL DEFAULT 0,
  "lastAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastPreview"    TEXT,
  "lastDirection"  TEXT,
  "lastChannel"    TEXT,
  "aiReadJson"     TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ClientThread_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ClientThread_replyToken_key" ON "ClientThread"("replyToken");
CREATE UNIQUE INDEX IF NOT EXISTS "ClientThread_organizationId_clientId_key" ON "ClientThread"("organizationId", "clientId");
CREATE INDEX IF NOT EXISTS "ClientThread_organizationId_status_lastAt_idx" ON "ClientThread"("organizationId", "status", "lastAt");
CREATE INDEX IF NOT EXISTS "ClientThread_organizationId_lastAt_idx" ON "ClientThread"("organizationId", "lastAt");

CREATE TABLE IF NOT EXISTS "ClientMessage" (
  "id"              TEXT NOT NULL,
  "organizationId"  TEXT NOT NULL,
  "threadId"        TEXT NOT NULL,
  "direction"       TEXT NOT NULL,
  "channel"         TEXT NOT NULL,
  "fromAddr"        TEXT,
  "toAddr"          TEXT,
  "subject"         TEXT,
  "body"            TEXT NOT NULL,
  "attachmentsJson" TEXT,
  "rawUrl"          TEXT,
  "externalId"      TEXT,
  "emailMessageId"  TEXT,
  "sentById"        TEXT,
  "aiReadJson"      TEXT,
  "status"          TEXT NOT NULL DEFAULT 'RECEIVED',
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClientMessage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ClientMessage_externalId_key" ON "ClientMessage"("externalId");
CREATE INDEX IF NOT EXISTS "ClientMessage_organizationId_threadId_createdAt_idx" ON "ClientMessage"("organizationId", "threadId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "ClientThread" ADD CONSTRAINT "ClientThread_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ClientThread" ADD CONSTRAINT "ClientThread_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ClientThread" ADD CONSTRAINT "ClientThread_assignedToId_fkey"
    FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ClientMessage" ADD CONSTRAINT "ClientMessage_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ClientMessage" ADD CONSTRAINT "ClientMessage_threadId_fkey"
    FOREIGN KEY ("threadId") REFERENCES "ClientThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ClientMessage" ADD CONSTRAINT "ClientMessage_sentById_fkey"
    FOREIGN KEY ("sentById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;
