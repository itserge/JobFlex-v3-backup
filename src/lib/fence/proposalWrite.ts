import "server-only";
// THE FENCE PROPOSAL, WITHOUT A SESSION (2026-11-05): what the fence estimator's "convert" writes
// (actions/fenceEstimator) — the lines priced by the package engine with no markup on top (the rates are installed
// prices, the profit inside), the state's sales tax from the address, the 3D snapshot to Blob when there is one, and
// the traced plan beside it as FENCE_PLAN for the client's page — as a plain function of who is acting. The action
// is a wrapper over it (it reads and clears the filing cookie); the AI Operator (lib/assistant/fence) calls it with
// the filing it worked out from ids.
import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { recordInventoryLink } from "@/lib/inventoryPick";
import { filedClientId, leadProposalText, type FilingContext } from "@/lib/filingContext";
import { sellUnitPrice } from "@/lib/pricing/markup";
import { uploadBlob, isBlobEnabled } from "@/lib/sdk/blob";
import { ProposalStatus } from "@/lib/prismaEnums";
import { PREVIEW_MAX_CHARS, type FenceConvertInput } from "@/lib/fence/convertSchema";
import { FENCE_PLAN_EVENT } from "@/lib/fence/planSvg";
import { FENCE_TAKEOFF_EVENT, savedTakeoffMeta } from "@/lib/fence/savedTakeoff";
import { fenceTypeForLine } from "@/lib/inventoryBom";
import { stateFromAddress, stateTaxRate } from "@/lib/pricing/salesTax";
import { applyMemberDiscount } from "@/lib/servicePlanBook";

export async function writeFenceProposal(ctx: { organizationId: string; userId: string; role: string }, data: FenceConvertInput, filing: FilingContext | null): Promise<string> {
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
  // proposal's overview beside the fence scope written here.
  const clientId = named ?? (await filedClientId(organizationId, role, filing));
  const projectId = filing?.projectId ?? null;
  const text = leadProposalText(filing?.lead ?? null, data.scope ?? "");

  // NO markup on top (owner, 2026-10-01): the fence rates are installed
  // prices with the profit inside — "a typed rate is what you charge" — so the
  // proposal is the ticket, to the cent, whatever markup the company keeps
  // for its hand-built proposals. It used to treat the ticket as cost and add
  // that markup: the client got a bigger number than the page showed, and at
  // the default 0% the builder graded the job a red "MARGIN 0.0%". The roof
  // and HVAC converts already price this way.
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { defaultTaxRate: true },
  });
  const markupRates = { materialMarkupPct: 0, laborMarkupPct: 0 };

  // A split line (the package engine): the unit price is the two halves; the
  // halves stay so "Show to client → breakdown" can print them.
  const split = (data.lines ?? []).map((l) => {
    const sell = sellUnitPrice({ unitPrice: l.materialCost + l.laborCost, materialCost: l.materialCost, laborCost: l.laborCost }, markupRates);
    return {
      name: l.name,
      description: l.description,
      measurementType: unitToType(l.unit),
      quantity: l.quantity,
      unitPrice: sell,
      materialCost: l.materialCost,
      laborCost: l.laborCost,
      total: l.quantity * sell,
    };
  });
  const lines = [
    ...split,
    ...data.materials.map((l) => ({
      name: l.name,
      measurementType: unitToType(l.unit),
      quantity: l.quantity,
      unitPrice: sellUnitPrice({ unitPrice: l.unitPrice, materialCost: l.unitPrice, laborCost: 0 }, markupRates),
      materialCost: l.unitPrice,
      laborCost: 0,
      total:
        l.quantity *
        sellUnitPrice({ unitPrice: l.unitPrice, materialCost: l.unitPrice, laborCost: 0 }, markupRates),
    })),
    ...data.labor.map((l) => ({
      name: l.name,
      measurementType: unitToType(l.unit),
      quantity: l.quantity,
      unitPrice: sellUnitPrice({ unitPrice: l.unitPrice, materialCost: 0, laborCost: l.unitPrice }, markupRates),
      materialCost: 0,
      laborCost: l.unitPrice,
      total:
        l.quantity *
        sellUnitPrice({ unitPrice: l.unitPrice, materialCost: 0, laborCost: l.unitPrice }, markupRates),
    })),
  ];

  const subtotal = lines.reduce((a, l) => a + l.total, 0);
  // Tax sits on top of the marked-up subtotal (sell price), applied once: the
  // job's state rate from the address, the way the roof and HVAC converts
  // write it, else the org default. taxRate is a FRACTION (0.08 = 8%).
  const address = data.address?.trim() || null;
  const taxRate = stateTaxRate(stateFromAddress(address)) ?? org?.defaultTaxRate ?? 0;
  const taxTotal = subtotal * taxRate;

  // Best-effort: persist the 3D snapshot to Blob so it can ride along in the
  // proposal/PDF. Never blocks proposal creation if Blob is off or upload fails.
  let beforePhotos: string | undefined;
  try {
    const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(data.previewDataUrl ?? "");
    // Anything oversized is dropped, not refused: the proposal never waits on its picture.
    if (m && (data.previewDataUrl?.length ?? 0) <= PREVIEW_MAX_CHARS && isBlobEnabled()) {
      const ext = m[1] === "jpeg" ? "jpg" : m[1];
      const { url } = await uploadBlob(`fence-preview/${randomUUID()}.${ext}`, Buffer.from(m[2], "base64"));
      beforePhotos = JSON.stringify([url]);
    }
  } catch {
    /* preview is optional */
  }

  const proposal = await db.proposal.create({
    data: {
      // The trade board lists it and its materials count against the fence stock (2026-09-20).
      trade: "fence",
      publicId: randomUUID(),
      organizationId,
      ownerId: user.id,
      clientId,
      projectId,
      ...(beforePhotos ? { beforePhotos } : {}),
      title: data.title,
      // Scope only — assumptions stay on the estimate, never baked into the
      // proposal's scope (keeps the preview / calendar / job detail clean).
      scopeOfWork: text.scopeOfWork,
      description: text.overview,
      address,
      status: ProposalStatus.DRAFT,
      subtotal,
      taxRate,
      taxTotal,
      total: subtotal + taxTotal,
      materialMarkupPct: markupRates.materialMarkupPct,
      laborMarkupPct: markupRates.laborMarkupPct,
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
  // The studio's own material list rides beside the proposal as the crew's pick list (lib/fence/savedTakeoff,
  // 2026-11-10) — rebuilt from the price lines it lost the closed loop, the steps, the steel gate posts and the
  // post system. Best effort: without it the list is rebuilt, as before.
  if (data.takeoff?.length) {
    try {
      const forLf = lines.filter((l) => fenceTypeForLine(l.name)).reduce((a, l) => a + l.quantity, 0);
      if (forLf > 0) {
        await db.activityEvent.create({
          data: { organizationId, actorId: user.id, proposalId: proposal.id, kind: FENCE_TAKEOFF_EVENT, summary: `Fence material list kept for the crew — ${data.takeoff.length} items`, meta: savedTakeoffMeta({ forLf, lines: lines.map((l) => l.name), bom: data.takeoff }) },
        });
      }
    } catch {
      /* the kept list is optional */
    }
  }
  // The connect-or-not choice, when one was made (lib/inventoryPick; null = the company's default).
  await recordInventoryLink(organizationId, proposal.id, data.inventoryLinked, user.id);
  // The traced layout rides with the proposal (2026-09-23): an activity
  // event the client's page draws from. Best effort — the proposal never
  // fails for its picture.
  if (data.plan) {
    try {
      const gates = data.plan.gates.length;
      await db.activityEvent.create({
        data: { organizationId, actorId: user.id, proposalId: proposal.id, kind: FENCE_PLAN_EVENT, summary: `Fence layout drawn for the proposal — ${Math.round(data.plan.totalLf)} ft${gates ? `, ${gates} ${gates === 1 ? "gate" : "gates"}` : ""}`, meta: JSON.stringify(data.plan) },
      });
    } catch {
      /* the layout is optional */
    }
  }

  // Outside a request (the AI Operator's minute job) there is no response to wait for: marked stale, errors swallowed.
  try {
    if (projectId) revalidatePath(`/dashboard/projects/${projectId}`);
    revalidatePath("/dashboard/proposals");
  } catch {
    /* not in a request */
  }
  return proposal.id;
}

function unitToType(unit: string | undefined): string {
  switch (unit) {
    case "sqft":
      return "SQFT";
    case "ln ft":
    case "linear ft":
      return "LINEAR_FT";
    case "hour":
      return "HOUR";
    case "lot":
      return "LUMP_SUM";
    default:
      return "UNIT";
  }
}
