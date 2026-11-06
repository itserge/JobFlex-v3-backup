import "server-only";
// A PRICED DECK → A DRAFT PROPOSAL, WITHOUT A SESSION (2026-11-05). The Deck Studio's own writer, moved out of
// actions/deckEstimator (a "use server" file, where every export is a public action) so the JobFlex Assistant can
// file a deck it designed from a text (lib/assistant/build) the same way: the priced lines at the studio's selling
// prices, the state's tax, the 30/70 stages, the member discount, and the deck itself (design + frozen 3D) kept
// beside it as DECK_PLAN for the client's page. The callers keep their own gates and pass where it files.
import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { checkPlanLimit } from "@/lib/limitsEngine";
import { ProposalStatus } from "@/lib/prismaEnums";
import { filedClientId, leadProposalText, type FilingContext } from "@/lib/filingContext";
import { stateFromAddress, stateTaxRate } from "@/lib/pricing/salesTax";
import { applyMemberDiscount } from "@/lib/servicePlanBook";
import { recordInventoryLink } from "@/lib/inventoryPick";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { DECK_PLAN_EVENT, DECK_PLAN_VERSION, type DeckConvertInput } from "@/lib/deck/convertSchema";
import type { DeckWritten } from "@/lib/deck/proposalEdit";
import { clientOfLink, tieClientLinkToProposal } from "@/lib/deck/clientLinksServer";
import { findClientForLead } from "@/lib/leadClient";
import { isPrivateFileUnder } from "@/lib/media/privateStore";

/** The shop's own photo: a private file whose path BEGINS with its folder
 *  (never "contains" — a query string could carry the folder name past a
 *  substring test, security audit 1.2), or an inline picture. */
export function ownDeckPhoto(url: unknown, organizationId: string): boolean {
  if (typeof url !== "string") return false;
  return isPrivateFileUnder(url, `deck-photos/${organizationId}/`) || /^data:image\//i.test(url);
}

const unitToType = (unit: string | undefined) => (unit === "sqft" ? "SQFT" : unit === "ln ft" ? "LINEAR_FT" : unit === "lot" ? "LUMP_SUM" : "UNIT");
const round2 = (n: number) => Math.round(n * 100) / 100;

/** A design the client sent back through their link is THEIR job (2026-10-17 audit: four priced client designs
 *  sat "Unassigned" though the link carried the client's name and phone). The link's own client record when it
 *  was made from one; else the client with that email or phone; else a new client from what the contractor typed
 *  on the link — within the plan's client cap (over the cap it stays unassigned, as before). Never throws. */
export async function clientFromDesignLink(organizationId: string, userId: string, token: string | null | undefined, title: string): Promise<string | null> {
  try {
    const c = await clientOfLink(token, organizationId);
    if (!c) return null;
    if (c.clientId) {
      const own = await db.client.findFirst({ where: { id: c.clientId, organizationId, deletedAt: null }, select: { id: true } });
      if (own) return own.id;
    }
    const known = c.clientEmail || c.clientPhone ? await findClientForLead(organizationId, { email: c.clientEmail, phone: c.clientPhone }) : null;
    if (known) return known.id;
    const name = c.clientName.trim();
    if (!name) return null;
    // A link with only a name: the client already on file by that exact name — when there is just the one.
    if (!c.clientEmail && !c.clientPhone) {
      const same = (await db.client.findMany({ where: { organizationId, deletedAt: null }, select: { id: true, name: true }, take: 5000 })).filter((x) => x.name.trim().toLowerCase() === name.toLowerCase());
      if (same.length === 1) return same[0].id;
    }
    const cap = await checkPlanLimit(organizationId, "clients");
    if (!cap.allowed) return null;
    const made = await db.client.create({
      data: { organizationId, name, email: c.clientEmail?.trim() || null, phone: c.clientPhone?.trim() || null, address: c.address?.trim() || null },
      select: { id: true, name: true },
    });
    await logActivity({ organizationId, actorId: userId, kind: TRAIL_KINDS.CLIENT, clientId: made.id, summary: `Added client ${made.name} from their deck design ("${title}")`, meta: { from: "deck-client-design" } });
    return made.id;
  } catch {
    return null;
  }
}

export async function writeDeckProposal(ctx: { organizationId: string; userId: string; role: string }, data: DeckConvertInput, filing: FilingContext | null): Promise<string> {
  const { organizationId, userId, role } = ctx;
  // A client id from the browser must belong to this org.
  const named = data.clientId ? ((await db.client.findFirst({ where: { id: data.clientId, organizationId }, select: { id: true } }))?.id ?? null) : null;
  // Where it files (lib/filingContext): the picker's cookie on the dashboard, the client or lead the Assistant found.
  const clientId = named ?? (await filedClientId(organizationId, role, filing)) ?? (await clientFromDesignLink(organizationId, userId, data.clientToken, data.title));
  const projectId = filing?.projectId ?? null;
  const text = leadProposalText(filing?.lead ?? null, data.scope ?? "");

  // The studio's prices are SELLING prices (owner, 2026-10-01): the proposal
  // is the ticket to the cent, with no markup on top.
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { defaultTaxRate: true } });
  const lines = data.lines.map((l, i) => {
    const unitPrice = round2(l.materialCost + l.laborCost);
    return { name: l.name, description: l.description, measurementType: unitToType(l.unit), quantity: l.quantity, unitPrice, materialCost: l.materialCost, laborCost: round2(unitPrice - l.materialCost), total: l.quantity * unitPrice, position: i };
  });
  const subtotal = lines.reduce((a, l) => a + l.total, 0);
  const address = data.address?.trim() || null;
  const taxRate = stateTaxRate(stateFromAddress(address)) ?? org?.defaultTaxRate ?? 0;
  const taxTotal = subtotal * taxRate;

  const proposal = await db.proposal.create({
    data: {
      trade: "deck",
      publicId: randomUUID(),
      organizationId,
      ownerId: userId,
      clientId,
      projectId,
      title: data.title,
      scopeOfWork: text.scopeOfWork,
      description: text.overview,
      address,
      status: ProposalStatus.DRAFT,
      subtotal,
      taxRate,
      taxTotal,
      total: subtotal + taxTotal,
      materialMarkupPct: 0,
      laborMarkupPct: 0,
      validUntil: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14),
      lineItems: { create: lines },
      installments: {
        create: [
          { label: "Deposit", amount: 30, isPercent: true, position: 0 },
          { label: "Completion", amount: 70, isPercent: true, position: 1 },
        ],
      },
    },
  });
  await applyMemberDiscount(proposal.id).catch(() => {});
  await recordInventoryLink(organizationId, proposal.id, data.inventoryLinked, userId);
  // The deck rides with the proposal: the design (to open it again) and the frozen 3D (for the client's page).
  if (data.plan) {
    try {
      // `written`: what the studio put on the proposal, so an update from the studio knows its own lines (lib/deck/proposalEdit).
      const written: DeckWritten = { title: data.title, scope: text.scopeOfWork, lines: lines.map((l) => l.name.trim()) };
      const plan: { v: number; design: typeof data.plan.design; scene: typeof data.plan.scene; address: string | null; written: DeckWritten } = { v: DECK_PLAN_VERSION, design: data.plan.design, scene: data.plan.scene, address, written };
      // A photo from another shop's folder never rides along.
      if (plan.design.photo && !ownDeckPhoto(plan.design.photo.url, organizationId)) plan.design = { ...plan.design, photo: null };
      await db.activityEvent.create({ data: { organizationId, actorId: userId, proposalId: proposal.id, kind: DECK_PLAN_EVENT, summary: `Deck designed for the proposal — ${data.plan.scene.facts}`, meta: JSON.stringify(plan) } });
    } catch {
      /* the picture never blocks the proposal */
    }
  }
  await logActivity({ organizationId, actorId: userId, kind: TRAIL_KINDS.ESTIMATE, proposalId: proposal.id, summary: `Priced a deck — ${data.plan?.scene.facts ?? data.title}, $${Math.round(subtotal).toLocaleString("en-US")}`, meta: { trade: "deck", amount: Math.round(subtotal) } });
  // A design that came back through a client's link: the link now belongs to this proposal (2026-10-13).
  await tieClientLinkToProposal(data.clientToken, organizationId, proposal.id);
  try {
    if (projectId) revalidatePath(`/dashboard/projects/${projectId}`);
    revalidatePath("/dashboard/proposals");
  } catch {
    /* outside a request (a text, the minute job): the pages read fresh on their next visit */
  }
  return proposal.id;
}
