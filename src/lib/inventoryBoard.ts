// THE TRADE BOARD'S READ (2026-09-20) — server only, one query set per trade.
//
// The fence, roof and HVAC boards show the same three things for their own
// trade: the proposals that belong to it, the warehouse stock with the work
// counted against it (lib/inventory), and the suppliers. Nothing here is a
// "use server" action: the pages call it with a trusted organizationId.

// Every proposal that belongs to the trade (2026-09-20, later that day): the
// owner wants each estimator's proposals on its board whether or not they
// were made after Proposal.trade existed. An unstamped proposal is read by
// lib/inventoryTrade — its estimator record, its materials, its title — and
// every status but ARCHIVED is listed; only sold-and-not-loaded work reserves
// the shelf and only open work forecasts it, as before.

// What the company keeps in stock (2026-09-23, lib/inventoryPolicy): items
// bought per job are never low or short here; the sold jobs' per-job
// materials come back as `buy`, the shopping list per job, and `catalog` is
// the checklist — every standard item and every item on the list with its
// kept-in-stock / bought-per-job choice — the board's "What we stock" editor.

import { db } from "@/lib/db";
import { isStocked, isTradeId, jobBuyList, stockKey, stockRows, untrackedLines, type BuyJob, type StockItem, type StockLine, type StockRow, type TradeId } from "@/lib/inventory";
import { presetItems } from "@/lib/inventoryPresets";
import { explodeLines } from "@/lib/inventoryBom";
import type { SavedFenceTakeoff } from "@/lib/fence/savedTakeoff";
import { savedTakeoffsFor } from "@/lib/fence/savedTakeoffServer";
import { itemCategory } from "@/lib/inventoryCategories";
import { proposalTrade } from "@/lib/inventoryTrade";
import { inventoryLinkOf } from "@/lib/inventoryPick";
import { stockPolicyOf, withPolicy } from "@/lib/inventoryPolicy";
import { defaultStocked, type StockChoice } from "@/lib/inventoryStockDefaults";

export type BoardProposal = {
  id: string;
  title: string;
  client: string | null;
  status: string;
  total: number;
  createdAt: string;
  /** The job made from it, when one exists, and whether its truck is loaded. */
  jobId: string | null;
  loaded: boolean;
  jobStartsAt: string | null;
  /** Recognized by its estimator record, its materials or its title — it carries no trade stamp. */
  inferred: boolean;
  /** Draws on the warehouse. False = an estimate only: listed, never reserved or forecast. */
  linked: boolean;
  lines: StockLine[];
};

export type BoardSupplier = { id: string; name: string; email: string | null; phone: string | null; website: string | null; itemCount: number };

export type BoardOrder = {
  id: string;
  supplier: string;
  supplierId: string | null;
  sentAt: string;
  /** Ordered for one job's per-job materials, when it was. */
  jobId: string | null;
  lines: Array<{ id?: string; name: string; quantity: number }>;
};

/** A sold job still to load, on the per-job shopping list. */
export type BoardBuyJob = BuyJob<{ id: string; jobId: string | null; title: string; client: string | null; startsAt: string | null; lines: StockLine[] }>;

export type TradeBoardData = {
  trade: TradeId;
  /** Purchase orders emailed and not yet received. */
  orders: BoardOrder[];
  proposals: BoardProposal[];
  rows: StockRow[];
  suppliers: BoardSupplier[];
  /** Material lines on this trade's proposals the warehouse does not track yet. */
  untracked: StockLine[];
  /** The estimator's standard items not on the shelf list yet, and how many there are in all. */
  presets: { missing: number; total: number };
  /** The "What we stock" checklist: every standard item and every item on the list, with its choice. */
  catalog: StockChoice[];
  /** The company's choice for the trade — ever saved, when, and the counts on the list. */
  policy: { decided: boolean; decidedAt: string | null; stocked: number; perJob: number };
  /** The per-job shopping list: sold jobs still to load and the per-job materials each needs. */
  buy: BoardBuyJob[];
  pipeline: { open: number; openTotal: number; sold: number; soldTotal: number; low: number; short: number };
};

const OPEN = ["DRAFT", "SENT", "VIEWED"];
const ALL_TRADES: readonly TradeId[] = ["fence", "roof", "hvac", "deck"];

/**
 * The organization's proposals that belong to the wanted trades, each with
 * the trade it belongs to. Stamped proposals are taken as stamped; unstamped
 * ones are read by lib/inventoryTrade, with the HVAC estimates and roof
 * measurement photos that point at them fetched as evidence.
 */
async function tradeProposals(organizationId: string, wanted: readonly TradeId[]) {
  const rows = await db.proposal.findMany({
    where: { organizationId, status: { not: "ARCHIVED" }, OR: [{ trade: { in: [...wanted] } }, { trade: null }] },
    orderBy: { createdAt: "desc" },
    take: 500,
    select: {
      id: true,
      title: true,
      description: true,
      trade: true,
      status: true,
      total: true,
      createdAt: true,
      client: { select: { name: true } },
      jobs: { select: { id: true, materialsLoadedAt: true, status: true, startsAt: true }, take: 1, orderBy: { createdAt: "desc" } },
      lineItems: { where: { materialCost: { gt: 0 } }, select: { name: true, quantity: true, measurementType: true } },
    },
  });
  const unstamped = rows.filter((r) => !r.trade).map((r) => r.id);
  const none: Array<{ proposalId: string | null }> = [];
  const [hvacLinks, roofLinks] = unstamped.length
    ? await Promise.all([
        wanted.includes("hvac") ? db.hvacEstimate.findMany({ where: { organizationId, proposalId: { in: unstamped } }, select: { proposalId: true } }) : Promise.resolve(none),
        wanted.includes("roof") ? db.proposalSitePhoto.findMany({ where: { proposalId: { in: unstamped } }, select: { proposalId: true } }) : Promise.resolve(none),
      ])
    : [none, none];
  const hvac = new Set(hvacLinks.map((h) => h.proposalId));
  const roof = new Set(roofLinks.map((r) => r.proposalId));
  // The connect-or-not choice, an event per proposal; absent = connected.
  const links = await inventoryLinkOf(organizationId, rows.map((r) => r.id));
  // The fence studio's kept material lists (lib/fence/savedTakeoff): the pick list while the proposal still fits it.
  const kept = wanted.includes("fence") ? await savedTakeoffsFor(organizationId, rows.map((r) => r.id)) : new Map<string, SavedFenceTakeoff>();
  const out: Array<{ row: (typeof rows)[number]; trade: TradeId; inferred: boolean; linked: boolean; saved: SavedFenceTakeoff | null }> = [];
  for (const r of rows) {
    const t = proposalTrade({
      trade: r.trade,
      title: r.title,
      description: r.description,
      lines: r.lineItems.map((l) => ({ name: l.name, quantity: l.quantity, unit: l.measurementType })),
      hvacEstimate: hvac.has(r.id),
      roofMeasurement: roof.has(r.id),
    });
    if (t && wanted.includes(t)) out.push({ row: r, trade: t, inferred: !r.trade, linked: links.get(r.id) !== false, saved: kept.get(r.id) ?? null });
  }
  return out;
}

export async function loadTradeBoard(organizationId: string, trade: string): Promise<TradeBoardData | null> {
  if (!isTradeId(trade)) return null;
  const [proposals, items, suppliers, sent, policy] = await Promise.all([
    tradeProposals(organizationId, [trade]),
    db.inventoryItem.findMany({ where: { organizationId, trade }, orderBy: { name: "asc" }, include: { supplier: { select: { name: true } } } }),
    db.supplier.findMany({ where: { organizationId }, orderBy: { name: "asc" }, include: { _count: { select: { items: true } } } }),
    db.activityEvent.findMany({ where: { organizationId, kind: "PURCHASE_ORDER_SENT", meta: { contains: `"trade":"${trade}"` } }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, createdAt: true, meta: true } }),
    stockPolicyOf(organizationId, trade),
  ]);
  const orders: BoardOrder[] = sent
    .map((e) => {
      const meta = JSON.parse(e.meta ?? "{}") as { supplierId?: string; jobId?: string; receivedAt?: string; lines?: Array<{ id?: string; name: string; quantity: number }> };
      if (meta.receivedAt) return null;
      return { id: e.id, supplier: suppliers.find((s) => s.id === meta.supplierId)?.name ?? "Supplier", supplierId: meta.supplierId ?? null, sentAt: e.createdAt.toISOString(), jobId: meta.jobId ?? null, lines: meta.lines ?? [] };
    })
    .filter((o): o is BoardOrder => !!o);
  const list: BoardProposal[] = proposals.map(({ row: p, inferred, linked, saved }) => ({
    id: p.id,
    title: p.title,
    client: p.client?.name ?? null,
    status: p.status,
    total: p.total,
    createdAt: p.createdAt.toISOString(),
    jobId: p.jobs[0]?.id ?? null,
    loaded: !!p.jobs[0]?.materialsLoadedAt,
    jobStartsAt: p.jobs[0]?.startsAt ? p.jobs[0].startsAt.toISOString() : null,
    inferred,
    linked,
    // A fence package line becomes the posts, rails and pickets it was priced from.
    lines: explodeLines(trade, p.lineItems.map((l) => ({ name: l.name, quantity: l.quantity, unit: l.measurementType })), saved),
  }));
  const stock: StockItem[] = withPolicy(items, policy);
  // Sold work still to load reserves the shelf; open work is the forecast.
  // Only work that draws on the warehouse reserves or forecasts the shelf.
  const sold = list.filter((p) => p.linked && p.status === "ACCEPTED" && !p.loaded);
  const open = list.filter((p) => p.linked && OPEN.includes(p.status));
  const rows = stockRows(stock, sold, open);
  const untracked = untrackedLines(stock, [...sold, ...open].flatMap((p) => p.lines));
  const byKey = new Map(stock.map((i) => [i.key, i]));
  const standard = presetItems(trade);
  const presets = { missing: standard.filter((p) => !byKey.has(stockKey(p.name))).length, total: standard.length };
  // The checklist: the standard items first (an item already on the list
  // keeps its own name, unit and choice), then whatever else is on the list.
  const catalog: StockChoice[] = [];
  const seen = new Set<string>();
  for (const p of standard) {
    const key = stockKey(p.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const have = byKey.get(key);
    const name = have?.name ?? p.name;
    const suggested = defaultStocked(trade, name);
    catalog.push({ key, name, unit: have?.unit ?? p.unit, isNew: !have, stocked: have ? isStocked(have) : suggested, suggested, category: itemCategory(trade, name) });
  }
  for (const i of stock) {
    if (seen.has(i.key)) continue;
    seen.add(i.key);
    catalog.push({ key: i.key, name: i.name, unit: i.unit, isNew: false, stocked: isStocked(i), suggested: defaultStocked(trade, i.name), category: itemCategory(trade, i.name) });
  }
  catalog.sort((a, b) => a.name.localeCompare(b.name));
  const perJobCount = stock.filter((i) => !isStocked(i)).length;
  // The per-job shopping list: the sold jobs still to load, soonest first.
  const buy = jobBuyList(stock, sold.map((p) => ({ id: p.id, jobId: p.jobId, title: p.title, client: p.client, startsAt: p.jobStartsAt, lines: p.lines })));
  return {
    trade,
    orders,
    proposals: list,
    rows,
    suppliers: suppliers.map((s) => ({ id: s.id, name: s.name, email: s.email, phone: s.phone, website: s.website, itemCount: s._count.items })),
    untracked,
    presets,
    catalog,
    policy: { decided: !!policy.decidedAt, decidedAt: policy.decidedAt, stocked: stock.length - perJobCount, perJob: perJobCount },
    buy,
    pipeline: {
      open: open.length,
      openTotal: open.reduce((a, p) => a + p.total, 0),
      sold: sold.length,
      soldTotal: sold.reduce((a, p) => a + p.total, 0),
      low: rows.filter((r) => r.low).length,
      short: rows.filter((r) => r.short > 0).length,
    },
  };
}

/** How many items are low per trade — the sidebar's badge on each board. */
export async function lowStockCounts(organizationId: string): Promise<Record<TradeId, number>> {
  const out: Record<TradeId, number> = { fence: 0, roof: 0, hvac: 0, deck: 0 };
  const items = await db.inventoryItem.findMany({ where: { organizationId }, select: { id: true, trade: true, key: true, name: true, unit: true, onHand: true, reorderPoint: true, supplierId: true } });
  if (!items.length) return out;
  const proposals = await tradeProposals(organizationId, ALL_TRADES);
  for (const trade of ALL_TRADES) {
    const ofTradeItems = items.filter((i) => i.trade === trade);
    if (!ofTradeItems.length) continue;
    // An item bought per job is never low (lib/inventory stockRows).
    const stock = withPolicy(ofTradeItems, await stockPolicyOf(organizationId, trade));
    const ofTrade = proposals.filter((p) => p.trade === trade && p.linked);
    const sold = ofTrade.filter((p) => p.row.status === "ACCEPTED" && !p.row.jobs[0]?.materialsLoadedAt).map((p) => ({ lines: explodeLines(trade, p.row.lineItems, p.saved) }));
    const open = ofTrade.filter((p) => OPEN.includes(p.row.status)).map((p) => ({ lines: explodeLines(trade, p.row.lineItems, p.saved) }));
    out[trade] = stockRows(stock, sold, open).filter((r) => r.low).length;
  }
  return out;
}
