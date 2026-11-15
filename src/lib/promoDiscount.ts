// A PARTNER CODE'S DISCOUNT: X% OFF FOR N PAID MONTHS (owner, 2026-11-14).
//
// The admin sets both per code (/admin/influencers). The percent sits on the
// Stripe coupon; the months become its duration_in_months (lib/promoCoupon), so
// a monthly subscriber pays N discounted invoices and the (N+1)th at full price.
// A yearly bill has one invoice: there the code is ONE amount off it, the
// percent of N months of the monthly price, N counted up to 12
// (lib/firstMonthDiscount). PromoCode.customerDiscountMonths null = 1 month —
// every code minted before the field.
//
// Pure: the sign-up's pill and price lines, the partner's portal and the admin
// page all read their words from here, so they cannot say one thing while
// Stripe is asked for another.

export const DISCOUNT_MONTHS_MIN = 1;
export const DISCOUNT_MONTHS_MAX = 24;
export const DISCOUNT_MONTHS_DEFAULT = 1;
/** The admin form's quick picks; any other whole number in range is typed. */
export const DISCOUNT_MONTHS_PICKS = [1, 2, 3, 6, 12] as const;
/** A yearly bill is one invoice: more than 12 months is still one year's worth. */
export const YEAR_DISCOUNT_MONTHS_CAP = 12;

/** The stored months, read: null, missing or out of range → one month. */
export function discountMonths(v: number | null | undefined): number {
  return typeof v === "number" && Number.isInteger(v) && v >= DISCOUNT_MONTHS_MIN && v <= DISCOUNT_MONTHS_MAX
    ? v
    : DISCOUNT_MONTHS_DEFAULT;
}

/** The months a yearly bill takes off: N, at most 12. */
export function yearDiscountMonths(v: number | null | undefined): number {
  return Math.min(discountMonths(v), YEAR_DISCOUNT_MONTHS_CAP);
}

function pctText(pct: number): string {
  return `${Number.isInteger(pct) ? pct : Number(pct.toFixed(2))}%`;
}

/** "20% off your first month" · "20% off for 3 months". */
export function discountPhrase(pct: number, months: number | null | undefined): string {
  const n = discountMonths(months);
  return n === 1 ? `${pctText(pct)} off your first month` : `${pctText(pct)} off for ${n} months`;
}

/** A price line's words for its term: a yearly bill takes N months' worth, N up to 12 — so the line says 12, not 18. */
export function termDiscountPhrase(pct: number, months: number | null | undefined, term: "MONTH" | "YEAR"): string {
  return discountPhrase(pct, term === "YEAR" ? yearDiscountMonths(months) : months);
}

/** A legacy `forever` coupon (minted before 2026-09-03): "20% off every payment". */
export function foreverPhrase(pct: number): string {
  return `${pctText(pct)} off every payment`;
}

/** The admin's short form: "20% · 3 mo". */
export function discountShort(pct: number, months: number | null | undefined): string {
  return `${pctText(pct)} · ${discountMonths(months)} mo`;
}

/** The admin summary: "Subscribers get 20% off for 3 months." */
export function discountSummary(pct: number, months: number | null | undefined): string {
  if (!(pct > 0)) return "No subscriber discount.";
  const n = discountMonths(months);
  return n === 1
    ? `Subscribers get ${pctText(pct)} off their first month.`
    : `Subscribers get ${pctText(pct)} off for ${n} months.`;
}

/** What is wrong with a typed month count, or null when it is a whole 1–24. */
export function discountMonthsProblem(raw: string): string | null {
  const s = raw.trim();
  if (s === "") return "Enter how many months the discount lasts — 1 to 24.";
  const n = Number(s);
  if (!Number.isFinite(n)) return "Months is a number — 1 to 24.";
  if (!Number.isInteger(n)) return "Whole months only — 1 to 24.";
  if (n < DISCOUNT_MONTHS_MIN) return "At least 1 month.";
  if (n > DISCOUNT_MONTHS_MAX) return "24 months at most.";
  return null;
}

/* A REPLACED CODE keeps its row for the subscribers who joined under it, under
   its code with "~<n>" added: "~" is outside lib/attributionShared CODE_RE, so
   nobody can type or link it, and the redeemable string is free for the
   replacement. Displayed without the suffix. */
export const REPLACED_MARK = "~";
export function isReplacedCode(code: string): boolean {
  return code.includes(REPLACED_MARK);
}
export function baseCode(code: string): string {
  const i = code.indexOf(REPLACED_MARK);
  return i === -1 ? code : code.slice(0, i);
}
