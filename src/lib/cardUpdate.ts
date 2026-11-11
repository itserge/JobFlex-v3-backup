// A FAILED PAYMENT, AND THE WAY BACK (owner, 2026-10-07).
//
// When a renewal charge fails Stripe marks the subscription past_due and
// retries on its own schedule; the app mirrors PAST_DUE (lib/stripeSync) and
// keeps the plan open meanwhile (lib/planStatus) under the "Payment failed ·
// Update your card" ribbon (components/v3/payment-ribbon). The ribbon's
// button opens Stripe Checkout in SETUP mode for the subscription's own
// customer — the card form, nothing charged by Checkout itself. On the way
// back (the return URL or the webhook, whichever is first; both are safe to
// run twice) the new card becomes the customer's and the subscription's
// default, and whatever is still open is paid with it AT ONCE rather than at
// Stripe's next retry. A paid invoice turns the subscription active; the
// mirror follows here and again from the webhooks.
//
// The two dunning emails (the first failure, and Stripe's last try) are sent
// from the invoice.payment_failed webhook — sendDunningEmail below.
import type Stripe from "stripe";
import { db } from "@/lib/db";
import { getStripeClient } from "@/lib/sdk/stripe";
import { invoiceSubscriptionId } from "@/lib/stripeCompat";
import { syncSubscriptionFromStripe } from "@/lib/stripeSync";
import type { ShopOnJobflex } from "@/lib/email/build/billing";
import { CARD_ONLY_CHECKOUT } from "@/lib/stripeCheckoutCard";

export const CARD_UPDATE_PURPOSE = "card-update";

/** The Stripe Checkout (setup mode) that takes the new card, or null when the
 *  org has no Stripe customer to put it on. */
export async function openCardUpdate(orgId: string, origin: string): Promise<{ url: string } | null> {
  const sub = await db.subscription.findUnique({
    where: { organizationId: orgId },
    select: { externalCustomerId: true, externalSubId: true, provider: true },
  });
  if (sub?.provider !== "STRIPE" || !sub.externalCustomerId || !sub.externalSubId) return null;
  const { stripe } = await getStripeClient();
  const live = await stripe.subscriptions.retrieve(sub.externalSubId);
  const customer = typeof live.customer === "string" ? live.customer : live.customer.id;
  if (customer !== sub.externalCustomerId || !["active", "trialing", "past_due", "unpaid"].includes(live.status)) return null;
  const back = `${origin}/dashboard/subscription`;
  const meta = { organizationId: orgId, jf_purpose: CARD_UPDATE_PURPOSE, subscriptionId: sub.externalSubId };
  const session = await stripe.checkout.sessions.create({
    mode: "setup",
    currency: "usd",
    ...CARD_ONLY_CHECKOUT,
    customer: sub.externalCustomerId,
    client_reference_id: orgId,
    metadata: meta,
    setup_intent_data: { metadata: meta },
    success_url: `${back}?card=updated&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${back}?card=cancelled`,
  });
  return session.url ? { url: session.url } : null;
}

export type CardUpdateResult =
  | { ok: true; paid: boolean; owedCents: number; status: string }
  | { ok: false; error: string };

/**
 * A completed card Checkout: the card becomes the default, the open invoices
 * are paid with it, the mirror is synced. `paid` is false when the new card
 * was declined too (the subscription stays PAST_DUE and Stripe keeps retrying).
 */
export async function finishCardUpdate(orgId: string, sessionOrId: string | Stripe.Checkout.Session): Promise<CardUpdateResult> {
  const { stripe } = await getStripeClient();
  const session =
    typeof sessionOrId === "string"
      ? await stripe.checkout.sessions.retrieve(sessionOrId, { expand: ["setup_intent"] })
      : sessionOrId;
  if (session.metadata?.organizationId !== orgId || session.metadata?.jf_purpose !== CARD_UPDATE_PURPOSE) {
    return { ok: false, error: "That card form is not this workspace's." };
  }
  if (session.status !== "complete") return { ok: false, error: "The card was not saved." };
  const subId = session.metadata?.subscriptionId;
  const customer = typeof session.customer === "string" ? session.customer : session.customer?.id;
  if (!subId || !customer) return { ok: false, error: "There is no subscription to put the card on." };
  const current = await db.subscription.findUnique({ where: { organizationId: orgId } });
  if (current?.provider !== "STRIPE" || current.externalSubId !== subId || current.externalCustomerId !== customer) {
    return { ok: false, error: "Your subscription changed after this card form was opened. Review your current subscription first." };
  }
  const live = await stripe.subscriptions.retrieve(subId);
  if (!["active", "trialing", "past_due", "unpaid"].includes(live.status)) {
    return { ok: false, error: "This subscription has ended. Choose a plan to restart it." };
  }
  const si =
    typeof session.setup_intent === "string" ? await stripe.setupIntents.retrieve(session.setup_intent) : session.setup_intent;
  const pm = si && (typeof si.payment_method === "string" ? si.payment_method : si.payment_method?.id);
  if (!pm) return { ok: false, error: "The card was not saved." };

  await stripe.customers.update(customer, { invoice_settings: { default_payment_method: pm } });
  await stripe.subscriptions.update(subId, { default_payment_method: pm });

  // Pay what is owed now, with the new card.
  const open = await stripe.invoices.list({ subscription: subId, status: "open", limit: 10 });
  let owedCents = 0;
  let declined = false;
  for (const inv of open.data) {
    owedCents += inv.amount_remaining ?? inv.amount_due ?? 0;
    try {
      await stripe.invoices.pay(inv.id, { payment_method: pm }, { idempotencyKey: `card-update:${session.id}:${inv.id}` });
    } catch (err) {
      declined = true;
      console.warn(`[card-update] ${orgId}: ${inv.id} declined on the new card:`, err instanceof Error ? err.message : err);
    }
  }
  const sub = await stripe.subscriptions.retrieve(subId, { expand: ["latest_invoice"] });
  await syncSubscriptionFromStripe(sub, stripe).catch((err) => console.warn("[card-update] sync failed:", err));
  if (open.data.length > 0) return { ok: true, paid: !declined, owedCents, status: sub.status };
  // Nothing open: either nothing was owed, or the other caller (the webhook,
  // or the return page) already paid it with this card — a paid invoice newer
  // than the card form says which.
  const latest = typeof sub.latest_invoice === "object" ? sub.latest_invoice : null;
  const paidNow = Boolean(latest && latest.status === "paid" && (latest.amount_paid ?? 0) > 0 && (latest.status_transitions?.paid_at ?? 0) >= session.created);
  return { ok: true, paid: paidNow, owedCents: paidNow ? (latest?.amount_paid ?? 0) : 0, status: sub.status };
}

/* ── The dunning emails ─────────────────────────────────────────────── */

const DUNNING_KEY = (invoiceId: string, which: "first" | "final") => `dunning:${invoiceId}:${which}`;

export async function ownerContact(orgId: string): Promise<{ email: string; name: string | null } | null> {
  const owner = await db.membership.findFirst({
    where: { organizationId: orgId, role: "OWNER", organization: { deletedAt: null } },
    orderBy: { createdAt: "asc" },
    select: { user: { select: { email: true, name: true } }, organization: { select: { billingEmail: true } } },
  });
  const email = owner?.organization.billingEmail || owner?.user.email;
  return email ? { email, name: owner?.user.name ?? null } : null;
}

/**
 * invoice.payment_failed → the owner hears about it twice at most: on the
 * FIRST failed attempt ("update your card", with the date of Stripe's next
 * try) and when Stripe has made its LAST attempt (no next attempt: the plan
 * closes). The retries in between send nothing. Once per invoice each — a
 * SyncState stamp, written before the send so a redelivered event cannot
 * double it.
 */
export async function sendDunningEmail(invoice: Stripe.Invoice): Promise<"first" | "final" | null> {
  const subId = invoiceSubscriptionId(invoice);
  if (!subId || (invoice.amount_due ?? 0) <= 0) return null;
  const final = !invoice.next_payment_attempt;
  const which: "first" | "final" | null = final ? "final" : (invoice.attempt_count ?? 0) <= 1 ? "first" : null;
  if (!which) return null;
  const mirror = await db.subscription.findFirst({ where: { externalSubId: subId }, select: { organizationId: true, plan: true } });
  if (!mirror) return null;
  // Always sent (owner, 2026-10-21): the "Billing problems" Email cell in Settings → Notifications does not switch
  // these letters off — it governs only the extra notices.
  const key = DUNNING_KEY(invoice.id ?? "", which);
  try {
    await db.syncState.create({ data: { key, cursor: new Date().toISOString() } });
  } catch {
    return null; // already sent for this invoice
  }
  const to = await ownerContact(mirror.organizationId);
  if (!to) return null;
  const [{ appBaseUrl }, { renderEmail }, { sendEmail }, { buildPaymentFailed }, { getPlanDisplayName }] = await Promise.all([
    import("@/lib/appUrl"),
    import("@/lib/email/renderEmail"),
    import("@/lib/sdk/resend"),
    import("@/lib/email/build/billing"),
    import("@/lib/planCatalogServer"),
  ]);
  const base = (await appBaseUrl()).replace(/\/$/, "");
  const planName = await getPlanDisplayName(mirror.plan).catch(() => mirror.plan);
  // The letter leads with the shop's own work, not the bill (owner, 2026-10-16).
  const [shop, tools, pausesAt] = await Promise.all([shopOnJobflex(mirror.organizationId), planTools(mirror.plan), final ? null : firstChargePause(subId)]);
  const { subject, html } = renderEmail(
    buildPaymentFailed({
      name: to.name,
      planName,
      amountCents: invoice.amount_due ?? 0,
      nextAttemptAt: invoice.next_payment_attempt ? new Date(invoice.next_payment_attempt * 1000) : null,
      href: `${base}/dashboard/subscription`,
      final,
      shop,
      tools,
      pausesAt,
    }),
  );
  await sendEmail({ mailClass: "transactional", to: to.email, subject, html, kind: "dunning" });
  return which;
}

/** What the shop has running on JobFlex — the payment letters lead with it (lib/email/build/billing). Never throws. */
export async function shopOnJobflex(orgId: string, now = new Date()): Promise<ShopOnJobflex | null> {
  try {
    const since = new Date(now.getTime() - 30 * 86_400_000);
    const [sent, clients, jobsOpen, leadsOffered] = await Promise.all([
      db.proposal.aggregate({ where: { organizationId: orgId, sentAt: { gte: since } }, _count: { _all: true }, _sum: { total: true } }),
      db.client.count({ where: { organizationId: orgId, deletedAt: null } }),
      db.job.count({ where: { organizationId: orgId, status: { in: ["SCHEDULED", "IN_PROGRESS"] } } }),
      db.leadOffer.count({ where: { organizationId: orgId, createdAt: { gte: since } } }),
    ]);
    return { proposalsSent: sent._count._all, quotedCents: Math.round((sent._sum.total ?? 0) * 100), clients, jobsOpen, leadsOffered };
  } catch (err) {
    console.warn("[cardUpdate] shop numbers unavailable:", err instanceof Error ? err.message : err);
    return null;
  }
}

/** The plan's headline tools — its own lines in the catalog, not the roll-up or the seat count. Never throws. */
export async function planTools(plan: string): Promise<string[]> {
  try {
    const { getPlanCatalog } = await import("@/lib/planCatalogServer");
    const row = (await getPlanCatalog({ includeInactive: true })).find((p) => p.slug === plan.toLowerCase());
    return (row?.features ?? []).map((f) => f.trim()).filter((f) => f && !/^everything in/i.test(f) && !/\busers?\b/i.test(f));
  } catch {
    return [];
  }
}

/** The first charge after a trial failed: when its plan pauses (3 days after the trial ended — lib/stripeStatus,
 *  lib/planStatus LAPSE_GRACE_MS). Null for a renewal, or when Stripe can't say. Never throws. */
export async function firstChargePause(subId: string): Promise<Date | null> {
  try {
    const { stripe } = await getStripeClient();
    const sub = await stripe.subscriptions.retrieve(subId);
    const { firstPeriodAfterTrial } = await import("@/lib/stripeStatus");
    const { LAPSE_GRACE_MS } = await import("@/lib/planStatus");
    return firstPeriodAfterTrial(sub) && sub.trial_end ? new Date(sub.trial_end * 1000 + LAPSE_GRACE_MS) : null;
  } catch {
    return null;
  }
}
