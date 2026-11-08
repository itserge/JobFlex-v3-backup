"use client";
// THE HOMEOWNER'S CHOICES (2026-11-08, the plan "Projects: Remodel and New construction", part 7): the one thing the
// homeowner writes from their page — what they chose for a selection, with the day it is needed by. One text box per
// choice, "Send my choice"; the office is told (actions/projectPortal portalChoose, token-only like the contractor's
// /q page). A chosen one shows what they picked, with Change until its stage is done. Styled by ./client.css.

import { useState } from "react";
import { portalChoose } from "@/actions/projectPortal";
import type { ClientSelection } from "@/lib/projectClient/server";

const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export function Choices({ token, selections }: { token: string; selections: ClientSelection[] }) {
  const [rows, setRows] = useState(selections);
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  function open(id: string, current: string | null) {
    setEditing(id);
    setText(current ?? "");
    setErr(null);
  }

  async function send(id: string) {
    const chosen = text.trim();
    if (!chosen) return setErr("Say what you chose — a few words is plenty.");
    setBusy(true);
    setErr(null);
    try {
      const r = await portalChoose(token, { selectionId: id, chosen });
      if (!r.ok) throw new Error(r.error);
      setRows((cur) => cur.map((x) => (x.id === id ? { ...x, chosen, chosenAt: new Date().toISOString(), dueWords: "" } : x)));
      setEditing(null);
      setSent(id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "That didn't send — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ul className="cl-list" data-client-choices>
      {rows.map((r) => {
        const tone = r.chosen ? "" : /past due/.test(r.dueWords) ? " is-late" : /soon/.test(r.dueWords) ? " is-soon" : "";
        return (
          <li key={r.id} className={`cl-choice${r.chosen ? " is-chosen" : ""}${tone}`} data-client-choice data-choice-state={r.chosen ? "chosen" : "open"}>
            <div className="cl-row">
              <b>{r.name}</b>
              <span>{r.chosen ? `chosen${r.chosenAt ? ` ${day(r.chosenAt)}` : ""}` : r.dueWords}</span>
            </div>
            {r.chosen && editing !== r.id ? (
              <p className="cl-choiceMeta" data-choice-chosen>
                <b>{r.chosen}</b>
                {sent === r.id ? " — sent to the office." : ""}
                {r.canChoose ? (
                  <>
                    {" "}
                    <button type="button" className="cl-link" onClick={() => open(r.id, r.chosen)} data-choice-change>
                      Change
                    </button>
                  </>
                ) : null}
              </p>
            ) : null}
            {!r.chosen && editing !== r.id ? (
              <>
                {r.allowance != null ? <p className="cl-choiceMeta">Allowance {money(r.allowance)}</p> : null}
                {r.canChoose ? (
                  <button type="button" className="cl-btnSm" onClick={() => open(r.id, null)} data-choice-open>
                    I&apos;ve chosen…
                  </button>
                ) : null}
              </>
            ) : null}
            {editing === r.id ? (
              <div className="cl-form" data-choice-form>
                <label className="cl-field">
                  <span className="cl-lab">What did you choose?</span>
                  <input value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder="Shaker, white — from the showroom on 5th" autoFocus data-choice-text />
                </label>
                {err ? <p className="cl-err">{err}</p> : null}
                <div className="cl-formActs">
                  <button type="button" className="cl-btn" onClick={() => void send(r.id)} disabled={busy || !text.trim()} data-choice-send>
                    {busy ? "Sending…" : "Send my choice"}
                  </button>
                  <button type="button" className="cl-link" onClick={() => setEditing(null)} disabled={busy}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
