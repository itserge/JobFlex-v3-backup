// Main clients — Blueprint edition. Pixel-identical port of the canonical
// clients donor (jobflex-clients-blueprint_2.html).
//
// The sidebar, topbar and sprite come from the shared shell mounted in
// ../layout.tsx, so this page renders only the donor's `.content` children.
// The child route (/[id]) lives under the (dashboard) route group and keeps
// the classic layout.
//
// Like the Workers page and unlike the rest of the blueprint fleet, this one is
// NOT a fixture: the client book is read from the database here and the create
// / edit dialog calls the real client server actions (see clients-behavior.ts).
// The query is the archived classic page's — same joins, same ordering, same
// pipeline formula, same VIP-is-a-tag rule — so both editions describe the same
// book, and the ids in the rows are the ids proposals and jobs reference.

import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { requireOrg, isLimitedRole, NoOrgError, UnauthorizedError } from "@/lib/orgContext";
import { db } from "@/lib/db";
import { ClientsContent } from "@/components/v3/clients-blueprint/clients-content";
import type { Client } from "@/components/v3/clients-blueprint/clients-data";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "JobFlex · Clients",
  description: "Clients — masthead, tag filters and the full client book on one sheet.",
};

/** The Updated column is the fixture's short plate ("Jul 22"), not a full date. */
function updatedLabel(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "2-digit" });
}

export default async function ClientsPage() {
  let organizationId: string;
  let canImport = false;
  try {
    const ctx = await requireOrg();
    organizationId = ctx.organizationId;
    // Bringing a book over from another program (/dashboard/clients/import) is the owner's, an admin's or a manager's.
    canImport = !isLimitedRole(ctx.role);
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login?next=%2Fdashboard%2Fclients");
    if (err instanceof NoOrgError) redirect("/dashboard?error=forbidden");
    throw err;
  }

  const clients = await db.client.findMany({
    where: { organizationId, deletedAt: null },
    include: {
      proposals: { select: { total: true, status: true } },
      tags: { include: { tag: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  const entries: Client[] = clients.map((c) => ({
    id: c.id,
    name: c.name,
    email: c.email,
    address: [c.city, c.state].filter(Boolean).join(", ") || c.address || "",
    proposalCount: c.proposals.length,
    pipelineValue: c.proposals
      .filter((p) => !["DECLINED", "EXPIRED", "ARCHIVED"].includes(p.status))
      .reduce((a, p) => a + p.total, 0),
    // VIP is an org-scoped Tag, not a column (see createClient). It renders as
    // its own plate next to the name, so it is kept out of the Tags column.
    vip: c.tags.some((t) => t.tag.label === "VIP"),
    tags: c.tags
      .filter((t) => t.tag.label !== "VIP")
      .map((t) => ({ label: t.tag.label, color: t.tag.color })),
    updated: updatedLabel(c.updatedAt),
    phone: c.phone,
    line1: c.address,
    city: c.city,
    state: c.state,
    zip: c.zip,
    notes: c.notes,
  }));

  return <ClientsContent entries={entries} canImport={canImport} />;
}
