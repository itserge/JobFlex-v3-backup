// THE WALL'S STEPS FROM THE PHOTO'S OWN PIXELS (2026-10-23 night; the eave found on its own 2026-10-24). Pure. Owner,
// with the live read beside the house he expects: "still wrong — should be like on the second pic". The vision
// model, asked where the wall steps, found one corner of the bump-out and read it the wrong way round (the porch
// roof's side as the part standing out). The picture itself says both things plainly:
//   · WHERE the wall steps — a corner board runs the whole height of the wall, up BOTH storeys without a break; a
//     window's frame stands up only within its own storey, a porch post only below the porch roof;
//   · WHICH WAY — a part of the wall nearer the camera shows its eave higher in the picture (it is closer; the same
//     height looks taller) — a few per cent of the wall's height for a 2-ft bump-out seen across a yard. A porch roof
//     in front of a part does not move that part's eave.
// So: the corners where an edge runs up both storeys, then each part's eave — the shadow of soffit, fascia and gutter
// over the wall above it — compared across each corner. The eave is found by the picture, not by the model's line:
// the model draws its eave line a few per cent off (on the gutter, under the soffit), so the plainest shadow band with
// wall standing brighter under it, in a wide window around that line, is the eave; the other parts' eaves are looked
// for near it, and the darkest row of each (where the soffit meets the wall) is the row compared. The rows are read
// along the model's eave line, so the slope of a shot taken from one side is mostly taken out (an angled shot is
// straightened before this). Nothing is said where the photo doesn't show it plainly (no corner, no eave to match):
// the model's read stands.
//
// THE WALL'S WAY ACROSS THE PICTURE IS THE PHOTO'S TOO (2026-10-24 — owner, the same photo: "still wrong"). The model's
// eave and base lines lean a few per cent off the wall's real ones. Leaning 1½ % of the picture, the rows read along
// the model's line moved each part's band by more than a bump-out's step and the middle read level; leaning 3 %, the
// two lines looked like an angled shot, the square-on photo was "straightened", its corner boards leaned, no corner was
// found and the model's own steps stood. So the rows are read along the windows' heads — windows in one row on one
// part of the wall stand at one height on one plane (wallSlope) — and an angled shot is told by the upper row's heads
// against the lower row's (photoObliqueness): parallel on a wall shot square-on, closing toward the far end on an
// angled one. (The soffit's sharpest edge was tried for the slope and dropped: a porch roof's lower edge is sharper.)
//
// On the grey picture the browser makes of the photo (lib/deck/photoSnap's Gray), in the read's own fractions.

import type { WallJog } from "./photoFit";
import type { HouseRead } from "./houseRead";
import { inFrontAt } from "./houseInFront";
import { gradients, type Gray } from "./photoSnap";

export type PartState = "out" | "back" | "level" | "unknown";

export interface WallStepsFound {
  /** The wall's steps as the pixels say them — in the read's terms (x, y on the base, "toward" when the part to the
   *  right is nearer the camera). */
  jogs: WallJog[];
  /** The corners found (fractions across the picture) and each part between them. */
  corners: number[];
  /** Each part: out, back or level against the main wall, by how far its eave's shadow band sits above (−) or below
   *  the main wall's, px; `corr` how plainly that band shows (0…1). */
  parts: Array<{ x0: number; x1: number; state: PartState; shiftPx: number; corr: number }>;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const lineY = (l: { left: { x: number; y: number }; right: { x: number; y: number } }, x: number) => l.left.y + ((l.right.y - l.left.y) * (x - l.left.x)) / Math.max(1e-6, l.right.x - l.left.x);
const median = (a: number[]) => {
  const s = [...a].sort((p, q) => p - q);
  return s[Math.floor(s.length / 2)];
};
type Line = { left: { x: number; y: number }; right: { x: number; y: number } };
const r4 = (n: number) => Math.round(n * 10000) / 10000;

/** `l` turned about its middle to `slope` — px down per px across on a picture `g.w` × `g.h`. */
export function lineAtSlope(l: Line, slope: number, g: { w: number; h: number }): Line {
  const xm = (l.left.x + l.right.x) / 2;
  const ym = lineY(l, xm);
  const k = (slope * g.w) / g.h;
  return { left: { x: l.left.x, y: r4(ym + k * (l.left.x - xm)) }, right: { x: l.right.x, y: r4(ym + k * (l.right.x - xm)) } };
}

/** The read with its eave and base lines turned to `slope` about their middles — a wall shot square-on: every line
 *  across it runs the same way, whatever the model drew. */
export function levelRead(read: HouseRead, slope: number, g: { w: number; h: number }): HouseRead {
  return { ...read, base: lineAtSlope(read.base, slope, g), eave: read.eave ? lineAtSlope(read.eave, slope, g) : null };
}

/** Under this many per cent off square, by the photo's own rows of windows, a shot is square-on: the model's lines are
 *  turned parallel and nothing is straightened (an angled shot measures 8 % and up; the rows' own reading wanders a few
 *  per cent, so the line is drawn well under that). */
export const SQUARE_ON_PCT = 5;

/** A window's middle across the picture (fraction). */
const centreOf = (win: { x0: number; x1: number }) => (win.x0 + win.x1) / 2;

/**
 * The wall's windows in rows: each storey's windows (a two-storey wall split at 0.4 of its height under the eave),
 * each with the part of the wall it stands in (between two of `corners`). Only windows inside the wall's span.
 */
function windowRows(read: HouseRead, g: { w: number; h: number }, corners: number[]) {
  const { h } = g;
  const xL = Math.min(read.base.left.x, read.base.right.x);
  const xR = Math.max(read.base.left.x, read.base.right.x);
  const yE = (x: number) => (read.eave ? lineY(read.eave, x) : lineY(read.base, x) - 0.3) * h;
  const Hm = (x: number) => lineY(read.base, x) * h - yE(x);
  const partOf = (x: number) => corners.filter((c) => c < x).length;
  const inWall = read.windows.filter((win) => centreOf(win) > xL && centreOf(win) < xR && win.head * h > yE(centreOf(win)));
  const row = (lower: boolean) => inWall.filter((win) => (win.head * h > yE(centreOf(win)) + Hm(centreOf(win)) * 0.4) === lower).map((win) => ({ win, x: centreOf(win), part: partOf(centreOf(win)) }));
  return { xL, xR, lower: row(true), upper: row(false) };
}

/** The slopes (px down per px across) that pairs of window heads in one row and one part of the wall give — one plane,
 *  one head height, so the pair runs the wall's own way across the picture. Pairs closer than a tenth of the wall are
 *  left out (a pixel at their heads is too much slope). Each with its weight, the pair's spread. */
function headSlopes(row: Array<{ win: { head: number }; x: number; part: number }>, g: { w: number; h: number }, minDx: number): Array<{ s: number; wt: number }> {
  const out: Array<{ s: number; wt: number }> = [];
  for (let i = 0; i < row.length; i++)
    for (let j = i + 1; j < row.length; j++) {
      if (row[i].part !== row[j].part) continue;
      const dx = (row[j].x - row[i].x) * g.w;
      if (Math.abs(dx) < minDx * g.w) continue;
      out.push({ s: ((row[j].win.head - row[i].win.head) * g.h) / dx, wt: Math.abs(dx) });
    }
  return out;
}

/** The weighted median of `xs`. */
function weightedMedian(xs: Array<{ s: number; wt: number }>): number {
  const sorted = [...xs].sort((a, b) => a.s - b.s);
  const half = sorted.reduce((t, x) => t + x.wt, 0) / 2;
  let run = 0;
  for (const x of sorted) {
    run += x.wt;
    if (run >= half) return x.s;
  }
  return sorted[sorted.length - 1].s;
}

/**
 * The way the wall runs across the picture, px down per px across — from its windows' heads (lined up with their own
 * edges by photoSnap first), never the model's two lines: windows in one row and one part of the wall stand on one
 * plane at one head height. Null when no two windows of a part share a row far enough apart.
 */
export function wallSlope(read: HouseRead, g: { w: number; h: number }, corners: number[]): number | null {
  const { xL, xR, lower, upper } = windowRows(read, g, corners);
  const pairs = [...headSlopes(lower, g, (xR - xL) * 0.1), ...headSlopes(upper, g, (xR - xL) * 0.1)];
  return pairs.length ? Math.round(weightedMedian(pairs) * 1e5) / 1e5 : null;
}

/**
 * How far off square the shot is, percent — told by the picture, not the model's two lines (owner's photo, 2026-10-24:
 * the model's eave leaned 3 % and a square-on shot was "straightened"): the upper storey's window heads against the
 * lower storey's. Shot square-on, the two rows run parallel however the phone was held; shot from one side, they close
 * toward the far end, and the gap between them at each end of the wall is how tall that end stands. `slope` is the
 * wall's way across the picture (wallSlope), for levelRead. Null when the picture doesn't say — one row of windows, or
 * rows too short to measure (the model's lines decide then).
 */
export function photoObliqueness(read: HouseRead, g: Gray): { slope: number; obliquePct: number } | null {
  const corners = wallCorners(read, g);
  const { xL, xR, lower, upper } = windowRows(read, g, corners);
  const span = xR - xL;
  const lineOf = (row: typeof lower) => {
    const xs = row.map((r) => r.x);
    if (row.length < 2 || Math.max(...xs) - Math.min(...xs) < span / 3) return null;
    const pairs = headSlopes(row, g, span * 0.1);
    if (!pairs.length) return null;
    const s = weightedMedian(pairs);
    const mid = (xL + xR) / 2;
    // The row's head height at the wall's middle: each window's head carried along that slope, the median of them.
    return { s, at: median(row.map((r) => r.win.head * g.h - s * (r.x - mid) * g.w)) };
  };
  const lo = lineOf(lower);
  const up = lineOf(upper);
  if (!lo || !up) return null;
  const gap = lo.at - up.at;
  if (gap < 8) return null;
  const delta = Math.abs(lo.s - up.s) * span * g.w;
  const slope = wallSlope(read, g, corners) ?? (lo.s + up.s) / 2;
  return { slope, obliquePct: Math.round((delta / (gap + delta / 2)) * 100) };
}

/** The corners of the wall: columns where an edge stands up through every storey of it. Fractions across the
 *  picture, left to right. What stands in front of the wall — an old deck and its railing, a porch roof and the posts
 *  under it, a tree (the read's `lookPast`, 2026-11-13) — is not the wall: its rows are left out of each column, and a
 *  storey that shows less than a third of itself at a column says nothing there, so no corner is found behind it (the
 *  model's own read of the wall stands, and a corner it saw is looked at by itself — lib/deck/houseCorner). */
export function wallCorners(read: HouseRead, g: Gray, gx?: Float32Array): number[] {
  if (!read.eave) return [];
  const { w, h } = g;
  const G = gx ?? gradients(g).gx;
  const xL = Math.round(Math.min(read.base.left.x, read.base.right.x) * w);
  const xR = Math.round(Math.max(read.base.left.x, read.base.right.x) * w);
  if (xR - xL < 40) return [];
  const eaveAt = (px: number) => lineY(read.eave!, px / w) * h;
  const baseAt = (px: number) => lineY(read.base, px / w) * h;
  const H = baseAt((xL + xR) / 2) - eaveAt((xL + xR) / 2);
  if (H < 40) return [];
  const hidden = inFrontAt(read, { under: true });
  // What counts as an edge: well above the wall's own texture (lap siding stands in lines across, not up).
  const sample: number[] = [];
  for (let y = Math.round(eaveAt((xL + xR) / 2) + H * 0.1); y < baseAt((xL + xR) / 2) - H * 0.1; y += 3) for (let x = xL; x < xR; x += 3) if (!hidden(x / w, y / h)) sample.push(G[y * w + x]);
  sample.sort((a, b) => a - b);
  const T = clamp(3 * (sample[Math.floor(sample.length / 2)] ?? 0.02), 0.04, 0.12);
  const bands = read.storeys === 2 ? [[0.06, 0.46], [0.54, 0.94]] : [[0.08, 0.92]];
  const scoreAt = (x: number) => {
    let worst = 1;
    for (const [a, b] of bands) {
      const top = eaveAt(x) + H * a;
      const bot = eaveAt(x) + H * b;
      let on = 0;
      let n = 0;
      let all = 0;
      for (let y = Math.round(top); y < bot; y++) {
        all++;
        if (hidden(x / w, y / h)) continue;
        const i = y * w + x;
        n++;
        if (Math.max(G[i - 1], G[i], G[i + 1]) > T) on++;
      }
      // A storey mostly behind something says nothing at this column — and a corner nobody can see is not found.
      if (n < Math.max(6, all * 0.34)) return 0;
      worst = Math.min(worst, n ? on / n : 0);
    }
    return worst;
  };
  const span = xR - xL;
  const margin = Math.max(4, Math.round(span * 0.04));
  const scores: number[] = [];
  for (let x = xL + margin; x <= xR - margin; x++) scores.push(scoreAt(x));
  const picks: Array<{ x: number; s: number }> = [];
  scores.forEach((s, i) => {
    if (s < 0.72) return;
    const x = xL + margin + i;
    const near = picks.find((p) => Math.abs(p.x - x) < span * 0.04);
    if (!near) picks.push({ x, s });
    else if (s > near.s) Object.assign(near, { x, s });
  });
  // A DOOR'S OR A WINDOW'S OWN FRAME IS NO CORNER (2026-10-26 evening — a split-level: the trim board down the side of
  // the entry door ran on up the side of the window over it, an edge up both storeys, and read as a corner with the
  // wall to its right "back 2 ft"). A column on an opening's edge — within 1½ % of the wall's span — is the frame.
  const edge = Math.max(4, span * 0.015);
  const frames = [...read.windows.flatMap((o) => [o.x0, o.x1]), ...read.doors.flatMap((o) => [o.x0, o.x1])].map((x) => x * w);
  return picks
    .filter((p) => !frames.some((fx) => Math.abs(fx - p.x) <= edge))
    .sort((a, b) => b.s - a.s)
    .slice(0, 4)
    .map((p) => r3(p.x / w))
    .sort((a, b) => a - b);
}

/** A stretch of the wall read by row: `p` smoothed over five rows, `raw` as read. */
interface Profile {
  p: number[];
  raw: number[];
}

/** A stretch of the wall's brightness by row around the eave line — rows `lo`…`hi` px from the line (above is
 *  negative), each read along the line's own slope and averaged across the stretch's columns clear of any window
 *  standing in those rows (its frame and glass would be read as the band). Smoothed over five rows, so one dark line
 *  of a gutter's lip isn't the band. */
function eaveProfile(read: HouseRead, g: Gray, x0: number, x1: number, lo: number, hi: number): Profile | null {
  const { w, h, data } = g;
  const a = Math.round(x0 * w);
  const b = Math.round(x1 * w);
  const cols: number[] = [];
  const hidden = inFrontAt(read);
  for (let x = a; x < b; x++) {
    const fx = x / w;
    const yE = lineY(read.eave!, fx);
    // a tree or a porch roof across the eave here: this column shows none of it
    if (hidden(fx, yE)) continue;
    if (read.windows.some((win) => fx >= win.x0 - 0.004 && fx <= win.x1 + 0.004 && (win.head - yE) * h < hi && (win.sill - yE) * h > lo)) continue;
    cols.push(x);
  }
  if (cols.length < 3) return null;
  const rows: number[] = [];
  for (let k = lo; k <= hi; k++) {
    let s = 0;
    let n = 0;
    for (const x of cols) {
      const y = Math.round(lineY(read.eave!, x / w) * h) + k;
      if (y < 0 || y >= h) continue;
      s += data[y * w + x];
      n++;
    }
    rows.push(n ? s / n : NaN);
  }
  // A row off the top or bottom of the picture takes its nearest neighbour's value.
  for (let i = 1; i < rows.length; i++) if (Number.isNaN(rows[i])) rows[i] = rows[i - 1];
  for (let i = rows.length - 2; i >= 0; i--) if (Number.isNaN(rows[i])) rows[i] = rows[i + 1];
  if (rows.some((v) => Number.isNaN(v))) return null;
  const p = rows.map((_, i) => {
    let s = 0;
    let n = 0;
    for (let k = -2; k <= 2; k++) if (rows[i + k] !== undefined) [s, n] = [s + rows[i + k], n + 1];
    return s / n;
  });
  return { p, raw: rows };
}

/** A dark band across the wall with the wall standing brighter under it. */
interface Band {
  /** Where it sits, px from the eave line (above is negative), to a fraction of a row. */
  at: number;
  /** How much darker than the wall under it, 0…1. */
  depth: number;
  /** Its darkest row as read (before smoothing), 0…1. */
  dark: number;
}

/** The eave's shadow bands a profile could hold: each dip with the wall brighter under it by a good margin — the
 *  soffit's shadow over the siding, not the dark of the roof (the band itself is under that) nor the wall's own
 *  texture. `lo` is the profile's first row, px from the eave line; `H` the wall's height, px. */
function shadowBands({ p, raw }: Profile, lo: number, H: number): Band[] {
  const d1 = Math.max(3, Math.round(H * 0.04));
  const d2 = Math.max(d1 + 3, Math.round(H * 0.12));
  const out: Band[] = [];
  for (let i = 3; i < p.length - 3; i++) {
    if (!(p[i] < p[i - 1] && p[i] <= p[i + 1])) continue;
    const below = p.slice(Math.min(p.length, i + d1), Math.min(p.length, i + d2 + 1));
    if (below.length < 3) continue;
    const wall = median(below);
    const depth = wall > 0 ? (wall - p[i]) / wall : 0;
    if (depth < 0.3) continue;
    // To a fraction of a row: the low point of the parabola through the dip and its neighbours.
    const den = p[i - 1] - 2 * p[i] + p[i + 1];
    const at = i + (den > 1e-9 ? clamp((p[i - 1] - p[i + 1]) / (2 * den), -0.5, 0.5) : 0);
    out.push({ at: at + lo, depth, dark: Math.min(...raw.slice(i - 2, i + 3)) });
  }
  return out;
}

/** The band that stands for the eave among `cands`: the deepest near `from`, a little less for its distance (the
 *  roof's dark above the eave and the wall's lines under it are farther from where the eave is expected). Null when
 *  none lies within `span` px. */
function pickBand(cands: Band[], from: number, span: number): { band: Band; score: number } | null {
  let best: { band: Band; score: number } | null = null;
  for (const band of cands) {
    const off = Math.abs(band.at - from);
    if (off > span) continue;
    const score = band.depth - 0.4 * (off / span);
    if (!best || score > best.score) best = { band, score };
  }
  return best;
}

/** The darkest band within `span` px of `from` — the deepest shadow is where the soffit meets the wall, and that is
 *  the same row of every part on one plane, where a lesser dip (the gutter's shadow, the fascia's edge) is not. */
function darkest(cands: Band[], from: number, span: number): Band | null {
  let best: Band | null = null;
  for (const band of cands) if (Math.abs(band.at - from) <= span && (!best || band.dark < best.dark)) best = band;
  return best;
}

/**
 * The wall's steps from the photo: its corners, and each part out, back or level against the main wall. Null when the
 * photo doesn't say — no eave, no corner, or no part decided (the model's read stands then).
 */
export function wallSteps(modelRead: HouseRead, g: Gray, opts: { depthFt?: number | null } = {}): WallStepsFound | null {
  return wallStepsReport(modelRead, g, opts).steps;
}

/** Why the photo said nothing about the wall's steps: no eave line in the read to look near, no corner running up
 *  every storey, no eave shadow to compare on either side of any corner, or the corners' eaves level (a flat wall, or
 *  a step too shallow to show). */
export type WallStepsWhy = "no-eave" | "no-corners" | "no-band" | "flat";

export interface WallStepsReport {
  /** The steps found, or null with `why`. */
  steps: WallStepsFound | null;
  why: WallStepsWhy | null;
  /** The corners found, whether or not the eave decided anything about them. */
  corners: number[];
  /** Those corners as dividers on the wall's base (depth 0: a part there to tap out or back), for when the photo
   *  shows where the wall breaks but not which way. */
  dividers: WallJog[];
}

/** The same as wallSteps, saying why when nothing was found (the review says it; a corner found with no way to tell
 *  its direction still stands as a divider there). */
export function wallStepsReport(modelRead: HouseRead, g: Gray, opts: { depthFt?: number | null } = {}): WallStepsReport {
  const dividers = (corners: number[]): WallJog[] => corners.map((x) => ({ x, y: r3(lineY(modelRead.base, x)), dir: "toward" as const, depthFt: 0 }));
  const none = (why: WallStepsWhy, corners: number[] = []): WallStepsReport => ({ steps: null, why, corners, dividers: dividers(corners) });
  const modelEave = modelRead.eave;
  if (!modelEave) return none("no-eave");
  const { gx } = gradients(g);
  const corners = wallCorners(modelRead, g, gx);
  if (!corners.length) return none("no-corners");
  // Every part's rows are read along the way the wall runs across the picture (its windows' heads), not as the model's
  // eave line leans.
  const slope = wallSlope(modelRead, g, corners);
  const read = { ...modelRead, eave: slope !== null ? lineAtSlope(modelEave, slope, g) : modelEave };
  const xL = Math.min(read.base.left.x, read.base.right.x);
  const xR = Math.max(read.base.left.x, read.base.right.x);
  const H = (lineY(read.base, (xL + xR) / 2) - lineY(read.eave, (xL + xR) / 2)) * g.h;
  if (H < 40) return none("no-corners", corners);
  // The eave is looked for well above and below the model's line (its line can sit a good way off); the other parts'
  // eaves near the one found, a step being a few per cent of the wall's height.
  const R = Math.max(14, Math.round(H * 0.45));
  const near = Math.max(6, Math.round(H * 0.15));
  const xs = [xL, ...corners, xR];
  const parts = xs.slice(0, -1).map((x0, i) => {
    const x1 = xs[i + 1];
    // Clear of the corner boards themselves, but no more: between a row of upper windows the gaps are narrow.
    const pad = Math.max(3 / g.w, (x1 - x0) * 0.04);
    const prof = x1 - x0 > (xR - xL) * 0.05 ? eaveProfile(read, g, x0 + pad, x1 - pad, -R, R) : null;
    return { x0, x1, cands: prof ? shadowBands(prof, -R, H) : [] };
  });
  // The eave itself: the part whose band shows plainest near the model's line (a wider part counting a little more),
  // and in it the darkest row near that band.
  let ref: { i: number; band: Band; score: number } | null = null;
  parts.forEach((p, i) => {
    const pick = pickBand(p.cands, 0, R);
    if (!pick) return;
    const score = pick.score + (0.1 * (p.x1 - p.x0)) / (xR - xL);
    if (!ref || score > ref.score) ref = { i, band: pick.band, score };
  });
  if (!ref) return none("no-band", corners);
  const picked = ref as { i: number; band: Band };
  const eave = darkest(parts[picked.i].cands, picked.band.at, near) ?? picked.band;
  // Each part's band: the darkest near the eave found.
  const bands = parts.map((p) => darkest(p.cands, eave.at, near));
  // Each corner by the two parts either side of it: the one whose eave sits higher in the picture is nearer the
  // camera. A corner with an eave that doesn't show on either side says nothing.
  const thr = Math.max(2.5, H * 0.02);
  const jogs: WallJog[] = [];
  const plane: Array<number | null> = parts.map(() => null);
  const firstShown = bands.findIndex((b) => b);
  if (firstShown < 0) return none("no-band", corners);
  plane[firstShown] = 0;
  let compared = 0;
  corners.forEach((x, k) => {
    const a = bands[k];
    const b = bands[k + 1];
    if (!a || !b) return;
    compared++;
    const d = b.at - a.at;
    if (Math.abs(d) < thr) {
      if (plane[k] !== null) plane[k + 1] = plane[k];
      return;
    }
    if (plane[k] !== null) plane[k + 1] = (plane[k] as number) + (d < 0 ? 1 : -1);
    // How far it steps the photo doesn't say (a few per cent of the eave's height is the camera's distance as much
    // as the step's): one depth for every step — the model's where it gave one, else none (the house takes its usual
    // 2 ft and says it's a guess) — so a bump-out's two sides come out the same.
    jogs.push({ x, y: r3(lineY(read.base, x)), dir: d < 0 ? "toward" : "away", depthFt: opts.depthFt ?? null });
  });
  if (!jogs.length) return none(compared ? "flat" : "no-band", corners);
  // Each part against the main wall (the widest whose plane is known), for the review's words and the QA.
  const known = parts.map((p, i) => ({ i, w: p.x1 - p.x0 })).filter(({ i }) => plane[i] !== null);
  const main = known.reduce((m, k) => (k.w > m.w ? k : m), known[0]);
  const refAt = bands[main.i]!.at;
  const out = parts.map((p, i) => {
    const pl = plane[i];
    const band = bands[i];
    const state: PartState = pl === null || !band ? "unknown" : pl > (plane[main.i] as number) ? "out" : pl < (plane[main.i] as number) ? "back" : "level";
    return { x0: p.x0, x1: p.x1, state, shiftPx: band ? Math.round((band.at - refAt) * 10) / 10 : 0, corr: band ? Math.round(band.depth * 100) / 100 : 0 };
  });
  return { steps: { jogs, corners, parts: out }, why: null, corners, dividers: dividers(corners) };
}
