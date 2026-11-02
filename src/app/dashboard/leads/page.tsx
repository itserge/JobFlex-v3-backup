// Main leads — Blueprint edition. Pixel-identical port of the canonical
// leads donor (jobflex-leads-blueprint_3.html).
//
// The sidebar, topbar and sprite come from the shared shell mounted in
// ../layout.tsx, so this page renders only the donor's `.content` children.
// Child routes (/[id], /kanban) live under the (dashboard) route group and
// keep the classic layout.
//
// This page is NOT a fixture: the pipeline and the live Lead Center offers are
// read from the database here, and every control on the sheet calls the real
// lead server actions (see leads-behavior.ts). The query is the archived
// classic page's — same sales-visibility slice, same ordering, same offer
// window — so both editions describe the same pipeline.

import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { requireOrg, isSalesRole, NoOrgError, UnauthorizedError } from "@/lib/orgContext";
import { db } from "@/lib/db";
import { relative } from "@/lib/format";
import { contactsLocked } from "@/lib/leadCenter/contacts";
import { MarkNavSeen } from "@/components/layout/MarkNavSeen";
import { LeadProfileNudge } from "@/components/dashboard/LeadProfileNudge";
import { LeadsContent } from "@/components/v3/leads-blueprint/leads-content";
import type { Lead, Offer } from "@/components/v3/leads-blueprint/leads-data";
import { customPageGate } from "@/components/v3/upgrade-gate/custom-page-gate";
import { smartBookChips } from "@/lib/smartbook/office";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "JobFlex · Leads",
  description: "Leads — pipeline tabs, the lead table, the stage board and the import bench on one sheet.",
};

/** The donor's "Bothell, WA" plate. Either half may be missing on a real row. */
function placeLabel(city: string | null, state: string | null): string {
  return [city, state].filter(Boolean).join(", ") || "—";
}

export default async function LeadsPage() {
  const gate = await customPageGate("leads");
  if (gate) return gate;
  let organizationId: string;
  let role: string;
  let userId: string;
  try {
    const ctx = await requireOrg();
    organizationId = ctx.organizationId;
    role = ctx.role;
    userId = ctx.user.id;
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login?next=%2Fdashboard%2Fleads");
    if (err instanceof NoOrgError) redirect("/dashboard?error=forbidden");
    throw err;
  }

  // Sales reps see leads assigned to them, claimed by them, or still NEW (so
  // they can claim from the shared pool). Managers see the whole pipeline.
  // Live Lead Center offers (24h window) surface alongside them in Incoming.
  const [leadRows, offerRows, chips] = await Promise.all([
    db.lead.findMany({
      where: {
        organizationId,
        ...(isSalesRole(role)
          ? { OR: [{ assignedToId: userId }, { claimedById: userId }, { status: "NEW" }] }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      include: { assignedTo: { select: { name: true, email: true } } },
    }),
    db.leadOffer.findMany({
      where: { organizationId, status: "OFFERED", expiresAt: { gt: new Date() } },
      orderBy: { expiresAt: "asc" },
      include: { platformLead: true },
    }),
    smartBookChips(organizationId).catch(() => new Map()),
  ]);

  const leads: Lead[] = leadRows.map((l) => ({
    id: l.id,
    name: l.name,
    // A legacy hand-routed lead keeps its homeowner's contacts until claimed.
    email: contactsLocked(l) ? null : l.email,
    phone: contactsLocked(l) ? null : l.phone,
    city: placeLabel(l.city, l.state),
    project: l.projectType ?? l.aiCategory ?? "General inquiry",
    spec: l.aiCategory,
    conf: l.aiConfidence ?? 0,
    status: l.status,
    source: l.source ?? "MANUAL",
    assignee: l.assignedTo?.name ?? l.assignedTo?.email ?? null,
    age: relative(l.createdAt),
    // The scope written for a contractor when the request carried one.
    desc: l.scope ?? l.description ?? "",
    smart: chips.get(l.id) ?? null,
  }));

  // `new Date()`, not `Date.now()`: the react-hooks purity rule flags the
  // latter even in an async server component, and the value is identical.
  const now = new Date().getTime();
  const offers: Offer[] = offerRows.map((o) => ({
    id: o.id,
    name: o.platformLead.name,
    // Contacts stay on the PlatformLead until the shop accepts (see Offer).
    city: placeLabel(o.platformLead.city, o.platformLead.state),
    project: o.platformLead.projectType ?? o.platformLead.detectedTrade ?? "General inquiry",
    spec: o.platformLead.detectedTrade ?? "General",
    conf: o.platformLead.aiConfidence ?? 0,
    attempt: o.attempt,
    // The donor's countdown is a whole-minute number; the offer window is the
    // remaining life of the LeadOffer row.
    mins: Math.max(0, Math.round((o.expiresAt.getTime() - now) / 60000)),
    age: relative(o.createdAt),
    desc: o.platformLead.scope ?? o.platformLead.description ?? "",
    priceCents: o.priceCents && o.priceCents > 0 ? o.priceCents : null,
  }));

  return (
    <>
      {/* Clears the leads nav badge (un-triaged leads + live offers) on open.
          Desktop edition only — the handheld build is stamped by the
          responsive shell (HANDHELD_SEEN). */}
      <MarkNavSeen surface="leads" />
      {/* Why the Incoming tab is empty, when it is empty for a fixable reason. */}
      <LeadProfileNudge />
      <LeadsContent leads={leads} offers={offers} />
    </>
  );
}
