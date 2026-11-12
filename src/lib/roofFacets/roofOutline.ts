// ROOF FACETS — THE ROOF'S OWN OUTLINE (2026-11-12, owner, looking at a roof measured from Google alone: "should
// draw only roof … no garden on the side of the house … angles not 90"). A roof with no EagleView outline was drawn
// inside Google's building mask as it came, and that mask is generous: on the first real roofs it took in a raised
// deck, a driveway at ground level, and the strip beside a wall where the height map smears the wall into a slope;
// and, traced raw, its edges ran a few degrees off square.
//
// Here the outline is read off the height map instead, with the mask only as the place to look:
//
//   1. ground     the ground under the house, carried in from the open ground round it (so a sloping lot is not
//                 mistaken for height)
//   2. height     what does not stand 1.8 m above that ground is not a roof (a driveway, a patio)
//   3. planes     ./planes, inside what is left — the same planes the facets are later cut from
//   4. not roof   a plane far steeper than the house's pitch and only a step wide is a wall (or a hedge) seen from
//                 above; a flat plane a storey below the roof beside it, on a pitched house, is a deck
//   5. on a plane a pixel is roof when it sits on its plane — or, where Google's mask calls it building, above it (a
//                 tree, a chimney: the roof runs on underneath) or below it on a gentle slope (a low roof the planes
//                 missed). Below the plane and steep is the wall past the roof's edge.
//   6. square     the shape is turned to the building's own directions (read off its roof planes) and traced; every
//                 wall then runs along one of the two directions, and a jog under 0.8 m is taken out by moving one
//                 of the two walls beside it onto the other's line — whichever move throws away less roof and takes
//                 in less of what is not roof. What a tree hides counts for neither, so a wall half under a canopy
//                 is placed by the half that shows; and a small notch or bump that is not plain to see is taken out,
//                 the wall running on straight. A wall truly set at an angle stays slanted.
//
// Pure: rasters and numbers in, a ring out. Raster pixels throughout (x east, y south).

import { buildStructureFootprints } from "@/lib/roofRecon/footprint";
import { findPlanes, outlineAxesDeg, priorsInWindow, type RoofSegmentPx } from "./planes";
import { fillRings, ringArea, type Pt } from "./raster";

export interface RoofOutlineInput {
  dsm: { width: number; height: number; data: Float32Array; pixelSizeM: number };
  /** Google's building mask on the same grid */
  mask: { width: number; height: number; data: Float32Array };
  /** the building's outline in that mask as traced (raster pixels): where to look */
  seed: ReadonlyArray<Pt>;
  /** Google's roof segments, centres in raster pixels */
  priors: ReadonlyArray<RoofSegmentPx>;
  trace?: string[];
  /** the lab's look inside: per window pixel 1 roof, 2 hidden under something, 3 too low, 4 deck, 5 beside a wall, 6 past the edge */
  inspect?: (view: { x0: number; y0: number; w: number; h: number; kind: Uint8Array; ground: Float32Array }) => void;
}

export interface RoofOutline {
  /** raster pixels, continuous */
  ring: Pt[];
  /** plan area of the seed and of the roof read inside it, square metres */
  seedM2: number;
  roofM2: number;
  /** what was inside Google's outline and is not roof, square metres each */
  leftOut: { ground: number; deck: number; side: number; offPlane: number };
}

/** Under this a thing is not a roof, metres above the ground beside the house (a head lower than any eave: the ground is an estimate). */
const MIN_ROOF_HEIGHT_M = 1.5;
/** Steeper than this from pixel to pixel is a wall (or the side of a tree) smeared by the height map, rise per run. */
const WALL_SLOPE = 1.3;
/** How far a pixel may sit off its plane, square to the roof, metres. */
const ON_PLANE_M = 0.3;
/**
 * A flat plane this far below the low edge of the roof beside it, on a pitched house, is a deck: a deck sits at floor
 * level, a storey under the eave, where a flat patio cover hangs just below it (and stays).
 */
const DECK_DROP_M = 2.0;

// ── small raster tools (r steps, alternating the 4- and the 8-neighbourhood: an octagon) ──
function step(src: Uint8Array, w: number, h: number, grow: boolean, eight: boolean): Uint8Array {
  const out = new Uint8Array(src.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    let hit = src[i] === 1;
    if (grow ? !hit : hit) {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if ((!dx && !dy) || (!eight && dx && dy)) continue;
        const nx = x + dx, ny = y + dy;
        const v = nx < 0 || ny < 0 || nx >= w || ny >= h ? 0 : src[ny * w + nx];
        if (grow ? v === 1 : v === 0) hit = grow;
      }
    }
    out[i] = hit ? 1 : 0;
  }
  return out;
}
function spread(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  let cur = src;
  for (let k = 0; k < r; k++) cur = step(cur, w, h, true, k % 2 === 1);
  return cur;
}
function shrink(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  let cur = src;
  for (let k = 0; k < r; k++) cur = step(cur, w, h, false, k % 2 === 1);
  return cur;
}
/** What the outside cannot reach is inside: holes are filled. */
function fillHoles(bin: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(bin.length).fill(1);
  const stack: number[] = [];
  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = y * w + x;
    if (bin[i] || !out[i]) return;
    out[i] = 0;
    stack.push(i);
  };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  while (stack.length) {
    const i = stack.pop() as number;
    const x = i % w, y = (i / w) | 0;
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }
  return out;
}
/** The largest 4-connected piece. */
function largestPiece(bin: Uint8Array, w: number, h: number): Uint8Array {
  const seen = new Int32Array(bin.length);
  let best = 0, bestN = 0, id = 0;
  const stack: number[] = [];
  for (let s = 0; s < bin.length; s++) {
    if (!bin[s] || seen[s]) continue;
    id++;
    let n = 0;
    seen[s] = id;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop() as number;
      n++;
      const x = i % w, y = (i / w) | 0;
      if (x + 1 < w && bin[i + 1] && !seen[i + 1]) { seen[i + 1] = id; stack.push(i + 1); }
      if (x > 0 && bin[i - 1] && !seen[i - 1]) { seen[i - 1] = id; stack.push(i - 1); }
      if (y + 1 < h && bin[i + w] && !seen[i + w]) { seen[i + w] = id; stack.push(i + w); }
      if (y > 0 && bin[i - w] && !seen[i - w]) { seen[i - w] = id; stack.push(i - w); }
    }
    if (n > bestN) { bestN = n; best = id; }
  }
  const out = new Uint8Array(bin.length);
  if (best) for (let i = 0; i < bin.length; i++) if (seen[i] === best) out[i] = 1;
  return out;
}

/** The outline of `bin` (one piece, no holes) as a loop of pixel corners, the inside on the right of travel. Corners only. */
function traceLoop(bin: Uint8Array, w: number, h: number): Pt[] | null {
  let start = -1;
  for (let i = 0; i < bin.length; i++) if (bin[i]) { start = i; break; }
  if (start < 0) return null;
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && bin[y * w + x] === 1;
  const sx = start % w, sy = (start / w) | 0;
  const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1]; // east, south, west, north
  let cx = sx, cy = sy, d = 0, steps = 0;
  const out: Pt[] = [];
  const limit = 4 * (w + 1) * (h + 1);
  for (;;) {
    // the two pixels ahead of this corner: on the right hand and on the left hand of the way we are going
    const R = d === 0 ? at(cx, cy) : d === 1 ? at(cx - 1, cy) : d === 2 ? at(cx - 1, cy - 1) : at(cx, cy - 1);
    const L = d === 0 ? at(cx, cy - 1) : d === 1 ? at(cx, cy) : d === 2 ? at(cx - 1, cy) : at(cx - 1, cy - 1);
    const nd = !R ? (d + 1) % 4 : L ? (d + 3) % 4 : d;
    const home = steps > 0 && cx === sx && cy === sy;
    if (nd !== d || (home && nd === 0 && d !== 0)) out.push({ x: cx, y: cy });
    if (home && nd === 0) break;
    d = nd;
    cx += DX[d]; cy += DY[d];
    if (++steps > limit) return null;
  }
  return out.length >= 4 ? out : null;
}

/** Running sums of a 0/1 picture, for counting inside any upright box at once. */
function sums(bin: Uint8Array, w: number, h: number): Int32Array {
  const t = new Int32Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) { row += bin[y * w + x]; t[(y + 1) * (w + 1) + x + 1] = t[y * (w + 1) + x + 1] + row; }
  }
  return t;
}

/**
 * A traced loop made of walls: slanted walls are found first (a long run of one- to three-pixel stairs; `minEdge`
 * is their yardstick), then the short upright and level edges are taken out one by one, each by sliding one of its
 * two neighbours onto the other's line. The four pictures say what each slide costs (see `slide`): roof seen on its
 * plane, what was seen not to be roof, and the two kinds of ground a tree hides — `under` it where Google calls it
 * building, `beside` the building where it does not.
 */
function squareLoop(
  loop: Pt[], seen: Uint8Array, not: Uint8Array, under: Uint8Array, beside: Uint8Array, open: Uint8Array, w: number, h: number,
  /** all in pixels (notch in square pixels): the slant yardstick, and the edge lengths the squaring goes by */
  k: { yard: number; hard: number; jog: number; wall: number; soft: number; notch: number },
): Pt[] {
  const minEdge = k.yard, hardEdge = k.hard, softEdge = k.soft;
  let v = loop.map((p) => ({ x: p.x, y: p.y, diag: false }));
  const len = (i: number) => { const a = v[i], b = v[(i + 1) % v.length]; return Math.abs(b.x - a.x) + Math.abs(b.y - a.y); };

  // ── slanted walls ──
  {
    const n = v.length;
    const L = v.map((_, i) => len(i));
    const turn = v.map((b, i) => { const a = v[(i + n - 1) % n], c = v[(i + 1) % n]; return Math.sign((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)); });
    const first = L.findIndex((l) => l > 3);
    if (first >= 0) {
      const drop = new Uint8Array(n);
      const corners: Array<{ at: number; m: number; pt: Pt }> = [];
      for (let k = 0; k < n - 1; ) {
        const e = (first + 1 + k) % n;
        if (L[e] > 3) { k++; continue; }
        let m = 1;
        while (k + m < n - 1) {
          const e2 = (e + m) % n;
          if (L[e2] > 3 || (m >= 2 && turn[e2] !== -turn[(e2 + n - 1) % n])) break;
          m++;
        }
        // the run is the edges e … e+m-1, from corner e to corner e+m
        const a = v[e], b = v[(e + m) % n];
        const dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y);
        if (m >= 8 && Math.hypot(dx, dy) >= minEdge * 1.9 && Math.min(dx, dy) >= Math.max(dx, dy) * 0.27) {
          // A short slant is the height map rounding the building's corners, not a wall: it fills an inside corner
          // in and clips an outside one. Between two walls square to each other the true corner is where their lines
          // meet; between two walls running the same way (a step in the wall) the filled-in side is cut back. Under
          // 4 m for a filled corner, 3.2 m for a clipped one; anything longer is a wall set at an angle and stays.
          const before = v[(e + n - 1) % n], after = v[(e + m + 1) % n];
          const bx = a.x - before.x, by = a.y - before.y, ax = after.x - b.x, ay = after.y - b.y;
          const dot = bx * ax + by * ay, cross = bx * ay - by * ax; // cross > 0: a right turn, an outside corner
          const chord = Math.hypot(dx, dy);
          let pt: Pt | null = null;
          if (dot === 0 && chord < (cross < 0 ? 5 : 4) * minEdge) pt = by === 0 ? { x: b.x, y: a.y } : { x: a.x, y: b.y };
          else if (dot > 0 && chord < 5 * minEdge) {
            const c1 = { x: b.x, y: a.y }, c2 = { x: a.x, y: b.y };
            // the one on the inside of the slant (the right of the way we go)
            pt = (b.x - a.x) * (c1.y - a.y) - (b.y - a.y) * (c1.x - a.x) > 0 ? c1 : c2;
          }
          if (pt) corners.push({ at: e, m, pt });
          else { for (let j = 1; j < m; j++) drop[(e + j) % n] = 1; v[e].diag = true; }
        }
        k += m;
      }
      // a rounded corner becomes the square corner: the stairs between its two ends give way to one point
      for (const c of corners) {
        for (let j = 1; j < c.m; j++) drop[(c.at + j) % n] = 1;
        const keep = (c.at + 1) % n;
        drop[keep] = 0;
        v[keep] = { x: c.pt.x, y: c.pt.y, diag: false };
      }
      v = v.filter((_, i) => !drop[i]);
    }
  }

  const seenT = sums(seen, w, h), notT = sums(not, w, h), underT = sums(under, w, h), besideT = sums(beside, w, h), openT = sums(open, w, h);
  const box = (t: Int32Array, xa: number, ya: number, xb: number, yb: number) => {
    const x0 = Math.max(0, Math.min(xa, xb)), x1 = Math.min(w, Math.max(xa, xb)), y0 = Math.max(0, Math.min(ya, yb)), y1 = Math.min(h, Math.max(ya, yb));
    if (x1 <= x0 || y1 <= y0) return 0;
    return t[y1 * (w + 1) + x1] - t[y0 * (w + 1) + x1] - t[y1 * (w + 1) + x0] + t[y0 * (w + 1) + x0];
  };
  /**
   * What it costs to slide the edge p→q by (mx, my). Inward (the inside is on its right) it gives up roof: every
   * pixel SEEN on its plane counts one, a pixel under a tree that Google calls building counts half. Outward it
   * takes in what is not roof: one for a pixel seen not to be, half for one under a tree that Google does not call
   * building. So where a tree leaves nothing to see, Google's mask has the last word.
   */
  const slide = (p: Pt, q: Pt, mx: number, my: number) => {
    const dx = Math.sign(q.x - p.x), dy = Math.sign(q.y - p.y);
    const inward = mx * -dy + my * dx > 0;
    const xa = Math.min(p.x, q.x, p.x + mx, q.x + mx), ya = Math.min(p.y, q.y, p.y + my, q.y + my), xb = Math.max(p.x, q.x, p.x + mx, q.x + mx), yb = Math.max(p.y, q.y, p.y + my, q.y + my);
    return {
      cost: inward ? box(seenT, xa, ya, xb, yb) + 0.5 * box(underT, xa, ya, xb, yb) : box(notT, xa, ya, xb, yb) + 0.5 * box(besideT, xa, ya, xb, yb),
      // what would make the thing slid over REAL beyond doubt: roof seen on its plane in a bump, open ground in a notch
      plain: inward ? box(seenT, xa, ya, xb, yb) : box(openT, xa, ya, xb, yb),
      area: (xb - xa) * (yb - ya),
    };
  };
  const tidy = () => {
    for (let again = true; again && v.length > 4; ) {
      again = false;
      for (let i = 0; i < v.length && v.length > 4; i++) {
        const n = v.length, a = v[(i + n - 1) % n], b = v[i], c = v[(i + 1) % n];
        if (b.x === c.x && b.y === c.y) { if (c.diag) b.diag = true; v.splice((i + 1) % n, 1); again = true; i--; continue; }
        if (!a.diag && !b.diag && (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) === 0) { v.splice(i, 1); again = true; i--; }
      }
    }
  };
  tidy();
  // An edge under `hard` is the height map's wobble and always goes. One up to `soft` goes when taking it out is
  // cheap — most of what the slide gives up or takes in is hidden under something — so a bite a tree took out of the
  // eave is closed. A dear one stays when it is a real step in a wall: `jog` long or more, or shorter between two
  // walls of `wall` each (a two-foot jog between two long walls is a jog; between two short ones it is raggedness).
  //
  // And where it cannot be seen well, a wall is taken to run on straight (owner, 2026-11-12: "if it's not visible,
  // logically we have to run the straight line … assume it's a continuation"): a small notch or bump — under
  // `notch` in area, its sides under `soft`, no wider than `wall` — is taken out whatever it costs, unless it is
  // plain to see: open ground in the notch, roof seen on its plane in the bump. A gap in shadow between two parts
  // of a roof is neither.
  const firm = new Set<object>();
  const way = (i: number) => { const p = v[i], q = v[(i + 1) % v.length]; return { x: Math.sign(q.x - p.x), y: Math.sign(q.y - p.y) }; };
  for (let guard = 0; guard < 20000 && v.length > 4; guard++) {
    const n = v.length;
    let best = -1, bl = softEdge;
    for (let i = 0; i < n; i++) {
      if (v[i].diag || firm.has(v[i]) || v[(i + n - 1) % n].diag || v[(i + 1) % n].diag) continue;
      const L = len(i);
      if (L < bl) { bl = L; best = i; }
    }
    if (best < 0) break;
    const i = best, im = (i + n - 1) % n, ip = (i + 1) % n, ipp = (i + 2) % n, imm = (i + n - 2) % n;
    const a = v[i], b = v[ip], sx = b.x - a.x, sy = b.y - a.y;
    // A: the wall after slides back onto the line of the wall before; B: the wall before slides forward
    const canA = !v[ipp].diag, canB = !v[imm].diag;
    if (!canA && !canB) { firm.add(v[i]); continue; }
    const A = canA ? slide(b, v[ipp], -sx, -sy) : null, B = canB ? slide(v[im], a, sx, sy) : null;
    // this edge and the one two on (or two back) run opposite ways: the two sides of a notch or a bump
    const me = way(i), after = way(ipp), before = way(imm);
    // (its end no longer than `wall`: a long shallow shelf is a wall standing a little back, not a notch)
    const unclear = (o: { plain: number; area: number } | null, other: { x: number; y: number }, end: number) =>
      o != null && other.x === -me.x && other.y === -me.y && end <= k.wall && o.area < k.notch && o.plain < 0.5 * o.area;
    const uA = unclear(A, after, len(ip)), uB = unclear(B, before, len(im));
    let useA: boolean;
    if (uA || uB) {
      useA = uA && (!uB || (A as { cost: number }).cost <= (B as { cost: number }).cost);
    } else {
      const costA = A ? A.cost : Infinity, costB = B ? B.cost : Infinity;
      useA = costA < costB || (costA === costB && len(ip) <= len(im));
      if (bl >= hardEdge) {
        const dear = (useA ? costA : costB) > 0.3 * bl * (useA ? len(ip) : len(im));
        const walls = bl >= k.jog || (len(im) >= k.wall && len(ip) >= k.wall);
        if (dear && walls) { firm.add(v[i]); continue; }
      }
    }
    if (useA) { v[ipp].x -= sx; v[ipp].y -= sy; } else { v[im].x += sx; v[im].y += sy; }
    // the short edge's two ends go (the higher index first)
    for (const q of [i, ip].sort((x, y) => y - x)) v.splice(q, 1);
    firm.clear();
    tidy();
  }
  return v.map((p) => ({ x: p.x, y: p.y }));
}

const quantile = (sorted: ArrayLike<number>, q: number): number => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * q)))];

export function roofOutline(input: RoofOutlineInput): RoofOutline | null {
  const { dsm, mask } = input;
  const px = dsm.pixelSizeM;
  if (mask.width !== dsm.width || mask.height !== dsm.height || input.seed.length < 3) return null;

  // ── the window: the seed and 6 m of the ground round it ──
  const PAD = Math.round(6 / px);
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (const p of input.seed) { bx0 = Math.min(bx0, p.x); by0 = Math.min(by0, p.y); bx1 = Math.max(bx1, p.x); by1 = Math.max(by1, p.y); }
  const x0 = Math.max(0, Math.floor(bx0 - PAD)), y0 = Math.max(0, Math.floor(by0 - PAD));
  const x1 = Math.min(dsm.width, Math.ceil(bx1 + PAD)), y1 = Math.min(dsm.height, Math.ceil(by1 + PAD));
  const w = x1 - x0, h = y1 - y0, N = w * h;
  if (w < 16 || h < 16) return null;
  const z = new Float32Array(N), built = new Uint8Array(N);
  const all: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, j = (y + y0) * dsm.width + x + x0;
    z[i] = dsm.data[j];
    built[i] = mask.data[j] > 0 ? 1 : 0;
    if ((x + y) % 5 === 0 && Number.isFinite(z[i])) all.push(z[i]);
  }
  all.sort((a, b) => a - b);
  const floor = all.length ? quantile(all, 0.08) : 0;
  for (let i = 0; i < N; i++) if (!Number.isFinite(z[i])) z[i] = floor;

  const seedRing = input.seed.map((p) => ({ x: p.x - x0, y: p.y - y0 }));
  const seed = fillRings([seedRing], w, h) as Uint8Array;
  // an eave can run half a metre past the mask; a canopy over the eave is looked at for a metre
  const near = spread(seed, w, h, Math.round(0.5 / px));
  const wide = spread(near, w, h, Math.round(0.5 / px));
  let seedPx = 0;
  for (let i = 0; i < N; i++) seedPx += seed[i];
  if (seedPx < 200) return null;

  // ── 1. the ground under the house ──
  // The lowest of every open metre round the building (nothing Google calls a building, nothing in the seed); a metre
  // under a tree is not the ground and is dropped; under the house the ground is carried in by distance.
  const B = Math.max(1, Math.round(1 / px));
  const bw = Math.ceil(w / B), bh = Math.ceil(h / B);
  const low = new Float32Array(bw * bh).fill(NaN);
  const buf: number[] = [];
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    buf.length = 0;
    for (let y = by * B; y < Math.min(h, by * B + B); y++) for (let x = bx * B; x < Math.min(w, bx * B + B); x++) {
      const i = y * w + x;
      if (!built[i] && !near[i]) buf.push(z[i]);
    }
    if (buf.length >= B * B * 0.2) { buf.sort((a, b) => a - b); low[by * bw + bx] = quantile(buf, 0.1); }
  }
  const open: Array<{ x: number; y: number; z: number }> = [];
  const R = 5;
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    const v = low[by * bw + bx];
    if (Number.isNaN(v)) continue;
    let m = v;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const nx = bx + dx, ny = by + dy;
      if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue;
      const u = low[ny * bw + nx];
      if (!Number.isNaN(u) && u < m) m = u;
    }
    if (v <= m + 1.2) open.push({ x: (bx + 0.5) * B, y: (by + 0.5) * B, z: v });
  }
  const G = Math.max(1, Math.round(0.5 / px));
  const gw = Math.ceil(w / G) + 1, gh = Math.ceil(h / G) + 1;
  const groundGrid = new Float32Array(gw * gh).fill(floor);
  if (open.length >= 4) {
    for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
      const X = gx * G, Y = gy * G;
      let sw = 0, sz = 0;
      for (const o of open) {
        const d2 = (o.x - X) ** 2 + (o.y - Y) ** 2 + 1;
        const wgt = 1 / (d2 * d2);
        sw += wgt;
        sz += wgt * o.z;
      }
      groundGrid[gy * gw + gx] = sz / sw;
    }
  }
  const groundAt = (x: number, y: number) => groundGrid[Math.round(y / G) * gw + Math.round(x / G)];

  // ── 2. as high as a roof ──
  // `cand` is where planes are looked for; `reach` adds the metre round it, which only takes the nearest plane's name
  const cand = new Uint8Array(N), reach = new Uint8Array(N), beyond = new Uint8Array(N);
  let lowPx = 0, candPx = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (!wide[i]) continue;
    if (z[i] - groundAt(x, y) >= MIN_ROOF_HEIGHT_M) {
      reach[i] = 1;
      if (near[i]) { cand[i] = 1; candPx++; } else beyond[i] = 1;
    } else if (seed[i]) lowPx++;
  }
  if (candPx < 200) return null;

  // ── 3. the planes ──
  const axesDeg = outlineAxesDeg(seedRing);
  const field = findPlanes({ w, h, z, inside: reach, ignore: beyond, pixelSizeM: px, axisDeg: axesDeg[0], axesDeg, priors: priorsInWindow(input.priors, x0, y0, px) });
  if (!field.planes.length) return null;
  const { planes, label } = field;
  const P = planes.length;
  const slope = planes.map((p) => Math.hypot(p.gx, p.gy) / px);
  const tol = slope.map((s) => ON_PLANE_M * Math.sqrt(1 + s * s));
  const miss = (i: number, q: number) => { const p = planes[q]; return z[i] - (p.gx * (i % w) + p.gy * ((i / w) | 0) + p.c); };
  const on = new Uint8Array(N);
  const count = new Array<number>(P).fill(0);
  const runs: number[][] = planes.map(() => []);
  const heights: number[][] = planes.map(() => []);
  for (let i = 0; i < N; i++) {
    const q = label[i];
    if (!cand[i] || q < 0) continue;
    if (Math.abs(miss(i, q)) > tol[q]) continue;
    on[i] = 1;
    count[q]++;
    if (count[q] % 3 === 0) {
      const p = planes[q], g = Math.hypot(p.gx, p.gy) || 1;
      runs[q].push(((i % w) * p.gx + ((i / w) | 0) * p.gy) / g);
      heights[q].push(z[i]);
    }
  }
  const m2 = (n: number) => n * px * px;
  const total = count.reduce((a, b) => a + b, 0);
  if (!total) return null;
  // the house's pitch: the slope half of the roof (by area) is flatter than
  const bySlope = planes.map((_, q) => q).filter((q) => m2(count[q]) >= 4).sort((a, b) => slope[a] - slope[b]);
  let housePitch = 0;
  {
    const sum = bySlope.reduce((a, q) => a + count[q], 0);
    let acc = 0;
    for (const q of bySlope) { acc += count[q]; if (acc >= sum / 2) { housePitch = slope[q]; break; } }
  }

  // ── 4. what is not roof ──
  const why = new Array<"" | "side" | "deck">(P).fill("");
  const runOf = (q: number) => { const r = [...runs[q]].sort((a, b) => a - b); return r.length ? (quantile(r, 0.95) - quantile(r, 0.05)) * px : 0; };
  for (let q = 0; q < P; q++) {
    // a wall, a hedge, the side of a tree: far steeper than the house and only a step across
    if (slope[q] > Math.max(1.7 * housePitch, housePitch + 0.33) && runOf(q) < 2.5 && count[q] < total * 0.12) why[q] = "side";
  }
  for (let q = 0; q < P; q++) {
    if (why[q] || slope[q] >= 0.11 || housePitch < 0.2 || count[q] > total * 0.3 || !heights[q].length) continue;
    // the roof within a metre and a half of it: how far above does it stand?
    const mine = new Uint8Array(N);
    for (let i = 0; i < N; i++) if (on[i] && label[i] === q) mine[i] = 1;
    const ringPx = spread(mine, w, h, Math.round(1.5 / px));
    const beside: number[] = [];
    for (let i = 0; i < N; i++) {
      const r = label[i];
      if (ringPx[i] && !mine[i] && on[i] && r !== q && r >= 0 && !why[r] && slope[r] >= 0.11) beside.push(z[i]);
    }
    if (beside.length < 12) continue;
    beside.sort((a, b) => a - b);
    const hs = [...heights[q]].sort((a, b) => a - b);
    if (quantile(beside, 0.2) - quantile(hs, 0.5) >= DECK_DROP_M) why[q] = "deck";
  }

  // ── 5. roof pixels ──
  // `hidden`: something stands above the roof's plane there (a tree, a chimney) — the roof may run on underneath.
  let roof = new Uint8Array(N);
  const hidden = new Uint8Array(N), kind = new Uint8Array(N), missed = new Uint8Array(N);
  let deckPx = 0, sidePx = 0, offPx = 0;
  for (let i = 0; i < N; i++) {
    if (!reach[i]) { if (seed[i]) kind[i] = 3; continue; }
    const q = label[i];
    if (q < 0) { if (seed[i]) { offPx++; kind[i] = 6; } continue; }
    if (why[q]) { if (seed[i]) { if (why[q] === "deck") { deckPx++; kind[i] = 4; } else { sidePx++; kind[i] = 5; } } continue; }
    const d = miss(i, q);
    if (d > tol[q]) { hidden[i] = 1; kind[i] = 2; }
    if (!cand[i]) continue;
    if (Math.abs(d) <= tol[q]) { roof[i] = 1; kind[i] = 1; continue; }
    if (!built[i]) continue;
    if (d > 0) { roof[i] = 1; continue; }
    // below its plane: a low roof the planes missed when it lies gently, the wall past the edge when it falls away
    const x = i % w, y = (i / w) | 0;
    const fall = x >= 2 && y >= 2 && x < w - 2 && y < h - 2 ? Math.hypot(z[i + 2] - z[i - 2], z[i + 2 * w] - z[i - 2 * w]) / (4 * px) : Infinity;
    if (fall <= WALL_SLOPE) missed[i] = 1;
    else if (seed[i]) { offPx++; kind[i] = 6; }
  }
  // …and only where it is a piece of roof in its own right, a metre and a half across: a narrow strip of it is the
  // foot of a wall, the shrubs beside it
  {
    const r7 = Math.max(1, Math.round(0.75 / px));
    const wideEnough = spread(shrink(missed, w, h, r7), w, h, r7);
    for (let i = 0; i < N; i++) {
      if (!missed[i]) continue;
      if (wideEnough[i]) roof[i] = 1;
      else if (seed[i]) { offPx++; kind[i] = 6; }
    }
  }
  if (input.inspect) {
    const ground = new Float32Array(N);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) ground[y * w + x] = z[y * w + x] - groundAt(x, y);
    input.inspect({ x0, y0, w, h, kind, ground });
  }
  // the last pixel of an eave rolls off in the height map: where Google calls it building, it is the roof's
  {
    const edge = spread(roof, w, h, 1);
    for (let i = 0; i < N; i++) if (edge[i] && !roof[i] && built[i] && cand[i] && label[i] >= 0 && !why[label[i]]) roof[i] = 1;
  }
  // ── 6. clean, turn to the building's directions, trace, square ──
  const r3 = Math.max(1, Math.round(0.3 / px)), r4 = Math.max(1, Math.round(0.4 / px));
  roof = fillHoles(shrink(spread(roof, w, h, r3), w, h, r3), w, h);
  roof = largestPiece(spread(shrink(roof, w, h, r4), w, h, r4), w, h);
  let roofPx = 0;
  for (let i = 0; i < N; i++) roofPx += roof[i];
  if (roofPx < seedPx * 0.3 || m2(roofPx) < 9) return null;

  // The building's direction: the way its pitched planes face, folded onto a quarter turn (a flat roof has only its
  // walls to go by). That is good to a degree or so, and a degree tilts every wall, so the squaring is also tried at
  // half-degree turns either side, and a turn whose outline fits what was SEEN clearly better — less roof left
  // outside it, less not-roof taken inside it — takes its place.
  let baseDeg: number, span: number;
  {
    let sx = 0, sy = 0, pitched = 0;
    for (let q = 0; q < P; q++) {
      if (why[q] || slope[q] < 0.08) continue;
      const a4 = Math.atan2(planes[q].gy, planes[q].gx) * 4;
      sx += Math.cos(a4) * count[q];
      sy += Math.sin(a4) * count[q];
      pitched += count[q];
    }
    const fromPlanes = pitched >= total * 0.25;
    baseDeg = fromPlanes ? (Math.atan2(sy, sx) / 4) * (180 / Math.PI) : axesDeg[0];
    baseDeg = ((baseDeg % 90) + 90) % 90;
    if (baseDeg > 45) baseDeg -= 90;
    span = fromPlanes ? 2 : 5;
  }
  const squareAt = (deg: number): { ring: Pt[]; misfit: number } | null => {
    const turnRad = (deg * Math.PI) / 180, cos = Math.cos(turnRad), sin = Math.sin(turnRad);
    // the turned picture: u = x·cos + y·sin, v = −x·sin + y·cos
    let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
    for (const [x, y] of [[0, 0], [w, 0], [0, h], [w, h]]) {
      const u = x * cos + y * sin, v = -x * sin + y * cos;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    u0 = Math.floor(u0); v0 = Math.floor(v0);
    const tw = Math.ceil(u1) - u0, th = Math.ceil(v1) - v0;
    // The shape to trace (roof, and what Google calls building under a tree), and what the squaring weighs: the roof
    // that was SEEN on its plane, what was seen not to be roof, and what a tree hides — under it where Google calls it
    // building, beside the building where it does not.
    let tRoof = new Uint8Array(tw * th);
    const tSeen = new Uint8Array(tw * th), tNot = new Uint8Array(tw * th), tUnder = new Uint8Array(tw * th), tBeside = new Uint8Array(tw * th), tOpen = new Uint8Array(tw * th);
    for (let r = 0; r < th; r++) for (let c = 0; c < tw; c++) {
      const k = r * tw + c, u = u0 + c + 0.5, v = v0 + r + 0.5;
      const x = Math.floor(u * cos - v * sin), y = Math.floor(u * sin + v * cos);
      if (x < 0 || y < 0 || x >= w || y >= h) { tNot[k] = 1; tOpen[k] = 1; continue; }
      const i = y * w + x;
      if (roof[i]) tRoof[k] = 1;
      // open ground: lower than a roof, or further from Google's building than an eave reaches
      if (!reach[i]) tOpen[k] = 1;
      if (hidden[i]) { if (built[i]) tUnder[k] = 1; else tBeside[k] = 1; }
      else if (roof[i]) tSeen[k] = 1;
      else tNot[k] = 1;
    }
    tRoof = largestPiece(fillHoles(shrink(spread(tRoof, tw, th, 1), tw, th, 1), tw, th), tw, th);
    const loop = traceLoop(tRoof, tw, th);
    if (!loop) return null;
    const sq = squareLoop(loop, tSeen, tNot, tUnder, tBeside, tOpen, tw, th, {
      yard: Math.max(3, Math.round(0.8 / px)), hard: Math.max(2, Math.round(0.55 / px)), jog: Math.max(3, Math.round(0.9 / px)),
      wall: Math.round(3 / px), soft: Math.max(4, Math.round(1.2 / px)), notch: 3 / (px * px),
    });
    if (sq.length < 4) return null;
    const filled = fillRings([sq], tw, th) as Uint8Array;
    let misfit = 0;
    for (let k = 0; k < filled.length; k++) misfit += filled[k] ? tNot[k] : tSeen[k];
    const out = sq.map((p) => { const u = u0 + p.x, v = v0 + p.y; return { x: u * cos - v * sin + x0, y: u * sin + v * cos + y0 }; });
    if (Math.abs(ringArea(out)) < roofPx * 0.6) return null;
    return { ring: out, misfit };
  };
  let ring: Pt[] | null = null;
  {
    // The planes' own turn stands unless another fits clearly better (a tenth less misfit, and half a square metre):
    // between turns that fit alike the difference is the trees', not the walls'.
    const own = squareAt(baseDeg);
    let best = own ? own.misfit : Infinity;
    ring = own ? own.ring : null;
    const bar = own ? Math.min(own.misfit * 0.9, own.misfit - 0.5 / (px * px)) : Infinity;
    for (let k = 1; k <= span * 2; k++) for (const sign of [1, -1]) {
      const got = squareAt(baseDeg + (sign * k) / 2);
      if (got && got.misfit < best && got.misfit < bar) { best = got.misfit; ring = got.ring; }
    }
  }
  if (!ring) {
    // the squaring above gave nothing usable: the pass that squares every other outline here
    const as = new Float32Array(N);
    for (let i = 0; i < N; i++) as[i] = roof[i];
    const stepFt = px * 3.28084;
    const found = buildStructureFootprints({ width: w, height: h, data: as, pixelSizeM: px, originX: 0, originY: 0, epsg: null }, { rawFallback: true, maxVertices: 28 })
      .structures.filter((st) => st.ring && st.ring.length >= 3)
      .sort((a, b) => b.maskAreaSqft - a.maskAreaSqft)[0];
    if (!found?.ring) return null;
    ring = found.ring.map((p) => ({ x: p.x / stepFt + w / 2 + x0, y: h / 2 - p.y / stepFt + y0 }));
  }
  if (Math.abs(ringArea(ring)) < seedPx * 0.3) return null;

  const sqft = (n: number) => Math.round(m2(n) * 10.7639);
  const t = input.trace;
  if (t) {
    if (m2(lowPx) >= 2) t.push(`${sqft(lowPx)} sq ft inside Google's building outline stands lower than 5 ft above the ground (a driveway, a patio, a low deck) and is left out`);
    if (m2(deckPx) >= 2) t.push(`${sqft(deckPx)} sq ft of flat surface well below the roof beside it (a deck, a storey under the eave) is left out — look at the photo if that is a flat roof`);
    if (m2(sidePx) >= 2) t.push(`${sqft(sidePx)} sq ft beside the walls (a wall or a hedge seen from above, not a roof) is left out`);
    if (m2(offPx) >= 4) t.push(`${sqft(offPx)} sq ft inside Google's building outline falls away below the roof's planes (the wall past the roof's edge) and is left out`);
  }
  return { ring, seedM2: m2(seedPx), roofM2: m2(roofPx), leftOut: { ground: m2(lowPx), deck: m2(deckPx), side: m2(sidePx), offPlane: m2(offPx) } };
}
