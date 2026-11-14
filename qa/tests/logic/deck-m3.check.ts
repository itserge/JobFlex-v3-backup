// The Deck Studio's M3 (2026-10-10): the site, stairs, rails, a lower level,
// shaped fronts, patterns, the electrical, the new roofs and the version-3
// scene — worked examples a builder can check by hand, then a sweep that
// builds, counts, prices, checks and draws every combination the studio
// offers. The code figures below are typed from the IRC and the trade
// sources, not copied from the engine.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/deck-m3.check.ts
import { defaultDeckDesign, defaultFixture, defaultStair, normalizeDeckDesign, frontEdgeAt, frontRadiusFt, shapeAreaSqFt, type DeckDesign } from "../../../src/lib/deck/design";
import { BETWEEN_LEVELS_STAIR_ID, buildStructure } from "../../../src/lib/deck/structure";
import { priceDeck, deckScope, deckNotes } from "../../../src/lib/deck/pricing";
import { deckChecks, applyDeckPatch } from "../../../src/lib/deck/checks";
import { deckScene, parseDeckScene, SCENE_LAYERS, sceneBuildLayers } from "../../../src/lib/deck/scene";
import { deckElevation, elevationOverlay, defaultPlacement } from "../../../src/lib/deck/elevation";
import { deckConvertSchema } from "../../../src/lib/deck/convertSchema";
import { DECK_RATES } from "../../../src/lib/deck/rates";
import { STATE_SNOW, ZIP3_SNOW, deckLoadForSnow, roofLoadForSnow, siteFromAddress, groundAt, fitGround, termiteHazard } from "../../../src/lib/deck/site";
import { stairRisers, RISER_TARGET_IN, TREAD_RUN_IN, STRINGER_MAX_SPAN_IN } from "../../../src/lib/deck/stairs";
import { CIRCUIT_VA, TRANSFORMER_WATTS, FIXTURE_WATTS } from "../../../src/lib/deck/electrical";
import { sizeLvl } from "../../../src/lib/deck/roof";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const near = (a: number, b: number, tol = 0.02) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const rateKeys = new Set(DECK_RATES.map((r) => r.key));
const base = (over: Record<string, unknown>): DeckDesign => normalizeDeckDesign({ ...defaultDeckDesign({ state: "TX", frostIn: 12 }), ...over });

console.log("── the site");
{
  check("snow by state: Florida 0, Texas 5, Colorado 30, Minnesota 50, Maine 60; Denver stays 30, the Colorado mountains read 80", STATE_SNOW.FL === 0 && STATE_SNOW.TX === 5 && STATE_SNOW.CO === 30 && STATE_SNOW.MN === 50 && STATE_SNOW.ME === 60 && ZIP3_SNOW["802"].psf === 30 && ZIP3_SNOW["804"].psf === 80);
  check("the deck's column: 40 live up to 40 psf of snow, then 50/60/70, past 70 an engineer", deckLoadForSnow(5).load === 40 && deckLoadForSnow(45).load === 50 && deckLoadForSnow(55).load === 60 && deckLoadForSnow(70).load === 70 && !deckLoadForSnow(70).beyond && deckLoadForSnow(90).beyond);
  check("the rafter page: 20 live to 20 psf of snow, 30 to 30, 50 to 50, 70 above", roofLoadForSnow(10).load === 20 && roofLoadForSnow(30).load === 30 && roofLoadForSnow(40).load === 50 && roofLoadForSnow(60).load === 70 && roofLoadForSnow(100).beyond);
  const den = siteFromAddress("1200 Larimer St, Denver, CO 80204");
  const mpls = siteFromAddress("301 4th Ave S, Minneapolis, MN 55415");
  const hou = siteFromAddress("901 Bagby St, Houston, TX 77002");
  check("Denver: 30 psf snow, a 36-in. frost line, the deck on the 40 table, the roof on the 30 page", den.groundSnowPsf === 30 && den.frostIn === 36 && den.deckLoad === 40 && den.roofLoad === 30 && /Denver/.test(den.label));
  check("Minneapolis: 50 psf snow → the deck reads the 50 column, the roof the 50 page, a 48-in. frost line", mpls.groundSnowPsf === 50 && mpls.deckLoad === 50 && mpls.roofLoad === 50 && mpls.frostIn === 48);
  check("Houston: no snow, termites very heavy, and the notes say so", hou.groundSnowPsf === 5 && hou.termite === "moderate-heavy" && hou.basis.some((b) => /Termite/.test(b)) && termiteHazard("FL") === "very-heavy" && termiteHazard("MN") === "none-slight");
  check("no state: a 20 psf snow and a 24-in. frost line are assumed, and it says so", siteFromAddress("").groundSnowPsf === 20 && siteFromAddress("").frostIn === 24 && siteFromAddress("").basis[0].startsWith("No state"));
  check("the ground under a point: 12 in. of fall over a 12-ft deck puts the far edge 12 in. down, the middle 6", groundAt({ outDropIn: 12, acrossDropIn: 0 }, 0, 144, 192, 144) === -12 && groundAt({ outDropIn: 12, acrossDropIn: 0 }, 96, 72, 192, 144) === -6 && groundAt({ outDropIn: 0, acrossDropIn: 8 }, 192, 0, 192, 144) === -8);
  const fit = fitGround([{ eastFt: 0, northFt: 0, heightFt: 100 }, { eastFt: 30, northFt: 0, heightFt: 100 }, { eastFt: 0, northFt: 30, heightFt: 98.5 }, { eastFt: -30, northFt: 0, heightFt: 100 }, { eastFt: 0, northFt: -30, heightFt: 101.5 }]);
  check("a plane fitted to lidar heights: ground falling 5% toward the north", !!fit && near(fit.gradePct, 5, 0.01) && fit.downhillDeg === 0, JSON.stringify(fit));
}

console.log("── the ground's fall through the frame");
{
  const flat = buildStructure(base({ heightIn: 48 }));
  const sloped = buildStructure(base({ heightIn: 48, site: { groundSnowPsf: 0, slope: { outDropIn: 18, acrossDropIn: 0 }, termite: null } }));
  const fp = flat.frame!.posts;
  const sp = sloped.frame!.posts;
  check("the ground falls 18 in. away from the house: the beam's posts stand 15 in. taller than on flat ground, their footings dug from their own ground", sp.every((p, i) => near(p.heightIn - fp[i].heightIn, 18 * (p.y / 144), 0.05)) && sp.every((p) => p.footing.groundIn < 0) && sp.every((p, i) => p.footing.depthIn === fp[i].footing.depthIn), sp.map((p) => `${p.heightIn}/${p.footing.groundIn}`).join(" "));
  check("the scene tilts its ground and the footings go down with it", deckScene(sloped).ground?.outDropFt === 1.5 && deckScene(sloped).footings.every((f) => f[5] > deckScene(flat).footings[0][5]));
  const stair = buildStructure(base({ heightIn: 48, stairs: [defaultStair("s1", "front", 8)], site: { groundSnowPsf: 0, slope: { outDropIn: 18, acrossDropIn: 0 }, termite: null } })).stairs[0];
  check("the stairs land on the real ground: a 48-in. deck over ground 22 in. lower at the foot climbs about 68 in. — 10 risers, not 7", stair.riseIn > 60 && stair.risers === stairRisers(stair.riseIn) && stair.risers >= 9, `${stair.riseIn} in., ${stair.risers} risers`);
  const checks = deckChecks(sloped);
  check("the strip says what the ground does and how tall the posts run", checks.some((c) => c.id === "site-slope" && /posts run from/.test(c.text)));
}

console.log("── stairs");
{
  const d = base({ heightIn: 96, shape: { kind: "rect", widthFt: 20, depthFt: 14 }, stairs: [{ ...defaultStair("s1", "front", 10), widthFt: 4 }], rail: { type: "treated" } });
  const s = buildStructure(d);
  const st = s.stairs[0];
  check("8 ft to the ground: 13 risers of 7.38 in. (aimed at 7½, 7¾ at most), 12 treads of 10½ in. with a 1-in. nosing", st.risers === 13 && near(st.riserIn, 96 / 13 - 2 / 13, 0.02) && st.riserIn <= 7.75 && st.treads === 12 && st.runIn === TREAD_RUN_IN && RISER_TARGET_IN === 7.5, `${st.risers} × ${st.riserIn}`);
  check("the pad stands 2 in. up: the climb is 94 in., the flight runs 10½ ft out", near(st.riseIn, 94, 0.01) && near(st.totalRunIn, 12 * 10.5, 0.01));
  check("a 4-ft stair under wood treads: 3 stringers at 16 in., 2x12s about 13 ft long, on connectors at the rim", st.stringers.count === 3 && st.stringers.spacingIn === 16 && st.stringers.lengthIn > 150 && st.stringers.lengthIn < 170 && st.hardware.stringerConnectors === 3);
  check("a cut stringer over 6 ft of run gets a beam midway on two posts with footings", st.midSupport && st.totalRunIn > STRINGER_MAX_SPAN_IN && st.members.filter((m) => m.role === "stair-post").length === 2 && st.footings.length === 2);
  check("13 risers and 8 ft up: a graspable rail both sides (guards), posts every 6 ft on the slope, balusters at 5 in.", st.rail.sides === 2 && st.guard && st.rail.posts >= 6 && st.rail.balusters > 50);
  check("treads of two 5/4 boards, riser boards, a kicker on a concrete pad with two anchors", st.members.filter((m) => m.role === "tread").length === 24 && st.members.filter((m) => m.role === "riser").length === 13 && st.members.some((m) => m.role === "kicker") && !!st.pad && st.pad.thickIn === 4 && st.hardware.anchors === 2);
  const pkg = priceDeck(d);
  check("the stairs are a line of 13 steps with stringers, treads, risers, the pad and the connectors in the package", pkg.lines.some((l) => l.id === "deck-stairs" && l.quantity === 13) && ["lumber-stringer-2x12-14", "stringer-connectors", "stair-pad-concrete", "riser-boards"].every((id) => pkg.bom.some((b) => b.id === id || b.id.startsWith(id.replace(/-14$/, "")))), pkg.bom.filter((b) => b.step === "stairs").map((b) => b.id).join(","));
  check("the rail skips the stair's opening: 48 ft of edge less 4 ft, plus the stair's two rails", s.rails.lf === 44 && s.rails.stairLf > 20 && s.rails.segments.length === 4);
  const tall = buildStructure(base({ heightIn: 160, shape: { kind: "rect", widthFt: 20, depthFt: 14 }, stairs: [defaultStair("s1", "front", 10)] })).stairs[0];
  check("over 12 ft 3 in. of climb the flight gets a landing midway on four posts (and each half-flight its beam)", tall.landing && tall.members.some((m) => m.role === "landing-frame") && tall.footings.length >= 4 && tall.members.filter((m) => m.role === "stair-post").length === tall.footings.length && tall.totalRunIn > tall.treads * TREAD_RUN_IN);
  const side = buildStructure(base({ heightIn: 40, shape: { kind: "rect", widthFt: 16, depthFt: 12 }, stairs: [defaultStair("s1", "right", 6)] })).stairs[0];
  check("a stair down the right side runs out from x = W, its footprint east of the deck", side.footprint.every((p) => p.x >= 16 * 12 - 0.01) && side.footprint.some((p) => p.x > 16 * 12 + 40));
  const narrow = deckChecks(buildStructure(base({ heightIn: 40, stairs: [{ ...defaultStair("s1", "front", 8), widthFt: 3 }] })));
  check("a 3-ft stair passes the 36-in. rule exactly; 5 risers want a handrail — and the strip offers a rail when there is none", !narrow.some((c) => c.id === "stair-s1-width") && narrow.some((c) => c.id === "stair-s1-handrail" && c.level === "fail" && c.fix?.label.includes("railing")));
  // Box steps.
  const box = buildStructure(base({ heightIn: 20, placement: "detached", shape: { kind: "rect", widthFt: 12, depthFt: 12 }, stairs: [{ ...defaultStair("s1", "front", 6), wrap: true, wrapSides: 4 }] })).stairs[0];
  check("a 20-in. deck wrapped on four sides: 3 risers, 2 levels of 2x6 box frames, blocks over gravel, no rail", box.kind === "box" && box.risers === 3 && box.treads === 2 && box.members.filter((m) => m.role === "box-frame").length === 8 && box.boxBlocks > 8 && box.gravelSqFt > 20 && box.rail.sides === 0 && box.footprint.length === 4 && box.footprint[0].x < 0);
  // (2026-11-14: past three risers steps that wrap the deck stand on stringers — to seven risers; see deck-steps-around.check.ts.)
  const wide = buildStructure(base({ heightIn: 40, stairs: [{ ...defaultStair("s1", "front", 8), wrap: true, wrapSides: 1 }] }));
  check("steps wrapping a 40-in. deck are wide steps on stringers — six risers, no box frames", wide.stairs[0].kind === "box" && !!wide.stairs[0].wide && wide.stairs[0].risers === 6 && wide.stairs[0].stringers.count > 10 && wide.stairs[0].boxFrameLf === 0 && !wide.stairs[0].flags.tooTallForBox);
  const tooTall = buildStructure(base({ heightIn: 60, stairs: [{ ...defaultStair("s1", "front", 8), wrap: true, wrapSides: 1 }] }));
  check("asked for on a 60-in. deck (eight risers) they are framed as a flight and the strip says why, with the fix", tooTall.stairs[0].kind === "flight" && tooTall.stairs[0].flags.tooTallForBox && deckChecks(tooTall).some((c) => c.id === "stair-s1-box" && c.level === "fail" && !!c.fix));
  const words = deckScope(pkg, "118 Cedar Ln");
  check("the scope says the stair in the client's words", words.some((w) => /4-ft-wide stair down the front: 13 risers of 7\.\d\d in\./.test(w)));
}

console.log("── rails");
{
  const wood = buildStructure(base({ heightIn: 48, shape: { kind: "rect", widthFt: 16, depthFt: 12 }, rail: { type: "cedar", heightIn: 36, postSpacingFt: 6, cap: true } })).rails;
  check("cedar rail on 40 ft of open edge: posts no more than 6 ft apart, the two corners shared (3 + 4 + 3 − 2 = 8 posts), two rails and a cap, balusters at 5 in. (about 90)", wood.on && wood.system === "wood" && near(wood.lf, 40, 0.01) && wood.posts === 8 && wood.capLf === 40 && wood.balusters > 80 && wood.balusters < 100, `${wood.posts} posts, ${wood.balusters} balusters`);
  check("every post, rail and baluster is a box in space; each post gets a pair of tension ties", wood.members.filter((m) => m.role === "rail-post").length === 8 && wood.members.filter((m) => m.role === "baluster").length === wood.balusters && wood.hardware.postTies === 8);
  const cable = buildStructure(base({ heightIn: 48, rail: { type: "cable" } })).rails;
  check("a cable rail: eight or more runs 3 in. apart in a 36-in. rail, drawn as thin runs on every segment", cable.infill === "cable" && cable.cableLf > 250 && cable.members.filter((m) => m.role === "cable").length === cable.segments.length * Math.max(8, Math.floor((36 - 3.5 - 3.5 - 3.5) / 3)), `${cable.members.filter((m) => m.role === "cable").length}`);
  const glass = buildStructure(base({ heightIn: 48, rail: { type: "glass" } })).rails;
  check("glass: one panel a bay, drawn as see-through planes", glass.infill === "glass" && glass.panels === glass.segments.reduce((a, sg) => a + sg.posts - 1, 0) && glass.panelsOut.length === glass.panels);
  const lowDeck = buildStructure(base({ heightIn: 24 }));
  check("24 in. up: no guard required, none built unless chosen", !lowDeck.rails.required && !lowDeck.rails.on);
  const pkg = priceDeck(base({ heightIn: 48, rail: { type: "treated" } }));
  const bom = pkg.bom.filter((b) => b.step === "rails");
  check("a treated rail is bought as 4x4 posts, 2x4 rails, 2x2 balusters, a 2x6 cap, ties and brackets — every line on a price-book row", bom.length >= 6 && bom.every((b) => rateKeys.has(b.rateKey)) && bom.some((b) => /4x4/.test(b.label)) && bom.some((b) => /2x2/.test(b.label)), bom.map((b) => b.id).join(","));
  const kit = priceDeck(base({ heightIn: 48, rail: { type: "aluminum" } }));
  check("a kit rail is one system line by the foot plus its ties", kit.bom.filter((b) => b.step === "rails").some((b) => b.id === "rail-system" && b.unit === "ft") && kit.lines.some((l) => l.id === "deck-rail" && /aluminum/.test(l.name)));
  const eight = deckChecks(buildStructure(base({ heightIn: 48, rail: { type: "treated", postSpacingFt: 8 } })));
  check("wood posts 8 ft apart are warned about, with the fix to 6", eight.some((c) => c.id === "guard-posts" && c.level === "warn" && c.fix?.patch.rail?.postSpacingFt === 6));
}

console.log("── a lower level, a bowed front, clipped corners, patterns");
{
  const two = buildStructure(base({ heightIn: 48, shape: { kind: "rect", widthFt: 20, depthFt: 12 }, lower: { on: true, widthFt: 12, depthFt: 8, dropIn: 7.5, align: "centre" }, rail: { type: "treated" } }));
  check("a lower level: its own frame 12 x 8, centred 4 ft in, 7½ in. down, on its own posts; the main deck's front rail stops over it", !!two.lower && two.lower.frame.areaSqFt === 96 && two.lower.offsetXIn === 48 && two.lower.offsetYIn === 144 && two.lower.frame.surfaceIn === 40.5 && two.lower.frame.posts.length >= 3 && two.rails.segments.filter((sg) => sg.level === "upper" && sg.y0 === 144 && sg.y1 === 144).length === 2);
  check("one riser down: the step is a line, no stair is wanted; the lower level, 40 in. up, gets its own rail", !!two.stepDown && !two.stepDown.stairWanted && priceDeck(two.design).lines.some((l) => l.id === "deck-step") && two.rails.segments.some((sg) => sg.level === "lower"));
  const pkg2 = priceDeck(two.design);
  check("the two levels price as one deck: footings, framing and decking carry both (240 + 96 = 336 sq ft), one package", pkg2.areaSqFt === 336 && pkg2.lines.filter((l) => l.id === "deck-framing").length === 1 && pkg2.lines.find((l) => l.id === "deck-framing")!.quantity === 336 && /two levels/.test(pkg2.lines.find((l) => l.id === "deck-framing")!.name));
  const deep = buildStructure(base({ heightIn: 60, shape: { kind: "rect", widthFt: 20, depthFt: 12 }, lower: { on: true, widthFt: 12, depthFt: 8, dropIn: 24, align: "left" } }));
  const want = deckChecks(deep).find((c) => c.id === "lower-step");
  // 2026-10-11 (owner: "the double deck — the missing steps"): the engine builds the steps between the levels itself.
  const between = deep.stairs.find((b) => b.design.id === BETWEEN_LEVELS_STAIR_ID);
  check("24 in. down: the engine builds the steps between the levels — onto the lower deck, the right risers — and no stair is still wanted", !!between && between.lands === "lower-deck" && between.risers === stairRisers(24) && !!deep.stepDown && !deep.stepDown.stairWanted);
  check("the check says so, and its fix makes them the contractor's own stair, which takes the engine's place", !!(want?.level === "info" && !!want.fix && (() => { const after = buildStructure(applyDeckPatch(deep.design, want!.fix!.patch)); return after.stairs.length === 1 && after.stairs[0].design.id !== BETWEEN_LEVELS_STAIR_ID && after.stairs[0].lands === "lower-deck" && after.stairs[0].risers === stairRisers(24); })()));
  check("one riser down, the engine builds nothing between the levels", !two.stairs.some((b) => b.design.id === BETWEEN_LEVELS_STAIR_ID));
  const bow = base({ heightIn: 36, shape: { kind: "rect", widthFt: 16, depthFt: 12, front: { kind: "curve", bulgeFt: 2, clipFt: 2 } } });
  check("a 2-ft bow on a 16-ft front: a 17-ft radius, the front edge 12 ft deep at the corners and 14 at the middle, 18 sq ft more deck", near(frontRadiusFt(bow.shape), 17, 0.01) && near(frontEdgeAt(bow.shape, 0), 144, 0.01) && near(frontEdgeAt(bow.shape, 96), 168, 0.01) && near(shapeAreaSqFt(bow.shape), 192 + 21.6, 0.05), `${frontRadiusFt(bow.shape)} ${shapeAreaSqFt(bow.shape)}`);
  const bs = buildStructure(bow);
  check("its joists are cut to the arc (the middle ones 2 ft longer), the rim is bent plies, the bow is blocked", bs.frame!.sticks.filter((st) => st.role === "joist").some((st) => st.lengthIn > 160) && bs.frame!.sticks.some((st) => st.role === "rim" && st.curved) && bs.frame!.blockingRows.some((r) => r.why === "curve") && bs.frame!.frontExtraCantIn === 24);
  const bowChecks = deckChecks(bs);
  check("the overhang check counts the bow: joists hang 2 ft more at the middle, still inside the table; the strip names the radius", bowChecks.some((c) => c.id === "joist-overhang-a" && c.level === "pass") && bowChecks.some((c) => c.id === "front-curve" && /17-ft radius/.test(c.text)));
  const bowScene = deckScene(bs);
  check("the last rows of boards are cut to the arc as flat rings; the fascia follows the bow in short pieces", !!bowScene.diagonal && bowScene.diagonal.boards.length > 4 && bowScene.boxes.filter((b) => b[0] === SCENE_LAYERS.indexOf("fascia")).length === 0);
  const bowPkg = priceDeck(bow);
  check("the curved rim is bought by the foot of ply", bowPkg.bom.some((b) => b.id === "rim-curved" && b.rateKey === "rim.curved"));
  const clip = buildStructure(base({ heightIn: 36, shape: { kind: "rect", widthFt: 16, depthFt: 12, front: { kind: "clipped", bulgeFt: 2, clipFt: 3 } }, rail: { type: "treated" } }));
  check("clipped corners: 9 sq ft off, the rim turns on 45° pieces (doubled), the rail follows the five open sides", near(clip.frame!.areaSqFt, 192 - 9, 0.01) && clip.frame!.sticks.filter((st) => st.role === "rim" && st.yaw && Math.abs(Math.abs(Math.sin(2 * st.yaw)) - 1) < 0.01).length === 4 && clip.rails.segments.length === 5, `${clip.frame!.sticks.filter((st) => st.role === "rim" && st.yaw).length} turned rims, ${clip.rails.segments.length} rail segments`);
  const border = buildStructure(base({ decking: { product: "composite-better", border: 2, pattern: "straight" } })).surface!;
  check("a double picture-frame border: border boards along the three open edges, the field inside them, 3 points more waste", border.border === 2 && border.pieces.filter((p) => p.border).length + (border.shaped.length - border.shapedBorderFrom) === 6 && near(border.borderLf, 80, 0.02) && border.wastePct === 13);
  const herring = buildStructure(base({ decking: { product: "composite-better", pattern: "herringbone" } })).surface!;
  check("herringbone: bought by the foot like a diagonal, 10 points more waste, drawn as two fields", herring.pattern === "herringbone" && herring.wastePct === 20 && deckScene(buildStructure(base({ decking: { product: "composite-better", pattern: "herringbone" } }))).diagonal!.boards.length > 20);
}

console.log("── the electrical");
{
  const d = base({ heightIn: 36, shape: { kind: "rect", widthFt: 16, depthFt: 12 }, rail: { type: "treated" }, stairs: [defaultStair("s1", "front", 8)], electrical: { fixtures: [defaultFixture("e1", "led-strip"), defaultFixture("e2", "post-cap"), defaultFixture("e3", "outlet"), { ...defaultFixture("e4", "heater"), volts240: true }, { ...defaultFixture("e5", "chandelier"), supply: "client" }, defaultFixture("e6", "flood")], feedFt: 40, panelSide: "left", timer: true } });
  const s = buildStructure(d);
  const el = s.electrical;
  check("six kinds asked, placed where they usually go: a strip along every rail run, a cap on every rail post, an outlet on the house wall, the heater on the wall, a flood on the house", el.on && el.fixtures.filter((f) => f.kind === "led-strip").length === s.rails.segments.length && el.fixtures.filter((f) => f.kind === "post-cap").length === s.rails.posts && el.fixtures.find((f) => f.kind === "outlet")?.on === "wall" && el.fixtures.find((f) => f.kind === "heater")?.on === "wall" && el.fixtures.filter((f) => f.kind === "flood").length === 1, `${el.fixtures.filter((f) => f.kind === "led-strip").length}/${s.rails.segments.length} strips, ${el.fixtures.filter((f) => f.kind === "post-cap").length}/${s.rails.posts} caps`);
  const lvWatts = el.fixtures.filter((f) => f.lv).reduce((a, f) => a + f.watts * (f.kind === "led-strip" ? 1 : f.qty), 0);
  check("low voltage: strips at 3 W a foot and caps at 1 W on a 150-W transformer each, 16/2 wire run post to post", !!el.lv && el.lv.transformers === Math.max(1, Math.ceil(lvWatts / TRANSFORMER_WATTS)) && el.lv.stripFt > 30 && el.lv.wireFt > el.lv.stripFt && el.lv.watts === Math.round(lvWatts));
  check("line voltage: the outlet, the flood and the transformer share a 20-A GFCI circuit; the 240-V heater has a 30-A two-pole circuit of its own on 10/2", el.circuits.length === 2 && el.circuits[0].kind === "lights-outlets" && el.circuits[0].amps === 20 && el.circuits[1].kind === "heater-240" && el.circuits[1].wire === "10/2" && el.circuits[1].poles === 2 && el.gfci === 1 && el.breakers20 === 1 && el.breakers30 === 1 && CIRCUIT_VA === 1440 && FIXTURE_WATTS.heater === 1500);
  check("a box per device, a switch per lighting group and one for the heater, a dimmer for the chandelier, the timer", el.boxes === el.fixtures.filter((f) => !f.lv).reduce((a, f) => a + f.qty, 0) + 1 && el.dimmers === 1 && el.timers === 1 && el.switches >= 2);
  check("the client's chandelier: drawn at the peak as a sample, counted by the client, its box and hanging in the price", el.byClient.length === 1 && el.byClient[0].kind === "chandelier" && el.labor.hang === 2 && el.notes.some((n) => /client's to buy/.test(n)));
  check("wire runs along the frame, 15% on top, every run a path in space", el.wires.length === el.fixtures.length && el.wires.every((w) => w.path.length >= 2 && w.lengthFt > 0) && el.labor.wireFt > 100);
  const pkg = priceDeck(d);
  const ids = pkg.lines.map((l) => l.id);
  check("three electrical lines: the wiring, our fixtures, the client's at $0 for the fixtures with a to-be-determined mark", ids.includes("elec-wiring") && ids.includes("elec-fixtures") && ids.includes("elec-client") && pkg.lines.find((l) => l.id === "elec-client")!.materialCost === 0 && pkg.lines.find((l) => l.id === "elec-client")!.tbd === true && pkg.lines.find((l) => l.id === "elec-client")!.laborCost > 0, ids.join(","));
  const ebom = pkg.bom.filter((b) => b.step === "electrical");
  check("the package lists wire by the foot, boxes, GFCI, switches, breakers, the transformer, the strip by the foot, the heater — and the chandelier as the client's, unpriced", ebom.some((b) => b.id === "wire-122") && ebom.some((b) => b.id === "wire-102") && ebom.some((b) => b.id === "transformer") && ebom.some((b) => /ledStrip/.test(b.rateKey) && b.unit === "ft") && ebom.some((b) => b.byClient && /chandelier/i.test(b.label) && b.cost === 0) && ebom.every((b) => rateKeys.has(b.rateKey)), ebom.filter((b) => !rateKeys.has(b.rateKey)).map((b) => b.rateKey).join(","));
  const parsed = deckConvertSchema.safeParse({ title: "t", assumptions: deckNotes(pkg), lines: pkg.lines.map((l) => ({ name: l.name, description: l.description, quantity: l.quantity, unit: l.unit, materialCost: l.materialCost, laborCost: l.laborCost })), plan: { design: d, scene: deckScene(s) } });
  check("a $0 client line still passes the convert rules", parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues[0]));
  const scene = deckScene(s);
  check("the scene glows: every fixture a light-layer box with a glow, the client's one marked a sample, the wires drawn", scene.glows.length === el.fixtures.length && scene.glows.some((g) => g[4] === 1) && scene.boxes.filter((b) => b[0] === SCENE_LAYERS.indexOf("wire")).length > 10 && scene.boxes.filter((b) => b[0] === SCENE_LAYERS.indexOf("light")).length >= el.fixtures.length);
  const placed = buildStructure(applyDeckPatch(d, { electrical: { ...d.electrical, fixtures: [{ ...defaultFixture("e7", "sconce"), at: { x: 60, y: 10, z: 100, on: "post" } }] } }));
  check("a fixture placed by hand stays where it was put", placed.electrical.fixtures.length === 1 && placed.electrical.fixtures[0].x === 60 && placed.electrical.fixtures[0].z === 100 && placed.electrical.fixtures[0].placed);
  const bare = deckChecks(buildStructure(base({ heightIn: 36 })));
  check("a deck on the house with no outlet is told the code wants one, with a one-tap fix", bare.some((c) => c.id === "elec-outlet" && c.fix?.patch.electrical?.fixtures?.length === 1));
  const gz = buildStructure(base({ structure: "gazebo", floor: "slab", roof: { kind: "pyramid", plan: { shape: "octagon", acrossFt: 14 } }, electrical: { fixtures: [defaultFixture("e1", "chandelier"), defaultFixture("e2", "fan"), defaultFixture("e3", "led-strip")], feedFt: 60, panelSide: "right", timer: false } }));
  check("a detached gazebo: the chandelier at the peak, the fan under it, strips under all eight headers, a trench for the feed", gz.electrical.fixtures.find((f) => f.kind === "chandelier")!.on === "peak" && gz.electrical.fixtures.filter((f) => f.kind === "led-strip").length === 8 && gz.electrical.trenchFt > 0 && gz.electrical.notes.some((n) => /trench/.test(n)));
}

console.log("── the new roofs");
{
  const gambrel = buildStructure(base({ structure: "gazebo", floor: "slab", roof: { kind: "gambrel", plan: { shape: "rect", widthFt: 12, depthFt: 16 }, pitch: 6 } })).roof!;
  check("a gambrel: four faces (two a side), the lower at 20:12, the upper at 6:12, ties at the break, a ridge", gambrel.kind === "gambrel" && gambrel.faces.length === 4 && gambrel.faces.some((f) => near(f.slope, 20 / 12, 0.01)) && gambrel.faces.some((f) => near(f.slope, 0.5, 0.01)) && gambrel.breakTies > 5 && !!gambrel.ridge && gambrel.peakIn > gambrel.headerTopIn + 60);
  const dutch = buildStructure(base({ structure: "gazebo", floor: "slab", roof: { kind: "dutch-gable", plan: { shape: "rect", widthFt: 12, depthFt: 18 }, pitch: 6 } })).roof!;
  check("a Dutch gable: hips on all four sides up to the cap, a gable face above each long side, two gablet walls with studs", dutch.kind === "dutch-gable" && dutch.gablets === 2 && dutch.faces.length === 6 && dutch.planes.filter((p) => p.kind === "wall").length === 2 && dutch.members.filter((m) => m.role === "stud").length > 4 && dutch.hips.count === 4);
  const round = buildStructure(base({ structure: "gazebo", floor: "ground", roof: { kind: "pyramid", plan: { shape: "round", acrossFt: 14 } } })).roof!;
  check("a round gazebo: a 16-sided ring, 8 posts, 8 headers post to post, 16 roof facets", round.ring.length === 16 && round.posts.length === 8 && round.headers.length === 8 && round.faces.length === 16);
  const louv = buildStructure(base({ structure: "pergola", floor: "slab", roof: { pergolaStyle: "louvered", plan: { shape: "rect", widthFt: 12, depthFt: 12 } } }));
  check("a louvered pergola: blades as tilted planes, no slats, the kit priced by the square foot", !!louv.roof!.louvers && louv.roof!.louvers.blades > 10 && louv.roof!.slats === null && louv.roof!.planes.filter((p) => p.kind === "louver").length === louv.roof!.louvers.blades && priceDeck(louv.design).bom.some((b) => b.id === "louvers"));
  const arch = buildStructure(base({ structure: "pergola", floor: "slab", roof: { pergolaStyle: "arched", plan: { shape: "rect", widthFt: 12, depthFt: 12 } } }));
  check("an arched pergola: each rafter five tilted pieces rising at the middle, bought as arch-cut 2x12", arch.roof!.archRafters && arch.roof!.members.filter((m) => m.role === "rafter").length === arch.roof!.rafters.commons * 5 && arch.roof!.members.filter((m) => m.role === "rafter").some((m) => m.tilt > 0.05) && priceDeck(arch.design).bom.some((b) => b.id === "arch-rafters"));
  const screened = buildStructure(base({ structure: "gazebo", floor: "deck", shape: { kind: "rect", widthFt: 14, depthFt: 14 }, roof: { kind: "hip", plan: { shape: "square", widthFt: 12 }, walls: { fill: "screen", sides: 3 } }, rail: { type: "treated" } }));
  check("a screened gazebo: three walls of screen over a kneewall, a door in the first, the rail left off those sides", !!screened.roof!.walls && screened.roof!.walls.segments.length === 3 && screened.roof!.walls.doors === 1 && screened.roof!.walls.sqFt > 100 && screened.roof!.planes.filter((p) => p.kind === "screen").length >= 4 && priceDeck(screened.design).lines.some((l) => l.id === "roof-walls"));
  const lvl = sizeLvl(16 * 12, 500);
  check("an LVL for 16 ft at 500 lb/ft: 14 in. or deeper by bending, shear and L/240 (one 1¾×16 ply just carries it)", !!lvl && lvl.kind === "lvl" && lvl.depthIn >= 14, JSON.stringify(lvl));
  check("nothing in the list carries 40 ft at 900 lb/ft", sizeLvl(40 * 12, 900) === null);
  const wide = buildStructure(base({ structure: "covered-deck", shape: { kind: "rect", widthFt: 30, depthFt: 14 }, roof: { kind: "gable", attach: "free", header: "lvl" } })).roof!;
  check("engineered headers asked for: every header an LVL, on posts where one piece will not reach, nothing flagged", wide.headers.every((h) => h.spec.kind === "lvl") && wide.engineered && !wide.flags.engineeredBeyond && deckChecks(buildStructure(wide.roof ? base({ structure: "covered-deck", shape: { kind: "rect", widthFt: 30, depthFt: 14 }, roof: { kind: "gable", attach: "free", header: "lvl" } }) : base({}))).some((c) => c.id.startsWith("header-") && /engineered/.test(c.text)));
}

console.log("── a sweep of the new combinations");
{
  let n = 0;
  const trouble: string[] = [];
  const fronts = [undefined, { kind: "curve", bulgeFt: 2, clipFt: 2 }, { kind: "clipped", bulgeFt: 2, clipFt: 2 }];
  for (const front of fronts) for (const heightIn of [20, 48, 110]) for (const lowerOn of [false, true]) for (const rail of ["none", "treated", "aluminum", "cable"] as const) for (const pattern of ["straight", "diagonal"] as const) for (const slope of [0, 14]) {
    const d = base({ heightIn, shape: { kind: "rect", widthFt: 18, depthFt: 12, front }, lower: { on: lowerOn, widthFt: 10, depthFt: 8, dropIn: 7.5, align: "centre" }, rail: { type: rail }, decking: { pattern, border: pattern === "straight" ? 1 : 0 }, stairs: [defaultStair("s1", "front", heightIn < 24 ? 9 : 4), ...(heightIn > 30 ? [defaultStair("s2", "right", 6)] : [])], site: { groundSnowPsf: 0, slope: { outDropIn: slope, acrossDropIn: 0 }, termite: null }, electrical: { fixtures: [defaultFixture("e1", "post-cap"), defaultFixture("e2", "outlet"), { ...defaultFixture("e3", "sconce"), supply: "client" }], feedFt: 30, panelSide: "left", timer: false } });
    n++;
    const tag = `${front?.kind ?? "straight"} ${heightIn}in lower=${lowerOn} ${rail} ${pattern} slope=${slope}`;
    try {
      const pkg = priceDeck(d);
      const s = pkg.structure;
      if (!(pkg.subtotal > 0) || pkg.lines.length > 60) trouble.push(`${tag}: ${pkg.lines.length} lines $${pkg.subtotal}`);
      const off = pkg.bom.filter((l) => !rateKeys.has(l.rateKey) || !(l.qty > 0) || !Number.isFinite(l.cost));
      if (off.length) trouble.push(`${tag}: off the book ${off.map((l) => l.id).join(",")}`);
      for (const st of s.stairs) if ((!(st.risers > 0) && st.lands !== "lower-deck") || !st.members.every((m) => [m.cx, m.cy, m.cz, m.sx, m.sy, m.sz].every(Number.isFinite) && m.sx > 0 && m.sy > 0 && m.sz > 0)) trouble.push(`${tag}: stair ${st.design.id} bad member`);
      if (!s.rails.members.every((m) => [m.cx, m.cy, m.cz].every(Number.isFinite) && m.sz > 0)) trouble.push(`${tag}: bad rail member`);
      if (heightIn > 30 && rail !== "none" && !s.rails.on) trouble.push(`${tag}: no rail built`);
      if (heightIn > 30 && !s.rails.required) trouble.push(`${tag}: guard not required at ${heightIn}`);
      const scene = deckScene(s);
      const back = parseDeckScene(JSON.parse(JSON.stringify(scene)));
      if (!back || back.boxes.length !== scene.boxes.length || back.tags.length !== scene.tags.length || back.legend.length !== scene.legend.length || back.callouts.length !== scene.callouts.length) trouble.push(`${tag}: the scene does not read back`);
      if (scene.tags.length !== scene.boxes.length) trouble.push(`${tag}: tags ${scene.tags.length} vs boxes ${scene.boxes.length}`);
      if ((s.stairs.some((st) => st.risers > 0) && !sceneBuildLayers(scene).includes("stair")) || (rail !== "none" && heightIn > 30 && !sceneBuildLayers(scene).includes("rail")) || !sceneBuildLayers(scene).includes("light")) trouble.push(`${tag}: build order misses a layer`);
      const checks = deckChecks(s);
      const fails = checks.filter((c) => c.level === "fail");
      const allowed = new Set(["low-fit", "low-beam", "lower-low-fit", "lower-low-beam", "post-height", "lower-post-height"]);
      for (const c of fails) if (!allowed.has(c.id) && !(c.id.startsWith("stair-") && c.id.endsWith("-handrail") && rail === "none")) trouble.push(`${tag}: ${c.id} — ${c.text}`);
      const elev = deckElevation(scene);
      if (!(elev.polys.length > 3) || elevationOverlay(elev, defaultPlacement(), 1600, 1200).some((o) => !/^[-\d.]+,[-\d.]+( [-\d.]+,[-\d.]+)+$/.test(o.points))) trouble.push(`${tag}: elevation`);
      const parsed = deckConvertSchema.safeParse({ title: "t", assumptions: deckNotes(pkg), lines: pkg.lines.map((l) => ({ name: l.name, description: l.description, quantity: l.quantity, unit: l.unit, materialCost: l.materialCost, laborCost: l.laborCost })), plan: { design: d, scene } });
      if (!parsed.success) trouble.push(`${tag}: convert refuses ${parsed.error.issues[0]?.message}`);
    } catch (err) {
      trouble.push(`${tag}: THREW ${err instanceof Error ? err.stack?.split("\n").slice(0, 3).join(" | ") : String(err)}`);
    }
  }
  check(`${n} decks with stairs, rails, levels, shaped fronts, patterns, slopes and fixtures built, priced, checked, drawn and read back`, trouble.length === 0, trouble.slice(0, 10).join("\n      "));
}

console.log(bad === 0 ? "\nAll M3 checks passed." : `\n${bad} M3 check(s) FAILED.`);
process.exit(bad === 0 ? 0 : 1);
