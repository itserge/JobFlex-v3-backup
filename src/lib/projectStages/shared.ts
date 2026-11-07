// STAGES AND TASKS OF A PROJECT — the pure half (the stages build, 2026-11-05).
//
// Owner's plan: "A sold proposal makes a project with stages from a trade template: deck, roof, fence, kitchen,
// bath, epoxy floors, HVAC. For any other trade the AI drafts the stages from the proposal lines. Tasks inside
// stages, with 'photo needed' on the ones that matter. % done, stage dates, project numbers, 'needs a look'
// reasons." This file holds the templates, the % done arithmetic, the late rule and the Automatic projects
// settings; it imports nothing that touches the server, so the cards, the list, the Operator and the checks read
// one definition. The database half is ./server.ts.

import { TRADE_TYPES, type TradeType } from "@/lib/tradeTypes";
import type { ProjectKind } from "@/lib/projectKind";

export type StageStatus = "PLANNED" | "ACTIVE" | "DONE";

/** What the arithmetic needs of a stage — the page's shape and the database row both fit. */
export type StageLike = {
  status: string;
  weight: number;
  tasks: Array<{ done: boolean }>;
  startsAt?: Date | string | null;
  endsAt?: Date | string | null;
  name?: string;
};

export const STAGE_LABEL: Record<StageStatus, string> = { PLANNED: "Planned", ACTIVE: "In progress", DONE: "Done" };

export function stageStatusOf(s: string): StageStatus {
  return s === "DONE" || s === "ACTIVE" ? s : "PLANNED";
}

/** "#1042" — a project's number, or "" for one not numbered yet. */
export function projectNo(n: number | null | undefined): string {
  return n ? `#${n}` : "";
}

/**
 * % done, 0–100: each stage's weight is its share of the work (the template's cost share; 1 when hand-added), a
 * done stage earns all of it and a stage with tasks earns the ticked tasks' share. Null with no stages — the
 * list then falls back to its old jobs-closed count.
 */
export function percentDone(stages: readonly StageLike[]): number | null {
  if (!stages.length) return null;
  const weights = stages.map((s) => (Number.isFinite(s.weight) && s.weight > 0 ? s.weight : 0));
  const total = weights.reduce((a, b) => a + b, 0);
  const w = (i: number) => (total > 0 ? weights[i] : 1);
  const all = total > 0 ? total : stages.length;
  const earned = stages.reduce((n, s, i) => {
    if (s.status === "DONE") return n + w(i);
    if (!s.tasks.length) return n;
    return n + (w(i) * s.tasks.filter((t) => t.done).length) / s.tasks.length;
  }, 0);
  return Math.max(0, Math.min(100, Math.round((100 * earned) / all)));
}

/** The stage the project is on: the first active one, else the first not done, else null (all done). */
export function currentStage<T extends StageLike>(stages: readonly T[]): T | null {
  return stages.find((s) => s.status === "ACTIVE") ?? stages.find((s) => s.status !== "DONE") ?? null;
}

const DAY_MS = 86_400_000;

/** A stage's day, read as a calendar day in UTC (stored as UTC midnight, like Project.startsAt). */
function dayNumber(d: Date | string | null | undefined): number | null {
  if (!d) return null;
  const t = typeof d === "string" ? Date.parse(d) : d.getTime();
  return Number.isFinite(t) ? Math.floor(t / DAY_MS) : null;
}

/** Stages past their last day and not done, with how many days late, on a given day (a UTC day number). */
export function lateStages<T extends StageLike>(stages: readonly T[], today: Date): Array<{ stage: T; days: number }> {
  const now = Math.floor(today.getTime() / DAY_MS);
  const out: Array<{ stage: T; days: number }> = [];
  for (const s of stages) {
    if (s.status === "DONE") continue;
    const end = dayNumber(s.endsAt);
    if (end == null || end >= now) continue;
    out.push({ stage: s, days: now - end });
  }
  return out;
}

/** "3 days late" / "late since yesterday". */
export function lateWords(days: number): string {
  return days === 1 ? "a day late" : `${days} days late`;
}

// ── the templates ────────────────────────────────────────────────────────────

export type TemplateTask = { title: string; photoNeeded?: boolean };
export type TemplateStage = { name: string; share: number; tasks: TemplateTask[] };
/** `kind`: the projects it is offered to (lib/projectKind). `contingency`: the budget's contingency line as a share of the
 *  cost budget when the budget is filled in for them (lib/projectBudgetSuggest). */
export type StageTemplate = { key: string; label: string; kind: ProjectKind; contingency?: number; stages: TemplateStage[] };

const t = (title: string, photoNeeded = false): TemplateTask => ({ title, photoNeeded });
const FINAL_TASKS = (what: string): TemplateTask[] => [t("Walk-through with the client"), t(`Final photos of the ${what}`, true), t("Collect the final payment")];

/** The trade templates, in the picker's order. Shares sum to 1: % done weighs each stage by its share. */
export const STAGE_TEMPLATES: readonly StageTemplate[] = [
  {
    key: "deck",
    label: "Deck",
    kind: "REMODEL",
    stages: [
      { name: "Materials ordered", share: 0.1, tasks: [t("Confirm the design and the footprint with the client"), t("Pull the permit"), t("Order lumber and hardware"), t("Order decking and railing")] },
      { name: "Footings", share: 0.15, tasks: [t("Lay out and mark the footings"), t("Dig and pour the footings", true), t("Inspection: footings")] },
      { name: "Framing", share: 0.25, tasks: [t("Ledger and beams"), t("Joists and blocking", true), t("Inspection: framing")] },
      { name: "Decking and railings", share: 0.35, tasks: [t("Lay the decking"), t("Stairs"), t("Railings and posts")] },
      { name: "Inspection and final payment", share: 0.15, tasks: [t("Final inspection"), ...FINAL_TASKS("deck")] },
    ],
  },
  {
    key: "roof",
    label: "Roof",
    kind: "REMODEL",
    stages: [
      { name: "Materials ordered", share: 0.15, tasks: [t("Pull the permit"), t("Order shingles, underlayment and flashing"), t("Dumpster delivered")] },
      { name: "Tear-off", share: 0.2, tasks: [t("Tear off the old roof"), t("Check the decking", true), t("Replace bad decking")] },
      { name: "Dry-in", share: 0.2, tasks: [t("Ice and water shield"), t("Underlayment and drip edge", true)] },
      { name: "Shingles and flashing", share: 0.3, tasks: [t("Shingles"), t("Flashing and vents"), t("Ridge cap")] },
      { name: "Cleanup and final", share: 0.15, tasks: [t("Magnet sweep and haul away"), t("Final inspection"), ...FINAL_TASKS("roof")] },
    ],
  },
  {
    key: "fence",
    label: "Fence",
    kind: "REMODEL",
    stages: [
      { name: "Materials ordered", share: 0.15, tasks: [t("Confirm the fence line with the client"), t("Call 811 — utilities marked"), t("Order posts, panels and hardware")] },
      { name: "Posts", share: 0.35, tasks: [t("Lay out the line"), t("Dig and set the posts", true), t("Let the concrete cure")] },
      { name: "Panels and gates", share: 0.35, tasks: [t("Rails and pickets or panels"), t("Gates and hardware")] },
      { name: "Final", share: 0.15, tasks: [t("Walk the line with the client"), t("Final photos of the fence", true), t("Collect the final payment")] },
    ],
  },
  {
    key: "kitchen",
    label: "Kitchen remodel",
    kind: "REMODEL",
    stages: [
      { name: "Selections and materials", share: 0.15, tasks: [t("Final selections with the client"), t("Pull the permits"), t("Order cabinets"), t("Order countertops")] },
      { name: "Demolition", share: 0.1, tasks: [t("Protect the floors and doorways"), t("Tear out cabinets and counters", true), t("Haul away")] },
      { name: "Rough-in", share: 0.15, tasks: [t("Plumbing rough-in"), t("Electrical rough-in"), t("Inspection: rough-in")] },
      { name: "Drywall and paint", share: 0.1, tasks: [t("Patch and finish the drywall"), t("Prime and paint")] },
      { name: "Cabinets and counters", share: 0.25, tasks: [t("Set the cabinets", true), t("Template the counters"), t("Install the counters")] },
      { name: "Finish", share: 0.15, tasks: [t("Backsplash"), t("Plumbing and electrical trim-out"), t("Appliances")] },
      { name: "Final", share: 0.1, tasks: [t("Punch list"), t("Final inspection"), ...FINAL_TASKS("kitchen")] },
    ],
  },
  {
    key: "bath",
    label: "Bathroom remodel",
    kind: "REMODEL",
    stages: [
      { name: "Selections and materials", share: 0.15, tasks: [t("Final selections with the client"), t("Pull the permits"), t("Order the tile, the vanity and the fixtures")] },
      { name: "Demolition", share: 0.1, tasks: [t("Protect the floors and doorways"), t("Tear out the old bath", true), t("Haul away")] },
      { name: "Rough-in", share: 0.15, tasks: [t("Plumbing rough-in"), t("Electrical rough-in"), t("Inspection: rough-in")] },
      { name: "Tile and waterproofing", share: 0.25, tasks: [t("Waterproofing", true), t("Floor and wall tile"), t("Grout and seal")] },
      { name: "Fixtures and finish", share: 0.2, tasks: [t("Vanity and top"), t("Toilet, faucets and shower trim"), t("Mirror, lights and accessories")] },
      { name: "Final", share: 0.15, tasks: [t("Punch list"), t("Final inspection"), ...FINAL_TASKS("bath")] },
    ],
  },
  {
    key: "floors",
    label: "Floors (epoxy, wood, tile)",
    kind: "REMODEL",
    stages: [
      { name: "Prep", share: 0.3, tasks: [t("Clear the space"), t("Grind, sand or level the floor", true), t("Repair cracks and joints")] },
      { name: "Install", share: 0.5, tasks: [t("Base coat or underlayment"), t("Finish coat or the floor itself", true)] },
      { name: "Cure and final", share: 0.2, tasks: [t("Cure — keep everyone off it"), ...FINAL_TASKS("floor")] },
    ],
  },
  {
    key: "hvac",
    label: "HVAC",
    kind: "REMODEL",
    stages: [
      { name: "Equipment ordered", share: 0.3, tasks: [t("Pull the permit"), t("Order the equipment"), t("Equipment delivered")] },
      { name: "Install", share: 0.5, tasks: [t("Remove the old equipment"), t("Set the new equipment", true), t("Line set, electrical and ducts")] },
      { name: "Startup and final", share: 0.2, tasks: [t("Startup and test"), t("Inspection"), ...FINAL_TASKS("system")] },
    ],
  },
  {
    key: "siding",
    label: "Siding",
    kind: "REMODEL",
    stages: [
      { name: "Materials ordered", share: 0.15, tasks: [t("Confirm colors and profile with the client"), t("Order siding, trim and house wrap")] },
      { name: "Tear-off and wrap", share: 0.25, tasks: [t("Remove the old siding"), t("Check the sheathing", true), t("House wrap and flashing")] },
      { name: "Siding and trim", share: 0.45, tasks: [t("Siding"), t("Trim and corners"), t("Caulk and paint touch-up")] },
      { name: "Final", share: 0.15, tasks: [t("Haul away"), ...FINAL_TASKS("siding")] },
    ],
  },
  {
    key: "remodel",
    label: "General remodel",
    kind: "REMODEL",
    stages: [
      { name: "Plans and permits", share: 0.1, tasks: [t("Final plans with the client"), t("Pull the permits"), t("Order long-lead materials")] },
      { name: "Demolition", share: 0.1, tasks: [t("Protect the rest of the house"), t("Demolition", true), t("Haul away")] },
      { name: "Rough-in", share: 0.2, tasks: [t("Framing"), t("Plumbing, electrical and HVAC rough-in"), t("Inspection: rough-in")] },
      { name: "Drywall and paint", share: 0.15, tasks: [t("Insulation"), t("Drywall"), t("Prime and paint")] },
      { name: "Finishes", share: 0.3, tasks: [t("Floors"), t("Cabinets, counters and tile"), t("Trim, doors and fixtures")] },
      { name: "Final", share: 0.15, tasks: [t("Punch list"), t("Final inspection"), ...FINAL_TASKS("work")] },
    ],
  },
  // The remodel presets (2026-11-07, the plan "Projects: Remodel and New construction", part 1).
  {
    key: "addition",
    label: "Addition",
    kind: "REMODEL",
    contingency: 0.1,
    stages: [
      { name: "Plans and permits", share: 0.08, tasks: [t("Final plans with the client"), t("Pull the permits"), t("Call 811 — utilities marked"), t("Order trusses, windows and doors")] },
      { name: "Site and footings", share: 0.12, tasks: [t("Lay out the addition and mark the footings"), t("Excavate"), t("Dig and pour the footings", true), t("Inspection: footings")] },
      { name: "Foundation", share: 0.1, tasks: [t("Stem walls or slab", true), t("Inspection: foundation"), t("Backfill and grade")] },
      { name: "Framing and tie-in", share: 0.2, tasks: [t("Floor, walls and roof framing"), t("Open the house and tie in", true), t("Inspection: framing")] },
      { name: "Dry-in", share: 0.1, tasks: [t("Roofing"), t("Windows and doors"), t("House wrap and siding")] },
      { name: "Rough-ins", share: 0.12, tasks: [t("Plumbing, electrical and HVAC rough-in"), t("Inspection: rough-in")] },
      { name: "Insulation and drywall", share: 0.1, tasks: [t("Insulation"), t("Inspection: insulation"), t("Drywall, tape and prime")] },
      { name: "Finishes", share: 0.12, tasks: [t("Floors"), t("Trim, doors and paint"), t("Fixtures and trim-out")] },
      { name: "Final", share: 0.06, tasks: [t("Punch list"), t("Final inspection"), ...FINAL_TASKS("addition")] },
    ],
  },
  {
    key: "basement",
    label: "Basement finish",
    kind: "REMODEL",
    contingency: 0.1,
    stages: [
      { name: "Plans and permits", share: 0.08, tasks: [t("Final plans with the client"), t("Pull the permits"), t("Check for moisture and the egress window", true)] },
      { name: "Framing", share: 0.17, tasks: [t("Egress window if the bedroom needs one"), t("Frame the walls and soffits", true)] },
      { name: "Rough-ins", share: 0.2, tasks: [t("Plumbing, electrical and HVAC rough-in"), t("Inspection: rough-in")] },
      { name: "Insulation and drywall", share: 0.2, tasks: [t("Insulation"), t("Inspection: insulation"), t("Drywall, tape and prime")] },
      { name: "Floors and finishes", share: 0.25, tasks: [t("Floors"), t("Trim, doors and paint"), t("Bath fixtures and trim-out")] },
      { name: "Final", share: 0.1, tasks: [t("Punch list"), t("Final inspection"), ...FINAL_TASKS("basement")] },
    ],
  },
  {
    key: "wholehouse",
    label: "Whole-house remodel",
    kind: "REMODEL",
    contingency: 0.15,
    stages: [
      { name: "Plans and permits", share: 0.08, tasks: [t("Final plans and selections with the client"), t("Pull the permits"), t("Agree the client's move-out and move-in days"), t("Order cabinets, windows and the long-lead materials")] },
      { name: "Demolition", share: 0.08, tasks: [t("Protect what stays"), t("Demolition", true), t("Haul away")] },
      { name: "Structural", share: 0.12, tasks: [t("Beams, headers and new openings", true), t("Inspection: framing")] },
      { name: "Rough-ins", share: 0.17, tasks: [t("Plumbing, electrical and HVAC rough-in"), t("Inspection: rough-in")] },
      { name: "Insulation and drywall", share: 0.12, tasks: [t("Insulation"), t("Inspection: insulation"), t("Drywall, tape and prime")] },
      { name: "Finishes by room", share: 0.33, tasks: [t("Floors through the house"), t("Kitchen: cabinets, counters and backsplash"), t("Baths: tile, vanities and fixtures"), t("Trim, doors and paint"), t("Lights, plumbing and electrical trim-out")] },
      { name: "Final", share: 0.1, tasks: [t("Punch list"), t("Final inspection"), ...FINAL_TASKS("house")] },
    ],
  },
  {
    key: "adu",
    label: "Garage conversion or ADU",
    kind: "REMODEL",
    contingency: 0.1,
    stages: [
      { name: "Plans and permits", share: 0.1, tasks: [t("Final plans with the client"), t("Pull the permits — a separate address and meter when the county asks"), t("Order windows, doors and the long-lead materials")] },
      { name: "Slab and framing", share: 0.2, tasks: [t("Infill or cut the slab", true), t("Frame the walls and ceiling"), t("Inspection: framing")] },
      { name: "Rough-ins", share: 0.2, tasks: [t("Plumbing, electrical and HVAC rough-in"), t("Inspection: rough-in")] },
      { name: "Insulation and drywall", share: 0.15, tasks: [t("Insulation"), t("Inspection: insulation"), t("Drywall, tape and prime")] },
      { name: "Finishes", share: 0.25, tasks: [t("Floors"), t("Kitchen and bath"), t("Trim, doors and paint"), t("Fixtures and trim-out")] },
      { name: "Final", share: 0.1, tasks: [t("Punch list"), t("Final inspection"), ...FINAL_TASKS("unit")] },
    ],
  },
  {
    key: "windows",
    label: "Windows and doors",
    kind: "REMODEL",
    contingency: 0.05,
    stages: [
      { name: "Measure and order", share: 0.3, tasks: [t("Measure every opening", true), t("Confirm styles and colors with the client"), t("Order the windows and doors — six to eight weeks out")] },
      { name: "Install", share: 0.5, tasks: [t("Pull the old units"), t("Set, flash and foam the new ones", true)] },
      { name: "Trim and final", share: 0.2, tasks: [t("Interior and exterior trim"), t("Caulk and touch-up"), ...FINAL_TASKS("windows")] },
    ],
  },
  {
    key: "painting",
    label: "Painting",
    kind: "REMODEL",
    contingency: 0.05,
    stages: [
      { name: "Prep", share: 0.35, tasks: [t("Confirm colors with the client"), t("Move and cover the furniture"), t("Wash, scrape, patch and sand", true), t("Mask and protect")] },
      { name: "Prime", share: 0.15, tasks: [t("Prime the patches and the bare wood")] },
      { name: "Finish coats", share: 0.4, tasks: [t("First coat"), t("Second coat", true)] },
      { name: "Final", share: 0.1, tasks: [t("Touch-up walk with the client"), t("Pull the masking and clean up"), ...FINAL_TASKS("paint")] },
    ],
  },
  {
    key: "service",
    label: "Service upgrade",
    kind: "REMODEL",
    contingency: 0.05,
    stages: [
      { name: "Permit and order", share: 0.3, tasks: [t("Pull the permit"), t("Order the equipment — a panel, a water heater, a furnace"), t("Book the utility's shut-off when the panel changes")] },
      { name: "Install", share: 0.5, tasks: [t("Remove the old equipment"), t("Set and connect the new", true)] },
      { name: "Inspection and final", share: 0.2, tasks: [t("Inspection"), t("The utility's release"), ...FINAL_TASKS("work")] },
    ],
  },
  // New construction (part 1 carries the custom home as plain stages; part 3 groups them into phases with gates).
  {
    key: "home",
    label: "Custom home",
    kind: "NEW_BUILD",
    contingency: 0.1,
    stages: [
      { name: "Land and feasibility", share: 0.02, tasks: [t("Parcel record: number, zoning, setbacks, acreage"), t("Flood zone, wetlands and slopes checked"), t("Access, covenants and the utilities at the street"), t("Rough budget and the go-ahead in writing")] },
      { name: "Design and engineering", share: 0.05, tasks: [t("Boundary and topo survey"), t("Soils report when the county or the lender asks"), t("Septic design and perc test, or the sewer tap"), t("Well, or the water availability letter"), t("House plans, structural and truss engineering, energy-code worksheet")] },
      { name: "Permits and fees", share: 0.05, tasks: [t("Building permit"), t("Grading and clearing permit"), t("Septic or sewer, well or water permits"), t("Driveway approach and the utility applications — power first, it takes longest"), t("Impact and mitigation fees paid; address assigned")] },
      { name: "Site work", share: 0.08, tasks: [t("Call 811 — utilities located"), t("Clearing and grubbing"), t("Erosion control and the construction entrance", true), t("Rough grading and the driveway base"), t("Temporary power, water and toilet; utility trenches")] },
      { name: "Foundation", share: 0.1, tasks: [t("Layout and excavation"), t("Footings poured", true), t("Inspection: footings"), t("Walls or slab, with the under-slab plumbing"), t("Inspection: foundation"), t("Waterproofing, drain tile and backfill")] },
      { name: "Framing and dry-in", share: 0.2, tasks: [t("Floor system"), t("Walls and trusses", true), t("Sheathing, windows and doors"), t("Roofing and house wrap"), t("Inspection: framing")] },
      { name: "Rough-ins", share: 0.14, tasks: [t("Plumbing rough-in"), t("Electrical rough-in and the service"), t("HVAC rough-in"), t("Low voltage and fire blocking"), t("Inspection: rough-ins")] },
      { name: "Insulation and drywall", share: 0.08, tasks: [t("Insulation"), t("Inspection: insulation"), t("Drywall, tape and prime", true), t("Siding and exterior trim")] },
      { name: "Finishes", share: 0.25, tasks: [t("Cabinets, counters and tile"), t("Floors, trim, doors and paint"), t("Fixtures, lights and appliances"), t("Drainfield, driveway and final grade"), t("Punch list")] },
      { name: "Final and keys", share: 0.03, tasks: [t("Final inspections"), t("Utility releases and the certificate of occupancy"), t("Walkthrough with the client", true), t("Sign-off, the final payment and the keys")] },
    ],
  },
];

/** The templates a project of this kind is offered, in the picker's order. */
export function templatesFor(kind: ProjectKind): readonly StageTemplate[] {
  return STAGE_TEMPLATES.filter((x) => x.kind === kind);
}

export function templateByKey(key: string | null | undefined): StageTemplate | null {
  return STAGE_TEMPLATES.find((x) => x.key === key) ?? null;
}

const STAGE_STOP = new Set(["and", "the", "with", "for", "stage", "work", "phase"]);
const stageWords = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STAGE_STOP.has(w));

/** Tasks for a stage named by hand (2026-11-06), read off the templates: the template stages whose name — or
 *  whose tasks — share a word with it: "Drywall" finds "Drywall and paint", "Insulation" finds the stage with the
 *  insulation task. The closest first, up to eight tasks, no repeats. Empty when nothing matches; the office types
 *  its own. */
export function suggestTasks(name: string): string[] {
  const words = stageWords(name);
  if (!words.length) return [];
  const scored: Array<{ score: number; tasks: TemplateTask[] }> = [];
  const overlap = (theirs: string[], weight: number) => {
    let score = 0;
    for (const w of words) for (const t of theirs) if (t === w) score += 3 * weight; else if (t.startsWith(w) || w.startsWith(t)) score += weight;
    return score;
  };
  for (const tpl of STAGE_TEMPLATES) {
    for (const st of tpl.stages) {
      const score = overlap(stageWords(st.name), 2) + st.tasks.reduce((n, t) => n + overlap(stageWords(t.title), 1), 0);
      if (score > 0) scored.push({ score, tasks: st.tasks });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  const out: string[] = [];
  const seen = new Set<string>();
  // Only the close matches: a stage scoring under half the best is a stray word, not the same work.
  const floor = (scored[0]?.score ?? 0) / 2;
  for (const s of scored.filter((x) => x.score >= floor)) {
    for (const t of s.tasks) {
      // "Final photos of the deck" and "… of the roof" are one suggestion.
      const key = t.title.toLowerCase().replace(/ of the .*$/, "");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(t.title);
      if (out.length >= 8) return out;
    }
  }
  return out;
}

/* WHAT TRADE A PROPOSAL IS — the words that say so, scored, not matched first-come: a roof's scope says "replace
   damaged decking", so "deck" alone would have called it a deck (seen on the stand, 2026-11-05). Every word's hits
   are counted, the title's twice, and the trade with the most wins; ties go to the earlier row. */
type TradeWords = { key: string | null; trade: TradeType; words: string[] };
const TRADE_WORDS: readonly TradeWords[] = [
  { key: "roof", trade: "Roofing", words: ["roof", "shingle", "underlayment", "ridge vent", "flashing", "tear-off", "tear off"] },
  { key: "deck", trade: "Decking", words: ["deck", "pergola", "gazebo", "railing", "joist"] },
  { key: "fence", trade: "Fencing", words: ["fence", "gate", "picket", "post"] },
  { key: "bath", trade: "Kitchen & Bath", words: ["bath", "shower", "tub", "vanity", "toilet"] },
  { key: "kitchen", trade: "Kitchen & Bath", words: ["kitchen", "cabinet", "countertop", "backsplash", "island"] },
  { key: "floors", trade: "Flooring", words: ["epoxy", "floor", "hardwood", "laminate", "vinyl", "lvp", "carpet"] },
  { key: "floors", trade: "Tile", words: ["tile", "grout"] },
  { key: "hvac", trade: "HVAC", words: ["hvac", "furnace", "heat pump", "air condition", "mini split", "mini-split", "condenser", "ductless", "thermostat"] },
  { key: "siding", trade: "Siding", words: ["siding", "house wrap", "soffit", "fascia"] },
  { key: "remodel", trade: "General Contractor", words: ["remodel", "renovat", "addition", "basement", "garage conversion", "adu"] },
  { key: null, trade: "Painting", words: ["paint", "stain"] },
  { key: null, trade: "Plumbing", words: ["plumb", "water heater", "drain", "sewer"] },
  { key: null, trade: "Electrical", words: ["electric", "panel", "outlet", "wiring"] },
  { key: null, trade: "Concrete", words: ["concrete", "driveway", "patio", "slab", "footing"] },
  { key: null, trade: "Landscaping", words: ["landscap", "lawn", "sod", "irrigation", "mulch"] },
  { key: null, trade: "Windows", words: ["window", "door"] },
];

function hits(text: string, word: string): number {
  if (!text || !word) return 0;
  let n = 0;
  let i = text.indexOf(word);
  while (i >= 0) {
    n++;
    i = text.indexOf(word, i + word.length);
  }
  return n;
}

/** The trade row the words point at, or null when they say nothing. */
function tradeFromWords(title: string | null | undefined, scope: string | null | undefined): TradeWords | null {
  const t = (title ?? "").toLowerCase();
  const s = (scope ?? "").toLowerCase();
  let best: { row: TradeWords; score: number } | null = null;
  for (const row of TRADE_WORDS) {
    const score = row.words.reduce((n, w) => n + 2 * hits(t, w) + hits(s, w), 0);
    if (score > 0 && (!best || score > best.score)) best = { row, score };
  }
  return best?.row ?? null;
}

/** The estimator that priced it names the trade outright: "roof", "fence", "hvac". */
function tradeFromEstimator(estimator: string | null | undefined): TradeWords | null {
  const est = (estimator ?? "").toLowerCase();
  const key = est === "roof" ? "roof" : est === "fence" ? "fence" : est === "hvac" ? "hvac" : null;
  return key ? (TRADE_WORDS.find((r) => r.key === key) ?? null) : null;
}

/** The company's first trade (its Lead Center list), as a template key and a trade. */
function tradeFromOrg(orgTrades: readonly string[] | undefined): TradeWords | null {
  for (const raw of orgTrades ?? []) {
    const row = TRADE_WORDS.find((r) => r.trade === raw);
    if (row) return row;
    if (raw === "Countertops") return TRADE_WORDS.find((r) => r.key === "kitchen") ?? null;
    if (raw === "Carpentry" || raw === "Drywall" || raw === "Insulation" || raw === "Demolition") return TRADE_WORDS.find((r) => r.key === "remodel") ?? null;
  }
  return null;
}

export type TradeInput = { estimator?: string | null; title?: string | null; scope?: string | null; orgTrades?: readonly string[] };

/**
 * Which template a sold proposal gets, from the estimator that made it ("roof", "fence", "hvac"), its words
 * ("Kitchen remodel", "composite deck", "master bath" — the title counts double), or the company's own trades.
 * Null when nothing says — the AI drafts the stages then, or the owner picks.
 */
export function templateFor(input: TradeInput): StageTemplate | null {
  const row = tradeFromEstimator(input.estimator) ?? tradeFromWords(input.title, input.scope) ?? tradeFromOrg(input.orgTrades);
  return row?.key ? templateByKey(row.key) : null;
}

// ── Automatic projects (the owner's default, 2026-11-05) ─────────────────────
// "By trade: deck, roof and remodel make a project; a service call stays a job. A switch, and a 'Make it a project'
// button on any job." The trades below are JobFlex's own list (lib/tradeTypes); a company turns each on or off.

export type ProjectSettings = { auto: boolean; trades: TradeType[] };

/** Trades whose sold proposals become projects unless the company says otherwise: the ones that run for days. */
export const PROJECT_TRADES_DEFAULT: readonly TradeType[] = [
  "Decking", "Roofing", "Fencing", "Siding", "Kitchen & Bath", "General Contractor", "Flooring", "Tile", "Countertops",
  "Carpentry", "Concrete", "Landscaping", "Windows", "Drywall", "Insulation", "Demolition",
];

export function parseProjectSettings(json: string | null | undefined): ProjectSettings {
  const fallback: ProjectSettings = { auto: true, trades: [...PROJECT_TRADES_DEFAULT] };
  if (!json) return fallback;
  try {
    const raw = JSON.parse(json) as Partial<{ auto: unknown; trades: unknown }>;
    const trades = Array.isArray(raw.trades) ? raw.trades.filter((x): x is TradeType => typeof x === "string" && (TRADE_TYPES as readonly string[]).includes(x)) : fallback.trades;
    return { auto: typeof raw.auto === "boolean" ? raw.auto : true, trades };
  } catch {
    return fallback;
  }
}

/** The trade a sold proposal counts as for the switch: its estimator, its words, else the company's first trade. */
export function proposalTrade(input: TradeInput): TradeType | null {
  const row = tradeFromEstimator(input.estimator) ?? tradeFromWords(input.title, input.scope);
  if (row) return row.trade;
  const first = (input.orgTrades ?? []).find((x) => (TRADE_TYPES as readonly string[]).includes(x)) as TradeType | undefined;
  return first ?? null;
}

/** Does a sold proposal become a project under these settings? */
export function makesProject(settings: ProjectSettings, trade: TradeType | null): boolean {
  if (!settings.auto) return false;
  if (!trade) return false;
  return settings.trades.includes(trade);
}

/** What the list and the page flag a project for, from its stages alone. */
export function stageFlags(input: { stages: readonly StageLike[]; sold: number; status: string; draftedByAi: boolean }, today: Date): Array<{ kind: "late" | "nostages" | "drafted"; text: string }> {
  const out: Array<{ kind: "late" | "nostages" | "drafted"; text: string }> = [];
  if (input.status === "COMPLETED" || input.status === "ARCHIVED") return out;
  const late = lateStages(input.stages, today);
  if (late.length) {
    const worst = late.reduce((a, b) => (b.days > a.days ? b : a));
    out.push({ kind: "late", text: `${worst.stage.name ?? "A stage"} ${lateWords(worst.days)}` });
  }
  if (input.draftedByAi) out.push({ kind: "drafted", text: "Stages drafted by AI — keep them?" });
  else if (!input.stages.length && input.sold > 0) out.push({ kind: "nostages", text: "No stages yet" });
  return out;
}
