// THE PROJECT TIMELINE — the rules (the timeline build, 2026-11-06). Pure: no database, no clock of its own, so
// the card, the Operator and the checks all count the same way.
//
//   · work days      — a slip moves what comes after it by WORK days (Mon–Fri); a day that would land on the
//                      weekend goes to the Monday. Same rule everywhere: stages, the crew's calendar days, the
//                      inspections. addWorkDays / workDaysLate.
//   · shiftPlan      — "Shift the rest": from a stage that slipped, which rows move and to what. The stage keeps
//                      its first day and ends later; every stage after it moves whole; the crew's future visits
//                      past the stage's last day move with it (a day already worked never moves); pending
//                      inspections move. Deliveries already ordered keep the supplier's date — a material not
//                      ordered yet reads its "order by" from its stage, so it moves with the stage on its own.
//   · layoutPlan     — "Lay out the days": the undated stages back to back from a day, each as long as its weight
//                      says, so a project gets a timeline in one tap and the office moves what it knows better.
//   · the chart      — the window the bars are drawn in and each bar's place in it, in percent of the width.
//   · inspectionFlags — what the list and the project page say about inspections coming up, passed by or failed.

const DAY_MS = 86_400_000;

export type InspectionResult = "PENDING" | "PASSED" | "FAILED";

export const RESULT_LABEL: Record<InspectionResult, string> = { PENDING: "Scheduled", PASSED: "Passed", FAILED: "Failed" };

export function inspectionResultOf(s: string): InspectionResult {
  return s === "PASSED" || s === "FAILED" ? s : "PENDING";
}

// ── days ─────────────────────────────────────────────────────────────────────

/** "2026-11-10" from a day in any of the shapes the app keeps it in; null for none. */
export function isoDay(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const iso = typeof d === "string" ? d : d.toISOString();
  return /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : null;
}

const dayMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const fromMs = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** 0 = Sunday … 6 = Saturday, of a day key. */
export function dowOf(iso: string): number {
  return new Date(dayMs(iso)).getUTCDay();
}

export const isWeekend = (iso: string) => {
  const d = dowOf(iso);
  return d === 0 || d === 6;
};

/** Mon–Fri: the days the office plans in. A crew that works Saturdays shifts by its own week (workWeekOf). */
export const WEEKDAYS: ReadonlySet<number> = new Set([1, 2, 3, 4, 5]);

/** The day `n` work days after `iso` — or before it, for a negative n — counting only the days in `week`
 *  (Mon–Fri unless told otherwise). A start outside the week counts from the work day next to it, so Saturday + 1
 *  = Monday and Friday + 1 = Monday too. 0 leaves a work day alone and moves any other to the next one. */
export function addWorkDays(iso: string, n: number, week: ReadonlySet<number> = WEEKDAYS): string {
  let ms = dayMs(iso);
  let left = Math.round(n);
  const off = (d: string) => !week.has(dowOf(d));
  if (left === 0) {
    while (off(fromMs(ms))) ms += DAY_MS;
    return fromMs(ms);
  }
  const step = left > 0 ? DAY_MS : -DAY_MS;
  while (left !== 0) {
    ms += step;
    if (!off(fromMs(ms))) left += left > 0 ? -1 : 1;
  }
  return fromMs(ms);
}

/** The week a job's crew works, read off its visits: Mon–Fri, plus Saturday or Sunday when a visit sits there. So
 *  a six-day crew's days shift by six-day weeks and never land two on one Monday. */
export function workWeekOf(days: ReadonlyArray<string>): ReadonlySet<number> {
  const week = new Set(WEEKDAYS);
  for (const d of days) {
    const dow = dowOf(d);
    if (dow === 6 || dow === 0) week.add(dow);
  }
  return week;
}

/** How many work days `to` is past `from` (0 when it is not). "3 work days late" for a stage whose last day was
 *  Thursday, read on the Tuesday after. */
export function workDaysLate(from: string, to: string): number {
  if (to <= from) return 0;
  let n = 0;
  let ms = dayMs(from);
  const end = dayMs(to);
  while (ms < end) {
    ms += DAY_MS;
    if (!isWeekend(fromMs(ms))) n++;
  }
  return n;
}

/** The calendar days from one day key to another (negative backwards). */
export function daysBetween(from: string, to: string): number {
  return Math.round((dayMs(to) - dayMs(from)) / DAY_MS);
}

/** "Nov 10" from a day key. */
export function dayLabel(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(dayMs(iso)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** "Tue Nov 10". */
export function dayLabelLong(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(dayMs(iso)).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

export function workDaysWords(n: number): string {
  return `${n} work day${n === 1 ? "" : "s"}`;
}

/** The minutes a time zone is ahead of UTC at an instant (−480 for Los Angeles in winter). */
export function tzOffsetMinutes(d: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(d);
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  const asUtc = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
  return Math.round((asUtc - d.getTime()) / 60_000);
}

/** The day key an instant falls on in a time zone. */
export function dayKeyIn(d: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const n = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${n("year")}-${n("month")}-${n("day")}`;
}

/** The same wall-clock time `days` calendar days later in the time zone — a visit at 8:00 stays at 8:00 across a
 *  clock change. */
export function shiftInstant(d: Date, days: number, tz: string): Date {
  const rough = new Date(d.getTime() + days * DAY_MS);
  const drift = tzOffsetMinutes(d, tz) - tzOffsetMinutes(rough, tz);
  return new Date(rough.getTime() + drift * 60_000);
}

/** The instant `n` work days on from `d`, by the day it falls on in the time zone, keeping its time of day. */
export function shiftInstantWorkDays(d: Date, n: number, tz: string, week: ReadonlySet<number> = WEEKDAYS): Date {
  const day = dayKeyIn(d, tz);
  return shiftInstant(d, daysBetween(day, addWorkDays(day, n, week)), tz);
}

// ── "shift the rest" ─────────────────────────────────────────────────────────

/** `afterId` (part 4, 2026-11-07): the stage this one cannot start before; when any stage on the project carries one,
 *  a slip moves only what depends on the slipped stage, lane by lane, instead of everything after it. */
export type ShiftStage = { id: string; name: string; position: number; status: string; startsAt: string | null; endsAt: string | null; afterId?: string | null; lane?: string | null };
export type ShiftJob = { id: string; title: string; status: string; startsAt: Date | null; endsAt: Date | null; events: Array<{ id: string; startsAt: Date; endsAt: Date }> };
export type ShiftInspection = { id: string; name: string; date: string | null; result: string; stageId?: string | null };

export type ShiftPlan = {
  /** The stage that slipped. */
  stage: { id: string; name: string; endsAt: string; newEndsAt: string };
  days: number;
  /** Everything after the stage's last day moves — these stages, whole (with dependencies: only what depends on it). */
  stages: Array<{ id: string; name: string; startsAt: string | null; endsAt: string | null; newStartsAt: string | null; newEndsAt: string | null }>;
  /** True when the project's stages carry dependencies and only the dependents moved (part 4). */
  byDependency: boolean;
  /** The crew's visits from tomorrow on, past the stage's last day, and the span of each job they belong to. */
  jobs: Array<{ id: string; title: string; newStartsAt: Date | null; newEndsAt: Date | null; events: Array<{ id: string; startsAt: Date; endsAt: Date; newStartsAt: Date; newEndsAt: Date }> }>;
  inspections: Array<{ id: string; name: string; date: string; newDate: string }>;
  /** The plan in words, one line each, for the sheet and the Operator's read-back. */
  words: string[];
};

/**
 * What "Shift the rest" does from a stage that slipped by `days` work days. Nothing here is written — the server
 * applies the plan, the sheet and the Operator read it back first.
 */
export function shiftPlan(input: { stages: ShiftStage[]; jobs: ShiftJob[]; inspections: ShiftInspection[]; stageId: string; days: number; today: string; tz: string }): ShiftPlan | { error: string } {
  const days = Math.round(input.days);
  if (!(days >= 1 && days <= 60)) return { error: "Shift by 1 to 60 work days." };
  const stage = input.stages.find((s) => s.id === input.stageId);
  if (!stage) return { error: "That stage is not on the project." };
  const cutoff = stage.endsAt ?? stage.startsAt;
  if (!cutoff) return { error: `"${stage.name}" has no days yet — set its days first.` };
  const newEnd = addWorkDays(cutoff, days);

  const movedIds = dependentsOf(input.stages, stage.id);
  const byDependency = movedIds !== null;
  const stages = input.stages
    .filter((s) => (byDependency ? movedIds.has(s.id) : s.position > stage.position) && (s.startsAt || s.endsAt))
    .map((s) => ({ id: s.id, name: s.name, startsAt: s.startsAt, endsAt: s.endsAt, newStartsAt: s.startsAt ? addWorkDays(s.startsAt, days) : null, newEndsAt: s.endsAt ? addWorkDays(s.endsAt, days) : null }));
  const movedStageIds = new Set([stage.id, ...stages.map((s) => s.id)]);

  const jobs: ShiftPlan["jobs"] = [];
  for (const j of input.jobs) {
    if (j.status === "COMPLETED" || j.status === "CANCELED") continue;
    // The crew's own week: a job with Saturday visits moves by six-day weeks, so no two visits land on one day.
    const week = workWeekOf(j.events.map((e) => dayKeyIn(e.startsAt, input.tz)));
    const events = j.events
      .filter((e) => {
        const day = dayKeyIn(e.startsAt, input.tz);
        return day > cutoff && day > input.today;
      })
      .map((e) => ({ id: e.id, startsAt: e.startsAt, endsAt: e.endsAt, newStartsAt: shiftInstantWorkDays(e.startsAt, days, input.tz, week), newEndsAt: shiftInstantWorkDays(e.endsAt, days, input.tz, week) }));
    const startDay = j.startsAt ? dayKeyIn(j.startsAt, input.tz) : null;
    const endDay = j.endsAt ? dayKeyIn(j.endsAt, input.tz) : null;
    const moveStart = !!startDay && startDay > cutoff && startDay > input.today;
    const moveEnd = !!endDay && endDay > cutoff && endDay > input.today;
    if (!events.length && !moveStart && !moveEnd) continue;
    jobs.push({
      id: j.id,
      title: j.title,
      newStartsAt: moveStart && j.startsAt ? shiftInstantWorkDays(j.startsAt, days, input.tz, week) : null,
      newEndsAt: moveEnd && j.endsAt ? shiftInstantWorkDays(j.endsAt, days, input.tz, week) : null,
      events,
    });
  }

  // With dependencies, only the inspections on the stages that move (and the stage-less ones past the cutoff) move.
  const inspections = input.inspections
    .filter((i) => i.result === "PENDING" && i.date && i.date > cutoff && (!byDependency || !i.stageId || movedStageIds.has(i.stageId)))
    .map((i) => ({ id: i.id, name: i.name, date: i.date!, newDate: addWorkDays(i.date!, days) }));

  const visits = jobs.reduce((n, j) => n + j.events.length, 0);
  const words = [
    `"${stage.name}" ends ${dayLabel(newEnd)} instead of ${dayLabel(cutoff)}.`,
    stages.length ? `${stages.length} stage${stages.length === 1 ? "" : "s"} ${byDependency ? "that depend on it" : "after it"} move${stages.length === 1 ? "s" : ""} ${workDaysWords(days)}: ${stages.map((s) => `${s.name} → ${[s.newStartsAt, s.newEndsAt].filter(Boolean).map(dayLabel).join("–")}`).join(", ")}.` : byDependency ? "Nothing depends on it, so no other stage moves." : "No stage after it has days.",
    visits ? `${visits} crew day${visits === 1 ? "" : "s"} on the calendar move${visits === 1 ? "s" : ""} with them (${jobs.map((j) => j.title).join(", ")}).` : "No crew days on the calendar after it.",
    inspections.length ? `${inspections.length} inspection${inspections.length === 1 ? "" : "s"} move${inspections.length === 1 ? "s" : ""}: ${inspections.map((i) => `${i.name} → ${dayLabel(i.newDate)}`).join(", ")}.` : "",
    "Deliveries already ordered keep their dates.",
  ].filter(Boolean);

  return { stage: { id: stage.id, name: stage.name, endsAt: cutoff, newEndsAt: newEnd }, days, stages, byDependency, jobs, inspections, words };
}

/** The stages that depend on one, transitively (part 4): null when no stage on the project carries a dependency —
 *  the old rule (everything after it) then applies. */
export function dependentsOf(stages: ReadonlyArray<{ id: string; afterId?: string | null }>, stageId: string): Set<string> | null {
  if (!stages.some((s) => s.afterId)) return null;
  const out = new Set<string>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const s of stages) {
      if (out.has(s.id) || !s.afterId) continue;
      if (s.afterId === stageId || out.has(s.afterId)) {
        out.add(s.id);
        grew = true;
      }
    }
  }
  return out;
}

// ── "lay out the days" ───────────────────────────────────────────────────────

export type LayoutStage = { id: string; name: string; position: number; status: string; startsAt: string | null; endsAt: string | null; weight: number; afterId?: string | null; lane?: string | null };

/**
 * Days for the stages that have none, back to back from `from` (a weekend start moves to the Monday): each stage
 * runs `perWeight` work days per unit of weight (at least one day), or the lot fits into `workDays` when that is
 * given. A stage that already has days is left alone and the next undated one starts the work day after it. With
 * dependencies and lanes (part 4): a stage starts the work day after the stage it waits for, else after the last
 * stage in its own lane — so the site work runs beside the permits, and the shop beside the house.
 */
export function layoutPlan(stages: LayoutStage[], from: string, opts: { perWeight?: number; workDays?: number } = {}): Array<{ id: string; name: string; startsAt: string; endsAt: string }> {
  const undated = stages.filter((s) => !s.startsAt && !s.endsAt && s.status !== "DONE");
  if (!undated.length) return [];
  const chained = stages.some((s) => s.afterId);
  // With dependencies the lot's length is the longest chain, not the sum — the lanes run beside each other.
  const weightAll = chained ? Math.max(...lanesOf(undated).map((lane) => lane.reduce((n, s) => n + Math.max(0.1, s.weight), 0))) : undated.reduce((n, s) => n + Math.max(0.1, s.weight), 0);
  const per = opts.workDays && opts.workDays > 0 ? opts.workDays / weightAll : Math.max(0.5, opts.perWeight ?? 3);
  const out: Array<{ id: string; name: string; startsAt: string; endsAt: string }> = [];
  const ends = new Map<string, string>();
  const laneCursor = new Map<string, string>();
  const start0 = addWorkDays(from, 0);
  let cursor = start0;
  for (const s of [...stages].sort((a, b) => a.position - b.position)) {
    const lane = s.lane ?? "";
    if (s.startsAt || s.endsAt) {
      const end = s.endsAt ?? s.startsAt!;
      ends.set(s.id, end);
      if (end >= cursor) cursor = addWorkDays(end, 1);
      if (end >= (laneCursor.get(lane) ?? start0)) laneCursor.set(lane, addWorkDays(end, 1));
      continue;
    }
    if (s.status === "DONE") continue;
    const len = Math.max(1, Math.round(Math.max(0.1, s.weight) * per));
    let startsAt: string;
    if (chained) {
      const afterEnd = s.afterId ? ends.get(s.afterId) : null;
      startsAt = afterEnd ? addWorkDays(afterEnd, 1) : (laneCursor.get(lane) ?? start0);
    } else startsAt = cursor;
    const endsAt = addWorkDays(startsAt, len - 1);
    out.push({ id: s.id, name: s.name, startsAt, endsAt });
    ends.set(s.id, endsAt);
    cursor = addWorkDays(endsAt, 1);
    laneCursor.set(lane, addWorkDays(endsAt, 1));
  }
  return out;
}

const lanesOf = <T extends { lane?: string | null }>(xs: readonly T[]): T[][] => {
  const m = new Map<string, T[]>();
  for (const x of xs) m.set(x.lane ?? "", [...(m.get(x.lane ?? "") ?? []), x]);
  return [...m.values()];
};

// ── the chart ────────────────────────────────────────────────────────────────

export type TimelineWindow = { from: string; to: string; days: number; weeks: Array<{ from: string; label: string; left: number; width: number }>; todayLeft: number | null };

const monday = (iso: string) => {
  const d = dowOf(iso);
  return fromMs(dayMs(iso) - ((d + 6) % 7) * DAY_MS);
};

/** The weeks the chart draws: from the Monday before the first day on the project (or today) to the Sunday after
 *  the last — at least a week either side of today, at most about four months. */
export function timelineWindow(days: Array<string | null | undefined>, today: string): TimelineWindow {
  const dated = days.filter((d): d is string => !!d);
  const lo = dated.length ? dated.reduce((a, b) => (a < b ? a : b)) : today;
  const hi = dated.length ? dated.reduce((a, b) => (a > b ? a : b)) : today;
  let from = monday(fromMs(Math.min(dayMs(lo), dayMs(today) - 7 * DAY_MS)));
  let to = fromMs(dayMs(monday(fromMs(Math.max(dayMs(hi), dayMs(today) + 14 * DAY_MS)))) + 6 * DAY_MS);
  const MAX = 18 * 7;
  if (daysBetween(from, to) + 1 > MAX) {
    // Too long to draw: keep today in view and the weeks around it.
    const anchor = today >= from && today <= to ? today : lo;
    from = monday(fromMs(dayMs(anchor) - 21 * DAY_MS));
    to = fromMs(dayMs(from) + (MAX - 1) * DAY_MS);
  }
  const total = daysBetween(from, to) + 1;
  const weeks: TimelineWindow["weeks"] = [];
  for (let ms = dayMs(from); ms <= dayMs(to); ms += 7 * DAY_MS) {
    const wk = fromMs(ms);
    weeks.push({ from: wk, label: dayLabel(wk), left: (daysBetween(from, wk) / total) * 100, width: (7 / total) * 100 });
  }
  const todayLeft = today >= from && today <= to ? ((daysBetween(from, today) + 0.5) / total) * 100 : null;
  return { from, to, days: total, weeks, todayLeft };
}

/** A bar's place in the window, in percent: a stage from its first day to its last (one day wide at least). */
export function barOf(startsAt: string | null, endsAt: string | null, win: TimelineWindow): { left: number; width: number; clippedLeft: boolean; clippedRight: boolean } | null {
  const a = startsAt ?? endsAt;
  const b = endsAt ?? startsAt;
  if (!a || !b) return null;
  const s = Math.max(0, daysBetween(win.from, a));
  const e = Math.min(win.days, daysBetween(win.from, b) + 1);
  if (e <= 0 || s >= win.days) return null;
  return { left: (s / win.days) * 100, width: (Math.max(1, e - s) / win.days) * 100, clippedLeft: a < win.from, clippedRight: b > win.to };
}

/** A day's place in the window (a delivery, an inspection), in percent of the width — null when it is outside. */
export function markOf(day: string | null | undefined, win: TimelineWindow): number | null {
  if (!day || day < win.from || day > win.to) return null;
  return ((daysBetween(win.from, day) + 0.5) / win.days) * 100;
}

// ── inspections on the list ──────────────────────────────────────────────────

export type InspectionFlag = { kind: "inspection"; text: string };

/** What the project list and the page flag about inspections: one failed, one today or tomorrow, one whose day
 *  passed with no result. The soonest first; at most two lines. */
export function inspectionFlags(rows: ReadonlyArray<{ name: string; date: string | null; result: string }>, today: string): InspectionFlag[] {
  const out: InspectionFlag[] = [];
  const failed = rows.filter((r) => r.result === "FAILED");
  if (failed.length) out.push({ kind: "inspection", text: failed.length === 1 ? `Failed: ${failed[0].name} — schedule the re-inspection` : `${failed.length} inspections failed` });
  const pending = rows.filter((r) => r.result === "PENDING" && r.date).sort((a, b) => a.date!.localeCompare(b.date!));
  const passedBy = pending.filter((r) => r.date! < today);
  // Today, tomorrow, or the next work day — Friday flags Monday's.
  const nextWork = addWorkDays(today, 1);
  const soon = pending.filter((r) => r.date! >= today && (daysBetween(today, r.date!) <= 1 || r.date === nextWork));
  if (soon.length) {
    const r = soon[0];
    const when = r.date === today ? "today" : daysBetween(today, r.date!) === 1 ? "tomorrow" : new Date(dayMs(r.date!)).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
    out.push({ kind: "inspection", text: `${r.name} ${when}` });
  } else if (passedBy.length) {
    const r = passedBy[passedBy.length - 1];
    out.push({ kind: "inspection", text: `${r.name} was ${dayLabel(r.date)} — record the result` });
  }
  return out.slice(0, 2);
}

/** "have ready: the permit card, a ladder" → the lines the inspector needs, one per line or comma. */
export function readyLines(note: string | null | undefined): string[] {
  if (!note) return [];
  return note
    .split(/\n|;|,(?![^(]*\))/)
    .map((s) => s.replace(/^\s*(have ready|ready|bring)\s*:\s*/i, "").trim())
    .filter(Boolean);
}
