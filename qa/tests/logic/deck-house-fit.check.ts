// The house from its photo, and the deck put on it, right from the start (2026-11-14). Owner, of a two-storey house
// with a porch roof on a post over its right half and a bump-out in the middle: "it looks like it's falling apart …
// when I decide build from picture, that preset deck is supposed to watch where the bottom of the house is and not
// attach it right away to cover the windows … find the right spot and the height of the deck … render the whole
// picture uploaded with the roof … double check how you identify the jogs. It should be at the very first time
// already identified." Here, on his photo's read (its boxes measured off the picture by hand, the reader's two misreads
// in it: the wall's top line at the roof's top, the porch roof's half read one storey under a lean-to):
//   · a part with upper windows in its wall is never one storey — one block, one main roof (lib/deck/house);
//   · a wing's lean-to never climbs past the main eave;
//   · no door: the deck goes low on the slab, under the window sills — never higher than it was (houseFromPhoto);
//   · the wall's top line is brought from the roof's top down to the eave (houseSettle settleEave);
//   · every corner left open is decided at the first read, and said so (settleOpenCorners);
//   · a step of the model's behind a porch roof is kept beside the photo's own (keepUnseenJogs);
//   · a corner board beside a window is a corner, a window's own frame is not (wallSteps wallCorners);
//   · a covered deck's roof is brought under the upper windows (houseFit).
// Pure, no photo in the repo.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/deck-house-fit.check.ts
import { houseFromPhoto, NEAR_GROUND_IN, SILL_CLEAR_IN, SILL_OVER_FLOOR_IN } from "@/lib/deck/houseFromPhoto";
import { ROOF_PIECE, houseScene, isUpperWindow, upperWindowsOver, wallParts, type HouseDesign } from "@/lib/deck/house";
import { decidedWords, keepUnseenJogs, settleEave, settleOpenCorners } from "@/lib/deck/houseSettle";
import { roofClearOfWindows } from "@/lib/deck/houseFit";
import { readSections, type HouseRead } from "@/lib/deck/houseRead";
import { wallCorners } from "@/lib/deck/wallSteps";
import { defaultDeckDesign, defaultRoofDesign, normalizeDeckDesign, type DeckDesign } from "@/lib/deck/design";
import { applyDeckPatch, deckChecks } from "@/lib/deck/checks";
import { buildStructure } from "@/lib/deck/structure";
import type { Gray } from "@/lib/deck/photoSnap";

let bad = 0;
const check = (name: string, ok: boolean, info: unknown = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || info === "" ? "" : `  — ${typeof info === "string" ? info : JSON.stringify(info)}`}`);
};

// ── the owner's photo, 1644 × 902, as the reader gave it ────────────────────────────────────────────────────────────
const PW = 1644, PH = 902;
const fx = (px: number) => px / PW, fy = (px: number) => px / PH;
const win = (x0: number, x1: number, head: number, sill: number) => ({ x0: fx(x0), x1: fx(x1), head: fy(head), sill: fy(sill) });
function ownerRead(o: { eaveY?: number; misread?: boolean; jogs?: "sized" | "open" | "none"; door?: boolean; slab?: boolean } = {}): HouseRead {
  const jogs: HouseRead["jogs"] = o.jogs === "none" ? [] : o.jogs === "open" ? [{ x: fx(455), y: fy(748), dir: "toward", depthFt: 0 }, { x: fx(940), y: fy(748), dir: "toward", depthFt: 0 }] : [{ x: fx(457), y: fy(748), dir: "toward", depthFt: 3 }, { x: fx(938), y: fy(748), dir: "away", depthFt: 3 }];
  const eaveY = o.eaveY ?? 188;
  return {
    base: { left: { x: fx(190), y: fy(748) }, right: { x: fx(1430), y: fy(748) } },
    eave: { left: { x: fx(190), y: fy(eaveY) }, right: { x: fx(1430), y: fy(eaveY) } },
    storeys: 2,
    jogs,
    door: null,
    doors: o.door ? [{ x0: fx(1100), x1: fx(1260), top: fy(473), bottom: fy(690), kind: "slider" }] : [],
    windows: [win(352, 447, 485, 585), win(560, 828, 482, 648), win(1015, 1353, 487, 643), win(508, 676, 222, 330), win(740, 908, 220, 260), win(1010, 1088, 238, 368), win(1098, 1175, 238, 368), win(1185, 1262, 238, 368), win(1273, 1350, 238, 368)],
    patio: o.slab === false ? null : { x0: fx(930), x1: fx(1560) },
    scaleLine: null,
    bars: { top: 0, bottom: 0 },
    confidence: 0.8,
    note: null,
    roof: { kind: "hip", pitch: 5 },
    material: "lap",
    colours: { siding: "#6f6a62", roof: "#3a3a3c", trim: "#e8e2d2" },
    ...(o.misread ? { heights: [{ x0: fx(940), x1: fx(1430), storeys: 1 as const, roof: "shed" as const, wing: false }] } : {}),
    lookPast: [{ kind: "porch-roof", x0: fx(908), y0: fy(398), x1: fx(1560), y1: fy(480) }, ...(o.slab === false ? [] : [{ kind: "slab" as const, x0: fx(930), y0: fy(700), x1: fx(1560), y1: fy(770) }])],
  };
}
const d0 = defaultDeckDesign({ state: "WA" });
const covered = normalizeDeckDesign({ ...d0, structure: "covered-deck", shape: { kind: "rect", widthFt: 16, depthFt: 12 }, heightIn: 36, roof: { ...defaultRoofDesign("covered-deck"), kind: "gable", pitch: 4 } });
const build = (read: HouseRead, deckHeightIn: number | null = 36) => houseFromPhoto({ read, photoW: PW, photoH: PH, deckWidthFt: 16, house: covered.house, ...(deckHeightIn === null ? {} : { deckHeightIn }) })!;

// ── a part with upper windows in its wall is two storeys ────────────────────────────────────────────────────────────
{
  check("an upper window: its sill above where a ground-floor one's would be, its head past a storey", isUpperWindow({ kind: "window", sillFt: 10.5, heightFt: 3 }, 19) && !isUpperWindow({ kind: "window", sillFt: 3.3, heightFt: 4 }, 19) && !isUpperWindow({ kind: "slider", sillFt: 10.5, heightFt: 7 }, 19));
  const b = build(ownerRead({ misread: true }));
  check("the porch roof's half, read one storey under a lean-to, is built two storeys (its upper windows stand in it)", b.house.parts === null, b.house.parts);
  check("…and the review says why", b.checks.some((c) => /read as one storey under a low roof, but its wall stands level with the wall above it and 4 upper windows show in it — it is built two storeys tall/.test(c)), b.checks);
  // the same misread saved in a design before this fix: the scene still builds it whole
  const saved: HouseDesign = { ...b.house, parts: [null, null, { storeys: 1, roof: "shed" }] };
  const sc = houseScene(covered.shape, saved, { deckHeightFt: 3, peakFt: 13, mainEdge: null });
  const main = (sc.roofs ?? []).filter((r) => r[0] === ROOF_PIECE.hip);
  check("a saved design with that misread: one main roof over the whole wall, no wing beside it", main.length === 1 && (sc.roofs ?? []).every((r) => r[0] !== ROOF_PIECE.shed) && sc.blocks.every((bl) => bl[4] === sc.heightFt), { roofs: sc.roofs, blocks: sc.blocks });
  const parts = wallParts(saved, covered.shape);
  check("upperWindowsOver counts the four upper windows over the right part", upperWindowsOver(saved.openings, parts[2].x0, parts[2].x1, saved.eaveHeightFt) === 4, { parts, n: upperWindowsOver(saved.openings, parts[2].x0, parts[2].x1, saved.eaveHeightFt) });
  // a part marked a wing is still a wing, and its lean-to never climbs past the main eave
  const wingHouse: HouseDesign = { ...saved, parts: [null, null, { storeys: 1, roof: "shed", wing: true }], openings: (saved.openings ?? []).filter((o) => !(isUpperWindow(o, saved.eaveHeightFt) && o.xFt > parts[2].x0)) };
  const ws = houseScene(covered.shape, wingHouse, { deckHeightFt: 3, peakFt: 13, mainEdge: null });
  // the body's roofs (kinds 0–4): the main one at the house's eave, the wing's lower, side by side
  const body = (ws.roofs ?? []).filter((r) => r[0] <= ROOF_PIECE.flat);
  const wingRoof = body.find((r) => r[5] < ws.heightFt);
  const mainRoof = body.find((r) => r[5] === ws.heightFt);
  check("a part marked a wing is still a wing: its own lean-to, lower, beside the main roof", !!wingRoof && !!mainRoof && wingRoof[0] === ROOF_PIECE.shed && wingRoof[1] >= mainRoof[3] - 0.01, { roofs: ws.roofs });
  check("…and that lean-to rises no more than three feet over the house's depth (it rose eight, past the main eave)", !!wingRoof && ((wingRoof[4] - wingRoof[2]) * wingRoof[6]) / 12 <= 3.01 && wingRoof[5] + ((wingRoof[4] - wingRoof[2]) * wingRoof[6]) / 12 < ws.heightFt, wingRoof);
}

// ── the deck's height where no door says it ─────────────────────────────────────────────────────────────────────────
{
  const b = build(ownerRead());
  check("no door, a slab at the wall's foot: the deck goes low — near the ground", b.heightIn === NEAR_GROUND_IN && b.heightBy === "windows", { heightIn: b.heightIn, by: b.heightBy });
  check("…its boards well under the lowest ground-floor sill, said in the review", b.sillIn !== null && b.heightIn! <= b.sillIn - SILL_CLEAR_IN && b.facts.some((f) => f.id === "deck" && /set low, 1 ft 2 in\. off the ground — under the window sills/.test(f.value) && f.guess), { sillIn: b.sillIn, facts: b.facts.find((f) => f.id === "deck") });
  const noSlab = build(ownerRead({ slab: false }));
  check("no slab: two feet under the lowest sill (where the house's floor most likely is)", noSlab.heightBy === "windows" && noSlab.heightIn === Math.max(NEAR_GROUND_IN, noSlab.sillIn! - SILL_OVER_FLOOR_IN), { h: noSlab.heightIn, sill: noSlab.sillIn });
  const low = build(ownerRead(), 10);
  check("never raised: a deck already lower stays where it is", low.heightIn === null && low.heightBy === null, { h: low.heightIn });
  const door = build(ownerRead({ door: true }));
  check("a door seen: its threshold says the height, as before (an inch under it)", door.heightBy === "door" && door.heightIn !== null && door.heightIn > NEAR_GROUND_IN + 3, { h: door.heightIn, by: door.heightBy });
  const none = build(ownerRead(), null);
  check("asked without the deck's height (an older caller): nothing is changed", none.heightIn === null);
}

// ── the wall's top line ─────────────────────────────────────────────────────────────────────────────────────────────
{
  const atRoofTop = settleEave(ownerRead({ eaveY: 60 }));
  check("the reader's top line at the roof's top is brought down to the eave (over the top windows' heads)", atRoofTop.moved && Math.abs(atRoofTop.read.eave!.left.y * PH - 161) < 6, { y: atRoofTop.read.eave!.left.y * PH });
  check("…a line where the eave is stays where it is", !settleEave(ownerRead({ eaveY: 188 })).moved && !settleEave(ownerRead({ eaveY: 150 })).moved);
  const small = build(ownerRead({ eaveY: 60 })), right = build(atRoofTop.read);
  check("…and the house comes out its size: about 38 ft, not 32", small.wallFt < 33.5 && right.wallFt > 37 && right.wallFt < 41, { before: small.wallFt, after: right.wallFt });
  // on a picture: the strongest edge across the wall near there, the lowest of the gutter's and the fascia's
  const G: Gray = { w: 400, h: 300, data: new Float32Array(400 * 300).fill(0.5) };
  for (let x = 0; x < 400; x++) {
    for (let y = 0; y < 40; y++) G.data[y * 400 + x] = 0.3; // the roof
    for (let y = 40; y < 48; y++) G.data[y * 400 + x] = 0.08; // the fascia and its shadow
  }
  const r: HouseRead = { ...ownerRead({ eaveY: 0 }), base: { left: { x: 0.1, y: 0.9 }, right: { x: 0.9, y: 0.9 } }, eave: { left: { x: 0.1, y: 0.02 }, right: { x: 0.9, y: 0.02 } }, windows: [{ x0: 0.2, x1: 0.3, head: 0.2, sill: 0.35 }, { x0: 0.5, x1: 0.6, head: 0.2, sill: 0.35 }, { x0: 0.2, x1: 0.3, head: 0.55, sill: 0.7 }], lookPast: [] };
  const onPic = settleEave(r, G);
  check("on the picture: onto the wall's own top edge (the fascia's foot), not a guess", onPic.moved && onPic.onEdge && Math.abs(onPic.read.eave!.left.y * 300 - 47) <= 2, { y: onPic.read.eave!.left.y * 300, onEdge: onPic.onEdge });
}

// ── every corner decided at the first read ──────────────────────────────────────────────────────────────────────────
{
  const open = ownerRead({ jogs: "open" });
  const byModel = settleOpenCorners(open, { model: readSections(ownerRead()) });
  check("open corners, the model's first read at hand: the middle comes out 3 ft, back 3 ft after it", byModel.read.jogs.map((j) => `${j.dir}:${j.depthFt}`).join() === "toward:3,away:3" && byModel.decided.every((d) => d.by === "model"), byModel.read.jogs);
  check("…and the review says what decided them, with the way to turn one round", /2 corners' ways decided from the model's first look — tap a part if it stands the other way/.test(decidedWords(byModel.decided)), decidedWords(byModel.decided));
  const byShape = settleOpenCorners(open);
  check("nothing else to go by: the porch roof's side stands back, the part between comes out", byShape.read.jogs.map((j) => j.dir).join() === "toward,away" && byShape.read.jogs.every((j) => j.depthFt === null), byShape.read.jogs);
  const byLook = settleOpenCorners(open, { leans: [{ x: fx(455), verdict: "right-forward", stepFt: 2.5, confidence: 0.4 }, { x: fx(940), verdict: "not-a-corner", stepFt: null, confidence: 0.6 }] });
  check("the close look's own leaning comes first; a line it took for no step is left out", byLook.read.jogs.length === 1 && byLook.read.jogs[0].dir === "toward" && byLook.read.jogs[0].depthFt === 2.5 && byLook.decided.some((d) => d.by === "level"), byLook.read.jogs);
  const own: HouseRead = { ...open, lookPast: [], jogs: [open.jogs[1]], heights: [{ x0: fx(940), x1: fx(1430), storeys: 1, roof: "shed", wing: false }] };
  const byRoof = settleOpenCorners(own);
  check("a low roof of its own over one side: that side comes out", byRoof.read.jogs[0].dir === "toward" && byRoof.decided[0].by === "roof", byRoof.read.jogs);
  check("nothing open: the read is left alone", settleOpenCorners(ownerRead()).decided.length === 0);
}

// ── the model's steps where the photo could not look ────────────────────────────────────────────────────────────────
{
  const r = ownerRead();
  const pixel = [{ x: fx(455), y: fy(748), dir: "toward" as const, depthFt: 3 }];
  const kept = keepUnseenJogs(pixel, r.jogs, r);
  check("the photo found the left corner only (the right one is behind the porch roof): the model's right step is kept", kept.length === 2 && kept[1].dir === "away" && Math.abs(kept[1].x - fx(938)) < 0.002, kept);
  check("…not where the wall shows (the photo's own word stands there)", keepUnseenJogs(pixel, r.jogs, { ...r, lookPast: [] }).length === 1);
}

// ── a corner board beside a window ──────────────────────────────────────────────────────────────────────────────────
{
  const W = 600, H = 520, BASE = 440, EAVE = 120;
  const d = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) d[y * W + x] = y < EAVE ? 0.3 : y >= BASE ? 0.35 : y % 7 === 0 ? 0.44 : 0.5;
  const board = (cx: number, y0: number, y1: number) => { for (let y = y0; y < y1; y++) for (let x = cx - 2; x <= cx + 1; x++) d[y * W + x] = 0.92; };
  const box = (x0: number, x1: number, head: number, sill: number) => { for (let y = head; y <= sill; y++) for (let x = x0; x <= x1; x++) d[y * W + x] = y - head < 3 || sill - y < 3 || x - x0 < 3 || x1 - x < 3 ? 0.92 : 0.22; };
  board(60, EAVE, BASE);
  board(540, EAVE, BASE);
  board(250, EAVE, BASE); // the bump-out's corner, 6 px from the window's side
  box(180, 244, 350, 400);
  box(400, 460, 160, 400); // a tall window whose own frame runs most of both storeys — no corner
  const g: Gray = { w: W, h: H, data: d };
  const read: HouseRead = { ...ownerRead({ jogs: "none" }), base: { left: { x: 60 / W, y: BASE / H }, right: { x: 540 / W, y: BASE / H } }, eave: { left: { x: 60 / W, y: EAVE / H }, right: { x: 540 / W, y: EAVE / H } }, windows: [{ x0: 180 / W, x1: 244 / W, head: 350 / H, sill: 400 / H }, { x0: 400 / W, x1: 460 / W, head: 160 / H, sill: 400 / H }], doors: [], lookPast: [], patio: null };
  const c = wallCorners(read, g).map((x) => Math.round(x * W));
  check("a corner board six pixels from a window's side is a corner", c.some((x) => Math.abs(x - 250) <= 5), c);
  check("…a tall window's own frame is not", !c.some((x) => Math.abs(x - 400) <= 4 || Math.abs(x - 460) <= 4), c);
}

// ── the covered deck's roof under the upper windows ─────────────────────────────────────────────────────────────────
{
  const b = build(settleEave(ownerRead({ eaveY: 60 })).read);
  const on = (d: DeckDesign) => deckChecks(buildStructure(d)).find((x) => x.id === "roof-openings");
  const placed = applyDeckPatch(covered, { house: b.house, heightIn: b.heightIn ?? covered.heightIn });
  const fit = roofClearOfWindows(placed);
  check("the preset covered deck on that wall: its roof would meet the house across the upper windows", on(placed)?.level === "fail", on(placed)?.text);
  check("…so it is brought clear — the least change to the roof — and said", !!fit && on({ ...placed, roof: fit.roof })?.level === "pass" && /so it meets the house clear of the windows/.test(fit.words), fit?.words);
  check("…never flatter than shingles take without fuss where lower posts help: 3:12 at the least, posts no lower than 7 ft", !!fit && fit.roof.pitch >= 3 && fit.roof.eaveHeightIn >= 84 && fit.roof.eaveHeightIn < covered.roof.eaveHeightIn, { pitch: fit?.roof.pitch, eave: fit?.roof.eaveHeightIn });
  check("…and the least change that works: posts alone at 7 ft would still cross", on({ ...placed, roof: { ...placed.roof, eaveHeightIn: 84 } })?.level === "fail");
  check("a roof already clear, an open deck, a house drawn by rule: nothing", roofClearOfWindows({ ...placed, roof: fit!.roof }) === null && roofClearOfWindows({ ...placed, structure: "deck" }) === null && roofClearOfWindows(covered) === null);
}

console.log(bad ? `\n${bad} FAILED` : "\nALL PASS");
process.exit(bad ? 1 : 0);
