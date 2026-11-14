// A DECK AS THE CONTRACTOR DESCRIBES IT (2026-10-04) — pure.
//
// Everything the studio's steps collect, in one plain object: the shape, how
// it meets the house, how high it stands, what it is framed and decked with.
// The frame itself is NOT stored here — frame.ts works it out from this, the
// same way every time, so the 3D, the material list and the price are three
// readings of one design and can never disagree.
//
// Lengths the contractor types are feet (the outline) and inches (heights);
// the engine works in inches inside.
//
// `normalizeDeckDesign` reads anything claiming to be a design — a saved
// one, a half-typed one — and gives back one the engine can build: numbers
// inside their rails, a choice that the wall or the species rules out moved
// to the nearest one that stands. It never throws.

import { parseWallRead, type JogOffer, type WallRead } from "./photoFit";
import { LOADS, POST_SIZES, SOILS, SOLID_BEAMS, SPACINGS, JOIST_SIZES, type BuiltUpBeam, type JoistSize, type LedgerFastener, type LoadPsf, type PostSize, type SoilPsf, type SolidBeam, type SpacingIn } from "./codeTables";
import { DECKING, FRAMING_SPECIES, RAIL_TYPES, WALL_TYPES, defaultDecking, defaultFramingSpecies, isCompositeFraming, railColors, wallType, type FramingSpeciesId, type RailTypeId, type WallTypeId } from "./catalog";
import { OC_POST } from "./ocLumber";
import { deckingColors } from "./deckingColors";
import { SLOPE_LIMITS, flatSlope, type SiteSlope, type TermiteHazard } from "./site";
import { defaultHouse, fitDeckEnds, normalizeHouse, type HouseDesign } from "./house";

/**
 * v2 (2026-10-10): `structure`, `floor`, `roof` and `photo` joined the design.
 * v3 (M3, 2026-10-10): the site (snow, slope, termites), real stairs and rails,
 * a curved or clipped front, a lower level, decking patterns, more roofs. A v1
 * design reads as a bare deck; a v2 one keeps every choice it made.
 */
import { deckCodeFor } from "./stateCodes";

export const DECK_DESIGN_VERSION = 3;

/** Which corner of the rectangle an L-shape is missing. "Back" is the house side. */
export type NotchCorner = "front-left" | "front-right" | "back-left" | "back-right";
export const NOTCH_CORNERS: readonly NotchCorner[] = ["front-left", "front-right", "back-left", "back-right"];

/**
 * The outline. `widthFt` runs along the house, `depthFt` out from it. An L
 * is that rectangle with one corner cut away: a FRONT notch makes a deck
 * with a deep part and a shallow part; a BACK notch is where the house
 * itself steps out into the deck (a bump-out or a bay).
 */
/**
 * The front edge (M3): straight; bowed out in a circular arc that rises
 * `bulgeFt` at the middle (the rim laminated, the joists cut to the arc); or
 * its two corners clipped at 45° by `clipFt`.
 */
export type FrontKind = "straight" | "curve" | "clipped";
export interface FrontProfile {
  kind: FrontKind;
  bulgeFt: number;
  clipFt: number;
}
export const FRONT_LABEL: Record<FrontKind, string> = { straight: "Straight", curve: "Curved (bowed out)", clipped: "Clipped corners" };

/**
 * THE DECK THAT FOLLOWS THE HOUSE WALL (owner, 2026-10-19, a 47½-ft deck along a wall that steps back 5½ ft for 11 ft:
 * "deck should follow house wall when moving wall in set out set, make better"). One part of the deck's back edge:
 * from `x0Ft` to `x1Ft` (the deck's feet from its left end) the back runs at `yFt` from the house line — out where the
 * wall comes out (the deck steps around it), back (negative) where the wall steps back (the deck reaches in to it, its
 * ledger on that wall). `depthFt` stays the house line to the front, the size the contractor gave.
 */
export interface BackPart {
  x0Ft: number;
  x1Ft: number;
  yFt: number;
  /**
   * PAST THE HOUSE'S CORNER (2026-11-14 — the owner: "if I want to go back past the house, on the sides… the deck can
   * extend to the right and to the left outside the house wall"). No wall stands behind this part: the deck has run
   * past the corner, so its back is an open edge on a beam and posts, not a ledger. `yFt` is then zero or negative —
   * how far the part reaches BACK beside the house's side wall (a wrap-around deck). Only the deck's first and last
   * parts can be open (a house is one piece), and never all of them.
   */
  open?: true;
}

export type DeckShape =
  | { kind: "rect"; widthFt: number; depthFt: number; front?: FrontProfile }
  | { kind: "L"; widthFt: number; depthFt: number; notch: { corner: NotchCorner; widthFt: number; depthFt: number } }
  | { kind: "wall"; widthFt: number; depthFt: number; back: BackPart[] };

/**
 * How the deck meets the house:
 *   attached — a ledger on the house carries one side;
 *   beside   — it touches the house but stands on its own posts;
 *   detached — it stands in the yard.
 */
export type Placement = "attached" | "beside" | "detached";
export const PLACEMENTS: readonly Placement[] = ["attached", "beside", "detached"];
export const PLACEMENT_LABEL: Record<Placement, string> = {
  attached: "On the house — ledger",
  beside: "Beside the house — on its own posts",
  detached: "Away from the house",
};

/** A dropped beam sits under the joists; a flush beam is in their plane and the joists hang on it. */
export type BeamStyle = "dropped" | "flush";
export type BeamKind = "solid" | "built-up";
export type BeamSize = SolidBeam | BuiltUpBeam;
/** The built-up beams the studio offers (a single 2x is not a beam anyone orders). */
export const BUILT_UP_CHOICES: readonly BuiltUpBeam[] = ["2-2x6", "2-2x8", "2-2x10", "2-2x12", "3-2x8", "3-2x10", "3-2x12"];
export const isSolidBeam = (b: string): b is SolidBeam => (SOLID_BEAMS as readonly string[]).includes(b);

export type FootingType = "poured" | "pier-block";

/* ------------------------------------------------------------------ */
/*  What stands on the deck (M2, 2026-10-10)                           */
/* ------------------------------------------------------------------ */

/**
 * What is being built: a bare deck; a deck with a roof over it (on the
 * house wall or a free-standing pavilion); a gazebo with its own roof shape,
 * standing on a deck, a slab or footings in the ground; a pergola of open
 * slats on any of the three.
 */
export type Structure = "deck" | "covered-deck" | "gazebo" | "pergola";
export const STRUCTURES: readonly Structure[] = ["deck", "covered-deck", "gazebo", "pergola"];
export const STRUCTURE_LABEL: Record<Structure, string> = { deck: "Deck", "covered-deck": "Covered deck", gazebo: "Gazebo", pergola: "Pergola" };

/** What a gazebo or a pergola stands on. A deck and a covered deck always stand on the deck. "slab" is a NEW slab,
 *  poured and priced; "existing" is a slab or patio already there (owner, 2026-11-06: no concrete in that price) —
 *  on either, the posts sit on anchored bases. */
export type Floor = "deck" | "slab" | "existing" | "ground";
export const FLOORS: readonly Floor[] = ["deck", "slab", "existing", "ground"];
export const FLOOR_LABEL: Record<Floor, string> = { deck: "On a deck", slab: "On a new concrete slab", existing: "On an existing slab or patio", ground: "On footings in the ground" };
/** Standing on concrete, new or already there. */
export const onConcrete = (f: Floor): boolean => f === "slab" || f === "existing";

export type RoofKind = "shed" | "gable" | "hip" | "pyramid" | "double-tier" | "gambrel" | "dutch-gable" | "pergola";
export const ROOF_KINDS: readonly RoofKind[] = ["shed", "gable", "hip", "pyramid", "double-tier", "gambrel", "dutch-gable", "pergola"];
export const ROOF_KIND_LABEL: Record<RoofKind, string> = {
  shed: "Shed — one slope",
  gable: "Gable",
  hip: "Hip",
  pyramid: "Pyramid",
  "double-tier": "Double tier (pagoda)",
  gambrel: "Gambrel (barn)",
  "dutch-gable": "Dutch gable",
  pergola: "Open slats",
};
/** The roof's outline in plan: the deck's own rectangle, or its own figure. "Round" is framed as a 16-sided ring. */
export type RoofPlanShape = "follows-deck" | "square" | "rect" | "hexagon" | "octagon" | "round";
export const ROOF_PLAN_SHAPES: readonly RoofPlanShape[] = ["follows-deck", "square", "rect", "hexagon", "octagon", "round"];
export const ROOF_PLAN_LABEL: Record<RoofPlanShape, string> = { "follows-deck": "Follows the deck", square: "Square", rect: "Rectangle", hexagon: "Hexagon", octagon: "Octagon", round: "Round" };
export const isPolygonShape = (s: RoofPlanShape): boolean => s === "hexagon" || s === "octagon" || s === "round";
/** A pergola's top: flat slats, louvers that turn, or rafters cut to an arch. */
export type PergolaStyle = "flat" | "louvered" | "arched";
export const PERGOLA_STYLE_LABEL: Record<PergolaStyle, string> = { flat: "Flat slats", louvered: "Louvers that turn", arched: "Arched rafters" };
/** Walls between the posts: none, screen panels with a door, lattice, or solid privacy panels. */
export type WallFill = "none" | "screen" | "lattice" | "solid";
export const WALL_FILL_LABEL: Record<WallFill, string> = { none: "Open between the posts", screen: "Screened, with a door", lattice: "Lattice panels", solid: "Solid privacy panels" };
/** On the house wall (a ledger carries the back of the roof) or free on its own posts. */
export type RoofAttach = "wall" | "free";
export type Roofing = "arch-shingle" | "3tab-shingle" | "designer-shingle" | "cedar-shake" | "metal-panel" | "standing-seam" | "none";
export const ROOFINGS: readonly Roofing[] = ["arch-shingle", "3tab-shingle", "designer-shingle", "cedar-shake", "metal-panel", "standing-seam", "none"];
export const ROOFING_LABEL: Record<Roofing, string> = {
  "arch-shingle": "Architectural shingles",
  "3tab-shingle": "3-tab shingles",
  "designer-shingle": "Designer shingles",
  "cedar-shake": "Cedar shakes",
  "metal-panel": "Metal panels, exposed fasteners",
  "standing-seam": "Standing-seam metal",
  none: "No roofing — open slats",
};
/** What the roofing sits on: sheathing, or purlins across the rafters (metal only). */
export type RoofDeck = "sheathing" | "purlins";
/**
 * What the rafters meet at the top: a ridge BEAM (the rafters bear on it and
 * the ceiling can stay open), a ridge BOARD with rafter ties (the ties take
 * the thrust), or none (hips meet at a king post or a steel ring). "auto"
 * lets the roof's shape decide.
 */
export type RidgeKind = "auto" | "beam" | "board" | "none" | "trusses";
export type CeilingKind = "none" | "tongue-groove" | "beadboard";
export const CEILING_LABEL: Record<CeilingKind, string> = { none: "Open — rafters showing", "tongue-groove": "Tongue-and-groove boards", beadboard: "Beadboard panels" };
export type FasciaFinish = "wood" | "pvc" | "aluminum-wrap";
export const FASCIA_FINISH_LABEL: Record<FasciaFinish, string> = { wood: "Painted wood 1x", pvc: "PVC trim board", "aluminum-wrap": "Aluminum wrap over wood" };
export type GutterKind = "none" | "k5" | "k6" | "half-round-alum" | "half-round-copper";
export const GUTTER_KINDS: readonly GutterKind[] = ["none", "k5", "k6", "half-round-alum", "half-round-copper"];
export const GUTTER_LABEL: Record<GutterKind, string> = {
  none: "No gutters",
  k5: "5-in. K-style aluminum",
  k6: "6-in. K-style aluminum",
  "half-round-alum": "Half-round aluminum",
  "half-round-copper": "Half-round copper",
};
export type RoofPostSize = "4x4" | "6x6" | "8x8";
export type RoofLoadChoice = "auto" | 20 | 30 | 50 | 70;
export type SlatSize = "2x2" | "2x4" | "2x6";

export interface RoofDesign {
  kind: RoofKind;
  attach: RoofAttach;
  plan: {
    shape: RoofPlanShape;
    /** A square or rectangle: along the house and out from it, ft. */
    widthFt: number;
    depthFt: number;
    /** A hexagon or octagon: across the flats, ft. */
    acrossFt: number;
    /** The roof's centre off the deck's centre, along the house, ft (a roof over part of a long deck). */
    offsetFt: number;
  };
  /** Rise per 12 in. of run. */
  pitch: number;
  /** Underside of the headers above the floor the posts stand on, inches. */
  eaveHeightIn: number;
  /** Eaves and rakes past the posts, inches. */
  overhangIn: number;
  load: RoofLoadChoice;
  post: RoofPostSize;
  rafter: JoistSize | "auto";
  rafterSpacingIn: SpacingIn;
  /** "lvl": engineered beams throughout; "auto" goes to an LVL only where no sawn header reaches. */
  header: BeamSize | "auto" | "lvl";
  ridge: RidgeKind;
  /**
   * Cross beams under a gable's ridge BEAM (2026-10-12, owner: "selections of beams for cross roof beams and supports"):
   * each spans eave header to eave header with a king post on it under the ridge, so the ridge spans shorter and a post
   * stands under each end. 0–3. A free hip's ridge beam always stands on two, at its ends (lib/deck/roof).
   */
  crossBeams: number;
  roofing: Roofing;
  roofDeck: RoofDeck;
  ceiling: CeilingKind;
  cupola: boolean;
  fascia: { eave: boolean; rake: boolean; finish: FasciaFinish };
  soffit: boolean;
  gutters: { kind: GutterKind; guards: boolean };
  braces: boolean;
  /** The braces' timber (2026-11-14 — the owner: "if it's a 6 by 6 brace, I can change it for 4 by 4, or 8 by 8 if the post is 8 by 8"): "auto" is the 4x4 it always was. Never larger than the post it braces. */
  braceSize: BraceSize | "auto";
  /** Knee braces taken out one by one in the 3D (2026-11-09; lib/deck/parts): each a post and the way its brace runs. */
  bracesOff: string[];
  /**
   * Beams between the posts left out by hand (2026-11-09 — owner: "we don't need that beam because a truss is up
   * there"): only one that carries nothing is ever left out — a gable end under trusses or a ridge board, a shed's
   * sloping side — and the engine puts it back the moment something bears on it (lib/deck/roof).
   */
  headersOff: string[];
  /** A pergola's slats on top of its rafters. */
  slats: { size: SlatSize; spacingIn: number };
  /** A pergola's top (M3). */
  pergolaStyle: PergolaStyle;
  /** Walls between the posts (M3): what, and on how many sides (the house side is never filled). */
  walls: { fill: WallFill; sides: number };
  /** Lights and a fan in the roof (M3). */
  extras: { fan: boolean; lights: number };
  /**
   * POSTS AND OPENINGS SET BY HAND (2026-11-13 — a deck builder: "let me add two posts with a 4-ft opening for a
   * future screen door"). The roof's posts stood only where the spans put them. A builder can now stand a post on a
   * side at a place of their own (`pins`), frame an opening between two posts where a door will hang (`openings`), and
   * set the farthest the posts may stand apart (`postSpacingFt`). Nothing here overrides the structure: the headers
   * are sized again for the spans these posts make, more posts go in where a span is past every header, and the
   * checks say where an engineer is wanted (lib/deck/roof).
   */
  pins: RoofPin[];
  openings: RoofOpening[];
  postSpacingFt: number | "auto";
}

/** A side of the roof, as its builder stands facing the house: the front (farthest from it), the left, the right, the back (a free-standing roof's). */
export type RoofSide = "front" | "left" | "right" | "back";
export const ROOF_SIDES: readonly RoofSide[] = ["front", "left", "right", "back"];
export const ROOF_SIDE_LABEL: Record<RoofSide, string> = { front: "Front", left: "Left side", right: "Right side", back: "Back" };
/** A post set by hand: a side, and its place along it — feet from the side's left end (front, back) or from its house end (left, right). */
export interface RoofPin {
  id: string;
  side: RoofSide;
  atFt: number;
}
/** An opening between two posts: a side, its middle along it, its clear width between the posts, and whether a screen door hangs in it now (or later). */
export interface RoofOpening {
  id: string;
  side: RoofSide;
  atFt: number;
  widthFt: number;
  door: boolean;
}
export const ROOF_POST_LIMITS = { pins: 12, openings: 6, atFt: { min: 0, max: 60 }, openingFt: { min: 2.5, max: 16 }, spacingFt: { min: 4, max: 16 } } as const;
/** The widest opening one screen door fills, and a pair of them. */
export const ROOF_DOOR_LEAF_FT = 4;
export const defaultRoofOpening = (id: string, side: RoofSide = "front", atFt = 6): RoofOpening => ({ id, side, atFt, widthFt: 4, door: true });
export const defaultRoofPin = (id: string, side: RoofSide = "front", atFt = 6): RoofPin => ({ id, side, atFt });

/* ------------------------------------------------------------------ */
/*  Stairs and rails (M3)                                               */
/* ------------------------------------------------------------------ */

export type StairSide = "front" | "left" | "right";
export const STAIR_SIDE_LABEL: Record<StairSide, string> = { front: "Front", left: "Left side", right: "Right side" };
export type StairLanding = "pad" | "patio" | "grade";
export const STAIR_LANDING_LABEL: Record<StairLanding, string> = { pad: "New concrete pad", patio: "Existing patio or walk", grade: "Pavers on grade" };
export type Handrail = "auto" | "both" | "one" | "none";

/** One stair: a flight down an edge, or box steps wrapping the deck's open sides. */
export interface StairDesign {
  id: string;
  side: StairSide;
  /** Where its middle sits along that side, ft from the side's start (the left end of the front; the house end of a side). */
  atFt: number;
  widthFt: number;
  /** From the main deck or from the lower level. */
  level: "upper" | "lower";
  /** Box-framed steps around the deck instead of a flight: the front, three open sides, or all four of a detached deck. */
  wrap: boolean;
  wrapSides: 1 | 3 | 4;
  landing: StairLanding;
  handrail: Handrail;
  /**
   * LANDINGS ON THE WAY DOWN (2026-11-14 — the owner: "split it with the landing, and turn the second part to the right
   * or to the left… add more landings at any height to turn it somewhere, fully adjustable"). Each a platform on its
   * own posts at a height of the builder's, and which way the stairs go on from it. None: one straight flight — a
   * flight past the code's 12 ft 3 in. still gets a straight landing by itself.
   */
  landings: StairTurn[];
}
/**
 * Which way the stairs go on from a landing, as you walk DOWN them: straight on, a quarter turn to the left or the
 * right, or back the way they came beside the flight above (a switchback) on its left or its right.
 */
export type StairTurnKind = "straight" | "left" | "right" | "back-left" | "back-right";
export const STAIR_TURNS: readonly StairTurnKind[] = ["straight", "left", "right", "back-left", "back-right"];
export const STAIR_TURN_LABEL: Record<StairTurnKind, string> = { straight: "Straight on", left: "Turn left", right: "Turn right", "back-left": "Back, on the left", "back-right": "Back, on the right" };
/** A landing of a stair: how high its boards stand above the ground (the deck's own datum), and the turn it makes. */
export interface StairTurn {
  id: string;
  heightIn: number;
  turn: StairTurnKind;
}
/** `landings`: the most a stair takes; `landingHeightIn`: how high one may stand; `landingApartIn`: the least between two landings, or a landing and the deck or the ground — two risers. */
export const STAIR_LIMITS = { widthFt: { min: 3, max: 12 }, count: 6, landings: 5, landingHeightIn: { min: 8, max: 348 }, landingApartIn: 12 } as const;

export type RailInfill = "balusters" | "cable" | "glass" | "panel" | "horizontal" | "mesh";
export const RAIL_INFILL_LABEL: Record<RailInfill, string> = { balusters: "Balusters", cable: "Cable", glass: "Glass panels", panel: "Panels", horizontal: "Horizontal rails", mesh: "Wire mesh panels" };
export const RAIL_INFILLS: readonly RailInfill[] = ["balusters", "cable", "glass", "panel", "horizontal", "mesh"];
/** The balusters: the system's own square ones, or thin round black metal ones — the look of most composite and wood rails built today. */
export type RailBaluster = "square" | "round";
export const RAIL_BALUSTER_LABEL: Record<RailBaluster, string> = { square: "Square, the rail's own", round: "Round black metal" };
export type RailLighting = "none" | "post-caps" | "post-caps-risers";
export const RAIL_LIGHTING_LABEL: Record<RailLighting, string> = { none: "No lights", "post-caps": "Lit post caps", "post-caps-risers": "Lit post caps and stair risers" };

/**
 * HOW A RAIL'S POSTS MEET THE DECK (2026-11-13 — a deck builder: "some sections show side-mounted, others top-mounted;
 * it matters at the permit desk"). Top: the post stands on the boards — a kit post on its base plate, a wood post in a
 * rated post base — over blocking between the joists. Side: the post hangs on the outside of the rim — a wood post
 * bolted through it with tension ties, a metal post on the maker's fascia brackets. The builder picks; "auto" is what
 * each system is sold for (a metal post on its base plate; a wood post, bare or sleeved, on the rim). One side of the
 * deck can differ.
 */
export type RailMount = "top" | "side";
export const RAIL_MOUNT_LABEL: Record<RailMount, string> = { top: "Top mount", side: "Side mount" };
export const RAIL_MOUNT_WORDS: Record<RailMount, string> = { top: "on the deck boards, over blocking", side: "on the outside of the rim" };
/** A rail section: a level and the side of it the rail runs along. */
export type RailSectionKey = `${"upper" | "lower"}-${"front" | "back" | "left" | "right"}`;
export const RAIL_SECTION_KEYS: readonly RailSectionKey[] = (["upper", "lower"] as const).flatMap((l) => (["front", "left", "right", "back"] as const).map((sd): RailSectionKey => `${l}-${sd}`));
export const RAIL_SECTION_LABEL: Record<RailSectionKey, string> = { "upper-front": "Front", "upper-left": "Left side", "upper-right": "Right side", "upper-back": "Back", "lower-front": "Lower level, front", "lower-left": "Lower level, left side", "lower-right": "Lower level, right side", "lower-back": "Lower level, back" };
/** What a system's posts are: wood 4x4s; a composite or vinyl sleeve over a wood 4x4; a metal post of the system's own (aluminum, cable, glass, a custom one). */
export type RailPostKind = "wood" | "sleeve" | "metal";
export const railPostKind = (type: RailTypeId): RailPostKind => (type === "treated" || type === "cedar" ? "wood" : type === "composite" || type === "vinyl" ? "sleeve" : "metal");
/** What "auto" builds for a system: a metal post on its base plate; a wood post, sleeved or bare, on the rim. */
export const railMountFor = (type: RailTypeId, asked: RailMount | "auto"): RailMount => (asked !== "auto" ? asked : railPostKind(type) === "metal" ? "top" : "side");
/** The mount of one section: its own where the builder set one, else the deck's. */
export const railMountOf = (rail: Pick<RailDesign, "type" | "mount" | "mountBy">, key: string): RailMount => rail.mountBy[key as RailSectionKey] ?? railMountFor(rail.type, rail.mount);

/** The railing: its system, height, infill, post spacing, cap and lights. The feet come from the open edges. */
export interface RailDesign {
  type: RailTypeId;
  heightIn: 36 | 42;
  infill: RailInfill | "auto";
  postSpacingFt: 4 | 6 | 8;
  /** A flat 2x6 drink cap on wood rails. */
  cap: boolean;
  lighting: RailLighting;
  /** A custom system's installed price per foot. */
  customPerFt: number;
  /** A custom system's name ("" = none given). */
  customName: string;
  /** Rail on the lower level too (where its height asks for one it is always on). */
  lowerLevel: boolean;
  /** The system's colour (2026-11-09): an id in its stock colours (lib/deck/catalog RAIL_COLORS); "" = its usual one. */
  color: string;
  /** Square balusters of the rail's own, or round black metal ones. */
  baluster: RailBaluster;
  /** A deck board laid flat on top of a kit rail — a drink rail (2026-11-10). A wood rail has its own 2x6 `cap`. */
  drink: boolean;
  /** How the posts meet the deck (2026-11-13): on the boards, on the rim, or what the system is sold for. */
  mount: RailMount | "auto";
  /** Sections mounted another way than the rest: a side of a level → its mount. Empty = every section as `mount`. */
  mountBy: Partial<Record<RailSectionKey, RailMount>>;
}

/* ------------------------------------------------------------------ */
/*  The site, a lower level, patterns (M3)                              */
/* ------------------------------------------------------------------ */

/** What the address said about the ground: snow, its fall across the deck, termites. */
export interface SiteDesign {
  /** Ground snow load, psf (0 = none / not known). The design load and the roof's page follow it. */
  groundSnowPsf: number;
  slope: SiteSlope;
  termite: TermiteHazard | null;
  /** The job's state, two letters: it names the residential code the deck is checked against (lib/deck/stateCodes). Null until an address says. */
  state: string | null;
}

/**
 * A second, lower deck. "front": in front of the main one, a step or a short stair down. "under" (2026-11-13 — the
 * owner: "a double deck, like first floor and second floor"): a DOUBLE DECK — a deck of the same outline under the main
 * one, a first-floor deck under a second-floor one, its beams let into the same posts. Under the main deck its width
 * and depth are the main deck's and its drop is the difference between the two heights (kept so by the normaliser), so
 * everything that reads a lower level reads this one too.
 */
export interface LowerLevel {
  on: boolean;
  place: "front" | "under";
  widthFt: number;
  depthFt: number;
  /** How far below the main deck it sits, inches. */
  dropIn: number;
  align: "left" | "centre" | "right";
  /** A double deck's lower floor: how high its boards stand above the ground, inches (its own door's threshold). */
  heightIn: number;
}
/** `storeyIn`: the least from one deck's boards up to the other's for a double deck to be one — room to stand under the upper deck's frame. */
export const LOWER_LIMITS = { widthFt: { min: 4, max: 60 }, depthFt: { min: 4, max: 30 }, dropIn: { min: 4, max: 96 }, heightIn: { min: 6, max: 144 }, storeyIn: 90 } as const;
/** The clear height wanted under the upper deck's frame, boards to the underside of its lowest beam or joist (R305.1's 6 ft 8 in. under beams). */
export const DOUBLE_DECK_HEADROOM_IN = 80;
/** The storey a double deck is given when it is asked for on a deck too low for one: 9 ft, floor to floor. */
export const DOUBLE_DECK_STOREY_IN = 108;

/** A hot-tub spot on the deck: where the tub will stand, and the frame
 *  under it doubled for the water it holds. The tub itself is by others. */
export interface SpaDesign {
  on: boolean;
  /** The tub's footprint, feet. */
  widthFt: number;
  depthFt: number;
  /** Along the house wall: which way the spot slides. */
  align: "left" | "centre" | "right";
}
export const SPA_LIMITS = { widthFt: { min: 5, max: 10 }, depthFt: { min: 5, max: 10 } } as const;
export function defaultSpa(): SpaDesign {
  return { on: false, widthFt: 7, depthFt: 7, align: "right" };
}

/** The tub's footprint on the deck, INCHES from the left-back corner —
 *  against the house wall, slid by its alignment. Null when off. */
export function spaRectIn(design: Pick<DeckDesign, "spa" | "shape">): { x0: number; x1: number; y0: number; y1: number } | null {
  const spa = design.spa;
  if (!spa?.on || design.shape.kind === "L") return null;
  const W = design.shape.widthFt * 12;
  const w = spa.widthFt * 12;
  const d = spa.depthFt * 12;
  const margin = 6;
  const D = design.shape.depthFt * 12;
  const x0 = spa.align === "left" ? margin : spa.align === "right" ? W - w - margin : (W - w) / 2;
  // On a deck that follows the wall, the tub stays clear of a bump-out behind it.
  const behind = design.shape.kind === "wall" ? Math.max(0, ...design.shape.back.filter((b) => b.x1Ft * 12 > x0 && b.x0Ft * 12 < x0 + w).map((b) => b.yFt * 12)) : 0;
  if (behind + margin + d > D - margin + 0.01 && behind > 0) return null;
  // At the FRONT edge: by the rail with the view, clear of the door path
  // along the house — and where every drawing actually shows it.
  return { x0, x1: x0 + w, y0: Math.max(margin + behind, D - d - margin), y1: Math.max(margin + behind + d, D - margin) };
}

export type DeckPattern = "straight" | "diagonal" | "herringbone";
export const PATTERN_LABEL: Record<DeckPattern, string> = { straight: "Square to the joists", diagonal: "Diagonal, 45°", herringbone: "Herringbone" };

/* ------------------------------------------------------------------ */
/*  Electrical and accessories (M3)                                     */
/* ------------------------------------------------------------------ */

export type FixtureKind = "led-strip" | "post-cap" | "step-light" | "string-light" | "sconce" | "ceiling-light" | "chandelier" | "fan" | "outlet" | "heater" | "flood";
export const FIXTURE_KINDS: readonly FixtureKind[] = ["led-strip", "post-cap", "step-light", "string-light", "sconce", "ceiling-light", "chandelier", "fan", "outlet", "heater", "flood"];
export const FIXTURE_LABEL: Record<FixtureKind, string> = {
  "led-strip": "LED strip under the rail or the headers",
  "post-cap": "Lit post caps",
  "step-light": "Stair riser lights",
  "string-light": "String lights post to post",
  sconce: "Wall sconce on a post",
  "ceiling-light": "Ceiling light",
  chandelier: "Chandelier at the peak",
  fan: "Ceiling fan",
  outlet: "Weatherproof outlet, GFCI",
  heater: "Infrared patio heater",
  flood: "Security flood light, motion",
};
/** Who buys the fixture: the shop prices it, or the client brings their own — then it is drawn as a sample and left to be determined. */
export type FixtureSupply = "we" | "client";
export type MountKind = "post" | "header" | "rail" | "deck" | "ceiling" | "wall" | "stair" | "peak";

export interface Fixture {
  id: string;
  kind: FixtureKind;
  supply: FixtureSupply;
  /** How many (for strips, feet are worked out from where they run). */
  qty: number;
  /** Where it was put — plan inches and height, and what it is on — or null for the smart default. */
  at: { x: number; y: number; z: number; on: MountKind } | null;
  /** Heaters: 240-volt (4 kW) instead of a plug-in-sized 120-volt (1.5 kW). */
  volts240?: boolean;
  /** A fixture of the contractor's own choosing: its name and price each; it works like `kind`. */
  custom?: CustomProduct | null;
}

/**
 * A PRODUCT OF THE CONTRACTOR'S OWN (2026-10-12; owner: "always an option custom, in case the contractor didn't find it
 * in what we have"): its name and its price, in the unit of the list it stands in. The list's own choice stays what it
 * WORKS LIKE — the engine frames, weighs and draws it as that; the name and the price are the contractor's.
 */
export interface CustomProduct {
  name: string;
  /** In the slot's unit (CUSTOM_SLOT_UNIT); a species' name carries no price. */
  price: number;
}
export type CustomSlot = "decking" | "fastening" | "fascia" | "roofing" | "ceiling" | "roofFascia" | "gutters" | "walls" | "species";
export const CUSTOM_SLOTS: readonly CustomSlot[] = ["decking", "fastening", "fascia", "roofing", "ceiling", "roofFascia", "gutters", "walls", "species"];
/** What one custom price buys, per slot. */
export const CUSTOM_SLOT_UNIT: Record<CustomSlot, string> = { decking: "ft", fastening: "sq ft", fascia: "ft", roofing: "sq", ceiling: "sq ft", roofFascia: "ft", gutters: "ft", walls: "sq ft", species: "" };
/** An item of the contractor's own, outside every list: on the material list and in the price as typed. */
export interface OwnItem {
  id: string;
  name: string;
  qty: number;
  unit: OwnUnit;
  /** Per unit. */
  price: number;
}
export type OwnUnit = "ea" | "pcs" | "ft" | "sq ft" | "bags";
export const OWN_UNITS: readonly OwnUnit[] = ["ea", "pcs", "ft", "sq ft", "bags"];
export const CUSTOM_LIMITS = { name: 80, price: { min: 0, max: 100000 }, qty: { min: 0, max: 100000 }, items: 40 } as const;

/** A colour typed in by the contractor: what the order calls it, and its look in the 3D. */
export interface OwnColor {
  name: string;
  hex: string;
}

export interface ElectricalDesign {
  fixtures: Fixture[];
  /** Feet from the house's panel to where the feed reaches the structure. */
  feedFt: number;
  /** Which end of the house wall the feed comes from. */
  panelSide: "left" | "right";
  /** Lights on a photocell/timer (the fixtures' own motion sensors aside). */
  timer: boolean;
}
export const ELECTRICAL_LIMITS = { feedFt: { min: 5, max: 300 }, qty: { min: 1, max: 40 }, fixtures: 40 } as const;

/** A photo of the back of the house, kept with the design so the client sees where the deck goes. */
export interface DeckPhoto {
  /** The stored file (private store, local or inline — lib/media/privateStore). */
  url: string;
  /** The picture's pixels. */
  w: number;
  h: number;
  /** Where the deck's elevation was placed on it: the ground line's left end and its width, as fractions of the picture. */
  placed: { x: number; y: number; w: number } | null;
  /** What the smart fit found on it (lib/deck/photoFit), kept so the studio can say it after a reload; null or absent when placed by hand. */
  fit?: { by: "line" | "door" | "eave" | "none"; pxPerFt: number; wallFt: number | null; suggestedHeightIn: number | null; door: boolean; windows: number; jog: boolean; confidence: number; notes: string[]; offer: JogOffer | null; read: WallRead | null; hand?: boolean } | null;
  /** The picture straightened from four corners (2026-10-11): the corners used, on the picture before, and that picture with its own placement and read, so it can be undone. */
  straightened?: { quad: Array<{ x: number; y: number }>; before: { url: string; w: number; h: number; placed: { x: number; y: number; w: number } | null; fit: DeckPhoto["fit"] } } | null;
}

export interface DeckDesign {
  v: typeof DECK_DESIGN_VERSION;
  shape: DeckShape;
  placement: Placement;
  /** What the house is where the deck meets it. */
  wall: WallTypeId;
  /** The walking surface above the ground, inches. */
  heightIn: number;
  /** 40 psf, or the ground snow load where the building office names a bigger one. */
  loadPsf: LoadPsf;
  soilPsf: SoilPsf;
  /** Frost depth, inches (from the job's state; the contractor can correct it). */
  frostIn: number;
  framing: {
    species: FramingSpeciesId;
    joist: JoistSize | "auto";
    spacingIn: SpacingIn | "auto";
    beamStyle: BeamStyle | "auto";
    beamKind: BeamKind;
    beam: BeamSize | "auto";
    post: PostSize;
    /** How far the joists run past the outer beam, ft; "auto" picks what the table allows, up to 2 ft. */
    overhangFt: number | "auto";
    /** Doubled outside joists and a doubled rim — the owner's standard. */
    doubleRim: boolean;
    joistTape: boolean;
    /** "auto": over every dropped beam the joists run past, plus what the decking's maker requires. */
    blocking: "auto" | "mid-span";
    /** Knee braces at corner posts over 2 ft (AWC's guide). */
    braces: boolean;
    /** The braces' timber (2026-11-14): "auto" is the 2x4 it always was; a 4x4, 6x6 or 8x8 where the builder wants the heavier look — never larger than the post it braces. */
    braceSize: BraceSize | "auto";
    /** Braces taken out one by one in the 3D (2026-11-09; lib/deck/parts): each a post and the way its brace leans. */
    bracesOff: string[];
    /**
     * THE DECK'S OWN POSTS BY HAND (2026-11-13 — a deck builder: "let me add and position posts, and set their spacing").
     * `pins`: posts stood under a beam at the builder's own places. A beam with any post set by hand stands on THOSE
     * posts — and on more only where its spans or its ends need one, so the code's tables are never left behind.
     * `postSpacingFt`: the farthest apart the posts under a beam may stand ("auto" = what the beam's table allows).
     */
    pins: DeckPostPin[];
    postSpacingFt: number | "auto";
    /**
     * THE BEAMS BY HAND (2026-11-13 — the owner: "move beams and posts by hand, drag them anywhere, or type the inches").
     * `beamLines`: middle beams stood at the builder's own places, to the inch. The joists land on THOSE — and on one
     * more only where a span between them is past the joist table, so a beam can be moved, added or taken off freely.
     * `backOverhangFt`: how far the joists run past a free-standing deck's house-side beam ("auto" = as the front).
     * The front beam's place is `overhangFt`.
     */
    beamLines: DeckBeamLine[];
    backOverhangFt: number | "auto";
  };
  ledger: {
    fastener: LedgerFastener;
    /** Two 1,500-lb hold-downs, or four 750-lb ones. */
    lateral: "two" | "four";
  };
  footing: {
    type: FootingType;
    /** How far the top of the concrete stands above the ground, inches. */
    aboveGradeIn: number;
    /** Dig a free-standing deck's footings to frost depth as well (the code only requires it of an attached one). */
    frostAlways: boolean;
  };
  decking: {
    product: string;
    /** Boards at 45° to the joists (kept for the pattern's sake: `pattern` is what is read). */
    diagonal: boolean;
    pattern: DeckPattern;
    /** Picture-frame border boards around the edge: none, one or two. */
    border: 0 | 1 | 2;
    fastening: "auto" | "screws" | "hidden";
    fascia: "auto" | "none" | "match";
    wastePct: number;
    /**
     * The board's colour, as its maker names it (2026-11-09 — owner: "whatever the client sees, he gets"): an id in the
     * line's own colour list (lib/deck/deckingColors), "" until one is picked. The 3D, the proposal and the material
     * list all carry it.
     */
    color: string;
    /** A colour of the contractor's own — a stain, a line the list does not have: its name and how it looks. Wins over `color`. */
    ownColor: OwnColor | null;
    /** A picture-frame border in a second colour of the same line (2026-11-10): an id in the line's list; "" = the deck's own colour. */
    borderColor: string;
  };
  extras: {
    /** Feet of railing typed by hand; "auto" = every open edge less the stair openings, where a guard is required or a rail chosen. */
    railFt: number | "auto";
    /** Tear-out of an old deck, sq ft. */
    demoSqFt: number;
    /** Stainless connectors and fasteners (within 300 ft of salt water the code requires them). */
    stainless: boolean;
    /** A drainage system under the joists, for a dry space below a high deck (M3). */
    underDeckDrain: boolean;
    /** Items of the contractor's own, outside every list (2026-10-12). */
    items: OwnItem[];
  };
  /** The railing (M3) — "none" leaves the edges open. */
  rail: RailDesign;
  /** The stairs (M3). */
  stairs: StairDesign[];
  /** A lower level in front (M3). */
  lower: LowerLevel;
  /** A hot-tub spot: doubled joists under the tub's footprint. */
  spa: SpaDesign;
  /** The site (M3). */
  site: SiteDesign;
  /** Lights, outlets, heaters and the wiring to them (M3). */
  electrical: ElectricalDesign;
  /** What stands on it (M2). A bare deck has `structure: "deck"`; its `roof` is kept so switching back and forth loses nothing. */
  structure: Structure;
  floor: Floor;
  roof: RoofDesign;
  photo: DeckPhoto | null;
  /** The house drawn behind it (lib/deck/house): storeys, roof, how far its back wall runs past the deck, and the steps in that wall. */
  house: HouseDesign;
  /** Products of the contractor's own, by list (2026-10-12): a slot set here names and prices that list's material. */
  custom: Partial<Record<CustomSlot, CustomProduct>>;
}

/** The rails every number is held inside. */
export const DECK_LIMITS = {
  widthFt: { min: 4, max: 60 },
  depthFt: { min: 4, max: 40 },
  notchFt: { min: 2 },
  /** The least a leg of an L keeps after the notch, ft. */
  legFt: { min: 3 },
  heightIn: { min: 4, max: 360 },
  frostIn: { min: 0, max: 96 },
  overhangFt: { min: 0, max: 4 },
  aboveGradeIn: { min: 0, max: 12 },
  wastePct: { min: 0, max: 30 },
  railFt: { min: 0, max: 400 },
  demoSqFt: { min: 0, max: 4000 },
  railCustomPerFt: { min: 0, max: 1000 },
  bulgeFt: { min: 1, max: 8 },
  clipFt: { min: 1, max: 6 },
  groundSnowPsf: { min: 0, max: 300 },
} as const;

export const ROOF_LIMITS = {
  planFt: { min: 6, max: 40 },
  acrossFt: { min: 8, max: 30 },
  offsetFt: { min: -30, max: 30 },
  pitch: { min: 2, max: 12 },
  eaveHeightIn: { min: 84, max: 144 },
  overhangIn: { min: 0, max: 36 },
  slatSpacingIn: { min: 3, max: 24 },
  wallSides: { min: 1, max: 16 },
  lights: { min: 0, max: 12 },
  crossBeams: { min: 0, max: 3 },
} as const;

/** The roof a structure starts with — a gable over a covered deck, a square pyramid gazebo, a pergola of 2x2 slats. */
export function defaultRoofDesign(structure: Structure = "covered-deck"): RoofDesign {
  const gazebo = structure === "gazebo";
  const pergola = structure === "pergola";
  return {
    kind: pergola ? "pergola" : gazebo ? "pyramid" : "gable",
    attach: gazebo || pergola ? "free" : "wall",
    // Over a deck the roof follows the deck (a gazebo typed 20 ft wide IS 20 ft wide); on its own floor it is a 12 ft square (gazebo) or rectangle.
    plan: { shape: "follows-deck", widthFt: 12, depthFt: 12, acrossFt: 12, offsetFt: 0 },
    pitch: gazebo ? 6 : pergola ? 0 : 4,
    eaveHeightIn: 96,
    overhangIn: 12,
    load: "auto",
    post: "6x6",
    rafter: "auto",
    rafterSpacingIn: 16,
    header: "auto",
    ridge: "auto",
    crossBeams: 0,
    roofing: pergola ? "none" : "arch-shingle",
    roofDeck: "sheathing",
    ceiling: "none",
    cupola: false,
    fascia: { eave: true, rake: true, finish: "wood" },
    soffit: false,
    gutters: { kind: structure === "covered-deck" ? "k5" : "none", guards: false },
    braces: true,
    braceSize: "auto",
    bracesOff: [],
    headersOff: [],
    slats: { size: "2x2", spacingIn: 12 },
    pergolaStyle: "flat",
    walls: { fill: "none", sides: 3 },
    extras: { fan: false, lights: 0 },
    pins: [],
    openings: [],
    postSpacingFt: "auto",
  };
}

/** A post under a deck beam, set by hand: the beam it stands under — the front one, a middle one, a free-standing deck's back one — and its place, feet from the deck's left end. */
export interface DeckPostPin {
  id: string;
  beam: "front" | "middle" | "back";
  atFt: number;
  /** The middle beam it stands under, when that beam was itself placed by hand (its id in framing.beamLines): the post goes with its beam wherever the beam is moved. */
  line?: string;
}
/** A middle beam set by hand: its place, feet from the house line (the deck's back edge; behind it — a minus — under a part of a deck that follows the wall back), and the parts of the deck (shapeZones' ids) it runs under — none named: every part it fits in. */
export interface DeckBeamLine {
  id: string;
  atFt: number;
  zones: string[];
}
/** No two beams closer than a foot, centre to centre: each stands on footings of its own. */
export const DECK_BEAM_LIMITS = { lines: 12, atFt: { min: -60, max: 60 }, gapIn: 12 } as const;
export const DECK_BEAM_LABEL: Record<DeckPostPin["beam"], string> = { front: "Front beam", middle: "Middle beam", back: "Back beam" };
export const DECK_POST_LIMITS = { pins: 48, atFt: { min: 0, max: 60 }, spacingFt: { min: 3, max: 14 } } as const;

/** The railing a deck starts with: none chosen — the checks ask for one where the height requires it. */
export function defaultRailDesign(): RailDesign {
  return { type: "none", heightIn: 36, infill: "auto", postSpacingFt: 6, cap: true, lighting: "none", customPerFt: 0, customName: "", lowerLevel: true, color: "", baluster: "square", drink: false, mount: "auto", mountBy: {} };
}

/** A flight of stairs where a contractor usually puts one: down the front, in the middle, 4 ft wide, onto a new pad. */
export function defaultStair(id = "s1", side: StairSide = "front", atFt = 0): StairDesign {
  return { id, side, atFt, widthFt: 4, level: "upper", wrap: false, wrapSides: 1, landing: "pad", handrail: "auto", landings: [] };
}

export function defaultLowerLevel(): LowerLevel {
  return { on: false, place: "front", widthFt: 12, depthFt: 8, dropIn: 7.5, align: "centre", heightIn: 18 };
}

export function defaultSite(): SiteDesign {
  return { groundSnowPsf: 0, slope: flatSlope(), termite: null, state: null };
}
/** "ca" → "CA"; anything else → null. */
export const stateCode = (s: unknown): string | null => (typeof s === "string" && /^[A-Za-z]{2}$/.test(s.trim()) ? s.trim().toUpperCase() : null);

export function defaultElectrical(): ElectricalDesign {
  return { fixtures: [], feedFt: 40, panelSide: "left", timer: false };
}

export function defaultFixture(id: string, kind: FixtureKind): Fixture {
  return { id, kind, supply: "we", qty: 1, at: null, volts240: false, custom: null };
}

/** A new deck for a shop in `state`: the owner's standards, the region's lumber. */
export function defaultDeckDesign(opts: { state?: string | null; frostIn?: number } = {}): DeckDesign {
  return {
    v: DECK_DESIGN_VERSION,
    shape: { kind: "rect", widthFt: 16, depthFt: 12 },
    placement: "attached",
    wall: "wood-rim",
    heightIn: 36,
    loadPsf: 40,
    soilPsf: 1500,
    frostIn: clamp(opts.frostIn ?? 24, DECK_LIMITS.frostIn.min, DECK_LIMITS.frostIn.max),
    framing: {
      species: defaultFramingSpecies(opts.state),
      joist: "auto",
      spacingIn: "auto",
      beamStyle: "auto",
      beamKind: "solid",
      beam: "auto",
      post: "6x6",
      overhangFt: "auto",
      doubleRim: true,
      joistTape: true,
      blocking: "auto",
      braces: true,
      braceSize: "auto",
      bracesOff: [],
      pins: [],
      postSpacingFt: "auto",
      beamLines: [],
      backOverhangFt: "auto",
    },
    ledger: { fastener: "lag", lateral: "two" },
    footing: { type: "poured", aboveGradeIn: 3, frostAlways: false },
    decking: { product: defaultDecking(opts.state), diagonal: false, pattern: "straight", border: 0, fastening: "auto", fascia: "auto", wastePct: 10, color: "", ownColor: null, borderColor: "" },
    extras: { railFt: "auto", demoSqFt: 0, stainless: false, underDeckDrain: false, items: [] },
    // The guard's height the state asks for (42 in. in California), from the start.
    rail: { ...defaultRailDesign(), heightIn: deckCodeFor(stateCode(opts.state)).guardIn },
    stairs: [],
    lower: defaultLowerLevel(),
    spa: defaultSpa(),
    site: { ...defaultSite(), state: stateCode(opts.state) },
    electrical: defaultElectrical(),
    structure: "deck",
    floor: "deck",
    roof: defaultRoofDesign("covered-deck"),
    photo: null,
    house: defaultHouse(),
    custom: {},
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
const num = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : fallback);
const oneOf = <T extends string | number>(v: unknown, list: readonly T[], fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
/** To the nearest inch, in feet — a typed 12.3333 stays 12'-4". */
const toInch = (ft: number) => Math.round(ft * 12) / 12;

function normalizeShape(raw: unknown, fallback: DeckShape): DeckShape {
  const r = obj(raw);
  const widthFt = toInch(clamp(num(r.widthFt, fallback.widthFt), DECK_LIMITS.widthFt.min, DECK_LIMITS.widthFt.max));
  const depthFt = toInch(clamp(num(r.depthFt, fallback.depthFt), DECK_LIMITS.depthFt.min, DECK_LIMITS.depthFt.max));
  if (r.kind === "wall") {
    const back = normalizeBack(r.back, widthFt, depthFt);
    if (back) return { kind: "wall", widthFt, depthFt, back };
    return { kind: "rect", widthFt, depthFt };
  }
  if (r.kind !== "L") {
    const f = obj(r.front);
    const kind = oneOf(f.kind, ["straight", "curve", "clipped"] as const, "straight");
    if (kind === "straight") return { kind: "rect", widthFt, depthFt };
    // A bow no deeper than a third of the width stays an arc a crew can bend; a clip leaves at least 2 ft of straight front.
    const bulgeFt = toInch(clamp(num(f.bulgeFt, 2), DECK_LIMITS.bulgeFt.min, Math.min(DECK_LIMITS.bulgeFt.max, widthFt / 3)));
    const clipFt = toInch(clamp(num(f.clipFt, 2), DECK_LIMITS.clipFt.min, Math.min(DECK_LIMITS.clipFt.max, (widthFt - 2) / 2, depthFt - 2)));
    return { kind: "rect", widthFt, depthFt, front: { kind, bulgeFt, clipFt } };
  }
  const n = obj(r.notch);
  const corner = oneOf(n.corner, NOTCH_CORNERS, "front-right");
  // Each leg keeps at least 3 ft; a rectangle too small for that stays a rectangle.
  const maxW = widthFt - DECK_LIMITS.legFt.min;
  const maxD = depthFt - DECK_LIMITS.legFt.min;
  if (maxW < DECK_LIMITS.notchFt.min || maxD < DECK_LIMITS.notchFt.min) return { kind: "rect", widthFt, depthFt };
  return {
    kind: "L",
    widthFt,
    depthFt,
    notch: {
      corner,
      widthFt: toInch(clamp(num(n.widthFt, widthFt / 2), DECK_LIMITS.notchFt.min, maxW)),
      depthFt: toInch(clamp(num(n.depthFt, depthFt / 2), DECK_LIMITS.notchFt.min, maxD)),
    },
  };
}

/**
 * The narrowest part a deck follows the wall into; the most a deck reaches back behind the house line into a set-back;
 * and the most a part past the house's corner runs back along the house's side (2026-11-14), ft.
 */
export const BACK_LIMITS = { partFt: 2, reachFt: 16, wrapFt: 24 } as const;

/**
 * A wall deck's back parts made buildable: in order, end to end over the deck's width, to the inch; each part leaves a
 * leg of at least `legFt` in front of it and reaches back no farther than `reachFt` (nor past the 40-ft depth);
 * neighbours at the same line are one part. Null when that leaves the back straight — the deck is a rectangle.
 * A part past the house's corner (`open`) is kept only at an end of the deck, with a walled part left between: it
 * stands at the house line or behind it (never in front), back `wrapFt` at most.
 */
export function normalizeBack(raw: unknown, widthFt: number, depthFt: number): BackPart[] | null {
  if (!Array.isArray(raw)) return null;
  const room = DECK_LIMITS.depthFt.max - depthFt;
  const lo = -Math.min(BACK_LIMITS.reachFt, room);
  const loOpen = -Math.min(BACK_LIMITS.wrapFt, room);
  const hi = depthFt - DECK_LIMITS.legFt.min;
  const cuts = raw
    .map((v) => obj(v))
    .map((b) => ({ x0: num(b.x0Ft, NaN), x1: num(b.x1Ft, NaN), y: num(b.yFt, 0), open: b.open === true }))
    .filter((b) => Number.isFinite(b.x0) && Number.isFinite(b.x1) && b.x1 > b.x0)
    .sort((a, b) => a.x0 - b.x0);
  if (!cuts.length) return null;
  // Open only at the ends, with wall between them: a deck with no wall behind any of it does not hang on this house
  // (a rectangle, then), and a part marked open between two walled ones is a walled one.
  const firstWall = cuts.findIndex((c) => !c.open);
  if (firstWall < 0) return null;
  const lastWall = cuts.length - 1 - [...cuts].reverse().findIndex((c) => !c.open);
  cuts.forEach((c, i) => {
    if (i > firstWall && i < lastWall) c.open = false;
  });
  const out: BackPart[] = [];
  let x = 0;
  for (let i = 0; i < cuts.length; i++) {
    const x1 = i === cuts.length - 1 ? widthFt : toInch(clamp(cuts[i].x1, x, widthFt));
    if (x1 - x < 1 / 12) continue;
    const open = cuts[i].open;
    const y = toInch(open ? clamp(cuts[i].y, loOpen, 0) : clamp(cuts[i].y, lo, hi));
    const last = out[out.length - 1];
    // Two open parts side by side are one (the first's line); a walled part joins its like at the same line.
    if (last && !!last.open === open && (open || Math.abs(last.yFt - y) < 1 / 24)) last.x1Ft = x1;
    else out.push({ x0Ft: x, x1Ft: x1, yFt: y, ...(open ? { open: true as const } : {}) });
    x = x1;
  }
  if (out.length && out[out.length - 1].x1Ft < widthFt) out[out.length - 1].x1Ft = widthFt;
  // (The cuts ran out before the wall did: what is left is all open — no wall, no wall deck.)
  if (!out.some((b) => !b.open)) return null;
  if (out.length < 2 && (!out.length || Math.abs(out[0].yFt) < 1 / 24)) return null;
  return out;
}

/**
 * Anything → a design the engine can build. A choice the wall rules out is
 * moved, not refused: a ledger on brick veneer becomes a deck beside the
 * house, a fastener with no table for this wall becomes the wall's first.
 */
export function normalizeDeckDesign(raw: unknown, opts: { state?: string | null; frostIn?: number } = {}): DeckDesign {
  const d = defaultDeckDesign(opts);
  const r = obj(raw);
  const f = obj(r.framing);
  const l = obj(r.ledger);
  const ft = obj(r.footing);
  const dk = obj(r.decking);
  const ex = obj(r.extras);

  const wall = oneOf(r.wall, WALL_TYPES.map((w) => w.id), d.wall);
  const w = wallType(wall);
  let placement = oneOf(r.placement, PLACEMENTS, d.placement);
  if (placement === "attached" && !w.ledger) placement = "beside";
  const fastener = oneOf(l.fastener, w.fasteners.length ? w.fasteners : (["lag"] as LedgerFastener[]), w.fasteners[0] ?? "lag");

  const structure = oneOf(r.structure, STRUCTURES, d.structure);
  // A deck and a covered deck stand on the deck; a gazebo or a pergola on whatever was chosen.
  const floor: Floor = structure === "deck" || structure === "covered-deck" ? "deck" : oneOf(r.floor, FLOORS, d.floor);
  // The deck's own shape first: the roof follows it, or carries its size off the deck.
  // (…and the house with it: a deck whose end runs past a corner of the house has no wall behind it there — the shape
  // says so whichever of the two changed last, so nothing downstream hangs a ledger in the air. 2026-11-14.)
  const shape0 = normalizeShape(r.shape, d.shape);
  const house = normalizeHouse(r.house, shape0);
  const shape = fitDeckEnds(shape0, house);
  const roof = normalizeRoof(r.roof, structure, floor, placement, shape);
  const photo = normalizePhoto(r.photo);

  const species = oneOf(f.species, FRAMING_SPECIES.map((s) => s.id), d.framing.species);
  // OC LUMBER (2026-11-12): Owens Corning tabulates beams built up of two or three boards and one post — three 2x6
  // OC boards screwed together — so a composite frame always has the OC post (a wood frame never does) and its beams
  // are built up. The wood frame's own beam kind is kept as chosen, so going back to wood brings it back.
  const composite = isCompositeFraming(species);
  const beamKind = oneOf(f.beamKind, ["solid", "built-up"] as const, d.framing.beamKind);
  const beamsBuilt = composite ? "built-up" : beamKind;
  const beamRaw = typeof f.beam === "string" ? f.beam : "auto";
  const beam: BeamSize | "auto" = beamsBuilt === "solid" ? (isSolidBeam(beamRaw) ? beamRaw : "auto") : (BUILT_UP_CHOICES as readonly string[]).includes(beamRaw) ? (beamRaw as BuiltUpBeam) : "auto";
  const overhangFt = f.overhangFt === "auto" || f.overhangFt === undefined ? "auto" : toInch(clamp(num(f.overhangFt, 0), DECK_LIMITS.overhangFt.min, DECK_LIMITS.overhangFt.max));
  const railFt = ex.railFt === "auto" || ex.railFt === undefined ? "auto" : Math.round(clamp(num(ex.railFt, 0), DECK_LIMITS.railFt.min, DECK_LIMITS.railFt.max) * 10) / 10;
  const heightIn = Math.round(clamp(num(r.heightIn, d.heightIn), DECK_LIMITS.heightIn.min, DECK_LIMITS.heightIn.max) * 4) / 4;
  const lower = normalizeLower(r.lower, shape, heightIn);
  const spa = normalizeSpa(r.spa, shape);
  // A v2 design carried the rail as an allowance in `extras` and the stairs as a count of flights.
  const rail = normalizeRail(r.rail, ex);
  const stairs = normalizeStairs(r.stairs, ex, shape, placement, lower);
  const site = normalizeSite(r.site, num(r.loadPsf, d.loadPsf), opts.state);
  const electrical = normalizeElectrical(r.electrical, rail, obj(r.roof));
  // The pattern; an older design's `diagonal: true` still means a diagonal when the pattern says nothing more.
  const patternRaw: DeckPattern = oneOf(dk.pattern, ["straight", "diagonal", "herringbone"] as const, dk.diagonal === true ? "diagonal" : "straight");
  const pattern: DeckPattern = patternRaw === "straight" && dk.diagonal === true ? "diagonal" : patternRaw;

  const deckingProductId = oneOf(dk.product, DECKING.map((p) => p.id), d.decking.product);

  return {
    v: DECK_DESIGN_VERSION,
    shape,
    placement,
    wall,
    heightIn,
    loadPsf: oneOf(num(r.loadPsf, d.loadPsf), LOADS, d.loadPsf) as LoadPsf,
    soilPsf: oneOf(num(r.soilPsf, d.soilPsf), SOILS, d.soilPsf) as SoilPsf,
    frostIn: Math.round(clamp(num(r.frostIn, d.frostIn), DECK_LIMITS.frostIn.min, DECK_LIMITS.frostIn.max)),
    framing: {
      species,
      joist: f.joist === "auto" ? "auto" : oneOf(f.joist, JOIST_SIZES, "auto" as JoistSize | "auto"),
      spacingIn: f.spacingIn === "auto" ? "auto" : (oneOf(num(f.spacingIn, 0), SPACINGS, "auto" as SpacingIn | "auto") as SpacingIn | "auto"),
      beamStyle: oneOf(f.beamStyle, ["auto", "dropped", "flush"] as const, d.framing.beamStyle),
      beamKind,
      beam,
      post: composite ? OC_POST : oneOf(f.post, POST_SIZES, d.framing.post),
      overhangFt,
      doubleRim: typeof f.doubleRim === "boolean" ? f.doubleRim : d.framing.doubleRim,
      joistTape: typeof f.joistTape === "boolean" ? f.joistTape : d.framing.joistTape,
      blocking: oneOf(f.blocking, ["auto", "mid-span"] as const, d.framing.blocking),
      braces: typeof f.braces === "boolean" ? f.braces : d.framing.braces,
      braceSize: oneOf(f.braceSize, ["auto", ...BRACE_SIZES] as const, "auto"),
      bracesOff: keyList(f.bracesOff),
      pins: deckPins(f.pins),
      postSpacingFt: typeof f.postSpacingFt === "number" && Number.isFinite(f.postSpacingFt) ? Math.round(clamp(f.postSpacingFt, DECK_POST_LIMITS.spacingFt.min, DECK_POST_LIMITS.spacingFt.max)) : "auto",
      beamLines: deckBeamLines(f.beamLines),
      backOverhangFt: typeof f.backOverhangFt === "number" && Number.isFinite(f.backOverhangFt) ? toInch(clamp(f.backOverhangFt, DECK_LIMITS.overhangFt.min, DECK_LIMITS.overhangFt.max)) : "auto",
    },
    ledger: { fastener, lateral: oneOf(l.lateral, ["two", "four"] as const, d.ledger.lateral) },
    footing: {
      type: oneOf(ft.type, ["poured", "pier-block"] as const, d.footing.type),
      aboveGradeIn: Math.round(clamp(num(ft.aboveGradeIn, d.footing.aboveGradeIn), DECK_LIMITS.aboveGradeIn.min, DECK_LIMITS.aboveGradeIn.max)),
      frostAlways: typeof ft.frostAlways === "boolean" ? ft.frostAlways : d.footing.frostAlways,
    },
    decking: {
      product: deckingProductId,
      diagonal: pattern !== "straight",
      pattern,
      border: (oneOf(num(dk.border, 0), [0, 1, 2] as const, 0) as 0 | 1 | 2),
      fastening: oneOf(dk.fastening, ["auto", "screws", "hidden"] as const, d.decking.fastening),
      fascia: oneOf(dk.fascia, ["auto", "none", "match"] as const, d.decking.fascia),
      wastePct: Math.round(clamp(num(dk.wastePct, d.decking.wastePct), DECK_LIMITS.wastePct.min, DECK_LIMITS.wastePct.max)),
      // A colour belongs to its line: another board picked, and the colour is asked again.
      color: typeof dk.color === "string" && deckingColors(deckingProductId).some((c) => c.id === dk.color) ? dk.color : "",
      ownColor: normalizeOwnColor(dk.ownColor),
      borderColor: typeof dk.borderColor === "string" && deckingColors(deckingProductId).some((c) => c.id === dk.borderColor) ? dk.borderColor : "",
    },
    extras: {
      railFt,
      demoSqFt: Math.round(clamp(num(ex.demoSqFt, 0), DECK_LIMITS.demoSqFt.min, DECK_LIMITS.demoSqFt.max)),
      stainless: ex.stainless === true,
      underDeckDrain: ex.underDeckDrain === true && heightIn >= 84,
      items: normalizeOwnItems(ex.items),
    },
    rail,
    stairs,
    lower,
    spa,
    site,
    electrical,
    structure,
    floor,
    roof,
    photo,
    house,
    custom: normalizeCustom(r.custom),
  };
}

/** Keys of parts taken out by hand: short, plain, no more than forty, each once. */
function keyList(raw: unknown): string[] {
  const out: string[] = [];
  for (const v of Array.isArray(raw) ? raw : []) {
    if (typeof v !== "string" || !/^[A-Za-z0-9:+.\-]{1,24}$/.test(v) || out.includes(v)) continue;
    out.push(v);
    if (out.length >= 40) break;
  }
  return out;
}
/** "#a1b2c3", lower case — or null. */
export const hexColor = (v: unknown): string | null => (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v.trim()) ? v.trim().toLowerCase() : null);
/** A colour of the contractor's own read back: a name it must have; a look that falls back to a mid brown. */
export function normalizeOwnColor(raw: unknown): OwnColor | null {
  const o = obj(raw);
  const name = typeof o.name === "string" ? o.name.replace(/\s+/g, " ").trim().slice(0, 60) : "";
  if (!name) return null;
  return { name, hex: hexColor(o.hex) ?? "#8a6a4c" };
}

const round2c = (n: number) => Math.round(n * 100) / 100;
const cleanName = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, CUSTOM_LIMITS.name) : "");
/** A product of the contractor's own read back: a name it must have, a price inside its rails; null without a name. */
export function normalizeCustomProduct(raw: unknown): CustomProduct | null {
  const o = obj(raw);
  const name = cleanName(o.name);
  if (!name) return null;
  return { name, price: round2c(clamp(num(o.price, 0), CUSTOM_LIMITS.price.min, CUSTOM_LIMITS.price.max)) };
}
function normalizeCustom(raw: unknown): DeckDesign["custom"] {
  const o = obj(raw);
  const out: DeckDesign["custom"] = {};
  for (const slot of CUSTOM_SLOTS) {
    const c = normalizeCustomProduct(o[slot]);
    if (c) out[slot] = slot === "species" ? { name: c.name, price: 0 } : c;
  }
  return out;
}
function normalizeOwnItems(raw: unknown): OwnItem[] {
  const out: OwnItem[] = [];
  const seen = new Set<string>();
  (Array.isArray(raw) ? raw : []).slice(0, CUSTOM_LIMITS.items).forEach((v, i) => {
    const o = obj(v);
    const name = cleanName(o.name);
    if (!name) return;
    let id = typeof o.id === "string" && /^[a-z0-9-]{1,14}$/.test(o.id) && !seen.has(o.id) ? o.id : "";
    for (let n = i + 1; !id; n++) if (!seen.has(`i${n}`)) id = `i${n}`;
    seen.add(id);
    out.push({ id, name, qty: round2c(clamp(num(o.qty, 1), CUSTOM_LIMITS.qty.min, CUSTOM_LIMITS.qty.max)), unit: oneOf(o.unit, OWN_UNITS, "ea"), price: round2c(clamp(num(o.price, 0), CUSTOM_LIMITS.price.min, CUSTOM_LIMITS.price.max)) });
  });
  return out;
}

function normalizeElectrical(raw: unknown, rail: RailDesign, legacyRoof: Record<string, unknown>): ElectricalDesign {
  const d = defaultElectrical();
  const r = obj(raw);
  const list = Array.isArray(r.fixtures) ? r.fixtures : [];
  const out: Fixture[] = [];
  list.slice(0, ELECTRICAL_LIMITS.fixtures).forEach((v, i) => {
    const f = obj(v);
    if (!FIXTURE_KINDS.includes(f.kind as FixtureKind)) return;
    const kind = f.kind as FixtureKind;
    const a = obj(f.at);
    const at = typeof a.x === "number" && typeof a.y === "number" ? { x: clamp(num(a.x, 0), -600, 1200), y: clamp(num(a.y, 0), -600, 1200), z: clamp(num(a.z, 0), -60, 400), on: oneOf(a.on, ["post", "header", "rail", "deck", "ceiling", "wall", "stair", "peak"] as const, "deck") } : null;
    const id = typeof f.id === "string" && /^[a-z0-9-]{1,14}$/.test(f.id) ? f.id : `e${i + 1}`;
    if (out.some((o) => o.id === id)) return;
    out.push({ id, kind, supply: oneOf(f.supply, ["we", "client"] as const, "we"), qty: Math.round(clamp(num(f.qty, 1), ELECTRICAL_LIMITS.qty.min, ELECTRICAL_LIMITS.qty.max)), at, volts240: kind === "heater" && f.volts240 === true, custom: normalizeCustomProduct(f.custom) });
  });
  // Older designs said "lit post caps" on the rail and a fan or lights on the roof: they become fixtures.
  if (rail.lighting !== "none" && !out.some((f) => f.kind === "post-cap")) out.push({ id: "e-caps", kind: "post-cap", supply: "we", qty: 1, at: null, volts240: false, custom: null });
  if (rail.lighting === "post-caps-risers" && !out.some((f) => f.kind === "step-light")) out.push({ id: "e-steps", kind: "step-light", supply: "we", qty: 1, at: null, volts240: false, custom: null });
  const lx = obj(legacyRoof.extras);
  if (lx.fan === true && !out.some((f) => f.kind === "fan")) out.push({ id: "e-fan", kind: "fan", supply: "we", qty: 1, at: null, volts240: false, custom: null });
  if (num(lx.lights, 0) > 0 && !out.some((f) => f.kind === "ceiling-light")) out.push({ id: "e-lights", kind: "ceiling-light", supply: "we", qty: Math.round(clamp(num(lx.lights, 0), 1, 12)), at: null, volts240: false, custom: null });
  return {
    // The cap holds after the legacy fixtures too, so a design at the limit reads back the same every time.
    fixtures: out.slice(0, ELECTRICAL_LIMITS.fixtures),
    feedFt: Math.round(clamp(num(r.feedFt, d.feedFt), ELECTRICAL_LIMITS.feedFt.min, ELECTRICAL_LIMITS.feedFt.max)),
    panelSide: oneOf(r.panelSide, ["left", "right"] as const, d.panelSide),
    timer: r.timer === true,
  };
}

/**
 * The roof, brought inside its rails and made to agree with the structure:
 * a pergola's roof is slats; a gazebo has a roof shape of its own, never a
 * shed; a polygon is roofed as a pyramid; a roof can hang on the wall only
 * where the deck meets the house.
 */
export function normalizeRoof(raw: unknown, structure: Structure, floor: Floor, placement: Placement, deckShape?: DeckShape): RoofDesign {
  // A bare deck keeps a covered deck's roof in the drawer, so switching to one later starts from the usual.
  const d = defaultRoofDesign(structure === "deck" ? "covered-deck" : structure);
  const r = obj(raw);
  const pl = obj(r.plan);
  const fa = obj(r.fascia);
  const gu = obj(r.gutters);
  const sl = obj(r.slats);
  let kind = oneOf(r.kind, ROOF_KINDS, d.kind);
  if (structure === "pergola") kind = "pergola";
  else if (kind === "pergola") kind = d.kind;
  if (structure === "gazebo" && kind === "shed") kind = "hip";
  let shape = oneOf(pl.shape, ROOF_PLAN_SHAPES, d.plan.shape);
  // Off the deck there is no deck to follow: a gazebo becomes a square, anything else a rectangle, the size the deck had.
  let carried: { widthFt: number; depthFt: number } | null = null;
  if (floor !== "deck" && shape === "follows-deck") {
    shape = structure === "gazebo" ? "square" : "rect";
    if (deckShape) carried = structure === "gazebo" ? { widthFt: Math.min(deckShape.widthFt, deckShape.depthFt), depthFt: Math.min(deckShape.widthFt, deckShape.depthFt) } : { widthFt: deckShape.widthFt, depthFt: deckShape.depthFt };
  }
  if (isPolygonShape(shape) && kind !== "pyramid" && kind !== "double-tier" && kind !== "pergola") kind = "pyramid";
  if (kind === "pyramid" && shape === "rect") shape = "square";
  if (kind === "shed" && shape !== "follows-deck") shape = shape === "square" ? "square" : "rect";
  // A gambrel or a Dutch gable needs two gable ends: never over a polygon, never on the wall.
  if ((kind === "gambrel" || kind === "dutch-gable") && isPolygonShape(shape)) kind = "pyramid";
  let attach = oneOf(r.attach, ["wall", "free"] as const, d.attach);
  // The wall carries a roof only where the deck meets it (or where a gazebo on its own floor is built against it).
  if (floor === "deck" && placement === "detached") attach = "free";
  if (isPolygonShape(shape)) attach = "free";
  if (kind === "pyramid" || kind === "double-tier" || kind === "gambrel" || kind === "dutch-gable") attach = "free";
  const widthFt = toInch(clamp(num(carried?.widthFt ?? pl.widthFt, d.plan.widthFt), ROOF_LIMITS.planFt.min, ROOF_LIMITS.planFt.max));
  const depthFt = shape === "square" ? widthFt : toInch(clamp(num(carried?.depthFt ?? pl.depthFt, d.plan.depthFt), ROOF_LIMITS.planFt.min, ROOF_LIMITS.planFt.max));
  const roofing = structure === "pergola" ? "none" : (oneOf(r.roofing, ROOFINGS, d.roofing) === "none" ? d.roofing : oneOf(r.roofing, ROOFINGS, d.roofing));
  const metal = roofing === "metal-panel" || roofing === "standing-seam";
  const rafterRaw = r.rafter === "auto" ? "auto" : oneOf(r.rafter, JOIST_SIZES, "auto" as JoistSize | "auto");
  const headerRaw = typeof r.header === "string" ? r.header : "auto";
  const header: BeamSize | "auto" | "lvl" = headerRaw === "lvl" ? "lvl" : isSolidBeam(headerRaw) ? headerRaw : (BUILT_UP_CHOICES as readonly string[]).includes(headerRaw) ? (headerRaw as BuiltUpBeam) : "auto";
  const wa = obj(r.walls);
  const rx = obj(r.extras);
  const ringSides = shape === "hexagon" ? 6 : shape === "octagon" ? 8 : shape === "round" ? 16 : 4;
  const loadRaw = r.load === "auto" || r.load === undefined ? "auto" : num(r.load, 0);
  const load: RoofLoadChoice = loadRaw === "auto" ? "auto" : ([20, 30, 50, 70] as const).find((l) => l === loadRaw) ?? "auto";
  return {
    kind,
    attach,
    plan: {
      shape,
      widthFt,
      depthFt,
      acrossFt: toInch(clamp(num(pl.acrossFt, d.plan.acrossFt), ROOF_LIMITS.acrossFt.min, ROOF_LIMITS.acrossFt.max)),
      offsetFt: toInch(clamp(num(pl.offsetFt, 0), ROOF_LIMITS.offsetFt.min, ROOF_LIMITS.offsetFt.max)),
    },
    pitch: kind === "pergola" ? 0 : Math.round(clamp(num(r.pitch, d.pitch), ROOF_LIMITS.pitch.min, ROOF_LIMITS.pitch.max)),
    eaveHeightIn: Math.round(clamp(num(r.eaveHeightIn, d.eaveHeightIn), ROOF_LIMITS.eaveHeightIn.min, ROOF_LIMITS.eaveHeightIn.max)),
    overhangIn: Math.round(clamp(num(r.overhangIn, d.overhangIn), ROOF_LIMITS.overhangIn.min, ROOF_LIMITS.overhangIn.max)),
    load,
    post: oneOf(r.post, ["4x4", "6x6", "8x8"] as const, d.post),
    rafter: rafterRaw,
    rafterSpacingIn: oneOf(num(r.rafterSpacingIn, 0), SPACINGS, d.rafterSpacingIn) as SpacingIn,
    header,
    ridge: oneOf(r.ridge, ["auto", "beam", "board", "none", "trusses"] as const, d.ridge),
    crossBeams: Math.round(clamp(num(r.crossBeams, 0), ROOF_LIMITS.crossBeams.min, ROOF_LIMITS.crossBeams.max)),
    roofing,
    roofDeck: metal ? oneOf(r.roofDeck, ["sheathing", "purlins"] as const, d.roofDeck) : "sheathing",
    ceiling: kind === "pergola" ? "none" : oneOf(r.ceiling, ["none", "tongue-groove", "beadboard"] as const, d.ceiling),
    cupola: kind !== "pergola" && kind !== "shed" && r.cupola === true,
    fascia: {
      eave: kind === "pergola" ? false : typeof fa.eave === "boolean" ? fa.eave : d.fascia.eave,
      rake: kind === "pergola" ? false : typeof fa.rake === "boolean" ? fa.rake : d.fascia.rake,
      finish: oneOf(fa.finish, ["wood", "pvc", "aluminum-wrap"] as const, d.fascia.finish),
    },
    soffit: kind !== "pergola" && r.soffit === true,
    gutters: { kind: kind === "pergola" ? "none" : oneOf(gu.kind, GUTTER_KINDS, d.gutters.kind), guards: gu.guards === true },
    braces: typeof r.braces === "boolean" ? r.braces : d.braces,
    braceSize: oneOf(r.braceSize, ["auto", "4x4", "6x6", "8x8"] as const, "auto"),
    bracesOff: keyList(r.bracesOff),
    headersOff: keyList(r.headersOff),
    slats: { size: oneOf(sl.size, ["2x2", "2x4", "2x6"] as const, d.slats.size), spacingIn: Math.round(clamp(num(sl.spacingIn, d.slats.spacingIn), ROOF_LIMITS.slatSpacingIn.min, ROOF_LIMITS.slatSpacingIn.max)) },
    pergolaStyle: kind === "pergola" ? oneOf(r.pergolaStyle, ["flat", "louvered", "arched"] as const, d.pergolaStyle) : "flat",
    walls: { fill: oneOf(wa.fill, ["none", "screen", "lattice", "solid"] as const, d.walls.fill), sides: Math.round(clamp(num(wa.sides, Math.min(3, ringSides - (attach === "wall" ? 1 : 0))), ROOF_LIMITS.wallSides.min, Math.min(ROOF_LIMITS.wallSides.max, ringSides))) },
    extras: { fan: kind !== "pergola" && rx.fan === true, lights: Math.round(clamp(num(rx.lights, 0), ROOF_LIMITS.lights.min, ROOF_LIMITS.lights.max)) },
    pins: roofPlaced(r.pins, ROOF_POST_LIMITS.pins, "p", (v, id, side, atFt) => ({ id, side, atFt })),
    openings: roofPlaced(r.openings, ROOF_POST_LIMITS.openings, "o", (v, id, side, atFt) => ({ id, side, atFt, widthFt: toInch(clamp(num(v.widthFt, 4), ROOF_POST_LIMITS.openingFt.min, ROOF_POST_LIMITS.openingFt.max)), door: v.door !== false })),
    postSpacingFt: typeof r.postSpacingFt === "number" && Number.isFinite(r.postSpacingFt) ? Math.round(clamp(r.postSpacingFt, ROOF_POST_LIMITS.spacingFt.min, ROOF_POST_LIMITS.spacingFt.max)) : "auto",
  };
}

/** A knee brace's timber. */
export type BraceSize = "2x4" | "4x4" | "6x6" | "8x8";
export const BRACE_SIZES: readonly BraceSize[] = ["2x4", "4x4", "6x6", "8x8"];
/** A brace's two faces, inches. */
export const BRACE_ACTUAL_IN: Record<BraceSize, readonly [number, number]> = { "2x4": [1.5, 3.5], "4x4": [3.5, 3.5], "6x6": [5.5, 5.5], "8x8": [7.5, 7.5] };
/** The brace sizes a post takes: none larger than the post (a 4x6 takes a 4x4; a built-up OC post the 2x4 it always had). */
export function braceSizesFor(post: string, least: BraceSize = "2x4"): BraceSize[] {
  const most = post === "8x8" ? 3 : post === "6x6" ? 2 : post === "4x4" || post === "4x6" ? 1 : 0;
  return BRACE_SIZES.filter((_, k) => k <= most && k >= BRACE_SIZES.indexOf(least));
}
/** The brace a post gets: the size asked for where the post takes it, else the largest it does; "auto" is `usual`. */
export function braceSizeFor(asked: BraceSize | "auto", post: string, usual: BraceSize): BraceSize {
  const ok = braceSizesFor(post, usual);
  if (asked === "auto" || !ok.length) return usual;
  return ok.includes(asked) ? asked : BRACE_SIZES.indexOf(asked) < BRACE_SIZES.indexOf(usual) ? usual : ok[ok.length - 1];
}

/** A stair's landings: each with an id of its own, a height to the inch and a turn; highest first; junk, doubles and two within two risers of each other dropped. (Which of them the stair can really take is the build's to say: stairs.ts.) */
function stairTurns(raw: unknown): StairTurn[] {
  const out: StairTurn[] = [];
  for (const [i, item] of (Array.isArray(raw) ? raw : []).entries()) {
    if (out.length >= STAIR_LIMITS.landings) break;
    if (!item || typeof item !== "object") continue;
    const v = item as Record<string, unknown>;
    if (typeof v.heightIn !== "number" || !Number.isFinite(v.heightIn)) continue;
    const id = typeof v.id === "string" && /^[a-z0-9-]{1,12}$/.test(v.id) ? v.id : `t${i + 1}`;
    const heightIn = Math.round(clamp(v.heightIn, STAIR_LIMITS.landingHeightIn.min, STAIR_LIMITS.landingHeightIn.max));
    if (out.some((o) => o.id === id || Math.abs(o.heightIn - heightIn) < STAIR_LIMITS.landingApartIn)) continue;
    out.push({ id, heightIn, turn: oneOf(v.turn, STAIR_TURNS, "straight") });
  }
  return out.sort((a, b) => b.heightIn - a.heightIn);
}

/** The deck's posts set by hand: each with an id of its own, a beam and a place along it to the inch; junk and doubles dropped. */
function deckPins(raw: unknown): DeckPostPin[] {
  const out: DeckPostPin[] = [];
  for (const [i, item] of (Array.isArray(raw) ? raw : []).entries()) {
    if (out.length >= DECK_POST_LIMITS.pins) break;
    if (!item || typeof item !== "object") continue;
    const v = item as Record<string, unknown>;
    if (typeof v.atFt !== "number" || !Number.isFinite(v.atFt)) continue;
    const id = typeof v.id === "string" && /^[a-z0-9-]{1,12}$/.test(v.id) ? v.id : `k${i + 1}`;
    if (out.some((o) => o.id === id)) continue;
    const line = typeof v.line === "string" && /^[a-z0-9-]{1,12}$/.test(v.line) ? v.line : "";
    out.push({ id, beam: line ? "middle" : oneOf(v.beam, ["front", "middle", "back"] as const, "front"), atFt: toInch(clamp(v.atFt, DECK_POST_LIMITS.atFt.min, DECK_POST_LIMITS.atFt.max)), ...(line ? { line } : {}) });
  }
  return out;
}

/** The middle beams set by hand: each with an id of its own and a place to the inch, in order from the house; junk, doubles and two within a foot of each other under one part of the deck dropped. */
function deckBeamLines(raw: unknown): DeckBeamLine[] {
  const out: DeckBeamLine[] = [];
  for (const [i, item] of (Array.isArray(raw) ? raw : []).entries()) {
    if (out.length >= DECK_BEAM_LIMITS.lines) break;
    if (!item || typeof item !== "object") continue;
    const v = item as Record<string, unknown>;
    if (typeof v.atFt !== "number" || !Number.isFinite(v.atFt)) continue;
    const id = typeof v.id === "string" && /^[a-z0-9-]{1,12}$/.test(v.id) ? v.id : `l${i + 1}`;
    if (out.some((o) => o.id === id)) continue;
    const zones = [...new Set((Array.isArray(v.zones) ? v.zones : []).filter((z): z is string => typeof z === "string" && /^[a-z]$/.test(z)))].sort();
    const atFt = toInch(clamp(v.atFt, DECK_BEAM_LIMITS.atFt.min, DECK_BEAM_LIMITS.atFt.max));
    const shares = (o: DeckBeamLine) => o.zones.length === 0 || zones.length === 0 || o.zones.some((z) => zones.includes(z));
    if (out.some((o) => shares(o) && Math.abs(o.atFt - atFt) * 12 < DECK_BEAM_LIMITS.gapIn - 0.01)) continue;
    out.push({ id, atFt, zones });
  }
  return out.sort((a, b) => a.atFt - b.atFt);
}

/** A list of things set by hand on the roof's sides: each with an id of its own, a side and a place along it, to the inch; junk and doubles dropped. */
function roofPlaced<T extends { id: string }>(raw: unknown, limit: number, prefix: string, make: (v: Record<string, unknown>, id: string, side: RoofSide, atFt: number) => T): T[] {
  const out: T[] = [];
  for (const [i, item] of (Array.isArray(raw) ? raw : []).entries()) {
    if (out.length >= limit) break;
    if (!item || typeof item !== "object") continue;
    const v = item as Record<string, unknown>;
    if (typeof v.atFt !== "number" || !Number.isFinite(v.atFt)) continue;
    const id = typeof v.id === "string" && /^[a-z0-9-]{1,12}$/.test(v.id) ? v.id : `${prefix}${i + 1}`;
    if (out.some((o) => o.id === id)) continue;
    out.push(make(v, id, oneOf(v.side, ROOF_SIDES, "front"), toInch(clamp(v.atFt, ROOF_POST_LIMITS.atFt.min, ROOF_POST_LIMITS.atFt.max))));
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  M3 normalisers                                                      */
/* ------------------------------------------------------------------ */

function normalizeRail(raw: unknown, legacyExtras: Record<string, unknown>): RailDesign {
  const d = defaultRailDesign();
  const r = obj(raw);
  const types = RAIL_TYPES.map((t) => t.id);
  const type = oneOf(r.type, types, oneOf(legacyExtras.rail, types, d.type));
  return {
    type,
    heightIn: num(r.heightIn, 36) >= 42 ? 42 : 36,
    infill: oneOf(r.infill, ["auto", ...RAIL_INFILLS] as const, d.infill),
    postSpacingFt: (oneOf(num(r.postSpacingFt, 6), [4, 6, 8] as const, 6) as 4 | 6 | 8),
    cap: typeof r.cap === "boolean" ? r.cap : d.cap,
    lighting: oneOf(r.lighting, ["none", "post-caps", "post-caps-risers"] as const, d.lighting),
    customPerFt: Math.round(clamp(num(r.customPerFt, num(legacyExtras.railCustomPerFt, 0)), DECK_LIMITS.railCustomPerFt.min, DECK_LIMITS.railCustomPerFt.max) * 100) / 100,
    customName: cleanName(r.customName),
    lowerLevel: typeof r.lowerLevel === "boolean" ? r.lowerLevel : d.lowerLevel,
    // A colour belongs to its system: another system picked, and it starts on that system's usual one.
    color: typeof r.color === "string" && railColors(type).some((c) => c.id === r.color) ? r.color : "",
    baluster: oneOf(r.baluster, ["square", "round"] as const, d.baluster),
    drink: r.drink === true,
    mount: oneOf(r.mount, ["auto", "top", "side"] as const, d.mount),
    mountBy: Object.fromEntries(RAIL_SECTION_KEYS.filter((k) => obj(r.mountBy)[k] === "top" || obj(r.mountBy)[k] === "side").map((k) => [k, obj(r.mountBy)[k] as RailMount])),
  };
}

function normalizeStairs(raw: unknown, legacyExtras: Record<string, unknown>, shape: DeckShape, placement: Placement, lower: LowerLevel): StairDesign[] {
  const list = Array.isArray(raw) ? raw : null;
  const out: StairDesign[] = [];
  const sideLength = (side: StairSide, level: "upper" | "lower") => (level === "lower" ? (side === "front" ? lower.widthFt : lower.depthFt) : side === "front" ? shape.widthFt : shape.depthFt);
  const one = (v: unknown, i: number): StairDesign | null => {
    const s = obj(v);
    const side = oneOf(s.side, ["front", "left", "right"] as const, "front");
    const level: "upper" | "lower" = lower.on && s.level === "lower" ? "lower" : "upper";
    const widthFt = Math.round(clamp(num(s.widthFt, 4), STAIR_LIMITS.widthFt.min, STAIR_LIMITS.widthFt.max) * 2) / 2;
    const L = sideLength(side, level);
    const atFt = toInch(clamp(num(s.atFt, L / 2), widthFt / 2, Math.max(widthFt / 2, L - widthFt / 2)));
    const wrap = s.wrap === true && side === "front";
    const wrapSides = (oneOf(num(s.wrapSides, 1), placement === "detached" ? ([1, 3, 4] as const) : ([1, 3] as const), 1) as 1 | 3 | 4);
    return {
      id: typeof s.id === "string" && /^[a-z0-9-]{1,12}$/.test(s.id) ? s.id : `s${i + 1}`,
      side,
      atFt,
      widthFt,
      level,
      wrap,
      wrapSides,
      landing: oneOf(s.landing, ["pad", "patio", "grade"] as const, "pad"),
      handrail: oneOf(s.handrail, ["auto", "both", "one", "none"] as const, "auto"),
      landings: wrap ? [] : stairTurns(s.landings),
    };
  };
  if (list) {
    list.slice(0, STAIR_LIMITS.count).forEach((v, i) => {
      const st = one(v, i);
      if (st && !out.some((o) => o.id === st.id)) out.push(st);
    });
  } else {
    // A v2 design: `extras.stairFlights` flights of `extras.stairWidthFt` down the front, spread along it.
    const flights = Math.round(clamp(num(legacyExtras.stairFlights, 0), 0, STAIR_LIMITS.count));
    const widthFt = Math.round(clamp(num(legacyExtras.stairWidthFt, 4), STAIR_LIMITS.widthFt.min, STAIR_LIMITS.widthFt.max) * 2) / 2;
    for (let i = 0; i < flights; i++) {
      const st = defaultStair(`s${i + 1}`, "front", toInch((shape.widthFt * (i + 1)) / (flights + 1)));
      st.widthFt = widthFt;
      out.push(st);
    }
  }
  // At most one wrap-around; it owns the front.
  let wrapped = false;
  return out.filter((st) => {
    if (!st.wrap) return true;
    if (wrapped) return false;
    wrapped = true;
    return true;
  });
}

function normalizeLower(raw: unknown, shape: DeckShape, heightIn: number): LowerLevel {
  const d = defaultLowerLevel();
  const r = obj(raw);
  const lowerHeightIn = Math.round(clamp(num(r.heightIn, d.heightIn), LOWER_LIMITS.heightIn.min, LOWER_LIMITS.heightIn.max));
  // A DOUBLE DECK: the main deck's own outline, under it. It is kept as asked even where the two heights leave no
  // storey between them — hasLowerLevel then says no and the checks say why, with the way to make room.
  if (r.place === "under") {
    return { on: r.on === true, place: "under", widthFt: shape.widthFt, depthFt: shape.depthFt, dropIn: Math.max(0, heightIn - lowerHeightIn), align: "left", heightIn: lowerHeightIn };
  }
  const front = shape.kind === "rect" ? shape.front : undefined;
  const on = r.on === true && shape.kind !== "L" && heightIn > LOWER_LIMITS.dropIn.min + 4 && front?.kind !== "curve";
  const maxDrop = Math.max(LOWER_LIMITS.dropIn.min, Math.min(LOWER_LIMITS.dropIn.max, heightIn - 4));
  // Between clipped corners the lower deck can be no wider than the straight part of the front.
  const maxWidth = Math.max(LOWER_LIMITS.widthFt.min, Math.min(LOWER_LIMITS.widthFt.max, shape.widthFt - (front?.kind === "clipped" ? 2 * front.clipFt : 0)));
  return {
    on,
    place: "front",
    widthFt: toInch(clamp(num(r.widthFt, Math.min(d.widthFt, maxWidth)), LOWER_LIMITS.widthFt.min, maxWidth)),
    depthFt: toInch(clamp(num(r.depthFt, d.depthFt), LOWER_LIMITS.depthFt.min, LOWER_LIMITS.depthFt.max)),
    dropIn: Math.round(clamp(num(r.dropIn, d.dropIn), LOWER_LIMITS.dropIn.min, maxDrop) * 4) / 4,
    align: oneOf(r.align, ["left", "centre", "right"] as const, d.align),
    heightIn: lowerHeightIn,
  };
}

function normalizeSpa(raw: unknown, shape: DeckShape): SpaDesign {
  const d = defaultSpa();
  const r = obj(raw);
  // The tub needs a flat rectangle of deck wider than itself.
  const maxW = Math.max(SPA_LIMITS.widthFt.min, Math.min(SPA_LIMITS.widthFt.max, shape.widthFt - 1));
  const maxD = Math.max(SPA_LIMITS.depthFt.min, Math.min(SPA_LIMITS.depthFt.max, shape.depthFt - 1));
  const fits = shape.widthFt >= SPA_LIMITS.widthFt.min + 1 && shape.depthFt >= SPA_LIMITS.depthFt.min + 1;
  return {
    on: r.on === true && fits,
    widthFt: toInch(clamp(num(r.widthFt, Math.min(d.widthFt, maxW)), SPA_LIMITS.widthFt.min, maxW)),
    depthFt: toInch(clamp(num(r.depthFt, Math.min(d.depthFt, maxD)), SPA_LIMITS.depthFt.min, maxD)),
    align: oneOf(r.align, ["left", "centre", "right"] as const, d.align),
  };
}

function normalizeSite(raw: unknown, loadPsf: number, fallbackState?: string | null): SiteDesign {
  const r = obj(raw);
  const sl = obj(r.slope);
  const d = defaultSite();
  // A v2 design knew only its design load: a snow load above 40 psf is read back from it.
  const legacySnow = loadPsf > 40 ? loadPsf : 0;
  return {
    groundSnowPsf: Math.round(clamp(num(r.groundSnowPsf, legacySnow), DECK_LIMITS.groundSnowPsf.min, DECK_LIMITS.groundSnowPsf.max)),
    slope: {
      outDropIn: Math.round(clamp(num(sl.outDropIn, 0), SLOPE_LIMITS.dropIn.min, SLOPE_LIMITS.dropIn.max) * 2) / 2,
      acrossDropIn: Math.round(clamp(num(sl.acrossDropIn, 0), SLOPE_LIMITS.dropIn.min, SLOPE_LIMITS.dropIn.max) * 2) / 2,
    },
    termite: oneOf(r.termite, ["very-heavy", "moderate-heavy", "slight-moderate", "none-slight"] as const, d.termite as TermiteHazard) ?? null,
    state: stateCode(r.state) ?? stateCode(fallbackState),
  };
}

/** True when the design has a second deck: a lower level in front of the main deck, or — a double deck — one under it with a storey between the two. */
export function hasLowerLevel(design: DeckDesign): boolean {
  if (!hasDeck(design) || !design.lower.on) return false;
  return design.lower.place === "under" ? design.heightIn - design.lower.heightIn >= LOWER_LIMITS.storeyIn : design.shape.kind !== "L";
}
/** A DOUBLE DECK (2026-11-13): a deck of the same outline under the main one — a first-floor deck under a second-floor one. */
export function isDoubleDeck(design: DeckDesign): boolean {
  return design.lower.place === "under" && hasLowerLevel(design);
}

/* ------------------------------------------------------------------ */
/*  The front edge as a line                                            */
/* ------------------------------------------------------------------ */

/**
 * The deck's front edge at `x` (inches from the left), inches from the
 * house: the depth for a straight front; farther out along the bow of a
 * curve; the depth less the clip near a clipped corner. The curve is a
 * circular arc through both corners rising `bulge` at the middle.
 */
export function frontEdgeAt(shape: DeckShape, xIn: number): number {
  const D = Math.round(shape.depthFt * 12);
  if (shape.kind !== "rect" || !shape.front || shape.front.kind === "straight") return D;
  const W = Math.round(shape.widthFt * 12);
  if (shape.front.kind === "clipped") {
    const c = shape.front.clipFt * 12;
    if (xIn < c) return D - (c - xIn);
    if (xIn > W - c) return D - (xIn - (W - c));
    return D;
  }
  const s = shape.front.bulgeFt * 12;
  const half = W / 2;
  const R = (half * half) / (2 * s) + s / 2;
  const dx = xIn - half;
  const inside = Math.max(0, R * R - dx * dx);
  return D - (R - s) + Math.sqrt(inside);
}

/** The curve's radius, ft, for the bend check (Infinity when the front is not a curve). */
export function frontRadiusFt(shape: DeckShape): number {
  if (shape.kind !== "rect" || !shape.front || shape.front.kind !== "curve") return Infinity;
  const half = shape.widthFt / 2;
  const s = shape.front.bulgeFt;
  return Math.round(((half * half) / (2 * s) + s / 2) * 10) / 10;
}

/** The front edge's length, inches: the arc, or the clipped line, or the width. */
export function frontEdgeLengthIn(shape: DeckShape): number {
  const W = Math.round(shape.widthFt * 12);
  if (shape.kind !== "rect" || !shape.front || shape.front.kind === "straight") return W;
  if (shape.front.kind === "clipped") {
    const c = shape.front.clipFt * 12;
    return W - 2 * c + 2 * c * Math.SQRT2;
  }
  const R = frontRadiusFt(shape) * 12;
  const half = W / 2;
  return 2 * R * Math.asin(Math.min(1, half / R));
}

function offerOf(raw: unknown): JogOffer | null {
  const o = obj(raw);
  if (typeof o.text !== "string" || typeof o.widthFt !== "number" || !Number.isFinite(o.widthFt)) return null;
  const text = o.text.slice(0, 240);
  if (o.kind === "recess") return { kind: "recess", widthFt: clamp(o.widthFt, 0, 60), text };
  if (o.kind === "notch" && (o.corner === "back-left" || o.corner === "back-right") && typeof o.depthFt === "number" && Number.isFinite(o.depthFt)) {
    return { kind: "notch", corner: o.corner, widthFt: clamp(o.widthFt, 0, 60), depthFt: clamp(o.depthFt, 0, 40), text };
  }
  return null;
}

/** The picture, its size, its placement and its read — shared by the photo and the one it was straightened from. */
function photoCore(raw: unknown): Omit<DeckPhoto, "straightened"> | null {
  const r = obj(raw);
  if (typeof r.url !== "string" || !r.url || r.url.length > 2000) return null;
  const w = Math.round(clamp(num(r.w, 0), 0, 20000));
  const h = Math.round(clamp(num(r.h, 0), 0, 20000));
  if (w < 16 || h < 16) return null;
  const p = obj(r.placed);
  const placed = typeof p.x === "number" && typeof p.y === "number" && typeof p.w === "number" ? { x: clamp(num(p.x, 0.1), -0.5, 1.5), y: clamp(num(p.y, 0.9), 0, 1.5), w: clamp(num(p.w, 0.8), 0.05, 3) } : null;
  const f = obj(r.fit);
  const fit =
    r.fit && typeof f.pxPerFt === "number"
      ? {
          by: f.by === "door" ? ("door" as const) : f.by === "eave" ? ("eave" as const) : f.by === "line" ? ("line" as const) : ("none" as const),
          pxPerFt: clamp(num(f.pxPerFt, 0), 0, 10000),
          wallFt: typeof f.wallFt === "number" && Number.isFinite(f.wallFt) ? Math.round(clamp(f.wallFt, 0, 500)) : null,
          suggestedHeightIn: typeof f.suggestedHeightIn === "number" && Number.isFinite(f.suggestedHeightIn) ? Math.round(clamp(f.suggestedHeightIn, 0, 360)) : null,
          door: f.door === true,
          windows: Math.round(clamp(num(f.windows, 0), 0, 12)),
          jog: f.jog === true,
          confidence: clamp(num(f.confidence, 0), 0, 1),
          notes: (Array.isArray(f.notes) ? f.notes : []).filter((n): n is string => typeof n === "string").map((n) => n.slice(0, 240)).slice(0, 8),
          offer: offerOf(f.offer),
          read: parseWallRead(f.read),
          hand: f.hand === true,
        }
      : null;
  return { url: r.url, w, h, placed, fit };
}

function normalizePhoto(raw: unknown): DeckPhoto | null {
  const core = photoCore(raw);
  if (!core) return null;
  const st = obj(obj(raw).straightened);
  const quad = (Array.isArray(st.quad) ? st.quad : [])
    .map((q) => { const o = obj(q); return typeof o.x === "number" && typeof o.y === "number" && Number.isFinite(o.x) && Number.isFinite(o.y) ? { x: clamp(o.x, -0.5, 1.5), y: clamp(o.y, -0.5, 1.5) } : null; })
    .filter((q): q is { x: number; y: number } => !!q);
  const before = photoCore(st.before);
  return { ...core, straightened: quad.length === 4 && before ? { quad, before: { url: before.url, w: before.w, h: before.h, placed: before.placed, fit: before.fit ?? null } } : null };
}

/** True when the design has a deck frame under it (a bare or covered deck, or a gazebo/pergola standing on a deck). */
export function hasDeck(design: DeckDesign): boolean {
  return design.structure === "deck" || design.structure === "covered-deck" || design.floor === "deck";
}
/** True when something stands on the posts: a roof or a pergola. */
export function hasRoof(design: DeckDesign): boolean {
  return design.structure !== "deck";
}

/* ------------------------------------------------------------------ */
/*  The outline as rectangles                                          */
/* ------------------------------------------------------------------ */

/** One rectangle of the deck, inches. x runs along the house, y out from it. */
export interface Zone {
  /** "a", "b"… — an L has two, a deck that follows the wall one per part of its back. */
  id: string;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** No house wall behind it (2026-11-14): the deck past the house's corner — its back on a beam, an open edge. */
  open?: true;
}

/**
 * An L is two rectangles side by side. Zone "a" is the full-depth part,
 * "b" the other leg: shallower for a front notch, starting farther out for a
 * back notch (where the house steps into the deck).
 */
export function shapeZones(shape: DeckShape): Zone[] {
  const W = Math.round(shape.widthFt * 12);
  const D = Math.round(shape.depthFt * 12);
  if (shape.kind === "rect") return [{ id: "a", x0: 0, x1: W, y0: 0, y1: D }];
  // A deck that follows the wall: one zone per part of its back, each framed off the wall behind it.
  // (A part past the house's corner is framed off a beam of its own — `open`.)
  if (shape.kind === "wall") return shape.back.map((b, i) => ({ id: String.fromCharCode(97 + i), x0: Math.round(b.x0Ft * 12), x1: Math.round(b.x1Ft * 12), y0: Math.round(b.yFt * 12), y1: D, ...(b.open ? { open: true as const } : {}) }));
  const nw = Math.round(shape.notch.widthFt * 12);
  const nd = Math.round(shape.notch.depthFt * 12);
  const left = shape.notch.corner.endsWith("left");
  const front = shape.notch.corner.startsWith("front");
  const a: Zone = left ? { id: "a", x0: nw, x1: W, y0: 0, y1: D } : { id: "a", x0: 0, x1: W - nw, y0: 0, y1: D };
  const bx = left ? { x0: 0, x1: nw } : { x0: W - nw, x1: W };
  const b: Zone = front ? { id: "b", ...bx, y0: 0, y1: D - nd } : { id: "b", ...bx, y0: nd, y1: D };
  return [a, b];
}

/** One straight side of the outline, inches. */
export interface DeckEdge {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Which way the side faces: "back" is the house side of the deck. */
  side: "front" | "back" | "left" | "right";
  /** It lies against the house (never for a detached deck). */
  house: boolean;
  lengthIn: number;
}

/** The outline's sides. Collinear sides of two zones are one side. */
export function shapeEdges(shape: DeckShape, placement: Placement): DeckEdge[] {
  const zones = shapeZones(shape);
  const W = Math.round(shape.widthFt * 12);
  const D = Math.round(shape.depthFt * 12);
  const againstHouse = placement !== "detached";
  const edge = (x0: number, y0: number, x1: number, y1: number, side: DeckEdge["side"], house: boolean, lengthIn?: number): DeckEdge => ({ x0, y0, x1, y1, side, house: house && againstHouse, lengthIn: lengthIn ?? Math.abs(x1 - x0) + Math.abs(y1 - y0) });
  if (shape.kind === "rect") {
    // A clipped front shortens the sides; a bowed one lengthens the front (its real length is the arc's).
    const clip = shape.front?.kind === "clipped" ? shape.front.clipFt * 12 : 0;
    return [edge(0, 0, W, 0, "back", true), edge(W, 0, W, D - clip, "right", false), edge(0, D, W, D, "front", false, frontEdgeLengthIn(shape)), edge(0, 0, 0, D - clip, "left", false)];
  }
  if (shape.kind === "wall") {
    // Every part's back lies on the wall, and so does each face where the wall steps between two parts — the side of
    // a bump-out, or of the set-back the deck reaches into.
    // PAST THE HOUSE'S CORNER (2026-11-14): an open part's back is an open edge. The face between two parts is the
    // house's wherever a wall stands on its far side — the part that starts farther out is walled (a bump-out's side,
    // a set-back's, or the house's own SIDE wall where the deck runs back beside it); it is open air where that part
    // is past the corner.
    const out: DeckEdge[] = [];
    zones.forEach((z, i) => {
      out.push(edge(z.x0, z.y0, z.x1, z.y0, "back", !z.open));
      const n = zones[i + 1];
      if (n && n.y0 !== z.y0) out.push(edge(z.x1, Math.min(z.y0, n.y0), z.x1, Math.max(z.y0, n.y0), n.y0 > z.y0 ? "right" : "left", !(n.y0 > z.y0 ? n : z).open));
    });
    out.push(edge(0, D, W, D, "front", false));
    out.push(edge(0, zones[0].y0, 0, D, "left", false));
    out.push(edge(W, zones[zones.length - 1].y0, W, D, "right", false));
    return out;
  }
  const [a, b] = zones;
  const left = shape.notch.corner.endsWith("left");
  const front = shape.notch.corner.startsWith("front");
  const xb = left ? b.x1 : b.x0; // the line the two legs share
  const out: DeckEdge[] = [];
  if (front) {
    out.push(edge(0, 0, W, 0, "back", true));
    out.push(edge(a.x0, D, a.x1, D, "front", false));
    out.push(edge(b.x0, b.y1, b.x1, b.y1, "front", false));
    // The step between the two fronts.
    out.push(edge(xb, b.y1, xb, D, left ? "left" : "right", false));
    out.push(edge(0, 0, 0, left ? b.y1 : D, "left", false));
    out.push(edge(W, 0, W, left ? D : b.y1, "right", false));
  } else {
    // The house steps into the deck: its two faces there are house sides.
    out.push(edge(a.x0, 0, a.x1, 0, "back", true));
    out.push(edge(b.x0, b.y0, b.x1, b.y0, "back", true));
    out.push(edge(xb, 0, xb, b.y0, left ? "left" : "right", true));
    out.push(edge(0, D, W, D, "front", false));
    out.push(edge(0, left ? b.y0 : 0, 0, D, "left", false));
    out.push(edge(W, left ? 0 : b.y0, W, D, "right", false));
  }
  return out;
}

/** The outline as a ring of points, inches, for drawing. */
export function shapeOutline(shape: DeckShape): Array<{ x: number; y: number }> {
  const W = Math.round(shape.widthFt * 12);
  const D = Math.round(shape.depthFt * 12);
  if (shape.kind === "rect") {
    if (shape.front && shape.front.kind === "clipped") {
      const c = shape.front.clipFt * 12;
      return [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: D - c }, { x: W - c, y: D }, { x: c, y: D }, { x: 0, y: D - c }];
    }
    if (shape.front && shape.front.kind === "curve") {
      // The bow as a run of short straight pieces, right to left along the front.
      const n = 8;
      const pts: Array<{ x: number; y: number }> = [{ x: 0, y: 0 }, { x: W, y: 0 }];
      for (let k = 0; k <= n; k++) {
        const x = W - (W * k) / n;
        pts.push({ x, y: frontEdgeAt(shape, x) });
      }
      return pts;
    }
    return [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: D }, { x: 0, y: D }];
  }
  if (shape.kind === "wall") {
    // Along the back, left to right, stepping with the wall; then the right side, the front and the left side.
    const pts: Array<{ x: number; y: number }> = [];
    for (const z of shapeZones(shape)) {
      pts.push({ x: z.x0, y: z.y0 }, { x: z.x1, y: z.y0 });
    }
    pts.push({ x: W, y: D }, { x: 0, y: D });
    return pts.filter((p, i) => {
      const q = pts[(i + pts.length - 1) % pts.length];
      return Math.abs(p.x - q.x) > 0.01 || Math.abs(p.y - q.y) > 0.01;
    });
  }
  const nw = Math.round(shape.notch.widthFt * 12);
  const nd = Math.round(shape.notch.depthFt * 12);
  switch (shape.notch.corner) {
    case "front-right":
      return [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: D - nd }, { x: W - nw, y: D - nd }, { x: W - nw, y: D }, { x: 0, y: D }];
    case "front-left":
      return [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: D }, { x: nw, y: D }, { x: nw, y: D - nd }, { x: 0, y: D - nd }];
    case "back-right":
      return [{ x: 0, y: 0 }, { x: W - nw, y: 0 }, { x: W - nw, y: nd }, { x: W, y: nd }, { x: W, y: D }, { x: 0, y: D }];
    default:
      return [{ x: nw, y: 0 }, { x: W, y: 0 }, { x: W, y: D }, { x: 0, y: D }, { x: 0, y: nd }, { x: nw, y: nd }];
  }
}

export function shapeAreaSqFt(shape: DeckShape): number {
  const rect = shapeZones(shape).reduce((a, z) => a + (z.x1 - z.x0) * (z.y1 - z.y0), 0) / 144;
  if (shape.kind !== "rect" || !shape.front || shape.front.kind === "straight") return rect;
  if (shape.front.kind === "clipped") return rect - shape.front.clipFt * shape.front.clipFt;
  // The circular segment outside the chord: R²·acos((R−s)/R) − (R−s)·√(2Rs − s²).
  const R = frontRadiusFt(shape);
  const s = shape.front.bulgeFt;
  const seg = R * R * Math.acos(Math.min(1, (R - s) / R)) - (R - s) * Math.sqrt(Math.max(0, 2 * R * s - s * s));
  return Math.round((rect + seg) * 100) / 100;
}

/** The size as a contractor says it: "16 ft × 12 ft", inches kept when there are any. */
export function sizeWords(design: DeckDesign): string {
  const ft = (n: number) => {
    const inches = Math.round(n * 12);
    return inches % 12 === 0 ? `${inches / 12} ft` : `${Math.floor(inches / 12)}'-${inches % 12}"`;
  };
  const s = design.shape;
  if (!hasDeck(design)) {
    const p = design.roof.plan;
    if (p.shape === "hexagon" || p.shape === "octagon") return `${ft(p.acrossFt)} ${p.shape}`;
    return p.shape === "square" ? `${ft(p.widthFt)} square` : `${ft(p.widthFt)} × ${ft(p.depthFt)}`;
  }
  const front = s.kind === "rect" && s.front && s.front.kind !== "straight" ? (s.front.kind === "curve" ? " curved front" : " clipped corners") : "";
  const lower = isDoubleDeck(design) ? " double deck" : design.lower.on && design.lower.place === "front" && s.kind !== "L" ? " two levels" : "";
  if (s.kind === "wall") {
    const ends = s.back.filter((b) => b.open);
    const how = !ends.length ? "following the house wall" : ends.some((b) => b.yFt < 0) ? "wrapping round the house" : "running past the house's corner";
    return `${ft(s.widthFt)} × ${ft(s.depthFt)} ${how}${lower}`;
  }
  return s.kind === "rect" ? `${ft(s.widthFt)} × ${ft(s.depthFt)}${front}${lower}` : `${ft(s.widthFt)} × ${ft(s.depthFt)} L-shaped${isDoubleDeck(design) ? lower : ""}`;
}

/** What is being built, as a title: "16 ft × 12 ft covered deck", "12 ft octagon gazebo". */
export function structureWords(design: DeckDesign): string {
  const what = design.structure === "deck" ? "deck" : design.structure === "covered-deck" ? "covered deck" : design.structure;
  return `${sizeWords(design)} ${what}`;
}
