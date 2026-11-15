import { requirePlatformAdmin } from "@/lib/orgContext";
import { db } from "@/lib/db";
import { ledgerBalances } from "@/lib/commission";
import { PayoutRequestStatus, PayoutTransferStatus } from "@/lib/prismaEnums";
import { getInfluencerRollup } from "@/actions/influencers";
import { cheapestPaidPlanCents, promoAboveLimit } from "@/lib/commissionLimits";
import { couponDurations } from "@/lib/promoCouponDuration";
import { isReplacedCode } from "@/lib/promoDiscount";
import { AdminInfluencersContent } from "@/components/v3/admin-influencers/influencers-content";
import type { InfluencerDTO } from "@/components/v3/admin-influencers/influencers-data";

export default async function AdminInfluencersPage() {
  await requirePlatformAdmin();

  const [influencers, rollup, cheapestPlanCents] = await Promise.all([
    db.influencer.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        promoCodes: {
          orderBy: { createdAt: "asc" },
          include: { _count: { select: { attributions: true } } },
        },
        ledgerEntries: { select: { entryType: true, amountCents: true, state: true } },
        _count: { select: { attributions: true } },
        payoutRequests: { where: { status: PayoutRequestStatus.PENDING }, select: { id: true } },
        transfers: {
          where: { status: PayoutTransferStatus.PAID },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { amountCents: true, paidAt: true, createdAt: true },
        },
      },
    }),
    getInfluencerRollup(),
    cheapestPaidPlanCents(),
  ]);
  // What each code's Stripe coupon really gives: a legacy `forever` coupon is
  // marked so it can be replaced (lib/promoCouponDuration — one read, then cached).
  const durations = await couponDurations(
    influencers.flatMap((i) => i.promoCodes.map((p) => p.stripeCouponId)),
    { read: true },
  );

  const dto: InfluencerDTO[] = influencers.map((inf) => {
    const last = inf.transfers[0];
    return {
      id: inf.id,
      displayName: inf.displayName,
      email: inf.email,
      status: inf.status,
      connectStatus: inf.connectStatus,
      payoutsEnabled: inf.payoutsEnabled,
      minPayoutCents: inf.minPayoutCents,
      holdDays: inf.holdDays,
      notes: inf.notes,
      hasPassword: Boolean(inf.hashedPassword),
      createdAt: inf.createdAt.toISOString(),
      // The current codes first; a replaced code's history row after them.
      promoCodes: [...inf.promoCodes].sort((a, b) => Number(isReplacedCode(a.code)) - Number(isReplacedCode(b.code))).map((p) => ({
        id: p.id,
        code: p.code,
        active: p.active,
        commissionType: p.commissionType,
        commissionRateBps: p.commissionRateBps,
        commissionFlatCents: p.commissionFlatCents,
        commissionBasis: p.commissionBasis,
        durationType: p.durationType,
        durationMonths: p.durationMonths,
        customerPercentOff: p.customerPercentOff,
        customerDiscountMonths: p.customerDiscountMonths,
        replaced: isReplacedCode(p.code),
        couponForever: durations.get(p.stripeCouponId)?.duration === "forever",
        clicks: p.clicks,
        conversions: p._count.attributions,
        aboveLimit: promoAboveLimit(p, cheapestPlanCents),
      })),
      clicks: inf.promoCodes.reduce((n, p) => n + p.clicks, 0),
      conversions: inf._count.attributions,
      balances: ledgerBalances(inf.ledgerEntries),
      pendingRequests: inf.payoutRequests.length,
      lastPayoutAt: last ? (last.paidAt ?? last.createdAt).toISOString() : null,
      lastPayoutCents: last ? last.amountCents : null,
    };
  });

  return <AdminInfluencersContent influencers={dto} rollup={rollup} />;
}
