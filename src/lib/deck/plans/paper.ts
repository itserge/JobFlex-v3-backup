// THE SHEET SIZES AND THE SCALES THE DEPARTMENT ASKS FOR (2026-10-28, owner: "make an option that the contractor can
// scale the plans and permits the way it's required") — pure.
//
// The permit set was drawn on 11 × 17 (ANSI B) only. A department names the smallest scale it reads — the City of
// Sacramento: plans at 1/4 in. = 1 ft, the site plan at 1/8 in. = 1 ft — and a big lot or a long deck cannot keep
// that on 11 × 17. So the set can go on 18 × 24 (ARCH C) or 24 × 36 (ARCH D): the title block keeps its width, the
// drawing area grows, and every view is fitted again at the largest architect's scale the bigger frame holds.
// "Auto" picks the smallest sheet that keeps both minimums; a chosen sheet that cannot is said, not hidden.
import { fitView, ARCH_SCALES, type ArchScale, type View } from "./draft";
import { siteScaleWords } from "../countyCodes";

export type PaperKey = "B" | "C" | "D";
export interface Paper {
  key: PaperKey;
  /** "11 × 17". */
  name: string;
  standard: string;
  /** Landscape, inches. */
  w: number;
  h: number;
  /** How much wider and taller the drawing area is than the 11 × 17 sheet's — the fit boxes scale by it. */
  kx: number;
  ky: number;
}
/** The title block column and the frame's insets (plan-set.module.css): fixed on every size. */
const TITLE_BLOCK_IN = 2.6;
const SIDES_IN = 0.75;
const TOP_BOTTOM_IN = 0.5;
const DRAW_W_B = 17 - SIDES_IN - TITLE_BLOCK_IN;
const DRAW_H_B = 11 - TOP_BOTTOM_IN;
const paper = (key: PaperKey, name: string, standard: string, w: number, h: number): Paper => ({ key, name, standard, w, h, kx: (w - SIDES_IN - TITLE_BLOCK_IN) / DRAW_W_B, ky: (h - TOP_BOTTOM_IN) / DRAW_H_B });
export const PAPERS: Record<PaperKey, Paper> = {
  B: paper("B", "11 × 17", "ANSI B", 17, 11),
  C: paper("C", "18 × 24", "ARCH C", 24, 18),
  D: paper("D", "24 × 36", "ARCH D", 36, 24),
};
export const PAPER_ORDER: readonly PaperKey[] = ["B", "C", "D"];
export type PaperChoice = "auto" | PaperKey;

/** The smallest plan scale a department reads, inches per foot; 1/4 in. = 1 ft is the common rule. */
export const PLAN_SCALE_MINS: ReadonlyArray<{ inPerFt: number; label: string }> = [
  { inPerFt: 0.25, label: '1/4" = 1\'-0"' },
  { inPerFt: 0.1875, label: '3/16" = 1\'-0"' },
  { inPerFt: 0.125, label: '1/8" = 1\'-0"' },
];
/** The smallest site-plan scale, feet per inch: the architect's 1/8 in., or an engineer's 1 in. = 10, 20, 30, 40 ft. */
export const SITE_SCALE_MINS: readonly number[] = [8, 10, 20, 30, 40];

/**
 * A plan scale picked by hand (2026-11-13 — a deck builder: "some plans come out too small to review"): the foundation
 * and framing plans are drawn at it wherever they fit the sheet, and "Auto" sheet size goes up a size to make room.
 * "auto" = the largest architect's scale that fits.
 */
export const PLAN_SCALES: ReadonlyArray<{ inPerFt: number; label: string }> = [
  { inPerFt: 0.75, label: '3/4" = 1\'-0"' },
  { inPerFt: 0.5, label: '1/2" = 1\'-0"' },
  { inPerFt: 0.375, label: '3/8" = 1\'-0"' },
  { inPerFt: 0.25, label: '1/4" = 1\'-0"' },
  { inPerFt: 0.1875, label: '3/16" = 1\'-0"' },
  { inPerFt: 0.125, label: '1/8" = 1\'-0"' },
];
/** The largest scale a plan is drawn at when nobody asks: 3/4 in. to the foot — a small deck fills its frame (it was capped at 1/2 in.). */
export const PLAN_MAX_K = 0.75 / 12;

export interface SheetPrefs {
  paper: PaperChoice;
  minPlanInPerFt: number;
  minSiteFtPerIn: number;
  /** The plans' scale by hand, inches per foot, or "auto". */
  planInPerFt: number | "auto";
}
export const DEFAULT_SHEET_PREFS: SheetPrefs = { paper: "auto", minPlanInPerFt: 0.25, minSiteFtPerIn: 20, planInPerFt: "auto" };

export function normalizeSheetPrefs(raw: unknown): SheetPrefs {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const paperChoice: PaperChoice = r.paper === "B" || r.paper === "C" || r.paper === "D" ? r.paper : "auto";
  const plan = PLAN_SCALE_MINS.find((x) => typeof r.minPlanInPerFt === "number" && Math.abs(x.inPerFt - (r.minPlanInPerFt as number)) < 1e-6)?.inPerFt ?? DEFAULT_SHEET_PREFS.minPlanInPerFt;
  const site = SITE_SCALE_MINS.find((x) => x === r.minSiteFtPerIn) ?? DEFAULT_SHEET_PREFS.minSiteFtPerIn;
  const byHand = PLAN_SCALES.find((x) => typeof r.planInPerFt === "number" && Math.abs(x.inPerFt - (r.planInPerFt as number)) < 1e-6)?.inPerFt ?? "auto";
  return { paper: paperChoice, minPlanInPerFt: plan, minSiteFtPerIn: site, planInPerFt: byHand };
}

/* ── The room a drawing really has on a sheet (2026-11-13) ───────────────
   The fit boxes were typed for 11 × 17 and stretched by the sheet's growth: on a larger sheet the plan's column is far
   wider than the stretched box (the schedules beside it keep their 4.15 in.), so the plan was fitted into less than
   its frame. These read the frame itself (plan-set.module.css): the field inside the border and the title block, a
   view's title under its drawing, the gap between two cells, and a little air so nothing touches the frame. */
const FIELD_PAD_W_IN = 0.32;
const FIELD_PAD_H_IN = 0.28;
const VIEW_TITLE_IN = 0.5;
const CELL_GAP_IN = 0.12;
const AIR_IN = 0.15;
/** The schedules' column beside a plan (.foundation). */
const SIDE_COLUMN_IN = 4.15;
/** The drawing field of a permit sheet, inches. */
export function fieldOn(p: Paper): { w: number; h: number } {
  return { w: p.w - SIDES_IN - TITLE_BLOCK_IN - FIELD_PAD_W_IN, h: p.h - TOP_BOTTOM_IN - FIELD_PAD_H_IN };
}
/** The foundation and framing plans' frame: the field less the schedules' column. On 11 × 17 it is the 8.9 × 9.45 in. the plans were always fitted to. */
export function planBoxOn(p: Paper): { w: number; h: number } {
  const f = fieldOn(p);
  return { w: Math.max(8.9, f.w - SIDE_COLUMN_IN - CELL_GAP_IN - AIR_IN), h: Math.max(9.45, f.h - VIEW_TITLE_IN - AIR_IN) };
}
/** Two elevations on a sheet: one over the other (each wide and low), or side by side (each narrow and tall). */
export function elevationBoxesOn(p: Paper): { stacked: { w: number; h: number }; beside: { w: number; h: number } } {
  const f = fieldOn(p);
  return {
    stacked: { w: f.w - AIR_IN, h: (f.h - CELL_GAP_IN) / 2 - VIEW_TITLE_IN - AIR_IN },
    beside: { w: (f.w - CELL_GAP_IN) / 2 - AIR_IN, h: f.h - VIEW_TITLE_IN - AIR_IN },
  };
}
/** Side by side with the first frame taking `share` of the width: its frame and the other's. */
export function elevationSplitOn(p: Paper, share: number): { first: { w: number; h: number }; second: { w: number; h: number } } {
  const f = fieldOn(p);
  const h = f.h - VIEW_TITLE_IN - AIR_IN;
  return { first: { w: (f.w - CELL_GAP_IN) * share - AIR_IN, h }, second: { w: (f.w - CELL_GAP_IN) * (1 - share) - AIR_IN, h } };
}
/** The shares of the width the first of two side-by-side elevations may take: even first, then toward the one that needs the room. */
export const ELEVATION_SHARES: readonly number[] = [0.5, 0.55, 0.45, 0.6, 0.4, 0.65, 0.35];
/**
 * The two elevations fitted to a sheet every way — one over the other, and side by side with the width shared evenly
 * or toward the one whose lettering needs it — and the way that draws them larger: by the smaller of the two scales,
 * then by their sum; a tie keeps them one over the other, as they always were, and then the more even share.
 * `share` is the first frame's part of the width when they stand side by side (0.5 = even).
 */
export function fitElevationsOn(p: Paper, front: (s: ArchScale) => View, other: (s: ArchScale) => View): { front: View; other: View; beside: boolean; share: number } {
  const boxes = elevationBoxesOn(p);
  type Laid = { front: View; other: View; beside: boolean; share: number };
  const least = (v: Laid) => Math.min(v.front.scale, v.other.scale);
  const sum = (v: Laid) => v.front.scale + v.other.scale;
  let best: Laid = { front: fitView(front, boxes.stacked.w, boxes.stacked.h, PLAN_MAX_K), other: fitView(other, boxes.stacked.w, boxes.stacked.h, PLAN_MAX_K), beside: false, share: 0.5 };
  for (const share of ELEVATION_SHARES) {
    const sp = elevationSplitOn(p, share);
    const laid: Laid = { front: fitView(front, sp.first.w, sp.first.h, PLAN_MAX_K), other: fitView(other, sp.second.w, sp.second.h, PLAN_MAX_K), beside: true, share };
    if (least(laid) > least(best) + 1e-9 || (Math.abs(least(laid) - least(best)) < 1e-9 && sum(laid) > sum(best) + 1e-9)) best = laid;
  }
  return best;
}
/** The plans' scale asked by hand as paper inches per model inch, or null on "auto". */
export const forcedPlanK = (prefs: Pick<SheetPrefs, "planInPerFt">): number | null => (typeof prefs.planInPerFt === "number" ? prefs.planInPerFt / 12 : null);
/** A plan (foundation, framing) fitted to its frame on this sheet: at the scale asked by hand where it fits, else the largest architect's scale that does. */
export function fitPlanOn(p: Paper, build: (s: ArchScale) => View, force: number | null = null): View {
  const box = planBoxOn(p);
  return fitView(build, box.w, box.h, force ? Math.max(PLAN_MAX_K, force) : PLAN_MAX_K, force);
}

/** A view fitted into a box drawn for 11 × 17, on this sheet: the box grows with the drawing area. */
export function fitOn(p: Paper, build: (s: ArchScale) => View, w: number, h: number, max?: number): View {
  return fitView(build, w * p.kx, h * p.ky, max);
}

/** The site plan's frame on A-101: about 8.6 × 9.2 in. on 11 × 17, less the street band and the north arrow, which keep their size. */
const SITE_FRAME_B = { w: 8.6, h: 9.2 };
const SITE_BANDS = { w: 1.25, h: 1.75 };
export function siteBoxOn(p: Paper): { w: number; h: number } {
  return { w: SITE_FRAME_B.w * p.kx - SITE_BANDS.w, h: SITE_FRAME_B.h * p.ky - SITE_BANDS.h };
}

/** The architect's label for a view's scale (paper inches per model inch). */
export function archLabel(k: number): string {
  return ARCH_SCALES.find((s) => Math.abs(s.k - k) < 1e-9)?.label ?? `${(k * 12).toFixed(3).replace(/0+$/, "")}" = 1'-0"`;
}
export const planScaleLabel = (inPerFt: number): string => [...PLAN_SCALES, ...PLAN_SCALE_MINS].find((x) => Math.abs(x.inPerFt - inPerFt) < 1e-6)?.label ?? `${inPerFt}" = 1'-0"`;

export interface PaperPick {
  paper: Paper;
  /** The framing plan's scale on it, inches per foot, and the site plan's, feet per inch. */
  planInPerFt: number;
  siteFtPerIn: number;
  /** Both minimums kept. */
  met: boolean;
  words: string;
}

/**
 * The sheet for this set: the chosen one, or — on "auto" — the smallest that holds the framing plan at the plan
 * minimum and the lot at the site minimum. `fits` draws both on a sheet and says what scales they got.
 */
export function pickPaper(prefs: SheetPrefs, fits: (p: Paper) => { planK: number; siteFtPerIn: number }): PaperPick {
  const keys = prefs.paper === "auto" ? PAPER_ORDER : [prefs.paper];
  let last: { p: Paper; f: { planK: number; siteFtPerIn: number } } | null = null;
  // A scale asked by hand is kept like the department's minimum: "Auto" goes up a sheet until the plan fits at it.
  const least = Math.max(prefs.minPlanInPerFt, typeof prefs.planInPerFt === "number" ? prefs.planInPerFt : 0);
  const kept = (f: { planK: number; siteFtPerIn: number }) => f.planK * 12 + 1e-9 >= least && f.siteFtPerIn <= prefs.minSiteFtPerIn;
  for (const k of keys) {
    const p = PAPERS[k];
    const f = fits(p);
    last = { p, f };
    if (kept(f)) return pick(p, f, true, prefs);
  }
  return pick((last as { p: Paper }).p, (last as { f: { planK: number; siteFtPerIn: number } }).f, false, prefs);
}
function pick(p: Paper, f: { planK: number; siteFtPerIn: number }, met: boolean, prefs: SheetPrefs): PaperPick {
  const planInPerFt = Math.round(f.planK * 12 * 10000) / 10000;
  const base = `${p.name} (${p.standard}): the framing plan at ${archLabel(f.planK)}, the site plan at ${siteScaleWords(f.siteFtPerIn)}`;
  const words = met
    ? base
    : `${base} — under the ${planScaleLabel(Math.max(prefs.minPlanInPerFt, typeof prefs.planInPerFt === "number" ? prefs.planInPerFt : 0))} / ${siteScaleWords(prefs.minSiteFtPerIn)} asked for${prefs.paper === "auto" ? ", even on 24 × 36" : `; pick a larger sheet or "Auto"`}.`;
  return { paper: p, planInPerFt, siteFtPerIn: f.siteFtPerIn, met, words };
}
