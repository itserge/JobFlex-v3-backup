// PROJECT DETAIL — the one server read behind both routes that render a
// project (/dashboard/projects/[id] and the handheld /mobile-project-detail-v2/
// [id]), so the two can never describe the same project differently.
// Server-only: it takes the caller's organization and answers null for a
// project that is not theirs.

import { db } from "@/lib/db";
import { contractSchedule, contractTotal } from "@/lib/contractTotal";
import { BALANCE_STAGE_ID, BALANCE_STAGE_LABEL, fromMinor, resolveSchedule } from "@/lib/paymentSchedule";
import { categoryOf } from "@/lib/projectBudget";
import { projectMoney } from "@/lib/projectMoney";
import { stagesOf } from "@/lib/projectStages/server";
import type { PdAvailProposal, PdBudget, PdJob, PdLooseProposal, PdPayments, PdProject, PdProposal, PdStages, PdWorker } from "./project-detail-data";

export type ProjectDetailProps = {
  project: PdProject;
  /** The order of the work and its tasks (2026-11-05). */
  stages: PdStages;
  jobs: PdJob[];
  proposals: PdProposal[];
  availableProposals: PdAvailProposal[];
  /** The project's client's proposals that are in no project yet. */
  looseProposals: PdLooseProposal[];
  budget: PdBudget;
  /** Each sold proposal's payment schedule (2026-11-04). */
  payments: PdPayments;
  /** The company's crew, for Schedule & crew. */
  roster: PdWorker[];
};

export async function loadProjectDetail(id: string, organizationId: string): Promise<ProjectDetailProps | null> {
  const project = await db.project.findUnique({
    where: { id },
    include: {
      client: { select: { id: true, name: true } },
      budgetLines: { orderBy: { position: "asc" }, select: { id: true, category: true, amount: true, label: true } },
      // The newest costs for the list on the card; the totals are summed in the database (lib/projectMoney).
      expenses: { orderBy: { spentAt: "desc" }, take: 60, select: { id: true, category: true, amount: true, vendor: true, note: true, spentAt: true } },
      // The project's own proposals (Proposal.projectId, 2026-09-18), with the
      // change orders that move each one's contract.
      proposals: {
        where: { status: { not: "ARCHIVED" } },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          title: true,
          status: true,
          total: true,
          currency: true,
          updatedAt: true,
          client: { select: { name: true } },
          changeOrders: { where: { status: { in: ["DRAFT", "SENT", "APPROVED"] } }, select: { status: true, total: true } },
          // The Payments card: the schedule as the client's portal resolves it (lib/paymentSchedule).
          installments: { orderBy: { position: "asc" } },
        },
      },
      jobs: {
        include: {
          client: { select: { name: true } },
          // What the job has spent — part of the project's spend (2026-09-18).
          expenses: { where: { status: { in: ["APPROVED", "REIMBURSED"] } }, orderBy: { createdAt: "desc" }, take: 60, select: { id: true, category: true, amount: true, note: true, vendor: true, spentAt: true, createdAt: true } },
          // The contract behind the job: original → approved changes → current.
          proposal: { select: { total: true, changeOrders: { where: { status: "APPROVED" }, select: { status: true, total: true } } } },
          // Who is on it — the project's Schedule & crew (2026-11-04).
          assignments: { orderBy: { assignedAt: "asc" }, select: { workerId: true, status: true, worker: { select: { displayName: true } } } },
        },
        orderBy: [{ startsAt: "asc" }, { createdAt: "asc" }],
      },
    },
  });

  if (!project || project.organizationId !== organizationId) return null;

  // Attach candidates: the org's live proposals that are not on this project —
  // the project's own client's first, then the rest, newest first.
  const candidates = await db.proposal.findMany({
    where: { organizationId, status: { not: "ARCHIVED" }, OR: [{ projectId: null }, { projectId: { not: project.id } }] },
    select: {
      id: true,
      title: true,
      status: true,
      total: true,
      clientId: true,
      client: { select: { name: true } },
      project: { select: { name: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  const isMine = (clientId: string | null) => Boolean(project.clientId && clientId === project.clientId);
  const looseProposals = candidates
    .filter((p) => isMine(p.clientId) && !p.project)
    .map((p) => ({ id: p.id, title: p.title, total: p.total }));
  const availableProposals = [...candidates]
    .sort((a, b) => Number(isMine(b.clientId)) - Number(isMine(a.clientId)))
    .map((p) => ({
      id: p.id,
      title: p.title,
      status: p.status,
      total: p.total,
      clientName: p.client?.name ?? null,
      projectName: p.project?.name ?? null,
      blocked: null,
    }));

  // ── the Budget card ──
  const jobSpends = project.jobs.flatMap((j) =>
    // A receipt's own day and vendor (2026-11-04: it showed the day it was typed and its category as the vendor).
    j.expenses.map((e) => ({ id: e.id, source: "job" as const, jobTitle: j.title, category: categoryOf(e.category), amount: e.amount, vendor: e.vendor || e.category, note: e.note, at: (e.spentAt ?? e.createdAt).toISOString() })),
  );
  const projectSpends = project.expenses.map((e) => ({
    id: e.id,
    source: "project" as const,
    jobTitle: null,
    category: e.category,
    amount: e.amount,
    vendor: e.vendor,
    note: e.note,
    at: e.spentAt.toISOString(),
  }));
  // The money — the same read as the Projects list and Financials (lib/projectMoney): before tax, crew and stock in.
  const [moneyAll, stageRead] = await Promise.all([projectMoney(organizationId, [project.id]), stagesOf(project.id)]);
  const money = moneyAll.get(project.id)!;
  const budget: PdBudget = {
    summary: money,
    collected: money.collected,
    owed: money.owed,
    lines: project.budgetLines,
    expenses: [...projectSpends, ...jobSpends].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 60),
  };

  return {
    budget,
    stages: { ...stageRead, draftedByAi: Boolean(project.stagesDraftedAt) },
    project: {
        id: project.id,
        name: project.name,
        startsAt: project.startsAt,
        endsAt: project.endsAt,
        budget: project.budget,
        client: project.client,
        description: project.description,
        status: project.status,
        number: project.number,
    },
    proposals: project.proposals.map((p) => {
        const approved = p.changeOrders.filter((c) => c.status === "APPROVED");
        const pending = p.changeOrders.filter((c) => c.status !== "APPROVED");
        return {
        id: p.id,
        title: p.title,
        status: p.status,
        total: p.total,
        contract: contractTotal(p.total, p.changeOrders),
        clientName: p.client?.name ?? null,
        updatedAt: p.updatedAt,
        co: {
          count: p.changeOrders.length,
          approved: approved.length,
          pending: pending.length,
          approvedTotal: approved.reduce((n, c) => n + (c.total ?? 0), 0),
          pendingTotal: pending.reduce((n, c) => n + (c.total ?? 0), 0),
        },
      };
    }),
    jobs: project.jobs.map((j) => ({
      id: j.id,
      title: j.title,
      status: j.status,
      startsAt: j.startsAt,
      endsAt: j.endsAt,
      clientName: j.client?.name ?? null,
      crew: j.assignments.map((a) => ({ workerId: a.workerId, name: a.worker.displayName, status: a.status })),
      contract: j.proposal
        ? {
            original: j.proposal.total,
            changes: Math.round((contractTotal(j.proposal.total, j.proposal.changeOrders) - j.proposal.total) * 100) / 100,
            current: contractTotal(j.proposal.total, j.proposal.changeOrders),
          }
        : null,
    })),
    availableProposals,
    looseProposals,
    payments: project.proposals
      .filter((p) => SOLD.has(p.status))
      .map((p) => {
        const sch = resolveSchedule({ ...contractSchedule(p.total, p.changeOrders), currency: p.currency, installments: p.installments });
        const row = new Map(p.installments.map((i) => [i.id, i]));
        return {
          proposalId: p.id,
          title: p.title,
          status: p.status,
          billed: fromMinor(sch.totalMinor),
          base: p.total,
          paid: fromMinor(sch.paidMinor),
          remaining: fromMinor(sch.remainingMinor),
          stages: [
            ...sch.stages.map((st) => {
              const r = row.get(st.id);
              return {
                id: st.id,
                label: st.label,
                amount: fromMinor(st.amountMinor),
                status: st.status,
                payable: st.payable,
                synthetic: st.synthetic,
                paidAt: r?.paidAt ? r.paidAt.toISOString() : null,
                invoiceSentAt: r?.invoiceSentAt ? r.invoiceSentAt.toISOString() : null,
                remindedAt: r?.remindedAt ? r.remindedAt.toISOString() : null,
              };
            }),
            // What the stages leave unscheduled is the "Balance" — not a stage the resolver returns, the row every
            // schedule view draws for it; payable once nothing ahead of it is.
            ...(sch.hasBalanceRow
              ? [
                  {
                    id: BALANCE_STAGE_ID,
                    label: BALANCE_STAGE_LABEL,
                    amount: fromMinor(sch.balanceMinor),
                    status: "UNPAID" as const,
                    payable: sch.nextPayableId === null,
                    synthetic: true,
                    paidAt: null,
                    invoiceSentAt: null,
                    remindedAt: null,
                  },
                ]
              : []),
          ],
        };
      }),
    roster: (
      await db.workerProfile.findMany({
        where: { organizationId, inviteStatus: { not: "DECLINED" } },
        orderBy: { displayName: "asc" },
        select: { id: true, displayName: true, specialties: true },
      })
    ).map((w) => ({ id: w.id, name: w.displayName, trade: firstTrade(w.specialties) })),
  };
}

const SOLD = new Set(["ACCEPTED", "COMPLETED", "PAID"]);

/** A worker's first specialty (a JSON list in WorkerProfile.specialties), for the crew picker. */
function firstTrade(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) && typeof v[0] === "string" && v[0].trim() ? v[0].trim() : null;
  } catch {
    return null;
  }
}
