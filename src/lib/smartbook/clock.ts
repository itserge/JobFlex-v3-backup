// SMARTBOOK · ITS CLOCK (2026-10-31). Pure.
//
// A customer is texted 8 AM – 9 PM on the company's clock (the same quiet hours every client text keeps,
// lib/sms/rulesEngine); a text that would land at night waits for 8 AM. "Business hours" for the waits — the nudge
// after 4 hours, the reminder after 1 — count only 8 AM – 8 PM, so a lead at 7 PM is nudged the next morning, not at
// 11 PM.
import { zonedInstant, zonedParts } from "@/lib/booking";

const QUIET_FROM = 21;
const QUIET_TO = 8;
const DAY_FROM = 8;
const DAY_TO = 20;

export function isQuiet(now: Date, timeZone: string): boolean {
  const h = zonedParts(now, timeZone).h;
  return h >= QUIET_FROM || h < QUIET_TO;
}

/** 8 AM on the company's clock: today when it is still ahead, else tomorrow. */
export function nextMorning(now: Date, timeZone: string): Date {
  const p = zonedParts(now, timeZone);
  const today = zonedInstant(p.y, p.m, p.d, QUIET_TO, 0, timeZone);
  return today.getTime() > now.getTime() ? today : zonedInstant(p.y, p.m, p.d + 1, QUIET_TO, 0, timeZone);
}

/** `hours` of business time after `now` (8 AM – 8 PM, every day). */
export function businessAfter(now: Date, hours: number, timeZone: string): Date {
  let left = Math.max(0, hours) * 3600000;
  let at = now;
  for (let guard = 0; guard < 30; guard++) {
    const p = zonedParts(at, timeZone);
    const open = zonedInstant(p.y, p.m, p.d, DAY_FROM, 0, timeZone);
    const close = zonedInstant(p.y, p.m, p.d, DAY_TO, 0, timeZone);
    if (at.getTime() < open.getTime()) at = open;
    if (at.getTime() >= close.getTime()) {
      at = zonedInstant(p.y, p.m, p.d + 1, DAY_FROM, 0, timeZone);
      continue;
    }
    const room = close.getTime() - at.getTime();
    if (left <= room) return new Date(at.getTime() + left);
    left -= room;
    at = zonedInstant(p.y, p.m, p.d + 1, DAY_FROM, 0, timeZone);
  }
  return new Date(now.getTime() + hours * 3600000);
}

/** "Saturday, November 8, 2026, 9:05 AM" — the model's "now". */
export function nowWords(now: Date, timeZone: string): string {
  return now.toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone });
}
