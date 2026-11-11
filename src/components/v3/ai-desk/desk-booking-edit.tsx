"use client";
// THE DESK'S HOURS AND VISITS, CHANGED RIGHT HERE (2026-11-11). They live in the booking settings the calendar and the
// desk read (lib/booking); the only place to change them was the Online booking page, which is early access — so a
// customer saw "Change hours and visits" and landed back on the dashboard. Opened under the Booking step's own button.
import { useState } from "react";
import { useRouter } from "next/navigation";

import { saveDeskBooking } from "@/actions/aiDesk";
import { DESK_COPY as C, type DeskSettingsData } from "@/components/v3/settings-blueprint/settings-data";
import s from "./ai-desk.module.css";
import h from "./desk-hours.module.css";

type Day = { open: string; close: string } | null;
type Visit = { key: string; label: string; minutes: number; priceText: string };

/** Monday first, the way a contractor reads a week; the settings keep Sunday at 0. */
const WEEK: ReadonlyArray<[number, string]> = [[1, "Monday"], [2, "Tuesday"], [3, "Wednesday"], [4, "Thursday"], [5, "Friday"], [6, "Saturday"], [0, "Sunday"]];
const LENGTHS: ReadonlyArray<[number, string]> = [[15, "15 min"], [30, "30 min"], [45, "45 min"], [60, "1 hour"], [90, "1½ hours"], [120, "2 hours"], [180, "3 hours"], [240, "4 hours"]];
const DEFAULT_DAY = { open: "08:00", close: "17:00" };

export function DeskBookingEdit({ desk, onDone }: { desk: DeskSettingsData; onDone: () => void }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(desk.booking.enabled);
  const [hours, setHours] = useState<Day[]>(() => (desk.booking.hours.length === 7 ? desk.booking.hours : [null, DEFAULT_DAY, DEFAULT_DAY, DEFAULT_DAY, DEFAULT_DAY, DEFAULT_DAY, null]));
  const [visits, setVisits] = useState<Visit[]>(() => (desk.booking.visits.length ? desk.booking.visits : [{ key: "", label: "Estimate visit", minutes: 60, priceText: "Free" }]));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const off = busy || !desk.canManage;

  const setDay = (i: number, next: Day) => setHours((hs) => hs.map((d, k) => (k === i ? next : d)));
  const setVisit = (i: number, patch: Partial<Visit>) => setVisits((vs) => vs.map((v, k) => (k === i ? { ...v, ...patch } : v)));

  const save = async () => {
    setBusy(true);
    setErr("");
    try {
      const r = await saveDeskBooking({ enabled, hours, visits });
      if (r.ok) {
        router.refresh();
        onDone();
      } else setErr(r.error);
    } catch {
      setErr("Couldn't save. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`${s.sec} ${h.form}`} data-desk-booking-edit>
      <label className={s.switch} data-desk-booking-on>
        <input type="checkbox" checked={enabled} disabled={off} onChange={(e) => setEnabled(e.target.checked)} />
        <span>
          <b>{C.editOn}</b>
          <span className={s.note}>{C.editOnSub}</span>
        </span>
      </label>

      <div className={s.sec} data-desk-edit-hours>
        <div className={s.h}>{C.editHours}</div>
        <p className={s.note}>{C.editHoursSub}</p>
        <div className={h.list}>
          {WEEK.map(([i, name]) => {
            const d = hours[i];
            return (
              <div key={i} className={h.dayRow} data-day={i}>
                <span className={h.dayName}>{name}</span>
                <label className={h.dayOpen}>
                  <input type="checkbox" checked={!!d} disabled={off} onChange={(e) => setDay(i, e.target.checked ? (d ?? DEFAULT_DAY) : null)} aria-label={`${name} open`} />
                  <span>{d ? "Open" : C.editClosed}</span>
                </label>
                {d ? (
                  <span className={h.dayTimes}>
                    <input className={s.in} type="time" step={900} value={d.open} disabled={off} onChange={(e) => setDay(i, { ...d, open: e.target.value })} aria-label={`${name} from`} />
                    <span aria-hidden>–</span>
                    <input className={s.in} type="time" step={900} value={d.close} disabled={off} onChange={(e) => setDay(i, { ...d, close: e.target.value })} aria-label={`${name} to`} />
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <div className={s.sec} data-desk-edit-visits>
        <div className={s.h}>{C.editVisits}</div>
        <p className={s.note}>{C.editVisitsSub}</p>
        <div className={h.list}>
          {visits.map((v, i) => (
            <div key={i} className={h.grid} data-visit-row={i}>
              <label className={h.fld}>
                <span className={h.lbl}>{C.editName}</span>
                <input className={s.in} value={v.label} maxLength={80} disabled={off} onChange={(e) => setVisit(i, { label: e.target.value })} data-visit-name />
              </label>
              <label className={h.fld}>
                <span className={h.lbl}>{C.editLength}</span>
                <select className={s.sel} value={v.minutes} disabled={off} onChange={(e) => setVisit(i, { minutes: Number(e.target.value) })} data-visit-length>
                  {LENGTHS.some(([m]) => m === v.minutes) ? null : <option value={v.minutes}>{v.minutes} min</option>}
                  {LENGTHS.map(([m, w]) => (
                    <option key={m} value={m}>
                      {w}
                    </option>
                  ))}
                </select>
              </label>
              <label className={h.fld}>
                <span className={h.lbl}>{C.editPrice}</span>
                <input className={s.in} value={v.priceText} maxLength={80} placeholder={C.editPricePh} disabled={off} onChange={(e) => setVisit(i, { priceText: e.target.value })} data-visit-price />
              </label>
              {visits.length > 1 ? (
                <span className={h.fldAct}>
                  <button type="button" className={s.btn} disabled={off} onClick={() => setVisits((vs) => vs.filter((_, k) => k !== i))} aria-label={`${C.editRemove} ${v.label}`}>
                    {C.editRemove}
                  </button>
                </span>
              ) : null}
            </div>
          ))}
        </div>
        {visits.length < 12 ? (
          <div className={s.acts}>
            <button type="button" className={s.btn} disabled={off} onClick={() => setVisits((vs) => [...vs, { key: "", label: "", minutes: 60, priceText: "" }])} data-visit-add>
              {C.editAdd}
            </button>
          </div>
        ) : null}
      </div>

      {err ? (
        <p className={`${s.note} ${s.noteErr}`} role="alert">
          {err}
        </p>
      ) : null}
      <div className={s.acts}>
        <button type="button" className={`${s.btn} ${s.btnPrimary}`} disabled={off} onClick={() => void save()} data-desk-booking-save>
          {busy ? C.editSaving : C.editSave}
        </button>
        <button type="button" className={s.btn} disabled={busy} onClick={onDone}>
          {C.editCancel}
        </button>
      </div>
    </div>
  );
}
