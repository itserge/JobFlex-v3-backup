// ROOF FACETS — THE PLANES (2026-11-11). Step one of the facet engine (./engine): read the flat roof planes off the
// height map inside the roof outline. Pure arithmetic over a cropped window of the raster — no I/O, no env — so the
// lab script and the QA check run it straight from saved rasters.
//
//   1. gradients   a least-squares plane through each pixel's 7x7 neighbourhood: slope east, slope south, and how
//                  badly the neighbourhood misses being flat (ridges, eaves, trees and chimneys miss badly)
//   2. grow        first from Google's own roof segments (a pitch, a facing and a height each — measured on the 14
//                  field roofs of 2026-11-11 they sit within 0.3 m of the height map), then from the flattest pixels
//                  nobody claimed: a region takes a neighbour whose height sits on the region's plane and whose own
//                  slope agrees; the plane is refitted as the region grows
//   3. merge       regions that are one plane (same slope, same height where they meet) become one; a region too
//                  narrow to be a facet (the bevel the height map makes of every hip and valley) is dropped
//   4. regularize  a plane facing within a few degrees of the building's own axes is turned onto the axis, and its
//                  pitch rounded to a whole rise-over-12 when the fit hardly suffers — that is what makes ridges run
//                  parallel to walls and hips run at 45 degrees
//   5. assign      every roof pixel goes to the plane it sits on, growing outwards from the regions, so the
//                  boundaries between planes land on the lines where the planes cross
//   6. select      a plane the height map found on its own must earn its place: where its pixels sit almost as well
//                  on the neighbours' planes, it was a bump or a bevel, and it goes
//   7. fill        what is still nobody's (a tree over the roof, a chimney) takes the nearest plane
//
// Units: x, y in window pixels (x east, y SOUTH), heights in metres. A plane is z = gx*x + gy*y + c.

export interface Plane {
  id: number;
  /** metres of height per pixel east / per pixel south */
  gx: number;
  gy: number;
  c: number;
  /** pixels the region grew to */
  n: number;
  /** centroid of the region, window pixels */
  cx: number;
  cy: number;
  /** root-mean-square miss of the region's pixels from the plane, metres */
  rms: number;
  /** true when one of Google's roof segments stands behind it */
  prior: boolean;
}

/** One of Google's roof segments, already in window pixels and metres. */
export interface PlanePrior {
  gx: number;
  gy: number;
  /** the segment's centre, window pixels */
  cx: number;
  cy: number;
  /** the plane's height at the centre, metres (same datum as `z`) */
  zc: number;
  /** Google's own area for it, square metres */
  areaM2: number;
}

/** One of Google's roof segments as the callers hold it: its centre in raster pixels, its pitch and facing in degrees. */
export interface RoofSegmentPx {
  pitchDeg: number;
  azimuthDeg: number;
  cx: number;
  cy: number;
  zc: number;
  areaM2: number;
}

/** Google's segments as plane priors over a window whose corner is (x0, y0): the plane RISES opposite to the way it faces; y runs south. */
export function priorsInWindow(segments: ReadonlyArray<RoofSegmentPx>, x0: number, y0: number, pixelSizeM: number): PlanePrior[] {
  return segments.map((s) => {
    const t = Math.tan((s.pitchDeg * Math.PI) / 180) * pixelSizeM, az = (s.azimuthDeg * Math.PI) / 180;
    return { gx: -t * Math.sin(az), gy: t * Math.cos(az), cx: s.cx - x0 - 0.5, cy: s.cy - y0 - 0.5, zc: s.zc, areaM2: s.areaM2 };
  });
}

export interface PlaneOptions {
  /** half-width of the gradient window, pixels (3 = 7x7) */
  window: number;
  /** a seed pixel's neighbourhood must be this flat, metres */
  seedResidM: number;
  /** a pixel joins a region when it is this close to the plane, metres */
  growDistM: number;
  /** ...and its own slope differs from the plane's by no more than this (rise per run) */
  growSlope: number;
  /** regions smaller than this never become a plane, square metres */
  minRegionM2: number;
  /** two regions are one plane when their slopes differ by less than this (rise per run)... */
  mergeSlope: number;
  /** ...and their heights by less than this where either sits, metres */
  mergeDistM: number;
  /** a plane facing this close to a direction the building runs in is offered that direction (the fit decides), degrees */
  axisSnapDeg: number;
  /** a pixel may be assigned to a plane it misses by up to this, metres */
  assignDistM: number;
  /** a region whose widest part is narrower than this is a bevel, not a facet, metres */
  minWidthM: number;
  /** a plane the height map found alone stays only when its pixels miss the neighbours' planes by this much (rms), metres */
  earnDistM: number;
  /** ...and it covers at least this much after assignment, square metres */
  earnAreaM2: number;
}

export const PLANE_DEFAULTS: PlaneOptions = {
  window: 3,
  seedResidM: 0.04,
  growDistM: 0.11,
  growSlope: 0.14,
  minRegionM2: 1.6,
  mergeSlope: 0.07,
  mergeDistM: 0.14,
  axisSnapDeg: 16,
  assignDistM: 0.32,
  minWidthM: 1.1,
  earnDistM: 0.16,
  earnAreaM2: 2.2,
};

export interface PlaneField {
  w: number;
  h: number;
  /** 1 inside the roof outline */
  inside: Uint8Array;
  /** heights, metres above the window's lowest roof pixel */
  z: Float32Array;
  planes: Plane[];
  /** per pixel: index into `planes`, or -1 */
  label: Int16Array;
}

/** Solve the 3x3 normal equations of z = gx*x + gy*y + c from running sums. Null when the pixels are collinear. */
function solvePlane(s: Float64Array): { gx: number; gy: number; c: number } | null {
  // s = [n, Sx, Sy, Sz, Sxx, Sxy, Syy, Sxz, Syz]
  const n = s[0];
  if (n < 3) return null;
  const mx = s[1] / n, my = s[2] / n, mz = s[3] / n;
  const sxx = s[4] - n * mx * mx, sxy = s[5] - n * mx * my, syy = s[6] - n * my * my;
  const sxz = s[7] - n * mx * mz, syz = s[8] - n * my * mz;
  const det = sxx * syy - sxy * sxy;
  if (Math.abs(det) < 1e-9 * Math.max(1, sxx * syy)) return null;
  const gx = (sxz * syy - syz * sxy) / det;
  const gy = (syz * sxx - sxz * sxy) / det;
  return { gx, gy, c: mz - gx * mx - gy * my };
}

/** The building's own axis, degrees in [0, 90): the direction its outline edges mostly run, length-weighted. */
export function dominantAxisDeg(ring: ReadonlyArray<{ x: number; y: number }>): number {
  // Angles are folded onto a quarter turn (x4), so an edge and the wall square to it vote together.
  let sx = 0, sy = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-6) continue;
    const t = Math.atan2(b.y - a.y, b.x - a.x) * 4;
    sx += Math.cos(t) * len;
    sy += Math.sin(t) * len;
  }
  const deg = ((Math.atan2(sy, sx) / 4) * 180) / Math.PI;
  return ((deg % 90) + 90) % 90;
}

/**
 * Every direction the building runs in, degrees in [0, 90), strongest first. A house with a wing set at an angle (the
 * first real roof the owner opened had one at 45 degrees) has two, and that wing's facets face along ITS walls — with
 * only the main direction known they were left crooked and the lines between them came out bent.
 */
export function outlineAxesDeg(ring: ReadonlyArray<{ x: number; y: number }>): number[] {
  const bins = new Float64Array(90);
  const edges: Array<{ deg: number; len: number }> = [];
  let total = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-6) continue;
    const deg = ((((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI) % 90) + 90) % 90;
    edges.push({ deg, len });
    bins[Math.floor(deg) % 90] += len;
    total += len;
  }
  const out: number[] = [];
  const taken = new Uint8Array(90);
  for (let round = 0; round < 3; round++) {
    let best = -1, bw = 0;
    for (let d = 0; d < 90; d++) {
      if (taken[d]) continue;
      let wsum = 0;
      for (let k = -3; k <= 3; k++) wsum += bins[(d + k + 90) % 90];
      if (wsum > bw) { bw = wsum; best = d; }
    }
    // a second direction has to carry a real share of the walls
    if (best === -1 || bw < total * (round === 0 ? 0 : 0.12)) break;
    let sx = 0, sy = 0;
    for (const e of edges) {
      let diff = Math.abs(e.deg - (best + 0.5));
      if (diff > 45) diff = 90 - diff;
      if (diff > 6) continue;
      const t = (e.deg * 4 * Math.PI) / 180;
      sx += Math.cos(t) * e.len; sy += Math.sin(t) * e.len;
    }
    const deg = ((((Math.atan2(sy, sx) / 4) * 180) / Math.PI) % 90 + 90) % 90;
    out.push(deg);
    for (let k = -15; k <= 15; k++) taken[(best + k + 90) % 90] = 1;
  }
  return out.length ? out : [dominantAxisDeg(ring)];
}

export function findPlanes(input: {
  w: number;
  h: number;
  z: Float32Array;
  inside: Uint8Array;
  pixelSizeM: number;
  axisDeg: number;
  /** every direction the building runs in (outlineAxesDeg); `axisDeg` alone when not given */
  axesDeg?: ReadonlyArray<number>;
  priors?: ReadonlyArray<PlanePrior>;
  /**
   * 1 where the outline's inside is NOT roof in Google's own building mask — a tree standing over the roof, mostly.
   * Those pixels take no part in finding the planes (a canopy fits planes of its own, and they are not the roof's);
   * at the end they take the plane of the roof next to them, as if the roof ran on underneath.
   */
  ignore?: Uint8Array;
  options?: Partial<PlaneOptions>;
  /** when given, the engine writes down what it decided and why (the lab reads it) */
  trace?: string[];
}): PlaneField {
  const o = { ...PLANE_DEFAULTS, ...input.options };
  const { w, h, z, pixelSizeM: px } = input;
  const N = w * h;
  // `inside` is where planes are looked for; `whole` is the whole outline, filled at the end
  const whole = input.inside;
  let inside = whole;
  if (input.ignore) {
    inside = new Uint8Array(N);
    for (let i = 0; i < N; i++) inside[i] = whole[i] && !input.ignore[i] ? 1 : 0;
  }
  const W = o.window;

  // ── 1. gradients ──
  const gx = new Float32Array(N), gy = new Float32Array(N), resid = new Float32Array(N).fill(Infinity);
  const need = Math.ceil((2 * W + 1) ** 2 * 0.75);
  const s = new Float64Array(9);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!inside[i]) continue;
      s.fill(0);
      for (let dy = -W; dy <= W; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -W; dx <= W; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const j = yy * w + xx;
          if (!inside[j]) continue;
          const zz = z[j];
          s[0]++; s[1] += dx; s[2] += dy; s[3] += zz; s[4] += dx * dx; s[5] += dx * dy; s[6] += dy * dy; s[7] += dx * zz; s[8] += dy * zz;
        }
      }
      if (s[0] < need) continue;
      const p = solvePlane(s);
      if (!p) continue;
      let e = 0, n = 0;
      for (let dy = -W; dy <= W; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -W; dx <= W; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const j = yy * w + xx;
          if (!inside[j]) continue;
          const d = z[j] - (p.gx * dx + p.gy * dy + p.c);
          e += d * d; n++;
        }
      }
      // the miss is measured square to the surface, so a steep facet is not judged harder than a shallow one
      gx[i] = p.gx; gy[i] = p.gy; resid[i] = Math.sqrt(e / n) / Math.sqrt(1 + (p.gx * p.gx + p.gy * p.gy) / (px * px));
    }
  }

  // ── 2. grow ──
  const label = new Int16Array(N).fill(-1);
  const tried = new Uint8Array(N);
  const minPx = Math.round(o.minRegionM2 / (px * px));
  const slopeTol = o.growSlope * px; // metres per pixel
  type Region = { sums: Float64Array; gx: number; gy: number; c: number; px: number[]; prior: boolean; asGiven?: boolean };
  const regions: Region[] = [];
  const queue = new Int32Array(N);
  const grow = (seed: number, start: { gx: number; gy: number; c: number }, prior: boolean): boolean => {
    const id = regions.length;
    const sums = new Float64Array(9);
    let pgx = start.gx, pgy = start.gy, pc = start.c;
    const members: number[] = [];
    // A segment of Google's keeps its own plane until the region is big enough to know better.
    let head = 0, tail = 0, nextRefit = prior ? 160 : 24;
    queue[tail++] = seed;
    label[seed] = id;
    while (head < tail) {
      const i = queue[head++];
      const x = i % w, y = (i / w) | 0;
      members.push(i);
      const zz = z[i];
      sums[0]++; sums[1] += x; sums[2] += y; sums[3] += zz; sums[4] += x * x; sums[5] += x * y; sums[6] += y * y; sums[7] += x * zz; sums[8] += y * zz;
      if (sums[0] >= nextRefit) {
        const p = solvePlane(sums);
        if (p) { pgx = p.gx; pgy = p.gy; pc = p.c; }
        nextRefit = Math.ceil(sums[0] * 1.5);
      }
      for (let k = 0; k < 4; k++) {
        const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0), ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (!inside[j] || label[j] !== -1) continue;
        // Tolerances are square to the plane: steep facets get the same benefit of the doubt as shallow ones.
        const steep = 1 + (pgx * pgx + pgy * pgy) / (px * px);
        if (Math.abs(z[j] - (pgx * nx + pgy * ny + pc)) > o.growDistM * Math.sqrt(steep)) continue;
        // A pixel with a clean slope of its own must agree with the plane; a noisy one (an edge) rides on height alone.
        if (resid[j] < o.seedResidM * 2 && Math.hypot(gx[j] - pgx, gy[j] - pgy) > slopeTol * steep) continue;
        label[j] = id;
        queue[tail++] = j;
      }
    }
    if (members.length < minPx) {
      if (!prior) {
        for (const i of members) { label[i] = -1; tried[i] = 1; }
        return false;
      }
      // Google says a facet is here and the height map would not grow one: keep Google's plane as it came, on the
      // few pixels it did take. It still has to earn its place at the selection step.
      regions.push({ sums, gx: start.gx, gy: start.gy, c: start.c, px: members, prior, asGiven: true });
      return true;
    }
    const p = solvePlane(sums) ?? { gx: pgx, gy: pgy, c: pc };
    regions.push({ sums, gx: p.gx, gy: p.gy, c: p.c, px: members, prior });
    return true;
  };
  // Google's segments first, the largest first: the seed is the free roof pixel nearest the centre that sits on the plane.
  for (const p of [...(input.priors ?? [])].sort((a, b) => b.areaM2 - a.areaM2)) {
    const c0 = p.zc - p.gx * p.cx - p.gy * p.cy;
    const R = Math.round(1.5 / px);
    let seed = -1, bd = Infinity;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const x = Math.round(p.cx) + dx, y = Math.round(p.cy) + dy;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const j = y * w + x;
      if (!inside[j] || label[j] !== -1) continue;
      if (Math.abs(z[j] - (p.gx * x + p.gy * y + c0)) > o.growDistM * 1.3 * Math.sqrt(1 + (p.gx * p.gx + p.gy * p.gy) / (px * px))) continue;
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; seed = j; }
    }
    const ok = seed !== -1 && grow(seed, { gx: p.gx, gy: p.gy, c: c0 }, true);
    input.trace?.push(`google segment ${p.areaM2.toFixed(0)} m2 pitch ${((Math.hypot(p.gx, p.gy) / px) * 12).toFixed(1)}: ${seed === -1 ? "no pixel near its centre sits on its plane" : ok ? `grew to ${(regions[regions.length - 1].px.length * px * px).toFixed(1)} m2${regions[regions.length - 1].asGiven ? " (kept as Google gave it)" : ""}` : "not grown"}`);
  }
  // Then whatever flat ground nobody claimed, flattest first.
  const order: number[] = [];
  for (let i = 0; i < N; i++) if (inside[i] && label[i] === -1 && resid[i] < o.seedResidM) order.push(i);
  order.sort((a, b) => resid[a] - resid[b]);
  for (const seed of order) {
    if (label[seed] !== -1 || tried[seed]) continue;
    const sx0 = seed % w, sy0 = (seed / w) | 0;
    grow(seed, { gx: gx[seed], gy: gy[seed], c: z[seed] - gx[seed] * sx0 - gy[seed] * sy0 }, false);
  }

  // ── 3. merge the regions that are one plane; drop the ones too narrow to be a facet ──
  const parent = regions.map((_, i) => i);
  const find = (a: number): number => (parent[a] === a ? a : (parent[a] = find(parent[a])));
  const cen = regions.map((r) => ({ x: r.sums[1] / r.sums[0], y: r.sums[2] / r.sums[0] }));
  const at = (r: { gx: number; gy: number; c: number }, p: { x: number; y: number }) => r.gx * p.x + r.gy * p.y + r.c;
  for (let a = 0; a < regions.length; a++) {
    for (let b = a + 1; b < regions.length; b++) {
      const A = regions[a], B = regions[b];
      if (Math.hypot(A.gx - B.gx, A.gy - B.gy) > o.mergeSlope * px) continue;
      if (Math.abs(at(A, cen[a]) - at(B, cen[a])) > o.mergeDistM || Math.abs(at(A, cen[b]) - at(B, cen[b])) > o.mergeDistM) continue;
      parent[find(a)] = find(b);
    }
  }
  const groups = new Map<number, number[]>();
  regions.forEach((_, i) => { const r = find(i); groups.set(r, [...(groups.get(r) ?? []), i]); });
  // Width: a two-pass city-block distance to the nearest pixel of another group; the largest value in a group is
  // half its widest part.
  const groupOf = new Int16Array(N).fill(-1);
  regions.forEach((r, i) => { const g = find(i); for (const k of r.px) groupOf[k] = g; });
  const dist = new Uint16Array(N);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, g = groupOf[i];
    if (g === -1) continue;
    const up = y > 0 && groupOf[i - w] === g ? dist[i - w] + 1 : 1, left = x > 0 && groupOf[i - 1] === g ? dist[i - 1] + 1 : 1;
    dist[i] = Math.min(up, left);
  }
  const widest = new Map<number, number>();
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const i = y * w + x, g = groupOf[i];
    if (g === -1) continue;
    const down = y < h - 1 && groupOf[i + w] === g ? dist[i + w] + 1 : 1, right = x < w - 1 && groupOf[i + 1] === g ? dist[i + 1] + 1 : 1;
    dist[i] = Math.min(dist[i], down, right);
    if (dist[i] > (widest.get(g) ?? 0)) widest.set(g, dist[i]);
  }

  // ── 4. regularize ──
  const axes = (input.axesDeg?.length ? input.axesDeg : [input.axisDeg]).map((d) => (d * Math.PI) / 180);
  let planes: Plane[] = [];
  const remap = new Int16Array(regions.length).fill(-1);
  type Pre = { members: number[]; prior: boolean; sums: Float64Array; fit: { gx: number; gy: number; c: number }; pixels: number[] };
  const pre: Pre[] = [];
  for (const [root, members] of groups) {
    const prior = members.some((m) => regions[m].prior);
    // steeper than 20-over-12 and not one of Google's: a wall or the side of a tree, never a roof facet
    if (!prior) {
      const m0 = regions[members[0]];
      if ((Math.hypot(m0.gx, m0.gy) / px) * 12 > 20) { input.trace?.push(`dropped a found region ${(members.reduce((n, m) => n + regions[m].px.length, 0) * px * px).toFixed(1)} m2: steeper than 20/12`); continue; }
    }
    if (!prior && (widest.get(root) ?? 0) * 2 * px < o.minWidthM) { input.trace?.push(`dropped a found region ${(members.reduce((n, m) => n + regions[m].px.length, 0) * px * px).toFixed(1)} m2: too narrow`); continue; }
    if (members.length > 1) input.trace?.push(`merged ${members.length} regions into one plane (${members.map((m) => (regions[m].prior ? "G" : "f") + (regions[m].px.length * px * px).toFixed(0)).join("+")} m2)`);
    const sums = new Float64Array(9);
    for (const m of members) for (let k = 0; k < 9; k++) sums[k] += regions[m].sums[k];
    const given = members.length === 1 && regions[members[0]].asGiven;
    const fit = given ? regions[members[0]] : (solvePlane(sums) ?? regions[members[0]]);
    pre.push({ members, prior, sums, fit, pixels: members.flatMap((m) => regions[m].px) });
  }
  // The roof's own pitch: the whole rise-over-12 most of its sloped area has. A house is framed at one pitch far more
  // often than not, and only planes of EQUAL pitch meet in hips that run at 45 degrees and ridges that sit centred —
  // so each plane is offered the roof's pitch first, and keeps its own only when the height map insists.
  const byPitch = new Map<number, number>();
  for (const q of pre) {
    const rise = (Math.hypot(q.fit.gx, q.fit.gy) / px) * 12;
    if (rise > 0.6) byPitch.set(Math.round(rise), (byPitch.get(Math.round(rise)) ?? 0) + q.pixels.length);
  }
  const housePitch = [...byPitch].sort((p, q) => q[1] - p[1])[0]?.[0] ?? null;
  for (const q of pre) {
    const { members, prior, sums, fit, pixels } = q;
    const rmsOf = (g: { gx: number; gy: number }) => {
      // the best offset for a fixed slope is the mean miss; the rms is sampled
      let e = 0;
      const c = (sums[3] - g.gx * sums[1] - g.gy * sums[2]) / sums[0];
      for (let k = 0; k < pixels.length; k += 3) {
        const i = pixels[k];
        const d = z[i] - (g.gx * (i % w) + g.gy * ((i / w) | 0) + c);
        e += d * d;
      }
      return { c, rms: Math.sqrt(e / Math.ceil(pixels.length / 3)) };
    };
    let g = { gx: fit.gx, gy: fit.gy };
    const base = rmsOf(g);
    const slope = Math.hypot(g.gx, g.gy) / px; // rise per run
    if (slope > 0.05) {
      // the direction the plane RISES, in window pixels (y south)
      const own = Math.atan2(g.gy, g.gx);
      // the nearest direction any part of the building runs in
      let turned: number | null = null, off = (o.axisSnapDeg * Math.PI) / 180;
      for (const axis of axes) {
        const onAxis = axis + (Math.round((own - axis) / (Math.PI / 2)) * Math.PI) / 2;
        if (Math.abs(own - onAxis) < off) { off = Math.abs(own - onAxis); turned = onAxis; }
      }
      const rise12 = slope * 12;
      const at = (dir: number, s12: number) => ({ gx: Math.cos(dir) * (s12 / 12) * px, gy: Math.sin(dir) * (s12 / 12) * px });
      const tries: Array<{ gx: number; gy: number }> = [];
      if (turned != null) {
        // (within a rise of 1 in 12, or within 4 degrees of it: on a steep roof a degree is two inches of rise)
        if (housePitch != null && (Math.abs(rise12 - housePitch) <= 1 || Math.abs(Math.atan(rise12 / 12) - Math.atan(housePitch / 12)) <= (4 * Math.PI) / 180)) tries.push(at(turned, housePitch));
        tries.push(at(turned, Math.round(rise12)), at(turned, rise12));
      }
      tries.push(at(own, Math.round(rise12)));
      for (const cg of tries) {
        const r = rmsOf(cg);
        // Tidying may cost a little fit, never much: 3 cm square to the roof (the miss is measured in height, and on
        // a steep plane 3 cm square to it is 4 or 5 cm of height), or a third more miss than the free plane had.
        if (r.rms <= Math.max(base.rms * 1.35, base.rms + 0.03 * Math.sqrt(1 + slope * slope))) { g = cg; break; }
      }
    }
    const fin = rmsOf(g);
    const id = planes.length;
    for (const m of members) remap[m] = id;
    planes.push({ id, gx: g.gx, gy: g.gy, c: fin.c, n: pixels.length, cx: sums[1] / sums[0], cy: sums[2] / sums[0], rms: fin.rms, prior });
  }
  for (let i = 0; i < N; i++) if (label[i] !== -1) label[i] = remap[label[i]];

  // ── 5. assign every roof pixel to the plane it sits on ──
  // Start from the regions' cores (pixels well on their own plane), then grow outwards one ring at a time; a contested
  // pixel goes to the plane it misses least. Growing — not a global nearest-plane rule — is what keeps a far plane
  // that happens to pass through the same height from claiming pixels across the roof.
  // the miss square to the plane, metres
  const steepOf = planes.map((p) => Math.sqrt(1 + (p.gx * p.gx + p.gy * p.gy) / (px * px)));
  const miss = (p: Plane, i: number) => Math.abs(z[i] - (p.gx * (i % w) + p.gy * ((i / w) | 0) + p.c)) / steepOf[p.id];
  const assign = (alive: boolean[]): Int16Array => {
    const out = new Int16Array(N).fill(-1);
    let frontier: number[] = [];
    for (let i = 0; i < N; i++) {
      const L = label[i];
      if (L === -1 || !alive[L]) continue;
      if (miss(planes[L], i) <= o.growDistM * 1.2) { out[i] = L; frontier.push(i); }
    }
    for (let round = 0; round < 600 && frontier.length; round++) {
      const claims = new Map<number, number>(); // pixel -> best plane
      for (const i of frontier) {
        const x = i % w, y = (i / w) | 0, p = out[i];
        for (let k = 0; k < 4; k++) {
          const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0), ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (!inside[j] || out[j] !== -1) continue;
          const d = miss(planes[p], j);
          if (d > o.assignDistM) continue;
          const cur = claims.get(j);
          if (cur === undefined || d < miss(planes[cur], j)) claims.set(j, p);
        }
      }
      frontier = [];
      for (const [j, p] of claims) { out[j] = p; frontier.push(j); }
    }
    // Boundary polish: a pixel between two planes belongs to the one it sits closer to, then a small mode filter
    // takes the salt out.
    for (let pass = 0; pass < 3; pass++) {
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (out[i] === -1) continue;
        let best = out[i], bd = miss(planes[best], i);
        for (const j of [i - 1, i + 1, i - w, i + w]) {
          const q = out[j];
          if (q === -1 || q === best) continue;
          const d = miss(planes[q], i);
          if (d < bd - 0.005) { best = q; bd = d; }
        }
        out[i] = best;
      }
    }
    const counts = new Map<number, number>();
    const mode = new Int16Array(out);
    for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) {
      const i = y * w + x;
      if (!inside[i]) continue;
      counts.clear();
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const j = i + dy * w + dx;
        if (!inside[j]) continue;
        counts.set(out[j], (counts.get(out[j]) ?? 0) + 1);
      }
      let best = out[i], bn = 0;
      for (const [q, n] of counts) if (n > bn) { best = q; bn = n; }
      if (bn >= 13) mode[i] = best;
    }
    return mode;
  };

  // ── 6. select: a plane found without Google must earn its place ──
  const alive = planes.map(() => true);
  let out = assign(alive);
  let frontierBase = 0;
  for (let i = 0; i < N; i++) if (inside[i]) { frontierBase = i; break; }
  for (let iter = 0; iter < 14; iter++) {
    const area = planes.map(() => 0);
    const adj = planes.map(() => new Set<number>());
    // per pair of neighbours: how many boundary pixels, and how far apart the two planes are there
    const seam = new Map<number, { n: number; gap: number; steps: number[]; sx: number; sy: number; sxx: number; sxy: number; syy: number }>();
    const zOf = (p: Plane, i: number) => p.gx * (i % w) + p.gy * ((i / w) | 0) + p.c;
    const REACH = 5; // pixels either side of a seam where the height map is read
    // pixel i (plane a) and its neighbour one step (dx, dy) on (plane b)
    const touch = (a: number, b: number, i: number, dx: number, dy: number) => {
      adj[a].add(b); adj[b].add(a);
      const k = a < b ? a * 4096 + b : b * 4096 + a;
      const sm = seam.get(k) ?? { n: 0, gap: 0, steps: [], sx: 0, sy: 0, sxx: 0, sxy: 0, syy: 0 };
      const x = i % w, y = (i / w) | 0;
      sm.n++; sm.gap += Math.abs(zOf(planes[a], i) - zOf(planes[b], i));
      sm.sx += x; sm.sy += y; sm.sxx += x * x; sm.sxy += x * y; sm.syy += y * y;
      // the real step across the seam: the height read REACH pixels into each plane, less what the two slopes alone
      // would make of those two readings were the surface unbroken
      const ax = x - dx * REACH, ay = y - dy * REACH, bx = x + dx * (REACH + 1), by = y + dy * (REACH + 1);
      if (ax >= 0 && ay >= 0 && bx < w && by < h && out[ay * w + ax] === a && out[by * w + bx] === b) {
        const A = planes[a], B = planes[b];
        const unbroken = (REACH + 0.5) * (B.gx * dx + B.gy * dy) + (REACH + 0.5) * (A.gx * dx + A.gy * dy);
        sm.steps.push(Math.abs(z[by * w + bx] - z[ay * w + ax] - unbroken));
      }
      seam.set(k, sm);
    };
    // running sums per plane over what it holds now (the tenth is the sum of squared heights, for the fit's miss)
    const zBase = z[frontierBase];
    const sumsOf = planes.map(() => new Float64Array(10));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, a = out[i];
      if (a === -1) continue;
      area[a]++;
      const zz = z[i] - zBase, sm = sumsOf[a];
      sm[0]++; sm[1] += x; sm[2] += y; sm[3] += zz; sm[4] += x * x; sm[5] += x * y; sm[6] += y * y; sm[7] += x * zz; sm[8] += y * zz; sm[9] += zz * zz;
      if (x + 1 < w) { const b = out[i + 1]; if (b !== -1 && b !== a) touch(a, b, i, 1, 0); }
      if (y + 1 < h) { const b = out[i + w]; if (b !== -1 && b !== a) touch(a, b, i, 0, 1); }
    }
    // how badly a set of pixels misses the one plane that fits it best, metres (rms)
    const missOf = (sm: Float64Array): number => {
      const n = sm[0];
      if (n < 6) return Infinity;
      const mx = sm[1] / n, my = sm[2] / n, mz = sm[3] / n;
      const sxx = sm[4] - n * mx * mx, sxy = sm[5] - n * mx * my, syy = sm[6] - n * my * my;
      const sxz = sm[7] - n * mx * mz, syz = sm[8] - n * my * mz, szz = sm[9] - n * mz * mz;
      const det = sxx * syy - sxy * sxy;
      if (Math.abs(det) < 1e-9 * Math.max(1, sxx * syy)) return Infinity;
      const gx1 = (sxz * syy - syz * sxy) / det, gy1 = (syz * sxx - sxz * sxy) / det;
      return Math.sqrt(Math.max(0, szz - gx1 * sxz - gy1 * syz) / n);
    };
    // One surface: two neighbours facing the same way at nearly the same pitch, with no step where they touch, are
    // one facet that the height map bent a little — the smaller joins the larger. (A real pitch change keeps its
    // line: it differs by more than a rise of 1.25 in 12, or 1.75 for a small patch on a big face.)
    const fused = new Set<number>();
    for (const [k, sm] of [...seam].sort((p, q) => p[1].gap / p[1].n - q[1].gap / q[1].n)) {
      const a = Math.floor(k / 4096), b = k % 4096;
      if (sm.n < 8 || fused.has(a) || fused.has(b)) continue;
      const A = planes[a], B = planes[b];
      const sa = Math.hypot(A.gx, A.gy) / px, sb = Math.hypot(B.gx, B.gy) / px;
      const flat = sa < 0.06 && sb < 0.06;
      const cos = (A.gx * B.gx + A.gy * B.gy) / (Math.hypot(A.gx, A.gy) * Math.hypot(B.gx, B.gy) || 1);
      const [big, small] = area[a] >= area[b] ? [a, b] : [b, a];
      // how far apart the two surfaces really are at the seam: read off the height map where there is room to read
      // it, else what the two fitted planes say
      const gap = sm.steps.length >= 6 ? [...sm.steps].sort((p, q) => p - q)[sm.steps.length >> 1] : sm.gap / sm.n;
      // a small patch on a big face may differ a little more before it is believed to be a facet of its own
      const ratio = area[small] / Math.max(1, area[big]);
      // (…or by the same few degrees: 1.25 in 12 is 4.6 degrees on a 6/12 roof, and on a 14/12 roof 4.6 degrees is a
      // rise of 2.5 — a steep face read as 14 here and 16 there is one face)
      const tilt = Math.abs(Math.atan(sa) - Math.atan(sb)) * (180 / Math.PI);
      const alike = Math.abs(sa - sb) * 12 <= (ratio < 0.3 ? 1.75 : 1.25) || tilt <= (ratio < 0.3 ? 6.2 : 4.6);
      let one = gap <= 0.2 && alike && (flat || cos >= Math.cos((15 * Math.PI) / 180));
      if (!one && !flat && gap <= 0.2 && cos >= Math.cos((40 * Math.PI) / 180)) {
        // Two planes facing the same way at DIFFERENT pitches can only meet along a level line (the porch roof's
        // break, the gambrel's knuckle). A seam between them that climbs the slope is not a pitch change — it is one
        // face the height map read as two.
        const mx = sm.sx / sm.n, my = sm.sy / sm.n;
        const vxx = sm.sxx / sm.n - mx * mx, vxy = sm.sxy / sm.n - mx * my, vyy = sm.syy / sm.n - my * my;
        const seamDir = 0.5 * Math.atan2(2 * vxy, vxx - vyy);
        const long = (vxx + vyy) / 2 + Math.hypot((vxx - vyy) / 2, vxy), short = (vxx + vyy) / 2 - Math.hypot((vxx - vyy) / 2, vxy);
        const G = planes[big];
        const levelDir = Math.atan2(G.gx, -G.gy); // square to the way the big plane rises
        let off = Math.abs(seamDir - levelDir) % Math.PI;
        if (off > Math.PI / 2) off = Math.PI - off;
        // only a seam that clearly runs somewhere (three times longer than wide) says anything about its direction
        if (long > 9 * Math.max(short, 0.5) && off > (30 * Math.PI) / 180) one = true;
      }
      if (!one && !flat && cos >= Math.cos((40 * Math.PI) / 180)) {
        // The plainest test of all: do the two together fit ONE plane about as well as each fits its own? Then the
        // height map never showed two faces there, whatever the two fits happened to say about pitch and facing.
        const both = new Float64Array(10);
        for (let q = 0; q < 10; q++) both[q] = sumsOf[a][q] + sumsOf[b][q];
        const together = missOf(both), apart = Math.max(missOf(sumsOf[a]), missOf(sumsOf[b]));
        if (together <= 0.11 && together <= apart * 1.3 + 0.015) one = true;
      }
      if (!one) continue;
      alive[small] = false;
      for (let i = 0; i < N; i++) if (label[i] === small) label[i] = big;
      fused.add(a); fused.add(b);
      input.trace?.push(`fused two planes facing the same way (${(area[small] * px * px).toFixed(1)} m2 into ${(area[big] * px * px).toFixed(1)} m2, ${gap.toFixed(2)} m apart where they touch${alike ? "" : ", their seam climbed the slope"})`);
    }
    if (fused.size) { out = assign(alive); continue; }
    // how badly a plane's pixels would sit on its neighbours' planes
    const alt = planes.map(() => 0);
    for (let i = 0; i < N; i++) {
      const a = out[i];
      if (a === -1 || !adj[a].size) continue;
      let best = 0.6;
      for (const b of adj[a]) best = Math.min(best, miss(planes[b], i));
      alt[a] += best * best;
    }
    const score = planes.map((p, k) => {
      if (!alive[k]) return Infinity;
      const m2 = area[k] * px * px;
      if (m2 < (p.prior ? 0.8 : o.earnAreaM2)) return -1; // lost or never big enough
      if (!adj[k].size) return Infinity; // stands alone — nothing to hand its pixels to
      const d = Math.sqrt(alt[k] / Math.max(1, area[k]));
      // a small plane has to be the more distinct; one of Google's needs only half the distinction
      const needed = (p.prior ? 0.5 : 1) * o.earnDistM * Math.sqrt(Math.max(1, 4 / m2));
      return d / needed;
    });
    // the weakest plane that fails goes, with every other failing plane that is not its neighbour's neighbour
    const failing = planes.map((_, k) => k).filter((k) => alive[k] && score[k] < 1).sort((a, b) => score[a] - score[b]);
    if (!failing.length) break;
    const blocked = new Set<number>();
    for (const k of failing) {
      if (blocked.has(k)) continue;
      alive[k] = false;
      input.trace?.push(`removed plane ${planes[k].prior ? "G" : "found"} ${(area[k] * px * px).toFixed(1)} m2 pitch ${((Math.hypot(planes[k].gx, planes[k].gy) / px) * 12).toFixed(1)}: score ${score[k].toFixed(2)} (${score[k] < 0 ? "too small" : "sits on its neighbours' planes"})`);
      for (const b of adj[k]) blocked.add(b);
    }
    out = assign(alive);
  }

  // ── 7. fill: what is still nobody's takes the nearest plane ──
  let frontier: number[] = [];
  for (let i = 0; i < N; i++) if (out[i] !== -1) frontier.push(i);
  while (frontier.length) {
    const next: number[] = [];
    for (const i of frontier) {
      const x = i % w, y = (i / w) | 0;
      for (let k = 0; k < 4; k++) {
        const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0), ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (!whole[j] || out[j] !== -1) continue;
        out[j] = out[i];
        next.push(j);
      }
    }
    frontier = next;
  }

  // renumber the planes that stayed
  const renum = new Int16Array(planes.length).fill(-1);
  const kept: Plane[] = [];
  planes.forEach((p, k) => { if (alive[k]) { renum[k] = kept.length; kept.push({ ...p, id: kept.length }); } });
  const sumN = kept.map(() => 0), sumX = kept.map(() => 0), sumY = kept.map(() => 0);
  for (let i = 0; i < N; i++) {
    if (out[i] === -1) continue;
    const k = renum[out[i]];
    out[i] = k;
    if (k !== -1) { sumN[k]++; sumX[k] += i % w; sumY[k] += (i / w) | 0; }
  }
  kept.forEach((p, k) => { if (sumN[k]) { p.n = sumN[k]; p.cx = sumX[k] / sumN[k]; p.cy = sumY[k] / sumN[k]; } });
  planes = kept;
  return { w, h, inside: whole, z, planes, label: out };
}
