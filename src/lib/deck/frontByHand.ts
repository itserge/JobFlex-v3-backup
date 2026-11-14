// THE DECK'S FRONT AND SIDES, SHAPED BY HAND ON THE PLAN (2026-11-14) — pure.
//
// Owner, on the House step's drawing from above: "make the front and the sides of the deck reshape with the toggles in
// and out like the back wall works — so I can adjust the deck and shape it the way I want it from the sides, from the
// front, and move it any shape I want. And make it smart."
//
// The back wall is shaped by dragging it in or out anywhere (lib/deck/house pullSectionAt): a section of it comes with
// the hand right where it was grabbed. This is the same for the deck's own edges. The deck's front was already set
// part by part (design FrontPart — a bay, a T, a U, steps down a side, corners cut at an angle), but only in a list;
// every move here ends on that same front, made buildable by the same rules (design partsShape), so whatever the hand
// draws is a deck the frame, the boards, the rail and the price already know:
//
//   pullFrontAt     the front edge pulled out or pushed in where it was grabbed: a section comes with the hand — a bay,
//                   or a notch — run on to the part's end when grabbed near it;
//   moveFrontPart   one part of the front, in or out as one piece;
//   moveFrontStep   a step in the front — the side of a bay — moved along the deck;
//   cutSideAt       a SIDE of the deck pushed in where it was grabbed: from there to the front the deck stops short,
//                   the corner comes off square (the stretch of side by the house stays, hung on the wall);
//   resizeFrontEnd  the deck's end moved: the END part takes the change, the other parts stay where they are;
//   clipFrontCorner a corner that stands out, cut at an angle or made square again;
//   levelFrontPart  a part brought to the line of the part beside it; removeFrontStep, the step between two parts;
//   straightFront   one straight front again.
//
// Every move is worked from the shape it is given — a drag calls it with the shape the drag BEGAN on and how far the
// hand has gone since, so nothing drifts and a hand brought back leaves the deck as it was.

import { DECK_LIMITS, FRONT_LIMITS, frontParts, partsShape, shapeWithFront, type DeckShape } from "./design";
import { resizeDeckLeft, type HouseDesign } from "./house";

/** One part of the front as the studio's list says it: how wide, how far out from the house, its corners' cuts. */
export interface FrontSpec {
  widthFt: number;
  yFt: number;
  clipLeftFt?: number;
  clipRightFt?: number;
}

/** Why a move could not be made: the front is in as many parts as it takes; no room there; the deck's corner is cut at the BACK (an L), which a front in parts cannot keep. */
export type FrontWhy = "parts" | "room" | "back-notch";

/** A pulled section is this wide at most; an edge within `snapFt` of the part's end runs on to it; a side grabbed within `byHouseFt` of the house moves the whole end; a corner cut off square is at least `notchFt` each way. */
export const FRONT_HAND = { sectionFt: 8, snapFt: 2.5, byHouseFt: 3, notchFt: 2, stepFt: 0.5 } as const;

const half = (n: number) => Math.round(n * 2) / 2;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const ftWords = (n: number) => {
  const inches = Math.round(n * 12);
  return inches % 12 ? `${Math.floor(inches / 12)} ft ${inches % 12} in.` : `${inches / 12} ft`;
};

/** A front in parts cannot keep a corner cut at the back (an L against the house): that deck is shaped in step 2. */
export const canShapeFront = (shape: DeckShape): boolean => !(shape.kind === "L" && shape.notch.corner.startsWith("back"));

/** The front as the list of its parts — a rectangle's two clipped corners carried as its one part's cuts. */
export function frontSpecs(shape: DeckShape): FrontSpec[] {
  const parts = frontParts(shape);
  const rectClip = shape.kind === "rect" && shape.front?.kind === "clipped" ? shape.front.clipFt : 0;
  return parts.map((q, i) => {
    const cl = q.clipLeftFt ?? (rectClip && i === 0 ? rectClip : 0);
    const cr = q.clipRightFt ?? (rectClip && i === parts.length - 1 ? rectClip : 0);
    return { widthFt: q.x1Ft - q.x0Ft, yFt: q.yFt, ...(cl ? { clipLeftFt: cl } : {}), ...(cr ? { clipRightFt: cr } : {}) };
  });
}

/** The deck with that front, made buildable (design partsShape): a front all on one line with square corners is a plain deck again. */
export function shapeFromSpecs(shape: DeckShape, specs: readonly FrontSpec[]): DeckShape {
  const raw = shapeWithFront(shape, specs);
  return raw.kind === "wall" ? partsShape(raw.widthFt, raw.depthFt, raw.back, raw.front) : raw;
}

/** Where each part starts, ft from the deck's left end. */
const startsOf = (specs: readonly FrontSpec[]) => {
  const xs: number[] = [];
  let x = 0;
  for (const q of specs) {
    xs.push(x);
    x += q.widthFt;
  }
  return xs;
};
const cuts = (q: FrontSpec, left: boolean, right: boolean): Pick<FrontSpec, "clipLeftFt" | "clipRightFt"> => ({ ...(left && q.clipLeftFt ? { clipLeftFt: q.clipLeftFt } : {}), ...(right && q.clipRightFt ? { clipRightFt: q.clipRightFt } : {}) });

/**
 * THE FRONT PULLED OUT (+) OR PUSHED IN (−) RIGHT WHERE IT WAS GRABBED. On the part under `xFt`: a section half the
 * part wide (2 to 8 ft) centred on the hand comes `byFt` out of the part's line; an edge of it within 2½ ft of the
 * part's end runs on to that end (no sliver of front left beside it) — so a short part moves whole, and one grabbed
 * near its end steps there. Back to nothing, the front is as it was. `span` is the stretch that moved.
 */
export function pullFrontAt(shape: DeckShape, xFt: number, byFt: number): { shape: DeckShape; span: { x0Ft: number; x1Ft: number } } | { why: FrontWhy } {
  if (!canShapeFront(shape)) return { why: "back-notch" };
  const specs = frontSpecs(shape);
  const xs = startsOf(specs);
  let i = specs.findIndex((q, k) => xFt <= xs[k] + q.widthFt + 1e-6);
  if (i < 0) i = specs.length - 1;
  const p = specs[i];
  const x0 = xs[i];
  const x1 = x0 + p.widthFt;
  const by = half(byFt);
  if (Math.abs(by) < FRONT_HAND.stepFt) return { shape, span: { x0Ft: x0, x1Ft: x1 } };
  const w = clamp(half(p.widthFt / 2), FRONT_LIMITS.partFt, FRONT_HAND.sectionFt);
  const x = clamp(xFt, x0, x1);
  let a = half(x - w / 2);
  let b = half(x + w / 2);
  if (a < x0) [a, b] = [x0, b + (x0 - a)];
  if (b > x1) [a, b] = [a - (b - x1), x1];
  a = Math.max(a, x0);
  if (a - x0 < FRONT_HAND.snapFt) a = x0;
  if (x1 - b < FRONT_HAND.snapFt) b = x1;
  const more = (a > x0 ? 1 : 0) + (b < x1 ? 1 : 0);
  if (specs.length + more > FRONT_LIMITS.parts) return { why: "parts" };
  const y = Math.min(DECK_LIMITS.depthFt.max, p.yFt + by);
  const next: FrontSpec[] = [
    ...specs.slice(0, i),
    ...(a > x0 ? [{ widthFt: a - x0, yFt: p.yFt, ...cuts(p, true, false) }] : []),
    { widthFt: b - a, yFt: y, ...cuts(p, a === x0, b === x1) },
    ...(b < x1 ? [{ widthFt: x1 - b, yFt: p.yFt, ...cuts(p, false, true) }] : []),
    ...specs.slice(i + 1),
  ];
  return { shape: shapeFromSpecs(shape, next), span: { x0Ft: a, x1Ft: b } };
}

/** One part of the front moved `byFt` out (+) or in (−) as one piece. A front that is one straight line is the deck's depth. */
export function moveFrontPart(shape: DeckShape, index: number, byFt: number): DeckShape {
  const by = half(byFt);
  if (Math.abs(by) < FRONT_HAND.stepFt) return shape;
  const specs = frontSpecs(shape);
  if (specs.length < 2 && !(shape.kind === "wall" && shape.front)) {
    const depthFt = clamp(half(shape.depthFt + by), DECK_LIMITS.depthFt.min, DECK_LIMITS.depthFt.max);
    return depthFt === shape.depthFt ? shape : { ...shape, depthFt };
  }
  if (!canShapeFront(shape) || !specs[index]) return shape;
  const next = specs.map((q, k) => (k === index ? { ...q, yFt: Math.min(DECK_LIMITS.depthFt.max, q.yFt + by) } : q));
  return shapeFromSpecs(shape, next);
}

/** The step between part `index` and the next moved to `toXFt` along the deck: one part wider, the other narrower, each 2 ft at least. */
export function moveFrontStep(shape: DeckShape, index: number, toXFt: number): DeckShape {
  if (!canShapeFront(shape)) return shape;
  const specs = frontSpecs(shape);
  if (index < 0 || index >= specs.length - 1) return shape;
  const x0 = startsOf(specs)[index];
  const both = specs[index].widthFt + specs[index + 1].widthFt;
  const lo = x0 + FRONT_LIMITS.partFt;
  const hi = x0 + both - FRONT_LIMITS.partFt;
  if (lo > hi) return shape;
  const x = clamp(half(toXFt), lo, hi);
  if (Math.abs(x - (x0 + specs[index].widthFt)) < 1 / 24) return shape;
  const next = specs.map((q, k) => (k === index ? { ...q, widthFt: x - x0 } : k === index + 1 ? { ...q, widthFt: x0 + both - x } : q));
  return shapeFromSpecs(shape, next);
}

/**
 * A SIDE OF THE DECK PUSHED IN where it was grabbed, `yFt` out from the house: from there to the front the deck stops
 * `inFt` short of its end — the corner comes off square, and the stretch of side by the house stays (it hangs on the
 * wall). A cut is 2 ft wide at least and leaves 2 ft of the end part beside it, or takes that whole part (its front
 * then stands where the hand was); it starts at least 2 ft behind the part's own front. Nothing under a foot.
 */
export function cutSideAt(shape: DeckShape, side: "left" | "right", yFt: number, inFt: number): { shape: DeckShape } | { why: FrontWhy } {
  if (!canShapeFront(shape)) return { why: "back-notch" };
  const specs = frontSpecs(shape);
  const n = specs.length;
  const e = side === "left" ? 0 : n - 1;
  const p = specs[e];
  const inn = half(inFt);
  if (inn < 1) return { shape };
  const y = Math.min(half(yFt), p.yFt - FRONT_HAND.notchFt);
  if (y < DECK_LIMITS.legFt.min) return { why: "room" };
  let w = Math.max(inn, FRONT_LIMITS.partFt);
  if (p.widthFt - w < FRONT_LIMITS.partFt) w = n > 1 ? p.widthFt : p.widthFt - FRONT_LIMITS.partFt;
  if (w < FRONT_LIMITS.partFt) return { why: "room" };
  let next: FrontSpec[];
  if (w >= p.widthFt - 1 / 24) next = specs.map((q, k) => (k === e ? { widthFt: q.widthFt, yFt: y } : q));
  else {
    if (n + 1 > FRONT_LIMITS.parts) return { why: "parts" };
    const cut: FrontSpec = { widthFt: w, yFt: y };
    const rest: FrontSpec = { widthFt: p.widthFt - w, yFt: p.yFt, ...cuts(p, side === "right", side === "left") };
    next = side === "left" ? [cut, rest, ...specs.slice(1)] : [...specs.slice(0, -1), rest, cut];
  }
  return { shape: shapeFromSpecs(shape, next) };
}

/**
 * The deck made `newWidthFt` wide by moving ONE end: the part at that end takes the change and every other part stays
 * where it is (a plain width change moves the right end only — pulled from the left, a front in parts slid along the
 * deck). An end part narrowed under 2 ft goes with the part beside it. A deck with one straight front just changes
 * its width.
 */
export function resizeFrontEnd(shape: DeckShape, side: "left" | "right", newWidthFt: number): DeckShape {
  const widthFt = clamp(half(newWidthFt), DECK_LIMITS.widthFt.min, DECK_LIMITS.widthFt.max);
  if (widthFt === shape.widthFt) return shape;
  if (!(shape.kind === "wall" && shape.front)) return { ...shape, widthFt };
  const specs = frontSpecs(shape);
  let by = widthFt - shape.widthFt;
  const list = side === "left" ? specs.slice() : specs.slice().reverse();
  while (list.length) {
    const first = list[0];
    if (first.widthFt + by >= FRONT_LIMITS.partFt || list.length === 1) {
      list[0] = { ...first, widthFt: Math.max(FRONT_LIMITS.partFt, first.widthFt + by) };
      break;
    }
    // The end part is used up: what is left of it goes with the part beside it, at that part's line.
    by += first.widthFt;
    list.shift();
  }
  return shapeFromSpecs(shape, side === "left" ? list : list.reverse());
}

/**
 * THE DECK'S LEFT END MOVED so the deck is `widthFt` wide — the 3D's left Width knob (owner, 2026-11-14: "on the 3D
 * there is no toggle on the left side that moves the left side of the deck"), the plan's left handle: the house stays
 * where it is (lib/deck/house resizeDeckLeft), and the left part of a front in parts takes the change. Null when
 * nothing changes.
 */
export function leftEndPatch(design: { house: HouseDesign; shape: DeckShape }, widthFt: number): { house: HouseDesign; shape: DeckShape } | null {
  const next = resizeDeckLeft(design.house, design.shape, widthFt, DECK_LIMITS.widthFt.min, DECK_LIMITS.widthFt.max);
  return next.shape === design.shape ? null : { house: next.house, shape: resizeFrontEnd(design.shape, "left", next.shape.widthFt) };
}

/** A corner of the front, where a cut at an angle can be made: which part's, which end, where it is (ft), its cut now, and whether it stands out (only such a corner can be cut). */
export interface FrontCorner {
  part: number;
  side: "left" | "right";
  x: number;
  y: number;
  clipFt: number;
  out: boolean;
}
/** Every corner of the front, left to right. */
export function frontCorners(shape: DeckShape): FrontCorner[] {
  if (!canShapeFront(shape)) return [];
  const specs = frontSpecs(shape);
  const xs = startsOf(specs);
  return specs.flatMap((q, i): FrontCorner[] => {
    const prev = specs[i - 1];
    const next = specs[i + 1];
    return [
      { part: i, side: "left", x: xs[i], y: q.yFt, clipFt: q.clipLeftFt ?? 0, out: !prev || prev.yFt < q.yFt - 1 / 24 },
      { part: i, side: "right", x: xs[i] + q.widthFt, y: q.yFt, clipFt: q.clipRightFt ?? 0, out: !next || next.yFt < q.yFt - 1 / 24 },
    ];
  });
}

/** A corner of part `index` cut at an angle, `ft` along the front and as far back (0 = square again). Under a foot is no cut; what cannot be cut stays square (design normalizeFront). */
export function clipFrontCorner(shape: DeckShape, index: number, side: "left" | "right", ft: number): DeckShape {
  if (!canShapeFront(shape)) return shape;
  const specs = frontSpecs(shape);
  const q = specs[index];
  if (!q) return shape;
  const c = half(ft) < FRONT_LIMITS.clipFt.min ? 0 : Math.min(FRONT_LIMITS.clipFt.max, half(ft));
  const now = (side === "left" ? q.clipLeftFt : q.clipRightFt) ?? 0;
  if (c === now) return shape;
  const next = specs.map((s, k) => {
    if (k !== index) return s;
    const cl = side === "left" ? c : (s.clipLeftFt ?? 0);
    const cr = side === "right" ? c : (s.clipRightFt ?? 0);
    return { widthFt: s.widthFt, yFt: s.yFt, ...(cl ? { clipLeftFt: cl } : {}), ...(cr ? { clipRightFt: cr } : {}) };
  });
  return shapeFromSpecs(shape, next);
}

/** Part `index` brought to the line of the part beside it (the nearer of its two neighbours): the two are one part. */
export function levelFrontPart(shape: DeckShape, index: number): DeckShape {
  if (!canShapeFront(shape)) return shape;
  const specs = frontSpecs(shape);
  const q = specs[index];
  if (!q || specs.length < 2) return shape;
  const beside = [specs[index - 1], specs[index + 1]].filter((s): s is FrontSpec => !!s).sort((a, b) => Math.abs(a.yFt - q.yFt) - Math.abs(b.yFt - q.yFt))[0];
  const next = specs.map((s, k) => (k === index ? { widthFt: s.widthFt, yFt: beside.yFt } : s));
  return shapeFromSpecs(shape, next);
}

/** The step between part `index` and the next taken away: the narrower of the two goes to the other's line (the first, when they are as wide). */
export function removeFrontStep(shape: DeckShape, index: number): DeckShape {
  if (!canShapeFront(shape)) return shape;
  const specs = frontSpecs(shape);
  const a = specs[index];
  const b = specs[index + 1];
  if (!a || !b) return shape;
  const goes = b.widthFt < a.widthFt ? index + 1 : a.widthFt < b.widthFt ? index : index + 1;
  const line = goes === index ? b.yFt : a.yFt;
  return shapeFromSpecs(shape, specs.map((q, k) => (k === goes ? { widthFt: q.widthFt, yFt: line } : q)));
}

/** One straight front again, where the deck's deepest part stood, its corners square. */
export function straightFront(shape: DeckShape): DeckShape {
  if (shape.kind === "wall" && shape.front) return shapeFromSpecs(shape, [{ widthFt: shape.widthFt, yFt: shape.depthFt }]);
  if (shape.kind === "L" && shape.notch.corner.startsWith("front")) return { kind: "rect", widthFt: shape.widthFt, depthFt: shape.depthFt };
  if (shape.kind === "rect" && shape.front) return { kind: "rect", widthFt: shape.widthFt, depthFt: shape.depthFt };
  return shape;
}

/** Whether the front is anything but one straight line with square corners. */
export const frontIsShaped = (shape: DeckShape): boolean => (shape.kind === "wall" && !!shape.front) || (shape.kind === "L" && shape.notch.corner.startsWith("front")) || (shape.kind === "rect" && !!shape.front);

/** A part of the front in words: "8 ft wide · 16 ft out from the house · left corner cut 3 ft". */
export function frontPartWords(q: FrontSpec): string {
  const cut = [q.clipLeftFt ? `left corner cut ${ftWords(q.clipLeftFt)}` : "", q.clipRightFt ? `right corner cut ${ftWords(q.clipRightFt)}` : ""].filter(Boolean).join(", ");
  return `${ftWords(q.widthFt)} wide · ${ftWords(q.yFt)} out from the house${cut ? ` · ${cut}` : ""}`;
}

/** What to say when a move could not be made. */
export function frontWhyWords(why: FrontWhy): string {
  return why === "parts"
    ? `The front takes ${FRONT_LIMITS.parts} parts at most — bring a part level with the one beside it (or press Straight front) to pull another.`
    : why === "back-notch"
      ? "This deck's corner is cut at the back (an L against the house) — pick Rectangle or Any shape in step 2, then shape its front here."
      : "No room for that there — a part of the front is 2 ft wide at least, and 3 ft of deck stay in front of the wall.";
}
