// BUDGET PRESETS (owner, 2026-11-07: "make preset budgets that possible can be … all budgets for each possible job
// and I can use that as well"). A starting budget for every kind of job JobFlex has a stage template for, and a few
// it doesn't: the usual lines of that job and each one's usual share of the cost. The card splits a total over them
// — the budget there now, or the sold price at the job's usual cost share, or what the office types — and every row
// can be changed or taken out before Save. Rules of thumb, plainly labelled, never a quote.
//
// Pure: no database. The shares are whole percents that sum to 100; the dollars a preset splits into always add up to
// the total to the dollar (the largest remainders take the odd dollars).

import { kindFor } from "./projectBudgetImport";

export type PresetGroup = "Remodel" | "Exterior & trades" | "New construction";
export const PRESET_GROUPS: readonly PresetGroup[] = ["Remodel", "Exterior & trades", "New construction"];

export type BudgetPreset = {
  /** The stage template's key when there is one (lib/projectStages/shared), so a project made from it is offered it. */
  key: string;
  label: string;
  group: PresetGroup;
  /** The job's usual cost as a share of its price — how a sold price becomes the total to split. Null: no price to
   *  read it from (a home built for yourself). */
  cost: number | null;
  /** One sentence on what it assumes. */
  about: string;
  rows: ReadonlyArray<readonly [name: string, pct: number]>;
};

export const BUDGET_PRESETS: readonly BudgetPreset[] = [
  // ── remodel ──
  {
    key: "kitchen",
    label: "Kitchen remodel",
    group: "Remodel",
    cost: 0.68,
    about: "A mid-range kitchen with new cabinets and counters, the layout kept.",
    rows: [["Demolition & haul-away", 4], ["Cabinets", 27], ["Countertops", 10], ["Appliances", 8], ["Plumbing", 6], ["Electrical & lighting", 8], ["Drywall & paint", 5], ["Flooring", 7], ["Tile & backsplash", 5], ["Carpentry & trim", 7], ["Permits & fees", 2], ["Cleanup", 1], ["Contingency", 10]],
  },
  {
    key: "bath",
    label: "Bathroom remodel",
    group: "Remodel",
    cost: 0.68,
    about: "A full bathroom taken to the studs: tile, tub or shower, vanity, fixtures.",
    rows: [["Demolition & haul-away", 5], ["Plumbing", 15], ["Electrical & lighting", 6], ["Vanity & top", 12], ["Tub & shower", 12], ["Tile", 16], ["Fixtures & faucets", 8], ["Drywall & paint", 5], ["Glass & mirrors", 5], ["Ventilation", 2], ["Permits & fees", 2], ["Cleanup", 2], ["Contingency", 10]],
  },
  {
    key: "basement",
    label: "Basement finish",
    group: "Remodel",
    cost: 0.68,
    about: "An unfinished basement made into living space, with an egress window.",
    rows: [["Framing", 13], ["Insulation", 6], ["Electrical", 11], ["Plumbing", 8], ["HVAC", 6], ["Drywall", 12], ["Doors & trim", 7], ["Flooring", 11], ["Paint", 6], ["Egress window", 6], ["Permits & fees", 3], ["Cleanup", 1], ["Contingency", 10]],
  },
  {
    key: "addition",
    label: "Addition",
    group: "Remodel",
    cost: 0.7,
    about: "A room added on a new foundation, tied into the house.",
    rows: [["Plans & engineering", 4], ["Permits & fees", 3], ["Excavation & site work", 5], ["Foundation", 10], ["Framing", 13], ["Roofing", 7], ["Windows & exterior doors", 7], ["Siding & exterior trim", 6], ["Electrical", 6], ["Plumbing", 5], ["HVAC", 5], ["Insulation", 3], ["Drywall", 5], ["Interior trim & doors", 4], ["Flooring", 4], ["Paint", 3], ["Cleanup & dumpster", 1], ["Contingency", 9]],
  },
  {
    key: "wholehouse",
    label: "Whole-house remodel",
    group: "Remodel",
    cost: 0.7,
    about: "Every room opened up: systems, finishes and a bigger contingency for what the walls hide.",
    rows: [["Demolition & haul-away", 5], ["Framing & structural", 8], ["Plumbing", 9], ["Electrical", 9], ["HVAC", 7], ["Insulation", 2], ["Drywall", 6], ["Cabinets & countertops", 12], ["Flooring", 8], ["Tile", 4], ["Interior trim & doors", 5], ["Paint", 5], ["Fixtures & appliances", 4], ["Permits & fees", 2], ["Cleanup", 1], ["Contingency", 13]],
  },
  {
    key: "adu",
    label: "Garage conversion or ADU",
    group: "Remodel",
    cost: 0.7,
    about: "A garage or a small detached unit made livable, with a kitchenette and a bath.",
    rows: [["Plans & permits", 5], ["Site work & utilities", 5], ["Foundation & slab", 7], ["Framing", 10], ["Roofing", 5], ["Windows & doors", 6], ["Siding & exterior", 5], ["Electrical", 7], ["Plumbing", 8], ["HVAC", 4], ["Insulation", 3], ["Drywall", 5], ["Kitchenette", 6], ["Bathroom", 7], ["Flooring", 4], ["Paint & trim", 4], ["Contingency", 9]],
  },
  {
    key: "remodel",
    label: "General remodel",
    group: "Remodel",
    cost: 0.7,
    about: "A room or two reworked — walls, systems and finishes.",
    rows: [["Demolition & haul-away", 6], ["Framing & carpentry", 15], ["Electrical", 9], ["Plumbing", 9], ["Drywall", 8], ["Flooring", 11], ["Paint", 8], ["Trim & doors", 7], ["Fixtures & finishes", 10], ["Permits & fees", 3], ["Equipment & rentals", 2], ["Cleanup", 2], ["Contingency", 10]],
  },
  {
    key: "floors",
    label: "Floors (wood, LVP, tile, epoxy)",
    group: "Remodel",
    cost: 0.62,
    about: "Old flooring out, the floor prepped, new flooring and trim in.",
    rows: [["Flooring material", 42], ["Underlayment & prep", 8], ["Trim & transitions", 5], ["Labor", 35], ["Removal & disposal", 4], ["Equipment & rentals", 2], ["Contingency", 4]],
  },
  {
    key: "painting",
    label: "Painting",
    group: "Remodel",
    cost: 0.55,
    about: "Interior or exterior paint — mostly labor.",
    rows: [["Paint & primer", 18], ["Supplies", 6], ["Labor", 62], ["Prep & repairs", 5], ["Equipment & rentals", 4], ["Contingency", 5]],
  },
  // ── exterior & trades ──
  {
    key: "deck",
    label: "Deck",
    group: "Exterior & trades",
    cost: 0.62,
    about: "A new deck on footings, with railing and stairs.",
    rows: [["Decking & railing", 38], ["Framing lumber", 15], ["Footings & concrete", 6], ["Hardware & fasteners", 6], ["Labor", 23], ["Permits & fees", 3], ["Equipment & rentals", 2], ["Cleanup & haul-away", 2], ["Contingency", 5]],
  },
  {
    key: "roof",
    label: "Roof replacement",
    group: "Exterior & trades",
    cost: 0.6,
    about: "A tear-off and a new shingle roof, some sheathing replaced.",
    rows: [["Shingles & underlayment", 38], ["Flashing, vents & drip edge", 7], ["Sheathing repairs", 5], ["Labor", 35], ["Dumpster & disposal", 6], ["Permits & fees", 2], ["Equipment & rentals", 2], ["Contingency", 5]],
  },
  {
    key: "siding",
    label: "Siding",
    group: "Exterior & trades",
    cost: 0.6,
    about: "Old siding off, wrap and flashing, new siding and trim.",
    rows: [["Siding", 40], ["House wrap & flashing", 6], ["Trim, soffit & fascia", 10], ["Labor", 33], ["Dumpster & disposal", 4], ["Equipment & rentals", 3], ["Permits & fees", 1], ["Contingency", 3]],
  },
  {
    key: "windows",
    label: "Windows and doors",
    group: "Exterior & trades",
    cost: 0.65,
    about: "Replacement windows and exterior doors, trimmed and sealed.",
    rows: [["Windows", 45], ["Exterior doors", 15], ["Trim & flashing", 6], ["Labor", 24], ["Disposal", 2], ["Permits & fees", 2], ["Paint & caulk", 2], ["Contingency", 4]],
  },
  {
    key: "fence",
    label: "Fence",
    group: "Exterior & trades",
    cost: 0.6,
    about: "Posts set in concrete, panels or pickets, a gate or two.",
    rows: [["Posts & concrete", 14], ["Panels, pickets & rails", 38], ["Gates & hardware", 10], ["Labor", 30], ["Permits & fees", 2], ["Equipment & rentals", 2], ["Haul-away", 1], ["Contingency", 3]],
  },
  {
    key: "hvac",
    label: "HVAC replacement",
    group: "Exterior & trades",
    cost: 0.65,
    about: "A furnace, heat pump or AC swapped, with the ductwork it needs.",
    rows: [["Equipment", 50], ["Ductwork & materials", 12], ["Labor", 25], ["Electrical", 4], ["Permits & fees", 3], ["Removal & disposal", 2], ["Contingency", 4]],
  },
  {
    key: "service",
    label: "Electrical service upgrade",
    group: "Exterior & trades",
    cost: 0.62,
    about: "A new panel and service — meter base, mast, grounding, the utility's part.",
    rows: [["Panel & breakers", 25], ["Meter base & service mast", 10], ["Wire & materials", 12], ["Labor", 35], ["Permits & fees", 6], ["Grounding & bonding", 4], ["Patch & repair", 3], ["Contingency", 5]],
  },
  {
    key: "concrete",
    label: "Concrete & flatwork",
    group: "Exterior & trades",
    cost: 0.62,
    about: "A driveway, patio or walks: base, forms, rebar, the pour.",
    rows: [["Concrete", 35], ["Base gravel & prep", 10], ["Forms & rebar", 10], ["Labor", 33], ["Equipment & rentals", 5], ["Pump & delivery", 3], ["Permits & fees", 1], ["Contingency", 3]],
  },
  {
    key: "landscaping",
    label: "Landscaping",
    group: "Exterior & trades",
    cost: 0.6,
    about: "Plants, soil, irrigation and some hardscape.",
    rows: [["Plants & trees", 22], ["Soil, mulch & rock", 14], ["Irrigation", 12], ["Hardscape", 18], ["Labor", 26], ["Equipment & rentals", 4], ["Haul-away", 2], ["Contingency", 2]],
  },
  // ── new construction ──
  {
    key: "home",
    label: "Custom home (client's land)",
    group: "New construction",
    cost: 0.82,
    about: "A house built for a client on their lot, from plans to the keys — the lines a lender's budget carries.",
    rows: [["Plans, engineering & surveys", 3], ["Permits & fees", 3], ["Site work & excavation", 4], ["Utilities & hookups", 3], ["Foundation", 9], ["Framing", 13], ["Roofing", 4], ["Windows & exterior doors", 4], ["Siding & exterior trim", 5], ["Plumbing", 5], ["Electrical", 5], ["HVAC", 4], ["Insulation", 2], ["Drywall", 4], ["Cabinets & countertops", 6], ["Interior trim & doors", 3], ["Flooring", 4], ["Paint", 3], ["Fixtures & appliances", 3], ["Driveway & flatwork", 2], ["Landscaping", 1], ["General conditions", 2], ["Contingency", 8]],
  },
  {
    key: "spec",
    label: "Spec home — land to keys",
    group: "New construction",
    cost: null,
    about: "A house you build for yourself or to sell: the land, the loan's costs and the build in one budget.",
    rows: [["Land", 18], ["Loan interest & closing", 2], ["Plans, engineering & surveys", 3], ["Permits & fees", 3], ["Site work & excavation", 4], ["Utilities & hookups", 3], ["Foundation", 7], ["Framing", 10], ["Roofing", 3], ["Windows & exterior doors", 3], ["Siding & exterior trim", 4], ["Plumbing", 4], ["Electrical", 4], ["HVAC", 3], ["Insulation", 2], ["Drywall", 3], ["Cabinets & countertops", 5], ["Interior trim & doors", 2], ["Flooring", 3], ["Paint", 2], ["Fixtures & appliances", 2], ["Driveway & flatwork", 2], ["Landscaping", 1], ["General conditions", 1], ["Contingency", 6]],
  },
];

export function presetByKey(key: string | null | undefined): BudgetPreset | null {
  return BUDGET_PRESETS.find((p) => p.key === key) ?? null;
}

/** The preset a trade points at when the project has no template of its own (lib/tradeTypes' names). */
const TRADE_PRESET: Record<string, string> = {
  Decking: "deck",
  Roofing: "roof",
  Fencing: "fence",
  Siding: "siding",
  "Kitchen & Bath": "kitchen",
  "General Contractor": "remodel",
  Flooring: "floors",
  Tile: "floors",
  Countertops: "kitchen",
  HVAC: "hvac",
  Concrete: "concrete",
  Painting: "painting",
  Landscaping: "landscaping",
  Windows: "windows",
  Electrical: "service",
};
export const presetForTrade = (trade: string | null | undefined) => (trade ? (TRADE_PRESET[trade] ?? null) : null);

export type SplitRow = { name: string; kind: string; amount: number; pct: number };

/** Shares over a total, in whole dollars that add up to it exactly: each row its share rounded down, the dollars left
 *  over to the largest remainders. */
export function splitTotal(rows: ReadonlyArray<readonly [string, number]>, total: number): SplitRow[] {
  const whole = Math.max(0, Math.round(total));
  const sum = rows.reduce((n, [, p]) => n + p, 0) || 1;
  const exact = rows.map(([name, p]) => ({ name, pct: p / sum, raw: (whole * p) / sum }));
  const out = exact.map((r) => ({ name: r.name, kind: kindFor(r.name), pct: r.pct, amount: Math.floor(r.raw) }));
  let left = whole - out.reduce((n, r) => n + r.amount, 0);
  const order = exact.map((r, i) => ({ i, rem: r.raw - Math.floor(r.raw) })).sort((a, b) => b.rem - a.rem);
  for (let k = 0; left > 0 && order.length; k = (k + 1) % order.length, left--) out[order[k].i].amount += 1;
  return out;
}

/** A project's own budget as shares — another job of the shop's used as a preset ("start from the Kessler kitchen"). */
export function sharesOf(lines: ReadonlyArray<{ category: string; amount: number }>): Array<[string, number]> {
  const total = lines.reduce((n, l) => n + Math.max(0, l.amount), 0);
  if (total <= 0) return [];
  return lines.filter((l) => l.amount > 0).map((l) => [l.category, (l.amount / total) * 100] as [string, number]);
}
