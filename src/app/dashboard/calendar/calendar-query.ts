// Calendar — the org's real calendar, read once and shaped once.
//
// This module used to be the body of ./page.tsx. It was lifted out the day the
// HANDHELD calendar needed the same rows: `ResponsiveDashboardShell` mounts
// `MobileCalendar` PROPS-LESS (and `ssr: false`) at ≤768px on
// /dashboard/calendar, so there is no server render in that path to hand it a
// seed — it has to ask for one through ./calendar-actions.ts. Two editions
// reading two copies of this query is two calendars waiting to disagree, so
// there is one copy and both import it.
//
// Nothing here is new data layer: the where-clauses, the ±400-day window, the
// role scoping and the row shapes are the ones ./page.tsx already ran, which
// were themselves the archived classic page's. `requireOrg()` is called INSIDE
// the builder and the builder takes no arguments, so there is nothing a caller
// (including the server action) could widen.

import {
  requireOrg,
  isWorkerRole,
  isSalesRole,
  isEstimatorRole,
} from "@/lib/orgContext";
import { roleLabel } from "@/lib/prismaEnums";
import { db } from "@/lib/db";
import { countNewForSurface } from "@/lib/badgeCounts";
import { aptSourceKey, bookedLine, parseAptSource, visitVia } from "@/lib/calendar/visitVia";
import { deskHoursKey, expandWindows, parseDeskHours } from "@/lib/deskHours";
import type {
  CalEvent,
  CalKind,
  CalWorker,
  CalendarSeed,
  InboxItem,
  LinkOption,
  TrayJob,
} from "@/components/v3/calendar-blueprint/calendar-data";

// The AI estimate appends an "Assumptions:" block onto Proposal.scopeOfWork when
// it becomes a proposal. On the calendar we want the scope only, so cut from
// that heading onward (verbatim from the archived classic page).
function scopeOnly(scope: string | null | undefined): string | null {
  if (!scope) return null;
  const cut = scope.split(/\n{2,}\s*Assumptions:/i)[0].trim();
  return cut || null;
}

// Compose a one-line client address from the parts we have, or null.
function clientAddr(
  c: { address?: string | null; city?: string | null; state?: string | null } | null | undefined,
): string | null {
  if (!c) return null;
  const line = [c.address, c.city, c.state].filter(Boolean).join(", ").trim();
  return line || null;
}

/** "4h" / "2d" for a tray card. `scheduleJobFromTray` books 9:00–14:00 when the
 *  job carries no span of its own, so that is the honest fallback. */
function durLabel(startsAt: Date | null, endsAt: Date | null): string {
  if (!startsAt || !endsAt) return "5h";
  const h = Math.max(1, Math.round((endsAt.getTime() - startsAt.getTime()) / 3600000));
  return h >= 24 ? Math.round(h / 24) + "d" : h + "h";
}

/**
 * The all-day flag is not a column — it is what a span from midnight to the end
 * of the same-or-a-later day MEANS. Deriving it here is what makes the week
 * grid's all-day band survive a reload: dropping a block into the band writes
 * exactly this span, and reading it back puts the block straight back in the
 * band instead of stretching it down the time grid.
 */
function isAllDay(start: Date, end: Date): boolean {
  const startsAtMidnight = start.getHours() === 0 && start.getMinutes() === 0;
  const endsAtDayEnd = end.getHours() === 23 && end.getMinutes() >= 59;
  return startsAtMidnight && endsAtDayEnd;
}

function money(n: number | null | undefined): string | null {
  if (n == null) return null;
  return "$" + Math.round(n).toLocaleString("en-US");
}

/**
 * The whole calendar for the signed-in org, role-scoped.
 *
 * Throws `UnauthorizedError` / `NoOrgError` out of `requireOrg()` rather than
 * redirecting: a server component wants a redirect, a server action wants a
 * rejection it can surface, and only the caller knows which it is.
 */
export async function buildCalendarSeed(): Promise<CalendarSeed> {
  const { organizationId, role, user } = await requireOrg();
  const userId = user.id;

  // The cursor lives client-side, so the fetch cannot be scoped to the visible
  // month — it must cover everywhere the toolbar can navigate to.
  const from = new Date();
  from.setDate(from.getDate() - 400);
  const to = new Date();
  to.setDate(to.getDate() + 400);

  const worker = isWorkerRole(role);
  const sales = isSalesRole(role);
  const estimator = isEstimatorRole(role);
  // Owner/manager only (2026-08-22, owner rule): estimators used to fall
  // through to the manager calendar and could read EVERY org event,
  // appointment, personal blocked-time, the dispatch tray and the crew inbox —
  // while every write action refused them. Limited roles (installer / sales /
  // estimator) now see only work that names them: assigned, created, or
  // hanging off their own proposal.
  const limited = worker || sales || estimator;
  const canManage = !limited;

  // Mirrors the three create actions' own guards, so the sheet never shows a tab
  // whose submit can only be refused: `createJobEvent` bars SALES + ESTIMATOR,
  // `createAppointment` / `createBlockedTime` bar INSTALLER + ESTIMATOR.
  const createKinds: CalKind[] = [];
  if (!sales && !estimator) createKinds.push("job");
  if (!worker && !estimator) createKinds.push("appointment", "blocked");
  // Hours reserved for the AI desk to book into (lib/deskHours, 2026-10-16): anyone who takes booked visits.
  if (!worker) createKinds.push("desk");

  const self = limited
    ? await db.workerProfile.findUnique({ where: { userId }, select: { id: true } })
    : null;
  const selfWorkerId = self?.id ?? "__none__";

  // ── Role-scoped where-clauses ─────────────────────────────────────────────
  // One rule for every limited role (2026-08-22): an event is yours if you are
  // on its crew, you created it, or it belongs to a job whose proposal you
  // own. Owner/manager read everything. The old shape gave each limited role
  // a slightly different slice (and estimators the whole org).
  const jobEventWhere = limited
    ? {
        organizationId,
        startsAt: { gte: from, lte: to },
        OR: [
          { job: { assignments: { some: { workerId: selfWorkerId } } } },
          { createdById: userId },
          { job: { proposal: { ownerId: userId } } },
        ],
      }
    : { organizationId, startsAt: { gte: from, lte: to } };

  const appointmentWhere = limited
    ? {
        organizationId,
        startsAt: { gte: from, lte: to },
        OR: [{ assignments: { some: { workerId: selfWorkerId } } }, { createdById: userId }],
      }
    : { organizationId, startsAt: { gte: from, lte: to } };

  // Blocked time: managers see the org's; everyone else sees their own plus the
  // org-wide (ownerless) blocks, which is the archived sales branch's scope.
  const blockedWhere = canManage
    ? { organizationId, startsAt: { gte: from, lte: to } }
    : {
        organizationId,
        startsAt: { gte: from, lte: to },
        OR: [{ ownerId: userId }, { ownerId: null }],
      };

  const [events, appointments, blockedTimes, workerProfiles, memberships] = await Promise.all([
    db.jobEvent.findMany({
      where: jobEventWhere,
      orderBy: { startsAt: "asc" },
      include: {
        job: {
          select: {
            status: true,
            client: { select: { name: true, phone: true, address: true, city: true, state: true } },
            proposal: { select: { scopeOfWork: true } },
            assignments: { select: { id: true, workerId: true, status: true } },
          },
        },
      },
    }),
    db.appointment.findMany({
      where: appointmentWhere,
      orderBy: { startsAt: "asc" },
      include: {
        lead: { select: { name: true, projectType: true, phone: true, address: true, city: true, state: true } },
        client: { select: { name: true, phone: true, address: true, city: true, state: true } },
        proposal: { select: { title: true } },
        assignments: { select: { workerId: true } },
        // How the visit was booked (lib/calendar/visitVia): the booking page or
        // the AI desk leave a Booking, a service plan a ServicePlanVisit.
        booking: { select: { serviceLabel: true, notes: true, phone: true, address: true, member: true } },
        planVisit: { select: { label: true, plan: { select: { name: true } } } },
        createdBy: { select: { name: true } },
      },
    }),
    db.blockedTime.findMany({
      where: blockedWhere,
      orderBy: { startsAt: "asc" },
    }),
    db.workerProfile.findMany({
      // Declined invites are excluded everywhere else (plan limits, getTeamBusy)
      // — keep the team rows and the crew picker consistent with that.
      where: { organizationId, inviteStatus: { not: "DECLINED" } },
      select: { id: true, userId: true, displayName: true },
      orderBy: { displayName: "asc" },
    }),
    db.membership.findMany({ where: { organizationId }, select: { userId: true, role: true, user: { select: { name: true, email: true } } } }),
  ]);

  // The hours reserved for the AI desk, and the shop's clock they are written on — beside the picker reads too.
  const deskP = Promise.all([
    db.syncState.findUnique({ where: { key: deskHoursKey(organizationId) }, select: { cursor: true } }),
    db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } }),
  ]).catch(() => [null, null] as const);

  // Who booked each visit — the AI desk and the booking page leave a marker
  // beside the appointment. Started now and awaited after the picker reads, so
  // it rides alongside them instead of adding a round trip.
  const aptMarkers = (
    appointments.length
      ? db.syncState.findMany({ where: { key: { in: appointments.map((a) => aptSourceKey(a.id)) } }, select: { key: true, cursor: true } })
      : Promise.resolve([] as Array<{ key: string; cursor: string }>)
  ).catch(() => [] as Array<{ key: string; cursor: string }>);

  // Dispatch surfaces are manager-only, same as the archived page.
  const [unscheduledJobs, pendingAssignments] = canManage
    ? await Promise.all([
        db.job.findMany({
          where: {
            organizationId,
            status: { in: ["SCHEDULED", "IN_PROGRESS"] },
            events: { none: {} },
          },
          orderBy: { createdAt: "desc" },
          include: {
            client: { select: { name: true, city: true, address: true } },
            proposal: { select: { total: true } },
          },
          take: 30,
        }),
        db.jobAssignment.findMany({
          // ALL response states, not only PENDING (2026-08-22): the crew inbox
          // is the manager's confirmation ledger — it must say who accepted
          // and who declined, not silently drop a row the moment the worker
          // answers. DECLINED especially: a vanished row read as "handled".
          where: { status: { in: ["PENDING", "ACCEPTED", "DECLINED"] }, job: { organizationId } },
          include: {
            worker: { select: { displayName: true } },
            job: { select: { id: true, title: true, startsAt: true } },
          },
          orderBy: { assignedAt: "desc" },
          take: 50,
        }),
      ])
    : [[], []];

  // ── Link picker sources ──────────────────────────────────────────────────
  const [pickerJobs, pickerProposals, pickerLeads, pickerClients] = await Promise.all([
    // A worker may only hang an event off a job they are assigned to; sales get
    // no job picker at all (job events are a delivery concern).
    sales
      ? Promise.resolve([])
      : db.job.findMany({
          where:
            worker || estimator
              ? { organizationId, assignments: { some: { workerId: selfWorkerId } } }
              : { organizationId },
          orderBy: { createdAt: "desc" },
          include: { client: { select: { name: true, city: true } } },
          take: 80,
        }),
    worker
      ? Promise.resolve([])
      : db.proposal.findMany({
          // Estimators share the sales rule: their proposals, not the org's —
          // proposalScope (orgContext) already says so for every other read.
          where: sales || estimator ? { organizationId, ownerId: userId } : { organizationId },
          orderBy: { createdAt: "desc" },
          include: { client: { select: { name: true, city: true } } },
          take: 60,
        }),
    worker
      ? Promise.resolve([])
      : db.lead.findMany({
          where:
            sales || estimator
              ? {
                  organizationId,
                  status: { in: ["NEW", "ROUTED", "CLAIMED", "CONTACTED", "QUOTED"] },
                  OR: [{ assignedToId: userId }, { claimedById: userId }, { status: "NEW" }],
                }
              : {
                  organizationId,
                  status: { in: ["NEW", "ROUTED", "CLAIMED", "CONTACTED", "QUOTED"] },
                },
          orderBy: { createdAt: "desc" },
          select: { id: true, name: true, status: true, projectType: true, city: true },
          take: 60,
        }),
    worker
      ? Promise.resolve([])
      : db.client.findMany({
          where: { organizationId, deletedAt: null },
          orderBy: { updatedAt: "desc" },
          select: { id: true, name: true, address: true, city: true, state: true },
          take: 100,
        }),
  ]);

  // ── Shaping ──────────────────────────────────────────────────────────────
  const roleByUser = new Map(memberships.map((m) => [m.userId, m.role]));
  const workerIdByUserId = new Map(workerProfiles.map((w) => [w.userId, w.id]));

  // Events carry worker IDS, not names — the blueprint resolves the display name
  // through `workersData` at render time, which is also what keeps a rename from
  // needing every event row re-shaped.
  const workers: CalWorker[] = workerProfiles.map((w) => ({
    id: w.id,
    name: w.displayName,
    role: roleLabel(roleByUser.get(w.userId) ?? "INSTALLER"),
    userId: w.userId,
  }));

  const jobEvents: CalEvent[] = events.map((e) => ({
    id: e.id,
    rid: e.id,
    jobId: e.jobId,
    kind: "job" as const,
    title: e.title,
    start: e.startsAt,
    end: e.endsAt,
    status: e.job?.status ?? "SCHEDULED",
    workers: e.job?.assignments.map((a) => a.workerId) ?? [],
    assignmentIds: Object.fromEntries(
      (e.job?.assignments ?? []).map((a) => [a.workerId, a.id]),
    ),
    // Per-worker response state, for the detail sheet's crew chips: has each
    // person actually confirmed this booking, or is the office still waiting?
    assignmentStatus: Object.fromEntries(
      (e.job?.assignments ?? []).map((a) => [a.workerId, a.status]),
    ),
    client: e.job?.client?.name ?? undefined,
    phone: e.job?.client?.phone ?? undefined,
    addr: clientAddr(e.job?.client) ?? undefined,
    scope: scopeOnly(e.job?.proposal?.scopeOfWork) ?? undefined,
    notes: e.notes ?? undefined,
    allDay: isAllDay(e.startsAt, e.endsAt) || undefined,
  }));

  const markerById = new Map((await aptMarkers).map((r) => [r.key.slice(aptSourceKey("").length), parseAptSource(r.cursor)]));
  const appointmentEvents: CalEvent[] = appointments.map((a) => {
    const marker = markerById.get(a.id) ?? null;
    const via = visitVia({ marker, booking: a.booking, planVisit: a.planVisit, notes: a.notes });
    return {
      id: `apt:${a.id}`,
      rid: a.id,
      kind: "appointment" as const,
      title: a.title,
      start: a.startsAt,
      end: a.endsAt,
      status: a.status,
      workers: a.assignments.map((x) => x.workerId),
      client: a.lead?.name ?? a.client?.name ?? a.proposal?.title ?? undefined,
      // A lead's visit used to show no phone and no address: only the client's
      // were read. The booking carries what the caller or the form gave.
      phone: a.client?.phone ?? a.lead?.phone ?? a.booking?.phone ?? undefined,
      addr: clientAddr(a.client) ?? a.booking?.address ?? clientAddr(a.lead) ?? undefined,
      notes: a.notes ?? undefined,
      allDay: isAllDay(a.startsAt, a.endsAt) || undefined,
      via,
      booked: bookedLine(via, { by: a.createdBy?.name ?? null, plan: a.planVisit?.plan.name ?? null, at: marker?.at ? new Date(marker.at) : a.createdAt }),
      visitFor: a.booking?.serviceLabel ?? a.planVisit?.label ?? a.lead?.projectType ?? undefined,
      member: a.booking?.member || undefined,
      leadId: a.leadId ?? undefined,
      clientId: a.clientId ?? undefined,
      callSid: marker?.callSid ?? undefined,
    };
  });

  const blockedEvents: CalEvent[] = blockedTimes.map((b) => {
    // Personal blocks land on their owner's team row; an ownerless (org-wide)
    // block belongs to no row, exactly as in the classic page.
    const ownerWorkerId = b.ownerId ? workerIdByUserId.get(b.ownerId) : undefined;
    return {
      id: `block:${b.id}`,
      rid: b.id,
      kind: "blocked" as const,
      title: b.reason,
      start: b.startsAt,
      end: b.endsAt,
      status: "SCHEDULED",
      workers: ownerWorkerId ? [ownerWorkerId] : [],
      selfOnly: b.ownerId === userId || undefined,
      orgWide: !b.ownerId || undefined,
    };
  });

  const tray: TrayJob[] = unscheduledJobs.map((j) => ({
    id: j.id,
    title: j.title,
    client: j.client?.name ?? "No client",
    city: j.client?.city ?? j.client?.address ?? "—",
    duration: durLabel(j.startsAt, j.endsAt),
  }));

  const inbox: InboxItem[] = pendingAssignments.map((a) => ({
    id: a.id,
    title: a.job.title,
    worker: a.worker.displayName,
    status: (a.status === "ACCEPTED" || a.status === "DECLINED" ? a.status : "PENDING") as
      | "PENDING"
      | "ACCEPTED"
      | "DECLINED",
    when: a.job.startsAt
      ? a.job.startsAt.toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })
      : "Not scheduled",
  }));

  const links: LinkOption[] = [
    ...pickerJobs.map((j) => ({
      id: `job:${j.id}`,
      rid: j.id,
      kind: "job" as const,
      title: j.title,
      client: j.client?.name ?? "No client",
      status: j.status.toLowerCase(),
      meta: [j.client?.city, durLabel(j.startsAt, j.endsAt)].filter(Boolean).join(" · "),
    })),
    ...pickerProposals.map((p) => ({
      id: `prop:${p.id}`,
      rid: p.id,
      kind: "proposal" as const,
      title: p.title,
      client: p.client?.name ?? "No client",
      status: p.status.toLowerCase(),
      meta: [p.client?.city, money(p.total)].filter(Boolean).join(" · "),
    })),
    ...pickerLeads.map((l) => ({
      id: `lead:${l.id}`,
      rid: l.id,
      kind: "lead" as const,
      title: l.name,
      client: l.name,
      status: l.status.toLowerCase(),
      meta: [l.city, l.projectType].filter(Boolean).join(" · ") || "Lead",
    })),
    ...pickerClients.map((c) => ({
      id: `client:${c.id}`,
      rid: c.id,
      kind: "client" as const,
      title: c.name,
      client: c.name,
      status: "active",
      meta: clientAddr(c) ?? "Client",
    })),
  ];

  // Crew answers the office hasn't seen: seen-stamped per user when the inbox
  // sheet opens (markNavSeen("crewInbox")), counted the same way the nav
  // badges are. Owner request 2026-08-22: a decline must register on the bell
  // even after the pending count drops to zero.
  let inboxUnseen = 0;
  if (canManage) {
    const seen = await db.navSeen.findUnique({
      where: { userId_organizationId_key: { userId, organizationId, key: "crewInbox" } },
      select: { seenAt: true },
    });
    inboxUnseen = await countNewForSurface("crewInbox", organizationId, seen?.seenAt, userId);
  }

  // Reserved hours as events (2026-10-16): from today to six months ahead, each on its person's row — a weekly
  // reservation is not drawn on the weeks before it was made. A limited
  // role sees their own and the company's; a manager everyone's.
  const [deskRow, deskOrg] = await deskP;
  const deskHours = parseDeskHours(deskRow?.cursor);
  const deskTz = deskOrg?.timezone || "America/New_York";
  const nameByUser = new Map(memberships.map((m) => [m.userId, m.user?.name || m.user?.email || "Team member"]));
  const deskEvents: CalEvent[] = expandWindows(
    deskHours.windows.filter((w) => canManage || !w.userId || w.userId === userId),
    new Date(),
    183,
    deskTz,
  ).map((sp) => {
    const wid = sp.userId ? workerIdByUserId.get(sp.userId) : undefined;
    return {
      id: `desk:${sp.windowId}:${sp.startsAt.getTime()}`,
      rid: sp.windowId,
      kind: "desk" as const,
      title: `AI desk hours · ${sp.userId ? nameByUser.get(sp.userId) ?? "Former team member" : "anyone"}`,
      start: sp.startsAt,
      end: sp.endsAt,
      status: "SCHEDULED",
      workers: wid ? [wid] : [],
      deskUserId: sp.userId ?? undefined,
      deskWeekly: sp.weekly || undefined,
    };
  });
  // Who hours can be reserved for from the calendar: a manager picks anyone who takes visits; others reserve their own.
  const deskPeople = canManage
    ? memberships.filter((m) => !isWorkerRole(m.role)).map((m) => ({ userId: m.userId, name: nameByUser.get(m.userId) ?? "Team member" }))
    : [{ userId, name: nameByUser.get(userId) ?? "Me" }];

  return {
    today: new Date().toISOString(),
    events: [...jobEvents, ...appointmentEvents, ...blockedEvents, ...deskEvents],
    desk: { mode: deskHours.mode, timeZone: deskTz, me: userId, people: deskPeople },
    workers,
    tray,
    inbox,
    inboxUnseen,
    links,
    createKinds,
    canManage,
    canSmartBook: canManage || sales,
  };
}
