"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSalesOrManager, isSalesRole, UnauthorizedError } from "@/lib/orgContext";
import { db } from "@/lib/db";
import { enforcePlanLimit } from "@/lib/limitsEngine";
import { afterResponse } from "@/lib/server-events";
import { textAppointmentBooked, textAppointmentCancelled, textAppointmentMoved as textVisitMoved, visitFacts } from "@/lib/sms/schedule";
import { crewOfAppointment, textAppointmentMoved, textCrewCancelled } from "@/lib/sms/crew";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { requirePage } from "@/lib/customPageAccess";
import { markLeadContacted } from "@/lib/leads/contacted";

const when = (d: Date) =>
  d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const baseInput = z.object({
  id: z.string().optional(),
  title: z.string().min(1),
  leadId: z.string().nullable().optional(),
  clientId: z.string().nullable().optional(),
  proposalId: z.string().nullable().optional(),
  startsAt: z.union([z.string(), z.date()]),
  endsAt: z.union([z.string(), z.date()]),
  notes: z.string().nullable().optional(),
  status: z.enum(["SCHEDULED", "COMPLETED", "CANCELED", "NO_SHOW"]).optional(),
  workerIds: z.array(z.string()).optional(),
});

const oneLink = (d: { leadId?: string | null; clientId?: string | null; proposalId?: string | null }) =>
  [d.leadId, d.clientId, d.proposalId].filter(Boolean).length <= 1;

const input = baseInput.refine(oneLink, {
  message: "Link a lead, a client, or a proposal — not more than one",
});

function toDate(v: string | Date): Date {
  return v instanceof Date ? v : new Date(v);
}

// The linked lead/client/proposal must belong to the caller's org — the ids
// arrive from the client and would otherwise let a crafted request attach
// another tenant's records.
async function assertLinksInOrg(
  organizationId: string,
  d: { leadId?: string | null; clientId?: string | null; proposalId?: string | null },
) {
  if (d.leadId) {
    const lead = await db.lead.findUnique({ where: { id: d.leadId } });
    if (!lead || lead.organizationId !== organizationId) throw new Error("Lead not found");
  }
  if (d.clientId) {
    const client = await db.client.findUnique({ where: { id: d.clientId } });
    if (!client || client.organizationId !== organizationId) throw new Error("Client not found");
  }
  if (d.proposalId) {
    const proposal = await db.proposal.findUnique({ where: { id: d.proposalId } });
    if (!proposal || proposal.organizationId !== organizationId)
      throw new Error("Proposal not found");
  }
}

// Sales reps operate on their own slice of the calendar: appointments they
// created or are staffed on (mirrors the sales calendar query). Managers touch
// anything in the org. Returns the caller's WorkerProfile id (if any) so
// staffing writes can be limited to self-assignment.
async function salesWorkerId(userId: string): Promise<string | null> {
  const wp = await db.workerProfile.findUnique({
    where: { userId },
    select: { id: true },
  });
  return wp?.id ?? null;
}

async function assertSalesCanTouchAppointment(appointmentId: string, userId: string) {
  const apt = await db.appointment.findUnique({
    where: { id: appointmentId },
    select: { createdById: true, assignments: { select: { workerId: true } } },
  });
  if (!apt) throw new Error("Not found");
  if (apt.createdById === userId) return;
  const wid = await salesWorkerId(userId);
  if (!wid || !apt.assignments.some((a) => a.workerId === wid)) {
    throw new UnauthorizedError("You can only change appointments you created or are staffed on");
  }
}

// Sales reps may only staff themselves; silently drop any other ids a crafted
// request smuggles in. Managers pass the list through untouched.
async function filterWorkerIdsForRole(
  role: string,
  userId: string,
  workerIds: string[] | undefined,
): Promise<string[] | undefined> {
  if (!workerIds || !isSalesRole(role)) return workerIds;
  const wid = await salesWorkerId(userId);
  return wid ? workerIds.filter((id) => id === wid) : [];
}

// Replace the appointment's staff list. Worker ids are org-checked for the same
// reason as the entity links above.
async function syncAssignments(
  organizationId: string,
  appointmentId: string,
  workerIds: string[],
): Promise<{ added: string[] }> {
  const valid = await db.workerProfile.findMany({
    where: { id: { in: workerIds }, organizationId },
    select: { id: true },
  });
  const validIds = valid.map((w) => w.id);
  // Who is on it ALREADY, so the caller can mail only the people this save
  // actually adds — re-saving an appointment must not re-notify the crew that
  // was already on it.
  const before = await db.appointmentAssignment.findMany({
    where: { appointmentId },
    select: { workerId: true },
  });
  const had = new Set(before.map((a) => a.workerId));
  await db.appointmentAssignment.deleteMany({
    where: { appointmentId, workerId: { notIn: validIds } },
  });
  for (const workerId of validIds) {
    await db.appointmentAssignment.upsert({
      where: { appointmentId_workerId: { appointmentId, workerId } },
      update: {},
      create: { appointmentId, workerId },
    });
  }
  return { added: validIds.filter((id) => !had.has(id)) };
}

/** Mail the people this save just put on the appointment. Best-effort: a mail
 *  failure must never roll back a booking that is already in the calendar. */
async function notifyNewlyStaffed(appointmentId: string, added: string[]) {
  if (!added.length) return;
  try {
    const { notifyAppointmentAssigned } = await import("@/lib/notify");
    await notifyAppointmentAssigned(appointmentId, added);
  } catch (err) {
    console.warn("[appointments] assignment notify failed:", err);
  }
}

export async function createAppointment(raw: unknown) {
  const { organizationId, user, role } = await requireSalesOrManager();
  await requirePage(organizationId, "calendar");
  await enforcePlanLimit(organizationId, "calendarCards");
  const data = input.parse(raw);
  await assertLinksInOrg(organizationId, data);
  const workerIds = await filterWorkerIdsForRole(role, user.id, data.workerIds);
  const apt = await db.appointment.create({
    data: {
      organizationId,
      createdById: user.id,
      title: data.title,
      leadId: data.leadId ?? null,
      clientId: data.clientId ?? null,
      proposalId: data.proposalId ?? null,
      startsAt: toDate(data.startsAt),
      endsAt: toDate(data.endsAt),
      notes: data.notes ?? null,
      status: data.status ?? "SCHEDULED",
    },
  });
  if (workerIds?.length) {
    const { added } = await syncAssignments(organizationId, apt.id, workerIds);
    await notifyNewlyStaffed(apt.id, added);
  }
  // A visit booked for a lead means someone reached them (owner-approved 2026-10-31): the CRM's "not called back"
  // clears, the lead moves on to CONTACTED, and a sales rep keeps the lead they booked (lib/leads/contacted).
  if (apt.leadId && apt.status === "SCHEDULED") {
    await markLeadContacted(organizationId, apt.leadId, { status: true, claimFor: isSalesRole(role) ? user.id : null });
    revalidatePath("/dashboard/leads");
    revalidatePath(`/dashboard/leads/${apt.leadId}`);
  }
  revalidatePath("/dashboard/calendar");
  await logActivity({
    organizationId,
    actorId: user.id,
    kind: TRAIL_KINDS.APPOINTMENT,
    summary: `Booked ${apt.title} for ${when(apt.startsAt)}`,
    proposalId: apt.proposalId,
    clientId: apt.clientId,
    leadId: apt.leadId,
    meta: { appointmentId: apt.id, startsAt: apt.startsAt.toISOString(), endsAt: apt.endsAt.toISOString(), workers: workerIds?.length ?? 0 },
  });
  // The office and the rep hear about the visit by text (2026-09-29).
  afterResponse(() => textAppointmentBooked(apt.id, user.id));
  return { id: apt.id };
}

export async function updateAppointment(id: string, rawInput: Partial<z.infer<typeof baseInput>>) {
  const { organizationId, user, role } = await requireSalesOrManager();
  await requirePage(organizationId, "calendar");
  // Server actions are network-invokable — parse at runtime, don't trust the
  // TypeScript signature.
  const raw = baseInput.partial().parse(rawInput);
  const apt = await db.appointment.findUnique({ where: { id } });
  if (!apt || apt.organizationId !== organizationId) throw new Error("Not found");
  if (isSalesRole(role)) await assertSalesCanTouchAppointment(id, user.id);
  // Enforce the one-link invariant against the MERGED row, not just the patch —
  // adding clientId to an appointment that already has leadId must fail.
  const merged = {
    leadId: raw.leadId === undefined ? apt.leadId : raw.leadId,
    clientId: raw.clientId === undefined ? apt.clientId : raw.clientId,
    proposalId: raw.proposalId === undefined ? apt.proposalId : raw.proposalId,
  };
  if (!oneLink(merged)) {
    throw new Error("Link a lead, a client, or a proposal — not more than one");
  }
  // Product rule: date/time moves are blocked at the calendar-cards cap, even
  // though a move creates no new row (matches rescheduleAppointment).
  if (raw.startsAt || raw.endsAt) {
    await enforcePlanLimit(organizationId, "calendarCards");
  }
  await assertLinksInOrg(organizationId, raw);
  await db.appointment.update({
    where: { id },
    data: {
      title: raw.title ?? undefined,
      leadId: raw.leadId === null ? null : raw.leadId ?? undefined,
      clientId: raw.clientId === null ? null : raw.clientId ?? undefined,
      proposalId: raw.proposalId === null ? null : raw.proposalId ?? undefined,
      startsAt: raw.startsAt ? toDate(raw.startsAt) : undefined,
      endsAt: raw.endsAt ? toDate(raw.endsAt) : undefined,
      notes: raw.notes === null ? null : raw.notes ?? undefined,
      status: raw.status ?? undefined,
    },
  });
  // A moved appointment texts its crew (2026-09-24), after the response.
  if (raw.startsAt) afterResponse(() => textAppointmentMoved(id));
  if (raw.status === "CANCELED" && apt.status !== "CANCELED") afterResponse(async () => textCrewCancelled(await crewOfAppointment(id)));
  // …and the office and the rep (2026-09-29): a real move says from → to.
  if (raw.startsAt && toDate(raw.startsAt).getTime() !== apt.startsAt.getTime() && raw.status !== "CANCELED") afterResponse(() => textVisitMoved(id, apt.startsAt, user.id));
  if (raw.status === "CANCELED" && apt.status !== "CANCELED") afterResponse(async () => textAppointmentCancelled(await visitFacts(id), user.id));
  if (raw.workerIds) {
    const workerIds = await filterWorkerIdsForRole(role, user.id, raw.workerIds);
    const { added } = await syncAssignments(organizationId, id, workerIds ?? []);
    await notifyNewlyStaffed(id, added);
  }
  revalidatePath("/dashboard/calendar");
  const changes: string[] = [];
  if (raw.title !== undefined && raw.title !== apt.title) changes.push(`renamed to ${raw.title}`);
  if (raw.status !== undefined && raw.status !== apt.status) changes.push(raw.status.replace("_", " ").toLowerCase());
  if (raw.startsAt && toDate(raw.startsAt).getTime() !== apt.startsAt.getTime()) changes.push(`moved to ${when(toDate(raw.startsAt))}`);
  else if (raw.endsAt && toDate(raw.endsAt).getTime() !== apt.endsAt.getTime()) changes.push(`ends ${when(toDate(raw.endsAt))}`);
  if (raw.notes !== undefined && (raw.notes ?? null) !== (apt.notes ?? null)) changes.push("notes");
  if (raw.workerIds) changes.push("staff");
  if (raw.leadId !== undefined || raw.clientId !== undefined || raw.proposalId !== undefined) changes.push("link");
  await logActivity({
    organizationId,
    actorId: user.id,
    kind: TRAIL_KINDS.APPOINTMENT,
    summary:
      raw.status === "CANCELED" && apt.status !== "CANCELED"
        ? `Canceled the appointment ${apt.title} (${when(apt.startsAt)})`
        : `Updated the appointment ${apt.title}${changes.length ? ` — ${changes.join(", ")}` : ""}`,
    proposalId: merged.proposalId,
    clientId: merged.clientId,
    leadId: merged.leadId,
    meta: { appointmentId: id, changes, status: raw.status ?? undefined },
  });
}

export async function deleteAppointment(id: string) {
  const { organizationId, user, role } = await requireSalesOrManager();
  await requirePage(organizationId, "calendar");
  const apt = await db.appointment.findUnique({ where: { id } });
  if (!apt || apt.organizationId !== organizationId) throw new Error("Not found");
  if (isSalesRole(role)) await assertSalesCanTouchAppointment(id, user.id);
  // The crew is read before the row goes, and texted after the response.
  const crew = await crewOfAppointment(id).catch(() => null);
  const visit = apt.status === "CANCELED" ? null : await visitFacts(id).catch(() => null);
  await db.appointment.delete({ where: { id } });
  afterResponse(() => textCrewCancelled(crew));
  afterResponse(() => textAppointmentCancelled(visit, user.id));
  revalidatePath("/dashboard/calendar");
  await logActivity({
    organizationId,
    actorId: user.id,
    kind: TRAIL_KINDS.APPOINTMENT,
    summary: `Deleted the appointment ${apt.title} (${when(apt.startsAt)})`,
    proposalId: apt.proposalId,
    clientId: apt.clientId,
    leadId: apt.leadId,
    meta: { appointmentId: id, startsAt: apt.startsAt.toISOString(), deleted: true },
  });
}

export async function rescheduleAppointment(id: string, newStartISO: string) {
  const { organizationId, user, role } = await requireSalesOrManager();
  await requirePage(organizationId, "calendar");
  const apt = await db.appointment.findUnique({ where: { id } });
  if (!apt || apt.organizationId !== organizationId) throw new Error("Not found");
  if (isSalesRole(role)) await assertSalesCanTouchAppointment(id, user.id);
  // Product rule: drag/drop moves are blocked at the calendar-cards cap.
  await enforcePlanLimit(organizationId, "calendarCards");
  const newStart = new Date(newStartISO);
  const duration = apt.endsAt.getTime() - apt.startsAt.getTime();
  newStart.setHours(apt.startsAt.getHours(), apt.startsAt.getMinutes(), 0, 0);
  const newEnd = new Date(newStart.getTime() + duration);
  await db.appointment.update({
    where: { id },
    data: { startsAt: newStart, endsAt: newEnd },
  });
  afterResponse(() => textAppointmentMoved(id));
  if (newStart.getTime() !== apt.startsAt.getTime()) afterResponse(() => textVisitMoved(id, apt.startsAt, user.id));
  revalidatePath("/dashboard/calendar");
  await logActivity({
    organizationId,
    actorId: user.id,
    kind: TRAIL_KINDS.APPOINTMENT,
    summary: `Moved the appointment ${apt.title} from ${when(apt.startsAt)} to ${when(newStart)}`,
    proposalId: apt.proposalId,
    clientId: apt.clientId,
    leadId: apt.leadId,
    meta: { appointmentId: id, from: apt.startsAt.toISOString(), to: newStart.toISOString() },
  });
}
