// THE GATES ON A STAGE (2026-11-07, the plan "Projects: Remodel and New construction", part 3). An inspection the
// county has to pass before the work goes on — the footings before the framing, the framing before the drywall —
// is a GATE on the stage it sits on: the stage cannot be marked done until it passes, on the Stages card, on the
// crew's page and by the Operator alike. The templates add their inspections as gates in the county's own words
// (Snohomish County's today; the name on a project is editable, and the office can turn a gate off). Pure: no
// database, no clock, so the card, the server and the checks read one rule.
//
//   · INSPECTION_KINDS / INSPECTION_NAME — the kinds a template or the Operator can name, and the county's words.
//   · inspectionKindOf — the kind a free-typed name points at ("rough in electrical" → ELECTRICAL_ROUGH), or null.
//   · gateHolds / gateWords — which gating inspections still hold a stage, and the one sentence that says so.
//   · gateLine — one inspection's state in a few words for the crew's page ("booked Nov 12", "failed — re-inspect").

export const INSPECTION_KINDS = [
  "EROSION",
  "FOOTING",
  "FOUNDATION",
  "UNDERFLOOR",
  "SLAB",
  "SHEAR",
  "FRAMING",
  "PLUMBING_ROUGH",
  "MECHANICAL_ROUGH",
  "ELECTRICAL_ROUGH",
  "ROUGH_IN",
  "INSULATION",
  "DRYWALL",
  "SEPTIC",
  "WELL",
  "PLUMBING_FINAL",
  "MECHANICAL_FINAL",
  "ELECTRICAL_FINAL",
  "FINAL",
] as const;
export type InspectionKind = (typeof INSPECTION_KINDS)[number];

/** The county's words for each kind (Snohomish County PDS; electrical is the state's L&I there). The name on a
 *  project starts as this and the office renames it for its own county. */
export const INSPECTION_NAME: Record<InspectionKind, string> = {
  EROSION: "Erosion control / pre-construction",
  FOOTING: "Setback and footing",
  FOUNDATION: "Foundation wall",
  UNDERFLOOR: "Under-floor / crawl space",
  SLAB: "Slab",
  SHEAR: "Shear wall and nailing",
  FRAMING: "Framing",
  PLUMBING_ROUGH: "Plumbing rough-in",
  MECHANICAL_ROUGH: "Mechanical rough-in",
  ELECTRICAL_ROUGH: "Electrical rough-in (L&I)",
  ROUGH_IN: "Rough-in (plumbing, mechanical, electrical)",
  INSULATION: "Insulation",
  DRYWALL: "Wallboard nailing",
  SEPTIC: "Septic installation (health district)",
  WELL: "Well and water test",
  PLUMBING_FINAL: "Plumbing final",
  MECHANICAL_FINAL: "Mechanical final",
  ELECTRICAL_FINAL: "Electrical final (L&I)",
  FINAL: "Final inspection",
};

export const isInspectionKind = (v: unknown): v is InspectionKind => typeof v === "string" && (INSPECTION_KINDS as readonly string[]).includes(v);

/** The sheet's quick picks, in the order the work happens. */
export const GATE_PRESETS: readonly InspectionKind[] = ["FOOTING", "FOUNDATION", "FRAMING", "ROUGH_IN", "INSULATION", "DRYWALL", "FINAL"];

/* The kind a typed name points at. The order matters: the trade rough-ins and finals before the plain "rough" and
   "final"; "wallboard nailing" is drywall, not shear. */
const KIND_WORDS: ReadonlyArray<[InspectionKind, RegExp]> = [
  ["EROSION", /erosion|pre-?con|tesc|silt fence/],
  ["SEPTIC", /septic|drain ?field|on-?site sewage/],
  ["WELL", /\bwell\b|water test|potab/],
  ["FOOTING", /footing|setback/],
  ["FOUNDATION", /foundation|stem wall|founda/],
  ["UNDERFLOOR", /under-?floor|crawl/],
  ["SLAB", /\bslab\b/],
  ["DRYWALL", /drywall|wallboard|gypsum|sheetrock|gyp board/],
  ["SHEAR", /shear|nailing|sheathing/],
  // The combined rough-in — "Rough-in (plumbing, mechanical, electrical)", or two trades named — before any one trade's.
  ["ROUGH_IN", /rough[^a-z]*in\b[^(]*\((plumb|mech|elec)|(plumb|mech|elec)\w*[^a-z]+(and|,|\/)?[^a-z]*(plumb|mech|elec)\w*.*rough|rough.*(plumb|mech|elec)\w*[^a-z]+(and|,|\/)?[^a-z]*(plumb|mech|elec)/],
  ["PLUMBING_ROUGH", /plumb\w*.*rough|rough\w*.*plumb|dwv|ground ?work|top ?out/],
  ["MECHANICAL_ROUGH", /(mech|hvac|duct)\w*.*rough|rough\w*.*(mech|hvac|duct)/],
  ["ELECTRICAL_ROUGH", /elec\w*.*rough|rough\w*.*elec|cover inspection/],
  ["PLUMBING_FINAL", /plumb\w*.*final|final\w*.*plumb/],
  ["MECHANICAL_FINAL", /(mech|hvac|furnace|heat pump)\w*.*final|final\w*.*(mech|hvac|furnace)/],
  ["ELECTRICAL_FINAL", /elec\w*.*final|final\w*.*elec|panel|service final/],
  ["FRAMING", /fram/],
  ["ROUGH_IN", /rough/],
  ["INSULATION", /insul/],
  ["FINAL", /final|\bc\.?o\.?\b|certificate of occupancy/],
];

/** The kind a free-typed inspection name points at, or null when it is nothing the templates know. */
export function inspectionKindOf(name: string | null | undefined): InspectionKind | null {
  const n = (name ?? "").toLowerCase().trim();
  if (!n) return null;
  for (const [kind, re] of KIND_WORDS) if (re.test(n)) return kind;
  return null;
}

// ── the rule ─────────────────────────────────────────────────────────────────

export type GateLike = { name: string; result: string; date?: string | null; gate: boolean };

/** The gating inspections that still hold the stage: gate on and not passed (pending, booked or not, or failed). */
export function gateHolds<T extends GateLike>(inspections: readonly T[]): T[] {
  return inspections.filter((i) => i.gate && i.result !== "PASSED");
}

const dayShort = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** One inspection's state in a few words: "passed", "failed — re-inspect", "booked Nov 12", "not booked yet". */
export function gateLine(g: GateLike): string {
  if (g.result === "PASSED") return "passed";
  if (g.result === "FAILED") return "failed — re-inspect";
  return g.date ? `booked ${dayShort(g.date.slice(0, 10))}` : "not booked yet";
}

/** The sentence a refused Done gets: what holds the stage and what to do. */
export function gateWords(holding: readonly GateLike[], stageName: string): string {
  if (!holding.length) return "";
  const list = holding.map((g) => `${g.name} (${gateLine(g)})`);
  const what = list.length === 1 ? list[0] : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
  return `${stageName} waits on ${holding.length === 1 ? "an inspection" : "inspections"}: ${what}. Record it passed on the Timeline card first — or turn the gate off there if this stage does not need it.`;
}

/** The short line under a stage on the cards: "waits on Framing — booked Nov 12". */
export function gateShort(holding: readonly GateLike[]): string {
  if (!holding.length) return "";
  if (holding.length === 1) return `waits on ${holding[0].name} — ${gateLine(holding[0])}`;
  return `waits on ${holding.length} inspections: ${holding.map((g) => g.name).join(", ")}`;
}
