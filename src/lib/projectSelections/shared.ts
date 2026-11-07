// SELECTIONS ON A PROJECT — the pure half (2026-11-07, the plan "Projects: Remodel and New construction", part 3).
// What the client has to choose — cabinets, counters, tile, fixtures, flooring, paint — each tied to the stage that
// needs it with a lead time, so its due day reads from the stage's first day the way a material's order-by day does
// (lib/projectBuying orderByDate); an allowance, the money set aside; and once chosen, what was picked, from whom, at
// what price. A choice not made by its day flags the project the way a late order does. This file holds the dates,
// the states, the words and the flags; it imports nothing that touches the server. The database half is ./server.ts.

import { dollars } from "@/lib/projectSubs/shared";

export { dollars };

/** A selection with no lead time of its own is needed this many days before its stage starts. */
export const DEFAULT_SELECTION_LEAD = 14;

const DAY_MS = 86_400_000;
const dayMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const fromMs = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** "2026-11-10" from a day in any of the shapes the app keeps it in; null for none. */
export function isoDay(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const t = typeof d === "string" ? Date.parse(d) : d.getTime();
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
}

/** Whole days from one day to another: negative when the second has passed. */
export const daysBetween = (fromIso: string, toIso: string) => Math.round((dayMs(toIso) - dayMs(fromIso)) / DAY_MS);

export const dayWords = (iso: string) => new Date(dayMs(iso)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
export const dayWordsLong = (iso: string) => new Date(dayMs(iso)).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

// ── the usual selections ─────────────────────────────────────────────────────

/** The names the sheet offers, with the lead time each usually needs (the days before the stage that the choice
 *  must be in, to order and receive it): cabinets six weeks, counters three, paint one. */
export const SELECTION_PRESETS: ReadonlyArray<{ name: string; leadDays: number }> = [
  { name: "Cabinets", leadDays: 42 },
  { name: "Countertops", leadDays: 21 },
  { name: "Tile", leadDays: 21 },
  { name: "Flooring", leadDays: 21 },
  { name: "Plumbing fixtures", leadDays: 21 },
  { name: "Lighting", leadDays: 14 },
  { name: "Appliances", leadDays: 28 },
  { name: "Paint colors", leadDays: 7 },
  { name: "Windows and doors", leadDays: 42 },
  { name: "Doors and trim", leadDays: 21 },
  { name: "Siding and exterior colors", leadDays: 28 },
  { name: "Roofing", leadDays: 14 },
];

/** The lead time a name usually carries, else the default. */
export function leadDaysFor(name: string): number {
  const n = name.toLowerCase();
  const hit = SELECTION_PRESETS.find((p) => n.includes(p.name.toLowerCase().split(" ")[0]));
  return hit?.leadDays ?? DEFAULT_SELECTION_LEAD;
}

// ── the due day and the state ────────────────────────────────────────────────

export type SelectionLike = {
  name: string;
  leadDays: number;
  /** A due day set by hand (ISO day), which wins over the one read from the stage. */
  dueBy: string | null;
  chosenAt: string | null;
  /** The first day of the stage that needs it (ISO day), or null while the stage has no days. */
  stageStart: string | null;
  stageDone?: boolean;
  stageName?: string | null;
};

/** The day the choice must be in: the one set by hand, else the stage's first day less the lead time; null when
 *  neither is known. */
export function selectionDue(s: Pick<SelectionLike, "dueBy" | "stageStart" | "leadDays">): string | null {
  if (s.dueBy) return s.dueBy.slice(0, 10);
  if (!s.stageStart) return null;
  return fromMs(dayMs(s.stageStart.slice(0, 10)) - Math.max(0, Math.round(s.leadDays)) * DAY_MS);
}

export type SelectionState = "chosen" | "late" | "soon" | "open" | "undated";

/** Chosen; else late (its day has passed), soon (within a week), open, or undated (its stage has no days yet). */
export function selectionState(s: SelectionLike, todayIso: string): SelectionState {
  if (s.chosenAt) return "chosen";
  const due = selectionDue(s);
  if (!due) return "undated";
  const n = daysBetween(todayIso, due);
  if (n < 0) return "late";
  if (n <= 7) return "soon";
  return "open";
}

/** "choose by Nov 12 (in 4 days)", "choose today", "3 days late", "no day yet — the stage has no dates". */
export function dueWords(s: SelectionLike, todayIso: string): string {
  const due = selectionDue(s);
  if (!due) return "no day yet — give the stage its days";
  const n = daysBetween(todayIso, due);
  if (n === 0) return "choose today";
  if (n === 1) return "choose by tomorrow";
  if (n === -1) return "a day late";
  if (n < 0) return `${-n} days late`;
  return `choose by ${dayWords(due)} (in ${n} days)`;
}

/** "$400 over the allowance", "$200 under the allowance", "on the allowance", or null without both figures. */
export function allowanceWords(price: number | null | undefined, allowance: number | null | undefined): string | null {
  if (price == null || allowance == null) return null;
  const d = Math.round(price - allowance);
  if (d > 0) return `${dollars(d)} over the allowance`;
  if (d < 0) return `${dollars(-d)} under the allowance`;
  return "on the allowance";
}

// ── the flags for the list ───────────────────────────────────────────────────

export type SelectionFlag = { kind: "selection-late" | "selection-due"; text: string };

/** What the project list flags about selections: choices past their day (urgent), and the next one due within
 *  three days. A chosen one, or one on a stage already done, flags nothing. */
export function selectionFlags(rows: readonly SelectionLike[], todayIso: string): SelectionFlag[] {
  const open = rows.filter((r) => !r.chosenAt && !r.stageDone);
  const dated = open.map((r) => ({ r, due: selectionDue(r) })).filter((x): x is { r: SelectionLike; due: string } => !!x.due);
  const out: SelectionFlag[] = [];
  const late = dated.filter((x) => daysBetween(todayIso, x.due) < 0).sort((a, b) => a.due.localeCompare(b.due));
  if (late.length) {
    const n = -daysBetween(todayIso, late[0].due);
    out.push({ kind: "selection-late", text: late.length === 1 ? `${late[0].r.name} not chosen — ${n} day${n === 1 ? "" : "s"} past its day` : `${late.length} selections not chosen past their day` });
  }
  const soon = dated.filter((x) => daysBetween(todayIso, x.due) >= 0 && daysBetween(todayIso, x.due) <= 3).sort((a, b) => a.due.localeCompare(b.due));
  if (soon.length) {
    const x = soon[0];
    const n = daysBetween(todayIso, x.due);
    out.push({ kind: "selection-due", text: soon.length === 1 ? `Choose the ${x.r.name.toLowerCase()} ${n === 0 ? "today" : n === 1 ? "by tomorrow" : `by ${dayWordsLong(x.due)}`}` : `${soon.length} selections due by ${dayWordsLong(soon[soon.length - 1].due)}` });
  }
  return out;
}

// ── the allowance read off the materials ─────────────────────────────────────

/* The material lines a selection's name covers: "Cabinets" the cabinet lines, "Countertops" the quartz and the
   granite, "Plumbing fixtures" the faucets and the toilet. A name the table does not know matches by its own words. */
const SELECTION_WORDS: ReadonlyArray<{ match: RegExp; words: readonly string[] }> = [
  { match: /cabinet/, words: ["cabinet", "vanity base"] },
  { match: /counter/, words: ["counter", "quartz", "granite", "marble", "butcher block", "laminate top"] },
  { match: /tile|backsplash/, words: ["tile", "backsplash", "grout", "thinset", "schluter"] },
  { match: /floor/, words: ["floor", "lvp", "vinyl plank", "hardwood", "laminate", "carpet", "underlayment"] },
  { match: /plumbing fixture|fixtures/, words: ["faucet", "sink", "toilet", "shower valve", "shower head", "tub", "fixture", "disposal"] },
  { match: /light/, words: ["light", "sconce", "pendant", "chandelier", "recessed", "can light"] },
  { match: /appliance/, words: ["range", "oven", "fridge", "refrigerator", "dishwasher", "microwave", "hood", "appliance", "washer", "dryer"] },
  { match: /paint/, words: ["paint", "primer", "stain"] },
  { match: /window|door/, words: ["window", "door", "slider", "patio door"] },
  { match: /trim/, words: ["trim", "baseboard", "casing", "crown", "door"] },
  { match: /siding|exterior/, words: ["siding", "hardie", "lap", "board and batten", "soffit", "fascia"] },
  { match: /roof|shingle/, words: ["shingle", "roofing", "metal roof", "underlayment", "ridge"] },
  { match: /deck|rail/, words: ["decking", "deck board", "composite", "trex", "railing", "baluster"] },
  { match: /fence/, words: ["fence", "picket", "panel", "post cap"] },
  { match: /egress/, words: ["egress", "window well"] },
  { match: /glass/, words: ["glass", "shower door", "enclosure"] },
  { match: /equipment|furnace|heat pump|water heater|panel/, words: ["furnace", "heat pump", "condenser", "air handler", "water heater", "panel", "equipment"] },
];

export type MaterialLike = { name: string; quantity: number; unitCost: number | null };

/** The materials' cost that a selection covers (quantity × cost each over the lines its words match), or null when
 *  nothing matches or nothing is priced — the card offers it as the allowance to set. */
export function allowanceFromMaterials(selectionName: string, materials: readonly MaterialLike[]): number | null {
  const n = selectionName.toLowerCase();
  const row = SELECTION_WORDS.find((x) => x.match.test(n));
  const words = row ? row.words : n.replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 3).map((w) => w.replace(/s$/, ""));
  if (!words.length) return null;
  let sum = 0;
  let any = false;
  for (const m of materials) {
    const name = m.name.toLowerCase();
    if (!words.some((w) => name.includes(w))) continue;
    if (m.unitCost == null || !(m.quantity > 0)) continue;
    sum += m.unitCost * m.quantity;
    any = true;
  }
  return any ? Math.round(sum * 100) / 100 : null;
}
