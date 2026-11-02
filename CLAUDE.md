# CLAUDE.md — JobFlex v3

## Safety — read first
- Confirm before any destructive op: `rm -rf`, `git reset --hard`, `git push --force`, DB drops, migration rollbacks.
- Confirm before `prisma migrate` / `prisma db push` against any environment.
- Never bypass git hooks (`--no-verify`) or signing.
- No secrets in code or commits. `.env.example` is the contract; real values stay in `.env.local`.
- Never commit `prisma/dev.db` content as part of unrelated work.
- `c:\Job-FLEX` is READ-ONLY. View it for reference; never edit, copy from, or run commands in it.

## Project
- `c:\joblfex-v3` — mobile redesign of JobFlex. Goal is mobile UI/UX layout and interaction patterns.
- Next.js 16 (App Router), React 19, TypeScript 5.6, Tailwind 3.4, Framer Motion 11, Lucide.
- Prisma 5.22 (SQLite `dev.db`), NextAuth v5 beta, Zustand, React Hook Form + Zod.
- Route groups in `src/app/`: `(admin)`, `(auth)`, `(dashboard)`, `(marketing)`, `(mobile)`, `(portal)`, `(worker-portal)`.
- `src/components/` is feature-organized; `src/components/ui/` holds the shared primitives.
- `prisma/schema.prisma` is the schema of record. `src/app/globals.css` holds the design tokens.

## Design
- Read **[DESIGN.md](DESIGN.md)** before any frontend work. It is the single current Blueprint specification for every agent, including Codex, Claude and Impeccable. Its linked live components are the maintained examples; historical prototypes and generic skill aesthetics are not design authorities. Keep design decisions in that one file.
- Tune tokens in `src/app/globals.css` within the current Blueprint specification. Do not introduce another palette, font system, corner treatment or motion theme unless the user requests a design-system change; record approved changes in DESIGN.md.
- Change values at the token layer, never hardcode literals in components. A theme swap should be one file.
- Check for an existing token before adding a near-duplicate.
- Ask before repurposing what a token *means* app-wide, or removing the token system.
- Light mode only. Do not add `.dark` variants.
- Do not use Radix patterns. Modals here are hand-rolled — see [InboxSheet.tsx](src/components/calendar/InboxSheet.tsx) for the in-house style.
- DESIGN.md and the `jobflex-page-styler` skill references are hand-authored. Do not regenerate them with a doc tool.
- A component inside the dashboard shell with its own CSS: put `data-nest` on its root, or give its selectors ≥ 2 classes (e.g. `:global(.jf-blueprint .content) .cls`). A single-class rule ties the shell's `margin/padding: 0` reset (`blueprint.module.css`), and the production build emits that reset later — every padding and margin goes to 0 on prod while `next dev` looks right.
- Check visual changes on `next build` + `next start` (own `JOBFLEX_DIST_DIR`), not only on dev.

## Mobile
- Target viewport is handheld (≤768px). Design the layout for that first.
- Do not scatter `md:` / `lg:` variants through markup. When a surface needs both, use the established pattern: a viewport switch at ≤768px that dynamically imports the mobile component — see [responsive-dashboard-shell.tsx](src/components/v3/responsive-shell/responsive-dashboard-shell.tsx).
- No UA-detection logic.
- Touch targets ≥44px. Prefer bottom sheets and sticky actions over modal dialogs.
- New standalone mobile pages live under `src/app/(mobile)/`, alongside existing routes — they do not replace them.
- Every surface gets a real mobile build. Desktop-gating needs explicit approval; read-only fallback is the last resort.
- Verify in a real browser at 390×844 before reporting work complete — use the playwright or chrome-devtools MCP.

## Scope
- **Data layer needs approval.** Server actions, API routes, and Prisma schema changes. Reuse existing endpoints otherwise.
- `(worker-portal)` and `(portal)` are out of scope unless explicitly assigned.
- Reuse and re-layout existing components before building new ones.
- No test framework installed. Do not add tests or test scaffolding without approval.

## How to work
- Once the design is clear, make the changes. Skip spec and plan ceremony unless the problem is genuinely open-ended.
- Open-ended problem → `superpowers:brainstorming` first. Non-trivial bug → `superpowers:systematic-debugging`.
- Multi-step build → `superpowers:writing-plans` then `superpowers:executing-plans`.
- Any component build → use the `frontend-design` skill.
- Ship in batches of ~5 pages/components, then stop for review. Do not chain batches autonomously.
- Front-load blocking questions. Don't stop mid-batch for something answerable.
- Propose a skill before codifying a recurring pattern; use `skill-creator` after approval.

## Owner-locked decisions
- Cancelling a subscription happens only at Settings → Billing → Manage subscription → the window → Cancel → Before you go → confirmation (owner, 2026-10-17). The Subscription page and every other place have no cancel button. Exception (owner, 2026-11-01): a platform admin can cancel an organization's subscription from its card in the admin console (at period end / immediately — [src/lib/adminCancel.ts](src/lib/adminCancel.ts)); for users, cancelling still happens only through the Billing popup.
- Платформенный админ всегда видит всё. Любая новая проверка доступа идёт через `hasFullAccess` ([src/lib/fullAccess.ts](src/lib/fullAccess.ts)) (owner, 2026-10-17).
- Deck Studio access (owner, 2026-10-20; price and checkout 2026-10-26): (1) the 7-day trial has the whole studio, without the add-on; (2) after the trial, on ANY plan (Starter, Professional, Advanced, Custom, Enterprise, yearly too) the studio is a preview until the $79/mo add-on ($790/yr on yearly plans) is bought — no plan includes it by itself: no "Deck Studio plan", no feature line (the plan cards and /pricing print "Add-on $79/mo" in every column); a Custom plan whose bought pages include `deck-estimator` counts as having bought the add-on (whole studio, no second add-on line, UI says "Included in your Custom plan"); (3) platform admins (`hasFullAccess`) and MANUAL/grant subscriptions always have the whole studio. One rule: `hasEdition` in [src/lib/editions.ts](src/lib/editions.ts), asked through [src/lib/deck/access.ts](src/lib/deck/access.ts). (4) Grandfathered: a line bought at $49/mo ($490/yr) keeps that price — nothing that rebuilds a subscription (webhook, plan sync, plan change, Before you go, add/remove, trial extension, a replacement Checkout on the same term) swaps an existing `deck-addon` line for the new price; the line is found by its price's `metadata.jfKind`, never by amount, and the UI shows "$49/mo (your price)". (5) Bought with a plan: every subscription Checkout in the app offers it as an optional item (Stripe's Deck Studio switch), and "Add Deck Studio · +$79/mo" beside the plan cards (Plans & upgrade, Subscription; off by default; in a trial "Included in your trial, billed after it") puts it on as a line of the order or the plan change — the only way the add-on goes onto a trialing subscription; the trial covers it and it is billed when the trial ends. The add-on button itself never adds it during a trial, and nothing adds it automatically when the trial ends; saved decks are never deleted and open view-only (and printable) in the preview. (6) Not at sign-up (owner, 2026-10-27): the sign-up's Stripe Checkout and plan step carry the plan and its trial only — no optional item, no pick box.
- Deck Studio exception (owner, 2026-10-20): the organization Lone Oak Fence keeps the Custom-plan `deck-estimator` page at its $10/mo page price and the whole Deck Studio with it — the only exception; the page stays off sale and its price is not changed. Everyone else: Deck Studio is the $79/mo ($790/yr) add-on on any plan (those who bought it at $49/$490 keep that price), included in the trial.

## Git
- Commit only when asked. Never push, branch, or open a PR without explicit instruction.
- Conventional Commits: `feat:` / `fix:` / `chore:` / `refactor:` / `style:`.

## Test accounts
- Automated tests and every agent's Playwright run sign in **only** as `qa@acme.test`, in its own organisation **QA Co** (slug `qa-co`, seeded; the account is its OWNER and has no seat in Acme). Limits are per organisation — 30 property lookups an hour, among others — so a test run inside Acme spends the owner's allowance; nothing a test does may be charged to an organisation a person works in. `owner@acme.test` is the owner's own account for manual checks — never use it from a script: the sign-in brake allows 8 attempts per address per 15 minutes, and a script would lock the owner out.

## Commands
- `npm run dev` · `npm run build` · `npm run typecheck` · `npm run lint`
- `npm run prisma:migrate` / `prisma:push` / `prisma:seed` — require approval.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
