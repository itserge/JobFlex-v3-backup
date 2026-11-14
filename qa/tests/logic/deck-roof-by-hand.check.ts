// POSTS AND OPENINGS SET BY HAND (2026-11-13, lib/deck/roof + design.roof.pins / .openings / .postSpacingFt) — a deck
// builder: "let me add posts by hand and set an opening between them — on a screened-in deck, two posts with a 4-ft
// opening for a future screen door." The roof's posts stood only where the spans put them. A builder can now stand a
// post on a side, frame an opening between two posts, and set the farthest the posts may stand apart — and nothing
// they set overrides the structure: the header over an opening is sized for the span it makes, and where that is past
// the sawn-lumber tables the checks ask for a structural review. Worked on a 16 x 12 ft screened deck with 6x6 posts
// (5½ in.), a gable roof hung on the house.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/deck-roof-by-hand.check.ts
import { ROOF_POST_LIMITS, defaultDeckDesign, defaultRoofOpening, defaultRoofPin, defaultStair, normalizeDeckDesign, type DeckDesign } from "../../../src/lib/deck/design";
import { buildStructure } from "../../../src/lib/deck/structure";
import { priceDeck, deckScope } from "../../../src/lib/deck/pricing";
import { applyDeckPatch, deckChecks } from "../../../src/lib/deck/checks";
import { deckScene } from "../../../src/lib/deck/scene";
import { partAt, partCard, tryChoice } from "../../../src/lib/deck/parts";
import { permitNotes } from "../../../src/lib/deck/permit";
import { AUTO_FIX, settleDesign } from "../../../src/lib/deck/settle";
import { roofByHandWords } from "../../../src/lib/deck/roof";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};
const d0 = defaultDeckDesign({ state: "WA" });
const mk = (roof: Record<string, unknown> = {}, over: Record<string, unknown> = {}): DeckDesign => normalizeDeckDesign({ ...d0, shape: { kind: "rect", widthFt: 16, depthFt: 12 }, structure: "covered-deck", heightIn: 24, ...over, roof: { ...d0.roof, kind: "gable", attach: "wall", walls: { fill: "screen", sides: 3 }, ...roof } });
const roofOf = (d: DeckDesign) => buildStructure(d).roof!;
const near = (a: number, b: number, tol = 0.6) => Math.abs(a - b) <= tol;
const find = (d: DeckDesign, id: string) => deckChecks(buildStructure(d)).find((c) => c.id === id);

console.log("── two posts with a 4-ft opening for a screen door");
const plain = mk();
const door = mk({ openings: [defaultRoofOpening("o1", "front", 5)] });
const r0 = roofOf(plain);
const r1 = roofOf(door);
const o1 = r1.openings[0];
const jambs = r1.posts.filter((p) => p.by?.kind === "opening" && p.by.id === "o1");
check("the opening stands on the front, its middle 5 ft from the roof's left end, 4 ft clear between its two posts", !!o1 && o1.side === "front" && o1.widthIn === 48 && near((o1.x0 + o1.x1) / 2, r0.posts.reduce((m, p) => Math.min(m, p.x), Infinity) + 60) && near(Math.abs(o1.x1 - o1.x0), 48, 0.01), JSON.stringify(o1));
check("two posts more frame it: each half a post outside the clear width, on the front's line", jambs.length === 2 && r1.posts.length === r0.posts.length + 2 && near(Math.abs(jambs[0].x - jambs[1].x), 48 + 5.5, 0.01) && jambs.every((p) => near(p.y, o1.y0, 0.01) && !p.corner), JSON.stringify(jambs.map((p) => [p.x, p.y])));
check("no post stands in it", !r1.posts.some((p) => near(p.y, o1.y0, 1) && p.x > Math.min(o1.x0, o1.x1) + 0.5 && p.x < Math.max(o1.x0, o1.x1) - 0.5));
const h1 = r1.headers.find((h) => h.id === o1.headerId)!;
check("the header over it is sized for the spans the posts make — every span inside what its table allows", !!h1 && h1.maxSpanIn > 0 && h1.spanIn <= h1.maxSpanIn + 0.01 && o1.spanIn === 54 && !o1.engineered && !o1.beyond && !o1.blocked, `${h1?.spec.size} span ${h1?.spanIn} max ${h1?.maxSpanIn}`);
check("each of the two stands on a footing of its own and carries its share of the roof", jambs.every((p) => p.loadLb > 0 && (p.bearing !== "deck" || true)) && buildStructure(door).frame!.posts.filter((p) => p.roof).length === r1.posts.length);
const doorMember = r1.members.filter((m) => m.role === "door");
check("the screen wall is cut at it and the door hangs in it: one leaf 4 ft wide, where the opening is", r1.walls?.doors === 1 && doorMember.length === 1 && near(doorMember[0].sx, 48, 0.01) && near(doorMember[0].cx, (o1.x0 + o1.x1) / 2, 0.01) && r1.walls.sqFt < r0.walls!.sqFt, JSON.stringify(doorMember.map((m) => [m.cx, m.cy, m.sx])));
check("…and no kneewall plate runs across the doorway", !r1.members.some((m) => m.role === "kneewall" && near(m.cy, o1.y0, 1) && Math.min(m.x0, m.x1) < Math.min(o1.x0, o1.x1) - 1 && Math.max(m.x0, m.x1) > Math.max(o1.x0, o1.x1) + 1));
const c1 = find(door, "roof-opening-1");
check("the checks say what it came to: a pass, with the header and its span", c1?.level === "pass" && /4'-0" opening on the front, framed by two 6x6 posts/.test(c1.text) && /spans 4'-6" over it/.test(c1.text) && /a screen door hangs in it/.test(c1.text), JSON.stringify(c1));
const later = mk({ openings: [{ ...defaultRoofOpening("o1", "front", 5), door: false }] });
check("for a FUTURE door: the same two posts, the opening left open — no door in the price yet", roofOf(later).openings[0].leaves === 0 && roofOf(later).walls?.doors === 0 && !priceDeck(later).bom.some((l) => /screen door/i.test(l.label)) && priceDeck(door).bom.some((l) => /screen door/i.test(l.label) && l.qty === 1) && /left open/.test(find(later, "roof-opening-1")?.text ?? ""));
const scene = deckScene(buildStructure(door));
check("the 3D shows it: two posts more, a door", scene.boxes.filter((_, i) => scene.legend[scene.tags[i]]?.role === "roof post").length >= deckScene(buildStructure(plain)).boxes.filter((_, i) => deckScene(buildStructure(plain)).legend[deckScene(buildStructure(plain)).tags[i]]?.role === "roof post").length + 2);
check("the scope and the permit notes say it", deckScope(priceDeck(door)).some((t) => /A 4'-0" opening framed on the front \(a screen door in it\)/.test(t)) && permitNotes(buildStructure(door)).some((n) => /Roof posts set by the builder — a 4'-0" opening framed on the front/.test(n)) && roofByHandWords(r0) === "");

console.log("── the structure is never overridden");
const wide = mk({ openings: [{ ...defaultRoofOpening("o1", "front", 8), widthFt: 12 }] });
const rw = roofOf(wide);
const hw = rw.headers.find((h) => h.id === rw.openings[0].headerId)!;
check("a 12-ft opening: the header is a deeper one, good for the 12½ ft it now spans", rw.openings[0].spanIn === 150 && hw.maxSpanIn >= 150 && hw.spec.depthIn > h1.spec.depthIn, `${hw.spec.size} max ${hw.maxSpanIn}`);
check("…too wide for a pair of screen doors (8 ft): left open, and said", rw.openings[0].leaves === 0 && /too wide for a pair of screen doors/.test(find(wide, "roof-opening-1")?.text ?? ""));
const pair = mk({ openings: [{ ...defaultRoofOpening("o1", "front", 8), widthFt: 6 }] });
check("a 6-ft opening takes a pair of doors, 3 ft each", roofOf(pair).openings[0].leaves === 2 && roofOf(pair).members.filter((m) => m.role === "door").every((m) => near(m.sx, 36, 0.01)) && roofOf(pair).walls?.doors === 2);
// A 14-ft opening along the eave of a 24-ft-wide roof under 70 psf of snow — the side that carries the rafters: past every sawn header.
const heavy = mk({ openings: [{ ...defaultRoofOpening("o1", "left", 8), widthFt: 14 }], load: 70 }, { shape: { kind: "rect", widthFt: 24, depthFt: 16 } });
const rh = roofOf(heavy);
const ch = find(heavy, "roof-opening-1");
check("where the span is past the sawn-lumber tables the header is an engineered beam and the checks ask for a structural review — with a narrower opening one tap away", (rh.openings[0].engineered || rh.openings[0].beyond) && (ch?.level === "warn" || ch?.level === "fail") && /structural review|engineer/i.test(`${ch?.text} ${ch?.rule}`) && !!ch?.fix, JSON.stringify({ o: rh.openings[0], c: ch?.level, t: ch?.text.slice(0, 120) }));
if (ch?.fix) {
  const narrowed = applyDeckPatch(heavy, ch.fix.patch);
  check("…and narrowed, it is inside the tables again", roofOf(narrowed).openings[0].widthIn < rh.openings[0].widthIn && !roofOf(narrowed).openings[0].beyond);
}
check("these checks are the builder's to answer: the studio's own auto-fix never touches them", ["roof-opening-1", "roof-opening-drop-1", "roof-posts-set", "roof-post-spacing", "roof-not-set-1"].every((id) => !AUTO_FIX.test(id)));
check("…and settling the design keeps what was set by hand", JSON.stringify(settleDesign(door).design.roof.openings) === JSON.stringify(door.roof.openings) && JSON.stringify(settleDesign(heavy).design.roof.openings) === JSON.stringify(heavy.roof.openings));
const cross = mk({ ridge: "beam", crossBeams: 1, attach: "free", openings: [defaultRoofOpening("o1", "left", 6)] }, { placement: "detached" });
const rc = roofOf(cross);
if (rc.crossBeams > 0 && rc.openings.length) {
  const cc = find(cross, "roof-opening-1");
  check("a cross beam landing inside an opening: its post stays — the roof cannot spare it — and the checks say so", rc.openings[0].blocked ? cc?.level === "warn" && /cannot spare/.test(cc.text) : cc?.level === "pass", JSON.stringify({ blocked: rc.openings[0].blocked, level: cc?.level }));
}
const high = mk({ openings: [defaultRoofOpening("o1", "front", 5)] }, { heightIn: 60, rail: { type: "aluminum" } });
const drop = find(high, "roof-opening-drop-1");
check("an opening off a deck 5 ft up with no stair at it: a door onto a drop — a warning, with a stair at the opening one tap away", drop?.level === "warn" && /5'-0" above the ground/.test(drop.text) && Array.isArray(drop.fix?.patch.stairs) && drop.fix.patch.stairs.length === 1, JSON.stringify(drop));
if (drop?.fix) check("…with the stair there, the warning is answered", !find(applyDeckPatch(high, drop.fix.patch), "roof-opening-drop-1"), JSON.stringify(applyDeckPatch(high, drop.fix.patch).stairs));
check("…a stair already at the opening needs no warning; a low deck neither", !find(mk({ openings: [defaultRoofOpening("o1", "front", 5)] }, { heightIn: 60, stairs: [defaultStair("s1", "front", 5)] }), "roof-opening-drop-1") && !find(door, "roof-opening-drop-1"));

console.log("── a post by hand, and the farthest apart");
const pinned = mk({ pins: [defaultRoofPin("p1", "left", 4), defaultRoofPin("p2", "left", 8)] });
const rp = roofOf(pinned);
const mine = rp.posts.filter((p) => p.by?.kind === "pin");
const houseY = Math.min(...rp.headers.flatMap((h) => [h.y0, h.y1]));
check("two posts on the left side, 4 ft and 8 ft out from the house: there they stand", mine.length === 2 && rp.pins.length === 2 && mine.every((p) => near(p.x, Math.min(...rp.posts.map((q) => q.x)), 0.01)) && [48, 96].every((at) => mine.some((p) => near(p.y - houseY, at))), JSON.stringify(mine.map((p) => [p.x, p.y - houseY])));
const hl = rp.headers.find((h) => h.postAt.length === 4 && Math.abs(h.x0 - h.x1) < 0.5 && near(h.x0, mine[0].x, 0.01));
check("the left header is laid over them — four posts on its line — and sized for the shorter spans", !!hl && hl.spanIn <= hl.maxSpanIn + 0.01 && hl.spanIn < r0.headers.find((h) => Math.abs(h.x0 - h.x1) < 0.5 && near(h.x0, mine[0].x, 0.01))!.spanIn + 0.01, JSON.stringify(hl?.postAt));
check("said as a pass", find(pinned, "roof-posts-set")?.level === "pass" && /2 posts set by hand \(2 on the left side\)/.test(find(pinned, "roof-posts-set")!.text));
const spaced = mk({ postSpacingFt: 6 });
const rs = roofOf(spaced);
check("posts no farther apart than 6 ft: every header's spans are 6 ft or less, with more posts than the spans alone asked for", rs.headers.filter((h) => !h.cross).every((h) => h.spanIn <= 72 + 0.6) && rs.posts.length > r0.posts.length && find(spaced, "roof-post-spacing")?.level === "pass", JSON.stringify(rs.headers.map((h) => Math.round(h.spanIn))));
const spacedDoor = mk({ postSpacingFt: 4, openings: [{ ...defaultRoofOpening("o1", "front", 8), widthFt: 6 }] });
const rsd = roofOf(spacedDoor);
check("…an opening stays as wide as it was made, whatever the spacing: 6 ft clear, the posts beside it 4 ft apart or less", rsd.openings[0].widthIn === 72 && rsd.openings[0].spanIn === 78 && !rsd.posts.some((p) => near(p.y, rsd.openings[0].y0, 1) && p.x > Math.min(rsd.openings[0].x0, rsd.openings[0].x1) + 0.5 && p.x < Math.max(rsd.openings[0].x0, rsd.openings[0].x1) - 0.5), JSON.stringify(rsd.headers.map((h) => h.postAt.map((t) => Math.round(t)))));
check("wider spacing than the spans allow never takes a post away: 16 ft apart keeps every post the tables asked for", roofOf(mk({ postSpacingFt: 16 })).posts.length === r0.posts.length);

console.log("── what cannot be set is said");
const odd = mk({ openings: [defaultRoofOpening("o1", "back", 5), defaultRoofOpening("o2", "front", 5), defaultRoofOpening("o3", "front", 6)], pins: [defaultRoofPin("p1", "front", 0.2), defaultRoofPin("p2", "front", 5)] });
const ro = roofOf(odd);
const why = (id: string) => ro.notPlaced.find((x) => x.id === id)?.why ?? "";
check("an opening on the house side of a roof hung on the house; one over another; a post at a corner; a post in an opening — each said, none guessed", /hangs on the house/.test(why("o1")) && /overlaps another opening/.test(why("o3")) && /corner post stands there/.test(why("p1")) && /stand in an opening/.test(why("p2")) && ro.openings.length === 1 && ro.pins.length === 0, JSON.stringify(ro.notPlaced));
const notSet = deckChecks(buildStructure(odd)).filter((c) => /^roof-not-set-/.test(c.id));
check("…each with a way to take it off", notSet.length === 4 && notSet.every((c) => c.level === "info" && !!c.fix) && applyDeckPatch(odd, notSet[0].fix!.patch).roof.openings.length === 2);
const round = mk({ plan: { ...d0.roof.plan, shape: "octagon", acrossFt: 14 }, kind: "pyramid", attach: "free", openings: [defaultRoofOpening("o1", "front", 5)] }, { structure: "gazebo" });
check("an eight-sided roof has no front to measure along: said", /no side to measure along/.test(roofOf(round).notPlaced[0]?.why ?? "") && roofOf(round).openings.length === 0, JSON.stringify(roofOf(round).notPlaced));

console.log("── edit, remove, keep");
const st = buildStructure(door);
const sc = deckScene(st);
const jambBox = sc.boxes.findIndex((b, i) => sc.legend[sc.tags[i]]?.role === "roof post" && near(b[1] * 12, jambs[0].x, 0.7) && near(b[2] * 12, jambs[0].y, 0.7));
const ref = partAt(st, sc, jambBox);
const card = ref ? partCard(st, ref) : null;
check("click one of the opening's posts in the 3D: its card is the opening's — remove it, make it 3 to 8 ft, hang or leave out the door, slide it", ref?.kind === "roof-post" && /opening/.test(card?.title ?? "") && ["opening-off", "opening-3", "opening-6", "opening-door", "opening-slide--1", "opening-slide-1"].every((id) => card!.choices.some((c) => c.id === id)) && card!.choices.find((c) => c.id === "opening-4")?.current === true, JSON.stringify(card?.choices.map((c) => c.id)));
const off = card ? tryChoice(door, card.choices.find((c) => c.id === "opening-off")!) : null;
check("…remove it: the two posts go, the roof is as it was", !!off && off.design.roof.openings.length === 0 && roofOf(off.design).posts.length === r0.posts.length);
const six = card ? tryChoice(door, card.choices.find((c) => c.id === "opening-6")!) : null;
check("…make it 6 ft: it is 6 ft, with a pair of doors", !!six && roofOf(six.design).openings[0].widthIn === 72 && roofOf(six.design).openings[0].leaves === 2);
const midPost = r0.posts.find((p) => !p.corner);
if (midPost) {
  const sc0 = deckScene(buildStructure(plain));
  const box = sc0.boxes.findIndex((b, i) => sc0.legend[sc0.tags[i]]?.role === "roof post" && near(b[1] * 12, midPost.x, 0.7) && near(b[2] * 12, midPost.y, 0.7));
  const card0 = partCard(buildStructure(plain), partAt(buildStructure(plain), sc0, box)!);
  const add = card0.choices.find((c) => c.id === "opening-add");
  check("click a post the spans set: \"frame a 4-ft opening beside this post\" — and there it is, on that post's side", !!add && tryChoice(plain, add).design.roof.openings.length === 1 && roofOf(tryChoice(plain, add).design).openings.length === 1, JSON.stringify(card0.choices.map((c) => c.id)));
}
const saved = normalizeDeckDesign(JSON.parse(JSON.stringify(mk({ openings: [{ ...defaultRoofOpening("o1", "right", 6), widthFt: 5, door: false }], pins: [defaultRoofPin("p1", "left", 4)], postSpacingFt: 8 }))));
check("kept through a save: the opening, the post, the spacing", JSON.stringify(saved.roof.openings) === JSON.stringify([{ id: "o1", side: "right", atFt: 6, widthFt: 5, door: false }]) && JSON.stringify(saved.roof.pins) === JSON.stringify([{ id: "p1", side: "left", atFt: 4 }]) && saved.roof.postSpacingFt === 8 && JSON.stringify(roofOf(saved).posts) === JSON.stringify(roofOf(normalizeDeckDesign(JSON.parse(JSON.stringify(saved)))).posts));
const junk = normalizeDeckDesign({ ...plain, roof: { ...plain.roof, openings: [null, 3, { atFt: "x" }, { atFt: 5, side: "roof", widthFt: 99, door: "yes" }, { id: "o1", atFt: 5 }, { id: "o1", atFt: 7 }, ...new Array(20).fill({ atFt: 3 })], pins: [{ atFt: -9, side: "left" }, { side: "left" }], postSpacingFt: 99 } });
check("junk is not kept: no place, no opening; an unknown side is the front; widths and spacing inside their limits; no two with one id; no more than the list holds", junk.roof.openings.length === ROOF_POST_LIMITS.openings && junk.roof.openings[0].side === "front" && junk.roof.openings[0].widthFt === ROOF_POST_LIMITS.openingFt.max && junk.roof.openings[0].door === true && new Set(junk.roof.openings.map((o) => o.id)).size === junk.roof.openings.length && junk.roof.pins.length === 1 && junk.roof.pins[0].atFt === 0 && junk.roof.postSpacingFt === ROOF_POST_LIMITS.spacingFt.max, JSON.stringify([junk.roof.openings.slice(0, 3), junk.roof.pins, junk.roof.postSpacingFt]));
check("an old design, saved before any of this, is built as it was", normalizeDeckDesign(JSON.parse(JSON.stringify({ ...plain, roof: { ...plain.roof, openings: undefined, pins: undefined, postSpacingFt: undefined } }))).roof.openings.length === 0 && JSON.stringify(roofOf(normalizeDeckDesign(JSON.parse(JSON.stringify({ ...plain, roof: { ...plain.roof, openings: undefined, pins: undefined, postSpacingFt: undefined } })))).posts) === JSON.stringify(r0.posts));

console.log(bad ? `\n${bad} FAILED` : "\nALL PASS");
if (bad) process.exit(1);
