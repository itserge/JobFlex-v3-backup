// SUBCONTRACTORS — /dashboard/subcontractors (2026-11-08, the subcontractors plan, part 1). The company's directory
// of subs across every project, with each one's history and paper. The blueprint shell mounts the chrome; this page
// renders the directory. The handheld twin is /mobile-subcontractors-v1.

import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { isOwnerOrManager, requireOrg, NoOrgError, UnauthorizedError } from "@/lib/orgContext";
import { directoryOf } from "@/lib/projectSubs/server";
import { SubcontractorsPage } from "@/components/v3/subs-company/subcontractors-page";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "JobFlex · Subcontractors",
  description: "The company's subcontractors: who they are, their paper, what they have done with you.",
};

export default async function SubcontractorsRoute() {
  let organizationId: string;
  let role: string;
  try {
    const ctx = await requireOrg();
    organizationId = ctx.organizationId;
    role = ctx.role;
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login?next=%2Fdashboard%2Fsubcontractors");
    if (err instanceof NoOrgError) redirect("/dashboard?error=forbidden");
    throw err;
  }
  const read = await directoryOf(organizationId);
  return <SubcontractorsPage today={read.today} rows={read.contractors} canManage={isOwnerOrManager(role)} />;
}
