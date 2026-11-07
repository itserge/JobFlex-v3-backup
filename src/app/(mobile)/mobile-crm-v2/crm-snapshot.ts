"use server";

// Mobile CRM — the read side.
//
// `MobileCrm` is mounted props-less from two places (the /mobile-crm-v2 page
// and the ≤768px branch of the responsive dashboard shell, which drops the
// server-rendered children), so it cannot be handed server data through props.
// It reads its rows through this action instead.
//
// The queries are the SAME org-scoped ones the desktop CRM sheet already runs
// (src/app/dashboard/crm/page.tsx) — nothing new is asked of the database, and
// nothing here writes. Writes go through the existing actions in
// src/actions/followUps.ts and src/actions/leads.ts.

import { emailLogoSrc } from "@/lib/orgLogo";
import { SITE_URL } from "@/lib/siteUrl";
import { UnauthorizedError, requireOrg, roleMayOpen } from "@/lib/orgContext";
import { db } from "@/lib/db";
import { longDate, relative } from "@/lib/format";
import { isTwilioEnabled } from "@/lib/sdk/twilio";
import { parseChannel } from "@/lib/followUps/copy";
import { actorsOf, whoOfEvent } from "@/lib/activityLog";
import type {
  ActivityItem,
  CrmLead,
  CrmSnapshot,
  Customer,
  FollowUpRule,
  QueueItem,
} from "./crm-data";
import { STATUS_ORDER } from "./crm-data";

export type CrmSnapshotResult =
  | { ok: true; data: CrmSnapshot }
  | { ok: false; error: string };

/** The queue's relative plate reads in BOTH directions ("3d ago" / "in 2
 *  days"), which `relative()` cannot do — it clamps anything in the future to
 *  "just now". Overdue rows keep `relative()`; scheduled rows get the forward
 *  form. Copied from the desktop sheet so both editions read alike. */
function queueRel(runAt: Date, now: Date): string {
  const ms = runAt.getTime() - now.getTime();
  if (ms <= 0) return relative(runAt);
  const days = Math.round(ms / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "in 1 day";
  if (days === 7) return "in 1 week";
  return `in ${days} days`;
}

/** Which of a client's proposals speaks for them in the book. Same ladder the
 *  classic customer-book page uses, so both editions rank a customer alike. */
function deriveTopStatus(statuses: string[]): string {
  for (const s of STATUS_ORDER) if (statuses.includes(s)) return s;
  return statuses[0] ?? "DRAFT";
}

export async function getCrmSnapshot(): Promise<CrmSnapshotResult> {
  let organizationId: string;
  let role: string;
  try {
    ({ organizationId, role } = await requireOrg());
  } catch (err) {
    if (err instanceof UnauthorizedError) return { ok: false, error: "Sign in to see the CRM." };
    return { ok: false, error: "Sign in to an organization to see the CRM." };
  }
  // Leads, clients and their conversations: for whoever may open the CRM
  // (lib/roleRoutes) — a crafted call from another page gets nothing.
  if (!roleMayOpen(role, "/dashboard/crm")) return { ok: false, error: "Your role doesn't include the CRM." };

  const now = new Date();

  const [
    leadRows,
    freshLeads,
    activityEvents,
    conversations,
    clients,
    ruleRows,
    org,
    followUps,
    actors,
  ] = await Promise.all([
    db.lead.findMany({ where: { organizationId }, select: { status: true } }),
    db.lead.findMany({
      where: { organizationId, status: { in: ["NEW", "ROUTED", "CLAIMED"] } },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: { assignedTo: { select: { name: true } } },
    }),
    db.activityEvent.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
    db.conversation.count({ where: { organizationId } }),
    db.client.findMany({
      where: { organizationId },
      include: {
        proposals: { select: { id: true, total: true, status: true, createdAt: true } },
        payments: { where: { status: "PAID" }, select: { amount: true, paidAt: true } },
      },
    }),
    db.followUpRule.findMany({ where: { organizationId }, orderBy: { name: "asc" } }),
    // The preview card renders the contractor's OWN letterhead, so the sender
    // lockup and footer come from the org row rather than a placeholder.
    db.organization.findUnique({
      where: { id: organizationId },
      select: { name: true, phone: true, logoUrl: true },
    }),
    db.followUp.findMany({
      where: { organizationId, completedAt: null },
      orderBy: { runAt: "asc" },
      take: 100,
    }),
    actorsOf(organizationId),
  ]);

  // The follow-up rows carry only a proposalId, so the client name and the
  // proposal title come from a second lookup — the classic queue page's.
  const proposalIds = Array.from(
    new Set(followUps.map((f) => f.proposalId).filter(Boolean) as string[]),
  );
  const proposals = proposalIds.length
    ? await db.proposal.findMany({
        where: { id: { in: proposalIds } },
        select: { id: true, title: true, client: { select: { name: true } } },
      })
    : [];
  const proposalById = new Map(proposals.map((p) => [p.id, p]));

  const queue: QueueItem[] = followUps.map((f) => {
    const p = f.proposalId ? proposalById.get(f.proposalId) : null;
    const overdue = f.runAt <= now;
    return {
      id: f.id,
      proposalId: f.proposalId,
      client: p?.client?.name ?? "Unknown client",
      title: p?.title ?? f.note ?? null,
      date: longDate(f.runAt),
      rel: queueRel(f.runAt, now),
      overdue,
      days: overdue ? Math.floor((now.getTime() - f.runAt.getTime()) / 86_400_000) : 0,
      runAt: f.runAt.getTime(),
    };
  });

  const leads: CrmLead[] = freshLeads.map((l) => ({
    id: l.id,
    name: l.name,
    project: l.projectType ?? "—",
    status: l.status,
    assignee: l.assignedTo?.name ?? null,
    age: relative(l.createdAt),
  }));

  const activity: ActivityItem[] = activityEvents.map((a) => ({
    id: a.id,
    summary: a.summary,
    age: relative(a.createdAt),
    who: whoOfEvent(a, actors),
  }));

  const customers: Customer[] = clients
    .map((c) => {
      const ltv = c.payments.reduce((a, p) => a + p.amount, 0);
      const lastProposalAt = c.proposals.length
        ? c.proposals.reduce(
            (latest, p) => (p.createdAt > latest ? p.createdAt : latest),
            new Date(0),
          )
        : null;
      const lastPaidAt = c.payments.reduce<Date | null>(
        (latest, p) => (p.paidAt && (!latest || p.paidAt > latest) ? p.paidAt : latest),
        null,
      );
      const lastActivity =
        lastPaidAt && lastProposalAt
          ? lastPaidAt > lastProposalAt
            ? lastPaidAt
            : lastProposalAt
          : (lastPaidAt ?? lastProposalAt);
      return {
        id: c.id,
        name: c.name,
        email: c.email ?? "",
        quotes: c.proposals.length,
        quoted: c.proposals.reduce((a, p) => a + p.total, 0),
        ltv,
        last: lastActivity ? relative(lastActivity) : "—",
        top: deriveTopStatus(c.proposals.map((p) => p.status)),
      };
    })
    .filter((c) => c.quotes > 0)
    .sort((a, b) => b.ltv - a.ltv);

  const rules: FollowUpRule[] = ruleRows.map((r) => ({
    id: r.id,
    name: r.name,
    triggerStatus: r.triggerStatus,
    delayMinutes: r.delayMinutes,
    enabled: r.enabled,
    channel: parseChannel(r.template),
    isDefault: r.isDefault,
  }));

  return {
    ok: true,
    data: {
      stats: {
        won: leadRows.filter((l) => l.status === "WON").length,
        lost: leadRows.filter((l) => l.status === "LOST").length,
        active: leadRows.filter((l) =>
          ["NEW", "ROUTED", "CLAIMED", "CONTACTED", "QUOTED"].includes(l.status),
        ).length,
        conversations,
      },
      leads,
      activity,
      customers,
      rules,
      queue,
      org: {
        name: org?.name ?? "Your company",
        phone: org?.phone ?? null,
        // The mail preview draws the logo as the mail links it (lib/orgLogo emailLogoSrc), not the stored data URL.
        logoUrl: emailLogoSrc(org?.logoUrl, organizationId, SITE_URL),
      },
      smsEnabled: await isTwilioEnabled(),
      renderedAt: now.getTime(),
    },
  };
}
