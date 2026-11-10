// Admin · Users & subscriptions — Blueprint edition.
//
// Database control over every account and the org Subscription record. The
// admin layout mounts the blueprint shell; this page renders only the
// `.content` children through components/v3/admin-users.
//
// The strip and the table come from ONE read (getAdminUsersData) so they
// describe the same set: subscription state merged from live Stripe when
// Stripe answers, from the platform's own rows otherwise.

import type { Metadata } from "next";
import { requirePlatformAdmin } from "@/lib/orgContext";
import { db } from "@/lib/db";
import { getAdminUsersData } from "@/actions/adminUsers";
import { parseReasons, reasonLabel } from "@/lib/cancelFeedback";
import { answersBrief, parseCancelAnswers } from "@/lib/cancelTree";
import { AdminUsersContent, type AdminUserDTO } from "@/components/v3/admin-users/admin-users-content";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "JobFlex Admin · Users",
  description: "Accounts, organizations and subscriptions.",
};

export default async function AdminUsersPage() {
  const me = await requirePlatformAdmin();

  const [data, plans, internalOrgs, lastCancels] = await Promise.all([
    getAdminUsersData(),
    db.pricingPlan.findMany({ orderBy: { order: "asc" }, select: { slug: true, name: true } }),
    // JobFlex's own organizations (Lead Center test leads go only to these).
    db.organization.findMany({ where: { isInternal: true }, select: { id: true } }),
    // The latest cancellation's reasons per organization (2026-10-20); none
    // while the table is not in this database yet.
    db.cancellationFeedback
      .findMany({ orderBy: { createdAt: "desc" }, distinct: ["organizationId"], select: { organizationId: true, reasons: true, otherText: true, path: true, answersJson: true, createdAt: true } })
      .catch(() => [] as { organizationId: string; reasons: string; otherText: string | null; path: string | null; answersJson: string | null; createdAt: Date }[]),
  ]);
  const internal = new Set(internalOrgs.map((o) => o.id));
  const lastCancel = new Map(lastCancels.map((c) => [c.organizationId, c]));

  const rows: AdminUserDTO[] = data.rows.map((u) => ({
    ...u,
    currentPeriodEnd: u.currentPeriodEnd?.toISOString() ?? null,
    trialEndsAt: u.trialEndsAt?.toISOString() ?? null,
    canceledAt: u.canceledAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
    orgInternal: u.orgId ? internal.has(u.orgId) : false,
    lastCancel: (() => {
      const c = u.orgId ? lastCancel.get(u.orgId) : undefined;
      if (!c) return null;
      // The question tree (2026-11-09, lib/cancelTree): the path and two lines of its answer.
      const tree = parseCancelAnswers(c.answersJson);
      return { at: c.createdAt.toISOString(), reasons: parseReasons(c.reasons).map(reasonLabel), otherText: c.otherText, path: tree?.path ?? null, brief: tree ? answersBrief(tree) : null };
    })(),
  }));

  return (
    <AdminUsersContent
      users={rows}
      plans={plans}
      summary={data.summary}
      source={data.source}
      meId={me.id}
    />
  );
}
