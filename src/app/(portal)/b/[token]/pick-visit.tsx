"use client";

// SMARTBOOK · THE CUSTOMER'S PAGE, the part that answers taps (2026-10-31). A time is picked first and booked with
// a second, plain tap ("Book this time") — nothing books on opening a link. Styled by ../../book/book-public.css
// (`jfb-*` under `.jf-book`); the calendar and the time buttons are the booking page's own (book-wizard).

import { useEffect, useRef, useState, useTransition } from "react";
import { smartBookPick, smartBookPropose, smartBookTextMe, smartBookTimes } from "@/actions/smartBook";
import type { PickDay, PickView } from "@/lib/smartbook/engine";
import { DayPicker, SlotGroups } from "../../book/[slug]/book-wizard";

type Slot = { iso: string; label: string };
type Part = "morning" | "afternoon" | "evening";

/** "Tue Nov 3, 10am–12pm" → ["Tue Nov 3", "10am–12pm"] */
const split = (label: string): [string, string] => {
  const i = label.indexOf(", ");
  return i < 0 ? [label, ""] : [label.slice(0, i), label.slice(i + 2)];
};

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const inDays = (n: number) => {
  const d = new Date(Date.now() + n * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function PickVisit({ token, initial, preselect }: { token: string; initial: PickView; preselect: string | null }) {
  const [view, setView] = useState<PickView>(initial);
  const first = preselect ? (initial.offers.find((o) => o.iso === preselect) ?? (initial.counter?.iso === preselect ? initial.counter : null)) : null;
  const [picked, setPicked] = useState<Slot | null>(first);
  const [stale] = useState(!!preselect && !first && (initial.status === "offered" || initial.status === "asked"));
  const [days, setDays] = useState<PickDay[] | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [mode, setMode] = useState<"list" | "suggest">("list");
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [pending, start] = useTransition();
  const confirmRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (picked) confirmRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest" });
  }, [picked]);
  // The email's "Prefer texts?" lands on #texts.
  useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash === "#texts") document.getElementById("texts")?.scrollIntoView({ block: "center" });
  }, []);

  const after = (r: { ok: true; view: PickView } | { ok: false; error: string; view?: PickView }, done?: string) => {
    if (r.view) setView(r.view);
    if (r.ok) {
      setPicked(null);
      setDays(null);
      setMode("list");
      setMsg(done ? { text: done } : null);
    } else setMsg({ text: r.error, bad: true });
  };
  const book = (s: Slot) => start(async () => after(await smartBookPick(token, s.iso)));
  const loadTimes = () =>
    start(async () => {
      const r = await smartBookTimes(token);
      if (r.ok) {
        setDays(r.days);
        setDay(r.days[0]?.day ?? null);
        if (!r.days.length) setMsg({ text: "Nothing else is open online right now — suggest a time below and we'll check.", bad: true });
      } else setMsg({ text: r.error, bad: true });
    });

  const hear = view.channel === "text" ? "text you" : "email you";

  if (view.status === "closed") {
    return <p className="jfb-state">This link is closed. Please call {view.company}{view.phone ? ` at ${view.phone}` : ""}.</p>;
  }

  if (view.status === "booked" && view.booked) {
    return (
      <div className="jfb-receipt" data-pick-booked>
        <div className="jfb-receipt-mark" aria-hidden="true">✓</div>
        <div className="jfb-kicker">You&apos;re booked</div>
        <div className="jfb-receipt-when">{view.booked.when}</div>
        <p className="jfb-receipt-p">{view.company} will see you then. We&apos;ll {hear} if anything changes.</p>
        {view.booked.manage && (
          <div className="jfb-acts">
            <a className="jfb-btn" href={view.booked.manage}>Change or cancel</a>
          </div>
        )}
        {msg && !msg.bad && <p className="jfb-msg" role="status">{msg.text}</p>}
      </div>
    );
  }

  const confirm = picked && (
    <div className="jfb-when jfb-confirm" ref={confirmRef} data-pick-confirm>
      <span className="jfb-pick-k">Your time</span>
      <strong>{picked.label}</strong>
      <div className="jfb-acts">
        <button type="button" className="jfb-btn jfb-btn--primary" onClick={() => book(picked)} disabled={pending} data-pick-book>
          {pending ? "Booking…" : "Book this time"}
        </button>
        <button type="button" className="jfb-linkbtn" onClick={() => setPicked(null)} disabled={pending}>Pick another</button>
      </div>
    </div>
  );

  const offerList = view.offers.length > 0 && (
    <div className="jfb-offers" role="group" aria-label="Times we can come" data-pick-offers>
      {view.offers.map((o, i) => {
        const [d, t] = split(o.label);
        const on = picked?.iso === o.iso;
        return (
          <button key={o.iso} type="button" className={`jfb-offer${on ? " is-on" : ""}`} aria-pressed={on} onClick={() => setPicked(o)} disabled={pending} data-pick-offer={i + 1}>
            <span className="jfb-offer-n" aria-hidden="true">{i + 1}</span>
            <span className="jfb-offer-t">
              <b>{d}</b>
              <span>{t}</span>
            </span>
            <span className="jfb-offer-go">{on ? "Picked" : "Pick"}</span>
          </button>
        );
      })}
    </div>
  );

  const others = (
    <div className="jfb-more">
      {!days ? (
        <button type="button" className="jfb-btn" onClick={loadTimes} disabled={pending} data-pick-more>
          {view.offers.length ? "See other times" : "See open times"}
        </button>
      ) : (
        <div className="jfb-move">
          <DayPicker days={days} day={day} onDay={setDay} />
          <SlotGroups
            slots={days.find((d) => d.day === day)?.slots ?? []}
            onSlot={(s) => {
              const d = days.find((x) => x.day === day);
              const date = d ? new Date(`${d.day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).replace(/,/g, "") : "";
              setPicked({ iso: s.iso, label: `${date}, ${s.label}` });
            }}
            disabled={pending}
            attr="pick"
          />
        </div>
      )}
      <button type="button" className="jfb-linkbtn" onClick={() => { setMode("suggest"); setPicked(null); }} data-pick-suggest>
        None of these work? Suggest a time
      </button>
    </div>
  );

  return (
    <div className="jfb-pick" data-pick-status={view.status}>
      {msg && <p className={msg.bad ? "jfb-err jfb-err--top" : "jfb-msg"} role="status">{msg.text}</p>}
      {stale && !msg && <p className="jfb-msg" role="status">That time isn&apos;t open any more — here are the times we can do.</p>}

      {view.status === "asked" && view.asked && (
        <div className="jfb-when" data-pick-asked>
          <span className="jfb-pick-k">Waiting on {view.company}</span>
          <strong>{view.asked}</strong>
          <span className="jfb-when-sub">We&apos;re checking that time with the team and will {hear} shortly.</span>
        </div>
      )}

      {view.status === "countered" && view.counter && (
        <div className="jfb-when" data-pick-counter>
          <span className="jfb-pick-k">{view.company} can come</span>
          <strong>{view.counter.label}</strong>
          <div className="jfb-acts">
            <button type="button" className="jfb-btn jfb-btn--primary" onClick={() => book(view.counter!)} disabled={pending} data-pick-yes>
              {pending ? "Booking…" : "Yes, book it"}
            </button>
            <button type="button" className="jfb-linkbtn" onClick={() => setMode("suggest")} disabled={pending}>Suggest another time</button>
          </div>
        </div>
      )}

      {mode === "suggest" ? (
        <Suggest token={token} company={view.company} pending={pending} start={start} onDone={(r) => after(r)} onBack={() => setMode("list")} />
      ) : (
        view.status !== "countered" && (
          <>
            <h2 className="jfb-h2 jfb-h2--gap">{view.status === "asked" ? "Or book an open time now" : "Times we can come"}</h2>
            {offerList}
            {confirm}
            {others}
          </>
        )
      )}

      {view.texts === "can" && <TextsBox token={token} company={view.company} phone={view.phoneShown} pending={pending} start={start} onDone={(r) => after(r, "Texts are on — we'll text you about this visit.")} />}
    </div>
  );
}

function Suggest({ token, company, pending, start, onDone, onBack }: { token: string; company: string; pending: boolean; start: (fn: () => Promise<void>) => void; onDone: (r: Awaited<ReturnType<typeof smartBookPropose>>) => void; onBack: () => void }) {
  const [day, setDay] = useState("");
  const [time, setTime] = useState("");
  const [part, setPart] = useState<Part | null>(null);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const send = () => {
    if (!day) return setErr("Pick a day.");
    setErr("");
    start(async () => onDone(await smartBookPropose(token, { day, time: time || null, part: time ? null : part, note })));
  };
  return (
    <form className="jfb-form jfb-suggest" onSubmit={(e) => { e.preventDefault(); send(); }} data-pick-suggest-form>
      <h2 className="jfb-h2 jfb-h2--gap">Suggest a time</h2>
      <p className="jfb-hint">Tell us when suits you — we&apos;ll check with {company} and get back to you shortly.</p>
      <div className="jfb-two">
        <label className="jfb-fld">
          <span className="jfb-lbl">Day</span>
          <input className="jfb-in" type="date" value={day} min={today()} max={inDays(90)} onChange={(e) => setDay(e.target.value)} required data-pick-day />
        </label>
        <label className="jfb-fld">
          <span className="jfb-lbl">Time <small className="jfb-opt-note">(if you have one)</small></span>
          <input className="jfb-in" type="time" step={900} value={time} onChange={(e) => setTime(e.target.value)} data-pick-time />
        </label>
      </div>
      {!time && (
        <div className="jfb-fld">
          <span className="jfb-lbl">Or a part of the day</span>
          <div className="jfb-opts" role="radiogroup" aria-label="Part of the day">
            {(["morning", "afternoon", "evening"] as Part[]).map((p) => (
              <button key={p} type="button" role="radio" aria-checked={part === p} className={`jfb-opt${part === p ? " is-on" : ""}`} onClick={() => setPart(part === p ? null : p)}>
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </button>
            ))}
          </div>
        </div>
      )}
      <label className="jfb-fld">
        <span className="jfb-lbl">Anything we should know? <small className="jfb-opt-note">(optional)</small></span>
        <textarea className="jfb-in jfb-ta" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="Gate code, best number, what's going on…" />
      </label>
      {err && <p className="jfb-err">{err}</p>}
      <div className="jfb-acts">
        <button type="submit" className="jfb-btn jfb-btn--primary" disabled={pending} data-pick-send>{pending ? "Sending…" : `Send to ${company}`}</button>
        <button type="button" className="jfb-btn" onClick={onBack} disabled={pending}>Back</button>
      </div>
    </form>
  );
}

function TextsBox({ token, company, phone, pending, start, onDone }: { token: string; company: string; phone: string | null; pending: boolean; start: (fn: () => Promise<void>) => void; onDone: (r: Awaited<ReturnType<typeof smartBookTextMe>>) => void }) {
  const [ok, setOk] = useState(false);
  return (
    <div className="jfb-texts" id="texts" data-pick-texts>
      <h2 className="jfb-h2">Prefer texts?</h2>
      <label className="jfb-consent">
        <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} data-pick-texts-ok />
        <span>
          <b>Text me about this visit.</b> {company} may text me{phone ? ` at ${phone}` : ""} about my visit and estimate. Message and data rates may apply. Reply STOP to opt out.
        </span>
      </label>
      <div className="jfb-acts">
        <button type="button" className="jfb-btn" disabled={!ok || pending} onClick={() => start(async () => onDone(await smartBookTextMe(token)))} data-pick-texts-on>
          Turn on texts
        </button>
      </div>
    </div>
  );
}
