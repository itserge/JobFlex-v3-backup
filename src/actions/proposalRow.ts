"use server";
// THE PROPOSAL ROW'S ACTIONS (2026-11-10, the ProSmart gaps plan, part 4) — the "More" sheet and the Workers page's
// commission. The office's (owner, admin, manager). Crew changes use the existing actions (actions/workers
// assignWorker / unassignAssignment, actions/jobPay setAssignmentPay); the project move is actions/projectLinks
// setProposalProject; a job for a sold proposal is actions/jobs createJobFromProposal.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireManager } from "@/lib/orgContext";
import { cancelSold, proposalMore, reopenSold, repCommissions, setCallRepFirst, setDealPct, setDealRep, setRepPct, type ProposalMore } from "@/lib/proposalRow/server";

const ID = z.string().min(1).max(64);
const PCT = z.number().min(0).max(100).nullable();

function refresh() {
  for (const p of ["/dashboard/proposals", "/dashboard/jobs", "/dashboard/workers", "/dashboard/calendar", "/dashboard/financials", "/dashboard/projects", "/dashboard/pipeline"]) revalidatePath(p);
}

export async function getProposalMore(proposalId: string): Promise<ProposalMore> {
  const { organizationId } = await requireManager();
  const r = await proposalMore(organizationId, ID.parse(proposalId));
  if (!r) throw new Error("Not found");
  return r;
}

export async function setRepCommission(userId: string, pct: number | null): Promise<{ pct: number | null; earned: number; full: number; deals: number }> {
  const { organizationId, user } = await requireManager();
  const r = await setRepPct(organizationId, user.id, ID.parse(userId), PCT.parse(pct));
  refresh();
  // What they have earned under the new terms (a past deal keeps its own percent).
  const now = (await repCommissions(organizationId)).get(userId);
  return { pct: r.pct, earned: now?.earned ?? 0, full: now?.full ?? 0, deals: now?.deals ?? 0 };
}

export async function setDealCommission(proposalId: string, pct: number | null): Promise<void> {
  const { organizationId, user } = await requireManager();
  await setDealPct(organizationId, user.id, ID.parse(proposalId), PCT.parse(pct));
  refresh();
}

export async function setDealSeller(proposalId: string, userId: string): Promise<void> {
  const { organizationId, user } = await requireManager();
  await setDealRep(organizationId, user.id, ID.parse(proposalId), ID.parse(userId));
  refresh();
}

export async function setDealCallFirst(proposalId: string, on: boolean): Promise<void> {
  const { organizationId, user } = await requireManager();
  await setCallRepFirst(organizationId, user.id, ID.parse(proposalId), z.boolean().parse(on));
  refresh();
}

export async function cancelSoldJob(proposalId: string, reason: string | null): Promise<{ done: string[] }> {
  const { organizationId, user } = await requireManager();
  const r = await cancelSold(organizationId, user.id, ID.parse(proposalId), z.string().max(300).nullable().parse(reason));
  refresh();
  return r;
}

export async function reopenSoldJob(proposalId: string): Promise<void> {
  const { organizationId, user } = await requireManager();
  await reopenSold(organizationId, user.id, ID.parse(proposalId));
  refresh();
}
