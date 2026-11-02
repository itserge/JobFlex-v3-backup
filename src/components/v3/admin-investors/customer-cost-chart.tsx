"use client";

// WHAT A CUSTOMER COSTS, FROM THE FIRST DAY (owner, 2026-11-02: "a projection at the current spending and the customers
// already converted — how the cost per customer gets reduced as we go; show the current position, from the
// beginning"; chose both lines, on the Figures page, the deck and the PDF). lib/investorModel customerCostSeries: to win
// (ink) and after paying (blue), a day at a time from the first day — solid to today, dashed at today's pace past it;
// a new customer at today's pace as a dotted rule; the day "after paying" reaches $0 marked. Under it, each week's
// signups: their ads ÷ the customers they became, hatched where trials still run. A hover or tap reads one day.
// Plain SVG scaled to its box with the run-rate chart's furniture; the same component on the Figures page and the deck.
import { useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { dollars, longDate, type CostWeek, type CustomerCost } from "@/lib/investorModel";
import { compact, niceMax, short } from "./payback-chart";
import s from "./investor-report.module.css";

const W = 760;
const H = 300;
const PAD = { r: 136, t: 22, b: 40 };
const BH = 190;
const BPAD = { r: 16, t: 24, b: 30 };

/** "$1.2k", "−$340": the axis and the line ends, below zero too. */
const money = (cents: number) => (cents < 0 ? `−${compact(-cents)}` : compact(cents));
const approx = (n: number) => (n === Math.round(n) ? `${n}` : `≈${Math.round(n)}`);
const weekRange = (w: CostWeek) => `${short(w.from)}–${w.from.slice(0, 7) === w.to.slice(0, 7) ? Number(w.to.slice(8)) : short(w.to)}`;

export type CustomerCostWords = { now: string; weeks: string | null; pace: string | null; ahead: string | null; paidBack: string | null };

export function CustomerCostChart({ cost, story, today, ratePct, compact: slim = false }: { cost: CustomerCost; story: CustomerCostWords; today: string; /** The measured share that converts, whole %; null = none measured yet. */ ratePct: number | null; /** The deck's slide: the chart and its readings, without the words and the week bars. */ compact?: boolean }) {
  const [cur, setCur] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const hatch = `hatch-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const pts = cost.points;
  const n = pts.length;
  const todayK = Math.max(0, pts.findIndex((p) => p.date === today));
  const now = pts[todayK];
  const end = pts[n - 1];
  const pace = cost.pace;

  // One axis, in dollars: to win, after paying (below zero once paid back) and the pace.
  const vals = pts.flatMap((p) => [p.grossCents, p.netCents]).filter((v): v is number => v !== null);
  if (pace.costCents !== null) vals.push(pace.costCents);
  const hiRaw = Math.max(100, ...vals);
  const loRaw = Math.min(0, ...vals);
  const step = niceMax((hiRaw - loRaw) / 4);
  const lo = Math.floor(loRaw / step) * step;
  const hi = Math.ceil(hiRaw / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(v);
  const padL = 14 + 7.4 * Math.max(...ticks.map((v) => money(v).length));
  const plotW = W - padL - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const x = (k: number) => padL + (k * plotW) / Math.max(1, n - 1);
  const y = (v: number) => PAD.t + plotH - ((v - lo) / (hi - lo || 1)) * plotH;
  /** A path through one series' values from `from` to `to`, lifted where a day has none. */
  const path = (pick: (k: number) => number | null, from: number, to: number) => {
    let d = "";
    let pen = false;
    for (let k = from; k <= to; k++) {
      const v = pick(k);
      if (v === null) { pen = false; continue; }
      d += `${pen ? "L" : "M"}${x(k).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    }
    return d;
  };
  const win = (k: number) => pts[k].grossCents;
  const after = (k: number) => pts[k].netCents;
  const xTicks = Array.from(new Set([0, 0.2, 0.4, 0.6, 0.8, 1].map((f) => Math.round(f * (n - 1)))));
  const paidK = cost.paidBack.date ? pts.findIndex((p) => p.date === cost.paidBack.date) : -1;
  // The two line-end labels, kept apart when the lines end close together.
  const endWin = end.grossCents !== null ? y(end.grossCents) : null;
  const endAfter = end.netCents !== null ? y(end.netCents) : null;
  const gap = 16;
  const [labWin, labAfter] = endWin === null || endAfter === null || Math.abs(endWin - endAfter) >= gap ? [endWin, endAfter] : endWin <= endAfter ? [endWin - gap / 2, endAfter + gap / 2] : [endWin + gap / 2, endAfter - gap / 2];

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
      setCur((c) => Math.max(0, Math.min(n - 1, (c ?? todayK) + (e.key === "ArrowLeft" ? -1 : 1))));
    } else if (e.key === "Escape") setCur(null);
  };
  const tip = cur !== null ? pts[cur] : null;
  const tipLeft = cur !== null ? (x(cur) / W) * 100 : 0;

  // Week by week: each week's ads ÷ its customers, with the pace beside them.
  const weeks = cost.weeks;
  const bMax = niceMax(Math.max(100, ...weeks.map((w) => w.costCents ?? 0), pace.costCents ?? 0));
  const bPadL = 14 + 7.4 * Math.max(...[0.5, 1].map((f) => money(f * bMax).length));
  const bPlotW = W - bPadL - BPAD.r;
  const bPlotH = BH - BPAD.t - BPAD.b;
  const slot = bPlotW / Math.max(1, weeks.length);
  const barW = Math.min(64, slot * 0.62);
  const by = (v: number) => BPAD.t + bPlotH - (v / bMax) * bPlotH;
  const everyOther = weeks.length > 12;

  return (
    <div className={s.chartWrap} data-customer-cost>
      {!slim && <div className={s.story} data-cost-story>
        <p className={s.storyNow}>{story.now}</p>
        {story.weeks && <p data-story="weeks">{story.weeks}</p>}
        {story.pace && <p data-story="pace">{story.pace}</p>}
        {story.ahead && <p data-story="ahead">{story.ahead}</p>}
        {story.paidBack && <p className={s.storyCross} data-story="paid-back">{story.paidBack}</p>}
      </div>}
      <figure className={s.chart}>
        <div className={s.chartInner}>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            tabIndex={0}
            aria-label={`What a customer costs, ${short(pts[0].date)} to ${short(end.date)}. ${story.now} Arrow keys read day by day.`}
            onPointerMove={onPointer}
            onPointerDown={onPointer}
            onPointerLeave={onLeave}
            onKeyDown={onKey}
            data-cost-chart
          >
            {ticks.map((v) => (
              <g key={v}>
                {v !== 0 && <line x1={padL} x2={W - PAD.r} y1={y(v)} y2={y(v)} className={s.rule} />}
                <text x={padL - 8} y={y(v) + 4} textAnchor="end" className={s.axis}>{money(v)}</text>
              </g>
            ))}
            {todayK < n - 1 && <rect x={x(todayK)} y={PAD.t} width={x(n - 1) - x(todayK)} height={plotH} className={s.future} />}
            {/* $0: below it, the customers have paid back more than they cost. */}
            <line x1={padL} x2={W - PAD.r} y1={y(0)} y2={y(0)} className={s.base} />
            {xTicks.map((k) => (
              <text key={k} x={x(k)} y={H - 14} textAnchor={k === 0 ? "start" : k === n - 1 ? "end" : "middle"} className={s.axis}>{short(pts[k].date)}</text>
            ))}
            <g>
              <line x1={x(todayK)} x2={x(todayK)} y1={PAD.t} y2={PAD.t + plotH} className={s.today} />
              <text x={x(todayK) + 5} y={PAD.t + 12} className={s.axisStrong}>today</text>
            </g>
            {pace.costCents !== null && todayK < n - 1 && (
              <line x1={x(todayK)} x2={x(n - 1)} y1={y(pace.costCents)} y2={y(pace.costCents)} className={s.paceRule} data-pace-rule />
            )}
            <path d={path(after, 0, todayK)} className={s.lineReal} />
            <path d={path(after, todayK, n - 1)} className={`${s.lineReal} ${s.dash}`} />
            <path d={path(win, 0, todayK)} className={s.lineSpend} />
            <path d={path(win, todayK, n - 1)} className={`${s.lineSpend} ${s.dash}`} />
            {now.grossCents !== null && <circle cx={x(todayK)} cy={y(now.grossCents)} r={4} className={`${s.dot} ${s.lineSpend}`} />}
            {now.netCents !== null && <circle cx={x(todayK)} cy={y(now.netCents)} r={4} className={`${s.dot} ${s.lineReal}`} />}
            {/* Each line says its value where it ends. */}
            {labWin !== null && end.grossCents !== null && <text x={x(n - 1) + 8} y={labWin + 4} className={s.endLabel} data-end="win">{money(end.grossCents)} to win</text>}
            {labAfter !== null && end.netCents !== null && <text x={x(n - 1) + 8} y={labAfter + 4} className={`${s.endLabel} ${s.endLabelRev}`} data-end="after">{end.netCents <= 0 ? "paid back" : `${money(end.netCents)} after`}</text>}
            {paidK >= 0 && (
              <g data-paid-back>
                <circle cx={x(paidK)} cy={y(0)} r={5} className={s.mark} />
                <text x={x(paidK) + (paidK > n * 0.7 ? -9 : 9)} y={y(0) - 10} textAnchor={paidK > n * 0.7 ? "end" : "start"} className={s.axisStrong}>paid back · {short(pts[paidK].date)}</text>
              </g>
            )}
            {tip && cur !== null && (
              <g>
                <line x1={x(cur)} x2={x(cur)} y1={PAD.t} y2={PAD.t + plotH} className={s.cursor} />
                {tip.grossCents !== null && <circle cx={x(cur)} cy={y(tip.grossCents)} r={4} className={`${s.dot} ${s.lineSpend}`} />}
                {tip.netCents !== null && <circle cx={x(cur)} cy={y(tip.netCents)} r={4} className={`${s.dot} ${s.lineReal}`} />}
              </g>
            )}
          </svg>
          {tip && cur !== null && (
            <div className={`${s.tip} ${tipLeft > 58 ? s.tipLeft : ""}`} style={{ left: `${tipLeft}%` }} data-cost-tip>
              <div className={s.tipDate}>{longDate(tip.date)} <span className={s.tipTag}>{tip.date === today ? "today" : tip.projected ? "today's pace" : "counted"}</span></div>
              <div className={s.tipRow}><span>To win</span><b>{tip.grossCents === null ? "—" : dollars(tip.grossCents)}</b></div>
              <div className={s.tipRow}><span>After paying</span><b>{tip.netCents === null ? "—" : dollars(tip.netCents)}</b></div>
              <div className={s.tipRow}><span>Customers</span><b>{approx(tip.customers)}</b></div>
              <div className={s.tipRow}><span>Ads, signups to {short(tip.through)}</span><b>{dollars(tip.spendCents)}</b></div>
              <div className={s.tipRow}><span>They paid</span><b>{dollars(tip.paidCents)}</b></div>
            </div>
          )}
        </div>
        <figcaption className={s.legend}>
          <span><i className={`${s.sw} ${s.lineSpend}`} />To win — the ads ÷ the customers they brought, on the signups whose trial is over</span>
          <span><i className={`${s.sw} ${s.lineReal}`} />After paying — less what those customers have paid</span>
          {pace.costCents !== null && <span><i className={`${s.sw} ${s.paceSw}`} />A new customer at today&apos;s pace · {dollars(pace.costCents)}</span>}
          <span className={s.legendNote}>Dashed and shaded: ahead, at today&apos;s pace{ratePct !== null ? ` and ${ratePct}% converting` : ""}. List prices; no churn modelled.</span>
        </figcaption>
      </figure>

      <div className={`${s.readings} ${s.readings4}`}>
        <div className={s.reading} data-reading="cost-today">
          <div className={s.readingHead}>Today · {short(now.date)} · counted</div>
          <div className={s.readingBig}>{now.grossCents === null ? "—" : dollars(now.grossCents)} <span>to win</span></div>
          <div className={s.readingRows}>
            <span>{now.netCents === null ? "no customer counted yet" : now.netCents <= 0 ? "already paid back" : `${dollars(now.netCents)} after paying`}</span>
            <span>{dollars(now.spendCents)} ÷ {approx(now.customers)} · signups to {short(now.through)}</span>
          </div>
        </div>
        <div className={s.reading} data-reading="cost-pace">
          <div className={s.readingHead}>At today&apos;s pace</div>
          <div className={s.readingBig}>{pace.costCents === null ? "—" : dollars(pace.costCents)} <span>a new customer</span></div>
          <div className={s.readingRows}>
            <span>{dollars(pace.spendPerDayCents)}/day · {pace.signupsPerDay} signups/day{ratePct !== null ? ` · ${ratePct}%` : ""}</span>
            <span>{pace.paybackMonths === null ? "once a trial has ended" : `paid back in ${pace.paybackMonths} mo at ${dollars(pace.monthlyCents)}/mo`}</span>
          </div>
        </div>
        <div className={s.reading} data-reading="cost-ahead">
          <div className={s.readingHead}>In {cost.aheadDays} days · {short(end.date)}</div>
          <div className={s.readingBig}>{end.grossCents === null ? "—" : dollars(end.grossCents)} <span>to win</span></div>
          <div className={s.readingRows}>
            <span>{end.netCents === null ? "—" : end.netCents <= 0 ? "paid back" : `${dollars(end.netCents)} after paying`}</span>
            <span>{approx(end.customers)} customers counted</span>
          </div>
        </div>
        <div className={s.reading} data-reading="cost-paid-back">
          <div className={s.readingHead}>Paid back by their customers</div>
          <div className={s.readingBig}>{cost.paidBack.date ? short(cost.paidBack.date) : "—"}</div>
          <div className={s.readingRows}>
            <span>{cost.paidBack.date ? (cost.paidBack.daysFromToday === 0 ? "already" : `in ${cost.paidBack.daysFromToday} days`) : `not within ${cost.paidBack.searchedDays} days`}</span>
            <span>what they paid ≥ the ads counted</span>
          </div>
        </div>
      </div>

      {!slim && weeks.length > 0 && (
        <figure className={s.chart} data-cost-weeks>
          <div className={s.subChartHead}>Week by week — each week&apos;s ads ÷ the customers its signups became</div>
          <div className={s.chartInner}>
            <svg viewBox={`0 0 ${W} ${BH}`} role="img" aria-label={story.weeks ?? "Each week's ads ÷ the customers its signups became."}>
              <defs>
                <pattern id={hatch} width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <line x1={0} y1={0} x2={0} y2={6} className={s.hatchLine} />
                </pattern>
              </defs>
              {[0.5, 1].map((f) => (
                <g key={f}>
                  <line x1={bPadL} x2={W - BPAD.r} y1={by(f * bMax)} y2={by(f * bMax)} className={s.rule} />
                  <text x={bPadL - 8} y={by(f * bMax) + 4} textAnchor="end" className={s.axis}>{money(f * bMax)}</text>
                </g>
              ))}
              <line x1={bPadL} x2={W - BPAD.r} y1={by(0)} y2={by(0)} className={s.base} />
              {weeks.map((w, i) => {
                const cx = bPadL + slot * (i + 0.5);
                const v = w.costCents;
                const words = `${weekRange(w)}: ${dollars(w.spendCents)} of ads ÷ ${w.paying} paying${w.expected ? ` + ≈${w.expected} of the trials running` : ""}${v === null ? "" : ` = ${dollars(v)} a customer`}${w.state === "trial" ? " (trials still running)" : ""}`;
                return (
                  <g key={w.from} data-week={w.from} data-state={w.state}>
                    <title>{words}</title>
                    {v !== null && v > 0 ? (
                      <rect x={cx - barW / 2} y={by(v)} width={barW} height={Math.max(1, by(0) - by(v))} className={w.state === "trial" ? s.barTrial : s.barCounted} style={w.state === "trial" ? { fill: `url(#${hatch})` } : undefined} />
                    ) : null}
                    <text x={cx} y={v !== null && v > 0 ? by(v) - 6 : by(0) - 6} textAnchor="middle" className={v === null ? s.axis : s.axisStrong}>{v === null ? (w.state === "trial" ? "in trial" : "no customer") : `${w.state === "trial" ? "≈" : ""}${money(v)}`}</text>
                    {(!everyOther || i % 2 === 0) && <text x={cx} y={BH - 10} textAnchor="middle" className={s.axis}>{short(w.from)}</text>}
                  </g>
                );
              })}
              {pace.costCents !== null && <line x1={bPadL} x2={W - BPAD.r} y1={by(pace.costCents)} y2={by(pace.costCents)} className={s.paceRule} data-pace-rule />}
            </svg>
          </div>
          <figcaption className={s.legend}>
            <span><i className={`${s.swBox} ${s.barCounted}`} />Every trial of the week is over</span>
            <span><i className={`${s.swBox} ${s.swHatch}`} />Trials still running — counted at the measured rate</span>
            {pace.costCents !== null && <span><i className={`${s.sw} ${s.paceSw}`} />Today&apos;s pace · {dollars(pace.costCents)}</span>}
            <span className={s.legendNote}>Weeks from the first day; the last one is still running.</span>
          </figcaption>
        </figure>
      )}
    </div>
  );
}
