// A FENCE LAID OUT FROM WORDS (2026-11-05, the AI Operator): "across the backyard
// 20 feet from the house, tied to the property lines on both sides, a gate on
// the right side of the house." Pure geometry in local feet about the address
// pin (x east, y north): the lot ring, the house ring and which side faces the
// street come from the fence estimator's own lookups (lib/fence/boundaryLookup,
// lib/parcels detectFrontSides); this turns the instruction into the fence's
// points, its gates and its lengths, in the words the Operator reads back.
// Left and right are as you stand on the street facing the house.

export interface Pt {
  x: number;
  y: number;
}

/** The site, oriented: `right` runs along the frontage, `back` runs away from the street. */
export interface FenceSite {
  address: string;
  origin: { lat: number; lng: number };
  lot: Pt[];
  house: Pt[] | null;
  neighbors: Pt[][];
  right: Pt;
  back: Pt;
  /** The street the front side faces, when one was found. */
  street: string | null;
  frontKnown: boolean;
}

export interface FenceSpec {
  /** The rear run: feet out from the back of the house, or on the rear lot line. */
  rear: { offsetFt: number | null; onLotLine: boolean };
  gates: Array<{ where: "left" | "right" | "rear"; widthFt: number | null }>;
}

export interface FenceLayoutOut {
  /** The fence as one line from the house's left rear corner around to its right rear corner. */
  points: Pt[];
  gates: Array<{ segmentIndex: number; t: number; widthFt: number; kind: "gate"; label: string; x: number; y: number }>;
  totalLf: number;
  corners: number;
  /** Each piece in words: "rear run 62 ft, 20 ft out from the house". */
  words: string[];
}

const dot = (a: Pt, b: Pt) => a.x * b.x + a.y * b.y;
const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k });
const len = (a: Pt) => Math.hypot(a.x, a.y);
const norm = (a: Pt): Pt => {
  const l = len(a) || 1;
  return { x: a.x / l, y: a.y / l };
};
const dist = (a: Pt, b: Pt) => len(sub(a, b));

export function centroid(ring: Pt[]): Pt {
  if (!ring.length) return { x: 0, y: 0 };
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    const f = p.x * q.y - q.x * p.y;
    a += f;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  if (Math.abs(a) < 1e-9) return { x: ring.reduce((s, p) => s + p.x, 0) / ring.length, y: ring.reduce((s, p) => s + p.y, 0) / ring.length };
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

export function pointInPolygon(p: Pt, ring: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** The house: the building the pin is in, else the nearest to it. */
export function pickHouse(buildings: Pt[][], pin: Pt): Pt[] | null {
  const inside = buildings.find((b) => pointInPolygon(pin, b));
  if (inside) return inside;
  let best: Pt[] | null = null;
  let bestD = Infinity;
  for (const b of buildings) {
    const d = dist(centroid(b), pin);
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  return best && bestD <= 150 ? best : null;
}

/** Orientation from the lot's front side (a lot edge, by its endpoints): `back` points from that edge into the
 *  lot, `right` is to the right as you face the house from the street. Without a known front, south is assumed. */
export function orient(lot: Pt[], front: { a: Pt; b: Pt } | null): { right: Pt; back: Pt } {
  if (!front) return { right: { x: 1, y: 0 }, back: { x: 0, y: 1 } };
  const c = centroid(lot);
  const mid = mul(add(front.a, front.b), 0.5);
  const along = norm(sub(front.b, front.a));
  // The inward normal: the one that points toward the lot's middle.
  let back: Pt = { x: -along.y, y: along.x };
  if (dot(back, sub(c, mid)) < 0) back = mul(back, -1);
  // Facing `back` (into the lot), the right hand is 90° clockwise of it.
  const right: Pt = { x: back.y, y: -back.x };
  return { right, back };
}

/** Where the line through `p` along `dir` crosses the polygon's edges, as distances along `dir` from `p`. */
function crossings(ring: Pt[], p: Pt, dir: Pt): number[] {
  const out: number[] = [];
  const n: Pt = { x: -dir.y, y: dir.x };
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const da = dot(sub(a, p), n);
    const db = dot(sub(b, p), n);
    if (da === db) continue;
    if ((da <= 0 && db > 0) || (da > 0 && db <= 0)) {
      const t = da / (da - db);
      const x = add(a, mul(sub(b, a), t));
      out.push(dot(sub(x, p), dir));
    }
  }
  return out.sort((u, v) => u - v);
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** The fence: a U from the house's left rear corner, out to the left lot line, back to the rear run, across, up the
 *  right lot line, and in to the house's right rear corner. Null when the lot or the house can't carry it. */
export function layoutFence(site: FenceSite, spec: FenceSpec): FenceLayoutOut | { error: string } {
  if (!site.house) return { error: "I can't see the house on this lot, so I can't place the fence from the house. Tell me the lengths instead." };
  const { right, back } = site;
  const o = centroid(site.house);
  const u = (p: Pt) => dot(sub(p, o), right);
  const v = (p: Pt) => dot(sub(p, o), back);
  const at = (uu: number, vv: number): Pt => add(o, add(mul(right, uu), mul(back, vv)));
  const hu = site.house.map(u);
  const hv = site.house.map(v);
  const uMin = Math.min(...hu);
  const uMax = Math.max(...hu);
  const vBack = Math.max(...hv);
  // The lot's reach behind the house, along the house's middle.
  const behind = crossings(site.lot, at(0, vBack), back).filter((d) => d > 0.5);
  const rearLot = behind.length ? behind[0] : null;
  if (rearLot === null) return { error: "The house sits on the rear lot line here; there's no backyard to fence." };
  let offset = spec.rear.onLotLine ? rearLot : (spec.rear.offsetFt ?? 20);
  if (offset > rearLot) offset = rearLot;
  if (offset < 3) return { error: "The rear run has to be at least 3 ft out from the house." };
  const vRear = vBack + offset;
  // The returns at the house's back wall, and the rear run: each line clipped to the lot. A run ON the rear lot
  // line would lie along that edge and cross nothing, so its reach is read a hair inside and the run drawn on the line.
  const onLine = offset >= rearLot - 0.01;
  const wall = crossings(site.lot, at(0, vBack), right);
  const rear = crossings(site.lot, at(0, onLine ? vRear - 0.5 : vRear), right);
  const leftWall = wall.filter((d) => d < uMin);
  const rightWall = wall.filter((d) => d > uMax);
  if (!leftWall.length || !rightWall.length || rear.length < 2) return { error: "I couldn't find the lot lines beside the house. Tell me the lengths instead." };
  const uL = Math.max(...leftWall);
  const uR = Math.min(...rightWall);
  const uLr = rear[0];
  const uRr = rear[rear.length - 1];
  const pts: Pt[] = [at(uMin, vBack), at(uL, vBack), at(uLr, vRear), at(uRr, vRear), at(uR, vBack), at(uMax, vBack)];
  const seg = (i: number) => dist(pts[i], pts[i + 1]);
  const lengths = [0, 1, 2, 3, 4].map(seg);
  const totalLf = lengths.reduce((a, b) => a + b, 0);
  const gates = spec.gates.map((g) => {
    const i = g.where === "left" ? 0 : g.where === "right" ? 4 : 2;
    const widthFt = g.widthFt ?? 4;
    const t = g.where === "rear" ? 0.5 : i === 0 ? 0.5 : 0.5;
    const p = add(pts[i], mul(sub(pts[i + 1], pts[i]), t));
    return { segmentIndex: i, t, widthFt, kind: "gate" as const, label: `${widthFt}-ft gate, ${g.where === "rear" ? "rear run" : `${g.where} side by the house`}`, x: p.x, y: p.y };
  });
  const words = [
    `rear run ${Math.round(lengths[2])} ft, ${spec.rear.onLotLine ? "on the rear lot line" : `${r1(offset)} ft out from the back of the house`}`,
    `left side ${Math.round(lengths[0] + lengths[1])} ft and right side ${Math.round(lengths[3] + lengths[4])} ft, from the house to the lot lines and back`,
    ...gates.map((g) => g.label),
  ];
  return { points: pts.map((p) => ({ x: r1(p.x), y: r1(p.y) })), gates: gates.map((g) => ({ ...g, x: r1(g.x), y: r1(g.y) })), totalLf: Math.round(totalLf * 10) / 10, corners: 4, words };
}

/** Lot and house sizes in words for the site line: "lot 60 × 120 ft, house 32 × 44 ft". */
export function siteWords(site: FenceSite): { lot: string; house: string | null; backyardFt: number | null } {
  const span = (ring: Pt[]) => {
    const us = ring.map((p) => dot(p, site.right));
    const vs = ring.map((p) => dot(p, site.back));
    return { w: Math.round(Math.max(...us) - Math.min(...us)), d: Math.round(Math.max(...vs) - Math.min(...vs)) };
  };
  const l = span(site.lot);
  const h = site.house ? span(site.house) : null;
  let backyardFt: number | null = null;
  if (site.house) {
    const o = centroid(site.house);
    const vBack = Math.max(...site.house.map((p) => dot(sub(p, o), site.back)));
    const behind = crossings(site.lot, add(o, mul(site.back, vBack)), site.back).filter((d) => d > 0.5);
    backyardFt = behind.length ? Math.round(behind[0]) : null;
  }
  return { lot: `${l.w} × ${l.d} ft`, house: h ? `${h.w} × ${h.d} ft` : null, backyardFt };
}
