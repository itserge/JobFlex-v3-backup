// MOBILE PROJECT DETAIL — /mobile-project-detail-v2/<id>
//
// The direct-review entry point for the handheld project-detail build: always
// the mobile design, at any width, so the page can be opened on a desktop
// browser for review without resizing. The live route
// /dashboard/projects/[id] serves the SAME component at ≤768px through
// src/components/v3/mobile-project-detail/project-detail-viewport-switch.tsx —
// one implementation, two entry points, nothing copied between them.
//
// THE QUERIES ARE THE LIVE PAGE'S, character for character — the same
// findUnique with the same job include and ordering, the same org check, and
// the same attachable-proposal list as src/app/dashboard/projects/[id]/page.tsx.
// They are restated rather than shared because a `db` call cannot live in the
// module the client component imports its shapes from. No Prisma change, no new
// server action and no new API route: `attachJob` still does every write.
//
// Auth: middleware only matches /dashboard and /admin, so this route enforces
// its own redirect-to-login like every other (mobile) design route.

import { notFound, redirect } from "next/navigation";
import { after } from "next/server";
import type { Metadata, Viewport } from "next";
import { isOwnerOrManager, requireOrg, NoOrgError, UnauthorizedError } from "@/lib/orgContext";
import { ROLE_ROUTE_GATES, isPathAllowed } from "@/lib/roleRoutes";
import { loadProjectDetail } from "@/components/v3/project-detail-blueprint/project-detail-load";
import { readSnoozes } from "@/lib/projectOverview/server";
import { writeSummary } from "@/lib/projectOverview/summary";
import { MobileProjectDetail } from "@/components/v3/mobile-project-detail/mobile-project-detail";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Project · JobFlex Mobile",
  description: "One project on a phone — its jobs as a list, a schedule and a timeline.",
};

// Handheld build: lock the scale so the layout is read at true device width,
// and pay out the notch / home-indicator insets the shell reserves.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#0a0a0a",
};

export default async function MobileProjectDetailV2Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

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
      redirect(`/auth/login?next=${encodeURIComponent(`/mobile-project-detail-v2/${id}`)}`);
    }
    if (err instanceof NoOrgError) redirect("/dashboard?error=forbidden");
    throw err;
  }

  // The person's "Not now" rows on the Overview, as on the desk's page (2026-11-09).
  const [props, snoozes] = await Promise.all([loadProjectDetail(id, organizationId), readSnoozes(organizationId, userId, id).catch(() => ({}))]);
  if (!props) notFound();
  if (props.overview.summaryFresh === false) after(() => writeSummary(organizationId, props.project.id, props.timeline.today, props.project.name, props.overview).then(() => undefined));

  // What this role may open from the page — an estimator runs projects but has no client record or job page
  // (lib/roleRoutes), so those read as plain text for them (2026-11-04).
  const gate = ROLE_ROUTE_GATES[role];
  const opens = (path: string) => !gate || isPathAllowed(gate, path);
  return <MobileProjectDetail {...props} snoozes={snoozes} canManage={isOwnerOrManager(role)} opens={{ client: opens("/dashboard/client-detail"), jobs: opens("/dashboard/jobs") }} />;
}
