// Plain server module (NOT "use server"). Auto-creates a Job — deliberately
// UNSCHEDULED, with no calendar event — from an accepted proposal. Called from
// the public accept route, which has no user session — so the organization is DERIVED from the proposal, never
// taken from a caller-supplied parameter (which would make this a cross-tenant
// write endpoint). Idempotent: dedupes on (organizationId, proposalId).
//
// Quota: intentionally ALLOW-BUT-COUNT — a homeowner accepting a proposal must
// never be blocked by the contractor's plan cap; the created Job still counts
// toward usage. Authenticated callers must enforcePlanLimit BEFORE
// calling this (the dashboard actions in src/actions/jobs.ts do).
import { db } from "@/lib/db";
import { JobStatus } from "@/lib/prismaEnums";
import { projectForSoldProposal } from "@/lib/projectStages/server";

export async function createJobFromProposalInternal(proposalId: string) {
  const proposal = await db.proposal.findUnique({ where: { id: proposalId } });
  if (!proposal) throw new Error("Not found");
  const { organizationId } = proposal;

  const existing = await db.job.findFirst({ where: { organizationId, proposalId } });
  if (existing) {
    // The sale may still want its project (Automatic projects, 2026-11-05) — idempotent, never throws.
    await projectForSoldProposal(proposal.id);
    return { id: existing.id, created: false as const };
  }

  // NO DATE, and no calendar event.
  //
  // This used to invent one — next week, 09:00–14:00 — and write a JobEvent for
  // it the moment a homeowner clicked Accept. Nobody had agreed to that day: not
  // the client, who was only saying yes to the price, and not the contractor,
  // who found work sitting on their calendar on a date the software chose. The
  // crew could be booked solid that morning and the job would still be there.
  //
  // Worse, the invented event is what kept accepted work OUT of the calendar's
  // "Unscheduled" tray — that tray is `status in (SCHEDULED, IN_PROGRESS)` AND
  // `events: { none: {} }` (see dashboard/calendar/calendar-query.ts), so a job
  // that arrives already carrying an event is never offered for scheduling.
  //
  // A job with no event and no span is exactly what the tray is for: it shows up
  // as a card the contractor drags onto a real day, and `scheduleJobFromTray`
  // then writes the span and the event for the day they actually chose.
  const job = await db.job.create({
    data: {
      organizationId,
      title: proposal.title,
      clientId: proposal.clientId,
      proposalId: proposal.id,
      // A proposal in a project makes its job there.
      projectId: proposal.projectId ?? null,
      status: JobStatus.SCHEDULED,
      scopeOfWork: proposal.scopeOfWork ?? null,
    },
  });

  // AUTOMATIC PROJECTS (owner's plan, 2026-11-05): a sold proposal in a trade the company runs as projects
  // (deck, roof, remodel…) gets a project with its stages, and this job is filed there. Never throws.
  await projectForSoldProposal(proposal.id);

  return { id: job.id, created: true as const };
}
