// QUOTES & PROPOSALS — /dashboard/quotes (2026-11-08, the subcontractors plan, part 1). Every subcontractor quote
// across the company's projects, finished ones included, with the versions and the documents. The blueprint shell
// mounts the chrome; this page renders the list. The handheld twin is /mobile-quotes-v1.

import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { requireOrg, NoOrgError, UnauthorizedError } from "@/lib/orgContext";
import { companyQuotes } from "@/lib/projectSubs/server";
import { QuotesPage } from "@/components/v3/subs-company/quotes-page";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "JobFlex · Quotes & Proposals",
  description: "Every subcontractor quote across your projects, with its versions and documents.",
};

export default async function QuotesRoute() {
  let organizationId: string;
  try {
    organizationId = (await requireOrg()).organizationId;
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login?next=%2Fdashboard%2Fquotes");
    if (err instanceof NoOrgError) redirect("/dashboard?error=forbidden");
    throw err;
  }
  const read = await companyQuotes(organizationId);
  return <QuotesPage rows={read.quotes} projectHref="/dashboard/projects/{id}/subs?tab=quotes" />;
}
