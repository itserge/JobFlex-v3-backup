// /pricing — the landing's design, the catalog's numbers.
//
// The page body lives in components/v3/pricing-d so the route stays a thin data
// read. Plans come from the same catalog every other plan surface reads; the
// trial comes from the visitor's assigned signup offer.

import { signupTrialOffer } from "@/lib/trialOfferServer";
import { TrialOfferProvider } from "@/components/providers/trial-offer";
import type { Metadata } from "next";
import { getPlanCatalog } from "@/lib/planCatalogServer";
import { PricingPage } from "@/components/v3/pricing-d/pricing-page";
import { customPlanOffered } from "@/lib/customPlanFlag";
import { cookies } from "next/headers";
import { INDUSTRY_COOKIE, resolveLandingVariant } from "@/components/v3/landing-e/landing-variants";
import { SPOTLIGHT_COOKIE, SPOTLIGHT_VISIT_COOKIE, spotlightFor, spotlightNarrows } from "@/lib/planSpotlight";

// RENDERED PER REQUEST (owner, 2026-10-07). It used to be ISR (an hour), so
// the server-side flag it reads — CUSTOM_PLAN_ENABLED (lib/customPlanFlag) —
// was baked into the prerender at build time and showed whatever the
// environment said THEN until the page regenerated. The landing, which shows the same plans and flags, has always
// been dynamic; this page now matches it.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Pricing — JobFlex",
  description:
    "Plans for small-shop contractors, or build your own from the pages you actually open. Unlimited clients and the client portal on every plan.",
};

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const plans = await getPlanCatalog();
  // The tool the visitor came for (lib/planSpotlight): the link's `?tool=` or
  // `?industry=`, else the landing's 30-day memory of either.
  const sp = await searchParams;
  const jar = await cookies();
  // The link wins over the memory: a fencing link marks the fence estimator
  // even for a visitor who clicked an AI desk ad last week.
  const spotlightUrl = spotlightFor({ tool: sp.tool, industry: resolveLandingVariant(sp.industry ?? sp.trade) });
  const spotlight =
    spotlightUrl ?? spotlightFor({ tool: jar.get(SPOTLIGHT_COOKIE)?.value, industry: resolveLandingVariant(jar.get(INDUSTRY_COOKIE)?.value) });
  // The other trade estimators hide only during the ad visit: this URL, or the visit's session cookie (owner, 2026-11-07).
  const narrow = spotlightNarrows(spotlight, spotlightUrl, jar.get(SPOTLIGHT_VISIT_COOKIE)?.value);
  return (
    <TrialOfferProvider offer={await signupTrialOffer()}>
    <PricingPage
      plans={plans}
      spotlight={spotlight}
      narrow={narrow}
      spotlightUrl={spotlightUrl}
      customOffered={customPlanOffered()}
    />
    </TrialOfferProvider>
  );
}
