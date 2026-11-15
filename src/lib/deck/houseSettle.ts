// THE READ SETTLED BEFORE THE HOUSE IS BUILT FROM IT (2026-11-14). Pure.
//
// Owner, of a backyard photo whose 3D came out wrong: "render the whole picture uploaded with the roof … a full
// picture of the back shape of the house and the roof included. And double check how you identify the jogs. It should
// be at the very first time already identified, and in some cases you just marked it's out or in. The sections."
//
// Two things the passes before this one could leave wrong or open, each with a plain answer in the read itself:
//
//   · THE WALL'S TOP LINE AT THE ROOF'S TOP. The reader is asked for the eave — where the wall ends and the roof
//     begins. On that photo it gave the top of the roof, and since a wall with no door is sized by its storeys to the
//     eave, the whole house came out a fifth too small (32 ft for about 40) with its windows too low. But a wall's top
//     is never far above its highest windows' heads: about a tenth of the wall's height on two storeys, a fifth on
//     one. A line much higher than that is the roof — it is brought down to where the eave should be, and, when the
//     picture's own pixels are at hand, onto the strongest edge that runs across the wall near there (the fascia).
//
//   · A CORNER SEEN WITH NO WAY SAID. The photo's pixels find the wall's corners; which side of a corner stands
//     forward they can only say by the eave's shadow, the depth map by its own guess, the close look by the model's.
//     When none of them said, the corner stayed a divider — a part for the contractor to tap out or back. Now every
//     corner is decided at the first read, by the best word there is, in this order: the close look's own leaning
//     (said, but not surely enough to be taken alone); the model's FIRST read of the wall's parts, which the pixel
//     pass had set aside; a low roof of its own over one side (the part under it comes out) or a porch roof over one
//     side (that side stands back); and last the wall's shape — beside a corner already decided the wall comes back
//     to its line, between two open corners the middle part comes out, at one corner alone the narrower part does. What was decided, and by what, comes back for the review to say: a guess is one
//     tap to turn round.

import { gradients, type Gray } from "./photoSnap";
import { JOG_DEFAULT_FT, type WallJog } from "./photoFit";
import type { HouseRead, ReadSection } from "./houseRead";
import type { CornerVerdict } from "./houseCorner";
import { inFrontAt } from "./houseInFront";

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const lineY = (l: { left: { x: number; y: number }; right: { x: number; y: number } }, x: number) => l.left.y + ((l.right.y - l.left.y) * (x - l.left.x)) / Math.max(1e-6, l.right.x - l.left.x);

/** How far above its highest window heads a wall's top may stand, as a share of the wall's height, before it is taken
 *  for the roof; and where the eave usually stands. Two storeys, one storey. */
export const EAVE_OVER_HEADS = { two: 0.2, one: 0.45 } as const;
export const EAVE_USUAL = { two: 0.1, one: 0.22 } as const;

export interface EaveSettled {
  read: HouseRead;
  /** The line was moved: it stood at the roof's top. */
  moved: boolean;
  /** How far down it went, as a share of the picture's height. */
  byY: number;
  /** The picture's own edge was found near where the eave should be, and the line stands on it. */
  onEdge: boolean;
}

/** The wall's top line brought down from the roof's top to the eave (see the head of the file). */
export function settleEave(read: HouseRead, g?: Gray | null): EaveSettled {
  const same: EaveSettled = { read, moved: false, byY: 0, onEdge: false };
  const storeys = read.storeys;
  if (!read.eave || !storeys || read.windows.length < (storeys === 2 ? 2 : 1)) return same;
  const xL = Math.min(read.base.left.x, read.base.right.x), xR = Math.max(read.base.left.x, read.base.right.x);
  const xm = (xL + xR) / 2;
  const baseY = lineY(read.base, xm), eaveY = lineY(read.eave, xm);
  const H = baseY - eaveY;
  if (!(H > 0.05)) return same;
  const topHead = Math.min(...read.windows.map((w) => w.head));
  if (!(topHead > eaveY && topHead < baseY)) return same;
  if ((topHead - eaveY) / H <= (storeys === 2 ? EAVE_OVER_HEADS.two : EAVE_OVER_HEADS.one)) return same;
  // Where the eave should be: the wall as tall as its highest heads say.
  const wall = (baseY - topHead) / (1 - (storeys === 2 ? EAVE_USUAL.two : EAVE_USUAL.one));
  let to = baseY - wall;
  let onEdge = false;
  if (g && g.w > 16 && g.h > 16) {
    // The strongest edge across the wall between a tenth of the wall above that line and just over the heads.
    const { gy } = gradients(g);
    const y0 = Math.max(1, Math.round((to - wall * 0.1) * g.h)), y1 = Math.min(g.h - 2, Math.round((topHead - wall * 0.015) * g.h));
    const c0 = Math.round(xL * g.w) + 2, c1 = Math.round(xR * g.w) - 2;
    const rows: Array<{ y: number; s: number }> = [];
    for (let y = y0; y <= y1; y++) {
      let sum = 0, n = 0;
      for (let x = c0; x < c1; x += 2) {
        sum += gy[y * g.w + x];
        n++;
      }
      if (n) rows.push({ y, s: sum / n });
    }
    if (rows.length >= 5) {
      const sorted = rows.map((r) => r.s).sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      const best = rows.reduce((m, r) => (r.s > m.s ? r : m), rows[0]);
      if (best.s > Math.max(0.012, median * 1.6)) {
        // Gutter, fascia and soffit are a stack of edges: the wall ends under the lowest of them — the lowest row
        // about as strong as the strongest (a hip or a lower roof's own edge higher up is not the wall's top).
        const low = rows.filter((r) => r.s >= best.s * 0.7).reduce((m, r) => (r.y > m.y ? r : m), best);
        to = low.y / g.h;
        onEdge = true;
      }
    }
  }
  const d = to - eaveY;
  if (!(d > 0.01)) return same;
  const eave = { left: { x: read.eave.left.x, y: r3(read.eave.left.y + d) }, right: { x: read.eave.right.x, y: r3(read.eave.right.y + d) } };
  return { read: { ...read, eave }, moved: true, byY: r3(d), onEdge };
}

/** What the close look said of a corner it could not settle by itself (lib/deck/houseCorner applyCornerVerdict "kept"). */
export interface CornerLean {
  /** The corner's place across the picture. */
  x: number;
  verdict: CornerVerdict;
  stepFt: number | null;
  confidence: number;
}
/** What decided a corner: the close look's leaning, the model's first read, a roof over one side, the wall's shape —
 *  or "level": the close look leaned to no step there, and the divider is gone. */
export type CornerBy = "look" | "model" | "roof" | "shape" | "level";
export interface CornerDecided {
  x: number;
  by: CornerBy;
  /** The way the part to the RIGHT of the corner goes; null when the divider was taken away. */
  dir: WallJog["dir"] | null;
}

const halfFt = (n: number) => Math.round(clamp(n, 1, 12) * 2) / 2;
const share = (a0: number, a1: number, b0: number, b1: number) => (a1 > a0 ? Math.max(0, Math.min(a1, b1) - Math.max(a0, b0)) / (a1 - a0) : 0);

/**
 * Every corner still open (a divider, depth 0) decided — see the head of the file. `model`: the wall's parts as the
 * model first read them (readSections of the read before the photo's own corners replaced its steps); `leans`: what
 * the close look said of the corners it left alone.
 */
export function settleOpenCorners(read: HouseRead, opts: { model?: ReadSection[] | null; leans?: CornerLean[] | null } = {}): { read: HouseRead; decided: CornerDecided[] } {
  if (!read.jogs.some((j) => j.depthFt === 0)) return { read, decided: [] };
  const xL = Math.min(read.base.left.x, read.base.right.x), xR = Math.max(read.base.left.x, read.base.right.x);
  const span = Math.max(1e-6, xR - xL);
  const jogs = read.jogs.slice().sort((a, b) => a.x - b.x);
  const decided: CornerDecided[] = [];
  const out: Array<WallJog | null> = jogs.map((j) => j);
  const set = (i: number, by: CornerBy, dir: WallJog["dir"], depthFt: number | null) => {
    out[i] = { ...jogs[i], dir, depthFt };
    decided.push({ x: jogs[i].x, by, dir });
  };
  const open = (i: number) => out[i] !== null && out[i]!.depthFt === 0;
  /** The parts either side of corner i: from the corner before it (or the wall's end) to the one after. */
  const sides = (i: number) => ({ l0: i > 0 ? jogs[i - 1].x : xL, x: jogs[i].x, r1: i + 1 < jogs.length ? jogs[i + 1].x : xR });

  // 1 · the close look's own leaning
  for (let i = 0; i < jogs.length; i++) {
    if (!open(i)) continue;
    const lean = (opts.leans ?? []).filter((l) => Math.abs(l.x - jogs[i].x) < span * 0.03).sort((a, b) => b.confidence - a.confidence)[0];
    if (!lean || !(lean.confidence >= 0.25)) continue;
    if (lean.verdict === "right-forward" || lean.verdict === "left-forward") set(i, "look", lean.verdict === "right-forward" ? "toward" : "away", typeof lean.stepFt === "number" && lean.stepFt >= 0.75 ? halfFt(lean.stepFt) : null);
    else if ((lean.verdict === "same-plane" || lean.verdict === "not-a-corner") && lean.confidence >= 0.5) {
      out[i] = null;
      decided.push({ x: jogs[i].x, by: "level", dir: null });
    }
  }
  // 2 · the model's first read of the wall's parts: its step nearest this corner
  const model = (opts.model ?? []).slice().sort((a, b) => a.x0 - b.x0);
  for (let i = 0; i < jogs.length; i++) {
    if (!open(i)) continue;
    let best: { d: number; diff: number } | null = null;
    for (let k = 0; k + 1 < model.length; k++) {
      const d = Math.abs(model[k].x1 - jogs[i].x);
      const diff = model[k + 1].outFt - model[k].outFt;
      if (d <= span * 0.07 && Math.abs(diff) >= 0.5 && (!best || d < best.d)) best = { d, diff };
    }
    if (best) set(i, "model", best.diff > 0 ? "toward" : "away", halfFt(Math.abs(best.diff)));
  }
  // 3 · a roof over one side: a low roof of its own = that part comes out; a porch roof or an awning = that side stands back
  const own = (a: number, b: number) => (read.heights ?? []).some((h) => !h.wing && (h.storeys === 1 || h.roof) && share(a, b, h.x0, h.x1) >= 0.5);
  const porch = (a: number, b: number) => (read.lookPast ?? []).some((p) => (p.kind === "porch-roof" || p.kind === "awning") && share(a, b, p.x0, p.x1) >= 0.5);
  for (let i = 0; i < jogs.length; i++) {
    if (!open(i)) continue;
    const { l0, x, r1 } = sides(i);
    const [lo, ro] = [own(l0, x), own(x, r1)];
    if (lo !== ro) {
      set(i, "roof", ro ? "toward" : "away", null);
      continue;
    }
    const [lp, rp] = [porch(l0, x), porch(x, r1)];
    if (lp !== rp) set(i, "roof", rp ? "away" : "toward", null);
  }
  // 4 · the wall's shape: beside a corner already decided the wall comes back to its line (the part between them is
  // a bump-out or a recess, as deep on both sides); between two open corners the middle part comes out; at one alone,
  // the narrower part does
  const settledAt = (i: number) => (i >= 0 && i < jogs.length && out[i] !== null && out[i]!.depthFt !== 0 ? out[i]! : null);
  for (let i = 0; i < jogs.length; i++) {
    if (!open(i)) continue;
    const beside = settledAt(i + 1) ?? settledAt(i - 1);
    if (beside) {
      set(i, "shape", beside.dir === "away" ? "toward" : "away", beside.depthFt);
      continue;
    }
    if (i + 1 < jogs.length && open(i + 1)) {
      set(i, "shape", "toward", null);
      set(i + 1, "shape", "away", null);
      i++;
      continue;
    }
    const { l0, x, r1 } = sides(i);
    set(i, "shape", r1 - x < x - l0 ? "toward" : "away", null);
  }
  return { read: { ...read, jogs: out.filter((j): j is WallJog => j !== null) }, decided };
}

/** What was decided, for the review's line: ", 2 corners decided from the model's first look — tap a part if it stands the other way". */
export function decidedWords(decided: CornerDecided[]): string {
  const steps = decided.filter((d) => d.dir !== null);
  const gone = decided.length - steps.length;
  if (!decided.length) return "";
  const BY: Record<Exclude<CornerBy, "level">, string> = { look: "the close look's leaning", model: "the model's first look", roof: "the roof over it", shape: "the wall's shape" };
  const by = [...new Set(steps.map((d) => BY[d.by as Exclude<CornerBy, "level">]))];
  const said = steps.length ? `${steps.length === 1 ? "a corner's way" : `${steps.length} corners' ways`} decided from ${by.length > 1 ? `${by.slice(0, -1).join(", ")} and ${by[by.length - 1]}` : by[0]} — tap a part if it stands the other way` : "";
  const went = gone ? `${gone === 1 ? "a line" : `${gone} lines`} the close look took for no step left out` : "";
  return `, ${[said, went].filter(Boolean).join("; ")}`;
}

/**
 * The model's steps where the photo's pixels could not look (2026-11-14). The pixel pass finds a corner only where
 * the wall shows up and down it; behind a porch roof, an old deck or a tree it finds none — and its steps used to
 * replace the model's outright, so a bump-out whose far side stood behind a porch roof lost that side and came out
 * all the way to the house's end. A step of the model's that stands where no storey of the wall can be seen, and
 * where the pixels found no corner of their own, is kept beside theirs.
 */
export function keepUnseenJogs(pixel: WallJog[], model: WallJog[], read: HouseRead): WallJog[] {
  if (!read.eave || !read.lookPast?.length) return pixel;
  const hidden = inFrontAt(read, { under: true });
  const xL = Math.min(read.base.left.x, read.base.right.x), xR = Math.max(read.base.left.x, read.base.right.x);
  const span = Math.max(1e-6, xR - xL);
  const bands = read.storeys === 2 ? [[0.06, 0.46], [0.54, 0.94]] : [[0.08, 0.92]];
  const unseen = (x: number) =>
    bands.some(([a, b]) => {
      const top = lineY(read.eave!, x), bot = lineY(read.base, x);
      let seen = 0;
      const n = 24;
      for (let k = 0; k < n; k++) if (!hidden(x, top + (bot - top) * (a + ((b - a) * (k + 0.5)) / n))) seen++;
      return seen / n < 0.34;
    });
  const kept = model.filter((j) => j.depthFt !== 0 && j.x > xL + span * 0.02 && j.x < xR - span * 0.02 && unseen(j.x) && !pixel.some((p) => Math.abs(p.x - j.x) < span * 0.05));
  return kept.length ? [...pixel, ...kept].sort((a, b) => a.x - b.x) : pixel;
}

/** The depth a decided corner is built at when nothing sized it (said as a guess by lib/deck/houseFromPhoto). */
export const DECIDED_DEPTH_FT = JOG_DEFAULT_FT;
