-- PRODUCTION SCHEMA, 2026-11-09 — the subcontractors plan, part 5a (lib/subInvoices): a sub's invoices and the
-- payments recorded against them (made outside JobFlex or through Ramp's Bill Pay), with retainage and lien waivers.
-- Apply BEFORE the deploy that reads these.
-- Postgres (Neon).
--
-- ADDITIONS ONLY: one nullable column on Subcontract (retainagePct), two new tables (SubInvoice, SubPayment) with their
-- indexes and foreign keys (ON DELETE CASCADE from Organization, Project, Contractor and the quote; SET NULL on the
-- optional links). No backfill: nothing existing changes meaning. Re-runnable: every statement guards itself.
-- Written from `prisma migrate diff` between main's schema and this branch's, then guarded.
--
-- Prisma names: quoted camelCase.

BEGIN;

ALTER TABLE "Subcontract" ADD COLUMN IF NOT EXISTS "retainagePct" DOUBLE PRECISION;

CREATE TABLE IF NOT EXISTS "SubInvoice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "contractId" TEXT,
    "number" INTEGER NOT NULL,
    "invoiceNumber" TEXT,
    "amount" DOUBLE PRECISION,
    "milestone" INTEGER,
    "milestoneName" TEXT,
    "issuedAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL DEFAULT 'PORTAL',
    "documentId" TEXT,
    "inboundEmailId" TEXT,
    "note" TEXT,
    "extractedJson" TEXT,
    "reviewStatus" TEXT NOT NULL DEFAULT 'NONE',
    "readAttempts" INTEGER NOT NULL DEFAULT 0,
    "readError" TEXT,
    "flagsJson" TEXT NOT NULL DEFAULT '[]',
    "duplicateOfId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "disputedAt" TIMESTAMP(3),
    "disputeReason" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "dueNotifiedAt" TIMESTAMP(3),
    "rampBillId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubInvoice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SubPayment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "contractId" TEXT,
    "invoiceId" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "retainageHeld" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "retainageRelease" BOOLEAN NOT NULL DEFAULT false,
    "method" TEXT NOT NULL,
    "reference" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RECORDED',
    "waiverDocumentId" TEXT,
    "waiverKind" TEXT,
    "expenseId" TEXT,
    "rampBillId" TEXT,
    "idempotencyKey" TEXT,
    "note" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubPayment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SubInvoice_projectId_status_idx" ON "SubInvoice"("projectId", "status");

CREATE INDEX IF NOT EXISTS "SubInvoice_quoteId_idx" ON "SubInvoice"("quoteId");

CREATE INDEX IF NOT EXISTS "SubInvoice_contractorId_receivedAt_idx" ON "SubInvoice"("contractorId", "receivedAt");

CREATE INDEX IF NOT EXISTS "SubInvoice_organizationId_reviewStatus_idx" ON "SubInvoice"("organizationId", "reviewStatus");

CREATE UNIQUE INDEX IF NOT EXISTS "SubInvoice_organizationId_number_key" ON "SubInvoice"("organizationId", "number");

CREATE UNIQUE INDEX IF NOT EXISTS "SubPayment_idempotencyKey_key" ON "SubPayment"("idempotencyKey");

CREATE INDEX IF NOT EXISTS "SubPayment_projectId_status_idx" ON "SubPayment"("projectId", "status");

CREATE INDEX IF NOT EXISTS "SubPayment_invoiceId_idx" ON "SubPayment"("invoiceId");

CREATE INDEX IF NOT EXISTS "SubPayment_quoteId_idx" ON "SubPayment"("quoteId");

CREATE INDEX IF NOT EXISTS "SubPayment_contractorId_paidAt_idx" ON "SubPayment"("contractorId", "paidAt");

-- ── foreign keys ──
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SubInvoice_organizationId_fkey') THEN
    ALTER TABLE "SubInvoice" ADD CONSTRAINT "SubInvoice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SubInvoice_projectId_fkey') THEN
    ALTER TABLE "SubInvoice" ADD CONSTRAINT "SubInvoice_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SubInvoice_contractorId_fkey') THEN
    ALTER TABLE "SubInvoice" ADD CONSTRAINT "SubInvoice_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SubInvoice_quoteId_fkey') THEN
    ALTER TABLE "SubInvoice" ADD CONSTRAINT "SubInvoice_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "ProjectSubQuote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SubInvoice_contractId_fkey') THEN
    ALTER TABLE "SubInvoice" ADD CONSTRAINT "SubInvoice_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Subcontract"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SubInvoice_documentId_fkey') THEN
    ALTER TABLE "SubInvoice" ADD CONSTRAINT "SubInvoice_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "SubDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SubPayment_organizationId_fkey') THEN
    ALTER TABLE "SubPayment" ADD CONSTRAINT "SubPayment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SubPayment_projectId_fkey') THEN
    ALTER TABLE "SubPayment" ADD CONSTRAINT "SubPayment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SubPayment_contractorId_fkey') THEN
    ALTER TABLE "SubPayment" ADD CONSTRAINT "SubPayment_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SubPayment_quoteId_fkey') THEN
    ALTER TABLE "SubPayment" ADD CONSTRAINT "SubPayment_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "ProjectSubQuote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SubPayment_contractId_fkey') THEN
    ALTER TABLE "SubPayment" ADD CONSTRAINT "SubPayment_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Subcontract"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SubPayment_invoiceId_fkey') THEN
    ALTER TABLE "SubPayment" ADD CONSTRAINT "SubPayment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "SubInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SubPayment_waiverDocumentId_fkey') THEN
    ALTER TABLE "SubPayment" ADD CONSTRAINT "SubPayment_waiverDocumentId_fkey" FOREIGN KEY ("waiverDocumentId") REFERENCES "SubDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
