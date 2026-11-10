// MOBILE SUBCONTRACTORS SECTION — /mobile-project-subs-v1/<id> (2026-11-08, the subcontractors plan, part 1). The
// handheld entry to a project's Subcontractors section: the same component and the same read as
// /dashboard/projects/[id]/subs, at any width, so the page can be opened on a desktop browser for review. The
// hub's cards are built for the phone already; this route only adds the handheld chrome's insets.
//
// Auth: middleware only matches /dashboard and /admin, so this route enforces its own redirect-to-login like every
// other (mobile) design route.

import { notFound, redirect } from "next/navigation";
import type { Metadata, Viewport } from "next";
import { isOwnerOrManager, requireOrg, NoOrgError, UnauthorizedError } from "@/lib/orgContext";
import { loadSubsSection } from "@/components/v3/subs-section/subs-section-load";
import { SubsSection } from "@/components/v3/subs-section/subs-section";
import { tabOf } from "@/components/v3/subs-section/subs-tabs";
import { customPageGate } from "@/components/v3/upgrade-gate/custom-page-gate";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Subcontractors · JobFlex Mobile",
  description: "A project's subcontractors on a phone.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#0a0a0a",
};

export default async function MobileProjectSubsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // A paid feature (owner, 2026-11-09): the Free plan sees the plan's card here, before anything is read.
  const planGate = await customPageGate("subcontractors", { handheld: true });
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
    if (err instanceof UnauthorizedError) redirect(`/auth/login?next=${encodeURIComponent(`/mobile-project-subs-v1/${id}`)}`);
    if (err instanceof NoOrgError) redirect("/dashboard?error=forbidden");
    throw err;
  }
  const read = await loadSubsSection(id, organizationId);
  if (!read) notFound();
  return (
    <main style={{ padding: "calc(12px + env(safe-area-inset-top, 0px)) 12px calc(24px + env(safe-area-inset-bottom, 0px))", background: "var(--paper, #f6f5f1)", minHeight: "100dvh" }}>
      <SubsSection read={read} canManage={isOwnerOrManager(role)} initialTab={tabOf(typeof tab === "string" ? tab : undefined)} signerName={signerName} initialContract={typeof contract === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(contract) ? contract : null} hrefs={{ project: `/mobile-project-detail-v2/${id}`, directory: "/mobile-subcontractors-v1", quotes: "/mobile-quotes-v1" }} />
    </main>
  );
}
