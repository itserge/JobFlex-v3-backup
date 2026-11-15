// THE COMMANDS DECK STUDIO TAKES BY VOICE (2026-10-21) — pure.
//
// One plain language between what was said and what the studio does: the phrase rules (parse.ts) and the AI that reads
// what they could not (actions/deckVoice) both produce these, and one runner (run.ts) carries them out on the design
// through the engine's own normaliser — so a command can never leave a deck the engine cannot build. Every field is
// JSON, so the AI's answer is checked against this shape (schema.ts) before anything runs.

import type { DeckingBrand, DeckingFamily, FramingSpeciesId, RailTypeId, WallTypeId } from "../catalog";
import type { JoistSize, LedgerFastener, LoadPsf, PostSize, SoilPsf, SpacingIn } from "../codeTables";
import type { BeamKind, BeamSize, BeamStyle, CeilingKind, CustomSlot, DeckPattern, FasciaFinish, FixtureKind, FixtureSupply, Floor, FootingType, GutterKind, Handrail, NotchCorner, OwnUnit, PergolaStyle, Placement, RailInfill, RidgeKind, RoofAttach, RoofKind, RoofPlanShape, RoofPostSize, Roofing, SlatSize, StairLanding, StairSide, Structure, WallFill } from "../design";
import type { HouseRoof, QuickWall, RoofColourId, SidingId } from "../house";

/** A number said three ways: "to 20", "by 4 more" (signed), "times 2" ("double the width"). */
export type Amount = { to: number } | { by: number } | { times: number };

export type Align = "left" | "centre" | "right";
export type Tier = "good" | "better" | "best";

/** Where the camera looks from. */
export type Look = "yard" | "top" | "front" | "left" | "right" | "under" | "house" | "spin";

/** A part of the structure to show. */
export type PartName =
  | "deck" | "size" | "height" | "joists" | "beams" | "posts" | "footings" | "ledger" | "decking" | "border" | "fascia" | "frame" | "blocking" | "braces" | "hardware"
  | "rails" | "stairs" | "roof" | "rafters" | "headers" | "gutters" | "ceiling" | "walls" | "slats" | "cupola" | "roof-posts" | "slab"
  | "lights" | "spa" | "lower" | "house" | "electrical";

/** What a question asks about. */
export type Question =
  | "compare"
  | "concrete" | "footings" | "boards" | "screws" | "lumber" | "joists" | "beams" | "posts" | "ledger" | "price" | "perSqFt" | "labor" | "area" | "height"
  | "stairs" | "rail" | "permit" | "code" | "checks" | "layout" | "frame" | "frost" | "snow" | "load" | "roof" | "electrical" | "spa" | "time" | "colors"
  | "options" | "what" | "help" | "weight" | "lower" | "hardware" | "wind";

export interface RoofSet {
  kind?: RoofKind;
  pitch?: Amount;
  eaveIn?: Amount;
  overhangIn?: Amount;
  roofing?: Roofing;
  ceiling?: CeilingKind;
  gutters?: GutterKind;
  guards?: boolean;
  cupola?: boolean;
  soffit?: boolean;
  fasciaFinish?: FasciaFinish;
  walls?: WallFill;
  wallSides?: number;
  pergolaStyle?: PergolaStyle;
  slatSize?: SlatSize;
  slatSpacingIn?: Amount;
  planShape?: RoofPlanShape;
  widthFt?: Amount;
  depthFt?: Amount;
  acrossFt?: Amount;
  offsetFt?: Amount;
  attach?: RoofAttach;
  post?: RoofPostSize;
  ridge?: RidgeKind;
  crossBeams?: number;
  braces?: boolean;
  /** Headers: the least-cost pick, engineered LVL throughout, or a size. */
  header?: BeamSize | "auto" | "lvl";
  rafter?: JoistSize | "auto";
  rafterSpacingIn?: 12 | 16 | 24;
  load?: "auto" | 20 | 30 | 50 | 70;
  roofDeck?: "sheathing" | "purlins";
  fasciaEave?: boolean;
  fasciaRake?: boolean;
}

export interface DeckingSet {
  /** A product id from the catalog (lib/deck/catalog DECKING). */
  product?: string;
  /** A colour named by its reference word (see COLORS): the closest board in the family or brand. */
  color?: string;
  shade?: "lighter" | "darker";
  family?: DeckingFamily;
  brand?: DeckingBrand;
  tier?: Tier;
  /** The board's thickness, where the species comes in both: 5/4 or 2x6. */
  thick?: "54" | "2x6";
  pattern?: DeckPattern;
  border?: 0 | 1 | 2;
  /** Breaker boards across the field (2026-11-14; lib/deck/surface): none, one in the middle, two at the thirds. */
  breakers?: 0 | 1 | 2;
  fastening?: "auto" | "screws" | "hidden";
  fascia?: "auto" | "none" | "match";
  wastePct?: number;
}

export interface FramingSet {
  species?: FramingSpeciesId;
  /** A size, the code's pick, or one size up or down from what stands now. */
  joist?: JoistSize | "auto" | "up" | "down";
  spacingIn?: SpacingIn | "auto";
  beam?: BeamSize | "auto";
  beamKind?: BeamKind;
  beamStyle?: BeamStyle | "auto";
  post?: PostSize;
  overhangFt?: number | "auto";
  doubleRim?: boolean;
  joistTape?: boolean;
  braces?: boolean;
  blocking?: "auto" | "mid-span";
}

export interface RailSet {
  type?: RailTypeId;
  heightIn?: 36 | 42;
  infill?: RailInfill | "auto";
  postSpacingFt?: 4 | 6 | 8;
  cap?: boolean;
  lowerLevel?: boolean;
  customName?: string;
  customPerFt?: number;
  /** How the posts meet the deck (2026-11-13): on the boards, or on the rim — for every side, or for `mountSide` alone. */
  mount?: "top" | "side";
  mountSide?: "front" | "left" | "right" | "back";
}

/** Which stair a command means: by its side, by its order, the last one talked about, or all of them. */
export type StairPick = { side: StairSide } | { index: number } | "last" | "all" | "only";
/** Where along its edge: an end, the middle, a distance from the start of the edge, or a slide by so much. */
export type StairAt = "left" | "center" | "right" | "house" | "out" | { ft: number } | { by: number };

/**
 * A LANDING ON A STAIR, AS IT IS SAID (2026-11-14): "add a landing", "take the landings out", or the way the stairs go
 * on from it — to the left or the right AS THE DECK IS SEEN from the yard, toward the house, out to the yard, back
 * beside the flight above, or straight on. `turnAtIn` is the landing's height above the ground.
 */
/** "Run the deck 6 ft past the house on the right", "wrap it round the left side 10 ft", "stop at the corner". */
export interface DeckPastSaid {
  side: "left" | "right" | "both";
  ft?: number;
  backFt?: number;
  wrap?: boolean;
  off?: boolean;
}
export type StairTurnSaid = "add" | "remove" | "straight" | "left" | "right" | "house" | "yard" | "back";

export type DeckCommand =
  | { do: "size"; width?: Amount; depth?: Amount; areaSqFt?: number; square?: boolean; from?: "left" | "right" | "house" }
  | { do: "height"; in: Amount }
  // `parts` (2026-11-14): the front set part by part — a T (the middle comes out), a U (the two ends come out), or
  // deeper on one side; `partWidthFt` the part that comes out, `outFt` how far.
  | { do: "shape"; kind: "rect" | "L" | "curve" | "clipped" | "parts"; corner?: NotchCorner; notchWidthFt?: number; notchDepthFt?: number; bulgeFt?: number; clipFt?: number; preset?: "t" | "u" | "left" | "right"; partWidthFt?: number; outFt?: number }
  | { do: "slide"; ft: number | "center" }
  | { do: "placement"; to: Placement }
  | { do: "wall"; to: WallTypeId }
  | { do: "structure"; to: Structure }
  | { do: "floor"; to: Floor }
  | { do: "roof"; set: RoofSet }
  | { do: "decking"; set: DeckingSet }
  | { do: "framing"; set: FramingSet }
  | { do: "ledger"; fastener?: LedgerFastener; lateral?: "two" | "four" }
  | { do: "footing"; type?: FootingType; aboveGradeIn?: number; frostAlways?: boolean }
  | { do: "site"; frostIn?: Amount; snowPsf?: number; loadPsf?: LoadPsf; soilPsf?: SoilPsf; outDropIn?: number; acrossDropIn?: number; state?: string }
  | { do: "rail"; set: RailSet }
  | { do: "stairs"; op: "add" | "remove" | "change"; which?: StairPick; side?: StairSide; at?: StairAt; width?: Amount; wrap?: boolean; wrapSides?: 1 | 3 | 4; landing?: StairLanding; handrail?: Handrail; level?: "upper" | "lower"; count?: number; flip?: boolean; turn?: StairTurnSaid; turnAtIn?: number }
  // `place: "under"` is a DOUBLE DECK (2026-11-13): a deck of the same size under this one; `heightIn` — how high that lower deck stands above the ground.
  | { do: "lower"; on?: boolean; width?: Amount; depth?: Amount; dropIn?: Amount; align?: Align; place?: "front" | "under"; heightIn?: Amount }
  | { do: "spa"; on?: boolean; width?: Amount; depth?: Amount; align?: Align }
  | { do: "fixture"; op: "add" | "remove" | "set"; kind: FixtureKind; qty?: Amount; supply?: FixtureSupply; volts240?: boolean }
  | { do: "electrical"; timer?: boolean; feedFt?: number; panelSide?: "left" | "right" }
  // `past` (2026-11-14): the DECK run past a corner of the house — `ft` beyond the corner, `backFt` back along the
  // house's side (`wrap` = a wrap-around said without a length), `off` = back to the corner.
  | { do: "house"; storeys?: 1 | 2; roof?: HouseRoof; siding?: SidingId; roofColour?: RoofColourId; wall?: QuickWall; leftFt?: Amount; rightFt?: Amount; widthFt?: number; past?: DeckPastSaid }
  | { do: "extras"; demoSqFt?: number | "deck"; stainless?: boolean; drain?: boolean; skirt?: "lattice" | "boards" | "none" }
  | { do: "item"; op: "add" | "remove"; name: string; qty?: number; unit?: OwnUnit; price?: number }
  /** A built-in bench or planter box along one edge (2026-11-14; lib/deck/builtins). `at`: which end of that edge it stands toward. */
  | { do: "builtin"; op: "add" | "remove"; kind: "bench" | "bench-back" | "planter" | "screen" | "kitchen" | "fire"; side?: "front" | "left" | "right"; lengthFt?: number; at?: "left" | "centre" | "right"; /** A privacy screen's height, ft. */ heightFt?: number; /** A fire table: how far in from the edge, ft. */ inFt?: number }
  /** A product of the shop's own in one of the studio's lists ("our own boards, Azek Timbertech, at 9 dollars a foot"). */
  | { do: "custom"; slot: CustomSlot; name: string; price: number }
  | { do: "sample"; id: string }
  | { do: "autofix" }
  | { do: "reset" }
  | { do: "undo" }
  | { do: "redo" }
  | { do: "view"; tab?: "3d" | "plan" | "wall"; xray?: boolean; night?: boolean; connections?: boolean; build?: "play" | "stop" | "done"; full?: boolean; reset?: boolean; look?: Look; edit?: boolean }
  | { do: "show"; part: PartName; fixture?: FixtureKind }
  | { do: "ask"; q: Question; about?: string }
  | { do: "whatif"; then: DeckCommand[]; words: string }
  | { do: "compare"; options: Array<{ words: string; then: DeckCommand[] }> }
  | { do: "open"; what: "permit" | "yard" | "installer" | "package" | "checks" }
  | { do: "go"; to: "kind" | "size" | "house" | "materials" | "stairs" | "accessories" | "roof" | "extras" | "checks" | "package" }
  | { do: "name"; title: string }
  | { do: "address"; text: string }
  | { do: "save" }
  | { do: "help"; topic?: string }
  | { do: "wish"; text: string; item?: string }
  | { do: "teach"; phrase: string; words: string }
  | { do: "forget"; phrase?: string }
  | { do: "confirm"; yes: boolean }
  | { do: "mute"; on: boolean }
  | { do: "stop" }
  | { do: "keep"; what: string };

export type CommandKind = DeckCommand["do"];

/** Commands that change the design (the rest look, answer or steer). */
export const CHANGES: ReadonlySet<CommandKind> = new Set<CommandKind>(["custom", "size", "height", "shape", "slide", "placement", "wall", "structure", "floor", "roof", "decking", "framing", "ledger", "footing", "site", "rail", "stairs", "lower", "spa", "fixture", "electrical", "house", "extras", "item", "builtin", "sample", "autofix", "reset"]);

/* ------------------------------------------------------------------ */
/*  The words for the catalog's own things                            */
/* ------------------------------------------------------------------ */

/**
 * Decking by name — the longest names first, so "Trex Transcend Lineage" wins over "Trex Transcend" over "Trex". A
 * brand said alone takes its best-selling line (Trex: Enhance Naturals, Home Depot's best seller).
 */
export const DECKING_NAMES: ReadonlyArray<[RegExp, string]> = [
  [/\btrex enhance basics?\b|\benhance basics?\b/, "trex-enhance-basics"],
  [/\btrex enhance naturals?\b|\benhance naturals?\b|\btrex enhance\b/, "trex-enhance-naturals"],
  [/\btrex select\b/, "trex-select"],
  [/\btrex transcend lineage\b|\btranscend lineage\b|\blineage\b/, "trex-transcend-lineage"],
  [/\btrex transcend\b|\btranscend\b/, "trex-transcend"],
  [/\btrex\b/, "trex-enhance-naturals"],
  [/\btimbertech prime (?:plus|\+)|\bprime (?:plus|\+)/, "timbertech-prime-plus"],
  [/\btimbertech prime\b/, "timbertech-prime"],
  [/\b(?:timbertech )?(?:pro )?reserve\b/, "timbertech-reserve"],
  [/\b(?:timbertech )?azek harvest\b|\bharvest collection\b/, "timbertech-azek-harvest"],
  [/\b(?:timbertech )?azek vintage\b|\bvintage collection\b/, "timbertech-azek-vintage"],
  [/\b(?:timbertech )?azek landmark\b|\blandmark collection\b/, "timbertech-azek-landmark"],
  [/\bazek\b/, "timbertech-azek-harvest"],
  [/\btimbertech\b/, "timbertech-prime-plus"],
  [/\b(?:fiberon )?armorguard\b/, "fiberon-armorguard"],
  [/\b(?:fiberon )?good ?life\b/, "fiberon-good-life"],
  [/\b(?:fiberon )?sanctuary\b/, "fiberon-sanctuary"],
  [/\b(?:fiberon )?concordia\b/, "fiberon-concordia"],
  [/\b(?:fiberon )?paramount\b/, "fiberon-paramount"],
  [/\bfiberon\b/, "fiberon-good-life"],
  [/\b(?:deckorators )?summit\b/, "deckorators-summit"],
  [/\b(?:deckorators )?voyage\b/, "deckorators-voyage"],
  [/\b(?:deckorators )?vista\b/, "deckorators-vista"],
  [/\bdeckorators\b|\bsurestone\b/, "deckorators-vista"],
  [/\bmoistureshield\b/, "moistureshield-vision"],
  [/\bveranda\b/, "veranda-composite"],
  [/\barmadillo\b/, "armadillo-expression"],
  [/\b(?:envision )?distinction\b/, "envision-distinction"],
  [/\b(?:envision )?expression\b|\benvision\b/, "envision-expression"],
  [/\bdura ?life\b/, "duralife-landscapes"],
  [/\bwolf\b|\bserenity\b/, "wolf-serenity"],
  [/\bnew ?tech ?wood\b|\bultra ?shield\b/, "newtechwood-ultrashield"],
  [/\blumbe?rock\b/, "lumberock-mineral"],
  [/\bcali ?bamboo\b|\btru ?organics\b/, "calibamboo-truorganics"],
  [/\bipe 5\/4\b|\b5\/4 ipe\b/, "ipe-54"],
  [/\bipe\b|\bbrazilian walnut\b/, "ipe-1x6"],
  [/\bcumaru\b|\bbrazilian teak\b/, "cumaru-1x6"],
  [/\btiger ?wood\b/, "tigerwood-1x6"],
  [/\bgarapa\b/, "garapa-1x6"],
  [/\bmassaranduba\b|\bbrazilian redwood\b/, "massaranduba-1x6"],
  [/\bmahogany\b|\bmeranti\b|\bbalau\b/, "mahogany-54"],
  [/\b(?:black )?locust\b/, "black-locust-54"],
  [/\bbamboo\b/, "bamboo-1x6"],
  [/\bthermo(?:ally)?(?:[- ]modified)? ash\b|\bthermo ?ash\b/, "thermo-ash-54"],
  [/\bthermo(?:ally)?(?:[- ]modified)? pine\b|\bthermo ?pine\b/, "thermo-pine-54"],
  [/\baccoya\b/, "accoya-54"],
  [/\bkebony\b/, "kebony-54"],
  [/\byellow cedar\b|\balaskan cedar\b/, "yellow-cedar-2x6"],
  [/\bcypress\b/, "cypress-54"],
  [/\bkiln[- ]?dried\b|\bkdat\b/, "pt-kdat-54"],
  [/\bmineral(?:[- ]based)?\b/, "mineral"],
  [/\bpvc\b|\bcellular pvc\b|\bplastic\b/, "pvc"],
  [/\baluminum (?:decking|deck boards?|planks?|deck)\b/, "aluminum"],
];

/** The trade's word for each family — what "composite", "cedar", "treated" mean when no product is named. */
export const DECKING_FAMILY_WORDS: ReadonlyArray<[RegExp, DeckingFamily]> = [
  [/\bcomposite\b|\bcomposites\b|\bcapped\b|\bsynthetic\b|\bman[- ]made\b|\blow[- ]maintenance\b|\bno maintenance\b/, "composite"],
  [/\bpressure treated\b|\btreated\b|\bpt\b|\bwolmanized\b|\bgreen treated\b/, "treated"],
  [/\bcedar\b|\bredwood\b|\bsoftwood\b/, "softwood"],
  [/\bhardwood\b|\bexotic\b|\btropical\b/, "hardwood"],
  [/\bmodified wood\b|\bthermally modified\b/, "modified"],
];

/** Reference colours for decking, with the words people use for them. */
export const COLORS: ReadonlyArray<{ id: string; hex: string; words: RegExp }> = [
  { id: "dark gray", hex: "#4b4946", words: /\b(?:dark gr[ae]y|charcoal|slate|graphite|ash gr[ae]y|storm|smoke)\b/ },
  { id: "light gray", hex: "#a39f98", words: /\b(?:light gr[ae]y|silver|pebble|dove|driftwood|weathered|whitewash(?:ed)?|white|coastal|beach)\b/ },
  { id: "gray", hex: "#8a857e", words: /\b(?:gr[ae]y|greige|stone)\b/ },
  { id: "black", hex: "#3a3734", words: /\b(?:black|ebony|jet)\b/ },
  { id: "dark brown", hex: "#4f3b2f", words: /\b(?:dark brown|espresso|chocolate|coffee|walnut|java|deep brown|dark wood|dark)\b/ },
  { id: "reddish brown", hex: "#7a4a36", words: /\b(?:reddish brown|red brown|cedar tone|chestnut|auburn|cinnamon|spiced|rust brown|mahogany colou?r)\b/ },
  { id: "red", hex: "#8c3f2c", words: /\b(?:red|reddish|rust|redwood colou?r|cedar red|cherry|burgundy|copper)\b/ },
  { id: "light brown", hex: "#b08a62", words: /\b(?:light brown|tan|sand|beige|honey|natural|blonde|golden|amber|cedar colou?r|light wood|light|toasted|caramel|saddle)\b/ },
  { id: "brown", hex: "#6f5440", words: /\b(?:brown|brownish|wood colou?r|wood tone|medium brown|teak|spice|clay)\b/ },
];

/** The house's siding colours, by the words for them. */
export const SIDING_WORDS: ReadonlyArray<[RegExp, SidingId]> = [
  [/\b(?:white|bright white|off white)\b/, "white"],
  [/\b(?:cream|beige|tan|yellow|ivory|almond|sand|khaki)\b/, "cream"],
  [/\b(?:blue|blue gr[ae]y|navy|light blue)\b/, "blue"],
  [/\b(?:sage|green|olive|mint)\b/, "sage"],
  [/\b(?:gr[ae]y|silver|charcoal|slate)\b/, "grey"],
];

/** The house's roof colours. */
export const ROOF_COLOUR_WORDS: ReadonlyArray<[RegExp, RoofColourId]> = [
  [/\b(?:charcoal|black|dark gr[ae]y|onyx)\b/, "charcoal"],
  [/\b(?:brown|wood|bark|chestnut)\b/, "brown"],
  [/\b(?:slate|gr[ae]y|blue gr[ae]y|silver)\b/, "slate"],
  [/\b(?:forest|green|hunter green|evergreen)\b/, "forest"],
  [/\b(?:terracotta|terra cotta|red|orange|clay|spanish|tile)\b/, "terracotta"],
];

/** Fixtures, by what people call them — the most specific first. */
export const FIXTURE_WORDS: ReadonlyArray<[RegExp, FixtureKind]> = [
  [/\b(?:post ?cap lights?|lit (?:post )?caps?|solar (?:post )?caps?|cap lights?|post lights?|lights? on the posts)\b/, "post-cap"],
  [/\b(?:stair lights?|step lights?|riser lights?|lights? (?:on|in|for) the (?:stairs|steps|risers)|stair lighting|light (?:up )?the (?:stairs|steps)|lit (?:stairs|steps))\b/, "step-light"],
  [/\b(?:string lights?|bistro lights?|cafe lights?|party lights?|edison (?:bulbs?|lights?)|fairy lights?|market lights?|festoon lights?)\b/, "string-light"],
  [/\b(?:led strips?|strip lights?|tape lights?|rope lights?|under[- ]?rail (?:lights?|lighting|leds?)|accent lights?|led lighting|leds|led lights?|rail(?:ing)? lights?|lights? (?:under|beneath|below|along) the (?:top |cap )?(?:rail(?:ing)?s?|headers?|beams?|benches?))\b/, "led-strip"],
  [/\b(?:sconces?|wall lights?|lanterns?|coach lights?|wall lamps?|porch lights?|door lights?|lights? (?:over|by|above|next to|beside) the (?:door|back door|slider|patio door))\b/, "sconce"],
  [/\b(?:chandeliers?|pendants?|pendant lights?)\b/, "chandelier"],
  [/\b(?:ceiling fans?|fans?)\b/, "fan"],
  [/\b(?:ceiling lights?|can lights?|recessed (?:lights?|lighting|cans)|pot lights?|down ?lights?|lights? in the (?:roof|ceiling))\b/, "ceiling-light"],
  [/\b(?:heaters?|heat lamps?|patio heaters?|infrared heaters?|space heaters?|heating)\b/, "heater"],
  [/\b(?:flood ?lights?|security lights?|motion lights?|spot ?lights?|motion sensor lights?)\b/, "flood"],
  [/\b(?:outlets?|plugs?|receptacles?|gfci|power outlets?|tv (?:outlet|power|plug))\b/, "outlet"],
];

/** The short name of each fixture, for talking back. */
export const FIXTURE_SAY: Record<FixtureKind, [string, string]> = {
  "led-strip": ["LED strip", "LED strips"],
  "post-cap": ["lit post cap", "lit post caps"],
  "step-light": ["stair light", "stair lights"],
  "string-light": ["string of lights", "string lights"],
  sconce: ["sconce", "sconces"],
  "ceiling-light": ["ceiling light", "ceiling lights"],
  chandelier: ["chandelier", "chandeliers"],
  fan: ["ceiling fan", "ceiling fans"],
  outlet: ["outlet", "outlets"],
  heater: ["patio heater", "patio heaters"],
  flood: ["flood light", "flood lights"],
};

/** Things people ask for that the studio has no drawing of (yet): said back by name, priced as the contractor's own item. */
export const NOT_DRAWN: ReadonlyArray<[RegExp, string]> = [
  [/\bfire ?place\b|\bchimney\b/, "Outdoor fireplace"],
  [/\bpool\b|\bswimming pool\b/, "Pool"],
  // (An outdoor kitchen island and a gas fire table are drawn — lib/deck/builtins, read before this list.)
  [/\bsink\b|\bcountertops?\b/, "Sink and countertop"],
  [/\bbar\b|\bbar top\b|\bbar counter\b/, "Bar counter"],
  [/\btv\b|\btelevision\b/, "TV mount"],
  [/\bspeakers?\b|\bsound system\b|\baudio\b/, "Outdoor speakers"],
  [/\bhammock\b/, "Hammock posts"],
  [/\bswing\b|\bporch swing\b/, "Porch swing"],
  [/\bgate\b|\bdog gate\b|\bbaby gate\b/, "Rail gate"],
  [/\bshade sail\b|\bsun ?shade\b|\bawning\b|\bretractable\b/, "Retractable awning"],
  [/\bstorage\b|\bshed\b|\bunder[- ]deck storage\b/, "Storage"],
  [/\bramp\b|\bwheelchair\b|\bada\b/, "Ramp"],
  // An open deck's privacy ("privacy on one side", "more privacy" — lib/deck/voice/words EVERYDAY); a covered deck's
  // "privacy walls / panels / screens" are its walls (parse ROOF_WORDS) and never reach this list.
  // (On an OPEN deck "a privacy fence / screen" is drawn — a privacy screen on its edge, lib/deck/builtins, read before
  // this list; what is left here is the same wish on a design with a roof over it.)
  [/\bprivacy fence\b/, "Privacy screen"],
  [/\btrellis\b|\bprivacy trellis\b/, "Privacy trellis"],
  [/\bhot water\b|\bwater line\b|\bhose bib\b|\bspigot\b/, "Water line"],
  [/\bgas line\b|\bnatural gas\b|\bpropane\b/, "Gas line"],
  [/\bstain(?:ing)?\b|\bseal(?:ing|er)?\b|\bpaint(?:ing)?\b/, "Stain and seal"],
  [/\bhelical piles?\b|\bscrew piles?\b|\bhelical piers?\b/, "Helical piles"],
];

/** How people name each sample to start from (lib/deck/samples ids). */
export const SAMPLE_WORDS: ReadonlyArray<[RegExp, string]> = [
  [/\bhot tub\b|\bspa\b/, "deck-spa"],
  [/\bsecond[- ]story\b.*\bcover|\bcover.*\bsecond[- ]story\b/, "covered-second-story"],
  [/\bsecond[- ]story\b|\bwalkout\b|\bupper\b/, "deck-second-story"],
  [/\btwo[- ]level|\bmulti[- ]level|\btwo tier\b|\blanding\b/, "deck-two-level"],
  [/\bground[- ]level\b|\bplatform\b|\blow\b/, "deck-ground"],
  [/\bwrap[- ]?around\b|\bl[- ]shaped?\b/, "deck-wrap"],
  [/\bhip\b/, "covered-hip"],
  [/\bshed roof\b|\blean[- ]?to\b/, "covered-shed"],
  [/\bgable\b|\bcovered\b/, "covered-gable"],
  [/\boctagon\b|\bslab\b/, "gazebo-octagon"],
  [/\bscreened\b|\btwo[- ]tier roof\b|\bpagoda\b/, "gazebo-screened"],
  [/\bgazebo\b/, "gazebo-square-deck"],
  [/\blouver/, "pergola-louvered"],
  [/\barched?\b/, "pergola-arched"],
  [/\bpergola\b/, "pergola-attached"],
  [/\bclassic\b|\bbasic\b|\bsimple\b|\bbackyard\b|\bstandard\b|\bdeck\b/, "deck-classic"],
];
