// A PROPOSAL'S LINES AS THE WAREHOUSE COUNTS THEM (2026-09-20).
//
// The fence estimator sells a fence as one line per run — "Cedar privacy —
// 6' fence package · 104 ln ft" — while the warehouse holds posts, rails,
// pickets and concrete. The studio keeps its own takeoff beside the proposal
// at convert (lib/fence/savedTakeoff, 2026-11-10) and that list IS the pick
// list while the proposal still sells that fence. A proposal without one (made
// before, or edited since) is read back through the estimator's takeoff from
// its price lines — an approximation: the price lines do not say whether the
// fence closes on itself, where it steps, or what the posts are made of.
// Roof and HVAC lines are already components and pass through unchanged.
// Pure: the fence takeoff is arithmetic.

import { FENCE_TYPES } from "@/lib/fence/catalog";
import { bomItemName, type SavedFenceTakeoff } from "@/lib/fence/savedTakeoff";
import { computeFenceTakeoff, type FenceLayoutInput, type FenceOpeningInput } from "@/lib/fence/takeoff";
import type { StockLine, TradeId } from "@/lib/inventory";

export { bomItemName };

const BOM_UNIT: Record<string, string> = { ea: "each", lf: "linear ft", bag: "bag", box: "box", gal: "gal" };

// A package line may carry the cedar grade ("… 6' fence package · clear cedar"); the type and height are what count.
const PACKAGE = /^(.+?) — (\d+(?:\.\d+)?)' fence package(?: · .+)?$/;
// The studio's openings by their line names (fence-estimator-data OPENINGS): the width each one takes out.
const OPENING = /^(single|double|triple|arched) gate\b|^(solid|slatted) door\b/i;
const OPENING_WIDTH: Record<string, number> = { single: 4, double: 8, triple: 12, arched: 4, solid: 3, slatted: 3 };

/** The fence type a package line names, by the label the estimator printed. */
export function fenceTypeForLine(name: string): { id: (typeof FENCE_TYPES)[number]["id"]; heightFt: number } | null {
  const m = PACKAGE.exec(name.trim());
  if (!m) return null;
  const t = FENCE_TYPES.find((ft) => ft.label === m[1]);
  return t ? { id: t.id, heightFt: Number(m[2]) } : null;
}

/** Does the kept list still describe these lines? The package footage it was made for is still what is sold. */
function savedStillFits(lines: readonly StockLine[], saved: SavedFenceTakeoff | null | undefined): saved is SavedFenceTakeoff {
  if (!saved) return false;
  const packages = lines.filter((l) => fenceTypeForLine(l.name) && l.quantity > 0);
  if (!packages.length) return false;
  const lf = packages.reduce((a, l) => a + l.quantity, 0);
  return Math.abs(lf - saved.forLf) <= 0.5;
}

/** The components a fence's package and gate lines were priced from. */
export function fenceComponents(lines: readonly StockLine[], saved?: SavedFenceTakeoff | null): StockLine[] {
  // The studio's own list, kept at convert: the lines it stands for give way to it; a line added by hand since passes.
  if (savedStillFits(lines, saved)) {
    const written = new Set(saved.lines);
    return [...saved.bom.map((b) => ({ ...b })), ...lines.filter((l) => !written.has(l.name) && !fenceTypeForLine(l.name) && !OPENING.test(l.name.trim()))];
  }
  const out: StockLine[] = [];
  const openings: FenceOpeningInput[] = [];
  for (const l of lines) {
    const g = OPENING.exec(l.name.trim());
    if (g) {
      const variant = (g[1] || g[2]).toLowerCase();
      for (let i = 0; i < Math.max(1, Math.round(l.quantity)); i++) openings.push({ widthFt: OPENING_WIDTH[variant] ?? 4, kind: g[2] ? "door" : "gate", label: l.name, variant });
    }
  }
  let packages = 0;
  for (const l of lines) {
    const t = fenceTypeForLine(l.name);
    if (!t || !(l.quantity > 0)) {
      if (!OPENING.test(l.name.trim())) out.push(l);
      continue;
    }
    packages++;
    // The package's footage is the fence with the openings already taken out: the run is that plus the openings,
    // so the takeoff does not take them out a second time.
    const ops = packages === 1 ? openings : [];
    const run = l.quantity + ops.reduce((a, o) => a + o.widthFt, 0);
    const layout: FenceLayoutInput = { type: t.id, heightFt: t.heightFt, runs: [{ lengthFt: run, corners: 2 }], openings: ops, terrain: "flat", wastePct: 10 };
    try {
      for (const b of computeFenceTakeoff(layout).bom) out.push({ name: bomItemName(b.label), quantity: b.qty, unit: BOM_UNIT[b.unit] ?? b.unit });
    } catch {
      out.push(l);
    }
  }
  // A gate with no package line on the proposal still needs its posts.
  if (!packages && openings.length) for (const l of lines) if (OPENING.test(l.name.trim())) out.push(l);
  return out;
}

/** The lines the warehouse counts for a proposal of this trade — the studio's kept list when it still fits. */
export function explodeLines(trade: TradeId | string | null | undefined, lines: readonly StockLine[], saved?: SavedFenceTakeoff | null): StockLine[] {
  return trade === "fence" ? fenceComponents(lines, saved) : [...lines];
}
