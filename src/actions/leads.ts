"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { storableSource } from "@/lib/leads/sources";
import {
  requireManager,
  requireSalesOrManager,
  isSalesRole,
  UnauthorizedError,
} from "@/lib/orgContext";
import { db } from "@/lib/db";
import { LeadStatus } from "@/lib/prismaEnums";
import { enforcePlanLimit } from "@/lib/limitsEngine";
import { requirePage } from "@/lib/customPageAccess";
import { callLead } from "@/lib/aiDesk/leadCalls";
import { salesCanTouchLead } from "@/lib/leads/salesAccess";
import { markLeadContacted } from "@/lib/leads/contacted";
import { editLeadAs } from "@/lib/leads/edit";
import { splitLeadAddress } from "@/lib/leads/details";

const statusSchema = z.enum([
  LeadStatus.NEW,
  LeadStatus.ROUTED,
  LeadStatus.CLAIMED,
  LeadStatus.CONTACTED,
  LeadStatus.QUOTED,
  LeadStatus.WON,
  LeadStatus.LOST,
  LeadStatus.ARCHIVED,
]);

/** The statuses that mean somebody at the company has spoken with the lead. */
const REACHED = new Set<string>([LeadStatus.CONTACTED, LeadStatus.QUOTED, LeadStatus.WON]);

export async function updateLeadStatus(id: string, next: string) {
  const { organizationId, user, role } = await requireSalesOrManager();
  const status = statusSchema.parse(next);
  const lead = await db.lead.findUnique({ where: { id } });
  if (!lead || lead.organizationId !== organizationId) throw new Error("Not found");
  if (isSalesRole(role) && !salesCanTouchLead(lead, user.id)) {
    throw new UnauthorizedError("You can only update your own leads");
  }
  if (lead.status === status) return { ok: true, unchanged: true };
  await db.lead.update({ where: { id }, data: { status } });
  // Moved on by hand to "contacted" (or straight to quoted / won): that is the first reply, so the clock stops here
  // — before 2026-11-10 only a booked visit or a desk call set the time, and a lead a person phoned and marked
  // contacted counted as "still waiting" in the speed-to-lead numbers for good. The time only, and never moved once
  // set (lib/leads/contacted).
  if (REACHED.has(status) && !lead.contactedAt) await markLeadContacted(organizationId, id).catch(() => {});
  await db.activityEvent.create({
    data: {
      organizationId,
      actorId: user.id,
      kind: "UPDATED",
      summary: `${lead.name} → ${status.toLowerCase()}`,
    },
  });
  revalidatePath("/dashboard/leads");
  revalidatePath("/dashboard/leads/kanban");
  return { ok: true };
}

// "Have the AI desk call" on the lead page (owner, 2026-10-31; lib/aiDesk/leadCalls): one call now, from the
// company's desk number, on the desk's own setup. An envelope, never a throw — production redacts thrown messages,
// and the reason the desk can't call (no number, the hours, they texted STOP…) is what the button must say.
export async function callLeadWithDesk(id: string): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  try {
    const { organizationId, user, role } = await requireSalesOrManager();
    await requirePage(organizationId, "leads");
    const lead = await db.lead.findUnique({ where: { id }, select: { organizationId: true, assignedToId: true, claimedById: true, status: true } });
    if (!lead || lead.organizationId !== organizationId) return { ok: false, message: "That lead isn't here any more." };
    if (isSalesRole(role) && !salesCanTouchLead(lead, user.id)) return { ok: false, message: "You can only have the desk call your own leads." };
    const r = await callLead(organizationId, id, { by: user.id, auto: false });
    if (!r.ok) return { ok: false, message: r.error };
    revalidatePath(`/dashboard/leads/${id}`);
    return { ok: true, message: "The AI desk is calling them now. How it went shows here and on the Phone page." };
  } catch (err) {
    if (err instanceof UnauthorizedError) return { ok: false, message: "Your role can't have the desk call leads." };
    console.warn("[leads] desk call failed:", err instanceof Error ? err.message : err);
    return { ok: false, message: "The desk couldn't call right now. Try again in a minute." };
  }
}

const leadDetailsInput = z.object({
  name: z.string().max(400),
  phone: z.string().max(400).nullable().optional(),
  email: z.string().max(400).nullable().optional(),
  address: z.string().max(400).nullable().optional(),
  city: z.string().max(400).nullable().optional(),
  state: z.string().max(400).nullable().optional(),
  zip: z.string().max(400).nullable().optional(),
  projectType: z.string().max(400).nullable().optional(),
});

/**
 * Edit on the lead page (owner, 2026-11-10: a Facebook lead often comes with a phone and nothing else — once the
 * office has the address and the rest, it is typed in here). The form sends every field; what differs from the
 * record changes, an emptied field is cleared, and the client record the lead already is gets its blanks filled
 * (lib/leads/edit). An envelope, never a throw — production redacts thrown messages, and the form must say why.
 */
export async function updateLeadDetails(
  id: string,
  raw: unknown,
): Promise<{ ok: true; message: string; changed: number } | { ok: false; message: string }> {
  try {
    const { organizationId, user, role } = await requireSalesOrManager();
    await requirePage(organizationId, "leads");
    const parsed = leadDetailsInput.safeParse(raw);
    if (!parsed.success) return { ok: false, message: "Those details couldn't be read. Check the fields and try again." };
    const lead = await db.lead.findUnique({ where: { id }, select: { organizationId: true, assignedToId: true, claimedById: true, status: true } });
    if (!lead || lead.organizationId !== organizationId) return { ok: false, message: "That lead isn't here any more." };
    if (isSalesRole(role) && !salesCanTouchLead(lead, user.id)) return { ok: false, message: "You can only edit your own leads." };
    const r = await editLeadAs({ organizationId, userId: user.id }, id, parsed.data);
    if (!r.ok) return { ok: false, message: r.error };
    if (!r.changed.length) return { ok: true, message: "Nothing changed.", changed: 0 };
    revalidatePath(`/dashboard/leads/${id}`);
    revalidatePath("/dashboard/leads");
    revalidatePath("/dashboard/leads/kanban");
    if (r.client) revalidatePath(`/dashboard/clients/${r.client.id}`);
    const also = r.client ? ` Also added to ${r.client.name}'s client record: ${andWords(r.client.filled)}.` : "";
    return { ok: true, message: `Saved.${also}`, changed: r.changed.length };
  } catch (err) {
    if (err instanceof UnauthorizedError) return { ok: false, message: "Your role can't edit leads." };
    if (err instanceof Error && /locked|not on your plan|custom page/i.test(err.message)) return { ok: false, message: "Leads aren't on your plan." };
    console.warn("[leads] edit failed:", err instanceof Error ? err.message : err);
    return { ok: false, message: "The lead couldn't be saved just now. Check your connection and try again." };
  }
}

const andWords = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

// Accept an incoming lead: mark CLAIMED and record who took it + when.
export async function claimLead(id: string) {
  const { organizationId, user, role } = await requireSalesOrManager();
  const lead = await db.lead.findUnique({ where: { id } });
  if (!lead || lead.organizationId !== organizationId) throw new Error("Not found");
  // A sales rep can claim from the shared pool or re-claim their own leads —
  // but not take over a lead another rep already claimed (managers can).
  if (isSalesRole(role) && !salesCanTouchLead(lead, user.id)) {
    throw new UnauthorizedError("That lead is already claimed by someone else");
  }
  await db.lead.update({
    where: { id },
    data: { status: "CLAIMED", claimedById: user.id, claimedAt: new Date() },
  });
  await db.activityEvent.create({
    data: {
      organizationId,
      actorId: user.id,
      kind: "UPDATED",
      summary: `${lead.name} → claimed`,
    },
  });
  revalidatePath("/dashboard/leads");
  revalidatePath("/dashboard/leads/kanban");
  return { ok: true };
}

// Permanently remove a lead. Related activity/call/appointment rows survive with
// their leadId nulled (optional relations default to SetNull on delete), so the
// history isn't hard-deleted alongside it. Org-scoped; logs the deletion.
export async function deleteLead(id: string) {
  const { organizationId, user } = await requireManager();
  const lead = await db.lead.findUnique({ where: { id } });
  if (!lead || lead.organizationId !== organizationId) throw new Error("Not found");
  await db.lead.delete({ where: { id } });
  await db.activityEvent.create({
    data: {
      organizationId,
      actorId: user.id,
      kind: "DELETED",
      summary: `Deleted lead ${lead.name}`,
    },
  });
  revalidatePath("/dashboard/leads");
  revalidatePath("/dashboard/leads/kanban");
  return { ok: true };
}

const importLeadInput = z.object({
  name: z.string().min(1),
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  projectType: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  // The job's address (2026-11-10): a CSV's address / city / state / ZIP columns, or the one "Job address" line typed
  // by hand — split into its parts when it reads as "street, city, ST 98101" (lib/leads/details).
  address: z.string().max(300).nullable().optional(),
  city: z.string().max(120).nullable().optional(),
  state: z.string().max(60).nullable().optional(),
  zip: z.string().max(20).nullable().optional(),
  // Any of the contractor's own sources (lib/leads/sources) — picked by hand,
  // detected in a pasted email, or read off a CSV column. Never LEAD_CENTER:
  // only the platform says a lead came from JobFlex.
  source: z
    .string()
    .default("IMPORT")
    .transform((v) => storableSource(v, "IMPORT")),
});
const importLeadsInput = z.array(importLeadInput).min(1).max(500);

const blank = (s: string | null | undefined) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t ? t : null;
};

/** An imported row's address as the lead keeps it: its own columns when it has them, else the one line split. */
function addressOf(r: { address?: string | null; city?: string | null; state?: string | null; zip?: string | null }) {
  const own = { address: blank(r.address), city: blank(r.city), state: blank(r.state), zip: blank(r.zip) };
  if (own.address && !own.city && !own.state && !own.zip) return splitLeadAddress(own.address);
  return own;
}

// Bring staged leads into the pipeline as real NEW-status rows, owner-notified.
// Sales reps may import too — rows land as NEW, which is inside their slice.
export async function importLeads(raw: unknown) {
  const { organizationId, user } = await requireSalesOrManager();
  await requirePage(organizationId, "leads");
  const rows = importLeadsInput.parse(raw);

  // Bulk headroom: the whole batch must fit within the remaining lead quota.
  await enforcePlanLimit(organizationId, "leads", rows.length);

  const created = await Promise.all(
    rows.map((r) =>
      db.lead.create({
        data: {
          organizationId,
          name: r.name,
          email: r.email ?? null,
          phone: r.phone ?? null,
          ...addressOf(r),
          projectType: r.projectType ?? null,
          description: r.description ?? null,
          source: r.source,
          status: "NEW",
        },
        select: { id: true },
      }),
    ),
  );

  // Best-effort owner notification per imported lead (never block the import).
  try {
    const { notifyLeadCreated } = await import("@/lib/notify");
    await Promise.all(created.map((l) => notifyLeadCreated(l.id)));
  } catch (err) {
    console.warn("[importLeads] notify failed:", err);
  }

  await db.activityEvent.create({
    data: {
      organizationId,
      actorId: user.id,
      kind: "CREATED",
      summary: `Imported ${created.length} lead${created.length === 1 ? "" : "s"}`,
    },
  });

  revalidatePath("/dashboard/leads");
  revalidatePath("/dashboard/leads/kanban");
  return { created: created.length };
}
