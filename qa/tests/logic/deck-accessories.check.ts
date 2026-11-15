// ACCESSORIES IN GROUPS, MOVED BY HAND (2026-11-14; lib/deck/builtins, lib/deck/accessories) — the owner: "make separate
// accessories, that way it will be understandable" and "make it movable on 3D: accessory drag and turn and place".
// The accessories fall into three groups (seating and planters; privacy screen; outdoor kitchen and fire), each with its
// own heading in the studio and in the checks. Any accessory but a privacy screen can stand on a spot of its own — its
// middle and its turn — dragged there in the 3D, turned 45° at a time, or put where a click lands; let go with its back
// to an edge near where it would stand along it and it lines up against that edge. A screen slides along the edges.
// The engine checks a spot as it checks an edge: all of it on the deck, clear of the railing, out of a stair's landing.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/deck-accessories.check.ts
import { defaultDeckDesign, defaultStair, normalizeDeckDesign, shapeOutline, type DeckDesign } from "../../../src/lib/deck/design";
import { buildStructure } from "../../../src/lib/deck/structure";
import { applyDeckPatch, deckChecks, type DeckPatch } from "../../../src/lib/deck/checks";
import { priceDeck } from "../../../src/lib/deck/pricing";
import { deckScene, parseDeckScene } from "../../../src/lib/deck/scene";
import { partAt, partCard } from "../../../src/lib/deck/parts";
import { ACCESSORY_GROUPS, ACCESSORY_GROUP_KINDS, ACCESSORY_GROUP_LABEL, BUILT_IN_INSET_IN, BUILT_IN_KINDS, STAIR_LANDING_IN, accessoryGroupOf, planGap, type BuiltIn, type BuiltInBuild } from "../../../src/lib/deck/builtins";
import { ACCESSORY_TURN_DEG, accessoryPose, edgeAccessory, moveAccessory, placeAccessory, turnAccessory } from "../../../src/lib/deck/accessories";
import { parseUtterance } from "../../../src/lib/deck/voice/parse";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};
const d0 = defaultDeckDesign({ state: "WA" });
const mk = (builtIns: unknown[], over: Record<string, unknown> = {}): DeckDesign => normalizeDeckDesign({ ...d0, shape: { kind: "rect", widthFt: 20, depthFt: 14 }, heightIn: 36, rail: { ...d0.rail, type: "aluminum" }, ...over, extras: { ...d0.extras, builtIns } });
const near = (a: number, b: number, tol = 0.05) => Math.abs(a - b) <= tol;
const one = (d: DeckDesign, id: string): BuiltInBuild => buildStructure(d).builtIns.find((b) => b.design.id === id)!;
const apply = (d: DeckDesign, p: DeckPatch | null) => (p ? applyDeckPatch(d, p) : d);
const ring = shapeOutline(mk([]).shape);
const inRing = (x: number, y: number) => {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
};
/** How far its nearest corner stands in from the deck's open edges (front x 0..240 at y 168, left x 0, right x 240). */
const clearOfEdges = (b: BuiltInBuild) => Math.min(...b.footprint.flatMap((p) => [168 - p.y, p.x, 240 - p.x]));

/* ── 1. The groups ───────────────────────────────────────────────────── */
const grouped = ACCESSORY_GROUPS.flatMap((g) => ACCESSORY_GROUP_KINDS[g]);
check("three groups, every kind in exactly one", ACCESSORY_GROUPS.length === 3 && grouped.length === BUILT_IN_KINDS.length && BUILT_IN_KINDS.every((k) => grouped.filter((x) => x === k).length === 1 && ACCESSORY_GROUP_KINDS[accessoryGroupOf(k)].includes(k)));
check("named for what they hold", ACCESSORY_GROUP_LABEL.seating === "Seating and planters" && ACCESSORY_GROUP_LABEL.privacy === "Privacy screen" && ACCESSORY_GROUP_LABEL.kitchen === "Outdoor kitchen and fire");
const all = buildStructure(mk([{ id: "b1", kind: "bench", side: "front", atFt: 6, lengthFt: 6 }, { id: "s1", kind: "screen", side: "left", atFt: 7, lengthFt: 30 }, { id: "k1", kind: "kitchen", side: "right", atFt: 6, lengthFt: 6 }]));
const parts = new Map(deckChecks(all).filter((c) => /^builtin-[a-z0-9]+$/.test(c.id)).map((c) => [c.id, c.part]));
check("each accessory's check is headed with its group", parts.get("builtin-b1") === "Seating and planters" && parts.get("builtin-s1") === "Privacy screen" && parts.get("builtin-k1") === "Outdoor kitchen and fire", JSON.stringify([...parts]));

/* ── 2. A spot of its own, read back ─────────────────────────────────── */
const read = mk([
  { id: "a", kind: "bench", side: "front", atFt: 6, lengthFt: 6, spot: { x: 100.26, y: 80.8, turnDeg: -45.4 } },
  { id: "b", kind: "screen", side: "left", atFt: 6, lengthFt: 8, spot: { x: 50, y: 50, turnDeg: 0 } },
  { id: "c", kind: "planter", side: "front", atFt: 6, lengthFt: 4, spot: { x: "x", y: 9 } },
  { id: "d", kind: "fire", side: "front", atFt: 6, lengthFt: 4, spot: { x: 9999, y: -9999 } },
]).extras.builtIns!;
check("to the half inch, turned to the degree (0–359)", JSON.stringify(read[0].spot) === JSON.stringify({ x: 100.5, y: 81, turnDeg: 315 }), JSON.stringify(read[0].spot));
check("never on a privacy screen; nothing for a spot that is not one; kept on the plan", read[1].spot === undefined && read[2].spot === undefined && read[3].spot?.x === 960 && read[3].spot?.y === -480);
check("a deck with no spot set is unchanged (no spot is written)", mk([{ id: "a", kind: "bench", side: "front", atFt: 6, lengthFt: 6 }]).extras.builtIns![0].spot === undefined);

/* ── 3. Built on a spot ──────────────────────────────────────────────── */
const freeD = mk([{ id: "b1", kind: "bench", side: "front", atFt: 6, lengthFt: 6, spot: { x: 120, y: 84, turnDeg: 45 } }]);
const fb = one(freeD, "b1");
const c45 = Math.SQRT1_2;
check("a 6-ft bench on a spot in the middle, turned 45°: built there", fb.built && near(accessoryPose(fb)!.x, 120, 0.5) && near(accessoryPose(fb)!.y, 84, 0.5) && accessoryPose(fb)!.turnDeg === 45 && fb.lengthIn === 72);
check("…its footprint turned with it, its length along 45°", near(fb.footprint[1].x - fb.footprint[0].x, 72 * c45, 0.05) && near(fb.footprint[1].y - fb.footprint[0].y, 72 * c45, 0.05));
check("…every part turned with it and over its footprint", fb.members.every((m) => near(m.yaw, Math.PI / 4, 1e-6)) && fb.members.every((m) => planGap(fb.footprint, [{ x: m.cx, y: m.cy }]) < 2));
check("…the same bench, priced as along an edge (by the foot)", priceDeck(freeD).lines.find((l) => l.id === "deck-benches")?.quantity === 6);
const off = one(mk([{ id: "b1", kind: "bench", side: "front", atFt: 6, lengthFt: 6, spot: { x: 300, y: 84, turnDeg: 0 } }]), "b1");
const inRail = one(mk([{ id: "b1", kind: "bench", side: "front", atFt: 6, lengthFt: 6, spot: { x: 120, y: 162, turnDeg: 0 } }]), "b1");
check("off the deck, or into the railing's line: not built, and why", !off.built && !inRail.built && /off the deck or in the railing's way/.test(off.why ?? "") && /railing/.test(inRail.why ?? ""));
const noRail = one(mk([{ id: "b1", kind: "bench", side: "front", atFt: 6, lengthFt: 6, spot: { x: 120, y: 157, turnDeg: 0 } }], { heightIn: 14, rail: { ...d0.rail, type: "none" } }), "b1");
check("with no railing it may stand nearer the edge", noRail.built && noRail.footprint.every((p) => 168 - p.y >= BUILT_IN_INSET_IN.none - 0.01));
const stairD = mk([{ id: "p1", kind: "planter", side: "front", atFt: 6, lengthFt: 4, spot: { x: 96, y: 130, turnDeg: 0 } }], { stairs: [defaultStair("s1", "front", 8)] });
const stairCheck = deckChecks(buildStructure(stairD)).find((c) => c.id === "builtin-p1-stair");
check("in front of a stair's top: a failing check — the landing the code wants", one(stairD, "p1").flags.onStair && stairCheck?.level === "fail" && new RegExp(`within ${STAIR_LANDING_IN} in\\. of the top of a stair`).test(stairCheck.text), stairCheck?.text ?? "");
check("…clear of the landing: nothing said", !deckChecks(buildStructure(mk([{ id: "p1", kind: "planter", side: "front", atFt: 6, lengthFt: 4, spot: { x: 96, y: 60, turnDeg: 0 } }], { stairs: [defaultStair("s1", "front", 8)] }))).some((c) => c.id === "builtin-p1-stair"));
const lap = buildStructure(mk([{ id: "k1", kind: "kitchen", side: "right", atFt: 6, lengthFt: 6 }, { id: "b1", kind: "bench", side: "front", atFt: 6, lengthFt: 6, spot: { x: 200, y: 72, turnDeg: 90 } }]));
check("on top of one along an edge: both stay, and the two are said to cross", lap.builtIns.every((b) => b.built) && deckChecks(lap).filter((c) => /-overlap$/.test(c.id)).length === 1 && /Drag one of them clear/.test(deckChecks(lap).find((c) => /-overlap$/.test(c.id))?.text ?? ""));
const guarded = (x: number, y: number) => deckChecks(buildStructure(mk([{ id: "b1", kind: "bench", side: "front", atFt: 6, lengthFt: 6, spot: { x, y, turnDeg: 0 } }]))).find((c) => c.id === "builtin-b1")?.text ?? "";
check("a bench out in the middle is not beside a guard; one by the railing is", !/step up for a child/.test(guarded(120, 84)) && /step up for a child/.test(guarded(120, 145)));

/* ── 4. Dragged ──────────────────────────────────────────────────────── */
let d = mk([{ id: "b1", kind: "bench", side: "front", atFt: 12, lengthFt: 6 }, { id: "s1", kind: "screen", side: "left", atFt: 6, lengthFt: 30 }, { id: "f1", kind: "fire", side: "front", atFt: 10, lengthFt: 3, inFt: 5 }]);
let s = buildStructure(d);
const start = accessoryPose(s.builtIns.find((b) => b.design.id === "b1")!)!;
d = apply(d, moveAccessory(s, "b1", 120, 84));
s = buildStructure(d);
let b1 = one(d, "b1");
check("dragged to the middle: it stands there, turned as it was", b1.built && !!b1.design.spot && near(accessoryPose(b1)!.x, 120, 0.5) && near(accessoryPose(b1)!.y, 84, 0.5) && accessoryPose(b1)!.turnDeg === start.turnDeg);
d = apply(d, moveAccessory(s, "b1", 500, 84));
s = buildStructure(d);
b1 = one(d, "b1");
check("dragged far off the deck: it stops at the last place it fits, clear of the railing", b1.built && b1.footprint.every((p) => inRing(p.x, p.y)) && clearOfEdges(b1) >= BUILT_IN_INSET_IN.top - 0.6 && clearOfEdges(b1) < BUILT_IN_INSET_IN.top + 2, `${clearOfEdges(b1)}`);
d = apply(d, moveAccessory(s, "b1", 150, 160));
s = buildStructure(d);
b1 = one(d, "b1");
check("let go with its back to the front rail, near where it would stand along it: it lines up there", b1.built && !b1.design.spot && b1.design.side === "front" && near(b1.design.atFt, 12.5, 0.5) && near(Math.max(...b1.footprint.map((p) => p.y)), 168 - BUILT_IN_INSET_IN.top, 0.05), JSON.stringify(b1.design));
const sMove = moveAccessory(s, "s1", 238, 90);
const s1 = one(apply(d, sMove), "s1");
check("a privacy screen dragged across: it goes to the nearest edge, at that place along it — never a spot", !!sMove && s1.built && s1.design.side === "right" && !s1.design.spot && near(s1.design.atFt, 7.5, 0.5));
const fMove = moveAccessory(s, "f1", 120, 163);
const f1 = one(apply(d, fMove), "f1");
check("a fire table never lines up against an edge: it stays out on the deck", !!fMove && f1.built && !!f1.design.spot);

/* ── 5. Turned ───────────────────────────────────────────────────────── */
d = mk([{ id: "b1", kind: "bench", side: "front", atFt: 10, lengthFt: 8 }, { id: "s1", kind: "screen", side: "left", atFt: 6, lengthFt: 30 }]);
s = buildStructure(d);
const before = accessoryPose(s.builtIns[0])!;
const turned = apply(d, turnAccessory(s, "b1", ACCESSORY_TURN_DEG));
const tb = one(turned, "b1");
check("turned 45° along the front rail: it does not fit there turned, so it is moved in until it does", tb.built && accessoryPose(tb)!.turnDeg === (before.turnDeg + 45) % 360 && accessoryPose(tb)!.y < before.y - 5 && clearOfEdges(tb) >= BUILT_IN_INSET_IN.top - 0.6, JSON.stringify(accessoryPose(tb)));
const tb2 = one(apply(turned, turnAccessory(buildStructure(turned), "b1", -ACCESSORY_TURN_DEG)), "b1");
check("…turned back: square again, where it was moved to", tb2.built && accessoryPose(tb2)!.turnDeg === before.turnDeg);
check("a privacy screen does not turn", turnAccessory(s, "s1", 45) === null);

/* ── 6. Placed where a click lands, and back along an edge ───────────── */
d = mk([{ id: "k1", kind: "kitchen", side: "front", atFt: 14, lengthFt: 6 }]);
s = buildStructure(d);
const placed = one(apply(d, placeAccessory(s, "k1", 60, 40)), "k1");
check("placed by a click near the house: it stands there, turned as it was", placed.built && !!placed.design.spot && near(accessoryPose(placed)!.x, 60, 0.5) && near(accessoryPose(placed)!.y, 40, 0.5));
const pushed = one(apply(d, placeAccessory(s, "k1", 236, 90)), "k1");
check("placed by a click on the railing: moved in until it fits", pushed.built && clearOfEdges(pushed) >= BUILT_IN_INSET_IN.top - 0.6 && accessoryPose(pushed)!.x < 236);
const back = apply(apply(d, placeAccessory(s, "k1", 60, 40)), null);
const backB = one(apply(back, edgeAccessory(buildStructure(back), "k1")), "k1");
check("back along an edge: the nearest open edge, at that place along it", backB.built && !backB.design.spot && backB.design.side === "left");
check("one along an edge has no edge to go back to", edgeAccessory(s, "k1") === null);

/* ── 7. The 3D ───────────────────────────────────────────────────────── */
const sc = deckScene(buildStructure(freeD));
const h = sc.handles.filter((q) => q.kind === "builtin");
check("each accessory is its own handle, dragged both ways: its middle, its box to take hold of", h.length === 1 && h[0].axis === "xy" && h[0].id === "b1" && near(h[0].value, 120, 0.5) && near(h[0].value2 ?? -1, 84, 0.5) && !!h[0].grab && h[0].grab[0] < 120 / 12 && h[0].grab[3] > 120 / 12);
const round = parseDeckScene(JSON.parse(JSON.stringify(sc)));
const rh = round?.handles.find((q) => q.kind === "builtin");
check("…and read back from the saved scene with both numbers", rh?.axis === "xy" && near(rh.value2 ?? -1, 84, 0.5));
check("a deck with no accessories has no such handle", !deckScene(buildStructure(mk([]))).handles.some((q) => q.kind === "builtin"));
const st = buildStructure(freeD);
const seatIdx = sc.boxes.findIndex((_, i) => sc.legend[sc.tags[i]]?.role === "bench seat");
const ref = partAt(st, sc, seatIdx);
check("clicking the bench in the 3D names it", ref?.kind === "accessory" && ref.id === "b1", JSON.stringify(ref));
const card = partCard(st, ref!);
const labels = card.choices.map((c) => c.label);
check("its card: turn it left, right, a quarter turn; back along an edge; remove it", card.title === "Bench" && labels.some((l) => /45° to the left/.test(l)) && labels.some((l) => /45° to the right/.test(l)) && labels.some((l) => /quarter turn/.test(l)) && labels.some((l) => /back along the nearest edge/.test(l)) && labels.some((l) => /Remove the bench/.test(l)), labels.join(" | "));
const right = card.choices.find((c) => /45° to the right/.test(c.label))!;
check("…its turn does what it says", accessoryPose(one(applyDeckPatch(freeD, right.patch), "b1"))!.turnDeg === 90);
const scSc = deckScene(all);
const screenRef = partAt(all, scSc, scSc.boxes.findIndex((_, i) => scSc.legend[scSc.tags[i]]?.role === "screen board"));
check("a privacy screen's card has no turn", screenRef?.kind === "accessory" && !partCard(all, screenRef).choices.some((c) => /Turn/.test(c.label)));

/* ── 8. By voice ─────────────────────────────────────────────────────── */
const go = parseUtterance("go to accessories", { design: mk([]) } as never).clauses.flatMap((c) => c.cmds)[0];
check("\"go to accessories\"", go?.do === "go" && go.to === "accessories", JSON.stringify(go));

console.log(bad ? `\n${bad} FAILED` : "\nALL PASS");
process.exit(bad ? 1 : 0);
void ({} as BuiltIn);
