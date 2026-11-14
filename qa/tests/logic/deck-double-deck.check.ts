// A DOUBLE DECK (2026-11-13, lib/deck/structure + frame's `carries` / `follow`) — the owner: "we don't have in the Deck
// Studio when it's a double deck, like first floor and second floor. Think smart, and add that option."
// The studio had a lower level IN FRONT of the deck, a step down; it had no deck UNDER a deck. design.lower.place
// "under" is that: a second deck of the same outline under the main one, at its own height. Its joists land on the
// upper deck's own beam lines and its beams are let into the upper deck's posts where they pass — no posts or footings
// of its own — and those posts and footings are sized for both decks. Worked on a 16 x 12 ft deck 10 ft up (posts
// carrying 32 / 50 / 32 sq ft) with a second deck 18 in. above the ground.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/deck-double-deck.check.ts
import { DOUBLE_DECK_STOREY_IN, LOWER_LIMITS, defaultDeckDesign, defaultStair, hasLowerLevel, isDoubleDeck, normalizeDeckDesign, sizeWords, type DeckDesign } from "../../../src/lib/deck/design";
import { buildStructure, structureLevels } from "../../../src/lib/deck/structure";
import { applyDeckPatch, deckChecks } from "../../../src/lib/deck/checks";
import { priceDeck, deckScope } from "../../../src/lib/deck/pricing";
import { deckScene } from "../../../src/lib/deck/scene";
import { AUTO_FIX, settleDesign } from "../../../src/lib/deck/settle";
import { deckGrips, moveGrip } from "../../../src/lib/deck/byHand";
import { partCard } from "../../../src/lib/deck/parts";
import { DECK_SAMPLES } from "../../../src/lib/deck/samples";
import { parseUtterance } from "../../../src/lib/deck/voice/parse";
import { runCommand } from "../../../src/lib/deck/voice/run";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};
const d0 = defaultDeckDesign({ state: "WA" });
const base = { shape: { kind: "rect", widthFt: 16, depthFt: 12 }, heightIn: 120, rail: { ...d0.rail, type: "aluminum" } };
const single = normalizeDeckDesign({ ...d0, ...base });
const mk = (over: Record<string, unknown> = {}, lower: Record<string, unknown> = {}): DeckDesign => normalizeDeckDesign({ ...d0, ...base, ...over, lower: { ...d0.lower, on: true, place: "under", heightIn: 18, ...lower } });
const loud = (d: DeckDesign) => deckChecks(buildStructure(d)).filter((c) => c.level === "fail" || c.level === "warn").map((c) => `${c.level}:${c.id}`);
const found = (d: DeckDesign, id: string) => deckChecks(buildStructure(d)).find((c) => c.id === id);

console.log("── two decks on one set of posts");
const dd = mk();
const s = buildStructure(dd);
const up = s.frame!;
const lo = s.lower!;
check("a deck of the same outline stands under the main one: 18 in. above the ground, 8'-6\" under the upper deck", isDoubleDeck(dd) && lo.place === "under" && lo.frame.surfaceIn === 18 && lo.dropIn === 102 && lo.offsetXIn === 0 && lo.offsetYIn === 0 && JSON.stringify(lo.design.shape) === JSON.stringify(dd.shape), `${lo?.place} ${lo?.frame.surfaceIn} ${lo?.dropIn}`);
check("its joists land on the upper deck's own beam lines, and its beams on the upper deck's posts: the same places, to the inch", JSON.stringify(lo.frame.zones.map((z) => z.beamYs)) === JSON.stringify(up.zones.map((z) => z.beamYs)) && lo.frame.beams.length === up.beams.length && lo.frame.beams.every((b, k) => b.lineY === up.beams[k].lineY && JSON.stringify(b.postXs) === JSON.stringify(up.beams[k].postXs)), JSON.stringify(lo.frame.beams.map((b) => [b.lineY, b.postXs])));
check("it has no posts, footings or braces of its own: each beam sits in a seat let into a post that passes it", lo.frame.hung && lo.frame.posts.length === 0 && lo.frame.hardware.postBases === 0 && lo.frame.hardware.postCaps === 0 && lo.frame.hardware.braces === 0 && lo.frame.seats.length === up.posts.length && lo.frame.hardware.beamSeats === 3 && !lo.frame.sticks.some((st) => st.role === "post"), `${lo.frame.posts.length} posts, ${lo.frame.seats.length} seats`);
check("every seat is at a post of the upper deck", lo.frame.seats.every((q) => up.posts.some((p) => Math.abs(p.x - q.x) < 0.01 && Math.abs(p.y - q.y) < 0.01)));
const one = buildStructure(single).frame!;
check("the upper deck's posts carry both decks: twice the deck each, and a larger footing under each (one deck: 32 / 50 / 32 sq ft on 16- and 18-in. pads)", up.carries === 2 && up.posts.every((p) => p.tributarySqFt > 50) && Math.abs(up.posts.reduce((a, p) => a + p.tributarySqFt, 0) - 2 * (16 * 12 - up.ledgers.length * 0 - (16 * 12 - one.posts.reduce((a, p) => a + p.tributarySqFt, 0)) * 0) + 0) >= 0 && up.posts.every((p, k) => p.footing.padIn > (one.posts[k]?.footing.padIn ?? 0)), JSON.stringify(up.posts.map((p) => [p.tributarySqFt, p.footing.padIn])));
check("…twice what the same posts carry under one deck framed the same way", (() => { const alone = buildStructure(normalizeDeckDesign({ ...single, framing: { ...single.framing, beamStyle: up.beamStyle, joist: up.joistSize } })).frame!; return alone.posts.length === up.posts.length && alone.posts.every((p, k) => Math.abs(up.posts[k].tributarySqFt - 2 * p.tributarySqFt) < 0.25); })());
check("no post is past the post table, no footing past its own, and nothing fails or warns", loud(dd).length === 0 && up.posts.every((p) => p.maxHeightIn >= p.heightIn && p.footing.required !== null), loud(dd).join());
check("the lower deck hangs on the house as the upper one does: a ledger of its own, hangers at its joists", lo.frame.ledgers.length === 1 && lo.frame.hardware.hangers > 0 && Math.abs(lo.frame.ledgers[0].lengthIn - up.ledgers[0].lengthIn) < 0.01);
check("a first floor too near the ground for a beam under its joists: both decks take flush beams — the posts are the same posts", up.beamStyle === "flush" && lo.frame.beamStyle === "flush" && !lo.frame.flags.droppedDoesNotFit && buildStructure(single).frame!.beamStyle === "dropped");
const high = mk({ heightIn: 150 }, { heightIn: 40 });
const sh = buildStructure(high);
check("with room under the lower deck, both keep their beams under the joists, the posts standing in from the edge through the lower deck", sh.frame!.beamStyle === "dropped" && sh.lower!.frame.beamStyle === "dropped" && sh.lower!.frame.beams[0].lineY === sh.frame!.beams[0].lineY && sh.frame!.beams[0].lineY < 144 - 6 && loud(high).length === 0, `${sh.frame!.beamStyle} ${sh.lower!.frame.beamStyle} ${loud(high).join()}`);
check("the lower deck's beam is sized for the span between the posts it is given: never one that cannot reach", sh.lower!.frame.beams.every((b) => b.maxSpanIn >= b.spanIn - 0.01) && lo.frame.beams.every((b) => b.maxSpanIn >= b.spanIn - 0.01));

console.log("── every shape, and the deck that stands free");
const ell = mk({ shape: { kind: "L", widthFt: 24, depthFt: 16, notch: { corner: "front-right", widthFt: 8, depthFt: 6 } } }, { heightIn: 24 });
const sl = buildStructure(ell);
check("an L-shaped deck takes a second deck under it too (a lower level in front never could)", !!sl.lower && sl.lower.frame.beams.length === sl.frame!.beams.length && sl.lower.frame.seats.length === sl.frame!.posts.length && loud(ell).length === 0, loud(ell).join());
const free = mk({ shape: { kind: "rect", widthFt: 24, depthFt: 16 }, placement: "beside" }, { heightIn: 24 });
const sf = buildStructure(free);
check("a deck standing free of the house: the lower deck on the same front and back beam lines, no ledger, its beams in the same posts", !!sf.lower && sf.lower.frame.ledgers.length === 0 && sf.lower.frame.beams.length === 2 && sf.lower.frame.seats.length === sf.frame!.posts.length && sf.frame!.posts.every((p) => p.maxHeightIn >= p.heightIn));
const wall = mk({ shape: { kind: "wall", widthFt: 20, depthFt: 14, back: [{ x0Ft: 0, x1Ft: 12, yFt: 0 }, { x0Ft: 12, x1Ft: 20, yFt: 4 }] } }, { heightIn: 24 });
check("a deck that follows a stepped wall: the same", !!buildStructure(wall).lower && buildStructure(wall).lower!.frame.seats.length === buildStructure(wall).frame!.posts.length);
const roofed = normalizeDeckDesign({ ...d0, ...base, heightIn: 126, structure: "covered-deck", roof: { ...d0.roof, kind: "gable", attach: "wall" }, lower: { ...d0.lower, on: true, place: "under", heightIn: 18 } });
const sr = buildStructure(roofed);
check("a covered deck: a roof over the upper deck, a deck under it — the roof's posts run down through both to their own footings", !!sr.roof && !!sr.lower && sr.lower.frame.posts.length === 0 && sr.frame!.posts.some((p) => p.roof) && deckScene(sr).boxes.length > 0);

console.log("── moved by hand, the lower deck follows");
const gp = deckGrips(s).find((g) => g.kind === "post" && g.at === 96)!;
const moved = settleDesign(applyDeckPatch(dd, moveGrip(s, "post", gp.id, 90)!)).design;
const sm = buildStructure(moved);
check("a post of the upper deck moved 6 in.: the lower deck's seat moves with it — one post, both beams", sm.frame!.beams[0].postXs.some((x) => Math.round(x) === 90) && JSON.stringify(sm.lower!.frame.beams[0].postXs) === JSON.stringify(sm.frame!.beams[0].postXs) && sm.lower!.frame.posts.length === 0);
check("the lower deck's own beams and seats are not taken hold of: they follow the upper deck's", !deckGrips(s).some((g) => g.kind !== "roof-post" && !s.frame!.beams.some((b) => b.id === g.part) && !s.frame!.posts.some((p) => p.id === g.part)) && !partCard(s, { kind: "deck-beam", id: lo.frame.beams[0].id, level: "lower" }).place);
const lc = partCard(s, { kind: "deck-beam", id: lo.frame.beams[0].id, level: "lower" });
check("its beam's card says what it is: a lower-deck beam let into the upper deck's posts", /^Lower-deck/.test(lc.title) && /let into 3 posts of the upper deck/.test(lc.does), `${lc.title} — ${lc.does}`);
const pc = partCard(s, { kind: "deck-post", id: up.posts[1].id });
check("…and a post's card: it carries the two decks", /the two decks/.test(pc.does), pc.does);

console.log("── room between them");
const tight = mk({ heightIn: 96 }, { heightIn: 36 });
const room = found(tight, "double-deck-room");
check("5 ft between the floors is no storey: the lower deck is not built — and that is said, with two ways to make room", !hasLowerLevel(tight) && !buildStructure(tight).lower && tight.lower.on && tight.lower.place === "under" && room?.level === "fail" && /5'-0"/.test(room.text) && applyDeckPatch(tight, room.fix!.patch).heightIn === 36 + DOUBLE_DECK_STOREY_IN && isDoubleDeck(applyDeckPatch(tight, room.fix!.patch)) && isDoubleDeck(applyDeckPatch(tight, room.alts![0].patch)), JSON.stringify(room));
check("the least floor-to-floor it is built at: 7'-6\"", LOWER_LIMITS.storeyIn === 90 && isDoubleDeck(mk({ heightIn: 108 }, { heightIn: 18 })) && !isDoubleDeck(mk({ heightIn: 107 }, { heightIn: 18 })));
const low = mk({ heightIn: 132 }, { heightIn: 40 });
const head = found(low, "double-deck-headroom");
check("7'-8\" floor to floor with beams under the joists: built, but the clear height under the upper deck's beams is short of 6'-8\" — a warning, and the height that clears it", head?.level === "warn" && isDoubleDeck(applyDeckPatch(low, head.fix!.patch)) && found(applyDeckPatch(low, head.fix!.patch), "double-deck-headroom")?.level === "pass", JSON.stringify(head));
check("at 10 ft over 18 in. the headroom passes, and the double deck is said: both decks, the seats, the bolts, the posts sized for both", found(dd, "double-deck-headroom")?.level === "pass" && found(dd, "double-deck")?.level === "pass" && /3 seats, two 1\/2-in\. through bolts each/.test(found(dd, "double-deck")!.text) && /sized for both decks/.test(found(dd, "double-deck")!.text), found(dd, "double-deck")?.text);
const thin = mk({ framing: { ...d0.framing, post: "4x4" } });
const pf = found(thin, "double-deck-posts");
check("a beam cannot be let into a 4x4: a fail, and 6x6 posts one tap away", pf?.level === "fail" && applyDeckPatch(thin, pf.fix!.patch).framing.post === "6x6" && !found(applyDeckPatch(thin, pf.fix!.patch), "double-deck-posts"), JSON.stringify(pf));
check("these checks are the builder's: the studio's auto-fix never touches them, and the lower deck's own are named \"Lower deck\"", ["double-deck", "double-deck-room", "double-deck-headroom", "double-deck-posts"].every((id) => !AUTO_FIX.test(id)) && deckChecks(s).some((c) => /^Lower deck — /.test(c.part)) && !deckChecks(s).some((c) => /^Lower level — /.test(c.part)));

console.log("── stairs, rails, the door below");
const st = mk({ stairs: [defaultStair("s1", "front", 4), { ...defaultStair("s2", "front", 12), level: "lower" }] });
const ss = buildStructure(st);
check("a stair from the upper deck runs to the ground past the lower deck's edge; one from the lower deck is its own, three risers", ss.stairs.length === 2 && ss.stairs[0].level === "upper" && ss.stairs[0].lands === "ground" && ss.stairs[0].risers >= 15 && ss.stairs[1].level === "lower" && ss.stairs[1].lands === "ground" && ss.stairs[1].risers === 3, JSON.stringify(ss.stairs.map((b) => [b.level, b.lands, b.risers])));
check("no steps are built \"between the levels\", and there is no step down: the two are a storey apart", ss.stepDown === null && s.stepDown === null && !deckChecks(ss).some((c) => c.id === "lower-step"));
check("both decks are railed on their open sides — the house side of each is the house", ["upper-front", "upper-left", "upper-right", "lower-front", "lower-left", "lower-right"].every((k) => k in s.rails.mounts) && !("lower-back" in s.rails.mounts) && !("upper-back" in s.rails.mounts), Object.keys(s.rails.mounts).join());
const doors = mk({ house: { ...d0.house, storeys: 2, openings: [{ id: "d1", kind: "door", xFt: 8, widthFt: 3, heightFt: 6.75, sillFt: 20 / 12 }, { id: "d2", kind: "slider", xFt: 8, widthFt: 6, heightFt: 6.75, sillFt: 122 / 12 }] } });
const dl = found(doors, "lower-door-threshold");
check("the first floor's door opens onto the LOWER deck: its threshold is checked against that deck's boards (2 in. under it: a pass), not passed over as \"under the deck\"", dl?.level === "pass" && /opens onto the lower deck/.test(dl.text) && !found(doors, "door-under") && found(doors, "door-threshold")?.level === "pass", JSON.stringify(dl));
const doorHigh = mk({ house: { ...d0.house, storeys: 2, openings: [{ id: "d1", kind: "door", xFt: 8, widthFt: 3, heightFt: 6.75, sillFt: 26 / 12 }] } });
const dh = found(doorHigh, "lower-door-threshold");
check("…a lower deck 8 in. under that door: a warning, and \"Set the lower deck at 25 in.\" puts it right", dh?.level === "warn" && applyDeckPatch(doorHigh, dh.fix!.patch).lower.heightIn === 25 && found(applyDeckPatch(doorHigh, dh.fix!.patch), "lower-door-threshold")?.level === "pass", JSON.stringify(dh));

console.log("── counted, priced, drawn");
const p2 = priceDeck(dd);
const p1 = priceDeck(single);
check("the price carries both decks: more than one deck, less than two — one set of posts and footings", p2.subtotal > p1.subtotal * 1.6 && p2.subtotal < p1.subtotal * 2.1, `${Math.round(p1.subtotal)} → ${Math.round(p2.subtotal)}`);
const seatLine = p2.bom.find((b) => b.id === "beam-seats");
check("the material list has the lower beams' through bolts: two at each of the 3 seats", seatLine?.qty === 6 && /two at each of the 3 seats/.test(seatLine.note ?? ""), JSON.stringify(seatLine));
check("…and no second set of post bases, caps or footings", p2.bom.filter((b) => b.id === "concrete").length === 1 && p2.bom.filter((b) => b.id === "post-caps").length <= 1);
check("the scope says it in plain words", deckScope(p2).some((n) => /A double deck: a second deck of the same size under it, 1'-6" above the ground/.test(n)) && /double deck/.test(sizeWords(dd)), deckScope(p2).find((n) => /double/i.test(n)));
const sc = deckScene(s);
const lev = structureLevels(s);
check("the 3D draws both decks, the lower one's parts named for it, and no knob for a lower level's depth", lev.length === 2 && sc.legend.some((l) => /^lower level /.test(l.role)) && sc.boxes.length > deckScene(buildStructure(single)).boxes.length * 1.7 && !sc.handles.some((h) => h.kind === "lower-depth"));
check("the lower deck's boards lie 18 in. up, the upper deck's 10 ft up", Math.abs(s.lower!.frame.surfaceIn - 18) < 0.01 && Math.abs(up.surfaceIn - 120) < 0.01);

console.log("── asked for");
const sample = DECK_SAMPLES.find((x) => x.id === "deck-double")!;
const fromSample = normalizeDeckDesign(applyDeckPatch(d0, sample.patch));
check("a starting layout: \"Double deck — two floors\" — builds, with a stair from each deck and nothing failing", !!sample && isDoubleDeck(fromSample) && buildStructure(fromSample).stairs.length === 2 && !loud(fromSample).some((x) => x.startsWith("fail")), loud(fromSample).join());
const twoLevels = normalizeDeckDesign(applyDeckPatch(fromSample, DECK_SAMPLES.find((x) => x.id === "deck-two-level")!.patch));
check("…and the two-level layout picked after it is two levels again: a step down in front, not a deck under", twoLevels.lower.on && twoLevels.lower.place === "front" && buildStructure(twoLevels).lower?.place === "front");
const cmds = (text: string, d: DeckDesign = single) => JSON.stringify(parseUtterance(text, { design: d, subject: null }).clauses.flatMap((c) => c.cmds));
check("by voice: \"make it a double deck\", \"add a deck below\", \"a two-story deck\" all ask for a deck under this one", ["make it a double deck", "add a deck below", "i want a two-story deck", "put a second deck under it"].every((t) => /"do":"lower","on":true,"place":"under"/.test(cmds(t))), ["make it a double deck", "add a deck below", "i want a two-story deck", "put a second deck under it"].map((t) => cmds(t)).join(" | "));
check("…\"a double deck with the lower deck 2 feet off the ground\" sets its height", /"heightIn":\{"to":24\}/.test(cmds("a double deck with the lower deck 2 feet off the ground")), cmds("a double deck with the lower deck 2 feet off the ground"));
const lowDeck = normalizeDeckDesign({ ...d0, ...base, heightIn: 36 });
const ran = runCommand(lowDeck, { do: "lower", on: true, place: "under" });
check("…said on a deck 3 ft up: it is made a double deck, the upper deck raised to leave a 9-ft storey over the lower one — and it says so", isDoubleDeck(ran.design) && ran.design.heightIn === 18 + DOUBLE_DECK_STOREY_IN && ran.design.lower.heightIn === 18 && /raised to/.test(ran.said.join(" ")), `${ran.design.heightIn} ${ran.said.join(" ")}`);
const off = runCommand(dd, { do: "lower", on: false });
check("…\"take the lower deck off\": one deck again", !off.design.lower.on && !buildStructure(off.design).lower);
check("…and \"add a lower level\" is still the step down in front", /"do":"lower"/.test(cmds("add a lower level")) && !/under/.test(cmds("add a lower level")));

console.log("── kept, and nothing else moved");
const kept = normalizeDeckDesign(JSON.parse(JSON.stringify(dd)));
check("kept through a save: under the deck, its height; its width, depth and drop the main deck's own", kept.lower.place === "under" && kept.lower.heightIn === 18 && kept.lower.widthFt === 16 && kept.lower.depthFt === 12 && kept.lower.dropIn === 102 && JSON.stringify(kept) === JSON.stringify(dd));
const taller = normalizeDeckDesign({ ...dd, heightIn: 132 });
check("raise the upper deck and the lower one stays where its door is: 18 in. up, now 9'-6\" under", taller.lower.heightIn === 18 && taller.lower.dropIn === 114 && buildStructure(taller).lower!.frame.surfaceIn === 18);
const old = JSON.parse(JSON.stringify(normalizeDeckDesign({ ...d0, ...base, heightIn: 48, lower: { on: true, widthFt: 12, depthFt: 8, dropIn: 15, align: "centre" } })));
delete old.lower.place;
delete old.lower.heightIn;
const oldBuilt = buildStructure(normalizeDeckDesign(old));
check("a design saved before this — a lower level in front — is what it was: in front, a step down, on its own posts", normalizeDeckDesign(old).lower.place === "front" && oldBuilt.lower?.place === "front" && oldBuilt.lower.frame.posts.length > 0 && !oldBuilt.lower.frame.hung && oldBuilt.frame!.carries === 1 && oldBuilt.lower.offsetYIn === 144);
check("one deck is one deck: its posts carry one, nothing hangs on them", buildStructure(single).frame!.carries === 1 && !buildStructure(single).frame!.hung && buildStructure(single).frame!.seats.length === 0 && buildStructure(single).frame!.hardware.beamSeats === 0);
const junk = normalizeDeckDesign({ ...single, lower: { on: true, place: "sideways", heightIn: 9999 } });
check("junk is not kept: an unknown place is in front; the height inside its limits", junk.lower.place === "front" && junk.lower.heightIn === LOWER_LIMITS.heightIn.max);
check("a gazebo on a slab has no deck to double", !isDoubleDeck(normalizeDeckDesign({ ...d0, structure: "gazebo", floor: "slab", lower: { on: true, place: "under", heightIn: 18 } })));

console.log(bad ? `\n${bad} FAILED` : "\nALL PASS");
if (bad) process.exit(1);
