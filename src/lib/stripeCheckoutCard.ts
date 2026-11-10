// THE CARD FORM ON STRIPE'S PAGE (owner, 2026-11-09).
//
// Every Checkout Session JobFlex opens for its own money — the sign-up, the auto-plan after step 1, the plan cards,
// the upgrade, the Deck Studio add-on riding a plan Checkout, the card-less trial's card and restart, the card update,
// the AI-desk minute pack, the Lead Center lead — names its payment methods: cards only. Left to the Dashboard's
// payment method settings Stripe led with Link (an email box and a one-time code) instead of the card fields. With
// `payment_method_types` naming "card" alone, Link is not offered, and `wallet_options.link.display: "never"` keeps
// it off even if a later API version starts reading the Dashboard again. Apple Pay and Google Pay are card wallets:
// Stripe still shows them on a supported device with "card" alone, so nothing else is needed to keep them.
//
// Not for the homeowner's proposal payment (lib/payments/createCheckout) — that runs on the contractor's own Stripe
// account and names its own methods (card, ACH when the shop allows it).
import type Stripe from "stripe";

export const CARD_ONLY_CHECKOUT = {
  payment_method_types: ["card"],
  wallet_options: { link: { display: "never" } },
} satisfies Pick<Stripe.Checkout.SessionCreateParams, "payment_method_types" | "wallet_options">;
