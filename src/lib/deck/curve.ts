// THE DECK'S EDGES AS RUNS OF POINTS, AND ITS BOW (2026-11-15) — pure.
//
// The owner, of a deck with a bowed front: "I click on the radius — make me a toggle to move out and move in, to make
// a bigger radius or a smaller radius… and choose which side I want the radius on… And if the stairs attach to the
// radius deck, make sure they attach right."
//
// `sideChain` hands each side's edge back as the outline draws it (a bow is a run of short straight pieces; a corner
// cut at an angle is one piece) — what a stair is seated on (lib/deck/edgeSeat).

import { BOW_SIDES, DECK_LIMITS, frontEdgeAt, shapeBows, shapeOutline, sideBowAt, type BowSide, type DeckDesign, type DeckShape, type FrontProfile } from "./design";
import { chainOf, type SeatPoint } from "./edgeSeat";

/* ------------------------------------------------------------------ */
/*  The bow, side by side                                              */
/* ------------------------------------------------------------------ */

export { BOW_SIDES, type BowSide };
export const BOW_SIDE_LABEL: Record<BowSide, string> = { front: "Front", left: "Left side", right: "Right side", back: "Back" };
/** "the front", "the left side" — a side as a sentence names it. */
export const BOW_SIDE_WORDS: Record<BowSide, string> = { front: "the front", left: "the left side", right: "the right side", back: "the back" };
/** One press of "bow out more / less", and what a pull by hand snaps to: 3 in. */
export const BOW_STEP_FT = 0.25;
/** What a side starts with when it is first bowed, ft (no deeper than its own most). */
export const BOW_START_FT = 2;

const isBowSide = (v: string): v is BowSide => (BOW_SIDES as readonly string[]).includes(v);

/** How far a side bows out at its middle, ft — 0 where it is straight. */
export function bowOf(shape: DeckShape, side: BowSide): number {
  return shapeBows(shape)[side];
}

/** The sides that bow, in order round the deck. */
export function bowedSides(shape: DeckShape): BowSide[] {
  return BOW_SIDES.filter((side) => bowOf(shape, side) > 0);
}

/** The sides this deck can bow: the front and both sides of a rectangle; its back too where it stands free of the house. */
export function bowSidesFor(design: Pick<DeckDesign, "shape" | "placement">): BowSide[] {
  if (design.shape.kind !== "rect") return [];
  return BOW_SIDES.filter((side) => side !== "back" || design.placement === "detached");
}

/** The side's own length between its two corners, ft: what the bow is drawn across. */
export function bowChordFt(shape: DeckShape, side: BowSide): number {
  return side === "front" || side === "back" ? shape.widthFt : shape.depthFt;
}

/** The least and the most a side may bow, ft: no deeper than a third of its length (an arc a crew can bend). */
export function bowLimits(shape: DeckShape, side: BowSide): { min: number; max: number } {
  const max = Math.floor(Math.min(DECK_LIMITS.bulgeFt.max, bowChordFt(shape, side) / 3) * 12) / 12;
  return { min: Math.min(DECK_LIMITS.bulgeFt.min, max), max };
}

/** The radius of an arc across `chordFt` that rises `bowFt` at its middle, ft (to a tenth). */
export function bowRadiusFt(chordFt: number, bowFt: number): number {
  if (!(bowFt > 0)) return Infinity;
  const half = chordFt / 2;
  return Math.round(((half * half) / (2 * bowFt) + bowFt / 2) * 10) / 10;
}

/** "17-ft radius" — how a builder says the bow. */
export function bowRadiusWords(shape: DeckShape, side: BowSide): string {
  const r = bowRadiusFt(bowChordFt(shape, side), bowOf(shape, side));
  return Number.isFinite(r) ? `${r % 1 === 0 ? r : r.toFixed(1)}-ft radius` : "";
}

/**
 * The shape with one side bowed `ft` at its middle (inside its limits, to the inch) — or straight again at 0. The
 * other sides keep what they have; with no side left bowed the deck is a plain rectangle. Null where the shape takes
 * no bow (an L, a deck in parts).
 */
export function withBow(shape: DeckShape, side: BowSide, ft: number): DeckShape | null {
  if (shape.kind !== "rect" || !Number.isFinite(ft)) return null;
  const { min, max } = bowLimits(shape, side);
  const v = ft > 0 && max >= DECK_LIMITS.bulgeFt.min ? Math.round(Math.max(min, Math.min(max, ft)) * 12) / 12 : 0;
  const bows = { ...shapeBows(shape), [side]: v };
  const base = { kind: "rect" as const, widthFt: shape.widthFt, depthFt: shape.depthFt };
  if (!BOW_SIDES.some((b) => bows[b] > 0)) return base;
  const front: FrontProfile = { kind: "curve", bulgeFt: bows.front, clipFt: shape.front?.clipFt ?? 2, ...(bows.left ? { leftFt: bows.left } : {}), ...(bows.right ? { rightFt: bows.right } : {}), ...(bows.back ? { backFt: bows.back } : {}) };
  return { ...base, front };
}

/**
 * A bow pulled by hand (the knob on the arc in the 3D, the handle on the top view) or stepped by a button: the side's
 * bow set to `ft`, snapped to 3 in. — never straight (a side is straightened by its own switch). Null where nothing
 * changes, and for a back that is against the house.
 */
export function bowPatch(design: Pick<DeckDesign, "shape"> & Partial<Pick<DeckDesign, "placement">>, side: string, ft: number): { shape: DeckShape } | null {
  if (!isBowSide(side) || (side === "back" && design.placement !== undefined && design.placement !== "detached")) return null;
  const { min } = bowLimits(design.shape, side);
  const next = withBow(design.shape, side, Math.max(min, Math.round(ft / BOW_STEP_FT) * BOW_STEP_FT));
  if (!next || bowOf(next, side) === bowOf(design.shape, side)) return null;
  return { shape: next };
}

/** A side bowed (at what it had, or 2 ft) or made straight again — the side's own switch. Null where the shape takes no bow. */
export function toggleBow(shape: DeckShape, side: BowSide, on: boolean): DeckShape | null {
  if (!on) return withBow(shape, side, 0);
  return bowOf(shape, side) > 0 ? shape : withBow(shape, side, Math.min(BOW_START_FT, bowLimits(shape, side).max));
}

/** "the front and the left side", "every side" — the sides that bow, as a sentence names them ("" when none does). */
export function bowedWords(shape: DeckShape): string {
  const on = bowedSides(shape);
  if (!on.length) return "";
  if (on.length === 4) return "every side";
  if (on.length === 3 && !on.includes("back")) return "the front and both sides";
  if (on.length === 2 && on.includes("left") && on.includes("right")) return "both sides";
  const words = on.map((b) => BOW_SIDE_WORDS[b]);
  return words.length === 1 ? words[0] : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/** Where a side's bow stands farthest out — its arc's middle — plan inches. */
export function bowApex(shape: DeckShape, side: BowSide): SeatPoint {
  const W = Math.round(shape.widthFt * 12);
  const D = Math.round(shape.depthFt * 12);
  const s = bowOf(shape, side) * 12;
  return side === "front" ? { x: W / 2, y: D + s } : side === "back" ? { x: W / 2, y: -s } : side === "left" ? { x: -s, y: D / 2 } : { x: W + s, y: D / 2 };
}

/* ------------------------------------------------------------------ */
/*  The edges                                                          */
/* ------------------------------------------------------------------ */

/** The deck's front edge as the outline draws it, from its left end to its right, plan inches. */
export function frontChain(shape: DeckShape): SeatPoint[] {
  const W = Math.round(shape.widthFt * 12);
  const at = (x: number) => frontEdgeAt(shape, Math.max(0, Math.min(W, x)));
  const run = chainOf(shapeOutline(shape), (p) => Math.abs(p.y - at(p.x - 0.02)) < 0.5 || Math.abs(p.y - at(p.x + 0.02)) < 0.5);
  return run.length >= 2 && run[0].x > run[run.length - 1].x ? run.reverse() : run;
}

/**
 * A side's edge as the outline draws it, from the house out, plan inches — the left or the right side of a rectangle
 * (bowed: its arc's own pieces). Empty for any other shape: those stairs keep their old set-out.
 */
export function sideChain(shape: DeckShape, side: "left" | "right"): SeatPoint[] {
  if (shape.kind !== "rect") return [];
  const W = Math.round(shape.widthFt * 12);
  const D = Math.round(shape.depthFt * 12);
  const on = (p: SeatPoint) => p.y > -0.01 && p.y < D + 0.01 && Math.abs(side === "left" ? p.x + sideBowAt(shape, "left", p.y) : p.x - W - sideBowAt(shape, "right", p.y)) < 0.5 && (side === "left" ? p.x < 0.01 : p.x > W - 0.01);
  const run = chainOf(shapeOutline(shape), on);
  // (A clipped front shortens the side: it ends where the cut begins.)
  return run.length >= 2 && run[0].y > run[run.length - 1].y ? run.reverse() : run;
}

/**
 * The bows in a line of a scope of work: "the front bowed out 2 ft" — or, with more sides, "the front bowed out 2 ft,
 * the left side 2 ft and the right side 1.5 ft". "" where nothing bows.
 */
export function bowsLine(shape: DeckShape): string {
  const on = bowedSides(shape);
  if (!on.length) return "";
  const parts = on.map((side, i) => `${BOW_SIDE_WORDS[side]}${i === 0 ? " bowed out" : ""} ${bowOf(shape, side)} ft`);
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}
