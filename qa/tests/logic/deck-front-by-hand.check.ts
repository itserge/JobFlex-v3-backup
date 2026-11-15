// THE DECK'S FRONT AND SIDES, SHAPED BY HAND ON THE PLAN (2026-11-14, lib/deck/frontByHand — the owner: "make the front
// and the sides of the deck reshape with the toggles in and out like the back wall works… any shape I want. Make it
// smart."): a section of the front pulled out or pushed in where it was grabbed, a part moved whole, a step moved
// along the deck, a side pushed in (the corner comes off square), an end resized with the other parts left where they
// are, a corner cut at an angle, a part levelled, the front made straight — every move ending on a deck the engine
// builds (the studio's own patch leaves it as it is). Pure.
//   NODE_PATH="" npx tsx --tsconfig tsconfig.json qa/tests/logic/deck-front-by-hand.check.ts
import { defaultDeckDesign, frontParts, shapeAreaSqFt, shapeOutline, type DeckDesign, type DeckShape } from "@/lib/deck/design";
import { patchDesign } from "@/lib/deck/edit";
import { buildStructure } from "@/lib/deck/structure";
import { deckChecks } from "@/lib/deck/checks";
import { deckScene, parseDeckScene } from "@/lib/deck/scene";
import { canShapeFront, clipFrontCorner, cutSideAt, frontCorners, frontIsShaped, frontPartWords, frontSpecs, frontWhyWords, leftEndPatch, levelFrontPart, moveFrontPart, moveFrontStep, pullFrontAt, removeFrontStep, resizeFrontEnd, straightFront } from "@/lib/deck/frontByHand";

let bad = 0;
const check = (name: string, ok: boolean, info: unknown = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || info === "" ? "" : `  — ${typeof info === "string" ? info : JSON.stringify(info)}`}`);
};
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
const rect = (widthFt: number, depthFt: number): DeckShape => ({ kind: "rect", widthFt, depthFt });
const d0 = defaultDeckDesign({ state: "WA" });
const design = (shape: DeckShape): DeckDesign => patchDesign(d0, { shape });
/** The front as "width@out" from the left, e.g. "8@12 8@16 8@12". */
const say = (s: DeckShape) => frontSpecs(s).map((q) => `${q.widthFt}@${q.yFt}${q.clipLeftFt ? `<${q.clipLeftFt}` : ""}${q.clipRightFt ? `>${q.clipRightFt}` : ""}`).join(" ");
const shapeOf = (r: ReturnType<typeof pullFrontAt> | ReturnType<typeof cutSideAt>): DeckShape => {
  if ("why" in r) throw new Error(`refused: ${r.why}`);
  return r.shape;
};
/** The studio's own patch leaves the shape exactly as the move made it: it is already buildable. */
const settled = (s: DeckShape) => JSON.stringify(design(s).shape) === JSON.stringify(s);

console.log("— the front pulled where it is grabbed —");
const r24 = rect(24, 12);
{
  const bay = shapeOf(pullFrontAt(r24, 12, 4));
  check("grabbed in the middle and pulled out 4 ft: a bay 8 ft wide comes out, 8 ft each side stay", say(bay) === "8@12 8@16 8@12" && bay.depthFt === 16, say(bay));
  check("…a deck the studio leaves as it is, with more floor than before", settled(bay) && shapeAreaSqFt(bay) === 24 * 12 + 8 * 4, shapeAreaSqFt(bay));
  const notch = shapeOf(pullFrontAt(r24, 12, -4));
  check("pushed in 4 ft there: a notch — a U", say(notch) === "8@12 8@8 8@12" && notch.depthFt === 12 && settled(notch), say(notch));
  const end = shapeOf(pullFrontAt(r24, 21, 3));
  check("grabbed near the deck's end: the section runs on to the end (no sliver beside it)", say(end) === "16@12 8@15" && settled(end), say(end));
  const start = shapeOf(pullFrontAt(r24, 1, 3));
  check("…and at the left end the same", say(start) === "8@15 16@12", say(start));
  const back = pullFrontAt(r24, 12, 0.2);
  check("a hand that has not gone half a foot changes nothing", !("why" in back) && back.shape === r24);
  const small = shapeOf(pullFrontAt(rect(6, 12), 3, 2));
  check("a deck too narrow to split moves its whole front: deeper", say(small) === "6@14" && small.kind === "rect" && small.depthFt === 14, small);
  const span = pullFrontAt(r24, 12, 4);
  check("the stretch that moved is told", !("why" in span) && near(span.span.x0Ft, 8) && near(span.span.x1Ft, 16));
}
{
  // On a front already in parts: the part under the hand is the one that splits.
  const bay = shapeOf(pullFrontAt(r24, 12, 4));
  const more = shapeOf(pullFrontAt(bay, 4, 2));
  check("on a front in parts the part under the hand is the one pulled (a short part grabbed in its middle moves whole)", say(more) === "8@14 8@16 8@12" && settled(more), say(more));
  const off = shapeOf(pullFrontAt(bay, 3, 2));
  check("…grabbed off its middle, the section runs to the nearer end and 3 ft stay", say(off) === "5@14 3@12 8@16 8@12" && settled(off), say(off));
  const flat = shapeOf(pullFrontAt(bay, 12, -4));
  check("a bay pushed back level with its neighbours: one straight front, a plain rectangle again", flat.kind === "rect" && flat.depthFt === 12 && say(flat) === "24@12", flat);
  // Eight parts at most.
  let s: DeckShape = rect(60, 12);
  for (const x of [4, 12, 20, 28]) s = shapeOf(pullFrontAt(s, x, x % 8 ? 3 : -3));
  const n = frontSpecs(s).length;
  const ninth = pullFrontAt(s, 52, 3);
  check("the front takes eight parts at most, and says so", n <= 8 && (n < 8 || ("why" in ninth && ninth.why === "parts")), { n, ninth: "why" in ninth ? ninth.why : say(ninth.shape) });
  check("…in words a contractor reads", /8 parts at most/.test(frontWhyWords("parts")) && /2 ft wide at least/.test(frontWhyWords("room")));
}

console.log("— a part moved whole, a step moved along the deck —");
{
  const bay = shapeOf(pullFrontAt(r24, 12, 4));
  const deeper = moveFrontPart(bay, 1, 2);
  check("the bay out 2 ft more: the deck is that much deeper", say(deeper) === "8@12 8@18 8@12" && deeper.depthFt === 18 && settled(deeper), say(deeper));
  const wing = moveFrontPart(bay, 0, -3);
  check("the left part in 3 ft: it stops short, the others stay", say(wing) === "8@9 8@16 8@12" && settled(wing), say(wing));
  check("a straight front moved is the deck's depth (a rectangle stays one)", JSON.stringify(moveFrontPart(r24, 0, 2)) === JSON.stringify(rect(24, 14)));
  const tooFar = moveFrontPart(bay, 0, -20);
  check("a part is never pushed closer than 3 ft to the wall behind it", frontSpecs(tooFar)[0].yFt >= 3 - 1e-9 && settled(tooFar), say(tooFar));
  const wider = moveFrontStep(bay, 0, 5);
  check("the bay's left side moved 3 ft left: the bay is wider, the part beside it narrower", say(wider) === "5@12 11@16 8@12" && settled(wider), say(wider));
  const held = moveFrontStep(bay, 0, 0.5);
  check("a step stops 2 ft from the deck's end", say(held) === "2@12 14@16 8@12", say(held));
  check("a step dragged nowhere changes nothing", moveFrontStep(bay, 0, 8) === bay && moveFrontStep(bay, 5, 3) === bay);
}

console.log("— a side pushed in, an end resized —");
{
  const cut = shapeOf(cutSideAt(r24, "left", 7, 4));
  check("the left side pushed in 4 ft, grabbed 7 ft out: from there to the front the deck stops 4 ft short", say(cut) === "4@7 20@12" && settled(cut), say(cut));
  check("…the stretch by the house stays the deck's full width", cut.widthFt === 24 && shapeOutline(cut).some((p) => p.x === 0 && p.y === 0) && shapeOutline(cut).some((p) => p.x === 0 && p.y === 84), shapeOutline(cut));
  const right = shapeOf(cutSideAt(r24, "right", 6, 5));
  check("the right side the same, mirrored", say(right) === "19@12 5@6" && settled(right), say(right));
  const least = shapeOf(cutSideAt(r24, "left", 7, 1));
  check("a cut is 2 ft wide at least", say(least) === "2@7 22@12", say(least));
  const nothing = cutSideAt(r24, "left", 7, 0.5);
  check("under a foot is no cut", !("why" in nothing) && nothing.shape === r24);
  const byFront = shapeOf(cutSideAt(r24, "left", 11.5, 4));
  check("grabbed at the front corner: the cut still goes 2 ft back from the front", say(byFront) === "4@10 20@12", say(byFront));
  const byHouse = cutSideAt(r24, "left", 1, 4);
  check("grabbed too near the house there is nothing to cut (that stretch hangs on the wall)", "why" in byHouse && byHouse.why === "room");
  const bay = shapeOf(pullFrontAt(r24, 12, 4));
  const whole = shapeOf(cutSideAt(bay, "left", 6, 7));
  check("a cut that leaves under 2 ft of the end part takes the whole part: its front stands where the hand was", say(whole) === "8@6 8@16 8@12" && settled(whole), say(whole));
}
{
  const bay = shapeOf(pullFrontAt(r24, 12, 4));
  const left = resizeFrontEnd(bay, "left", 20);
  check("the deck's LEFT end pulled in 4 ft: the left part is narrower, the bay and the right part as they were", say(left) === "4@12 8@16 8@12" && left.widthFt === 20 && settled(left), say(left));
  const leftOut = resizeFrontEnd(bay, "left", 30);
  check("…pulled out 6 ft: the left part is wider", say(leftOut) === "14@12 8@16 8@12", say(leftOut));
  const right = resizeFrontEnd(bay, "right", 20);
  check("the RIGHT end pulled in: the right part is narrower", say(right) === "8@12 8@16 4@12", say(right));
  const used = resizeFrontEnd(bay, "left", 17);
  check("an end part used up goes with the part beside it", say(used) === "9@16 8@12" && used.widthFt === 17 && settled(used), say(used));
  check("a plain deck just changes its width", JSON.stringify(resizeFrontEnd(r24, "left", 20)) === JSON.stringify(rect(20, 12)) && resizeFrontEnd(r24, "right", 24) === r24);
}

console.log("— corners cut at an angle, a part levelled, the front straight —");
{
  const c = clipFrontCorner(r24, 0, "left", 3);
  check("a rectangle's left corner cut 3 ft at an angle: one front with a cut corner", say(c) === "24@12<3" && settled(c), say(c));
  check("…and made square again: a plain rectangle", JSON.stringify(clipFrontCorner(c, 0, "left", 0)) === JSON.stringify(r24));
  check("under a foot is no cut", clipFrontCorner(r24, 0, "left", 0.5) === r24);
  const bay = shapeOf(pullFrontAt(r24, 12, 4));
  const both = clipFrontCorner(clipFrontCorner(bay, 1, "left", 2), 1, "right", 2);
  check("a bay's two corners cut", say(both) === "8@12 8@16<2>2 8@12" && settled(both), say(both));
  const inner = clipFrontCorner(bay, 0, "right", 2);
  check("a corner that does not stand out cannot be cut: it stays square", say(inner) === say(bay), say(inner));
  const corners = frontCorners(bay);
  check("the corners are told, with which stand out", corners.length === 6 && corners.filter((k) => k.out).map((k) => `${k.part}${k.side[0]}`).join(" ") === "0l 1l 1r 2r", corners.map((k) => `${k.part}${k.side[0]}${k.out ? "!" : ""}`).join(" "));
  const kept = shapeOf(pullFrontAt(c, 12, 4));
  check("a section pulled out of a front with a cut corner: the cut stays at its end", say(kept) === "8@12<3 8@16 8@12", say(kept));
  const clipped: DeckShape = { kind: "rect", widthFt: 24, depthFt: 12, front: { kind: "clipped", bulgeFt: 2, clipFt: 3 } };
  check("a rectangle with clipped corners keeps them when its front is pulled", say(shapeOf(pullFrontAt(clipped, 12, 4))) === "8@12<3 8@16 8@12>3", say(shapeOf(pullFrontAt(clipped, 12, 4))));
  check("the bay levelled: one straight front", levelFrontPart(bay, 1).kind === "rect" && say(levelFrontPart(bay, 1)) === "24@12");
  const stepped = moveFrontPart(bay, 0, -3);
  check("a part levelled goes to the nearer of its two neighbours", say(levelFrontPart(stepped, 2)) === "8@9 16@16", say(levelFrontPart(stepped, 2)));
  check("a step taken away: the narrower part goes to the wider one's line", say(removeFrontStep(moveFrontStep(bay, 0, 5), 0)) === "16@16 8@12" && say(removeFrontStep(stepped, 1)) === "8@9 16@16" && removeFrontStep(bay, 7) === bay, say(removeFrontStep(moveFrontStep(bay, 0, 5), 0)));
  check("Straight front: the deepest part's line, corners square", JSON.stringify(straightFront(both)) === JSON.stringify(rect(24, 16)) && straightFront(r24) === r24);
  check("what is shaped is told", !frontIsShaped(r24) && frontIsShaped(bay) && frontIsShaped(c) && frontIsShaped(clipped));
  check("a part in words", frontPartWords(frontSpecs(both)[1]) === "8 ft wide · 16 ft out from the house · left corner cut 2 ft, right corner cut 2 ft", frontPartWords(frontSpecs(both)[1]));
}

console.log("— the other shapes —");
{
  const L: DeckShape = { kind: "L", widthFt: 20, depthFt: 14, notch: { corner: "front-right", widthFt: 8, depthFt: 6 } };
  check("an L cut at the front is a front in two parts", say(L) === "12@14 8@8" && canShapeFront(L));
  const pulled = shapeOf(pullFrontAt(L, 16, 2));
  check("…its short part pulled out 2 ft", say(pulled) === "12@14 8@10" && settled(pulled), say(pulled));
  const backL: DeckShape = { kind: "L", widthFt: 20, depthFt: 14, notch: { corner: "back-left", widthFt: 8, depthFt: 6 } };
  const refused = pullFrontAt(backL, 10, 3);
  check("a deck cut at the BACK is not shaped here, and says where it is", !canShapeFront(backL) && "why" in refused && refused.why === "back-notch" && /step 2/.test(frontWhyWords("back-notch")) && moveFrontStep(backL, 0, 5) === backL && clipFrontCorner(backL, 0, "left", 3) === backL);
  const bow: DeckShape = { kind: "rect", widthFt: 24, depthFt: 12, front: { kind: "curve", bulgeFt: 3, clipFt: 2 } };
  check("a bowed front pulled becomes a front in parts (the bow is what the parts replace)", say(shapeOf(pullFrontAt(bow, 12, 4))) === "8@12 8@16 8@12");
}

console.log("— the deck's left end: the plan's handle and the 3D's knob —");
{
  // (The owner, 2026-11-14: "on the 3D there is no toggle on the left side that moves the left side of the deck.")
  const bay = shapeOf(pullFrontAt(r24, 12, 4));
  const d = design(bay);
  const narrower = leftEndPatch(d, 20);
  check("the left end pulled in 4 ft: the house reaches 4 ft farther past it, the left part is 4 ft narrower, the rest as it was", !!narrower && narrower.house.leftFt === d.house.leftFt + 4 && say(narrower.shape) === "4@12 8@16 8@12", narrower && { leftFt: narrower.house.leftFt, front: say(narrower.shape) });
  const wider = leftEndPatch(d, 26);
  check("…pulled out 2 ft: the deck is wider at that end, the house where it was", !!wider && wider.house.leftFt === d.house.leftFt - 2 && say(wider.shape) === "10@12 8@16 8@12" && wider.house.rightFt === d.house.rightFt, wider && { leftFt: wider.house.leftFt, front: say(wider.shape) });
  check("the same width is no change", leftEndPatch(d, 24) === null);
  const applied = patchDesign(d, narrower!);
  check("…and the studio keeps it as it was made", say(applied.shape) === "4@12 8@16 8@12" && applied.house.leftFt === d.house.leftFt + 4, say(applied.shape));
  const scene = deckScene(buildStructure(d));
  const left = scene.handles.find((h) => h.kind === "width-left");
  const right = scene.handles.find((h) => h.kind === "width");
  check("Edit in 3D: a Width knob at the deck's left end as at its right", !!left && !!right && left.x === 0 && right.x === 24 && left.axis === "x" && left.value === 24 && left.follow === -1 && left.y > 0 && left.y < 12, left);
  const back = parseDeckScene(JSON.parse(JSON.stringify(scene)));
  check("…kept when a saved scene is read back, travelling the way it did", back?.handles.find((h) => h.kind === "width-left")?.follow === -1);
  const yard = deckScene(buildStructure(patchDesign(d0, { placement: "detached" })));
  check("a deck in the yard has no house to stay put against: its one Width knob", !yard.handles.some((h) => h.kind === "width-left") && yard.handles.some((h) => h.kind === "width"));
}

console.log("— any shape the hand makes is a deck the engine builds —");
{
  let seed = 20261114;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  let unsettled = 0;
  let broken = 0;
  let outside = 0;
  let thrown = 0;
  const firstBad: string[] = [];
  for (let n = 0; n < 300; n++) {
    let s: DeckShape = rect(8 + Math.floor(rnd() * 40), 8 + Math.floor(rnd() * 16));
    for (let m = 0; m < 6; m++) {
      const k = Math.floor(rnd() * 7);
      const W = s.widthFt;
      const parts = frontSpecs(s);
      const i = Math.floor(rnd() * parts.length);
      const by = Math.round((rnd() * 12 - 6) * 2) / 2;
      let next: DeckShape = s;
      if (k === 0) {
        const r = pullFrontAt(s, rnd() * W, by);
        if (!("why" in r)) next = r.shape;
      } else if (k === 1) next = moveFrontPart(s, i, by);
      else if (k === 2) next = moveFrontStep(s, Math.min(i, parts.length - 2), rnd() * W);
      else if (k === 3) {
        const r = cutSideAt(s, rnd() < 0.5 ? "left" : "right", rnd() * s.depthFt, rnd() * 8);
        if (!("why" in r)) next = r.shape;
      } else if (k === 4) next = resizeFrontEnd(s, rnd() < 0.5 ? "left" : "right", W + by);
      else if (k === 5) next = clipFrontCorner(s, i, rnd() < 0.5 ? "left" : "right", rnd() * 6);
      else next = levelFrontPart(s, i);
      s = next;
      try {
        const d = design(s);
        if (JSON.stringify(d.shape) !== JSON.stringify(s)) {
          unsettled++;
          if (firstBad.length < 3) firstBad.push(`${say(s)} → ${say(d.shape)}`);
        }
        const front = frontParts(d.shape);
        if (Math.abs(front[front.length - 1].x1Ft - d.shape.widthFt) > 1e-6 || front.some((q) => q.x1Ft - q.x0Ft < 2 - 1e-6 || q.yFt < 3 - 1e-6 || q.yFt > d.shape.depthFt + 1e-6)) broken++;
        const st = buildStructure(d);
        deckChecks(st);
        const ys = shapeOutline(d.shape).map((p) => p.y);
        const xs = shapeOutline(d.shape).map((p) => p.x);
        if (st.frame && st.frame.posts.some((p) => p.x < Math.min(...xs) - 1 || p.x > Math.max(...xs) + 1 || p.y > Math.max(...ys) + 1)) outside++;
      } catch (e) {
        thrown++;
        if (firstBad.length < 3) firstBad.push(`${say(s)}: ${(e as Error).message}`);
      }
    }
  }
  check("300 decks shaped by six moves each: every one is already as the studio would keep it", unsettled === 0, firstBad);
  check("…its parts tile the width, each 2 ft wide and 3 ft deep at least", broken === 0);
  check("…it frames and checks without an error, no post outside the deck", thrown === 0 && outside === 0, { thrown, outside, firstBad });
}

console.log(bad ? `\n${bad} FAILED` : "\nALL PASS");
process.exit(bad ? 1 : 0);
