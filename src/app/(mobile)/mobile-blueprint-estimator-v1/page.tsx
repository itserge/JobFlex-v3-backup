// MOBILE BLUEPRINT ESTIMATOR — /mobile-blueprint-estimator-v1 (2026-10-20)
//
// The handheld build of /dashboard/blueprint-estimator, always the phone design at any width so it can be reviewed
// on a desk browser. The desktop route is untouched and does not send anyone here. The same gate as the desktop
// page: Smart Proposal's custom-plan page (drawn as the handheld offer), signed in and in an org; every action the
// estimator calls checks its entitlement again.
import { redirect } from "next/navigation";
import type { Metadata, Viewport } from "next";
import { requireOrg, NoOrgError, UnauthorizedError } from "@/lib/orgContext";
import { customPageGate } from "@/components/v3/upgrade-gate/custom-page-gate";
import { MobileBlueprintEstimator } from "@/components/v3/mobile-blueprint-estimator/mobile-blueprint-estimator";

export const dynamic = "force-dynamic";
// A server action runs under the segment config of the page that calls it: pricing a
// trade can take minutes (a reasoning model, a re-ask after the validation pass).
export const maxDuration = 300;

export const metadata: Metadata = {
  title: "Blueprint estimator · JobFlex Mobile",
  description: "Upload the plans, ask for the job — countertops, drywall, the whole house — and get it measured off the sheets and priced.",
};

// Handheld build: lock the scale so the layout is read at true device width, and pay out the notch insets.
export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 1, viewportFit: "cover", themeColor: "#0a0a0a" };

export default async function MobileBlueprintEstimatorPage() {
  // Its own page on the new plans (the Blueprint estimator tool); Smart Proposal's on a Classic plan (lib/customPlan).
  const gate = await customPageGate("blueprint-estimator", { handheld: true });
  if (gate) return gate;
  try {
    await requireOrg();
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect(`/auth/login?next=${encodeURIComponent("/mobile-blueprint-estimator-v1")}`);
    if (err instanceof NoOrgError) redirect("/dashboard?error=forbidden");
    throw err;
  }
  return <MobileBlueprintEstimator />;
}
