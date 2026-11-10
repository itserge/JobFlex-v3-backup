-- PRODUCTION SCHEMA, 2026-11-10 — Smart CRM part 6: bring clients back.
-- Five new tables: a company's saved smart lists (ClientList), its campaigns (ClientCampaign) and who each went to
-- (ClientCampaignRecipient), the addresses that asked for no more campaign emails (ClientEmailOptOut), and what is
-- known about each client's house (ClientHouse). Apply BEFORE the deploy that reads them. Postgres (Neon).
--
-- ADDITIONS ONLY: new tables and their indexes. No existing table is touched and no existing row changes; the code
-- that is live today never names these tables. No foreign keys, like TextRule and PageView. Re-runnable.

BEGIN;

CREATE TABLE IF NOT EXISTS "ClientList" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "words" TEXT,
    "filterJson" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientList_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ClientList_organizationId_createdAt_idx" ON "ClientList"("organizationId", "createdAt");

CREATE TABLE IF NOT EXISTS "ClientCampaign" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "listId" TEXT,
    "filterJson" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "writtenBy" TEXT NOT NULL DEFAULT 'person',
    "createdById" TEXT,
    "startedById" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientCampaign_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ClientCampaign_organizationId_status_idx" ON "ClientCampaign"("organizationId", "status");
CREATE INDEX IF NOT EXISTS "ClientCampaign_organizationId_createdAt_idx" ON "ClientCampaign"("organizationId", "createdAt");

CREATE TABLE IF NOT EXISTS "ClientCampaignRecipient" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "lastJob" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "reason" TEXT,
    "sentAt" TIMESTAMP(3),
    "optedOutAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientCampaignRecipient_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ClientCampaignRecipient_campaignId_clientId_key" ON "ClientCampaignRecipient"("campaignId", "clientId");
CREATE INDEX IF NOT EXISTS "ClientCampaignRecipient_campaignId_status_idx" ON "ClientCampaignRecipient"("campaignId", "status");
CREATE INDEX IF NOT EXISTS "ClientCampaignRecipient_organizationId_clientId_sentAt_idx" ON "ClientCampaignRecipient"("organizationId", "clientId", "sentAt");
CREATE INDEX IF NOT EXISTS "ClientCampaignRecipient_organizationId_status_sentAt_idx" ON "ClientCampaignRecipient"("organizationId", "status", "sentAt");

CREATE TABLE IF NOT EXISTS "ClientEmailOptOut" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "via" TEXT NOT NULL DEFAULT 'page',
    "campaignId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientEmailOptOut_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ClientEmailOptOut_organizationId_email_key" ON "ClientEmailOptOut"("organizationId", "email");

CREATE TABLE IF NOT EXISTS "ClientHouse" (
    "clientId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "addressKey" TEXT,
    "yearBuilt" INTEGER,
    "livingSqft" INTEGER,
    "storeys" DOUBLE PRECISION,
    "lotAcres" DOUBLE PRECISION,
    "roofSqft" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'none',
    "sourceNote" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientHouse_pkey" PRIMARY KEY ("clientId")
);
CREATE INDEX IF NOT EXISTS "ClientHouse_organizationId_idx" ON "ClientHouse"("organizationId");

COMMIT;
