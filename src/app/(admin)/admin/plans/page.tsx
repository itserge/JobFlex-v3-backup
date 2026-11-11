// Admin · Pricing plans — Blueprint edition.
//
// The catalog editor (source of truth for every plan surface) plus the promo
// code roster. The admin layout mounts the blueprint shell; this page renders
// only the `.content` children through components/v3/admin-plans.

import type { Metadata } from "next";
import { requirePlatformAdmin } from "@/lib/orgContext";
import { db } from "@/lib/db";
import { isStripeEnabled } from "@/lib/sdk/stripe";
import { getStripeMode, stripeKeyFor } from "@/lib/stripeMode";
import { parsePlanLimits, withPaidCallDefaults } from "@/lib/planLimits";
import { parseFeatures } from "@/lib/planCatalogServer";
import { getCustomPlanTrialDays } from "@/lib/customPlanConfig";
import { CUSTOM_BASE_CENTS, CUSTOM_PAGE_CENTS, CUSTOM_PAGES } from "@/lib/customPlan";
import { describeCommission } from "@/lib/commission";
import { readToolPrices } from "@/lib/toolPlans/prices";
import { ToolPricesPanel } from "@/components/v3/admin-plans/tool-prices-panel";
import {
  AdminPlansContent,
  type HydratedPlan,
  type SyncedInfo,
  type PromoDTO,
} from "@/components/v3/admin-plans/admin-plans-content";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "JobFlex Admin · Plans",
  description: "Pricing plans, limits and Stripe sync — the source of truth for every plan surface.",
};

export default async function AdminPlansPage() {
  await requirePlatformAdmin();
  const [plans, planPrices, promoCodes, customTrialDays, toolPrices] = await Promise.all([
    db.pricingPlan.findMany({ orderBy: { order: "asc" } }),
    db.planPrice.findMany({ where: { active: true } }),
    db.promoCode.findMany({
      orderBy: { createdAt: "desc" },
      include: { influencer: { select: { displayName: true } } },
    }),
    getCustomPlanTrialDays(),
    readToolPrices({ fresh: true }),
  ]);

  const hydrated: HydratedPlan[] = plans.map((p) => ({
    id: p.id,
    slug: p.slug,
    name: p.name,
    description: p.description,
    priceCents: p.priceCents,
    yearlyPriceCents: p.yearlyPriceCents,
    trialDays: p.trialDays,
    interval: p.interval,
    order: p.order,
    features: parseFeatures(p.features),
    // The paid lookups show the number the engine meters at, the tier default when the row has none.
    limits: withPaidCallDefaults(parsePlanLimits(p.limitsJson), p.slug),
    active: p.active,
    highlight: p.highlight,
  }));

  // Per-slug Stripe sync status for the synced/not-synced plate.
  const synced: Record<string, SyncedInfo> = {};
  for (const pp of planPrices) {
    const s = (synced[pp.planSlug] ??= { monthly: false, yearly: false });
    if (pp.interval === "MONTH") s.monthly = true;
    if (pp.interval === "YEAR") s.yearly = true;
  }

  const promos: PromoDTO[] = promoCodes.map((p) => ({
    id: p.id,
    code: p.code,
    influencerName: p.influencer.displayName,
    customerPercentOff: p.customerPercentOff,
    commission: describeCommission(p),
    active: p.active,
    clicks: p.clicks,
  }));

  return (
    <>
    <AdminPlansContent
      plans={hydrated}
      synced={synced}
      stripeEnabled={isStripeEnabled()}
      promos={promos}
      customPlan={{
        trialDays: customTrialDays,
        baseCents: CUSTOM_BASE_CENTS,
        pageCents: CUSTOM_PAGE_CENTS,
        pages: CUSTOM_PAGES.map((p) => p.label),
      }}
      stripeMode={await getStripeMode()}
      stripeModes={{ live: Boolean(stripeKeyFor("live")), test: Boolean(stripeKeyFor("test")) }}
    />
      {/* The new plans' prices (Base + Tools, part 2, 2026-11-10) — used once the Plans switch on Trial watch is on. */}
      <ToolPricesPanel initial={toolPrices} />
    </>
  );
}
