// ROOF FACETS — THE LINES SET ON THE PHOTOGRAPH (2026-11-13, owner, of two drawings over the aerial photo: "it's not
// right, it's offset — not straight, not following the roof").
//
// The engine reads the roof off Google's height map, and the height map is soft: a roof edge falls over two or three
// pixels, a low curb round a flat roof is a bump half a metre wide, and a line read off it lands a foot or two from
// where the photograph shows the edge (measured on three roofs: no single shift between Google's photo and its height
// map — each line is off by its own amount, the outside walls 0.2 to 0.3 m outward, a curb line up to 0.8 m).
//
// So, once the drawing is made, every straight line of it is slid square to itself onto the edge the photograph
// shows nearest to it — if the photograph shows one:
//   · a line is a run of the drawing's edges that continue each other straight (one wall cut by a valley's end is
//     one line, and moves as one);
//   · the photograph's brightness is read across the line at every pixel of its length; an edge is where the change
//     of brightness is the same way all along (shingle texture and stains cancel out), and it has to stand well clear
//     of the rest of what was read, or the line stays where the height map put it;
//   · an outside wall is only moved to where the height map still shows the roof's edge (a shadow on the lawn is an
//     edge too — it is not the eave);
//   · a corner then goes to where its moved lines meet. Nothing is turned: lines stay parallel to what they were.
// Areas and lengths are measured again from the moved corners.
//
// Pure: numbers in, numbers out. Units are the engine's raster pixels.

import type { EngineRaster, EngineResult } from "./engine";
import type { Pt } from "./raster";

export interface SnapPhoto {
  width: number;
  height: number;
  /** RGB, three bytes a pixel, rows from the top */
  data: Uint8Array | Uint8ClampedArray | Buffer;
  /** where an engine point (raster pixels, continuous) falls in the photograph (its pixels, continuous) */
  toPhoto: (p: Pt) => Pt;
  /** photograph pixels per engine pixel (1 when both are on one grid) */
  scale: number;
}

export interface SnapReport {
  /** straight lines of the drawing long enough to look at / of them moved */
  lines: number;
  moved: number;
  /** the largest and the mean move of a moved line, engine pixels */
  maxPx: number;
  meanPx: number;
}

/** How far a line may be slid, metres: an outside wall, a line inside the roof. */
const REACH_OUT_M = 0.6, REACH_IN_M = 0.85;
/** A line shorter than this (what can be read of it) is left alone, metres. */
const MIN_READ_M = 1.6;
/** Brightness (0..255) a pixel across an edge, the least that counts as one. */
const MIN_CONTRAST = 3.2;

export function snapToPhoto(result: EngineResult, photo: SnapPhoto, dsm: EngineRaster): SnapReport {
  const px = dsm.pixelSizeM;
  const V = result.vertices, E = result.edges;
  const report: SnapReport = { lines: 0, moved: 0, maxPx: 0, meanPx: 0 };
  if (!V.length || !E.length) return report;

  // ── the photograph's brightness round the drawing, lightly blurred ──
  const pv = V.map((p) => photo.toPhoto(p));
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (const p of pv) { bx0 = Math.min(bx0, p.x); by0 = Math.min(by0, p.y); bx1 = Math.max(bx1, p.x); by1 = Math.max(by1, p.y); }
  const M = Math.ceil(14 * photo.scale) + 3;
  const gx0 = Math.max(0, Math.floor(bx0) - M), gy0 = Math.max(0, Math.floor(by0) - M);
  const gx1 = Math.min(photo.width, Math.ceil(bx1) + M), gy1 = Math.min(photo.height, Math.ceil(by1) + M);
  const gw = gx1 - gx0, gh = gy1 - gy0;
  if (gw < 16 || gh < 16) return report;
  const raw = new Float32Array(gw * gh);
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    const i = ((y + gy0) * photo.width + x + gx0) * 3;
    raw[y * gw + x] = 0.299 * photo.data[i] + 0.587 * photo.data[i + 1] + 0.114 * photo.data[i + 2];
  }
  // blurred as far as one raster pixel reaches: once for a photograph on the height map's own grid, twice for one
  // twice as sharp (EagleView's) — on that one the courses of the tiles show, row after row parallel to the eave, and
  // unblurred each of them is an "edge the same way all along" that a line could be set on
  let gray = raw;
  for (let pass = 0; pass < Math.max(1, Math.round(photo.scale)); pass++) {
    const src = gray, out = new Float32Array(gw * gh);
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= gw || yy >= gh) continue;
        const wgt = dx === 0 && dy === 0 ? 4 : dx === 0 || dy === 0 ? 2 : 1;
        s += wgt * src[yy * gw + xx]; n += wgt;
      }
      out[y * gw + x] = s / n;
    }
    gray = out;
  }
  /** brightness at a photograph point (continuous: a pixel's centre is its index + 0.5); NaN off the picture */
  const G = (x: number, y: number): number => {
    const fx = x - gx0 - 0.5, fy = y - gy0 - 0.5;
    const ix = Math.floor(fx), iy = Math.floor(fy);
    if (ix < 0 || iy < 0 || ix >= gw - 1 || iy >= gh - 1) return NaN;
    const ax = fx - ix, ay = fy - iy, i = iy * gw + ix;
    return gray[i] * (1 - ax) * (1 - ay) + gray[i + 1] * ax * (1 - ay) + gray[i + gw] * (1 - ax) * ay + gray[i + gw + 1] * ax * ay;
  };
  const Z = (x: number, y: number): number => {
    const ix = Math.min(dsm.width - 1, Math.max(0, Math.floor(x))), iy = Math.min(dsm.height - 1, Math.max(0, Math.floor(y)));
    return dsm.data[iy * dsm.width + ix];
  };

  // ── lines: edges that run on straight from one another, outside walls and inside lines apart ──
  const isOut = (e: (typeof E)[number]) => e.left < 0 || e.right < 0;
  const dirOf = (e: (typeof E)[number]) => { const a = V[e.a], b = V[e.b]; const L = Math.hypot(b.x - a.x, b.y - a.y) || 1e-9; return { x: (b.x - a.x) / L, y: (b.y - a.y) / L, L }; };
  const D = E.map(dirOf);
  const parent = E.map((_, i) => i);
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const at: number[][] = V.map(() => []);
  E.forEach((e, i) => { at[e.a].push(i); at[e.b].push(i); });
  const STRAIGHT = Math.cos((177 * Math.PI) / 180);
  at.forEach((list, v) => {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const p = list[i], q = list[j];
      if (isOut(E[p]) !== isOut(E[q])) continue;
      const sp = E[p].a === v ? 1 : -1, sq = E[q].a === v ? 1 : -1;
      if (sp * sq * (D[p].x * D[q].x + D[p].y * D[q].y) <= STRAIGHT) parent[find(p)] = find(q);
    }
  });
  const groups = new Map<number, number[]>();
  E.forEach((_, i) => { const r = find(i); (groups.get(r) ?? groups.set(r, []).get(r)!).push(i); });

  // ── each line: what the photograph shows across it ──
  /** per edge: the line's normal (unit, engine pixels), and how far along it the line goes; null = stays */
  const want: Array<{ n: Pt; d: number } | null> = E.map(() => null);
  let sum = 0;
  for (const members of groups.values()) {
    const lead = members.reduce((a, b) => (D[b].L > D[a].L ? b : a));
    const out = isOut(E[lead]);
    // the normal: for an outside wall it points OUT of the roof
    let n = { x: -D[lead].y, y: D[lead].x };
    if (out && E[lead].left >= 0) n = { x: -n.x, y: -n.y };
    // points to read at: every pixel of the line, its ends left out
    const pts: Pt[] = [];
    for (const ei of members) {
      const a = V[E[ei].a], d = D[ei];
      const skip = Math.min(d.L / 3, 0.3 / px);
      for (let s = skip; s <= d.L - skip; s += 1) pts.push({ x: a.x + d.x * s, y: a.y + d.y * s });
    }
    if (pts.length * px < MIN_READ_M) continue;
    report.lines++;
    const reach = (out ? REACH_OUT_M : REACH_IN_M) / px;
    // an outside wall may only go where the height map still shows the roof's edge
    let lo = -reach, hi = reach;
    if (out) {
      const h = (t: number) => { const zs = pts.map((p) => Z(p.x + n.x * t, p.y + n.y * t)).filter(Number.isFinite).sort((p, q) => p - q); return zs.length ? zs[zs.length >> 1] : NaN; };
      const far = 1.2 / px;
      const zin = h(-far), zout = Math.min(h(far), h(far * 0.6));
      if (Number.isFinite(zin) && Number.isFinite(zout) && zin - zout > 1.2) {
        const half = (zin + zout) / 2;
        let wall = NaN;
        for (let t = -far; t <= far; t += 0.5) if (h(t) < half) { wall = t; break; }
        // The height map reads a roof's edge fat (0.2 to 0.3 m on the roofs measured): the real edge lies a little
        // INSIDE where the height falls, never outside it — and just outside is where the eave's shadow lies on the
        // ground, an edge as plain as the gutter's (seen on EagleView's sharper picture: a wall set on its shadow).
        // (0.7 m inside on one wall of the first roof seen sharply: an eave with a wide gutter over a patio.)
        if (Number.isFinite(wall)) { lo = Math.max(lo, wall - 0.9 / px); hi = Math.min(hi, wall - 0.15 / px); }
      } else {
        // no drop to read here (a tree over the edge, a lower roof beside it): only a small move is trusted
        lo = Math.max(lo, -0.3 / px); hi = Math.min(hi, 0.3 / px);
      }
      if (hi <= lo) continue;
    }
    // the profile: the change of brightness across the line, the same way all along
    const step = 0.5;
    const prof: Array<{ t: number; v: number }> = [];
    const pp = pts.map((p) => photo.toPhoto(p));
    const nn = { x: n.x * photo.scale, y: n.y * photo.scale }; // one engine pixel along the normal, in the photograph
    for (let t = -reach - 1; t <= reach + 1 + 1e-9; t += step) {
      let s = 0, k = 0;
      for (const p of pp) {
        const a = G(p.x + nn.x * (t + 1), p.y + nn.y * (t + 1)), b = G(p.x + nn.x * (t - 1), p.y + nn.y * (t - 1));
        if (Number.isNaN(a) || Number.isNaN(b)) continue;
        s += (a - b) / 2; k++;
      }
      prof.push({ t, v: k >= pts.length * 0.7 ? Math.abs(s / k) : 0 });
    }
    const mean = prof.reduce((a, b) => a + b.v, 0) / prof.length;
    let best = -1, bs = 0;
    prof.forEach((p, i) => {
      if (p.t < lo || p.t > hi) return;
      if (i > 0 && i < prof.length - 1 && (p.v < prof[i - 1].v || p.v < prof[i + 1].v)) return; // a peak only
      const sc = p.v * Math.exp(-((p.t / (reach * 0.9)) ** 2));
      if (sc > bs) { bs = sc; best = i; }
    });
    if (best < 1 || best >= prof.length - 1) continue;
    const pk = prof[best];
    if (pk.v < MIN_CONTRAST || pk.v < 1.7 * mean) continue;
    // sub-pixel: the top of a parabola through the peak and its neighbours
    const a = prof[best - 1].v, b = pk.v, c = prof[best + 1].v, den = a - 2 * b + c;
    const d = Math.max(lo, Math.min(hi, pk.t + (den < 0 ? (0.5 * (a - c) * step) / den : 0)));
    for (const ei of members) want[ei] = { n, d };
    if (Math.abs(d) >= 0.5) { report.moved++; sum += Math.abs(d); report.maxPx = Math.max(report.maxPx, Math.abs(d)); }
  }
  if (!report.moved) return report;
  report.meanPx = sum / report.moved;

  // ── corners: to where their moved lines meet ──
  const moved: Pt[] = V.map((p, v) => {
    let a11 = 0.02, a12 = 0, a22 = 0.02, b1 = 0, b2 = 0, any = false;
    for (const ei of at[v]) {
      const wnt = want[ei];
      const n = wnt ? wnt.n : { x: -D[ei].y, y: D[ei].x };
      // an outside wall's own line counts the most: a roof corner sits where its two walls meet, and the hip that
      // ends there follows it
      const d = wnt ? wnt.d : 0, wgt = wnt ? (isOut(E[ei]) ? 6 : 1) : 0.2;
      if (wnt && Math.abs(wnt.d) > 1e-6) any = true;
      a11 += wgt * n.x * n.x; a12 += wgt * n.x * n.y; a22 += wgt * n.y * n.y;
      b1 += wgt * d * n.x; b2 += wgt * d * n.y;
    }
    if (!any) return p;
    const det = a11 * a22 - a12 * a12;
    if (Math.abs(det) < 1e-9) return p;
    let dx = (b1 * a22 - b2 * a12) / det, dy = (a11 * b2 - a12 * b1) / det;
    const len = Math.hypot(dx, dy), cap = 1.1 / px;
    if (len > cap) { dx *= cap / len; dy *= cap / len; }
    return { x: p.x + dx, y: p.y + dy };
  });
  // a move that would flip or flatten a facet is not made (the corners of that facet stay)
  const areaOf = (ring: number[], P: Pt[]) => { let s = 0; for (let i = 0; i < ring.length; i++) { const a = P[ring[i]], b = P[ring[(i + 1) % ring.length]]; s += a.x * b.y - b.x * a.y; } return s / 2; };
  const frozen = new Set<number>();
  for (const f of result.facets) {
    const before = areaOf(f.outer, V), after = areaOf(f.outer, moved);
    if (before === 0 || after / before < 0.6 || after / before > 1.6) for (const v of f.outer) frozen.add(v);
  }
  for (let v = 0; v < V.length; v++) if (!frozen.has(v)) V[v] = moved[v];

  // ── measure again ──
  for (const f of result.facets) {
    const plan = (Math.abs(areaOf(f.outer, V)) - f.holes.reduce((s, hole) => s + Math.abs(areaOf(hole, V)), 0)) * px * px;
    f.planM2 = plan;
    f.areaM2 = plan * Math.sqrt(1 + f.slope * f.slope);
  }
  for (const e of E) {
    const planM = Math.hypot(V[e.b].x - V[e.a].x, V[e.b].y - V[e.a].y) * px;
    const k = e.planM > 1e-6 ? e.lengthM / e.planM : 1;
    e.planM = planM;
    e.lengthM = planM * k;
  }
  return report;
}
