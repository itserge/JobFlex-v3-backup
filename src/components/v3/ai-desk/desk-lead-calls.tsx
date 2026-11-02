"use client";
// CALL NEW LEADS (owner, 2026-10-31: "the AI desk will also contact those leads when needed"). A card under the
// setup checklist, the same frame as Minutes: one switch, how long a new lead waits for a person, and the rules the
// desk keeps — so the owner turns it on knowing exactly when it dials. The desk's own setup does the talking
// (lib/aiDesk/leadCalls): its greeting turned around, the trade's questions, the open times, booking.
import { useState } from "react";
import { PhoneOutgoing } from "lucide-react";
import { setDeskLeadCalls } from "@/actions/aiDesk";
import { LEAD_CALL_DELAYS } from "@/lib/aiDesk/shared";
import type { DeskSettingsData } from "@/components/v3/settings-blueprint/settings-data";
import s from "./ai-desk.module.css";

export function DeskLeadCalls({ desk }: { desk: DeskSettingsData }) {
  const lc = desk.leadCalls;
  const [on, setOn] = useState(lc.on);
  const [after, setAfter] = useState(lc.afterMinutes);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  // Off and not able to dial: the switch stays off and says what is missing.
  const blocked = !on && !lc.ready;

  async function save(nextOn: boolean, nextAfter: number) {
    if (busy) return;
    const prev = { on, after };
    setOn(nextOn);
    setAfter(nextAfter);
    setBusy(true);
    setNote(null);
    try {
      const r = await setDeskLeadCalls(nextOn, nextAfter);
      if (r.ok) setNote({ ok: true, text: r.note ?? "Saved." });
      else {
        setOn(prev.on);
        setAfter(prev.after);
        setNote({ ok: false, text: r.error });
      }
    } catch {
      setOn(prev.on);
      setAfter(prev.after);
      setNote({ ok: false, text: "Couldn't save. Check your connection and try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={s.panel} aria-labelledby="desk-lead-calls-t" id="desk-lead-calls" data-desk-lead-calls>
      <header className={s.panelHead}>
        <PhoneOutgoing size={18} strokeWidth={2.2} aria-hidden className={s.panelIcon} />
        <div className={s.panelTitles}>
          <h3 id="desk-lead-calls-t">Call new leads</h3>
          <p>When a new lead with a phone number hasn&rsquo;t been reached, the desk calls them once: it asks the questions from your setup and books a visit from your open times.</p>
        </div>
        <span className={s.chip} data-tone={on ? "done" : undefined}>
          {on ? "On" : "Off"}
        </span>
      </header>
      <div className={s.panelBody}>
        <div className={s.root}>
          <label className={s.switch} data-desk-lead-calls-switch>
            <input type="checkbox" checked={on} disabled={busy || !desk.canManage || blocked} onChange={(e) => void save(e.target.checked, after)} />
            <span>
              <b>Have the desk call new leads</b>
              <span className={s.note}>
                {blocked && lc.why ? lc.why : "One call a lead, from your desk's number. Every lead page also has a button to have the desk call."}
              </span>
            </span>
          </label>

          <div className={s.sec}>
            <label className={s.h} htmlFor="desk-lead-calls-after">
              Wait for a person first
            </label>
            <p className={s.note}>The desk calls only a lead nobody on the team has reached or booked by then.</p>
            <select id="desk-lead-calls-after" className={s.sel} value={after} disabled={busy || !desk.canManage} onChange={(e) => void save(on, Number(e.target.value))}>
              {LEAD_CALL_DELAYS.map((m) => (
                <option key={m} value={m}>
                  {m < 60 ? `${m} minutes` : "1 hour"}
                </option>
              ))}
            </select>
          </div>

          <div className={s.sec}>
            <span className={s.h}>What the desk keeps to</span>
            <ul className={s.rules}>
              <li>Calls 9 AM–7 PM your time, Monday to Saturday. A lead that comes in later is called the next morning.</li>
              <li>Says it&rsquo;s your virtual assistant and that the call is recorded, and asks for the person by name.</li>
              <li>Never calls a number that texted STOP, or anyone who asked not to be called again.</li>
              <li>No answer: a short voicemail with your number. A text follows only to people who agreed to your texts.</li>
            </ul>
            <p className={s.note}>Turn this on only if your lead forms tell people your assistant may call them about their request.</p>
          </div>

          <p className={`${s.note} ${note ? (note.ok ? s.noteOk : s.noteErr) : ""}`} role="status" aria-live="polite">
            {note?.text ?? ""}
          </p>
        </div>
      </div>
    </section>
  );
}
