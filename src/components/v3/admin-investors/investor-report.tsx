"use client";
// THE INVESTOR REPORT (2026-10-06) — the same page for the admin, for the
// shared link and (in prose) for the PDF: what the ads cost, who signed up,
// who stays after the trial, who pays, and when the ads pay for themselves.
// Read-only; the admin's controls sit around it (admin-investors-content).
// No server imports, no state. One statistic (owner, 2026-10-14): the trials that
// took a card and the ad spend that brought them; the no-card experiment and its
// days' spend are left out and said so in the method note.
// MEASURED, NOT ASSUMED (owner, 2026-10-24): no 60%, no "if every trial pays", no
// behaviour guess — the share that stays is read off the trials that have ended,
// and the running trials are expected to pay at that rate (lib/investorModel).
// CARD DAYS ONLY (owner, 2026-10-24/25): the days free trials needed no card are out
// whole — their spend shown nowhere; the no-card trials that pay now count as paying.
// How many came back later (paid after their trial had ended) is counted.
// THE COST OF A CUSTOMER (owner, 2026-11-02): counted on the signups whose trial is over — the last trial's worth of
// ads bought trials still running, and dividing it by the customers of the weeks before overstated the cost.
// WHAT A CUSTOMER COSTS, FROM THE FIRST DAY (owner, 2026-11-02): to win and after paying, day by day and week by week,
// then at today's pace (customer-cost-chart).
import type { ReactNode } from "react";
import { customerCostStory, dollars, longDate, outlookSentence, standingSentence, type InvestorFigures } from "@/lib/investorModel";
import type { InvestorReport } from "@/lib/investors";
import { CustomerCostChart } from "./customer-cost-chart";
import { PaybackChart } from "./payback-chart";
import { SpendBars } from "./spend-bars";
import s from "./investor-report.module.css";

const n = (v: number) => v.toLocaleString("en-US");
const pct = (v: number | null, suffix = "%") => (v === null ? "—" : `${v}${suffix}`);
const money = (v: number | null) => (v === null ? "—" : dollars(v));
const shortDate = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const about = (v: number) => (Number.isInteger(v) ? n(v) : `≈${n(Math.round(v))}`);

export function InvestorReportView({ report, shared = false, between }: { report: InvestorReport; shared?: boolean; between?: ReactNode }) {
  const f = report.figures;
  const a = report.settings;
  const be = f.breakEven;
  const r = f.rate;
  const ex = f.expected;
  // The counted cost of a customer reads the signups whose trial is over (2026-11-02, lib/investorModel unit.matured).
  const m = f.unit.matured;
  const got = report.collected;
  const periods = report.periods;
  const cardLater = f.since !== report.startDay;
  const oc = f.outcomes;
  const budgetWords = a.dailyBudgetCents !== null && a.dailyBudgetCents !== undefined && a.budgetFrom ? `${dollars(a.dailyBudgetCents)}/day, all ads, since ${shortDate(a.budgetFrom)}${f.spend.bookedDays ? ` · ${f.spend.bookedDays} booked ${f.spend.bookedDays === 1 ? "day" : "days"}` : ""}` : `since ${shortDate(f.since)} · ${dollars(f.spend.perDayRecentCents)}/day lately`;
  const range = r.lowPct !== null && r.highPct !== null ? `likely ${r.lowPct}–${r.highPct}%` : null;
  const expectedRange = ex.payersLow !== null && ex.payersHigh !== null && ex.payersLow !== ex.payersHigh ? `likely ${ex.payersLow}–${ex.payersHigh}` : null;
  return (
    <div className={s.rep} data-investor-report>
      {/* The sentences first: what the ads bought, the measured rate, what it says of the trials running now. */}
      <section className={s.lead} data-tone={be.withinHorizon ? "good" : f.spend.totalCents === 0 ? "none" : "late"} data-lead>
        <div className={s.leadTop}>
          <div className={s.leadLabel}>Where the ads stand today</div>
          {/* Days since launch (owner, 2026-10-24): on the link, where every reader sees it first. */}
          <div className={s.launchDay} data-launch-day={report.launch.day}>
            <b>Day {n(report.launch.day)}</b>
            <span>since JobFlex launched · {longDate(report.launch.date)}</span>
          </div>
        </div>
        <p className={s.leadText} data-standing>{standingSentence(f)}</p>
        <p className={s.leadMore} data-outlook>{outlookSentence(f)}</p>
        <div className={s.leadFacts}>
          {/* The three to read first (owner, 2026-10-25, chose: growth + cost per lead): each true as labelled. */}
          <div data-fact="cost-per-lead"><b>{money(f.unit.costPerSignupCents)}</b><span>{f.signups > 0 ? `per lead · ${dollars(f.spend.totalCents)} ÷ ${n(f.signups)} signups` : "per lead · no signup yet"}</span></div>
          <div data-fact="cost-per-customer-expected"><b>{f.unit.costPerCustomerExpectedCents !== null ? `≈ ${dollars(f.unit.costPerCustomerExpectedCents)}` : money(f.unit.costPerPayingCents)}</b><span>{f.unit.costPerCustomerExpectedCents !== null ? `per customer, expected · once the running trials convert at ${r.pct}%` : "per paying customer"}</span></div>
          <div data-fact="growth"><b>{f.growth.multiple !== null ? `${f.growth.multiple}×` : dollars(f.growth.toCents)}</b><span>{f.growth.multiple !== null ? `revenue in ${f.growth.days} days · ${dollars(f.growth.toCents)} a month now` : `a month in, ${f.growth.days} days in`}</span></div>
        </div>
      </section>

      {/* The numbers. */}
      <section className={s.kpis} aria-label="The figures">
        <Kpi label="Ad spend" value={dollars(f.spend.totalCents)} note={budgetWords} tone="ink" />
        <Kpi label="Visitors" value={f.visitors === null ? "—" : n(f.visitors)} note={f.visitors === null ? "analytics not reached" : `${money(f.unit.costPerVisitorCents)} each`} />
        <Kpi label="Signed up" value={n(f.signups)} note={`${f.unit.signupsPerDay}/day · ${pct(f.unit.visitorToSignupPct)} of visitors · ${money(f.unit.costPerSignupCents)} each`} />
        <Kpi label="Paying" value={n(f.paying.count)} note={`${dollars(f.paying.mrrCents)}/mo · ${dollars(f.paying.arrCents)} a year${f.paying.fromNoCard > 0 ? ` · ${f.paying.fromNoCard} started without a card` : ""}${report.payingUnpriced > 0 ? ` · ${report.payingUnpriced} without a list price` : ""}`} tone="good" />
        <Kpi label="Trial to paid" value={pct(r.pct)} note={r.pct === null ? "no trial has ended yet" : `${r.paid} of ${r.ended} ended trials converted${oc && oc.cameBack > 0 ? ` · ${oc.cameBack} came back later` : ""}${range ? ` · ${range}` : ""}`} tone="blue" data="rate" />
        <Kpi label="On trial now" value={n(f.trials.count)} note={ex.payers === null ? "no measured rate to predict with yet" : `${about(ex.payers)} expected to pay${expectedRange ? ` (${expectedRange})` : ""} · +${dollars(ex.mrrCents ?? 0)}/mo`} tone="trial" data="trials" />
      </section>

      {between}

      <div className={s.twoUp}>
        {/* Who stays after the trial: counted on the trials that ended, then applied to the ones running. */}
        <section className={s.card} data-rate-card>
          <h2 className={s.h2}>Trial to paid, measured</h2>
          <RateBar label={`Trials that ended · ${n(r.ended)}`} parts={[{ value: r.paid - (oc?.cameBack ?? 0), cls: s.segPaid, words: `${n(r.paid - (oc?.cameBack ?? 0))} converted at the end` }, { value: oc?.cameBack ?? 0, cls: s.segBack, words: `${n(oc?.cameBack ?? 0)} came back later` }, { value: r.ended - r.paid, cls: s.segGone, words: `${n(r.ended - r.paid)} did not convert` }]} empty="No trial has ended yet." />
          <RateBar label={`Running now · ${n(f.trials.count)}`} parts={ex.payers === null ? [{ value: f.trials.count, cls: s.segRun, words: `${n(f.trials.count)} on trial` }] : [{ value: ex.payers, cls: s.segExpected, words: `${about(ex.payers)} expected to pay` }, { value: Math.max(0, f.trials.count - ex.payers), cls: s.segRun, words: "" }]} empty="No trial is running now." />
          <table className={s.tbl}>
            <tbody>
              <tr data-row="converted"><td>Converted</td><td className={s.num}>{n(r.paid)}</td><td className={s.sub}>moved to a paid plan · {n(f.paying.won)} paying today, {dollars(f.paying.wonMrrCents)}/mo</td></tr>
              {oc && <tr data-row="came-back"><td>Came back later</td><td className={s.num}>{n(oc.cameBack)}</td><td className={s.sub}>paid after their trial had already ended — counted as converted</td></tr>}
              <tr><td>Did not convert</td><td className={s.num}>{n(r.ended - r.paid)}</td><td className={s.sub}>canceled during the trial, or not paid two weeks after it</td></tr>
              <tr className={s.strong} data-row="rate"><td>Trial to paid</td><td className={s.num}>{pct(r.pct)}</td><td className={s.sub}>{r.pct === null ? "measured once a trial ends" : `${r.paid} of ${r.ended}${r.lowPct !== null && r.highPct !== null ? ` · the true rate is likely ${r.lowPct}–${r.highPct}%` : ""}`}</td></tr>
              <tr><td>On trial now</td><td className={s.num}>{n(f.trials.count)}</td><td className={s.sub}>{dollars(f.trials.mrrCents)}/mo at list price{f.trials.priced < f.trials.count ? ` · ${f.trials.count - f.trials.priced} without a price` : ""}</td></tr>
              <tr data-row="expected"><td>Expected to pay</td><td className={s.num}>{ex.payers === null ? "—" : about(ex.payers)}</td><td className={s.sub}>{ex.payers === null ? "no measured rate yet" : `${expectedRange ? `${expectedRange} · ` : ""}+${dollars(ex.mrrCents ?? 0)}/mo at ${r.pct}%`}</td></tr>
              <tr className={s.strong}><td>Monthly revenue then</td><td className={s.num}>{dollars(ex.mrrWithPayingCents)}</td><td className={s.sub}>paying now {dollars(f.paying.mrrCents)} + expected {dollars(ex.mrrCents ?? 0)}</td></tr>
            </tbody>
          </table>
        </section>

        {/* What came in against what went out. */}
        <section className={s.card} data-against-card>
          <h2 className={s.h2}>Paying against the spend</h2>
          <table className={s.tbl}>
            <tbody>
              <tr><td>Spent on ads</td><td className={s.num}>{dollars(f.spend.totalCents)}</td><td className={s.sub}>since {shortDate(f.since)} · {dollars(f.spend.perDayRecentCents)}/day over the last full week</td></tr>
              <tr className={s.strong} data-row="collected"><td>Collected so far</td><td className={s.num}>{got.read ? dollars(got.cents) : "—"}</td><td className={s.sub}>{got.read ? `Stripe: ${got.invoices} ${got.invoices === 1 ? "payment" : "payments"} since ${shortDate(f.since)}${got.cents !== got.wonCents ? ` · ${dollars(got.wonCents)} from the customers the ads brought` : ""}` : `Stripe not read${got.error ? ` — ${got.error}` : ""}`}</td></tr>
              {report.financed.jobs > 0 ? <tr data-row="financed"><td>Jobs paid with financing</td><td className={s.num}>{dollars(report.financed.cents)}</td><td className={s.sub}>{`Wisetack paid JobFlex contractors on ${report.financed.jobs} ${report.financed.jobs === 1 ? "job" : "jobs"} — measured, all time`}</td></tr> : null}
              <tr><td>Earned at list price</td><td className={s.num}>{dollars(f.paying.revenueToDateCents)}</td><td className={s.sub}>{pct(f.unit.returnToDatePct)} of the spend · each paying account by the day</td></tr>
              <tr><td>Customers the ads brought</td><td className={s.num}>{n(f.paying.won)}</td><td className={s.sub}>paying today · {dollars(f.paying.wonMrrCents)}/mo</td></tr>
              <tr><td>Per signup</td><td className={s.num}>{money(f.unit.costPerSignupCents)}</td><td className={s.sub}>{n(f.signups)} signed up with a card</td></tr>
              <tr data-row="cost-per-customer-expected"><td>Per customer, expected</td><td className={s.num}>{f.unit.costPerCustomerExpectedCents !== null ? `≈ ${dollars(f.unit.costPerCustomerExpectedCents)}` : "—"}</td><td className={s.sub}>{f.unit.costPerCustomerExpectedCents !== null && ex.payers !== null ? `${dollars(f.spend.totalCents)} ÷ (${f.paying.won} paying + ≈${Math.round(ex.payers)} of the trials running, at ${r.pct}%)` : "once a trial has ended"}</td></tr>
              <tr className={s.strong} data-row="cost-per-paying"><td>Per paying customer</td><td className={s.num}>{money(f.unit.costPerPayingCents)}</td><td className={s.sub}>{m.through === null ? "once the first trials are over" : m.won > 0 ? `${dollars(m.spendCents)} ÷ ${m.won} paying · the ads up to ${shortDate(m.through)}, whose trials are over` : `none yet from the signups up to ${shortDate(m.through)}`}</td></tr>
              <tr><td>Earns the spend back in</td><td className={s.num}>{pct(f.unit.paybackMonths, " months")}</td><td className={s.sub}>{m.wonMrrCents > 0 ? `at those customers' ${dollars(m.wonMrrCents)} a month` : "once a customer pays"}</td></tr>
              <tr><td>Per visitor</td><td className={s.num}>{money(f.unit.costPerVisitorCents)}</td><td className={s.sub}>{f.visitors === null ? "no visitor count" : `${n(f.visitors)} visitors`}</td></tr>
            </tbody>
          </table>
        </section>
      </div>

      {/* The costs (owner, 2026-10-08): by period, by day, and by campaign when Meta answers. */}
      <section className={s.card} data-costs>
        <div className={s.cardHead}>
          <h2 className={s.h2}>The ad spend, live</h2>
          <span className={s.cardNote}>
            {report.meta.configured
              ? report.meta.lastPulledAt
                ? `Meta's own figures · read ${new Date(report.meta.lastPulledAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}${report.insights ? ` · ${report.insights.days.length} days · ${report.insights.campaigns.length} ${report.insights.campaigns.length === 1 ? "campaign" : "campaigns"}` : ""}${report.meta.lastError ? ` · last read failed: ${report.meta.lastError}` : ""}`
                : `Meta is connected; its figures arrive with the first read${report.meta.lastError ? ` — last read failed: ${report.meta.lastError}` : ""}`
              : "Figures from the daily budget and the days booked by hand; Meta's own come once its account is connected"}
          </span>
        </div>
        <div className={s.periods} aria-label="Ad spend by period">
          {periods.map((p) => (
            <div key={p.key} className={s.period} data-period={p.key}>
              <span className={s.periodLabel}>{p.label}</span>
              <strong className={s.periodValue}>{dollars(p.cents)}</strong>
              <small className={s.periodNote}>{p.days === 0 ? "nothing yet" : p.days === 1 ? (p.key === "today" || p.key === "yesterday" ? "one day" : "1 day") : `${dollars(p.perDayCents)}/day · ${p.days} days`}</small>
            </div>
          ))}
        </div>
        <SpendBars rows={report.dailyRows} />
      </section>

      <section className={s.card}>
        <h2 className={s.h2}>Month by month: ads against revenue</h2>
        <PaybackChart curve={f.curve} today={f.today} ratePct={r.pct} share={r.share} />
      </section>

      <section className={s.card} data-cost-card>
        <h2 className={s.h2}>What a customer costs — from the first day</h2>
        <CustomerCostChart cost={f.cost} story={customerCostStory(f)} today={f.today} ratePct={r.pct} />
      </section>

      {report.spend.byPlatform.length > 0 && (
        <section className={s.card}>
          <h2 className={s.h2}>Where the ad money went</h2>
          <table className={s.tbl}>
            <tbody>
              {report.spend.byPlatform.map((p) => (
                <tr key={p.platform}><td>{p.label}</td><td className={s.num}>{dollars(p.cents)}</td><td className={s.sub}>{p.days} {p.days === 1 ? "day" : "days"} · {dollars(Math.round(p.cents / Math.max(1, p.days)))}/day</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className={s.method}>
        <h2 className={s.h2}>How these are figured</h2>
        <ul>
          <li>Counting from {longDate(report.startDay)}, the day the first campaign went live{cardLater ? ` — the figures from ${longDate(f.since)}, from when every trial needed a card` : ""} — only what happened from that day on. Visitors are unique people on www.jobflex.app{cardLater ? ` since ${longDate(f.since)}` : ""}, bots and previews out.</li>
          <li data-method="rate">Nothing here is a share we chose. &ldquo;Trial to paid&rdquo; is measured on the trials that have ended ({r.pct === null ? "none has ended yet" : `${r.paid} of ${r.ended} converted`}): converted means the trial moved to a paid plan — one that left since still converted, and one paid after its trial had ended is counted under &ldquo;came back later&rdquo;; not converted means canceled during the trial, or not paid two weeks after it ended (and converted again if it pays later). &ldquo;Likely&rdquo; is the 90% range for that many trials — it narrows as more trials end. The trials running now are expected to pay at the measured rate.</li>
          <li>Ad spend is {a.dailyBudgetCents !== null && a.dailyBudgetCents !== undefined && a.budgetFrom ? `the daily budget — ${dollars(a.dailyBudgetCents)} for all ads together — counted as spent every day since ${longDate(a.budgetFrom)}${f.spend.bookedDays ? `, with ${f.spend.bookedDays} ${f.spend.bookedDays === 1 ? "day" : "days"} at the figure booked for it` : ""}` : "what was booked per day; a day with nothing booked counts as zero"}{shared ? "" : " (set on this page; Meta's own figures per day once its API token is connected)"}. Tomorrow on it runs at the last full week&apos;s pace, {dollars(f.spend.perDayProjectedCents)} a day.</li>
          <li data-method="cost">&ldquo;Per lead&rdquo; is all the ad spend ÷ every signup. The last {f.trials.lengthDays} days of ads brought trials that are still running, so &ldquo;Per paying customer&rdquo; and &ldquo;Earns the spend back in&rdquo; count only the signups whose trial is over{m.through ? ` — up to ${longDate(m.through)}` : ""}: the ad spend up to that day ÷ the customers those signups became. &ldquo;Per customer, expected&rdquo; counts all the spend, with the running trials at the measured rate.</li>
          <li data-method="cost-chart">&ldquo;What a customer costs&rdquo; counts each day the same way: the ads up to {f.trials.lengthDays + 1} days before it ÷ the customers those signups became (&ldquo;to win&rdquo;), and the same less what those customers have paid by that day at list price (&ldquo;after paying&rdquo;). Up to today it counts only the customers paying today. Past today it runs at today&apos;s pace — {dollars(f.cost.pace.spendPerDayCents)} a day on ads, {f.cost.pace.signupsPerDay} signups a day{r.pct === null ? "" : `, ${r.pct}% of trials converting`} — and every customer still to come pays {dollars(f.cost.pace.monthlyCents)} a month from the end of their trial. Churn is not modelled. &ldquo;Paid back by their customers&rdquo; is the first day what those customers have paid covers every ad dollar counted. A week&apos;s cost is its ads ÷ the customers its signups became; where trials still run, they count at the measured rate.</li>
          <li>&ldquo;Collected so far&rdquo; is what Stripe took for subscriptions since the start day from the accounts counted here. A trial or a paying account is valued at its plan&apos;s monthly list price: a yearly plan as a twelfth, a custom plan by its pages. Discounts, taxes and churn are not modelled in the list-price figures.</li>
          <li>The curve: each paying account earns a thirtieth of its monthly price a day from the day it started paying; a running trial, at the measured rate, from the day it ends; signups still to come arrive at the last week&apos;s pace ({f.unit.signupsPerDay}/day), at the average trial price ({dollars(f.trials.avgMonthlyCents)}/mo), and pay at the measured rate after a {f.trials.lengthDays}-day trial. Spend continues at {dollars(f.spend.perDayProjectedCents)}/day for {a.horizonDays} days.</li>
          <li data-left-out>{cardLater ? `Ad spend, visitors, signups and the trial-to-paid rate are counted from ${longDate(f.since)}, from when every trial needed a card. ` : "Every trial counted here took a card. "}{f.paying.fromNoCard > 0 ? `${f.paying.fromNoCard} paying ${f.paying.fromNoCard === 1 ? "customer" : "customers"} who started on an earlier free trial without a card ${f.paying.fromNoCard === 1 ? "is" : "are"} counted as paying (${dollars(f.paying.fromNoCardMrrCents)}/mo, and what ${f.paying.fromNoCard === 1 ? "it pays" : "they pay"}) — not as signups, in the rate, or in the cost of a customer.` : ""}</li>
          <li>Read on {new Date(report.at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}. The figures move as accounts sign up, end their trials and pay.</li>
        </ul>
      </section>
    </div>
  );
}

function Kpi({ label, value, note, tone, data }: { label: string; value: string; note: string; tone?: "ink" | "trial" | "good" | "blue"; data?: string }) {
  return (
    <div className={s.kpi} data-tone={tone} data-kpi={data}>
      <span className={s.kpiLabel}>{label}</span>
      <strong className={s.kpiValue}>{value}</strong>
      <small className={s.kpiNote}>{note}</small>
    </div>
  );
}

/** One row of the rate card: a labelled bar split into its parts, each part's width its share. */
function RateBar({ label, parts, empty }: { label: string; parts: Array<{ value: number; cls: string; words: string }>; empty: string }) {
  const total = parts.reduce((x, p) => x + Math.max(0, p.value), 0);
  return (
    <div className={s.rateRow}>
      <div className={s.rateHead}><span>{label}</span>{total > 0 && <small>{parts.filter((p) => p.value > 0 && p.words).map((p) => p.words).join(" · ")}</small>}</div>
      {total > 0 ? (
        <div className={s.rateBar} role="img" aria-label={`${label}: ${parts.filter((p) => p.words).map((p) => p.words).join(", ")}`}>
          {parts.map((p, i) => (p.value > 0 ? <i key={i} className={p.cls} style={{ flexGrow: p.value }} /> : null))}
        </div>
      ) : (
        <div className={s.rateEmpty}>{empty}</div>
      )}
    </div>
  );
}

export type { InvestorFigures };
