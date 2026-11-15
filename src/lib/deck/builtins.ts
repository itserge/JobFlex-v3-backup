// BUILT-IN BENCHES AND PLANTER BOXES (2026-11-14) — pure.
//
// The owner asked for "more options to build luxury". What sets a finished deck apart from a platform is what is
// built INTO it: a bench along the edge, a bench with a back, a planter box at a corner — in the deck's own boards.
// The studio could not draw them: said out loud each became a blank line of the contractor's own.
//
// Where one goes: along ONE straight edge of the deck — the front (any part of it, a corner cut at an angle too), the
// left end or the right end — at a place along it, a length long. It stands on the boards just inside the edge: clear
// of a railing's posts where there is a railing, at the edge where there is none. It is kept on its edge (shortened
// where it would run past a corner) and stops at the face of one already built (so two benches asked to the same
// corner meet there); what it runs into is said, not hidden: a stair's top, wide steps.
//
// How each is built (and counted):
//   · A BENCH — the seat 18 in. above the boards, three deck boards deep, on supports no more than 4 ft apart: two
//     4x4 legs under a 2x4 cleat each, a fascia apron all round under the seat's edge. Blocking between the joists
//     under every support.
//   · A BENCH WITH A BACK — the same seat in front of a row of 4x4 posts 36 in. tall, two deck boards across them and
//     a cap board on top.
//   · A PLANTER BOX — 20 in. deep, three boards high on a treated 2x4 frame, a cap board all round its rim. What it
//     weighs full of wet soil is worked out and said: far more per square foot than a deck is framed for, so where it
//     stands matters (over a beam line, or on doubled joists).
import { ringEdges } from "./ringEdges";
import { normalizeFinish, type PartFinish } from "./finish";

export type BuiltInKind = "bench" | "bench-back" | "planter" | "screen" | "kitchen" | "fire";
export const BUILT_IN_KINDS: readonly BuiltInKind[] = ["bench", "bench-back", "planter", "screen", "kitchen", "fire"];
export const BUILT_IN_LABEL: Record<BuiltInKind, string> = { bench: "Bench", "bench-back": "Bench with a back", planter: "Planter box", screen: "Privacy screen", kitchen: "Outdoor kitchen", fire: "Fire table" };
export type BuiltInSide = "front" | "left" | "right";
export const BUILT_IN_SIDES: readonly BuiltInSide[] = ["front", "left", "right"];
/**
 * THE ACCESSORIES IN GROUPS (2026-11-14 — the owner: "make separate accessories, that way it will be understandable").
 * The studio's Accessories step shows each group under its own heading with its own buttons, and the checks head each
 * accessory with its group.
 */
export type AccessoryGroup = "seating" | "privacy" | "kitchen";
export const ACCESSORY_GROUPS: readonly AccessoryGroup[] = ["seating", "privacy", "kitchen"];
export const ACCESSORY_GROUP_LABEL: Record<AccessoryGroup, string> = { seating: "Seating and planters", privacy: "Privacy screen", kitchen: "Outdoor kitchen and fire" };
export const ACCESSORY_GROUP_KINDS: Record<AccessoryGroup, readonly BuiltInKind[]> = { seating: ["bench", "bench-back", "planter"], privacy: ["screen"], kitchen: ["kitchen", "fire"] };
export function accessoryGroupOf(kind: BuiltInKind): AccessoryGroup {
  return kind === "screen" ? "privacy" : kind === "kitchen" || kind === "fire" ? "kitchen" : "seating";
}
export const BUILT_IN_SIDE_LABEL: Record<BuiltInSide, string> = { front: "Front", left: "Left end", right: "Right end" };

/** One built-in: along `side`, centred `atFt` along it (a front: from the deck's left end; an end: out from the house line), `lengthFt` long. */
export interface BuiltIn {
  id: string;
  kind: BuiltInKind;
  side: BuiltInSide;
  atFt: number;
  lengthFt: number;
  /** A privacy screen's height above the boards, ft (screens only). */
  heightFt?: number;
  /** A fire table: how far in from that edge its middle stands, ft (fire tables only). */
  inFt?: number;
  /**
   * PLACED BY HAND (2026-11-14; lib/deck/accessories): its middle on the plan (inches from the deck's left end and the
   * house line) and its turn (degrees: 0 = its length along the house, its front toward the house). Set, it stands
   * there instead of along `side`. Never on a privacy screen — that stands in the railing's place.
   */
  spot?: { x: number; y: number; turnDeg: number };
  /** BOARDS OF ITS OWN (2026-11-14; lib/deck/finish): its seat, back, sides, caps and apron in a line and colour of their own. Absent = the deck's own. */
  finish?: PartFinish;
}

export const BUILT_IN_LIMITS = { count: 8, lengthFt: { min: 2, max: 30 }, planterFt: { min: 2, max: 10 }, screenFt: { min: 3, max: 8 }, kitchenFt: { min: 4, max: 16 }, fireFt: { min: 2.5, max: 6 }, inFt: { min: 2, max: 30 } } as const;
/**
 * AN OUTDOOR KITCHEN AND A FIRE TABLE (2026-11-14 — the owner picked them next of the luxury options). Two things a
 * high-end deck has that the studio could only note as a blank item: a grill island, and a gas fire table.
 *   · THE KITCHEN is an island along an edge: 30 in. deep and 36 in. high, framed in treated 2x4 and clad in the
 *     deck's boards, with a top for stone and a place for a built-in grill (the top, the grill, gas and power are by
 *     others). What it weighs with a stone top and a grill is worked out, and the joists under it are doubled.
 *   · THE FIRE TABLE is a listed gas appliance (by others), drawn where it will stand — a place along an edge and a
 *     distance in from it — so what stands near it and over it can be measured: the studio builds nothing for it.
 * What burns near either one is the checks' business (lib/deck/checks): `hot` is the part that burns.
 */
export const KITCHEN_DEPTH_IN = 30;
export const KITCHEN_HEIGHT_IN = 36;
export const KITCHEN_TOP_IN = 2;
/** A stone top, lb per sq ft; the island's frame and cladding, lb per ft; a built-in grill and what is kept round it, lb. */
export const KITCHEN_TOP_PSF = 20;
export const KITCHEN_CARCASS_LB_PER_FT = 20;
export const KITCHEN_GRILL_LB = 250;
export const FIRE_HEIGHT_IN = 24;
/** A gas fire table: about this heavy at 4 ft, and this much more a foot. */
export const FIRE_LB = 300;
export const FIRE_LB_PER_FT = 40;
/** The clear landing the code asks at the top of a stair, in. (IRC R311.7.6): an accessory placed by hand keeps out of it. */
export const STAIR_LANDING_IN = 36;
/** What most makers ask between a flame and anything that burns, in.: beside a gas fire table or a grill; over a fire table. */
export const HOT_CLEAR_IN = 36;
export const HOT_OVERHEAD_IN = 96;
/** A privacy screen as most are built: 6 ft above the boards. */
export const SCREEN_DEFAULT_FT = 6;
/** Its posts: no farther apart than this; 4x4 up to this height, 6x6 above it; how far their outer face stands inside the deck's edge (a top-mounted rail post's own line). */
export const SCREEN_POST_MAX_IN = 72;
export const SCREEN_4X4_MAX_IN = 48;
export const SCREEN_EDGE_IN = 1;
/** How far short of a corner that turns round the deck it stops (the next edge's rail has its corner post there), and how far the rail keeps off its ends. */
export const SCREEN_CORNER_IN = 8;
export const SCREEN_RAIL_CLEAR_IN = 5;
/** The gap between its boards, in.; the wind a screen is figured for, lb per sq ft (a 115-mph design wind in open suburban terrain, on a solid-faced fence). */
export const SCREEN_GAP_IN = 0.75;
export const SCREEN_WIND_PSF = 20;

/** Seat height above the boards, a bench back's height, a planter's depth front to back, in. */
export const BENCH_SEAT_IN = 18;
export const BENCH_BACK_IN = 36;
export const PLANTER_DEPTH_IN = 20;
/** Supports under a bench no farther apart than this, and how far in from its ends the first stands. */
export const BENCH_SUPPORT_MAX_IN = 48;
export const BENCH_END_IN = 4;
/** How far inside the deck's edge a built-in stands: clear of a top-mounted rail's posts, of a side-mounted rail, of nothing — or of a privacy screen standing there (its 6x6 posts and boards). */
export const BUILT_IN_INSET_IN = { top: 6, side: 2.5, none: 1.5, screen: 8.5 } as const;
/** Wet planting soil, lb per cubic foot; how deep it lies in a planter, in. */
export const SOIL_LB_PER_CUFT = 100;
export const PLANTER_SOIL_IN = 14;

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const half = (v: number) => Math.round(v * 2) / 2;

/** A built-in a contractor would add first: a bench in the middle of the front, a planter at a front corner. */
export function defaultBuiltIn(id: string, kind: BuiltInKind, widthFt: number): BuiltIn {
  if (kind === "planter") return { id, kind, side: "front", atFt: half(Math.min(widthFt / 2, 3)), lengthFt: 4 };
  // (A screen goes where the neighbours are: along an end, its whole length unless said.)
  if (kind === "screen") return { id, kind, side: "left", atFt: 0, lengthFt: 8, heightFt: SCREEN_DEFAULT_FT };
  // (A kitchen toward the right of the front, away from the door; a fire table out in the middle.)
  if (kind === "kitchen") return { id, kind, side: "front", atFt: half(Math.max(widthFt / 2, widthFt - 5)), lengthFt: Math.min(8, Math.max(BUILT_IN_LIMITS.kitchenFt.min, half(widthFt - 4))) };
  if (kind === "fire") return { id, kind, side: "front", atFt: half(widthFt / 2), lengthFt: 4, inFt: 6 };
  return { id, kind, side: "front", atFt: half(widthFt / 2), lengthFt: Math.min(8, Math.max(BUILT_IN_LIMITS.lengthFt.min, half(widthFt - 4))) };
}

/** A spot placed by hand, read back: on the plan, to the half inch, turned to the degree — none on a privacy screen. */
function spotOf(raw: unknown, kind: BuiltInKind): { spot: NonNullable<BuiltIn["spot"]> } | null {
  if (kind === "screen" || !raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.x !== "number" || typeof o.y !== "number" || !Number.isFinite(o.x) || !Number.isFinite(o.y)) return null;
  const t = typeof o.turnDeg === "number" && Number.isFinite(o.turnDeg) ? o.turnDeg : 0;
  return { spot: { x: half(clamp(o.x, -480, 960)), y: half(clamp(o.y, -480, 960)), turnDeg: ((Math.round(t) % 360) + 360) % 360 } };
}

/** The list read back: eight at most, each with a name of its own, a kind, a side, a place and a length inside the limits. */
export function normalizeBuiltIns(raw: unknown, widthFt: number, depthFt: number): BuiltIn[] {
  const out: BuiltIn[] = [];
  const seen = new Set<string>();
  (Array.isArray(raw) ? raw : []).slice(0, BUILT_IN_LIMITS.count * 3).forEach((v, i) => {
    if (out.length >= BUILT_IN_LIMITS.count || !v || typeof v !== "object" || Array.isArray(v)) return;
    const o = v as Record<string, unknown>;
    const kind = BUILT_IN_KINDS.find((k) => k === o.kind);
    if (!kind) return;
    const side = BUILT_IN_SIDES.find((k) => k === o.side) ?? "front";
    let id = typeof o.id === "string" && /^[a-z0-9-]{1,14}$/.test(o.id) && !seen.has(o.id) ? o.id : "";
    for (let n = i + 1; !id; n++) if (!seen.has(`b${n}`)) id = `b${n}`;
    seen.add(id);
    const along = side === "front" ? widthFt : depthFt;
    const lim = kind === "planter" ? { min: BUILT_IN_LIMITS.lengthFt.min, max: BUILT_IN_LIMITS.planterFt.max } : kind === "kitchen" ? BUILT_IN_LIMITS.kitchenFt : kind === "fire" ? BUILT_IN_LIMITS.fireFt : BUILT_IN_LIMITS.lengthFt;
    out.push({
      id,
      kind,
      side,
      atFt: half(clamp(num(o.atFt, along / 2), 0, along)),
      lengthFt: half(clamp(num(o.lengthFt, kind === "planter" || kind === "fire" ? 4 : 8), lim.min, lim.max)),
      ...(kind === "screen" ? { heightFt: half(clamp(num(o.heightFt, SCREEN_DEFAULT_FT), BUILT_IN_LIMITS.screenFt.min, BUILT_IN_LIMITS.screenFt.max)) } : {}),
      ...(kind === "fire" ? { inFt: half(clamp(num(o.inFt, 6), BUILT_IN_LIMITS.inFt.min, BUILT_IN_LIMITS.inFt.max)) } : {}),
      ...(spotOf(o.spot, kind) ?? {}),
      // (Boards of its own — lib/deck/finish — on a bench, a planter or a screen: a kitchen island is clad in the deck's
      // own boards, and a fire table has none.)
      ...(kind !== "kitchen" && kind !== "fire" && normalizeFinish(o.finish) ? { finish: normalizeFinish(o.finish)! } : {}),
    });
  });
  return out;
}

export type BuiltInRole = "bench leg" | "bench cleat" | "bench seat" | "bench apron" | "bench back post" | "bench back" | "bench cap" | "planter board" | "planter cap" | "planter soil" | "screen post" | "screen board" | "screen cap" | "kitchen board" | "kitchen top" | "kitchen grill" | "fire base" | "fire top" | "fire burner";

/** One stick or board of a built-in: a box `sx` long along `yaw`, `sy` across, `sz` high, centred at (cx, cy, cz) — plan inches, z above the house-line ground. */
export interface BuiltInMember {
  role: BuiltInRole;
  nominal: string;
  lengthIn: number;
  cx: number;
  cy: number;
  cz: number;
  sx: number;
  sy: number;
  sz: number;
  yaw: number;
  of: string;
}

export interface BuiltInBuild {
  design: BuiltIn;
  kind: BuiltInKind;
  /** Built: false when its edge has no room for it (then `members` is empty and `why` says so). */
  built: boolean;
  why?: string;
  /** Its footprint on the boards, plan in.: the four corners in order. */
  footprint: Array<{ x: number; y: number }>;
  lengthIn: number;
  depthIn: number;
  /** Its top above the boards, in. */
  heightIn: number;
  members: BuiltInMember[];
  /** Counted: deck boards (seat, back, a planter's sides and cap), fascia (a bench's apron), 4x4, 2x4, all in feet; supports under a bench. */
  boardLf: number;
  apronLf: number;
  postLf: number;
  frameLf: number;
  supports: number;
  /** A planter: the soil it holds, cu ft; its weight full and wet, lb; that weight over its footprint, psf; a beam line under or beside it. */
  soilCuFt: number;
  weightLb: number;
  psf: number;
  overBeam: boolean;
  /** A screen: its posts and their size, its face in sq ft, the wind on one post (lb, at SCREEN_WIND_PSF) and that wind's turning moment where the post meets the deck (ft-lb). */
  posts: number;
  postSize: "4x4" | "6x6" | "";
  sqFt: number;
  windLb: number;
  windFtLb: number;
  /** A kitchen or a fire table: the part that burns (the grill; the whole table), its four corners in plan — empty for the rest. */
  hot: Array<{ x: number; y: number }>;
  /** A kitchen: the joists under it that are doubled, and their feet. */
  sisters: number;
  sisterLf: number;
  /** What it was fitted to, or runs into. */
  flags: { shortened: boolean; /** Shortened to stop at another built-in's face. */ beside: boolean; onStair: boolean; onSteps: boolean; overlaps: string[] };
}

export interface BuiltInsInput {
  items: readonly BuiltIn[];
  /** The deck's outline as its sides in order round it (the rail's own), the house's marked. */
  sides: ReadonlyArray<{ x0: number; y0: number; x1: number; y1: number; house: boolean; side: "front" | "back" | "left" | "right" }>;
  /** The walking surface above the house-line ground, in. */
  surfaceIn: number;
  /** The deck's boards: their face, thickness and the gap between two, in.; and how they are sold ("5/4x6"). */
  board: { widthIn: number; thickIn: number; gapIn: number; nominal: string };
  /** How the rail stands along a stretch of edge, if one does. */
  railAt: (x0: number, y0: number, x1: number, y1: number) => "top" | "side" | "none" | "screen";
  /** Stretches of edge a stair's top stands on, and stretches wide steps run along. */
  stairTops: ReadonlyArray<{ x0: number; y0: number; x1: number; y1: number }>;
  wrapped: ReadonlyArray<{ x0: number; y0: number; x1: number; y1: number }>;
  /** The beams' lines under the deck (plan in.), for a planter's weight. */
  beams: ReadonlyArray<{ x0: number; y0: number; x1: number; y1: number }>;
  /** Which of the list to build: the privacy screens (they stand on the rail's line, so they are set before the rail is), or the rest (set inside the rail). Default: the rest. */
  only?: "screens" | "rest";
  /** The joists' depth, in. (a screen's posts run down beside them). */
  joistDepthIn?: number;
  /** The deck's joists (not the sisters already beside some): where each runs, for the ones a kitchen's weight doubles. */
  joists?: ReadonlyArray<{ x: number; y0: number; y1: number }>;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Every built-in, set on its edge and built. */
export function buildBuiltIns(input: BuiltInsInput): BuiltInBuild[] {
  const { sides, surfaceIn: S, board } = input;
  if (!input.items.length || sides.length < 3) return [];
  const edges = ringEdges(sides.map((sd) => ({ x: sd.x0, y: sd.y0 })));
  const n = sides.length;
  const T = board.thickIn;
  const W = board.widthIn;
  const G = board.gapIn;
  const seatDepth = 3 * W + 2 * G;
  const out: BuiltInBuild[] = [];
  const ring = sides.map((sd) => ({ x: sd.x0, y: sd.y0 }));
  const inRing = (p: { x: number; y: number }) => {
    let c = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i];
      const b = ring[j];
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
    }
    return c;
  };
  const empty = (it: BuiltIn, why: string): BuiltInBuild => ({ design: it, kind: it.kind, built: false, why, footprint: [], lengthIn: 0, depthIn: 0, heightIn: 0, members: [], boardLf: 0, apronLf: 0, postLf: 0, frameLf: 0, supports: 0, soilCuFt: 0, weightLb: 0, psf: 0, overBeam: false, posts: 0, postSize: "", sqFt: 0, windLb: 0, windFtLb: 0, hot: [], sisters: 0, sisterLf: 0, flags: { shortened: false, beside: false, onStair: false, onSteps: false, overlaps: [] } });

  for (const it of input.items) {
    if ((it.kind === "screen") !== (input.only === "screens")) continue;
    const screen = it.kind === "screen";
    const screenH = (it.heightFt ?? SCREEN_DEFAULT_FT) * 12;
    const postSize: "4x4" | "6x6" = screenH <= SCREEN_4X4_MAX_IN ? "4x4" : "6x6";
    const postIn = postSize === "4x4" ? 3.5 : 5.5;
    const fire = it.kind === "fire";
    // (A fire table is square up to 3½ ft, 2 ft deep when longer.)
    const fireDepth = it.lengthFt * 12 <= 42 ? it.lengthFt * 12 : 24;
    const depth = screen ? postIn + T : fire ? fireDepth : it.kind === "kitchen" ? KITCHEN_DEPTH_IN : it.kind === "planter" ? PLANTER_DEPTH_IN : it.kind === "bench-back" ? seatDepth + 3.5 : seatDepth;
    /** A point of it: `a` along its length from its start, `b` in from its back line toward its front. */
    let P: (a: number, b: number) => { x: number; y: number };
    let yawNow: number;
    let a0: number;
    let a1: number;
    let len: number;
    let shortened = false;
    let beside = false;
    let onStair = false;
    let onSteps = false;
    const spot = screen ? undefined : it.spot;
    if (spot) {
      // PLACED BY HAND: its middle where it was put, turned as it was turned. All of it on the deck, clear of every open
      // edge by what stands there (the railing's posts, a privacy screen), a half inch off the house; out of a stair's
      // top landing.
      const t = (spot.turnDeg * Math.PI) / 180;
      const u = { x: Math.cos(t), y: Math.sin(t) };
      const v = { x: -Math.sin(t), y: Math.cos(t) };
      len = it.lengthFt * 12;
      a0 = 0;
      a1 = len;
      yawNow = t;
      const L = len;
      P = (a, b) => ({ x: spot.x + u.x * (a - L / 2) + v.x * (b - depth / 2), y: spot.y + u.y * (a - L / 2) + v.y * (b - depth / 2) });
      const fp = [P(0, 0), P(len, 0), P(len, depth), P(0, depth)];
      const clearOf = (sd: (typeof sides)[number]) => (sd.house ? 0.5 : BUILT_IN_INSET_IN[input.railAt(sd.x0, sd.y0, sd.x1, sd.y1)]);
      const seg = (g: { x0: number; y0: number; x1: number; y1: number }) => [{ x: g.x0, y: g.y0 }, { x: g.x1, y: g.y1 }];
      const fits = inRing(spot) && fp.every((q) => inRing({ x: q.x + (spot.x - q.x) * 0.002, y: q.y + (spot.y - q.y) * 0.002 })) && sides.every((sd) => planGap(fp, seg(sd)) >= clearOf(sd) - 0.01);
      if (!fits) {
        out.push(empty(it, "where it was put it would stand off the deck or in the railing's way"));
        continue;
      }
      onStair = input.stairTops.some((g) => planGap(fp, seg(g)) < STAIR_LANDING_IN - 0.01);
      onSteps = input.wrapped.some((g) => planGap(fp, seg(g)) < 12);
    } else {
    const at = it.atFt * 12;
    // 1. Its edge: the open side of that name the place lies along — the outermost, where there are several.
    let pick = -1;
    let best = -Infinity;
    let pickT = 0;
    sides.forEach((sd, i) => {
      if (sd.house || sd.side !== it.side || edges[i].length < 24) return;
      const horizontal = it.side === "front";
      const a0 = horizontal ? sd.x0 : sd.y0;
      const a1 = horizontal ? sd.x1 : sd.y1;
      if (Math.abs(a1 - a0) < 1) return;
      const t = clamp((at - a0) / (a1 - a0), 0, 1);
      const inside = at >= Math.min(a0, a1) - 0.5 && at <= Math.max(a0, a1) + 0.5;
      const px = sd.x0 + (sd.x1 - sd.x0) * t;
      const py = sd.y0 + (sd.y1 - sd.y0) * t;
      // (Outermost: the farthest out for a front, the farthest left or right for an end; one the place lies on first.)
      const reach = (it.side === "front" ? py : it.side === "left" ? -px : px) + (inside ? 1e6 : -Math.abs(at - clamp(at, Math.min(a0, a1), Math.max(a0, a1))));
      if (reach > best) {
        best = reach;
        pick = i;
        pickT = t * edges[i].length;
      }
    });
    if (pick < 0) {
      out.push(empty(it, "no open edge on that side"));
      continue;
    }
    const sd = sides[pick];
    const e = edges[pick];
    const inX = -e.outX;
    const inY = -e.outY;
    const mount = input.railAt(sd.x0, sd.y0, sd.x1, sd.y1);
    // (A screen stands on the rail's own line, in the rail's place; the rest stand inside whatever is there; a fire
    // table out on the deck, its middle `inFt` from the edge.)
    const inset = screen ? SCREEN_EDGE_IN : fire ? Math.max(BUILT_IN_INSET_IN[mount] + 12, (it.inFt ?? 6) * 12 - depth / 2) : BUILT_IN_INSET_IN[mount];
    // 2. Kept on its edge: clear of the next edge's own rail (or of what stands along it) at a corner that turns round the deck.
    const prev = edges[(pick - 1 + n) % n];
    const cornerIn = screen ? SCREEN_CORNER_IN : fire ? BUILT_IN_INSET_IN[mount] + 12 : inset;
    // (Against the house there is no rail to keep clear of: it runs up to the wall.)
    const lo = prev.turnAtB > 0.3 && !sides[(pick - 1 + n) % n].house ? cornerIn : 0.5;
    const hi = e.length - (e.turnAtB > 0.3 && !sides[(pick + 1) % n].house ? cornerIn : 0.5);
    const want = it.lengthFt * 12;
    const room = hi - lo;
    if (room < BUILT_IN_LIMITS.lengthFt.min * 12) {
      out.push(empty(it, "that edge is too short for it"));
      continue;
    }
    len = Math.min(want, room);
    a0 = clamp(pickT - len / 2, lo, hi - len);
    a1 = a0 + len;
    // 2b. Beside one already built (two benches that meet at a corner): this one stops at the other's face — the
    // longer of what is left of it on either side.
    let squeezed = false;
    for (const o of out) {
      // (One placed by hand is not made room for: where the two stand on the same boards, that is said.)
      if (!o.built || o.design.spot) continue;
      const as = o.footprint.map((p) => (p.x - sd.x0) * e.ux + (p.y - sd.y0) * e.uy);
      const bs = o.footprint.map((p) => (p.x - sd.x0) * inX + (p.y - sd.y0) * inY - inset);
      const [oa0, oa1, ob0, ob1] = [Math.min(...as), Math.max(...as), Math.min(...bs), Math.max(...bs)];
      if (ob1 <= 0.25 || ob0 >= depth - 0.25 || oa1 <= a0 + 0.25 || oa0 >= a1 - 0.25) continue;
      const before = oa0 - 0.25 - a0;
      const after = a1 - (oa1 + 0.25);
      if (Math.max(before, after) < BUILT_IN_LIMITS.lengthFt.min * 12) {
        squeezed = true;
        break;
      }
      if (before >= after) a1 = oa0 - 0.25;
      else a0 = oa1 + 0.25;
      len = a1 - a0;
      beside = true;
    }
    if (squeezed) {
      out.push(empty(it, "another built-in stands there"));
      continue;
    }
    // 2c. All of it on the deck: where the deck is narrower than the built-in is deep (a thin part, the tip of a cut
    // corner, the house's corner beside it) there is nothing to stand it on.
    {
      const at2 = (a: number, b: number) => ({ x: sd.x0 + e.ux * a + inX * (inset + b), y: sd.y0 + e.uy * a + inY * (inset + b) });
      const onDeck = [0, 0.25, 0.5, 0.75, 1].every((t) => [0.25, depth - 0.25].every((b) => inRing(at2(a0 + 0.25 + (len - 0.5) * t, b))));
      if (!onDeck) {
        out.push(empty(it, "the deck is too narrow there for it"));
        continue;
      }
    }
    shortened = len < want - 0.01;
    // (Along an edge: `a` from the edge's start, `b` in from its back line, into the deck.)
    P = (a, b) => ({ x: sd.x0 + e.ux * a + inX * (inset + b), y: sd.y0 + e.uy * a + inY * (inset + b) });
    yawNow = e.yaw;
    const A0 = a0;
    const A1 = a1;
    // What stands in its way along the edge.
    const overlapsRun = (g: { x0: number; y0: number; x1: number; y1: number }) => {
      const off = (x: number, y: number) => Math.abs((x - sd.x0) * e.outX + (y - sd.y0) * e.outY);
      if (off(g.x0, g.y0) > 1.5 || off(g.x1, g.y1) > 1.5) return false;
      const t0 = (g.x0 - sd.x0) * e.ux + (g.y0 - sd.y0) * e.uy;
      const t1 = (g.x1 - sd.x0) * e.ux + (g.y1 - sd.y0) * e.uy;
      return Math.max(t0, t1) > A0 + 0.5 && Math.min(t0, t1) < A1 - 0.5;
    };
    onStair = input.stairTops.some(overlapsRun);
    onSteps = input.wrapped.some(overlapsRun);
    }
    const footprint = [P(a0, 0), P(a1, 0), P(a1, depth), P(a0, depth)];

    const members: BuiltInMember[] = [];
    /** A box `la` long along the edge and `lb` across it, centred at (`a`, `b`) and `z` above the boards. */
    const put = (role: BuiltInRole, nominal: string, lengthIn: number, a: number, b: number, z: number, la: number, lb: number, lz: number) => {
      const c = P(a, b);
      members.push({ role, nominal, lengthIn: r2(lengthIn), cx: r2(c.x), cy: r2(c.y), cz: r2(S + z), sx: r2(la), sy: r2(lb), sz: r2(lz), yaw: yawNow, of: it.id });
    };
    let boardIn = 0;
    let apronIn = 0;
    let postLen = 0;
    let frameIn = 0;
    let supports = 0;
    let heightIn = BENCH_SEAT_IN;
    let soilCuFt = 0;
    let weightLb = 0;
    let psf = 0;
    let overBeam = false;
    const mid = (a0 + a1) / 2;
    let posts = 0;
    let sqFt = 0;
    let windLb = 0;
    let windFtLb = 0;
    let hot: Array<{ x: number; y: number }> = [];
    let sisters = 0;
    let sisterIn = 0;

    if (it.kind === "kitchen") {
      // The island: the deck's boards round a 2x4 frame, set in 1½ in. under the top's edge; a 2-in. top for stone; a
      // grill built in at its middle, toward the back.
      const lip = 1.5;
      const top = KITCHEN_HEIGHT_IN - KITCHEN_TOP_IN;
      const foot = 0.75;
      heightIn = KITCHEN_HEIGHT_IN;
      const carcassLen = len - 2 * lip;
      const carcassDepth = depth - 2 * lip;
      for (let z = foot; top - z > 1; z += W + G) {
        const bh = Math.min(W, top - z);
        put("kitchen board", board.nominal, carcassLen, mid, lip + T / 2, z + bh / 2, carcassLen, T, bh);
        put("kitchen board", board.nominal, carcassLen, mid, depth - lip - T / 2, z + bh / 2, carcassLen, T, bh);
        put("kitchen board", board.nominal, carcassDepth - 2 * T, a0 + lip + T / 2, depth / 2, z + bh / 2, T, carcassDepth - 2 * T, bh);
        put("kitchen board", board.nominal, carcassDepth - 2 * T, a1 - lip - T / 2, depth / 2, z + bh / 2, T, carcassDepth - 2 * T, bh);
        boardIn += 2 * carcassLen + 2 * (carcassDepth - 2 * T);
      }
      put("kitchen top", "stone top", len, mid, depth / 2, top + KITCHEN_TOP_IN / 2, len, depth, KITCHEN_TOP_IN);
      const grillW = len >= 60 ? 30 : 24;
      const grillD = 22;
      const grillB = lip + 2 + grillD / 2;
      put("kitchen grill", "built-in grill", grillW, mid, grillB, KITCHEN_HEIGHT_IN + 4.5, grillW, grillD, 9);
      hot = [P(mid - grillW / 2, grillB - grillD / 2), P(mid + grillW / 2, grillB - grillD / 2), P(mid + grillW / 2, grillB + grillD / 2), P(mid - grillW / 2, grillB + grillD / 2)];
      // The frame: a plate top and bottom along both long sides, an upright every 16 in. in each, a cross piece at every third.
      const uprights = 2 * (Math.ceil(carcassLen / 16 - 1e-9) + 1);
      frameIn += 4 * carcassLen + uprights * (top - foot) + Math.ceil(uprights / 6) * carcassDepth * 2;
      weightLb = (KITCHEN_TOP_PSF * len * depth) / 144 + (KITCHEN_CARCASS_LB_PER_FT * len) / 12 + KITCHEN_GRILL_LB;
      psf = weightLb / ((len * depth) / 144);
      // The joists under it, doubled their whole length: the ones that pass under its footprint.
      const fx = footprint.map((q) => q.x);
      const fy = footprint.map((q) => q.y);
      for (const j of input.joists ?? []) {
        if (j.x < Math.min(...fx) - 2 || j.x > Math.max(...fx) + 2 || j.y1 < Math.min(...fy) || j.y0 > Math.max(...fy)) continue;
        sisters += 1;
        sisterIn += j.y1 - j.y0;
      }
    } else if (fire) {
      // A gas fire table (by others), drawn so what stands near it can be measured: a base, a top, the burner's pan.
      heightIn = FIRE_HEIGHT_IN;
      put("fire base", "fire table", len - 6, mid, depth / 2, (FIRE_HEIGHT_IN - 2) / 2, len - 6, depth - 6, FIRE_HEIGHT_IN - 2);
      put("fire top", "fire table", len, mid, depth / 2, FIRE_HEIGHT_IN - 1, len, depth, 2);
      put("fire burner", "burner", len - 12, mid, depth / 2, FIRE_HEIGHT_IN + 0.25, Math.max(6, len - 12), Math.max(6, depth - 12), 0.5);
      hot = footprint.map((q) => ({ ...q }));
      weightLb = FIRE_LB + Math.max(0, len / 12 - 4) * FIRE_LB_PER_FT;
      psf = weightLb / ((len * depth) / 144);
    } else if (screen) {
      // Posts no more than 6 ft apart, the deck's boards across their inner faces from 2 in. above the deck to the
      // top, ¾ in. between them; a cap board on the posts.
      heightIn = screenH + T;
      posts = Math.max(2, Math.ceil((len - postIn) / SCREEN_POST_MAX_IN - 1e-9) + 1);
      const bay = (len - postIn) / (posts - 1);
      for (let k = 0; k < posts; k++) put("screen post", postSize, screenH, a0 + postIn / 2 + bay * k, postIn / 2, screenH / 2, postIn, postIn, screenH);
      // (Bought long enough to run down beside the joists and bolt there.)
      postLen += posts * (screenH + (input.joistDepthIn ?? 9.25) + 3);
      const pitch = W + SCREEN_GAP_IN;
      let rows = 0;
      for (let z = 2; z + W <= screenH - 0.25; z += pitch) {
        put("screen board", board.nominal, len, mid, postIn + T / 2, z + W / 2, len, T, W);
        rows++;
      }
      put("screen cap", board.nominal, len + 1, mid, (postIn + T) / 2, screenH + T / 2, len + 1, W, T);
      boardIn += rows * len + (len + 1);
      sqFt = (len * screenH) / 144;
      // The wind on one post's share of the screen, and what it does at the deck: the post is a lever a screen-height long.
      windLb = (bay * screenH * SCREEN_WIND_PSF) / 144;
      windFtLb = (windLb * (screenH / 2)) / 12;
    } else if (it.kind === "planter") {
      // Three boards high on feet that keep it off the deck's boards, a cap board all round the rim, the soil inside.
      const foot = 0.75;
      const wallTop = foot + 3 * W + 2 * G;
      heightIn = wallTop + T;
      for (let r = 0; r < 3; r++) {
        const z = foot + r * (W + G) + W / 2;
        put("planter board", board.nominal, len, mid, T / 2, z, len, T, W);
        put("planter board", board.nominal, len, mid, depth - T / 2, z, len, T, W);
        put("planter board", board.nominal, depth - 2 * T, a0 + T / 2, depth / 2, z, T, depth - 2 * T, W);
        put("planter board", board.nominal, depth - 2 * T, a1 - T / 2, depth / 2, z, T, depth - 2 * T, W);
      }
      boardIn += 3 * (2 * len + 2 * (depth - 2 * T));
      // The cap: a board flat along each long side, standing ¾ in. proud all round; two short ones between them at the ends.
      const proud = 0.75;
      const capZ = wallTop + T / 2;
      put("planter cap", board.nominal, len + 2 * proud, mid, W / 2 - proud, capZ, len + 2 * proud, W, T);
      put("planter cap", board.nominal, len + 2 * proud, mid, depth - W / 2 + proud, capZ, len + 2 * proud, W, T);
      const between = depth + 2 * proud - 2 * W;
      if (between > 0.5) {
        put("planter cap", board.nominal, between, a0 + W / 2 - proud, depth / 2, capZ, W, between, T);
        put("planter cap", board.nominal, between, a1 - W / 2 + proud, depth / 2, capZ, W, between, T);
        boardIn += 2 * between;
      }
      boardIn += 2 * (len + 2 * proud);
      // The soil, a hand below the rim.
      const soilTop = wallTop - 2;
      put("planter soil", "", len - 2 * T, mid, depth / 2, soilTop - 1, len - 2 * T - 0.1, depth - 2 * T - 0.1, 2);
      // The frame inside: a 2x4 upright at each corner and every 32 in. along the long sides, two sleepers under it.
      const uprights = 4 + 2 * Math.max(0, Math.ceil(len / 32 - 1e-9) - 1);
      frameIn += uprights * (wallTop - foot) + 2 * len;
      soilCuFt = ((len - 2 * T) * (depth - 2 * T) * PLANTER_SOIL_IN) / 1728;
      weightLb = soilCuFt * SOIL_LB_PER_CUFT + ((boardIn / 12) * 2.2 + (frameIn / 12) * 1.3);
      psf = weightLb / ((len * depth) / 144);
      // A beam line under it, or within a foot of it: the weight goes down where the posts are.
      const fx = footprint.map((p) => p.x);
      const fy = footprint.map((p) => p.y);
      const box = { x0: Math.min(...fx) - 12, x1: Math.max(...fx) + 12, y0: Math.min(...fy) - 12, y1: Math.max(...fy) + 12 };
      overBeam = input.beams.some((b) => Math.max(b.x0, b.x1) > box.x0 && Math.min(b.x0, b.x1) < box.x1 && Math.max(b.y0, b.y1) > box.y0 && Math.min(b.y0, b.y1) < box.y1);
    } else {
      const back = it.kind === "bench-back";
      // (With a back: a row of 4x4 posts behind the seat, the seat in front of them.)
      const b0 = back ? 3.5 : 0;
      for (let r = 0; r < 3; r++) put("bench seat", board.nominal, len, mid, b0 + W / 2 + r * (W + G), BENCH_SEAT_IN - T / 2, len, W, T);
      boardIn += 3 * len;
      // The apron: fascia under the seat all round, half an inch in from its edge (at the back, the posts stand there).
      const lip = 0.5;
      const A = 0.75;
      const apronH = 5.5;
      const apronZ = BENCH_SEAT_IN - T - apronH / 2;
      /** Between the aprons (or from the posts' faces to the front apron): what the cleats and the end aprons span. */
      const inner0 = b0 + (back ? 0 : lip + A);
      const inner1 = b0 + seatDepth - lip - A;
      put("bench apron", "1x6", len - 2 * lip, mid, inner1 + A / 2, apronZ, len - 2 * lip, A, apronH);
      if (!back) put("bench apron", "1x6", len - 2 * lip, mid, inner0 - A / 2, apronZ, len - 2 * lip, A, apronH);
      for (const a of [a0 + lip + A / 2, a1 - lip - A / 2]) put("bench apron", "1x6", inner1 - inner0, a, (inner0 + inner1) / 2, apronZ, A, inner1 - inner0, apronH);
      apronIn += (back ? 1 : 2) * (len - 2 * lip) + 2 * (inner1 - inner0);
      // The supports: 4x4 legs under a 2x4 cleat, no more than 4 ft apart, the first 4 in. in from each end.
      supports = Math.max(2, Math.ceil((len - 2 * BENCH_END_IN) / BENCH_SUPPORT_MAX_IN - 1e-9) + 1);
      const legTop = BENCH_SEAT_IN - T - 1.5;
      for (let k = 0; k < supports; k++) {
        const a = a0 + BENCH_END_IN + 1.75 + ((len - 2 * BENCH_END_IN - 3.5) * k) / (supports - 1);
        put("bench cleat", "2x4", inner1 - inner0, a, (inner0 + inner1) / 2, legTop + 0.75, 3.5, inner1 - inner0, 1.5);
        frameIn += inner1 - inner0;
        put("bench leg", "4x4", legTop, a, inner1 - 1.75, legTop / 2, 3.5, 3.5, legTop);
        postLen += legTop;
        if (back) {
          // The back's post: from the boards to the cap; the seat's cleat is lagged to its face.
          put("bench back post", "4x4", BENCH_BACK_IN, a, 1.75, BENCH_BACK_IN / 2, 3.5, 3.5, BENCH_BACK_IN);
          postLen += BENCH_BACK_IN;
        } else {
          put("bench leg", "4x4", legTop, a, inner0 + 1.75, legTop / 2, 3.5, 3.5, legTop);
          postLen += legTop;
        }
      }
      if (back) {
        // Two boards across the posts' faces above the seat, and a cap board on top of the posts.
        heightIn = BENCH_BACK_IN + T;
        for (const z of [BENCH_BACK_IN - 0.5 - W / 2, BENCH_BACK_IN - 2 - 1.5 * W]) put("bench back", board.nominal, len, mid, b0 + T / 2, z, len, T, W);
        put("bench cap", board.nominal, len, mid, b0 + T - W / 2, BENCH_BACK_IN + T / 2, len, W, T);
        boardIn += 3 * len;
      }
    }
    out.push({ design: it, kind: it.kind, built: true, footprint, lengthIn: r2(len), depthIn: r2(depth), heightIn: r2(heightIn), members, boardLf: r2(boardIn / 12), apronLf: r2(apronIn / 12), postLf: r2(postLen / 12), frameLf: r2(frameIn / 12), supports, soilCuFt: r2(soilCuFt), weightLb: Math.round(weightLb), psf: Math.round(psf), overBeam, posts, postSize: screen ? postSize : "", sqFt: r2(sqFt), windLb: Math.round(windLb), windFtLb: Math.round(windFtLb), hot: hot.map((q) => ({ x: r2(q.x), y: r2(q.y) })), sisters, sisterLf: r2(sisterIn / 12), flags: { shortened, beside, onStair, onSteps, overlaps: [] } });
  }

  // 3. Two that stand on the same boards.
  const cross = (A: Array<{ x: number; y: number }>, B: Array<{ x: number; y: number }>) => {
    for (const poly of [A, B]) {
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i];
        const q = poly[(i + 1) % poly.length];
        const nx = q.y - p.y;
        const ny = p.x - q.x;
        const l = Math.hypot(nx, ny) || 1;
        const pa = A.map((v) => (v.x * nx + v.y * ny) / l);
        const pb = B.map((v) => (v.x * nx + v.y * ny) / l);
        if (Math.max(...pa) <= Math.min(...pb) + 0.25 || Math.max(...pb) <= Math.min(...pa) + 0.25) return false;
      }
    }
    return true;
  };
  for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) {
    if (!out[i].built || !out[j].built || !cross(out[i].footprint, out[j].footprint)) continue;
    out[i].flags.overlaps.push(out[j].design.id);
    out[j].flags.overlaps.push(out[i].design.id);
  }
  return out;
}

/** "an 8-ft bench along the front" */
export function builtInWords(b: BuiltInBuild): string {
  const ft = Math.round((b.lengthIn / 12) * 2) / 2;
  if (b.design.spot) {
    const what = b.kind === "fire" ? "gas fire table" : b.kind === "kitchen" ? "outdoor kitchen island" : b.kind === "planter" ? "planter box" : b.kind === "bench-back" ? "bench with a back" : "bench";
    return `${/^(8|11|18)/.test(String(ft)) ? "an" : "a"} ${ft}-ft ${what} placed on the deck by hand`;
  }
  if (b.kind === "fire") return `${/^(8|11|18)/.test(String(ft)) ? "an" : "a"} ${ft}-ft gas fire table ${Math.round((b.design.inFt ?? 6) * 2) / 2} ft in from the ${b.design.side === "front" ? "front" : `${b.design.side} end`}`;
  const what = b.kind === "kitchen" ? "outdoor kitchen island" : b.kind === "screen" ? `privacy screen ${Math.round(((b.heightIn - 1) / 12) * 2) / 2} ft high` : b.kind === "planter" ? "planter box" : b.kind === "bench-back" ? "bench with a back" : "bench";
  return `${/^(8|11|18)/.test(String(ft)) ? "an" : "a"} ${ft}-ft ${what} along the ${b.design.side === "front" ? "front" : `${b.design.side} end`}`;
}

/** The least distance between two convex shapes in plan, in. (0 where they touch or cross). */
export function planGap(A: ReadonlyArray<{ x: number; y: number }>, B: ReadonlyArray<{ x: number; y: number }>): number {
  if (!A.length || !B.length) return Infinity;
  const seg = (p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
    return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t);
  };
  const inside = (p: { x: number; y: number }, poly: ReadonlyArray<{ x: number; y: number }>) => {
    if (poly.length < 3) return false;
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i];
      const b = poly[j];
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
    }
    return c;
  };
  if (A.some((p) => inside(p, B)) || B.some((p) => inside(p, A))) return 0;
  let best = Infinity;
  const edgesOf = (poly: ReadonlyArray<{ x: number; y: number }>) => (poly.length === 2 ? [[poly[0], poly[1]] as const] : poly.map((p, i) => [p, poly[(i + 1) % poly.length]] as const));
  // (Two that cross with no corner of either inside the other — an edge straight through a box — touch.)
  const side = (a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  for (const [a, b] of edgesOf(A)) for (const [c, d] of edgesOf(B)) if (side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0) return 0;
  for (const p of A) for (const [a, b] of edgesOf(B)) best = Math.min(best, seg(p, a, b));
  for (const p of B) for (const [a, b] of edgesOf(A)) best = Math.min(best, seg(p, a, b));
  return best;
}
