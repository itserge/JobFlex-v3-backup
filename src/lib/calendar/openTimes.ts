// FIRST OPEN TIMES (calendar part 1, 2026-11-09) — pure, shared by the calendar's "First open times" button and the
// Operator's open_times tool. Given who could do the work, what each of them already has booked, and how long the
// work takes, it returns the earliest starts that fit — one per person per day, so the three offers are real choices
// and not 8:00 / 8:30 / 9:00 for the same person. Proved by qa/tests/logic/calendar-place.check.ts.

export type OpenPerson = { id: string; name: string };
/** A busy span. `personId` null = the whole company (an org-wide block — a holiday, a shop day). */
export type OpenBusy = { personId: string | null; start: Date; end: Date };
export type OpenSlot = { personId: string; name: string; start: Date; end: Date };

export type OpenTimesInput = {
  /** Nothing earlier than this (rounded up to the step). */
  from: Date;
  people: OpenPerson[];
  busy: OpenBusy[];
  durationMin: number;
  /** How many days ahead to look (default 21). */
  days?: number;
  /** The working day, minutes from midnight (default 8:00–17:00). A job longer than the day starts at the day's start. */
  dayStartMin?: number;
  dayEndMin?: number;
  /** Days of the week it never offers (0 = Sunday; default Sunday only). */
  closedDays?: number[];
  stepMin?: number;
  count?: number;
};

export function findOpenTimes(input: OpenTimesInput): OpenSlot[] {
  const step = input.stepMin ?? 30;
  const dayStart = input.dayStartMin ?? 8 * 60;
  const dayEnd = input.dayEndMin ?? 17 * 60;
  const closed = input.closedDays ?? [0];
  const count = input.count ?? 3;
  const days = input.days ?? 21;
  const dur = Math.max(step, Math.round(input.durationMin));
  // A job that won't fit the working day books the whole day (from the start) — the crew comes back tomorrow.
  const fitsInDay = dur <= dayEnd - dayStart;
  const out: OpenSlot[] = [];
  const minStart = Math.ceil(input.from.getTime() / (step * 60_000)) * step * 60_000;
  const orgBusy = input.busy.filter((b) => b.personId === null);

  for (let d = 0; d < days && out.length < count; d++) {
    const day = new Date(input.from.getFullYear(), input.from.getMonth(), input.from.getDate() + d);
    if (closed.includes(day.getDay())) continue;
    const at = (min: number) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, min);
    // Each person's first fit this day, then the day's offers earliest first — a later person's 8:00 must not lose
    // to an earlier person's 3:00 when only one offer is left.
    const today: OpenSlot[] = [];
    for (const p of input.people) {
      const mine = input.busy.filter((b) => b.personId === p.id).concat(orgBusy);
      const lastStart = fitsInDay ? dayEnd - dur : dayStart;
      for (let m = dayStart; m <= lastStart; m += step) {
        const s = at(m);
        const e = new Date(s.getTime() + dur * 60_000);
        if (s.getTime() < minStart) continue;
        if (mine.some((b) => b.start.getTime() < e.getTime() && b.end.getTime() > s.getTime())) continue;
        today.push({ personId: p.id, name: p.name, start: s, end: e });
        break; // one offer per person per day
      }
    }
    today.sort((a, b) => a.start.getTime() - b.start.getTime() || a.name.localeCompare(b.name));
    for (const s of today) if (out.length < count) out.push(s);
  }
  return out;
}
