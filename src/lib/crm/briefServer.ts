// THE CRM BRIEF — the read. One pass over the org's rows (narrow selects,
// bounded windows), handed to the pure rules in ./brief. Read by the desktop
// CRM page (as props) and by the phone edition (through actions/crmBrief).
//
// Nothing here writes. The ticks live in SyncState under
// `crmChecks:<org>:<user>:<day>` — one JSON array of check keys per person per
// viewer-day — written by actions/crmBrief.setCrmCheck.

import { db } from "@/lib/db";
import { isEstimatorRole, isSalesRole } from "@/lib/orgContext";
import { viewerTimeZone } from "@/lib/viewerTz";
import { readLeadCalls } from "@/lib/aiDesk/leadCalls";
import { addDays, buildBrief, dayKeyTz, startOfDayTz, type BriefInput, type CallRow, type CrmBrief, type ViewerKind } from "./brief";

export const CHECKS_KEY = (organizationId: string, userId: string, dayKey: string) => `crmChecks:${organizationId}:${userId}:${dayKey}`;

export function viewerKindOf(role: string | null | undefined): ViewerKind {
  if (isSalesRole(role)) return "sales";
  if (isEstimatorRole(role)) return "estimator";
  return "office";
}

export async function readChecksDone(organizationId: string, userId: string, dayKey: string): Promise<string[]> {
  const row = await db.syncState.findUnique({ where: { key: CHECKS_KEY(organizationId, userId, dayKey) }, select: { cursor: true } });
  if (!row) return [];
  try {
    const v = JSON.parse(row.cursor);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export async function readCrmBrief(input: { organizationId: string; userId: string; role: string; now?: Date }): Promise<CrmBrief> {
  const { organizationId, userId, role } = input;
  const now = input.now ?? new Date();
  const viewer = viewerKindOf(role);

  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } });
  const tz = await viewerTimeZone(org?.timezone);
  const today = startOfDayTz(now, tz);
  const dayKey = dayKeyTz(now, tz);
  const yesterday = addDays(today, -1);
  const in8 = addDays(today, 8);
  const in14 = addDays(today, 14);
  const d1 = addDays(now, -1);
  const d2 = addDays(now, -2);
  const d7 = addDays(now, -7);
  const d14 = addDays(now, -14);
  const d60 = addDays(now, -60);
  const d90 = addDays(now, -90);
  const d180 = addDays(now, -180);

  const [proposals, payments, invoices, leads, followUps, changeOrders, calls, bookings, appointments, jobs, jobEvents, workDays, planVisits, reviews, receiptsToReview, texts, members, workers, activity, clients, done] = await Promise.all([
    db.proposal.findMany({
      where: {
        organizationId,
        status: { not: "ARCHIVED" },
        OR: [{ status: { in: ["DRAFT", "SENT", "VIEWED", "ACCEPTED"] } }, { updatedAt: { gte: d180 } }],
      },
      select: {
        id: true,
        title: true,
        status: true,
        total: true,
        clientId: true,
        ownerId: true,
        createdAt: true,
        sentAt: true,
        viewedAt: true,
        acceptedAt: true,
        declinedAt: true,
        paidAt: true,
        validUntil: true,
        client: { select: { name: true } },
        jobs: { select: { id: true }, take: 1 },
        changeOrders: { where: { status: "APPROVED" }, select: { total: true, amount: true } },
        installments: { select: { id: true, label: true, amount: true, isPercent: true, position: true, status: true, dueDate: true, paidAt: true, paidAmount: true } },
      },
      take: 1500,
    }),
    db.payment.findMany({
      where: { organizationId, status: "PAID", paidAt: { gte: d90 } },
      select: { id: true, amount: true, paidAt: true, clientId: true, proposalId: true, method: true, client: { select: { name: true } } },
      take: 2000,
    }),
    db.invoice.findMany({
      where: { organizationId, status: { notIn: ["PAID", "VOID", "CANCELED"] } },
      select: { id: true, number: true, amount: true, status: true, dueDate: true, proposalId: true, proposal: { select: { client: { select: { name: true } } } } },
      take: 300,
    }),
    db.lead.findMany({
      where: { organizationId, OR: [{ status: { notIn: ["WON", "LOST"] } }, { createdAt: { gte: d60 } }] },
      select: { id: true, name: true, status: true, projectType: true, createdAt: true, contactedAt: true, assignedToId: true, claimedById: true, assignedTo: { select: { name: true, email: true } } },
      take: 1000,
    }),
    db.followUp.findMany({ where: { organizationId, completedAt: null }, orderBy: { runAt: "asc" }, take: 100, select: { id: true, runAt: true, proposalId: true, note: true } }),
    db.changeOrder.findMany({
      where: { organizationId, status: "SENT" },
      select: { id: true, title: true, total: true, amount: true, sentAt: true, proposalId: true, jobId: true, job: { select: { client: { select: { name: true } } } }, proposal: { select: { client: { select: { name: true } } } } },
      take: 200,
    }),
    db.aiPhoneCall.findMany({ where: { organizationId, startedAt: { gte: d2 } }, select: { id: true, direction: true, status: true, startedAt: true, summary: true, leadId: true, fromNumber: true, callSid: true, lead: { select: { name: true } } }, take: 200 }),
    db.booking.findMany({ where: { organizationId, OR: [{ createdAt: { gte: d2 } }, { startsAt: { gte: today } }] }, select: { id: true, name: true, serviceLabel: true, startsAt: true, status: true, createdAt: true, appointmentId: true }, take: 200 }),
    db.appointment.findMany({
      where: { organizationId, startsAt: { gte: yesterday, lt: in8 } },
      select: { id: true, title: true, startsAt: true, endsAt: true, status: true, clientId: true, leadId: true, proposalId: true, client: { select: { name: true } }, lead: { select: { name: true } }, assignments: { select: { workerId: true } } },
      take: 500,
    }),
    db.job.findMany({
      where: { organizationId, OR: [{ status: { in: ["SCHEDULED", "IN_PROGRESS"] } }, { status: "COMPLETED", updatedAt: { gte: d14 } }] },
      select: {
        id: true,
        title: true,
        status: true,
        startsAt: true,
        endsAt: true,
        clientId: true,
        proposalId: true,
        updatedAt: true,
        client: { select: { name: true } },
        assignments: { select: { status: true, worker: { select: { displayName: true } } } },
        _count: { select: { reviewRequests: true, events: true } },
      },
      take: 500,
    }),
    db.jobEvent.findMany({ where: { organizationId, startsAt: { gte: yesterday, lt: in8 } }, select: { id: true, jobId: true, title: true, startsAt: true, endsAt: true }, take: 500 }),
    db.workDay.findMany({ where: { organizationId, status: "OPEN" }, select: { id: true, jobId: true, date: true, status: true, dayNumber: true }, take: 200 }),
    db.servicePlanVisit.findMany({ where: { organizationId, status: "SCHEDULED", dueAt: { lt: in14 } }, select: { id: true, label: true, dueAt: true, appointmentId: true, plan: { select: { name: true, client: { select: { name: true } } } } }, take: 200 }),
    db.reviewRequest.findMany({ where: { organizationId, createdAt: { gte: d90 } }, select: { id: true, status: true, rating: true, sentAt: true, completedAt: true, jobId: true, client: { select: { name: true } } }, take: 500 }),
    db.jobExpense.count({ where: { OR: [{ organizationId }, { job: { organizationId } }], status: "SUBMITTED" } }),
    db.smsMessage.findMany({ where: { organizationId, createdAt: { gte: d1 } }, select: { id: true, direction: true, from: true, to: true, createdAt: true, body: true }, take: 300 }),
    db.membership.findMany({ where: { organizationId }, select: { userId: true, role: true, user: { select: { name: true, email: true } } } }),
    db.workerProfile.findMany({ where: { organizationId, inviteStatus: { not: "DECLINED" } }, select: { id: true, userId: true, displayName: true } }),
    db.activityEvent.findMany({ where: { organizationId, createdAt: { gte: d7 } }, orderBy: { createdAt: "desc" }, take: 300, select: { id: true, kind: true, summary: true, createdAt: true, actorId: true, clientId: true } }),
    db.client.findMany({ where: { organizationId, deletedAt: null }, select: { id: true, name: true, createdAt: true }, take: 5000 }),
    readChecksDone(organizationId, userId, dayKey),
  ]);

  const workerName = new Map(workers.map((w) => [w.id, w.displayName]));
  const proposalById = new Map(proposals.map((p) => [p.id, p]));

  // A follow-up only carries a proposalId; its name comes from the proposals
  // already in hand, else one small lookup for the rest.
  const missing = followUps.map((f) => f.proposalId).filter((id): id is string => !!id && !proposalById.has(id));
  const extra = missing.length ? await db.proposal.findMany({ where: { id: { in: [...new Set(missing)] } }, select: { id: true, title: true, client: { select: { name: true } } } }) : [];
  const extraById = new Map(extra.map((p) => [p.id, p]));

  // The desk's own calls to leads (lib/aiDesk/leadCalls): how each went, from the lead's call state — and the visits
  // booked for leads, any day in the last half year and ahead (2026-10-31).
  const [deskCalls, leadVisits] = await Promise.all([
    readLeadCalls([...new Set(calls.flatMap((c) => (c.direction === "OUTBOUND" && c.leadId ? [c.leadId] : [])))]),
    db.appointment.findMany({ where: { organizationId, leadId: { not: null }, status: { not: "CANCELED" }, startsAt: { gte: d180 } }, select: { leadId: true, startsAt: true, status: true }, take: 2000 }),
  ]);
  const deskOutcome = (c: { direction: string; leadId: string | null; callSid: string }): CallRow["desk"] => {
    if (c.direction !== "OUTBOUND" || !c.leadId) return null;
    const s = deskCalls.get(c.leadId);
    // The state is the lead's newest desk call only; an older call reads by its summary.
    if (!s || s.sid !== c.callSid) return null;
    if (s.status === "calling" || s.status === "talking") return "calling";
    if (s.result === "booked") return "booked";
    return s.result ? "reached" : "missed";
  };

  const briefInput: BriefInput = {
    now,
    tz,
    viewer,
    userId,
    proposals: proposals.map((p) => ({
      id: p.id,
      title: p.title,
      status: p.status,
      total: p.total,
      extras: p.changeOrders.reduce((a, c) => a + (c.total ?? c.amount), 0),
      clientId: p.clientId,
      clientName: p.client?.name ?? null,
      ownerId: p.ownerId,
      createdAt: p.createdAt,
      sentAt: p.sentAt,
      viewedAt: p.viewedAt,
      acceptedAt: p.acceptedAt,
      declinedAt: p.declinedAt,
      paidAt: p.paidAt,
      validUntil: p.validUntil,
      hasJob: p.jobs.length > 0,
    })),
    installments: proposals.flatMap((p) => p.installments.map((i) => ({ ...i, proposalId: p.id }))),
    payments: payments.map((x) => ({ id: x.id, amount: x.amount, paidAt: x.paidAt, clientId: x.clientId, clientName: x.client?.name ?? null, proposalId: x.proposalId, method: x.method })),
    invoices: invoices.map((i) => ({ id: i.id, number: i.number, amount: i.amount, status: i.status, dueDate: i.dueDate, clientName: i.proposal?.client?.name ?? null, proposalId: i.proposalId })),
    leads: leads.map((l) => ({ id: l.id, name: l.name, status: l.status, projectType: l.projectType, createdAt: l.createdAt, contactedAt: l.contactedAt, assignedToId: l.assignedToId, claimedById: l.claimedById, assigneeName: l.assignedTo?.name ?? l.assignedTo?.email ?? null })),
    followUps: followUps.map((f) => {
      const p = f.proposalId ? (proposalById.get(f.proposalId) ?? extraById.get(f.proposalId)) : undefined;
      return { id: f.id, runAt: f.runAt, proposalId: f.proposalId, clientName: p?.client?.name ?? null, title: p?.title ?? f.note ?? null };
    }),
    changeOrders: changeOrders.map((c) => ({ id: c.id, title: c.title, total: c.total ?? c.amount, sentAt: c.sentAt, proposalId: c.proposalId, jobId: c.jobId, clientName: c.job?.client?.name ?? c.proposal?.client?.name ?? null })),
    calls: calls.map((c) => ({ id: c.id, direction: c.direction, status: c.status, startedAt: c.startedAt, summary: c.summary, leadId: c.leadId, leadName: c.lead?.name ?? null, fromNumber: c.fromNumber, desk: deskOutcome(c) })),
    leadVisits: leadVisits.flatMap((v) => (v.leadId ? [{ leadId: v.leadId, startsAt: v.startsAt, status: v.status }] : [])),
    bookings,
    appointments: appointments.map((a) => ({
      id: a.id,
      title: a.title,
      startsAt: a.startsAt,
      endsAt: a.endsAt,
      status: a.status,
      who: a.client?.name ?? a.lead?.name ?? null,
      clientId: a.clientId,
      leadId: a.leadId,
      proposalId: a.proposalId,
      crew: a.assignments.map((x) => workerName.get(x.workerId)).filter((n): n is string => !!n),
    })),
    jobs: jobs.map((j) => ({
      id: j.id,
      title: j.title,
      status: j.status,
      startsAt: j.startsAt,
      endsAt: j.endsAt,
      clientId: j.clientId,
      clientName: j.client?.name ?? null,
      proposalId: j.proposalId,
      updatedAt: j.updatedAt,
      assignments: j.assignments.map((a) => ({ status: a.status, workerName: a.worker.displayName })),
      hasReviewRequest: j._count.reviewRequests > 0,
      hasEvent: j._count.events > 0,
    })),
    jobEvents,
    workDays,
    planVisits: planVisits.map((v) => ({ id: v.id, label: v.label, dueAt: v.dueAt, appointmentId: v.appointmentId, clientName: v.plan.client?.name ?? null, planName: v.plan.name })),
    reviews: reviews.map((r) => ({ id: r.id, status: r.status, rating: r.rating, sentAt: r.sentAt, completedAt: r.completedAt, clientName: r.client?.name ?? null, jobId: r.jobId })),
    receiptsToReview,
    texts,
    members: members.map((m) => ({ userId: m.userId, name: m.user.name || m.user.email || "Member", role: m.role })),
    workers: workers.map((w) => ({ id: w.id, userId: w.userId, name: w.displayName })),
    activity,
    clients,
    done,
  };

  return buildBrief(briefInput);
}
