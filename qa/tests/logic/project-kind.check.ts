// REMODEL OR NEW CONSTRUCTION — the pure core (2026-11-07, part 1 of the plan "Projects: Remodel and New
// construction"): the kind read tolerantly, the questions at the start, every template under its kind with shares
// that sum to one and tasks on every stage, the living-in-place tasks added once, the word the Operator turns into a
// template. Pure: no model, no database.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/project-kind.check.ts
import "../_lib/_server-only";
import { KIND_LABEL, KIND_TAG, LIVING_IN_PLACE_TASKS, PROJECT_KINDS, isProjectKind, kindOf, livingInPlaceTasks, onSiteStageIndex, parseAnswers, serializeAnswers } from "../../../src/lib/projectKind";
import { STAGE_TEMPLATES, templateByKey, templateFor, templatesFor } from "../../../src/lib/projectStages/shared";
import { templateNamed } from "../../../src/lib/assistant/projects";

let bad = 0;
function check(name: string, ok: boolean, extra?: unknown) {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && extra !== undefined ? `  ${JSON.stringify(extra)}` : ""}`);
}

// ── the kind ──
check("kind: the two kinds, labelled and tagged", PROJECT_KINDS.length === 2 && KIND_LABEL.NEW_BUILD === "New construction" && KIND_TAG.NEW_BUILD === "New build" && KIND_TAG.REMODEL === "Remodel");
check("kind: a stored value is read tolerantly — anything odd is a remodel", kindOf("NEW_BUILD") === "NEW_BUILD" && kindOf("REMODEL") === "REMODEL" && kindOf(null) === "REMODEL" && kindOf("house") === "REMODEL" && isProjectKind("NEW_BUILD") && !isProjectKind("new_build"));

// ── the questions at the start ──
check("answers: nothing stored is nothing", Object.keys(parseAnswers(null)).length === 0 && Object.keys(parseAnswers("garbage")).length === 0 && serializeAnswers({}) === null);
check("answers: occupied and the template survive a round trip; odd values are dropped", (() => {
  const a = parseAnswers(serializeAnswers({ occupied: true, template: "kitchen" }));
  const b = parseAnswers(JSON.stringify({ occupied: "yes", template: 7, extra: 1 }));
  return a.occupied === true && a.template === "kitchen" && b.occupied === undefined && b.template === undefined;
})());

// ── the templates ──
const remodels = templatesFor("REMODEL");
const builds = templatesFor("NEW_BUILD");
check("templates: sixteen remodel templates (the nine and the seven presets) and the custom home", remodels.length === 16 && builds.length === 1 && builds[0].key === "home", { remodels: remodels.length, builds: builds.length });
check("templates: every template is under one kind and the two lists cover them all", STAGE_TEMPLATES.every((t) => isProjectKind(t.kind)) && remodels.length + builds.length === STAGE_TEMPLATES.length);
check("templates: keys are unique", new Set(STAGE_TEMPLATES.map((t) => t.key)).size === STAGE_TEMPLATES.length);
for (const t of STAGE_TEMPLATES) {
  const sum = t.stages.reduce((n, s) => n + s.share, 0);
  check(`templates: ${t.label} — shares sum to one, every stage has tasks, a photo point and a final`, Math.abs(sum - 1) < 0.001 && t.stages.every((s) => s.tasks.length > 0 && s.name.length <= 120) && t.stages.some((s) => s.tasks.some((x) => x.photoNeeded)) && /final/i.test(t.stages[t.stages.length - 1].name), { sum: Math.round(sum * 1000) / 1000 });
}
check("templates: the custom home runs from the land to the keys in ten stages", builds[0].stages.length === 10 && /land/i.test(builds[0].stages[0].name) && /keys/i.test(builds[0].stages[9].name) && builds[0].stages.some((s) => s.tasks.some((x) => /certificate of occupancy/i.test(x.title))));
check("templates: a sold proposal still finds a remodel template, never the custom home", templateFor({ title: "Kitchen remodel" })?.key === "kitchen" && templateFor({ title: "New house build" })?.kind !== "NEW_BUILD" && templateByKey("home")?.kind === "NEW_BUILD");
check("templates: the whole house carries a bigger contingency than a painting job", (templateByKey("wholehouse")?.contingency ?? 0) === 0.15 && (templateByKey("painting")?.contingency ?? 0) === 0.05 && (templateByKey("home")?.contingency ?? 0) === 0.1);

// ── living in place ──
check("living in place: the five tasks, and the ones a template already has are not added twice", LIVING_IN_PLACE_TASKS.length === 5 && livingInPlaceTasks([]).length === 5 && livingInPlaceTasks(["Protect the floors and doorways", "Haul away"]).length === 4 && !livingInPlaceTasks(["Protect the floors and doorways"]).some((t) => /^Protect/.test(t)));
check("living in place: it lands on the first stage that works in the house", onSiteStageIndex(["Selections and materials", "Demolition", "Rough-in"]) === 1 && onSiteStageIndex(["Measure and order", "Install", "Trim and final"]) === 1 && onSiteStageIndex(["Plans and permits", "Site and footings"]) === 1 && onSiteStageIndex(["Equipment ordered", "Startup"]) === 0);

// ── the Operator's words ──
check("operator: the template a word points at, within the kind", templateNamed("REMODEL", "kitchen")?.key === "kitchen" && templateNamed("REMODEL", "Whole-house remodel")?.key === "wholehouse" && templateNamed("REMODEL", "basement")?.key === "basement" && templateNamed("NEW_BUILD", "home")?.key === "home" && templateNamed("NEW_BUILD", "new house")?.key === "home" && templateNamed("NEW_BUILD", "kitchen") === null && templateNamed("REMODEL", null) === null);

console.log(bad ? `\n${bad} FAILED` : "\nall ok");
process.exit(bad ? 1 : 0);
