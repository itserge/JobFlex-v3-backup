"use client";

// PEOPLE USING JOBFLEX — THE CHART (owner, 2026-11-04: "prove to investors that users are using the platform … per
// day, 7 days, 30 days, three months and a year", then "I need a chart — how people use JobFlex", then "don't say how
// many were sent … if logged in, still say working with the CRM or other business flow"). One row of range buttons;
// one sentence for the range — people, companies, estimates, and the parts of the business they worked in; a bar for
// each hour, day, week or month — the people at work in it — with a hover or a tap reading it; the numbers as a
// table, folded away. Counts only (lib/investorUsage). Plain
// SVG with the report's own chart furniture (rule, base, axis, tip), one series in the report's blue — no legend, the
// title names it. Drawn at its box's own width (a phone gets every bar and full-size words, never a sideways scroll
// that hides the newest days).
import { useEffect, useRef, useState } from "react";
import type { InvestorUsage, UsageArea, UsageRangeKey } from "@/lib/investorUsage";
import s from "./investor-report.module.css";

const H = 210;
const PAD = { l: 34, r: 8, t: 14, b: 28 };
const n = (v: number) => v.toLocaleString("en-US");
const word = (v: number, one: string, many: string) => `${n(v)} ${v === 1 ? one : many}`;
/** The parts of the business, in the sentence's words and the tooltip's. */
const AREA_WORDS: Record<UsageArea, string> = { crm: "the CRM", jobs: "jobs", calendar: "the calendar", messaging: "messaging", payments: "payments" };
const AREA_SHORT: Record<UsageArea, string> = { crm: "CRM", jobs: "Jobs", calendar: "Calendar", messaging: "Messaging", payments: "Payments" };
const list = (items: string[]) => (items.length < 2 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);
/** "4 people at 1 company worked in JobFlex in the last 30 days — 23 estimates made, plus work in the CRM and jobs." */
function sentence(r: InvestorUsage["ranges"][number]): string {
  if (r.people === 0 && r.companies === 0) return `Nothing counted ${r.words}.`;
  const who = r.people > 0 ? `${word(r.people, "person", "people")} at ${word(r.companies, "company", "companies")}` : word(r.companies, "company", "companies");
  // Signed in with nothing named still is the business, run in JobFlex (owner: "still say working with the CRM or other business flow").
  const where = r.areas.length ? list(r.areas.map((a) => AREA_WORDS[a])) : null;
  if (r.estimates > 0) return `${who} worked in JobFlex ${r.words} — ${word(r.estimates, "estimate", "estimates")} made, plus ${where ? `work in ${where}` : "the day-to-day business"}.`;
  return `${who} worked in JobFlex ${r.words} — ${where ? `in ${where}` : "running the day-to-day business"}.`;
}
/** The axis' top: a round number of people at or above the tallest bar. */
const niceCeil = (v: number) => {
  if (v <= 4) return Math.max(1, v);
  const p = 10 ** Math.floor(Math.log10(v));
  const m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
};
/** Which bars carry a date under them — fewer when the chart is narrow. */
const TICKS: Record<UsageRangeKey, (count: number, narrow: boolean) => number[]> = {
  day: (c, narrow) => (narrow ? [0, 8, 16, c - 1] : [0, 6, 12, 18, c - 1]),
  week: (c, narrow) => (narrow ? [0, 2, 4, c - 1] : Array.from({ length: c }, (_, i) => i)),
  month: (c, narrow) => (narrow ? [0, 10, 20, c - 1] : [0, 7, 14, 21, c - 1]),
  quarter: (c) => [0, 4, 8, c - 1],
  year: (c, narrow) => (narrow ? [0, 3, 6, 9, c - 1] : Array.from({ length: c }, (_, i) => i)),
};
/** A bar with its top corners rounded, standing on the baseline. */
function barPath(x: number, top: number, w: number, base: number): string {
  const h = base - top;
  if (h <= 0) return "";
  const r = Math.min(4, w / 2, h);
  return `M${x},${base}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${base}Z`;
}

export function UsageChart({ usage }: { usage: InvestorUsage }) {
  const [key, setKey] = useState<UsageRangeKey>("month");
  const [cur, setCur] = useState<number | null>(null);
  // The drawing's width is the box's, in pixels: the words stay 11px on a phone and on a desk.
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(760);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.min(1000, Math.round(e.contentRect.width)))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const narrow = W < 520;
  const range = usage.ranges.find((r) => r.key === key) ?? usage.ranges[0];
  if (!range) return null;
  const bars = range.bars;
  const count = bars.length;
  const top = niceCeil(Math.max(0, ...bars.map((b) => b.people)));
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const slot = plotW / count;
  const bw = Math.max(4, Math.min(30, slot - Math.max(2, slot * 0.3)));
  const x = (i: number) => PAD.l + i * slot + (slot - bw) / 2;
  const y = (v: number) => PAD.t + plotH - (v / top) * plotH;
  const grid = [top / 2, top].filter((v) => Number.isInteger(v) && v > 0);
  const tip = cur !== null ? bars[cur] : null;
  const tipLeft = cur !== null ? ((x(cur) + bw / 2) / W) * 100 : 0;
  const pick = (k: UsageRangeKey) => {
    setKey(k);
    setCur(null);
  };
  return (
    <section className={s.card} data-usage-card>
      <div className={s.cardHead}>
        <h2 className={s.h2}>People using JobFlex</h2>
        <span className={s.cardNote}>Counted from the app&apos;s own activity{usage.capped ? " · the oldest bars are at least these" : ""}</span>
      </div>
      <div className={s.usageRanges} role="group" aria-label="Range">
        {usage.ranges.map((r) => (
          <button key={r.key} type="button" className={s.usageRange} aria-pressed={r.key === key} data-usage-range={r.key} onClick={() => pick(r.key)}>
            {r.label}
          </button>
        ))}
      </div>
      <p className={s.usageLine} data-usage-line aria-live="polite">
        {sentence(range)}
      </p>
      <figure className={s.chart} data-usage-chart={range.key}>
        <div className={`${s.chartInner} ${s.usageInner}`} ref={box}>
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`People working in JobFlex ${range.words}, a bar for each ${range.unit}`} onPointerLeave={() => setCur(null)}>
            {grid.map((v) => (
              <g key={v}>
                <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} className={s.rule} />
                <text x={PAD.l - 6} y={y(v) + 4} textAnchor="end" className={s.axis}>{n(v)}</text>
              </g>
            ))}
            <line x1={PAD.l} x2={W - PAD.r} y1={y(0)} y2={y(0)} className={s.base} />
            {bars.map((b, i) => (
              <path key={`b${i}`} d={barPath(x(i), y(b.people), bw, y(0))} className={`${s.usageBar} ${cur === i ? s.usageBarOn : ""}`} data-usage-bar={i} data-people={b.people} />
            ))}
            {TICKS[range.key](count, narrow).map((i) => (
              <text key={`t${i}`} x={x(i) + bw / 2} y={H - 8} textAnchor={i === 0 ? "start" : i === count - 1 ? "end" : "middle"} className={s.axis}>{bars[i].label}</text>
            ))}
            {/* The whole slot answers, not only the painted bar. */}
            {bars.map((b, i) => (
              <rect
                key={`h${i}`}
                x={PAD.l + i * slot}
                y={PAD.t}
                width={slot}
                height={plotH}
                className={s.usageHit}
                tabIndex={0}
                aria-label={`${b.title}: ${word(b.people, "person", "people")}, ${word(b.companies, "company", "companies")}, ${word(b.estimates, "estimate", "estimates")}${b.areas.length ? `, also ${b.areas.map((a) => AREA_SHORT[a]).join(", ")}` : ""}`}
                onPointerEnter={() => setCur(i)}
                onPointerDown={() => setCur(i)}
                onFocus={() => setCur(i)}
                onBlur={() => setCur(null)}
              />
            ))}
          </svg>
          {tip && cur !== null && (
            <div className={`${s.tip} ${tipLeft > 58 ? s.tipLeft : ""}`} style={{ left: `${tipLeft}%` }} data-usage-tip>
              <div className={s.tipDate}>
                {tip.title} {cur === count - 1 ? <span className={s.tipTag}>so far</span> : null}
              </div>
              <div className={s.tipRow}><span>People at work</span><b>{n(tip.people)}</b></div>
              <div className={s.tipRow}><span>Companies</span><b>{n(tip.companies)}</b></div>
              <div className={s.tipRow}><span>Estimates</span><b>{n(tip.estimates)}</b></div>
              {tip.areas.length ? <div className={s.tipRow}><span>Also</span><b>{tip.areas.map((a) => AREA_SHORT[a]).join(", ")}</b></div> : null}
            </div>
          )}
        </div>
      </figure>
      <details className={s.usageTable}>
        <summary>See the numbers</summary>
        <table>
          <thead>
            <tr><th scope="col">{range.unit === "hour" ? "Hour" : range.unit === "day" ? "Day" : range.unit === "week" ? "Week of" : "Month"}</th><th scope="col">People</th><th scope="col">Companies</th><th scope="col">Estimates</th><th scope="col">Also worked in</th></tr>
          </thead>
          <tbody>
            {bars.map((b, i) => (
              <tr key={i}><th scope="row">{b.title}</th><td>{n(b.people)}</td><td>{n(b.companies)}</td><td>{n(b.estimates)}</td><td>{b.areas.length ? b.areas.map((a) => AREA_SHORT[a]).join(", ") : "—"}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}
