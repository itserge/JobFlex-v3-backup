// WHAT A SUBSCRIPTION EVENT DOES TO THE MIRROR (2026-11-01) — the bodies of
// the Stripe webhook's customer.subscription.updated / .deleted cases, moved
// here unchanged so the platform admin's cancel (lib/adminCancel) writes the
// mirror from Stripe's reply through the same code. The webhook that follows
// it writes the same thing again.

import type Stripe from "stripe";
import { markSubscriptionCanceled, syncSubscriptionFromStripe } from "@/lib/stripeSync";
import { confirmSyncingFromStripe } from "@/lib/planGrant";
import { noteCardlessTrialEnded } from "@/lib/cardlessTrial";
import { mirrorDeckAddon } from "@/lib/deckAddonBilling";
import { mirrorWebAddons } from "@/lib/webAddonBilling";

/** customer.subscription.created / .updated — `sub` as Stripe holds it now. */
export async function onSubscriptionUpdated(sub: Stripe.Subscription, stripe: Stripe): Promise<void> {
  await syncSubscriptionFromStripe(sub, stripe);
  // An admin change written from Stripe's reply is "syncing" until Stripe
  // reports the subscription back in that state (lib/planGrant).
  await confirmSyncingFromStripe(sub).catch((err) => console.warn("[webhook] sync mark:", err));
  // The Deck Studio add-on's line (lib/deckAddonBilling): on the subscription or not, the record follows.
  await mirrorDeckAddon(sub).catch((err) => console.warn("[webhook] deck add-on mirror:", err));
  // The website estimators' lines (lib/webAddonBilling): the record follows what is on the subscription.
  await mirrorWebAddons(sub).catch((err) => console.warn("[webhook] website add-on mirror:", err));
}

/** customer.subscription.deleted — gone from Stripe altogether: this copy is
 *  the last word, and a deletion is final whenever it arrives. */
export async function onSubscriptionDeleted(sub: Stripe.Subscription, stripe: Stripe): Promise<void> {
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
}
