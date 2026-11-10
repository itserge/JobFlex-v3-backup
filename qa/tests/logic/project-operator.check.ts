// THE AI OPERATOR'S PROJECT ANSWERS (Project Overview part 3, 2026-11-09): what holds a stage up, one project's answer
// (numbered to-do with its replies), this week across projects, the behind / over-budget lists, the sentence at the
// top of the Overview (the rules' own, and the number check an AI sentence must pass), and "do the first one".
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/project-operator.check.ts
import { holdupOf, overviewOf, stageNeedsOf, type OvItem, type Overview, type OverviewInput } from "../../../src/lib/projectOverview/shared";
import { boardAnswer, holdupAnswer, numbersIn, overviewAnswer, overviewSig, sentenceOk, summaryFallback, weekAnswer, LIST_MAX, WEEK_MAX } from "../../../src/lib/projectOverview/operator";
import { pickFor } from "../../../src/lib/projectOverview/brief";
import { quickReply } from "../../../src/lib/assistant/shared";

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
    stages: [], done: null, phases: null, field: null, timeline: null, buying: null, selections: null, subs: null, invoices: null, money: null,
    payments: [], draws: null, share: null, finish: [], jobs: [], collected: 0, owed: 0, subsHref: "/dashboard/projects/p1/subs",
    ...over,
  };
}
const stage = (id: string, name: string, status: string, startsAt: string | null, endsAt: string | null, extra: object = {}) => ({ id, name, status, startsAt, endsAt, doneAt: null, ...extra });

// ── what holds a stage up ───────────────────────────────────────────────────
{
  const mat = (stageId: string, quantity: number, orderedQty: number) => ({ stageId, quantity, orderedQty, stageStart: day(-6), stageDone: false, stageName: "Framing" });
  const r = base({
    stages: [stage("s1", "Framing", "ACTIVE", day(-6), day(-2), { gates: [{ id: "g", name: "Framing inspection", result: "PENDING", date: day(2) }], tasks: [{ title: "Set trusses", done: true }, { title: "Sheathe the roof", done: false }] })],
    buying: { materials: [mat("s1", 10, 4)], orders: [] } as Any,
  });
  const h = holdupOf(r, "s1");
  check("a late stage: 2 days late, its inspection booked, the task left, the materials not ordered", h?.late === 2 && h.gates[0] === "Framing inspection booked Nov 11" && h.tasksLeft.join() === "Sheathe the roof" && h.missing.includes("1 material not ordered"), h);
  const a = holdupAnswer({ id: "p1", name: "Lee house" }, h!);
  check("…said for the model: in progress, 2 days late", a.state === "in progress" && a.late === "2 days late" && (a.stillNeeds as string[]).length === 1, a);
  check("no such stage: null", holdupOf(r, "nope") === null);
  const gated = base({ stages: [stage("s2", "Rough-in", "PLANNED", day(3), day(8), { gates: [{ id: "i1", name: "Rough-in inspection", result: "PENDING", date: null }] })], timeline: { today: TODAY, tz: "America/Los_Angeles", stages: [], inspections: [{ id: "i1", name: "Rough-in inspection", date: null, readyNote: null, isFinal: false, result: "PENDING", resultNote: null, resultAt: null, stageId: "s2", stageName: "Rough-in", kind: null, gate: true }], deliveries: [], crewDays: [], jobs: [] } as Any });
  const g = holdupOf(gated, "s2");
  check("an inspection not booked is said once, as the gate", g?.gates.join() === "Rough-in inspection not booked" && !g.missing.includes("Rough-in inspection not booked"), g);
  check("Coming up and the holdup share one rule (stageNeedsOf)", JSON.stringify(stageNeedsOf(r.stages[0], r).missing) === JSON.stringify(h?.missing));
}

// ── one project's answer ────────────────────────────────────────────────────
const item = (key: string, tone: "red" | "amber", text: string, rank: number, op: OvItem["op"] = null): OvItem => ({ key, tone, text, why: null, act: null, alt: null, rank, op });
const ov = (doNow: OvItem[], behind = 0, over = 0, ahead: Overview["ahead"] = []): Overview =>
  ({ tone: doNow.some((i) => i.tone === "red") ? "red" : doNow.length ? "amber" : "green", word: doNow.some((i) => i.tone === "red") ? "At risk" : doNow.length ? "Needs you" : "On track", line: [behind ? `${behind} days behind` : "on schedule", over ? `$${over.toLocaleString("en-US")} over budget` : null].filter(Boolean).join(" · "), sub: "Rough-in · 15% done", behind, doNow, ahead, people: [], money: over ? { budget: 120000, spent: 0, committed: 0, headingFor: 120000 + over, over, contract: null, margin: null, collected: 0, owed: 0, ideas: 0 } : null, road: [], history: [] }) as Overview;
{
  const rows = Array.from({ length: 8 }, (_, k) => item(`r${k}`, k < 2 ? "red" : "amber", `Row ${k}`, k, k === 0 ? { label: "mark Demolition done", tool: "set_stage", args: { projectId: "p1", stage: "Demolition", status: "DONE" } } : null));
  const a = overviewAnswer({ id: "p1", name: "Lee kitchen" }, ov(rows, 4, 72000), { r1: { until: day(2), tone: "amber" } });
  const toDo = a.answer.toDo as Array<{ n: number; what: string; urgent: boolean; replyDoes: string }>;
  check(`the to-do list is numbered from 1, at most ${LIST_MAX}`, toDo.length === LIST_MAX && toDo.map((x) => x.n).join() === "1,2,3,4,5,6", toDo);
  check("a red row hidden while amber shows again (Not now is for amber)", toDo[1].what === "Row 1" && a.answer.hiddenWithNotNow === 0, toDo);
  check("each number is kept as a reply, in the same order", a.picks.map((p) => p.n).join() === "1,2,3,4,5,6" && a.picks[0].tool === "set_stage" && toDo[0].replyDoes === "mark Demolition done", a.picks);
  check("a row with no tool is a question about it", a.picks[2].tool === null && a.picks[2].ask === "What can I do about this: Row 2", a.picks[2]);
  check("the money said in dollars", (a.answer.money as { over: string }).over === "$72,000", a.answer.money);
  const hid = overviewAnswer({ id: "p1", name: "Lee kitchen" }, ov([item("a", "amber", "A", 1), item("b", "amber", "B", 2)]), { a: { until: day(2), tone: "amber" } });
  check("an amber row put off with Not now is left out and counted", (hid.answer.toDo as unknown[]).length === 1 && hid.answer.hiddenWithNotNow === 1, hid.answer);
}

// ── this week across projects ───────────────────────────────────────────────
{
  const p = (id: string, name: string, rows: OvItem[], ahead: Overview["ahead"] = []) => ({ id, name, snoozes: {}, overview: ov(rows, 0, 0, ahead) });
  const a = weekAnswer(
    [
      p("hill", "Hill Street", [item("x1", "amber", "Picks late", 12), item("x2", "amber", "Quote in", 15), item("x3", "amber", "Third", 16)], [{ key: "stage:s9", day: day(3), title: "Framing starts", stageId: "s9", ready: [], missing: ["2 materials not ordered"] }, { key: "stage:s10", day: day(12), title: "Roofing starts", stageId: "s10", ready: [], missing: [] }]),
      p("lee", "Lee kitchen", [item("y1", "red", "Crew stuck", 0), item("y2", "amber", "Order tile", 10)]),
      p("deck", "Patel deck", []),
    ],
    TODAY,
  );
  const toDo = a.answer.toDo as Array<{ n: number; project: string; what: string; urgent: boolean }>;
  check("this week: every urgent row first, then the worst project's rows", toDo.map((x) => `${x.n}:${x.project}:${x.what}`).join(" | ") === "1:Lee kitchen:Crew stuck | 2:Lee kitchen:Order tile | 3:Hill Street:Picks late | 4:Hill Street:Quote in", toDo);
  check("…two rows a project; the rest counted", a.answer.moreToDo === 1 && a.answer.needYou === 2 && a.answer.onTrack === 1, a.answer);
  check("…the replies match the numbers", a.picks.map((x) => `${x.n}:${x.projectId}`).join() === "1:lee,2:lee,3:hill,4:hill", a.picks);
  const week = a.answer.thisWeek as Array<{ day: string; what: string; missing: string[] }>;
  check("…and what starts in the next 7 days, not day 12", week.length === 1 && week[0].what === "Framing starts" && week[0].missing[0] === "2 materials not ordered", week);
  const many = weekAnswer(Array.from({ length: 6 }, (_, k) => p(`p${k}`, `Job ${k}`, [item(`a${k}`, "red", `Red ${k}`, 1), item(`b${k}`, "amber", `Amber ${k}`, 9)])), TODAY);
  check(`never more than ${WEEK_MAX} numbered`, (many.answer.toDo as unknown[]).length === WEEK_MAX && many.picks.length === WEEK_MAX);
}

// ── which projects are behind / over budget ─────────────────────────────────
{
  const list = [
    { id: "a", name: "A", snoozes: {}, overview: ov([item("l", "red", "Framing 6 days late", 2)], 6, 0) },
    { id: "b", name: "B", snoozes: {}, overview: ov([item("l", "amber", "Tile 1 day late", 11)], 1, 3200) },
    { id: "c", name: "C", snoozes: {}, overview: ov([], 0, 0) },
  ];
  const behind = boardAnswer(list, "behind") as { count: number; projects: Array<{ project: string; behind: string | null }> };
  check("behind: the two late ones, the most days first", behind.count === 2 && behind.projects.map((x) => `${x.project}:${x.behind}`).join() === "A:6 days,B:1 day", behind);
  const over = boardAnswer(list, "over_budget") as { count: number; projects: Array<{ project: string; overBudget: string | null }> };
  check("over budget: only B, with its dollars", over.count === 1 && over.projects[0].overBudget === "$3,200", over);
  check("at risk: only A", (boardAnswer(list, "at_risk") as { count: number }).count === 1);
  check("all: every project", (boardAnswer(list, "all") as { count: number }).count === 3);
}

// ── the sentence at the top ─────────────────────────────────────────────────
{
  const o = ov([item("l", "red", "Crew stuck on Lee kitchen rough-in: No shut-off valve under the sink", 0)], 4, 72000);
  check("the rules' sentence", summaryFallback("Lee kitchen", o) === "Lee kitchen is at risk: 4 days behind, $72,000 over budget. First: Crew stuck on Lee kitchen rough-in: No shut-off valve under the sink.", summaryFallback("Lee kitchen", o));
  check("on track: one clause", summaryFallback("Patel deck", ov([])) === "Patel deck is on track: on schedule.", summaryFallback("Patel deck", ov([])));
  check("needs you reads as said", summaryFallback("Hill house", ov([item("p", "amber", "9 client picks past due", 12)])) === "Hill house needs you: on schedule. First: 9 client picks past due.", summaryFallback("Hill house", ov([item("p", "amber", "9 client picks past due", 12)])));
  check("numbers read as said: $72,000 → 72000, 15% → 15", numbersIn("$72,000 over, 15% done, 4 days").join() === "72000,15,4");
  check("an AI sentence with the project's numbers passes", sentenceOk("The Lee kitchen is 4 days behind and heading $72,000 over; fix the shut-off valve first.", "Lee kitchen", o));
  check("…one with a number not in the facts fails", !sentenceOk("The Lee kitchen is 5 days behind.", "Lee kitchen", o) && !sentenceOk("Heading $99,999 over.", "Lee kitchen", o));
  check("…two lines or a paragraph fails", !sentenceOk("One.\nTwo.", "Lee kitchen", o) && !sentenceOk("x".repeat(300), "Lee kitchen", o));
  check("the facts it stands on change with the status", overviewSig(o) !== overviewSig(ov([])) && overviewSig(o) === overviewSig(ov([item("l", "red", "other words", 0)], 4, 72000)));
}

// ── a moment read on the company's clock ────────────────────────────────────
{
  const tl = { today: TODAY, tz: "America/Los_Angeles", stages: [], inspections: [], deliveries: [], crewDays: [], jobs: [] } as Any;
  const field = { problems: [{ id: "f1", note: "No shut-off", blocking: true, by: "Mike", when: "Nov 9", at: "2026-11-10T00:40:00.000Z", status: "OPEN", resolution: null, jobId: "j", jobTitle: "Lee bath" }], hoursWeek: [], hoursAll: { hours: 0, cost: 0 }, subs: [], week: { from: TODAY, to: TODAY } } as Any;
  const row = overviewOf(base({ timeline: tl, field })).doNow.find((x) => x.key === "problem:f1");
  check("a problem flagged at 4:40 PM in Los Angeles (00:40 UTC the next day) reads 'today', not 'tomorrow'", row?.why === "Flagged by Mike today", row?.why);
}

// ── a row with its tool; "do the first one" ────────────────────────────────
{
  const o = overviewOf(base({ stages: [stage("s1", "Demolition", "ACTIVE", day(-10), day(-4))] }));
  const late = o.doNow.find((x) => x.key === "late:s1")!;
  check("pickFor keeps a row's tool", pickFor(1, { id: "p1", name: "Lee kitchen" }, late).tool === "set_stage");
  const n = (s: string) => {
    const q = quickReply(s);
    return q?.kind === "digit" ? q.n : null;
  };
  check("'do the first one', 'do 2', 'do number three', 'run the second one' are numbers", n("do the first one") === 1 && n("do 2") === 2 && n("do number three") === 3 && n("run the second one") === 2, [n("do the first one"), n("do 2"), n("do number three"), n("run the second one")]);
  check("'do it' is still a yes", quickReply("do it")?.kind === "yes");
}

console.log(bad ? `\n${bad} FAILED` : "\nall ok");
process.exit(bad ? 1 : 0);
