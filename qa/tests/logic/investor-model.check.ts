// The investor figures (lib/investorModel, 2026-10-06): spend, trials, the
// MEASURED share that stays after the trial (2026-10-24 — no assumed share),
// what it expects of the running trials, the payback curve and its break-even
// — on fixtures with hand-checked answers.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/investor-model.check.ts
import { addDays, apartDays, customerCostStory, daysBetween, dollars, investorFigures, launchDay, monthlyPace, whatIfPoint, whatIfStory, noCardShareByDay, outlookSentence, payMonthlyDay, runRateReading, runRateStory, runRateWindow, splitApart, perDay, spendPeriods, standingSentence, wilson, type ModelInput } from "../../../src/lib/investorModel";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const near = (a: number, b: number, tol = 1) => Math.abs(a - b) <= tol;

const base: ModelInput = {
  since: "2026-09-30",
  today: "2026-10-06",
  spend: [
    { date: "2026-09-30", cents: 10000 }, { date: "2026-10-01", cents: 10000 }, { date: "2026-10-02", cents: 10000 },
    { date: "2026-10-03", cents: 10000 }, { date: "2026-10-04", cents: 10000 }, { date: "2026-10-05", cents: 10000 }, { date: "2026-10-06", cents: 10000 },
    { date: "2026-09-01", cents: 99999 }, // before the launch: not counted
  ],
  paying: [{ startedAt: "2026-10-02", monthlyCents: 7900 }, { startedAt: "2026-10-06", monthlyCents: 7900 }],
  trials: [
    { createdAt: "2026-10-04", endsAt: "2026-10-11", monthlyCents: 7900 },
    { createdAt: "2026-10-05", endsAt: "2026-10-12", monthlyCents: 2900 },
    { createdAt: "2026-10-06", endsAt: "2026-10-13", monthlyCents: 19900 },
    { createdAt: "2026-10-06", endsAt: null, monthlyCents: null },
  ],
  lapsed: 1,
  settings: { horizonDays: 180, trialDays: 14, dailyBudgetCents: null, budgetFrom: null },
  visitors: 700,
};

console.log("── dates");
check("a day after Oct 6 is Oct 7; Sep 30 → Oct 6 is six days apart", addDays("2026-10-06", 1) === "2026-10-07" && daysBetween("2026-09-30", "2026-10-06") === 6);
check("a pace over the last seven days (or since the launch when younger)", near(perDay(["2026-10-06", "2026-10-05", "2026-10-05", "2026-09-29"], "2026-09-30", "2026-10-06"), 3 / 7, 0.001) && near(perDay(["2026-10-06"], "2026-10-05", "2026-10-06"), 0.5, 0.001));

const f = investorFigures(base);
console.log("── spend");
check("spend since the launch only: $700 over 7 days", f.spend.totalCents === 70000 && f.spend.daysWithSpend === 7 && f.spend.lastDate === "2026-10-06");
check("the pace is the last FULL days (today is still running): Sep 30–Oct 5, $100 a day, and it runs forward", f.spend.perDayRecentCents === 10000 && f.spend.perDayProjectedCents === 10000);
const partialToday = investorFigures({ ...base, spend: base.spend.map((d) => (d.date === "2026-10-06" ? { ...d, cents: 1500 } : d)) });
check("a half-read today (Meta's $15 so far) does not drag the pace down", partialToday.spend.perDayProjectedCents === 10000 && partialToday.spend.totalCents === 61500);
console.log("── the daily budget");
const budgetOnly = investorFigures({ ...base, spend: [], settings: { ...base.settings, dailyBudgetCents: 5000, budgetFrom: "2026-10-01" } });
check("a $50 daily budget since Oct 1 with nothing booked: six days spent, $300", budgetOnly.spend.totalCents === 30000 && budgetOnly.spend.budgetDays === 6 && budgetOnly.spend.bookedDays === 0 && budgetOnly.curve[1].spendSource === "budget" && budgetOnly.curve[0].spendSource === "none");
check("…and forward at what the last full days spent ($250 over Sep 30–Oct 5 = $41.67), not at a figure we chose", budgetOnly.spend.perDayProjectedCents === 4167);
const budgetAndBooked = investorFigures({ ...base, settings: { ...base.settings, dailyBudgetCents: 5000, budgetFrom: "2026-10-01" } });
check("a booked day overrides the budget: all seven days booked, still $700, no budget days", budgetAndBooked.spend.totalCents === 70000 && budgetAndBooked.spend.budgetDays === 0 && budgetAndBooked.spend.bookedDays === 7 && budgetAndBooked.curve[3].spendSource === "booked");
const budgetEarly = investorFigures({ ...base, spend: [], settings: { ...base.settings, dailyBudgetCents: 5000, budgetFrom: "2026-09-01" } });
check("a budget from before the start day counts from the start day: 7 days, $350", budgetEarly.spend.totalCents === 35000 && budgetEarly.spend.budgetFrom === "2026-09-30" && budgetEarly.spend.budgetDays === 7);
console.log("── spend by period");
const per = Object.fromEntries(spendPeriods(f.curve, "2026-10-06").map((p) => [p.key, p]));
check("today $100, yesterday $100, this week (Mon Oct 5 →) $200 over 2 days", per.today.cents === 10000 && per.yesterday.cents === 10000 && per.week.cents === 20000 && per.week.days === 2 && per.week.perDayCents === 10000);
check("this month (Oct 1 →) $600 over 6 days; last 7 and since the start $700 over 7", per.month.cents === 60000 && per.month.days === 6 && per.last7.cents === 70000 && per.all.cents === 70000 && per.all.days === 7);
check("last 30 days clips to the start day: 7 days, not 30", per.last30.days === 7 && per.last30.cents === 70000 && per.last30.perDayCents === 10000);

console.log("── the measured rate");
check("ended trials = paying + lapsed: 2 of 3 stay = 67%", f.rate.paid === 2 && f.rate.ended === 3 && f.rate.pct === 67);
check("its 90% range for three trials is wide: 25–92%", f.rate.lowPct === 25 && f.rate.highPct === 92, `${f.rate.lowPct}–${f.rate.highPct}`);
const w = wilson(5, 10)!;
check("the range: none with no trials; 5 of 10 sits around a half; 50 of 100 is narrower than 5 of 10", wilson(0, 0) === null && near(w.low + w.high, 1, 0.001) && wilson(50, 100)!.high - wilson(50, 100)!.low < w.high - w.low);
check("0 of 4 still has an upper bound above zero; 4 of 4 a lower one under one", wilson(0, 4)!.low === 0 && wilson(0, 4)!.high > 0 && wilson(4, 4)!.high === 1 && wilson(4, 4)!.low < 1);
check("no share set anywhere: the settings carry none", !("realisticPct" in base.settings) && !("spendPerDayCents" in base.settings));

console.log("── the running trials at that rate");
check("4 running, 3 priced: $307 a month at list price, $102 average", f.trials.count === 4 && f.trials.priced === 3 && f.trials.mrrCents === 30700 && f.trials.avgMonthlyCents === 10233);
check("expected to pay: 4 × 2/3 = 2.7, likely 1–4", f.expected.payers === 2.7 && f.expected.payersLow === 1 && f.expected.payersHigh === 4, `${f.expected.payers} (${f.expected.payersLow}–${f.expected.payersHigh})`);
check("…adding $307 × 2/3 = $204.67 a month; with the paying $158 = $362.67", f.expected.mrrCents === 20467 && f.expected.mrrWithPayingCents === 36267);
check("the trial length is what the running trials show (7 days), not the setting (14)", f.trials.lengthDays === 7);
check("…and the setting only when no running trial has its end on record", investorFigures({ ...base, trials: base.trials.map((t) => ({ ...t, endsAt: null })) }).trials.lengthDays === 14);

console.log("── paying against the spend");
check("paying: 2 accounts, $158 MRR, $1,896 ARR; both won by the period", f.paying.count === 2 && f.paying.mrrCents === 15800 && f.paying.arrCents === 189600 && f.paying.won === 2 && f.paying.wonMrrCents === 15800);
check("revenue to date at list price: 5 days of $79 + 1 day of $79 = $15.80", f.paying.revenueToDateCents === Math.round((7900 * 5) / 30) + Math.round(7900 / 30));
check("signups = trials + paying + lapsed = 7", f.signups === 7);
check("cost per paying customer counts only the signups whose trial is over: none here yet (launched Sep 30, 7-day trials)", f.unit.costPerPayingCents === null && f.unit.matured.through === null && f.unit.matured.won === 0);
check("…so no payback yet either; return to date 2%", f.unit.paybackMonths === null && f.unit.returnToDatePct === 2);
check("cost per visitor $1, per signup $100; visitor → signup 1%", f.unit.costPerVisitorCents === 100 && f.unit.costPerSignupCents === 10000 && f.unit.visitorToSignupPct === 1);
check("signup pace over the full days: 3 signups Sep 30–Oct 5 = 0.5 a day", f.unit.signupsPerDay === 0.5);
const withLapsedDates = investorFigures({ ...base, lapsedSignups: [{ date: "2026-10-03" }] });
check("a lapsed signup counts in the pace too — the rate applies to every signup, the leavers included", withLapsedDates.unit.signupsPerDay === 0.67 && withLapsedDates.curve[6].signups === 7);

// ── THE COST OF A CUSTOMER, COUNTED ON THE TRIALS THAT ARE OVER (owner, 2026-11-02): the last week's ads bought trials
// still running — dividing them by the customers of the weeks before overstated the cost.
console.log("── the cost of a customer: the trials that are over");
const longer: ModelInput = {
  ...base,
  since: "2026-09-20",
  spend: Array.from({ length: 17 }, (_, i) => ({ date: addDays("2026-09-20", i), cents: 10000 })),
  paying: [
    { startedAt: "2026-09-29", monthlyCents: 7900, signedUpAt: "2026-09-22" },
    { startedAt: "2026-10-04", monthlyCents: 7900, signedUpAt: "2026-09-27" },
    { startedAt: "2026-10-03", monthlyCents: 19900, signedUpAt: "2026-10-01" },
    { startedAt: "2026-09-30", monthlyCents: 9900, signedUpAt: "2026-09-23", fromNoCard: true },
    { startedAt: "2026-09-01", monthlyCents: 9900, signedUpAt: "2026-08-20", preexisting: true },
  ],
};
const fl = investorFigures(longer);
check("7-day trials, today Oct 6: the signups up to Sep 28 are over (one started late on Sep 28 ended Oct 5)", fl.trials.lengthDays === 7 && fl.unit.matured.through === "2026-09-28");
check("…the spend up to that day: Sep 20–28, 9 days × $100 = $900 — not the $1,700 since the launch", fl.unit.matured.spendCents === 90000 && fl.spend.totalCents === 170000);
check("…÷ the 2 customers those signups became = $450 (the Oct 1 signup that paid early waits for its week; no-card and earlier payers never count)", fl.unit.matured.won === 2 && fl.unit.costPerPayingCents === 45000 && fl.paying.won === 3);
check("…earns it back in $900 ÷ $158 = 5.7 months", fl.unit.matured.wonMrrCents === 15800 && fl.unit.paybackMonths === 5.7);
check("…the old way read $1,700 ÷ 3 = $567: the last week's spend charged to customers it had no time to win yet", Math.round(fl.spend.totalCents / fl.paying.won) === 56667 && fl.unit.costPerPayingCents! < 56667);
// The owner's own case (2026-11-02): today Nov 2, $100 a day since Oct 8. Paid today = signed up Oct 26; paid yesterday
// = signed up Oct 25. None of the last week's ad days — nor today's — is charged to a customer.
const ownerCase = investorFigures({
  ...base,
  since: "2026-10-08",
  today: "2026-11-02",
  spend: Array.from({ length: 26 }, (_, i) => ({ date: addDays("2026-10-08", i), cents: 10000 })),
  paying: [
    { signedUpAt: "2026-10-10", startedAt: "2026-10-17", monthlyCents: 7900 },
    { signedUpAt: "2026-10-25", startedAt: "2026-11-01", monthlyCents: 7900 },
    { signedUpAt: "2026-10-26", startedAt: "2026-11-02", monthlyCents: 7900 },
  ],
  trials: [{ createdAt: "2026-10-28", endsAt: "2026-11-04", monthlyCents: 7900 }],
});
check("the owner's case: the ads Oct 26–Nov 2 ($800, today too) are left out; Oct 8–25 ($1,800) counted", ownerCase.unit.matured.through === "2026-10-25" && ownerCase.unit.matured.spendCents === 180000 && ownerCase.spend.totalCents - ownerCase.unit.matured.spendCents === 80000);
check("…paid yesterday (signed up Oct 25) counts; paid today (signed up Oct 26) waits a day, with its day's ads: $1,800 ÷ 2", ownerCase.unit.matured.won === 2 && ownerCase.unit.costPerPayingCents === 90000);
const notYet = investorFigures({ ...longer, paying: longer.paying.filter((p) => p.signedUpAt === "2026-10-01") });
check("trials over, none of them paying: no cost and no payback, the day and its spend kept", notYet.unit.matured.through === "2026-09-28" && notYet.unit.matured.won === 0 && notYet.unit.matured.spendCents === 90000 && notYet.unit.costPerPayingCents === null && notYet.unit.paybackMonths === null);

// ── WHAT A CUSTOMER COSTS, FROM THE FIRST DAY (owner, 2026-11-02): to win and after paying, day by day; week by week;
// at today's pace; the day the ads' own customers pay them back.
console.log("── what a customer costs, from the first day");
const costIn: ModelInput = {
  ...base,
  since: "2026-10-08",
  today: "2026-11-02",
  spend: Array.from({ length: 26 }, (_, i) => ({ date: addDays("2026-10-08", i), cents: 10000 })),
  paying: [
    { signedUpAt: "2026-10-10", startedAt: "2026-10-17", monthlyCents: 7900 },
    { signedUpAt: "2026-10-14", startedAt: "2026-10-21", monthlyCents: 7900 },
    { signedUpAt: "2026-10-20", startedAt: "2026-10-27", monthlyCents: 7900 },
    { signedUpAt: "2026-10-26", startedAt: "2026-11-02", monthlyCents: 7900 },
  ],
  trials: [
    { createdAt: "2026-10-28", endsAt: "2026-11-04", monthlyCents: 7900 },
    { createdAt: "2026-10-29", endsAt: "2026-11-05", monthlyCents: 7900 },
    { createdAt: "2026-10-31", endsAt: "2026-11-07", monthlyCents: 7900 },
    { createdAt: "2026-11-01", endsAt: "2026-11-08", monthlyCents: 7900 },
  ],
  lapsed: 2,
  lapsedSignups: [{ date: "2026-10-12" }, { date: "2026-10-18" }],
};
const fc = investorFigures(costIn);
const cp = (d: string) => fc.cost.points.find((p) => p.date === d)!;
check("one point a day from the first day to 90 days past today", fc.cost.points.length === 26 + 90 && fc.cost.points[0].date === "2026-10-08" && fc.cost.points.at(-1)!.date === "2027-01-31");
check("the first days count no customer yet (Oct 16 counts the signups of Oct 8 only)", cp("2026-10-16").through === "2026-10-08" && cp("2026-10-16").grossCents === null && cp("2026-10-16").netCents === null);
check("Oct 20 counts the signups up to Oct 12: $500 ÷ 1 = $500 to win; it paid 4 days of $79 = $10.53 → $489.47 after", cp("2026-10-20").grossCents === 50000 && cp("2026-10-20").paidCents === 1053 && cp("2026-10-20").netCents === 48947);
check("today is the headline: $1,800 ÷ 3 = $600 to win (signups up to Oct 25) — counted, not projected", cp("2026-11-02").grossCents === fc.unit.costPerPayingCents && fc.unit.costPerPayingCents === 60000 && cp("2026-11-02").customers === 3 && !cp("2026-11-02").projected);
check("…after paying: they paid 17 + 13 + 7 days of $79 = $97.43 → ($1,800 − $97.43) ÷ 3 = $567.52", cp("2026-11-02").paidCents === 9743 && cp("2026-11-02").netCents === 56752);
check("up to today only paying customers count; tomorrow the Oct 26 signup who paid today joins: $1,900 ÷ 4", cp("2026-11-03").projected && cp("2026-11-03").customers === 4 && cp("2026-11-03").grossCents === 47500);
check("a week on, the running trials join at the measured 2/3: 4 + 4 × 2/3 = 6.7 customers for $2,600", cp("2026-11-10").customers === 6.7 && cp("2026-11-10").grossCents === 39000);
const pc = fc.cost.pace;
check("today's pace: $100 a day ÷ (0.71 signups a day × 2/3) = $210 a new customer; 2.7 months at $79", pc.costCents === 21000 && pc.spendPerDayCents === 10000 && pc.signupsPerDay === 0.71 && pc.monthlyCents === 7900 && pc.paybackMonths === 2.7);
check("…so the cost to win falls toward it: $600 today, $236 in 90 days — never below the pace", cp("2027-01-31").grossCents! < 60000 && cp("2027-01-31").grossCents! > pc.costCents! && near(cp("2027-01-31").grossCents!, 23625, 1));
check("after paying falls faster than to win, and stays under it", fc.cost.points.filter((p) => p.grossCents !== null).every((p) => p.netCents! <= p.grossCents!) && cp("2027-01-31").netCents! < cp("2027-01-31").grossCents! / 2);
check("paid back: the first day 'after paying' reaches $0, April 13, 2027 — within the 180-day horizon", fc.cost.paidBack.date === "2027-04-13" && fc.cost.paidBack.daysFromToday === 162 && fc.cost.paidBack.searchedDays === 180);
const wk = fc.cost.weeks;
check("week by week from the start day: four weeks, the last still running", wk.length === 4 && wk[0].from === "2026-10-08" && wk[3].to === "2026-11-04");
check("…each week's ads ÷ its signups' customers: $700 ÷ 2 = $350, then $700 ÷ 1 = $700 — both counted", wk[0].costCents === 35000 && wk[0].state === "counted" && wk[1].costCents === 70000 && wk[1].state === "counted");
check("…a week with trials running expects them at the rate: $700 ÷ (1 + 2/3) = $420; this week's $500 ÷ 2 = $250", wk[2].state === "trial" && wk[2].expected === 0.7 && wk[2].costCents === 42000 && wk[3].state === "trial" && wk[3].costCents === 25000);
const cs = customerCostStory(fc);
check("the words: today, to win and after paying", cs.now === "Today a customer has cost $600 to win ($1,800 of ads up to Oct 25 ÷ 3 paying customers), and $568 after what those customers have paid since.", cs.now);
check("…week by week, a rise read as a rise", cs.weeks === "Week by week: $350 a customer for the first week's signups (Oct 8–14), $700 for the latest week whose trials are over (Oct 15–21) — 100% more.", cs.weeks ?? "");
check("…the pace, 90 days on, and the day it is paid back", /a new customer costs \$210 to win and pays it back in 2\.7 months at \$79 a month\.$/.test(cs.pace ?? "") && /^In 90 days at that pace \(January 31, 2027\): \$236 a customer to win — down from \$600 today/.test(cs.ahead ?? "") && cs.paidBack === "At that pace the ads' own customers pay back every ad dollar counted on April 13, 2027 — in 162 days.", `${cs.pace} | ${cs.ahead} | ${cs.paidBack}`);
const noRate = investorFigures({ ...costIn, paying: [], lapsed: 0, lapsedSignups: [] });
check("no trial ended: no pace, nothing projected, no weekly cost for weeks in trial", noRate.cost.pace.costCents === null && noRate.cost.pace.customersPerDay === null && noRate.cost.points.every((p) => p.customers === 0) && noRate.cost.weeks.every((w) => w.costCents === null));
check("…and the words say no customer is counted yet, with no pace or projection", /have not brought a paying customer yet/.test(customerCostStory(noRate).now) && customerCostStory(noRate).pace === null && customerCostStory(noRate).ahead === null);
const young = investorFigures({ ...costIn, since: "2026-10-30" });
check("younger than a trial: no customer counted, and the day the first are", young.unit.matured.through === null && /the first are counted on November 7, 2026/.test(customerCostStory(young).now), customerCostStory(young).now);
const noAds = investorFigures({ ...costIn, spend: [] });
check("no ads: $0 to win, no pace, nothing to pay back", noAds.cost.points.find((p) => p.date === "2026-11-02")!.grossCents === 0 && noAds.cost.pace.costCents === null && noAds.cost.paidBack.date === null && customerCostStory(noAds).paidBack === null);

console.log("── the curve");
check("one point per day from the launch to the horizon, booked then projected", f.curve.length === 7 + 180 && f.curve[0].date === "2026-09-30" && !f.curve[6].projected && f.curve[7].projected);
check("spend runs: $700 today, $800 tomorrow", f.curve[6].spendCents === 70000 && f.curve[7].spendCents === 80000);
const t0 = f.curve[6];
check("today: MRR $158, 2 paying, 6 signed up (no trial over yet)", t0.mrrCents === 15800 && t0.paying === 2 && t0.signups === 6);
const oct11 = f.curve.find((p) => p.date === "2026-10-11")!;
const oct10 = f.curve.find((p) => p.date === "2026-10-10")!;
check("Oct 11: the first trial ends and counts at the measured 2/3 — MRR $158 + $52.67, 2.7 paying", oct11.mrrCents === Math.round(15800 + 7900 * (2 / 3)) && oct11.paying === 2.7 && oct10.mrrCents === 15800);
check("…its revenue grows by that day's MRR ÷ 30", near(oct11.revenueCents - oct10.revenueCents, (15800 + 7900 * (2 / 3)) / 30, 2));
check("future signups (0.5 a day at $102) start earning at the rate seven days after they arrive", f.curve[14].revenueCents - f.curve[13].revenueCents > f.curve[13].revenueCents - f.curve[12].revenueCents);
check("break-even: a date within the horizon, after today", f.breakEven.withinHorizon && f.breakEven.date !== null && f.breakEven.daysFromToday! > 0 && f.breakEven.daysFromToday! < 180, `${f.breakEven.date} in ${f.breakEven.daysFromToday} days`);
const cross = f.curve.find((p) => p.date === f.breakEven.date)!;
const before = f.curve[f.curve.indexOf(cross) - 1];
check("…and it is the first day revenue meets the spend", cross.revenueCents >= cross.spendCents && before.revenueCents < before.spendCents);

console.log("── no rate yet, or none staying");
const noneEnded = investorFigures({ ...base, paying: [], lapsed: 0 });
check("no trial ended: no rate, no range, nothing expected", noneEnded.rate.pct === null && noneEnded.rate.lowPct === null && noneEnded.expected.payers === null && noneEnded.expected.mrrCents === null && noneEnded.expected.mrrWithPayingCents === 0);
check("…the curve counts no running trial (nothing to predict with)", noneEnded.curve.every((p) => p.mrrCents === 0 && p.paying === 0));
check("…and the sentence says there is no measured rate", /No trial has ended yet, so there is no measured rate/.test(standingSentence(noneEnded)) && /Until a trial ends/.test(outlookSentence(noneEnded)), standingSentence(noneEnded));
const noneStayed = investorFigures({ ...base, paying: [], lapsed: 3 });
check("3 ended, none paying: 0%, 0 expected, the running trials add nothing", noneStayed.rate.pct === 0 && noneStayed.expected.payers === 0 && noneStayed.expected.mrrCents === 0 && noneStayed.rate.highPct! > 0);
check("…no cost per paying customer and no payback", noneStayed.unit.costPerPayingCents === null && noneStayed.unit.paybackMonths === null);

console.log("── the sentences");
const standing = standingSentence(f);
check("what the ads bought, the measured rate, and what it says of the running trials", /^\$700 on ads since Sep 30 brought 7 signups with a card\./.test(standing) && /Of the 3 trials that have ended, 2 converted to a paid plan — 67%\./.test(standing) && /about 3 of the 4 trials running now will pay too \(likely 1–4\)\./.test(standing), standing);
check("no 60%, no 'if every trial pays', no 'realistic' anywhere", !/realistic|every trial pays|60%/i.test(standing + outlookSentence(f)));
check("the outlook names the pace, the measured share and the date", /\$100 a day on ads, 0\.5 signups a day, 67% of trials converting/.test(outlookSentence(f)) && /on [A-Z][a-z]+ \d+, 202\d\./.test(outlookSentence(f)), outlookSentence(f));
const heavy = investorFigures({ ...base, forwardSpendCents: 100000 });
check("$1,000 a day with this revenue never breaks even in the horizon, and the sentence says so", !heavy.breakEven.withinHorizon && /do not pay for themselves/.test(outlookSentence(heavy)));
const none = investorFigures({ ...base, spend: [] });
check("no spend: nothing to earn back, no unit costs", none.spend.totalCents === 0 && none.unit.costPerSignupCents === null && none.unit.paybackMonths === null && /nothing to earn back/.test(outlookSentence(none)) && /No ad spend is booked/.test(standingSentence(none)));
const covered = investorFigures({ ...base, spend: [{ date: "2026-09-30", cents: 500 }] });
check("$5 of spend is already covered: the sentence says so", /already covered/.test(outlookSentence(covered)));
check("no visitors known → no per-visitor figures", investorFigures({ ...base, visitors: null }).unit.costPerVisitorCents === null && investorFigures({ ...base, visitors: 0 }).unit.visitorToSignupPct === null);
check("dollars read as written", dollars(34220) === "$342" && dollars(158) === "$1.58" && dollars(0) === "$0");

console.log("── month by month");
const pace = monthlyPace(f.curve);
check("a month of ads = the last 7 days' spend × 30: $3,000 on the first day, today and ahead", pace[0] === 300000 && pace[6] === 300000 && pace[40] === 300000);
check("…and a young pace counts only the days there were (Sep 30 alone = $100 × 30)", monthlyPace(investorFigures({ ...base, spend: [{ date: "2026-09-30", cents: 10000 }] }).curve)[1] === 150000);
const halfDay = investorFigures({ ...base, spend: base.spend.map((d) => (d.date === "2026-10-06" ? { ...d, cents: 1500 } : d)) });
const halfPace = monthlyPace(halfDay.curve, "2026-10-06");
check("today, half-read ($15 so far), counts at the week's pace — no dip at today or the week after", halfPace[6] === 300000 && halfPace[8] === 300000 && monthlyPace(halfDay.curve)[6] < 300000);
check("…but a today that already spent more than the week's pace keeps its own figure", monthlyPace(investorFigures({ ...base, spend: base.spend.map((d) => (d.date === "2026-10-06" ? { ...d, cents: 17000 } : d)) }).curve, "2026-10-06")[6] === 330000);
const w2 = runRateWindow(f.curve, "2026-10-06", 2);
check("the window: 2 days back and 2 ahead of today (Oct 4 → Oct 8); 30 back clips to the first day; All is everything", w2.from === 4 && w2.to === 8 && w2.todayIndex === 6 && runRateWindow(f.curve, "2026-10-06", 30).from === 0 && runRateWindow(f.curve, "2026-10-06", null).to === f.curve.length - 1);
const rd = runRateReading(f.curve, pace, 6);
check("today read out: $158 a month in, $3,000 of ads, revenue covers 5%", rd.revenueCents === 15800 && rd.adsCents === 300000 && rd.coverPct === 5 && !rd.projected);
const pm = payMonthlyDay(f.curve, pace, 6);
check("the day a month first earns more than its ads: the first day revenue ≥ ads, the day before not", pm !== null && f.curve[pm.index].mrrCents >= pace[pm.index] && f.curve[pm.index - 1].mrrCents < pace[pm.index - 1] && pm.inDays === pm.index - 6, pm ? `${pm.date} in ${pm.inDays} days` : "none");
const st2 = runRateStory(f.curve, "2026-10-06", 2, 67);
check("the words — today", st2.now === "Today a month brings in $158 against $3,000 of ads — revenue covers 5% of the ads.", st2.now);
check("…the last 2 days: $79 → $158, +100%; the ads held", st2.past === "In the last 2 days, revenue per month grew $79 (+100%), from $79 to $158; a month of ads stayed at $3,000.", st2.past ?? "");
check("…the next 2 days at today's pace and the measured 67%", st2.ahead === "In 2 days, at today's pace and with 67% of trials converting, as measured: $158 a month in, $3,000 a month of ads.", st2.ahead ?? "");
check("…and the day each month first earns more than its ads (Dec 30, in 85 days)", pm?.date === "2026-12-30" && pm?.inDays === 85 && st2.cross === "From December 30, 2026 — in 85 days — each month brings in more than its ads cost.", st2.cross);
const fromStart = runRateStory(f.curve, "2026-10-06", 30, 67).past ?? "";
check("a view from the first day counts the growth from $0 (nothing paying on Sep 30 here)", fromStart === "Since Sep 30, revenue per month grew from $0 to $158; a month of ads stayed at $3,000.", fromStart);
const withEarly = investorFigures({ ...base, paying: [...base.paying, { startedAt: "2026-09-01", monthlyCents: 9900, signedUpAt: "2026-08-20", preexisting: true }] });
const fromStartEarly = runRateStory(withEarly.curve, "2026-10-06", 30, 67).past ?? "";
check("…and with accounts already paying that first day: the true multiple and the total — the start not shown", fromStartEarly === "Since Sep 30, monthly revenue grew 2.6×, to $257. A month of ads stayed at $3,000." && !/\$99/.test(fromStartEarly), fromStartEarly);
check("the growth: a month in on the first day against today, the multiple only from a real start", withEarly.growth.fromCents === 9900 && withEarly.growth.toCents === 25700 && withEarly.growth.multiple === 2.6 && withEarly.growth.days === 6 && f.growth.fromCents === 0 && f.growth.multiple === null);
check("cost per lead = spend ÷ signups ($100); per customer EXPECTED = spend ÷ (2 paying + 4 trials × 2/3) = $700 ÷ 4.67 = $150; the counted one waits for a trial to be over", f.unit.costPerSignupCents === 10000 && f.unit.costPerCustomerExpectedCents === 15000 && f.unit.costPerPayingCents === null);
check("…and no expected cost without a measured rate", investorFigures({ ...base, paying: [], lapsed: 0 }).unit.costPerCustomerExpectedCents === null);
check("…a shorter view still says how it moved in those days", /^In the last 2 days, revenue per month grew \$79/.test(runRateStory(withEarly.curve, "2026-10-06", 2, 67).past ?? ""));
check("one day: \"Since yesterday\"", (runRateStory(f.curve, "2026-10-06", 1, 67).past ?? "").startsWith("Since yesterday, revenue per month grew $79 (+100%), from $79 to $158"));
check("no ads running: said so; a month that already earns more than its ads: said so", runRateStory(investorFigures({ ...base, spend: [] }).curve, "2026-10-06", 7, 67).now === "Today a month brings in $158, and no ads are running." && runRateStory(investorFigures({ ...base, spend: [{ date: "2026-10-06", cents: 100 }] }).curve, "2026-10-06", 7, 67).cross === "Already today a month brings in more than its ads cost.");

console.log("── what if more trials converted");
const measured = f.rate.share as number;
check("the exact share is kept beside the whole % (2/3, 67%)", Math.abs(measured - 2 / 3) < 1e-9 && f.rate.pct === 67);
check("at the measured share the what-if IS the solid line, every day", f.curve.every((p) => { const w = whatIfPoint(p, measured, measured); return w.mrrCents === p.mrrCents && w.revenueCents === p.revenueCents && w.paying === p.paying; }));
const o11 = f.curve.find((p) => p.date === "2026-10-11")!;
check("Oct 11, the first trial over: at 100% a month is $158 + $79 = $237; at 0%, the paying $158 alone", o11.trialsMrrAllCents === 7900 && whatIfPoint(o11, measured, 1).mrrCents === 23700 && whatIfPoint(o11, measured, 0).mrrCents === 15800 && whatIfPoint(o11, measured, 1).paying === 3);
check("every day up to today stays as it was at any share — only what is still to come moves", f.curve.filter((p) => !p.projected).every((p) => whatIfPoint(p, measured, 1).mrrCents === p.mrrCents && whatIfPoint(p, measured, 0).revenueCents === p.revenueCents));
check("more converting = more each day ahead (the horizon's end at 90% above the measured 67%)", whatIfPoint(f.curve.at(-1)!, measured, 0.9).mrrCents > f.curve.at(-1)!.mrrCents);
const up = whatIfStory(f.curve, "2026-10-06", 30, measured, 90);
check("the words at 90%: a month in 30 days, how much more, and both days sooner", /^If 90% of trials converted instead of 67%: in 30 days a month would bring in \$[\d,]+ \(\$[\d,]+ more\); each month would earn more than its ads from [A-Z][a-z]+ \d+, 202\d — \d+ days? sooner; the ads would have paid for themselves from [A-Z][a-z]+ \d+, 202\d — \d+ days? sooner\.$/.test(up), up);
const down = whatIfStory(f.curve, "2026-10-06", 30, measured, 20);
check("…and at 20%: less (no double minus), and later — or not within the horizon, said plainly", /\(\$[\d,]+ less\)/.test(down) && !/−\$/.test(down) && /(later|no month would earn more than its ads within the next|the ads would not pay for themselves within the next)/.test(down), down);
check("a 1-day view still looks 30 days ahead for the what-if", /in 30 days a month would bring in/.test(whatIfStory(f.curve, "2026-10-06", 1, measured, 90)));

console.log("── days since launch");
check("the launch day is day 1; Oct 5 → Oct 24 is day 20", launchDay("2026-10-24", "2026-10-24").day === 1 && launchDay("2026-10-05", "2026-10-24").day === 20);
check("across a month and a year end: Sep 30 → Oct 6 is day 7, Dec 31 → Jan 1 is day 2", launchDay("2026-09-30", "2026-10-06").day === 7 && launchDay("2026-12-31", "2027-01-01").day === 2);
check("a launch day still ahead reads as day 0, never negative; 'set' says whether the owner gave it", launchDay("2026-11-01", "2026-10-24").day === 0 && launchDay("2026-10-05", "2026-10-24", false).set === false);


// ── HOW THE TRIALS ENDED (2026-10-25): converted = paid at the end or later; only who never paid counts against
console.log("── how the trials ended");
check("23 of 40 is 57.5% and reads 58%, not the float's 57", investorFigures({ ...base, outcomes: [...Array.from({ length: 23 }, () => ({ date: "2026-10-01", outcome: "paid" as const, payingNow: true })), ...Array.from({ length: 17 }, () => ({ date: "2026-10-01", outcome: "canceled" as const, payingNow: false }))] }).rate.pct === 58);
const ended: ModelInput = { ...base, outcomes: [
  { date: "2026-10-01", outcome: "paid", payingNow: true },
  { date: "2026-10-02", outcome: "came-back", payingNow: true, afterDays: 5 },
  { date: "2026-10-02", outcome: "canceled", payingNow: false },
  { date: "2026-10-03", outcome: "retrying", payingNow: false },
] };
const fe = investorFigures(ended);
check("paid at the end + came back later + a card inside its two-week retry window = 3 converted; canceled = 1 not: 3 of 4 = 75%", fe.rate.paid === 3 && fe.rate.ended === 4 && fe.rate.pct === 75);
check("the count of who came back later (1, after 5 days), and the rest kept for the QA", fe.outcomes?.cameBack === 1 && fe.outcomes?.cameBackDays === 5 && fe.outcomes?.paidAtEnd === 1 && fe.outcomes?.canceled === 1 && fe.outcomes?.retrying === 1 && fe.outcomes?.unpaid === 0);
const left = investorFigures({ ...base, outcomes: [{ date: "2026-10-01", outcome: "paid", payingNow: false }, { date: "2026-10-02", outcome: "came-back", payingNow: false, afterDays: 9 }, { date: "2026-10-02", outcome: "unpaid", payingNow: false }] });
check("a converted one that left since still converted (2 of 3); never paid counts against", left.rate.paid === 2 && left.rate.ended === 3 && left.outcomes?.leftAfterPaying === 2 && left.outcomes?.unpaid === 1);
check("the lead says how many came back", /3 converted to a paid plan \(1 of them came back after the trial had ended\) — 75%/.test(standingSentence(fe)), standingSentence(fe));
check("a card inside its retry window is not 'paid, then left' — it has not paid yet", fe.outcomes?.leftAfterPaying === 0);
check("no outcomes read: the rate falls back to paying ÷ paying + lapsed, and there is no count", f.outcomes === null && f.rate.paid === 2 && f.rate.ended === 3);
const withOc: ModelInput = { ...base, outcomes: [{ date: "2026-10-05", cohort: "nocard", outcome: "paid", payingNow: true }, { date: "2026-10-02", cohort: "card", outcome: "came-back", payingNow: true, afterDays: 3 }, { date: "2026-10-02", cohort: "card", outcome: "canceled", payingNow: false }], cohorts: { lapsed: { card: 1, nocard: 0 }, signups: [{ date: "2026-10-02", cohort: "card" }, { date: "2026-10-05", cohort: "nocard" }], policy: [], current: "card" } };
const cutOc = splitApart(withOc);
check("each side reads its own outcomes: the card side 1 of 2 (1 came back), the no-card day's outcome stays out", cutOc.card.rate.paid === 1 && cutOc.card.rate.ended === 2 && cutOc.card.outcomes?.cameBack === 1 && cutOc.apart.rate.paid === 1 && cutOc.apart.rate.ended === 1);


// ── THE TWO KINDS OF TRIAL (2026-10-13): a day's spend follows the switch where recorded, else who signed up
console.log("── cohorts");
const days = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06"];
const su = [
  { date: "2026-10-01", cohort: "card" as const },
  { date: "2026-10-03", cohort: "nocard" as const },
  { date: "2026-10-04", cohort: "card" as const }, { date: "2026-10-04", cohort: "nocard" as const }, { date: "2026-10-04", cohort: "nocard" as const },
];
const sh = noCardShareByDay(days, su, []);
check("a day of card signups is a card day; a day of no-card signups a no-card day", sh.get("2026-10-01") === 0 && sh.get("2026-10-03") === 1);
check("a mixed day splits in proportion (1 card, 2 no-card → two thirds)", near(sh.get("2026-10-04") ?? -1, 2 / 3, 0.001));
check("a day with no signups follows the nearest earlier day that had some", sh.get("2026-10-02") === 0 && near(sh.get("2026-10-05") ?? -1, 2 / 3, 0.001) && near(sh.get("2026-10-06") ?? -1, 2 / 3, 0.001));
const sh2 = noCardShareByDay(days, su, [{ from: "2026-10-05", mode: "card" }]);
check("a recorded flip outranks the signups from its day on", sh2.get("2026-10-05") === 0 && sh2.get("2026-10-06") === 0 && near(sh2.get("2026-10-04") ?? -1, 2 / 3, 0.001));
check("with no signups and no flips every day is a card day (the only kind before the switch)", [...noCardShareByDay(days, [], []).values()].every((v) => v === 0));

const withCohorts: ModelInput = {
  ...base,
  paying: [{ startedAt: "2026-10-02", monthlyCents: 7900, cohort: "card" }, { startedAt: "2026-10-06", monthlyCents: 7900, signedUpAt: "2026-10-05", cohort: "nocard" }],
  trials: [
    { createdAt: "2026-10-04", endsAt: "2026-10-11", monthlyCents: 7900, cohort: "card" },
    { createdAt: "2026-10-05", endsAt: "2026-10-12", monthlyCents: 2900, cohort: "nocard" },
    { createdAt: "2026-10-06", endsAt: "2026-10-13", monthlyCents: 19900, cohort: "nocard" },
    { createdAt: "2026-10-06", endsAt: null, monthlyCents: null, cohort: "nocard" },
  ],
  lapsed: 1,
  lapsedSignups: [{ date: "2026-10-01", cohort: "card" }],
  cohorts: {
    lapsed: { card: 1, nocard: 0 },
    signups: [
      { date: "2026-09-30", cohort: "card" }, { date: "2026-10-02", cohort: "card" }, { date: "2026-10-04", cohort: "card" },
      { date: "2026-10-05", cohort: "nocard" }, { date: "2026-10-05", cohort: "nocard" }, { date: "2026-10-06", cohort: "nocard" }, { date: "2026-10-06", cohort: "nocard" },
    ],
    policy: [],
    current: "nocard",
  },
};
// ── KEPT APART (2026-10-24): a day with any no-card share goes apart WHOLE, with every signup on it
console.log("── kept apart");
check("a day goes apart whole on any no-card share — the mixed Oct 4 too", [...apartDays(days, su, [])].sort().join() === "2026-10-03,2026-10-04,2026-10-05,2026-10-06");
const whole = investorFigures(withCohorts);
const cut = splitApart(withCohorts, whole);
check("the no-card days Oct 5–6 go apart; the card days stay; the start day stays (they are not all first)", cut.days.join() === "2026-10-05,2026-10-06" && cut.cardSince === "2026-09-30" && cut.card.since === "2026-09-30");
check("their WHOLE spend goes apart ($200) and the card days keep theirs ($500) — together the whole", cut.spendCents === 20000 && cut.apart.spend.totalCents === 20000 && cut.card.spend.totalCents === 50000 && cut.card.spend.totalCents + cut.spendCents === whole.spend.totalCents);
check("each side counts its own accounts: card 1 trial, 1 won, 1 lapsed; apart 3 trials, 1 paying", cut.card.trials.count === 1 && cut.card.paying.won === 1 && cut.card.lapsed === 1 && cut.apart.trials.count === 3 && cut.apart.paying.count === 1 && cut.apart.lapsed === 0);
check("a no-card trial that pays now joins the card side's paying, marked (2026-10-25): 2 paying, 1 from no card, $79", cut.card.paying.count === 2 && cut.card.paying.fromNoCard === 1 && cut.card.paying.fromNoCardMrrCents === 7900 && cut.card.paying.mrrCents === 15800);
check("…but not its signups, its rate, or the customers won: 1 won (no card trial over yet, so no cost yet)", cut.card.signups === 3 && cut.card.rate.paid === 1 && cut.card.paying.won === 1 && cut.card.unit.costPerPayingCents === null && cut.card.unit.matured.won === 0);
check("…the signups add up to the whole, and the apart ones are told by kind (4 no card, 0 card)", cut.card.signups + cut.apart.signups === whole.signups && cut.signups.nocard === 4 && cut.signups.card === 0);
check("each side measures its own rate: card 1 of 2 = 50%, no card 1 of 1 = 100%", cut.card.rate.pct === 50 && cut.card.rate.ended === 2 && cut.apart.rate.pct === 100 && cut.apart.rate.ended === 1);
check("the kind a new signup gets today keeps spending forward (no card here); the card side stands still", cut.apart.spend.perDayProjectedCents === whole.spend.perDayProjectedCents && cut.card.spend.perDayProjectedCents === 0 && cut.card.curve.filter((p) => p.projected).every((p) => p.spendCents === 50000));
check("visitors stay with the card side only", cut.card.visitors === withCohorts.visitors && cut.apart.visitors === null);
const anyway: ModelInput = { ...withCohorts, trials: [...withCohorts.trials, { createdAt: "2026-10-05", endsAt: "2026-10-12", monthlyCents: 9900, cohort: "card" }], cohorts: { ...withCohorts.cohorts!, signups: [...withCohorts.cohorts!.signups, { date: "2026-10-05", cohort: "card" }] } };
const cutAnyway = splitApart(anyway);
check("a card given anyway on a no-card day goes apart too — it came in under the no-card offer", cutAnyway.card.trials.count === 1 && cutAnyway.apart.trials.count === 4 && cutAnyway.signups.card === 1 && cutAnyway.signups.nocard === 4);
const strayPolicy = [{ from: "2026-10-02", mode: "card" as const }, { from: "2026-10-05", mode: "nocard" as const }];
const stray: ModelInput = { ...withCohorts, trials: [...withCohorts.trials, { createdAt: "2026-10-03", endsAt: "2026-10-10", monthlyCents: 4900, cohort: "nocard" }], cohorts: { ...withCohorts.cohorts!, policy: strayPolicy, signups: [...withCohorts.cohorts!.signups, { date: "2026-10-03", cohort: "nocard" }] } };
const cutStray = splitApart(stray);
check("a no-card trial on a card day (the switch said card) goes apart as an account; its day's spend stays", !cutStray.days.includes("2026-10-03") && cutStray.apart.trials.count === 4 && cutStray.card.spend.totalCents === 50000);
const early: ModelInput = { ...withCohorts, cohorts: { ...withCohorts.cohorts!, signups: [{ date: "2026-09-30", cohort: "nocard" }, { date: "2026-10-01", cohort: "nocard" }, { date: "2026-10-02", cohort: "card" }, { date: "2026-10-04", cohort: "card" }] } };
const cutEarly = splitApart(early);
check("no-card days that all come first: the card figures count from the first card day (Oct 2)", cutEarly.days.join() === "2026-09-30,2026-10-01" && cutEarly.cardSince === "2026-10-02" && cutEarly.card.since === "2026-10-02" && cutEarly.card.daysLive === 5 && cutEarly.card.spend.totalCents === 50000 && cutEarly.card.curve[0].date === "2026-10-02");
check("with no no-card days and no cohort block: nothing apart, the card side is the whole", (() => { const c = splitApart(base); return c.days.length === 0 && c.spendCents === 0 && c.card.spend.totalCents === investorFigures(base).spend.totalCents && c.card.trials.count === base.trials.length && c.apart.signups === 0; })());


// ── PAYING FROM BEFORE THE START DAY (2026-10-13): counted as paying, in the revenue and the payback; not a signup
console.log("── pre-period paying");
const withBefore: ModelInput = { ...base, paying: [...base.paying, { startedAt: "2026-09-01", monthlyCents: 9900, signedUpAt: "2026-08-20", cohort: "card", preexisting: true }] };
const fb = investorFigures(withBefore);
const f0 = investorFigures(base);
check("it counts as paying, in the run rate", fb.paying.count === f0.paying.count + 1 && fb.paying.mrrCents === f0.paying.mrrCents + 9900 && fb.paying.preexisting === 1 && fb.paying.preexistingMrrCents === 9900);
check("…its revenue counts from the start day only (7 days of $99 = $23.10)", fb.paying.revenueToDateCents === f0.paying.revenueToDateCents + 2310, `${fb.paying.revenueToDateCents - f0.paying.revenueToDateCents}`);
check("…it is not a signup, and does not move the pace, the cost per signup or the measured rate", fb.signups === f0.signups && fb.unit.signupsPerDay === f0.unit.signupsPerDay && fb.unit.costPerSignupCents === f0.unit.costPerSignupCents && fb.rate.pct === f0.rate.pct && fb.rate.ended === f0.rate.ended);
check("…nor the cost per paying customer or the payback (the ads did not win it)", fb.unit.costPerPayingCents === f0.unit.costPerPayingCents && fb.unit.paybackMonths === f0.unit.paybackMonths && fb.paying.won === f0.paying.won);
check("…but it pays into the curve from the first day", fb.curve[0].mrrCents === f0.curve[0].mrrCents + 9900 && fb.curve[0].paying === f0.curve[0].paying + 1);
const cutB = splitApart({ ...withCohorts, paying: [...withCohorts.paying, { startedAt: "2026-09-01", monthlyCents: 9900, cohort: "card", preexisting: true }] });
check("it sits on the card side's paying, not the apart side's, and in neither's signups", cutB.card.paying.count === cut.card.paying.count + 1 && cutB.card.paying.preexisting === 1 && cutB.card.signups === cut.card.signups && cutB.apart.paying.count === cut.apart.paying.count);

console.log(bad === 0 ? "\nAll investor model checks passed." : `\n${bad} investor model check(s) FAILED.`);
process.exit(bad === 0 ? 0 : 1);
