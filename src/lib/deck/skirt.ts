// SKIRTING UNDER THE DECK (2026-11-14) — pure.
//
// The owner asked for "more options to build luxury". A raised deck's frame, posts and the dark under it are what a
// finished deck hides: skirting hung under the rim along every open edge, down to a hand above the ground — framed
// lattice (it breathes), or the deck's own boards laid level with a gap between them. The studio could not draw it:
// said out loud it became a line of the contractor's own with no drawing and no figure behind it.
//
// Where it goes: every open edge of the deck — not the house, not an edge wide steps run along (they close it
// themselves), not under a stair's top, not where a lower level meets the deck — where there is a foot or more between
// the frame and the ground. It hangs in the fascia's plane, outside the rim, so nothing of the frame is in its way;
// where a post stands at the deck's very edge (a flush beam, joists with no overhang) the skirt is cut round it, and it
// rides over that post's pier. It is built in bays of 8 ft at most (a lattice sheet's length): on a slope each bay stops
// a hand above the highest ground under it, so the bottom steps down with the grade.
// What is counted: its square feet, the boards of a board skirt by the foot, and the treated 2x4 frame behind it.
import { ringEdges } from "./ringEdges";

export type SkirtKind = "none" | "lattice" | "boards";
export const SKIRT_KINDS: readonly SkirtKind[] = ["none", "lattice", "boards"];
export const SKIRT_LABEL: Record<SkirtKind, string> = { none: "None", lattice: "Lattice, framed", boards: "Deck boards, laid level" };

/** The least room between the frame and the ground worth skirting, in.; the air left between the skirt and the soil. */
export const SKIRT_MIN_IN = 12;
export const SKIRT_GROUND_CLEAR_IN = 2;
/** Its thickness, and how far off the rim's face it hangs (the fascia's own plane). */
export const SKIRT_THICK_IN = 0.75;
export const SKIRT_CLEAR_IN = 1 / 32;
/** A board skirt: the board's face and the gap between two — half an inch, so the frame behind it breathes. */
export const SKIRT_BOARD_IN = 5.5;
export const SKIRT_GAP_IN = 0.5;
/** The longest bay (a lattice sheet is 8 ft), and the 1x4 border round a lattice bay. */
export const SKIRT_BAY_MAX_IN = 96;
export const SKIRT_BORDER_IN = 3.5;
/** The 2x4 uprights behind it: every 2 ft behind boards, every 4 ft behind lattice. */
export const SKIRT_UPRIGHT_IN: Record<Exclude<SkirtKind, "none">, number> = { boards: 24, lattice: 48 };

/** One bay of skirting under one edge: from (`x0`, `y0`) to (`x1`, `y1`) along the deck's edge, from `topIn` down to `bottomIn` above the house-line ground; `outX/outY` the way out of the deck. */
export interface SkirtPanel {
  level: "upper" | "lower";
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  topIn: number;
  bottomIn: number;
  lengthIn: number;
  yaw: number;
  outX: number;
  outY: number;
  /** The first bay of its run (a run: one unbroken stretch between corners, stairs and posts). */
  first: boolean;
}

export interface SkirtBuild {
  kind: Exclude<SkirtKind, "none">;
  panels: SkirtPanel[];
  sqFt: number;
  lf: number;
  /** The tallest bay, in. */
  heightIn: number;
  /** Open edge it was left off because the deck is too near the ground there, ft. */
  lowFt: number;
  /** A board skirt's boards, ft (0 for lattice). */
  boardLf: number;
  /** The treated 2x4 frame behind it: a rail under the rim, one a hand off the ground, the uprights. Ft. */
  frameLf: number;
  /** Bays cut round a post that stands at the deck's edge. */
  roundPosts: number;
}

/** One deck the skirt goes under: its outline, what leaves it, and what stands at its edge. */
export interface SkirtLevelInput {
  id: "upper" | "lower";
  /** The deck's outline as its sides in order round it (the rail's own), the house's marked. */
  sides: ReadonlyArray<{ x0: number; y0: number; x1: number; y1: number; house: boolean }>;
  /** Stretches of edge that wide steps run along. */
  wrapped: ReadonlyArray<{ x0: number; y0: number; x1: number; y1: number }>;
  /** Stretches of edge left open: a stair's top, where a lower level meets the deck. */
  openings: ReadonlyArray<{ x0: number; y0: number; x1: number; y1: number }>;
  /** The posts under the deck: half their face, half their pier, and the pier's top above the house-line ground. */
  posts: ReadonlyArray<{ x: number; y: number; halfIn: number; pierHalfIn: number; pierTopIn: number }>;
  /** The underside of the frame at the deck's edge, inches above the house-line ground. */
  topIn: number;
}

export interface SkirtInput {
  kind: SkirtKind;
  levels: readonly SkirtLevelInput[];
  groundAt: (x: number, y: number) => number;
}

/**
 * How far a run goes past its far corner, so that no two runs (square-ended boards outside the edge, `t` thick) cross:
 * on past a square outside corner, to close it against the next run's back; short of an inside corner, to stop at the
 * next run's face; at an outside corner cut at an angle the two meet at the corner itself. Negative = stops short.
 */
export function skirtCornerRun(turnAtB: number, t: number): number {
  if (!Number.isFinite(turnAtB) || Math.abs(turnAtB) < 1e-6) return 0;
  if (turnAtB > 0) return Math.abs(turnAtB - Math.PI / 2) < 0.02 ? t : 0;
  const a = Math.min(-turnAtB, 2.6);
  return -t * (a <= Math.PI / 2 ? Math.sin(a) : Math.tan(a / 2));
}

/** How many boards high a board skirt of height `h` is (the last one ripped to fit). */
export function skirtBoardRows(h: number): number {
  return Math.max(1, Math.ceil((h - 1) / (SKIRT_BOARD_IN + SKIRT_GAP_IN) - 1e-9));
}

/** The skirting for a deck: null when none is asked for, or the deck is too low for any. */
export function buildSkirt(input: SkirtInput): SkirtBuild | null {
  if (input.kind === "none") return null;
  const kind = input.kind;
  const panels: SkirtPanel[] = [];
  let lowIn = 0;
  let roundPosts = 0;
  let frameIn = 0;
  let boardIn = 0;
  const near = (a: number, b: number) => Math.abs(a - b) < 0.6;

  for (const lv of input.levels) {
    const n = lv.sides.length;
    if (n < 3 || !Number.isFinite(lv.topIn)) continue;
    const edges = ringEdges(lv.sides.map((sd) => ({ x: sd.x0, y: sd.y0 })));
    const onSteps = (sd: { x0: number; y0: number; x1: number; y1: number }) => lv.wrapped.some((g) => (near(g.x0, sd.x0) && near(g.y0, sd.y0) && near(g.x1, sd.x1) && near(g.y1, sd.y1)) || (near(g.x0, sd.x1) && near(g.y0, sd.y1) && near(g.x1, sd.x0) && near(g.y1, sd.y0)));
    const open = lv.sides.map((sd, i) => !sd.house && edges[i].length >= 12 && !onSteps(sd));

    // 1. What is left of each open edge between the stairs that leave it and the posts that stand on it.
    const cutPosts: number[] = lv.sides.map(() => 0);
    const runsOf: Array<Array<[number, number]>> = lv.sides.map((sd, i) => {
      if (!open[i]) return [];
      const e = edges[i];
      const along = (x: number, y: number) => (x - sd.x0) * e.ux + (y - sd.y0) * e.uy;
      const out = (x: number, y: number) => (x - sd.x0) * e.outX + (y - sd.y0) * e.outY;
      const gaps: Array<[number, number]> = [];
      for (const o of lv.openings) {
        const on0 = Math.abs(out(o.x0, o.y0)) <= 1.5;
        const on1 = Math.abs(out(o.x1, o.y1)) <= 1.5;
        if (on0 && on1) gaps.push([Math.min(along(o.x0, o.y0), along(o.x1, o.y1)) - 1, Math.max(along(o.x0, o.y0), along(o.x1, o.y1)) + 1]);
        // An opening that only TOUCHES this edge at one of its ends (a lower level in front of a corner cut at an
        // angle: its own skirt starts at that point, square to the front): this run stops a thickness short of it.
        else for (const [x, y, on] of [[o.x0, o.y0, on0], [o.x1, o.y1, on1]] as const) {
          const a = along(x, y);
          if (on && a > -1.5 && a < e.length + 1.5) gaps.push([a - SKIRT_THICK_IN - SKIRT_CLEAR_IN - 0.02, a + SKIRT_THICK_IN + SKIRT_CLEAR_IN + 0.02]);
        }
      }
      for (const q of lv.posts) {
        // (A square post on an edge that runs at an angle reaches farther along it and across it.)
        const reach = q.halfIn * (Math.abs(e.ux) + Math.abs(e.uy));
        const c = out(q.x, q.y);
        if (c + reach <= SKIRT_CLEAR_IN || c - reach >= SKIRT_CLEAR_IN + SKIRT_THICK_IN) continue;
        const a = along(q.x, q.y);
        if (a + reach <= 0 || a - reach >= e.length) continue;
        gaps.push([a - reach - 1 / 16, a + reach + 1 / 16]);
        cutPosts[i] += 1;
      }
      gaps.sort((p, q) => p[0] - q[0]);
      const runs: Array<[number, number]> = [];
      let from = 0;
      for (const [a, b] of gaps) {
        if (a - from > 6) runs.push([from, Math.min(a, e.length)]);
        from = Math.max(from, b);
      }
      if (e.length - from > 6) runs.push([from, e.length]);
      return runs;
    });

    // 2. Bay by bay. Like a fascia board, a run that reaches a square corner goes on past an outside one to close it
    // against the next run's back, and stops short of an inside one — where the next edge's skirt starts at that corner.
    lv.sides.forEach((sd, i) => {
      const e = edges[i];
      const runs = runsOf[i];
      if (!runs.length) return;
      roundPosts += cutPosts[i];
      const nextRuns = runsOf[(i + 1) % n];
      const out = (x: number, y: number) => (x - sd.x0) * e.outX + (y - sd.y0) * e.outY;
      const along = (x: number, y: number) => (x - sd.x0) * e.ux + (y - sd.y0) * e.uy;
      runs.forEach(([a0, b0], ri) => {
        const meets = ri === runs.length - 1 && b0 >= e.length - 0.01 && nextRuns.length > 0 && nextRuns[0][0] <= 0.01;
        const b1 = meets ? b0 + skirtCornerRun(e.turnAtB, SKIRT_THICK_IN + SKIRT_CLEAR_IN) : b0;
        const len = b1 - a0;
        if (!(len > 6)) return;
        const bays = Math.max(1, Math.ceil(len / SKIRT_BAY_MAX_IN - 1e-9));
        let firstOfRun = true;
        for (let k = 0; k < bays; k++) {
          const a = a0 + (len * k) / bays;
          const b = a0 + (len * (k + 1)) / bays;
          const at = (t: number) => input.groundAt(sd.x0 + e.ux * t, sd.y0 + e.uy * t);
          let bottomIn = Math.max(at(a), at((a + b) / 2), at(b)) + SKIRT_GROUND_CLEAR_IN;
          // Over the pier of a post that stands at the edge (its concrete comes up past the skirt's line).
          for (const q of lv.posts) {
            const c = out(q.x, q.y);
            if (c + q.pierHalfIn <= SKIRT_CLEAR_IN || c - q.pierHalfIn >= SKIRT_CLEAR_IN + SKIRT_THICK_IN) continue;
            const t = along(q.x, q.y);
            if (t + q.pierHalfIn <= a || t - q.pierHalfIn >= b) continue;
            bottomIn = Math.max(bottomIn, q.pierTopIn + 0.5);
          }
          const h = lv.topIn - bottomIn;
          if (h < SKIRT_MIN_IN) {
            lowIn += b - a;
            continue;
          }
          panels.push({ level: lv.id, x0: sd.x0 + e.ux * a, y0: sd.y0 + e.uy * a, x1: sd.x0 + e.ux * b, y1: sd.y0 + e.uy * b, topIn: lv.topIn, bottomIn, lengthIn: b - a, yaw: e.yaw, outX: e.outX, outY: e.outY, first: firstOfRun });
          // The frame behind the bay: two rails, an upright every 2 ft (boards) or 4 ft (lattice), one more to close the run.
          frameIn += 2 * (b - a) + (Math.ceil((b - a) / SKIRT_UPRIGHT_IN[kind] - 1e-9) + (firstOfRun ? 1 : 0)) * h;
          if (kind === "boards") boardIn += skirtBoardRows(h) * (b - a);
          firstOfRun = false;
        }
      });
    });
    // Edge left off entirely because it is too short, or a stair or post takes all of it, is not "too low".
  }
  if (!panels.length) return null;
  const sqFt = panels.reduce((a, q) => a + (q.lengthIn * (q.topIn - q.bottomIn)) / 144, 0);
  const r1 = (v: number) => Math.round(v * 10) / 10;
  return { kind, panels, sqFt: r1(sqFt), lf: r1(panels.reduce((a, q) => a + q.lengthIn, 0) / 12), heightIn: Math.round(Math.max(...panels.map((q) => q.topIn - q.bottomIn))), lowFt: r1(lowIn / 12), boardLf: r1(boardIn / 12), frameLf: r1(frameIn / 12), roundPosts };
}
