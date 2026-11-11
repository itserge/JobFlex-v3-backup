import "server-only";
// THE CARD PAGE FOR A SIGNUP THAT HAS NO ACCOUNT YET — the Stripe Checkout session, made in one place.
//
// Two doors open it: /api/checkout/signup (JSON, the plan step as it was) and /auth/register/checkout (2026-10-19:
// the server's own 303 to Stripe — after step 1, after Google, on a return visit and from a plan card — so the hand-off
// needs no script, no sessionStorage and no cookie in the browser). Both get the same session from this function.
//
// It is deliberately narrow:
//   · the token must resolve to a live pending intent (a day — lib/pendingSignup) — no token, no
//     session, so this cannot be used as an anonymous Stripe session factory;
//   · the customer email is taken from the INTENT, never from the request;
//   · `client_reference_id` carries the token, which is what
//     `completePendingSignup` checks the returned session against.
// EIGHT SECONDS (owner, 2026-10-19): a session Stripe has not made by then is a failure — the sign-up shows the plan
// cards with a line to try again, rather than a page that waits on Stripe.
import type Stripe from "stripe";
import { getStripeClient, isStripeEnabled } from "@/lib/sdk/stripe";
import { readPendingSignup } from "@/actions/signupCheckout";
import { resolveSignupDiscount, resolveSignupPrice } from "@/lib/signupPricing";
import { customMetadata } from "@/lib/customBilling";
import { CUSTOM_PLAN_OFF_SALE, customPlanOffered } from "@/lib/customPlanFlag";
import { trialOfferMetadata } from "@/lib/trialOffer";
import { CUSTOM_PLAN_SLUG } from "@/lib/customPlan";

export const SIGNUP_CHECKOUT_DEADLINE_MS = 8_000;

export type SignupCheckoutResult = { ok: true; url: string } | { ok: false; error: string; status: number };

export async function createSignupCheckout(input: {
  token: string;
  planSlug: string;
  interval: "MONTH" | "YEAR";
  /** Where Stripe sends the visitor back: this request's own origin. */
  origin: string;
}): Promise<SignupCheckoutResult> {
  if (!isStripeEnabled()) return { ok: false, error: "Stripe is not configured.", status: 503 };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<SignupCheckoutResult>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, error: "Checkout took too long to open.", status: 504 }), SIGNUP_CHECKOUT_DEADLINE_MS);
  });
  try {
    return await Promise.race([open(input), deadline]);
  } catch (err) {
    console.error("[checkout/signup] failed:", err);
    return { ok: false, error: "Couldn't open checkout.", status: 502 };
  } finally {
    clearTimeout(timer);
  }
}

async function open({ token, planSlug, interval, origin }: Parameters<typeof createSignupCheckout>[0]): Promise<SignupCheckoutResult> {
  // Off sale (CUSTOM_PLAN_ENABLED unset): a new shop cannot start on it.
  if (planSlug === CUSTOM_PLAN_SLUG && !customPlanOffered()) return { ok: false, error: CUSTOM_PLAN_OFF_SALE, status: 410 };

  const pending = await readPendingSignup(token);
  if (!pending) return { ok: false, error: "That signup expired. Start again.", status: 410 };

  // Mode-aware from the top: the admin's live/sandbox switch (lib/stripeMode)
  // decides which account this session is created on. The price and the
  // discount are lib/signupPricing's — the card-less trial reads the same.
  const { stripe, mode } = await getStripeClient();
  const priced = await resolveSignupPrice({
    stripe,
    mode,
    planSlug,
    interval,
    customPages: pending.customPages,
    trialOffer: pending.trialOffer,
  });
  if (!priced.ok) return { ok: false, error: priced.error, status: priced.status };
  // The saved offer determines the duration; then Stripe charges the selected price.
  const { trialDays, planLabel, isCustom } = priced;
  /* NO DECK STUDIO HERE (owner, 2026-10-27): the add-on rode every sign-up's checkout from 2026-10-26 and sign-ups
     from the ads fell; the sign-up's Stripe page is the plan and its trial alone. Deck Studio is bought in the app. */
  const lineItems = priced.lineItems;
  const discount = await resolveSignupDiscount({
    stripe,
    mode,
    attribution: pending.attribution,
    trialDays,
    where: "checkout/signup",
    interval: priced.interval,
    monthlyCents: priced.monthlyCents,
  });
  // `discounts` and `allow_promotion_codes` are mutually exclusive at Stripe,
  // so a session with a discount attached has no promo field.
  const discounts: Stripe.Checkout.SessionCreateParams.Discount[] | null = discount ? [discount] : null;

  // REHEARSALS ONLY: STRIPE_TEST_CLOCKS=1 opens the checkout for a customer
  // made on a Stripe test clock of its own, so a harness can walk the trial
  // to day 8 and see the first charge (the card-less trial's rule, in
  // lib/cardlessTrial). Never in production, never on the live account.
  let customer: string | null = null;
  if (mode === "test" && process.env.NODE_ENV !== "production" && process.env.STRIPE_TEST_CLOCKS === "1") {
    const clock = await stripe.testHelpers.testClocks.create({ frozen_time: Math.floor(Date.now() / 1000), name: `signup ${pending.email}`.slice(0, 300) });
    customer = (await stripe.customers.create({ email: pending.email, name: pending.businessName, test_clock: clock.id, metadata: { signupToken: token } })).id;
  }
  const back = `${origin}/auth/register?signup=${encodeURIComponent(token)}`;
  const session = await stripe.checkout.sessions.create(
    {
      mode: "subscription",
      // No payment_method_types (owner, 2026-11-11): the sign-up shows what the Stripe Dashboard turns on — the card
      // and Link. Every other Checkout of ours stays card-only (lib/stripeCheckoutCard).
      ...(customer ? { customer } : { customer_email: pending.email }),
      client_reference_id: token,
      line_items: lineItems,
      // The custom plan's pages ride the subscription too (lib/customBilling);
      // the organization is named on it once the account exists.
      subscription_data:
        trialDays > 0 || isCustom
          ? {
              ...(trialDays > 0 ? { trial_period_days: trialDays } : {}),
              metadata: { ...(isCustom ? customMetadata(null, pending.customPages) : {}), ...trialOfferMetadata(pending.trialOffer) },
            }
          : undefined,
      // A yearly bill takes no code typed at Stripe: a percent "first month"
      // code there would come off the whole year (lib/firstMonthDiscount) —
      // codes are applied on our plan step, as one month's worth.
      ...(discounts ? { discounts } : priced.interval === "MONTH" ? { allow_promotion_codes: true } : {}),
      metadata: {
        ...trialOfferMetadata(pending.trialOffer),
        signupToken: token,
        planSlug: planLabel,
        interval: priced.interval,
        ...(isCustom ? { customPages: pending.customPages.join(",") } : {}),
      },
      success_url: `${back}&session_id={CHECKOUT_SESSION_ID}`,
      // Stripe's back arrow: the plan cards of this sign-up (app/(auth)/auth/register — `checkout=cancelled`).
      cancel_url: `${back}&checkout=cancelled`,
    },
    { timeout: SIGNUP_CHECKOUT_DEADLINE_MS },
  );
  if (!session.url) return { ok: false, error: "Couldn't open checkout.", status: 502 };
  return { ok: true, url: session.url };
}
