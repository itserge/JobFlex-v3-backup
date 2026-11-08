// MOBILE QUOTES & PROPOSALS — /mobile-quotes-v1 (2026-11-08, the subcontractors plan, part 1): the handheld entry to
// every subcontractor quote across the company's projects — the same component and read as /dashboard/quotes.
// Auth: this (mobile) route enforces its own redirect-to-login like every other.

import { redirect } from "next/navigation";
import type { Metadata, Viewport } from "next";
import { isOwnerOrManager, requireOrg, NoOrgError, UnauthorizedError } from "@/lib/orgContext";
import { companyQuotes } from "@/lib/projectSubs/server";
import { inboundReview } from "@/lib/subInbound/server";
import { QuotesPage } from "@/components/v3/subs-company/quotes-page";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Quotes · JobFlex Mobile",
  description: "Every subcontractor quote, on a phone.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 1, viewportFit: "cover", themeColor: "#0a0a0a" };

export default async function MobileQuotesPage() {
  let organizationId: string;
  let role: string;
  try {
    const ctx = await requireOrg();
    organizationId = ctx.organizationId;
    role = ctx.role;
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect(`/auth/login?next=${encodeURIComponent("/mobile-quotes-v1")}`);
    if (err instanceof NoOrgError) redirect("/dashboard?error=forbidden");
    throw err;
  }
  const [read, inbox] = await Promise.all([companyQuotes(organizationId), inboundReview(organizationId)]);
  return (
    <main style={{ padding: "calc(12px + env(safe-area-inset-top, 0px)) 12px calc(24px + env(safe-area-inset-bottom, 0px))", background: "var(--paper, #f6f5f1)", minHeight: "100dvh" }}>
      <QuotesPage rows={read.quotes} inbox={inbox} canManage={isOwnerOrManager(role)} projectHref="/mobile-project-subs-v1/{id}?tab=quotes" />
    </main>
  );
}
