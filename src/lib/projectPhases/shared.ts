// NEW CONSTRUCTION — THE PHASES (2026-11-07, the plan "Projects: Remodel and New construction", part 4). A new build
// runs as ten phases from the lot to the keys, each closed by a gate: the county's inspection, the client's word, or
// the lender's. The stages inside a phase are the trades' work, as on a remodel; the phase is what the office, the
// client and the lender watch. The flow is smart in two ways: it asks about the lot and the house before it lays the
// phases out, and shapes them from the answers (septic adds the perc test, the health permit and the drainfield; a
// well adds the driller and the water test; a basement adds the soils report and the waterproofing; a shop becomes
// its own lane); and every phase carries the lead times the trade knows, so Buying and the Timeline know what to
// order when. Pure: no database, no clock — the dialog, the server, the cards, the Operator and the checks read one
// definition. The database half is ./server.ts.

import type { InspectionKind } from "@/lib/projectGates";
import type { TemplateInspection, TemplateSelection, TemplateStage } from "@/lib/projectStages/shared";

// ── the questions at the start ───────────────────────────────────────────────

export type Sewer = "SEWER" | "SEPTIC";
export type Water = "WATER" | "WELL";
export type Foundation = "SLAB" | "CRAWL" | "BASEMENT";
export type Power = "AT_LOT" | "POLE";

/** What the New project dialog (and the Operator) asks about a new build; each optional — the defaults are the
 *  common lot in the county: sewer and water at the street, a crawl space, one story, a garage, no shop, no lender,
 *  power at the lot, gas, no fiber. */
export type BuildAnswers = {
  sewer?: Sewer;
  water?: Water;
  foundation?: Foundation;
  stories?: 1 | 2;
  garage?: boolean;
  shop?: boolean;
  lender?: boolean;
  power?: Power;
  gas?: boolean;
  fiber?: boolean;
};

export const BUILD_DEFAULTS: Required<BuildAnswers> = { sewer: "SEWER", water: "WATER", foundation: "CRAWL", stories: 1, garage: true, shop: false, lender: false, power: "AT_LOT", gas: true, fiber: false };

/** A stored or typed answer set read tolerantly: anything odd falls back to the default. */
export function parseBuildAnswers(raw: unknown): BuildAnswers {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const out: BuildAnswers = {};
  if (r.sewer === "SEWER" || r.sewer === "SEPTIC") out.sewer = r.sewer;
  if (r.water === "WATER" || r.water === "WELL") out.water = r.water;
  if (r.foundation === "SLAB" || r.foundation === "CRAWL" || r.foundation === "BASEMENT") out.foundation = r.foundation;
  if (r.stories === 1 || r.stories === 2) out.stories = r.stories;
  for (const k of ["garage", "shop", "lender", "gas", "fiber"] as const) if (typeof r[k] === "boolean") out[k] = r[k];
  if (r.power === "AT_LOT" || r.power === "POLE") out.power = r.power;
  return out;
}

export const withDefaults = (a: BuildAnswers | null | undefined): Required<BuildAnswers> => ({ ...BUILD_DEFAULTS, ...(a ?? {}) });

/** The dialogs' picks, each a string ("SEPTIC", "2", "true"), as answers — anything not picked stays unsaid. */
export function buildAnswersFromStrings(values: Record<string, string | undefined>): BuildAnswers {
  const raw: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined || v === "") continue;
    raw[k] = v === "true" ? true : v === "false" ? false : /^\d+$/.test(v) ? Number(v) : v;
  }
  return parseBuildAnswers(raw);
}

/** The questions in the order the dialog asks them, with the words on each choice. */
export const BUILD_QUESTIONS: ReadonlyArray<{ key: keyof BuildAnswers; ask: string; choices: ReadonlyArray<{ v: string | number | boolean; label: string }> }> = [
  { key: "sewer", ask: "Sewer or septic?", choices: [{ v: "SEWER", label: "Sewer at the street" }, { v: "SEPTIC", label: "Septic" }] },
  { key: "water", ask: "Water or a well?", choices: [{ v: "WATER", label: "Water at the street" }, { v: "WELL", label: "A well" }] },
  { key: "foundation", ask: "Slab, crawl space or basement?", choices: [{ v: "SLAB", label: "Slab" }, { v: "CRAWL", label: "Crawl space" }, { v: "BASEMENT", label: "Basement" }] },
  { key: "stories", ask: "How many stories?", choices: [{ v: 1, label: "One" }, { v: 2, label: "Two" }] },
  { key: "garage", ask: "An attached garage?", choices: [{ v: true, label: "Yes" }, { v: false, label: "No" }] },
  { key: "shop", ask: "A detached shop or barn?", choices: [{ v: false, label: "No" }, { v: true, label: "Yes" }] },
  { key: "lender", ask: "Is a lender financing it?", choices: [{ v: false, label: "No" }, { v: true, label: "Yes — a draw schedule" }] },
  { key: "power", ask: "Power?", choices: [{ v: "AT_LOT", label: "At the lot" }, { v: "POLE", label: "From the pole — apply first" }] },
  { key: "gas", ask: "Gas?", choices: [{ v: true, label: "Yes" }, { v: false, label: "No — all electric" }] },
  { key: "fiber", ask: "Fiber?", choices: [{ v: false, label: "No" }, { v: true, label: "Yes" }] },
];

/** The answers in a sentence for the page head and the Operator: "septic, a well, a basement, two stories, a garage, a lender". */
export function answersWords(a: BuildAnswers | null | undefined): string {
  const x = withDefaults(a);
  const parts = [
    x.sewer === "SEPTIC" ? "septic" : "sewer",
    x.water === "WELL" ? "a well" : "water at the street",
    x.foundation === "BASEMENT" ? "a basement" : x.foundation === "SLAB" ? "a slab" : "a crawl space",
    x.stories === 2 ? "two stories" : "one story",
    x.garage ? "a garage" : null,
    x.shop ? "a shop" : null,
    x.lender ? "a lender" : null,
    x.power === "POLE" ? "power from the pole" : null,
    x.gas ? null : "all electric",
    x.fiber ? "fiber" : null,
  ].filter(Boolean);
  return parts.join(", ");
}

// ── the phases ───────────────────────────────────────────────────────────────

export const PHASE_KEYS = ["LAND", "DESIGN", "PERMITS", "SITE", "FOUNDATION", "FRAME", "ROUGH", "DRYWALL", "FINISHES", "FINAL", "SHOP"] as const;
export type PhaseKey = (typeof PHASE_KEYS)[number];

export type GateKind = "INSPECTION" | "CLIENT" | "LENDER";

export type BuildPhase = {
  key: PhaseKey;
  name: string;
  /** The phase's share of the work (the phases of the main lane sum to 1; the shop adds its own on top). */
  share: number;
  /** What closes the phase: the county's inspections on its last stage, the client's word, or the lender's. */
  gate: { kind: GateKind; words: string };
  /** The lead times the phase carries — what to order or apply for, and how far ahead. */
  leads: ReadonlyArray<{ what: string; days: number }>;
  /** The lane the phase's stages are drawn in: null = the house; "Site", "Shop" run beside it. */
  lane: string | null;
  /** The phase this one cannot start before (by key); null for the first. */
  after: PhaseKey | null;
  stages: TemplateStage[];
};

const t = (title: string, photoNeeded = false) => ({ title, photoNeeded });
const insp = (kind: InspectionKind, gate = true): TemplateInspection => ({ kind, gate });
const sel = (name: string, leadDays: number): TemplateSelection => ({ name, leadDays });
const keep = <T,>(xs: Array<T | null | false | undefined>): T[] => xs.filter((x): x is T => Boolean(x));

/** The phases a new build runs through, shaped by the answers. The custom home's plain stages (the "home" template)
 *  are these with the defaults, laid flat. */
export function phasesFor(input: BuildAnswers | null | undefined): BuildPhase[] {
  const a = withDefaults(input);
  const septic = a.sewer === "SEPTIC";
  const well = a.water === "WELL";
  const basement = a.foundation === "BASEMENT";
  const slab = a.foundation === "SLAB";

  const phases: BuildPhase[] = [
    {
      key: "LAND",
      name: "Land and feasibility",
      share: 0.02,
      gate: { kind: "CLIENT", words: "Go or no-go with the client, in writing" },
      leads: [],
      lane: null,
      after: null,
      stages: [
        {
          name: "Land and feasibility",
          share: 0.02,
          tasks: keep([
            t("Parcel record: number, zoning, setbacks, acreage"),
            t("Flood zone, wetlands and slopes checked"),
            t("Access, covenants and the utilities at the street"),
            septic && t("Room for the septic system and its reserve area"),
            t("Rough budget and the go-ahead in writing"),
          ]),
        },
      ],
    },
    {
      key: "DESIGN",
      name: "Design and engineering",
      share: 0.05,
      gate: { kind: "CLIENT", words: "Plans stamped and ready to submit" },
      leads: keep([septic && { what: "Septic design and the perc test", days: 42 }, well && { what: "The well driller", days: 42 }, { what: "Truss engineering", days: 21 }]),
      lane: null,
      after: "LAND",
      stages: [
        {
          name: "Design and engineering",
          share: 0.05,
          tasks: keep([
            t("Boundary and topo survey"),
            basement ? t("Soils report — a basement needs it") : t("Soils report when the county or the lender asks"),
            septic ? t("Septic design and the perc test") : t("Sewer tap and the connection fee"),
            well ? t("Well: the driller, the permit, the water letter") : t("Water availability letter and the meter"),
            t("House plans, structural and truss engineering, energy-code worksheet"),
            a.shop && t("The shop on the site plan and its own drawings"),
            t("Stormwater plan"),
          ]),
        },
      ],
    },
    {
      key: "PERMITS",
      name: "Permits and fees",
      share: 0.05,
      gate: { kind: a.lender ? "LENDER" : "CLIENT", words: a.lender ? "Permits issued, fees paid, the lender's draw schedule approved" : "Permits issued and fees paid" },
      leads: keep([a.power === "POLE" && { what: "Power from the pole — the utility's application", days: 90 }, a.gas && { what: "Gas service application", days: 45 }, a.fiber && { what: "Fiber drop", days: 30 }]),
      lane: null,
      after: "DESIGN",
      stages: [
        {
          name: "Permits and fees",
          share: 0.05,
          tasks: keep([
            t("Building permit"),
            t("Grading and clearing permit"),
            septic && t("Septic permit (health district)"),
            well && t("Well permit"),
            t("Driveway approach permit"),
            t(a.power === "POLE" ? "Power from the pole — apply first, it takes longest" : "Power service connection"),
            a.gas && t("Gas service application"),
            a.fiber && t("Fiber application"),
            t("Impact and mitigation fees paid; address assigned"),
            a.lender && t("Draw schedule approved by the lender"),
          ]),
        },
      ],
    },
    {
      key: "SITE",
      name: "Site work",
      share: 0.08,
      gate: { kind: "INSPECTION", words: "Erosion control inspected, 811 located, the pad at grade" },
      leads: [{ what: "Temporary power", days: 14 }],
      lane: "Site",
      after: "DESIGN",
      stages: [
        {
          name: "Site work",
          share: 0.08,
          tasks: keep([
            t("Call 811 — utilities located"),
            t("Clearing and grubbing"),
            t("Erosion control and the construction entrance", true),
            t("Rough grading and the driveway base"),
            t("Temporary power, water and toilet; utility trenches"),
            septic ? t("Septic tank set") : t("Sewer tap"),
          ]),
          inspections: [insp("EROSION")],
        },
      ],
    },
    {
      key: "FOUNDATION",
      name: "Foundation",
      share: 0.1,
      gate: { kind: "INSPECTION", words: slab ? "Footing and slab inspections passed" : "Footing and foundation inspections passed" },
      leads: [{ what: "Rebar and anchor bolts", days: 7 }],
      lane: null,
      after: "PERMITS",
      stages: [
        {
          name: "Foundation",
          share: 0.1,
          tasks: keep([
            t("Layout and excavation"),
            t("Footings poured", true),
            slab ? t("Under-slab plumbing, vapor barrier and the slab") : basement ? t("Basement walls poured", true) : t("Stem walls and the crawl space"),
            basement && t("Waterproofing and drain tile"),
            !slab && t("Backfill and grade"),
            a.garage && t("Garage slab"),
          ]),
          inspections: keep([insp("FOOTING"), !slab && insp("FOUNDATION"), (slab || basement || a.garage) && insp("SLAB"), a.foundation === "CRAWL" && insp("UNDERFLOOR")]),
        },
      ],
    },
    {
      key: "FRAME",
      name: "Framing and dry-in",
      share: 0.2,
      gate: { kind: "INSPECTION", words: "Shear and framing inspections passed" },
      leads: [{ what: "Trusses", days: 42 }, { what: "Windows and doors", days: 56 }],
      lane: null,
      after: "FOUNDATION",
      stages: [
        {
          name: "Framing",
          share: 0.12,
          tasks: keep([!slab && t("Floor system"), t("Walls and trusses", true), a.stories === 2 && t("Second floor and the stairs"), a.garage && t("Garage framing")]),
          inspections: [insp("SHEAR"), insp("FRAMING")],
          selections: keep([sel("Windows and doors", 56), sel("Roofing", 21), a.garage && sel("Garage door", 28)]),
        },
        {
          name: "Dry-in",
          share: 0.08,
          tasks: [t("Sheathing, windows and doors"), t("Roofing and house wrap", true)],
        },
      ],
    },
    {
      key: "ROUGH",
      name: "Rough-ins",
      share: 0.14,
      gate: { kind: "INSPECTION", words: "Plumbing, mechanical and electrical rough-ins passed" },
      leads: [{ what: "HVAC equipment", days: 21 }],
      lane: null,
      after: "FRAME",
      stages: [
        {
          name: "Rough-ins",
          share: 0.14,
          tasks: keep([t("Plumbing rough-in"), t("Electrical rough-in and the service"), t(a.gas ? "HVAC rough-in and the gas line" : "HVAC rough-in — all electric"), t(a.fiber ? "Fiber and low voltage" : "Low voltage"), t("Fire blocking")]),
          inspections: [insp("PLUMBING_ROUGH"), insp("MECHANICAL_ROUGH"), insp("ELECTRICAL_ROUGH")],
        },
      ],
    },
    {
      key: "DRYWALL",
      name: "Insulation and drywall",
      share: 0.08,
      gate: { kind: "INSPECTION", words: "Insulation and wallboard nailing inspections passed" },
      leads: [{ what: "Siding", days: 28 }],
      lane: null,
      after: "ROUGH",
      stages: [
        {
          name: "Insulation and drywall",
          share: 0.08,
          tasks: [t("Insulation"), t("Drywall, tape and prime", true), t("Siding and exterior trim")],
          inspections: [insp("INSULATION"), insp("DRYWALL")],
          selections: [sel("Siding and exterior colors", 28)],
        },
      ],
    },
    {
      key: "FINISHES",
      name: "Finishes",
      share: 0.25,
      gate: { kind: septic ? "INSPECTION" : "CLIENT", words: septic ? "Septic installation inspected; the punch list walked" : "The punch list walked with the client" },
      leads: [{ what: "Cabinets", days: 56 }, { what: "Appliances", days: 28 }],
      lane: null,
      after: "DRYWALL",
      stages: [
        {
          name: "Finishes: cabinets, counters and tile",
          share: 0.12,
          tasks: [t("Cabinets set", true), t("Counters templated and set"), t("Tile")],
          selections: [sel("Cabinets", 56), sel("Countertops", 21), sel("Tile", 28)],
        },
        {
          name: "Finishes: floors, trim, paint and fixtures",
          share: 0.13,
          tasks: keep([t("Floors, trim, doors and paint"), t("Fixtures, lights and appliances"), septic ? t("Drainfield, driveway and final grade") : t("Driveway and final grade"), t("Punch list")]),
          inspections: keep([septic && insp("SEPTIC")]),
          selections: [sel("Flooring", 28), sel("Plumbing fixtures", 28), sel("Lighting", 21), sel("Appliances", 28), sel("Paint colors", 14), sel("Doors, trim and hardware", 28)],
        },
      ],
    },
    {
      key: "FINAL",
      name: "Final and keys",
      share: 0.03,
      gate: { kind: "INSPECTION", words: "Final inspections passed, the certificate of occupancy in hand" },
      leads: [],
      lane: null,
      after: "FINISHES",
      stages: [
        {
          name: "Final and keys",
          share: 0.03,
          tasks: keep([well && t("Well water test"), t("Utility releases and the certificate of occupancy"), t("As-builts, manuals and warranties handed over"), t("Walkthrough with the client", true), t("Sign-off, the final payment and the keys")]),
          inspections: keep([insp("PLUMBING_FINAL"), insp("MECHANICAL_FINAL"), insp("ELECTRICAL_FINAL"), well && insp("WELL"), insp("FINAL")]),
        },
      ],
    },
  ];

  if (a.shop) {
    phases.push({
      key: "SHOP",
      name: "Shop",
      share: 0.06,
      gate: { kind: "INSPECTION", words: "The shop's framing and final inspections passed" },
      leads: [{ what: "Shop trusses and the roll-up door", days: 42 }],
      lane: "Shop",
      after: "SITE",
      stages: [
        { name: "Shop: slab and framing", share: 0.04, tasks: [t("Shop slab", true), t("Shop walls and trusses"), t("Roll-up door and man door")], inspections: [insp("SLAB"), insp("FRAMING")] },
        { name: "Shop: power and finish", share: 0.02, tasks: [t("Power to the shop"), t("Siding, roofing and gutters"), t("Shop final")], inspections: [insp("ELECTRICAL_FINAL")] },
      ],
    });
  }
  return phases;
}

/** The phases' names in a line for the read-back: "Land and feasibility → … → Final and keys (+ Shop)". */
export function phaseLine(phases: readonly BuildPhase[]): string {
  const main = phases.filter((p) => p.lane !== "Shop").map((p) => p.name);
  const shop = phases.some((p) => p.key === "SHOP");
  return `${main.join(" → ")}${shop ? " (+ a Shop lane)" : ""}`;
}

// ── the phase a project is on, from its stages ───────────────────────────────

export type PhaseStatus = "PLANNED" | "ACTIVE" | "DONE";

export type PhaseLike = { id: string; key: string; name: string; position: number; share: number; gateKind: string; gateWords: string | null; lane: string | null; leadsJson?: string | null };
export type StageInPhase = { phaseId: string | null; status: string; gates?: ReadonlyArray<{ name: string; result: string; date: string | null }> };

/** A phase is done when every stage in it is done; in progress when any is in progress or done; else planned. A
 *  phase with no stages yet is planned. */
export function phaseStatus(stages: readonly StageInPhase[]): PhaseStatus {
  if (!stages.length) return "PLANNED";
  if (stages.every((s) => s.status === "DONE")) return "DONE";
  if (stages.some((s) => s.status === "ACTIVE" || s.status === "DONE")) return "ACTIVE";
  return "PLANNED";
}

export type PhaseRead = PhaseLike & {
  status: PhaseStatus;
  /** The gating inspections on the phase's stages that have not passed, by name with their state. */
  holding: Array<{ name: string; result: string; date: string | null }>;
  stageCount: number;
  stagesDone: number;
};

/** The phases with their state read off the stages, in position order; `current` is the first one not done. */
export function readPhases(phases: readonly PhaseLike[], stages: readonly StageInPhase[]): { phases: PhaseRead[]; current: PhaseRead | null } {
  const rows: PhaseRead[] = [...phases]
    .sort((a, b) => a.position - b.position)
    .map((p) => {
      const mine = stages.filter((s) => s.phaseId === p.id);
      return {
        ...p,
        status: phaseStatus(mine),
        holding: mine.flatMap((s) => (s.gates ?? []).filter((g) => g.result !== "PASSED").map((g) => ({ name: g.name, result: g.result, date: g.date }))),
        stageCount: mine.length,
        stagesDone: mine.filter((s) => s.status === "DONE").length,
      };
    });
  const current = rows.find((p) => p.status !== "DONE" && p.lane !== "Shop") ?? rows.find((p) => p.status !== "DONE") ?? null;
  return { phases: rows, current };
}

/** "Framing and dry-in · waits on Shear wall and nailing, Framing" — the strip's line for the current gate. */
export function gateLineOf(p: PhaseRead): string {
  if (p.status === "DONE") return "passed";
  if (p.gateKind === "INSPECTION") {
    if (!p.holding.length) return p.stageCount && p.stagesDone === p.stageCount ? "passed" : (p.gateWords ?? "the inspections");
    return `waits on ${p.holding.map((g) => g.name).join(", ")}`;
  }
  return p.gateWords ?? (p.gateKind === "LENDER" ? "the lender's word" : "the client's word");
}
