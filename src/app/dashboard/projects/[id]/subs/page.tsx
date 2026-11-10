// THE SUBCONTRACTORS SECTION — /dashboard/projects/[id]/subs (2026-11-08, the subcontractors plan, part 1). A
// project's own page for its subs: the figures, the directory, the requests, the quotes with their versions and
// documents, the history — reached from the project page's Subcontractors card. The blueprint shell (../../../
// layout.tsx) mounts the sidebar and topbar; this page renders the section. `?tab=quotes` opens on a tab (the bell's
// link does). The handheld twin is /mobile-project-subs-v1/[id].

import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { isOwnerOrManager, requireOrg, NoOrgError, UnauthorizedError } from "@/lib/orgContext";
import { loadSubsSection } from "@/components/v3/subs-section/subs-section-load";
import { SubsSection } from "@/components/v3/subs-section/subs-section";
import { tabOf } from "@/components/v3/subs-section/subs-tabs";
import { customPageGate } from "@/components/v3/upgrade-gate/custom-page-gate";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "JobFlex · Subcontractors",
  description: "A project's subcontractors: requests, quotes, documents, history.",
};

export default async function ProjectSubsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // A paid feature (owner, 2026-11-09): the Free plan sees the plan's card here, before anything is read.
  const planGate = await customPageGate("subcontractors");
  if (planGate) return planGate;
  const { id } = await params;
  const { tab, contract } = await searchParams;
  let organizationId: string;
  let role: string;
  let signerName = "";
  try {
    const ctx = await requireOrg();
    organizationId = ctx.organizationId;
    role = ctx.role;
    signerName = ctx.user.name?.trim() ?? "";
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect(`/auth/login?next=${encodeURIComponent(`/dashboard/projects/${id}/subs`)}`);
    if (err instanceof NoOrgError) redirect("/dashboard?error=forbidden");
    throw err;
  }
  const read = await loadSubsSection(id, organizationId);
  if (!read) notFound();
  return <SubsSection read={read} canManage={isOwnerOrManager(role)} initialTab={tabOf(typeof tab === "string" ? tab : undefined)} signerName={signerName} initialContract={typeof contract === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(contract) ? contract : null} hrefs={{ project: `/dashboard/projects/${id}`, directory: "/dashboard/subcontractors", quotes: "/dashboard/quotes" }} />;
}
