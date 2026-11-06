import "server-only";
// A LEAD BY HAND, WITHOUT A SESSION (2026-11-05, the AI Operator's batch 1):
// one row the way the Leads page's import makes them (actions/leads
// importLeads) — NEW, the owner notified, the trail written. Never LEAD_CENTER:
// only the platform says a lead came from JobFlex (lib/leads/sources).
import { db } from "@/lib/db";
import { enforcePlanLimit } from "@/lib/limitsEngine";
import { storableSource } from "@/lib/leads/sources";

export interface NewLead {
  name: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  projectType?: string | null;
  description?: string | null;
  /** One of the contractor's own sources ("referral", "website"…); anything else is MANUAL. */
  source?: string | null;
}

const clean = (v?: string | null) => {
  const t = (v ?? "").trim();
  return t.length ? t : null;
};

export async function createLeadAs(ctx: { organizationId: string; userId: string }, lead: NewLead): Promise<{ id: string; name: string }> {
  const { organizationId } = ctx;
  await enforcePlanLimit(organizationId, "leads", 1, { actorId: ctx.userId });
  const row = await db.lead.create({
    data: {
      organizationId,
      name: lead.name.trim(),
      email: clean(lead.email),
      phone: clean(lead.phone),
      address: clean(lead.address),
      projectType: clean(lead.projectType),
      description: clean(lead.description),
      source: storableSource(clean(lead.source), "MANUAL"),
      status: "NEW",
    },
    select: { id: true, name: true },
  });
  // Best-effort owner notification (never block the add).
  try {
    const { notifyLeadCreated } = await import("@/lib/notify");
    await notifyLeadCreated(row.id);
  } catch (err) {
    console.warn("[leads] notify failed:", err);
  }
  await db.activityEvent
    .create({
      data: {
        organizationId,
        actorId: ctx.userId,
        leadId: row.id,
        kind: "CREATED",
        summary: `Added lead ${row.name}${clean(lead.projectType) ? ` — ${clean(lead.projectType)}` : ""}`,
      },
    })
    .catch(() => null);
  return row;
}
