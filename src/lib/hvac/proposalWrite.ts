import "server-only";
// THE HVAC PROPOSAL, WITHOUT A SESSION (2026-11-05): what the HVAC estimator's "convert" writes
// (actions/hvacEstimator) — the ledger's lines as priced, the job's address and the state's sales tax (the saved
// estimate's own wins), the 30/70 schedule, the client's existing system filed on their record, the estimate marked
// converted and the activity row — as a plain function of who is acting. The action is a wrapper over it (session,
// page, the plan's meters, the filing cookie); the AI Operator (lib/assistant/hvac) calls it with the filing it
// worked out from ids.
import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { recordInventoryLink } from "@/lib/inventoryPick";
import { filedClientId, leadProposalText, type FilingContext } from "@/lib/filingContext";
import { ProposalStatus } from "@/lib/prismaEnums";
import { stateFromAddress, stateTaxRate } from "@/lib/pricing/salesTax";
import { applyMemberDiscount } from "@/lib/servicePlanBook";
import { fileEquipmentFromModel } from "@/lib/visitBook";

/** One priced line as the ledger writes it (lib/hvac/ledger); the id keeps a reopened estimate's rows editable. */
export const hvacLineSchema = z.object({ /** The ledger's own line id, so a reopened estimate's rows stay editable. */ id: z.string().max(80).optional(), name: z.string().max(200), quantity: z.number().min(0), unitPrice: z.number().min(0), unit: z.string().max(40).optional(), basis: z.string().max(20).optional(), note: z.string().max(400).optional() });

/** The proposal's measurement vocabulary from a ledger unit. */
export function unitToType(unit: string | undefined): string {
  const u = (unit ?? "").trim().toLowerCase();
  if (!u) return "UNIT";
  if (/sq\.?\s*ft|sqft|square\s*f(ee|oo)?t|\bsf\b/.test(u)) return "SQFT";
  if (/lin|\bln\b|\blf\b|\bft\b|f(ee|oo)t/.test(u)) return "LINEAR_FT";
  if (/hour|\bhrs?\b/.test(u)) return "HOUR";
  if (/lot|lump|allowance|flat|fixed|\bjob\b/.test(u)) return "LUMP_SUM";
  return "UNIT";
}

export const hvacConvertSchema = z.object({
  estimateId: z.string().optional().nullable(),
  /** The job address; the saved estimate's own wins when there is one. */
  address: z.string().max(300).optional(),
  /** Set when the estimate carries an approved report; one sentence in the scope. */
  permitNote: z.string().max(300).optional(),
  title: z.string().min(1).max(200),
  scope: z.string().max(6000).optional(),
  materials: z.array(hvacLineSchema).max(80),
  labor: z.array(hvacLineSchema).max(80),
  clientId: z.string().optional().nullable(),
  inventoryLinked: z.boolean().optional().nullable(),
});

/** The roof estimator's convert, line for line: proposal + line items + the
 *  30/70 schedule + the activity row. Assumptions stay on the estimate. */
export type HvacConvertInput = z.infer<typeof hvacConvertSchema>;

export async function writeHvacProposal(ctx: { organizationId: string; userId: string; role: string }, data: HvacConvertInput, filing: FilingContext | null): Promise<string> {
  const { organizationId, userId, role } = ctx;
  const user = { id: userId };

  const named = data.clientId
    ? ((await db.client.findFirst({ where: { id: data.clientId, organizationId }, select: { id: true } }))?.id ?? null)
    : null;
  // Started from a project or a client's page, the picker recorded where this
  // estimate files (lib/filingContext); an explicit client still wins. Started
  // from a lead, the filing carries the lead: its client, and its scope as the
  // proposal's overview beside the HVAC scope written here.
  const clientId = named ?? (await filedClientId(organizationId, role, filing));
  const projectId = filing?.projectId ?? null;
  const text = leadProposalText(filing?.lead ?? null, [data.scope ?? "", data.permitNote ?? ""].filter(Boolean).join("\n\n"));

  const lines = [
    ...data.materials.map((l) => ({ name: l.name, measurementType: unitToType(l.unit), quantity: l.quantity, unitPrice: l.unitPrice, materialCost: l.unitPrice, laborCost: 0, total: l.quantity * l.unitPrice })),
    ...data.labor.map((l) => ({ name: l.name, measurementType: unitToType(l.unit), quantity: l.quantity, unitPrice: l.unitPrice, materialCost: 0, laborCost: l.unitPrice, total: l.quantity * l.unitPrice })),
  ];
  const subtotal = lines.reduce((a, l) => a + l.total, 0);
  // The job address and the state's sales tax, the way the other estimators'
  // converts write them (review, 2026-09-17: the proposal used to land with
  // no address and taxRate 0, so a Texas job carried no tax).
  let address = data.address?.trim() || null;
  let stateHint: string | null = null;
  if (data.estimateId) {
    const saved = await db.hvacEstimate.findFirst({ where: { id: data.estimateId, organizationId }, select: { address: true, state: true, modelJson: true } }).catch(() => null);
    if (saved) { address = saved.address || address; stateHint = saved.state; }
  }
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { defaultTaxRate: true } });
  const taxRate = stateTaxRate(stateFromAddress(address) ?? stateHint) ?? org?.defaultTaxRate ?? 0;
  const taxTotal = subtotal * taxRate;

  const proposal = await db.proposal.create({
    data: {
      // The trade board lists it and its materials count against the hvac stock (2026-09-20).
      trade: "hvac",
      publicId: randomUUID(),
      organizationId,
      ownerId: user.id,
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
      validUntil: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14),
      lineItems: { create: lines.map((l, i) => ({ ...l, position: i })) },
      installments: {
        create: [
          { label: "Deposit", amount: 30, isPercent: true, position: 0 },
          { label: "Completion", amount: 70, isPercent: true, position: 1 },
        ],
      },
    },
  });
  // A member client (2026-09-22): the plan's discount rides on the new proposal (lib/servicePlanBook).
  await applyMemberDiscount(proposal.id).catch(() => {});
  // The estimate's existing system goes on the client's record (2026-09-23) —
  // the next service visit and the tune-up report know what is there.
  if (clientId && data.estimateId) {
    try {
      const row = await db.hvacEstimate.findFirst({ where: { id: data.estimateId, organizationId }, select: { modelJson: true } });
      const existing = row ? (JSON.parse(row.modelJson) as { existing?: { kind?: string; tons?: number; fuel?: string; refrigerant?: string; yearMade?: number } }).existing : null;
      await fileEquipmentFromModel(organizationId, clientId, existing);
    } catch {
      /* the proposal stands without the unit on file */
    }
  }
  // The connect-or-not choice, when one was made (lib/inventoryPick; null = the company's default).
  await recordInventoryLink(organizationId, proposal.id, data.inventoryLinked, user.id);

  if (data.estimateId) {
    try {
      await db.hvacEstimate.updateMany({ where: { id: data.estimateId, organizationId }, data: { status: "converted", proposalId: proposal.id } });
    } catch {
      /* table not pushed yet */
    }
  }

  await db.activityEvent.create({
    data: { organizationId, actorId: user.id, proposalId: proposal.id, kind: "CREATED", summary: `Converted HVAC estimate to proposal "${proposal.title}"` },
  });

  // Outside a request (the AI Operator's minute job) there is no response to wait for: marked stale, errors swallowed.
  try {
    if (projectId) revalidatePath(`/dashboard/projects/${projectId}`);
    revalidatePath("/dashboard/proposals");
  } catch {
    /* not in a request */
  }
  return proposal.id;
}
