-- PRODUCTION SCHEMA, 2026-11-10 — Smart CRM part 4: the follow-up agent and the promise tracker.
-- FollowUpRule gets "who sends" (mode) and "which words"; a queued FollowUp carries its own copy of both, its
-- waiting state and the prepared draft; ClientPromise gets its kind, the proof that closed it, and when its owner
-- was reminded. Apply BEFORE the deploy that reads it. Postgres (Neon).
--
-- ADDITIONS ONLY: new columns with defaults that keep today's behaviour (every existing rule and queued follow-up
-- stays "send on its own, standard words"). No existing row's data is changed; the code that is live today never
-- names these columns. Re-runnable.

BEGIN;

ALTER TABLE "FollowUpRule" ADD COLUMN IF NOT EXISTS "mode"  TEXT NOT NULL DEFAULT 'AUTO';
ALTER TABLE "FollowUpRule" ADD COLUMN IF NOT EXISTS "words" TEXT NOT NULL DEFAULT 'STANDARD';

ALTER TABLE "FollowUp" ADD COLUMN IF NOT EXISTS "mode"         TEXT NOT NULL DEFAULT 'AUTO';
ALTER TABLE "FollowUp" ADD COLUMN IF NOT EXISTS "words"        TEXT NOT NULL DEFAULT 'STANDARD';
ALTER TABLE "FollowUp" ADD COLUMN IF NOT EXISTS "state"        TEXT NOT NULL DEFAULT 'QUEUED';
ALTER TABLE "FollowUp" ADD COLUMN IF NOT EXISTS "draftSubject" TEXT;
ALTER TABLE "FollowUp" ADD COLUMN IF NOT EXISTS "draftBody"    TEXT;
ALTER TABLE "FollowUp" ADD COLUMN IF NOT EXISTS "draftChannel" TEXT;
ALTER TABLE "FollowUp" ADD COLUMN IF NOT EXISTS "draftBy"      TEXT;
ALTER TABLE "FollowUp" ADD COLUMN IF NOT EXISTS "readyAt"      TIMESTAMP(3);
ALTER TABLE "FollowUp" ADD COLUMN IF NOT EXISTS "reason"       TEXT;

ALTER TABLE "ClientPromise" ADD COLUMN IF NOT EXISTS "kind"       TEXT NOT NULL DEFAULT 'OTHER';
ALTER TABLE "ClientPromise" ADD COLUMN IF NOT EXISTS "evidence"   TEXT;
ALTER TABLE "ClientPromise" ADD COLUMN IF NOT EXISTS "remindedAt" TIMESTAMP(3);

COMMIT;
