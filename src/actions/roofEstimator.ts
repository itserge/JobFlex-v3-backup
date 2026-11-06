"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isEstimatorRole, isSalesRole, requireEstimatorOrManager } from "@/lib/orgContext";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";

const estimateTotal = (d: { materials: Array<{ quantity: number; unitPrice: number }>; labor: Array<{ quantity: number; unitPrice: number }> }) =>
  Math.round([...d.materials, ...d.labor].reduce((a, l) => a + l.quantity * l.unitPrice, 0));
const money = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
import { db } from "@/lib/db";
import { estimatorNameFor, reopenFromEstimate } from "@/lib/leadCenter/estimate";
import { readLeadEstimates } from "@/lib/leadCenter/estimateStore";
import { clearFilingContext, readFilingContext } from "@/lib/filingContext";
import { getOpenAI, isOpenAIEnabled, samplingOptions, resolveOpenAIModel } from "@/lib/sdk/openai";
import { estimateSchema, type GeneratedEstimate } from "@/lib/estimatorSchema";
import { checkPlanLimit, enforcePlanLimit } from "@/lib/limitsEngine";
import { PLAN_LIMIT_MESSAGE, type LimitKey } from "@/lib/planLimits";
import { enforceRateLimit, HOUR } from "@/lib/rateLimit";
import { trackActivation } from "@/lib/activation-events";
import { logServerError } from "@/lib/server-events";
import { takeTrialCap } from "@/lib/trialMeter";
import { requirePage } from "@/lib/customPageAccess";
import { proposalRef } from "@/components/v3/manual-card-lab/manual-blueprint/manual-blueprint-bridge";
import { saveProposal } from "@/actions/proposals";
import { deckProposalLock, deckProposalSeen, DECK_LOCK_WORDS, type DeckProposalLock, type LinkedDeckProposal } from "@/lib/deck/proposalEdit";
import { deckUpdatePayload } from "@/lib/deck/proposalUpdate";
import { readRoofPlan, roofTablesFromProposal, roofUnitType as unitToType, ROOF_PLAN_EVENT, type RoofManualTakeoff, type RoofTableLine } from "@/lib/roofPackage/proposalEdit";
import type { RoofPackageSpec } from "@/lib/roofPackage/takeoff";
import { roofConvertSchema, roofPlanInput, writeRoofPlan, writeRoofProposal } from "@/lib/roofPackage/proposalWrite";

/**
 * The sample shown when no OpenAI key is set. Scaled from the REAL squares
 * (audit 2026-09-08: it used to be a fixed 24-square roof whatever was
 * measured): shingles and underlayment by the square, tear-off and install by
 * the square foot, the per-foot and per-lot lines in proportion.
 */
function stubFor(squares: number, wastePct: number): GeneratedEstimate {
  const sq = Math.max(1, squares);
  const sqft = Math.round(sq * 100);
  const withWaste = Math.ceil(sq * (1 + wastePct / 100));
  const k = sq / 24;
  return {
    title: "Roof replacement estimate · AI disabled",
    scope: "Tear-off, synthetic underlayment, architectural shingles, ridge vents, cleanup.",
    assumptions: [
      "One-layer tear-off only",
      "Standard pitch, no steep-slope surcharge",
      `Sample pricing scaled to the measured ${sq.toFixed(1)} squares — add OPENAI_API_KEY for real estimates`,
    ],
    materials: [
      { name: "Architectural shingles (30-yr)", quantity: withWaste, unitPrice: 115, unit: "square" },
      { name: "Synthetic underlayment", quantity: withWaste, unitPrice: 32, unit: "square" },
      { name: "Ice & water shield", quantity: Math.round(400 * k), unitPrice: 1.1, unit: "sqft" },
      { name: "Ridge vent system", quantity: Math.round(60 * k), unitPrice: 6, unit: "ln ft" },
      { name: "Drip edge + flashing", quantity: 1, unitPrice: Math.round(480 * k), unit: "lot" },
    ],
    labor: [
      { name: "Tear-off + disposal", quantity: sqft, unitPrice: 0.8, unit: "sqft" },
      { name: "Installation labor", quantity: sqft, unitPrice: 1.8, unit: "sqft" },
      { name: "Cleanup + magnetic sweep", quantity: 1, unitPrice: Math.round(380 * k), unit: "lot" },
    ],
    estimatedTimelineDays: Math.max(2, Math.round(3 * k)),
  };
}

export async function estimateRoof(input: {
  address?: string;
  lat?: number;
  lng?: number;
  pitch: string;
  squares: number;
  wastePct: number;
  // Optional EagleView-measured facet/edge detail, fed verbatim to the AI so it
  // can price ridge vent, valley/flashing metal, and steep-slope labor off real
  // geometry rather than a single average pitch.
  measurementNotes?: string;
  /** Where `pitch` came from — the estimate must never price a pitch nobody stated. */
  pitchSource?: "measured" | "eagleview" | "solar" | "entered";
  /**
   * A two-pitch roof, when the elevation data measured one (audit
   * 2026-09-08: 12958 is 4/12 on 53 % and 9/12 on 47 %, and the estimate saw
   * only the 4/12). Each family is priced on its own share of the roof.
   */
  pitchFamilies?: Array<{ pitch12: number; share: number }>;
  /** What is on the roof now, per the aerial data ("Tile"); the estimate replaces like-for-like. */
  existingMaterial?: string | null;
  /** A flat / low-slope roof is an assembly, not a covering — the prompt prices it as one. */
  roofKind?: "steep" | "low-slope";
  /** Set only by the contractor's answer; the aerial data cannot tell. */
  buildingUse?: "residential" | "commercial" | null;
}): Promise<
  | { ok: true; data: GeneratedEstimate; disabled?: false }
  | { ok: true; data: GeneratedEstimate; disabled: true }
  | { ok: false; error: string; code?: "PLAN_LIMIT_REACHED"; resource?: LimitKey }
> {
  const { organizationId, user } = await requireEstimatorOrManager();
  await requirePage(organizationId, "roof-estimator");
await enforceRateLimit(`ai:${organizationId}`, 60, HOUR, "AI runs");
  // Union failure (not a throw): thrown messages are redacted in prod, and
  // this action's callers already branch on { ok }.
  const quota = await checkPlanLimit(organizationId, "estimatorUses");
  if (!quota.allowed) {
    return {
      ok: false,
      error: PLAN_LIMIT_MESSAGE,
      code: "PLAN_LIMIT_REACHED",
      resource: quota.cappedBy ?? "estimatorUses",
    };
  }
  if (!isOpenAIEnabled()) {
    return { ok: true, data: stubFor(input.squares, input.wastePct), disabled: true };
  }
  // The card-less trial's AI ceiling (lib/trialMeter): one run, one use.
  const trial = await takeTrialCap(organizationId, "aiCalls");
  if (!trial.ok) return trial.failure;
  const where = input.address?.trim() || (input.lat != null && input.lng != null ? `${input.lat.toFixed(5)}, ${input.lng.toFixed(5)}` : "");
  const families = (input.pitchFamilies ?? []).filter((f) => Number.isFinite(f.pitch12) && f.share > 0);
  const pitchLine =
    families.length > 1
      ? `Roof pitch: ${families.map((f) => `${Math.round(f.pitch12)}/12 on ${Math.round(f.share * 100)}% of the roof`).join(" + ")} (two-pitch roof — price labor and steep-slope surcharge per family, by its share of the squares)`
      : `Pitch: ${input.pitch}`;
  const sourceLine =
    input.pitchSource === "solar"
      ? "Pitch and area source: Google aerial estimate, preliminary. Linear roof quantities are estimates, not measured. Verify on site before ordering materials."
      : input.pitchSource === "measured"
      ? "Pitch source: measured from aerial elevation data."
      : input.pitchSource === "entered"
        ? "Pitch source: entered by the contractor, not measured."
        : input.pitchSource === "eagleview"
          ? "Pitch source: the reported figure from the aerial data."
          : "";
  try {
    // The model this process can actually call, asked once per process and
    // remembered (lib/sdk/openai). OPENAI_MODEL's import-time snapshot answers
    // with whatever string the environment holds, and a string is not an
    // entitlement: a model the key's project has no access to fails every call
    // with 403 model_not_found. Resolved here instead, so one check covers the
    // process and the fallback is a working model rather than a dead one.
    const model = await resolveOpenAIModel();
    const client = getOpenAI();
    const completion = await client.chat.completions.create({
      model,
      ...(await samplingOptions(0.4)),
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            'You are a senior roofing estimator writing a contractor-grade takeoff. Produce a roof replacement estimate as JSON matching: {title, scope, assumptions: string[], materials: [{name, quantity, unitPrice, unit}], labor: [{name, quantity, unitPrice, unit}], estimatedTimelineDays}. ' +
            'UNITS: `unit` must be exactly one of "square" (100 sq ft of roof), "sq ft", "linear ft", "each", "hour", "lot" — never anything else, never "unit". ' +
            'MATERIALS must itemize the full package with real quantities: the roof covering by the square (name the product type), underlayment by the square, ice & water shield in sq ft (eaves and valleys unless told otherwise), drip edge in linear ft (the building perimeter), starter strip in linear ft, hip & ridge cap in linear ft, valley metal in linear ft with the valley count in the name, step flashing in pieces (each) with the wall count, apron/headwall and counter flashing in linear ft, pipe boots each by size, chimney flashing kit each when there is a chimney, curb flashing each per rooftop unit, ridge vent in linear ft and/or box, turbine or powered vents each, intake vents each, nails/fasteners and sealant by the square, and deck replacement sheets each when the age or condition warrants an allowance. ' +
            'LABOR must itemize install by the square (one line per pitch family, steep-slope rate from 8/12), tear-off by the square with the layer count, disposal by the square, flashing and vent labor by linear ft or each, a steep-slope safety lot when any pitch is 8/12 or more, and cleanup as a lot. ' +
            'Use realistic 2026 pricing for the LOCAL market of the address given — its city, state and ZIP set the labor and material rates, never a national average — and say so in `assumptions` (e.g. "Priced for Kirkland, WA — local 2026 rates"). Use the waste factor for coverings and underlayment. When the roof pitch line lists more than one pitch family, state EVERY family in `assumptions` with its pitch and share of the roof (e.g. "4/12 on 53% of the roof", "9/12 on 47% of the roof — steep-slope labor applied to this share") and price labor per family by that share. Lengths that are not measured (ridge, hip, valley, walls) are estimates from the shape and footprint — label them as estimates in `assumptions`. ' +
            'EXISTING ROOF: when an "Existing roof" material is given, price a LIKE-FOR-LIKE replacement in that same material unless the notes say otherwise — tile back to tile (name concrete or clay, and include battens or foam adhesive, a self-adhered or two-ply tile underlayment, hip and ridge tile with mortar or metal, and tile labor rates), metal to metal (clips, closures, trim), shake to shake (interlayment), membrane to membrane. State the like-for-like choice as the first line of `assumptions`. ' +
            'FLAT / LOW-SLOPE ROOF: when "Roof kind: low-slope" is given, never price shingle items (no shingle underlayment, starter, hip & ridge cap, ice & water at eaves, ridge vent, attic vents or valleys). Price the membrane assembly the existing roof calls for — TPO, PVC, EPDM, modified bitumen torch-down or self-adhered, built-up, a restoration coating or spray foam — and itemize: the membrane by the square with its attachment (fasteners and plates, bonding adhesive, ballast or primer), insulation and cover board by the square when tearing off to the deck, tapered insulation and crickets in sq ft, edge metal and parapet coping in linear ft, base flashing and termination bar at parapets and walls in linear ft, roof drains and overflow scuppers each, membrane pipe boots and pitch pockets each, rooftop-unit curb flashing each, walkway pads in linear ft, a crane or hoist, tear-off and disposal priced for what is coming off (a gravel built-up roof costs about twice a single-ply), and fall protection at open edges. A coating or foam restoration goes over the existing roof: no tear-off, insulation or new edge metal, but power wash, seam and fabric repair, primer where needed and core cuts. ' +
            'COMMERCIAL: when "Building use: commercial" is given, price it as a commercial job — field install labor per square is LOWER on a big deck (about 0.92 from 50 squares, 0.85 from 100, 0.80 from 300), and add mobilization, a site safety plan, an asbestos survey before any tear-off, a superintendent on jobs of 50+ squares, a valuation-based permit, and one general conditions and insurance line of about 10.5% on everything except at-cost fees. Note in `assumptions` that it is priced as a commercial job. When no building use is given, price as residential. ' +
            'SCOPE IS FOR THE CLIENT: `scope` becomes the proposal the homeowner or building owner reads. Describe the work in plain sentences. Never put estimates, "confirm on the photo", measurement sources, markups, general-conditions percentages, productivity factors or internal notes in `scope` — those belong in `assumptions`, which the client never sees. Return JSON only.',
        },
        {
          role: "user",
          content: `Address: ${input.address ?? "unknown"}
${pitchLine}${sourceLine ? `\n${sourceLine}` : ""}
Roof size: ${input.squares} squares (${input.squares * 100} sqft)
Waste factor: ${input.wastePct}%${input.roofKind === "low-slope" ? "\nRoof kind: low-slope (flat) — price a membrane assembly, not shingles" : ""}${input.buildingUse === "commercial" ? "\nBuilding use: commercial (the contractor confirmed it)" : ""}${input.existingMaterial ? `\nExisting roof: ${input.existingMaterial} — replace like-for-like unless the notes say otherwise` : ""}${input.measurementNotes ? `\n${input.measurementNotes}` : ""}`,
        },
      ],
    });
    const text = completion.choices[0]?.message?.content ?? "{}";
    const parsed = estimateSchema.parse(JSON.parse(text));
    trackActivation("estimator_used", organizationId, { estimator: "roof" });
    const total = estimateTotal(parsed);
    await logActivity({
      organizationId,
      actorId: user.id,
      kind: TRAIL_KINDS.ESTIMATE,
      summary: `Priced a roof estimate${where ? ` at ${where}` : ""} — ${Math.round(input.squares)} squares, ${money(total)}`,
      meta: { trade: "roof", address: where || undefined, squares: input.squares, pitch: input.pitch, amount: total },
    });
    return { ok: true, data: parsed };
  } catch (err: unknown) {
    logServerError("roofEstimator.estimateRoof", err, { kind: "action", organizationId });
    if (typeof (err as { status?: unknown })?.status === "number") await trial.refund();
    return { ok: false, error: err instanceof Error ? err.message : "Generation failed" };
  }
}

// The schema, the ROOF_PLAN writer and the proposal itself live in lib/roofPackage/proposalWrite (2026-11-05), shared with the AI Operator.
export async function convertRoofEstimateToProposal(raw: unknown) {
  const { organizationId, user, role } = await requireEstimatorOrManager();
  await requirePage(organizationId, "roof-estimator");
  await enforcePlanLimit(organizationId, "proposalsCreated");
  const data = roofConvertSchema.parse(raw);
  // Started from a project, a client's page or a lead, the picker recorded where this estimate files (lib/filingContext).
  const filing = await readFilingContext(organizationId);
  const id = await writeRoofProposal({ organizationId, userId: user.id, role }, data, filing);
  if (filing) await clearFilingContext();
  return { id };
}

/* ── Opening a roof proposal again (owner, 2026-10-13) ──────────────────────
 *
 * "Make roofing proposal when open to get back to the roofing edit to rebuild
 * it." The builder's "Edit the roof estimate" opens the estimator on
 * ?proposal=<id>: loadRoofFromProposal hands back the measurement (or the hand
 * takeoff), the package choices and the estimator's lines as the proposal has
 * them now; updateRoofProposal re-prices THAT proposal through the builder's
 * own save, by the deck's rules (lib/deck/proposalEdit — signed/paid/finished
 * is refused, the builder's own lines stay, hand-typed title/scope stay).
 * A roof proposal from before the plan was kept opens on its site photo's
 * measurement, with every line as the estimator's.
 */

/** The proposal the estimator works on, as the page shows it; null when gone or another company's. */
async function linkedRoofProposal(g: { organizationId: string; userId: string; role: string }, proposalId: string): Promise<LinkedDeckProposal | null> {
  const p = await db.proposal
    .findFirst({ where: { id: proposalId, organizationId: g.organizationId }, select: { id: true, publicId: true, title: true, status: true, ownerId: true, installments: { select: { status: true, paidAmount: true } } } })
    .catch(() => null);
  if (!p) return null;
  // An estimator works on their own proposals only (requireProposalStaff's scope).
  const theirs = (isSalesRole(g.role) || isEstimatorRole(g.role)) && p.ownerId !== g.userId;
  return { id: p.id, ref: proposalRef(p.publicId), title: p.title, status: p.status, lock: deckProposalLock(p.status, p.installments) ?? (theirs ? "theirs" : null), seen: deckProposalSeen(p.status) };
}

/** A Lead Center lead's hidden estimate (lib/leadCenter/estimate, 2026-10-27), as the form reopens a proposal: a hand
 *  takeoff, the spec with the homeowner's choices, every line, the scope and the assumptions — only this company's
 *  own matched lead. No measurement, no linked proposal: Convert makes a new one. */
export type RoofFromLead = {
  ok: true;
  manual: RoofManualTakeoff;
  spec: RoofPackageSpec;
  title: string;
  scope: string;
  assumptions: string[];
  materials: RoofTableLine[];
  labor: RoofTableLine[];
  /** The pin the homeowner confirmed: a Measure click reads this building. */
  pin: { lat: number; lng: number } | null;
  /** Where the homeowner's number came from — the toast says which. */
  basis: "solar" | "size";
};

export async function openRoofLeadEstimate(platformLeadId: string): Promise<RoofFromLead | { ok: false; error: string; none?: boolean }> {
  const { organizationId } = await requireEstimatorOrManager();
  await requirePage(organizationId, "roof-estimator");
  const id = String(platformLeadId ?? "");
  if (!id || id.length > 64) return { ok: false, error: "No lead." };
  const pl = await db.platformLead.findFirst({ where: { id, matchedOrgId: organizationId }, select: { address: true, city: true, state: true, zip: true, lat: true, lng: true } });
  if (!pl) return { ok: false, error: "That lead is not this company's." };
  const e = (await readLeadEstimates([id])).get(id);
  if (!e) return { ok: false, error: "This lead carries no priced estimate.", none: true };
  // A house estimate of another trade (2026-10-28) is the other estimator's to open — never read as a roof.
  if (e.trade !== "roof") return { ok: false, error: `This lead's estimate opens in the ${estimatorNameFor(e.trade)} — use that card.` };
  const address = [pl.address, pl.city, [pl.state, pl.zip].filter(Boolean).join(" ")].filter((s) => s && s.trim()).join(", ") || null;
  const r = reopenFromEstimate(e, address);
  return { ok: true, ...r, pin: pl.lat != null && pl.lng != null ? { lat: pl.lat, lng: pl.lng } : null, basis: e.basis };
}

export type RoofFromProposal = {
  ok: true;
  proposal: LinkedDeckProposal;
  measurementId: string | null;
  manual: RoofManualTakeoff | null;
  spec: RoofPackageSpec | null;
  factsKey: string | null;
  extra: number[];
  /** The main building when the proposal was made; null on older plans. */
  mainIndex: number | null;
  pitchEntered: string | null;
  address: string | null;
  title: string;
  scope: string;
  assumptions: string[];
  materials: RoofTableLine[];
  labor: RoofTableLine[];
  /** Lines added in the builder: they stay on the proposal, after the estimator's. */
  others: number;
  /** No plan was kept (an older proposal): the page says what it could bring back. */
  older: boolean;
};

export async function loadRoofFromProposal(proposalId: string): Promise<RoofFromProposal | { ok: false; error: string }> {
  const { organizationId, user, role } = await requireEstimatorOrManager();
  await requirePage(organizationId, "roof-estimator");
  const g = { organizationId, userId: user.id, role };
  const linked = await linkedRoofProposal(g, String(proposalId ?? ""));
  if (!linked) return { ok: false, error: "That proposal is gone, or it is another company's." };
  const [row, ev] = await Promise.all([
    db.proposal.findFirst({
      where: { id: linked.id, organizationId },
      select: {
        trade: true,
        title: true,
        scopeOfWork: true,
        address: true,
        lineItems: { orderBy: { position: "asc" }, select: { name: true, measurementType: true, quantity: true, unitPrice: true, materialCost: true, laborCost: true } },
      },
    }),
    db.activityEvent.findFirst({ where: { proposalId: linked.id, organizationId, kind: ROOF_PLAN_EVENT }, orderBy: { createdAt: "desc" }, select: { meta: true } }).catch(() => null),
  ]);
  if (!row) return { ok: false, error: "That proposal is gone, or it is another company's." };
  let plan = null as ReturnType<typeof readRoofPlan>;
  try {
    plan = ev?.meta ? readRoofPlan(JSON.parse(ev.meta)) : null;
  } catch {
    plan = null;
  }
  if (!plan && row.trade !== "roof") return { ok: false, error: "That proposal was not made in the roof estimator." };
  // The measurement: the plan's, else the proposal's site photo (every roof convert links it).
  let measurementId = plan?.measurementId ?? null;
  if (!measurementId && !plan?.manual) {
    const photo = await db.proposalSitePhoto.findFirst({ where: { proposalId: linked.id }, select: { roofMeasurementId: true } }).catch(() => null);
    measurementId = photo?.roofMeasurementId ?? null;
  }
  // Only this company's measurement opens.
  if (measurementId) {
    const own = await db.roofMeasurement.findFirst({ where: { id: measurementId, organizationId }, select: { id: true } }).catch(() => null);
    if (!own) measurementId = null;
  }
  const tables = roofTablesFromProposal(row.lineItems, plan?.written ?? null);
  return {
    ok: true,
    proposal: linked,
    measurementId,
    manual: plan?.manual ?? null,
    spec: plan?.spec ?? null,
    factsKey: plan?.factsKey ?? null,
    extra: plan?.extra ?? [],
    mainIndex: plan?.mainIndex ?? null,
    pitchEntered: plan?.pitchEntered ?? null,
    address: row.address ?? plan?.address ?? null,
    title: row.title,
    scope: row.scopeOfWork ?? "",
    assumptions: plan?.assumptions ?? [],
    materials: tables.materials,
    labor: tables.labor,
    others: tables.others,
    older: !plan,
  };
}

const lineInput = z.object({ name: z.string().max(300), quantity: z.number().finite().min(0).max(10_000_000), unitPrice: z.number().finite().min(0).max(10_000_000), unit: z.string().max(40).optional() });
const roofUpdateSchema = z.object({
  proposalId: z.string().min(1).max(64),
  title: z.string().max(300),
  scope: z.string().max(20_000).optional(),
  materials: z.array(lineInput).max(300),
  labor: z.array(lineInput).max(300),
  measurementId: z.string().max(64).optional().nullable(),
  address: z.string().max(300).optional().nullable(),
  plan: roofPlanInput.optional().nullable(),
});

export type RoofUpdateResult =
  | { ok: true; id: string; kept: number; titleKept: boolean; scopeKept: boolean }
  | { ok: false; code: "LOCKED"; lock: DeckProposalLock; error: string }
  | { ok: false; code: "MISSING" | "INVALID" | "FAILED"; error: string };

export async function updateRoofProposal(raw: unknown): Promise<RoofUpdateResult> {
  const { organizationId, user, role } = await requireEstimatorOrManager();
  await requirePage(organizationId, "roof-estimator");
  const parsed = roofUpdateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, code: "INVALID", error: parsed.error.issues[0]?.message ?? "Those lines could not be read." };
  const data = parsed.data;
  if (!data.materials.length && !data.labor.length) return { ok: false, code: "INVALID", error: "Build the estimate first — there are no lines to put on the proposal." };
  const g = { organizationId, userId: user.id, role };
  const missing = { ok: false as const, code: "MISSING" as const, error: "That proposal is gone. Save the estimate as a new proposal." };
  try {
    const linked = await linkedRoofProposal(g, data.proposalId);
    if (!linked) return missing;
    if (linked.lock) return { ok: false, code: "LOCKED", lock: linked.lock, error: `This proposal is ${DECK_LOCK_WORDS[linked.lock]}, so its price stays as it is. Save the new estimate as a new proposal.` };
    const [row, org, ev] = await Promise.all([
      db.proposal.findFirst({
        where: { id: linked.id, organizationId },
        include: { lineItems: { orderBy: { position: "asc" } }, installments: { orderBy: { position: "asc" } }, discounts: true },
      }),
      db.organization.findUnique({ where: { id: organizationId }, select: { defaultTaxRate: true, materialMarkupPct: true, laborMarkupPct: true } }),
      db.activityEvent.findFirst({ where: { proposalId: linked.id, organizationId, kind: ROOF_PLAN_EVENT }, orderBy: { createdAt: "desc" }, select: { meta: true } }).catch(() => null),
    ]);
    if (!row) return missing;
    let before = null as ReturnType<typeof readRoofPlan>;
    try {
      before = ev?.meta ? readRoofPlan(JSON.parse(ev.meta)) : null;
    } catch {
      before = null;
    }
    // The measurement's own address wins, as at the convert.
    let measurementId: string | null = null;
    let address = data.address?.trim() || null;
    if (data.measurementId) {
      const m = await db.roofMeasurement.findFirst({ where: { id: data.measurementId, organizationId }, select: { id: true, address: true, city: true, state: true, zip: true } }).catch(() => null);
      if (m) {
        measurementId = m.id;
        address = [m.address, [m.city, m.state].filter(Boolean).join(", "), m.zip].filter(Boolean).join(", ") || address;
      }
    }
    const lines = [
      ...data.materials.map((l) => ({ name: l.name, quantity: l.quantity, unit: l.unit, materialCost: l.unitPrice, laborCost: 0 })),
      ...data.labor.map((l) => ({ name: l.name, quantity: l.quantity, unit: l.unit, materialCost: 0, laborCost: l.unitPrice })),
    ].filter((l) => l.name.trim());
    const next = deckUpdatePayload(
      row,
      // An older roof proposal has no record of its lines: every line is the estimator's, and its title follows.
      { written: before?.written ?? null, oldWords: before?.written ? null : row.title.split(" · ")[0] || null },
      { title: data.title, scope: data.scope ?? "", address, lines },
      org,
      unitToType,
    );
    await saveProposal(next.payload);
    // The house photo follows a re-measured roof.
    if (measurementId) {
      await db.proposalSitePhoto.deleteMany({ where: { proposalId: row.id, NOT: { roofMeasurementId: measurementId } } }).catch(() => {});
      const has = await db.proposalSitePhoto.findFirst({ where: { proposalId: row.id, roofMeasurementId: measurementId }, select: { id: true } }).catch(() => null);
      if (!has) await db.proposalSitePhoto.create({ data: { proposalId: row.id, roofMeasurementId: measurementId } }).catch(() => {});
    }
    await writeRoofPlan(g, row.id, data.plan, { measurementId, address: next.payload.address || null, written: next.written }, `Roof estimate changed — ${money(Math.round(next.subtotal))}`);
    await logActivity({ organizationId, actorId: user.id, kind: TRAIL_KINDS.ESTIMATE, proposalId: row.id, summary: `Re-priced the roof from the estimator — ${money(Math.round(next.subtotal))}`, meta: { trade: "roof", amount: Math.round(next.subtotal) } });
    revalidatePath("/dashboard/proposals");
    return { ok: true, id: row.id, kept: next.kept, titleKept: next.titleKept, scopeKept: next.scopeKept };
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (/already paid|being paid/.test(message)) return { ok: false, code: "LOCKED", lock: "paid", error: `${message}. Save the new estimate as a new proposal.` };
    if (message === "Not found") return { ok: false, code: "LOCKED", lock: "theirs", error: `This proposal is ${DECK_LOCK_WORDS.theirs}. Save the estimate as a new proposal.` };
    logServerError("roof-update", err, { kind: "action", organizationId });
    return { ok: false, code: "FAILED", error: "The proposal could not be updated. Try again in a moment; if it keeps failing, tell support the time it happened." };
  }
}

