-- PRODUCTION SCHEMA, 2026-11-09 — the cancel questions (lib/cancelTree).
-- Postgres (Neon). Apply BEFORE the code that reads these columns is deployed:
-- Prisma selects every column of a model, so without them every read of
-- CancellationFeedback / TrialExtensionRequest fails (the cancel itself still
-- goes through — the answer is logged as lost — but /admin/cancellations,
-- /admin/trial-requests and the /admin/users sheet lose their rows).
--
-- ADDITIONS ONLY: five nullable / defaulted columns on two existing tables.
-- No table, column, index or constraint is altered, renamed or dropped, and no
-- row is changed (old rows read path / answersJson as null, wantsFollowUp as
-- false). Re-runnable: every statement is IF NOT EXISTS.

BEGIN;

ALTER TABLE "CancellationFeedback" ADD COLUMN IF NOT EXISTS "path"          TEXT;                           -- A1 | A2 | A3
ALTER TABLE "CancellationFeedback" ADD COLUMN IF NOT EXISTS "answersJson"   TEXT;                           -- lib/cancelTree CancelAnswers
ALTER TABLE "CancellationFeedback" ADD COLUMN IF NOT EXISTS "wantsFollowUp" BOOLEAN NOT NULL DEFAULT false; -- "Yes — email me when it's fixed"
ALTER TABLE "CancellationFeedback" ADD COLUMN IF NOT EXISTS "followUpEmail" TEXT;

ALTER TABLE "TrialExtensionRequest" ADD COLUMN IF NOT EXISTS "answersJson"  TEXT;                           -- lib/cancelTree A1Answers

COMMIT;

-- Check (read only):
--   SELECT table_name, column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--   WHERE table_name IN ('CancellationFeedback', 'TrialExtensionRequest')
--     AND column_name IN ('path', 'answersJson', 'wantsFollowUp', 'followUpEmail')
--   ORDER BY table_name, column_name;
--   → 5 rows.
