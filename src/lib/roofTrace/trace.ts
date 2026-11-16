// ROOF TRACE — THE ROOF'S LINES DRAWN ON THE AERIAL PHOTO (2026-11-16).
//
// Owner, 2026-11-16, with a roof photo: "imagine that you're an artist … you just draw the lines … the hips, the
// valleys, edges. With no calculations of measurements … all the sizes we already have. We just need nice diagram to
// give a contractors more confident." Then: "make this auto draw tool … deploy it to the roofing estimator", admin
// only first. This is part 1: a drawing an admin traces (or corrects) by hand on the photo, saved per measurement and
// used by the roof report in place of the facet engine's lines. Part 2 fills it in automatically.
//
// A trace is points and the lines between them. Points are UTM metres (e east, n north) — the frame the facet engine
// and the photo window already use (lib/roofFacets/server PictureWindow) — so a trace stays on the roof whatever
// window the photo is cut to. Lines share points: moving a point moves every line that meets there, which is what
// keeps a hip joined to its ridge.
//
// Pure, and safe to import from a client component.

import type { FacetEdgeType } from "@/lib/roofFacets/model";

/** The kinds a traced line can be — the same as the facet engine's, so the report's legend and colours carry over. */
export const TRACE_TYPES: FacetEdgeType[] = ["EAVE", "RAKE", "RIDGE", "HIP", "VALLEY", "STEP", "WALL", "BREAK"];

export interface TracePoint {
  e: number;
  n: number;
}
export interface TraceLine {
  a: number;
  b: number;
  type: FacetEdgeType;
}
/** Who drew it: an admin by hand, the automatic drawing (part 2), or the facet engine's lines taken as a start. */
export type TraceSource = "hand" | "auto" | "engine";

export interface RoofTraceBody {
  points: TracePoint[];
  lines: TraceLine[];
  source: TraceSource;
}
export interface RoofTrace extends RoofTraceBody {
  v: 1;
  savedAt: string;
  savedBy: string | null;
}

export const TRACE_LIMITS = { points: 2000, lines: 3000, spanM: 400 } as const;
const FT_PER_M = 3.28084;
/** Two points closer than this are the same point; a line shorter than this is no line (metres, about an inch). */
const SAME_M = 0.03;

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * A trace as it may be saved: numbers that are numbers, kinds that exist, lines between two different points that
 * exist, no line twice, no point nothing uses, and nothing spread wider than a house lot (a bad save cannot put lines
 * a mile off). The points are renumbered after the cleaning; the lines keep their order.
 */
export function cleanTrace(input: unknown): { ok: true; body: RoofTraceBody } | { ok: false; reason: string } {
  if (!input || typeof input !== "object") return { ok: false, reason: "The drawing came in empty." };
  const raw = input as { points?: unknown; lines?: unknown; source?: unknown };
  if (!Array.isArray(raw.points) || !Array.isArray(raw.lines)) return { ok: false, reason: "The drawing came in without its points or lines." };
  if (raw.points.length > TRACE_LIMITS.points || raw.lines.length > TRACE_LIMITS.lines) return { ok: false, reason: `A drawing can have up to ${TRACE_LIMITS.lines} lines.` };
  const points: TracePoint[] = [];
  for (const p of raw.points) {
    const q = p as { e?: unknown; n?: unknown } | null;
    if (!q || !num(q.e) || !num(q.n)) return { ok: false, reason: "A point of the drawing has no place on the map." };
    points.push({ e: q.e, n: q.n });
  }
  const source: TraceSource = raw.source === "auto" || raw.source === "engine" ? raw.source : "hand";
  const lines: TraceLine[] = [];
  const seen = new Set<string>();
  for (const l of raw.lines) {
    const q = l as { a?: unknown; b?: unknown; type?: unknown } | null;
    if (!q || !Number.isInteger(q.a) || !Number.isInteger(q.b)) return { ok: false, reason: "A line of the drawing does not join two points." };
    const a = q.a as number, b = q.b as number;
    if (a < 0 || b < 0 || a >= points.length || b >= points.length) return { ok: false, reason: "A line of the drawing points at a point that is not there." };
    if (!TRACE_TYPES.includes(q.type as FacetEdgeType)) return { ok: false, reason: "A line of the drawing is of an unknown kind." };
    if (a === b || Math.hypot(points[a].e - points[b].e, points[a].n - points[b].n) < SAME_M) continue;
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push({ a, b, type: q.type as FacetEdgeType });
  }
  // keep only the points the lines use, renumbered in the order first met
  const map = new Map<number, number>();
  const kept: TracePoint[] = [];
  for (const l of lines) for (const k of [l.a, l.b]) if (!map.has(k)) { map.set(k, kept.length); kept.push(points[k]); }
  const out = lines.map((l) => ({ a: map.get(l.a)!, b: map.get(l.b)!, type: l.type }));
  if (kept.length) {
    let minE = Infinity, minN = Infinity, maxE = -Infinity, maxN = -Infinity;
    for (const p of kept) { minE = Math.min(minE, p.e); maxE = Math.max(maxE, p.e); minN = Math.min(minN, p.n); maxN = Math.max(maxN, p.n); }
    if (maxE - minE > TRACE_LIMITS.spanM || maxN - minN > TRACE_LIMITS.spanM) return { ok: false, reason: "The drawing spreads wider than one roof — some lines are far off the house." };
  }
  return { ok: true, body: { points: kept, lines: out, source } };
}

/** "6/12" → 6, "flat" → 0, "6.5/12" → 6.5; anything else → null. */
export function pitchRise(label: string | null | undefined): number | null {
  if (!label) return null;
  if (/^\s*flat\s*$/i.test(label)) return 0;
  const m = /^\s*(\d+(?:\.\d+)?)\s*\/\s*12\s*$/.exec(label);
  return m ? Number(m[1]) : null;
}

/**
 * From a line's length seen from above to its length along the roof, at the roof's main pitch (rise over 12): eaves,
 * ridges, walls and pitch changes run level; rakes and step flashing climb the slope; hips and valleys run across two
 * slopes at 45° in plan, so they climb half as steeply per foot of plan.
 */
export function slopeFactor(type: FacetEdgeType, rise: number | null): number {
  const r = Math.max(0, rise ?? 0) / 12;
  if (type === "RAKE" || type === "STEP") return Math.sqrt(1 + r * r);
  if (type === "HIP" || type === "VALLEY") return Math.sqrt(1 + (r * r) / 2);
  return 1;
}

/** Every line's length in feet along the roof, in the trace's line order. */
export function traceLengthsFt(trace: Pick<RoofTraceBody, "points" | "lines">, rise: number | null): number[] {
  return trace.lines.map((l) => {
    const a = trace.points[l.a], b = trace.points[l.b];
    return Math.hypot(a.e - b.e, a.n - b.n) * FT_PER_M * slopeFactor(l.type, rise);
  });
}

/**
 * Feet and runs of each kind. A run is a straight stretch: two lines of the same kind that meet end to end and go on
 * in the same direction (within 6°) count once, so an eave drawn in three clicks is one eave.
 */
export function traceTotals(trace: Pick<RoofTraceBody, "points" | "lines">, rise: number | null): { feet: Record<FacetEdgeType, number>; count: Record<FacetEdgeType, number> } {
  const feet = Object.fromEntries(TRACE_TYPES.map((t) => [t, 0])) as Record<FacetEdgeType, number>;
  const count = Object.fromEntries(TRACE_TYPES.map((t) => [t, 0])) as Record<FacetEdgeType, number>;
  const lengths = traceLengthsFt(trace, rise);
  trace.lines.forEach((l, i) => { feet[l.type] += lengths[i]; count[l.type] += 1; });
  // each place where two same-kind lines carry straight on joins two runs into one
  const at = new Map<number, number[]>();
  trace.lines.forEach((l, i) => { for (const k of [l.a, l.b]) at.set(k, [...(at.get(k) ?? []), i]); });
  for (const [k, ids] of at) {
    if (ids.length !== 2) continue;
    const [i, j] = ids;
    const li = trace.lines[i], lj = trace.lines[j];
    if (li.type !== lj.type) continue;
    const far = (l: TraceLine) => trace.points[l.a === k ? l.b : l.a];
    const p = trace.points[k], u = far(li), w = far(lj);
    const a1 = Math.atan2(u.n - p.n, u.e - p.e), a2 = Math.atan2(w.n - p.n, w.e - p.e);
    let d = Math.abs(a1 - a2) % (2 * Math.PI);
    if (d > Math.PI) d = 2 * Math.PI - d;
    if (Math.abs(Math.PI - d) <= (6 * Math.PI) / 180) count[li.type] -= 1;
  }
  return { feet, count };
}

/** The facet engine's lines as a trace to start from (its vertices are already UTM metres). */
export function traceFromEngine(model: { vertices: Array<{ e: number; n: number }>; edges: Array<{ a: number; b: number; type: FacetEdgeType }> }): RoofTraceBody {
  const cleaned = cleanTrace({ points: model.vertices.map((v) => ({ e: v.e, n: v.n })), lines: model.edges.map((e) => ({ a: e.a, b: e.b, type: e.type })), source: "engine" });
  return cleaned.ok ? cleaned.body : { points: [], lines: [], source: "engine" };
}

/** The picture's frame: metres right and down from its top-left corner (lib/roofFacets/server PictureWindow). */
export interface TraceWindow {
  e0: number;
  n0: number;
}
export const toWindow = (p: TracePoint, w: TraceWindow) => ({ x: p.e - w.e0, y: w.n0 - p.n });
export const fromWindow = (p: { x: number; y: number }, w: TraceWindow): TracePoint => ({ e: w.e0 + p.x, n: w.n0 - p.y });
