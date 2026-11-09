// Project detail — Blueprint edition. Pixel-identical port of the project
// detail donor (jobflex-projectdetail-blueprint (14).html).
//
// This REPLACES the classic record page that lived at
// src/app/(dashboard)/dashboard/projects/[id]/ — same URL, no parallel
// "-blueprint" route beside it. Moving the folder into src/app/dashboard/ is
// what puts it on the blueprint shell: ../../layout.tsx mounts the sidebar,
// topbar, sprite and `.content` wrapper once, and the page renders only the
// donor's `.content` children. Its sibling /new still lives under the
// (dashboard) route group on the classic layout; a static segment outranks a
// dynamic one, so /dashboard/projects/new is unaffected.
//
// THE PROJECT QUERY IS THE CLASSIC PAGE'S, UNCHANGED — same findUnique with the
// same job include and ordering, the same org check. Only the markup and the
// styles are new, and `attachJob` — the server action the old drawer called —
// is still the one and only thing that writes.
//
// WHAT CHANGED (2026-08-15): the attach control attaches PROPOSALS, so the
// unassigned-JOB candidate list this page used to read is replaced by the
// attachable-PROPOSAL list below. No new action, no new route, no schema
// change: see the note above `PdAvailProposal` in project-detail-data.ts for
// why the link runs through the proposal's jobs and what that costs.

import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { isOwnerOrManager, requireOrg, NoOrgError, UnauthorizedError } from "@/lib/orgContext";
import { ROLE_ROUTE_GATES, isPathAllowed } from "@/lib/roleRoutes";
import { loadProjectDetail } from "@/components/v3/project-detail-blueprint/project-detail-load";
import { readSnoozes } from "@/lib/projectOverview/server";
// The page renders the VIEWPORT SWITCH rather than the desktop content
// directly: above 768px it is ProjectDetailContent, unchanged, and at or below
// it the handheld rebuild in src/components/v3/mobile-project-detail/. Exactly
// one of the two mounts. The switch lives here rather than in
// responsive-dashboard-shell.tsx because this route is dynamic (no literal
// pathname key can match it) and because the handheld build needs the props
// read below — see the header of project-detail-viewport-switch.tsx.
import { ProjectDetailViewportSwitch } from "@/components/v3/mobile-project-detail/project-detail-viewport-switch";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "JobFlex · Project",
  description: "One project — its jobs as a list, a schedule and a gantt.",
};

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // The blueprint layout deliberately swallows an auth failure so the PAGE can
  // decide; the classic tree let requireOrg throw into its own boundary.
  let organizationId: string;
  let role: string;
  let userId: string;
  try {
    const ctx = await requireOrg();
    organizationId = ctx.organizationId;
    role = ctx.role;
    userId = ctx.user.id;
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      redirect(`/auth/login?next=${encodeURIComponent(`/dashboard/projects/${id}`)}`);
    }
    if (err instanceof NoOrgError) redirect("/dashboard?error=forbidden");
    throw err;
  }

  const [props, snoozes] = await Promise.all([loadProjectDetail(id, organizationId), readSnoozes(organizationId, userId, id).catch(() => ({}))]);
  if (!props) notFound();

  // What this role may open from the page — an estimator runs projects but has no client record or job page
  // (lib/roleRoutes), so those read as plain text for them (2026-11-04).
  const gate = ROLE_ROUTE_GATES[role];
  const opens = (path: string) => !gate || isPathAllowed(gate, path);
  return <ProjectDetailViewportSwitch {...props} snoozes={snoozes} canManage={isOwnerOrManager(role)} opens={{ client: opens("/dashboard/client-detail"), jobs: opens("/dashboard/jobs") }} />;
}
