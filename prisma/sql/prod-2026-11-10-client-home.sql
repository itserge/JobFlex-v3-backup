-- THE CLIENT'S HOME PAGE (2026-11-10, Smart CRM part 5) — production (Neon Postgres).
-- One lasting link per client: "Client"."homeToken" (unique; made on first use) and "homeViewedAt" (when the client
-- last opened it). Additive and re-runnable; every existing client reads as "no link yet". Written from
-- `prisma migrate diff` (origin/main → this branch's production schema).
BEGIN;

ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "homeToken" TEXT;
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "homeViewedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX IF NOT EXISTS "Client_homeToken_key" ON "Client"("homeToken");

COMMIT;
