"use client";

// SMARTBOOK · ONE REQUEST TO ANSWER (2026-10-31) — the calendar's Requests and the lead page show the same card with
// the same three answers as the text and the request email's page: Yes (book it), No (offer other times), or another
// time. A customer who named only a day (or a morning) gets the hour picked instead of Yes. Whoever answers first wins;
// a second answer hears "Already answered".
import { useState, useTransition } from "react";
import Link from "next/link";
import type { Route } from "next";
import { answerSmartBookRequest } from "@/actions/smartBookOffice";
import type { RequestCard } from "@/lib/smartbook/office";
import styles from "./smartbook.module.css";

type Open = null | "hour" | "other";

export function RequestAnswer({ card, onDone, linkName = true }: { card: RequestCard; onDone: (r: { line: string; booked: boolean }) => void; linkName?: boolean }) {
  const [open, setOpen] = useState<Open>(null);
  const [day, setDay] = useState(card.day ?? "");
  const [time, setTime] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const busy = (b: boolean) => (b && pending ? "true" : undefined);
  const [which, setWhich] = useState<string | null>(null);

  const send = (what: string, decision: { decision: "yes" } | { decision: "no" } | { decision: "other"; day: string | null; time: string }) =>
    start(async () => {
      setWhich(what);
      setError(null);
      const r = await answerSmartBookRequest(card.leadId, decision);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setDone(r.line);
      onDone({ line: r.line, booked: r.booked });
    });

  const free = /free|clear/i.test(card.calendar) && !/^You have/i.test(card.calendar);
  const name = linkName && !card.test ? <Link href={`/dashboard/leads/${card.leadId}` as Route}>{card.name}</Link> : card.name;

  return (
    <div className={styles.req} data-smartbook-request={card.leadId}>
      <div className={styles.reqTop}>
        <div className={styles.reqWho}>
          {name}
          {card.test ? (
            <>
              {" "}
              <span className={styles.stamp} data-tone="ink">Test</span>
            </>
          ) : null}
        </div>
        <div className={styles.reqMeta}>
          {[card.source, card.project].filter(Boolean).join(" · ")} · {card.ago}
        </div>
      </div>
      <p className={styles.reqAsk}>
        Asks for <b>{card.asked}</b>
        {card.phone ? <span className={styles.reqMeta}> · {card.phone}</span> : null}
      </p>
      {card.words ? <p className={styles.reqWords}>&ldquo;{card.words}&rdquo;</p> : null}
      <p className={styles.reqCal} data-busy={free ? undefined : "true"}>
        {card.calendar}
      </p>

      {done ? (
        <p className={styles.reqDone} role="status" data-smartbook-done>
          {done}
        </p>
      ) : (
        <>
          <div className={styles.acts}>
            {card.exact ? (
              <button className={`${styles.btn} ${styles.btnP}`} type="button" disabled={pending} aria-busy={busy(which === "yes")} data-smartbook-yes onClick={() => send("yes", { decision: "yes" })}>
                Yes — book it
              </button>
            ) : card.day ? (
              <button className={`${styles.btn} ${styles.btnP}`} type="button" disabled={pending} aria-expanded={open === "hour"} data-smartbook-hour onClick={() => setOpen(open === "hour" ? null : "hour")}>
                Pick the hour
              </button>
            ) : (
              // Nothing open fit and they named no day: the company names one.
              <button className={`${styles.btn} ${styles.btnP}`} type="button" disabled={pending} aria-expanded={open === "other"} data-smartbook-other onClick={() => setOpen(open === "other" ? null : "other")}>
                Suggest a time
              </button>
            )}
            <button className={styles.btn} type="button" disabled={pending} aria-busy={busy(which === "no")} data-smartbook-no onClick={() => send("no", { decision: "no" })}>
              No — offer other times
            </button>
            {card.exact || card.day ? (
              <button className={styles.btn} type="button" disabled={pending} aria-expanded={open === "other"} data-smartbook-other onClick={() => setOpen(open === "other" ? null : "other")}>
                Suggest another time
              </button>
            ) : null}
          </div>

          {open === "hour" ? (
            <form
              className={styles.reqForm}
              onSubmit={(e) => {
                e.preventDefault();
                if (time) send("hour", { decision: "other", day: card.day, time });
              }}
            >
              <label className={styles.field}>
                <span className={styles.fieldL}>What time on {card.asked.split(",")[0]}?</span>
                <input className={styles.input} type="time" value={time} required step={900} onChange={(e) => setTime(e.target.value)} data-smartbook-time />
              </label>
              <button className={`${styles.btn} ${styles.btnP}`} type="submit" disabled={pending || !time} aria-busy={busy(which === "hour")}>
                Book it
              </button>
            </form>
          ) : null}

          {open === "other" ? (
            <form
              className={styles.reqForm}
              onSubmit={(e) => {
                e.preventDefault();
                if (day && time) send("other", { decision: "other", day, time });
              }}
            >
              <label className={styles.field}>
                <span className={styles.fieldL}>Day</span>
                <input className={styles.input} type="date" value={day} required onChange={(e) => setDay(e.target.value)} data-smartbook-day />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldL}>Time</span>
                <input className={styles.input} type="time" value={time} required step={900} onChange={(e) => setTime(e.target.value)} data-smartbook-time />
              </label>
              <button className={`${styles.btn} ${styles.btnP}`} type="submit" disabled={pending || !day || !time} aria-busy={busy(which === "other")} data-smartbook-send>
                Ask {card.name.split(/\s+/)[0]}
              </button>
              <p className={styles.help}>SmartBook asks them; a yes books it.</p>
            </form>
          ) : null}
        </>
      )}
      {error ? (
        <p className={styles.err} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
