import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isCronAuthorized } from "@/lib/cronAuth";
import { lowStockCounts } from "@/lib/inventoryBoard";
import { inventoryHref, isTradeId, pickList } from "@/lib/inventory";
import { explodeLines } from "@/lib/inventoryBom";
import { savedTakeoffsFor } from "@/lib/fence/savedTakeoffServer";
import { stockItemsOf } from "@/lib/inventoryPolicy";

export const runtime = "nodejs";

// THE DAILY STOCK CHECK (2026-09-20). Two looks at every company's warehouse,
// each becoming a bell notification (an ActivityEvent the feed already reads):
//   STOCK_LOW        — a trade board has items low for the next job.
//   STOCK_SHORT_JOB  — a job starting within two days needs more than the
//                      shelf holds, or has per-job materials not bought yet
//                      (lib/inventoryPolicy). Said once per job.
// Fail-closed cron auth, like the other cron routes. Never throws past one
// company: a bad org is logged and the rest still run.
// Each trade's stock tab, under its estimator (2026-10-10).
const BOARD: Record<string, string> = { fence: inventoryHref("fence", "stock"), roof: inventoryHref("roof", "stock"), hvac: inventoryHref("hvac", "stock"), deck: inventoryHref("deck", "stock") };
const LABEL: Record<string, string> = { fence: "Fence", roof: "Roofing", hvac: "HVAC", deck: "Deck" };

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000);
  const soon = new Date(Date.now() + 2 * 24 * 3600 * 1000);
  const orgs = await db.inventoryItem.findMany({ distinct: ["organizationId"], select: { organizationId: true } });
  let lowNotices = 0;
  let jobNotices = 0;
  for (const { organizationId } of orgs) {
    try {
      // 1) Low stock per board, once a day.
      const low = await lowStockCounts(organizationId);
      for (const trade of ["fence", "roof", "hvac", "deck"] as const) {
        if (!low[trade]) continue;
        const said = await db.activityEvent.findFirst({ where: { organizationId, kind: "STOCK_LOW", createdAt: { gte: dayAgo }, meta: { contains: `"trade":"${trade}"` } }, select: { id: true } });
        if (said) continue;
        await db.activityEvent.create({
          data: { organizationId, kind: "STOCK_LOW", summary: `${LABEL[trade]} stock: ${low[trade]} item${low[trade] === 1 ? " is" : "s are"} low for the next job — the purchase order is ready on the ${LABEL[trade]} board`, meta: JSON.stringify({ trade, href: BOARD[trade], count: low[trade] }) },
        });
        lowNotices++;
      }
      // 2) Jobs starting within two days whose pick list is short on the shelf.
      const jobs = await db.job.findMany({
        where: { organizationId, materialsLoadedAt: null, startsAt: { gte: new Date(), lte: soon }, proposal: { trade: { in: ["fence", "roof", "hvac", "deck"] } } },
        select: { id: true, title: true, startsAt: true, proposal: { select: { id: true, trade: true, lineItems: { where: { materialCost: { gt: 0 } }, select: { name: true, quantity: true, measurementType: true } } } } },
      });
      // The fence studio's kept material lists (lib/fence/savedTakeoff), one read for the whole batch.
      const kept = await savedTakeoffsFor(organizationId, jobs.filter((j) => j.proposal?.trade === "fence").map((j) => j.proposal?.id));
      for (const job of jobs) {
        const trade = job.proposal?.trade;
        if (!isTradeId(trade) || !job.proposal) continue;
        const items = await stockItemsOf(organizationId, trade);
        const pick = pickList(items, explodeLines(trade, job.proposal.lineItems.map((l) => ({ name: l.name, quantity: l.quantity, unit: l.measurementType })), kept.get(job.proposal.id))).filter((r) => r.itemId && !r.enough);
        const short = pick.filter((r) => !r.perJob);
        const toBuy = pick.filter((r) => r.perJob);
        if (!short.length && !toBuy.length) continue;
        const said = await db.activityEvent.findFirst({ where: { organizationId, kind: "STOCK_SHORT_JOB", meta: { contains: `"jobId":"${job.id}"` } }, select: { id: true } });
        if (said) continue;
        await db.activityEvent.create({
          data: {
            organizationId,
            kind: "STOCK_SHORT_JOB",
            summary: `${job.title} starts ${job.startsAt?.toLocaleDateString("en-US", { month: "short", day: "numeric" }) ?? "soon"}${short.length ? ` and the warehouse is short: ${short.map((s) => `${s.name} (${s.quantity} needed, ${s.onHand} there)`).join(", ")}` : ""}${toBuy.length ? `${short.length ? ";" : " and"} still to buy for the job: ${toBuy.map((s) => `${s.name} (${s.quantity})`).join(", ")}` : ""}`,
            meta: JSON.stringify({ jobId: job.id, trade, href: `/dashboard/jobs/${job.id}` }),
          },
        });
        jobNotices++;
      }
    } catch (err) {
      console.error(`[stock-check] org ${organizationId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return NextResponse.json({ ok: true, orgs: orgs.length, lowNotices, jobNotices });
}
