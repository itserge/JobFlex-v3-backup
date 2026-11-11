// Hire & Work — /dashboard/hire. Blueprint edition, rebuilt from scratch on
// 2026-09-03 as a two-sided board: HIRE lists everyone on the network who has
// posted themselves for work (with their contact details and JobFlex reviews);
// WORK is where the caller writes and manages their own post.
//
// The sidebar, topbar and sprite come from the shared shell mounted in
// ../layout.tsx, so this page renders only the donor's `.content` children.
//
// Nothing here is a fixture: the board is `listOpenTradeJobs`, the caller's
// posts are `getMyTradeJobs`, and every write goes back through
// src/actions/tradeServices.ts. `?tab=work` opens on the Work side (the
// interest email links there).

import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { NoOrgError, UnauthorizedError } from "@/lib/orgContext";
import { getHireViewer, getMyHirePosts, listOpenTradeJobs } from "@/actions/tradeServices";
import { HireViewportSwitch } from "@/components/v3/hire-blueprint/hire-viewport-switch";
import { MarkNavSeen } from "@/components/layout/MarkNavSeen";
import { customPageGate } from "@/components/v3/upgrade-gate/custom-page-gate";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "JobFlex · Hire & Work",
  description: "Find a tradesperson on the network, or post yourself for hire.",
};

export default async function HirePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // The Hire board is a size's on the new plans (Professional and up); open on every Classic plan (lib/customPlan).
  const gate = await customPageGate("hire");
  if (gate) return gate;
  let seed: Awaited<ReturnType<typeof load>>;
  try {
    seed = await load();
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login?next=%2Fdashboard%2Fhire");
    if (err instanceof NoOrgError) redirect("/dashboard?error=forbidden");
    throw err;
  }
  const { tab } = await searchParams;

  return (
    <>
      <MarkNavSeen surface="hire" />
      {/* One URL, both designs: the desktop board above 768px, the handheld
          rebuild at or below it. The switch lives HERE rather than in the
          shell's props-less HANDHELD_SURFACES map because both editions need
          the three server reads above; the shell carries a matching
          PAGE_OWNED_STATIC entry so this route renders bare on a phone
          instead of inside BlueprintShell. */}
      <HireViewportSwitch
        posts={seed.posts}
        mine={seed.mine}
        viewer={seed.viewer}
        initialTab={tab === "work" ? "work" : "hire"}
      />
    </>
  );
}

async function load() {
  const [posts, mine, viewer] = await Promise.all([
    listOpenTradeJobs(),
    getMyHirePosts(),
    getHireViewer(),
  ]);
  return { posts, mine, viewer };
}
