// THE DECK'S EDGES AS RUNS OF POINTS, AND ITS BOW (2026-11-15) — pure.
//
// The owner, of a deck with a bowed front: "I click on the radius — make me a toggle to move out and move in, to make
// a bigger radius or a smaller radius… and choose which side I want the radius on… And if the stairs attach to the
// radius deck, make sure they attach right."
//
// `sideChain` hands each side's edge back as the outline draws it (a bow is a run of short straight pieces; a corner
// cut at an angle is one piece) — what a stair is seated on (lib/deck/edgeSeat).

import { DECK_LIMITS, frontEdgeAt, shapeOutline, type DeckDesign, type DeckShape } from "./design";
import { chainOf, type SeatPoint } from "./edgeSeat";

/* ------------------------------------------------------------------ */
/*  The bow, side by side                                              */
/* ------------------------------------------------------------------ */

/** A side of the deck that can bow out. */
export type BowSide = "front";
export const BOW_SIDES: readonly BowSide[] = ["front"];
export const BOW_SIDE_LABEL: Record<BowSide, string> = { front: "Front" };
/** One press of "bow out more / less", and what a pull by hand snaps to: 3 in. */
export const BOW_STEP_FT = 0.25;

const isBowSide = (v: string): v is BowSide => (BOW_SIDES as readonly string[]).includes(v);

/** How far a side bows out at its middle, ft — 0 where it is straight. */
export function bowOf(shape: DeckShape, side: BowSide): number {
  if (shape.kind !== "rect" || shape.front?.kind !== "curve") return 0;
  return side === "front" ? shape.front.bulgeFt : 0;
}

/** The side's own length between its two corners, ft: what the bow is drawn across. */
export function bowChordFt(shape: DeckShape, side: BowSide): number {
  void side;
  return shape.widthFt;
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

/** "a 17-ft radius" — how a builder says the bow. */
export function bowRadiusWords(shape: DeckShape, side: BowSide): string {
  const r = bowRadiusFt(bowChordFt(shape, side), bowOf(shape, side));
  return Number.isFinite(r) ? `${r % 1 === 0 ? r : r.toFixed(1)}-ft radius` : "";
}

/** The shape with one side bowed `ft` at its middle (inside its limits, to the inch); null where the shape takes no bow. */
export function withBow(shape: DeckShape, side: BowSide, ft: number): DeckShape | null {
  if (shape.kind !== "rect" || !Number.isFinite(ft)) return null;
  const { min, max } = bowLimits(shape, side);
  const v = Math.round(Math.max(min, Math.min(max, ft)) * 12) / 12;
  const front = shape.front ?? { kind: "curve" as const, bulgeFt: 2, clipFt: 2 };
  return { kind: "rect", widthFt: shape.widthFt, depthFt: shape.depthFt, front: { ...front, kind: "curve", bulgeFt: v } };
}

/**
 * A bow pulled by hand (the knob on the arc in the 3D, the handle on the top view) or stepped by a button: the side's
 * bow set to `ft`, snapped to 3 in. Null where nothing changes.
 */
export function bowPatch(design: Pick<DeckDesign, "shape">, side: string, ft: number): { shape: DeckShape } | null {
  if (!isBowSide(side)) return null;
  const next = withBow(design.shape, side, Math.round(ft / BOW_STEP_FT) * BOW_STEP_FT);
  if (!next || bowOf(next, side) === bowOf(design.shape, side)) return null;
  return { shape: next };
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
