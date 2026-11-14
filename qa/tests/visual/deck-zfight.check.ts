// NO FLICKER IN THE 3D (owner, 2026-10-11, with a screenshot of a covered deck: "fix flickering on the 3D around the
// rim joist fascia") — pure, no browser.
//
// The 3D draws every wood part one-sided. Two faces that lie in one plane, face the same way and overlap fight in the
// depth buffer: as the view turns, the picture flickers between them. This walks every face the 3D draws — the boxes
// (members, boards, hardware, trim) and the flat polygons (roof faces, ceilings, slabs, walls; drawn two-sided) — for
// the twelve samples, the owner's covered deck and a spread of edge cases (fascia on, borders, single or double rim,
// flush or dropped beams, L-shapes, bowed and clipped fronts, two levels, wraps), and fails on any such pair.
//
// Run: npx tsx --tsconfig tsconfig.json qa/tests/visual/deck-zfight.check.ts [--verbose]
import { applyDeckPatch } from "../../../src/lib/deck/checks";
import { defaultDeckDesign, type DeckDesign } from "../../../src/lib/deck/design";
import { DECK_SAMPLES, sampleDesign } from "../../../src/lib/deck/samples";
import { SCENE_LAYERS, deckScene, type DeckScene } from "../../../src/lib/deck/scene";
import { buildStructure } from "../../../src/lib/deck/structure";

const VERBOSE = process.argv.includes("--verbose");
type V = [number, number, number];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V, s: number): V => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V): V => mul(a, 1 / (Math.hypot(...a) || 1));

/** Faces closer than this (ft) in one plane fight at the distances the 3D is viewed from (≈ 0.03 in.). */
const COPLANAR_FT = 0.0025;
/** Overlaps smaller than this (sq ft, ≈ 0.07 sq in.) are a corner touching, not a visible flicker. */
const MIN_AREA = 0.0005;
/** …and thinner than this (ft, ≈ 0.05 in.) never a pixel wide at the distances the 3D is seen from. */
const SLIVER_FT = 0.004;

const LAYER = (name: string) => SCENE_LAYERS.indexOf(name as (typeof SCENE_LAYERS)[number]);
/** The roles DeckModel3D cuts plumb at their ends (kept in step with its PLUMB_CUT). */
const PLUMB_CUT = /^(rafter|jack|fly|hip|fascia rake|stringer|stair rail|roof brace|brace|truss top chord)$/;
const NOT_DRAWN = new Set([LAYER("footing"), LAYER("wire")]);

interface Face { n: V; d: number; pts: V[]; src: string; layer: string; two: boolean }

function boxFaces(scene: DeckScene, i: number): Face[] {
  const b = scene.boxes[i];
  if (NOT_DRAWN.has(b[0]) || b[7] !== 0) return [];
  const turned = b.length >= 10 && (b[8] !== 0 || b[9] !== 0);
  const yaw = turned ? b[8] : 0;
  const tilt = turned ? b[9] : 0;
  // As DeckModel3D lays a box: `sx` along u (yaw in plan, rising tilt), `sy` across (v), `sz` up its own depth (w).
  const u: V = [Math.cos(yaw) * Math.cos(tilt), Math.sin(yaw) * Math.cos(tilt), Math.sin(tilt)];
  const v: V = [-Math.sin(yaw), Math.cos(yaw), 0];
  const w: V = [-Math.cos(yaw) * Math.sin(tilt), -Math.sin(yaw) * Math.sin(tilt), Math.cos(tilt)];
  const c: V = [b[1], b[2], b[3]];
  const tag = scene.tags.length === scene.boxes.length && scene.tags[i] >= 0 ? scene.legend[scene.tags[i]]?.role ?? "" : "";
  const layer = SCENE_LAYERS[b[0]];
  // A sloped member's ends are plumb cuts in the viewer: each point slides along the member by tan(tilt) × its
  // height above the member's axis, so both end faces stand vertical.
  const plumb = turned && Math.abs(tilt) > 0.02 && Math.abs(tilt) < 1.45 && PLUMB_CUT.test(tag);
  const k = plumb ? Math.tan(tilt) : 0;
  const corner = (a: number, bb: number, cc: number): V => {
    const along = (a * b[4]) / 2 + k * ((cc * b[6]) / 2);
    return add(add(add(c, mul(u, along)), mul(v, (bb * b[5]) / 2)), mul(w, (cc * b[6]) / 2));
  };
  // The six faces as quads of the eight corners (a, b, c = ±1 along u, v, w), each wound outward.
  const quads: Array<[V, V, V, V]> = [
    [corner(1, -1, -1), corner(1, 1, -1), corner(1, 1, 1), corner(1, -1, 1)],
    [corner(-1, -1, -1), corner(-1, -1, 1), corner(-1, 1, 1), corner(-1, 1, -1)],
    [corner(-1, 1, -1), corner(-1, 1, 1), corner(1, 1, 1), corner(1, 1, -1)],
    [corner(-1, -1, -1), corner(1, -1, -1), corner(1, -1, 1), corner(-1, -1, 1)],
    [corner(-1, -1, 1), corner(1, -1, 1), corner(1, 1, 1), corner(-1, 1, 1)],
    [corner(-1, -1, -1), corner(-1, 1, -1), corner(1, 1, -1), corner(1, -1, -1)],
  ];
  const out: Face[] = [];
  for (const pts of quads) {
    const n = norm(cross([pts[1][0] - pts[0][0], pts[1][1] - pts[0][1], pts[1][2] - pts[0][2]], [pts[3][0] - pts[0][0], pts[3][1] - pts[0][1], pts[3][2] - pts[0][2]]));
    out.push({ n, d: dot(n, pts[0]), pts, src: `box ${i} ${layer}${tag ? ` "${tag}"` : ""} @(${b[1]}, ${b[2]}, ${b[3]}) ${b[4]}×${b[5]}×${b[6]}`, layer, two: false });
  }
  return out;
}

function polyFaces(scene: DeckScene, i: number): Face[] {
  const r = scene.polys[i];
  const pts: V[] = [];
  for (let k = 1; k + 2 < r.length; k += 3) pts.push([r[k], r[k + 1], r[k + 2]]);
  if (pts.length < 3) return [];
  // Newell's normal.
  let n: V = [0, 0, 0];
  for (let k = 0; k < pts.length; k++) {
    const a = pts[k];
    const b = pts[(k + 1) % pts.length];
    n = add(n, [(a[1] - b[1]) * (a[2] + b[2]), (a[2] - b[2]) * (a[0] + b[0]), (a[0] - b[0]) * (a[1] + b[1])]);
  }
  if (Math.hypot(...n) < 1e-9) return [];
  n = norm(n);
  const layer = SCENE_LAYERS[r[0]];
  return [{ n, d: dot(n, pts[0]), pts, src: `poly ${i} ${layer}`, layer, two: true }];
}

function diagonalFaces(scene: DeckScene): Face[] {
  if (!scene.diagonal) return [];
  const out: Face[] = [];
  const t = scene.diagonal.thickFt;
  scene.diagonal.boards.forEach((ring, i) => {
    const z = scene.diagonal!.zs?.[i] ?? scene.heightFt;
    const top: V[] = [];
    for (let k = 0; k + 1 < ring.length; k += 2) top.push([ring[k], ring[k + 1], z]);
    if (top.length < 3) return;
    out.push({ n: [0, 0, 1], d: z, pts: top, src: `diagonal board ${i} top`, layer: "decking", two: false });
    out.push({ n: [0, 0, -1], d: -(z - t), pts: top.map((p) => [p[0], p[1], z - t] as V).reverse(), src: `diagonal board ${i} bottom`, layer: "decking", two: false });
  });
  return out;
}

type P2 = [number, number];
const area2 = (poly: P2[]) => {
  let s = 0;
  for (let k = 0; k < poly.length; k++) {
    const [x0, y0] = poly[k];
    const [x1, y1] = poly[(k + 1) % poly.length];
    s += x0 * y1 - x1 * y0;
  }
  return Math.abs(s) / 2;
};
/** The overlap of two planar polygons in face a's plane, in that plane's own 2D frame (convex clip). */
function overlapPoly(a: Face, b: Face): { poly: P2[]; to2: (p: V) => P2 } {
  const n = a.n;
  const e1 = norm(cross(n, Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]));
  const e2 = cross(n, e1);
  const to2 = (p: V): [number, number] => [dot(p, e1), dot(p, e2)];
  const ccw = (poly: Array<[number, number]>) => {
    let s = 0;
    for (let k = 0; k < poly.length; k++) {
      const [x0, y0] = poly[k];
      const [x1, y1] = poly[(k + 1) % poly.length];
      s += x0 * y1 - x1 * y0;
    }
    return s < 0 ? poly.slice().reverse() : poly;
  };
  const P = ccw(a.pts.map(to2));
  const Q = ccw(b.pts.map(to2));
  // A quick bounding-box test first.
  const bb = (poly: Array<[number, number]>) => [Math.min(...poly.map((p) => p[0])), Math.min(...poly.map((p) => p[1])), Math.max(...poly.map((p) => p[0])), Math.max(...poly.map((p) => p[1]))];
  const [ax0, ay0, ax1, ay1] = bb(P);
  const [bx0, by0, bx1, by1] = bb(Q);
  if (ax1 <= bx0 || bx1 <= ax0 || ay1 <= by0 || by1 <= ay0) return { poly: [], to2 };
  let out = P;
  for (let k = 0; k < Q.length && out.length; k++) {
    const [cx0, cy0] = Q[k];
    const [cx1, cy1] = Q[(k + 1) % Q.length];
    const inside = (p: [number, number]) => (cx1 - cx0) * (p[1] - cy0) - (cy1 - cy0) * (p[0] - cx0) >= -1e-12;
    const cut = (p: [number, number], q: [number, number]): [number, number] => {
      const a1 = cy1 - cy0;
      const b1 = cx0 - cx1;
      const c1 = a1 * cx0 + b1 * cy0;
      const a2 = q[1] - p[1];
      const b2 = p[0] - q[0];
      const c2 = a2 * p[0] + b2 * p[1];
      const det = a1 * b2 - a2 * b1;
      return Math.abs(det) < 1e-15 ? p : [(b2 * c1 - b1 * c2) / det, (a1 * c2 - a2 * c1) / det];
    };
    const input = out;
    out = [];
    for (let m = 0; m < input.length; m++) {
      const cur = input[m];
      const prev = input[(m + input.length - 1) % input.length];
      if (inside(cur)) {
        if (!inside(prev)) out.push(cut(prev, cur));
        out.push(cur);
      } else if (inside(prev)) out.push(cut(prev, cur));
    }
  }
  return { poly: out.length >= 3 ? out : [], to2 };
}
/** Clip a 2D polygon by a convex one (both counter-clockwise). */
function clip2(P: P2[], Q: P2[]): P2[] {
  let out = P;
  for (let k = 0; k < Q.length && out.length; k++) {
    const [cx0, cy0] = Q[k];
    const [cx1, cy1] = Q[(k + 1) % Q.length];
    const inside = (p: P2) => (cx1 - cx0) * (p[1] - cy0) - (cy1 - cy0) * (p[0] - cx0) >= -1e-12;
    const cut = (p: P2, q: P2): P2 => {
      const a1 = cy1 - cy0;
      const b1 = cx0 - cx1;
      const c1 = a1 * cx0 + b1 * cy0;
      const a2 = q[1] - p[1];
      const b2 = p[0] - q[0];
      const c2 = a2 * p[0] + b2 * p[1];
      const det = a1 * b2 - a2 * b1;
      return Math.abs(det) < 1e-15 ? p : [(b2 * c1 - b1 * c2) / det, (a1 * c2 - a2 * c1) / det];
    };
    const input = out;
    out = [];
    for (let m = 0; m < input.length; m++) {
      const cur = input[m];
      const prev = input[(m + input.length - 1) % input.length];
      if (inside(cur)) {
        if (!inside(prev)) out.push(cut(prev, cur));
        out.push(cur);
      } else if (inside(prev)) out.push(cut(prev, cur));
    }
  }
  return out;
}
const ccw2 = (poly: P2[]) => {
  let s = 0;
  for (let k = 0; k < poly.length; k++) s += poly[k][0] * poly[(k + 1) % poly.length][1] - poly[(k + 1) % poly.length][0] * poly[k][1];
  return s < 0 ? poly.slice().reverse() : poly;
};

export interface Fight { a: string; b: string; area: number; gapFt: number; pair: string; n: V }

/** Every pair of faces the 3D draws in one plane, facing the same way (or two-sided), that overlap. */
export function sceneFights(scene: DeckScene): Fight[] {
  const faces: Face[] = [];
  scene.boxes.forEach((_, i) => faces.push(...boxFaces(scene, i)));
  scene.polys.forEach((_, i) => faces.push(...polyFaces(scene, i)));
  faces.push(...diagonalFaces(scene));
  // Bucket by direction (two-sided faces under both of theirs) and by the plane's offset.
  const buckets = new Map<string, Face[]>();
  const dirKey = (n: V) => n.map((x) => Math.round(x * 200)).join(",");
  const put = (f: Face, n: V, d: number) => {
    const k = `${dirKey(n)}|${Math.floor(d / 0.01)}`;
    const list = buckets.get(k) ?? [];
    list.push({ ...f, n, d });
    buckets.set(k, list);
  };
  for (const f of faces) {
    put(f, f.n, f.d);
    if (f.two) put(f, mul(f.n, -1), -f.d);
  }
  // Faces pressed against another solid's face (the same plane, facing back at it) are out of sight where they touch:
  // a joist's end against the ledger, a post's foot on its footing. A fight wholly inside such a contact is never seen.
  const contacts = new Map<string, Face[]>();
  for (const f of faces) {
    const k = `${dirKey(mul(f.n, -1))}|${Math.floor(-f.d / 0.01)}`;
    contacts.set(k, [...(contacts.get(k) ?? []), f]);
  }
  // The deck's boards cover what lies under them — joist and rim tops — gaps and all (a board's gap is under ¼ in.):
  // their undersides count as contact, each grown by a quarter inch.
  const GROW = 0.021;
  for (const f of faces) {
    if (f.layer !== "decking" || f.n[2] > -0.99) continue;
    const m = f.pts.length;
    const grown = f.pts.map((pt, k) => {
      const prev = f.pts[(k + m - 1) % m];
      const next = f.pts[(k + 1) % m];
      const a = norm([pt[0] - prev[0], pt[1] - prev[1], 0]);
      const b = norm([pt[0] - next[0], pt[1] - next[1], 0]);
      return [pt[0] + (a[0] + b[0]) * GROW, pt[1] + (a[1] + b[1]) * GROW, pt[2]] as V;
    });
    const k = `${dirKey(mul(f.n, -1))}|${Math.floor(-f.d / 0.01)}`;
    contacts.set(k, [...(contacts.get(k) ?? []), { ...f, pts: grown, src: `${f.src} (grown)` }]);
  }
  // The house's walls hide what is pressed against them (a rafter's end at the wall, a roof ledger's back).
  for (const b of scene.house?.blocks ?? []) {
    const [x0, y0, x1, y1] = b;
    const h = scene.house!.heightFt + 30;
    const walls: Array<[V, V[]]> = [
      [[0, 1, 0], [[x0, y1, -5], [x1, y1, -5], [x1, y1, h], [x0, y1, h]]],
      [[0, -1, 0], [[x0, y0, -5], [x1, y0, -5], [x1, y0, h], [x0, y0, h]]],
      [[1, 0, 0], [[x1, y0, -5], [x1, y1, -5], [x1, y1, h], [x1, y0, h]]],
      [[-1, 0, 0], [[x0, y0, -5], [x0, y1, -5], [x0, y1, h], [x0, y0, h]]],
    ];
    for (const [n, pts] of walls) {
      const d = dot(n, pts[0]);
      const k = `${dirKey(mul(n, -1))}|${Math.floor(-d / 0.01)}`;
      contacts.set(k, [...(contacts.get(k) ?? []), { n, d, pts, src: "house wall", layer: "house", two: false }]);
    }
  }
  for (const ft of scene.footings) {
    // The pier's top, a disc at the footing's top (as a 16-gon), facing up: what a post base stands on.
    const [x, y, , , pier, , top] = ft;
    const ring: V[] = Array.from({ length: 16 }, (_, k) => [x + (pier / 2) * Math.cos((k * Math.PI) / 8), y + (pier / 2) * Math.sin((k * Math.PI) / 8), top] as V);
    const k = `${dirKey([0, 0, -1])}|${Math.floor(-top / 0.01)}`;
    contacts.set(k, [...(contacts.get(k) ?? []), { n: [0, 0, 1], d: top, pts: ring, src: "pier top", layer: "footing", two: false }]);
  }
  const hiddenByContact = (a: Face, poly: P2[], to2: (p: V) => P2, dir: string, bin: number) => {
    const total = area2(poly);
    let covered = 0;
    for (const bb of [bin - 1, bin, bin + 1]) {
      for (const g of contacts.get(`${dir}|${bb}`) ?? []) {
        if (Math.abs(g.d + a.d) > COPLANAR_FT || dot(g.n, a.n) > -0.99999) continue;
        const G = ccw2(g.pts.map(to2));
        const part = clip2(ccw2(poly), G);
        if (part.length >= 3) covered += area2(part);
      }
    }
    return covered >= total * 0.98;
  };
  const fights: Fight[] = [];
  const seen = new Set<string>();
  for (const [k, list] of buckets) {
    const [dir, bin] = k.split("|");
    const next = buckets.get(`${dir}|${+bin + 1}`) ?? [];
    const pool = list.concat(next);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < pool.length; j++) {
        const a = list[i];
        const b = pool[j];
        if (a.src === b.src) continue;
        if (dot(a.n, b.n) < 0.99999) continue;
        const gap = Math.abs(a.d - b.d);
        if (gap > COPLANAR_FT) continue;
        const key = [a.src, b.src].sort().join(" ~ ") + `|${dir}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const { poly, to2 } = overlapPoly(a, b);
        const area = poly.length ? area2(poly) : 0;
        if (area < MIN_AREA) continue;
        // A sliver thinner than SLIVER_FT (rounding to the thousandth of a foot can leave one) is never a pixel wide.
        let perimeter = 0;
        for (let k = 0; k < poly.length; k++) perimeter += Math.hypot(poly[(k + 1) % poly.length][0] - poly[k][0], poly[(k + 1) % poly.length][1] - poly[k][1]);
        if ((2 * area) / Math.max(perimeter, 1e-9) < SLIVER_FT) continue;
        if (hiddenByContact(a, poly, to2, dir, +bin)) continue;
        const pair = [a.layer, b.layer].sort().join(" + ");
        fights.push({ a: a.src, b: b.src, area, gapFt: gap, pair, n: a.n });
      }
    }
  }
  return fights;
}

/* ── The designs ─────────────────────────────────────────────────────── */
const base = defaultDeckDesign({ state: "WA", frostIn: 18 });
type Patch = Parameters<typeof applyDeckPatch>[1];
const cases: Array<{ name: string; design: DeckDesign }> = [];
for (const s of DECK_SAMPLES) cases.push({ name: `sample ${s.id}`, design: sampleDesign(s, base) });
const rect = (w: number, d: number, front?: { kind: "straight" | "curve" | "clipped"; bulgeFt?: number; clipFt?: number }) => ({ kind: "rect" as const, widthFt: w, depthFt: d, ...(front ? { front: { kind: front.kind, bulgeFt: front.bulgeFt ?? 2, clipFt: front.clipFt ?? 2 } } : {}) });
const stairs = (side: "front" | "left" | "right" = "front", atFt = 8, widthFt = 4) => [{ id: "s1", side, atFt, widthFt, level: "upper" as const, wrap: false, wrapSides: 1 as const, landing: "pad" as const, handrail: "both" as const }];
const variants: Array<[string, Patch]> = [
  ["the owner's covered deck: 39'-6\" × 25' gable 5:12, aluminum rail, stairs, fascia", { structure: "covered-deck", shape: rect(39.5, 25), roof: { ...base.roof, kind: "gable", pitch: 5 }, rail: { ...base.rail, type: "aluminum" }, stairs: stairs("front", 30, 6), decking: { ...base.decking, fascia: "match" } } as Patch],
  ["covered deck, 22 × 16, gable, fascia, picture-frame border", { structure: "covered-deck", shape: rect(22, 16), roof: { ...base.roof, kind: "gable" }, stairs: stairs(), decking: { ...base.decking, fascia: "match", border: 1 } } as Patch],
  ["deck 16 × 12, fascia, single rim", { shape: rect(16, 12), decking: { ...base.decking, fascia: "match" }, framing: { ...base.framing, doubleRim: false } } as Patch],
  ["deck 16 × 12, fascia, double rim", { shape: rect(16, 12), decking: { ...base.decking, fascia: "match" }, framing: { ...base.framing, doubleRim: true } } as Patch],
  ["deck 20 × 14, flush beam, fascia", { shape: rect(20, 14), decking: { ...base.decking, fascia: "match" }, framing: { ...base.framing, beamStyle: "flush" } } as Patch],
  ["deck 20 × 14, dropped beam, fascia, two-board border", { shape: rect(20, 14), decking: { ...base.decking, fascia: "match", border: 2 }, framing: { ...base.framing, beamStyle: "dropped" } } as Patch],
  ["deck 24 × 16 bowed front, fascia", { shape: rect(24, 16, { kind: "curve", bulgeFt: 2 }), decking: { ...base.decking, fascia: "match" } } as Patch],
  ["deck 24 × 16 clipped corners, fascia", { shape: rect(24, 16, { kind: "clipped", clipFt: 3 }), decking: { ...base.decking, fascia: "match" } } as Patch],
  ["L-shaped deck, fascia, stairs on the side", { shape: { kind: "L", widthFt: 24, depthFt: 16, notch: { corner: "front-right", widthFt: 8, depthFt: 6 } }, decking: { ...base.decking, fascia: "match" }, stairs: stairs("left", 6, 4) } as Patch],
  ["detached deck, fascia, wrap-around steps", { placement: "detached", shape: rect(14, 12), decking: { ...base.decking, fascia: "match" }, stairs: [{ ...stairs()[0], wrap: true, wrapSides: 4 }] } as Patch],
  ["deck, diagonal boards, fascia", { shape: rect(18, 12), decking: { ...base.decking, fascia: "match", pattern: "diagonal" } } as Patch],
  ["deck 24 × 16 clipped corners, two-board border, fascia", { shape: rect(24, 16, { kind: "clipped", clipFt: 3 }), decking: { ...base.decking, fascia: "match", border: 2 } } as Patch],
  ["deck 24 × 16 bowed front, one-board border", { shape: rect(24, 16, { kind: "curve", bulgeFt: 2 }), decking: { ...base.decking, fascia: "match", border: 1 } } as Patch],
  ["free-standing deck 16 × 12, two-board border all round", { placement: "detached", shape: rect(16, 12), decking: { ...base.decking, fascia: "match", border: 2 } } as Patch],
  ["deck 12 × 20 (deeper than wide), border", { shape: rect(12, 20), decking: { ...base.decking, border: 1 } } as Patch],
];
// A DOUBLE DECK (2026-11-13): the lower deck's beams let into posts that run on up through its boards — with the beams
// under the joists (the starting layout's are flush), wood rails, and standing free of the house.
variants.push(["double deck, beams under the joists, cedar rail", { structure: "deck", floor: "deck", placement: "attached", shape: { kind: "rect", widthFt: 20, depthFt: 14 }, heightIn: 156, rail: { type: "cedar" }, stairs: [], lower: { on: true, place: "under", heightIn: 42 } }]);
variants.push(["double deck, free-standing", { structure: "deck", floor: "deck", placement: "beside", shape: { kind: "rect", widthFt: 16, depthFt: 12 }, heightIn: 132, rail: { type: "composite" }, stairs: [], lower: { on: true, place: "under", heightIn: 24 } }]);
// LANDINGS (2026-11-14): a stair that turns at a landing, one that comes back beside itself, one with two landings —
// the landings' frames, posts and rails against the flights' own; top-mounted metal rails and side-mounted wood ones.
const turned = (turns: Array<[number, string]>, side: "front" | "left" | "right" = "front") => [{ ...stairs(side, 8, 4)[0], handrail: "both" as const, landings: turns.map(([heightIn, turn], i) => ({ id: `t${i + 1}`, heightIn, turn })) }];
variants.push(["stair with a landing, a quarter turn, aluminum rail", { structure: "deck", shape: rect(16, 12), heightIn: 120, rail: { ...base.rail, type: "aluminum" }, stairs: turned([[60, "left"]]) } as Patch]);
variants.push(["stair with a switchback landing, cedar rail", { structure: "deck", shape: rect(16, 12), heightIn: 132, rail: { ...base.rail, type: "cedar" }, stairs: turned([[66, "back-right"]]) } as Patch]);
variants.push(["stair with two landings turning the same way, composite rail", { structure: "deck", shape: rect(20, 12), heightIn: 126, rail: { ...base.rail, type: "composite" }, stairs: turned([[84, "right"], [42, "right"]]) } as Patch]);
variants.push(["stair with a straight landing and then a turn", { structure: "deck", shape: rect(16, 12), heightIn: 108, rail: { ...base.rail, type: "aluminum" }, stairs: turned([[72, "straight"], [36, "left"]]) } as Patch]);
// PAST THE HOUSE'S CORNER (2026-11-14): the deck runs on past a corner of the house and back along its side — a part
// with a beam of its own at the back beside a part on the ledger; the rim, the fascia, the border and the rail along
// the open back edge, and the edge joist against the house's side wall.
variants.push(["deck 6 ft past the house's right corner, aluminum rail, fascia", { structure: "deck", shape: rect(26, 12), heightIn: 48, house: { ...base.house, rightFt: -6 }, rail: { ...base.rail, type: "aluminum" }, decking: { ...base.decking, fascia: "match" }, stairs: stairs("front", 6, 4) } as Patch]);
variants.push(["wrap-around deck: 8 ft past the right corner, 10 ft back, border, composite rail", { structure: "deck", shape: rect(30, 12), heightIn: 48, house: { ...base.house, rightFt: -8, wrapRightFt: 10 }, rail: { ...base.rail, type: "composite" }, decking: { ...base.decking, fascia: "match", border: 1 }, stairs: stairs("front", 6, 4) } as Patch]);
variants.push(["deck round both corners of the house, second storey, cedar rail, double rim", { structure: "deck", shape: rect(40, 12), heightIn: 108, house: { ...base.house, storeys: 2, leftFt: -6, rightFt: -8, wrapLeftFt: 8, wrapRightFt: 12 }, rail: { ...base.rail, type: "cedar" }, framing: { ...base.framing, doubleRim: true }, decking: { ...base.decking, fascia: "match" }, stairs: [] } as Patch]);
variants.push(["wrap-around deck on its own posts, flush beams, two-board border", { structure: "deck", placement: "beside", shape: rect(28, 14), heightIn: 30, house: { ...base.house, leftFt: -6, wrapLeftFt: 12 }, rail: { ...base.rail, type: "none" }, framing: { ...base.framing, beamStyle: "flush" }, decking: { ...base.decking, fascia: "match", border: 2 }, stairs: [] } as Patch]);
// A FRONT SET PART BY PART (2026-11-14): a bay that comes out, a front stepping down a side, a U — each part's own
// front beam, the rim, fascia, border and rail round every step in the front, and the inside corners where two meet.
const parts = (list: Array<[number, number]>) => {
  let x = 0;
  const front = list.map(([w, y]) => ({ x0Ft: x, x1Ft: (x += w), yFt: y }));
  return { kind: "wall" as const, widthFt: x, depthFt: Math.max(...list.map((q) => q[1])), back: [{ x0Ft: 0, x1Ft: x, yFt: 0 }], front };
};
variants.push(["deck with a bay in the middle of its front, fascia, composite rail, stairs off the bay", { structure: "deck", shape: parts([[7, 9], [10, 12], [7, 9]]), heightIn: 48, rail: { ...base.rail, type: "composite" }, decking: { ...base.decking, fascia: "match" }, stairs: stairs("front", 12, 4) } as Patch]);
variants.push(["deck stepping down to the right in three parts, two-board border, aluminum rail", { structure: "deck", shape: parts([[8, 16], [8, 12], [8, 8]]), heightIn: 36, rail: { ...base.rail, type: "aluminum" }, decking: { ...base.decking, fascia: "match", border: 2 }, stairs: stairs("right", 4, 4) } as Patch]);
variants.push(["U-shaped front on its own posts, flush beams, cedar rail, one-board border", { structure: "deck", placement: "beside", shape: parts([[6, 16], [12, 10], [6, 16]]), heightIn: 60, rail: { ...base.rail, type: "cedar" }, framing: { ...base.framing, beamStyle: "flush" }, decking: { ...base.decking, fascia: "match", border: 1 }, stairs: [] } as Patch]);
variants.push(["a bay and the deck round the right corner, double rim", { structure: "deck", shape: parts([[8, 12], [10, 16], [12, 12]]), heightIn: 96, house: { ...base.house, rightFt: -8, wrapRightFt: 8 }, rail: { ...base.rail, type: "aluminum" }, framing: { ...base.framing, doubleRim: true }, decking: { ...base.decking, fascia: "match" }, stairs: [] } as Patch]);
// CORNERS CUT AT AN ANGLE (2026-11-14): any corner of a front in parts cut at 45° — the joists cut to the angled rim,
// the beam stopping inside the cut (an angled beam under a deep one), the field's boards cut along it, the border
// mitred round it, fascia and rail along it.
const cut = (list: Array<[number, number, number?, number?]>) => {
  let x = 0;
  const front = list.map(([w, y, cl, cr]) => ({ x0Ft: x, x1Ft: (x += w), yFt: y, ...(cl ? { clipLeftFt: cl } : {}), ...(cr ? { clipRightFt: cr } : {}) }));
  return { kind: "wall" as const, widthFt: x, depthFt: Math.max(...list.map((q) => q[1])), back: [{ x0Ft: 0, x1Ft: x, yFt: 0 }], front };
};
variants.push(["a bay with both corners cut at 45°, border, fascia, aluminum rail, stairs off the bay", { structure: "deck", shape: cut([[7, 9], [10, 12, 3, 3], [7, 9]]), heightIn: 48, rail: { ...base.rail, type: "aluminum" }, decking: { ...base.decking, fascia: "match", border: 1 }, stairs: stairs("front", 12, 4) } as Patch]);
variants.push(["one front, a 5-ft cut at the left corner and 2 ft at the right, two-board border, composite rail", { structure: "deck", shape: cut([[24, 14, 5, 2]]), heightIn: 60, rail: { ...base.rail, type: "composite" }, decking: { ...base.decking, fascia: "match", border: 2 }, stairs: [] } as Patch]);
variants.push(["a prow — two cuts meeting in a point — cedar rail, fascia", { structure: "deck", shape: cut([[6, 10], [12, 16, 6, 6], [6, 10]]), heightIn: 36, rail: { ...base.rail, type: "cedar" }, decking: { ...base.decking, fascia: "match" }, stairs: [] } as Patch]);
variants.push(["both ends cut at 45° on a deck round the right corner, double rim, no border", { structure: "deck", shape: cut([[10, 12, 4], [14, 12, 0, 4]]), heightIn: 96, house: { ...base.house, rightFt: -8, wrapRightFt: 8 }, rail: { ...base.rail, type: "aluminum" }, framing: { ...base.framing, doubleRim: true }, decking: { ...base.decking, fascia: "match" }, stairs: [] } as Patch]);
// STEPS THAT WRAP THE DECK ALONG ITS OWN OUTLINE (2026-11-14): each level set out one more run from the deck's edges,
// turning every corner with them — the frames, the risers at outside and inside corners, the mitred treads.
const wrapSteps = (sides: 1 | 3 | 4) => [{ ...stairs("front", 8, 4)[0], wrap: true, wrapSides: sides }];
variants.push(["steps along the front of a bay with cut corners, low deck, fascia", { structure: "deck", shape: cut([[7, 12], [10, 18, 3, 3], [7, 12]]), heightIn: 21, rail: { ...base.rail, type: "none" }, decking: { ...base.decking, fascia: "match" }, stairs: wrapSteps(1) } as Patch]);
variants.push(["steps round three sides of an L, border", { structure: "deck", shape: { kind: "L", widthFt: 24, depthFt: 16, notch: { corner: "front-right", widthFt: 10, depthFt: 6 } }, heightIn: 14, rail: { ...base.rail, type: "none" }, decking: { ...base.decking, fascia: "match", border: 1 }, stairs: wrapSteps(3) } as Patch]);
variants.push(["free-standing deck with two cut corners, steps all the way round", { structure: "deck", placement: "detached", shape: cut([[24, 14, 4, 4]]), heightIn: 20, rail: { ...base.rail, type: "none" }, decking: { ...base.decking, fascia: "match" }, stairs: wrapSteps(4) } as Patch]);
variants.push(["a U-shaped front, steps along the front and both ends, a deck round the right corner", { structure: "deck", shape: parts([[6, 16], [12, 10], [6, 16]]), heightIn: 18, house: { ...base.house, rightFt: -8, wrapRightFt: 8 }, rail: { ...base.rail, type: "none" }, decking: { ...base.decking, fascia: "match" }, stairs: wrapSteps(3) } as Patch]);
// WIDE STEPS ON STRINGERS (2026-11-14): past three risers — the stringers square to every edge, the one along each
// corner's mitre, the sleeper under their feet, the handrail's posts on the treads.
variants.push(["wide steps on stringers round three sides of a rectangle, 36 in. up, aluminum rail", { structure: "deck", shape: rect(24, 12), heightIn: 36, rail: { ...base.rail, type: "aluminum" }, decking: { ...base.decking, fascia: "match" }, stairs: wrapSteps(3) } as Patch]);
variants.push(["wide steps on stringers along the front of a bay with cut corners, 44 in. up, cedar rail", { structure: "deck", shape: cut([[7, 12], [10, 18, 3, 3], [7, 12]]), heightIn: 44, rail: { ...base.rail, type: "cedar" }, decking: { ...base.decking, fascia: "match" }, stairs: wrapSteps(1) } as Patch]);
variants.push(["wide steps on stringers all round a free-standing deck with cut corners, 40 in. up", { structure: "deck", placement: "detached", shape: cut([[24, 14, 4, 4]]), heightIn: 40, rail: { ...base.rail, type: "composite" }, decking: { ...base.decking, fascia: "match" }, stairs: wrapSteps(4) } as Patch]);
variants.push(["wide steps on stringers round an L, 30 in. up, no rail", { structure: "deck", shape: { kind: "L", widthFt: 24, depthFt: 16, notch: { corner: "front-right", widthFt: 10, depthFt: 6 } }, heightIn: 30, rail: { ...base.rail, type: "none" }, stairs: wrapSteps(3) } as Patch]);
// SKIRTING UNDER THE DECK (2026-11-14; lib/deck/skirt): lattice in a border or the deck's boards, in the fascia's
// plane under the rim — bay against bay, round the corners, cut round posts at the edge, under two levels.
const skirted = (kind: "lattice" | "boards") => ({ ...base.extras, skirt: kind });
variants.push(["lattice skirting under a 4-ft deck, fascia, a stair, aluminum rail", { structure: "deck", shape: rect(16, 12), heightIn: 48, rail: { ...base.rail, type: "aluminum" }, decking: { ...base.decking, fascia: "match" }, stairs: stairs("front", 8, 4), extras: skirted("lattice") } as Patch]);
variants.push(["board skirting all round a free-standing deck with cut corners, fascia", { structure: "deck", placement: "detached", shape: cut([[24, 14, 4, 4]]), heightIn: 60, rail: { ...base.rail, type: "composite" }, decking: { ...base.decking, fascia: "match" }, stairs: [], extras: skirted("boards") } as Patch]);
variants.push(["lattice skirting, flush beams (posts at the edge), ground falling away", { structure: "deck", shape: rect(20, 14), heightIn: 36, site: { ...base.site, slope: { outDropIn: 30, acrossDropIn: 12 } }, decking: { ...base.decking, fascia: "match" }, framing: { ...base.framing, beamStyle: "flush" }, stairs: [], extras: skirted("lattice") } as Patch]);
variants.push(["board skirting round an L and its inside corner, no fascia", { structure: "deck", shape: { kind: "L", widthFt: 24, depthFt: 16, notch: { corner: "front-right", widthFt: 10, depthFt: 6 } }, heightIn: 42, decking: { ...base.decking, fascia: "none" }, stairs: [], extras: skirted("boards") } as Patch]);
variants.push(["lattice skirting under a deck and its lower level in front, stair between", { structure: "deck", shape: rect(20, 12), heightIn: 60, lower: { ...base.lower, on: true, place: "front", widthFt: 12, depthFt: 8, dropIn: 21 }, rail: { ...base.rail, type: "aluminum" }, decking: { ...base.decking, fascia: "match" }, stairs: [], extras: skirted("lattice") } as Patch]);
variants.push(["board skirting under a double deck", { structure: "deck", shape: rect(16, 12), heightIn: 156, lower: { ...base.lower, on: true, place: "under", heightIn: 36 }, rail: { ...base.rail, type: "aluminum" }, decking: { ...base.decking, fascia: "match" }, stairs: [], extras: skirted("boards") } as Patch]);
variants.push(["lattice skirting under a deck round the house's corner, wide steps along its front", { structure: "deck", shape: parts([[6, 14], [12, 10], [6, 14]]), heightIn: 40, house: { ...base.house, rightFt: -8, wrapRightFt: 8 }, rail: { ...base.rail, type: "aluminum" }, decking: { ...base.decking, fascia: "match" }, stairs: wrapSteps(1), extras: skirted("lattice") } as Patch]);
// BUILT-IN BENCHES AND PLANTERS (2026-11-14; lib/deck/builtins): boards, aprons, legs and caps of each, beside the
// rail and beside each other.
const builtIn = (kind: "bench" | "bench-back" | "planter" | "screen", side: "front" | "left" | "right", atFt: number, lengthFt: number, id: string) => ({ id, kind, side, atFt, lengthFt });
variants.push(["a bench along the front and planters at its corners, aluminum rail, border", { structure: "deck", shape: rect(24, 14), heightIn: 36, rail: { ...base.rail, type: "aluminum" }, decking: { ...base.decking, fascia: "match", border: 1 }, stairs: [], extras: { ...base.extras, builtIns: [builtIn("planter", "front", 2, 4, "p1"), builtIn("bench", "front", 12, 10, "b1"), builtIn("planter", "front", 22, 4, "p2")] } } as Patch]);
variants.push(["a corner bench with backs (two that meet), cedar rail, a stair", { structure: "deck", shape: rect(20, 12), heightIn: 48, rail: { ...base.rail, type: "cedar" }, decking: { ...base.decking, fascia: "match" }, stairs: stairs("front", 4, 4), extras: { ...base.extras, builtIns: [builtIn("bench-back", "right", 12, 10, "b1"), builtIn("bench-back", "front", 20, 12, "b2")] } } as Patch]);
variants.push(["benches round a low deck with no rail, one along a cut corner, lattice skirting", { structure: "deck", shape: cut([[24, 14, 6, 6]]), heightIn: 20, rail: { ...base.rail, type: "none" }, decking: { ...base.decking, fascia: "match" }, stairs: [], extras: { ...base.extras, skirt: "lattice", builtIns: [builtIn("bench", "left", 4, 8, "b1"), builtIn("bench", "front", 21, 6, "b2"), builtIn("bench", "front", 12, 8, "b3"), builtIn("planter", "right", 4, 6, "p1")] } } as Patch]);
// PRIVACY SCREENS (2026-11-14): on the rail's line in the rail's place — its posts, boards and cap beside the rail's
// own end posts, a bench in front of it, the fascia under it.
variants.push(["a 6-ft privacy screen along the left end with a bench in front, aluminum rail on the rest, fascia", { structure: "deck", shape: rect(20, 12), heightIn: 48, rail: { ...base.rail, type: "aluminum" }, decking: { ...base.decking, fascia: "match" }, stairs: stairs("front", 14, 4), extras: { ...base.extras, builtIns: [{ ...builtIn("screen", "left", 6, 30, "s1"), heightFt: 6 }, builtIn("bench", "left", 6, 8, "b1")] } } as Patch]);
variants.push(["a 4-ft screen in the middle of the front and one on a cut corner, cedar rail, low deck with skirting", { structure: "deck", shape: cut([[24, 14, 6, 0]]), heightIn: 30, rail: { ...base.rail, type: "cedar" }, decking: { ...base.decking, fascia: "match" }, stairs: [], extras: { ...base.extras, skirt: "boards", builtIns: [{ ...builtIn("screen", "front", 14, 8, "s1"), heightFt: 4 }, { ...builtIn("screen", "front", 3, 6, "s2"), heightFt: 5 }] } } as Patch]);
for (const [name, p] of variants) cases.push({ name, design: applyDeckPatch(base, p) });

/**
 * A pair of faces this size or larger flickers where anyone can see it (sq ft; 4 sq in.). What stays under it after the
 * fixes of 2026-10-11 is out of the way: tops under the boards, a bowed front's rim and blocking seen only from below,
 * fasteners inside a hanger, the stair's connectors behind its stringers.
 */
const MAX_VISIBLE = 4 / 144;
/** Flickers with a cause of their own, fixed elsewhere: name the parts, say why. */
const KNOWN: Array<{ parts: RegExp; why: string }> = [];

let bad = 0;
const minor = new Map<string, { n: number; area: number; max: number }>();
const known = new Map<string, number>();
for (const c of cases) {
  const scene = deckScene(buildStructure(c.design));
  const fights = sceneFights(scene);
  const visible = fights.filter((f) => f.area >= MAX_VISIBLE && !KNOWN.some((k) => k.parts.test(`${f.a} ~ ${f.b}`)));
  for (const f of fights) {
    const names = `${f.a.match(/"([^"]+)"/)?.[1] ?? f.a.split(" ")[2]} ~ ${f.b.match(/"([^"]+)"/)?.[1] ?? f.b.split(" ")[2]}`;
    const k = KNOWN.find((kk) => kk.parts.test(`${f.a} ~ ${f.b}`));
    if (k && f.area >= MAX_VISIBLE) {
      known.set(k.why, (known.get(k.why) ?? 0) + 1);
      continue;
    }
    if (f.area >= MAX_VISIBLE) continue;
    const m = minor.get(names) ?? { n: 0, area: 0, max: 0 };
    m.n += 1;
    m.area += f.area;
    m.max = Math.max(m.max, f.area);
    minor.set(names, m);
  }
  if (visible.length) bad++;
  console.log(`${visible.length ? "FAIL" : "ok  "} ${c.name} — ${scene.boxes.length} boxes, ${scene.polys.length} polygons${visible.length ? ` — ${visible.length} pairs flicker where they can be seen` : ""}${fights.length - visible.length ? ` (${fights.length - visible.length} small or known)` : ""}`);
  if (VERBOSE || visible.length) for (const f of (VERBOSE ? fights : visible).slice(0, VERBOSE ? 12 : 6)) console.log(`       ${f.a}\n         ~ ${f.b}  (overlap ${(f.area * 144).toFixed(2)} sq in., ${(f.gapFt * 12).toFixed(3)} in. apart, facing ${f.n.map((x) => x.toFixed(2)).join(",")})`);
}
if (minor.size) {
  console.log(`\nUnder ${(MAX_VISIBLE * 144).toFixed(0)} sq in. (out of the way), by parts, over every case:`);
  for (const [names, m] of [...minor].sort((a, b) => b[1].area - a[1].area).slice(0, 12)) console.log(`  ${names}: ${m.n}, largest ${(m.max * 144).toFixed(2)} sq in.`);
}
for (const [why, n] of known) console.log(`\nKnown, fixed elsewhere: ${n} — ${why}`);
console.log(bad ? `\n${bad} of ${cases.length} cases flicker where it can be seen` : `\nALL PASS — nothing flickers where it can be seen in ${cases.length} cases`);
if (bad) process.exitCode = 1;
