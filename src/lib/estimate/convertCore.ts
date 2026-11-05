import "server-only";
// A PRICED ESTIMATE → A DRAFT PROPOSAL, WITHOUT A SESSION (2026-11-05). The body of Smart Proposal's convert
// (actions/advancedEstimator convertEstimateToProposal), moved here so the JobFlex Assistant files the estimates
// it prices from a text through the same code: one line per task, the company's markup or its own pricing, the
// state's tax, the 30/70 stages, the member discount. The action keeps the session, the page, the cap and the
// filing cookie; this takes them as given.
import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { recordInventoryLink } from "@/lib/inventoryPick";
import { filedClientId, leadProposalText, type FilingContext } from "@/lib/filingContext";
import { ProposalStatus } from "@/lib/prismaEnums";
import { sellUnitPrice, resolveMarkupRates } from "@/lib/pricing/markup";
import { pairEstimateLines } from "@/lib/estimate/console-model";
import { isTradeId } from "@/lib/inventory";
import { stateFromAddress, stateTaxRate } from "@/lib/pricing/salesTax";
import { materialsTaxLine } from "@/lib/estimate/companyPricing";
import { discountSchema, lineSchema, pricingSnapshotSchema, type GeneratedEstimate } from "@/lib/estimatorSchema";
import { trackActivation, trackProposalCreated } from "@/lib/activation-events";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { applyMemberDiscount } from "@/lib/servicePlanBook";

/** What a convert carries: the estimate as the screen (or the Assistant) priced it. */
export const convertInput = z.object({
  projectType: z.string(),
  /** Which tool is converting (2026-10-17, lib/proposalKind): the proposals list names it. Smart Proposal when absent. */
  source: z.enum(["smart", "video", "blueprint"]).optional(),
  title: z.string(),
  scope: z.string().optional(),
  materials: z.array(lineSchema).default([]),
  labor: z.array(lineSchema).default([]),
  assumptions: z.array(z.string()).default([]),
  // Pre-links the proposal to a client when converted from a client's page.
  clientId: z.string().optional().nullable(),
  inventoryLinked: z.boolean().optional().nullable(),
  // The estimate's job location ("City, ST") — becomes the proposal's job
  // address and, when its state resolves, seeds the tax rate for that market.
  location: z.string().optional().nullable(),
  // Order-level discount from the estimator ("10% off") — materializes as a
  // Discount row + discountTotal on the proposal.
  discount: discountSchema.nullish(),
  // Priced the company's way (lib/estimate/companyPricing): the prices are final — no markup is added — and the
  // tax follows the company's rule at the rate the screen showed (`taxPct`, %).
  pricing: pricingSnapshotSchema.optional(),
  taxPct: z.number().min(0).max(30).optional(),
});

/**
 * An estimate line's unit → the `LineItem.measurementType` column.
 *
 * The estimator is instructed to answer from the manual builder's own ten-value
 * picker, and this collapses those ten onto the six the schema has — the same
 * lossy map the builder itself applies (see manual-blueprint-bridge.ts). It
 * still tolerates the older free-text units ("ln ft", "each", "box") that live
 * on estimates generated before the vocabulary was pinned, so reopening one of
 * those does not land every line on UNIT by accident.
 */
const MEASUREMENT_FOR_UNIT: Record<string, string> = {
  sqft: "SQFT",
  "sq ft": "SQFT",
  "sq yards": "SQ_YARD",
  sqyards: "SQ_YARD",
  lf: "LINEAR_FT",
  "linear ft": "LINEAR_FT",
  "ln ft": "LINEAR_FT",
  yards: "LINEAR_FT",
  // Exact since 2026-10-21 (they had become cubic FEET, square feet and "unit").
  "cu yards": "CU_YARD",
  "sq boards": "SQUARE",
  unit: "UNIT",
  // The real measures a line is counted or bought in.
  each: "EACH",
  sheets: "SHEET",
  bundles: "BUNDLE",
  rolls: "ROLL",
  boxes: "BOX",
  bags: "BAG",
  pieces: "PIECE",
  gallons: "GALLON",
  buckets: "BUCKET",
  tubes: "TUBE",
  sets: "SET",
  tons: "TON",
  hour: "HOUR",
  hr: "HOUR",
  hours: "HOUR",
  fixed: "LUMP_SUM",
  "lump sum": "LUMP_SUM",
};

const MEASURED_IN: Record<string, string> = {
  hour: "Measured in hours", hr: "Measured in hours", hrs: "Measured in hours", hours: "Measured in hours",
  sqft: "Measured in square feet", "sq ft": "Measured in square feet",
  lf: "Measured in linear feet", "linear ft": "Measured in linear feet", "ln ft": "Measured in linear feet", yards: "Measured in linear yards",
  "cu yards": "Measured in cubic yards", "sq yards": "Measured in square yards", "sq boards": "Measured in roofing squares",
  sheets: "Bought in sheets", bundles: "Bought in bundles", rolls: "Bought in rolls", boxes: "Bought in boxes", bags: "Bought in bags",
  pieces: "Bought in pieces", gallons: "Bought in gallons", buckets: "Bought in buckets", tubes: "Bought in tubes", sets: "Bought in sets", tons: "Bought in tons",
};
/** A line's measure in words for the line's description — null for a lump sum or a plain count. */
function measureCaption(unit: string | null | undefined): string | null {
  return MEASURED_IN[(unit ?? "").trim().toLowerCase()] ?? null;
}

function measurementForUnit(unit: string | null | undefined): string {
  return MEASUREMENT_FOR_UNIT[(unit ?? "").trim().toLowerCase()] ?? "UNIT";
}

export type ConvertEstimateInput = z.infer<typeof convertInput>;

/**
 * An estimate → a DRAFT proposal, for a member of a company named by the caller: the caller has checked who
 * they are, the page, the feature and the plan's proposal cap, and passes where it files (lib/filingContext —
 * the picker's cookie on the dashboard, the client or lead the Assistant found by text).
 */
export async function convertEstimateAs(ctx: { organizationId: string; userId: string; role: string }, data: ConvertEstimateInput, filing: FilingContext | null): Promise<{ id: string }> {
  const { organizationId, role } = ctx;
  const user = { id: ctx.userId };

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
  // proposal's overview beside the scope this estimate wrote.
  const clientId = named ?? (await filedClientId(organizationId, role, filing));
  const projectId = filing?.projectId ?? null;

  // Hidden profit markup: seed this proposal from the org-wide default, then
  // apply it so each line's unitPrice is the SELL price (0% → equals cost).
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { materialMarkupPct: true, laborMarkupPct: true, defaultTaxRate: true },
  });
  // An estimate priced the company's way already carries its markup, overhead and profit in every price.
  const company = data.pricing ?? null;
  const markupRates = company ? { materialMarkupPct: 0, laborMarkupPct: 0 } : resolveMarkupRates(null, org);

  // ONE LINE ITEM PER TASK. A material row and the labor row that shares its
  // id (or name + unit) become one proposal line with both costs — the shape
  // the proposal table has always had (Description | Qty | Unit | Material |
  // Labor | Total). Unpaired rows become one-sided lines.
  const lines = pairEstimateLines(data).map(({ material: m, labor: l }) => {
    const src = (m ?? l)!;
    const materialCost = m ? m.unitPrice : 0;
    const laborCost = l ? l.unitPrice : 0;
    // Fold the product size into the line name so the proposal reads e.g.
    // "Asphalt shingles (4x8 sheet)" — the buyer sees how big each unit is,
    // not just the material name. Skip if the name already states the size.
    const size = m?.dimensions?.trim() || "";
    const name =
      size && !src.name.toLowerCase().includes(size.toLowerCase())
        ? `${src.name} (${size})`
        : src.name;
    const sell = sellUnitPrice(
      { unitPrice: materialCost + laborCost, materialCost, laborCost },
      markupRates,
    );
    const quantity = m?.quantity ?? l?.quantity ?? 0;
    return {
      name,
      // The measure in words under the line (2026-10-21): "Measured in square feet", "Bought in bundles" — none for a
      // lump sum or a plain count, which say it themselves ("Measured in fixed" read as nonsense to a client).
      description: measureCaption(src.unit),
      measurementType: measurementForUnit(src.unit),
      quantity,
      unitPrice: sell,
      materialCost,
      laborCost,
      total: quantity * sell,
      // No store, link or picture: a Smart estimate is not a shop list
      // (owner, 2026-10-09) — even one made before the change that still
      // carries them. Empty strings normalize to null.
      store: null,
      productUrl: null,
      imageUrl: null,
      dimensions: m?.dimensions?.trim() || null,
    };
  });

  // The company's tax rule: on materials only, the tax is a line of its own ("Sales tax on materials (8.25%)") —
  // the proposal's own tax is on the whole job; on the whole job, the proposal's tax at the company's rate; none.
  const address = data.location?.trim() || null;
  const stateRate = stateTaxRate(stateFromAddress(address));
  const companyTaxPct = company ? (company.taxMode === "none" ? 0 : (data.taxPct ?? company.taxRatePct ?? (stateRate ?? org?.defaultTaxRate ?? 0) * 100)) : 0;
  if (company && company.taxMode === "materials" && companyTaxPct > 0) {
    const materialsTotal = lines.filter((l) => l.materialCost > 0 && l.laborCost === 0).reduce((a, l) => a + l.total, 0);
    const before = lines.reduce((a, l) => a + l.total, 0);
    const tax = materialsTaxLine({ materialsTotal, subtotal: before, discount: data.discount, ratePct: companyTaxPct });
    if (tax > 0) {
      lines.push({
        name: `Sales tax on materials (${Math.round(companyTaxPct * 100) / 100}%)`,
        description: null,
        measurementType: "FIXED",
        quantity: 1,
        unitPrice: tax,
        materialCost: 0,
        laborCost: 0,
        total: tax,
        store: null,
        productUrl: null,
        imageUrl: null,
        dimensions: null,
      });
    }
  }
  const subtotal = lines.reduce((a, l) => a + l.total, 0);
  // Order-level discount (estimator "10% off" etc). Percent clamps to 100,
  // dollars clamp to the subtotal, and tax applies to the DISCOUNTED base.
  const discountTotal = data.discount
    ? Math.min(
        subtotal,
        data.discount.isPercent
          ? (subtotal * Math.min(data.discount.amount, 100)) / 100
          : data.discount.amount,
      )
    : 0;
  // Tax sits on top of the marked-up subtotal (sell price), applied once.
  // The estimate's location wins when its state resolves (the contractor gave
  // a market, so tax that market); the org default is the fallback. taxRate is
  // a FRACTION (0.08 = 8%), not a percent.
  const taxRate = company ? (company.taxMode === "job" ? companyTaxPct / 100 : 0) : stateRate ?? org?.defaultTaxRate ?? 0;
  const taxTotal = (subtotal - discountTotal) * taxRate;

  // Scope only — assumptions stay on the estimate (AiEstimate), never baked into
  // the proposal's scope, so the preview / calendar / job detail stay clean.
  const text = leadProposalText(filing?.lead ?? null, (data.scope ?? "").trim());

  const proposal = await db.proposal.create({
    data: {
      publicId: randomUUID(),
      organizationId,
      ownerId: user.id,
      clientId,
      projectId,
      title: data.title,
      scopeOfWork: text.scopeOfWork || null,
      description: text.overview,
      address,
      status: ProposalStatus.DRAFT,
      // A Smart Proposal for a fence, a roof or HVAC belongs to that trade's
      // board and its stock (2026-09-20); anything else has no trade.
      trade: isTradeId(data.projectType) ? data.projectType : null,
      subtotal,
      discountTotal,
      taxRate,
      taxTotal,
      total: subtotal - discountTotal + taxTotal,
      materialMarkupPct: markupRates.materialMarkupPct,
      laborMarkupPct: markupRates.laborMarkupPct,
      validUntil: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14),
      lineItems: {
        create: lines.map((l, i) => ({ ...l, position: i })),
      },
      discounts: data.discount
        ? {
            create: [
              {
                label: data.discount.label,
                amount: data.discount.amount,
                isPercent: data.discount.isPercent,
              },
            ],
          }
        : undefined,
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

  await db.activityEvent.create({
    data: {
      organizationId,
      actorId: user.id,
      proposalId: proposal.id,
      kind: "CREATED",
      summary: `Converted "${data.projectType}" AI estimate to proposal "${proposal.title}"`,
      // The tool that made it — Smart Proposal, the video or the blueprint estimator (lib/proposalKind reads it).
      meta: JSON.stringify({ source: data.source ?? "smart", projectType: data.projectType }),
    },
  });
  trackProposalCreated(organizationId, "smart");

  try {
    if (projectId) revalidatePath(`/dashboard/projects/${projectId}`);
    revalidatePath("/dashboard/proposals");
  } catch {
    /* outside a request (a text, the minute job): the pages read fresh on their next visit */
  }
  return { id: proposal.id };
}

/** A priced estimate kept as the company's AiEstimate (what the plan's "estimatorUses" counts), with its trail line.
 *  The caller has checked the person, the page and the cap. */
export async function saveEstimateAs(ctx: { organizationId: string; userId: string }, raw: { projectType: string; location?: string | null; data: GeneratedEstimate }): Promise<{ id: string }> {
  const { organizationId } = ctx;
  const total =
    raw.data.materials.reduce((a, l) => a + l.quantity * l.unitPrice, 0) +
    raw.data.labor.reduce((a, l) => a + l.quantity * l.unitPrice, 0);
  const est = await db.aiEstimate.create({
    data: {
      organizationId,
      projectType: raw.projectType,
      location: raw.location ?? null,
      materials: JSON.stringify(raw.data.materials),
      labor: JSON.stringify(raw.data.labor),
      categories: JSON.stringify({
        title: raw.data.title,
        assumptions: raw.data.assumptions,
        estimatedTimelineDays: raw.data.estimatedTimelineDays,
        discount: raw.data.discount ?? null,
      }),
      assumptions: raw.data.assumptions.join("\n"),
      total,
    },
  });
  trackActivation("estimator_used", organizationId, { estimator: "smart" });
  try {
    revalidatePath("/dashboard/advanced-ai");
  } catch {
    /* outside a request: the page reads fresh on its next visit */
  }
  await logActivity({
    organizationId,
    actorId: ctx.userId,
    kind: TRAIL_KINDS.ESTIMATE,
    summary: `Saved a ${raw.projectType} estimate${raw.location ? ` at ${raw.location}` : ""} — ${raw.data.title}, $${Math.round(total).toLocaleString("en-US")}`,
    meta: { estimateId: est.id, trade: raw.projectType, amount: Math.round(total * 100) / 100, location: raw.location ?? undefined },
  });
  return { id: est.id };
}
