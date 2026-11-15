// Per-mode resolution of an influencer promo code — NO STRIPE CALL.
//
//   npx tsx --tsconfig tsconfig.json qa/tests/billing/influencer-promo-mode.check.ts
//
// promotionCodeIdForMode takes the Stripe client as an argument, so it can be
// driven with a stub that RECORDS what it was asked for and answers from a
// script. That is what makes the central claim testable rather than asserted:
// on live the function must return the stored id and TOUCH THE CLIENT ZERO
// TIMES, so live behaviour cannot have changed.
//
// The SyncState rows it writes are prefixed `stripePromo:test:qa-promo-` and
// deleted on the way out, pass or fail. No influencer or organisation rows are
// created; nothing is charged to anyone.

delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_SECRET_KEY_TEST;

import "../_lib/_server-only";
import { PrismaClient } from "@prisma/client";
import {
  promotionCodeIdForMode,
  type PromoForCheckout,
} from "../../../src/lib/influencerPromoMode";

const db = new PrismaClient();
const PROMO_ID = "qa-promo-1";

let passes = 0;
let failures = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) passes++;
  else failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};

/** A Stripe stand-in that records every call and answers from a script. */
function stubStripe(script: {
  retrievePromo?: (id: string) => unknown;
  createCoupon?: (p: unknown) => unknown;
  createPromo?: (p: unknown) => unknown;
  listPromo?: (p: unknown) => unknown;
  retrieveCoupon?: (id: string) => unknown;
}) {
  const calls: string[] = [];
  const stripe = {
    promotionCodes: {
      retrieve: async (id: string) => {
        calls.push(`promotionCodes.retrieve(${id})`);
        if (!script.retrievePromo) throw new Error("no such promotion code");
        return script.retrievePromo(id);
      },
      create: async (p: unknown) => {
        calls.push(`promotionCodes.create(${JSON.stringify(p)})`);
        if (!script.createPromo) throw new Error("code already exists");
        return script.createPromo(p);
      },
      list: async (p: unknown) => {
        calls.push(`promotionCodes.list(${JSON.stringify(p)})`);
        return script.listPromo ? script.listPromo(p) : { data: [] };
      },
      update: async (id: string, p: unknown) => {
        calls.push(`promotionCodes.update(${id},${JSON.stringify(p)})`);
        return { id, ...(p as object) };
      },
    },
    coupons: {
      retrieve: async (id: string) => {
        calls.push(`coupons.retrieve(${id})`);
        if (!script.retrieveCoupon) throw new Error("no such coupon");
        return script.retrieveCoupon(id);
      },
      create: async (p: unknown) => {
        calls.push(`coupons.create(${JSON.stringify(p)})`);
        if (!script.createCoupon) throw new Error("cannot create");
        return script.createCoupon(p);
      },
    },
  };
  // The function only ever touches the four methods above.
  return { stripe: stripe as never, calls };
}

const LIVE_PROMO: PromoForCheckout = {
  id: PROMO_ID,
  code: "QAPROMO20",
  stripeCouponId: "coupon_live_qa",
  stripePromotionCodeId: "promo_live_qa",
  customerPercentOff: 20,
};

async function cleanup() {
  const r = await db.syncState.deleteMany({ where: { key: { startsWith: `stripePromo:test:${PROMO_ID}` } } });
  return r.count;
}

async function main() {
  await cleanup();
  console.log("influencer promo, per Stripe mode · no Stripe calls\n");

  // ── LIVE: the stored id, and the client is never touched. ──
  {
    const { stripe, calls } = stubStripe({});
    const id = await promotionCodeIdForMode(stripe, "live", LIVE_PROMO);
    ok("live returns the stored promotion-code id unchanged", id === "promo_live_qa", String(id));
    ok("live makes ZERO Stripe calls — live behaviour cannot have changed",
      calls.length === 0, calls.join(" | ") || "(none)");
    ok("live writes no cache row",
      (await db.syncState.count({ where: { key: { startsWith: `stripePromo:test:${PROMO_ID}` } } })) === 0);
  }

  // ── LIVE with a keyless-dev synthetic: null, same as the old inline predicate. ──
  {
    const { stripe, calls } = stubStripe({});
    const id = await promotionCodeIdForMode(stripe, "live", {
      ...LIVE_PROMO,
      stripePromotionCodeId: "local_promo_abc",
    });
    ok("live refuses a local_ synthetic, exactly as the old predicate did", id === null, String(id));
    ok("and still makes no call", calls.length === 0);
  }

  // ── TEST, staging case: the stored id IS a test id on this account. ──
  {
    const { stripe, calls } = stubStripe({
      retrievePromo: (id) => ({ id, active: true }),
    });
    const id = await promotionCodeIdForMode(stripe, "test", LIVE_PROMO);
    ok("test adopts the stored id when it resolves on this account",
      id === "promo_live_qa", String(id));
    ok("it took ONE read and minted nothing",
      calls.length === 1 && calls[0].startsWith("promotionCodes.retrieve"), calls.join(" | "));
    ok("nothing was cached — there is no twin to remember",
      (await db.syncState.count({ where: { key: { startsWith: `stripePromo:test:${PROMO_ID}` } } })) === 0);
  }

  // ── TEST, the real case: the stored id is a LIVE id, so a twin is minted. ──
  {
    const { stripe, calls } = stubStripe({
      createCoupon: () => ({ id: "coupon_test_twin", valid: true, deleted: false }),
      createPromo: () => ({ id: "promo_test_twin", active: true }),
    });
    const id = await promotionCodeIdForMode(stripe, "test", LIVE_PROMO);
    ok("test mints a twin when the stored id does not exist there",
      id === "promo_test_twin", String(id));

    const couponCall = calls.find((c) => c.startsWith("coupons.create"));
    ok("the twin coupon carries the SAME percent as live", !!couponCall?.includes('"percent_off":20'), couponCall);
    ok("…the same duration: repeating, one month — a once-coupon is spent on a trial's $0 invoice",
      !!couponCall?.includes('"duration":"repeating"') && !!couponCall?.includes('"duration_in_months":1'),
      couponCall);
    ok("…and the PromoCode row id in metadata, so the webhook can resolve it back",
      !!couponCall?.includes(`"jfPromoCodeId":"${PROMO_ID}"`), couponCall);

    const promoCall = calls.find((c) => c.startsWith("promotionCodes.create"));
    ok("the twin keeps the SAME redeemable string as live",
      !!promoCall?.includes('"code":"QAPROMO20"'), promoCall);

    const cachedPromo = await db.syncState.findUnique({ where: { key: `stripePromo:test:${PROMO_ID}:m1:promo` } });
    const cachedCoupon = await db.syncState.findUnique({ where: { key: `stripePromo:test:${PROMO_ID}:m1:coupon` } });
    ok("both twin ids are cached in SyncState, not in the schema",
      cachedPromo?.cursor === "promo_test_twin" && cachedCoupon?.cursor === "coupon_test_twin",
      `${cachedPromo?.cursor} / ${cachedCoupon?.cursor}`);
  }

  // ── TEST, second checkout: the cache is used, nothing is minted twice. ──
  {
    const { stripe, calls } = stubStripe({
      retrievePromo: (id) => (id === "promo_test_twin" ? { id, active: true } : null),
    });
    const id = await promotionCodeIdForMode(stripe, "test", LIVE_PROMO);
    ok("a second checkout reuses the cached twin", id === "promo_test_twin", String(id));
    ok("no coupon and no promotion code were created again",
      !calls.some((c) => c.includes(".create(")), calls.join(" | "));
  }

  // ── TEST, wiped sandbox: the cached twin is gone, so it is re-minted. ──
  {
    const { stripe, calls } = stubStripe({
      createCoupon: () => ({ id: "coupon_test_twin2", valid: true, deleted: false }),
      createPromo: () => ({ id: "promo_test_twin2", active: true }),
    });
    const id = await promotionCodeIdForMode(stripe, "test", LIVE_PROMO);
    ok("a wiped sandbox re-mints rather than failing the checkout",
      id === "promo_test_twin2", String(id));
    ok("the cache now points at the new twin",
      (await db.syncState.findUnique({ where: { key: `stripePromo:test:${PROMO_ID}:m1:promo` } }))?.cursor ===
        "promo_test_twin2");
    ok("the re-mint was attempted, not silently skipped",
      calls.some((c) => c.startsWith("coupons.create")));
  }

  // ── TEST, the code string is already taken: adopt rather than fail. ──
  {
    await cleanup();
    const { stripe } = stubStripe({
      createCoupon: () => ({ id: "coupon_test_x", valid: true, deleted: false }),
      // createPromo absent → the stub throws "code already exists"
      listPromo: () => ({ data: [{ id: "promo_existing_twin", active: true }] }),
    });
    const id = await promotionCodeIdForMode(stripe, "test", LIVE_PROMO);
    ok("a code string already taken on the test account is adopted, not fatal",
      id === "promo_existing_twin", String(id));
  }

  // ── TEST, a code for N months (owner, 2026-11-14): the twin lasts N paid months, cached under its months. ──
  {
    await cleanup();
    const { stripe, calls } = stubStripe({
      createCoupon: () => ({ id: "coupon_test_m3", valid: true, deleted: false }),
      createPromo: () => ({ id: "promo_test_m3", active: true }),
    });
    const id = await promotionCodeIdForMode(stripe, "test", { ...LIVE_PROMO, customerDiscountMonths: 3 });
    const couponCall = calls.find((c) => c.startsWith("coupons.create"));
    ok("a 3-month code mints a twin repeating for 3 months (7-day trial: no extra month)",
      id === "promo_test_m3" && !!couponCall?.includes('"duration_in_months":3'), couponCall);
    ok("…cached under its months, apart from a 1-month twin",
      (await db.syncState.findUnique({ where: { key: `stripePromo:test:${PROMO_ID}:m3:promo` } }))?.cursor === "promo_test_m3" &&
        (await db.syncState.count({ where: { key: `stripePromo:test:${PROMO_ID}:m1:promo` } })) === 0);
  }

  // ── TEST, the string is held by ANOTHER row's twin (a replaced discount): switch it off, mint this row's. ──
  {
    await cleanup();
    let creates = 0;
    const { stripe, calls } = stubStripe({
      createCoupon: () => ({ id: "coupon_test_new", valid: true, deleted: false }),
      createPromo: () => {
        if (creates++ === 0) throw new Error("code already exists");
        return { id: "promo_test_new", active: true };
      },
      listPromo: () => ({ data: [{ id: "promo_replaced_twin", active: true, metadata: { jfPromoCodeId: "qa-promo-replaced" } }] }),
    });
    const id = await promotionCodeIdForMode(stripe, "test", LIVE_PROMO);
    ok("a replaced row's twin holding the string is switched off",
      calls.some((c) => c.startsWith("promotionCodes.update(promo_replaced_twin") && c.includes('"active":false')), calls.join(" | "));
    ok("…and this row gets its own twin, not the old terms", id === "promo_test_new", String(id));
  }

  // ── TEST with no percent to copy: refuse rather than invent a discount. ──
  {
    await cleanup();
    const { stripe, calls } = stubStripe({
      createCoupon: () => ({ id: "coupon_never", valid: true, deleted: false }),
      createPromo: () => ({ id: "promo_never", active: true }),
    });
    const id = await promotionCodeIdForMode(stripe, "test", {
      ...LIVE_PROMO,
      customerPercentOff: null,
      // local_ → percentOffFor will not read a live coupon for it either
      stripeCouponId: "local_coupon_x",
    });
    ok("with no percent known, no twin is invented", id === null, String(id));
    ok("and no coupon was created at a guessed rate",
      !calls.some((c) => c.startsWith("coupons.create")), calls.join(" | "));
  }

  console.log(`\n${passes} passed, ${failures} failed`);
  const removed = await cleanup();
  console.log(`      · cleaned up ${removed} cache row(s)`);
  await db.$disconnect();
  process.exit(failures ? 1 : 0);
}

main().catch(async (err) => {
  console.error("\ncheck crashed:", err);
  try {
    await cleanup();
  } catch {
    /* best effort */
  }
  await db.$disconnect();
  process.exit(2);
});
