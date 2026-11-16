// ROOF TRACE · THE EDITOR'S GEOMETRY (2026-11-16) — what the hand-tracing tool (components/v3/admin-roof-lab/
// roof-trace-editor) does to a drawing when an admin clicks: find the point or line under the pointer, add a point,
// split a line where a new one meets it, join two points into one, move a point, retype or delete a line, and tidy up.
// Every step returns a new drawing (the old one stays for Undo). Coordinates are the photo's metres (x right, y down).
// Pure, and safe to import from a client component.

import type { FacetEdgeType } from "@/lib/roofFacets/model";
import { cleanTrace, fromWindow, toWindow, type RoofTraceBody, type TraceSource, type TraceWindow } from "./trace";

export interface EditPoint {
  x: number;
  y: number;
}
export interface EditLine {
  a: number;
  b: number;
  type: FacetEdgeType;
}
export interface EditState {
  pts: EditPoint[];
  lines: EditLine[];
}

export const EMPTY_EDIT: EditState = { pts: [], lines: [] };

const dist = (p: EditPoint, q: EditPoint) => Math.hypot(p.x - q.x, p.y - q.y);

/** The point within `r` of (x, y) nearest to it, among those a line uses (or -1); `skip` is left out. */
export function nearestPoint(st: EditState, x: number, y: number, r: number, skip = -1): number {
  const used = new Set<number>();
  for (const l of st.lines) { used.add(l.a); used.add(l.b); }
  let best = -1, bd = r;
  st.pts.forEach((p, i) => {
    if (i === skip || !used.has(i)) return;
    const d = Math.hypot(p.x - x, p.y - y);
    if (d <= bd) { bd = d; best = i; }
  });
  return best;
}

/** The line within `r` of (x, y) nearest to it, with the foot of the pointer on it (not at its very ends). */
export function nearestLine(st: EditState, x: number, y: number, r: number): { i: number; t: number; at: EditPoint } | null {
  let best: { i: number; t: number; at: EditPoint } | null = null, bd = r;
  st.lines.forEach((l, i) => {
    const a = st.pts[l.a], b = st.pts[l.b];
    const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
    if (len2 < 1e-12) return;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2));
    const at = { x: a.x + t * dx, y: a.y + t * dy };
    const d = Math.hypot(at.x - x, at.y - y);
    if (d <= bd) { bd = d; best = { i, t, at }; }
  });
  return best;
}

export function addPoint(st: EditState, p: EditPoint): [EditState, number] {
  return [{ pts: [...st.pts, { x: p.x, y: p.y }], lines: st.lines }, st.pts.length];
}

/** A new point on line `i` at `p` (taken onto the line), the line cut in two there. */
export function splitLine(st: EditState, i: number, p: EditPoint): [EditState, number] {
  const l = st.lines[i];
  if (!l) return addPoint(st, p);
  const a = st.pts[l.a], b = st.pts[l.b];
  const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  const [s2, k] = addPoint(st, { x: a.x + t * dx, y: a.y + t * dy });
  const lines = [...s2.lines];
  lines.splice(i, 1, { a: l.a, b: k, type: l.type }, { a: k, b: l.b, type: l.type });
  return [{ pts: s2.pts, lines }, k];
}

/** A line of `type` from point `a` to point `b`, unless it is no line (the same point) or already drawn. */
export function connect(st: EditState, a: number, b: number, type: FacetEdgeType): EditState {
  if (a === b || dist(st.pts[a], st.pts[b]) < 1e-6) return st;
  if (st.lines.some((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a))) return st;
  return { pts: st.pts, lines: [...st.lines, { a, b, type }] };
}

export function movePoint(st: EditState, i: number, p: EditPoint): EditState {
  if (!st.pts[i]) return st;
  const pts = [...st.pts];
  pts[i] = { x: p.x, y: p.y };
  return { pts, lines: st.lines };
}

/** Point `from` dropped on point `into`: its lines now end at `into`; a line between the two, or one now drawn twice, goes. */
export function mergePoints(st: EditState, from: number, into: number): EditState {
  if (from === into) return st;
  const seen = new Set<string>();
  const lines: EditLine[] = [];
  for (const l of st.lines) {
    const a = l.a === from ? into : l.a, b = l.b === from ? into : l.b;
    if (a === b) continue;
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push({ a, b, type: l.type });
  }
  return { pts: st.pts, lines };
}

export function deleteLine(st: EditState, i: number): EditState {
  if (!st.lines[i]) return st;
  return { pts: st.pts, lines: st.lines.filter((_, k) => k !== i) };
}

export function setType(st: EditState, i: number, type: FacetEdgeType): EditState {
  if (!st.lines[i] || st.lines[i].type === type) return st;
  const lines = [...st.lines];
  lines[i] = { ...lines[i], type };
  return { pts: st.pts, lines };
}

/** The points no line uses dropped, the rest renumbered. */
export function compact(st: EditState): EditState {
  const map = new Map<number, number>();
  const pts: EditPoint[] = [];
  for (const l of st.lines) for (const k of [l.a, l.b]) if (!map.has(k)) { map.set(k, pts.length); pts.push(st.pts[k]); }
  return { pts, lines: st.lines.map((l) => ({ a: map.get(l.a)!, b: map.get(l.b)!, type: l.type })) };
}

/** How many line ends touch nothing: an end no other line meets (a loose end is usually a line not yet joined). */
export function looseEnds(st: EditState): number {
  const deg = new Map<number, number>();
  for (const l of st.lines) for (const k of [l.a, l.b]) deg.set(k, (deg.get(k) ?? 0) + 1);
  let n = 0;
  for (const v of deg.values()) if (v === 1) n++;
  return n;
}

export function editFromTrace(body: Pick<RoofTraceBody, "points" | "lines">, w: TraceWindow): EditState {
  return { pts: body.points.map((p) => toWindow(p, w)), lines: body.lines.map((l) => ({ a: l.a, b: l.b, type: l.type })) };
}

export function traceFromEdit(st: EditState, w: TraceWindow, source: TraceSource): RoofTraceBody {
  const c = compact(st);
  const cleaned = cleanTrace({ points: c.pts.map((p) => fromWindow(p, w)), lines: c.lines, source });
  return cleaned.ok ? cleaned.body : { points: [], lines: [], source };
}
