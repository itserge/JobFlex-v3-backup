// A DOUBLE DECK SHAPED LEVEL BY LEVEL (2026-11-14, lib/deck/doubleDeck) — the owner: "when it's a double deck and I
// need to reshape the upper deck, then on the drawing show lower / upper to reshape it and adjust it … for now, when I
// reshape it from the map, it's reshaping the lower, but we need to do the same thing with the upper."
// The lower floor of a double deck keeps the upper's outline until it is shaped on its own; then it has its own
// outline and place along the house, its beams on the upper deck's lines where they pass over it (seated in the
// upper's posts that stand inside it) and on beams and posts of its own beyond. The wall drawing's two modes — what a
// drag does to the design — and the plan, the checks, the price and the permit's words.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/deck-double-shapes.check.ts
import { defaultDeckDesign, normalizeDeckDesign, type DeckDesign, type DeckShape } from "@/lib/deck/design";
import { buildStructure, structureLevels } from "@/lib/deck/structure";
import { applyDeckPatch, deckChecks } from "@/lib/deck/checks";
import { deckScope, priceDeck } from "@/lib/deck/pricing";
import { deckScene } from "@/lib/deck/scene";
import { houseForLower, lowerFloor, lowerSharing, lowerWallChange, upperWallChange } from "@/lib/deck/doubleDeck";
import { resizeDeckLeft, slideDeck } from "@/lib/deck/house";
import { permitNotes } from "@/lib/deck/permit";

let bad = 0;
const check = (name: string, ok: boolean, detail: unknown = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || detail === "" ? "" : ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
};
const d0 = defaultDeckDesign({ state: "WA" });
const rect = (w: number, d: number): DeckShape => ({ kind: "rect", widthFt: w, depthFt: d });
const base = normalizeDeckDesign({ ...d0, shape: rect(16, 10), heightIn: 120, house: { ...d0.house, leftFt: 8, rightFt: 8, jogs: [] }, lower: { on: true, place: "under", heightIn: 18 } });
const withLower = (shape: DeckShape | null, offsetFt = 0): DeckDesign => normalizeDeckDesign({ ...base, lower: { ...base.lower, ...(shape ? { shape, offsetFt } : {}) } });

// ── the model ───────────────────────────────────────────────────────────────────────────────────────────────────────
{
  check("a double deck as it was: the lower floor is the upper's outline (no shape of its own)", !lowerFloor(base).own && base.lower.shape === undefined && lowerFloor(base).shape === base.shape);
  const own = withLower(rect(16, 16));
  check("shaped on its own: kept, its width and depth its own", lowerFloor(own).own && own.lower.depthFt === 16 && own.lower.widthFt === 16);
  check("the upper's own outline at the upper's place is no shape of its own (it follows the upper again)", withLower(rect(16, 10), 0).lower.shape === undefined);
  check("…but the same outline slid along the house is", withLower(rect(16, 10), 2).lower.shape !== undefined && withLower(rect(16, 10), 2).lower.offsetFt === 2);
  check("its place keeps it under the upper deck by four feet at least", withLower(rect(10, 10), 40).lower.offsetFt === 12 && withLower(rect(10, 10), -40).lower.offsetFt === -6, [withLower(rect(10, 10), 40).lower.offsetFt, withLower(rect(10, 10), -40).lower.offsetFt]);
  check("a lower level IN FRONT keeps no shape of its own", normalizeDeckDesign({ ...base, heightIn: 30, lower: { on: true, place: "front", shape: rect(8, 8), offsetFt: 2 } }).lower.shape === undefined);
  check("a saved design reads back the same", JSON.stringify(normalizeDeckDesign(JSON.parse(JSON.stringify(own))).lower) === JSON.stringify(own.lower));
}

// ── framed under the upper deck ─────────────────────────────────────────────────────────────────────────────────────
{
  const same = buildStructure(base);
  check("the same outline: framed on the upper's lines, seated in its posts, no posts of its own (as before)", same.lower!.frame.posts.length === 0 && same.lower!.frame.seats.length === same.frame!.posts.length);
  const deeper = withLower(rect(16, 16));
  const s = buildStructure(deeper);
  const up = s.frame!, lo = s.lower!.frame;
  const upFront = up.beams.find((b) => b.role === "front")!;
  const shared = lo.beams.find((b) => Math.abs(b.y - upFront.y) < 6);
  check("deeper than the upper: a beam of the lower floor runs on the upper deck's front line", !!shared && shared.role === "middle", lo.beams.map((b) => `${b.role}@${Math.round(b.y)}`));
  check("…seated in each of the upper's posts on it — no post of its own there", up.posts.filter((p) => !p.roof).every((p) => lo.seats.some((q) => Math.abs(q.x - p.x) <= 6 && Math.abs(q.y - p.y) <= 6)) && !lo.posts.some((p) => Math.abs(p.y - upFront.y) < 6), { seats: lo.seats, posts: lo.posts.map((p) => [p.x, p.y]) });
  check("…a beam that spans from one of the upper's posts to the next (no posts squeezed between)", !!shared && shared.postXs.length <= up.posts.filter((p) => !p.roof && Math.abs(p.y - upFront.y) < 6).length + 2, shared?.postXs);
  check("…its own front beam beyond, on posts and footings of its own", lo.beams.some((b) => b.role === "front" && b.y > upFront.y + 24) && lo.posts.length > 0 && lo.posts.every((p) => p.footing && p.y > upFront.y + 24));
  check("…its whole area is built: 16 x 16 ft", lo.areaSqFt === 256, lo.areaSqFt);
  const wider = buildStructure(withLower(rect(24, 14), -4));
  check("wider and to the left: drawn there (4 ft left of the upper's left end)", wider.lower!.offsetXIn === -48 && structureLevels(wider).some((l) => l.id === "lower" && l.offsetXIn === -48));
  check("…seated in the upper's posts where they stand inside it, on its own posts past them", wider.lower!.frame.seats.length >= 3 && wider.lower!.frame.posts.length > 0);
  const share = lowerSharing(up, { shape: rect(10, 8), offsetFt: 3 });
  check("a lower floor too shallow to reach the upper's beam line shares none of it", share.beamLines.length === 0 && share.seatOn.length === 0);
}

// ── said ────────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const d = withLower(rect(16, 16));
  const s = buildStructure(d);
  const c = deckChecks(s).find((x) => x.id === "double-deck");
  check("the check says it is shaped on its own, where it shares the upper's posts and where it stands on its own", !!c && /the lower one shaped on its own/.test(c.text) && /seats?, two 1\/2-in\. through bolts each/.test(c.text) && /posts? of its own, each on its own footing/.test(c.text), c?.text);
  check("no check fails for it", !deckChecks(s).some((x) => x.level === "fail"), deckChecks(s).filter((x) => x.level === "fail").map((x) => x.id));
  const notes = permitNotes(s).join(" ");
  check("the permit's notes say its own outline and how it is framed", /its own outline, 16 ft × 16 ft/.test(notes) && /on posts of its own elsewhere/.test(notes), notes.match(/Double deck:[^.]*\./)?.[0]);
  const p1 = priceDeck(base), p2 = priceDeck(d);
  check("the bigger lower floor costs more", p2.subtotal > p1.subtotal, [p1.subtotal, p2.subtotal]);
  check("the scope says it in plain words — its own size, the shared posts, its own posts", deckScope(p2).some((n) => /A double deck: a second deck under it shaped on its own — 16'-0" × 16'-0", 256 sq ft/.test(n) && /posts of its own elsewhere/.test(n)) && deckScope(p1).some((n) => /a second deck of the same size under it/.test(n)), deckScope(p2).find((n) => /double deck/i.test(n)));
  const sc = deckScene(s);
  check("the 3D draws it", !!sc && JSON.stringify(sc).length > 0);
}

// ── the wall drawing: Lower deck ────────────────────────────────────────────────────────────────────────────────────
{
  const d = withLower(rect(16, 10));
  const lf = lowerFloor(d);
  const hL = houseForLower(d.house, d.shape.widthFt, lf);
  check("the drawing in Lower mode starts from the upper's outline and the same house", JSON.stringify(lf.shape) === JSON.stringify(d.shape) && hL.leftFt === d.house.leftFt && hL.rightFt === d.house.rightFt);
  // its front pulled out to 16 ft
  const deeper = applyDeckPatch(d, lowerWallChange(d, { shape: rect(16, 16) }));
  check("its front pulled out: the lower floor is 16 ft deep, the upper still 10", deeper.lower.shape?.depthFt === 16 && deeper.shape.depthFt === 10 && JSON.stringify(deeper.house) === JSON.stringify(d.house));
  // slid 3 ft right along the house
  const lf2 = lowerFloor(deeper);
  const slid = applyDeckPatch(deeper, lowerWallChange(deeper, { house: slideDeck(houseForLower(deeper.house, deeper.shape.widthFt, lf2), 3) }));
  check("slid 3 ft along the house: its place moves, the house and the upper deck stay", slid.lower.offsetFt === 3 && slid.house.leftFt === d.house.leftFt && slid.house.rightFt === d.house.rightFt && slid.shape.widthFt === 16, { off: slid.lower.offsetFt, house: [slid.house.leftFt, slid.house.rightFt] });
  // its left end pulled 4 ft out
  const lf3 = lowerFloor(slid);
  const r = resizeDeckLeft(houseForLower(slid.house, slid.shape.widthFt, lf3), lf3.shape, lf3.shape.widthFt + 4, 4, 60);
  const wide = applyDeckPatch(slid, lowerWallChange(slid, r));
  check("its left end pulled 4 ft out: 20 ft wide, its left end 1 ft left of the upper's, the house still", wide.lower.shape?.widthFt === 20 && wide.lower.offsetFt === -1 && wide.house.leftFt === d.house.leftFt, { w: wide.lower.shape?.widthFt, off: wide.lower.offsetFt });
  // the house's own end dragged in Lower mode: the house changes, the lower floor stays
  const lf4 = lowerFloor(wide);
  const hl4 = houseForLower(wide.house, wide.shape.widthFt, lf4);
  const end = applyDeckPatch(wide, lowerWallChange(wide, { house: { ...hl4, rightFt: hl4.rightFt + 2 } }));
  check("the house's own end dragged in Lower mode: the house grows, the lower floor stays where it is", end.house.rightFt === wide.house.rightFt + 2 && end.lower.offsetFt === wide.lower.offsetFt, { right: [wide.house.rightFt, end.house.rightFt], off: end.lower.offsetFt });
  // a step added to the wall in Lower mode lands in the right place in the upper's feet
  const step = applyDeckPatch(wide, lowerWallChange(wide, { house: { ...hl4, jogs: [{ id: "j1", atFt: 5, dir: "toward", depthFt: 2 }] } }));
  check("a step added in Lower mode stands where it was drawn (5 ft from the lower floor's left end = 4 ft from the upper's)", step.house.jogs.length === 1 && step.house.jogs[0].atFt === 4 && step.lower.offsetFt === wide.lower.offsetFt, step.house.jogs);
  // back to the upper's outline
  const sameAgain = applyDeckPatch(wide, { lower: { ...wide.lower, shape: undefined, offsetFt: undefined } });
  check("“Same as the upper”: the lower floor follows the upper again", !lowerFloor(sameAgain).own);
}

// ── the wall drawing: Upper deck ────────────────────────────────────────────────────────────────────────────────────
{
  const d = withLower(rect(20, 14), -2);
  const slid = applyDeckPatch(d, upperWallChange(d, { house: slideDeck(d.house, 3) }));
  check("the upper deck slid 3 ft right: the lower floor of its own stays where it is (its place 3 ft farther left of the upper's end)", slid.lower.offsetFt === -5 && slid.lower.shape?.widthFt === 20, slid.lower.offsetFt);
  const r = resizeDeckLeft(d.house, d.shape, d.shape.widthFt - 2, 4, 60);
  const narrower = applyDeckPatch(d, upperWallChange(d, r));
  check("the upper's left end pulled in 2 ft: the lower floor stays where it is", narrower.shape.widthFt === 14 && narrower.lower.offsetFt === -4, narrower.lower.offsetFt);
  const deeper = applyDeckPatch(d, upperWallChange(d, { shape: rect(16, 12) }));
  check("the upper's front pulled out: the lower floor keeps its own shape and place", deeper.shape.depthFt === 12 && deeper.lower.shape?.depthFt === 14 && deeper.lower.offsetFt === -2);
  const follows = applyDeckPatch(base, upperWallChange(base, { shape: rect(16, 13), house: slideDeck(base.house, 2) }));
  check("a lower floor that follows the upper: reshaped and moved with it", !lowerFloor(follows).own && follows.lower.depthFt === 13);
}

console.log(bad ? `\n${bad} FAILED` : "\nALL PASS");
process.exit(bad ? 1 : 0);
