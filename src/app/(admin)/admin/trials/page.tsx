// TRIAL WATCH — /admin/trials (2026-09-24). Owner: "can we track and check if
// people on a free trial are trying to copy our features by doing
// screenshots?" The accounts that behave like a tour rather than a company,
// scored by lib/trialWatch off their page views, their records, their email
// domains and shared devices; read by actions/trialWatch.
import type { Metadata } from "next";
import { requirePlatformAdmin } from "@/lib/orgContext";
import { getTrialPayments, getTrialWatch } from "@/actions/trialWatch";
import { readSignupFlow, readSignupPlan, readSignupView, signupTrialState } from "@/lib/trialPolicyServer";
import { AdminTrialsContent } from "@/components/v3/admin-trials/admin-trials-content";
import { readPricingModel, TOOLS_PLANS_PARTS, TOOLS_PLANS_READY } from "@/lib/toolPlans/server";
import { recentCardHolds } from "@/lib/signupCardHold";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "JobFlex Admin · Trial watch" };

export default async function AdminTrialsPage() {
  await requirePlatformAdmin();
  const [data, policy, signup, plan, view, pricing, cardHolds] = await Promise.all([getTrialWatch(), signupTrialState({ fresh: true }), readSignupFlow({ fresh: true }), readSignupPlan({ fresh: true }), readSignupView({ fresh: true }), readPricingModel({ fresh: true }), recentCardHolds()]);
  // Not awaited: the table renders from the database and each row's card
  // streams in when Stripe answers (one list call — actions/trialWatch).
  const payments = getTrialPayments(data.rows.map((r) => r.id));
  return <AdminTrialsContent data={data} policy={policy} signup={signup} plan={plan} view={view} pricing={pricing} pricingReady={TOOLS_PLANS_READY} pricingParts={TOOLS_PLANS_PARTS} payments={payments} cardHolds={cardHolds} />;
}
