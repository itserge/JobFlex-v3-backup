// Admin · Support — Blueprint edition.
//
// The triage queue for every ticket any org has filed. The admin layout mounts
// the blueprint shell; this page renders only the `.content` children through
// components/v3/admin-support.
//
// It was classic Tailwind cards inside the blueprint chrome — a mismatch that
// predated the shell. Same data, same reads, same mark-as-read: only the
// presentation and the filters are new.

import type { Metadata } from "next";
import { requirePlatformAdmin } from "@/lib/orgContext";
import { db } from "@/lib/db";
import { supportTicketRef } from "@/lib/notify";
import {
  AdminSupportContent,
  type SupportTicketDTO,
} from "@/components/v3/admin-support/admin-support-content";
import { tasksForTicketsSafe } from "@/lib/adminTasks/service";
import { recipientsForTickets, threadsFor } from "@/lib/supportThread";
import { readSupportAiMode, supportAiForTickets } from "@/lib/support/aiSupport";
import { extensionOfferFact } from "@/lib/support/aiReply";
import { supportRecipients } from "@/lib/notify";
import { listSmartHelp } from "@/lib/smarthelp/server";
import { SmartHelpAdmin, SupportViewTabs } from "@/components/v3/admin-support/smarthelp-admin";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "JobFlex Admin · Support",
  description: "Every support ticket raised across the platform, and its status.",
};

export default async function AdminSupportPage({
  searchParams,
}: {
  searchParams: Promise<{ ticket?: string | string[]; view?: string | string[] }>;
}) {
  const admin = await requirePlatformAdmin();
  // The name a reply is signed with (replyToSupportTicket), so the box can say so.
  const signer = (admin as { name?: string | null }).name?.trim() || "JobFlex support";
  // ?ticket=<id> opens that ticket — the link a task made from it carries.
  const sp = await searchParams;
  const openTicketId = typeof sp.ticket === "string" ? sp.ticket : null;

  // ?view=smarthelp: what contractors ask SmartHelp (2026-10-30). Its own reads only — none of the tickets'.
  if (sp.view === "smarthelp") {
    const { questions, guides } = await listSmartHelp();
    return (
      <>
        <SupportViewTabs view="smarthelp" />
        <SmartHelpAdmin questions={questions} guides={guides} now={new Date().toISOString()} />
      </>
    );
  }

  const [rows, open, inProgress, resolved, closed, unread] = await Promise.all([
    db.supportTicket.findMany({
      // The conversation's latest message first: a customer's reply lifts its ticket to the top.
      orderBy: { lastMessageAt: "desc" },
      take: 100,
      include: {
        organization: { select: { name: true, billingEmail: true } },
        user: { select: { email: true, name: true } },
      },
    }),
    db.supportTicket.count({ where: { status: "OPEN" } }),
    db.supportTicket.count({ where: { status: "IN_PROGRESS" } }),
    db.supportTicket.count({ where: { status: "RESOLVED" } }),
    db.supportTicket.count({ where: { status: "CLOSED" } }),
    db.supportTicket.count({ where: { adminReadAt: null } }),
  ]);

  // The task made from each ticket, if any (/admin/tasks, "Create task").
  // Without the task tables the tickets show as before and "Create task" hides.
  const { available: tasksAvailable, tasks } = await tasksForTicketsSafe(rows.map((t) => t.id));
  // Each ticket's conversation, and where the team's messages are emailed (lib/supportThread).
  const [threads, recipients] = await Promise.all([threadsFor(rows.map((t) => t.id)), recipientsForTickets(rows)]);
  // The support AI (2026-10-15): what it did on each ticket, its switch, and the inbox it copies.
  const [aiRecords, aiMode, aiCopyTo] = await Promise.all([
    supportAiForTickets(rows.map((t) => t.id)),
    readSupportAiMode(),
    supportRecipients().catch(() => [] as string[]),
  ]);

  // Can the team add trial days for the ticket's company? (the AI's cancellation offer, and the button on the ticket)
  const orgIds = [...new Set(rows.map((t) => t.organizationId))];
  const [subs, pendingReqs] = await Promise.all([
    db.subscription.findMany({ where: { organizationId: { in: orgIds } }, select: { organizationId: true, status: true, trialEndsAt: true, provider: true, plan: true } }).catch(() => []),
    db.trialExtensionRequest.findMany({ where: { organizationId: { in: orgIds }, status: "PENDING" }, select: { organizationId: true, requestedDays: true } }).catch(() => []),
  ]);
  const subOf = new Map(subs.map((x) => [x.organizationId, x]));
  const pendingOf = new Map(pendingReqs.map((x) => [x.organizationId, x.requestedDays]));
  const offerFor = (organizationId: string) => {
    const sub = subOf.get(organizationId) ?? null;
    const pending = pendingOf.get(organizationId) ?? null;
    const o = extensionOfferFact(sub, pending !== null ? { days: pending } : null);
    return { eligible: o.eligible, pendingDays: pending, trialEndsAt: sub?.trialEndsAt ? sub.trialEndsAt.toISOString() : null };
  };

  const tickets: SupportTicketDTO[] = rows.map((t) => ({
    trialOffer: offerFor(t.organizationId),
    id: t.id,
    ref: supportTicketRef(t.id),
    subject: t.subject,
    body: t.body,
    category: t.category,
    priority: t.priority,
    status: t.status,
    orgName: t.organization.name,
    submitterEmail: t.user?.email ?? null,
    submitterName: t.user?.name?.trim() || null,
    createdAt: t.createdAt.toISOString(),
    lastMessageAt: t.lastMessageAt.toISOString(),
    unread: t.adminReadAt === null,
    task: tasks[t.id] ?? null,
    messages: threads[t.id] ?? [],
    to: recipients[t.id] ?? null,
    ai: aiRecords[t.id] ?? null,
  }));

  return (
    <>
      <SupportViewTabs view="tickets" />
      {/* Unread is per ticket since the conversation (2026-10-17): opening a
          ticket reads it, and a customer's next message makes it unread again. */}
      <AdminSupportContent
        tickets={tickets}
        counts={{ open, inProgress, resolved, closed }}
        unread={unread}
        initialTicketId={openTicketId}
        tasksAvailable={tasksAvailable}
        signer={signer}
        aiMode={aiMode}
        aiCopyTo={aiCopyTo}
        // One clock, read on the server, so every age renders identically here
        // and after hydration.
        now={new Date().toISOString()}
      />
    </>
  );
}
