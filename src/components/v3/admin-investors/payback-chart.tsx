"use client";

// MONTH BY MONTH (2026-10-06; one view since 2026-10-25 — owner: "keep only the monthly run-rate; an option for one
// day, 2 days, 7 days…; make it super smart, more understandable"). What a month of ads costs at each day's pace
// against what a month brings in at that day's accounts (lib/investorModel). Zoom: that many days back from today and
// the same ahead, or all of it. Above the chart, the plain words for what is shown (runRateStory); on the chart, each
// line says its value where it ends; under it, the start of the view, today and its end, read out. A hover or tap reads
// one day. Plain SVG scaled to its box; the same component on the admin page and the shared link.
// WHAT IF (2026-10-25: "add a prediction line, dashed, so we can play — if the conversion gets better, where we can
// be"): a slider for the share of trials that convert; past today a dashed line shows a month in at that share, with
// its words. It starts at the measured share, so nothing shows until someone moves it.
import { useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { CurvePoint } from "@/lib/investorModel";
import { dollars, longDate, monthlyPace, payMonthlyDay, runRateReading, runRateStory, runRateWindow, whatIfPoint, whatIfStory, type RunRateReading } from "@/lib/investorModel";
import s from "./investor-report.module.css";

const ZOOMS: Array<{ days: number | null; label: string }> = [
  { days: 1, label: "1 day" },
  { days: 2, label: "2 days" },
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: null, label: "All" },
];

const W = 760;
const H = 320;
const PAD = { r: 124, t: 22, b: 40 };

export const niceMax = (v: number) => {
  if (v <= 0) return 100;
  const p = 10 ** Math.floor(Math.log10(v));
  const m = v / p;
  const step = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10;
  return step * p;
};
export const short = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
/** "$1.2M", "$48k", "$650" — the axis and the line ends. */
export const compact = (cents: number) => {
  const d = cents / 100;
  const unit = (v: number, suffix: string) => `$${v >= 10 || Number.isInteger(v) ? Math.round(v) : v.toFixed(1)}${suffix}`;
  if (d >= 1e6) return unit(d / 1e6, "M");
  if (d >= 1e3) return unit(d / 1e3, "k");
  return `$${Math.round(d)}`;
};
const approx = (n: number) => (n === Math.round(n) ? `${n}` : `≈${Math.round(n)}`);

export function PaybackChart({ curve, today, ratePct, share }: { curve: CurvePoint[]; today: string; /** The measured share that converts, whole %; null = none measured yet. */ ratePct: number | null; /** The same, exact (0–1). */ share: number | null }) {
  const [zoom, setZoom] = useState<number | null>(30);
  const [whatIf, setWhatIf] = useState<number>(ratePct ?? 50);
  const moved = whatIf !== (ratePct ?? 50);
  const [cur, setCur] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const pace = useMemo(() => monthlyPace(curve, today), [curve, today]);
  const w = runRateWindow(curve, today, zoom);
  const pts = curve.slice(w.from, w.to + 1);
  const n = pts.length;
  const at = (k: number) => w.from + k; // the curve's own index of the k-th point shown
  const story = useMemo(() => runRateStory(curve, today, zoom, ratePct), [curve, today, zoom, ratePct]);
  const cross = payMonthlyDay(curve, pace, w.todayIndex);

  const maxVal = niceMax(Math.max(1, ...pts.map((p, k) => Math.max(p.mrrCents, pace[at(k)] ?? 0, moved ? whatIfPoint(p, share, whatIf / 100).mrrCents : 0))));
  const padL = 14 + 7.4 * Math.max(...[0.25, 0.5, 0.75, 1].map((f) => compact(f * maxVal).length));
  const plotW = W - padL - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const x = (k: number) => padL + (n > 1 ? (k * plotW) / (n - 1) : plotW / 2);
  const y = (v: number) => PAD.t + plotH - (v / maxVal) * plotH;
  const line = (pick: (k: number) => number) => pts.map((_, k) => `${k === 0 ? "M" : "L"}${x(k).toFixed(1)},${y(pick(k)).toFixed(1)}`).join(" ");
  const adsAt = (k: number) => pace[at(k)] ?? 0;
  const revAt = (k: number) => pts[k].mrrCents;
  const todayK = w.todayIndex - w.from;
  // The dashed what-if: from today (or the view's start, when today is before it) to the end of the view.
  const wiAt = (k: number) => whatIfPoint(pts[k], share, whatIf / 100).mrrCents;
  const wiFrom = Math.max(0, todayK);
  const wiPath = moved && wiFrom < n - 1 ? pts.slice(wiFrom).map((_, j) => `${j === 0 ? "M" : "L"}${x(wiFrom + j).toFixed(1)},${y(wiAt(wiFrom + j)).toFixed(1)}`).join(" ") : null;
  const crossK = cross && cross.index >= w.from && cross.index <= w.to ? cross.index - w.from : -1;
  const ticks = n <= 8 ? pts.map((_, k) => k) : Array.from(new Set([0, 0.2, 0.4, 0.6, 0.8, 1].map((f) => Math.round(f * (n - 1)))));
  // The two line-end labels, kept apart when the lines end close together.
  const endAds = y(adsAt(n - 1));
  const endRev = y(revAt(n - 1));
  const gap = 16;
  const [labAds, labRev] = Math.abs(endAds - endRev) >= gap ? [endAds, endRev] : endAds <= endRev ? [endAds - gap / 2, endRev + gap / 2] : [endAds + gap / 2, endRev - gap / 2];

  const place = (clientX: number) => {
    const el = svgRef.current;
    if (!el || n < 2) return;
    const box = el.getBoundingClientRect();
    const px = ((clientX - box.left) / box.width) * W;
    const k = Math.round(((px - padL) / plotW) * (n - 1));
    setCur(Math.max(0, Math.min(n - 1, k)));
  };
  const onPointer = (e: ReactPointerEvent<SVGSVGElement>) => place(e.clientX);
  const onLeave = (e: ReactPointerEvent<SVGSVGElement>) => { if (e.pointerType === "mouse") setCur(null); };
  const onKey = (e: ReactKeyboardEvent<SVGSVGElement>) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      setCur((c) => Math.max(0, Math.min(n - 1, (c ?? Math.max(0, todayK)) + (e.key === "ArrowLeft" ? -1 : 1))));
    } else if (e.key === "Escape") setCur(null);
  };
  const tip = cur !== null && cur < n ? runRateReading(curve, pace, at(cur)) : null;
  const tipLeft = cur !== null ? (x(cur) / W) * 100 : 0;

  const reading = (label: string, key: string, r: RunRateReading) => (
    <div className={s.reading} data-reading={key} key={key}>
      <div className={s.readingHead}>{label} · {short(r.date)}{r.projected ? " · projected" : ""}</div>
      <div className={s.readingBig}>{dollars(r.revenueCents)} <span>a month in</span></div>
      <div className={s.readingRows}>
        <span>{dollars(r.adsCents)} a month of ads</span>
        <span>{r.coverPct === null ? "no ads running" : `revenue covers ${r.coverPct}% of the ads`}</span>
        <span>{approx(r.paying)} paying · {approx(r.signups)} signed up</span>
      </div>
    </div>
  );
  const first = runRateReading(curve, pace, w.from);
  const now = runRateReading(curve, pace, w.todayIndex);
  const last = runRateReading(curve, pace, w.to);
  const back = w.todayIndex - w.from;
  const startLabel = back === 0 ? "" : w.from === 0 && (zoom === null || zoom > back) ? "First day" : `${back} ${back === 1 ? "day" : "days"} ago`;
  const endLabel = w.to === w.todayIndex ? "" : `In ${w.to - w.todayIndex} ${w.to - w.todayIndex === 1 ? "day" : "days"}`;

  return (
    <div className={s.chartWrap} data-runrate>
      <div className={s.chartBar}>
        <div className={s.seg} role="group" aria-label="How much to show around today">
          {ZOOMS.map((z) => <button key={z.label} type="button" aria-pressed={zoom === z.days} data-zoom={z.days ?? "all"} onClick={() => { setZoom(z.days); setCur(null); }}>{z.label}</button>)}
        </div>
      </div>
      {/* The plain words for what is on screen. */}
      <div className={s.story} data-runrate-story>
        <p className={s.storyNow}>{story.now}</p>
        {story.past && <p data-story="past">{story.past}</p>}
        {story.ahead && <p data-story="ahead">{story.ahead}</p>}
        <p className={s.storyCross} data-story="cross">{story.cross}</p>
        {moved && <p className={s.storyWhatIf} data-story="what-if">{whatIfStory(curve, today, zoom, share, whatIf)}</p>}
      </div>
      <div className={s.whatIf} data-what-if>
        <label className={s.whatIfLabel} htmlFor="what-if-rate">What if more trials converted? <b>{whatIf}%</b>{ratePct !== null && <span> · measured {ratePct}%</span>}</label>
        {/* A phone's slider moves only by its knob — the − and + step by 5 with a tap. */}
        <div className={s.whatIfControl}>
          <button type="button" className={s.whatIfStep} aria-label="5 points less" data-what-if-step="-5" disabled={whatIf <= 0} onClick={() => setWhatIf((v) => Math.max(0, v - 5))}>−</button>
          <input id="what-if-rate" className={s.whatIfRange} type="range" min={0} max={100} step={1} value={whatIf} onChange={(e) => setWhatIf(Number(e.target.value))} aria-valuetext={`${whatIf}% of trials convert`} />
          <button type="button" className={s.whatIfStep} aria-label="5 points more" data-what-if-step="5" disabled={whatIf >= 100} onClick={() => setWhatIf((v) => Math.min(100, v + 5))}>+</button>
        </div>
        {moved && <button type="button" className={s.whatIfReset} onClick={() => setWhatIf(ratePct ?? 50)}>Back to {ratePct ?? 50}%</button>}
      </div>
      <figure className={s.chart}>
        <div className={s.chartInner}>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            tabIndex={0}
            aria-label={`A month of ads against a month of revenue, ${short(pts[0].date)} to ${short(pts[n - 1].date)}. ${story.now} Arrow keys read day by day.`}
            onPointerMove={onPointer}
            onPointerDown={onPointer}
            onPointerLeave={onLeave}
            onKeyDown={onKey}
          >
            {[0.25, 0.5, 0.75, 1].map((f) => (
              <g key={f}>
                <line x1={padL} x2={W - PAD.r} y1={y(f * maxVal)} y2={y(f * maxVal)} className={s.rule} />
                <text x={padL - 8} y={y(f * maxVal) + 4} textAnchor="end" className={s.axis}>{compact(f * maxVal)}</text>
              </g>
            ))}
            {todayK >= 0 && todayK < n - 1 && <rect x={x(todayK)} y={PAD.t} width={x(n - 1) - x(todayK)} height={plotH} className={s.future} />}
            <line x1={padL} x2={W - PAD.r} y1={y(0)} y2={y(0)} className={s.base} />
            {ticks.map((k) => (
              <text key={k} x={x(k)} y={H - 14} textAnchor={n > 1 && k === 0 ? "start" : n > 1 && k === n - 1 ? "end" : "middle"} className={s.axis}>{short(pts[k].date)}</text>
            ))}
            {todayK >= 0 && todayK < n && (
              <g>
                <line x1={x(todayK)} x2={x(todayK)} y1={PAD.t} y2={PAD.t + plotH} className={s.today} />
                <text x={x(todayK) + 5} y={PAD.t + 12} className={s.axisStrong}>today</text>
              </g>
            )}
            {wiPath && <path d={wiPath} className={s.lineWhatIf} data-what-if-line />}
            <path d={line(revAt)} className={s.lineReal} />
            <path d={line(adsAt)} className={s.lineSpend} />
            {n === 1 && (
              <g>
                <circle cx={x(0)} cy={y(revAt(0))} r={4} className={`${s.dot} ${s.lineReal}`} />
                <circle cx={x(0)} cy={y(adsAt(0))} r={4} className={`${s.dot} ${s.lineSpend}`} />
              </g>
            )}
            {/* Each line says its value where it ends. */}
            <text x={x(n - 1) + 8} y={labAds + 4} className={s.endLabel} data-end="ads">{compact(adsAt(n - 1))} ads</text>
            <text x={x(n - 1) + 8} y={labRev + 4} className={`${s.endLabel} ${s.endLabelRev}`} data-end="revenue">{compact(revAt(n - 1))} in</text>
            {wiPath && <text x={x(n - 1) + 8} y={Math.min(y(wiAt(n - 1)) + 4, labRev - 12, labAds - 12)} className={`${s.endLabel} ${s.endLabelRev}`} data-end="what-if">{compact(wiAt(n - 1))} at {whatIf}%</text>}
            {crossK >= 0 && (
              <g data-cross>
                <circle cx={x(crossK)} cy={y(revAt(crossK))} r={5} className={s.mark} />
                <text x={x(crossK) + (crossK > n * 0.7 ? -9 : 9)} y={y(revAt(crossK)) - 10} textAnchor={crossK > n * 0.7 ? "end" : "start"} className={s.axisStrong}>earns more than its ads · {short(pts[crossK].date)}</text>
              </g>
            )}
            {tip && cur !== null && (
              <g>
                <line x1={x(cur)} x2={x(cur)} y1={PAD.t} y2={PAD.t + plotH} className={s.cursor} />
                <circle cx={x(cur)} cy={y(revAt(cur))} r={4} className={`${s.dot} ${s.lineReal}`} />
                <circle cx={x(cur)} cy={y(adsAt(cur))} r={4} className={`${s.dot} ${s.lineSpend}`} />
              </g>
            )}
          </svg>
          {tip && cur !== null && (
            <div className={`${s.tip} ${tipLeft > 58 ? s.tipLeft : ""}`} style={{ left: `${tipLeft}%` }} data-tip>
              <div className={s.tipDate}>{longDate(tip.date)} <span className={s.tipTag}>{tip.date === today ? "today" : tip.projected ? "projected" : "real"}</span></div>
              <div className={s.tipRow}><span>A month in</span><b>{dollars(tip.revenueCents)}</b></div>
              <div className={s.tipRow}><span>A month of ads</span><b>{dollars(tip.adsCents)}</b></div>
              <div className={s.tipRow}><span>Revenue covers</span><b>{tip.coverPct === null ? "—" : `${tip.coverPct}%`}</b></div>
              {moved && tip.projected && cur !== null && <div className={s.tipRow}><span>If {whatIf}% converted</span><b>{dollars(wiAt(cur))}</b></div>}
              <div className={`${s.tipRow} ${s.tipMuted}`}><span>{approx(tip.paying)} paying · {approx(tip.signups)} signed up</span></div>
            </div>
          )}
        </div>
        <figcaption className={s.legend}>
          <span><i className={`${s.sw} ${s.lineReal}`} />A month in — the accounts paying{ratePct === null ? "" : `; after today, trials at ${ratePct}% converting`}</span>
          <span><i className={`${s.sw} ${s.lineSpend}`} />A month of ads — the last 7 days&apos; spend × 30</span>
          {moved && <span><i className={`${s.sw} ${s.lineWhatIf}`} />What if {whatIf}% converted</span>}
          <span className={s.legendNote}>Shaded: ahead, at today&apos;s pace. Today, still running, counts at least at last week&apos;s pace. List prices.</span>
        </figcaption>
      </figure>
      <div className={s.readings}>
        {/* The view's start, read out — not on the count's first day (owner, 2026-10-26: "don't show the 782, make it the
            total"): the line still starts where it did; the words give the multiple and the total. */}
        {startLabel && w.from !== 0 && reading(startLabel, "start", first)}
        {reading("Today", "today", now)}
        {endLabel && reading(endLabel, "end", last)}
      </div>
    </div>
  );
}
