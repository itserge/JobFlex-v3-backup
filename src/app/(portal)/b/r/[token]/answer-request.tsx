"use client";

// SMARTBOOK · ANSWERING A REQUEST from the email (2026-10-31): Yes (or the hour, when they named only a day), No,
// or another day and time. Styled by the booking sheet (book-public.css).

import { useState, useTransition, type ReactNode } from "react";
import { smartBookDecide } from "@/actions/smartBook";
import type { RequestView } from "@/lib/smartbook/engine";

export function AnswerRequest({ token, view }: { token: string; view: RequestView }) {
  const [done, setDone] = useState<{ text: string; bad?: boolean } | null>(view.open ? null : { text: `Already answered — ${view.now ?? ""}`.trim() });
  const [other, setOther] = useState(false);
  const [day, setDay] = useState(view.day ?? "");
  const [time, setTime] = useState("");
  const [pending, start] = useTransition();
  const answer = (d: { decision: "yes" } | { decision: "no" } | { decision: "other"; day: string | null; time: string }) =>
    start(async () => {
      const r = await smartBookDecide(token, d);
      setDone(r.ok ? { text: r.line } : { text: r.error, bad: true });
    });
  const facts: Array<[string, ReactNode]> = [
    ["Asks for", view.asked],
    ...(view.calendar ? [["Calendar", view.calendar] as [string, ReactNode]] : []),
    ["Lead", [view.source, view.project].filter(Boolean).join(" · ") || "—"],
    ["Phone", view.phone ? <a href={`tel:${view.phone.replace(/[^\d+]/g, "")}`}>{view.phone}</a> : "—"],
    ...(view.words ? [["Their words", `“${view.words}”`] as [string, ReactNode]] : []),
  ];
  return (
    <div className="jfb-manage" data-answer-open={view.open && !done ? "1" : "0"}>
      <dl className="jfb-sum">
        {facts.map(([k, v]) => (
          <div key={k} className="jfb-sum-r jfb-sum-r--plain">
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {done ? (
        <p className={done.bad ? "jfb-err jfb-err--top" : "jfb-msg"} role="status" data-answer-done>{done.text}</p>
      ) : other || !view.exact ? (
        <form className="jfb-form" onSubmit={(e) => { e.preventDefault(); if (time) answer({ decision: "other", day: day || null, time }); }}>
          <h2 className="jfb-h2">{view.exact ? "Another day and time" : "Pick the hour"}</h2>
          {!view.exact && <p className="jfb-hint">They named {view.asked} without an hour. Pick one and it&apos;s booked; another day goes back to them to say yes to.</p>}
          <div className="jfb-two">
            <label className="jfb-fld">
              <span className="jfb-lbl">Day</span>
              <input className="jfb-in" type="date" value={day} onChange={(e) => setDay(e.target.value)} required data-answer-day />
            </label>
            <label className="jfb-fld">
              <span className="jfb-lbl">Time</span>
              <input className="jfb-in" type="time" step={900} value={time} onChange={(e) => setTime(e.target.value)} required data-answer-time />
            </label>
          </div>
          <div className="jfb-acts">
            <button type="submit" className="jfb-btn jfb-btn--primary" disabled={pending || !time} data-answer-other>{pending ? "Sending…" : view.exact ? "Offer this time" : "Book it"}</button>
            {view.exact ? <button type="button" className="jfb-btn" onClick={() => setOther(false)} disabled={pending}>Back</button> : <button type="button" className="jfb-btn" onClick={() => answer({ decision: "no" })} disabled={pending} data-answer-no>No — offer other times</button>}
          </div>
        </form>
      ) : (
        <div className="jfb-acts jfb-acts--stack">
          <button type="button" className="jfb-btn jfb-btn--primary" onClick={() => answer({ decision: "yes" })} disabled={pending} data-answer-yes>{pending ? "Booking…" : `Yes — book ${view.asked}`}</button>
          <button type="button" className="jfb-btn" onClick={() => answer({ decision: "no" })} disabled={pending} data-answer-no>No — offer other times</button>
          <button type="button" className="jfb-btn" onClick={() => setOther(true)} disabled={pending} data-answer-another>Suggest another time</button>
        </div>
      )}
    </div>
  );
}
