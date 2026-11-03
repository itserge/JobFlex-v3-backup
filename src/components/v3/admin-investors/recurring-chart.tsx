"use client";

// RECURRING REVENUE — MRR AND ARR (owner, 2026-11-02: "add ARR and MRR — the numbers, statistics, and a projection if
// everything grows like it's growing today; make it smart"; chose today's pace with a likely range, and what Stripe
// bills). lib/investorRecurring: MRR from the first day, counted (solid) to today; ahead at today's pace (dashed) inside
// its likely range (shaded); the ARR milestones on the way, marked. A slider for the daily ad budget redraws what is
// ahead — what more ads would buy, signups in proportion. A hover or tap reads one day. Plain SVG with the run-rate
// chart's furniture; the same component on the Figures page and the deck (compact: no words, no slider).
//
// NOTHING ABOVE THE SLIDER MOVES WHILE IT DOES (owner, 2026-11-02: "when I'm moving it, the whole screen shakes and
// it's hard to stop"): the words above are today's pace and stay put; what the slider's budget brings is one line
// under it, in room kept for it; the way back sits in its place all the time; the chart's scale starts from today's
// pace and only grows.
import { useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { daysBetween, dollars, longDate } from "@/lib/investorModel";
import { aheadAt, bigDollars, dayOfYear, milestoneWhen, recurringAhead, recurringStory, type RecurringInput } from "@/lib/investorRecurring";
import { compact, niceMax, short } from "./payback-chart";
import s from "./investor-report.module.css";

const W = 760;
const H = 300;
const PAD = { r: 150, t: 22, b: 40 };

type Pt = { date: string; mrr: number; low: number; high: number; customers: number | null; projected: boolean };

export function RecurringChart({ input, compact: slim = false }: { input: RecurringInput; /** The deck's slide: the chart, its readings and the milestones — no words, no slider. */ compact?: boolean }) {
  const base = input.spendPerDayCents;
  const [budget, setBudget] = useState(base);
  const [cur, setCur] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const ahead = useMemo(() => recurringAhead(input, budget), [input, budget]);
  // The words above the slider read today's pace, whatever the slider says — they must not reflow under a drag.
  const atToday = useMemo(() => recurringAhead(input), [input]);
  const story = useMemo(() => recurringStory(input, atToday), [input, atToday]);
  const moved = budget !== base;
  const step = base >= 10_000 ? 1_000 : 500;
  const maxBudget = Math.max(step * 10, Math.ceil((base * 10) / step) * step);

  const pts: Pt[] = useMemo(() => {
    const past: Pt[] = input.history.filter((h) => h.date < input.today).map((h) => ({ date: h.date, mrr: h.mrrCents, low: h.mrrCents, high: h.mrrCents, customers: h.customers, projected: false }));
    const now = input.history.find((h) => h.date === input.today);
    return [
      ...past,
      ...ahead.points.map((p, k) => ({ date: p.date, mrr: p.mrrCents, low: p.lowCents, high: p.highCents, customers: k === 0 ? (now?.customers ?? input.customers) : null, projected: k > 0 })),
    ];
  }, [input, ahead]);
  const n = pts.length;
  const todayK = Math.max(0, pts.findIndex((p) => p.date === input.today));
  const today = pts[todayK];
  const end = pts[n - 1];
  const endAhead = aheadAt(ahead, ahead.points.length - 1);

  const top = Math.max(100_00, ...pts.map((p) => p.high), ...atToday.points.map((p) => p.highCents));
  const tick = niceMax(top / 4);
  const hi = Math.ceil(top / tick) * tick;
  const ticks = Array.from({ length: Math.round(hi / tick) + 1 }, (_, i) => i * tick);
  const padL = 14 + 7.4 * Math.max(...ticks.map((v) => compact(v).length));
  const plotW = W - padL - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const x = (k: number) => padL + (k * plotW) / Math.max(1, n - 1);
  const y = (v: number) => PAD.t + plotH - (Math.min(v, hi) / hi) * plotH;
  const line = (from: number, to: number) => pts.slice(from, to + 1).map((p, i) => `${i ? "L" : "M"}${x(from + i).toFixed(1)},${y(p.mrr).toFixed(1)}`).join("");
  const band = todayK < n - 1
    ? `${pts.slice(todayK).map((p, i) => `${i ? "L" : "M"}${x(todayK + i).toFixed(1)},${y(p.high).toFixed(1)}`).join("")}${pts.slice(todayK).reverse().map((p, i) => `L${x(n - 1 - i).toFixed(1)},${y(p.low).toFixed(1)}`).join("")}Z`
    : "";
  const xTicks = Array.from(new Set([0, 0.2, 0.4, 0.6, 0.8, 1].map((f) => Math.round(f * (n - 1)))));
  const marks = ahead.milestones
    .map((m) => ({ m, k: m.date ? pts.findIndex((p) => p.date === m.date) : -1 }))
    .filter((x): x is { m: (typeof ahead.milestones)[number]; k: number } => x.k >= 0);

  // A milestone's name is left off when it would sit on the one before it (close in time and in money): the dot stays,
  // and the table under the chart names every one. Read from the last, the highest, which is always named.
  const named = marks.map(() => true);
  for (let i = marks.length - 2, keptAt = marks.length - 1; i >= 0; i--) {
    const near = Math.abs(x(marks[i].k) - x(marks[keptAt].k)) < 84 && Math.abs(y(marks[i].m.arrCents / 12) - y(marks[keptAt].m.arrCents / 12)) < 18;
    named[i] = !near;
    if (!near) keptAt = i;
  }

  const place = (clientX: number) => {
    const el = svgRef.current;
    if (!el || n < 2) return;
    const box = el.getBoundingClientRect();
    const px = ((clientX - box.left) / box.width) * W;
    setCur(Math.max(0, Math.min(n - 1, Math.round(((px - padL) / plotW) * (n - 1)))));
  };
  const onPointer = (e: ReactPointerEvent<SVGSVGElement>) => place(e.clientX);
  const onLeave = (e: ReactPointerEvent<SVGSVGElement>) => { if (e.pointerType === "mouse") setCur(null); };
  const onKey = (e: ReactKeyboardEvent<SVGSVGElement>) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const by = e.shiftKey ? 30 : 1;
      setCur((c) => Math.max(0, Math.min(n - 1, (c ?? todayK) + (e.key === "ArrowLeft" ? -by : by))));
    } else if (e.key === "Escape") setCur(null);
  };
  const tip = cur !== null ? pts[cur] : null;
  const tipLeft = cur !== null ? (x(cur) / W) * 100 : 0;
  const times = base > 0 ? Math.round((budget / base) * 10) / 10 : null;
  const million = ahead.milestones.find((m) => m.arrCents === 100_000_000);
  const arpa = input.customers > 0 ? Math.round(input.mrrCents / input.customers) : 0;

  return (
    <div className={s.chartWrap} data-recurring>
      {!slim && (
        <div className={s.story} data-recurring-story>
          <p className={s.storyNow}>{story.now}</p>
          {story.moved && <p data-story="moved">{story.moved}</p>}
          {story.pace && <p data-story="pace">{story.pace}</p>}
          {story.ahead && <p className={s.storyCross} data-story="ahead">{story.ahead}</p>}
          <p data-story="churn">{story.churn}</p>
        </div>
      )}
      {!slim && base > 0 && ahead.share !== null && (
        <div className={`${s.whatIf} ${s.budget}`} data-budget>
          <div className={s.budgetHead}>
            <label className={s.whatIfLabel} htmlFor="recurring-budget">What if the ads got more a day? <b className={s.budgetValue}>{dollars(budget)}</b><span> · today {dollars(base)}</span></label>
            <button type="button" className={s.whatIfReset} onClick={() => setBudget(base)} style={moved ? undefined : { visibility: "hidden" }} tabIndex={moved ? undefined : -1} aria-hidden={moved ? undefined : true}>Back to {dollars(base)} a day</button>
          </div>
          <div className={s.whatIfControl}>
            <button type="button" className={s.whatIfStep} aria-label={`${dollars(step)} a day less`} data-budget-step="-1" disabled={budget <= 0} onClick={() => setBudget((v) => Math.max(0, v - step))}>−</button>
            <input id="recurring-budget" className={s.whatIfRange} type="range" min={0} max={maxBudget} step={step} value={budget} onChange={(e) => setBudget(Number(e.target.value))} aria-valuetext={`${dollars(budget)} a day on ads`} />
            <button type="button" className={s.whatIfStep} aria-label={`${dollars(step)} a day more`} data-budget-step="1" disabled={budget >= maxBudget} onClick={() => setBudget((v) => Math.min(maxBudget, v + step))}>+</button>
          </div>
          <p className={s.budgetSays} aria-live="polite" data-story={moved ? "budget" : "budget-hint"}>
            {moved
              ? `At ${dollars(budget)} a day${times !== null ? ` — ${times}× today's` : ""}: ${bigDollars(endAhead.mrrCents * 12)} ARR in 12 months${million?.date ? `, $1M ARR on ${longDate(million.date)}` : million ? ", $1M ARR not within five years" : ""}.`
              : "Move it to see what a bigger daily ad budget would bring."}
            <span> Signups in proportion, at today&apos;s cost per signup — a bigger budget usually pays more a signup.</span>
          </p>
        </div>
      )}
      <figure className={s.chart}>
        <div className={s.chartInner}>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            tabIndex={0}
            aria-label={`Monthly recurring revenue, ${short(pts[0].date)} to ${short(end.date)}. ${story.now} ${story.ahead ?? ""} Arrow keys read day by day, with Shift a month at a time.`}
            onPointerMove={onPointer}
            onPointerDown={onPointer}
            onPointerLeave={onLeave}
            onKeyDown={onKey}
            data-recurring-chart
          >
            {ticks.map((v) => (
              <g key={v}>
                {v !== 0 && <line x1={padL} x2={W - PAD.r} y1={y(v)} y2={y(v)} className={s.rule} />}
                <text x={padL - 8} y={y(v) + 4} textAnchor="end" className={s.axis}>{compact(v)}</text>
              </g>
            ))}
            {todayK < n - 1 && <rect x={x(todayK)} y={PAD.t} width={x(n - 1) - x(todayK)} height={plotH} className={s.future} />}
            <line x1={padL} x2={W - PAD.r} y1={y(0)} y2={y(0)} className={s.base} />
            {xTicks.map((k) => (
              <text key={k} x={x(k)} y={H - 14} textAnchor={k === 0 ? "start" : k === n - 1 ? "end" : "middle"} className={s.axis}>{short(pts[k].date)}</text>
            ))}
            <g>
              <line x1={x(todayK)} x2={x(todayK)} y1={PAD.t} y2={PAD.t + plotH} className={s.today} />
              <text x={x(todayK) + 5} y={PAD.t + 12} className={s.axisStrong}>today</text>
            </g>
            {band && <path d={band} className={s.band} data-recurring-band />}
            <path d={line(0, todayK)} className={s.lineReal} />
            {todayK < n - 1 && <path d={line(todayK, n - 1)} className={`${s.lineReal} ${s.dash}`} />}
            <circle cx={x(todayK)} cy={y(today.mrr)} r={4} className={`${s.dot} ${s.lineReal}`} />
            {/* Each milestone, named above and to the left of its day — clear of the line, which climbs from there. */}
            {marks.map(({ m, k }, i) => (
              <g key={m.arrCents} data-milestone={m.arrCents}>
                <circle cx={x(k)} cy={y(m.arrCents / 12)} r={5} className={s.mark} />
                {named[i] && <text x={x(k) - 8} y={y(m.arrCents / 12) - 9} textAnchor="end" className={`${s.axisStrong} ${s.markLabel}`}>{bigDollars(m.arrCents)} ARR</text>}
              </g>
            ))}
            {/* The line says its value where it ends. */}
            <text x={x(n - 1) + 8} y={y(end.mrr) + 4} className={`${s.endLabel} ${s.endLabelRev}`} data-end="mrr">{compact(end.mrr)}/mo</text>
            <text x={x(n - 1) + 8} y={y(end.mrr) + 19} className={s.axis} data-end="arr">{bigDollars(end.mrr * 12)} ARR</text>
            {tip && cur !== null && (
              <g>
                <line x1={x(cur)} x2={x(cur)} y1={PAD.t} y2={PAD.t + plotH} className={s.cursor} />
                <circle cx={x(cur)} cy={y(tip.mrr)} r={4} className={`${s.dot} ${s.lineReal}`} />
              </g>
            )}
          </svg>
          {tip && cur !== null && (
            <div className={`${s.tip} ${tipLeft > 58 ? s.tipLeft : ""}`} style={{ left: `${tipLeft}%` }} data-recurring-tip>
              <div className={s.tipDate}>{longDate(tip.date)} <span className={s.tipTag}>{tip.date === input.today ? "today" : tip.projected ? (moved ? `at ${dollars(budget)}/day` : "today's pace") : "counted"}</span></div>
              <div className={s.tipRow}><span>MRR</span><b>{dollars(tip.mrr)}</b></div>
              <div className={s.tipRow}><span>ARR</span><b>{dollars(tip.mrr * 12)}</b></div>
              {tip.projected && <div className={s.tipRow}><span>Likely ARR</span><b>{bigDollars(tip.low * 12)}–{bigDollars(tip.high * 12)}</b></div>}
              {tip.customers !== null && <div className={s.tipRow}><span>Paying customers</span><b>{tip.customers}</b></div>}
            </div>
          )}
        </div>
        <figcaption className={s.legend}>
          <span><i className={`${s.sw} ${s.lineReal}`} />MRR — what Stripe bills a month{input.basis === "record" ? " (the record: list prices)" : ""}</span>
          <span><i className={`${s.swBox} ${s.swBand}`} />Likely range — the measured rates&apos; 90% ranges</span>
          {marks.length > 0 && <span><i className={`${s.swBox} ${s.swMark}`} />An ARR milestone</span>}
          <span className={s.legendNote}>Solid: counted. Dashed and shaded: ahead{moved ? ` at ${dollars(budget)} a day on ads` : " at today's pace"}{ahead.churn > 0 ? `, ${Math.round(ahead.churn * 100)}% a month churn taken off` : ", no churn measured yet"}.</span>
        </figcaption>
      </figure>

      <div className={`${s.readings} ${s.readings4}`}>
        <div className={s.reading} data-reading="mrr-today">
          <div className={s.readingHead}>MRR · today</div>
          <div className={s.readingBig}>{dollars(input.mrrCents)} <span>a month</span></div>
          <div className={s.readingRows}>
            <span>{input.customers} paying · {dollars(arpa)} each</span>
            <span>{input.basis === "stripe" ? "what Stripe bills, after discounts" : "Stripe not read · list prices"}</span>
          </div>
        </div>
        <div className={s.reading} data-reading="arr-today">
          <div className={s.readingHead}>ARR · today</div>
          <div className={s.readingBig}>{dollars(input.mrrCents * 12)} <span>a year</span></div>
          <div className={s.readingRows}>
            <span>MRR × 12</span>
            <span>{input.moved.newCount + input.moved.lostCount > 0 ? `${input.moved.newCents - input.moved.lostCents >= 0 ? "+" : "−"}${dollars(Math.abs(input.moved.newCents - input.moved.lostCents) * 12)} ARR ${input.moved.from === input.since ? `since ${short(input.moved.from)}` : `in ${input.moved.days} days`}` : "no change yet"}</span>
          </div>
        </div>
        <div className={s.reading} data-reading="arr-ahead">
          <div className={s.readingHead}>In 12 months · {short(endAhead.date)}</div>
          <div className={s.readingBig}>{ahead.share === null ? "—" : bigDollars(endAhead.mrrCents * 12)} <span>ARR</span></div>
          <div className={s.readingRows}>
            <span>{ahead.share === null ? "no measured rate yet" : `${dollars(endAhead.mrrCents)} a month`}</span>
            <span>{ahead.share === null ? "once a trial has ended" : `likely ${bigDollars(endAhead.lowCents * 12)}–${bigDollars(endAhead.highCents * 12)}`}</span>
          </div>
        </div>
        <div className={s.reading} data-reading="arr-per-dollar">
          <div className={s.readingHead}>Each $1 of ads</div>
          <div className={s.readingBig}>{ahead.arrPerAdDollar === null ? "—" : `$${ahead.arrPerAdDollar}`} <span>of ARR</span></div>
          <div className={s.readingRows}>
            <span>{ahead.addPerDayCents === null ? "once a trial has ended" : `+${dollars(ahead.addPerDayCents)} MRR a day of ads`}</span>
            <span>{ahead.share === null ? "—" : `${Math.round(ahead.share * 100)}% converting · ${dollars(input.newCustomerCents)}/mo each`}</span>
          </div>
        </div>
      </div>

      {ahead.milestones.length > 0 && (
        <table className={`${s.tbl} ${s.milestones}`} data-milestones>
          <tbody>
            {ahead.milestones.map((m) => (
              <tr key={m.arrCents} data-milestone-row={m.arrCents}>
                <td>{bigDollars(m.arrCents)} ARR</td>
                <td className={s.num}>{m.date ? dayOfYear(m.date, input.today) : "—"}</td>
                <td className={s.sub}>{[`${bigDollars(m.arrCents / 12)} a month`, m.date ? `in ${daysBetween(input.today, m.date)} days` : null, milestoneWhen(m, input.today)].filter(Boolean).join(" · ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
