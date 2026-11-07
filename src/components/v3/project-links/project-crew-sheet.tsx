"use client";

// SCHEDULE & CREW (owner, 2026-11-04: "have access from projects to send the crew who's gonna be doing this and this
// in this project. And put it on a schedule"). One sheet from a job row on the project page, desktop and handheld:
// the job's first and last day, the hours each day, the work week, and who is on it. Each work day goes on the calendar
// as its own visit (actions/projectHub scheduleProjectJob) — the calendar draws a visit on its own day, so a two-week
// remodel shows on every day it is worked — then each new worker is asked as the job page does. Double-booking
// (the timeline build, 2026-11-06): as the days and the crew change, the sheet asks who is already somewhere else
// on those days (actions/projectTimeline crewAlreadyBooked) and says so under their name before the save.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { scheduleProjectJob } from "@/actions/projectHub";
import { crewAlreadyBooked } from "@/actions/projectTimeline";
import { BlueprintSheet } from "@/components/ui/BlueprintSheet";
import type { PdJob, PdWorker } from "@/components/v3/project-detail-blueprint/project-detail-data";
import s from "./project-hub.module.css";

const pad = (n: number) => String(n).padStart(2, "0");
const dayOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeOf = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const ANSWER: Record<string, string> = { PENDING: "asked", ACCEPTED: "confirmed", DECLINED: "declined" };

type Week = "mon-fri" | "mon-sat" | "every";
const WEEKS: Array<[Week, string]> = [
  ["mon-fri", "Mon–Fri"],
  ["mon-sat", "Mon–Sat"],
  ["every", "Every day"],
];

/** The work days between two dates, each from `from` to `to` o'clock, in this browser's own time zone. */
function workDays(sd: string, ed: string, from: string, to: string, week: Week): Array<{ startsAt: string; endsAt: string }> {
  const out: Array<{ startsAt: string; endsAt: string }> = [];
  const d = new Date(`${sd}T00:00`);
  const last = new Date(`${ed}T00:00`);
  if (Number.isNaN(d.getTime()) || Number.isNaN(last.getTime())) return out;
  while (d.getTime() <= last.getTime() && out.length <= 120) {
    const dow = d.getDay();
    if (week === "every" || (week === "mon-sat" ? dow !== 0 : dow !== 0 && dow !== 6)) {
      const day = dayOf(d);
      out.push({ startsAt: new Date(`${day}T${from}`).toISOString(), endsAt: new Date(`${day}T${to}`).toISOString() });
    }
    d.setDate(d.getDate() + 1);
  }
  return out;
}

export function ProjectCrewSheet({ job, roster, onClose }: { job: PdJob | null; roster: PdWorker[]; onClose: () => void }) {
  // The page mounts a fresh sheet per job (a key), so the fields start from that job.
  const router = useRouter();
  const start = job?.startsAt ?? (() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(8, 0, 0, 0);
    return d;
  })();
  const end = job?.endsAt ?? (() => {
    const d = new Date(start);
    d.setHours(16, 0, 0, 0);
    return d;
  })();
  const [sd, setSd] = useState(dayOf(start));
  // A job dated by day only (midnight to midnight) opens on a working day's hours.
  const [st, setSt] = useState(timeOf(start) === "00:00" ? "08:00" : timeOf(start));
  const [ed, setEd] = useState(dayOf(end));
  const [et, setEt] = useState(timeOf(end) <= (timeOf(start) === "00:00" ? "08:00" : timeOf(start)) ? "16:00" : timeOf(end));
  const [week, setWeek] = useState<Week>(() => {
    // A job someone already put on a Saturday or a Sunday keeps its week.
    const dows = [start, end].map((d) => d.getDay());
    return dows.includes(0) ? "every" : dows.includes(6) ? "mon-sat" : "mon-fri";
  });
  const [crew, setCrew] = useState<Set<string>>(new Set((job?.crew ?? []).map((c) => c.workerId)));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const answers = new Map((job?.crew ?? []).map((c) => [c.workerId, c.status]));

  const days = workDays(sd, ed, st || "08:00", et || "16:00", week);

  // Who is already booked on these days — asked a beat after the last change, kept by the question it answers.
  const crewKey = [...crew].sort().join(",");
  const askKey = job && crew.size && days.length ? `${job.id}|${sd}|${ed}|${st}|${et}|${week}|${crewKey}` : "";
  const [booked, setBooked] = useState<{ key: string; byWorker: Record<string, string[]>; words: string[] } | null>(null);
  useEffect(() => {
    if (!askKey || !job) return;
    const t = setTimeout(() => {
      crewAlreadyBooked({ jobId: job.id, days: workDays(sd, ed, st || "08:00", et || "16:00", week), workerIds: crewKey.split(",") })
        .then((r) => {
          const byWorker: Record<string, string[]> = {};
          for (const row of r.rows) (byWorker[row.workerId] ??= []).push(row.day);
          setBooked({ key: askKey, byWorker, words: r.words });
        })
        .catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [askKey, job, sd, ed, st, et, week, crewKey]);
  const busyNow = booked && booked.key === askKey ? booked : null;
  const dayShort = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

  async function save() {
    if (!job) return;
    if (ed < sd) return setErr("The job ends before it starts");
    if ((et || "16:00") <= (st || "08:00")) return setErr("The day ends before it starts");
    if (!days.length) return setErr("No work days between those dates — pick another week");
    if (days.length > 120) return setErr("That is more than 120 work days — schedule it in parts");
    setBusy(true);
    setErr(null);
    try {
      const r = await scheduleProjectJob({ jobId: job.id, days, workerIds: [...crew] });
      if (r.kept.length || r.others) {
        setErr(
          [
            r.kept.length ? `${r.kept.join(", ")} stayed on — they have pay on this job. Settle it on the job page's Crew tab first.` : "",
            r.others ? `${r.others} other visit${r.others === 1 ? "" : "s"} someone put on the calendar for this job stay as they are.` : "",
          ]
            .filter(Boolean)
            .join(" "),
        );
        setBusy(false);
        router.refresh();
        return;
      }
      onClose();
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not schedule the job");
      setBusy(false);
    }
  }

  return (
    <BlueprintSheet
      open={job !== null}
      onClose={() => !busy && onClose()}
      title="Schedule & crew"
      description={job ? job.title : undefined}
      footer={
        <>
          <button type="button" className="bps-btn bps-btn--ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="bps-btn bps-btn--primary" onClick={save} disabled={busy} data-crew-save>
            {busy ? "Saving…" : busyNow?.words.length ? "Schedule anyway" : crew.size ? `Schedule · ${crew.size} on the crew` : "Schedule"}
          </button>
        </>
      }
    >
      <div className="bps-form">
        <label className="bps-fld">
          <span className="bps-lbl">First day</span>
          <input
            className="bps-in"
            type="date"
            value={sd}
            onChange={(e) => {
              setSd(e.target.value);
              if (ed < e.target.value) setEd(e.target.value);
            }}
          />
        </label>
        <label className="bps-fld">
          <span className="bps-lbl">Last day</span>
          <input className="bps-in" type="date" value={ed} min={sd} onChange={(e) => setEd(e.target.value)} />
        </label>
        <label className="bps-fld">
          <span className="bps-lbl">Each day from</span>
          <input className="bps-in" type="time" value={st} onChange={(e) => setSt(e.target.value)} />
        </label>
        <label className="bps-fld">
          <span className="bps-lbl">To</span>
          <input className="bps-in" type="time" value={et} onChange={(e) => setEt(e.target.value)} />
        </label>
        <div className="bps-fld bps-fld--wide">
          <span className="bps-lbl">Work days</span>
          <div className="bps-seg">
            {WEEKS.map(([v, l]) => (
              <button key={v} type="button" className={week === v ? "is-on" : ""} onClick={() => setWeek(v)}>
                {l}
              </button>
            ))}
          </div>
          <span className="bps-hint">
            {days.length ? `${days.length} work day${days.length === 1 ? "" : "s"} on the calendar, one visit each` : "No work days in that range"}
          </span>
        </div>
        <div className="bps-fld bps-fld--wide">
          <span className="bps-lbl">Crew</span>
          {roster.length ? (
            <div className="bps-plate">
              {roster.map((w) => (
                <label key={w.id} className={`${s.check} ${s.pick}`}>
                  <input
                    type="checkbox"
                    checked={crew.has(w.id)}
                    onChange={(e) =>
                      setCrew((cur) => {
                        const next = new Set(cur);
                        if (e.target.checked) next.add(w.id);
                        else next.delete(w.id);
                        return next;
                      })
                    }
                  />
                  <span className={s.pickName}>{w.name}</span>
                  <span className={s.pickMeta}>
                    {[w.trade, ANSWER[answers.get(w.id) ?? ""]].filter(Boolean).join(" · ")}
                    {busyNow?.byWorker[w.id]?.length ? (
                      <span style={{ display: "block", color: "var(--amber)" }} data-crew-busy>
                        busy {busyNow.byWorker[w.id].slice(0, 3).map(dayShort).join(", ")}
                        {busyNow.byWorker[w.id].length > 3 ? ` +${busyNow.byWorker[w.id].length - 3}` : ""}
                      </span>
                    ) : null}
                  </span>
                </label>
              ))}
            </div>
          ) : (
            <p className="bps-note">No crew on the team yet — add them on the Workers page.</p>
          )}
        </div>
        {busyNow?.words.length ? (
          <div className="bps-note bps-fld--wide" data-crew-busy-note>
            Already booked: {busyNow.words.join("; ")}. Schedule anyway, or pick someone else.
          </div>
        ) : null}
        <p className="bps-hint bps-fld--wide">Each new crew member is sent the job (email, and a text if they have texts on) and answers yes or no. The job goes on the calendar.</p>
        {err ? <div className="bps-err bps-fld--wide">{err}</div> : null}
      </div>
    </BlueprintSheet>
  );
}
