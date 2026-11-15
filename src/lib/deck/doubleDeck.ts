// A DOUBLE DECK SHAPED LEVEL BY LEVEL (2026-11-14). Pure.
//
// Owner, of a double deck in the Deck Studio: "when it's a double deck and I need to reshape the upper deck, then on
// the drawing show lower / upper to reshape it and adjust it. Because for now, when I reshape it from the map, it's
// reshaping the lower, but we need to do the same thing with the upper." Until now the lower floor of a double deck
// was the main deck's own outline, under it: one drawing shaped both.
//
// Now the wall-and-deck drawing has an Upper / Lower switch. The upper deck is the design's own shape; the lower
// floor keeps the upper's outline until it is shaped on its own — then it has its own outline (`lower.shape`) and its
// own place along the house (`lower.offsetFt`, from the upper deck's left end). Here:
//   · lowerFloor — the lower floor's outline and place;
//   · houseForLower — the house as the drawing shows it under the lower floor (the same house, in the lower's feet);
//   · lowerWallChange / upperWallChange — what a drag on the drawing does to the design in each mode: the house stays
//     where it is in the world unless its own end or wall was dragged; a lower floor of its own stays where it is when
//     the upper deck is slid or its left end moved;
//   · lowerSharing — how a lower floor of its own is framed under the upper: its beams on the upper deck's beam lines
//     wherever they pass over it, sitting in seats let into the upper's posts where those stand inside it (no post or
//     footing of its own there), and its own beams and posts beyond.

import { shapeOutline, type DeckBeamLine, type DeckDesign, type DeckPostPin, type DeckShape } from "./design";
import { shiftHouseThings, type HouseDesign } from "./house";
import type { DeckFrame } from "./frame";
import type { DeckPatch } from "./checks";

const half = (n: number) => Math.round(n * 2) / 2;
const inch = (n: number) => Math.round(n * 12) / 12;

export interface LowerFloor {
  shape: DeckShape;
  /** Its left end along the house, ft from the upper deck's left end. */
  offsetFt: number;
  /** Shaped on its own (else the upper's outline, under it). */
  own: boolean;
}

/** The lower floor of a double deck: its own outline and place, or the upper's. */
export function lowerFloor(design: Pick<DeckDesign, "shape" | "lower">): LowerFloor {
  const l = design.lower;
  if (l.place === "under" && l.shape) return { shape: l.shape, offsetFt: l.offsetFt ?? 0, own: true };
  return { shape: design.shape, offsetFt: 0, own: false };
}

/** The house in the lower floor's own feet: the same wall, its reach past the lower floor's ends, its steps and openings counted from the lower floor's left end. */
export function houseForLower(house: HouseDesign, upperWidthFt: number, lower: Pick<LowerFloor, "shape" | "offsetFt">): HouseDesign {
  const d = lower.offsetFt;
  if (d === 0 && lower.shape.widthFt === upperWidthFt) return house;
  return {
    ...house,
    leftFt: half(house.leftFt + d),
    rightFt: half(house.rightFt + upperWidthFt - d - lower.shape.widthFt),
    jogs: house.jogs.map((j) => ({ ...j, atFt: half(j.atFt - d) })),
    ...shiftHouseThings(house, -d),
  };
}

/** The house back in the upper deck's feet, from the lower floor's (the inverse of houseForLower at that place). */
function houseFromLower(houseL: HouseDesign, upperWidthFt: number, lower: Pick<LowerFloor, "shape" | "offsetFt">): HouseDesign {
  const d = lower.offsetFt;
  return {
    ...houseL,
    leftFt: half(houseL.leftFt - d),
    rightFt: half(houseL.rightFt - upperWidthFt + d + lower.shape.widthFt),
    jogs: houseL.jogs.map((j) => ({ ...j, atFt: half(j.atFt + d) })),
    ...shiftHouseThings(houseL, d),
  };
}

/** How long the wall is, end to end, past a deck of this width: unchanged = the house stayed where it was. */
const wallLength = (house: HouseDesign, widthFt: number) => house.leftFt + widthFt + house.rightFt;

/**
 * A drag on the drawing in LOWER mode, as a patch: the lower floor's outline, and — when the house stayed where it
 * was in the world (the wall as long as before) but the lower floor's left end moved along it — its new place; the
 * house itself changes only when its own end or wall was dragged.
 */
export function lowerWallChange(design: DeckDesign, change: { shape?: DeckShape; house?: HouseDesign }): DeckPatch {
  const lf = lowerFloor(design);
  const W = design.shape.widthFt;
  const shapeL = change.shape ?? lf.shape;
  const houseL0 = houseForLower(design.house, W, lf);
  const houseL = change.house ?? houseL0;
  const stayed = Math.abs(wallLength(houseL, shapeL.widthFt) - wallLength(houseL0, lf.shape.widthFt)) < 0.01;
  const offsetFt = stayed ? half(lf.offsetFt + (houseL.leftFt - houseL0.leftFt)) : lf.offsetFt;
  const patch: DeckPatch = { lower: { ...design.lower, shape: shapeL, offsetFt } };
  if (change.house && !stayed) patch.house = houseFromLower(houseL, W, { shape: shapeL, offsetFt });
  else if (change.house) {
    // The wall's own steps or openings edited with the deck where it was: carried back to the upper deck's feet.
    const back = houseFromLower(houseL, W, { shape: shapeL, offsetFt });
    if (JSON.stringify(back) !== JSON.stringify(design.house)) patch.house = back;
  }
  return patch;
}

/**
 * A drag on the drawing in UPPER mode, as a patch: the upper deck's shape and the house as the drawing gave them —
 * and a lower floor of its own kept where it is in the world when the upper deck was slid along the house or its
 * left end moved (the house as long as before, its left reach changed).
 */
export function upperWallChange(design: DeckDesign, change: { shape?: DeckShape; house?: HouseDesign }): DeckPatch {
  const patch: DeckPatch = { ...(change.shape ? { shape: change.shape } : {}), ...(change.house ? { house: change.house } : {}) };
  const lf = lowerFloor(design);
  if (!lf.own || !change.house) return patch;
  const W1 = (change.shape ?? design.shape).widthFt;
  const stayed = Math.abs(wallLength(change.house, W1) - wallLength(design.house, design.shape.widthFt)) < 0.01;
  const moved = change.house.leftFt - design.house.leftFt;
  if (stayed && moved !== 0) patch.lower = { ...design.lower, offsetFt: half(lf.offsetFt - moved) };
  return patch;
}

/** Inside a polygon (a deck's outline, inches). */
function inside(poly: Array<{ x: number; y: number }>, x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}
/** How far a point is inside a polygon from its nearest edge, inches (0 outside). */
function depthInside(poly: Array<{ x: number; y: number }>, x: number, y: number): number {
  if (!inside(poly, x, y)) return 0;
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j], b = poly[i];
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / Math.max(1e-9, dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy)));
  }
  return best;
}

/** Room a shared beam line needs from the lower floor's own edges, inches: a foot from its front (its own front beam stands there), two from the house. */
export const SHARE_CLEAR_IN = { front: 12, house: 24 } as const;

export interface LowerSharing {
  /** The upper deck's beam lines that pass over the lower floor, as its own middle beams (design.framing.beamLines). */
  beamLines: DeckBeamLine[];
  /** The upper deck's posts on those lines that stand inside the lower floor, as posts set under them (design.framing.pins). */
  pins: DeckPostPin[];
  /** …the same posts, in the lower floor's inches: its beams sit in seats let into them (frame option seatOn). */
  seatOn: Array<{ x: number; y: number }>;
}

/** How a lower floor of its own is framed under the upper deck (see the head of the file). */
export function lowerSharing(upper: DeckFrame, lower: Pick<LowerFloor, "shape" | "offsetFt">): LowerSharing {
  const ox = Math.round(lower.offsetFt * 12);
  const poly = shapeOutline(lower.shape);
  const out: LowerSharing = { beamLines: [], pins: [], seatOn: [] };
  const used = new Set<number>();
  upper.beams
    .filter((b) => b.role !== "back")
    .sort((a, b) => a.y - b.y)
    .forEach((b) => {
      if (b.y < SHARE_CLEAR_IN.house) return;
      const y = Math.round(b.y);
      // posts of this beam standing well inside the lower floor (clear of its front and sides)
      const posts = b.postXs.map((x) => x - ox).filter((x) => depthInside(poly, x, y) >= SHARE_CLEAR_IN.front);
      if (!posts.length || [...used].some((u) => Math.abs(u - y) < 12)) return;
      used.add(y);
      const id = `u${out.beamLines.length + 1}`;
      out.beamLines.push({ id, atFt: inch(y / 12), zones: [] });
      posts.forEach((x, k) => {
        out.pins.push({ id: `${id}p${k + 1}`, beam: "middle", atFt: inch(x / 12), line: id });
        out.seatOn.push({ x, y });
      });
    });
  return out;
}

/** The lower floor in words, for the studio and the permit: "its own outline, 20 ft × 14 ft, 2 ft to the right of the upper deck's left end". */
export function lowerFloorWords(lf: LowerFloor): string {
  if (!lf.own) return "the upper deck's own outline, under it";
  const at = lf.offsetFt === 0 ? "its left end under the upper deck's" : `${Math.abs(lf.offsetFt)} ft ${lf.offsetFt > 0 ? "right" : "left"} of the upper deck's left end`;
  return `its own outline, ${lf.shape.widthFt} ft × ${lf.shape.depthFt} ft, ${at}`;
}
