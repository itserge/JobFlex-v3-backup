// STEPS THAT WRAP THE DECK ALONG ITS OWN OUTLINE (2026-11-14; lib/deck/stairs, the box branch with level.sides) — the
// owner, of a picture of wide steps running round a deck's angled edges: "the steps could be all around the deck."
// Box steps went round the rectangle the deck fits in — right for a rectangle only. On any other deck they now follow
// its edges: the front (every part of it, the corners cut at an angle, the sides of a bay), the front and the deck's two
// ends, or every open edge. Each level is the outline set out one more run; where two edges meet the level turns the
// corner with them, its tread boards mitred there. A plain rectangle's are as they always were.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/deck-steps-around.check.ts
import { defaultDeckDesign, defaultStair, normalizeDeckDesign, shapeOutline, shapeWithFront, type DeckDesign } from "../../../src/lib/deck/design";
import { setDeckPast } from "../../../src/lib/deck/house";
import { buildStructure } from "../../../src/lib/deck/structure";
import { deckChecks } from "../../../src/lib/deck/checks";
import { patchDesign } from "../../../src/lib/deck/edit";
import { priceDeck } from "../../../src/lib/deck/pricing";
import { deckScene } from "../../../src/lib/deck/scene";
import { permitPages, permitSheets } from "../../../src/lib/deck/permit";
import { parseUtterance } from "../../../src/lib/deck/voice/parse";
import { runCommand } from "../../../src/lib/deck/voice/run";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};
const d0 = defaultDeckDesign({ state: "WA" });
const mk = (over: Record<string, unknown> = {}): DeckDesign => normalizeDeckDesign({ ...d0, shape: { kind: "rect", widthFt: 24, depthFt: 12 }, heightIn: 21, rail: { ...d0.rail, type: "none" }, ...over });
const base = mk();
const steps = (sides: 1 | 3 | 4) => [{ ...defaultStair("s1", "front", 12), wrap: true, wrapSides: sides }];
type Cut = { widthFt: number; yFt: number; clipLeftFt?: number; clipRightFt?: number };
const parts = (d: DeckDesign, list: Cut[]) => patchDesign(d, { shape: shapeWithFront(d.shape, list) });
const withSteps = (d: DeckDesign, sides: 1 | 3 | 4, over: Record<string, unknown> = {}) => normalizeDeckDesign({ ...d, ...over, stairs: steps(sides) });
const inRing = (ring: Array<{ x: number; y: number }>, x: number, y: number) => {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
};
const mid = (ring: number[]) => ({ x: (ring[0] + ring[2] + ring[4] + ring[6]) / 4, y: (ring[1] + ring[3] + ring[5] + ring[7]) / 4 });
const fails = (d: DeckDesign) => deckChecks(buildStructure(d)).filter((c) => c.level === "fail").map((c) => c.id);

console.log("── a plain rectangle: as it always was");
const plain = buildStructure(withSteps(base, 3)).stairs[0];
check("box steps round a rectangle are boxes round the rectangle — no rings, no named edges", plain.kind === "box" && plain.treadRings === undefined && plain.wrapped === undefined && plain.members.some((m) => m.role === "box-tread"));

console.log("── along the front of a bay with its corners cut");
const bay = parts(base, [{ widthFt: 7, yFt: 12 }, { widthFt: 10, yFt: 18, clipLeftFt: 3, clipRightFt: 3 }, { widthFt: 7, yFt: 12 }]);
const front = withSteps(bay, 1);
const sF = buildStructure(front);
const st = sF.stairs[0];
const out = shapeOutline(front.shape);
check("the steps run along the whole front: the two side parts, the sides of the bay, its two cuts and its front — seven stretches of edge", st.kind === "box" && st.wrapped!.length === 7 && st.risers === 3 && st.treads === 2);
check("…not along the deck's two ends, nor the house", !st.wrapped!.some((g) => (Math.abs(g.x0) < 0.5 && Math.abs(g.x1) < 0.5) || (Math.abs(g.x0 - 288) < 0.5 && Math.abs(g.x1 - 288) < 0.5) || (Math.abs(g.y0) < 0.5 && Math.abs(g.y1) < 0.5)));
check("every tread board lies outside the deck, beside the edge it follows — and lower than the deck", st.treadRings!.length > 20 && st.treadRings!.every((t) => !inRing(out, mid(t.ring).x, mid(t.ring).y) && t.z < sF.frame!.surfaceIn - 5));
check("two levels: the lower one a run farther out than the upper", new Set(st.treadRings!.map((t) => t.z)).size === 2);
check("what the steps cover follows the deck's shape: out along the bay's cut at 45°, square at the deck's two ends", st.footprint.some((q) => Math.abs(q.x - 288) < 0.5 && Math.abs(q.y - 165) < 0.5) && st.footprint.some((q) => Math.abs(q.x) < 0.5 && Math.abs(q.y - 165) < 0.5) && st.footprint.some((q) => q.y > 230), JSON.stringify(st.footprint.map((q) => [Math.round(q.x), Math.round(q.y)])));
const cornerAt = (x: number, y: number) => st.treadRings!.filter((t) => [0, 2, 4, 6].some((i) => Math.abs(t.ring[i] - x) < 0.6 && Math.abs(t.ring[i + 1] - y) < 0.6)).length;
// (Where the right side part's front meets the bay's side — an INSIDE corner at (204, 144) — the level's corner is a run
// out along both: (204 + 10.5, 144 + 10.5); the board along each of the two edges ends in that one point.)
check("where two edges meet the boards are mitred: the one along each edge ends in the same point, a run out along both", cornerAt(204 + 10.5, 144 + 10.5) === 2, `${cornerAt(204 + 10.5, 144 + 10.5)}`);
check("a riser board on every level's outer face, along every stretch", st.members.filter((m) => m.role === "riser").length === 14 && st.members.filter((m) => m.role === "riser" && Math.abs(Math.abs(Math.tan(m.yaw)) - 1) < 0.01).length === 4);
check("the lengths are counted: treads, risers, frames, blocks under the lowest level", st.treadBoardLf > 60 && st.riserBoardLf > 40 && st.boxFrameLf > 100 && st.boxBlocks > 8 && st.gravelSqFt > 20);
const railed = buildStructure(withSteps(bay, 1, { heightIn: 21, rail: { ...d0.rail, type: "aluminum" } }));
check("a rail asked for stands on the deck's two ends only — the edges the steps run along are open", railed.rails.segments.length === 2 && railed.rails.segments.every((g) => Math.abs(g.x0 - g.x1) < 9), JSON.stringify(railed.rails.segments.map((g) => [Math.round(g.x0), Math.round(g.y0), Math.round(g.x1), Math.round(g.y1)])));
check("nothing fails", fails(front).length === 0);

console.log("── the front and both ends; all the way round");
const three = buildStructure(withSteps(bay, 3)).stairs[0];
check("front and both ends: the two ends as well, back to the house wall — nine stretches", three.wrapped!.length === 9 && three.footprint.some((q) => Math.abs(q.x - -21) < 0.5 && Math.abs(q.y) < 0.5) && three.footprint.some((q) => Math.abs(q.x - 309) < 0.5 && Math.abs(q.y) < 0.5));
const ell = buildStructure(withSteps(mk({ shape: { kind: "L", widthFt: 24, depthFt: 16, notch: { corner: "front-right", widthFt: 10, depthFt: 6 } } }), 3)).stairs[0];
check("an L: the steps turn its inside corner too — the two levels meet there, their risers clear of each other", ell.kind === "box" && ell.wrapped!.length === 5 && ell.footprint.some((q) => Math.abs(q.x - 189) < 0.5 && Math.abs(q.y - 141) < 0.5) && fails(withSteps(mk({ shape: { kind: "L", widthFt: 24, depthFt: 16, notch: { corner: "front-right", widthFt: 10, depthFt: 6 } } }), 3)).length === 0);
const free = withSteps(parts(base, [{ widthFt: 24, yFt: 14, clipLeftFt: 4, clipRightFt: 4 }]), 4, { placement: "detached" });
const sFree = buildStructure(free).stairs[0];
check("a deck that stands free, its front corners cut: all the way round is one closed run — the lowest level's outer line is the deck's outline set out two runs", sFree.wrapped!.length === 6 && sFree.footprint.length === 6 && shapeOutline(free.shape).every((q) => inRing(sFree.footprint, q.x + (q.x < 144 ? 1 : -1), q.y + (q.y < 80 ? 1 : -1))), JSON.stringify(sFree.footprint.map((q) => [Math.round(q.x), Math.round(q.y)])));
check("…on a deck against the house, \"all round\" is not offered: held to the front and both ends", normalizeDeckDesign({ ...bay, stairs: steps(4) }).stairs[0].wrapSides === 1 || normalizeDeckDesign({ ...bay, stairs: steps(4) }).stairs[0].wrapSides === 3);
const r = setDeckPast(base.house, base.shape, "right", 8, 10, { minWidthFt: 4, maxWidthFt: 60 });
const round = withSteps(patchDesign(base, { house: r.house, shape: r.shape }), 4);
const sRound = buildStructure(round).stairs[0];
check("…unless the deck runs past the house's corner: its open back edge takes the steps too", round.stairs[0].wrapSides === 4 && sRound.wrapped!.some((g) => Math.abs(g.y0 - -120) < 0.5 && Math.abs(g.y1 - -120) < 0.5) && !sRound.wrapped!.some((g) => Math.abs(g.x0 - 288) < 0.5 && Math.abs(g.x1 - 288) < 0.5 && Math.min(g.y0, g.y1) < -1));

console.log("── the rest");
console.log("── past three risers: wide steps on stringers");
const w36 = withSteps(base, 3, { heightIn: 36, rail: { ...d0.rail, type: "aluminum" } });
const sW = buildStructure(w36);
const ws = sW.stairs[0];
check("a plain rectangle 36 in. up, the front and both ends: five risers, the steps on cut stringers — no box frames, no blocks", ws.kind === "box" && !!ws.wide && ws.risers === 5 && ws.treads === 4 && ws.boxFrameLf === 0 && ws.boxBlocks === 0 && !ws.members.some((m) => m.role === "box-frame"));
check("stringers square to every edge at the treads' spacing, and one along the mitre at each of the two corners", ws.stringers.count > 40 && ws.wide!.hips === 2 && ws.members.filter((m) => m.role === "stringer").length === ws.stringers.count && ws.hardware.stringerConnectors === ws.stringers.count && ws.stringers.spacingIn <= 16);
check("their feet on a treated sleeper along the lowest step, over gravel", ws.wide!.sleeperLf > 50 && ws.members.filter((m) => m.role === "kicker").length === 3 && ws.gravelSqFt > 50);
check("the treads and risers are the same as on low steps: mitred boards at four heights", new Set(ws.treadRings!.map((t) => t.z)).size === 4 && ws.members.filter((m) => m.role === "riser").length === 12);
check("four risers or more: a handrail down the steps where the stair is set — two posts on the treads, the rail between them", ws.rail.sides === 1 && ws.rail.posts === 2 && ws.rail.handrailOnly && ws.members.filter((m) => m.role === "stair-rail-post").length === 2 && ws.members.filter((m) => m.role === "stair-rail").length === 1);
const saidW = deckChecks(sW);
check("the checks say how they stand, and the handrail", saidW.some((c) => c.id === "stair-s1-wide" && c.level === "pass" && /stand on stringers, not boxes/.test(c.text)) && saidW.some((c) => c.id === "stair-s1-handrail" && c.level === "pass") && fails(w36).length === 0);
check("the deck's edges the steps run along need no guard: nothing else is asked for", !saidW.some((c) => c.level === "warn" || c.level === "fail"), saidW.filter((c) => c.level === "warn" || c.level === "fail").map((c) => c.id).join(","));
const noRail = deckChecks(buildStructure(withSteps(base, 3, { heightIn: 36 })));
check("with no railing chosen the handrail is asked for, with the fix", noRail.some((c) => c.id === "stair-s1-handrail" && c.level === "fail" && !!c.fix));
const ends = deckChecks(buildStructure(withSteps(base, 1, { heightIn: 44, rail: { ...d0.rail, type: "aluminum" } })));
check("along the front only on a deck 44 in. up: the steps' two ends are open and high — said, with the way round it", ends.some((c) => c.id === "stair-s1-ends" && c.level === "warn" && !!c.fix));
check("…not said where the steps go round the ends too, nor on a deck 30 in. up", !saidW.some((c) => c.id === "stair-s1-ends") && !deckChecks(buildStructure(withSteps(base, 1, { heightIn: 30, rail: { ...d0.rail, type: "aluminum" } }))).some((c) => c.id === "stair-s1-ends"));
const bayTall = buildStructure(withSteps(bay, 3, { heightIn: 36, rail: { ...d0.rail, type: "aluminum" } })).stairs[0];
check("round a bay with cut corners: a stringer along every corner's mitre — outside and inside", !!bayTall.wide && bayTall.wide.hips === 8 && bayTall.stringers.count > 50);
check("the price has the stringers and the steps in it", priceDeck(w36).subtotal > priceDeck(normalizeDeckDesign({ ...base, heightIn: 36, rail: { ...d0.rail, type: "aluminum" } })).subtotal + 2000);
const tall = buildStructure(withSteps(bay, 1, { heightIn: 60 }));
check("seven risers at most: on a 60-in. deck they are framed as a flight and the checks say why", tall.stairs[0].kind === "flight" && tall.stairs[0].flags.tooTallForBox && tall.stairs[0].treadRings === undefined && deckChecks(tall).some((c) => c.id === "stair-s1-box" && /seven|7 risers at most/.test(c.text)));
check("three risers or fewer on a plain rectangle are the boxes they always were", buildStructure(withSteps(base, 3)).stairs[0].wide === undefined);
const lit = buildStructure(withSteps(bay, 1, { rail: { ...d0.rail, type: "aluminum", lighting: "post-caps-risers" } })).stairs[0];
check("riser lights: one at least on every stretch of every level", lit.hardware.riserLights >= 14);
check("the price has the steps in it", priceDeck(front).subtotal > priceDeck(bay).subtotal + 500);
const sc = deckScene(sF);
check("the 3D draws the treads as cut boards at their own heights", !!sc.diagonal && (sc.diagonal.zs ?? []).filter((z) => z < sF.frame!.surfaceIn / 12 - 0.4).length === st.treadRings!.length);
let pages = 0;
let threw = "";
try {
  pages = permitPages(sF).length + permitSheets(sF).length;
} catch (e) {
  threw = e instanceof Error ? e.message : String(e);
}
check("the permit set draws", pages > 4 && !threw, threw);
const say = (d: DeckDesign, text: string) => {
  let o = d;
  for (const cmd of parseUtterance(text, { design: d } as never).clauses.flatMap((c) => c.cmds)) o = runCommand(o, cmd).design;
  return o;
};
const v = say(bay, "wrap-around steps on the front");
check("\"wrap-around steps on the front\" on a low deck in parts: steps along its front, following it", v.stairs.some((x) => x.wrap) && !!buildStructure(v).stairs.find((x) => x.kind === "box")?.treadRings?.length);

console.log(bad ? `\n${bad} FAILED` : "\nALL PASS");
process.exit(bad ? 1 : 0);
