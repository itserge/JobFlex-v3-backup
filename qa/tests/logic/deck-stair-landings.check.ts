// STAIRS WITH LANDINGS, AND THE BRACES' SIZE (2026-11-14, lib/deck/stairs + design.stairs[].landings; framing.braceSize,
// roof.braceSize) — the owner: "add the stairs when it's too high, and you can split it with the landing. And turn the
// second part to the right or to the left, and make it like you can add more landings at any height to turn it
// somewhere, fully adjustable. Also with handrails, and posts if needed… multi-landing stairs." And: "braces — if it's a
// 6 by 6 brace, I can change it for 4 by 4. Or 8 by 8, if the post is 8 by 8."
// A stair was one straight run (the code's landing went in by itself above 12 ft 3 in.). It is now a chain: a flight, a
// landing on its own posts, a turn, a flight… Worked on a 16 x 12 ft deck 10 ft up, a 4-ft stair down the front at 8 ft:
// 16 risers of 7 3/8 in. in one flight; with a landing 5 ft up, two flights of 8.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/deck-stair-landings.check.ts
import { BRACE_SIZES, STAIR_LIMITS, braceSizeFor, braceSizesFor, defaultDeckDesign, defaultStair, normalizeDeckDesign, type DeckDesign, type StairTurnKind } from "../../../src/lib/deck/design";
import { buildStructure } from "../../../src/lib/deck/structure";
import { applyDeckPatch, deckChecks } from "../../../src/lib/deck/checks";
import { priceDeck } from "../../../src/lib/deck/pricing";
import { deckScene } from "../../../src/lib/deck/scene";
import { partCard, tryChoice } from "../../../src/lib/deck/parts";
import { AUTO_FIX } from "../../../src/lib/deck/settle";
import { parseUtterance } from "../../../src/lib/deck/voice/parse";
import { runCommand } from "../../../src/lib/deck/voice/run";
import { FLIGHT_MAX_RISE_IN, LANDING_DEPTH_IN, SWITCHBACK_GAP_IN, firstFlightOf, stairDirAfter, stairLegs, stairTurnWords, stairTurnsInOrder } from "../../../src/lib/deck/stairs";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};
const d0 = defaultDeckDesign({ state: "WA" });
const mk = (turns: Array<[number, StairTurnKind]>, over: Record<string, unknown> = {}, stair: Record<string, unknown> = {}): DeckDesign =>
  normalizeDeckDesign({ ...d0, shape: { kind: "rect", widthFt: 16, depthFt: 12 }, heightIn: 120, rail: { ...d0.rail, type: "aluminum" }, ...over, stairs: [{ ...defaultStair("s1", "front", 8), ...stair, landings: turns.map(([heightIn, turn], i) => ({ id: `t${i + 1}`, heightIn, turn })) }] });
const stairOf = (d: DeckDesign) => buildStructure(d).stairs[0];
const loud = (d: DeckDesign) => deckChecks(buildStructure(d)).filter((c) => /^stair-/.test(c.id) && (c.level === "fail" || c.level === "warn")).map((c) => `${c.level}:${c.id}`);
const found = (d: DeckDesign, id: string) => deckChecks(buildStructure(d)).find((c) => c.id === id);
const pts = (list: Array<{ x: number; y: number }>) => list.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(" ");
const count = (d: DeckDesign, role: string) => stairOf(d).members.filter((m) => m.role === role).length;

console.log("── one flight, as it always was");
const plain = mk([]);
const p0 = stairOf(plain);
check("no landing: one flight of 16 risers of 7 3/8 in., straight out from the deck's front", p0.flights.length === 1 && p0.landings.length === 0 && p0.risers === 16 && Math.abs(p0.riserIn - 7.38) < 0.01 && !p0.landing && pts(p0.footprint) === "72,144 120,144 120,338 72,338" && pts(p0.path) === "96,144 96,302", `${p0.risers} ${p0.riserIn} ${pts(p0.footprint)}`);
check("…its first flight is itself", firstFlightOf(p0) === p0);

console.log("── split with a landing");
const straight = mk([[60, "straight"]]);
const s1 = stairOf(straight);
check("a landing 5 ft up: two flights of 8 risers — 7 1/2 in. down to it, 7 1/4 in. on to the pad (a riser may differ either side of a landing, never inside a flight)", s1.flights.length === 2 && s1.flights[0].risers === 8 && s1.flights[0].riserIn === 7.5 && s1.flights[1].risers === 8 && s1.flights[1].riserIn === 7.25 && s1.risers === 16 && s1.riserIn === 7.5 && s1.treads === 14, JSON.stringify(s1.flights));
check("…the landing as wide as the stair and 36 in. the way you walk, its boards 5 ft up, on four posts and footings of its own", s1.landings.length === 1 && s1.landings[0].widthIn === 48 && s1.landings[0].depthIn === LANDING_DEPTH_IN && s1.landings[0].heightIn === 60 && s1.landings[0].posts === 4 && !s1.landings[0].auto && s1.landing && count(straight, "landing-tread") === 1 && count(straight, "landing-frame") >= 5, JSON.stringify(s1.landings));
check("…each flight on stringers of its own, hung on connectors: twice the stringers, and a footing under every post", s1.stringers.count === 2 * p0.stringers.count && s1.hardware.stringerConnectors === 2 * p0.hardware.stringerConnectors && s1.footings.length === count(straight, "stair-post") && s1.footings.length >= 4);
check("…straight on: the stair runs on past the landing in the same line", pts(s1.footprint) === "72,144 120,144 120,363 72,363" && s1.path.every((q) => Math.round(q.x) === 96), pts(s1.footprint));
check("the flight's treads end AT the landing — no gap of a tread between the last riser and its boards (there was one under the code's own landing)", (() => { const tr = s1.members.filter((m) => m.role === "tread"); const lastY = Math.max(...tr.filter((m) => m.cz > 60).map((m) => m.cy + m.sy / 2)); const ld = s1.members.find((m) => m.role === "landing-tread")!; return Math.abs(ld.cy - ld.sy / 2 - 217.5) < 0.01 && lastY <= 217.5 + 1.01 && lastY >= 217.5 - 0.01; })());

console.log("── …and turned");
const left = mk([[60, "left"]]);
const right = mk([[60, "right"]]);
const sl = stairOf(left);
const sr = stairOf(right);
check("a quarter turn: a square landing (4 ft by 4 ft), the second flight leaving by its side", sl.landings[0].widthIn === 48 && sl.landings[0].depthIn === 48 && sr.landings[0].depthIn === 48);
check("the walker's left, going down a front stair, is the RIGHT of the picture — so the turn is named as the deck is seen from the yard: one goes to the right, the other to the left", Math.max(...sl.footprint.map((q) => q.x)) > 200 && Math.min(...sr.footprint.map((q) => q.x)) < 0 && stairTurnWords("out", "left") === "Turn to the right" && stairTurnWords("out", "right") === "Turn to the left" && sl.landings[0].dir === "out", `${pts(sl.footprint)} | ${pts(sr.footprint)}`);
check("…its outline is one ring from the deck's edge round the flight, the landing and the second flight", pts(sl.footprint) === "72,144 120,144 120,218 230,218 230,266 72,266" && pts(sl.path) === "96,144 96,218 96,242 120,242 194,242", `${pts(sl.footprint)} | ${pts(sl.path)}`);
check("the turns are listed as a builder reads them: straight on, left before right (toward the house before away from it), then the switchbacks the same way", stairTurnsInOrder("out").map((t) => stairTurnWords("out", t)).join(" / ") === "Straight on / Turn to the left / Turn to the right / Back, on the left / Back, on the right" && stairTurnsInOrder("left").map((t) => stairTurnWords("left", t)).join(" / ") === "Straight on / Turn toward the house / Turn away from the house / Back, on the house side / Back, on the yard side", `${stairTurnsInOrder("out").map((t) => stairTurnWords("out", t)).join(" / ")} | ${stairTurnsInOrder("left").map((t) => stairTurnWords("left", t)).join(" / ")}`);
const back = mk([[60, "back-left"]]);
const sb = stairOf(back);
check("a switchback: the landing two flights and the 6-in. well between them wide, on six posts; the second flight comes back beside the first", sb.landings[0].widthIn === 2 * 48 + SWITCHBACK_GAP_IN && sb.landings[0].posts === 6 && Math.min(...sb.path.slice(-1).map((q) => q.y)) === 144 && stairTurnWords("out", "back-left") === "Back, on the right" && stairDirAfter("out", "back-left") === "in", `${JSON.stringify(sb.landings[0])} ${pts(sb.path)}`);
const two = mk([[80, "right"], [40, "right"]]);
const s2 = stairOf(two);
check("two landings, each turning the same way: three flights of 6 risers wrapping round, the stair ending back toward the house", s2.flights.length === 3 && s2.landings.length === 2 && s2.flights.every((f) => f.risers === 6) && s2.landings[0].dir === "out" && s2.landings[1].dir === "left" && s2.risers === 18 && loud(two).length === 0, `${JSON.stringify(s2.flights.map((f) => f.risers))} ${s2.landings.map((l) => l.dir).join()} ${loud(two).join()}`);
const side = mk([[60, "left"]], {}, { side: "left" });
const ss = stairOf(side);
check("a stair off the left side, turned: it runs out to the left, then away from the house — said so", ss.landings[0].dir === "left" && stairTurnWords("left", "left") === "Turn away from the house" && stairTurnWords("left", "right") === "Turn toward the house" && Math.max(...ss.footprint.map((q) => q.y)) > 200, pts(ss.footprint));
const five = mk([[100, "left"], [84, "right"], [66, "left"], [48, "right"], [30, "left"]]);
check("five landings at any heights: six flights, every riser inside the code's 7 3/4 in.", stairOf(five).flights.length === 6 && stairOf(five).landings.length === 5 && stairOf(five).flights.every((f) => f.riserIn <= 7.75 + 1e-6 && f.risers >= 2) && loud(five).length === 0, `${JSON.stringify(stairOf(five).flights.map((f) => [f.risers, f.riserIn]))} ${loud(five).join()}`);

console.log("── rails, handrails, posts");
check("the stair is guarded both sides: so is the landing — a post at each of its corners, a level rail along every edge no flight comes to or leaves by", count(left, "stair-rail-post") > count(plain, "stair-rail-post") && sl.members.filter((m) => m.role === "stair-rail" && Math.abs(m.tilt) < 1e-6).length === 4 && sl.rail.sides === 2 && sl.rail.posts === count(left, "stair-rail-post"), `${count(left, "stair-rail-post")} posts, ${sl.members.filter((m) => m.role === "stair-rail" && Math.abs(m.tilt) < 1e-6).length} level rails`);
check("…a switchback's landing has three open edges: six level rails", sb.members.filter((m) => m.role === "stair-rail" && Math.abs(m.tilt) < 1e-6).length === 6);
check("each flight's rail follows its own slope, down to the landing and on from it", new Set(sl.members.filter((m) => m.role === "stair-rail" && Math.abs(m.tilt) > 1e-6).map((m) => Math.round(m.yaw * 100))).size === 2);
check("the rail's length counts the landing's too: more rail than the plain stair's", sl.rail.lengthIn > p0.rail.lengthIn && sl.rail.balusters > p0.rail.balusters);
const noRail = mk([[60, "left"]], { rail: { ...d0.rail, type: "none" } });
check("no railing chosen: none on the landing either — and the handrail check still fails, as on any stair of four risers", count(noRail, "stair-rail") === 0 && loud(noRail).includes("fail:stair-s1-handrail"));
const lowDeck = mk([[16, "left"]], { heightIn: 30 });
check("a low stair (30 in.) with one handrail and a landing 16 in. up: the landing needs no guard, so it has none", stairOf(lowDeck).rail.sides === 1 && stairOf(lowDeck).members.filter((m) => m.role === "stair-rail" && Math.abs(m.tilt) < 1e-6).length === 0 && stairOf(lowDeck).landings.length === 1, JSON.stringify(stairOf(lowDeck).rail));
check("a landing's posts stand under its frame, in from the corners, each as tall as the landing is high", sl.members.filter((m) => m.role === "stair-post" && m.cz < 60).length >= 4 && sl.landings[0].aboveGroundIn === 60);

console.log("── the code's own landing, and what does not fit");
const tall = mk([], { heightIn: 192 });
const st = stairOf(tall);
check("16 ft up and no landing asked for: the code's landing goes in by itself, straight, halfway — no flight climbs past 12 ft 3 in.", st.landings.length === 1 && st.landings[0].auto && st.landings[0].turn === "straight" && st.flights.length === 2 && st.flights.every((f) => f.riseIn <= FLIGHT_MAX_RISE_IN) && Math.abs(st.flights[0].riseIn - st.flights[1].riseIn) < 0.01, JSON.stringify(st.flights));
const tallTurned = mk([[150, "left"]], { heightIn: 192 });
check("…with a landing of the builder's high up, the long flight under it still gets the code's", stairOf(tallTurned).landings.length === 2 && stairOf(tallTurned).landings.some((l) => l.auto) && stairOf(tallTurned).flights.every((f) => f.riseIn <= FLIGHT_MAX_RISE_IN + 1e-6));
const legs = stairLegs(120, 2, [{ id: "a", heightIn: 115, turn: "left" }, { id: "b", heightIn: 60, turn: "right" }, { id: "c", heightIn: 8, turn: "left" }]);
check("a landing stands a foot at least from the deck, the ground and the next landing: one 5 in. under the deck and one 6 in. off the pad are left out, the one between kept", legs.leftOut.join() === "a,c" && legs.legs.length === 2 && legs.legs[0].landing?.id === "b");
const tooNear = mk([[30, "left"]], { heightIn: 36 });
const out = found(tooNear, "stair-s1-landing-out-1");
check("…and that is said, with the way to take it off", stairOf(tooNear).landings.length === 0 && stairOf(tooNear).flags.landingsLeftOut.join() === "t1" && out?.level === "info" && applyDeckPatch(tooNear, out.fix!.patch).stairs[0].landings.length === 0, JSON.stringify(out));
const said = found(left, "stair-s1-landings");
check("the checks say what the way down came to: 2 flights and 1 landing, 5'-0\" up, 4'-0\" × 4'-0\" on 4 posts, then turn to the right", said?.level === "pass" && /2 flights and 1 landing: 5'-0" up, 4'-0" × 4'-0" on 4 posts, then turn to the right/.test(said.text), said?.text);

console.log("── where it must not go");
const intoHouse = mk([[60, "right"]], { house: { ...d0.house, leftFt: 12 } }, { side: "left", atFt: 3 });
check("a side stair turned toward the house, where the house's wall runs 12 ft past the deck: it runs into the wall — a fail", stairOf(intoHouse).flags.hitsHouse && found(intoHouse, "stair-s1-house")?.level === "fail", pts(stairOf(intoHouse).footprint));
const pastHouse = mk([[60, "right"]], { house: { ...d0.house, leftFt: 0 } }, { side: "left", atFt: 3 });
check("…where the house's wall ends at the deck's corner, the same stair passes beside it: no fail", !stairOf(pastHouse).flags.hitsHouse && !found(pastHouse, "stair-s1-house"));
const under = mk([[96, "back-left"], [60, "straight"]], { heightIn: 150, shape: { kind: "rect", widthFt: 16, depthFt: 16 } });
const hu = found(under, "stair-s1-headroom");
check("a switchback that comes back under the deck: the room over its treads to the deck's joists is measured — under 6 ft 8 in. a warning", stairOf(under).flags.underDeckClearIn !== null && (hu?.level === "warn") === (stairOf(under).flags.underDeckClearIn! < 80), `${stairOf(under).flags.underDeckClearIn} ${hu?.level}`);
check("these checks are the builder's: the studio's auto-fix never touches them", ["stair-s1-landings", "stair-s1-landing-out-1", "stair-s1-house", "stair-s1-headroom"].every((id) => !AUTO_FIX.test(id)));

console.log("── counted, priced, drawn");
const pp = priceDeck(plain);
const pl = priceDeck(left);
check("the price carries the landing: its frame and posts in the lumber, its footings' concrete, the labour of framing it", pl.subtotal > pp.subtotal + 300 && pl.bom.some((b) => /landing posts/.test(b.label)) && pl.bom.some((b) => /landing frame/.test(b.label)) && pl.bom.some((b) => b.id === "stair-footing-concrete"), `${Math.round(pp.subtotal)} → ${Math.round(pl.subtotal)}`);
check("…and says it: \"a landing and a turn midway\"", pl.lines.some((l) => /a landing and a turn midway/.test(l.description ?? "")) && priceDeck(two).lines.some((l) => /2 landings on the way down, turning/.test(l.description ?? "")));
const sc = deckScene(buildStructure(left));
check("the 3D draws every flight and the landing", sc.boxes.length > deckScene(buildStructure(plain)).boxes.length && sc.legend.some((l) => /landing/.test(l.role)));
const ff = firstFlightOf(sl);
check("for a drawing of one flight (the permit set's section, the stringer's layout): the first flight, down to the landing — 8 risers of 7 1/2 in., no pad", ff.risers === 8 && ff.riserIn === 7.5 && ff.pad === null && ff !== sl);

console.log("── the stair knows the lower deck and the lower level");
const dbl = mk([[72, "left"]], { heightIn: 126, lower: { ...d0.lower, on: true, place: "under", heightIn: 18 } });
check("on a double deck the upper deck's stair takes landings like any other", stairOf(dbl).landings.length === 1 && stairOf(dbl).lands === "ground" && loud(dbl).filter((x) => /landing|house/.test(x)).length === 0);
const boxed = normalizeDeckDesign({ ...d0, shape: { kind: "rect", widthFt: 16, depthFt: 12 }, heightIn: 20, stairs: [{ ...defaultStair("s1", "front", 8), wrap: true, landings: [{ id: "a", heightIn: 10, turn: "left" }] }] });
check("box steps wrapping the deck take no landing", boxed.stairs[0].landings.length === 0 && stairOf(boxed).kind === "box");

console.log("── by voice");
const cmds = (text: string, d: DeckDesign = plain) => JSON.stringify(parseUtterance(text, { design: d, subject: null }).clauses.flatMap((c) => c.cmds));
check("\"add a landing to the stairs\", \"split the stairs with a landing 5 feet up\", \"turn the stairs to the left\", \"make the stairs a switchback\", \"take the landing out\"", /"turn":"add"/.test(cmds("add a landing to the stairs")) && /"turn":"add","turnAtIn":60/.test(cmds("split the stairs with a landing 5 feet up")) && /"turn":"left"/.test(cmds("turn the stairs to the left")) && /"turn":"back"/.test(cmds("make the stairs a switchback")) && /"turn":"remove"/.test(cmds("take the landing out of the stairs", left)), [cmds("add a landing to the stairs"), cmds("split the stairs with a landing 5 feet up"), cmds("turn the stairs to the left"), cmds("make the stairs a switchback"), cmds("take the landing out of the stairs", left)].join(" | "));
check("…a stair onto a \"concrete landing\" is still the pad at its foot, and \"stairs on the left side\" still moves them", !/"turn"/.test(cmds("put the stairs onto a concrete pad")) && !/"turn"/.test(cmds("move the stairs to the left side")), `${cmds("put the stairs onto a concrete pad")} | ${cmds("move the stairs to the left side")}`);
const v1 = runCommand(plain, { do: "stairs", op: "change", turn: "add" });
const b1 = buildStructure(v1.design).stairs[0];
check("\"add a landing\" on the plain stair: one in the middle of its climb, turned toward the open yard, and it says so", b1.landings.length === 1 && Math.abs(b1.landings[0].heightIn - 61) <= 2 && b1.landings[0].turn !== "straight" && /A landing — .* up, then turn to the (left|right)\. 2 flights, 16 risers/.test(v1.said.join(" ")), `${JSON.stringify(v1.design.stairs[0].landings)} ${v1.said.join(" ")}`);
const v2 = runCommand(v1.design, { do: "stairs", op: "change", turn: "left" });
const b2 = buildStructure(v2.design).stairs[0];
check("then \"turn the stairs to the left\": the same landing, and the flight below it runs to the LEFT of the picture", b2.landings.length === 1 && stairDirAfter(b2.landings[0].dir, b2.landings[0].turn) === "left" && Math.min(...b2.footprint.map((q) => q.x)) < 0 && /turn to the left/.test(v2.said.join(" ")), `${pts(b2.footprint)} ${v2.said.join(" ")}`);
const v3 = runCommand(v2.design, { do: "stairs", op: "change", turn: "back", turnAtIn: 90 });
check("\"a switchback 7 ft 6 up\": a second landing there, the stairs coming back beside themselves", buildStructure(v3.design).stairs[0].landings.length === 2 && buildStructure(v3.design).stairs[0].landings[0].heightIn === 90 && /^back-/.test(buildStructure(v3.design).stairs[0].landings[0].turn));
const v4 = runCommand(v3.design, { do: "stairs", op: "change", turn: "remove" });
check("\"take the landings out\": one straight flight again", v4.design.stairs[0].landings.length === 0 && buildStructure(v4.design).stairs[0].flights.length === 1 && /one straight flight/.test(v4.said.join(" ")));

console.log("── kept, and junk is not");
const kept = normalizeDeckDesign(JSON.parse(JSON.stringify(two)));
check("kept through a save: each landing's height and turn, highest first", JSON.stringify(kept.stairs[0].landings) === JSON.stringify([{ id: "t1", heightIn: 80, turn: "right" }, { id: "t2", heightIn: 40, turn: "right" }]));
const junk = normalizeDeckDesign({ ...plain, stairs: [{ ...plain.stairs[0], landings: [null, 5, { heightIn: "x" }, { id: "a", heightIn: 60, turn: "sideways" }, { id: "a", heightIn: 90 }, { heightIn: 66 }, { heightIn: 9999, turn: "left" }, ...new Array(20).fill(0).map((_, k) => ({ heightIn: 100 + k * 14, turn: "right" }))] }] });
check("junk is not kept: no height, no landing; an unknown turn is straight on; no two with one id or within a foot of each other; no more than a stair takes; the height inside its limits", junk.stairs[0].landings.length === STAIR_LIMITS.landings && junk.stairs[0].landings.every((l) => l.heightIn <= STAIR_LIMITS.landingHeightIn.max) && junk.stairs[0].landings.find((l) => l.id === "a")?.turn === "straight" && new Set(junk.stairs[0].landings.map((l) => l.id)).size === STAIR_LIMITS.landings, JSON.stringify(junk.stairs[0].landings));
const old = JSON.parse(JSON.stringify(plain));
delete old.stairs[0].landings;
check("a design saved before this has no landings, and its stair is the stair it was", normalizeDeckDesign(old).stairs[0].landings.length === 0 && JSON.stringify(stairOf(normalizeDeckDesign(old)).members) === JSON.stringify(p0.members));

console.log("── the braces' timber");
const braced = (framing: Record<string, unknown>, roof: Record<string, unknown> = {}) => normalizeDeckDesign({ ...d0, shape: { kind: "rect", widthFt: 16, depthFt: 12 }, heightIn: 96, structure: "covered-deck", framing: { ...d0.framing, ...framing }, roof: { ...d0.roof, kind: "gable", attach: "wall", ...roof } });
const deckBraces = (d: DeckDesign) => [...new Set(buildStructure(d).frame!.sticks.filter((x) => x.role === "brace").map((x) => x.nominal))].join();
const roofBraces = (d: DeckDesign) => [...new Set(buildStructure(d).roof!.members.filter((m) => m.role === "roof-brace").map((m) => `${m.nominal}:${m.sy}x${m.sz}`))].join();
const auto = braced({ post: "6x6" }, { post: "6x6" });
check("left alone they are what they always were: 2x4 under the deck, 4x4 under the roof", deckBraces(auto) === "2x4" && roofBraces(auto) === "4x4:3.5x3.5" && auto.framing.braceSize === "auto" && auto.roof.braceSize === "auto");
const six = braced({ post: "6x6", braceSize: "6x6" }, { post: "6x6", braceSize: "6x6" });
check("6x6 on 6x6 posts: both the deck's and the roof's braces are 6x6, drawn 5 1/2 in. square", deckBraces(six) === "6x6" && roofBraces(six) === "6x6:5.5x5.5" && buildStructure(six).frame!.sticks.filter((x) => x.role === "brace").every((x) => Math.min(x.sx, x.sy) === 5.5));
check("…changed for 4x4", deckBraces(braced({ post: "6x6", braceSize: "4x4" })) === "4x4");
const eight = braced({ post: "8x8", braceSize: "8x8" }, { post: "8x8", braceSize: "8x8" });
check("8x8 where the post is 8x8", deckBraces(eight) === "8x8" && roofBraces(eight) === "8x8:7.5x7.5");
check("never larger than the post: 8x8 asked on a 6x6 post is 6x6; 6x6 asked on a 4x4 post is 4x4", deckBraces(braced({ post: "6x6", braceSize: "8x8" }, { post: "6x6", braceSize: "8x8" })) === "6x6" && roofBraces(braced({ post: "6x6" }, { post: "6x6", braceSize: "8x8" })) === "6x6:5.5x5.5" && deckBraces(braced({ post: "4x4", braceSize: "6x6" })) === "4x4" && braceSizeFor("8x8", "6x6", "2x4") === "6x6" && braceSizesFor("8x8").join() === BRACE_SIZES.join() && braceSizesFor("6x6", "4x4").join() === "4x4,6x6");
check("a roof's brace is never the deck's 2x4: asked, it stays 4x4", roofBraces(braced({}, { post: "6x6", braceSize: "2x4" })) === "4x4:3.5x3.5");
check("the heavier timber is in the material list and the price", priceDeck(six).bom.some((b) => /6x6 .*knee braces/.test(b.label)) && priceDeck(six).subtotal > priceDeck(auto).subtotal && !priceDeck(auto).bom.some((b) => /6x6 .*knee braces/.test(b.label)));
const sB = buildStructure(auto);
const braceKey = sB.frame!.sticks.find((x) => x.role === "brace")!.of!;
const bc = partCard(sB, { kind: "deck-brace", id: braceKey });
check("click a brace in the 3D: a row of sizes — Auto, 2x4, 4x4, 6x6 on a 6x6 post — and one tap changes every deck brace", ["brace-size-auto", "brace-size-2x4", "brace-size-4x4", "brace-size-6x6"].every((id) => bc.choices.some((c) => c.id === id)) && !bc.choices.some((c) => c.id === "brace-size-8x8") && deckBraces(tryChoice(auto, bc.choices.find((c) => c.id === "brace-size-6x6")!).design) === "6x6", bc.choices.map((c) => c.id).join());
const rb = partCard(sB, { kind: "roof-brace", id: sB.roof!.members.find((m) => m.role === "roof-brace")!.of! });
check("…and a roof brace: Auto, 4x4, 6x6", ["rbrace-size-auto", "rbrace-size-4x4", "rbrace-size-6x6"].every((id) => rb.choices.some((c) => c.id === id)) && roofBraces(tryChoice(auto, rb.choices.find((c) => c.id === "rbrace-size-6x6")!).design) === "6x6:5.5x5.5" && /A 4x4 at 45°/.test(rb.does));
check("junk is not kept: an unknown size is auto", normalizeDeckDesign({ ...auto, framing: { ...auto.framing, braceSize: "10x10" }, roof: { ...auto.roof, braceSize: 7 } }).framing.braceSize === "auto" && normalizeDeckDesign({ ...auto, roof: { ...auto.roof, braceSize: 7 } }).roof.braceSize === "auto");

console.log(bad ? `\n${bad} FAILED` : "\nALL PASS");
if (bad) process.exit(1);
