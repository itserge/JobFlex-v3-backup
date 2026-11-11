// Blueprint estimator — upload the plans, ask for the job, get it measured and priced
// (components/v3/blueprint-estimator). Smart Proposal's plan set as its own tool
// (owner, 2026-10-13), behind the same gate as Smart Proposal: the same custom-plan page,
// the same estimator entitlement, checked again by every action it calls.
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { requireOrg, NoOrgError, UnauthorizedError } from "@/lib/orgContext";
import { customPageGate } from "@/components/v3/upgrade-gate/custom-page-gate";
import { BlueprintEstimator } from "@/components/v3/blueprint-estimator/blueprint-estimator";

export const dynamic = "force-dynamic";
// A server action runs under the segment config of the page that calls it: pricing a
// trade can take minutes (a reasoning model, a re-ask after the validation pass).
export const maxDuration = 300;

export const metadata: Metadata = {
  title: "JobFlex · Blueprint estimator",
  description: "Upload the plans, ask for the job — countertops, drywall, the whole house — and get it measured off the sheets and priced.",
};

export default async function BlueprintEstimatorPage() {
  // Its own page on the new plans (the Blueprint estimator tool); Smart Proposal's on a Classic plan (lib/customPlan).
  const gate = await customPageGate("blueprint-estimator");
  if (gate) return gate;
  try {
    await requireOrg();
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login?next=%2Fdashboard%2Fblueprint-estimator");
    if (err instanceof NoOrgError) redirect("/dashboard?error=forbidden");
    throw err;
  }
  return <BlueprintEstimator />;
}
