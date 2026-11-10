// REPAIRS AND COME-BACKS (2026-11-09, the ProSmart gaps plan, part 2) — pure, shared by the repair sheet in the
// browser, the server that books it, the Operator and the checks (qa/tests/logic/repairs.check.ts).
//
// The owner, with ProSmart's Repair dialog on screen: adopt it to JobFlex and make it better. ProSmart books a return
// trip off a sold job with reason chips, a note, who goes, the pay, when and how long. JobFlex is many trades, so the
// chips come from the TRADE of the job that came back (a gutter seam, a sagging gate, a peeling epoxy floor), and it
// adds what ProSmart leaves out: WHY it came back (our work / a material / the client or the weather), WHO PAYS
// (warranty is free by default — the owner's call — billable sends a change order), and the count of come-backs per
// job and per crew member that only "our work" adds to.

export type RepairReason = {
  key: string;
  /** The chip the office ticks. */
  label: string;
  /** What the installer reads on the job — written as an instruction. */
  scope: string;
  /** Usually needs a part bought or cut before anyone drives out. */
  parts?: true;
};

export type RepairFamily =
  | "roofing"
  | "gutters"
  | "siding"
  | "decking"
  | "fencing"
  | "floors"
  | "painting"
  | "plumbing"
  | "electrical"
  | "hvac"
  | "windows"
  | "interior"
  | "landscaping"
  | "general";

const r = (key: string, label: string, scope: string, parts?: true): RepairReason => (parts ? { key, label, scope, parts } : { key, label, scope });

const FAMILY_REASONS: Record<RepairFamily, { label: string; reasons: RepairReason[] }> = {
  roofing: {
    label: "Roofing",
    reasons: [
      r("roof_leak", "Leak", "Find and stop the leak — check the flashing, the pipe boots and the valleys first"),
      r("roof_shingles", "Shingles lifted / blown off", "Replace or re-seal lifted and missing shingles", true),
      r("roof_flashing", "Flashing, vent or pipe boot", "Re-flash or replace the vent / pipe boot", true),
      r("roof_drip", "Drip edge / gutter apron", "Fix the drip edge and the apron at the gutter"),
      r("roof_nails", "Nail pops / exposed nails", "Seat or replace popped nails and seal the heads"),
      r("roof_vent", "Ridge or attic vent", "Check and fix the ridge / attic ventilation"),
    ],
  },
  gutters: {
    label: "Gutters",
    reasons: [
      r("gut_leak", "Leaking seam or corner", "Reseal or replace the leaking seam or corner"),
      r("gut_slope", "Not draining (slope)", "Re-pitch the run so it drains to the downspout"),
      r("gut_loose", "Loose / pulling away", "Re-fasten the run — a hanger every 2 ft, into the rafter tails"),
      r("gut_downspout", "Downspout or elbow", "Fix or replace the downspout / elbow and its straps", true),
      r("gut_guard", "Gutter guards", "Re-seat or replace the gutter guards", true),
      r("gut_overflow", "Overflowing in rain", "Clear the run and check the sizing — add an outlet if it can't keep up"),
    ],
  },
  siding: {
    label: "Siding",
    reasons: [
      r("sid_loose", "Loose or buckled panels", "Re-hang the loose / buckled panels — nail in the slot, not tight"),
      r("sid_damaged", "Cracked or damaged panel", "Replace the damaged panel", true),
      r("sid_trim", "Trim or corner", "Fix or replace the trim / corner post", true),
      r("sid_caulk", "Gaps / caulking", "Seal the gaps and re-caulk the joints"),
      r("sid_water", "Water behind the siding", "Check the flashing and the wrap behind the siding where water gets in"),
    ],
  },
  decking: {
    label: "Deck",
    reasons: [
      r("dk_boards", "Loose boards or popped screws", "Re-fasten loose boards and replace popped screws"),
      r("dk_rail", "Railing loose / wobbly", "Tighten or re-block the railing posts — it has to pass the push test"),
      r("dk_stairs", "Stairs or treads", "Fix the stairs: treads, stringers, the landing"),
      r("dk_finish", "Stain or sealer", "Touch up or redo the stain / sealer"),
      r("dk_ledger", "Ledger / flashing at the house", "Check the ledger and its flashing at the house wall"),
      r("dk_board_bad", "Board split or cupped", "Replace the split / cupped boards", true),
    ],
  },
  fencing: {
    label: "Fence",
    reasons: [
      r("fn_gate", "Gate sags / won't latch", "Re-hang the gate and set the latch — check the hinge post"),
      r("fn_post", "Post leaning or loose", "Re-set the leaning post — dig, plumb, re-concrete"),
      r("fn_boards", "Boards missing or broken", "Replace the missing / broken boards", true),
      r("fn_hardware", "Hinges or latch hardware", "Replace the hinges / latch", true),
      r("fn_line", "Line or height uneven", "Straighten the line and even out the top"),
      r("fn_stain", "Stain or finish", "Touch up or redo the stain"),
    ],
  },
  floors: {
    label: "Floors",
    reasons: [
      r("fl_peel", "Peeling or lifting", "Grind out the lifting area and re-coat / re-lay it"),
      r("fl_crack", "Cracks", "Fill and blend the cracks"),
      r("fl_bubble", "Bubbles or blisters", "Cut out the bubbles and patch them"),
      r("fl_finish", "Finish or color uneven", "Even out the finish / color"),
      r("fl_edge", "Edges or transitions", "Fix the edges and the transition strips", true),
      r("fl_grout", "Grout or caulk", "Re-grout / re-caulk where it's cracked or missing"),
      r("fl_tile", "Cracked tile or board", "Replace the cracked tile / board", true),
    ],
  },
  painting: {
    label: "Painting",
    reasons: [
      r("pt_touch", "Touch-ups / missed spots", "Touch up the missed spots"),
      r("pt_peel", "Peeling or blistering", "Scrape, prime and repaint where it peels"),
      r("pt_lines", "Cut lines or drips", "Clean up the cut lines and the drips"),
      r("pt_color", "Wrong color or sheen", "Repaint in the right color / sheen — check the order", true),
      r("pt_caulk", "Caulk or nail holes", "Caulk and fill, then paint over"),
    ],
  },
  plumbing: {
    label: "Plumbing",
    reasons: [
      r("pl_leak", "Leak at a fitting", "Find and fix the leaking fitting"),
      r("pl_drain", "Slow or clogged drain", "Clear the drain and check the slope / venting"),
      r("pl_fixture", "Fixture loose or faulty", "Re-set or replace the fixture", true),
      r("pl_pressure", "Pressure or temperature", "Check the pressure / temperature and the valves"),
      r("pl_heater", "Water heater", "Check the water heater"),
    ],
  },
  electrical: {
    label: "Electrical",
    reasons: [
      r("el_dead", "Outlet or switch not working", "Fix the dead outlet / switch"),
      r("el_breaker", "Breaker trips", "Find why the breaker trips"),
      r("el_light", "Light fixture", "Fix or replace the light fixture", true),
      r("el_cover", "Covers or plates missing", "Fit the missing covers / plates", true),
      r("el_inspect", "Inspection correction", "Make the correction the inspector asked for"),
    ],
  },
  hvac: {
    label: "HVAC",
    reasons: [
      r("hv_temp", "Not cooling or heating", "Diagnose why it doesn't cool / heat"),
      r("hv_noise", "Noise or vibration", "Find and stop the noise / vibration"),
      r("hv_drain", "Condensate drain / leak", "Clear the condensate line and check the pan"),
      r("hv_tstat", "Thermostat", "Check the thermostat — wiring and settings"),
      r("hv_air", "Weak airflow / ducts", "Check the filter, the ducts and the registers"),
      r("hv_refrig", "Refrigerant / line set", "Leak-check the line set and the charge", true),
    ],
  },
  windows: {
    label: "Windows & doors",
    reasons: [
      r("wd_draft", "Drafts / air leak", "Find and seal the air leak"),
      r("wd_leak", "Water leak", "Find where water gets in — flashing, sill, caulk"),
      r("wd_operate", "Won't open, close or lock", "Adjust it so it opens, closes and locks"),
      r("wd_screen", "Screens", "Fix or replace the screens", true),
      r("wd_trim", "Trim or caulking", "Fix the trim and re-caulk"),
      r("wd_glass", "Glass or seal (fogged)", "Replace the glass / sealed unit — check the size first", true),
    ],
  },
  interior: {
    label: "Interior",
    reasons: [
      r("in_doors", "Cabinet doors or drawers", "Adjust the cabinet doors and drawers — gaps, soft-close"),
      r("in_hardware", "Hardware — hinges, pulls", "Replace or re-fit the hardware", true),
      r("in_caulk", "Caulk or grout", "Re-caulk / re-grout"),
      r("in_drywall", "Drywall crack or patch", "Patch the drywall and paint to match"),
      r("in_trim", "Trim or baseboard", "Fix the trim / baseboard"),
      r("in_leak", "Leak under the sink or tub", "Find and fix the leak under the sink / tub"),
      r("in_counter", "Countertop or backsplash", "Fix the countertop / backsplash — seams, caulk, chips", true),
    ],
  },
  landscaping: {
    label: "Landscaping",
    reasons: [
      r("ls_plants", "Plants died", "Replace the plants that didn't take", true),
      r("ls_water", "Sprinklers / irrigation", "Fix the sprinklers / irrigation zones"),
      r("ls_drain", "Drainage or erosion", "Fix the drainage / erosion"),
      r("ls_pavers", "Pavers settled", "Lift and re-set the settled pavers"),
      r("ls_lawn", "Sod or lawn", "Patch the sod / lawn"),
    ],
  },
  general: {
    label: "General",
    reasons: [
      r("gn_broken", "Not working right", "Make it work as it should — see the note"),
      r("gn_loose", "Loose — needs adjusting", "Tighten and adjust what's loose"),
      r("gn_leak", "Leak", "Find and fix the leak"),
      r("gn_finish", "Finish or touch-up", "Touch up the finish"),
      r("gn_part", "Part damaged or missing", "Fit the damaged / missing part", true),
    ],
  },
};

/** Every trade's reasons end with these. */
export const COMMON_REASONS: RepairReason[] = [
  r("unfinished", "Left unfinished", "Finish the work left on the first visit"),
  r("cleanup", "Clean-up left behind", "Clean up the site: debris, nails, dust, materials left behind"),
  r("job_damage", "Damage from the job", "Fix what got damaged while we worked — look at the photos first", true),
  r("other", "Something else", "See the note below"),
];

export const REPAIR_FAMILIES = Object.keys(FAMILY_REASONS) as RepairFamily[];
export const familyLabel = (f: RepairFamily) => FAMILY_REASONS[f].label;

// The trade the job is in, from its proposal's trade and its own words. First match wins, in this order — "gutter
// guards on the new roof" is a gutter job, and "deck stain" is a deck job, not painting.
const FAMILY_RULES: ReadonlyArray<[RegExp, RepairFamily]> = [
  [/gutter|downspout|leaf ?guard/i, "gutters"],
  [/\broof|shingle|chimney|skylight/i, "roofing"],
  [/\bsiding\b|stucco|soffit|fascia/i, "siding"],
  [/\bdeck|pergola|patio cover|gazebo|railing/i, "decking"],
  [/\bfenc|\bgate\b/i, "fencing"],
  [/epoxy|floor|\btile\b|tiling|hardwood|\blvp\b|laminate|carpet|vinyl plank|concrete|driveway|\bslab\b|polyaspartic/i, "floors"],
  [/hvac|furnace|heat ?pump|\ba\/?c\b|air condition|mini.?split|\bducts?\b|thermostat/i, "hvac"],
  [/plumb|water heater|\bdrain\b|\bpipe|faucet|sewer/i, "plumbing"],
  [/electric|\bpanel\b|outlet|wiring|ev charger|lighting/i, "electrical"],
  [/window|\bdoors?\b|slider|garage door/i, "windows"],
  [/kitchen|\bbath|cabinet|countertop|backsplash|vanity|shower|drywall|sheetrock|carpentry|\btrim\b|basement|remodel|renovat|closet/i, "interior"],
  [/\bpaint|stain(ing)?\b/i, "painting"],
  [/landscap|\byard\b|\bsod\b|sprinkler|irrigation|retaining wall|paver|\btree\b/i, "landscaping"],
];

/** The trade family of the job that came back, from any of its words (its proposal's trade first). */
export function repairFamilyOf(...texts: Array<string | null | undefined>): RepairFamily {
  for (const t of texts) {
    const s = (t ?? "").trim();
    if (!s) continue;
    for (const [re, fam] of FAMILY_RULES) if (re.test(s)) return fam;
  }
  return "general";
}

/** The chips for a job of this family: its own, then the common ones. */
export function reasonsFor(family: RepairFamily): RepairReason[] {
  return [...FAMILY_REASONS[family].reasons, ...COMMON_REASONS];
}

const ALL_REASONS = new Map<string, RepairReason>([...REPAIR_FAMILIES.flatMap((f) => FAMILY_REASONS[f].reasons), ...COMMON_REASONS].map((x) => [x.key, x]));
export const reasonOf = (key: string): RepairReason | null => ALL_REASONS.get(key) ?? null;
/** Known keys only, each once, in the order given. */
export function cleanReasons(keys: readonly string[] | null | undefined): string[] {
  return [...new Set((keys ?? []).filter((k) => ALL_REASONS.has(k)))].slice(0, 12);
}
export function parseReasons(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? cleanReasons(v.filter((x): x is string => typeof x === "string")) : [];
  } catch {
    return [];
  }
}

/** Do any of these usually need a part in hand first? */
export function needsParts(keys: readonly string[]): boolean {
  return keys.some((k) => ALL_REASONS.get(k)?.parts);
}

/** The title the installer sees in their list: one reason names itself; several become a count, so it fits a phone. */
export function repairTitle(keys: readonly string[], client?: string | null): string {
  const labels = cleanReasons(keys).map((k) => ALL_REASONS.get(k)!.label);
  const tail = client?.trim() ? ` — ${client.trim()}` : "";
  if (!labels.length) return `Repair${tail}`;
  if (labels.length === 1) return `Repair: ${labels[0]}${tail}`;
  return `Repair: ${labels[0]} +${labels.length - 1} more${tail}`;
}

/** The scope the installer reads: each ticked reason as its own line, the office's note, then what the first job was. */
export function repairScope(keys: readonly string[], note: string | null | undefined, original?: { title: string; done?: string | null; crew?: string[] } | null): string {
  const lines = cleanReasons(keys).map((k) => `• ${ALL_REASONS.get(k)!.scope}`);
  const n = note?.trim();
  if (n) {
    if (lines.length) lines.push("");
    lines.push(n);
  }
  if (original) {
    if (lines.length) lines.push("");
    const done = original.done ? `, done ${original.done}` : "";
    const crew = original.crew?.length ? ` by ${original.crew.join(", ")}` : "";
    lines.push(`Come-back on: ${original.title}${done}${crew}.`);
  }
  return lines.join("\n").slice(0, 2000);
}

// ── why it came back, and who pays ─────────────────────────────────────────

export type RepairCause = "WORKMANSHIP" | "PRODUCT" | "CLIENT";
export const REPAIR_CAUSES: ReadonlyArray<{ key: RepairCause; label: string; hint: string }> = [
  { key: "WORKMANSHIP", label: "Our work", hint: "Counts as a come-back on the crew who did the job. Warranty — free to the client." },
  { key: "PRODUCT", label: "Material or part", hint: "A product failed — the crew isn't counted. Check the maker's warranty for the part." },
  { key: "CLIENT", label: "Client or weather", hint: "Not our work — the crew isn't counted, and it's usually billable." },
];
export const isCause = (v: unknown): v is RepairCause => v === "WORKMANSHIP" || v === "PRODUCT" || v === "CLIENT";
export const causeLabel = (c: string | null | undefined) => REPAIR_CAUSES.find((x) => x.key === c)?.label ?? "Not sure yet";
/** Only "our work" is the crew's come-back. Not sure counts nobody until the office says. */
export const countsAgainstCrew = (cause: string | null | undefined) => cause === "WORKMANSHIP";
/** The owner's rule: warranty — free — unless it was the client's or the weather's doing (then billable is offered). */
export const billableByDefault = (cause: string | null | undefined) => cause === "CLIENT";

export function whoPaysWords(billable: boolean, charge: number | null | undefined): string {
  if (!billable) return "Warranty — free to the client";
  return charge && charge > 0 ? `Billable — $${Math.round(charge * 100) / 100} to the client` : "Billable — price to set";
}

// ── the numbers ─────────────────────────────────────────────────────────────

/** One repair, as the counts read it: why it came back, who did the original job, and what the repair has cost. */
export type ComebackRow = { repairId: string; repairOfId: string | null; cause: string | null; originalCrew: readonly string[]; cost: number };

/** Come-backs per crew member: only "our work" counts, once per repair, against everyone who did the original job. */
export function crewComebacks(rows: readonly ComebackRow[]): Map<string, { comebacks: number; cost: number }> {
  const out = new Map<string, { comebacks: number; cost: number }>();
  for (const row of rows) {
    if (!countsAgainstCrew(row.cause)) continue;
    for (const w of new Set(row.originalCrew)) {
      const cur = out.get(w) ?? { comebacks: 0, cost: 0 };
      cur.comebacks += 1;
      cur.cost = Math.round((cur.cost + Math.max(0, row.cost)) * 100) / 100;
      out.set(w, cur);
    }
  }
  return out;
}

/**
 * Fold each repair's cost into the job that came back (lib/jobCost). `costs` holds every job's own cost; a repair's
 * total moves into its original's `repairs` (and the count), and the repair's own entry is dropped unless the
 * caller asked for it by id (`keep`) — so a list of all jobs counts each dollar once, under the job it belongs to.
 */
export function foldRepairCosts<C extends { total: number; repairs: number; repairsCount: number }>(
  costs: Map<string, C>,
  repairs: ReadonlyArray<{ id: string; repairOfId: string }>,
  make: (jobId: string) => C,
  keep: ReadonlySet<string>,
): Map<string, C> {
  for (const rep of repairs) {
    const own = costs.get(rep.id);
    let orig = costs.get(rep.repairOfId);
    if (!orig) costs.set(rep.repairOfId, (orig = make(rep.repairOfId)));
    orig.repairsCount += 1;
    if (own) {
      const add = Math.round(own.total * 100) / 100;
      orig.repairs = Math.round((orig.repairs + add) * 100) / 100;
      orig.total = Math.round((orig.total + add) * 100) / 100;
      if (!keep.has(rep.id)) costs.delete(rep.id);
    }
  }
  return costs;
}

/** The sheet's lengths, in hours. */
export const REPAIR_HOURS = [1, 2, 3, 4, 6, 8] as const;
export const DEFAULT_REPAIR_HOURS = 2;

const STOP = new Set(["with", "from", "that", "this", "left", "behind", "needs", "need", "the", "and", "not", "our", "job", "part", "else", "something", "or", "off", "won't"]);
/** The reason chips a person's own words name ("the gutter leaks at the corner" → the leaking seam or corner), for
 *  the Operator: each chip's own words, four letters or more, matched as word starts; at most three, in chip order. */
export function reasonsFromWords(family: RepairFamily, text: string | null | undefined): string[] {
  const t = ` ${(text ?? "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ")} `;
  if (!t.trim()) return [];
  const out: string[] = [];
  for (const reason of reasonsFor(family)) {
    if (reason.key === "other") continue;
    const words = reason.label.toLowerCase().replace(/[^a-z ]+/g, " ").split(/\s+/).filter((w) => w.length >= 4 && !STOP.has(w));
    // "leaking" ~ "leak", "loose" ~ "loosen": the first five letters (or the whole short word) as a word start.
    if (words.some((w) => t.includes(` ${w.slice(0, Math.min(5, w.length))}`))) out.push(reason.key);
    if (out.length >= 3) break;
  }
  return out;
}
