"use server";
import { db } from "@/lib/db";
import { requireManager, requireOrg, requireRouteAccess } from "@/lib/orgContext";
import { SEEN_SURFACES, countNewForSurface, type SeenKey } from "@/lib/badgeCounts";
import { allowsInApp, loadPrefs, prefKeyForEvent } from "@/lib/notificationPrefs";
import { ActivityKind } from "@/lib/prismaEnums";
import { TRAIL_ONLY, actorsOf, whoOfEvent } from "@/lib/activityLog";
import type { WhoLike } from "@/lib/team/who";
import { isEmailEnabled, sendEmail } from "@/lib/sdk/resend";
import { renderEmail } from "@/lib/email/renderEmail";
import { buildTestEmail } from "@/lib/email/build/platform";

/**
 * Stamp a nav surface as seen for the current user — clears its badge until
 * newer items arrive. Called from <MarkNavSeen /> on each surface's page.
 * This is the only badge mutation that's a real action (the counting lives in
 * src/lib/badgeCounts.ts, deliberately outside "use server"). The key arrives
 * over the action wire, so it's validated at runtime, not just by the type.
 *
 * Returns whether a badge was actually showing (items newer than the previous
 * stamp) so the caller can skip its router.refresh() — a full server re-render
 * of layout + page — on the common badge-less visit.
 */
export async function markNavSeen(key: SeenKey): Promise<{ hadNew: boolean }> {
  if (!(key in SEEN_SURFACES)) return { hadNew: false };
  const { organizationId, user } = await requireOrg();
  const prev = await db.navSeen.findUnique({
    where: { userId_organizationId_key: { userId: user.id, organizationId, key } },
    select: { seenAt: true },
  });
  const hadNew =
    (await countNewForSurface(key, organizationId, prev?.seenAt, user.id)) > 0 ||
    // The calendar's badge carries the online bookings too (badgeCounts → getBadgeCounts).
    (key === "calendar" && (await countNewForSurface("booking", organizationId, prev?.seenAt)) > 0);
  await db.navSeen.upsert({
    where: { userId_organizationId_key: { userId: user.id, organizationId, key } },
    create: { userId: user.id, organizationId, key },
    update: { seenAt: new Date() },
  });
  return { hadNew };
}

export interface NotificationItem {
  id: string;
  kind: string;
  summary: string;
  createdAt: Date;
  href: string | null;
  /** The member who did it (name, role, color — lib/team/who); the client for
   *  a portal click; null when the system did it or the row is a worker's own
   *  schedule, and the panel draws no mark. */
  actor: WhoLike | null;
}

/** Resolve the best in-app destination for an activity row. */
function hrefFor(e: {
  kind?: string;
  meta?: string | null;
  proposalId: string | null;
  clientId: string | null;
  leadId: string | null;
}): string | null {
  // The crew on site (2026-09-27): a start, a day back, a completion or
  // photos from the field open the job itself.
  if (e.kind && /^(STARTED|MEDIA|COMPLETED|JOB)$/.test(e.kind) && e.meta) {
    try {
      const jobId = (JSON.parse(e.meta) as { jobId?: string }).jobId;
      if (typeof jobId === "string" && jobId) return `/dashboard/jobs/${jobId}`;
    } catch {
      /* fall through to the row's own links */
    }
  }
  // A stock notice, a purchase order (2026-09-20), a service-plan notice
  // (2026-09-22), a deck design a client sent back (2026-10-11, the draft
  // it landed in) or a room design a client approved (2026-10-19, the design
  // in the studio) names its own page in meta.
  if (e.kind && /^(STOCK_|PURCHASE_ORDER_|PLAN_|SMS_|EXPENSE_SUBMITTED|DECK_DESIGN_RETURNED|DESIGN_CLIENT_|FINANCING_)/.test(e.kind) && e.meta) {
    try {
      const href = (JSON.parse(e.meta) as { href?: string }).href;
      if (href) return href;
    } catch {
      /* fall through to the row's own links */
    }
  }
  if (e.proposalId) return `/dashboard/proposals/${e.proposalId}`;
  if (e.leadId) return `/dashboard/leads/${e.leadId}`;
  if (e.clientId) return `/dashboard/clients/${e.clientId}`;
  return null;
}

/**
 * The bell feed for whoever is asking.
 *
 * A MANAGER gets the org's activity stream (below). A WORKER gets their OWN
 * schedule — the jobs and appointments they have been put on — because
 * `recentNotifications` is requireManager()-gated and an installer calling it
 * receives an error, not an empty list. That is why a worker had no in-app
 * notification surface at all: not an empty bell, an unreachable one.
 *
 * Derived from the assignment rows themselves rather than a Notification
 * table, which does not exist. `assignedAt` is when the office put them on the
 * work, so it is the honest timestamp for "you were scheduled".
 */
export async function notificationFeed(): Promise<NotificationItem[]> {
  const { organizationId, user, role } = await requireOrg();
  const limited = role === "INSTALLER";
  if (!limited) return recentNotifications();

  const profile = await db.workerProfile.findFirst({
    where: { userId: user.id, organizationId },
    select: { id: true },
  });
  if (!profile) return [];

  const [jobs, appts] = await Promise.all([
    db.jobAssignment.findMany({
      where: { workerId: profile.id, job: { organizationId } },
      orderBy: { assignedAt: "desc" },
      take: 12,
      select: {
        id: true,
        status: true,
        assignedAt: true,
        job: { select: { id: true, title: true, startsAt: true } },
      },
    }),
    db.appointmentAssignment.findMany({
      where: { workerId: profile.id, appointment: { organizationId } },
      orderBy: { appointment: { startsAt: "desc" } },
      take: 12,
      select: {
        id: true,
        appointment: { select: { id: true, title: true, startsAt: true } },
      },
    }),
  ]);

  const when = (d: Date | null) =>
    d
      ? d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
      : "a date to be confirmed";

  const items: NotificationItem[] = [
    ...jobs.map((a) => ({
      id: a.id,
      kind: a.status === "PENDING" ? "ASSIGNED" : `ASSIGNMENT_${a.status}`,
      summary:
        a.status === "PENDING"
          ? `You're scheduled: "${a.job.title}" — ${when(a.job.startsAt)}. Awaiting your answer.`
          : `"${a.job.title}" — ${when(a.job.startsAt)}`,
      createdAt: a.assignedAt,
      // A PENDING row IS the ask — land on the jobs page with the offers
      // popup already open (?offers=1), so the bell click reaches Accept /
      // Decline directly. Answered rows go to the job record.
      href: a.status === "PENDING" ? "/dashboard/jobs?offers=1" : `/dashboard/jobs/${a.job.id}`,
      actor: null,
    })),
    ...appts.map((a) => ({
      id: a.id,
      kind: "APPOINTMENT",
      summary: `You're on "${a.appointment.title}" — ${when(a.appointment.startsAt)}`,
      // Appointments carry no assignedAt of their own; the booking time is the
      // only timestamp there is, and it is what the worker cares about anyway.
      createdAt: a.appointment.startsAt ?? new Date(0),
      href: "/dashboard/calendar",
      actor: null,
    })),
  ];

  return items
    .sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime())
    .slice(0, 12);
}

/**
 * Recent org activity, surfaced as the navbar bell feed. Read-only over
 * ActivityEvent — there is no dedicated Notification model.
 */
export async function recentNotifications(): Promise<NotificationItem[]> {
  const { organizationId, user } = await requireManager();
  const [events, prefs, actors] = await Promise.all([
    db.activityEvent.findMany({
      // The trail's own kinds (an expense, a photo, a stock count…) stay on
      // the Overview and the job page; the bell is for what needs the office.
      where: { organizationId, kind: { notIn: [...TRAIL_ONLY] } },
      orderBy: { createdAt: "desc" },
      take: 40,
      select: {
        id: true,
        kind: true,
        summary: true,
        meta: true,
        actorId: true,
        createdAt: true,
        proposalId: true,
        clientId: true,
        leadId: true,
      },
    }),
    loadPrefs(user.id),
    actorsOf(organizationId),
  ]);

  // The caller's own matrix decides what the bell shows. A TEST row is only
  // ever for the person who pressed the button.
  return events
    .filter((e) =>
      e.kind === ActivityKind.TEST ? e.actorId === user.id : allowsInApp(prefs, prefKeyForEvent(e)),
    )
    .slice(0, 12)
    .map((e) => ({
      id: e.id,
      kind: e.kind,
      summary: e.summary,
      createdAt: e.createdAt,
      href: hrefFor(e),
      actor: whoOfEvent(e, actors),
    }));
}

export type TestNotificationResult = {
  inApp: boolean;
  email: "sent" | "off" | "disabled" | "no-address";
};

/**
 * Settings → "Send test notification". Writes a TEST activity that only this
 * user's bell shows, and mails them if any Email cell is on — so the button
 * proves the settings as saved.
 */
export async function sendTestNotification(): Promise<TestNotificationResult> {
  const { organizationId, user } = await requireRouteAccess("/dashboard/settings");
  const [org, prefs] = await Promise.all([
    db.organization.findUnique({ where: { id: organizationId }, select: { name: true, logoUrl: true } }),
    loadPrefs(user.id),
  ]);
  await db.activityEvent.create({
    data: {
      organizationId,
      actorId: user.id,
      kind: ActivityKind.TEST,
      summary: "Test notification — your settings are working.",
    },
  });
  const anyEmailOn = Object.values(prefs.matrix).some((cells) => cells[1]);
  if (!anyEmailOn) return { inApp: true, email: "off" };
  if (!isEmailEnabled()) return { inApp: true, email: "disabled" };
  if (!user.email) return { inApp: true, email: "no-address" };
  const { subject, html } = renderEmail(buildTestEmail({ org: { id: organizationId, name: org?.name ?? "JobFlex", logoUrl: org?.logoUrl ?? null } }));
  await sendEmail({ to: user.email, subject, html }).catch(() => null);
  return { inApp: true, email: "sent" };
}
