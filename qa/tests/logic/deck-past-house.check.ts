// THE DECK PAST A CORNER OF THE HOUSE (2026-11-14; lib/deck/house deckPast / setDeckPast / fitDeckEnds, design's
// BackPart.open, frame's ledger-or-beam per part) — the owner: "if I want to go back past the house, on the sides, then
// make option to go past the house and the deck can extend to the right and to the left outside the house wall."
// A deck always hung on a wall as wide as itself. Now the house may END inside the deck's width (house.leftFt /
// rightFt below zero): the deck runs on past the corner, and — a wrap-around deck — back along the house's side wall
// (house.wrapLeftFt / wrapRightFt). No wall stands behind that part, so it has no ledger: a beam and posts of its own
// carry its back, and its edges are open ones — railed, bordered, with fascia — except the one beside the side wall.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/deck-past-house.check.ts
import { BACK_LIMITS, DECK_LIMITS, defaultDeckDesign, defaultStair, normalizeBack, normalizeDeckDesign, shapeAreaSqFt, shapeEdges, shapeOutline, shapeZones, sizeWords, type DeckDesign, type DeckShape } from "../../../src/lib/deck/design";
import { HOUSE_LIMITS, deckPast, deckShapeForHouse, defaultHouse, fitDeckEnds, houseHandles, houseScene, normalizeHouse, pastWords, resizeDeckLeft, setDeckPast, slideDeck, wallWords, type HouseDesign } from "../../../src/lib/deck/house";
import { buildStructure } from "../../../src/lib/deck/structure";
import { applyDeckPatch, deckChecks } from "../../../src/lib/deck/checks";
import { patchDesign } from "../../../src/lib/deck/edit";
import { priceDeck, deckScope } from "../../../src/lib/deck/pricing";
import { deckScene } from "../../../src/lib/deck/scene";
import { AUTO_FIX, settleDesign } from "../../../src/lib/deck/settle";
import { deckGrips, moveGrip } from "../../../src/lib/deck/byHand";
import { planModel } from "../../../src/lib/deck/plans/model";
import { permitPages, permitSheets, sectionPost } from "../../../src/lib/deck/permit";
import { tributaries } from "../../../src/lib/deck/plans/foundation";
import { parseUtterance } from "../../../src/lib/deck/voice/parse";
import { runCommand } from "../../../src/lib/deck/voice/run";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};
const d0 = defaultDeckDesign({ state: "WA" });
const LIM = { minWidthFt: DECK_LIMITS.widthFt.min, maxWidthFt: DECK_LIMITS.widthFt.max };
const rect = (w: number, d: number): DeckShape => ({ kind: "rect", widthFt: w, depthFt: d });
const mk = (over: Record<string, unknown> = {}): DeckDesign => normalizeDeckDesign({ ...d0, shape: rect(20, 12), heightIn: 48, rail: { ...d0.rail, type: "aluminum" }, ...over });
/** The deck run past a corner, as the studio does it. */
const past = (d: DeckDesign, side: "left" | "right", p: number, w = 0): DeckDesign => {
  const r = setDeckPast(d.house, d.shape, side, p, w, LIM);
  return patchDesign(d, { house: r.house, shape: r.shape });
};
const loud = (d: DeckDesign) => deckChecks(buildStructure(d)).filter((c) => c.level === "fail").map((c) => c.id);
const base = mk();
const H = (over: Partial<HouseDesign> = {}): HouseDesign => ({ ...defaultHouse(), ...over });

console.log("── the house read back: a corner inside the deck's width");
check("the limits are the design's own: 2 ft is the least part of a deck to frame, 24 ft the most back along a side", HOUSE_LIMITS.pastFt.min === BACK_LIMITS.partFt && HOUSE_LIMITS.wrapFt.max === BACK_LIMITS.wrapFt);
check("a reach below zero is the deck running past the corner: −6 stays −6", normalizeHouse(H({ rightFt: -6 }), rect(20, 12)).rightFt === -6);
check("…a foot and a half inside the deck's end is the deck ending AT the corner; 2 ft is past it", normalizeHouse(H({ rightFt: -1.5 }), rect(20, 12)).rightFt === 0 && normalizeHouse(H({ leftFt: -2 }), rect(20, 12)).leftFt === -2);
check("…30 ft past at the most", normalizeHouse(H({ rightFt: -45 }), rect(60, 12)).rightFt === -30);
const squeezed = normalizeHouse(H({ leftFt: -14, rightFt: -14 }), rect(20, 12));
check("…and the two ends leave the wall 4 ft of the deck", -squeezed.leftFt - squeezed.rightFt === 16 && squeezed.leftFt === -14, JSON.stringify([squeezed.leftFt, squeezed.rightFt]));
const wraps = normalizeHouse({ ...H({ leftFt: 4, rightFt: -6 }), wrapLeftFt: 9, wrapRightFt: 10.2 }, rect(20, 12));
check("how far back along the side is kept only where the deck is past that corner, to the half foot", wraps.wrapLeftFt === undefined && wraps.wrapRightFt === 10, JSON.stringify(wraps));
check("…24 ft at the most, and never deeper than a deck goes (40 ft in all)", normalizeHouse({ ...H({ rightFt: -6 }), wrapRightFt: 99 }, rect(20, 12)).wrapRightFt === 24 && normalizeHouse({ ...H({ rightFt: -6 }), wrapRightFt: 99 }, rect(20, 30)).wrapRightFt === 10);
check("a house with the wall behind the whole deck reads back exactly as it always did", JSON.stringify(normalizeHouse(H(), rect(20, 12))) === JSON.stringify(H()));

console.log("── the deck's shape: the part past the corner is an open one");
const fitR = deckShapeForHouse(rect(30, 12), H({ rightFt: -6 }));
check("6 ft past the right corner: the deck is two parts — 24 ft on the wall, 6 ft past it", fitR.shape.kind === "wall" && JSON.stringify(fitR.shape.back) === JSON.stringify([{ x0Ft: 0, x1Ft: 24, yFt: 0 }, { x0Ft: 24, x1Ft: 30, yFt: 0, open: true }]) && fitR.note === null, JSON.stringify(fitR));
const fitW = deckShapeForHouse(rect(30, 12), { ...H({ rightFt: -6 }), wrapRightFt: 10 });
check("…and 10 ft back along the side: that part starts 10 ft behind the house line", fitW.shape.kind === "wall" && fitW.shape.back[1].yFt === -10 && fitW.shape.back[1].open === true);
const zW = shapeZones(fitW.shape);
check("its rectangles: the walled one from the house line, the open one from 10 ft behind it", zW.length === 2 && !zW[0].open && zW[0].y0 === 0 && zW[1].open === true && zW[1].y0 === -120 && zW[1].x0 === 288 && zW[1].x1 === 360);
const eW = shapeEdges(fitW.shape, "attached");
const edgeAt = (x0: number, y0: number, x1: number, y1: number) => eW.find((e) => e.x0 === x0 && e.y0 === y0 && e.x1 === x1 && e.y1 === y1);
check("the wall's back is the house's; the open part's back is an open edge", edgeAt(0, 0, 288, 0)?.house === true && edgeAt(288, -120, 360, -120)?.house === false && edgeAt(288, -120, 360, -120)?.side === "back");
check("the face beside the house's SIDE wall is the house's — no rail, no fascia there", edgeAt(288, -120, 288, 0)?.house === true);
check("the outer side runs the whole way back: 22 ft of open edge", edgeAt(360, -120, 360, 144)?.house === false && edgeAt(360, -120, 360, 144)?.lengthIn === 264);
check("the outline goes round the corner", JSON.stringify(shapeOutline(fitW.shape)) === JSON.stringify([{ x: 0, y: 0 }, { x: 288, y: 0 }, { x: 288, y: -120 }, { x: 360, y: -120 }, { x: 360, y: 144 }, { x: 0, y: 144 }]));
check("the area counts the part beside the house: 30 × 12 + 6 × 10", shapeAreaSqFt(fitW.shape) === 420);
const setBack = deckShapeForHouse(rect(30, 12), { ...H({ rightFt: -6 }), jogs: [{ id: "j1", atFt: 16, dir: "away", depthFt: 4 }] });
check("a wall set back 4 ft before the corner, the deck straight past it: that set-back's end face is open air, not the house", setBack.shape.kind === "wall" && shapeEdges(setBack.shape, "attached").some((e) => e.x0 === 288 && e.y0 === -48 && e.y1 === 0 && e.house === false), JSON.stringify(setBack.shape));
check("a part marked open in the middle of the deck is a walled one; a deck with no wall behind any of it is no wall deck", normalizeBack([{ x0Ft: 0, x1Ft: 6, yFt: 0 }, { x0Ft: 6, x1Ft: 12, yFt: -3, open: true }, { x0Ft: 12, x1Ft: 20, yFt: 0 }], 20, 12)!.every((b) => !b.open) && normalizeBack([{ x0Ft: 0, x1Ft: 10, yFt: -4, open: true }, { x0Ft: 10, x1Ft: 20, yFt: 0, open: true }], 20, 12) === null);
check("an open part never stands in FRONT of the house line, and goes back 24 ft at most", normalizeBack([{ x0Ft: 0, x1Ft: 14, yFt: 0 }, { x0Ft: 14, x1Ft: 20, yFt: 5, open: true }], 20, 12)![1].yFt === 0 && normalizeBack([{ x0Ft: 0, x1Ft: 14, yFt: 0 }, { x0Ft: 14, x1Ft: 20, yFt: -99, open: true }], 20, 12)![1].yFt === -24);
check("in words", sizeWords(past(base, "right", 6)) === "30 ft × 12 ft running past the house's corner" && sizeWords(past(base, "right", 6, 10)) === "30 ft × 12 ft wrapping round the house", sizeWords(past(base, "right", 6, 10)));

console.log("── the two always agree: never a ledger in the air");
const forced = normalizeDeckDesign({ ...base, shape: rect(30, 12), house: { ...base.house, rightFt: -6 } });
check("a rectangle saved with the house's corner inside it reads back with that part open", forced.shape.kind === "wall" && forced.shape.back[1].open === true);
const bowed = normalizeDeckDesign({ ...base, shape: { kind: "rect", widthFt: 30, depthFt: 12, front: { kind: "curve", bulgeFt: 2, clipFt: 2 } }, house: { ...base.house, rightFt: -6 } });
check("…a bowed front too: past a corner the deck takes a straight front, and the note says so", bowed.shape.kind === "wall" && /straight front/.test(deckShapeForHouse({ kind: "rect", widthFt: 30, depthFt: 12, front: { kind: "curve", bulgeFt: 2, clipFt: 2 } }, bowed.house).note ?? ""));
const regrown = applyDeckPatch(forced, { house: { rightFt: 3 } });
check("the wall grown back behind the deck: the part hangs on it again — a rectangle", regrown.shape.kind === "rect" && regrown.shape.widthFt === 30);
check("the read-back is stable", JSON.stringify(normalizeDeckDesign(JSON.parse(JSON.stringify(forced)))) === JSON.stringify(forced));
const r0 = rect(20, 12);
check("a design with the wall behind all of it is not touched by any of this", fitDeckEnds(r0, H()) === r0 && JSON.stringify(mk().shape) === JSON.stringify(r0));

console.log("── running the deck past a corner: the house stays, the deck's end moves");
const r6 = setDeckPast(base.house, base.shape, "right", 6, 0, LIM);
check("6 ft past the right corner of a 20-ft deck with 4 ft of wall beyond it: the deck is 30 ft", r6.shape.widthFt === 30 && r6.house.rightFt === -6 && r6.house.leftFt === 4);
const stepped = mk({ house: { ...d0.house, jogs: [{ id: "j1", atFt: 30, dir: "toward", depthFt: 2 }], rightFt: 14 } });
const l6 = setDeckPast({ ...stepped.house, openings: [{ id: "o1", kind: "window", xFt: 5, widthFt: 3, heightFt: 4, sillFt: 3 }] }, stepped.shape, "left", 6, 8, LIM);
check("past the LEFT corner the deck grows to its left: what is measured from that end — the wall's steps, the windows — shifts with it", l6.shape.widthFt === 30 && l6.house.leftFt === -6 && l6.house.wrapLeftFt === 8 && l6.house.jogs[0].atFt === 40 && l6.house.openings![0].xFt === 15, JSON.stringify(l6.house));
check("\"not past\" said of an end that is not past changes nothing — the deck is not stretched to the corner", setDeckPast(base.house, base.shape, "right", 0, 0, LIM).shape === base.shape);
const back0 = setDeckPast(r6.house, r6.shape, "right", 0, 0, LIM);
check("…said of an end that is past, the deck comes back to the corner", back0.shape.widthFt === 24 && back0.house.rightFt === 0);
check("under 2 ft is asked up to 2 ft", setDeckPast(base.house, base.shape, "right", 1, 0, LIM).house.rightFt === -2);
const wide = mk({ shape: rect(58, 12) });
check("a deck is 60 ft at the widest: the rest is not taken", setDeckPast(wide.house, wide.shape, "right", 10, 0, LIM).shape.widthFt === 60);
check("slid along the wall, an end past its corner goes farther past or comes back; one on the wall stays on it", slideDeck(r6.house, 2).rightFt === -8 && slideDeck(r6.house, -99).leftFt === 0);
check("the left end pulled in: the deck's reach past that corner shrinks by as much", resizeDeckLeft(l6.house, l6.shape, 28, 4, 60).house.leftFt === -4);

console.log("── the frame: a ledger where there is wall, a beam and posts where there is none");
const wrap = past(base, "right", 8, 10);
const sW = buildStructure(wrap);
const f = sW.frame!;
const zOpen = f.zones.find((z) => z.zone.open)!;
const zWall = f.zones.find((z) => !z.zone.open)!;
check("the walled part hangs on a ledger, the part past the corner on a beam of its own", zWall.back === "ledger" && zOpen.back === "beam" && f.zones.length === 2);
check("the ledger stops at the house's corner", f.ledgers.length === 1 && f.ledgers[0].x0 === 0 && f.ledgers[0].x1 === 288);
const backBeam = f.beams.find((b) => b.role === "back")!;
check("the back beam stands under the open part only, in from its back edge, on posts of its own", !!backBeam && backBeam.x0 === 288 && backBeam.x1 === 384 && backBeam.y > -120 && backBeam.y < -90 && f.posts.filter((p) => p.beamId === backBeam.id).length >= 2);
const frontBeam = f.beams.find((b) => b.role === "front")!;
check("the front beam is ONE beam under both parts", frontBeam.x0 === 0 && frontBeam.x1 === 384 && f.beams.filter((b) => b.role === "front").length === 1);
check("a part 22 ft front to back takes a beam between: every joist span inside the table", zOpen.beamYs.length === 3 && f.zones.every((z) => z.ok) && !f.flags.joistBeyondTable && f.flags.beamBeyondTable.length === 0);
check("joist hangers only where the joists hang on the ledger", f.hardware.hangers + f.hardware.doubleHangers === f.joists.filter((j) => !j.sister && j.zoneId === zWall.zone.id).length, `${f.hardware.hangers} + ${f.hardware.doubleHangers}`);
check("a rim closes the open part's back", f.sticks.some((s) => s.role === "rim" && Math.abs(s.cy - -120) < 3 && s.cx > 288));
check("no stick of the deck stands inside the house (x under the corner, behind the house line)", !f.sticks.some((s) => s.cx + s.sx / 2 < 288 - 0.5 && s.cy + s.sy / 2 < -1), JSON.stringify(f.sticks.find((s) => s.cx + s.sx / 2 < 288 - 0.5 && s.cy + s.sy / 2 < -1)));
check("74 ft of open edge, 34 ft against the house", f.openEdgeFt === 74 && f.houseEdgeFt === 34);
const beside = buildStructure(normalizeDeckDesign({ ...wrap, placement: "beside" })).frame!;
check("beside the house (on its own posts) nothing hangs on the wall at all — and the edges are the same", beside.ledgers.length === 0 && beside.zones.every((z) => z.back === "beam") && beside.openEdgeFt === 74);
check("nothing fails", loud(wrap).length === 0 && loud(past(past(base, "right", 8, 12), "left", 6, 8)).length === 0, loud(wrap).join(","));

console.log("── what is said, and what the frame's own fixes leave alone");
const said = deckChecks(sW).find((c) => c.id === "deck-past-house");
check("the checks say it where the builder looks", !!said && said.level === "pass" && /8 ft past the house's right corner and 10 ft back along its side/.test(said.text) && /beam and posts of their own/.test(said.text) && /ledger stops at the corner/.test(said.text), said?.text);
check("…an id the auto-fix does not touch", !AUTO_FIX.test("deck-past-house"));
check("a plain deck says nothing of it", !deckChecks(buildStructure(base)).some((c) => c.id === "deck-past-house"));
const settled = settleDesign(wrap).design;
check("settling the frame keeps the deck where it was put", JSON.stringify(settled.shape) === JSON.stringify(wrap.shape) && settled.house.rightFt === -8 && settled.house.wrapRightFt === 10);
check("the wall, in a line", wallWords(wrap.shape, wrap.house) === "The deck runs 8 ft past the house's right corner and 10 ft back along its side. There it stands on its own beam and posts — no ledger." && pastWords(deckPast(base.house)) === "");

console.log("── rails, boards, fascia: the open edges all round");
check("the rail runs along the open back and the outer side, never beside the house's side wall", sW.rails.segments.some((g) => Math.abs(g.y0 - -120) < 9 && Math.abs(g.y1 - -120) < 9) && !sW.rails.segments.some((g) => Math.abs(g.x0 - 288) < 9 && Math.abs(g.x1 - 288) < 9 && Math.min(g.y0, g.y1) < -12), JSON.stringify(sW.rails.segments.slice(0, 2)));
check("…74 ft of guard, as the open edge", Math.abs(sW.rails.lf - 74) < 4, `${sW.rails.lf}`);
// A lower level in front of a deck past the corner (2026-11-14): it was handed the main deck's reach past the corner
// and read back with a wing of its own — built back under the main deck, and counted in the price.
const withLower = (d: DeckDesign) => normalizeDeckDesign({ ...d, heightIn: 60, lower: { ...d0.lower, on: true, place: "front", widthFt: 12, depthFt: 8, dropIn: 21 } });
const lowWing = buildStructure(withLower(past(base, "right", 6, 8)));
const lowPlain = buildStructure(withLower(base));
check("a lower level in front of a deck round the corner is its own plain rectangle: 12 × 8 ft, nothing under the main deck", !!lowWing.lower && lowWing.lower.frame.zones.length === 1 && lowWing.lower.frame.areaSqFt === 96 && lowWing.lower.frame.zones[0].zone.y0 === 0 && lowWing.lower.frame.areaSqFt === lowPlain.lower!.frame.areaSqFt && lowWing.lower.frame.posts.length === lowPlain.lower!.frame.posts.length, JSON.stringify(lowWing.lower?.frame.zones.map((z) => [z.zone.x0, z.zone.y0, z.zone.x1, z.zone.y1])));
check("…railed on its three open edges only", lowWing.rails.segments.filter((g) => g.level === "lower").every((g) => Math.min(g.y0, g.y1) >= lowWing.lower!.offsetYIn - 1));
// Straight past the corner, no wing (2026-11-14): the back is ONE line — the house behind most of it, nothing behind
// the last 6 ft. Read by its middle it was all "house" and that stretch had no guard on a deck 4 ft up.
const sStraight = buildStructure(past(base, "right", 6));
check("straight past the corner with no wing: the open back stretch past the house is railed too", sStraight.rails.segments.some((g) => Math.abs(g.y0) < 9 && Math.abs(g.y1) < 9 && Math.min(g.x0, g.x1) > 288 - 9 && Math.max(g.x0, g.x1) > 360 - 9) && !sStraight.rails.segments.some((g) => Math.abs(g.y0) < 9 && Math.abs(g.y1) < 9 && Math.min(g.x0, g.x1) < 288 - 9), JSON.stringify(sStraight.rails.segments.map((g) => [Math.round(g.x0), Math.round(g.y0), Math.round(g.x1), Math.round(g.y1)])));
check("…its guard as long as its open edge: 12 + 30 + 12 + 6 ft", Math.abs(sStraight.rails.lf - 60) < 3 && Math.abs(sStraight.surface!.fascia.lf - 60) < 0.6 || sStraight.surface!.fascia.lf === 0, `${sStraight.rails.lf}`);
const bordered = buildStructure(normalizeDeckDesign({ ...wrap, decking: { ...wrap.decking, border: 1, fascia: "match" } }));
check("a picture-frame border runs along the open back too, not along the house", bordered.surface!.borderEdges.some((e) => Math.abs(e.y0 - -120) < 0.5 && Math.abs(e.y1 - -120) < 0.5) && !bordered.surface!.borderEdges.some((e) => Math.abs(e.x0 - 288) < 0.5 && Math.abs(e.x1 - 288) < 0.5) && !bordered.surface!.borderEdges.some((e) => Math.abs(e.y0) < 0.5 && Math.abs(e.y1) < 0.5));
check("…and fascia covers every open edge", bordered.surface!.fascia.lf === 74);
check("boards cover the part beside the house", sW.surface!.pieces.some((p) => p.cy < -60 && p.cx > 288) && !sW.surface!.pieces.some((p) => p.cy < -6 && p.cx - p.sx / 2 < 288 - 1));

console.log("── a roof, a second deck, stairs");
const covered = buildStructure(normalizeDeckDesign({ ...wrap, structure: "covered-deck", roof: { ...d0.roof, kind: "shed", attach: "wall" } }));
const ring = covered.roof ? covered.roof.ring.map((p) => p.x) : [];
check("a roof hung on the house keeps to the part with wall behind it", !!covered.roof && Math.max(...ring) <= 288 + 0.5 && Math.min(...ring) >= -0.5, JSON.stringify(ring.map((x) => Math.round(x))));
const dbl = buildStructure(normalizeDeckDesign({ ...wrap, heightIn: 126, lower: { ...d0.lower, on: true, place: "under", heightIn: 18 } }));
check("a double deck: the deck under it goes round the corner too, on the same lines", !!dbl.lower && dbl.lower.frame.zones.length === 2 && dbl.lower.frame.zones.some((z) => z.zone.open && z.back === "beam") && dbl.lower.frame.ledgers.every((l) => l.x1 <= 288.5));
const stair = buildStructure(normalizeDeckDesign({ ...wrap, stairs: [defaultStair("s1", "right", 6), defaultStair("s2", "front", 6)] }));
check("stairs leave by the outer side and the front as on any deck", stair.stairs.length === 2 && stair.stairs.every((s) => s.footprint.length >= 4) && stair.stairs[0].footprint.some((q) => q.x > 384 + 12));

console.log("── the drawings and the price");
const m = planModel(sW)!;
check("the plans know where the house ends: its corner at 24 ft, 10 ft of side wall beside the deck", m.houseEnds.x0 === null && m.houseEnds.x1 === 288 && m.houseEnds.wrapRightIn === 120 && planModel(buildStructure(base))!.houseEnds.x1 === null);
let pages = 0;
let threw = "";
try {
  pages = permitPages(sW).length + permitSheets(sW).length;
} catch (e) {
  threw = e instanceof Error ? e.message : String(e);
}
check("the permit set draws", pages > 4 && !threw, threw);
const tribs = tributaries(m);
const carried = (list: typeof tribs) => list.reduce((a, t) => a + [t.pts, ...(t.more ?? [])].reduce((q, r) => q + Math.abs((r[2].x - r[0].x) * (r[2].y - r[0].y)), 0), 0) / 144;
check("the footing plan shades what every post carries — the part past the corner and the part on the wall", tribs.length === sW.frame!.posts.length && tribs.every((t) => t.pts.length >= 3) && carried(tribs) > 300, `${tribs.length} of ${sW.frame!.posts.length}, ${Math.round(carried(tribs))} sq ft`);
const ell = buildStructure(mk({ shape: { kind: "L", widthFt: 24, depthFt: 16, notch: { corner: "front-right", widthFt: 10, depthFt: 6 } } }));
const tL = tributaries(planModel(ell)!);
check("…and an L-shaped deck's too: its posts' strips add up to the half of the deck the beams carry (they were cut away where the outline turns in)", tL.length === ell.frame!.posts.length && carried(tL) > 0.5 * ell.frame!.areaSqFt, `${Math.round(carried(tL))} of ${ell.frame!.areaSqFt} sq ft`);
const leftWrap = buildStructure(past(base, "left", 6, 8));
const sp = sectionPost(leftWrap.frame!)!;
check("the building section is cut through the part on the wall, not the part past the corner", sp.x > 72 && !leftWrap.frame!.zones.some((z) => z.zone.open && sp.x >= z.zone.x0 && sp.x <= z.zone.x1) && sectionPost(buildStructure(base).frame!)!.x < 30);
const sc = deckScene(sW);
const hs = houseScene(wrap.shape, wrap.house, { deckHeightFt: 4, peakFt: 0, mainEdge: null });
check("the 3D's house ends at its corner, 8 ft inside the deck's end", Math.max(...hs.blocks.map((b) => b[2])) === 24 && sc.boxes.length > deckScene(buildStructure(base)).boxes.length);
const knob = houseHandles(wrap.shape, wrap.house, 4).find((h) => h.kind === "house-right")!;
check("…its corner's knob stands there", knob.x === 24 && knob.value === 24);
const pkg = priceDeck(wrap);
const plain = priceDeck(mk({ shape: rect(32, 12) }));
check("the price has the bigger deck in it: more boards, more posts, less ledger than a 32-ft deck on the wall", pkg.subtotal > plain.subtotal && pkg.areaSqFt === 464 && sW.frame!.posts.length > plain.structure.frame!.posts.length && sW.frame!.ledgers[0].lengthIn < plain.structure.frame!.ledgers[0].lengthIn);
check("the scope says it", deckScope(pkg).some((n) => /wrapping round the house/.test(n)), deckScope(pkg)[0]);

console.log("── by hand, the plain shapes, and by voice");
const grips = deckGrips(sW);
const gBack = grips.find((g) => g.kind === "post" && g.beamId === backBeam.id);
check("the posts under the part's own beam are taken hold of like any others", !!gBack && !gBack.fixed);
const movedPatch = gBack ? moveGrip(sW, "post", gBack.id, gBack.at + 6) : null;
const moved = movedPatch ? settleDesign(applyDeckPatch(wrap, movedPatch)).design : wrap;
check("…and moved 6 in.: the deck is still round the corner", !!movedPatch && moved.house.rightFt === -8 && buildStructure(moved).frame!.posts.some((p) => Math.abs(p.x - (gBack!.at + 6)) < 0.6));
const picked = patchDesign(wrap, { shape: rect(wrap.shape.widthFt, 12) });
check("a plain rectangle picked: the wall is behind the whole deck again", picked.shape.kind === "rect" && picked.house.rightFt === 0 && picked.house.wrapRightFt === undefined && buildStructure(picked).frame!.ledgers[0].x1 === 384);
const pickedL = patchDesign(wrap, { shape: { kind: "L", widthFt: 32, depthFt: 12, notch: { corner: "front-right", widthFt: 8, depthFt: 6 } } });
check("…an L too", pickedL.shape.kind === "L" && pickedL.house.rightFt === 0);
const wider = patchDesign(wrap, { shape: { ...wrap.shape, widthFt: 36 } });
check("the deck made wider keeps running 8 ft past the corner, 10 ft back", wider.shape.kind === "wall" && wider.shape.widthFt === 36 && wider.house.rightFt === -8 && wider.shape.back[1].x0Ft === 28 && wider.shape.back[1].yFt === -10);
const say = (d: DeckDesign, text: string) => {
  let out = d;
  const heard: string[] = [];
  for (const cmd of parseUtterance(text, { design: d } as never).clauses.flatMap((c) => c.cmds)) {
    const r = runCommand(out, cmd);
    out = r.design;
    heard.push(...r.said);
  }
  return { design: out, said: heard.join(" ") };
};
const v1 = say(base, "run the deck 6 feet past the house on the right");
check("\"run the deck 6 feet past the house on the right\"", v1.design.house.rightFt === -6 && v1.design.shape.widthFt === 30 && /6 ft past the house's right corner/.test(v1.said), v1.said);
const v2 = say(v1.design, "wrap it around the right side of the house 10 feet");
check("\"wrap it around the right side of the house 10 feet\"", v2.design.house.wrapRightFt === 10 && v2.design.house.rightFt === -6 && /10 ft back along its side/.test(v2.said), v2.said);
const v3 = say(base, "make it wrap around the house");
check("\"make it wrap around the house\": the right corner, 6 ft past and 8 ft back — and the other choices said", v3.design.house.rightFt === -6 && v3.design.house.wrapRightFt === 8 && /on the left/.test(v3.said), v3.said);
const v4 = say(base, "the deck goes 4 feet beyond the house wall on both sides");
check("\"…4 feet beyond the house wall on both sides\"", v4.design.house.leftFt === -4 && v4.design.house.rightFt === -4 && v4.design.shape.widthFt === 36);
const v5 = say(v2.design, "stop the deck at the corner");
check("\"stop the deck at the corner\"", v5.design.house.rightFt === 0 && v5.design.shape.kind === "rect" && /stops at the house's corner again/.test(v5.said), v5.said);
check("\"the house runs 6 feet past the deck on the left\" is still the wall's own reach", say(base, "the house runs 6 feet past the deck on the left").design.house.leftFt === 6);
check("\"wrap-around steps on the front\" are still steps", say(mk({ heightIn: 14 }), "wrap-around steps on the front").design.house.rightFt === 4);

console.log(bad ? `\n${bad} FAILED` : "\nALL PASS");
process.exit(bad ? 1 : 0);
