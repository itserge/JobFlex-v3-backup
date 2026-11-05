"use server";
import { z } from "zod";
import { requireSalesOrManager } from "@/lib/orgContext";
import { db } from "@/lib/db";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";

import { createClientAs, updateClientAs, type ClientInput, type ClientRecord } from "@/lib/clients/core";

// The cores live in lib/clients/core (2026-11-05): the AI Operator adds and changes clients through the same code.
export type { ClientInput, ClientRecord };

export async function createClient(raw: unknown): Promise<ClientRecord> {
  const { organizationId, user } = await requireSalesOrManager();
  return createClientAs({ organizationId, userId: user.id }, raw);
}

/**
 * Set a client's email and nothing else.
 *
 * The manual builder's "Save & send" needs an address on the RECORD — the
 * sheet's contact row is display state and never reaches the database, so a
 * send against a client with no stored email silently went nowhere and still
 * reported success. `updateClient` cannot serve this: it parses a COMPLETE
 * client input, and the builder only holds the street line of a client's
 * address (the loader splits it on "
"), so round-tripping the record through
 * it would truncate the rest. One column, one write.
 */
export async function setClientEmail(id: string, rawEmail: unknown) {
  const { organizationId, user } = await requireSalesOrManager();
  const email = z.string().trim().email("Enter a valid email address").parse(rawEmail);
  const existing = await db.client.findUnique({
    where: { id },
    select: { organizationId: true, deletedAt: true, name: true },
  });
  if (!existing || existing.organizationId !== organizationId || existing.deletedAt) {
    throw new Error("Client not found");
  }
  await db.client.update({ where: { id }, data: { email } });
  await logActivity({
    organizationId,
    actorId: user.id,
    kind: TRAIL_KINDS.CLIENT,
    summary: `Set ${existing.name}'s email to ${email}`,
    clientId: id,
    meta: { field: "email" },
  });
  return { email };
}

/**
 * The email and phone typed on a proposal's client card, onto the client record
 * (owner, 2026-10-13: an email typed on a roof proposal never reached the send).
 * A blank field leaves the record's value alone — the card never erases.
 */
export async function saveClientContact(id: string, raw: unknown) {
  const { organizationId, user } = await requireSalesOrManager();
  const input = z
    .object({
      email: z.string().trim().email("Enter a valid email address").optional(),
      phone: z.string().trim().max(40).optional(),
    })
    .parse(raw);
  const existing = await db.client.findUnique({
    where: { id },
    select: { organizationId: true, deletedAt: true, name: true, email: true, phone: true },
  });
  if (!existing || existing.organizationId !== organizationId || existing.deletedAt) {
    throw new Error("Client not found");
  }
  const data: { email?: string; phone?: string } = {};
  if (input.email && input.email.toLowerCase() !== (existing.email ?? "").trim().toLowerCase()) data.email = input.email;
  if (input.phone && input.phone !== (existing.phone ?? "").trim()) data.phone = input.phone;
  if (!data.email && !data.phone) return { email: existing.email, phone: existing.phone };
  await db.client.update({ where: { id }, data });
  await logActivity({
    organizationId,
    actorId: user.id,
    kind: TRAIL_KINDS.CLIENT,
    summary: `Set ${existing.name}'s ${[data.email ? `email to ${data.email}` : "", data.phone ? `phone to ${data.phone}` : ""].filter(Boolean).join(" and ")} (from a proposal)`,
    clientId: id,
    meta: { fields: Object.keys(data), from: "proposal" },
  });
  return { email: data.email ?? existing.email, phone: data.phone ?? existing.phone };
}

export async function updateClient(id: string, raw: unknown): Promise<ClientRecord> {
  const { organizationId, user } = await requireSalesOrManager();
  return updateClientAs({ organizationId, userId: user.id }, id, raw);
}
