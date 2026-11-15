// ACCESSORIES BY HAND (2026-11-14 — the owner: "make it movable on 3D: accessory drag and turn and place") — pure.
//
// A bench, a planter, a kitchen island or a fire table stood along an edge, at a place along it. Now one can be taken
// hold of in the 3D and dragged anywhere on the deck, turned, or put where a click lands. It then keeps a spot of its
// own (design.extras.builtIns[].spot: its middle and its turn), and the engine (lib/deck/builtins) builds it there and
// checks it as it does along an edge: all of it on the deck, clear of the railing's line, not in front of a stair's top.
//
// How it moves:
//   · DRAGGED, it goes where the pointer takes it — and where that is off the deck or into the railing it stops at the
//     last place it fits, on the line it was dragged along. Let go with its back to an edge, within a hand of where it
//     would stand along that edge, and it lines up against it there (a fire table never: it stays out on the deck).
//   · TURNED, it turns about its middle by 45° at a time; where it does not fit turned there it is moved in toward the
//     middle of the deck until it does.
//   · PLACED, it jumps to where the click landed — moved in toward the middle where it does not fit.
//   · A PRIVACY SCREEN stands in the railing's place: dragged or placed, it goes to the nearest open edge (front, left
//     or right end) at that place along it. It does not turn.
// Each returns the patch to the design (the list of built-ins with the one changed), or null where nothing can be done.
import { buildBuiltIns, type BuiltIn, type BuiltInBuild, type BuiltInsInput } from "./builtins";
import { ringEdges } from "./ringEdges";
import type { DeckPatch } from "./checks";
import type { DeckStructure } from "./structure";

/** A turn's step, degrees; how near its back line must come to where it would stand along an edge to line up there, in. */
export const ACCESSORY_TURN_DEG = 45;
export const ACCESSORY_SNAP_IN = 8;

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
    const lined: BuiltIn = { id: it.id, kind: it.kind, side: sd.side, atFt, lengthFt: it.lengthFt };
    if (tryItem(s, lined)) return lined;
  }
  return { ...it, spot };
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

/** DRAGGED to (x, y), plan inches: as far as it fits along the drag, lined up against an edge when let go by one. */
export function moveAccessory(s: DeckStructure, id: string, x: number, y: number): DeckPatch | null {
  const got = find(s, id);
  if (!got || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const { it, pose } = got;
  if (it.kind === "screen") return slideScreen(s, it, x, y);
  const target: AccessorySpot = { x: half(x), y: half(y), turnDeg: pose?.turnDeg ?? 0 };
  let spot: AccessorySpot | null = tryItem(s, { ...it, spot: target }) ? target : null;
  if (!spot) spot = pose && tryItem(s, { ...it, spot: pose }) ? farthest(s, it, pose, target) : inToward(s, it, target);
  if (!spot) return null;
  return withItem(s, lineUp(s, it, spot));
}

/** PLACED where a click landed (x, y): there, or moved in toward the middle of the deck until it fits. */
export function placeAccessory(s: DeckStructure, id: string, x: number, y: number): DeckPatch | null {
  const got = find(s, id);
  if (!got || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const { it, pose } = got;
  if (it.kind === "screen") return slideScreen(s, it, x, y);
  const target: AccessorySpot = { x: half(x), y: half(y), turnDeg: pose?.turnDeg ?? 0 };
  const spot = tryItem(s, { ...it, spot: target }) ? target : inToward(s, it, target);
  if (!spot) return null;
  return withItem(s, lineUp(s, it, spot));
}

/** TURNED by `byDeg` about its middle — moved in toward the middle of the deck where it does not fit turned there. A screen does not turn. */
export function turnAccessory(s: DeckStructure, id: string, byDeg: number): DeckPatch | null {
  const got = find(s, id);
  if (!got || got.it.kind === "screen" || !got.pose) return null;
  const { it, pose } = got;
  const target: AccessorySpot = { x: pose.x, y: pose.y, turnDeg: norm(pose.turnDeg + byDeg) };
  const spot = tryItem(s, { ...it, spot: target }) ? target : inToward(s, it, target);
  if (!spot) return null;
  return withItem(s, { ...it, spot });
}

/** BACK ALONG AN EDGE: the nearest open front or end to where it stands, at that place along it (a fire table that far in). */
export function edgeAccessory(s: DeckStructure, id: string): DeckPatch | null {
  const got = find(s, id);
  if (!got || !got.it.spot) return null;
  const { it } = got;
  const c = got.pose ?? it.spot;
  if (!c) return null;
  const { spot: _gone, ...rest } = it;
  void _gone;
  for (const e of edgesNear(s, c.x, c.y)) {
    const next: BuiltIn = { ...rest, side: e.side, atFt: e.atFt, ...(it.kind === "fire" ? { inFt: Math.max(2, half(e.distIn / 12)) } : {}) };
    if (tryItem(s, next)) return withItem(s, next);
  }
  return null;
}

/** Turned how far from lying square to the house, in a few words: "", "turned 45°". */
export function turnWords(b: BuiltInBuild): string {
  const p = accessoryPose(b);
  if (!p || !b.design.spot) return "";
  const t = p.turnDeg % 90;
  return t === 0 ? "" : `turned ${t}°`;
}
