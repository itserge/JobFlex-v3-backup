// THE ROOF AT THE HOUSE WALL (2026-11-07; owner, after a Facebook comment asked why the roof made "a valley between
// the house and the deck": "if it's a freestanding there is a gap for gutters and if it's attached then the proper
// flashing gets there"). A free-standing roof over a deck against the house stands clear of the wall — its back eave,
// fascia and gutter in the gap, nothing in the siding; one on the house is flashed where it meets the wall — apron (L)
// along a level top edge, step flashing up a sloped one, a kickout at its foot — in the 3D, the checks, the material
// list and the permit set. Pure: no model, no database.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/deck-roof-wall.check.ts
import { applyDeckPatch, deckChecks } from "../../../src/lib/deck/checks";
import { defaultDeckDesign, type DeckDesign } from "../../../src/lib/deck/design";
import { priceStructure } from "../../../src/lib/deck/pricing";
import { roofDetails } from "../../../src/lib/deck/permit";
import { WALL_CLEAR_IN } from "../../../src/lib/deck/roof";
import { deckScene } from "../../../src/lib/deck/scene";
import { buildStructure } from "../../../src/lib/deck/structure";

let bad = 0;
const check = (name: string, ok: boolean, extra?: unknown) => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && extra !== undefined ? `  ${JSON.stringify(extra)}` : ""}`);
};
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

const base = defaultDeckDesign({ state: "WA", frostIn: 18 });
type Patch = Parameters<typeof applyDeckPatch>[1];
const design = (w: number, d: number, roof: Partial<DeckDesign["roof"]>, more: Patch = {}): DeckDesign =>
  applyDeckPatch(base, { structure: "covered-deck", shape: { kind: "rect", widthFt: w, depthFt: d }, roof: { ...base.roof, pitch: 4, ...roof }, ...more });
const build = (d: DeckDesign) => buildStructure(d);

// ── free-standing beside the house: the gap ──
console.log("── free-standing over a deck against the house");
const freeHip = build(design(20, 14, { kind: "hip", attach: "free", gutters: { kind: "k5", guards: false } }));
const fr = freeHip.roof!;
const gutters = fr.members.filter((m) => m.role === "gutter");
const backY = Math.min(...fr.eaveRing.map((p) => p.y));
check("the back posts stand off the wall; the back eave stops short of it", !!fr.houseGap && fr.houseGap.postsIn > 12 && backY > 0 && near(fr.houseGap.eaveIn, backY, 1), fr.houseGap);
check(`the back gutter hangs in the gap, at least ${WALL_CLEAR_IN} in. clear of the siding — no gutter in the wall`, gutters.length === 4 && gutters.every((g) => g.cy - g.sy / 2 >= WALL_CLEAR_IN - 0.6) && (fr.houseGap?.clearIn ?? 0) >= WALL_CLEAR_IN, gutters.map((g) => Math.round((g.cy - g.sy / 2) * 10) / 10));
check("no part of the roof is inside the house (every eave corner, member end and plane point at y ≥ 0)", fr.eaveRing.every((p) => p.y > 0) && fr.members.every((m) => Math.min(m.y0, m.y1) > -0.5) && fr.planes.every((p) => p.ring.filter((_, i) => i % 3 === 1).every((y) => y > -0.5)));
check("nothing is flashed: nothing touches the wall", fr.wallFlashing.length === 0 && fr.wallFt === 0);
const frChecks = deckChecks(freeHip);
const frFree = frChecks.find((c) => c.id === "roof-free");
check("the checks say where the water goes: the gap, its gutter, the downspouts — and offer hanging it on the house", frFree?.level === "info" && /gutter hangs in the gap/.test(frFree.text) && /never down the wall/.test(frFree.text) && frFree.alts?.[0]?.label === "Hang it on the house instead", frFree?.text);
const frScene = deckScene(freeHip);
check("the 3D says it at the gap", frScene.legend.some((l) => l.nominal === "The gap at the house" && /hangs in the gap/.test(l.note)));
const frWall = roofDetails(freeHip, null).find((d) => d.title === "Roof beside the house wall");
check("the permit set draws the gap and the gutter in it", !!frWall && frWall.drawing.items.some((i) => i.t === "dim" && /clear/.test(i.label)) && frWall.notes.some((n) => /nothing is fastened to the house/i.test(n)), frWall?.notes);
check("the price says it stands clear of the house for the back gutter", priceStructure(freeHip).lines.some((l) => /clear of the house for the back gutter/.test(l.description ?? "")));

const noGutter = build(design(20, 14, { kind: "hip", attach: "free", gutters: { kind: "none", guards: false } }));
const ng = deckChecks(noGutter).find((c) => c.id === "roof-free");
check("no gutter: still clear of the wall, and the checks warn — add gutters, or hang it on the house", !!noGutter.roof!.houseGap && !noGutter.roof!.houseGap.gutter && noGutter.roof!.houseGap.clearIn >= WALL_CLEAR_IN && ng?.level === "warn" && ng.fix?.label === "Add 5-in. gutters" && ng.alts?.[0]?.label === "Hang it on the house instead", ng);

const beside = build(design(20, 14, { kind: "gable", attach: "free" }, { placement: "beside" }));
const bs = deckChecks(beside).find((c) => c.id === "roof-free");
check("a deck beside the house (on its own posts): the same gap; hanging the roof on the wall is not offered", !!beside.roof!.houseGap && !bs?.alts);

const away = build(design(20, 14, { kind: "hip", attach: "free" }, { placement: "detached" }));
check("a deck away from the house: no gap to keep, the posts just inside the deck", away.roof!.houseGap === null && near(Math.min(...away.roof!.ring.map((p) => p.y)), 4.5, 0.6));

const pyramid = build(applyDeckPatch(base, { structure: "gazebo", floor: "deck", shape: { kind: "rect", widthFt: 14, depthFt: 14 }, roof: { ...base.roof, kind: "pyramid", attach: "free", plan: { ...base.roof.plan, shape: "follows-deck" } } }));
const pr = pyramid.roof!;
const pxs = pr.ring.map((p) => p.x);
const pys = pr.ring.map((p) => p.y);
check("a pyramid over a square deck stays a square pyramid, clear of the wall", pr.kind === "pyramid" && near(Math.max(...pxs) - Math.min(...pxs), Math.max(...pys) - Math.min(...pys), 0.6) && Math.min(...pr.eaveRing.map((p) => p.y)) > 0, { kind: pr.kind });

const octagon = build(applyDeckPatch(base, { structure: "gazebo", floor: "deck", shape: { kind: "rect", widthFt: 16, depthFt: 16 }, roof: { ...base.roof, kind: "pyramid", attach: "free", plan: { ...base.roof.plan, shape: "octagon", acrossFt: 12 } } }));
check("an octagon gazebo on a deck against the house: its back eave clear of the wall too", Math.min(...octagon.roof!.eaveRing.map((p) => p.y)) > 0, Math.min(...octagon.roof!.eaveRing.map((p) => p.y)));

// ── on the house: the flashing ──
console.log("── on the house: apron, step and kickout flashing");
const onWall = (w: number, d: number, kind: DeckDesign["roof"]["kind"]) => build(design(w, d, { kind, attach: "wall", gutters: { kind: "k5", guards: false } }));
const kinds = (s: ReturnType<typeof build>) => s.roof!.wallFlashing.map((f) => f.kind).sort().join(",");
const onTheWall = (s: ReturnType<typeof build>) => s.roof!.wallFlashing.every((f) => near(f.y0, 0, 0.05) && (f.kind === "kickout" || near(f.y1, 0, 0.05)));

const shed = onWall(20, 12, "shed");
const sf = shed.roof!.wallFlashing;
check("a shed: apron (L) flashing along its top edge on the wall, the whole width, level", kinds(shed) === "apron" && onTheWall(shed) && near(sf[0].z0, sf[0].z1, 0.05) && sf[0].lengthIn > 20 * 12 && sf[0].oy > 0.99, sf);
check("…at the roofing's top, where the roof meets the wall", near(sf[0].z0, shed.roof!.peakIn, 3), { z: sf[0].z0, peak: shed.roof!.peakIn });

const gable = onWall(20, 14, "gable");
check("a gable with its ridge into the house: step flashing up both slopes and a kickout at each eave", kinds(gable) === "kickout,kickout,step,step" && onTheWall(gable), kinds(gable));
const steps = gable.roof!.wallFlashing.filter((f) => f.kind === "step");
check("…each step line runs from the eave up to the ridge on the wall", steps.every((f) => f.z1 > f.z0 + 20 && near(f.lengthIn, Math.hypot(f.x1 - f.x0, f.z1 - f.z0), 0.5)));
const kicks = gable.roof!.wallFlashing.filter((f) => f.kind === "kickout");
check("…each kickout at the foot of a step line, pointing out past the eave", kicks.every((k) => steps.some((st) => near(st.x0, k.x0, 0.5) && near(st.z0, k.z0, 0.5)) && Math.hypot(k.x1 - k.x0, k.y1 - k.y0) > 5));

const deepHip = onWall(20, 14, "hip");
check("a hip whose ridge runs into the house: step flashing up both sides, two kickouts", kinds(deepHip) === "kickout,kickout,step,step" && onTheWall(deepHip), kinds(deepHip));
const wideHip = onWall(28, 8, "hip");
check("a wide, shallow hip on the house: apron along its top, step up its hip ends, two kickouts", kinds(wideHip) === "apron,kickout,kickout,step,step" && onTheWall(wideHip), kinds(wideHip));
check("the flashing's length is the roof's wall edge, counted once", [shed, gable, deepHip, wideHip].every((s) => near(s.roof!.wallFlashing.filter((f) => f.kind !== "kickout").reduce((n, f) => n + f.lengthIn, 0) / 12, s.roof!.wallFt, 0.2)));
check("on the house there is no gap", [shed, gable, deepHip, wideHip].every((s) => s.roof!.houseGap === null));

const gChecks = deckChecks(gable);
const flashRow = gChecks.find((c) => c.id === "roof-wall-flashing");
const kickRow = gChecks.find((c) => c.id === "roof-kickout");
check("the checks: flashed where it meets the siding, and where the water goes", flashRow?.level === "pass" && /step flashing up 2 slopes/.test(flashRow.text) && /off to the sides and down to the gutters/.test(flashRow.text) && flashRow.rule === "IRC R903.2", flashRow?.text);
check("…and the kickouts, on IRC R903.2.1", kickRow?.level === "pass" && /2 kickouts/.test(kickRow.text) && kickRow.rule === "IRC R903.2.1", kickRow?.text);
check("a shed's check names its apron flashing", /apron \(L\) flashing along the top/.test(deckChecks(shed).find((c) => c.id === "roof-wall-flashing")?.text ?? ""));

const gPkg = priceStructure(gable);
const wallLine = gPkg.bom.find((l) => l.id === "wall-flashing");
const kickLine = gPkg.bom.find((l) => l.id === "kickout");
check("the material list: step flashing by the foot, two kickouts, priced", !!wallLine && /^Step flashing where the roof meets the house/.test(wallLine.label) && !!kickLine && kickLine.qty === 2 && (kickLine.cost ?? 0) > 0, { wall: wallLine?.label, kick: kickLine });
check("…a shed's line says apron (L) flashing, and buys no kickout", /^Apron \(L\) flashing/.test(priceStructure(shed).bom.find((l) => l.id === "wall-flashing")?.label ?? "") && !priceStructure(shed).bom.some((l) => l.id === "kickout"));
check("…the price's roof-deck line says it is step-flashed with kickouts", gPkg.lines.some((l) => /step-flashed to the house with kickouts/.test(l.description ?? "")));

const gScene = deckScene(gable);
const roles = new Set(gScene.legend.map((l) => l.role));
check("the 3D draws the step flashing and the kickouts, and says how the water goes", roles.has("step flashing") && roles.has("kickout flashing") && gScene.legend.some((l) => l.nominal === "Roof to the house wall" && /off to the sides and down to the gutters/.test(l.note)));
check("…a shed's 3D draws its apron flashing", deckScene(shed).legend.some((l) => l.role === "apron flashing"));
const gWall = roofDetails(gable, null).find((d) => d.title === "Roof at the house wall");
check("the permit set draws the flashing at the wall, with the kickout's rule", !!gWall && gWall.notes.some((n) => /IRC R903\.2\.1/.test(n)) && gWall.drawing.items.some((i) => i.t === "text" && /step flashing/.test(i.s)), gWall?.notes);
check("nothing in either 3D is NaN", [frScene, gScene].every((sc) => sc.boxes.every((b) => b.every((n) => Number.isFinite(n)))));

console.log(bad ? `\n${bad} FAILED` : "\nall ok");
process.exit(bad ? 1 : 0);
