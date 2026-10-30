"use client";

// PLAN AHEAD, in Blueprint (2026-10-30): "Planning something for later? Put
// it on the calendar" — what and which month, the reminder and a note behind
// "More options". Then the planned list: get quotes now, mark done, remove,
// change the reminder. Same actions as before (actions/homePortal addHomePlan
// / updateHomePlan); the server books the reminder email.

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { addHomePlan, updateHomePlan } from "@/actions/homePortal";
import type { HomePlanView } from "@/lib/home/portal";
import { REMIND_MODES, type RemindMode } from "@/lib/home/dates";
import s from "./portal.module.css";

const remindOn = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : null);
const IDEAS = ["Exterior paint", "New gutters", "Garage floor", "Fence repair", "AC tune-up", "Bathroom remodel"];

function nextMonths(n: number): Array<{ value: string; label: string }> {
  const out: Array<{ value: string; label: string }> = [];
  const d = new Date();
  d.setUTCDate(1);
  for (let i = 0; i < n; i++) {
    const v = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    out.push({ value: v, label: d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }) });
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out;
}

export function PlanAheadForm({ homeKey }: { homeKey: string }) {
  const router = useRouter();
  const months = React.useMemo(() => nextMonths(18), []);
  const [title, setTitle] = React.useState("");
  const [when, setWhen] = React.useState(months[1]?.value ?? months[0].value);
  const [notes, setNotes] = React.useState("");
  const [remind, setRemind] = React.useState<RemindMode>("start");
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState<{ ok: boolean; text: string } | null>(null);

  async function add() {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const r = await addHomePlan({ key: homeKey, title, when, notes: notes || undefined, remind });
      setNote({ ok: r.ok, text: r.ok ? r.note : r.error });
      if (r.ok) {
        setTitle("");
        setNotes("");
        router.refresh();
      }
    } catch {
      setNote({ ok: false, text: "That didn't save — check the connection and try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className={s.form}
      onSubmit={(e) => {
        e.preventDefault();
        void add();
      }}
      data-plan-form
    >
      <label className={s.field}>
        <span>What</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Repaint the bedrooms, a new deck…" maxLength={120} required name="plan-title" autoComplete="off" />
      </label>
      <div className={s.ideas} aria-label="Ideas">
        {IDEAS.map((x) => (
          <button key={x} type="button" className={s.idea} aria-pressed={title === x} onClick={() => setTitle(x)}>{x}</button>
        ))}
      </div>
      <label className={s.field}>
        <span>Month</span>
        <select value={when} onChange={(e) => setWhen(e.target.value)} name="plan-when">
          {months.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </label>
      <details className={s.more}>
        <summary>More options</summary>
        <div className={s.form}>
          <label className={s.field}>
            <span>Remind me</span>
            <select value={remind} onChange={(e) => setRemind(e.target.value as RemindMode)} name="plan-remind">
              {REMIND_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </label>
          <label className={s.field}>
            <span>Notes</span>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Budget in mind, colours, what you've seen…" maxLength={1000} name="plan-notes" autoComplete="off" />
          </label>
        </div>
      </details>
      <p className={s.fine}>
        {remind === "none" ? "No reminder — it stays on your calendar until you send it." : "We email you when the month comes, with one tap to get quotes."}
      </p>
      <div className={s.actions}>
        <button type="submit" className={s.btnPrimary} disabled={busy || title.trim().length < 2}>{busy ? "Saving…" : "Put it on the calendar"}</button>
      </div>
      {note && <p className={note.ok ? s.ok : s.err} role={note.ok ? "status" : "alert"}>{note.text}</p>}
    </form>
  );
}

export function PlannedList({ homeKey, plans, quotesHref, rangeHref }: { homeKey: string; plans: HomePlanView[]; quotesHref: Record<string, string>; rangeHref: Record<string, string> }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState<{ ok: boolean; text: string } | null>(null);

  async function change(id: string, patch: { status?: "DONE" | "DROPPED"; remind?: RemindMode }) {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const r = await updateHomePlan({ key: homeKey, id, ...patch });
      setNote({ ok: r.ok, text: r.ok ? r.note : r.error });
      if (r.ok) router.refresh();
    } catch {
      setNote({ ok: false, text: "That didn't save — check the connection and try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <ul className={s.rows}>
        {plans.map((p) => (
          <li key={p.id} className={s.row} data-plan>
            <div className={s.rowHead}>
              <p className={s.h3}>{p.title}</p>
              <span className={s.num} style={{ fontWeight: 600 }}>{p.when}</span>
            </div>
            {p.estimate && <p className={s.text}><b className={s.num}>{p.estimate.range}</b> · {p.estimate.material} · a range, not a quote</p>}
            {p.notes && !p.estimate && <p className={s.muted}>{p.notes}</p>}
            <label className={s.field}>
              <span className={s.muted} style={{ fontWeight: 500 }}>
                {p.remindAt ? `${p.reminded ? "Last nudge" : "Reminder"} by email ${remindOn(p.remindAt)}` : p.reminded ? "Reminded" : "No reminder"}
              </span>
              <select value={p.remindMode} disabled={busy} onChange={(e) => void change(p.id, { remind: e.target.value as RemindMode })} aria-label={`Remind me about ${p.title}`}>
                {REMIND_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </label>
            <div className={s.actions}>
              {rangeHref[p.id] ? (
                <a className={s.btnPrimary} href={rangeHref[p.id]}>Get quotes</a>
              ) : (
                <Link className={s.btnPrimary} href={quotesHref[p.id] as Route}>Get quotes now</Link>
              )}
              <button type="button" className={s.btnText} disabled={busy} onClick={() => void change(p.id, { status: "DONE" })}>Mark done</button>
              <button type="button" className={s.btnText} disabled={busy} onClick={() => void change(p.id, { status: "DROPPED" })}>Remove</button>
            </div>
          </li>
        ))}
      </ul>
      {note && <p className={note.ok ? s.ok : s.err} role={note.ok ? "status" : "alert"}>{note.text}</p>}
    </>
  );
}
