import "server-only";
// A PROPOSAL'S PRICES AT A MOMENT — sent, accepted, marked by hand, edited. One
// PricingSnapshot row per moment, so a later edit never rewrites what the client
// was shown. Moved out of actions/proposals (2026-11-04) so the send core
// (lib/proposals/sendCore) and the actions share one writer.
import { db } from "@/lib/db";

export type SnapshotReason = "manual" | "sent" | "accepted" | "edited";

export async function snapshotProposal(proposalId: string, reason: SnapshotReason): Promise<void> {
  const p = await db.proposal.findUnique({
    where: { id: proposalId },
    include: { lineItems: { orderBy: { position: "asc" } } },
  });
  if (!p) return;
  await db.pricingSnapshot.create({
    data: {
      proposalId: p.id,
      organizationId: p.organizationId,
      reason,
      subtotal: p.subtotal,
      discountTotal: p.discountTotal,
      taxRate: p.taxRate,
      taxTotal: p.taxTotal,
      total: p.total,
      currency: p.currency,
      lineItemsJson: JSON.stringify(
        p.lineItems.map((l) => ({
          name: l.name,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          total: l.total,
          measurementType: l.measurementType,
        })),
      ),
    },
  });
}
