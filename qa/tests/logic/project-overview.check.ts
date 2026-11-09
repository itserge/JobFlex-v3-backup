// THE PROJECT OVERVIEW AND THE WORKSPACES (2026-11-09): the Overview's rules (the status line's colour and words, Do
// now's rows, their order and their buttons, the next 14 days, who waits on whom, the road, "Not now"), and the three
// workspaces (which one a project lives in, the job kind's templates, the road's steps, the chooser's numbers).
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/project-overview.check.ts
import { aheadOf, overviewOf, parseSnoozes, peopleOf, roadOf, snoozeUntil, visibleItems, type OverviewInput } from "../../../src/lib/projectOverview/shared";
import { ROADS, roadStepOf, spaceOf, SPACES } from "../../../src/lib/projectSpaces";
import { kindForTemplate, templateByKey, templatesFor } from "../../../src/lib/projectStages/shared";
import { KIND_LABEL, kindOf, kindsSwap, PROJECT_KINDS } from "../../../src/lib/projectKind";
import { roadPins, spaceSummaries, needsToday } from "../../../src/components/v3/projects-blueprint/project-spaces-data";
import type { Project } from "../../../src/components/v3/projects-blueprint/projects-data";

let bad = 0;
function check(name: string, ok: boolean, extra?: unknown) {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && extra !== undefined ? `  ${JSON.stringify(extra)}` : ""}`);
}

const TODAY = "2026-11-09";
const day = (n: number) => new Date(Date.parse(`${TODAY}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
type Any = never;

function base(over: Partial<OverviewInput> = {}): OverviewInput {
  return {
    today: TODAY,
    project: { id: "p1", kind: "REMODEL", status: "ACTIVE", endsAt: null, clientName: "Sarah Lee", clientPhone: null, clientEmail: null, budget: 0 },
    stages: [],
    done: null,
    phases: null,
    field: null,
    timeline: null,
    buying: null,
    selections: null,
    subs: null,
    invoices: null,
    money: null,
    payments: [],
    draws: null,
    share: null,
    finish: [],
    jobs: [],
    collected: 0,
    owed: 0,
    subsHref: "/dashboard/projects/p1/subs",
    ...over,
  };
}
const stage = (id: string, name: string, status: string, startsAt: string | null, endsAt: string | null, extra: object = {}) => ({ id, name, status, startsAt, endsAt, doneAt: status === "DONE" ? `${day(-10)}T12:00:00.000Z` : null, ...extra });

// ── the status line ──────────────────────────────────────────────────────────
{
  const o = overviewOf(base());
  check("a project with no stages needs you: amber, 'No stages yet', 'no stages yet'", o.tone === "amber" && o.word === "Needs you" && o.doNow[0]?.key === "no-stages" && o.line === "no stages yet", o);
}
{
  const o = overviewOf(base({ stages: [stage("s1", "Demo", "DONE", day(-20), day(-15)), stage("s2", "Rough-in", "ACTIVE", day(-10), day(-4)), stage("s3", "Drywall", "PLANNED", day(3), day(8))], done: 40 }));
  const late = o.doNow.find((x) => x.key === "late:s2");
  check("a stage 4 days late is red, 'At risk', '4 days behind'", o.tone === "red" && o.word === "At risk" && o.behind === 4 && o.line.startsWith("4 days behind") && late?.tone === "red" && late.text === "Rough-in 4 days late", o);
  check("its button moves the dates; the other says it's done", late?.act?.t === "go" && late.act.card === "timeline" && late.alt?.t === "stage-done", late);
  check("the sub-line names the stage, the % and the count", o.sub.startsWith("Rough-in · 40% done · ") && /thing/.test(o.sub), o.sub);
  const road = roadOf(base({ stages: [stage("s1", "Demo", "DONE", day(-20), day(-15)), stage("s2", "Rough-in", "ACTIVE", day(-10), day(-4)), stage("s3", "Drywall", "PLANNED", day(3), day(8))] }));
  check("the road: done, late, to do", road.map((x) => x.state).join(",") === "done,late,todo", road);
}
{
  const o = overviewOf(base({ stages: [stage("s2", "Rough-in", "ACTIVE", day(-10), day(-1), { gates: [{ id: "g", name: "Rough-in inspection", result: "PENDING", date: null }] })] }));
  const late = o.doNow.find((x) => x.key === "late:s2");
  check("a stage 1 day late is amber; held by a gate, no 'It's done' and the why names it", late?.tone === "amber" && late.alt === null && late.why === "Waits on Rough-in inspection", late);
}
{
  const o = overviewOf(base({ stages: [stage("s1", "Tile", "ACTIVE", day(-2), day(5))], money: { totals: { budget: 120000, spent: 68400, committed: 31000, left: 20600, headingFor: 123200, over: 3200 }, advice: [{}, {}], contract: 150000, margin: { amount: 26800, pct: 18, against: "contract" } } as Any }));
  const over = o.doNow.find((x) => x.key === "over-budget");
  check("heading over budget is red, with the ways to save", over?.tone === "red" && over.text === "Heading $3,200 over budget" && over.act?.t === "go" && over.act.label === "2 ways to save", over);
  check("the line says on schedule and the dollars over", o.line === "on schedule · $3,200 over budget", o.line);
  check("the money block carries the figures", o.money?.budget === 120000 && o.money.headingFor === 123200 && o.money.ideas === 2 && o.money.contract === 150000, o.money);
}
{
  const o = overviewOf(base({ stages: [stage("s1", "Tile", "ACTIVE", day(-2), day(5))], money: { totals: { budget: 120000, spent: 50000, committed: 10000, left: 60000, headingFor: 110000, over: -10000 }, advice: [], contract: null, margin: null } as Any }));
  check("nothing due and under budget: green, 'On track', '$10,000 under budget'", o.tone === "green" && o.word === "On track" && o.line === "on schedule · $10,000 under budget" && o.doNow.length === 0, o);
}

// ── the order: the crew first, then money, then those waiting ────────────────
{
  const o = overviewOf(
    base({
      stages: [stage("s1", "Framing", "ACTIVE", day(-6), day(-1))],
      field: { problems: [{ id: "f1", note: "No water shut-off", blocking: true, by: "Mike", when: "Nov 9", at: `${TODAY}T07:40:00.000Z`, status: "OPEN", resolution: null, jobId: "j", jobTitle: "Lee bath" }], hoursWeek: [], hoursAll: { hours: 0, cost: 0 }, subs: [], week: { from: TODAY, to: TODAY } },
      invoices: { invoices: [{ id: "i1", status: "RECEIVED", amount: 8400, contractorName: "Ridge Framing", flags: [], stageName: "Framing", left: 8400, dueAt: null, quoteId: "q1", receivedAt: `${day(-1)}T10:00:00Z` }], payments: [], contracts: [], totals: {} } as Any,
    }),
  );
  check("the problem's why says who flagged it and when", o.doNow[0]?.why === "Flagged by Mike today", o.doNow[0]?.why);
  check("…and History has it, by its exact time", o.history.some((h) => h.at.startsWith(TODAY) && h.text.startsWith("Crew stuck on Lee bath")), o.history);
  check("a blocking site problem leads, then the red rows, then amber", o.doNow[0]?.key === "problem:f1" && o.doNow[0].tone === "red" && o.doNow.findIndex((x) => x.tone === "amber") > o.doNow.findIndex((x) => x.key === "problem:f1"), o.doNow.map((x) => x.key));
  const inv = o.doNow.find((x) => x.key === "sub-inv:i1");
  check("a sub's invoice to review opens the subs page's Invoices", inv?.text === "Ridge Framing invoice $8,400 to review" && inv.act?.t === "open" && inv.act.href === "/dashboard/projects/p1/subs?tab=invoices", inv);
}

// ── materials and deliveries ─────────────────────────────────────────────────
{
  const mat = (stageStart: string, ordered = 0) => ({ id: "m", name: "Tile", quantity: 10, unit: "box", unitCost: 40, source: "", store: null, productUrl: null, orderedQty: ordered, receivedQty: 0, stageId: "s9", stageName: "Tile", stageStart, stageDone: false });
  const buy = (m: object[], orders: object[] = []) => ({ materials: m, orders, suppliers: [], crew: [], deckTakeoff: false, unseeded: 0 }) as Any;
  const today = overviewOf(base({ stages: [stage("s9", "Tile", "PLANNED", day(3), day(8))], buying: buy([mat(day(3))]) })).doNow.find((x) => x.key.startsWith("order:"));
  check("three days before the stage: 'Order tile materials today', amber", today?.text === "Order tile materials today" && today.tone === "amber" && today.act?.t === "go" && today.act.card === "buying", today);
  const early = overviewOf(base({ stages: [stage("s9", "Tile", "PLANNED", day(5), day(8))], buying: buy([mat(day(5))]) })).doNow.find((x) => x.key.startsWith("order:"));
  check("five days before: nothing yet", early === undefined);
  const started = overviewOf(base({ stages: [stage("s9", "Tile", "ACTIVE", day(-1), day(4))], buying: buy([mat(day(-1))]) })).doNow.find((x) => x.key.startsWith("order:"));
  check("the stage started without them: red", started?.tone === "red" && started.text === "Tile started without its materials", started);
  const ordered = overviewOf(base({ stages: [stage("s9", "Tile", "PLANNED", day(2), day(8))], buying: buy([mat(day(2), 10)]) })).doNow.find((x) => x.key.startsWith("order:"));
  check("all ordered: nothing", ordered === undefined);
  const late = overviewOf(base({ stages: [stage("s9", "Tile", "PLANNED", day(2), day(8))], buying: buy([], [{ id: "o1", number: 12, status: "ORDERED", expectedAt: day(-2), supplier: { id: "sup", name: "ABC Supply", email: "orders@abc.test" }, buyerName: null, buyerEmail: null, buyerPhone: null, stageName: "Tile" }]) })).doNow.find((x) => x.key === "delivery:o1");
  check("a delivery 2 days late emails the supplier", late?.text === "Delivery 2 days late" && late.why === "Order 12 from ABC Supply for Tile" && late.act?.t === "mail" && late.act.to === "orders@abc.test", late);
}

// ── inspections ──────────────────────────────────────────────────────────────
{
  const insp = (id: string, name: string, date: string | null, result: string, extra: object = {}) => ({ id, name, date, readyNote: null, isFinal: false, result, resultNote: null, resultAt: null, stageId: null, stageName: null, kind: null, gate: true, ...extra });
  const tl = (inspections: object[]) => ({ today: TODAY, tz: "America/Los_Angeles", stages: [], inspections, deliveries: [], crewDays: [], jobs: [] }) as Any;
  const o = overviewOf(base({ stages: [stage("s1", "Framing", "ACTIVE", day(-3), day(3))], timeline: tl([insp("a", "Framing inspection", day(-2), "FAILED"), insp("b", "Electrical rough", day(-1), "PENDING"), insp("c", "Plumbing rough", day(1), "PENDING")]) }));
  const failed = o.doNow.find((x) => x.key === "insp-failed:a");
  const result = o.doNow.find((x) => x.key === "insp-result:b");
  const soon = o.doNow.find((x) => x.key === "insp-soon:c");
  check("a failed inspection is red: book the re-inspection", failed?.tone === "red" && failed.text === "Framing inspection failed: book the re-inspection", failed);
  check("one passed by with no result asks Passed or Failed", result?.act?.t === "inspection" && result.act.result === "PASSED" && result.alt?.t === "inspection" && result.alt.result === "FAILED", result);
  check("one tomorrow shows with its checklist", soon?.text === "Plumbing rough tomorrow" && soon.why === "No checklist yet", soon);
  const again = overviewOf(base({ stages: [stage("s1", "Framing", "ACTIVE", day(-3), day(3))], timeline: tl([insp("a", "Framing inspection", day(-2), "FAILED"), insp("a2", "Framing inspection", day(2), "PENDING")]) })).doNow.find((x) => x.key === "insp-failed:a");
  check("a failed one already re-booked is not asked again", again === undefined);
}

// ── the client's picks ───────────────────────────────────────────────────────
{
  const sel = (id: string, name: string, due: string, stageStart: string) => ({ id, name, stageId: "s5", stageName: "Tile", stageStart, stageDone: false, leadDays: 14, dueBy: null, due, state: "OPEN", allowance: null, allowanceSuggested: null, chosen: null, vendor: null, price: null, chosenAt: null, byClient: false, note: null, position: 0 });
  const sels = (rows: object[]) => ({ today: TODAY, selections: rows, open: rows.length, late: 0, chosen: 0 }) as Any;
  const share = { token: "t", href: "https://x/p/t", sharedAt: null, updateSentAt: null, photosShared: 0, files: [], clientName: "Sarah Lee", clientEmail: "sarah@example.test", clientPhone: null, textsOn: false } as Any;
  const late = overviewOf(base({ stages: [stage("s5", "Tile", "PLANNED", day(2), day(6))], selections: sels([sel("x", "Tile", day(-2), day(2))]), share })).doNow.find((x) => x.key === "picks-late");
  check("a pick past due with its stage 2 days off is red and reminds the client", late?.tone === "red" && late.text === "Tile not picked, 2 days past due" && late.act?.t === "remind-picks" && late.act.note.includes("Tile by Nov 7"), late);
  const soon = overviewOf(base({ selections: sels([sel("y", "Cabinets", day(2), day(20))]) })).doNow.find((x) => x.key === "picks-soon");
  check("a pick due in 2 days is amber; with no email or phone it opens the picks", soon?.tone === "amber" && soon.act?.t === "go" && soon.act.card === "selections", soon);
  const people = peopleOf(base({ selections: sels([sel("y", "Cabinets", day(2), day(20))]), share }));
  check("the client waits on the office's side: 'you wait: 1 pick', with their email", people[0]?.role === "Client" && people[0].line === "you wait: 1 pick" && people[0].waits === "them" && people[0].email === "sarah@example.test", people[0]);
}

// ── the next 14 days ─────────────────────────────────────────────────────────
{
  const r = base({
    stages: [stage("s3", "Drywall", "PLANNED", day(3), day(8)), stage("s4", "Paint", "PLANNED", day(20), day(24))],
    buying: { materials: [{ id: "m", name: "Drywall", quantity: 40, unit: "sheet", unitCost: 15, source: "", store: null, productUrl: null, orderedQty: 0, receivedQty: 0, stageId: "s3", stageName: "Drywall", stageStart: day(3), stageDone: false }], orders: [], suppliers: [], crew: [], deckTakeoff: false, unseeded: 0 } as Any,
    subs: { today: TODAY, contractors: [], requests: [], quotes: [{ id: "q1", status: "AWARDED", amount: 9000, dueBy: null, stageId: "s3", contractorName: "Wall Pros", contractorId: "c1", contractorPhone: "+15550100", contractorEmail: null, askedAt: `${day(-9)}T00:00:00Z`, contract: { id: "k", number: 1, status: "SENT", amount: 9000, changes: 0, pending: 0 } }], documents: [], files: [], subsBudget: null, flags: [] } as Any,
  });
  const a = aheadOf(r);
  check("only what starts in the next 14 days", a.length === 1 && a[0].title === "Drywall starts" && a[0].day === day(3), a);
  check("what it is missing: materials and the sub's signature", a[0].missing.includes("1 material not ordered") && a[0].missing.includes("Wall Pros contract not signed"), a[0]);
  const row = overviewOf(r).doNow.find((x) => x.key === "contract:q1");
  check("a sub not signed 3 days before the start is red, with a text to them", row?.tone === "red" && row.alt?.t === "text", row);
  const sub = peopleOf(r).find((p) => p.role === "Sub");
  check("the sub waits on nobody but has not signed: 'contract not signed'", sub?.line === "contract not signed" && sub.waits === "them" && sub.phone === "+15550100", sub);
}

// ── a sub awarded with no contract yet ───────────────────────────────────────
{
  const r = base({
    stages: [stage("s3", "Drywall", "PLANNED", day(6), day(10))],
    subs: { today: TODAY, contractors: [], requests: [], quotes: [{ id: "q2", status: "AWARDED", amount: 9000, dueBy: null, stageId: "s3", contractorName: "Wall Pros", contractorId: "c1", contractorPhone: null, contractorEmail: "w@example.test", askedAt: `${day(-9)}T00:00:00Z`, contract: null }], documents: [], files: [], subsBudget: null, flags: [] } as Any,
  });
  const row = overviewOf(r).doNow.find((x) => x.key === "contract-send:q2");
  check("awarded with no contract, 6 days out: 'Send Wall Pros the contract', amber, drafts it on the Contracts tab", row?.tone === "amber" && row.text === "Send Wall Pros the contract" && row.act?.t === "open" && row.act.href.endsWith("?tab=contracts"), row);
  const who = peopleOf(r).find((p) => p.role === "Sub");
  check("…and the sub waits on the office for it", who?.line === "waits on you: send the contract" && who.waits === "you", who);
  check("…and Coming up says there's no contract yet", aheadOf(r)[0]?.missing.includes("Wall Pros: no contract yet"), aheadOf(r)[0]);
}
{
  const o = overviewOf(base({ stages: [stage("s1", "Posts", "ACTIVE", day(-1), day(3))], money: { totals: { budget: 18500, spent: 0, committed: 0, left: 18500, headingFor: 0, over: -18500 }, advice: [], contract: null, margin: null } as Any }));
  check("nothing spent yet says so, not '$18,500 under budget'", o.line === "on schedule · nothing spent yet", o.line);
}

// ── "Not now" ────────────────────────────────────────────────────────────────
{
  const items = overviewOf(base({ stages: [stage("s2", "Rough-in", "ACTIVE", day(-10), day(-1))] })).doNow;
  const sn = parseSnoozes(JSON.stringify({ "late:s2": { until: snoozeUntil(TODAY), tone: "amber" }, old: { until: day(-1), tone: "amber" } }), TODAY);
  check("a snooze lasts three days and the expired ones drop", snoozeUntil(TODAY) === day(3) && Object.keys(sn).join() === "late:s2", sn);
  check("a snoozed amber row is hidden", visibleItems(items, sn).shown.every((x) => x.key !== "late:s2") && visibleItems(items, sn).hidden === 1);
  const worse = overviewOf(base({ stages: [stage("s2", "Rough-in", "ACTIVE", day(-10), day(-5))] })).doNow;
  check("…and comes back once it turns red", visibleItems(worse, sn).shown.some((x) => x.key === "late:s2"));
  check("odd JSON reads as nothing hidden", Object.keys(parseSnoozes("{oops", TODAY)).length === 0);
}

// ── on hold and finished ─────────────────────────────────────────────────────
{
  check("on hold reads 'On hold'", overviewOf(base({ project: { ...base().project, status: "ON_HOLD" }, stages: [stage("s1", "Tile", "ACTIVE", day(-2), day(5))] })).word === "On hold");
  const fin = overviewOf(base({ project: { ...base().project, status: "COMPLETED" }, stages: [stage("s1", "Tile", "DONE", day(-9), day(-5))], finish: [{ kind: "finish-step", text: "Send the final invoice" }] }));
  check("finished reads 'Finished' with the finish line's next step", fin.word === "Finished" && fin.doNow.length === 1 && fin.doNow[0].text === "Send the final invoice" && fin.line.startsWith("all stages done"), fin);
}

// ── the workspaces ───────────────────────────────────────────────────────────
check("three kinds; a job project is its own", PROJECT_KINDS.join() === "REMODEL,NEW_BUILD,JOB" && KIND_LABEL.JOB === "Job project" && kindOf("JOB") === "JOB" && kindOf("odd") === "REMODEL");
check("a remodel and a job trade places; a new build does not", kindsSwap("REMODEL", "JOB") && kindsSwap("JOB", "REMODEL") && !kindsSwap("REMODEL", "NEW_BUILD") && !kindsSwap("NEW_BUILD", "JOB"));
check("where a project lives: new build → build, job → jobs, remodel → remodel", spaceOf("NEW_BUILD") === "build" && spaceOf("JOB") === "jobs" && spaceOf("REMODEL") === "remodel");
check("an older remodel made from the deck template lives with the job projects", spaceOf("REMODEL", JSON.stringify({ template: "deck" })) === "jobs" && spaceOf("REMODEL", JSON.stringify({ template: "kitchen" })) === "remodel");
check("a job project is offered only the trades' templates", templatesFor("JOB").map((t) => t.key).every((k) => ["deck", "roof", "fence", "floors", "hvac", "siding", "windows", "painting", "service"].includes(k)) && templatesFor("JOB").length >= 6);
check("a remodel is offered its own first, the trades after", templatesFor("REMODEL")[0].key === "kitchen" && templatesFor("REMODEL").some((t) => t.key === "deck"));
check("an automatic project from a deck sale is a job; from a kitchen a remodel; with no template a job", kindForTemplate(templateByKey("deck")) === "JOB" && kindForTemplate(templateByKey("kitchen")) === "REMODEL" && kindForTemplate(null) === "JOB");
check("each workspace has its colour, name and kind", SPACES.build.kind === "NEW_BUILD" && SPACES.remodel.kind === "REMODEL" && SPACES.jobs.kind === "JOB" && new Set(Object.values(SPACES).map((s) => s.color)).size === 3);
check("the road places a stage by its words", roadStepOf("build", { name: "Framing", allDone: false }) === ROADS.build.findIndex((s) => s.key === "framing") && roadStepOf("remodel", { name: "Demolition", allDone: false }) === 1 && roadStepOf("jobs", { name: "Decking and railings", allDone: false }) === 1 && roadStepOf("jobs", { name: null, allDone: true }) === ROADS.jobs.length - 1);

{
  const row = (id: string, kind: string, extra: Partial<Project> = {}): Project => ({ id, name: `P ${id}`, description: null, status: "ACTIVE", kind, startsAt: null, endsAt: null, budget: 1000, jobCount: 0, completedJobs: 0, stageCount: 3, stageNow: "Framing", ...extra });
  const rows = [
    row("a", "NEW_BUILD", { space: "build", attention: [{ kind: "late", text: "Framing 4 days late" }] }),
    row("b", "NEW_BUILD", { space: "build" }),
    row("c", "REMODEL", { space: "remodel", stageNow: "Demolition", openCount: 1 }),
    row("d", "JOB", { space: "jobs", status: "COMPLETED" }),
  ];
  const sum = spaceSummaries(rows);
  check("the chooser's numbers: two builds, one at risk with its worst row", sum.build.active === 2 && sum.build.atRisk === 1 && sum.build.worst?.text === "Framing 4 days late" && sum.build.worst.risk, sum.build);
  check("a remodel waiting on its client needs you but is not at risk; a finished job is counted done", sum.remodel.needsYou === 1 && sum.remodel.atRisk === 0 && sum.jobs.active === 0 && sum.jobs.done === 1, { r: sum.remodel, j: sum.jobs });
  const pins = roadPins("build", rows);
  check("the road pins both builds on Framing, the late one first", pins.find((s) => s.key === "framing")?.pins.map((p) => p.id).join() === "a,b", pins);
  const today = needsToday(rows);
  check("needs you today: at-risk first, across workspaces", today[0]?.id === "a" && today.some((x) => x.id === "c" && x.space === "remodel"), today);
}

console.log(bad ? `\n${bad} FAILED` : "\nall ok");
process.exit(bad ? 1 : 0);
