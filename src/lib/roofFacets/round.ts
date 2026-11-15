// ROOF FACETS — ROUND ROOFS (2026-11-13, owner, of a house with a turret: "looks like it doesn't read the round
// roofs"). The engine's planes are flat; a turret's cone came out as three or four flat pieces with lines between
// them that are not on the roof, inside an outline that cut its circle into a few straight walls.
//
// A cone is read off the height map directly: round a point, the roof stands at ONE height all the way round every
// circle, and falls evenly as the circles grow (a hip roof's pyramid does not — on a circle round its peak the hips
// stand higher than the faces between them). What is found is the centre, the radius out to the eave, and the fall.
// The engine then gives the cone's disc to one facet of its own, draws the disc's edge as the curve it is (a run of
// short chords, kept from the straightening), and bends the outline round it where the outline hugged the turret.
//
// Pure. Units: window pixels (a pixel's centre is its index + 0.5) and metres of height.

import { ROUND_EDGE } from "./arrange";
import type { Pt } from "./raster";

export interface Cone {
  /** the peak, window pixels (continuous) */
  cx: number;
  cy: number;
  /** out to the eave, pixels */
  r: number;
  /** height at the peak, metres, and the fall per pixel of distance from it */
  z0: number;
  k: number;
}

/** The edges of a round roof carry this tag: the straightening keeps their corners. */
export const ROUND_TAG = ROUND_EDGE;

const DIRS = 32;

/** Cones standing in the roof (the largest first). `inside` marks the roof's pixels. */
export function findCones(z: Float32Array, w: number, h: number, inside: Uint8Array, px: number, dbg?: { x: number; y: number; log: (s: string) => void }): Cone[] {
  // lightly smoothed heights
  const zs = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      s += z[yy * w + xx]; n++;
    }
    zs[y * w + x] = s / n;
  }
  const at = (x: number, y: number) => {
    const ix = Math.floor(x), iy = Math.floor(y);
    return ix < 0 || iy < 0 || ix >= w || iy >= h ? NaN : zs[iy * w + ix];
  };
  const cos = Array.from({ length: DIRS }, (_, i) => Math.cos((i * 2 * Math.PI) / DIRS)), sin = Array.from({ length: DIRS }, (_, i) => Math.sin((i * 2 * Math.PI) / DIRS));
  const STEP = 0.4 / px, MAX_R = 7 / px;

  /** How far a cone holds round (cx, cy): its reach, and the line the ring heights fall on. */
  const probe = (cx: number, cy: number): { reach: number; z0: number; k: number; miss: number } | null => {
    const zc = at(cx, cy);
    if (!Number.isFinite(zc)) return null;
    const say = dbg && Math.abs(cx - dbg.x) < 0.6 && Math.abs(cy - dbg.y) < 0.6 ? dbg.log : null;
    const rs: number[] = [], ms: number[] = [];
    let judged = 0, miss = 0;
    for (let r = STEP; r <= MAX_R; r += STEP) {
      const vals: number[] = [];
      for (let i = 0; i < DIRS; i++) { const v = at(cx + cos[i] * r, cy + sin[i] * r); if (Number.isFinite(v)) vals.push(v); }
      if (vals.length < DIRS * 0.8) { say?.(`r ${r}: off the raster`); break; }
      const sorted = [...vals].sort((a, b) => a - b);
      // the cone's own height on this circle: where most of the circle stands (a wall of the house beside the turret
      // stands above it, the ground beyond the eave below it)
      const tolOf = (drop: number) => Math.max(0.12, 0.13 * drop);
      let best = 0, bm = sorted[0];
      for (let i = 0; i < sorted.length; i++) {
        const drop = zc - sorted[i], tol = tolOf(drop);
        let n = 0;
        for (const v of sorted) if (Math.abs(v - sorted[i]) <= tol) n++;
        if (n > best) { best = n; bm = sorted[i]; }
      }
      const drop = zc - bm;
      say?.(`r ${(r * px).toFixed(1)} m: ring height ${(-drop).toFixed(2)} held by ${best}/${DIRS}`);
      if (drop < -0.05) break; // the circle stands above the centre: not a peak
      if (drop >= 0.35) {
        if (best < DIRS * 0.45) break; // not one height round most of the circle: the cone has ended
        // ...and it is ROUND. A hip roof's pyramid stands at nearly one height on a circle too — but its hips stand
        // higher than the faces between them, four times round (and the end of a ridge twice round): the ring's
        // heights are fitted with those two waves, and a wave of any size says "flat faces".
        const tol = tolOf(drop);
        const rows: number[][] = [], rhs: number[] = [];
        for (let i = 0; i < DIRS; i++) {
          const v = at(cx + cos[i] * r, cy + sin[i] * r);
          if (!Number.isFinite(v) || Math.abs(v - bm) > tol) continue;
          const t = (i * 2 * Math.PI) / DIRS;
          rows.push([1, Math.cos(2 * t), Math.sin(2 * t), Math.cos(4 * t), Math.sin(4 * t)]); rhs.push(v);
        }
        const fit = leastSquares(rows, rhs);
        if (!fit) break;
        const wave2 = Math.hypot(fit[1], fit[2]), wave4 = Math.hypot(fit[3], fit[4]);
        let off = 0;
        rows.forEach((row, i) => { off += Math.abs(rhs[i] - row.reduce((q, c, j) => q + c * fit[j], 0)); });
        const n = rows.length;
        say?.(`    waves: twice round ${(wave2 / drop).toFixed(3)}, four times round ${(wave4 / drop).toFixed(3)} of the fall; ${n} points`);
        if (wave2 > 0.07 * drop + 0.02 || wave4 > 0.055 * drop + 0.02) break;
        judged++;
        miss += off / n;
      }
      rs.push(r); ms.push(bm);
    }
    say?.(`judged ${judged} rings, read ${rs.length}`);
    if (judged < 3) return null;
    // the fall: a straight line through the ring heights (the peak itself is rounded off in the height map)
    const n = rs.length;
    let sr = 0, sm = 0, srr = 0, srm = 0;
    for (let i = 0; i < n; i++) { sr += rs[i]; sm += ms[i]; srr += rs[i] * rs[i]; srm += rs[i] * ms[i]; }
    const k = -(n * srm - sr * sm) / (n * srr - sr * sr || 1e-9), z0 = (sm + k * sr) / n;
    if (!(k > 0)) return null;
    // ...and every ring on it
    for (let i = 0; i < n; i++) if (Math.abs(ms[i] - (z0 - k * rs[i])) > 0.2) return null;
    return { reach: rs[n - 1], z0, k, miss: miss / judged };
  };

  const found: Cone[] = [];
  const taken = new Uint8Array(w * h);
  for (let round = 0; round < 3; round++) {
    let best: { cx: number; cy: number; p: NonNullable<ReturnType<typeof probe>> } | null = null;
    for (let y = 4; y < h - 4; y += 2) for (let x = 4; x < w - 4; x += 2) {
      const i = y * w + x;
      if (!inside[i] || taken[i]) continue;
      // a peak: nothing 0.4 m away stands above it
      const zc = zs[i];
      let peak = true;
      for (let d = 0; d < DIRS && peak; d += 4) if (!(at(x + 0.5 + cos[d] * STEP, y + 0.5 + sin[d] * STEP) <= zc + 0.07)) peak = false;
      if (!peak) continue;
      const p = probe(x + 0.5, y + 0.5);
      if (!p) continue;
      if (!best || p.reach > best.p.reach + 0.5 || (Math.abs(p.reach - best.p.reach) <= 0.5 && p.miss < best.p.miss)) best = { cx: x + 0.5, cy: y + 0.5, p };
    }
    if (!best) break;
    // the centre, to the pixel: where the rings fit best
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const p = probe(best.cx + dx, best.cy + dy);
      if (p && p.reach >= best.p.reach - 0.5 && p.miss < best.p.miss) best = { cx: best.cx + dx, cy: best.cy + dy, p };
    }
    const { cx, cy, p } = best;
    const slope = p.k / px; // rise per run
    // out to the eave: along every way out that stays on the cone, where the roof falls off it
    const ends: number[] = [];
    for (let i = 0; i < DIRS; i++) {
      let end = NaN, on = 0;
      for (let r = STEP; r <= MAX_R + 2 / px; r += 0.5) {
        const v = at(cx + cos[i] * r, cy + sin[i] * r);
        if (!Number.isFinite(v)) break;
        const d = v - (p.z0 - p.k * r);
        if (Math.abs(d) <= 0.2) on = r;
        else if (d > 0.35 && r < p.reach) break; // the house stands over the cone this way
        else if (d < -0.5) { end = r; break; }
      }
      // the eave: the last of the cone before the fall, less the height map's own softness at an edge (a roof's edge
      // reads a quarter of a metre fat in it)
      if (Number.isFinite(end) && on >= p.reach * 0.6) ends.push(Math.max(on - 0.15 / px, (on + end) / 2 - 0.3 / px));
    }
    ends.sort((a, b) => a - b);
    const r = ends.length ? ends[ends.length >> 1] : p.reach;
    const fall = p.k * r;
    // ...and its eave is round too: seen at least 40% of the way round, everywhere the same distance from the peak
    // (a square tower's eave is 40% farther at its corners than at the middle of its walls)
    const spread = ends.length ? (ends[Math.floor(ends.length * 0.9)] - ends[Math.floor(ends.length * 0.1)]) / r : 1;
    dbg?.log(`peak ${cx},${cy}: reach ${(p.reach * px).toFixed(1)} m, eave seen ${ends.length}/${DIRS} ways out at ${(r * px).toFixed(1)} m, spread ${spread.toFixed(2)}, ${(slope * 12).toFixed(1)}/12`);
    // a turret, not a bump: 1.2 m out or more, half a metre of fall, 2 in 12 or steeper, and round nearly out to its
    // eave (a hip tower's rings stop being round well inside its walls)
    if (ends.length >= DIRS * 0.4 && spread <= 0.27 && r * px >= 1.2 && fall >= 0.5 && slope >= 0.16 && r <= p.reach + 0.6 / px) found.push({ cx, cy, r, z0: p.z0, k: p.k });
    // either way this peak is not looked at again
    const R = Math.max(r, p.reach) + 4;
    for (let y = Math.max(0, Math.floor(cy - R)); y < Math.min(h, cy + R); y++) for (let x = Math.max(0, Math.floor(cx - R)); x < Math.min(w, cx + R); x++) if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= R) taken[y * w + x] = 1;
  }
  return found.sort((a, b) => b.r - a.r);
}

/** Least squares for a handful of unknowns (normal equations, Gauss elimination); null when it cannot be solved. */
function leastSquares(rows: number[][], rhs: number[]): number[] | null {
  const m = rows[0]?.length ?? 0;
  if (rows.length < m + 3) return null;
  const A = Array.from({ length: m }, () => new Array<number>(m + 1).fill(0));
  rows.forEach((row, k) => { for (let i = 0; i < m; i++) { for (let j = 0; j < m; j++) A[i][j] += row[i] * row[j]; A[i][m] += row[i] * rhs[k]; } });
  for (let i = 0; i < m; i++) {
    let piv = i;
    for (let k = i + 1; k < m; k++) if (Math.abs(A[k][i]) > Math.abs(A[piv][i])) piv = k;
    if (Math.abs(A[piv][i]) < 1e-9) return null;
    [A[i], A[piv]] = [A[piv], A[i]];
    for (let k = 0; k < m; k++) {
      if (k === i) continue;
      const f = A[k][i] / A[i][i];
      for (let j = i; j <= m; j++) A[k][j] -= f * A[i][j];
    }
  }
  return A.map((row, i) => row[m] / row[i]);
}

/** Height of the cone's surface over a point. */
export const coneZ = (c: Cone, x: number, y: number) => c.z0 - c.k * Math.hypot(x - c.cx, y - c.cy);

/**
 * The outline bent round a cone, and the rest of the cone's circle (the part inside the roof) as chords.
 * Where a run of the outline's corners hugs the circle (within 0.9 m of it, or inside it), that run is replaced by the
 * arc between the two points where the outline meets the circle. Null when the outline does not come near the cone.
 */
export function bendRound(ring: ReadonlyArray<Pt>, c: Cone, px: number): { ring: Pt[]; arc: Pt[]; inner: Pt[] } {
  const n = ring.length;
  const chord = 0.75 / px;
  const circle = (a0: number, a1: number): Pt[] => {
    // from angle a0 to a1 (a1 > a0), ends included
    const m = Math.max(2, Math.round(((a1 - a0) * c.r) / chord));
    return Array.from({ length: m + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / m; return { x: c.cx + c.r * Math.cos(a), y: c.cy + c.r * Math.sin(a) }; });
  };
  const near = ring.map((p) => Math.hypot(p.x - c.cx, p.y - c.cy) <= c.r + 0.9 / px);
  const whole = (): { ring: Pt[]; arc: Pt[]; inner: Pt[] } => { const pts = circle(0, 2 * Math.PI); pts.pop(); return { ring: [...ring], arc: [], inner: [...pts, pts[0]] }; };
  if (!near.some(Boolean) || near.every(Boolean)) return whole();
  // the longest run of corners near the circle (the ring is a loop)
  let bi = -1, bl = 0;
  for (let i = 0; i < n; i++) {
    if (!near[i] || near[(i - 1 + n) % n]) continue;
    let l = 0;
    while (near[(i + l) % n] && l < n) l++;
    if (l > bl) { bl = l; bi = i; }
  }
  if (bi < 0) return whole();
  const first = ring[bi], last = ring[(bi + bl - 1) % n], prev = ring[(bi - 1 + n) % n], next = ring[(bi + bl) % n];
  /** where the stretch from `out` (off the circle) to `inn` (near it) meets the circle; else `inn` set on the circle */
  const meet = (out: Pt, inn: Pt): Pt => {
    const dx = inn.x - out.x, dy = inn.y - out.y, fx = out.x - c.cx, fy = out.y - c.cy;
    const A = dx * dx + dy * dy, B = 2 * (fx * dx + fy * dy), C = fx * fx + fy * fy - c.r * c.r;
    const disc = B * B - 4 * A * C;
    if (A > 1e-9 && disc >= 0) {
      const t = (-B - Math.sqrt(disc)) / (2 * A); // the first crossing coming in
      if (t >= 0 && t <= 1.25) return { x: out.x + dx * t, y: out.y + dy * t };
    }
    const d = Math.hypot(inn.x - c.cx, inn.y - c.cy) || 1;
    return { x: c.cx + ((inn.x - c.cx) / d) * c.r, y: c.cy + ((inn.y - c.cy) / d) * c.r };
  };
  const pIn = meet(prev, first), pOut = meet(next, last);
  const ang = (p: Pt) => Math.atan2(p.y - c.cy, p.x - c.cx);
  const a0 = ang(pIn);
  let a1 = ang(pOut);
  // the way round that passes the run's own corners
  const mid = ring[(bi + (bl >> 1)) % n];
  const turn = (a: number) => ((a - a0) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
  const ccw = turn(ang(mid)) <= turn(a1) || bl === 1 && turn(a1) <= Math.PI;
  let arc: Pt[], inner: Pt[];
  if (ccw) {
    a1 = a0 + turn(a1);
    arc = circle(a0, a1);
    inner = circle(a1, a0 + 2 * Math.PI);
  } else {
    const back = 2 * Math.PI - turn(a1); // going the other way round from a0 to a1
    arc = circle(a0 - back, a0).reverse();
    inner = circle(a0, a0 - back + 2 * Math.PI).reverse();
  }
  if (arc.length < 3 || (arc.length - 1) * chord < 1.2 / px) return whole();
  arc[0] = pIn; arc[arc.length - 1] = pOut;
  inner[0] = pOut; inner[inner.length - 1] = pIn;
  const out: Pt[] = [];
  for (let i = 0; i < n - bl; i++) out.push(ring[(bi + bl + i) % n]);
  out.push(...arc);
  return { ring: out, arc, inner };
}
