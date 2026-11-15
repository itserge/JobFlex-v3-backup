// THE HOUSE WALL LOCKED (2026-11-14, lib/deck/house HouseDesign.locked — the owner: "when the house wall is set, or built
// from a picture, lock it: only the deck works around it, not moving the wall. When the deck goes past the locked wall
// you don't expand the house, you expand the deck beyond the wall, right or left… if you need to adjust the back wall,
// unlock it"). Locked, the house stays exactly where it is whatever the deck does: a deck pulled wider runs past the
// house's corner (never a sliver past it), a plain shape picked brings the deck back to the wall, a shape asks nothing
// of the wall, the 3D offers no wall knobs, and voice does not reshape it. Unlocked, everything is as it was. Pure.
//   NODE_PATH="" npx tsx --tsconfig tsconfig.json qa/tests/logic/deck-wall-lock.check.ts
import { defaultDeckDesign, normalizeDeckDesign, type DeckDesign, type DeckShape } from "@/lib/deck/design";
import { patchDesign } from "@/lib/deck/edit";
import { houseForShape, lockedEnd, normalizeHouse, resizeDeckLeft, resizeDeckRight } from "@/lib/deck/house";
import { buildStructure } from "@/lib/deck/structure";
import { deckScene } from "@/lib/deck/scene";
import { runCommand } from "@/lib/deck/voice/run";

let bad = 0;
const check = (name: string, ok: boolean, info: unknown = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || info === "" ? "" : `  — ${typeof info === "string" ? info : JSON.stringify(info)}`}`);
};

const d0 = defaultDeckDesign({ state: "WA" });
const rect = (widthFt: number, depthFt = 12): DeckShape => ({ kind: "rect", widthFt, depthFt });
const make = (locked: boolean, more: Record<string, unknown> = {}): DeckDesign => normalizeDeckDesign({ ...d0, shape: rect(16), house: { ...d0.house, leftFt: 4, rightFt: 3, jogs: [], ...(locked ? { locked: true } : {}), ...more } });
/** Where the house's two ends are in the yard, measured from a point that never moves: the deck's RIGHT end when the left end was pulled, else its left end. */
const houseFromLeft = (d: DeckDesign) => [-d.house.leftFt, d.shape.widthFt + d.house.rightFt];
const houseFromRight = (d: DeckDesign) => [-(d.shape.widthFt + d.house.leftFt), d.house.rightFt];
const same = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9);

console.log("— read back —");
{
  check("locked is kept", normalizeHouse({ ...d0.house, locked: true }, rect(16)).locked === true);
  check("anything else is no lock (absent)", normalizeHouse({ ...d0.house, locked: "yes" }, rect(16)).locked === undefined && normalizeHouse(d0.house, rect(16)).locked === undefined);
  check("…and through the design's own read-back", make(true).house.locked === true && make(false).house.locked === undefined);
}

console.log("— the rule: the deck's end against a locked wall —");
{
  const h = make(true).house; // 4 ft past the left end, 3 past the right; the deck 16 wide
  const s = rect(16);
  const at = (w: number) => lockedEnd(h, s, "right", w);
  check("1 ft wider: still on the wall, 2 ft of wall past the end", at(17).widthFt === 17 && at(17).reachFt === 2);
  check("to the corner: the end at the corner", at(19).widthFt === 19 && at(19).reachFt === 0);
  check("half a foot past the corner: stops at the corner (no sliver)", at(19.5).widthFt === 19 && at(19.5).reachFt === 0);
  check("1 ft past: goes 2 ft past (the least part of a deck to frame)", at(20).widthFt === 21 && at(20).reachFt === -2);
  check("5 ft past: 5 ft past", at(24).widthFt === 24 && at(24).reachFt === -5);
  check("30 ft past at most", at(70).reachFt === -30 && at(70).widthFt === 49);
  check("narrower: more wall past the end", at(12).widthFt === 12 && at(12).reachFt === 7);
  const past = { ...h, leftFt: -10 };
  check("no narrower than 4 ft of deck on the wall beside a deck past the other corner", lockedEnd(past, rect(20), "right", 8).widthFt === 14, lockedEnd(past, rect(20), "right", 8));
}

console.log("— the deck pulled wider and narrower —");
{
  const d = make(true);
  for (const w of [17, 19, 21, 24, 30, 12]) {
    const n = patchDesign(d, { shape: rect(w) });
    check(`the right end to ${w} ft: the house where it was`, same(houseFromLeft(n), houseFromLeft(d)), { house: houseFromLeft(n), was: houseFromLeft(d), width: n.shape.widthFt });
  }
  const past = patchDesign(d, { shape: rect(24) });
  check("pulled 5 ft past the corner: the deck runs past it on its own beam (an open back part), the house is not stretched", past.house.rightFt === -5 && past.shape.kind === "wall" && past.shape.back.some((b) => b.open), { rightFt: past.house.rightFt, kind: past.shape.kind });
  const f = buildStructure(past).frame!;
  check("…framed: the part past the corner has no ledger behind it", f.zones.some((z) => !!z.zone.open), f.zones.map((z) => [z.zone.x0, z.zone.x1, z.zone.open ?? false]));
  const sliver = patchDesign(d, { shape: rect(19.5) });
  check("half a foot past asked: the deck stops at the corner", sliver.shape.widthFt === 19 && sliver.house.rightFt === 0);
  for (const w of [14, 20, 22, 26]) {
    const r = resizeDeckLeft(d.house, d.shape, w, 4, 60);
    const n = patchDesign(d, { house: r.house, shape: r.shape });
    check(`the LEFT end to ${w} ft: the house where it was`, same(houseFromRight(n), houseFromRight(d)), { house: houseFromRight(n), was: houseFromRight(d), width: n.shape.widthFt });
  }
  const leftPast = resizeDeckLeft(d.house, d.shape, 26, 4, 60);
  check("the left end 6 ft past the corner: the deck past it, not the house stretched", leftPast.house.leftFt === -6 && leftPast.shape.widthFt === 26);
  const leftSliver = resizeDeckLeft(d.house, d.shape, 21, 4, 60);
  check("the left end 1 ft past asked: 2 ft past", leftSliver.house.leftFt === -2 && leftSliver.shape.widthFt === 22, leftSliver.house.leftFt);
}

console.log("— unlocked: as it always was —");
{
  const d = make(false);
  const n = patchDesign(d, { shape: rect(24) });
  check("pulled wider, an unlocked house grows with the deck (the wall still past both ends)", n.house.rightFt === 3 && n.house.leftFt === 4 && n.shape.widthFt === 24);
  const r = resizeDeckLeft(d.house, d.shape, 26, 4, 60);
  check("the left end past the house's end: the house grows (the wall's reach held at nothing)", r.house.leftFt === 0 && r.shape.widthFt === 26, r.house.leftFt);
}

console.log("— shapes and the wall —");
{
  const d = make(true);
  const L: DeckShape = { kind: "L", widthFt: 16, depthFt: 12, notch: { corner: "back-right", widthFt: 5, depthFt: 4 } };
  check("an L cut at the back asks a step of an unlocked wall, of a locked one nothing", houseForShape(make(false).house, L).jogs.length === 1 && houseForShape(d.house, L) === d.house);
  const past = patchDesign(d, { shape: rect(24) });
  const back = patchDesign(past, { shape: rect(24) });
  check("a rectangle picked while the deck runs past a locked wall's corner: the deck comes back to the wall, the house stays", back.house.rightFt === 0 && back.shape.widthFt === 19 && same(houseFromLeft(back), houseFromLeft(d)), { w: back.shape.widthFt, r: back.house.rightFt, house: houseFromLeft(back) });
  const unlockedBack = patchDesign(patchDesign(make(false), { house: { rightFt: -5 }, shape: rect(24) }), { shape: rect(24) });
  check("…unlocked, as before: the house's corner goes back out to the deck's end", unlockedBack.house.rightFt === 0 && unlockedBack.shape.widthFt === 24);
}

console.log("— the 3D and voice —");
{
  const handleKinds = (d: DeckDesign) => deckScene(buildStructure(d)).handles.map((h) => h.kind);
  const withStep = (locked: boolean) => make(locked, { jogs: [{ id: "j1", atFt: 8, dir: "away", depthFt: 2 }] });
  check("unlocked: the wall's knobs in Edit in 3D (its corners and its steps)", handleKinds(withStep(false)).filter((k) => k === "house-left" || k === "house-right" || k === "jog").length === 3, handleKinds(withStep(false)));
  check("locked: none of them — the deck's own knobs still there", !handleKinds(withStep(true)).some((k) => k === "house-left" || k === "house-right" || k === "jog") && handleKinds(withStep(true)).includes("width") && handleKinds(withStep(true)).includes("width-left"));
  const said = runCommand(make(true), { do: "house", wall: "straight" });
  check("voice: a locked wall is not reshaped, and it says how to unlock it", said.refused === true && /locked/.test(said.said.join(" ")) && said.design.house.locked === true, said.said);
  const colour = runCommand(make(true), { do: "house", storeys: 2 });
  check("…its look still changes", !colour.refused && colour.design.house.storeys === 2 && colour.design.house.locked === true);
  const wider = runCommand(make(true), { do: "size", width: { to: 24 } });
  check("…and 'make it 24 wide' widens the deck past the corner, the house where it was", wider.design.shape.widthFt === 24 && wider.design.house.rightFt === -5, { w: wider.design.shape.widthFt, r: wider.design.house.rightFt });
  check("unlocked, voice reshapes the wall as before", !runCommand(make(false, { jogs: [{ id: "j1", atFt: 8, dir: "away", depthFt: 2 }] }), { do: "house", wall: "straight" }).refused);
}

// THE RIGHT SIDE PULLED ON THE DRAWING (2026-11-15): the drawing drags the deck's right side in many small moves, each
// worked out from where the drag started and applied on top of the last. It sent the house as it was at the START with
// every move, so on a locked wall the second move undid the lock's answer and the house grew with the deck (16 ft of
// deck pulled to 24: the house went from 24 to 32 ft). Now the right end, like the left, is worked out with its house.
console.log("— the deck's right side dragged on the drawing —");
{
  const L = make(true, { rightFt: 4 });
  const W = [8, 40] as const;
  /** The drawing's own way: every move from the drag's start, sent as the drawing sends it, patched onto the last. */
  const dragRight = (start: DeckDesign, widths: number[]): DeckDesign => {
    let now = start;
    for (const w of widths) {
      const ended = resizeDeckRight(start.house, start.shape, w, W[0], W[1]);
      const houseMoved = JSON.stringify(ended.house) !== JSON.stringify(now.house);
      const shapeMoved = JSON.stringify(ended.shape) !== JSON.stringify(now.shape);
      if (houseMoved || shapeMoved) now = patchDesign(now, { ...(houseMoved ? { house: ended.house } : {}), shape: ended.shape });
    }
    return now;
  };
  const one = resizeDeckRight(L.house, L.shape, 24, W[0], W[1]);
  check("locked, the right end taken 8 ft out: the deck is 24 ft, 4 ft past the corner", one.shape.widthFt === 24 && one.house.rightFt === -4 && one.house.locked === true, { w: one.shape.widthFt, r: one.house.rightFt });
  const dragged = dragRight(L, [16.5, 17, 18, 19, 20, 20.5, 21, 22, 23, 24]);
  check("…dragged there in ten small moves: the same deck, and the house exactly where it was", dragged.shape.widthFt === 24 && dragged.house.rightFt === -4 && same(houseFromLeft(dragged), houseFromLeft(L)), { w: dragged.shape.widthFt, r: dragged.house.rightFt, house: houseFromLeft(dragged) });
  const sliver = resizeDeckRight(L.house, L.shape, 20.5, W[0], W[1]);
  check("…half a foot past the corner stops AT the corner", sliver.shape.widthFt === 20 && sliver.house.rightFt === 0, { w: sliver.shape.widthFt, r: sliver.house.rightFt });
  const two = resizeDeckRight(L.house, L.shape, 21.5, W[0], W[1]);
  check("…a foot and a half past goes the least 2 ft past", two.shape.widthFt === 22 && two.house.rightFt === -2, { w: two.shape.widthFt, r: two.house.rightFt });
  const back = dragRight(L, [20, 24, 20, 16]);
  check("…dragged out and back to where it started: the deck and the house as they were", back.shape.widthFt === 16 && back.house.rightFt === 4 && same(houseFromLeft(back), houseFromLeft(L)), { w: back.shape.widthFt, r: back.house.rightFt });
  const narrower = dragRight(L, [15, 14, 12]);
  check("…pushed in 4 ft: the wall takes it back, the house where it was", narrower.shape.widthFt === 12 && narrower.house.rightFt === 8 && same(houseFromLeft(narrower), houseFromLeft(L)), { w: narrower.shape.widthFt, r: narrower.house.rightFt });
  const still = resizeDeckRight(L.house, L.shape, 16, W[0], W[1]);
  check("…not moved: the same house and shape handed back", still.house === L.house && still.shape === L.shape);
  // A front in parts with a cut corner (the deck the bug was seen on): the lock holds the same.
  const shaped = normalizeDeckDesign({ ...L, shape: { kind: "wall", widthFt: 16, depthFt: 12, back: [{ x0Ft: 0, x1Ft: 16, yFt: 0 }], front: [{ x0Ft: 0, x1Ft: 3, yFt: 7 }, { x0Ft: 3, x1Ft: 16, yFt: 12, clipRightFt: 3 }] } });
  const shapedOut = dragRight(shaped, [17, 18.5, 20, 22, 24]);
  check("a shaped deck against a locked wall, its right side dragged out: 24 ft wide, the house where it was", shapedOut.shape.widthFt === 24 && shapedOut.house.rightFt === -4 && same(houseFromLeft(shapedOut), houseFromLeft(shaped)), { w: shapedOut.shape.widthFt, r: shapedOut.house.rightFt });
  // A house from its photo, not locked: the wall gives up what the deck took, from the drag's start.
  const photo = make(false, { rightFt: 6, photo: { url: "data:image/png;base64,x", w: 1200, h: 800, read: null, wallFt: 26, by: "width", deckAtFt: 4, at: "2026-11-15" } });
  const photoOut = dragRight(photo, [17, 18, 19, 20]);
  check("a photo's wall, not locked: 4 ft wider takes 4 ft of the wall past the end — the house where it was", photoOut.shape.widthFt === 20 && photoOut.house.rightFt === 2 && same(houseFromLeft(photoOut), houseFromLeft(photo)), { w: photoOut.shape.widthFt, r: photoOut.house.rightFt, photo: !!photo.house.photo });
  // A house drawn by rule, unlocked: as it was — the house keeps its reach past the deck's end.
  const rule = make(false, { rightFt: 4 });
  const ruleOut = resizeDeckRight(rule.house, rule.shape, 20, W[0], W[1]);
  check("a house by rule, unlocked: the house handed back untouched (it follows the deck's end, as before)", ruleOut.house === rule.house && ruleOut.shape.widthFt === 20);
}

console.log(bad ? `\n${bad} FAILED` : "\nALL PASS");
process.exit(bad ? 1 : 0);
