-- A PARTNER CODE'S DISCOUNT LENGTH (owner, 2026-11-14) — production (Neon Postgres).
-- How many paid months an influencer code's customer discount lasts. Additive and re-runnable: one guarded column;
-- every existing code reads as NULL = one month, which is what its Stripe coupon already gives (codes minted before
-- 2026-09-03 carry a "forever" coupon — the admin page marks those, nothing here changes them).
--
-- APPLY BEFORE THE PUSH: Prisma selects every column of PromoCode by default, so the new code reading a database
-- without this column fails with P2022 on the sign-up's code check, the Stripe webhook and /admin/influencers.
BEGIN;

ALTER TABLE "PromoCode" ADD COLUMN IF NOT EXISTS "customerDiscountMonths" INTEGER;

COMMIT;
