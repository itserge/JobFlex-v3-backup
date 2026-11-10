"use client";
// The client writes to the company from their page. Plain form; the page re-reads after a send so the message shows.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { postClientHomeMessage } from "./actions";

export function MessageBox({ token, company }: { token: string; company: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <form
      className="ch-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (busy || body.trim().length < 2) return;
        setBusy(true);
        setNote(null);
        void postClientHomeMessage(token, body)
          .then((r) => {
            if (r.ok) {
              setBody("");
              setNote({ ok: true, text: `Sent — ${company} will answer by email or text.` });
              router.refresh();
            } else setNote({ ok: false, text: r.error });
          })
          .catch(() => setNote({ ok: false, text: "That didn't go through — try again." }))
          .finally(() => setBusy(false));
      }}
      data-home-form
    >
      <label className="ch-lab" htmlFor="ch-msg">
        Write to {company}
      </label>
      <textarea id="ch-msg" className="ch-in" rows={3} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} placeholder="A question, a change, a good time to come…" data-home-text />
      <div className="ch-formRow">
        {note ? (
          <span className={note.ok ? "ch-ok" : "ch-bad"} role="status" data-home-note>
            {note.text}
          </span>
        ) : (
          <span />
        )}
        <button type="submit" className="ch-btn" disabled={busy || body.trim().length < 2} data-home-send>
          {busy ? "Sending…" : "Send"}
        </button>
      </div>
    </form>
  );
}
