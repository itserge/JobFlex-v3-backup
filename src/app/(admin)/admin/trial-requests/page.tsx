// Admin · Trial requests (owner, 2026-10-20) — the owners who asked for more
// trial days from the cancel questions (lib/trialExtension, lib/cancelTree). A table, newest first;
// a row opens the request with what the company did during its trial and the
// two decisions, Approve 7/14 days and Deny with a reason
// (actions/trialExtension). ?request=<id> opens one — the admins' email links there.

import type { Metadata } from "next";
import { requirePlatformAdmin } from "@/lib/orgContext";
import { db } from "@/lib/db";
import { getPlanNamesBySlug } from "@/lib/planCatalogServer";
import { planDisplayName } from "@/lib/planCatalog";
import { AdminTrialRequestsContent, type TrialRequestDTO } from "@/components/v3/admin-trial-requests/trial-requests-content";
import { BLOCKERS, TRY_TOOLS, parseA1 } from "@/lib/cancelTree";

/** Asked from the cancel questions (2026-11-09): screen B1 in words. */
function a1View(json: string | null): { inTheWay: string; tryFirst: string } | null {
  const a = parseA1(json);
  if (!a) return null;
  return {
    inTheWay: a.blockers.map((k) => (k === "other" && a.blockerOther ? `Other: “${a.blockerOther}”` : (BLOCKERS.find((b) => b.key === k)?.label ?? k))).join(" · "),
    tryFirst: a.tryFirst.map((k) => TRY_TOOLS.find((t) => t.key === k)?.short ?? k).join(" · "),
  };
}

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "JobFlex Admin · Trial requests",
  description: "Owners asking for more trial days, and the decisions on them.",
};

export default async function AdminTrialRequestsPage({ searchParams }: { searchParams: Promise<{ request?: string | string[] }> }) {
  await requirePlatformAdmin();
  const sp = await searchParams;
  const openId = typeof sp.request === "string" ? sp.request : null;

  const [rows, names] = await Promise.all([
    db.trialExtensionRequest
      .findMany({
        orderBy: { createdAt: "desc" },
        take: 300,
        include: {
          organization: {
            select: {
              name: true,
              subscription: { select: { plan: true, status: true, trialEndsAt: true, currentPeriodEnd: true, provider: true, externalSubId: true } },
              memberships: { where: { role: "OWNER" }, orderBy: { createdAt: "asc" }, take: 1, select: { user: { select: { email: true } } } },
            },
          },
          user: { select: { email: true, name: true } },
          decider: { select: { email: true, name: true } },
        },
      })
      // The table is not in this database yet (prisma/sql/prod-2026-10-20-…).
      .catch(() => null),
    getPlanNamesBySlug().catch(() => ({})),
  ]);

  const dto: TrialRequestDTO[] | null = rows
    ? rows.map((r) => {
        const sub = r.organization.subscription;
        return {
          id: r.id,
          organizationId: r.organizationId,
          orgName: r.organization.name,
          ownerEmail: r.user?.email ?? r.organization.memberships[0]?.user.email ?? "—",
          ownerName: r.user?.name ?? null,
          planName: planDisplayName(r.plan ?? sub?.plan ?? "", names),
          subStatus: sub?.status ?? null,
          stripe: Boolean(sub?.provider === "STRIPE" && sub.externalSubId),
          trialStartedAt: r.trialStartedAt?.toISOString() ?? null,
          trialEndsAt: r.trialEndsAt?.toISOString() ?? null,
          currentTrialEndsAt: sub?.trialEndsAt?.toISOString() ?? null,
          currentPeriodEnd: sub?.currentPeriodEnd?.toISOString() ?? null,
          requestedDays: r.requestedDays,
          note: r.note,
          answers: a1View(r.answersJson),
          status: r.status,
          grantedDays: r.grantedDays,
          extendedUntil: r.extendedUntil?.toISOString() ?? null,
          localOnly: r.localOnly,
          decisionNote: r.decisionNote,
          decidedBy: r.decider?.name || r.decider?.email || null,
          decidedAt: r.decidedAt?.toISOString() ?? null,
          createdAt: r.createdAt.toISOString(),
        };
      })
    : null;

  return <AdminTrialRequestsContent rows={dto} openId={openId} />;
}
