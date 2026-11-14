// META StartTrial (ad owner, 2026-10-22): the pixel's StartTrial, sent from the browser on the first dashboard
// render after the card went in on Stripe's page — the password sign-up and the Google one alike, both create the
// subscription in signupCheckout. This is the server half: whether the event is due and what it carries; the
// browser half (components/dashboard/MetaStartTrial) sends it once per company. No Conversions API copy.
//
// DUE only on the live site (VERCEL_ENV=production, where layout.tsx loads the pixel), for a Stripe subscription
// (not a grant or a manual one) that is TRIALING and whose CARD WENT IN within the hour — so a deploy never fires it
// for the companies already on a trial.
//
// STARTTRIAL = THE CUSTOMER GAVE A CARD (owner, 2026-11-13). A card sign-up gave it on Stripe's page as its
// subscription was made (the row's createdAt). A card-less trial (lib/cardlessTrial, Admin → Trials) gave none at
// sign-up — no StartTrial then — and sends it when it adds one during the trial (its record's cardAt). A card-less
// trial that never adds a card never sends it.
import { db } from "@/lib/db";
import { getPlanCatalog } from "@/lib/planCatalogServer";
import { readToolCatalog } from "@/lib/toolPlans/prices";
import { isToolsSlug } from "@/lib/toolPlans/shared";
import { readCardlessRecord } from "@/lib/trialState";

const FRESH_MS = 60 * 60 * 1000;

export type MetaStartTrialEvent = {
  /** The once-per-company key the browser remembers. */
  organizationId: string;
  /** The plan's price for one billing period after the trial, in dollars; null when it can't be read. */
  value: number | null;
  currency: "USD";
  /** Twelve months of the plan; null with the price. */
  predictedLtv: number | null;
  /** The plan's slug ("professional", "tools-professional"). */
  contentName: string;
};

/** The StartTrial due for this company now, or null. Never throws.
 *  THE PRICE NEVER DECIDES WHETHER META HEARS THE TRIAL (owner, 2026-11-13): it only dresses the event. When the new
 *  plans (Plans switch, 2026-11-11) had no catalog price, a null price dropped every trial's StartTrial for two days
 *  while the ads optimized on it. An unpriced trial now goes without a value, and the log says so. */
export async function metaStartTrialEvent(organizationId: string, now = new Date()): Promise<MetaStartTrialEvent | null> {
  if (process.env.VERCEL_ENV !== "production") return null;
  let sub;
  try {
    sub = await db.subscription.findUnique({
      where: { organizationId },
      select: { plan: true, status: true, provider: true, externalSubId: true, trialEndsAt: true, stripePriceId: true, createdAt: true },
    });
  } catch (err) {
    console.warn("[metaStartTrial] read failed:", err instanceof Error ? err.message : err);
    return null;
  }
  if (!sub || sub.provider !== "STRIPE" || !sub.externalSubId || sub.status !== "TRIALING") return null;
  if (!sub.trialEndsAt || sub.trialEndsAt <= now) return null;
  // When the card went in: a card-less trial's cardAt (none yet = not due), else the card sign-up's subscription row.
  const cardless = await readCardlessRecord(organizationId);
  const cardAt = cardless ? (cardless.cardAt ? new Date(cardless.cardAt) : null) : sub.createdAt;
  if (!cardAt || Number.isNaN(cardAt.getTime()) || now.getTime() - cardAt.getTime() > FRESH_MS) return null;
  const slug = sub.plan.toLowerCase();
  const price = await planPrice(slug, sub.stripePriceId).catch((err) => {
    console.warn("[metaStartTrial] price read failed:", err instanceof Error ? err.message : err);
    return null;
  });
  if (!price) console.warn(`[metaStartTrial] no price for plan ${slug}: StartTrial sent without a value`);
  return { organizationId, value: price?.value ?? null, currency: "USD", predictedLtv: price?.ltv ?? null, contentName: slug };
}

/** The price the subscription carries: its Stripe price when the catalog mirrors it, else the plan's catalog price for
 *  that term (the same reading as lib/autoPlanWelcome); a new plan ("tools-…", lib/toolPlans) has no catalog row and no
 *  PlanPrice, so its monthly price in force (Admin → Plans). Null when none is found. */
async function planPrice(slug: string, stripePriceId: string | null): Promise<{ value: number; ltv: number } | null> {
  const [catalog, price] = await Promise.all([
    getPlanCatalog({ includeInactive: true }),
    stripePriceId ? db.planPrice.findUnique({ where: { stripePriceId }, select: { interval: true, unitAmountCents: true } }) : null,
  ]);
  const plan = catalog.find((p) => p.slug === slug);
  const yearly = price?.interval === "YEAR";
  const toolsCents = !price && isToolsSlug(slug) ? (await readToolCatalog()).plans.find((p) => p.slug === slug)?.cents : undefined;
  const cents = price?.unitAmountCents ?? toolsCents ?? (yearly ? plan?.yearlyPriceCents : plan?.priceCents) ?? null;
  if (!cents || cents <= 0) return null;
  const value = cents / 100;
  return { value, ltv: yearly ? value : Math.round(value * 12 * 100) / 100 };
}
