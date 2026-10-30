"use client";

// /home — "Lost the link?", in Blueprint (2026-10-30). Same action as before
// (actions/homePortal emailHomeLink): the link goes to the email, never on
// screen, and the answer is the same whether or not a home exists for it.

import * as React from "react";
import { emailHomeLink } from "@/actions/homePortal";
import s from "./portal.module.css";

export function FindHome() {
  const [email, setEmail] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState<{ ok: boolean; text: string } | null>(null);

  async function send() {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const r = await emailHomeLink(email);
      setNote({ ok: r.ok, text: r.ok ? r.note : r.error });
    } catch {
      setNote({ ok: false, text: "That doesn't look like an email address — check it and try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className={s.form}
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <label className={s.field}>
        <span>Your email</span>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" inputMode="email" required name="home-email" />
      </label>
      <div className={s.actions}>
        <button type="submit" className={`${s.btnPrimary} ${s.btnWide}`} disabled={busy || !email.includes("@")}>{busy ? "Sending…" : "Email me the link"}</button>
      </div>
      {note && <p className={note.ok ? s.ok : s.err} role={note.ok ? "status" : "alert"}>{note.text}</p>}
    </form>
  );
}
