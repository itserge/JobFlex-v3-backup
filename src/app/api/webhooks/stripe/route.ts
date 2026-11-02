import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { db } from "@/lib/db";
import { getStripe, isStripeEnabled } from "@/lib/sdk/stripe";
import { runWebhookEnvelope } from "@/lib/webhookEnvelope";
import {
  syncSubscriptionFromStripe,
  markSubscriptionCanceled,
  markSubscriptionPastDue,
  accrueForInvoice,
  reverseForCharge,
  holdForDispute,
  settleDispute,
  handleConnectAccountUpdate,
  handleTransferEvent,
} from "@/lib/stripeSync";
import { confirmSyncingFromStripe } from "@/lib/planGrant";
import { processReferralEffectsForInvoice } from "@/lib/referralRewards";
import { trackActivation } from "@/lib/activation-events";
import { finishCardCheckout, noteCardlessTrialEnded } from "@/lib/cardlessTrial";
import { CARD_UPDATE_PURPOSE, finishCardUpdate, sendDunningEmail } from "@/lib/cardUpdate";
import { completeFromCheckoutSession, completeFromPaymentIntent } from "@/lib/leadCenter/purchase";
import { completeFromPackSession } from "@/lib/aiDesk/packs";
import { cancelReplacedSubscription } from "@/lib/checkoutReturn";
import { invoiceSubscriptionId, refId } from "@/lib/stripeCompat";
import { alertDisputeClosed, alertDisputeOpened, alertInvoiceFailed, alertInvoicePaid, alertOneTimeCharge } from "@/lib/adminAlertsPayments";
import { mirrorDeckAddon } from "@/lib/deckAddonBilling";
import { mirrorWebAddons } from "@/lib/webAddonBilling";
import { markFailuresRecovered, noteInvoiceFailure } from "@/lib/paymentFailures";
import { textOwnerPaymentFailed } from "@/lib/billingProblemText";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!isStripeEnabled() || !process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ disabled: true });
  }

  const sig = req.headers.get("stripe-signature");
  const body = await req.text();
  const stripe = getStripe();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig!, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "bad signature";
    return NextResponse.json({ error: `Webhook signature: ${msg}` }, { status: 400 });
  }

  const result = await runWebhookEnvelope(
    { provider: "STRIPE", eventId: event.id, type: event.type },
    () => dispatch(event, stripe),
  );
  if (result.outcome === "duplicate") return NextResponse.json({ duplicate: true });
  // 500 so Stripe retries; the idempotency keys make re-processing safe.
  if (result.outcome === "failed") return NextResponse.json({ error: result.error }, { status: 500 });
  return NextResponse.json({ received: true });
}

async function dispatch(event: Stripe.Event, stripe: Stripe) {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      // A Lead Center lead paid through Checkout (lib/leadCenter/purchase):
      // the contacts open here, or on the return page if it got there first.
      if (await completeFromCheckoutSession(session)) {
        await sessionChargeAlert(session, event.livemode);
        break;
      }
      // An AI desk minute pack paid through Checkout (lib/aiDesk/packs): on the
      // balance here, or on the return page if it got there first.
      if (await completeFromPackSession(session)) {
        await sessionChargeAlert(session, event.livemode);
        break;
      }
      // A card added to a card-less trial (setup mode), or the plan restarted
      // after one ended (subscription mode) — lib/cardlessTrial. The return
      // page usually got there first; both are safe to run twice.
      const purpose = session.metadata?.jf_purpose;
      const trialOrg = session.metadata?.organizationId;
      // A new card after a failed payment (lib/cardUpdate): made the default
      // and the open invoice paid with it. The return page usually got there
      // first; both are safe to run twice.
      if (trialOrg && purpose === CARD_UPDATE_PURPOSE) {
        const done = await finishCardUpdate(trialOrg, session.id);
        if (!done.ok) console.warn(`[webhook] card update for ${trialOrg}: ${done.error}`);
        break;
      }
      if (trialOrg && (purpose === "trial-card" || purpose === "trial-restart")) {
        const done = await finishCardCheckout(trialOrg, session.id);
        if (!done.ok) console.warn(`[webhook] trial card for ${trialOrg}: ${done.error}`);
        if (purpose === "trial-card") break;
      }
      if (session.mode === "subscription" && session.subscription) {
        const sub = await stripe.subscriptions.retrieve(
          typeof session.subscription === "string" ? session.subscription : session.subscription.id,
        );
        await syncSubscriptionFromStripe(sub, stripe);
        // A plan checkout that replaces a subscription ends the old one here
        // too — the customer may never reach the return page (lib/checkoutReturn).
        if (sub.status === "active" || sub.status === "trialing") {
          await cancelReplacedSubscription(stripe, session, sub.id, "webhook");
        }
      } else {
        await handleProposalPayment(session); // existing one-time proposal payment flow
      }
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const sub = await freshSubscription(stripe, event);
      if (!sub) break; // gone from Stripe: nothing live to write
      await syncSubscriptionFromStripe(sub, stripe);
      // An admin change written from Stripe's reply is "syncing" until Stripe
      // reports the subscription back in that state (lib/planGrant).
      await confirmSyncingFromStripe(sub).catch((err) => console.warn("[webhook] sync mark:", err));
      // The Deck Studio add-on's line (lib/deckAddonBilling): on the subscription or not, the record follows.
      await mirrorDeckAddon(sub).catch((err) => console.warn("[webhook] deck add-on mirror:", err));
      // The website estimators' lines (lib/webAddonBilling): the record follows what is on the subscription.
      await mirrorWebAddons(sub).catch((err) => console.warn("[webhook] website add-on mirror:", err));
      break;
    }
    case "customer.subscription.deleted": {
      // Gone from Stripe altogether: the event's own copy is the last word,
      // and a deletion is final whenever it arrives.
      const sub = (await freshSubscription(stripe, event)) ?? (event.data.object as Stripe.Subscription);
      // A card-less trial that ran out lands as TRIAL_ENDED, not CANCELED
      // (lib/stripeSync, isCardlessTrialLapse) — both are the Free plan.
      if (sub.status === "canceled" || sub.status === "incomplete_expired") {
        await markSubscriptionCanceled(sub);
        await noteCardlessTrialEnded(sub);
      } else {
        await syncSubscriptionFromStripe(sub, stripe);
      }
      await mirrorDeckAddon(sub, true).catch((err) => console.warn("[webhook] deck add-on mirror:", err));
      await mirrorWebAddons(sub, true).catch((err) => console.warn("[webhook] website add-on mirror:", err));
      break;
    }
    // Three days before any trial ends. The mirror follows the subscription
    // (its trial end may have moved); the card-less trial's reminder emails
    // are the daily cron's (/api/cron/trials), on its own two-day and same-day
    // schedule.
    case "customer.subscription.trial_will_end": {
      const sub = await freshSubscription(stripe, event);
      if (sub) await syncSubscriptionFromStripe(sub, stripe);
      break;
    }
    case "invoice.paid": {
      const invoice = event.data.object as Stripe.Invoice;
      await accrueForInvoice(invoice, event.id, stripe);
      // Member-referral side: convert PENDING referrals on the referred org's
      // first real payment + apply owed 50%-of-a-month referrer credits.
      await processReferralEffectsForInvoice(invoice);
      // The team's "Payments" text (lib/adminAlertsPayments) — once per invoice, $0 skipped.
      await alertInvoicePaid(invoice, event.livemode).catch((err) => console.warn("[adminAlerts] paid text:", err));
      // Its failed tries on record are won back (lib/paymentFailures, /admin/revenue/failed-payments).
      await markFailuresRecovered(invoice).catch((err) => console.warn("[payment-failure] recovered mark:", err));
      break;
    }
    // A lead paid through Checkout with a method that settles later (a Link
    // bank debit): the session completes unpaid and this is the "paid".
    case "checkout.session.async_payment_succeeded": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (await completeFromCheckoutSession(session)) await sessionChargeAlert(session, event.livemode);
      break;
    }
    // The backstop for a lead charged to the card on file: the synchronous
    // "succeeded" opens it at once, and this repairs the rare charge whose
    // answer never got written. Ignores every PaymentIntent that is not a lead's.
    case "payment_intent.succeeded": {
      const pi = event.data.object as Stripe.PaymentIntent;
      await completeFromPaymentIntent(pi);
      // A lead or minute pack charged to the card on file never passes a Checkout
      // session; the same charge bought through Checkout is told once (by its id).
      await alertOneTimeCharge({
        paymentIntentId: pi.id,
        purpose: pi.metadata?.jf_purpose,
        organizationId: pi.metadata?.organizationId,
        cents: pi.amount_received || pi.amount,
        currency: pi.currency,
        livemode: event.livemode,
      }).catch((err) => console.warn("[adminAlerts] one-time paid text:", err));
      break;
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      /* A FAILED PAYMENT IS A MISSED BILL ONLY WHILE STRIPE SAYS SO (2026-10-12).
         A plan change or an added page is all or nothing on the card
         (pending_if_incomplete, lib/planChange, lib/customBilling): when the
         card declines, the change is simply not made — yet Stripe still sends
         this event, and it used to turn a paying shop PAST_DUE and mail its
         owner the "final" dunning letter. An old failure delivered after the
         invoice was paid did the same. The subscription is read: active or
         trialing means nothing is owed on it. */
      const failedSub = invoiceSubscriptionId(invoice);
      const live = failedSub ? await stripe.subscriptions.retrieve(failedSub).catch(() => null) : null;
      const notOwed = Boolean(live && (live.status === "active" || live.status === "trialing"));
      // Every declined try goes on record — the reason and the card (lib/paymentFailures), a
      // not-owed one marked `ignored` so the statistics stay whole. Never fails the event.
      const failed = await noteInvoiceFailure(stripe, invoice, { sub: live, ignored: notOwed }).catch((err) => {
        console.warn(`[payment-failure] ${invoice.id}: Stripe read failed —`, err instanceof Error ? err.message : err);
        return null;
      });
      if (notOwed) {
        console.info(`[webhook] ${invoice.id}: payment failed, but ${failedSub} is ${live!.status} — not a missed bill`);
        break;
      }
      await markSubscriptionPastDue(invoice);
      // The mirror's dates follow at once: a first charge after a trial that
      // failed keeps the plan 3 days from the trial's end (lib/stripeStatus).
      if (live) await syncSubscriptionFromStripe(live, stripe).catch((err) => console.warn("[webhook] past-due sync:", err));
      // The owner's two emails: the first failure, and Stripe's last try.
      await sendDunningEmail(invoice).catch((err) => console.warn("[webhook] dunning email failed:", err));
      // The team's "Failed payments" text, on the same two tries (lib/adminAlertsPayments).
      await alertInvoiceFailed(invoice, event.livemode, stripe).catch((err) => console.warn("[adminAlerts] failed text:", err));
      // The owner's text: the first try, and one more three days on at most (lib/billingProblemText).
      await textOwnerPaymentFailed(invoice, failed);
      break;
    }
    case "charge.refunded": {
      await reverseForCharge(event.data.object as Stripe.Charge, event.id, stripe);
      break;
    }
    // A chargeback removes the commission as a refund does (owner, 2026-09-22):
    // frozen while the dispute is open, reversed if it is lost, released with a
    // fresh hold if it is won. The event's own time is the date the dispute
    // opened or closed — a retried delivery must not move the hold clock.
    case "charge.dispute.created": {
      await holdForDispute(event.data.object as Stripe.Dispute, new Date(event.created * 1000));
      // The team's "Disputes" text (owner, 2026-10-29): who, how much, why, the evidence date (lib/disputeWords).
      await alertDisputeOpened(event.data.object as Stripe.Dispute, event.livemode, stripe).catch((err) => console.warn("[adminAlerts] dispute text:", err));
      break;
    }
    case "charge.dispute.funds_withdrawn": {
      // An inquiry the bank escalated: the same dispute, now a chargeback — the team's second text (an ordinary
      // chargeback already texted on created; disputeOpenedKey keeps it to one).
      await alertDisputeOpened(event.data.object as Stripe.Dispute, event.livemode, stripe).catch((err) => console.warn("[adminAlerts] dispute text:", err));
      break;
    }
    case "charge.dispute.closed": {
      await settleDispute(event.data.object as Stripe.Dispute, event.id, new Date(event.created * 1000));
      await alertDisputeClosed(event.data.object as Stripe.Dispute, event.livemode, stripe).catch((err) => console.warn("[adminAlerts] dispute text:", err));
      break;
    }
    case "account.updated": {
      await handleConnectAccountUpdate(event.data.object as Stripe.Account);
      break;
    }
    case "transfer.created": {
      await handleTransferEvent(event.data.object as Stripe.Transfer, false);
      break;
    }
    case "transfer.reversed": {
      // The event's own time is the reversal date written on the request.
      await handleTransferEvent(event.data.object as Stripe.Transfer, true, new Date(event.created * 1000));
      break;
    }
    default:
      break;
  }
}

/** A lead or minute pack paid through Checkout → the team's "Payments" text, keyed by the
 *  charge's payment intent so the payment_intent.succeeded of the same charge is silent. */
async function sessionChargeAlert(session: Stripe.Checkout.Session, livemode: boolean) {
  if (session.payment_status !== "paid") return;
  await alertOneTimeCharge({
    paymentIntentId: refId(session.payment_intent),
    purpose: session.metadata?.jf_purpose,
    organizationId: session.metadata?.organizationId,
    cents: session.amount_total ?? 0,
    currency: session.currency,
    livemode,
  }).catch((err) => console.warn("[adminAlerts] checkout paid text:", err));
}

/* THE EVENT IS A SIGNAL, STRIPE IS THE STATE (owner, 2026-10-14). A
   subscription event can arrive twice, late, or after a newer one — a
   "trialing" picture delivered after "active" used to put a paying shop back
   on its trial. Every subscription event therefore writes what Stripe holds
   NOW for that subscription, read by id, never the event's own copy. If
   Stripe cannot be read the event is not applied: the throw answers 500 and
   Stripe delivers it again (lib/webhookEnvelope keeps it unprocessed). */
async function freshSubscription(stripe: Stripe, event: Stripe.Event): Promise<Stripe.Subscription | null> {
  const id = (event.data.object as Stripe.Subscription).id;
  try {
    return await stripe.subscriptions.retrieve(id);
  } catch (err) {
    // Stripe answered that it holds no such subscription (its customer was
    // deleted with it): that is an answer, not a failure — null.
    if ((err as { code?: string })?.code === "resource_missing") {
      console.info(`[webhook] ${event.type} ${event.id}: ${id} no longer exists on Stripe`);
      return null;
    }
    console.warn(`[webhook] ${event.type} ${event.id}: could not read ${id} from Stripe — not applied, Stripe will retry:`, err);
    throw new Error(`Could not read subscription ${id} from Stripe`);
  }
}

// One-time proposal payments. The Payment row always records the true amount
// that arrived, but the proposal only flips to PAID when the full expected
// total was actually paid — defense-in-depth against a checkout session created
// for a tampered amount (the checkout routes already derive the amount
// server-side, so a shortfall should only ever come from an out-of-band session).
async function handleProposalPayment(session: Stripe.Checkout.Session) {
  // Contractor-account checkouts (metadata.kind set) never reach this route —
  // they fire on the CONNECTED account and land in /api/webhooks/stripe-connect.
  // The guard only matters if someone points a Connect endpoint here by mistake.
  if (session.metadata?.kind) return;
  const publicId = session.metadata?.publicId;
  if (!publicId) return;
  const proposal = await db.proposal.findUnique({ where: { publicId } });
  if (!proposal) return;

  const expected = Math.round(proposal.total * 100);
  const paid = session.amount_total ?? 0;
  const fullyPaid = paid >= expected;

  // Re-dispatch safety (see the idempotency envelope above): one Payment row
  // per checkout session, no matter how many deliveries reach this handler.
  const already = await db.payment.findFirst({
    where: { externalId: session.id, provider: "STRIPE" },
    select: { id: true },
  });
  if (already) return;

  await db.payment.create({
    data: {
      organizationId: proposal.organizationId,
      proposalId: proposal.id,
      clientId: proposal.clientId,
      amount: paid / 100,
      currency: (session.currency ?? "usd").toUpperCase(),
      provider: "STRIPE",
      status: fullyPaid ? "PAID" : "PARTIAL",
      externalId: session.id,
      method: "card",
      paidAt: new Date(),
    },
  });
  trackActivation("payment_recorded", proposal.organizationId, { provider: "STRIPE", online: true });

  if (fullyPaid) {
    await db.proposal.update({
      where: { id: proposal.id },
      data: { status: "PAID", paidAt: new Date() },
    });
  } else {
    // Underpaid — leave the proposal unpaid and surface it for manual review
    // rather than silently marking a $12k quote PAID for a few cents.
    console.warn(
      `[stripe] proposal ${proposal.id} underpaid: got ${paid} of ${expected} (${session.id}) — not marking PAID`,
    );
  }
}
