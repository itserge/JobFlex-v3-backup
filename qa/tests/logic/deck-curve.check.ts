// THE BOW BY HAND, AND STAIRS THAT MEET IT (2026-11-15; lib/deck/curve, lib/deck/edgeSeat) — the owner, of a deck with a
// bowed front: "I click on the radius — make me a toggle to move out and move in, to make a bigger radius or a smaller
// radius… And if the stairs attach to the radius deck, make sure they attach right, because right now there is a gap on
// the radius because the stairs are thinking it's attaching to the flat. Make it a smart check."
// Worked on a 16 x 12 ft deck bowed 2 ft (a 17-ft radius), a 4-ft stair 2½ ft from the left end: its head stood 10 in.
// off the deck at one corner and 7 in. under it at the other. It is now turned 19° to the curve, its head on the edge.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/deck-curve.check.ts
import { defaultDeckDesign, defaultStair, frontEdgeAt, normalizeDeckDesign, shapeAreaSqFt, shapeBows, shapeOutline, sideBowAt, sizeWords, type DeckDesign, type DeckShape } from "../../../src/lib/deck/design";
import { buildStructure } from "../../../src/lib/deck/structure";
import { applyDeckPatch, deckChecks } from "../../../src/lib/deck/checks";
import { deckScene } from "../../../src/lib/deck/scene";
import { partCard } from "../../../src/lib/deck/parts";
import { deckTakeoff } from "../../../src/lib/deck/takeoff";
import { BOW_STEP_FT, bowApex, bowLimits, bowOf, bowPatch, bowRadiusFt, bowRadiusWords, bowSidesFor, bowedSides, bowedWords, bowsLine, frontChain, sideChain, toggleBow, withBow } from "../../../src/lib/deck/curve";
import { ringWinding } from "../../../src/lib/deck/ringEdges";
import { priceDeck } from "../../../src/lib/deck/pricing";
import { SEAT_GAP_MAX_IN, chainOf, seatOnEdge } from "../../../src/lib/deck/edgeSeat";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};
const d0 = defaultDeckDesign({ state: "WA" });
const bowed = (bulgeFt: number, widthFt = 16): DeckShape => ({ kind: "rect", widthFt, depthFt: 12, front: { kind: "curve", bulgeFt, clipFt: 2 } });
const mk = (shape: DeckShape, stairs: Array<Record<string, unknown>> = [], over: Record<string, unknown> = {}): DeckDesign => normalizeDeckDesign({ ...d0, shape, heightIn: 40, rail: { ...d0.rail, type: "aluminum" }, ...over, stairs });
const stair = (at: number, over: Record<string, unknown> = {}) => ({ ...defaultStair("s1", "front", at), ...over });
const pts = (list: Array<{ x: number; y: number }>) => list.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(" ");
/** How far a point stands outside the deck's outline (positive) or inside it (negative), in. — against the nearest front piece. */
const offEdge = (shape: DeckShape, p: { x: number; y: number }) => {
  const chain = frontChain(shape);
  let best = Infinity;
  let signed = 0;
  for (let i = 0; i + 1 < chain.length; i++) {
    const a = chain[i];
    const b = chain[i + 1];
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    if (L < 0.01) continue;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (L * L)));
    const q = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    // (The chain runs left to right, the deck behind it: the yard is on its left hand.)
    const side = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (d < best) {
      best = d;
      signed = side >= 0 ? d : -d;
    }
  }
  return signed;
};

console.log("── the seat, by itself");
const line = [{ x: 0, y: 144 }, { x: 192, y: 144 }];
check("a straight edge: no seat — the old set-out, to the inch", seatOnEdge(line, 96, 48, { x: 1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }) === null);
const cut = [{ x: 0, y: 84 }, { x: 60, y: 144 }, { x: 132, y: 144 }, { x: 192, y: 84 }];
const onCut = seatOnEdge(cut, 30, 36, { x: 1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 });
check("on a corner cut at 45°: turned 45°, flat on the cut — no gap", !!onCut && Math.abs(onCut.turnDeg - 45) < 0.01 && onCut.gapIn === 0 && onCut.fills.length === 0, JSON.stringify(onCut));
check("…its way down runs square to the cut, out of the deck", !!onCut && Math.abs(onCut.nrm.x + Math.SQRT1_2) < 1e-6 && Math.abs(onCut.nrm.y - Math.SQRT1_2) < 1e-6);
const stepped = [{ x: 0, y: 144 }, { x: 96, y: 144 }, { x: 96, y: 192 }, { x: 192, y: 192 }];
check("an edge that steps under the stair (two parts of a front): no seat", seatOnEdge(stepped, 96, 48, { x: 1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }) === null);
check("…a stair that stops AT the step is read on its own part", seatOnEdge(stepped, 120, 48, { x: 1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }) === null);
check("off the end of the edge: no seat", seatOnEdge(cut, 10, 36, { x: 1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }) === null);
check("chainOf picks the longest unbroken run of a ring", pts(chainOf([{ x: 0, y: 0 }, { x: 9, y: 0 }, { x: 9, y: 5 }, { x: 4, y: 7 }, { x: 0, y: 5 }], (p) => p.y > 1)) === "9,5 4,7 0,5");

console.log("── a stair on a bowed front");
const shape = bowed(2);
check("the front as a run of points: nine of them, corner to corner, on the arc", frontChain(shape).length === 9 && pts([frontChain(shape)[0], frontChain(shape)[8]]) === "0,144 192,144" && Math.abs(frontChain(shape)[4].y - 168) < 0.01);
for (const at of [2.5, 4, 8, 11, 13.5]) {
  const d = mk(shape, [stair(at)]);
  const s = buildStructure(d);
  const st = s.stairs[0];
  const [a, b] = st.footprint;
  const head = [0, 0.25, 0.5, 0.75, 1].map((k) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }));
  const offs = head.map((p) => offEdge(shape, p));
  check(`at ${at} ft: the head is 4 ft wide, never under the deck, never more than 2 in. off it`, Math.abs(Math.hypot(b.x - a.x, b.y - a.y) - 48) < 0.01 && Math.min(...offs) > -0.02 && Math.max(...offs) < 2, `${offs.map((v) => v.toFixed(2)).join(" ")}`);
  check(`…and touches it`, Math.min(...offs.map(Math.abs)) < 0.5 || (st.seat?.gapIn ?? 9) < 2, `${offs.map((v) => v.toFixed(2)).join(" ")}`);
}
const left = buildStructure(mk(shape, [stair(2.5)])).stairs[0];
const mid = buildStructure(mk(shape, [stair(8)])).stairs[0];
const right = buildStructure(mk(shape, [stair(13.5)])).stairs[0];
check("near the left end it is turned 19° toward that end; in the middle it is square; near the right end, 19° the other way", Math.abs((left.seat?.turnDeg ?? 0) - 19.11) < 0.05 && mid.seat?.turnDeg === 0 && Math.abs((right.seat?.turnDeg ?? 0) + 19.11) < 0.05, `${left.seat?.turnDeg} ${mid.seat?.turnDeg} ${right.seat?.turnDeg}`);
check("the stair still climbs what it climbed: 6 risers, 5 treads", left.risers === mid.risers && left.treads === mid.treads && left.risers > 3);
check("where the bow bends away behind the head the deck's boards run straight across it: flat rings at the deck's height", !!left.treadRings?.length && left.treadRings.every((t) => t.z === buildStructure(mk(shape, [stair(2.5)])).frame!.surfaceIn && t.ring.length >= 6) && (left.seat?.gapIn ?? 0) > 1 && (left.seat?.gapIn ?? 9) < 2 && left.seat?.headerIn === 48, JSON.stringify(left.seat));
check("…and a riser board closes each open end of that gap", left.members.filter((m) => m.role === "riser" && m.lengthIn < 6).length >= 1);
const plain = buildStructure(mk({ kind: "rect", widthFt: 16, depthFt: 12 }, [stair(8)])).stairs[0];
check("a straight front: the stair exactly as it was — no seat, no rings", pts(plain.footprint) === "72,144 120,144 120,233 72,233" && !plain.seat && !plain.treadRings, pts(plain.footprint));
const clipped: DeckShape = { kind: "rect", widthFt: 16, depthFt: 12, front: { kind: "clipped", bulgeFt: 2, clipFt: 5 } };
const onClip = buildStructure(mk(clipped, [stair(2.5, { widthFt: 3 })])).stairs[0];
check("on a clipped corner: turned 45°, flat on the cut — no header", Math.abs((onClip.seat?.turnDeg ?? 0) - 45) < 0.01 && onClip.seat?.gapIn === 0 && onClip.seat?.headerIn === 0 && !onClip.treadRings, JSON.stringify(onClip.seat));
check("…between the clips, on the straight front: as it was", !buildStructure(mk(clipped, [stair(8)])).stairs[0].seat);

console.log("── the rail, the checks, the list");
const withStair = buildStructure(mk(shape, [stair(2.5)]));
const noStair = buildStructure(mk(shape));
check("the deck's rail opens for the turned stair: 4 ft less of it", Math.abs(noStair.rails.lf - withStair.rails.lf - 4) < 1, `${noStair.rails.lf} ${withStair.rails.lf}`);
const seatCheck = deckChecks(withStair).find((c) => c.id === "stair-s1-seat");
check("the checks say how it stands: turned 19°, its head against the edge, a header blocked off the bent rim", seatCheck?.level === "pass" && /turned 19°/.test(seatCheck.text) && /header/.test(seatCheck.text), seatCheck?.text);
check("nothing about the stair fails or warns", deckChecks(withStair).filter((c) => /^stair-/.test(c.id) && (c.level === "fail" || c.level === "warn")).length === 0);
check("the list carries the header", deckTakeoff(withStair).lines.some((l) => /straight header at the head of the stairs/.test(l.label)));
check("…and none on a straight front", !deckTakeoff(buildStructure(mk({ kind: "rect", widthFt: 16, depthFt: 12 }, [stair(8)]))).lines.some((l) => /straight header/.test(l.label)));
const tight = mk(bowed(5.25), [stair(8, { widthFt: 12 })]);
const tightS = buildStructure(tight);
const tightCheck = deckChecks(tightS).find((c) => c.id === "stair-s1-seat");
check(`a 12-ft stair on a tight bow: the edge bends more than ${SEAT_GAP_MAX_IN} in. away behind it — a warning, and a fix that narrows it`, tightCheck?.level === "warn" && !!tightCheck.fix && (tightS.stairs[0].seat?.gapIn ?? 0) > SEAT_GAP_MAX_IN, `${tightS.stairs[0].seat?.gapIn} ${tightCheck?.level}`);
const fixed = tightCheck?.fix ? buildStructure(applyDeckPatch(tight, tightCheck.fix.patch)) : null;
check("…the fix leaves no warning", !!fixed && deckChecks(fixed).find((c) => c.id === "stair-s1-seat")?.level === "pass", `${fixed?.stairs[0].seat?.gapIn}`);
const dbl = buildStructure(mk(shape, [stair(2.5), { ...defaultStair("s2", "front", 13.5), level: "lower" }], { heightIn: 126, lower: { ...d0.lower, on: true, place: "under", heightIn: 18 } }));
check("a double deck: a stair off the lower floor is seated on the same bow", dbl.stairs.length === 2 && Math.abs((dbl.stairs[1].seat?.turnDeg ?? 0) + 19.11) < 0.05, `${dbl.stairs.map((s) => s.seat?.turnDeg)}`);

console.log("── the bow, out and in");
check("16 ft bowed 2 ft is a 17-ft radius", bowRadiusFt(16, 2) === 17 && bowRadiusWords(shape, "front") === "17-ft radius");
check("no deeper than a third of the side, no shallower than half a foot", bowLimits(shape, "front").min === 0.5 && Math.abs(bowLimits(shape, "front").max - 64 / 12) < 0.001 && bowLimits(bowed(2, 30), "front").max === 8, JSON.stringify(bowLimits(shape, "front")));
check("pulled by hand it snaps to 3 in.", BOW_STEP_FT === 0.25 && bowOf(bowPatch({ shape }, "front", 2.6)!.shape, "front") === 2.5 && bowOf(bowPatch({ shape }, "front", 3.13)!.shape, "front") === 3.25);
check("…stays inside its limits", Math.abs(bowOf(bowPatch({ shape }, "front", 40)!.shape, "front") - 64 / 12) < 0.001 && bowOf(bowPatch({ shape }, "front", -3)!.shape, "front") === 0.5);
check("…and says nothing when nothing changes, or for a side that is no side", bowPatch({ shape }, "front", 2.05) === null && bowPatch({ shape }, "middle", 3) === null);
check("a straight front takes a bow", bowOf(withBow({ kind: "rect", widthFt: 16, depthFt: 12 }, "front", 3)!, "front") === 3 && withBow({ kind: "L", widthFt: 16, depthFt: 12, notch: { corner: "front-right", widthFt: 4, depthFt: 4 } }, "front", 3) === null);
check("half a foot of bow survives the design's own rails", (() => { const n = normalizeDeckDesign({ ...d0, shape: bowed(0.5) }).shape; return n.kind === "rect" && n.front?.bulgeFt === 0.5; })());
const scene = deckScene(buildStructure(mk(shape)));
const knob = scene.handles.find((h) => h.kind === "bow");
check("Edit in 3D: a Bow knob on the arc's middle, a foot of pull a foot of bow", !!knob && knob.id === "front" && knob.axis === "y" && knob.value === 2 && knob.perUnit === 1 && Math.abs(knob.x - 8) < 0.01 && Math.abs(knob.y - 14) < 0.01 && /17-ft radius/.test(knob.label), JSON.stringify(knob));
check("…and none on a straight front", !deckScene(buildStructure(mk({ kind: "rect", widthFt: 16, depthFt: 12 }))).handles.some((h) => h.kind === "bow"));
const sB = buildStructure(mk(shape));
const rim = partCard(sB, { kind: "rim", id: "", level: "upper" });
const bows = rim?.choices.filter((c) => /^bow-front-/.test(c.id)) ?? [];
check("clicking the rim: a row of bows either side of the one it has, the radius said with each", bows.length === 5 && bows.map((c) => c.label).join(" ") === `1'-0" 1'-6" 2'-0" 2'-6" 3'-0"` && bows.filter((c) => c.current).length === 1 && bows.find((c) => c.current)?.label === `2'-0"` && /radius/.test(bows[0].note ?? ""), bows.map((c) => c.label).join(" "));
const more = bows.find((c) => c.label === `3'-0"`);
const after = more ? applyDeckPatch(mk(shape), more.patch) : null;
check("…picking one bows the deck that far", !!after && after.shape.kind === "rect" && after.shape.front?.bulgeFt === 3 && Math.abs(frontEdgeAt(after.shape, 96) - 180) < 0.01);
check("…the outline goes with it", !!after && Math.max(...shapeOutline(after.shape).map((p) => p.y)) === 180);
check("no row of bows on a straight deck's rim", !(partCard(buildStructure(mk({ kind: "rect", widthFt: 16, depthFt: 12 })), { kind: "rim", id: "", level: "upper" })?.choices ?? []).some((c) => /^bow-/.test(c.id)));

console.log("── which sides bow (2026-11-15: \"choose which side I want the radius on — four sides, three sides, or side one, two, three, four\")");
const sides = (over: Record<string, number>, bulgeFt = 2): DeckShape => ({ kind: "rect", widthFt: 16, depthFt: 12, front: { kind: "curve", bulgeFt, clipFt: 2, ...over } });
const three = mk(sides({ leftFt: 2, rightFt: 2 }));
check("the left and the right side bow as the front does: kept by the design's own rails", three.shape.kind === "rect" && three.shape.front?.leftFt === 2 && three.shape.front?.rightFt === 2 && three.shape.front?.bulgeFt === 2);
check("…a deck against the house has no back to bow; one that stands free does", (() => { const a = mk(sides({ backFt: 2 })).shape; const f = mk(sides({ backFt: 2 }), [], { placement: "detached" }).shape; return a.kind === "rect" && a.front?.backFt === undefined && f.kind === "rect" && f.front?.backFt === 2; })());
check("…a straight front between two bowed sides is a bow of 0", (() => { const n = mk(sides({ leftFt: 2 }, 0)).shape; return n.kind === "rect" && n.front?.bulgeFt === 0 && n.front?.leftFt === 2 && frontEdgeAt(n, 96) === 144; })());
check("…a side bows no deeper than a third of its own length (12 ft deep: 4 ft)", (() => { const n = mk(sides({ leftFt: 7 })).shape; return n.kind === "rect" && n.front?.leftFt === 4 && bowLimits(n, "left").max === 4 && bowLimits(n, "front").max > 5; })());
check("…a back that was the only bow, against the house: a plain rectangle", (() => { const n = mk(sides({ backFt: 3 }, 0)).shape; return n.kind === "rect" && !n.front; })());
const ring3 = shapeOutline(three.shape);
check("the outline bulges at both sides: 2 ft out at their middles, the corners where they were", Math.abs(Math.min(...ring3.map((q) => q.x)) + 24) < 0.01 && Math.abs(Math.max(...ring3.map((q) => q.x)) - 216) < 0.01 && ring3.some((q) => q.x === 0 && q.y === 0) && ring3.some((q) => q.x === 192 && q.y === 144) && Math.abs(sideBowAt(three.shape, "left", 72) - 24) < 1e-9 && sideBowAt(three.shape, "left", 0) === 0, pts(ring3));
check("…still one ring round the deck, never crossing itself (it stays convex)", (() => { const w = ringWinding(ring3); return ring3.every((p, i) => { const q = ring3[(i + 1) % ring3.length]; const r2 = ring3[(i + 2) % ring3.length]; return w * ((q.x - p.x) * (r2.y - q.y) - (q.y - p.y) * (r2.x - q.x)) > -1e-6; }); })());
check("its floor counts the bulges: 192 sq ft and three segments", Math.abs(shapeAreaSqFt(three.shape) - (192 + 21.47 + 2 * 16.35)) < 0.3, `${shapeAreaSqFt(three.shape)}`);
check("it is said as it is: \"curved front and sides\"", /16 ft × 12 ft curved front and sides/.test(sizeWords(three)) && / curved sides/.test(sizeWords(mk(sides({ leftFt: 2, rightFt: 2 }, 0)))) && / curved left side/.test(sizeWords(mk(sides({ leftFt: 2 }, 0)))) && / curved all round/.test(sizeWords(mk(sides({ leftFt: 2, rightFt: 2, backFt: 2 }), [], { placement: "detached" }))), sizeWords(three));
check("bowedSides / bowedWords / bowsLine read them off", bowedSides(three.shape).join(" ") === "front left right" && bowedWords(three.shape) === "the front and both sides" && bowsLine(three.shape) === "the front bowed out 2 ft, the left side 2 ft and the right side 2 ft" && bowsLine(shape) === "the front bowed out 2 ft");
const sThree = buildStructure(three);
const lb = sThree.frame!.sideBows.find((q) => q.side === "left");
check("a side bowed 2 ft is framed on short joists square to it: 8 at 16 in., hung on the doubled outside joist, no beam", !!lb && lb.outriggers === 8 && lb.beam === null && lb.longestIn > 18 && lb.longestIn < 24 && sThree.frame!.sticks.filter((q) => q.role === "joist" && q.sx > q.sy && q.cx < 0).length === 8, JSON.stringify(lb));
const single = buildStructure(mk(sides({ leftFt: 2, rightFt: 2 }), [], { framing: { ...d0.framing, doubleRim: false } }));
check("…the outside joist is doubled there: with a single rim, a sister on its yard side; with a doubled rim it is doubled already", single.frame!.sticks.some((q) => q.role === "joist" && Math.abs(q.cx + 0.75) < 0.01 && q.sy > 100) && single.frame!.sticks.some((q) => q.role === "joist" && Math.abs(q.cx - 192.75) < 0.01 && q.sy > 100) && three.framing.doubleRim && !sThree.frame!.sticks.some((q) => q.role === "joist" && Math.abs(q.cx + 0.75) < 0.01) && sThree.frame!.sticks.some((q) => q.role === "joist" && Math.abs(q.cx - 2.25) < 0.01 && q.sy > 100));
check("…none of those short joists stands outside the deck", sThree.frame!.sticks.filter((q) => q.role === "joist" && q.sx > q.sy).every((q) => (q.cx < 0 ? q.cx - q.sx / 2 > -sideBowAt(three.shape, "left", q.cy) - 0.01 : q.cx + q.sx / 2 < 192 + sideBowAt(three.shape, "right", q.cy) + 0.01)));
check("…the bent rim runs round the sides too", sThree.frame!.sticks.filter((q) => q.role === "rim" && q.curved && (q.cx < 0 || q.cx > 192)).length >= 8);
const deep = buildStructure(mk(sides({ leftFt: 4 }, 0), [], { heightIn: 60 }));
const db = deep.frame!.sideBows.find((q) => q.side === "left");
check("a side bowed 4 ft stands on a beam of its own and two posts, under the short joists", !!db?.beam && db.beam.x === -32 && db.beam.cantIn === 16 && deep.frame!.posts.filter((q) => q.beamId === "bow-left").length === 2 && deep.frame!.posts.filter((q) => q.beamId === "bow-left").every((q) => q.x === -32 && q.footing.bags >= 0) && deep.frame!.sticks.some((q) => q.role === "beam" && q.of === "bow-left" && q.sy > q.sx), JSON.stringify(db));
check("…its posts stand inside the deck's outline", deep.frame!.posts.filter((q) => q.beamId === "bow-left").every((q) => -q.x < sideBowAt(deep.design.shape, "left", q.y)));
check("…the checks say so, and that the tables have no layout for it — said, not hidden", (() => { const cs = deckChecks(deep); const c1 = cs.find((c) => c.id === "left-curve"); const c2 = cs.find((c) => c.id === "left-bow-frame"); return c1?.level !== "fail" && /beam and two posts/.test(c1?.text ?? "") && c2?.level === "info" && /engineer/.test(c2.text); })());
check("…and nothing fails", deckChecks(deep).filter((c) => c.level === "fail").length === 0 && deckChecks(sThree).filter((c) => c.level === "fail").length === 0, deckChecks(deep).filter((c) => c.level === "fail").map((c) => c.id).join(" "));
const boardsSqFt = (s2: ReturnType<typeof buildStructure>) => {
  const su = s2.surface!;
  const ringA = (r: number[]) => { let a = 0; for (let i = 0; i < r.length; i += 2) { const j = (i + 2) % r.length; a += r[i] * r[j + 1] - r[j] * r[i + 1]; } return Math.abs(a) / 2; };
  return (su.pieces.reduce((a, p) => a + p.sx * p.sy, 0) + su.shaped.reduce((a, r) => a + ringA(r), 0)) / 144;
};
check("the boards run on into the bulges: they cover the whole floor but the gaps between them", (() => { const a = shapeAreaSqFt(three.shape); const b = boardsSqFt(sThree); return b > a * 0.95 && b < a * 0.985; })(), `${boardsSqFt(sThree).toFixed(1)} of ${shapeAreaSqFt(three.shape)}`);
check("…and no board lies outside the outline", sThree.surface!.shaped.every((r) => { for (let i = 0; i < r.length; i += 2) { const x = r[i]; const y = r[i + 1]; if (x < -sideBowAt(three.shape, "left", y) - 0.05 || x > 192 + sideBowAt(three.shape, "right", y) + 0.05 || y > frontEdgeAt(three.shape, Math.max(0, Math.min(192, x))) + 0.05) return false; } return true; }));
check("the rail follows the bulges: more of it than round the same deck with straight sides", sThree.rails.lf > buildStructure(mk(shape)).rails.lf + 0.5 && sThree.rails.segments.some((g) => g.x0 < -1 || g.x1 < -1) && sThree.rails.segments.some((g) => g.x0 > 193 || g.x1 > 193), `${sThree.rails.lf}`);
const free = mk(sides({ leftFt: 2, rightFt: 2, backFt: 2 }), [], { placement: "detached", heightIn: 30 });
const sFree = buildStructure(free);
check("a free-standing deck bowed all round: its back bulges behind it, its joists run on past the back beam to the arc", Math.abs(Math.min(...shapeOutline(free.shape).map((q) => q.y)) + 24) < 0.01 && sFree.frame!.sticks.some((q) => q.role === "joist" && q.sy > q.sx && q.cy - q.sy / 2 < -12) && !!sFree.frame!.sideBows.find((q) => q.side === "back") && sFree.frame!.sticks.some((q) => q.role === "rim" && q.curved && q.cy < 0));
check("…boards cover the back's bulge", sFree.surface!.shaped.some((r) => r.some((v, i) => i % 2 === 1 && v < -6)) && boardsSqFt(sFree) > shapeAreaSqFt(free.shape) * 0.93, `${boardsSqFt(sFree).toFixed(1)} of ${shapeAreaSqFt(free.shape)}`);
check("…the rail runs round the back too", sFree.rails.segments.some((g) => g.y0 < -1 || g.y1 < -1));
check("…and it builds with a border, on a slope, as a double deck — nothing fails", [mk(sides({ leftFt: 2, rightFt: 2, backFt: 2 }), [], { placement: "detached", decking: { ...d0.decking, border: 1, fascia: "match" } }), mk(sides({ leftFt: 3, rightFt: 1.5 }), [], { site: { ...d0.site, slope: { ...d0.site.slope, outDropIn: 18 } } }), mk(sides({ leftFt: 2, rightFt: 2 }), [], { heightIn: 156, lower: { ...d0.lower, on: true, place: "under", heightIn: 42 } })].every((d) => deckChecks(buildStructure(d)).filter((c) => c.level === "fail").length === 0));
const onLeft = buildStructure(mk(sides({ leftFt: 2 }), [{ ...defaultStair("s1", "left", 3) }, { ...defaultStair("s2", "right", 6) }]));
check("a stair on a bowed side is seated on its curve: turned near its end, its head on the arc", sideChain(sides({ leftFt: 2 }), "left").length === 7 && Math.abs(onLeft.stairs[0].seat?.turnDeg ?? 0) > 5 && (onLeft.stairs[0].seat?.gapIn ?? 9) < 3 && Math.min(...onLeft.stairs[0].footprint.slice(0, 2).map((q) => q.x)) < -5, JSON.stringify(onLeft.stairs[0].seat));
check("…one on the straight side beside it is as it always was", !onLeft.stairs[1].seat && pts(onLeft.stairs[1].footprint.slice(0, 2)) === "192,48 192,96", pts(onLeft.stairs[1].footprint.slice(0, 2)));
check("a side is bowed and made straight by its own switch", (() => { const on = toggleBow({ kind: "rect", widthFt: 16, depthFt: 12 }, "left", true)!; const both = toggleBow(on, "front", true)!; const off = toggleBow(both, "left", false)!; const none = toggleBow(off, "front", false)!; return bowOf(on, "left") === 2 && bowOf(on, "front") === 0 && bowOf(both, "front") === 2 && bowOf(off, "left") === 0 && bowOf(off, "front") === 2 && none.kind === "rect" && !none.front; })());
check("…the sides a deck offers: three against the house, four standing free; none for an L", bowSidesFor(three).join(" ") === "front left right" && bowSidesFor(free).join(" ") === "front left right back" && bowSidesFor(mk({ kind: "L", widthFt: 16, depthFt: 12, notch: { corner: "front-right", widthFt: 4, depthFt: 4 } })).length === 0);
check("…a side's bow pulled by hand: to 3 in., inside its limits, the other sides untouched; the back refused against the house", (() => { const p1 = bowPatch(three, "left", 3.1)!.shape; return bowOf(p1, "left") === 3 && bowOf(p1, "front") === 2 && bowOf(p1, "right") === 2 && bowOf(bowPatch(three, "right", 40)!.shape, "right") === 4 && bowPatch(three, "back", 2) === null && bowOf(bowPatch(free, "back", 3)!.shape, "back") === 3; })());
const knobs = deckScene(sFree).handles.filter((h) => h.kind === "bow");
check("Edit in 3D: a Bow knob on every bowed side's middle — the left and the back follow the hand outward", knobs.length === 4 && knobs.map((h) => h.id).join(" ") === "front left right back" && knobs.find((h) => h.id === "left")?.axis === "x" && knobs.find((h) => h.id === "left")?.follow === -1 && knobs.find((h) => h.id === "right")?.follow === undefined && knobs.find((h) => h.id === "back")?.axis === "y" && knobs.find((h) => h.id === "back")?.follow === -1 && Math.abs((knobs.find((h) => h.id === "left")?.x ?? 0) + 2) < 0.01 && bowApex(free.shape, "right").x === 216, JSON.stringify(knobs.map((h) => [h.id, h.axis, h.follow, h.x, h.y])));
const rimCard = partCard(sThree, { kind: "rim", id: "", level: "upper" });
check("clicking the rim: a row of bows for every bowed side", ["front", "left", "right"].every((sd) => (rimCard?.choices ?? []).filter((c) => c.id.startsWith(`bow-${sd}-`)).length >= 4) && (rimCard?.choices ?? []).filter((c) => /^bow-/.test(c.id) && c.current).length === 3);
check("the scope of work names every bow", /the front bowed out 2 ft, the left side 2 ft and the right side 2 ft on a laminated rim/.test(JSON.stringify(priceDeck(three).lines.map((l) => l.description))));
check("a 17-ft radius is no trouble for a composite border (13 ft is its tightest) — the check read the other way round", (() => { const c = deckChecks(buildStructure(mk(shape))).find((q) => q.id === "front-curve"); return c?.level === "pass" && /heat-bent/.test(c.text) && /17-ft radius/.test(c.text); })());
check("…a bow tighter than the board bends to is said", (() => { const c = deckChecks(buildStructure(mk(bowed(5)))).find((q) => q.id === "front-curve"); return c?.level === "info" && /will not bend that tight/.test(c.text); })());
check("shapeBows of any other deck: nothing bows", Object.values(shapeBows({ kind: "rect", widthFt: 16, depthFt: 12 })).every((v) => v === 0) && Object.values(shapeBows({ kind: "rect", widthFt: 16, depthFt: 12, front: { kind: "clipped", bulgeFt: 2, clipFt: 2 } })).every((v) => v === 0));

console.log(bad ? `\n${bad} FAILED` : "\nALL PASS");
process.exit(bad ? 1 : 0);
