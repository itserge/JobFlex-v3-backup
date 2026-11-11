// Terrain math for the traced fence line — pure, no network, no DOM. The
// behavior module samples the trace, ships the samples to the Elevation
// action, and hands the answer back here to be turned into per-segment slope
// facts the price, the map overlay and the assumptions all read.
//
// CLASSIFICATION THRESHOLDS — fixed from fence-trade practice, not invented:
//   · LEVEL_MAX_DEG = 5°. Rackable vinyl privacy panels only follow ~7°
//     (Fencetown, "Aluminum fence panel racking"; WamBam, "How do I handle
//     sloping ground" — rails need angle-cutting past ~10°). Below 5° every
//     panel system installs as level ground: no adjustment, no callout.
//   · RACKED_MAX_DEG = 25°. Rackable RESIDENTIAL aluminum follows ~28°
//     (Fencetown), and installers' own ceiling for racking is ~30–35°
//     (Medallion Fence, "Racking vs. Stepping"; FenceTrac, "What are rackable
//     fence panels"). 25° keeps a working margin under the weakest figure.
//   Steeper than RACKED_MAX_DEG the panels must stair-step: each panel stays
//   level and the run drops in uniform steps between posts.
//
// A segment's angle is its NET grade — rise between its two posts over its
// plan length. The grade LENGTH, by contrast, integrates every sample step
// (√(ds² + dz²)), so a dip inside a segment still buys its true footage even
// when the net angle reads flat.
//
// THE SHAPE OF THE GROUND (2026-09-28, owner: "a gradual slope going down
// with no up and down — one line that follows the slope; up and down — step
// it"). Racking is one straight line from post to post: it only fits ground
// that runs straight too. So a segment RACKS when its profile is gradual AND
// keeps to one line — every sample within ROLLING_FT of the chord between
// its ends and no more than ROLLING_FT of travel against the net grade — and
// STEPS when the ground rolls, however small the net rise, or when the grade
// is steeper than the fence's own build can rack (`rackMaxDeg`, from the
// type: a stick-built run follows a hill, a prefab privacy panel takes almost
// none). LEVEL is a gradual segment under LEVEL_MAX_DEG that keeps to its
// line. Steps are counted per bay at the type's post spacing.
import { stepCountOn } from "@/lib/fence/slope";
import type { PathPoint } from "./fenceTypes";
import { localFeetToLatLng, type LatLng } from "./mapProjection";
import { POST_SPACING_FT } from "./fenceGeometry";

/** Sample the ground about every 10 ft — one Elevation API location each. */
export const SAMPLE_FT = 10;
/** Hard cap on one profile; past it the spacing widens instead of failing.
 *  (A trace of more than MAX_PROFILE_SAMPLES / 2 segments still needs two
 *  samples per segment — the server action allows for that.) */
export const MAX_PROFILE_SAMPLES = 750;
/** Segments shorter than this carry no slope story and are not profiled. The
 *  page's "is this report still the trace" check must use the same figure. */
export const MIN_PROFILED_SEG_FT = 0.5;
export const LEVEL_MAX_DEG = 5;
export const RACKED_MAX_DEG = 25;
/** Ground that leaves the straight line between a segment's ends by more
 *  than this — or climbs back against its own grade by more than this — is
 *  rolling ground: a racked panel would bury one end or hang the other, so
 *  the run steps. A foot: past what a crew shims or trims a panel to. */
export const ROLLING_FT = 1.0;

export type SlopeClass = "level" | "racked" | "stepped";

export interface TerrainRules {
  /** Post spacing the steps are counted at (one level panel per bay). */
  sectionFt?: number;
  /** Steeper than this the fence's build cannot rack and must step. */
  rackMaxDeg?: number;
}

export interface SegSampling {
  /** Index into the traced `points` array (segment = points[seg]→points[seg+1]). */
  seg: number;
  /** First sample of this segment in the flat sample list. */
  start: number;
  /** Sample count (≥ 2; endpoints included, so neighbours duplicate corners). */
  count: number;
  planFt: number;
}

export interface FencePathSampling {
  samples: LatLng[];
  segs: SegSampling[];
}

/**
 * Sample points along every non-gap traced segment, endpoints included, in
 * lat/lng ready for the Elevation API. Spacing is SAMPLE_FT, widened only if
 * the whole path would otherwise exceed MAX_PROFILE_SAMPLES.
 */
export function sampleFencePath(points: PathPoint[], origin: LatLng): FencePathSampling {
  const raw: Array<{ seg: number; a: PathPoint; b: PathPoint; planFt: number }> = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (b.gap) continue;
    const planFt = Math.hypot(b.x - a.x, b.y - a.y);
    if (planFt < MIN_PROFILED_SEG_FT) continue;
    raw.push({ seg: i, a, b, planFt });
  }
  const totalFt = raw.reduce((s, r) => s + r.planFt, 0);
  // A segment of n samples at `spacing` costs at most planFt/spacing + 2 (both
  // endpoints, and the ceil), so the interior budget is the cap less two per
  // segment. The old "less one" let a many-cornered parcel trace overshoot the
  // cap (120 × 100 ft segments → 840 samples) and the whole profile failed.
  const budget = Math.max(1, MAX_PROFILE_SAMPLES - 2 * raw.length);
  const spacing = Math.max(SAMPLE_FT, totalFt / budget);

  const samples: LatLng[] = [];
  const segs: SegSampling[] = [];
  for (const r of raw) {
    const n = Math.max(2, Math.ceil(r.planFt / spacing) + 1);
    const start = samples.length;
    for (let k = 0; k < n; k++) {
      const t = k / (n - 1);
      samples.push(
        localFeetToLatLng(origin, {
          x: r.a.x + (r.b.x - r.a.x) * t,
          y: r.a.y + (r.b.y - r.a.y) * t,
        }),
      );
    }
    segs.push({ seg: r.seg, start, count: n, planFt: r.planFt });
  }
  return { samples, segs };
}

export interface SegTerrain {
  seg: number;
  planFt: number;
  /** True length along the ground: Σ √(ds² + dz²) over the sample steps. */
  gradeFt: number;
  /** Net elevation change, first post to last (signed, + = uphill). */
  riseFt: number;
  /** Net grade angle: atan(|rise| / plan). */
  thetaDeg: number;
  cls: SlopeClass;
  /** Stepped only: one step per bay (posts at the type's spacing). */
  steps?: number;
  /** Stepped only: the drop each step takes, |rise| / steps. */
  stepDropFt?: number;
  /** Stepped only: the steps were planned on the profile itself (lib/fence/slope stepStations) — the count, as is. */
  planned?: boolean;
  /** The ground rolls under this segment (up and down inside it): it steps
   *  for its shape, not its grade. */
  rolling?: boolean;
  /** How far the ground leaves the straight line between the ends, ft. */
  offLineFt?: number;
}

export interface FenceTerrainReport {
  segs: SegTerrain[];
  planFt: number;
  gradeFt: number;
  rackedFt: number; // grade footage of racked segments
  steppedFt: number; // grade footage of stepped segments
  minElevFt: number;
  maxElevFt: number;
}

/** How far a profile strays from one straight line between its ends, and how
 *  far it travels back against its own net grade. Both in feet. With the
 *  sample spacing `dsFt` and a window of `win` sample steps (about two bays),
 *  also the ground's shape where a fence meets it: the biggest bump against
 *  any window's own straight line (`bumpFt`) and the steepest window (`steepDeg`). */
export function profileShape(z: readonly number[], dsFt = 0, win = 1): { offLineFt: number; backFt: number; bumpFt: number; steepDeg: number } {
  const n = z.length;
  if (n < 2) return { offLineFt: 0, backFt: 0, bumpFt: 0, steepDeg: 0 };
  const z0 = z[0];
  const rise = z[n - 1] - z0;
  const dir = rise >= 0 ? 1 : -1;
  let off = 0;
  let back = 0;
  for (let k = 0; k < n; k++) {
    const chord = z0 + (rise * k) / (n - 1);
    off = Math.max(off, Math.abs(z[k] - chord));
    if (k > 0) {
      const dz = z[k] - z[k - 1];
      if (dz * dir < 0) back += Math.abs(dz);
    }
  }
  let bump = 0;
  let steep = 0;
  const w = Math.max(1, Math.min(n - 1, Math.round(win)));
  if (dsFt > 0) {
    for (let a = 0; a + w < n; a++) {
      const b = a + w;
      steep = Math.max(steep, (Math.atan2(Math.abs(z[b] - z[a]), w * dsFt) * 180) / Math.PI);
      for (let k = a + 1; k < b; k++) bump = Math.max(bump, Math.abs(z[k] - (z[a] + ((z[b] - z[a]) * (k - a)) / w)));
    }
  }
  return { offLineFt: off, backFt: back, bumpFt: bump, steepDeg: steep };
}

/** Turn the profile the Elevation API answered into per-segment slope facts. */
export function terrainFromProfile(segs: SegSampling[], elevFt: number[], rules: TerrainRules = {}): FenceTerrainReport {
  const out: SegTerrain[] = [];
  let planFt = 0;
  let gradeFt = 0;
  let rackedFt = 0;
  let steppedFt = 0;
  let minElevFt = Infinity;
  let maxElevFt = -Infinity;
  const sectionFt = rules.sectionFt && rules.sectionFt > 0 ? rules.sectionFt : POST_SPACING_FT;
  const rackMax = rules.rackMaxDeg != null && rules.rackMaxDeg >= 0 ? Math.min(rules.rackMaxDeg, RACKED_MAX_DEG) : RACKED_MAX_DEG;

  for (const s of segs) {
    const ds = s.planFt / (s.count - 1);
    let grade = 0;
    for (let k = 1; k < s.count; k++) {
      const dz = elevFt[s.start + k] - elevFt[s.start + k - 1];
      grade += Math.hypot(ds, dz);
    }
    for (let k = 0; k < s.count; k++) {
      const z = elevFt[s.start + k];
      if (z < minElevFt) minElevFt = z;
      if (z > maxElevFt) maxElevFt = z;
    }
    const riseFt = elevFt[s.start + s.count - 1] - elevFt[s.start];
    const thetaDeg = (Math.atan2(Math.abs(riseFt), s.planFt) * 180) / Math.PI;
    // THE GROUND WHERE THE FENCE MEETS IT (2026-11-10). A racked bay is one straight line from post to post, so the
    // ground is judged over about two bays at a time, not against the straight line from one end of a 165-ft side
    // to the other: a side that only bends as it goes down (no up and down — the owner's "one line that follows
    // the slope") stepped every bay before — 56 priced steps on a smooth 6% lawn whose biggest bump over 20 ft was
    // 0.7 ft. It STEPS when the ground goes up and down (a bump over ROLLING_FT inside a window, or ROLLING_FT of
    // travel back against the grade), or where any stretch is steeper than the fence can rack (a vinyl panel takes
    // ~4°: the steep middle of a side steps even when the side's average grade is gentle). LEVEL only when every
    // stretch is under LEVEL_MAX_DEG.
    const win = Math.max(1, Math.round((2 * sectionFt) / Math.max(1e-6, ds)));
    const shape = profileShape(elevFt.slice(s.start, s.start + s.count), ds, win);
    const rolling = shape.bumpFt > ROLLING_FT || shape.backFt > ROLLING_FT;
    const steepest = Math.max(thetaDeg, shape.steepDeg);
    const cls: SlopeClass = rolling
      ? "stepped"
      : steepest < LEVEL_MAX_DEG
        ? "level"
        : steepest <= rackMax
          ? "racked"
          : "stepped";
    const t: SegTerrain = {
      seg: s.seg,
      planFt: s.planFt,
      gradeFt: grade,
      riseFt,
      thetaDeg,
      cls,
      rolling,
      offLineFt: Math.round(shape.offLineFt * 100) / 100,
    };
    if (cls === "stepped") {
      // A level panel per bay, the posts where the ground spends a step (lib/fence/slope stepStations): every bump
      // and dip counted, not only the net rise — rolling ground with a small net rise still drops feet under a panel.
      const profile = elevFt.slice(s.start, s.start + s.count);
      const steps = Math.max(1, stepCountOn(profile, ds, sectionFt));
      let travel = 0;
      for (let k = 1; k < profile.length; k++) travel += Math.abs(profile[k] - profile[k - 1]);
      t.steps = steps;
      t.planned = true;
      t.stepDropFt = travel / steps;
    }
    out.push(t);
    planFt += s.planFt;
    gradeFt += grade;
    if (cls === "racked") rackedFt += grade;
    else if (cls === "stepped") steppedFt += grade;
  }
  if (!out.length) {
    minElevFt = 0;
    maxElevFt = 0;
  }
  return { segs: out, planFt, gradeFt, rackedFt, steppedFt, minElevFt, maxElevFt };
}

const r0 = (n: number) => Math.round(n).toLocaleString("en-US");

/**
 * The one honest sentence the proposal's assumptions carry about the ground.
 * `status` is the fetch outcome; `manualOnly` marks a ledger typed by hand
 * (nothing traced, so there was no line to profile).
 */
export function terrainAssumption(
  report: FenceTerrainReport | null,
  status: "ok" | "failed" | "idle",
  opts?: { billedPlanFt?: number; billedGradeFt?: number; billedRackedFt?: number; billedSteppedFt?: number },
): string {
  if (status === "failed") return "Terrain unavailable — plan length used";
  if (status !== "ok" || !report) return "Terrain not measured — run lengths entered by hand";
  const plan = opts?.billedPlanFt ?? report.planFt;
  const grade = opts?.billedGradeFt ?? report.gradeFt;
  const racked = opts?.billedRackedFt ?? report.rackedFt;
  const stepped = opts?.billedSteppedFt ?? report.steppedFt;
  if (Math.round(grade) <= Math.round(plan) && racked < 1 && stepped < 1) {
    return "Level ground (measured)";
  }
  const parts: string[] = [];
  if (racked >= 1) parts.push(`${r0(racked)} ft racked`);
  if (stepped >= 1) parts.push(`${r0(stepped)} ft stepped`);
  return (
    `Terrain measured: ${r0(plan)} ft plan → ${r0(grade)} ft along grade` +
    (parts.length ? `; ${parts.join(", ")}` : "")
  );
}
