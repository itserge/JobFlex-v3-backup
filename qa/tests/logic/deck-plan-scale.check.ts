// THE PLANS FILL THEIR SHEET (2026-11-13, lib/deck/plans/paper + draft) — a deck builder: "some generated plans show
// the deck at an excessively small scale; hard to review." Four causes, each checked here: a plan was never drawn
// larger than 1/2 in. = 1 ft, so a small deck sat in the middle of an empty frame; on 18 x 24 and 24 x 36 the plan was
// fitted to less than its frame; the two elevations were always one over the other, so a tall deck was held to a 4-in.
// strip; and there was no scale to pick by hand. Three decks: small (8 x 8), medium (16 x 12), large (40 x 20, a
// second-storey deck with a roof and a stair).
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/deck-plan-scale.check.ts
import { DEFAULT_SHEET_PREFS, PAPERS, PAPER_ORDER, PLAN_MAX_K, PLAN_SCALES, archLabel, elevationBoxesOn, elevationSplitOn, fieldOn, fitElevationsOn, fitOn, fitPlanOn, forcedPlanK, normalizeSheetPrefs, pickPaper, planBoxOn, siteBoxOn, type Paper } from "../../../src/lib/deck/plans/paper";
import { ARCH_SCALES, fitView, type View } from "../../../src/lib/deck/plans/draft";
import { defaultDeckDesign, defaultStair, normalizeDeckDesign, type DeckDesign } from "../../../src/lib/deck/design";
import { buildStructure } from "../../../src/lib/deck/structure";
import { deckScene } from "../../../src/lib/deck/scene";
import { planModel } from "../../../src/lib/deck/plans/model";
import { framingPlan } from "../../../src/lib/deck/plans/framing";
import { foundationPlan } from "../../../src/lib/deck/plans/foundation";
import { elevationView } from "../../../src/lib/deck/plans/project";
import { siteScale } from "../../../src/lib/deck/sitePlan";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};
const design = (over: Record<string, unknown>): DeckDesign => normalizeDeckDesign({ ...defaultDeckDesign({ state: "WA" }), ...over });
const small = design({ shape: { kind: "rect", widthFt: 8, depthFt: 8 }, heightIn: 30 });
const medium = design({ shape: { kind: "rect", widthFt: 16, depthFt: 12 }, heightIn: 36 });
const large = design({ shape: { kind: "rect", widthFt: 40, depthFt: 20 }, heightIn: 108, structure: "covered-deck", stairs: [defaultStair("s1", "front", 20)], rail: { type: "aluminum" } });
const tall = design({ shape: { kind: "rect", widthFt: 12, depthFt: 10 }, heightIn: 114, structure: "covered-deck", rail: { type: "aluminum" } });
const model = (d: DeckDesign) => planModel(buildStructure(d))!;
const inFt = (v: View) => v.scale * 12;
/** How much of a frame a drawing takes, by its tighter direction: 1 = it touches the frame. */
const fill = (v: View, box: { w: number; h: number }) => Math.max((v.box.w * v.scale) / box.w, (v.box.h * v.scale) / box.h);
const inside = (v: View, box: { w: number; h: number }) => v.box.w * v.scale <= box.w + 1e-6 && v.box.h * v.scale <= box.h + 1e-6;
const framing = (d: DeckDesign, p: Paper, force: number | null = null) => {
  const m = model(d);
  return fitPlanOn(p, (sc) => framingPlan(m, sc, {}), force);
};

console.log("── the frame a plan really has");
check("on 11 × 17 the plan's frame is the one it was always fitted to, or a hair more — never less", planBoxOn(PAPERS.B).w >= 8.9 && planBoxOn(PAPERS.B).h >= 9.45 && planBoxOn(PAPERS.B).w < 9.2 && planBoxOn(PAPERS.B).h < 9.8, JSON.stringify(planBoxOn(PAPERS.B)));
check("on 18 × 24 and 24 × 36 it is the frame's own width — the schedules beside it keep their 4.15 in. — not 11 × 17's stretched (15.9 in. against 13.5, 27.9 against 21.3)", planBoxOn(PAPERS.C).w > 8.9 * PAPERS.C.kx + 2 && planBoxOn(PAPERS.D).w > 8.9 * PAPERS.D.kx + 6 && planBoxOn(PAPERS.C).w < fieldOn(PAPERS.C).w - 4.15 && planBoxOn(PAPERS.D).w < fieldOn(PAPERS.D).w - 4.15, `${planBoxOn(PAPERS.C).w.toFixed(2)} ${planBoxOn(PAPERS.D).w.toFixed(2)}`);
check("the field is the sheet less its border, its title block and its padding: 13.33 × 10.22 in. on 11 × 17", Math.abs(fieldOn(PAPERS.B).w - 13.33) < 0.01 && Math.abs(fieldOn(PAPERS.B).h - 10.22) < 0.01);

console.log("── small, medium, large");
const sB = framing(small, PAPERS.B);
check("an 8 × 8 ft deck is drawn at 3/4 in. = 1 ft (it was held to 1/2 in. and sat in the middle of an empty frame)", Math.abs(inFt(sB) - 0.75) < 1e-9 && inFt(fitOn(PAPERS.B, (sc) => framingPlan(model(small), sc, {}), 8.9, 9.45)) === 0.5, `${archLabel(sB.scale)}`);
check("…and takes most of its frame", fill(sB, planBoxOn(PAPERS.B)) > 0.8 && inside(sB, planBoxOn(PAPERS.B)), fill(sB, planBoxOn(PAPERS.B)).toFixed(2));
const mB = framing(medium, PAPERS.B);
check("a 16 × 12 ft deck: 3/8 in. = 1 ft, most of its frame", inFt(mB) >= 0.375 - 1e-9 && fill(mB, planBoxOn(PAPERS.B)) > 0.75 && inside(mB, planBoxOn(PAPERS.B)), `${archLabel(mB.scale)} ${fill(mB, planBoxOn(PAPERS.B)).toFixed(2)}`);
const lC = framing(large, PAPERS.C);
check("a 40 × 20 ft second-storey deck on 18 × 24: the department's 1/4 in. = 1 ft, inside its frame", inFt(lC) >= 0.25 - 1e-9 && inside(lC, planBoxOn(PAPERS.C)), archLabel(lC.scale));
// A 48-ft deck: at 1/4 in. it is 12 in. of deck and 2½ in. of lettering — wider than 11 × 17's box stretched (13.5 in.), inside the frame's own 15.9.
const long = design({ shape: { kind: "rect", widthFt: 48, depthFt: 14 }, heightIn: 36 });
const longC = framing(long, PAPERS.C);
const longOld = fitOn(PAPERS.C, (sc) => framingPlan(model(long), sc, {}), 8.9, 9.45);
check("a 48-ft deck on 18 × 24: 1/4 in. in the frame's own width — fitted to 11 × 17's box stretched it was a step smaller", buildStructure(long).design.shape.widthFt === 48 && inFt(longC) >= 0.25 - 1e-9 && inFt(longC) > inFt(longOld) && inside(longC, planBoxOn(PAPERS.C)), `${archLabel(longC.scale)} was ${archLabel(longOld.scale)}`);
const lm = model(large);
const lPick = pickPaper(DEFAULT_SHEET_PREFS, (p) => ({ planK: fitPlanOn(p, (sc) => framingPlan(lm, sc, {})).scale, siteFtPerIn: siteScale(60, 120, siteBoxOn(p)) }));
check("…so \"Auto\" keeps it on 18 × 24 at the department's 1/4 in.", lPick.paper.key === "C" && lPick.met && lPick.planInPerFt >= 0.25, lPick.words);
for (const [name, d] of [["small", small], ["medium", medium], ["large", large]] as const) {
  const m = model(d);
  const ok = PAPER_ORDER.every((k) => {
    const box = planBoxOn(PAPERS[k]);
    const fr = fitPlanOn(PAPERS[k], (sc) => framingPlan(m, sc, {}));
    const fo = fitPlanOn(PAPERS[k], (sc) => foundationPlan(m, sc, {}));
    return inside(fr, box) && inside(fo, box) && ARCH_SCALES.some((s) => Math.abs(s.k - fr.scale) < 1e-9) && fr.scale <= PLAN_MAX_K + 1e-9;
  });
  check(`the ${name} deck's plans on every sheet: inside the frame, at an architect's scale, one scale both ways (nothing stretched)`, ok);
}

console.log("── a scale picked by hand");
check("the choices are the architect's scales a plan is drawn at, 3/4 in. down to 1/8 in.", PLAN_SCALES.map((x) => x.inPerFt).join() === "0.75,0.5,0.375,0.25,0.1875,0.125" && PLAN_SCALES.every((x) => ARCH_SCALES.some((s) => Math.abs(s.k * 12 - x.inPerFt) < 1e-9)));
check("kept through a save; anything else is \"auto\"", normalizeSheetPrefs({ planInPerFt: 0.375 }).planInPerFt === 0.375 && normalizeSheetPrefs({ planInPerFt: 0.3 }).planInPerFt === "auto" && normalizeSheetPrefs({ planInPerFt: "big" }).planInPerFt === "auto" && normalizeSheetPrefs(null).planInPerFt === "auto" && forcedPlanK({ planInPerFt: 0.25 }) === 0.25 / 12 && forcedPlanK({ planInPerFt: "auto" }) === null);
check("a smaller scale than the fit is drawn as asked: the medium deck at 1/4 in.", Math.abs(inFt(framing(medium, PAPERS.B, 0.25 / 12)) - 0.25) < 1e-9);
const tooBig = framing(medium, PAPERS.B, 0.5 / 12);
check("a scale that does not fit the sheet is never cut off: the medium deck asked at 1/2 in. on 11 × 17 is drawn at the largest that fits", inFt(tooBig) < 0.5 && inside(tooBig, planBoxOn(PAPERS.B)) && inFt(tooBig) === inFt(mB), archLabel(tooBig.scale));
const mm = model(medium);
const byHand = { ...DEFAULT_SHEET_PREFS, planInPerFt: 0.5 };
const handPick = pickPaper(byHand, (p) => ({ planK: fitPlanOn(p, (sc) => framingPlan(mm, sc, {}), forcedPlanK(byHand)).scale, siteFtPerIn: siteScale(60, 120, siteBoxOn(p)) }));
check("…and on \"Auto\" the sheet goes up a size to make room for it: 1/2 in. on 18 × 24", handPick.paper.key === "C" && handPick.met && Math.abs(handPick.planInPerFt - 0.5) < 1e-6, handPick.words);
const forcedB = pickPaper({ ...byHand, paper: "B" }, (p) => ({ planK: fitPlanOn(p, (sc) => framingPlan(mm, sc, {}), forcedPlanK(byHand)).scale, siteFtPerIn: siteScale(60, 120, siteBoxOn(p)) }));
check("…on a sheet picked by hand that cannot hold it, it is said, not hidden", forcedB.paper.key === "B" && !forcedB.met && /under the 1\/2" = 1'-0"/.test(forcedB.words), forcedB.words);
check("fitView alone: a forced scale that fits wins over a larger one that also fits; one that does not falls back", fitView((sc) => framingPlan(mm, sc, {}), 30, 30, 0.75 / 12, 0.125 / 12).scale === 0.125 / 12 && fitView((sc) => framingPlan(mm, sc, {}), 4, 4, 0.75 / 12, 0.5 / 12).scale < 0.5 / 12);

console.log("── the two elevations");
const boxes = elevationBoxesOn(PAPERS.B);
check("two frames one over the other (13.2 × 4.4 in.) or side by side (6.5 × 9.6 in.) on 11 × 17", Math.abs(boxes.stacked.w - 13.18) < 0.05 && Math.abs(boxes.stacked.h - 4.4) < 0.06 && Math.abs(boxes.beside.w - 6.45) < 0.06 && Math.abs(boxes.beside.h - 9.57) < 0.06, JSON.stringify(boxes));
const elev = (d: DeckDesign, p: Paper) => {
  const s = buildStructure(d);
  const m = planModel(s)!;
  const scene = deckScene(s);
  const out = fitElevationsOn(p, (sc) => elevationView(m, scene, "front", sc), (sc) => elevationView(m, scene, "left", sc));
  const old = { front: fitOn(p, (sc) => elevationView(m, scene, "front", sc), 12.9, 4.15), other: fitOn(p, (sc) => elevationView(m, scene, "left", sc), 12.9, 4.15) };
  return { ...out, old };
};
const tallE = elev(tall, PAPERS.B);
const tallSplit = elevationSplitOn(PAPERS.B, tallE.share);
check("a second-storey deck with a roof, 12 ft wide: side by side — the front given the wider share for its lettering — and BOTH drawn larger than in two low strips", tallE.beside && tallE.share > 0.5 && Math.min(tallE.front.scale, tallE.other.scale) > Math.min(tallE.old.front.scale, tallE.old.other.scale) && tallE.front.scale > tallE.old.front.scale && inside(tallE.front, tallSplit.first) && inside(tallE.other, tallSplit.second), `${tallE.beside} ${archLabel(tallE.front.scale)} / ${archLabel(tallE.other.scale)} was ${archLabel(tallE.old.front.scale)} / ${archLabel(tallE.old.other.scale)}`);
const wide = elev(design({ shape: { kind: "rect", widthFt: 32, depthFt: 12 }, heightIn: 30 }), PAPERS.B);
check("a low deck 32 ft wide: one over the other still, never smaller than before", !wide.beside && wide.front.scale >= wide.old.front.scale && wide.other.scale >= wide.old.other.scale && inside(wide.front, boxes.stacked), `${wide.beside} ${archLabel(wide.front.scale)} was ${archLabel(wide.old.front.scale)}`);
for (const [name, d] of [["small", small], ["medium", medium], ["large", large], ["tall", tall]] as const) {
  const e = elev(d, PAPERS.B);
  const sp = elevationSplitOn(PAPERS.B, e.share);
  check(`the ${name} deck's elevations: inside their frames, never smaller than they were`, inside(e.front, e.beside ? sp.first : boxes.stacked) && inside(e.other, e.beside ? sp.second : boxes.stacked) && Math.min(e.front.scale, e.other.scale) >= Math.min(e.old.front.scale, e.old.other.scale) - 1e-9, `${e.beside ? "beside" : "stacked"} ${archLabel(e.front.scale)} / ${archLabel(e.other.scale)} was ${archLabel(e.old.front.scale)} / ${archLabel(e.old.other.scale)}`);
}

console.log(bad ? `\n${bad} FAILED` : "\nall passed");
if (bad) process.exit(1);
