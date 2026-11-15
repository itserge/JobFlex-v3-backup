// Partner portal — the shapes the three server pages hand their client
// components. Types only, no queries: each page owns its own reads.
//
// WHAT A PARTNER MAY SEE ABOUT A REFERRED CLIENT. Month, plan, status. Nothing
// else. Before this the Overview rendered the client's ORGANISATION NAME, which
// is the name of a real business that bought software — a partner who referred
// them is owed commission, not a customer list. So ReferredClientDTO carries no
// name, no email, no slug, no Stripe customer or subscription id, and not even
// the organisation id: an opaque row id is all a React key needs, and an org id
// is a handle to the business.
//
// The month is a MONTH, formatted on the server, not a timestamp — "March 2026",
// not the day and hour a particular business started paying.

/**
 * Cents → "$12.64", ALWAYS two decimals.
 *
 * Not lib/format's money(): that one drops the decimals on a whole amount
 * (`maximumFractionDigits: n % 1 === 0 ? 0 : 2`), which is right for the 155
 * surfaces built on it and wrong for a ledger — a column reading $76.36, $22.12,
 * $10 does not line up, and the one row that lost its decimals looks like a
 * different kind of number. Local, so that choice stays local.
 */
export function usd(cents: number): string {
  const sign = cents < 0 ? "−" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

export interface BalancesDTO {
  /** Accrued, still inside the hold window. */
  pendingCents: number;
  /** Past the hold window — payable. Negative while a chargeback on money
   *  already paid out is being paid back from new commission. */
  clearedCents: number;
  /** Frozen while a customer disputes the payment it came from. */
  heldCents: number;
  /** Paid out, then reversed by Stripe — owed, waiting on JobFlex to resend. */
  reversedTransferCents: number;
  /** Already transferred out (positive). */
  paidOutCents: number;
  /** Gross ever accrued (positive accruals only). */
  lifetimeEarnedCents: number;
  /** Net of every ledger entry — the true running balance. */
  balanceCents: number;
}

export interface PromoCodeDTO {
  id: string;
  code: string;
  active: boolean;
  /** The partner's own commission: "20% · 6 months", from lib/commission's describeCommission. */
  terms: string;
  /** What a subscriber saves, for the partner's own pitch — "20% off for 3 months" (lib/promoDiscount); null: none. */
  discount: string | null;
  /** The terms this code had before its discount was replaced (shown under the code, without its "~n"). */
  replaced: boolean;
  clicks: number;
  /** The full share link, assembled server-side from the app's base URL. */
  shareUrl: string;
}

export interface ReferredClientDTO {
  /** Opaque row id — a React key, not a handle to anything. */
  id: string;
  /** Which of the partner's codes brought them in. */
  code: string;
  /** "March 2026", or null before the first payment clears. */
  since: string | null;
  /** Plan slug, lower-cased for display. Null when the mirror has none yet. */
  plan: string | null;
  /** AttributionStatus — ACTIVE / ENDED / VOID. */
  status: string;
}

export interface MonthEarningsDTO {
  /** "2026-03" — sort key, never shown. */
  key: string;
  /** "March 2026". */
  label: string;
  accruedCents: number;
  /** Positive number: what refunds took back that month. */
  reversedCents: number;
  netCents: number;
}

/**
 * A line the partner must be able to read in words, with its date: money frozen
 * by an open dispute, or taken back by a lost one. Built on the server from the
 * ledger and the dispute record — never from anything that names the customer.
 */
export interface MoneyNoteDTO {
  /** Opaque key for React. */
  id: string;
  kind: "held" | "chargeback";
  /** Positive for a hold (what is frozen), negative for a chargeback. */
  amountCents: number;
  /** ISO — when the dispute opened (held) or was lost (chargeback). */
  date: string;
}

export interface PayoutRequestDTO {
  id: string;
  amountCents: number;
  status: string;
  rejectedReason: string | null;
  createdAt: string;
  approvedAt: string | null;
}

export interface TransferDTO {
  id: string;
  amountCents: number;
  status: string;
  failureReason: string | null;
  createdAt: string;
  paidAt: string | null;
}

export interface ConnectDTO {
  payoutsEnabled: boolean;
  /** ConnectStatus — NONE / ONBOARDING / RESTRICTED / ENABLED / DISABLED. */
  status: string;
}

/** Everything the partner's own record contributes to the three surfaces. */
export interface PartnerDTO {
  displayName: string;
  holdDays: number;
  minPayoutCents: number;
  currency: string;
  connect: ConnectDTO;
}
