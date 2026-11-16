// A DECK BOARD'S TONE GOES WITH ITS PLACE (2026-11-14) — pure.
//
// Owner, with the 3D on screen: "when moving the deck, reshaping and cutting the corners or anything, the decking on
// the 3D gets discoloured… keep the decking material steady in colour, and whatever you do in shape, do not discolour."
//
// Two things discoloured the floor:
//
//   1. THE SHADE WENT WITH THE BOARD'S NUMBER. Every board is laid a little lighter or darker than its neighbour (and a
//      blended composite somewhere between its two tones), "the same for the same piece every time" — but the piece was
//      named by its number in the scene's list, and that number changes whenever anything before it in the list does:
//      a joist more, a post moved, a corner cut. So every change to the deck dealt the whole floor a new hand of shades.
//      Here the shade is named by WHERE the board lies — which row out from the house, and which board of that row it
//      is — so a board that stays where it is keeps its shade while the deck is pulled wider, deeper, or cut.
//
//   2. A BOARD CUT AT AN ANGLE WAS DRAWN WITHOUT ITS GRAIN. Square boards are boxes that wear the wood-grain texture;
//      a board cut along a clipped corner, a bow or a mitre is a flat ring, and the rings were painted in the bare
//      colour — lighter and flatter than the boards beside them, a pale patch wherever the deck was cut. `ringPlace`
//      gives a ring the same texture coordinates a box has (the grain along the board, once over its length), and the
//      3D gives it the boards' own material.

/** A board's width is never taken as less than this, ft (a sliver's own narrow side is no row height). */
const LEAST_WIDE_FT = 0.2;

/**
 * Where a board lies: which way it runs (`turn`: 0 along the house, 1 out from it, another number for an angle), its
 * ROW (counted in half boards across the way it runs — two rows are never that close), where it STARTS along its row
 * (ft), and its level (a lower deck's boards are other boards).
 */
export interface BoardPlace {
  turn: number;
  row: number;
  startFt: number;
  /** Where it ends along its row, ft. */
  endFt: number;
  level: number;
  /** A board with a cut that is not square — drawn as a ring. The scene draws a board that crosses a cut corner in two pieces, a square one and a cut one (lib/deck/surface lessCorners): the two are ONE board. */
  cut: boolean;
}

/** A square board's place, from its box in the scene's feet: centre (cx, cy), size (sx along the house, sy out from it), height z. */
export function boxPlace(cx: number, cy: number, sx: number, sy: number, z = 0): BoardPlace {
  const alongHouse = sx >= sy;
  const wide = Math.max(LEAST_WIDE_FT, Math.min(sx, sy));
  return { turn: alongHouse ? 0 : 1, row: Math.round((alongHouse ? cy : cx) / (wide / 2)), startFt: alongHouse ? cx - sx / 2 : cy - sy / 2, endFt: alongHouse ? cx + sx / 2 : cy + sy / 2, level: Math.round(z), cut: false };
}

/**
 * A board cut to a shape — a flat ring [x0, y0, x1, y1, …] in the scene's feet: its place, told the same way a square
 * board's is (a cut board in a row of square ones is a board of that row), and its texture coordinates, one (u, v) per
 * corner — u along the board (its longest edge's way) from 0 at one end to 1 at the other, v across it — which is how
 * a box wears the grain.
 */
export function ringPlace(ring: readonly number[], z = 0): { place: BoardPlace; uv: number[] } {
  const n = Math.floor(ring.length / 2);
  if (n < 3) return { place: { turn: 0, row: 0, startFt: 0, endFt: 0, level: Math.round(z), cut: true }, uv: ring.map(() => 0) };
  // The board runs the way of its longest edge.
  let best = -1;
  let ux = 1;
  let uy = 0;
  for (let k = 0; k < n; k++) {
    const dx = ring[((k + 1) % n) * 2] - ring[k * 2];
    const dy = ring[((k + 1) % n) * 2 + 1] - ring[k * 2 + 1];
    const len = Math.hypot(dx, dy);
    if (len > best + 1e-9) {
      best = len;
      ux = dx / (len || 1);
      uy = dy / (len || 1);
    }
  }
  // (One way for a line and its reverse: toward +x, or straight out from the house.)
  if (ux < -1e-6 || (Math.abs(ux) <= 1e-6 && uy < 0)) {
    ux = -ux;
    uy = -uy;
  }
  // Across it: out from the house for a board along the house, along the house for one out from it — as a box's is.
  const out = Math.abs(ux) < 0.05;
  const vx = out ? 1 : -uy;
  const vy = out ? 0 : ux;
  let s0 = Infinity;
  let s1 = -Infinity;
  let t0 = Infinity;
  let t1 = -Infinity;
  for (let k = 0; k < n; k++) {
    const s = ring[k * 2] * ux + ring[k * 2 + 1] * uy;
    const t = ring[k * 2] * vx + ring[k * 2 + 1] * vy;
    s0 = Math.min(s0, s);
    s1 = Math.max(s1, s);
    t0 = Math.min(t0, t);
    t1 = Math.max(t1, t);
  }
  const long = Math.max(1e-6, s1 - s0);
  const across = Math.max(1e-6, t1 - t0);
  const uv: number[] = [];
  for (let k = 0; k < n; k++) {
    const s = ring[k * 2] * ux + ring[k * 2 + 1] * uy;
    const t = ring[k * 2] * vx + ring[k * 2 + 1] * vy;
    uv.push((s - s0) / long, (t - t0) / across);
  }
  const wide = Math.max(LEAST_WIDE_FT, across);
  // Which way it runs, to the nearest 6°: along the house 0, out from it 1 (as a square board), anything else its own.
  const turn = Math.abs(uy) < 0.05 ? 0 : out ? 1 : 2 + Math.round((Math.atan2(uy, ux) * 180) / Math.PI / 6);
  // Square in its own way (every edge along it or across it) is a plain board that happens to be drawn as a ring.
  let cut = n !== 4;
  for (let k = 0; k < n && !cut; k++) {
    const dx = ring[((k + 1) % n) * 2] - ring[k * 2];
    const dy = ring[((k + 1) % n) * 2 + 1] - ring[k * 2 + 1];
    const len = Math.hypot(dx, dy) || 1;
    const along = Math.abs((dx * ux + dy * uy) / len);
    if (along > 0.02 && along < 0.9998) cut = true;
  }
  return { place: { turn, row: Math.round((t0 + t1) / 2 / (wide / 2)), startFt: s0, endFt: s1, level: Math.round(z), cut }, uv };
}

/** Two pieces of a row that meet end to end within this, ft, touch. */
const TOUCH_FT = 0.03;

/**
 * THE SEED OF EACH BOARD'S SHADE, one per place given, in the order given: its row, and WHICH BOARD OF THAT ROW it is
 * (the first from the row's start, the second after the butt joint…) — not how far along the joint happens to fall.
 * So a row keeps its shades while the deck is pulled wider (the joint moves, the boards stay first and second), deeper
 * (the rows nearer the house stay where they are) or cut (a row's end board is still its end board, square or cut).
 *
 * ONE BOARD, ONE SHADE: a board that crosses a cut corner is drawn in two pieces, the square part and the cut part,
 * meeting end to end. A cut piece and the piece it meets are the same board — they take the same seed (two SQUARE
 * pieces meeting end to end are two boards at a butt joint).
 */
/**
 * A ROW'S OWN NUMBER (2026-11-15): the same for every board of one row — the pieces of a spliced row are one row of
 * the floor, and wear one tone, so a joint in it is a hairline and not the edge of a patch.
 */
export function placeRows(places: readonly BoardPlace[]): number[] {
  return places.map((p) => p.row * 131 + p.turn * 7919 + p.level * 53);
}

export function placeSeeds(places: readonly BoardPlace[]): number[] {
  const rows = new Map<string, number[]>();
  places.forEach((p, i) => {
    const key = `${p.turn}:${p.row}:${p.level}`;
    const list = rows.get(key);
    if (list) list.push(i);
    else rows.set(key, [i]);
  });
  const seeds = new Array<number>(places.length).fill(0);
  for (const list of rows.values()) {
    list.sort((a, b) => places[a].startFt - places[b].startFt || a - b);
    let nth = -1;
    let prev: BoardPlace | null = null;
    for (const i of list) {
      const p = places[i];
      const sameBoard = !!prev && (prev.cut || p.cut) && Math.abs(p.startFt - prev.endFt) <= TOUCH_FT;
      if (!sameBoard) nth++;
      seeds[i] = p.row * 131 + nth * 17 + p.turn * 7919 + p.level * 53;
      prev = p;
    }
  }
  return seeds;
}
