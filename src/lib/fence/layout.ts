// The traced path → the runs the takeoff counts. Pure, so the rule can be
// checked without a map: a path is one or more polylines (a point with
// `gap` starts a new, disconnected one); a polyline whose last point is its
// first is a ring — corners all round, no ends; an open polyline has a
// corner at every inner vertex and an end at each tip. Each segment's
// length comes from the caller (the ledger's possibly hand-edited feet,
// along the ground when the profile is in), so the page and the takeoff
// agree on every foot.

import type { FenceRunInput } from "./takeoff";

export interface PathPointLike {
  x: number;
  y: number;
  gap?: boolean;
}

/**
 * Group a traced path into runs. `segLengthFt(i)` is the length of the
 * segment points[i] → points[i+1]; null means "measure it from the points".
 * Slivers under 0.05 ft are not fence. Each run carries its sides (`legsFt`)
 * so the takeoff counts bays side by side; `onLeg` tells the caller which run
 * and side every traced segment became (to seat a gate on it).
 */
export function polylinesToRuns(
  points: readonly PathPointLike[],
  segLengthFt: (segIndex: number) => number | null = () => null,
  onLeg?: (segIndex: number, run: number, leg: number, ft: number) => void,
): FenceRunInput[] {
  const out: FenceRunInput[] = [];
  if (points.length < 2) return out;
  let start = 0;
  const flush = (end: number) => {
    const n = end - start + 1;
    if (n < 2) return;
    const first = points[start];
    const last = points[end];
    const closed = n >= 4 && Math.hypot(last.x - first.x, last.y - first.y) < 0.01;
    let lengthFt = 0;
    let segments = 0;
    const legs: Array<{ seg: number; ft: number }> = [];
    for (let i = start; i < end; i++) {
      const given = segLengthFt(i);
      const ft = given != null && Number.isFinite(given) ? Math.max(0, given) : Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
      if (ft > 0.05) {
        segments += 1;
        legs.push({ seg: i, ft });
      }
      lengthFt += ft;
    }
    if (lengthFt <= 0.05 || segments === 0) return;
    // Corners: the inner vertices of an open run; every vertex of a ring
    // (the closing point is the first point again).
    const corners = closed ? Math.max(0, n - 1) : Math.max(0, segments - 1);
    const run = out.length;
    legs.forEach((l, k) => onLeg?.(l.seg, run, k, l.ft));
    out.push({ lengthFt: Math.round(lengthFt * 100) / 100, corners, closed, legsFt: legs.map((l) => Math.round(l.ft * 100) / 100) });
  };
  for (let i = 1; i < points.length; i++) {
    if (points[i].gap) {
      flush(i - 1);
      start = i;
    }
  }
  flush(points.length - 1);
  return out;
}

/** Runs typed by hand, with no map: ONE fence whose runs meet at corners —
 *  three typed runs are a fence with two corners, not three loose pieces. */
export function typedRuns(lengthsFt: readonly number[]): FenceRunInput[] {
  const real = lengthsFt.filter((n) => Number.isFinite(n) && n > 0);
  const total = real.reduce((a, b) => a + b, 0);
  // Each typed run is a side: the takeoff counts its bays on their own (a bay never wraps the corner between them).
  return total > 0 ? [{ lengthFt: Math.round(total * 100) / 100, corners: Math.max(0, real.length - 1), legsFt: real.map((n) => Math.round(n * 100) / 100) }] : [];
}
