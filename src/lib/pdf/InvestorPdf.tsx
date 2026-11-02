// THE INVESTOR FIGURES AS A PDF (2026-10-06) — the same reading as the page
// (lib/investors), on paper: the two lead sentences, the figures, the measured
// trial-to-paid rate and what it expects of the running trials, what came in
// against the spend, where the money went, the curve as a table of milestones,
// and how it is figured. Nothing assumed (2026-10-24). Built like ProposalPdf.
import * as React from "react";
import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { InvestorReport } from "@/lib/investors";
import { dollars, longDate, monthlyPace, outlookSentence, payMonthlyDay, runRateReading, runRateStory, runRateWindow, standingSentence, type CurvePoint } from "@/lib/investorModel";

const s = StyleSheet.create({
  page: { padding: 40, fontFamily: "Helvetica", fontSize: 10, color: "#0a0a0a" },
  kicker: { fontSize: 8, letterSpacing: 2, color: "#555", marginBottom: 6, textTransform: "uppercase" },
  h1: { fontSize: 22, fontFamily: "Helvetica-Bold", letterSpacing: -0.5, marginBottom: 4 },
  sub: { fontSize: 9, color: "#555", marginBottom: 16 },
  lead: { borderLeftWidth: 4, borderLeftColor: "#1854a0", paddingLeft: 10, marginBottom: 16 },
  leadText: { fontSize: 12, fontFamily: "Helvetica-Bold", lineHeight: 1.4 },
  leadMore: { fontSize: 9.5, color: "#2a2a2a", lineHeight: 1.45, marginTop: 4 },
  grid: { flexDirection: "row", flexWrap: "wrap", borderWidth: 1.5, borderColor: "#0a0a0a", marginBottom: 14 },
  cell: { width: "33.33%", padding: 8, borderRightWidth: 1, borderBottomWidth: 1, borderColor: "#ddd" },
  lbl: { fontSize: 7, letterSpacing: 1.2, color: "#555", textTransform: "uppercase", marginBottom: 3 },
  val: { fontSize: 16, fontFamily: "Helvetica-Bold" },
  note: { fontSize: 7.5, color: "#555", marginTop: 2 },
  h2: { fontSize: 10, fontFamily: "Helvetica-Bold", letterSpacing: 1.5, textTransform: "uppercase", marginTop: 10, marginBottom: 6 },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#ddd", paddingVertical: 4 },
  rowStrong: { backgroundColor: "#f2f0eb" },
  c1: { width: "42%" }, c2: { width: "18%", textAlign: "right", fontFamily: "Helvetica-Bold", paddingRight: 10 }, c3: { width: "40%", color: "#555", fontSize: 8.5 },
  two: { flexDirection: "row", gap: 18 }, half: { width: "50%" },
  li: { fontSize: 8.5, color: "#2a2a2a", lineHeight: 1.45, marginBottom: 3 },
  foot: { position: "absolute", bottom: 24, left: 40, right: 40, fontSize: 7.5, color: "#777", flexDirection: "row", justifyContent: "space-between" },
});

const money = (v: number | null) => (v === null ? "—" : dollars(v));
const pct = (v: number | null, suffix = "%") => (v === null ? "—" : `${v}${suffix}`);

/** Month by month at a few days (2026-10-25): the first, a week back, today, a week and a month ahead, the day a
 *  month first earns more than its ads, and every 30 days after — as curve indices. */
function milestones(curve: CurvePoint[], today: string): number[] {
  const pace = monthlyPace(curve, today);
  const { todayIndex: ti } = runRateWindow(curve, today, null);
  const cross = payMonthlyDay(curve, pace, ti);
  // From a week back — not the count's first day (owner, 2026-10-26: the total, not the start).
  const picks = new Set<number>([ti - 7, ti, ti + 7, ti + 30, cross?.index ?? -1]);
  for (let i = ti + 60; i < curve.length; i += 30) picks.add(i);
  return [...picks].filter((i) => i >= 0 && i < curve.length).sort((x, y) => x - y);
}

export function InvestorPdfDocument({ report }: { report: InvestorReport }) {
  const f = report.figures;
  const a = report.settings;
  const r = f.rate;
  const ex = f.expected;
  const m = f.unit.matured;
  const got = report.collected;
  const read =new Date(report.at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
  const about = (v: number) => (Number.isInteger(v) ? String(v) : `about ${Math.round(v)}`);
  const range = r.lowPct !== null && r.highPct !== null ? `likely ${r.lowPct}–${r.highPct}%` : "";
  const exRange = ex.payersLow !== null && ex.payersHigh !== null && ex.payersLow !== ex.payersHigh ? `likely ${ex.payersLow}–${ex.payersHigh} · ` : "";
  const rows: Array<[string, string, string, boolean?]> = [
    ["Trials that ended", String(r.ended), r.ended === 0 ? "none yet" : `${r.paid} converted, ${r.ended - r.paid} did not`],
    ...(f.outcomes ? [["Came back later", String(f.outcomes.cameBack), "paid after their trial had ended"] as [string, string, string]] : []),
    ["Trial to paid", pct(r.pct), r.pct === null ? "measured once a trial ends" : `${r.paid} of ${r.ended}${range ? ` · ${range}` : ""}`, true],
    ["On trial now", String(f.trials.count), `${dollars(f.trials.mrrCents)}/mo at list price`],
    ["Expected to pay", ex.payers === null ? "—" : about(ex.payers), ex.payers === null ? "no measured rate yet" : `${exRange}+${dollars(ex.mrrCents ?? 0)}/mo`],
    ["Monthly revenue then", dollars(ex.mrrWithPayingCents), `paying now ${dollars(f.paying.mrrCents)} + expected`, true],
  ];
  const costs: Array<[string, string, string, boolean?]> = [
    ["Spent on ads", dollars(f.spend.totalCents), `since ${longDate(f.since)}`],
    ["Collected so far", got.read ? dollars(got.cents) : "—", got.read ? `Stripe, ${got.invoices} payments${got.cents !== got.wonCents ? ` · ${dollars(got.wonCents)} from the ads' customers` : ""}` : "Stripe not read", true],
    ["Customers the ads brought", String(f.paying.won), `paying · ${dollars(f.paying.wonMrrCents)}/mo`],
    ["Per lead (signup)", money(f.unit.costPerSignupCents), `${f.signups} signed up`, true],
    ["Per customer, expected", f.unit.costPerCustomerExpectedCents !== null ? `≈ ${dollars(f.unit.costPerCustomerExpectedCents)}` : "—", f.unit.costPerCustomerExpectedCents !== null ? `once the running trials convert at ${r.pct}%` : "once a trial has ended"],
    // Counted on the signups whose trial is over (2026-11-02, lib/investorModel unit.matured).
    ["Per paying customer", money(f.unit.costPerPayingCents), m.through === null ? "once the first trials are over" : m.won > 0 ? `${dollars(m.spendCents)} ÷ ${m.won} paying · ads up to ${longDate(m.through)}, trials over` : `none yet from signups up to ${longDate(m.through)}`],
    ["Earns the spend back in", pct(f.unit.paybackMonths, " mo"), m.wonMrrCents > 0 ? `at ${dollars(m.wonMrrCents)} a month` : "once a customer pays"],
  ];
  return (
    <Document title="JobFlex · Investor figures" author="JobFlex">
      <Page size="LETTER" style={s.page}>
        <Text style={s.kicker}>JobFlex · Investors</Text>
        <Text style={s.h1}>Ads, trials and payback</Text>
        <Text style={s.sub}>Day {report.launch.day} since JobFlex launched on {longDate(report.launch.date)} · {f.since !== report.startDay ? `live figures since ${longDate(f.since)}, from when every trial needed a card` : `live figures since ${longDate(f.since)}, the day the first campaign went live`} · read {read}</Text>
        <View style={s.lead}>
          <Text style={s.lbl}>Where the ads stand today</Text>
          <Text style={s.leadText}>{standingSentence(f)}</Text>
          <Text style={s.leadMore}>{outlookSentence(f)}</Text>
        </View>
        <View style={s.grid}>
          {[
            ["Ad spend", dollars(f.spend.totalCents), f.spend.dailyBudgetCents !== null && f.spend.budgetFrom ? `${dollars(f.spend.dailyBudgetCents)}/day, all ads, since ${longDate(f.spend.budgetFrom)}` : `${dollars(f.spend.perDayRecentCents)}/day lately`],
            ["Visitors", f.visitors === null ? "—" : f.visitors.toLocaleString("en-US"), f.visitors === null ? "analytics not reached" : `${money(f.unit.costPerVisitorCents)} each`],
            ["Signed up", String(f.signups), `${f.unit.signupsPerDay}/day · ${pct(f.unit.visitorToSignupPct)} of visitors`],
            ["Paying", String(f.paying.count), `${dollars(f.paying.mrrCents)}/mo · ${dollars(f.paying.arrCents)} a year${f.paying.fromNoCard > 0 ? ` · ${f.paying.fromNoCard} started without a card` : ""}`],
            ["Trial to paid", pct(r.pct), r.pct === null ? "no trial has ended yet" : `${r.paid} of ${r.ended} ended trials converted${f.outcomes && f.outcomes.cameBack > 0 ? ` · ${f.outcomes.cameBack} came back later` : ""}`],
            ["On trial now", String(f.trials.count), ex.payers === null ? "no measured rate yet" : `${about(ex.payers)} expected to pay · +${dollars(ex.mrrCents ?? 0)}/mo`],
          ].map(([l, v, nt]) => (
            <View key={l} style={s.cell}>
              <Text style={s.lbl}>{l}</Text>
              <Text style={s.val}>{v}</Text>
              <Text style={s.note}>{nt}</Text>
            </View>
          ))}
        </View>
        <View style={s.two}>
          <View style={s.half}>
            <Text style={s.h2}>Trial to paid, measured</Text>
            {rows.map(([l, v, nt, strong]) => (
              <View key={l} style={[s.row, ...(strong ? [s.rowStrong] : [])]}><Text style={s.c1}>{l}</Text><Text style={s.c2}>{v}</Text><Text style={s.c3}>{nt}</Text></View>
            ))}
          </View>
          <View style={s.half}>
            <Text style={s.h2}>Paying against the spend</Text>
            {costs.map(([l, v, nt, strong]) => (
              <View key={l} style={[s.row, ...(strong ? [s.rowStrong] : [])]}><Text style={s.c1}>{l}</Text><Text style={s.c2}>{v}</Text><Text style={s.c3}>{nt}</Text></View>
            ))}
          </View>
        </View>
        <Text style={s.h2}>The ad spend by period{report.meta.lastPulledAt ? " (Meta's own figures)" : ""}</Text>
        {report.periods.map((p) => (
          <View key={p.key} style={s.row}><Text style={s.c1}>{p.label}</Text><Text style={s.c2}>{dollars(p.cents)}</Text><Text style={s.c3}>{p.days === 0 ? "nothing yet" : `${dollars(p.perDayCents)}/day over ${p.days} ${p.days === 1 ? "day" : "days"}`}</Text></View>
        ))}
        <View wrap={false}>
          <Text style={s.h2}>Month by month: ads against revenue, at list price</Text>
          {(() => {
            const st = runRateStory(f.curve, f.today, 30, r.pct);
            return <Text style={s.li}>{[st.now, st.past, st.ahead, st.cross].filter(Boolean).join(" ")}</Text>;
          })()}
          <View style={s.row}><Text style={[s.c1, { fontFamily: "Helvetica-Bold" }]}>Day</Text><Text style={s.c2}>A month in</Text><Text style={s.c2}>A month of ads</Text><Text style={s.c2}>Covers</Text></View>
          {(() => {
            const pace = monthlyPace(f.curve, f.today);
            const cross = payMonthlyDay(f.curve, pace, runRateWindow(f.curve, f.today, null).todayIndex);
            return milestones(f.curve, f.today).map((i) => {
              const m = runRateReading(f.curve, pace, i);
              const isCross = cross?.index === i;
              return (
                <View key={m.date} style={[s.row, ...(isCross || m.date === f.today ? [s.rowStrong] : [])]}>
                  <Text style={s.c1}>{longDate(m.date)}{m.date === f.today ? " · today" : isCross ? " · earns more than its ads" : m.projected ? " · ahead" : ""}</Text>
                  <Text style={s.c2}>{dollars(m.revenueCents)}</Text><Text style={s.c2}>{dollars(m.adsCents)}</Text><Text style={s.c2}>{m.coverPct === null ? "—" : `${m.coverPct}%`}</Text>
                </View>
              );
            });
          })()}
        </View>
        {report.spend.byPlatform.length > 0 && (
          <>
            <Text style={s.h2}>Where the ad money went</Text>
            {report.spend.byPlatform.map((p) => (
              <View key={p.platform} style={s.row}><Text style={s.c1}>{p.label}</Text><Text style={s.c2}>{dollars(p.cents)}</Text><Text style={s.c3}>{p.days} days · {dollars(Math.round(p.cents / Math.max(1, p.days)))}/day</Text></View>
            ))}
          </>
        )}
        <View wrap={false}>
        <Text style={s.h2}>How these are figured</Text>
        <Text style={s.li}>· Counting from {longDate(report.startDay)}, the day the first campaign went live{f.since !== report.startDay ? ` — the figures from ${longDate(f.since)}, from when every trial needed a card` : ""} — only what happened from that day on. Visitors are unique people on www.jobflex.app, bots and previews out.</Text>
        <Text style={s.li}>· Nothing here is a share we chose. &quot;Trial to paid&quot; is measured on the trials that have ended ({r.pct === null ? "none has ended yet" : `${r.paid} of ${r.ended} converted`}): converted means the trial moved to a paid plan (one paid after its trial had ended counted as &quot;came back later&quot;); not converted means canceled during the trial, or not paid two weeks after it ended — and converted again if it pays later. &quot;Likely&quot; is the 90% range for that many trials. The running trials are expected to pay at the measured rate.</Text>
        <Text style={s.li}>· Ad spend is {a.dailyBudgetCents !== null && a.dailyBudgetCents !== undefined && a.budgetFrom ? `the daily budget, ${dollars(a.dailyBudgetCents)} for all ads together, counted as spent every day since ${longDate(a.budgetFrom)}` : "what was booked per day"}; tomorrow on it runs at the last full week&apos;s pace, {dollars(f.spend.perDayProjectedCents)} a day. &quot;Collected so far&quot; is what Stripe took for subscriptions since the start day from the accounts counted here.</Text>
        <Text style={s.li}>· {f.since !== report.startDay ? `Ad spend, visitors, signups and the trial-to-paid rate are counted from ${longDate(f.since)}, from when every trial needed a card. ` : "Every trial counted here took a card. "}{f.paying.fromNoCard > 0 ? `${f.paying.fromNoCard} paying ${f.paying.fromNoCard === 1 ? "customer" : "customers"} who started on an earlier free trial without a card ${f.paying.fromNoCard === 1 ? "is" : "are"} counted as paying — not as signups, in the rate, or in the cost of a customer.` : ""}</Text>
        <Text style={s.li}>· A trial is worth its plan&apos;s monthly list price (a yearly plan as a twelfth, a custom plan by its pages). Discounts, taxes and churn are not modelled.</Text>
        <Text style={s.li}>· The curve: a paying account earns a thirtieth of its monthly price a day from the day it started paying, a running trial at the measured rate from the day it ends; new signups arrive at {f.unit.signupsPerDay}/day at {dollars(f.trials.avgMonthlyCents)}/mo and pay at the measured rate after a {f.trials.lengthDays}-day trial; spend continues at {dollars(f.spend.perDayProjectedCents)}/day for {a.horizonDays} days.</Text>
        </View>
        <View style={s.foot} fixed><Text>JobFlex · investor figures · {read}</Text><Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} /></View>
      </Page>
    </Document>
  );
}
