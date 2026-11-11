// CHECKOUT FOR A SIGNUP THAT HAS NO ACCOUNT YET.
//
// The ordinary subscription checkout (../subscription) is owner-scoped: it
// prices for an organization that already exists. This one runs BEFORE the
// organization exists — the visitor is a pending intent parked by
// actions/signupCheckout.ts, identified by an unguessable token, and the
// account is created only when this session comes back complete.
//
// It is deliberately narrow:
//   · the token must resolve to a live pending intent (lib/signupCheckoutSession has the rules);
//   · the customer email is taken from the INTENT, never from the request body.
import { NextResponse } from "next/server";
import { isStripeEnabled } from "@/lib/sdk/stripe";
import { signupTrialMode } from "@/lib/trialPolicyServer";
import { createSignupCheckout } from "@/lib/signupCheckoutSession";

export const runtime = "nodejs";

export async function POST(req: Request) {
  // The card checkout is the plan step's "card" path (signupTrialMode,
  // lib/trialPolicyServer). It is ALWAYS honoured (owner, 2026-10-07): a page
  // loaded while the trial took a card may press after the switch went to
  // "no card" — the visitor chose the card, so Checkout opens rather than a
  // dead end. The answer is read only to note that case.
  if ((await signupTrialMode()) === "no-card") {
    console.info("[signup] card checkout while the trial is card-less: the page was loaded on the card path");
  }
  if (!isStripeEnabled()) {
    return NextResponse.json({ error: "Stripe is not configured." }, { status: 503 });
  }

  // `customPages` arrives in the body for symmetry with the client, but it is
  // NOT read: the selection that gets priced is the one stored with the intent.
  // `mainTool`: the new plans' main tool, validated and priced on the server (lib/signupPricing) — never a price.
  const { token, planSlug, interval, mainTool } = await req.json().catch(() => ({}));
  if (!token || !planSlug || !interval) {
    return NextResponse.json(
      { error: "token, planSlug and interval are required." },
      { status: 400 },
    );
  }
  if (interval !== "MONTH" && interval !== "YEAR") {
    return NextResponse.json({ error: "interval must be MONTH or YEAR." }, { status: 400 });
  }

  // The session itself (and its eight-second deadline) is lib/signupCheckoutSession's — the register page's own
  // 303 to Stripe (app/(auth)/auth/register/checkout) makes the same one.
  const res = await createSignupCheckout({
    token: String(token),
    planSlug: String(planSlug),
    interval,
    origin: new URL(req.url).origin,
    mainTool: typeof mainTool === "string" ? mainTool : null,
  });
  return res.ok ? NextResponse.json({ url: res.url }) : NextResponse.json({ error: res.error }, { status: res.status });
}
