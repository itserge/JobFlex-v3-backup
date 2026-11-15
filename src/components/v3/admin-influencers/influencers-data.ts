// ADMIN INFLUENCERS — the wire shapes and the one piece of vocabulary the page
// owns: how an earning model reads in plain English. No DB, no React.

import type { LedgerBalances } from "@/lib/commission";
import type { InfluencerRollup } from "@/actions/influencers";
import { discountMonths, discountShort, discountSummary, foreverPhrase } from "@/lib/promoDiscount";

export type { InfluencerRollup };

export interface PromoDTO {
  id: string;
  code: string;
  active: boolean;
  commissionType: string;
  commissionRateBps: number | null;
  commissionFlatCents: number | null;
  commissionBasis: string;
  durationType: string;
  durationMonths: number | null;
  customerPercentOff: number | null;
  /** Paid months the discount lasts (null = 1, lib/promoDiscount). */
  customerDiscountMonths: number | null;
  /** A replaced code's history row (actions/influencers replacePromoDiscount): code is "<CODE>~<n>". */
  replaced: boolean;
  /** Its Stripe coupon is `forever` — minted before 2026-09-03 (lib/promoCouponDuration). */
  couponForever: boolean;
  clicks: number;
  conversions: number;
  /** Written before the limit (lib/commissionLimits), or the plans got cheaper. */
  aboveLimit: boolean;
}

export interface InfluencerDTO {
  id: string;
  displayName: string;
  email: string;
  status: string;
  connectStatus: string;
  payoutsEnabled: boolean;
  minPayoutCents: number;
  holdDays: number;
  notes: string | null;
  hasPassword: boolean;
  createdAt: string;
  promoCodes: PromoDTO[];
  clicks: number;
  conversions: number;
  balances: LedgerBalances;
  pendingRequests: number;
  lastPayoutAt: string | null;
  lastPayoutCents: number | null;
}

/* ============================================================
   EARNING MODEL — exactly the fields createInfluencer / createPromoCode /
   updatePromoCommission accept, kept in the admin's units (percent points,
   whole dollars); the action converts to bps / cents.
   ============================================================ */

export type CommissionType = "PERCENT" | "FLAT";
export type CommissionBasis = "NET" | "GROSS";
export type DurationType = "ONCE" | "REPEATING" | "FOREVER";

export interface EarningModel {
  /** What the CUSTOMER saves at checkout (the Stripe coupon). */
  customerPercentOff: number;
  /** For how many paid months — AS TYPED, so the form can say what is wrong
   *  with "", "0" or "2.5" before anything is sent (lib/promoDiscount). */
  customerDiscountMonths: string;
  commissionType: CommissionType;
  /** Percent points when PERCENT, dollars when FLAT. */
  commissionValue: number;
  commissionBasis: CommissionBasis;
  durationType: DurationType;
  durationMonths: number;
}

export const DEFAULT_MODEL: EarningModel = {
  customerPercentOff: 10,
  customerDiscountMonths: "1",
  commissionType: "PERCENT",
  commissionValue: 20,
  commissionBasis: "NET",
  durationType: "REPEATING",
  durationMonths: 12,
};

export function promoToModel(p: PromoDTO): EarningModel {
  return {
    customerPercentOff: p.customerPercentOff ?? 0,
    customerDiscountMonths: String(discountMonths(p.customerDiscountMonths)),
    commissionType: p.commissionType === "FLAT" ? "FLAT" : "PERCENT",
    commissionValue:
      p.commissionType === "FLAT" ? (p.commissionFlatCents ?? 0) / 100 : (p.commissionRateBps ?? 0) / 100,
    commissionBasis: p.commissionBasis === "GROSS" ? "GROSS" : "NET",
    durationType:
      p.durationType === "ONCE" ? "ONCE" : p.durationType === "FOREVER" ? "FOREVER" : "REPEATING",
    durationMonths: p.durationMonths ?? 12,
  };
}

/** The payload shape every commission-bearing action parses. */
export function modelToInput(m: EarningModel) {
  return {
    customerPercentOff: m.customerPercentOff,
    customerDiscountMonths: Number(m.customerDiscountMonths),
    commissionType: m.commissionType,
    commissionValue: m.commissionValue,
    commissionBasis: m.commissionBasis,
    durationType: m.durationType,
    durationMonths: m.durationType === "REPEATING" ? m.durationMonths : undefined,
  };
}

function fmtPct(n: number): string {
  return Number.isInteger(n) ? `${n}%` : `${n.toFixed(1)}%`;
}
function fmtUsd(n: number): string {
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}

/**
 * What the PARTNER earns, as one clause: "earns 20% of net revenue for 12
 * months", "earns $15 flat per signup", "earns 10% of gross revenue for the
 * life of the subscription".
 */
export function describeEarning(m: EarningModel): string {
  const months = Math.max(1, Math.round(m.durationMonths || 1));
  const span = `${months} month${months === 1 ? "" : "s"}`;
  if (m.commissionType === "FLAT") {
    const amt = fmtUsd(m.commissionValue || 0);
    switch (m.durationType) {
      case "ONCE":
        return `earns ${amt} flat per signup`;
      case "REPEATING":
        return `earns ${amt} flat per payment for ${span}`;
      default:
        return `earns ${amt} flat on every payment, for life`;
    }
  }
  const pct = fmtPct(m.commissionValue || 0);
  const basis = m.commissionBasis === "GROSS" ? "gross" : "net";
  switch (m.durationType) {
    case "ONCE":
      return `earns ${pct} of ${basis} revenue on the first payment`;
    case "REPEATING":
      return `earns ${pct} of ${basis} revenue for ${span}`;
    default:
      return `earns ${pct} of ${basis} revenue for the life of the subscription`;
  }
}

/** The subscriber's side of a stored code: "Subscribers get 20% off for 3 months." */
export function describeDiscount(p: Pick<PromoDTO, "customerPercentOff" | "customerDiscountMonths" | "couponForever">): string {
  const pct = p.customerPercentOff ?? 0;
  if (p.couponForever && pct > 0) return `Subscribers get ${foreverPhrase(pct)} — the code's coupon is from before the first-month rule.`;
  return discountSummary(pct, p.customerDiscountMonths);
}

/** The code row's discount annotation: "20% · 3 mo" · "20% · forever". */
export function shortDiscount(p: Pick<PromoDTO, "customerPercentOff" | "customerDiscountMonths" | "couponForever">): string {
  const pct = p.customerPercentOff ?? 0;
  if (!(pct > 0)) return "none";
  return p.couponForever ? `${fmtPct(pct)} · forever` : discountShort(pct, p.customerDiscountMonths);
}

/** The partner's side, as the preview line under the commission fields. */
export function describeModel(m: EarningModel): string {
  return `Partner ${describeEarning(m)}.`;
}

/** Short annotation for the table / code row: "20% · 12 mo · net". */
export function shortModel(m: EarningModel): string {
  const amt = m.commissionType === "FLAT" ? `${fmtUsd(m.commissionValue)} flat` : fmtPct(m.commissionValue);
  const dur =
    m.durationType === "ONCE" ? "once" : m.durationType === "FOREVER" ? "lifetime" : `${m.durationMonths} mo`;
  return m.commissionType === "FLAT" ? `${amt} · ${dur}` : `${amt} · ${dur} · ${m.commissionBasis.toLowerCase()}`;
}

export const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Active",
  PENDING: "Pending",
  SUSPENDED: "Suspended",
  TERMINATED: "Terminated",
};
