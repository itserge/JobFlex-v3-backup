"use client";
// THE DESK'S HOURS (owner, 2026-10-16): where the AI desk books from — the company's open hours, or only the hours
// reserved for it — and the reservations themselves, by the hour: one day or every week, for a person or for the
// company. A salesperson reserves their own from their calendar too (the calendar's "AI desk hours"); both write the
// same list (actions/deskHours, lib/deskHours).
import { useEffect, useState } from "react";

import { loadDeskHours, removeDeskHours, reserveDeskHours, setDeskHoursMode, type DeskHoursView } from "@/actions/deskHours";
import { spanWords } from "@/lib/deskHours";
import s from "./ai-desk.module.css";
import h from "./desk-hours.module.css";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function DeskHours({ hoursWords }: { hoursWords: string }) {
  const [view, setView] = useState<DeskHoursView | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  // the reservation being written
  const [who, setWho] = useState<string>("");
  const [repeat, setRepeat] = useState<"once" | "weekly">("once");
  const [date, setDate] = useState("");
  const [dow, setDow] = useState(1);
  const [from, setFrom] = useState("09:00");
  const [to, setTo] = useState("12:00");

  useEffect(() => {
    let alive = true;
    loadDeskHours()
      .then((v) => {
        if (!alive) return;
        setView(v);
        setDate(v.today);
        setWho(v.canManage ? "" : v.me);
      })
      .catch(() => alive && setLoadErr("Couldn't load the reserved hours. Reload the page to try again."));
    return () => {
      alive = false;
    };
  }, []);

  const reload = async () => setView(await loadDeskHours());

  if (loadErr) return <p className={`${s.note} ${s.noteErr}`}>{loadErr}</p>;
  if (!view) return <p className={s.note}>Loading the desk&apos;s hours…</p>;

  const pickMode = async (mode: DeskHoursView["mode"]) => {
    if (mode === view.mode || busy) return;
    const was = view.mode;
    // The choice moves at once; a refused save puts it back.
    setView({ ...view, mode });
    setBusy("mode");
    setErr("");
    setNote("");
    const r = await setDeskHoursMode(mode).catch(() => ({ ok: false as const, error: "Couldn't save. Try again." }));
    if (r.ok) {
      await reload();
      setNote(mode === "reserved" ? "The desk now books only inside reserved hours." : "The desk now books from your open hours.");
    } else {
      setView((v) => (v ? { ...v, mode: was } : v));
      setErr(r.error);
    }
    setBusy(null);
  };
  const reserve = async () => {
    setBusy("add");
    setErr("");
    setNote("");
    const r = await reserveDeskHours({ userId: who || null, date: repeat === "once" ? date : null, dow: repeat === "weekly" ? dow : null, from, to }).catch(() => ({ ok: false as const, error: "Couldn't save. Try again." }));
    if (r.ok) {
      await reload();
      setNote(`Reserved: ${r.words}.`);
    } else setErr(r.error);
    setBusy(null);
  };
  const remove = async (id: string) => {
    setBusy(`rm:${id}`);
    setErr("");
    setNote("");
    const r = await removeDeskHours(id).catch(() => ({ ok: false as const, error: "Couldn't remove. Try again." }));
    if (r.ok) await reload();
    else setErr(r.error);
    setBusy(null);
  };

  const reservedNone = view.mode === "reserved" && !view.windows.length;
  return (
    <div className={h.root} data-desk-hours data-mode={view.mode}>
      <div className={s.sec} role="radiogroup" aria-label="Where the desk books visits" data-tour="ai-desk:hours">
        <div className={s.h}>Where the desk books visits</div>
        <div className={s.radios}>
          {(
            [
              { key: "open-hours", title: "Our open hours", sub: hoursWords ? `${hoursWords} — any open time, up to your crew count.` : "Any open time inside the company's hours." },
              { key: "reserved", title: "Only hours we reserve", sub: "Salespeople reserve their own on the calendar; you can reserve any day and hour here. Each visit goes to the person whose hours they were." },
            ] as const
          ).map((o) => (
            <label key={o.key} className={`${s.radio} ${view.mode === o.key ? s.radioOn : ""}`} data-hours-mode={o.key}>
              <input type="radio" name="desk-hours-mode" value={o.key} checked={view.mode === o.key} disabled={!view.canManage || busy !== null} onChange={() => void pickMode(o.key)} />
              <span>
                <b>{o.title}</b>
                <span className={s.note}>{o.sub}</span>
              </span>
            </label>
          ))}
        </div>
        {!view.canManage ? <p className={s.note}>An owner or manager chooses this.</p> : null}
        {reservedNone ? (
          <p className={`${s.note} ${s.noteErr}`} data-hours-none>
            No hours are reserved yet — until some are, the desk takes a message instead of booking.
          </p>
        ) : null}
      </div>

      <div className={s.sec}>
        <div className={s.h}>Reserved hours</div>
        <p className={s.note}>
          {view.mode === "reserved" ? "The desk offers callers times inside these, on your slot grid, skipping anything already on that person's calendar." : "Kept for when you switch to “Only hours we reserve”."}
        </p>
        {view.windows.length ? (
          <ul className={h.list} data-hours-list>
            {view.windows.map((w) => (
              <li key={w.id} className={h.item} data-hours-item={w.id}>
                <span className={h.when}>{w.words}</span>
                <span className={h.who}>{w.who}</span>
                {view.canManage || w.mine ? (
                  <button type="button" className={s.btn} disabled={busy !== null} onClick={() => void remove(w.id)} aria-label={`Remove ${w.words}`}>
                    {busy === `rm:${w.id}` ? "Removing…" : "Remove"}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <div className={s.empty}>
            <p className={s.note}>Nothing reserved yet.</p>
          </div>
        )}
      </div>

      {view.canReserve ? (
        <div className={`${s.sec} ${h.form}`} data-hours-form>
          <div className={s.h}>Reserve hours</div>
          <div className={h.grid}>
            <label className={h.fld}>
              <span className={h.lbl}>For</span>
              <select className={s.sel} value={who} disabled={!view.canManage || busy !== null} onChange={(e) => setWho(e.target.value)} data-hours-who>
                {view.canManage ? <option value="">Anyone at the company</option> : null}
                {view.people.map((p) => (
                  <option key={p.userId} value={p.userId}>
                    {p.userId === view.me ? `${p.name} (me)` : p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={h.fld}>
              <span className={h.lbl}>Repeats</span>
              <select className={s.sel} value={repeat} disabled={busy !== null} onChange={(e) => setRepeat(e.target.value as "once" | "weekly")} data-hours-repeat>
                <option value="once">One day</option>
                <option value="weekly">Every week</option>
              </select>
            </label>
            {repeat === "once" ? (
              <label className={h.fld}>
                <span className={h.lbl}>Day</span>
                <input className={s.in} type="date" value={date} min={view.today} disabled={busy !== null} onChange={(e) => setDate(e.target.value)} data-hours-date />
              </label>
            ) : (
              <label className={h.fld}>
                <span className={h.lbl}>Day of the week</span>
                <select className={s.sel} value={dow} disabled={busy !== null} onChange={(e) => setDow(Number(e.target.value))} data-hours-dow>
                  {DAYS.map((d, i) => (
                    <option key={d} value={i}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className={h.fld}>
              <span className={h.lbl}>From</span>
              <input className={s.in} type="time" step={900} value={from} disabled={busy !== null} onChange={(e) => setFrom(e.target.value)} data-hours-from />
            </label>
            <label className={h.fld}>
              <span className={h.lbl}>To</span>
              <input className={s.in} type="time" step={900} value={to} disabled={busy !== null} onChange={(e) => setTo(e.target.value)} data-hours-to />
            </label>
          </div>
          <div className={s.acts}>
            <button type="button" className={`${s.btn} ${s.btnPrimary}`} disabled={busy !== null || !from || !to || (repeat === "once" && !date)} onClick={() => void reserve()} data-hours-add>
              {busy === "add" ? "Reserving…" : from && to && to > from ? `Reserve ${spanWords(from, to)}` : "Reserve"}
            </button>
          </div>
        </div>
      ) : null}

      {note ? (
        <p className={`${s.note} ${s.noteOk}`} role="status">
          {note}
        </p>
      ) : null}
      {err ? (
        <p className={`${s.note} ${s.noteErr}`} role="alert">
          {err}
        </p>
      ) : null}
    </div>
  );
}
