// A partner code's discount for N paid months (owner, 2026-11-14) — the pure rules, NO STRIPE CALL, no rows.
//
//   npx tsx --tsconfig tsconfig.json qa/tests/billing/influencer-discount-months.check.ts
//
// The Stripe coupon's duration_in_months (lib/promoCoupon), the yearly one-off amount (lib/firstMonthDiscount)
// and every word the sign-up, the partner's page and the admin page print (lib/promoDiscount).

import "../_lib/_server-only";
import { promoCouponMonths, promoCouponParams } from "../../../src/lib/promoCoupon";
import { firstBillCents, firstMonthOffCents, yearOffCents } from "../../../src/lib/firstMonthDiscount";
import {
  baseCode,
  discountMonths,
  discountMonthsProblem,
  discountPhrase,
  discountShort,
  discountSummary,
  isReplacedCode,
  termDiscountPhrase,
  yearDiscountMonths,
} from "../../../src/lib/promoDiscount";

let passes = 0;
let failures = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) passes++;
  else failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};

// ── the coupon: N paid months after the trial ──
for (const n of [1, 2, 3, 4, 6, 9, 12, 18, 24]) {
  ok(`7-day trial, ${n} months → duration_in_months ${n}`, promoCouponMonths(n, 7) === n, String(promoCouponMonths(n, 7)));
}
ok("3-day trial, 3 months → 3", promoCouponMonths(3, 3) === 3);
ok("a 30-day trial needs one month more (as referralCouponMonths): 3 → 4", promoCouponMonths(3, 30) === 4);
ok("a missing months value is one month", promoCouponMonths(null, 7) === 1);
const params = promoCouponParams({ percentOff: 20, months: 3, name: "x".repeat(60), metadata: { jfCode: "C" } });
ok("coupon params: repeating, the percent, the months, a 40-char name, the months in metadata",
  params.duration === "repeating" && params.percent_off === 20 && params.duration_in_months === 3 && params.name?.length === 40 && params.metadata?.discountMonths === "3" && params.metadata?.jfCode === "C",
  JSON.stringify(params));

// ── the yearly bill: one amount, N months' worth, N up to 12 (Professional $95/mo, $855/yr in the catalog seed) ──
ok("yearly 20% · 3 months of $95 = $57 off", yearOffCents(9500, 20, 3) === 5700);
ok("yearly 20% · 6 months of $95 = $114 off", yearOffCents(9500, 20, 6) === 11400);
ok("yearly 20% · 18 months counts as 12 = $228 off", yearOffCents(9500, 20, 18) === 22800);
ok("first yearly bill $855 → $798 (3 months)", firstBillCents("YEAR", 85500, 9500, 20, 3) === 79800);
ok("first yearly bill $855 → $741 (6 months)", firstBillCents("YEAR", 85500, 9500, 20, 6) === 74100);
ok("one month is the old first-month amount (the referral's path, unchanged)", yearOffCents(9500, 10, 1) === firstMonthOffCents(9500, 10));
ok("a monthly first bill is the percent off the month, whatever N", firstBillCents("MONTH", 9500, 9500, 20, 6) === 7600);
ok("never below zero", firstBillCents("YEAR", 10000, 9500, 100, 12) === 0);

// ── the words ──
ok("N = 1 says the first month", discountPhrase(20, 1) === "20% off your first month");
ok("N = 3", discountPhrase(20, 3) === "20% off for 3 months");
ok("null = 1", discountPhrase(20, null) === "20% off your first month");
ok("a yearly price line says what a year takes: 18 → 12", termDiscountPhrase(20, 18, "YEAR") === "20% off for 12 months" && termDiscountPhrase(20, 18, "MONTH") === "20% off for 18 months");
ok("admin short", discountShort(20, 3) === "20% · 3 mo");
ok("admin summary", discountSummary(20, 3) === "Subscribers get 20% off for 3 months." && discountSummary(20, 1) === "Subscribers get 20% off their first month.");
ok("out-of-range stored months read as 1", discountMonths(0) === 1 && discountMonths(25) === 1 && discountMonths(2.5) === 1 && yearDiscountMonths(24) === 12);

// ── the form's refusals ──
ok("empty refused", !!discountMonthsProblem(""));
ok("0 refused", discountMonthsProblem("0") === "At least 1 month.");
ok("2.5 refused", /Whole months/.test(discountMonthsProblem("2.5") ?? ""));
ok("25 refused", discountMonthsProblem("25") === "24 months at most.");
ok("1, 4, 9, 24 accepted", ["1", "4", "9", "24"].every((v) => discountMonthsProblem(v) === null));

// ── a replaced code's history row ──
ok("JAMIE20~1 is a replaced row shown as JAMIE20", isReplacedCode("JAMIE20~1") && baseCode("JAMIE20~1") === "JAMIE20" && !isReplacedCode("JAMIE20"));

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
