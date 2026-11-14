// THE COMMANDS' SHAPE, CHECKED (2026-10-21) — pure.
//
// What the AI reads out of a sentence the rules could not (actions/deckVoice) is checked against this before anything
// runs: each command on its own, so one malformed command drops alone and the rest still run. Every value is held to
// the catalog's own lists — a product id the catalog does not have, a roof kind the engine does not build, is refused
// here, never passed on to be guessed at.

import { z } from "zod";
import { DECKING } from "../catalog";
import { DECK_SAMPLES } from "../samples";
import type { DeckCommand } from "./commands";

const amount = z.union([z.object({ to: z.number().finite() }), z.object({ by: z.number().finite() }), z.object({ times: z.number().finite().positive().max(4) })]);
const align = z.enum(["left", "centre", "right"]);
const side = z.enum(["front", "left", "right"]);
const fixtureKind = z.enum(["led-strip", "post-cap", "step-light", "string-light", "sconce", "ceiling-light", "chandelier", "fan", "outlet", "heater", "flood"]);
const products = DECKING.map((p) => p.id) as [string, ...string[]];
const samples = DECK_SAMPLES.map((s) => s.id) as [string, ...string[]];

const roofSet = z
  .object({
    kind: z.enum(["shed", "gable", "hip", "pyramid", "double-tier", "gambrel", "dutch-gable", "pergola"]),
    pitch: amount,
    eaveIn: amount,
    overhangIn: amount,
    roofing: z.enum(["arch-shingle", "3tab-shingle", "designer-shingle", "cedar-shake", "metal-panel", "standing-seam", "none"]),
    ceiling: z.enum(["none", "tongue-groove", "beadboard"]),
    gutters: z.enum(["none", "k5", "k6", "half-round-alum", "half-round-copper"]),
    guards: z.boolean(),
    cupola: z.boolean(),
    soffit: z.boolean(),
    fasciaFinish: z.enum(["wood", "pvc", "aluminum-wrap"]),
    walls: z.enum(["none", "screen", "lattice", "solid"]),
    wallSides: z.number().int().min(1).max(16),
    pergolaStyle: z.enum(["flat", "louvered", "arched"]),
    slatSize: z.enum(["2x2", "2x4", "2x6"]),
    slatSpacingIn: amount,
    planShape: z.enum(["follows-deck", "square", "rect", "hexagon", "octagon", "round"]),
    widthFt: amount,
    depthFt: amount,
    acrossFt: amount,
    offsetFt: amount,
    attach: z.enum(["wall", "free"]),
    post: z.enum(["4x4", "6x6", "8x8"]),
    ridge: z.enum(["auto", "beam", "board", "none", "trusses"]),
    crossBeams: z.number().int().min(0).max(3),
    braces: z.boolean(),
    header: z.enum(["auto", "lvl", "4x6", "4x8", "4x10", "4x12", "2-2x6", "2-2x8", "2-2x10", "2-2x12", "3-2x8", "3-2x10", "3-2x12"]),
    rafter: z.enum(["auto", "2x6", "2x8", "2x10", "2x12"]),
    rafterSpacingIn: z.union([z.literal(12), z.literal(16), z.literal(24)]),
    load: z.union([z.literal("auto"), z.literal(20), z.literal(30), z.literal(50), z.literal(70)]),
    roofDeck: z.enum(["sheathing", "purlins"]),
    fasciaEave: z.boolean(),
    fasciaRake: z.boolean(),
  })
  .partial();

const COMMAND = z.discriminatedUnion("do", [
  z.object({ do: z.literal("size"), width: amount.optional(), depth: amount.optional(), areaSqFt: z.number().positive().max(2400).optional(), square: z.boolean().optional(), from: z.enum(["left", "right", "house"]).optional() }),
  z.object({ do: z.literal("height"), in: amount }),
  z.object({ do: z.literal("shape"), kind: z.enum(["rect", "L", "curve", "clipped", "parts"]), corner: z.enum(["front-left", "front-right", "back-left", "back-right"]).optional(), notchWidthFt: z.number().positive().optional(), notchDepthFt: z.number().positive().optional(), bulgeFt: z.number().positive().optional(), clipFt: z.number().positive().optional(), preset: z.enum(["t", "u", "left", "right"]).optional(), partWidthFt: z.number().positive().optional(), outFt: z.number().positive().optional() }),
  z.object({ do: z.literal("slide"), ft: z.union([z.number().finite(), z.literal("center")]) }),
  z.object({ do: z.literal("placement"), to: z.enum(["attached", "beside", "detached"]) }),
  z.object({ do: z.literal("wall"), to: z.enum(["wood-rim", "engineered-rim", "foam-sheathing", "concrete", "brick-veneer", "hollow-block", "cantilever", "open-truss", "sip-icf", "unknown"]) }),
  z.object({ do: z.literal("structure"), to: z.enum(["deck", "covered-deck", "gazebo", "pergola"]) }),
  z.object({ do: z.literal("floor"), to: z.enum(["deck", "slab", "existing", "ground"]) }),
  z.object({ do: z.literal("roof"), set: roofSet }),
  z.object({
    do: z.literal("decking"),
    set: z
      .object({
        product: z.enum(products),
        color: z.enum(["dark gray", "light gray", "gray", "black", "dark brown", "reddish brown", "red", "light brown", "brown"]),
        shade: z.enum(["lighter", "darker"]),
        family: z.enum(["treated", "softwood", "hardwood", "modified", "composite", "pvc", "mineral", "aluminum"]),
        tier: z.enum(["good", "better", "best"]),
        thick: z.enum(["54", "2x6"]),
        pattern: z.enum(["straight", "diagonal", "herringbone"]),
        border: z.union([z.literal(0), z.literal(1), z.literal(2)]),
        breakers: z.union([z.literal(0), z.literal(1), z.literal(2)]),
        fastening: z.enum(["auto", "screws", "hidden"]),
        fascia: z.enum(["auto", "none", "match"]),
        wastePct: z.number().min(0).max(30),
      })
      .partial(),
  }),
  z.object({
    do: z.literal("framing"),
    set: z
      .object({
        species: z.enum(["southern-pine", "hem-fir", "douglas-fir", "spf", "ponderosa-pine", "red-pine", "redwood", "western-cedar"]),
        joist: z.enum(["2x6", "2x8", "2x10", "2x12", "auto", "up", "down"]),
        spacingIn: z.union([z.literal(12), z.literal(16), z.literal(24), z.literal("auto")]),
        beam: z.enum(["4x6", "4x8", "4x10", "4x12", "2-2x6", "2-2x8", "2-2x10", "2-2x12", "3-2x8", "3-2x10", "3-2x12", "auto"]),
        beamKind: z.enum(["solid", "built-up"]),
        beamStyle: z.enum(["dropped", "flush", "auto"]),
        post: z.enum(["4x4", "4x6", "6x6", "8x8"]),
        overhangFt: z.union([z.number().min(0).max(4), z.literal("auto")]),
        doubleRim: z.boolean(),
        joistTape: z.boolean(),
        braces: z.boolean(),
        blocking: z.enum(["auto", "mid-span"]),
      })
      .partial(),
  }),
  z.object({ do: z.literal("ledger"), fastener: z.enum(["lag", "bolt", "bolt-gap", "ledgerlok", "sdws", "anchor"]).optional(), lateral: z.enum(["two", "four"]).optional() }),
  z.object({ do: z.literal("footing"), type: z.enum(["poured", "pier-block"]).optional(), aboveGradeIn: z.number().min(0).max(12).optional(), frostAlways: z.boolean().optional() }),
  z.object({ do: z.literal("site"), frostIn: amount.optional(), snowPsf: z.number().min(0).max(300).optional(), loadPsf: z.union([z.literal(40), z.literal(50), z.literal(60), z.literal(70)]).optional(), soilPsf: z.union([z.literal(1500), z.literal(2000), z.literal(3000)]).optional(), outDropIn: z.number().min(-120).max(120).optional(), acrossDropIn: z.number().min(-120).max(120).optional(), state: z.string().regex(/^[A-Z]{2}$/).optional() }),
  z.object({
    do: z.literal("rail"),
    set: z
      .object({
        type: z.enum(["none", "treated", "cedar", "composite", "vinyl", "aluminum", "cable", "glass", "custom"]),
        heightIn: z.union([z.literal(36), z.literal(42)]),
        infill: z.enum(["balusters", "cable", "glass", "panel", "horizontal", "auto"]),
        postSpacingFt: z.union([z.literal(4), z.literal(6), z.literal(8)]),
        cap: z.boolean(),
        lowerLevel: z.boolean(),
        customName: z.string().max(80),
        customPerFt: z.number().min(0).max(1000),
        mount: z.enum(["top", "side"]),
        mountSide: z.enum(["front", "left", "right", "back"]),
      })
      .partial(),
  }),
  z.object({
    do: z.literal("stairs"),
    op: z.enum(["add", "remove", "change"]),
    which: z.union([z.object({ side }), z.object({ index: z.number().int().min(0).max(5) }), z.enum(["last", "all", "only"])]).optional(),
    side: side.optional(),
    at: z.union([z.enum(["left", "center", "right", "house", "out"]), z.object({ ft: z.number().finite() }), z.object({ by: z.number().finite() })]).optional(),
    width: amount.optional(),
    wrap: z.boolean().optional(),
    wrapSides: z.union([z.literal(1), z.literal(3), z.literal(4)]).optional(),
    landing: z.enum(["pad", "patio", "grade"]).optional(),
    handrail: z.enum(["auto", "both", "one", "none"]).optional(),
    level: z.enum(["upper", "lower"]).optional(),
    count: z.number().int().min(1).max(2).optional(),
    flip: z.boolean().optional(),
    turn: z.enum(["add", "remove", "straight", "left", "right", "house", "yard", "back"]).optional(),
    turnAtIn: z.number().min(8).max(348).optional(),
  }),
  z.object({ do: z.literal("lower"), on: z.boolean().optional(), width: amount.optional(), depth: amount.optional(), dropIn: amount.optional(), align: align.optional(), place: z.enum(["front", "under"]).optional(), heightIn: amount.optional() }),
  z.object({ do: z.literal("spa"), on: z.boolean().optional(), width: amount.optional(), depth: amount.optional(), align: align.optional() }),
  z.object({ do: z.literal("fixture"), op: z.enum(["add", "remove", "set"]), kind: fixtureKind, qty: amount.optional(), supply: z.enum(["we", "client"]).optional(), volts240: z.boolean().optional() }),
  z.object({ do: z.literal("electrical"), timer: z.boolean().optional(), feedFt: z.number().min(5).max(300).optional(), panelSide: z.enum(["left", "right"]).optional() }),
  z.object({ do: z.literal("house"), storeys: z.union([z.literal(1), z.literal(2)]).optional(), roof: z.enum(["hip", "gable"]).optional(), siding: z.enum(["white", "cream", "grey", "blue", "sage"]).optional(), roofColour: z.enum(["charcoal", "brown", "slate", "forest", "terracotta"]).optional(), wall: z.enum(["straight", "bump-right", "bump-left", "nook"]).optional(), leftFt: amount.optional(), rightFt: amount.optional(), widthFt: z.number().min(4).max(200).optional(), past: z.object({ side: z.enum(["left", "right", "both"]), ft: z.number().min(0).max(30).optional(), backFt: z.number().min(0).max(24).optional(), wrap: z.boolean().optional(), off: z.boolean().optional() }).optional() }),
  z.object({ do: z.literal("extras"), demoSqFt: z.union([z.number().min(0).max(4000), z.literal("deck")]).optional(), stainless: z.boolean().optional(), drain: z.boolean().optional(), skirt: z.enum(["lattice", "boards", "none"]).optional() }),
  z.object({ do: z.literal("builtin"), op: z.enum(["add", "remove"]), kind: z.enum(["bench", "bench-back", "planter", "screen"]), side: z.enum(["front", "left", "right"]).optional(), lengthFt: z.number().min(2).max(30).optional(), at: z.enum(["left", "centre", "right"]).optional(), heightFt: z.number().min(3).max(8).optional() }),
  z.object({ do: z.literal("item"), op: z.enum(["add", "remove"]), name: z.string().min(1).max(80), qty: z.number().min(0).max(100000).optional(), unit: z.enum(["ea", "pcs", "ft", "sq ft", "bags"]).optional(), price: z.number().min(0).max(100000).optional() }),
  z.object({ do: z.literal("custom"), slot: z.enum(["decking", "fastening", "fascia", "roofing", "ceiling", "roofFascia", "gutters", "walls", "species"]), name: z.string().min(1).max(80), price: z.number().min(0).max(100000) }),
  z.object({ do: z.literal("sample"), id: z.enum(samples) }),
  z.object({ do: z.literal("autofix") }),
  z.object({ do: z.literal("undo") }),
  z.object({ do: z.literal("redo") }),
  z.object({ do: z.literal("view"), tab: z.enum(["3d", "plan", "wall"]).optional(), xray: z.boolean().optional(), night: z.boolean().optional(), connections: z.boolean().optional(), build: z.enum(["play", "stop", "done"]).optional(), full: z.boolean().optional(), reset: z.boolean().optional(), look: z.enum(["yard", "top", "front", "left", "right", "under", "house", "spin"]).optional(), edit: z.boolean().optional() }),
  z.object({ do: z.literal("show"), part: z.enum(["deck", "size", "height", "joists", "beams", "posts", "footings", "ledger", "decking", "border", "fascia", "frame", "blocking", "braces", "hardware", "rails", "stairs", "roof", "rafters", "headers", "gutters", "ceiling", "walls", "slats", "cupola", "roof-posts", "slab", "lights", "spa", "lower", "house", "electrical"]), fixture: fixtureKind.optional() }),
  z.object({ do: z.literal("ask"), q: z.enum(["compare", "concrete", "footings", "boards", "screws", "lumber", "joists", "beams", "posts", "ledger", "price", "perSqFt", "labor", "area", "height", "stairs", "rail", "permit", "code", "checks", "layout", "frame", "frost", "snow", "load", "roof", "electrical", "spa", "time", "colors", "options", "what", "help", "weight", "lower", "hardware", "wind"]), about: z.string().max(300).optional() }),
  z.object({ do: z.literal("open"), what: z.enum(["permit", "yard", "installer", "package", "checks"]) }),
  z.object({ do: z.literal("go"), to: z.enum(["kind", "size", "house", "materials", "stairs", "roof", "extras", "checks", "package"]) }),
  z.object({ do: z.literal("wish"), text: z.string().max(300), item: z.string().max(80).optional() }),
]);

/** The commands that pass, each checked alone; what fails is dropped (and counted). Never more than 12. */
export function checkCommands(raw: unknown): { cmds: DeckCommand[]; dropped: number } {
  const list = Array.isArray(raw) ? raw.slice(0, 12) : [];
  const cmds: DeckCommand[] = [];
  let dropped = 0;
  for (const item of list) {
    const r = COMMAND.safeParse(item);
    if (r.success) cmds.push(r.data as DeckCommand);
    else dropped++;
  }
  return { cmds, dropped };
}

/** The language, for the AI's instructions: one line per command, the values each takes. */
export const COMMAND_GUIDE = `Commands (JSON objects, "do" picks the kind). Amounts: {"to":n} sets, {"by":n} changes by n (negative = less), {"times":n} scales.
size {width?, depth?: amount in FEET (width along the house, depth out from it); areaSqFt?; square?; from?: "left"|"right" (which end grows) | "house" (the deck as wide as the whole house wall)}
height {in: amount in INCHES (deck floor above ground)}
shape {kind: rect|L|curve|clipped|parts, corner?: front-left|front-right|back-left|back-right, notchWidthFt?, notchDepthFt?, bulgeFt?, clipFt?, preset?: t|u|left|right, partWidthFt?, outFt?} (parts = the front set part by part: preset t — the middle comes out; u — the two ends come out; left / right — that half stands farther out; partWidthFt = the part that comes out, outFt = how far)
slide {ft: number (+ right, − left) or "center"}  — moves the deck along the house wall
placement {to: attached|beside|detached}; wall {to: wood-rim|engineered-rim|foam-sheathing|concrete|brick-veneer|hollow-block|cantilever|open-truss|sip-icf|unknown}
structure {to: deck|covered-deck|gazebo|pergola}; floor {to: deck|slab|existing|ground} (gazebo/pergola only; slab = a NEW slab poured and priced, existing = a slab or patio already there, no concrete priced)
roof {set: {kind?: shed|gable|hip|pyramid|double-tier|gambrel|dutch-gable, pitch?: amount (rise per 12), eaveIn?: amount (inches, 84–144), overhangIn?, roofing?: arch-shingle|3tab-shingle|designer-shingle|cedar-shake|metal-panel|standing-seam, ceiling?: none|tongue-groove|beadboard, gutters?: none|k5|k6|half-round-alum|half-round-copper, guards?, cupola?, soffit?, fasciaFinish?: wood|pvc|aluminum-wrap, walls?: none|screen|lattice|solid, wallSides?, pergolaStyle?: flat|louvered|arched, slatSize?: 2x2|2x4|2x6, slatSpacingIn?, planShape?: follows-deck|square|rect|hexagon|octagon|round, widthFt?, depthFt?, acrossFt?, attach?: wall|free, post?: 4x4|6x6|8x8, braces?, header?: auto|lvl|beam size, rafter?: 2x6..2x12|auto, rafterSpacingIn?: 12|16|24, load?: auto|20|30|50|70, roofDeck?: sheathing|purlins, fasciaEave?, fasciaRake?}}
decking {set: {product?: catalog id, color?: dark gray|light gray|gray|black|dark brown|reddish brown|red|light brown|brown, shade?: lighter|darker, family?: treated|softwood|hardwood|modified|composite|pvc|mineral|aluminum, tier?: good|better|best, pattern?: straight|diagonal|herringbone, border?: 0|1|2 (picture-frame border along the open edges), breakers?: 0|1|2 (breaker / divider boards laid ACROSS the field so no row has a butt joint: one in the middle, two at the thirds; straight boards only), fastening?: screws|hidden, fascia?: none|match, wastePct?}}
framing {set: {species?, joist?: 2x6|2x8|2x10|2x12|auto|up|down, spacingIn?: 12|16|24|auto, beam?: 4x6..4x12 or 2-2x6..3-2x12 or auto, beamKind?: solid|built-up, beamStyle?: dropped|flush|auto, post?: 4x4|4x6|6x6|8x8, overhangFt?, doubleRim?, joistTape?, braces?, blocking?: auto|mid-span}}
ledger {fastener?: lag|bolt|ledgerlok|sdws|anchor, lateral?: two|four}; footing {type?: poured|pier-block, aboveGradeIn?, frostAlways?}
site {frostIn?: amount (inches), snowPsf?, loadPsf?: 40|50|60|70, soilPsf?: 1500|2000|3000, outDropIn?, acrossDropIn?, state?: two letters}
rail {set: {type?: none|treated|cedar|composite|vinyl|aluminum|cable|glass|custom, heightIn?: 36|42, infill?: balusters|cable|glass|panel|horizontal, postSpacingFt?: 4|6|8, cap?, customPerFt?, mount?: top|side (posts on the deck boards | on the outside of the rim, the fascia), mountSide?: front|left|right|back (that side only)}}
stairs {op: add|remove|change, which?: {side}|{index}|last|all|only, side?: front|left|right, at?: left|center|right|house|out|{ft}|{by}, width?: amount (feet), wrap?, wrapSides?: 1|3|4, landing?: pad|patio|grade, handrail?: auto|both|one|none, level?: upper|lower, count?: 1|2, turn?: add|remove|straight|left|right|house|yard|back, turnAtIn?} (turn: a LANDING on the stair — op change; add = a landing in the middle of the tallest flight; left/right = which way the stairs go on from it as the deck is seen from the yard; house/yard = toward or away from the house; back = a switchback; remove = take every landing out; turnAtIn = the landing's height above the ground, inches)
lower {on?, place?: front|under, width?, depth?, dropIn?, align?: left|centre|right, heightIn?} (place under = a DOUBLE DECK: a second deck of the same size under this one, first floor and second floor; heightIn = that lower deck's height above the ground, inches); spa {on?, width?, depth?, align?} (hot tub spot 5–10 ft)
fixture {op: add|remove|set, kind: led-strip|post-cap|step-light|string-light|sconce|ceiling-light|chandelier|fan|outlet|heater|flood, qty?: amount, supply?: we|client, volts240?}
electrical {timer?, feedFt?, panelSide?}; house {storeys?: 1|2, roof?: hip|gable, siding?: white|cream|grey|blue|sage, roofColour?: charcoal|brown|slate|forest|terracotta, wall?: straight|bump-right|bump-left|nook, leftFt?/rightFt?: amount (how far the house wall runs past the deck's ends), widthFt? (the house's whole width), past?: {side: left|right|both, ft?, backFt?, wrap?, off?} (the DECK run past a corner of the house: ft beyond the corner, backFt back along the house's side — a wrap-around deck; wrap = a wrap-around with no length said; off = back to the corner)}
extras {demoSqFt?: number|"deck", stainless?, drain?, skirt?: lattice|boards|none (skirting under the deck's open edges: framed lattice, or the deck's own boards laid level)}; builtin {op: add|remove, kind: bench|bench-back|planter|screen, side?: front|left|right (the edge it stands along; left/right = the deck's ends), lengthFt?: 2–30, at?: left|centre|right (which end of that edge), heightFt?: 3–8 (a screen's height)} — a built-in bench (bench-back = with a backrest), a planter box, or a privacy screen on an OPEN deck's edge (kind screen: boards across posts, in the railing's place; a covered deck's privacy walls are roof.walls instead) in the deck's own boards; item {op: add|remove, name, qty?, unit?: ea|pcs|ft|sq ft|bags, price?} — anything the studio cannot draw, priced as the contractor's own item
custom {slot: decking|fastening|fascia|roofing|ceiling|roofFascia|gutters|walls|species, name, price (per ft of board, per sq ft, per square of roofing, per ft of gutter)} — the shop's own product in that list
sample {id: ${DECK_SAMPLES.map((s) => s.id).join("|")}}; autofix {}; undo {}; redo {}
view {tab?: 3d|plan|wall, xray?, night?, connections?, build?: play|stop|done, full?, reset?, look?: yard|top|front|left|right|under|house|spin}
show {part: joists|beams|posts|footings|ledger|decking|border|fascia|frame|rails|stairs|roof|rafters|headers|gutters|ceiling|walls|lights|spa|lower|house|size|height, fixture?}
ask {q: concrete|footings|boards|screws|lumber|joists|beams|posts|ledger|price|perSqFt|labor|area|height|stairs|rail|permit|code|checks|layout|frost|snow|load|roof|electrical|spa|time|colors|options|what|hardware, about?: the question}
open {what: permit|yard|installer|package|checks}; wish {text, item?} — a thing the studio cannot do or draw at all
Decking product ids: ${DECKING.map((p) => p.id).join(", ")}.`;
