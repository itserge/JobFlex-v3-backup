// "FIRST MONTH" CODES ON A YEARLY BILL (owner, 2026-10-12).
//
// A partner's code (20%) and a member referral (10%) take their percent off the
// first MONTH. On a monthly plan that is the first bill. On a yearly plan the
// first bill is the whole year, and the percent used to come off all of it:
// 20% of Advanced's $1,990 is $398, where one month's 20% is $39.80. So on a
// year the discount is a fixed amount — the percent of ONE month of that plan
// — taken off the first yearly bill. Monthly plans are unchanged.
//
// A CODE FOR N MONTHS (owner, 2026-11-14; lib/promoDiscount): on a year it is
// the percent of N months of the monthly price, N counted up to 12 — still one
// amount off the one yearly bill. A monthly bill shows its first invoice here;
// the next N−1 carry the same percent at Stripe.
//
// Pure: the plan step shows the same number Stripe is asked to take off
// (lib/signupPricing, api/checkout/subscription mint the coupon from it).
import { yearDiscountMonths } from "@/lib/promoDiscount";

/** The percent of one month, in cents, to the cent as Stripe rounds it. */
export function firstMonthOffCents(monthlyCents: number, pct: number): number {
  return Math.round((monthlyCents * pct) / 100);
}

/** The percent of N months (N capped at 12), in cents: what a yearly bill takes off. */
export function yearOffCents(monthlyCents: number, pct: number, months: number | null | undefined = 1): number {
  return Math.round((monthlyCents * pct * yearDiscountMonths(months)) / 100);
}

/** The first bill with a code: the month less its percent, or the year less N months' percent. */
export function firstBillCents(term: "MONTH" | "YEAR", termCents: number, monthlyCents: number, pct: number, months: number | null | undefined = 1): number {
  if (!pct) return termCents;
  return term === "YEAR"
    ? Math.max(0, termCents - yearOffCents(monthlyCents, pct, months))
    : Math.round(termCents * (1 - pct / 100));
}
