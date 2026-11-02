"use server";
import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/orgContext";
import { db } from "@/lib/db";
import { isStripeEnabled, getStripeClient } from "@/lib/sdk/stripe";
import { getPlanBySlug, revalidatePlanSurfaces } from "@/lib/planCatalogServer";
import {
  applyPlanChange,
  previewPlanChange as previewPlanChangeFor,
  releaseScheduledSwitch,
  type PlanChangeDone,
  type PlanChangePreview,
  type PlanChangeRefusal,
} from "@/lib/planChange";
import { subscriptionPeriodEndDate } from "@/lib/stripeCompat";
import { trialOnlyInvoiceIds } from "@/lib/trialInvoices";
import { normalizeCustomPages } from "@/lib/customPlan";
import {
  changeCustomPages,
  previewCustomPages,
  readOrgPages,
  type CustomPagesChange,
} from "@/lib/customBilling";
import { planSnapshot, reportPlanChange } from "@/lib/activation-events";
import { logServerError } from "@/lib/server-events";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { LIVE_STATUSES, freeSwitchBooked, onFreePlan } from "@/lib/freePlan";
import { bookFreeSwitch, heldSwitchKey, keepFreeSwitch, rebookHeldSwitch, sendFreeSwitchEmail } from "@/lib/freeSwitch";
import { checkCancelFeedback } from "@/lib/cancelFeedback";
import { trackActivation } from "@/lib/activation-events";

const billingSaved = (organizationId: string, actorId: string, summary: string, meta?: Record<string, unknown>) =>
  logActivity({ organizationId, actorId, kind: TRAIL_KINDS.SETTINGS, summary, meta: { area: "billing", ...meta } });

/**
 * Directly assign the org a plan from the catalog. One legitimate use since
 * the Free tier was removed (2026-08-17): the Stripe-disabled dev/demo
 * fallback. Paid plans with Stripe configured MUST go through checkout —
 * without this guard any owner could self-grant a paid tier without paying.
 * (The isFree branches below stay: they keep any admin-created $0 plan and
 * legacy FREE-status rows behaving sanely.)
 */
export async function setOrgPlan(planSlug: string) {
  const { organizationId, user } = await requireOwner();
  const plan = await getPlanBySlug(planSlug); // active plans only
  if (!plan) throw new Error("Invalid plan");
  if (!plan.isFree && isStripeEnabled()) {
    throw new Error("Paid plans go through checkout.");
  }

  const now = new Date();
  const periodEnd = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 30);
  const stored = plan.slug.toUpperCase();

  const planWas = await planSnapshot(organizationId);
  await db.subscription.upsert({
    where: { organizationId },
    update: {
      plan: stored,
      status: plan.isFree ? "FREE" : "ACTIVE",
      currentPeriodEnd: plan.isFree ? null : periodEnd,
    },
    create: {
      organizationId,
      plan: stored,
      status: plan.isFree ? "FREE" : "ACTIVE",
      provider: "STRIPE",
      currentPeriodEnd: plan.isFree ? null : periodEnd,
    },
  });
  reportPlanChange(organizationId, "self_serve", planWas);
  revalidatePath("/dashboard/settings/account");
  revalidatePath("/dashboard/subscription");
  // The responsive staging build still serves this surface too; both refresh.
  revalidatePath("/dashboard/subscription-blueprint");
  revalidatePath("/dashboard");
  await billingSaved(organizationId, user.id, `Updated billing settings — plan set to ${plan.name}`, { plan: plan.slug });
  return { ok: true };
}

export interface SubscriptionInvoice {
  id: string;
  number: string | null;
  amountPaidCents: number;
  /** What is still owed — an open invoice's amount (owner, 2026-10-12: an
   *  unpaid invoice used to read "$0.00", its paid amount). */
  amountDueCents: number;
  currency: string;
  status: string | null;
  created: number; // epoch seconds
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
}

/**
 * Real subscription billing history, pulled read-only from Stripe (the org's
 * subscription invoices — what the contractor paid JobFlex). This is distinct
 * from the `Payment` table, which records the contractor's *customers'* payments.
 *
 * Read-only (`invoices.list`) — no live-write guard / env flag needed. Returns
 * `{ available: false }` when Stripe isn't configured or the org has no Stripe
 * customer yet, so the UI can show a clear empty state instead of fake rows.
 */
/** The next bill, previewed by Stripe with every discount and credit that
 *  will apply — so a referral reward or coupon shows up BEFORE it is charged. */
export interface UpcomingInvoice {
  /** Epoch seconds the invoice will be attempted (period end). */
  dueAt: number | null;
  amountDueCents: number;
  subtotalCents: number;
  /** Coupons / promotion codes on the subscription, summed. */
  discountCents: number;
  /** Customer balance (referral rewards) applied against this invoice. */
  creditCents: number;
  /** Credit sitting on the customer balance BEFORE this invoice takes its
   *  share — what is left afterwards is this minus `creditCents`. */
  balanceCreditCents: number;
  /** Coupon lines only: "Referral coupon −$2.50". The balance credit is
   *  itemised by the page, which knows how many referrals funded it. */
  notes: string[];
}

export async function listSubscriptionInvoices(): Promise<{
  available: boolean;
  invoices: SubscriptionInvoice[];
  upcoming?: UpcomingInvoice | null;
}> {
  const { organizationId } = await requireOwner();
  const sub = await db.subscription.findUnique({ where: { organizationId } });

  if (!isStripeEnabled() || !sub?.externalCustomerId) {
    return { available: false, invoices: [] };
  }

  try {
    // Mode-aware: a subscription started on the sandbox has its invoices on
    // the sandbox. The live-only client returned nothing for it.
    const { stripe } = await getStripeClient();
    const res = await stripe.invoices.list({
      customer: sub.externalCustomerId,
      limit: 12,
    });
    const trialOnly = await trialOnlyInvoiceIds(stripe, res.data);
    // A voided invoice is an attempt that charged nothing — a plan change the
    // card declined (lib/planChange) — not a bill: it is not listed.
    const invoices: SubscriptionInvoice[] = res.data.filter((inv) => !trialOnly.has(inv.id) && inv.status !== "void").map((inv) => ({
      id: inv.id,
      number: inv.number ?? null,
      amountPaidCents: inv.amount_paid ?? 0,
      amountDueCents: inv.amount_remaining ?? inv.amount_due ?? 0,
      currency: (inv.currency ?? "usd").toUpperCase(),
      status: inv.status ?? null,
      created: inv.created,
      hostedInvoiceUrl: inv.hosted_invoice_url ?? null,
      invoicePdf: inv.invoice_pdf ?? null,
    }));

    /* THE NEXT BILL (owner, 2026-09-02): Stripe's own preview of the upcoming
       invoice for this subscription, which already nets out every coupon on
       the subscription and the customer's credit balance — the referral
       reward lands as a negative balance, so "$50 off" is visible here weeks
       before the charge. Best-effort: a preview failure leaves the history. */
    let upcoming: UpcomingInvoice | null = null;
    // Nothing comes next once the switch to Free is booked or done (lib/freePlan).
    if (sub.externalSubId && !freeSwitchBooked(sub) && !onFreePlan(sub)) {
      try {
        const pre = await stripe.invoices.createPreview({
          customer: sub.externalCustomerId,
          subscription: sub.externalSubId,
          // Clover keeps a discount's coupon under source and sends it as an id.
          expand: ["total_discount_amounts.discount.source.coupon"],
        });
        const subtotal = pre.subtotal ?? 0;
        const total = pre.total ?? 0;
        const due = pre.amount_due ?? 0;
        const discountCents = (pre.total_discount_amounts ?? []).reduce((n, d) => n + (d.amount ?? 0), 0);
        // Credit applied = what the total was brought down by from the balance.
        const creditCents = Math.max(0, total - due);
        const notes: string[] = [];
        for (const d of pre.total_discount_amounts ?? []) {
          const disc = d.discount as unknown as
            | { coupon?: { name?: string | null }; source?: { coupon?: { name?: string | null } | string | null } }
            | string;
          const coupon = typeof disc === "object" ? (disc?.source?.coupon ?? disc?.coupon) : null;
          const name = typeof coupon === "object" && coupon?.name ? coupon.name : "Discount";
          if (d.amount) notes.push(`${name} −$${(d.amount / 100).toFixed(2)}`);
        }
        const firstLine = pre.lines?.data?.[0];
        upcoming = {
          dueAt: pre.next_payment_attempt ?? firstLine?.period?.end ?? pre.period_end ?? null,
          amountDueCents: due,
          subtotalCents: subtotal,
          discountCents,
          creditCents,
          // Stripe balances are negative when they are credit.
          balanceCreditCents: Math.max(creditCents, -(pre.starting_balance ?? 0)),
          notes,
        };
      } catch (err) {
        console.warn("[billing] upcoming invoice preview failed:", err);
      }
    }
    return { available: true, invoices, upcoming };
  } catch {
    // Stripe reachable-but-erroring shouldn't blow up the page.
    return { available: false, invoices: [] };
  }
}

/* ── THE MOVE TO FREE AT THE END OF THE CYCLE ────────────────────────────
   (owner, 2026-09-20; Free since 2026-10-13 — lib/freePlan) Cancelling is
   booked, not immediate: Stripe keeps `cancel_at_period_end`, the shop keeps
   every paid day it already has, and nothing is refunded — the same money
   rule the plan dialog states for a downgrade. When Stripe ends the
   subscription the company is on the Free plan. The booking is mirrored
   locally on `Subscription.canceledAt` (an existing column; no schema
   change), which is what the screens read to show "Your plan switches to
   Free on <date>" and offer "Keep <plan>".

   Owner only (requireOwner — the link sits in Settings → Billing): a manager
   cannot book it. A complimentary plan (a grant, provider MANUAL) has no
   subscription to end. A booked YEAR → MONTH switch is let go of first (a
   scheduled subscription refuses cancel_at_period_end) and remembered, so
   "Keep" books it again.

   Keeping clears the booking on both sides while the cycle is still running.
   Once the period has actually ended Stripe has ended the subscription and
   there is nothing to keep — a plan card checks out again, paid at once.

   WHY (owner, 2026-10-20; lib/cancelFeedback): the confirmation asks for at
   least one reason, and "Other" needs its own words. No reason, no cancel —
   checked here before anything else. The cancel itself is unchanged; once it
   is booked the answer is kept on CancellationFeedback (a failed write is
   logged, never a failed cancel) and sent to PostHog as
   subscription_cancel_reason — the keys only, never the words. */
export type CancelSubscriptionResult =
  | { ok: true; endsAt: string | null }
  | { ok: false; error: string };

/* The Stripe side of the booking and of Keep lives in lib/freeSwitch — the
   platform admin's cancel (lib/adminCancel) books it the same way. */

export async function cancelSubscription(feedback?: unknown): Promise<CancelSubscriptionResult> {
  const { organizationId, user } = await requireOwner();
  const why = checkCancelFeedback(feedback);
  if (!why.ok) return { ok: false, error: why.error };
  const sub = await db.subscription.findUnique({ where: { organizationId } });
  if (!sub || !(LIVE_STATUSES as readonly string[]).includes(sub.status)) return { ok: false, error: "There's no subscription to cancel." };
  if (sub.provider === "MANUAL") return { ok: false, error: "Your plan is complimentary — there's nothing to cancel." };
  if (sub.canceledAt) return { ok: false, error: "Your plan is already set to switch to Free." };

  let endsAt: Date | null = sub.currentPeriodEnd ?? sub.trialEndsAt ?? null;
  if (sub.externalSubId && isStripeEnabled()) {
    const { stripe } = await getStripeClient();
    try {
      const updated = await bookFreeSwitch(organizationId, sub.externalSubId, stripe);
      endsAt = subscriptionPeriodEndDate(updated) ?? endsAt;
    } catch (err) {
      console.warn("[billing] cancelSubscription failed:", err);
      return { ok: false, error: "Couldn't cancel the subscription. Try again." };
    }
  }

  await db.subscription.update({
    where: { organizationId },
    data: { canceledAt: new Date(), ...(endsAt ? { currentPeriodEnd: endsAt } : {}) },
  });
  revalidatePlanSurfaces();
  revalidatePath("/dashboard/subscription");
  revalidatePath("/dashboard/settings");
  await billingSaved(organizationId, user.id, `Updated billing settings — subscription set to cancel${endsAt ? ` on ${endsAt.toLocaleDateString("en-US")}` : ""}, then the Free plan`, { canceled: true, endsAt: endsAt?.toISOString() });
  await sendFreeSwitchEmail(organizationId, sub.plan, endsAt).catch((err) => console.warn("[billing] free-switch email failed:", err));
  await db.cancellationFeedback
    .create({ data: { organizationId, userId: user.id, plan: sub.plan, reasons: JSON.stringify(why.reasons), otherText: why.otherText, periodEnd: endsAt } })
    .catch((err) => logServerError("billing.cancelFeedback", err, { kind: "action", organizationId }));
  trackActivation("subscription_cancel_reason", organizationId, {
    reasons: why.reasons.join(","),
    reason_count: why.reasons.length,
    has_other: why.otherText !== null,
    trialing: sub.status === "TRIALING",
  });
  return { ok: true, endsAt: endsAt ? endsAt.toISOString() : null };
}

export async function resumeSubscription(): Promise<CancelSubscriptionResult> {
  const { organizationId, user } = await requireOwner();
  const sub = await db.subscription.findUnique({ where: { organizationId } });
  if (!sub) return { ok: false, error: "There's no subscription to keep." };
  if (!sub.canceledAt || !(LIVE_STATUSES as readonly string[]).includes(sub.status)) {
    return { ok: false, error: "Your plan isn't set to switch to Free." };
  }

  let endsAt: Date | null = sub.currentPeriodEnd ?? null;
  if (sub.externalSubId && isStripeEnabled()) {
    const { stripe, mode } = await getStripeClient();
    try {
      const updated = await keepFreeSwitch(sub.externalSubId, stripe);
      // Already over: Stripe ended it and the company is on Free.
      if (!updated) return { ok: false, error: "Your plan has already switched to Free. Choose a plan to start again." };
      endsAt = subscriptionPeriodEndDate(updated) ?? endsAt;
    } catch (err) {
      console.warn("[billing] resumeSubscription failed:", err);
      return { ok: false, error: "Couldn't keep the subscription. Try again." };
    }
    await rebookHeldSwitch(organizationId, sub.externalSubId, { stripe, mode });
  }
  await db.syncState.deleteMany({ where: { key: heldSwitchKey(organizationId) } }).catch(() => {});

  await db.subscription.update({
    where: { organizationId },
    data: { canceledAt: null, ...(endsAt ? { currentPeriodEnd: endsAt } : {}) },
  });
  revalidatePlanSurfaces();
  revalidatePath("/dashboard/subscription");
  revalidatePath("/dashboard/settings");
  await billingSaved(organizationId, user.id, "Updated billing settings — subscription resumed", { canceled: false });
  return { ok: true, endsAt: endsAt ? endsAt.toISOString() : null };
}

/* ── CHANGE PLAN IN PLACE ────────────────────────────────────────────────
   Every rule lives in lib/planChange (owner, 2026-10-12): a trial swaps the
   price and runs on; YEAR → MONTH is booked for the end of the paid year;
   MONTH → YEAR and a dearer price on the same term are invoiced today with
   the unused period credited, ALL OR NOTHING on the card — a declined card
   leaves the plan, the subscription and no open invoice behind, and answers
   "Card declined — update your card"; a cheaper price on the same term is
   switched free; an upgrade by tier on the same term, and a shop with no
   live subscription, go to Stripe's page (`mode: "checkout"`).
   previewPlanChange answers what the dialog shows — Stripe's own preview. */
export type ChangePlanResult = PlanChangeDone;
export type PlanChangePreviewResult = PlanChangePreview | PlanChangeRefusal;

/** `deckAddon`: "Add Deck Studio" ticked beside the plan cards — the add-on goes on with the change (lib/planChange). */
export async function previewPlanChange(planSlug: string, interval: "MONTH" | "YEAR" = "MONTH", deckAddon = false): Promise<PlanChangePreviewResult> {
  const { organizationId } = await requireOwner();
  if (!isStripeEnabled()) return { ok: false, error: "Checkout is not configured." };
  try {
    return await previewPlanChangeFor(organizationId, String(planSlug), interval === "YEAR" ? "YEAR" : "MONTH", undefined, deckAddon === true);
  } catch (err) {
    logServerError("billing.previewPlanChange", err, { kind: "action", organizationId });
    return { ok: false, error: "Couldn't price the change. Try again." };
  }
}

export async function changePlan(
  planSlug: string,
  interval: "MONTH" | "YEAR" = "MONTH",
  prorationDate?: number | null,
  deckAddon = false,
): Promise<ChangePlanResult> {
  const { organizationId, user } = await requireOwner();
  if (!isStripeEnabled()) return { ok: false, error: "Checkout is not configured." };
  const planWas = await planSnapshot(organizationId);
  let res: PlanChangeDone;
  try {
    res = await applyPlanChange(organizationId, String(planSlug), interval === "YEAR" ? "YEAR" : "MONTH", typeof prorationDate === "number" ? prorationDate : null, undefined, deckAddon === true);
  } catch (err) {
    logServerError("billing.changePlan", err, { kind: "action", organizationId });
    return { ok: false, error: "Couldn't switch the plan. Try again." };
  }
  if (!res.ok || res.mode === "checkout") return res;
  if (res.mode === "switched") reportPlanChange(organizationId, "self_serve", planWas);
  revalidatePlanSurfaces();
  revalidatePath("/dashboard/subscription");
  revalidatePath("/dashboard/upgrade");
  await billingSaved(
    organizationId,
    user.id,
    res.mode === "scheduled"
      ? `Updated billing settings — switch to ${res.planName} (${res.interval === "YEAR" ? "annual" : "monthly"}) booked for ${new Date(res.switchAt).toLocaleDateString("en-US")}`
      : `Updated billing settings — plan changed to ${res.planName} (${res.interval === "YEAR" ? "annual" : "monthly"})${res.chargedCents > 0 ? `, $${(res.chargedCents / 100).toFixed(2)} charged` : ""}`,
    { plan: planSlug, interval, mode: res.mode, ...(deckAddon === true ? { deckAddon: true } : {}), ...(res.mode === "switched" ? { route: res.route, chargedCents: res.chargedCents } : { switchAt: res.switchAt }) },
  );
  return res;
}

/** Cancel the booked YEAR → MONTH switch: the plan goes on as it is. */
export async function cancelScheduledSwitch(): Promise<{ ok: true } | { ok: false; error: string }> {
  const { organizationId, user } = await requireOwner();
  try {
    const released = await releaseScheduledSwitch(organizationId);
    if (!released) return { ok: false, error: "There is no switch booked." };
  } catch (err) {
    logServerError("billing.cancelScheduledSwitch", err, { kind: "action", organizationId });
    return { ok: false, error: "Couldn't cancel the switch. Try again." };
  }
  revalidatePath("/dashboard/subscription");
  revalidatePath("/dashboard/upgrade");
  await billingSaved(organizationId, user.id, "Updated billing settings — booked plan switch cancelled", { switch: "cancelled" });
  return { ok: true };
}

/* ── CHANGE A CUSTOM PLAN'S PAGES (owner, 2026-10-06) ─────────────────
   One subscription, base + page × quantity (lib/customBilling). Adding a
   page charges the prorated difference now on the subscription the shop
   already has — no new Checkout, no cancelled subscription, a running trial
   keeps running (nothing is charged in it). Removing a page closes it now and
   lowers the price from the next bill, with no refund (the owner's rule).
   Our page record is the truth; Stripe's quantity and metadata follow. */
export type CustomPagesResult = CustomPagesChange;

async function applyPages(next: string[], verb: string): Promise<CustomPagesResult> {
  const { organizationId, user } = await requireOwner();
  const res = await changeCustomPages({ organizationId, next });
  if (!res.ok) return res;
  revalidatePlanSurfaces();
  revalidatePath("/dashboard/upgrade");
  revalidatePath("/dashboard/subscription");
  revalidatePath("/dashboard", "layout");
  const parts = [
    res.added.length ? `added ${res.added.length} page${res.added.length === 1 ? "" : "s"}` : "",
    res.removed.length ? `removed ${res.removed.length} page${res.removed.length === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  await billingSaved(organizationId, user.id, `Updated billing settings — ${parts.join(" and ") || verb} on the custom plan`, {
    pages: res.pages,
    added: res.added,
    removed: res.removed,
    chargedCents: res.chargedCents,
  });
  return res;
}

async function ownedPages(): Promise<string[]> {
  const { organizationId } = await requireOwner();
  return readOrgPages(organizationId);
}

/** The picker's "done": the whole selection the owner wants. */
export async function updateCustomPages(rawIds: unknown): Promise<CustomPagesResult> {
  const next = normalizeCustomPages(Array.isArray(rawIds) ? rawIds.map(String) : []);
  return applyPages(next, "changed pages");
}

/** Add pages (the upgrade gate's one-click "Add Calendar for $10/mo"). */
export async function addCustomPages(rawIds: unknown): Promise<CustomPagesResult> {
  const adding = normalizeCustomPages(Array.isArray(rawIds) ? rawIds.map(String) : []);
  const owned = await ownedPages();
  if (adding.every((id) => owned.includes(id))) return { ok: false, error: "Pick a page you don't have yet." };
  return applyPages([...owned, ...adding.filter((id) => !owned.includes(id))], "added pages");
}

/** Remove pages: closed now, cheaper from the next bill, nothing refunded. */
export async function removeCustomPages(rawIds: unknown): Promise<CustomPagesResult> {
  const dropping = normalizeCustomPages(Array.isArray(rawIds) ? rawIds.map(String) : []);
  const owned = await ownedPages();
  if (!dropping.some((id) => owned.includes(id))) return { ok: false, error: "Pick a page you have." };
  return applyPages(owned.filter((id) => !dropping.includes(id)), "removed pages");
}

/** What a selection would charge now (prorated) and per month after. */
export async function previewCustomPagesChange(
  rawIds: unknown,
): Promise<{ dueNowCents: number | null; monthlyCents: number; trialing: boolean }> {
  const { organizationId } = await requireOwner();
  const next = normalizeCustomPages(Array.isArray(rawIds) ? rawIds.map(String) : []);
  return previewCustomPages(organizationId, next);
}
