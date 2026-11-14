// THE ROOF REPORT — WHAT IT SAYS (2026-11-13). Owner: "let contractor buy just a roof report from the address and
// convert in pdf … before build show me how report will look like" — then, with the sample shown and the five
// choices taken as suggested, "lets do … but show it only for admin for testing".
//
// One measured roof turned into the report's content: the cover's figures, the facets and lines drawings (plan
// geometry in points), the waste table, the order list (contractor's copy only), the facts about the roof and how it
// was measured. Pure — the PDF (lib/pdf/RoofReportPdf) lays it out; the server (./server) loads what it reads.
//
// Where each number comes from, so the report never claims more than it knows:
//   · the roof's area and main pitch: EagleView's measurement when there is one (the report's headline), else the
//     facet drawing's own total, said so;
//   · the facets, the lines and their lengths: the facet engine (lib/roofFacets) reading Google's height map inside
//     the roof's outline — the drawing's confidence is printed beside them;
//   · the waste and the order list: arithmetic on those, with the rule written beside each line.

import { FACET_EDGE_TYPES, FACET_EDGE_USE, FACET_EDGE_WORDS, type FacetEdgeType, type FacetModel } from "../roofFacets/model";
import type { InstantRoofData, InstantStructure } from "../eagleview";

export type RoofReportCopy = "contractor" | "homeowner";

export interface RoofReportCompany {
  name: string;
  phone: string | null;
  website: string | null;
  address: string | null;
  /** PNG/JPEG data URL, or null (no logo printed) */
  logoSrc: string | null;
}

export interface RoofReportInput {
  copy: RoofReportCopy;
  measurement: { id: string; address: string | null; city: string | null; state: string | null; zip: string | null; measuredAt: Date; areaSqft: number | null; predominantPitch: string | null };
  instant: InstantRoofData | null;
  model: FacetModel;
  /** the picture's patch of ground (UTM metres): its top-left corner and size — the aerial photo is cut to it */
  window: { e0: number; n0: number; widthM: number; heightM: number };
  imagery: { date: string | null; quality: string | null };
  company: RoofReportCompany;
  /** when the report is made */
  now: Date;
}

export interface PlanPoint {
  x: number;
  y: number;
}

/** A drawing in its own unit (feet), ready to be scaled into a box. */
export interface PlanDrawing {
  /** feet; x east, y south (down the page) */
  width: number;
  height: number;
  facets: Array<{ letter: string; rings: PlanPoint[][]; label: PlanPoint; roomy: boolean; areaSqft: number; pitchLabel: string; pitch12: number }>;
  edges: Array<{ a: PlanPoint; b: PlanPoint; type: FacetEdgeType; lengthFt: number }>;
}

export interface WasteRow {
  pct: number;
  areaSqft: number;
  squares: number;
  suggested: boolean;
}

export interface OrderLine {
  item: string;
  qty: number;
  unit: string;
  /** how the count is made, in words */
  rule: string;
}

export interface RoofReportData {
  copy: RoofReportCopy;
  number: string;
  dateWords: string;
  company: RoofReportCompany;
  address: { line1: string; line2: string };
  /** the headline: total roof area, squares, main pitch, facets, stories */
  headline: { areaSqft: number; squares: number; pitch: string; facets: number; stories: number | null; areaFrom: "eagleview" | "drawing" };
  /** squares to order at the suggested waste, rounded up to a third */
  orderSquares: number;
  suggestedWastePct: number;
  roofAgeYears: number | null;
  lines: Array<{ type: FacetEdgeType; words: string; feet: number; count: number; use: string }>;
  confidence: FacetModel["confidence"];
  facetsTable: Array<{ letter: string; part: string; pitch: string; facing: string; areaSqft: number }>;
  plan: PlanDrawing;
  /** the aerial picture's frame, and the outline drawn on it, in the picture's own metres (x right, y down) */
  photo: { widthM: number; heightM: number; outline: PlanPoint[][]; date: string | null };
  waste: WasteRow[];
  order: OrderLine[];
  facts: Array<{ label: string; value: string }>;
  eaves: Array<{ side: string; feet: number }>;
  checkOnSite: string[];
  howMeasured: string[];
  compare: { eagleViewSqft: number | null; drawingSqft: number; deltaPct: number | null };
}

const FT_PER_M = 3.28084;
const r1 = (n: number) => Math.round(n * 10) / 10;
const whole = (n: number) => Math.round(n).toLocaleString("en-US");
/** squares rounded UP to the nearest third — the way shingles are bought (three bundles a square) */
export const squaresToThird = (sqft: number): number => Math.ceil((sqft / 100) * 3 - 1e-9) / 3;
export const squaresWords = (sq: number): string => {
  const w = Math.floor(sq + 1e-9);
  const thirds = Math.round((sq - w) * 3);
  return thirds === 0 ? String(w) : `${w ? `${w} ` : ""}${thirds}/3`;
};

/** The waste a roof's cuts ask for: 8% on a plain roof, more for every hip and valley line, 20% at most. */
export function suggestedWaste(model: Pick<FacetModel, "totals">): number {
  const cuts = model.totals.count.HIP + model.totals.count.VALLEY;
  return Math.min(20, 8 + Math.round((cuts * 2) / 3));
}

/** The waste table: the area and the squares (to a third) at 0–22%. */
export function wasteTable(areaSqft: number, suggested: number): WasteRow[] {
  const pcts = [...new Set([0, 5, 10, suggested, 15, 17, 20, 22])].sort((a, b) => a - b);
  return pcts.map((pct) => {
    const area = areaSqft * (1 + pct / 100);
    return { pct, areaSqft: Math.round(area), squares: squaresToThird(area), suggested: pct === suggested };
  });
}

/** What to order for an asphalt-shingle roof, from its area, the squares at the waste chosen and the lines. */
export function orderList(areaSqft: number, orderSquares: number, feet: Record<FacetEdgeType, number>, stepPieces: number): OrderLine[] {
  const iceFt = feet.EAVE + feet.VALLEY;
  const out: OrderLine[] = [
    { item: "Architectural shingles", qty: Math.ceil(orderSquares * 3 - 1e-9), unit: "bundles", rule: `${squaresWords(orderSquares)} squares × 3 bundles` },
    { item: "Starter strip", qty: Math.ceil((feet.EAVE + feet.RAKE) / 120 - 1e-9), unit: "bundles", rule: `eaves + rakes, ${whole(feet.EAVE + feet.RAKE)} ft ÷ 120 ft a bundle` },
    { item: "Hip and ridge cap", qty: Math.ceil((feet.RIDGE + feet.HIP) / 25 - 1e-9), unit: "bundles", rule: `ridges + hips, ${whole(feet.RIDGE + feet.HIP)} ft ÷ 25 ft a bundle` },
    { item: "Ice and water shield", qty: Math.ceil(iceFt / 65 - 1e-9), unit: "rolls", rule: `eaves + valleys, ${whole(iceFt)} ft ÷ 65 ft a roll` },
    { item: "Synthetic underlayment", qty: Math.max(1, Math.ceil((areaSqft * 1.12 - iceFt * 3) / 1000 - 1e-9)), unit: "rolls", rule: "the area + 12%, less the ice and water, ÷ 1,000 sq ft a roll" },
    { item: "Drip edge, 10 ft", qty: Math.ceil(((feet.EAVE + feet.RAKE) * 1.05) / 10 - 1e-9), unit: "pieces", rule: `eaves + rakes + 5%, ${whole(feet.EAVE + feet.RAKE)} ft` },
  ];
  if (feet.VALLEY > 0) out.push({ item: "Valley metal, 10 ft", qty: Math.ceil((feet.VALLEY * 1.05) / 10 - 1e-9), unit: "pieces", rule: `valleys + 5%, ${whole(feet.VALLEY)} ft (open valleys)` });
  if (feet.STEP > 0) out.push({ item: "Step flashing", qty: stepPieces, unit: "pieces", rule: `one a 5-in. course along ${whole(feet.STEP)} ft of side wall, 2 spare a run` });
  if (feet.WALL > 0) out.push({ item: "Wall (apron) flashing, 10 ft", qty: Math.ceil(feet.WALL / 10 - 1e-9), unit: "pieces", rule: `${whole(feet.WALL)} ft of wall above the roof` });
  if (feet.RIDGE > 0) out.push({ item: "Ridge vent, 4 ft", qty: Math.ceil(feet.RIDGE / 4 - 1e-9), unit: "pieces", rule: `${whole(feet.RIDGE)} ft of ridge, if the roof is vented there` });
  out.push({ item: "Coil roofing nails", qty: Math.max(1, Math.ceil((orderSquares * 300) / 7200 - 1e-9)), unit: "boxes", rule: "300 a square, 7,200 a box" });
  return out;
}

/** A point well inside a polygon for its label: the inside grid point farthest from every edge. */
function labelPoint(rings: PlanPoint[][]): { at: PlanPoint; room: number } {
  const outer = rings[0];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of outer) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  const inside = (x: number, y: number) => {
    let odd = false;
    for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) odd = !odd;
    }
    return odd;
  };
  const distToEdges = (x: number, y: number) => {
    let d = Infinity;
    for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[j], b = ring[i];
      const dx = b.x - a.x, dy = b.y - a.y;
      const t = dx || dy ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy))) : 0;
      d = Math.min(d, Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy)));
    }
    return d;
  };
  let best = { at: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }, room: -1 };
  const N = 24;
  for (let i = 1; i < N; i++) for (let j = 1; j < N; j++) {
    const x = minX + ((maxX - minX) * i) / N, y = minY + ((maxY - minY) * j) / N;
    if (!inside(x, y)) continue;
    const d = distToEdges(x, y);
    if (d > best.room) best = { at: { x, y }, room: d };
  }
  return best.room < 0 ? { at: best.at, room: 0 } : best;
}

/** The facets and the lines in plan, feet, north up, cropped to the roof with a margin. */
export function planDrawing(model: FacetModel): PlanDrawing {
  const raw = model.vertices.map((v) => ({ x: v.e * FT_PER_M, y: -v.n * FT_PER_M }));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of raw) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  const pad = Math.max(maxX - minX, maxY - minY) * 0.06 + 1;
  const pts = raw.map((p) => ({ x: p.x - minX + pad, y: p.y - minY + pad }));
  return {
    width: maxX - minX + 2 * pad,
    height: maxY - minY + 2 * pad,
    facets: model.facets.map((f) => {
      const rings = [f.outer, ...f.holes].map((ring) => ring.map((i) => pts[i]));
      const lp = labelPoint(rings);
      return { letter: f.letter, rings, label: lp.at, roomy: lp.room >= 3.2, areaSqft: f.areaSqft, pitchLabel: f.pitchLabel, pitch12: f.pitch12 };
    }),
    edges: model.edges.map((e) => ({ a: pts[e.a], b: pts[e.b], type: e.type, lengthFt: e.lengthFt })),
  };
}

const FACING_WORDS: Record<string, string> = { N: "North", NE: "North-east", E: "East", SE: "South-east", S: "South", SW: "South-west", W: "West", NW: "North-west" };
const CLASS_WORDS = (v: string | null): string | null => {
  if (!v) return null;
  const t = v.replace(/^(roof_)?(occlusion|tree_overhang|roof_material|material|roof_condition|condition|roof_shape|shape)_?/i, "").replace(/_/g, " ").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : null;
};

/** The main building: the one the measurement counts (the largest roof). */
function mainStructure(instant: InstantRoofData | null): InstantStructure | null {
  if (!instant?.structures?.length) return null;
  return [...instant.structures].sort((a, b) => (b.areaSqft ?? 0) - (a.areaSqft ?? 0))[0];
}

/** Stories from the eave height: a storey is about 10 ft; a single-storey eave sits near 9–12 ft. */
export function storiesFromEave(eaveFt: number | null): number | null {
  if (eaveFt == null || !(eaveFt > 0)) return null;
  return eaveFt <= 14 ? 1 : eaveFt <= 24 ? 2 : 3;
}

function stepPiecesFor(model: FacetModel): number {
  let n = 0;
  for (const e of model.edges) if (e.type === "STEP") n += Math.ceil((e.lengthFt * 12) / 5 - 1e-9) + 2;
  return n;
}

const SIDE_WORDS: Record<string, string> = { N: "North", E: "East", S: "South", W: "West" };

export function roofReportData(input: RoofReportInput): RoofReportData {
  const { model, instant, measurement: m, company, copy } = input;
  const main = mainStructure(instant);
  const drawingSqft = model.totals.areaSqft;
  const evSqft = instant?.totals?.areaSqft && instant.totals.areaSqft > 0 ? instant.totals.areaSqft : m.areaSqft && m.areaSqft > 0 ? m.areaSqft : null;
  const areaSqft = evSqft ?? drawingSqft;
  const pitch = instant?.totals?.pitchLabel ?? m.predominantPitch ?? model.totals.predominantPitch ?? "—";
  const suggested = suggestedWaste(model);
  const waste = wasteTable(areaSqft, suggested);
  const orderSquares = waste.find((w) => w.suggested)!.squares;
  const eaveMax = instant?.totals?.maxEaveFt ?? (main?.eaveHeightFt ? Math.max(...Object.values(main.eaveHeightFt)) : null);
  const feet = model.totals.feet;
  const lines = FACET_EDGE_TYPES.filter((t) => model.totals.count[t] > 0 && t !== "BREAK").map((t) => ({ type: t, words: FACET_EDGE_WORDS[t], feet: Math.round(feet[t]), count: model.totals.count[t], use: FACET_EDGE_USE[t] }));
  if (model.totals.count.BREAK > 0) lines.push({ type: "BREAK", words: FACET_EDGE_WORDS.BREAK, feet: Math.round(feet.BREAK), count: model.totals.count.BREAK, use: FACET_EDGE_USE.BREAK });
  const plan = planDrawing(model);
  const w = input.window;
  const photoOutline = model.facets.map((f) => f.outer.map((i) => ({ x: model.vertices[i].e - w.e0, y: w.n0 - model.vertices[i].n })));

  const facts: Array<{ label: string; value: string }> = [];
  const add = (label: string, value: string | null | undefined) => {
    if (value) facts.push({ label, value });
  };
  add("Roofing", CLASS_WORDS(main?.material ?? null));
  add("Condition", CLASS_WORDS(main?.conditionRating ?? null));
  add("Roof age", main?.roofAgeYears != null ? `About ${Math.round(main.roofAgeYears)} years` : null);
  add("Roof shape", CLASS_WORDS(main?.shape ?? null));
  add("Chimney", main?.chimney == null ? null : main.chimney ? "Yes" : "None seen");
  add("Solar panels", main?.solarPanels == null ? null : main.solarPanels ? "Yes" : "None");
  add("Rooftop AC units", main?.rooftopAcCount == null ? null : String(main.rooftopAcCount));
  add("Trees over the roof", CLASS_WORDS(main?.treeOverhang ?? null));
  add("Roof hidden from above", CLASS_WORDS(main?.occlusion ?? null));
  add("Footprint", main?.footprintSqft ? `${whole(main.footprintSqft)} sq ft on the ground` : null);
  const eaves = main?.eaveHeightFt ? Object.entries(main.eaveHeightFt).map(([k, v]) => ({ side: SIDE_WORDS[k.toUpperCase()] ?? k, feet: r1(v) })) : [];

  const checkOnSite: string[] = [];
  checkOnSite.push("How many layers of shingles come off, and the decking under them (soft spots, delamination).");
  if (main?.chimney) checkOnSite.push("The chimney: its cricket, counter-flashing and cap.");
  checkOnSite.push("Pipe boots, vents and skylights — count them; they are not on the drawing.");
  if (feet.STEP > 0 || feet.WALL > 0) checkOnSite.push("Where the roof meets a wall: whether the siding comes off to flash it.");
  if (model.leftOut && model.leftOut.deckSqft >= 20) checkOnSite.push(`A deck or a lower roof under the eave (about ${whole(model.leftOut.deckSqft)} sq ft) was left out of the drawing — check whether it is roofed.`);
  if (model.leftOut && model.leftOut.lowSqft >= 20) checkOnSite.push(`About ${whole(model.leftOut.lowSqft)} sq ft lower than the roof (a porch or a patio cover?) was left out — check it.`);
  if (model.confidence.level !== "high") checkOnSite.push("Tape the lines that matter most for the order — the drawing's confidence is not high (see How it was measured).");
  checkOnSite.push("Gutters, and whether they come off for the drip edge.");

  const howMeasured: string[] = [];
  if (evSqft) howMeasured.push(`Total area and main pitch: EagleView's aerial measurement of the roof${instant?.imagery?.[0]?.shotDate ? ` (imagery of ${instant.imagery[0].shotDate.slice(0, 10)})` : ""}.`);
  else howMeasured.push("Total area and main pitch: read off Google's 3D height map of the roof (no EagleView measurement for this address).");
  howMeasured.push(`Roof faces and lines: drawn from Google's 3D height map${input.imagery.date ? ` (imagery of ${input.imagery.date})` : ""} inside ${model.outlineFrom === "eagleview" ? "EagleView's outline of the roof" : "the roof's outline read off that height map"}. Lengths are along the slope.`);
  if (evSqft) {
    const delta = Math.round(((drawingSqft - evSqft) / evSqft) * 1000) / 10;
    howMeasured.push(`The faces add up to ${whole(drawingSqft)} sq ft — ${Math.abs(delta) < 0.1 ? "the same as" : `${Math.abs(delta)}% ${delta > 0 ? "over" : "under"}`} EagleView's ${whole(evSqft)} sq ft. The headline and the order use EagleView's.`);
  }
  howMeasured.push(`Drawing confidence: ${model.confidence.level}${model.confidence.reasons.length ? ` — ${model.confidence.reasons.slice(0, 3).join("; ")}` : ""}.`);
  howMeasured.push("Waste, squares and the order list are arithmetic on these figures; each line says its rule. Measured from above: confirm on site before ordering.");

  const placeLine = [m.city, [m.state, m.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return {
    copy,
    number: `RR-${String(input.now.getFullYear()).slice(2)}-${m.id.slice(-6).toUpperCase()}`,
    dateWords: input.now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
    company,
    address: { line1: m.address?.trim() || "Address not given", line2: placeLine },
    headline: { areaSqft: Math.round(areaSqft), squares: Math.round((areaSqft / 100) * 10) / 10, pitch, facets: model.facets.length, stories: storiesFromEave(eaveMax), areaFrom: evSqft ? "eagleview" : "drawing" },
    orderSquares,
    suggestedWastePct: suggested,
    roofAgeYears: main?.roofAgeYears ?? null,
    lines,
    confidence: model.confidence,
    facetsTable: model.facets.map((f) => ({ letter: f.letter, part: f.part, pitch: f.pitchLabel, facing: f.facing ? FACING_WORDS[f.facing] ?? f.facing : "—", areaSqft: Math.round(f.areaSqft) })),
    plan,
    photo: { widthM: w.widthM, heightM: w.heightM, outline: photoOutline, date: input.imagery.date },
    waste,
    order: orderList(areaSqft, orderSquares, feet, stepPiecesFor(model)),
    facts,
    eaves,
    checkOnSite,
    howMeasured,
    compare: { eagleViewSqft: evSqft, drawingSqft: Math.round(drawingSqft), deltaPct: model.compare.areaDeltaPct },
  };
}
