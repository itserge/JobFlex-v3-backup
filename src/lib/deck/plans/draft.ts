// THE PLAN SET'S DRAFTING (2026-10-23) — pure, no React.
//
// Owner, 2026-10-23, with a competitor's sample permit set and construction
// set in hand: "make something like this in our deck studio, but even better
// and more professional. Make it smart. Wow."
//
// What makes a drawing set read as professional is mostly drafting
// discipline: every view to a real architectural scale, line weights that say
// what is cut and what is beyond, lettering the same height on every sheet,
// dimension strings with ticks and extension lines, grid lines with bubbles,
// tags that key each member to its schedule, and callouts that send the
// reader to the detail. This module is that vocabulary.
//
// A view is built in MODEL inches — x across the sheet, y DOWN the sheet (a
// plan: x along the house, y out from it; an elevation: y = −height) — at a
// scale picked for it. Anything that belongs to the paper — lettering, tick
// marks, bubbles, how far a dimension line stands off what it measures — is
// given in PAPER inches, and the renderer converts it with the view's scale:
// a 3/32-in. note is 3/32 in. on the printed sheet at 1/4" = 1'-0" and at
// 1-1/2" = 1'-0" alike.

/** Line weights by what they draw (paper inches): what the section cuts, the outline, the members, beyond, hidden. */
export type Pen = "cut" | "heavy" | "medium" | "light" | "fine" | "hidden" | "center" | "phantom" | "dim";
export const PEN_IN: Record<Pen, number> = {
  cut: 0.024, // 0.6 mm — the section's cut line, the deck's outline
  heavy: 0.017, // 0.43 mm
  medium: 0.012, // 0.3 mm — members
  light: 0.008, // 0.2 mm — beyond, boards
  fine: 0.005, // 0.13 mm — hatching, balusters
  hidden: 0.009, // dashed: below the deck, under the boards
  center: 0.006, // long-short: centre and grid lines
  phantom: 0.007, // long-short-short: what is above, the property line
  dim: 0.0055,
};
/** Dash patterns, paper inches. */
export const PEN_DASH: Partial<Record<Pen, number[]>> = {
  hidden: [0.06, 0.035],
  center: [0.22, 0.04, 0.04, 0.04],
  phantom: [0.25, 0.04, 0.04, 0.04, 0.04, 0.04],
};

/** Fills: poché and the material hatches a reviewer expects (wood cut across the grain gets the X). */
export type Fill = "none" | "paper" | "wood" | "woodCut" | "concrete" | "earth" | "gravel" | "poche" | "house" | "steel" | "glass" | "ink" | "tint0" | "tint1" | "tint2" | "tint3" | "tint4" | "tint5";
export const TINTS: Fill[] = ["tint0", "tint1", "tint2", "tint3", "tint4", "tint5"];

/** Lettering heights, paper inches: xs fine print · sm schedule text · md notes (3/32") · lg labels · xl view titles. */
export type TextSize = "xs" | "sm" | "md" | "lg" | "xl" | "xxl";
export const TEXT_IN: Record<TextSize, number> = { xs: 0.058, sm: 0.07, md: 0.085, lg: 0.105, xl: 0.14, xxl: 0.2 };
/** A letter's average advance as a share of its height (upper case Inter; mono runs a little wider). */
const ADVANCE = { sans: 0.62, mono: 0.62 };

export type Anchor = "start" | "middle" | "end";
export type Tone = "ink" | "blue" | "muted" | "white" | "red";

export type DItem =
  | { k: "line"; x1: number; y1: number; x2: number; y2: number; pen: Pen; tone?: Tone }
  | { k: "poly"; pts: number[]; pen: Pen | null; fill?: Fill; closed?: boolean; tone?: Tone }
  | { k: "circle"; x: number; y: number; r: number; pen: Pen | null; fill?: Fill }
  | { k: "text"; x: number; y: number; s: string; size: TextSize; anchor?: Anchor; rot?: number; bold?: boolean; mono?: boolean; tone?: Tone; halo?: boolean; base?: "middle" | "alphabetic" | "hanging" }
  /** A dimension: extension lines from the two points, the line `off` PAPER inches out (sign = side, to the left of a→b), ticks, the label. */
  | { k: "dim"; x1: number; y1: number; x2: number; y2: number; off: number; label: string; minor?: boolean }
  /** A leader from a point on the drawing to a note; the note sits at (tx, ty) and reads away from the point. */
  | { k: "leader"; x: number; y: number; tx: number; ty: number; lines: string[]; head?: "arrow" | "dot"; size?: TextSize }
  /**
   * A bubble, PAPER-sized: a grid bubble (circle, one mark), a detail callout (circle split: detail over sheet),
   * a tag (hexagon: a member's key into its schedule), a footing tag (diamond), a section cut's head (circle split
   * with a pointer toward `dir` degrees, 0 = +x, 90 = +y down the sheet), an elevation marker (a level datum).
   */
  | { k: "bubble"; x: number; y: number; kind: "grid" | "detail" | "tag" | "foot" | "section"; a: string; b?: string; dir?: number }
  /** A level datum on an elevation: a target at (x, y) with its name and height. */
  | { k: "datum"; x: number; y: number; name: string; value: string; side?: "left" | "right" }
  /** The north arrow (dir = degrees from up, clockwise). */
  | { k: "north"; x: number; y: number; deg: number };

/** A view: what is drawn, at what scale, and the box it all fills (model inches, the annotations included). */
export interface View {
  id: string;
  title: string;
  /** Paper inches per model inch (1/48 at 1/4" = 1'-0"). */
  scale: number;
  scaleLabel: string;
  items: DItem[];
  box: { x: number; y: number; w: number; h: number };
}

/* ── Scales ───────────────────────────────────────────────────────────── */

export interface ArchScale {
  k: number;
  label: string;
}
/** The architect's scales, largest first. */
export const ARCH_SCALES: readonly ArchScale[] = [
  { k: 3 / 12, label: '3" = 1\'-0"' },
  { k: 1.5 / 12, label: '1-1/2" = 1\'-0"' },
  { k: 1 / 12, label: '1" = 1\'-0"' },
  { k: 0.75 / 12, label: '3/4" = 1\'-0"' },
  { k: 0.5 / 12, label: '1/2" = 1\'-0"' },
  { k: 0.375 / 12, label: '3/8" = 1\'-0"' },
  { k: 0.25 / 12, label: '1/4" = 1\'-0"' },
  { k: 0.1875 / 12, label: '3/16" = 1\'-0"' },
  { k: 0.125 / 12, label: '1/8" = 1\'-0"' },
  { k: 0.09375 / 12, label: '3/32" = 1\'-0"' },
  { k: 0.0625 / 12, label: '1/16" = 1\'-0"' },
];

/**
 * The largest architect's scale at which the view — its lettering and bubbles at their paper size — fits a frame
 * `w` × `h` paper inches. `build` makes the view at a scale (anything sized in paper inches changes the model box);
 * `max` caps the scale (a plan is never drawn at 1" = 1'-0", whatever the room).
 */
export function fitView(build: (s: ArchScale) => View, w: number, h: number, max = 0.5 / 12, force?: number | null): View {
  // A scale the builder asked for by hand (2026-11-13): drawn at it where it fits the frame; where it does not, the
  // largest that does — a drawing is never cut off to keep a scale (the caller says so: the view's scale is not the one asked).
  if (force) {
    const asked = ARCH_SCALES.find((s) => Math.abs(s.k - force) < 1e-9);
    if (asked) {
      const v = build(asked);
      if (v.box.w * v.scale <= w + 1e-6 && v.box.h * v.scale <= h + 1e-6) return v;
    }
  }
  let last: View | null = null;
  for (const s of ARCH_SCALES) {
    if (s.k > max + 1e-9) continue;
    const v = build(s);
    last = v;
    if (v.box.w * v.scale <= w + 1e-6 && v.box.h * v.scale <= h + 1e-6) return v;
  }
  return last ?? build(ARCH_SCALES[ARCH_SCALES.length - 1]);
}

/* ── Feet and inches, as a framer reads them ──────────────────────────── */

/** 281.4 → 23'-5 3/8" (to the 1/8 in. by default); whole inches when `denom` is 1. */
export function ftInFrac(inches: number, denom = 8): string {
  const neg = inches < 0;
  const total = Math.round(Math.abs(inches) * denom) / denom;
  let ft = Math.floor(total / 12 + 1e-9);
  let rest = total - ft * 12;
  if (rest >= 12 - 1e-9) {
    ft += 1;
    rest = 0;
  }
  let whole = Math.floor(rest + 1e-9);
  let num = Math.round((rest - whole) * denom);
  if (num === denom) {
    whole += 1;
    num = 0;
  }
  if (whole === 12) {
    ft += 1;
    whole = 0;
  }
  let frac = "";
  if (num > 0) {
    let n = num;
    let d = denom;
    while (n % 2 === 0 && d % 2 === 0) {
      n /= 2;
      d /= 2;
    }
    frac = `${whole ? `${whole} ` : ""}${n}/${d}`;
  } else frac = String(whole);
  return `${neg ? "-" : ""}${ft}'-${frac}"`;
}
/** 7.375 → 7 3/8" (no feet). */
export function inFrac(inches: number, denom = 8): string {
  const v = Math.round(inches * denom) / denom;
  const whole = Math.floor(v + 1e-9);
  let num = Math.round((v - whole) * denom);
  if (!num) return `${whole}"`;
  let d = denom;
  while (num % 2 === 0 && d % 2 === 0) {
    num /= 2;
    d /= 2;
  }
  return `${whole ? `${whole} ` : ""}${num}/${d}"`;
}

/* ── Building a view ──────────────────────────────────────────────────── */

/**
 * A view under construction: items in model inches and helpers that size paper things at the view's scale
 * (`p(0.1)` = how many model inches 0.1 paper inch is).
 */
export class Sketch {
  readonly items: DItem[] = [];
  constructor(readonly scale: number) {}
  /** Paper inches → model inches at this scale. */
  p(paperIn: number): number {
    return paperIn / this.scale;
  }
  line(x1: number, y1: number, x2: number, y2: number, pen: Pen, tone?: Tone): this {
    this.items.push({ k: "line", x1, y1, x2, y2, pen, tone });
    return this;
  }
  poly(pts: number[], pen: Pen | null, fill: Fill = "none", closed = true): this {
    this.items.push({ k: "poly", pts, pen, fill, closed });
    return this;
  }
  rect(x: number, y: number, w: number, h: number, pen: Pen | null, fill: Fill = "none"): this {
    return this.poly([x, y, x + w, y, x + w, y + h, x, y + h], pen, fill, true);
  }
  circle(x: number, y: number, r: number, pen: Pen | null, fill: Fill = "none"): this {
    this.items.push({ k: "circle", x, y, r, pen, fill });
    return this;
  }
  text(x: number, y: number, s: string, size: TextSize = "md", o: { anchor?: Anchor; rot?: number; bold?: boolean; mono?: boolean; tone?: Tone; halo?: boolean; base?: "middle" | "alphabetic" | "hanging" } = {}): this {
    this.items.push({ k: "text", x, y, s, size, ...o });
    return this;
  }
  dim(x1: number, y1: number, x2: number, y2: number, off: number, label?: string, minor = false): this {
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len < 0.5) return this;
    this.items.push({ k: "dim", x1, y1, x2, y2, off, label: label ?? ftInFrac(len, 8), minor });
    return this;
  }
  /** A dimension string: consecutive points along a line, each gap its own dimension, all on one line. */
  chain(pts: Array<[number, number]>, off: number, labels?: string[]): this {
    for (let i = 0; i + 1 < pts.length; i++) this.dim(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], off, labels?.[i], true);
    return this;
  }
  leader(x: number, y: number, tx: number, ty: number, lines: string[], head: "arrow" | "dot" = "arrow", size: TextSize = "md"): this {
    this.items.push({ k: "leader", x, y, tx, ty, lines, head, size });
    return this;
  }
  bubble(x: number, y: number, kind: "grid" | "detail" | "tag" | "foot" | "section", a: string, b?: string, dir?: number): this {
    this.items.push({ k: "bubble", x, y, kind, a, b, dir });
    return this;
  }
  datum(x: number, y: number, name: string, value: string, side: "left" | "right" = "right"): this {
    this.items.push({ k: "datum", x, y, name, value, side });
    return this;
  }
  north(x: number, y: number, deg: number): this {
    this.items.push({ k: "north", x, y, deg });
    return this;
  }
  view(id: string, title: string, scaleLabel: string, pad = 0.12): View {
    const b = itemsBox(this.items, this.scale);
    const m = this.p(pad);
    return { id, title, scale: this.scale, scaleLabel, items: this.items, box: { x: b.x0 - m, y: b.y0 - m, w: b.x1 - b.x0 + 2 * m, h: b.y1 - b.y0 + 2 * m } };
  }
}

/* ── Paper sizes of the annotations (the renderer draws them the same) ── */

export const BUBBLE_IN = { grid: 0.15, detail: 0.17, tag: 0.085, foot: 0.09, section: 0.17 } as const;
export const DIM = { tick: 0.045, extGap: 0.03, extPast: 0.05, textGap: 0.03 } as const;
export const LEADER = { head: 0.06, dot: 0.018, shoulder: 0.1, lineGap: 1.2 } as const;
export const DATUM = { r: 0.055, run: 0.5 } as const;

/** The paper width of a line of text. */
export function textWidthIn(s: string, size: TextSize, mono = false): number {
  return s.length * TEXT_IN[size] * (mono ? ADVANCE.mono : ADVANCE.sans);
}

/** Where a dimension's line sits: the two ends moved `off` paper inches to the left of a→b, in model inches. */
export function dimLine(it: Extract<DItem, { k: "dim" }>, scale: number): { ax: number; ay: number; bx: number; by: number; nx: number; ny: number; ux: number; uy: number } {
  const dx = it.x2 - it.x1;
  const dy = it.y2 - it.y1;
  const L = Math.hypot(dx, dy) || 1;
  const ux = dx / L;
  const uy = dy / L;
  // Left of the direction of travel, on a y-down sheet: (uy, −ux).
  const nx = uy;
  const ny = -ux;
  const o = it.off / scale;
  return { ax: it.x1 + nx * o, ay: it.y1 + ny * o, bx: it.x2 + nx * o, by: it.y2 + ny * o, nx, ny, ux, uy };
}

/** Everything an item covers, model inches (lettering measured at its paper size). */
export function itemsBox(items: DItem[], scale: number): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const add = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  };
  const P = (v: number) => v / scale;
  const textBox = (x: number, y: number, s: string, size: TextSize, anchor: Anchor = "start", rot = 0, mono = false, base: "middle" | "alphabetic" | "hanging" = "alphabetic") => {
    const w = P(textWidthIn(s, size, mono));
    const h = P(TEXT_IN[size]);
    const left = anchor === "start" ? 0 : anchor === "middle" ? -w / 2 : -w;
    const top = base === "middle" ? -h / 2 : base === "hanging" ? 0 : -h;
    const corners: Array<[number, number]> = [
      [left, top],
      [left + w, top],
      [left, top + h * 1.25],
      [left + w, top + h * 1.25],
    ];
    const r = (rot * Math.PI) / 180;
    for (const [cx, cy] of corners) add(x + cx * Math.cos(r) - cy * Math.sin(r), y + cx * Math.sin(r) + cy * Math.cos(r));
  };
  for (const it of items) {
    switch (it.k) {
      case "line":
        add(it.x1, it.y1);
        add(it.x2, it.y2);
        break;
      case "poly":
        for (let i = 0; i + 1 < it.pts.length; i += 2) add(it.pts[i], it.pts[i + 1]);
        break;
      case "circle":
        add(it.x - it.r, it.y - it.r);
        add(it.x + it.r, it.y + it.r);
        break;
      case "text":
        textBox(it.x, it.y, it.s, it.size, it.anchor, it.rot, it.mono, it.base);
        break;
      case "dim": {
        const d = dimLine(it, scale);
        add(it.x1, it.y1);
        add(it.x2, it.y2);
        const past = P(DIM.extPast);
        add(d.ax + d.nx * past, d.ay + d.ny * past);
        add(d.bx + d.nx * past, d.by + d.ny * past);
        // The label sits on the far side of the line.
        const mx = (d.ax + d.bx) / 2 + d.nx * P(DIM.textGap + TEXT_IN.sm);
        const my = (d.ay + d.by) / 2 + d.ny * P(DIM.textGap + TEXT_IN.sm);
        const w = P(textWidthIn(it.label, "sm"));
        add(mx - (w / 2) * Math.abs(d.ux) - P(TEXT_IN.sm) * Math.abs(d.nx), my - (w / 2) * Math.abs(d.uy) - P(TEXT_IN.sm) * Math.abs(d.ny));
        add(mx + (w / 2) * Math.abs(d.ux) + P(TEXT_IN.sm) * Math.abs(d.nx), my + (w / 2) * Math.abs(d.uy) + P(TEXT_IN.sm) * Math.abs(d.ny));
        break;
      }
      case "leader": {
        add(it.x, it.y);
        const size = it.size ?? "md";
        const right = it.tx >= it.x;
        const sh = P(LEADER.shoulder) * (right ? 1 : -1);
        add(it.tx + sh, it.ty);
        const lh = P(TEXT_IN[size] * LEADER.lineGap);
        it.lines.forEach((s, i) => textBox(it.tx + sh + (right ? P(0.03) : -P(0.03)), it.ty + (i - (it.lines.length - 1) / 2) * lh, s, size, right ? "start" : "end", 0, false, "middle"));
        break;
      }
      case "bubble": {
        const r = P(BUBBLE_IN[it.kind]);
        add(it.x - r * 1.6, it.y - r * 1.6);
        add(it.x + r * 1.6, it.y + r * 1.6);
        break;
      }
      case "datum": {
        const run = P(DATUM.run);
        const w = P(textWidthIn(it.name.length > it.value.length ? it.name : it.value, "sm"));
        if (it.side === "left") {
          add(it.x - run - w, it.y - P(0.2));
          add(it.x + P(DATUM.r), it.y + P(0.08));
        } else {
          add(it.x - P(DATUM.r), it.y - P(0.2));
          add(it.x + run + w, it.y + P(0.08));
        }
        break;
      }
      case "north": {
        const r = P(0.28);
        add(it.x - r, it.y - r * 1.3);
        add(it.x + r, it.y + r);
        break;
      }
    }
  }
  if (!Number.isFinite(x0)) return { x0: 0, y0: 0, x1: 1, y1: 1 };
  return { x0, y0, x1, y1 };
}
