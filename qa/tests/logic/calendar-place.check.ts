// THE CALENDAR'S PLACING RULES (calendar part 1, 2026-11-09) — the month day timeline and the first open times, on
// made-up values. No database.
//   NODE_PATH="" npx tsx --tsconfig tsconfig.json qa/tests/logic/calendar-place.check.ts

import { busyOnDay, clashesFor, dayClockFrac, dayClockMinutesAt, dayClockStep, spanWords } from "@/lib/calendar/dayClock";
import { findOpenTimes } from "@/lib/calendar/openTimes";

let bad = 0;
function check(label: string, ok: boolean, extra?: unknown) {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${!ok && extra !== undefined ? ` :: ${JSON.stringify(extra)}` : ""}`);
}
const L = (d: number, h = 0, m = 0) => new Date(2026, 10, d, h, m); // November 2026, local time

// ── the timeline: the cursor's place is the time ──
check("a tall timeline snaps to quarter hours, a short one to half hours", dayClockStep(456) === 15 && dayClockStep(300) === 30);
check("the top is 7:00", dayClockMinutesAt(0, 456) === 420);
check("a third of the way down is 11:00", dayClockMinutesAt(152, 456) === 660);
check("nearest step, not the one above: 10:53 → 11:00, 10:52 → 10:45", dayClockMinutesAt(((10 * 60 + 52 - 420) / 720) * 456, 456) === 645 && dayClockMinutesAt(((10 * 60 + 53 - 420) / 720) * 456, 456) === 660);
check("the last start is a step before 7 PM", dayClockMinutesAt(456, 456) === 18 * 60 + 45 && dayClockMinutesAt(456, 300) === 18 * 60 + 30);
check("above the top is the first start", dayClockMinutesAt(-50, 456) === 420);
check("round trip: the line drawn for a time sits where the cursor picks it", [420, 555, 660, 975, 1110].every((m) => dayClockMinutesAt(dayClockFrac(m) * 456, 456) === m));

// ── the day's bookings and who would be double-booked ──
const rows = [
  { id: "v", start: L(14, 10), end: L(14, 11, 30), workers: ["olya"], who: "Olya", what: "Site visit" },
  { id: "j", start: L(13, 8), end: L(15, 17), workers: ["alex", "dan"], who: "Alex, Dan", what: "Deck build" },
  { id: "y", start: L(13, 9), end: L(13, 10), workers: ["olya"], who: "Olya", what: "Visit" },
  { id: "m", start: L(13, 9), end: L(14, 0), workers: ["alex"], who: "Alex", what: "Install" },
];
const busy = busyOnDay(L(14), rows);
check("the 14th holds the visit and the middle day of the 3-day build (not yesterday's, not one ending at midnight)", JSON.stringify(busy.map((b) => [b.id, b.startMin, b.endMin])) === JSON.stringify([["j", 0, 1440], ["v", 600, 690]]));
check("Olya at 10:30 clashes with her own visit", clashesFor(busy, 630, 690, ["olya"]).map((b) => b.id).join() === "v");
check("starting as her visit ends is no clash", clashesFor(busy, 690, 750, ["olya"]).length === 0);
check("Dan is on the 3-day build: any time that day clashes", clashesFor(busy, 900, 960, ["dan"]).map((b) => b.id).join() === "j");
check("Nelly isn't on either: no clash", clashesFor(busy, 630, 690, ["nelly"]).length === 0);
check("a card with nobody on it clashes with no one", clashesFor(busy, 630, 690, []).length === 0);
check("span words", spanWords(9 * 60, 240) === "9:00 AM – 1:00 PM" && spanWords(9 * 60 + 30, 60) === "9:30 – 10:30 AM" && spanWords(8 * 60, 3 * 24 * 60) === "8:00 AM → 3 days");

// ── first open times ──
const people = [{ id: "alex", name: "Alex" }, { id: "dan", name: "Dan" }];
const from = L(9, 7, 10); // Monday Nov 9, 7:10 AM
let slots = findOpenTimes({ from, people, busy: [], durationMin: 240 });
check("an empty week: the first three are Mon 8:00 for each, then Tue", slots.map((s) => `${s.name} ${s.start.getDate()} ${s.start.getHours()}:${s.start.getMinutes()}`).join(" | ") === "Alex 9 8:0 | Dan 9 8:0 | Alex 10 8:0");
slots = findOpenTimes({ from, people, busy: [{ personId: "alex", start: L(9, 8), end: L(9, 12) }, { personId: "dan", start: L(9, 7), end: L(9, 17) }], durationMin: 240 });
check("Alex busy till noon, Dan all day: Alex at 12:00, then Tuesday", slots[0].name === "Alex" && slots[0].start.getHours() === 12 && slots[1].start.getDate() === 10, slots.map((s) => `${s.name} ${s.start.toString().slice(4, 21)}`));
check("a 4-hour job never ends after 5 PM", findOpenTimes({ from, people, busy: [{ personId: "alex", start: L(9, 8), end: L(9, 13, 30) }, { personId: "dan", start: L(9, 8), end: L(9, 17) }], durationMin: 240, count: 1 })[0].start.getDate() === 10);
check("a later person's 8:00 beats an earlier person's 1:00 the same day", (() => {
  const s = findOpenTimes({ from, people, busy: [{ personId: "alex", start: L(9, 8), end: L(9, 13) }], durationMin: 60, count: 1 });
  return s[0].name === "Dan" && s[0].start.getHours() === 8;
})());
check("a company-wide block (a holiday) closes the day for everyone", findOpenTimes({ from, people, busy: [{ personId: null, start: L(9), end: L(10) }], durationMin: 60, count: 1 })[0].start.getDate() === 10);
check("Sundays are never offered", findOpenTimes({ from: L(14, 18), people: [people[0]], busy: [], durationMin: 60, count: 1 })[0].start.getDay() === 1);
check("nothing in the past: from 10:40 the first start is 11:00", (() => {
  const s = findOpenTimes({ from: L(9, 10, 40), people: [people[0]], busy: [], durationMin: 60, count: 1 })[0];
  return s.start.getHours() === 11 && s.start.getMinutes() === 0;
})());
check("a 3-day job starts at the day's start on a fully free stretch", (() => {
  const s = findOpenTimes({ from, people: [people[0]], busy: [{ personId: "alex", start: L(10, 9), end: L(10, 10) }], durationMin: 3 * 24 * 60, count: 1 })[0];
  return s.start.getDate() === 11 && s.start.getHours() === 8;
})());
check("nobody to send: no offers", findOpenTimes({ from, people: [], busy: [], durationMin: 60 }).length === 0);

console.log(bad ? `\n${bad} FAILED` : "\nall ok");
process.exit(bad ? 1 : 0);
