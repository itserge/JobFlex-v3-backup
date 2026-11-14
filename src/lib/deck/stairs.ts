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
import { railMountOf, type DeckDesign, type RailDesign, type RailMount, type StairDesign } from "./design";

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
  landing: boolean;
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
  /** Feet of deck boards for the treads and of riser boards. */
  treadBoardLf: number;
  riserBoardLf: number;
  /** Feet of 2x6 in the box frames, blocks under them, gravel under the lowest. */
  boxFrameLf: number;
  boxBlocks: number;
  gravelSqFt: number;
  hardware: { stringerConnectors: number; anchors: number; postBases: number; railPostTies: number; riserLights: number; treadScrewsSqFt: number };
  flags: { tooTallForBox: boolean; beyondRun: boolean; narrow: boolean };
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
  const yawU = Math.atan2(u.y, u.x);
  const yawN = Math.atan2(nrm.y, nrm.x);
  const narrow = w < 36;
  const id = stair.id;
  void D;

  // Where it lands: on the lower deck when its foot is over it, else the ground.
  const probe = (b: number) => P(w / 2, b);
  const lowerUnder = (p: V2) => !!input.lowerLevel && level.id === "upper" && p.x >= input.lowerLevel.x0 - 0.5 && p.x <= input.lowerLevel.x0 + input.lowerLevel.widthIn + 0.5 && p.y >= input.lowerLevel.y0 - 0.5 && p.y <= input.lowerLevel.y0 + input.lowerLevel.depthIn + 0.5;
  const footGuess = probe(TREAD_RUN_IN * 3);
  const lands: StairBuild["lands"] = lowerUnder(footGuess) ? "lower-deck" : "ground";
  const groundIn = lands === "lower-deck" ? input.lowerLevel!.surfaceIn : input.groundAt(footGuess.x, footGuess.y);
  const landingTopIn = lands === "lower-deck" ? groundIn : stair.landing === "pad" ? groundIn + PAD_TOP_IN : stair.landing === "grade" ? groundIn + PAVER_TOP_IN : groundIn;
  const riseIn = Math.max(0, level.surfaceIn - landingTopIn);
  // One riser or less is a step the level below already makes: nothing to build.
  const risers = riseIn > (input.riserMaxIn ?? RISER_MAX_IN) ? stairRisers(riseIn) : 0;
  const riserIn = risers > 0 ? riseIn / risers : 0;
  const runIn = TREAD_RUN_IN;
  const treads = Math.max(0, risers - 1);
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
  const wantsBox = stair.wrap && stair.side === "front";
  const tooTallForBox = wantsBox && risers > BOX_STEP_MAX_RISERS;
  const kind: StairBuild["kind"] = wantsBox && !tooTallForBox ? "box" : "flight";
  const stringerSpacing = stringerSpacingFor(product);
  const stringers = { count: 0, nominal: STRINGER_NOMINAL, lengthIn: 0, spacingIn: stringerSpacing };
  const member = (role: StairRole, nominal: string, lengthIn: number, c: V2, cz: number, sx: number, sy: number, sz: number, yaw: number, tilt = 0) => {
    members.push({ role, nominal, lengthIn, cx: c.x, cy: c.y, cz, sx, sy, sz, yaw, tilt, of: id });
  };

  if (kind === "flight" && risers > 0) {
    /* ── a flight ──────────────────────────────────────────────────── */
    // A landing splits a tall climb; the stringer's horizontal span past 6 ft gets a beam.
    landing = riseIn > FLIGHT_MAX_RISE_IN;
    const flights = landing ? 2 : 1;
    const risersA = landing ? Math.ceil(risers / 2) : risers;
    const risersB = risers - risersA;
    const runA = (risersA - (landing ? 0 : 1)) * runIn;
    totalRunIn = landing ? runA + LANDING_DEPTH_IN + (risersB - 1) * runIn : runA;
    const theta = Math.atan2(riserIn, runIn);
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    const count = Math.max(narrow ? 2 : 3, Math.floor((w - THICK_2X_IN) / stringerSpacing) + 1);
    stringers.count = count * flights;
    const stringerAt: number[] = [];
    // The outer stringers an inch in from the treads' ends, the treads and risers running past them (2026-10-11: flush,
    // a tread's end lay in the stringer's face and the 3D flickered between them).
    for (let i = 0; i < count; i++) stringerAt.push(TREAD_PAST_STRINGER_IN + THICK_2X_IN / 2 + ((w - THICK_2X_IN - 2 * TREAD_PAST_STRINGER_IN) * i) / (count - 1));

    /** One flight: `r` risers, its top riser face at (b0, zTop), landing on something at zTop − r·riser. */
    const flight = (tag: string, r: number, b0: number, zTop: number, lastTreadIsLanding: boolean) => {
      const t = r - 1; // treads below the top surface inside this flight
      const runF = (lastTreadIsLanding ? r : t) * runIn;
      const L = Math.hypot(r * riserIn, runF) + 8;
      stringers.lengthIn = Math.max(stringers.lengthIn, L);
      // The stringer's top line runs under the tread backs; the box hangs below it. (2026-10-12, owner: "the stairs in 3D
      // don't look like treads and risers": the line ran one riser higher — along the treads' fronts — so every stringer
      // stood up through every tread, 6 in. at its back, and a wide flight read as a ramp ribbed by its stringers.)
      const zA = zTop - treadThick - riserIn;
      const zB = zTop - treadThick - r * riserIn + (lastTreadIsLanding ? 0 : riserIn) - riserIn;
      const bA = b0;
      const bB = b0 + runF;
      const midB = (bA + bB) / 2 - (STRINGER_DEPTH_IN / 2) * sinT;
      const midZ = (zA + zB) / 2 - (STRINGER_DEPTH_IN / 2) * cosT;
      for (const a of stringerAt) member("stringer", STRINGER_NOMINAL, L, P(a, midB), midZ, Math.hypot(bB - bA, zA - zB), THICK_2X_IN, STRINGER_DEPTH_IN, yawN, -theta);
      hardware.stringerConnectors += count;
      // Treads and risers.
      const boardsPerTread = Math.ceil((runIn + TREAD_NOSING_IN) / boardPitch - 1e-9);
      for (let k = 1; k <= t; k++) {
        const zk = zTop - k * riserIn;
        const bk = b0 + (k - 1) * runIn;
        for (let j = 0; j < boardsPerTread; j++) {
          const bw = Math.min(product.widthIn, runIn + TREAD_NOSING_IN - j * boardPitch);
          if (!(bw > 1)) continue;
          // From the riser behind out past the riser below: the nosing is in front (it was laid behind, under the riser above,
          // and the treads ended flush with the risers below them — no shadow line, nothing to read as a step).
          member("tread", product.nominal, w, P(w / 2, bk + j * boardPitch + bw / 2), zk - treadThick / 2, w, bw, treadThick, yawU);
        }
        treadBoardLf += (boardsPerTread * w) / 12;
        // The riser board under this tread's nosing, closing the step below.
        const zr0 = zk - riserIn;
        member("riser", "1x8", w, P(w / 2, bk + runIn - 0.375), (zk - treadThick + zr0) / 2, w - RISER_SHORT_IN, 0.75, zk - treadThick - zr0, yawU);
        riserBoardLf += w / 12;
        if (rail.lighting === "post-caps-risers") hardware.riserLights += 1;
      }
      // The top riser board hangs off the deck's rim; the bottom one meets the pad.
      riserBoardLf += w / 12;
      member("riser", "1x8", w, P(w / 2, b0 + 0.375), zTop - treadThick - riserIn / 2, w - RISER_SHORT_IN, 0.75, riserIn - treadThick, yawU);
      hardware.treadScrewsSqFt += Math.round(((t + 1) * w * (runIn + TREAD_NOSING_IN)) / 144);
      // A mid-flight support when the cut stringers would span past 6 ft.
      if (runF > STRINGER_MAX_SPAN_IN) {
        midSupport = true;
        const bm = b0 + runF / 2;
        const zUnder = zTop - treadThick - riserIn - (runF / 2 / runIn) * riserIn - STRINGER_DEPTH_IN / cosT;
        member("stair-beam", "2x8", w, P(w / 2, bm), zUnder - 7.25 / 2, w, THICK_2X_IN, 7.25, yawU);
        for (const a of [THICK_2X_IN / 2 + 1, w - THICK_2X_IN / 2 - 1]) {
          const q = P(a, bm);
          const g = lands === "lower-deck" ? input.lowerLevel!.surfaceIn : input.groundAt(q.x, q.y);
          const f = footingFor(design, q.x, q.y, 6, input.postSize, design.footing.aboveGradeIn);
          f.groundIn = lands === "lower-deck" ? g - design.footing.aboveGradeIn : g;
          footings.push(f);
          const bottom = f.groundIn + f.topIn;
          const h = Math.max(6, zUnder - 7.25 - bottom);
          member("stair-post", input.postSize, h, q, bottom + h / 2, 3.5, 3.5, h, 0);
          hardware.postBases += 1;
        }
      }
      return { bEnd: b0 + runF, zEnd: zTop - r * riserIn, tag };
    };

    const topB = 0;
    const topZ = level.surfaceIn;
    const A = flight("a", risersA, topB, topZ, landing);
    if (landing) {
      // The landing: a 2x8 frame on four posts, treads over it.
      const b0 = A.bEnd;
      const zL = A.zEnd;
      const frameTop = zL - treadThick;
      for (const [a0, a1, b, along] of [[0, w, b0 + THICK_2X_IN / 2, true], [0, w, b0 + LANDING_DEPTH_IN - THICK_2X_IN / 2, true]] as Array<[number, number, number, boolean]>) {
        void a0; void a1; void along;
        member("landing-frame", "2x8", w, P(w / 2, b), frameTop - 7.25 / 2, w, THICK_2X_IN, 7.25, yawU);
      }
      for (let a = THICK_2X_IN / 2; a <= w - THICK_2X_IN / 2 + 1e-6; a += 16) member("landing-frame", "2x8", LANDING_DEPTH_IN - 2 * THICK_2X_IN, P(a, b0 + LANDING_DEPTH_IN / 2), frameTop - 7.25 / 2, THICK_2X_IN, LANDING_DEPTH_IN - 2 * THICK_2X_IN, 7.25, yawU);
      member("landing-tread", product.nominal, w, P(w / 2, b0 + LANDING_DEPTH_IN / 2), zL - treadThick / 2, w, LANDING_DEPTH_IN, treadThick, yawU);
      treadBoardLf += (Math.ceil(LANDING_DEPTH_IN / boardPitch) * w) / 12;
      for (const [a, b] of [[THICK_2X_IN / 2 + 1, b0 + 2], [w - THICK_2X_IN / 2 - 1, b0 + 2], [THICK_2X_IN / 2 + 1, b0 + LANDING_DEPTH_IN - 2], [w - THICK_2X_IN / 2 - 1, b0 + LANDING_DEPTH_IN - 2]]) {
        const q = P(a, b);
        const g = input.groundAt(q.x, q.y);
        const f = footingFor(design, q.x, q.y, 10, input.postSize, design.footing.aboveGradeIn);
        f.groundIn = g;
        footings.push(f);
        const bottom = g + f.topIn;
        const h = Math.max(6, frameTop - 7.25 - bottom);
        member("stair-post", input.postSize, h, q, bottom + h / 2, 3.5, 3.5, h, 0);
        hardware.postBases += 1;
      }
      flight("b", risersB, b0 + LANDING_DEPTH_IN, zL, false);
    }

    // The foot: a kicker on a pad, pavers, or the patio.
    const bFoot = totalRunIn;
    const padWidthIn = w + 2 * PAD_APRON_IN;
    const padLengthIn = PAD_OUT_IN + PAD_APRON_IN;
    if (lands === "ground") {
      if (stair.landing === "pad") {
        const cuFt = (padWidthIn * padLengthIn * PAD_THICK_IN) / 1728;
        pad = { lengthIn: padLengthIn, widthIn: padWidthIn, thickIn: PAD_THICK_IN, cuFt: Math.round(cuFt * 100) / 100, bags: Math.ceil(cuFt / BAG_CUFT - 1e-9) };
        member("pad", "concrete", padLengthIn, P(w / 2, bFoot - PAD_APRON_IN + padLengthIn / 2), groundIn + PAD_TOP_IN - PAD_THICK_IN / 2, padWidthIn, padLengthIn, PAD_THICK_IN, yawU);
        hardware.anchors += 2;
      } else if (stair.landing === "grade") {
        pavers = Math.ceil((padWidthIn * padLengthIn) / 144);
        member("pad", "pavers", padLengthIn, P(w / 2, bFoot - PAD_APRON_IN + padLengthIn / 2), groundIn + PAVER_TOP_IN - 1.2, padWidthIn, padLengthIn, 2.4, yawU);
      }
    }
    member("kicker", "2x4", w, P(w / 2, bFoot - 1.75 - KICKER_BACK_IN), landingTopIn + 0.75, w, 3.5, 1.5, yawU);

    // Rails: a handrail from four risers; guards on both open sides where the deck is more than 30 in. up.
    const want = stair.handrail === "auto" ? (risers >= HANDRAIL_FROM_RISERS ? (guard ? 2 : 1) : 0) : stair.handrail === "both" ? 2 : stair.handrail === "one" ? 1 : 0;
    railWanted = want as 0 | 1 | 2;
    railSides = rail.type !== "none" ? railWanted : 0;
    if (railSides > 0) {
      const sloped = Math.hypot(totalRunIn, riseIn);
      railLengthIn = sloped;
      const postsPerSide = Math.max(2, Math.ceil(sloped / STAIR_RAIL_POST_SPACING_IN) + 1);
      railPosts = postsPerSide * railSides;
      const metalBalusters = rail.type === "aluminum" || (rail.baluster === "round" && rail.type !== "cable" && rail.type !== "glass");
      const perSide = Math.floor(sloped / (metalBalusters ? 4.5 : BALUSTER_SPACING_IN));
      balusters = perSide * railSides;
      // AS THE DECK'S RAIL IS MOUNTED (2026-11-13). The stair's posts were always drawn bolted to the stringer, down its
      // depth — beside a top-mounted aluminum rail they were the "side-mounted section" a deck builder saw. They follow
      // the side of the deck the stair leaves: TOP — on the treads, the same 2¾ in. in from the stair's edge as the
      // deck's posts stand in from the deck's, from the tread up (no post down the stringer, no tension tie); SIDE —
      // on the stringer, as they were.
      const topMount = railMount === "top";
      const inFrom = topMount ? STAIR_TOP_MOUNT_IN : THICK_2X_IN / 2 + 1.75;
      const sides: number[] = railSides === 2 ? [inFrom, w - inFrom] : [w - inFrom];
      const slopeT = Math.atan2(riseIn, totalRunIn);
      const riserIn = riseIn / Math.max(1, risers);
      for (const a of sides) {
        for (let k = 0; k < postsPerSide; k++) {
          const b = (totalRunIn * k) / (postsPerSide - 1);
          const zn = level.surfaceIn - (riseIn * b) / Math.max(1, totalRunIn);
          if (topMount) {
            // The tread it stands on: the deck itself at the top, then a riser down for every tread's run.
            const foot = level.surfaceIn - (b < 0.5 ? 0 : Math.min(Math.max(1, risers - 1), Math.ceil(b / runIn - 1e-6)) * riserIn);
            const h = zn + HANDRAIL_HEIGHT_IN + 6 - foot;
            member("stair-rail-post", input.postSize === "8x8" ? "6x6" : "4x4", h, P(a, b), foot + h / 2, 3.5, 3.5, h, 0);
            continue;
          }
          const h = HANDRAIL_HEIGHT_IN + 6 + STRINGER_DEPTH_IN;
          member("stair-rail-post", input.postSize === "8x8" ? "6x6" : "4x4", h, P(a, b), zn - STRINGER_DEPTH_IN + h / 2, 3.5, 3.5, h, 0);
          hardware.railPostTies += 1;
        }
        // The rails drawn an inch past each end (their ends clear the top and bottom risers' faces); the balusters a
        // quarter inch toward the stair's middle, so no face of theirs lies in a rail's (both flickered, 2026-10-11).
        member("stair-rail", "2x4", sloped, P(a, totalRunIn / 2), level.surfaceIn - riseIn / 2 + HANDRAIL_HEIGHT_IN, sloped + 2, 1.5, 3.5, yawN, -slopeT);
        member("stair-rail", "2x4", sloped, P(a, totalRunIn / 2), level.surfaceIn - riseIn / 2 + 4, sloped + 2, 1.5, 3.5, yawN, -slopeT);
        const inward = a < w / 2 ? STAIR_BALUSTER_IN_IN : -STAIR_BALUSTER_IN_IN;
        for (let k = 1; k < perSide; k++) {
          const b = (sloped * k) / perSide * Math.cos(slopeT);
          const zn = level.surfaceIn - (riseIn * b) / Math.max(1, totalRunIn);
          // Thin metal balusters where the deck's rail has them (lib/deck/rails, 2026-11-09): the stair matches the deck.
          member("stair-baluster", metalBalusters ? "¾-in. aluminum baluster" : "2x2", HANDRAIL_HEIGHT_IN - 4, P(a + inward, b), zn + 4 + (HANDRAIL_HEIGHT_IN - 4) / 2, metalBalusters ? 0.75 : 1.5, metalBalusters ? 0.75 : 1.5, HANDRAIL_HEIGHT_IN - 4, 0);
        }
      }
    }
    footprint = [P(0, 0), P(w, 0), P(w, totalRunIn + (lands === "ground" ? PAD_OUT_IN : 0)), P(0, totalRunIn + (lands === "ground" ? PAD_OUT_IN : 0))];
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
    pad,
    pavers,
    rail: { sides: railSides, wanted: railWanted, lengthIn: Math.round(railLengthIn), posts: railPosts, balusters, handrailOnly: railSides === 1 && !guard, mount: railMount },
    guard,
    members,
    footings,
    footprint,
    treadBoardLf: Math.round(treadBoardLf * 10) / 10,
    riserBoardLf: Math.round(riserBoardLf * 10) / 10,
    boxFrameLf: Math.round(boxFrameLf * 10) / 10,
    boxBlocks,
    gravelSqFt,
    hardware,
    flags: { tooTallForBox, beyondRun: false, narrow: narrow || w < 36 },
  };
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
