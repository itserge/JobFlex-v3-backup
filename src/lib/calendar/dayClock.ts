// THE MONTH DAY TIMELINE (calendar part 1, 2026-11-09) — pure, shared by the calendar and its check.
//
// While a card is in the air over a month day, that day's column grows into a tall timeline laid over it. Up and
// down is the time; the line sits under the cursor and the drop books exactly what it reads. A month cell used to
// name only the DAY — a moved card kept its old hour and a tray job always landed at 9:00–2:00.
// Proved by qa/tests/logic/calendar-place.check.ts.

export const DAY_CLOCK_START_HOUR = 7;
export const DAY_CLOCK_END_HOUR = 19;
const SPAN_MIN = (DAY_CLOCK_END_HOUR - DAY_CLOCK_START_HOUR) * 60;

/** The snap a timeline of this height can be aimed at: quarter hours when a quarter is at least 8px, else half hours. */
export function dayClockStep(scaleH: number): 15 | 30 {
  return (scaleH / SPAN_MIN) * 15 >= 8 ? 15 : 30;
}

/** Cursor y inside the timeline (0 = its top) → a start in minutes from midnight, rounded to the NEAREST step so the
 *  line is never more than half a step from the cursor. The last start offered is one step before the end. */
export function dayClockMinutesAt(y: number, height: number, step: number = dayClockStep(height)): number {
  const frac = Math.min(1, Math.max(0, y / Math.max(1, height)));
  const steps = Math.round((frac * SPAN_MIN) / step);
  const max = SPAN_MIN / step - 1;
  return DAY_CLOCK_START_HOUR * 60 + Math.min(max, steps) * step;
}

/** Where a time sits on the timeline, 0…1 (clamped). */
export function dayClockFrac(minutes: number): number {
  return Math.min(1, Math.max(0, (minutes - DAY_CLOCK_START_HOUR * 60) / SPAN_MIN));
}

/** A booking on the day, in minutes from midnight (clipped to the day). */
export type DayBusy = { id: string; startMin: number; endMin: number; workers: string[]; who: string; what: string };

/** The bookings of `day` as minute ranges — a multi-day job covers the whole of a middle day; one that ends exactly at
 *  midnight belongs to the day before. */
export function busyOnDay(
  day: Date,
  rows: Array<{ id: string; start: Date; end: Date; workers: string[]; who: string; what: string }>,
): DayBusy[] {
  const d0 = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  const d1 = d0 + 24 * 60 * 60_000;
  const out: DayBusy[] = [];
  for (const r of rows) {
    const s = r.start.getTime();
    const e = r.end.getTime();
    if (!(e > d0 && s < d1)) continue;
    out.push({ id: r.id, startMin: Math.max(0, Math.round((s - d0) / 60_000)), endMin: Math.min(24 * 60, Math.round((e - d0) / 60_000)), workers: r.workers, who: r.who, what: r.what });
  }
  return out.sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
}

/** The bookings a drop at [startMin, endMin) would double-book — one of the SAME people on both. Other people being busy
 *  is not a clash, and a card with nobody on it clashes with no one. */
export function clashesFor(busy: DayBusy[], startMin: number, endMin: number, workers: string[]): DayBusy[] {
  if (!workers.length) return [];
  return busy.filter((b) => b.startMin < endMin && b.endMin > startMin && b.workers.some((w) => workers.includes(w)));
}

/** "9:30 AM" from minutes since midnight. */
export function clockWords(min: number): string {
  const h24 = Math.floor(min / 60) % 24;
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${String(min % 60).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`;
}

/** "9:00 AM – 1:00 PM" / "9:30 – 10:30 AM" for a start and a length; a span past midnight says "→ next day". */
export function spanWords(startMin: number, durMin: number): string {
  const endMin = startMin + durMin;
  if (endMin > 24 * 60) return `${clockWords(startMin)} → ${Math.ceil(durMin / (24 * 60))} days`;
  const ap = (m: number) => (Math.floor(m / 60) % 24 < 12 ? "AM" : "PM");
  const hm = (m: number) => clockWords(m).replace(/ (AM|PM)$/, "");
  return ap(startMin) === ap(endMin) ? `${hm(startMin)} – ${hm(endMin)} ${ap(endMin)}` : `${clockWords(startMin)} – ${clockWords(endMin)}`;
}
