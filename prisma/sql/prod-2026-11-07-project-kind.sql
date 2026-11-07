-- PRODUCTION SCHEMA, 2026-11-07 — Remodel or New construction (lib/projectKind), part 1 of the plan "Projects:
-- Remodel and New construction". Apply AFTER prod-2026-11-06-project-client.sql and BEFORE the deploy that reads
-- these.
-- Project.kind: REMODEL (every project made before this) or NEW_BUILD. Project.answersJson: the questions asked
-- when the project is made (the client lives there during the work; the template its stages came from).
-- Postgres (Neon).
--
-- ADDITIONS ONLY: two columns, one with a default. No existing row changes meaning. Re-runnable.
--
-- Prisma names: quoted camelCase.

BEGIN;

ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "kind"        TEXT NOT NULL DEFAULT 'REMODEL';
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "answersJson" TEXT;

COMMIT;
