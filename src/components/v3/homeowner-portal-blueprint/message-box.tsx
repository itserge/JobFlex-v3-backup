"use client";

// A NOTE TO THE CONTRACTOR, in Blueprint (2026-10-30). Same action as before
// (actions/homePortal sendHomeMessage): emailed to the shop with the
// homeowner as reply-to, kept on the project. The box is always open on the
// project page — writing a note is the reason to be in this card.

import * as React from "react";
import { useRouter } from "next/navigation";
import { sendHomeMessage } from "@/actions/homePortal";
import type { HomeMessageView } from "@/lib/home/portal";
import { LocalTime } from "@/components/portal/live-time";
import s from "./portal.module.css";

export function MessageBox({ homeKey, token, orgName, sent, timeZone }: { homeKey: string; token: string; orgName: string; sent: HomeMessageView[]; timeZone: string }) {
  const router = useRouter();
  const [body, setBody] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState<{ ok: boolean; text: string } | null>(null);

  async function send() {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const r = await sendHomeMessage({ key: homeKey, token, body });
      setNote({ ok: r.ok, text: r.ok ? r.note : r.error });
      if (r.ok) {
        setBody("");
        router.refresh();
      }
    } catch {
      setNote({ ok: false, text: "That didn't send — check the connection and try again. Your note is still here." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={s.stack} style={{ gap: 12 }}>
      <form
        className={s.form}
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <label className={s.field}>
          <span>To {orgName}</span>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={1500} placeholder="A question, a day that works, something you forgot to mention…" required name="message-body" />
        </label>
        <p className={s.fine}>We email it to {orgName.replace(/\.$/, "")}. They answer to your email.</p>
        <div className={s.actions}>
          <button type="submit" className={s.btnPrimary} disabled={busy || body.trim().length < 2}>{busy ? "Sending…" : "Send note"}</button>
        </div>
        {note && <p className={note.ok ? s.ok : s.err} role={note.ok ? "status" : "alert"}>{note.text}</p>}
      </form>
      {sent.length > 0 && (
        <ul className={s.sent} aria-label={`Your notes to ${orgName}`}>
          {sent.slice(0, 5).map((m) => (
            <li key={m.id}>
              <span className={s.muted}><LocalTime iso={m.at} tz={timeZone} />{m.emailed ? ` · emailed to ${orgName}` : " · saved on their side"}</span>
              <p>{m.body}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
