// CRM — Blueprint edition. Pixel-identical port of the canonical CRM donor
// (jobflex-crm-blueprint_1.html).
//
// The sidebar, topbar and sprite come from the shared shell mounted in
// ../layout.tsx, so this page renders only the donor's `.content` children.
// Child routes (/customers, /queue, /workflows) live under the (dashboard)
// route group and keep the classic layout.
//
// This page is NOT a fixture. Every number, row and rule below is read from the
// database with the SAME queries the classic CRM pages ran:
//   overview       old-design-pages/dashboard/crm/page.tsx
//   customer book  src/app/(dashboard)/dashboard/crm/customers/page.tsx
//   workflows      src/app/(dashboard)/dashboard/crm/workflows/page.tsx
//   queue          src/app/(dashboard)/dashboard/crm/queue/page.tsx
// The writes go through src/actions/followUps.ts from the behavior module, so
// both editions describe — and mutate — the same records.

import { emailLogoSrc } from "@/lib/orgLogo";
import { SITE_URL } from "@/lib/siteUrl";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { requireOrg, NoOrgError, UnauthorizedError } from "@/lib/orgContext";
import { db } from "@/lib/db";
import { longDate, relative } from "@/lib/format";
import { isTwilioEnabled } from "@/lib/sdk/twilio";
import { parseChannel } from "@/lib/followUps/copy";
import { ensureDefaultFollowUpRules } from "@/lib/followUps/defaults";
import { actorsOf, whoOfEvent } from "@/lib/activityLog";
import { CrmContent } from "@/components/v3/crm-blueprint/crm-content";
import type {
  ActivityItem,
  CrmContentData,
  CrmLead,
  Customer,
  FollowUpRule,
  QueueItem,
} from "@/components/v3/crm-blueprint/crm-data";
import { STATUS_ORDER } from "@/components/v3/crm-blueprint/crm-data";
import { readCrmBrief } from "@/lib/crm/briefServer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "JobFlex · CRM",
  description:
    "CRM — overview, customer book, follow-up workflow rules and the follow-up queue on one sheet.",
};

/** The queue's relative plate reads in BOTH directions ("3d ago" / "in 2 days"),
 *  which `relative()` cannot do — it clamps anything in the future to "just
 *  now". Overdue rows keep `relative()`; scheduled rows get the forward form
 *  the donor wrote ("today", "in 2 days", "in 1 week"). */
function queueRel(runAt: Date, now: Date): string {
  const ms = runAt.getTime() - now.getTime();
  if (ms <= 0) return relative(runAt);
  const days = Math.round(ms / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "in 1 day";
  if (days === 7) return "in 1 week";
  return `in ${days} days`;
}

/** Which of a client's proposals speaks for them in the book. Copied from the
 *  classic customer-book page so both editions rank a customer identically. */
function deriveTopStatus(statuses: string[]): string {
  for (const s of STATUS_ORDER) if (statuses.includes(s)) return s;
  return statuses[0] ?? "DRAFT";
}

export default async function CrmPage() {
  let organizationId: string;
  let userId: string;
  let role: string;
  try {
    const ctx = await requireOrg();
    organizationId = ctx.organizationId;
    userId = ctx.user.id;
    role = ctx.role;
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login?next=%2Fdashboard%2Fcrm");
    if (err instanceof NoOrgError) redirect("/dashboard?error=forbidden");
    throw err;
  }

  // A company from before the starter rules (lib/followUps/defaults) gets them
  // on its first visit here — the Workflows tab is where rules live.
  // Idempotent, and never in the way of the page.
  await ensureDefaultFollowUpRules(organizationId).catch((err) => console.warn("[crm] follow-up defaults:", err));

  const now = new Date();

  // Today's checks and the office figures, read beside the rest.
  const briefP = readCrmBrief({ organizationId, userId, role, now });

  const [
    leads,
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
    // The members, so each activity line can carry its author's mark.
    actorsOf(organizationId),
  ]);

  // ── Queue: the follow-up rows carry only a proposalId, so the client name and
  // the proposal title come from a second lookup — the classic queue page's.
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
      client: p?.client?.name ?? "Unknown client",
      title: p?.title ?? f.note ?? null,
      date: longDate(f.runAt),
      rel: queueRel(f.runAt, now),
      overdue,
      days: overdue ? Math.floor((now.getTime() - f.runAt.getTime()) / 86_400_000) : 0,
      runAt: f.runAt.getTime(),
    };
  });

  const fresh: CrmLead[] = freshLeads.map((l) => ({
    name: l.name,
    project: l.projectType ?? "—",
    status: l.status,
    assignee: l.assignedTo?.name ?? null,
    age: relative(l.createdAt),
  }));

  const activity: ActivityItem[] = activityEvents.map((a) => ({
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

  const data: CrmContentData = {
    stats: {
      won: leads.filter((l) => l.status === "WON").length,
      lost: leads.filter((l) => l.status === "LOST").length,
      active: leads.filter((l) =>
        ["NEW", "ROUTED", "CLAIMED", "CONTACTED", "QUOTED"].includes(l.status),
      ).length,
      conversations,
    },
    fresh,
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
  };

  const brief = await briefP;
  return <CrmContent data={data} brief={brief} />;
}
