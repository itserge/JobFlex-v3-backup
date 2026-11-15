// WHAT A PARTNER CODE'S STRIPE COUPON ACTUALLY GIVES — read once, kept for good.
//
// Codes minted before 2026-09-03 carry a `forever` coupon (actions/influencers:
// the first-month rule came that day), and a Stripe coupon cannot change. The
// admin page marks those "Discount: forever (legacy)" so the owner can replace
// them (owner, 2026-11-14) — which needs the coupon's real duration, not the
// row's months. One READ per coupon, on the account the code was minted on
// (getStripe(), as provisionStripePromo); no write ever goes to Stripe from here.
// A coupon is immutable, so the answer is cached in SyncState with no expiry.
import "server-only";
import { db } from "@/lib/db";
import { getStripe, isStripeEnabled } from "@/lib/sdk/stripe";

export type CouponDuration = { duration: "forever" | "once" | "repeating"; months: number | null };

const key = (couponId: string) => `promoCouponDuration:${couponId}`;

function parse(raw: string | null | undefined): CouponDuration | null {
  if (!raw) return null;
  if (raw === "forever" || raw === "once") return { duration: raw, months: null };
  const m = raw.match(/^repeating:(\d+)$/);
  return m ? { duration: "repeating", months: Number(m[1]) } : null;
}

/**
 * The durations of these coupons. `read: false` answers from the cache alone
 * (a page the public sees must not wait on Stripe); `read: true` fetches what
 * the cache lacks, a few seconds at most, and a coupon that cannot be read is
 * simply left out.
 */
export async function couponDurations(
  couponIds: string[],
  opts: { read: boolean },
): Promise<Map<string, CouponDuration>> {
  const ids = [...new Set(couponIds.filter((id) => id && !id.startsWith("local_")))];
  const out = new Map<string, CouponDuration>();
  if (ids.length === 0) return out;
  const rows = await db.syncState.findMany({ where: { key: { in: ids.map(key) } } }).catch(() => []);
  for (const r of rows) {
    const d = parse(r.cursor);
    if (d) out.set(r.key.slice("promoCouponDuration:".length), d);
  }
  const missing = ids.filter((id) => !out.has(id));
  if (!opts.read || missing.length === 0 || !isStripeEnabled()) return out;

  let stripe: ReturnType<typeof getStripe>;
  try {
    stripe = getStripe();
  } catch {
    return out;
  }
  const timeout = <T,>(p: Promise<T>) =>
    Promise.race([p, new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000))]);
  await Promise.all(
    missing.map(async (id) => {
      const c = await timeout(stripe.coupons.retrieve(id)).catch(() => null);
      if (!c || typeof c !== "object" || !("duration" in c)) return;
      const d: CouponDuration =
        c.duration === "repeating"
          ? { duration: "repeating", months: c.duration_in_months ?? null }
          : { duration: c.duration === "forever" ? "forever" : "once", months: null };
      out.set(id, d);
      const value = d.duration === "repeating" ? `repeating:${d.months ?? 0}` : d.duration;
      await db.syncState
        .upsert({ where: { key: key(id) }, update: { cursor: value }, create: { key: key(id), cursor: value } })
        .catch(() => {});
    }),
  );
  return out;
}
