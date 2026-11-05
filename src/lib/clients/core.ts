import "server-only";
// CLIENTS WITHOUT A SESSION (2026-11-05, the AI Operator's batch 1): the create
// and update the Clients page runs (actions/clients), as plain functions of who
// is acting, so a client can be added or changed by voice or text — and the
// server actions stay thin wrappers over the same code. `patchClientAs` is the
// Operator's own need: "change Sarah's phone to …" touches one column and
// leaves the rest alone, where the page's form always writes every column.
import { z } from "zod";
import { db } from "@/lib/db";
import { enforcePlanLimit } from "@/lib/limitsEngine";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";

// Tight client shape returned to the v3 builder. Matches the columns the
// inline create/edit form writes; ignore notes/customFields/tags for now.
export type ClientRecord = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
};

export const CLIENT_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  address: true,
  city: true,
  state: true,
  zip: true,
} as const;

// Empty strings come back from form inputs; normalise to null so we don't
// store "" alongside real values.
const trimOrNull = z
  .string()
  .optional()
  .transform((v) => {
    const t = (v ?? "").trim();
    return t.length === 0 ? null : t;
  });

// Notes is the one column that must survive a form that does not carry it.
// Every other field is written by every caller, so `undefined -> null` is a
// correct erase; notes is edited from the client record only, and the inline
// builder sheet never sends it. Returning `undefined` for an absent key makes
// Prisma SKIP the column instead of blanking what somebody typed elsewhere.
const notesInput = z
  .string()
  .optional()
  .transform((v) => (v === undefined ? undefined : v.trim() || null));

export const clientInput = z.object({
  name: z.string().min(1, "Name is required").max(120),
  email: trimOrNull,
  phone: trimOrNull,
  address: trimOrNull,
  city: trimOrNull,
  state: trimOrNull,
  zip: trimOrNull,
  notes: notesInput,
});

export type ClientInput = z.infer<typeof clientInput>;

// VIP isn't a Client column — it's modeled as an org-scoped "VIP" Tag. Kept out
// of `clientInput` so it can never be spread into db.client.create.
export const createClientInput = clientInput.extend({ vip: z.boolean().optional() });

/** A patch: only the keys given are written; a null erases that one column. */
const clientPatch = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  email: z.string().trim().max(200).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  address: z.string().trim().max(200).nullable().optional(),
  city: z.string().trim().max(80).nullable().optional(),
  state: z.string().trim().max(40).nullable().optional(),
  zip: z.string().trim().max(20).nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
});
export type ClientPatch = z.infer<typeof clientPatch>;

export interface ClientActor {
  organizationId: string;
  userId: string;
}

export async function createClientAs(ctx: ClientActor, raw: unknown): Promise<ClientRecord> {
  const { organizationId } = ctx;
  const { vip, ...data } = createClientInput.parse(raw);
  // Plan cap on live client records (absolute scope) — throws PLAN_LIMIT_MESSAGE
  // like every other gated create so the builder raises its limit dialog.
  await enforcePlanLimit(organizationId, "clients", 1, { actorId: ctx.userId });
  const created = await db.client.create({
    data: { organizationId, ...data },
    select: CLIENT_SELECT,
  });
  if (vip) {
    // Upsert the org's VIP tag (unique on [organizationId, label]), then link it.
    const tag = await db.tag.upsert({
      where: { organizationId_label: { organizationId, label: "VIP" } },
      update: {},
      create: { organizationId, label: "VIP", color: "#1f7a52" },
    });
    await db.clientTag.create({ data: { clientId: created.id, tagId: tag.id } });
  }
  await logActivity({
    organizationId,
    actorId: ctx.userId,
    kind: TRAIL_KINDS.CLIENT,
    summary: `Added client ${created.name}${created.address ? ` at ${created.address}` : ""}${vip ? " (VIP)" : ""}`,
    clientId: created.id,
    meta: { vip: !!vip },
  });
  return created;
}

async function ownClient(organizationId: string, id: string) {
  const existing = await db.client.findUnique({
    where: { id },
    select: { organizationId: true, deletedAt: true, name: true },
  });
  if (!existing || existing.organizationId !== organizationId || existing.deletedAt) throw new Error("Client not found");
  return existing;
}

export async function updateClientAs(ctx: ClientActor, id: string, raw: unknown): Promise<ClientRecord> {
  const { organizationId } = ctx;
  const existing = await ownClient(organizationId, id);
  const data = clientInput.parse(raw);
  const updated = await db.client.update({
    where: { id },
    data,
    select: CLIENT_SELECT,
  });
  await logActivity({
    organizationId,
    actorId: ctx.userId,
    kind: TRAIL_KINDS.CLIENT,
    summary: existing.name !== updated.name ? `Updated client ${existing.name} (now ${updated.name})` : `Updated client ${updated.name}`,
    clientId: id,
  });
  return updated;
}

/** A few fields changed, the rest untouched. Returns the record as it now is. */
export async function patchClientAs(ctx: ClientActor, id: string, raw: unknown): Promise<ClientRecord> {
  const { organizationId } = ctx;
  const existing = await ownClient(organizationId, id);
  const patch = clientPatch.parse(raw);
  const data = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined).map(([k, v]) => [k, typeof v === "string" && v.length === 0 ? null : v]));
  if (!Object.keys(data).length) {
    const same = await db.client.findUnique({ where: { id }, select: CLIENT_SELECT });
    if (!same) throw new Error("Client not found");
    return same;
  }
  const updated = await db.client.update({ where: { id }, data, select: CLIENT_SELECT });
  const fields = Object.keys(data).join(", ");
  await logActivity({
    organizationId,
    actorId: ctx.userId,
    kind: TRAIL_KINDS.CLIENT,
    summary: existing.name !== updated.name ? `Updated client ${existing.name} (now ${updated.name}): ${fields}` : `Updated client ${updated.name}: ${fields}`,
    clientId: id,
    meta: { fields: Object.keys(data) },
  });
  return updated;
}
