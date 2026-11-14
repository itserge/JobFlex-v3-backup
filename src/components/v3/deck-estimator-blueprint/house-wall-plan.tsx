"use client";
// THE BACK WALL AND THE DECK, SEEN FROM ABOVE — AND SHAPED BY HAND (2026-10-11;
// owner, morning: "shape the house in any direction, inside, outside, wider or
// narrower — move the deck's size at the same time, slide it anywhere, type
// the inches in the boxes"; owner, afternoon: "still difficult to understand —
// make it smart to shift the walls back, front, right, left, easier, and make
// the window bigger: more space for drawing"):
//
// A plan on a 1-ft grid: the house's body with its back wall and every step,
// the deck shaded under it. Each part of the wall wide enough is named on the
// drawing — how wide, how far it comes out or steps back — with the deck's
// two dimensions and the wall's reach past its ends drawn as a plan would.
// Tap anything to pick it — a part of the wall, a step, a house end, the
// deck — and the pad under the drawing moves it half a foot a tap (hold to
// keep going): a part BACK, FRONT, LEFT or RIGHT as one piece; a step along
// the wall, deeper or shallower, flipped; the house's end wider or narrower;
// the deck slid, wider, deeper. Dragging does the same — a wall part locks to
// the way it was first pulled, sideways or in and out, and every drag counts
// from where it was grabbed — and the arrow keys move what is focused. Undo
// takes back the last change. When the deck cannot frame around the wall as
// drawn, the pad says why and offers one-tap fixes (lib/deck/house wallFixes).
//
// Three sizes: small in the House step, large in the viewer's "House & deck"
// view (zoom and pan there), and full screen over the page.
//
// THE DECK'S OWN EDGES, THE SAME WAY (2026-11-14 — owner: "make the front and
// the sides of the deck reshape with the toggles in and out like the back wall
// works… move it any shape I want. And make it smart"). The front edge pulled
// out or pushed in anywhere: a section comes with the hand — a bay, a notch.
// A side pushed in: from where it was grabbed to the front the deck stops
// short, the corner comes off square; grabbed by the house, or pulled out, the
// whole end moves. Every part of the front has its own handle, every step in
// it a round one that slides along the deck, every corner that stands out a
// diamond that cuts it at an angle. All of it is lib/deck/frontByHand: each
// move ends on a front set part by part, which the engine already builds.
import * as React from "react";
import { createPortal } from "react-dom";
import { DECK_LIMITS, shapeOutline, type DeckShape } from "@/lib/deck/design";
import {
  FRONT_HAND,
  clipFrontCorner,
  cutSideAt,
  frontCorners,
  frontIsShaped,
  frontPartWords,
  frontSpecs,
  frontWhyWords,
  levelFrontPart,
  moveFrontPart,
  moveFrontStep,
  pullFrontAt,
  removeFrontStep,
  resizeFrontEnd,
  straightFront,
} from "@/lib/deck/frontByHand";
import {
  HOUSE_LIMITS,
  addStepAt,
  deckShapeForHouse,
  levelWallPart,
  moveJogTo,
  moveWallPart,
  pullSectionAt,
  referencePartIndex,
  setSectionDepth,
  settleOpenings,
  resizeDeckLeft,
  shiftWallPart,
  slideDeck,
  wallFixes,
  wallPartWords,
  wallParts,
  type HouseDesign,
  type WallPart,
  type WallSection,
} from "@/lib/deck/house";
import s from "./deck-studio.module.css";

const half = (n: number) => Math.round(n * 2) / 2;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const ft = (n: number) => `${Math.round(n * 2) / 2} ft`;
const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(" ");
const LIMITS = { minWidthFt: DECK_LIMITS.widthFt.min, maxWidthFt: DECK_LIMITS.widthFt.max };
const ZOOMS = [1, 1.5, 2, 3, 4] as const;

export interface WallChange {
  house?: HouseDesign;
  shape?: DeckShape;
}

/** What is picked on the drawing. A part carries the wall's part count: when a step merges away the pick lapses. */
export type WallPick =
  | { kind: "part"; index: number; n: number }
  | { kind: "jog"; id: string }
  | { kind: "end"; side: "left" | "right" }
  | { kind: "deck" }
  /** A part of the deck's front, and a step between two of them (2026-11-14) — each carries the front's part count, as a wall part does. */
  | { kind: "front"; index: number; n: number }
  | { kind: "fstep"; index: number; n: number };
function samePick(a: WallPick | null, b: WallPick | null): boolean {
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind === "part" && b.kind === "part") return a.index === b.index && a.n === b.n;
  if (a.kind === "jog" && b.kind === "jog") return a.id === b.id;
  if (a.kind === "end" && b.kind === "end") return a.side === b.side;
  if ((a.kind === "front" && b.kind === "front") || (a.kind === "fstep" && b.kind === "fstep")) return a.index === b.index && a.n === b.n;
  return a.kind === "deck";
}

type DragKind = "jog" | "left" | "right" | "part" | "deck-right" | "deck-left" | "deck-front" | "deck-slide" | "pan" | "front-part" | "front-pull" | "front-step" | "side-left" | "side-right" | "corner";
const sameShape = (a: DeckShape, b: DeckShape) => a === b || JSON.stringify(a) === JSON.stringify(b);
interface Drag {
  kind: DragKind;
  id?: string;
  part?: number;
  parts: number;
  rect: DOMRect;
  vb: { x: number; y: number; w: number; h: number };
  /** The pointer at the start, screen px and drawing feet. */
  x0: number;
  y0: number;
  fx0: number;
  fy0: number;
  /** What a relative drag has applied so far, ft. */
  appliedX: number;
  appliedY: number;
  moved: boolean;
  /** A wall part locks to the way it is first pulled. */
  axis: "x" | "y" | null;
  /** The house line pulled out or pushed in where it was grabbed: the section that made, followed to the end of the drag. */
  section?: WallSection;
  /** The deck's own edges (2026-11-14): the front part or step grabbed; a corner's part, end and cut at the start; a step's place at the start; a side grabbed by the house (the whole end moves). */
  index?: number;
  side?: "left" | "right";
  at0?: number;
  clip0?: number;
  byHouse?: boolean;
  before: { house: HouseDesign; shape: DeckShape };
  pan0: { x: number; y: number };
}

/** What a pad button does; `by` is feet: + front / right / wider / deeper. */
type PadAction =
  | { kind: "part-move"; index: number; by: number }
  | { kind: "part-shift"; index: number; by: number }
  | { kind: "part-level"; index: number }
  | { kind: "jog-move"; id: string; by: number }
  | { kind: "jog-depth"; id: string; by: number }
  | { kind: "jog-flip"; id: string }
  | { kind: "jog-remove"; id: string }
  | { kind: "end"; side: "left" | "right"; by: number }
  | { kind: "deck-slide"; by: number }
  | { kind: "deck-width"; by: number }
  | { kind: "deck-depth"; by: number }
  | { kind: "add-step"; atFt: number }
  | { kind: "straight" }
  | { kind: "front-move"; index: number; by: number }
  | { kind: "front-level"; index: number }
  | { kind: "front-step"; index: number; by: number }
  | { kind: "front-step-remove"; index: number }
  /** `by` 0 makes the corner square again. */
  | { kind: "front-clip"; index: number; side: "left" | "right"; by: number }
  | { kind: "front-straight" };

function perform(a: PadAction, house: HouseDesign, shape: DeckShape): WallChange | null {
  const W = shape.widthFt;
  const D = shape.depthFt;
  const jog = (id: string) => house.jogs.find((j) => j.id === id);
  const changed = (next: DeckShape): WallChange | null => (sameShape(next, shape) ? null : { shape: next });
  switch (a.kind) {
    case "part-move": {
      const h = moveWallPart(house, shape, a.index, a.by);
      return h && h !== house ? { house: h } : null;
    }
    case "part-shift": {
      const h = shiftWallPart(house, shape, a.index, a.by);
      return h !== house ? { house: h } : null;
    }
    case "part-level": {
      const h = levelWallPart(house, shape, a.index);
      return h && h !== house ? { house: h } : null;
    }
    case "jog-move": {
      const j = jog(a.id);
      if (!j) return null;
      const h = moveJogTo(house, shape, a.id, j.atFt + a.by);
      return h !== house ? { house: h } : null;
    }
    case "jog-depth": {
      const j = jog(a.id);
      if (!j) return null;
      const depthFt = half(clamp(j.depthFt + a.by, HOUSE_LIMITS.depthFt.min, HOUSE_LIMITS.depthFt.max));
      if (depthFt === j.depthFt) return null;
      return { house: { ...house, jogs: house.jogs.map((k) => (k.id === a.id ? { ...k, depthFt } : k)) } };
    }
    case "jog-flip":
      return jog(a.id) ? { house: { ...house, jogs: house.jogs.map((k) => (k.id === a.id ? { ...k, dir: k.dir === "toward" ? "away" : "toward" } : k)) } } : null;
    case "jog-remove":
      return jog(a.id) ? { house: { ...house, jogs: house.jogs.filter((k) => k.id !== a.id) } } : null;
    case "end": {
      const key = a.side === "left" ? "leftFt" : "rightFt";
      const v = half(clamp(house[key] + a.by, HOUSE_LIMITS.extendFt.min, HOUSE_LIMITS.extendFt.max));
      return v === house[key] ? null : { house: { ...house, [key]: v } };
    }
    case "deck-slide": {
      const h = slideDeck(house, a.by);
      return h !== house ? { house: h } : null;
    }
    case "deck-width": {
      const widthFt = half(clamp(W + a.by, LIMITS.minWidthFt, LIMITS.maxWidthFt));
      return widthFt === W ? null : { shape: { ...shape, widthFt } };
    }
    case "deck-depth": {
      const depthFt = half(clamp(D + a.by, DECK_LIMITS.depthFt.min, DECK_LIMITS.depthFt.max));
      return depthFt === D ? null : { shape: { ...shape, depthFt } };
    }
    case "add-step": {
      const h = addStepAt(house, shape, a.atFt);
      return h !== house ? { house: h } : null;
    }
    case "straight":
      return house.jogs.length ? { house: { ...house, jogs: [] } } : null;
    case "front-move":
      return changed(moveFrontPart(shape, a.index, a.by));
    case "front-level":
      return changed(levelFrontPart(shape, a.index));
    case "front-step": {
      const at = frontSpecs(shape).slice(0, a.index + 1).reduce((t, q) => t + q.widthFt, 0);
      return changed(moveFrontStep(shape, a.index, at + a.by));
    }
    case "front-step-remove":
      return changed(removeFrontStep(shape, a.index));
    case "front-clip": {
      const q = frontSpecs(shape)[a.index];
      const now = (a.side === "left" ? q?.clipLeftFt : q?.clipRightFt) ?? 0;
      // (A cut starts at a foot: half a foot of angle is no corner a saw makes.)
      return changed(clipFrontCorner(shape, a.index, a.side, a.by === 0 ? 0 : now === 0 ? 1 : now + a.by));
    }
    case "front-straight":
      return changed(straightFront(shape));
    default:
      return null;
  }
}

/** One pad button: a tap moves once, a hold keeps moving (after a short wait); Enter and Space move once. */
function PadBtn({ label, action, disabled, primary, hold, test, onRun, onHoldStart, onHoldStop }: { label: string; action: PadAction; disabled?: boolean; primary?: boolean; hold: boolean; test?: string; onRun: (a: PadAction) => void; onHoldStart: (a: PadAction) => void; onHoldStop: () => void }) {
  return (
    <button
      type="button"
      className={cx(s.wallPadBtn, primary && s.wallPadBtnPrimary)}
      disabled={disabled}
      onPointerDown={hold ? (e) => { if (e.button === 0) { e.preventDefault(); onHoldStart(action); } } : undefined}
      onPointerUp={hold ? onHoldStop : undefined}
      onPointerLeave={hold ? onHoldStop : undefined}
      onPointerCancel={hold ? onHoldStop : undefined}
      onClick={(e) => { if (!hold || e.detail === 0) onRun(action); }}
      data-deck-wall-act={test ?? action.kind}
    >
      {label}
    </button>
  );
}

export function HouseWallPlan({ shape, house, onChange, size = "small", onOpenLarge, doorFloor }: { shape: DeckShape; house: HouseDesign; onChange: (next: WallChange) => void; size?: "small" | "large"; onOpenLarge?: () => void; /** Which floor a door is on against the deck (2026-11-13): a door under a second-storey deck reads "door below". */ doorFloor?: (o: NonNullable<HouseDesign["openings"]>[number]) => "below" | "deck" | "above" }) {
  const [full, setFull] = React.useState(false);
  const roomy = size === "large" || full;
  const W = shape.widthFt;
  const D = shape.depthFt;
  const parts = wallParts(house, shape);
  const refIdx = referencePartIndex(parts, shape);
  const xMin = -house.leftFt;
  const xMax = W + house.rightFt;
  const depths = parts.map((p) => p.depthFt);
  /** The wall's face at a point along it (the part it is in). */
  const faceAt = (x: number) => (parts.find((p) => x >= p.x0 - 1e-6 && x <= p.x1 + 1e-6) ?? parts[0]).depthFt;
  const yTop = Math.min(0, ...depths) - (roomy ? 6.5 : 7);
  const deepest = Math.max(0, ...depths);
  const span0 = Math.max(xMax - xMin + 5, (deepest + D + 4 - yTop) * 1.3);
  const font0 = roomy ? Math.max(0.55, span0 / 62) : Math.max(0.9, span0 / 42);
  const handle0 = roomy ? Math.max(0.5, span0 / 70) : Math.max(0.8, span0 / 46);
  const yBottom = deepest + D + font0 * 3.4;
  const padX = Math.max(2.5, 1.4 + font0 * 4.2);
  const vbX = xMin - padX;
  const vbY = yTop;
  const vbW = xMax - xMin + 2 * padX;
  const vbH = yBottom - yTop;

  /* ── zoom and pan (the large and full-screen drawings) ── */
  const svgRef = React.useRef<SVGSVGElement>(null);
  const [zoom, setZoom] = React.useState(1);
  const [pan, setPan] = React.useState({ x: 0, y: 0 });
  // The large drawings take the SHAPE OF THEIR BOX: a wide plan on a tall phone gets more house above and more yard
  // below at 100%, and zooming in then fills the whole height instead of a short band. (The small one keeps its own shape.)
  const [aspect, setAspect] = React.useState<number | null>(null);
  React.useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !roomy || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      // Sub-pixel jitter is not a new shape: only a real change re-fits the view.
      if (width > 0 && height > 0) setAspect((a) => (a !== null && Math.abs(a - width / height) < 0.005 ? a : width / height));
    });
    ro.observe(svg);
    return () => ro.disconnect();
  }, [roomy, full]);
  const z = roomy ? zoom : 1;
  const A = roomy && aspect ? aspect : vbW / vbH;
  const baseW = vbW / vbH > A ? vbW : vbH * A;
  const baseH = vbW / vbH > A ? vbW / A : vbH;
  const vw = baseW / z;
  const vh = baseH / z;
  const panRoom = { x: Math.max(0, (vbW - vw) / 2), y: Math.max(0, (vbH - vh) / 2) };
  const px = clamp(roomy ? pan.x : 0, -panRoom.x, panRoom.x);
  const py = clamp(roomy ? pan.y : 0, -panRoom.y, panRoom.y);
  const view = { x: vbX + vbW / 2 + px - vw / 2, y: vbY + vbH / 2 + py - vh / 2, w: vw, h: vh };
  // HELD STILL WHILE SOMETHING IS DRAGGED (owner, 2026-10-24: "when I move the deck wider or narrower it slides so fast
  // that it's hard to stop in the right place"): the drawing re-fits itself to what it shows, so a deck pulled wider
  // shrank the plan under the pointer and its end ran away from the hand. Now the view stays where it was when the drag
  // began, and re-fits when the pointer lets go. The drawing's origin is the deck's left end, so where the deck moves
  // against the house — its left end pulled, the deck slid along the wall — the view moves with the origin by as much
  // as the deck moved, and the house (or, at the house's end, the house's end with the deck's) stays under the hand.
  const [held, setHeld] = React.useState<{ view: typeof view; kind: DragKind; widthFt: number; leftFt: number; pick: WallPick | null } | null>(null);
  const shown = held ? { ...held.view, x: held.view.x + (held.kind === "deck-left" || held.kind === "side-left" ? W - held.widthFt : held.kind === "deck-slide" ? held.leftFt - house.leftFt : 0) } : view;
  // The type and the handles keep their size on screen when zoomed: zooming in makes room, not bigger letters.
  const font = font0 / z;
  const handleR = handle0 / z;
  const sq = handleR * 0.95;
  const [hand, setHand] = React.useState(false);
  /** Where the picked thing is, ft — zooming in centres on it. */
  const pickCentre = (): { x: number; y: number } | null => {
    if (!pick) return null;
    if (pick.kind === "deck") return { x: W / 2, y: D / 2 };
    if (pick.kind === "part") {
      const p = pick.n === parts.length ? parts[pick.index] : undefined;
      return p ? { x: (p.x0 + p.x1) / 2, y: p.depthFt } : null;
    }
    if (pick.kind === "jog") {
      const j = house.jogs.find((k) => k.id === pick.id);
      return j ? { x: j.atFt, y: depthAt(j.atFt) } : null;
    }
    if (pick.kind === "front" || pick.kind === "fstep") {
      const q = pick.n === fparts.length ? fparts[pick.index] : undefined;
      return q ? { x: pick.kind === "front" ? q.mid : q.x1, y: q.y } : null;
    }
    const x = pick.side === "left" ? xMin : xMax;
    return { x, y: depthAt(pick.side === "left" ? x + 0.01 : x - 0.01) };
  };
  const zoomTo = (next: number) => {
    setZoom(next);
    if (next === 1) {
      setPan({ x: 0, y: 0 });
      setHand(false);
      return;
    }
    // Held to the room the new zoom leaves, so the first wheel or drag moves the view at once.
    const c = pickCentre() ?? { x: W / 2, y: D * 0.25 };
    const rx = Math.max(0, (vbW - baseW / next) / 2);
    const ry = Math.max(0, (vbH - baseH / next) / 2);
    setPan({ x: clamp(c.x - (vbX + vbW / 2), -rx, rx), y: clamp(c.y - (vbY + vbH / 2), -ry, ry) });
  };
  // The wheel: when zoomed in it moves the view (the page stays put); a pinch or Ctrl+wheel zooms. Native, not passive.
  const wheelState = React.useRef({ z: 1, roomy: false, view: { x: 0, y: 0, w: 1, h: 1 }, panRoom: { x: 0, y: 0 }, fitH: 1, deckW: 16 });
  React.useEffect(() => {
    wheelState.current = { z, roomy, view, panRoom, fitH: vbH, deckW: W };
  });
  React.useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      const st = wheelState.current;
      if (!st.roomy) return;
      if (e.ctrlKey) {
        e.preventDefault();
        setZoom((zz) => {
          const i = ZOOMS.indexOf(zz as (typeof ZOOMS)[number]);
          const ni = e.deltaY < 0 ? Math.min(ZOOMS.length - 1, i + 1) : Math.max(0, i - 1);
          if (ZOOMS[ni] === 1) setPan({ x: 0, y: 0 });
          return ZOOMS[ni];
        });
        return;
      }
      if (st.z <= 1) return;
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      const k = Math.min(r.width / st.view.w, r.height / st.view.h) || 1;
      const R = st.panRoom;
      setPan((pp) => ({ x: clamp(clamp(pp.x, -R.x, R.x) + e.deltaX / k, -R.x, R.x), y: clamp(clamp(pp.y, -R.y, R.y) + e.deltaY / k, -R.y, R.y) }));
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [full]);

  const pts: string[] = [];
  parts.forEach((p, i) => {
    if (i === 0) pts.push(`${p.x0},${p.depthFt}`);
    pts.push(`${p.x1},${p.depthFt}`);
    if (i + 1 < parts.length) pts.push(`${p.x1},${parts[i + 1].depthFt}`);
  });
  const body = `${xMin},${yTop - 200} ${pts.join(" ")} ${xMax},${yTop - 200}`;
  const outline = shapeOutline(shape).map((p) => ({ x: p.x / 12, y: p.y / 12 }));
  const deck = outline.map((p) => `${p.x},${p.y}`).join(" ");
  const depthAt = (x: number) => parts.find((p) => x >= p.x0 && x <= p.x1)?.depthFt ?? 0;
  const deepestIn = (a: number, b: number) => Math.max(0, ...parts.filter((p) => p.x1 > a && p.x0 < b).map((p) => p.depthFt));
  const deckMidY = D / 2;
  const gridId = React.useId().replace(/:/g, "");
  // THE DECK'S FRONT, PART BY PART (lib/deck/frontByHand): where each part's front stands, and the corners that stand out.
  const fspecs = frontSpecs(shape);
  const fparts = fspecs.map((q, i) => {
    const x0 = fspecs.slice(0, i).reduce((t, o) => t + o.widthFt, 0);
    const cl = q.clipLeftFt ?? 0;
    const cr = q.clipRightFt ?? 0;
    // `mid`: the middle of what is left of the part's straight front between its corners' cuts — where its handle and
    // its words go (the middle of a part with a 6-ft cut corner is out in the yard).
    return { i, x0, x1: x0 + q.widthFt, y: q.yFt, cl, cr, mid: (x0 + cl + x0 + q.widthFt - cr) / 2, straight: q.widthFt - cl - cr };
  });
  /** More than one part: each has its own handle and its own words (one straight front is the deck's depth). */
  const shaped = fparts.length > 1;
  const bowed = shape.kind === "rect" && shape.front?.kind === "curve";
  const corners = bowed ? [] : frontCorners(shape).filter((k) => k.out);
  /** A side of the deck as it is drawn: from where it leaves the house to the front corner (or to where that corner's cut begins). */
  const sideOf = (x: number) => {
    const ys = outline.filter((pt) => Math.abs(pt.x - x) < 0.01).map((pt) => pt.y);
    return ys.length >= 2 ? { y0: Math.min(...ys), y1: Math.max(...ys) } : null;
  };
  const sideLeft = sideOf(0);
  const sideRight = sideOf(W);
  /** Where an end's handle sits: half way along that side as it is drawn (an end part that stops short has a short side). */
  const endMidY = (side: { y0: number; y1: number } | null) => (side ? (side.y0 + side.y1) / 2 : deckMidY);
  const frontPick = (i: number): WallPick => (shaped ? { kind: "front", index: i, n: fparts.length } : { kind: "deck" });
  const stepPick = (i: number): WallPick => ({ kind: "fstep", index: i, n: fparts.length });

  const [pick, setPick] = React.useState<WallPick | null>(null);
  /** A word on a drag that could not do what it was asked (no steps left, no room). */
  const [notice, setNotice] = React.useState<string | null>(null);
  const [hover, setHover] = React.useState<WallPick | null>(null);
  const [undoN, setUndoN] = React.useState(0);
  const history = React.useRef<Array<{ house: HouseDesign; shape: DeckShape }>>([]);
  const latest = React.useRef({ house, shape, onChange });
  React.useEffect(() => {
    latest.current = { house, shape, onChange };
  });
  const remember = (h: HouseDesign, sh: DeckShape) => {
    const hist = history.current;
    const top = hist[hist.length - 1];
    if (top && top.house === h && top.shape === sh) return;
    hist.push({ house: h, shape: sh });
    if (hist.length > 40) hist.shift();
    setUndoN(hist.length);
  };
  const undo = () => {
    const prev = history.current.pop();
    setUndoN(history.current.length);
    if (prev) latest.current.onChange({ house: prev.house, shape: prev.shape });
  };
  /** A pad action on the LATEST house and shape — the hold timer calls this again and again. */
  const run = (a: PadAction) => {
    const cur = latest.current;
    const ch = perform(a, cur.house, cur.shape);
    if (!ch) return;
    remember(cur.house, cur.shape);
    cur.onChange(ch);
  };
  const hold = React.useRef<{ timer: number | null; interval: number | null }>({ timer: null, interval: null });
  const holdStop = () => {
    if (hold.current.timer !== null) window.clearTimeout(hold.current.timer);
    if (hold.current.interval !== null) window.clearInterval(hold.current.interval);
    hold.current = { timer: null, interval: null };
  };
  React.useEffect(() => {
    const h = hold;
    return () => {
      if (h.current.timer !== null) window.clearTimeout(h.current.timer);
      if (h.current.interval !== null) window.clearInterval(h.current.interval);
    };
  }, []);
  const holdStart = (a: PadAction) => {
    holdStop();
    const count = wallParts(latest.current.house, latest.current.shape).length;
    run(a);
    hold.current.timer = window.setTimeout(() => {
      hold.current.interval = window.setInterval(() => {
        // A part held level merges into its neighbour: the part it was is gone, so the repeat stops there.
        if (a.kind.startsWith("part") && wallParts(latest.current.house, latest.current.shape).length !== count) return holdStop();
        run(a);
      }, 110);
    }, 380);
  };

  /* ── full screen ── */
  const closeRef = React.useRef<HTMLButtonElement>(null);
  const zoomRef = React.useRef(zoomTo);
  React.useEffect(() => {
    zoomRef.current = zoomTo;
  });
  React.useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFull(false);
    };
    window.addEventListener("keydown", onKey);
    closeRef.current?.focus({ preventScroll: true });
    // A wide drawing on a tall screen (a phone held upright) would sit small in a sea of paper: zoom in to fill the
    // height, centred on what is picked or where the wall meets the deck. Fit shows the whole of it again.
    const raf = window.requestAnimationFrame(() => {
      const svg = svgRef.current;
      const st = wheelState.current;
      if (!svg || st.z !== 1) return;
      const r = svg.getBoundingClientRect();
      const k = Math.min(r.width / st.view.w, r.height / st.view.h);
      // How much taller the box is than the drawing itself (the house and the deck, not the margins around them).
      const ratio = r.height / Math.max(1, st.fitH * k);
      if (ratio < 1.4) return;
      // …but never so far that the deck's own ends leave the screen: the deck and 2 ft either side stay in view.
      const byWidth = st.view.w / (st.deckW + 4);
      const target = [...ZOOMS].reverse().find((zz) => zz <= Math.min(ratio, byWidth)) ?? 1;
      if (target > 1) zoomRef.current(target);
    });
    return () => {
      window.removeEventListener("keydown", onKey);
      window.cancelAnimationFrame(raf);
    };
  }, [full]);

  /* ── dragging ── */
  const drag = React.useRef<Drag | null>(null);
  const feetAt = (rect: DOMRect, vb: Drag["vb"], clientX: number, clientY: number) => {
    // The drawing keeps its proportions inside the box (meet): the scale is the smaller of the two, centred.
    const k = Math.min(rect.width / vb.w, rect.height / vb.h) || 1;
    const ox = rect.left + (rect.width - vb.w * k) / 2;
    const oy = rect.top + (rect.height - vb.h * k) / 2;
    return { x: vb.x + (clientX - ox) / k, y: vb.y + (clientY - oy) / k, k };
  };
  const start = (e: React.PointerEvent<SVGElement>, kind: DragKind, pickHere: WallPick | null, extra: { id?: string; part?: number; index?: number; side?: "left" | "right"; at0?: number; clip0?: number; sideBack?: number } = {}) => {
    const svg = svgRef.current;
    if (!svg || e.button !== 0) return;
    const rect = svg.getBoundingClientRect();
    const vb = { ...view };
    const f = feetAt(rect, vb, e.clientX, e.clientY);
    drag.current = {
      kind, id: extra.id, part: extra.part, parts: parts.length, rect, vb, x0: e.clientX, y0: e.clientY, fx0: f.x, fy0: f.y, appliedX: 0, appliedY: 0, moved: false, axis: null, before: { house, shape }, pan0: { x: px, y: py },
      index: extra.index, side: extra.side, at0: extra.at0, clip0: extra.clip0,
      // A side grabbed by the house moves the deck's whole end: that stretch hangs on the wall, there is no corner to take off.
      byHouse: extra.sideBack !== undefined && f.y - extra.sideBack < FRONT_HAND.byHouseFt,
    };
    if (pickHere) setPick(pickHere);
    setNotice(null);
    if (kind !== "pan") setHeld({ view: vb, kind, widthFt: W, leftFt: house.leftFt, pick });
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
    // Focus follows the pointer, so the arrow keys move what was just picked.
    if (kind !== "pan") (e.currentTarget as SVGElement).focus({ preventScroll: true });
  };
  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const dxPx = e.clientX - d.x0;
    const dyPx = e.clientY - d.y0;
    if (!d.moved) {
      if (Math.hypot(dxPx, dyPx) < 5) return;
      d.moved = true;
      d.axis = Math.abs(dxPx) > Math.abs(dyPx) ? "x" : "y";
      if (d.kind !== "pan") remember(d.before.house, d.before.shape);
    }
    const p = feetAt(d.rect, d.vb, e.clientX, e.clientY);
    if (d.kind === "pan") {
      setPan({ x: clamp(d.pan0.x - dxPx / p.k, -panRoom.x, panRoom.x), y: clamp(d.pan0.y - dyPx / p.k, -panRoom.y, panRoom.y) });
    } else if (d.kind === "jog" && d.id) {
      const next = moveJogTo(house, shape, d.id, p.x);
      if (next !== house) onChange({ house: next });
    } else if (d.kind === "left") {
      const leftFt = clamp(half(-p.x), HOUSE_LIMITS.extendFt.min, HOUSE_LIMITS.extendFt.max);
      if (leftFt !== house.leftFt) onChange({ house: { ...house, leftFt } });
    } else if (d.kind === "right") {
      const rightFt = clamp(half(p.x - W), HOUSE_LIMITS.extendFt.min, HOUSE_LIMITS.extendFt.max);
      if (rightFt !== house.rightFt) onChange({ house: { ...house, rightFt } });
    } else if (d.kind === "part" && d.part !== undefined) {
      // DRAG THE WALL ANYWHERE (owner, 2026-10-12: "just drag the back wall in or out at any place to make the shape of
      // the house you want — make it smart"). The house line — the part the deck stands on — does not move as a whole:
      // pulled out or pushed in, a section of it comes with the pointer right where it was grabbed (lib/deck/house
      // pullSectionAt: 8 ft wide, run on to the house's end when grabbed near it, snapped to the deck's ends), its depth
      // following the drag; back to nothing, the wall is straight again.
      if (d.axis === "y" && (d.part === refIdx || d.section) && d.before) {
        const want = half(p.y - d.fy0);
        if (want === d.appliedY) return;
        d.appliedY = want;
        if (!d.section) {
          if (Math.abs(want) < 0.5) return;
          const made = pullSectionAt(house, shape, d.fx0, want);
          if ("why" in made) {
            setNotice(
              made.why === "steps"
                ? `The wall takes ${HOUSE_LIMITS.jogs} steps at most — level a part (or press Straight wall) to pull another.`
                : made.why === "line"
                  ? "Pulled there, the deck would no longer stand on the house line — grab the wall beside the deck, or level a part first."
                  : "No room for a section there — grab the wall further from a step.",
            );
            return;
          }
          d.section = made.section;
          setNotice(null);
          onChange({ house: made.house });
        } else {
          onChange({ house: setSectionDepth(house, d.section, want) });
          if (Math.abs(want) < 0.5) d.section = undefined;
        }
        return;
      }
      // A step dropped to nothing merges two parts and the indexes shift: that ends the drag.
      if (parts.length !== d.parts) {
        drag.current = null;
        setHeld(null);
        return;
      }
      if (d.axis === "x") {
        const want = half(p.x - d.fx0);
        const delta = want - d.appliedX;
        if (Math.abs(delta) >= 0.5) {
          const next = shiftWallPart(house, shape, d.part, delta);
          if (next !== house) onChange({ house: next });
          d.appliedX = want;
        }
      } else {
        const want = half(p.y - d.fy0);
        const delta = want - d.appliedY;
        if (Math.abs(delta) >= 0.5) {
          const next = moveWallPart(house, shape, d.part, delta);
          if (next && next !== house) onChange({ house: next });
          d.appliedY = want;
        }
      }
    } else if (d.kind === "deck-right") {
      const widthFt = clamp(half(p.x), DECK_LIMITS.widthFt.min, DECK_LIMITS.widthFt.max);
      if (widthFt !== W) onChange({ shape: { ...shape, widthFt } });
    } else if (d.kind === "deck-front") {
      const depthFt = clamp(half(p.y), DECK_LIMITS.depthFt.min, DECK_LIMITS.depthFt.max);
      if (depthFt !== D) onChange({ shape: { ...shape, depthFt } });
    } else if (d.kind === "deck-left") {
      // The deck's left end is the drawing's origin: as it moves, the house (and the pointer's frame, held from the
      // start) shifts under it — so the width is taken from where the drag began, not from the width of the moment
      // (that fed back on itself: the deck ran away at a foot a frame — owner, 2026-10-24: "it slides so fast").
      // (A front in parts: the LEFT part takes the change — the others stay where they are against the house.)
      const next = resizeDeckLeft(house, shape, half(d.before.shape.widthFt - (p.x - d.fx0)), DECK_LIMITS.widthFt.min, DECK_LIMITS.widthFt.max);
      if (next.shape !== shape) onChange({ house: next.house, shape: resizeFrontEnd(shape, "left", next.shape.widthFt) });
    } else if (d.kind === "deck-slide") {
      // The deck slides by how far it was pulled, wherever it was grabbed.
      const want = half(p.x - d.fx0);
      const delta = want - d.appliedX;
      if (Math.abs(delta) >= 0.5) {
        const next = slideDeck(house, delta);
        if (next !== house) onChange({ house: next });
        d.appliedX = want;
      }
    } else if (d.kind === "front-part" && d.index !== undefined) {
      // THE DECK'S OWN EDGES (2026-11-14). Every one of these is worked from the shape the drag BEGAN on and how far
      // the hand has gone since (lib/deck/frontByHand) — nothing drifts, and a hand brought back leaves the deck as it was.
      const want = half(p.y - d.fy0);
      if (want === d.appliedY) return;
      d.appliedY = want;
      const next = moveFrontPart(d.before.shape, d.index, want);
      if (!sameShape(next, shape)) onChange({ shape: next });
    } else if (d.kind === "front-pull") {
      // The front edge pulled out or pushed in where it was grabbed: a section comes with the hand — a bay, a notch.
      const want = half(p.y - d.fy0);
      if (want === d.appliedY) return;
      d.appliedY = want;
      const made = pullFrontAt(d.before.shape, d.fx0, want);
      if ("why" in made) {
        setNotice(frontWhyWords(made.why));
        return;
      }
      setNotice(null);
      if (!sameShape(made.shape, shape)) onChange({ shape: made.shape });
    } else if (d.kind === "front-step" && d.index !== undefined && d.at0 !== undefined) {
      const next = moveFrontStep(d.before.shape, d.index, d.at0 + (p.x - d.fx0));
      if (!sameShape(next, shape)) onChange({ shape: next });
    } else if (d.kind === "side-left" || d.kind === "side-right") {
      // A SIDE: pushed in away from the house, the corner comes off square from where it was grabbed to the front;
      // grabbed by the house, or pulled outward, the deck's whole end moves (the house stays put).
      const left = d.kind === "side-left";
      const inn = half(left ? p.x - d.fx0 : d.fx0 - p.x);
      if (inn === d.appliedX) return;
      d.appliedX = inn;
      const B = d.before;
      let next: { house: HouseDesign; shape: DeckShape };
      if (d.byHouse || inn <= 0) {
        const w = clamp(half(B.shape.widthFt - inn), DECK_LIMITS.widthFt.min, DECK_LIMITS.widthFt.max);
        const ended = left ? resizeDeckLeft(B.house, B.shape, w, DECK_LIMITS.widthFt.min, DECK_LIMITS.widthFt.max) : { house: B.house, shape: { ...B.shape, widthFt: w } };
        next = { house: ended.house, shape: resizeFrontEnd(B.shape, left ? "left" : "right", ended.shape.widthFt) };
        setNotice(null);
      } else {
        const cut = cutSideAt(B.shape, left ? "left" : "right", d.fy0, inn);
        if ("why" in cut) {
          setNotice(frontWhyWords(cut.why));
          return;
        }
        setNotice(null);
        next = { house: B.house, shape: cut.shape };
      }
      const houseMoved = next.house !== house && JSON.stringify(next.house) !== JSON.stringify(house);
      if (houseMoved || !sameShape(next.shape, shape)) onChange({ ...(houseMoved ? { house: next.house } : {}), shape: next.shape });
    } else if (d.kind === "corner" && d.index !== undefined && d.side) {
      // A corner pulled toward the deck, along the front or back along the side: cut at an angle by that much.
      const inX = d.side === "left" ? p.x - d.fx0 : d.fx0 - p.x;
      const c = Math.max(0, half((d.clip0 ?? 0) + Math.max(inX, d.fy0 - p.y)));
      // (appliedY marks that a cut has been sent: the first move always is.)
      if (d.appliedY === 1 && c === d.appliedX) return;
      d.appliedX = c;
      d.appliedY = 1;
      const next = clipFrontCorner(d.before.shape, d.index, d.side, c);
      if (!sameShape(next, shape)) onChange({ shape: next });
    }
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    setHeld(null);
    if (d && d.kind === "pan" && !d.moved) setPick(null);
  };
  const key = (e: React.KeyboardEvent<SVGElement>, a: WallPick) => {
    if (e.key === "Escape") {
      if (pick) {
        e.stopPropagation();
        setPick(null);
      }
      return;
    }
    const by = e.shiftKey ? 2 : 0.5;
    const L = e.key === "ArrowLeft", R = e.key === "ArrowRight", U = e.key === "ArrowUp", Dn = e.key === "ArrowDown";
    let act: PadAction | null = null;
    if (a.kind === "jog") {
      if (L || R) act = { kind: "jog-move", id: a.id, by: R ? by : -by };
      else if (U || Dn) act = { kind: "jog-depth", id: a.id, by: Dn ? by : -by };
      else if (e.key === "Delete" || e.key === "Backspace") act = { kind: "jog-remove", id: a.id };
    } else if (a.kind === "end") {
      if (L || R) act = { kind: "end", side: a.side, by: a.side === "left" ? (L ? by : -by) : R ? by : -by };
    } else if (a.kind === "part") {
      if (U || Dn) act = { kind: "part-move", index: a.index, by: Dn ? by : -by };
      else if (L || R) act = { kind: "part-shift", index: a.index, by: R ? by : -by };
    } else if (a.kind === "deck") {
      if (L || R) act = { kind: "deck-slide", by: R ? by : -by };
      else if (U || Dn) act = { kind: "deck-depth", by: Dn ? by : -by };
    } else if (a.kind === "front") {
      if (U || Dn) act = { kind: "front-move", index: a.index, by: Dn ? by : -by };
    } else if (a.kind === "fstep") {
      if (L || R) act = { kind: "front-step", index: a.index, by: R ? by : -by };
      else if (e.key === "Delete" || e.key === "Backspace") act = { kind: "front-step-remove", index: a.index };
    }
    if (act) {
      e.preventDefault();
      run(act);
    }
  };
  const deckKey = (e: React.KeyboardEvent<SVGElement>, which: "left" | "right" | "front") => {
    const by = e.shiftKey ? 2 : 0.5;
    const L = e.key === "ArrowLeft", R = e.key === "ArrowRight", U = e.key === "ArrowUp", Dn = e.key === "ArrowDown";
    let ch: WallChange | null = null;
    if (which === "right" && (L || R)) ch = perform({ kind: "deck-width", by: R ? by : -by }, house, shape);
    else if (which === "left" && (L || R)) {
      const next = resizeDeckLeft(house, shape, W + (L ? by : -by), DECK_LIMITS.widthFt.min, DECK_LIMITS.widthFt.max);
      ch = next.shape !== shape ? { house: next.house, shape: resizeFrontEnd(shape, "left", next.shape.widthFt) } : null;
    } else if (which === "front" && (U || Dn)) ch = perform({ kind: "deck-depth", by: Dn ? by : -by }, house, shape);
    else if (e.key === "Escape" && pick) {
      e.stopPropagation();
      setPick(null);
    }
    if (ch) {
      e.preventDefault();
      remember(house, shape);
      onChange(ch);
    }
  };

  /* ── what the pad shows ── */
  const fit = deckShapeForHouse(shape, house);
  const fixes = fit.note ? wallFixes(shape, house, LIMITS) : [];
  const partPick = (a: number): WallPick => ({ kind: "part", index: a, n: parts.length });
  const hovered = (a: WallPick) => samePick(hover, a);
  const picked = (a: WallPick) => samePick(pick, a);
  // The pad keeps showing what it showed when a drag began: switching it to the grabbed thing's buttons mid-drag made
  // it taller and the drawing above it smaller under the pointer. It switches when the pointer lets go.
  const padPick = held ? held.pick : pick;
  const pickedPart = padPick && padPick.kind === "part" && padPick.n === parts.length && parts[padPick.index] ? { index: padPick.index, part: parts[padPick.index] } : null;
  const plusX = pickedPart ? half(clamp((pickedPart.part.x0 + pickedPart.part.x1) / 2, xMin + 1, xMax - 1)) : W;
  const canAdd = house.jogs.length < HOUSE_LIMITS.jogs && !house.jogs.some((j) => Math.abs(j.atFt - plusX) < 1);
  const padBtn = (label: string, a: PadAction, opts: { disabled?: boolean; primary?: boolean; hold?: boolean; test?: string } = {}) => (
    <PadBtn key={`${a.kind}:${label}`} label={label} action={a} disabled={opts.disabled} primary={opts.primary} hold={opts.hold !== false} test={opts.test} onRun={run} onHoldStart={holdStart} onHoldStop={holdStop} />
  );
  let padBody: React.ReactNode;
  if (pickedPart) {
    const { index, part } = pickedPart;
    const locked = index === refIdx;
    padBody = (
      <>
        <span className={s.wallPadTitle} data-deck-wall-picked="part">Wall part {index + 1} of {parts.length} · {wallPartWords(part)}</span>
        {locked ? <span className={s.wallPadHint}>The deck stands on this part — the house line. Drag it in or out anywhere: that stretch of the wall comes with you, a bump-out or a nook right there.</span> : null}
        {padBtn("▲ Back 6 in.", { kind: "part-move", index, by: -0.5 }, { disabled: locked })}
        {padBtn("▼ Front 6 in.", { kind: "part-move", index, by: 0.5 }, { disabled: locked })}
        {padBtn("◀ Left 6 in.", { kind: "part-shift", index, by: -0.5 }, { disabled: parts.length === 1 })}
        {padBtn("Right 6 in. ▶", { kind: "part-shift", index, by: 0.5 }, { disabled: parts.length === 1 })}
        {Math.abs(part.depthFt) >= 0.5 && !locked ? padBtn("Level with the house", { kind: "part-level", index }, { hold: false }) : null}
      </>
    );
  } else if (padPick?.kind === "jog" && house.jogs.some((k) => k.id === padPick.id)) {
    const j = house.jogs.find((k) => k.id === padPick.id)!;
    padBody = (
      <>
        <span className={s.wallPadTitle} data-deck-wall-picked="jog">Step at {ft(j.atFt)} · the wall to its right {j.dir === "toward" ? "comes out" : "steps back"} {ft(j.depthFt)}</span>
        {padBtn("◀ Left 6 in.", { kind: "jog-move", id: j.id, by: -0.5 })}
        {padBtn("Right 6 in. ▶", { kind: "jog-move", id: j.id, by: 0.5 })}
        {padBtn("Deeper + 6 in.", { kind: "jog-depth", id: j.id, by: 0.5 })}
        {padBtn("Shallower − 6 in.", { kind: "jog-depth", id: j.id, by: -0.5 }, { disabled: j.depthFt <= HOUSE_LIMITS.depthFt.min })}
        {padBtn(j.dir === "toward" ? "Make it step back" : "Make it come out", { kind: "jog-flip", id: j.id }, { hold: false })}
        {padBtn("Remove this step", { kind: "jog-remove", id: j.id }, { hold: false })}
      </>
    );
  } else if (padPick?.kind === "end") {
    const v = padPick.side === "left" ? house.leftFt : house.rightFt;
    padBody = (
      <>
        <span className={s.wallPadTitle} data-deck-wall-picked="end">The house&apos;s {padPick.side} end · {ft(v)} past the deck</span>
        {padBtn(padPick.side === "left" ? "◀ Wider" : "◀ Narrower", { kind: "end", side: padPick.side, by: padPick.side === "left" ? 0.5 : -0.5 })}
        {padBtn(padPick.side === "left" ? "Narrower ▶" : "Wider ▶", { kind: "end", side: padPick.side, by: padPick.side === "left" ? -0.5 : 0.5 })}
      </>
    );
  } else if (padPick?.kind === "front" && padPick.n === fparts.length && fspecs[padPick.index]) {
    const i = padPick.index;
    const q = fspecs[i];
    const canCut = (side: "left" | "right") => corners.some((k) => k.part === i && k.side === side);
    padBody = (
      <>
        <span className={s.wallPadTitle} data-deck-wall-picked="front">Front part {i + 1} of {fparts.length} · {frontPartWords(q)}</span>
        {padBtn("▲ In 6 in.", { kind: "front-move", index: i, by: -0.5 })}
        {padBtn("▼ Out 6 in.", { kind: "front-move", index: i, by: 0.5 })}
        {canCut("left") ? padBtn(q.clipLeftFt ? "Left corner cut + 6 in." : "Cut the left corner", { kind: "front-clip", index: i, side: "left", by: 0.5 }, { test: "front-clip-left" }) : null}
        {q.clipLeftFt ? padBtn("Left corner square", { kind: "front-clip", index: i, side: "left", by: 0 }, { hold: false, test: "front-square-left" }) : null}
        {canCut("right") ? padBtn(q.clipRightFt ? "Right corner cut + 6 in." : "Cut the right corner", { kind: "front-clip", index: i, side: "right", by: 0.5 }, { test: "front-clip-right" }) : null}
        {q.clipRightFt ? padBtn("Right corner square", { kind: "front-clip", index: i, side: "right", by: 0 }, { hold: false, test: "front-square-right" }) : null}
        {padBtn("Level with the part beside it", { kind: "front-level", index: i }, { hold: false })}
      </>
    );
  } else if (padPick?.kind === "fstep" && padPick.n === fparts.length && fparts[padPick.index + 1]) {
    const i = padPick.index;
    const a = fparts[i];
    const b = fparts[i + 1];
    padBody = (
      <>
        <span className={s.wallPadTitle} data-deck-wall-picked="fstep">Step in the deck&apos;s front at {ft(a.x1)} · {ft(a.y)} out on its left, {ft(b.y)} on its right</span>
        {padBtn("◀ Left 6 in.", { kind: "front-step", index: i, by: -0.5 })}
        {padBtn("Right 6 in. ▶", { kind: "front-step", index: i, by: 0.5 })}
        {padBtn("Remove this step", { kind: "front-step-remove", index: i }, { hold: false })}
      </>
    );
  } else if (padPick?.kind === "deck") {
    const one = !shaped && !bowed ? fspecs[0] : null;
    padBody = (
      <>
        <span className={s.wallPadTitle} data-deck-wall-picked="deck">The deck · {ft(W)} × {ft(D)}{shaped ? ` · its front in ${fparts.length} parts` : ""}</span>
        {padBtn("◀ Slide left", { kind: "deck-slide", by: -0.5 })}
        {padBtn("Slide right ▶", { kind: "deck-slide", by: 0.5 })}
        {padBtn("Wider + 6 in.", { kind: "deck-width", by: 0.5 })}
        {padBtn("Narrower − 6 in.", { kind: "deck-width", by: -0.5 })}
        {padBtn("Deeper + 6 in.", { kind: "deck-depth", by: 0.5 })}
        {padBtn("Shallower − 6 in.", { kind: "deck-depth", by: -0.5 })}
        {one && corners.some((k) => k.side === "left") ? padBtn(one.clipLeftFt ? "Left corner cut + 6 in." : "Cut the left corner", { kind: "front-clip", index: 0, side: "left", by: 0.5 }, { test: "front-clip-left" }) : null}
        {one?.clipLeftFt ? padBtn("Left corner square", { kind: "front-clip", index: 0, side: "left", by: 0 }, { hold: false, test: "front-square-left" }) : null}
        {one && corners.some((k) => k.side === "right") ? padBtn(one.clipRightFt ? "Right corner cut + 6 in." : "Cut the right corner", { kind: "front-clip", index: 0, side: "right", by: 0.5 }, { test: "front-clip-right" }) : null}
        {one?.clipRightFt ? padBtn("Right corner square", { kind: "front-clip", index: 0, side: "right", by: 0 }, { hold: false, test: "front-square-right" }) : null}
        <span className={s.wallPadHint}>Drag the deck&apos;s front edge in or out anywhere: a bay or a notch comes with you. Push a side in and that corner comes off square; pull a corner&apos;s ◆ to cut it at an angle.</span>
      </>
    );
  } else {
    padBody = (
      <span className={s.wallPadHint} data-deck-wall-picked="none">
        Drag the wall in or out anywhere to shape the house — a bump-out or a nook comes with you. The deck the same: drag its front edge in or out anywhere for a bay or a notch, push a side in to take a corner off, pull a corner&apos;s ◆ to cut it at an angle. Or tap a part, a step, a house end or the deck and move it with these buttons (hold to keep going) or the arrow keys.
      </span>
    );
  }

  const strip = (p: WallPart, i: number) => {
    const a = partPick(i);
    const locked = i === refIdx;
    return (
      <rect
        key={`s${i}`}
        x={p.x0}
        y={yTop}
        width={Math.max(0.1, p.x1 - p.x0)}
        height={Math.max(0.1, p.depthFt - yTop)}
        className={cx(s.wallPart, locked && s.wallPartLocked, hovered(a) && s.wallPartHover, picked(a) && s.wallPartOn)}
        onPointerEnter={() => setHover(a)}
        onPointerLeave={() => setHover((h) => (samePick(h, a) ? null : h))}
        onPointerDown={(e) => start(e, "part", a, { part: i })}
        onKeyDown={(e) => key(e, a)}
        onFocus={() => setPick(a)}
        tabIndex={0}
        role="button"
        aria-label={`Wall part ${i + 1}: ${wallPartWords(p)}`}
        data-deck-wall-part={i}
      />
    );
  };
  const dim = (x0: number, x1: number, y: number, text: string, keyName: string) => {
    const t = font * 0.45;
    return (
      <g key={keyName} className={s.wallDim} data-deck-wall-dim={keyName}>
        <line x1={x0} y1={y} x2={x1} y2={y} />
        <line x1={x0} y1={y - t} x2={x0} y2={y + t} />
        <line x1={x1} y1={y - t} x2={x1} y2={y + t} />
        <text x={(x0 + x1) / 2} y={y + font * 1.15} fontSize={font * 0.9} textAnchor="middle" className={s.wallDimText}>{text}</text>
      </g>
    );
  };
  // The deck's depth is drawn on the side where the wall stands back the most, clear of a bump-out.
  const depthOnRight = deepestIn(W, xMax) <= deepestIn(xMin, 0);
  const depthX = depthOnRight ? W + font * 1.1 : -font * 1.1;

  const drawing = (
    <svg
      ref={svgRef}
      viewBox={`${shown.x} ${shown.y} ${shown.w} ${shown.h}`}
      preserveAspectRatio="xMidYMid meet"
      className={cx(s.wallPlanSvg, roomy && s.wallPlanSvgLarge, hand && z > 1 && s.wallPlanHand)}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onPointerDownCapture={(e) => {
        if (!hand || z <= 1) return;
        e.stopPropagation();
        start(e, "pan", null);
      }}
      role="img"
      aria-label="The back wall seen from above, with the deck under it"
      data-zoom={z}
    >
      <defs>
        <pattern id={`g1${gridId}`} width="1" height="1" patternUnits="userSpaceOnUse">
          <path d="M1 0H0V1" fill="none" stroke="rgba(10,10,10,0.07)" strokeWidth="0.03" />
        </pattern>
        <pattern id={`g5${gridId}`} width="5" height="5" patternUnits="userSpaceOnUse">
          <rect width="5" height="5" fill={`url(#g1${gridId})`} />
          <path d="M5 0H0V5" fill="none" stroke="rgba(10,10,10,0.14)" strokeWidth="0.05" />
        </pattern>
      </defs>
      {/* The yard: a tap here lets go of what is picked; when zoomed, it drags the view. */}
      <rect x={vbX - 200} y={vbY - 200} width={vbW + 400} height={vbH + 400} className={cx(s.wallYard, z > 1 && s.wallYardPan)} onPointerDown={(e) => (z > 1 ? start(e, "pan", null) : setPick(null))} data-deck-wall-yard />
      <rect x={vbX - 200} y={vbY - 200} width={vbW + 400} height={vbH + 400} fill={`url(#g5${gridId})`} pointerEvents="none" />
      <polygon points={body} className={s.wallBody} pointerEvents="none" />
      {parts.map(strip)}
      <polygon
        points={deck}
        className={cx(s.wallDeck, hovered({ kind: "deck" }) && s.wallDeckHover, picked({ kind: "deck" }) && s.wallDeckOn)}
        onPointerEnter={() => setHover({ kind: "deck" })}
        onPointerLeave={() => setHover((h) => (h?.kind === "deck" ? null : h))}
        onPointerDown={(e) => start(e, "deck-slide", { kind: "deck" })}
        onKeyDown={(e) => key(e, { kind: "deck" })}
        onFocus={() => setPick({ kind: "deck" })}
        tabIndex={0}
        role="button"
        aria-label={`The deck, ${ft(W)} by ${ft(D)}: drag to slide it along the wall`}
        data-deck-wall-deck
      />
      <polyline points={pts.join(" ")} className={s.wallLine} pointerEvents="none" />
      {/* THE DECK'S OWN EDGES (2026-11-14): the front in or out anywhere, a side pushed in, a step slid along — a wide strip over each edge takes the hand. */}
      {bowed
        ? null
        : fparts.map((q) => (
            <line key={`fe${q.i}`} x1={q.x0 + q.cl} x2={q.x1 - q.cr} y1={q.y} y2={q.y} strokeWidth={handleR * 1.5} className={cx(s.wallEdge, shaped && picked(frontPick(q.i)) && s.wallEdgeOn)} onPointerDown={(e) => start(e, "front-pull", frontPick(q.i))} data-deck-front-edge={q.i} aria-hidden="true">
              <title>Drag the front in or out here: a bay or a notch comes with you</title>
            </line>
          ))}
      {fparts.slice(0, -1).map((q, i) => {
        const nx = fparts[i + 1];
        return (
          <line key={`fs${i}`} x1={q.x1} x2={q.x1} y1={Math.min(q.y, nx.y)} y2={Math.max(q.y, nx.y)} strokeWidth={handleR * 1.5} className={cx(s.wallEdgeSide, picked(stepPick(i)) && s.wallEdgeOn)} onPointerDown={(e) => start(e, "front-step", stepPick(i), { index: i, at0: q.x1 })} data-deck-front-step-edge={i} aria-hidden="true">
            <title>Drag this step along the deck</title>
          </line>
        );
      })}
      {sideLeft ? (
        <line x1={0} x2={0} y1={sideLeft.y0} y2={sideLeft.y1} strokeWidth={handleR * 1.5} className={s.wallEdgeSide} onPointerDown={(e) => start(e, "side-left", { kind: "deck" }, { sideBack: sideLeft.y0 })} data-deck-side-edge="left" aria-hidden="true">
          <title>Push this side in to take the corner off — by the house, or pulled out, the deck&apos;s whole end moves</title>
        </line>
      ) : null}
      {sideRight ? (
        <line x1={W} x2={W} y1={sideRight.y0} y2={sideRight.y1} strokeWidth={handleR * 1.5} className={s.wallEdgeSide} onPointerDown={(e) => start(e, "side-right", { kind: "deck" }, { sideBack: sideRight.y0 })} data-deck-side-edge="right" aria-hidden="true">
          <title>Push this side in to take the corner off — by the house, or pulled out, the deck&apos;s whole end moves</title>
        </line>
      ) : null}
      {/* The doors and the ground-floor windows where the photo showed them, on the wall line. */}
      {settleOpenings(house.openings ?? [])
        .filter((o) => o.kind !== "window" || o.sillFt < 8)
        .map((o) => {
          const face = faceAt(o.xFt);
          return o.kind === "window" ? (
            <line key={o.id} x1={o.xFt - o.widthFt / 2} x2={o.xFt + o.widthFt / 2} y1={face} y2={face} className={s.wallWin} pointerEvents="none" data-deck-wall-window />
          ) : (
            <g key={o.id} pointerEvents="none" data-deck-wall-door={doorFloor ? doorFloor(o) : "deck"}>
              <line x1={o.xFt - o.widthFt / 2} x2={o.xFt + o.widthFt / 2} y1={face} y2={face} className={s.wallDoor} />
              <text x={o.xFt} y={face + font * 1.05} fontSize={font * 0.72} textAnchor="middle" className={s.wallOpeningText}>
                {doorFloor && doorFloor(o) !== "deck" ? `door ${doorFloor(o)}` : "door"}
              </text>
            </g>
          );
        })}
      {/* The words on the drawing: the house, each part's width and depth, the deck and its two dimensions, the wall's reach past the deck. */}
      <text x={(xMin + xMax) / 2} y={Math.min(0, ...depths) - font * 3.6} fontSize={font} textAnchor="middle" className={s.wallLabel}>the house</text>
      {parts.map((p, i) => {
        const mid = (p.x0 + p.x1) / 2;
        const depthWord = Math.abs(p.depthFt) < 0.01 ? (i === refIdx ? "house line" : "level") : `${p.depthFt > 0 ? "out" : "back"} ${ft(Math.abs(p.depthFt))}`;
        // Monospace letters are 0.6 of their size wide: the two lines must fit the part's width with a little air.
        const need = Math.max(ft(p.x1 - p.x0).length * 0.54, depthWord.length * 0.492) * font + font * 0.3;
        if (p.x1 - p.x0 < need) return null;
        return (
          <g key={`t${i}`} className={s.wallPartText} data-deck-wall-part-label={i}>
            <text x={mid} y={p.depthFt - font * 2.15} fontSize={font * 0.9} textAnchor="middle">{ft(p.x1 - p.x0)}</text>
            <text x={mid} y={p.depthFt - font * 0.95} fontSize={font * 0.82} textAnchor="middle" className={s.wallNote}>{depthWord}</text>
          </g>
        );
      })}
      {house.leftFt >= 1.5 ? dim(xMin, 0, deepestIn(xMin, 0) + font * 1.6, `${ft(house.leftFt)} past`, "left") : null}
      {house.rightFt >= 1.5 ? dim(W, xMax, deepestIn(W, xMax) + font * 1.6, `${ft(house.rightFt)} past`, "right") : null}
      <text x={W / 2} y={deckMidY - font * 0.3} fontSize={font} textAnchor="middle" className={s.wallLabel}>the deck</text>
      <text x={W / 2} y={deckMidY + font * 1.1} fontSize={font * 0.9} textAnchor="middle" className={s.wallNote}>{ft(W)} × {ft(D)}</text>
      {shaped
        ? fparts.map((q) => {
            const wide = q.x1 - q.x0;
            const out = `out ${ft(q.y)}`;
            const need = Math.max(ft(wide).length * 0.54, out.length * 0.492) * font + font * 0.3;
            const mid = q.mid;
            const base = q.y - sq - font * 0.55;
            // Not where it is too narrow for the words (a front mostly cut away at its corners has no room for them
            // inside the deck), nor over "the deck" and its size in the middle.
            if (q.straight < need || (Math.abs(mid - W / 2) < need / 2 + font * 4 && base - font * 2 < deckMidY + font * 2.9 && base > deckMidY - font * 1.4)) return null;
            return (
              <g key={`ft${q.i}`} className={s.wallPartText} data-deck-front-label={q.i}>
                <text x={mid} y={base - font * 1.05} fontSize={font * 0.82} textAnchor="middle">{ft(wide)}</text>
                <text x={mid} y={base} fontSize={font * 0.8} textAnchor="middle" className={s.wallNote}>{out}</text>
              </g>
            );
          })
        : null}
      {dim(0, W, D + font * 1.1, ft(W), "width")}
      <g className={s.wallDim} data-deck-wall-dim="depth">
        <line x1={depthX} y1={0} x2={depthX} y2={D} />
        <line x1={depthX - font * 0.45} y1={0} x2={depthX + font * 0.45} y2={0} />
        <line x1={depthX - font * 0.45} y1={D} x2={depthX + font * 0.45} y2={D} />
        <text x={depthOnRight ? depthX + font * 0.5 : depthX - font * 0.5} y={D / 2 + font * 0.35} fontSize={font * 0.9} textAnchor={depthOnRight ? "start" : "end"} className={s.wallDimText}>{ft(D)}</text>
      </g>
      {/* The wall's parts: a grip on each, the part the deck stands on marked as the house line. */}
      {parts.map((p, i) => {
        const w = clamp((p.x1 - p.x0) * 0.45, 1 / z, (roomy ? 2 : 2.6) / z);
        const cxp = (p.x0 + p.x1) / 2;
        const locked = i === refIdx;
        const a = partPick(i);
        return (
          <rect key={`g${i}`} x={cxp - w / 2} y={p.depthFt - handleR * 0.55} width={w} height={handleR * 1.1} rx={handleR * 0.5} className={cx(locked ? s.wallGripLocked : s.wallGrip, picked(a) && s.wallSel)} onPointerDown={(e) => start(e, "part", a, { part: i })} data-deck-wall-grip={i} aria-hidden="true">
            <title>{locked ? "The house line: drag in or out anywhere to pull a section of it with you" : "Drag in or out, or sideways"}</title>
          </rect>
        );
      })}
      {/* The steps: each drags sideways. */}
      {house.jogs.map((j) => {
        const y = Math.max(depthAt(j.atFt - 0.01), depthAt(j.atFt + 0.01));
        const a: WallPick = { kind: "jog", id: j.id };
        return (
          <circle key={j.id} cx={j.atFt} cy={y} r={handleR} className={cx(s.wallHandle, picked(a) && s.wallSel)} onPointerDown={(e) => start(e, "jog", a, { id: j.id })} onKeyDown={(e) => key(e, a)} onFocus={() => setPick(a)} data-deck-wall-handle="jog" data-deck-wall-jog={j.id} tabIndex={0} role="slider" aria-label={`Step in the wall at ${ft(j.atFt)}`} aria-valuenow={j.atFt}>
            <title>Drag along the wall · Delete removes the step</title>
          </circle>
        );
      })}
      {/* The house's two ends: wider or narrower. */}
      {(["left", "right"] as const).map((side) => {
        const x = side === "left" ? xMin : xMax;
        const y = depthAt(side === "left" ? x + 0.01 : x - 0.01);
        const tip = side === "left" ? x - handleR * 1.6 : x + handleR * 1.6;
        const a: WallPick = { kind: "end", side };
        return (
          <polygon key={side} points={`${x},${y - handleR} ${tip},${y} ${x},${y + handleR}`} className={cx(s.wallHandle, picked(a) && s.wallSel)} onPointerDown={(e) => start(e, side, a)} onKeyDown={(e) => key(e, a)} onFocus={() => setPick(a)} data-deck-wall-handle={side} tabIndex={0} role="slider" aria-label={`The house's ${side} end`} aria-valuenow={side === "left" ? house.leftFt : house.rightFt}>
            {/* One string: an SVG title with mixed text and values hydrates differently from the server's. */}
            <title>{`The house's ${side} end: drag wider or narrower`}</title>
          </polygon>
        );
      })}
      {/* The deck: its ends and its front edge drag its size; its body or its grip slides it along the wall. */}
      <rect x={W - sq} y={endMidY(sideRight) - sq} width={sq * 2} height={sq * 2} rx={sq * 0.3} className={s.wallDeckHandle} onPointerDown={(e) => start(e, "deck-right", { kind: "deck" })} onKeyDown={(e) => deckKey(e, "right")} onFocus={() => setPick({ kind: "deck" })} data-deck-wall-handle="deck-right" tabIndex={0} role="slider" aria-label="The deck's right end" aria-valuenow={W}>
        <title>The deck&apos;s right end: wider or narrower</title>
      </rect>
      <rect x={-sq} y={endMidY(sideLeft) - sq} width={sq * 2} height={sq * 2} rx={sq * 0.3} className={s.wallDeckHandle} onPointerDown={(e) => start(e, "deck-left", { kind: "deck" })} onKeyDown={(e) => deckKey(e, "left")} onFocus={() => setPick({ kind: "deck" })} data-deck-wall-handle="deck-left" tabIndex={0} role="slider" aria-label="The deck's left end" aria-valuenow={0}>
        <title>The deck&apos;s left end: the house stays put</title>
      </rect>
      {shaped ? (
        fparts.map((q) => {
          const a = frontPick(q.i);
          return (
            <rect key={`fh${q.i}`} x={q.mid - sq} y={q.y - sq} width={sq * 2} height={sq * 2} rx={sq * 0.3} className={cx(s.wallDeckHandle, s.wallDeckHandleNS, picked(a) && s.wallSel)} onPointerDown={(e) => start(e, "front-part", a, { index: q.i })} onKeyDown={(e) => key(e, a)} onFocus={() => setPick(a)} data-deck-wall-handle="front-part" data-deck-front-part={q.i} tabIndex={0} role="slider" aria-label={`Front part ${q.i + 1}: ${frontPartWords(fspecs[q.i])}`} aria-valuenow={q.y}>
              <title>This part of the front: in or out</title>
            </rect>
          );
        })
      ) : (
        <rect x={(bowed ? W / 2 : (fparts[0]?.mid ?? W / 2)) - sq} y={D - sq} width={sq * 2} height={sq * 2} rx={sq * 0.3} className={cx(s.wallDeckHandle, s.wallDeckHandleNS)} onPointerDown={(e) => start(e, "deck-front", { kind: "deck" })} onKeyDown={(e) => deckKey(e, "front")} onFocus={() => setPick({ kind: "deck" })} data-deck-wall-handle="deck-front" tabIndex={0} role="slider" aria-label="The deck's front edge" aria-valuenow={D}>
          <title>The deck&apos;s front edge: deeper or shallower</title>
        </rect>
      )}
      {fparts.slice(0, -1).map((q, i) => {
        const nx = fparts[i + 1];
        const a = stepPick(i);
        return (
          <circle key={`fc${i}`} cx={q.x1} cy={(q.y + nx.y) / 2} r={handleR * 0.8} className={cx(s.wallDeckHandle, picked(a) && s.wallSel)} onPointerDown={(e) => start(e, "front-step", a, { index: i, at0: q.x1 })} onKeyDown={(e) => key(e, a)} onFocus={() => setPick(a)} data-deck-wall-handle="front-step" data-deck-front-step={i} tabIndex={0} role="slider" aria-label={`Step in the deck's front at ${ft(q.x1)}`} aria-valuenow={q.x1}>
            <title>Drag along the deck · Delete removes the step</title>
          </circle>
        );
      })}
      {corners.map((k) => {
        const dir = k.side === "left" ? 1 : -1;
        const hx = k.x + (dir * k.clipFt) / 2;
        const hy = k.y - k.clipFt / 2;
        const r = sq * 0.66;
        return (
          <polygon key={`fk${k.part}${k.side}`} points={`${hx},${hy - r} ${hx + r},${hy} ${hx},${hy + r} ${hx - r},${hy}`} className={s.wallCorner} onPointerDown={(e) => start(e, "corner", frontPick(k.part), { index: k.part, side: k.side, clip0: k.clipFt })} data-deck-wall-handle="corner" data-deck-corner={`${k.part}${k.side}`} data-deck-corner-cut={k.clipFt} aria-hidden="true">
            <title>{k.clipFt ? "Pull to cut this corner more, push back to make it square" : "Pull toward the deck to cut this corner at an angle"}</title>
          </polygon>
        );
      })}
      <rect x={W / 2 - handleR * 1.6} y={deckMidY + font * 1.7} width={handleR * 3.2} height={handleR * 1.1} rx={handleR * 0.5} className={cx(s.wallGrip, picked({ kind: "deck" }) && s.wallSel)} onPointerDown={(e) => start(e, "deck-slide", { kind: "deck" })} data-deck-wall-handle="deck-slide" aria-hidden="true">
        <title>Slide the deck along the wall</title>
      </rect>
      {/* A + where a step would go (the large drawings only — the small one is crowded; the pad's + does the same). */}
      {roomy && canAdd && (padPick?.kind === "part" || padPick?.kind === "deck") ? (
        <g className={s.wallPlus} onClick={() => run({ kind: "add-step", atFt: plusX })} data-deck-wall-plus={plusX} role="button" tabIndex={0} aria-label={`Add a step in the wall at ${ft(plusX)}`} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); run({ kind: "add-step", atFt: plusX }); } }}>
          <circle cx={plusX + handleR * 2.6} cy={depthAt(plusX) + (padPick?.kind === "deck" ? handleR * 2.6 : -handleR * 2.6)} r={handleR * 0.85} />
          <text x={plusX + handleR * 2.6} y={depthAt(plusX) + (padPick?.kind === "deck" ? handleR * 2.6 : -handleR * 2.6) + font * 0.38} fontSize={font * 1.1} textAnchor="middle">+</text>
        </g>
      ) : null}
    </svg>
  );

  const zi = ZOOMS.indexOf(zoom as (typeof ZOOMS)[number]);
  const content = (
    <div className={cx(s.wallPlan, roomy && s.wallPlanLarge, full && s.wallPlanFull)} data-deck-wall-plan data-size={full ? "full" : size} data-deck-wall-parts={parts.length} data-deck-front-parts={fparts.map((q) => `${q.x1 - q.x0}@${q.y}`).join(" ")}>
      <div className={s.wallStage}>
        {drawing}
        {roomy ? (
          <div className={s.wallZoom} role="group" aria-label="Zoom">
            <button type="button" className={s.wallZoomBtn} onClick={() => zoomTo(ZOOMS[Math.max(0, zi - 1)])} disabled={zi <= 0} aria-label="Zoom out" data-deck-wall-zoom="out">−</button>
            <span className={s.wallZoomLevel} data-deck-wall-zoom-level>{Math.round(zoom * 100)}%</span>
            <button type="button" className={s.wallZoomBtn} onClick={() => zoomTo(ZOOMS[Math.min(ZOOMS.length - 1, zi + 1)])} disabled={zi >= ZOOMS.length - 1} aria-label="Zoom in" data-deck-wall-zoom="in">+</button>
            <button type="button" className={s.wallZoomBtn} onClick={() => zoomTo(1)} disabled={zoom === 1} data-deck-wall-zoom="fit">Fit</button>
            {zoom > 1 ? (
              <button type="button" className={cx(s.wallZoomBtn, hand && s.wallZoomOn)} aria-pressed={hand} onClick={() => setHand((h) => !h)} title="Drag anywhere to move the view (scroll does it too)" data-deck-wall-hand>
                ✋ Move view
              </button>
            ) : null}
            {!full ? <button type="button" className={s.wallZoomBtn} onClick={() => setFull(true)} data-deck-wall-fullscreen>⤢ Full screen</button> : null}
          </div>
        ) : null}
      </div>
      <div className={s.wallPad} data-deck-wall-pad>
        {padBody}
        {notice ? (
          <span className={s.wallPadHint} role="status" data-deck-wall-notice>
            {notice}
          </span>
        ) : null}
        <span className={s.wallPadSep} aria-hidden="true" />
        {padBtn("+ Add a step", { kind: "add-step", atFt: plusX }, { hold: false, disabled: !canAdd, test: "add-step" })}
        {padBtn("Straight wall", { kind: "straight" }, { hold: false, disabled: !house.jogs.length, test: "straight" })}
        {padBtn("Straight front", { kind: "front-straight" }, { hold: false, disabled: !frontIsShaped(shape), test: "front-straight" })}
        <button type="button" className={s.wallPadBtn} onClick={undo} disabled={undoN === 0} data-deck-wall-undo>↶ Undo</button>
        {!roomy && onOpenLarge ? <button type="button" className={s.wallPadBtn} onClick={onOpenLarge} data-deck-wall-large>Show it large ↗</button> : null}
        {!roomy ? <button type="button" className={cx(s.wallPadBtn, s.wallPadBtnPrimary)} onClick={() => setFull(true)} data-deck-wall-fullscreen>⤢ Full screen</button> : null}
        {fit.note ? (
          <div className={s.wallFix} data-deck-wall-fixes role="status">
            <span>{fit.note}</span>
            {fixes.length ? (
              <div className={s.wallFixBtns}>
                {fixes.map((f) => (
                  <button key={f.id} type="button" className={s.wallPadBtn} onClick={() => { remember(house, shape); onChange({ house: f.house, shape: f.shape }); }} data-deck-wall-fix={f.id}>{f.label}</button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );

  if (full && typeof document !== "undefined") {
    return (
      <>
        <div className={s.wallFullHold} data-deck-wall-full-hold>
          <span>The drawing is open full screen.</span>
          <button type="button" className={s.wallPadBtn} onClick={() => setFull(false)}>Bring it back here</button>
        </div>
        {createPortal(
          <div className={s.wallFullLayer} role="dialog" aria-modal="true" aria-label="The house and the deck, full screen" data-deck-wall-full>
            <div className={s.wallFullHead}>
              <span className={s.wallFullTitle}>The house &amp; the deck</span>
              <span className={s.wallFullFacts}>
                {ft(W)} × {ft(D)} deck · {parts.length === 1 ? "a straight back wall" : `${parts.length} wall parts`} · drag, tap and move, or use the arrow keys
              </span>
              <button ref={closeRef} type="button" className={cx(s.wallPadBtn, s.wallPadBtnPrimary)} onClick={() => setFull(false)} data-deck-wall-full-close>Done ✕</button>
            </div>
            {content}
          </div>,
          document.body,
        )}
      </>
    );
  }
  return content;
}
