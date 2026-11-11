"use server";

// THE INVENTORY LINK (2026-09-20). Owner: "some bigger contractors keep the
// inventory and some just do the estimate and order everything on their own
// … make the visual option: connect to the inventory or not, make it smart
// … any time I can connect it and disconnect it."
//
//   inventoryLinkDefault     what the choice should start as: connected when
//                            the company keeps stock for the trade (any stock
//                            at all when the trade is not known yet);
//   setProposalInventoryLink connect or disconnect a proposal, any time;
//   proposalPickList         the proposal's materials to pick up, against
//                            the shelf, for the builder's Warehouse card.
// Estimators and managers write; anyone in the organization reads.

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { INVENTORY_PATH, isTradeId, type TradeId } from "@/lib/inventory";
import { inventoryLinkOf, pickForProposal, recordInventoryLink } from "@/lib/inventoryPick";
import { stockPolicyOf } from "@/lib/inventoryPolicy";
import { NoOrgError, requireEstimatorOrManager, requireProposalStaff, UnauthorizedError } from "@/lib/orgContext";

type Fail = { ok: false; error: string };
const fail = (err: unknown): Fail =>
  err instanceof UnauthorizedError ? { ok: false, error: "Estimator or manager access required" } : err instanceof NoOrgError ? { ok: false, error: "No organization" } : { ok: false, error: err instanceof Error ? err.message : "Could not save" };

// Each trade's inventory under its estimator (2026-10-10).
const BOARDS: Record<TradeId, string> = INVENTORY_PATH;

export async function inventoryLinkDefault(trade?: string | null): Promise<{ linked: boolean; items: number; /** Of those, bought per job (lib/inventoryPolicy); 0 when the trade is not known. */ perJob: number }> {
  try {
    // Read from the proposal builders: proposal staff, never the crew.
    const { organizationId } = await requireProposalStaff();
    const rows = await db.inventoryItem.findMany({ where: { organizationId, ...(isTradeId(trade) ? { trade } : {}) }, select: { key: true } });
    const policy = isTradeId(trade) ? await stockPolicyOf(organizationId, trade) : null;
    return { linked: rows.length > 0, items: rows.length, perJob: policy ? rows.filter((r) => policy.perJob.has(r.key)).length : 0 };
  } catch {
    return { linked: false, items: 0, perJob: 0 };
  }
}

export async function setProposalInventoryLink(input: { proposalId: string; linked: boolean; trade?: string | null }): Promise<{ ok: true; linked: boolean } | Fail> {
  try {
    const { organizationId, user } = await requireEstimatorOrManager();
    const p = await db.proposal.findFirst({ where: { id: input.proposalId, organizationId }, select: { id: true, trade: true } });
    if (!p) return { ok: false, error: "Proposal not found" };
    const trade = isTradeId(input.trade) ? input.trade : null;
    await recordInventoryLink(organizationId, p.id, input.linked, user.id);
    if (trade && !p.trade) await db.proposal.update({ where: { id: p.id }, data: { trade } });
    for (const t of Object.keys(BOARDS) as TradeId[]) revalidatePath(BOARDS[t]);
    revalidatePath("/dashboard/manual-blueprint");
    revalidatePath("/dashboard/jobs");
    return { ok: true, linked: input.linked };
  } catch (err) {
    return fail(err);
  }
}

export type PickLine = { name: string; unit: string; quantity: number; tracked: boolean; onHand: number | null; enough: boolean; /** Bought per job — "buy for this job", not "short". */ perJob: boolean };

export async function proposalPickList(proposalId: string): Promise<{ ok: true; linked: boolean; trade: TradeId | null; explicit: boolean | null; rows: PickLine[] } | Fail> {
  try {
    // A proposal's pick list: proposal staff, a rep only on their own proposal.
    const { organizationId, proposalScope } = await requireProposalStaff();
    const p = await db.proposal.findFirst({
      where: { id: proposalId, organizationId, ...proposalScope },
      select: { title: true, description: true, trade: true, lineItems: { where: { materialCost: { gt: 0 } }, select: { name: true, quantity: true, measurementType: true } } },
    });
    if (!p) return { ok: false, error: "Proposal not found" };
    const explicit = (await inventoryLinkOf(organizationId, [proposalId])).get(proposalId) ?? null;
    const { trade, rows } = await pickForProposal(organizationId, { ...p, id: proposalId, inventoryLinked: explicit });
    return { ok: true, linked: !!trade, trade, explicit, rows: rows.map((r) => ({ name: r.name, unit: r.unit, quantity: r.quantity, tracked: !!r.itemId, onHand: r.onHand, enough: r.enough, perJob: r.perJob })) };
  } catch (err) {
    return fail(err);
  }
}
