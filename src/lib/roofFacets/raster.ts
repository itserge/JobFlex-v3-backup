// ROOF FACETS — RASTER HELPERS (2026-11-11): the window the engine works in, the outline filled into it, and the
// small shift that sits EagleView's outline on Google's height map. Pure.

export interface Pt { x: number; y: number }

export interface FacetRaster {
  width: number;
  height: number;
  data: Float32Array;
  pixelSizeM: number;
}

/** Even-odd scanline fill of one or more rings into a w*h bitmap (pixel centres). */
export function fillRings(rings: ReadonlyArray<ReadonlyArray<Pt>>, w: number, h: number, value = 1, into?: Uint8Array | Int32Array): Uint8Array | Int32Array {
  const out = into ?? new Uint8Array(w * h);
  let y0 = Infinity, y1 = -Infinity;
  for (const r of rings) for (const p of r) { y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  const xs: number[] = [];
  for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(h - 1, Math.ceil(y1)); y++) {
    const cy = y + 0.5;
    xs.length = 0;
    for (const r of rings) {
      for (let i = 0; i < r.length; i++) {
        const a = r[i], b = r[(i + 1) % r.length];
        if ((a.y <= cy && b.y > cy) || (b.y <= cy && a.y > cy)) xs.push(a.x + ((cy - a.y) / (b.y - a.y)) * (b.x - a.x));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.ceil(xs[k] - 0.5)), xb = Math.min(w - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = xa; x <= xb; x++) out[y * w + x] = value;
    }
  }
  return out;
}

export function ringArea(r: ReadonlyArray<Pt>): number {
  let a = 0;
  for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p.x * q.y - q.x * p.y; }
  return a / 2;
}

export function pointInRing(p: Pt, r: ReadonlyArray<Pt>): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i], b = r[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * Where the outline sits best on the height map: the whole-pixel shift (within `maxShiftPx`) that puts the most of
 * the outline's inside on the building and the least of the building just outside it. EagleView traces the roof on
 * its own photographs and Google's elevation comes from another flight — the two are a few feet apart on most houses.
 *
 * `building` is 1 where the height map shows a structure (Google's mask, and well above the ground).
 */
export function registerOutline(ring: ReadonlyArray<Pt>, building: Uint8Array, w: number, h: number, maxShiftPx: number): { dx: number; dy: number; score: number; unshiftedScore: number } {
  const fill = fillRings([ring], w, h) as Uint8Array;
  // a band just outside the outline, ~0.8 m wide
  const BAND = 8;
  const band = new Uint8Array(w * h);
  const insideIdx: number[] = [], bandIdx: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (fill[i]) { insideIdx.push(i); continue; }
    let near = false;
    for (let d = 1; d <= BAND && !near; d++) {
      if ((x - d >= 0 && fill[i - d]) || (x + d < w && fill[i + d]) || (y - d >= 0 && fill[i - d * w]) || (y + d < h && fill[i + d * w])) near = true;
    }
    if (near) { band[i] = 1; bandIdx.push(i); }
  }
  const scoreAt = (dx: number, dy: number, stride: number): number => {
    let s = 0;
    for (let k = 0; k < insideIdx.length; k += stride) {
      const i = insideIdx[k], x = (i % w) + dx, y = ((i / w) | 0) + dy;
      if (x >= 0 && y >= 0 && x < w && y < h && building[y * w + x]) s++;
    }
    for (let k = 0; k < bandIdx.length; k += stride) {
      const i = bandIdx[k], x = (i % w) + dx, y = ((i / w) | 0) + dy;
      if (x >= 0 && y >= 0 && x < w && y < h && building[y * w + x]) s--;
    }
    return s * stride;
  };
  let best = { dx: 0, dy: 0, score: -Infinity };
  for (let dy = -maxShiftPx; dy <= maxShiftPx; dy += 3) for (let dx = -maxShiftPx; dx <= maxShiftPx; dx += 3) {
    const s = scoreAt(dx, dy, 5);
    // ties go to the smaller shift
    if (s > best.score || (s === best.score && Math.hypot(dx, dy) < Math.hypot(best.dx, best.dy))) best = { dx, dy, score: s };
  }
  const coarse = best;
  best = { ...coarse, score: -Infinity };
  for (let dy = coarse.dy - 3; dy <= coarse.dy + 3; dy++) for (let dx = coarse.dx - 3; dx <= coarse.dx + 3; dx++) {
    const s = scoreAt(dx, dy, 1);
    if (s > best.score || (s === best.score && Math.hypot(dx, dy) < Math.hypot(best.dx, best.dy))) best = { dx, dy, score: s };
  }
  return { ...best, unshiftedScore: scoreAt(0, 0, 1) };
}

/**
 * Square off a traced outline's clipped corners. EagleView's outline often cuts a corner with a stub a foot or two
 * long; on the drawing each stub is an edge of its own (a 2-foot "rake" at the end of an eave). Where a stub shorter
 * than `shortPx` joins two long edges whose lines meet close by, the two long edges are run on to that meeting point.
 * A jog between two parallel walls has no such point and is left alone.
 */
export function sharpenCorners(ring: ReadonlyArray<Pt>, shortPx: number, longPx: number): Pt[] {
  let out = [...ring];
  for (let guard = 0; guard < 40; guard++) {
    const n = out.length;
    if (n < 5) break;
    let done = false;
    for (let i = 0; i < n && !done; i++) {
      const p0 = out[(i - 1 + n) % n], a = out[i], b = out[(i + 1) % n], p3 = out[(i + 2) % n];
      if (Math.hypot(b.x - a.x, b.y - a.y) >= shortPx) continue;
      const d1 = { x: a.x - p0.x, y: a.y - p0.y }, d2 = { x: p3.x - b.x, y: p3.y - b.y };
      const l1 = Math.hypot(d1.x, d1.y), l2 = Math.hypot(d2.x, d2.y);
      if (l1 < longPx || l2 < longPx) continue;
      const den = d1.x * d2.y - d1.y * d2.x;
      if (Math.abs(den) < Math.sin((25 * Math.PI) / 180) * l1 * l2) continue; // the two walls run (nearly) the same way
      const t = ((b.x - p0.x) * d2.y - (b.y - p0.y) * d2.x) / den;
      const m = { x: p0.x + d1.x * t, y: p0.y + d1.y * t };
      // the corner must be where the stub is, not somewhere across the yard
      if (Math.hypot(m.x - (a.x + b.x) / 2, m.y - (a.y + b.y) / 2) > shortPx * 1.5) continue;
      const next = out.filter((_, k) => k !== i && k !== (i + 1) % n);
      next.splice(i > (i + 1) % n ? 0 : i, 0, m);
      out = next;
      done = true;
    }
    if (!done) break;
  }
  return out;
}
