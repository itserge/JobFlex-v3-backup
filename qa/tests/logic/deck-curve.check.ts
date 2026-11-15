// THE BOW BY HAND, AND STAIRS THAT MEET IT (2026-11-15; lib/deck/curve, lib/deck/edgeSeat) — the owner, of a deck with a
// bowed front: "I click on the radius — make me a toggle to move out and move in, to make a bigger radius or a smaller
// radius… And if the stairs attach to the radius deck, make sure they attach right, because right now there is a gap on
// the radius because the stairs are thinking it's attaching to the flat. Make it a smart check."
// Worked on a 16 x 12 ft deck bowed 2 ft (a 17-ft radius), a 4-ft stair 2½ ft from the left end: its head stood 10 in.
// off the deck at one corner and 7 in. under it at the other. It is now turned 19° to the curve, its head on the edge.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/deck-curve.check.ts
import { defaultDeckDesign, defaultStair, frontEdgeAt, normalizeDeckDesign, shapeOutline, type DeckDesign, type DeckShape } from "../../../src/lib/deck/design";
import { buildStructure } from "../../../src/lib/deck/structure";
import { applyDeckPatch, deckChecks } from "../../../src/lib/deck/checks";
import { deckScene } from "../../../src/lib/deck/scene";
import { partCard } from "../../../src/lib/deck/parts";
import { deckTakeoff } from "../../../src/lib/deck/takeoff";
import { BOW_STEP_FT, bowLimits, bowOf, bowPatch, bowRadiusFt, bowRadiusWords, frontChain, withBow } from "../../../src/lib/deck/curve";
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
check("…and says nothing when nothing changes", bowPatch({ shape }, "front", 2.05) === null && bowPatch({ shape }, "left", 3) === null);
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

console.log(bad ? `\n${bad} FAILED` : "\nALL PASS");
process.exit(bad ? 1 : 0);
