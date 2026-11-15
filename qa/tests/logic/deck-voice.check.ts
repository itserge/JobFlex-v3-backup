// TALK TO DECK STUDIO (2026-10-21): what is said, read into commands; the commands carried out on the design through
// the studio's own doors; the answers read off the priced design; the shop's memory; the AI's commands checked.
// Phrases are written the way people say them (and the way a browser's recogniser writes them down).
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/deck-voice.check.ts
import { defaultDeckDesign, normalizeDeckDesign, type DeckDesign } from "../../../src/lib/deck/design";
import { priceDeck } from "../../../src/lib/deck/pricing";
import { deckChecks } from "../../../src/lib/deck/checks";
import { normalizeSpeech, splitClauses, trimClause, firstSentence, phraseKey } from "../../../src/lib/deck/voice/words";
import { parseUtterance, type ParseContext } from "../../../src/lib/deck/voice/parse";
import { hear, freshVoiceState, runCommands, designSummary, type BrainEnv, type VoiceState } from "../../../src/lib/deck/voice/assistant";
import { runCommand } from "../../../src/lib/deck/voice/run";
import { answer } from "../../../src/lib/deck/voice/answer";
import { checkCommands } from "../../../src/lib/deck/voice/schema";
import { patchDesign, patchRoof, switchStructure } from "../../../src/lib/deck/edit";
import { buildStructure } from "../../../src/lib/deck/structure";
import type { DeckCommand } from "../../../src/lib/deck/voice/commands";

let bad = 0;
let count = 0;
const check = (name: string, ok: boolean, detail = "") => {
  count++;
  if (!ok) bad++;
  if (!ok || process.env.VERBOSE) console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const base = (over: Record<string, unknown> = {}): DeckDesign => normalizeDeckDesign({ ...defaultDeckDesign({ state: "TX", frostIn: 12 }), ...over });
const ctxOf = (design: DeckDesign, extra: Partial<ParseContext> = {}): ParseContext => ({ design, subject: null, ...extra });
const cmdsOf = (text: string, design = base(), extra: Partial<ParseContext> = {}): DeckCommand[] => parseUtterance(text, ctxOf(design, extra)).clauses.flatMap((c) => c.cmds);
const show = (x: unknown) => JSON.stringify(x);

console.log("── what was said, cleaned");
{
  const cases: Array<[string, string]> = [
    ["make it twenty by fourteen", "make it 20 by 14"],
    ["twelve and a half feet", "12.5 ft"],
    ["two hundred and fifty square feet", "250 sqft"],
    ["12' 6\"", "12.5 ft"],
    ["12 foot 6 inches", "12.5 ft"],
    ["two by twelve joists", "2x12 joists"],
    ["2 x 10 joists", "2x10 joists"],
    ["to buy 12 joists", "2x12 joists"],
    ["six by six posts", "6x6 posts"],
    ["double two by tens", "2-2x10"],
    ["a triple 2x12 beam", "a 3-2x12 beam"],
    ["8 in 12 pitch", "8/12 pitch"],
    ["a 6 12 pitch", "a 6/12 pitch"],
    ["add Joyce", "add joists"],
    ["per gola", "pergola"],
    ["T-Rex decking", "trex decking"],
    ["e pay boards", "ipe boards"],
    ["make it for feet deeper", "make it 4 ft deeper"],
    ["a couple feet", "2 ft"],
    ["1,200 dollars", "$1200"],
    ["45 percent", "45%"],
    ["tongue and groove ceiling", "tongue-and-groove ceiling"],
    ["16 by 12", "16 by 12"],
    ["8 by 12 lower level with 2x8 joists", "8 by 12 lower level with 2x8 joists"],
  ];
  for (const [said, want] of cases) check(`"${said}" → "${want}"`, normalizeSpeech(said) === want, normalizeSpeech(said));
  check("fillers go, the command stays", trimClause("hey can you please make it bigger please") === "make it bigger", trimClause("hey can you please make it bigger please"));
  check("\"nook\" is not trimmed to \"no\"", trimClause("put the deck in a nook") === "put the deck in a nook");
  check("a sentence splits at and/then", splitClauses(normalizeSpeech("make it 20 by 14 and add stairs then show me at night")).length === 3);
  check("a question is kept whole", splitClauses(normalizeSpeech("what's the difference between composite and wood")).length === 1);
  check("the first sentence does not stop at 'in.'", firstSentence("5 risers: a handrail 34 to 38 in. above the nosings is required. And more.") === "5 risers: a handrail 34 to 38 in. above the nosings is required.");
  check("a phrase key is plain", phraseKey("  My Usual!! ") === "my usual");
}

console.log("── commands read from what was said");
{
  const d = base();
  const withStairs = base({ stairs: [{ id: "s1", side: "front", atFt: 8, widthFt: 4, level: "upper", wrap: false, wrapSides: 1, landing: "pad", handrail: "auto" }] });
  const covered = switchStructure(base(), "covered-deck");
  type Case = [string, (c: DeckCommand[]) => boolean, DeckDesign?, Partial<ParseContext>?];
  const has = <K extends DeckCommand["do"]>(c: DeckCommand[], kind: K): Extract<DeckCommand, { do: K }> | undefined => c.find((x): x is Extract<DeckCommand, { do: K }> => x.do === kind);
  const cases: Case[] = [
    // Size
    ["make it 20 by 14", (c) => show(has(c, "size")) === show({ do: "size", width: { to: 20 }, depth: { to: 14 } })],
    ["I want a sixteen by twelve deck", (c) => has(c, "size")?.width?.["to" as never] === 16],
    ["make it a little bigger", (c) => show(has(c, "size")) === show({ do: "size", width: { by: 1 }, depth: { by: 1 } })],
    ["make it a lot bigger", (c) => show(has(c, "size")?.width) === show({ by: 4 })],
    ["make it 2 feet deeper", (c) => show(has(c, "size")?.depth) === show({ by: 2 })],
    ["push it out 3 more feet", (c) => show(has(c, "size")?.depth) === show({ by: 3 })],
    ["make it wider", (c) => show(has(c, "size")?.width) === show({ by: 2 })],
    ["make it 2 feet narrower", (c) => show(has(c, "size")?.width) === show({ by: -2 })],
    ["make it 18 ft wide", (c) => show(has(c, "size")?.width) === show({ to: 18 })],
    ["make it 14 feet deep", (c) => show(has(c, "size")?.depth) === show({ to: 14 })],
    ["make it 300 square feet", (c) => has(c, "size")?.areaSqFt === 300],
    ["make it square", (c) => has(c, "size")?.square === true],
    ["make it a 14 foot square", (c) => show(has(c, "size")) === show({ do: "size", width: { to: 14 }, depth: { to: 14 } })],
    ["double the size", (c) => !!has(c, "size")?.width && "times" in has(c, "size")!.width!],
    ["extend it to the left 4 feet", (c) => has(c, "size")?.from === "left" && show(has(c, "size")?.width) === show({ by: 4 })],
    ["make it smaller", (c) => show(has(c, "size")?.width) === show({ by: -2 })],
    // Height
    ["raise it 6 inches", (c) => show(has(c, "height")) === show({ do: "height", in: { by: 6 } })],
    ["make it higher", (c) => show(has(c, "height")?.in) === show({ by: 12 })],
    ["lower it a bit", (c) => show(has(c, "height")?.in) === show({ by: -6 })],
    ["make it 4 feet high", (c) => show(has(c, "height")?.in) === show({ to: 48 })],
    ["make it 30 inches off the ground", (c) => show(has(c, "height")?.in) === show({ to: 30 })],
    ["three and a half feet tall", (c) => show(has(c, "height")?.in) === show({ to: 42 })],
    ["ground level", (c) => show(has(c, "height")?.in) === show({ to: 14 })],
    ["second story deck", (c) => show(has(c, "height")?.in) === show({ to: 120 })],
    ["level with the back door", (c) => show(has(c, "height")?.in) === show({ to: 36 })],
    ["walkout basement level", (c) => show(has(c, "height")?.in) === show({ to: 96 })],
    // Shape and placement
    ["make it L shaped", (c) => has(c, "shape")?.kind === "L"],
    ["cut out the front left corner", (c) => has(c, "shape")?.corner === "front-left"],
    ["give it a curved front", (c) => has(c, "shape")?.kind === "curve"],
    ["angle the corners", (c) => has(c, "shape")?.kind === "clipped"],
    ["make it a rectangle", (c) => has(c, "shape")?.kind === "rect"],
    ["freestanding deck", (c) => has(c, "placement")?.to === "detached"],
    ["attach it to the house", (c) => has(c, "placement")?.to === "attached"],
    ["on its own posts beside the house", (c) => has(c, "placement")?.to === "beside"],
    ["it's a brick house", (c) => has(c, "wall")?.to === "brick-veneer"],
    ["center the deck on the house", (c) => has(c, "slide")?.ft === "center"],
    ["move the deck 2 feet to the left", (c) => has(c, "slide")?.ft === -2],
    // Stairs
    ["add stairs", (c) => has(c, "stairs")?.op === "add"],
    ["add stairs on the left", (c) => has(c, "stairs")?.side === "left"],
    ["put steps down the front", (c) => has(c, "stairs")?.side === "front"],
    ["add stairs on both sides", (c) => has(c, "stairs")?.count === 2],
    ["add a 6 foot wide staircase", (c) => show(has(c, "stairs")?.width) === show({ to: 6 })],
    ["stairs at the front right corner", (c) => has(c, "stairs")?.at === "right"],
    ["add wrap around steps", (c) => has(c, "stairs")?.wrap === true],
    ["make the stairs wider", (c) => has(c, "stairs")?.op === "change" && show(has(c, "stairs")?.width) === show({ by: 1 }), withStairs],
    ["make them a little narrower", (c) => show(has(c, "stairs")?.width) === show({ by: -0.5 }), withStairs, { subject: "stairs" }],
    ["move them to the left", (c) => show(has(c, "stairs")?.at) === show({ by: -2 }), withStairs, { subject: "stairs" }],
    ["move the stairs to the right side", (c) => has(c, "stairs")?.side === "right", withStairs],
    ["put them in the middle", (c) => has(c, "stairs")?.at === "center", withStairs, { subject: "stairs" }],
    ["add handrails on both sides", (c) => has(c, "stairs")?.handrail === "both" && has(c, "stairs")?.op === "change", withStairs],
    ["stairs onto the patio", (c) => has(c, "stairs")?.landing === "patio", withStairs],
    ["remove the stairs", (c) => has(c, "stairs")?.op === "remove", withStairs],
    ["get rid of the steps", (c) => has(c, "stairs")?.op === "remove", withStairs],
    // Railing
    ["add a railing", (c) => !!has(c, "rail")?.set.type],
    ["aluminum railing", (c) => has(c, "rail")?.set.type === "aluminum"],
    ["black metal railing", (c) => has(c, "rail")?.set.type === "aluminum"],
    ["cable railing", (c) => has(c, "rail")?.set.type === "cable"],
    ["glass railing", (c) => has(c, "rail")?.set.type === "glass"],
    ["white vinyl railing", (c) => has(c, "rail")?.set.type === "vinyl"],
    ["42 inch railing", (c) => has(c, "rail")?.set.heightIn === 42],
    ["make the railing taller", (c) => has(c, "rail")?.set.heightIn === 42],
    ["no railing", (c) => has(c, "rail")?.set.type === "none"],
    ["glass panels", (c) => has(c, "rail")?.set.type === "glass", d, { subject: "rail" }],
    ["posts every 6 feet", (c) => has(c, "rail")?.set.postSpacingFt === 6, d, { subject: "rail" }],
    // How the posts meet the deck (2026-11-13): for every side, or for one.
    ["top mount the railing", (c) => has(c, "rail")?.set.mount === "top" && !has(c, "rail")?.set.mountSide],
    ["surface mounted posts", (c) => has(c, "rail")?.set.mount === "top"],
    ["fascia mount the railing", (c) => has(c, "rail")?.set.mount === "side" && !has(c, "rail")?.set.mountSide],
    ["side mount the railing on the left side", (c) => has(c, "rail")?.set.mount === "side" && has(c, "rail")?.set.mountSide === "left"],
    ["aluminum railing top mounted", (c) => has(c, "rail")?.set.type === "aluminum" && has(c, "rail")?.set.mount === "top"],
    ["top mount the front only", (c) => has(c, "rail")?.set.mount === "top" && has(c, "rail")?.set.mountSide === "front"],
    // Decking
    ["composite decking", (c) => has(c, "decking")?.set.family === "composite"],
    ["trex", (c) => has(c, "decking")?.set.product === "trex-enhance-naturals"],
    ["use trex transcend lineage", (c) => has(c, "decking")?.set.product === "trex-transcend-lineage"],
    ["timbertech azek vintage", (c) => has(c, "decking")?.set.product === "timbertech-azek-vintage"],
    ["fiberon concordia boards", (c) => has(c, "decking")?.set.product === "fiberon-concordia"],
    ["ipe", (c) => has(c, "decking")?.set.product === "ipe-1x6"],
    ["cedar decking", (c) => has(c, "decking")?.set.product === "cedar-54"],
    ["redwood 2x6", (c) => has(c, "decking")?.set.product === "redwood-2x6"],
    ["pressure treated 2x6 boards", (c) => has(c, "decking")?.set.family === "treated" && has(c, "decking")?.set.thick === "2x6"],
    ["make it gray", (c) => has(c, "decking")?.set.color === "gray"],
    ["dark brown boards", (c) => has(c, "decking")?.set.color === "dark brown"],
    ["darker", (c) => has(c, "decking")?.set.shade === "darker", d, { subject: "decking" }],
    ["the cheapest option", (c) => has(c, "decking")?.set.tier === "good"],
    ["premium package", (c) => has(c, "decking")?.set.tier === "best"],
    ["picture frame border", (c) => has(c, "decking")?.set.border === 1],
    ["double border", (c) => has(c, "decking")?.set.border === 2],
    ["diagonal boards", (c) => has(c, "decking")?.set.pattern === "diagonal"],
    ["herringbone", (c) => has(c, "decking")?.set.pattern === "herringbone"],
    ["hidden fasteners", (c) => has(c, "decking")?.set.fastening === "hidden"],
    ["add fascia", (c) => has(c, "decking")?.set.fascia === "match"],
    // Frame
    ["2x10 joists", (c) => has(c, "framing")?.set.joist === "2x10"],
    ["two by twelve joists sixteen inches on center", (c) => has(c, "framing")?.set.joist === "2x12" && has(c, "framing")?.set.spacingIn === 16],
    ["12 inches on center", (c) => has(c, "framing")?.set.spacingIn === 12],
    ["bigger joists", (c) => has(c, "framing")?.set.joist === "up"],
    ["use a triple 2x12 beam", (c) => has(c, "framing")?.set.beam === "3-2x12"],
    ["double 2x10 beam", (c) => has(c, "framing")?.set.beam === "2-2x10"],
    ["flush beam", (c) => has(c, "framing")?.set.beamStyle === "flush"],
    ["6x6 posts", (c) => has(c, "framing")?.set.post === "6x6"],
    ["cantilever 2 feet", (c) => has(c, "framing")?.set.overhangFt === 2],
    ["douglas fir framing", (c) => has(c, "framing")?.set.species === "douglas-fir"],
    ["joist tape", (c) => has(c, "framing")?.set.joistTape === true],
    ["stainless hardware, we're near the ocean", (c) => has(c, "extras")?.stainless === true],
    ["through bolts on the ledger", (c) => has(c, "ledger")?.fastener === "bolt"],
    ["pier blocks", (c) => has(c, "footing")?.type === "pier-block"],
    ["sonotubes", (c) => has(c, "footing")?.type === "poured"],
    // Site
    ["frost line is 42 inches", (c) => show(has(c, "site")?.frostIn) === show({ to: 42 })],
    ["snow load 50 psf", (c) => has(c, "site")?.snowPsf === 50],
    ["clay soil", (c) => has(c, "site")?.soilPsf === 1500],
    ["the yard slopes 2 feet away from the house", (c) => has(c, "site")?.outDropIn === 24],
    ["we're in colorado", (c) => has(c, "site")?.state === "CO"],
    ["tear out the old deck", (c) => has(c, "extras")?.demoSqFt === "deck"],
    ["add under deck drainage", (c) => has(c, "extras")?.drain === true],
    // Roof and what is built
    ["add a roof", (c) => has(c, "structure")?.to === "covered-deck"],
    ["add a gable roof", (c) => has(c, "roof")?.set.kind === "gable"],
    ["make it a hip roof", (c) => has(c, "roof")?.set.kind === "hip", covered],
    ["make the roof steeper", (c) => show(has(c, "roof")?.set.pitch) === show({ by: 2 }), covered],
    ["8 in 12 pitch", (c) => show(has(c, "roof")?.set.pitch) === show({ to: 8 }), covered],
    ["9 foot ceiling", (c) => show(has(c, "roof")?.set.eaveIn) === show({ to: 108 }), covered],
    ["raise the roof a little", (c) => show(has(c, "roof")?.set.eaveIn) === show({ by: 6 }), covered],
    ["metal roof", (c) => has(c, "roof")?.set.roofing === "metal-panel", covered],
    ["standing seam", (c) => has(c, "roof")?.set.roofing === "standing-seam", covered],
    ["tongue and groove ceiling", (c) => has(c, "roof")?.set.ceiling === "tongue-groove", covered],
    ["add gutters", (c) => has(c, "roof")?.set.gutters === "k5", covered],
    ["copper gutters", (c) => has(c, "roof")?.set.gutters === "half-round-copper", covered],
    ["screen it in", (c) => has(c, "roof")?.set.walls === "screen", covered],
    ["add a cupola", (c) => has(c, "roof")?.set.cupola === true, covered],
    ["bigger overhang", (c) => show(has(c, "roof")?.set.overhangIn) === show({ by: 6 }), covered],
    ["remove the roof", (c) => has(c, "structure")?.to === "deck", covered],
    ["make it a gazebo", (c) => has(c, "structure")?.to === "gazebo"],
    ["octagon gazebo on a slab", (c) => has(c, "floor")?.to === "slab" && has(c, "roof")?.set.planShape === "octagon"],
    ["make it a pergola", (c) => has(c, "structure")?.to === "pergola"],
    ["louvered pergola", (c) => has(c, "roof")?.set.pergolaStyle === "louvered"],
    ["make the house blue with a gray roof", (c) => has(c, "house")?.siding === "blue" && c.some((x) => x.do === "house" && x.roofColour === "slate")],
    ["two story house", (c) => has(c, "house")?.storeys === 2],
    ["bump out on the right", (c) => has(c, "house")?.wall === "bump-right"],
    ["put the deck in a nook", (c) => has(c, "house")?.wall === "nook"],
    // Lights and extras
    ["add 2 heaters", (c) => has(c, "fixture")?.kind === "heater" && show(has(c, "fixture")?.qty) === show({ to: 2 })],
    ["add a 240 volt heater", (c) => has(c, "fixture")?.volts240 === true],
    ["add string lights", (c) => has(c, "fixture")?.kind === "string-light"],
    ["add post cap lights", (c) => has(c, "fixture")?.kind === "post-cap"],
    ["lights on the stairs", (c) => has(c, "fixture")?.kind === "step-light"],
    ["add a ceiling fan", (c) => has(c, "fixture")?.kind === "fan"],
    ["add an outlet", (c) => has(c, "fixture")?.kind === "outlet"],
    ["add lights on a timer", (c) => has(c, "electrical")?.timer === true],
    ["add a hot tub", (c) => has(c, "spa")?.on === true],
    ["make the hot tub 8 by 8", (c) => show(has(c, "spa")?.width) === show({ to: 8 })],
    ["add a lower level", (c) => has(c, "lower")?.on === true],
    ["a lower level 12 by 10 one step down", (c) => show(has(c, "lower")?.dropIn) === show({ to: 7.5 }) && show(has(c, "lower")?.width) === show({ to: 12 })],
    // Looking
    ["show it at night", (c) => has(c, "view")?.night === true],
    ["daytime", (c) => has(c, "view")?.night === false],
    ["x-ray", (c) => has(c, "view")?.xray === true],
    ["show me from the top", (c) => has(c, "view")?.look === "top"],
    ["look from underneath", (c) => has(c, "view")?.look === "under"],
    ["spin it around", (c) => has(c, "view")?.look === "spin"],
    ["zoom out", (c) => has(c, "view")?.reset === true],
    ["full screen", (c) => has(c, "view")?.full === true],
    ["exit full screen", (c) => has(c, "view")?.full === false],
    ["framing plan", (c) => has(c, "view")?.tab === "plan"],
    ["show me the connections", (c) => has(c, "view")?.connections === true],
    ["build it", (c) => has(c, "view")?.build === "play"],
    ["show me how it lays down", (c) => has(c, "view")?.build === "play"],
    ["show me the joists", (c) => has(c, "show")?.part === "joists"],
    ["show me the footings", (c) => has(c, "show")?.part === "footings"],
    ["show me the stairs", (c) => has(c, "show")?.part === "stairs"],
    // Questions
    ["how much concrete do I need", (c) => has(c, "ask")?.q === "concrete"],
    ["how many bags of concrete", (c) => has(c, "ask")?.q === "concrete"],
    ["how many deck boards", (c) => has(c, "ask")?.q === "boards"],
    ["how many screws", (c) => has(c, "ask")?.q === "screws"],
    ["how will the boards lay down", (c) => has(c, "ask")?.q === "layout"],
    ["which way do the joists run", (c) => has(c, "ask")?.q === "layout"],
    ["how much does it cost", (c) => has(c, "ask")?.q === "price"],
    ["how much is the railing", (c) => has(c, "ask")?.q === "price"],
    ["price per square foot", (c) => has(c, "ask")?.q === "perSqFt"],
    ["do I need a permit", (c) => has(c, "ask")?.q === "permit"],
    ["do I need a railing", (c) => has(c, "ask")?.q === "rail"],
    ["how many steps", (c) => has(c, "ask")?.q === "stairs"],
    ["does it pass code", (c) => has(c, "ask")?.q === "checks"],
    ["what size are the joists", (c) => has(c, "ask")?.q === "joists"],
    ["how deep are the footings", (c) => has(c, "ask")?.q === "footings"],
    ["can it hold a hot tub", (c) => has(c, "ask")?.q === "spa"],
    // Control
    ["yes", (c) => has(c, "confirm")?.yes === true],
    ["sounds good", (c) => has(c, "confirm")?.yes === true],
    ["no thanks", (c) => has(c, "confirm")?.yes === false],
    ["undo", (c) => !!has(c, "undo")],
    ["take that back", (c) => !!has(c, "undo")],
    ["redo", (c) => !!has(c, "redo")],
    ["stop listening", (c) => !!has(c, "stop")],
    ["be quiet", (c) => has(c, "mute")?.on === true],
    ["what can I say", (c) => !!has(c, "help")],
    ["fix it", (c) => !!has(c, "autofix")],
    ["make it pass code", (c) => !!has(c, "autofix")],
    ["start over", (c) => !!has(c, "reset")],
    ["use the hot tub sample", (c) => has(c, "sample")?.id === "deck-spa"],
    ["open the permit set", (c) => has(c, "open")?.what === "permit"],
    ["lumber list", (c) => has(c, "open")?.what === "yard"],
    ["save it as a proposal", (c) => !!has(c, "save")],
    ["call it Johnson backyard deck", (c) => has(c, "name")?.title === "Johnson Backyard Deck"],
    ["the address is 1840 meadow glen drive allen tx 75002", (c) => has(c, "address")?.text === "1840 Meadow Glen Drive Allen TX 75002"],
    // Things the studio does not draw
    // (2026-11-14: a fire pit and an outdoor kitchen are drawn — lib/deck/builtins; a pool is not.)
    ["add a pool", (c) => has(c, "wish")?.item === "Pool"],
    ["add a fire pit", (c) => { const b = has(c, "builtin"); return b?.kind === "fire" && b.op === "add"; }],
    ["add an outdoor kitchen", (c) => has(c, "builtin")?.kind === "kitchen"],
    ["put a grill island on the left side", (c) => { const b = has(c, "builtin"); return b?.kind === "kitchen" && b.side === "left"; }],
    ["level with the kitchen door", (c) => !has(c, "builtin")],
    ["add a bench for 450 dollars", (c) => has(c, "item")?.price === 450],
    ["add 2 planters at $150 each", (c) => has(c, "item")?.qty === 2 && has(c, "item")?.price === 150],
    ["add a fire pit", (c) => has(c, "item")?.price === 1200, d, { items: { "fire pit": { name: "Fire pit", unit: "ea", price: 1200 } } }],
    // Said loosely
    ["let's do composite boards in a gray color", (c) => has(c, "decking")?.set.family === "composite" && has(c, "decking")?.set.color === "gray"],
    ["I'd like the stairs to come off the right", (c) => has(c, "stairs")?.side === "right", withStairs],
    ["take the heater off", (c) => has(c, "fixture")?.op === "remove" && has(c, "fixture")?.kind === "heater"],
    ["add a light over the door", (c) => has(c, "fixture")?.kind === "sconce"],
    ["can I put a TV out there", (c) => has(c, "wish")?.item === "TV mount"],
    ["make it look more modern", (c) => has(c, "rail")?.set.type === "cable" && has(c, "decking")?.set.color === "dark gray"],
    ["make it rustic", (c) => has(c, "decking")?.set.product === "cedar-54"],
    ["low maintenance please", (c) => has(c, "decking")?.set.family === "composite"],
    ["make the whole thing two feet bigger all around", (c) => show(has(c, "size")?.width) === show({ by: 2 })],
    ["make it 2 steps down to a lower level", (c) => show(has(c, "lower")?.dropIn) === show({ to: 15 })],
    ["lower the lower level by 2 inches", (c) => show(has(c, "lower")?.dropIn) === show({ by: 2 })],
    ["turn it so I can see the side", (c) => has(c, "view")?.look === "right"],
    ["let me see underneath", (c) => has(c, "view")?.look === "under"],
    ["I want to see what it looks like with a hip roof", (c) => c.some((x) => x.do === "roof" && x.set.kind === "hip")],
    ["how is the deck attached to the house", (c) => has(c, "ask")?.q === "ledger"],
    ["what holds it up", (c) => has(c, "ask")?.q === "frame"],
    ["compare the packages", (c) => has(c, "ask")?.q === "compare"],
    ["compare composite and wood", (c) => has(c, "ask")?.q === "compare"],
    ["what's the cheapest way to build this", (c) => has(c, "ask")?.q === "compare"],
    ["what are my options for boards", (c) => has(c, "ask")?.q === "options"],
    ["is 2x6 enough for the joists", (c) => has(c, "ask")?.q === "joists"],
    // The same meaning, other words (2026-10-22)
    ["supersize it", (c) => ((has(c, "size")?.width as { by: number } | undefined)?.by ?? 0) > 0],
    ["cut it down a little", (c) => show(has(c, "size")?.width) === show({ by: -1 })],
    ["bring it in two feet", (c) => show(has(c, "size")?.depth) === show({ by: -2 })],
    ["it's too deep", (c) => show(has(c, "size")?.depth) === show({ by: -2 })],
    ["it's too wide", (c) => show(has(c, "size")?.width) === show({ by: -2 })],
    ["make it come out farther", (c) => ((has(c, "size")?.depth as { by: number } | undefined)?.by ?? 0) > 0],
    ["make the deck go all the way across the back of the house", (c) => has(c, "size")?.from === "house"],
    ["bring it down six inches", (c) => show(has(c, "height")?.in) === show({ by: -6 })],
    ["put it right on the ground", (c) => show(has(c, "height")?.in) === show({ to: 14 })],
    ["take a corner out of it", (c) => has(c, "shape")?.kind === "L"],
    ["round off the front", (c) => has(c, "shape")?.kind === "curve"],
    ["round the corners", (c) => has(c, "shape")?.kind === "clipped"],
    ["give it 45 degree corners", (c) => has(c, "shape")?.kind === "clipped" && has(c, "shape")?.clipFt === undefined],
    ["we need steps to the yard", (c) => has(c, "stairs")?.op === "add"],
    ["hide the screws", (c) => has(c, "decking")?.set.fastening === "hidden"],
    ["I like the dark gray", (c) => has(c, "decking")?.set.color === "dark gray"],
    ["the deck isn't attached", (c) => has(c, "placement")?.to === "detached"],
    ["light up the stairs", (c) => has(c, "fixture")?.kind === "step-light"],
    // LED lights by the rail are lights, not a wood railing (2026-10-22: "LED lights under the rail" set a treated rail).
    ["LED lights under the rail", (c) => has(c, "fixture")?.kind === "led-strip" && !has(c, "rail")],
    ["lights under the railing", (c) => has(c, "fixture")?.kind === "led-strip" && !has(c, "rail")],
    ["rail lights", (c) => has(c, "fixture")?.kind === "led-strip" && !has(c, "rail")],
    ["add LED lights", (c) => has(c, "fixture")?.kind === "led-strip"],
    ["LED lights on the stairs", (c) => has(c, "fixture")?.kind === "step-light"],
    ["LED post cap lights", (c) => has(c, "fixture")?.kind === "post-cap"],
    // "Show me at night" pulls back to the whole deck, lit; "turn on the lights" keeps the camera where it is.
    ["show me at night", (c) => has(c, "view")?.night === true && has(c, "view")?.reset === true],
    ["turn on the lights", (c) => has(c, "view")?.night === true && !has(c, "view")?.reset],
    ["now spin it around", (c) => has(c, "view")?.look === "spin" && has(c, "view")?.reset === true],
    ["make it an octagon", (c) => c.some((x) => x.do === "roof" && x.set.planShape === "octagon")],
    ["less steep roof", (c) => show(has(c, "roof")?.set.pitch) === show({ by: -2 }), covered],
    ["make the ceiling 10 feet", (c) => show(has(c, "roof")?.set.eaveIn) === show({ to: 120 }), covered],
    ["move the roof 3 feet to the right", (c) => show(has(c, "roof")?.set.offsetFt) === show({ by: 3 }) && !has(c, "roof")?.set.eaveIn, covered],
    ["LVL headers", (c) => has(c, "roof")?.set.header === "lvl", covered],
    ["2x8 rafters 16 inches on center", (c) => has(c, "roof")?.set.rafter === "2x8" && has(c, "roof")?.set.rafterSpacingIn === 16, covered],
    ["purlins under the metal", (c) => has(c, "roof")?.set.roofDeck === "purlins", covered],
    ["no rake boards", (c) => has(c, "roof")?.set.fasciaRake === false, covered],
    ["roof load 50 psf", (c) => has(c, "roof")?.set.load === 50, covered],
    ["the house goes 10 feet past the deck on the left", (c) => show(has(c, "house")?.leftFt) === show({ to: 10 })],
    ["the house is 40 feet wide", (c) => has(c, "house")?.widthFt === 40],
    ["use our own boards called azek timber at 9 dollars a foot", (c) => has(c, "custom")?.slot === "decking" && has(c, "custom")?.price === 9 && has(c, "custom")?.name === "Azek Timber"],
    ["custom railing at 95 dollars a foot", (c) => has(c, "rail")?.set.type === "custom" && has(c, "rail")?.set.customPerFt === 95],
    // Sentences with several commands
    ["make it 16 by 12 with composite decking and aluminum railing", (c) => !!has(c, "size") && has(c, "decking")?.set.family === "composite" && has(c, "rail")?.set.type === "aluminum"],
    ["add stairs down the front and a heater", (c) => has(c, "stairs")?.side === "front" && has(c, "fixture")?.kind === "heater"],
    ["remove the stairs and the railing", (c) => has(c, "stairs")?.op === "remove" && has(c, "rail")?.set.type === "none", withStairs],
    ["add a covered porch with a hip roof and a ceiling fan", (c) => has(c, "structure")?.to === "covered-deck" && c.some((x) => x.do === "roof" && x.set.kind === "hip") && has(c, "fixture")?.kind === "fan"],
  ];
  for (const [said, ok, design, extra] of cases) {
    const c = cmdsOf(said, design ?? d, extra ?? {});
    check(`"${said}"`, ok(c), show(c));
  }
  // A follow-up reads against what was talked about; a new thing named is not a follow-up.
  const afterHeaters = base({ electrical: { fixtures: [{ id: "e1", kind: "heater", supply: "we", qty: 2, at: null, volts240: false, custom: null }], feedFt: 40, panelSide: "left", timer: false } });
  check("after heaters, \"add a fire pit\" is the fire pit — not another heater", cmdsOf("add a fire pit", afterHeaters, { subject: "fixture", fixture: "heater" }).every((x) => x.do !== "fixture"));
  check("after the stairs, \"make them wider\" widens the stairs", cmdsOf("make them wider", withStairs, { subject: "stairs" })[0]?.do === "stairs");
  // 2026-10-24 (the studio walk): after "a cable rail", "make it two feet higher" raised the rail to… 36 in. A rail is
  // only ever 36 or 42 in. and is "taller"; the deck is what goes "higher".
  check("after a rail, \"make it two feet higher\" raises the DECK by 2 ft", (() => { const c = cmdsOf("make it two feet higher", d, { subject: "rail" })[0]; return c?.do === "height" && JSON.stringify((c as { in?: unknown }).in) === JSON.stringify({ by: 24 }); })());
  check("after a rail, \"make them taller\" is still the rail", cmdsOf("make them taller", d, { subject: "rail" })[0]?.do === "rail");
  check("after a rail, \"show me the top\" is the view", cmdsOf("show me the top", d, { subject: "rail" })[0]?.do === "view");
  check("after the stairs, \"make it 30 inches off the ground\" is the deck's height", cmdsOf("make it 30 inches off the ground", withStairs, { subject: "stairs" })[0]?.do === "height");
  check("a shop's taught phrase is understood", show(cmdsOf("my usual", d, { learned: { "my usual": [{ do: "size", width: { to: 16 }, depth: { to: 12 } }] } })) === show([{ do: "size", width: { to: 16 }, depth: { to: 12 } }]));
  check("what-if is read as a what-if", parseUtterance("what if it was 20 by 16", ctxOf(d)).whatIf?.show === false);
  check("show-me-with is read to be made and shown", parseUtterance("show me it with a gable roof", ctxOf(d)).whatIf?.show === true);
  check("a recogniser's best hearing is the one read whole", hear(["make it wider than the uh", "make it wider"], d, freshVoiceState()).design?.shape.widthFt === 18);
}

console.log("── carried out on the design");
{
  const env: BrainEnv = {};
  let d = base();
  let st: VoiceState = freshVoiceState();
  const say = (text: string) => {
    const r = hear(text, d, st, env);
    if (r.design) d = r.design;
    st = r.state;
    return r;
  };
  let r = say("make it twenty by fourteen");
  check("20 × 14 ft", d.shape.widthFt === 20 && d.shape.depthFt === 14, r.say);
  check("the reply says the size and the price", /20 ft × 14 ft — 280 sq ft/.test(r.say) && /Price \$/.test(r.say), r.say);
  check("the size fields flash and the width lights", r.flash.some((f) => f.label === "Along the house") && r.light?.label === "Along the house");
  check("over 30 in. with no railing: a railing is offered", /guard/.test(r.say) && !!r.pending, r.say);
  r = say("yes");
  check("yes adds the railing", d.rail.type !== "none", r.say);
  r = say("add stairs on the left");
  check("a stair on the left", d.stairs.length === 1 && d.stairs[0].side === "left", r.say);
  check("the camera flies to the new stair", !!r.fly, show(r.fly));
  r = say("make them wider");
  check("the stair is 5 ft", d.stairs[0].widthFt === 5, r.say);
  r = say("a bit more");
  check("\"a bit more\" widens again by half", d.stairs[0].widthFt === 5.5, r.say);
  r = say("raise it 6 inches");
  check("42 in. high", d.heightIn === 42, r.say);
  r = say("trex transcend");
  check("Trex Transcend", d.decking.product === "trex-transcend", r.say);
  r = say("darker");
  const darkerL = (id: string) => {
    const hex = Number.parseInt((priceDeck(base({ decking: { product: id } })).frame?.decking.color ?? "#000000").slice(1), 16);
    return 0.2126 * ((hex >> 16) & 255) + 0.7152 * ((hex >> 8) & 255) + 0.0722 * (hex & 255);
  };
  check("one shade darker, a maker's own board; said when Trex has none darker", d.decking.product !== "trex-transcend" && darkerL(d.decking.product) < darkerL("trex-transcend") && /^(?!composite-)/.test(d.decking.product) && /Trex has nothing darker/.test(r.say), `${d.decking.product}: ${r.say}`);
  r = say("add a gable roof");
  check("a covered deck", d.structure === "covered-deck" && d.roof.kind === "gable", r.say);
  r = say("steeper");
  check("pitch up 2", d.roof.pitch === 6, r.say);
  r = say("add two heaters");
  check("two heaters, and the night view", d.electrical.fixtures.some((f) => f.kind === "heater" && f.qty === 2) && r.view?.night === true, r.say);
  r = say("add a ceiling fan");
  check("a fan under the roof", d.electrical.fixtures.some((f) => f.kind === "fan"), r.say);
  const before = d;
  r = say("what if it was composite");
  check("a what-if changes nothing", d === before && !r.design, r.say);
  check("…says the price and asks", /it would be \$[\d,]+/.test(r.say) && !!r.pending, r.say);
  r = say("no");
  check("no leaves it", d === before && /leaving it/i.test(r.say), r.say);
  r = say("how much concrete do I need");
  const bags = priceDeck(d).bom.filter((l) => l.kind === "concrete" && l.unit === "bags").reduce((a, l) => a + l.qty, 0);
  check("the concrete answer is the material list's bags", new RegExp(`About ${bags.toLocaleString("en-US")} bags`).test(r.say), r.say);
  r = say("add a hammock");
  check("a hammock is noted and its price asked", !!r.meta.wish && /cost/.test(r.say) && !!r.pending, r.say);
  r = say("1200 dollars");
  check("the price said puts it on as the shop's item, remembered", d.extras.items.some((i) => i.name === "Hammock posts" && i.price === 1200) && r.meta.remember?.price === 1200, r.say);
  r = say("start over");
  check("start over asks first", !!r.pending && !r.design, r.say);
  r = say("yes");
  check("…and on yes, starts the studio's own fresh deck", r.meta.reset === true, show(r.meta));
  r = hear("undo", d, st, env);
  check("undo is the panel's", r.meta.undo === true);
  // Comparing and checking a size
  const cmp = hear("compare the packages", base(), freshVoiceState(), env);
  check("the packages are priced side by side", /Good \(treated boards, wood rail\): \$[\d,]+ · Better .*: \$[\d,]+ · Best .*: \$[\d,]+/.test(cmp.say), cmp.say);
  const two = hear("compare composite and wood", base(), freshVoiceState(), env);
  check("two named boards are priced side by side", /^Treated wood: \$[\d,]+ · Composite: \$[\d,]+/.test(two.say), two.say);
  const enough = hear("is 2x8 enough for the joists", base(), freshVoiceState(), env);
  check("a size question gets a yes or a no", /^(Yes|No) —/.test(enough.say), enough.say);
  // Teaching
  const taught = hear("when I say my usual make it 16 by 12 with trex and aluminum railing", base(), freshVoiceState(), env);
  check("a taught phrase is read now", taught.meta.teach?.phrase === "my usual" && (taught.meta.teach?.cmds?.length ?? 0) >= 3, show(taught.meta.teach));
  const learned = { "my usual": taught.meta.teach?.cmds ?? [] };
  const used = hear("my usual", base({ shape: { kind: "rect", widthFt: 30, depthFt: 20 } }), freshVoiceState(), { learned });
  check("…and done when said", used.design?.shape.widthFt === 16 && used.design?.decking.product === "trex-enhance-naturals" && used.design?.rail.type === "aluminum", used.say);
  // Read-only questions on any design
  const q = hear("do I need a permit", base(), freshVoiceState(), env);
  check("an attached deck needs a permit", /Almost certainly/.test(q.say), q.say);
  const small = hear("do I need a permit", base({ placement: "detached", heightIn: 14, shape: { kind: "rect", widthFt: 10, depthFt: 10 } }), freshVoiceState(), env);
  check("a small, low, free deck may not", /may not need one/.test(small.say), small.say);
}

console.log("── every roof shape, said many ways, is the roof built");
{
  // The 3D draws the BUILT roof (lib/deck/roof may frame a hip as a gable against the house, a pyramid on a rectangle
  // as a hip): what is said must end on the shape asked for, or say why not.
  const builtKind = (d: DeckDesign) => buildStructure(d).roof?.kind ?? "none";
  const deck = (w: number, dp: number) => base({ shape: { kind: "rect", widthFt: w, depthFt: dp } });
  const sayOn = (d: DeckDesign, text: string, st = freshVoiceState()) => hear(text, d, st, {});
  const cases: Array<[string, number, number, string]> = [
    ["add a hip roof", 16, 12, "hip"],
    ["hipped roof please", 16, 12, "hip"],
    ["I want the roof to slope on all four sides", 16, 12, "hip"],
    ["hit roof", 16, 12, "hip"],
    ["add a gable roof", 16, 12, "gable"],
    ["cable roof", 16, 12, "gable"],
    ["a frame roof over it", 16, 12, "gable"],
    ["a regular peaked roof", 16, 12, "gable"],
    ["shed roof", 16, 12, "shed"],
    ["a lean to roof", 16, 12, "shed"],
    ["flat roof", 16, 12, "shed"],
    ["single slope roof", 16, 12, "shed"],
    ["gambrel roof", 24, 12, "gambrel"],
    ["barn style roof", 24, 12, "gambrel"],
    ["gamble roof", 24, 12, "gambrel"],
    ["dutch gable roof", 24, 12, "dutch-gable"],
    ["a hip roof with little gables on the ends", 24, 12, "dutch-gable"],
    ["pagoda roof", 16, 12, "double-tier"],
    ["two tier roof", 16, 12, "double-tier"],
    ["pyramid roof", 14, 14, "pyramid"],
    ["a roof that comes to a point", 14, 14, "pyramid"],
  ];
  for (const [text, w, dp, want] of cases) {
    const r = sayOn(deck(w, dp), text);
    const got = r.design ? builtKind(r.design) : "unchanged";
    check(`"${text}" on a ${w} × ${dp} deck builds a ${want} roof`, got === want, `${got}: ${r.say}`);
  }
  // A pyramid asked for on a rectangle: the hip it frames as is said, and "yes" makes the square that is a pyramid.
  let st = freshVoiceState();
  const r1 = hear("pyramid roof", deck(16, 12), st, {});
  check("a pyramid on 16 × 12 says it frames as a hip and offers a square", builtKind(r1.design!) === "hip" && /pyramid needs a square/.test(r1.say) && !!r1.pending, r1.say);
  st = r1.state;
  const r2 = hear("yes", r1.design!, st, {});
  check("…and yes makes it a true pyramid over a square", !!r2.design && builtKind(r2.design) === "pyramid" && r2.design.roof.plan.shape === "square", r2.say);
  // From a pergola or a gazebo, the shape decides what carries it.
  const pergola = switchStructure(base(), "pergola");
  const fromPergola = hear("make it a hip roof", pergola, freshVoiceState(), {});
  check("a hip asked for on a pergola makes it a covered deck with a hip", fromPergola.design?.structure === "covered-deck" && builtKind(fromPergola.design) === "hip", fromPergola.say);
  const gazebo = switchStructure(base(), "gazebo");
  const shedOn = hear("shed roof", gazebo, freshVoiceState(), {});
  check("a shed roof asked for on a gazebo makes it a covered deck", shedOn.design?.structure === "covered-deck" && builtKind(shedOn.design) === "shed", shedOn.say);
  const covered = patchRoof(switchStructure(base(), "covered-deck"), { roofing: "standing-seam", ceiling: "beadboard" });
  const barn = hear("barn roof", covered, freshVoiceState(), {});
  check("a covered deck turned gazebo for a barn roof keeps its metal roofing and its ceiling", barn.design?.structure === "gazebo" && barn.design.roof.roofing === "standing-seam" && barn.design.roof.ceiling === "beadboard", barn.say);
  const oct = hear("octagon gazebo", base(), freshVoiceState(), {});
  const octHip = hear("hip roof", oct.design!, oct.state, {});
  check("a hip on an octagon is a pyramid, said so", !!octHip.design && builtKind(octHip.design) === "pyramid" && /one peak/.test(octHip.say), octHip.say);
  const part = hear("roof over the left half only", base(), freshVoiceState(), {});
  check("a roof over the left half: a rectangle half the deck wide, shifted left", part.design?.roof.plan.shape === "rect" && part.design.roof.plan.widthFt === 8 && part.design.roof.plan.offsetFt === -4, part.say);
}

console.log("── the runner holds the engine's rails");
{
  const d = base();
  const huge = runCommand(d, { do: "size", width: { to: 200 }, depth: { to: 90 } });
  check("a size past the rails is held to them and said", huge.design.shape.widthFt === 60 && huge.design.shape.depthFt === 40 && /60 ft/.test(huge.said.join(" ")), huge.said.join(" "));
  const brick = runCommand(runCommand(d, { do: "wall", to: "brick-veneer" }).design, { do: "placement", to: "attached" });
  check("a ledger on brick veneer is refused, with the code's reason", brick.design.placement !== "attached" && /veneer/.test(brick.said.join(" ")), brick.said.join(" "));
  const fan = runCommand(d, { do: "fixture", op: "add", kind: "fan" });
  check("a fan with no roof asks to add one", fan.refused === true && !!fan.pending, fan.said.join(" "));
  // (2026-11-14: steps that wrap the deck go to seven risers, on stringers past three.)
  const box = runCommand({ ...d, heightIn: 60 }, { do: "stairs", op: "add", wrap: true });
  check("steps wrapping a 5-ft deck are refused, a flight offered", box.refused === true && box.pending?.yes[0].do === "stairs");
  check("…on a 3-ft deck they are added", runCommand({ ...d, heightIn: 36 }, { do: "stairs", op: "add", wrap: true }).design.stairs.some((x) => x.wrap));
  const gazebo = runCommand(switchStructure(d, "covered-deck"), { do: "roof", set: { kind: "pyramid" } });
  check("a pyramid roof on a covered deck is built as a gazebo — and on a rectangle said to frame as a hip, with a square offered", gazebo.design.structure === "gazebo" && gazebo.design.roof.kind === "pyramid" && /short ridge — a hip roof/.test(gazebo.said.join(" ")) && gazebo.pending?.yes[0].do === "roof", gazebo.said.join(" "));
  const joists = runCommand(base({ shape: { kind: "rect", widthFt: 16, depthFt: 16 } }), { do: "framing", set: { joist: "2x6" } });
  check("joists asked smaller are framed to the tables (the beams come in) — no span left failing", !deckChecks(priceDeck(joists.design).structure).some((c) => c.level === "fail" && /^joist-span/.test(c.id)), joists.said.join(" "));
  const gray = runCommand(base({ decking: { product: "cedar-54" } }), { do: "decking", set: { color: "gray" } });
  check("wood asked for in gray moves to a capped board, said", ["composite", "pvc", "mineral"].includes(priceDeck(gray.design).frame?.decking.family ?? "") && /Wood doesn't come gray/.test(gray.said.join(" ")), gray.said.join(" "));
  check("…the reply opens with the boards it is now", /^Switched to /.test(gray.said[0] ?? ""), gray.said.join(" "));
  // A PVC board asked for in a colour only a composite comes in: said of PVC, not of wood (2026-10-22).
  const pvc = runCommand(base({ decking: { product: "timbertech-azek-vintage" } }), { do: "decking", set: { color: "dark gray" } });
  check("a PVC board moved for a colour is said of PVC — not \"Wood doesn't come…\"", !/Wood doesn't/.test(pvc.said.join(" ")) && (pvc.design.decking.product === "timbertech-azek-vintage" || /PVC/.test(pvc.said.join(" "))), pvc.said.join(" "));
  const tub = runCommand(d, { do: "spa", on: true });
  check("a hot tub spot lights its field", tub.design.spa.on && tub.light?.label === "Where the tub stands");
  const walls = runCommand(switchStructure(d, "covered-deck"), { do: "roof", set: { walls: "screen" } });
  check("screens on a covered deck", walls.design.roof.walls.fill === "screen", walls.said.join(" "));
  // Every command kind from a fresh design never throws and leaves a buildable design.
  const all: DeckCommand[] = cmdsOf("make it 20 by 14 | raise it a foot | L shaped | add stairs | aluminum railing | add a roof | 6/12 pitch | add heaters | add a hot tub | add a lower level | trex | 2x10 joists | frost 36 inches | snow 40 psf | tear out the old deck".replace(/\|/g, "."));
  let design = d;
  let threw = false;
  for (const cmd of all) {
    try {
      design = runCommand(design, cmd).design;
    } catch (err) {
      threw = true;
      console.log(cmd, err);
    }
  }
  check("a long run of commands never throws", !threw && all.length >= 14, `${all.length} commands`);
  check("…and the design still prices", priceDeck(design).subtotal > 0);
}

console.log("── answers read off the priced design");
{
  const d = base({ stairs: [{ id: "s1", side: "front", atFt: 8, widthFt: 4, level: "upper", wrap: false, wrapSides: 1, landing: "pad", handrail: "auto" }], rail: { type: "composite" } });
  const pkg = priceDeck(d);
  const checks = deckChecks(pkg.structure);
  const boards = answer("boards", "", pkg, checks);
  const total = pkg.structure.surface!.stock.reduce((a, x) => a + x.count, 0);
  check("the board count is the material list's", boards.say.startsWith(`${total} boards`), boards.say);
  const joists = answer("joists", "", pkg, checks);
  check("the joists answer names the size and the spacing", new RegExp(`${pkg.frame!.joistSize} at ${pkg.frame!.spacingIn} in`).test(joists.say), joists.say);
  const price = answer("price", "how much does it cost", pkg, checks);
  check("the price answer is the subtotal", price.say.startsWith(`$${Math.round(pkg.subtotal).toLocaleString("en-US")}`), price.say);
  const railPrice = answer("price", "how much is the railing", pkg, checks);
  check("the price of a part is that part's lines", /for that/.test(railPrice.say), railPrice.say);
  const stairs = answer("stairs", "", pkg, checks);
  check("the stairs answer counts the risers", new RegExp(`${pkg.structure.stairs[0].risers} risers`).test(stairs.say), stairs.say);
  const layout = answer("layout", "", pkg, checks);
  check("how it lays down: the joists, the boards, and the build plays", /joists run out from the house/.test(layout.say) && layout.view?.build === "play", layout.say);
  const code = answer("code", "", pkg, checks);
  check("the code answer names the code", code.say.includes(pkg.structure.code.name), code.say);
  check("the design summary for the AI has the size", /16 ft along the house/.test(designSummary(d)));
}

console.log("── the AI's commands are checked before they run");
{
  const { cmds, dropped } = checkCommands([
    { do: "size", width: { to: 20 } },
    { do: "decking", set: { product: "not-a-board" } },
    { do: "roof", set: { kind: "dome" } },
    { do: "stairs", op: "add", side: "front" },
    { do: "fixture", op: "add", kind: "heater", qty: { to: 2 } },
    { do: "nonsense" },
    "make it bigger",
  ]);
  check("good commands pass, bad ones drop alone", cmds.length === 3 && dropped === 4, show(cmds));
  const r = runCommands(cmds, base(), freshVoiceState(), {}, "ai");
  check("the AI's commands run through the same runner", r.design?.shape.widthFt === 20 && r.design.stairs.length === 1, r.say);
}

console.log("── the studio's doors (lib/deck/edit) keep the house and the deck together");
{
  const d = base({ house: { storeys: 1, roof: "hip", leftFt: 4, rightFt: 4, jogs: [{ id: "j1", atFt: 12, dir: "toward", depthFt: 3 }], siding: "cream", roofColour: "charcoal" } });
  const wider = patchDesign(d, { shape: { kind: "rect", widthFt: 24, depthFt: 12 } });
  check("a resize keeps the deck fitted to the house's bump-out", wider.shape.widthFt === 24, show(wider.shape));
  const switched = switchStructure(base(), "covered-deck");
  check("deck → covered deck keeps the roof the deck carried", switched.structure === "covered-deck" && switched.roof.kind === "gable");
}

console.log("── a thousand sentences, none of them throws");
{
  const words = ["make", "it", "the", "deck", "stairs", "bigger", "smaller", "wider", "add", "remove", "a", "roof", "railing", "trex", "gray", "20", "by", "14", "feet", "inches", "higher", "lower", "left", "right", "show", "me", "night", "how", "much", "concrete", "what", "if", "composite", "and", "then", "heater", "hot", "tub", "lower level", "joists", "2x10", "pitch", "8/12", "undo", "yes", "no", "please", "with", "fire pit", "$500", "pergola", "gazebo", "screen", "it", "in", "hip", "gambrel", "dutch gable", "pyramid", "pagoda", "half", "over", "octagon", "house", "past", "custom", "called", "a foot", "rafters", "headers", "too", "deep", "corner", "round", "all the way", "across"];
  let seed = 7;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  let d = base();
  let st = freshVoiceState();
  let threw = 0;
  for (let i = 0; i < 1000; i++) {
    const n = 1 + Math.floor(rand() * 9);
    const s = Array.from({ length: n }, () => words[Math.floor(rand() * words.length)]).join(" ");
    try {
      const r = hear(s, d, st, {});
      if (r.design) d = normalizeDeckDesign(r.design);
      st = r.state;
    } catch (err) {
      threw++;
      if (threw < 4) console.log("threw on:", s, err);
    }
  }
  check("no sentence throws", threw === 0, `${threw} threw`);
  check("the design after all of it still prices", priceDeck(d).subtotal > 0);
}

console.log(`\n${count - bad}/${count} passed`);
if (bad) {
  console.log(`${bad} FAILED`);
  process.exit(1);
}
