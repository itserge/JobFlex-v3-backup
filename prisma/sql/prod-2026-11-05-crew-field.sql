-- PRODUCTION SCHEMA, 2026-11-05 — the crew in the field (lib/crewField). Apply AFTER
-- prod-2026-11-05-project-buying.sql and BEFORE the deploy that reads these.
-- CrewHours: the hours a crew member worked on a job on a day, at the rate of that day (Labor on the job and
-- the project). JobFlag: a problem flagged from site. WorkDay.weather: the weather the day was opened.
-- ProjectExpense.paidAt: a sub's bill paid, or still owed.
-- Postgres (Neon).
--
-- ADDITIONS ONLY: two new tables with their indexes and foreign keys (ON DELETE CASCADE from Job and
-- WorkerProfile; SET NULL from a project that goes), two nullable columns. No existing row is touched. Re-runnable.
--
-- Prisma names: quoted camelCase.

BEGIN;

ALTER TABLE "WorkDay" ADD COLUMN IF NOT EXISTS "weather" TEXT;
ALTER TABLE "ProjectExpense" ADD COLUMN IF NOT EXISTS "paidAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "CrewHours" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "jobId"          TEXT NOT NULL,
  "workerId"       TEXT NOT NULL,
  "workDayId"      TEXT,
  "date"           TEXT NOT NULL,                        -- "2026-11-06" in the company's timezone
  "hours"          DOUBLE PRECISION NOT NULL,
  "rate"           DOUBLE PRECISION,
  "note"           TEXT,
  "createdById"    TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CrewHours_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CrewHours_jobId_workerId_date_key" ON "CrewHours" ("jobId", "workerId", "date");
CREATE INDEX IF NOT EXISTS "CrewHours_organizationId_date_idx" ON "CrewHours" ("organizationId", "date");
CREATE INDEX IF NOT EXISTS "CrewHours_workerId_date_idx" ON "CrewHours" ("workerId", "date");

CREATE TABLE IF NOT EXISTS "JobFlag" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "jobId"          TEXT NOT NULL,
  "projectId"      TEXT,
  "workerId"       TEXT,
  "raisedById"     TEXT,
  "note"           TEXT NOT NULL,
  "blocking"       BOOLEAN NOT NULL DEFAULT false,
  "status"         TEXT NOT NULL DEFAULT 'OPEN',          -- OPEN | RESOLVED
  "resolution"     TEXT,
  "resolvedAt"     TIMESTAMP(3),
  "resolvedById"   TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "JobFlag_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "JobFlag_organizationId_status_idx" ON "JobFlag" ("organizationId", "status");
CREATE INDEX IF NOT EXISTS "JobFlag_jobId_idx" ON "JobFlag" ("jobId");
CREATE INDEX IF NOT EXISTS "JobFlag_projectId_idx" ON "JobFlag" ("projectId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CrewHours_jobId_fkey') THEN
    ALTER TABLE "CrewHours" ADD CONSTRAINT "CrewHours_jobId_fkey"
      FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CrewHours_workerId_fkey') THEN
    ALTER TABLE "CrewHours" ADD CONSTRAINT "CrewHours_workerId_fkey"
      FOREIGN KEY ("workerId") REFERENCES "WorkerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'JobFlag_jobId_fkey') THEN
    ALTER TABLE "JobFlag" ADD CONSTRAINT "JobFlag_jobId_fkey"
      FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'JobFlag_projectId_fkey') THEN
    ALTER TABLE "JobFlag" ADD CONSTRAINT "JobFlag_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
