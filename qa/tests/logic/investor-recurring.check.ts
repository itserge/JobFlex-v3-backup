// Recurring revenue for investors (lib/investorRecurring, 2026-11-02): MRR and ARR today, and at today's pace ahead
// — the running trials on the day each ends, new signups after their trial, the measured share and churn, the likely
// range, the milestones, a bigger budget — on fixtures with hand-checked answers.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/investor-recurring.check.ts
import { addDays } from "../../../src/lib/investorModel";
import { aheadAt, bigDollars, milestoneMarks, milestoneWhen, recurringAhead, recurringStory, type RecurringInput } from "../../../src/lib/investorRecurring";

let bad = 0;
const check = (name: string, ok: boolean, detail: unknown = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail !== "" ? ` — ${JSON.stringify(detail)}` : ""}`);
};

const today = "2026-11-02";
// $1,000 a month from 10 customers; 2 trials ($100 each after the trial) end on Nov 5; 2 signups a day on $100 a day of
// ads, 6 of 10 trials converted, a new customer billed $100; 7-day trials; no renewal due yet.
const base: RecurringInput = {
  since: "2026-10-08", today, basis: "stripe", error: null,
  mrrCents: 100_000, customers: 10,
  history: [{ date: "2026-10-08", mrrCents: 0, customers: 0 }, { date: today, mrrCents: 100_000, customers: 10 }],
  moved: { from: "2026-10-08", days: 26, startCents: 0, newCents: 110_000, newCount: 11, lostCents: 10_000, lostCount: 1 },
  trialsEnding: [{ date: "2026-11-05", cents: 20_000, count: 2 }],
  signupsPerDay: 2, spendPerDayCents: 10_000, trialDays: 7, newCustomerCents: 10_000,
  converted: 6, ended: 10,
  churn: { left: 0, due: 0, firstRenewal: "2026-11-14" },
};

console.log("── today's pace");
const a = recurringAhead(base);
const at = (k: number) => a.points[k].mrrCents;
check("today is today's MRR", a.points[0].date === today && at(0) === 100_000);
check("nothing changes until a trial ends (Nov 3, 4)", at(1) === 100_000 && at(2) === 100_000);
check("the two trials ending Nov 5 add 60% of their $200: +$120", a.points[3].date === "2026-11-05" && at(3) === 112_000, at(3));
check("tomorrow's signups pay after their 7-day trial: nothing new through day 7", at(7) === 112_000, at(7));
check("from day 8, each day adds 2 × 60% × $100 = $120", at(8) === 124_000 && at(9) === 136_000, [at(8), at(9)]);
check("in 12 months: $1,120 + 358 days × $120 = $44,080 a month", a.points.length === 366 && at(365) === 4_408_000, at(365));
check("each day of ads adds $120 of MRR; every $1 of ads adds $14.40 of ARR", a.addPerDayCents === 12_000 && a.arrPerAdDollar === 14.4, [a.addPerDayCents, a.arrPerAdDollar]);
check("no churn measured: none taken off, no level", a.churn === 0 && a.plateauCents === null);
check("the likely range sits around the middle, and widens", a.points.every((p) => p.lowCents <= p.mrrCents && p.mrrCents <= p.highCents) && aheadAt(a, 365).highCents - aheadAt(a, 365).lowCents > aheadAt(a, 30).highCents - aheadAt(a, 30).lowCents);
check("…from the share's 90% range: 6 of 10 is likely about 34–81%", aheadAt(a, 365).lowCents < 3_000_000 && aheadAt(a, 365).highCents > 5_500_000, [aheadAt(a, 365).lowCents, aheadAt(a, 365).highCents]);

console.log("── milestones");
check("the next three ARR marks above $12,000, and $1M", JSON.stringify(milestoneMarks(1_200_000)) === JSON.stringify([2_500_000, 5_000_000, 10_000_000, 100_000_000]), milestoneMarks(1_200_000));
check("$1M is not added twice when it is among the next three", JSON.stringify(milestoneMarks(30_000_000)) === JSON.stringify([50_000_000, 100_000_000, 250_000_000]));
const m25 = a.milestones.find((m) => m.arrCents === 2_500_000)!;
// $25k ARR = $2,083.34 a month: $1,120 + (k − 7) × $120 ≥ $2,083.34 → k = 16.
check("$25k ARR on day 16 (Nov 18), earlier on the high side, later on the low", m25.date === addDays(today, 16) && !!m25.early && m25.early <= m25.date && !!m25.late && m25.late >= m25.date, m25);
const m1 = a.milestones.find((m) => m.arrCents === 100_000_000)!;
// $1M ARR = $83,333.34 a month: (k − 7) × $120 ≥ $82,213.34 → k = 693.
check("$1M ARR on day 693", m1.date === addDays(today, 693), m1.date);
check("a milestone reads its likely range, the year only when it is not this one", /^likely Nov \d+ – (Nov|Dec) \d+$/.test(milestoneWhen(m25, today)) && / – .+, 2028$|, 2028 – /.test(milestoneWhen(m1, today)), [milestoneWhen(m25, today), milestoneWhen(m1, today)]);
check("a milestone out of reach says so", milestoneWhen({ arrCents: 1, date: null, early: null, late: null }, today) === "not within five years at today's pace");

console.log("── a bigger budget");
const b = recurringAhead(base, 20_000);
check("twice the budget: twice the signups, $240 a day — the same $14.40 of ARR a dollar", b.signupsPerDay === 4 && b.addPerDayCents === 24_000 && b.arrPerAdDollar === 14.4);
check("…the trials running now are the same: $1,120 + 358 × $240 = $87,040 in 12 months", aheadAt(b, 365).mrrCents === 8_704_000, aheadAt(b, 365).mrrCents);
check("…and $1M ARR comes sooner", b.milestones.find((m) => m.arrCents === 100_000_000)!.date! < m1.date!);

console.log("── churn");
const c = recurringAhead({ ...base, churn: { left: 2, due: 10, firstRenewal: null } });
check("2 of 10 left after their first month: 20% a month", Math.abs(c.churn - 0.2) < 1e-9);
check("taken off every day: the first day keeps 0.8^(1/30) of $1,000", at(1) === 100_000 && c.points[1].mrrCents === Math.round(100_000 * Math.pow(0.8, 1 / 30)), c.points[1].mrrCents);
check("MRR levels off where the churn takes what a day adds: $120 ÷ (1 − 0.8^(1/30))", c.plateauCents === Math.round(12_000 / (1 - Math.pow(0.8, 1 / 30))), c.plateauCents);
check("…below it all year, and $1M ARR is out of reach at this budget", aheadAt(c, 365).mrrCents < c.plateauCents! && c.milestones.find((m) => m.arrCents === 100_000_000)!.date === null);

console.log("── no measured rate");
const z = recurringAhead({ ...base, converted: 0, ended: 0 });
check("no trial ended: the line ahead holds today's customers, no milestone, no pace", z.share === null && z.points.every((p) => p.mrrCents === 100_000) && z.milestones.length === 0 && z.addPerDayCents === null);
const zs = recurringStory({ ...base, converted: 0, ended: 0 }, z);
check("…and says so", zs.pace === null && /no measured rate/.test(zs.ahead ?? ""), zs.ahead);

console.log("── the words");
const st = recurringStory(base, a);
check("now: MRR, ARR, customers, the average", st.now === "JobFlex bills $1,000 a month today — $12,000 a year (ARR) — from 10 paying customers, $100 each on average.", st.now);
check("moved: what started and what left since the start day", st.moved === "Since Oct 8: +$1,100 of MRR from 11 new customers, −$100 from 1 customer who left.", st.moved);
check("pace: the spend, the signups, the share, the bill, a day's MRR, ARR a dollar", /^At today's pace — \$100 a day on ads, 2 signups a day, 60% of trials converting, each new customer billed \$100 a month — each day of ads adds about \$120 of MRR once its trials are over: every \$1 of ads adds about \$14\.4 of ARR\.$/.test(st.pace ?? ""), st.pace);
check("ahead: 12 months, MRR, ARR and its range", /^In 12 months \(November 2, 2027\): \$44,080 a month, \$529k ARR — likely \$\d+k to \$\d+k\.$/.test(st.ahead ?? ""), st.ahead);
check("churn: none yet, and when the first renewal comes", st.churn === "No customer has reached a renewal yet — the first comes on Nov 14 — so no churn is taken off; from then on, the measured share who leave is.", st.churn);
check("churn measured: the share, and where MRR levels off", /^Of the 10 customers whose first month is over, 2 left — 20% a month, taken off every month ahead; at this pace MRR levels off near \$16k \(\$194k ARR\) unless the budget grows\.$/.test(recurringStory({ ...base, churn: { left: 2, due: 10, firstRenewal: null } }, c).churn), recurringStory({ ...base, churn: { left: 2, due: 10, firstRenewal: null } }, c).churn);
check("Stripe not read: the record, said so", /Stripe not read/.test(recurringStory({ ...base, basis: "record" }, a).now));
check("big dollars", bigDollars(4_408_000) === "$44k" && bigDollars(52_896_000) === "$529k" && bigDollars(100_000_000) === "$1M" && bigDollars(250_000_000) === "$2.5M" && bigDollars(999_900) === "$9,999");

console.log(bad === 0 ? "\nAll recurring revenue checks passed." : `\n${bad} recurring revenue check(s) FAILED.`);
process.exit(bad === 0 ? 0 : 1);
