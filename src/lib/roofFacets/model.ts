// ROOF FACETS — THE DRAWING AS THE PAGE READS IT (2026-11-11). The engine (./engine) answers in raster pixels and
// metres; this turns that into what a person reads and a screen draws: facets lettered A, B, C… largest first, areas
// in square feet, pitches as a rise over 12, the way each facet faces, every edge's length in feet, the totals per
// kind of edge, how the drawing compares with EagleView's own figures for the same roof, and a plain-words
// confidence. Pure, and safe to import from a client component (types and arithmetic only).

import type { EngineResult, FacetEdgeType } from "./engine";
import { fromUtm, pixelToUtm, type RasterFrame } from "./geo";

export type { FacetEdgeType } from "./engine";

/** The kinds of edge in the order a roof report lists them. */
export const FACET_EDGE_TYPES: FacetEdgeType[] = ["EAVE", "RAKE", "RIDGE", "HIP", "VALLEY", "STEP", "WALL", "BREAK"];

/** What each kind of edge is called on the page (plural, as a report's legend has them). */
export const FACET_EDGE_WORDS: Record<FacetEdgeType, string> = {
  EAVE: "Eaves",
  RAKE: "Rakes",
  RIDGE: "Ridges",
  HIP: "Hips",
  VALLEY: "Valleys",
  STEP: "Step flashing",
  WALL: "Wall flashing",
  BREAK: "Pitch changes",
};

/** What a roofer buys or does along each kind of edge. */
export const FACET_EDGE_USE: Record<FacetEdgeType, string> = {
  EAVE: "Drip edge, starter, ice and water",
  RAKE: "Drip edge, starter",
  RIDGE: "Ridge cap, ridge vent",
  HIP: "Ridge cap",
  VALLEY: "Ice and water, valley metal",
  STEP: "Roof meets a side wall",
  WALL: "Roof meets a wall above it",
  BREAK: "One pitch changes to another",
};

export interface FacetModelFacet {
  letter: string;
  /** which part of the roof it belongs to: facets joined by ridges, hips and valleys are one part ("Main roof", "Section 2", …) */
  part: string;
  /** vertex indices round the outside, then round each hole */
  outer: number[];
  holes: number[][];
  /** rise per 12, to one decimal; `pitchLabel` is what is printed ("6/12", "flat") */
  pitch12: number;
  pitchLabel: string;
  /** compass bearing the water runs, and its word (N, NE, …); null when flat */
  azimuthDeg: number | null;
  facing: string | null;
  planSqft: number;
  areaSqft: number;
  /** true when one of Google's roof segments stands behind the plane */
  google: boolean;
}

export interface FacetModelEdge {
  a: number;
  b: number;
  type: FacetEdgeType;
  lengthFt: number;
  /** facet indices either side; -1 is the outside */
  left: number;
  right: number;
}

export interface FacetModel {
  /** UTM metres (e east, n north) — the picture is cut in the same frame — and lat/lng on Google's imagery */
  vertices: Array<{ e: number; n: number; lat: number; lng: number }>;
  epsg: number;
  facets: FacetModelFacet[];
  edges: FacetModelEdge[];
  totals: {
    areaSqft: number;
    squares: number;
    facets: number;
    /** the pitch most of the roof's area has */
    predominantPitch: string | null;
    feet: Record<FacetEdgeType, number>;
    /** how many straight runs of each kind */
    count: Record<FacetEdgeType, number>;
  };
  /** whose outline the facets were drawn inside: EagleView's, or (a roof measured from Google alone) Google's own */
  outlineFrom: "eagleview" | "google";
  /**
   * What lay inside Google's building outline and is not drawn, plan square feet: lower than a roof (a driveway, a
   * patio), a deck a storey under the eave, the strip beside a wall, and what falls away past the roof's edge.
   * Null when the outline was not read off the height map.
   */
  leftOut: { lowSqft: number; deckSqft: number; besideWallSqft: number; pastEdgeSqft: number } | null;
  compare: {
    /** whose figures these are: "EagleView", or "Google" for a roof measured from Google alone (its own estimate) */
    reference: string;
    eagleViewSqft: number | null;
    eagleViewFacets: number | null;
    eagleViewPitch: string | null;
    googleSegments: number;
    /** the drawing's area against EagleView's, percent (positive = the drawing is larger) */
    areaDeltaPct: number | null;
  };
  confidence: { level: "high" | "medium" | "low"; score: number; reasons: string[] };
  /** how far EagleView's outline was moved to sit on Google's height map, feet */
  shiftFt: { east: number; north: number };
  quality: { agree: number; rmsFt: number };
  /** what the engine decided and why, in its own words (the lab shows it on request) */
  notes: string[];
}

const FT_PER_M = 3.28084;
const SQFT_PER_M2 = 10.7639;
const r1 = (n: number) => Math.round(n * 10) / 10;

export const facetLetter = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26)));

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
export const facingWord = (deg: number | null): string | null => (deg == null ? null : COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]);

export function pitchLabel(rise12: number): string {
  const whole = Math.round(rise12);
  return whole < 1 ? (rise12 < 0.35 ? "flat" : "low slope") : `${whole}/12`;
}

export function toFacetModel(input: {
  result: EngineResult;
  frame: RasterFrame;
  eagleView: { areaSqft: number | null; facetCount: number | null; pitch: string | null };
  /** whose figures `eagleView` holds — "EagleView" unless said otherwise ("Google" for a Google-only estimate) */
  reference?: string;
  outlineFrom?: "eagleview" | "google";
  /**
   * Plan square feet that lay inside the reference's own outline and that the drawing leaves out as not roof (a deck,
   * a driveway, the strip beside a wall — ./roofOutline). The reference's area still counts them.
   */
  leftOut?: FacetModel["leftOut"];
  notes?: string[];
}): FacetModel {
  const ref = input.reference ?? "EagleView";
  const refs = `${ref}'s`;
  const { result, frame } = input;
  const vertices = result.vertices.map((p) => {
    const u = pixelToUtm(frame, p.x, p.y);
    return { ...u, ...fromUtm(u.e, u.n, frame.epsg) };
  });
  // letters go by size
  const order = result.facets.map((_, i) => i).sort((a, b) => result.facets[b].areaM2 - result.facets[a].areaM2);
  const newIndex = new Map<number, number>();
  order.forEach((old, i) => newIndex.set(old, i));
  const facets: FacetModelFacet[] = order.map((old, i) => {
    const f = result.facets[old];
    const rise = f.slope * 12;
    return {
      letter: facetLetter(i),
      part: "Main roof",
      outer: f.outer,
      holes: f.holes,
      pitch12: r1(rise),
      pitchLabel: pitchLabel(rise),
      azimuthDeg: f.azimuthDeg == null ? null : Math.round(f.azimuthDeg),
      facing: rise < 0.35 ? null : facingWord(f.azimuthDeg),
      planSqft: r1(f.planM2 * SQFT_PER_M2),
      areaSqft: r1(f.areaM2 * SQFT_PER_M2),
      google: f.google,
    };
  });
  const edges: FacetModelEdge[] = result.edges.map((e) => ({
    a: e.a,
    b: e.b,
    type: e.type,
    lengthFt: r1(e.lengthM * FT_PER_M),
    left: e.left < 0 ? -1 : (newIndex.get(e.left) ?? -1),
    right: e.right < 0 ? -1 : (newIndex.get(e.right) ?? -1),
  }));
  const feet = Object.fromEntries(FACET_EDGE_TYPES.map((t) => [t, 0])) as Record<FacetEdgeType, number>;
  const count = Object.fromEntries(FACET_EDGE_TYPES.map((t) => [t, 0])) as Record<FacetEdgeType, number>;
  for (const e of edges) { feet[e.type] = r1(feet[e.type] + e.lengthFt); count[e.type]++; }
  // Parts: facets joined by a ridge, hip, valley or pitch change are one roof; a wall between two levels parts them.
  const root = facets.map((_, i) => i);
  const find = (a: number): number => (root[a] === a ? a : (root[a] = find(root[a])));
  for (const e of edges) if (e.left >= 0 && e.right >= 0 && e.type !== "STEP" && e.type !== "WALL") root[find(e.left)] = find(e.right);
  const partArea = new Map<number, number>();
  facets.forEach((f, i) => partArea.set(find(i), (partArea.get(find(i)) ?? 0) + f.areaSqft));
  const partOrder = [...partArea].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  facets.forEach((f, i) => { const n = partOrder.indexOf(find(i)); f.part = n === 0 ? "Main roof" : `Section ${n + 1}`; });
  const areaSqft = r1(facets.reduce((s, f) => s + f.areaSqft, 0));
  const byPitch = new Map<string, number>();
  for (const f of facets) byPitch.set(f.pitchLabel, (byPitch.get(f.pitchLabel) ?? 0) + f.areaSqft);
  const predominantPitch = [...byPitch].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const ev = input.eagleView;
  const areaDeltaPct = ev.areaSqft && ev.areaSqft > 0 ? r1(((areaSqft - ev.areaSqft) / ev.areaSqft) * 100) : null;

  // Confidence, in the open: every deduction has its sentence.
  let score = 100;
  const reasons: string[] = [];
  if (areaDeltaPct == null) {
    score -= 10;
    reasons.push(`${ref} gave no area for this roof, so the drawing's total has nothing to be checked against.`);
  } else if (Math.abs(areaDeltaPct) > 2) {
    // What the drawing left out on purpose is not a disagreement about the roof: the gap is judged without it.
    const lo = input.leftOut;
    const left = lo ? Math.max(0, Math.round(lo.lowSqft + lo.deckSqft + lo.besideWallSqft + lo.pastEdgeSqft)) : 0;
    const fair = left >= 20 && ev.areaSqft ? r1(((areaSqft + left - ev.areaSqft) / ev.areaSqft) * 100) : areaDeltaPct;
    score -= Math.min(30, Math.max(0, Math.abs(fair) - 2) * 2.5);
    reasons.push(
      `The facets add up to ${Math.abs(areaDeltaPct)}% ${areaDeltaPct > 0 ? "more" : "less"} than ${refs} area.` +
        (left >= 20 && areaDeltaPct < 0 ? ` ${left.toLocaleString("en-US")} sq ft of that is what ${ref} counted and the drawing leaves out as not roof (see the notes).` : ""),
    );
  } else {
    reasons.push(`The facets add up to within ${Math.abs(areaDeltaPct)}% of ${refs} area.`);
  }
  const agree = result.quality.agree;
  if (agree < 0.95) {
    score -= Math.min(30, (0.95 - agree) * 150);
    reasons.push(`${Math.round((1 - agree) * 100)}% of the roof does not sit on the plane drawn over it — usually trees over the roof, or small parts the height map blurs.`);
  }
  if (result.quality.rmsM > 0.15) {
    score -= Math.min(25, (result.quality.rmsM - 0.15) * 110);
    reasons.push(`The height map misses the drawn planes by ${r1(result.quality.rmsM * FT_PER_M * 12)} inches on average.`);
  }
  const inner = edges.filter((e) => e.left >= 0 && e.right >= 0);
  const innerFt = inner.reduce((s, e) => s + e.lengthFt, 0);
  const unsureFt = inner.filter((e) => e.type === "STEP" || e.type === "WALL" || e.type === "BREAK").reduce((s, e) => s + e.lengthFt, 0);
  const unsure = innerFt > 0 ? unsureFt / innerFt : 0;
  if (unsure > 0.15) {
    score -= Math.min(16, (unsure - 0.15) * 45);
    reasons.push(`${Math.round(unsure * 100)}% of the inner lines are walls or pitch changes rather than ridges, hips and valleys — a roof on several levels, or places the height map reads poorly.`);
  }
  if (ev.facetCount != null && Math.abs(facets.length - ev.facetCount) > Math.max(3, ev.facetCount * 0.3)) {
    score -= 8;
    reasons.push(`${ref} counts ${ev.facetCount} facets and the drawing has ${facets.length}.`);
  }
  score = Math.max(0, Math.round(score));

  return {
    vertices,
    epsg: frame.epsg,
    facets,
    edges,
    totals: { areaSqft, squares: r1(areaSqft / 100), facets: facets.length, predominantPitch, feet, count },
    outlineFrom: input.outlineFrom ?? "eagleview",
    leftOut: input.leftOut ?? null,
    compare: { reference: ref, eagleViewSqft: ev.areaSqft, eagleViewFacets: ev.facetCount, eagleViewPitch: ev.pitch, googleSegments: result.quality.googleSegments, areaDeltaPct },
    confidence: { level: score >= 80 ? "high" : score >= 60 ? "medium" : "low", score, reasons },
    shiftFt: { east: r1(result.shift.dx * frame.pixelSizeM * FT_PER_M), north: r1(-result.shift.dy * frame.pixelSizeM * FT_PER_M) },
    quality: { agree: Math.round(agree * 1000) / 1000, rmsFt: Math.round(result.quality.rmsM * FT_PER_M * 100) / 100 },
    notes: input.notes ?? [],
  };
}
