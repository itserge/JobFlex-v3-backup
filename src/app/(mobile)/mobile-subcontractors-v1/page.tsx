// MOBILE SUBCONTRACTORS — /mobile-subcontractors-v1 (2026-11-08, the subcontractors plan, part 1): the handheld
// entry to the company's directory — the same component and read as /dashboard/subcontractors, at any width.
// Auth: this (mobile) route enforces its own redirect-to-login like every other.

import { redirect } from "next/navigation";
import type { Metadata, Viewport } from "next";
import { isOwnerOrManager, requireOrg, NoOrgError, UnauthorizedError } from "@/lib/orgContext";
import { directoryOf } from "@/lib/projectSubs/server";
import { networkSettings } from "@/lib/subFinder/server";
import { SubcontractorsPage } from "@/components/v3/subs-company/subcontractors-page";
import { customPageGate } from "@/components/v3/upgrade-gate/custom-page-gate";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Subcontractors · JobFlex Mobile",
  description: "The company's subcontractors on a phone.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 1, viewportFit: "cover", themeColor: "#0a0a0a" };

export default async function MobileSubcontractorsPage() {
  // A paid feature (owner, 2026-11-09): the Free plan sees the plan's card here, before anything is read.
  const planGate = await customPageGate("subcontractors", { handheld: true });
  if (planGate) return planGate;
  let organizationId: string;
  let role: string;
  try {
    const ctx = await requireOrg();
    organizationId = ctx.organizationId;
    role = ctx.role;
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect(`/auth/login?next=${encodeURIComponent("/mobile-subcontractors-v1")}`);
    if (err instanceof NoOrgError) redirect("/dashboard?error=forbidden");
    throw err;
  }
  const [read, network] = await Promise.all([directoryOf(organizationId), networkSettings(organizationId)]);
  return (
    <main style={{ padding: "calc(12px + env(safe-area-inset-top, 0px)) 12px calc(24px + env(safe-area-inset-bottom, 0px))", background: "var(--paper, #f6f5f1)", minHeight: "100dvh" }}>
      <SubcontractorsPage today={read.today} rows={read.contractors} canManage={isOwnerOrManager(role)} network={network} />
    </main>
  );
}
