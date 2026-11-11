// Main dashboard — Blueprint edition. Pixel-identical port of the canonical
// donor (.claude/skills/jobflex-page-styler/assets/jobflex-dashboard-blueprint.html).
//
// The sidebar, topbar and sprite come from the shared shell mounted in
// ./layout.tsx, so this page renders only the donor's `.content` children —
// navigating between blueprint pages swaps the content and leaves the chrome
// standing.
//
// This page is NOT a fixture. Every region on the sheet — the KPI strip, the
// revenue chart's three ranges, Recent Activity, This Week, Upcoming Jobs and
// the Lead Flow board — is read from the database by `buildDashboardData` and
// handed to the behavior module, and the board's drag persists through
// `updateLeadStatus`. That read lives in ./dashboard-data.ts rather than here
// because the handheld edition needs the same rows and is mounted props-less
// by the responsive shell; see ./dashboard-actions.ts.

import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { NoOrgError, UnauthorizedError } from "@/lib/orgContext";
import { DashboardContent } from "@/components/v3/dashboard-blueprint/dashboard-content";
import { NoOrgNotice } from "@/components/v3/dashboard-blueprint/no-org-notice";
import type { DashboardData } from "@/components/v3/dashboard-blueprint/blueprint-data";
import { buildDashboardData } from "./dashboard-data";
import { toolsWelcomeDue } from "@/lib/toolPlans/view";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "JobFlex · Overview",
  description:
    "The JobFlex operations overview — proposals, revenue, schedule and lead flow on one sheet.",
};

// `searchParams` is optional: /dashboard/beige renders this page bare.
export default async function DashboardPage({ searchParams }: { searchParams?: Promise<{ tour?: string | string[] }> }) {
  // A new-plan shop's owner, the first time here: the welcome page first (Base + Tools, part 3b). It stamps itself
  // shown, so this sends nobody twice; a Classic shop is answered without a query (lib/toolPlans/view).
  if (await toolsWelcomeDue()) redirect("/dashboard/welcome");
  let data: DashboardData;
  try {
    data = await buildDashboardData({ showTour: (await searchParams)?.tour === "show" });
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login?next=%2Fdashboard");
    // NOT a redirect. This page is where every other blueprint page sends a
    // NoOrgError, and it used to send that error to ITSELF
    // ("/dashboard?error=forbidden"), which threw the same error again: an
    // endless redirect that painted the shell and never the page. It answers in
    // place now.
    if (err instanceof NoOrgError) {
      const session = await auth();
      return <NoOrgNotice email={session?.user?.email} />;
    }
    throw err;
  }

  // The Lead Center nag is NOT mounted here: both Overview editions draw their
  // own, in their own design system, from data.leadProfile (see
  // dashboard-content.tsx and mobile-v2). What it takes to RAISE it is fixed in
  // ./dashboard-data.ts instead, so one rule feeds both.
  return <DashboardContent data={data} />;
}
