// THE PAINT ORDER OF THE SMALL PICTURE (2026-11-10, lib/deck/isoOrder + lib/deck/iso). Owner, with the permit set's
// cover open: "the picture of the deck … is look not good. The beam sticks out." The near end of the beam (and the
// ledger at the house) was painted AFTER the deck boards over it, because faces were sorted by their middles and a
// 16 ft board's middle is 8 ft along. Here: the order by the faces' own planes, and on the real picture — nothing of
// the frame under the boards is ever painted over a board. Pure.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/deck-iso-order.check.ts
import { ORDER_MAX_FACES, paintOrder, type OrderFace, type OrderPoint, type OrderView } from "../../../src/lib/deck/isoOrder";
import { isoDrawing } from "../../../src/lib/deck/iso";
import { defaultDeckDesign, defaultRoofDesign, type DeckDesign } from "../../../src/lib/deck/design";
import { buildStructure } from "../../../src/lib/deck/structure";
import { deckScene } from "../../../src/lib/deck/scene";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};

/* ── the order itself, on faces made by hand ── */
// The viewer stands in front of the deck (+y), a little to the left, above it — as the cover's picture does.
const unit = (v: OrderPoint): OrderPoint => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
const dir = unit([-0.45, 0.65, 0.61]);
const right = unit([dir[1], -dir[0], 0]);
const up: OrderPoint = [dir[1] * right[2] - dir[2] * right[1], dir[2] * right[0] - dir[0] * right[2], dir[0] * right[1] - dir[1] * right[0]];
const dot = (a: OrderPoint, b: OrderPoint) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const flatView: OrderView = { dir, eye: null };
const eyeView: OrderView = { dir, eye: [8 + dir[0] * 130, 6 + dir[1] * 130, 3 + dir[2] * 130] };
/** A face as the picture hands it over: its ring, the ring on the page, and the old rule's number — its middle's depth. */
const face = (pts: OrderPoint[], rank = 0): OrderFace => {
  const mid: OrderPoint = [0, 0, 0];
  for (const p of pts) { mid[0] += p[0] / pts.length; mid[1] += p[1] / pts.length; mid[2] += p[2] / pts.length; }
  return { pts, scr: pts.map((p) => [dot(p, right), -dot(p, up)] as [number, number]), depth: dot(mid, dir), rank };
};
const level = (x0: number, x1: number, y0: number, y1: number, z: number) => face([[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]]);

const board = level(0, 16, 9.5, 10.5, 3); // a 16 ft deck board
// The near strip of the beam under the deck, a little back from the board — so from above and in front the eye's line
// to it passes through the board: the board hides it.
const beamEnd = level(0, 4, 8.9, 9.3, 2.3);
check("the old rule had it wrong: by its middle, the beam's near end is nearer than the board over it", beamEnd.depth > board.depth, `${beamEnd.depth.toFixed(2)} vs ${board.depth.toFixed(2)}`);
for (const [name, view] of [["flat", flatView], ["with perspective", eyeView]] as const) {
  const order = paintOrder([board, beamEnd], view);
  check(`${name}: the beam's end is painted before the board over it`, order.join() === "1,0", order.join());
  const turned = paintOrder([beamEnd, board], view);
  check(`${name}: … whichever comes first in the list`, turned.join() === "0,1", turned.join());
}
// A post standing in front of the board's far end: nearer by any rule, and it stays after the board.
const postFace = face([[12, 12, 0], [12.5, 12, 0], [12.5, 12, 8], [12, 12, 8]]);
const three = paintOrder([postFace, board, beamEnd], flatView);
check("a post in front of the deck stays after the board; the beam still goes under", three.indexOf(2) < three.indexOf(1) && three.indexOf(1) < three.indexOf(0), three.join());
// Two faces that do not meet on the page keep the old far-to-near order.
const far = level(0, 2, 0, 1, 3), near = level(10, 12, 9, 10, 0);
check("faces that do not overlap on the page stay far to near", paintOrder([near, far], flatView).join() === (far.depth < near.depth ? "1,0" : "0,1"));
// Faces in one plane (a board next to a board) keep the old order.
const b1 = level(0, 16, 9, 9.5, 3), b2 = level(0, 16, 9.5, 10, 3);
check("faces in one plane stay far to near", paintOrder([b2, b1], flatView).join() === "1,0");
// Three faces each over the next (a ring) still come out, each once.
const ring = [
  face([[0, 0, 0], [6, 0, 1], [6, 1, 1], [0, 1, 0]]),
  face([[5, -2, 0], [5.5, 4, 1], [4.5, 4, 1], [4, -2, 0]]),
  face([[6, 3, 0], [0, 3.5, 1], [0, 2.5, 1], [6, 2, 0]]),
  face([[1, 5, 0], [0.5, -1, 1], [1.5, -1, 1], [2, 5, 0]]),
];
const ringOrder = paintOrder(ring, flatView);
check("a ring of faces still comes out whole", ringOrder.length === 4 && new Set(ringOrder).size === 4, ringOrder.join());
check("nothing and one face", paintOrder([], flatView).length === 0 && paintOrder([board], flatView).join() === "0");
// Past the cap the old order stands (the pairs would be too many for one frame).
const many: OrderFace[] = Array.from({ length: ORDER_MAX_FACES + 1 }, (_, i) => ({ ...(i % 2 ? board : beamEnd), depth: -i }));
const manyOrder = paintOrder(many, flatView);
check("past the cap: far to near, as before", manyOrder.length === many.length && manyOrder[0] === many.length - 1 && manyOrder[many.length - 1] === 0);

/* ── the real picture: nothing of the frame under the boards is painted over a board ── */
type Ring = Array<[number, number]>;
const ringOf = (d: string): Ring => {
  const n = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  const out: Ring = [];
  for (let i = 0; i + 1 < n.length; i += 2) out.push([n[i], n[i + 1]]);
  return out;
};
/** Do two outlines overlap on the page by more than `by`? (Separating axes.) */
const overlap = (A: Ring, B: Ring, by: number): boolean => {
  for (const P of [A, B]) {
    for (let k = 0; k < P.length; k++) {
      const p = P[k], q = P[(k + 1) % P.length];
      let ex = q[1] - p[1], ey = p[0] - q[0];
      const el = Math.hypot(ex, ey);
      if (el < 1e-6) continue;
      ex /= el; ey /= el;
      let a0 = Infinity, a1 = -Infinity, c0 = Infinity, c1 = -Infinity;
      for (const v of A) { const t = v[0] * ex + v[1] * ey; a0 = Math.min(a0, t); a1 = Math.max(a1, t); }
      for (const v of B) { const t = v[0] * ex + v[1] * ey; c0 = Math.min(c0, t); c1 = Math.max(c1, t); }
      if (a1 - c0 < by || c1 - a0 < by) return false;
    }
  }
  return true;
};
const UNDER = new Set(["beam", "ledger", "joist", "rim", "post"]);
const base = defaultDeckDesign({ state: "TN", frostIn: 12 });
const covered: DeckDesign = { ...base, structure: "covered-deck", roof: defaultRoofDesign("covered-deck") };
// The cover's own picture (components/v3/deck-plans/plan-set): the joists in, from the left and from the right.
const COVER_SKIP = ["wire", "hardware", "blocking", "footing"] as never;
for (const [name, design] of [["a deck", base], ["a covered deck (the owner's)", covered]] as const) {
  const scene = deckScene(buildStructure(design));
  for (const yawDeg of [-32, 32]) {
    const drawing = isoDrawing(scene, { yawDeg, maxSolids: 6000, skip: COVER_SKIP, materials: { decking: "wood", roofing: design.roof.roofing, rail: design.rail.type } });
    const faces = drawing.faces.map((f, i) => ({ i, layer: f.layer as string, ring: f.fill === "none" ? null : ringOf(f.d) }));
    const boards = faces.filter((f) => f.layer === "decking" && f.ring);
    const frame = faces.filter((f) => UNDER.has(f.layer) && f.ring);
    let over = 0;
    let which = "";
    for (const m of frame) {
      for (const b of boards) {
        if (b.i > m.i) break; // boards painted after the member cover it — right
        if (overlap(m.ring as Ring, b.ring as Ring, 0.08)) { over++; which ||= `${m.layer} (face ${m.i}) over a board (face ${b.i})`; break; }
      }
    }
    check(`${name}, turned ${yawDeg}°: the picture has its frame (${frame.length} faces) and its boards (${boards.length})`, frame.length > 20 && boards.length > 20);
    check(`${name}, turned ${yawDeg}°: no beam, ledger, joist, rim or post is painted over a deck board`, over === 0, over ? `${over} — first: ${which}` : "");
    check(`${name}, turned ${yawDeg}°: the end joists are in the picture (the deck's sides are closed)`, faces.some((f) => f.layer === "joist"));
  }
}

console.log(bad ? `${bad} FAILED` : "ALL PASS");
process.exit(bad ? 1 : 0);
