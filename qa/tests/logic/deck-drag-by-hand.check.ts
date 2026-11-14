// POSTS AND BEAMS MOVED BY HAND (2026-11-13, lib/deck/byHand + frame's design.framing.beamLines / .backOverhangFt) — the
// owner: "make it so I can move beams and posts by hand. Just drag it in any place — or add, or remove. Not a foot at a
// click: maybe I only need 6 inches. Move it with the hand, or type any inches I want. Make it smart."
// A post slides along its beam, a beam along the joists, a roof post along its side — to the inch, by a pull in the 3D
// or on the framing plan, or by a figure typed on the part's card. One helper does every move, so all three agree; the
// structure is never overridden (a span past its table takes a post or a beam; an overhang stops where the joist
// table stops). Worked on a 16 x 12 ft deck 36 in. up (a 4x10 front beam on posts at 12 / 96 / 180 in.) and a
// 16 x 20 ft one (a middle beam at 109 in.).
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/deck-drag-by-hand.check.ts
import { DECK_BEAM_LIMITS, defaultDeckDesign, defaultRoofOpening, normalizeDeckDesign, type DeckDesign } from "../../../src/lib/deck/design";
import { buildStructure } from "../../../src/lib/deck/structure";
import { applyDeckPatch, deckChecks, type DeckPatch } from "../../../src/lib/deck/checks";
import { deckScene, parseDeckScene } from "../../../src/lib/deck/scene";
import { partCard, tryChoice } from "../../../src/lib/deck/parts";
import { AUTO_FIX, settleDesign } from "../../../src/lib/deck/settle";
import { addBeam, addPostUnder, addRoofPost, deckGrips, gripAtFor, gripOfPart, gripShownIn, moveGrip, partOfGrip, removeBeamLine, removePost } from "../../../src/lib/deck/byHand";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};
const d0 = defaultDeckDesign({ state: "WA" });
const mk = (framing: Record<string, unknown> = {}, over: Record<string, unknown> = {}): DeckDesign => normalizeDeckDesign({ ...d0, shape: { kind: "rect", widthFt: 16, depthFt: 12 }, heightIn: 36, ...over, framing: { ...d0.framing, ...framing } });
const deep = { shape: { kind: "rect", widthFt: 16, depthFt: 20 } };
const frameOf = (d: DeckDesign) => buildStructure(d).frame!;
/** The frame in a line: joists, then each beam with where it stands and its posts ("*" = set by hand). */
const line = (d: DeckDesign) => {
  const f = frameOf(d);
  return `${f.joistSize} | ${f.beams.map((b) => `${b.role}@${b.lineY}${b.by ? "*" : ""} ${b.spec.size} [${f.posts.filter((p) => p.beamId === b.id).map((p) => `${Math.round(p.x)}${p.by ? "*" : ""}`).join(" ")}]`).join("; ")}`;
};
const loud = (d: DeckDesign, re = /^(joist-|beam-(?!both)|post-|deck-)/) => deckChecks(buildStructure(d)).filter((c) => re.test(c.id) && (c.level === "fail" || c.level === "warn")).map((c) => `${c.level}:${c.id}`);
/** What the studio does with a move: the patch laid over the design, the tables settled. */
const put = (d: DeckDesign, p: DeckPatch | null) => (p ? settleDesign(applyDeckPatch(d, p)).design : d);
/** A pull: the same name, step after step, as the pointer goes. */
const pull = (d: DeckDesign, kind: "post" | "beam" | "roof-post", id: string, ats: number[]) => ats.reduce((dd, at) => put(dd, moveGrip(buildStructure(dd), kind, id, at)), d);
const grips = (d: DeckDesign, kind?: string) => deckGrips(buildStructure(d)).filter((g) => !kind || g.kind === kind);

console.log("── a post, pulled along its beam");
const auto = mk();
const posts = grips(auto, "post");
check("three posts under the front beam can be taken hold of, each along its beam between the beam's ends", posts.length === 3 && posts.map((g) => g.at).join() === "12,96,180" && posts.every((g) => g.axis === "x" && g.min === 1 && g.max === 191 && !g.byHand), JSON.stringify(posts.map((g) => [g.at, g.min, g.max])));
const mid = posts[1].id;
const one = pull(auto, "post", mid, [97]);
check("pulled one inch: it stands at 8'-1\", to the inch — and the other two stay where they were, now the builder's posts too", line(one) === "2x8 | front@120 4x10 [12* 97* 180*]", line(one));
check("…and it is the same post in the hand: the next inch of the pull finds it by the same name", grips(one, "post").some((g) => g.id === mid && g.at === 97 && g.byHand));
const six = pull(auto, "post", mid, [97, 98, 99, 100, 101, 102]);
const five = pull(auto, "post", mid, [97, 98, 99, 100, 101]);
check("five inches, an inch at a time: 8'-5\" — the span beside it is 7'-5\" now, the most a 4x10 spans here, and nothing else moves", line(five) === "2x8 | front@120 4x10 [12* 101* 180*]" && loud(five).length === 0, `${line(five)} ${loud(five).join()}`);
check("six inches — the move the owner asked for: it stands at 8'-6\" to the inch; the span it leaves is an inch past the beam's table, so a post stands in the middle of it", line(six) === "2x8 | front@120 4x10 [12* 57 102* 180*]" && loud(six).length === 0, `${line(six)} ${loud(six).join()}`);
const far = pull(auto, "post", mid, [103, 110, 150]);
check("pulled far to the right: the span it leaves behind is past the beam's table, so a post stands in the middle of it — the beam is never left short", line(far) === "2x8 | front@120 4x10 [12* 81 150* 180*]" && loud(far).length === 0, `${line(far)} ${loud(far).join()}`);
const beside = pull(far, "post", mid, [176]);
check("pulled onto the end post: it stops a post's width short of it (7 in.), never on it", /173\* 180\*\]$/.test(line(beside)), line(beside));
const past = pull(beside, "post", mid, [300]);
check("…and pulled on past it: it goes round, to the beam's end at most", /180\* 191\*\]$/.test(line(past)), line(past));
check("a pull that goes nowhere changes nothing: no patch", moveGrip(buildStructure(one), "post", mid, 97) === null && moveGrip(buildStructure(auto), "post", "no-such", 50) === null);
const back = pull(one, "post", mid, [96]);
check("pulled back to where it stood: the frame is the one it was — same beam, same three posts", line(back).replace(/\*/g, "") === line(auto), line(back));

console.log("── add a post, take one off");
const s0 = buildStructure(auto);
const more = addPostUnder(s0, s0.frame!.beams[0].id)!;
const added = put(auto, more.patch);
check("a post added under the beam: in the middle of its longest span (4'-6\"), the others staying put", more.at === 54 && Math.round(more.spanIn) === 84 && line(added) === "2x8 | front@120 4x10 [12* 54* 96* 180*]", `${more.at} ${line(added)}`);
const sA = buildStructure(added);
const gone = put(added, removePost(sA, deckGrips(sA).find((g) => g.kind === "post" && g.at === 54)!.id));
check("…and taken off again: three posts, as before", line(gone) === "2x8 | front@120 4x10 [12* 96* 180*]", line(gone));
const needed = put(gone, removePost(buildStructure(gone), deckGrips(buildStructure(gone)).find((g) => g.kind === "post" && g.at === 96)!.id));
check("a post the beam needs, taken off: the 14-ft span is past the table, so a post comes back in its middle", /\[12\* 96 180\*\]/.test(line(needed)) && loud(needed).length === 0, line(needed));

console.log("── the front beam, pulled along the joists");
const front = grips(auto, "beam")[0];
check("the front beam can be taken hold of: it slides along the joists, and reads as how far in from the deck's front edge it stands (2 ft)", front.id === "front:a" && front.axis === "y" && front.at === 120 && gripShownIn(front) === 24 && /front edge/.test(front.from) && front.max === 144, JSON.stringify(front));
const in2 = pull(auto, "beam", "front:a", [118]);
check("pulled 2 in. toward the house: the joists run 2'-2\" past it — the overhang is the builder's now", in2.framing.overhangFt === 26 / 12 && frameOf(in2).beams[0].lineY === 118 && loud(in2).length === 0, `${in2.framing.overhangFt} ${line(in2)}`);
const tooFar = pull(auto, "beam", "front:a", [118, 110, 100, 80]);
const cant = deckChecks(buildStructure(tooFar)).find((c) => c.id === "joist-overhang-a");
check("pulled a long way in: it stops where the joist table stops (a joist may run past a beam a quarter of the span behind it) — the overhang check still passes", frameOf(tooFar).beams[0].lineY > 100 && cant?.level === "pass" && loud(tooFar).length === 0, `${line(tooFar)} ${cant?.level} ${cant?.text}`);
const out0 = pull(auto, "beam", "front:a", [144]);
check("pulled out to the deck's edge: no overhang, the beam under the joists' ends", out0.framing.overhangFt === 0 && frameOf(out0).beams[0].lineY === 142.5, `${out0.framing.overhangFt} ${line(out0)}`);
const sIn = buildStructure(in2);
const cardF = partCard(sIn, partOfGrip(deckGrips(sIn).find((g) => g.id === "front:a")!));
const backAuto = tryChoice(in2, cardF.choices.find((c) => c.id === "front-auto")!).design;
check("on its card: \"Let the studio place this beam\" puts it back where the table put it", !!cardF.place && backAuto.framing.overhangFt === "auto" && line(backAuto) === line(auto), line(backAuto));
const flush = mk({ beamStyle: "flush" });
check("a flush beam is the deck's own edge: it is not pulled, and its card says why", !!grips(flush, "beam")[0]?.fixed && moveGrip(buildStructure(flush), "beam", "front:a", 100) === null && !partCard(buildStructure(flush), partOfGrip(grips(flush, "beam")[0])).place);

console.log("── a middle beam, anywhere along the joists");
const big = mk({}, deep);
const mb = grips(big, "beam").find((g) => !g.id.includes(":"))!;
check("a 16 x 20 deck: the middle beam the layout placed (9'-1\" from the house) can be taken hold of, a foot clear of the ledger and the front beam", line(big) === "2x8 | middle@109 4x12 [15 96 177]; front@216 4x10 [12 96 180]" && mb.at === 109 && mb.min === 14 && mb.max === 204 && !mb.byHand && /from the house/.test(mb.from), `${line(big)} ${JSON.stringify(mb)}`);
const m3 = pull(big, "beam", mb.id, [110, 111, 112]);
check("pulled 3 in.: it stands at 9'-4\", a beam of the builder's — the joists land on it there", JSON.stringify(m3.framing.beamLines) === JSON.stringify([{ id: mb.id, atFt: 112 / 12, zones: ["a"] }]) && frameOf(m3).beams[0].lineY === 112 && frameOf(m3).beams[0].by?.id === mb.id && loud(m3).length === 0, `${line(m3)} ${loud(m3).join()}`);
const said = deckChecks(buildStructure(m3)).find((c) => c.id === "deck-beams-set");
check("…the checks say it: 1 middle beam set by hand, the joists checked on the spans it makes — and no longer \"no joist reaches across\"", said?.level === "pass" && /1 middle beam set by hand/.test(said.text) && !deckChecks(buildStructure(m3)).some((c) => c.id === "joist-middle-beam"), JSON.stringify(said));
const m190 = pull(big, "beam", mb.id, [150, 190]);
const f190 = frameOf(m190);
check("pulled toward the front, to 15'-10\": the joists cannot span what it left behind, so a beam stands in the middle of that span — and the front beam gives way to keep its overhang inside the table", f190.beams.length === 3 && f190.beams[1].lineY === 190 && !!f190.beams[1].by && !f190.beams[0].by && f190.beamsByHand.mine === 1 && f190.beamsByHand.added === 1 && f190.zones.every((z) => z.ok) && loud(m190).length === 0, `${line(m190)} ${loud(m190).join()}`);
const m215 = pull(m190, "beam", mb.id, [210, 215]);
check("…on to 17'-11\": it is still the beam in the hand (it never drops out from under the pointer), a foot clear of the front beam", frameOf(m215).beams.some((b) => b.by?.id === mb.id && b.lineY === 215) && frameOf(m215).beams.every((b, k, all) => k === 0 || b.lineY - all[k - 1].lineY >= DECK_BEAM_LIMITS.gapIn) && m215.framing.beamLines.length === 1, line(m215));
const mBack = pull(m215, "beam", mb.id, [150, 109]);
check("…and pulled back to where it stood: the beam the spans added is gone again, the frame is the one it was", line(mBack).replace(/\*/g, "") === line(big), line(mBack));
const stuck = pull(big, "beam", mb.id, [500]);
check("pulled past the front beam: it stops a foot short of it", frameOf(stuck).beams.find((b) => b.by)!.lineY === 204, line(stuck));

console.log("── its posts go with it");
const sM = buildStructure(m3);
const pm = addPostUnder(sM, sM.frame!.beams[0].id)!;
const withPost = put(m3, pm.patch);
const pinM = withPost.framing.pins.find((p) => Math.round(p.atFt * 12) === pm.at)!;
check("a post added under the builder's middle beam is tied to that beam", pinM.beam === "middle" && pinM.line === mb.id && withPost.framing.pins.every((p) => p.line === mb.id), JSON.stringify(withPost.framing.pins));
const moved = pull(withPost, "beam", mb.id, [130]);
const fM = frameOf(moved);
check("…move the beam a foot and a half: every one of its posts is under it where it stands now, at the same places along it", fM.beams[0].lineY === 130 && withPost.framing.pins.every((p) => fM.posts.some((q) => q.by?.id === p.id && q.beamId === fM.beams[0].id && Math.abs(q.x - p.atFt * 12) < 0.5 && Math.abs(q.y - fM.beams[0].y) < 0.5)), line(moved));
const sP = buildStructure(big);
const pg = deckGrips(sP).find((g) => g.kind === "post" && g.beamId === sP.frame!.beams[0].id && g.at === 96)!;
const postFirst = pull(big, "post", pg.id, [90]);
check("a post pulled under a middle beam the LAYOUT placed: the beam becomes the builder's where it stands, so the post goes with it from then on", postFirst.framing.beamLines.length === 1 && Math.round(postFirst.framing.beamLines[0].atFt * 12) === 109 && postFirst.framing.pins.length === 3 && postFirst.framing.pins.every((p) => p.line === postFirst.framing.beamLines[0].id) && /middle@109\* 4x12 \[15\* 90\* 134 177\*\]/.test(line(postFirst)), `${line(postFirst)} ${JSON.stringify(postFirst.framing.beamLines)}`);

console.log("── add a beam, take one off");
const sAuto = buildStructure(auto);
const nb = addBeam(sAuto)!;
const twoBeams = put(auto, nb.patch);
check("a beam added under a 12-ft deck's joists: in the middle of their span; the frame is sized again for the shorter spans, every table still met", twoBeams.framing.beamLines.length === 1 && frameOf(twoBeams).beams.length === 2 && frameOf(twoBeams).beams[0].role === "middle" && frameOf(twoBeams).zones.every((z) => z.ok) && loud(twoBeams).length === 0, `${nb.at} ${line(twoBeams)} ${loud(twoBeams).join()}`);
const sT = buildStructure(twoBeams);
const cardM = partCard(sT, { kind: "deck-beam", id: sT.frame!.beams[0].id });
const offAgain = tryChoice(twoBeams, cardM.choices.find((c) => c.id === "line-off")!);
check("…on its card: where it stands, to type; \"Remove this beam — it was set by hand\" takes it off, and the frame is the one it was", !!cardM.place && gripShownIn(cardM.place) === nb.at && /set by hand/.test(cardM.choices.find((c) => c.id === "line-off")!.label) && offAgain.design.framing.beamLines.length === 0 && line(offAgain.design) === line(auto), line(offAgain.design));
check("the front beam's card offers one more beam under the joists", partCard(sAuto, { kind: "deck-beam", id: sAuto.frame!.beams[0].id }).choices.some((c) => c.id === "line-add"));
const rm = put(withPost, removeBeamLine(buildStructure(withPost), mb.id));
check("a beam of the builder's taken off takes its posts with it; the joists get a beam back where their span needs one", rm.framing.beamLines.length === 0 && rm.framing.pins.length === 0 && line(rm) === line(big), line(rm));
const noRoom = mk({ beamLines: [{ id: "x", atFt: 11.5, zones: [] }] });
const miss = deckChecks(buildStructure(noRoom)).find((c) => c.id === "deck-beam-not-set-1");
check("a beam asked for where there is no room (6 in. from the front beam): not placed, said, with the way to take it off — the frame as it was", line(noRoom) === line(auto) && frameOf(noRoom).beamLinesNotSet.length === 1 && miss?.level === "info" && applyDeckPatch(noRoom, miss.fix!.patch).framing.beamLines.length === 0, `${line(noRoom)} ${JSON.stringify(miss)}`);
const ell = mk({ beamLines: [{ id: "x", atFt: 7, zones: ["a"] }] }, { shape: { kind: "l", widthFt: 24, depthFt: 16, notch: { corner: "front-right", widthFt: 8, depthFt: 6 } } });
check("an L-shaped deck: a beam placed under one part of it stands under that part only", frameOf(ell).beams.filter((b) => b.by).length === 1 && frameOf(ell).beams.find((b) => b.by)!.zoneIds.join() === "a" && frameOf(ell).beams.find((b) => b.by)!.lineY === 84, line(ell));

console.log("── a free-standing deck: the beam by the house");
const free = mk({}, { shape: { kind: "rect", widthFt: 16, depthFt: 14 }, placement: "beside" });
const bk = grips(free, "beam").find((g) => g.id === "back:a")!;
check("it can be taken hold of too: it reads as how far in from the house side it stands (2 ft)", !!bk && bk.at === 24 && gripShownIn(bk) === 24 && bk.min === 0, JSON.stringify(bk));
const bk6 = pull(free, "beam", "back:a", [18, 12, 6]);
const fB = frameOf(bk6);
check("pulled to 6 in. from the edge: it stands there, the front beam where it was — each end has its own overhang now", bk6.framing.backOverhangFt === 0.5 && fB.beams.find((b) => b.role === "back")!.lineY === 6 && fB.beams.find((b) => b.role === "front")!.lineY === frameOf(free).beams.find((b) => b.role === "front")!.lineY && bk6.framing.overhangFt === "auto" && fB.zones.every((z) => z.ok), `${line(bk6)} ${bk6.framing.backOverhangFt}`);
check("…said by the checks, and put back by its card", deckChecks(buildStructure(bk6)).some((c) => c.id === "deck-beam-back-set" && c.level === "pass") && tryChoice(bk6, partCard(buildStructure(bk6), { kind: "deck-beam", id: fB.beams.find((b) => b.role === "back")!.id }).choices.find((c) => c.id === "back-auto")!).design.framing.backOverhangFt === "auto");
check("a deck hung on the house has no such beam: the figure is ignored there", line(mk({ backOverhangFt: 1 })) === line(auto));

console.log("── the roof's posts, along their sides");
const roofed = (roof: Record<string, unknown> = {}) => normalizeDeckDesign({ ...d0, shape: { kind: "rect", widthFt: 20, depthFt: 14 }, structure: "covered-deck", heightIn: 24, roof: { ...d0.roof, kind: "gable", attach: "wall", ...roof } });
const rd = roofed();
const rposts = (d: DeckDesign) => buildStructure(d).roof!.posts.map((p) => `${Math.round(p.x)},${Math.round(p.y)}${p.corner ? "c" : ""}${p.by ? "*" : ""}`).join(" ");
const rg = grips(rd, "roof-post");
check("a covered deck: the posts between the corners can be taken hold of, each along its side; the corner posts cannot", rg.length === 2 && rg.every((g) => g.axis === "y" && !g.byHand && (g.side === "left" || g.side === "right")) && buildStructure(rd).roof!.posts.filter((p) => p.corner).length === 2, JSON.stringify(rg.map((g) => [g.id, g.side, g.at])));
const right = rg.find((g) => g.side === "right")!;
const r6 = pull(rd, "roof-post", right.id, [right.at + 1, right.at + 6]);
check("pulled 6 in. away from the house: it stands there, a post of the builder's; the other side's post is not touched", JSON.stringify(r6.roof.pins) === JSON.stringify([{ id: right.id, side: "right", atFt: (right.at + 6) / 12 }]) && rposts(r6).includes(`236,${right.at + 6}*`) && rposts(r6).includes("5,82") && loud(r6, /^(header-|roof-)/).length === 0, `${rposts(r6)} ${JSON.stringify(r6.roof.pins)}`);
const rAdd = addRoofPost(buildStructure(rd), "front")!;
const rMore = put(rd, rAdd.patch);
check("a post added on the front: in the middle of it, between the two corners", rMore.roof.pins.length === 1 && rMore.roof.pins[0].side === "front" && buildStructure(rMore).roof!.posts.some((p) => p.by?.kind === "pin" && Math.abs(p.y - 164) < 1), `${rposts(rMore)} ${JSON.stringify(rMore.roof.pins)}`);
const sR = buildStructure(rd);
const corner = sR.roof!.posts.find((p) => p.corner)!;
check("…offered on a corner post's card, for each of the two sides that meet there — the gap the 3D's card had", ["rpin-add-front"].every((id) => partCard(sR, { kind: "roof-post", id: corner.id }).choices.some((c) => c.id === id)) && partCard(sR, { kind: "roof-post", id: corner.id }).choices.filter((c) => /^rpin-add-/.test(c.id)).length === 2, partCard(sR, { kind: "roof-post", id: corner.id }).choices.map((c) => c.id).join());
const od = roofed({ walls: { fill: "screen", sides: 3 }, openings: [defaultRoofOpening("o1", "front", 6)] });
const og = grips(od, "roof-post").filter((g) => g.id === "open:o1");
const o7 = pull(od, "roof-post", "open:o1", [72 + 7]);
check("an opening's post takes the opening with it: both posts, the same clear width — 7 in. along", og.length === 2 && og.every((g) => g.at === 72) && o7.roof.openings[0].atFt === 79 / 12 && o7.roof.openings[0].widthFt === od.roof.openings[0].widthFt, JSON.stringify(o7.roof.openings));

console.log("── in the 3D: the part itself is the handle");
const sc = deckScene(buildStructure(big));
const grabs = sc.handles.filter((h) => h.grab);
const all = deckGrips(buildStructure(big));
check("every post and beam that can be moved is a handle of its own, taken hold of by the part itself (its box), read in inches along its line", grabs.length === all.length && all.every((g) => grabs.some((h) => h.kind === g.kind && h.id === g.id && h.value === g.at && h.axis === g.axis && Math.abs(h.perUnit - 1 / 12) < 1e-9 && h.shown?.from === g.from)), `${grabs.length} of ${all.length}`);
const firstGrab = sc.handles.findIndex((h) => h.grab);
check("…after every knob in the list (the knobs' labels run beside the handles' from the start), and none of the old knobs is gone", firstGrab > 0 && sc.handles.slice(firstGrab).every((h) => h.grab) && ["width", "depth", "height"].every((k) => sc.handles.some((h) => h.kind === k && !h.grab)));
const postH = grabs.find((h) => h.kind === "post")!;
const postF = buildStructure(big).frame!.posts.find((p) => Math.abs(p.x / 12 - postH.x) < 0.01 && Math.abs(p.y / 12 - postH.y) < 0.01)!;
check("a post's box is the post: its width, from its footing to its beam", !!postF && Math.abs(postH.grab![3] - postH.grab![0] - 5.5 / 12) < 0.01 && Math.abs(postH.grab![5] - postH.grab![2] - postF.heightIn / 12) < 0.01, JSON.stringify(postH.grab));
const beamH = grabs.find((h) => h.kind === "beam" && h.id === "front:a")!;
check("a beam's box is the beam: its whole length", Math.abs(beamH.grab![3] - beamH.grab![0] - 16) < 0.01 && beamH.axis === "y");
const parsed = parseDeckScene(JSON.parse(JSON.stringify(sc)));
check("a saved scene keeps them", parsed?.handles.filter((h) => h.grab && h.shown).length === grabs.length);
check("the lower level's posts are not handles: they follow its own beams", !deckScene(buildStructure(mk({}, { lower: { on: true, widthFt: 12, depthFt: 8, dropIn: 14, align: "centre" } }))).handles.some((h) => h.grab && h.y > 12.5));
const dragged = [1, 2, 3, 4, 5, 6].reduce((dd, k) => put(dd, moveGrip(buildStructure(dd), "post", postH.id, postH.value + k)), big);
check("a drag of the 3D's handle — its name and the value it began at, plus the pointer's travel — moves the post an inch a step: 6 in. in six steps", grips(dragged, "post").some((g) => g.id === postH.id && g.at === Math.round(postH.value) + 6 && g.byHand), line(dragged));

console.log("── on the card: type it, or nudge it");
const sC = buildStructure(auto);
const pc = partCard(sC, { kind: "deck-post", id: sC.frame!.posts.find((p) => Math.round(p.x) === 96)!.id });
check("a post's card carries where it stands — 8'-0\" from the deck's left end — and how far it can go", pc.place?.kind === "post" && gripShownIn(pc.place) === 96 && /left end/.test(pc.place.from) && pc.place.min === 1 && pc.place.max === 191);
const typed = put(auto, moveGrip(sC, pc.place!.kind, pc.place!.id, gripAtFor(pc.place!, 5 * 12 + 7)));
check("5 ft 7 in. typed: the post stands at 5'-7\"", /\[12\* 67\* /.test(line(typed)), line(typed));
const sTy = buildStructure(typed);
const again = gripOfPart(sTy, { kind: "deck-post", id: sTy.frame!.posts.find((p) => Math.round(p.x) === 67)!.id })!;
check("…the card follows it by its name, and a nudge of +6 in. puts it at 6'-1\"", again.id === pc.place!.id && /\[12\* 73\* /.test(line(put(typed, moveGrip(sTy, again.kind, again.id, gripAtFor(again, gripShownIn(again) + 6))))), again.id);
const fc = partCard(sC, { kind: "deck-beam", id: sC.frame!.beams[0].id });
check("the front beam's card reads its overhang; 1 ft 6 in. typed pulls it out to there", gripShownIn(fc.place!) === 24 && put(auto, moveGrip(sC, "beam", fc.place!.id, gripAtFor(fc.place!, 18))).framing.overhangFt === 1.5);
check("no card slides a part \"1 ft\" any more", ![pc, fc, partCard(sR, { kind: "roof-post", id: sR.roof!.posts.find((p) => !p.corner)!.id })].some((c) => c.choices.some((ch) => /slide/i.test(ch.id + ch.label))));
check("a lower level's post has no place to type: it follows its own beams", (() => { const sl = buildStructure(mk({}, { lower: { on: true, widthFt: 12, depthFt: 8, dropIn: 14, align: "centre" } })); return !partCard(sl, { kind: "deck-post", id: sl.lower!.frame.posts[0].id, level: "lower" }).place; })());

console.log("── kept, and nothing else moved");
const kept = normalizeDeckDesign(JSON.parse(JSON.stringify(withPost)));
check("kept through a save: the beams, the posts tied to them, the back beam's overhang", JSON.stringify(kept.framing.beamLines) === JSON.stringify(withPost.framing.beamLines) && JSON.stringify(kept.framing.pins) === JSON.stringify(withPost.framing.pins) && normalizeDeckDesign(JSON.parse(JSON.stringify(bk6))).framing.backOverhangFt === 0.5);
const junk = normalizeDeckDesign({ ...auto, framing: { ...auto.framing, beamLines: [null, 3, { atFt: "x" }, { id: "a", atFt: 6 }, { id: "a", atFt: 8 }, { id: "b", atFt: 6.5, zones: ["a", 4, "zz"] }, { atFt: -4 }, ...new Array(30).fill(0).map((_, k) => ({ atFt: 10 + k * 1.5 }))], backOverhangFt: 99, pins: [{ id: "p", atFt: 5, beam: "front", line: "NOT OK" }] } });
check("junk is not kept: no place, no beam; no two with one id, none within a foot of another; no more than the list holds; the overhang inside its limits; a bad tie dropped", junk.framing.beamLines.length === DECK_BEAM_LIMITS.lines && junk.framing.beamLines[0].atFt === -4 && frameOf(junk).beamLinesNotSet.some((l) => l.id === junk.framing.beamLines[0].id) && new Set(junk.framing.beamLines.map((l) => l.id)).size === junk.framing.beamLines.length && !junk.framing.beamLines.some((l) => l.id === "b") && junk.framing.backOverhangFt === 4 && junk.framing.pins[0].line === undefined && junk.framing.pins[0].beam === "front", JSON.stringify(junk.framing.beamLines.slice(0, 4)));
const old = JSON.parse(JSON.stringify(big));
delete old.framing.beamLines;
delete old.framing.backOverhangFt;
check("a design saved before any of this is framed as it was", JSON.stringify(frameOf(normalizeDeckDesign(old)).beams) === JSON.stringify(frameOf(big).beams) && JSON.stringify(frameOf(normalizeDeckDesign(old)).posts) === JSON.stringify(frameOf(big).posts));
const low = mk({ beamLines: [{ id: "x", atFt: 6, zones: [] }] }, { lower: { on: true, widthFt: 12, depthFt: 8, dropIn: 14, align: "centre" } });
check("the lower level keeps its own beams: a beam placed on the deck is not placed on it", buildStructure(low).lower!.frame.beamsByHand.mine === 0 && !buildStructure(low).lower!.frame.beams.some((b) => b.by));
check("these checks are the builder's: the studio's auto-fix never touches them, and settling keeps the beams", ["deck-beams-set", "deck-beam-not-set-1", "deck-beam-back-set"].every((id) => !AUTO_FIX.test(id)) && JSON.stringify(settleDesign(withPost).design.framing.beamLines) === JSON.stringify(withPost.framing.beamLines));

console.log(bad ? `\n${bad} FAILED` : "\nALL PASS");
if (bad) process.exit(1);
