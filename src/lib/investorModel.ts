// THE INVESTOR FIGURES (owner, 2026-10-06): "how much we spend on ads, how
// many users we get on free trial … and the main thing: how soon we cover the
// ad spend." Pure: dates and cents in, figures and a day-by-day curve out. The
// server gathers the rows (lib/investors); this decides what they mean, and
// the QA script pins every rule.
//
// MEASURED, NOT ASSUMED (owner, 2026-10-24: "we don't know how many users will
// pay after sign-up, only an assumption — remove the assumptions and use the
// current rate of how many companies stay after their trials"). The share of
// trials that pay is no longer the owner's 60%, nor "if every trial pays", nor
// the behaviour model's guess: it is the RATE MEASURED on the trials that have
// already ended — of those, the share paying today — with its 90% range for
// that many trials. The trials running now are expected to pay at that rate.
// No trial ended yet = no rate, and nothing is predicted from it.
//
// THE CURVE. Each day from the ad launch to the horizon has two running totals:
//   · ad spend — every dollar booked so far, then the last full week's pace;
//   · revenue — each paying account earns its monthly price a thirtieth a day
//     from the day it started paying; each running trial, at the measured
//     rate, from the day its trial ends; signups still to come arrive at the
//     last week's pace and pay, at the measured rate, after their trial.
// The break-even is the first day revenue stands at or above the spend.
// Revenue is at LIST price per month, not Stripe's collections (the page
// shows those beside it): discounts, taxes and churn are not modelled.

/** Where an ad dollar went. Pure, so the admin page (a client component) can list it. */
export const PLATFORMS = ["meta", "google", "tiktok", "other"] as const;
export type SpendPlatform = (typeof PLATFORMS)[number];
export const PLATFORM_LABEL: Record<SpendPlatform, string> = { meta: "Meta (Facebook · Instagram)", google: "Google", tiktok: "TikTok", other: "Other" };

export interface SpendDay {
  /** YYYY-MM-DD, in the page's zone. */
  date: string;
  cents: number;
}
/** How a trial started (owner, 2026-10-13): with a card up front, or with no card (lib/trialState's record). */
export type TrialCohort = "card" | "nocard";
export const COHORT_LABEL: Record<TrialCohort, string> = { card: "With a card", nocard: "No card" };
export interface PayingAccount {
  /** The day it started paying, YYYY-MM-DD. */
  startedAt: string;
  monthlyCents: number;
  /** The day the account signed up (for the cohort split); defaults to startedAt. */
  signedUpAt?: string;
  cohort?: TrialCohort;
  /** Paying from before the start day (owner, 2026-10-13: "add the users already paying before this period to
   *  With a card, paying"): counted as a paying account — its revenue from the start day on, in the run rate, the
   *  curve and the payback — but not as a signup of the period: the ads did not bring it. */
  preexisting?: boolean;
  /** Started on a free trial with NO card and pays now (owner, 2026-10-25: "whoever signed up on a free trial with
   *  no card and pays, add them to the paying"): counted as paying — the run rate, the curve, what came in — but
   *  not as a signup of the card days, not in the trial-to-paid rate, not in the cost of a customer: the card
   *  days' ads did not bring it. */
  fromNoCard?: boolean;
}
/** HOW A TRIAL ENDED (owner, 2026-10-25: "only deduct who cancelled during the trial; if they converted, keep them;
 *  show separately when the trial ended and they cancelled, or the payment failed, and how many came back later"). */
export type TrialOutcome =
  /** Paid when the trial ended (the first payment within a day of its end). */
  | "paid"
  /** Paid, but later: the trial ended without a payment and they paid days after (a retry that went through, a card
   *  put in later, a come-back). Converted. */
  | "came-back"
  /** Canceled before the trial ended, never paid. */
  | "canceled"
  /** The trial ended and no payment ever went through (the card failed and was given up, or no card). */
  | "unpaid"
  /** The trial ended on a paid plan whose first charge is still being retried (up to RETRY_DAYS after the end):
   *  CONVERTED (owner, 2026-10-25: "keep the card-failed ones as converted for 2 weeks; after 2 weeks not charged,
   *  deduct it"). Past the window with no payment it reads "unpaid"; a payment after that, "came-back". */
  | "retrying";
/** How long a failing first charge still counts as converted: Stripe's default retry window, two weeks. */
export const RETRY_DAYS = 14;
export const CONVERTED: ReadonlySet<TrialOutcome> = new Set(["paid", "came-back", "retrying"]);
export interface EndedTrial {
  /** The day it signed up. */
  date: string;
  cohort?: TrialCohort;
  outcome: TrialOutcome;
  /** Paying today (a converted one may have left since). */
  payingNow: boolean;
  /** "came-back": days from the trial's end to the first payment. */
  afterDays?: number;
}
export interface TrialAccount {
  createdAt: string;
  /** The day the trial ends (pays from then), YYYY-MM-DD; null = unknown, read as createdAt + trialDays. */
  endsAt: string | null;
  /** null = no price on record; counted, not valued. */
  monthlyCents: number | null;
  cohort?: TrialCohort;
}
/** One flip of the owner's switch: from this day on, new signups got this. */
export interface PolicySpan {
  from: string;
  mode: TrialCohort;
}
/** What the owner sets — none of it a guess at who pays (2026-10-24). */
export interface ModelSettings {
  /** How far the curve runs past today: how far the chart looks, not a figure. */
  horizonDays: number;
  /** A trial's length, days — used only when no running trial has its end on record. */
  trialDays: number;
  /** The daily ad budget, ALL ads together (owner, 2026-10-06: "we have a per-day
   *  budget set and it's getting used") — counted as spent every day from
   *  `budgetFrom` to today on which nothing was booked by hand; null = none. */
  dailyBudgetCents: number | null;
  /** The day the budget started; null = the start day. */
  budgetFrom: string | null;
}
export interface ModelInput {
  since: string;
  today: string;
  spend: SpendDay[];
  paying: PayingAccount[];
  trials: TrialAccount[];
  /** Trials that ended with no payment (ran out, canceled, a payment that failed) — with the paying, the measured rate. */
  lapsed: number;
  /** The day each lapsed trial signed up: a signup like any other, so the pace the measured rate is applied to
   *  counts the ones that will not stay too. Absent = not known (the pace then counts trials and paying). */
  lapsedSignups?: Array<{ date: string; cohort?: TrialCohort }>;
  /** How each ended trial of the period ended — the paying ones and the lapsed ones, told apart (lib/investors reads
   *  Stripe's payments for it). When given, the rate is read from it; absent = paying now ÷ paying + lapsed. */
  outcomes?: EndedTrial[];
  settings: ModelSettings;
  /** The spend per day from tomorrow; absent = the last full week's pace. Set by the cohort cut (a cohort no
   *  new signup gets any more spends nothing forward). */
  forwardSpendCents?: number | null;
  /** Unique visitors since the launch, when the analytics answered. */
  visitors: number | null;
  /** The cohort split (owner, 2026-10-13): lapsed trials by how they started, the signups' days by cohort, the
   *  switch's recorded flips, and what a new signup gets today. */
  cohorts?: {
    lapsed: Record<TrialCohort, number>;
    /** Every counted signup — a trial, a paying account, a lapsed trial — by the day it signed up. */
    signups: Array<{ date: string; cohort: TrialCohort }>;
    policy: PolicySpan[];
    current: TrialCohort;
  };
}

export interface CurvePoint {
  date: string;
  /** Running totals from the start day: what went out on ads, what came in at list price (trials at the measured rate). */
  spendCents: number;
  revenueCents: number;
  /** Past today: projected, not booked. */
  projected: boolean;
  /** That day alone. */
  spendDayCents: number;
  spendSource: "booked" | "budget" | "projected" | "none";
  /** The monthly run-rate on that day: what a month brings at that day's accounts. */
  mrrCents: number;
  /** Accounts: paying (expected at the measured rate, fractional, once a trial is over), and signed up so far. */
  paying: number;
  signups: number;
  /** What the trials (running and still to come) bring that day were EVERY one to convert — a month in, the running
   *  total, accounts. Revenue is linear in the rate, so a what-if rate reads off these (whatIfPoint, 2026-10-25). */
  trialsMrrAllCents: number;
  trialsRevenueAllCents: number;
  trialsPayingAll: number;
}

export interface InvestorFigures {
  since: string;
  today: string;
  daysLive: number;
  spend: {
    totalCents: number;
    perDayRecentCents: number;
    perDayProjectedCents: number;
    daysWithSpend: number;
    lastDate: string | null;
    /** The daily budget in force, from when, and how many days it filled vs were booked by hand. */
    dailyBudgetCents: number | null;
    budgetFrom: string | null;
    budgetDays: number;
    bookedDays: number;
  };
  visitors: number | null;
  signups: number;
  /** The trials running now: how many, their monthly list price together, the average, and the trial length in use. */
  trials: { count: number; priced: number; mrrCents: number; avgMonthlyCents: number; lengthDays: number };
  paying: {
    count: number; mrrCents: number; arrCents: number; revenueToDateCents: number;
    /** Of them, the ones paying from before the start day, and their monthly list price. */
    preexisting: number; preexistingMrrCents: number;
    /** The ones the period brought (signed up since the start day), and their monthly list price. */
    won: number; wonMrrCents: number;
    /** The ones that started on a free trial with no card, and their monthly list price. */
    fromNoCard: number; fromNoCardMrrCents: number;
  };
  lapsed: number;
  /** THE MEASURED RATE (2026-10-24): of the trials that have ended, the share that converted to a paid plan (paid on
   *  time or later — one that left since still converted — or a first charge inside its two-week retry window), and
   *  its 90% range (Wilson) for that many trials. pct null = no trial has ended yet. */
  rate: { paid: number; ended: number; pct: number | null; lowPct: number | null; highPct: number | null; /** The exact share (0–1) the curve uses; null = none measured. */ share: number | null };
  /** How the ended trials ended (2026-10-25) — the page shows only how many came back later (owner: "no breakdown,
   *  just the count of how many came back later"); the rest is kept for the rate and the QA. null = not read. */
  outcomes: {
    paidAtEnd: number;
    cameBack: number;
    /** The middle number of days between a come-back's trial end and its first payment. */
    cameBackDays: number | null;
    /** Converted (either way), not paying today. */
    leftAfterPaying: number;
    canceled: number;
    unpaid: number;
    retrying: number;
  } | null;
  /** The running trials at the measured rate: how many will pay (and the range), and what they add a month. */
  expected: { payers: number | null; payersLow: number | null; payersHigh: number | null; mrrCents: number | null; mrrWithPayingCents: number };
  unit: {
    costPerVisitorCents: number | null;
    costPerSignupCents: number | null;
    /** Spend ÷ the paying customers the period brought — counted, not expected — for the signups whose trial is over:
     *  the spend up to `matured.through` ÷ the customers those signups became (2026-11-02). */
    costPerPayingCents: number | null;
    /** Spend ÷ (those customers + the running trials expected to convert at the measured rate) — EXPECTED, said so
     *  (owner, 2026-10-25: "cost per lead to make better stats" → the honest kind: per lead, and per customer once the
     *  trials already paid for convert). null with no measured rate. */
    costPerCustomerExpectedCents: number | null;
    visitorToSignupPct: number | null;
    signupsPerDay: number;
    /** That same spend ÷ the monthly list price of those customers — months for them to earn the spend back. */
    paybackMonths: number | null;
    /** THE SIGNUPS WHOSE TRIAL IS OVER (owner, 2026-11-02: "during the 7 days of the trial we already spent on ads … it
     *  is divided per paying customers upfront"): the last trial's worth of spend brought trials still running, so the
     *  counted cost reads the signups through `through` alone — the spend up to that day, the customers they became
     *  and those customers' monthly list price. through null = no trial of the period is over yet. */
    matured: { through: string | null; spendCents: number; won: number; wonMrrCents: number };
    /** Revenue to date at list price ÷ spend to date. */
    returnToDatePct: number | null;
  };
  breakEven: { date: string | null; daysFromToday: number | null; withinHorizon: boolean };
  /** A month in on the first day against today (2026-10-25: "3.3× in 17 days"): the multiple is null from $0. */
  growth: { fromCents: number; toCents: number; days: number; multiple: number | null };
  curve: CurvePoint[];
  /** What a customer costs, from the first day to `COST_AHEAD_DAYS` past today (2026-11-02, customerCostSeries). */
  cost: CustomerCost;
}

/* ── WHAT A CUSTOMER COSTS, FROM THE FIRST DAY (owner, 2026-11-02: "a projection at the current spending and the
   customers already converted — how the cost per customer gets reduced as we go; show the current position, from the
   beginning"). Two figures a day, both counted the way "Per paying customer" is — on the signups whose trial is over,
   so no ad dollar waits on trials still running:
     · to win — the ads up to that cut ÷ the customers those signups became;
     · after paying — the same ads less what those customers have paid by that day (list price), ÷ the same customers.
       It falls as they pay; at $0 the ads' own customers have paid back every counted ad dollar.
   Up to today: counted (paying today). Past today, at today's pace: the ads at the last full week's spend a day, the
   running trials and the signups still to come (the last week's pace) converting at the measured rate, each paying
   its list price from its trial's end. No churn is modelled. Week by week: each week's ads ÷ the customers its
   signups became. ── */

/** How far past today the cost of a customer is drawn. */
export const COST_AHEAD_DAYS = 90;

export interface CostPoint {
  date: string;
  /** The signups counted on that day: up to `through` — the day less the trial and one day. */
  through: string;
  /** Their ads, the customers they became (fractional past today: expected) and what those customers paid by that day. */
  spendCents: number;
  customers: number;
  paidCents: number;
  /** Ads ÷ customers: what a customer cost to win. null = no customer yet. */
  grossCents: number | null;
  /** (Ads − what they paid) ÷ customers: what a customer still costs after paying. Below zero: paid back. */
  netCents: number | null;
  projected: boolean;
}
export interface CostWeek {
  /** Seven signup days from the start day (the last may still be running). */
  from: string;
  to: string;
  spendCents: number;
  /** Paying today; and the trials of the week still running, at the measured rate. */
  paying: number;
  expected: number;
  /** Ads ÷ (paying + expected); null = no customer (or no measured rate for a week still in trial). */
  costCents: number | null;
  /** counted = every trial of the week is over; trial = some still running (that part expected). */
  state: "counted" | "trial";
}
export interface CustomerCost {
  aheadDays: number;
  points: CostPoint[];
  weeks: CostWeek[];
  /** At today's pace: a new customer's cost (ads a day ÷ customers a day), what a month of theirs pays, and the months it takes. */
  pace: { costCents: number | null; spendPerDayCents: number; signupsPerDay: number; customersPerDay: number | null; monthlyCents: number; paybackMonths: number | null };
  /** The first day from today on that "after paying" reaches $0, searched as far as the horizon; null = not by then. */
  paidBack: { date: string | null; daysFromToday: number | null; searchedDays: number };
}

const DAY_MS = 86_400_000;
export const dayOf = (iso: string) => iso.slice(0, 10);
const toMs = (date: string) => Date.parse(`${date}T00:00:00Z`);
const toDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (date: string, n: number) => toDate(toMs(date) + n * DAY_MS);
export const daysBetween = (from: string, to: string) => Math.round((toMs(to) - toMs(from)) / DAY_MS);
const r0 = (n: number) => Math.round(n);

/** The recent pace of something that happened on `dates`: per day over the last `window` days (or since the launch, when younger). */
export function perDay(dates: readonly string[], since: string, today: string, window = 7): number {
  const live = Math.max(1, daysBetween(since, today) + 1);
  const span = Math.min(window, live);
  const from = addDays(today, -(span - 1));
  const n = dates.filter((d) => d >= from && d <= today).length;
  return n / span;
}

/** The 90% range (Wilson score interval) of a share measured as `k` of `n` — what that many trials can tell. */
export function wilson(k: number, n: number, z = 1.645): { low: number; high: number } | null {
  if (!(n > 0)) return null;
  const p = Math.min(1, Math.max(0, k / n));
  const z2 = z * z;
  const centre = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

/** The middle value; null for none. */
const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** One customer of the ads (or the measured share of one): the signup day it belongs to, and the day it pays from. */
interface CostStream { cohort: string; weight: number; start: string; monthlyCents: number; counted: boolean }

/** What a customer costs, day by day and week by week (CustomerCost). Pure; investorFigures hands it its parts. */
export function customerCostSeries(a: {
  since: string;
  today: string;
  trialDays: number;
  horizonDays: number;
  spendByDay: ReadonlyMap<string, number>;
  perDayProjectedCents: number;
  won: ReadonlyArray<PayingAccount>;
  /** The running trials, each with the day it pays from if it converts. */
  trials: ReadonlyArray<{ createdAt: string; end: string; monthlyCents: number | null }>;
  share: number | null;
  signupsPerDay: number;
  /** What a customer still to come pays a month: the running trials' average, else the paying ones'. */
  monthlyCents: number;
}): CustomerCost {
  const { since, today, share } = a;
  const cut = (d: string) => addDays(d, -(a.trialDays + 1));
  const through = cut(today);
  const searchTo = addDays(today, Math.max(COST_AHEAD_DAYS, a.horizonDays));
  const cohortOf = (p: PayingAccount) => dayOf(p.signedUpAt ?? p.startedAt);
  // Paying today (counted), then — past today only — the running trials and the signups still to come at the share.
  const streams: CostStream[] = a.won.map((p) => ({ cohort: cohortOf(p), weight: 1, start: dayOf(p.startedAt), monthlyCents: p.monthlyCents, counted: true }));
  const customersPerDay = share === null ? null : a.signupsPerDay * share;
  if (share !== null) {
    for (const t of a.trials) streams.push({ cohort: dayOf(t.createdAt), weight: share, start: t.end, monthlyCents: t.monthlyCents ?? a.monthlyCents, counted: false });
    if (customersPerDay) for (let c = addDays(today, 1); c <= cut(searchTo); c = addDays(c, 1)) streams.push({ cohort: c, weight: customersPerDay, start: addDays(c, a.trialDays), monthlyCents: a.monthlyCents, counted: false });
  }
  // The ads up to each signup day: booked or budgeted to today, then the last full week's pace.
  const spendTo = new Map<string, number>();
  let run = 0;
  for (let d = since; d <= cut(searchTo); d = addDays(d, 1)) {
    run += d <= today ? (a.spendByDay.get(d) ?? 0) : a.perDayProjectedCents;
    spendTo.set(d, run);
  }
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const at = (date: string): CostPoint => {
    const c = cut(date);
    const projected = date > today;
    const spend = c < since ? 0 : (spendTo.get(c) ?? 0);
    let customers = 0;
    let paid = 0;
    for (const s of streams) {
      if (s.cohort > c || (!projected && !s.counted)) continue;
      customers += s.weight;
      const days = daysBetween(s.start, date) + 1;
      if (days > 0) paid += (s.weight * s.monthlyCents * days) / 30;
    }
    return {
      date, through: c, spendCents: r0(spend), customers: r1(customers), paidCents: r0(paid),
      grossCents: customers > 0 ? r0(spend / customers) : null,
      netCents: customers > 0 ? r0((spend - paid) / customers) : null,
      projected,
    };
  };
  const points: CostPoint[] = [];
  for (let d = since; d <= addDays(today, COST_AHEAD_DAYS); d = addDays(d, 1)) points.push(at(d));
  // Paid back: the first day from today on that the ads' own customers have paid every counted ad dollar.
  let paidBack: string | null = null;
  for (let d = today; d <= searchTo && paidBack === null; d = addDays(d, 1)) {
    const p = d <= addDays(today, COST_AHEAD_DAYS) ? points[daysBetween(since, d)] : at(d);
    if (p.spendCents > 0 && p.netCents !== null && p.netCents <= 0) paidBack = d;
  }
  // Week by week, from the start day: each week's ads ÷ the customers its signups became.
  const weeks: CostWeek[] = [];
  for (let from = since; from <= today; from = addDays(from, 7)) {
    const to = addDays(from, 6);
    let spend = 0;
    for (let d = from; d <= to && d <= today; d = addDays(d, 1)) spend += a.spendByDay.get(d) ?? 0;
    const inWeek = (day: string) => day >= from && day <= to;
    const paying = a.won.filter((p) => inWeek(cohortOf(p))).length;
    const running = a.trials.filter((t) => inWeek(dayOf(t.createdAt))).length;
    const expected = share === null ? 0 : running * share;
    const state: CostWeek["state"] = to <= through && running === 0 ? "counted" : "trial";
    const n = paying + expected;
    weeks.push({ from, to, spendCents: spend, paying, expected: r1(expected), costCents: (state === "trial" && share === null) || n <= 0 ? null : r0(spend / n), state });
  }
  const paceCost = customersPerDay && a.perDayProjectedCents > 0 ? r0(a.perDayProjectedCents / customersPerDay) : null;
  return {
    aheadDays: COST_AHEAD_DAYS,
    points,
    weeks,
    pace: {
      costCents: paceCost,
      spendPerDayCents: a.perDayProjectedCents,
      signupsPerDay: Math.round(a.signupsPerDay * 100) / 100,
      customersPerDay: customersPerDay === null ? null : Math.round(customersPerDay * 100) / 100,
      monthlyCents: a.monthlyCents,
      paybackMonths: paceCost !== null && a.monthlyCents > 0 ? r1(paceCost / a.monthlyCents) : null,
    },
    paidBack: { date: paidBack, daysFromToday: paidBack ? daysBetween(today, paidBack) : null, searchedDays: daysBetween(today, searchTo) },
  };
}

export function investorFigures(input: ModelInput): InvestorFigures {
  const { since, today, settings: a } = input;
  const horizon = Math.max(30, Math.min(730, Math.round(a.horizonDays) || 180));
  const daysLive = Math.max(1, daysBetween(since, today) + 1);
  // The trial length: what the running trials show (their end on record), else the setting.
  const shown = median(input.trials.filter((t) => t.endsAt).map((t) => daysBetween(dayOf(t.createdAt), dayOf(t.endsAt as string))).filter((d) => d > 0));
  const trialDays = Math.max(1, Math.min(90, Math.round(shown ?? a.trialDays) || 7));
  // Paces are read over FULL days: today is still running (Meta's figure for it is partial).
  const lastFull = daysLive > 1 ? addDays(today, -1) : today;

  // ── spend: the days booked by hand (or by Meta), then the daily budget on every other day
  const booked = new Map<string, number>();
  for (const s of input.spend) if (s.date >= since && s.date <= today && s.cents > 0) booked.set(s.date, (booked.get(s.date) ?? 0) + s.cents);
  const dailyBudget = a.dailyBudgetCents !== null && Number.isFinite(a.dailyBudgetCents) && a.dailyBudgetCents > 0 ? r0(a.dailyBudgetCents) : null;
  const budgetFrom = dailyBudget !== null ? (a.budgetFrom && a.budgetFrom > since ? a.budgetFrom : since) : null;
  const spendByDay = new Map<string, number>(booked);
  const spendSource = new Map<string, "booked" | "budget">([...booked.keys()].map((d) => [d, "booked" as const]));
  let budgetDays = 0;
  if (dailyBudget !== null && budgetFrom !== null) {
    for (let d = budgetFrom; d <= today; d = addDays(d, 1)) if (!booked.has(d)) { spendByDay.set(d, dailyBudget); spendSource.set(d, "budget"); budgetDays++; }
  }
  const totalSpend = [...spendByDay.values()].reduce((x, y) => x + y, 0);
  const recentFrom = addDays(lastFull, -6) > since ? addDays(lastFull, -6) : since;
  const recentDays = Math.max(1, daysBetween(recentFrom, lastFull) + 1);
  const recentSpend = [...spendByDay].filter(([d]) => d >= recentFrom && d <= lastFull).reduce((x, [, c]) => x + c, 0);
  const perDayRecent = r0(recentSpend / recentDays);
  // Tomorrow on: what the last full week spent a day (the cohort cut stops a cohort no signup gets any more).
  const perDayProjected = input.forwardSpendCents !== undefined && input.forwardSpendCents !== null && Number.isFinite(input.forwardSpendCents) ? Math.max(0, r0(input.forwardSpendCents)) : perDayRecent;
  const spendDates = [...spendByDay.keys()].sort();

  // ── trials and paying
  const trials = input.trials;
  const priced = trials.filter((t) => t.monthlyCents !== null);
  const trialsMrr = priced.reduce((x, t) => x + (t.monthlyCents ?? 0), 0);
  const avgTrialMonthly = priced.length ? r0(trialsMrr / priced.length) : 0;
  const payingMrr = input.paying.reduce((x, p) => x + p.monthlyCents, 0);
  // Revenue earned IN the period: an account paying from before the start day earns from the start day.
  const revenueToDate = input.paying.reduce((x, p) => x + r0((p.monthlyCents * Math.max(0, daysBetween(p.startedAt > since ? p.startedAt : since, today) + 1)) / 30), 0);
  // The period's own signups: the ads did not bring an account that was paying before the start day.
  const won = input.paying.filter((p) => !p.preexisting && !p.fromNoCard);
  const fromNoCard = input.paying.filter((p) => p.fromNoCard);
  const wonMrr = won.reduce((x, p) => x + p.monthlyCents, 0);
  const preexisting = input.paying.filter((p) => p.preexisting);
  const signups = trials.length + won.length + input.lapsed;
  const signupDates = [...trials.map((t) => t.createdAt), ...won.map((p) => p.signedUpAt ?? p.startedAt), ...(input.lapsedSignups ?? []).map((x) => x.date)].map(dayOf).sort();
  const signupsPerDay = perDay(signupDates, since, lastFull);

  // ── THE MEASURED RATE: of the trials that have ended, the share paying today. Nothing ended = no rate, and
  // nothing is expected of the running trials (the curve then counts the paying accounts alone).
  // Read from how each trial ended when that is known: converted = on a paid plan — paid on time or later (one that
  // left since still converted), or a first charge still inside its two-week retry window. Else: paying today ÷
  // paying + lapsed.
  const oc = input.outcomes ?? null;
  const count = (k: TrialOutcome) => (oc ?? []).filter((o) => o.outcome === k).length;
  const converted = oc ? oc.filter((o) => CONVERTED.has(o.outcome)).length : won.length;
  const ended = oc ? oc.length : won.length + input.lapsed;
  const share = ended > 0 ? converted / ended : null;
  const range = wilson(converted, ended);
  const pct = share ?? 0;
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const expectedMrr = share === null ? null : r0(trialsMrr * share);

  // ── the curve
  const trialEnd = (t: TrialAccount) => {
    const end = t.endsAt ? dayOf(t.endsAt) : addDays(dayOf(t.createdAt), trialDays);
    // A trial past its end that is still a trial pays, if it pays, from today.
    return end < today ? today : end;
  };
  const curve: CurvePoint[] = [];
  let spendRun = 0;
  let revenueRun = 0;
  let trialsRun = 0;
  const last = addDays(today, horizon);
  const futureCohorts: number[] = []; // monthly cents from each future day's signups, were every one to pay
  for (let d = since; d <= last; d = addDays(d, 1)) {
    const projected = d > today;
    const spendDay = projected ? perDayProjected : (spendByDay.get(d) ?? 0);
    spendRun += spendDay;
    let mrrDay = 0;
    let payingDay = 0;
    for (const p of input.paying) if (dayOf(p.startedAt) <= d) { mrrDay += p.monthlyCents; payingDay += 1; }
    // What the trials bring were every one to convert: a running trial from its end; signups still to come arrive at
    // the last week's pace and pay after their trial. At the measured rate, that share of it.
    let trialsMrr = 0;
    let trialsPaying = 0;
    for (const t of trials) if (trialEnd(t) <= d) {
      trialsPaying += 1;
      if (t.monthlyCents !== null) trialsMrr += t.monthlyCents;
    }
    let signupsSoFar = signupDates.filter((x) => x <= d).length;
    if (projected) {
      futureCohorts.push(signupsPerDay * avgTrialMonthly);
      const payingCohorts = futureCohorts.length - trialDays;
      for (let i = 0; i < payingCohorts; i++) trialsMrr += futureCohorts[i];
      if (payingCohorts > 0) trialsPaying += payingCohorts * signupsPerDay;
      signupsSoFar += futureCohorts.length * signupsPerDay;
    }
    mrrDay += trialsMrr * pct;
    payingDay += trialsPaying * pct;
    revenueRun += mrrDay / 30;
    trialsRun += trialsMrr / 30;
    curve.push({
      date: d, spendCents: r0(spendRun), revenueCents: r0(revenueRun), projected,
      spendDayCents: r0(spendDay), spendSource: projected ? "projected" : (spendSource.get(d) ?? "none"),
      mrrCents: r0(mrrDay), paying: r1(payingDay), signups: r1(signupsSoFar),
      trialsMrrAllCents: r0(trialsMrr), trialsRevenueAllCents: r0(trialsRun), trialsPayingAll: r1(trialsPaying),
    });
  }
  const cross = totalSpend > 0 ? curve.find((p) => p.revenueCents >= p.spendCents && p.date >= today) ?? null : null;
  const breakEven = cross
    ? { date: cross.date, daysFromToday: daysBetween(today, cross.date), withinHorizon: true }
    : { date: null, daysFromToday: null, withinHorizon: false };
  const cost = customerCostSeries({
    since, today, trialDays, horizonDays: horizon, spendByDay, perDayProjectedCents: perDayProjected, won,
    trials: trials.map((t) => ({ createdAt: t.createdAt, end: trialEnd(t), monthlyCents: t.monthlyCents })),
    share, signupsPerDay, monthlyCents: avgTrialMonthly > 0 ? avgTrialMonthly : won.length ? r0(wonMrr / won.length) : 0,
  });

  // A cost needs both a spend and something to divide it by; without either there is no figure.
  const div = (n: number, d: number) => (n > 0 && d > 0 ? r0(n / d) : null);
  // The counted cost of a customer: the signups whose trial is over — through the day before the last trial's worth of
  // days, so a trial started late that day has ended too — the spend up to that day, and the customers they became.
  const maturedThrough = addDays(today, -(trialDays + 1));
  const matured = maturedThrough >= since;
  const maturedSpend = matured ? [...spendByDay].filter(([d]) => d <= maturedThrough).reduce((x, [, c]) => x + c, 0) : 0;
  const maturedWon = matured ? won.filter((p) => dayOf(p.signedUpAt ?? p.startedAt) <= maturedThrough) : [];
  const maturedWonMrr = maturedWon.reduce((x, p) => x + p.monthlyCents, 0);
  const toPct = (x: number) => Math.round(x * 100);
  return {
    since,
    today,
    daysLive,
    spend: { totalCents: totalSpend, perDayRecentCents: perDayRecent, perDayProjectedCents: perDayProjected, daysWithSpend: spendDates.length, lastDate: spendDates.at(-1) ?? null, dailyBudgetCents: dailyBudget, budgetFrom, budgetDays, bookedDays: booked.size },
    visitors: input.visitors,
    signups,
    trials: { count: trials.length, priced: priced.length, mrrCents: trialsMrr, avgMonthlyCents: avgTrialMonthly, lengthDays: trialDays },
    paying: { count: input.paying.length, mrrCents: payingMrr, arrCents: payingMrr * 12, revenueToDateCents: revenueToDate, preexisting: preexisting.length, preexistingMrrCents: preexisting.reduce((x, p) => x + p.monthlyCents, 0), won: won.length, wonMrrCents: wonMrr, fromNoCard: fromNoCard.length, fromNoCardMrrCents: fromNoCard.reduce((x, p) => x + p.monthlyCents, 0) },
    lapsed: input.lapsed,
    outcomes: oc
      ? { paidAtEnd: count("paid"), cameBack: count("came-back"), cameBackDays: median(oc.filter((o) => o.outcome === "came-back" && typeof o.afterDays === "number").map((o) => o.afterDays as number)), leftAfterPaying: oc.filter((o) => (o.outcome === "paid" || o.outcome === "came-back") && !o.payingNow).length, canceled: count("canceled"), unpaid: count("unpaid"), retrying: count("retrying") }
      : null,
    // From whole numbers: 23 of 40 is 57.5% and reads 58% (0.575 as a float rounds down to 57).
    rate: { paid: converted, ended, share, pct: ended > 0 ? Math.round((converted * 100) / ended) : null, lowPct: range ? toPct(range.low) : null, highPct: range ? toPct(range.high) : null },
    expected: {
      payers: share === null ? null : r1(trials.length * share),
      payersLow: range ? Math.round(trials.length * range.low) : null,
      payersHigh: range ? Math.round(trials.length * range.high) : null,
      mrrCents: expectedMrr,
      mrrWithPayingCents: payingMrr + (expectedMrr ?? 0),
    },
    unit: {
      costPerVisitorCents: input.visitors ? div(totalSpend, input.visitors) : null,
      costPerSignupCents: div(totalSpend, signups),
      costPerPayingCents: div(maturedSpend, maturedWon.length),
      costPerCustomerExpectedCents: share === null || totalSpend <= 0 || won.length + trials.length * share <= 0 ? null : r0(totalSpend / (won.length + trials.length * share)),
      visitorToSignupPct: input.visitors ? Math.round((signups / input.visitors) * 1000) / 10 : null,
      signupsPerDay: Math.round(signupsPerDay * 100) / 100,
      paybackMonths: maturedWonMrr > 0 && maturedSpend > 0 ? Math.round((maturedSpend / maturedWonMrr) * 10) / 10 : null,
      matured: { through: matured ? maturedThrough : null, spendCents: maturedSpend, won: maturedWon.length, wonMrrCents: maturedWonMrr },
      returnToDatePct: totalSpend > 0 ? Math.round((revenueToDate / totalSpend) * 100) : null,
    },
    breakEven,
    growth: (() => {
      const ti = curve.findIndex((p) => p.date === today);
      const from = curve[0]?.mrrCents ?? 0;
      const to = ti >= 0 ? curve[ti].mrrCents : from;
      return { fromCents: from, toCents: to, days: Math.max(0, ti), multiple: from > 0 ? Math.round((to / from) * 10) / 10 : null };
    })(),
    curve,
    cost,
  };
}

/* ── THE TWO KINDS OF TRIAL (owner, 2026-10-13): a day's ad spend went to whichever kind of trial a visitor could
   start that day. Where the owner's switch is recorded (lib/trialPolicyServer keeps its flips from 2026-10-13), the
   day follows the switch; before that, the day follows who signed up on it — all no-card signups, the whole day; a
   mix, in proportion — and a day with no signups follows the nearest day that had some (earlier first). Since
   2026-10-24 any share at all sends the whole day apart (splitApart below). */

/** The share (0–1) of each day's spend that went to no-card trials. */
export function noCardShareByDay(days: readonly string[], signups: ReadonlyArray<{ date: string; cohort: TrialCohort }>, policy: readonly PolicySpan[]): Map<string, number> {
  const spans = [...policy].filter((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.from)).sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  const byDay = new Map<string, { card: number; nocard: number }>();
  for (const x of signups) {
    const c = byDay.get(x.date) ?? { card: 0, nocard: 0 };
    c[x.cohort] += 1;
    byDay.set(x.date, c);
  }
  const ofSignups = (d: string): number | null => {
    const c = byDay.get(d);
    if (!c || c.card + c.nocard === 0) return null;
    return c.nocard / (c.card + c.nocard);
  };
  const sorted = [...days].sort();
  const out = new Map<string, number>();
  for (const d of sorted) {
    const span = spans.filter((p) => p.from <= d).at(-1);
    if (span) {
      out.set(d, span.mode === "nocard" ? 1 : 0);
      continue;
    }
    const own = ofSignups(d);
    if (own !== null) {
      out.set(d, own);
      continue;
    }
    // The nearest day with signups: earlier first, then later; nothing at all = the card (the only kind before the switch).
    const known = [...byDay.keys()].sort();
    const earlier = known.filter((k) => k < d).at(-1);
    const later = known.find((k) => k > d);
    const near = earlier ?? later;
    out.set(d, near ? (ofSignups(near) ?? 0) : 0);
  }
  return out;
}

/* ── KEPT APART: THE NO-CARD DAYS (owner, 2026-10-24: "we had free trials with no card and it was not good — remove
   that money spent from the stats and keep it separately, so we make better stats with the card on; make it smart").
   A day goes apart WHOLE when free trials with no card were on offer at any time that day: the switch said so (a
   flip to "card" counts from the next day, so the flip day itself is apart — lib/investors builds the spans), or,
   before the switch was recorded, someone signed up with no card that day (a day with no signups follows the
   nearest earlier day that had some). Every signup of an apart day goes with it — a card given anyway too: it came
   in under the no-card offer — and so does a no-card trial that slipped in on a card day (as an account; its day's
   spend stays). What is left is the page: the card days' spend and the card days' signups that took a card. When
   the apart days all come before the first card day, the page counts from that day. Visitors are not split. */

/** The days that go apart whole: any share of the day's spend went to no-card trials. */
export function apartDays(days: readonly string[], signups: ReadonlyArray<{ date: string; cohort: TrialCohort }>, policy: readonly PolicySpan[]): Set<string> {
  return new Set([...noCardShareByDay(days, signups, policy)].filter(([, share]) => share > 0).map(([d]) => d));
}

export interface ApartCut {
  /** The card days: the page's figures. */
  card: InvestorFigures;
  /** The no-card days and the no-card trials, kept apart: their own figures (no curve). */
  apart: InvestorFigures;
  /** The apart days in the period, in order, and their whole spend. */
  days: string[];
  spendCents: number;
  /** The apart side's signups: with no card, and with a card given anyway. */
  signups: { nocard: number; card: number };
  /** The card figures' first day: the day after the apart days when they all come first, else the start day. */
  cardSince: string;
}

/** The page cut in two: the card days, and the no-card days with everything they brought. */
export function splitApart(input: ModelInput, whole: InvestorFigures = investorFigures(input)): ApartCut {
  const c = input.cohorts ?? { lapsed: { card: 0, nocard: 0 }, signups: [], policy: [], current: "card" as TrialCohort };
  const booked = whole.curve.filter((p) => !p.projected && p.date <= whole.today);
  const apart = apartDays(booked.map((p) => p.date), c.signups, c.policy);
  const days = booked.map((p) => p.date).filter((d) => apart.has(d));
  const firstCard = booked.find((p) => !apart.has(p.date))?.date ?? null;
  const cardSince = days.length > 0 && firstCard !== null && (days.at(-1) as string) < firstCard ? firstCard : input.since;
  const isApart = (date: string, cohort?: TrialCohort) => apart.has(dayOf(date)) || (cohort ?? "card") === "nocard";
  const side = (mine: boolean): ModelInput => {
    const keep = (date: string, cohort?: TrialCohort) => isApart(date, cohort) === !mine;
    const lapsedSignups = input.lapsedSignups?.filter((x) => keep(x.date, x.cohort));
    return {
      ...input,
      since: mine ? cardSince : input.since,
      spend: booked.filter((p) => apart.has(p.date) !== mine && p.spendDayCents > 0).map((p) => ({ date: p.date, cents: p.spendDayCents })),
      // An account paying from before the start day took a card and came before any of this: the card side's. One
      // that came in on the no-card offer and pays now joins the card side's paying too, marked (owner, 2026-10-25).
      paying: [
        ...input.paying.filter((p) => (p.preexisting ? mine : keep(p.signedUpAt ?? p.startedAt, p.cohort))),
        ...(mine ? input.paying.filter((p) => !p.preexisting && isApart(p.signedUpAt ?? p.startedAt, p.cohort)).map((p) => ({ ...p, fromNoCard: true })) : []),
      ],
      outcomes: input.outcomes?.filter((o) => keep(o.date, o.cohort)),
      trials: input.trials.filter((t) => keep(t.createdAt, t.cohort)),
      lapsed: lapsedSignups ? lapsedSignups.length : (c.lapsed[mine ? "card" : "nocard"] ?? 0),
      lapsedSignups,
      // The whole's spend is already filled by the budget; from tomorrow only the kind a new signup gets today spends.
      settings: { ...input.settings, dailyBudgetCents: null, budgetFrom: null },
      forwardSpendCents: (c.current === "card") === mine ? whole.spend.perDayProjectedCents : 0,
      visitors: mine ? input.visitors : null,
      cohorts: undefined,
    };
  };
  const apartInput = side(false);
  const nocardSignups = [...apartInput.trials.map((t) => t.cohort), ...apartInput.paying.map((p) => p.cohort), ...(apartInput.lapsedSignups ?? []).map((x) => x.cohort)].filter((k) => k === "nocard").length;
  const apartFigures = investorFigures(apartInput);
  return {
    card: investorFigures(side(true)),
    apart: apartFigures,
    days,
    spendCents: days.reduce((x, d) => x + (booked.find((p) => p.date === d)?.spendDayCents ?? 0), 0),
    signups: { nocard: nocardSignups, card: Math.max(0, apartFigures.signups - nocardSignups) },
    cardSince,
  };
}

/* ── MONTH BY MONTH (owner, 2026-10-25: "keep only the monthly run-rate; an option to look at one day, 2 days, 7 days
   …; make it super smart, more understandable"). One chart: what a month of ads costs at each day's pace (that day and
   the six before it, × 30) against what a month brings in at that day's accounts. A window around today — that many
   days back and the same ahead — and the plain words for it: where things stand today, how they moved, where they go,
   and the day a month first earns more than its ads. Pure, so the page, the shared link and the PDF read the same. */

/** A month of ads at each day's pace: that day's spend and the six days' before it, averaged, × 30. TODAY is still
 *  running — Meta's figure for it is partial — so it counts at least at the last full week's pace (the first projected
 *  day's), or the line would dip at "today" and for the week after it. */
export function monthlyPace(curve: readonly CurvePoint[], today?: string): number[] {
  const ti = today ? curve.findIndex((p) => p.date === today) : -1;
  const week = ti >= 0 && curve[ti + 1]?.projected ? curve[ti + 1].spendDayCents : null;
  const spendOf = (i: number) => (i === ti && week !== null ? Math.max(curve[i].spendDayCents, week) : curve[i].spendDayCents);
  return curve.map((_, i) => {
    const from = Math.max(0, i - 6);
    let sum = 0;
    for (let k = from; k <= i; k++) sum += spendOf(k);
    return Math.round((sum / (i + 1 - from)) * 30);
  });
}

/** The window: `days` back from today and the same ahead (null = from the start to the horizon), as curve indices. */
export function runRateWindow(curve: readonly CurvePoint[], today: string, days: number | null): { from: number; to: number; todayIndex: number } {
  const last = curve.length - 1;
  const found = curve.findIndex((p) => p.date === today);
  const ti = found >= 0 ? found : Math.max(0, curve.filter((p) => !p.projected).length - 1);
  if (days === null) return { from: 0, to: last, todayIndex: ti };
  return { from: Math.max(0, ti - days), to: Math.min(last, ti + days), todayIndex: ti };
}

export interface RunRateReading {
  date: string;
  /** What a month brings in at that day's accounts; what a month of ads costs at that day's pace. */
  revenueCents: number;
  adsCents: number;
  /** Revenue as a share of the ads, %; null with no ads. */
  coverPct: number | null;
  paying: number;
  signups: number;
  projected: boolean;
}

export function runRateReading(curve: readonly CurvePoint[], pace: readonly number[], i: number): RunRateReading {
  const p = curve[i];
  const ads = pace[i] ?? 0;
  return { date: p.date, revenueCents: p.mrrCents, adsCents: ads, coverPct: ads > 0 ? Math.round((p.mrrCents / ads) * 100) : null, paying: p.paying, signups: p.signups, projected: p.projected };
}

/** The first day from today on that a month brings in at least what a month of ads costs; null = not within the curve. */
export function payMonthlyDay(curve: readonly CurvePoint[], pace: readonly number[], todayIndex: number): { index: number; date: string; inDays: number } | null {
  for (let i = Math.max(0, todayIndex); i < curve.length; i++) {
    if ((pace[i] ?? 0) > 0 && curve[i].mrrCents >= (pace[i] ?? 0)) return { index: i, date: curve[i].date, inDays: i - todayIndex };
  }
  return null;
}

const dayWord = (n: number) => (n === 1 ? "day" : "days");

/** The plain words for a window: today; how it moved in the days shown before today; where it goes in the days shown
 *  after; and the day a month first earns more than its ads. */
export function runRateStory(curve: readonly CurvePoint[], today: string, days: number | null, ratePct: number | null): { now: string; past: string | null; ahead: string | null; cross: string } {
  const pace = monthlyPace(curve, today);
  const w = runRateWindow(curve, today, days);
  const t = runRateReading(curve, pace, w.todayIndex);
  const now = t.adsCents > 0
    ? `Today a month brings in ${dollars(t.revenueCents)} against ${dollars(t.adsCents)} of ads — revenue covers ${t.coverPct}% of the ads.`
    : `Today a month brings in ${dollars(t.revenueCents)}, and no ads are running.`;
  let past: string | null = null;
  const back = w.todayIndex - w.from;
  if (back > 0) {
    const a = runRateReading(curve, pace, w.from);
    const d = t.revenueCents - a.revenueCents;
    const pct = a.revenueCents > 0 ? ` (${d >= 0 ? "+" : "−"}${Math.abs(Math.round((d / a.revenueCents) * 100))}%)` : "";
    const lead = back === 1 ? "Since yesterday" : `In the last ${back} ${dayWord(back)}`;
    const moved = d === 0 ? `revenue per month held at ${dollars(t.revenueCents)}` : `revenue per month ${d > 0 ? "grew" : "fell"} ${dollars(Math.abs(d))}${pct}, from ${dollars(a.revenueCents)} to ${dollars(t.revenueCents)}`;
    const ads = a.adsCents === t.adsCents ? `a month of ads stayed at ${dollars(t.adsCents)}` : `a month of ads went from ${dollars(a.adsCents)} to ${dollars(t.adsCents)}`;
    past = `${lead}, ${moved}; ${ads}.`;
    // FROM THE FIRST DAY (owner, 2026-10-25: "say from 0, not from 782 — move those 782 to the total"): the view starts
    // where the count starts, so the growth is counted from $0 and what was already paying that day stands beside it,
    // in the total — never as money the period brought.
    if (w.from === 0 && d > 0) {
      const since = `Since ${shortDay(curve[0].date)}`;
      // The multiple leads (owner, 2026-10-25, chose: "3.3× growth + cost per lead"): true, and it reads strong.
      const x = Math.round((t.revenueCents / Math.max(1, a.revenueCents)) * 10) / 10;
      past = a.revenueCents > 0
        // The total only (owner, 2026-10-26: "don't show the 782 — make it the total"): the multiple carries the start.
        ? `${since}, monthly revenue grew ${x}×, to ${dollars(t.revenueCents)}. ${ads[0].toUpperCase()}${ads.slice(1)}.`
        : `${since}, revenue per month grew from $0 to ${dollars(t.revenueCents)}; ${ads}.`;
    }
  }
  let ahead: string | null = null;
  const fwd = w.to - w.todayIndex;
  if (fwd > 0) {
    const e = runRateReading(curve, pace, w.to);
    const how = ratePct === null ? "counting only the accounts already paying" : `with ${ratePct}% of trials converting, as measured`;
    ahead = `In ${fwd} ${dayWord(fwd)}, at today's pace and ${how}: ${dollars(e.revenueCents)} a month in, ${dollars(e.adsCents)} a month of ads.`;
  }
  const c = payMonthlyDay(curve, pace, w.todayIndex);
  const cross = c === null
    ? `At today's pace a month doesn't bring in more than its ads within the next ${curve.length - 1 - w.todayIndex} days.`
    : c.inDays === 0
      ? "Already today a month brings in more than its ads cost."
      : `From ${longDate(c.date)} — in ${c.inDays} ${dayWord(c.inDays)} — each month brings in more than its ads cost.`;
  return { now, past, ahead, cross };
}

/* ── WHAT IF MORE TRIALS CONVERTED (owner, 2026-10-25: "add a prediction line, dashed, so we can play with it — if the
   conversion gets better, where we can be"). Revenue is linear in the rate, so any rate reads off the measured curve:
   the trials' part at 100% (trialsMrrAllCents…) times the difference. Only what is still to come moves: the paying
   accounts and every day up to today stay as they are. The slider starts at the measured rate — a what-if shows only
   once someone moves it. */

/** One day of the curve at another conversion rate (0–1), against the measured one. */
export function whatIfPoint(p: CurvePoint, measured: number | null, at: number): { mrrCents: number; revenueCents: number; paying: number } {
  const d = at - (measured ?? 0);
  return { mrrCents: Math.round(p.mrrCents + d * p.trialsMrrAllCents), revenueCents: Math.round(p.revenueCents + d * p.trialsRevenueAllCents), paying: Math.round((p.paying + d * p.trialsPayingAll) * 10) / 10 };
}

/** The words for a what-if rate (whole %): where a month would be at the end of the view, the day a month would first
 *  earn more than its ads, and the day the ads would pay for themselves — each against the measured rate. */
export function whatIfStory(curve: readonly CurvePoint[], today: string, days: number | null, measured: number | null, atPct: number): string {
  const at = Math.min(100, Math.max(0, atPct)) / 100;
  const pace = monthlyPace(curve, today);
  const w = runRateWindow(curve, today, days);
  const measuredPct = measured === null ? null : Math.round(measured * 100);
  const firstMonthly = (rate: number | null) => {
    for (let i = w.todayIndex; i < curve.length; i++) if ((pace[i] ?? 0) > 0 && whatIfPoint(curve[i], measured, rate ?? measured ?? 0).mrrCents >= (pace[i] ?? 0)) return i;
    return -1;
  };
  const firstEven = (rate: number | null) => {
    for (let i = w.todayIndex; i < curve.length; i++) if (curve[i].spendCents > 0 && whatIfPoint(curve[i], measured, rate ?? measured ?? 0).revenueCents >= curve[i].spendCents) return i;
    return -1;
  };
  // Where a month would be: at the end of the view, and never closer than 30 days ahead (a day or two shows nothing).
  const e = Math.min(curve.length - 1, w.todayIndex + Math.max(30, w.to - w.todayIndex));
  const mine = whatIfPoint(curve[e], measured, at).mrrCents;
  const real = curve[e].mrrCents;
  const diff = mine - real;
  const head = `If ${atPct}% of trials converted${measuredPct === null ? "" : ` instead of ${measuredPct}%`}: in ${e - w.todayIndex} ${e - w.todayIndex === 1 ? "day" : "days"} a month would bring in ${dollars(mine)}${diff === 0 ? "" : ` (${dollars(Math.abs(diff))} ${diff > 0 ? "more" : "less"})`}`;
  const sooner = (now: number, then: number, what: string, never: string) => {
    if (then < 0) return `${never} within the next ${curve.length - 1 - w.todayIndex} days`;
    const when = `${what} from ${longDate(curve[then].date)}`;
    if (now < 0) return `${when} (not at all at ${measuredPct ?? 0}%)`;
    const by = now - then;
    return by === 0 ? `${when}, the same day` : `${when} — ${Math.abs(by)} ${Math.abs(by) === 1 ? "day" : "days"} ${by > 0 ? "sooner" : "later"}`;
  };
  const monthly = sooner(firstMonthly(null), firstMonthly(at), "each month would earn more than its ads", "no month would earn more than its ads");
  const even = sooner(firstEven(null), firstEven(at), "the ads would have paid for themselves", "the ads would not pay for themselves");
  return `${head}; ${monthly}; ${even}.`;
}

/** THE SPEND BY PERIOD (owner, 2026-10-08: "live spending per day, per week,
 *  per month; show all the costs"): read off the curve's booked days, so a
 *  Meta figure, a hand-booked day and a budget-filled day all count. The
 *  week starts on Monday; "days" is how many days of the window fall on or
 *  after the start day, so the per-day figure is honest in a young window. */
export interface SpendPeriod {
  key: "today" | "yesterday" | "week" | "last7" | "month" | "last30" | "all";
  label: string;
  cents: number;
  days: number;
  perDayCents: number;
}
export function spendPeriods(curve: CurvePoint[], today: string): SpendPeriod[] {
  const booked = curve.filter((p) => !p.projected && p.date <= today);
  const since = booked[0]?.date ?? today;
  const sum = (from: string, to: string) => {
    const inWindow = booked.filter((p) => p.date >= from && p.date <= to);
    const cents = inWindow.reduce((x, p) => x + p.spendDayCents, 0);
    return { cents, days: inWindow.length, perDayCents: inWindow.length ? r0(cents / inWindow.length) : 0 };
  };
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 Sunday
  const monday = addDays(today, -((dow + 6) % 7));
  const first = `${today.slice(0, 8)}01`;
  const yesterday = addDays(today, -1);
  const mk = (key: SpendPeriod["key"], label: string, from: string, to: string): SpendPeriod => ({ key, label, ...sum(from < since ? since : from, to) });
  return [
    mk("today", "Today", today, today),
    mk("yesterday", "Yesterday", yesterday, yesterday),
    mk("week", "This week", monday, today),
    mk("last7", "Last 7 days", addDays(today, -6), today),
    mk("month", "This month", first, today),
    mk("last30", "Last 30 days", addDays(today, -29), today),
    mk("all", "Since the start", since, today),
  ];
}

/** "$1,234" — whole dollars; cents only under ten dollars. */
export function dollars(cents: number): string {
  const d = cents / 100;
  return `$${d.toLocaleString("en-US", { maximumFractionDigits: d > 0 && d < 10 ? 2 : 0, minimumFractionDigits: 0 })}`;
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const shortDay = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** What investors read first (2026-10-24): what the ads bought, the rate measured so far, and what it says of
 *  the trials running now. Counted things only; the one prediction is the measured rate applied to them. */
export function standingSentence(f: InvestorFigures): string {
  const spent = f.spend.totalCents > 0 ? `${dollars(f.spend.totalCents)} on ads since ${shortDay(f.since)} brought ${plural(f.signups, "signup", "signups")} with a card.` : `No ad spend is booked since ${shortDay(f.since)}; ${plural(f.signups, "signup", "signups")} with a card.`;
  const r = f.rate;
  if (r.pct === null) return `${spent} No trial has ended yet, so there is no measured rate to predict with — ${plural(f.trials.count, "trial is", "trials are")} running now.`;
  const back = f.outcomes && f.outcomes.cameBack > 0 ? ` (${f.outcomes.cameBack} of them came back after the trial had ended)` : "";
  const rate = ` Of the ${plural(r.ended, "trial", "trials")} that have ended, ${r.paid} converted to a paid plan${back} — ${r.pct}%.`;
  const ahead = f.trials.count === 0 || f.expected.payers === null
    ? " No trial is running now."
    : ` At that rate about ${Math.round(f.expected.payers)} of the ${plural(f.trials.count, "trial", "trials")} running now will pay too${f.expected.payersLow !== null && f.expected.payersHigh !== null && f.expected.payersLow !== f.expected.payersHigh ? ` (likely ${f.expected.payersLow}–${f.expected.payersHigh})` : ""}.`;
  return spent + rate + ahead;
}

/** The second sentence: when the ads pay for themselves, at today's pace and the measured rate. */
export function outlookSentence(f: InvestorFigures): string {
  if (f.spend.totalCents === 0) return "With no ad spend booked there is nothing to earn back.";
  const run = dollars(f.expected.mrrWithPayingCents);
  const share = f.rate.pct === null ? "" : `, ${f.rate.pct}% of trials converting`;
  if (f.breakEven.date && f.breakEven.daysFromToday !== null) {
    if (f.breakEven.daysFromToday <= 0) return `The ad spend to date (${dollars(f.spend.totalCents)}) is already covered by revenue at list price; monthly revenue runs at ${run}.`;
    return `At today's pace — ${dollars(f.spend.perDayProjectedCents)} a day on ads, ${f.unit.signupsPerDay} ${f.unit.signupsPerDay === 1 ? "signup" : "signups"} a day${share} — the ads pay for themselves in ${f.breakEven.daysFromToday} days, on ${longDate(f.breakEven.date)}.`;
  }
  const why = f.rate.pct === null ? " Until a trial ends, only the accounts already paying are counted." : f.rate.pct === 0 ? " No trial that ended is paying yet, so the running trials add nothing." : "";
  return `At today's pace the ads do not pay for themselves within ${f.curve.length - f.daysLive} days: ${dollars(f.spend.perDayProjectedCents)} a day goes out against ${run} a month coming in.${why}`;
}

/** The cost of a customer in plain words (2026-11-02): today, week by week, at today's pace, at the end of the view,
 *  and the day the ads' own customers have paid them back. Each line says what it counts; a rise reads as a rise. */
export function customerCostStory(f: InvestorFigures): { now: string; weeks: string | null; pace: string | null; ahead: string | null; paidBack: string | null } {
  const c = f.cost;
  const m = f.unit.matured;
  const now = c.points.find((p) => p.date === f.today) ?? null;
  const end = c.points.at(-1) ?? null;
  const range = (w: CostWeek) => (w.from.slice(0, 7) === w.to.slice(0, 7) ? `${shortDay(w.from)}–${Number(w.to.slice(8))}` : `${shortDay(w.from)}–${shortDay(w.to)}`);
  const change = (from: number, to: number) => (to === from ? "no change" : `${Math.abs(Math.round(((to - from) / from) * 100))}% ${to < from ? "less" : "more"}`);

  let nowWords: string;
  if (m.through === null) nowWords = `No trial is over yet, so no customer is counted — the first are counted on ${longDate(addDays(f.since, f.trials.lengthDays + 1))}.`;
  else if (!now || now.grossCents === null) nowWords = `The signups whose trial is over — up to ${shortDay(m.through)} — have not brought a paying customer yet; ${dollars(m.spendCents)} of ads are counted against them.`;
  else nowWords = `Today a customer has cost ${dollars(now.grossCents)} to win (${dollars(now.spendCents)} of ads up to ${shortDay(m.through)} ÷ ${plural(m.won, "paying customer", "paying customers")})${now.netCents === null ? "." : now.netCents <= 0 ? ", and those customers have already paid it back." : `, and ${dollars(now.netCents)} after what those customers have paid since.`}`;

  const counted = c.weeks.filter((w) => w.state === "counted" && w.costCents !== null);
  const weeks = counted.length >= 2
    ? `Week by week: ${dollars(counted[0].costCents!)} a customer for the first week's signups (${range(counted[0])}), ${dollars(counted.at(-1)!.costCents!)} for the latest week whose trials are over (${range(counted.at(-1)!)}) — ${change(counted[0].costCents!, counted.at(-1)!.costCents!)}.`
    : counted.length === 1
      ? `One week's trials are over so far: ${dollars(counted[0].costCents!)} a customer for the signups of ${range(counted[0])}.`
      : null;

  const p = c.pace;
  const pace = p.costCents === null
    ? null
    : `At today's pace — ${dollars(p.spendPerDayCents)} a day on ads, ${p.signupsPerDay} ${p.signupsPerDay === 1 ? "signup" : "signups"} a day, ${f.rate.pct}% converting — a new customer costs ${dollars(p.costCents)} to win${p.paybackMonths !== null ? ` and pays it back in ${p.paybackMonths} months at ${dollars(p.monthlyCents)} a month` : ""}.`;

  const ahead = end && end.grossCents !== null && end.netCents !== null && now && now.grossCents !== null && f.rate.share !== null
    ? `In ${c.aheadDays} days at that pace (${longDate(end.date)}): ${dollars(end.grossCents)} a customer to win — ${end.grossCents === now.grossCents ? "the same as" : end.grossCents < now.grossCents ? "down from" : "up from"} ${dollars(now.grossCents)} today — and ${end.netCents <= 0 ? "already paid back" : `${dollars(end.netCents)} after what they have paid`}, with about ${Math.round(end.customers)} customers counted.`
    : null;

  const paidBack = f.spend.totalCents === 0 || m.through === null
    ? null
    : c.paidBack.date
      ? c.paidBack.daysFromToday === 0
        ? "The ads' own customers have already paid back every ad dollar counted."
        : `At that pace the ads' own customers pay back every ad dollar counted on ${longDate(c.paidBack.date)} — in ${c.paidBack.daysFromToday} days.`
      : `At that pace the ads' own customers do not pay back the ads counted within the next ${c.paidBack.searchedDays} days.`;

  return { now: nowWords, weeks, pace, ahead, paidBack };
}

/** Which day since the launch today is (owner, 2026-10-24: "add the days count after JobFlex launched"): the
 *  launch day is day 1; a launch date still ahead reads as day 0. */
export function launchDay(date: string, today: string, set = true): { date: string; day: number; set: boolean } {
  return { date, day: Math.max(0, daysBetween(date, today) + 1), set };
}

export function longDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}
