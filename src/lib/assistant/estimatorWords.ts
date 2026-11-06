// THE ESTIMATORS' WORDS (2026-11-05, the AI Operator): what a person says about a roof, a furnace or a lawn, turned
// into the ids the engines read — pure, checked by qa/tests/logic/assistant.check.ts, no database.
import { familyOfMaterial, likeForLikeSystem, type CatalogLists, type RoofFamily, type RoofSystem } from "@/lib/roofPackage/catalog";
import type { ExistingKey } from "@/lib/publicEstimate/roof";
import type { ServiceId } from "@/lib/lawn/pricing";
import type { YardMeasures } from "@/lib/lawn/measure";

// ── the roof ──────────────────────────────────────────────────────────────────

/** The system to start from per family — the website's rule (lib/webEstimatorTrades). */
export const ROOF_SYSTEM_FOR: Record<RoofFamily, string> = { asphalt: "architectural", metal: "standing_seam", tile: "concrete_tile", shake: "cedar_shake", slate: "slate", synthetic: "synthetic_slate", "low-slope": "tpo" };

/** A system named outright ("standing seam", "3-tab", "clay tile"), most specific first. */
const SYSTEM_WORDS: Array<[RegExp, string]> = [
  [/standing.?seam/i, "standing_seam"],
  [/stone.?coated/i, "stone_coated_steel"],
  [/metal (shingle|shake)/i, "metal_shingle"],
  [/metal panel|exposed.?fastener|corrugated|r.?panel|ag.?panel/i, "metal_panel"],
  [/copper/i, "copper"],
  [/clay/i, "clay_tile"],
  [/concrete|\btile/i, "concrete_tile"],
  [/cedar shingle/i, "cedar_shingle"],
  [/shake|cedar/i, "cedar_shake"],
  [/synthetic shake|composite shake/i, "synthetic_shake"],
  [/synthetic|composite|polymer/i, "synthetic_slate"],
  [/\bslate/i, "slate"],
  [/3.?tab|three.?tab/i, "three_tab"],
  [/impact|class 4|hail/i, "impact_resistant"],
  [/designer|presidential|luxury/i, "designer"],
  [/solar shingle/i, "solar_shingle"],
  [/epdm|rubber/i, "epdm"],
  [/\bpvc\b/i, "pvc"],
  [/mod.?bit|torch/i, "mod_bit"],
  [/silicone|coating/i, "coat_silicone"],
  [/\btpo\b|membrane|flat/i, "tpo"],
];

/** The family the words mean; asphalt when they mean nothing in particular. */
export function roofFamilyFor(words: string | null): RoofFamily {
  return familyOfMaterial(words) ?? "asphalt";
}

/** The catalog system the words mean, in this book: named outright, else the family's usual one. A flat roof
 *  (the family decided by the roof, not the words) takes a membrane whatever was asked. */
export function roofSystemFor(words: string | null, family: RoofFamily, lists: CatalogLists): RoofSystem | null {
  const w = (words ?? "").toLowerCase();
  for (const [re, id] of SYSTEM_WORDS) {
    if (!re.test(w)) continue;
    const s = lists.systems.find((x) => x.id === id && (family !== "low-slope" || x.family === "low-slope"));
    if (s) return s;
  }
  return lists.systems.find((s) => s.id === ROOF_SYSTEM_FOR[family]) ?? likeForLikeSystem(family, lists) ?? lists.systems[0] ?? null;
}

/** What is on the roof now, as the homeowner's range asks it; asphalt when nothing was said. */
export function roofExistingFor(words: string | null): ExistingKey {
  const w = (words ?? "").toLowerCase().trim();
  if (!w) return "asphalt";
  if (/metal|steel|standing|tin\b/.test(w)) return "metal";
  if (/tile|clay|concrete/.test(w)) return "tile";
  if (/shake|cedar|wood/.test(w)) return "shake";
  if (/flat|rubber|membrane|tpo|epdm|tar|gravel|built/.test(w)) return "flat";
  if (/asphalt|shingle|composition|architectural|3.?tab/.test(w)) return "asphalt";
  return "unsure";
}

// ── HVAC ──────────────────────────────────────────────────────────────────────

export const HVAC_JOBS = ["replace-system", "replace-outdoor", "replace-furnace", "add-ac", "heat-pump-conversion", "ductless", "water-heater"] as const;
export type HvacVoiceJob = (typeof HVAC_JOBS)[number];

/** The job in the Operator's words ("sizing a full system for …"). */
export const HVAC_JOB_WORDS: Record<HvacVoiceJob, string> = {
  "replace-system": "a full system",
  "replace-outdoor": "the outdoor unit",
  "replace-furnace": "a furnace",
  "add-ac": "adding AC",
  "heat-pump-conversion": "a heat pump conversion",
  ductless: "a ductless zone",
  "water-heater": "a water heater",
};

export const HVAC_TIERS = ["good", "better", "best"] as const;
export type HvacVoiceTier = (typeof HVAC_TIERS)[number];
/** Good / Better / Best as the catalog's rows carry them (lib/hvac/catalogView TIER_LABEL). */
export const HVAC_TIER_ID: Record<HvacVoiceTier, "value" | "mid" | "premium"> = { good: "value", better: "mid", best: "premium" };

// ── the lawn ──────────────────────────────────────────────────────────────────

export const LAWN_SERVICES: readonly ServiceId[] = ["mow", "fert", "aerate", "overseed", "dethatch", "springCleanup", "fallCleanup", "mulch", "bedWeeding", "shrubs", "hedges", "irrigationStart", "irrigationBlowout", "gutters", "snow"];

/** Ticked by default: the season's core, and what the yard plainly needs (the lawn page's rule). */
export const LAWN_USUAL: readonly ServiceId[] = ["mow", "fert", "aerate", "springCleanup", "fallCleanup", "mulch", "irrigationStart", "irrigationBlowout", "shrubs", "hedges", "snow"];

export const LAWN_SERVICE_WORDS: Record<ServiceId, string> = {
  mow: "mowing",
  fert: "fertilizer & weed control",
  aerate: "aeration",
  overseed: "overseeding",
  dethatch: "dethatching",
  springCleanup: "spring cleanup",
  fallCleanup: "fall cleanup",
  mulch: "mulch",
  bedWeeding: "bed weeding",
  shrubs: "shrub trimming",
  hedges: "hedge trimming",
  irrigationStart: "sprinkler start-up",
  irrigationBlowout: "sprinkler blowout",
  gutters: "gutter cleaning",
  snow: "snow clearing",
};

/** A yard sized from what was said ("the lawn is about 8,000 square feet"), not seen: the lawn in the usual
 *  front/back/side shares, the beds as said (else a twelfth of the lawn), a modest house, drive and walks, two
 *  trees, level ground — enough for the pricer's time study; the first visit measures it. */
export function yardFromSaid(lawnSqft: number, bedSqft: number | null): YardMeasures {
  const lawn = Math.max(200, Math.round(lawnSqft));
  const bed = Math.max(0, Math.round(bedSqft ?? lawn / 12));
  const side = Math.sqrt(lawn);
  return {
    lotSqft: Math.round(lawn * 1.8 + bed + 1600),
    lawnSqft: lawn,
    lawnByZone: { front: Math.round(lawn * 0.4), back: Math.round(lawn * 0.5), side: lawn - Math.round(lawn * 0.4) - Math.round(lawn * 0.5) },
    bedSqft: bed,
    treeCanopySqft: Math.round(lawn * 0.1),
    yardCanopySqft: Math.round(lawn * 0.1),
    naturalSqft: 0,
    yardSqft: lawn + bed + 1600,
    canopyOverLawnSqft: 0,
    hardSqft: 1200,
    houseSqft: 1600,
    poolSqft: 0,
    treesInLawn: 2,
    edges: { hardFt: 110, bedFt: Math.round(Math.sqrt(bed) * 4), houseFt: 140, treeFt: 25, lotLineFt: Math.round(side * 2) },
    bedPerimeterFt: Math.round(Math.sqrt(bed) * 4),
    slope: { flat: 1, moderate: 0, steep: 0, tooSteep: 0, samples: 0, source: "none" },
    frontEdge: null,
    confidence: { level: "amber", score: 0.5, reasons: ["The lawn's size was said, not measured — the first visit measures it."] },
  };
}

/** "8,200 sq ft" */
export const sqftWords = (n: number) => `${Math.round(n).toLocaleString("en-US")} sq ft`;
