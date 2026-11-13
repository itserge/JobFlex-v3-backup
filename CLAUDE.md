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
- Cancelling a subscription happens only on the Subscription page (/dashboard/subscription, desktop and handheld): the secondary outline "Cancel subscription" in the page head beside "Upgrade plan" → the questions (lib/cancelTree: main reason A1/A2/A3 and its branch; A1 may offer a trial extension instead) → Before you go → "Cancel <plan>?" (owner, 2026-11-09 — moved from Settings → Billing → Manage subscription, which no longer has a cancel button; one rule for who sees it: [src/lib/cancelOfferServer.ts](src/lib/cancelOfferServer.ts), the window: [src/components/billing/CancelFlow.tsx](src/components/billing/CancelFlow.tsx)). No other place has a cancel button. Exception (owner, 2026-11-01): a platform admin can cancel an organization's subscription from its card in the admin console (at period end / immediately — [src/lib/adminCancel.ts](src/lib/adminCancel.ts)); for users, cancelling still happens only from the Subscription page.
- Payment methods on our own Stripe Checkout (owner, 2026-11-11): the sign-up — only card and Link, set in code (one place: [src/lib/signupCheckoutSession.ts](src/lib/signupCheckoutSession.ts) `payment_method_types: ["card", "link"]`, no `wallet_options`; nothing else from the Dashboard — no Cash App, Klarna, Amazon Pay or bank); every other Checkout for JobFlex's own money (upgrade / plan change, Deck Studio add-on, card update, card-less trial, AI-desk packs, Lead Center) — card only, by spreading `CARD_ONLY_CHECKOUT` from [src/lib/stripeCheckoutCard.ts](src/lib/stripeCheckoutCard.ts). A new Checkout site spreads it too. The homeowner's proposal payment (contractor's own account) is outside this rule.
- The $1 card check at a trial sign-up (owner, 2026-11-11): on the return from the sign-up's Stripe Checkout, before the account is made, the card it saved is asked for a $1.00 hold (PaymentIntent, `capture_method: "manual"`, off_session, metadata `jfKind: "signup_card_hold"`, idempotency key = the Checkout Session id — once per sign-up), released at once. A card refusal (insufficient_funds, card_declined, do_not_honor …) = NO account: that Checkout's subscription is cancelled at Stripe and the sign-up goes back to the card page with "Your card was declined by your bank. Try another card." and a button to a new Checkout (name and email kept). Anything else — the network, a Stripe error, 3D Secure asked for, a method that takes no hold — = let through as before, logged `[signup] card hold skipped`; a failure of our check never stops a sign-up. Every entry to a trial sign-up goes through it; upgrades, card changes, Deck Studio and every other Checkout never do. One rule: [src/lib/signupCardHold.ts](src/lib/signupCardHold.ts) (its words: [src/lib/signupCardHoldWords.ts](src/lib/signupCardHoldWords.ts)); stale holds are cancelled by the trials cron; results on Admin → Trial watch.
- Sign-up ways (owner, 2026-11-12): a trial sign-up is made by an email code, an SMS code or Google — step 1 has one contact field with an Email / Phone switch (Email first), Google stays. Phone = a US mobile, the code through Twilio Verify (lib/signupOtp channel "sms"; brakes per number, per network and a daily ceiling `SIGNUP_SMS_PER_DAY`), offered only while the trial takes a card: the sign-up's Stripe Checkout gets no `customer_email`, Stripe asks for it, and the return makes that address the account's ([src/actions/signupCheckout.ts](src/actions/signupCheckout.ts) — taken / throwaway / missing = no account, that Checkout's subscription cancelled, the card page again). One number, one account ([src/lib/phoneLogin.ts](src/lib/phoneLogin.ts), SyncState `phone-login:<E.164>`, no schema change); the number signs in by SMS code from then on, and by email like everyone once the email is saved. The company email is required on "Finish setting up your company" — the one screen a sign-up by text owes after its first sign-in, prefilled from Stripe and changeable, and saved only with the 6-digit code emailed to it ([src/lib/phoneSetup.ts](src/lib/phoneSetup.ts), [src/actions/phoneSetup.ts](src/actions/phoneSetup.ts)). Until then the address is unproven ([src/lib/emailProof.ts](src/lib/emailProof.ts)): no email sign-in, reset or Google for it, bills yes, marketing and welcome no (the welcome goes at the code), and a sign-up that proves it (email code, Google) takes it over — the holder's email becomes a `released+<id>@unproven.jobflex.invalid` stand-in and the screen is owed again.
- Платформенный админ всегда видит всё. Любая новая проверка доступа идёт через `hasFullAccess` ([src/lib/fullAccess.ts](src/lib/fullAccess.ts)) (owner, 2026-10-17).
- Deck Studio access (owner, 2026-10-20; price and checkout 2026-10-26): (1) the 7-day trial has the whole studio, without the add-on; (2) after the trial, on ANY plan (Starter, Professional, Advanced, Custom, Enterprise, yearly too) the studio is a preview until the $79/mo add-on ($790/yr on yearly plans) is bought — no plan includes it by itself: no "Deck Studio plan", no feature line (the plan cards and /pricing print "Add-on $79/mo" in every column); a Custom plan whose bought pages include `deck-estimator` counts as having bought the add-on (whole studio, no second add-on line, UI says "Included in your Custom plan"); (3) platform admins (`hasFullAccess`) and MANUAL/grant subscriptions always have the whole studio. One rule: `hasEdition` in [src/lib/editions.ts](src/lib/editions.ts), asked through [src/lib/deck/access.ts](src/lib/deck/access.ts). (4) Grandfathered: a line bought at $49/mo ($490/yr) keeps that price — nothing that rebuilds a subscription (webhook, plan sync, plan change, Before you go, add/remove, trial extension, a replacement Checkout on the same term) swaps an existing `deck-addon` line for the new price; the line is found by its price's `metadata.jfKind`, never by amount, and the UI shows "$49/mo (your price)". (5) Bought with a plan: every subscription Checkout in the app offers it as an optional item (Stripe's Deck Studio switch), and "Add Deck Studio · +$79/mo" beside the plan cards (Plans & upgrade, Subscription; off by default; in a trial "Included in your trial, billed after it") puts it on as a line of the order or the plan change — the only way the add-on goes onto a trialing subscription; the trial covers it and it is billed when the trial ends. The add-on button itself never adds it during a trial, and nothing adds it automatically when the trial ends; saved decks are never deleted and open view-only (and printable) in the preview. (6) Not at sign-up (owner, 2026-10-27): the sign-up's Stripe Checkout and plan step carry the plan and its trial only — no optional item, no pick box.
- Deck Studio exception (owner, 2026-10-20): the organization Lone Oak Fence keeps the Custom-plan `deck-estimator` page at its $10/mo page price and the whole Deck Studio with it — the only exception; the page stays off sale and its price is not changed. Everyone else: Deck Studio is the $79/mo ($790/yr) add-on on any plan (those who bought it at $49/$490 keep that price), included in the trial.
- The new plans, Base + Tools (owner, 2026-11-10/11; plan https://claude.ai/artifact/YWxFUapYJR1p5etHbWcbun; code [src/lib/toolPlans/](src/lib/toolPlans/)): the two Deck Studio rules above are for Classic shops (any plan slug that isn't `tools-…`) and stay exactly as written for them. For NEW sign-ups after the owner turns the Plans switch on (Admin → Trial watch → "Plans · new sign-ups", SyncState `pricingModel`), Deck Studio is one of eleven tools (AI Operator is not one of them until it launches — owner, 2026-11-12: sold on no plan, opened by none): the landing, /pricing and the sign-up's plan step are one plan builder ([src/components/v3/tools-plan/tools-builder.tsx](src/components/v3/tools-plan/tools-builder.tsx), priced by `toolsBuild` in [src/lib/toolPlans/cards.ts](src/lib/toolPlans/cards.ts)) — each size at its own price, the tools ticked on top; a Deck Studio ad opens it on Professional with Deck Studio ticked (its `tool-deck` line on the subscription from sign-up, Advanced/Complete include it) and the visitor may tick any others or take it off. The first tool ticked is the shop's main tool; the others ride the 7 free days as free tries that end with the trial (billed with the plan unless removed before — any tool, the main one too, can be removed in the free days). On those plans `hasEdition` follows the shop's tools (the `tools.deck` fact), not the trial. Never apply the new-plan rules to a Classic shop, and never the Classic Deck rules to a `tools-…` shop.

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
