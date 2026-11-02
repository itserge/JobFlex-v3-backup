"use client";

// VISITS & CALLS ON THE LEAD (owner, 2026-10-31: "schedule a lead from the lead detail page … and the AI desk will
// also contact those leads"). The next visit as a slip — the day in an ink title block, the time, the crew, its
// stamp — then the two ways to move the lead: Schedule visit (the Blueprint sheet: a desk dialog, a bottom sheet on
// a phone) and Have the AI desk call. Below them what already happened: earlier visits and the desk's calls.
//
// Booking goes through the calendar's own action (actions/appointments createAppointment), so the visit is an
// ordinary appointment linked to this lead: it shows on the calendar, texts the office, and marks the lead reached.

import Link from "next/link";
import type { Route } from "next";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, PhoneOutgoing } from "lucide-react";
import { BlueprintSheet } from "@/components/ui/BlueprintSheet";
import { createAppointment } from "@/actions/appointments";
import { callLeadWithDesk } from "@/actions/leads";
import styles from "./lead-detail.module.css";

const cx = (...names: Array<string | false | null | undefined>) =>
  names.filter(Boolean).map((n) => styles[n as string] ?? n).join(" ");

export type LeadVisit = {
  id: string;
  title: string;
  /** "Tue, Nov 4 · 9:00–10:00 AM", in the company's time. */
  when: string;
  mon: string;
  day: string;
  wkd: string;
  status: string;
  upcoming: boolean;
  crew: string[];
  /** The calendar's `?date=` for the visit's day. */
  date: string;
};

export type LeadCallRow = {
  id: string;
  /** "Oct 31, 9:05 AM" */
  when: string;
  /** "Booked a visit", "Voicemail left", "No answer" … */
  label: string;
  tone: "ok" | "warn" | "bad" | "info";
  detail: string | null;
};

export type LeadVisitsProps = {
  leadId: string;
  leadName: string;
  /** The zone the times above were written in (the viewer's `tz` cookie, else the company's). */
  tz: string;
  /** The visit's title and notes as the sheet opens. */
  defaults: { title: string; notes: string };
  visits: LeadVisit[];
  /** Owners, managers and sales reps book; estimators and crew read. */
  canSchedule: boolean;
  /** Why booking is off for this company (the calendar is not on its plan), or null. */
  scheduleOff: string | null;
  crew: Array<{ id: string; name: string }>;
  desk: {
    /** The button is drawn at all: the role may call and the lead has a phone. */
    show: boolean;
    /** Why the desk can't call this lead now, or null when it can. */
    blocker: string | null;
    /** The desk is ringing or talking with them right now. */
    live: boolean;
  };
  calls: LeadCallRow[];
};

const LENGTHS = [
  { min: 30, label: "30 minutes" },
  { min: 60, label: "1 hour" },
  { min: 90, label: "1½ hours" },
  { min: 120, label: "2 hours" },
  { min: 180, label: "3 hours" },
  { min: 240, label: "4 hours" },
];

const STAMP_TONE: Record<string, string> = { SCHEDULED: "info", COMPLETED: "ok", CANCELED: "mute", NO_SHOW: "bad" };
const STAMP_WORD: Record<string, string> = { SCHEDULED: "Scheduled", COMPLETED: "Done", CANCELED: "Canceled", NO_SHOW: "No-show" };

/** `YYYY-MM-DD` of a local date — what a date input reads and writes. */
function dayValue(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function actionWords(err: unknown): string {
  const msg = err instanceof Error ? err.message.trim() : "";
  if (/plan limit/i.test(msg)) return "Your plan's calendar is full for now — see Subscription to add room.";
  if (/locked|not on your plan|custom page/i.test(msg)) return "The calendar isn't on your plan.";
  // Production replaces a thrown message with a generic paragraph; only a short, real one is worth showing.
  if (msg && msg.length < 120 && !/server components|digest|fetch failed/i.test(msg)) return msg;
  return "The visit couldn't be booked. Check your connection and try again.";
}

function Stamp({ status }: { status: string }) {
  return (
    <span className={cx("stamp")} data-tone={STAMP_TONE[status] ?? "mute"}>
      {STAMP_WORD[status] ?? status.toLowerCase()}
    </span>
  );
}

export function LeadVisits({ leadId, leadName, tz, defaults, visits, canSchedule, scheduleOff, crew, desk, calls }: LeadVisitsProps) {
  const router = useRouter();
  const ids = useId();
  const [open, setOpen] = useState(false);
  const [busy, setBusyState] = useState(false);
  const busyRef = useRef(false);
  const setBusy = (v: boolean) => {
    busyRef.current = v;
    setBusyState(v);
  };
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [calling, setCalling] = useState(false);

  // The sheet's fields. Tomorrow at 9 is the usual first estimate visit.
  const tomorrow = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return dayValue(d);
  }, []);
  const [title, setTitle] = useState(defaults.title);
  const [day, setDay] = useState(tomorrow);
  const [time, setTime] = useState("09:00");
  const [length, setLength] = useState(60);
  const [who, setWho] = useState<string[]>([]);
  const [notes, setNotes] = useState(defaults.notes);

  const next = visits.find((v) => v.upcoming && v.status === "SCHEDULED") ?? null;
  const earlier = visits.filter((v) => v !== next);

  // The sheet books in this browser's time, so the slip must read in it too: publish the zone the way the calendar
  // does (the `tz` cookie, calendar-view-a) and, when the server wrote the times in another, read the page again.
  useEffect(() => {
    const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!local) return;
    document.cookie = `tz=${local}; path=/; max-age=31536000; samesite=lax`;
    if (local !== tz) router.refresh();
  }, [tz, router]);

  // While the desk is on the line with them, the page reads the call again every 10 s (for 5 minutes at most).
  useEffect(() => {
    if (!desk.live) return;
    let n = 0;
    const t = window.setInterval(() => {
      n += 1;
      router.refresh();
      if (n >= 30) window.clearInterval(t);
    }, 10_000);
    return () => window.clearInterval(t);
  }, [desk.live, router]);

  function openSheet() {
    setError(null);
    setNote(null);
    setOpen(true);
  }

  async function book() {
    if (busy) return;
    const start = new Date(`${day}T${time}`);
    if (!title.trim()) return setError("Say what the visit is for.");
    if (!day || !time || Number.isNaN(start.getTime())) return setError("Pick the day and the time.");
    if (start.getTime() < Date.now() - 5 * 60_000) return setError("That time has passed — pick a time ahead.");
    const end = new Date(start.getTime() + length * 60_000);
    setBusy(true);
    setError(null);
    try {
      await createAppointment({
        title: title.trim().slice(0, 120),
        leadId,
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        notes: notes.trim() || null,
        status: "SCHEDULED",
        workerIds: who,
      });
      setOpen(false);
      setNote({ tone: "ok", text: `Booked: ${start.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}. It's on the calendar.` });
      router.refresh();
    } catch (err) {
      setError(actionWords(err));
    } finally {
      setBusy(false);
    }
  }

  async function deskCall() {
    if (calling || desk.blocker) return;
    setCalling(true);
    setNote(null);
    try {
      const r = await callLeadWithDesk(leadId);
      setNote({ tone: r.ok ? "ok" : "bad", text: r.message });
      if (r.ok) router.refresh();
    } catch {
      setNote({ tone: "bad", text: "The desk couldn't call right now. Try again in a minute." });
    } finally {
      setCalling(false);
    }
  }

  const deskBusy = calling || desk.live;
  const sheetId = `${ids}-visit`;
  // Stable, so the sheet's Escape listener is not re-bound on every keystroke; a booking in flight keeps it open.
  const closeSheet = useCallback(() => {
    if (!busyRef.current) setOpen(false);
  }, []);

  return (
    <section className={cx("card", "visits")} data-lead-visits aria-labelledby={`${ids}-h`}>
      <h2 className={cx("sec-h")} id={`${ids}-h`}>
        Visits &amp; calls
      </h2>

      {next ? (
        <Link className={cx("slip")} href={`/dashboard/calendar?date=${next.date}` as Route} data-lead-next-visit>
          <span className={cx("slip-day")} aria-hidden="true">
            <span className={cx("slip-mon")}>{next.mon}</span>
            <span className={cx("slip-num")}>{next.day}</span>
            <span className={cx("slip-wkd")}>{next.wkd}</span>
          </span>
          <span className={cx("slip-txt")}>
            <span className={cx("slip-k")}>Next visit</span>
            <span className={cx("slip-t")}>{next.title}</span>
            <span className={cx("slip-w")}>{next.when}</span>
            {next.crew.length ? <span className={cx("slip-c")}>Crew · {next.crew.join(", ")}</span> : null}
          </span>
        </Link>
      ) : (
        <p className={cx("visits-empty")}>No visit booked yet.</p>
      )}

      <div className={cx("visits-acts")}>
        {canSchedule ? (
          <button type="button" className={cx("btn", "btn-primary", "visits-btn")} onClick={openSheet} disabled={!!scheduleOff} aria-haspopup="dialog" data-lead-schedule>
            <CalendarPlus size={16} strokeWidth={2.2} aria-hidden="true" />
            {next ? "Schedule another" : "Schedule visit"}
          </button>
        ) : null}
        {desk.show ? (
          <button type="button" className={cx("btn", "btn-ghost", "visits-btn")} onClick={() => void deskCall()} disabled={deskBusy || !!desk.blocker} aria-describedby={desk.blocker ? `${ids}-desk-why` : undefined} data-lead-desk-call>
            <PhoneOutgoing size={16} strokeWidth={2.2} aria-hidden="true" />
            {deskBusy ? "The desk is calling…" : "Have the AI desk call"}
          </button>
        ) : null}
      </div>
      {scheduleOff && canSchedule ? <p className={cx("visits-why")}>{scheduleOff}</p> : null}
      {desk.show && desk.blocker && !desk.live ? (
        <p className={cx("visits-why")} id={`${ids}-desk-why`}>
          AI desk: {desk.blocker}{" "}
          {/(desk|AI desk|minutes|plan)/i.test(desk.blocker) ? (
            <Link href={"/dashboard/phone?tab=settings" as Route}>Open the AI desk</Link>
          ) : null}
        </p>
      ) : null}
      <p className={cx("visits-note")} data-tone={note?.tone} role="status" aria-live="polite">
        {note?.text ?? ""}
      </p>

      {earlier.length || calls.length ? (
        <ul className={cx("trail")} data-lead-trail>
          {earlier.map((v) => (
            <li key={v.id} className={cx("trail-row")}>
              <span className={cx("trail-k")}>Visit</span>
              <span className={cx("trail-txt")}>
                <b>{v.title}</b>
                <span>{v.when}</span>
              </span>
              <Stamp status={v.status} />
            </li>
          ))}
          {calls.map((c) => (
            <li key={c.id} className={cx("trail-row")}>
              <span className={cx("trail-k")}>Desk</span>
              <span className={cx("trail-txt")}>
                <b>{c.label}</b>
                <span>
                  {c.when}
                  {c.detail ? ` · ${c.detail}` : ""}
                </span>
              </span>
              <span className={cx("stamp")} data-tone={c.tone}>
                Call
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <BlueprintSheet
        open={open}
        onClose={closeSheet}
        title="Schedule a visit"
        description={`${leadName} · it goes on your calendar`}
        footer={
          <>
            <button type="button" className="bps-btn bps-btn--ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="bps-btn bps-btn--primary" onClick={() => void book()} disabled={busy} data-lead-book>
              {busy ? "Booking…" : "Book visit"}
            </button>
          </>
        }
      >
        <form
          id={sheetId}
          className="bps-form"
          onSubmit={(e) => {
            e.preventDefault();
            void book();
          }}
        >
          <label className="bps-fld bps-fld--wide">
            <span>What</span>
            <input className="bps-in" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} required />
          </label>
          <label className="bps-fld">
            <span>Day</span>
            <input className="bps-in" type="date" value={day} min={dayValue(new Date())} onChange={(e) => setDay(e.target.value)} required />
          </label>
          <label className="bps-fld">
            <span>Start</span>
            <input className="bps-in" type="time" value={time} step={900} onChange={(e) => setTime(e.target.value)} required />
          </label>
          <label className="bps-fld bps-fld--wide">
            <span>Length</span>
            <select className="bps-in" value={length} onChange={(e) => setLength(Number(e.target.value))}>
              {LENGTHS.map((l) => (
                <option key={l.min} value={l.min}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
          {crew.length ? (
            <fieldset className={cx("pick")}>
              <legend>Who goes</legend>
              <div className={cx("pick-list")}>
                {crew.map((w) => {
                  const on = who.includes(w.id);
                  return (
                    <label key={w.id} className={cx("pick-row")} data-on={on ? "1" : "0"}>
                      <input type="checkbox" checked={on} onChange={() => setWho((xs) => (on ? xs.filter((x) => x !== w.id) : [...xs, w.id]))} />
                      <span>{w.name}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ) : null}
          <label className="bps-fld bps-fld--wide">
            <span>Notes for the visit</span>
            <textarea className="bps-in" rows={4} value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} />
          </label>
          {error ? (
            <p className="bps-err" role="alert">
              {error}
            </p>
          ) : null}
          {/* Enter in a field books, as the footer's button does. */}
          <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
        </form>
      </BlueprintSheet>
    </section>
  );
}
