import { cookies } from "next/headers";
import { db } from "@/lib/db";
import {
  ATTR_COOKIE,
  CODE_RE,
  parseAttr,
  type AttributionKind,
  type CapturedAttribution,
} from "@/lib/attributionShared";

// Server side of the pre-signup attribution loop. The cookie is captured
// intent from untrusted client code — everything here re-resolves the raw
// code against the database before acting on it.
//
// Two kinds, two records:
//   promo (influencer) → stamp on Organization (first-write-wins). The money
//     record stays Stripe-truth (Attribution model, created by stripeSync);
//     the stamp only drives the signup pill + checkout auto-apply.
//   ref (member referral) → a PENDING ReferralConversion, advanced to
//     CONVERTED by the Stripe webhook on the referred org's first paid invoice.

export type ValidatedAttribution =
  | {
      kind: "promo";
      code: string;
      promoId: string;
      /** Needed to resolve the code on a NON-live Stripe account: the twin's
       *  percent is read off the live coupon when the mirror column is null
       *  (lib/influencerPromoMode). */
      stripeCouponId: string;
      stripePromotionCodeId: string;
      displayName: string;
      percentOff: number | null;
      /** PAID months the discount lasts (PromoCode.customerDiscountMonths, null = 1 — lib/promoDiscount). */
      discountMonths: number | null;
    }
  | { kind: "ref"; code: string; refCodeId: string; displayName: string; referrerEmail: string | null };

/** Read the captured attribution cookie in a server context (null outside a request). */
export async function readAttributionCookie(): Promise<CapturedAttribution | null> {
  try {
    return parseAttr((await cookies()).get(ATTR_COOKIE)?.value);
  } catch {
    return null;
  }
}

/**
 * Resolve a captured code to its live owner. Null for anything that shouldn't
 * attract signups: unknown code, deactivated promo, a suspended or terminated
 * influencer. PENDING counts as live: that is a partner whose invite is still
 * out — their code is already being shared, and the accrual in lib/stripeSync
 * pays PENDING partners for the same reason.
 */
export const INFLUENCER_LIVE_STATUSES = ["ACTIVE", "PENDING"] as const;
export async function validateAttribution(
  kind: AttributionKind,
  rawCode: string
): Promise<ValidatedAttribution | null> {
  const code = rawCode.trim().toUpperCase();
  if (!CODE_RE.test(code)) return null;

  if (kind === "promo") {
    const promo = await db.promoCode.findUnique({
      where: { code },
      select: {
        id: true,
        code: true,
        active: true,
        customerPercentOff: true,
        customerDiscountMonths: true,
        stripeCouponId: true,
        stripePromotionCodeId: true,
        influencer: { select: { displayName: true, status: true } },
      },
    });
    if (!promo?.active || !(INFLUENCER_LIVE_STATUSES as readonly string[]).includes(promo.influencer.status)) {
      return null;
    }
    return {
      kind: "promo",
      code: promo.code,
      promoId: promo.id,
      stripeCouponId: promo.stripeCouponId,
      stripePromotionCodeId: promo.stripePromotionCodeId,
      displayName: promo.influencer.displayName,
      percentOff: promo.customerPercentOff ?? null,
      discountMonths: promo.customerDiscountMonths ?? null,
    };
  }

  const ref = await db.referralCode.findUnique({
    where: { code },
    select: { id: true, code: true, user: { select: { name: true, email: true } } },
  });
  if (!ref) return null;
  return {
    kind: "ref",
    code: ref.code,
    refCodeId: ref.id,
    displayName: ref.user.name?.trim() || "a JobFlex member",
    referrerEmail: ref.user.email ?? null,
  };
}

/**
 * Permanently link a freshly created org to its captured code. Best-effort by
 * design — callers wrap it in try/catch; a bad code silently binds nothing.
 * First-write-wins is enforced in SQL (the null predicate), not in JS.
 */
export async function bindAttributionToOrg(
  orgId: string,
  signupEmail: string,
  kind: AttributionKind,
  code: string
): Promise<void> {
  const valid = await validateAttribution(kind, code);
  if (!valid) return;

  if (valid.kind === "promo") {
    await db.organization.updateMany({
      where: { id: orgId, signupPromoCodeId: null },
      data: {
        signupPromoCode: valid.code,
        signupPromoCodeId: valid.promoId,
        attributionCapturedAt: new Date(),
      },
    });
    return;
  }

  // Referral: no self-referrals, one conversion per signup org.
  if (valid.referrerEmail && valid.referrerEmail.toLowerCase() === signupEmail.toLowerCase()) return;
  const existing = await db.referralConversion.findFirst({
    where: { signupOrgId: orgId },
    select: { id: true },
  });
  if (existing) return;
  await db.referralConversion.create({
    data: { codeId: valid.refCodeId, signupEmail, signupOrgId: orgId, status: "PENDING" },
  });
  // Tell the referrer's org on the bell + referrals badge (same voice as
  // recordReferralConversion). Best-effort — attribution must never be able
  // to fail a signup.
  try {
    const codeRow = await db.referralCode.findUnique({
      where: { id: valid.refCodeId },
      select: { organizationId: true },
    });
    if (codeRow?.organizationId) {
      await db.activityEvent.create({
        data: {
          organizationId: codeRow.organizationId,
          kind: "CREATED",
          summary: `Someone signed up with your referral link (${signupEmail})`,
        },
      });
    }
  } catch {
    /* best-effort */
  }
}
