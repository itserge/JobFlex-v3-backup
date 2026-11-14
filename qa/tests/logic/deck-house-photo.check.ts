// The house built from its photo (2026-10-23, lib/deck/houseRead + lib/deck/houseFromPhoto + lib/deck/house): the
// read checked (more than twelve windows, the back door among the doors, a window on a door dropped, the cladding in a
// model's words, a porch roof or an old deck a model names anyway left out); the house a two-storey back wall with a
// full-height bump-out and fourteen windows builds — only the house: nothing standing in front of it (its width by the
// storeys, a typed width, a door; its steps; the deck centred on the door, else the patio); the 3D's openings; the read
// back of a house (and an old one unchanged); the deck slid and widened with the wall kept still; the review's hand
// edits; the two looks (the wall cut out, read again, put back and merged); the colours off the pixels. Pure.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/deck-house-photo.check.ts
import { HOUSE_READ_PROMPT, HOUSE_READ_PROMPT_PX, fromStructured, mergeLooks, readFromCrop, wallCrop, parseHouseRead, mapHouseRead, moveHouseMark, addReadWindow, addReadDoor, addReadJog, removeReadWindow, removeReadDoor, removeReadJog, flipReadJog, blankHouseRead, readSections, setSectionOut, mainSection, type HouseRead, type HouseReadStructured } from "@/lib/deck/houseRead";
import { applyDepthVerdicts } from "@/lib/deck/houseDepthApply";
import { houseFromPhoto, houseScale, dominantColour, colourZones, paintable } from "@/lib/deck/houseFromPhoto";
import { defaultHouse, houseScene, normalizeHouse, slideDeck } from "@/lib/deck/house";
import { sectionHeights, setSectionHeight } from "@/lib/deck/houseRead";
import { defaultDeckDesign, type DeckShape } from "@/lib/deck/design";
import { patchDesign } from "@/lib/deck/edit";
import { buildStructure } from "@/lib/deck/structure";
import { deckScene, parseDeckScene } from "@/lib/deck/scene";
import { transformRead } from "@/lib/deck/photoFit";

let bad = 0;
const check = (name: string, ok: boolean, info = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !info ? "" : `  — ${info}`}`);
};
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

// A two-storey back wall seen square on (a picture 736 × 840 once its black bands are cut): a 2-ft bump-out in the
// middle that runs the full two storeys, a patio roof on one post over a slab at the right (which a model may name
// anyway — it is left out), fourteen windows, no door.
const W = 736;
const H = 840;
const fx = (x: number) => Math.round((x / W) * 1000) / 1000;
const fy = (y: number) => Math.round(((y - 380) / H) * 1000) / 1000;
const win = (x0: number, x1: number, head: number, sill: number) => ({ x0: fx(x0), x1: fx(x1), head: fy(head), sill: fy(sill) });
const RAW = {
  base: { left: { x: fx(25), y: fy(902) }, right: { x: fx(597), y: fy(902) } },
  eave: { left: { x: fx(25), y: fy(645) }, right: { x: fx(597), y: fy(643) } },
  storeys: 2,
  jogs: [{ x: fx(148), y: fy(902), dir: "toward", depthFt: 2 }, { x: fx(372), y: fy(902), dir: "away", depthFt: 2 }],
  door: null,
  doors: [],
  windows: [
    win(100, 146, 778, 827), win(196, 234, 778, 856), win(240, 278, 778, 856), win(283, 321, 778, 856),
    win(172, 251, 657, 709), win(280, 358, 657, 676),
    win(404, 441, 665, 726), win(445, 482, 665, 726), win(486, 523, 665, 726), win(526, 563, 665, 726),
    win(407, 442, 780, 854), win(448, 483, 780, 854), win(488, 523, 780, 854), win(529, 564, 780, 854),
  ],
  patio: { x0: fx(368), x1: fx(659) },
  oldDeck: null,
  cover: { x0: fx(358), x1: fx(655), top: fy(740), bottom: fy(775), posts: [fx(611), 1.4] },
  roof: { kind: "hip", pitch: 5 },
  material: "Fiber cement lap siding",
  colours: { siding: "#7D7B76", roof: "#3c3d40", trim: "not a colour" },
  bars: { top: 0, bottom: 0 },
  confidence: 0.78,
  note: "An electric meter on the wall at the left.",
};

console.log("— the read —");
const read = parseHouseRead(RAW)!;
check("the read parses", !!read);
check("all fourteen windows are kept (the smart fit kept twelve)", read.windows.length === 14, String(read.windows.length));
check("the cladding is read from the model's own words", read.material === "lap", String(read.material));
check("the colours: a hex kept (lower case), a word dropped", read.colours.siding === "#7d7b76" && read.colours.trim === null);
check("a porch roof or an old deck the model names anyway is not in the read — only the house", !("cover" in read) && !("oldDeck" in read));
check("the roof is a hip, about 5/12", read.roof.kind === "hip" && read.roof.pitch === 5);
check("nothing without a wall", parseHouseRead({ windows: [] }) === null);
// The same wall with a 6½-ft sliding door on the right, 2 ft above the ground, instead of the lower windows there.
const UPPER = RAW.windows.filter((w) => w.sill < fy(800));
const withDoor = parseHouseRead({ ...RAW, door: { x0: 0.6, x1: 0.77, bottom: 0.585, top: 0.435 }, doors: [], windows: [...UPPER, { x0: 0.61, x1: 0.76, head: 0.45, sill: 0.57 }] })!;
check("the back door read only as `door` is among the doors, a sliding door by its width", withDoor.doors.length === 1 && withDoor.doors[0].kind === "slider", JSON.stringify(withDoor.doors));
check("a window drawn over that door is dropped", withDoor.windows.length === UPPER.length, `${withDoor.windows.length} of ${UPPER.length}`);
check("the prompt tells the model to look past what stands in front of the wall", /LOOK PAST/.test(HOUSE_READ_PROMPT) && /porch roof/.test(HOUSE_READ_PROMPT) && /grid/.test(HOUSE_READ_PROMPT));
check("the pixel prompt (2026-10-26) asks what the picture is, the house's silhouette, and the same look-past rules", /PIXELS/.test(HOUSE_READ_PROMPT_PX) && /SUBJECT/.test(HOUSE_READ_PROMPT_PX) && /OUTLINE/.test(HOUSE_READ_PROMPT_PX) && /LOOK PAST/.test(HOUSE_READ_PROMPT_PX) && /porch roof/.test(HOUSE_READ_PROMPT_PX) && !/grid/.test(HOUSE_READ_PROMPT_PX));

console.log("— the read held to a schema, in pixels (2026-10-26) —");
// The same wall as the model answers it now: in pixels of the 736 × 840 picture, with what it is, its silhouette, its
// sections (the steps come from them) and what stands in front of it.
const toPx = (p: { x: number; y: number }) => ({ x: p.x * W, y: p.y * H });
const S: HouseReadStructured = {
  subject: { kind: "house-exterior", confidence: 0.9, reason: "the back wall of a two-storey house, from the yard" },
  image: { w: W, h: H },
  outline: [{ x: 0.02 * W, y: 0.1 * H }, { x: 0.5 * W, y: 0.02 * H }, { x: 0.98 * W, y: 0.1 * H }, { x: 0.98 * W, y: 0.63 * H }, { x: 0.02 * W, y: 0.63 * H }],
  base: { left: toPx(RAW.base.left), right: toPx(RAW.base.right) },
  eave: { left: toPx(RAW.eave.left), right: toPx(RAW.eave.right) },
  storeys: 2,
  sections: [{ x0: fx(25) * W, x1: fx(148) * W, outFt: 0, storeys: 2, roof: "main", wing: false, why: "corner boards at both ends" }, { x0: fx(148) * W, x1: fx(372) * W, outFt: 2, storeys: 2, roof: "main", wing: false, why: "its own eave in front of the main eave" }, { x0: fx(372) * W, x1: fx(597) * W, outFt: 0, storeys: 2, roof: "main", wing: false, why: "the main wall" }],
  doors: [],
  windows: RAW.windows.map((w) => ({ x0: w.x0 * W, x1: w.x1 * W, sill: w.sill * H, head: w.head * H })),
  patio: { x0: RAW.patio.x0 * W, x1: RAW.patio.x1 * W },
  roof: { kind: "hip", pitch: 5 },
  material: "lap",
  colours: { siding: "#7D7B76", roof: "#3c3d40", trim: null },
  lookPast: [{ kind: "porch-roof", x0: 358, y0: 740 - 380, x1: 655, y1: 775 - 380, floorY: null }],
  bars: { top: 0, bottom: 0 },
  confidence: 0.8,
  note: null,
};
const pxRead = parseHouseRead(fromStructured(S, W, H))!;
check("a pixel answer parses to the same fractions as the old read", !!pxRead && near(pxRead.base.left.x, read.base.left.x, 0.002) && near(pxRead.windows[3].sill, read.windows[3].sill, 0.002) && pxRead.windows.length === 14, pxRead ? `${pxRead.base.left.x} vs ${read.base.left.x}` : "no read");
check("the sections become the steps: out 2 ft in the middle", readSections(pxRead).map((x) => x.outFt).join(",") === "0,2,0", JSON.stringify(readSections(pxRead)));
check("the house's silhouette comes through, in fractions", pxRead.outline?.length === 5 && near(pxRead.outline[1].x, 0.5, 0.002), JSON.stringify(pxRead.outline));
check("a model that answered in fractions anyway is read as such", near(parseHouseRead(fromStructured({ ...S, base: { left: RAW.base.left, right: RAW.base.right }, windows: RAW.windows }, W, H))!.base.right.x, read.base.right.x, 0.002));
check("the silhouette rides through a crop and a merge", readFromCrop(pxRead, { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }).outline![1].x === 0.5 && mergeLooks(pxRead, { ...pxRead, outline: undefined }).outline?.length === 5);
const levelled = setSectionOut(pxRead, 1, 0);
const byDepth = applyDepthVerdicts(levelled, [{ x0: fx(25), x1: fx(148), state: "level", shift: 0, sure: 1 }, { x0: fx(148), x1: fx(372), state: "out", shift: 0.05, sure: 1 }, { x0: fx(372), x1: fx(597), state: "level", shift: 0, sure: 1 }], { modelSections: readSections(pxRead) });
check("the depth map sets a level part out, at the model's 2 ft", byDepth.changed === 1 && readSections(byDepth.read).map((x) => x.outFt).join(",") === "0,2,0", JSON.stringify(readSections(byDepth.read)));
const turned = applyDepthVerdicts(pxRead, [{ x0: fx(148), x1: fx(372), state: "back", shift: -0.05, sure: 1 }], {});
check("…and turns a part read the wrong way round", turned.flipped === 1 && readSections(turned.read)[1].outFt === -2, JSON.stringify(readSections(turned.read)));
check("…but not against the photo's own eave shadows when it is unsure", applyDepthVerdicts(pxRead, [{ x0: fx(148), x1: fx(372), state: "back", shift: -0.02, sure: 0.4 }], { stepsFromPhoto: true }).flipped === 0);
check("a verdict covering less than half a part says nothing about it", applyDepthVerdicts(levelled, [{ x0: fx(148), x1: fx(200), state: "out", shift: 0.05, sure: 1 }], {}).changed === 0);

console.log("— the wall as its parts —");
const secs = readSections(read);
check("three parts: the narrow left, the middle out 2 ft, the right — the widest, the main wall", secs.length === 3 && secs.map((x) => x.outFt).join(",") === "0,2,0" && near(secs[1].x0, fx(148), 0.002) && near(secs[2].x0, fx(372), 0.002), JSON.stringify(secs));
const flat = setSectionOut(read, 1, 0);
check("the middle set to the main wall: a flat wall — its corners kept as dividers, nothing stepped", flat.jogs.length === 2 && flat.jogs.every((j) => j.depthFt === 0) && readSections(flat).every((x) => x.outFt === 0));
check("…and built as a straight wall", houseFromPhoto({ read: flat, photoW: W, photoH: H, deckWidthFt: defaultDeckDesign({ state: "WA" }).shape.widthFt, house: defaultDeckDesign({ state: "WA" }).house })!.house.jogs.length === 0);
check("…set out again, the middle comes back out between the same corners", readSections(setSectionOut(flat, 1, 2)).map((x) => x.outFt).join(",") === "0,2,0");
check("the main wall is the widest part (the right)", mainSection(secs) === 2);
const back3 = setSectionOut(read, 0, -3);
check("the left set back 3 ft: out 5 to the middle, back 2 to the main wall — the labels stay put", back3.jogs.length === 2 && back3.jogs[0].dir === "toward" && back3.jogs[0].depthFt === 5 && back3.jogs[1].dir === "away" && back3.jogs[1].depthFt === 2 && readSections(back3).map((x) => x.outFt).join(",") === "-3,2,0", JSON.stringify(back3.jogs));
// The live misread (2026-10-23): the porch roof read as one step "out 4 ft" at the right — two taps fix it.
const misread = { ...read, jogs: [{ x: fx(372), y: read.base.left.y, dir: "toward" as const, depthFt: 4 }] };
check("a porch roof read as a bump-out shows as one part out 4 ft", readSections(misread).map((x) => x.outFt).join(",") === "0,4");
const level = setSectionOut(misread, 1, 0);
check("…set to the main wall in one tap (no step left)", readSections(level).every((x) => x.outFt === 0));
// Then a step added (a divider in the wider part's middle, nothing changed yet), dragged onto the left corner, and the
// middle part set out: the wall the photo shows.
const divided = addReadJog(level);
check("a step added divides the wider part and changes nothing yet", divided.jogs.length === 2 && readSections(divided).every((x) => x.outFt === 0));
const moved = moveHouseMark(divided, "jog-0", { x: fx(148), y: read.base.left.y });
const shaped = setSectionOut(moved, 1, 2);
check("dragged to the corner and the middle set out: left and right on the main wall, the middle out 2 ft", readSections(shaped).map((x) => x.outFt).join(",") === "0,2,0", JSON.stringify(readSections(shaped)));
check("the prompt tells a room under a low roof (a section of one storey) from an open porch cover and a roof band (never a section)", /lean-to/.test(HOUSE_READ_PROMPT) && /GROUND storey/.test(HOUSE_READ_PROMPT) && /GROUND storey/.test(HOUSE_READ_PROMPT_PX) && /A ROOM under it/.test(HOUSE_READ_PROMPT_PX) && /An OPEN porch or patio cover/.test(HOUSE_READ_PROMPT_PX) && /roof band or skirt/.test(HOUSE_READ_PROMPT_PX) && /"wing" is true/.test(HOUSE_READ_PROMPT_PX));
const flatTwo = addReadJog(addReadJog({ ...read, jogs: [] }));
check("a step added to a flat wall goes in its middle; a second splits the wider half, never on the first", flatTwo.jogs.length === 2 && Math.abs(flatTwo.jogs[0].x - flatTwo.jogs[1].x) > 0.1, JSON.stringify(flatTwo.jogs.map((j) => j.x)));
check("half-foot steps, held to 8 ft either way", setSectionOut(read, 1, 12).jogs[0].depthFt === 8 && setSectionOut(read, 1, 2.3).jogs[0].depthFt === 2.5);

console.log("— the house it builds —");
const design = defaultDeckDesign({ state: "WA" });
const Wd = design.shape.widthFt;
const b = houseFromPhoto({ read, photoW: W, photoH: H, deckWidthFt: Wd, house: design.house, measured: { siding: "#7a756c", roof: null } })!;
check("it builds", !!b);
check("the wall is about 40 ft, sized by the storeys (said to be rough)", near(b.wallFt, 40, 1) && b.scale.by === "eave" && b.facts.find((f) => f.id === "wall")!.guess, `${b.wallFt} by ${b.scale.by}`);
check("two storeys, a hip roof, lap siding", b.house.storeys === 2 && b.house.roof === "hip" && b.house.material === "lap");
const sat = (hx: string) => { const v = [1, 3, 5].map((k) => parseInt(hx.slice(k, k + 2), 16)); return Math.max(...v) - Math.min(...v); };
check("the wall's colour: lightness off the pixels, the daylight hue of the read (a dusk-brown grey comes out grey); the roof's guess stands in alone", sat(b.house.siding) <= sat("#7d7b76") + 2 && b.house.roofColour === "#3c3d40", `${b.house.siding} ${b.house.roofColour}`);
const dusk = houseFromPhoto({ read, photoW: W, photoH: H, deckWidthFt: Wd, house: design.house, measured: { siding: "#8a6a4a", roof: null } })!;
check("a sunset-orange measure of a grey wall is brought back to grey", sat(dusk.house.siding) < 12, dusk.house.siding);
const only = houseFromPhoto({ read: { ...read, colours: { siding: null, roof: null, trim: null } }, photoW: W, photoH: H, deckWidthFt: Wd, house: design.house, measured: { siding: "#7a756c", roof: null } })!;
check("without a guess, the measure stands as it is; without either, the preset stays", only.house.siding === "#7a756c" && only.house.roofColour === design.house.roofColour);
check("the house spans the wall: its reach past the deck's ends + the deck = the wall", near(b.house.leftFt + Wd + b.house.rightFt, b.wallFt, 0.6), `${b.house.leftFt} + ${Wd} + ${b.house.rightFt}`);
check("the deck is centred on the patio (no door), held inside the wall", b.centredOn === "patio" && b.house.leftFt >= 0 && b.house.rightFt >= 0);
check("two steps: out 2 ft then back 2 ft", b.house.jogs.length === 2 && b.house.jogs[0].dir === "toward" && b.house.jogs[1].dir === "away" && b.house.jogs.every((j) => j.depthFt === 2));
check("the steps stand where the picture has them (≈ 8.6 and 24.1 ft from the wall's left corner)", near(b.house.jogs[0].atFt + b.deckAtFt, 8.6, 0.6) && near(b.house.jogs[1].atFt + b.deckAtFt, 24.1, 0.6), JSON.stringify(b.house.jogs));
check("the wall's steps run the house's full height (its shape, under the one roof)", b.house.bumpOuts === "full");
// 2026-10-23 evening (owner: "it should make the shape of the back wall"): even with no upper window seen in the
// bump-out, it stands the house's full height — never a one-storey block under a roof of its own (a porch roof's look).
const lowerOnly = { ...read, windows: read.windows.filter((w) => !(w.head < fy(720) && w.x0 > fx(150) && w.x1 < fx(370))) };
check("a bump-out with no upper window seen is full height too", houseFromPhoto({ read: lowerOnly, photoW: W, photoH: H, deckWidthFt: Wd, house: design.house })!.house.bumpOuts === "full");
const ws = b.house.openings!.filter((o) => o.kind === "window");
check("fourteen windows on the house, no door", ws.length === 14 && b.house.openings!.length === 14);
const upper = ws.filter((o) => o.sillFt > 10);
check("six windows on the second storey; the four over the patio about 12 ft up", upper.length === 6 && upper.filter((o) => near(o.sillFt, 12.3, 0.5)).length === 4, upper.map((o) => o.sillFt).join(","));
check("a lower window is about 2.6 × 5.4 ft", ws.some((o) => near(o.widthFt, 2.6, 0.3) && near(o.heightFt, 5.4, 0.4)));
check("nothing standing in front of the wall is built into the house, nor said", !("existing" in b.house) && !b.facts.some((f) => /patio roof|old deck/i.test(f.label + f.value)));
check("no door — the deck's height stays as it is", b.heightIn === null && b.checks.some((c) => /No back door/.test(c)));

const typed = houseFromPhoto({ read, photoW: W, photoH: H, deckWidthFt: Wd, house: design.house, wallWidthFt: 44 })!;
check("a typed wall width sets the scale", typed.scale.by === "width" && near(typed.wallFt, 44, 0.01) && !typed.facts.find((f) => f.id === "wall")!.guess);
check("houseScale says the same", houseScale(read, W, H, 44).by === "width");
const door = houseFromPhoto({ read: withDoor, photoW: W, photoH: H, deckWidthFt: Wd, house: design.house })!;
check("with a door: sized by it, the deck centred on it", door.scale.by === "door" && door.centredOn === "door");
const dOpen = door.house.openings!.find((o) => o.kind !== "window")!;
check("the door is a sliding door on the deck — at its middle, or as near as the wall's end lets it", dOpen.kind === "slider" && dOpen.xFt > 0 && dOpen.xFt < Wd && (near(dOpen.xFt, Wd / 2, 0.6) || near(door.deckAtFt + Wd, door.wallFt, 0.6)), `${JSON.stringify(dOpen)} deck at ${door.deckAtFt} of ${door.wallFt}`);
check("the deck's floor an inch under the door's threshold", door.heightIn !== null && near(door.heightIn, Math.round(dOpen.sillFt * 12) - 1, 1.5), `${door.heightIn} vs ${dOpen.sillFt}`);
check("nothing to size by → no house", houseFromPhoto({ read: { ...read, eave: null, doors: [], door: null }, photoW: W, photoH: H, deckWidthFt: Wd, house: design.house }) === null);

console.log("— the 3D —");
const built = patchDesign(design, { house: b.house });
check("the deck is still a plain rectangle on the house line", built.shape.kind === "rect");
const hs = houseScene(built.shape, built.house, { deckHeightFt: 3, peakFt: 0, mainEdge: null });
check("fourteen windows drawn where they are, no doors", hs.windows.length === 14 && (hs.doors?.length ?? 0) === 0 && hs.door === null);
check("the body behind the wall and the bump-out in front of it, all as tall as the house", hs.blocks.length === 4 && hs.blocks.every((x) => x[4] === hs.blocks[0][4]) && hs.blocks.filter((x) => x[1] === 0).length === 1);
check("one hip over the whole house at the photo's 5/12, the bump-out's own hip against it", hs.roofs?.length === 2 && hs.roofs[0][0] === 0 && hs.roofs[0][6] === 5 && near(hs.roofs[0][3] - hs.roofs[0][1], b.wallFt, 0.6) && hs.roofs[1][0] === 5, JSON.stringify(hs.roofs));
const low = houseScene(built.shape, { ...built.house, bumpOuts: "low" }, { deckHeightFt: 3, peakFt: 0, mainEdge: null });
check("a one-storey bump-out drops the upper windows that would stand over its roof", low.windows.length === 12, String(low.windows.length));
const dScene = houseScene(design.shape, patchDesign(design, { house: door.house }).house, { deckHeightFt: 3, peakFt: 0, mainEdge: null });
check("a door from the photo is drawn on its own threshold and is the deck's door", dScene.doors?.length === 1 && dScene.door !== null && dScene.doors[0][5] === 1);
const scene = deckScene(buildStructure(built));
check("the deck's scene carries the house's windows and its roofs", (scene.house?.windows?.length ?? 0) === 14 && (scene.house?.roofs?.length ?? 0) === 2);
const back = parseDeckScene(JSON.parse(JSON.stringify(scene)));
check("…and they come back from a saved scene (the client's page)", back?.house?.roofs?.length === 2 && back.house.windows?.length === 14);
const brick = deckScene(buildStructure(patchDesign(design, { house: { ...door.house, material: "brick" } })));
check("brick and its doors come back from a saved scene too", parseDeckScene(JSON.parse(JSON.stringify(brick)))?.house?.material === "brick" && parseDeckScene(JSON.parse(JSON.stringify(brick)))?.house?.doors?.length === 1);

console.log("— kept and read back —");
const n = normalizeHouse(JSON.parse(JSON.stringify(built.house)), built.shape);
check("the photo house reads back as it was", JSON.stringify(n) === JSON.stringify(built.house));
const plain = normalizeHouse(defaultHouse(), design.shape);
check("a house without a photo reads back with none of the new fields", Object.keys(plain).sort().join(",") === "jogs,leftFt,rightFt,roof,roofColour,siding,storeys");
const junk = normalizeHouse({ ...defaultHouse(), siding: "#12345", roofColour: "#ABCDEF", material: "glass", openings: [{ xFt: "x" }, { kind: "door", xFt: 10, widthFt: 99, heightFt: 7, sillFt: 2 }], existing: [{ kind: "pool", x0Ft: 0, x1Ft: 9 }, { kind: "cover", x0Ft: 2, x1Ft: 3 }] }, design.shape);
check("junk is dropped or held: a bad hex, a made-up cladding, an opening without a place, a tiny cover", junk.siding === "cream" && junk.roofColour === "#abcdef" && junk.material === undefined && junk.openings!.length === 1 && junk.openings![0].widthFt === 20 && !("existing" in junk), JSON.stringify(junk));

console.log("— the deck moved, the wall still —");
// The deck stands at the wall's right end, so it slides left: the house still, everything on it 2 ft right in the deck's feet.
const slid = slideDeck({ ...built.house, photo: { url: "data:image/jpeg;base64,AAAA", w: W, h: H, read: null, wallFt: b.wallFt, by: "eave", deckAtFt: b.deckAtFt, at: "" } }, -2);
check("sliding the deck 2 ft left moves the windows and the photo's mark the other way", near(slid.openings![0].xFt, built.house.openings![0].xFt + 2, 0.01) && slid.photo!.deckAtFt === b.deckAtFt - 2);
const withPhoto = patchDesign(built, { house: { photo: { url: "data:image/jpeg;base64,AAAA", w: W, h: H, read, wallFt: b.wallFt, by: b.scale.by, deckAtFt: b.deckAtFt, at: "2026-10-23" } } });
const wider = patchDesign(withPhoto, { shape: { ...withPhoto.shape, widthFt: withPhoto.shape.widthFt - 4 } as DeckShape });
check("a narrower deck on a photo house leaves the wall as long as it was", near(wider.house.leftFt + wider.shape.widthFt + wider.house.rightFt, withPhoto.house.leftFt + withPhoto.shape.widthFt + withPhoto.house.rightFt, 0.01), `${wider.house.rightFt}`);
const plainWider = patchDesign(design, { shape: { ...design.shape, widthFt: design.shape.widthFt + 4 } as DeckShape });
check("a house drawn by rule still grows with the deck (as before)", plainWider.house.rightFt === design.house.rightFt);

console.log("— the review's hand edits —");
const r0: HouseRead = read;
const mv = moveHouseMark(r0, "base-left", { x: 0.05, y: 0.63 });
check("the base's left corner moves", mv.base.left.x === 0.05 && mv.base.left.y === 0.63 && mv.windows.length === 14);
const ev = moveHouseMark(r0, "eave-right", { x: 0.8, y: 0.9 });
check("the eave cannot be dragged under the base", !!ev.eave && ev.eave.right.y < ev.base.right.y);
const w2 = moveHouseMark(r0, "win-0", { x: 0.5, y: 0.5 });
check("a window moves by its middle, its size kept", near((w2.windows[0].x0 + w2.windows[0].x1) / 2, 0.5, 0.002) && near(w2.windows[0].x1 - w2.windows[0].x0, r0.windows[0].x1 - r0.windows[0].x0, 0.002));
const ad = addReadDoor(r0, W, H);
check("a door put on by hand stands on the base, is the back door, about 80 in. at the picture's scale", ad.doors.length === 1 && !!ad.door && near(ad.doors[0].bottom, r0.base.left.y - 0.008, 0.02) && near(((ad.doors[0].bottom - ad.doors[0].top) * H) / houseScale(r0, W, H).pxPerFt, 80 / 12, 0.2));
const dm = moveHouseMark(ad, "door-0", { x: 0.3, y: 0.6 });
check("moving it moves the back door too", !!dm.door && near((dm.door.x0 + dm.door.x1) / 2, 0.3, 0.002));
check("removing it clears the back door", removeReadDoor(dm, 0).door === null && removeReadDoor(dm, 0).doors.length === 0);
check("a window added and removed", addReadWindow(r0, W, H).windows.length === 15 && removeReadWindow(r0, 0).windows.length === 13);
check("a step added, flipped, removed", addReadJog(r0).jogs.length === 3 && flipReadJog(r0, 0).jogs[0].dir === "away" && removeReadJog(r0, 1).jogs.length === 1);
check("a blank read builds a one-storey house by its storey", !!houseFromPhoto({ read: blankHouseRead(), photoW: W, photoH: H, deckWidthFt: Wd, house: design.house }));
const id = mapHouseRead(withDoor, (x) => transformRead(x, [1, 0, 0, 0, 1, 0, 0, 0, 1], W, H, W, H), (p) => p);
check("carried through a plain warp, the read is the same", id.doors.length === 1 && near(id.doors[0].bottom, withDoor.doors[0].bottom, 0.002) && id.windows.length === withDoor.windows.length);

console.log("— the two looks —");
const crop = wallCrop(read)!;
check("the wall is cut out with a margin: its corners, its eave and every window inside the cut, the roof's edge kept", !!crop && crop.x < read.base.left.x && crop.x + crop.w > read.base.right.x && crop.y < read.eave!.left.y - 0.03 && crop.y + crop.h > read.base.left.y, JSON.stringify(crop));
check("a wall that already fills the picture gets no second look", wallCrop({ ...read, base: { left: { x: 0.01, y: 0.97 }, right: { x: 0.99, y: 0.97 } }, eave: { left: { x: 0.01, y: 0.05 }, right: { x: 0.99, y: 0.05 } } }) === null);
// The close look said in the cut's own fractions, then put back: the same wall within a hair.
const inCut = (x: number) => (x - crop.x) / crop.w;
const inCutY = (y: number) => (y - crop.y) / crop.h;
const closeRaw = { ...RAW, base: { left: { x: inCut(read.base.left.x), y: inCutY(read.base.left.y) }, right: { x: inCut(read.base.right.x), y: inCutY(read.base.right.y) } }, eave: { left: { x: inCut(read.eave!.left.x), y: inCutY(read.eave!.left.y) }, right: { x: inCut(read.eave!.right.x), y: inCutY(read.eave!.right.y) } }, jogs: read.jogs.map((j) => ({ ...j, x: inCut(j.x), y: inCutY(j.y) })), windows: read.windows.map((w) => ({ x0: inCut(w.x0) + 0.004, x1: inCut(w.x1) + 0.004, head: inCutY(w.head), sill: inCutY(w.sill) })), patio: null, roof: { kind: null, pitch: null }, material: null };
const close = readFromCrop(parseHouseRead(closeRaw)!, crop);
check("the close look put back lands on the wall", near(close.base.left.x, read.base.left.x, 0.003) && near(close.base.right.y, read.base.right.y, 0.003) && close.windows.length === 14 && near(close.windows[3].x0, read.windows[3].x0 + 0.004 * crop.w, 0.003));
const merged = mergeLooks(read, close);
check("merged: the windows from the close look, the roof, the cladding and the patio from the whole picture", near(merged.windows[3].x0, close.windows[3].x0, 1e-9) && merged.roof.kind === "hip" && merged.material === "lap" && !!merged.patio);
check("a close look that lost the wall is not trusted", mergeLooks(read, { ...close, windows: close.windows.slice(0, 3) }) === read && mergeLooks(read, null) === read);
check("a close look with no eave line keeps the wide look's eave (the pixel pass needs one)", mergeLooks(read, { ...close, eave: null }).eave !== null && JSON.stringify(mergeLooks(read, { ...close, eave: null }).eave) === JSON.stringify(read.eave));

console.log("— the colours off the pixels —");
const px: number[] = [];
for (let i = 0; i < 400; i++) px.push(122, 117, 108);
for (let i = 0; i < 120; i++) px.push(240, 238, 230);
for (let i = 0; i < 90; i++) px.push(20, 22, 25);
for (let i = 0; i < 80; i++) px.push(200, 150, 60);
const dom = dominantColour(px)!;
const rgb = [1, 3, 5].map((k) => parseInt(dom.slice(k, k + 2), 16));
check("the wall's colour wins over the trim, the glass and a lamp's glow", near(rgb[0], 122, 6) && near(rgb[1], 117, 6) && near(rgb[2], 108, 6), dom);
check("too few samples → nothing", dominantColour([10, 10, 10, 200, 200, 200]) === null);
const sunset = paintable(230, 140, 60, 0.35);
const [sr, , sb] = [1, 3, 5].map((k) => parseInt(sunset.slice(k, k + 2), 16));
check("a sunset's orange is held to a paint's colour", sr - sb < 140, sunset);
const z = colourZones(read, W, H);
const w0 = read.windows[0];
check("the wall is sampled between its base and its eave, never on a window", z.wall(0.3, 0.585) && !z.wall((w0.x0 + w0.x1) / 2, (w0.head + w0.sill) / 2) && !z.wall(0.4, 0.2) && !!z.roof && z.roof(0.4, read.eave!.left.y - 0.03));

// ── each part's own height and roof (owner, 2026-11-13: "when you convert the picture to 3D, use the same roof") ──
{
  // the same wall, its middle part read as a ROOM one storey tall under a lean-to, standing 6 ft in front of the wall above
  const S1: HouseReadStructured = { ...S, sections: S.sections.map((x, i) => (i === 1 ? { ...x, outFt: 6, storeys: 1, roof: "lean-to" as const, wing: false } : x)) };
  const r1 = parseHouseRead(fromStructured(S1, W, H))!;
  check("a one-storey section under a lean-to is kept with the read, as a stretch of the picture", r1.heights?.length === 1 && r1.heights[0].storeys === 1 && r1.heights[0].roof === "shed" && !r1.heights[0].wing && near(r1.heights[0].x0, fx(148), 0.01), JSON.stringify(r1.heights));
  check("each part knows its own: only the middle one", sectionHeights(r1).map((h) => (h ? `${h.storeys}${h.roof}` : "-")).join(",") === "-,1shed,-");
  check("a saved read keeps it", parseHouseRead(JSON.parse(JSON.stringify(r1)))?.heights?.[0].roof === "shed");
  const b1 = houseFromPhoto({ read: r1, photoW: W, photoH: H, deckWidthFt: Wd, house: design.house })!;
  check("the house built from it: the middle part one storey under a lean-to, the rest by the rule", JSON.stringify(b1.house.parts) === JSON.stringify([null, { storeys: 1, roof: "shed" }, null]) && b1.house.jogs[0].depthFt === 6, JSON.stringify(b1.house.parts));
  check("…and said in words", /the middle part one storey under a lean-to roof/.test(b1.facts.find((f) => f.id === "storeys")!.value) && !/as tall as the house/.test(b1.facts.find((f) => f.id === "steps")!.value), b1.facts.find((f) => f.id === "storeys")!.value);
  const built1 = patchDesign(design, { house: b1.house });
  const s1 = houseScene(built1.shape, built1.house, { deckHeightFt: 3, peakFt: 0, mainEdge: null });
  const tall = Math.max(...s1.blocks.map((x) => x[4])), front = s1.blocks.find((x) => x[3] > x[1] && x[1] === s1.blocks[0][3]);
  check("in 3D the room is a low block in front of the two-storey house", !!front && front[4] < tall - 6 && s1.blocks.filter((x) => x[4] === tall).length === 3, JSON.stringify(s1.blocks));
  check("…under its own lean-to, the main hip over the whole house behind it", s1.roofs?.length === 2 && s1.roofs[0][0] === 0 && s1.roofs[1][0] === 7 && s1.roofs[1][5] === front![4], JSON.stringify(s1.roofs));
  const upper = s1.windows.filter((w) => w[4] > front![4]);
  check("the upper storey's windows over the room stay, on the house's wall behind it", s1.windows.length === 14 && upper.some((w) => w[1] === front![1] && w[0] > front![0] && w[0] < front![2]), `${s1.windows.length} windows`);
  check("a house read back keeps its parts while they match its steps, and drops them when a step is gone", normalizeHouse(JSON.parse(JSON.stringify(built1.house)), built1.shape).parts?.[1]?.roof === "shed" && normalizeHouse({ ...JSON.parse(JSON.stringify(built1.house)), jogs: built1.house.jogs.slice(0, 1) }, built1.shape).parts === undefined);

  // the right part a one-storey WING beside the two-storey block, under its own hip
  const S2: HouseReadStructured = { ...S, sections: S.sections.map((x, i) => (i === 2 ? { ...x, storeys: 1, roof: "hip" as const, wing: true } : x)) };
  const r2 = parseHouseRead(fromStructured(S2, W, H))!;
  const b2 = houseFromPhoto({ read: r2, photoW: W, photoH: H, deckWidthFt: Wd, house: design.house })!;
  const built2 = patchDesign(design, { house: b2.house });
  const s2 = houseScene(built2.shape, built2.house, { deckHeightFt: 3, peakFt: 0, mainEdge: null });
  const mainRoof = s2.roofs!.find((x) => x[5] === Math.max(...s2.roofs!.map((q) => q[5])) && x[0] === 0)!, wingRoof = s2.roofs!.find((x) => x[5] < mainRoof[5] && x[0] === 0);
  check("a one-storey wing is built as a wing", b2.house.parts?.[2]?.storeys === 1 && b2.house.parts[2]?.wing === true && /the right part one storey under its own hip roof \(a wing\)/.test(b2.facts.find((f) => f.id === "storeys")!.value), JSON.stringify(b2.house.parts));
  check("in 3D the main roof ends where the wing begins, and the wing has its own lower hip", !!wingRoof && near(mainRoof[3], wingRoof[1], 0.01) && wingRoof[3] > wingRoof[1] + 5 && s2.blocks.some((x) => x[0] === wingRoof[1] && x[4] === wingRoof[5]), JSON.stringify(s2.roofs));
  check("no upper window is drawn over the wing", s2.windows.every((w) => !(w[0] > wingRoof![1] && w[4] > wingRoof![5])));

  // by hand in the review: tap a part, One storey; then back
  const tapped = setSectionHeight(pxRead, 1, { storeys: 1, roof: "gable", wing: false });
  check("a part set to one storey under a gable by hand", sectionHeights(tapped)[1]?.roof === "gable" && sectionHeights(tapped)[0] === null && sectionHeights(tapped)[2] === null);
  check("…follows its part when the step beside it is dragged", sectionHeights(moveHouseMark(tapped, "jog-0", { x: fx(170), y: tapped.base.left.y }))[1]?.roof === "gable");
  check("…and put back under the main roof leaves nothing behind", setSectionHeight(tapped, 1, null).heights === undefined);
  // a one-storey house has no lower part: only a roof of its own is kept
  const one = houseFromPhoto({ read: { ...r1, storeys: 1 }, photoW: W, photoH: H, deckWidthFt: Wd, house: design.house })!;
  check("on a one-storey house the part keeps its own roof and no height", JSON.stringify(one.house.parts) === JSON.stringify([null, { roof: "shed" }, null]));
  // the old rule still stands where nothing was seen
  check("with nothing seen, a house built from a photo has no parts of its own", b.house.parts === null || b.house.parts === undefined);
}

console.log(bad ? `\n${bad} FAILED` : "\nALL PASS");
process.exit(bad ? 1 : 0);
