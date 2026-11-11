// A PROPOSAL'S PLACE IN THE WAREHOUSE (2026-09-20) — server module.
//
// Owner: proposals connected to the inventory show the list of materials
// to pick up, the worker's job carries the same list, and the connection
// can be made or broken at any time. One answer for every page that asks:
//   linkedTradeOf   the trade a proposal draws stock from — none when it is
//                   an estimate only (Proposal.inventoryLinked false) or
//                   belongs to no trade (lib/inventoryTrade);
//   pickForProposal the crew's list against that trade's shelf.

import { db } from "@/lib/db";
import { pickList, type PickRow, type TradeId } from "@/lib/inventory";
import { explodeLines } from "@/lib/inventoryBom";
import { savedTakeoffsFor } from "@/lib/fence/savedTakeoffServer";
import { stockItemsOf } from "@/lib/inventoryPolicy";
import { proposalTrade } from "@/lib/inventoryTrade";

// The choice itself is an ActivityEvent (kind INVENTORY_LINK, meta {linked}),
// the latest one per proposal, so it needs no schema change: production
// deploys stopped pushing the schema (vercel.json, 2026-09-20) and a new
// column would have to be pushed by hand before it could be read.
export const INVENTORY_LINK_EVENT = "INVENTORY_LINK";

/** The explicit choice per proposal: true, false, or absent when never chosen. */
export async function inventoryLinkOf(organizationId: string, proposalIds: readonly string[]): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>();
  if (!proposalIds.length) return out;
  const events = await db.activityEvent.findMany({
    where: { organizationId, kind: INVENTORY_LINK_EVENT, proposalId: { in: [...proposalIds] } },
    orderBy: { createdAt: "desc" },
    select: { proposalId: true, meta: true },
  });
  for (const e of events) {
    if (!e.proposalId || out.has(e.proposalId)) continue; // newest first: the first seen wins
    try {
      const meta = JSON.parse(e.meta ?? "{}") as { linked?: boolean };
      if (typeof meta.linked === "boolean") out.set(e.proposalId, meta.linked);
    } catch {
      /* an unreadable event decides nothing */
    }
  }
  return out;
}

/** Record the choice for a proposal. Null means "the company's default" and records nothing. */
export async function recordInventoryLink(organizationId: string, proposalId: string, linked: boolean | null | undefined, actorId?: string | null): Promise<void> {
  if (linked == null) return;
  await db.activityEvent.create({
    data: { organizationId, actorId: actorId ?? null, proposalId, kind: INVENTORY_LINK_EVENT, summary: linked ? "Connected to the inventory" : "Estimate only — not connected to the inventory", meta: JSON.stringify({ linked }) },
  });
}

export type LinkedProposal = {
  /** When known, the fence studio's kept material list is read for it (lib/fence/savedTakeoff). */
  id?: string;
  trade: string | null;
  inventoryLinked: boolean | null;
  title: string;
  description?: string | null;
  lineItems: ReadonlyArray<{ name: string; quantity: number; measurementType: string }>;
};

export function linkedTradeOf(p: LinkedProposal): TradeId | null {
  if (p.inventoryLinked === false) return null;
  return proposalTrade({ trade: p.trade, title: p.title, description: p.description, lines: p.lineItems.map((l) => ({ name: l.name, quantity: l.quantity, unit: l.measurementType })) });
}

/** What to take from the warehouse for a proposal; empty when it is an estimate only. */
export async function pickForProposal(organizationId: string, p: LinkedProposal): Promise<{ trade: TradeId | null; rows: PickRow[] }> {
  const trade = linkedTradeOf(p);
  if (!trade || !p.lineItems.length) return { trade, rows: [] };
  // The stock policy rides along: a per-job item reads "ordered for this job", not "short".
  const items = await stockItemsOf(organizationId, trade);
  const saved = trade === "fence" && p.id ? (await savedTakeoffsFor(organizationId, [p.id])).get(p.id) : null;
  return { trade, rows: pickList(items, explodeLines(trade, p.lineItems.map((l) => ({ name: l.name, quantity: l.quantity, unit: l.measurementType.toLowerCase().replace("_", " ") })), saved)) };
}
