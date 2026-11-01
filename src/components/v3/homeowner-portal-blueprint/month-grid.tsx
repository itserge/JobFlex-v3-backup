"use client";

// THE CALENDAR'S MONTH (2026-11-01): seven columns, today outlined, a blue dot
// on a day someone is coming, a short line on the month a planned project is
// set for; ‹ › walk the months. It reads; it does not edit — the rows under
// it say what each mark is.

import * as React from "react";
import s from "./portal.module.css";

type Mark = "visit" | "plan";

function monthCells(year: number, month: number): Array<string | null> {
  const lead = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: Array<string | null> = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= days; d++) cells.push(`${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  while (cells.length % 7) cells.push(null);
  return cells;
}

export function MonthGrid({ today, marks }: { today: string; marks: Record<string, Mark> }) {
  const [offset, setOffset] = React.useState(0);
  const first = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1 + offset, 1));
  const y = first.getUTCFullYear();
  const m = first.getUTCMonth();
  const label = first.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <div className={s.month}>
      <div className={s.monthHead}>
        <button type="button" className={s.monthNav} onClick={() => setOffset((o) => o - 1)} aria-label="Previous month">‹</button>
        <p className={s.monthName} aria-live="polite">{label}</p>
        <button type="button" className={s.monthNav} onClick={() => setOffset((o) => o + 1)} aria-label="Next month">›</button>
      </div>
      <div className={s.monthGrid} role="group" aria-label={label}>
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <span key={i} className={s.dow} aria-hidden="true">{d}</span>)}
        {monthCells(y, m).map((ymd, i) => {
          if (!ymd) return <span key={i} className={s.dayPad} aria-hidden="true" />;
          const mark = marks[ymd];
          return (
            <span key={i} className={s.day} data-today={ymd === today || undefined} data-mark={mark}>
              {Number(ymd.slice(8, 10))}
              {mark && <span className={s.srOnly}>{mark === "visit" ? " — someone is coming" : " — a planned project"}</span>}
            </span>
          );
        })}
      </div>
    </div>
  );
}
