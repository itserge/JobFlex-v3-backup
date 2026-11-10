// THE AI OPERATOR'S PROJECT ANSWERS (Project Overview part 3, 2026-11-09): what the Operator's two project tools hand
// the model, from the same Overview the page shows, so the words match the screen —
//   · one project: "what's going on with the Lee house?" — the status, the to-do list numbered, the next 14 days,
//     who waits on whom, the money; or one stage: "what's holding up framing?" (holdupOf);
//   · every project: "what do I need to do this week?", "which projects are behind?", "which are over budget?".
// A numbered list is kept as the person's numbered replies (lib/assistant/projectsBrief), so "1" or "do the first
// one" runs that row's step. And the one sentence at the top of the Overview: the rules' own, and the check an AI
// sentence must pass — every number in it is one of the project's. Pure, tested in qa/tests/logic/project-operator.check.ts.
import { dollars, visibleItems, type OvHoldup, type Overview, type Snoozes } from "./shared";
import { pickFor, rankProjects, shortText, type BriefPick, type BriefProject } from "./brief";

/** To-do rows numbered in one project's answer. */
export const LIST_MAX = 6;
/** Rows numbered across projects ("this week"). */
export const WEEK_MAX = 8;
/** Days "this week" looks ahead. */
export const WEEK_DAYS = 7;

const DAY = 86_400_000;
const dayNum = (iso: string) => Math.floor(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / DAY);
const say = (n: number) => dollars(n);

export type ProjectAnswer = { answer: Record<string, unknown>; picks: BriefPick[] };

/** "What's going on with the Lee house?" */
export function overviewAnswer(p: { id: string; name: string }, ov: Overview, snoozes: Snoozes): ProjectAnswer {
  const { shown, hidden } = visibleItems(ov.doNow, snoozes);
  const listed = shown.slice(0, LIST_MAX);
  const picks = listed.map((i, k) => pickFor(k + 1, p, i));
  const m = ov.money;
  return {
    picks,
    answer: {
      project: p.name,
      projectId: p.id,
      status: ov.word,
      line: ov.line,
      where: ov.sub,
      summary: ov.summary ?? null,
      toDo: listed.map((i, k) => ({ n: k + 1, what: i.text, why: i.why, urgent: i.tone === "red", replyDoes: picks[k].label })),
      moreToDo: Math.max(0, shown.length - listed.length),
      hiddenWithNotNow: hidden,
      comingUp: ov.ahead.map((a) => ({ day: a.day, what: a.title, ready: a.ready, missing: a.missing })),
      waiting: ov.people.filter((x) => x.waits).map((x) => ({ who: `${x.role}: ${x.name}`, about: x.line, waits: x.waits === "you" ? "they wait on you" : "you wait on them" })),
      money: m ? { budget: say(m.budget), spent: say(m.spent), signedNotPaid: say(m.committed), headingFor: say(m.headingFor), over: m.over > 0 ? say(m.over) : null, under: m.over < 0 ? say(-m.over) : null, contract: m.contract != null ? say(m.contract) : null, margin: m.margin != null ? say(m.margin) : null, clientPaid: say(m.collected), clientOwes: say(m.owed) } : null,
      lastHappened: ov.history.slice(0, 3).map((h) => h.text),
      how: "Say the status line first, then the to-do list with its numbers exactly as given — the person can reply with a number or 'do the first one' and it runs that row's step (replyDoes) — then what's coming up. Short; numbers only from here.",
    },
  };
}

/** "What's holding up framing on the Lee house?" */
export function holdupAnswer(p: { id: string; name: string }, h: OvHoldup): Record<string, unknown> {
  const state = h.status === "DONE" ? "done" : h.status === "ACTIVE" ? "in progress" : "planned";
  return {
    project: p.name,
    stage: h.name,
    state,
    days: h.days,
    late: h.late > 0 ? `${h.late} day${h.late === 1 ? "" : "s"} late` : null,
    inspectionsHolding: h.gates,
    tasksLeft: h.tasksLeft,
    stillNeeds: h.missing,
    alreadyHas: h.ready,
    crewStuck: h.crewStuck,
    how: h.status === "DONE" ? "It's done — say so." : "Say what holds it first (inspections, then what it still needs, then tasks left); 'nothing' when the lists are empty.",
  };
}

/** "What do I need to do this week?" — every project's to-do (worst project first, two rows each) numbered, then what
 *  starts or arrives in the next 7 days, by day. */
export function weekAnswer(list: readonly BriefProject[], today: string): ProjectAnswer {
  const { needing, onTrack, hiddenOnly } = rankProjects(list);
  const rows: Array<{ p: BriefProject; i: (typeof needing)[number]["shown"][number] }> = [];
  for (const x of needing) for (const i of x.shown.slice(0, 2)) rows.push({ p: x.p, i });
  // Worst projects first, but every red row before an amber one.
  const ordered = [...rows.filter((r) => r.i.tone === "red"), ...rows.filter((r) => r.i.tone !== "red")].slice(0, WEEK_MAX);
  const picks = ordered.map((r, k) => pickFor(k + 1, r.p, r.i));
  const t = dayNum(today);
  const ahead = list
    .flatMap((p) => p.overview.ahead.filter((a) => dayNum(a.day) - t <= WEEK_DAYS).map((a) => ({ day: a.day, project: p.name, what: a.title, missing: a.missing })))
    .sort((a, b) => a.day.localeCompare(b.day))
    .slice(0, 12);
  return {
    picks,
    answer: {
      today,
      needYou: needing.length,
      onTrack,
      hiddenWithNotNow: hiddenOnly,
      toDo: ordered.map((r, k) => ({ n: k + 1, project: r.p.name, what: r.i.text, urgent: r.i.tone === "red", replyDoes: picks[k].label })),
      moreToDo: Math.max(0, rows.length - ordered.length) + needing.reduce((s, x) => s + Math.max(0, x.shown.length - 2), 0),
      thisWeek: ahead,
      how: "Give the to-do list with its numbers exactly as given (a number or 'do the first one' runs that row's step), then this week's days in order with what's missing. Short.",
    },
  };
}

export type BoardAsk = "behind" | "over_budget" | "at_risk" | "needs_me" | "all";

/** "Which projects are behind?" / "over budget?" / "at risk?" — a short list, worst first. */
export function boardAnswer(list: readonly BriefProject[], ask: BoardAsk): Record<string, unknown> {
  const { needing, quiet } = rankProjects(list);
  const all = [...needing, ...quiet];
  const keep = all.filter((x) => (ask === "behind" ? x.p.overview.behind > 0 : ask === "over_budget" ? (x.p.overview.money?.over ?? 0) > 0 : ask === "at_risk" ? x.red : ask === "needs_me" ? x.shown.length > 0 : true));
  if (ask === "behind") keep.sort((a, b) => b.p.overview.behind - a.p.overview.behind);
  if (ask === "over_budget") keep.sort((a, b) => (b.p.overview.money?.over ?? 0) - (a.p.overview.money?.over ?? 0));
  return {
    ask,
    count: keep.length,
    of: list.length,
    projects: keep.slice(0, 12).map((x) => ({
      project: x.p.name,
      status: x.red ? "At risk" : x.shown.length ? "Needs you" : x.p.overview.word,
      behind: x.p.overview.behind > 0 ? `${x.p.overview.behind} day${x.p.overview.behind === 1 ? "" : "s"}` : null,
      overBudget: x.p.overview.money && x.p.overview.money.over > 0 ? say(x.p.overview.money.over) : null,
      where: x.p.overview.sub,
      first: x.shown[0]?.text ?? null,
    })),
    more: Math.max(0, keep.length - 12),
  };
}

// ── the sentence at the top of the Overview ──────────────────────────────────

/** What the sentence stands on: when this changes, the day's sentence is written again. */
export function overviewSig(ov: Overview): string {
  return [ov.tone, ov.behind, Math.round(ov.money?.over ?? 0), ov.doNow.slice(0, 3).map((i) => i.key).join(",")].join("|");
}

/** The rules' own sentence: "Lee kitchen is at risk: 4 days behind, $72,000 over budget. First: the crew is stuck…" */
export function summaryFallback(name: string, ov: Overview): string {
  const facts = ov.line.split(" · ").filter(Boolean).join(", ");
  // "needs you", "is at risk", "is on track", "is on hold", "is finished".
  const state = ov.word === "Needs you" ? "needs you" : `is ${ov.word.toLowerCase()}`;
  const head = `${name} ${state}${facts ? `: ${facts}` : ""}.`;
  const first = ov.doNow[0];
  return first ? `${head} First: ${shortText(first.text, 90).replace(/\.$/, "")}.` : head;
}

/** The numbers a sentence states: "$72,000" → "72000", "15%" → "15", "Nov 12" → "12". */
export function numbersIn(s: string): string[] {
  return (s.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((x) => String(Number(x.replace(/,/g, ""))));
}

/** The facts the AI is given, compact — and every number an honest sentence could use comes from here. */
export function summaryFacts(name: string, ov: Overview): Record<string, unknown> {
  const m = ov.money;
  return {
    project: name,
    status: ov.word,
    line: ov.line,
    where: ov.sub,
    toDo: ov.doNow.slice(0, 4).map((i) => (i.why ? `${i.text} (${i.why})` : i.text)),
    comingUp: ov.ahead.slice(0, 3).map((a) => `${a.title} ${a.day}${a.missing.length ? `: missing ${a.missing.join(", ")}` : ""}`),
    money: m ? { budget: Math.round(m.budget), spent: Math.round(m.spent), headingFor: Math.round(m.headingFor), over: Math.round(m.over) } : null,
  };
}

/** An AI sentence is kept only when it is one short line and every number in it is one of the project's. */
export function sentenceOk(sentence: string, name: string, ov: Overview): boolean {
  const t = sentence.trim();
  if (!t || t.length > 260 || /\n/.test(t)) return false;
  const allowed = new Set(numbersIn(`${JSON.stringify(summaryFacts(name, ov))} ${name}`));
  return numbersIn(t).every((n) => allowed.has(n));
}
