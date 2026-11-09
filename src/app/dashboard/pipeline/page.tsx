// THE PIPELINE (Smart CRM part 3, 2026-11-08; route /dashboard/pipeline). Every deal from new lead to won or lost,
// moved by what actually happens and by hand; each card with its risk, reason and next step. `?view=sources` is the
// lead-source report. Top-level under /dashboard for the blueprint shell's page key (see client-detail).

import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { NoOrgError, UnauthorizedError, requireOrg } from "@/lib/orgContext";
import { loadPipeline } from "@/components/v3/pipeline-blueprint/pipeline-load";
import { PipelineViewportSwitch } from "@/components/v3/pipeline-blueprint/pipeline-viewport-switch";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "JobFlex · Pipeline",
  description: "Every deal from new lead to won — its risk, its reason and the next step.",
};

export default async function PipelinePage({ searchParams }: { searchParams: Promise<{ view?: string; mine?: string; days?: string }> }) {
  const q = await searchParams;
  let organizationId: string;
  let userId: string;
  let role: string;
  try {
    const ctx = await requireOrg();
    organizationId = ctx.organizationId;
    userId = ctx.user.id;
    role = ctx.role;
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login?next=%2Fdashboard%2Fpipeline");
    if (err instanceof NoOrgError) redirect("/dashboard?error=forbidden");
    throw err;
  }
  const view = await loadPipeline(organizationId, userId, role, q);
  return <PipelineViewportSwitch view={view} />;
}
