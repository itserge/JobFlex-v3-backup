// BUILT-IN BENCHES AND PLANTER BOXES (2026-11-14) — pure.
//
// The owner asked for "more options to build luxury". What sets a finished deck apart from a platform is what is
// built INTO it: a bench along the edge, a bench with a back, a planter box at a corner — in the deck's own boards.
// The studio could not draw them: said out loud each became a blank line of the contractor's own.
//
// Where one goes: along ONE straight edge of the deck — the front (any part of it, a corner cut at an angle too), the
// left end or the right end — at a place along it, a length long. It stands on the boards just inside the edge: clear
// of a railing's posts where there is a railing, at the edge where there is none. It is kept on its edge (shortened
// where it would run past a corner) and stops at the face of one already built (so two benches asked to the same
// corner meet there); what it runs into is said, not hidden: a stair's top, wide steps.
//
// How each is built (and counted):
//   · A BENCH — the seat 18 in. above the boards, three deck boards deep, on supports no more than 4 ft apart: two
//     4x4 legs under a 2x4 cleat each, a fascia apron all round under the seat's edge. Blocking between the joists
//     under every support.
//   · A BENCH WITH A BACK — the same seat in front of a row of 4x4 posts 36 in. tall, two deck boards across them and
//     a cap board on top.
//   · A PLANTER BOX — 20 in. deep, three boards high on a treated 2x4 frame, a cap board all round its rim. What it
//     weighs full of wet soil is worked out and said: far more per square foot than a deck is framed for, so where it
//     stands matters (over a beam line, or on doubled joists).
import { ringEdges } from "./ringEdges";

export type BuiltInKind = "bench" | "bench-back" | "planter";
export const BUILT_IN_KINDS: readonly BuiltInKind[] = ["bench", "bench-back", "planter"];
export const BUILT_IN_LABEL: Record<BuiltInKind, string> = { bench: "Bench", "bench-back": "Bench with a back", planter: "Planter box" };
export type BuiltInSide = "front" | "left" | "right";
export const BUILT_IN_SIDES: readonly BuiltInSide[] = ["front", "left", "right"];
export const BUILT_IN_SIDE_LABEL: Record<BuiltInSide, string> = { front: "Front", left: "Left end", right: "Right end" };

/** One built-in: along `side`, centred `atFt` along it (a front: from the deck's left end; an end: out from the house line), `lengthFt` long. */
export interface BuiltIn {
  id: string;
  kind: BuiltInKind;
  side: BuiltInSide;
  atFt: number;
  lengthFt: number;
}

export const BUILT_IN_LIMITS = { count: 8, lengthFt: { min: 2, max: 30 }, planterFt: { min: 2, max: 10 } } as const;

/** Seat height above the boards, a bench back's height, a planter's depth front to back, in. */
export const BENCH_SEAT_IN = 18;
export const BENCH_BACK_IN = 36;
export const PLANTER_DEPTH_IN = 20;
/** Supports under a bench no farther apart than this, and how far in from its ends the first stands. */
export const BENCH_SUPPORT_MAX_IN = 48;
export const BENCH_END_IN = 4;
/** How far inside the deck's edge a built-in stands: clear of a top-mounted rail's posts, of a side-mounted rail, of nothing. */
export const BUILT_IN_INSET_IN = { top: 6, side: 2.5, none: 1.5 } as const;
/** Wet planting soil, lb per cubic foot; how deep it lies in a planter, in. */
export const SOIL_LB_PER_CUFT = 100;
export const PLANTER_SOIL_IN = 14;

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const half = (v: number) => Math.round(v * 2) / 2;

/** A built-in a contractor would add first: a bench in the middle of the front, a planter at a front corner. */
export function defaultBuiltIn(id: string, kind: BuiltInKind, widthFt: number): BuiltIn {
  if (kind === "planter") return { id, kind, side: "front", atFt: half(Math.min(widthFt / 2, 3)), lengthFt: 4 };
  return { id, kind, side: "front", atFt: half(widthFt / 2), lengthFt: Math.min(8, Math.max(BUILT_IN_LIMITS.lengthFt.min, half(widthFt - 4))) };
}

/** The list read back: eight at most, each with a name of its own, a kind, a side, a place and a length inside the limits. */
export function normalizeBuiltIns(raw: unknown, widthFt: number, depthFt: number): BuiltIn[] {
  const out: BuiltIn[] = [];
  const seen = new Set<string>();
  (Array.isArray(raw) ? raw : []).slice(0, BUILT_IN_LIMITS.count * 3).forEach((v, i) => {
    if (out.length >= BUILT_IN_LIMITS.count || !v || typeof v !== "object" || Array.isArray(v)) return;
    const o = v as Record<string, unknown>;
    const kind = BUILT_IN_KINDS.find((k) => k === o.kind);
    if (!kind) return;
    const side = BUILT_IN_SIDES.find((k) => k === o.side) ?? "front";
    let id = typeof o.id === "string" && /^[a-z0-9-]{1,14}$/.test(o.id) && !seen.has(o.id) ? o.id : "";
    for (let n = i + 1; !id; n++) if (!seen.has(`b${n}`)) id = `b${n}`;
    seen.add(id);
    const along = side === "front" ? widthFt : depthFt;
    const max = kind === "planter" ? BUILT_IN_LIMITS.planterFt.max : BUILT_IN_LIMITS.lengthFt.max;
    out.push({ id, kind, side, atFt: half(clamp(num(o.atFt, along / 2), 0, along)), lengthFt: half(clamp(num(o.lengthFt, kind === "planter" ? 4 : 8), BUILT_IN_LIMITS.lengthFt.min, max)) });
  });
  return out;
}

export type BuiltInRole = "bench leg" | "bench cleat" | "bench seat" | "bench apron" | "bench back post" | "bench back" | "bench cap" | "planter board" | "planter cap" | "planter soil";

/** One stick or board of a built-in: a box `sx` long along `yaw`, `sy` across, `sz` high, centred at (cx, cy, cz) — plan inches, z above the house-line ground. */
export interface BuiltInMember {
  role: BuiltInRole;
  nominal: string;
  lengthIn: number;
  cx: number;
  cy: number;
  cz: number;
  sx: number;
  sy: number;
  sz: number;
  yaw: number;
  of: string;
}

export interface BuiltInBuild {
  design: BuiltIn;
  kind: BuiltInKind;
  /** Built: false when its edge has no room for it (then `members` is empty and `why` says so). */
  built: boolean;
  why?: string;
  /** Its footprint on the boards, plan in.: the four corners in order. */
  footprint: Array<{ x: number; y: number }>;
  lengthIn: number;
  depthIn: number;
  /** Its top above the boards, in. */
  heightIn: number;
  members: BuiltInMember[];
  /** Counted: deck boards (seat, back, a planter's sides and cap), fascia (a bench's apron), 4x4, 2x4, all in feet; supports under a bench. */
  boardLf: number;
  apronLf: number;
  postLf: number;
  frameLf: number;
  supports: number;
  /** A planter: the soil it holds, cu ft; its weight full and wet, lb; that weight over its footprint, psf; a beam line under or beside it. */
  soilCuFt: number;
  weightLb: number;
  psf: number;
  overBeam: boolean;
  /** What it was fitted to, or runs into. */
  flags: { shortened: boolean; /** Shortened to stop at another built-in's face. */ beside: boolean; onStair: boolean; onSteps: boolean; overlaps: string[] };
}

export interface BuiltInsInput {
  items: readonly BuiltIn[];
  /** The deck's outline as its sides in order round it (the rail's own), the house's marked. */
  sides: ReadonlyArray<{ x0: number; y0: number; x1: number; y1: number; house: boolean; side: "front" | "back" | "left" | "right" }>;
  /** The walking surface above the house-line ground, in. */
  surfaceIn: number;
  /** The deck's boards: their face, thickness and the gap between two, in.; and how they are sold ("5/4x6"). */
  board: { widthIn: number; thickIn: number; gapIn: number; nominal: string };
  /** How the rail stands along a stretch of edge, if one does. */
  railAt: (x0: number, y0: number, x1: number, y1: number) => "top" | "side" | "none";
  /** Stretches of edge a stair's top stands on, and stretches wide steps run along. */
  stairTops: ReadonlyArray<{ x0: number; y0: number; x1: number; y1: number }>;
  wrapped: ReadonlyArray<{ x0: number; y0: number; x1: number; y1: number }>;
  /** The beams' lines under the deck (plan in.), for a planter's weight. */
  beams: ReadonlyArray<{ x0: number; y0: number; x1: number; y1: number }>;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Every built-in, set on its edge and built. */
export function buildBuiltIns(input: BuiltInsInput): BuiltInBuild[] {
  const { sides, surfaceIn: S, board } = input;
  if (!input.items.length || sides.length < 3) return [];
  const edges = ringEdges(sides.map((sd) => ({ x: sd.x0, y: sd.y0 })));
  const n = sides.length;
  const T = board.thickIn;
  const W = board.widthIn;
  const G = board.gapIn;
  const seatDepth = 3 * W + 2 * G;
  const out: BuiltInBuild[] = [];
  const ring = sides.map((sd) => ({ x: sd.x0, y: sd.y0 }));
  const inRing = (p: { x: number; y: number }) => {
    let c = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i];
      const b = ring[j];
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
    }
    return c;
  };
  const empty = (it: BuiltIn, why: string): BuiltInBuild => ({ design: it, kind: it.kind, built: false, why, footprint: [], lengthIn: 0, depthIn: 0, heightIn: 0, members: [], boardLf: 0, apronLf: 0, postLf: 0, frameLf: 0, supports: 0, soilCuFt: 0, weightLb: 0, psf: 0, overBeam: false, flags: { shortened: false, beside: false, onStair: false, onSteps: false, overlaps: [] } });

  for (const it of input.items) {
    const at = it.atFt * 12;
    // 1. Its edge: the open side of that name the place lies along — the outermost, where there are several.
    let pick = -1;
    let best = -Infinity;
    let pickT = 0;
    sides.forEach((sd, i) => {
      if (sd.house || sd.side !== it.side || edges[i].length < 24) return;
      const horizontal = it.side === "front";
      const a0 = horizontal ? sd.x0 : sd.y0;
      const a1 = horizontal ? sd.x1 : sd.y1;
      if (Math.abs(a1 - a0) < 1) return;
      const t = clamp((at - a0) / (a1 - a0), 0, 1);
      const inside = at >= Math.min(a0, a1) - 0.5 && at <= Math.max(a0, a1) + 0.5;
      const px = sd.x0 + (sd.x1 - sd.x0) * t;
      const py = sd.y0 + (sd.y1 - sd.y0) * t;
      // (Outermost: the farthest out for a front, the farthest left or right for an end; one the place lies on first.)
      const reach = (it.side === "front" ? py : it.side === "left" ? -px : px) + (inside ? 1e6 : -Math.abs(at - clamp(at, Math.min(a0, a1), Math.max(a0, a1))));
      if (reach > best) {
        best = reach;
        pick = i;
        pickT = t * edges[i].length;
      }
    });
    if (pick < 0) {
      out.push(empty(it, "no open edge on that side"));
      continue;
    }
    const sd = sides[pick];
    const e = edges[pick];
    const inX = -e.outX;
    const inY = -e.outY;
    const mount = input.railAt(sd.x0, sd.y0, sd.x1, sd.y1);
    const inset = BUILT_IN_INSET_IN[mount];
    const depth = it.kind === "planter" ? PLANTER_DEPTH_IN : it.kind === "bench-back" ? seatDepth + 3.5 : seatDepth;
    // 2. Kept on its edge: clear of the next edge's own rail (or of what stands along it) at a corner that turns round the deck.
    const prev = edges[(pick - 1 + n) % n];
    const lo = prev.turnAtB > 0.3 ? inset : 0.5;
    const hi = e.length - (e.turnAtB > 0.3 ? inset : 0.5);
    const want = it.lengthFt * 12;
    const room = hi - lo;
    if (room < BUILT_IN_LIMITS.lengthFt.min * 12) {
      out.push(empty(it, "that edge is too short for it"));
      continue;
    }
    let len = Math.min(want, room);
    let a0 = clamp(pickT - len / 2, lo, hi - len);
    let a1 = a0 + len;
    // 2b. Beside one already built (two benches that meet at a corner): this one stops at the other's face — the
    // longer of what is left of it on either side.
    let beside = false;
    let squeezed = false;
    for (const o of out) {
      if (!o.built) continue;
      const as = o.footprint.map((p) => (p.x - sd.x0) * e.ux + (p.y - sd.y0) * e.uy);
      const bs = o.footprint.map((p) => (p.x - sd.x0) * inX + (p.y - sd.y0) * inY - inset);
      const [oa0, oa1, ob0, ob1] = [Math.min(...as), Math.max(...as), Math.min(...bs), Math.max(...bs)];
      if (ob1 <= 0.25 || ob0 >= depth - 0.25 || oa1 <= a0 + 0.25 || oa0 >= a1 - 0.25) continue;
      const before = oa0 - 0.25 - a0;
      const after = a1 - (oa1 + 0.25);
      if (Math.max(before, after) < BUILT_IN_LIMITS.lengthFt.min * 12) {
        squeezed = true;
        break;
      }
      if (before >= after) a1 = oa0 - 0.25;
      else a0 = oa1 + 0.25;
      len = a1 - a0;
      beside = true;
    }
    if (squeezed) {
      out.push(empty(it, "another built-in stands there"));
      continue;
    }
    // 2c. All of it on the deck: where the deck is narrower than the built-in is deep (a thin part, the tip of a cut
    // corner, the house's corner beside it) there is nothing to stand it on.
    {
      const at2 = (a: number, b: number) => ({ x: sd.x0 + e.ux * a + inX * (inset + b), y: sd.y0 + e.uy * a + inY * (inset + b) });
      const onDeck = [0, 0.25, 0.5, 0.75, 1].every((t) => [0.25, depth - 0.25].every((b) => inRing(at2(a0 + 0.25 + (len - 0.5) * t, b))));
      if (!onDeck) {
        out.push(empty(it, "the deck is too narrow there for it"));
        continue;
      }
    }
    const shortened = len < want - 0.01;
    /** A point of it: `a` along its edge from the edge's start, `b` in from its back line, into the deck. */
    const P = (a: number, b: number) => ({ x: sd.x0 + e.ux * a + inX * (inset + b), y: sd.y0 + e.uy * a + inY * (inset + b) });
    const footprint = [P(a0, 0), P(a1, 0), P(a1, depth), P(a0, depth)];
    // What stands in its way along the edge.
    const overlapsRun = (g: { x0: number; y0: number; x1: number; y1: number }) => {
      const off = (x: number, y: number) => Math.abs((x - sd.x0) * e.outX + (y - sd.y0) * e.outY);
      if (off(g.x0, g.y0) > 1.5 || off(g.x1, g.y1) > 1.5) return false;
      const t0 = (g.x0 - sd.x0) * e.ux + (g.y0 - sd.y0) * e.uy;
      const t1 = (g.x1 - sd.x0) * e.ux + (g.y1 - sd.y0) * e.uy;
      return Math.max(t0, t1) > a0 + 0.5 && Math.min(t0, t1) < a1 - 0.5;
    };
    const onStair = input.stairTops.some(overlapsRun);
    const onSteps = input.wrapped.some(overlapsRun);

    const members: BuiltInMember[] = [];
    /** A box `la` long along the edge and `lb` across it, centred at (`a`, `b`) and `z` above the boards. */
    const put = (role: BuiltInRole, nominal: string, lengthIn: number, a: number, b: number, z: number, la: number, lb: number, lz: number) => {
      const c = P(a, b);
      members.push({ role, nominal, lengthIn: r2(lengthIn), cx: r2(c.x), cy: r2(c.y), cz: r2(S + z), sx: r2(la), sy: r2(lb), sz: r2(lz), yaw: e.yaw, of: it.id });
    };
    let boardIn = 0;
    let apronIn = 0;
    let postIn = 0;
    let frameIn = 0;
    let supports = 0;
    let heightIn = BENCH_SEAT_IN;
    let soilCuFt = 0;
    let weightLb = 0;
    let psf = 0;
    let overBeam = false;
    const mid = (a0 + a1) / 2;

    if (it.kind === "planter") {
      // Three boards high on feet that keep it off the deck's boards, a cap board all round the rim, the soil inside.
      const foot = 0.75;
      const wallTop = foot + 3 * W + 2 * G;
      heightIn = wallTop + T;
      for (let r = 0; r < 3; r++) {
        const z = foot + r * (W + G) + W / 2;
        put("planter board", board.nominal, len, mid, T / 2, z, len, T, W);
        put("planter board", board.nominal, len, mid, depth - T / 2, z, len, T, W);
        put("planter board", board.nominal, depth - 2 * T, a0 + T / 2, depth / 2, z, T, depth - 2 * T, W);
        put("planter board", board.nominal, depth - 2 * T, a1 - T / 2, depth / 2, z, T, depth - 2 * T, W);
      }
      boardIn += 3 * (2 * len + 2 * (depth - 2 * T));
      // The cap: a board flat along each long side, standing ¾ in. proud all round; two short ones between them at the ends.
      const proud = 0.75;
      const capZ = wallTop + T / 2;
      put("planter cap", board.nominal, len + 2 * proud, mid, W / 2 - proud, capZ, len + 2 * proud, W, T);
      put("planter cap", board.nominal, len + 2 * proud, mid, depth - W / 2 + proud, capZ, len + 2 * proud, W, T);
      const between = depth + 2 * proud - 2 * W;
      if (between > 0.5) {
        put("planter cap", board.nominal, between, a0 + W / 2 - proud, depth / 2, capZ, W, between, T);
        put("planter cap", board.nominal, between, a1 - W / 2 + proud, depth / 2, capZ, W, between, T);
        boardIn += 2 * between;
      }
      boardIn += 2 * (len + 2 * proud);
      // The soil, a hand below the rim.
      const soilTop = wallTop - 2;
      put("planter soil", "", len - 2 * T, mid, depth / 2, soilTop - 1, len - 2 * T - 0.1, depth - 2 * T - 0.1, 2);
      // The frame inside: a 2x4 upright at each corner and every 32 in. along the long sides, two sleepers under it.
      const uprights = 4 + 2 * Math.max(0, Math.ceil(len / 32 - 1e-9) - 1);
      frameIn += uprights * (wallTop - foot) + 2 * len;
      soilCuFt = ((len - 2 * T) * (depth - 2 * T) * PLANTER_SOIL_IN) / 1728;
      weightLb = soilCuFt * SOIL_LB_PER_CUFT + ((boardIn / 12) * 2.2 + (frameIn / 12) * 1.3);
      psf = weightLb / ((len * depth) / 144);
      // A beam line under it, or within a foot of it: the weight goes down where the posts are.
      const fx = footprint.map((p) => p.x);
      const fy = footprint.map((p) => p.y);
      const box = { x0: Math.min(...fx) - 12, x1: Math.max(...fx) + 12, y0: Math.min(...fy) - 12, y1: Math.max(...fy) + 12 };
      overBeam = input.beams.some((b) => Math.max(b.x0, b.x1) > box.x0 && Math.min(b.x0, b.x1) < box.x1 && Math.max(b.y0, b.y1) > box.y0 && Math.min(b.y0, b.y1) < box.y1);
    } else {
      const back = it.kind === "bench-back";
      // (With a back: a row of 4x4 posts behind the seat, the seat in front of them.)
      const b0 = back ? 3.5 : 0;
      for (let r = 0; r < 3; r++) put("bench seat", board.nominal, len, mid, b0 + W / 2 + r * (W + G), BENCH_SEAT_IN - T / 2, len, W, T);
      boardIn += 3 * len;
      // The apron: fascia under the seat all round, half an inch in from its edge (at the back, the posts stand there).
      const lip = 0.5;
      const A = 0.75;
      const apronH = 5.5;
      const apronZ = BENCH_SEAT_IN - T - apronH / 2;
      /** Between the aprons (or from the posts' faces to the front apron): what the cleats and the end aprons span. */
      const inner0 = b0 + (back ? 0 : lip + A);
      const inner1 = b0 + seatDepth - lip - A;
      put("bench apron", "1x6", len - 2 * lip, mid, inner1 + A / 2, apronZ, len - 2 * lip, A, apronH);
      if (!back) put("bench apron", "1x6", len - 2 * lip, mid, inner0 - A / 2, apronZ, len - 2 * lip, A, apronH);
      for (const a of [a0 + lip + A / 2, a1 - lip - A / 2]) put("bench apron", "1x6", inner1 - inner0, a, (inner0 + inner1) / 2, apronZ, A, inner1 - inner0, apronH);
      apronIn += (back ? 1 : 2) * (len - 2 * lip) + 2 * (inner1 - inner0);
      // The supports: 4x4 legs under a 2x4 cleat, no more than 4 ft apart, the first 4 in. in from each end.
      supports = Math.max(2, Math.ceil((len - 2 * BENCH_END_IN) / BENCH_SUPPORT_MAX_IN - 1e-9) + 1);
      const legTop = BENCH_SEAT_IN - T - 1.5;
      for (let k = 0; k < supports; k++) {
        const a = a0 + BENCH_END_IN + 1.75 + ((len - 2 * BENCH_END_IN - 3.5) * k) / (supports - 1);
        put("bench cleat", "2x4", inner1 - inner0, a, (inner0 + inner1) / 2, legTop + 0.75, 3.5, inner1 - inner0, 1.5);
        frameIn += inner1 - inner0;
        put("bench leg", "4x4", legTop, a, inner1 - 1.75, legTop / 2, 3.5, 3.5, legTop);
        postIn += legTop;
        if (back) {
          // The back's post: from the boards to the cap; the seat's cleat is lagged to its face.
          put("bench back post", "4x4", BENCH_BACK_IN, a, 1.75, BENCH_BACK_IN / 2, 3.5, 3.5, BENCH_BACK_IN);
          postIn += BENCH_BACK_IN;
        } else {
          put("bench leg", "4x4", legTop, a, inner0 + 1.75, legTop / 2, 3.5, 3.5, legTop);
          postIn += legTop;
        }
      }
      if (back) {
        // Two boards across the posts' faces above the seat, and a cap board on top of the posts.
        heightIn = BENCH_BACK_IN + T;
        for (const z of [BENCH_BACK_IN - 0.5 - W / 2, BENCH_BACK_IN - 2 - 1.5 * W]) put("bench back", board.nominal, len, mid, b0 + T / 2, z, len, T, W);
        put("bench cap", board.nominal, len, mid, b0 + T - W / 2, BENCH_BACK_IN + T / 2, len, W, T);
        boardIn += 3 * len;
      }
    }
    out.push({ design: it, kind: it.kind, built: true, footprint, lengthIn: r2(len), depthIn: r2(depth), heightIn: r2(heightIn), members, boardLf: r2(boardIn / 12), apronLf: r2(apronIn / 12), postLf: r2(postIn / 12), frameLf: r2(frameIn / 12), supports, soilCuFt: r2(soilCuFt), weightLb: Math.round(weightLb), psf: Math.round(psf), overBeam, flags: { shortened, beside, onStair, onSteps, overlaps: [] } });
  }

  // 3. Two that stand on the same boards.
  const cross = (A: Array<{ x: number; y: number }>, B: Array<{ x: number; y: number }>) => {
    for (const poly of [A, B]) {
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i];
        const q = poly[(i + 1) % poly.length];
        const nx = q.y - p.y;
        const ny = p.x - q.x;
        const l = Math.hypot(nx, ny) || 1;
        const pa = A.map((v) => (v.x * nx + v.y * ny) / l);
        const pb = B.map((v) => (v.x * nx + v.y * ny) / l);
        if (Math.max(...pa) <= Math.min(...pb) + 0.25 || Math.max(...pb) <= Math.min(...pa) + 0.25) return false;
      }
    }
    return true;
  };
  for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) {
    if (!out[i].built || !out[j].built || !cross(out[i].footprint, out[j].footprint)) continue;
    out[i].flags.overlaps.push(out[j].design.id);
    out[j].flags.overlaps.push(out[i].design.id);
  }
  return out;
}

/** "an 8-ft bench along the front" */
export function builtInWords(b: BuiltInBuild): string {
  const ft = Math.round((b.lengthIn / 12) * 2) / 2;
  const what = b.kind === "planter" ? "planter box" : b.kind === "bench-back" ? "bench with a back" : "bench";
  return `${/^(8|11|18)/.test(String(ft)) ? "an" : "a"} ${ft}-ft ${what} along the ${b.design.side === "front" ? "front" : `${b.design.side} end`}`;
}
