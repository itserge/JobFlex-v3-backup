// The old deck in the photo (2026-11-13, lib/deck/houseInFront — owner: "if there is a picture from the backyard with
// the old deck, make it remove the deck, because instead of this deck we're going to build something new. But we need
// as accurate a takeoff as possible from the picture, the shape of the wall"). What the model says stands in front of
// the wall is kept with the read (through the cut, the two looks, the straightening and a save), kept out of the
// corner pass, the colour measure and the depth map, said as left out; a door behind the old railing is carried down
// to the old floor; that floor's height is offered for the new deck; a porch roof on posts can be kept as an existing
// cover, through the house, the scene and its parser. Pure — the model's call itself is not made here.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/deck-house-old-deck.check.ts
import { HOUSE_READ_PROMPT_PX, fromStructured, houseReadSchema, mapHouseRead, mergeLooks, normalizeHouseRead, parseHouseRead, readFromCrop, type HouseRead, type HouseReadStructured } from "@/lib/deck/houseRead";
import { LEFT_OUT_TAG, inFrontAt, leftOut, leftOutWords, oldDeckOf, porchRoofOf, removeInFront, settleBehindDeck } from "@/lib/deck/houseInFront";
import { colourZones, houseFromPhoto } from "@/lib/deck/houseFromPhoto";
import { wallCorners } from "@/lib/deck/wallSteps";
import { depthVerdicts, type DepthMap } from "@/lib/deck/houseDepth";
import type { Gray } from "@/lib/deck/photoSnap";
import { COVER_OUT_DEFAULT_FT, COVER_PITCH, ROOF_PIECE, defaultHouse, houseScene, normalizeHouse, shiftHouseThings, type HouseDesign } from "@/lib/deck/house";
import { defaultDeckDesign, type DeckShape } from "@/lib/deck/design";
import { applyDeckPatch } from "@/lib/deck/checks";
import { buildStructure } from "@/lib/deck/structure";
import { deckScene, parseDeckScene } from "@/lib/deck/scene";

let bad = 0;
const check = (name: string, ok: boolean, info = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !info ? "" : `  — ${info}`}`);
};
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

console.log("— what stands in front of the wall is kept with the read —");
// a two-storey wall across a 1200 × 900 picture: base at y 720, eave at y 270; a door behind an old deck's railing
const W = 1200, H = 900;
const answer: HouseReadStructured = {
  subject: { kind: "house-exterior", confidence: 0.95, reason: "the back of a house" },
  image: { w: W, h: H },
  outline: null,
  base: { left: { x: 120, y: 720 }, right: { x: 1080, y: 720 } },
  eave: { left: { x: 120, y: 270 }, right: { x: 1080, y: 270 } },
  storeys: 2,
  sections: [{ x0: 120, x1: 1080, outFt: 0, storeys: 2, roof: "main", wing: false, why: "one flat wall" }],
  // boxed only down to the old railing's top rail: 100 px of a door 200 px tall
  doors: [{ x0: 560, x1: 640, bottom: 590, top: 490, kind: "hinged", ontoYard: true }],
  windows: [{ x0: 240, x1: 330, sill: 430, head: 340 }, { x0: 800, x1: 890, sill: 430, head: 340 }, { x0: 240, x1: 330, sill: 640, head: 550 }],
  patio: null,
  roof: { kind: "hip", pitch: 5 },
  material: "lap",
  colours: { siding: "#8a8f94", roof: "#3c3c3c", trim: "#ffffff" },
  lookPast: [
    { kind: "old-deck", x0: 420, y0: 590, x1: 900, y1: 780, floorY: 690 },
    { kind: "stairs", x0: 900, y0: 640, x1: 990, y1: 800, floorY: 700 },
    { kind: "porch-roof", x0: 420, y0: 455, x1: 900, y1: 490, floorY: null },
    { kind: "tree", x0: 0, y0: 100, x1: 110, y1: 800, floorY: null },
    { kind: "slab", x0: 150, y0: 715, x1: 400, y1: 760, floorY: null },
  ],
  bars: { top: 0, bottom: 0 },
  confidence: 0.8,
  note: null,
};
check("the schema takes an old deck with its floor line", houseReadSchema.safeParse(answer).success && !houseReadSchema.safeParse({ ...answer, lookPast: [{ kind: "old-deck", x0: 1, y0: 1, x1: 9, y1: 9 }] }).success);
check("the model is told the old deck will be torn out, to box all of it, and where its floor is", /will be torn out/.test(HOUSE_READ_PROMPT_PX) && /"floorY"/.test(HOUSE_READ_PROMPT_PX) && /kind "old-deck"/.test(HOUSE_READ_PROMPT_PX) && /The wall's BASE runs behind the deck at the GROUND/.test(HOUSE_READ_PROMPT_PX) && /boxed down to that floor line/.test(HOUSE_READ_PROMPT_PX));
const read = parseHouseRead(fromStructured(answer, W, H))!;
const deck = oldDeckOf(read)!;
check("the read keeps each thing, in the picture's fractions", !!read && read.lookPast?.length === 5 && near(deck.x0, 0.35, 0.001) && near(deck.x1, 0.75, 0.001) && near(deck.y0, 590 / 900, 0.001), JSON.stringify(read.lookPast));
check("the old deck keeps its floor line; nothing else has one", near(deck.floor ?? 0, 690 / 900, 0.001) && read.lookPast!.filter((b) => b.floor !== undefined).length === 1, JSON.stringify(read.lookPast));
check("a floor line outside its own box is not believed", parseHouseRead({ ...fromStructured(answer, W, H), lookPast: [{ kind: "old-deck", x0: 0.35, x1: 0.75, y0: 0.65, y1: 0.86, floor: 0.3 }] })!.lookPast![0].floor === undefined);
check("an unknown kind or an empty box is dropped", parseHouseRead({ ...fromStructured(answer, W, H), lookPast: [{ kind: "spaceship", x0: 0.1, x1: 0.5, y0: 0.1, y1: 0.5 }, { kind: "tree", x0: 0.1, x1: 0.105, y0: 0.1, y1: 0.5 }] })!.lookPast === undefined);
const saved = normalizeHouseRead(JSON.parse(JSON.stringify(read)))!;
check("a read saved in a design comes back with them", JSON.stringify(saved.lookPast) === JSON.stringify(read.lookPast));
check("an older read without them still loads, with none", (() => { const o: Record<string, unknown> = JSON.parse(JSON.stringify(read)); delete o.lookPast; const back = normalizeHouseRead(o); return !!back && back.lookPast === undefined; })());

// the close look, on a cut of the picture
const cut = { x: 0.05, y: 0.2, w: 0.9, h: 0.7 };
const closeAnswer: HouseReadStructured = { ...answer, lookPast: [{ kind: "old-deck", x0: 0.34, y0: 0.63, x1: 0.78, y1: 0.95, floorY: 0.8 }, { kind: "awning", x0: 0.1, y0: 0.3, x1: 0.2, y1: 0.36, floorY: null }] };
const closeRead = { ...read, lookPast: closeAnswer.lookPast.map((b) => ({ kind: b.kind, x0: b.x0, x1: b.x1, y0: b.y0, y1: b.y1, ...(b.floorY !== null ? { floor: b.floorY } : {}) })) } as HouseRead;
const fromCut = readFromCrop(closeRead, cut);
check("a read made on a cut says them in the whole picture's fractions", near(fromCut.lookPast![0].x0, 0.05 + 0.34 * 0.9, 0.002) && near(fromCut.lookPast![0].floor ?? 0, 0.2 + 0.8 * 0.7, 0.002), JSON.stringify(fromCut.lookPast));
const both = mergeLooks(read, { ...readFromCrop({ ...read, lookPast: undefined } as HouseRead, { x: 0, y: 0, w: 1, h: 1 }), lookPast: fromCut.lookPast });
const mergedDeck = oldDeckOf(both)!;
check("the two looks: one old deck, its box the wider of the two, its floor the close look's", both.lookPast!.filter((b) => b.kind === "old-deck").length === 1 && mergedDeck.x1 >= 0.75 && near(mergedDeck.floor ?? 0, 0.76, 0.002), JSON.stringify(both.lookPast));
check("…what only the close look saw is added; what only the whole picture saw stays", both.lookPast!.some((b) => b.kind === "awning") && both.lookPast!.some((b) => b.kind === "tree") && both.lookPast!.some((b) => b.kind === "stairs"));

// the straightened picture: every point moved a tenth to the right and squeezed
const pt = (p: { x: number; y: number }) => ({ x: 0.1 + p.x * 0.8, y: p.y * 0.9 });
const withHeights: HouseRead = { ...read, heights: [{ x0: 0.6, x1: 0.9, storeys: 1, roof: "shed", wing: false }] };
const warped = mapHouseRead(withHeights, (r) => ({ ...r, base: { left: pt(r.base.left), right: pt(r.base.right) }, eave: r.eave ? { left: pt(r.eave.left), right: pt(r.eave.right) } : null }), pt);
check("a straightened picture carries them along", warped.lookPast?.length === 5 && near(oldDeckOf(warped)!.x0, 0.1 + 0.35 * 0.8, 0.002) && near(oldDeckOf(warped)!.floor ?? 0, (690 / 900) * 0.9, 0.002), JSON.stringify(warped.lookPast));
check("…and each part's own height and roof with them (they were dropped before)", warped.heights?.length === 1 && near(warped.heights[0].x0, 0.1 + 0.6 * 0.8, 0.002) && warped.heights[0].roof === "shed", JSON.stringify(warped.heights));

console.log("— said as left out —");
check("the old deck and its stairs, the porch roof — a tree and a slab are not named", leftOutWords(read) === "the old deck, its stairs and the porch roof" && leftOut(read).length === 3, String(leftOutWords(read)));
check("stairs with no deck are the old stairs; nothing in front says nothing", leftOutWords({ lookPast: [{ kind: "stairs", x0: 0.1, x1: 0.2, y0: 0.5, y1: 0.9 }] }) === "the old stairs" && leftOutWords({ lookPast: [{ kind: "tree", x0: 0.1, x1: 0.2, y0: 0.5, y1: 0.9 }] }) === null && leftOutWords({}) === null);
check("each has a tag for the picture", LEFT_OUT_TAG["old-deck"] === "Old deck" && LEFT_OUT_TAG["porch-roof"] === "Porch roof");
const without = removeInFront(read, leftOut(read)[0].i);
check("a mark that is wrong is taken off the read", oldDeckOf(without) === null && without.lookPast?.length === 4 && removeInFront({ ...read, lookPast: [read.lookPast![0]] }, 0).lookPast === undefined);
check("the widest porch roof is the one offered", near(porchRoofOf(read)!.x0, 0.35, 0.001) && porchRoofOf(without) !== null && porchRoofOf({}) === null);

console.log("— kept out of the passes that read the wall —");
const front = inFrontAt(read);
check("inside the old deck's box the wall is hidden; beside it, it is not", front(0.5, 0.7) && !front(0.2, 0.7) && !front(0.5, 0.4));
check("a slab at the wall's foot hides nothing", !front(0.2, 0.81));
check("under a porch roof the wall counts as hidden only when asked", !front(0.5, 0.6) && inFrontAt(read, { under: true })(0.5, 0.6) && !inFrontAt(read, { under: true })(0.5, 0.45));

// the corner pass, on a drawn wall: siding, one real corner board, an old deck's railing across the lower storey
const GW = 600, GH = 500, EAVE = 150, BASE = 450;
function drawWall(opts: { rail?: { x0: number; x1: number; y0: number; y1: number }; upperEdgeAt?: number; cornerAt?: number }): Gray {
  const d = new Float32Array(GW * GH);
  for (let y = 0; y < GH; y++)
    for (let x = 0; x < GW; x++) {
      let v = 0.85;
      if (y >= EAVE && y < BASE && x >= 40 && x < 560) v = y % 7 === 0 ? 0.44 : 0.5;
      if (y >= BASE) v = 0.35;
      d[y * GW + x] = v;
    }
  const board = (cx: number, y0: number, y1: number) => { for (let y = y0; y < y1; y++) for (let x = cx - 2; x <= cx + 1; x++) d[y * GW + x] = 0.92; };
  if (opts.cornerAt) board(opts.cornerAt, EAVE + 4, BASE);
  // an edge that stands only in the upper storey (a shutter, a downspout's upper run)
  if (opts.upperEdgeAt) board(opts.upperEdgeAt, EAVE + 4, EAVE + 150);
  // the railing: a top rail and a baluster every 6 px
  if (opts.rail) {
    const r = opts.rail;
    for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) d[y * GW + x] = y - r.y0 < 4 || x % 6 < 2 ? 0.12 : d[y * GW + x];
  }
  return { w: GW, h: GH, data: d };
}
const wallRead = (lookPast?: HouseRead["lookPast"]): HouseRead =>
  ({
    base: { left: { x: 40 / GW, y: BASE / GH }, right: { x: 560 / GW, y: BASE / GH } },
    eave: { left: { x: 40 / GW, y: EAVE / GH }, right: { x: 560 / GW, y: EAVE / GH } },
    storeys: 2, jogs: [], door: null, doors: [], windows: [], patio: null, scaleLine: null,
    roof: { kind: "hip", pitch: 5 }, material: "lap", colours: { siding: null, roof: null, trim: null }, bars: { top: 0, bottom: 0 }, confidence: 0.8, note: null,
    ...(lookPast ? { lookPast } : {}),
  }) as HouseRead;
// the railing covers the lower storey from x 80 to 300; a shutter's edge stands above it at x 200; the real corner at x 420
const rail = { x0: 80, x1: 300, y0: 300, y1: 450 };
const g1 = drawWall({ rail, upperEdgeAt: 200, cornerAt: 420 });
const blind = wallCorners(wallRead(), g1);
check("without the old deck marked, its railing makes a corner of an edge that stands only upstairs", blind.some((c) => near(c, 200 / GW, 0.012)) && blind.some((c) => near(c, 420 / GW, 0.012)), JSON.stringify(blind));
const deckBox = [{ kind: "old-deck" as const, x0: 80 / GW, x1: 300 / GW, y0: 300 / GH, y1: 450 / GH }];
const seeing = wallCorners(wallRead(deckBox), g1);
check("with the old deck marked, that corner is gone and the real one stays", !seeing.some((c) => c > 80 / GW && c < 300 / GW) && seeing.some((c) => near(c, 420 / GW, 0.012)), JSON.stringify(seeing));
// a real corner whose foot is behind a low deck: half of the lower storey still shows above the rail
const lowRail = { x0: 80, x1: 300, y0: 380, y1: 450 };
const g2 = drawWall({ rail: lowRail, cornerAt: 200 });
const lowBox = [{ kind: "old-deck" as const, x0: 80 / GW, x1: 300 / GW, y0: 380 / GH, y1: 450 / GH }];
check("a corner that still shows above a low deck is found behind it", wallCorners(wallRead(lowBox), g2).some((c) => near(c, 200 / GW, 0.012)), JSON.stringify(wallCorners(wallRead(lowBox), g2)));
// a porch roof's post under the roof is no corner of a one-storey wall
const g3 = drawWall({ cornerAt: 420 });
for (let y = 180; y < BASE; y++) for (let x = 248; x < 253; x++) g3.data[y * GW + x] = 0.9; // the post, ground to the porch roof
const oneStorey = (lp?: HouseRead["lookPast"]): HouseRead => ({ ...wallRead(lp), storeys: 1 });
const porchBox = [{ kind: "porch-roof" as const, x0: 100 / GW, x1: 400 / GW, y0: 165 / GH, y1: 180 / GH }];
check("a porch roof's post reads as a corner of a one-storey wall until the roof is marked", wallCorners(oneStorey(), g3).some((c) => near(c, 250 / GW, 0.012)) && !wallCorners(oneStorey(porchBox), g3).some((c) => near(c, 250 / GW, 0.02)) && wallCorners(oneStorey(porchBox), g3).some((c) => near(c, 420 / GW, 0.012)), `${JSON.stringify(wallCorners(oneStorey(), g3))} → ${JSON.stringify(wallCorners(oneStorey(porchBox), g3))}`);

// the colours
const zones = colourZones(read, W, H);
const zonesBare = colourZones({ ...read, lookPast: undefined } as HouseRead, W, H);
check("the old deck's boards are not sampled as the wall's colour", zonesBare.wall(0.45, 0.7) && !zones.wall(0.45, 0.7) && zones.wall(0.2, 0.5));
check("…nor the shade under the porch roof", zonesBare.wall(0.45, 0.6) && !zones.wall(0.45, 0.6));

// the depth map: the left part of the wall set back, an old deck standing nearer than the main wall behind it
const dm = (): DepthMap => {
  const w = 160, h = 120, data = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const fx = (x + 0.5) / w, fy = (y + 0.5) / h;
      let v = fx < 0.34 ? 0.44 : 0.5; // the wall: its left part further off
      if (fy > 0.82) v = 0.8; // the ground in front: nearer
      if (fx >= 0.35 && fx <= 0.75 && fy >= 590 / 900 && fy <= 780 / 900) v = 0.7; // the old deck
      data[y * w + x] = v;
    }
  return { w, h, data };
};
const twoParts: HouseRead = { ...read, jogs: [{ x: 0.34, y: 0.8, dir: "toward", depthFt: 0 }] };
const blindDepth = depthVerdicts({ ...twoParts, lookPast: undefined } as HouseRead, dm());
const seeingDepth = depthVerdicts(twoParts, dm());
check("unmarked, the old deck spoils the main wall's plane: the part set back is not seen", blindDepth.verdicts[0].state !== "back", JSON.stringify(blindDepth));
check("marked, the main wall reads true: the left part is back, and the deck is no relief", seeingDepth.verdicts[0].state === "back" && seeingDepth.verdicts[0].sure >= 0.9 && seeingDepth.relief.length === 0, JSON.stringify(seeingDepth));

console.log("— the doors behind the old railing —");
const settled = settleBehindDeck(read);
const door0 = settled.read.doors[0];
check("a door boxed down to the top rail is carried to the old deck's floor", settled.doors === 1 && near(door0.bottom, 690 / 900, 0.001) && near(door0.top, 490 / 900, 0.001), JSON.stringify(settled.read.doors));
check("…the back door with it", near(settled.read.door!.bottom, 690 / 900, 0.001));
check("a door already down on the floor is left", settleBehindDeck(settled.read).doors === 0);
check("a garage door, and a door beside the deck, are left", settleBehindDeck({ ...read, doors: [{ ...read.doors[0], kind: "garage" }], door: null }).doors === 0 && settleBehindDeck({ ...read, doors: [{ ...read.doors[0], x0: 0.1, x1: 0.16 }], door: null }).doors === 0);
check("a box far too short to be half a door is not stretched", settleBehindDeck({ ...read, doors: [{ ...read.doors[0], top: 0.63, bottom: 0.66 }], door: null }).doors === 0);
check("with no old deck nothing moves", settleBehindDeck(without).doors === 0 && settleBehindDeck(without).read === without);

console.log("— the house that is built —");
const design = defaultDeckDesign({ state: "WA" });
const built = houseFromPhoto({ read: settled.read, photoW: W, photoH: H, deckWidthFt: design.shape.widthFt, house: design.house })!;
// the door, whole again, is 200 px for 80 in.: 30 px a foot; the old floor 30 px above the wall's foot = 12 in.
check("the door, whole again, sets the scale: 30 px to the foot, a 32-ft wall", built.scale.by === "door" && near(built.scale.pxPerFt, 30, 0.2) && near(built.wallFt, 32, 0.2), JSON.stringify(built.scale));
check("the old deck's floor is read 12 in. off the ground", built.oldDeckIn === 12, String(built.oldDeckIn));
check("with a door, the deck's height is the door's (an inch under its threshold)", built.heightBy === "door" && built.heightIn === 11, `${built.heightBy} ${built.heightIn}`);
const noDoor = houseFromPhoto({ read: { ...settled.read, doors: [], door: null }, photoW: W, photoH: H, deckWidthFt: design.shape.widthFt, house: design.house, wallWidthFt: 32 })!;
check("with no door, the new deck's floor is offered where the old deck's is", noDoor.heightBy === "old-deck" && noDoor.heightIn === 12, `${noDoor.heightBy} ${noDoor.heightIn}`);
const noFloor = houseFromPhoto({ read: { ...settled.read, doors: [], door: null, lookPast: settled.read.lookPast!.map((b) => ({ kind: b.kind, x0: b.x0, x1: b.x1, y0: b.y0, y1: b.y1 })) }, photoW: W, photoH: H, deckWidthFt: design.shape.widthFt, house: design.house, wallWidthFt: 32 })!;
check("an old deck whose floor could not be seen offers no height", noFloor.heightBy === null && noFloor.heightIn === null && noFloor.oldDeckIn === null && noFloor.leftOut !== null);
const fact = built.facts.find((f) => f.id === "left-out");
check("the summary says what was left out, and that the new deck goes in its place", built.leftOut === "the old deck, its stairs and the porch roof" && !!fact && /^The old deck, its stairs and the porch roof — not built: the new deck goes in its place$/.test(fact.value), fact?.value);
check("nothing in front: no such line", !houseFromPhoto({ read: { ...settled.read, lookPast: undefined } as HouseRead, photoW: W, photoH: H, deckWidthFt: design.shape.widthFt, house: design.house })!.facts.some((f) => f.id === "left-out"));
check("the old deck is no part of the house: no step, no cover, the wall straight", built.house.jogs.length === 0 && built.house.covers === null);
const onDeck = houseFromPhoto({ read: { ...settled.read, base: { left: { x: 0.1, y: 0.76 }, right: { x: 0.9, y: 0.76 } } }, photoW: W, photoH: H, deckWidthFt: design.shape.widthFt, house: design.house })!;
check("a bottom line drawn on the old deck's floor is said", onDeck.checks.some((c) => /sits on the old deck, not on the ground behind it/.test(c)) && !built.checks.some((c) => /sits on the old deck/.test(c)));
const apart = houseFromPhoto({ read: { ...settled.read, lookPast: settled.read.lookPast!.map((b) => (b.kind === "old-deck" ? { ...b, floor: 0.72 } : b)) }, photoW: W, photoH: H, deckWidthFt: design.shape.widthFt, house: design.house })!;
check("a threshold and an old floor that disagree by more than half a foot are said", apart.checks.some((c) => /They should be about the same|they should be about the same/.test(c)), JSON.stringify(apart.checks));

console.log("— a porch roof that stays —");
check("a porch roof seen is offered, with its width", !!built.porch && near(built.porch.widthFt, 16, 0.5), JSON.stringify(built.porch));
const kept = houseFromPhoto({ read: settled.read, photoW: W, photoH: H, deckWidthFt: design.shape.widthFt, house: design.house, keepCovers: true })!;
const cover = kept.house.covers?.[0];
check("kept: one cover where the roof was seen, 10 ft out unless set", kept.house.covers?.length === 1 && !!cover && near(cover.x1Ft - cover.x0Ft, 16, 0.5) && cover.outFt === COVER_OUT_DEFAULT_FT, JSON.stringify(kept.house.covers));
// the roof's front edge at y 490: 230 px above the wall's foot = 7 ft 8 in.
check("…its front edge at the height the picture shows", !!cover && near(cover.heightFt, 7.5, 0.26), String(cover?.heightFt));
check("…said: not left out any more, kept as an existing cover, its reach a guess", kept.leftOut === "the old deck and its stairs" && /the porch roof kept as an existing cover/.test(kept.facts.find((f) => f.id === "left-out")!.value) && kept.checks.some((c) => /cannot show how far it comes out/.test(c)));
check("…set further out", houseFromPhoto({ read: settled.read, photoW: W, photoH: H, deckWidthFt: design.shape.widthFt, house: design.house, keepCovers: true, coverOutFt: 14 })!.house.covers![0].outFt === 14);
check("a house built again without the switch drops a cover it had", houseFromPhoto({ read: settled.read, photoW: W, photoH: H, deckWidthFt: design.shape.widthFt, house: kept.house })!.house.covers === null);

const rect: DeckShape = { kind: "rect", widthFt: 16, depthFt: 12 };
const ctx = { deckHeightFt: 3, peakFt: 0, mainEdge: null };
const plain: HouseDesign = { ...defaultHouse(), leftFt: 6, rightFt: 6 };
const covered: HouseDesign = { ...plain, covers: [{ x0Ft: 2, x1Ft: 14, outFt: 10, heightFt: 8 }] };
const hs = houseScene(rect, covered, ctx);
const piece = hs.roofs!.find((r) => r[0] === ROOF_PIECE.cover);
check("the scene: the cover is a piece of its own against the wall, out to its front edge", !!piece && piece[1] === 2 && piece[3] === 14 && piece[2] === 0 && piece[4] === 10 && piece[6] === COVER_PITCH, JSON.stringify(piece));
check("…its front edge low enough that it meets the wall under the eave", !!piece && piece[5] + (10 * COVER_PITCH) / 12 < hs.heightFt && piece[5] >= 6.5, `${piece?.[5]} under ${hs.heightFt}`);
check("…and the house's blocks are as before (posts are drawn by the 3D, not walls)", JSON.stringify(hs.blocks) === JSON.stringify(houseScene(rect, plain, ctx).blocks) && !houseScene(rect, plain, ctx).roofs!.some((r) => r[0] === ROOF_PIECE.cover));
// a step at 6 ft, the right part (under the deck) nearer: the left part stands 4 ft back of the house line
const onBack = houseScene(rect, { ...covered, jogs: [{ id: "j1", atFt: 6, dir: "toward", depthFt: 4 }], covers: [{ x0Ft: -5, x1Ft: 5, outFt: 8, heightFt: 8 }] }, ctx).roofs!.find((r) => r[0] === ROOF_PIECE.cover)!;
check("over a part set back, the cover stands against that part's own face", onBack[2] === -4 && onBack[4] === 4, JSON.stringify(onBack));
const back = normalizeHouse({ ...covered, covers: [{ x0Ft: 2, x1Ft: 14, outFt: 99, heightFt: 2 }, { x0Ft: 0, x1Ft: 1, outFt: 10, heightFt: 8 }, "junk"] }, rect);
check("read back: held to its limits, a sliver and junk dropped", back.covers?.length === 1 && back.covers[0].outFt === 24 && back.covers[0].heightFt === 6.5, JSON.stringify(back.covers));
check("a house without one reads back without", normalizeHouse(plain, rect).covers === undefined && normalizeHouse({ ...plain, covers: null }, rect).covers === undefined);
check("the deck slid along the house: the cover stays on the house", shiftHouseThings(covered, 3).covers![0].x0Ft === 5 && shiftHouseThings(plain, 3).covers === undefined);
const d2 = applyDeckPatch(design, { house: { ...design.house, covers: covered.covers } });
const sc = deckScene(buildStructure(d2));
const parsed = parseDeckScene(JSON.parse(JSON.stringify(sc)));
check("through the design, the 3D's scene and its parser", d2.house.covers?.length === 1 && !!sc.house?.roofs?.some((r) => r[0] === ROOF_PIECE.cover) && !!parsed?.house?.roofs?.some((r) => r[0] === ROOF_PIECE.cover), JSON.stringify(sc.house?.roofs));
check("…and a patch that drops it, drops it", applyDeckPatch(d2, { house: { ...d2.house, covers: null } }).house.covers === undefined);

console.log(bad ? `\n${bad} FAILED` : "\nALL PASS");
process.exit(bad ? 1 : 0);
