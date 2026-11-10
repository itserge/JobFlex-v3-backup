// Workers roster — Blueprint edition. Pixel-identical port of the canonical
// workers donor (jobflex-workers-blueprint.html).
//
// The sidebar, topbar and sprite come from the shared shell mounted in
// ../layout.tsx, so this page renders only the donor's `.content` children.
// The child route (/[id]) stays under the (dashboard) route group with the
// classic layout; the classic index page is archived at
// old-design-pages/dashboard/workers/page.tsx.
//
// Unlike its sibling blueprint pages, this one is NOT a fixture: the roster is
// read from the database here and the dialogs call the real worker server
// actions (see workers-behavior.ts). The query is the archived classic page's —
// same joins, same ordering, same role-by-membership map — so both editions
// describe the same roster.

import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { requireOrg, NoOrgError, UnauthorizedError } from "@/lib/orgContext";
import { db } from "@/lib/db";
import { MarkNavSeen } from "@/components/layout/MarkNavSeen";
import { WorkersContent } from "@/components/v3/workers-blueprint/workers-content";
import { lastActiveLabel, laterOf, type InviteStatus, type WorkerEntry } from "@/components/v3/workers-blueprint/workers-data";
import { crewComebackStats } from "@/lib/repairs/server";
import { customPageGate } from "@/components/v3/upgrade-gate/custom-page-gate";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "JobFlex · Workers",
  description: "Workers — crew roster, invite status and the worker inspector on one sheet.",
};

/** `WorkerProfile.specialties` is a JSON string column. */
function parseSpec(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** The roster's `joined` column is a short "Mar 2024" plate, not a full date. */
function joinedLabel(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

export default async function WorkersPage() {
  const gate = await customPageGate("workers");
  if (gate) return gate;
  let organizationId: string;
  try {
    const ctx = await requireOrg();
    organizationId = ctx.organizationId;
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login?next=%2Fdashboard%2Fworkers");
    if (err instanceof NoOrgError) redirect("/dashboard?error=forbidden");
    throw err;
  }

  const workers = await db.workerProfile.findMany({
    where: { organizationId },
    orderBy: { displayName: "asc" },
    include: {
      user: { select: { email: true } },
      // Every assignment: the active ones list as jobs, all of them carry the
      // pay that the earnings columns add up (2026-09-20).
      assignments: {
        select: { pay: true, paidAt: true, job: { select: { id: true, title: true, status: true } } },
      },
    },
  });

  // Membership carries the role (INSTALLER/SALES/ESTIMATOR/MANAGER/…); map it in
  // by user so the roster shows each member's role.
  const memberships = await db.membership.findMany({
    where: { organizationId },
    select: { userId: true, role: true },
  });
  const roleByUser = new Map(memberships.map((m) => [m.userId, m.role]));

  // LAST ACTIVE (2026-09-24): the newest thing each member did in the app
  // (their latest ActivityEvent), or the portal's own lastSeenAt — whichever
  // is later. Best effort: a roster never fails on its trail.
  const lastEventByUser = new Map<string, Date>();
  try {
    const rows = await db.activityEvent.groupBy({
      by: ["actorId"],
      where: { organizationId, actorId: { not: null } },
      _max: { createdAt: true },
    });
    for (const r of rows) if (r.actorId && r._max.createdAt) lastEventByUser.set(r.actorId, r._max.createdAt);
  } catch {
    /* no trail, no plate */
  }

  // Come-backs per person (2026-11-09) — best effort: the roster never fails on its counts.
  const comebacks = await crewComebackStats(organizationId).catch(() => new Map<string, { comebacks: number; cost: number; sentOn: number }>());

  const entries: WorkerEntry[] = workers.map((w) => ({
    id: w.id,
    name: w.displayName,
    email: w.user?.email ?? null,
    phone: w.phone,
    sms: w.smsOptIn,
    specialties: parseSpec(w.specialties),
    rate: w.hourlyRate,
    token: w.token,
    invite: w.inviteStatus as InviteStatus,
    role: roleByUser.get(w.userId) ?? "INSTALLER",
    joined: joinedLabel(w.createdAt),
    lastActive: lastActiveLabel(laterOf(w.lastSeenAt, lastEventByUser.get(w.userId))),
    jobs: w.assignments.filter((a) => a.job.status === "SCHEDULED" || a.job.status === "IN_PROGRESS").map((a) => ({ id: a.job.id, title: a.job.title })),
    earned: Math.round(w.assignments.reduce((sum, a) => sum + a.pay, 0) * 100) / 100,
    unpaid: Math.round(w.assignments.filter((a) => !a.paidAt).reduce((sum, a) => sum + a.pay, 0) * 100) / 100,
    comebacks: (() => {
      const c = comebacks.get(w.id);
      return c ? { count: c.comebacks, cost: c.cost, sentOn: c.sentOn } : { count: 0, cost: 0, sentOn: 0 };
    })(),
  }));

  return (
    <>
      {/* Clears the workers nav badge (crew invites answered) on open.
          Desktop edition only — the handheld build is stamped by the
          responsive shell (HANDHELD_SEEN). */}
      <MarkNavSeen surface="workers" />
      <WorkersContent entries={entries} />
    </>
  );
}
