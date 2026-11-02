// THE PLATFORM ADMIN'S CANCEL (2026-11-01) — from the organization's card in
// /admin/users and /admin/subscribers. The owner's own cancel stays where the
// owner put it (Settings → Billing → Before you go — owner-locked
// 2026-10-17); this is JobFlex support ending a paid Stripe subscription on
// the company's behalf. Here, not in the action file, so the QA check can run
// it through the real code with an explicit actor (actions/adminSubscription
// adds the platform-admin gate).
//
//   · At the end of the paid period — cancel_at_period_end, booked exactly as
//     the owner's cancel books it (lib/freeSwitch: a booked YEAR → MONTH
//     switch is let go first and remembered). Undo clears it the same way
//     the owner's "Keep" does.
//   · Immediately — subscriptions.cancel with no proration and no invoice,
//     the rule the admin editor's grant already cancels with: nothing is
//     refunded, nothing more is billed, the company is on the Free plan.
//
// Every line on the subscription (the Deck Studio add-on, the website
// estimators) ends with it. STRIPE FIRST, THEN THE MIRROR: a Stripe refusal
// changes nothing; the mirror is written from Stripe's reply by the webhook's
// own handlers (lib/subscriptionEvents). The reason goes on
// CancellationFeedback (reasons ["admin"], userId = the admin — no schema
// change) and on the organization's PLAN_CHANGE activity; the owner gets the
// cancel letter when asked. A grant (provider MANUAL) is not cancelled here —
// it has "End complimentary access now".

import type Stripe from "stripe";
import { z } from "zod";
import { db } from "@/lib/db";
import { getStripeClient, isStripeEnabled } from "@/lib/sdk/stripe";
import { LIVE_STATUSES } from "@/lib/freePlan";
import { bookFreeSwitch, heldSwitchKey, keepFreeSwitch, rebookHeldSwitch, sendFreeSwitchEmail } from "@/lib/freeSwitch";
import { releaseScheduledSwitch } from "@/lib/planChange";
import { onSubscriptionDeleted, onSubscriptionUpdated } from "@/lib/subscriptionEvents";
import { subscriptionPeriodEndDate } from "@/lib/stripeCompat";
import { recordPlanActivity } from "@/lib/planGrant";
import { ADMIN_NOTE_MAX, ADMIN_NOTE_MIN, ADMIN_REASON, parseReasons } from "@/lib/cancelFeedback";
import { getPlanDisplayName } from "@/lib/planCatalogServer";
import { logServerError } from "@/lib/server-events";

export type AdminCancelMode = "period_end" | "now";

/** The platform admin behind the action. */
export interface CancelActor {
  id: string;
  email: string;
  name?: string | null;
}

/** What the card shows after a cancel or an undo. */
export interface AdminCancelState {
  status: string;
  /** The period end (or the day it ended). */
  endsAt: string | null;
  /** Booked to cancel at the period end — "Cancels on <endsAt>". */
  cancelsAtPeriodEnd: boolean;
  /** The latest cancellation, when a platform admin made it. */
  byAdmin: { name: string; at: string } | null;
}

export type AdminCancelResult = { ok: true; state: AdminCancelState } | { ok: false; error: string };

const cancelInput = z.object({
  organizationId: z.string().min(1),
  mode: z.enum(["period_end", "now"]),
  reason: z
    .string()
    .trim()
    .min(ADMIN_NOTE_MIN, `Give a reason (at least ${ADMIN_NOTE_MIN} characters).`)
    .max(ADMIN_NOTE_MAX, `Keep the reason to ${ADMIN_NOTE_MAX} characters.`),
  notify: z.boolean(),
});

const isLive = (status: string) => (LIVE_STATUSES as readonly string[]).includes(status);

function stripeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return `Stripe refused: ${msg.slice(0, 200)}. Nothing was changed.`;
}

/** The mirror from Stripe's reply. A failure here is logged, not returned:
 *  Stripe has already done it, and its webhook writes the same row again. */
async function mirror(fn: () => Promise<void>, organizationId: string) {
  await fn().catch((err) => logServerError("adminCancel.mirror", err, { kind: "action", organizationId }));
}

export async function readAdminCancelState(organizationId: string): Promise<AdminCancelState> {
  const [sub, last] = await Promise.all([
    db.subscription.findUnique({ where: { organizationId }, select: { status: true, currentPeriodEnd: true, canceledAt: true } }),
    db.cancellationFeedback
      .findFirst({ where: { organizationId }, orderBy: { createdAt: "desc" }, select: { reasons: true, createdAt: true, user: { select: { name: true, email: true } } } })
      .catch(() => null),
  ]);
  const status = sub?.status ?? "NONE";
  const cancelsAtPeriodEnd = !!sub?.canceledAt && isLive(status);
  const shows = cancelsAtPeriodEnd || status === "CANCELED";
  return {
    status,
    endsAt: sub?.currentPeriodEnd?.toISOString() ?? null,
    cancelsAtPeriodEnd,
    byAdmin:
      shows && last && parseReasons(last.reasons).includes(ADMIN_REASON)
        ? { name: last.user?.name || last.user?.email || "JobFlex admin", at: last.createdAt.toISOString() }
        : null,
  };
}

export async function cancelAsAdmin(raw: unknown, admin: CancelActor): Promise<AdminCancelResult> {
  const parsed = cancelInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  const { organizationId, mode, reason, notify } = parsed.data;

  const sub = await db.subscription.findUnique({ where: { organizationId } });
  if (!sub || sub.provider !== "STRIPE" || !sub.externalSubId || !isLive(sub.status)) {
    return { ok: false, error: "This organization has no live Stripe subscription to cancel." };
  }
  if (mode === "period_end" && sub.canceledAt) return { ok: false, error: "It is already set to cancel at the end of the period." };
  if (!isStripeEnabled()) return { ok: false, error: "Stripe is not configured." };
  const { stripe } = await getStripeClient();
  const subId = sub.externalSubId;

  let endsAt: Date | null;
  if (mode === "period_end") {
    let updated: Stripe.Subscription;
    try {
      updated = await bookFreeSwitch(organizationId, subId, stripe);
    } catch (err) {
      return { ok: false, error: stripeError(err) };
    }
    endsAt = subscriptionPeriodEndDate(updated) ?? sub.currentPeriodEnd ?? sub.trialEndsAt;
    await mirror(() => onSubscriptionUpdated(updated, stripe), organizationId);
  } else {
    let ended: Stripe.Subscription;
    try {
      // A booked plan switch (lib/planChange) or any other schedule is let go first.
      await releaseScheduledSwitch(organizationId, stripe);
      ended = await stripe.subscriptions.cancel(subId, { prorate: false, invoice_now: false });
    } catch (err) {
      return { ok: false, error: stripeError(err) };
    }
    endsAt = new Date();
    await mirror(() => onSubscriptionDeleted(ended, stripe), organizationId);
    await db.syncState.deleteMany({ where: { key: heldSwitchKey(organizationId) } }).catch(() => {});
  }

  const planName = await getPlanDisplayName(sub.plan).catch(() => sub.plan);
  const day = endsAt ? endsAt.toLocaleDateString("en-US") : "the period end";
  await db.cancellationFeedback
    .create({ data: { organizationId, userId: admin.id, plan: sub.plan, reasons: JSON.stringify([ADMIN_REASON]), otherText: reason, periodEnd: endsAt } })
    .catch((err) => logServerError("adminCancel.feedback", err, { kind: "action", organizationId }));
  await recordPlanActivity({
    organizationId,
    actorId: admin.id,
    summary:
      mode === "now"
        ? `${planName} cancelled now by JobFlex support — on the Free plan`
        : `${planName} set to cancel on ${day} by JobFlex support`,
    meta: { mode: "admin-cancel", when: mode, reason, notify, actorEmail: admin.email, stripe: { subId, endsAt: endsAt?.toISOString() ?? null } },
  });
  if (notify) {
    await sendFreeSwitchEmail(organizationId, sub.plan, endsAt, { byJobflex: true, endedNow: mode === "now" }).catch((err) =>
      console.warn("[adminCancel] owner email failed:", err),
    );
  }
  return { ok: true, state: await readAdminCancelState(organizationId) };
}

/** Clears a booked cancel at the period end — the owner's or an admin's. */
export async function undoCancelAsAdmin(organizationId: string, admin: CancelActor): Promise<AdminCancelResult> {
  const sub = await db.subscription.findUnique({ where: { organizationId } });
  if (!sub || sub.provider !== "STRIPE" || !sub.externalSubId || !isLive(sub.status) || !sub.canceledAt) {
    return { ok: false, error: "Nothing is set to cancel on this organization." };
  }
  if (!isStripeEnabled()) return { ok: false, error: "Stripe is not configured." };
  const client = await getStripeClient();
  const subId = sub.externalSubId;

  let updated: Stripe.Subscription | null;
  try {
    updated = await keepFreeSwitch(subId, client.stripe);
  } catch (err) {
    return { ok: false, error: stripeError(err) };
  }
  if (!updated) return { ok: false, error: "Stripe has already ended this subscription — the company is on the Free plan." };
  await rebookHeldSwitch(organizationId, subId, client);
  await db.syncState.deleteMany({ where: { key: heldSwitchKey(organizationId) } }).catch(() => {});
  const fresh = updated;
  await mirror(() => onSubscriptionUpdated(fresh, client.stripe), organizationId);

  const planName = await getPlanDisplayName(sub.plan).catch(() => sub.plan);
  await recordPlanActivity({
    organizationId,
    actorId: admin.id,
    summary: `${planName} cancellation undone by JobFlex support — renews as before`,
    meta: { mode: "admin-cancel-undo", actorEmail: admin.email, stripe: { subId } },
  });
  return { ok: true, state: await readAdminCancelState(organizationId) };
}
