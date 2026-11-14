// META StartTrial (ad owner, 2026-10-22): the pixel's StartTrial, sent from the browser on the first dashboard
// render after the card went in on Stripe's page — the password sign-up and the Google one alike, both create the
// subscription in signupCheckout. This is the server half: whether the event is due and what it carries; the
// browser half (components/dashboard/MetaStartTrial) sends it once per company. No Conversions API copy.
//
// DUE only on the live site (VERCEL_ENV=production, where layout.tsx loads the pixel), for a Stripe subscription
// (not a grant or a manual one) that is TRIALING and began within the hour — so a deploy never fires it for the
// companies already on a trial. A sign-up writes the subscription row when its trial starts, so the row's
// createdAt is that moment.
import { db } from "@/lib/db";
import { getPlanCatalog } from "@/lib/planCatalogServer";
import { readToolCatalog } from "@/lib/toolPlans/prices";
import { isToolsSlug } from "@/lib/toolPlans/shared";

const FRESH_MS = 60 * 60 * 1000;

export type MetaStartTrialEvent = {
  /** The once-per-company key the browser remembers. */
  organizationId: string;
  /** The plan's price for one billing period after the trial, in dollars. */
  value: number;
  currency: "USD";
  /** Twelve months of the plan. */
  predictedLtv: number;
  /** The plan's slug ("professional"). */
  contentName: string;
};

/** The StartTrial due for this company now, or null. Never throws. */
export async function metaStartTrialEvent(organizationId: string, now = new Date()): Promise<MetaStartTrialEvent | null> {
  if (process.env.VERCEL_ENV !== "production") return null;
  try {
    const sub = await db.subscription.findUnique({
      where: { organizationId },
      select: { plan: true, status: true, provider: true, externalSubId: true, trialEndsAt: true, stripePriceId: true, createdAt: true },
    });
    if (!sub || sub.provider !== "STRIPE" || !sub.externalSubId || sub.status !== "TRIALING") return null;
    if (!sub.trialEndsAt || sub.trialEndsAt <= now) return null;
    if (now.getTime() - sub.createdAt.getTime() > FRESH_MS) return null;
    // The price the subscription carries: its Stripe price when the catalog mirrors it, else the plan's catalog
    // price for that term (the same reading as lib/autoPlanWelcome).
    const slug = sub.plan.toLowerCase();
    const [catalog, price] = await Promise.all([
      getPlanCatalog({ includeInactive: true }),
      sub.stripePriceId ? db.planPrice.findUnique({ where: { stripePriceId: sub.stripePriceId }, select: { interval: true, unitAmountCents: true } }) : null,
    ]);
    const plan = catalog.find((p) => p.slug === slug);
    const yearly = price?.interval === "YEAR";
    // A new plan ("tools-…", lib/toolPlans) has no catalog row and no PlanPrice: its monthly price in force. Without
    // this every new-plan trial (the Plans switch, 2026-11-11) priced at null and Meta heard no StartTrial at all.
    const toolsCents = !price && isToolsSlug(slug) ? (await readToolCatalog()).plans.find((p) => p.slug === slug)?.cents : undefined;
    const cents = price?.unitAmountCents ?? toolsCents ?? (yearly ? plan?.yearlyPriceCents : plan?.priceCents) ?? null;
    if (!cents || cents <= 0) return null;
    const value = cents / 100;
    return { organizationId, value, currency: "USD", predictedLtv: yearly ? value : Math.round(value * 12 * 100) / 100, contentName: slug };
  } catch (err) {
    console.warn("[metaStartTrial] read failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
