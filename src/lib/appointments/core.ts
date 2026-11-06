import "server-only";
// VISITS WITHOUT A SESSION (2026-11-05, the AI Operator's batch 1): booking,
// moving and cancelling an appointment as the calendar's own actions do
// (actions/appointments), as plain functions of who is acting — the org
// checks, the sales rep's own slice, the crew's and the office's texts, the
// trail. The actions keep their bodies and import the shared helpers from
// here; the Operator's tools (lib/assistant/visits) call the three `…As`.
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { isSalesRole, UnauthorizedError } from "@/lib/orgContext";
import { enforcePlanLimit } from "@/lib/limitsEngine";
import { isPageLocked } from "@/lib/customPageAccess";
import { textAppointmentBooked, textAppointmentCancelled, textAppointmentMoved as textVisitMoved, visitFacts } from "@/lib/sms/schedule";
import { crewOfAppointment, textAppointmentMoved, textCrewCancelled } from "@/lib/sms/crew";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { markLeadContacted } from "@/lib/leads/contacted";

export const when = (d: Date) => d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

// The linked lead/client/proposal must belong to the caller's org — the ids
// arrive from the client and would otherwise let a crafted request attach
// another tenant's records.
export async function assertLinksInOrg(
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
export async function salesWorkerId(userId: string): Promise<string | null> {
  const wp = await db.workerProfile.findUnique({
    where: { userId },
    select: { id: true },
  });
  return wp?.id ?? null;
}

export async function assertSalesCanTouchAppointment(appointmentId: string, userId: string) {
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
export async function filterWorkerIdsForRole(
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
export async function syncAssignments(
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
export async function notifyNewlyStaffed(appointmentId: string, added: string[]) {
  if (!added.length) return;
  try {
    const { notifyAppointmentAssigned } = await import("@/lib/notify");
    await notifyAppointmentAssigned(appointmentId, added);
  } catch (err) {
    console.warn("[appointments] assignment notify failed:", err);
  }
}

// ── the Operator's three ────────────────────────────────────────────────────

export interface VisitActor {
  organizationId: string;
  userId: string;
  role: string;
}

export interface NewVisit {
  title: string;
  clientId?: string | null;
  leadId?: string | null;
  proposalId?: string | null;
  startsAt: Date;
  endsAt: Date;
  notes?: string | null;
  workerIds?: string[];
}

/** Outside a request there is no response to wait for: the calendar is marked stale and the error swallowed. */
function stale(path: string) {
  try {
    revalidatePath(path);
  } catch {
    /* not in a request */
  }
}

async function ownVisit(organizationId: string, id: string) {
  const apt = await db.appointment.findFirst({ where: { id, organizationId } });
  if (!apt) throw new Error("Not found");
  return apt;
}

export async function bookVisitAs(ctx: VisitActor, v: NewVisit): Promise<{ id: string }> {
  const { organizationId } = ctx;
  if (await isPageLocked(organizationId, "calendar")) throw new Error("The calendar isn't in your plan.");
  await enforcePlanLimit(organizationId, "calendarCards", 1, { actorId: ctx.userId });
  await assertLinksInOrg(organizationId, v);
  const workerIds = await filterWorkerIdsForRole(ctx.role, ctx.userId, v.workerIds);
  const apt = await db.appointment.create({
    data: {
      organizationId,
      createdById: ctx.userId,
      title: v.title,
      leadId: v.leadId ?? null,
      clientId: v.clientId ?? null,
      proposalId: v.proposalId ?? null,
      startsAt: v.startsAt,
      endsAt: v.endsAt,
      notes: v.notes ?? null,
      status: "SCHEDULED",
    },
  });
  if (workerIds?.length) {
    const { added } = await syncAssignments(organizationId, apt.id, workerIds);
    await notifyNewlyStaffed(apt.id, added);
  }
  // A visit booked for a lead means someone reached them (owner-approved 2026-10-31): the CRM's "not called back"
  // clears, the lead moves on to CONTACTED, and a sales rep keeps the lead they booked (lib/leads/contacted).
  if (apt.leadId) {
    await markLeadContacted(organizationId, apt.leadId, { status: true, claimFor: isSalesRole(ctx.role) ? ctx.userId : null });
    stale("/dashboard/leads");
  }
  stale("/dashboard/calendar");
  await logActivity({
    organizationId,
    actorId: ctx.userId,
    kind: TRAIL_KINDS.APPOINTMENT,
    summary: `Booked ${apt.title} for ${when(apt.startsAt)}`,
    proposalId: apt.proposalId,
    clientId: apt.clientId,
    leadId: apt.leadId,
    meta: { appointmentId: apt.id, startsAt: apt.startsAt.toISOString(), endsAt: apt.endsAt.toISOString(), workers: workerIds?.length ?? 0, by: "assistant" },
  });
  // The office and the rep hear about the visit by text (2026-09-29).
  await textAppointmentBooked(apt.id, ctx.userId).catch(() => undefined);
  return { id: apt.id };
}

export async function moveVisitAs(ctx: VisitActor, id: string, startsAt: Date, endsAt: Date): Promise<void> {
  const { organizationId } = ctx;
  const apt = await ownVisit(organizationId, id);
  if (isSalesRole(ctx.role)) await assertSalesCanTouchAppointment(id, ctx.userId);
  // Product rule: date/time moves are blocked at the calendar-cards cap (as rescheduleAppointment).
  await enforcePlanLimit(organizationId, "calendarCards", 1, { actorId: ctx.userId });
  await db.appointment.update({ where: { id }, data: { startsAt, endsAt } });
  // A moved appointment texts its crew (2026-09-24), and the office and the rep (2026-09-29): from → to.
  await textAppointmentMoved(id).catch(() => undefined);
  if (startsAt.getTime() !== apt.startsAt.getTime()) await textVisitMoved(id, apt.startsAt, ctx.userId).catch(() => undefined);
  stale("/dashboard/calendar");
  await logActivity({
    organizationId,
    actorId: ctx.userId,
    kind: TRAIL_KINDS.APPOINTMENT,
    summary: `Moved the appointment ${apt.title} from ${when(apt.startsAt)} to ${when(startsAt)}`,
    proposalId: apt.proposalId,
    clientId: apt.clientId,
    leadId: apt.leadId,
    meta: { appointmentId: id, from: apt.startsAt.toISOString(), to: startsAt.toISOString(), by: "assistant" },
  });
}

/** Cancelled, not deleted: it stays in the calendar's history as the page's own Cancel does (status CANCELED). */
export async function cancelVisitAs(ctx: VisitActor, id: string): Promise<void> {
  const { organizationId } = ctx;
  const apt = await ownVisit(organizationId, id);
  if (apt.status === "CANCELED") return;
  if (isSalesRole(ctx.role)) await assertSalesCanTouchAppointment(id, ctx.userId);
  // The crew and the visit are read before the status changes, and texted after.
  const crew = await crewOfAppointment(id).catch(() => null);
  const visit = await visitFacts(id).catch(() => null);
  await db.appointment.update({ where: { id }, data: { status: "CANCELED" } });
  await textCrewCancelled(crew).catch(() => undefined);
  await textAppointmentCancelled(visit, ctx.userId).catch(() => undefined);
  stale("/dashboard/calendar");
  await logActivity({
    organizationId,
    actorId: ctx.userId,
    kind: TRAIL_KINDS.APPOINTMENT,
    summary: `Canceled the appointment ${apt.title} (${when(apt.startsAt)})`,
    proposalId: apt.proposalId,
    clientId: apt.clientId,
    leadId: apt.leadId,
    meta: { appointmentId: id, startsAt: apt.startsAt.toISOString(), by: "assistant" },
  });
}
