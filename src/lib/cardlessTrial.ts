// THE CARD-LESS TRIAL, STRIPE SIDE (owner, 2026-10-01; TRIAL_REQUIRES_CARD
// unset or false — lib/trialPolicy).
//
// START. The plan step asks for no card. When the signup is finished
// (completeCardlessSignup) a Stripe customer and a subscription on the chosen
// plan are created at once, with:
//   · trial_period_days from the saved signup offer (legacy intents keep 7);
//   · no payment method, and trial_settings.end_behavior.missing_payment_method
//     = "cancel" — a trial nobody added a card to simply ends; nothing is ever
//     attempted on a card that does not exist;
//   · metadata.jf_cardless = "1", which is how the webhook and the reconcile
//     cron tell that ending from a customer leaving (lib/stripeSync,
//     isCardlessTrialLapse → TRIAL_ENDED).
//
// ADD A CARD, DURING THE TRIAL. Stripe Checkout in SETUP mode on the same
// customer: the card is saved, made the customer's and the subscription's
// default, and the trial converts to the paid plan when its trial period ends.
//
// ADD A CARD, AFTER IT ENDED. The ended subscription cannot be resumed
// (end_behavior "cancel" deletes it), so Checkout in SUBSCRIPTION mode on the
// same customer, on the plan and pages the subscription was on when it ended
// (lib/trialPlan — not the signup pick), with no second trial: the first
// charge is taken there and the workspace unlocks as the mirror turns ACTIVE.
import "server-only";
import type Stripe from "stripe";
import { getStripeClient } from "@/lib/sdk/stripe";
import { resolveSignupDiscount, resolveSignupPrice, type SignupInterval } from "@/lib/signupPricing";
import { trialOfferMetadata, type TrialOffer } from "@/lib/trialOffer";
import { cardlessTrialState, patchCardlessRecord, readCardlessRecord, type CardlessRecord } from "@/lib/trialState";
import { isCardlessTrialLapse, syncSubscriptionFromStripe } from "@/lib/stripeSync";
import { db } from "@/lib/db";
import { CUSTOM_PLAN_SLUG, customPriceCents } from "@/lib/customPlan";
import { getPlanBySlug } from "@/lib/planCatalogServer";
import { currentTrialPlan } from "@/lib/trialPlan";
import { CARD_ONLY_CHECKOUT } from "@/lib/stripeCheckoutCard";
import { cardCents, isToolsSlug, toolPlanBySlug, YEAR_MONTHS, type ToolId } from "@/lib/toolPlans/shared";
import { toolsChoice } from "@/lib/toolPlans/cards";
import { readToolCatalog } from "@/lib/toolPlans/prices";
import { readToolsRecord } from "@/lib/toolPlans/billing";

export type CardlessStart =
  | {
      ok: true;
      subscription: Stripe.Subscription;
      customerId: string;
      planLabel: string;
      interval: SignupInterval;
      customPages: string[];
      mode: "live" | "test";
      /** The new plans: the main tool on the subscription (null: none). Absent on a Classic plan. */
      mainTool?: ToolId | null;
    }
  | { ok: false; error: string };

/**
 * Customer + trialing subscription, no payment method. Idempotent per signup
 * token (Stripe idempotency keys), so a retried confirmation never opens a
 * second subscription.
 */
export async function createCardlessSubscription(opts: {
  token: string;
  email: string;
  businessName: string;
  planSlug: string;
  interval: SignupInterval;
  customPages: string[];
  attribution: { kind: "promo" | "ref"; code: string } | null;
  trialOffer?: TrialOffer;
  /** The new plans: the main tool picked on the card page — the same lines the card checkout bills (lib/signupPricing). */
  mainTool?: string | null;
}): Promise<CardlessStart> {
  const { stripe, mode } = await getStripeClient();
  const priced = await resolveSignupPrice({
    stripe,
    mode,
    planSlug: opts.planSlug,
    interval: opts.interval,
    customPages: opts.customPages,
    trialOffer: opts.trialOffer,
    mainTool: opts.mainTool,
  });
  if (!priced.ok) return { ok: false, error: priced.error };
  const discount = await resolveSignupDiscount({
    stripe,
    mode,
    attribution: opts.attribution,
    trialDays: priced.trialDays,
    where: "cardless-trial",
    interval: priced.interval,
    monthlyCents: priced.monthlyCents,
  });
  const meta: Record<string, string> = {
    signupToken: opts.token,
    planSlug: priced.planLabel,
    interval: priced.interval,
    jf_cardless: "1",
    ...trialOfferMetadata(opts.trialOffer),
    ...(priced.isCustom ? { customPages: opts.customPages.join(",") } : {}),
    // The new plans: the main tool rides the subscription, as on the card checkout (lib/signupCheckoutSession).
    ...(priced.mainTool !== undefined ? { mainTool: priced.mainTool ?? "" } : {}),
  };
  try {
    // REHEARSALS ONLY: STRIPE_TEST_CLOCKS=1 puts each new trial customer on a
    // Stripe test clock of its own, so a harness can walk it to day 8. Never
    // in production, never on the live account.
    let testClock: string | undefined;
    if (mode === "test" && process.env.NODE_ENV !== "production" && process.env.STRIPE_TEST_CLOCKS === "1") {
      testClock = (await stripe.testHelpers.testClocks.create({ frozen_time: Math.floor(Date.now() / 1000), name: `trial ${opts.email}`.slice(0, 300) })).id;
    }
    const customer = await stripe.customers.create(
      {
        email: opts.email,
        name: opts.businessName,
        metadata: { signupToken: opts.token, jf_cardless: "1" },
        ...(testClock ? { test_clock: testClock } : {}),
      },
      { idempotencyKey: `cardless-customer:${opts.token}` },
    );
    const subscription = await stripe.subscriptions.create(
      {
        customer: customer.id,
        items: priced.lineItems,
        trial_period_days: priced.trialDays,
        trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
        // A card added later through Checkout becomes the subscription's own.
        payment_settings: { save_default_payment_method: "on_subscription" },
        metadata: meta,
        // Basil removed the top-level coupon / promotion_code parameters.
        ...(discount ? { discounts: [discount] } : {}),
      },
      { idempotencyKey: `cardless-subscription:${opts.token}` },
    );
    return {
      ok: true,
      subscription,
      customerId: customer.id,
      planLabel: priced.planLabel,
      interval: priced.interval,
      customPages: priced.isCustom ? opts.customPages : [],
      mode,
      ...(priced.mainTool !== undefined ? { mainTool: priced.mainTool } : {}),
    };
  } catch (err) {
    console.error("[cardless-trial] Stripe refused the trial:", err);
    return { ok: false, error: "Couldn't start the trial. Try again in a minute." };
  }
}

/** customer.subscription.deleted for a card-less trial that ran out: the
 *  record notes when (the mirror itself is set by markSubscriptionCanceled). */
export async function noteCardlessTrialEnded(sub: Stripe.Subscription): Promise<void> {
  if (!isCardlessTrialLapse(sub)) return;
  const row = await db.subscription.findFirst({ where: { externalSubId: sub.id }, select: { organizationId: true } });
  if (!row) return;
  const rec = await readCardlessRecord(row.organizationId);
  if (rec && rec.subId === sub.id && !rec.endedAt) {
    await patchCardlessRecord(row.organizationId, { endedAt: new Date((sub.ended_at ?? Math.floor(Date.now() / 1000)) * 1000).toISOString() });
  }
}

/** Once the organization exists: name it on the subscription (the webhook's
 *  first way to map it) — best-effort, the mirror row maps it anyway. */
export async function nameOrgOnSubscription(subId: string, orgId: string): Promise<void> {
  try {
    const { stripe } = await getStripeClient();
    await stripe.subscriptions.update(subId, { metadata: { organizationId: orgId } });
    await stripe.customers.update(
      (await stripe.subscriptions.retrieve(subId)).customer as string,
      { metadata: { organizationId: orgId } },
    );
  } catch (err) {
    console.warn("[cardless-trial] could not name the organization on Stripe:", err);
  }
}

/** The plan the trial runs on, as the screens print it — the one on the
 *  subscription NOW (lib/trialPlan), not the signup pick: a plan switched
 *  during the trial, by the owner or by support, and a custom plan's pages
 *  added or removed move what the ribbon, the reminders and the card
 *  checkout name. */
export async function trialPlanSummary(orgId: string, rec: CardlessRecord): Promise<{ name: string; cents: number; per: string }> {
  const { planSlug, interval, customPages } = await currentTrialPlan(orgId, rec);
  const per = interval === "YEAR" ? "/yr" : "/mo";
  if (planSlug === CUSTOM_PLAN_SLUG) return { name: "Custom", cents: customPriceCents(customPages, interval), per };
  // The new plans: the size with the shop's main tool ("Professional + Deck Studio"), at the prices in force.
  const tools = toolPlanBySlug(planSlug);
  if (tools) {
    const [catalog, record] = await Promise.all([readToolCatalog(), readToolsRecord(orgId).catch(() => null)]);
    const main = record?.main ?? null;
    const monthly = cardCents(tools.id, main, catalog);
    return { name: toolsChoice(tools.id, main, catalog).label, cents: interval === "YEAR" ? monthly * YEAR_MONTHS : monthly, per };
  }
  const plan = await getPlanBySlug(planSlug);
  const cents = interval === "YEAR" ? (plan?.yearlyPriceCents ?? plan?.priceCents ?? 0) : (plan?.priceCents ?? 0);
  return { name: plan?.name ?? planSlug, cents, per };
}

/**
 * The Checkout that adds the card: setup mode during the trial, subscription
 * mode (the same plan, no new trial) once it has ended. Null when there is
 * nothing to add a card to.
 */
export async function openCardCheckout(orgId: string, origin: string): Promise<{ url: string; purpose: "trial-card" | "trial-restart" } | null> {
  const state = await cardlessTrialState(orgId);
  if (!state || (state.kind === "trialing" && state.hasCard)) return null;
  const rec = state.record;
  const { stripe, mode } = await getStripeClient();
  const back = `${origin}/dashboard/trial`;
  if (state.kind === "trialing") {
    const session = await stripe.checkout.sessions.create({
      mode: "setup",
      currency: "usd",
      ...CARD_ONLY_CHECKOUT,
      customer: rec.customerId,
      client_reference_id: orgId,
      metadata: { organizationId: orgId, jf_purpose: "trial-card", subscriptionId: rec.subId },
      setup_intent_data: { metadata: { organizationId: orgId, subscriptionId: rec.subId } },
      success_url: `${back}?card=added&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${back}?card=cancelled`,
    });
    if (!session.url) return null;
    return { url: session.url, purpose: "trial-card" };
  }
  // The plan on the subscription when it ended (and a custom plan's pages
  // now), not the signup pick (lib/trialPlan).
  const plan = await currentTrialPlan(orgId, rec);
  // The new plans restart on the size and the main tool the shop had (its record, lib/toolPlans/billing).
  const mainTool = isToolsSlug(plan.planSlug) ? ((await readToolsRecord(orgId).catch(() => null))?.main ?? null) : undefined;
  const priced = await resolveSignupPrice({ stripe, mode, planSlug: plan.planSlug, interval: plan.interval, customPages: plan.customPages, mainTool });
  if (!priced.ok) throw new Error(priced.error);
  // The win-back's 10% (lib/trialWinback), applied by itself while the offer stands.
  const { winbackOffer } = await import("@/lib/trialWinback");
  const offer = await winbackOffer(orgId).catch(() => null);
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    ...CARD_ONLY_CHECKOUT,
    customer: rec.customerId,
    client_reference_id: orgId,
    line_items: priced.lineItems,
    ...(offer ? { discounts: [{ coupon: offer.couponId }] } : {}),
    subscription_data: {
      metadata: {
        organizationId: orgId,
        planSlug: priced.planLabel,
        interval: priced.interval,
        jf_after_trial: "1",
        ...(priced.isCustom ? { customPages: plan.customPages.join(",") } : {}),
        ...(priced.mainTool !== undefined ? { mainTool: priced.mainTool ?? "" } : {}),
      },
    },
    metadata: { organizationId: orgId, jf_purpose: "trial-restart", planSlug: priced.planLabel, ...(offer ? { jf_winback: `${offer.pct}` } : {}) },
    success_url: `${back}?card=added&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${back}?card=cancelled`,
  });
  if (!session.url) return null;
  return { url: session.url, purpose: "trial-restart" };
}

/**
 * A completed card Checkout, from the return URL or the webhook — whichever
 * comes first; both are safe to run twice. Setup mode: the card becomes the
 * customer's and the trial subscription's default. Subscription mode: the new
 * subscription is mirrored (ACTIVE) and the trial record is closed.
 */
export async function finishCardCheckout(
  orgId: string,
  sessionOrId: string | Stripe.Checkout.Session,
): Promise<{ ok: true; purpose: string } | { ok: false; error: string }> {
  const { stripe } = await getStripeClient();
  const session =
    typeof sessionOrId === "string"
      ? await stripe.checkout.sessions.retrieve(sessionOrId, { expand: ["setup_intent", "subscription"] })
      : sessionOrId;
  if (session.metadata?.organizationId !== orgId) return { ok: false, error: "That checkout is not this workspace's." };
  if (session.status !== "complete") return { ok: false, error: "The card was not added." };
  const rec = await readCardlessRecord(orgId);
  if (!rec) return { ok: false, error: "No trial to add a card to." };
  const purpose = session.metadata?.jf_purpose ?? "";

  if (purpose === "trial-card") {
    const si =
      typeof session.setup_intent === "string"
        ? await stripe.setupIntents.retrieve(session.setup_intent)
        : session.setup_intent;
    const pm = si && (typeof si.payment_method === "string" ? si.payment_method : si.payment_method?.id);
    if (!pm) return { ok: false, error: "The card was not saved." };
    await stripe.customers.update(rec.customerId, { invoice_settings: { default_payment_method: pm } });
    await stripe.subscriptions.update(rec.subId, { default_payment_method: pm });
    if (!rec.cardAt) await patchCardlessRecord(orgId, { cardAt: new Date().toISOString() });
    return { ok: true, purpose };
  }

  if (purpose === "trial-restart") {
    const sub =
      typeof session.subscription === "string"
        ? await stripe.subscriptions.retrieve(session.subscription)
        : session.subscription;
    if (!sub) return { ok: false, error: "The plan did not restart." };
    await syncSubscriptionFromStripe(sub, stripe);
    if (!rec.restartedAt) await patchCardlessRecord(orgId, { restartedAt: new Date().toISOString() });
    return { ok: true, purpose };
  }
  return { ok: false, error: "Unknown checkout." };
}

/** What the banner and the trial page draw — plain data for client components. */
export type TrialView = {
  kind: "trialing" | "ended";
  daysLeft: number;
  /** ISO — the trial's end (the first charge when a card is on file). */
  endsAt: string;
  hasCard: boolean;
  /** The owner cancelled: the trial ends on the Free plan (lib/freePlan). */
  toFree: boolean;
  planName: string;
  /** "$79/mo" */
  price: string;
  /** The win-back's offer while it stands (lib/trialWinback): the trial page says so and the card step applies it. */
  offer: { pct: number; months: number; until: string } | null;
};

export async function trialView(orgId: string): Promise<TrialView | null> {
  const state = await cardlessTrialState(orgId);
  const { winbackOffer } = await import("@/lib/trialWinback");
  const offer = state?.kind === "ended" ? await winbackOffer(orgId).then((o) => (o ? { pct: o.pct, months: o.months, until: o.until } : null)).catch(() => null) : null;
  if (!state) return null;
  const plan = await trialPlanSummary(orgId, state.record);
  const dollars = plan.cents / 100;
  const price = `$${Number.isInteger(dollars) ? dollars : dollars.toFixed(2)}${plan.per}`;
  if (state.kind === "ended") {
    return {
    offer, kind: "ended", daysLeft: 0, endsAt: state.endedAt.toISOString(), hasCard: false, toFree: false, planName: plan.name, price };
  }
  return {
    offer, kind: "trialing", daysLeft: state.daysLeft, endsAt: state.endsAt.toISOString(), hasCard: state.hasCard, toFree: state.toFree, planName: plan.name, price };
}

const HOUR_MS = 60 * 60 * 1000;

async function ownerContact(orgId: string): Promise<{ email: string; name: string | null } | null> {
  const owner = await db.membership.findFirst({
    where: { organizationId: orgId, role: "OWNER", organization: { deletedAt: null } },
    orderBy: { createdAt: "asc" },
    select: { user: { select: { email: true, name: true } }, organization: { select: { billingEmail: true } } },
  });
  const email = owner?.organization.billingEmail || owner?.user.email;
  return email ? { email, name: owner?.user.name ?? null } : null;
}

/**
 * THE DAILY WATCH (hourly cron /api/cron/trials). For every card-less trial
 * with no card: the "2 days left" email once the end is under 48 hours away,
 * the "ends today" email under 24, each once; and a trial past its end is
 * stamped ended (the lock itself never waits for this — lib/trialState).
 */
export async function runCardlessTrialSweep(now = new Date()): Promise<{ scanned: number; soon: number; today: number; ended: number }> {
  const { appBaseUrl } = await import("@/lib/appUrl");
  const { renderEmail } = await import("@/lib/email/renderEmail");
  const { sendEmail } = await import("@/lib/sdk/resend");
  const { buildTrialReminder } = await import("@/lib/email/build/trial");
  const rows = await db.syncState.findMany({ where: { key: { startsWith: "cardlessTrial:" } }, select: { key: true } });
  const out = { scanned: rows.length, soon: 0, today: 0, ended: 0 };
  const base = (await appBaseUrl()).replace(/\/$/, "");
  for (const { key } of rows) {
    const orgId = key.slice("cardlessTrial:".length);
    try {
      const state = await cardlessTrialState(orgId, now);
      if (!state) continue;
      if (state.kind === "ended") {
        if (!state.record.endedAt) {
          await patchCardlessRecord(orgId, { endedAt: state.endedAt.toISOString() });
          out.ended++;
        }
        continue;
      }
      // A card on file, or a trial the owner cancelled: nothing to remind.
      if (state.hasCard || state.toFree) continue;
      const left = state.endsAt.getTime() - now.getTime();
      const when = left <= 24 * HOUR_MS ? "today" : left <= 48 * HOUR_MS ? "soon" : null;
      if (!when) continue;
      if (when === "today" ? state.record.mailedTodayAt : state.record.mailedSoonAt) continue;
      const to = await ownerContact(orgId);
      if (!to) continue;
      const plan = await trialPlanSummary(orgId, state.record);
      const dollars = plan.cents / 100;
      const { subject, html } = renderEmail(
        buildTrialReminder({
          trialDays: state.record.trialDays ?? 7,
          name: to.name,
          planName: plan.name,
          price: `$${Number.isInteger(dollars) ? dollars : dollars.toFixed(2)}${plan.per}`,
          endsAt: state.endsAt,
          href: `${base}/dashboard/trial`,
          when,
        }),
      );
      await sendEmail({ to: to.email, subject, html });
      // The "today" email stands for both when the trial was already inside
      // its last day at the first look: the two-day one is not sent late.
      await patchCardlessRecord(orgId, when === "today" ? { mailedTodayAt: now.toISOString(), mailedSoonAt: state.record.mailedSoonAt ?? now.toISOString() } : { mailedSoonAt: now.toISOString() });
      out[when]++;
    } catch (err) {
      console.warn(`[cardless-trial] sweep ${orgId}:`, err);
    }
  }
  return out;
}
