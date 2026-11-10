// Main proposals — Blueprint edition. Pixel-identical port of the canonical
// proposals donor (jobflex-proposals-blueprint.html).
//
// The sidebar, topbar and sprite come from the shared shell mounted in
// ../layout.tsx, so this page renders only the donor's `.content` children.
// Child routes (/new, /create, /[id], /ai, /templates) live under the
// (dashboard) route group and keep the classic layout.
//
// This page is NOT a fixture. The proposal book is read from the database by
// readProposalBook() — the ONE query both this sheet and the handheld rebuild
// render from — and the row menu calls the real proposal server actions (see
// proposals-behavior.ts). Scoping, includes and ordering all live in that
// module; see its header for why the list is requireProposalStaff-scoped.

import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { NoOrgError, UnauthorizedError, isLimitedRole, requireOrg } from "@/lib/orgContext";
import { MarkNavSeen } from "@/components/layout/MarkNavSeen";
import { ProposalsContent } from "@/components/v3/proposals-blueprint/proposals-content";
import { readProposalBook } from "@/components/v3/proposals-blueprint/proposals-query";
import type { ProposalRow } from "@/components/v3/proposals-blueprint/proposals-data";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "JobFlex · Proposals",
  description: "Proposals — masthead, pipeline tabs and the full proposal book on one sheet.",
};

export default async function ProposalsPage() {
  let rows: ProposalRow[];
  // The office books repairs off a sold proposal (2026-11-09); sales and estimators don't see the button.
  let office = false;
  try {
    rows = await readProposalBook();
    office = !isLimitedRole((await requireOrg()).role);
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login?next=%2Fdashboard%2Fproposals");
    if (err instanceof NoOrgError) redirect("/dashboard?error=forbidden");
    throw err;
  }

  return (
    <>
      {/* Clears the proposals nav badge (accepted-but-unscheduled work) on
          open. Desktop edition only — the handheld build is stamped by the
          responsive shell (HANDHELD_SEEN). */}
      <MarkNavSeen surface="proposals" />
      <ProposalsContent rows={rows} office={office} />
    </>
  );
}
