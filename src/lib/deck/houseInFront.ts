// WHAT STANDS IN FRONT OF THE WALL (2026-11-13, owner, of a backyard photo with the old deck still on the house: "try
// to make it remove the deck, because instead of this deck we're going to build something new. But we need as accurate
// a takeoff as possible from the picture, the shape of the wall").
//
// The model was always told to look past an old deck, its stairs, a porch roof, a tree — and to say where each one is
// (houseRead `lookPast`). Nothing used the answer: the old deck's railing still stood in the rows the corner pass
// reads (every baluster an edge standing up), its boards and the shade under a porch roof were sampled as the wall's
// colour, the depth map measured the deck as a part of the wall that "comes out", and a door behind the railing was
// boxed down to the top rail and no further.
//
// Here, pure, is what the rest of the photo reader asks about those things:
//   · `inFrontAt` — is this point of the picture hidden by one of them? The corner pass, the eave pass, the colour
//     measure and the depth map read the wall only where it is not;
//   · `leftOut` / `leftOutWords` — what the review tells the contractor was left out of the house ("the old deck and
//     its stairs");
//   · `oldDeckOf` — the old deck, with the line of its floor: where the new deck's floor can go;
//   · `settleBehindDeck` — a door onto the old deck stands on its floor: one boxed only down to the railing is carried
//     down to that line, so it is a whole door again (its 80 in. is the picture's scale);
//   · `porchRoofOf` — a porch roof on posts, left out unless the contractor keeps it as an existing cover.

import type { HouseLookPast, HouseRead } from "./houseRead";

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** The things the review names as left out of the house, in the order they are said. */
export const LEFT_OUT_KINDS = ["old-deck", "stairs", "porch-roof", "awning"] as const;
export type LeftOutKind = (typeof LEFT_OUT_KINDS)[number];
const LEFT_OUT_WORD: Record<LeftOutKind, string> = { "old-deck": "the old deck", stairs: "its stairs", "porch-roof": "the porch roof", awning: "the awning" };
/** What a tag on the picture calls each. */
export const LEFT_OUT_TAG: Record<LeftOutKind, string> = { "old-deck": "Old deck", stairs: "Old stairs", "porch-roof": "Porch roof", awning: "Awning" };

const isLeftOut = (b: HouseLookPast): b is HouseLookPast & { kind: LeftOutKind } => (LEFT_OUT_KINDS as readonly string[]).includes(b.kind);

/** The things named to the contractor as left out: each with its place in the read's list (to take one back). */
export function leftOut(read: Pick<HouseRead, "lookPast">): Array<{ i: number; box: HouseLookPast & { kind: LeftOutKind } }> {
  return (read.lookPast ?? []).flatMap((box, i) => (isLeftOut(box) ? [{ i, box }] : []));
}

/** "the old deck and its stairs", "the porch roof" — null when nothing stood in front of the wall. */
export function leftOutWords(read: Pick<HouseRead, "lookPast">): string | null {
  const kinds = LEFT_OUT_KINDS.filter((k) => (read.lookPast ?? []).some((b) => b.kind === k));
  if (!kinds.length) return null;
  // stairs with no deck to belong to are "the old stairs"
  const words = kinds.map((k) => (k === "stairs" && !kinds.includes("old-deck") ? "the old stairs" : LEFT_OUT_WORD[k]));
  return words.length === 1 ? words[0] : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/** The read without one of the things in front of the wall (the contractor says it is not in the way). */
export function removeInFront(read: HouseRead, i: number): HouseRead {
  const rest = (read.lookPast ?? []).filter((_, k) => k !== i);
  const bare: HouseRead = { ...read };
  delete bare.lookPast;
  return rest.length ? { ...bare, lookPast: rest } : bare;
}

/**
 * Is the wall hidden at this point of the picture (fractions)? Inside the box of anything that stands in front of it.
 * `under`: the wall below a porch roof or an awning counts as hidden too, down to the picture's foot — its posts stand
 * there and the wall is in its shade (the corner pass and the colour measure ask this way; the depth map does not: the
 * wall under a porch roof is still the wall).
 */
export function inFrontAt(read: Pick<HouseRead, "lookPast">, opts: { under?: boolean } = {}): (fx: number, fy: number) => boolean {
  const boxes = (read.lookPast ?? [])
    // a slab lies on the ground at the wall's foot: nothing of the wall is behind it
    .filter((b) => b.kind !== "slab")
    .map((b) => ({ x0: b.x0, x1: b.x1, y0: b.y0, y1: opts.under && (b.kind === "porch-roof" || b.kind === "awning") ? 1 : b.y1 }));
  if (!boxes.length) return () => false;
  return (fx, fy) => boxes.some((b) => fx >= b.x0 && fx <= b.x1 && fy >= b.y0 && fy <= b.y1);
}

/** The old deck in the picture: the widest one the read holds, null when there is none. */
export function oldDeckOf(read: Pick<HouseRead, "lookPast">): HouseLookPast | null {
  const decks = (read.lookPast ?? []).filter((b) => b.kind === "old-deck");
  return decks.length ? decks.reduce((m, b) => (b.x1 - b.x0 > m.x1 - m.x0 ? b : m)) : null;
}

/** The porch roof in the picture: the widest, null when there is none. */
export function porchRoofOf(read: Pick<HouseRead, "lookPast">): HouseLookPast | null {
  const roofs = (read.lookPast ?? []).filter((b) => b.kind === "porch-roof");
  return roofs.length ? roofs.reduce((m, b) => (b.x1 - b.x0 > m.x1 - m.x0 ? b : m)) : null;
}

/**
 * THE DOORS BEHIND THE OLD DECK. A door that opens onto the old deck stands on its floor. Behind a railing the model
 * often boxes only what shows above the top rail — half a door, which then sets the picture's scale at double. Such a
 * door (not a garage door), its middle over the old deck, its foot above the deck's floor line by more than a twelfth
 * of its own height, is carried down to that line — but never to more than two and a quarter times its height (what a
 * railing can hide is about half a door; more than that and the box was something else). Back come the read and how
 * many doors moved.
 */
export function settleBehindDeck(read: HouseRead): { read: HouseRead; doors: number } {
  const decks = (read.lookPast ?? []).filter((b) => b.kind === "old-deck" && b.floor !== undefined);
  if (!decks.length || !read.doors.length) return { read, doors: 0 };
  let moved = 0;
  const settle = <T extends { x0: number; x1: number; bottom: number; top: number }>(d: T, garage: boolean): T => {
    if (garage) return d;
    const cx = (d.x0 + d.x1) / 2;
    const deck = decks.find((b) => cx >= b.x0 && cx <= b.x1);
    if (!deck) return d;
    const floor = deck.floor as number;
    const tall = d.bottom - d.top;
    if (!(tall > 0) || d.top >= floor) return d;
    const gap = floor - d.bottom;
    if (gap <= tall / 12 || (floor - d.top) / tall > 2.25) return d;
    moved++;
    return { ...d, bottom: r3(floor) };
  };
  const doors = read.doors.map((d) => settle(d, d.kind === "garage"));
  if (!moved) return { read, doors: 0 };
  // the back door is one of them: it moves with its own box
  const door = read.door ? (doors.find((d) => d.kind !== "garage" && Math.abs((d.x0 + d.x1) / 2 - (read.door!.x0 + read.door!.x1) / 2) < 0.02) ?? read.door) : null;
  return { read: { ...read, doors, door: door ? { x0: door.x0, x1: door.x1, bottom: door.bottom, top: door.top } : null }, doors: moved };
}
