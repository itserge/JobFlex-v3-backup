// MOBILE PLANS & UPGRADE — /mobile-upgrade-v1
//
// The direct-review entry point for the handheld build of /dashboard/upgrade:
// always the mobile design, at any width, so the composition can be opened on a
// desktop browser without resizing. The live URL keeps its own viewport switch
// (app/dashboard/upgrade/upgrade-responsive.tsx) and serves this SAME component
// at ≤768px — one implementation, two entry points.
//
// REAL DATA, NOT A FIXTURE. This route runs the same loader as the desktop
// page: the live catalog /admin/plans drives (getPlanCatalog — never a copy),
// the org's subscription row, its custom-plan pages, the Stripe mode switch,
// and the ?session_id return leg verified against Stripe under that same mode.
// The loader is DUPLICATED here rather than extracted, deliberately: the
// desktop page file is the behaviour of record for the live URL and this work
// is not permitted to restructure it.
//
// Auth: middleware only matches /dashboard and /admin, so this route enforces
// its own redirect-to-login like every other (mobile) design route.

import { redirect } from "next/navigation";
import type { Metadata, Viewport } from "next";
import { requireOrg, isOwnerRole } from "@/lib/orgContext";
import { db } from "@/lib/db";
import { getPlanCatalog } from "@/lib/planCatalogServer";
import { isStripeEnabled } from "@/lib/sdk/stripe";
import { getStripeMode } from "@/lib/stripeMode";
import { normalizeCustomPages } from "@/lib/customPlan";
import { FREE_PLAN_NAME, freeSwitchBooked, freeSwitchDate, onFreePlan } from "@/lib/freePlan";
import { titleCaseSlug } from "@/lib/planCatalog";
import { customPlanOffered } from "@/lib/customPlanFlag";
import { MobileUpgradeContent } from "@/components/v3/mobile-upgrade/mobile-upgrade";
import type { UpgradePlan } from "@/components/v3/upgrade-blueprint/upgrade-content";
import { applyCheckoutReturn } from "@/lib/checkoutReturn";
import { planTermState } from "@/lib/planChange";
import { isToolsSlug } from "@/lib/toolPlans/shared";
import { TOOLS_SUBSCRIPTION_HREF } from "@/lib/toolPlans/billing";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Plans & upgrade · JobFlex Mobile",
  description: "Compare the plans, switch tiers, or build a custom plan page by page.",
};

// Handheld build: lock the scale so the layout is read at true device width,
// and pay out the notch / home-indicator insets the shell reserves.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#0a0a0a",
};

/** The checkout return, processed once (lib/checkoutReturn): a second visit
 *  of the same success URL changes nothing. */
function verifyReturn(organizationId: string, sessionId: string): Promise<string | null> {
  return applyCheckoutReturn(organizationId, sessionId, "mobile-upgrade");
}

export default async function MobileUpgradeV1Page({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string; checkout?: string }>;
}) {
  let ctx: Awaited<ReturnType<typeof requireOrg>>;
  try {
    ctx = await requireOrg();
  } catch {
    redirect("/auth/login?next=%2Fmobile-upgrade-v1");
  }

  /* A NEW-PLAN SHOP (Base + Tools, part 4 — owner, 2026-11-10) has no Classic plan cards to compare: its sizes and
     tools live on the Subscription page's own section. A Classic shop goes on to this page exactly as before. */
  const planRow = await db.subscription.findUnique({ where: { organizationId: ctx.organizationId }, select: { plan: true } }).catch(() => null);
  if (isToolsSlug(planRow?.plan)) redirect(TOOLS_SUBSCRIPTION_HREF);

  const params = await searchParams;
  const upgradedTo = params.session_id
    ? await verifyReturn(ctx.organizationId, params.session_id)
    : null;

  const [catalog, sub, mode, term] = await Promise.all([
    getPlanCatalog(),
    db.subscription.findUnique({
      where: { organizationId: ctx.organizationId },
      select: { plan: true, status: true, provider: true, canceledAt: true, currentPeriodEnd: true, trialEndsAt: true },
    }),
    getStripeMode(),
    planTermState(ctx.organizationId).catch(() => ({ currentInterval: null, scheduledSwitch: null })),
  ]);

  // The pages a custom-plan org owns, for the "add a page" card.
  let customPages: string[] = [];
  if ((sub?.plan ?? "").toUpperCase() === "CUSTOM") {
    const row = await db.syncState
      .findUnique({ where: { key: `orgPages:${ctx.organizationId}` } })
      .catch(() => null);
    try {
      customPages = normalizeCustomPages(row ? (JSON.parse(row.cursor) as string[]) : []);
    } catch {
      customPages = [];
    }
  }

  // On the Free plan (lib/freePlan) no card is current: each one is paid at once.
  const onFree = onFreePlan(sub);
  // Booked: the date it switches, and the way back (lib/freePlan).
  const freeSwitch =
    sub && sub.provider !== "MANUAL" && freeSwitchBooked(sub)
      ? { at: freeSwitchDate(sub)?.toISOString() ?? null, planName: catalog.find((p) => p.slug.toLowerCase() === sub.plan.toLowerCase())?.name ?? titleCaseSlug(sub.plan) }
      : null;

  const plans: UpgradePlan[] = catalog
    .filter((p) => !p.isFree)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      description: p.description,
      priceCents: p.priceCents,
      yearlyPriceCents: p.yearlyPriceCents,
      trialDays: p.trialDays,
      features: p.features,
      limits: p.limits,
      highlight: p.highlight,
    }));

  return (
    <MobileUpgradeContent
      plans={plans}
      currentPlan={onFree ? FREE_PLAN_NAME : (sub?.plan ?? null)}
      currentInterval={onFree ? null : term.currentInterval}
      freeSwitch={freeSwitch}
      scheduledSwitch={term.scheduledSwitch}
      customPages={customPages}
      isOwner={isOwnerRole(ctx.role)}
      checkoutReady={isStripeEnabled()}
      customOffered={customPlanOffered()}
      sandbox={mode === "test"}
      upgradedTo={upgradedTo}
      cancelled={params.checkout === "cancelled"}
    />
  );
}
