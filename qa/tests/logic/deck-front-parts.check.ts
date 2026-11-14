// THE FRONT, PART BY PART (2026-11-14; lib/deck/design FrontPart / normalizeFront / shapeWithFront) — the owner: "more
// complex decks… where you can change shape of the front deck and sides, it's not just only squares, but it's not only
// L shape, but you can basically do anything."
// A deck's front was one line (straight, bowed, its two corners clipped) or an L's two. Now the front is set in parts,
// left to right: each as wide as it is set and standing its own distance out from the house — a bay that comes out, a
// side that stops short, a T, a U, steps down a side — over a back that still follows the house wall part by part (and
// may run past the house's corner). Every stretch between two cuts of the back or the front is one rectangle of deck,
// framed off its own back to its own front.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/deck-front-parts.check.ts
import { DECK_LIMITS, FRONT_LIMITS, defaultDeckDesign, defaultStair, frontEdgeAt, frontParts, hasLowerLevel, normalizeDeckDesign, normalizeFront, shapeAreaSqFt, shapeEdges, shapeOutline, shapeWithFront, shapeZones, sizeWords, type DeckDesign, type DeckShape } from "../../../src/lib/deck/design";
import { deckShapeForHouse, defaultHouse, setDeckPast } from "../../../src/lib/deck/house";
import { buildStructure } from "../../../src/lib/deck/structure";
import { applyDeckPatch, deckChecks } from "../../../src/lib/deck/checks";
import { patchDesign } from "../../../src/lib/deck/edit";
import { priceDeck } from "../../../src/lib/deck/pricing";
import { deckScene } from "../../../src/lib/deck/scene";
import { settleDesign } from "../../../src/lib/deck/settle";
import { planModel } from "../../../src/lib/deck/plans/model";
import { tributaries } from "../../../src/lib/deck/plans/foundation";
import { permitPages, permitSheets } from "../../../src/lib/deck/permit";
import { parseUtterance } from "../../../src/lib/deck/voice/parse";
import { runCommand } from "../../../src/lib/deck/voice/run";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};
const d0 = defaultDeckDesign({ state: "WA" });
const rect = (w: number, d: number): DeckShape => ({ kind: "rect", widthFt: w, depthFt: d });
const mk = (over: Record<string, unknown> = {}): DeckDesign => normalizeDeckDesign({ ...d0, shape: rect(24, 12), heightIn: 48, rail: { ...d0.rail, type: "aluminum" }, ...over });
const base = mk();
const parts = (d: DeckDesign, list: Array<[number, number]>) => patchDesign(d, { shape: shapeWithFront(d.shape, list.map(([widthFt, yFt]) => ({ widthFt, yFt }))) });
const fails = (d: DeckDesign) => deckChecks(buildStructure(d)).filter((c) => c.level === "fail").map((c) => c.id);
const straight = [{ x0Ft: 0, x1Ft: 24, yFt: 0 }];

console.log("── the front read back");
const nf = (raw: unknown, back = straight, W = 24, D = 16) => normalizeFront(raw, W, D, back);
check("three parts across the deck's width, end to end", JSON.stringify(nf([{ x0Ft: 0, x1Ft: 7, yFt: 12 }, { x0Ft: 7, x1Ft: 17, yFt: 16 }, { x0Ft: 17, x1Ft: 24, yFt: 12 }])) === JSON.stringify([{ x0Ft: 0, x1Ft: 7, yFt: 12 }, { x0Ft: 7, x1Ft: 17, yFt: 16 }, { x0Ft: 17, x1Ft: 24, yFt: 12 }]));
check("neighbours on one line are one part; a front all on one line is no parts at all", nf([{ x0Ft: 0, x1Ft: 8, yFt: 12 }, { x0Ft: 8, x1Ft: 16, yFt: 12 }, { x0Ft: 16, x1Ft: 24, yFt: 16 }])!.length === 2 && nf([{ x0Ft: 0, x1Ft: 12, yFt: 16 }, { x0Ft: 12, x1Ft: 24, yFt: 16 }]) === null);
check("a part under 2 ft wide goes with its neighbour", nf([{ x0Ft: 0, x1Ft: 1, yFt: 10 }, { x0Ft: 1, x1Ft: 12, yFt: 16 }, { x0Ft: 12, x1Ft: 13, yFt: 8 }, { x0Ft: 13, x1Ft: 24, yFt: 12 }])!.map((q) => q.x1Ft).join() === "13,24");
check("no part stands farther out than the deck is deep, nor nearer the wall than 3 ft of deck", nf([{ x0Ft: 0, x1Ft: 12, yFt: 99 }, { x0Ft: 12, x1Ft: 24, yFt: 1 }])!.map((q) => q.yFt).join() === "16,3");
check("in front of a bump-out a part keeps its 3 ft: the wall out 6 ft there, the front no nearer than 9", nf([{ x0Ft: 0, x1Ft: 12, yFt: 16 }, { x0Ft: 12, x1Ft: 24, yFt: 5 }], [{ x0Ft: 0, x1Ft: 12, yFt: 0 }, { x0Ft: 12, x1Ft: 24, yFt: 6 }])![1].yFt === 9);
check("a cut within 2 ft of a step in the wall IS that step — no sliver of deck between the two", nf([{ x0Ft: 0, x1Ft: 13, yFt: 16 }, { x0Ft: 13, x1Ft: 24, yFt: 10 }], [{ x0Ft: 0, x1Ft: 12, yFt: 0 }, { x0Ft: 12, x1Ft: 24, yFt: 2 }])![0].x1Ft === 12);
check(`${FRONT_LIMITS.parts} parts at the most`, nf(Array.from({ length: 11 }, (_, i) => ({ x0Ft: i * 2, x1Ft: i * 2 + 2, yFt: i % 2 ? 16 : 10 })))!.length === FRONT_LIMITS.parts);
check("junk is no front", nf("x") === null && nf([null, 1, { x0Ft: 5, x1Ft: 2 }]) === null);

console.log("── the shape");
const tee = parts(base, [[7, 12], [10, 18], [7, 12]]);
const zT = shapeZones(tee.shape);
check("a T: the deck is as wide as its parts and as deep as the deepest", tee.shape.kind === "wall" && tee.shape.widthFt === 24 && tee.shape.depthFt === 18 && tee.shape.front!.length === 3 && tee.shape.back.length === 1);
check("three rectangles, each from the wall to its own front", zT.map((z) => `${z.x0}-${z.x1}:${z.y0}-${z.y1}`).join(" ") === "0-84:0-144 84-204:0-216 204-288:0-144");
const eT = shapeEdges(tee.shape, "attached");
check("ONE edge along the wall; a front edge along each part; the bay's two sides are open edges", eT.filter((e) => e.side === "back").length === 1 && eT.filter((e) => e.side === "back")[0].lengthIn === 288 && eT.filter((e) => e.side === "front").length === 3 && eT.some((e) => e.x0 === 84 && e.y0 === 144 && e.y1 === 216 && e.side === "left" && !e.house) && eT.some((e) => e.x0 === 204 && e.y0 === 144 && e.y1 === 216 && e.side === "right" && !e.house));
check("the outline steps round the bay — eight corners, none of them on a straight run", JSON.stringify(shapeOutline(tee.shape)) === JSON.stringify([{ x: 0, y: 0 }, { x: 288, y: 0 }, { x: 288, y: 144 }, { x: 204, y: 144 }, { x: 204, y: 216 }, { x: 84, y: 216 }, { x: 84, y: 144 }, { x: 0, y: 144 }]));
check("its area: 24 × 12 and a 10 × 6 bay", shapeAreaSqFt(tee.shape) === 348 && priceDeck(tee).areaSqFt === 348);
check("the front at any place along the deck is its part's", frontEdgeAt(tee.shape, 40) === 144 && frontEdgeAt(tee.shape, 144) === 216 && frontEdgeAt(tee.shape, 250) === 144);
check("in words", sizeWords(tee) === "24 ft × 18 ft its front in 3 parts", sizeWords(tee));
check("read back the same", JSON.stringify(normalizeDeckDesign(JSON.parse(JSON.stringify(tee)))) === JSON.stringify(tee));
check("the front as parts whatever the shape: a rectangle is one, an L two", frontParts(base.shape).length === 1 && JSON.stringify(frontParts({ kind: "L", widthFt: 20, depthFt: 14, notch: { corner: "front-right", widthFt: 8, depthFt: 6 } })) === JSON.stringify([{ x0Ft: 0, x1Ft: 12, yFt: 14 }, { x0Ft: 12, x1Ft: 20, yFt: 8 }]));
const one = patchDesign(tee, { shape: shapeWithFront(tee.shape, [{ widthFt: 24, yFt: 14 }]) });
check("set to one part, the deck is a rectangle again", one.shape.kind === "rect" && one.shape.depthFt === 14);

console.log("── the frame");
const sT = buildStructure(tee);
const f = sT.frame!;
check("each part hangs on the ledger and stands on its own front beam; the ledger is one run", f.zones.length === 3 && f.zones.every((z) => z.back === "ledger" && z.ok) && f.ledgers.length === 1 && f.ledgers[0].lengthIn === 288 && f.beams.filter((b) => b.role === "front").length === 3);
check("the bay's beam stands under the bay, out past the sides' beams", f.beams.some((b) => b.x0 === 84 && b.x1 === 204 && b.y > 180) && f.beams.filter((b) => b.y < 144).length === 2);
check("an edge joist runs down each side of the bay", f.joists.some((j) => j.edge && Math.abs(j.x - 84.75) < 0.01) && f.joists.some((j) => j.edge && Math.abs(j.x - 203.25) < 0.01));
check("60 ft of open edge: the fronts, the bay's sides, the deck's ends", f.openEdgeFt === 60 && f.houseEdgeFt === 24);
check("no stick lies past its part's front", !f.sticks.some((s) => s.role === "joist" && (s.cx < 84 || s.cx > 204) && s.cy + s.sy / 2 > 144.5), JSON.stringify(f.sticks.find((s) => s.role === "joist" && (s.cx < 84 || s.cx > 204) && s.cy + s.sy / 2 > 144.5)));
check("nothing fails — a T, a U, steps down a side, a front in five parts", [tee, parts(base, [[6, 16], [12, 10], [6, 16]]), parts(base, [[8, 16], [8, 12], [8, 8]]), parts(mk({ shape: rect(40, 12) }), [[6, 10], [8, 14], [12, 18], [8, 14], [6, 10]])].every((d) => fails(d).length === 0));
const settled = settleDesign(tee).design;
check("settling the frame keeps the parts", JSON.stringify(settled.shape) === JSON.stringify(tee.shape));

console.log("── rails, boards, stairs");
check("the rail runs round the bay: along its front and both its sides", sT.rails.segments.some((g) => Math.abs(g.y0 - 216) < 9 && Math.abs(g.y1 - 216) < 9) && sT.rails.segments.some((g) => Math.abs(g.x0 - 84) < 9 && Math.abs(g.x1 - 84) < 9 && Math.max(g.y0, g.y1) > 200) && Math.abs(sT.rails.lf - 60) < 4, `${sT.rails.lf}`);
check("boards cover the bay and stop at the sides' fronts", sT.surface!.pieces.some((p) => p.cy > 200 && p.cx > 84 && p.cx < 204) && !sT.surface!.pieces.some((p) => p.cy - p.sy / 2 > 146 && (p.cx + p.sx / 2 < 84 || p.cx - p.sx / 2 > 204)));
const bordered = buildStructure(normalizeDeckDesign({ ...tee, decking: { ...tee.decking, border: 1, fascia: "match" } }));
check("a border and fascia follow every open edge, the bay's sides too", bordered.surface!.borderEdges.length === 7 && bordered.surface!.fascia.lf === 60, `${bordered.surface!.borderEdges.length} edges, ${bordered.surface!.fascia.lf} ft`);
const stairs = normalizeDeckDesign({ ...tee, stairs: [{ ...defaultStair("s1", "front", 12), widthFt: 4 }, { ...defaultStair("s2", "front", 7.5), widthFt: 4 }, { ...defaultStair("s3", "left", 30), widthFt: 4 }] });
const sS = buildStructure(stairs);
check("a front stair leaves from the front of the part it is on — the bay's, 18 ft out", Math.abs(Math.min(...sS.stairs[0].footprint.map((q) => q.y)) - 216) < 1);
check("…and stays on ONE part: set across a step in the front, it is moved wholly onto the part its middle is over", stairs.stairs[1].atFt === 9 && Math.abs(Math.min(...sS.stairs[1].footprint.map((q) => q.y)) - 216) < 1, `${stairs.stairs[1].atFt}`);
check("a side stair stays on the end part's side: no farther out than that part stands", stairs.stairs[2].atFt === 10);
check("a lower level steps down from one straight front — not offered on a front in parts; a double deck is", !hasLowerLevel(normalizeDeckDesign({ ...tee, lower: { ...d0.lower, on: true, place: "front" } })) && hasLowerLevel(normalizeDeckDesign({ ...tee, heightIn: 126, lower: { ...d0.lower, on: true, place: "under", heightIn: 18 } })));

console.log("── with the house: the wall behind it, the corner past it");
const jog = patchDesign(tee, { house: { jogs: [{ id: "j1", atFt: 16, dir: "toward", depthFt: 3 }] } });
check("the wall steps out behind the deck: the back follows it, the front keeps its parts (cut at the wall's step, 1 ft off its own)", jog.shape.kind === "wall" && jog.shape.back.length === 2 && jog.shape.back[1].yFt === 3 && jog.shape.front!.map((q) => q.x1Ft).join() === "7,16,24" && fails(jog).length === 0, JSON.stringify(jog.shape));
check("…a bump-out at the deck's END does not turn a deck in parts into an L", (() => { const fit = deckShapeForHouse(tee.shape, { ...defaultHouse(), jogs: [{ id: "j1", atFt: 18, dir: "toward", depthFt: 3 }] }); return fit.shape.kind === "wall" && !!fit.shape.front; })());
const level = patchDesign(jog, { house: { jogs: [] } });
check("the wall straight again: still a deck in parts", level.shape.kind === "wall" && level.shape.back.length === 1 && level.shape.front!.length === 3);
const r = setDeckPast(tee.house, tee.shape, "right", 6, 8, { minWidthFt: DECK_LIMITS.widthFt.min, maxWidthFt: DECK_LIMITS.widthFt.max });
const round = patchDesign(tee, { house: r.house, shape: r.shape });
check("run past the house's right corner and 8 ft back: the bay stays, the last part grows to the new end and stands on its own beam", round.shape.kind === "wall" && round.shape.widthFt === 34 && round.shape.back.some((b) => b.open && b.yFt === -8) && round.shape.front!.length === 3 && round.shape.front![2].x1Ft === 34 && fails(round).length === 0 && buildStructure(round).frame!.zones.some((z) => z.zone.open && z.back === "beam"), JSON.stringify(round.shape));
const wider = patchDesign(tee, { shape: { ...tee.shape, widthFt: 30 } });
check("the deck made wider: the last part takes the change", wider.shape.kind === "wall" && wider.shape.front![2].x1Ft === 30 && wider.shape.front![1].x1Ft === 17);
const deeper = patchDesign(tee, { shape: { ...tee.shape, depthFt: 20 } });
check("the deck made deeper: the part that stood farthest out goes to the new depth, the others stay", deeper.shape.kind === "wall" && deeper.shape.depthFt === 20 && deeper.shape.front!.map((q) => q.yFt).join() === "12,20,12");
const shallower = patchDesign(tee, { shape: { ...tee.shape, depthFt: 14 } });
check("…and shallower the same way", shallower.shape.kind === "wall" && shallower.shape.front!.map((q) => q.yFt).join() === "12,14,12");
check("a plain rectangle picked: one straight front", patchDesign(tee, { shape: rect(24, 18) }).shape.kind === "rect");

console.log("── the drawings, the price, the voice");
const m = planModel(sT)!;
const tr = tributaries(m);
let pages = 0;
let threw = "";
try {
  pages = permitPages(sT).length + permitSheets(sT).length;
} catch (e) {
  threw = e instanceof Error ? e.message : String(e);
}
check("the permit set draws, every post's strip shaded", pages > 4 && !threw && tr.length === f.posts.length && tr.every((t) => t.pts.length >= 3), threw);
check("the 3D draws more than the rectangle's", deckScene(sT).boxes.length > deckScene(buildStructure(base)).boxes.length);
check("the price has the bay in it", priceDeck(tee).subtotal > priceDeck(base).subtotal);
const say = (d: DeckDesign, text: string) => {
  let out = d;
  const heard: string[] = [];
  for (const cmd of parseUtterance(text, { design: d } as never).clauses.flatMap((c) => c.cmds)) {
    const res = runCommand(out, cmd);
    out = res.design;
    heard.push(...res.said);
  }
  return { design: out, said: heard.join(" ") };
};
const v1 = say(base, "make it T-shaped");
check("\"make it T-shaped\": the middle third 4 ft farther out", v1.design.shape.kind === "wall" && v1.design.shape.front!.map((q) => `${q.x1Ft - q.x0Ft}:${q.yFt}`).join() === "8:12,8:16,8:12" && /T-shaped/.test(v1.said), v1.said);
const v2 = say(base, "make it a T shape 10 by 6");
check("\"a T shape 10 by 6\": a 10-ft part 6 ft out", v2.design.shape.kind === "wall" && v2.design.shape.front![1].x1Ft - v2.design.shape.front![1].x0Ft === 10 && v2.design.shape.depthFt === 18);
const v3 = say(base, "make it U shaped");
check("\"make it U shaped\": the two ends come out", v3.design.shape.kind === "wall" && v3.design.shape.front!.map((q) => q.yFt).join() === "16,12,16");
const v4 = say(base, "the left side 4 feet deeper");
check("\"the left side 4 feet deeper\"", v4.design.shape.kind === "wall" && v4.design.shape.front!.map((q) => q.yFt).join() === "16,12");
check("\"make it a rectangle\" takes the parts away", say(v1.design, "make it a rectangle").design.shape.kind === "rect");
check("\"bay shaped\" is still the clipped corners; a bump-out of the HOUSE is still the wall's", (() => { const b = say(base, "bay shaped").design.shape; return b.kind === "rect" && b.front?.kind === "clipped"; })() && say(base, "the house has a bump out on the right").design.house.jogs.length === 1);
void applyDeckPatch;

console.log(bad ? `\n${bad} FAILED` : "\nALL PASS");
process.exit(bad ? 1 : 0);
