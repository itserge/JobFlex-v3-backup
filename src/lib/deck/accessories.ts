// ACCESSORIES BY HAND (2026-11-14 — the owner: "make it movable on 3D: accessory drag and turn and place") — pure.
//
// A bench, a planter, a kitchen island or a fire table stood along an edge, at a place along it. Now one can be taken
// hold of in the 3D and dragged anywhere on the deck, turned, or put where a click lands. It then keeps a spot of its
// own (design.extras.builtIns[].spot: its middle and its turn), and the engine (lib/deck/builtins) builds it there and
// checks it as it does along an edge: all of it on the deck, clear of the railing's line, not in front of a stair's top.
//
// How it moves (2026-11-15 — the owner: "I don't want that press-button move… click on the accessory, everything gets
// frozen, and I just drag it on the deck wherever I want it. Make it super smart"; no Turn buttons any more):
//   · DRAGGED, it goes where the pointer takes it — and where that is off the deck or into the railing it stops at the
//     last place it fits, on the line it was dragged along.
//   · BROUGHT TO THE RAILING (its back within a foot of where it would stand against an open edge — or dragged out
//     past it), it turns by itself to sit with its back to that edge and lines up against it — so a bench carried from
//     the front to an end turns to face into the deck there. One turned on purpose (not square to any edge) does so only when its back already
//     faces that edge within 25°. A fire table never: it stays out on the deck.
//   · TURNED to any angle about its middle (the round handle in the 3D), held square to the deck's edges within 6°
//     and to an eighth of a turn within 4°; where it does not fit turned there it is moved in toward the middle of the
//     deck until it does. Turned with its back to the railing it stands against, it lines up against that edge.
//   · A PRIVACY SCREEN stands in the railing's place: dragged, it goes to the nearest open edge (front, left or right
//     end) at that place along it. It does not turn.
// Each returns the patch to the design (the list of built-ins with the one changed), or null where nothing can be done.
import { buildBuiltIns, type BuiltIn, type BuiltInBuild, type BuiltInsInput } from "./builtins";
import { ringEdges } from "./ringEdges";
import type { DeckPatch } from "./checks";
import type { DeckStructure } from "./structure";

/** How near its back line must come to where it would stand along an edge to line up there, in. — turned as it is
 *  (SNAP), or brought to the railing and turned to face it (NEAR). */
export const ACCESSORY_SNAP_IN = 8;
export const ACCESSORY_NEAR_IN = 12;
/** A turn held square to an edge within this many degrees, and to an eighth of a turn within this many. */
export const ACCESSORY_SQUARE_DEG = 6;
export const ACCESSORY_EIGHTH_DEG = 4;
/** One turned on purpose goes against an edge only when its back already faces it within this many degrees. */
const FACING_DEG = 25;

export type AccessorySpot = NonNullable<BuiltIn["spot"]>;

const half = (v: number) => Math.round(v * 2) / 2;
const norm = (deg: number) => ((Math.round(deg) % 360) + 360) % 360;

/** Where a built accessory stands now, as a spot of its own would hold it: its middle, and its turn. */
export function accessoryPose(b: BuiltInBuild): AccessorySpot | null {
  if (!b.built || b.footprint.length !== 4) return null;
  const [p0, p1, p2, p3] = b.footprint;
  const ux = p1.x - p0.x;
  const uy = p1.y - p0.y;
  const vx = p3.x - p0.x;
  const vy = p3.y - p0.y;
  // (Its turn is the way its length runs, with its front a quarter turn to the left of that — the engine's own way.)
  let t = (Math.atan2(uy, ux) * 180) / Math.PI;
  if (ux * vy - uy * vx < 0) t += 180;
  return { x: half((p0.x + p2.x) / 2), y: half((p0.y + p2.y) / 2), turnDeg: norm(t) };
}

/** The built-ins as the design lists them, with one replaced. */
function withItem(s: DeckStructure, next: BuiltIn): DeckPatch {
  return { extras: { builtIns: (s.design.extras.builtIns ?? []).map((b) => (b.id === next.id ? next : b)) } };
}

/** This one accessory built on its own where it is asked to stand: the engine's own answer (null where it does not fit). */
function tryItem(s: DeckStructure, it: BuiltIn): BuiltInBuild | null {
  const inp = s.accessoryInput;
  if (!inp) return null;
  const screen = it.kind === "screen";
  const input: BuiltInsInput = { ...inp, items: [it], only: screen ? "screens" : "rest", ...(screen ? { railAt: () => "none" as const } : {}) };
  const b = buildBuiltIns(input)[0];
  return b?.built ? b : null;
}

/** A point well inside the deck: the middle of its largest rectangle. */
function middleOfDeck(s: DeckStructure): { x: number; y: number } | null {
  const zones = s.frame?.zones.map((z) => z.zone) ?? [];
  if (!zones.length) return null;
  const big = zones.reduce((m, z) => ((z.x1 - z.x0) * (z.y1 - z.y0) > (m.x1 - m.x0) * (m.y1 - m.y0) ? z : m));
  return { x: (big.x0 + big.x1) / 2, y: (big.y0 + big.y1) / 2 };
}

/** On the line from `a` (where it fits) to `b`: the farthest place it still fits. */
function farthest(s: DeckStructure, it: BuiltIn, a: AccessorySpot, b: AccessorySpot): AccessorySpot {
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 14; k++) {
    const t = (lo + hi) / 2;
    const p = { x: half(a.x + (b.x - a.x) * t), y: half(a.y + (b.y - a.y) * t), turnDeg: b.turnDeg };
    if (tryItem(s, { ...it, spot: p })) lo = t;
    else hi = t;
  }
  return { x: half(a.x + (b.x - a.x) * lo), y: half(a.y + (b.y - a.y) * lo), turnDeg: b.turnDeg };
}

/** From `p` (where it does not fit) toward the middle of the deck: the first place it fits — null where none does. */
function inToward(s: DeckStructure, it: BuiltIn, p: AccessorySpot): AccessorySpot | null {
  const m = middleOfDeck(s);
  if (!m) return null;
  const at = (t: number): AccessorySpot => ({ x: half(p.x + (m.x - p.x) * t), y: half(p.y + (m.y - p.y) * t), turnDeg: p.turnDeg });
  let prev = 0;
  for (let k = 1; k <= 24; k++) {
    const t = k / 24;
    if (!tryItem(s, { ...it, spot: at(t) })) {
      prev = t;
      continue;
    }
    // The first that fits, refined back toward where it was asked to stand.
    let lo = prev;
    let hi = t;
    for (let j = 0; j < 8; j++) {
      const mid = (lo + hi) / 2;
      if (tryItem(s, { ...it, spot: at(mid) })) hi = mid;
      else lo = mid;
    }
    return at(hi);
  }
  return null;
}

/** Let go with its back to an open edge, near where it would stand along it: it lines up against that edge there. */
function lineUp(s: DeckStructure, it: BuiltIn, spot: AccessorySpot): BuiltIn {
  const inp = s.accessoryInput;
  const free = tryItem(s, { ...it, spot });
  if (!inp || !free || it.kind === "fire" || it.kind === "screen") return { ...it, spot };
  const [p0, p1, , p3] = free.footprint;
  const len = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1;
  const dep = Math.hypot(p3.x - p0.x, p3.y - p0.y) || 1;
  // Its back faces out of the deck (away from its front).
  const backX = -(p3.x - p0.x) / dep;
  const backY = -(p3.y - p0.y) / dep;
  const mid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
  const edges = ringEdges(inp.sides.map((sd) => ({ x: sd.x0, y: sd.y0 })));
  for (let i = 0; i < inp.sides.length; i++) {
    const sd = inp.sides[i];
    const e = edges[i];
    if (sd.house || (sd.side !== "front" && sd.side !== "left" && sd.side !== "right")) continue;
    if (backX * e.outX + backY * e.outY < 0.985) continue;
    const off = (sd.x0 - mid.x) * e.outX + (sd.y0 - mid.y) * e.outY;
    const along = (mid.x - sd.x0) * e.ux + (mid.y - sd.y0) * e.uy;
    if (along < -len / 2 || along > e.length + len / 2) continue;
    const mount = inp.railAt(sd.x0, sd.y0, sd.x1, sd.y1);
    const inset = mount === "top" ? 6 : mount === "side" ? 2.5 : mount === "screen" ? 8.5 : 1.5;
    if (off < 0 || off > inset + ACCESSORY_SNAP_IN) continue;
    const c = { x: (p0.x + free.footprint[2].x) / 2, y: (p0.y + free.footprint[2].y) / 2 };
    // (A place along an edge is read from the deck's left end or the house line, within the deck's width or depth: an
    // end beside the house's side wall, behind the house line, has no such place — it stays where it was put.)
    const atFt = half((sd.side === "front" ? c.x : c.y) / 12);
    const room = sd.side === "front" ? s.design.shape.widthFt : s.design.shape.depthFt;
    if (atFt < 0 || atFt > room) continue;
    const lined = alongEdge(it, sd.side, atFt);
    if (tryItem(s, lined)) return lined;
  }
  return { ...it, spot };
}

/** The accessory along an edge at a place along it — everything else about it kept (its boards, its height). */
function alongEdge(it: BuiltIn, side: BuiltIn["side"], atFt: number): BuiltIn {
  const { spot: _spot, inFt: _in, ...rest } = it;
  void _spot;
  void _in;
  return { ...rest, side, atFt };
}

const toDeg = (rad: number) => (rad * 180) / Math.PI;
/** How far apart two directions are, degrees (0–180). */
const apart = (a: number, b: number) => {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return Math.min(d, 360 - d);
};

/** The deck's open fronts and ends (no house side), each with its line and which way is out. */
function openEdges(s: DeckStructure) {
  const inp = s.accessoryInput;
  if (!inp) return [];
  const edges = ringEdges(inp.sides.map((sd) => ({ x: sd.x0, y: sd.y0 })));
  return inp.sides.flatMap((sd, i) => {
    const e = edges[i];
    const side = sd.side;
    return !sd.house && (side === "front" || side === "left" || side === "right") && e.length > 12 ? [{ sd, e, side }] : [];
  });
}

/** Square to one of the deck's open edges (its length along it or across it), within ACCESSORY_SQUARE_DEG — or along an edge already. */
function squareToEdges(s: DeckStructure, it: BuiltIn, turnDeg: number): boolean {
  if (!it.spot) return true;
  return openEdges(s).some(({ e }) => apart(turnDeg, toDeg(e.yaw)) % 90 <= ACCESSORY_SQUARE_DEG || 90 - (apart(turnDeg, toDeg(e.yaw)) % 90) <= ACCESSORY_SQUARE_DEG);
}

/**
 * BROUGHT TO THE RAILING: the open edge whose railing its middle is brought within reach of — its back, were it turned
 * to face that edge, within ACCESSORY_NEAR_IN of where it would stand — nearest first; it goes against that edge there.
 * Null where it is not brought to one, or does not fit against it.
 */
function toRailing(s: DeckStructure, it: BuiltIn, c: { x: number; y: number }, turnDeg: number, depthIn: number, lengthIn: number): BuiltIn | null {
  const inp = s.accessoryInput;
  if (!inp || it.kind === "fire" || it.kind === "screen") return null;
  const square = squareToEdges(s, it, turnDeg);
  // Its back's way now: a quarter turn to the right of the way its length runs.
  const t = (turnDeg * Math.PI) / 180;
  const backX = Math.sin(t);
  const backY = -Math.cos(t);
  const near = openEdges(s)
    .map(({ sd, e, side }) => {
      const off = (sd.x0 - c.x) * e.outX + (sd.y0 - c.y) * e.outY;
      const along = (c.x - sd.x0) * e.ux + (c.y - sd.y0) * e.uy;
      const mount = inp.railAt(sd.x0, sd.y0, sd.x1, sd.y1);
      const inset = mount === "top" ? 6 : mount === "side" ? 2.5 : mount === "screen" ? 8.5 : 1.5;
      return { sd, side, e, off, along, gap: off - depthIn / 2 - inset };
    })
    // (Dragged out past the railing is brought to it too: the pointer went through it.)
    .filter((q) => q.gap <= ACCESSORY_NEAR_IN && q.along >= -lengthIn / 4 && q.along <= q.e.length + lengthIn / 4)
    .filter((q) => square || toDeg(Math.acos(Math.max(-1, Math.min(1, backX * q.e.outX + backY * q.e.outY)))) <= FACING_DEG)
    .sort((p, q) => p.gap - q.gap);
  for (const q of near) {
    const atFt = half((q.side === "front" ? c.x : c.y) / 12);
    const room = q.side === "front" ? s.design.shape.widthFt : s.design.shape.depthFt;
    if (atFt < 0 || atFt > room) continue;
    const lined = alongEdge(it, q.side, atFt);
    const b = tryItem(s, lined);
    if (!b) continue;
    // (Built against this edge, near where it was brought along it — not on another stretch of the same side.)
    const p = accessoryPose(b);
    if (!p) continue;
    const offB = (q.sd.x0 - p.x) * q.e.outX + (q.sd.y0 - p.y) * q.e.outY;
    const alongB = (p.x - q.sd.x0) * q.e.ux + (p.y - q.sd.y0) * q.e.uy;
    if (offB >= 0 && offB <= depthIn + ACCESSORY_NEAR_IN && Math.abs(alongB - Math.min(q.e.length, Math.max(0, q.along))) <= lengthIn / 2 + 12) return lined;
  }
  return null;
}

/** A turn as the round handle gives it, held square to the deck's open edges within ACCESSORY_SQUARE_DEG, to an eighth of a turn within ACCESSORY_EIGHTH_DEG, else to the degree. */
export function snapTurn(s: DeckStructure, deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  let best: number | null = null;
  let bestOff = ACCESSORY_SQUARE_DEG + 1e-9;
  for (const { e } of openEdges(s)) {
    for (let k = 0; k < 4; k++) {
      const cand = toDeg(e.yaw) + 90 * k;
      const off = apart(deg, cand);
      if (off < bestOff) {
        bestOff = off;
        best = cand;
      }
    }
  }
  if (best !== null) return norm(best);
  const eighth = Math.round(deg / 45) * 45;
  return norm(apart(deg, eighth) <= ACCESSORY_EIGHTH_DEG ? eighth : deg);
}

/** The open fronts and ends, nearest a point first, and where along each that point lies (feet). */
function edgesNear(s: DeckStructure, x: number, y: number): Array<{ side: "front" | "left" | "right"; atFt: number; distIn: number }> {
  const inp = s.accessoryInput;
  if (!inp) return [];
  const out: Array<{ side: "front" | "left" | "right"; atFt: number; distIn: number }> = [];
  for (const sd of inp.sides) {
    if (sd.house || (sd.side !== "front" && sd.side !== "left" && sd.side !== "right")) continue;
    const dx = sd.x1 - sd.x0;
    const dy = sd.y1 - sd.y0;
    const l2 = dx * dx + dy * dy;
    if (l2 < 1) continue;
    const t = Math.min(1, Math.max(0, ((x - sd.x0) * dx + (y - sd.y0) * dy) / l2));
    const px = sd.x0 + dx * t;
    const py = sd.y0 + dy * t;
    const d = Math.hypot(x - px, y - py);
    // (A place along an edge is read within the deck's width or depth: none for an end behind the house line.)
    const atFt = half((sd.side === "front" ? px : py) / 12);
    const room = sd.side === "front" ? s.design.shape.widthFt : s.design.shape.depthFt;
    if (atFt < 0 || atFt > room) continue;
    out.push({ side: sd.side, atFt, distIn: d });
  }
  return out.sort((p, q) => p.distIn - q.distIn);
}

/** A privacy screen goes to the nearest open edge it stands on, at that place along it — or stays where it is. */
function slideScreen(s: DeckStructure, it: BuiltIn, x: number, y: number): DeckPatch | null {
  for (const e of edgesNear(s, x, y)) {
    const next: BuiltIn = { id: it.id, kind: it.kind, side: e.side, atFt: e.atFt, lengthFt: it.lengthFt, ...(it.heightFt ? { heightFt: it.heightFt } : {}) };
    if (tryItem(s, next)) return withItem(s, next);
  }
  return null;
}

/** The accessory as listed, and where it stands now (null when it is not on the list). */
function find(s: DeckStructure, id: string): { it: BuiltIn; pose: AccessorySpot | null } | null {
  const it = (s.design.extras.builtIns ?? []).find((b) => b.id === id);
  if (!it) return null;
  const b = s.builtIns.find((q) => q.design.id === id);
  return { it, pose: (b && accessoryPose(b)) ?? it.spot ?? null };
}

/** Its size on the plan, in. (length, depth): as built now, or as it would stand in the middle of the deck. */
function sizeOf(s: DeckStructure, it: BuiltIn, turnDeg: number): { lengthIn: number; depthIn: number } | null {
  const b = s.builtIns.find((q) => q.design.id === it.id);
  const m = middleOfDeck(s);
  const built = b?.built && b.footprint.length === 4 ? b : m ? tryItem(s, { ...it, spot: { x: half(m.x), y: half(m.y), turnDeg } }) : null;
  if (!built) return null;
  const [p0, p1, , p3] = built.footprint;
  return { lengthIn: Math.hypot(p1.x - p0.x, p1.y - p0.y), depthIn: Math.hypot(p3.x - p0.x, p3.y - p0.y) };
}

/**
 * DRAGGED to (x, y), plan inches (its middle): as far as it fits along the drag — and, brought to the railing, turned to
 * sit with its back to it and lined up against that edge.
 */
export function moveAccessory(s: DeckStructure, id: string, x: number, y: number): DeckPatch | null {
  const got = find(s, id);
  if (!got || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const { it, pose } = got;
  if (it.kind === "screen") return slideScreen(s, it, x, y);
  const target: AccessorySpot = { x: half(x), y: half(y), turnDeg: pose?.turnDeg ?? 0 };
  const size = sizeOf(s, it, target.turnDeg);
  const lined = size ? toRailing(s, it, target, target.turnDeg, size.depthIn, size.lengthIn) : null;
  if (lined) return withItem(s, lined);
  let spot: AccessorySpot | null = tryItem(s, { ...it, spot: target }) ? target : null;
  if (!spot) spot = pose && tryItem(s, { ...it, spot: pose }) ? farthest(s, it, pose, target) : inToward(s, it, target);
  if (!spot) return null;
  return withItem(s, lineUp(s, it, spot));
}

/**
 * TURNED to `deg` about its middle (the round handle in the 3D): held square to the deck's edges and to an eighth of a
 * turn when near one (snapTurn), moved in toward the middle of the deck where it does not fit turned there, and lined up
 * against the railing it stands by when turned with its back to it. A screen does not turn.
 */
export function turnAccessoryTo(s: DeckStructure, id: string, deg: number): DeckPatch | null {
  const got = find(s, id);
  if (!got || got.it.kind === "screen" || !got.pose || !Number.isFinite(deg)) return null;
  const { it, pose } = got;
  const target: AccessorySpot = { x: pose.x, y: pose.y, turnDeg: snapTurn(s, deg) };
  const spot = tryItem(s, { ...it, spot: target }) ? target : inToward(s, it, target);
  if (!spot) return null;
  return withItem(s, lineUp(s, it, spot));
}

/** Turned how far from lying square to the house, in a few words: "", "turned 45°". */
export function turnWords(b: BuiltInBuild): string {
  const p = accessoryPose(b);
  if (!p || !b.design.spot) return "";
  const t = p.turnDeg % 90;
  return t === 0 ? "" : `turned ${t}°`;
}
