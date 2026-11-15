// The drawn house (2026-10-11, lib/deck/house): its design read back, the back wall as parts against the house line,
// the deck's shape following a bump-out at its end (and saying why when it cannot), a notch picked in the Shape step
// putting its step in the wall, the blocks and openings the 3D draws, the knobs, and the scene through the client's
// parser. Pure.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/deck-house.check.ts
import { applyDeckPatch } from "../../../src/lib/deck/checks";
import { defaultDeckDesign, normalizeDeckDesign, type DeckShape } from "../../../src/lib/deck/design";
import { HOUSE_BODY_FT, STOREY_FT, addStepAt, deckShapeForHouse, defaultHouse, houseForShape, houseHandles, houseScene, moveJogTo, moveWallPart, normalizeHouse, quickWall, quickWallOf, referenceX, resizeDeckLeft, slideDeck, stepWords, wallParts, wallWords, type HouseDesign } from "../../../src/lib/deck/house";
import { deckScene, parseDeckScene } from "../../../src/lib/deck/scene";
import { buildStructure } from "../../../src/lib/deck/structure";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
const rect: DeckShape = { kind: "rect", widthFt: 16, depthFt: 12 };
const plain = defaultHouse();

// ── the design read back
const n = normalizeHouse({ storeys: 2, roof: "gable", leftFt: 99, rightFt: -3, jogs: [{ atFt: 12, dir: "toward", depthFt: 40 }, { atFt: 12.2, dir: "away", depthFt: 2 }, { atFt: 30, dir: "toward", depthFt: 2 }] }, rect);
// (2026-11-14: a negative reach is the deck running past the house's corner — kept from 2 ft; a hair under is the deck ending AT the corner. See deck-past-house.check.ts.)
check("storeys and roof read; the wall's reach and a step's depth held to their limits", n.storeys === 2 && n.roof === "gable" && n.leftFt === 60 && n.rightFt === -3 && n.jogs[0].depthFt === 12, JSON.stringify(n));
check("…a corner a foot inside the deck's end is the deck ending at the corner", normalizeHouse({ leftFt: 4, rightFt: -1 }, rect).rightFt === 0);
check("a step on top of another, or past the wall's end, is dropped; ids given", n.jogs.length === 1 && n.jogs[0].id === "j1", JSON.stringify(n.jogs));
check("nothing given: one storey, a hip, 4 ft past each end, a straight wall", JSON.stringify(normalizeHouse(undefined, rect)) === JSON.stringify(plain));

// ── the wall as parts, against the house line under the deck's main back edge
const bump: HouseDesign = { ...plain, jogs: [{ id: "j1", atFt: 12, dir: "toward", depthFt: 3 }] };
const parts = wallParts(bump, rect);
check("a step at 12 ft that comes out 3 ft: the wall from −4 to 12 on the line, 12 to 20 three feet out", parts.length === 2 && parts[0].x0 === -4 && parts[0].x1 === 12 && parts[0].depthFt === 0 && parts[1].x1 === 20 && parts[1].depthFt === 3, JSON.stringify(parts));
const stepBack: HouseDesign = { ...plain, jogs: [{ id: "j1", atFt: -1, dir: "away", depthFt: 2 }] };
check("a step past the deck's left end that steps back: the part under the deck stays the house line, the left part comes 2 ft out", wallParts(stepBack, rect)[0].depthFt === 2 && wallParts(stepBack, rect)[1].depthFt === 0, JSON.stringify(wallParts(stepBack, rect)));
check("the reference is the main back edge's middle: 8 ft on a rectangle, 6 ft with a 4 ft back-right notch, 10 ft with a back-left one", referenceX(rect) === 8 && referenceX({ kind: "L", widthFt: 16, depthFt: 12, notch: { corner: "back-right", widthFt: 4, depthFt: 3 } }) === 6 && referenceX({ kind: "L", widthFt: 16, depthFt: 12, notch: { corner: "back-left", widthFt: 4, depthFt: 3 } }) === 10);

// ── the deck fits itself to the wall
const fitR = deckShapeForHouse(rect, bump);
check("a bump-out taking the deck's right end: a back-right notch 4 ft wide, 3 ft deep, no note", fitR.shape.kind === "L" && fitR.shape.notch.corner === "back-right" && fitR.shape.notch.widthFt === 4 && fitR.shape.notch.depthFt === 3 && fitR.note === null, JSON.stringify(fitR));
const bumpLeft: HouseDesign = { ...plain, jogs: [{ id: "j1", atFt: 5, dir: "away", depthFt: 2 }] };
const fitL = deckShapeForHouse(rect, bumpLeft);
check("the wall stepping back at 5 ft (the left part out): a back-left notch 5 ft wide, 2 ft deep", fitL.shape.kind === "L" && fitL.shape.notch.corner === "back-left" && fitL.shape.notch.widthFt === 5 && fitL.shape.notch.depthFt === 2, JSON.stringify(fitL));
const middle: HouseDesign = { ...plain, jogs: [{ id: "j1", atFt: 5, dir: "toward", depthFt: 3 }, { id: "j2", atFt: 9, dir: "away", depthFt: 3 }] };
const fitM = deckShapeForHouse(rect, middle);
// 2026-10-19 (owner: "deck should follow house wall when moving wall in set out set"): every step under the deck the
// deck can follow, it follows — it steps around a bump-out and reaches into a set-back, its back on the wall.
check("a bump-out inside the deck: the deck steps around it — three parts, the middle 3 ft out, no note", fitM.note === null && fitM.shape.kind === "wall" && fitM.shape.back.length === 3 && fitM.shape.back[1].yFt === 3 && fitM.shape.back[1].x0Ft === 5 && fitM.shape.back[1].x1Ft === 9, JSON.stringify(fitM));
const recess: HouseDesign = { ...plain, jogs: [{ id: "j1", atFt: 4, dir: "away", depthFt: 2 }, { id: "j2", atFt: 12, dir: "toward", depthFt: 2 }] };
const fitRecess = deckShapeForHouse(rect, recess);
check("the deck sitting in a recess between two bump-outs: it steps around both ends, 2 ft out", fitRecess.note === null && fitRecess.shape.kind === "wall" && fitRecess.shape.back.map((b) => b.yFt).join(",") === "2,0,2", JSON.stringify(fitRecess));
const away: HouseDesign = { ...plain, jogs: [{ id: "j1", atFt: 12, dir: "away", depthFt: 2 }] };
const fitA = deckShapeForHouse(rect, away);
check("the wall stepping back under the deck's right part: the deck reaches 2 ft back to it", fitA.note === null && fitA.shape.kind === "wall" && fitA.shape.back.length === 2 && fitA.shape.back[1].yFt === -2 && fitA.shape.back[1].x0Ft === 12, JSON.stringify(fitA));
const bowedRect: DeckShape = { kind: "rect", widthFt: 16, depthFt: 12, front: { kind: "curve", bulgeFt: 2, clipFt: 2 } };
check("…but not with a bowed front: the shape stays, the note says a deck follows the wall with a straight front", deckShapeForHouse(bowedRect, away).shape === bowedRect && /straight front/.test(deckShapeForHouse(bowedRect, away).note ?? ""));
const deep: HouseDesign = { ...plain, jogs: [{ id: "j1", atFt: 12, dir: "toward", depthFt: 11 }] };
const fitD = deckShapeForHouse(rect, deep);
check("a bump-out deeper than the deck can wrap: the notch held at 9 ft and the note says it", fitD.shape.kind === "L" && fitD.shape.notch.depthFt === 9 && /held at 9 ft/.test(fitD.note ?? ""), fitD.note ?? "");
const l: DeckShape = { kind: "L", widthFt: 16, depthFt: 12, notch: { corner: "back-right", widthFt: 4, depthFt: 3 } };
check("no step under the deck takes a back notch away", deckShapeForHouse(l, plain).shape.kind === "rect");
const sliver: HouseDesign = { ...plain, jogs: [{ id: "j1", atFt: 15, dir: "toward", depthFt: 3 }] };
check("a bump-out leaving 1 ft at the end: too little to notch, the deck stays a rectangle and the note says so", deckShapeForHouse(rect, sliver).shape.kind === "rect" && /too little to notch/.test(deckShapeForHouse(rect, sliver).note ?? ""));

// ── the Shape step's notch puts its step in the wall; a rectangle takes it away
const h1 = houseForShape(plain, l);
check("a back-right notch 4 × 3 picked in the Shape step: a step at 12 ft that comes out 3 ft", h1.jogs.length === 1 && h1.jogs[0].atFt === 12 && h1.jogs[0].dir === "toward" && h1.jogs[0].depthFt === 3, JSON.stringify(h1.jogs));
check("…and back to a rectangle, the step goes", houseForShape(h1, rect).jogs.length === 0);
check("…a deeper notch deepens the step it already has", houseForShape(h1, { ...l, notch: { ...l.notch, depthFt: 5 } }).jogs[0].depthFt === 5);
const lLeft: DeckShape = { kind: "L", widthFt: 16, depthFt: 12, notch: { corner: "back-left", widthFt: 5, depthFt: 2 } };
const h2 = houseForShape(plain, lLeft);
check("a back-left notch: the wall steps back at 5 ft (the left part is the bump-out)", h2.jogs.length === 1 && h2.jogs[0].atFt === 5 && h2.jogs[0].dir === "away" && h2.jogs[0].depthFt === 2, JSON.stringify(h2.jogs));
check("the design read back leaves the steps as given — a back notch without its step stays stepless (the studio adds it once, on opening), so a removed step stays removed", normalizeDeckDesign({ ...defaultDeckDesign(), shape: l, house: plain }).house.jogs.length === 0 && normalizeDeckDesign({ ...defaultDeckDesign(), shape: l, house: h1 }).house.jogs.length === 1);
const implied = houseScene(l, plain, { deckHeightFt: 3, peakFt: 0, mainEdge: null });
check("…and such a design is still drawn with the bump-out its notch wraps (a block of its own, 3 ft out in front of the body)", implied.blocks.some((b) => b[0] === 12 && b[1] === 0 && b[3] === 3), JSON.stringify(implied.blocks));
check("and the two agree both ways: the house's step makes the same notch", JSON.stringify(deckShapeForHouse(l, h1).shape) === JSON.stringify(l));

// ── what the 3D draws
const hs = houseScene(rect, bump, { deckHeightFt: 3, peakFt: 3, mainEdge: { x0: 0, x1: 12 } });
// The house's body stands behind its main wall the whole length, 24 ft deep (2026-10-23, so one roof covers it); a bump-out is a block of its own in front.
check("the body 24 ft deep behind the house line along the whole wall, the bump-out a block in front of it, 12 ft tall over a 3 ft deck", hs.blocks.length === 3 && hs.blocks.filter((b) => b[1] === -HOUSE_BODY_FT && b[3] === 0).length === 2 && hs.blocks.some((b) => b[0] === 12 && b[1] === 0 && b[3] === 3) && hs.blocks.every((b) => b[4] === 12) && hs.heightFt === 12, JSON.stringify(hs.blocks));
check("one roof over the body (a hip, at 6/12), one over the bump-out (its own hip, its back on the body)", hs.roofs?.length === 2 && hs.roofs[0][0] === 0 && hs.roofs[0][1] === -4 && hs.roofs[0][3] === 20 && hs.roofs[0][2] === -HOUSE_BODY_FT && hs.roofs[0][6] === 6 && hs.roofs[1][0] === 5 && hs.roofs[1][2] === 0 && hs.roofs[1][4] === 3, JSON.stringify(hs.roofs));
check("a low deck: one storey is 10 ft", houseScene(rect, plain, { deckHeightFt: 1, peakFt: 0, mainEdge: null }).heightFt === 10);
check("the door on the deck's main back edge: centred on 0…12, 6 ft wide, on the house line", !!hs.door && hs.door[0] === 6 && hs.door[1] === 6 && hs.door[3] === 0, JSON.stringify(hs.door));
check("windows along every face, clear of the door, sills above the deck's floor", hs.windows.length >= 2 && hs.windows.some((w) => w[1] === 0) && hs.windows.some((w) => w[1] === 3) && hs.windows.every((w) => w[4] >= 4.2 && w[2] === 3) && !hs.windows.some((w) => w[1] === 0 && Math.abs(w[0] - 6) < 6), JSON.stringify(hs.windows));
const two = houseScene(rect, { ...bump, storeys: 2, roof: "gable" }, { deckHeightFt: 3, peakFt: 3, mainEdge: { x0: 0, x1: 12 } });
check("two storeys: the body 19 ft 6 in. the whole length (behind the bump-out too), the bump-out one storey (12 ft over this deck), the roof a gable, windows on both floors", two.blocks.filter((b) => b[3] === 0).every((b) => b[4] === 2 * STOREY_FT + 0.5) && two.blocks.find((b) => b[1] === 0)?.[4] === 12 && two.roof === "gable" && two.roofs?.[0][0] === 1 && two.roofs?.[1][0] === 6 && two.roofs?.[1][5] === 12 && two.windows.some((w) => w[4] > STOREY_FT) && two.windows.some((w) => w[4] < STOREY_FT), `${two.blocks.map((b) => b[4]).join("/")} · ${two.windows.length} windows`);
const tall = houseScene(rect, plain, { deckHeightFt: 9, peakFt: 0, mainEdge: null });
check("a walk-out deck 9 ft up: the house stands 18 ft so the door has a wall around it", tall.heightFt === 18);
const knobs = houseHandles(rect, bump, 3.17);
check("knobs: the step at 12 ft on the bump-out's corner, the house's two corners at −4 and 20", knobs.length === 3 && knobs[0].kind === "jog" && knobs[0].x === 12 && knobs[0].y === 3 && knobs[1].kind === "house-left" && knobs[1].x === -4 && knobs[2].kind === "house-right" && knobs[2].x === 20, JSON.stringify(knobs.map((k) => [k.kind, k.x, k.y])));

// ── through the scene and the client's parser
const design = applyDeckPatch(defaultDeckDesign({ state: "WA", frostIn: 18 }), { house: { storeys: 2, jogs: [{ id: "j1", atFt: 12, dir: "toward", depthFt: 3 }] } });
check("the patch notches the deck through the normaliser's own house sync only when the studio asks — here the shape stays a rectangle until the studio reconciles", design.shape.kind === "rect");
const synced = applyDeckPatch(design, { shape: deckShapeForHouse(design.shape, design.house).shape });
const sc = deckScene(buildStructure(synced));
check("the scene's house: the two-storey body and the one-storey bump-out in front, the door, windows, the roof and its pieces, the storeys", !!sc.house && sc.house.blocks.length === 3 && sc.house.blocks.some((b) => b[1] === 0 && b[4] < sc.house!.heightFt) && sc.house.storeys === 2 && sc.house.roof === "hip" && sc.house.roofs?.length === 2 && (sc.house.windows?.length ?? 0) > 0 && !!sc.house.door, JSON.stringify({ blocks: sc.house?.blocks, storeys: sc.house?.storeys }));
check("…and the knobs ride in the scene's handles", sc.handles.some((h) => h.kind === "jog") && sc.handles.some((h) => h.kind === "house-left") && sc.handles.some((h) => h.kind === "house-right"));
const back = parseDeckScene(JSON.parse(JSON.stringify(sc)));
check("the client's parser keeps the five-number blocks, the storeys, the roof, its pieces and the windows", !!back && !!back.house && back.house.blocks.length === 3 && back.house.blocks[0].length === 5 && back.house.storeys === 2 && back.house.roof === "hip" && JSON.stringify(back.house.roofs) === JSON.stringify(sc.house?.roofs) && (back.house.windows?.length ?? 0) === (sc.house?.windows?.length ?? 0));
check("…and an older scene without them still parses", !!parseDeckScene({ ...JSON.parse(JSON.stringify(sc)), house: { blocks: [[-4, -12, 20, 0]], heightFt: 12, door: [8, 6, 6.67] } }));
check("the 3D's house line is the deck's: the main block's face at y = 0 under the deck", near(sc.house!.blocks[0][3], 0, 1e-9));

// ── one-click walls and the words
const notchOf = (sh: DeckShape) => (sh.kind === "L" ? sh.notch : null);
const qr = quickWall("bump-right", rect, plain);
check("'Bump-out at the right end' on a 16 ft deck: one step at 12 ft that comes out 3 ft — a 4 × 3 back-right notch", qr.jogs.length === 1 && qr.jogs[0].atFt === 12 && qr.jogs[0].dir === "toward" && notchOf(deckShapeForHouse(rect, qr).shape)?.corner === "back-right" && quickWallOf(rect, qr) === "bump-right", JSON.stringify(qr.jogs));
const ql = quickWall("bump-left", rect, plain);
check("'Bump-out at the left end': the wall steps back at 4 ft — a back-left notch", ql.jogs[0].atFt === 4 && ql.jogs[0].dir === "away" && notchOf(deckShapeForHouse(rect, ql).shape)?.corner === "back-left" && quickWallOf(rect, ql) === "bump-left", JSON.stringify(ql.jogs));
const qn = quickWall("nook", rect, plain);
check("'The deck in a nook': the wall comes out past both ends; the deck stays a rectangle, no note", qn.jogs.length === 2 && deckShapeForHouse(rect, qn).shape.kind === "rect" && deckShapeForHouse(rect, qn).note === null && quickWallOf(rect, qn) === "nook", JSON.stringify(qn.jogs));
check("'Straight wall' clears the steps; a wall with none reads as straight", quickWall("straight", rect, qn).jogs.length === 0 && quickWallOf(rect, plain) === "straight");
check("the words: a straight wall, a wrapped bump-out, a nook, a step the deck cannot frame", /straight wall/.test(wallWords(rect, plain)) && /wraps the bump-out at its right end: a 4 ft × 3 ft notch/.test(wallWords(rect, qr)) && /sits in a nook/.test(wallWords(rect, qn)) && /follows the wall, 3 parts — 5 ft on the house line, 4 ft stepping 3 ft out around the wall, 7 ft on the house line/.test(wallWords(rect, middle)), [wallWords(rect, plain), wallWords(rect, qr), wallWords(rect, middle)].join(" | "));
check("a step in words", stepWords(qr.jogs[0], rect) === "12 ft from the deck's left end, the wall to the right comes out 3 ft" && /at the deck's left end/.test(stepWords(qn.jogs[0], rect)) && /at the deck's right end/.test(stepWords(qn.jogs[1], rect)), stepWords(qr.jogs[0], rect));

// ── shaped by hand: a part in or out, a step added where tapped, a step moved with order and snapping, the deck slid and sized
const out2 = moveWallPart(bump, rect, 1, 2)!;
check("the bump-out's part dragged 2 ft further out: its step deepens to 5 ft", out2.jogs[0].depthFt === 5 && out2.jogs[0].dir === "toward", JSON.stringify(out2.jogs));
check("…dragged 3 ft back in, the step reads 0 and the read-back drops it (the wall is level again)", normalizeHouse(moveWallPart(bump, rect, 1, -3)!, rect).jogs.length === 0);
check("the part the deck stands on cannot be dragged — null says so", moveWallPart(bump, rect, 0, 2) === null);
const mid3 = moveWallPart(middle, rect, 1, 1)!;
check("a middle part pushed out 1 ft: the step before it deepens, the step after it shallows", mid3.jogs[0].depthFt === 4 && mid3.jogs[1].depthFt === 4 && mid3.jogs[1].dir === "away", JSON.stringify(mid3.jogs));
const plusR = addStepAt(plain, rect, 16);
check("+ at the deck's right end: the wall beyond comes out 2 ft; the deck stays a rectangle, no note", plusR.jogs.length === 1 && plusR.jogs[0].atFt === 16 && plusR.jogs[0].dir === "toward" && plusR.jogs[0].depthFt === 2 && deckShapeForHouse(rect, plusR).shape.kind === "rect" && deckShapeForHouse(rect, plusR).note === null, JSON.stringify(plusR.jogs));
check("+ at the deck's left end: the wall to the left comes out (the step there steps back)", addStepAt(plain, rect, 0).jogs[0].dir === "away");
check("+ on top of a step, or one past the wall's six, changes nothing", addStepAt(bump, rect, 12.4) === bump && addStepAt({ ...plain, jogs: [1, 2, 3, 4, 5, 6].map((n) => ({ id: `j${n}`, atFt: n * 2, dir: "toward" as const, depthFt: 1 })) }, rect, 14) !== null && addStepAt({ ...plain, jogs: [1, 2, 3, 4, 5, 6].map((n) => ({ id: `j${n}`, atFt: n * 2, dir: "toward" as const, depthFt: 1 })) }, rect, 14).jogs.length === 6);
check("a step dragged near the deck's end snaps onto it; past a neighbour it stops a foot short; past the wall's end it stops a foot in", moveJogTo(bump, rect, "j1", 15.6).jogs[0].atFt === 16 && moveJogTo(middle, rect, "j1", 12).jogs[0].atFt === 8 && moveJogTo(bump, rect, "j1", -40).jogs[0].atFt === -3, `${moveJogTo(bump, rect, "j1", 15.6).jogs[0].atFt} · ${moveJogTo(middle, rect, "j1", 12).jogs[0].atFt} · ${moveJogTo(bump, rect, "j1", -40).jogs[0].atFt}`);
const slid = slideDeck(bump, 2);
check("the deck slid 2 ft right along the wall: the house stays, so more wall past its left end, less past its right, the step 2 ft left in the deck's feet", slid.leftFt === 6 && slid.rightFt === 2 && slid.jogs[0].atFt === 10, JSON.stringify(slid));
check("…and no further than the wall's reach allows", slideDeck(bump, 10).rightFt === 0 && slideDeck(bump, -70).leftFt === 0);
const narrowed = resizeDeckLeft(bump, rect, 14, 4, 60);
check("the deck's left end pulled 2 ft right: 14 ft wide, the right end and the house where they were, the step 2 ft left in the deck's feet", narrowed.shape.widthFt === 14 && narrowed.house.leftFt === 6 && narrowed.house.jogs[0].atFt === 10 && deckShapeForHouse(narrowed.shape, narrowed.house).shape.kind === "L", JSON.stringify(narrowed));
check("colours: read back, and off into the scene as hex", normalizeHouse({ siding: "blue", roofColour: "forest" }, rect).siding === "blue" && normalizeHouse({ siding: "pink" }, rect).siding === "cream" && houseScene(rect, { ...plain, siding: "grey", roofColour: "brown" }, { deckHeightFt: 3, peakFt: 0, mainEdge: null }).siding === "#b7babb" && /^#[0-9a-f]{6}$/.test(houseScene(rect, plain, { deckHeightFt: 3, peakFt: 0, mainEdge: null }).roofColour));
check("a half-foot step is a step; nothing less", normalizeHouse({ jogs: [{ atFt: 8, dir: "toward", depthFt: 0.5 }, { atFt: 12, dir: "toward", depthFt: 0.2 }] }, rect).jogs.length === 1);

console.log(bad ? `\n${bad} FAILED` : "\nALL PASS");
process.exit(bad ? 1 : 0);
