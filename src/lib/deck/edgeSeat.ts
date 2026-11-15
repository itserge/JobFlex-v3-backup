// A STAIR'S HEAD ON AN EDGE THAT IS NOT STRAIGHT (2026-11-15) — pure.
//
// The owner, of a deck with a bowed front and a stair on it: "if the stairs attached to the radius deck, make sure it
// attaches right, because right now there is a gap on the radius because the stairs are thinking it's attaching to the
// flat. Make it smart check."
//
// A stair was set out square to the house at the edge's place under its MIDDLE. On a bow the edge is somewhere else at
// the stair's two ends: on a 16-ft deck bowed 2 ft, a 4-ft stair 2½ ft from the end stood 10 in. off the deck at one
// corner and 7 in. under it at the other. On a corner cut at 45° it stood square to the house across the cut.
//
// Here the stair is seated on the edge AS THE DECK IS DRAWN (the outline's own short straight pieces, so the 3D and the
// drawings agree to the inch):
//   · it is turned to the line through the edge's two points under its ends — on a bow, square to the radius at its
//     middle; on a cut corner, square to the cut;
//   · that line is moved out until nothing of the deck stands past it: the stair's head touches the edge and never
//     stands under the deck;
//   · where the edge bends away behind the head (a bow does, by a finger or two toward the stair's ends), the gap is
//     named — the deck's boards run straight across the head of the stair there, on a straight header blocked off the
//     bent rim — and handed back as flat rings to draw and to count.
// A straight edge, and an edge that steps under the stair (two parts of a front set part by part), give null: the old
// set-out, to the inch.

export interface SeatPoint {
  x: number;
  y: number;
}

export interface EdgeSeat {
  /** The stair's own frame: O at its head's start, u along its width, nrm the way it runs down. */
  O: SeatPoint;
  u: SeatPoint;
  nrm: SeatPoint;
  /** How far it is turned from square to the side it leaves, degrees (signed). */
  turnDeg: number;
  /** The most the deck's edge stands back from the stair's head across its width, in. */
  gapIn: number;
  /** That gap at the head's two ends, in. (start, end). */
  endGapIn: [number, number];
  /** The gap as flat rings [x0, y0, x1, y1, …], plan inches: what the deck's boards cover, run straight across the head. */
  fills: number[][];
  /** Their area, sq in. */
  fillSqIn: number;
}

/** Narrower than this a gap is the saw's kerf: nothing is drawn or said. */
export const SEAT_GAP_MIN_IN = 0.2;
/** As much as a straight header on blocking makes up behind a stair's head; past it the checks say so. */
export const SEAT_GAP_MAX_IN = 4;

/**
 * Seat a stair `w` inches wide, its middle at `at` along the side, on the side's edge.
 * `chain`: the edge as the outline draws it, plan inches, end to end. `dir`: the way `at` is measured along the side
 * (a unit vector; `at` is a point's own coordinate along it). `u0`: the way the stair's width ran on a straight edge;
 * `out`: the way out of the deck across that side.
 */
export function seatOnEdge(chain: readonly SeatPoint[], at: number, w: number, dir: SeatPoint, u0: SeatPoint, out: SeatPoint): EdgeSeat | null {
  if (chain.length < 2 || !(w > 0)) return null;
  const t = (p: SeatPoint) => p.x * dir.x + p.y * dir.y;
  const pts = t(chain[0]) <= t(chain[chain.length - 1]) ? chain.slice() : chain.slice().reverse();
  const a = at - w / 2;
  const b = at + w / 2;
  if (a < t(pts[0]) - 0.5 || b > t(pts[pts.length - 1]) + 0.5) return null;
  // The edge must run on under the whole stair: no step in it there (two parts of a front), and never back on itself.
  for (let i = 0; i + 1 < pts.length; i++) {
    const t0 = t(pts[i]);
    const t1 = t(pts[i + 1]);
    if (t1 < a - 0.01 || t0 > b + 0.01) continue;
    if (t1 < t0 - 0.01) return null;
    if (t1 - t0 < 0.01 && Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y) > 0.5 && t0 > a + 0.01 && t0 < b - 0.01) return null;
  }
  // (Where the edge steps exactly at one of the stair's ends, the point is read on the stair's own side of the step.)
  const pointAt = (q: number, toward: 1 | -1): SeatPoint | null => {
    const v = Math.max(t(pts[0]), Math.min(t(pts[pts.length - 1]), q));
    let hit: SeatPoint | null = null;
    for (let i = 0; i + 1 < pts.length; i++) {
      const t0 = t(pts[i]);
      const t1 = t(pts[i + 1]);
      if (t1 - t0 < 0.01 || v < t0 - 1e-6 || v > t1 + 1e-6) continue;
      const k = Math.max(0, Math.min(1, (v - t0) / (t1 - t0)));
      hit = { x: pts[i].x + (pts[i + 1].x - pts[i].x) * k, y: pts[i].y + (pts[i + 1].y - pts[i].y) * k };
      if (toward < 0) break;
    }
    return hit;
  };
  const Pa = pointAt(a, 1);
  const Pb = pointAt(b, -1);
  const Pm = pointAt(at, 1);
  if (!Pa || !Pb || !Pm) return null;
  const inside = pts.filter((p) => t(p) > a + 0.01 && t(p) < b - 0.01);
  // Straight under the whole stair, along the side's own line: the old set-out.
  const cross = (p: SeatPoint) => (p.x - Pa.x) * dir.y - (p.y - Pa.y) * dir.x;
  if ([Pb, Pm, ...inside].every((p) => Math.abs(cross(p)) < 0.01)) return null;

  const cl = Math.hypot(Pb.x - Pa.x, Pb.y - Pa.y);
  if (cl < 1) return null;
  const sign = (Pb.x - Pa.x) * u0.x + (Pb.y - Pa.y) * u0.y >= 0 ? 1 : -1;
  const u = { x: (sign * (Pb.x - Pa.x)) / cl, y: (sign * (Pb.y - Pa.y)) / cl };
  let nrm = { x: -u.y, y: u.x };
  if (nrm.x * out.x + nrm.y * out.y < 0) nrm = { x: -nrm.x, y: -nrm.y };
  // Out until nothing of the deck stands past the head's line.
  const off = (p: SeatPoint) => (p.x - Pm.x) * nrm.x + (p.y - Pm.y) * nrm.y;
  const shift = Math.max(0, ...[Pa, Pb, ...inside].map(off));
  const M = { x: Pm.x + nrm.x * shift, y: Pm.y + nrm.y * shift };
  const O = { x: M.x - (u.x * w) / 2, y: M.y - (u.y * w) / 2 };

  // The edge behind the head, in the head's own measure: `s` along it from its middle, `d` back from it.
  const sOf = (p: SeatPoint) => (p.x - M.x) * u.x + (p.y - M.y) * u.y;
  const dOf = (p: SeatPoint) => Math.max(0, -((p.x - M.x) * nrm.x + (p.y - M.y) * nrm.y));
  const run = sign > 0 ? pts : pts.slice().reverse();
  const edgeAtS = (sv: number): SeatPoint | null => {
    for (let i = 0; i + 1 < run.length; i++) {
      const s0 = sOf(run[i]);
      const s1 = sOf(run[i + 1]);
      if (s1 - s0 < 1e-6 || sv < s0 - 1e-6 || sv > s1 + 1e-6) continue;
      const k = Math.max(0, Math.min(1, (sv - s0) / (s1 - s0)));
      return { x: run[i].x + (run[i + 1].x - run[i].x) * k, y: run[i].y + (run[i + 1].y - run[i].y) * k };
    }
    return null;
  };
  const E0 = edgeAtS(-w / 2) ?? (sign > 0 ? Pa : Pb);
  const E1 = edgeAtS(w / 2) ?? (sign > 0 ? Pb : Pa);
  const edge = [E0, ...run.filter((p) => sOf(p) > -w / 2 + 0.01 && sOf(p) < w / 2 - 0.01), E1];
  const fills: number[][] = [];
  let fillSqIn = 0;
  for (let i = 0; i + 1 < edge.length; i++) {
    const p = edge[i];
    const q = edge[i + 1];
    const dp = dOf(p);
    const dq = dOf(q);
    if (Math.max(dp, dq) < SEAT_GAP_MIN_IN) continue;
    const sp = Math.max(-w / 2, Math.min(w / 2, sOf(p)));
    const sq = Math.max(-w / 2, Math.min(w / 2, sOf(q)));
    if (sq - sp < 0.05) continue;
    const ring: number[] = [M.x + u.x * sp, M.y + u.y * sp, M.x + u.x * sq, M.y + u.y * sq];
    if (dq >= 0.1) ring.push(q.x, q.y);
    if (dp >= 0.1) ring.push(p.x, p.y);
    if (ring.length < 6) continue;
    fills.push(ring);
    fillSqIn += ((dp + dq) / 2) * (sq - sp);
  }
  const gapIn = Math.max(0, ...edge.map(dOf));
  const turn = Math.atan2(u0.x * u.y - u0.y * u.x, u0.x * u.x + u0.y * u.y);
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return { O, u, nrm, turnDeg: r2((turn * 180) / Math.PI), gapIn: r2(gapIn), endGapIn: [r2(dOf(E0)), r2(dOf(E1))], fills, fillSqIn: r2(fillSqIn) };
}

/**
 * The stretch of an outline (a ring of points) that is one side's edge, end to end: the points that lie on the side's
 * own line as `on` reads it, in the ring's order — the longest unbroken run of them. Empty when the side has none.
 */
export function chainOf(ring: readonly SeatPoint[], on: (p: SeatPoint) => boolean): SeatPoint[] {
  const n = ring.length;
  if (!n) return [];
  const flag = ring.map(on);
  if (flag.every(Boolean)) return ring.slice();
  let best: SeatPoint[] = [];
  for (let i = 0; i < n; i++) {
    if (!flag[i] || flag[(i - 1 + n) % n]) continue;
    const run: SeatPoint[] = [];
    for (let k = 0; k < n && flag[(i + k) % n]; k++) run.push(ring[(i + k) % n]);
    if (run.length > best.length) best = run;
  }
  return best;
}
