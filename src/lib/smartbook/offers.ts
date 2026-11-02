// SMARTBOOK · WHICH TIMES TO OFFER, AND THE SHORT REPLIES (2026-10-31). Pure.
//
// The booking engine (lib/booking availableSlots, lib/bookingBook deskAvailabilityFor) says what is open; this picks
// the few a text can carry so they are worth choosing between — the soonest, then another day in the other half of
// the day, then another day again — never a time held for another lead, and only what fits what the customer said
// ("mornings", "after 3", "Friday"). The replies a person types most ("2", "yes", "no", "yes 3") are read here
// without the model.
import { zonedInstant, zonedParts, type Slot } from "@/lib/booking";

export type DayPart = "morning" | "afternoon" | "evening";

/** What a customer said about when suits them, short of one exact time. */
export interface Preference {
  /** 0 = Sunday … 6 = Saturday. */
  days?: number[] | null;
  part?: DayPart | null;
  /** "HH:MM" on the company's clock. */
  after?: string | null;
  before?: string | null;
  /** "YYYY-MM-DD" on the company's clock, inclusive. */
  from?: string | null;
  to?: string | null;
}

export function partOf(d: Date, timeZone: string): DayPart {
  const h = zonedParts(d, timeZone).h;
  return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
}

const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map((x) => Number.parseInt(x, 10));
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
};
export const dayKey = (d: Date, timeZone: string) => {
  const p = zonedParts(d, timeZone);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
};

export function matchesPreference(s: Slot, pref: Preference | null | undefined, timeZone: string): boolean {
  if (!pref) return true;
  const p = zonedParts(s.startsAt, timeZone);
  if (pref.days?.length && !pref.days.includes(p.dow)) return false;
  if (pref.part && partOf(s.startsAt, timeZone) !== pref.part) return false;
  const at = p.h * 60 + p.min;
  if (pref.after && at < minutesOf(pref.after)) return false;
  if (pref.before && at >= minutesOf(pref.before)) return false;
  const day = dayKey(s.startsAt, timeZone);
  if (pref.from && day < pref.from) return false;
  if (pref.to && day > pref.to) return false;
  return true;
}

/** How many open days ahead the spreading looks before it settles for the soonest — a lead wants this week, not next month. */
const SPREAD_DAYS = 5;

/**
 * The times to offer. `held` / `exclude` are start instants (ms) not to offer: held for another lead, or already
 * offered and turned down. Fewer than `count` come back when fewer fit; none when nothing fits the preference.
 */
export function pickOffers(input: { slots: readonly Slot[]; count: number; timeZone: string; held?: ReadonlySet<number>; exclude?: ReadonlySet<number>; prefer?: Preference | null }): Slot[] {
  const { timeZone } = input;
  const pool = [...input.slots]
    .filter((s) => !input.held?.has(s.startsAt.getTime()) && !input.exclude?.has(s.startsAt.getTime()) && matchesPreference(s, input.prefer, timeZone))
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  if (!pool.length) return [];
  const days = [...new Set(pool.map((s) => dayKey(s.startsAt, timeZone)))];
  const near = new Set(days.slice(0, SPREAD_DAYS));
  const picks: Slot[] = [pool[0]];
  while (picks.length < input.count) {
    const usedDays = new Set(picks.map((s) => dayKey(s.startsAt, timeZone)));
    const lastPart = partOf(picks[picks.length - 1].startsAt, timeZone);
    const taken = new Set(picks.map((s) => s.startsAt.getTime()));
    let best: Slot | null = null;
    let bestScore = -1;
    for (const s of pool) {
      if (taken.has(s.startsAt.getTime())) continue;
      const day = dayKey(s.startsAt, timeZone);
      // Inside the first open days: a new day counts twice, the other half of the day once; the soonest breaks a tie.
      const score = near.has(day) ? (usedDays.has(day) ? 0 : 2) + (partOf(s.startsAt, timeZone) !== lastPart ? 1 : 0) : -0.5;
      if (score > bestScore) {
        best = s;
        bestScore = score;
      }
    }
    if (!best) break;
    picks.push(best);
  }
  return picks.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

/** The instant a customer's "2026-11-08 09:00" names on the company's clock. Null when it can't be read. */
export function proposalInstant(day: string | null | undefined, time: string | null | undefined, timeZone: string): Date | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day ?? "");
  const t = /^(\d{1,2}):(\d{2})$/.exec(time ?? "");
  if (!d || !t) return null;
  const h = +t[1];
  const min = +t[2];
  if (h > 23 || min > 59) return null;
  const at = zonedInstant(+d[1], +d[2], +d[3], h, min, timeZone);
  return Number.isFinite(at.getTime()) ? at : null;
}

/** The open slot that starts at this instant, if there is one. */
export function slotAt(slots: readonly Slot[], at: Date): Slot | null {
  return slots.find((s) => s.startsAt.getTime() === at.getTime()) ?? null;
}

// ── the short replies ─────────────────────────────────────────────────────────

export type QuickRead = { kind: "pick"; n: number } | { kind: "yes"; ref: number | null } | { kind: "no"; ref: number | null };

const YES = /^(y|yes|yeah|yea|yep|yup|ok|okay|k|sure|confirm|confirmed|book it|sounds good|perfect|works|that works|great|si|sí|claro|da|да|👍)$/;
const NO = /^(n|no|nope|nah|no thanks|can't|cant|cannot|doesn't work|doesnt work|not available|нет|👎)$/;

/**
 * "2" (a pick among `offered`), "yes" / "yes 3" / "yes #3", "no" / "no 3". Anything longer or unsure is the
 * model's: null. A bare number beyond the offered count is not a pick.
 */
export function quickRead(raw: string, offered: number): QuickRead | null {
  const text = raw.toLowerCase().normalize("NFKC").replace(/\s+/g, " ").trim().replace(/[.!,;]+$/g, "").trim();
  if (!text) return null;
  const pick = /^(?:#|number\s*|option\s*)?([1-9])$/.exec(text);
  if (pick) {
    const n = +pick[1];
    return n >= 1 && n <= offered ? { kind: "pick", n } : null;
  }
  const withRef = /^(.*?)(?:\s*#?\s*(\d{1,4}))?$/.exec(text);
  const word = (withRef?.[1] ?? text).trim();
  const ref = withRef?.[2] ? +withRef[2] : null;
  if (YES.test(word)) return { kind: "yes", ref };
  if (NO.test(word)) return { kind: "no", ref };
  return null;
}

/**
 * A bare hour — "9", "9am", "2:30 pm", "14:00" — as "HH:MM", optionally "#n" after it. A bare 1–6 with no am/pm is
 * read as the afternoon (nobody books a visit at 3 in the morning); 7–11 as the morning.
 */
export function quickTime(raw: string): { time: string; ref: number | null } | null {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?(?:\s*#\s*(\d{1,4}))?$/.exec(raw.toLowerCase().trim().replace(/[!]+$/g, "").trim());
  if (!m) return null;
  let h = +m[1];
  const min = m[2] ? +m[2] : 0;
  const half = m[3]?.[0];
  if (h > 23 || min > 59 || (half && (h < 1 || h > 12))) return null;
  if (half === "p" && h < 12) h += 12;
  else if (half === "a" && h === 12) h = 0;
  else if (!half && h >= 1 && h <= 6) h += 12;
  return { time: `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`, ref: m[4] ? +m[4] : null };
}
