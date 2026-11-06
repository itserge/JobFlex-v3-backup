import "server-only";
// THE LAWN PROPOSAL, WITHOUT A SESSION (2026-11-05): what the lawn estimator's "convert" writes
// (actions/lawnEstimator) — the season's lines at the company's selling prices (no markup on top), sales tax only
// on what the state taxes (lib/lawn/tax), one "season agreement" installment, the yard riding along as LAWN_SITE
// to open it again, and the activity row — as a plain function of who is acting. The action is a wrapper over it
// (the preview gate, the plan's proposal meter, the filing cookie); the AI Operator (lib/assistant/lawn) calls it
// with the filing it worked out from ids.
import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { filedClientId, leadProposalText, type FilingContext } from "@/lib/filingContext";
import { ProposalStatus } from "@/lib/prismaEnums";
import { stateTaxRate } from "@/lib/pricing/salesTax";
import { applyMemberDiscount } from "@/lib/servicePlanBook";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { lawnTaxed } from "@/lib/lawn/tax";

export const lawnLineSchema = z.object({
  key: z.string().max(40),
  name: z.string().trim().min(1).max(200),
  description: z.string().max(1500).default(""),
  quantity: z.number().min(0).max(1_000_000),
  unit: z.enum(["visit", "application", "sqft", "cu yd", "ea", "ln ft", "lot", "push"]),
  unitPrice: z.number().min(0).max(10_000_000),
  labor: z.number().min(0).max(1),
  taxClass: z.enum(["service", "install"]),
});
export const lawnConvertSchema = z.object({
  title: z.string().trim().min(1).max(160),
  clientId: z.string().max(64).nullable().optional(),
  address: z.string().max(300).nullable().optional(),
  state: z.string().max(4).nullable().optional(),
  scope: z.string().max(6000).default(""),
  lines: z.array(lawnLineSchema).min(1).max(60),
  draftId: z.string().max(64).nullable().optional(),
  site: z.unknown().optional(),
  measures: z.unknown().optional(),
});

const UNIT_TYPE: Record<z.infer<typeof lawnLineSchema>["unit"], string> = { visit: "UNIT", application: "UNIT", "cu yd": "UNIT", ea: "UNIT", push: "UNIT", sqft: "SQFT", "ln ft": "LINEAR_FT", lot: "LUMP_SUM" };
const UNIT_WORD: Record<z.infer<typeof lawnLineSchema>["unit"], string> = { visit: "per visit", application: "per application", "cu yd": "per cubic yard", ea: "each", push: "per snowfall", sqft: "per sq ft", "ln ft": "per linear ft", lot: "" };
export const LAWN_SITE_EVENT = "LAWN_SITE";
export type LawnConvertInput = z.infer<typeof lawnConvertSchema>;

export async function writeLawnProposal(ctx: { organizationId: string; userId: string; role: string }, data: LawnConvertInput, filing: FilingContext | null): Promise<string> {
  const { organizationId, userId, role } = ctx;
  const named = data.clientId ? ((await db.client.findFirst({ where: { id: data.clientId, organizationId: organizationId, deletedAt: null }, select: { id: true } }))?.id ?? null) : null;
  const clientId = named ?? (await filedClientId(organizationId, role, filing));
  const projectId = filing?.projectId ?? null;
  const text = leadProposalText(filing?.lead ?? null, data.scope);
  const round2 = (n: number) => Math.round(n * 100) / 100;
  // The estimator's prices are selling prices: the proposal is the ticket, no markup on top.
  const lines = data.lines.map((l, i) => {
    const unitPrice = round2(l.unitPrice);
    const laborCost = round2(unitPrice * l.labor);
    const word = UNIT_WORD[l.unit];
    return { name: word ? `${l.name} (${word})` : l.name, description: l.description || null, measurementType: UNIT_TYPE[l.unit], quantity: l.quantity, unitPrice, materialCost: round2(unitPrice - laborCost), laborCost, total: round2(l.quantity * unitPrice), position: i };
  });
  const subtotal = round2(lines.reduce((a, l) => a + l.total, 0));
  const address = data.address?.trim() || null;
  // Sales tax only on what the state taxes (lawn care, installation, or neither — lib/lawn/tax).
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { defaultTaxRate: true } });
  const rate = stateTaxRate(data.state ?? null) ?? org?.defaultTaxRate ?? 0;
  const taxable = data.lines.reduce((s, l, i) => s + (lawnTaxed(data.state ?? null, l.taxClass) ? lines[i].total : 0), 0);
  const taxTotal = round2(taxable * rate);
  const taxRate = subtotal > 0 ? Math.round((taxTotal / subtotal) * 1e6) / 1e6 : 0;
  const proposal = await db.proposal.create({
    data: {
      trade: "lawn",
      publicId: randomUUID(),
      organizationId: organizationId,
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
      total: round2(subtotal + taxTotal),
      materialMarkupPct: 0,
      laborMarkupPct: 0,
      validUntil: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
      lineItems: { create: lines },
      installments: { create: [{ label: "Season agreement", amount: 100, isPercent: true, position: 0 }] },
    },
  });
  await applyMemberDiscount(proposal.id).catch(() => {});
  // The yard rides along: the lot, the photo it was read from, the classes as left — to open it again.
  try {
    const meta = JSON.stringify({ v: 1, draftId: data.draftId ?? null, site: data.site ?? null, measures: data.measures ?? null });
    if (meta.length < 900_000) await db.activityEvent.create({ data: { organizationId: organizationId, actorId: userId, proposalId: proposal.id, kind: LAWN_SITE_EVENT, summary: `Measured in the lawn estimator — ${address ?? data.title}`, meta } });
  } catch {
    /* the yard never blocks the proposal */
  }
  await logActivity({ organizationId: organizationId, actorId: userId, kind: TRAIL_KINDS.ESTIMATE, proposalId: proposal.id, summary: `Priced a lawn — ${address ?? data.title}, $${Math.round(subtotal).toLocaleString("en-US")}`, meta: { trade: "lawn", amount: Math.round(subtotal) } });
  // Outside a request (the AI Operator's minute job) there is no response to wait for: marked stale, errors swallowed.
  try {
    if (projectId) revalidatePath(`/dashboard/projects/${projectId}`);
    revalidatePath("/dashboard/proposals");
  } catch {
    /* not in a request */
  }
  return proposal.id;
}
