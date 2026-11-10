// THE PROJECTS PARAGRAPH IN THE MORNING BRIEFING (Project Overview part 2, 2026-11-09): one line per project that
// needs the person, worst first, from the same Overview the project page shows (lib/projectOverview/shared), so the
// text and the screen always agree; the projects on track counted in one line; and up to three numbered replies,
// each a row's Operator step (OvOp): "Reply 1 to mark Demolition done (Lee kitchen)". Pure: no database, tested in
// qa/tests/logic/project-brief.check.ts. The reads and the kept replies are lib/assistant/projectsBrief.
import { dollars, visibleItems, type OvItem, type Overview, type Snoozes } from "./shared";

/** Projects written out in full; the rest are counted. */
export const BRIEF_PROJECTS = 3;
/** Rows named on a project's line. */
export const BRIEF_ITEMS = 2;
/** Numbered replies offered. */
export const BRIEF_PICKS = 3;

export type BriefProject = { id: string; name: string; overview: Overview; snoozes: Snoozes };

/** One numbered reply, kept until the end of the company's day (or until the Operator's model answers something). */
export type BriefPick = {
  n: number;
  label: string;
  projectId: string;
  projectName: string;
  /** A write tool planned and read back for a yes … */
  tool: string | null;
  args: Record<string, unknown> | null;
  /** … or a question the model answers. */
  ask: string | null;
};

export type ProjectsBrief = { lines: string[]; picks: BriefPick[]; need: number; onTrack: number };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A row's words, short enough for a text: cut at a word, with an ellipsis. */
export function shortText(s: string, max = 64): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:·-]+$/, "")}…`;
}

export type Ranked = { p: BriefProject; shown: OvItem[]; red: boolean; hidden: number };

/** Worst first: a red row before amber, then the most urgent row's rank, then the days behind. */
function worstFirst(a: Ranked, b: Ranked): number {
  if (a.red !== b.red) return a.red ? -1 : 1;
  const ra = a.shown[0]?.rank ?? 99;
  const rb = b.shown[0]?.rank ?? 99;
  if (ra !== rb) return ra - rb;
  return b.p.overview.behind - a.p.overview.behind;
}

/** "Lee kitchen, at risk: 4 days behind, $72,000 over budget. Crew stuck: no shut-off valve; Demolition 4 days late; +8 more." */
export function projectLine(x: Ranked): string {
  const ov = x.p.overview;
  const facts = [ov.behind > 0 ? `${plural(ov.behind, "day")} behind` : null, ov.money && ov.money.over > 0 ? `${dollars(ov.money.over)} over budget` : null].filter(Boolean);
  const rows = x.shown.slice(0, BRIEF_ITEMS).map((i) => shortText(i.text));
  const more = x.shown.length - rows.length;
  const head = `${x.p.name}, ${x.red ? "at risk" : "needs you"}${facts.length ? `: ${facts.join(", ")}` : ""}.`;
  return `${head} ${rows.join("; ")}${more > 0 ? `; +${more} more` : ""}.`;
}

/** "Reply 1 to mark Demolition done (Lee kitchen), or 2 to compare the quotes (Hill Street house)." — one project named
 *  once at the end when every reply is on it. */
export function picksLine(picks: readonly BriefPick[]): string {
  const one = picks.length > 1 && picks.every((p) => p.projectId === picks[0].projectId);
  const parts = picks.map((p) => `${p.n} to ${p.label}${one ? "" : ` (${p.projectName})`}`);
  if (one) parts[parts.length - 1] += ` (all ${picks[0].projectName})`;
  const last = parts.pop();
  return `Reply ${parts.length ? `${parts.join(", ")}, or ${last}` : last}.`;
}

/** The numbered replies: first the top step of each project written out, then the next ones, in order. */
export function picksOf(ranked: readonly Ranked[]): BriefPick[] {
  const out: BriefPick[] = [];
  const used = new Set<string>();
  const take = (p: BriefProject, i: OvItem) => {
    const op = i.op;
    if (!op || out.length >= BRIEF_PICKS || used.has(`${p.id}|${i.key}`)) return false;
    used.add(`${p.id}|${i.key}`);
    out.push({ n: out.length + 1, label: op.label, projectId: p.id, projectName: p.name, tool: "tool" in op ? op.tool : null, args: "tool" in op ? op.args : null, ask: "ask" in op ? op.ask : null });
    return true;
  };
  for (const x of ranked) {
    const first = x.shown.find((i) => i.op);
    if (first) take(x.p, first);
  }
  for (const x of ranked) for (const i of x.shown) take(x.p, i);
  return out;
}

/** Each project's rows after "Not now", the ones needing the person worst first, and the quiet ones counted. Shared by
 *  the briefing and the Operator's answers (lib/projectOverview/operator). */
export function rankProjects(list: readonly BriefProject[]): { needing: Ranked[]; quiet: Ranked[]; hiddenOnly: number; onTrack: number } {
  const ranked: Ranked[] = list.map((p) => {
    const v = visibleItems(p.overview.doNow, p.snoozes);
    return { p, shown: v.shown, red: v.shown.some((i) => i.tone === "red"), hidden: v.hidden };
  });
  const needing = ranked.filter((x) => x.shown.length > 0).sort(worstFirst);
  const quiet = ranked.filter((x) => x.shown.length === 0);
  const hiddenOnly = quiet.filter((x) => x.hidden > 0).length;
  return { needing, quiet, hiddenOnly, onTrack: quiet.length - hiddenOnly };
}

/** One row as a numbered reply: its Operator step, or — a row the Operator has no tool for — a question about it. */
export function pickFor(n: number, p: { id: string; name: string }, i: OvItem): BriefPick {
  const op = i.op;
  if (op) return { n, label: op.label, projectId: p.id, projectName: p.name, tool: "tool" in op ? op.tool : null, args: "tool" in op ? op.args : null, ask: "ask" in op ? op.ask : null };
  return { n, label: shortText(i.text, 48), projectId: p.id, projectName: p.name, tool: null, args: null, ask: `What can I do about this: ${i.text}` };
}

/** The paragraph, or null when the company has no open project. */
export function projectsBrief(list: readonly BriefProject[]): ProjectsBrief | null {
  if (!list.length) return null;
  const { needing, hiddenOnly, onTrack } = rankProjects(list);

  if (!needing.length) {
    const tail = hiddenOnly ? `, ${hiddenOnly} hidden for now` : "";
    return { lines: [`Projects: ${onTrack === 1 && !hiddenOnly ? "the one open project is on track" : `${plural(onTrack, "project")} on track${tail}`}.`], picks: [], need: 0, onTrack };
  }
  const shown = needing.slice(0, BRIEF_PROJECTS);
  const rest = needing.length - shown.length;
  const counts = [`${needing.length} need${needing.length === 1 ? "s" : ""} you${rest > 0 ? ` (the worst ${shown.length} below)` : ""}`, onTrack ? `${onTrack} on track` : null, hiddenOnly ? `${hiddenOnly} hidden for now` : null].filter(Boolean);
  const lines = [`Projects: ${counts.join(", ")}.`, ...shown.map(projectLine)];
  const picks = picksOf(shown);
  if (picks.length) lines.push(picksLine(picks));
  return { lines, picks, need: needing.length, onTrack };
}

/** What a text carries (lib/assistant/sms cuts at 1200): the projects paragraph gives way first. */
const TEXT_ROOM = 1150;

/** The projects paragraph cut to the room left: its count line and its numbered replies stay; project lines go from
 *  the end (the replies name their project, so they still read). */
export function fitProjects(p: ProjectsBrief, used: number): string[] {
  const head = p.lines[0];
  const rows = p.lines.slice(1);
  const replies = p.picks.length ? rows.pop() ?? null : null;
  const size = () => [head, ...rows, replies].filter(Boolean).join("\n").length + 1;
  while (rows.length > 1 && used + size() > TEXT_ROOM) rows.pop();
  return [head, ...rows, ...(replies ? [replies] : [])];
}

/** The question a numbered "ask" reply puts to the model, with the project named so it needs no search. */
export function askText(p: BriefPick): string {
  return `${p.ask} on ${p.projectName} (project id ${p.projectId}).`;
}

/** The kept replies, or [] when they are another day's or unreadable. */
export function parsePicks(raw: string | null | undefined, day: string): BriefPick[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as { day?: unknown; picks?: unknown };
    if (v.day !== day || !Array.isArray(v.picks)) return [];
    return v.picks.filter((p): p is BriefPick => Boolean(p) && typeof p.n === "number" && typeof p.label === "string" && typeof p.projectId === "string" && (typeof p.tool === "string" || typeof p.ask === "string")).slice(0, BRIEF_PICKS);
  } catch {
    return [];
  }
}

/** "1, 2 or 3". */
export function numbersWords(n: number): string {
  const xs = Array.from({ length: n }, (_, i) => String(i + 1));
  return xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}`;
}
