// ROOF FACETS — THE ENGINE (2026-11-11, owner: "show all facets, ridges, like the other companies' pictures; admin
// side only, for testing"). From what a saved roof measurement already holds — Google's height map and roof segments
// (SolarCache) and EagleView's roof outline (the Instant row) — to a drawing of the roof's facets: clean polygons that
// share their edges, every edge named (eave, rake, ridge, hip, valley, step or wall flashing, pitch change) and measured.
//
// EagleView's instant data carries the outline, the area, the pitch and a facet COUNT, never the facets themselves
// (those come only in its ordered reports), so the facets are read off the height map:
//
//   1. window     the part of the raster round the outline
//   2. register   EagleView's outline is slid onto Google's building (the two are a few feet apart on most houses)
//   3. planes     ./planes — the flat roof planes inside the outline, led by Google's own segments
//   4. lines      where two neighbouring planes cross is a straight line known exactly from the two planes (a ridge,
//                 hip or valley); where they do not meet in height (a wall between two roof levels) a line is fitted
//                 to the boundary instead
//   5. arrange    ./arrange — the outline's edges and those lines are cut into cells; a cell belongs to the plane
//                 most of its pixels sit on; cells of one plane fuse into a facet. Watertight by construction.
//   6. name       each edge by what the two planes do across it, and its true (sloped) length
//
// Pure: rasters and numbers in, numbers out. Units inside are raster pixels (x east, y SOUTH, a pixel covers
// [c, c+1)) and metres of height; ./build turns the result into feet, compass bearings and lat/lng.

import { buildGraph, collapseShort, pruneDangling, straightenChains, traceFaces, type Face, type Graph, type Seg } from "./arrange";
import { findPlanes, outlineAxesDeg, type Plane, type PlanePrior } from "./planes";
import { fillRings, pointInRing, registerOutline, ringArea, sharpenCorners, type Pt } from "./raster";

/**
 * What an edge is. STEP and WALL are both a roof meeting a wall between two roof levels: STEP where the line climbs
 * the lower roof (the roof runs up alongside a side wall — step flashing), WALL where it runs level (the roof ends
 * against a wall above it — wall, or headwall, flashing). BREAK is a change of pitch within one facing.
 */
export type FacetEdgeType = "EAVE" | "RAKE" | "RIDGE" | "HIP" | "VALLEY" | "STEP" | "WALL" | "BREAK";

export interface EngineRaster {
  width: number;
  height: number;
  data: Float32Array;
  pixelSizeM: number;
}

export interface EngineInput {
  dsm: EngineRaster;
  /** Google's building mask on the same grid, when there is one */
  mask: { width: number; height: number; data: Float32Array } | null;
  /** the roof outline in raster pixels, as its source placed it */
  outline: ReadonlyArray<Pt>;
  /** Google's roof segments, centres in raster pixels */
  priors: ReadonlyArray<{ pitchDeg: number; azimuthDeg: number; cx: number; cy: number; zc: number; areaM2: number }>;
  /** false when the outline already comes from this raster (Google's own mask): it is not moved */
  register?: boolean;
  trace?: string[];
}

export interface EngineFacet {
  outer: number[];
  holes: number[][];
  /** z = gx*x + gy*y + c over raster pixels (continuous), metres */
  plane: { gx: number; gy: number; c: number };
  /** rise per run */
  slope: number;
  /** compass bearing the facet faces (the way water runs), degrees clockwise from north; null when flat */
  azimuthDeg: number | null;
  planM2: number;
  areaM2: number;
  /** true when one of Google's segments stands behind the plane */
  google: boolean;
}

export interface EngineEdge {
  a: number;
  b: number;
  type: FacetEdgeType;
  /** length on the map and along the roof, metres */
  planM: number;
  lengthM: number;
  /** facet indices either side; -1 is the outside */
  left: number;
  right: number;
}

export interface EngineResult {
  /** how far the outline was moved to sit on the height map, raster pixels */
  shift: { dx: number; dy: number };
  /** raster pixels, continuous */
  vertices: Pt[];
  facets: EngineFacet[];
  edges: EngineEdge[];
  quality: {
    /** share of the roof's pixels whose height sits (within 0.25 m) on the plane of the facet drawn over them (0..1) */
    agree: number;
    /** root-mean-square miss of the height map from the drawn facets, square to the roof, metres */
    rmsM: number;
    /** planes the height map gave / of them from Google's segments */
    planes: number;
    googlePlanes: number;
    googleSegments: number;
    /** plan area of the outline, square metres */
    outlineM2: number;
    /** share of the outline's inside where the height map shows a building at all (Google's mask, and well above the ground) */
    buildingShare: number;
  };
}

const MAX_SHIFT_M = 5;

export function buildFacets(input: EngineInput): EngineResult | null {
  const { dsm } = input;
  const px = dsm.pixelSizeM;
  let ring0 = [...input.outline];
  if (ring0.length > 3 && Math.hypot(ring0[0].x - ring0[ring0.length - 1].x, ring0[0].y - ring0[ring0.length - 1].y) < 0.5) ring0.pop();
  if (ring0.length < 3) return null;
  // a corner the tracing clipped with a stub under 0.9 m is squared off (two walls of 2 m or more run on to meet)
  ring0 = sharpenCorners(ring0, 0.9 / px, 2 / px);

  // ── 1. window ──
  const maxShift = input.register === false ? 0 : Math.round(MAX_SHIFT_M / px);
  const PAD = maxShift + 12;
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (const p of ring0) { bx0 = Math.min(bx0, p.x); by0 = Math.min(by0, p.y); bx1 = Math.max(bx1, p.x); by1 = Math.max(by1, p.y); }
  const x0 = Math.max(0, Math.floor(bx0 - PAD)), y0 = Math.max(0, Math.floor(by0 - PAD));
  const x1 = Math.min(dsm.width, Math.ceil(bx1 + PAD)), y1 = Math.min(dsm.height, Math.ceil(by1 + PAD));
  const w = x1 - x0, h = y1 - y0;
  if (w < 8 || h < 8) return null;
  const z = new Float32Array(w * h);
  const sample: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = dsm.data[(y + y0) * dsm.width + x + x0];
    z[y * w + x] = v;
    if ((x + y) % 7 === 0 && Number.isFinite(v)) sample.push(v);
  }
  sample.sort((a, b) => a - b);
  const ground = sample[Math.floor(sample.length * 0.08)] ?? 0;
  for (let i = 0; i < z.length; i++) if (!Number.isFinite(z[i])) z[i] = ground;

  // ── 2. register ──
  let ring = ring0.map((p) => ({ x: p.x - x0, y: p.y - y0 }));
  let shift = { dx: 0, dy: 0 };
  const building = new Uint8Array(w * h);
  {
    const mask = input.mask;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const on = mask ? mask.data[(y + y0) * mask.width + x + x0] > 0 : true;
      building[y * w + x] = on && z[y * w + x] > ground + 1.8 ? 1 : 0;
    }
  }
  if (maxShift > 0) {
    const reg = registerOutline(ring, building, w, h, maxShift);
    shift = { dx: reg.dx, dy: reg.dy };
    ring = ring.map((p) => ({ x: p.x + reg.dx, y: p.y + reg.dy }));
    input.trace?.push(`outline moved ${(reg.dx * px).toFixed(1)} m east, ${(-reg.dy * px).toFixed(1)} m north to sit on the height map`);
  }
  if (ringArea(ring) < 0) ring.reverse();
  const inside = fillRings([ring], w, h) as Uint8Array;
  let roofPx = 0, builtPx = 0;
  for (let i = 0; i < inside.length; i++) if (inside[i]) { roofPx++; builtPx += building[i]; }
  if (roofPx < 200) return null;
  const buildingShare = builtPx / roofPx;

  // ── 3. planes ──
  const axesDeg = outlineAxesDeg(ring);
  const axisDeg = axesDeg[0];
  if (axesDeg.length > 1) input.trace?.push(`the building runs in ${axesDeg.length} directions (${axesDeg.map((d) => Math.round(d)).join(" and ")} degrees off the grid)`);
  const priors: PlanePrior[] = input.priors.map((s) => {
    const t = Math.tan((s.pitchDeg * Math.PI) / 180) * px, az = (s.azimuthDeg * Math.PI) / 180;
    // the plane RISES opposite to the way it faces; y runs south
    return { gx: -t * Math.sin(az), gy: t * Math.cos(az), cx: s.cx - x0 - 0.5, cy: s.cy - y0 - 0.5, zc: s.zc, areaM2: s.areaM2 };
  });
  // What Google's own mask does not call roof inside the outline — a tree over it, mostly — is kept out of the plane
  // finding. Only while it is a modest part: a mask that misses a third of the building is the mask's mistake.
  let ignore: Uint8Array | undefined;
  if (input.mask) {
    const m = input.mask, off = new Uint8Array(w * h);
    let n = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (inside[i] && !(m.data[(y + y0) * m.width + x + x0] > 0)) { off[i] = 1; n++; }
    }
    if (n > roofPx * 0.02 && n < roofPx * 0.35) {
      ignore = off;
      input.trace?.push(`${Math.round((n / roofPx) * 100)}% of the outline is not roof in Google's mask (trees over it, mostly): the planes run on under it`);
    }
  }
  const field = findPlanes({ w, h, z, inside, ignore, pixelSizeM: px, axisDeg, axesDeg, priors, trace: input.trace });
  if (!field.planes.length) return null;
  // planes over CONTINUOUS window pixels (a pixel's centre is its index + 0.5)
  const planes = field.planes.map((p) => ({ ...p, c: p.c - 0.5 * (p.gx + p.gy) }));
  const label = field.label;

  // ── 4. lines ──
  const { segs: lines, seams } = linesBetween(planes, label, z, w, h, px, axesDeg, input.trace);

  // ── 5. arrange ──
  const outlineSegs: Seg[] = ring.map((p, i) => ({ a: p, b: ring[(i + 1) % ring.length], outline: true, tag: -1 }));
  const TOL = 1.2;
  const build = (extra: Seg[]): Graph => {
    const g = buildGraph([...outlineSegs, ...lines, ...extra], TOL);
    // only what lies inside the outline matters
    const edges = g.edges.filter((e) => e.outline || pointInRing({ x: (g.verts[e.a].x + g.verts[e.b].x) / 2, y: (g.verts[e.a].y + g.verts[e.b].y) / 2 }, ring));
    return pruneDangling({ verts: g.verts, edges });
  };
  const cellId = new Int32Array(w * h);
  const labelFaces = (g: Graph, faces: Face[]): { lab: number[]; hist: Array<Map<number, number>> } => {
    cellId.fill(0);
    faces.forEach((f, k) => fillRings([f.outer, ...f.holes].map((r) => r.map((v) => g.verts[v])), w, h, k + 1, cellId));
    const hist = faces.map(() => new Map<number, number>());
    for (let i = 0; i < cellId.length; i++) {
      const c = cellId[i];
      if (!c || !inside[i] || label[i] < 0) continue;
      const m = hist[c - 1];
      m.set(label[i], (m.get(label[i]) ?? 0) + 1);
    }
    const lab = hist.map((m) => { let best = -1, bn = 0; for (const [q, n] of m) if (n > bn) { best = q; bn = n; } return best; });
    return { lab, hist };
  };
  let extra: Seg[] = [];
  let g = build(extra);
  let tf = traceFaces(g);
  let { lab, hist } = labelFaces(g, tf.faces);
  // A cell that holds a good piece of a second plane is missing a line: fit one to the boundary inside it and cut again.
  for (let round = 0; round < 2; round++) {
    const add: Seg[] = [];
    tf.faces.forEach((f, k) => {
      const m = hist[k];
      const total = [...m.values()].reduce((a, b) => a + b, 0);
      for (const [q, n] of m) {
        if (q === lab[k] || n * px * px < 1.2 || n < total * 0.12) continue;
        const pts: Pt[] = [];
        for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) {
          const i = y * w + x;
          if (cellId[i] !== k + 1) continue;
          const a = label[i];
          if (a !== q && a !== lab[k]) continue;
          const r = label[i + 1], d = label[i + w];
          if ((r === q || r === lab[k]) && r !== a && cellId[i + 1] === k + 1) pts.push({ x: x + 1, y: y + 0.5 });
          if ((d === q || d === lab[k]) && d !== a && cellId[i + w] === k + 1) pts.push({ x: x + 0.5, y: y + 1 });
        }
        for (const s of fitLines(pts, axesDeg, 12)) add.push({ ...s, outline: false, tag: -3 });
      }
    });
    if (!add.length) break;
    input.trace?.push(`${add.length} boundary line(s) were missing and were fitted from the planes' own boundary`);
    extra = [...extra, ...add];
    g = build(extra);
    tf = traceFaces(g);
    ({ lab, hist } = labelFaces(g, tf.faces));
  }
  // Fuse: a tiny or empty cell takes the plane of the neighbour it shares the most edge with; then every edge with
  // one plane on both sides goes.
  const MIN_CELL_PX = 0.5 / (px * px), MIN_FACET_PX = 1.0 / (px * px);
  const fuse = (minPx: number) => {
    const sizes = tf.faces.map((f) => f.area);
    const order = tf.faces.map((_, k) => k).filter((k) => lab[k] === -1 || sizes[k] < minPx).sort((a, b) => sizes[a] - sizes[b]);
    for (const k of order) {
      const share = new Map<number, number>();
      g.edges.forEach((e, ei) => {
        if (e.outline) return;
        const L = tf.faceOf[2 * ei], R = tf.faceOf[2 * ei + 1];
        const other = L === k ? R : R === k ? L : -2;
        if (other < 0 || other === k || lab[other] === -1) return;
        const len = Math.hypot(g.verts[e.a].x - g.verts[e.b].x, g.verts[e.a].y - g.verts[e.b].y);
        share.set(lab[other], (share.get(lab[other]) ?? 0) + len);
      });
      let best = -1, bl = 0;
      for (const [q, len] of share) if (len > bl) { best = q; bl = len; }
      if (best !== -1) lab[k] = best;
    }
    const kept = g.edges.filter((e, ei) => e.outline || lab[tf.faceOf[2 * ei]] !== lab[tf.faceOf[2 * ei + 1]] || tf.faceOf[2 * ei] === -1 || tf.faceOf[2 * ei + 1] === -1);
    g = pruneDangling({ verts: g.verts, edges: kept });
    tf = traceFaces(g);
    ({ lab, hist } = labelFaces(g, tf.faces));
  };
  fuse(MIN_CELL_PX); // the cells an over-long line cut off
  fuse(MIN_FACET_PX); // the facets too small to keep
  // Shape (owner, 2026-11-11: "check the lines for angles, how straight … unusual curves"): ends closer than half a
  // metre are one corner, and every line runs straight between its corners — a bend that strays less than 0.6 m from
  // the straight run (0.25 m on the outline, whose corners are real) is the height map's noise, not the roof's shape.
  g = pruneDangling(straightenChains(collapseShort(g, 0.5 / px), 0.6 / px, 0.25 / px));
  tf = traceFaces(g);
  ({ lab, hist } = labelFaces(g, tf.faces));
  fuse(MIN_FACET_PX); // whatever the tidying left too small
  g = pruneDangling(straightenChains(g, 0.6 / px, 0.25 / px));
  tf = traceFaces(g);
  ({ lab, hist } = labelFaces(g, tf.faces));

  // ── 6. name and measure ──
  const facePlane = lab.map((q) => (q >= 0 ? planes[q] : null));
  const facets: EngineFacet[] = tf.faces.map((f, k) => {
    const p = facePlane[k] ?? { gx: 0, gy: 0, c: 0, prior: false };
    const slope = Math.hypot(p.gx, p.gy) / px;
    const planM2 = f.area * px * px;
    return {
      outer: f.outer,
      holes: f.holes,
      plane: { gx: p.gx, gy: p.gy, c: p.c },
      slope,
      azimuthDeg: slope < 0.02 ? null : ((Math.atan2(-p.gx, p.gy) * 180) / Math.PI + 360) % 360,
      planM2,
      areaM2: planM2 * Math.sqrt(1 + slope * slope),
      google: (p as Plane).prior === true,
    };
  });
  let edges: EngineEdge[] = g.edges.map((e, ei) => {
    const A = g.verts[e.a], B = g.verts[e.b];
    const L = Math.hypot(B.x - A.x, B.y - A.y) || 1e-9;
    const d = { x: (B.x - A.x) / L, y: (B.y - A.y) / L };
    const nL = { x: -d.y, y: d.x }; // the side traceFaces calls "left"
    const left = tf.faceOf[2 * ei], right = tf.faceOf[2 * ei + 1];
    const pl = left >= 0 ? facePlane[left] : null, pr = right >= 0 ? facePlane[right] : null;
    const along = (p: { gx: number; gy: number }) => (p.gx * d.x + p.gy * d.y) / px;
    const into = (p: { gx: number; gy: number }, n: Pt) => (p.gx * n.x + p.gy * n.y) / px;
    let type: FacetEdgeType = "EAVE";
    let run = 0;
    if (pl && pr) {
      const zAt = (p: { gx: number; gy: number; c: number }, q: Pt) => p.gx * q.x + p.gy * q.y + p.c;
      const mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
      const qa = lab[left], qb = lab[right];
      const seam = seams.get(Math.min(qa, qb) * 4096 + Math.max(qa, qb));
      // a wall where the roof was MEASURED to step; for two planes never seen touching, where the planes say so
      const wall = seam ? !seam.crease : Math.max(...[A, mid, B].map((q) => Math.abs(zAt(pl, q) - zAt(pr, q)))) > 0.45;
      run = (along(pl) + along(pr)) / 2;
      const sl = Math.hypot(pl.gx, pl.gy) / px, sr = Math.hypot(pr.gx, pr.gy) / px;
      if (wall) {
        // the flashing follows the lower roof: climbing it, step flashing; level along it, wall flashing
        run = zAt(pl, mid) < zAt(pr, mid) ? along(pl) : along(pr);
        type = Math.abs(run) >= 0.08 ? "STEP" : "WALL";
      } else if (sl < 0.04 || sr < 0.04) {
        type = "BREAK"; // a flat part meeting a sloped one
      } else {
        // What kind of crease is read off the two planes, not off how the line happens to lie:
        const facing = (pl.gx * pr.gx + pl.gy * pr.gy) / (Math.hypot(pl.gx, pl.gy) * Math.hypot(pr.gx, pr.gy));
        if (facing > 0.94) {
          type = "BREAK"; // both face the same way (within 20 degrees): a change of pitch
        } else {
          // going into the left facet, does the right one's plane climb away above it (a ridge or hip) or dive under (a valley)?
          const convex = (pr.gx - pl.gx) * nL.x + (pr.gy - pl.gy) * nL.y > 0;
          if (!convex) type = "VALLEY";
          else {
            const dgx = pl.gx - pr.gx, dgy = pl.gy - pr.gy, dg = Math.hypot(dgx, dgy) || 1;
            const level = Math.abs((pl.gx * -dgy + pl.gy * dgx) / dg) / px < 0.06; // the crossing line neither climbs nor falls
            type = facing < -0.5 || level ? "RIDGE" : "HIP";
          }
        }
      }
    } else {
      const p = pl ?? pr;
      if (p) {
        const slope = Math.hypot(p.gx, p.gy) / px;
        const n = pl ? nL : { x: -nL.x, y: -nL.y };
        run = along(p);
        if (slope < 0.04) type = "EAVE";
        else if (Math.abs(run) / slope > 0.5) type = "RAKE";
        else type = into(p, n) > 0 ? "EAVE" : "RAKE";
      }
    }
    const planM = L * px;
    return { a: e.a, b: e.b, type, planM, lengthM: planM * Math.sqrt(1 + run * run), left, right };
  });

  // Straight runs become one edge: a vertex with two edges in a line, the same facets either side, is not a corner.
  const dead = new Set<number>();
  for (let changed = true; changed; ) {
    changed = false;
    const at = new Map<number, number[]>();
    edges.forEach((e, i) => { at.set(e.a, [...(at.get(e.a) ?? []), i]); at.set(e.b, [...(at.get(e.b) ?? []), i]); });
    for (const [v, list] of at) {
      if (list.length !== 2) continue;
      const e1 = edges[list[0]], e2 = edges[list[1]];
      if (!e1 || !e2 || e1.type !== e2.type) continue;
      const u = e1.a === v ? e1.b : e1.a, t = e2.a === v ? e2.b : e2.a;
      if (u === t) continue;
      const V = g.verts[v], U = g.verts[u], T = g.verts[t];
      const cr = (V.x - U.x) * (T.y - V.y) - (V.y - U.y) * (T.x - V.x);
      const dot = (V.x - U.x) * (T.x - V.x) + (V.y - U.y) * (T.y - V.y);
      if (dot <= 0 || Math.abs(Math.atan2(cr, dot)) > (3.5 * Math.PI) / 180) continue;
      const sides = (e: EngineEdge, from: number) => (e.a === from ? [e.left, e.right] : [e.right, e.left]);
      const s1 = sides(e1, u), s2 = sides(e2, v);
      if (s1[0] !== s2[0] || s1[1] !== s2[1]) continue;
      edges[list[0]] = { a: u, b: t, type: e1.type, planM: e1.planM + e2.planM, lengthM: e1.lengthM + e2.lengthM, left: s1[0], right: s1[1] };
      edges.splice(list[1], 1);
      dead.add(v);
      changed = true;
      break;
    }
  }
  // drop the vertices nobody uses any more
  const used = new Map<number, number>();
  const vertices: Pt[] = [];
  const idx = (v: number) => { let k = used.get(v); if (k === undefined) { k = vertices.length; used.set(v, k); vertices.push({ x: g.verts[v].x + x0, y: g.verts[v].y + y0 }); } return k; };
  edges = edges.map((e) => ({ ...e, a: idx(e.a), b: idx(e.b) }));
  const outFacets = facets.map((f) => ({
    ...f,
    outer: f.outer.filter((v) => !dead.has(v)).map(idx),
    holes: f.holes.map((r) => r.filter((v) => !dead.has(v)).map(idx)),
    // planes over the RASTER's pixels, not the window's
    plane: { gx: f.plane.gx, gy: f.plane.gy, c: f.plane.c - f.plane.gx * x0 - f.plane.gy * y0 },
  }));

  // quality: how much of the roof sits on the plane of the facet drawn over it
  let agreeN = 0, missSq = 0, missN = 0;
  for (let i = 0; i < cellId.length; i++) {
    const c = cellId[i];
    if (!c || !inside[i]) continue;
    const q = lab[c - 1];
    if (q < 0) continue;
    const p = planes[q];
    const x = (i % w) + 0.5, y = ((i / w) | 0) + 0.5;
    const d = Math.min(0.6, Math.abs(z[i] - (p.gx * x + p.gy * y + p.c)) / Math.sqrt(1 + (p.gx * p.gx + p.gy * p.gy) / (px * px)));
    // "sits on it": within a quarter of a metre, square to the roof — a tree or a chimney does not
    if (d <= 0.25) agreeN++;
    missSq += d * d; missN++;
  }
  return {
    shift,
    vertices,
    facets: outFacets,
    edges,
    quality: {
      agree: agreeN / roofPx,
      rmsM: Math.sqrt(missSq / Math.max(1, missN)),
      planes: planes.length,
      googlePlanes: planes.filter((p) => p.prior).length,
      googleSegments: input.priors.length,
      outlineM2: Math.abs(ringArea(ring)) * px * px,
      buildingShare,
    },
  };
}

/** What was measured where two planes touch: the real jump in height across the seam, and so whether it is a crease or a wall. */
interface Seam {
  /** metres the roof steps across the seam (signed, median over the seam); near zero where the surface runs on */
  step: number;
  crease: boolean;
}

/** A seam is a crease (ridge, hip, valley, pitch change) while the roof steps less than this across it, metres. */
const WALL_STEP_M = 0.4;

/**
 * The straight lines between neighbouring planes, and what kind of seam each pair has.
 *
 * Whether two planes meet in a crease or at a wall is MEASURED, not inferred from the planes: the height map is read
 * half a metre either side of the seam and compared with what the two slopes alone would give. (The first version
 * asked whether the two fitted planes cross near the seam — but a fitted plane's height is only as good as its fit,
 * and on the first real roofs half the ridges of a two-wing house came out as "walls".) For a crease the line runs
 * in the direction the two planes' crossing must have, placed on the planes' own crossing when the seam is there and
 * on the seam itself when it is not; for a wall a line is fitted to the seam along the building's directions.
 */
function linesBetween(planes: ReadonlyArray<Plane>, label: Int16Array, z: Float32Array, w: number, h: number, px: number, axesDeg: ReadonlyArray<number>, trace?: string[]): { segs: Seg[]; seams: Map<number, Seam> } {
  // per pair (lower id first): the seam's points, and at each the unit step from the lower-id plane to the other
  const pairs = new Map<number, { pts: Pt[]; nx: number[]; ny: number[] }>();
  const push = (la: number, lb: number, p: Pt, nx: number, ny: number) => {
    const lo = Math.min(la, lb), k = lo * 4096 + Math.max(la, lb);
    let e = pairs.get(k);
    if (!e) { e = { pts: [], nx: [], ny: [] }; pairs.set(k, e); }
    e.pts.push(p);
    const s = la === lo ? 1 : -1;
    e.nx.push(nx * s); e.ny.push(ny * s);
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, a = label[i];
    if (a < 0) continue;
    if (x + 1 < w) { const b = label[i + 1]; if (b >= 0 && b !== a) push(a, b, { x: x + 1, y: y + 0.5 }, 1, 0); }
    if (y + 1 < h) { const b = label[i + w]; if (b >= 0 && b !== a) push(a, b, { x: x + 0.5, y: y + 1 }, 0, 1); }
  }
  const segs: Seg[] = [];
  const seams = new Map<number, Seam>();
  const EXT = 3 / px; // creases run on 3 m past where the two planes were seen to touch
  const D = 5.5; // pixels from the seam to the two readings
  let onCrossing = 0, onSeam = 0, walls = 0;
  for (const [k, e] of pairs) {
    const { pts } = e;
    if (pts.length < 8) continue;
    const ia = Math.floor(k / 4096), ib = k % 4096;
    const A = planes[ia], B = planes[ib];
    // the real step across the seam
    const steps: number[] = [];
    for (let q = 0; q < pts.length; q++) {
      const p = pts[q], nx = e.nx[q], ny = e.ny[q];
      const bx = Math.floor(p.x + nx * D), by = Math.floor(p.y + ny * D), ax = Math.floor(p.x - nx * D), ay = Math.floor(p.y - ny * D);
      if (bx < 0 || by < 0 || bx >= w || by >= h || ax < 0 || ay < 0 || ax >= w || ay >= h) continue;
      if (label[by * w + bx] !== ib || label[ay * w + ax] !== ia) continue;
      // what the two slopes alone would make of the same two readings, were the surface unbroken at the seam
      const unbroken = D * (B.gx * nx + B.gy * ny) + D * (A.gx * nx + A.gy * ny);
      steps.push(z[by * w + bx] - z[ay * w + ax] - unbroken);
    }
    let step: number;
    if (steps.length >= 6) {
      steps.sort((p, q) => p - q);
      step = steps[steps.length >> 1];
    } else {
      // too narrow to read either side: fall back on the planes themselves
      const gaps = pts.map((p) => B.gx * p.x + B.gy * p.y + B.c - (A.gx * p.x + A.gy * p.y + A.c)).sort((p, q) => p - q);
      step = gaps[gaps.length >> 1];
    }
    const crease = Math.abs(step) < WALL_STEP_M;
    seams.set(k, { step, crease });

    const dgx = A.gx - B.gx, dgy = A.gy - B.gy, dg = Math.hypot(dgx, dgy);
    let rest = pts;
    if (crease && dg / px >= 0.04) {
      const dc = A.c - B.c;
      const dist = (p: Pt) => (dgx * p.x + dgy * p.y + dc) / dg; // pixels from the planes' own crossing
      const BAND = 0.7 / px;
      let shift = 0;
      let held = pts.filter((p) => Math.abs(dist(p)) <= BAND);
      if (held.length < Math.max(8, pts.length * 0.4)) {
        // the planes cross somewhere else on paper: keep the crossing's direction, put the line on the seam
        const ds = pts.map(dist).sort((p, q) => p - q);
        shift = ds[ds.length >> 1];
        held = pts.filter((p) => Math.abs(dist(p) - shift) <= BAND);
        if (held.length < Math.max(8, pts.length * 0.5)) held = [];
      }
      if (held.length) {
        const d = { x: -dgy / dg, y: dgx / dg }, n = { x: dgx / dg, y: dgy / dg };
        const p0 = { x: (-dc * dgx) / (dg * dg) + n.x * shift, y: (-dc * dgy) / (dg * dg) + n.y * shift };
        const ts = held.map((p) => (p.x - p0.x) * d.x + (p.y - p0.y) * d.y).sort((p, q) => p - q);
        const t0 = ts[Math.floor(ts.length * 0.03)] - EXT, t1 = ts[Math.ceil(ts.length * 0.97) - 1] + EXT;
        segs.push({ a: { x: p0.x + d.x * t0, y: p0.y + d.y * t0 }, b: { x: p0.x + d.x * t1, y: p0.y + d.y * t1 }, outline: false, tag: k });
        if (shift === 0) onCrossing++; else onSeam++;
        rest = pts.filter((p) => Math.abs(dist(p) - shift) > BAND);
      }
    }
    if (rest.length >= 12) {
      for (const sg of fitLines(rest, axesDeg, 1.5 / px)) { segs.push({ ...sg, outline: false, tag: -2 }); walls++; }
    }
  }
  const nWalls = [...seams.values()].filter((sm) => !sm.crease).length;
  trace?.push(`${seams.size} seams between planes: ${seams.size - nWalls} creases (${onCrossing} lines on the planes' own crossing, ${onSeam} placed on the seam), ${nWalls} real steps in height; ${walls} line(s) fitted`);
  return { segs, seams };
}

/**
 * Up to three straight lines through a cloud of boundary points. A wall between two roof levels runs the way the
 * building runs, so the building's two directions are tried first, its diagonals second, and the cloud's own long
 * direction is believed only when it clearly holds more of the points.
 */
function fitLines(points: ReadonlyArray<Pt>, axesDeg: ReadonlyArray<number>, extendPx: number): Array<{ a: Pt; b: Pt }> {
  const out: Array<{ a: Pt; b: Pt }> = [];
  let rest = [...points];
  const MIN = 12;
  for (let round = 0; round < 3 && rest.length >= MIN; round++) {
    let mx = 0, my = 0;
    for (const p of rest) { mx += p.x; my += p.y; }
    mx /= rest.length; my /= rest.length;
    let sxx = 0, sxy = 0, syy = 0;
    for (const p of rest) { sxx += (p.x - mx) ** 2; sxy += (p.x - mx) * (p.y - my); syy += (p.y - my) ** 2; }
    const own = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    const ax = (axesDeg[0] * Math.PI) / 180;
    const tries: Array<[number, number]> = [];
    for (const d of axesDeg) { const a = (d * Math.PI) / 180; tries.push([a, 1.3], [a + Math.PI / 2, 1.3]); }
    tries.push([ax + Math.PI / 4, 1.1], [ax - Math.PI / 4, 1.1], [own, 1]);
    let best: { dir: number; u0: number; n: number; score: number } | null = null;
    for (const [dir, weight] of tries) {
      const nx = -Math.sin(dir), ny = Math.cos(dir);
      const us = rest.map((p) => p.x * nx + p.y * ny).sort((a, b) => a - b);
      // the densest 5-pixel band
      let bn = 0, bu = us[0];
      for (let i = 0, j = 0; i < us.length; i++) {
        while (us[i] - us[j] > 5) j++;
        if (i - j + 1 > bn) { bn = i - j + 1; bu = us[(i + j) >> 1]; }
      }
      if (!best || bn * weight > best.score) best = { dir, u0: bu, n: bn, score: bn * weight };
    }
    if (!best || best.n < MIN) break;
    const nx = -Math.sin(best.dir), ny = Math.cos(best.dir), dx = Math.cos(best.dir), dy = Math.sin(best.dir);
    const inl = rest.filter((p) => Math.abs(p.x * nx + p.y * ny - best!.u0) <= 3);
    const ts = inl.map((p) => p.x * dx + p.y * dy).sort((a, b) => a - b);
    const lo = ts[Math.floor(ts.length * 0.03)], hi = ts[Math.ceil(ts.length * 0.97) - 1];
    rest = rest.filter((p) => Math.abs(p.x * nx + p.y * ny - best!.u0) > 3);
    if (hi - lo < 10) continue; // a metre of wall at least
    const u = inl.reduce((s, p) => s + p.x * nx + p.y * ny, 0) / inl.length;
    out.push({ a: { x: nx * u + dx * (lo - extendPx), y: ny * u + dy * (lo - extendPx) }, b: { x: nx * u + dx * (hi + extendPx), y: ny * u + dy * (hi + extendPx) } });
  }
  return out;
}
