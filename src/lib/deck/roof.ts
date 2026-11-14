// THE ROOF OVER THE DECK, WORKED OUT (Deck Studio M2, 2026-10-10) — pure.
//
// Owner: "covered deck, attached or detached; a gazebo on the ground, a slab
// or a deck; posts, rafters, shingles or metal; beams around the posts and
// rafters on top; a beam on the ridge or rafters tied; all the materials
// recalculated when the size changes." One design (design.ts `roof`) goes
// in; out comes every member of the roof with its size, its length and where
// it sits in space — posts, headers, the ledger on the house, rafters, jacks,
// hips, ridge, king posts, ties, slats, braces, fascia, gutters — plus the
// roof planes (sheathing, roofing, ceiling, soffit) as polygons. The 3D
// draws these, the material list counts them, the checks read their spans.
//
// HOW IT IS FRAMED:
//   · Posts stand at the corners of the roof's outline (the "ring"), more
//     along a side when its header cannot span it. On a deck the posts run
//     from their own footings up through the deck (frame.ts takes them as
//     extra posts); on a slab they sit on anchored bases; on the ground on
//     footings.
//   · Headers (beams) run post to post around the ring; the rafters bear on
//     top of them. A header is sized from the code's DECK beam tables at the
//     load a roof puts on it: the strip of roof it carries, at the roof's
//     live-or-snow plus dead load, turned into the deck table's "joist span"
//     (two feet of 50 psf deck for each foot of roof strip at that psf). A
//     gable-end header also carries the ridge beam's king post, read as the
//     uniform load with the same bending moment (2P/L).
//   · Rafters are read on the IRC rafter tables (roofTables.ts) by their
//     horizontal span, header to ridge or header to ledger.
//   · The ridge: a BEAM the rafters bear on (open ceiling; the beam spans
//     king posts over the gable-end headers, or the wall and one king post),
//     a BOARD with rafter ties every 4 ft, or NONE — a hip or a pyramid
//     carries itself to the corners along its hips, which are one size
//     deeper than the commons (R802.3); a polygon's hips meet at a steel
//     ring.
//   · A shed or a hip on the house wall hangs its upper edge on a ledger of
//     2x stock one size deeper than the rafters, two structural screws
//     every 16 in.
//
// AT THE HOUSE WALL (owner, 2026-11-07, after a Facebook comment asked why the
// roof made "a valley between the house and the deck"): "if it's a
// freestanding there is a gap for gutters and if it's attached then the
// proper flashing gets there."
//   · On the wall: every line where the roofing meets the siding is flashed
//     (`wallFlashing`) — apron (L) flashing along a level top edge, step
//     flashing up a sloped one, counter-flashed by the siding — and a kickout
//     at the foot of each sloped line turns the water into the gutter
//     (IRC R903.2, R903.2.1). Water at the wall runs off to the sides.
//   · Free-standing over a deck against the house: the back posts stand far
//     enough off the wall for the overhang, the fascia and the back eave's
//     gutter with WALL_CLEAR_IN of air behind it (`houseGap`). The back
//     slope's water goes to that gutter and the downspouts, never down the
//     siding; it used to overhang 7 in. into the wall with its gutter inside.
//
// Every face of the roof is one shape in plan: an eave line, a run inward to
// its top (ridge, apex, wall or the cap of a lower tier), and a side at each
// end that is a hip (at the corner's half-angle), a rake (square to the
// eave) or the house wall. One routine lays the rafters on a face; the
// kinds of roof differ only in which faces they are made of.
//
// Coordinates follow frame.ts: inches, x along the house, y out from it, z
// up from the ground. A member has an axis in plan (`yaw`) and a rise along
// it (`tilt`); its box is `sx` long along that axis, `sy` wide, `sz` deep.

import { POST_ACTUAL_IN, THICK_2X_IN, DRESSED_DEPTH_IN, JOIST_SIZES, SOLID_BEAMS, builtUpBeamMaxSpanIn, solidBeamMaxSpanIn, solidBeamTabulated, joistDepthIn, postMaxHeightIn, POST_TABLE_MAX_AREA, type JoistSize, type PostSize, type SpeciesGroup } from "./codeTables";
import { CEILING_FACTOR, ROOF_DEAD_PSF, RW_FACTOR, rafterMaxSpanIn, roofLoadFor, type RafterGroup, type RoofLoad } from "./roofTables";
import { beamSpec, footingFor, type BeamSpec, type Footing } from "./frame";
import { BRACE_ACTUAL_IN, BUILT_UP_CHOICES, ROOF_DOOR_LEAF_FT, braceSizeFor, isPolygonShape, isSolidBeam, type BeamSize, type DeckDesign, type RoofDesign, type RoofKind, type RoofOpening, type RoofPin, type RoofSide, type WallFill, type Zone } from "./design";
import { roofLoadForSnow } from "./site";
import type { FramingSpecies } from "./catalog";
import { deckRate, lumberKey, type DeckRateBook } from "./rates";
import type { MarketSnapshot } from "../fence/market";

/* ------------------------------------------------------------------ */
/*  Constants a framer would recognise                                 */
/* ------------------------------------------------------------------ */

/** A rafter's heel over the header: how much of its depth stands above the bearing (a third is cut away for the seat). */
const HEEL_SHARE = 0.65;
/** A roof post stands this far in from the deck's edge, centre to edge, inches (its face just inside the rim). */
const POST_INSET_IN = 4.5;
/** Rafter ties on a ridge board, inches on centre (R802.5.2 allows 4 ft). */
const TIE_SPACING_IN = 48;
/** Manufactured trusses (2026-10-11): 24 in. on center; a common truss spans this far before it is an engineer's girder or needs a bearing in the middle; 2x6 chords past 30 ft or under heavy snow. */
const TRUSS_SPACING_IN = 24;
const TRUSS_MAX_SPAN_IN = 40 * 12;
const TRUSS_2X4_MAX_IN = 30 * 12;
/** Framing lumber and LVL, pounds per cubic foot — a header's own weight on its posts. */
const WOOD_PCF = 35;
/** A roof ledger: two structural screws per 16 in. of wall (one per stud, two rows). */
const LEDGER_SCREW_SPACING_IN = 16;
/** A free-standing roof beside the house: air between its back gutter (or, without one, its fascia) and the siding, in. */
export const WALL_CLEAR_IN = 3;
/** A roof brace's name in `roof.bracesOff`: its post and the way it runs from it, to the nearest eighth of a turn (0 = toward +x, 2 = out from the house). */
export const roofBraceKey = (postId: string, yaw: number): string => `${postId}:${((Math.round(yaw / (Math.PI / 4)) % 8) + 8) % 8}`;
/** Wall flashing: how far it turns up the siding and out over the roofing, in. */
export const FLASH_LEG_IN = 4;
/** A gutter's width, in. (as the 3D hangs it: a 6-in. K-style, else 5); the sub-fascia and fascia stand this much past the eave line before it. */
const gutterWidthIn = (kind: RoofDesign["gutters"]["kind"]) => (kind === "none" ? 0 : kind === "k6" ? 6 : 5);
const FASCIA_OUT_IN = THICK_2X_IN + 0.75 + 0.25;
/** A gutter run gets another downspout every this many feet. */
const DOWNSPOUT_EVERY_FT = 35;
/** Gutter hangers, inches on centre: 24, or 18 under snow. */
const HANGER_SPACING_IN = { plain: 24, snow: 18 };
/** The lower tier of a double-tier roof runs this share of the way to the peak before the band. */
const TIER_SHARE = 0.55;
/** The band between the two tiers, inches. */
const TIER_BAND_IN = 24;
/** Knee brace legs, inches. */
const BRACE_LEG_IN = 24;
/** The longest stick a yard stocks, inches. */
const STOCK_MAX_IN = 240;
/** A metal panel covers 36 in. net. */
const METAL_PANEL_COVER_IN = 36;
/** A cupola's footprint, inches, and the height of its box. */
const CUPOLA_IN = 30;
const CUPOLA_BOX_IN = 24;
/** The deck beam table's first column, ft, and how far a lighter load may stretch its span. */
const TABLE_FIRST_COLUMN_FT = 6;
const LIGHT_LOAD_STRETCH_MAX = 1.5;
/** A slab runs this far past the posts on every side, inches. */
const SLAB_APRON_IN = 12;
const SLAB_THICK_IN = 4;
/** The top of a slab above the ground, inches. */
const SLAB_TOP_IN = 4;
/** A gambrel's lower slope (steep) and where it breaks; a Dutch gable's hips stop at this share of the run. */
const GAMBREL_LOWER_PITCH = 20;
const GAMBREL_BREAK_SHARE = 0.45;
const DUTCH_CAP_SHARE = 0.6;
/** A screened wall's kneewall height, its door, the louver blades. */
const KNEEWALL_IN = 36;
const DOOR_W_IN = 36;
const DOOR_H_IN = 80;
const LOUVER_BLADE_IN = 5.5;
const LOUVER_PITCH_IN = 6;
/** An arched pergola rafter rises this share of its length, 18 in. at most. */
const ARCH_RISE_SHARE = 0.12;
const ARCH_RISE_MAX_IN = 18;
/** Engineered (LVL) beams: 2.0E stock, 1 3/4 in. a ply, the depths a yard carries. */
const LVL_PLY_IN = 1.75;
const LVL_DEPTHS_IN = [9.5, 11.875, 14, 16, 18] as const;
const LVL_FB_PSI = 2600;
const LVL_E_PSI = 2_000_000;
const LVL_FV_PSI = 285;
const LVL_DEFLECTION_RATIO = 240;
/** A round gazebo is framed as a 16-sided ring with a post at every second corner. */
const ROUND_SIDES = 16;

/* ------------------------------------------------------------------ */
/*  What comes out                                                     */
/* ------------------------------------------------------------------ */

export type RoofRole =
  | "roof-post"
  | "header"
  | "roof-ledger"
  | "rafter"
  | "jack"
  | "fly"
  | "hip"
  | "ridge"
  | "king"
  | "tie"
  | "truss"
  | "purlin"
  | "slat"
  | "roof-brace"
  | "ring"
  | "tier-post"
  | "subfascia"
  | "fascia-eave"
  | "fascia-rake"
  | "gutter"
  | "downspout"
  | "cupola"
  | "kneewall"
  | "stud"
  | "door"
  | "fixture";

/** One member of the roof, inches. `yaw` is the direction of its axis in plan (radians, from +x toward +y); `tilt` its rise along that axis. */
export interface RoofMember {
  role: RoofRole;
  /** Plan mitres at the −u and +u ends (tangent of the saw's swing): how
   *  a fascia or gutter is cut where two eaves meet at a corner. */
  mA?: number;
  mB?: number;
  nominal: string;
  lengthIn: number;
  cx: number;
  cy: number;
  cz: number;
  /** Along the axis, across, and deep. */
  sx: number;
  sy: number;
  sz: number;
  yaw: number;
  tilt: number;
  /** The member's ends in plan, for the framing plan. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Which face it belongs to. */
  of?: string;
  ground?: boolean;
}

export type PlaneKind = "sheathing" | "roofing" | "ceiling" | "soffit" | "slab" | "wall" | "screen" | "louver" | "fixture";
/** A flat polygon in space: [x, y, z, x, y, z, …], inches. */
export interface RoofPlane {
  kind: PlaneKind;
  ring: number[];
  of?: string;
}

/** One piece of flashing where the roof meets the house (2026-11-07). The line runs on the roofing's top along the
 *  wall, (x0, y0, z0) to (x1, y1, z1); `ox, oy` point from the wall out over the roof. A kickout sits at the foot of a
 *  sloped line: (x0, y0, z0) where the eave meets the wall, `ox, oy` the way it throws the water, past the eave. */
export interface WallFlash {
  kind: "apron" | "step" | "kickout";
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
  ox: number;
  oy: number;
  lengthIn: number;
  of: string;
}

/** A free-standing roof over a deck against the house, and the air left at the wall (2026-11-07). */
export interface HouseGap {
  /** Wall to the back eave line, in. */
  eaveIn: number;
  /** Air between the back gutter (or the fascia, without one) and the siding, in. */
  clearIn: number;
  /** The back posts' centres off the wall, in. */
  postsIn: number;
  gutter: boolean;
}

export interface RoofPost {
  id: string;
  x: number;
  y: number;
  size: PostSize;
  /** Base of the post and the header's underside, inches above the ground. */
  bottomIn: number;
  topIn: number;
  heightIn: number;
  /** What it brings down, lb, and that weight as deck area at the deck's load. */
  loadLb: number;
  tributarySqFt: number;
  /** The post table's limit for a post carrying that at 40 psf (0 = beyond). */
  maxHeightIn: number;
  corner: boolean;
  /** Set by hand (2026-11-13): a post the builder stood there, or one of the two that frame an opening of theirs. */
  by?: { kind: "pin" | "opening"; id: string };
  /** How it meets the floor. */
  bearing: DeckDesign["floor"];
  footing: Footing | null;
  /** Longer than stock: spliced at the deck. */
  spliced: boolean;
}

export interface RoofHeader {
  id: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  lengthIn: number;
  spec: BeamSpec;
  /** Post centres along it, as distances from its start, and the longest stretch between them. */
  postAt: number[];
  spanIn: number;
  /** The deck table it was read on: the equivalent joist span, ft, and the longest span it allows (0 = beyond). */
  eqJoistSpanFt: number;
  maxSpanIn: number;
  /** It also carries a king post. */
  kingPost: boolean;
  /** Its ends are on the wall (no post there). */
  wallEnd: boolean;
  /**
   * Nothing bears on it (2026-11-09): a gable end under trusses or a ridge board, a shed's sloping side — it ties two
   * posts together and may be left out by hand (design.roof.headersOff). Absent on a beam that carries the roof.
   */
  idle?: boolean;
  /**
   * A cross beam (2026-10-12): it spans from one eave header to the other, hung on them right over the posts under its
   * ends, and carries a king post under the ridge at its middle. Not part of the ring.
   */
  cross?: boolean;
}

export interface RoofFace {
  id: string;
  /** Eave corners in plan (outer), the unit along the eave and the unit inward. */
  ax: number;
  ay: number;
  bx: number;
  by: number;
  ux: number;
  uy: number;
  nx: number;
  ny: number;
  /** Eave length, the horizontal run from the eave line to the top, and the top the rafters reach. */
  lengthIn: number;
  runIn: number;
  vTopIn: number;
  top: "ridge" | "apex" | "wall" | "cap" | "header";
  sideA: "hip" | "rake" | "wall";
  sideB: "hip" | "rake" | "wall";
  betaA: number;
  betaB: number;
  /** Where the header's line crosses the face (v), and where it starts and ends along the eave (u). */
  ovhIn: number;
  ringU0: number;
  ringU1: number;
  /** The face's top corners in plan. */
  tax: number;
  tay: number;
  tbx: number;
  tby: number;
  /** Area of the roof surface, sq ft. */
  areaSqFt: number;
  /** Lineal feet by edge kind. */
  eaveFt: number;
  rakeFt: number;
  wallFt: number;
  /** The tier it belongs to. */
  tier: 1 | 2;
  /** Its own slope (a gambrel's two faces differ) and the header top it springs from. */
  slope: number;
  baseTopIn: number;
}

export interface GutterPlan {
  kind: Exclude<RoofDesign["gutters"]["kind"], "none">;
  lf: number;
  runs: number;
  closed: boolean;
  corners: number;
  endCaps: number;
  downspouts: number;
  downspoutFt: number;
  downspoutSize: "2x3" | "3x4";
  hangers: number;
  elbows: number;
  guardsLf: number;
}

export interface RoofFrame {
  roof: RoofDesign;
  /** The kind as framed (a hip over a square is a pyramid; an attached hip too narrow for its hips is framed as a gable). */
  kind: RoofKind;
  kindNote: string | null;
  attach: RoofDesign["attach"];
  floor: DeckDesign["floor"];
  species: FramingSpecies;
  group: SpeciesGroup;
  rafterGroup: RafterGroup | "RW";
  /** Loads, psf. */
  roofLoad: RoofLoad;
  deadPsf: number;
  totalPsf: number;
  /** The roof's outline in plan: the post ring and the eave line. */
  ring: Array<{ x: number; y: number }>;
  eaveRing: Array<{ x: number; y: number }>;
  centreX: number;
  centreY: number;
  /** Bounding sizes of the eave outline, inches, and the plan areas, sq ft. */
  widthIn: number;
  depthIn: number;
  ringAreaSqFt: number;
  footprintSqFt: number;
  /** Levels, inches above the ground. */
  floorIn: number;
  headerBottomIn: number;
  headerTopIn: number;
  peakIn: number;
  slope: number;
  pitchAngle: number;
  faces: RoofFace[];
  posts: RoofPost[];
  headers: RoofHeader[];
  ledger: { lengthIn: number; nominal: string; fasteners: number; zIn: number } | null;
  rafters: {
    size: JoistSize;
    spacingIn: number;
    count: number;
    commons: number;
    jacks: number;
    flies: number;
    longestIn: number;
    /** The horizontal span of a common, header to ridge or ledger, and the table's limit. */
    spanIn: number;
    maxSpanIn: number;
    estimated: boolean;
  };
  ridge: { kind: "beam" | "board" | "none"; nominal: string; lengthIn: number; spec: BeamSpec | null; spanIn: number; maxSpanIn: number; eqJoistSpanFt: number; /** "auto" wanted a beam and the table had none this long. */ fellBack: boolean } | null;
  /** The hips: how many, their size, and (2026-10-11) what each was designed for — its span corner post to ridge, the load of the jacks on it, sawn or LVL, and whether nothing in the list carries it. */
  hips: { count: number; nominal: string; totalIn: number; spanIn?: number; loadLb?: number; kind?: "sawn" | "lvl"; beyond?: boolean };
  kingPosts: number;
  ties: number;
  /** Cross beams under the ridge (2026-10-12): a free hip's ridge beam on two, a gable's ridge beam on those asked for. */
  crossBeams: number;
  /** Ties from a free hip's end headers back to the first rafter tie (the king common's thrust), 2026-10-12. */
  hipEndTies: number;
  /**
   * The most a header joint must hold in tension, lb (2026-10-12): hips with nothing under their tops push the corners
   * out and the headers hold them as a ring; every joint gets a tension strap rated for at least this. 0 when nothing does.
   */
  ringTensionLb: number;
  /**
   * Manufactured trusses in place of rafters on a gable (2026-10-11): how many, the two gable ends among them, the span
   * bearing to bearing, the spacing, the chords — and why (asked for; the rafters ran past the table; no beam spans the
   * ridge and ties would be longer than stock). Designed and stamped by the truss maker (IRC R802.10).
   */
  /** Across the ridge, bearing to bearing: what a tie or a truss spans, inches (0 without a ridge). */
  ridgeAcrossIn: number;
  trusses: { count: number; gableEnds: number; spanIn: number; spacingIn: number; chord: "2x4" | "2x6"; why: "asked" | "rafters" | "ridge" | "post"; ridgeSpanIn?: number; kingLoadLb?: number } | null;
  slats: { count: number; nominal: string; totalIn: number } | null;
  members: RoofMember[];
  planes: RoofPlane[];
  /** Flashing where the roof meets the house: apron, step, kickout (empty when it stands free). */
  wallFlashing: WallFlash[];
  /** Free-standing over a deck against the house: the gap at the wall for the back gutter (null otherwise). */
  houseGap: HouseGap | null;
  /** Lineal feet of each edge. */
  eaveFt: number;
  rakeFt: number;
  wallFt: number;
  ridgeFt: number;
  hipFt: number;
  roofAreaSqFt: number;
  /** Squares to buy, waste included, and the sheets of sheathing. */
  wasteFactor: number;
  squares: number;
  sheets: number;
  metalPanels: Array<{ lengthFt: number; count: number }>;
  ceilingSqFt: number;
  soffitSqFt: number;
  gutters: GutterPlan | null;
  slab: { sqFt: number; cuYd: number } | null;
  /** Walls between the posts (M3): what, where, and how much. */
  walls: { fill: WallFill; segments: Array<{ x0: number; y0: number; x1: number; y1: number; lengthIn: number }>; sqFt: number; kneewallLf: number; doors: number } | null;
  /** Louvered or arched pergola figures (M3). */
  louvers: { sqFt: number; blades: number } | null;
  archRafters: boolean;
  /** Gambrel ties at the break, Dutch-gable gablets. */
  breakTies: number;
  gablets: number;
  /** Any header or the ridge is an engineered beam. */
  engineered: boolean;
  hardware: { hurricaneTies: number; rafterHangers: number; postBases: number; postCaps: number; slabAnchors: number; braces: number; ledgerScrews: number; ringPlate: number; kingBrackets: number; wallHangers: number; gussets: number; cornerStraps: number; crossHangers: number };
  /** Beams between the posts left out by hand — only ever ones nothing bears on (design.roof.headersOff). */
  headersLeftOut: Array<{ id: string; x0: number; y0: number; x1: number; y1: number; lengthIn: number }>;
  /** Knee braces the roof would have that were taken out by hand (design.roof.bracesOff). */
  bracesLeftOut: number;
  /** Posts left standing in a stair's opening — a ring corner, or one no header could be laid to clear (the checks say to move the stair). */
  postsInStair: Array<{ x: number; y: number; side: StairOpening["side"]; corner: boolean }>;
  /**
   * OPENINGS AND POSTS SET BY HAND, AS BUILT (2026-11-13; design.roof.openings, .pins). An opening: its clear ends on
   * the posts' line, its clear width, the door's leaves (0 = left open), the header over it — its span post to post,
   * its size, whether that took an engineered beam, whether no beam in the list carries it — and whether a post the
   * structure cannot spare (under a cross beam) stands in it. A pin: where its post stands.
   */
  openings: Array<{ id: string; side: RoofSide; x0: number; y0: number; x1: number; y1: number; widthIn: number; leaves: number; headerId: string; spanIn: number; size: string; engineered: boolean; beyond: boolean; blocked: boolean; cornerJambs: number }>;
  pins: Array<{ id: string; side: RoofSide; x: number; y: number }>;
  /** What could not be set, and why — said, never dropped in silence. */
  notPlaced: Array<{ kind: "post" | "opening"; id: string; why: string }>;
  /**
   * The sides a post or an opening set by hand is measured along (2026-11-13; lib/deck/byHand): where each starts —
   * its left end (front, back) or its house end (left, right) — the way it runs, and its length, inches. A side the
   * roof hangs on the house by has none; a round or many-sided roof has none at all.
   */
  sides: Partial<Record<RoofSide, { x: number; y: number; ux: number; uy: number; lengthIn: number }>>;
  flags: {
    rafterBeyondTable: boolean;
    headerBeyondTable: string[];
    ridgeBeyondTable: boolean;
    postBeyondTable: boolean;
    speciesEstimated: boolean;
    tooWideForHip: boolean;
    postSpliced: boolean;
    /** No engineered beam in the list carries it either. */
    engineeredBeyond: boolean;
    /** Rafter ties across a gable longer than stock lumber (a board asked for on a wide roof). */
    tiesBeyondStock: boolean;
    /** Trusses asked for, but the span is past what a common truss does here. */
    trussesBeyond: boolean;
  };
}

export interface RoofBuildOptions {
  rates?: DeckRateBook;
  market?: MarketSnapshot;
  /** The ground under a point of the plan, inches (the site's slope). */
  groundAt?: (x: number, y: number) => number;
  /** Where stairs leave the deck: the roof's posts keep clear of them (lib/deck/structure stairOpenings). */
  stairOpenings?: StairOpening[];
}

/** A stair's opening on the deck's edge, plan inches along that side (x on the front, y on a side). */
export interface StairOpening {
  side: "front" | "left" | "right";
  fromIn: number;
  toIn: number;
}

/** How far a roof post's face stands clear of a stair's opening, in. */
export const STAIR_POST_CLEAR_IN = 0.5;

/** What the roof needs to know about the deck it stands on: its rectangles and where its footings top out. */
export interface DeckUnder {
  zones: Zone[];
  footingTopIn: number;
}

/* ------------------------------------------------------------------ */
/*  Small geometry                                                     */
/* ------------------------------------------------------------------ */

type V2 = { x: number; y: number };
const sub = (a: V2, b: V2): V2 => ({ x: a.x - b.x, y: a.y - b.y });
const len = (v: V2) => Math.hypot(v.x, v.y);
const unit = (v: V2): V2 => {
  const l = len(v) || 1;
  return { x: v.x / l, y: v.y / l };
};
const cot = (b: number) => (Math.abs(b - Math.PI / 2) < 1e-9 ? 0 : 1 / Math.tan(b));
const ringArea = (pts: readonly V2[]) => Math.abs(pts.reduce((a, p, i) => a + p.x * pts[(i + 1) % pts.length].y - pts[(i + 1) % pts.length].x * p.y, 0)) / 2;
const centroid = (pts: readonly V2[]): V2 => ({ x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length });

/** The species row the rafter tables are read on. */
export function rafterGroupFor(species: FramingSpecies): RafterGroup | "RW" {
  switch (species.id) {
    case "southern-pine":
      return "SP";
    case "douglas-fir":
      return "DF";
    case "hem-fir":
      return "HF";
    case "spf":
      return "SPF";
    default:
      return "RW";
  }
}

/** One size deeper, for hips, the ridge board and the ledger (a 2x12 stays a 2x12). */
export function oneDeeper(size: JoistSize): JoistSize {
  const i = JOIST_SIZES.indexOf(size);
  return JOIST_SIZES[Math.min(JOIST_SIZES.length - 1, i + 1)];
}

const depthOf = (nominal: string) => DRESSED_DEPTH_IN[Number(nominal.split("x")[1])] ?? 5.5;

/** The roof's outline as the contractor set it, in the deck's coordinates (or its own when there is no deck). */
/** A free-standing roof over a deck against the house: how far its posts' centres must stand off the wall so the
 *  overhang, the fascia and the back gutter fit with WALL_CLEAR_IN of air behind them; null when no wall is behind it. */
export function houseClearIn(design: DeckDesign): number | null {
  const r = design.roof;
  if (r.attach === "wall" || design.floor !== "deck" || design.placement === "detached" || r.kind === "pergola") return null;
  const gutter = gutterWidthIn(r.gutters.kind);
  return Math.ceil(WALL_CLEAR_IN + gutter + FASCIA_OUT_IN + r.overhangIn);
}

export function roofRing(design: DeckDesign, deck: DeckUnder | null): { pts: V2[]; regular: boolean; apothemIn: number } {
  const r = design.roof;
  const p = r.plan;
  const wall = r.attach === "wall";
  // The back posts of a free-standing roof against the house stand off the wall (2026-11-07); otherwise just inside the deck.
  const backIn = Math.max(POST_INSET_IN, houseClearIn(design) ?? 0);
  if (isPolygonShape(p.shape)) {
    const n = p.shape === "hexagon" ? 6 : p.shape === "octagon" ? 8 : ROUND_SIDES;
    const across = p.acrossFt * 12;
    const a = across / 2;
    const R = a / Math.cos(Math.PI / n);
    // Centred on the deck — and, against the house, far enough out that its back side clears the wall (2026-11-07).
    const c: V2 = deck ? { x: Math.max(...deck.zones.map((z) => z.x1)) / 2 + p.offsetFt * 12, y: Math.max(Math.max(...deck.zones.map((z) => z.y1)) / 2, Math.min((houseClearIn(design) ?? 0) + a, Math.max(...deck.zones.map((z) => z.y1)) - a)) } : { x: R, y: n === 6 ? a : a };
    const phi0 = -Math.PI / 2 - Math.PI / n;
    const pts: V2[] = [];
    for (let k = 0; k < n; k++) pts.push({ x: c.x + R * Math.cos(phi0 + (2 * Math.PI * k) / n), y: c.y + R * Math.sin(phi0 + (2 * Math.PI * k) / n) });
    return { pts, regular: true, apothemIn: a };
  }
  let x0: number;
  let x1: number;
  let y0: number;
  let y1: number;
  if (p.shape === "follows-deck" && deck) {
    // The full-depth leg of the deck, posts just inside its edges; on the wall the back posts give way to the ledger.
    const z = deck.zones[0];
    x0 = z.x0 + POST_INSET_IN;
    x1 = z.x1 - POST_INSET_IN;
    y0 = wall ? 0 : Math.max(z.y0 + POST_INSET_IN, backIn);
    y1 = z.y1 - POST_INSET_IN;
    // A pyramid over a square deck stays a pyramid when it stands clear of the house: its width comes in to match.
    if (r.kind === "pyramid" && Math.abs(z.x1 - z.x0 - (z.y1 - z.y0)) < 0.5 && x1 - x0 > y1 - y0 + 0.5) {
      const mid = (x0 + x1) / 2;
      x0 = mid - (y1 - y0) / 2;
      x1 = mid + (y1 - y0) / 2;
    }
  } else {
    const W = p.widthFt * 12;
    const D = p.depthFt * 12;
    if (deck) {
      const zs = deck.zones;
      const dw = Math.max(...zs.map((z) => z.x1));
      const dd = Math.max(...zs.map((z) => z.y1));
      const cx = dw / 2 + p.offsetFt * 12;
      x0 = cx - W / 2;
      x1 = cx + W / 2;
      if (wall) {
        y0 = 0;
        y1 = Math.min(D, dd - POST_INSET_IN);
      } else {
        const cy = dd / 2;
        y0 = Math.max(POST_INSET_IN, cy - D / 2);
        y1 = Math.min(dd - POST_INSET_IN, cy + D / 2);
        // Against the house it slides out to clear the wall, keeping its depth where the deck has room (2026-11-07).
        if (y0 < backIn) {
          y1 = Math.min(dd - POST_INSET_IN, y1 + (backIn - y0));
          y0 = backIn;
        }
      }
      // Posts stay on the deck.
      x0 = Math.max(POST_INSET_IN, x0);
      x1 = Math.min(dw - POST_INSET_IN, x1);
      // A square stays square: where the deck cut its depth, its width comes in to match, about its centre.
      if (p.shape === "square" && x1 - x0 > y1 - y0 + 0.5) {
        const mid = (x0 + x1) / 2;
        x0 = mid - (y1 - y0) / 2;
        x1 = mid + (y1 - y0) / 2;
      }
    } else {
      x0 = 0;
      x1 = W;
      y0 = 0;
      y1 = D;
    }
  }
  if (x1 - x0 < 48) x1 = x0 + 48;
  if (y1 - y0 < 48) y1 = y0 + 48;
  return { pts: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }], regular: false, apothemIn: Math.min(x1 - x0, y1 - y0) / 2 };
}

/* ------------------------------------------------------------------ */
/*  The build                                                          */
/* ------------------------------------------------------------------ */

interface FaceSpec {
  id: string;
  A: V2;
  B: V2;
  /** Inward unit (the slope goes up along it). */
  n: V2;
  runIn: number;
  vTopIn: number;
  top: RoofFace["top"];
  sideA: RoofFace["sideA"];
  sideB: RoofFace["sideB"];
  betaA: number;
  betaB: number;
  ovhIn: number;
  /** Where the header is, along the eave, from A. */
  ringU0: number;
  ringU1: number;
  tier: 1 | 2;
  /** Its own slope and the header top it springs from (a gambrel's upper face, a Dutch gable's gable above the hips). */
  slope?: number;
  baseTopIn?: number;
}

/**
 * An engineered beam for a span: the lightest LVL (plies × depth) that carries
 * `wLbPerFt` over `spanIn` in bending, shear and deflection (L/240), on the
 * usual 2.0E figures. An ESTIMATE the maker's software confirms.
 */
export function sizeLvl(spanIn: number, wLbPerFt: number, minPlies = 1): BeamSpec | null {
  const Lft = spanIn / 12;
  const w = Math.max(50, wLbPerFt);
  const Mlbin = ((w * Lft * Lft) / 8) * 12;
  const V = (w * Lft) / 2;
  const options: Array<{ plies: number; d: number }> = [];
  // At least `minPlies` (2026-10-11): a header as wide as the post cap it sits in — never a lone 1¾-in. ply.
  for (const d of LVL_DEPTHS_IN) for (const plies of [1, 2, 3]) if (plies >= minPlies) options.push({ plies, d });
  options.sort((a, b) => a.plies * a.d - b.plies * b.d);
  for (const o of options) {
    const b = LVL_PLY_IN * o.plies;
    const S = (b * o.d * o.d) / 6;
    const I = (b * o.d * o.d * o.d) / 12;
    const A = b * o.d;
    const bending = LVL_FB_PSI * S >= Mlbin;
    const shear = V <= (LVL_FV_PSI * A * 2) / 3;
    const defl = (5 * (w / 12) * spanIn ** 4) / (384 * LVL_E_PSI * I) <= spanIn / LVL_DEFLECTION_RATIO;
    if (bending && shear && defl) {
      const dName = o.d === 11.875 ? "11⅞" : String(o.d);
      return { size: `${o.plies}-ply LVL 1¾×${dName}`, kind: "lvl", plies: o.plies, thickIn: b, depthIn: o.d, stock: `LVL1.75x${o.d}` };
    }
  }
  return null;
}

/**
 * NDS 2018 Supplement reference values for No. 2 2x lumber (Tables 4A/4B): Fb with its size factor taken in, psi, by
 * nominal depth; E, psi. Southern pine's values are printed by size. Western cedar stands in for "RW".
 */
const NO2_FB: Record<RafterGroup | "RW", Record<string, number>> = {
  DF: { "2x6": 1170, "2x8": 1080, "2x10": 990, "2x12": 900 },
  HF: { "2x6": 1105, "2x8": 1020, "2x10": 935, "2x12": 850 },
  SPF: { "2x6": 1138, "2x8": 1050, "2x10": 963, "2x12": 875 },
  SP: { "2x6": 1000, "2x8": 925, "2x10": 800, "2x12": 750 },
  RW: { "2x6": 910, "2x8": 840, "2x10": 770, "2x12": 700 },
};
const NO2_E: Record<RafterGroup | "RW", number> = { DF: 1_600_000, HF: 1_300_000, SPF: 1_400_000, SP: 1_400_000, RW: 1_000_000 };

export interface HipDesign {
  /** "2x10", "2-2x12", "2-ply LVL 1¾×14". */
  nominal: string;
  /** One ply as the yard sells it: "2x12", "LVL1.75x14". */
  stock: string;
  plies: number;
  plyIn: number;
  depthIn: number;
  kind: "sawn" | "lvl";
  /** Corner post to the ridge, plan, inches; the jacks' load on it, lb. */
  spanIn: number;
  loadLb: number;
  beyond: boolean;
}

/**
 * A hip designed as a beam (2026-10-11; IRC R802.3: a hip is "supported at the ridge by a brace to a bearing partition
 * or designed to carry and distribute the specific load at that point" — an open roof has no partition). It spans from
 * its corner post to the ridge and carries half of every jack on both sides: on faces whose corners are `halfAngle`
 * either side of it (45° on a rectangle, 180°/n on an n-sided gazebo) that is a load growing from nothing at the corner
 * to its most at the ridge, W = psf · R² · tan(halfAngle) / 2 for a run R. Bending (M = 0.1283 W L) and deflection
 * (0.01304 W L³ / E I — AISC Table 3-23, case 2; it was doubled until 2026-10-12 — held to L/180, or L/240 under a ceiling) on No. 2 values — snow load duration 1.15, roof live
 * 1.25, built-up plies 1.15 — one size deeper than the commons first, then deeper singles, built-up pairs and threes,
 * then a 2- or 3-ply LVL. An ESTIMATE in the code's own terms; an engineer or the LVL maker confirms a big one.
 */
export function designHip(runIn: number, ovhIn: number, halfAngle: number, commons: JoistSize, group: RafterGroup | "RW", totalPsf: number, snow: boolean, ceiling: boolean): HipDesign {
  const spanIn = Math.max(12, (runIn - ovhIn) / Math.cos(halfAngle));
  const loadLb = (totalPsf * (runIn / 12) ** 2 * Math.tan(halfAngle)) / 2;
  const M = 0.1283 * loadLb * spanIn;
  const cd = snow ? 1.15 : 1.25;
  const limit = spanIn / (ceiling ? 240 : 180);
  const defl = (E: number, I: number) => (0.01304 * loadLb * spanIn ** 3) / (E * I);
  const sizes = JOIST_SIZES.slice(JOIST_SIZES.indexOf(oneDeeper(commons)));
  for (const plies of [1, 2, 3]) {
    for (const z of sizes) {
      const d = DRESSED_DEPTH_IN[Number(z.split("x")[1])] ?? 5.5;
      const b = THICK_2X_IN * plies;
      const S = (b * d * d) / 6;
      const I = (b * d * d * d) / 12;
      const fbAllow = (NO2_FB[group][z] ?? 850) * cd * (plies >= 2 ? 1.15 : 1);
      if (M / S <= fbAllow && defl(NO2_E[group], I) <= limit) return { nominal: plies === 1 ? z : `${plies}-${z}`, stock: z, plies, plyIn: THICK_2X_IN, depthIn: d, kind: "sawn", spanIn: Math.round(spanIn), loadLb: Math.round(loadLb), beyond: false };
    }
  }
  for (const plies of [2, 3]) {
    for (const d of LVL_DEPTHS_IN) {
      const b = LVL_PLY_IN * plies;
      const S = (b * d * d) / 6;
      const I = (b * d * d * d) / 12;
      if (M / S <= LVL_FB_PSI * cd && defl(LVL_E_PSI, I) <= limit) {
        const dName = d === 11.875 ? "11⅞" : String(d);
        return { nominal: `${plies}-ply LVL 1¾×${dName}`, stock: `LVL1.75x${d}`, plies, plyIn: LVL_PLY_IN, depthIn: d, kind: "lvl", spanIn: Math.round(spanIn), loadLb: Math.round(loadLb), beyond: false };
      }
    }
  }
  return { nominal: "3-ply LVL 1¾×18", stock: "LVL1.75x18", plies: 3, plyIn: LVL_PLY_IN, depthIn: 18, kind: "lvl", spanIn: Math.round(spanIn), loadLb: Math.round(loadLb), beyond: true };
}

/** The openings and posts set by hand, in a line for the scope and the plans' notes: "a 4'-0" opening framed on the front (a screen door in it), 2 posts set by hand" — "" for none. */
export function roofByHandWords(roof: Pick<RoofFrame, "openings" | "pins">): string {
  const ft = (inches: number) => `${Math.floor(Math.round(inches) / 12)}'-${Math.round(inches) % 12}"`;
  const side = (sd: RoofSide) => (sd === "front" ? "front" : sd === "back" ? "back" : `${sd} side`);
  const bits = roof.openings.map((o) => `a ${ft(o.widthIn)} opening framed on the ${side(o.side)}${o.leaves === 2 ? " (a pair of screen doors in it)" : o.leaves === 1 ? " (a screen door in it)" : " (left open)"}`);
  if (roof.pins.length) bits.push(`${roof.pins.length} ${roof.pins.length === 1 ? "post" : "posts"} set by hand`);
  return bits.join(", ");
}

export function buildRoofFrame(design: DeckDesign, species: FramingSpecies, group: SpeciesGroup, deck: DeckUnder | null, opts: RoofBuildOptions = {}): RoofFrame {
  const r = design.roof;
  const ovh = r.overhangIn;
  const pergola = r.kind === "pergola";
  const slope = pergola ? 0 : r.pitch / 12;
  const theta = Math.atan(slope);
  const cosT = Math.cos(theta);
  const rafterGroup = rafterGroupFor(species);
  const price = (key: string) => deckRate(key, opts.rates, opts.market).price;

  // Loads.
  const roofLoad: RoofLoad = r.load === "auto" ? (design.site.groundSnowPsf > 0 ? roofLoadForSnow(design.site.groundSnowPsf).load : roofLoadFor(design.loadPsf)) : r.load;
  const metal = r.roofing === "metal-panel" || r.roofing === "standing-seam";
  // A LOUVERED TOP (2026-10-12): closed, the blades make a roof — it carries the roof's live or snow load and the blades'
  // weight like any roof. Open slats carry 10 psf, their own weight, and the wind.
  const louveredTop = pergola && r.pergolaStyle === "louvered";
  const deadPsf = (louveredTop ? ROOF_DEAD_PSF.metal : pergola ? ROOF_DEAD_PSF.open : metal ? ROOF_DEAD_PSF.metal : r.roofing === "cedar-shake" ? ROOF_DEAD_PSF.shake : ROOF_DEAD_PSF.shingle) + (r.ceiling !== "none" ? ROOF_DEAD_PSF.ceiling : 0);
  const livePsf = pergola && !louveredTop ? 10 : roofLoad;
  const totalPsf = livePsf + deadPsf;

  // The ring and the floor.
  const { pts: ring, regular, apothemIn } = roofRing(design, deck);
  const n = ring.length;
  const c = centroid(ring);
  const wall = r.attach === "wall" && !regular;
  const floorIn = design.floor === "deck" ? design.heightIn : design.floor === "slab" || design.floor === "existing" ? SLAB_TOP_IN : design.footing.aboveGradeIn;
  const headerBottomIn = floorIn + r.eaveHeightIn;

  // Rafters: the size that spans, at the spacing asked.
  const spacing = r.rafterSpacingIn;
  const ceilingOn = r.ceiling !== "none";

  // Which faces, by kind.
  const xs = ring.map((p) => p.x);
  const ys = ring.map((p) => p.y);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const W = x1 - x0;
  const D = y1 - y0;
  let kind: RoofKind = r.kind;
  const kindNote: string | null = null;
  // Kept for what reads it: an attached hip is never framed as something else now (2026-10-22).
  const tooWideForHip = false;
  // An attached hip stays a hip on any outline (owner, 2026-10-22: "I marked the hip roof but it's not changing in the
  // 3D"): one that comes out further than half its width is framed with a hip end at the front and a ridge running back
  // into the house wall (below) — it used to fall back to a gable, and a square one to a pyramid that cannot hang on a wall.
  if (!regular && (kind === "pyramid" || (kind === "hip" && Math.abs(W - D) < 0.5 && !wall))) kind = "pyramid";
  if (regular && kind === "hip") kind = "pyramid";
  if (kind === "pyramid" && !regular && Math.abs(W - D) > 0.5) {
    kind = "hip";
  }
  if ((kind === "gambrel" || kind === "dutch-gable") && (regular || wall)) kind = regular ? "pyramid" : "gable";
  // A Dutch gable needs room for its hips at both ends; a square one is a pyramid with a gablet nowhere to sit.
  if (kind === "dutch-gable" && Math.abs(W - D) < 24) kind = "hip";

  const eaveX0 = x0 - ovh;
  const eaveX1 = x1 + ovh;
  const eaveY0 = wall ? y0 : y0 - ovh;
  const eaveY1 = y1 + ovh;
  /** An attached hip out from the house further than half its width: a hip end at the front, the ridge into the wall. */
  const deepWallHip = kind === "hip" && wall && eaveX1 - eaveX0 < 2 * (eaveY1 - eaveY0);
  const halfPi = Math.PI / 2;
  const faceSpecs: FaceSpec[] = [];
  let ridgeFrom: V2 | null = null;
  let ridgeTo: V2 | null = null;
  let ridgeSpanIn = 0;
  let ridgeSupports: "king-king" | "wall-king" | "none" = "none";
  let eaveRing: V2[] = [];
  let apex: V2 | null = null;
  /** The second tier of a double-tier roof. */
  let tier2: { ring: V2[]; apothemIn: number; ovhIn: number; baseTopIn: number } | null = null;

  const rectFace = (id: string, A: V2, B: V2, nrm: V2, runIn: number, top: RoofFace["top"], sideA: RoofFace["sideA"], sideB: RoofFace["sideB"], ringU0: number, ringU1: number, ovhIn = ovh, vTopIn = runIn, tier: 1 | 2 = 1, slopeOverride?: number): FaceSpec => ({
    id,
    A,
    B,
    n: nrm,
    runIn,
    vTopIn,
    top,
    sideA,
    sideB,
    betaA: sideA === "hip" ? Math.PI / 4 : halfPi,
    betaB: sideB === "hip" ? Math.PI / 4 : halfPi,
    ovhIn,
    ringU0,
    ringU1,
    tier,
    slope: slopeOverride,
  });
  let gablets = 0;
  let breakTies = 0;
  /** The gambrel's break line and the Dutch gable's cap, kept for the ties and the gablet walls. */
  let gambrel: { vBreak: number; alongY: boolean; slopeLo: number } | null = null;
  let dutch: { vCap: number; alongX: boolean } | null = null;

  if (pergola) {
    eaveRing = [{ x: eaveX0, y: eaveY0 }, { x: eaveX1, y: eaveY0 }, { x: eaveX1, y: eaveY1 }, { x: eaveX0, y: eaveY1 }];
  } else if (kind === "shed") {
    // One slope from the front eave up to the wall (or to a taller back header).
    const runIn = eaveY1 - eaveY0;
    faceSpecs.push(rectFace("s", { x: eaveX0, y: eaveY1 }, { x: eaveX1, y: eaveY1 }, { x: 0, y: -1 }, runIn, wall ? "wall" : "header", "rake", "rake", ovh, eaveX1 - eaveX0 - ovh));
    eaveRing = [{ x: eaveX0, y: eaveY0 }, { x: eaveX1, y: eaveY0 }, { x: eaveX1, y: eaveY1 }, { x: eaveX0, y: eaveY1 }];
  } else if (kind === "gable") {
    const alongY = wall || D > W;
    if (alongY) {
      // Ridge out from the house (or along the deeper side): the eaves are the left and right sides.
      const runIn = (eaveX1 - eaveX0) / 2;
      const Lu = eaveY1 - eaveY0;
      faceSpecs.push(rectFace("gl", { x: eaveX0, y: eaveY0 }, { x: eaveX0, y: eaveY1 }, { x: 1, y: 0 }, runIn, "ridge", wall ? "wall" : "rake", "rake", wall ? 0 : ovh, Lu - ovh));
      faceSpecs.push(rectFace("gr", { x: eaveX1, y: eaveY1 }, { x: eaveX1, y: eaveY0 }, { x: -1, y: 0 }, runIn, "ridge", "rake", wall ? "wall" : "rake", ovh, wall ? Lu : Lu - ovh));
      const cx = (eaveX0 + eaveX1) / 2;
      ridgeFrom = { x: cx, y: eaveY0 };
      ridgeTo = { x: cx, y: eaveY1 };
      ridgeSpanIn = wall ? y1 - y0 : y1 - y0;
      ridgeSupports = wall ? "wall-king" : "king-king";
    } else {
      const runIn = (eaveY1 - eaveY0) / 2;
      const Lu = eaveX1 - eaveX0;
      faceSpecs.push(rectFace("gb", { x: eaveX1, y: eaveY0 }, { x: eaveX0, y: eaveY0 }, { x: 0, y: 1 }, runIn, "ridge", "rake", "rake", ovh, Lu - ovh));
      faceSpecs.push(rectFace("gf", { x: eaveX0, y: eaveY1 }, { x: eaveX1, y: eaveY1 }, { x: 0, y: -1 }, runIn, "ridge", "rake", "rake", ovh, Lu - ovh));
      const cy = (eaveY0 + eaveY1) / 2;
      ridgeFrom = { x: eaveX0, y: cy };
      ridgeTo = { x: eaveX1, y: cy };
      ridgeSpanIn = x1 - x0;
      ridgeSupports = "king-king";
    }
    eaveRing = [{ x: eaveX0, y: eaveY0 }, { x: eaveX1, y: eaveY0 }, { x: eaveX1, y: eaveY1 }, { x: eaveX0, y: eaveY1 }];
  } else if (kind === "hip" && wall && deepWallHip) {
    // A DEEP ATTACHED HIP (2026-10-22): out from the house further than half its width. The sides rise to a ridge that
    // runs square out of the house wall; the front is a hip end, its hips coming in from the front corners at 45°.
    const We = eaveX1 - eaveX0;
    const De = eaveY1 - eaveY0;
    const runIn = We / 2;
    faceSpecs.push(rectFace("hf", { x: eaveX0, y: eaveY1 }, { x: eaveX1, y: eaveY1 }, { x: 0, y: -1 }, runIn, "apex", "hip", "hip", ovh, We - ovh));
    faceSpecs.push(rectFace("hl", { x: eaveX0, y: eaveY0 }, { x: eaveX0, y: eaveY1 }, { x: 1, y: 0 }, runIn, "ridge", "wall", "hip", 0, De - ovh));
    faceSpecs.push(rectFace("hr", { x: eaveX1, y: eaveY1 }, { x: eaveX1, y: eaveY0 }, { x: -1, y: 0 }, runIn, "ridge", "hip", "wall", ovh, De));
    const cx = (eaveX0 + eaveX1) / 2;
    ridgeFrom = { x: cx, y: eaveY0 };
    ridgeTo = { x: cx, y: eaveY1 - runIn };
    ridgeSpanIn = ridgeTo.y - ridgeFrom.y;
    ridgeSupports = "wall-king";
    eaveRing = [{ x: eaveX0, y: eaveY0 }, { x: eaveX1, y: eaveY0 }, { x: eaveX1, y: eaveY1 }, { x: eaveX0, y: eaveY1 }];
  } else if (kind === "hip" && wall) {
    const runIn = eaveY1 - eaveY0;
    faceSpecs.push(rectFace("hf", { x: eaveX0, y: eaveY1 }, { x: eaveX1, y: eaveY1 }, { x: 0, y: -1 }, runIn, "wall", "hip", "hip", ovh, eaveX1 - eaveX0 - ovh));
    faceSpecs.push(rectFace("hl", { x: eaveX0, y: eaveY0 }, { x: eaveX0, y: eaveY1 }, { x: 1, y: 0 }, runIn, "wall", "wall", "hip", 0, eaveY1 - eaveY0 - ovh));
    faceSpecs.push(rectFace("hr", { x: eaveX1, y: eaveY1 }, { x: eaveX1, y: eaveY0 }, { x: -1, y: 0 }, runIn, "wall", "hip", "wall", ovh, eaveY1 - eaveY0));
    ridgeFrom = { x: eaveX0 + runIn, y: eaveY0 };
    ridgeTo = { x: eaveX1 - runIn, y: eaveY0 };
    eaveRing = [{ x: eaveX0, y: eaveY0 }, { x: eaveX1, y: eaveY0 }, { x: eaveX1, y: eaveY1 }, { x: eaveX0, y: eaveY1 }];
  } else if (kind === "hip") {
    const We = eaveX1 - eaveX0;
    const De = eaveY1 - eaveY0;
    const runIn = Math.min(We, De) / 2;
    faceSpecs.push(rectFace("hb", { x: eaveX1, y: eaveY0 }, { x: eaveX0, y: eaveY0 }, { x: 0, y: 1 }, runIn, We > De ? "ridge" : "apex", "hip", "hip", ovh, We - ovh));
    faceSpecs.push(rectFace("hr", { x: eaveX1, y: eaveY1 }, { x: eaveX1, y: eaveY0 }, { x: -1, y: 0 }, runIn, De > We ? "ridge" : "apex", "hip", "hip", ovh, De - ovh));
    faceSpecs.push(rectFace("hf", { x: eaveX0, y: eaveY1 }, { x: eaveX1, y: eaveY1 }, { x: 0, y: -1 }, runIn, We > De ? "ridge" : "apex", "hip", "hip", ovh, We - ovh));
    faceSpecs.push(rectFace("hl", { x: eaveX0, y: eaveY0 }, { x: eaveX0, y: eaveY1 }, { x: 1, y: 0 }, runIn, De > We ? "ridge" : "apex", "hip", "hip", ovh, De - ovh));
    if (We > De) {
      ridgeFrom = { x: eaveX0 + runIn, y: (eaveY0 + eaveY1) / 2 };
      ridgeTo = { x: eaveX1 - runIn, y: (eaveY0 + eaveY1) / 2 };
    } else {
      ridgeFrom = { x: (eaveX0 + eaveX1) / 2, y: eaveY0 + runIn };
      ridgeTo = { x: (eaveX0 + eaveX1) / 2, y: eaveY1 - runIn };
    }
    eaveRing = [{ x: eaveX0, y: eaveY0 }, { x: eaveX1, y: eaveY0 }, { x: eaveX1, y: eaveY1 }, { x: eaveX0, y: eaveY1 }];
  } else if (kind === "gambrel") {
    // Two slopes a side: steep from the eave to the break, the design's pitch from the break to the ridge.
    const alongY = D > W;
    const slopeLo = GAMBREL_LOWER_PITCH / 12;
    const runIn = (alongY ? eaveX1 - eaveX0 : eaveY1 - eaveY0) / 2;
    const vBreak = Math.round(runIn * GAMBREL_BREAK_SHARE);
    gambrel = { vBreak, alongY, slopeLo };
    const Lu = alongY ? eaveY1 - eaveY0 : eaveX1 - eaveX0;
    const sides: Array<[string, V2, V2, V2]> = alongY
      ? [["gl", { x: eaveX0, y: eaveY0 }, { x: eaveX0, y: eaveY1 }, { x: 1, y: 0 }], ["gr", { x: eaveX1, y: eaveY1 }, { x: eaveX1, y: eaveY0 }, { x: -1, y: 0 }]]
      : [["gb", { x: eaveX1, y: eaveY0 }, { x: eaveX0, y: eaveY0 }, { x: 0, y: 1 }], ["gf", { x: eaveX0, y: eaveY1 }, { x: eaveX1, y: eaveY1 }, { x: 0, y: -1 }]];
    for (const [id, A, B, nrm] of sides) {
      faceSpecs.push(rectFace(`${id}1`, A, B, nrm, vBreak, "cap", "rake", "rake", ovh, Lu - ovh, ovh, vBreak, 1, slopeLo));
      const A2 = { x: A.x + nrm.x * vBreak, y: A.y + nrm.y * vBreak };
      const B2 = { x: B.x + nrm.x * vBreak, y: B.y + nrm.y * vBreak };
      const upper = rectFace(`${id}2`, A2, B2, nrm, runIn - vBreak, "ridge", "rake", "rake", ovh, Lu - ovh, 0, runIn - vBreak, 1, slope);
      faceSpecs.push(upper);
    }
    if (alongY) {
      const cx = (eaveX0 + eaveX1) / 2;
      ridgeFrom = { x: cx, y: eaveY0 };
      ridgeTo = { x: cx, y: eaveY1 };
      ridgeSpanIn = y1 - y0;
    } else {
      const cy = (eaveY0 + eaveY1) / 2;
      ridgeFrom = { x: eaveX0, y: cy };
      ridgeTo = { x: eaveX1, y: cy };
      ridgeSpanIn = x1 - x0;
    }
    ridgeSupports = "king-king";
    eaveRing = [{ x: eaveX0, y: eaveY0 }, { x: eaveX1, y: eaveY0 }, { x: eaveX1, y: eaveY1 }, { x: eaveX0, y: eaveY1 }];
  } else if (kind === "dutch-gable") {
    // A hip whose ends stop short of the ridge; a small gable (the gablet) stands on the cap above each end.
    const We = eaveX1 - eaveX0;
    const De = eaveY1 - eaveY0;
    const alongX = We > De;
    const runIn = Math.min(We, De) / 2;
    const vCap = Math.round(runIn * DUTCH_CAP_SHARE);
    dutch = { vCap, alongX };
    const c45 = 1; // cot(45°)
    // The long faces: hips up to the cap, then a plain gable face to the ridge.
    const longs: Array<[string, V2, V2, V2, number]> = alongX
      ? [["hb", { x: eaveX1, y: eaveY0 }, { x: eaveX0, y: eaveY0 }, { x: 0, y: 1 }, We], ["hf", { x: eaveX0, y: eaveY1 }, { x: eaveX1, y: eaveY1 }, { x: 0, y: -1 }, We]]
      : [["hl", { x: eaveX0, y: eaveY0 }, { x: eaveX0, y: eaveY1 }, { x: 1, y: 0 }, De], ["hr", { x: eaveX1, y: eaveY1 }, { x: eaveX1, y: eaveY0 }, { x: -1, y: 0 }, De]];
    for (const [id, A, B, nrm, Lu] of longs) {
      faceSpecs.push(rectFace(`${id}1`, A, B, nrm, vCap, "cap", "hip", "hip", ovh, Lu - ovh, ovh, vCap));
      const u = unit(sub(B, A));
      const A2 = { x: A.x + u.x * (c45 * vCap) + nrm.x * vCap, y: A.y + u.y * (c45 * vCap) + nrm.y * vCap };
      const B2 = { x: B.x - u.x * (c45 * vCap) + nrm.x * vCap, y: B.y - u.y * (c45 * vCap) + nrm.y * vCap };
      const Lu2 = len(sub(B2, A2));
      faceSpecs.push(rectFace(`${id}2`, A2, B2, nrm, runIn - vCap, "ridge", "rake", "rake", 0, Lu2, 0, runIn - vCap));
    }
    // The end faces: hips to the cap, the gablet wall above.
    const ends: Array<[string, V2, V2, V2, number]> = alongX
      ? [["hl", { x: eaveX0, y: eaveY0 }, { x: eaveX0, y: eaveY1 }, { x: 1, y: 0 }, De], ["hr", { x: eaveX1, y: eaveY1 }, { x: eaveX1, y: eaveY0 }, { x: -1, y: 0 }, De]]
      : [["hb", { x: eaveX1, y: eaveY0 }, { x: eaveX0, y: eaveY0 }, { x: 0, y: 1 }, We], ["hf", { x: eaveX0, y: eaveY1 }, { x: eaveX1, y: eaveY1 }, { x: 0, y: -1 }, We]];
    for (const [id, A, B, nrm, Lu] of ends) faceSpecs.push(rectFace(id, A, B, nrm, vCap, "cap", "hip", "hip", ovh, Lu - ovh, ovh, vCap));
    gablets = 2;
    if (alongX) {
      ridgeFrom = { x: eaveX0 + vCap, y: (eaveY0 + eaveY1) / 2 };
      ridgeTo = { x: eaveX1 - vCap, y: (eaveY0 + eaveY1) / 2 };
    } else {
      ridgeFrom = { x: (eaveX0 + eaveX1) / 2, y: eaveY0 + vCap };
      ridgeTo = { x: (eaveX0 + eaveX1) / 2, y: eaveY1 - vCap };
    }
    ridgeSpanIn = len(sub(ridgeTo, ridgeFrom));
    ridgeSupports = "none";
    eaveRing = [{ x: eaveX0, y: eaveY0 }, { x: eaveX1, y: eaveY0 }, { x: eaveX1, y: eaveY1 }, { x: eaveX0, y: eaveY1 }];
  } else {
    // A pyramid over a square or a regular polygon, in one tier or two.
    const polyFaces = (pts: V2[], a: number, o: number, id: string, cap: number | null, tier: 1 | 2): V2[] => {
      const m = pts.length;
      const cc = centroid(pts);
      const scale = (a + o) / a;
      const outer = pts.map((p) => ({ x: cc.x + (p.x - cc.x) * scale, y: cc.y + (p.y - cc.y) * scale }));
      const beta = halfPi - Math.PI / m;
      for (let k = 0; k < m; k++) {
        const A = outer[k];
        const B = outer[(k + 1) % m];
        const mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
        const nrm = unit(sub(cc, mid));
        const Lu = len(sub(B, A));
        const runIn = a + o;
        const spec = rectFace(`${id}${k}`, A, B, nrm, runIn, cap === null ? "apex" : "cap", "hip", "hip", o * cot(beta), Lu - o * cot(beta), o, cap ?? runIn, tier);
        spec.betaA = beta;
        spec.betaB = beta;
        faceSpecs.push(spec);
      }
      return outer;
    };
    const a = regular ? apothemIn : W / 2;
    apex = c;
    if (kind === "double-tier") {
      const cap = ovh + TIER_SHARE * a;
      eaveRing = polyFaces(ring, a, ovh, "t", cap, 1);
      const s2 = 1 - TIER_SHARE;
      const ring2 = ring.map((p) => ({ x: c.x + (p.x - c.x) * s2, y: c.y + (p.y - c.y) * s2 }));
      const ovh2 = Math.max(6, Math.round(ovh * 0.6));
      tier2 = { ring: ring2, apothemIn: a * s2, ovhIn: ovh2, baseTopIn: 0 };
    } else {
      eaveRing = polyFaces(ring, a, ovh, "p", null, 1);
    }
  }

  // ── Rafter size: the smallest that spans the longest common's horizontal span.
  const faceRunToTop = (f: FaceSpec) => Math.max(0, f.vTopIn - f.ovhIn);
  const tableSpan = (size: JoistSize) => (pergola && !louveredTop ? rafterMaxSpanIn(20, rafterGroup, size, spacing as 12 | 16 | 24) : rafterMaxSpanIn(roofLoad, rafterGroup, size, spacing as 12 | 16 | 24, ceilingOn));
  // A pergola's rafters run front to back in one piece when they can; past the table or past stock, header rows divide the depth into bays.
  const pergolaStock = STOCK_MAX_IN - 2 * ovh - 6;
  let pergolaBays = 1;
  let rafterSize: JoistSize;
  if (pergola) {
    const depthIn = y1 - y0;
    if (r.rafter !== "auto") {
      rafterSize = r.rafter;
      pergolaBays = Math.max(1, Math.ceil(depthIn / Math.min(Math.max(1, tableSpan(rafterSize)), pergolaStock) - 1e-9));
    } else {
      rafterSize = "2x12";
      for (let bays = 1; bays <= 6; bays++) {
        const bay = depthIn / bays;
        if (bay > pergolaStock) continue;
        const fit = JOIST_SIZES.find((sz) => tableSpan(sz) >= bay);
        if (fit) {
          rafterSize = fit;
          pergolaBays = bays;
          break;
        }
      }
    }
  } else rafterSize = r.rafter !== "auto" ? r.rafter : JOIST_SIZES.find((sz) => tableSpan(sz) >= faceSpecs.filter((f) => f.tier === 1).reduce((m, f) => Math.max(m, faceRunToTop(f)), 0)) ?? "2x12";
  const commonSpanIn = pergola ? (y1 - y0) / pergolaBays : faceSpecs.filter((f) => f.tier === 1).reduce((m, f) => Math.max(m, faceRunToTop(f)), 0);
  const rafterMax = tableSpan(rafterSize);
  const rafterDepth = joistDepthIn(rafterSize);
  const heel = HEEL_SHARE * rafterDepth;
  const arched = pergola && r.pergolaStyle === "arched";
  const louvered = pergola && r.pergolaStyle === "louvered";
  let engineered = false;
  let engineeredBeyond = false;

  // ── Headers: sized from the deck beam table at the roof's load.
  const headerCandidates: BeamSize[] = r.header !== "auto" && r.header !== "lvl" ? [r.header] : [...BUILT_UP_CHOICES, ...(solidBeamTabulated(40, group) ? SOLID_BEAMS : [])];
  /**
   * The deck beam table's first column is a 6-ft joist span (150 lb/ft of
   * 50-psf deck). A light roof or a pergola puts less than that on a header;
   * the table cannot be read below its first column, so the span it allows
   * there is stretched by the square root of the load ratio (bending grows
   * with w·L²), never past one and a half times. An ESTIMATE, said in the
   * checks.
   */
  const headerMaxSpan = (size: BeamSize, eqJoistSpanFt: number) => {
    const col = Math.max(TABLE_FIRST_COLUMN_FT, eqJoistSpanFt);
    const base = isSolidBeam(size) ? solidBeamMaxSpanIn(40, group, size, col) : builtUpBeamMaxSpanIn(40, group, size, col);
    if (!(base > 0) || eqJoistSpanFt >= TABLE_FIRST_COLUMN_FT) return base;
    const stretch = Math.min(LIGHT_LOAD_STRETCH_MAX, Math.sqrt(TABLE_FIRST_COLUMN_FT / Math.max(0.5, eqJoistSpanFt)));
    return Math.floor(base * stretch);
  };
  const postSetCost = price("labor.roofPost") + price("hw.postBase") + price("hw.postCap") + (r.eaveHeightIn / 12) * price(lumberKey(r.post));
  /** An LVL header sits in the post's cap: three plies (5¼ in.) on a 6x6 or 8x8, two (3½ in.) on a 4x. */
  const lvlMinPlies = r.post === "6x6" || r.post === "8x8" ? 3 : 2;
  const pickHeader = (lengthIn: number, eqJoistSpanFt: number, wLbPerFt: number, minSegments = 1): { spec: BeamSpec; maxSpanIn: number; segments: number } => {
    type Opt = { spec: BeamSpec; maxSpanIn: number; segments: number; cost: number };
    // An engineered beam, asked for or as the way out when no sawn header reaches: one piece post to post when it can, else the fewest posts an LVL needs.
    const lvl = (): { spec: BeamSpec; maxSpanIn: number; segments: number } | null => {
      for (let segments = Math.max(1, minSegments); segments <= Math.max(4, minSegments); segments++) {
        const span = lengthIn / segments;
        const spec = sizeLvl(span, wLbPerFt, lvlMinPlies);
        if (spec) {
          engineered = true;
          return { spec, maxSpanIn: Math.ceil(span), segments };
        }
      }
      return null;
    };
    const beyond = (): { spec: BeamSpec; maxSpanIn: number; segments: number } => {
      engineeredBeyond = true;
      return { spec: { size: "3-ply LVL 1¾×18", kind: "lvl", plies: 3, thickIn: 5.25, depthIn: 18, stock: "LVL1.75x18" }, maxSpanIn: 0, segments: 1 };
    };
    if (r.header === "lvl") return lvl() ?? beyond();
    const options: Opt[] = headerCandidates.map((size) => {
      const spec = beamSpec(size);
      const maxSpanIn = headerMaxSpan(size, eqJoistSpanFt);
      const segments = maxSpanIn > 0 ? Math.max(minSegments, Math.ceil(lengthIn / maxSpanIn - 1e-9)) : 1;
      return { spec, maxSpanIn, segments, cost: (lengthIn / 12) * spec.plies * price(lumberKey(spec.stock)) + (segments - 1) * postSetCost };
    });
    const tabulated = options.filter((o) => o.maxSpanIn > 0);
    if (!tabulated.length) return lvl() ?? beyond();
    const best = tabulated.reduce((m, o) => (o.cost < m.cost - 0.005 || (Math.abs(o.cost - m.cost) <= 0.005 && o.spec.depthIn < m.spec.depthIn) ? o : m));
    // A sawn header that needs more than two extra posts loses to an engineered beam with fewer.
    if (best.segments > 3) {
      const e = lvl();
      if (e && e.segments < best.segments) return e;
    }
    return { spec: best.spec, maxSpanIn: best.maxSpanIn, segments: best.segments };
  };

  // The ridge first, where there is one: its king posts load the headers.
  const headerBeyond: string[] = [];
  let ridge: RoofFrame["ridge"] = null;
  let kingPosts = 0;
  let ties = 0;
  let ridgeBeyond = false;
  let ridgeLengthIn = 0;
  // TRUSSES (2026-10-11; owner: "a 40-ft span on the roof with no supports is bad engineering — check the rafters and the
  // trusses to code"): a gable whose rafters run past the table, or whose ridge no beam spans while ties across it would
  // be longer than stock, is framed with manufactured trusses 24 in. on center — designed and stamped by the truss maker
  // for this roof's loads (IRC R802.10) — and so is any gable asked to. Past TRUSS_MAX_SPAN_IN it is an engineer's.
  let trusses: RoofFrame["trusses"] = null;
  let trussesBeyond = false;
  let ridgeAcrossIn = 0;
  let tiesBeyondStock = false;
  let hipEndTies = 0;
  /** Cross beams (2026-10-12): from eave header to eave header across the ridge, each with a king post at its middle. */
  const crossPlan: Array<{ A: V2; B: V2; P: number }> = [];
  /** The cross beams asked for under a gable's ridge beam. */
  const gableCross = kind === "gable" && !pergola ? Math.max(0, Math.min(3, Math.round(r.crossBeams ?? 0))) : 0;
  /**
   * A cross beam at share `t` along the ridge's supports (0 = its start, 1 = its end): square to the ridge, from one side
   * of the post ring to the other. A gable's ridge runs the ring's length; a hip's from one meeting point to the other.
   */
  const crossAt = (t: number): { A: V2; B: V2 } => {
    const alongX = !!ridgeFrom && !!ridgeTo && Math.abs(ridgeTo.x - ridgeFrom.x) > Math.abs(ridgeTo.y - ridgeFrom.y);
    if (kind === "hip") {
      const P = { x: ridgeFrom!.x + (ridgeTo!.x - ridgeFrom!.x) * t, y: ridgeFrom!.y + (ridgeTo!.y - ridgeFrom!.y) * t };
      return alongX ? { A: { x: P.x, y: y0 }, B: { x: P.x, y: y1 } } : { A: { x: x0, y: P.y }, B: { x: x1, y: P.y } };
    }
    return alongX ? { A: { x: x0 + (x1 - x0) * t, y: y0 }, B: { x: x0 + (x1 - x0) * t, y: y1 } } : { A: { x: x0, y: y0 + (y1 - y0) * t }, B: { x: x1, y: y0 + (y1 - y0) * t } };
  };
  const trussPlan = (spanIn: number, why: NonNullable<RoofFrame["trusses"]>["why"]): NonNullable<RoofFrame["trusses"]> => ({ count: 0, gableEnds: 0, spanIn: Math.round(spanIn), spacingIn: TRUSS_SPACING_IN, chord: spanIn > TRUSS_2X4_MAX_IN || roofLoad >= 50 ? "2x6" : "2x4", why });
  // A trial beam for the ridge may raise the engineered flags; a ridge that ends as a board or trusses gives them back.
  const engineeredBeforeRidge = engineered;
  const engineeredBeyondBeforeRidge = engineeredBeyond;
  if (ridgeFrom && ridgeTo) {
    ridgeLengthIn = len(sub(ridgeTo, ridgeFrom));
    // Across the ridge: what a tie or a truss would span, bearing to bearing.
    const acrossRidge = Math.abs(ridgeTo.x - ridgeFrom.x) > Math.abs(ridgeTo.y - ridgeFrom.y) ? y1 - y0 : x1 - x0;
    ridgeAcrossIn = Math.round(acrossRidge);
    const trussFits = kind === "gable" && acrossRidge <= TRUSS_MAX_SPAN_IN;
    const trussWhy: "asked" | "rafters" | null = kind !== "gable" ? null : r.ridge === "trusses" ? "asked" : r.ridge === "auto" && commonSpanIn > rafterMax + 0.01 ? "rafters" : null;
    if (trussWhy && trussFits) trusses = trussPlan(acrossRidge, trussWhy);
    if (trussWhy === "asked" && !trussFits) trussesBeyond = true;
    // A ridge BEAM ends on king posts: when one would bring down more than a footing table reads, and a tie across the
    // roof would be longer than stock, the gable is trussed instead — nothing heavy on one post.
    const footingLimitLb = design.floor === "slab" || design.floor === "existing" ? Infinity : POST_TABLE_MAX_AREA * (design.loadPsf + 10);
    if (!trusses && r.ridge === "auto" && kind === "gable" && trussFits && acrossRidge > STOCK_MAX_IN && faceSpecs[0]) {
      const kingLoadLb = totalPsf * (faceSpecs[0].runIn / 12) * (ridgeSpanIn / (gableCross + 1) / 12) * 0.5;
      if (kingLoadLb > footingLimitLb) trusses = { ...trussPlan(acrossRidge, "post"), ridgeSpanIn: Math.round(ridgeSpanIn), kingLoadLb: Math.round(kingLoadLb) };
    }
    // A hip whose rafter ties would be longer than stock lumber carries its ridge on a beam instead (2026-10-22): a king
    // post on a cross beam at each hip end — no ties at all — where a gable would be trussed.
    const hipNeedsBeam = kind === "hip" && (!wall || deepWallHip) && acrossRidge > STOCK_MAX_IN;
    const auto: "beam" | "board" | "none" = kind === "gable" || hipNeedsBeam ? "beam" : "board";
    const asked = r.ridge === "auto" || r.ridge === "trusses" ? auto : r.ridge;
    const rk: "beam" | "board" | "none" = kind === "hip" && asked === "none" ? "board" : kind === "gable" && asked === "none" ? "board" : asked;
    if (trusses) {
      // Framed after the headers: no ridge member, no king posts, no ties — every truss is one piece across.
    } else if (rk === "beam" && (kind === "gable" || kind === "gambrel")) {
      const runFt = (kind === "gambrel" ? (gambrel ? faceSpecs[0].runIn + faceSpecs[1].runIn : faceSpecs[0].runIn) : faceSpecs[0].runIn) / 12;
      const eq = (2 * runFt * totalPsf) / 50;
      const wRidge = runFt * totalPsf;
      // Cross beams under it (2026-10-12) cut the ridge into equal spans, each read on its own.
      const spanEach = ridgeSpanIn / (gableCross + 1);
      let pick = pickHeader(spanEach, eq, wRidge);
      let beyond = pick.maxSpanIn === 0 || pick.maxSpanIn < spanEach - 0.01;
      const tieAcross = Math.abs(ridgeTo.x - ridgeFrom.x) > Math.abs(ridgeTo.y - ridgeFrom.y) ? y1 - y0 : x1 - x0;
      // Asked for a beam that no sawn size spans: an engineered ridge instead of a flag.
      if (beyond && (r.ridge === "beam" || tieAcross > STOCK_MAX_IN || kind === "gambrel")) {
        const lvlSpec = sizeLvl(spanEach, wRidge, 2);
        if (lvlSpec) {
          pick = { spec: lvlSpec, maxSpanIn: Math.ceil(spanEach), segments: 1 };
          beyond = false;
          engineered = true;
        }
      }
      if (beyond && r.ridge === "auto" && tieAcross <= STOCK_MAX_IN) {
        // Nothing in the table carries a beam this long: framed with a ridge board and ties instead (the checks say so; "Beam" prices an engineered one).
        const nominal = oneDeeper(rafterSize);
        ridge = { kind: "board", nominal, lengthIn: ridgeLengthIn, spec: null, spanIn: ridgeSpanIn, maxSpanIn: pick.maxSpanIn, eqJoistSpanFt: Math.round(eq * 10) / 10, fellBack: true };
        ties = Math.floor(ridgeSpanIn / TIE_SPACING_IN) + 1;
      } else if (beyond && r.ridge === "auto" && trussFits) {
        // No beam spans it and a tie across would be longer than stock: trusses, one piece header to header.
        trusses = trussPlan(acrossRidge, "ridge");
      } else {
        ridgeBeyond = beyond;
        ridge = { kind: "beam", nominal: pick.spec.stock, lengthIn: ridgeLengthIn, spec: pick.spec, spanIn: Math.round(spanEach), maxSpanIn: pick.maxSpanIn, eqJoistSpanFt: Math.round(eq * 10) / 10, fellBack: false };
        kingPosts = (ridgeSupports === "king-king" ? 2 : 1) + (kind === "gable" ? gableCross : 0);
        // Each cross beam's king post carries a span of ridge: half from each side.
        if (kind === "gable") for (let i = 1; i <= gableCross; i++) crossPlan.push({ ...crossAt(i / (gableCross + 1)), P: wRidge * (spanEach / 12) });
      }
    } else if (rk === "beam" && kind === "hip" && (!wall || deepWallHip) && ridgeLengthIn > 1) {
      // A FREE HIP'S RIDGE BEAM (2026-10-12): it spans between the hips' meeting points, each held up by a king post on a
      // CROSS BEAM from eave header to eave header — the hips then bear on it as the beams designHip takes them for
      // (R802.3), and nothing pushes the headers apart. Until now the "beam" was a doubled board resting on the hips.
      const top = faceSpecs.find((f) => f.tier === 1 && f.top === "ridge");
      const runFt = top ? (top.vTopIn - top.ovhIn) / 12 : 0;
      const wRidge = runFt * totalPsf;
      const eq = (2 * runFt * totalPsf) / 50;
      let pick = pickHeader(ridgeLengthIn, eq, wRidge);
      let beyond = pick.maxSpanIn === 0 || pick.maxSpanIn < ridgeLengthIn - 0.01;
      if (beyond) {
        const lvlSpec = sizeLvl(ridgeLengthIn, wRidge, 2);
        if (lvlSpec) {
          pick = { spec: lvlSpec, maxSpanIn: Math.ceil(ridgeLengthIn), segments: 1 };
          beyond = false;
          engineered = true;
        }
      }
      ridgeBeyond = beyond;
      ridge = { kind: "beam", nominal: pick.spec.stock, lengthIn: ridgeLengthIn, spec: pick.spec, spanIn: Math.round(ridgeLengthIn), maxSpanIn: pick.maxSpanIn, eqJoistSpanFt: Math.round(eq * 10) / 10, fellBack: false };
      // A deep attached hip's ridge: the house at one end, a king post at the hip end (2026-10-22).
      kingPosts = deepWallHip ? 1 : 2;
      // On each king post: half the ridge, the tops of the two hips that meet there (2/3 of what each carries — its load
      // rises toward the top) and the top half of the common between them.
      const hipFace0 = faceSpecs.find((fs) => fs.tier === 1 && (fs.sideA === "hip" || fs.sideB === "hip"));
      const hipW = hipFace0 ? designHip(hipFace0.vTopIn, hipFace0.ovhIn, Math.PI / 4, rafterSize, rafterGroup, totalPsf, roofLoad >= 30, ceilingOn).loadLb : 0;
      const P = (wRidge * (ridgeLengthIn / 12)) / 2 + 2 * ((2 * hipW) / 3) + totalPsf * (spacing / 12) * (runFt / 2);
      if (deepWallHip) crossPlan.push({ ...crossAt(1), P });
      else crossPlan.push({ ...crossAt(0), P }, { ...crossAt(1), P });
    } else {
      const nominal = oneDeeper(rafterSize);
      ridge = { kind: "board", nominal, lengthIn: ridgeLengthIn, spec: null, spanIn: 0, maxSpanIn: 0, eqJoistSpanFt: 0, fellBack: false };
      // A ridge BOARD holds nothing up (2026-10-12): the rafters that meet on it push their headers apart unless rafter
      // ties hold them, 4 ft on centre at the header line (R802.5.2) — over a gable's whole ridge, and over the stretch
      // where commons meet the ridge on a free hip, a Dutch gable or a gambrel ("a hip roof ties itself" was wrong there).
      if (kind === "gable" || kind === "gambrel" || kind === "dutch-gable" || (kind === "hip" && (!wall || deepWallHip))) {
        ties = Math.floor((kind === "gable" || kind === "gambrel" ? ridgeSpanIn : ridgeLengthIn) / TIE_SPACING_IN) + 1;
        if (acrossRidge > STOCK_MAX_IN) tiesBeyondStock = true;
        // A free hip's end: the common from the end header's middle up to the ridge pushes that header out too — a tie
        // runs from there back to the first rafter tie.
        if (kind === "hip") hipEndTies = deepWallHip ? 1 : 2;
      }
    }
  }
  if (ridge?.kind !== "beam") {
    engineered = engineeredBeforeRidge;
    engineeredBeyond = engineeredBeyondBeforeRidge;
  }

  // ── Posts and headers around the ring.
  const posts: RoofPost[] = [];
  const headers: RoofHeader[] = [];
  const members: RoofMember[] = [];
  const planes: RoofPlane[] = [];
  const footprintSqFt = ringArea(eaveRing) / 144;
  const ringAreaSqFt = ringArea(ring) / 144;
  const [pw, pd] = POST_ACTUAL_IN[r.post];
  const headerTopOf = new Map<string, number>();

  const edgeIsWall = (k: number) => wall && Math.abs(ring[k].y - y0) < 0.01 && Math.abs(ring[(k + 1) % n].y - y0) < 0.01;
  const faceOfEdge = (k: number): FaceSpec | undefined => {
    const A = ring[k];
    const B = ring[(k + 1) % n];
    const mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
    return faceSpecs.filter((f) => f.tier === 1).find((f) => {
      // The face whose eave is parallel to this edge and just outside it.
      const u = unit(sub(f.B, f.A));
      const d = sub(mid, f.A);
      const along = d.x * u.x + d.y * u.y;
      const off = d.x * f.n.x + d.y * f.n.y;
      return Math.abs(off - f.ovhIn) < 0.6 && along > -1 && along < len(sub(f.B, f.A)) + 1;
    });
  };

  // Posts at the ring's corners (not on the wall); a round ring takes one at every second corner.
  const postEvery = regular && n === ROUND_SIDES ? 2 : 1;
  const cornerPosts: Array<{ k: number; x: number; y: number }> = [];
  for (let k = 0; k < n; k += postEvery) {
    const p = ring[k];
    if (wall && Math.abs(p.y - y0) < 0.01) continue;
    cornerPosts.push({ k, x: p.x, y: p.y });
  }

  // POSTS AND OPENINGS SET BY HAND (2026-11-13 — a deck builder: "let me add two posts with a 4-ft opening for a future
  // screen door"). Each is put on its side of the ring — the front is the edge farthest from the house, the left and
  // right its ends, the back a free roof's house side — at its place along it. An opening is two posts (its jambs) its
  // clear width apart and a stretch between them where no post may stand; a pin is one post. They go into the headers'
  // laying as posts that MUST stand and stretches that must stay clear — the same two things a cross beam's landing
  // and a stair's opening already were — so the header over an opening is sized for the span the opening makes, more
  // posts go in beside it where a span is past every header, and nothing is ever just left out of the structure.
  // A round, six- or eight-sided roof has no front or side to measure along: said, not guessed.
  type UserEdge = { posts: number[]; keeps: Array<[number, number]>; opens: Array<{ o: RoofOpening; lo: number; hi: number; cornerJambs: number }>; pins: Array<{ p: RoofPin; at: number }> };
  const userEdges = new Map<number, UserEdge>();
  const notPlaced: RoofFrame["notPlaced"] = [];
  const pw0 = POST_ACTUAL_IN[r.post]?.[0] ?? 5.5;
  const sideEdge = (side: RoofSide): number => {
    if (regular) return -1;
    let best = -1;
    let score = -Infinity;
    for (let k = 0; k < n; k += postEvery) {
      if (edgeIsWall(k)) continue;
      const A = ring[k];
      const B = ring[(k + postEvery) % n];
      const L = len(sub(B, A));
      const horiz = Math.abs(A.y - B.y) < 0.5;
      const vert = Math.abs(A.x - B.x) < 0.5;
      const sc = side === "front" ? (horiz && A.y > y0 + 1 ? A.y * 1000 + L : -Infinity) : side === "back" ? (horiz && A.y < y1 - 1 ? -A.y * 1000 + L : -Infinity) : side === "left" ? (vert ? -A.x * 1000 + L : -Infinity) : vert ? A.x * 1000 + L : -Infinity;
      if (sc > score) {
        score = sc;
        best = k;
      }
    }
    return best;
  };
  /** A place along a side — from its left end (front, back) or its house end (left, right) — as inches from the edge's own start. */
  const alongEdge = (k: number, side: RoofSide, atIn: number): { s: number; L: number } => {
    const A = ring[k];
    const B = ring[(k + postEvery) % n];
    const L = len(sub(B, A));
    const fromStart = side === "front" || side === "back" ? A.x <= B.x : A.y <= B.y;
    const t = Math.max(0, Math.min(L, atIn));
    return { s: fromStart ? t : L - t, L };
  };
  const sides: RoofFrame["sides"] = {};
  for (const side of ["front", "left", "right", "back"] as const) {
    const k = sideEdge(side);
    if (k < 0) continue;
    const A = ring[k];
    const B = ring[(k + postEvery) % n];
    const L = len(sub(B, A));
    if (!(L > 1)) continue;
    const fromStart = side === "front" || side === "back" ? A.x <= B.x : A.y <= B.y;
    const a = fromStart ? A : B;
    const b = fromStart ? B : A;
    sides[side] = { x: a.x, y: a.y, ux: (b.x - a.x) / L, uy: (b.y - a.y) / L, lengthIn: L };
  }
  const edgeOf = (k: number): UserEdge => {
    const e = userEdges.get(k) ?? { posts: [], keeps: [], opens: [], pins: [] };
    userEdges.set(k, e);
    return e;
  };
  if (!pergola || r.openings.length || r.pins.length) {
    for (const o of r.openings) {
      const k = sideEdge(o.side);
      if (k < 0) {
        notPlaced.push({ kind: "opening", id: o.id, why: regular ? "a round or many-sided roof has no side to measure along" : o.side === "back" ? "the roof hangs on the house there" : `the roof has no ${o.side} side` });
        continue;
      }
      const { s: c0, L } = alongEdge(k, o.side, o.atFt * 12);
      // Its clear width, never more than the side between its corner posts; its two posts' centres half a post outside it.
      const clear = Math.min(o.widthFt * 12, L - pw0);
      if (clear < 24) {
        notPlaced.push({ kind: "opening", id: o.id, why: "that side is too short for an opening" });
        continue;
      }
      const half = clear / 2 + pw0 / 2;
      const c = Math.max(half, Math.min(L - half, c0));
      let lo = c - half;
      let hi = c + half;
      // A jamb within a post of the corner IS the corner's post.
      let cornerJambs = 0;
      if (lo < pw0 + 1) {
        lo = 0;
        cornerJambs++;
      }
      if (hi > L - pw0 - 1) {
        hi = L;
        cornerJambs++;
      }
      const e = edgeOf(k);
      if (e.opens.some((x) => lo < x.hi - 0.5 && hi > x.lo + 0.5)) {
        notPlaced.push({ kind: "opening", id: o.id, why: "it overlaps another opening on that side" });
        continue;
      }
      e.opens.push({ o, lo, hi, cornerJambs });
      e.keeps.push([lo, hi]);
      for (const at of [lo, hi]) if (at > 0.5 && at < L - 0.5 && !e.posts.some((q) => Math.abs(q - at) < pw0 + 1)) e.posts.push(at);
    }
    for (const pin of r.pins) {
      const k = sideEdge(pin.side);
      if (k < 0) {
        notPlaced.push({ kind: "post", id: pin.id, why: regular ? "a round or many-sided roof has no side to measure along" : pin.side === "back" ? "the roof hangs on the house there" : `the roof has no ${pin.side} side` });
        continue;
      }
      const { s: at, L } = alongEdge(k, pin.side, pin.atFt * 12);
      const e = edgeOf(k);
      if (at < pw0 + 1 || at > L - pw0 - 1) {
        notPlaced.push({ kind: "post", id: pin.id, why: "a corner post stands there already" });
        continue;
      }
      if (e.opens.some((x) => at > x.lo + 0.5 && at < x.hi - 0.5)) {
        notPlaced.push({ kind: "post", id: pin.id, why: "it would stand in an opening" });
        continue;
      }
      if (e.posts.some((q) => Math.abs(q - at) < pw0 + 1)) {
        notPlaced.push({ kind: "post", id: pin.id, why: "a post stands there already" });
        continue;
      }
      e.posts.push(at);
      e.pins.push({ p: pin, at });
    }
  }
  /** The farthest the posts may stand apart, by hand, inches (0 = the spans decide). */
  const spacingByHandIn = typeof r.postSpacingFt === "number" ? r.postSpacingFt * 12 : 0;
  /** Posts that stand inside an opening set by hand because the structure cannot spare them: [edge, along]. */
  const postsInOpenings: Array<{ k: number; at: number }> = [];

  // Headers edge by edge (post to post), with the posts their spans need — laid again with more posts on a header whose
  // post would bring down more than the footing table reads (2026-10-11).
  const extraPosts: Array<{ x: number; y: number; edge: number }> = [];
  const pergolaMidYs: number[] = [];
  /** What each header carries: lb per foot along it, and a king post's point load at its middle. */
  const headerLoad = new Map<string, { w: number; P: number }>();
  /** The fewest segments (spans) a header is laid in — raised when one of its posts reads past the footing table. */
  const minSegs = new Map<string, number>();
  const engineeredBeforeHeaders = engineered;
  const engineeredBeyondBeforeHeaders = engineeredBeyond;

  // CLEAR OF THE STAIRS (2026-10-12): roof posts were set by the spans alone, so a covered deck's middle post — and a
  // gable's post under its king post — stood in the middle of a stair centred on the front. A post a header's spans would
  // set in a stair's opening now stands just beside it (STAIR_POST_CLEAR_IN past the stair's edge); the header is sized
  // for the spans it really has — the king post's load in the span over the stair when no post can stand under it — and
  // takes another post when a span grows past what any header reaches. A ring corner cannot move: the checks say so.
  const openings = opts.stairOpenings ?? [];
  const deckW = deck ? Math.max(...deck.zones.map((z) => z.x1)) : 0;
  const deckD = deck ? Math.max(...deck.zones.map((z) => z.y1)) : 0;
  /** The stretches along a header (in. from its start) where a post's centre may not stand. */
  const keepOutAlong = (A: V2, B: V2, L: number): Array<[number, number]> => {
    if (!openings.length || !deck) return [];
    const u = unit(sub(B, A));
    const horiz = Math.abs(A.y - B.y) < 0.5;
    const vert = Math.abs(A.x - B.x) < 0.5;
    const pad = pw / 2 + STAIR_POST_CLEAR_IN;
    const out: Array<[number, number]> = [];
    for (const o of openings) {
      const along = o.side === "front" ? horiz && Math.abs(A.y - deckD) <= 24 : o.side === "left" ? vert && Math.abs(A.x) <= 24 : vert && Math.abs(A.x - deckW) <= 24;
      if (!along) continue;
      const toS = (v: number) => (o.side === "front" ? (v - A.x) * u.x : (v - A.y) * u.y);
      const s0 = Math.min(toS(o.fromIn), toS(o.toIn));
      const s1 = Math.max(toS(o.fromIn), toS(o.toIn));
      if (s1 < -pad || s0 > L + pad) continue;
      out.push([s0 - pad, s1 + pad]);
    }
    return out;
  };
  const inKeep = (keep: Array<[number, number]>, at: number) => keep.some(([k0, k1]) => at > k0 + 1e-6 && at < k1 - 1e-6);
  /** A header's posts at `segs` equal spans, each moved out of an opening to its nearer side where a post fits there. */
  const placeClear = (L: number, segs: number, keep: Array<[number, number]>): number[] => {
    const room = (v: number) => v >= pw + 1 && v <= L - pw - 1;
    const out: number[] = [];
    for (let i = 1; i < segs; i++) {
      let at = (L * i) / segs;
      for (let guard = 0; guard < 4 && Number.isFinite(at); guard++) {
        const hit = keep.find(([k0, k1]) => at > k0 + 1e-6 && at < k1 - 1e-6);
        if (!hit) break;
        const [lo, hi] = hit;
        at = room(lo) && (!room(hi) || at - lo <= hi - at) ? lo : room(hi) ? hi : NaN;
      }
      if (!Number.isFinite(at) || inKeep(keep, at)) continue;
      if (out.some((o) => Math.abs(o - at) < pw + 1)) continue;
      out.push(at);
    }
    return out.sort((a, b) => a - b);
  };
  /** The lightest header that spans every one of these spans at its own load (lb/ft, and the beam table's column), or none. */
  const headerForSpans = (spans: number[], ws: number[]): { spec: BeamSpec; maxSpanIn: number; eq: number } | null => {
    const eqs = ws.map((w) => Math.round(((2 * w) / 50) * 10) / 10);
    if (r.header !== "lvl") {
      let best: { spec: BeamSpec; maxSpanIn: number; eq: number; cost: number } | null = null;
      for (const size of headerCandidates) {
        const spec = beamSpec(size);
        let ok = true;
        let govern = { margin: Infinity, max: 0, eq: eqs[0] ?? 0 };
        spans.forEach((sp, i) => {
          const m = headerMaxSpan(size, eqs[i]);
          if (!(m > 0) || m < sp) ok = false;
          else if (m - sp < govern.margin) govern = { margin: m - sp, max: m, eq: eqs[i] };
        });
        if (!ok) continue;
        const cost = spec.plies * price(lumberKey(spec.stock));
        if (!best || cost < best.cost - 0.005 || (Math.abs(cost - best.cost) <= 0.005 && spec.depthIn < best.spec.depthIn)) best = { spec, maxSpanIn: govern.max, eq: govern.eq, cost };
      }
      if (best) return { spec: best.spec, maxSpanIn: best.maxSpanIn, eq: best.eq };
    }
    let spec: BeamSpec | null = null;
    let govern = 0;
    for (let i = 0; i < spans.length; i++) {
      const lv = sizeLvl(spans[i], ws[i], lvlMinPlies);
      if (!lv) return null;
      if (!spec || lv.depthIn > spec.depthIn || (lv.depthIn === spec.depthIn && lv.plies > spec.plies)) {
        spec = lv;
        govern = i;
      }
    }
    if (!spec) return null;
    engineered = true;
    return { spec, maxSpanIn: Math.ceil(Math.max(...spans)), eq: eqs[govern] };
  };
  /** Posts that could not be cleared (each laying of the headers starts the list again). */
  const stuckPosts: V2[] = [];
  const headersOff = new Set(r.headersOff ?? []);
  const headersLeftOut: RoofFrame["headersLeftOut"] = [];

  const layHeaders = () => {
    headers.length = 0;
    headersLeftOut.length = 0;
    extraPosts.length = 0;
    stuckPosts.length = 0;
    pergolaMidYs.length = 0;
    headerBeyond.length = 0;
    postsInOpenings.length = 0;
    headerLoad.clear();
    engineered = engineeredBeforeHeaders;
    engineeredBeyond = engineeredBeyondBeforeHeaders;
    for (let k = 0; k < n; k += postEvery) {
      if (edgeIsWall(k)) continue;
      const A = ring[k];
      const B = ring[(k + postEvery) % n];
      const lengthIn = len(sub(B, A));
      const face = faceOfEdge(k);
      // What this header carries: half the rafters' run on its face (eave side), or a king post on a gable end.
      let tribFt = 0;
      let king = false;
      let kingP = 0;
      if (pergola) tribFt = (y1 - y0) / 2 / 12 + ovh / 12;
      else if (face && (kind === "gambrel" || kind === "dutch-gable")) {
        // The whole slope's weight comes down the lower rafters to the header (the ties take the thrust, not the weight):
        // its whole run, the overhang included (2026-10-12 — it was read as half the run, though this note said whole).
        const whole = kind === "gambrel" && gambrel ? (gambrel.alongY ? (eaveX1 - eaveX0) / 2 : (eaveY1 - eaveY0) / 2) : Math.min(eaveX1 - eaveX0, eaveY1 - eaveY0) / 2;
        // A Dutch gable's ends are hip ends, though: their jacks rest half on the hips.
        tribFt = kind === "dutch-gable" && !face.id.endsWith("1") ? (face.vTopIn - face.ovhIn) / 2 / 12 + face.ovhIn / 12 : whole / 12;
      // An eave header carries half its face's run and the overhang when a ridge BEAM takes the other half; under a ridge
      // board with ties, or trusses, nothing at the ridge carries anything — the whole face comes down on this header.
      // So does a free hip's long side under a ridge board (2026-10-12): its commons meet on nothing that holds them up.
      } else if (face) tribFt = ridge?.kind !== "beam" && (kind === "gable" || (kind === "hip" && (!wall || deepWallHip) && face.top === "ridge")) ? face.vTopIn / 12 : (face.vTopIn - face.ovhIn) / 2 / 12 + face.ovhIn / 12;
      else if (kind === "gable") {
        // A gable end: the rakes bear on nothing; the king post does, when the ridge is a beam.
        const runFt = faceSpecs[0].runIn / 12;
        if (ridge?.kind === "beam") {
          const P = totalPsf * runFt * (ridgeSpanIn / (gableCross + 1) / 12) * 0.5;
          kingP = P;
          const wEq = (2 * P) / Math.max(1, lengthIn / 12);
          tribFt = wEq / totalPsf;
          king = true;
        } else tribFt = 1;
      } else if (kind === "shed") tribFt = Math.abs(B.x - A.x) > Math.abs(B.y - A.y) ? (y1 - y0) / 2 / 12 + ovh / 12 : 1;
      // A BEAM NOTHING BEARS ON (2026-11-09 — owner: "we don't need that beam because a truss is up there"): a gable end
      // with no king post on it (trusses, or a ridge board with ties) and a shed's sloping side only tie two posts
      // together. Left out by hand, it is simply not laid; the moment something bears on it again it is back.
      const idle = !pergola && !face && !king && (kind === "gable" || (kind === "shed" && Math.abs(B.x - A.x) <= Math.abs(B.y - A.y)));
      if (idle && headersOff.has(`h${k + 1}`) && !userEdges.has(k)) {
        headersLeftOut.push({ id: `h${k + 1}`, x0: A.x, y0: A.y, x1: B.x, y1: B.y, lengthIn });
        continue;
      }
      const eq = Math.round(((2 * tribFt * totalPsf) / 50) * 10) / 10;
      let eqUsed = eq;
      // The fewest spans: what a post past the footing table asked for, and — by hand — posts no farther apart than the builder set.
      const segMin = Math.max(minSegs.get(`h${k + 1}`) ?? 1, spacingByHandIn ? Math.ceil(lengthIn / spacingByHandIn - 1e-9) : 1);
      let pick = pickHeader(lengthIn, eq, tribFt * totalPsf, segMin);
      if (king && pick.segments > 1) {
        // A king post's load does not ride mid-bay (its equivalent load was for ONE span): a post goes right under it — an
        // even number of spans — and between the posts the header carries only the rake's own weight. Where a stair's
        // opening is under it, the post stands beside the stair and the header carries the king post across (below).
        eqUsed = Math.round(((2 * totalPsf) / 50) * 10) / 10;
        const m0 = Math.max(2, segMin);
        pick = pickHeader(lengthIn, eqUsed, totalPsf, m0 % 2 ? m0 + 1 : m0);
        if (pick.segments % 2) pick = pickHeader(lengthIn, eqUsed, totalPsf, pick.segments + 1);
      }
      const wallEnd = wall && (Math.abs(A.y - y0) < 0.01 || Math.abs(B.y - y0) < 0.01);
      const id = `h${k + 1}`;
      // What it really carries: a gable end with a king post holds the rake's own weight plus the post's point load.
      const wLb = (king ? 1 : tribFt) * totalPsf;
      headerLoad.set(id, { w: wLb, P: king ? kingP : 0 });
      const u = unit(sub(B, A));
      let inner = Array.from({ length: pick.segments - 1 }, (_, i) => (lengthIn * (i + 1)) / pick.segments);
      let spec = pick.spec;
      let maxSpanIn = pick.maxSpanIn;
      let eqHeader = eqUsed;
      const mine = userEdges.get(k);
      const keep = mine ? [...keepOutAlong(A, B, lengthIn), ...mine.keeps] : keepOutAlong(A, B, lengthIn);
      // POSTS UNDER THE CROSS BEAMS (2026-10-12): a post stands where each cross beam lands on this header, and the header
      // spans between them — with more posts between where that is cheaper, or where a span is past every header.
      const forced = crossPlan
        .flatMap((c) => [c.A, c.B])
        .map((Q) => {
          const d = sub(Q, A);
          const along = d.x * u.x + d.y * u.y;
          const off = Math.abs(-d.x * u.y + d.y * u.x);
          return off < 0.5 && along > pw && along < lengthIn - pw ? along : NaN;
        })
        .filter((v) => Number.isFinite(v));
      // The builder's posts and their openings' jambs stand too (2026-11-13): one post where two would share a place.
      if (mine) for (const at of mine.posts) if (!forced.some((q) => Math.abs(q - at) < pw + 1)) forced.push(at);
      forced.sort((a, b) => a - b);
      /** A span that IS an opening set by hand: it is as wide as the builder made it, whatever the spacing asked. */
      const isOpening = (c0: number, c1: number) => !!mine && mine.opens.some((x) => Math.abs(x.lo - c0) < 0.5 && Math.abs(x.hi - c1) < 0.5);
      if (forced.length || (mine && mine.keeps.length)) {
        const perFtF = (sp: BeamSpec) => sp.plies * (sp.kind === "lvl" ? sp.depthIn * price("lf.lvl") : price(lumberKey(sp.stock)));
        const minS = mine ? minSegs.get(`h${k + 1}`) ?? 1 : segMin;
        const wOwn = tribFt * totalPsf;
        // What each span carries: its own even load — and, on a gable end whose ridge beam stands on a king post, the
        // post's weight in the span under it, as the even load that bends the header as much (2026-11-13: an opening
        // under the peak makes a short span that holds the whole king post).
        const loads = (cuts: number[], spans: number[]) => spans.map((sp, i) => (king ? wLb + (lengthIn / 2 > cuts[i] + 0.5 && lengthIn / 2 < cuts[i + 1] - 0.5 ? (2 * kingP) / Math.max(1, sp / 12) : 0) : wOwn));
        let best: { inner: number[]; spec: BeamSpec; maxSpanIn: number; eq: number; cost: number } | null = null;
        for (let extra = 0; extra <= Math.max(4, minS); extra++) {
          const cuts = [0, ...forced, lengthIn];
          for (let e = 0; e < extra; e++) {
            // The longest span that can take a post: its middle, or — a stair or an opening there — the nearer side of that.
            const order = cuts.slice(0, -1).map((_, i) => i).sort((p, q) => cuts[q + 1] - cuts[q] - (cuts[p + 1] - cuts[p]));
            let set = false;
            for (const wi of order) {
              let at = (cuts[wi] + cuts[wi + 1]) / 2;
              const hit = keep.find(([k0, k1]) => at > k0 && at < k1);
              if (hit) at = hit[0] > cuts[wi] + pw && at - hit[0] <= hit[1] - at ? hit[0] : hit[1] < cuts[wi + 1] - pw ? hit[1] : hit[0] > cuts[wi] + pw ? hit[0] : NaN;
              if (!Number.isFinite(at)) continue;
              cuts.splice(wi + 1, 0, at);
              set = true;
              break;
            }
            if (!set) break;
          }
          if (cuts.length - 1 < minS) continue;
          const spans = cuts.slice(1).map((v, i) => v - cuts[i]);
          // By hand: no two posts farther apart than the builder set — but for an opening, which is as wide as it was made.
          if (mine && spacingByHandIn && spans.some((sp, i) => sp > spacingByHandIn + 0.5 && !isOpening(cuts[i], cuts[i + 1])) && extra < Math.max(4, segMin)) continue;
          const sized = headerForSpans(spans, loads(cuts, spans));
          if (!sized) continue;
          const cost = (lengthIn / 12) * perFtF(sized.spec) + (cuts.length - 2) * postSetCost;
          if (!best || cost < best.cost - 0.005) best = { inner: cuts.slice(1, -1), ...sized, cost };
        }
        if (best) {
          inner = best.inner;
          spec = best.spec;
          maxSpanIn = best.maxSpanIn;
          eqHeader = best.eq;
        } else {
          inner = forced;
          maxSpanIn = 0;
        }
        for (const at of forced) if (inKeep(keep, at)) stuckPosts.push({ x: A.x + u.x * at, y: A.y + u.y * at });
        // A post the structure cannot spare — under a cross beam's end — inside an opening set by hand: it stays, and it is said.
        if (mine) for (const at of inner) if (mine.opens.some((x) => at > x.lo + 0.5 && at < x.hi - 0.5)) postsInOpenings.push({ k, at });
      } else if (keep.length && inner.some((at) => inKeep(keep, at))) {
        // The cheapest that works, as pickHeader weighs it — the header's lumber against another post — over a few
        // layings; past those, the first that works at all.
        const perFt = (sp: BeamSpec) => sp.plies * (sp.kind === "lvl" ? sp.depthIn * price("lf.lvl") : price(lumberKey(sp.stock)));
        let cleared: { inner: number[]; spec: BeamSpec; maxSpanIn: number; eq: number; cost: number } | null = null;
        for (let segs = pick.segments; segs <= 8 && (!cleared || segs <= pick.segments + 2); segs++) {
          const at = placeClear(lengthIn, segs, keep);
          const cuts = [0, ...at, lengthIn];
          const spans = cuts.slice(1).map((v, i) => v - cuts[i]);
          // The span over the stair holds the king post when no post stands under it: its load as an even load that bends the header as much.
          const ws = spans.map((sp, i) => wLb + (king && lengthIn / 2 > cuts[i] + 0.5 && lengthIn / 2 < cuts[i + 1] - 0.5 ? (2 * kingP) / Math.max(1, sp / 12) : 0));
          const sized = headerForSpans(spans, ws);
          if (!sized) continue;
          const cost = (lengthIn / 12) * perFt(sized.spec) + at.length * postSetCost;
          if (!cleared || cost < cleared.cost - 0.005) cleared = { inner: at, ...sized, cost };
        }
        if (cleared) {
          inner = cleared.inner;
          spec = cleared.spec;
          maxSpanIn = cleared.maxSpanIn;
          eqHeader = cleared.eq;
        } else for (const at of inner) if (inKeep(keep, at)) stuckPosts.push({ x: A.x + u.x * at, y: A.y + u.y * at });
      }
      if (maxSpanIn === 0) headerBeyond.push(id);
      const postAt: number[] = [0, ...inner, lengthIn];
      for (const at of inner) extraPosts.push({ x: A.x + u.x * at, y: A.y + u.y * at, edge: k });
      const spanIn = postAt.slice(1).reduce((m, v, i) => Math.max(m, v - postAt[i]), 0);
      headers.push({ id, x0: A.x, y0: A.y, x1: B.x, y1: B.y, lengthIn, spec, postAt, spanIn, eqJoistSpanFt: eqHeader, maxSpanIn, kingPost: king, wallEnd, ...(idle ? { idle: true } : {}) });
    }
    // THE CROSS BEAMS (2026-10-12): one span each, eave header to eave header, hung on them over the posts under their
    // ends; the king post's load at the middle read as the even load that bends it as much (2P/L) — sawn from the deck
    // beam table where one reaches, else an LVL.
    crossPlan.forEach((c, i) => {
      const L = len(sub(c.B, c.A));
      const wEq = (2 * c.P) / Math.max(1, L / 12);
      const sized = headerForSpans([L], [wEq]);
      const id = `x${i + 1}`;
      headerLoad.set(id, { w: 0, P: c.P });
      if (!sized) {
        headerBeyond.push(id);
        engineeredBeyond = true;
      }
      const spec: BeamSpec = sized?.spec ?? { size: "3-ply LVL 1¾×18", kind: "lvl", plies: 3, thickIn: 5.25, depthIn: 18, stock: "LVL1.75x18" };
      headers.push({ id, x0: c.A.x, y0: c.A.y, x1: c.B.x, y1: c.B.y, lengthIn: L, spec, postAt: [0, L], spanIn: L, eqJoistSpanFt: sized?.eq ?? 0, maxSpanIn: sized?.maxSpanIn ?? 0, kingPost: true, wallEnd: false, cross: true });
    });
    if (pergola && pergolaBays > 1) {
      for (let k = 1; k < pergolaBays; k++) {
        const yk = y0 + ((y1 - y0) * k) / pergolaBays;
        pergolaMidYs.push(yk);
        const lengthIn = x1 - x0;
        const tribFt = (y1 - y0) / pergolaBays / 12;
        const eq = Math.round(((2 * tribFt * totalPsf) / 50) * 10) / 10;
        const pick = pickHeader(lengthIn, eq, tribFt * totalPsf, minSegs.get(`hm${k}`) ?? 1);
        const id = `hm${k}`;
        headerLoad.set(id, { w: tribFt * totalPsf, P: 0 });
        if (pick.maxSpanIn === 0) headerBeyond.push(id);
        const postAt: number[] = [0, lengthIn];
        for (let sgm = 1; sgm < pick.segments; sgm++) {
          const at = (lengthIn * sgm) / pick.segments;
          postAt.splice(postAt.length - 1, 0, at);
          extraPosts.push({ x: x0 + at, y: yk, edge: -1 });
        }
        extraPosts.push({ x: x0, y: yk, edge: -1 }, { x: x1, y: yk, edge: -1 });
        const spanIn = postAt.slice(1).reduce((m, v, i) => Math.max(m, v - postAt[i]), 0);
        headers.push({ id, x0, y0: yk, x1, y1: yk, lengthIn, spec: pick.spec, postAt, spanIn, eqJoistSpanFt: eq, maxSpanIn: pick.maxSpanIn, kingPost: false, wallEnd: false });
      }
    }
  };
  layHeaders();

  /**
   * What each post brings down, lb (2026-10-11 — it was the whole roof shared by the corner posts, so an added post never
   * lightened one): every header's load and its own weight split span by span to the posts at its ends, a king post's
   * point load by the lever rule between the two posts around it. A header end on the house gives its share to the wall.
   */
  const postLoads = (pts: ReadonlyArray<{ x: number; y: number }>): number[] => {
    const loads = pts.map(() => 0);
    const give = (q: V2, lb: number) => {
      let best = -1;
      let d = 1;
      pts.forEach((pt, i) => {
        const e = Math.hypot(pt.x - q.x, pt.y - q.y);
        if (e < d) {
          d = e;
          best = i;
        }
      });
      if (best >= 0) loads[best] += lb;
    };
    for (const h of headers) {
      const L = headerLoad.get(h.id) ?? { w: 0, P: 0 };
      const w = L.w + (WOOD_PCF * h.spec.thickIn * h.spec.depthIn) / 144;
      const ux = (h.x1 - h.x0) / Math.max(1, h.lengthIn);
      const uy = (h.y1 - h.y0) / Math.max(1, h.lengthIn);
      const at = (s0: number): V2 => ({ x: h.x0 + ux * s0, y: h.y0 + uy * s0 });
      for (let i = 0; i + 1 < h.postAt.length; i++) {
        const s0 = h.postAt[i];
        const s1 = h.postAt[i + 1];
        const lb = (w * (s1 - s0)) / 12;
        give(at(s0), lb / 2);
        give(at(s1), lb / 2);
        const m = h.lengthIn / 2;
        if (L.P > 0 && m >= s0 && m <= s1 && (m < s1 || i + 2 === h.postAt.length)) {
          const t = (m - s0) / Math.max(1, s1 - s0);
          give(at(s0), L.P * (1 - t));
          give(at(s1), L.P * t);
        }
      }
    }
    return loads;
  };
  // A footing reads up to POST_TABLE_MAX_AREA of deck at the deck's load: past that, more posts on that post's headers.
  if (design.floor !== "slab" && design.floor !== "existing") {
    const limitLb = POST_TABLE_MAX_AREA * (design.loadPsf + 10);
    for (let round = 0; round < 8; round++) {
      const pts = [...cornerPosts, ...extraPosts];
      const loads = postLoads(pts);
      let grew = false;
      pts.forEach((pt, i) => {
        if (loads[i] <= limitLb) return;
        for (const h of headers) {
          const ux = (h.x1 - h.x0) / Math.max(1, h.lengthIn);
          const uy = (h.y1 - h.y0) / Math.max(1, h.lengthIn);
          if (!h.postAt.some((s0) => Math.hypot(h.x0 + ux * s0 - pt.x, h.y0 + uy * s0 - pt.y) < 1)) continue;
          const segs = h.postAt.length - 1;
          if (segs >= 8 || (minSegs.get(h.id) ?? 1) > segs) continue;
          minSegs.set(h.id, segs + 1);
          grew = true;
        }
      });
      if (!grew) break;
      layHeaders();
    }
  }
  const ringHeaders = headers.filter((h) => !h.cross);
  const headerDepth = ringHeaders.length ? Math.max(...ringHeaders.map((h) => h.spec.depthIn)) : 9.25;
  const headerTopIn = headerBottomIn + headerDepth;
  for (const h of headers) headerTopOf.set(h.id, headerTopIn);

  // A free shed's back posts are taller: the back header sits up at the top of the slope.
  const shedRise = kind === "shed" && !wall ? (y1 - y0) * slope : 0;
  /** A header's top at a point along it: level, or riding up a free shed's slope. */
  const headerTopAt = (y: number) => headerTopIn + (kind === "shed" && !wall ? (y1 - Math.min(Math.max(y, y0), y1)) * slope : 0);
  /** The headers that bear on a point: the ones that end there, or run over it between their ends. */
  const headersAt = (x: number, y: number) =>
    headers.filter((h) => {
      // A cross beam hangs on the headers: a post under its end carries the header.
      if (h.cross) return false;
      if ((Math.abs(h.x0 - x) < 0.5 && Math.abs(h.y0 - y) < 0.5) || (Math.abs(h.x1 - x) < 0.5 && Math.abs(h.y1 - y) < 0.5)) return true;
      const L = h.lengthIn || 1;
      const t = ((x - h.x0) * (h.x1 - h.x0) + (y - h.y0) * (h.y1 - h.y0)) / (L * L);
      if (t <= 0 || t >= 1) return false;
      return Math.hypot(h.x0 + (h.x1 - h.x0) * t - x, h.y0 + (h.y1 - h.y0) * t - y) < 0.5;
    });
  /**
   * The underside of what a post carries: the headers' TOPS line up for the rafters, so the deepest header through the
   * post sets its top (a 2x8 gable-end header beside 2x12 eaves rides 4 in. higher; a post under it alone is taller).
   */
  const undersideAt = (x: number, y: number) => {
    const mine = headersAt(x, y);
    if (!mine.length) return headerBottomIn + (kind === "shed" && !wall && Math.abs(y - y0) < 0.01 ? shedRise : 0);
    return Math.min(...mine.map((h) => headerTopAt(y) - h.spec.depthIn));
  };

  // Posts left in a stair's opening: a ring corner the stair runs into, or one no header could be laid to clear.
  const postsInStair: RoofFrame["postsInStair"] = [];
  if (openings.length && deck) {
    const inOpening = (p: V2) =>
      openings.find((o) =>
        o.side === "front"
          ? Math.abs(p.y - deckD) <= 24 && p.x > o.fromIn - pw / 2 && p.x < o.toIn + pw / 2
          : o.side === "left"
            ? Math.abs(p.x) <= 24 && p.y > o.fromIn - pw / 2 && p.y < o.toIn + pw / 2
            : Math.abs(p.x - deckW) <= 24 && p.y > o.fromIn - pw / 2 && p.y < o.toIn + pw / 2,
      );
    for (const c of cornerPosts) {
      const o = inOpening(c);
      if (o) postsInStair.push({ x: c.x, y: c.y, side: o.side, corner: true });
    }
    for (const sp of stuckPosts) {
      const o = inOpening(sp);
      if (o) postsInStair.push({ x: sp.x, y: sp.y, side: o.side, corner: false });
    }
  }

  // All posts: corners and the ones the headers needed.
  const allPostPts: Array<{ x: number; y: number; corner: boolean }> = [...cornerPosts.map((p) => ({ x: p.x, y: p.y, corner: true })), ...extraPosts.map((p) => ({ x: p.x, y: p.y, corner: false }))];
  const groundAt = opts.groundAt ?? (() => 0);
  const designForFootings: DeckDesign = design.floor === "ground" ? { ...design, placement: wall ? "attached" : "detached" } : design;
  let postBeyond = false;
  let postSpliced = false;
  const finalLoads = postLoads(allPostPts);
  allPostPts.forEach((p, i) => {
    const topIn = undersideAt(p.x, p.y);
    const loadLb = Math.round(finalLoads[i]);
    const tributarySqFt = Math.round((loadLb / 50) * 10) / 10;
    const maxHeightIn = postMaxHeightIn(40, group, r.post, Math.min(160, tributarySqFt));
    if (r.eaveHeightIn > maxHeightIn) postBeyond = true;
    // The post's foot: a footing's top over the ground right there (a slab is level).
    const onSlab = design.floor === "slab" || design.floor === "existing";
    const zg = onSlab ? 0 : groundAt(p.x, p.y);
    const postBottomIn = design.floor === "deck" ? (deck ? deck.footingTopIn : 0) + zg : onSlab ? SLAB_TOP_IN : design.footing.aboveGradeIn + zg;
    const heightIn = topIn - postBottomIn;
    const spliced = heightIn > STOCK_MAX_IN;
    if (spliced) postSpliced = true;
    const footing = design.floor === "ground" ? footingFor(designForFootings, p.x, p.y, Math.round((loadLb / (design.loadPsf + 10)) * 10) / 10, r.post, design.footing.aboveGradeIn) : null;
    if (footing) footing.groundIn = zg;
    posts.push({ id: `rp${i + 1}`, x: p.x, y: p.y, size: r.post, bottomIn: postBottomIn, topIn, heightIn, loadLb, tributarySqFt, maxHeightIn, corner: p.corner, bearing: design.floor, footing, spliced });
    members.push({ role: "roof-post", nominal: r.post, lengthIn: heightIn, cx: p.x, cy: p.y, cz: postBottomIn + heightIn / 2, sx: pw, sy: pd, sz: heightIn, yaw: 0, tilt: 0, x0: p.x, y0: p.y, x1: p.x, y1: p.y, ground: design.floor !== "deck" });
  });

  // WHAT WAS SET BY HAND, AS BUILT (2026-11-13): each post the builder stood is marked as theirs, and each opening says
  // what the header over it came to — its span, its size, whether it took an engineered beam.
  const openingsBuilt: RoofFrame["openings"] = [];
  const pinsBuilt: RoofFrame["pins"] = [];
  for (const [k, e] of userEdges) {
    const A = ring[k];
    const B = ring[(k + postEvery) % n];
    const u = unit(sub(B, A));
    const pt = (t: number) => ({ x: A.x + u.x * t, y: A.y + u.y * t });
    const postNear = (q: V2) => posts.find((p) => Math.hypot(p.x - q.x, p.y - q.y) < 0.6);
    const h = headers.find((x) => x.id === `h${k + 1}`);
    for (const { p: pin, at } of e.pins) {
      const q = pt(at);
      const post = postNear(q);
      if (!post) continue;
      post.by = { kind: "pin", id: pin.id };
      pinsBuilt.push({ id: pin.id, side: pin.side, x: q.x, y: q.y });
    }
    for (const x of e.opens) {
      for (const t of [x.lo, x.hi]) {
        const post = postNear(pt(t));
        if (post && !post.corner && !post.by) post.by = { kind: "opening", id: x.o.id };
      }
      const c0 = pt(x.lo + pw0 / 2);
      const c1 = pt(x.hi - pw0 / 2);
      openingsBuilt.push({ id: x.o.id, side: x.o.side, x0: c0.x, y0: c0.y, x1: c1.x, y1: c1.y, widthIn: Math.round((x.hi - x.lo - pw0) * 4) / 4, leaves: 0, headerId: h?.id ?? "", spanIn: Math.round(x.hi - x.lo), size: h ? String(h.spec.size) : "", engineered: h?.spec.kind === "lvl", beyond: !!h && headerBeyond.includes(h.id), blocked: postsInOpenings.some((q) => q.k === k && q.at > x.lo + 0.5 && q.at < x.hi - 0.5), cornerJambs: x.cornerJambs });
    }
  }

  // Headers as lumber: post centre to post centre, plus half a post at each free end. Two headers meeting on a corner
  // post would both be drawn over it, their tops in one plane (they flickered, 2026-10-11): the one laid first runs
  // over the post, the other is drawn stopping against its inside face (the lumber bought is the same).
  const cornerTrim = headers.map((h, i) => {
    const hu = unit({ x: h.x1 - h.x0, y: h.y1 - h.y0 });
    const at = (P: V2) => {
      const g = headers.find((gg, k) => k < i && [{ x: gg.x0, y: gg.y0 }, { x: gg.x1, y: gg.y1 }].some((Q) => Math.hypot(Q.x - P.x, Q.y - P.y) < 0.5) && Math.abs(hu.x * (gg.y1 - gg.y0) - hu.y * (gg.x1 - gg.x0)) > 0.5 * Math.hypot(gg.x1 - gg.x0, gg.y1 - gg.y0));
      return g ? pw / 2 + g.spec.thickIn / 2 : 0;
    };
    return [at({ x: h.x0, y: h.y0 }), at({ x: h.x1, y: h.y1 })];
  });
  headers.forEach((h, hi) => {
    const u = unit({ x: h.x1 - h.x0, y: h.y1 - h.y0 });
    const yaw = Math.atan2(u.y, u.x);
    // A cross beam is drawn between the eave headers' inside faces.
    const ringThick = Math.max(0, ...ringHeaders.map((g) => g.spec.thickIn));
    const ext0 = h.cross ? -ringThick / 2 : h.wallEnd && Math.abs(h.y0 - y0) < 0.01 ? 0 : pw / 2;
    const ext1 = h.cross ? -ringThick / 2 : h.wallEnd && Math.abs(h.y1 - y0) < 0.01 ? 0 : pw / 2;
    const ax = h.x0 - u.x * ext0;
    const ay = h.y0 - u.y * ext0;
    const bx = h.x1 + u.x * ext1;
    const by = h.y1 + u.y * ext1;
    const L = Math.hypot(bx - ax, by - ay);
    // Drawn from here to there: the lumber's ends, less any corner it gives way at.
    const [t0, t1] = ext0 > 0 || ext1 > 0 ? cornerTrim[hi] : [0, 0];
    const dax = ax + u.x * (ext0 > 0 ? t0 : 0);
    const day = ay + u.y * (ext0 > 0 ? t0 : 0);
    const dbx = bx - u.x * (ext1 > 0 ? t1 : 0);
    const dby = by - u.y * (ext1 > 0 ? t1 : 0);
    const Ld = Math.hypot(dbx - dax, dby - day);
    const top = headerTopIn;
    // A free shed's back header rides up the slope; its side headers tilt.
    const zA = top + (kind === "shed" && !wall ? (y1 - Math.min(Math.max(day, y0), y1)) * slope : 0);
    const zB = top + (kind === "shed" && !wall ? (y1 - Math.min(Math.max(dby, y0), y1)) * slope : 0);
    const tilt = Math.atan2(zB - zA, Ld);
    const ply = h.spec.kind === "solid" ? h.spec.thickIn : THICK_2X_IN;
    for (let p = 0; p < h.spec.plies; p++) {
      const off = -h.spec.thickIn / 2 + (p + 0.5) * ply;
      // Plies are side by side across the header (toward the roof's inside).
      const nx = -u.y;
      const ny = u.x;
      members.push({ role: "header", nominal: h.spec.stock, lengthIn: L, cx: (dax + dbx) / 2 + nx * off, cy: (day + dby) / 2 + ny * off, cz: (zA + zB) / 2 - h.spec.depthIn / 2, sx: Ld / Math.cos(tilt), sy: ply, sz: h.spec.depthIn, yaw, tilt, x0: ax, y0: ay, x1: bx, y1: by, of: h.id });
    }
  });

  // ── Rafters on every face.
  const faces: RoofFace[] = [];
  const wallFlashing: WallFlash[] = [];
  let commons = 0;
  let jacks = 0;
  let flies = 0;
  let longest = 0;
  let eaveFt = 0;
  let rakeFt = 0;
  let wallFt = 0;
  let roofAreaSqFt = 0;
  let ceilingSqFt = 0;
  let soffitSqFt = 0;
  let hipTotal = 0;
  let hipCount = 0;
  // The hips designed as beams for the jacks they carry (designHip): from the first face with a hip corner, whose run
  // every hip of this roof shares; an n-sided ring's faces meet a hip at 180°/n, a rectangle's at 45°.
  const hipFace = faceSpecs.find((fs) => fs.tier === 1 && (fs.sideA === "hip" || fs.sideB === "hip"));
  const hipDesign = hipFace ? designHip(hipFace.vTopIn, hipFace.ovhIn, regular ? Math.PI / n : Math.PI / 4, rafterSize, rafterGroup, totalPsf, roofLoad >= 30, ceilingOn) : null;
  if (hipDesign?.kind === "lvl") engineered = true;
  const hipNominal = hipDesign ? hipDesign.stock : oneDeeper(rafterSize);
  const hipDepth = hipDesign ? hipDesign.depthIn : depthOf(hipNominal);
  const hipPlies = hipDesign ? hipDesign.plies : 1;
  const hipPly = hipDesign ? hipDesign.plyIn : THICK_2X_IN;
  const seenHips = new Set<string>();
  const subfasciaNominal = rafterDepth > 7.5 ? "2x8" : "2x6";
  const fasciaBoardIn = rafterDepth > 7.5 ? 10 : 8;

  /** The top of the rafters at horizontal distance v from the eave line, on a face whose header top is `hTop`, at a slope `sl`. */
  const zTopAt = (v: number, ovhIn: number, hTop: number, sl = slope) => hTop + heel + (v - ovhIn) * sl;
  let peakSeen = -Infinity;

  /** The rafters' places along a face's eave, from its start: `sp` apart, the last one at the far end. */
  // The end rafters an eighth in from the ring's ends: flush, their faces lay in the side headers' (and a roof ledger's
  // end) where the seat dips into the header, and the 3D flickered there (2026-10-11).
  const END_RAFTER_IN = 0.125;
  const faceLayout = (f: FaceSpec, sp: number): number[] => {
    const start = f.ringU0 + (f.sideA === "hip" ? sp : THICK_2X_IN / 2 + END_RAFTER_IN);
    const end = f.ringU1 - (f.sideB === "hip" ? 1 : THICK_2X_IN / 2 + END_RAFTER_IN);
    const out: number[] = [];
    for (let uu = start; uu <= end + 1e-6; uu += sp) out.push(uu);
    if (f.sideB !== "hip" && (out.length === 0 || end - out[out.length - 1] > 3)) out.push(end);
    return out;
  };
  const trussChordIn = trusses?.chord === "2x6" ? 5.5 : 3.5;
  const layFace = (f: FaceSpec, hTop: number, roleTag: string, positions?: number[]) => {
    const sl = f.slope ?? slope;
    const th = Math.atan(sl);
    const cT = Math.cos(th);
    const u = unit(sub(f.B, f.A));
    const Lu = len(sub(f.B, f.A));
    const at = (uu: number, vv: number): V2 => ({ x: f.A.x + u.x * uu + f.n.x * vv, y: f.A.y + u.y * uu + f.n.y * vv });
    const vMax = (uu: number) => Math.min(f.vTopIn, f.sideA === "hip" ? uu * Math.tan(f.betaA) : Infinity, f.sideB === "hip" ? (Lu - uu) * Math.tan(f.betaB) : Infinity);
    const yaw = Math.atan2(f.n.y, f.n.x);
    peakSeen = Math.max(peakSeen, zTopAt(f.vTopIn, f.ovhIn, hTop, sl));
    const rafterAt = (uu: number, role: RoofRole) => {
      const v1 = vMax(uu);
      if (!(v1 > 10)) return;
      // On a truss roof the commons are the trusses' top chords (bought as trusses); the rake's fly rafters stay 2x6.
      const chord = !!trusses && role !== "fly";
      const dpt = trusses ? (chord ? trussChordIn : 5.5) : rafterDepth;
      const p0 = at(uu, 0);
      const p1 = at(uu, v1);
      const z0 = zTopAt(0, f.ovhIn, hTop, sl) - dpt / 2 / cT;
      const z1 = zTopAt(v1, f.ovhIn, hTop, sl) - dpt / 2 / cT;
      const L = v1 / cT;
      members.push({ role: chord ? "truss" : role, nominal: chord ? `${trusses!.chord} top chord` : trusses ? "2x6" : rafterSize, lengthIn: L, cx: (p0.x + p1.x) / 2, cy: (p0.y + p1.y) / 2, cz: (z0 + z1) / 2, sx: L, sy: THICK_2X_IN, sz: dpt, yaw, tilt: th, x0: p0.x, y0: p0.y, x1: p1.x, y1: p1.y, of: chord ? "truss-tc" : f.id });
      longest = Math.max(longest, L);
      if (role === "fly") flies++;
      else if (chord) return;
      else if (v1 >= f.vTopIn - 0.5) commons++;
      else jacks++;
    };
    // The fly rafters at a rake overhang, then the layout from the header's start.
    if (f.sideA === "rake" && f.ringU0 > 2) rafterAt(THICK_2X_IN / 2, "fly");
    if (f.sideB === "rake" && Lu - f.ringU1 > 2) rafterAt(Lu - THICK_2X_IN / 2, "fly");
    const placed = positions ?? faceLayout(f, spacing);
    for (const uu of placed) rafterAt(uu, roleTag === "jack" ? "jack" : "rafter");

    // The face's corners and figures.
    const TA = at(cot(f.betaA) * f.vTopIn, f.vTopIn);
    const TB = at(Lu - cot(f.betaB) * f.vTopIn, f.vTopIn);
    const planArea = ringArea([f.A, f.B, TB, TA]);
    const area = planArea / cT / 144;
    roofAreaSqFt += area;
    const sideLen = (side: RoofFace["sideA"]) => (side === "rake" || side === "wall" ? f.vTopIn / cT : 0);
    const rake = (f.sideA === "rake" ? sideLen("rake") : 0) + (f.sideB === "rake" ? sideLen("rake") : 0);
    const wallLen = (f.sideA === "wall" ? sideLen("wall") : 0) + (f.sideB === "wall" ? sideLen("wall") : 0) + (f.top === "wall" ? len(sub(TB, TA)) : 0);
    eaveFt += Lu / 12;
    rakeFt += rake / 12;
    wallFt += wallLen / 12;
    // Ceiling and soffit areas.
    const A1 = at(cot(f.betaA) * f.ovhIn, f.ovhIn);
    const B1 = at(Lu - cot(f.betaB) * f.ovhIn, f.ovhIn);
    if (ceilingOn) ceilingSqFt += ringArea([A1, B1, TB, TA]) / cT / 144;
    if (r.soffit) soffitSqFt += ringArea([f.A, f.B, B1, A1]) / 144;
    faces.push({
      slope: sl,
      baseTopIn: hTop,
      id: f.id,
      ax: f.A.x,
      ay: f.A.y,
      bx: f.B.x,
      by: f.B.y,
      ux: u.x,
      uy: u.y,
      nx: f.n.x,
      ny: f.n.y,
      lengthIn: Lu,
      runIn: f.runIn,
      vTopIn: f.vTopIn,
      top: f.top,
      sideA: f.sideA,
      sideB: f.sideB,
      betaA: f.betaA,
      betaB: f.betaB,
      ovhIn: f.ovhIn,
      ringU0: f.ringU0,
      ringU1: f.ringU1,
      tax: TA.x,
      tay: TA.y,
      tbx: TB.x,
      tby: TB.y,
      areaSqFt: Math.round(area * 10) / 10,
      eaveFt: Lu / 12,
      rakeFt: rake / 12,
      wallFt: wallLen / 12,
      tier: f.tier,
    });

    // Planes: sheathing and roofing over the whole face, the ceiling under the rafters inside the header, the soffit under the overhang.
    const zt = (v: number) => zTopAt(v, f.ovhIn, hTop, sl);
    // FLASHING AT THE HOUSE (2026-11-07): every line where this face meets the wall, on the roofing's top — apron (L)
    // flashing along a level top edge (the roof falls away from it), step flashing up a sloped side from the eave, and a
    // kickout at that side's foot, out past the eave, turning the water into the gutter (IRC R903.2.1).
    if (wall && !pergola) {
      const zr = (v: number) => zt(v) + 0.9;
      const flash = (kind: WallFlash["kind"], P: V2, zP: number, Q: V2, zQ: number, o: V2) => {
        const L = Math.hypot(Q.x - P.x, Q.y - P.y, zQ - zP);
        if (L < 2) return;
        wallFlashing.push({ kind, x0: P.x, y0: P.y, z0: zP, x1: Q.x, y1: Q.y, z1: zQ, ox: o.x, oy: o.y, lengthIn: L, of: f.id });
      };
      if (f.top === "wall") flash("apron", TA, zr(f.vTopIn), TB, zr(f.vTopIn), { x: -f.n.x, y: -f.n.y });
      const sloped = (E: V2, T: V2, away: V2) => {
        flash("step", E, zr(0), T, zr(f.vTopIn), away);
        flash("kickout", E, zr(0), { x: E.x - f.n.x * 6, y: E.y - f.n.y * 6 }, zr(0), away);
      };
      if (f.sideA === "wall") sloped(f.A, TA, u);
      if (f.sideB === "wall") sloped(f.B, TB, { x: -u.x, y: -u.y });
    }
    const ring3 = (pts: Array<[V2, number]>) => pts.flatMap(([p, z]) => [p.x, p.y, z]);
    if (!pergola) {
      // The drip edge: sheathing and roofing run a touch past the eave
      // line (and past the fascia under it), the corners still on the
      // bisectors so neighbouring faces keep meeting exactly.
      const uE = unit(sub(f.B, f.A));
      const drip = 1.2;
      const dripA = { x: f.A.x - f.n.x * drip - uE.x * (f.sideA === "hip" ? drip * cot(f.betaA) : 0), y: f.A.y - f.n.y * drip - uE.y * (f.sideA === "hip" ? drip * cot(f.betaA) : 0) };
      const dripB = { x: f.B.x - f.n.x * drip + uE.x * (f.sideB === "hip" ? drip * cot(f.betaB) : 0), y: f.B.y - f.n.y * drip + uE.y * (f.sideB === "hip" ? drip * cot(f.betaB) : 0) };
      planes.push({ kind: "sheathing", ring: ring3([[dripA, zt(-drip) + 0.25], [dripB, zt(-drip) + 0.25], [TB, zt(f.vTopIn) + 0.25], [TA, zt(f.vTopIn) + 0.25]]), of: f.id });
      planes.push({ kind: "roofing", ring: ring3([[dripA, zt(-drip) + 0.9], [dripB, zt(-drip) + 0.9], [TB, zt(f.vTopIn) + 0.9], [TA, zt(f.vTopIn) + 0.9]]), of: f.id });
      // The drip-edge flashing: a short vertical band off the roof's
      // edge, over the fascia's top — the clean dark line a finished
      // eave actually shows.
      planes.push({ kind: "roofing", ring: ring3([[dripA, zt(-drip) + 0.9], [dripB, zt(-drip) + 0.9], [dripB, zt(-drip) - 1.6], [dripA, zt(-drip) - 1.6]]), of: f.id });
      if (ceilingOn) {
        const under = rafterDepth / cT + 0.75;
        planes.push({ kind: "ceiling", ring: ring3([[A1, zt(f.ovhIn) - under], [B1, zt(f.ovhIn) - under], [TB, zt(f.vTopIn) - under], [TA, zt(f.vTopIn) - under]]), of: f.id });
      }
      if (r.soffit && f.ovhIn > 2) {
        const zs = zt(0) - rafterDepth / cT - 0.75;
        planes.push({ kind: "soffit", ring: ring3([[f.A, zs], [f.B, zs], [B1, zs], [A1, zs]]), of: f.id });
      }
    }

    // Hips at hip corners, once each (the corner is shared by two faces).
    const hipAt = (E: V2, T: V2) => {
      const key = `${Math.round(E.x)},${Math.round(E.y)}`;
      if (seenHips.has(key)) return;
      seenHips.add(key);
      const hz = len(sub(T, E));
      const rise = f.vTopIn * sl;
      const L = Math.hypot(hz, rise);
      const tiltH = Math.atan2(rise, hz);
      const z0 = zTopAt(0, f.ovhIn, hTop, sl) - hipDepth / 2 / Math.cos(tiltH);
      const z1 = zTopAt(f.vTopIn, f.ovhIn, hTop, sl) - hipDepth / 2 / Math.cos(tiltH);
      // A built-up or LVL hip: its plies side by side, each its own piece.
      const hu = unit(sub(T, E));
      for (let pl = 0; pl < hipPlies; pl++) {
        const off = -(hipPlies * hipPly) / 2 + (pl + 0.5) * hipPly;
        members.push({ role: "hip", nominal: hipNominal, lengthIn: L, cx: (E.x + T.x) / 2 - hu.y * off, cy: (E.y + T.y) / 2 + hu.x * off, cz: (z0 + z1) / 2, sx: L, sy: hipPly, sz: hipDepth, yaw: Math.atan2(T.y - E.y, T.x - E.x), tilt: tiltH, x0: E.x, y0: E.y, x1: T.x, y1: T.y, of: f.id });
      }
      hipTotal += L;
      hipCount++;
    };
    if (f.sideA === "hip") hipAt(f.A, TA);
    if (f.sideB === "hip") hipAt(f.B, TB);

    // Fascia: the sub-fascia across the rafter tails, the finish board over it; rakes on the fly rafters.
    const outward = { x: -f.n.x, y: -f.n.y };
    const zEave = zTopAt(0, f.ovhIn, hTop, sl) - rafterDepth / cT / 2;
    if (r.fascia.eave && f.ovhIn > 0) {
      // Tucked UNDER the eave: the sub-fascia's outer face lands flush on
      // the eave line and the 1x sits over it, so the roof's drip edge
      // (below) covers both. They used to hang OUTSIDE the roof edge and
      // read from above as teeth at every corner.
      const off = -(THICK_2X_IN / 2 + 0.05); // the 0.05 keeps it off the fly rafters' plane
      // Where this eave meets its neighbours, the boards are SAWN on the
      // corners' bisectors — βA/βB are the plan half-angles, and the sign
      // follows which way the board's width axis points against the
      // eave's outward normal. Square ends shoved past each other drew
      // as spikes at every hip and polygon corner.
      const vSide = Math.sign(-u.y * outward.x + u.x * outward.y) || 1;
      const mitA = f.sideA === "hip" ? -(1 / Math.tan(f.betaA)) * vSide : 0;
      const mitB = f.sideB === "hip" ? (1 / Math.tan(f.betaB)) * vSide : 0;
      const yawE = Math.atan2(u.y, u.x);
      // A hip end runs long to its mitre; a rake end DIES INTO the rake
      // boards — pulled back clear of the fly rafter's plane, as built.
      const endA = f.sideA === "hip" ? off * Math.abs(mitA) : -2.4;
      const endB = f.sideB === "hip" ? off * Math.abs(mitB) : -2.4;
      const place = (o: number, eA: number, eB: number) => ({
        cx: (f.A.x + f.B.x) / 2 + outward.x * o + u.x * ((eB - eA) / 2),
        cy: (f.A.y + f.B.y) / 2 + outward.y * o + u.y * ((eB - eA) / 2),
        sx: Lu + eA + eB,
      });
      const pS = place(off, endA, endB);
      members.push({ role: "subfascia", nominal: subfasciaNominal, lengthIn: pS.sx, mA: mitA, mB: mitB, cx: pS.cx, cy: pS.cy, cz: zEave, sx: pS.sx, sy: THICK_2X_IN, sz: depthOf(subfasciaNominal), yaw: yawE, tilt: 0, x0: f.A.x, y0: f.A.y, x1: f.B.x, y1: f.B.y, of: f.id });
      const offF = 0.75 / 2;
      const fA = f.sideA === "hip" ? offF * Math.abs(mitA) : -2.4;
      const fB = f.sideB === "hip" ? offF * Math.abs(mitB) : -2.4;
      const pF = place(offF, fA, fB);
      members.push({ role: "fascia-eave", nominal: `1x${fasciaBoardIn}`, lengthIn: Lu, mA: mitA, mB: mitB, cx: pF.cx, cy: pF.cy, cz: zEave - 0.5, sx: pF.sx, sy: 0.75, sz: fasciaBoardIn - 0.75, yaw: yawE, tilt: 0, x0: f.A.x, y0: f.A.y, x1: f.B.x, y1: f.B.y, of: f.id });
    }
    if (r.fascia.rake) {
      const rakeAt = (P: V2, T: V2, side: 1 | -1) => {
        const L = f.vTopIn / cT;
        const off = { x: u.x * side * (THICK_2X_IN / 2 + 0.4), y: u.y * side * (THICK_2X_IN / 2 + 0.4) };
        members.push({ role: "fascia-rake", nominal: `1x${fasciaBoardIn}`, lengthIn: L, cx: (P.x + T.x) / 2 + off.x, cy: (P.y + T.y) / 2 + off.y, cz: (zEave + zTopAt(f.vTopIn, f.ovhIn, hTop, sl) - rafterDepth / cT / 2) / 2 - 0.5, sx: L, sy: 0.75, sz: fasciaBoardIn - 0.75, yaw, tilt: th, x0: P.x, y0: P.y, x1: T.x, y1: T.y, of: f.id });
      };
      if (f.sideA === "rake") rakeAt(f.A, TA, -1);
      if (f.sideB === "rake") rakeAt(f.B, TB, 1);
    }

    // Gutters along this eave (not along a gambrel's break or a gablet's cap).
    if (r.gutters.kind !== "none" && f.ovhIn > 0) {
      const gw = r.gutters.kind === "k6" ? 6 : 5;
      const off = THICK_2X_IN + 0.75 + gw / 2 + 0.25;
      members.push({ role: "gutter", nominal: r.gutters.kind, lengthIn: Lu, cx: (f.A.x + f.B.x) / 2 + outward.x * off, cy: (f.A.y + f.B.y) / 2 + outward.y * off, cz: zEave + rafterDepth / 2 - 2.5, sx: Lu + 1, sy: gw, sz: 4, yaw: Math.atan2(u.y, u.x), tilt: 0, x0: f.A.x, y0: f.A.y, x1: f.B.x, y1: f.B.y, of: f.id });
    }
  };

  // Upper faces of a gambrel or a Dutch gable spring from where the lower face stops.
  for (const f of faceSpecs.filter((f) => f.tier === 1)) {
    if (f.ovhIn === 0 && (kind === "gambrel" || kind === "dutch-gable")) {
      const lowerId = f.id.replace(/2$/, "1");
      const lower = faceSpecs.find((g) => g.id === lowerId);
      if (lower) f.baseTopIn = zTopAt(lower.vTopIn, lower.ovhIn, headerTopIn, lower.slope ?? slope) - heel;
    }
  }
  // A gable's two faces share one layout read from the same end, so every rafter meets its partner at the ridge (IRC
  // R802.3: opposite each other, or within 1½ in.) and every truss is one piece across (2026-10-11).
  const tier1 = faceSpecs.filter((f) => f.tier === 1);
  const gablePair = kind === "gable" && tier1.length === 2;
  const firstFace = tier1[0];
  const shared: V2[] = gablePair
    ? (() => {
        const u0 = unit(sub(firstFace.B, firstFace.A));
        return faceLayout(firstFace, trusses ? TRUSS_SPACING_IN : spacing).map((uu) => ({ x: firstFace.A.x + u0.x * uu, y: firstFace.A.y + u0.y * uu }));
      })()
    : [];
  for (const f of tier1) {
    const u = unit(sub(f.B, f.A));
    const positions = gablePair ? shared.map((P) => (P.x - f.A.x) * u.x + (P.y - f.A.y) * u.y).sort((m1, m2) => m1 - m2) : undefined;
    layFace(f, f.baseTopIn ?? headerTopIn, (f.top === "cap" || f.sideA === "hip") && kind !== "gambrel" ? "jack" : "rafter", positions);
  }
  // The trusses' bottom chords on the headers and their webs (a Fink, the W): from the bottom chord's third points up to
  // the top chords' quarter points and to the peak.
  if (trusses && gablePair && ridgeFrom && ridgeTo) {
    const T = trusses;
    const alongX = Math.abs(ridgeTo.x - ridgeFrom.x) >= Math.abs(ridgeTo.y - ridgeFrom.y);
    const a0 = alongX ? y0 : x0;
    const a1 = alongX ? y1 : x1;
    const e0 = alongX ? eaveY0 : eaveX0;
    const e1 = alongX ? eaveY1 : eaveX1;
    const peakC = (e0 + e1) / 2;
    const cT1 = Math.cos(Math.atan(slope));
    const zc = (c: number) => zTopAt(Math.min(c - e0, e1 - c), firstFace.ovhIn, headerTopIn) - trussChordIn / 2 / cT1;
    const zb = headerTopIn + trussChordIn / 2;
    const span = a1 - a0;
    const piece = (A: { x: number; y: number; z: number }, B: { x: number; y: number; z: number }, d: number, what: "bottom chord" | "web") => {
      const dx = B.x - A.x;
      const dy = B.y - A.y;
      const dz = B.z - A.z;
      const h = Math.hypot(dx, dy);
      const L = Math.hypot(h, dz);
      members.push({ role: "truss", nominal: what === "web" ? "2x4 web" : `${T.chord} bottom chord`, lengthIn: L, cx: (A.x + B.x) / 2, cy: (A.y + B.y) / 2, cz: (A.z + B.z) / 2, sx: L, sy: THICK_2X_IN, sz: d, yaw: h > 1e-6 ? Math.atan2(dy, dx) : 0, tilt: Math.atan2(dz, h), x0: A.x, y0: A.y, x1: B.x, y1: B.y, of: what === "web" ? "truss-web" : "truss-bc" });
    };
    for (const P of shared) {
      const s0 = alongX ? P.x : P.y;
      const pt = (c: number, z: number) => (alongX ? { x: s0, y: c, z } : { x: c, y: s0, z });
      piece(pt(a0 - 1.75, zb), pt(a1 + 1.75, zb), trussChordIn, "bottom chord");
      const b1 = a0 + span / 3;
      const b2 = a0 + (2 * span) / 3;
      const t1 = a0 + span / 4;
      const t2 = a0 + (3 * span) / 4;
      piece(pt(b1, zb), pt(t1, zc(t1)), 3.5, "web");
      piece(pt(b1, zb), pt(peakC, zc(peakC)), 3.5, "web");
      piece(pt(b2, zb), pt(peakC, zc(peakC)), 3.5, "web");
      piece(pt(b2, zb), pt(t2, zc(t2)), 3.5, "web");
    }
    T.count = shared.length;
    T.gableEnds = Math.min(2, shared.length);
  }
  // A gambrel's ties at the break: one 2x6 across at every rafter, the pair gusseted.
  if (gambrel && kind === "gambrel") {
    const lowerFace = faceSpecs.find((f) => f.id.endsWith("1"))!;
    const zBreak = zTopAt(lowerFace.vTopIn, lowerFace.ovhIn, headerTopIn, gambrel.slopeLo);
    const across = (gambrel.alongY ? eaveX1 - eaveX0 : eaveY1 - eaveY0) - 2 * gambrel.vBreak;
    const along = gambrel.alongY ? y1 - y0 : x1 - x0;
    const count = Math.floor(along / spacing) + 1;
    for (let k = 0; k < count; k++) {
      const t = count === 1 ? 0.5 : k / (count - 1);
      const P = gambrel.alongY ? { x: (eaveX0 + eaveX1) / 2, y: y0 + 2 + (along - 4) * t } : { x: x0 + 2 + (along - 4) * t, y: (eaveY0 + eaveY1) / 2 };
      members.push({ role: "tie", nominal: "2x6", lengthIn: across, cx: P.x, cy: P.y, cz: zBreak - rafterDepth / Math.cos(Math.atan(gambrel.slopeLo)) - 2.75, sx: across, sy: THICK_2X_IN, sz: 5.5, yaw: gambrel.alongY ? 0 : halfPi, tilt: 0, x0: P.x, y0: P.y, x1: P.x, y1: P.y });
      breakTies++;
    }
  }
  // A Dutch gable's gablets: a cap beam where the hips stop, studs at 16 in., a sheathed triangle to the ridge.
  if (dutch && kind === "dutch-gable") {
    for (const f of faceSpecs.filter((g) => g.top === "cap" && (g.id === "hl" || g.id === "hr" || g.id === "hb" || g.id === "hf"))) {
      const u = unit(sub(f.B, f.A));
      const TA = { x: f.A.x + u.x * f.vTopIn + f.n.x * f.vTopIn, y: f.A.y + u.y * f.vTopIn + f.n.y * f.vTopIn };
      const TB = { x: f.B.x - u.x * f.vTopIn + f.n.x * f.vTopIn, y: f.B.y - u.y * f.vTopIn + f.n.y * f.vTopIn };
      const zCap = zTopAt(f.vTopIn, f.ovhIn, headerTopIn);
      const L = len(sub(TB, TA));
      const yawCap = Math.atan2(TB.y - TA.y, TB.x - TA.x);
      members.push({ role: "ring", nominal: "2x6", lengthIn: L, cx: (TA.x + TB.x) / 2, cy: (TA.y + TB.y) / 2, cz: zCap - rafterDepth - 2.75, sx: L, sy: THICK_2X_IN, sz: 5.5, yaw: yawCap, tilt: 0, x0: TA.x, y0: TA.y, x1: TB.x, y1: TB.y, of: f.id });
      const ridgeEnd = ridgeFrom && ridgeTo ? (len(sub(ridgeFrom, { x: (TA.x + TB.x) / 2, y: (TA.y + TB.y) / 2 })) < len(sub(ridgeTo, { x: (TA.x + TB.x) / 2, y: (TA.y + TB.y) / 2 })) ? ridgeFrom : ridgeTo) : { x: (TA.x + TB.x) / 2, y: (TA.y + TB.y) / 2 };
      const zRidge = peakSeen;
      planes.push({ kind: "wall", ring: [TA.x, TA.y, zCap - rafterDepth, TB.x, TB.y, zCap - rafterDepth, ridgeEnd.x, ridgeEnd.y, zRidge - 1], of: f.id });
      const studs = Math.max(1, Math.floor(L / 16) - 1);
      for (let k = 1; k <= studs; k++) {
        const t = k / (studs + 1);
        const P = { x: TA.x + (TB.x - TA.x) * t, y: TA.y + (TB.y - TA.y) * t };
        const h = Math.max(6, (zRidge - 1 - (zCap - rafterDepth)) * (1 - Math.abs(2 * t - 1)));
        members.push({ role: "stud", nominal: "2x4", lengthIn: h, cx: P.x, cy: P.y, cz: zCap - rafterDepth + h / 2, sx: THICK_2X_IN, sy: 3.5, sz: h, yaw: yawCap, tilt: 0, x0: P.x, y0: P.y, x1: P.x, y1: P.y, of: f.id });
      }
    }
  }

  // The second tier: a band of short posts on a ring beam at the lower tier's cap, and a small pyramid over it.
  if (tier2 && apex) {
    const lower = faceSpecs.find((f) => f.tier === 1)!;
    const capZ = zTopAt(lower.vTopIn, lower.ovhIn, headerTopIn);
    const ringTop = capZ - rafterDepth / cosT + 0.5;
    const ringDepth = 7.25;
    // The ring beam where the lower tier stops (a 2x8 between the hips' tops).
    for (let k = 0; k < tier2.ring.length; k++) {
      const A = tier2.ring[k];
      const B = tier2.ring[(k + 1) % tier2.ring.length];
      const L = len(sub(B, A));
      members.push({ role: "ring", nominal: "2x8", lengthIn: L, cx: (A.x + B.x) / 2, cy: (A.y + B.y) / 2, cz: ringTop - ringDepth / 2, sx: L, sy: THICK_2X_IN, sz: ringDepth, yaw: Math.atan2(B.y - A.y, B.x - A.x), tilt: 0, x0: A.x, y0: A.y, x1: B.x, y1: B.y, of: "tier" });
      members.push({ role: "tier-post", nominal: "4x4", lengthIn: TIER_BAND_IN, cx: A.x, cy: A.y, cz: ringTop + TIER_BAND_IN / 2, sx: 3.5, sy: 3.5, sz: TIER_BAND_IN, yaw: 0, tilt: 0, x0: A.x, y0: A.y, x1: A.x, y1: A.y, of: "tier" });
    }
    const upperHeaderTop = ringTop + TIER_BAND_IN + 7.25;
    for (let k = 0; k < tier2.ring.length; k++) {
      const A = tier2.ring[k];
      const B = tier2.ring[(k + 1) % tier2.ring.length];
      const L = len(sub(B, A));
      members.push({ role: "header", nominal: "2x8", lengthIn: L, cx: (A.x + B.x) / 2, cy: (A.y + B.y) / 2, cz: upperHeaderTop - ringDepth / 2, sx: L, sy: THICK_2X_IN, sz: ringDepth, yaw: Math.atan2(B.y - A.y, B.x - A.x), tilt: 0, x0: A.x, y0: A.y, x1: B.x, y1: B.y, of: "tier" });
    }
    const m = tier2.ring.length;
    const cc = centroid(tier2.ring);
    const a2 = tier2.apothemIn;
    const o2 = tier2.ovhIn;
    const scale = (a2 + o2) / a2;
    const outer = tier2.ring.map((p) => ({ x: cc.x + (p.x - cc.x) * scale, y: cc.y + (p.y - cc.y) * scale }));
    const beta = halfPi - Math.PI / m;
    for (let k = 0; k < m; k++) {
      const A = outer[k];
      const B = outer[(k + 1) % m];
      const mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
      const nrm = unit(sub(cc, mid));
      const Lu = len(sub(B, A));
      const spec = rectFace(`u${k}`, A, B, nrm, a2 + o2, "apex", "hip", "hip", o2 * cot(beta), Lu - o2 * cot(beta), o2, a2 + o2, 2);
      spec.betaA = beta;
      spec.betaB = beta;
      faceSpecs.push(spec);
      layFace(spec, upperHeaderTop, "jack");
    }
    tier2.baseTopIn = upperHeaderTop;
  }

  // ── The ridge, king posts and ties.
  const archRiseIn = arched ? Math.min(ARCH_RISE_MAX_IN, Math.round(((eaveY1 - eaveY0) / Math.max(1, pergolaBays)) * ARCH_RISE_SHARE)) : 0;
  const peakIn = (() => {
    if (pergola) return headerTopIn + rafterDepth + archRiseIn + (louvered ? LOUVER_BLADE_IN : r.slats.size === "2x6" ? 5.5 : r.slats.size === "2x4" ? 3.5 : 1.5);
    return peakSeen > -Infinity ? peakSeen : headerTopIn;
  })();
  if (ridge && ridgeFrom && ridgeTo) {
    const depth = ridge.spec ? ridge.spec.depthIn : depthOf(ridge.nominal);
    const thick = ridge.spec ? ridge.spec.thickIn : THICK_2X_IN;
    const yaw = Math.atan2(ridgeTo.y - ridgeFrom.y, ridgeTo.x - ridgeFrom.x);
    const plies = ridge.spec ? ridge.spec.plies : 1;
    const ply = ridge.spec && ridge.spec.kind === "solid" ? thick : THICK_2X_IN;
    const nx = -Math.sin(yaw);
    const ny = Math.cos(yaw);
    // Drawn to a fly rafter's inner face where the rake has one (run on to the fly's outer face, the ridge's end lay in
    // its plane and flickered, 2026-10-11); the length bought is the whole run.
    const flyAt = (P: V2) => members.some((m) => m.role === "fly" && m.x1 !== undefined && m.y1 !== undefined && Math.hypot(m.x1 - P.x, m.y1 - P.y) < THICK_2X_IN);
    const rdir = unit(sub(ridgeTo, ridgeFrom));
    const dFrom = flyAt(ridgeFrom) ? THICK_2X_IN : 0;
    const dTo = flyAt(ridgeTo) ? THICK_2X_IN : 0;
    const drawnLen = Math.max(1, ridge.lengthIn - dFrom - dTo);
    const rmx = (ridgeFrom.x + ridgeTo.x) / 2 + (rdir.x * (dFrom - dTo)) / 2;
    const rmy = (ridgeFrom.y + ridgeTo.y) / 2 + (rdir.y * (dFrom - dTo)) / 2;
    for (let p = 0; ridge.lengthIn >= 1 && p < plies; p++) {
      const off = -thick / 2 + (p + 0.5) * ply;
      members.push({ role: "ridge", nominal: ridge.spec ? ridge.spec.stock : ridge.nominal, lengthIn: ridge.lengthIn, cx: rmx + nx * off, cy: rmy + ny * off, cz: peakIn - depth / 2, sx: drawnLen, sy: ply, sz: depth, yaw, tilt: 0, x0: ridgeFrom.x, y0: ridgeFrom.y, x1: ridgeTo.x, y1: ridgeTo.y });
    }
    if (kingPosts > 0) {
      const kingAt = (P: V2) => {
        const h = Math.max(6, peakIn - depth - headerTopIn);
        members.push({ role: "king", nominal: "4x4", lengthIn: h, cx: P.x, cy: P.y, cz: headerTopIn + h / 2, sx: 3.5, sy: 3.5, sz: h, yaw: 0, tilt: 0, x0: P.x, y0: P.y, x1: P.x, y1: P.y });
      };
      // On the ring's ends of the ridge (the rake overhang cantilevers past them).
      const ux = Math.cos(yaw);
      const uy = Math.sin(yaw);
      const inset = (P: V2, dir: 1 | -1) => ({ x: P.x + ux * dir * ovh, y: P.y + uy * dir * ovh });
      if (ridgeSupports === "king-king") {
        kingAt(inset(ridgeFrom, 1));
        kingAt(inset(ridgeTo, -1));
      } else if (ridgeSupports === "wall-king") kingAt(inset(ridgeTo, -1));
      // One on each cross beam, right under the ridge (2026-10-12).
      for (const cb of crossPlan) kingAt({ x: (cb.A.x + cb.B.x) / 2, y: (cb.A.y + cb.B.y) / 2 });
    }
    if (ties > 0) {
      const across = Math.abs(Math.sin(yaw)) > 0.5 ? x1 - x0 : y1 - y0;
      const tieYaw = yaw + halfPi;
      for (let k = 0; k < ties; k++) {
        const t = ties === 1 ? 0.5 : k / (ties - 1);
        const P = { x: ridgeFrom.x + (ridgeTo.x - ridgeFrom.x) * t, y: ridgeFrom.y + (ridgeTo.y - ridgeFrom.y) * t };
        const px = Math.min(Math.max(P.x, x0 + 2), x1 - 2);
        const py = Math.min(Math.max(P.y, y0 + 2), y1 - 2);
        // It rests on the headers, side-nailed to the rafters, and stays under them: each end tucks in to where the
        // rafter's underside clears a 2x6 (a tie run to the header's centre poked up through the roof at the eaves).
        const tuck = Math.min(across / 4, (5.5 - heel) / Math.max(slope, 0.08) + 2.5);
        const run = across - 2 * tuck;
        members.push({ role: "tie", nominal: "2x6", lengthIn: Math.round(run), cx: Math.abs(Math.sin(yaw)) > 0.5 ? (x0 + x1) / 2 : px, cy: Math.abs(Math.sin(yaw)) > 0.5 ? py : (y0 + y1) / 2, cz: headerTopIn + 2.75, sx: run, sy: THICK_2X_IN, sz: 5.5, yaw: tieYaw, tilt: 0, x0: px, y0: py, x1: px, y1: py });
      }
    }
  }

  // A FREE HIP'S END TIES (2026-10-12): the common from each end header's middle up to the ridge's end pushes that header
  // out; a 2x6 runs under it from there back to the first rafter tie, side-nailed to the common like any rafter tie.
  if (hipEndTies > 0 && ridgeFrom && ridgeTo) {
    const alongXr = Math.abs(ridgeTo.x - ridgeFrom.x) >= Math.abs(ridgeTo.y - ridgeFrom.y);
    const ends: Array<[V2, V2]> = alongXr
      ? [[{ x: x0, y: ridgeFrom.y }, ridgeFrom], [{ x: x1, y: ridgeTo.y }, ridgeTo]]
      : [[{ x: ridgeFrom.x, y: y0 }, ridgeFrom], [{ x: ridgeTo.x, y: y1 }, ridgeTo]];
    for (const [E, Rn] of ends) {
      const full = len(sub(Rn, E));
      const dir = unit(sub(Rn, E));
      const tuck = Math.min(full / 3, (5.5 - heel) / Math.max(slope, 0.08) + 2.5);
      const S = { x: E.x + dir.x * tuck, y: E.y + dir.y * tuck };
      const T = { x: Rn.x - dir.x * (THICK_2X_IN / 2), y: Rn.y - dir.y * (THICK_2X_IN / 2) };
      const L = len(sub(T, S));
      if (L < 12) continue;
      members.push({ role: "tie", nominal: "2x6", lengthIn: Math.round(L), cx: (S.x + T.x) / 2, cy: (S.y + T.y) / 2, cz: headerTopIn + 2.75, sx: L, sy: THICK_2X_IN, sz: 5.5, yaw: Math.atan2(dir.y, dir.x), tilt: 0, x0: S.x, y0: S.y, x1: T.x, y1: T.y });
    }
  }

  // The ledger on the house, for a shed or an attached hip.
  let ledger: RoofFrame["ledger"] = null;
  if (wall && (kind === "shed" || (kind === "hip" && !deepWallHip))) {
    const nominal = oneDeeper(rafterSize);
    const ld = depthOf(nominal);
    const top1 = faceSpecs.find((f) => f.id === "s" || f.id === "hf")!;
    const zTop = zTopAt(top1.vTopIn, top1.ovhIn, headerTopIn);
    // An attached hip whose hips meet at (or near) one point on the wall still bears their tops on a ledger block: 2 ft at
    // least, centred on that point (2026-10-22 — it came out 0 in. long when the cover was exactly twice as wide as deep).
    const mid = kind === "shed" ? 0 : (ridgeFrom!.x + ridgeTo!.x) / 2;
    const lx0 = kind === "shed" ? x0 : Math.min(ridgeFrom!.x, mid - 12);
    const lx1 = kind === "shed" ? x1 : Math.max(ridgeTo!.x, mid + 12);
    const L = lx1 - lx0;
    const fasteners = Math.max(4, Math.ceil(L / LEDGER_SCREW_SPACING_IN) * 2);
    ledger = { lengthIn: L, nominal, fasteners, zIn: zTop };
    members.push({ role: "roof-ledger", nominal, lengthIn: L, cx: (lx0 + lx1) / 2, cy: THICK_2X_IN / 2, cz: zTop - ld / 2, sx: L, sy: THICK_2X_IN, sz: ld, yaw: 0, tilt: 0, x0: lx0, y0: 0, x1: lx1, y1: 0 });
  }

  // Pergola: rafters across the ring, slats on top.
  let slats: RoofFrame["slats"] = null;
  if (pergola) {
    const yawR = halfPi;
    const L = eaveY1 - eaveY0;
    const zR = headerTopIn + rafterDepth / 2;
    const placed: number[] = [];
    // The end rafters an eighth in, as on the other roofs (flush, they lay in the roof ledger's ends and flickered).
    const pe = THICK_2X_IN / 2 + END_RAFTER_IN;
    for (let x = x0 + pe; x <= x1 - pe + 1e-6; x += spacing) placed.push(x);
    if (x1 - pe - placed[placed.length - 1] > 3) placed.push(x1 - pe);
    // One piece front to back when it comes out of stock; otherwise cut over the header rows.
    const cuts: Array<[number, number]> = L <= STOCK_MAX_IN ? [[eaveY0, eaveY1]] : [eaveY0, ...pergolaMidYs, eaveY1].slice(0, -1).map((a, i, arr) => [a, i + 1 < arr.length ? arr[i + 1] : eaveY1] as [number, number]);
    /** An arched rafter's top at `y` within its bay: a shallow arc rising archRiseIn at the middle. */
    const archTop = (ya: number, yb: number, y: number) => {
      if (!arched) return headerTopIn + rafterDepth;
      const t = (y - ya) / Math.max(1, yb - ya);
      return headerTopIn + rafterDepth + archRiseIn * 4 * t * (1 - t);
    };
    for (const x of placed) {
      for (const [ya, yb] of cuts) {
        const len = yb - ya;
        if (arched) {
          // Five straight pieces follow the arc; the rafter is cut from 2x12 stock.
          const segs = 5;
          for (let k = 0; k < segs; k++) {
            const y0s = ya + (len * k) / segs;
            const y1s = ya + (len * (k + 1)) / segs;
            const z0s = archTop(ya, yb, y0s) - rafterDepth / 2;
            const z1s = archTop(ya, yb, y1s) - rafterDepth / 2;
            const L = Math.hypot(y1s - y0s, z1s - z0s);
            members.push({ role: "rafter", nominal: "2x12 (arch cut)", lengthIn: L, cx: x, cy: (y0s + y1s) / 2, cz: (z0s + z1s) / 2, sx: L, sy: THICK_2X_IN, sz: rafterDepth, yaw: yawR, tilt: Math.atan2(z1s - z0s, y1s - y0s), x0: x, y0: y0s, x1: x, y1: y1s, of: "arch" });
          }
          longest = Math.max(longest, len);
        } else {
          members.push({ role: "rafter", nominal: rafterSize, lengthIn: len, cx: x, cy: (ya + yb) / 2, cz: zR, sx: len, sy: THICK_2X_IN, sz: rafterDepth, yaw: yawR, tilt: 0, x0: x, y0: ya, x1: x, y1: yb });
          longest = Math.max(longest, len);
        }
      }
      commons++;
    }
    if (wall) {
      // On the house: a ledger one size deeper than the rafters, the rafters hung on it.
      const nominal = oneDeeper(rafterSize);
      const ld = depthOf(nominal);
      const Lw = x1 - x0;
      const fasteners = Math.max(4, Math.ceil(Lw / LEDGER_SCREW_SPACING_IN) * 2);
      ledger = { lengthIn: Lw, nominal, fasteners, zIn: headerTopIn + rafterDepth };
      members.push({ role: "roof-ledger", nominal, lengthIn: Lw, cx: (x0 + x1) / 2, cy: THICK_2X_IN / 2, cz: headerTopIn + rafterDepth - ld / 2, sx: Lw, sy: THICK_2X_IN, sz: ld, yaw: 0, tilt: 0, x0, y0: 0, x1, y1: 0 });
    }
    const sd = r.slats.size === "2x6" ? 5.5 : r.slats.size === "2x4" ? 3.5 : 1.5;
    const sw = 1.5;
    const Ls = eaveX1 - eaveX0;
    let count = 0;
    let total = 0;
    if (louvered) {
      // Louver blades at 45°, one every 6 in., as thin planes the 3D tilts.
      const half = LOUVER_BLADE_IN / 2;
      const tiltDz = half * Math.SQRT1_2;
      const tiltDy = half * Math.SQRT1_2;
      for (let y = eaveY0 + 3; y <= eaveY1 - 3 + 1e-6; y += LOUVER_PITCH_IN) {
        const bayStart = cuts.find(([a, b]) => y >= a - 1 && y <= b + 1) ?? cuts[0];
        const zc = archTop(bayStart[0], bayStart[1], y) + 1.5;
        planes.push({ kind: "louver", ring: [eaveX0, y - tiltDy, zc - tiltDz, eaveX1, y - tiltDy, zc - tiltDz, eaveX1, y + tiltDy, zc + tiltDz, eaveX0, y + tiltDy, zc + tiltDz], of: "louver" });
        count++;
        total += Ls;
      }
    } else {
      for (let y = eaveY0 + sw / 2; y <= eaveY1 - sw / 2 + 1e-6; y += r.slats.spacingIn) {
        const bay = cuts.find(([a, b]) => y >= a - 1 && y <= b + 1) ?? cuts[0];
        members.push({ role: "slat", nominal: r.slats.size, lengthIn: Ls, cx: (eaveX0 + eaveX1) / 2, cy: y, cz: archTop(bay[0], bay[1], y) + sd / 2, sx: Ls, sy: sw, sz: sd, yaw: 0, tilt: 0, x0: eaveX0, y0: y, x1: eaveX1, y1: y });
        count++;
        total += Ls;
      }
    }
    slats = louvered ? null : { count, nominal: r.slats.size, totalIn: total };
    eaveFt = 0;
  }
  const louvers = louvered ? { sqFt: Math.round(footprintSqFt), blades: Math.floor((eaveY1 - eaveY0 - 6) / LOUVER_PITCH_IN) + 1 } : null;

  // Purlins across the rafters for metal on open framing.
  if (!pergola && metal && r.roofDeck === "purlins") {
    for (const f of faces) {
      const u = { x: f.ux, y: f.uy };
      const nn = { x: f.nx, y: f.ny };
      const hTop = f.baseTopIn;
      for (let v = 6; v < f.vTopIn - 3; v += 24) {
        // The purlin's ends follow the face's sides at this v.
        const uA = f.sideA === "hip" ? v * cot(f.betaA) : 0;
        const uB = f.lengthIn - (f.sideB === "hip" ? v * cot(f.betaB) : 0);
        if (uB - uA < 12) continue;
        const P = { x: f.ax + u.x * uA + nn.x * v, y: f.ay + u.y * uA + nn.y * v };
        const Q = { x: f.ax + u.x * uB + nn.x * v, y: f.ay + u.y * uB + nn.y * v };
        const L = uB - uA;
        members.push({ role: "purlin", nominal: "2x4", lengthIn: L, cx: (P.x + Q.x) / 2, cy: (P.y + Q.y) / 2, cz: zTopAt(v, f.ovhIn, hTop, f.slope) + 0.75, sx: L, sy: 1.5, sz: 3.5, yaw: Math.atan2(u.y, u.x), tilt: 0, x0: P.x, y0: P.y, x1: Q.x, y1: Q.y, of: f.id });
      }
    }
  }

  // Knee braces at every post, along its headers. One taken out in the 3D is left out by its key: the post and the
  // way the brace runs (`roofBraceKey`, 2026-11-09).
  let braces = 0;
  let bracesLeftOut = 0;
  const bracesOff = new Set(r.bracesOff ?? []);
  // The braces' timber (2026-11-14): the 4x4 they always were, or the builder's 6x6 or 8x8 — never larger than the post.
  const braceNominal = braceSizeFor(r.braceSize, r.post, "4x4");
  const braceFace = BRACE_ACTUAL_IN[braceNominal][0];
  if (r.braces) {
    for (const p of posts) {
      if (p.heightIn < BRACE_LEG_IN * 2) continue;
      const mine = headers.filter((h) => (Math.abs(h.x0 - p.x) < 0.01 && Math.abs(h.y0 - p.y) < 0.01) || (Math.abs(h.x1 - p.x) < 0.01 && Math.abs(h.y1 - p.y) < 0.01) || h.postAt.some((a, i) => i > 0 && i < h.postAt.length - 1 && Math.abs(h.x0 + ((h.x1 - h.x0) * a) / h.lengthIn - p.x) < 0.5 && Math.abs(h.y0 + ((h.y1 - h.y0) * a) / h.lengthIn - p.y) < 0.5));
      for (const h of mine) {
        const u = unit({ x: h.x1 - h.x0, y: h.y1 - h.y0 });
        const atStart = Math.abs(h.x0 - p.x) < 0.5 && Math.abs(h.y0 - p.y) < 0.5;
        const atEnd = Math.abs(h.x1 - p.x) < 0.5 && Math.abs(h.y1 - p.y) < 0.5;
        const dirs: Array<1 | -1> = atStart ? [1] : atEnd ? [-1] : [1, -1];
        for (const d of dirs) {
          const L = BRACE_LEG_IN * Math.SQRT2;
          const ex = p.x + u.x * d * (BRACE_LEG_IN / 2);
          const ey = p.y + u.y * d * (BRACE_LEG_IN / 2);
          const yaw = Math.atan2(u.y * d, u.x * d);
          // Its top lands on THIS header's underside where the brace meets it (a shallower header rides higher than the post's top).
          const under = headerTopAt(p.y + u.y * d * BRACE_LEG_IN) - h.spec.depthIn;
          const key = roofBraceKey(p.id, yaw);
          if (bracesOff.has(key)) {
            bracesLeftOut++;
            continue;
          }
          members.push({ role: "roof-brace", nominal: braceNominal, lengthIn: L, cx: ex, cy: ey, cz: under - BRACE_LEG_IN / 2, sx: L, sy: braceFace, sz: braceFace, yaw, tilt: Math.PI / 4, x0: p.x, y0: p.y, x1: p.x + u.x * d * BRACE_LEG_IN, y1: p.y + u.y * d * BRACE_LEG_IN, of: key });
          braces++;
        }
      }
    }
  }

  // Walls between the posts (M3): screen over a kneewall with a door, or lattice or solid panels floor to header.
  let walls: RoofFrame["walls"] = null;
  if (r.walls.fill !== "none" && posts.length >= 2) {
    const fill = r.walls.fill;
    // The ring's open edges, the farthest from the house first.
    const edges: Array<{ k: number; A: V2; B: V2; d: number }> = [];
    for (let k = 0; k < n; k += postEvery) {
      if (edgeIsWall(k)) continue;
      const A = ring[k];
      const B = ring[(k + postEvery) % n];
      edges.push({ k, A, B, d: (A.y + B.y) / 2 });
    }
    edges.sort((a, b) => b.d - a.d);
    const chosen = edges.slice(0, Math.min(r.walls.sides, edges.length));
    const segments: NonNullable<RoofFrame["walls"]>["segments"] = [];
    let sqFt = 0;
    let kneewallLf = 0;
    let doors = 0;
    const zFloor = floorIn + 0.5;
    const zTop = headerBottomIn;
    chosen.forEach((e, i) => {
      const u = unit(sub(e.B, e.A));
      const L = len(sub(e.B, e.A)) - pw;
      if (L < 24) return;
      const A = { x: e.A.x + u.x * (pw / 2), y: e.A.y + u.y * (pw / 2) };
      const B = { x: e.B.x - u.x * (pw / 2), y: e.B.y - u.y * (pw / 2) };
      const yaw = Math.atan2(u.y, u.x);
      segments.push({ x0: A.x, y0: A.y, x1: B.x, y1: B.y, lengthIn: Math.round(L) });
      const at = (t: number) => ({ x: A.x + u.x * t, y: A.y + u.y * t });
      // THE GAPS IN THIS WALL (2026-11-13), along it from its own start (half a post in from the corner):
      //  · the openings the builder framed on this side, each with its door's leaves (one to 4 ft, a pair to 8 ft) where
      //    the wall is screen and a door was asked for now — left open otherwise;
      //  · or, when the builder framed none anywhere, the one door a screened room always had, in the front wall. It
      //    stood at the wall's middle whatever was there — on a header laid in two spans, right on the middle post. It
      //    now stands in the bay the middle is in, or the widest, clear of the posts.
      const gaps: Array<{ a: number; b: number; leaves: number; id?: string }> = [];
      const mineW = userEdges.get(e.k);
      if (mineW) {
        for (const x of mineW.opens) {
          const ga = Math.max(0, x.lo);
          const gb = Math.min(L, x.hi - pw);
          if (gb - ga < 6) continue;
          const clear = gb - ga;
          const leaves = fill === "screen" && x.o.door ? (clear <= ROOF_DOOR_LEAF_FT * 12 + 3 ? 1 : clear <= 2 * ROOF_DOOR_LEAF_FT * 12 + 3 ? 2 : 0) : 0;
          gaps.push({ a: ga, b: gb, leaves, id: x.o.id });
          const built = openingsBuilt.find((ob) => ob.id === x.o.id);
          if (built) built.leaves = leaves;
        }
      }
      if (fill === "screen" && i === 0 && L > DOOR_W_IN + 24 && r.openings.length === 0) {
        let doorAt = L / 2;
        const hd = headers.find((x) => x.id === `h${e.k + 1}`);
        const inner = hd ? hd.postAt.slice(1, -1).map((t) => t - pw / 2) : [];
        if (inner.some((t) => Math.abs(t - doorAt) < DOOR_W_IN / 2 + pw / 2 + 1)) {
          // The bays between the posts, post face to post face.
          const marks = [-pw / 2, ...inner, L + pw / 2];
          const bays = marks.slice(1).map((t, bi) => ({ a: marks[bi] + pw / 2, b: t - pw / 2 })).filter((bay) => bay.b - bay.a >= DOOR_W_IN + 2);
          const best = bays.sort((p, q) => q.b - q.a - (p.b - p.a))[0];
          if (best) doorAt = (best.a + best.b) / 2;
        }
        gaps.push({ a: doorAt - DOOR_W_IN / 2, b: doorAt + DOOR_W_IN / 2, leaves: 1 });
      }
      gaps.sort((p, q) => p.a - q.a);
      const pieces: Array<[number, number]> = [];
      let from = 0;
      for (const gp of gaps) {
        if (gp.a - from >= 6) pieces.push([from, gp.a]);
        from = Math.max(from, gp.b);
      }
      if (L - from >= 6) pieces.push([from, L]);
      // The plates: the wall's whole length as they always were — or, where the builder framed openings, piece by piece (no plate across a doorway).
      const plateRuns: Array<[number, number]> = mineW?.opens.length ? pieces : [[0, L]];
      const plates = (zs: number[]) => {
        for (const [pa, pb] of plateRuns) {
          const P = at(pa);
          const Q = at(pb);
          for (const z of zs) members.push({ role: "kneewall", nominal: "2x4", lengthIn: pb - pa, cx: (P.x + Q.x) / 2, cy: (P.y + Q.y) / 2, cz: z, sx: pb - pa, sy: 3.5, sz: 1.5, yaw, tilt: 0, x0: P.x, y0: P.y, x1: Q.x, y1: Q.y, of: `w${e.k}` });
          kneewallLf += ((pb - pa) / 12) * (zs.length / 2);
        }
      };
      if (fill === "screen") {
        // The kneewall: 2x4 top and bottom plates with a solid panel, then screen to the header.
        plates([zFloor + 1.75, zFloor + KNEEWALL_IN - 1.75]);
        for (const [pa, pb] of pieces) {
          const P = at(pa);
          const Q = at(pb);
          planes.push({ kind: "wall", ring: [P.x, P.y, zFloor, Q.x, Q.y, zFloor, Q.x, Q.y, zFloor + KNEEWALL_IN, P.x, P.y, zFloor + KNEEWALL_IN], of: `w${e.k}` });
          planes.push({ kind: "screen", ring: [P.x, P.y, zFloor + KNEEWALL_IN, Q.x, Q.y, zFloor + KNEEWALL_IN, Q.x, Q.y, zTop, P.x, P.y, zTop], of: `w${e.k}` });
          sqFt += ((pb - pa) * (zTop - zFloor - KNEEWALL_IN)) / 144;
        }
        for (const gp of gaps) {
          if (!gp.leaves) continue;
          const leafW = (gp.b - gp.a) / gp.leaves;
          for (let lf = 0; lf < gp.leaves; lf++) {
            const P = at(gp.a + leafW * lf);
            const Q = at(gp.a + leafW * (lf + 1));
            doors++;
            members.push({ role: "door", nominal: "screen door", lengthIn: DOOR_H_IN, cx: (P.x + Q.x) / 2, cy: (P.y + Q.y) / 2, cz: zFloor + DOOR_H_IN / 2, sx: leafW, sy: 1.5, sz: DOOR_H_IN, yaw, tilt: 0, x0: P.x, y0: P.y, x1: Q.x, y1: Q.y, of: `w${e.k}` });
          }
          const P = at(gp.a);
          const Q = at(gp.b);
          planes.push({ kind: "screen", ring: [P.x, P.y, zFloor + DOOR_H_IN, Q.x, Q.y, zFloor + DOOR_H_IN, Q.x, Q.y, zTop, P.x, P.y, zTop], of: `w${e.k}` });
        }
      } else {
        plates([zFloor + 1.75, zTop - 1.75]);
        for (const [pa, pb] of pieces) {
          const P = at(pa);
          const Q = at(pb);
          planes.push({ kind: fill === "lattice" ? "screen" : "wall", ring: [P.x, P.y, zFloor, Q.x, Q.y, zFloor, Q.x, Q.y, zTop, P.x, P.y, zTop], of: `w${e.k}` });
          sqFt += ((pb - pa) * (zTop - zFloor)) / 144;
        }
      }
    });
    walls = { fill, segments, sqFt: Math.round(sqFt), kneewallLf: Math.round(kneewallLf), doors };
  }

  // A cupola at the peak.
  if (r.cupola && !pergola) {
    const half = CUPOLA_IN / 2;
    const base = peakIn - 2;
    const corners: V2[] = [{ x: c.x - half, y: c.y - half }, { x: c.x + half, y: c.y - half }, { x: c.x + half, y: c.y + half }, { x: c.x - half, y: c.y + half }];
    for (const q of corners) members.push({ role: "cupola", nominal: "4x4", lengthIn: CUPOLA_BOX_IN, cx: q.x, cy: q.y, cz: base + CUPOLA_BOX_IN / 2, sx: 3.5, sy: 3.5, sz: CUPOLA_BOX_IN, yaw: 0, tilt: 0, x0: q.x, y0: q.y, x1: q.x, y1: q.y });
    const top = base + CUPOLA_BOX_IN;
    const peak = top + half * 0.75;
    for (let k = 0; k < 4; k++) {
      const A = corners[k];
      const B = corners[(k + 1) % 4];
      const o = { x: (A.x - c.x) * 1.2 + c.x, y: (A.y - c.y) * 1.2 + c.y };
      const o2 = { x: (B.x - c.x) * 1.2 + c.x, y: (B.y - c.y) * 1.2 + c.y };
      planes.push({ kind: "roofing", ring: [o.x, o.y, top, o2.x, o2.y, top, c.x, c.y, peak], of: "cupola" });
    }
  }

  // ── Figures for the material list.
  const ridgeFt = ridge ? ridge.lengthIn / 12 : 0;
  const hipRoof = kind === "hip" || kind === "pyramid" || kind === "double-tier" || kind === "dutch-gable";
  const wasteFactor = pergola ? 1 : hipRoof ? 1.15 : kind === "gambrel" ? 1.12 : 1.1;
  const squares = pergola ? 0 : Math.ceil((roofAreaSqFt * wasteFactor) / 100 * 10) / 10;
  const sheets = pergola || (metal && r.roofDeck === "purlins") ? 0 : Math.ceil((roofAreaSqFt * wasteFactor) / 32 - 1e-9);
  const metalPanels: RoofFrame["metalPanels"] = [];
  if (metal) {
    const byLen = new Map<number, number>();
    for (const f of faces) {
      const slopedFt = Math.ceil((f.vTopIn / cosT) / 12 + 0.25);
      const panels = Math.ceil(f.lengthIn / METAL_PANEL_COVER_IN);
      byLen.set(slopedFt, (byLen.get(slopedFt) ?? 0) + panels);
    }
    for (const [lengthFt, count] of [...byLen].sort((a, b) => a[0] - b[0])) metalPanels.push({ lengthFt, count });
  }

  // Gutters: every eave that is not on the wall; a hip's eaves make one closed run.
  let gutters: GutterPlan | null = null;
  if (r.gutters.kind !== "none" && !pergola) {
    const eaves = faces.filter((f) => f.tier === 1).map((f) => f.lengthIn / 12);
    const lf = eaves.reduce((a, b) => a + b, 0);
    const closed = hipRoof && !wall;
    const runs = closed ? 1 : eaves.length;
    const downspouts = closed ? Math.max(2, Math.ceil(lf / DOWNSPOUT_EVERY_FT)) : eaves.reduce((a, ft) => a + Math.max(1, Math.ceil(ft / DOWNSPOUT_EVERY_FT)), 0);
    const dropFt = (headerTopIn + heel) / 12 + 1;
    const hangerEvery = roofLoad >= 30 ? HANGER_SPACING_IN.snow : HANGER_SPACING_IN.plain;
    gutters = {
      kind: r.gutters.kind,
      lf: Math.round(lf * 10) / 10,
      runs,
      closed,
      corners: closed ? faces.filter((f) => f.tier === 1).length : 0,
      endCaps: closed ? 0 : runs * 2,
      downspouts,
      downspoutFt: Math.ceil(downspouts * dropFt),
      downspoutSize: r.gutters.kind === "k5" ? "2x3" : "3x4",
      hangers: Math.ceil((lf * 12) / hangerEvery) + runs,
      elbows: downspouts * 3,
      guardsLf: r.gutters.guards ? Math.round(lf * 10) / 10 : 0,
    };
    // Downspouts drawn at the posts nearest each run's end.
    let placedDs = 0;
    for (const p of posts) {
      if (placedDs >= downspouts || !p.corner) continue;
      const dsw = gutters.downspoutSize === "2x3" ? 2 : 3;
      const dsd = gutters.downspoutSize === "2x3" ? 3 : 4;
      const out = unit(sub(p, c));
      const h = headerTopIn + heel - 4 - (floorIn + 2);
      members.push({ role: "downspout", nominal: gutters.downspoutSize, lengthIn: h, cx: p.x + out.x * (pw / 2 + 2), cy: p.y + out.y * (pd / 2 + 2), cz: floorIn + 2 + h / 2, sx: dsw, sy: dsd, sz: h, yaw: 0, tilt: 0, x0: p.x, y0: p.y, x1: p.x, y1: p.y });
      placedDs++;
    }
  }

  // A slab under a gazebo or a pergola: drawn whether it is new or already there; priced (`slab`) only when it is new
  // (owner, 2026-11-06: "if there is an existing pad, don't calculate that").
  let slab: RoofFrame["slab"] = null;
  if (design.floor === "slab" || design.floor === "existing") {
    const sqFt = ((x1 - x0 + 2 * SLAB_APRON_IN) * (y1 - y0 + 2 * SLAB_APRON_IN)) / 144;
    if (design.floor === "slab") slab = { sqFt: Math.round(sqFt), cuYd: Math.round(((sqFt * (SLAB_THICK_IN / 12)) / 27) * 1.1 * 10) / 10 };
    planes.push({ kind: "slab", ring: [x0 - SLAB_APRON_IN, y0 - SLAB_APRON_IN, SLAB_TOP_IN, x1 + SLAB_APRON_IN, y0 - SLAB_APRON_IN, SLAB_TOP_IN, x1 + SLAB_APRON_IN, y1 + SLAB_APRON_IN, SLAB_TOP_IN, x0 - SLAB_APRON_IN, y1 + SLAB_APRON_IN, SLAB_TOP_IN] });
  }

  // THE RING IN TENSION (2026-10-12): hips with nothing under their tops lean on one another and push the corners out; the
  // headers hold them as a ring, so every header joint gets a tension strap. A hip's top carries 2W/3 of the jacks on it
  // (a load rising toward the top); along a hip of slope s·cos a that thrusts out H = (2W/3)/(s·cos a) at its corner, and
  // the two headers meeting there share it as T = H/(2 sin a) — a = 45° on a rectangle, 180°/n on an n-sided ring. A hip
  // on a ridge beam held up by king posts, or on the house wall, pushes nothing out.
  const thrusting = !!hipDesign && slope > 0 && (!wall || deepWallHip) && (kind === "pyramid" || kind === "double-tier" || kind === "dutch-gable" || (kind === "hip" && !(ridge?.kind === "beam" && crossPlan.length > 0)));
  const ringAngle = regular ? Math.PI / n : Math.PI / 4;
  const ringTensionLb = thrusting && hipDesign ? Math.round((2 * hipDesign.loadLb) / 3 / (slope * Math.cos(ringAngle)) / (2 * Math.sin(ringAngle))) : 0;
  const rafterCount = commons + jacks + flies;
  const hardware = {
    // A truss is tied down at both bearings; the rake's fly rafters sit on outlookers.
    hurricaneTies: pergola ? 0 : trusses ? 2 * trusses.count : rafterCount,
    rafterHangers: pergola ? 0 : (ridge?.kind === "beam" ? commons : 0) + (ledger ? commons + flies : 0) + jacks + hipCount,
    postBases: posts.length,
    postCaps: posts.length,
    slabAnchors: design.floor === "slab" || design.floor === "existing" ? posts.length * 2 : 0,
    braces,
    ledgerScrews: ledger?.fasteners ?? 0,
    ringPlate: (kind === "pyramid" || kind === "double-tier") && regular ? (tier2 ? 2 : 1) : 0,
    kingBrackets: kingPosts + (ridgeSupports === "wall-king" ? 1 : 0),
    wallHangers: wall && kind === "gable" ? 2 : 0,
    gussets: kind === "gambrel" ? breakTies * 2 : 0,
    cornerStraps: ringTensionLb > 0 ? ringHeaders.length : 0,
    crossHangers: 2 * crossPlan.length,
  };

  // The gap a free-standing roof leaves at the house wall (y = 0), for the checks, the 3D's note and the plans.
  let houseGap: HouseGap | null = null;
  if (!wall && houseClearIn(design) != null && eaveRing.length) {
    const eaveIn = Math.min(...eaveRing.map((p) => p.y));
    const gutterIn = gutterWidthIn(r.gutters.kind);
    houseGap = { eaveIn: Math.round(eaveIn), clearIn: Math.round(eaveIn - FASCIA_OUT_IN - gutterIn), postsIn: Math.round(Math.min(...ring.map((p) => p.y))), gutter: gutterIn > 0 };
  }

  return {
    roof: r,
    kind,
    kindNote,
    attach: wall ? "wall" : "free",
    floor: design.floor,
    species,
    group,
    rafterGroup,
    roofLoad,
    deadPsf,
    totalPsf,
    ring,
    eaveRing,
    centreX: c.x,
    centreY: c.y,
    widthIn: Math.max(...eaveRing.map((p) => p.x)) - Math.min(...eaveRing.map((p) => p.x)),
    depthIn: Math.max(...eaveRing.map((p) => p.y)) - Math.min(...eaveRing.map((p) => p.y)),
    ringAreaSqFt: Math.round(ringAreaSqFt * 10) / 10,
    footprintSqFt: Math.round(footprintSqFt * 10) / 10,
    floorIn,
    headerBottomIn,
    headerTopIn,
    peakIn,
    slope,
    pitchAngle: theta,
    faces,
    posts,
    headers,
    ledger,
    rafters: { size: rafterSize, spacingIn: trusses ? TRUSS_SPACING_IN : spacing, count: rafterCount, commons, jacks, flies, longestIn: longest, spanIn: Math.round(commonSpanIn), maxSpanIn: rafterMax, estimated: rafterGroup === "RW" || ceilingOn },
    ridge,
    hips: { count: hipCount, nominal: hipDesign ? hipDesign.nominal : hipNominal, totalIn: hipTotal, spanIn: hipDesign?.spanIn, loadLb: hipDesign?.loadLb, kind: hipDesign?.kind, beyond: hipDesign?.beyond },
    kingPosts,
    ties,
    crossBeams: crossPlan.length,
    hipEndTies: hipEndTies > 0 ? members.filter((m) => m.role === "tie").length - ties : 0,
    ringTensionLb,
    ridgeAcrossIn,
    trusses,
    slats,
    members,
    planes,
    wallFlashing,
    houseGap,
    eaveFt: Math.round(eaveFt * 10) / 10,
    rakeFt: Math.round(rakeFt * 10) / 10,
    wallFt: Math.round(wallFt * 10) / 10,
    ridgeFt: Math.round(ridgeFt * 10) / 10,
    hipFt: Math.round((hipTotal / 12) * 10) / 10,
    roofAreaSqFt: Math.round(roofAreaSqFt * 10) / 10,
    wasteFactor,
    squares,
    sheets,
    metalPanels,
    ceilingSqFt: Math.round(ceilingSqFt),
    soffitSqFt: Math.round(soffitSqFt),
    gutters,
    slab,
    walls,
    louvers,
    archRafters: arched,
    breakTies,
    gablets,
    engineered,
    hardware,
    headersLeftOut,
    openings: openingsBuilt,
    pins: pinsBuilt,
    notPlaced,
    sides,
    bracesLeftOut,
    postsInStair,
    flags: {
      rafterBeyondTable: !trusses && commonSpanIn > rafterMax + 0.01,
      headerBeyondTable: headerBeyond,
      ridgeBeyondTable: ridgeBeyond,
      postBeyondTable: postBeyond,
      speciesEstimated: rafterGroup === "RW",
      tooWideForHip,
      postSpliced,
      engineeredBeyond,
      tiesBeyondStock,
      trussesBeyond,
    },
  };
}

/** The roof's posts as the deck frame takes them: their own footings through the deck. */
export function roofPostsForDeck(roof: RoofFrame): Array<{ id: string; x: number; y: number; size: PostSize; loadLb: number }> {
  if (roof.floor !== "deck") return [];
  return roof.posts.map((p) => ({ id: p.id, x: p.x, y: p.y, size: p.size, loadLb: p.loadLb }));
}

/** "Gable 6:12 · 2x8 rafters @ 16 in. · 4 posts" */
export function roofWords(roof: RoofFrame): string {
  const r = roof.roof;
  if (roof.kind === "pergola") return `Pergola${roof.archRafters ? ", arched" : ""} · ${roof.rafters.size} rafters @ ${roof.rafters.spacingIn} in. · ${roof.louvers ? "louvers" : `${r.slats.size} slats @ ${r.slats.spacingIn} in.`} · ${roof.posts.length} posts`;
  const name = roof.kind === "double-tier" ? "Double-tier" : roof.kind === "dutch-gable" ? "Dutch gable" : roof.kind.charAt(0).toUpperCase() + roof.kind.slice(1);
  return `${name} ${r.pitch}:12 · ${roof.trusses ? `trusses @ ${roof.trusses.spacingIn} in.` : `${roof.rafters.size} rafters @ ${roof.rafters.spacingIn} in.`} · ${roof.posts.length} ${roof.posts.length === 1 ? "post" : "posts"}`;
}

export { CEILING_FACTOR, RW_FACTOR };
