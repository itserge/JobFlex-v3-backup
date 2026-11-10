// THE PROJECTS IN THE MORNING BRIEFING (Project Overview part 2, 2026-11-09): each Overview row's Operator step (the
// numbered reply's tool or question), the paragraph (worst first, the counts, the rows named, "Not now" kept), the
// numbered replies and their words, the room left in a text, the kept replies' day, and numbers said out loud.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/project-brief.check.ts
import { overviewOf, type OvItem, type Overview, type OverviewInput } from "../../../src/lib/projectOverview/shared";
import { askText, fitProjects, numbersWords, parsePicks, picksLine, projectsBrief, shortText, BRIEF_PICKS, type BriefPick } from "../../../src/lib/projectOverview/brief";
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
const find = (o: Overview, key: string) => o.doNow.find((x) => x.key === key);

// ── each row's Operator step ────────────────────────────────────────────────
{
  const o = overviewOf(base({ stages: [stage("s1", "Demolition", "ACTIVE", day(-10), day(-4)), stage("s2", "Rough-in", "PLANNED", day(-1), day(6))] }));
  const late = find(o, "late:s1");
  check("a late stage's step marks it done with set_stage", late?.op && "tool" in late.op && late.op.tool === "set_stage" && JSON.stringify(late.op.args) === JSON.stringify({ projectId: "p1", stage: "Demolition", status: "DONE" }) && late.op.label === "mark Demolition done", late?.op);
}
{
  const o = overviewOf(base({ stages: [stage("s2", "Rough-in", "ACTIVE", day(-10), day(-1), { gates: [{ id: "g", name: "Rough-in inspection", result: "PENDING", date: null }] })] }));
  const late = find(o, "late:s2");
  check("held by a gate, the step asks what it waits on (no 'done')", late?.op && "ask" in late.op && late.op.ask === "What's holding up Rough-in", late?.op);
}
{
  const o = overviewOf(base({ stages: [stage("s1", "Footings", "PLANNED", day(-2), day(4))] }));
  const start = find(o, "start:s1");
  check("a stage that should have started: its step starts it", start?.op && "tool" in start.op && start.op.tool === "set_stage" && (start.op.args as { status: string }).status === "ACTIVE" && start.op.label === "start Footings", start?.op);
}
{
  const insp = (id: string, name: string, date: string | null, result: string) => ({ id, name, date, readyNote: null, isFinal: false, result, resultNote: null, resultAt: null, stageId: null, stageName: null, kind: null, gate: true });
  const tl = { today: TODAY, tz: "America/Los_Angeles", stages: [], inspections: [insp("a", "Framing inspection", day(-2), "FAILED"), insp("b", "Electrical rough", day(-1), "PENDING")], deliveries: [], crewDays: [], jobs: [] } as Any;
  const o = overviewOf(base({ stages: [stage("s1", "Framing", "ACTIVE", day(-3), day(3))], timeline: tl }));
  const result = find(o, "insp-result:b");
  const failed = find(o, "insp-failed:a");
  check("an inspection with no result: its step records it passed", result?.op && "tool" in result.op && result.op.tool === "inspection_result" && JSON.stringify(result.op.args) === JSON.stringify({ projectId: "p1", inspection: "Electrical rough", result: "PASSED", note: null }), result?.op);
  check("a failed one: its step asks to book the re-inspection", failed?.op && "ask" in failed.op && failed.op.ask === "Book the Framing inspection re-inspection", failed?.op);
}
{
  const sel = (id: string, name: string, due: string, stageStart: string) => ({ id, name, stageId: "s5", stageName: "Tile", stageStart, stageDone: false, leadDays: 14, dueBy: null, due, state: "OPEN", allowance: null, allowanceSuggested: null, chosen: null, vendor: null, price: null, chosenAt: null, byClient: false, note: null, position: 0 });
  const sels = { today: TODAY, selections: [sel("x", "Tile", day(-2), day(2))], open: 1, late: 0, chosen: 0 } as Any;
  const share = { token: "t", href: "https://x/p/t", sharedAt: null, updateSentAt: null, photosShared: 0, files: [], clientName: "Sarah Lee", clientEmail: "sarah@example.test", clientPhone: null, textsOn: false } as Any;
  const late = find(overviewOf(base({ stages: [stage("s5", "Tile", "PLANNED", day(2), day(6))], selections: sels, share })), "picks-late");
  check("picks past due: the step sends the client update with the picks written in", late?.op && "tool" in late.op && late.op.tool === "send_project_update" && String((late.op.args as { note: string }).note).includes("Tile by Nov 7") && late.op.label === "remind Sarah Lee to pick", late?.op);
  const none = find(overviewOf(base({ stages: [stage("s5", "Tile", "PLANNED", day(2), day(6))], selections: sels })), "picks-late");
  check("…with no email or phone for the client, no step (the button opens the picks)", none !== undefined && !none.op, none);
}
{
  const o = overviewOf(base({ field: { problems: [{ id: "f1", note: "No water shut-off", blocking: true, by: "Mike", when: "Nov 9", at: `${TODAY}T07:40:00.000Z`, status: "OPEN", resolution: null, jobId: "j", jobTitle: "Lee bath" }], hoursWeek: [], hoursAll: { hours: 0, cost: 0 }, subs: [], week: { from: TODAY, to: TODAY } } as Any }));
  check("a site problem has no Operator step", find(o, "problem:f1") !== undefined && !find(o, "problem:f1")?.op);
}
{
  const o = overviewOf(base({ stages: [stage("s1", "Tile", "ACTIVE", day(-2), day(5))], money: { totals: { budget: 120000, spent: 68400, committed: 31000, left: 20600, headingFor: 123200, over: 3200 }, advice: [{}], contract: 150000, margin: { amount: 26800, pct: 18, against: "contract" } } as Any }));
  const over = find(o, "over-budget");
  check("over budget: the step asks where to save", over?.op && "ask" in over.op && over.op.ask === "Where can I save money" && over.op.label === "see the ways to save", over?.op);
}

// ── the paragraph ───────────────────────────────────────────────────────────
const item = (key: string, tone: "red" | "amber", text: string, rank: number, op: OvItem["op"] = null): OvItem => ({ key, tone, text, why: null, act: null, alt: null, rank, op });
const ov = (doNow: OvItem[], behind = 0, over = 0): Overview =>
  ({ tone: doNow.some((i) => i.tone === "red") ? "red" : doNow.length ? "amber" : "green", word: "", line: "", sub: "", behind, doNow, ahead: [], people: [], money: over ? { budget: 1, spent: 0, committed: 0, headingFor: 1 + over, over, contract: null, margin: null, collected: 0, owed: 0, ideas: 0 } : null, road: [], history: [] }) as Overview;
const setStage = (stage: string) => ({ label: `mark ${stage} done`, tool: "set_stage", args: { projectId: "x", stage, status: "DONE" } });

const lee = { id: "lee", name: "Lee kitchen", snoozes: {}, overview: ov([item("problem:f", "red", "Crew stuck on Lee kitchen rough-in: No shut-off valve under the sink, the crew can't go on", 0), item("late:s1", "red", "Demolition 4 days late", 2, setStage("Demolition")), item("quotes-in", "amber", "Quote in from Ridge Tile: $6,400", 15, { label: "compare the quotes", ask: "Compare the quotes" })], 4, 72000) };
const hill = { id: "hill", name: "Hill Street house", snoozes: {}, overview: ov([item("picks-late", "amber", "9 client picks past due", 12, { label: "remind Dan Hill to pick", tool: "send_project_update", args: { projectId: "hill", note: "…" } })]) };
const deck = { id: "deck", name: "Patel deck", snoozes: {}, overview: ov([]) };
const fence = { id: "fence", name: "Kim fence", snoozes: {}, overview: ov([]) };
{
  const b = projectsBrief([deck, hill, lee, fence])!;
  check("the count line: 2 need you, 2 on track", b.lines[0] === "Projects: 2 need you, 2 on track.", b.lines);
  check("worst first: the red Lee kitchen before the amber Hill Street", b.lines[1].startsWith("Lee kitchen, at risk: 4 days behind, $72,000 over budget.") && b.lines[2].startsWith("Hill Street house, needs you."), b.lines);
  check("a project line names its first 2 rows, cut short, and counts the rest", b.lines[1].includes("Crew stuck on Lee kitchen rough-in: No shut-off valve under…; Demolition 4 days late; +1 more."), b.lines[1]);
  check("the on-track projects get no line", !b.lines.some((l) => l.startsWith("Patel deck") || l.startsWith("Kim fence")));
  check("the replies: each project's top step first, then the next", b.picks.map((p) => `${p.n}:${p.projectId}:${p.label}`).join(" | ") === "1:lee:mark Demolition done | 2:hill:remind Dan Hill to pick | 3:lee:compare the quotes", b.picks);
  check("…a write keeps its tool and arguments; a question keeps its words", b.picks[0].tool === "set_stage" && b.picks[0].ask === null && b.picks[2].tool === null && b.picks[2].ask === "Compare the quotes", b.picks);
  check("the replies line reads as one sentence", b.lines[b.lines.length - 1] === "Reply 1 to mark Demolition done (Lee kitchen), 2 to remind Dan Hill to pick (Hill Street house), or 3 to compare the quotes (Lee kitchen).", b.lines[b.lines.length - 1]);
  check("never more than three replies", b.picks.length <= BRIEF_PICKS);
}
{
  const b = projectsBrief([deck, fence])!;
  check("nothing needs you: one line, no replies", b.lines.length === 1 && b.lines[0] === "Projects: 2 projects on track." && b.picks.length === 0, b);
  const one = projectsBrief([deck])!;
  check("…and with one project", one.lines[0] === "Projects: the one open project is on track.", one.lines);
  check("no open project: no paragraph", projectsBrief([]) === null);
}
{
  const hidden = { ...hill, snoozes: { "picks-late": { until: day(2), tone: "amber" as const } } };
  const b = projectsBrief([lee, hidden])!;
  check("a row put off with Not now stays off the briefing, and the project is counted as hidden", b.lines[0] === "Projects: 1 needs you, 1 hidden for now." && !b.lines.some((l) => l.startsWith("Hill Street")) && !b.picks.some((p) => p.projectId === "hill"), b);
  const worse = { ...hill, snoozes: { "picks-late": { until: day(2), tone: "amber" as const } }, overview: ov([item("picks-late", "red", "9 client picks past due", 5)]) };
  check("…unless it turned red since", projectsBrief([worse])!.lines.some((l) => l.startsWith("Hill Street house, at risk")));
}
{
  const many = Array.from({ length: 5 }, (_, i) => ({ id: `p${i}`, name: `Job ${i}`, snoozes: {}, overview: ov([item(`late:s${i}`, "amber", `Stage ${i} 1 day late`, 11 + i, setStage(`Stage ${i}`))]) }));
  const b = projectsBrief(many)!;
  check("five need you: the worst three written, the count says so", b.lines[0] === "Projects: 5 need you (the worst 3 below)." && b.lines.filter((l) => l.startsWith("Job ")).length === 3, b.lines);
  check("…the replies only for the projects written out", b.picks.every((p) => ["p0", "p1", "p2"].includes(p.projectId)), b.picks);
}

// ── words, room, the kept replies ───────────────────────────────────────────
{
  check("short text: whole when it fits", shortText("Demolition 4 days late") === "Demolition 4 days late");
  check("…cut at a word with an ellipsis", shortText("a ".repeat(50).trim(), 20).endsWith("…") && shortText("a ".repeat(50).trim(), 20).length <= 20);
  check("numbers in words", numbersWords(1) === "1" && numbersWords(2) === "1 or 2" && numbersWords(3) === "1, 2 or 3");
  const one: BriefPick = { n: 1, label: "mark Demolition done", projectId: "lee", projectName: "Lee kitchen", tool: "set_stage", args: {}, ask: null };
  check("one reply reads alone", picksLine([one]) === "Reply 1 to mark Demolition done (Lee kitchen).");
  const two: BriefPick = { ...one, n: 2, label: "see the ways to save", tool: null, args: null, ask: "Where can I save money" };
  check("every reply on one project: named once at the end", picksLine([one, two]) === "Reply 1 to mark Demolition done, or 2 to see the ways to save (all Lee kitchen).", picksLine([one, two]));
  const ask: BriefPick = { ...one, tool: null, args: null, ask: "Compare the quotes" };
  check("a question names the project and its id for the model", askText(ask) === "Compare the quotes on Lee kitchen (project id lee).");
}
{
  const b = projectsBrief([deck, hill, lee, fence])!;
  const all = fitProjects(b, 0);
  check("with room, the whole paragraph", all.join("\n") === b.lines.join("\n"));
  const tight = fitProjects(b, 1150 - 200);
  check("a full text drops project lines from the end, keeping the count and the replies", tight[0] === b.lines[0] && tight[tight.length - 1] === b.lines[b.lines.length - 1] && tight.length < b.lines.length && tight.some((l) => l.startsWith("Lee kitchen")), tight);
}
{
  const raw = JSON.stringify({ day: TODAY, picks: [{ n: 1, label: "x", projectId: "p", projectName: "P", tool: "set_stage", args: {}, ask: null }, { n: 2, label: "bad" }] });
  check("kept replies read back for today, the broken one dropped", parsePicks(raw, TODAY).length === 1);
  check("…and not on another day", parsePicks(raw, day(1)).length === 0 && parsePicks("{", TODAY).length === 0 && parsePicks(null, TODAY).length === 0);
}

// ── numbers said out loud ───────────────────────────────────────────────────
{
  const n = (s: string) => {
    const q = quickReply(s);
    return q?.kind === "digit" ? q.n : null;
  };
  check("'one', 'Two.', 'number three', 'the first one' are numbered replies", n("one") === 1 && n("Two.") === 2 && n("number three") === 3 && n("the first one") === 1 && n("second") === 2, [n("one"), n("Two."), n("number three"), n("the first one"), n("second")]);
  check("'1' still is, and 'one more thing' is not", n("1") === 1 && quickReply("one more thing") === null);
}

console.log(bad ? `\n${bad} FAILED` : "\nall ok");
process.exit(bad ? 1 : 0);
