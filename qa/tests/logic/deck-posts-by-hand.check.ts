// THE DECK'S OWN POSTS BY HAND (2026-11-13, lib/deck/frame + design.framing.pins / .postSpacingFt) — a deck builder:
// "let me add and position posts, and adjust their spacing." The posts under a beam stood only where the layout put
// them. A builder can now stand a post under a beam at a place of their own, slide one, add one, and set the widest
// spacing — and the beam still stands on every post its table and its ends ask for: a span longer than the table
// allows takes a post in its middle, an end that would run more than a quarter of the next span (2 ft at most) past
// its last post takes an end post. Worked on a 16 x 12 ft deck, 36 in. up: a 4x10 beam, posts 12 / 96 / 180 in.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/deck-posts-by-hand.check.ts
import { DECK_POST_LIMITS, defaultDeckDesign, normalizeDeckDesign, type DeckDesign, type DeckPostPin } from "../../../src/lib/deck/design";
import { buildStructure } from "../../../src/lib/deck/structure";
import { priceDeck } from "../../../src/lib/deck/pricing";
import { applyDeckPatch, deckChecks } from "../../../src/lib/deck/checks";
import { deckScene } from "../../../src/lib/deck/scene";
import { partAt, partCard, tryChoice } from "../../../src/lib/deck/parts";
import { AUTO_FIX, settleDesign } from "../../../src/lib/deck/settle";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};
const d0 = defaultDeckDesign({ state: "WA" });
const mk = (framing: Record<string, unknown> = {}, over: Record<string, unknown> = {}): DeckDesign => normalizeDeckDesign({ ...d0, shape: { kind: "rect", widthFt: 16, depthFt: 12 }, heightIn: 36, ...over, framing: { ...d0.framing, ...framing } });
const pin = (id: string, atFt: number, beam: DeckPostPin["beam"] = "front"): DeckPostPin => ({ id, beam, atFt });
const frameOf = (d: DeckDesign) => buildStructure(d).frame!;
const xs = (d: DeckDesign, k = 0) => frameOf(d).beams[k].postXs.map((x) => Math.round(x));
const loud = (d: DeckDesign) => deckChecks(buildStructure(d)).filter((c) => /^(beam-|post-area|post-height)/.test(c.id) && c.level !== "pass").map((c) => `${c.level}:${c.id}`);

console.log("── a post where the builder wants it");
const auto = mk();
check("left alone, the layout is the one it always was: posts 1, 8 and 15 ft along a 16-ft beam", xs(auto).join() === "12,96,180" && frameOf(auto).postsByHand.length === 0);
const one = mk({ pins: [pin("a", 5)] });
const f1 = frameOf(one);
check("a post at 5 ft: there it stands, marked as the builder's", f1.posts.some((p) => p.by?.id === "a" && Math.round(p.x) === 60) && xs(one).includes(60), xs(one).join());
check("…the beam's ends keep their posts and the 10-ft span it left takes one in its middle: 12 / 60 / 120 / 180", xs(one).join() === "12,60,120,180" && f1.postsByHand[0].mine === 1 && f1.postsByHand[0].added === 3, JSON.stringify(f1.postsByHand));
check("…every span inside the beam's table, every end inside a quarter of the span beside it: no beam or post check fails", loud(one).length === 0 && f1.beams[0].spanIn <= f1.beams[0].maxSpanIn + 0.01 && f1.beams[0].endIn <= f1.beams[0].spanIn / 4 + 0.01, loud(one).join());
const three = mk({ pins: [pin("a", 2), pin("b", 8), pin("c", 14)] });
check("posts at 2, 8 and 14 ft: all three stand; each end, 2 ft past its post with 6-ft spans (a quarter is 18 in.), takes an end post", [24, 96, 168].every((x) => xs(three).includes(x)) && xs(three).length === 5 && loud(three).length === 0, xs(three).join());
const close = mk({ pins: [pin("a", 6), pin("b", 7)] });
check("two posts a foot apart in the middle: both stand, and the beam still gets its ends and its spans", [72, 84].every((x) => xs(close).includes(x)) && loud(close).length === 0 && frameOf(close).beams[0].spanIn <= frameOf(close).beams[0].maxSpanIn + 0.01, xs(close).join());
check("each post set by hand stands on a footing of its own and carries its share of the deck", f1.posts.filter((p) => !p.roof).every((p) => p.footing.padIn > 0 && p.tributarySqFt > 0) && Math.abs(f1.posts.reduce((a, p) => a + p.tributarySqFt, 0) - frameOf(auto).posts.reduce((a, p) => a + p.tributarySqFt, 0)) < 0.5);
check("the price counts the posts that stand: one more post, one more footing", priceDeck(one).subtotal > priceDeck(auto).subtotal);
const said = deckChecks(buildStructure(one)).find((c) => c.id === "deck-posts-set-b1");
check("the checks say it: 1 post by hand, 3 more where the spans and the ends need them", said?.level === "pass" && /1 post under the front beam set by hand; 3 more posts stand where its spans and its ends need them/.test(said.text), JSON.stringify(said));

console.log("── the spacing");
const tight = mk({ postSpacingFt: 4 });
check("posts no farther apart than 4 ft: every span 4 ft or less, more posts than the table alone asked for", frameOf(tight).beams[0].spanIn <= 48.01 && xs(tight).length > xs(auto).length && deckChecks(buildStructure(tight)).some((c) => c.id === "deck-post-spacing" && c.level === "pass"), `${xs(tight).join()} span ${frameOf(tight).beams[0].spanIn}`);
check("a spacing wider than the beam's table never takes a post away", xs(mk({ postSpacingFt: 14 })).join() === xs(auto).join());
check("with posts set by hand too, the spacing still holds between them", frameOf(mk({ postSpacingFt: 4, pins: [pin("a", 5)] })).beams[0].spanIn <= 48.01 && xs(mk({ postSpacingFt: 4, pins: [pin("a", 5)] })).includes(60));

console.log("── which beam");
const free = mk({ pins: [pin("a", 12, "back")] }, { shape: { kind: "rect", widthFt: 24, depthFt: 14 }, placement: "beside" });
const ff = frameOf(free);
check("a free-standing deck: a post under its BACK beam stands there; the front beam is as it was", ff.beams.find((b) => b.role === "back")!.postXs.some((x) => Math.round(x) === 144) && ff.posts.some((p) => p.by?.id === "a") && ff.beams.find((b) => b.role === "front")!.postXs.join() === frameOf(mk({}, { shape: { kind: "rect", widthFt: 24, depthFt: 14 }, placement: "beside" })).beams.find((b) => b.role === "front")!.postXs.join());
const none = mk({ pins: [pin("a", 5, "back")] });
const miss = deckChecks(buildStructure(none)).find((c) => /^deck-post-not-set/.test(c.id));
check("a post asked under a back beam on a deck hung on the house: not placed, said, with the way to take it off", frameOf(none).pinsNotSet.length === 1 && xs(none).join() === xs(auto).join() && miss?.level === "info" && /hangs on the house/.test(miss.text) && applyDeckPatch(none, miss.fix!.patch).framing.pins.length === 0);
const low = mk({ pins: [pin("a", 5)] }, { lower: { on: true, widthFt: 12, depthFt: 8, dropIn: 14, align: "centre" } });
check("the lower level's posts follow its own beams: a post set by hand on the deck is not set on it", !buildStructure(low).lower!.frame.posts.some((p) => p.by) && buildStructure(low).lower!.frame.postsByHand.length === 0);

console.log("── in the 3D: slide, add, take off");
const st = buildStructure(auto);
const sc = deckScene(st);
const mid = st.frame!.posts.find((p) => Math.round(p.x) === 96)!;
const box = sc.boxes.findIndex((b, i) => sc.legend[sc.tags[i]]?.role === "post" && Math.abs(b[1] * 12 - mid.x) < 0.7 && Math.abs(b[2] * 12 - mid.y) < 0.7);
const card = partCard(st, partAt(st, sc, box)!);
const ids = card.choices.map((c) => c.id);
check("click a post: slide it a foot either way, or add a post under its beam", ["pin-slide--12", "pin-slide-12", "pin-add"].every((id) => ids.includes(id)), ids.join());
const slid = tryChoice(auto, card.choices.find((c) => c.id === "pin-slide-12")!).design;
check("…slid a foot to the right: it stands at 9 ft, the end posts where they were — all three now the builder's; the span it widened to 8 ft is past the beam's 7'-5\", so a post stands in its middle", xs(slid).join() === "12,60,108,180" && frameOf(slid).posts.filter((p) => p.by).length === 3 && loud(slid).length === 0, xs(slid).join());
const added = tryChoice(auto, card.choices.find((c) => c.id === "pin-add")!).design;
check("…a post added: in the middle of the longest span — 12 / 54 / 96 / 180, four posts under the beam and no stray one at its end", xs(added).join() === "12,54,96,180" && frameOf(added).posts.filter((p) => p.by).length === 4 && loud(added).length === 0, xs(added).join());
const st2 = buildStructure(slid);
const sc2 = deckScene(st2);
const moved = st2.frame!.posts.find((p) => Math.round(p.x) === 108)!;
const box2 = sc2.boxes.findIndex((b, i) => sc2.legend[sc2.tags[i]]?.role === "post" && Math.abs(b[1] * 12 - moved.x) < 0.7 && Math.abs(b[2] * 12 - moved.y) < 0.7);
const card2 = partCard(st2, partAt(st2, sc2, box2)!);
const off = tryChoice(slid, card2.choices.find((c) => c.id === "pin-off")!).design;
check("…take the slid post off: the 14-ft span it leaves is past the beam's table, so a post stands in its middle — the beam is never left short", /set by hand/.test(card2.choices.find((c) => c.id === "pin-off")!.label) && !frameOf(off).posts.some((p) => Math.round(p.x) === 108 && p.by) && frameOf(off).beams[0].spanIn <= frameOf(off).beams[0].maxSpanIn + 0.01 && loud(off).length === 0, xs(off).join());

console.log("── kept, and the studio's own fixes leave it alone");
const saved = normalizeDeckDesign(JSON.parse(JSON.stringify(mk({ pins: [pin("a", 5), pin("b", 11.5, "middle")], postSpacingFt: 6 }))));
check("kept through a save: the posts, their beams, the spacing", JSON.stringify(saved.framing.pins) === JSON.stringify([pin("a", 5), pin("b", 11.5, "middle")]) && saved.framing.postSpacingFt === 6);
const junk = normalizeDeckDesign({ ...auto, framing: { ...auto.framing, pins: [null, 4, { atFt: "x" }, { atFt: 5, beam: "side" }, { id: "a", atFt: 6 }, { id: "a", atFt: 7 }, { atFt: -3 }, ...new Array(40).fill({ atFt: 3 })], postSpacingFt: 99 } });
check("junk is not kept: no place, no post; an unknown beam is the front; no two with one id; no more than the list holds; the spacing inside its limits", junk.framing.pins.length === DECK_POST_LIMITS.pins && junk.framing.pins[0].beam === "front" && new Set(junk.framing.pins.map((p) => p.id)).size === junk.framing.pins.length && junk.framing.pins.every((p) => p.atFt >= 0) && junk.framing.postSpacingFt === DECK_POST_LIMITS.spacingFt.max);
check("an old design, saved before any of this, is framed as it was", JSON.stringify(frameOf(normalizeDeckDesign(JSON.parse(JSON.stringify({ ...auto, framing: { ...auto.framing, pins: undefined, postSpacingFt: undefined } })))).posts) === JSON.stringify(frameOf(auto).posts));
check("these checks are the builder's: the studio's auto-fix never touches them, and settling keeps the posts", ["deck-posts-set-b1", "deck-post-spacing", "deck-post-not-set-1"].every((id) => !AUTO_FIX.test(id)) && JSON.stringify(settleDesign(three).design.framing.pins) === JSON.stringify(three.framing.pins));

console.log(bad ? `\n${bad} FAILED` : "\nALL PASS");
if (bad) process.exit(1);
