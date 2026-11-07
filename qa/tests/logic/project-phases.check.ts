// NEW CONSTRUCTION — THE PHASES, the pure core (2026-11-07, part 4 of the plan "Projects: Remodel and New
// construction"): the start questions read tolerantly, the ten phases from the lot to the keys with shares that sum to
// one, the shaping by the answers (septic, a well, a basement, a slab, a shop, a lender, power from the pole), every
// inspection a known kind, the phase a project is on and its gate's words. Pure: no model, no database.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/project-phases.check.ts
import "../_lib/_server-only";
import { isInspectionKind } from "../../../src/lib/projectGates";
import { BUILD_DEFAULTS, BUILD_QUESTIONS, PHASE_KEYS, answersWords, gateLineOf, parseBuildAnswers, phaseLine, phaseStatus, phasesFor, readPhases, withDefaults } from "../../../src/lib/projectPhases/shared";
import { dependentsOf, layoutPlan, shiftPlan } from "../../../src/lib/projectTimeline/shared";
import { buildFactsFrom, finishSteps } from "../../../src/lib/projectFinish/shared";

let bad = 0;
function check(name: string, ok: boolean, extra?: unknown) {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && extra !== undefined ? `  ${JSON.stringify(extra)}` : ""}`);
}
const shares = (ps: ReturnType<typeof phasesFor>) => Math.round(ps.filter((p) => p.lane !== "Shop").reduce((n, p) => n + p.share, 0) * 1000) / 1000;
const kinds = (ps: ReturnType<typeof phasesFor>, key: string) => ps.find((p) => p.key === key)!.stages.flatMap((s) => (s.inspections ?? []).map((i) => i.kind));
const tasks = (ps: ReturnType<typeof phasesFor>, key: string) => ps.find((p) => p.key === key)!.stages.flatMap((s) => s.tasks.map((x) => x.title));

// ── the questions ──
check("questions: ten, in the order the dialog asks, each with its choices", BUILD_QUESTIONS.length === 10 && BUILD_QUESTIONS.every((q) => q.choices.length >= 2) && BUILD_QUESTIONS[0].key === "sewer" && BUILD_QUESTIONS[9].key === "fiber");
check("answers: read tolerantly — odd values are dropped, the defaults fill the rest", (() => {
  const a = parseBuildAnswers({ sewer: "SEPTIC", water: "pond", foundation: "BASEMENT", stories: 3, garage: "yes", shop: true, power: "POLE" });
  const d = withDefaults(a);
  return a.sewer === "SEPTIC" && a.water === undefined && a.foundation === "BASEMENT" && a.stories === undefined && a.garage === undefined && a.shop === true && d.water === "WATER" && d.stories === 1 && d.garage === true && parseBuildAnswers(null).sewer === undefined && BUILD_DEFAULTS.foundation === "CRAWL";
})());
check("answers: the sentence for the head", answersWords({}) === "sewer, water at the street, a crawl space, one story, a garage" && answersWords({ sewer: "SEPTIC", water: "WELL", foundation: "BASEMENT", stories: 2, shop: true, lender: true, power: "POLE", gas: false, fiber: true }) === "septic, a well, a basement, two stories, a garage, a shop, a lender, power from the pole, all electric, fiber", answersWords({}));

// ── the phases ──
const plain = phasesFor({});
const full = phasesFor({ sewer: "SEPTIC", water: "WELL", foundation: "BASEMENT", stories: 2, shop: true, lender: true, power: "POLE", gas: false, fiber: true });
const slab = phasesFor({ foundation: "SLAB", garage: false });
check("phases: ten from the lot to the keys by default, their shares sum to one, every stage has tasks", plain.length === 10 && shares(plain) === 1 && plain[0].key === "LAND" && plain[9].key === "FINAL" && plain.every((p) => p.stages.length > 0 && p.stages.every((s) => s.tasks.length > 0)) && PHASE_KEYS.length === 11);
check("phases: a shop adds its own lane after the site work; the main lane still sums to one", full.length === 11 && full[10].key === "SHOP" && full[10].lane === "Shop" && full[10].after === "SITE" && shares(full) === 1 && phaseLine(full).endsWith("Final and keys (+ a Shop lane)"));
check("phases: the site work runs beside the permits (both after design); the foundation waits for the permit", plain.find((p) => p.key === "SITE")!.after === "DESIGN" && plain.find((p) => p.key === "SITE")!.lane === "Site" && plain.find((p) => p.key === "PERMITS")!.after === "DESIGN" && plain.find((p) => p.key === "FOUNDATION")!.after === "PERMITS");
check("phases: every inspection is a known kind and every gate has words", [plain, full, slab].every((ps) => ps.every((p) => p.gate.words.length > 5 && p.stages.every((s) => (s.inspections ?? []).every((i) => isInspectionKind(i.kind))))));
check("phases: every stage's share adds up to its phase's share", [plain, full, slab].every((ps) => ps.every((p) => Math.abs(p.stages.reduce((n, s) => n + s.share, 0) - p.share) < 0.001)));

// ── the shaping ──
check("septic: the perc test, the health permit, the tank, the drainfield and its inspection", tasks(full, "DESIGN").some((x) => /perc test/.test(x)) && tasks(full, "PERMITS").some((x) => /Septic permit/.test(x)) && tasks(full, "SITE").some((x) => /Septic tank/.test(x)) && tasks(full, "FINISHES").some((x) => /Drainfield/.test(x)) && kinds(full, "FINISHES").includes("SEPTIC") && !tasks(plain, "FINISHES").some((x) => /Drainfield/.test(x)) && tasks(plain, "SITE").some((x) => /Sewer tap/.test(x)));
check("a well: the driller, the permit and the water test before the keys", tasks(full, "DESIGN").some((x) => /driller/.test(x)) && tasks(full, "PERMITS").some((x) => /Well permit/.test(x)) && kinds(full, "FINAL").includes("WELL") && tasks(full, "FINAL").some((x) => /water test/.test(x)) && !kinds(plain, "FINAL").includes("WELL"));
check("a basement: the soils report, the waterproofing; a slab: under-slab plumbing and the slab inspection; a crawl: the under-floor inspection", tasks(full, "DESIGN").some((x) => /Soils report — a basement/.test(x)) && tasks(full, "FOUNDATION").some((x) => /Waterproofing/.test(x)) && kinds(slab, "FOUNDATION").join(",") === "FOOTING,SLAB" && tasks(slab, "FOUNDATION").some((x) => /Under-slab/.test(x)) && kinds(plain, "FOUNDATION").includes("UNDERFLOOR") && !tasks(slab, "FRAME").some((x) => /Floor system/.test(x)) && tasks(plain, "FRAME").some((x) => /Floor system/.test(x)));
check("two stories, a garage: the stairs, the garage slab, framing and door", tasks(full, "FRAME").some((x) => /Second floor/.test(x)) && tasks(plain, "FOUNDATION").some((x) => /Garage slab/.test(x)) && plain.find((p) => p.key === "FRAME")!.stages[0].selections!.some((s) => s.name === "Garage door") && !tasks(slab, "FOUNDATION").some((x) => /Garage/.test(x)));
check("a lender: the draw schedule on the permits gate; power from the pole leads the permits phase", full.find((p) => p.key === "PERMITS")!.gate.kind === "LENDER" && /draw schedule/.test(full.find((p) => p.key === "PERMITS")!.gate.words) && plain.find((p) => p.key === "PERMITS")!.gate.kind === "CLIENT" && full.find((p) => p.key === "PERMITS")!.leads.some((l) => /pole/.test(l.what) && l.days === 90) && !plain.find((p) => p.key === "PERMITS")!.leads.some((l) => /pole/.test(l.what)));
check("all electric, fiber: the rough-ins say so", tasks(full, "ROUGH").some((x) => /all electric/.test(x)) && tasks(full, "ROUGH").some((x) => /Fiber/.test(x)) && tasks(plain, "ROUGH").some((x) => /gas line/.test(x)));
check("the finals cover the trades and the final inspection comes last", kinds(plain, "FINAL").join(",") === "PLUMBING_FINAL,MECHANICAL_FINAL,ELECTRICAL_FINAL,FINAL" && kinds(plain, "FINAL").filter((k) => k === "FINAL").length === 1 && [plain, full, slab].every((ps) => ps.flatMap((p) => p.stages).flatMap((s) => s.inspections ?? []).filter((i) => i.kind === "FINAL").length === 1));

// ── the phase a project is on ──
check("status: done when every stage is done, in progress when any moved, planned otherwise or with no stages", phaseStatus([{ phaseId: "x", status: "DONE" }, { phaseId: "x", status: "DONE" }]) === "DONE" && phaseStatus([{ phaseId: "x", status: "DONE" }, { phaseId: "x", status: "PLANNED" }]) === "ACTIVE" && phaseStatus([{ phaseId: "x", status: "PLANNED" }]) === "PLANNED" && phaseStatus([]) === "PLANNED");
const rows = full.map((p, i) => ({ id: p.key, key: p.key, name: p.name, position: i, share: p.share, gateKind: p.gate.kind, gateWords: p.gate.words, lane: p.lane }));
const r = readPhases(rows, [
  { phaseId: "LAND", status: "DONE" },
  { phaseId: "DESIGN", status: "DONE" },
  { phaseId: "PERMITS", status: "ACTIVE" },
  { phaseId: "SITE", status: "ACTIVE", gates: [{ name: "Erosion control / pre-construction", result: "PENDING", date: null }] },
  { phaseId: "SHOP", status: "PLANNED" },
]);
check("read: the current phase is the first not done on the main lane; its gate's words; a held inspection reads as waiting", r.current?.key === "PERMITS" && gateLineOf(r.current!) === "Permits issued, fees paid, the lender's draw schedule approved" && gateLineOf(r.phases.find((p) => p.key === "SITE")!) === "waits on Erosion control / pre-construction" && gateLineOf(r.phases.find((p) => p.key === "LAND")!) === "passed" && r.phases[0].stagesDone === 1, { current: r.current?.key });

// ── the Timeline with dependencies and lanes ──
const S = (id: string, position: number, startsAt: string | null, endsAt: string | null, afterId: string | null = null, lane: string | null = null) => ({ id, name: id, position, status: "PLANNED", startsAt, endsAt, afterId, lane, weight: 1 });
const chain = [S("design", 0, "2026-11-02", "2026-11-03"), S("permits", 1, "2026-11-04", "2026-11-06", "design"), S("site", 2, "2026-11-04", "2026-11-05", "design", "Site"), S("foundation", 3, "2026-11-09", "2026-11-11", "permits"), S("shop", 4, "2026-11-06", "2026-11-10", "site", "Shop")];
check("dependents: transitive, lane-blind; null when no stage depends on another", [...dependentsOf(chain, "permits")!].join(",") === "foundation" && [...dependentsOf(chain, "design")!].sort().join(",") === "foundation,permits,shop,site" && dependentsOf(chain, "foundation")!.size === 0 && dependentsOf(chain.map((x) => ({ id: x.id })), "design") === null);
const plan = shiftPlan({ stages: chain, jobs: [], inspections: [{ id: "i1", name: "Setback and footing", date: "2026-11-10", result: "PENDING", stageId: "foundation" }, { id: "i2", name: "Shop slab", date: "2026-11-09", result: "PENDING", stageId: "shop" }], stageId: "permits", days: 2, today: "2026-11-01", tz: "America/Los_Angeles" });
check("shift: a permit slip moves the foundation, not the site work or the shop beside it; only the foundation's inspection moves", !("error" in plan) && plan.byDependency && plan.stages.map((x) => x.id).join(",") === "foundation" && plan.inspections.map((x) => x.id).join(",") === "i1" && plan.words[1].includes("that depend on it"), "error" in plan ? plan : plan.stages.map((x) => x.id));
const flat = shiftPlan({ stages: chain.map((x) => ({ ...x, afterId: null })), jobs: [], inspections: [], stageId: "permits", days: 2, today: "2026-11-01", tz: "America/Los_Angeles" });
check("shift: without dependencies the old rule holds — everything after it moves", !("error" in flat) && !flat.byDependency && flat.stages.map((x) => x.id).join(",") === "site,foundation,shop");
const laid = layoutPlan(chain.map((x) => ({ ...x, startsAt: null, endsAt: null })), "2026-11-02", { perWeight: 2 });
const day = (id: string) => laid.find((x) => x.id === id)!;
check("layout: a stage starts after the one it waits for; the site work runs beside the permits; the shop beside the house", day("design").startsAt === "2026-11-02" && day("permits").startsAt === day("site").startsAt && day("permits").startsAt === "2026-11-04" && day("foundation").startsAt === "2026-11-06" && day("shop").startsAt === "2026-11-06", laid.map((x) => `${x.id} ${x.startsAt}–${x.endsAt}`));

// ── the finish line on a new build ──
const base = { status: "ACTIVE", stageCount: 12, stagesDone: true, jobsOpen: 0, punch: { open: 0, total: 2, withPhoto: 2 }, finalInspection: { id: "f", name: "Final inspection", date: "2026-12-01", result: "PASSED", resultAt: "2026-12-01T18:00:00Z", readyNote: null }, signedOffAt: null, signedOffBy: null, payment: { proposals: 1, billed: 400000, paid: 380000, owed: 20000 }, review: null, clientEmail: null, warrantyUntil: null, finishedAt: null };
const remodelSteps = finishSteps({ ...base, kind: "REMODEL" }).map((x) => x.key).join(",");
const buildSteps = finishSteps({ ...base, kind: "NEW_BUILD", build: buildFactsFrom([{ id: "t1", title: "Utility releases and the certificate of occupancy", done: true }, { id: "t2", title: "As-builts, manuals and warranties handed over", done: false }, { id: "t3", title: "Walkthrough with the client", done: false }]) });
check("finish: a remodel keeps its seven steps; a new build adds the CO, the handover and the walkthrough before the sign-off, read off the Final stage's tasks", remodelSteps === "punch,inspection,signoff,payment,review,warranty,finish" && buildSteps.map((x) => x.key).join(",") === "punch,inspection,co,handover,walkthrough,signoff,payment,review,warranty,finish" && buildSteps.find((x) => x.key === "co")!.state === "done" && buildSteps.find((x) => x.key === "handover")!.state === "next" && buildSteps.find((x) => x.key === "walkthrough")!.state === "todo", buildSteps.map((x) => `${x.key}:${x.state}`));
check("finish: the facts read the tasks by their words; a task missing is null", buildFactsFrom([{ id: "a", title: "Get the C.O.", done: false }]).co?.taskId === "a" && buildFactsFrom([]).walkthrough === null);

console.log(bad ? `\n${bad} FAILED` : "\nall ok");
process.exit(bad ? 1 : 0);
