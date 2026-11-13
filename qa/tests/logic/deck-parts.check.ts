// THE BOARD'S COLOUR, THE RAIL'S COLOUR, AND CLICK-A-PART (2026-11-09; owner: "add the exact colors that exist for
// this brand … whatever the client sees, he gets. Check the railings, the styles and colors. On the 3D make the braces
// and beams click to delete, or replace, and you restructure the whole thing without that beam. Make it smart.").
//   · lib/deck/deckingColors — each maker's line in its own colours; the picked one rides with the board into the 3D,
//     the material list and the scope.
//   · lib/deck/catalog RAIL_COLORS, lib/deck/rails — a rail in a colour it is really stocked in (a composite rail is
//     never the deck board's colour), round black metal balusters, wire mesh panels.
//   · lib/deck/parts — a box of the 3D named as a part, what can be done with it, and what the tables say if it is.
// Pure: no model, no database.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/deck-parts.check.ts
import { DECKING, RAIL_COLORS, RAIL_METAL_BLACK, RAIL_STAINLESS, railColorOf } from "../../../src/lib/deck/catalog";
import { applyDeckPatch, deckChecks } from "../../../src/lib/deck/checks";
import { DECKING_COLORS, deckingColors } from "../../../src/lib/deck/deckingColors";
import { defaultDeckDesign, normalizeDeckDesign, type DeckDesign } from "../../../src/lib/deck/design";
import { partAt, partBoxes, partCard, structureChanges, takenOut, tryChoice, type PartCard, type PartRef } from "../../../src/lib/deck/parts";
import { deckScope, priceDeck } from "../../../src/lib/deck/pricing";
import { railWords } from "../../../src/lib/deck/rails";
import { RAIL_INFILL_ROLE, deckScene, parseDeckScene, type DeckScene } from "../../../src/lib/deck/scene";
import { buildStructure, type DeckStructure } from "../../../src/lib/deck/structure";

let bad = 0;
const check = (name: string, ok: boolean, extra?: unknown) => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && extra !== undefined ? `  ${JSON.stringify(extra)}` : ""}`);
};
const base = defaultDeckDesign({ state: "WA", frostIn: 18 });
type Patch = Parameters<typeof applyDeckPatch>[1];
const mk = (p: Patch, from: DeckDesign = base) => applyDeckPatch(from, p);
const HEX = /^#[0-9a-f]{6}$/;

/* ── the boards' colours ── */
console.log("── the colours each board line is sold in");
const brands = DECKING.filter((d) => d.brand);
const without = brands.filter((d) => deckingColors(d.id).length === 0).map((d) => d.id);
check("every maker's line has its colours, but the two whose maker's page could not be read (they take a typed colour)", without.sort().join() === "duralife-landscapes,veranda-composite", without);
check("a colour list only for a board that is on the list", Object.keys(DECKING_COLORS).every((id) => DECKING.some((d) => d.id === id)));
const all = Object.entries(DECKING_COLORS).flatMap(([id, list]) => list.map((c) => ({ line: id, ...c })));
check("every colour has a name, an id of its own in its line, and a look", all.every((c) => c.name.trim() === c.name && c.name.length > 1 && /^[a-z0-9-]+$/.test(c.id) && HEX.test(c.hex) && (c.hex2 === undefined || (HEX.test(c.hex2) && c.hex2 !== c.hex))) && Object.values(DECKING_COLORS).every((list) => new Set(list.map((c) => c.id)).size === list.length), all.find((c) => !HEX.test(c.hex)));
const lineage = deckingColors("trex-transcend-lineage").map((c) => c.name);
check("Trex Transcend Lineage: the seven colours Trex lists", lineage.join() === "Island Mist,Biscayne,Rainier,Carmel,Jasper,Hatteras,Salt Flat", lineage);
check("a wood board and a generic board have no maker's list", deckingColors("cedar-54").length === 0 && deckingColors("composite-better").length === 0 && deckingColors(null).length === 0);

const jasper = mk({ decking: { product: "trex-transcend-lineage", color: "jasper" } });
check("a colour of the line is kept", jasper.decking.color === "jasper");
check("a colour that is not the line's is dropped; another board asks again", mk({ decking: { product: "trex-transcend-lineage", color: "spiced-rum" } }).decking.color === "" && mk({ decking: { product: "trex-transcend" } }, jasper).decking.color === "");
check("an older design, with no colour at all, reads as none picked", normalizeDeckDesign({ ...base, decking: { product: "trex-transcend-lineage" } }).decking.color === "" && normalizeDeckDesign({ ...base, decking: { product: "trex-transcend-lineage" } }).decking.ownColor === null);
const sJ = buildStructure(jasper);
const jc = deckingColors("trex-transcend-lineage").find((c) => c.id === "jasper")!;
check("the frame's board is named with its colour and takes its look", sJ.frame!.decking.label === "Trex Transcend Lineage in Jasper" && sJ.frame!.decking.color === jc.hex && sJ.frame!.decking.color2 === jc.hex2, sJ.frame!.decking);
const sceneJ = deckScene(sJ);
check("the 3D is in the colour, both tones of a streaked board", sceneJ.colors.decking === jc.hex && sceneJ.colors.decking2 === jc.hex2 && /Trex Transcend Lineage in Jasper/.test(sceneJ.facts), sceneJ.colors);
const back = parseDeckScene(JSON.parse(JSON.stringify(sceneJ)));
check("the scene kept with a proposal reads back with both tones", !!back && back.colors.decking === jc.hex && back.colors.decking2 === jc.hex2);
const pkgJ = priceDeck(jasper);
check("the material list orders the board by its colour", pkgJ.bom.filter((l) => l.step === "decking" && l.kind === "boards").every((l) => /Trex Transcend Lineage in Jasper/.test(l.label)) && pkgJ.bom.some((l) => /in Jasper/.test(l.label)));
check("the client's scope names it", deckScope(pkgJ).some((t) => /Trex Transcend Lineage in Jasper decking/.test(t)));
check("the colour does not move the price (one rate a line)", Math.abs(pkgJ.subtotal - priceDeck(mk({ decking: { product: "trex-transcend-lineage" } })).subtotal) < 0.005);
const solid = buildStructure(mk({ decking: { product: "trex-enhance-basics", color: "saddle" } }));
check("a solid board has one tone", solid.frame!.decking.color2 === undefined && deckScene(solid).colors.decking2 === undefined);
const own = buildStructure(mk({ decking: { product: "cedar-54", ownColor: { name: "  Cabot   cedar stain ", hex: "#A0522D" } } }));
check("a colour typed in: its name cleaned, its look kept, on any board", own.design.decking.ownColor?.name === "Cabot cedar stain" && own.design.decking.ownColor.hex === "#a0522d" && own.frame!.decking.label === "Western red cedar 5/4x6 in Cabot cedar stain" && deckScene(own).colors.decking === "#a0522d");
check("a typed colour wins over the line's", buildStructure(mk({ decking: { ownColor: { name: "Shop sample 12", hex: "#112233" } } }, jasper)).frame!.decking.label === "Trex Transcend Lineage in Shop sample 12");
check("a colour with no name is no colour", mk({ decking: { ownColor: { name: "   ", hex: "#112233" } } }).decking.ownColor === null);
const ownBoard = buildStructure(mk({ custom: { decking: { name: "Yard special 1x6", price: 4 } }, decking: { color: "jasper" } }, jasper));
check("a board of the contractor's own takes no maker's colour", ownBoard.frame!.decking.label === "Yard special 1x6");

/* ── the rail ── */
console.log("── the railing's colours and infill");
const high = (p: Patch) => mk({ heightIn: 60, shape: { kind: "rect", widthFt: 20, depthFt: 12 }, ...p });
const comp = buildStructure(high({ rail: { type: "composite" }, decking: { product: "trex-transcend-lineage", color: "jasper" } }));
check("every kit system has stock colours, the first its usual one; wood has none", (["aluminum", "composite", "vinyl", "cable", "glass", "custom"] as const).every((t) => (RAIL_COLORS[t]?.length ?? 0) >= 3 && RAIL_COLORS[t]!.every((c) => HEX.test(c.hex))) && railColorOf("treated", "") === null && railColorOf("cedar", "black") === null && railColorOf("aluminum", "")?.id === "black");
check("a composite rail is white until another colour is picked — never the deck board's colour", comp.rails.color?.id === "white" && deckScene(comp).colors.rail === "#f2f0ec" && deckScene(comp).colors.rail !== deckScene(comp).colors.decking);
check("the rail is named by its colour", /ft of white composite railing, 36 in\., balusters/.test(railWords(comp.rails)), railWords(comp.rails));
const bronze = buildStructure(high({ rail: { type: "aluminum", color: "bronze" } }));
check("a picked colour is drawn and named", bronze.rails.color?.id === "bronze" && deckScene(bronze).colors.rail === "#4d4435" && /bronze aluminum railing/.test(railWords(bronze.rails)) && priceDeck(bronze.design).lines.some((l) => /Railing — bronze aluminum/.test(l.name)));
check("a colour belongs to its system: another system starts on its own usual one", mk({ rail: { type: "vinyl" } }, bronze.design).rail.color === "" && buildStructure(mk({ rail: { type: "vinyl" } }, bronze.design)).rails.color?.id === "white");
check("an aluminum system's pickets are thin metal, in the rail's own colour", bronze.rails.baluster === "metal" && bronze.rails.infillColor === null && bronze.rails.members.filter((m) => m.role === "baluster").every((m) => m.sx === 0.75) && deckScene(bronze).colors.railInfill === undefined);
const cable = deckScene(buildStructure(high({ rail: { type: "cable", color: "white" } })));
check("cable is stainless in a frame of the colour picked", cable.colors.rail === "#f0efea" && cable.colors.railInfill === RAIL_STAINLESS);
const round = buildStructure(high({ rail: { type: "composite", baluster: "round" } }));
const square = buildStructure(high({ rail: { type: "composite" } }));
const rb = round.rails.members.filter((m) => m.role === "baluster");
check("round black metal balusters in a composite rail: thin, closer together, black", round.rails.baluster === "metal" && rb.length > square.rails.members.filter((m) => m.role === "baluster").length && rb.every((m) => m.sx === 0.75 && m.sy === 0.75) && deckScene(round).colors.railInfill === RAIL_METAL_BLACK && /round black metal balusters/.test(railWords(round.rails)));
const sceneR = deckScene(round);
check("the 3D can tell the infill from the frame", sceneR.boxes.some((_, i) => RAIL_INFILL_ROLE.test(sceneR.legend[sceneR.tags[i]]?.role ?? "")) && sceneR.boxes.some((_, i) => sceneR.legend[sceneR.tags[i]]?.role === "rail post"));
const woodRound = priceDeck(high({ rail: { type: "treated", baluster: "round" } }));
check("on a wood rail they are bought by the piece, in place of the 2x2s", woodRound.bom.some((l) => l.id === "rail-metal-balusters" && l.qty === woodRound.structure.rails.balusters && l.cost > 0) && !woodRound.bom.some((l) => /balusters/.test(l.label) && /2x2/.test(l.label)), woodRound.bom.filter((l) => l.step === "rails").map((l) => l.label));
const mesh = priceDeck(high({ rail: { type: "cedar", infill: "mesh" } }));
const wires = mesh.structure.rails.members.filter((m) => m.role === "mesh");
check("wire mesh panels: one a bay, drawn wire by wire, black, bought by the panel", mesh.structure.rails.infill === "mesh" && mesh.structure.rails.meshPanels > 0 && wires.length > mesh.structure.rails.meshPanels * 8 && wires.every((m) => m.sx > 0 && m.sz > 0) && deckScene(mesh.structure).colors.railInfill === RAIL_METAL_BLACK && mesh.bom.some((l) => l.id === "rail-mesh-panels" && l.qty === mesh.structure.rails.meshPanels) && !mesh.structure.rails.members.some((m) => m.role === "baluster"), { panels: mesh.structure.rails.meshPanels, wires: wires.length });
check("the scene with a mesh rail reads back whole", !!parseDeckScene(JSON.parse(JSON.stringify(deckScene(mesh.structure)))));
check("an older rail, with no colour and no baluster kind, reads as the usual", normalizeDeckDesign({ ...base, rail: { type: "aluminum", heightIn: 36 } }).rail.color === "" && normalizeDeckDesign({ ...base, rail: { type: "aluminum" } }).rail.baluster === "square");

/* ── a part of the 3D ── */
console.log("── a part of the picture, named");
const refsOf = (s: DeckStructure, scene: DeckScene) => {
  const m = new Map<string, { ref: PartRef; box: number }>();
  scene.boxes.forEach((_, i) => {
    const r = partAt(s, scene, i);
    if (r && !m.has(`${r.kind}|${r.id}|${r.level ?? ""}`)) m.set(`${r.kind}|${r.id}|${r.level ?? ""}`, { ref: r, box: i });
  });
  return [...m.values()];
};
const first = (s: DeckStructure, scene: DeckScene, kind: PartRef["kind"], id?: string) => refsOf(s, scene).find((x) => x.ref.kind === kind && (id === undefined || x.ref.id === id))?.ref ?? null;
const choice = (card: PartCard, id: string) => card.choices.find((c) => c.id === id) ?? null;

const tall = mk({ shape: { kind: "rect", widthFt: 20, depthFt: 14 }, heightIn: 96, placement: "beside" });
const sT = buildStructure(tall);
const scT = deckScene(sT);
const kinds = (s: DeckStructure, sc: DeckScene) => new Set(refsOf(s, sc).map((x) => x.ref.kind));
check("a free-standing deck: its braces, beams, posts, joists, rim and blocking are all named", ["deck-brace", "deck-beam", "deck-post", "joist", "rim", "blocking", "fascia"].every((k) => kinds(sT, scT).has(k as PartRef["kind"])), [...kinds(sT, scT)]);
const braces = refsOf(sT, scT).filter((x) => x.ref.kind === "deck-brace");
check("every knee brace is a part of its own", braces.length === sT.frame!.hardware.braces && braces.length === 8, braces.length);
check("a box that is not a part (a board, a bolt) names nothing; a flat face is named by its layer", partAt(sT, scT, scT.boxes.findIndex((b) => b[0] === 8)) === null && partAt(sT, scT, null, "ground") === null && partAt(sT, scT, 99999) === null);
check("a beam's plies light together", partBoxes(sT, scT, first(sT, scT, "deck-beam")!).length >= 1 && partBoxes(sT, scT, braces[0].ref, true).length === 8 && partBoxes(sT, scT, braces[0].ref).length === 1);

console.log("── take a brace out");
const pkgT = priceDeck(tall);
const bCard = partCard(sT, braces[0].ref);
const one = tryChoice(tall, choice(bCard, "one")!, {}, pkgT);
check("this one brace: one fewer, a little saved, and the checks say so", one.design.framing.bracesOff.length === 1 && /deck braces 8 → 7/.test(one.changes.join()) && one.delta < 0 && one.delta > -80 && one.issues.some((t) => /taken out by hand/.test(t)) && !one.nothing && !one.misses, one);
const sOne = buildStructure(one.design);
check("it is that brace that is gone, and the rest stand", sOne.frame!.hardware.braces === 7 && sOne.frame!.bracesLeftOut === 1 && !sOne.frame!.sticks.some((st) => st.role === "brace" && st.of === braces[0].ref.id));
const allOut = tryChoice(tall, choice(bCard, "all")!, {}, pkgT);
check("all of them: none left, more saved, the warning with its fix", allOut.design.framing.braces === false && /deck braces 8 → 0/.test(allOut.changes.join()) && allOut.delta < one.delta && allOut.issues.some((t) => /no knee braces/.test(t)));
const outList = takenOut(sOne);
check("what was taken out is listed, and put back by its patch", outList.length === 1 && /1 deck brace/.test(outList[0].what) && buildStructure(applyDeckPatch(one.design, outList[0].patch)).frame!.hardware.braces === 8 && takenOut(sT).length === 0);
check("the check's own fix puts it back too", (() => { const c = deckChecks(sOne).find((x) => x.id === "post-braces-out"); return !!c?.fix && buildStructure(applyDeckPatch(one.design, c.fix.patch)).frame!.hardware.braces === 8; })());
check("a list of keys is kept clean: short plain keys, each once", normalizeDeckDesign({ ...tall, framing: { ...tall.framing, bracesOff: ["b1:a:x", "b1:a:x", "<script>", 7, "x".repeat(40)] } }).framing.bracesOff.join() === "b1:a:x");
const two = mk({ shape: { kind: "rect", widthFt: 24, depthFt: 16 }, heightIn: 72, placement: "detached", lower: { on: true, widthFt: 12, depthFt: 8, dropIn: 21, align: "centre" } });
const sTwo = buildStructure(two);
const lowBrace = refsOf(sTwo, deckScene(sTwo)).find((x) => x.ref.kind === "deck-brace" && x.ref.level === "lower");
if (lowBrace) {
  const after = buildStructure(tryChoice(two, choice(partCard(sTwo, lowBrace.ref), "one")!).design);
  check("a lower-level brace is taken out of the lower level only", /^L:/.test(lowBrace.ref.id) && after.lower!.frame.bracesLeftOut === 1 && after.frame!.bracesLeftOut === 0 && after.frame!.hardware.braces === sTwo.frame!.hardware.braces);
} else check("a lower level this low has no braces to take out", (sTwo.lower?.frame.hardware.braces ?? 0) === 0);

console.log("── beams and posts under the deck");
const fixed = mk({ shape: { kind: "rect", widthFt: 16, depthFt: 16 }, heightIn: 48, framing: { joist: "2x8", spacingIn: 16 } });
const sF = buildStructure(fixed);
const mid = sF.frame!.beams.find((b) => b.role === "middle");
check("2x8 joists across 16 ft need a beam in the middle", !!mid, sF.frame!.beams.map((b) => b.role));
if (mid) {
  const card = partCard(sF, { kind: "deck-beam", id: mid.id, level: "upper" });
  const re = choice(card, "re-span");
  const o = re ? tryChoice(fixed, re) : null;
  check("its card offers to take it out by re-spanning the joists, and the tables do", !!o && !o.misses && buildStructure(o.design).frame!.beams.length < sF.frame!.beams.length && /joists 2x8 @ 16 in\. → /.test(o.changes.join()) && /deck beams \d → \d/.test(o.changes.join()), o?.changes);
}
const deep = mk({ shape: { kind: "rect", widthFt: 16, depthFt: 26 }, heightIn: 48 });
const sD = buildStructure(deep);
const midD = sD.frame!.beams.find((b) => b.role === "middle");
check("where no joist spans the depth the middle beam stays, and the card says why", !!midD && !choice(partCard(sD, { kind: "deck-beam", id: midD!.id, level: "upper" }), "re-span") && /stays/.test(partCard(sD, { kind: "deck-beam", id: midD!.id, level: "upper" }).stays ?? ""));
const backBeam = sT.frame!.beams.find((b) => b.role === "back")!;
const led = tryChoice(tall, choice(partCard(sT, { kind: "deck-beam", id: backBeam.id, level: "upper" }), "ledger")!, {}, pkgT);
check("the beam by the house comes out when the deck hangs on a ledger", !led.misses && led.design.placement === "attached" && led.changes.some((t) => /a ledger on the house/.test(t)));
check("on a wall that takes no ledger it stays, with the wall's own reason", (() => { const d = mk({ wall: "brick-veneer" }, tall); const s = buildStructure(d); const c = partCard(s, { kind: "deck-beam", id: s.frame!.beams.find((b) => b.role === "back")!.id, level: "upper" }); return !choice(c, "ledger") && /veneer/i.test(c.stays ?? ""); })());
const wide = mk({ shape: { kind: "rect", widthFt: 30, depthFt: 12 }, heightIn: 48, framing: { beamKind: "built-up", beam: "2-2x8" } });
const sW = buildStructure(wide);
const beamW = sW.frame!.beams[0];
const postCard = partCard(sW, { kind: "deck-post", id: sW.frame!.posts.find((p) => p.beamId === beamW.id && !p.corner)!.id, level: "upper" });
const fewer = choice(postCard, "fewer");
check("a post comes out when a deeper beam spans it: the card finds the beam", !!fewer && (() => { const o = tryChoice(wide, fewer!); const b = buildStructure(o.design).frame!.beams[0]; return b.postXs.length < beamW.postXs.length && /deck posts/.test(o.changes.join()) && !buildStructure(o.design).frame!.flags.beamBeyondTable.length; })(), postCard.choices.map((c) => c.label));
check("a row of sizes marks the one in use", postCard.choices.filter((c) => c.row && /Post size/.test(c.row)).length === 4 && postCard.choices.filter((c) => c.tone === "size" && c.current).length === 1 && partCard(sT, first(sT, scT, "joist")!).choices.filter((c) => c.current).map((c) => c.label).join() === "Auto,Auto");
check("a joist cannot come out, and says so", /cannot come out/.test(partCard(sT, first(sT, scT, "joist")!).stays ?? "") && partCard(sT, first(sT, scT, "joist")!).choices.every((c) => c.tone === "size"));

console.log("── the roof: braces, the beam nothing bears on, the ridge");
const gable = mk({ structure: "covered-deck", shape: { kind: "rect", widthFt: 20, depthFt: 14 }, heightIn: 36 });
const sG = buildStructure(gable);
const scG = deckScene(sG);
const pkgG = priceDeck(gable);
check("a covered deck: roof posts, beams, braces, rafters, the ridge, ties and gutters are named", ["roof-post", "roof-beam", "roof-brace", "rafter", "ridge", "rafter-tie", "gutter"].every((k) => kinds(sG, scG).has(k as PartRef["kind"])), [...kinds(sG, scG)]);
const idle = sG.roof!.headers.filter((h) => h.idle);
check("the beam across the gable end carries nothing; the side beams carry the rafters", idle.length === 1 && sG.roof!.headers.filter((h) => !h.idle && !h.cross).length === 2 && !idle[0].kingPost, sG.roof!.headers.map((h) => [h.id, !!h.idle]));
const endRef: PartRef = { kind: "roof-beam", id: idle[0].id };
const endCard = partCard(sG, endRef);
const rm = tryChoice(gable, choice(endCard, "remove")!, {}, pkgG);
const sRm = buildStructure(rm.design);
check("it can be taken out: the beam and its braces go, the posts stay, money is saved", /Nothing bears on it/.test(endCard.does) && !rm.misses && sRm.roof!.headers.length === sG.roof!.headers.length - 1 && sRm.roof!.posts.length === sG.roof!.posts.length && sRm.roof!.hardware.braces < sG.roof!.hardware.braces && rm.delta < -50 && /roof beams 3 → 2/.test(rm.changes.join()), rm);
check("the roof still stands as it did: same rafters, same ridge, no new failure", sRm.roof!.rafters.count === sG.roof!.rafters.count && sRm.roof!.ridge?.kind === sG.roof!.ridge?.kind && !deckChecks(sRm).some((c) => c.level === "fail") && deckChecks(sRm).some((c) => c.id === "roof-end-beam" && c.level === "info" && !!c.fix));
check("the 3D draws without it, and the scene is whole", (() => { const sc = deckScene(sRm); return !!parseDeckScene(JSON.parse(JSON.stringify(sc))) && sc.boxes.length < scG.boxes.length && !refsOf(sRm, sc).some((x) => x.ref.kind === "roof-beam" && x.ref.id === idle[0].id); })());
check("it is listed as taken out, and comes back", takenOut(sRm).some((t) => t.id === "roof-beams") && buildStructure(applyDeckPatch(rm.design, takenOut(sRm).find((t) => t.id === "roof-beams")!.patch)).roof!.headers.length === sG.roof!.headers.length);
const bearing = sG.roof!.headers.find((h) => !h.idle && !h.cross)!;
check("a beam the rafters rest on cannot be taken out — in the card, or by hand in the design", !choice(partCard(sG, { kind: "roof-beam", id: bearing.id }), "remove") && /cannot come out/.test(partCard(sG, { kind: "roof-beam", id: bearing.id }).stays ?? "") && buildStructure(mk({ roof: { ...gable.roof, headersOff: [bearing.id] } }, gable)).roof!.headers.some((h) => h.id === bearing.id));
const ridgeBeam = mk({ roof: { ...gable.roof, ridge: "beam" } }, gable);
const sB = buildStructure(ridgeBeam);
const kingHeader = sB.roof!.headers.find((h) => h.kingPost && !h.cross);
check("under a ridge beam the end beam holds its king post: left out by hand, the engine puts it back", !!kingHeader && buildStructure(mk({ roof: { ...ridgeBeam.roof, headersOff: [kingHeader!.id] } }, ridgeBeam)).roof!.headers.some((h) => h.id === kingHeader!.id) && buildStructure(mk({ roof: { ...ridgeBeam.roof, headersOff: [kingHeader!.id] } }, ridgeBeam)).roof!.headersLeftOut.length === 0);
if (kingHeader) {
  const kc = partCard(sB, { kind: "roof-beam", id: kingHeader.id });
  const tr = choice(kc, "trusses");
  const o = tr ? tryChoice(ridgeBeam, tr) : null;
  const sAfter = o ? buildStructure(o.design) : null;
  check("its card says why it stays, and offers the framing that frees it: trusses, and the beam out", /king post/.test(kc.stays ?? "") && !choice(kc, "remove") && !!o && !o.misses && !!sAfter?.roof?.trusses && !sAfter.roof.headers.some((h) => h.id === kingHeader.id) && sAfter.roof.kingPosts === 0 && !sAfter.roof.ridge, o?.changes);
}
const tie = partCard(sG, { kind: "rafter-tie", id: "" });
const toBeam = tryChoice(gable, choice(tie, "beam")!, {}, pkgG);
check("a rafter tie: the ties go when the ridge is carried on a beam, or the roof is trussed", !toBeam.misses && /rafter ties \d+ → 0/.test(toBeam.changes.join()) && buildStructure(toBeam.design).roof!.ridge?.kind === "beam" && !!choice(tie, "trusses") && !tryChoice(gable, choice(tie, "trusses")!, {}, pkgG).misses);
const truss = buildStructure(mk({ roof: { ...gable.roof, ridge: "trusses" } }, gable));
check("a truss: back to rafters on a beam or a board; no truss comes out alone", partCard(truss, { kind: "truss", id: "" }).choices.map((c) => c.id).sort().join() === "beam,board" && /cannot come out alone/.test(partCard(truss, { kind: "truss", id: "" }).stays ?? ""));
const crossed = mk({ shape: { kind: "rect", widthFt: 24, depthFt: 14 }, roof: { ...gable.roof, attach: "free", ridge: "beam", crossBeams: 2 } }, gable);
const sX = buildStructure(crossed);
const cross = sX.roof!.headers.find((h) => h.cross);
check("a gable's ridge beam on two cross beams", sX.roof!.crossBeams === 2 && !!cross);
if (cross) {
  const xc = partCard(sX, { kind: "cross-beam", id: cross.id });
  const less = tryChoice(crossed, choice(xc, "one-less")!);
  check("a cross beam comes out: one fewer, the ridge re-sized for the longer span", !less.misses && buildStructure(less.design).roof!.crossBeams === 1 && /cross beams 2 → 1/.test(less.changes.join()) && /king posts/.test(less.changes.join()));
  const kp = refsOf(sX, deckScene(sX)).find((x) => x.ref.kind === "king-post" && x.ref.id === cross.id);
  check("the king post on it is the same choice", !!kp && !!choice(partCard(sX, kp!.ref), "one-less"));
  check("the ridge beam offers another cross beam under it while there is room", !choice(partCard(sX, { kind: "ridge", id: "" }), "cross") === (sX.roof!.crossBeams >= 3) && !!choice(partCard(buildStructure(ridgeBeam), { kind: "ridge", id: "" }), "cross"));
}
const rBrace = refsOf(sG, scG).filter((x) => x.ref.kind === "roof-brace");
const rOne = tryChoice(gable, choice(partCard(sG, rBrace[0].ref), "one")!, {}, pkgG);
check("a roof brace: this one, or all of them", rBrace.length === sG.roof!.hardware.braces && buildStructure(rOne.design).roof!.hardware.braces === sG.roof!.hardware.braces - 1 && buildStructure(rOne.design).roof!.bracesLeftOut === 1 && buildStructure(tryChoice(gable, choice(partCard(sG, rBrace[0].ref), "all")!, {}, pkgG).design).roof!.hardware.braces === 0);
const free = mk({ roof: { ...gable.roof, attach: "free" } }, gable);
check("on a free-standing roof a brace taken out is a warning; on the house it is a note", deckChecks(buildStructure(mk({ roof: { ...free.roof, bracesOff: [refsOf(buildStructure(free), deckScene(buildStructure(free))).find((x) => x.ref.kind === "roof-brace")!.ref.id] } }, free))).some((c) => c.id === "roof-braces-out" && c.level === "warn") && deckChecks(buildStructure(rOne.design)).some((c) => c.id === "roof-braces-out" && c.level === "info"));
const shed = buildStructure(mk({ roof: { ...gable.roof, kind: "shed" } }, gable));
check("a shed roof: its sloping sides carry nothing and can come out; the low beam cannot", shed.roof!.headers.filter((h) => h.idle).length === 2 && shed.roof!.headers.some((h) => !h.idle));
const hip = buildStructure(mk({ roof: { ...gable.roof, kind: "hip", attach: "free" } }, gable));
check("a hip roof: every beam carries rafters — none can come out", hip.roof!.headers.every((h) => !h.idle));
check("corner posts stay; the card says so", /corner post/i.test(partCard(sG, first(sG, scG, "roof-post")!).stays ?? ""));
check("gutters, the fascia and a stair come out in one tap; the steps between two levels do not", tryChoice(gable, choice(partCard(sG, { kind: "gutter", id: "" }), "remove")!, {}, pkgG).changes.includes("no gutters") && tryChoice(tall, choice(partCard(sT, { kind: "fascia", id: "" }), "remove")!, {}, pkgT).delta < 0 && partCard(sTwo, { kind: "stair", id: "between-levels" }).choices.length === 0);
check("nothing changed reads as nothing changed", structureChanges(sG, sG).length === 0 && structureChanges(sT, buildStructure(tall)).length === 0);
check("a size the tables refuse is put straight back (the settle), so the card can say so", (() => { const c = partCard(sG, { kind: "rafter", id: "" }).choices.find((x) => x.id === "rafter-2x6"); if (!c) return false; const o = tryChoice(mk({ shape: { kind: "rect", widthFt: 30, depthFt: 14 } }, gable), c); return typeof o.delta === "number"; })());

/* ── a border in a second colour; a deck board on a kit rail (2026-11-10) ── */
console.log("── a border in a second colour");
const framed = mk({ decking: { product: "trex-transcend-lineage", color: "jasper", border: 1, borderColor: "biscayne" } });
const sBd = buildStructure(framed);
const bis = deckingColors("trex-transcend-lineage").find((c) => c.id === "biscayne")!;
const plainBorder = buildStructure(mk({ decking: { borderColor: "" } }, framed));
check("the border takes a second colour of the same line, named as the order names it", sBd.frame!.decking.border?.name === "Biscayne" && sBd.frame!.decking.border.label === "Trex Transcend Lineage in Biscayne" && sBd.frame!.decking.border.color === bis.hex && sBd.frame!.decking.label === "Trex Transcend Lineage in Jasper", sBd.frame!.decking.border);
check("it is bought apart: its own boards, off the deck's own count", sBd.surface!.borderStock.length === 1 && sBd.surface!.borderStock[0].count > 0 && plainBorder.surface!.borderStock.length === 0 && sBd.surface!.stock.reduce((a, x) => a + x.count * x.lengthFt, 0) < plainBorder.surface!.stock.reduce((a, x) => a + x.count * x.lengthFt, 0), [sBd.surface!.borderStock, sBd.surface!.stock, plainBorder.surface!.stock]);
const scBd = deckScene(sBd);
check("the 3D draws the border boards in it, the field in the deck's colour", scBd.colors.border === bis.hex && scBd.colors.border2 === bis.hex2 && scBd.colors.decking === jc.hex && scBd.boxes.some((_, i) => /border board$/.test(scBd.legend[scBd.tags[i]]?.role ?? "")) );
// 2026-11-13 — a deck builder: "the picture-frame border does not visibly change the deck". In the deck's own colour it
// was drawn exactly like the field. It is drawn a shade deeper (a drafting tone, said in the legend); no border, no tone.
const plainScene = deckScene(plainBorder);
check("a border in the deck's OWN colour is drawn a shade deeper, so the frame shows — and the legend says it is the deck's colour", /^#[0-9a-f]{6}$/.test(plainScene.colors.border ?? "") && plainScene.colors.border !== plainScene.colors.decking && plainScene.colors.border !== bis.hex && plainScene.legend.some((l) => /border board$/.test(l.role) && /deck's own colour/.test(l.note)), `${plainScene.colors.border} vs ${plainScene.colors.decking}`);
const pkgBd = priceDeck(framed);
const borderLine = pkgBd.bom.find((l) => l.id.startsWith("boards-border-"));
check("the material list has the border as its own line, by its colour; the scope says it", !!borderLine && /^Trex Transcend Lineage in Biscayne × \d+ ft — border$/.test(borderLine.label) && borderLine.cost > 0 && pkgBd.bom.filter((l) => l.id.startsWith("boards-") && !l.id.startsWith("boards-border-")).every((l) => /in Jasper/.test(l.label)) && deckScope(pkgBd).some((t) => /picture-frame border in Biscayne/.test(t)), borderLine?.label);
check("the same colour as the deck is no second colour; no border, no border colour", !buildStructure(mk({ decking: { borderColor: "jasper" } }, framed)).frame!.decking.border && !buildStructure(mk({ decking: { border: 0 } }, framed)).frame!.decking.border && deckScene(buildStructure(mk({ decking: { border: 0 } }, framed))).colors.border === undefined);
check("a colour of another line is dropped; another board asks again", mk({ decking: { borderColor: "spiced-rum" } }, framed).decking.borderColor === "" && mk({ decking: { product: "trex-transcend" } }, framed).decking.borderColor === "");
const clipped = buildStructure(mk({ shape: { kind: "rect", widthFt: 16, depthFt: 12, front: { kind: "clipped", bulgeFt: 2, clipFt: 3 } } }, framed));
const scClip = deckScene(clipped);
check("on a clipped front the border's cut pieces are told apart too, and the scene reads back with them", (scClip.diagonal?.border?.length ?? 0) > 0 && scClip.diagonal!.border!.every((i) => i < scClip.diagonal!.boards.length) && (() => { const b = parseDeckScene(JSON.parse(JSON.stringify(scClip))); return !!b && b.colors.border === bis.hex && b.diagonal?.border?.length === scClip.diagonal!.border!.length; })(), scClip.diagonal?.border?.length);
check("the scene with a border colour reads back whole", (() => { const b = parseDeckScene(JSON.parse(JSON.stringify(scBd))); return !!b && b.colors.border === bis.hex && b.colors.border2 === bis.hex2; })());

console.log("── a deck board on a kit rail");
const drink = buildStructure(high({ rail: { type: "composite", drink: true }, decking: { product: "trex-transcend-lineage", color: "jasper" } }));
const noDrink = buildStructure(high({ rail: { type: "composite" }, decking: { product: "trex-transcend-lineage", color: "jasper" } }));
const caps = drink.rails.members.filter((m) => m.role === "rail-cap");
check("a composite rail takes a deck board on top: as wide and thick as the deck's board, over every level run", drink.rails.drinkLf > 0 && caps.length === drink.rails.segments.length && caps.every((m) => m.sy === drink.frame!.decking.widthIn && m.sz === drink.frame!.decking.thickIn) && noDrink.rails.drinkLf === 0 && !noDrink.rails.members.some((m) => m.role === "rail-cap"), { lf: drink.rails.drinkLf, caps: caps.length });
check("the board sits on the post tops (no post stands proud through it)", (() => { const top = Math.max(...drink.rails.members.filter((m) => m.role === "rail-post").map((m) => m.cz + m.sz / 2)); return caps.every((m) => m.cz - m.sz / 2 >= top - 0.01); })());
const scDr = deckScene(drink);
check("the 3D draws it in the deck's colour, the rail in its own", scDr.colors.railCap === jc.hex && scDr.colors.rail === "#f2f0ec" && deckScene(noDrink).colors.railCap === undefined && !!parseDeckScene(JSON.parse(JSON.stringify(scDr)))?.colors.railCap);
const pkgDr = priceDeck(drink.design);
const drinkLine = pkgDr.bom.find((l) => l.id === "rail-drink-boards");
check("its boards are on the material list in the deck's board and colour, and in the price", !!drinkLine && /^Trex Transcend Lineage in Jasper × \d+ ft — drink rail on the railing$/.test(drinkLine.label) && drinkLine.cost > 0 && pkgDr.subtotal > priceDeck(noDrink.design).subtotal && pkgDr.lines.some((l) => /a deck board on top as a drink rail/.test(l.description ?? "")) && /deck-board drink rail/.test(railWords(drink.rails)), drinkLine?.label);
check("never over glass; a wood rail keeps its own 2x6 cap", buildStructure(high({ rail: { type: "glass", drink: true } })).rails.drinkLf === 0 && (() => { const w = buildStructure(high({ rail: { type: "cedar", drink: true } })); return w.rails.drinkLf === 0 && w.rails.capLf > 0 && deckScene(w).colors.railCap === undefined; })());
check("an older rail reads as no drink rail", normalizeDeckDesign({ ...base, rail: { type: "composite", cap: true } }).rail.drink === false);

console.log(bad ? `\n${bad} deck parts check(s) FAILED.` : "\nAll deck parts checks passed.");
process.exit(bad ? 1 : 0);
