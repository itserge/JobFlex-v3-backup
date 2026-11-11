// THE CLIENT BEHIND A LEAD (2026-09-22) — server only.
//
// Owner: "in the lead's estimator, pre-fill the client info — name, phone,
// email, address — if there is one." A proposal carries its client as a
// Client record, so the hand-off from a lead finds the record the lead
// already is (same email, case aside, or the same phone) or makes one from
// the lead, and the estimate files under it (lib/filingContext). Found
// records get their blanks filled from the lead, never overwritten.
//
// Making a record is a sales-or-manager act elsewhere (actions/clients), so
// the caller says whether this role may create; an estimator matches only.
// The plan's client cap is honoured: at the cap, no record, no filing, and
// the estimate still opens.

import { db } from "@/lib/db";
import { enforcePlanLimit } from "@/lib/limitsEngine";

export type LeadForClient = {
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
};

export type LeadClient = { id: string; name: string; made: boolean };

// A phone's digits as one number reads them: "+1 425 555 0112" (a Facebook or Twilio lead) and "(425) 555-0112" (a
// client typed by hand) are the same person — before 2026-11-10 the leading 1 kept them apart and no client matched.
const digits = (s: string | null | undefined) => {
  const d = (s ?? "").replace(/\D+/g, "");
  return d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
};
const clean = (s: string | null | undefined) => {
  const t = (s ?? "").trim();
  return t ? t : null;
};

/** The live client of the organization the lead already is, by email (case aside) or phone; null when none. */
export async function findClientForLead(organizationId: string, lead: Pick<LeadForClient, "email" | "phone">): Promise<{ id: string; name: string; email: string | null; phone: string | null; address: string | null; city: string | null; state: string | null; zip: string | null } | null> {
  const email = (lead.email ?? "").trim().toLowerCase();
  const phone = digits(lead.phone);
  if (!email && phone.length < 7) return null;
  const select = { id: true, name: true, email: true, phone: true, address: true, city: true, state: true, zip: true };
  if (email) {
    // SQLite has no case-insensitive equals through Prisma; the org's clients
    // that carry an email are few enough to compare here.
    const withEmail = await db.client.findMany({ where: { organizationId, deletedAt: null, email: { not: null } }, select, take: 5000 });
    const hit = withEmail.find((c) => (c.email ?? "").trim().toLowerCase() === email);
    if (hit) return hit;
  }
  if (phone.length >= 7) {
    const withPhone = await db.client.findMany({ where: { organizationId, deletedAt: null, phone: { not: null } }, select, take: 5000 });
    const hit = withPhone.find((c) => digits(c.phone) === phone);
    if (hit) return hit;
  }
  return null;
}

type FoundClient = NonNullable<Awaited<ReturnType<typeof findClientForLead>>>;

/**
 * A found client's blanks filled from the lead — never a field it already has. The street comes with its city, state
 * and ZIP, and only onto a record with no street (a half-written address is not finished with another one's parts).
 * Returns the fields written.
 */
export async function fillClientBlanks(found: FoundClient, lead: Omit<LeadForClient, "name">): Promise<Array<"email" | "phone" | "address" | "city" | "state" | "zip">> {
  const fill: Partial<Record<"email" | "phone" | "address" | "city" | "state" | "zip", string>> = {};
  if (!found.email && clean(lead.email)) fill.email = clean(lead.email)!;
  if (!found.phone && clean(lead.phone)) fill.phone = clean(lead.phone)!;
  if (!found.address && clean(lead.address)) {
    fill.address = clean(lead.address)!;
    if (!found.city && clean(lead.city)) fill.city = clean(lead.city)!;
    if (!found.state && clean(lead.state)) fill.state = clean(lead.state)!;
    if (!found.zip && clean(lead.zip)) fill.zip = clean(lead.zip)!;
  }
  const keys = Object.keys(fill) as Array<keyof typeof fill>;
  if (keys.length) await db.client.update({ where: { id: found.id }, data: fill });
  return keys;
}

/**
 * The client record for a lead: found, with its blanks filled from the lead,
 * or made from the lead when `create` allows and the plan has room.
 */
export async function ensureClientForLead(organizationId: string, lead: LeadForClient, opts: { create: boolean }): Promise<LeadClient | null> {
  const found = await findClientForLead(organizationId, lead);
  if (found) {
    await fillClientBlanks(found, lead);
    return { id: found.id, name: found.name, made: false };
  }
  if (!opts.create) return null;
  try {
    await enforcePlanLimit(organizationId, "clients");
  } catch {
    return null;
  }
  const created = await db.client.create({
    data: {
      organizationId,
      name: clean(lead.name) ?? "Homeowner",
      email: clean(lead.email),
      phone: clean(lead.phone),
      address: clean(lead.address),
      city: clean(lead.city),
      state: clean(lead.state),
      zip: clean(lead.zip),
    },
    select: { id: true, name: true },
  });
  return { ...created, made: true };
}
