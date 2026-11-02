# JobFlex Admin Console — Subscriptions, Influencers & Payouts

A platform-level admin console plus a separate influencer portal, built so that
**Stripe is the single source of truth** for money and promo-code usage. The app
database is a cache/mirror, reconcilable from Stripe at any time.

## Actors & access model

| Actor | How they log in | Where they land | Guard |
|-------|-----------------|-----------------|-------|
| **User** (org member) | `/auth/login` | `/dashboard` | `requireOrg()` |
| **Platform admin** | `/auth/login`, with `User.isPlatformAdmin = true` | `/admin` | `requirePlatformAdmin()` |
| **Influencer** | `/influencer/login` (separate Credentials provider) | `/influencer` | `requireInfluencer()` |

One NextAuth instance backs all three. The JWT carries a `principal`
(`USER` | `INFLUENCER`) discriminator + `influencerId`. **The JWT identifies who;
the guards re-read the database to authorize what** — so suspending an influencer
or revoking admin takes effect on the next request, not after the 7-day token
expires. Guards live in `src/lib/orgContext.ts`; every admin/influencer page,
server action, and route handler calls one as its first statement.

> The `/admin` gate is the dedicated `isPlatformAdmin` flag, not org-level
> OWNER/ADMIN. Seed your first admin:
> `UPDATE "User" SET "isPlatformAdmin" = 1 WHERE email = '...';`

## Pages

- **`/admin`** — hub: platform stats + nav cards (Subscribers / Influencers / Plans / Support).
- **`/admin/subscribers`** — every org's subscription mirrored from Stripe; live MRR / paying-count / per-plan / promo-usage metrics; filter by plan/status/promo/text; row → live Stripe verification sheet.
- **`/admin/influencers`** — create affiliates (auto-issues a Stripe promo code + a login), set commission terms, toggle active, approve/reject payout requests.
- **`/admin/plans`** — edit price / trial / yearly (with savings %); **Sync to Stripe** mints Products + Prices.
- **`/admin/support`** — inbox for tickets raised at **`/dashboard/support`**; mark read/resolved.
- **`/admin/prompts`** — the Smart Proposal prompts (2026-09-18): the current system message, master prompt, line-item rules, and every specialty's preamble and procedure, each with a Default / Customized chip, Save / Reset; a preview composes the exact prompt a brief sends. Overrides live in `PromptOverride` (`lib/estimate/promptOverrides`), read on every generate. The Remodel method card edits the six parts of the method remodel briefs carry (`remodel:<part>`), and the preview shows the rooms, whole job vs part of a room and the range. See `docs/smart-proposal-procedures.md` and `docs/remodel-method.md`.
- **`/influencer`** — the affiliate's own promo codes, referred subscribers (confirmed via Stripe), earnings, Connect onboarding, and request-payout.

## Stripe-as-source-of-truth invariants

- Revenue / subscriber counts / commission only count after Stripe confirms a
  successful, non-refunded charge (`invoice.paid`, `amount_paid > 0`).
- **Promo attribution is read off the Stripe Subscription/Invoice discount**
  (`promotion_code` / `coupon`) — never from anything the checkout form collected.
  An abandoned checkout creates no attribution.
- Cancellations end attribution (no future accrual); refunds/disputes reverse
  commission proportionally, with clawback if it was already paid out.
- All commission money is **integer cents** in an append-only `CommissionLedger`;
  balances are derived (`pending` → `cleared` after the hold window → `paid`).

### Idempotency (three layers)

1. `WebhookEvent.eventId` (unique) drops duplicate webhook deliveries.
2. `CommissionLedger.idempotencyKey` (unique) drops duplicate money effects even
   across webhook + reconciliation (`accrue:<invoiceId>`, `reverse:<chargeId>:…`, `pay:<transferId>`).
3. Stripe outbound `idempotencyKey` on every transfer (`payout:<requestId>`).

## Environment variables

```
STRIPE_SECRET_KEY=             # server-side; enables real billing, sync, Connect, payouts
STRIPE_WEBHOOK_SECRET=         # required to accept webhooks
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
NEXT_PUBLIC_APP_URL=           # used for checkout + Connect onboarding return URLs
CRON_SECRET=                   # protects the scheduled jobs (also accepted as Bearer)
NEXTAUTH_SECRET=               # influencer login shares this one instance
```

Everything degrades gracefully when `STRIPE_SECRET_KEY` is unset: plans can't sync,
checkout falls back to the demo plan-set, promo codes are created as local-only
placeholders, and payouts wait. No crashes.

## Stripe webhook setup

Endpoint: `POST /api/webhooks/stripe` (signature-verified). Enable these events:

```
checkout.session.completed
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
invoice.paid
invoice.payment_failed
charge.refunded
charge.dispute.created          # a company disputes its JobFlex charge: commissions held + the team's "Disputes" text
charge.dispute.funds_withdrawn  # an inquiry escalated to a chargeback: the second text
charge.dispute.closed           # won / lost / inquiry closed
account.updated          # Connect onboarding status
transfer.created
transfer.reversed
```

Local testing:

```
stripe listen --forward-to localhost:3000/api/webhooks/stripe
stripe trigger invoice.paid        # → one ACCRUED ledger entry (re-trigger = no dupe)
stripe trigger charge.refunded     # → REVERSED entry
stripe trigger invoice.payment_failed   # → subscription PAST_DUE, no accrual
```

## Plans → Stripe (immutable prices)

Stripe Prices are immutable, so **Sync to Stripe** creates a new Price, archives
the old one, and repoints the `PlanPrice` mirror — at most one active price per
(plan slug, interval), enforced in the repoint transaction. The plan's feature
gating still comes from `src/lib/entitlements.ts`; `PlanPrice` only maps a
`stripePriceId` → plan tier for the webhook + checkout. Subscription checkout
(`/api/checkout/subscription`, `mode: "subscription"`, `allow_promotion_codes`)
lets the customer enter an influencer code on Stripe's page.

## Influencer payouts — approve-then-auto-transfer (Stripe Connect Express)

1. **Onboard**: influencer clicks Connect → `accounts.create({ type: "express", capabilities: { transfers } })` → hosted `accountLinks` KYC. `account.updated` flips `payoutsEnabled` / `connectStatus`.
2. **Earn**: `invoice.paid` accrues commission as `PENDING`, clearing after the influencer's `holdDays` (the refund-safety escrow).
3. **Request**: influencer requests a payout once cleared balance ≥ `minPayoutCents`.
4. **Approve**: a platform admin approves the request.
5. **Transfer**: the `process-approved-payouts` cron transfers the *currently
   cleared* balance via `stripe.transfers.create` (separate charges & transfers —
   the subscription charge stays in the platform account), records a negative
   `PAID` ledger entry, and closes the request. Refund-after-payout produces a
   negative balance that nets against the next payout.

## Scheduled jobs (`vercel.json`)

| Path | Cadence | Purpose |
|------|---------|---------|
| `/api/cron/clear-commissions` | daily | `PENDING` → `CLEARED` past the hold window |
| `/api/cron/reconcile-stripe` | every 6h | re-sync subscriptions + re-assert accruals (repairs dropped webhooks) |
| `/api/cron/process-approved-payouts` | daily | execute approved payouts via Connect |

All accept `CRON_SECRET` via `x-cron-key` header, `?key=`, or `Authorization: Bearer`.

## Authorization invariants (keep these true)

- Every admin/influencer action calls a guard first — layout gating protects
  pages, not the actions they invoke.
- Influencer reads are always filtered by the session's own `influencerId`
  (`requireInfluencerSelf` on any id-bearing route) — never trust a client-supplied id.
- The influencer dashboard shows referred orgs by name + plan + date only — no
  raw subscriber email (privacy default).
