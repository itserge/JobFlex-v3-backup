-- PRODUCTION SCHEMA, 2026-11-05 — buying and deliveries on a project (lib/projectBuying). Apply AFTER
-- prod-2026-11-05-project-stages.sql (ProjectStage must exist) and BEFORE the deploy that reads these.
-- ProjectMaterial: the to-buy list, one line per material (from a sold proposal's lines, an approved change
-- order, the Deck Studio takeoff, or typed). ProjectOrder: part of the list bought one way (a supplier, a buyer by
-- link, stock) and its delivery. ProjectOrderLine: so much of one material on an order. Supplier.leadDays: how
-- many days a supplier takes, for the order-by date.
-- Postgres (Neon).
--
-- ADDITIONS ONLY: three new tables with their indexes and foreign keys (ON DELETE CASCADE from Project; SET NULL
-- from a stage or a supplier that goes), one nullable column. No existing row is touched. Re-runnable.
--
-- Prisma names: quoted camelCase.

BEGIN;

ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "leadDays" INTEGER;

CREATE TABLE IF NOT EXISTS "ProjectMaterial" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId"      TEXT NOT NULL,
  "stageId"        TEXT,
  "proposalId"     TEXT,
  "lineItemId"     TEXT,
  "changeOrderId"  TEXT,
  "name"           TEXT NOT NULL,
  "quantity"       DOUBLE PRECISION NOT NULL DEFAULT 1,
  "unit"           TEXT NOT NULL DEFAULT 'each',
  "unitCost"       DOUBLE PRECISION,
  "source"         TEXT NOT NULL DEFAULT 'HAND',          -- PROPOSAL | CHANGE_ORDER | TAKEOFF | HAND
  "store"          TEXT,
  "productUrl"     TEXT,
  "orderedQty"     DOUBLE PRECISION NOT NULL DEFAULT 0,
  "receivedQty"    DOUBLE PRECISION NOT NULL DEFAULT 0,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectMaterial_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ProjectMaterial_projectId_idx" ON "ProjectMaterial" ("projectId");
CREATE INDEX IF NOT EXISTS "ProjectMaterial_stageId_idx" ON "ProjectMaterial" ("stageId");

CREATE TABLE IF NOT EXISTS "ProjectOrder" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId"      TEXT NOT NULL,
  "number"         INTEGER NOT NULL DEFAULT 1,
  "how"            TEXT NOT NULL DEFAULT 'SUPPLIER',      -- SUPPLIER | BUYER | STOCK
  "status"         TEXT NOT NULL DEFAULT 'ORDERED',       -- ORDERED | SHIPPED | DELIVERED | PARTIAL | CANCELED
  "stageId"        TEXT,
  "supplierId"     TEXT,
  "buyerName"      TEXT,
  "buyerEmail"     TEXT,
  "buyerPhone"     TEXT,
  "buyerWorkerId"  TEXT,
  "publicToken"    TEXT NOT NULL,
  "orderBy"        TIMESTAMP(3),
  "expectedAt"     TIMESTAMP(3),
  "orderedAt"      TIMESTAMP(3),
  "shippedAt"      TIMESTAMP(3),
  "deliveredAt"    TIMESTAMP(3),
  "carrier"        TEXT,
  "trackingNumber" TEXT,
  "note"           TEXT,
  "quotedTotal"    DOUBLE PRECISION,
  "paidTotal"      DOUBLE PRECISION,
  "expenseId"      TEXT,
  "buyerNote"      TEXT,
  "buyerSeenAt"    TIMESTAMP(3),
  "createdById"    TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectOrder_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ProjectOrder_publicToken_key" ON "ProjectOrder" ("publicToken");
CREATE INDEX IF NOT EXISTS "ProjectOrder_projectId_idx" ON "ProjectOrder" ("projectId");
CREATE INDEX IF NOT EXISTS "ProjectOrder_organizationId_status_idx" ON "ProjectOrder" ("organizationId", "status");
CREATE INDEX IF NOT EXISTS "ProjectOrder_organizationId_expectedAt_idx" ON "ProjectOrder" ("organizationId", "expectedAt");

CREATE TABLE IF NOT EXISTS "ProjectOrderLine" (
  "id"          TEXT NOT NULL,
  "orderId"     TEXT NOT NULL,
  "materialId"  TEXT NOT NULL,
  "quantity"    DOUBLE PRECISION NOT NULL,
  "receivedQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "status"      TEXT NOT NULL DEFAULT 'OPEN',              -- OPEN | BOUGHT | RECEIVED | MISSING
  "note"        TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectOrderLine_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ProjectOrderLine_orderId_idx" ON "ProjectOrderLine" ("orderId");
CREATE INDEX IF NOT EXISTS "ProjectOrderLine_materialId_idx" ON "ProjectOrderLine" ("materialId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProjectMaterial_projectId_fkey') THEN
    ALTER TABLE "ProjectMaterial" ADD CONSTRAINT "ProjectMaterial_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProjectMaterial_stageId_fkey') THEN
    ALTER TABLE "ProjectMaterial" ADD CONSTRAINT "ProjectMaterial_stageId_fkey"
      FOREIGN KEY ("stageId") REFERENCES "ProjectStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProjectOrder_projectId_fkey') THEN
    ALTER TABLE "ProjectOrder" ADD CONSTRAINT "ProjectOrder_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProjectOrder_stageId_fkey') THEN
    ALTER TABLE "ProjectOrder" ADD CONSTRAINT "ProjectOrder_stageId_fkey"
      FOREIGN KEY ("stageId") REFERENCES "ProjectStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProjectOrder_supplierId_fkey') THEN
    ALTER TABLE "ProjectOrder" ADD CONSTRAINT "ProjectOrder_supplierId_fkey"
      FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProjectOrderLine_orderId_fkey') THEN
    ALTER TABLE "ProjectOrderLine" ADD CONSTRAINT "ProjectOrderLine_orderId_fkey"
      FOREIGN KEY ("orderId") REFERENCES "ProjectOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProjectOrderLine_materialId_fkey') THEN
    ALTER TABLE "ProjectOrderLine" ADD CONSTRAINT "ProjectOrderLine_materialId_fkey"
      FOREIGN KEY ("materialId") REFERENCES "ProjectMaterial"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
