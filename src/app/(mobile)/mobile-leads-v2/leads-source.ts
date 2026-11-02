"use server";

// Mobile leads — the read side.
//
// The handheld build is mounted TWO ways: from its own route
// (/mobile-leads-v2/page.tsx) and, at ≤768px, from the viewport switch in
// components/v3/responsive-shell/responsive-dashboard-shell.tsx, which renders
// it with NO props. So the page cannot hand it server rows; it reads them
// itself, on mount, through this action.
//
// The query is the DESKTOP sheet's, verbatim (src/app/dashboard/leads/page.tsx)
// — same org scope, same sales-visibility slice, same ordering, same 24h offer
// window — so the two editions describe one pipeline. Writes go through the
// shared lead actions (@/actions/leads, @/actions/leadOffers); nothing is
// mutated here.

import { requireRouteAccess, isSalesRole } from "@/lib/orgContext";
import { db } from "@/lib/db";
import { relative } from "@/lib/format";
import { contactsLocked } from "@/lib/leadCenter/contacts";
import type { Lead, Offer } from "./leads-data";
import { requirePage } from "@/lib/customPageAccess";
import { smartBookChips } from "@/lib/smartbook/office";

/** "Bothell, WA". Either half may be missing on a real row. */
function placeLabel(city: string | null, state: string | null): string {
  return [city, state].filter(Boolean).join(", ") || "—";
}

export type MobileLeadsSnapshot = {
  leads: Lead[];
  offers: Offer[];
  /** The signed-in user, for the row sheet's "Assign to me" / "Already yours". */
  me: string;
};

export async function loadMobileLeads(): Promise<MobileLeadsSnapshot> {
  const { organizationId, role, user } = await requireRouteAccess("/dashboard/leads");
  await requirePage(organizationId, "leads");

  const [leadRows, offerRows, chips] = await Promise.all([
    db.lead.findMany({
      where: {
        organizationId,
        ...(isSalesRole(role)
          ? { OR: [{ assignedToId: user.id }, { claimedById: user.id }, { status: "NEW" }] }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      include: {
        assignedTo: { select: { name: true, email: true } },
        claimedBy: { select: { name: true, email: true } },
      },
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
    project: l.projectType ?? "General inquiry",
    spec: l.aiCategory,
    conf: l.aiConfidence ?? 0,
    status: l.status,
    source: l.source ?? "MANUAL",
    // Nothing in the app writes `assignedToId` today — a lead is taken with
    // claimLead, which stamps `claimedById`. Both are shown as the owner so the
    // row sheet's "Assign to me" has something true to report back.
    assignee:
      l.assignedTo?.name ??
      l.assignedTo?.email ??
      l.claimedBy?.name ??
      l.claimedBy?.email ??
      null,
    mine: l.assignedToId === user.id || l.claimedById === user.id,
    age: relative(l.createdAt),
    desc: l.scope ?? l.description ?? "",
    smart: chips.get(l.id) ?? null,
  }));

  const now = Date.now();
  const offers: Offer[] = offerRows.map((o) => ({
    id: o.id,
    name: o.platformLead.name,
    // Contacts stay on the PlatformLead until the shop accepts (see Offer).
    city: placeLabel(o.platformLead.city, o.platformLead.state),
    project: o.platformLead.projectType ?? "General inquiry",
    spec: o.platformLead.detectedTrade ?? "General",
    conf: o.platformLead.aiConfidence ?? 0,
    attempt: o.attempt,
    // Whole minutes left in the offer window — the countdown chip's unit.
    mins: Math.max(0, Math.round((o.expiresAt.getTime() - now) / 60000)),
    age: relative(o.createdAt),
    // The scope written for a contractor, as on the desk edition.
    desc: o.platformLead.scope ?? o.platformLead.description ?? "",
    priceCents: o.priceCents && o.priceCents > 0 ? o.priceCents : null,
  }));

  return { leads, offers, me: user.name || user.email || "You" };
}
