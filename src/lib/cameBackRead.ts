import "server-only";
// WHO CAME BACK — the read behind the "Came back" card on /admin/cancellations (2026-10-28). Every card-less trial
// record (SyncState cardlessTrial:<org>, lib/trialState), every cancellation booked from the Subscription page, the
// companies behind them with their subscription row today, and the win-back mails sent to the restarted ones; then
// lib/cameBack shapes it. Read-only.
import { db } from "@/lib/db";
import { cardlessKey, type CardlessRecord } from "@/lib/trialState";
import { readWinbacks } from "@/lib/trialWinback";
import { shapeCameBack, type CameBack, type CameBackCancel, type CameBackCardless, type CameBackOrg, type CameBackWinback } from "@/lib/cameBack";

const ms = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};
const PREFIX = cardlessKey("");

export async function readCameBack(now = Date.now()): Promise<CameBack> {
  const [cardRows, cancelRows] = await Promise.all([
    db.syncState.findMany({ where: { key: { startsWith: PREFIX } }, select: { key: true, cursor: true } }).catch(() => [] as Array<{ key: string; cursor: string }>),
    // The table is not in every database yet (prisma/sql/prod-2026-10-20-…): no rows, no cancellations.
    db.cancellationFeedback
      .findMany({ orderBy: { createdAt: "desc" }, take: 500, select: { id: true, organizationId: true, createdAt: true, periodEnd: true } })
      .catch(() => [] as Array<{ id: string; organizationId: string; createdAt: Date; periodEnd: Date | null }>),
  ]);
  const cardless: CameBackCardless[] = [];
  for (const r of cardRows) {
    try {
      const rec = JSON.parse(r.cursor) as CardlessRecord;
      if (!rec?.subId) continue;
      cardless.push({ orgId: r.key.slice(PREFIX.length), startedAt: ms(rec.startedAt), endsAt: ms(rec.endsAt), endedAt: ms(rec.endedAt), cardAt: ms(rec.cardAt), restartedAt: ms(rec.restartedAt), test: rec.mode === "test" });
    } catch {
      /* a malformed record reads as none */
    }
  }
  const cancels: CameBackCancel[] = cancelRows.map((c) => ({ id: c.id, orgId: c.organizationId, createdAt: c.createdAt.getTime(), periodEnd: c.periodEnd?.getTime() ?? null }));
  const ids = [...new Set([...cardless.filter((c) => c.restartedAt !== null || c.endedAt !== null).map((c) => c.orgId), ...cancels.map((c) => c.orgId)])];
  const orgRows = ids.length
    ? await db.organization.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          name: true,
          createdAt: true,
          subscription: { select: { plan: true, status: true, trialEndsAt: true, currentPeriodEnd: true } },
          memberships: { where: { role: "OWNER" }, take: 1, select: { user: { select: { email: true } } } },
        },
      })
    : [];
  const orgs: CameBackOrg[] = orgRows.map((o) => ({
    id: o.id,
    name: o.name,
    email: o.memberships[0]?.user?.email ?? "",
    createdAt: o.createdAt.getTime(),
    plan: o.subscription?.plan ?? "",
    status: o.subscription?.status ?? "",
    trialEndsAt: o.subscription?.trialEndsAt?.getTime() ?? null,
    currentPeriodEnd: o.subscription?.currentPeriodEnd?.getTime() ?? null,
  }));
  const restartedIds = cardless.filter((c) => c.restartedAt !== null).map((c) => c.orgId);
  const winbackMap = await readWinbacks(restartedIds).catch(() => new Map());
  const winbacks: CameBackWinback[] = [...winbackMap.entries()].map(([orgId, rec]) => ({
    orgId,
    mails: Object.values(rec.sent).filter((at) => typeof at === "string" && !at.startsWith("skipped:")).length,
    offerSentAt: ms(rec.offerSentAt ?? rec.sent.offer),
  }));
  return shapeCameBack({ now, orgs, cardless, cancels, winbacks });
}
