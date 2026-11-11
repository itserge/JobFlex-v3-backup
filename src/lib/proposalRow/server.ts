import "server-only";
// THE PROPOSAL ROW AND SALES COMMISSION, ON THE SERVER (2026-11-10, the ProSmart gaps plan, part 4).
//
//   proposalMore      — the "More" sheet's read for one sold proposal: its crew, its project, who sold it with their
//                       percent and what they have earned, "call the rep first", and whether it can be cancelled.
//   commissionByDeal  — the book's chips: per proposal, the rep's percent and what they have earned (collected).
//   repCommissions    — the Workers page: per member, their percent and what they have earned on their deals.
//   cancelSold / reopenSold — a sold job cancelled with a reason (out of sold work and money to collect: open payments
//                       closed, open invoices voided, the job cancelled and the crew texted), and put back.
//   setRepPct / setDealPct / setDealRep / setCallRepFirst — the office's edits.

import { db } from "@/lib/db";
import { afterResponse } from "@/lib/server-events";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { contractRevenue, contractTotal } from "@/lib/contractTotal";
import { expireOpenCheckoutsForProposal } from "@/lib/payments/checkouts";
import { INVOICE_OPEN, INVOICE_VOID } from "@/lib/payments/invoiceRecord";
import { crewOfJobEvent, textCrewCancelled } from "@/lib/sms/crew";
import { cancelWarnings, cleanPct, cleanReason, commissionOf, effectivePct, isSold } from "@/lib/proposalRow/shared";
import { isPageLocked, requirePage } from "@/lib/customPageAccess";

// SALES COMMISSION IS A SIZE'S on the new plans (Base + Tools, 2026-11-10: Professional and up, with the sales
// roles): the edits are refused and the reads come back empty without it. Every Classic plan holds it, as before
// (lib/customPlan classicEquivalent).
const COMMISSION = "commission" as const;

const PAID = ["PAID", "PARTIAL", "PARTIALLY_REFUNDED"];
const SELLER_ROLES = ["SALES", "ESTIMATOR", "MANAGER", "OWNER", "ADMIN"];
const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

type MoneyIn = { total: number; taxTotal: number | null; changeOrders: Array<{ status: string; total: number | null; amount: number | null }>; payments: Array<{ amount: number; refundedAmount: number | null }> };
function moneyOf(p: MoneyIn) {
  const contract = contractTotal(p.total, p.changeOrders);
  const revenue = contractRevenue(p.total, p.taxTotal, p.changeOrders);
  const collected = p.payments.reduce((a, x) => a + Math.max(0, x.amount - (x.refundedAmount ?? 0)), 0);
  return { contract, revenue, collected: Math.round(collected * 100) / 100 };
}
const MONEY_SELECT = {
  total: true,
  taxTotal: true,
  changeOrders: { where: { status: "APPROVED" }, select: { status: true, total: true, amount: true } },
  payments: { where: { status: { in: PAID } }, select: { amount: true, refundedAmount: true } },
} as const;

/** Per proposal: the effective percent and the commission earned so far (the book's chips). */
export async function commissionByDeal(organizationId: string, proposalIds: string[]): Promise<Map<string, { pct: number; earned: number; full: number; repId: string }>> {
  const out = new Map<string, { pct: number; earned: number; full: number; repId: string }>();
  if (!proposalIds.length) return out;
  if (await isPageLocked(organizationId, COMMISSION)) return out;
  const rows = await db.proposal.findMany({ where: { organizationId, id: { in: proposalIds }, ownerId: { not: null } }, select: { id: true, status: true, ownerId: true, commissionPct: true, ...MONEY_SELECT } });
  const owners = [...new Set(rows.map((r) => r.ownerId!))];
  const members = await db.membership.findMany({ where: { organizationId, userId: { in: owners } }, select: { userId: true, commissionPct: true } });
  const repPct = new Map(members.map((m) => [m.userId, m.commissionPct]));
  for (const r of rows) {
    if (!isSold(r.status)) continue;
    const pct = effectivePct(r.commissionPct, repPct.get(r.ownerId!));
    if (!pct) continue;
    out.set(r.id, { pct, repId: r.ownerId!, ...commissionOf({ pct, ...moneyOf(r) }) });
  }
  return out;
}

/** Per member: their percent and what they have earned on their sold deals (the Workers page). */
export async function repCommissions(organizationId: string): Promise<Map<string, { pct: number | null; earned: number; full: number; deals: number }>> {
  if (await isPageLocked(organizationId, COMMISSION)) return new Map();
  const members = await db.membership.findMany({ where: { organizationId }, select: { userId: true, commissionPct: true } });
  const out = new Map<string, { pct: number | null; earned: number; full: number; deals: number }>();
  for (const m of members) out.set(m.userId, { pct: m.commissionPct, earned: 0, full: 0, deals: 0 });
  const rows = await db.proposal.findMany({ where: { organizationId, status: { in: ["ACCEPTED", "COMPLETED", "PAID"] }, ownerId: { not: null } }, select: { ownerId: true, commissionPct: true, ...MONEY_SELECT } });
  for (const r of rows) {
    const rep = out.get(r.ownerId!);
    if (!rep) continue;
    const pct = effectivePct(r.commissionPct, rep.pct);
    if (!pct) continue;
    const c = commissionOf({ pct, ...moneyOf(r) });
    rep.earned = Math.round((rep.earned + c.earned) * 100) / 100;
    rep.full = Math.round((rep.full + c.full) * 100) / 100;
    rep.deals += 1;
  }
  return out;
}

export type ProposalMore = {
  proposalId: string;
  title: string;
  status: string;
  sold: boolean;
  canceled: { at: string; reason: string | null } | null;
  client: { id: string; name: string } | null;
  money: { contract: number; collected: number; left: number };
  rep: { userId: string; name: string; phone: string | null; repPct: number | null; dealPct: number | null; pct: number | null; earned: number; full: number } | null;
  sellers: Array<{ userId: string; name: string; role: string; pct: number | null }>;
  callRepFirst: boolean;
  project: { id: string; name: string } | null;
  projects: Array<{ id: string; name: string; clients: boolean }>;
  job: { id: string; title: string; status: string; crew: Array<{ assignmentId: string; workerId: string; name: string; pay: number; status: string }> } | null;
  workers: Array<{ id: string; name: string; role: string }>;
  cancel: { can: boolean; warnings: string[] };
};

export async function proposalMore(organizationId: string, proposalId: string): Promise<ProposalMore | null> {
  const p = await db.proposal.findFirst({
    where: { id: proposalId, organizationId },
    select: {
      id: true,
      title: true,
      status: true,
      canceledAt: true,
      cancelReason: true,
      callRepFirst: true,
      commissionPct: true,
      ownerId: true,
      projectId: true,
      clientId: true,
      client: { select: { id: true, name: true } },
      project: { select: { id: true, name: true } },
      owner: { select: { id: true, name: true, email: true, phone: true } },
      jobs: { where: { kind: { not: "REPAIR" } }, orderBy: { createdAt: "asc" }, take: 1, select: { id: true, title: true, status: true, assignments: { orderBy: { assignedAt: "asc" }, select: { id: true, workerId: true, pay: true, status: true, worker: { select: { displayName: true } } } } } },
      ...MONEY_SELECT,
    },
  });
  if (!p) return null;
  const m = moneyOf(p);
  const [members, workers, projects, invoices] = await Promise.all([
    db.membership.findMany({ where: { organizationId }, select: { userId: true, role: true, commissionPct: true, user: { select: { name: true, email: true } } } }),
    db.workerProfile.findMany({ where: { organizationId, inviteStatus: { not: "DECLINED" } }, orderBy: { displayName: "asc" }, select: { id: true, userId: true, displayName: true, phone: true } }),
    db.project.findMany({ where: { organizationId, status: { not: "ARCHIVED" } }, orderBy: { updatedAt: "desc" }, take: 40, select: { id: true, name: true, clientId: true } }),
    db.invoice.count({ where: { organizationId, proposalId: p.id, status: INVOICE_OPEN } }),
  ]);
  const roleOf = new Map(members.map((x) => [x.userId, x.role]));
  const ownerMember = members.find((x) => x.userId === p.ownerId);
  const ownerWorker = workers.find((w) => w.userId === p.ownerId);
  const pct = effectivePct(p.commissionPct, ownerMember?.commissionPct);
  const c = commissionOf({ pct, ...m });
  const job = p.jobs[0] ?? null;
  const installDays = job ? await db.jobEvent.count({ where: { jobId: job.id, startsAt: { gte: new Date() } } }) : 0;
  const sold = isSold(p.status) && !p.canceledAt;
  return {
    proposalId: p.id,
    title: p.title,
    status: p.status,
    sold,
    canceled: p.canceledAt ? { at: p.canceledAt.toISOString().slice(0, 10), reason: p.cancelReason } : null,
    client: p.client ? { id: p.client.id, name: p.client.name } : null,
    money: { contract: m.contract, collected: m.collected, left: Math.max(0, Math.round((m.contract - m.collected) * 100) / 100) },
    rep: p.owner
      ? { userId: p.owner.id, name: p.owner.name || p.owner.email || "Someone", phone: ownerWorker?.phone ?? p.owner.phone ?? null, repPct: ownerMember?.commissionPct ?? null, dealPct: p.commissionPct, pct, earned: c.earned, full: c.full }
      : null,
    sellers: members
      .filter((x) => SELLER_ROLES.includes(x.role))
      .map((x) => ({ userId: x.userId, name: x.user.name || x.user.email || "Someone", role: x.role, pct: x.commissionPct }))
      .sort((a, b) => Number(b.role === "SALES") - Number(a.role === "SALES") || a.name.localeCompare(b.name)),
    callRepFirst: p.callRepFirst,
    project: p.project,
    projects: projects.map((x) => ({ id: x.id, name: x.name, clients: !!p.clientId && x.clientId === p.clientId })).sort((a, b) => Number(b.clients) - Number(a.clients)),
    job: job
      ? { id: job.id, title: job.title, status: job.status, crew: job.assignments.map((a) => ({ assignmentId: a.id, workerId: a.workerId, name: a.worker.displayName, pay: a.pay, status: a.status })) }
      : null,
    workers: workers.map((w) => ({ id: w.id, name: w.displayName, role: roleOf.get(w.userId) ?? "INSTALLER" })).sort((a, b) => Number(b.role === "INSTALLER") - Number(a.role === "INSTALLER") || a.name.localeCompare(b.name)),
    cancel: { can: sold, warnings: sold ? cancelWarnings({ collected: m.collected, openInvoices: invoices, installDays, fmt: money }) : [] },
  };
}

/** A member's own percent. Their sold deals with no percent of their own keep the old one first. */
export async function setRepPct(organizationId: string, actorId: string, userId: string, pctIn: number | null): Promise<{ pct: number | null }> {
  await requirePage(organizationId, COMMISSION);
  const pct = cleanPct(pctIn);
  const m = await db.membership.findFirst({ where: { organizationId, userId }, select: { id: true, commissionPct: true, user: { select: { name: true } } } });
  if (!m) throw new Error("Not on this team.");
  if (m.commissionPct != null && m.commissionPct !== pct) {
    await db.proposal.updateMany({ where: { organizationId, ownerId: userId, commissionPct: null, status: { in: ["ACCEPTED", "COMPLETED", "PAID"] } }, data: { commissionPct: m.commissionPct } });
  }
  await db.membership.update({ where: { id: m.id }, data: { commissionPct: pct } });
  await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.SETTINGS, summary: `Set ${m.user.name ?? "a member"}'s sales commission to ${pct ? `${pct}%` : "none"}`, meta: { area: "commission", userId, pct } });
  return { pct };
}

/** This deal's own percent (null = follow the rep's). */
export async function setDealPct(organizationId: string, actorId: string, proposalId: string, pctIn: number | null): Promise<void> {
  await requirePage(organizationId, COMMISSION);
  const pct = cleanPct(pctIn);
  const p = await db.proposal.findFirst({ where: { id: proposalId, organizationId }, select: { id: true, title: true, clientId: true } });
  if (!p) throw new Error("Not found");
  await db.proposal.update({ where: { id: p.id }, data: { commissionPct: pct } });
  await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.ESTIMATE, proposalId: p.id, clientId: p.clientId, summary: `Set the commission on ${p.title} to ${pct ? `${pct}%` : "the rep's own"}` });
}

/** Who sold it (gets the commission, owns the proposal). The deal's own percent goes back to the new rep's. */
export async function setDealRep(organizationId: string, actorId: string, proposalId: string, userId: string): Promise<void> {
  await requirePage(organizationId, COMMISSION);
  const [p, m] = await Promise.all([
    db.proposal.findFirst({ where: { id: proposalId, organizationId }, select: { id: true, title: true, clientId: true } }),
    db.membership.findFirst({ where: { organizationId, userId }, select: { role: true, user: { select: { name: true } } } }),
  ]);
  if (!p) throw new Error("Not found");
  if (!m || !SELLER_ROLES.includes(m.role)) throw new Error("Pick someone on the team who sells.");
  await db.proposal.update({ where: { id: p.id }, data: { ownerId: userId, commissionPct: null } });
  await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.ESTIMATE, proposalId: p.id, clientId: p.clientId, summary: `Credited ${p.title} to ${m.user.name ?? "a member"}` });
}

export async function setCallRepFirst(organizationId: string, actorId: string, proposalId: string, on: boolean): Promise<void> {
  const p = await db.proposal.findFirst({ where: { id: proposalId, organizationId }, select: { id: true, title: true, clientId: true } });
  if (!p) throw new Error("Not found");
  await db.proposal.update({ where: { id: p.id }, data: { callRepFirst: on } });
  await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.ESTIMATE, proposalId: p.id, clientId: p.clientId, summary: `${on ? "The crew calls the rep first on" : "No call-first on"} ${p.title}` });
}

type CancelMeta = { canceled: { status: string; stages: string[]; jobs: string[] } };

/** Cancel a sold job: out of sold work and money to collect. Returns what it did, in words. */
export async function cancelSold(organizationId: string, actorId: string, proposalId: string, reasonIn: string | null): Promise<{ done: string[] }> {
  const p = await db.proposal.findFirst({
    where: { id: proposalId, organizationId },
    select: { id: true, title: true, status: true, canceledAt: true, clientId: true, ...MONEY_SELECT, jobs: { where: { kind: { not: "REPAIR" }, status: { notIn: ["COMPLETED", "CANCELED"] } }, select: { id: true } } },
  });
  if (!p) throw new Error("Not found");
  if (!isSold(p.status) || p.canceledAt) throw new Error("Only a sold job can be cancelled.");
  const reason = cleanReason(reasonIn);
  await expireOpenCheckoutsForProposal(p.id).catch(() => undefined);
  const open = await db.installment.findMany({ where: { proposalId: p.id, status: { in: ["UNPAID", "PENDING"] } }, select: { id: true } });
  const jobIds = p.jobs.map((j) => j.id);
  // The crew on the days still ahead hears it's off — read before the job changes.
  const days = jobIds.length ? await db.jobEvent.findMany({ where: { jobId: { in: jobIds }, startsAt: { gte: new Date() } }, select: { id: true } }) : [];
  const snaps = await Promise.all(days.map((d) => crewOfJobEvent(d.id).catch(() => null)));
  const voided = await db.$transaction(async (tx) => {
    await tx.proposal.update({ where: { id: p.id }, data: { status: "DECLINED", canceledAt: new Date(), cancelReason: reason } });
    if (open.length) await tx.installment.updateMany({ where: { id: { in: open.map((s) => s.id) } }, data: { status: "WAIVED" } });
    if (jobIds.length) await tx.job.updateMany({ where: { id: { in: jobIds } }, data: { status: "CANCELED" } });
    const inv = await tx.invoice.updateMany({ where: { organizationId, proposalId: p.id, status: INVOICE_OPEN }, data: { status: INVOICE_VOID } });
    return inv.count;
  });
  for (const snap of snaps) if (snap) afterResponse(() => textCrewCancelled(snap));
  const meta: CancelMeta = { canceled: { status: p.status, stages: open.map((s) => s.id), jobs: jobIds } };
  await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.ESTIMATE, proposalId: p.id, clientId: p.clientId, summary: `Cancelled the sold job ${p.title}${reason ? ` — ${reason}` : ""}`, meta });
  const m = moneyOf(p);
  const done = ["Cancelled — it no longer counts as sold work or money to collect."];
  if (voided) done.push(`${voided} open invoice${voided === 1 ? "" : "s"} voided.`);
  if (jobIds.length) done.push(`The job is cancelled${snaps.some(Boolean) ? " and the crew was texted" : ""}.`);
  if (m.collected > 0) done.push(`${money(m.collected)} was collected — refund it if it goes back.`);
  return { done };
}

/** Put a cancelled sale back as it was: its status, its open payments, its job. Voided invoices stay void. */
export async function reopenSold(organizationId: string, actorId: string, proposalId: string): Promise<void> {
  const p = await db.proposal.findFirst({ where: { id: proposalId, organizationId }, select: { id: true, title: true, status: true, canceledAt: true, clientId: true } });
  if (!p) throw new Error("Not found");
  if (!p.canceledAt) throw new Error("This job isn't a cancelled sale.");
  const last = await db.activityEvent.findFirst({ where: { organizationId, proposalId: p.id, summary: { startsWith: "Cancelled the sold job" } }, orderBy: { createdAt: "desc" }, select: { meta: true } });
  let meta: CancelMeta["canceled"] = { status: "ACCEPTED", stages: [], jobs: [] };
  try {
    const m = last?.meta ? (JSON.parse(last.meta) as Partial<CancelMeta>) : null;
    if (m?.canceled) meta = { status: isSold(m.canceled.status) ? m.canceled.status : "ACCEPTED", stages: m.canceled.stages ?? [], jobs: m.canceled.jobs ?? [] };
  } catch {
    /* an unreadable trail row: back to ACCEPTED */
  }
  await db.$transaction(async (tx) => {
    await tx.proposal.update({ where: { id: p.id }, data: { status: meta.status, canceledAt: null, cancelReason: null } });
    if (meta.stages.length) await tx.installment.updateMany({ where: { id: { in: meta.stages }, status: "WAIVED" }, data: { status: "UNPAID" } });
    if (meta.jobs.length) await tx.job.updateMany({ where: { id: { in: meta.jobs }, status: "CANCELED" }, data: { status: "SCHEDULED" } });
  });
  await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.ESTIMATE, proposalId: p.id, clientId: p.clientId, summary: `Reopened the sold job ${p.title}` });
}
