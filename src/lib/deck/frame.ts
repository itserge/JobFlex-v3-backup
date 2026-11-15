// THE DECK'S FRAME, WORKED OUT (2026-10-04) — pure.
//
// Owner: "you select the perimeter, you choose the joist … and it starts
// building." A design goes in (design.ts); out comes every stick of the
// frame with its size, its length and where it sits — joists, rim, ledger,
// beams, posts, blocking, braces — and every footing. The 3D draws these
// sticks, the material list counts them, the checks read their spans. One
// frame, three readings.
//
// HOW IT DECIDES (each choice a contractor can override in the studio):
//
//   · Joists run out from the house. The deck is one rectangle or two
//     (an L); each rectangle is framed on its own supports.
//   · The fewest beam lines first, then the smallest joist that spans:
//     a size is tried on a single span, and a middle beam is added only
//     when no size in the table reaches.
//   · A DROPPED beam sits under the joists and they run past it — up to
//     2 ft by default, never past what the joist table allows. A FLUSH
//     beam is in the joists' plane, the joists hang on it, and it is what
//     a deck too low for a beam underneath gets.
//   · Each beam takes the size and the post count that cost least
//     together: a deeper beam against one more post, footing and hole.
//   · A deck that cannot hang on the house (brick veneer, an overhang,
//     framing nobody can see) gets a second beam line by the house.
//
// HOW A SPAN IS MEASURED. Face of support to face of support, as the code
// measures it: from the ledger's face (1 1/2 in. off the wall) to the near
// face of the beam, a beam's bearing taken as 3 in. wide. The cantilever is
// from the beam's far face to the edge of the deck.
//
// WHAT IS OUTSIDE THE TABLES IS SAID, NOT HIDDEN. A middle beam carries
// joists on both sides, which the code's beam table is not printed for: it
// is sized from the strip of deck it really carries (codeTables
// effectiveSpanFromTributaryFt) and flagged for the building office. A post
// past 14 ft, an area past 160 sq ft on one post, a joist past 18 ft on a
// ledger: flagged as an engineer's.

import {
  BEAM_CANTILEVER_SHARE,
  BEAM_TABLE_LAST_EFF_FT,
  BRACE_ABOVE_IN,
  DRESSED_DEPTH_IN,
  FOOTING_MIN_DEPTH_IN,
  JOIST_SIZES,
  POST_ACTUAL_IN,
  THICK_2X_IN,
  THICK_4X_IN,
  builtUpBeamMaxSpanIn,
  builtUpParts,
  effectiveJoistSpanFt,
  effectiveSpanFromTributaryFt,
  footingMinSize,
  POST_TABLE_MAX_AREA,
  joistDepthIn,
  joistMaxCantileverIn,
  joistMaxSpanIn,
  ledgerSpacingIn,
  postMaxHeightIn,
  solidBeamMaxSpanIn,
  solidBeamTabulated,
  SOLID_BEAMS,
  type FootingSize,
  type JoistSize,
  type LoadPsf,
  type PostSize,
  type FramingGroup,
  type SpacingIn,
  type SpeciesGroup,
} from "./codeTables";
import { deckingProduct, framingSpecies, isCompositeFraming, wallType, type DeckingProduct, type FramingSpecies, type WallType } from "./catalog";
import { OC_BEAM_LAST_FT, OC_BLOCKING_MAX_FT, OC_POST, ocBeamMaxSpanIn, ocPostMaxAreaSqFt } from "./ocLumber";
import { BRACE_ACTUAL_IN, BUILT_UP_CHOICES, DECK_BEAM_LIMITS, braceSizeFor, frontClips, frontEdgeAt, shapeBows, sideBowAt, isSolidBeam, normalizeDeckDesign, shapeAreaSqFt, shapeEdges, shapeOutline, shapeZones, type BeamKind, type BeamSize, type BeamStyle, type DeckDesign, type DeckEdge, type FrontClip, type Zone, spaRectIn } from "./design";
import { ringEdges } from "./ringEdges";
import { deckingColor, deckingLook, deckingNamed } from "./deckingColors";
import { deckRate, lumberKey, type DeckRateBook } from "./rates";
import type { MarketSnapshot } from "../fence/market";

/* ------------------------------------------------------------------ */
/*  Constants a framer would recognise                                 */
/* ------------------------------------------------------------------ */

/** A beam's bearing is taken as 3 in. wide when a joist span is measured. */
const BEARING_HALF_IN = 1.5;
/** The longest stick a yard stocks, inches. */
export const STOCK_MAX_IN = 240;
/** Stock lengths, ft. */
export const STOCK_LENGTHS_FT = [8, 10, 12, 14, 16, 18, 20] as const;
/** The least air under the frame before the engine calls a deck too low to build. */
export const MIN_FRAME_CLEAR_IN = 1.5;
/** Wood closer to the soil than this is ordered ground-contact (AWPA). */
export const GROUND_CONTACT_WITHIN_IN = 6;
/** No joist layout is tried with more middle beams than this. */
const MAX_MIDDLE_BEAMS = 4;
/** How near a lower floor's post must fall to an upper deck's post to be that post (a double deck shaped level by level). */
export const SEAT_NEAR_IN = 6;
/** The default overhang past the outer beam: a fifth of the depth, to the half foot, 2 ft at most. */
export function autoOverhangIn(depthIn: number): number {
  return Math.min(24, Math.floor(depthIn / 5 / 6) * 6);
}
/** A precast pier block: 12 in. square at the base, its top about 7 in. above the ground. */
export const PIER_BLOCK = { baseIn: 12, topIn: 7 } as const;
/** Form tubes as they are sold, inches across. */
const TUBE_SIZES_IN = [8, 10, 12, 14, 16, 18, 20, 22, 24, 28, 30, 36] as const;
/** The pier under each post size: wide enough for the post and its base. */
const PIER_FOR_POST_IN: Record<PostSize, number> = { "4x4": 8, "4x6": 10, "6x6": 12, "8x8": 14, [OC_POST]: 10 };
/** Cubic feet in an 80-lb bag of concrete mix. */
export const BAG_CUFT = 0.6;
/** AWC's knee brace: a 2x4 from 2 ft down the post to 2 ft out along the beam. */
const BRACE_LEG_IN = 24;
/** A deck brace's name in `framing.bracesOff`: its beam, which end post (0 = the first), and the way it leans (along the beam, or out to the joists). */
export const deckBraceKey = (beamId: string, end: number, axis: "x" | "y"): string => `${beamId}:${end === 0 ? "a" : "z"}:${axis}`;

/* ------------------------------------------------------------------ */
/*  What comes out                                                     */
/* ------------------------------------------------------------------ */

export type StickRole = "joist" | "rim" | "ledger" | "beam" | "post" | "blocking" | "brace";

/** One piece of lumber: what it is cut from, how long, and the box it fills (inches). */
export interface Stick {
  role: StickRole;
  /** The stock: "2x10", "4x8", "6x6". */
  nominal: string;
  lengthIn: number;
  /** Centre of the box. x along the house, y out from it, z up from the ground. */
  cx: number;
  cy: number;
  cz: number;
  /** Size of the box along x, y and z. */
  sx: number;
  sy: number;
  sz: number;
  /** Ordered ground-contact: posts, the ledger, beams, and anything near the soil. */
  ground: boolean;
  /** A brace leans 45°: along x or y, toward + or −. */
  lean?: { axis: "x" | "y"; dir: 1 | -1 };
  /** The beam or zone it belongs to, for the notes. */
  of?: string;
  /** A piece turned in plan (a rim along a clipped corner or a bowed front): the direction of its axis, radians from +x. */
  yaw?: number;
  /** A rim bent to the front's curve: laminated plies, bought by the foot (M3). */
  curved?: boolean;
}

/** The supports of one rectangle of the deck, house side first. */
export interface ZoneFrame {
  zone: Zone;
  back: "ledger" | "beam";
  /** Centre lines of this rectangle's beams, inches from the house line. */
  beamYs: number[];
  /** Clear joist spans between supports, inches. */
  spansIn: number[];
  backCantIn: number;
  frontCantIn: number;
  /** The middle beams here the builder placed (design.framing.beamLines): which line, and where it stands. */
  byHand: Array<{ id: string; y: number }>;
  /** Every span and cantilever is inside the joist table. */
  ok: boolean;
}

export interface BeamSpec {
  /** "4x10", "2-2x12" — or an engineered beam's name ("2-ply LVL 1¾×11⅞", M3). */
  size: BeamSize | string;
  kind: BeamKind | "lvl";
  plies: number;
  /** As it measures: thickness (across) and depth, inches. */
  thickIn: number;
  depthIn: number;
  /** The stock each ply is: "2x10" or "4x8". */
  stock: string;
}

export interface Beam {
  id: string;
  /** Centre line, inches from the house line. */
  y: number;
  /** The line the joist spans were measured to (a flush beam's own centre moves with its thickness). */
  lineY: number;
  /** The rectangles of the deck it runs under. */
  zoneIds: Array<Zone["id"]>;
  x0: number;
  x1: number;
  style: BeamStyle;
  role: "back" | "middle" | "front";
  spec: BeamSpec;
  /** The joist span its table is entered with, ft, and which table that is. */
  tableSpanFt: number;
  /** The code's beam tables, AWC's solid-beam table, or Owens Corning's (read at the length of joist it carries). */
  table: "IRC" | "DCA6" | "OC";
  /** It carries joists on both sides — outside the code's single-span beam table. */
  bothSides: boolean;
  /** The longest span between posts its table allows, inches (0 = beyond the table). */
  maxSpanIn: number;
  /** Post centres along it, inches. */
  postXs: number[];
  /** The longest span between its posts, and its overhang past the end posts, inches. */
  spanIn: number;
  endIn: number;
  /** Underside, inches above the ground. */
  bottomIn: number;
  /** A middle beam the builder placed (design.framing.beamLines). */
  by?: { kind: "line"; id: string };
}

export interface Footing {
  type: "poured" | "pier-block";
  x: number;
  y: number;
  /** What the table asks for at this post's load (null = beyond the table). */
  required: FootingSize | null;
  /** What is poured: the pad's diameter and thickness, the pier's diameter. Inches. */
  padIn: number;
  padThickIn: number;
  pierIn: number;
  /** Bottom of the footing below the ground, and its top above it — the ground right there. */
  depthIn: number;
  topIn: number;
  /** The ground under this footing, inches, against the ground at the house line (negative downhill; M3 slope). */
  groundIn: number;
  cuFt: number;
  bags: number;
  /** Feet of form tube. */
  tubeFt: number;
}

export interface Post {
  id: string;
  beamId: string;
  x: number;
  y: number;
  size: PostSize;
  /** Top of the footing to the underside of the beam, inches. */
  heightIn: number;
  /** Deck area it carries, sq ft. */
  tributarySqFt: number;
  /** The tallest the table allows at that area (0 = not permitted / beyond the table). */
  maxHeightIn: number;
  /** An end post of its beam — where the braces go. */
  corner: boolean;
  /** Set by hand (2026-11-13; design.framing.pins): a post the builder stood under this beam. */
  by?: { kind: "pin"; id: string };
  footing: Footing;
  /** A roof's post (M2): it runs from its own footing up through the deck; the roof draws the post, the deck only its footing and base. */
  roof?: boolean;
}

/**
 * AN ANGLED BEAM UNDER A CORNER CUT AT 45° (2026-11-14). Where a corner of the front is cut back farther than the
 * joists may hang past their beam, the front beam stops where the cut begins and an angled beam runs under the cut —
 * parallel to it, the same overhang back — from the post at the front beam's end (`x0`, `y0`: one post carries both)
 * to a post of its own near the deck's side (`x1`, `y1`). The joists over it are cut to the angled rim.
 */
export interface CornerBeam {
  id: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  spec: BeamSpec;
  lengthIn: number;
  /** The span its size takes between two posts on the joists it carries (0 = past its table). */
  maxSpanIn: number;
  bottomIn: number;
  /** The beam whose end post it shares at (`x0`, `y0`); null when it stands on two posts of its own (a prow: no front beam left). */
  hostBeamId: string | null;
  /** The deck it carries, sq ft — half to each of its posts. */
  areaSqFt: number;
  /** The corner it stands under; how far the joists hang past it; the support behind it (a beam's line, or the deck's back), inches from the house line. */
  clip: FrontClip;
  overIn: number;
  behindY: number;
}

export interface LedgerRun {
  y: number;
  x0: number;
  x1: number;
  lengthIn: number;
  /** The joist span hanging on it, ft, and what that makes the fastener spacing. */
  joistSpanFt: number;
  spacingIn: number;
  rule: string;
  fasteners: number;
}

/** One joist position: where it is and how it is cut. */
export interface JoistLine {
  x: number;
  zoneId: Zone["id"];
  /** An outside joist of the deck. */
  edge: boolean;
  /** The second half of a doubled outside joist. */
  sister: boolean;
}

export interface DeckFrame {
  design: DeckDesign;
  species: FramingSpecies;
  decking: DeckingProduct;
  wall: WallType;
  /** The rule book the frame is read on: a code species row, or "OC" (Owens Corning's tables). */
  group: FramingGroup;
  load: LoadPsf;
  zones: ZoneFrame[];
  edges: DeckEdge[];
  areaSqFt: number;
  /** Feet of outline that is open air, and feet against the house. */
  openEdgeFt: number;
  houseEdgeFt: number;

  joistSize: JoistSize;
  spacingIn: SpacingIn;
  /** The widest joist spacing the chosen boards allow, laid as chosen. */
  deckingMaxSpacingIn: number;
  beamStyle: BeamStyle;
  beamKind: BeamKind;
  /** Why the beams are not the kind the design asked for, when they are not. */
  beamKindNote: string | null;
  /**
   * Posts set by hand (2026-11-13), beam by beam: how many are the builder's, and how many more the beam still needed —
   * at an end it would have run too far past, or in a span past its table. And the ones that found no beam to stand under.
   */
  postsByHand: Array<{ beamId: string; role: Beam["role"]; mine: number; added: number }>;
  pinsNotSet: Array<{ id: string; why: string }>;
  /** The middle beams the builder placed (design.framing.beamLines): how many stand, how many more the joists' spans asked for, and the ones that found no place. */
  beamsByHand: { mine: number; added: number };
  beamLinesNotSet: Array<{ id: string; why: string }>;
  /** A double deck (2026-11-13): how many decks its posts and footings hold (1, or 2 for the upper of two), and — the lower one — that its beams hang on the upper deck's posts, each at one of these seats. */
  carries: number;
  hung: boolean;
  seats: Array<{ beamId: string; x: number; y: number }>;
  /** The angled beams under corners cut at 45° (2026-11-14; see CornerBeam). */
  cornerBeams: CornerBeam[];
  /**
   * Where a joist sits on a dropped beam — each one tie (two on a doubled joist), inches: x the joist's line, y where it
   * crosses the beam (an angled beam's line too). A beam stopped short of a corner cut at an angle carries no joist
   * past its end, and a joist cut short of a beam by the corner does not reach it (2026-11-14: ties were drawn and
   * counted on every joist along every beam's line, and stood in the air past the cut).
   */
  tieAt: Array<{ x: number; y: number; n: 1 | 2 }>;
  /** Levels, inches above the ground. */
  surfaceIn: number;
  joistTopIn: number;
  joistBottomIn: number;
  /** Top of the footings above the ground. */
  footingTopIn: number;

  joists: JoistLine[];
  beams: Beam[];
  posts: Post[];
  ledgers: LedgerRun[];
  sticks: Stick[];
  /** Connectors the layout itself decides. */
  hardware: {
    hangers: number;
    doubleHangers: number;
    ties: number;
    postBases: number;
    postCaps: number;
    braces: number;
    /** Structural screws, rim to joist ends: three each. */
    rimScrews: number;
    lateralTies: number;
    /** OC framing: posts notched for a 2-ply beam and screwed to it (no post cap), per the installation guide. */
    notchedPosts: number;
    /** A double deck's lower floor: beams let into the posts that pass them, through-bolted (2026-11-13). */
    beamSeats: number;
  };
  /** Rows of blocking: where, and how many pieces. */
  blockingRows: Array<{ y: number; zoneId: Zone["id"]; pieces: number; why: "beam" | "mid-span" | "maker" | "curve" }>;
  /** The front's shape (M3): the extra the bow hangs past the straight overhang at its middle, inches; the ground's fall under the deck. */
  frontExtraCantIn: number;
  /**
   * THE SIDES AND THE BACK, BOWED (2026-11-15 — the owner: "choose which side I want the radius on"). What carries each:
   *   · a SIDE — the deck's outside joist doubled (a sister on its yard side), short joists ("outriggers") hung on it
   *     at the joists' spacing and cut to the arc, the bent rim across their ends; where the bow is deeper than 2 ft,
   *     a beam on two posts under them, parallel to the side;
   *   · the BACK of a deck that stands free — the joists run on past the back beam to the arc (`cantIn`: how far the
   *     longest hangs past it; `cantMaxIn`: what its span allows).
   */
  sideBows: Array<{ side: "left" | "right" | "back"; bowIn: number; outriggers: number; longestIn: number; beam: { x: number; y0: number; y1: number; size: string; cantIn: number } | null; cantIn?: number; cantMaxIn?: number }>;
  groundHighIn: number;
  groundLowIn: number;
  /** What the layout could not do inside the tables — read by checks.ts. */
  flags: {
    /** The frame does not fit under a deck this low. */
    tooLow: boolean;
    /** A dropped beam was asked for and does not fit; the frame is drawn with it anyway. */
    droppedDoesNotFit: boolean;
    /** No joist layout inside the table was found; the nearest one is drawn. */
    joistBeyondTable: boolean;
    /** A beam with no size in its table. */
    beamBeyondTable: string[];
  };
  /** Knee braces the layout would set that were taken out by hand (design.framing.bracesOff). */
  bracesLeftOut: number;
}

export interface BuildOptions {
  /** The shop's price book and the job's market — they tip the beam-against-post choice. */
  rates?: DeckRateBook;
  market?: MarketSnapshot;
  /**
   * A roof's posts standing on this deck (lib/deck/roof): each gets its own
   * footing here, sized for the load it brings down, read on the footing
   * table as the deck area that weighs the same (`loadLb ÷ (load + 10 psf)`).
   */
  extraPosts?: Array<{ id: string; x: number; y: number; size: PostSize; loadLb: number }>;
  /** The roof's own species row — its posts are sawn wood even over an OC deck. */
  extraPostsGroup?: SpeciesGroup;
  /** The ground's height under a point of the plan, inches (M3: the site's slope). Flat when left out. */
  groundAt?: (x: number, y: number) => number;
  /**
   * A DOUBLE DECK (2026-11-13; lib/deck/structure — the owner: "a double deck, like first floor and second floor").
   * `carries`: this deck's posts and footings also hold a deck of the same outline hung under it, so each is sized for
   * that many decks (2). `follow`: this IS that lower deck — its beams stand on the upper deck's own lines and are let
   * into the upper deck's posts where they pass, so it has no posts, footings or braces of its own.
   */
  carries?: number;
  follow?: DeckFrame;
  /**
   * A double deck's lower floor shaped ON ITS OWN (2026-11-14; lib/deck/doubleDeck): the upper deck's posts that stand
   * inside it, in its own inches. A post of its own that falls on one of them is that post — its beam sits in a seat
   * let into it, no post or footing of its own; everywhere else it stands on posts of its own.
   */
  seatOn?: Array<{ x: number; y: number }>;
}

/* ------------------------------------------------------------------ */
/*  A loaded member on its supports                                    */
/* ------------------------------------------------------------------ */

/**
 * A member loaded evenly from `start` to `end`, resting on `supports`: the
 * length of it each support carries. `continuous: false` reads it as cut
 * over every support (each span on its own — the code's "tributary"
 * reading). `continuous: true` takes, support by support, the larger of
 * that and what one unbroken member really puts down (a joist running over
 * a middle beam loads it a quarter more than two cut joists would).
 */
export function supportShares(supports: readonly number[], start: number, end: number, continuous: boolean): number[] {
  const n = supports.length;
  if (n === 0) return [];
  if (n === 1) return [Math.max(0, end - start)];
  const a = Math.max(0, supports[0] - start);
  const b = Math.max(0, end - supports[n - 1]);
  const L: number[] = [];
  for (let i = 1; i < n; i++) L.push(Math.max(1e-6, supports[i] - supports[i - 1]));
  const reactions = (M: number[]) => {
    const R = new Array<number>(n).fill(0);
    R[0] += a;
    R[n - 1] += b;
    for (let i = 1; i < n; i++) {
      const span = L[i - 1];
      const shift = (M[i] - M[i - 1]) / span;
      R[i - 1] += span / 2 + shift;
      R[i] += span / 2 - shift;
    }
    return R;
  };
  const cut = new Array<number>(n).fill(0);
  cut[0] = (-a * a) / 2;
  cut[n - 1] = (-b * b) / 2;
  const simple = reactions(cut);
  if (!continuous || n < 3) return simple.map((r) => Math.max(0, r));
  // Three-moment equations for the moments over the inner supports.
  const M = [...cut];
  const m = n - 2;
  const lower = new Array<number>(m).fill(0);
  const diag = new Array<number>(m).fill(0);
  const upper = new Array<number>(m).fill(0);
  const rhs = new Array<number>(m).fill(0);
  for (let k = 0; k < m; k++) {
    const i = k + 1;
    const l1 = L[i - 1];
    const l2 = L[i];
    lower[k] = l1;
    diag[k] = 2 * (l1 + l2);
    upper[k] = l2;
    rhs[k] = -(l1 ** 3 + l2 ** 3) / 4;
    if (k === 0) rhs[k] -= l1 * M[0];
    if (k === m - 1) rhs[k] -= l2 * M[n - 1];
  }
  for (let k = 1; k < m; k++) {
    const w = lower[k] / diag[k - 1];
    diag[k] -= w * upper[k - 1];
    rhs[k] -= w * rhs[k - 1];
  }
  const inner = new Array<number>(m).fill(0);
  for (let k = m - 1; k >= 0; k--) inner[k] = (rhs[k] - (k < m - 1 ? upper[k] * inner[k + 1] : 0)) / diag[k];
  for (let k = 0; k < m; k++) M[k + 1] = inner[k];
  const whole = reactions(M);
  return simple.map((r, i) => Math.max(0, r, whole[i]));
}

/* ------------------------------------------------------------------ */
/*  Joists on their supports                                           */
/* ------------------------------------------------------------------ */

/** What the builder set by hand along the joists (2026-11-13): middle beams at places of their own, and the house-side beam's own overhang. */
interface HandBeams {
  /** A free-standing deck's back beam, inches in from the back edge; null = as the front. */
  backIn: number | null;
  lines: Array<{ id: string; y: number; zones: string[] }>;
}
const NO_HAND: HandBeams = { backIn: null, lines: [] };

/** The builder's middle beams that stand in this rectangle: between its first support and its front beam, a foot at least from each and from each other; as many as a deck takes. */
function handLinesIn(zone: Zone, start: number, front: number, hand: HandBeams): Array<{ id: string; y: number }> {
  const out: Array<{ id: string; y: number }> = [];
  for (const l of [...hand.lines].sort((a, b) => a.y - b.y)) {
    if (out.length >= MAX_MIDDLE_BEAMS) break;
    if (l.zones.length && !l.zones.includes(zone.id)) continue;
    if (l.y < start + DECK_BEAM_LIMITS.gapIn - 0.01 || l.y > front - DECK_BEAM_LIMITS.gapIn + 0.01) continue;
    if (out.some((o) => Math.abs(o.y - l.y) < DECK_BEAM_LIMITS.gapIn - 0.01)) continue;
    out.push({ id: l.id, y: l.y });
  }
  return out;
}

/**
 * The supports of one rectangle for an overhang `cIn` (to the beam's centre) and `middle` beams between. With beams
 * the builder placed (`hand`), those stand where they were put and `middle` counts the beams ADDED to them — each in
 * the middle of the longest stretch between two supports.
 */
function layoutZone(zone: Zone, back: "ledger" | "beam", cIn: number, middle: number, hand: HandBeams = NO_HAND): Omit<ZoneFrame, "ok"> {
  const c = Math.max(cIn, BEARING_HALF_IN);
  const front = zone.y1 - c;
  // The back beam at its own overhang — never nearer the front beam than two beams may stand (a part of the deck
  // shallower than the overhang set for the whole of it).
  const cBack = hand.backIn === null ? c : Math.max(BEARING_HALF_IN, Math.min(hand.backIn, front - DECK_BEAM_LIMITS.gapIn - zone.y0));
  const beamYs: number[] = [];
  let start: number;
  let face: number;
  if (back === "ledger") {
    start = zone.y0 + THICK_2X_IN;
    face = start;
  } else {
    start = zone.y0 + cBack;
    beamYs.push(start);
    face = start + BEARING_HALF_IN;
  }
  const byHand = hand.lines.length ? handLinesIn(zone, start, front, hand) : [];
  if (!byHand.length) for (let i = 1; i <= middle; i++) beamYs.push(Math.round(start + ((front - start) * i) / (middle + 1)));
  else {
    const mids = byHand.map((h) => h.y);
    for (let i = 0; i < middle && mids.length < MAX_MIDDLE_BEAMS; i++) {
      const all = [start, ...mids, front];
      let w = 0;
      for (let k = 1; k < all.length - 1; k++) if (all[k + 1] - all[k] > all[w + 1] - all[w] + 0.01) w = k;
      if (all[w + 1] - all[w] < 2 * DECK_BEAM_LIMITS.gapIn) break;
      mids.push(Math.round((all[w] + all[w + 1]) / 2));
      mids.sort((p, q) => p - q);
    }
    beamYs.push(...mids);
  }
  beamYs.push(front);
  const spansIn: number[] = [];
  for (const y of back === "ledger" ? beamYs : beamYs.slice(1)) {
    spansIn.push(y - BEARING_HALF_IN - face);
    face = y + BEARING_HALF_IN;
  }
  return { zone, back, beamYs, spansIn, backCantIn: back === "beam" ? cBack - BEARING_HALF_IN : 0, frontCantIn: c - BEARING_HALF_IN, byHand };
}

/** Inside the joist table; with a beam style, also every beam it lands on inside a beam table. */
function zoneInsideTable(l: Omit<ZoneFrame, "ok">, size: JoistSize, spacing: SpacingIn, group: FramingGroup, load: LoadPsf, extraFrontIn = 0, beamsOf: BeamStyle | null = null): boolean {
  if (l.spansIn.length === 0 || l.spansIn.some((s) => !(s > 0))) return false;
  const max = joistMaxSpanIn(load, group, size, spacing);
  if (l.spansIn.some((s) => s > max)) return false;
  const first = l.spansIn[0] / 12;
  const last = l.spansIn[l.spansIn.length - 1] / 12;
  if (l.frontCantIn + extraFrontIn > joistMaxCantileverIn(load, group, size, last)) return false;
  if (l.backCantIn > joistMaxCantileverIn(load, group, size, first)) return false;
  if (!beamsOf) return true;
  // Every beam the joists land on must read on a beam table (2026-10-11): an effective joist span past its last column
  // (18 ft) is a beam no table sizes — the layout takes another beam line instead of leaving it to an engineer. The
  // same readings beamLines makes: an end beam from its span and overhang, a middle one from the strip it carries.
  const supports = l.back === "ledger" ? [l.zone.y0 + THICK_2X_IN, ...l.beamYs] : [...l.beamYs];
  const whole = supportShares(supports, l.zone.y0, l.zone.y1, beamsOf === "dropped");
  const offset = l.back === "ledger" ? 1 : 0;
  for (let i = 0; i < l.beamYs.length; i++) {
    const isBack = l.back === "beam" && i === 0;
    const isFront = i === l.beamYs.length - 1;
    if (group === "OC") {
      // Owens Corning's beam tables are read at the length of joist the beam carries, and stop at 11 ft.
      const joistFt = isBack ? first + l.backCantIn / 12 : isFront ? last + (l.frontCantIn + extraFrontIn) / 12 : (2 * whole[i + offset]) / 12;
      if (joistFt > OC_BEAM_LAST_FT + 1e-6) return false;
      continue;
    }
    const eff = isBack ? effectiveJoistSpanFt(first, l.backCantIn / 12) : isFront ? effectiveJoistSpanFt(last, l.frontCantIn / 12) : effectiveSpanFromTributaryFt(whole[i + offset] / 12);
    if (eff > BEAM_TABLE_LAST_EFF_FT + 1e-6) return false;
  }
  return true;
}

/** The farthest the engine lets joists hang past a beam on its own; a contractor may set more, up to the table. */
const AUTO_OVERHANG_MAX_IN = 24;

/** Overhangs to try, the one wanted first, then the nearest to it. */
function overhangTries(wantIn: number): number[] {
  const out: number[] = [wantIn];
  for (let d = 1; d <= AUTO_OVERHANG_MAX_IN; d++) {
    if (wantIn - d >= 0) out.push(wantIn - d);
    if (wantIn + d <= AUTO_OVERHANG_MAX_IN) out.push(wantIn + d);
  }
  return out;
}

interface JoistPlan {
  size: JoistSize;
  zones: ZoneFrame[];
  middle: number;
  inside: boolean;
  /** The beams it lands on read on a beam table too (2026-10-11). */
  beamsInside: boolean;
  /** The builder's middle beams that found no place in it (2026-11-13): a layout that stands them all is the one wanted. */
  dropped: number;
}

/**
 * The supports of every rectangle for one joist size: the fewest middle
 * beams, then the overhang nearest the one asked for. One overhang for the
 * whole deck, so the beams of two rectangles that share a front line up.
 */
function planJoists(zones: Zone[], backs: Array<"ledger" | "beam">, style: BeamStyle, size: JoistSize, spacing: SpacingIn, group: FramingGroup, load: LoadPsf, overhang: number | "auto", extraFrontIn = 0, hand: HandBeams = NO_HAND): JoistPlan {
  const shallow = Math.min(...zones.map((z) => z.y1 - z.y0));
  const want = style === "flush" ? 0 : overhang === "auto" ? autoOverhangIn(shallow) : Math.round(overhang * 12);
  // A bowed front hangs farther at its middle: the beam comes in until the whole bow is inside the table.
  const tries = style === "flush" ? [want] : overhang !== "auto" && extraFrontIn === 0 ? [want] : overhangTries(want);
  // The fewest middle beams with the joists AND every beam inside their tables; failing that (a bow can ask more
  // cantilever than a short last span allows), the joists inside as before and the beam said as past its table.
  const droppedIn = (list: Array<Pick<ZoneFrame, "byHand">>) => (hand.lines.length ? hand.lines.filter((ln) => !list.some((z) => z.byHand.some((h) => h.id === ln.id))).length : 0);
  const search = (withBeams: boolean): JoistPlan | null => {
    let found0: JoistPlan | null = null;
    for (const c of tries) {
      const fitted: ZoneFrame[] = [];
      let total = 0;
      let all = true;
      zones.forEach((zone, i) => {
        let found: ZoneFrame | null = null;
        for (let k = 0; k <= MAX_MIDDLE_BEAMS && !found; k++) {
          const l = layoutZone(zone, backs[i], c, k, hand);
          if (zoneInsideTable(l, size, spacing, group, load, extraFrontIn, withBeams ? style : null)) {
            found = { ...l, ok: true };
            total += k;
          }
        }
        if (found) fitted.push(found);
        else all = false;
      });
      if (!all) continue;
      // The builder's beams all standing first (the front beam gives way to one put near it), then the fewest added.
      const dropped = droppedIn(fitted);
      if (!found0 || dropped < found0.dropped || (dropped === found0.dropped && total < found0.middle)) found0 = { size, zones: fitted, middle: total, inside: true, beamsInside: withBeams, dropped };
      if (found0.middle === 0 && found0.dropped === 0) break;
    }
    return found0;
  };
  const best = search(true) ?? search(false);
  if (best) return best;
  // Nothing inside the table: draw the nearest thing — the overhang asked
  // for, and middle beams until the spans (if not the overhang) are in.
  const max = joistMaxSpanIn(load, group, size, spacing);
  let middle = 0;
  const drawn = zones.map((zone, i) => {
    let l = layoutZone(zone, backs[i], want, 0, hand);
    for (let k = 1; k <= MAX_MIDDLE_BEAMS && l.spansIn.some((s) => s > max); k++) l = layoutZone(zone, backs[i], want, k, hand);
    middle += l.beamYs.length - (backs[i] === "beam" ? 2 : 1);
    return { ...l, ok: zoneInsideTable(l, size, spacing, group, load, extraFrontIn) };
  });
  return { size, zones: drawn, middle, inside: false, beamsInside: false, dropped: droppedIn(drawn) };
}

/* ------------------------------------------------------------------ */
/*  Beams                                                              */
/* ------------------------------------------------------------------ */

export function beamSpec(size: BeamSize): BeamSpec {
  if (isSolidBeam(size)) {
    const depth = Number(size.slice(2));
    return { size, kind: "solid", plies: 1, thickIn: THICK_4X_IN, depthIn: DRESSED_DEPTH_IN[depth], stock: size };
  }
  const { plies, nominalDepth } = builtUpParts(size);
  return { size, kind: "built-up", plies, thickIn: plies * THICK_2X_IN, depthIn: DRESSED_DEPTH_IN[nominalDepth], stock: `2x${nominalDepth}` };
}

/**
 * Posts along a beam `lengthIn` long whose table span is `maxSpanIn`: the
 * fewest, set in from the ends. The beam never runs past an end post by more
 * than a quarter of the span beside it (R507.5) — with n posts that caps the
 * end at length ÷ (4n − 2).
 */
export function layoutPosts(lengthIn: number, maxSpanIn: number, style: BeamStyle): { count: number; endIn: number; spanIn: number } {
  const want = style === "flush" ? Math.min(3, lengthIn / 4) : Math.min(12, Math.floor(lengthIn / 8));
  const capped = (n: number) => Math.min(want, Math.floor(lengthIn / (4 * n - 2)));
  if (!(maxSpanIn > 0)) return { count: 2, endIn: capped(2), spanIn: lengthIn - 2 * capped(2) };
  for (let n = 2; n <= 60; n++) {
    const end = capped(n);
    const span = (lengthIn - 2 * end) / (n - 1);
    if (span <= maxSpanIn + 1e-6) return { count: n, endIn: end, spanIn: span };
    // One post fewer than the next count needs, if the beam may run past
    // its end posts far enough: a quarter of the span, 2 ft at most.
    const reach = Math.ceil((lengthIn - (n - 1) * maxSpanIn) / 2);
    if (reach <= Math.min(24, maxSpanIn * BEAM_CANTILEVER_SHARE) + 1e-6) return { count: n, endIn: reach, spanIn: (lengthIn - 2 * reach) / (n - 1) };
  }
  return { count: 60, endIn: capped(60), spanIn: (lengthIn - 2 * capped(60)) / 59 };
}

/** A beam's end stands this far inside a corner cut at an angle, in.; clear of an angled beam it stops short of; the least beam left worth a beam; how far past its overhang a cut goes before an angled beam carries it. */
const CLIP_BEAM_INSET_IN = 3;
const CLIP_BEAM_HALF_IN = 2;
const CLIP_BEAM_CLEAR_IN = 8;
const CLIP_BEAM_MIN_IN = 24;
const CLIP_ANGLED_MIN_IN = 18;
/** An angled beam's own post stands this far in from the deck's side, in.; the beam runs this far past it. */
const CORNER_POST_IN_IN = 6;
const CORNER_BEAM_PAST_IN = 3;

/**
 * layoutPosts for a beam with an end — or both — on a post it shares with an angled beam: a post AT that end, the
 * fewest between, and the free end no farther past its post than a quarter of the span beside it (R507.5). `xs` are
 * the posts from the beam's left end.
 */
function layoutPostsEnds(lengthIn: number, maxSpanIn: number, style: BeamStyle, fixedLeft: boolean, fixedRight: boolean): ReturnType<typeof layoutPosts> & { xs?: number[] } {
  if (!fixedLeft && !fixedRight) return layoutPosts(lengthIn, maxSpanIn, style);
  const free = fixedLeft && fixedRight ? 0 : 1;
  const want = style === "flush" ? Math.min(3, lengthIn / 4) : Math.min(12, Math.floor(lengthIn / 8));
  for (let n = 2; n <= 60; n++) {
    const end = free ? Math.min(want, Math.floor(lengthIn / (4 * n - 3))) : 0;
    const span = (lengthIn - end) / (n - 1);
    if (!(maxSpanIn > 0) || span <= maxSpanIn + 1e-6 || n === 60) {
      const first = fixedLeft ? 0 : end;
      return { count: n, endIn: end, spanIn: span, xs: Array.from({ length: n }, (_, k) => first + k * span) };
    }
  }
  return layoutPosts(lengthIn, maxSpanIn, style);
}

interface BeamLine {
  zoneId: Zone["id"];
  /** The builder's own line it stands on (design.framing.beamLines), a middle beam only. */
  by?: string;
  y: number;
  x0: number;
  x1: number;
  role: Beam["role"];
  /** The joist span the IRC table is entered with (effective), and the one AWC's is (real). */
  ircFt: number;
  dcaFt: number;
  /**
   * The length of joist Owens Corning's beam table is entered with: an end beam's span and overhang (the guide's
   * "length of joist"), a middle beam's strip of deck doubled (the joist length that loads a beam the same).
   */
  ocFt: number;
  /** Strip of deck it carries, ft. */
  tributaryFt: number;
  bothSides: boolean;
}

function beamLines(z: ZoneFrame, style: BeamStyle): BeamLine[] {
  const supports = z.back === "ledger" ? [z.zone.y0 + THICK_2X_IN, ...z.beamYs] : [...z.beamYs];
  const cut = supportShares(supports, z.zone.y0, z.zone.y1, false);
  const whole = supportShares(supports, z.zone.y0, z.zone.y1, style === "dropped");
  const offset = z.back === "ledger" ? 1 : 0;
  const spans = z.spansIn.map((s) => s / 12);
  const lastSpan = spans[spans.length - 1];
  return z.beamYs.map((y, i): BeamLine => {
    const isBack = z.back === "beam" && i === 0;
    const isFront = i === z.beamYs.length - 1;
    const share = cut[i + offset] / 12;
    if (isBack) return { zoneId: z.zone.id, y, x0: z.zone.x0, x1: z.zone.x1, role: "back", ircFt: effectiveJoistSpanFt(spans[0], z.backCantIn / 12), dcaFt: spans[0], ocFt: spans[0] + z.backCantIn / 12, tributaryFt: share, bothSides: false };
    if (isFront) return { zoneId: z.zone.id, y, x0: z.zone.x0, x1: z.zone.x1, role: "front", ircFt: effectiveJoistSpanFt(lastSpan, z.frontCantIn / 12), dcaFt: lastSpan, ocFt: lastSpan + z.frontCantIn / 12, tributaryFt: share, bothSides: false };
    const eff = effectiveSpanFromTributaryFt(whole[i + offset] / 12);
    const by = z.byHand.find((h) => Math.abs(h.y - y) < 0.01)?.id;
    return { zoneId: z.zone.id, y, x0: z.zone.x0, x1: z.zone.x1, role: "middle", ircFt: eff, dcaFt: eff, ocFt: (2 * whole[i + offset]) / 12, tributaryFt: share, bothSides: true, ...(by ? { by } : {}) };
  });
}

interface MergedLine {
  y: number;
  x0: number;
  x1: number;
  role: Beam["role"];
  segs: BeamLine[];
  by?: string;
}

/** Beam lines of two rectangles that sit on one line and touch are one beam. */
function mergeLines(lines: BeamLine[]): MergedLine[] {
  const out: MergedLine[] = [];
  for (const l of [...lines].sort((p, q) => p.y - q.y || p.x0 - q.x0)) {
    const m = out.find((o) => Math.abs(o.y - l.y) < 0.5 && Math.abs(o.x1 - l.x0) < 0.5);
    if (m) {
      m.x1 = l.x1;
      m.segs.push(l);
      if (l.role === "middle") m.role = "middle";
      if (l.by) m.by = l.by;
    } else out.push({ y: l.y, x0: l.x0, x1: l.x1, role: l.role, segs: [l], ...(l.by ? { by: l.by } : {}) });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Footings                                                           */
/* ------------------------------------------------------------------ */

const tubeFor = (needIn: number) => TUBE_SIZES_IN.find((t) => t >= needIn) ?? TUBE_SIZES_IN[TUBE_SIZES_IN.length - 1];
const cylinderCuFt = (diameterIn: number, heightIn: number) => (Math.PI * (diameterIn / 2) ** 2 * Math.max(0, heightIn)) / 1728;

/** How deep the footings of this deck go: a foot at least; to frost where the deck hangs on the house (R507.3.3) or the shop always digs to frost. */
export function footingDepthIn(design: DeckDesign): number {
  const toFrost = design.placement === "attached" || design.footing.frostAlways;
  return Math.max(FOOTING_MIN_DEPTH_IN, toFrost ? design.frostIn : 0);
}

export function footingFor(design: DeckDesign, x: number, y: number, tributarySqFt: number, post: PostSize, topIn: number): Footing {
  const required = footingMinSize(design.loadPsf, tributarySqFt, design.soilPsf);
  if (design.footing.type === "pier-block") {
    return { type: "pier-block", x, y, required, padIn: PIER_BLOCK.baseIn, padThickIn: 8, pierIn: PIER_BLOCK.baseIn, depthIn: 8 - topIn, topIn, groundIn: 0, cuFt: 0, bags: 0, tubeFt: 0 };
  }
  const depthIn = footingDepthIn(design);
  const pierIn = PIER_FOR_POST_IN[post];
  // The table, read between its rows as R507.3.1 allows, rounds to the inch — and a round pad that only just meets it
  // can bear a shade over the soil's figure: 53.3 sq ft of deck at 40 + 10 psf on 1,500-psf soil needs 1.78 sq ft, an
  // 18-in. pad has 1.77 (found by the plan set's bearing check, 2026-10-23). The pad is the larger of the table's and
  // the one plain statics ask for, so every footing passes the table and the arithmetic a plan reviewer does.
  const staticsIn = Math.ceil(Math.sqrt((4 * Math.max(0, tributarySqFt) * (design.loadPsf + 10)) / design.soilPsf / Math.PI) * 12 - 1e-9);
  const need = required ? Math.max(required.roundIn, staticsIn) : TUBE_SIZES_IN[TUBE_SIZES_IN.length - 1];
  const padThickIn = required?.thickIn ?? 12;
  if (need <= pierIn) {
    // The pier alone is wide enough: one tube from the bottom of the hole to the top.
    const cuFt = cylinderCuFt(pierIn, depthIn + topIn);
    return { type: "poured", x, y, required, padIn: pierIn, padThickIn, pierIn, depthIn, topIn, groundIn: 0, cuFt, bags: Math.ceil(cuFt / BAG_CUFT - 1e-9), tubeFt: (depthIn + topIn) / 12 };
  }
  // A pad as wide as the table asks, and the pier standing on it.
  const padIn = tubeFor(need);
  const pierHeight = Math.max(0, depthIn - padThickIn) + topIn;
  const cuFt = cylinderCuFt(padIn, padThickIn) + cylinderCuFt(pierIn, pierHeight);
  return { type: "poured", x, y, required, padIn, padThickIn, pierIn, depthIn, topIn, groundIn: 0, cuFt, bags: Math.ceil(cuFt / BAG_CUFT - 1e-9), tubeFt: pierHeight / 12 };
}

/* ------------------------------------------------------------------ */
/*  The build                                                          */
/* ------------------------------------------------------------------ */

const zoneAt = (zones: Zone[], x: number): Zone | undefined => zones.find((z) => x > z.x0 && x < z.x1);

/**
 * Cut a run longer than stock into the fewest pieces, as even as the
 * `breaks` allow — a splice lands on a post or a joist, never in the air —
 * so a 24-ft ledger is two 12s, not a 20 and a 4.
 */
export function splitRun(from: number, to: number, breaks: readonly number[]): Array<[number, number]> {
  const length = to - from;
  const n = Math.ceil(length / STOCK_MAX_IN - 1e-9);
  if (n <= 1) return [[from, to]];
  const inner = breaks.filter((b) => b > from + 1 && b < to - 1).sort((p, q) => p - q);
  const out: Array<[number, number]> = [];
  let at = from;
  for (let i = 1; i < n; i++) {
    const even = from + (length * i) / n;
    // A break this piece can reach that still leaves the rest inside stock.
    const reach = inner.filter((b) => b > at + 1 && b - at <= STOCK_MAX_IN + 1e-6 && to - b <= (n - i) * STOCK_MAX_IN + 1e-6);
    const cut = reach.length ? reach.reduce((m, b) => (Math.abs(b - even) < Math.abs(m - even) ? b : m)) : Math.min(at + STOCK_MAX_IN, even);
    out.push([at, cut]);
    at = cut;
  }
  out.push([at, to]);
  return out;
}

/** A design → its frame. Never throws: what cannot be done inside the tables is drawn and flagged. */
export function buildDeckFrame(raw: DeckDesign, opts: BuildOptions = {}): DeckFrame {
  const design = normalizeDeckDesign(raw);
  // A board or a species of the contractor's own is named as they name it; it is framed as what it works like (2026-10-12).
  const species0 = framingSpecies(design.framing.species);
  const species = design.custom.species ? { ...species0, label: design.custom.species.name, short: design.custom.species.name } : species0;
  const decking0 = deckingProduct(design.decking.product);
  // THE COLOUR RIDES WITH THE BOARD (2026-11-09): the frame's board is named with its colour and looks like it, so the
  // 3D, the material list, the proposal and the permit set all say the same board. A board of the contractor's own has
  // no maker's list: only a colour typed in applies to it.
  const look = deckingLook(decking0, design.custom.decking ? { color: "", ownColor: design.decking.ownColor } : design.decking);
  // A PICTURE-FRAME BORDER IN A SECOND COLOUR (2026-11-10): another colour of the same line, bought and drawn apart.
  // On every shape (2026-11-13): the border runs an L's and a wall-following deck's open edges too (lib/deck/surface).
  const borderPick = !design.custom.decking && design.decking.border > 0 ? deckingColor(decking0.id, design.decking.borderColor) : null;
  const border = borderPick && (design.decking.ownColor || borderPick.id !== design.decking.color) ? { name: borderPick.name, label: deckingNamed(decking0.label, borderPick.name), color: borderPick.hex, ...(borderPick.hex2 ? { color2: borderPick.hex2 } : {}) } : null;
  const decking: DeckingProduct = { ...decking0, label: deckingNamed(design.custom.decking ? design.custom.decking.name : decking0.label, look.name), color: look.hex, ...(look.name ? { colorName: look.name } : {}), ...(look.hex2 ? { color2: look.hex2 } : {}), ...(border ? { border } : {}) };
  const wall = wallType(design.wall);
  const group = species.group;
  // OC LUMBER (2026-11-12): sized on Owens Corning's tables, bought on its own price rows.
  const composite = isCompositeFraming(species);
  const load = design.loadPsf;
  const zones = shapeZones(design.shape);
  const edges = shapeEdges(design.shape, design.placement);
  const attached = design.placement === "attached";
  const freeStanding = !attached;

  const deckingMaxSpacingIn = design.decking.pattern !== "straight" ? decking.maxSpacingIn.diagonal : decking.maxSpacingIn.square;
  // The front's shape (M3) and the ground under the deck.
  const front = design.shape.kind === "rect" ? design.shape.front : undefined;
  // CORNERS CUT AT AN ANGLE (2026-11-14): a rectangle's two clipped corners, or any corner of a front set part by part.
  const clips = frontClips(design.shape);
  const shaped = (!!front && front.kind !== "straight") || (design.shape.kind === "wall" && clips.length > 0);
  const bulgeIn = front?.kind === "curve" ? Math.round(front.bulgeFt * 12) : 0;
  const backBowIn = design.placement === "detached" ? Math.round(shapeBows(design.shape).back * 12) : 0;
  const frontAt = (x: number, y1: number) => (shaped ? frontEdgeAt(design.shape, x) : y1);
  const groundAt = opts.groundAt ?? (() => 0);
  const W0 = Math.max(...zones.map((z) => z.x1));
  const D0 = Math.max(...zones.map((z) => z.y1));
  const groundSamples = [groundAt(0, 0), groundAt(W0, 0), groundAt(0, D0), groundAt(W0, D0), groundAt(W0 / 2, D0 / 2)];
  const groundHighIn = Math.max(...groundSamples);
  const groundLowIn = Math.min(...groundSamples);
  const spacingIn: SpacingIn = design.framing.spacingIn === "auto" ? (deckingMaxSpacingIn >= 16 ? 16 : 12) : design.framing.spacingIn;

  const surfaceIn = design.heightIn;
  const joistTopIn = surfaceIn - decking.thickIn;
  const footingTopIn = design.footing.type === "pier-block" ? PIER_BLOCK.topIn : design.footing.aboveGradeIn;
  const fits = (size: JoistSize) => joistTopIn - joistDepthIn(size) >= MIN_FRAME_CLEAR_IN;
  // PAST THE HOUSE'S CORNER (2026-11-14): a part of the deck with no wall behind it stands on a beam of its own there,
  // however the rest of the deck meets the house.
  const backs: Array<"ledger" | "beam"> = zones.map((z) => (attached && !z.open ? "ledger" : "beam"));
  const anyBackBeam = backs.includes("beam");

  // Joist sizes to try: the one asked for, or the smallest that both fits
  // under the deck and spans. A 2x6 is offered only where a 2x8 will not fit.
  const sizes: JoistSize[] = design.framing.joist !== "auto" ? [design.framing.joist] : fits("2x8") ? JOIST_SIZES.filter((s) => s !== "2x6" && fits(s)) : ["2x6"];

  const beamKindAsked = design.framing.beamKind;
  const solidOk = solidBeamTabulated(load, group);
  const beamKind: BeamKind = beamKindAsked === "solid" && !solidOk ? "built-up" : beamKindAsked;
  // OC framing is always built up (Owens Corning prints no solid beam): no note, the switch says it.
  const beamKindNote =
    beamKindAsked === "solid" && !solidOk && !composite
      ? group === "SP"
        ? "Solid 4x beams have no printed span table for Southern pine — beams are built up from 2x lumber, which the code tabulates."
        : `Solid 4x beams are tabulated for the 40 psf load only — at ${load} psf the beams are built up from 2x lumber, which the code tabulates.`
      : null;
  const askedBeam = design.framing.beam !== "auto" && (isSolidBeam(design.framing.beam) ? beamKind === "solid" : beamKind === "built-up") ? design.framing.beam : null;
  const beamChoices: BeamSize[] = askedBeam ? [askedBeam] : beamKind === "solid" ? [...SOLID_BEAMS] : [...BUILT_UP_CHOICES];

  const price = (key: string) => deckRate(key, opts.rates, opts.market).price;
  // A post's own lumber, about 3 ft of it: the built-up OC post is three boards.
  const postLumber = design.framing.post === OC_POST ? 3 * price(lumberKey("2x6", true)) : price(lumberKey(design.framing.post));
  const postSetCost = price("labor.footing") + 4 * price("conc.bag") + price("hw.postBase") + price("hw.postCap") + 3 * postLumber;

  /** The strips of deck each beam carries, kept for its posts' areas. */
  const strips = new Map<string, BeamLine[]>();

  // THE BEAMS BY HAND (2026-11-13): middle beams at the builder's places — a part of the deck that is no longer there
  // names none, so the beam stands wherever it fits — and a free-standing deck's back beam at its own overhang.
  const zoneIds = new Set(zones.map((z) => z.id));
  const handLines = design.framing.beamLines.map((l) => ({ id: l.id, y: Math.round(l.atFt * 12), zones: l.zones.some((z) => zoneIds.has(z)) ? l.zones.filter((z) => zoneIds.has(z)) : [] }));

  // A DOUBLE DECK (2026-11-13). The upper deck's posts hold both decks; the lower deck stands on the upper one's lines.
  const carries = Math.max(1, Math.min(3, Math.round(opts.carries ?? 1)));
  const follow = opts.follow && opts.follow.zones.length === zones.length ? opts.follow : null;
  /** The lower deck's joists on the upper deck's supports: the same lines, checked for this deck's own joists. */
  const followPlan = (of: DeckFrame, style: BeamStyle, size: JoistSize): JoistPlan => {
    const zs = zones.map((zone, i): ZoneFrame => {
      const fz = of.zones.find((q) => q.zone.id === zone.id) ?? of.zones[i];
      const l = { zone, back: backs[i], beamYs: fz.beamYs.slice(), spansIn: fz.spansIn.slice(), backCantIn: fz.backCantIn, frontCantIn: fz.frontCantIn, byHand: [] };
      return { ...l, ok: zoneInsideTable(l, size, spacingIn, group, load, bulgeIn) };
    });
    const inside = zs.every((z) => z.ok);
    return { size, zones: zs, middle: 0, inside, beamsInside: inside && zs.every((z) => zoneInsideTable(z, size, spacingIn, group, load, bulgeIn, style)), dropped: 0 };
  };

  /** One whole frame for a beam style; null when a dropped beam cannot fit and the style is the engine's to choose. */
  const attempt = (style: BeamStyle, mayFail: boolean): DeckFrame | null => {
    strips.clear();
    // A flush beam is the deck's edge: only a dropped back beam can stand in from it.
    const hand: HandBeams = { backIn: style === "dropped" && anyBackBeam && typeof design.framing.backOverhangFt === "number" ? Math.round(design.framing.backOverhangFt * 12) : null, lines: handLines };
    let plan: JoistPlan | null = null;
    for (const size of sizes) {
      const p = follow ? followPlan(follow, style, size) : planJoists(zones, backs, style, size, spacingIn, group, load, design.framing.overhangFt, bulgeIn, hand);
      // Inside both tables beats inside the joist table alone beats neither; then the fewest middle beams.
      const rank = (q: JoistPlan) => (q.inside ? (q.beamsInside ? 2 : 1) : 0);
      if (!plan || rank(p) > rank(plan) || (rank(p) === rank(plan) && (p.dropped < plan.dropped || (p.dropped === plan.dropped && p.middle < plan.middle)))) plan = p;
      if (rank(plan) === 2 && plan.middle === 0 && plan.dropped === 0) break;
    }
    if (!plan) return null;
    const joistSize = plan.size;
    const joistDepth = joistDepthIn(joistSize);
    const joistBottomIn = joistTopIn - joistDepth;
    const tooLow = joistBottomIn - groundHighIn < MIN_FRAME_CLEAR_IN;

    // Beams: for each line, the size and post count that cost least together.
    let lines = mergeLines(plan.zones.flatMap((z) => beamLines(z, style)));
    // NO BEAM PAST A CORNER CUT AT AN ANGLE (2026-11-14). A beam under the joists ran the part's whole width: at a corner
    // cut back farther than the joists hang past it, its end — and the post under it — stood outside the deck (a
    // rectangle with 5-ft clipped corners had two posts out in the open). Every beam now stops inside the cut; and where
    // the cut goes more than 18 in. past the overhang, the FRONT beam stops where the cut begins and an angled beam
    // carries the joists under it (cornerPlans, built below).
    const cornerPlans: Array<{ clip: FrontClip; frontY: number; overIn: number; behind: number; wide: number; host: MergedLine | null }> = [];
    if (style === "dropped" && clips.length) {
      for (const k of clips) {
        const zf = plan.zones.find((q) => Math.abs(q.zone.y1 - k.y) < 0.5 && (k.dir === 1 ? Math.abs(q.zone.x0 - k.x) < 1 : Math.abs(q.zone.x1 - k.x) < 1));
        if (!zf) continue;
        const frontY = zf.beamYs[zf.beamYs.length - 1];
        const overIn = k.y - frontY;
        const angled = k.c - overIn > CLIP_ANGLED_MIN_IN;
        const behind = zf.beamYs.length >= 2 ? zf.beamYs[zf.beamYs.length - 2] : zf.zone.y0;
        let host: MergedLine | null = null;
        for (const line of lines) {
          const atEnd = k.dir === 1 ? Math.abs(line.x0 - k.x) < 1 : Math.abs(line.x1 - k.x) < 1;
          if (!atEnd || line.y >= k.y) continue;
          // (To the beam's OUTER face: its own half-thickness is past its line.)
          const excess = k.c - (k.y - line.y) + CLIP_BEAM_HALF_IN;
          if (excess <= 0) continue;
          const isFront = Math.abs(line.y - frontY) < 0.5;
          const cut = isFront && angled ? k.c : excess + (angled ? overIn + CLIP_BEAM_CLEAR_IN : CLIP_BEAM_INSET_IN);
          if (k.dir === 1) line.x0 = Math.min(line.x1, k.x + cut);
          else line.x1 = Math.max(line.x0, k.x - cut);
          for (const sg of line.segs) {
            sg.x0 = Math.max(sg.x0, line.x0);
            sg.x1 = Math.min(sg.x1, line.x1);
          }
          line.segs = line.segs.filter((sg) => sg.x1 - sg.x0 > 0.5);
          if (isFront && angled) host = line;
        }
        if (angled) cornerPlans.push({ clip: k, frontY, overIn, behind, wide: zf.zone.x1 - zf.zone.x0, host });
      }
      // A beam the cuts left less than 2 ft of is no beam: the angled beams stand on posts of their own there.
      const gone = new Set(lines.filter((l) => l.x1 - l.x0 < CLIP_BEAM_MIN_IN || !l.segs.length));
      if (gone.size) {
        lines = lines.filter((l) => !gone.has(l));
        for (const cp of cornerPlans) if (cp.host && gone.has(cp.host)) cp.host = null;
      }
    }
    /** The ends of a beam that stand on a post shared with an angled beam: a post AT that end. */
    const fixedEnds = (line: MergedLine) => ({ left: cornerPlans.some((cp) => cp.host === line && cp.clip.dir === 1), right: cornerPlans.some((cp) => cp.host === line && cp.clip.dir === -1) });
    const beyond: string[] = [];
    const postsByHand: DeckFrame["postsByHand"] = [];
    const pinsNotSet: DeckFrame["pinsNotSet"] = [];
    // The builder's beams that stand, the ones the spans added to them, and the ones with no place to stand.
    const handZones = new Set(plan.zones.filter((z) => z.byHand.length > 0).map((z) => z.zone.id));
    const stood = new Set(plan.zones.flatMap((z) => z.byHand.map((h) => h.id)));
    const beamsByHand: DeckFrame["beamsByHand"] = { mine: lines.filter((l) => l.by).length, added: lines.filter((l) => l.role === "middle" && !l.by && l.segs.some((sg) => handZones.has(sg.zoneId))).length };
    const beamLinesNotSet: DeckFrame["beamLinesNotSet"] = handLines.filter((l) => !stood.has(l.id)).map((l) => ({ id: l.id, why: "it has no room between the house side and the front beam, a foot clear of each and of the next beam" }));
    let droppedDoesNotFit = false;
    const beams: Beam[] = [];
    // The builder's own posts, each put on its beam: the one of that name its place is under — the longest, where two are.
    const spacingByHandIn = typeof design.framing.postSpacingFt === "number" ? design.framing.postSpacingFt * 12 : 0;
    const postW = POST_ACTUAL_IN[design.framing.post]?.[0] ?? 5.5;
    const pinsByLine = new Map<number, Array<{ id: string; x: number }>>();
    const pinAt = new Map<string, string>();
    for (const pin of design.framing.pins) {
      const x = pin.atFt * 12;
      // A post that went under a beam the builder placed goes with THAT beam, wherever it stands now.
      const named = lines.map((l, k) => ({ l, k })).filter(({ l }) => (pin.line ? l.by === pin.line : l.role === pin.beam));
      if (!named.length) {
        pinsNotSet.push({ id: pin.id, why: pin.line ? "the middle beam it stood under is not there any more" : pin.beam === "back" ? "this deck has no back beam — it hangs on the house there" : pin.beam === "middle" ? "this deck has no middle beam" : "this deck has no front beam" });
        continue;
      }
      const under = named.filter(({ l }) => x >= l.x0 - 0.5 && x <= l.x1 + 0.5);
      const at = (under.length ? under : named).reduce((m, q) => (q.l.x1 - q.l.x0 > m.l.x1 - m.l.x0 ? q : m));
      pinsByLine.set(at.k, [...(pinsByLine.get(at.k) ?? []), { id: pin.id, x }]);
    }
    for (const [i, line] of lines.entries()) {
      const id = `b${i + 1}`;
      const lengthIn = line.x1 - line.x0;
      const ircFt = Math.max(...line.segs.map((s) => s.ircFt));
      const dcaFt = Math.max(...line.segs.map((s) => s.dcaFt));
      const ocFt = Math.max(...line.segs.map((s) => s.ocFt));
      const bothSides = line.segs.some((s) => s.bothSides);
      const room = joistBottomIn - footingTopIn;
      // NO POST OVER THE TABLE (2026-10-11, owner: "offer fixes or auto fix" — a post carried 195 sq ft): a post carries
      // the strip of deck the beam holds times the beam between its neighbours, and the post and footing tables stop at
      // 160 sq ft. So the posts stand no farther apart than that allows, whatever the beam could span (2% short of the
      // limit, for the rounding of the areas).
      const stripFt = Math.max(0.5, ...line.segs.map((s) => s.tributaryFt));
      // An OC post carries what Owens Corning's listing says under that beam (5,500 lb under 2 plies, 8,250 under 3).
      // (The upper of two decks: its posts carry the strip of BOTH, so they stand as close as that asks.)
      const areaSpanFor = (plies: number) => Math.floor(((Math.min(POST_TABLE_MAX_AREA, composite ? ocPostMaxAreaSqFt(load, plies) : Infinity) * 0.98) / (stripFt * carries)) * 12);
      // The lower of two decks: this beam hangs on the posts of the upper deck's beam on the same line — its posts are given.
      const over = follow ? follow.beams.find((b) => Math.abs(b.lineY - line.y) < 0.5 && Math.abs(b.x0 - line.x0) < 0.5 && Math.abs(b.x1 - line.x1) < 0.5) ?? null : null;
      type Option = { spec: BeamSpec; maxSpanIn: number; posts: ReturnType<typeof layoutPosts> & { xs?: number[] }; cost: number };
      const fixed = fixedEnds(line);
      const options: Option[] = beamChoices.map((size) => {
        const spec = beamSpec(size);
        const maxSpanIn =
          spec.kind === "solid"
            ? solidBeamMaxSpanIn(load, group, size as (typeof SOLID_BEAMS)[number], dcaFt)
            : group === "OC"
              ? ocBeamMaxSpanIn(load, size as (typeof BUILT_UP_CHOICES)[number], ocFt)
              : builtUpBeamMaxSpanIn(load, group, size as (typeof BUILT_UP_CHOICES)[number], ircFt);
        // …nor farther apart than the builder set by hand (2026-11-13) — closer posts may let a lighter beam do.
        const posts = over ? { count: over.postXs.length, endIn: over.endIn, spanIn: over.spanIn } : layoutPostsEnds(lengthIn, maxSpanIn > 0 ? Math.min(maxSpanIn, areaSpanFor(spec.plies), spacingByHandIn || Infinity) : maxSpanIn, style, fixed.left, fixed.right);
        return { spec, maxSpanIn, posts, cost: (lengthIn / 12) * spec.plies * price(lumberKey(spec.stock, composite)) + (over ? 0 : posts.count * postSetCost) };
      });
      const cheapest = (list: Option[]) => list.reduce((m, o) => (o.cost < m.cost - 0.005 || (Math.abs(o.cost - m.cost) <= 0.005 && o.spec.depthIn < m.spec.depthIn) ? o : m));
      const deepest = (list: Option[]) => list.reduce((m, o) => (o.spec.depthIn > m.spec.depthIn || (o.spec.depthIn === m.spec.depthIn && o.spec.plies > m.spec.plies) ? o : m));
      // (Hung on given posts, a beam must reach from one to the next: a size that does not is no choice.)
      const tabulatedAll = options.filter((o) => o.maxSpanIn > 0 && (!over || o.maxSpanIn >= over.spanIn - 0.01));
      // (A lower floor shaped on its own, on a line of the upper deck's: its beam reaches from one of the upper's posts
      // to the next where a size can — those posts are there anyway — rather than standing on more of its own between.)
      const seatXs = opts.seatOn ? (pinsByLine.get(i) ?? []).map((q) => q.x).filter((x) => opts.seatOn!.some((q) => Math.abs(q.x - x) <= SEAT_NEAR_IN && Math.abs(q.y - line.y) <= SEAT_NEAR_IN)).sort((a, b) => a - b) : [];
      const seatGap = seatXs.length > 1 ? seatXs.slice(1).reduce((m, x, k) => Math.max(m, x - seatXs[k]), 0) : 0;
      const reaching = seatGap ? tabulatedAll.filter((o) => Math.min(o.maxSpanIn, areaSpanFor(o.spec.plies)) >= seatGap - 0.01) : [];
      const tabulated = reaching.length ? reaching : tabulatedAll;
      let pick: Option;
      if (tabulated.length === 0) {
        // Nothing in the table carries this: the deepest is drawn, and flagged.
        pick = deepest(options);
        beyond.push(id);
      } else if (askedBeam) pick = tabulated[0];
      else {
        // Dropped: shallow enough to clear its footings. Flush: at least as deep as the joists that hang on it, and still off the ground.
        const deepEnough = tabulated.filter((o) => o.spec.depthIn >= joistDepth);
        const fitting = style === "flush" ? deepEnough.filter((o) => o.spec.depthIn <= joistTopIn - MIN_FRAME_CLEAR_IN) : tabulated.filter((o) => o.spec.depthIn <= room);
        const shallowest = (list: Option[]) => list.reduce((m, o) => (o.spec.depthIn < m.spec.depthIn ? o : m));
        if (fitting.length) pick = cheapest(fitting);
        else if (style === "flush") pick = deepEnough.length ? shallowest(deepEnough) : deepest(tabulated);
        else pick = shallowest(tabulated);
      }
      // A dropped beam has to clear the top of its footings.
      if (style === "dropped" && pick.spec.depthIn > room) {
        if (mayFail) return null;
        droppedDoesNotFit = true;
      }
      const { spec, posts } = pick;
      // A flush beam is the deck's edge: its outer face on the line of the deck.
      const y = style === "flush" && line.role !== "middle" ? (line.role === "front" ? line.segs[0].y + BEARING_HALF_IN - spec.thickIn / 2 : line.segs[0].y - BEARING_HALF_IN + spec.thickIn / 2) : line.y;
      let postXs = over ? over.postXs.slice() : posts.xs ? posts.xs.map((x) => line.x0 + x) : Array.from({ length: posts.count }, (_, k) => line.x0 + posts.endIn + k * posts.spanIn);
      let spanIn = posts.spanIn;
      let endIn = posts.endIn;
      // POSTS SET BY HAND (2026-11-13). A beam the builder stood posts under stands on those — and on more only where
      // it must: at an end it would otherwise run past by more than a quarter of the span beside it (2 ft at most), and
      // in a span longer than its table, the post table's 160 sq ft, or the spacing set by hand allow. So a post can be
      // moved or added freely, and one "taken away" that the beam needs comes back in the middle of the span it left.
      const mine = pinsByLine.get(i) ?? [];
      if (mine.length) {
        const limit = pick.maxSpanIn > 0 ? Math.min(pick.maxSpanIn, areaSpanFor(pick.spec.plies), spacingByHandIn || Infinity) : Infinity;
        const own: number[] = [];
        for (const m of mine.map((q) => Math.max(line.x0 + 1, Math.min(line.x1 - 1, q.x))).sort((a, b) => a - b)) if (!own.some((q) => Math.abs(q - m) < postW + 1)) own.push(m);
        // (An end that shares its post with an angled beam keeps that post, whatever the builder set.)
        for (const fx of [...(fixed.left ? [line.x0] : []), ...(fixed.right ? [line.x1] : [])]) if (!own.some((q) => Math.abs(q - fx) < postW + 1)) own.push(fx);
        own.sort((a, b) => a - b);
        const longestOf = (list: number[]) => (list.length > 1 ? list.slice(1).reduce((m, x, k) => Math.max(m, x - list[k]), 0) : Infinity);
        let xs = own.slice();
        // The ends: past its end post a beam runs a quarter of its span at most, 2 ft at most — read on its longest
        // span, as the beam's own check reads it (checks.ts "beam-end"). An end post goes where the layout puts one, or
        // nearer the end where the spans came out short (two posts 7 in. apart at an end, 2026-11-13: a post added in a
        // span shortened the reach, and a second end post was stood outside the first — the end post moves out instead).
        let reach = Infinity;
        for (let round = 0; round < 8; round++) {
          reach = Math.min(reach, Math.min(24, longestOf(xs) * BEAM_CANTILEVER_SHARE) + 1e-6);
          const next = own.slice();
          const first = next[0] - line.x0;
          if ((next.length < 2 || first > reach) && first > postW + 1) next.unshift(line.x0 + Math.min(posts.endIn, reach, first / 2));
          const last = line.x1 - next[next.length - 1];
          if ((next.length < 2 || last > reach) && last > postW + 1) next.push(line.x1 - Math.min(posts.endIn, reach, last / 2));
          // The spans.
          const filled: number[] = [];
          next.forEach((x, k) => {
            if (k > 0 && Number.isFinite(limit)) {
              const gap = x - next[k - 1];
              // (Never more than a post every half foot: a limit that came out at nothing — a strip of deck with no
              // width between two beams on one line — once asked for posts without end, 2026-11-13.)
              const more = Math.min(Math.ceil(gap / Math.max(limit, 6) - 1e-9) - 1, 200);
              for (let j = 1; j <= more; j++) filled.push(next[k - 1] + (gap * j) / (more + 1));
            }
            filled.push(x);
          });
          const same = filled.length === xs.length && filled.every((x, k) => Math.abs(x - xs[k]) < 0.01);
          xs = filled;
          if (same) break;
        }
        postXs = xs;
        spanIn = xs.slice(1).reduce((m, x, k) => Math.max(m, x - xs[k]), 0);
        endIn = Math.max(xs[0] - line.x0, line.x1 - xs[xs.length - 1]);
        for (const m of mine) {
          const at = Math.max(line.x0 + 1, Math.min(line.x1 - 1, m.x));
          if (own.some((q) => Math.abs(q - at) < 0.01) && !pinAt.has(`${id}:${Math.round(at * 100)}`)) pinAt.set(`${id}:${Math.round(at * 100)}`, m.id);
        }
        postsByHand.push({ beamId: id, role: line.role, mine: own.length, added: xs.length - own.length });
      }
      const topIn = style === "dropped" ? joistBottomIn : joistTopIn;
      beams.push({
        id,
        y,
        lineY: line.y,
        zoneIds: line.segs.map((seg) => seg.zoneId),
        x0: line.x0,
        x1: line.x1,
        style,
        role: line.role,
        spec,
        tableSpanFt: spec.kind === "solid" ? dcaFt : group === "OC" ? ocFt : ircFt,
        table: spec.kind === "solid" ? "DCA6" : group === "OC" ? "OC" : "IRC",
        bothSides,
        maxSpanIn: pick.maxSpanIn,
        postXs,
        spanIn,
        endIn,
        bottomIn: topIn - spec.depthIn,
        ...(line.by ? { by: { kind: "line" as const, id: line.by } } : {}),
      });
      // Remember the strips for the posts' areas.
      strips.set(id, line.segs);
    }

    // THE ANGLED BEAMS under the corners cut at 45° (see CornerBeam): each the size of the beam whose end post it
    // shares, from that post back along the cut to a post of its own — no nearer the support behind than a foot.
    const cornerBeams: CornerBeam[] = [];
    const cornerEnds: Array<{ cb: CornerBeam; hostAt: "left" | "right" | null }> = [];
    cornerPlans.forEach((cp, n) => {
      const k = cp.clip;
      const hostBeam = cp.host ? beams.find((b) => Math.abs(b.lineY - cp.host!.y) < 0.5 && Math.abs(b.x0 - cp.host!.x0) < 0.5 && Math.abs(b.x1 - cp.host!.x1) < 0.5) ?? null : null;
      const spec = hostBeam?.spec ?? beamSpec(beamChoices[Math.min(1, beamChoices.length - 1)]);
      // From J, where the cut begins on the front beam's line, toward the deck's side — the joists over it hang the same
      // overhang past it as past the front beam.
      // (A cut as wide as its whole part: the front end stands a post's inset inside the part's far side, not on it.)
      const start = Math.max(0, k.c - Math.max(CORNER_POST_IN_IN, cp.wide - CORNER_POST_IN_IN));
      const reach = Math.min(k.c - CORNER_POST_IN_IN, cp.frontY - (cp.behind + 12)) - start;
      if (!(reach > 12)) return;
      const J = { x: k.x + k.dir * (k.c - start), y: cp.frontY - start };
      const K = { x: J.x - k.dir * reach, y: J.y - reach };
      const lengthIn = reach * Math.SQRT2;
      const maxSpanIn = hostBeam ? hostBeam.maxSpanIn : 0;
      const areaSqFt = Math.round(((k.c * ((cp.frontY - k.c / 2 - cp.behind) / 2 + cp.overIn)) / 144) * 10) / 10;
      const topIn = joistBottomIn;
      const cb: CornerBeam = { id: `c${n + 1}`, x0: J.x, y0: J.y, x1: K.x, y1: K.y, spec, lengthIn, maxSpanIn, bottomIn: topIn - spec.depthIn, hostBeamId: hostBeam?.id ?? null, areaSqFt, clip: k, overIn: cp.overIn, behindY: cp.behind };
      cornerBeams.push(cb);
      cornerEnds.push({ cb, hostAt: hostBeam ? (k.dir === 1 ? "left" : "right") : null });
    });

    // Posts and their footings. (The lower of two decks has none: each beam sits in a seat let into a post of the upper deck.)
    const posts: Post[] = [];
    const seats: DeckFrame["seats"] = [];
    for (const beam of beams) {
      if (follow) {
        for (const x of beam.postXs) seats.push({ beamId: beam.id, x, y: beam.y });
        continue;
      }
      const segs = strips.get(beam.id) ?? [];
      const areas = new Array<number>(beam.postXs.length).fill(0);
      for (const seg of segs) {
        // Each stretch of the beam between two posts is shared by them, nearer post more; a stretch past an end post is that post's.
        const marks = [seg.x0, ...beam.postXs.filter((p) => p > seg.x0 && p < seg.x1), seg.x1];
        for (let k = 0; k + 1 < marks.length; k++) {
          const u = marks[k];
          const v = marks[k + 1];
          const total = ((v - u) / 12) * seg.tributaryFt;
          const mid = (u + v) / 2;
          const right = beam.postXs.findIndex((p) => p >= v - 1e-6);
          if (right === 0) areas[0] += total;
          else if (right === -1) areas[beam.postXs.length - 1] += total;
          else {
            const span = beam.postXs[right] - beam.postXs[right - 1];
            areas[right - 1] += (total * (beam.postXs[right] - mid)) / span;
            areas[right] += (total * (mid - beam.postXs[right - 1])) / span;
          }
        }
      }
      // (The end post an angled beam shares carries half of what that beam does.)
      for (const ce of cornerEnds) if (ce.cb.hostBeamId === beam.id && areas.length) areas[ce.hostAt === "left" ? 0 : areas.length - 1] += ce.cb.areaSqFt / 2;
      // Under a beam that sits lower than the footings usually stand, the concrete stops under the beam.
      const topIn = Math.min(footingTopIn, Math.max(0, beam.bottomIn));
      beam.postXs.forEach((x, k) => {
        // On a post of the upper deck (a double deck's lower floor shaped on its own): a seat in it, not a post.
        if (opts.seatOn?.some((q) => Math.abs(q.x - x) <= SEAT_NEAR_IN && Math.abs(q.y - beam.y) <= SEAT_NEAR_IN)) {
          seats.push({ beamId: beam.id, x, y: beam.y });
          return;
        }
        const tributarySqFt = Math.round(areas[k] * carries * 10) / 10;
        // The ground under this post: a downhill post is taller, its footing deeper in the picture.
        const zg = groundAt(x, beam.y);
        const heightIn = Math.max(0, beam.bottomIn - (topIn + zg));
        const footing = footingFor(design, x, beam.y, tributarySqFt, design.framing.post, topIn);
        footing.groundIn = zg;
        posts.push({
          id: `${beam.id}p${k + 1}`,
          beamId: beam.id,
          x,
          y: beam.y,
          size: design.framing.post,
          heightIn,
          tributarySqFt,
          maxHeightIn: postMaxHeightIn(load, group, design.framing.post, tributarySqFt, beam.spec.plies),
          corner: k === 0 || k === beam.postXs.length - 1,
          ...(pinAt.has(`${beam.id}:${Math.round(x * 100)}`) ? { by: { kind: "pin" as const, id: pinAt.get(`${beam.id}:${Math.round(x * 100)}`) as string } } : {}),
          footing,
        });
      });
    }

    // The angled beams' own posts: at the side end of each, and at its front end where no beam's post is there to share.
    const cornerPostAt = new Map<string, string>();
    for (const { cb } of cornerEnds) {
      const ends = [...(cb.hostBeamId ? [] : [{ x: cb.x0, y: cb.y0, tag: "a" }]), { x: cb.x1, y: cb.y1, tag: "b" }];
      for (const e of ends) {
        const at = `${Math.round(e.x)}:${Math.round(e.y)}`;
        // (Two angled beams that meet in a point stand on one post there.)
        const shared = cornerPostAt.get(at);
        const tributarySqFt = Math.round((cb.areaSqFt / 2) * carries * 10) / 10;
        if (shared) {
          const q = posts.find((pp) => pp.id === shared);
          if (q) {
            q.tributarySqFt = Math.round((q.tributarySqFt + tributarySqFt) * 10) / 10;
            q.footing = { ...footingFor(design, q.x, q.y, q.tributarySqFt, design.framing.post, q.footing.topIn), groundIn: q.footing.groundIn };
          }
          continue;
        }
        if (follow) {
          seats.push({ beamId: cb.id, x: e.x, y: e.y });
          continue;
        }
        const topIn = Math.min(footingTopIn, Math.max(0, cb.bottomIn));
        const zg = groundAt(e.x, e.y);
        const footing = footingFor(design, e.x, e.y, tributarySqFt, design.framing.post, topIn);
        footing.groundIn = zg;
        const id = `${cb.id}p${e.tag}`;
        cornerPostAt.set(at, id);
        posts.push({ id, beamId: cb.id, x: e.x, y: e.y, size: design.framing.post, heightIn: Math.max(0, cb.bottomIn - (topIn + zg)), tributarySqFt, maxHeightIn: postMaxHeightIn(load, group, design.framing.post, tributarySqFt, cb.spec.plies), corner: false, footing });
      }
    }

    // A roof's posts (M2): a footing and a base each, the post itself drawn by the roof.
    for (const rp of opts.extraPosts ?? []) {
      const tributarySqFt = Math.round((rp.loadLb / (load + 10)) * 10) / 10;
      const footing = footingFor(design, rp.x, rp.y, tributarySqFt, rp.size, footingTopIn);
      footing.groundIn = groundAt(rp.x, rp.y);
      posts.push({
        id: rp.id,
        beamId: "roof",
        x: rp.x,
        y: rp.y,
        size: rp.size,
        heightIn: 0,
        tributarySqFt,
        maxHeightIn: postMaxHeightIn(load, group === "OC" ? (opts.extraPostsGroup ?? "DF") : group, rp.size, tributarySqFt),
        corner: false,
        footing,
        roof: true,
      });
    }

    const beamAt = (zoneId: Zone["id"], y: number) => beams.find((b) => Math.abs(b.lineY - y) < 0.6 && b.zoneIds.includes(zoneId));

    // ── Sticks ────────────────────────────────────────────────────────
    const sticks: Stick[] = [];
    const near = (bottomIn: number) => bottomIn < GROUND_CONTACT_WITHIN_IN;
    const joistGround = near(joistBottomIn);
    const hardware = { hangers: 0, doubleHangers: 0, ties: 0, postBases: 0, postCaps: 0, braces: 0, rimScrews: 0, lateralTies: 0, notchedPosts: 0, beamSeats: 0 };
    const tieAt: DeckFrame["tieAt"] = [];
    /** Braces the tables' layout would set that the contractor took out by hand. */
    let bracesLeftOut = 0;
    const rimPlies = (exposed: boolean) => (design.framing.doubleRim && exposed ? 2 : 1);

    // Joist positions: one at each side of the outline, the rest on the
    // spacing from the left side. A doubled outside joist gets a sister.
    const joists: JoistLine[] = [];
    const sideXs: Array<{ x: number; exposed: boolean; inward: 1 | -1 }> = [];
    for (const e of edges) {
      if (e.side !== "left" && e.side !== "right") continue;
      const inward = e.side === "left" ? 1 : -1;
      const x = e.x0 + inward * (THICK_2X_IN / 2);
      const seen = sideXs.find((s) => Math.abs(s.x - x) < 0.01);
      if (seen) seen.exposed = seen.exposed || !e.house;
      else sideXs.push({ x, exposed: !e.house, inward });
    }
    for (const s of sideXs) {
      const zone = zoneAt(zones, s.x);
      if (!zone) continue;
      joists.push({ x: s.x, zoneId: zone.id, edge: true, sister: false });
      if (design.framing.doubleRim && s.exposed) joists.push({ x: s.x + s.inward * THICK_2X_IN, zoneId: zone.id, edge: true, sister: true });
    }
    const width = Math.max(...zones.map((z) => z.x1));
    for (let x = spacingIn; x < width; x += spacingIn) {
      if (joists.some((j) => Math.abs(j.x - x) < 3)) continue;
      const zone = zoneAt(zones, x);
      if (zone) joists.push({ x, zoneId: zone.id, edge: false, sister: false });
    }
    // THE SPA SPOT: every joist under the tub's footprint is doubled —
    // a filled 7-footer reads near 100 psf against the table's 40, and
    // sistering is how a deck actually carries one. The sisters ride the
    // same spans, land in the counts, and the checks say the rule.
    const spaR = spaRectIn(design);
    if (spaR) {
      for (const j of [...joists]) {
        if (j.sister || j.x < spaR.x0 - 1 || j.x > spaR.x1 + 1) continue;
        const sx = j.x + THICK_2X_IN <= width - 1 ? j.x + THICK_2X_IN : j.x - THICK_2X_IN;
        if (joists.some((o) => Math.abs(o.x - sx) < 1)) continue;
        const zone = zoneAt(zones, sx);
        if (zone) joists.push({ x: sx, zoneId: zone.id, edge: false, sister: true });
      }
    }
    joists.sort((p, q) => p.x - q.x);

    // Each joist, cut to its rectangle's supports.
    for (const zf of plan.zones) {
      const z = zf.zone;
      const zoneBeams = zf.beamYs.map((y) => beamAt(z.id, y)).filter((b): b is Beam => !!b);
      const backBeam = zf.back === "beam" ? zoneBeams[0] : null;
      const frontBeam = zoneBeams[zoneBeams.length - 1];
      const middleBeams = zoneBeams.slice(backBeam ? 1 : 0, -1);
      const frontExposed = edges.some((e) => e.side === "front" && !e.house && Math.abs(e.y0 - z.y1) < 0.01 && e.x0 < z.x1 && e.x1 > z.x0);
      const backExposed = design.placement === "detached" || !!z.open;
      const frontRim = style === "dropped" ? rimPlies(frontExposed) * THICK_2X_IN : 0;
      const backRim = style === "dropped" && zf.back === "beam" ? rimPlies(backExposed) * THICK_2X_IN : 0;
      const start0 = zf.back === "ledger" ? z.y0 + THICK_2X_IN : style === "flush" && backBeam ? z.y0 + backBeam.spec.thickIn : z.y0 + backRim;
      const endStraight = style === "flush" && frontBeam ? z.y1 - frontBeam.spec.thickIn : z.y1 - frontRim;
      const mine = joists.filter((j) => j.zoneId === z.id);

      // (A free deck's bowed back — 2026-11-15: each joist runs on past the back beam to the arc.)
      const backBowed = backBowIn > 0 && zf.back === "beam" && style === "dropped";
      for (const j of mine) {
        // A shaped front cuts each joist to the arc or the clip (a rim's thickness back from it).
        const end = shaped && style === "dropped" ? frontAt(j.x, z.y1) - frontRim : endStraight;
        const start = backBowed ? start0 - sideBowAt(design.shape, "back", j.x) : start0;
        // Where this joist is cut: at every flush middle beam; over a dropped one only when it is longer than stock.
        let cuts: Array<[number, number]>;
        if (style === "flush") {
          cuts = [];
          let at = start;
          for (const b of middleBeams) {
            cuts.push([at, b.y - b.spec.thickIn / 2]);
            at = b.y + b.spec.thickIn / 2;
          }
          cuts.push([at, end]);
        } else cuts = splitRun(start, end, middleBeams.map((b) => b.y));
        for (const [u, v] of cuts) {
          if (!(v - u > 0.5)) continue;
          sticks.push({ role: "joist", nominal: joistSize, lengthIn: v - u, cx: j.x, cy: (u + v) / 2, cz: joistBottomIn + joistDepth / 2, sx: THICK_2X_IN, sy: v - u, sz: joistDepth, ground: joistGround, of: z.id });
        }
        if (j.sister) continue;
        const doubled = mine.some((o) => o.sister && Math.abs(Math.abs(o.x - j.x) - THICK_2X_IN) < 0.01);
        const hang = (n: number) => {
          if (doubled) hardware.doubleHangers += n;
          else hardware.hangers += n;
        };
        // Hangers: at the ledger, and at both faces of every flush beam it meets.
        if (zf.back === "ledger") hang(1);
        if (style === "flush") hang((backBeam ? 1 : 0) + 1 + 2 * middleBeams.length);
        else {
          // A tie where the joist really sits on a beam: one that runs under it, that it reaches — and the angled beam
          // under a corner cut at 45°, where it crosses that.
          const n: 1 | 2 = doubled ? 2 : 1;
          const tie = (y: number) => {
            // (Where a front beam ends and the angled beam under the cut starts — the two share a post — a joist there
            // sits on both at one spot: one tie, drawn and counted once.)
            if (tieAt.some((t) => Math.abs(t.x - j.x) < 0.01 && Math.abs(t.y - y) < 4)) return;
            hardware.ties += n;
            tieAt.push({ x: j.x, y, n });
          };
          for (const b of zoneBeams) if (j.x >= b.x0 - 0.5 && j.x <= b.x1 + 0.5 && end >= b.y - b.spec.thickIn / 2 && start <= b.y + b.spec.thickIn / 2) tie(b.y);
          for (const cb of cornerBeams) {
            if (Math.abs(cb.x1 - cb.x0) < 1 || j.x < Math.min(cb.x0, cb.x1) - 0.5 || j.x > Math.max(cb.x0, cb.x1) + 0.5) continue;
            const y = cb.y0 + ((j.x - cb.x0) / (cb.x1 - cb.x0)) * (cb.y1 - cb.y0);
            if (y >= z.y0 && y <= z.y1 && end >= y - cb.spec.thickIn / 2 && start <= y) tie(y);
          }
        }
      }

      // Rim boards across the joist ends (a flush beam is its own rim).
      if (style === "dropped") {
        const joistXs = mine.map((j) => j.x);
        const rim = (yFace: number, plies: number, dir: 1 | -1) => {
          for (let p = 0; p < plies; p++) {
            for (const [u, v] of splitRun(z.x0, z.x1, joistXs)) {
              sticks.push({ role: "rim", nominal: joistSize, lengthIn: v - u, cx: (u + v) / 2, cy: yFace + dir * (p + 0.5) * THICK_2X_IN, cz: joistBottomIn + joistDepth / 2, sx: v - u, sy: THICK_2X_IN, sz: joistDepth, ground: joistGround, of: z.id });
            }
          }
          hardware.rimScrews += 3 * mine.length;
        };
        if (shaped) {
          // The front rim follows the outline: short straight pieces along a clip or around the bow (bent plies), laid
          // INSIDE it, against the joist ends cut a rim's thickness back (2026-10-11). The ring runs counter-clockwise in
          // plan, so the deck is on each edge's left (lib/deck/ringEdges): the plies were laid outside the outline — the
          // fascia then sat in their plane and the 3D flickered — and the right side, whose edge joist is its rim (as on
          // the left), took a rim of its own besides.
          const plies = rimPlies(frontExposed);
          for (const e of ringEdges(shapeOutline(design.shape))) {
            if (design.shape.kind === "wall") {
              // A deck in parts (2026-11-14): this rectangle's own front and its cuts — not its back (wherever the wall
              // puts it), nor another part's front.
              const mx = (e.A.x + e.B.x) / 2;
              if (!(mx > z.x0 - 0.01 && mx <= z.x1 - 0.01)) continue;
              if (Math.abs(e.A.y - z.y0) < 0.5 && Math.abs(e.B.y - z.y0) < 0.5) continue;
            } else if (e.A.y < 0.5 && e.B.y < 0.5 && !(backBowed && (e.A.y < -0.5 || e.B.y < -0.5))) continue;
            if (Math.abs(e.ux) < 1e-6) continue;
            if (e.length < 1) continue;
            const curved = front?.kind === "curve" && !(Math.abs(e.A.y - z.y1) < 0.01 && Math.abs(e.B.y - z.y1) < 0.01 && Math.abs(e.uy) < 1e-6);
            // A BOWED SIDE (2026-11-15) leaves the deck's own side line at an angle: its first and last pieces stop
            // where they clear the outside joist (and its sister) — laid to the corner they lay across the joist's top.
            const onSide = (q: { x: number; y: number }) => (q.x < z.x0 + 0.01 ? -1 : q.x > z.x1 - 0.01 ? 1 : 0);
            const sideOf = onSide(e.A) !== 0 && onSide(e.A) === onSide(e.B) && design.shape.kind === "rect" ? onSide(e.A) : 0;
            const clear = sideOf !== 0 ? (plies * THICK_2X_IN * Math.abs(e.outX) + (design.framing.doubleRim ? 0 : THICK_2X_IN)) / Math.max(0.05, Math.abs(e.ux)) + 0.25 : 0;
            const edgeX = sideOf < 0 ? z.x0 : z.x1;
            const from = sideOf !== 0 && Math.abs(e.A.x - edgeX) < 0.01 ? Math.min(clear, e.length) : 0;
            const to = e.length - (sideOf !== 0 && Math.abs(e.B.x - edgeX) < 0.01 ? Math.min(clear, e.length) : 0);
            if (to - from < 1) continue;
            const mid = (from + to) / 2;
            for (let p = 0; p < plies; p++) {
              const off = (p + 0.5) * THICK_2X_IN;
              sticks.push({ role: "rim", nominal: joistSize, lengthIn: to - from, cx: e.A.x + e.ux * mid - e.outX * off, cy: e.A.y + e.uy * mid - e.outY * off, cz: joistBottomIn + joistDepth / 2, sx: to - from, sy: THICK_2X_IN, sz: joistDepth, ground: joistGround, of: z.id, yaw: e.yaw, curved });
            }
          }
          hardware.rimScrews += 3 * mine.length;
        } else rim(z.y1, rimPlies(frontExposed), -1);
        if (zf.back === "beam" && !backBowed) rim(z.y0, rimPlies(backExposed), 1);
      }
    }

    // Ledgers: one board along each house face a rectangle hangs on.
    const ledgers: LedgerRun[] = [];
    const ledgerNominal = `2x${Math.max(8, Number(joistSize.slice(2)))}`;
    const ledgerDepth = DRESSED_DEPTH_IN[Math.max(8, Number(joistSize.slice(2)))];
    if (attached) {
      const runs: Array<{ y: number; x0: number; x1: number; spanFt: number }> = [];
      for (const zf of [...plan.zones].sort((p, q) => p.zone.y0 - q.zone.y0 || p.zone.x0 - q.zone.x0)) {
        if (zf.back !== "ledger") continue;
        const spanFt = zf.spansIn[0] / 12;
        const m = runs.find((r) => Math.abs(r.y - zf.zone.y0) < 0.01 && Math.abs(r.x1 - zf.zone.x0) < 0.01);
        if (m) {
          m.x1 = zf.zone.x1;
          m.spanFt = Math.max(m.spanFt, spanFt);
        } else runs.push({ y: zf.zone.y0, x0: zf.zone.x0, x1: zf.zone.x1, spanFt });
      }
      const joistXs = joists.map((j) => j.x);
      for (const r of runs) {
        const { spacingIn: sp, rule } = ledgerSpacingIn({ load, fastener: design.ledger.fastener, joistSpanFt: r.spanFt, rim: wall.rim, hemFirLedger: species.hemFir === true });
        const lengthIn = r.x1 - r.x0;
        const pieces = splitRun(r.x0, r.x1, joistXs);
        // One at each end of every board, and the table's spacing between.
        const fasteners = sp > 0 ? pieces.reduce((a, [u, v]) => a + Math.max(2, Math.ceil((v - u - 4) / sp) + 1), 0) : 0;
        ledgers.push({ y: r.y, x0: r.x0, x1: r.x1, lengthIn, joistSpanFt: r.spanFt, spacingIn: sp, rule, fasteners });
        for (const [u, v] of pieces) sticks.push({ role: "ledger", nominal: ledgerNominal, lengthIn: v - u, cx: (u + v) / 2, cy: r.y + THICK_2X_IN / 2, cz: joistTopIn - ledgerDepth / 2, sx: v - u, sy: THICK_2X_IN, sz: ledgerDepth, ground: true });
      }
      hardware.lateralTies = design.ledger.lateral === "four" ? 4 : 2;
    }

    // Beams and posts as lumber.
    for (const b of beams) {
      const topIn = b.bottomIn + b.spec.depthIn;
      for (let p = 0; p < b.spec.plies; p++) {
        const ply = b.spec.kind === "solid" ? THICK_4X_IN : THICK_2X_IN;
        const cy = b.y - b.spec.thickIn / 2 + (p + 0.5) * ply;
        for (const [u, v] of splitRun(b.x0, b.x1, b.postXs)) {
          sticks.push({ role: "beam", nominal: b.spec.stock, lengthIn: v - u, cx: (u + v) / 2, cy, cz: topIn - b.spec.depthIn / 2, sx: v - u, sy: ply, sz: b.spec.depthIn, ground: true, of: b.id });
        }
      }
    }
    // …the angled beams: their plies side by side along the cut, a hand's breadth clear of the front beam's end.
    for (const cb of cornerBeams) {
      const ux = (cb.x1 - cb.x0) / cb.lengthIn;
      const uy = (cb.y1 - cb.y0) / cb.lengthIn;
      // (Clear of whatever else stands on its front post: the front beam's end, or the other angled beam of a point.)
      const met = cb.hostBeamId !== null || cornerBeams.some((o) => o !== cb && Math.abs(o.x0 - cb.x0) < 0.5 && Math.abs(o.y0 - cb.y0) < 0.5);
      const from = met ? cb.spec.thickIn / 2 + 0.25 : -CORNER_BEAM_PAST_IN;
      const len = cb.lengthIn + CORNER_BEAM_PAST_IN - from;
      const mid = from + len / 2;
      const ply = cb.spec.kind === "solid" ? THICK_4X_IN : THICK_2X_IN;
      for (let p = 0; p < cb.spec.plies; p++) {
        const off = -cb.spec.thickIn / 2 + (p + 0.5) * ply;
        sticks.push({ role: "beam", nominal: cb.spec.stock, lengthIn: len, cx: cb.x0 + ux * mid - uy * off, cy: cb.y0 + uy * mid + ux * off, cz: cb.bottomIn + cb.spec.depthIn / 2, sx: len, sy: ply, sz: cb.spec.depthIn, ground: true, of: cb.id, yaw: Math.atan2(uy, ux) });
      }
    }
    hardware.beamSeats = seats.length;
    for (const p of posts) {
      const [w, d] = POST_ACTUAL_IN[p.size];
      hardware.postBases += 1;
      if (p.roof) continue;
      // A beam that sits right on its footing needs the base, no post and no cap. Over OC posts a 2-ply beam sits in a
      // notch cut in the post and is screwed to it; a 3-ply one sits on top in a cap (the installation guide, step 4).
      if (p.heightIn >= 1) {
        const plies = beams.find((b) => b.id === p.beamId)?.spec.plies ?? 3;
        if (composite && plies === 2) hardware.notchedPosts += 1;
        else hardware.postCaps += 1;
        sticks.push({ role: "post", nominal: p.size, lengthIn: p.heightIn, cx: p.x, cy: p.y, cz: p.footing.groundIn + p.footing.topIn + p.heightIn / 2, sx: w, sy: d, sz: p.heightIn, ground: true, of: p.beamId });
      }
    }

    // Blocking: over every dropped beam the joists run past (AWC's guide
    // and R507.6.2: a bearing needs something to stop the joists rolling),
    // rows the decking's maker requires, and mid-span rows when asked for.
    const blockingRows: DeckFrame["blockingRows"] = [];
    for (const zf of plan.zones) {
      const z = zf.zone;
      const rows: Array<{ y: number; why: "beam" | "mid-span" | "maker" | "curve" }> = [];
      if (style === "dropped") {
        zf.beamYs.forEach((y, i) => {
          const isBack = zf.back === "beam" && i === 0;
          const isFront = i === zf.beamYs.length - 1;
          const runsPast = isFront ? zf.frontCantIn > 0.5 : isBack ? zf.backCantIn > 0.5 : true;
          if (runsPast) rows.push({ y, why: "beam" });
        });
      }
      // Under a bowed front every bay is blocked midway out to the arc (the border's bearing).
      if (front?.kind === "curve" && bulgeIn > 0 && style === "dropped") rows.push({ y: zf.beamYs[zf.beamYs.length - 1] + (z.y1 + bulgeIn - zf.beamYs[zf.beamYs.length - 1]) / 2, why: "curve" });
      const supports = [zf.back === "ledger" ? z.y0 + THICK_2X_IN : zf.beamYs[0], ...(zf.back === "ledger" ? zf.beamYs : zf.beamYs.slice(1))];
      for (let i = 0; i + 1 < supports.length; i++) {
        const span = supports[i + 1] - supports[i];
        // Rows the decking's maker asks for, and OC framing's own: blocking every 4 to 5 ft.
        const rowsEvery = Math.min(decking.blockingRowsMaxFt ?? Infinity, composite ? OC_BLOCKING_MAX_FT : Infinity);
        const makerRows = Number.isFinite(rowsEvery) ? Math.max(0, Math.ceil(span / (rowsEvery * 12) - 1e-9) - 1) : 0;
        const midRows = design.framing.blocking === "mid-span" && span > 96 ? 1 : 0;
        const n = Math.max(makerRows, midRows);
        for (let k = 1; k <= n; k++) rows.push({ y: supports[i] + (span * k) / (n + 1), why: makerRows >= midRows && makerRows > 0 ? "maker" : "mid-span" });
      }
      const xs = joists.filter((j) => j.zoneId === z.id).map((j) => j.x);
      for (const row of rows) {
        let pieces = 0;
        for (let i = 0; i + 1 < xs.length; i++) {
          const gap = xs[i + 1] - xs[i] - THICK_2X_IN;
          if (gap < 3) continue;
          if (shaped && row.y > Math.min(frontAt(xs[i], z.y1), frontAt(xs[i + 1], z.y1)) - 2) continue;
          pieces += 1;
          sticks.push({ role: "blocking", nominal: joistSize, lengthIn: gap, cx: (xs[i] + xs[i + 1]) / 2, cy: row.y, cz: joistBottomIn + joistDepth / 2, sx: gap, sy: THICK_2X_IN, sz: joistDepth, ground: joistGround, of: z.id });
        }
        if (pieces) blockingRows.push({ y: row.y, zoneId: z.id, pieces, why: row.why });
      }
    }

    // Knee braces at the end posts of each beam, where the post is tall
    // enough. A deck on the house is braced along its beams; one that
    // stands free is braced the other way as well.
    // ONE BY ONE (2026-11-09 — owner: "somebody doesn't want those braces: you just click it and delete"): a brace
    // taken out in the 3D is left out by its key — its beam, which end, which way it leans (`deckBraceKey`).
    const bracesOff = new Set(design.framing.bracesOff);
    // The braces' timber (2026-11-14): the 2x4 they always were, or the builder's 4x4, 6x6 or 8x8 — never larger than the post.
    const braceNominal = composite ? "2x4" : braceSizeFor(design.framing.braceSize, design.framing.post, "2x4");
    const braceThick = BRACE_ACTUAL_IN[braceNominal][0];
    if (design.framing.braces) {
      for (const b of beams) {
        const ends = posts.filter((p) => p.beamId === b.id && p.corner);
        if (ends.length < 2) continue;
        for (const [k, p] of ends.entries()) {
          if (p.heightIn <= BRACE_ABOVE_IN) continue;
          const along: 1 | -1 = k === 0 ? 1 : -1;
          const z = b.bottomIn - BRACE_LEG_IN / 2;
          const len = Math.round(BRACE_LEG_IN * Math.SQRT2);
          if (bracesOff.has(deckBraceKey(b.id, k, "x"))) bracesLeftOut += 1;
          else {
            sticks.push({ role: "brace", nominal: braceNominal, lengthIn: len, cx: p.x + (along * BRACE_LEG_IN) / 2, cy: p.y, cz: z, sx: BRACE_LEG_IN, sy: braceThick, sz: BRACE_LEG_IN, ground: false, lean: { axis: "x", dir: along }, of: deckBraceKey(b.id, k, "x") });
            hardware.braces += 1;
          }
          if (freeStanding && style === "dropped") {
            // The other way there is no beam to brace to: the brace runs from the post up to the underside of the
            // outside joist at the deck's edge, legs equal so it stays at 45° — and only where the joists reach past
            // the beam far enough for a real leg (owner, 2026-10-10: a brace that ends in the air "looks disconnected").
            const out: 1 | -1 = b.role === "front" ? 1 : -1;
            const edgeY = out === 1 ? Math.max(...zones.map((zn) => zn.y1)) : Math.min(...zones.map((zn) => zn.y0));
            const leg = Math.min(BRACE_LEG_IN, Math.abs(edgeY - p.y));
            if (leg >= 12 && bracesOff.has(deckBraceKey(b.id, k, "y"))) bracesLeftOut += 1;
            else if (leg >= 12) {
              const cz2 = joistBottomIn - leg / 2;
              sticks.push({ role: "brace", nominal: braceNominal, lengthIn: Math.round(leg * Math.SQRT2), cx: p.x, cy: p.y + (out * leg) / 2, cz: cz2, sx: braceThick, sy: leg, sz: leg, ground: false, lean: { axis: "y", dir: out }, of: deckBraceKey(b.id, k, "y") });
              hardware.braces += 1;
            }
          }
        }
      }
    }

    // THE SIDES AND THE BACK, BOWED (2026-11-15; see DeckFrame.sideBows). A side's bulge is framed the way a bowed front
    // is, turned a quarter: short joists square to the side — hung on the deck's outside joist, which is doubled for
    // them — cut to the arc, the bent rim across their ends (laid with the front's, above). A bow of 2 ft or less they
    // carry as lookouts; under a deeper one a beam on two posts runs parallel to the side, a third of the bow (8 to
    // 18 in.) back from its middle, as long as the bow reaches a hand past it.
    const sideBows: DeckFrame["sideBows"] = [];
    if (design.shape.kind === "rect" && style === "dropped") {
      const bows = shapeBows(design.shape);
      const Wd = Math.round(design.shape.widthFt * 12);
      const Dd = Math.round(design.shape.depthFt * 12);
      const zc = joistBottomIn + joistDepth / 2;
      for (const side of ["left", "right"] as const) {
        const bow = Math.round(bows[side] * 12);
        if (!(bow > 0)) continue;
        const out = side === "left" ? -1 : 1;
        const edgeX = side === "left" ? 0 : Wd;
        const rimT = rimPlies(true) * THICK_2X_IN;
        // The outside joist doubled: where the rim is not doubled already, a sister on its yard side.
        const sistered = !design.framing.doubleRim;
        if (sistered) {
          // (A quarter inch short at each end: its end faces lie in no face of the outside joist's hanger or of the rim.)
          for (const st of sticks.filter((q) => q.role === "joist" && Math.abs(q.cx - (edgeX - out * (THICK_2X_IN / 2))) < 0.01)) sticks.push({ ...st, cx: edgeX + out * (THICK_2X_IN / 2), sy: st.sy - 0.5, lengthIn: st.lengthIn - 0.5 });
        }
        const face = edgeX + (sistered ? out * THICK_2X_IN : 0);
        const inset = sistered ? THICK_2X_IN : 0;
        // The beam under a deep bow.
        let beam: DeckFrame["sideBows"][number]["beam"] = null;
        if (bow > 24) {
          const cant = Math.min(18, Math.max(8, Math.round(bow / 3)));
          const xb = bow - cant;
          const R = (Dd / 2) ** 2 / (2 * bow) + bow / 2;
          const halfLen = Math.sqrt(Math.max(0, R * R - (R - bow + xb + 6) ** 2));
          const spec = [...beams].sort((a, b) => b.y - a.y)[0]?.spec ?? beamSpec(beamChoices[Math.min(1, beamChoices.length - 1)]);
          if (halfLen >= 12) {
            const bx = edgeX + out * xb;
            const y0 = Dd / 2 - halfLen;
            const y1 = Dd / 2 + halfLen;
            const id = `bow-${side}`;
            const ply = spec.kind === "solid" ? THICK_4X_IN : THICK_2X_IN;
            for (let p = 0; p < spec.plies; p++) sticks.push({ role: "beam", nominal: spec.stock, lengthIn: y1 - y0, cx: bx - spec.thickIn / 2 + (p + 0.5) * ply, cy: Dd / 2, cz: joistBottomIn - spec.depthIn / 2, sx: ply, sy: y1 - y0, sz: spec.depthIn, ground: true, of: id });
            // Half the bulge's floor rests on the beam: a quarter on each post.
            const tributarySqFt = Math.round((((2 / 3) * bow * Dd) / 144 / 4) * carries * 10) / 10;
            const bottomIn = joistBottomIn - spec.depthIn;
            [y0 + 6, y1 - 6].forEach((y, k) => {
              if (follow) {
                seats.push({ beamId: id, x: bx, y });
                return;
              }
              const topIn = Math.min(footingTopIn, Math.max(0, bottomIn));
              const zg = groundAt(bx, y);
              const footing = footingFor(design, bx, y, tributarySqFt, design.framing.post, topIn);
              footing.groundIn = zg;
              const heightIn = Math.max(0, bottomIn - (topIn + zg));
              posts.push({ id: `${id}p${k + 1}`, beamId: id, x: bx, y, size: design.framing.post, heightIn, tributarySqFt, maxHeightIn: postMaxHeightIn(load, group, design.framing.post, tributarySqFt, spec.plies), corner: false, footing });
              const [pw, pd] = POST_ACTUAL_IN[design.framing.post];
              hardware.postBases += 1;
              if (heightIn >= 1) {
                hardware.postCaps += 1;
                sticks.push({ role: "post", nominal: design.framing.post, lengthIn: heightIn, cx: bx, cy: y, cz: zg + topIn + heightIn / 2, sx: pw, sy: pd, sz: heightIn, ground: true, of: id });
              }
            });
            beam = { x: bx, y0, y1, size: String(spec.size), cantIn: cant };
          }
        }
        // The outriggers: at the joists' own spacing out from the house, each from the doubled joist's face to a
        // rim's thickness short of the arc.
        let count = 0;
        let longest = 0;
        for (let y = spacingIn; y < Dd - 1; y += spacingIn) {
          const len = sideBowAt(design.shape, side, y) - rimT - inset;
          if (len < 3) continue;
          sticks.push({ role: "joist", nominal: joistSize, lengthIn: len, cx: face + (out * len) / 2, cy: y, cz: zc, sx: len, sy: THICK_2X_IN, sz: joistDepth, ground: joistGround, of: zones[0]?.id ?? "a" });
          hardware.hangers += 1;
          if (beam && y >= beam.y0 && y <= beam.y1) hardware.ties += 1;
          count += 1;
          longest = Math.max(longest, len);
        }
        hardware.rimScrews += 3 * count;
        sideBows.push({ side, bowIn: bow, outriggers: count, longestIn: Math.round(longest), beam });
      }
      if (backBowIn > 0) {
        const zf = plan.zones[0];
        const firstFt = (zf?.spansIn[0] ?? 0) / 12;
        sideBows.push({ side: "back", bowIn: backBowIn, outriggers: 0, longestIn: 0, beam: null, cantIn: Math.round((zf?.backCantIn ?? 0) + backBowIn), cantMaxIn: Math.round(joistMaxCantileverIn(load, group, joistSize, firstFt)) });
      }
    }

    return {
      design,
      species,
      decking,
      wall,
      group,
      load,
      zones: plan.zones,
      edges,
      areaSqFt: shapeAreaSqFt(design.shape),
      openEdgeFt: edges.filter((e) => !e.house).reduce((a, e) => a + e.lengthIn, 0) / 12,
      houseEdgeFt: edges.filter((e) => e.house).reduce((a, e) => a + e.lengthIn, 0) / 12,
      joistSize,
      spacingIn,
      deckingMaxSpacingIn,
      beamStyle: style,
      beamKind,
      beamKindNote,
      postsByHand,
      pinsNotSet,
      beamsByHand,
      beamLinesNotSet,
      carries,
      hung: !!follow || seats.length > 0,
      seats,
      cornerBeams,
      tieAt,
      surfaceIn,
      joistTopIn,
      joistBottomIn,
      footingTopIn,
      joists,
      beams,
      posts,
      ledgers,
      sticks,
      hardware,
      blockingRows,
      frontExtraCantIn: bulgeIn,
      sideBows,
      groundHighIn,
      groundLowIn,
      flags: { tooLow, droppedDoesNotFit, joistBeyondTable: !plan.inside, beamBeyondTable: beyond },
      bracesLeftOut,
    };
  };

  // A shaped front needs a beam under the joists: they run past it to the arc or the clip.
  if (follow) return attempt(follow.beamStyle, false) as DeckFrame;
  const style = shaped ? (design.framing.beamStyle === "flush" ? "dropped" : design.framing.beamStyle) : design.framing.beamStyle;
  if (style === "auto") {
    const dropped = attempt("dropped", true);
    if (dropped) return dropped;
    return attempt("flush", false) as DeckFrame;
  }
  return attempt(style, false) as DeckFrame;
}
