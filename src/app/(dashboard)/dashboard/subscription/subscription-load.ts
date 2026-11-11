import { isStripeEnabled } from "@/lib/sdk/stripe";
import { orgSpotlight } from "@/lib/planSpotlightServer";
import type { SpotlightTool } from "@/lib/planSpotlight";
import { getStripeMode } from "@/lib/stripeMode";
// The subscription surface's ONE data read.
//
// Shared by the handheld preview and the live URL. Billing contact and the
// complete usage snapshot are read here too, so both editions agree. Counts
// reuse the limits engine; provider allowances retain their own rules. No
// new server action, API route or schema is needed.
//
// Server-only by construction — it imports Prisma and two server actions, so a
// client component importing it would fail the build rather than leak.
//
// The OWNER-ONLY GUARD is deliberately NOT here: it belongs at the route, where
// the redirect target is a route-level decision, and burying an authorisation
// check inside a loader is how one gets forgotten. Both callers perform it
// before calling this, and `listSubscriptionInvoices` / `getOrCreateMyReferralCode`
// re-assert it themselves through requireOwner().

import { db } from "@/lib/db";
import { customPriceCents, normalizeCustomPages } from "@/lib/customPlan";
import { isPageLocked } from "@/lib/customPageAccess";
import { USAGE_ACCESS_PAGES, TRIAL_USAGE_ACCESS_PAGES } from "@/components/v3/subscription-blueprint/subscription-data";
import { customPlanOffered } from "@/lib/customPlanFlag";
import { REFERRAL_REWARD_PCT, settleReferralsForCode } from "@/lib/referralRewards";
import { getOrCreateMyReferralCode } from "@/actions/referrals";
import { listSubscriptionInvoices, type UpcomingInvoice } from "@/actions/billing";
import { getPlanCatalog, getOrgPlanContext } from "@/lib/planCatalogServer";
import { getOrgLimitOverview } from "@/lib/limitsEngine";
import { LIMIT_DEFS, type LimitScope } from "@/lib/planLimits";
import { titleCaseSlug, type PlanDTO } from "@/lib/planCatalog";
import type { SubscriptionInvoice } from "@/actions/billing";
import { readPlanGrant } from "@/lib/planGrant";
import { readAccessSubscription } from "@/lib/subscriptionAccess";
import { planLapsed } from "@/lib/planStatus";
import { FREE_PLAN_NAME, freeSince, freeSwitchBooked, freeSwitchDate, onFreePlan } from "@/lib/freePlan";
import { trialCardLine, type TrialCardLine } from "@/lib/trialCardLine";
import { planTermState } from "@/lib/planChange";
import { includedDeskMinutes } from "@/lib/aiDesk/minutes";
import { deskBalance, EMPTY_PACKS, EMPTY_USE, minutesOf, monthKey, parseDeskPacks, parseDeskUse } from "@/lib/aiDesk/shared";
import { smsAllowanceFor } from "@/lib/entitlements";
import { toolsSmsAllowance } from "@/lib/toolPlans/allowances";
import { cardlessTrialState } from "@/lib/trialState";
import { TRIAL_CAPS, TRIAL_CAP_KEYS, TRIAL_CAP_NOUN } from "@/lib/trialCaps";
import { loadCancelOffer, type CancelOffer } from "@/lib/cancelOfferServer";
import { loadToolsModel } from "@/lib/toolPlans/view";
import { YEAR_MONTHS, type ToolsSubscriptionModel } from "@/lib/toolPlans/shared";

// The result shape. These interfaces lived in ./subscription-view.tsx until
// 2026-08-13, when that desktop view was superseded by the blueprint page at
// src/app/dashboard/subscription (which renders SubscriptionContent and owns
// the /dashboard/subscription URL at every width). The loader survived the
// move because the /mobile-subscription-v2 preview page feeds from it, so the
// types it promises now live with it.
export interface UsageRow {
  resource: string;
  label: string;
  used: number;
  limit: number;
  scope?: LimitScope;
  hint?: string;
  /** Included allowance; extra usage may be covered by a separate provider pool. */
  informational?: boolean;
}

export interface SubscriptionViewProps {
  /** Display name of the current plan (catalog name, or title-cased orphan slug). */
  planName: string;
  /** The current plan's price for the term it is billed on (the year's for a
   *  yearly subscription — owner, 2026-10-12); null when the slug left the catalog. */
  priceCents: number | null;
  /** The term the subscription is billed on; null when it cannot be told. */
  interval?: "MONTH" | "YEAR" | null;
  /** A booked YEAR → MONTH switch (lib/planChange). */
  scheduledSwitch?: { at: string; planName: string; interval: "MONTH" | "YEAR" } | null;
  /** Lowercase slug used to mark "current" in the spectrum + matrix. */
  currentSlug: string;
  /** Active catalog plans, display-ordered. */
  plans: PlanDTO[];
  /** The tool the signup came for (lib/planSpotlight): pinned and marked on every plan card. */
  spotlight?: SpotlightTool | null;
  status: string;
  accessBlocked?: boolean;
  nextBill: string | null;
  trialEndsAt: string | null;
  /** A cancellation is booked for the end of this cycle (billing.ts's
   *  cancelSubscription mirrors Stripe's cancel_at_period_end here). */
  cancelAtPeriodEnd: boolean;
  /** A plan that ended without moving to Free — a grant that expired
   *  (EXPIRED): "Access ended <date>", no next bill. Null otherwise. */
  cancellation: { accessUntil: string | null; ended: boolean } | null;
  /** The switch to Free is booked (owner, 2026-10-13; lib/freePlan): the plan
   *  runs until `at`, then the company is on Free. "Keep <plan>" lifts it. */
  freeSwitch?: { at: string | null } | null;
  /** The company is on the Free plan (its subscription ended — CANCELED):
   *  since when, and the plan it had. planName then reads "Free". */
  freePlan?: { since: string | null; wasName: string } | null;
  /** The plan is a complimentary grant from JobFlex (lib/planGrant): nobody
   *  pays, nothing is billed, and it ends on `endsAt` (null = no end date). */
  complimentary: { endsAt: string | null; after: "free" | "expired" } | null;
  /** The limits engine's enforced caps for this org (unlimited keys omitted). */
  usage: UsageRow[];
  /** Every accessible uncapped resource, including a real zero count. */
  usageUnlimited?: { resource: string; label: string; used: number; scope?: LimitScope; hint?: string }[];
  /** Failed reads remain unknown instead of appearing as zero usage. */
  usageUnavailable?: { resource: string; label: string; limit: number | null; scope: LimitScope; hint: string }[];
  /** Existing Stripe card setup flow; the endpoint rechecks live eligibility. */
  canUpdatePaymentCard?: boolean;
  /** Organization billing contact, edited by the existing Settings Billing pane. */
  billingInformation?: { name: string; billingEmail: string } | null;
  /** Plan caps do not apply to this user here (lib/limitsEngine). Provider
   *  allowances, including AI desk minutes, still apply. */
  usageExempt?: boolean;
  invoices: { available: boolean; invoices: SubscriptionInvoice[]; upcoming?: UpcomingInvoice | null };
  /** The next charge and what the org's referrals take off it; null when
   *  nothing is going to be billed (no subscription, no priced plan). */
  nextCharge: NextCharge | null;
  /** A card-less trial's card (lib/trialCardLine): "None yet" with the way to
   *  add one, or the card on file. Null for every other organization. */
  trialCard?: TrialCardLine | null;
  /** Pages a CUSTOM-plan org owns (lib/customPlan ids); [] otherwise. */
  customPages?: string[];
  /** "Cancel subscription" at the foot of the plan card and what its window
   *  asks and says (lib/cancelOfferServer — the one place an owner cancels,
   *  2026-11-09). Null: no button (a grant, nothing live, already booked). */
  cancel?: CancelOffer | null;
  /** What the embedded plan cards need to offer checkout (owner-only page). */
  checkoutReady: boolean;
  /** CUSTOM_PLAN_ENABLED (lib/customPlanFlag): "Build your plan" on sale. */
  customOffered: boolean;
  sandbox: boolean;
  /** THE NEW PLANS (Base + Tools, part 3b): the plan, the shop's tools and what it can add (lib/toolPlans/view).
   *  Only for a shop whose plan is a "tools-" slug; null (or absent) for every Classic shop, whose page is unchanged. */
  tools?: (ToolsSubscriptionModel & { lapsed: boolean }) | null;
  referral: {
    code: string;
    rewardSummary: string;
    uses: number;
    converted: number;
    pending: number;
  };
}

/** The next bill as the Billing history card draws it (owner, 2026-09-14):
 *  when it is charged, what it comes to, and how much of it the people who
 *  used the org's referral code are paying for. */
export interface NextCharge {
  /** ISO date of the charge; null when Stripe has not scheduled one. */
  dueAt: string | null;
  /** The plan before anything comes off. */
  subtotalCents: number;
  /** Coupons on the subscription ("Referral coupon −$2.50"). */
  discountNotes: string[];
  discountCents: number;
  /** Referral credit taken off THIS bill. */
  referralCreditCents: number;
  /** How many referrals that credit comes from. */
  referralCount: number;
  /** Credit left over after this bill, carried to the next one. */
  creditLeftCents: number;
  /** What one more paid referral would take off (50% of a month). */
  perReferralCents: number;
  /** Signed up with the code, not subscribed yet. */
  pendingReferrals: number;
  /** What will actually be charged. */
  amountDueCents: number;
  /** True when Stripe could not preview the bill and it was worked out here. */
  estimated: boolean;
}

/** Stripe keeps one credit balance, not one credit per referral, so the
 *  referrals behind a credit are counted oldest-first: the newest rewards are
 *  the ones still unspent, and a bill spends the oldest of those first. */
function referralsBehind(rewardsNewestFirst: number[], balanceCents: number, spentCents: number): number {
  const unspent: number[] = [];
  let sum = 0;
  for (const cents of rewardsNewestFirst) {
    if (sum >= balanceCents) break;
    unspent.push(cents);
    sum += cents;
  }
  let count = 0;
  let used = 0;
  for (const cents of unspent.reverse()) {
    if (used >= spentCents) break;
    count += 1;
    used += cents;
  }
  return count;
}

export async function loadSubscriptionData(
  organizationId: string,
): Promise<SubscriptionViewProps> {
  const [sub, planContext, plans, limitOverview, code, trialCard, term, billingInformation] = await Promise.all([
    readAccessSubscription(organizationId),
    getOrgPlanContext(organizationId),
    getPlanCatalog(),
    getOrgLimitOverview(organizationId, undefined, { includeUnlimitedUsage: true }),
    getOrCreateMyReferralCode(),
    trialCardLine(organizationId).catch(() => null),
    planTermState(organizationId).catch(() => ({ currentInterval: null, scheduledSwitch: null })),
    db.organization.findUnique({ where: { id: organizationId }, select: { name: true, billingEmail: true } }),
  ]);
  // Follow the same fail-closed page entitlement check as each add-on's
  // server boundary. A zero quota is still an accessible resource, not hidden.
  const access = await Promise.all(limitOverview.usage.map(async (entry) => {
    const pages = USAGE_ACCESS_PAGES[entry.resource];
    return !pages || !(await isPageLocked(organizationId, pages));
  }));
  const limitUsage = limitOverview.usage.filter((_, index) => access[index]);

  // Referral catch-up: a referred shop that has since started its
  // subscription flips the referrer's PENDING row and lands the credit.
  // BEFORE the invoice read, so the next-bill preview already nets it out.
  await settleReferralsForCode(code.id).catch(() => {});
  const invoiceResult = await listSubscriptionInvoices();

  // The custom plan's pages, for the matrix ticks and the hero price.
  let customPages: string[] = [];
  if ((sub?.plan ?? "").toUpperCase() === "CUSTOM") {
    const row = await db.syncState
      .findUnique({ where: { key: `orgPages:${organizationId}` } })
      .catch(() => null);
    try {
      customPages = normalizeCustomPages(row ? (JSON.parse(row.cursor) as string[]) : []);
    } catch {
      customPages = [];
    }
  }

  const [refUses, refConverted, refPending, earned] = await Promise.all([
    db.referralConversion.count({ where: { codeId: code.id } }),
    db.referralConversion.count({
      where: { codeId: code.id, status: { in: ["CONVERTED", "PAID"] } },
    }),
    db.referralConversion.count({ where: { codeId: code.id, status: "PENDING" } }),
    // Every referral that has earned (or is owed) a credit, newest first.
    db.referralConversion.findMany({
      where: { codeId: code.id, status: { in: ["CONVERTED", "PAID"] }, signupOrgId: { not: null } },
      select: { status: true, rewardCents: true, rewardAppliedAt: true },
      orderBy: [{ rewardAppliedAt: "desc" }, { createdAt: "desc" }],
    }),
  ]);

  // No subscription row → the stamp reads "inactive" (the Free tier is gone,
  // so absence of a subscription is no longer presented as a free plan).
  const storedStatus = sub?.status ?? "INACTIVE";
  const accessBlocked = planLapsed(sub);
  /* A COMPLIMENTARY PLAN (owner, 2026-09-22). A MANUAL row that is ACTIVE is a
     grant from JobFlex: the page says so, shows when it ends, and previews no
     bill — there is no Stripe subscription to bill, and the "estimate" the
     page used to work out from the list price read as a charge that was
     coming. The grant's own record has the end date; an older grant written
     before the record existed falls back to the row's period end. */
  const grant = sub?.provider === "MANUAL" && sub.status === "ACTIVE" ? await readPlanGrant(organizationId) : null;
  // Stripe may be unavailable while the local row still says TRIALING or
  // ACTIVE after its access date. Project the same lapse the page gate and
  // quotas already enforce; this changes only the summary, never billing.
  const status = accessBlocked && storedStatus === "TRIALING"
    ? "TRIAL_ENDED"
    : accessBlocked && storedStatus === "ACTIVE"
      ? sub?.provider === "MANUAL" && grant?.fallback === "free" ? "FREE" : "EXPIRED"
      : storedStatus;
  const complimentary =
    !accessBlocked && sub?.provider === "MANUAL" && sub.status === "ACTIVE"
      ? { endsAt: grant ? grant.endsAt : sub.currentPeriodEnd?.toISOString() ?? null, after: grant?.fallback ?? ("free" as const) }
      : null;
  const { plan: planDto, rawPlan } = planContext;

  // The desk has a separate allowance-and-packs rule: an absent plan limit
  // means the tier's included minutes, NOT unlimited provider minutes.
  const deskEntry = limitUsage.find((entry) => entry.resource === "deskMinutes");
  let deskHint: string | null = null;
  if (deskEntry) {
    const included = await includedDeskMinutes(organizationId);
    deskEntry.limit = included;
    try {
      const [useRow, packsRow] = await Promise.all([
        db.syncState.findUnique({ where: { key: `deskuse:${organizationId}:${monthKey()}` }, select: { cursor: true } }),
        db.syncState.findUnique({ where: { key: `deskpacks:${organizationId}` }, select: { cursor: true } }),
      ]);
      if (useRow) JSON.parse(useRow.cursor);
      if (packsRow) JSON.parse(packsRow.cursor);
      const use = useRow ? parseDeskUse(useRow.cursor) : EMPTY_USE;
      const packs = packsRow ? parseDeskPacks(packsRow.cursor) : EMPTY_PACKS;
      const balance = deskBalance(included, use, packs);
      deskEntry.used = minutesOf(balance.usedSeconds);
      deskHint = `Included minutes per calendar month · ${minutesOf(balance.packSeconds)} prepaid minutes remaining`;
    } catch {
      deskEntry.used = null;
    }
  }
  const usageMeta = (resource: string) => {
    const def = LIMIT_DEFS.find((d) => d.key === resource)!;
    const entry = limitUsage.find((item) => item.resource === resource);
    const capping = entry?.cappedBy ? LIMIT_DEFS.find((item) => item.key === entry.cappedBy) : null;
    const ownHint = resource === "deskMinutes" && deskHint ? deskHint : def.hint;
    const hint = capping
      ? `${ownHint} · Also limited by ${capping.label.toLowerCase()}${entry?.remaining === null ? "" : `: ${entry?.remaining} remaining`}`
      : ownHint;
    return { label: def.label, scope: def.scope, hint };
  };
  // Every accessible resource is represented, including unused unlimited
  // resources. A failed count is its own state, never a fabricated zero.
  const usage: UsageRow[] = limitUsage
    .filter((u) => u.limit !== null && u.used !== null)
    .map((u) => ({
      resource: u.resource,
      ...usageMeta(u.resource),
      used: u.used as number,
      limit: u.limit as number,
      ...(u.resource === "deskMinutes" ? { informational: true } : {}),
    }));
  // Uncapped resources still report counts, including when unused.
  const usageUnlimited = limitUsage
    .filter((u) => u.limit === null && u.used !== null)
    .map((u) => ({
      resource: u.resource,
      ...usageMeta(u.resource),
      used: u.used as number,
    }));
  const usageUnavailable: NonNullable<SubscriptionViewProps["usageUnavailable"]> = limitUsage.filter((u) => u.used === null).map((u) => ({
    resource: u.resource,
    ...usageMeta(u.resource),
    limit: u.limit,
  }));
  // Texts have an included allowance separate from in-app messages. Match
  // Settings' real outgoing-message count and UTC calendar-month boundary.
  if (sub && !planLapsed(sub)) {
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const texts = await db.smsMessage.count({ where: {
      organizationId, direction: "OUT", status: { in: ["SENT", "DELIVERED", "QUEUED"] }, createdAt: { gte: monthStart },
    } }).catch(() => null);
    // The new plans' allowance (lib/toolPlans/allowances); null keeps the Classic tier's.
    const toolsTexts = await toolsSmsAllowance(organizationId).catch(() => null);
    const row = { resource: "smsAllowance", label: "Text messages", scope: "monthly" as const, hint: "Included text allowance per calendar month", limit: toolsTexts ?? smsAllowanceFor(planContext.tier) };
    if (texts === null) usageUnavailable.push(row);
    else usage.push({ ...row, used: texts, informational: true });
  }
  const trial = await cardlessTrialState(organizationId).catch(() => null);
  if (trial?.kind === "trialing" && !trial.hasCard) {
    // Card-less trials have ceilings of their own, even where the plan is
    // uncapped. Read the existing ledger directly so a failed read is unknown.
    let uses: Record<string, unknown> | null = null;
    try {
      const meter = await db.syncState.findUnique({ where: { key: `trialMeter:${organizationId}` }, select: { cursor: true } });
      const parsed = meter ? JSON.parse(meter.cursor) : { uses: {} };
      if (parsed && typeof parsed === "object" && parsed.uses && typeof parsed.uses === "object") uses = parsed.uses;
    } catch { /* Each applicable trial meter below remains unavailable. */ }
    for (const key of TRIAL_CAP_KEYS) {
      const pages = TRIAL_USAGE_ACCESS_PAGES[key];
      if (pages && await isPageLocked(organizationId, pages)) continue;
      const noun = TRIAL_CAP_NOUN[key][1];
      const row = {
        resource: `trial:${key}`,
        label: `Trial ${noun}`,
        scope: "absolute" as const,
        hint: "Current card-less trial · add a card to unlock full limits",
        limit: TRIAL_CAPS[key],
      };
      const value = uses?.[key] ?? (uses ? 0 : null);
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) usageUnavailable.push(row);
      else usage.push({ ...row, used: value });
    }
  }

  const stripeMode = await getStripeMode();
  const rewardSummary =
    "Each contractor who signs up with it and goes paid takes 50% off one month of your subscription";

  /* ONE MONTH of the plan — what a referral's 50% is worked from, whatever
     the term — and the price for the term the subscription bills on, which
     is what the page shows (a yearly plan read "$95/mo" before 2026-10-12). */
  const yearly = term.currentInterval === "YEAR";
  const monthlyCents = planDto
    ? planDto.priceCents
    : (sub?.plan ?? "").toUpperCase() === "CUSTOM"
      ? customPriceCents(customPages)
      : null;
  const priceCents = planDto
    ? yearly
      ? (planDto.yearlyPriceCents ?? planDto.priceCents)
      : planDto.priceCents
    : (sub?.plan ?? "").toUpperCase() === "CUSTOM"
      ? customPriceCents(customPages, yearly ? "YEAR" : "MONTH")
      : null;

  /* THE NEXT CHARGE (owner, 2026-09-14). Stripe's preview is the truth when
     there is one: it already nets out coupons and the credit balance, and the
     page only has to say which referrals that credit came from. Without one
     (no Stripe subscription yet, or the preview failed) the bill is worked
     out from the plan price and the credits not yet spent — marked estimated. */
  const perReferralCents = Math.round((monthlyCents ?? 0) * (REFERRAL_REWARD_PCT / 100));
  const paidRewards = earned
    .filter((r) => r.status === "PAID" && r.rewardAppliedAt)
    .map((r) => r.rewardCents ?? perReferralCents);
  const upcoming = invoiceResult.upcoming ?? null;
  const billable = !accessBlocked && ["ACTIVE", "TRIALING", "PAST_DUE"].includes(status.toUpperCase()) && !complimentary;
  const billDate = sub?.currentPeriodEnd ?? sub?.trialEndsAt ?? null;
  const futureBillDate = billDate && billDate.getTime() > Date.now() ? billDate : null;
  /* THE FREE PLAN (owner, 2026-10-13; lib/freePlan). Booked: the plan runs
     to the end of the cycle and nothing more is billed — no next bill, the
     date it switches instead. Ended (CANCELED): the company is on Free. A
     grant that expired (EXPIRED) still reads "Access ended". */
  const freeSwitch = !accessBlocked && !complimentary && freeSwitchBooked(sub) ? { at: freeSwitchDate(sub)?.toISOString() ?? null } : null;
  const wasName = planDto?.name ?? titleCaseSlug(rawPlan);
  // A grant that ran out onto "free" kept no plan of its own to name: no "Was".
  const freePlan = !complimentary && onFreePlan({ status })
    ? { since: (status === "TRIAL_ENDED" ? sub?.trialEndsAt ?? sub?.currentPeriodEnd : freeSince(sub))?.toISOString() ?? null, wasName: wasName.toLowerCase() === "free" ? "" : wasName }
    : null;
  const endedStatus = status.toUpperCase() === "EXPIRED" || (accessBlocked && !freePlan);
  const cancellation = !complimentary && endedStatus
    ? { accessUntil: (sub?.currentPeriodEnd ?? sub?.trialEndsAt)?.toISOString() ?? null, ended: true }
    : null;
  let nextCharge: NextCharge | null = null;
  if (accessBlocked || complimentary || cancellation || freeSwitch || freePlan) {
    nextCharge = null;
  } else if (upcoming) {
    nextCharge = {
      dueAt: upcoming.dueAt ? new Date(upcoming.dueAt * 1000).toISOString() : null,
      subtotalCents: upcoming.subtotalCents,
      discountNotes: upcoming.notes,
      discountCents: upcoming.discountCents,
      referralCreditCents: upcoming.creditCents,
      referralCount: referralsBehind(paidRewards, upcoming.balanceCreditCents, upcoming.creditCents),
      creditLeftCents: Math.max(0, upcoming.balanceCreditCents - upcoming.creditCents),
      perReferralCents,
      pendingReferrals: refPending,
      amountDueCents: upcoming.amountDueCents,
      estimated: false,
    };
  } else if (billable && futureBillDate && priceCents !== null && priceCents > 0) {
    // Unspent = owed (not on Stripe yet) + landed since the last invoice.
    const lastInvoiceAt = invoiceResult.invoices.reduce((t, v) => Math.max(t, v.created), 0) * 1000;
    const unspent = earned
      .filter((r) =>
        r.status === "CONVERTED"
          ? !r.rewardAppliedAt
          : !!r.rewardAppliedAt && r.rewardAppliedAt.getTime() > lastInvoiceAt,
      )
      .map((r) => r.rewardCents ?? perReferralCents);
    const balance = unspent.reduce((n, c) => n + c, 0);
    const credit = Math.min(priceCents, balance);
    nextCharge = {
      dueAt: futureBillDate.toISOString(),
      subtotalCents: priceCents,
      discountNotes: [],
      discountCents: 0,
      referralCreditCents: credit,
      referralCount: referralsBehind(unspent, balance, credit),
      creditLeftCents: balance - credit,
      perReferralCents,
      pendingReferrals: refPending,
      amountDueCents: priceCents - credit,
      estimated: true,
    };
  }

  // The new plans (part 3b): their size is not a catalog row, so the hero names it and prices it from the shop's own
  // lines ("Basic + Deck Studio", the month's bill). A Classic shop reads exactly as before (tools is null).
  const tools = await loadToolsModel(organizationId).catch((err) => {
    console.warn("[subscription] the new plans' view failed:", err);
    return null;
  });
  const toolsPrice = tools ? (yearly ? tools.plan.monthlyCents * YEAR_MONTHS : tools.plan.monthlyCents) : null;

  return {
    planName: freePlan ? FREE_PLAN_NAME : tools ? tools.plan.label : wasName,
    priceCents: freePlan ? 0 : accessBlocked ? null : (toolsPrice ?? priceCents),
    interval: accessBlocked || freePlan ? null : term.currentInterval,
    scheduledSwitch: accessBlocked || freePlan ? null : term.scheduledSwitch,
    // On Free no plan card is "current": every one is an upgrade, paid at once.
    currentSlug: accessBlocked || freePlan ? "free" : (planDto?.slug ?? rawPlan.toLowerCase()),
    plans,
    status,
    accessBlocked,
    nextBill: !accessBlocked && !complimentary && !freePlan && !freeSwitch ? futureBillDate?.toISOString() ?? null : null,
    trialEndsAt: !accessBlocked && status === "TRIALING" && sub?.trialEndsAt ? sub.trialEndsAt.toISOString() : null,
    cancelAtPeriodEnd: !accessBlocked && Boolean(sub?.canceledAt),
    cancellation,
    freeSwitch,
    freePlan,
    complimentary,
    usage,
    usageUnlimited,
    usageUnavailable,
    usageExempt: limitOverview.exempt,
    canUpdatePaymentCard: isStripeEnabled()
      && sub?.provider === "STRIPE"
      && Boolean(sub.externalCustomerId && sub.externalSubId)
      && ["ACTIVE", "TRIALING", "PAST_DUE", "UNPAID"].includes(storedStatus),
    billingInformation: billingInformation ? { name: billingInformation.name, billingEmail: billingInformation.billingEmail ?? "" } : null,
    invoices: invoiceResult,
    nextCharge,
    customPages,
    // Read off the stored row (not the access view): the same rule Settings used.
    cancel: await db.subscription
      .findUnique({ where: { organizationId } })
      .then((row) => loadCancelOffer(organizationId, row, tools ? tools.plan.name : wasName))
      .catch(() => null),
    spotlight: await orgSpotlight(organizationId),
    // The card line belongs to a running card-less trial, never to the Free plan.
    trialCard: accessBlocked || freePlan ? null : trialCard,
    checkoutReady: isStripeEnabled(),
    customOffered: customPlanOffered(),
    sandbox: stripeMode === "test",
    tools,
    referral: {
      code: code.code,
      rewardSummary,
      uses: refUses,
      converted: refConverted,
      pending: refPending,
    },
  };
}
