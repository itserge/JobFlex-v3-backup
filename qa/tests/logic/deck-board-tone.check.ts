// A DECK BOARD'S TONE GOES WITH ITS PLACE (2026-11-14, lib/deck/boardTone — the owner: "when moving the deck, reshaping
// and cutting the corners… the decking on the 3D gets discoloured. Keep the decking material steady in colour"). The
// shade of a board was named by its number in the scene's list, so every change to the deck dealt the floor a new hand
// of shades; and a board cut at an angle was drawn without the grain the square boards wear. Here: the seed of a
// board's shade is its place on the deck — so the boards that stay where they are keep it while the deck is pulled
// wider, deeper or cut — and a cut board gets the texture coordinates a box has. And the ties under a cut corner sit
// where a joist sits on a beam (lib/deck/frame tieAt), not in the air beside the deck. Pure.
//   NODE_PATH="" npx tsx --tsconfig tsconfig.json qa/tests/logic/deck-board-tone.check.ts
import { defaultDeckDesign, normalizeDeckDesign, shapeOutline, type DeckShape } from "@/lib/deck/design";
import { buildStructure } from "@/lib/deck/structure";
import { deckScene, SCENE_LAYERS, type DeckScene } from "@/lib/deck/scene";
import { boxPlace, placeSeeds, ringPlace, type BoardPlace } from "@/lib/deck/boardTone";

let bad = 0;
const check = (name: string, ok: boolean, info: unknown = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || info === "" ? "" : `  — ${typeof info === "string" ? info : JSON.stringify(info)}`}`);
};
const seedOf = (p: BoardPlace) => placeSeeds([p])[0];

console.log("— a board's seed is its place —");
{
  const W = 5.5 / 12;
  const P = W + 0.125 / 12;
  const row3 = (cx: number, sx: number, z = 1.2) => boxPlace(cx, 3 * P + W / 2, sx, W, z);
  const a = seedOf(row3(8, 16));
  check("the same place gives the same seed, whatever its number in the list", a === seedOf(row3(8, 16)));
  check("the next row out from the house is another board", a !== seedOf(boxPlace(8, 4 * P + W / 2, 16, W, 1.2)));
  const pair = placeSeeds([row3(20, 8), row3(8, 16)]);
  check("the board after a butt joint is another board — and the row's first board is told as the first, whatever order they come in", pair[0] !== pair[1] && pair[1] === a, pair);
  check("a board that only got LONGER at its far end keeps its seed (the deck pulled wider)", a === seedOf(row3(9, 18)));
  const moved = placeSeeds([row3(8, 16), row3(21, 10)]);
  check("…and the board after the joint keeps its own though the joint moved: it is still the row's second board", moved[1] === pair[0], { moved, pair });
  check("a board lying out from the house (a side border) is told from one lying along it", seedOf(boxPlace(0.3, 6, W, 12, 1.2)) !== seedOf(boxPlace(6, 0.3, 12, W, 1.2)));
  check("a lower deck's board at the same spot is another board", a !== seedOf(row3(8, 16, 9)));
  // Forty rows of two boards: every one its own seed (the rows are told apart at half a board).
  const floor = placeSeeds(Array.from({ length: 40 }, (_, k) => [boxPlace(8, k * P + W / 2, 16, W, 1.2), boxPlace(20, k * P + W / 2, 8, W, 1.2)]).flat());
  check("forty rows of two boards are eighty different boards", new Set(floor).size === 80, new Set(floor).size);
}

console.log("— a board cut at an angle wears the grain as a square one does —");
{
  const W = 5.5 / 12;
  // A board along the house from x = 4 to 16, its right end cut at 45°.
  const ring = [4, 2, 16, 2, 16 - W, 2 + W, 4, 2 + W];
  const r = ringPlace(ring, 1.2);
  const us = r.uv.filter((_, i) => i % 2 === 0);
  const vs = r.uv.filter((_, i) => i % 2 === 1);
  check("its texture runs once along the board, end to end", Math.min(...us) === 0 && Math.max(...us) === 1 && us[0] === 0 && us[1] === 1, us);
  check("…and once across it", Math.min(...vs) === 0 && Math.max(...vs) === 1 && vs[0] === 0 && Math.abs(vs[3] - 1) < 1e-9, vs);
  check("…every corner inside the texture", r.uv.every((v) => v >= -1e-9 && v <= 1 + 1e-9));
  const box = boxPlace(10, 2 + W / 2, 12, W, 1.2);
  check("it is a board of its row: the same row, start and way as a square board there", r.place.row === box.row && r.place.turn === box.turn && Math.abs(r.place.startFt - box.startFt) < 1e-9 && seedOf(r.place) === seedOf(box), { ring: r.place, box });
  // A row of two boards whose SECOND board's far end is cut — drawn as its square part and then its cut tip: the row
  // keeps the two shades it had when that board was square.
  const rowSquare = placeSeeds([boxPlace(2, 2 + W / 2, 4, W, 1.2), boxPlace(10, 2 + W / 2, 12, W, 1.2)]);
  const farTip = ringPlace([12, 2, 16, 2, 16 - W, 2 + W, 12, 2 + W], 1.2);
  const rowCut = placeSeeds([boxPlace(2, 2 + W / 2, 4, W, 1.2), boxPlace(8, 2 + W / 2, 8, W, 1.2), farTip.place]);
  check("a row whose end board is cut keeps the shades it had when that board was square", rowCut[0] === rowSquare[0] && rowCut[1] === rowSquare[1] && rowCut[2] === rowSquare[1], { rowCut, rowSquare });
  // A board that crosses a cut corner is drawn in two pieces — the cut part, then the square part: one board, one shade.
  const tip = ringPlace([4, 2 + W, 4 + W, 2, 6, 2, 6, 2 + W], 1.2);
  const split = placeSeeds([tip.place, boxPlace(11, 2 + W / 2, 10, W, 1.2), boxPlace(20, 2 + W / 2, 8, W, 1.2)]);
  check("a board drawn as a cut piece and a square piece end to end is ONE board: one shade", tip.place.cut && split[0] === split[1], { split, tip: tip.place });
  check("…and the board after the butt joint is the row's second board, as it was before the corner was cut", split[2] !== split[1] && split[2] === placeSeeds([boxPlace(10, 2 + W / 2, 12, W, 1.2), boxPlace(20, 2 + W / 2, 8, W, 1.2)])[1], split);
  check("a ring that is a plain rectangle is not a cut board", !ringPlace([4, 2, 16, 2, 16, 2 + W, 4, 2 + W], 1.2).place.cut && r.place.cut);
  const other = ringPlace(ring.map((v, i) => (i % 2 ? v + 5 : v)), 1.2);
  check("the same cut board in another row is another board", seedOf(other.place) !== seedOf(r.place));
  // A board out from the house, cut: the grain still runs along it.
  const up = ringPlace([3, 0, 3 + W, 0, 3 + W, 8, 3, 8 - W], 1.2);
  const uU = up.uv.filter((_, i) => i % 2 === 0);
  const upBox = boxPlace(3 + W / 2, 4, W, 8, 1.2);
  check("a board lying out from the house: the grain runs out from the house", uU[0] === 0 && uU[2] === 1, up.uv);
  check("…a board of its row too", up.place.row === upBox.row && up.place.turn === 1 && seedOf(up.place) === seedOf(upBox), { ring: up.place, box: upBox });
  // On the diagonal: u along the board's own way.
  const d = ringPlace([0, 0, 0.6, 0, 6.6, 6, 6, 6], 1.2);
  check("a board on the diagonal: its grain runs along the diagonal, and it is told from the square boards", Math.max(...d.uv) <= 1 + 1e-9 && Math.min(...d.uv) >= -1e-9 && d.uv.filter((_, i) => i % 2 === 0).some((u) => Math.abs(u - 1) < 1e-9) && d.place.turn >= 2, d.place);
  check("a ring too small to be a board is harmless", ringPlace([0, 0, 1, 1]).uv.length === 4);
}

console.log("— the floor keeps its shades while the deck is reshaped —");
{
  const d0 = defaultDeckDesign({ state: "WA" });
  const DECK = SCENE_LAYERS.indexOf("decking");
  const scene = (shape: DeckShape): DeckScene => deckScene(buildStructure(normalizeDeckDesign({ ...d0, shape, heightIn: 15, rail: { type: "none" } })));
  /**
   * Every square board, named by its row and which board of the row it is ("y2.25 #1") → the seed of its shade as the
   * 3D works it out (the square boards and the cut ones together), and its number in the scene's list (the old seed).
   */
  const boards = (sc: DeckScene) => {
    const idx: number[] = [];
    sc.boxes.forEach((b, i) => {
      if (b[0] === DECK) idx.push(i);
    });
    const cut = (sc.diagonal?.boards ?? []).map((r, i) => ringPlace(r, sc.diagonal?.zs?.[i] ?? sc.heightFt).place);
    const seeds = placeSeeds([...idx.map((i) => boxPlace(sc.boxes[i][1], sc.boxes[i][2], sc.boxes[i][4], sc.boxes[i][5], sc.boxes[i][3])), ...cut]);
    const rows = new Map<string, Array<{ x0: number; seed: number; index: number }>>();
    idx.forEach((i, k) => {
      const b = sc.boxes[i];
      const along = b[4] >= b[5];
      const row = along ? `y${b[2].toFixed(2)}` : `X${b[1].toFixed(2)}`;
      const list = rows.get(row) ?? [];
      list.push({ x0: along ? b[1] - b[4] / 2 : b[2] - b[5] / 2, seed: seeds[k], index: i });
      rows.set(row, list);
    });
    const out = new Map<string, { place: number; index: number }>();
    for (const [row, list] of rows) list.sort((a, b) => a.x0 - b.x0).forEach((q, nth) => out.set(`${row} #${nth}`, { place: q.seed, index: q.index }));
    return out;
  };
  const plain = scene({ kind: "rect", widthFt: 24, depthFt: 12 });
  const A = boards(plain);
  const kept = (B: ReturnType<typeof boards>) => {
    let here = 0;
    let same = 0;
    let sameByNumber = 0;
    for (const [k, a] of A) {
      const b = B.get(k);
      if (!b) continue;
      here++;
      if (b.place === a.place) same++;
      if (b.index === a.index) sameByNumber++;
    }
    return { boards: A.size, here, same, sameByNumber };
  };
  check("a plain 24 × 12 deck has its rows of boards", A.size >= 25, A.size);
  const wider = kept(boards(scene({ kind: "rect", widthFt: 26, depthFt: 12 })));
  check("pulled 2 ft wider: every row keeps its boards' shades, the ones after a butt joint too", wider.here >= A.size * 0.9 && wider.same === wider.here, wider);
  const deeper = kept(boards(scene({ kind: "rect", widthFt: 24, depthFt: 14 })));
  check("pulled 2 ft deeper: every row that was there keeps its shades", deeper.here >= A.size * 0.9 && deeper.same === deeper.here, deeper);
  const cutShape: DeckShape = { kind: "wall", widthFt: 24, depthFt: 12, back: [{ x0Ft: 0, x1Ft: 24, yFt: 0 }], front: [{ x0Ft: 0, x1Ft: 24, yFt: 12, clipLeftFt: 4 }] };
  const cutScene = scene(cutShape);
  const cut = kept(boards(cutScene));
  check("a corner cut at an angle: the rows the cut does not reach keep their shade", cut.here >= A.size * 0.4 && cut.same === cut.here, cut);
  check("…where the board's NUMBER in the list would have changed for most of them (the old way: a new hand of shades)", wider.sameByNumber < wider.here || deeper.sameByNumber < deeper.here || cut.sameByNumber < cut.here, { wider: wider.sameByNumber, deeper: deeper.sameByNumber, cut: cut.sameByNumber });
  const rings = cutScene.diagonal?.boards ?? [];
  check("the cut corner's boards are there to be drawn", rings.length >= 4, rings.length);
  const placed = rings.map((r, i) => ringPlace(r, cutScene.diagonal?.zs?.[i] ?? cutScene.heightFt));
  check("…each with its grain inside the texture, run end to end", placed.every((p) => p.uv.every((v) => v >= -1e-9 && v <= 1 + 1e-9) && p.uv.some((v, i) => i % 2 === 0 && Math.abs(v - 1) < 1e-9) && p.uv.some((v, i) => i % 2 === 0 && Math.abs(v) < 1e-9)));
  check("…and no two of them the same board", new Set(placeSeeds(placed.map((p) => p.place))).size === placed.length, placed.map((p) => p.place));
  // The same deck drawn twice is the same floor.
  const again = boards(scene({ kind: "rect", widthFt: 24, depthFt: 12 }));
  check("the same deck drawn again is the same floor", [...A].every(([k, a]) => again.get(k)?.place === a.place));
}

console.log("— the ties sit where a joist sits on a beam —");
{
  // (2026-11-14) A tie was drawn — and counted — on every joist along every beam's line: past a corner cut at an angle
  // the beam stops short and the joists there are cut short of it, so those ties stood in the air beside the deck, and
  // the joists over the angled beam under the cut had none.
  const d0 = defaultDeckDesign({ state: "WA" });
  const shape: DeckShape = { kind: "wall", widthFt: 24, depthFt: 18, back: [{ x0Ft: 0, x1Ft: 24, yFt: 0 }], front: [{ x0Ft: 0, x1Ft: 8, yFt: 12, clipLeftFt: 6 }, { x0Ft: 8, x1Ft: 14, yFt: 18, clipRightFt: 3 }, { x0Ft: 14, x1Ft: 24, yFt: 12, clipRightFt: 4 }] };
  const s = buildStructure(normalizeDeckDesign({ ...d0, shape, heightIn: 36, rail: { type: "none" } }));
  const f = s.frame!;
  const out = shapeOutline(s.design.shape);
  const inside = (x: number, y: number) => {
    let hit = false;
    for (let i = 0, k = out.length - 1; i < out.length; k = i++) {
      const a = out[i], b = out[k];
      if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
    }
    return hit;
  };
  check("a dropped frame with corners cut at an angle has its angled beams", f.beamStyle === "dropped" && f.cornerBeams.length >= 2, f.cornerBeams.length);
  check("every tie is inside the deck", f.tieAt.every((t) => inside(t.x, t.y)), f.tieAt.filter((t) => !inside(t.x, t.y)));
  check("the joists over an angled beam are tied to it", f.cornerBeams.every((cb) => f.tieAt.some((t) => Math.abs(t.y - (cb.y0 + ((t.x - cb.x0) / (cb.x1 - cb.x0)) * (cb.y1 - cb.y0))) < 0.01 && t.x > Math.min(cb.x0, cb.x1) && t.x < Math.max(cb.x0, cb.x1))));
  check("the material list counts the ties the 3D draws", f.hardware.ties === f.tieAt.reduce((a, t) => a + t.n, 0), { counted: f.hardware.ties, drawn: f.tieAt.length });
  const plain = buildStructure(normalizeDeckDesign({ ...d0, shape: { kind: "rect", widthFt: 16, depthFt: 12 }, heightIn: 36 })).frame!;
  const joists = plain.joists.filter((j) => !j.sister).length;
  const doubled = plain.joists.filter((j) => j.sister).length;
  check("a plain deck: a tie on every joist at every beam, as before", plain.hardware.ties === (joists + doubled) * plain.beams.length && plain.tieAt.length === joists * plain.beams.length, { ties: plain.hardware.ties, joists, doubled, beams: plain.beams.length });
}

console.log(bad ? `\n${bad} FAILED` : "\nALL PASS");
process.exit(bad ? 1 : 0);
