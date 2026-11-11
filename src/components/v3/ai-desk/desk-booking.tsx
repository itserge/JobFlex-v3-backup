"use client";
// STEP 3 · WHEN IT CAN BOOK VISITS (2026-10-14): the company's time zone (the desk's clock),
// whether online booking is on, the hours and visits it books from, and a preview of the
// next open times it would offer a caller — the calendar's own, via the same engine.
import { useState } from "react";
import { useRouter } from "next/navigation";

import { previewDeskTimes, setCompanyTimezone } from "@/actions/aiDesk";
import { timezoneWords, US_TIMEZONES } from "@/lib/aiDesk/shared";
import { DESK_COPY as C, type DeskSettingsData } from "@/components/v3/settings-blueprint/settings-data";
import s from "./ai-desk.module.css";
import { DeskHours } from "./desk-hours";
import { DeskBookingEdit } from "./desk-booking-edit";

export function DeskBooking({ desk }: { desk: DeskSettingsData }) {
  const router = useRouter();
  const [tz, setTz] = useState(desk.timezone);
  const [busy, setBusy] = useState<null | "tz" | "preview">(null);
  const [times, setTimes] = useState<Array<{ id: string; label: string }> | null>(null);
  const [previewNote, setPreviewNote] = useState("");
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  // The hours and visits open right here (2026-11-11) — the Online booking page that held them is early access.
  const [editing, setEditing] = useState(false);
  const zones = US_TIMEZONES.some((z) => z.id === tz) ? US_TIMEZONES : [{ id: tz, label: tz }, ...US_TIMEZONES];

  const pickTz = async (next: string) => {
    if (next === tz || busy) return;
    const prev = tz;
    setTz(next);
    setBusy("tz");
    setErr("");
    setNote("");
    try {
      const r = await setCompanyTimezone(next);
      if (r.ok) {
        setNote(r.note ?? "");
        setTimes(null);
        router.refresh();
      } else {
        setTz(prev);
        setErr(r.error);
      }
    } catch {
      setTz(prev);
      setErr("Couldn't save. Try again.");
    } finally {
      setBusy(null);
    }
  };
  const preview = async () => {
    setBusy("preview");
    setErr("");
    try {
      const r = await previewDeskTimes();
      if (r.ok) {
        setTimes(r.times);
        setPreviewNote(r.times.length ? (r.note ?? "") : (r.note ?? C.previewNone));
      } else setErr(r.error);
    } catch {
      setErr("Couldn't reach JobFlex. Try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={s.root} data-desk-booking data-booking-on={desk.booking.enabled ? "1" : "0"}>
      <div className={s.sec}>
        <label className={s.h} htmlFor="desk-timezone">
          {C.tzTitle}
        </label>
        <p className={s.note}>{C.tzSub}</p>
        <select id="desk-timezone" className={s.sel} value={tz} disabled={!desk.canManage || busy !== null} onChange={(e) => void pickTz(e.target.value)}>
          {zones.map((z) => (
            <option key={z.id} value={z.id}>
              {z.label}
            </option>
          ))}
        </select>
        {/* The time there now is a clock: the server's second and the client's differ, so the client's wins without a hydration complaint. */}
        <p className={s.note} data-desk-tz-words suppressHydrationWarning>
          {timezoneWords(tz)}
        </p>
      </div>

      {/* on or off is the card's stamp; off, the way to turn it on stays here */}
      {desk.booking.enabled ? null : (
        <p className={s.note} data-desk-booking-state>
          {C.bookingOff}
        </p>
      )}
      {/* the hours and the visits as a ruled table, its rules the card's full width */}
      {desk.booking.hoursWords || desk.booking.services.length ? (
        <dl className={s.kv}>
          {desk.booking.hoursWords ? (
            <div>
              <dt>{C.bookingHours}</dt>
              <dd>{desk.booking.hoursWords}</dd>
            </div>
          ) : null}
          {desk.booking.services.length ? (
            <div>
              <dt>{C.bookingServices}</dt>
              <dd className={s.visits}>
                {desk.booking.services.map((v) => {
                  const [name, price] = v.split(" — ");
                  return (
                    <span key={v} className={s.visit}>
                      {name}
                      {price ? <span className={s.visitPrice}>&nbsp;— {price}</span> : null}
                    </span>
                  );
                })}
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      {times ? (
        <div className={s.sec} data-desk-preview-times>
          <div className={s.h}>{C.previewTitle}</div>
          {times.length ? (
            <ul className={s.times}>
              {times.map((t) => (
                <li key={t.id}>{t.label}</li>
              ))}
            </ul>
          ) : null}
          {previewNote ? <p className={s.note}>{previewNote}</p> : null}
        </div>
      ) : null}

      {/* where the desk books from, and the hours reserved for it (2026-10-16) */}
      <DeskHours hoursWords={desk.booking.hoursWords} />

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

      {editing ? <DeskBookingEdit desk={desk} onDone={() => setEditing(false)} /> : null}

      {/* the card's foot: the two ways on, one size, at the right */}
      <div className={s.bookFoot}>
        <div className={s.bookActs}>
          {desk.canManage && !editing ? (
            <button type="button" className={s.btn} onClick={() => setEditing(true)} aria-expanded={editing} data-desk-booking-link>
              {C.bookingEdit}
            </button>
          ) : null}
          <button type="button" className={s.btn} disabled={busy !== null} onClick={() => void preview()} data-desk-preview>
            {busy === "preview" ? C.previewLoading : C.previewLoad}
          </button>
        </div>
      </div>
    </div>
  );
}
