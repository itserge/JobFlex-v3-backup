// RECURRING REVENUE — MRR AND ARR (owner, 2026-11-02: "add to the investors link ARR and MRR — the numbers, statistics,
// and a projection if everything grows like it's growing today; make it smart"; chose today's pace with a likely
// range, and what Stripe bills). Pure, so the Figures page, the shared link, the deck and the PDF read the same, and
// the page's budget slider recomputes it in the browser.
//
// TODAY, counted. MRR is the MRR rule (components/v3/admin-subscribers/billing-metrics, the same as Admin → Revenue):
// active paid plans, a standing coupon taken off, no trials, no grants, test accounts out. ARR = MRR × 12. Back to the
// start day, a day at a time: the customers paying that day, each at what it is billed. The last 30 days: the MRR that
// started and the MRR that left.
//
// AHEAD, at today's pace, a day at a time: the signups of the last full week a day — in proportion to the daily ad
// budget when the slider moves it — converting at the measured trial-to-paid share once their trial is over, each
// billed what a new customer is billed today (the running trials' bills after their trial, else the paying customers'
// average); the trials running now convert at the same share on the day each ends. Churn is measured: of the
// customers whose first month is over, the share who left — taken off every month once one is due, and none before
// (said so). The likely range: the share's and the churn's 90% ranges together — the low side converts at the low
// share and loses at the high churn, the high side the other way.
import { addDays, daysBetween, dollars, longDate, wilson } from "@/lib/investorModel";

export interface RecurringDay {
  date: string;
  mrrCents: number;
  customers: number;
}

export interface RecurringInput {
  since: string;
  today: string;
  /** "stripe": the subscriptions as Stripe holds them; "record": Stripe not read — the platform's own record (list
   *  prices, no coupons), with why. */
  basis: "stripe" | "record";
  error: string | null;
  /** Today, the MRR rule: what is billed a month, and how many subscriptions it is the sum of. */
  mrrCents: number;
  customers: number;
  /** From the start day to today. */
  history: RecurringDay[];
  /** The window back from today (the last 30 days, or from the start day): MRR at its start, what started, what left. */
  moved: { from: string; days: number; startCents: number; newCents: number; newCount: number; lostCents: number; lostCount: number };
  /** The trials running now, by the day each ends (one past its end counts from tomorrow): their bills after the
   *  trial, together. */
  trialsEnding: Array<{ date: string; cents: number; count: number }>;
  /** Today's pace (lib/investorModel): signups a day over the last full week, the ad spend a day, the trial's days. */
  signupsPerDay: number;
  spendPerDayCents: number;
  trialDays: number;
  /** What a new customer is billed a month. */
  newCustomerCents: number;
  /** The measured trial-to-paid share: converted of ended. */
  converted: number;
  ended: number;
  /** Of the customers whose first month is over (`due`), how many left; the first renewal still to come when none is. */
  churn: { left: number; due: number; firstRenewal: string | null };
}

export interface RecurringPoint {
  date: string;
  mrrCents: number;
  lowCents: number;
  highCents: number;
}

export interface RecurringMilestone {
  arrCents: number;
  /** null = not within the search (5 years) at that pace. */
  date: string | null;
  early: string | null;
  late: string | null;
}

export interface RecurringAhead {
  spendPerDayCents: number;
  signupsPerDay: number;
  /** Today (index 0) to `days` ahead. */
  points: RecurringPoint[];
  /** The measured share and monthly churn the middle line uses (0–1); share null = none measured. */
  share: number | null;
  churn: number;
  /** The MRR one day of today's pace adds once its trials are over; and the ARR each ad dollar adds that way. */
  addPerDayCents: number | null;
  arrPerAdDollar: number | null;
  /** Where MRR levels off at this pace, losing the measured churn; null = no churn measured. */
  plateauCents: number | null;
  milestones: RecurringMilestone[];
}

export const RECURRING_AHEAD_DAYS = 365;
const SEARCH_DAYS = 5 * 365;
/** The ARR marks a milestone may be, in dollars. */
const MARKS = [10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000, 2_500_000, 5_000_000, 10_000_000, 25_000_000, 50_000_000];

/** The next three ARR marks above today's, and $1M whenever it is still ahead — the one investors ask about. */
export function milestoneMarks(arrCents: number): number[] {
  const ahead = MARKS.map((d) => d * 100).filter((c) => c > arrCents);
  const next = ahead.slice(0, 3);
  if (ahead.includes(100_000_000) && !next.includes(100_000_000)) next.push(100_000_000);
  return next;
}

/** MRR a day at a time from today, at share `q` and monthly churn `c`, with `signups` a day. */
function run(r: RecurringInput, q: number, c: number, signups: number, n: number): number[] {
  const keep = Math.pow(1 - Math.min(0.99, Math.max(0, c)), 1 / 30);
  const ending = new Map<string, number>();
  for (const t of r.trialsEnding) {
    const d = t.date > r.today ? t.date : addDays(r.today, 1);
    ending.set(d, (ending.get(d) ?? 0) + t.cents);
  }
  const perDay = signups * q * r.newCustomerCents;
  const out = [r.mrrCents];
  let m = r.mrrCents;
  for (let k = 1; k <= n; k++) {
    m = m * keep + q * (ending.get(addDays(r.today, k)) ?? 0) + (k > r.trialDays ? perDay : 0);
    out.push(m);
  }
  return out;
}

/** What today's pace brings — at today's daily ad budget, or `spendPerDayCents` with signups in proportion. */
export function recurringAhead(r: RecurringInput, spendPerDayCents: number = r.spendPerDayCents, days: number = RECURRING_AHEAD_DAYS): RecurringAhead {
  const signups = r.spendPerDayCents > 0 ? r.signupsPerDay * (spendPerDayCents / r.spendPerDayCents) : r.signupsPerDay;
  const share = r.ended > 0 ? r.converted / r.ended : null;
  const shareRange = wilson(r.converted, r.ended);
  const churn = r.churn.due > 0 ? r.churn.left / r.churn.due : 0;
  const churnRange = r.churn.due > 0 ? wilson(r.churn.left, r.churn.due) : null;
  const q = share ?? 0;
  const qLow = shareRange?.low ?? q;
  const qHigh = shareRange?.high ?? q;
  const cLow = churnRange?.low ?? churn;
  const cHigh = churnRange?.high ?? churn;
  const n = Math.max(days, SEARCH_DAYS);
  const mid = run(r, q, churn, signups, n);
  const low = run(r, qLow, cHigh, signups, n);
  const high = run(r, qHigh, cLow, signups, n);
  const r0 = Math.round;
  const points: RecurringPoint[] = [];
  for (let k = 0; k <= days; k++) points.push({ date: addDays(r.today, k), mrrCents: r0(mid[k]), lowCents: r0(Math.min(low[k], mid[k])), highCents: r0(Math.max(high[k], mid[k])) });
  const first = (line: number[], target: number) => {
    const k = line.findIndex((v) => v * 12 >= target);
    return k < 0 ? null : addDays(r.today, k);
  };
  const milestones = share === null ? [] : milestoneMarks(r.mrrCents * 12).map((arrCents) => ({ arrCents, date: first(mid, arrCents), early: first(high, arrCents), late: first(low, arrCents) }));
  const addPerDay = share === null ? null : signups * q * r.newCustomerCents;
  const keep = Math.pow(1 - Math.min(0.99, churn), 1 / 30);
  return {
    spendPerDayCents,
    signupsPerDay: Math.round(signups * 100) / 100,
    points,
    share,
    churn,
    addPerDayCents: addPerDay === null ? null : r0(addPerDay),
    arrPerAdDollar: addPerDay === null || spendPerDayCents <= 0 ? null : Math.round(((addPerDay * 12) / spendPerDayCents) * 10) / 10,
    plateauCents: addPerDay !== null && churn > 0 ? r0(addPerDay / (1 - keep)) : null,
    milestones,
  };
}

/** The point `days` ahead, or the last one drawn. */
export function aheadAt(a: RecurringAhead, days: number): RecurringPoint {
  return a.points[Math.min(days, a.points.length - 1)];
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const short = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const pct = (x: number) => `${Math.round(x * 100)}%`;
/** "$1,234", or "$1.2M" / "$48k" past ten thousand dollars — a milestone, a projection. */
export function bigDollars(cents: number): string {
  const d = cents / 100;
  if (Math.abs(d) >= 1_000_000) return `$${(d / 1_000_000).toFixed(d >= 10_000_000 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (Math.abs(d) >= 10_000) return `$${Math.round(d / 1000).toLocaleString("en-US")}k`;
  return dollars(cents);
}

/** "Nov 20" in today's year, "Jan 15, 2030" in another. */
export function dayOfYear(date: string, today: string): string {
  return `${short(date)}${date.slice(0, 4) !== today.slice(0, 4) ? `, ${date.slice(0, 4)}` : ""}`;
}

/** When a milestone comes, beside its day: its likely range — "likely Feb 17 – Apr 27, 2027" — or that it does not
 *  within five years. */
export function milestoneWhen(m: RecurringMilestone, today: string): string {
  if (!m.date) return `not within five years at today's pace${m.early ? ` (on the high side, ${dayOfYear(m.early, today)})` : ""}`;
  return m.early && m.early !== m.date ? `likely ${dayOfYear(m.early, today)} – ${m.late ? dayOfYear(m.late, today) : "after five years"}` : "";
}

/** The plain words above the chart. */
export function recurringStory(r: RecurringInput, a: RecurringAhead): { now: string; moved: string | null; pace: string | null; ahead: string | null; churn: string } {
  const arpa = r.customers > 0 ? Math.round(r.mrrCents / r.customers) : 0;
  const now = r.customers > 0
    ? `JobFlex bills ${dollars(r.mrrCents)} a month today — ${dollars(r.mrrCents * 12)} a year (ARR) — from ${plural(r.customers, "paying customer", "paying customers")}, ${dollars(arpa)} each on average${r.basis === "record" ? " (Stripe not read: the platform's own record, at list prices)" : ""}.`
    : `No customer is billed yet${r.basis === "record" ? " (Stripe not read: the platform's own record)" : ""}.`;
  const m = r.moved;
  const grew = m.startCents > 0 ? ` — ${r.mrrCents >= m.startCents ? "up" : "down"} ${Math.round((Math.abs(r.mrrCents - m.startCents) * 100) / m.startCents)}% from ${dollars(m.startCents)}` : "";
  const moved = m.newCount + m.lostCount > 0
    ? `${m.from === r.since ? `Since ${short(m.from)}` : `In the last ${m.days} days`}: +${dollars(m.newCents)} of MRR from ${plural(m.newCount, "new customer", "new customers")}${m.lostCount > 0 ? `, −${dollars(m.lostCents)} from ${plural(m.lostCount, "customer", "customers")} who left` : ", none lost"}${grew}.`
    : null;
  const pace = a.share === null || a.addPerDayCents === null
    ? null
    : `At today's pace — ${dollars(a.spendPerDayCents)} a day on ads, ${a.signupsPerDay} signups a day, ${pct(a.share)} of trials converting, each new customer billed ${dollars(r.newCustomerCents)} a month — each day of ads adds about ${dollars(a.addPerDayCents)} of MRR once its trials are over${a.arrPerAdDollar !== null ? `: every $1 of ads adds about $${a.arrPerAdDollar} of ARR` : ""}.`;
  const end = a.points[a.points.length - 1];
  const ahead = a.share === null
    ? `No trial has ended yet, so there is no measured rate to project with — the line ahead holds today's customers only.`
    : `In ${a.points.length - 1 >= 365 ? "12 months" : `${a.points.length - 1} days`} (${longDate(end.date)}): ${dollars(end.mrrCents)} a month, ${bigDollars(end.mrrCents * 12)} ARR — likely ${bigDollars(end.lowCents * 12)} to ${bigDollars(end.highCents * 12)}.`;
  const churn = r.churn.due > 0
    ? `Of the ${plural(r.churn.due, "customer", "customers")} whose first month is over, ${r.churn.left} left — ${pct(a.churn)} a month, taken off every month ahead${a.plateauCents !== null ? `; at this pace MRR levels off near ${bigDollars(a.plateauCents)} (${bigDollars(a.plateauCents * 12)} ARR) unless the budget grows` : ""}.`
    : `No customer has reached a renewal yet${r.churn.firstRenewal ? ` — the first comes ${daysBetween(r.today, r.churn.firstRenewal) <= 0 ? "today" : `on ${short(r.churn.firstRenewal)}`}` : ""} — so no churn is taken off; from then on, the measured share who leave is.`;
  return { now, moved, pace, ahead, churn };
}
