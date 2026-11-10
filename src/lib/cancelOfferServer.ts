// WHAT THE CANCEL WINDOW NEEDS (owner, 2026-11-09: the way out moved from
// Settings → Billing to the Subscription page — CLAUDE.md, Owner-locked
// decisions). Read by the Subscription page's loader for its owner only;
// null means there is no "Cancel subscription" button at all.
//
// Who gets the button: the owner of a live subscription that is not a grant
// (provider MANUAL) and has no switch to Free booked yet. A plan whose access
// already lapsed to Free while Stripe still renews it gets it too — the
// window then cancels only the renewal (`accessAlreadyFree`).
//
// Server-only (Prisma). The client imports the types alone.

import { db } from "@/lib/db";
import { readHeldDeckAddon } from "@/lib/deckAddonBilling";
import { deckAddonHeldWords } from "@/lib/deckAddon";
import { DEFAULT_FREE_LIMITS, isUnlimited, parsePlanLimits } from "@/lib/planLimits";
import { readCustomPages } from "@/lib/customPageAccess";
import { CUSTOM_PLAN_LIMITS_SLUG, CUSTOM_PLAN_SLUG } from "@/lib/customPlan";
import { planLapsed } from "@/lib/planStatus";
import { isStripeEnabled } from "@/lib/sdk/stripe";
import { LIVE_STATUSES, freePlanLosses, freeSwitchBooked, freeSwitchDate, type FreeLoss, type FreeTally } from "@/lib/freePlan";
import { trialExtensionOffer } from "@/lib/trialExtensionServer";
import type { TrialExtensionOffer } from "@/lib/trialExtension";

export interface CancelOffer {
  planName: string;
  /** ISO end of the paid cycle (or trial): what the plan is kept until. */
  keepsUntil: string | null;
  /** What the plan gives that Free does not (lib/freePlan). */
  losses: FreeLoss[];
  /** The company's own numbers (lib/freePlan freeTallyTiles draws them). */
  tally: FreeTally;
  /** Access already lapsed to Free while the Stripe subscription still renews. */
  accessAlreadyFree?: boolean;
  /** Screen C1, "Want 7 or 14 more days?" — only on the trial or within 14
   *  days after it (lib/trialExtension); null skips the screen. */
  extension?: TrialExtensionOffer | null;
}

type SubRow = Awaited<ReturnType<typeof db.subscription.findUnique>>;

export async function loadCancelOffer(organizationId: string, sub: SubRow, planName: string): Promise<CancelOffer | null> {
  if (!sub || sub.provider === "MANUAL" || freeSwitchBooked(sub)) return null;
  if (!(LIVE_STATUSES as readonly string[]).includes(sub.status)) return null;
  const lapsed = planLapsed(sub);
  const stripeSub = sub.provider === "STRIPE" && Boolean(sub.externalSubId) && isStripeEnabled();
  if (lapsed && !stripeSub) return null;
  const [offer, extension] = await Promise.all([
    offerWords(organizationId, sub.plan, lapsed ? null : freeSwitchDate(sub), planName, lapsed),
    lapsed ? null : trialExtensionOffer(organizationId, sub),
  ]);
  return { ...offer, extension };
}

/** The plan's lines Free does not keep, and the company's own numbers
 *  (proposals sent, what they quoted, clients). */
async function offerWords(organizationId: string, plan: string, keepsUntil: Date | null, planName: string, accessAlreadyFree: boolean): Promise<CancelOffer> {
  const slug = plan.toLowerCase();
  const [pages, catalog, sent, clients, deck] = await Promise.all([
    readCustomPages(organizationId, plan).catch(() => null),
    db.pricingPlan.findMany({ select: { slug: true, limitsJson: true } }),
    db.proposal.groupBy({ by: ["currency"], where: { organizationId, sentAt: { not: null } }, _count: { _all: true }, _sum: { total: true } }),
    db.client.count({ where: { organizationId, deletedAt: null } }),
    // The Deck Studio add-on on the subscription (lib/deckAddonBilling): the cancel ends it with the plan — named at
    // the price its line bills ($49/mo for one bought before 2026-10-26).
    readHeldDeckAddon(organizationId).catch(() => null),
  ]);
  const limitsOf = (s: string) => {
    const row = catalog.find((p) => p.slug.toLowerCase() === s);
    return row ? parsePlanLimits(row.limitsJson) : null;
  };
  const cap = (n: number | null | undefined) => (isUnlimited(n) ? null : (n as number));
  const own = limitsOf(slug === CUSTOM_PLAN_SLUG ? CUSTOM_PLAN_LIMITS_SLUG : slug);
  const free = limitsOf("free") ?? DEFAULT_FREE_LIMITS;
  return {
    planName,
    keepsUntil: keepsUntil?.toISOString() ?? null,
    losses: freePlanLosses({ pages, planProposals: cap(own?.proposalsCreated), freeProposals: cap(free.proposalsCreated), deckAddon: deck ? deckAddonHeldWords(deck.cents, deck.interval, { mark: false }) : null }),
    tally: {
      proposalsSent: sent.reduce((n, g) => n + g._count._all, 0),
      quoted: sent.length === 1 ? { amount: sent[0]._sum.total ?? 0, currency: sent[0].currency.toUpperCase() } : null,
      clients,
    },
    ...(accessAlreadyFree ? { accessAlreadyFree: true } : {}),
  };
}
