// SELECTIONS AND GATES — the pure core (2026-11-07, part 3 of the plan "Projects: Remodel and New construction"):
// the inspection kinds in the county's words and the kind a typed name points at, the gate rule (a stage waits on an
// inspection that has not passed) and its words, the selections' due day read from the stage, their states, the
// list's flags, the allowance read off the proposal's lines, the templates' inspections and selections, and the
// Operator's words. Pure: no model, no database.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/project-selections.check.ts
import "../_lib/_server-only";
import { GATE_PRESETS, INSPECTION_KINDS, INSPECTION_NAME, gateHolds, gateLine, gateShort, gateWords, inspectionKindOf, isInspectionKind } from "../../../src/lib/projectGates";
import { DEFAULT_SELECTION_LEAD, SELECTION_PRESETS, allowanceFromMaterials, allowanceWords, dueWords, leadDaysFor, selectionDue, selectionFlags, selectionState } from "../../../src/lib/projectSelections/shared";
import { STAGE_TEMPLATES, templateByKey } from "../../../src/lib/projectStages/shared";
import { selectionNamed } from "../../../src/lib/assistant/selections";
import type { SelectionRow } from "../../../src/lib/projectSelections/server";

let bad = 0;
function check(name: string, ok: boolean, extra?: unknown) {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && extra !== undefined ? `  ${JSON.stringify(extra)}` : ""}`);
}

// ── the kinds ──
check("gates: nineteen kinds, each with the county's words; the presets are kinds", INSPECTION_KINDS.length === 19 && INSPECTION_KINDS.every((k) => INSPECTION_NAME[k].length > 2) && GATE_PRESETS.every(isInspectionKind) && GATE_PRESETS[GATE_PRESETS.length - 1] === "FINAL");
check("gates: a typed name points at its kind", inspectionKindOf("Framing") === "FRAMING" && inspectionKindOf("rough in electrical") === "ELECTRICAL_ROUGH" && inspectionKindOf("Rough-in") === "ROUGH_IN" && inspectionKindOf("Wallboard nailing") === "DRYWALL" && inspectionKindOf("shear wall") === "SHEAR" && inspectionKindOf("Final inspection") === "FINAL" && inspectionKindOf("plumbing final") === "PLUMBING_FINAL" && inspectionKindOf("Setback and footing") === "FOOTING" && inspectionKindOf("septic tank") === "SEPTIC", {
  a: inspectionKindOf("rough in electrical"),
  b: inspectionKindOf("Wallboard nailing"),
});
check("gates: every county name points back at its own kind", INSPECTION_KINDS.every((k) => inspectionKindOf(INSPECTION_NAME[k]) === k), INSPECTION_KINDS.filter((k) => inspectionKindOf(INSPECTION_NAME[k]) !== k));
check("gates: a name the templates do not know is no kind", inspectionKindOf("garbage") === null && inspectionKindOf("") === null && inspectionKindOf(null) === null && !isInspectionKind("framing"));

// ── the rule ──
const pending = { name: "Framing", result: "PENDING", date: "2026-11-12", gate: true };
const passed = { name: "Framing", result: "PASSED", date: "2026-11-12", gate: true };
const failed = { name: "Framing", result: "FAILED", date: null, gate: true };
const off = { name: "Framing", result: "PENDING", date: null, gate: false };
check("rule: a pending or failed gate holds; a passed one, or one turned off, does not", gateHolds([pending]).length === 1 && gateHolds([failed]).length === 1 && gateHolds([passed]).length === 0 && gateHolds([off]).length === 0 && gateHolds([passed, pending, off]).length === 1);
check("rule: the line says booked / not booked / failed / passed", gateLine(pending) === "booked Nov 12" && gateLine(failed) === "failed — re-inspect" && gateLine(off) === "not booked yet" && gateLine(passed) === "passed");
const w = gateWords([pending], "Framing and tie-in");
check("rule: the refusal names the stage, the inspection, its state and the way out", /^Framing and tie-in waits on an inspection: Framing \(booked Nov 12\)\. Record it passed/.test(w) && /turn the gate off/.test(w) && gateWords([], "X") === "", w);
check("rule: two gates read as a list; the short line fits a card", /waits on inspections: Framing \(booked Nov 12\) and Insulation \(not booked yet\)/.test(gateWords([pending, { name: "Insulation", result: "PENDING", date: null, gate: true }], "Drywall")) && gateShort([pending]) === "waits on Framing — booked Nov 12" && gateShort([pending, failed]) === "waits on 2 inspections: Framing, Framing");

// ── the due day and the states ──
const today = "2026-11-10";
const base = { name: "Cabinets", leadDays: 42, dueBy: null, chosenAt: null, stageStart: "2026-12-22", stageDone: false };
check("due: the stage's first day less the lead time; a day set by hand wins; nothing without either", selectionDue(base) === "2026-11-10" && selectionDue({ ...base, dueBy: "2026-11-20" }) === "2026-11-20" && selectionDue({ ...base, stageStart: null }) === null && selectionDue({ ...base, leadDays: 0 }) === "2026-12-22");
check("state: chosen, late, soon, open, undated", selectionState({ ...base, chosenAt: "2026-11-01T00:00:00Z" }, today) === "chosen" && selectionState({ ...base, dueBy: "2026-11-09" }, today) === "late" && selectionState(base, today) === "soon" && selectionState({ ...base, dueBy: "2026-11-17" }, today) === "soon" && selectionState({ ...base, dueBy: "2026-11-18" }, today) === "open" && selectionState({ ...base, stageStart: null }, today) === "undated");
check("words: choose today / by tomorrow / in N days / N days late / no day", dueWords(base, today) === "choose today" && dueWords({ ...base, dueBy: "2026-11-11" }, today) === "choose by tomorrow" && dueWords({ ...base, dueBy: "2026-11-14" }, today) === "choose by Nov 14 (in 4 days)" && dueWords({ ...base, dueBy: "2026-11-07" }, today) === "3 days late" && dueWords({ ...base, dueBy: "2026-11-09" }, today) === "a day late" && /^no day yet/.test(dueWords({ ...base, stageStart: null }, today)));
check("allowance: over, under, on, or nothing to compare", allowanceWords(8400, 8000) === "$400 over the allowance" && allowanceWords(7800, 8000) === "$200 under the allowance" && allowanceWords(8000, 8000) === "on the allowance" && allowanceWords(8400, null) === null && allowanceWords(null, 8000) === null);

// ── the flags ──
const late1 = { ...base, name: "Cabinets", dueBy: "2026-11-07" };
const late2 = { ...base, name: "Tile", dueBy: "2026-11-09" };
const soon = { ...base, name: "Paint colors", dueBy: "2026-11-12" };
check("flags: one late selection reads by name and days; two read as a count; the earliest counts the days", selectionFlags([late1], today)[0]?.text === "Cabinets not chosen — 3 days past its day" && selectionFlags([late2, late1], today)[0]?.text === "2 selections not chosen past their day" && selectionFlags([late1], today)[0]?.kind === "selection-late");
check("flags: the next one due within three days is a warning; a week out is quiet", selectionFlags([soon], today)[0]?.text === "Choose the paint colors by Thu, Nov 12" && selectionFlags([soon], today)[0]?.kind === "selection-due" && selectionFlags([{ ...soon, dueBy: "2026-11-10" }], today)[0]?.text === "Choose the paint colors today" && selectionFlags([{ ...soon, dueBy: "2026-11-17" }], today).length === 0);
check("flags: chosen ones, ones on a done stage and undated ones flag nothing", selectionFlags([{ ...late1, chosenAt: "2026-11-08T00:00:00Z" }, { ...late2, stageDone: true }, { ...base, stageStart: null }], today).length === 0);
check("flags: late first, then due", selectionFlags([soon, late1], today).map((f) => f.kind).join(",") === "selection-late,selection-due");

// ── the lead times and the allowance off the materials ──
check("lead: the presets' lead times, the default for a name nobody knows", leadDaysFor("Cabinets") === 42 && leadDaysFor("Kitchen cabinets and counters") === 42 && leadDaysFor("Paint colors") === 7 && leadDaysFor("Garage door opener") === DEFAULT_SELECTION_LEAD && SELECTION_PRESETS.length >= 10);
const materials = [
  { name: "Shaker cabinets, white, 36-inch uppers", quantity: 12, unitCost: 400 },
  { name: "Cabinet pulls", quantity: 24, unitCost: 6 },
  { name: "Quartz slab", quantity: 2, unitCost: 1200 },
  { name: "Drywall 4x8", quantity: 30, unitCost: 14 },
  { name: "Tile, porcelain 12x24", quantity: 200, unitCost: null },
];
check("allowance: the matching lines add up; nothing priced is nothing; a custom name matches by its words", allowanceFromMaterials("Cabinets", materials) === 4944 && allowanceFromMaterials("Countertops", materials) === 2400 && allowanceFromMaterials("Tile", materials) === null && allowanceFromMaterials("Lighting", materials) === null && allowanceFromMaterials("Quartz island", materials) === 2400, {
  cab: allowanceFromMaterials("Cabinets", materials),
  ctr: allowanceFromMaterials("Countertops", materials),
  custom: allowanceFromMaterials("Quartz island", materials),
});

// ── the templates ──
check("templates: every inspection is a known kind; no inspection is a task any more", STAGE_TEMPLATES.every((t) => t.stages.every((st) => (st.inspections ?? []).every((i) => isInspectionKind(i.kind)) && st.tasks.every((x) => !/^(inspection:|final inspection)/i.test(x.title)))));
check("templates: every selection has a name, a lead time, and no repeats in a template", STAGE_TEMPLATES.every((t) => {
  const names = t.stages.flatMap((st) => (st.selections ?? []).map((x) => x.name));
  return names.every((n) => n.length > 1) && new Set(names).size === names.length && t.stages.every((st) => (st.selections ?? []).every((x) => x.leadDays >= 0 && x.leadDays <= 90));
}));
const kitchen = templateByKey("kitchen")!;
const deck = templateByKey("deck")!;
const home = templateByKey("home")!;
check("templates: the kitchen's rough-in and final are gates; its cabinets, counters and paint are selections", kitchen.stages.find((s) => s.name === "Rough-in")?.inspections?.[0]?.kind === "ROUGH_IN" && kitchen.stages[kitchen.stages.length - 1].inspections?.[0]?.kind === "FINAL" && kitchen.stages.flatMap((s) => s.selections ?? []).some((x) => x.name === "Cabinets" && x.leadDays === 42) && kitchen.stages.find((s) => s.name === "Drywall and paint")?.selections?.[0]?.name === "Paint colors");
check("templates: the deck's footings and framing are gates; the custom home's finals cover the trades", deck.stages.find((s) => s.name === "Footings")?.inspections?.[0]?.kind === "FOOTING" && deck.stages.find((s) => s.name === "Framing")?.inspections?.[0]?.kind === "FRAMING" && (home.stages[home.stages.length - 1].inspections ?? []).map((i) => i.kind).join(",") === "PLUMBING_FINAL,MECHANICAL_FINAL,ELECTRICAL_FINAL,FINAL" && home.stages.find((s) => s.name === "Rough-ins")?.inspections?.length === 3);
check("templates: one FINAL per template at most; every stage still has tasks and the shares still sum to one", STAGE_TEMPLATES.every((t) => t.stages.flatMap((s) => s.inspections ?? []).filter((i) => i.kind === "FINAL").length <= 1 && t.stages.every((s) => s.tasks.length > 0) && Math.abs(t.stages.reduce((n, s) => n + s.share, 0) - 1) < 0.001));
check("templates: a gate is on unless the template says otherwise", STAGE_TEMPLATES.every((t) => t.stages.every((s) => (s.inspections ?? []).every((i) => i.gate !== false))));

// ── the Operator's words ──
const row = (name: string, state: SelectionRow["state"]): SelectionRow => ({ id: name, name, stageId: null, stageName: null, stageStart: null, stageDone: false, leadDays: 14, dueBy: null, due: null, state, allowance: null, allowanceSuggested: null, chosen: null, vendor: null, price: null, chosenAt: null, note: null, position: 0 });
const rows = [row("Cabinets", "chosen"), row("Countertops", "open"), row("Tile and backsplash", "open"), row("Paint colors", "late")];
check("operator: the selection a word points at, an open one before a chosen one", selectionNamed(rows, "the cabinets")?.name === "Cabinets" && selectionNamed(rows, "tile")?.name === "Tile and backsplash" && selectionNamed(rows, "paint")?.name === "Paint colors" && selectionNamed(rows, "counters")?.name === "Countertops" && selectionNamed(rows, "windows") === null);

console.log(bad ? `\n${bad} FAILED` : "\nall ok");
process.exit(bad ? 1 : 0);
