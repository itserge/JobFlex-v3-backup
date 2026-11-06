import "server-only";
// THE ROOF PROPOSAL, WITHOUT A SESSION (2026-11-05): what the roof estimator's "convert" writes
// (actions/roofEstimator) — the package's lines as priced (installed rates, no markup on top), the job's address
// and the state's sales tax (the saved measurement's own address wins), the measurement linked for the client's
// house photo, the activity row, and the ROOF_PLAN kept so "Edit the roof estimate" opens it again — as a plain
// function of who is acting. The action is a wrapper over it (session, page, the plan's proposal meter, the
// filing cookie); the AI Operator (lib/assistant/roof) calls it with the filing it worked out from ids.
import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { recordInventoryLink } from "@/lib/inventoryPick";
import { filedClientId, leadProposalText, type FilingContext } from "@/lib/filingContext";
import { ProposalStatus } from "@/lib/prismaEnums";
import { stateFromAddress, stateTaxRate } from "@/lib/pricing/salesTax";
import { trackProposalCreated } from "@/lib/activation-events";
import { applyMemberDiscount } from "@/lib/servicePlanBook";
import { roofUnitType as unitToType, ROOF_PLAN_EVENT, ROOF_PLAN_VERSION } from "@/lib/roofPackage/proposalEdit";

/** The estimator's side of a ROOF_PLAN, as the page sends it (lib/roofPackage/proposalEdit reads it back). */
export const roofPlanInput = z.object({
  spec: z.record(z.string(), z.unknown()).nullable().optional(),
  factsKey: z.string().max(400).nullable().optional(),
  manual: z.object({ squares: z.number().positive().max(100000), pitchLabel: z.string().max(20), address: z.string().max(300).nullable() }).nullable().optional(),
  extra: z.array(z.number().int().min(0).max(200)).max(50).optional(),
  /** The main building the figures were about (2026-10-26, "Make main") — reopened as it was. */
  mainIndex: z.number().int().min(0).max(500).nullable().optional(),
  pitchEntered: z.string().max(20).nullable().optional(),
  assumptions: z.array(z.string().max(2000)).max(60).optional(),
});
type RoofPlanInput = z.infer<typeof roofPlanInput>;

/** One ROOF_PLAN row: the plan, and what the estimator wrote on the proposal. A failure costs the reopening, never the proposal. */
export async function writeRoofPlan(
  g: { organizationId: string; userId: string },
  proposalId: string,
  plan: RoofPlanInput | null | undefined,
  at: { measurementId: string | null; address: string | null; written: { title: string; scope: string; lines: string[] } },
  summary: string,
) {
  try {
    const meta = {
      v: ROOF_PLAN_VERSION,
      measurementId: at.measurementId,
      manual: plan?.manual ?? null,
      spec: plan?.spec ?? null,
      factsKey: plan?.factsKey ?? null,
      extra: plan?.extra ?? [],
      mainIndex: plan?.mainIndex ?? null,
      pitchEntered: plan?.pitchEntered ?? null,
      assumptions: plan?.assumptions ?? [],
      address: at.address,
      written: at.written,
    };
    const json = JSON.stringify(meta);
    // A spec is a few kilobytes; anything far past that is not one.
    await db.activityEvent.create({ data: { organizationId: g.organizationId, actorId: g.userId, proposalId, kind: ROOF_PLAN_EVENT, summary, meta: json.length > 200_000 ? JSON.stringify({ ...meta, spec: null }) : json } });
  } catch (err) {
    console.warn("[roof] plan not kept:", err instanceof Error ? err.message : err);
  }
}

export const roofConvertSchema = z.object({
  title: z.string(),
  scope: z.string().optional(),
  materials: z.array(
    z.object({
      name: z.string(),
      quantity: z.number(),
      unitPrice: z.number(),
      unit: z.string().optional(),
    }),
  ),
  labor: z.array(
    z.object({
      name: z.string(),
      quantity: z.number(),
      unitPrice: z.number(),
      unit: z.string().optional(),
    }),
  ),
  assumptions: z.array(z.string()),
  // Pre-links the proposal to a client when converted from a client's page.
  clientId: z.string().optional().nullable(),
  inventoryLinked: z.boolean().optional().nullable(),
  // The measurement this estimate was priced from: its satellite photo is
  // what the client sees on the proposal (ProposalSitePhoto).
  measurementId: z.string().optional().nullable(),
  // The job address, for a hand takeoff with no measurement row; the saved
  // measurement's own address wins when there is one.
  address: z.string().max(300).optional().nullable(),
  // What the estimator was looking at, kept with the proposal so it opens
  // again there (ROOF_PLAN, 2026-10-13). Never trusted for prices.
  plan: roofPlanInput.optional().nullable(),
});
export type RoofConvertInput = z.infer<typeof roofConvertSchema>;

/** The roof proposal as the estimator's "convert" writes it — lines, the state's tax, the measurement's photo link and the ROOF_PLAN — for whoever is acting. */
export async function writeRoofProposal(ctx: { organizationId: string; userId: string; role: string }, data: RoofConvertInput, filing: FilingContext | null): Promise<string> {
  const { organizationId, userId, role } = ctx;
  const user = { id: userId };

  // Never trust a client id from the browser — it must belong to this org.
  const named = data.clientId
    ? (
        await db.client.findFirst({
          where: { id: data.clientId, organizationId },
          select: { id: true },
        })
      )?.id ?? null
    : null;
  // Started from a project or a client's page, the picker recorded where this
  // estimate files (lib/filingContext); an explicit client still wins. Started
  // from a lead, the filing carries the lead: its client, and its scope as the
  // proposal's overview beside the roof scope written here.
  const clientId = named ?? (await filedClientId(organizationId, role, filing));
  const projectId = filing?.projectId ?? null;
  const text = leadProposalText(filing?.lead ?? null, data.scope ?? "");

  const lines = [
    ...data.materials.map((l) => ({
      name: l.name,
      measurementType: unitToType(l.unit),
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      materialCost: l.unitPrice,
      laborCost: 0,
      total: l.quantity * l.unitPrice,
    })),
    ...data.labor.map((l) => ({
      name: l.name,
      measurementType: unitToType(l.unit),
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      materialCost: 0,
      laborCost: l.unitPrice,
      total: l.quantity * l.unitPrice,
    })),
  ];

  const subtotal = lines.reduce((a, l) => a + l.total, 0);

  // The job address and the state's sales tax, the way the HVAC convert
  // writes them (review 2026-09-17: a roof proposal landed with no address
  // and taxRate 0, so a Texas job carried no tax and the client's copy had
  // no site). The measurement's own address wins over the browser's.
  let address = data.address?.trim() || null;
  let stateHint: string | null = null;
  let measurementRow: { id: string } | null = null;
  let preliminaryAerial = false;
  if (data.measurementId) {
    const m = await db.roofMeasurement
      .findFirst({ where: { id: data.measurementId, organizationId }, select: { id: true, source: true, address: true, city: true, state: true, zip: true } })
      .catch(() => null);
    if (m) {
      measurementRow = { id: m.id };
      preliminaryAerial = m.source === "solar";
      const full = [m.address, [m.city, m.state].filter(Boolean).join(", "), m.zip].filter(Boolean).join(", ");
      address = full || address;
      stateHint = m.state;
    }
  }
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { defaultTaxRate: true } });
  const taxRate = stateTaxRate(stateFromAddress(address) ?? stateHint) ?? org?.defaultTaxRate ?? 0;
  const taxTotal = subtotal * taxRate;

  const proposal = await db.proposal.create({
    data: {
      // The trade board lists it and its materials count against the roof stock (2026-09-20).
      trade: "roof",
      publicId: randomUUID(),
      organizationId,
      ownerId: user.id,
      clientId,
      projectId,
      title: data.title,
      // Scope only — assumptions stay on the estimate, never baked into the
      // proposal's scope (keeps the preview / calendar / job detail clean).
      scopeOfWork: preliminaryAerial
        ? [text.scopeOfWork, "Preliminary roof estimate based on Google aerial data. Roof quantities and pricing require field verification before ordering materials."].filter(Boolean).join("\n\n")
        : text.scopeOfWork,
      description: text.overview,
      address,
      status: ProposalStatus.DRAFT,
      subtotal,
      taxRate,
      taxTotal,
      total: subtotal + taxTotal,
      validUntil: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14),
      lineItems: {
        create: lines.map((l, i) => ({ ...l, position: i })),
      },
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
  // The connect-or-not choice, when one was made (lib/inventoryPick; null = the company's default).
  await recordInventoryLink(organizationId, proposal.id, data.inventoryLinked, user.id);

  // The house photo for the client: link the measurement, never trusting the
  // id from the browser past this org. A missing link table (not pushed yet)
  // costs the photo, not the proposal.
  if (measurementRow) {
    try {
      await db.proposalSitePhoto.create({ data: { proposalId: proposal.id, roofMeasurementId: measurementRow.id } });
    } catch {
      /* table not pushed yet */
    }
  }

  await db.activityEvent.create({
    data: {
      organizationId,
      actorId: user.id,
      proposalId: proposal.id,
      kind: "CREATED",
      summary: `Converted roof estimate to proposal "${proposal.title}"`,
    },
  });
  // Kept so "Edit the roof estimate" opens it again (2026-10-13).
  await writeRoofPlan(
    { organizationId, userId: user.id },
    proposal.id,
    data.plan,
    { measurementId: measurementRow?.id ?? null, address, written: { title: data.title, scope: proposal.scopeOfWork ?? "", lines: lines.map((l) => l.name.trim()) } },
    `Roof estimate kept with "${proposal.title}"`,
  );
  trackProposalCreated(organizationId, "roof");

  // Outside a request (the AI Operator's minute job) there is no response to wait for: marked stale, errors swallowed.
  try {
    if (projectId) revalidatePath(`/dashboard/projects/${projectId}`);
    revalidatePath("/dashboard/proposals");
  } catch {
    /* not in a request */
  }
  return proposal.id;
}
