// THE MATERIAL LIST, AS PRICED (2026-11-10). The fence studio's takeoff — posts by role and length, concrete for
// those holes, the boards for those bays, the steel gate posts, the taller posts at the steps — is what the crew
// should pick up. The proposal stores only the PRICE lines ("Cedar privacy — 6' fence package × 487.6 lf", "Slope
// steps × 56", "Black steel gate posts × 2"), and the warehouse used to rebuild the list from them: a closed loop
// came back open (2 corners + 2 ends), the gate came out of the footage a second time, a double gate became 10 ft,
// the steps, the steel gate posts and the post system were lost, and the gate posts were listed twice.
//
// So convert keeps the studio's own list beside the proposal (an activity event, the way the traced layout and the
// inventory choice ride along — no column of its own), and the warehouse reads THAT while the proposal still sells
// the fence it was made from. An edited fence (the package's footage changed, the package line gone) falls back to
// the rebuilt list, so a changed proposal is never picked from a list that no longer fits it. Pure.

import type { StockLine } from "@/lib/inventory";

export const FENCE_TAKEOFF_EVENT = "fence.takeoff";

const BOM_UNIT: Record<string, string> = { ea: "each", lf: "linear ft", bag: "bag", box: "box", gal: "gal" };

/** A bill-of-materials label without its job-specific tail: "Concrete · 60 lb bags (holes 30" deep)" → "Concrete · 60 lb bags". */
export function bomItemName(label: string): string {
  return label.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

export interface SavedFenceTakeoff {
  /** The fence package's footage the list was made for. */
  forLf: number;
  /** The names of the lines convert wrote — the ones this list stands in for. */
  lines: string[];
  /** The list itself, as the warehouse counts it. */
  bom: StockLine[];
}

const MAX_ROWS = 80;

/** What convert keeps: the studio's takeoff rows as stock lines. */
export function savedTakeoffMeta(input: { forLf: number; lines: readonly string[]; bom: ReadonlyArray<{ label: string; qty: number; unit: string }> }): string {
  const bom = input.bom
    .filter((b) => Number.isFinite(b.qty) && b.qty > 0)
    .slice(0, MAX_ROWS)
    .map((b) => ({ name: bomItemName(b.label).slice(0, 200), quantity: Math.ceil(b.qty), unit: BOM_UNIT[b.unit] ?? b.unit }));
  return JSON.stringify({ forLf: Math.round(input.forLf * 100) / 100, lines: input.lines.slice(0, MAX_ROWS).map((n) => n.slice(0, 200)), bom });
}

/** The kept list, or null for anything that is not one. */
export function parseSavedTakeoff(meta: string | null | undefined): SavedFenceTakeoff | null {
  if (!meta) return null;
  try {
    const o = JSON.parse(meta) as { forLf?: unknown; lines?: unknown; bom?: unknown };
    if (!(typeof o.forLf === "number" && Number.isFinite(o.forLf)) || !Array.isArray(o.lines) || !Array.isArray(o.bom)) return null;
    const bom: StockLine[] = [];
    for (const b of o.bom as Array<Record<string, unknown>>) {
      if (typeof b?.name !== "string" || !(typeof b.quantity === "number" && Number.isFinite(b.quantity) && b.quantity > 0)) continue;
      bom.push({ name: b.name, quantity: b.quantity, unit: typeof b.unit === "string" ? b.unit : null });
    }
    const lines = (o.lines as unknown[]).filter((n): n is string => typeof n === "string");
    return bom.length ? { forLf: o.forLf, lines, bom } : null;
  } catch {
    return null;
  }
}
