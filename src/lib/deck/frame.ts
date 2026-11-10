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
  type SpacingIn,
  type SpeciesGroup,
} from "./codeTables";
import { deckingProduct, framingSpecies, wallType, type DeckingProduct, type FramingSpecies, type WallType } from "./catalog";
import { BUILT_UP_CHOICES, frontEdgeAt, isSolidBeam, normalizeDeckDesign, shapeAreaSqFt, shapeEdges, shapeOutline, shapeZones, type BeamKind, type BeamSize, type BeamStyle, type DeckDesign, type DeckEdge, type Zone, spaRectIn } from "./design";
import { ringEdges } from "./ringEdges";
import { deckingLook, deckingNamed } from "./deckingColors";
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
/** The default overhang past the outer beam: a fifth of the depth, to the half foot, 2 ft at most. */
export function autoOverhangIn(depthIn: number): number {
  return Math.min(24, Math.floor(depthIn / 5 / 6) * 6);
}
/** A precast pier block: 12 in. square at the base, its top about 7 in. above the ground. */
export const PIER_BLOCK = { baseIn: 12, topIn: 7 } as const;
/** Form tubes as they are sold, inches across. */
const TUBE_SIZES_IN = [8, 10, 12, 14, 16, 18, 20, 22, 24, 28, 30, 36] as const;
/** The pier under each post size: wide enough for the post and its base. */
const PIER_FOR_POST_IN: Record<PostSize, number> = { "4x4": 8, "4x6": 10, "6x6": 12, "8x8": 14 };
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
  table: "IRC" | "DCA6";
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
  footing: Footing;
  /** A roof's post (M2): it runs from its own footing up through the deck; the roof draws the post, the deck only its footing and base. */
  roof?: boolean;
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
  group: SpeciesGroup;
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
  };
  /** Rows of blocking: where, and how many pieces. */
  blockingRows: Array<{ y: number; zoneId: Zone["id"]; pieces: number; why: "beam" | "mid-span" | "maker" | "curve" }>;
  /** The front's shape (M3): the extra the bow hangs past the straight overhang at its middle, inches; the ground's fall under the deck. */
  frontExtraCantIn: number;
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
  /** The ground's height under a point of the plan, inches (M3: the site's slope). Flat when left out. */
  groundAt?: (x: number, y: number) => number;
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

/** The supports of one rectangle for an overhang `cIn` (to the beam's centre) and `middle` beams between. */
function layoutZone(zone: Zone, back: "ledger" | "beam", cIn: number, middle: number): Omit<ZoneFrame, "ok"> {
  const c = Math.max(cIn, BEARING_HALF_IN);
  const front = zone.y1 - c;
  const beamYs: number[] = [];
  let start: number;
  let face: number;
  if (back === "ledger") {
    start = zone.y0 + THICK_2X_IN;
    face = start;
  } else {
    start = zone.y0 + c;
    beamYs.push(start);
    face = start + BEARING_HALF_IN;
  }
  for (let i = 1; i <= middle; i++) beamYs.push(Math.round(start + ((front - start) * i) / (middle + 1)));
  beamYs.push(front);
  const spansIn: number[] = [];
  for (const y of back === "ledger" ? beamYs : beamYs.slice(1)) {
    spansIn.push(y - BEARING_HALF_IN - face);
    face = y + BEARING_HALF_IN;
  }
  return { zone, back, beamYs, spansIn, backCantIn: back === "beam" ? c - BEARING_HALF_IN : 0, frontCantIn: c - BEARING_HALF_IN };
}

/** Inside the joist table; with a beam style, also every beam it lands on inside a beam table. */
function zoneInsideTable(l: Omit<ZoneFrame, "ok">, size: JoistSize, spacing: SpacingIn, group: SpeciesGroup, load: LoadPsf, extraFrontIn = 0, beamsOf: BeamStyle | null = null): boolean {
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
}

/**
 * The supports of every rectangle for one joist size: the fewest middle
 * beams, then the overhang nearest the one asked for. One overhang for the
 * whole deck, so the beams of two rectangles that share a front line up.
 */
function planJoists(zones: Zone[], backs: Array<"ledger" | "beam">, style: BeamStyle, size: JoistSize, spacing: SpacingIn, group: SpeciesGroup, load: LoadPsf, overhang: number | "auto", extraFrontIn = 0): JoistPlan {
  const shallow = Math.min(...zones.map((z) => z.y1 - z.y0));
  const want = style === "flush" ? 0 : overhang === "auto" ? autoOverhangIn(shallow) : Math.round(overhang * 12);
  // A bowed front hangs farther at its middle: the beam comes in until the whole bow is inside the table.
  const tries = style === "flush" ? [want] : overhang !== "auto" && extraFrontIn === 0 ? [want] : overhangTries(want);
  // The fewest middle beams with the joists AND every beam inside their tables; failing that (a bow can ask more
  // cantilever than a short last span allows), the joists inside as before and the beam said as past its table.
  const search = (withBeams: boolean): JoistPlan | null => {
    let found0: JoistPlan | null = null;
    for (const c of tries) {
      const fitted: ZoneFrame[] = [];
      let total = 0;
      let all = true;
      zones.forEach((zone, i) => {
        let found: ZoneFrame | null = null;
        for (let k = 0; k <= MAX_MIDDLE_BEAMS && !found; k++) {
          const l = layoutZone(zone, backs[i], c, k);
          if (zoneInsideTable(l, size, spacing, group, load, extraFrontIn, withBeams ? style : null)) {
            found = { ...l, ok: true };
            total += k;
          }
        }
        if (found) fitted.push(found);
        else all = false;
      });
      if (all && (!found0 || total < found0.middle)) found0 = { size, zones: fitted, middle: total, inside: true, beamsInside: withBeams };
      if (found0 && found0.middle === 0) break;
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
    let l = layoutZone(zone, backs[i], want, 0);
    for (let k = 1; k <= MAX_MIDDLE_BEAMS && l.spansIn.some((s) => s > max); k++) l = layoutZone(zone, backs[i], want, k);
    middle += l.beamYs.length - (backs[i] === "beam" ? 2 : 1);
    return { ...l, ok: zoneInsideTable(l, size, spacing, group, load, extraFrontIn) };
  });
  return { size, zones: drawn, middle, inside: false, beamsInside: false };
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

interface BeamLine {
  zoneId: Zone["id"];
  y: number;
  x0: number;
  x1: number;
  role: Beam["role"];
  /** The joist span the IRC table is entered with (effective), and the one AWC's is (real). */
  ircFt: number;
  dcaFt: number;
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
    if (isBack) return { zoneId: z.zone.id, y, x0: z.zone.x0, x1: z.zone.x1, role: "back", ircFt: effectiveJoistSpanFt(spans[0], z.backCantIn / 12), dcaFt: spans[0], tributaryFt: share, bothSides: false };
    if (isFront) return { zoneId: z.zone.id, y, x0: z.zone.x0, x1: z.zone.x1, role: "front", ircFt: effectiveJoistSpanFt(lastSpan, z.frontCantIn / 12), dcaFt: lastSpan, tributaryFt: share, bothSides: false };
    const eff = effectiveSpanFromTributaryFt(whole[i + offset] / 12);
    return { zoneId: z.zone.id, y, x0: z.zone.x0, x1: z.zone.x1, role: "middle", ircFt: eff, dcaFt: eff, tributaryFt: share, bothSides: true };
  });
}

interface MergedLine {
  y: number;
  x0: number;
  x1: number;
  role: Beam["role"];
  segs: BeamLine[];
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
    } else out.push({ y: l.y, x0: l.x0, x1: l.x1, role: l.role, segs: [l] });
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
  const decking: DeckingProduct = { ...decking0, label: deckingNamed(design.custom.decking ? design.custom.decking.name : decking0.label, look.name), color: look.hex, ...(look.name ? { colorName: look.name } : {}), ...(look.hex2 ? { color2: look.hex2 } : {}) };
  const wall = wallType(design.wall);
  const group = species.group;
  const load = design.loadPsf;
  const zones = shapeZones(design.shape);
  const edges = shapeEdges(design.shape, design.placement);
  const attached = design.placement === "attached";
  const freeStanding = !attached;

  const deckingMaxSpacingIn = design.decking.pattern !== "straight" ? decking.maxSpacingIn.diagonal : decking.maxSpacingIn.square;
  // The front's shape (M3) and the ground under the deck.
  const front = design.shape.kind === "rect" ? design.shape.front : undefined;
  const shaped = !!front && front.kind !== "straight";
  const bulgeIn = front?.kind === "curve" ? Math.round(front.bulgeFt * 12) : 0;
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
  const backs: Array<"ledger" | "beam"> = zones.map(() => (attached ? "ledger" : "beam"));

  // Joist sizes to try: the one asked for, or the smallest that both fits
  // under the deck and spans. A 2x6 is offered only where a 2x8 will not fit.
  const sizes: JoistSize[] = design.framing.joist !== "auto" ? [design.framing.joist] : fits("2x8") ? JOIST_SIZES.filter((s) => s !== "2x6" && fits(s)) : ["2x6"];

  const beamKindAsked = design.framing.beamKind;
  const solidOk = solidBeamTabulated(load, group);
  const beamKind: BeamKind = beamKindAsked === "solid" && !solidOk ? "built-up" : beamKindAsked;
  const beamKindNote =
    beamKindAsked === "solid" && !solidOk
      ? group === "SP"
        ? "Solid 4x beams have no printed span table for Southern pine — beams are built up from 2x lumber, which the code tabulates."
        : `Solid 4x beams are tabulated for the 40 psf load only — at ${load} psf the beams are built up from 2x lumber, which the code tabulates.`
      : null;
  const askedBeam = design.framing.beam !== "auto" && (isSolidBeam(design.framing.beam) ? beamKind === "solid" : beamKind === "built-up") ? design.framing.beam : null;
  const beamChoices: BeamSize[] = askedBeam ? [askedBeam] : beamKind === "solid" ? [...SOLID_BEAMS] : [...BUILT_UP_CHOICES];

  const price = (key: string) => deckRate(key, opts.rates, opts.market).price;
  const postSetCost = price("labor.footing") + 4 * price("conc.bag") + price("hw.postBase") + price("hw.postCap") + 3 * price(lumberKey(design.framing.post));

  /** The strips of deck each beam carries, kept for its posts' areas. */
  const strips = new Map<string, BeamLine[]>();

  /** One whole frame for a beam style; null when a dropped beam cannot fit and the style is the engine's to choose. */
  const attempt = (style: BeamStyle, mayFail: boolean): DeckFrame | null => {
    strips.clear();
    let plan: JoistPlan | null = null;
    for (const size of sizes) {
      const p = planJoists(zones, backs, style, size, spacingIn, group, load, design.framing.overhangFt, bulgeIn);
      // Inside both tables beats inside the joist table alone beats neither; then the fewest middle beams.
      const rank = (q: JoistPlan) => (q.inside ? (q.beamsInside ? 2 : 1) : 0);
      if (!plan || rank(p) > rank(plan) || (rank(p) === rank(plan) && p.middle < plan.middle)) plan = p;
      if (rank(plan) === 2 && plan.middle === 0) break;
    }
    if (!plan) return null;
    const joistSize = plan.size;
    const joistDepth = joistDepthIn(joistSize);
    const joistBottomIn = joistTopIn - joistDepth;
    const tooLow = joistBottomIn - groundHighIn < MIN_FRAME_CLEAR_IN;

    // Beams: for each line, the size and post count that cost least together.
    const lines = mergeLines(plan.zones.flatMap((z) => beamLines(z, style)));
    const beyond: string[] = [];
    let droppedDoesNotFit = false;
    const beams: Beam[] = [];
    for (const [i, line] of lines.entries()) {
      const id = `b${i + 1}`;
      const lengthIn = line.x1 - line.x0;
      const ircFt = Math.max(...line.segs.map((s) => s.ircFt));
      const dcaFt = Math.max(...line.segs.map((s) => s.dcaFt));
      const bothSides = line.segs.some((s) => s.bothSides);
      const room = joistBottomIn - footingTopIn;
      // NO POST OVER THE TABLE (2026-10-11, owner: "offer fixes or auto fix" — a post carried 195 sq ft): a post carries
      // the strip of deck the beam holds times the beam between its neighbours, and the post and footing tables stop at
      // 160 sq ft. So the posts stand no farther apart than that allows, whatever the beam could span (2% short of the
      // limit, for the rounding of the areas).
      const stripFt = Math.max(0.5, ...line.segs.map((s) => s.tributaryFt));
      const areaSpanIn = Math.floor(((POST_TABLE_MAX_AREA * 0.98) / stripFt) * 12);
      type Option = { spec: BeamSpec; maxSpanIn: number; posts: ReturnType<typeof layoutPosts>; cost: number };
      const options: Option[] = beamChoices.map((size) => {
        const spec = beamSpec(size);
        const maxSpanIn = spec.kind === "solid" ? solidBeamMaxSpanIn(load, group, size as (typeof SOLID_BEAMS)[number], dcaFt) : builtUpBeamMaxSpanIn(load, group, size as (typeof BUILT_UP_CHOICES)[number], ircFt);
        const posts = layoutPosts(lengthIn, maxSpanIn > 0 ? Math.min(maxSpanIn, areaSpanIn) : maxSpanIn, style);
        return { spec, maxSpanIn, posts, cost: (lengthIn / 12) * spec.plies * price(lumberKey(spec.stock)) + posts.count * postSetCost };
      });
      const cheapest = (list: Option[]) => list.reduce((m, o) => (o.cost < m.cost - 0.005 || (Math.abs(o.cost - m.cost) <= 0.005 && o.spec.depthIn < m.spec.depthIn) ? o : m));
      const deepest = (list: Option[]) => list.reduce((m, o) => (o.spec.depthIn > m.spec.depthIn || (o.spec.depthIn === m.spec.depthIn && o.spec.plies > m.spec.plies) ? o : m));
      const tabulated = options.filter((o) => o.maxSpanIn > 0);
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
      const postXs = Array.from({ length: posts.count }, (_, k) => line.x0 + posts.endIn + k * posts.spanIn);
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
        tableSpanFt: spec.kind === "solid" ? dcaFt : ircFt,
        table: spec.kind === "solid" ? "DCA6" : "IRC",
        bothSides,
        maxSpanIn: pick.maxSpanIn,
        postXs,
        spanIn: posts.spanIn,
        endIn: posts.endIn,
        bottomIn: topIn - spec.depthIn,
      });
      // Remember the strips for the posts' areas.
      strips.set(id, line.segs);
    }

    // Posts and their footings.
    const posts: Post[] = [];
    for (const beam of beams) {
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
      // Under a beam that sits lower than the footings usually stand, the concrete stops under the beam.
      const topIn = Math.min(footingTopIn, Math.max(0, beam.bottomIn));
      beam.postXs.forEach((x, k) => {
        const tributarySqFt = Math.round(areas[k] * 10) / 10;
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
          maxHeightIn: postMaxHeightIn(load, group, design.framing.post, tributarySqFt),
          corner: k === 0 || k === beam.postXs.length - 1,
          footing,
        });
      });
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
        maxHeightIn: postMaxHeightIn(load, group, rp.size, tributarySqFt),
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
    const hardware = { hangers: 0, doubleHangers: 0, ties: 0, postBases: 0, postCaps: 0, braces: 0, rimScrews: 0, lateralTies: 0 };
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
      const backExposed = design.placement === "detached";
      const frontRim = style === "dropped" ? rimPlies(frontExposed) * THICK_2X_IN : 0;
      const backRim = style === "dropped" && zf.back === "beam" ? rimPlies(backExposed) * THICK_2X_IN : 0;
      const start = zf.back === "ledger" ? z.y0 + THICK_2X_IN : style === "flush" && backBeam ? z.y0 + backBeam.spec.thickIn : z.y0 + backRim;
      const endStraight = style === "flush" && frontBeam ? z.y1 - frontBeam.spec.thickIn : z.y1 - frontRim;
      const mine = joists.filter((j) => j.zoneId === z.id);

      for (const j of mine) {
        // A shaped front cuts each joist to the arc or the clip (a rim's thickness back from it).
        const end = shaped && style === "dropped" ? frontAt(j.x, z.y1) - frontRim : endStraight;
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
        else hardware.ties += (doubled ? 2 : 1) * zoneBeams.length;
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
            if (e.A.y < 0.5 && e.B.y < 0.5) continue;
            if (Math.abs(e.ux) < 1e-6) continue;
            if (e.length < 1) continue;
            const curved = front?.kind === "curve" && !(Math.abs(e.A.y - z.y1) < 0.01 && Math.abs(e.B.y - z.y1) < 0.01 && Math.abs(e.uy) < 1e-6);
            for (let p = 0; p < plies; p++) {
              const off = (p + 0.5) * THICK_2X_IN;
              sticks.push({ role: "rim", nominal: joistSize, lengthIn: e.length, cx: (e.A.x + e.B.x) / 2 - e.outX * off, cy: (e.A.y + e.B.y) / 2 - e.outY * off, cz: joistBottomIn + joistDepth / 2, sx: e.length, sy: THICK_2X_IN, sz: joistDepth, ground: joistGround, of: z.id, yaw: e.yaw, curved });
            }
          }
          hardware.rimScrews += 3 * mine.length;
        } else rim(z.y1, rimPlies(frontExposed), -1);
        if (zf.back === "beam") rim(z.y0, rimPlies(backExposed), 1);
      }
    }

    // Ledgers: one board along each house face a rectangle hangs on.
    const ledgers: LedgerRun[] = [];
    const ledgerNominal = `2x${Math.max(8, Number(joistSize.slice(2)))}`;
    const ledgerDepth = DRESSED_DEPTH_IN[Math.max(8, Number(joistSize.slice(2)))];
    if (attached) {
      const runs: Array<{ y: number; x0: number; x1: number; spanFt: number }> = [];
      for (const zf of [...plan.zones].sort((p, q) => p.zone.y0 - q.zone.y0 || p.zone.x0 - q.zone.x0)) {
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
    for (const p of posts) {
      const [w, d] = POST_ACTUAL_IN[p.size];
      hardware.postBases += 1;
      if (p.roof) continue;
      // A beam that sits right on its footing needs the base, no post and no cap.
      if (p.heightIn >= 1) {
        hardware.postCaps += 1;
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
      if (front?.kind === "curve" && style === "dropped") rows.push({ y: zf.beamYs[zf.beamYs.length - 1] + (z.y1 + bulgeIn - zf.beamYs[zf.beamYs.length - 1]) / 2, why: "curve" });
      const supports = [zf.back === "ledger" ? z.y0 + THICK_2X_IN : zf.beamYs[0], ...(zf.back === "ledger" ? zf.beamYs : zf.beamYs.slice(1))];
      for (let i = 0; i + 1 < supports.length; i++) {
        const span = supports[i + 1] - supports[i];
        const makerRows = decking.blockingRowsMaxFt ? Math.max(0, Math.ceil(span / (decking.blockingRowsMaxFt * 12) - 1e-9) - 1) : 0;
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
            sticks.push({ role: "brace", nominal: "2x4", lengthIn: len, cx: p.x + (along * BRACE_LEG_IN) / 2, cy: p.y, cz: z, sx: BRACE_LEG_IN, sy: THICK_2X_IN, sz: BRACE_LEG_IN, ground: false, lean: { axis: "x", dir: along }, of: deckBraceKey(b.id, k, "x") });
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
              sticks.push({ role: "brace", nominal: "2x4", lengthIn: Math.round(leg * Math.SQRT2), cx: p.x, cy: p.y + (out * leg) / 2, cz: cz2, sx: THICK_2X_IN, sy: leg, sz: leg, ground: false, lean: { axis: "y", dir: out }, of: deckBraceKey(b.id, k, "y") });
              hardware.braces += 1;
            }
          }
        }
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
      groundHighIn,
      groundLowIn,
      flags: { tooLow, droppedDoesNotFit, joistBeyondTable: !plan.inside, beamBeyondTable: beyond },
      bracesLeftOut,
    };
  };

  // A shaped front needs a beam under the joists: they run past it to the arc or the clip.
  const style = shaped ? (design.framing.beamStyle === "flush" ? "dropped" : design.framing.beamStyle) : design.framing.beamStyle;
  if (style === "auto") {
    const dropped = attempt("dropped", true);
    if (dropped) return dropped;
    return attempt("flush", false) as DeckFrame;
  }
  return attempt(style, false) as DeckFrame;
}
