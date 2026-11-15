// THE FRONT, PART BY PART (2026-11-14; lib/deck/design FrontPart / normalizeFront / shapeWithFront) — the owner: "more
// complex decks… where you can change shape of the front deck and sides, it's not just only squares, but it's not only
// L shape, but you can basically do anything."
// A deck's front was one line (straight, bowed, its two corners clipped) or an L's two. Now the front is set in parts,
// left to right: each as wide as it is set and standing its own distance out from the house — a bay that comes out, a
// side that stops short, a T, a U, steps down a side — over a back that still follows the house wall part by part (and
// may run past the house's corner). Every stretch between two cuts of the back or the front is one rectangle of deck,
// framed off its own back to its own front.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/deck-front-parts.check.ts
import { DECK_LIMITS, FRONT_LIMITS, defaultDeckDesign, defaultStair, frontClips, frontEdgeAt, frontParts, hasLowerLevel, normalizeDeckDesign, normalizeFront, shapeAreaSqFt, shapeEdges, shapeOutline, shapeWithFront, shapeZones, sizeWords, type DeckDesign, type DeckShape } from "../../../src/lib/deck/design";
import { deckShapeForHouse, defaultHouse, setDeckPast } from "../../../src/lib/deck/house";
import { buildStructure } from "../../../src/lib/deck/structure";
import { applyDeckPatch, deckChecks } from "../../../src/lib/deck/checks";
import { patchDesign } from "../../../src/lib/deck/edit";
import { priceDeck } from "../../../src/lib/deck/pricing";
import { deckScene } from "../../../src/lib/deck/scene";
import { AUTO_FIX, settleDesign } from "../../../src/lib/deck/settle";
import { partCard } from "../../../src/lib/deck/parts";
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

console.log("── corners cut at an angle");
type Cut = { widthFt: number; yFt: number; clipLeftFt?: number; clipRightFt?: number };
const cutParts = (d: DeckDesign, list: Cut[]) => patchDesign(d, { shape: shapeWithFront(d.shape, list) });
const front = (d: DeckDesign) => (d.shape.kind === "wall" ? (d.shape.front ?? []) : []);
const bay = cutParts(base, [{ widthFt: 7, yFt: 12 }, { widthFt: 10, yFt: 18, clipLeftFt: 3, clipRightFt: 3 }, { widthFt: 7, yFt: 12 }]);
check("a bay's two corners cut 3 ft at 45°", front(bay)[1].clipLeftFt === 3 && front(bay)[1].clipRightFt === 3 && frontClips(bay.shape).length === 2);
const inner = cutParts(base, [{ widthFt: 7, yFt: 12, clipRightFt: 3 }, { widthFt: 10, yFt: 18 }, { widthFt: 7, yFt: 12, clipLeftFt: 3 }]);
check("only a corner that stands OUT is cut: asked of the corners in the angle beside the bay, nothing is", frontClips(inner.shape).length === 0);
const ends = cutParts(base, [{ widthFt: 7, yFt: 12, clipLeftFt: 4 }, { widthFt: 10, yFt: 18 }, { widthFt: 7, yFt: 12, clipRightFt: 4 }]);
check("…the deck's own two end corners are", front(ends)[0].clipLeftFt === 4 && front(ends)[2].clipRightFt === 4);
const deepCut = cutParts(base, [{ widthFt: 7, yFt: 12 }, { widthFt: 10, yFt: 16, clipLeftFt: 9, clipRightFt: 0.5 }, { widthFt: 7, yFt: 12 }]);
check("a cut goes no farther back than the face beside it (4 ft here); under a foot is no cut", front(deepCut)[1].clipLeftFt === 4 && front(deepCut)[1].clipRightFt === undefined);
const prow = cutParts(base, [{ widthFt: 6, yFt: 10 }, { widthFt: 12, yFt: 16, clipLeftFt: 6, clipRightFt: 9 }, { widthFt: 6, yFt: 10 }]);
check("two cuts share the part's width: 6 ft each on a 12-ft part make a point", front(prow)[1].clipLeftFt === 6 && front(prow)[1].clipRightFt === 6);
const oneFront = cutParts(base, [{ widthFt: 24, yFt: 14, clipLeftFt: 5, clipRightFt: 2 }]);
check("ONE straight front with its corners cut — each its own size — is a deck in parts too", oneFront.shape.kind === "wall" && front(oneFront).length === 1 && front(oneFront)[0].clipLeftFt === 5 && front(oneFront)[0].clipRightFt === 2);
check("at the deck's end 2 ft of side stay square: a 12-ft cut on a 12-ft side is held at 10", front(cutParts(base, [{ widthFt: 24, yFt: 12, clipLeftFt: 12 }]))[0].clipLeftFt === 10);
check("the outline has two corners where one was cut", JSON.stringify(shapeOutline(bay.shape)) === JSON.stringify([{ x: 0, y: 0 }, { x: 288, y: 0 }, { x: 288, y: 144 }, { x: 204, y: 144 }, { x: 204, y: 180 }, { x: 168, y: 216 }, { x: 120, y: 216 }, { x: 84, y: 180 }, { x: 84, y: 144 }, { x: 0, y: 144 }]));
check("the area is less the two triangles: 348 − 9", shapeAreaSqFt(bay.shape) === 339);
check("the front along a cut runs back at 45°", frontEdgeAt(bay.shape, 85) === 181 && frontEdgeAt(bay.shape, 102) === 198 && frontEdgeAt(bay.shape, 144) === 216 && frontEdgeAt(bay.shape, 203) === 181);
const eB = shapeEdges(bay.shape, "attached");
check("the bay's front is as long as its straight run and its two cuts; its sides are shorter by them", Math.abs(eB.find((e) => e.side === "front" && e.x0 === 84)!.lengthIn - (48 + 72 * Math.SQRT2)) < 0.01 && eB.some((e) => e.x0 === 84 && e.y0 === 144 && e.y1 === 180));
check("read back the same; in words", JSON.stringify(normalizeDeckDesign(JSON.parse(JSON.stringify(bay)))) === JSON.stringify(bay) && sizeWords(bay) === "24 ft × 18 ft its front in 3 parts, 2 corners cut at an angle" && sizeWords(oneFront) === "24 ft × 14 ft 2 corners cut at an angle", `${sizeWords(bay)} | ${sizeWords(oneFront)}`);

const inRing = (ring: Array<{ x: number; y: number }>, x: number, y: number) => {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
};
/** Every post, and every corner of every straight beam, joist and rim, inside the deck's outline. */
const allInside = (d: DeckDesign) => {
  const ring = shapeOutline(d.shape);
  const fr = buildStructure(d).frame!;
  const sticksOut = fr.sticks.filter((st) => (st.role === "beam" || st.role === "joist" || st.role === "blocking") && !st.yaw).filter((st) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].some(([sx, sy]) => !inRing(ring, st.cx + (sx * st.sx) / 2 - sx * 0.5, st.cy + (sy * st.sy) / 2 - sy * 0.5)));
  const postsOut = fr.posts.filter((q) => !inRing(ring, q.x, q.y));
  return sticksOut.length === 0 && postsOut.length === 0;
};
const sBay = buildStructure(bay);
const fBay = sBay.frame!;
check("the bay's beam stops inside both cuts, its posts with it — nothing stands outside the deck", allInside(bay) && fBay.beams.some((b) => b.x0 > 84 + 10 && b.x1 < 204 - 10 && b.y > 180));
check("a 3-ft cut is within reach of the joists' overhang: no angled beam", fBay.cornerBeams.length === 0 && !deckChecks(sBay).some((c) => c.id === "deck-corner-beams"));
check("the joists under a cut are cut to it, and a rim runs along it at 45°", fBay.sticks.filter((st) => st.role === "rim" && st.yaw && Math.abs(Math.abs(Math.tan(st.yaw)) - 1) < 0.01).length >= 2 && !fBay.sticks.some((st) => st.role === "joist" && st.cy + st.sy / 2 > frontEdgeAt(bay.shape, st.cx) + 0.5));
const sOne = buildStructure(oneFront);
const fOne = sOne.frame!;
const cb = fOne.cornerBeams[0];
check("a 5-ft cut is past it: the front beam stops where the cut begins, and an angled beam runs under the cut", fOne.cornerBeams.length === 1 && !!cb && cb.x0 === 60 && Math.abs(cb.y1 - cb.y0) === Math.abs(cb.x1 - cb.x0) && fOne.beams[0].x0 === 60 && allInside(oneFront), JSON.stringify(cb));
check("…the two share ONE post where they meet, and the angled beam has a post of its own by the deck's side", fOne.posts.filter((q) => Math.abs(q.x - 60) < 0.6 && Math.abs(q.y - cb.y0) < 0.6).length === 1 && fOne.posts.some((q) => q.beamId === cb.id && Math.abs(q.x - cb.x1) < 0.6) && fOne.posts.find((q) => Math.abs(q.x - 60) < 0.6)!.beamId === fOne.beams[0].id);
check("…that shared post carries half of what the angled beam does, and is sized for it", fOne.posts.find((q) => Math.abs(q.x - 60) < 0.6)!.tributarySqFt > fOne.posts.find((q) => q.beamId === cb.id)!.tributarySqFt + 10);
const said = deckChecks(sOne).find((c) => c.id === "deck-corner-beams");
check("the checks say it; an id the auto-fix leaves alone", !!said && said.level === "pass" && /angled .* beam under the cut/.test(said.text) && !AUTO_FIX.test("deck-corner-beams"), said?.text);
const sProw = buildStructure(prow);
check("a point: no front beam left under it — two angled beams on one post at the point and one each by the sides", sProw.frame!.cornerBeams.length === 2 && sProw.frame!.cornerBeams.every((c) => c.hostBeamId === null) && sProw.frame!.posts.filter((q) => q.beamId.startsWith("c")).length === 3 && allInside(prow));
const oldClip = normalizeDeckDesign({ ...base, shape: { kind: "rect", widthFt: 24, depthFt: 16, front: { kind: "clipped", bulgeFt: 2, clipFt: 5 } } });
check("the rectangle with clipped corners gains by it: its beam and end posts stood outside the deck past the corners — they stand inside now", allInside(oldClip) && buildStructure(oldClip).frame!.cornerBeams.length === 2);
check("nothing fails on any of them", [bay, ends, prow, oneFront, oldClip].every((d) => fails(d).length === 0));
check("clicking the angled beam or its post in the 3D does not break the part's card", (() => { try { partCard(sOne, { kind: "deck-beam", id: cb.id }); partCard(sOne, { kind: "deck-post", id: fOne.posts.find((q) => q.beamId === cb.id)!.id }); return true; } catch { return false; } })());
const dbl = buildStructure(normalizeDeckDesign({ ...oneFront, heightIn: 126, lower: { ...d0.lower, on: true, place: "under", heightIn: 18 } }));
check("a double deck: the deck under it has its angled beam too, let into the same posts", !!dbl.lower && dbl.lower.frame.cornerBeams.length === 1 && dbl.lower.frame.posts.length === 0 && dbl.lower.frame.seats.some((q) => q.beamId === dbl.lower!.frame.cornerBeams[0].id));

const ringAreaOf = (r: number[]) => { let a = 0; for (let i = 0; i < r.length; i += 2) { const j = (i + 2) % r.length; a += r[i] * r[j + 1] - r[j] * r[i + 1]; } return Math.abs(a) / 2; };
const covered = (st: ReturnType<typeof buildStructure>) => (st.surface!.pieces.reduce((a, q) => a + q.sx * q.sy, 0) + st.surface!.shaped.reduce((a, r) => a + ringAreaOf(r), 0)) / 144;
const bordered2 = buildStructure(normalizeDeckDesign({ ...bay, decking: { ...bay.decking, border: 1, fascia: "match" } }));
const cuts = frontClips(bay.shape);
const inCut = (x: number, y: number) => cuts.some((k) => k.dir * (x - k.x) >= 0 && k.y - y >= 0 && k.dir * (x - k.x) + (k.y - y) < k.c - 1);
check("the boards stop along the cuts: none lies over a corner that is cut away, and they cover the deck once", !sBay.surface!.pieces.some((q) => inCut(q.cx, q.cy)) && covered(sBay) <= 339 + 0.5 && covered(sBay) > 339 * 0.93, `${covered(sBay).toFixed(1)} of 339`);
check("…with a border too: it runs along both cuts, mitred to its neighbours, and nothing is laid twice", bordered2.surface!.borderEdges.length === 9 && bordered2.surface!.borderEdges.filter((e) => Math.abs(Math.abs(e.x1 - e.x0) - Math.abs(e.y1 - e.y0)) < 0.01 && Math.abs(e.x1 - e.x0) > 1).length === 2 && covered(bordered2) <= 339 + 0.5 && covered(bordered2) > 339 * 0.93, `${bordered2.surface!.borderEdges.length} edges, ${covered(bordered2).toFixed(1)} of 339`);
check("fascia and rail run along the cuts", Math.abs(bordered2.surface!.fascia.lf - sBay.frame!.openEdgeFt) < 0.2 && sBay.rails.segments.some((g) => Math.abs(Math.abs(g.x1 - g.x0) - Math.abs(g.y1 - g.y0)) < 2 && Math.abs(g.x1 - g.x0) > 12));
let cutPages = 0;
let cutThrew = "";
try {
  cutPages = permitPages(sOne).length + permitSheets(sOne).length + tributaries(planModel(sOne)!).length;
} catch (e) {
  cutThrew = e instanceof Error ? e.message : String(e);
}
check("the permit set draws; the 3D has the angled beam; the price has it", cutPages > 6 && !cutThrew && deckScene(sOne).boxes.length > 100 && priceDeck(oneFront).subtotal > 0, cutThrew);
const trOne = tributaries(planModel(sOne)!);
check("the footing plan shades what the angled beam's posts carry: its own post's half, and the other half with the post it shares", trOne.length === fOne.posts.length && trOne.some((t) => (t.more ?? []).length === 1));
const v6 = say(tee, "clip the corners 3 feet");
check("\"clip the corners 3 feet\" on a deck in parts: every corner that stands out — the bay's two and the deck's two ends — the parts as they were", v6.design.shape.kind === "wall" && v6.design.shape.front!.length === 3 && frontClips(v6.design.shape).length === 4 && /cut at 45°/.test(v6.said), v6.said);

// (2026-11-14, found by the flicker check after main's ties change.) Where a front beam ends and the angled beam under
// a cut starts — one post under both — a joist there gets ONE tie, drawn and counted once.
{
  const base2 = normalizeDeckDesign({ ...d0, shape: { kind: "rect", widthFt: 24, depthFt: 14 }, heightIn: 48 });
  const prow = buildStructure(patchDesign(base2, { shape: shapeWithFront(base2.shape, [{ widthFt: 6, yFt: 10 }, { widthFt: 12, yFt: 16, clipLeftFt: 6, clipRightFt: 6 }, { widthFt: 6, yFt: 10 }]) })).frame!;
  const doubled = prow.tieAt.filter((a, i) => prow.tieAt.some((c, k) => k !== i && Math.abs(c.x - a.x) < 0.01 && Math.abs(c.y - a.y) < 4)).length;
  check("a joist where a front beam meets the angled beam under a cut gets one tie, counted once", prow.cornerBeams.length > 0 && doubled === 0 && prow.hardware.ties === prow.tieAt.reduce((a, t) => a + t.n, 0), `${doubled} doubled`);
}

console.log(bad ? `\n${bad} FAILED` : "\nALL PASS");
process.exit(bad ? 1 : 0);
