// THE SITE PLAN (2026-10-20) — pure, no React, no network.
//
// Owner: "get the building plans in separate pages — roof, floor and lateral,
// two or three pages, understandable and submittable for the county to
// accept — and also make a site plan." Every county asks for the same site
// plan with a deck permit: the lot and its property lines, the house, the new
// deck where it stands, the distance from the deck to each lot line (the
// zoning setbacks), the street, north, and a scale.
//
// THE FRAME. Feet, X to the right as seen FROM THE STREET, Y from the front
// lot line toward the back of the lot; the street runs along the bottom of
// the drawing. The deck's own drawings (lib/deck/frame, components/…/deck-plan)
// look the other way — standing in the yard, facing the house, x from the
// deck's left end — so a deck point (x, y in inches) on the BACK wall lands at
//   X = rightCorner − houseLeft − x/12,   Y = rearWall + y/12
// on the site: the deck is turned half a circle, never mirrored. On the
// left, right or front wall (SitePlan.deckSide, 2026-10-21) it is turned a
// quarter or not at all — still never mirrored.
//
// THE LOT. Typed (a rectangle, width × depth) until the county's parcel
// record is read (actions/deckSitePlan readDeckLot): then the real outline,
// turned so its street edge lies along the bottom (lotFromRing below), with
// north wherever it really is and the assessor's building footprint for the
// house. Every figure stays the contractor's to type over: the plan is drawn
// from what they confirm.

import type { DeckStructure } from "./structure";
import { structureLevels } from "./structure";
import { HOUSE_BODY_FT, deckPast } from "./house";
import { EMPTY_JURISDICTION, normalizeJurisdiction, type TypedJurisdiction } from "./countyCodes";
import { DEFAULT_SHEET_PREFS, normalizeSheetPrefs, type SheetPrefs } from "./plans/paper";

export type XY = [number, number];

export interface SitePlanLotTyped {
  kind: "typed";
  widthFt: number;
  depthFt: number;
}
export interface SitePlanLotParcel {
  kind: "parcel";
  /** The lot's outline in the site frame (feet), the street edge from (0,0) along +X. */
  ring: XY[];
  /** Where it came from: the parcel cache, ReportAll, Regrid. */
  source: string;
  /** The assessor's parcel number, when the record names one. */
  apn: string | null;
  areaSqFt: number;
}
export type SitePlanLot = SitePlanLotTyped | SitePlanLotParcel;

export interface SitePlan {
  v: 1;
  lot: SitePlanLot;
  house: {
    /** The back wall's length; "auto" = the studio's wall (deck + how far the wall runs past each end). */
    widthFt: number | "auto";
    depthFt: number;
    /** Front wall to the front lot line. */
    frontFt: number;
    /** The house's left side (as seen from the street) to the left lot line. */
    leftFt: number;
    /** The assessor's footprint in the site frame, when the parcel was read. */
    footprint: XY[] | null;
  };
  /** Which wall of the house the deck is on, as seen from the street (2026-10-21; the back unless the contractor says). */
  deckSide: DeckSide;
  /** A deck that stands away from the house: how far from that wall. */
  deckGapFt: number;
  street: string;
  /** Where north points on the sheet, degrees clockwise from straight up. */
  northDeg: number;
  /** The zoning setbacks the deck must keep, typed from the zoning office (null = not checked). */
  setbackRearFt: number | null;
  setbackSideFt: number | null;
  /** The county (or county-equivalent) the lot lies in, who said so — and the city, when the geocoder named one
   *  (a city with its own permit office reads its own figures: lib/deck/countyCodes). */
  county: { name: string; state: string; source: "census" | "parcel" | "typed"; city?: string | null; sdc?: string | null } | null;
  /** The title block's typed lines: the owner of the property, the contractor's licence. */
  owner: string;
  licence: string;
  /** The department's own figures and rules, typed when it is not on file (lib/deck/countyCodes). */
  jurisdiction: TypedJurisdiction;
  /** The sheet size and the smallest scales the department reads (lib/deck/plans/paper). */
  sheets: SheetPrefs;
}

export type DeckSide = "rear" | "left" | "right" | "front";
export const DECK_SIDES: readonly DeckSide[] = ["rear", "left", "right", "front"];
export const DECK_SIDE_LABEL: Record<DeckSide, string> = { rear: "Back", left: "Left side", right: "Right side", front: "Front" };

export const SITE_LIMITS = {
  lotFt: { min: 20, max: 2000 },
  houseFt: { min: 8, max: 300 },
  offsetFt: { min: 0, max: 1000 },
  gapFt: { min: 0, max: 500 },
  setbackFt: { min: 0, max: 200 },
} as const;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const r1 = (n: number) => Math.round(n * 10) / 10;
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** "1840 Meadow Glen Dr, Allen, TX 75002" → "Meadow Glen Dr". */
export function streetFrom(address: string | null | undefined): string {
  const first = (address ?? "").split(",")[0]?.trim() ?? "";
  return first.replace(/^\d+[A-Za-z]?(-\d+)?\s+/, "").replace(/\s+(apt|unit|#)\s*\S+$/i, "").trim().slice(0, 80);
}

/** The back wall's length the studio drew: the deck's width and the wall past each end. */
export function studioWallFt(s: DeckStructure): number {
  const d = s.design;
  return r1(d.house.leftFt + d.shape.widthFt + d.house.rightFt);
}

/** A plan for a job nobody has measured yet: a typical suburban lot around the house the studio drew. */
export function defaultSitePlan(s: DeckStructure, address: string | null): SitePlan {
  const wall = studioWallFt(s);
  const lotW = Math.max(60, Math.ceil((wall + 20) / 5) * 5);
  return {
    v: 1,
    lot: { kind: "typed", widthFt: lotW, depthFt: 130 },
    house: { widthFt: "auto", depthFt: Math.max(HOUSE_BODY_FT, 30), frontFt: 25, leftFt: r1((lotW - wall) / 2), footprint: null },
    deckSide: "rear",
    deckGapFt: s.design.placement === "detached" ? 10 : 0,
    street: streetFrom(address),
    northDeg: 0,
    setbackRearFt: null,
    setbackSideFt: null,
    county: null,
    owner: "",
    licence: "",
    jurisdiction: EMPTY_JURISDICTION,
    sheets: DEFAULT_SHEET_PREFS,
  };
}

const ringOf = (v: unknown, max: number): XY[] =>
  (Array.isArray(v) ? v : [])
    .map((p) => (Array.isArray(p) && p.length >= 2 ? ([num(p[0], NaN), num(p[1], NaN)] as XY) : null))
    .filter((p): p is XY => !!p && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) < max && Math.abs(p[1]) < max)
    .slice(0, 400);

/** The plan with nothing known: what a stored plan falls back to field by field when no deck's default is at hand. */
export const BASE_SITE_PLAN: SitePlan = {
  v: 1,
  lot: { kind: "typed", widthFt: 75, depthFt: 130 },
  house: { widthFt: "auto", depthFt: 30, frontFt: 25, leftFt: 20, footprint: null },
  deckSide: "rear",
  deckGapFt: 0,
  street: "",
  northDeg: 0,
  setbackRearFt: null,
  setbackSideFt: null,
  county: null,
  owner: "",
  licence: "",
  jurisdiction: EMPTY_JURISDICTION,
  sheets: DEFAULT_SHEET_PREFS,
};

/** A plan read back (from storage, from a form): every number held to its limits; anything unreadable falls to the default. */
export function normalizeSitePlan(raw: unknown, fallback: SitePlan = BASE_SITE_PLAN): SitePlan {
  const r = obj(raw);
  if (r.v !== 1) return fallback;
  const lotR = obj(r.lot);
  let lot: SitePlanLot = fallback.lot;
  if (lotR.kind === "parcel") {
    const ring = ringOf(lotR.ring, 5000);
    if (ring.length >= 3) lot = { kind: "parcel", ring, source: str(lotR.source, 20) || "parcel", apn: str(lotR.apn, 60) || null, areaSqFt: Math.round(Math.abs(polygonArea(ring))) };
  } else if (lotR.kind === "typed") {
    lot = { kind: "typed", widthFt: r1(clamp(num(lotR.widthFt, 75), SITE_LIMITS.lotFt.min, SITE_LIMITS.lotFt.max)), depthFt: r1(clamp(num(lotR.depthFt, 130), SITE_LIMITS.lotFt.min, SITE_LIMITS.lotFt.max)) };
  }
  const h = obj(r.house);
  const fp = ringOf(h.footprint, 5000);
  const countyR = obj(r.county);
  const county = str(countyR.name, 60) && /^[A-Z]{2}$/.test(str(countyR.state, 2).toUpperCase())
    ? { name: str(countyR.name, 60), state: str(countyR.state, 2).toUpperCase(), source: (countyR.source === "parcel" || countyR.source === "census" ? countyR.source : "typed") as "census" | "parcel" | "typed", city: str(countyR.city, 60) || null, sdc: str(countyR.sdc, 3).toUpperCase() || null }
    : null;
  const setback = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? r1(clamp(v, SITE_LIMITS.setbackFt.min, SITE_LIMITS.setbackFt.max)) : null);
  return {
    v: 1,
    lot,
    house: {
      widthFt: h.widthFt === "auto" || typeof h.widthFt !== "number" ? "auto" : r1(clamp(h.widthFt, SITE_LIMITS.houseFt.min, SITE_LIMITS.houseFt.max)),
      depthFt: r1(clamp(num(h.depthFt, fallback.house.depthFt), SITE_LIMITS.houseFt.min, SITE_LIMITS.houseFt.max)),
      frontFt: r1(clamp(num(h.frontFt, fallback.house.frontFt), SITE_LIMITS.offsetFt.min, SITE_LIMITS.offsetFt.max)),
      leftFt: r1(clamp(num(h.leftFt, fallback.house.leftFt), SITE_LIMITS.offsetFt.min, SITE_LIMITS.offsetFt.max)),
      footprint: fp.length >= 3 ? fp : null,
    },
    deckSide: DECK_SIDES.includes(r.deckSide as DeckSide) ? (r.deckSide as DeckSide) : fallback.deckSide,
    deckGapFt: r1(clamp(num(r.deckGapFt, fallback.deckGapFt), SITE_LIMITS.gapFt.min, SITE_LIMITS.gapFt.max)),
    street: str(r.street, 80) || fallback.street,
    northDeg: ((Math.round(num(r.northDeg, 0)) % 360) + 360) % 360,
    setbackRearFt: setback(r.setbackRearFt),
    setbackSideFt: setback(r.setbackSideFt),
    county: county ?? fallback.county,
    owner: str(r.owner, 80),
    licence: str(r.licence, 40),
    jurisdiction: normalizeJurisdiction(r.jurisdiction),
    sheets: normalizeSheetPrefs(r.sheets),
  };
}

/* ------------------------------------------------------------------ */
/*  Geometry                                                            */
/* ------------------------------------------------------------------ */

export function polygonArea(ring: readonly XY[]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

/** The shortest distance from a point to a segment. */
export function pointSegmentFt(p: XY, a: XY, b: XY): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const L2 = dx * dx + dy * dy;
  const t = L2 > 0 ? clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2, 0, 1) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/**
 * The county's parcel outline (lat, lng) → the site frame: feet about the
 * lot, turned so the edge nearest the street lies along the bottom from the
 * origin, the lot above it. The street edge is the one nearest `street` — the
 * Census geocoder puts an address on the street's centre line, so the lot
 * edge closest to that point is the frontage; with no street point, the edge
 * nearest the house's own point is taken (the house usually stands nearer the
 * street than the back line) and the sheet says to confirm it. Back come the
 * ring, the turn that put north where it is, and a function for anything else
 * read in the same lat/lng (the building footprints).
 */
export function lotFromRing(
  ring: ReadonlyArray<{ lat: number; lng: number }>,
  street: { lat: number; lng: number } | null,
  house: { lat: number; lng: number } | null,
): { ring: XY[]; northDeg: number; frontEdge: number; frontFromStreet: boolean; toSite: (p: { lat: number; lng: number }) => XY } | null {
  const pts = ring.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  // A closed ring repeats its first point: drop it.
  if (pts.length > 3 && pts[0].lat === pts[pts.length - 1].lat && pts[0].lng === pts[pts.length - 1].lng) pts.pop();
  if (pts.length < 3) return null;
  const lat0 = pts.reduce((a, p) => a + p.lat, 0) / pts.length;
  const lng0 = pts.reduce((a, p) => a + p.lng, 0) / pts.length;
  const FT_LAT = 364000;
  const FT_LNG = FT_LAT * Math.cos((lat0 * Math.PI) / 180);
  const en = (p: { lat: number; lng: number }): XY => [(p.lng - lng0) * FT_LNG, (p.lat - lat0) * FT_LAT];
  let local = pts.map(en);
  // Counter-clockwise, so "inside" is to the left of every edge.
  if (polygonArea(local) < 0) local = local.reverse();
  const ref = street ? en(street) : house ? en(house) : null;
  let front = 0;
  if (ref) {
    let best = Infinity;
    for (let i = 0; i < local.length; i++) {
      const d = pointSegmentFt(ref, local[i], local[(i + 1) % local.length]);
      if (d < best) {
        best = d;
        front = i;
      }
    }
  } else {
    // Nothing to go by: the longest edge (said on the sheet as "confirm the street side").
    let longest = -1;
    for (let i = 0; i < local.length; i++) {
      const [a, b] = [local[i], local[(i + 1) % local.length]];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L > longest) {
        longest = L;
        front = i;
      }
    }
  }
  const A = local[front];
  const B = local[(front + 1) % local.length];
  const theta = Math.atan2(B[1] - A[1], B[0] - A[0]);
  const c = Math.cos(-theta);
  const s = Math.sin(-theta);
  const turn = (p: XY): XY => {
    const x = p[0] - A[0];
    const y = p[1] - A[1];
    return [x * c - y * s, x * s + y * c];
  };
  let out = local.map(turn);
  // Start the ring at the street edge's first corner.
  out = [...out.slice(front), ...out.slice(0, front)];
  // North was +Y before the turn; after it, north points at angle −θ from +Y, clockwise from up on the sheet.
  const northDeg = ((Math.round((-theta * 180) / Math.PI) % 360) + 360) % 360;
  const round = (p: XY): XY => [r1(p[0]), r1(p[1])];
  return { ring: out.map(round), northDeg: (360 - northDeg) % 360, frontEdge: 0, frontFromStreet: !!street, toSite: (p) => round(turn(en(p))) };
}

/** The axis-aligned box of a ring. */
export function boxOf(ring: readonly XY[]): { x0: number; y0: number; x1: number; y1: number } {
  const xs = ring.map((p) => p[0]);
  const ys = ring.map((p) => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/* ------------------------------------------------------------------ */
/*  The layout                                                          */
/* ------------------------------------------------------------------ */

export interface SiteDistance {
  /** Which lot line: the back, the left, the right (as seen from the street), the front. */
  side: "rear" | "left" | "right" | "front";
  ft: number;
  /** From the deck's nearest point to the line's nearest point, for the dimension. */
  from: XY;
  to: XY;
}

export interface SiteCheck {
  id: string;
  level: "ok" | "warn";
  text: string;
}

export interface SiteLayout {
  lot: XY[];
  lotKind: SitePlanLot["kind"];
  /** Each lot edge: its two ends and its length, feet. */
  lotEdges: Array<{ a: XY; b: XY; ft: number; side: SiteDistance["side"] }>;
  house: XY[];
  houseBox: { x0: number; y0: number; x1: number; y1: number };
  houseWallFt: number;
  /** The deck's levels, stairs and roof as outlines in the site frame. */
  deck: XY[][];
  stairs: XY[][];
  roof: XY[] | null;
  /** The deck's own box (levels and stairs), feet. */
  deckBox: { x0: number; y0: number; x1: number; y1: number };
  /** The deck's footprint: width × depth of the main level, and the area of all levels. */
  deckWords: string;
  distances: SiteDistance[];
  /** The house's front wall to the front lot line. */
  houseFrontFt: number;
  checks: SiteCheck[];
  bounds: { x0: number; y0: number; x1: number; y1: number };
}

/** Which way a lot edge faces, by its outward normal in the site frame (the lot counter-clockwise). */
function sideOf(a: XY, b: XY): SiteDistance["side"] {
  // Outward normal of a CCW ring's edge a→b is (dy, −dx).
  const nx = b[1] - a[1];
  const ny = -(b[0] - a[0]);
  if (Math.abs(ny) >= Math.abs(nx)) return ny < 0 ? "front" : "rear";
  return nx < 0 ? "left" : "right";
}

/** Where everything stands on the lot, and how far the deck keeps from each line. */
export function siteLayout(plan: SitePlan, s: DeckStructure): SiteLayout {
  const d = s.design;
  // The lot.
  let lot: XY[];
  if (plan.lot.kind === "parcel") lot = plan.lot.ring.map((p) => [p[0], p[1]] as XY);
  else lot = [[0, 0], [plan.lot.widthFt, 0], [plan.lot.widthFt, plan.lot.depthFt], [0, plan.lot.depthFt]];
  if (polygonArea(lot) < 0) lot = [...lot].reverse();
  const lotEdges = lot.map((a, i) => {
    const b = lot[(i + 1) % lot.length];
    return { a, b, ft: r1(Math.hypot(b[0] - a[0], b[1] - a[1])), side: sideOf(a, b) };
  });

  // The house: the assessor's footprint, or the typed box.
  const wall = plan.house.widthFt === "auto" ? studioWallFt(s) : plan.house.widthFt;
  let house: XY[];
  if (plan.house.footprint && plan.house.footprint.length >= 3) house = plan.house.footprint.map((p) => [p[0], p[1]] as XY);
  else {
    const x0 = plan.house.leftFt;
    const y0 = plan.house.frontFt;
    house = [[x0, y0], [x0 + wall, y0], [x0 + wall, y0 + plan.house.depthFt], [x0, y0 + plan.house.depthFt]];
  }
  const houseBox = boxOf(house);
  const houseWallFt = r1(houseBox.x1 - houseBox.x0);

  // The deck on the wall the contractor picked, turned onto it — never mirrored (see the frame at the top). Standing in
  // that yard, facing the house: x runs from the deck's left end along the wall, y out from it.
  const hb = houseBox;
  const side = plan.deckSide;
  const wallLen = side === "rear" || side === "front" ? hb.x1 - hb.x0 : hb.y1 - hb.y0;
  const gap = d.placement === "detached" ? plan.deckGapFt : 0;
  // The deck stays on the wall even when the assessor's footprint is narrower than the studio's wall. Where it runs
  // PAST a corner of the house (2026-11-14) it stands as far past that corner as the studio drew it: its left end left
  // of the house's left corner, or — only its right end past — its right end beyond the house's right corner.
  const past = deckPast(d.house);
  const leftOffset = past.leftFt > 0 ? -past.leftFt : past.rightFt > 0 ? wallLen + past.rightFt - d.shape.widthFt : clamp(d.house.leftFt, 0, Math.max(0, wallLen - d.shape.widthFt));
  const toSite = (x: number, y: number): XY => {
    const a = leftOffset + x / 12;
    const o = gap + y / 12;
    if (side === "front") return [r1(hb.x0 + a), r1(hb.y0 - o)];
    if (side === "left") return [r1(hb.x0 - o), r1(hb.y1 - a)];
    if (side === "right") return [r1(hb.x1 + o), r1(hb.y0 + a)];
    return [r1(hb.x1 - a), r1(hb.y1 + o)];
  };
  const deck: XY[][] = [];
  for (const lv of structureLevels(s)) {
    for (const z of lv.frame.zones) {
      const x0 = z.zone.x0 + lv.offsetXIn, x1 = z.zone.x1 + lv.offsetXIn, y0 = z.zone.y0 + lv.offsetYIn, y1 = z.zone.y1 + lv.offsetYIn;
      deck.push([toSite(x0, y0), toSite(x1, y0), toSite(x1, y1), toSite(x0, y1)]);
    }
  }
  const stairs = s.stairs.filter((st) => st.footprint.length >= 3).map((st) => st.footprint.map((p) => toSite(p.x, p.y)));
  const roof = s.roof && s.roof.eaveRing.length >= 3 ? s.roof.eaveRing.map((p) => toSite(p.x, p.y)) : null;
  // A structure with no deck under it (a gazebo or a pergola on its own slab) is drawn by its roof.
  if (!deck.length && roof) deck.push(roof);
  const deckPts = [...deck.flat(), ...stairs.flat()];
  const deckBox = deckPts.length ? boxOf(deckPts) : { x0: hb.x1 - 1, y0: hb.y1, x1: hb.x1, y1: hb.y1 + 1 };
  const all = [...deckPts, ...(roof ?? [])];

  // How far the deck keeps from each line: the nearest of its corners to each line that faces that way.
  const distances: SiteDistance[] = [];
  // Only the lines the deck faces: never one with the house standing in between.
  const facing: Record<DeckSide, Array<SiteDistance["side"]>> = { rear: ["rear", "left", "right"], front: ["front", "left", "right"], left: ["left", "rear", "front"], right: ["right", "rear", "front"] };
  for (const side of facing[plan.deckSide]) {
    let best: SiteDistance | null = null;
    for (const e of lotEdges.filter((le) => le.side === side)) {
      for (const p of all) {
        const dist = pointSegmentFt(p, e.a, e.b);
        if (!best || dist < best.ft) {
          const dx = e.b[0] - e.a[0];
          const dy = e.b[1] - e.a[1];
          const L2 = dx * dx + dy * dy;
          const t = L2 > 0 ? clamp(((p[0] - e.a[0]) * dx + (p[1] - e.a[1]) * dy) / L2, 0, 1) : 0;
          best = { side, ft: r1(dist), from: p, to: [r1(e.a[0] + t * dx), r1(e.a[1] + t * dy)] };
        }
      }
    }
    if (best) distances.push(best);
  }
  // The house's front wall to the front line.
  const fronts = lotEdges.filter((e) => e.side === "front");
  const houseFrontFt = fronts.length ? r1(Math.min(...house.flatMap((p) => fronts.map((e) => pointSegmentFt(p, e.a, e.b))))) : r1(houseBox.y0);

  // The checks a zoning reviewer makes.
  const checks: SiteCheck[] = [];
  const inside = (p: XY) => pointInPolygon(p, lot);
  if (all.length && !all.every(inside)) checks.push({ id: "site-outside", level: "warn", text: "Part of the deck falls outside the lot as drawn — check the lot, the house's place on it, or the deck's size." });
  const rearD = distances.find((x) => x.side === "rear");
  if (plan.setbackRearFt != null && rearD) checks.push(rearD.ft + 0.05 >= plan.setbackRearFt ? { id: "site-rear", level: "ok", text: `${rearD.ft} ft to the rear lot line — the zoning setback is ${plan.setbackRearFt} ft.` } : { id: "site-rear", level: "warn", text: `Only ${rearD.ft} ft to the rear lot line; the zoning setback is ${plan.setbackRearFt} ft. A smaller deck, or a variance from the zoning office.` });
  if (plan.setbackSideFt != null) {
    for (const side of ["left", "right"] as const) {
      const sd = distances.find((x) => x.side === side);
      if (!sd) continue;
      checks.push(sd.ft + 0.05 >= plan.setbackSideFt ? { id: `site-${side}`, level: "ok", text: `${sd.ft} ft to the ${side} lot line — the side setback is ${plan.setbackSideFt} ft.` } : { id: `site-${side}`, level: "warn", text: `Only ${sd.ft} ft to the ${side} lot line; the side setback is ${plan.setbackSideFt} ft.` });
    }
  }
  const bounds = boxOf([...lot, ...house, ...all]);
  const main = s.frame ? `${Math.round(d.shape.widthFt * 10) / 10} × ${Math.round(d.shape.depthFt * 10) / 10} ft` : s.roof ? `${Math.round((boxOf(roof ?? deck[0]).x1 - boxOf(roof ?? deck[0]).x0) * 10) / 10} ft across` : "";
  return { lot, lotKind: plan.lot.kind, lotEdges, house, houseBox, houseWallFt, deck, stairs, roof, deckBox, deckWords: main, distances, houseFrontFt, checks, bounds };
}

export function pointInPolygon(p: XY, ring: readonly XY[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi + 1e-12) + xi) inside = !inside;
  }
  // A point on the line counts as inside (a deck may be built to the setback line it is checked against, not across the lot line).
  if (!inside) for (let i = 0; i < ring.length; i++) if (pointSegmentFt(p, ring[i], ring[(i + 1) % ring.length]) < 0.05) return true;
  return inside;
}

/** The engineering scales a site plan is drawn at, feet to the inch — the largest drawing that fits. */
export const SITE_SCALES_FT_PER_IN = [5, 8, 10, 16, 20, 30, 40, 50, 60, 80, 100] as const;
export function siteScale(widthFt: number, heightFt: number, boxIn: { w: number; h: number }): number {
  for (const s of SITE_SCALES_FT_PER_IN) if (widthFt / s <= boxIn.w && heightFt / s <= boxIn.h) return s;
  return SITE_SCALES_FT_PER_IN[SITE_SCALES_FT_PER_IN.length - 1];
}

/**
 * Turn a parcel lot a quarter of its outline: the next edge becomes the
 * street edge (the contractor's fix when the record's street side was read
 * wrong). The footprint and north turn with it.
 */
export function turnLot(plan: SitePlan): SitePlan {
  if (plan.lot.kind !== "parcel" || plan.lot.ring.length < 3) return plan;
  const ring = plan.lot.ring;
  const A = ring[1];
  const B = ring[2 % ring.length];
  const theta = Math.atan2(B[1] - A[1], B[0] - A[0]);
  const c = Math.cos(-theta);
  const s = Math.sin(-theta);
  const turn = (p: XY): XY => {
    const x = p[0] - A[0];
    const y = p[1] - A[1];
    return [r1(x * c - y * s), r1(x * s + y * c)];
  };
  const next = [...ring.slice(1), ring[0]].map(turn);
  const footprint = plan.house.footprint ? plan.house.footprint.map(turn) : null;
  const fb = footprint ? boxOf(footprint) : null;
  const northDeg = ((Math.round(plan.northDeg + (theta * 180) / Math.PI) % 360) + 360) % 360;
  return {
    ...plan,
    lot: { ...plan.lot, ring: next },
    house: fb ? { ...plan.house, footprint, widthFt: r1(fb.x1 - fb.x0), depthFt: r1(fb.y1 - fb.y0), frontFt: r1(fb.y0), leftFt: r1(fb.x0) } : plan.house,
    northDeg,
  };
}
