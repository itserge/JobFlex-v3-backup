"use server";

import { REFERRAL_DISCOUNT_PCT } from "@/lib/referralDiscount";

// THE SIGN-UP PAYWALL — what the plan step needs from the server.
//
// Two PUBLIC calls — public because at this point in the flow there is no
// account yet (see actions/signupCheckout: pay first, then the account):
//   · `signupPlans()` reads the live plan catalog (the same /admin/plans rows
//     every other surface reads — never a copy) plus whatever promo the visitor
//     arrived with, so the step can price itself honestly before anyone types
//     anything.
//   · `applySignupPromo(code)` validates a code typed by hand against the SAME
//     promo/referral tables the ?promo and ?ref links use. It stamps nothing:
//     the validated code rides along with the pending signup and is bound to
//     the organization when that organization is created. One discount system,
//     one binding path.
import type { PlanLimits } from "@/lib/planLimits";
import { signupTrialOffer } from "@/lib/trialOfferServer";
import { readPendingSignup } from "@/actions/signupCheckout";
import { validateAttribution } from "@/lib/attribution";
import { isStripeEnabled } from "@/lib/sdk/stripe";
import { autoPlanOffer, type AutoPlanAsk } from "@/lib/signupAutoPlanServer";
import { parseSpotlightTool } from "@/lib/planSpotlight";
import type { AutoPlanOffer } from "@/lib/signupAutoPlan";
import { readToolCatalog } from "@/lib/toolPlans/prices";
import { getPublicPlans } from "@/lib/toolPlans/publicPlans";
import { isToolsCatalog, mainToolFor, parseToolPicks, toolsPlanFromAsk } from "@/lib/toolPlans/cards";
import type { Catalog, ToolId, ToolPlanId } from "@/lib/toolPlans/shared";

export interface SignupPlan {
  slug: string;
  name: string;
  description: string | null;
  priceCents: number;
  yearlyPriceCents: number | null;
  trialDays: number;
  features: string[];
  /** The plan's caps (lib/planLimits). The cards print no cap before a row (owner, 2026-11-04) — the tool alone. */
  limits: PlanLimits;
  highlight: boolean;
}

export interface SignupPromo {
  code: string;
  /** Whose code it is — an influencer's display name or a member's name. */
  displayName: string;
  /** Percent off for the customer, when the promo carries one. */
  percentOff: number | null;
  /** Paid months the percent lasts (lib/promoDiscount; null = 1). A referral is one month. */
  discountMonths: number | null;
  kind: "promo" | "ref";
}

export async function signupPlans(token?: string, ask: AutoPlanAsk = {}): Promise<{
  plans: SignupPlan[];
  /** A code already stamped on this org (from a ?promo / ?ref link). */
  promo: SignupPromo | null;
  /** False when Stripe is not configured — the step then offers only "skip". */
  checkoutReady: boolean;
  /** The custom plan's trial. It has no catalog row, so it rides alongside
   *  the list rather than inside it, using the same saved offer. */
  customTrialDays: number;
  /** When the trial ends and the first charge falls (unix ms): today plus the
   *  same saved offer's days that /api/checkout/signup sends Stripe as
   *  trial_period_days, and the card-less trial uses (lib/signupPricing). */
  firstChargeAt: number;
  /** Straight to Professional, as the admin switch says NOW (lib/signupAutoPlanServer): the plan the step opens the
   *  card page for, or null for the plan cards — never the page's own copy from when it was drawn, nor anything a
   *  draft or intent kept from an earlier visit. */
  autoPlan: AutoPlanOffer | null;
  /** THE NEW PLANS (the Plans switch on, Base + Tools part 4; the builder 2026-11-12): the sign-up's plan builder —
   *  the prices in force (Admin → Plans), the tools it opens ticked (the pick the page sent, else the ad's tool; the
   *  first is the main tool) and the size (the one asked for, else Professional). `plans` are then the four sizes at
   *  their own prices. Null: the Classic plan cards, exactly as before. */
  tools: { catalog: Catalog; main: ToolId | null; picks: ToolId[]; plan: ToolPlanId } | null;
}> {
  const pending = token ? await readPendingSignup(token) : null;
  const trialDays = (pending?.trialOffer ?? await signupTrialOffer()).days;
  // The new plans' pick: what the page's builder holds (tool ids, comma-separated — "" when the visitor ticked none),
  // else the ad's tool the sign-up kept. Read only while the Plans switch is on (lib/toolPlans/publicPlans).
  const kept = mainToolFor({ tool: pending?.landingTool ?? null });
  const picks = typeof ask?.mainTool === "string" ? parseToolPicks(ask.mainTool) : kept ? [kept] : [];
  const main = picks[0] ?? null;
  // The public cards' one read: the Classic catalog (switch off), or the new plans priced with the main tool.
  const catalog = await getPublicPlans({ tool: main, trialDays });
  if (isToolsCatalog(catalog)) {
    const cat = await readToolCatalog();
    const asked = typeof ask?.asked === "string" ? ask.asked.slice(0, 60) : null;
    return {
      plans: catalog.map((p) => ({
        slug: p.slug,
        name: p.name,
        description: p.description,
        priceCents: p.priceCents,
        yearlyPriceCents: p.yearlyPriceCents,
        trialDays,
        features: p.features,
        limits: p.limits,
        highlight: p.highlight,
      })),
      promo: null,
      checkoutReady: isStripeEnabled(),
      customTrialDays: trialDays,
      firstChargeAt: Date.now() + trialDays * 24 * 60 * 60 * 1000,
      autoPlan: await autoPlanOffer({ asked, mainTool: main }),
      tools: { catalog: cat, main, picks, plan: toolsPlanFromAsk(asked) },
    };
  }
  // Whatever the visitor arrived with is carried in the client's attribution
  // pill and applied at account creation; there is no organization to read a
  // stamp from at this point in the flow.
  const promo: SignupPromo | null = null;

  return {
    // A $0 plan is not a thing to sell on this step; it is what happens when
    // somebody skips.
    plans: catalog
      .filter((p) => !p.isFree)
      .map((p) => ({
        slug: p.slug,
        name: p.name,
        description: p.description,
        priceCents: p.priceCents,
        yearlyPriceCents: p.yearlyPriceCents,
        // Use the saved offer on every plan, matching Checkout's duration.
        trialDays,
        features: p.features,
        limits: p.limits,
        highlight: p.highlight,
      })),
    promo,
    checkoutReady: isStripeEnabled(),
    customTrialDays: trialDays,
    firstChargeAt: Date.now() + trialDays * 24 * 60 * 60 * 1000,
    autoPlan: await autoPlanOffer(
      {
        asked: typeof ask?.asked === "string" ? ask.asked.slice(0, 60) : null,
        edition: ask?.edition === "deck" ? "deck" : null,
        tool: typeof ask?.tool === "string" ? (parseSpotlightTool(ask.tool) ?? null) : null,
      },
      catalog,
    ),
    tools: null,
  };
}

export async function applySignupPromo(
  rawCode: string,
): Promise<{ ok: true; promo: SignupPromo } | { ok: false; error: string }> {
  const code = String(rawCode ?? "").trim();
  if (!code) return { ok: false, error: "Enter a code first." };

  // A code is a promo or a referral; the visitor does not have to know which.
  const promo = await validateAttribution("promo", code);
  const ref = promo ? null : await validateAttribution("ref", code);
  const hit = promo ?? ref;
  if (!hit) return { ok: false, error: "That code is not valid." };

  // NOTHING IS STAMPED HERE. There is no organization yet (the account is
  // created after checkout), so the validated code travels with the pending
  // signup and `completePendingSignup` binds it to the org it creates — the
  // same `bindAttributionToOrg` every other path uses.
  return {
    ok: true,
    promo: {
      code: hit.code,
      displayName: hit.displayName,
      // A referral is worth REFERRAL_DISCOUNT_PCT to the shop typing it (the
      // referrer's 50% credit is separate, lib/referralRewards); checkout
      // applies the same number as a coupon, so the price the step shows is
      // the price Stripe charges.
      percentOff: hit.kind === "promo" ? hit.percentOff : REFERRAL_DISCOUNT_PCT,
      discountMonths: hit.kind === "promo" ? hit.discountMonths : null,
      kind: hit.kind,
    },
  };
}

/** The register page's read of a parked Google identity (`?gsu=`). */
export async function googleSignupIdentity(
  handle: string,
): Promise<{ email: string; name: string | null } | null> {
  const { readGoogleSignup } = await import("@/lib/googleSignup");
  const g = await readGoogleSignup(String(handle ?? ""));
  return g ? { email: g.email, name: g.name } : null;
}
