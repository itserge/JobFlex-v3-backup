// THE STAIRS, BUILT (Deck Studio M3, 2026-10-10) — pure.
//
// Owner: "stairs placed by pointing, built per code; steps wrapping three
// sides, or four when the deck is detached." A stair in the design (design.ts
// StairDesign) names an edge, a spot along it and a width; this works out
// what the crew builds there:
//
//   · A FLIGHT: risers from the deck's walking surface to the ground (or to
//     the lower level, or to a pad), each no taller than the code's 7 3/4 in.
//     and aimed at 7 1/2; treads of two deck boards 10 1/2 in. deep with a
//     1-in. nosing; 2x12 cut stringers 16 in. apart (12 in. under composite,
//     10 under PVC — the boards' makers), set on a treated kicker bolted to a
//     new 4-in. concrete pad (or the owner's patio, or pavers); a mid-flight
//     beam on two posts when a cut stringer would span more than 6 ft; a
//     landing when a flight would climb more than 12 ft 3 in.; a graspable
//     handrail from four risers up; guards on both open sides when the deck
//     is more than 30 in. up.
//   · BOX STEPS wrapping the deck: for a low deck (three risers at most),
//     each tread a 2x6 box frame the run deep around the front — or the front
//     and both sides, or all four sides of a detached deck — the levels
//     stacked, the lowest on blocks over gravel.
//
// Every piece is a box in space (for the 3D and the elevation), a line in
// the material list (takeoff.ts) and a figure for the checks (checks.ts).
// Coordinates follow frame.ts: inches, x along the house, y out from it, z
// up; the stair's own frame has `a` along its width and `b` outward.

import { GUARD_REQUIRED_ABOVE_IN, HANDRAIL_FROM_RISERS, RISER_MAX_IN, THICK_2X_IN, type PostSize } from "./codeTables";
import { IRC_CODE, cite, inFrac, type DeckStateCode } from "./stateCodes";
import { BAG_CUFT, footingFor, type Footing } from "./frame";
import type { DeckingProduct } from "./catalog";
import { ringEdges } from "./ringEdges";
import { STAIR_LIMITS, railMountOf, type DeckDesign, type RailDesign, type RailMount, type StairDesign, type StairTurn, type StairTurnKind } from "./design";

/* ------------------------------------------------------------------ */
/*  Constants a stair builder would recognise                           */
/* ------------------------------------------------------------------ */

/** The riser the layout aims at; the code allows 7 3/4. */
export const RISER_TARGET_IN = 7.5;
/** The tread's run (riser face to riser face): two 5 1/2-in. boards, 1 in. of nosing over the riser below. */
export const TREAD_RUN_IN = 10.5;
/** A top-mounted stair rail post's centre in from the stair's edge: what the deck's posts stand in from the deck's (lib/deck/rails TOP_MOUNT_IN). */
export const STAIR_TOP_MOUNT_IN = 2.75;
export const TREAD_NOSING_IN = 1;
export const STRINGER_NOMINAL = "2x12";
export const STRINGER_DEPTH_IN = 11.25;
/** How far the treads and risers run past the outer stringers, in. (drawn; a face of each never shares a plane). */
const TREAD_PAST_STRINGER_IN = 1;
/** Risers are drawn this much shorter than the treads (an eighth at each end), in., so their ends are not in the treads' or the kicker's. */
const RISER_SHORT_IN = 0.25;
/** The kicker is set this far back from the bottom riser's face, in. (flush, the two faces flickered). */
const KICKER_BACK_IN = 0.25;
/** The stair's balusters sit this far in from the middle of the rails, in.: against the rails' inner face, not in their plane. */
const STAIR_BALUSTER_IN_IN = 0.25;
/** AWC DCA 6: a cut 2x12 stringer spans 6 ft at most before it needs a support. */
export const STRINGER_MAX_SPAN_IN = 72;
/** IRC R311.7.3: a flight climbs no more than 12 ft 3 in. (the 2015 figure; later editions print 12-7 — the stricter kept) before a landing. */
export const FLIGHT_MAX_RISE_IN = 147;
/** IRC R311.7.6: a landing at least 36 in. in the direction of travel. */
export const LANDING_DEPTH_IN = 36;
/** A switchback's well: the gap between the flight coming down to a landing and the one going back from it, in. — room for both inner rails. */
export const SWITCHBACK_GAP_IN = 6;
/** IRC R311.7.2: 6 ft 8 in. of headroom over the nosings — a flight that runs back under the deck needs it under the deck's frame. */
export const STAIR_HEADROOM_IN = 80;
/** Box steps: three risers at most (Fine Homebuilding; past that, stringers). */
export const BOX_STEP_MAX_RISERS = 3;
export const PAD_THICK_IN = 4;
/** The pad runs this far past the stair on each side, and this far out past the bottom riser. */
export const PAD_APRON_IN = 6;
export const PAD_OUT_IN = 36;
/** A pad's top above the ground. */
export const PAD_TOP_IN = 2;
/** Pavers on grade: a 2 3/8-in. paver on an inch of sand. */
export const PAVER_TOP_IN = 2.5;
/** Rail posts along a stair, inches on the slope. */
export const STAIR_RAIL_POST_SPACING_IN = 72;
/** Balusters at 5 in. on centre leave the code's 4-in. gap between 1 1/2-in. pieces. */
export const BALUSTER_SPACING_IN = 5;
/** The handrail's height above the nosings (R311.7.8: 34 to 38 in.). */
export const HANDRAIL_HEIGHT_IN = 36;
/** Box-step frames: 2x6 with joists at this spacing (12 in. under composite). */
export const BOX_FRAME_NOMINAL = "2x6";
/** Blocks under the lowest box step, inches apart along its perimeter. */
export const BOX_BLOCK_SPACING_IN = 48;

/* ------------------------------------------------------------------ */
/*  What comes out                                                     */
/* ------------------------------------------------------------------ */

export type StairRole =
  | "stringer"
  | "tread"
  | "riser"
  | "kicker"
  | "stair-post"
  | "stair-beam"
  | "landing-frame"
  | "landing-tread"
  | "box-frame"
  | "box-tread"
  | "stair-rail"
  | "stair-rail-post"
  | "stair-baluster"
  | "pad";

/** One piece of a stair, inches. `yaw` is its axis's direction in plan, `tilt` its rise along that axis. */
export interface StairMember {
  role: StairRole;
  nominal: string;
  lengthIn: number;
  cx: number;
  cy: number;
  cz: number;
  sx: number;
  sy: number;
  sz: number;
  yaw: number;
  tilt: number;
  of: string;
}

/** What a stair stands on, and how high it has to climb. */
export interface StairLevel {
  id: "upper" | "lower";
  /** The walking surface, inches above the house-line ground. */
  surfaceIn: number;
  /** Underside of the joists — the stringers hang on the rim above it. */
  joistBottomIn: number;
  /** The level's rectangle in the deck's coordinates, inches. */
  x0: number;
  y0: number;
  widthIn: number;
  depthIn: number;
  /** The front edge's y at a local x (a curve or a clip moves it). */
  frontAt: (xLocal: number) => number;
  /**
   * The level's outline as its sides in order round it, the house's marked (2026-11-14): steps that wrap the deck
   * follow THESE — every part of a front set part by part, a corner cut at an angle, a deck round the house's corner —
   * not the rectangle the deck fits in. Absent (a lower level, a plain rectangle of old): the rectangle.
   */
  sides?: Array<{ x0: number; y0: number; x1: number; y1: number; house: boolean; side: "front" | "back" | "left" | "right" }>;
}

export interface StairBuild {
  design: StairDesign;
  level: "upper" | "lower";
  kind: "flight" | "box";
  /** The climb, inches: surface to what the stair lands on. */
  riseIn: number;
  risers: number;
  riserIn: number;
  runIn: number;
  treads: number;
  /** Horizontal length of the whole stair, landing included. */
  totalRunIn: number;
  widthIn: number;
  /** The ground at the foot, inches (negative downhill), and what the foot stands on. */
  groundIn: number;
  lands: "ground" | "lower-deck";
  stringers: { count: number; nominal: string; lengthIn: number; spacingIn: number };
  midSupport: boolean;
  /** It has a landing (its own, or one the code's 12 ft 3 in. asked for). */
  landing: boolean;
  /**
   * THE WAY DOWN (2026-11-14): the flights in order and the landings between them. One flight and no landing is the
   * plain stair it always was. `path` is its centre line in plan, top to foot, through every turn.
   */
  flights: Array<{ risers: number; riserIn: number; riseIn: number; runIn: number; topIn: number }>;
  /** `dir`: the way the flight that comes down to it runs, as the deck is seen from the yard (lib/deck/stairs StairDir). */
  landings: Array<{ id: string; auto: boolean; heightIn: number; turn: StairTurnKind; dir: StairDir; widthIn: number; depthIn: number; posts: number; aboveGroundIn: number; x: number; y: number }>;
  path: Array<{ x: number; y: number }>;
  pad: { lengthIn: number; widthIn: number; thickIn: number; cuFt: number; bags: number } | null;
  pavers: number;
  /** Sides with a rail built, sides the code wants one on, and the sloped length of rail on each. */
  /** `mount` (2026-11-13): how its rail's posts are held — as the deck's side it leaves: on the treads (top), or on the stringers (side). */
  rail: { sides: 0 | 1 | 2; wanted: 0 | 1 | 2; lengthIn: number; posts: number; balusters: number; handrailOnly: boolean; mount: RailMount };
  /** A guard is required on the open sides (the deck is more than 30 in. up). */
  guard: boolean;
  members: StairMember[];
  footings: Footing[];
  /** The stair's outline in plan, inches, for the framing plan. */
  footprint: Array<{ x: number; y: number }>;
  /** Steps that wrap the deck along its own outline (2026-11-14): each tread board as a flat ring [x0, y0, x1, y1, …] at its top's height — mitred where two edges meet — and the stretches of the deck's edge the steps run along (no rail there). */
  treadRings?: Array<{ ring: number[]; z: number }>;
  wrapped?: Array<{ x0: number; y0: number; x1: number; y1: number }>;
  /** Feet of deck boards for the treads and of riser boards. */
  treadBoardLf: number;
  riserBoardLf: number;
  /** Feet of 2x6 in the box frames, blocks under them, gravel under the lowest. */
  boxFrameLf: number;
  boxBlocks: number;
  gravelSqFt: number;
  hardware: { stringerConnectors: number; anchors: number; postBases: number; railPostTies: number; riserLights: number; treadScrewsSqFt: number };
  /** `landingsLeftOut`: landings asked for that the climb has no room for (too near the deck, the ground or each other); `hitsHouse`: a flight or a landing runs into the house wall; `underDeckClearIn`: where it runs back under the deck, the headroom there (null: it does not). */
  flags: { tooTallForBox: boolean; beyondRun: boolean; narrow: boolean; landingsLeftOut: string[]; hitsHouse: boolean; underDeckClearIn: number | null };
}

/** The way a flight runs going down, as the deck is seen from the yard with the house behind it: away from the house, toward it, to the left, to the right. */
export type StairDir = "out" | "in" | "left" | "right";
const dirOf = (n: { x: number; y: number }): StairDir => (Math.abs(n.y) >= Math.abs(n.x) ? (n.y > 0 ? "out" : "in") : n.x > 0 ? "right" : "left");
const DIR_VEC: Record<StairDir, { x: number; y: number }> = { out: { x: 0, y: 1 }, in: { x: 0, y: -1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
/** The walker's left, going down (x runs to the right as the deck is seen from the yard, y toward the yard). */
const walkerLeft = (v: { x: number; y: number }) => ({ x: v.y, y: -v.x });
/** The way the next flight runs after a turn at a landing reached running `dir`. */
export function stairDirAfter(dir: StairDir, turn: StairTurnKind): StairDir {
  const n = DIR_VEC[dir];
  const l = walkerLeft(n);
  return dirOf(turn === "straight" ? n : turn === "left" ? l : turn === "right" ? { x: -l.x, y: -l.y } : { x: -n.x, y: -n.y });
}
const DIR_WORDS: Record<StairDir, string> = { out: "away from the house", in: "toward the house", left: "to the left", right: "to the right" };
const SIDE_WORDS: Record<StairDir, string> = { out: "on the yard side", in: "on the house side", left: "on the left", right: "on the right" };
/**
 * A turn in plain words, as the deck is SEEN — from the yard, the house behind it — not as the walker turns (walking
 * down a front stair faces the yard, so the walker's left is the right of the picture: "turn left" went right).
 * "Straight on", "Turn to the left", "Turn toward the house", "Back, on the right".
 */
export function stairTurnWords(dir: StairDir, turn: StairTurnKind): string {
  if (turn === "straight") return "Straight on";
  if (turn === "left" || turn === "right") return `Turn ${DIR_WORDS[stairDirAfter(dir, turn)]}`;
  return `Back, ${SIDE_WORDS[stairDirAfter(dir, turn === "back-left" ? "left" : "right")]}`;
}

/** The turns in the order a builder reads them for a landing reached running `dir`: straight on, then the quarter turns and the switchbacks — the left one (or the one toward the house) first. */
export function stairTurnsInOrder(dir: StairDir): StairTurnKind[] {
  const rank: Record<StairDir, number> = { left: 0, in: 1, out: 2, right: 3 };
  const byWay = (a: StairTurnKind, b: StairTurnKind) => rank[stairDirAfter(dir, a.replace("back-", "") as StairTurnKind)] - rank[stairDirAfter(dir, b.replace("back-", "") as StairTurnKind)];
  return ["straight", ...(["left", "right"] as StairTurnKind[]).sort(byWay), ...(["back-left", "back-right"] as StairTurnKind[]).sort(byWay)];
}

/** One flight of a stair: how far it climbs, in how many risers, from where to where, and the landing at its foot (none under the last). */
export interface StairLeg {
  riseIn: number;
  risers: number;
  riserIn: number;
  topIn: number;
  footIn: number;
  landing: { id: string; turn: StairTurnKind; auto: boolean } | null;
}

/**
 * THE CLIMB CUT INTO FLIGHTS (2026-11-14). The builder's landings that fit — each two risers at least from the deck,
 * the ground and the next landing — and then a straight landing wherever a flight would still climb past the code's
 * 12 ft 3 in. Each flight's risers are its own (the code lets the riser differ either side of a landing), aimed at
 * 7 1/2 in. and never over 7 3/4.
 */
export function stairLegs(topIn: number, footIn: number, turns: readonly StairTurn[] = []): { legs: StairLeg[]; leftOut: string[] } {
  const apart = STAIR_LIMITS.landingApartIn;
  const fit: StairTurn[] = [];
  const leftOut: string[] = [];
  for (const t of [...turns].sort((a, b) => b.heightIn - a.heightIn)) {
    const above = fit.length ? fit[fit.length - 1].heightIn : topIn;
    if (t.heightIn <= above - apart + 1e-6 && t.heightIn >= footIn + apart - 1e-6) fit.push(t);
    else leftOut.push(t.id);
  }
  const cuts: Array<{ z: number; landing: StairLeg["landing"] }> = [...fit.map((t) => ({ z: t.heightIn, landing: { id: t.id, turn: t.turn, auto: false } })), { z: footIn, landing: null }];
  const legs: StairLeg[] = [];
  let top = topIn;
  for (const c of cuts) {
    const rise = top - c.z;
    const parts = Math.max(1, Math.ceil(rise / FLIGHT_MAX_RISE_IN - 1e-9));
    for (let k = 1; k <= parts; k++) {
      const foot = k === parts ? c.z : top - rise / parts;
      const r = stairRisers(top - foot);
      legs.push({ riseIn: top - foot, risers: r, riserIn: r > 0 ? (top - foot) / r : 0, topIn: top, footIn: foot, landing: k === parts ? c.landing : { id: `auto${legs.length + 1}`, turn: "straight", auto: true } });
      top = foot;
    }
  }
  return { legs, leftOut };
}

/** The outline of rectangles that touch, as one ring — from (0, 0) along the first one's near edge and on round. Rectangles are [a0, b0, a1, b1]. */
function rectsOutline(rects: Array<[number, number, number, number]>): Array<[number, number]> {
  const uniq = (v: number[]) => [...new Set(v.map((n) => Math.round(n * 100) / 100))].sort((p, q) => p - q);
  const xs = uniq(rects.flatMap((r) => [r[0], r[2]]));
  const ys = uniq(rects.flatMap((r) => [r[1], r[3]]));
  const inside = (i: number, j: number) => {
    if (i < 0 || j < 0 || i >= xs.length - 1 || j >= ys.length - 1) return false;
    const cx = (xs[i] + xs[i + 1]) / 2;
    const cy = (ys[j] + ys[j + 1]) / 2;
    return rects.some((r) => cx > r[0] && cx < r[2] && cy > r[1] && cy < r[3]);
  };
  // Every side of a cell that faces the outside, pointing so the inside is on its left.
  const edges = new Map<string, Array<[number, number]>>();
  const key = (x: number, y: number) => `${x},${y}`;
  const add = (x0: number, y0: number, x1: number, y1: number) => edges.set(key(x0, y0), [...(edges.get(key(x0, y0)) ?? []), [x1, y1]]);
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < ys.length - 1; j++) {
      if (!inside(i, j)) continue;
      if (!inside(i, j - 1)) add(xs[i], ys[j], xs[i + 1], ys[j]);
      if (!inside(i + 1, j)) add(xs[i + 1], ys[j], xs[i + 1], ys[j + 1]);
      if (!inside(i, j + 1)) add(xs[i + 1], ys[j + 1], xs[i], ys[j + 1]);
      if (!inside(i - 1, j)) add(xs[i], ys[j + 1], xs[i], ys[j]);
    }
  }
  const start: [number, number] = edges.has(key(0, 0)) ? [0, 0] : (([...edges.keys()][0] ?? "0,0").split(",").map(Number) as [number, number]);
  const ring: Array<[number, number]> = [start];
  let at = start;
  for (let guard = 0; guard < 400; guard++) {
    const outs = edges.get(key(at[0], at[1]));
    if (!outs || !outs.length) break;
    const next = outs.shift() as [number, number];
    if (next[0] === start[0] && next[1] === start[1]) break;
    ring.push(next);
    at = next;
  }
  // Points in the middle of a straight side say nothing.
  return ring.filter((p, k) => {
    const a = ring[(k + ring.length - 1) % ring.length];
    const b = ring[(k + 1) % ring.length];
    return Math.abs((p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0])) > 1e-6;
  });
}

/* ------------------------------------------------------------------ */
/*  The build                                                          */
/* ------------------------------------------------------------------ */

type V2 = { x: number; y: number };

/** How far apart the stringers go under these boards. */
export function stringerSpacingFor(product: DeckingProduct): number {
  if (product.family === "pvc") return 10;
  if (product.family === "composite" || product.family === "mineral") return 12;
  return 16;
}

/** Risers for a climb, aimed at 7 1/2 in. and never over 7 3/4. */
export function stairRisers(riseIn: number): number {
  if (!(riseIn > 0)) return 0;
  return Math.max(1, Math.ceil(riseIn / RISER_TARGET_IN - 1e-9));
}

export interface StairInput {
  design: DeckDesign;
  stair: StairDesign;
  level: StairLevel;
  /** The other level, when the stair may land on it (an upper stair over the lower deck). */
  lowerLevel: StairLevel | null;
  product: DeckingProduct;
  rail: RailDesign;
  /** The ground under a point of the plan, inches. */
  groundAt: (x: number, y: number) => number;
  /** The state's most riser (lib/deck/stateCodes); the IRC's 7¾ in. when not given. One riser or less is a step, not a stair. */
  riserMaxIn?: number;
  /** The post size the stair's posts and the rail's posts are cut from. */
  postSize: PostSize;
}

export function buildStair(input: StairInput): StairBuild {
  const { stair, level, product, rail, design } = input;
  const members: StairMember[] = [];
  const footings: Footing[] = [];
  const W = level.widthIn;
  const D = level.depthIn;
  const w = Math.round(stair.widthFt * 12);
  const at = Math.round(stair.atFt * 12);
  const treadThick = product.thickIn;
  const boardPitch = product.widthIn + product.gapIn;

  // The stair's own frame: O at its top-left looking down it, u along the width, n outward.
  let O: V2;
  let u: V2;
  let nrm: V2;
  if (stair.side === "front") {
    O = { x: level.x0 + at - w / 2, y: level.y0 + level.frontAt(at) };
    u = { x: 1, y: 0 };
    nrm = { x: 0, y: 1 };
  } else if (stair.side === "left") {
    O = { x: level.x0, y: level.y0 + at + w / 2 };
    u = { x: 0, y: -1 };
    nrm = { x: -1, y: 0 };
  } else {
    O = { x: level.x0 + W, y: level.y0 + at - w / 2 };
    u = { x: 0, y: 1 };
    nrm = { x: 1, y: 0 };
  }
  const P = (a: number, b: number): V2 => ({ x: O.x + u.x * a + nrm.x * b, y: O.y + u.y * a + nrm.y * b });
  const narrow = w < 36;
  const id = stair.id;
  void D;

  // Where it lands: on the lower deck when its foot is over it, else the ground.
  const probe = (b: number) => P(w / 2, b);
  const lowerUnder = (p: V2) => !!input.lowerLevel && level.id === "upper" && p.x >= input.lowerLevel.x0 - 0.5 && p.x <= input.lowerLevel.x0 + input.lowerLevel.widthIn + 0.5 && p.y >= input.lowerLevel.y0 - 0.5 && p.y <= input.lowerLevel.y0 + input.lowerLevel.depthIn + 0.5;
  const footGuess = probe(TREAD_RUN_IN * 3);
  /** What the foot stands on and how high that is, read at a point of the plan. */
  const footAt = (p: V2) => {
    const on: StairBuild["lands"] = lowerUnder(p) ? "lower-deck" : "ground";
    const g = on === "lower-deck" ? input.lowerLevel!.surfaceIn : input.groundAt(p.x, p.y);
    return { on, g, top: on === "lower-deck" ? g : stair.landing === "pad" ? g + PAD_TOP_IN : stair.landing === "grade" ? g + PAVER_TOP_IN : g };
  };
  const foot0 = footAt(footGuess);
  let lands: StairBuild["lands"] = foot0.on;
  let groundIn = foot0.g;
  let landingTopIn = foot0.top;
  let riseIn = Math.max(0, level.surfaceIn - landingTopIn);
  // One riser or less is a step the level below already makes: nothing to build.
  let risers = riseIn > (input.riserMaxIn ?? RISER_MAX_IN) ? stairRisers(riseIn) : 0;
  let riserIn = risers > 0 ? riseIn / risers : 0;
  const runIn = TREAD_RUN_IN;
  let treads = Math.max(0, risers - 1);
  const guard = level.surfaceIn - (level.id === "upper" && lands === "lower-deck" ? groundIn : input.groundAt(O.x, O.y)) > GUARD_REQUIRED_ABOVE_IN;

  const hardware = { stringerConnectors: 0, anchors: 0, postBases: 0, railPostTies: 0, riserLights: 0, treadScrewsSqFt: 0 };
  let treadBoardLf = 0;
  let riserBoardLf = 0;
  let boxFrameLf = 0;
  let boxBlocks = 0;
  let gravelSqFt = 0;
  let pad: StairBuild["pad"] = null;
  let pavers = 0;
  let totalRunIn = 0;
  let midSupport = false;
  let landing = false;
  /** How the rail's posts are held on this stair: as on the side of the deck it leaves. */
  const railMount: RailMount = railMountOf(rail, `${level.id}-${stair.side}`);
  let railSides: 0 | 1 | 2 = 0;
  let railWanted: 0 | 1 | 2 = 0;
  let railLengthIn = 0;
  let railPosts = 0;
  let balusters = 0;
  let footprint: V2[] = [];
  let treadRingsOut: StairBuild["treadRings"];
  let wrappedOut: StairBuild["wrapped"];
  const flightsOut: StairBuild["flights"] = [];
  const landingsOut: StairBuild["landings"] = [];
  let path: V2[] = [];
  let landingsLeftOut: string[] = [];
  let hitsHouse = false;
  let underDeckClearIn: number | null = null;
  const wantsBox = stair.wrap && stair.side === "front";
  const tooTallForBox = wantsBox && risers > BOX_STEP_MAX_RISERS;
  const kind: StairBuild["kind"] = wantsBox && !tooTallForBox ? "box" : "flight";
  const stringerSpacing = stringerSpacingFor(product);
  const stringers = { count: 0, nominal: STRINGER_NOMINAL, lengthIn: 0, spacingIn: stringerSpacing };
  const member = (role: StairRole, nominal: string, lengthIn: number, c: V2, cz: number, sx: number, sy: number, sz: number, yaw: number, tilt = 0) => {
    members.push({ role, nominal, lengthIn, cx: c.x, cy: c.y, cz, sx, sy, sz, yaw, tilt, of: id });
  };

  if (kind === "flight" && risers > 0) {
    /* ── the way down: flights, and the landings between them ─────── */
    // One frame for each flight: O at its top-left looking down it, u along its width, n the way it runs. A landing
    // hands the next flight a frame of its own — straight on, a quarter turn, or back beside the flight above.
    type Frame = { O: V2; u: V2; n: V2 };
    type Plat = { a0: number; a1: number; b0: number; b1: number };
    const at2 = (F: Frame, a2: number, b2: number): V2 => ({ x: F.O.x + F.u.x * a2 + F.n.x * b2, y: F.O.y + F.u.y * a2 + F.n.y * b2 });
    const yawOf = (v: V2) => Math.atan2(v.y, v.x);
    const leftOf = walkerLeft;
    const count = Math.max(narrow ? 2 : 3, Math.floor((w - THICK_2X_IN) / stringerSpacing) + 1);
    const stringerAt: number[] = [];
    // The outer stringers an inch in from the treads' ends, the treads and risers running past them (2026-10-11: flush,
    // a tread's end lay in the stringer's face and the 3D flickered between them).
    for (let i = 0; i < count; i++) stringerAt.push(TREAD_PAST_STRINGER_IN + THICK_2X_IN / 2 + ((w - THICK_2X_IN - 2 * TREAD_PAST_STRINGER_IN) * i) / (count - 1));

    /** The legs laid out in plan for a foot at `footTop`: each flight's frame, its run, and the landing at its foot. */
    const lay = (footTop: number) => {
      const cut = stairLegs(level.surfaceIn, footTop, stair.landings);
      const out: Array<{ leg: StairLeg; F: Frame; runF: number; plat: Plat | null }> = [];
      let F: Frame = { O, u, n: nrm };
      for (const leg of cut.legs) {
        const runF = Math.max(0, leg.risers - 1) * runIn;
        let plat: Plat | null = null;
        let next = F;
        if (leg.landing) {
          const L = leftOf(F.n);
          const leftIsPlus = F.u.x * L.x + F.u.y * L.y > 0;
          const turn = leg.landing.turn;
          const deep = Math.max(w, LANDING_DEPTH_IN);
          if (turn === "straight") {
            plat = { a0: 0, a1: w, b0: runF, b1: runF + LANDING_DEPTH_IN };
            next = { O: at2(F, 0, runF + LANDING_DEPTH_IN), u: F.u, n: F.n };
          } else if (turn === "left" || turn === "right") {
            // A square landing; the next flight leaves by its left or right edge, its width along the way this one came.
            const plus = (turn === "left") === leftIsPlus;
            plat = { a0: 0, a1: w, b0: runF, b1: runF + deep };
            next = { O: at2(F, plus ? w : 0, runF), u: F.n, n: turn === "left" ? L : { x: -L.x, y: -L.y } };
          } else {
            // A switchback: the landing two flights and the well between them wide; the next flight goes back beside this one.
            const plus = (turn === "back-left") === leftIsPlus;
            plat = { a0: plus ? 0 : -(w + SWITCHBACK_GAP_IN), a1: plus ? 2 * w + SWITCHBACK_GAP_IN : w, b0: runF, b1: runF + deep };
            next = { O: at2(F, plus ? w + SWITCHBACK_GAP_IN : -(w + SWITCHBACK_GAP_IN), runF), u: F.u, n: { x: -F.n.x, y: -F.n.y } };
          }
        }
        out.push({ leg, F, runF, plat });
        F = next;
      }
      return { chain: out, leftOut: cut.leftOut };
    };

    let laid = lay(landingTopIn);
    if (stair.landings.length) {
      // A stair that turns comes down somewhere else: the ground — or the lower level — is read where its foot really is.
      const last0 = laid.chain[laid.chain.length - 1];
      const foot = footAt(at2(last0.F, w / 2, last0.runF + runIn));
      // (On the ground: no more than 10 ft above or below where it was first read by the deck — a fall of a storey in
      // the length of a stair is not a yard a stair is laid out on, and each foot farther down would lengthen it again.)
      const drift = foot.on === "ground" ? Math.max(-120, Math.min(120, foot.g - foot0.g)) - (foot.g - foot0.g) : 0;
      lands = foot.on;
      groundIn = foot.g + drift;
      landingTopIn = foot.top + drift;
      laid = lay(landingTopIn);
    }
    const chain = laid.chain;
    landingsLeftOut = laid.leftOut;
    riseIn = Math.max(0, level.surfaceIn - landingTopIn);
    risers = chain.reduce((n2, c) => n2 + c.leg.risers, 0);
    riserIn = Math.max(...chain.map((c) => c.leg.riserIn));
    treads = chain.reduce((n2, c) => n2 + Math.max(0, c.leg.risers - 1), 0);
    landing = chain.length > 1;
    stringers.count = count * chain.length;
    totalRunIn = chain.reduce((n2, c) => n2 + c.runF + (c.plat ? c.plat.b1 - c.plat.b0 : 0), 0);

    // The rails wanted: a handrail from four risers; guards on both open sides where the deck is more than 30 in. up.
    const want = stair.handrail === "auto" ? (risers >= HANDRAIL_FROM_RISERS ? (guard ? 2 : 1) : 0) : stair.handrail === "both" ? 2 : stair.handrail === "one" ? 1 : 0;
    railWanted = want as 0 | 1 | 2;
    railSides = rail.type !== "none" ? railWanted : 0;
    const metalBalusters = rail.type === "aluminum" || (rail.baluster === "round" && rail.type !== "cable" && rail.type !== "glass");
    const topMount = railMount === "top";
    const inFrom = topMount ? STAIR_TOP_MOUNT_IN : THICK_2X_IN / 2 + 1.75;
    const railPostNominal = input.postSize === "8x8" ? "6x6" : "4x4";

    // (The rails are drawn after the foot, as they always were: kept apart until then.)
    const railMembers: StairMember[] = [];
    const railMember = (role: StairRole, nominal: string, lengthIn: number, c: V2, cz: number, sx: number, sy: number, sz: number, yaw: number, tilt = 0) => {
      railMembers.push({ role, nominal, lengthIn, cx: c.x, cy: c.y, cz, sx, sy, sz, yaw, tilt, of: id });
    };
    /** One flight: `r` risers of `rIn` from `zTop` down, in its own frame — stringers, treads, risers, a beam under a long run, its rails. */
    const flight = (F: Frame, r: number, rIn: number, zTop: number, lastLeg: boolean, fromLanding: boolean, toLanding: boolean) => {
      const P2 = (a2: number, b2: number) => at2(F, a2, b2);
      const yawA = yawOf(F.u);
      const yawB = yawOf(F.n);
      const theta = Math.atan2(rIn, runIn);
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);
      const t = r - 1; // treads below the top surface inside this flight
      const runF = t * runIn;
      const L = Math.hypot(r * rIn, runF) + 8;
      stringers.lengthIn = Math.max(stringers.lengthIn, L);
      // The stringer's top line runs under the tread backs; the box hangs below it. (2026-10-12, owner: "the stairs in 3D
      // don't look like treads and risers": the line ran one riser higher — along the treads' fronts — so every stringer
      // stood up through every tread, 6 in. at its back, and a wide flight read as a ramp ribbed by its stringers.)
      const zA = zTop - treadThick - rIn;
      const zB = zTop - treadThick - r * rIn;
      const midB = runF / 2 - (STRINGER_DEPTH_IN / 2) * sinT;
      const midZ = (zA + zB) / 2 - (STRINGER_DEPTH_IN / 2) * cosT;
      for (const a2 of stringerAt) member("stringer", STRINGER_NOMINAL, L, P2(a2, midB), midZ, Math.hypot(runF, zA - zB), THICK_2X_IN, STRINGER_DEPTH_IN, yawB, -theta);
      hardware.stringerConnectors += count;
      // Treads and risers.
      const boardsPerTread = Math.ceil((runIn + TREAD_NOSING_IN) / boardPitch - 1e-9);
      for (let k = 1; k <= t; k++) {
        const zk = zTop - k * rIn;
        const bk = (k - 1) * runIn;
        for (let j = 0; j < boardsPerTread; j++) {
          const bw = Math.min(product.widthIn, runIn + TREAD_NOSING_IN - j * boardPitch);
          if (!(bw > 1)) continue;
          // From the riser behind out past the riser below: the nosing is in front (it was laid behind, under the riser above,
          // and the treads ended flush with the risers below them — no shadow line, nothing to read as a step).
          member("tread", product.nominal, w, P2(w / 2, bk + j * boardPitch + bw / 2), zk - treadThick / 2, w, bw, treadThick, yawA);
        }
        treadBoardLf += (boardsPerTread * w) / 12;
        // The riser board under this tread's nosing, closing the step below.
        const zr0 = zk - rIn;
        member("riser", "1x8", w, P2(w / 2, bk + runIn - 0.375), (zk - treadThick + zr0) / 2, w - RISER_SHORT_IN, 0.75, zk - treadThick - zr0, yawA);
        riserBoardLf += w / 12;
        if (rail.lighting === "post-caps-risers") hardware.riserLights += 1;
      }
      // The top riser board hangs off the deck's rim (or the landing's); the bottom one meets the pad (or the landing).
      riserBoardLf += w / 12;
      member("riser", "1x8", w, P2(w / 2, 0.375), zTop - treadThick - rIn / 2, w - RISER_SHORT_IN, 0.75, rIn - treadThick, yawA);
      hardware.treadScrewsSqFt += Math.round(((t + 1) * w * (runIn + TREAD_NOSING_IN)) / 144);
      // A mid-flight support when the cut stringers would span past 6 ft.
      if (runF > STRINGER_MAX_SPAN_IN) {
        midSupport = true;
        const bm = runF / 2;
        const zUnder = zTop - treadThick - rIn - (runF / 2 / runIn) * rIn - STRINGER_DEPTH_IN / cosT;
        member("stair-beam", "2x8", w, P2(w / 2, bm), zUnder - 7.25 / 2, w, THICK_2X_IN, 7.25, yawA);
        // (Under a flight that leaves a landing the posts stand a half inch farther in: turned a quarter, the beam's
        // end lay in its post's face and the two flickered.)
        const postIn = THICK_2X_IN / 2 + (fromLanding ? 1.5 : 1);
        for (const a2 of [postIn, w - postIn]) {
          const q = P2(a2, bm);
          const onLower = lastLeg && lands === "lower-deck";
          const g = onLower ? input.lowerLevel!.surfaceIn : input.groundAt(q.x, q.y);
          const f = footingFor(design, q.x, q.y, 6, input.postSize, design.footing.aboveGradeIn);
          f.groundIn = onLower ? g - design.footing.aboveGradeIn : g;
          footings.push(f);
          const bottom = f.groundIn + f.topIn;
          const h = Math.max(6, zUnder - 7.25 - bottom);
          member("stair-post", input.postSize, h, q, bottom + h / 2, 3.5, 3.5, h, 0);
          hardware.postBases += 1;
        }
      }
      // Its rails. AS THE DECK'S RAIL IS MOUNTED (2026-11-13): the posts follow the side of the deck the stair leaves —
      // TOP: on the treads, the same 2¾ in. in from the stair's edge as the deck's posts stand in from the deck's, from
      // the tread up (no post down the stringer, no tension tie); SIDE: on the stringer, down its depth. At a landing
      // the flight's rail runs to the landing's own corner post: no second post beside it.
      if (railSides > 0 && r > 0) {
        const rise = r * rIn;
        const sloped = Math.hypot(runF, rise);
        railLengthIn += sloped;
        const postsPerSide = Math.max(2, Math.ceil(sloped / STAIR_RAIL_POST_SPACING_IN) + 1);
        const perSide = Math.floor(sloped / (metalBalusters ? 4.5 : BALUSTER_SPACING_IN));
        balusters += perSide * railSides;
        const sides: number[] = railSides === 2 ? [inFrom, w - inFrom] : [w - inFrom];
        const slopeT = Math.atan2(rise, runF);
        for (const a2 of sides) {
          for (let k = 0; k < postsPerSide; k++) {
            if ((k === 0 && fromLanding) || (k === postsPerSide - 1 && toLanding)) continue;
            railPosts += 1;
            const b2 = (runF * k) / (postsPerSide - 1);
            const zn = zTop - (rise * b2) / Math.max(1, runF);
            if (topMount) {
              // The tread it stands on: the floor at the top, then a riser down for every tread's run.
              const foot = zTop - (b2 < 0.5 ? 0 : Math.min(Math.max(1, r - 1), Math.ceil(b2 / runIn - 1e-6)) * rIn);
              const h = zn + HANDRAIL_HEIGHT_IN + 6 - foot;
              railMember("stair-rail-post", railPostNominal, h, P2(a2, b2), foot + h / 2, 3.5, 3.5, h, 0);
              continue;
            }
            const h = HANDRAIL_HEIGHT_IN + 6 + STRINGER_DEPTH_IN;
            railMember("stair-rail-post", railPostNominal, h, P2(a2, b2), zn - STRINGER_DEPTH_IN + h / 2, 3.5, 3.5, h, 0);
            hardware.railPostTies += 1;
          }
          // The rails drawn an inch past each end (their ends clear the top and bottom risers' faces); the balusters a
          // quarter inch toward the stair's middle, so no face of theirs lies in a rail's (both flickered, 2026-10-11).
          railMember("stair-rail", "2x4", sloped, P2(a2, runF / 2), zTop - rise / 2 + HANDRAIL_HEIGHT_IN, sloped + 2, 1.5, 3.5, yawB, -slopeT);
          railMember("stair-rail", "2x4", sloped, P2(a2, runF / 2), zTop - rise / 2 + 4, sloped + 2, 1.5, 3.5, yawB, -slopeT);
          const inward = a2 < w / 2 ? STAIR_BALUSTER_IN_IN : -STAIR_BALUSTER_IN_IN;
          for (let k = 1; k < perSide; k++) {
            const b2 = ((sloped * k) / perSide) * Math.cos(slopeT);
            const zn = zTop - (rise * b2) / Math.max(1, runF);
            // Thin metal balusters where the deck's rail has them (lib/deck/rails, 2026-11-09): the stair matches the deck.
            railMember("stair-baluster", metalBalusters ? "¾-in. aluminum baluster" : "2x2", HANDRAIL_HEIGHT_IN - 4, P2(a2 + inward, b2), zn + 4 + (HANDRAIL_HEIGHT_IN - 4) / 2, metalBalusters ? 0.75 : 1.5, metalBalusters ? 0.75 : 1.5, HANDRAIL_HEIGHT_IN - 4, 0);
          }
        }
      }
    };

    /**
     * A landing: a 2x8 frame on its own posts and footings, the deck's boards over it, and — where the stair is railed —
     * a rail along every edge no flight comes to or leaves by, a post at each corner.
     */
    const platform = (F: Frame, pl: Plat, zL: number, turn: StairTurnKind, id2: string, auto: boolean) => {
      const P2 = (a2: number, b2: number) => at2(F, a2, b2);
      const yawA = yawOf(F.u);
      const yawB = yawOf(F.n);
      const wide = pl.a1 - pl.a0;
      const deep = pl.b1 - pl.b0;
      const frameTop = zL - treadThick;
      const am = (pl.a0 + pl.a1) / 2;
      const bm = (pl.b0 + pl.b1) / 2;
      // Two rims the landing's width, joists between them 16 in. apart.
      for (const b2 of [pl.b0 + THICK_2X_IN / 2, pl.b1 - THICK_2X_IN / 2]) member("landing-frame", "2x8", wide, P2(am, b2), frameTop - 7.25 / 2, wide, THICK_2X_IN, 7.25, yawA);
      // …the last of them closing the far side (a flight that leaves by that side hangs on it).
      const joistAt: number[] = [];
      for (let a2 = pl.a0 + THICK_2X_IN / 2; a2 < pl.a1 - THICK_2X_IN / 2 - 3; a2 += 16) joistAt.push(a2);
      joistAt.push(pl.a1 - THICK_2X_IN / 2);
      for (const a2 of joistAt) member("landing-frame", "2x8", deep - 2 * THICK_2X_IN, P2(a2, bm), frameTop - 7.25 / 2, THICK_2X_IN, deep - 2 * THICK_2X_IN, 7.25, yawA);
      member("landing-tread", product.nominal, wide, P2(am, bm), zL - treadThick / 2, wide, deep, treadThick, yawA);
      treadBoardLf += (Math.ceil(deep / boardPitch) * wide) / 12;
      hardware.treadScrewsSqFt += Math.round((wide * deep) / 144);
      // Its posts: one at each corner, two more under a long side (a switchback's landing).
      // Each post's centre 6 1/2 in. in from the landing's faces: clear, both ways, of the connectors of a flight that
      // hangs on that side (nearer the corner a connector lay in the post's face and the two flickered).
      const inset = 6.5;
      const as = wide > 96 ? [pl.a0 + inset, am, pl.a1 - inset] : [pl.a0 + inset, pl.a1 - inset];
      const share = Math.max(10, Math.round((wide * deep) / 144 / (as.length * 2) + (w * 4 * runIn) / 144 / 2));
      let low = Infinity;
      for (const a2 of as) {
        for (const b2 of [pl.b0 + inset, pl.b1 - inset]) {
          const q = P2(a2, b2);
          // (Never a post more than 30 ft tall: the ground far down a steep fall is not where a landing is footed.)
          const g = Math.max(input.groundAt(q.x, q.y), zL - 360);
          low = Math.min(low, g);
          const f = footingFor(design, q.x, q.y, share, input.postSize, design.footing.aboveGradeIn);
          f.groundIn = g;
          footings.push(f);
          const bottom = g + f.topIn;
          const h = Math.max(6, frameTop - 7.25 - bottom);
          member("stair-post", input.postSize, h, q, bottom + h / 2, 3.5, 3.5, h, 0);
          hardware.postBases += 1;
        }
      }
      const c = P2(am, bm);
      landingsOut.push({ id: id2, auto, heightIn: Math.round(zL * 100) / 100, turn, dir: dirOf(F.n), widthIn: Math.round(wide), depthIn: Math.round(deep), posts: as.length * 2, aboveGroundIn: Math.round(zL - low), x: c.x, y: c.y });
      // Its rails: where the stair is guarded, or the landing itself stands more than 30 in. up.
      const guarded = railSides === 2 || (railSides > 0 && zL - low > GUARD_REQUIRED_ABOVE_IN);
      if (!guarded) return;
      // The edges nobody walks through: [a0, b0, a1, b1] each, along a or along b.
      const open: Array<[number, number, number, number]> = [];
      if (turn === "straight") open.push([pl.a0, pl.b0, pl.a0, pl.b1], [pl.a1, pl.b0, pl.a1, pl.b1]);
      else if (turn === "left" || turn === "right") {
        const L = leftOf(F.n);
        const plus = (turn === "left") === (F.u.x * L.x + F.u.y * L.y > 0);
        open.push([pl.a0, pl.b1, pl.a1, pl.b1], plus ? [pl.a0, pl.b0, pl.a0, pl.b1] : [pl.a1, pl.b0, pl.a1, pl.b1]);
      } else open.push([pl.a0, pl.b0, pl.a0, pl.b1], [pl.a1, pl.b0, pl.a1, pl.b1], [pl.a0, pl.b1, pl.a1, pl.b1]);
      // A post at every corner of the landing — the flights' rails run to them — standing on its boards.
      const corner = STAIR_TOP_MOUNT_IN;
      const postH = HANDRAIL_HEIGHT_IN + 6;
      for (const a2 of [pl.a0 + corner, pl.a1 - corner]) {
        for (const b2 of [pl.b0 + corner, pl.b1 - corner]) {
          railMember("stair-rail-post", railPostNominal, postH, P2(a2, b2), zL + postH / 2, 3.5, 3.5, postH, 0);
          railPosts += 1;
        }
      }
      for (const [a0, b0, a1, b1] of open) {
        const alongA = Math.abs(b1 - b0) < 0.5;
        const len = (alongA ? Math.abs(a1 - a0) : Math.abs(b1 - b0)) - 2 * corner;
        if (!(len > 6)) continue;
        // The rail's line: its edge, a post's inset in from it.
        const ca = alongA ? (a0 + a1) / 2 : a0 + (Math.abs(a0 - pl.a0) < 0.5 ? corner : -corner);
        const cb = alongA ? b0 + (Math.abs(b0 - pl.b0) < 0.5 ? corner : -corner) : (b0 + b1) / 2;
        const yaw = alongA ? yawA : yawB;
        railLengthIn += len / Math.max(1, railSides);
        railMember("stair-rail", "2x4", len, P2(ca, cb), zL + HANDRAIL_HEIGHT_IN, len, 1.5, 3.5, yaw, 0);
        railMember("stair-rail", "2x4", len, P2(ca, cb), zL + 4, len, 1.5, 3.5, yaw, 0);
        // A post in the middle of a long edge.
        const mids = Math.max(0, Math.ceil(len / STAIR_RAIL_POST_SPACING_IN) - 1);
        for (let k = 1; k <= mids; k++) {
          const tt = k / (mids + 1) - 0.5;
          railMember("stair-rail-post", railPostNominal, postH, P2(alongA ? ca + tt * len : ca, alongA ? cb : cb + tt * len), zL + postH / 2, 3.5, 3.5, postH, 0);
          railPosts += 1;
        }
        const n2 = Math.floor(len / (metalBalusters ? 4.5 : BALUSTER_SPACING_IN));
        balusters += Math.max(0, n2 - 1);
        // The balusters a quarter inch toward the landing's middle: no face of theirs in a rail's.
        const inA = alongA ? 0 : ca < am ? STAIR_BALUSTER_IN_IN : -STAIR_BALUSTER_IN_IN;
        const inB = alongA ? (cb < bm ? STAIR_BALUSTER_IN_IN : -STAIR_BALUSTER_IN_IN) : 0;
        for (let k = 1; k < n2; k++) {
          const tt = k / n2 - 0.5;
          railMember("stair-baluster", metalBalusters ? "¾-in. aluminum baluster" : "2x2", HANDRAIL_HEIGHT_IN - 4, P2((alongA ? ca + tt * len : ca) + inA, (alongA ? cb : cb + tt * len) + inB), zL + 4 + (HANDRAIL_HEIGHT_IN - 4) / 2, metalBalusters ? 0.75 : 1.5, metalBalusters ? 0.75 : 1.5, HANDRAIL_HEIGHT_IN - 4, 0);
        }
      }
    };

    // Built, top to foot.
    const rects: V2[][] = [];
    path = [at2(chain[0].F, w / 2, 0)];
    chain.forEach((c, i) => {
      const lastLeg = i === chain.length - 1;
      flight(c.F, c.leg.risers, c.leg.riserIn, c.leg.topIn, lastLeg, i > 0, !!c.plat);
      flightsOut.push({ risers: c.leg.risers, riserIn: Math.round(c.leg.riserIn * 100) / 100, riseIn: Math.round(c.leg.riseIn * 100) / 100, runIn: Math.round(c.runF * 10) / 10, topIn: Math.round(c.leg.topIn * 100) / 100 });
      if (c.runF > 0.5) rects.push([at2(c.F, 0, 0), at2(c.F, w, 0), at2(c.F, w, c.runF), at2(c.F, 0, c.runF)]);
      path.push(at2(c.F, w / 2, c.runF));
      if (c.plat && c.leg.landing) {
        platform(c.F, c.plat, c.leg.footIn, c.leg.landing.turn, c.leg.landing.id, c.leg.landing.auto);
        rects.push([at2(c.F, c.plat.a0, c.plat.b0), at2(c.F, c.plat.a1, c.plat.b0), at2(c.F, c.plat.a1, c.plat.b1), at2(c.F, c.plat.a0, c.plat.b1)]);
        path.push(at2(c.F, w / 2, (c.plat.b0 + c.plat.b1) / 2));
        const nx = chain[i + 1];
        if (nx) path.push(at2(nx.F, w / 2, 0));
      }
    });

    // The foot: a kicker on a pad, pavers, or the patio.
    const lastC = chain[chain.length - 1];
    const PF = (a2: number, b2: number) => at2(lastC.F, a2, b2);
    const yawF = yawOf(lastC.F.u);
    const bFoot = lastC.runF;
    const padWidthIn = w + 2 * PAD_APRON_IN;
    const padLengthIn = PAD_OUT_IN + PAD_APRON_IN;
    if (lands === "ground") {
      if (stair.landing === "pad") {
        const cuFt = (padWidthIn * padLengthIn * PAD_THICK_IN) / 1728;
        pad = { lengthIn: padLengthIn, widthIn: padWidthIn, thickIn: PAD_THICK_IN, cuFt: Math.round(cuFt * 100) / 100, bags: Math.ceil(cuFt / BAG_CUFT - 1e-9) };
        member("pad", "concrete", padLengthIn, PF(w / 2, bFoot - PAD_APRON_IN + padLengthIn / 2), groundIn + PAD_TOP_IN - PAD_THICK_IN / 2, padWidthIn, padLengthIn, PAD_THICK_IN, yawF);
        hardware.anchors += 2;
      } else if (stair.landing === "grade") {
        pavers = Math.ceil((padWidthIn * padLengthIn) / 144);
        member("pad", "pavers", padLengthIn, PF(w / 2, bFoot - PAD_APRON_IN + padLengthIn / 2), groundIn + PAVER_TOP_IN - 1.2, padWidthIn, padLengthIn, 2.4, yawF);
      }
      rects.push([PF(0, bFoot), PF(w, bFoot), PF(w, bFoot + PAD_OUT_IN), PF(0, bFoot + PAD_OUT_IN)]);
    }
    member("kicker", "2x4", w, PF(w / 2, bFoot - 1.75 - KICKER_BACK_IN), landingTopIn + 0.75, w, 3.5, 1.5, yawF);
    members.push(...railMembers);

    // Its outline in plan: every flight, every landing and the foot as one ring, from the edge of the deck it leaves.
    const local = (p: V2): [number, number] => [(p.x - O.x) * u.x + (p.y - O.y) * u.y, (p.x - O.x) * nrm.x + (p.y - O.y) * nrm.y];
    const boxes = rects.map((r): [number, number, number, number] => {
      const q = r.map(local);
      return [Math.min(...q.map((v) => v[0])), Math.min(...q.map((v) => v[1])), Math.max(...q.map((v) => v[0])), Math.max(...q.map((v) => v[1]))];
    });
    footprint = rectsOutline(boxes).map(([a2, b2]) => P(a2, b2));

    // Where it must not go: into the house's wall; and back under the deck only with room to walk there.
    const againstHouse = design.placement !== "detached" && level.id === "upper";
    for (const r of rects) {
      const xs2 = r.map((q) => q.x);
      const ys2 = r.map((q) => q.y);
      if (againstHouse && Math.min(...ys2) < level.y0 - 1 && Math.max(...xs2) > level.x0 - design.house.leftFt * 12 + 1 && Math.min(...xs2) < level.x0 + W + design.house.rightFt * 12 - 1) hitsHouse = true;
    }
    // Under the deck: every tread and landing past the first flight that lies inside the deck's own rectangle, and
    // the room over it to the underside of the deck's joists.
    const underDeck = (q: V2) => q.x > level.x0 + 1 && q.x < level.x0 + W - 1 && q.y > level.y0 + 1 && q.y < level.y0 + level.frontAt(Math.max(0, Math.min(W, q.x - level.x0))) - 1;
    const roomOver = (q: V2, walkIn: number) => {
      if (!underDeck(q)) return;
      const clear = Math.round(level.joistBottomIn - walkIn);
      underDeckClearIn = underDeckClearIn === null ? clear : Math.min(underDeckClearIn, clear);
    };
    chain.forEach((c, i) => {
      if (i > 0) for (let k = 0; k <= Math.max(0, c.leg.risers - 1); k++) roomOver(at2(c.F, w / 2, k * runIn), c.leg.topIn - k * c.leg.riserIn);
      if (c.plat) roomOver(at2(c.F, (c.plat.a0 + c.plat.a1) / 2, (c.plat.b0 + c.plat.b1) / 2), c.leg.footIn);
    });
  } else if (kind === "box" && risers > 0 && level.sides && level.sides.length >= 3) {
    /* ── steps wrapping the deck ALONG ITS OWN OUTLINE (2026-11-14) ───────
     * The owner, of a picture of wide steps running round a deck's angled edges: "the steps could be all around the
     * deck". The box steps went round the rectangle the deck fits in — right for a rectangle only. They now follow the
     * deck's edges: the front (every part of it, the cuts at its corners, the sides of a bay), the front and both ends,
     * or every open edge. Each level is the outline set out one more run; where two edges meet, the level turns the
     * corner with them and its boards are mitred there. */
    const ring = level.sides.map((sd) => ({ x: sd.x0, y: sd.y0 }));
    const edges = ringEdges(ring);
    const xs = ring.map((q) => q.x);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const pick = (i: number) => {
      const sd = level.sides![i];
      if (sd.house || edges[i].length < 0.5) return false;
      if (stair.wrapSides === 4) return true;
      if (sd.side === "back") return false;
      if (stair.wrapSides === 3) return true;
      // The front alone: not the deck's two ends (its outermost sides).
      const upright = Math.abs(sd.x1 - sd.x0) < 0.5;
      return !(upright && (Math.abs(sd.x0 - minX) < 0.5 || Math.abs(sd.x0 - maxX) < 0.5));
    };
    const n = edges.length;
    const on = edges.map((_, i) => pick(i));
    // The runs of edges the steps go along, in order round the deck (one closed run when they go all the way round).
    const chains: number[][] = [];
    if (on.every(Boolean)) chains.push(edges.map((_, i) => i));
    else {
      const start = on.findIndex((v, i) => v && !on[(i - 1 + n) % n]);
      for (let c = 0, i = start; start >= 0 && c < n; c++, i = (i + 1) % n) {
        if (!on[i]) continue;
        if (!on[(i - 1 + n) % n]) chains.push([]);
        chains[chains.length - 1].push(i);
      }
    }
    const closed = on.every(Boolean);
    const frameJoistSpacing = product.family === "composite" || product.family === "pvc" || product.family === "mineral" ? 12 : 16;
    const boardsDeep = Math.ceil((runIn + TREAD_NOSING_IN) / boardPitch - 1e-9);
    const rings: NonNullable<StairBuild["treadRings"]> = [];
    const wrapped: NonNullable<StairBuild["wrapped"]> = [];
    let longest: V2[] = [];
    let longestLen = -1;
    for (const chain of chains) {
      const m = chain.length;
      // At each corner of the run, the way a level's corner moves out with it: along the mitre where two of its edges
      // meet, square out from the edge at an end of the run.
      const outOf = (i: number) => ({ x: edges[i].outX, y: edges[i].outY });
      const mitre = (a: V2, b: V2): V2 => {
        const d = 1 + a.x * b.x + a.y * b.y;
        return d < 0.05 ? a : { x: (a.x + b.x) / d, y: (a.y + b.y) / d };
      };
      const corner = (j: number): { V: V2; m: V2 } => {
        // j = 0…m: the corner before the j-th edge of the run.
        const first = j === 0;
        const last = j === m;
        const e = edges[chain[Math.min(j, m - 1)]];
        const V = last ? e.B : e.A;
        if ((first || last) && !closed) return { V, m: outOf(chain[first ? 0 : m - 1]) };
        const prev = chain[(j - 1 + m) % m];
        const next = chain[j % m];
        return { V, m: mitre(outOf(prev), outOf(next)) };
      };
      const at = (j: number, o: number): V2 => {
        const c = corner(j);
        return { x: c.V.x + c.m.x * o, y: c.V.y + c.m.y * o };
      };
      for (const i of chain) wrapped.push({ x0: edges[i].A.x, y0: edges[i].A.y, x1: edges[i].B.x, y1: edges[i].B.y });
      for (let k = 1; k <= treads; k++) {
        const d0 = (k - 1) * runIn;
        const d1 = k * runIn;
        const zTop = level.surfaceIn - k * riserIn;
        const frameTop = zTop - treadThick;
        for (let j = 0; j < m; j++) {
          const e = edges[chain[j]];
          const a0 = at(j, d0);
          const b0 = at(j + 1, d0);
          const a1 = at(j, d1);
          const b1 = at(j + 1, d1);
          const along = (p: V2, q: V2) => (q.x - p.x) * e.ux + (q.y - p.y) * e.uy;
          const L0 = along(a0, b0);
          const L1 = along(a1, b1);
          // (An edge the corners beside it have closed over at this level — a narrow recess — has no step of its own.)
          if (!(L0 > 1 && L1 > 1)) continue;
          const midL = (L0 + L1) / 2;
          // The frame under it: the rectangle that fits between the two mitres (the stretch of the edge BOTH its inner
          // and its outer line cover), so no two frames lie in each other at a corner.
          const lo = Math.max(along(e.A, a0), along(e.A, a1));
          const hi = Math.min(along(e.A, b0), along(e.A, b1));
          const short = hi - lo;
          const mid = (lo + hi) / 2;
          const off = (d0 + d1) / 2;
          const joists = Math.ceil(midL / frameJoistSpacing) + 1;
          boxFrameLf += (2 * midL + joists * (runIn - 2 * THICK_2X_IN)) / 12;
          if (short > 2) member("box-frame", BOX_FRAME_NOMINAL, short, { x: e.A.x + e.ux * mid + e.outX * off, y: e.A.y + e.uy * mid + e.outY * off }, frameTop - 5.5 / 2, short - 0.5, runIn - 0.5, 5.5, e.yaw);
          // The tread: boards along the edge, each cut to the mitres at its two ends.
          for (let r = 0; r < boardsDeep; r++) {
            const oa = d0 + r * boardPitch;
            const ob = Math.min(d1 + TREAD_NOSING_IN, oa + product.widthIn);
            if (!(ob - oa > 0.25)) continue;
            const pa = at(j, oa);
            const pb = at(j + 1, oa);
            const qa = at(j, ob);
            const qb = at(j + 1, ob);
            if (!(along(pa, pb) > 0.5 && along(qa, qb) > 0.5)) continue;
            rings.push({ ring: [pa.x, pa.y, pb.x, pb.y, qb.x, qb.y, qa.x, qa.y].map((v) => Math.round(v * 100) / 100), z: zTop });
            treadBoardLf += (along(pa, pb) + along(qa, qb)) / 24;
          }
          // The riser board on the level's outer face — clear of the next edge's at an inside corner.
          const turnA = j > 0 || closed ? edges[chain[(j - 1 + m) % m]].turnAtB : 0;
          const turnB = j < m - 1 || closed ? e.turnAtB : 0;
          const trimA = turnA < -0.01 ? 0.75 * Math.tan(-turnA / 2) : 0;
          const trimB = turnB < -0.01 ? 0.75 * Math.tan(-turnB / 2) : 0;
          const rl = L1 - trimA - trimB;
          if (rl > 1) {
            const mx = (a1.x + b1.x) / 2 + e.ux * ((trimA - trimB) / 2) + e.outX * 0.375;
            const my = (a1.y + b1.y) / 2 + e.uy * ((trimA - trimB) / 2) + e.outY * 0.375;
            member("riser", "1x8", rl, { x: mx, y: my }, zTop - treadThick - riserIn / 2, rl, 0.75, riserIn - treadThick, e.yaw);
          }
          riserBoardLf += L1 / 12;
          hardware.treadScrewsSqFt += Math.round((midL * (runIn + TREAD_NOSING_IN)) / 144);
          if (rail.lighting === "post-caps-risers") hardware.riserLights += Math.max(1, Math.round(L1 / 72));
          if (k === treads) {
            boxBlocks += Math.ceil(L1 / BOX_BLOCK_SPACING_IN) + 1;
            gravelSqFt += (L1 * (runIn + 6)) / 144;
          }
        }
      }
      // What the steps cover on the ground: the run of the deck's edge, and back along the lowest level's outer line.
      const D2 = treads * runIn;
      const inner: V2[] = [];
      const outer: V2[] = [];
      for (let j = 0; j <= (closed ? m - 1 : m); j++) {
        inner.push(corner(j).V);
        outer.push(at(j, D2));
      }
      const len = chain.reduce((a, i) => a + edges[i].length, 0);
      if (len > longestLen) {
        longestLen = len;
        longest = closed ? outer : [...inner, ...outer.reverse()];
      }
    }
    totalRunIn = treads * runIn;
    footprint = longest;
    gravelSqFt = Math.round(gravelSqFt);
    treadRingsOut = rings;
    wrappedOut = wrapped;
  } else if (kind === "box" && risers > 0) {
    /* ── box steps wrapping the deck ─────────────────────────────────── */
    const sides = stair.wrapSides;
    const frameJoistSpacing = product.family === "composite" || product.family === "pvc" || product.family === "mineral" ? 12 : 16;
    const x0 = level.x0;
    const y0 = level.y0;
    const boardsDeep = Math.ceil((runIn + TREAD_NOSING_IN) / boardPitch - 1e-9);
    for (let k = 1; k <= treads; k++) {
      const d = k * runIn;
      const zTop = level.surfaceIn - k * riserIn;
      const frameTop = zTop - treadThick;
      // The ring of this level: the front, the two sides (3), the back (4). Each side a box `run` deep.
      const segs: Array<{ c: V2; L: number; yaw: number; depthDir: V2 }> = [];
      const front = { c: { x: x0 + W / 2, y: y0 + D + d - runIn / 2 }, L: sides === 1 ? W : W + 2 * d, yaw: 0, depthDir: { x: 0, y: 1 } };
      segs.push(front);
      if (sides >= 3) {
        const yStart = sides === 4 ? y0 - d : y0;
        const Ls = D + d - (sides === 4 ? -d : 0) - runIn;
        segs.push({ c: { x: x0 - d + runIn / 2, y: yStart + Ls / 2 }, L: Ls, yaw: Math.PI / 2, depthDir: { x: -1, y: 0 } });
        segs.push({ c: { x: x0 + W + d - runIn / 2, y: yStart + Ls / 2 }, L: Ls, yaw: Math.PI / 2, depthDir: { x: 1, y: 0 } });
      }
      if (sides === 4) segs.push({ c: { x: x0 + W / 2, y: y0 - d + runIn / 2 }, L: W + 2 * d, yaw: 0, depthDir: { x: 0, y: -1 } });
      for (const sg of segs) {
        const along = sg.yaw === 0 ? { x: 1, y: 0 } : { x: 0, y: 1 };
        // Two 2x6 rims the length of the side, joists between them.
        const joists = Math.ceil(sg.L / frameJoistSpacing) + 1;
        boxFrameLf += (2 * sg.L + joists * (runIn - 2 * THICK_2X_IN)) / 12;
        member("box-frame", BOX_FRAME_NOMINAL, sg.L, sg.c, frameTop - 5.5 / 2, sg.L, runIn, 5.5, sg.yaw);
        member("box-tread", product.nominal, sg.L, { x: sg.c.x + sg.depthDir.x * (TREAD_NOSING_IN / 2), y: sg.c.y + sg.depthDir.y * (TREAD_NOSING_IN / 2) }, zTop - treadThick / 2, sg.L + (sg.yaw === 0 ? 0 : 0), runIn + TREAD_NOSING_IN, treadThick, sg.yaw);
        treadBoardLf += (boardsDeep * sg.L) / 12;
        // The riser board on the outer face.
        member("riser", "1x8", sg.L, { x: sg.c.x + sg.depthDir.x * (runIn / 2 + 0.375), y: sg.c.y + sg.depthDir.y * (runIn / 2 + 0.375) }, zTop - treadThick - riserIn / 2, sg.L + 1.5, 0.75, riserIn - treadThick, sg.yaw);
        riserBoardLf += sg.L / 12;
        hardware.treadScrewsSqFt += Math.round((sg.L * (runIn + TREAD_NOSING_IN)) / 144);
        if (rail.lighting === "post-caps-risers") hardware.riserLights += Math.max(1, Math.round(sg.L / 72));
        void along;
        if (k === treads) {
          boxBlocks += Math.ceil(sg.L / BOX_BLOCK_SPACING_IN) + 1;
          gravelSqFt += (sg.L * (runIn + 6)) / 144;
        }
      }
    }
    totalRunIn = treads * runIn;
    const d = totalRunIn;
    footprint = sides === 4 ? [{ x: x0 - d, y: y0 - d }, { x: x0 + W + d, y: y0 - d }, { x: x0 + W + d, y: y0 + D + d }, { x: x0 - d, y: y0 + D + d }] : sides === 3 ? [{ x: x0 - d, y: y0 }, { x: x0 + W + d, y: y0 }, { x: x0 + W + d, y: y0 + D + d }, { x: x0 - d, y: y0 + D + d }] : [{ x: x0, y: y0 + D }, { x: x0 + W, y: y0 + D }, { x: x0 + W, y: y0 + D + d }, { x: x0, y: y0 + D + d }];
    gravelSqFt = Math.round(gravelSqFt);
  }

  // Nothing built (one step or less): the stair is still a line on the plan where it was asked for.
  if (footprint.length === 0) footprint = [P(0, 0), P(w, 0)];
  return {
    design: stair,
    level: level.id,
    kind,
    riseIn: Math.round(riseIn * 100) / 100,
    risers,
    riserIn: Math.round(riserIn * 100) / 100,
    runIn,
    treads,
    totalRunIn: Math.round(totalRunIn),
    widthIn: w,
    groundIn: Math.round(groundIn * 10) / 10,
    lands,
    stringers,
    midSupport,
    landing,
    flights: flightsOut,
    landings: landingsOut,
    path,
    pad,
    pavers,
    rail: { sides: railSides, wanted: railWanted, lengthIn: Math.round(railLengthIn), posts: railPosts, balusters, handrailOnly: railSides === 1 && !guard, mount: railMount },
    guard,
    members,
    footings,
    footprint,
    ...(treadRingsOut ? { treadRings: treadRingsOut } : {}),
    ...(wrappedOut ? { wrapped: wrappedOut } : {}),
    treadBoardLf: Math.round(treadBoardLf * 10) / 10,
    riserBoardLf: Math.round(riserBoardLf * 10) / 10,
    boxFrameLf: Math.round(boxFrameLf * 10) / 10,
    boxBlocks,
    gravelSqFt,
    hardware,
    flags: { tooTallForBox, beyondRun: false, narrow: narrow || w < 36, landingsLeftOut, hitsHouse, underDeckClearIn },
  };
}

/**
 * A stair's first flight as a stair of its own — from the deck down to the first landing — for a drawing of ONE flight
 * (the permit set's stair section, the stringer's layout). A stair with no landing is itself.
 */
export function firstFlightOf(st: StairBuild): StairBuild {
  const f = st.flights[0];
  if (!st.landings.length || !f) return st;
  return { ...st, risers: f.risers, riserIn: f.riserIn, treads: Math.max(0, f.risers - 1), riseIn: f.riseIn, totalRunIn: Math.round(f.runIn), pad: null, midSupport: f.runIn > STRINGER_MAX_SPAN_IN };
}

/** The code's words for a stair, in the state's own figures (lib/deck/stateCodes): riser, tread, width, handrail. */
export function stairRules(code: DeckStateCode = IRC_CODE) {
  return {
    riser: cite(code, "R311.7.5.1", `risers no more than ${inFrac(code.riserMaxIn)}`),
    tread: cite(code, "R311.7.5.2", `treads at least ${code.treadMinIn} in.`),
    width: cite(code, "R311.7.1", "36 in. clear"),
    handrail: cite(code, "R311.7.8", "a handrail from four risers, 34 to 38 in."),
    landing: cite(code, "R311.7.3 and R311.7.6", "a landing after 12 ft 3 in. of rise, 36 in. deep"),
    stringer: "AWC DCA 6 — 2x12 cut stringers, 6 ft between supports, on a footing or a pad",
    guard: cite(code, "R312.1", "guards on the open sides of a stair more than 30 in. up"),
    box: "Box steps: three risers at most (trade practice); more needs stringers",
  } as const;
}
/** The IRC's own words, where no state is known. */
export const STAIR_RULES = stairRules();
