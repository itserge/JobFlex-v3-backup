"use client";
// THE BUYER'S HALF of /buy/[token]: tick each line as it is bought, type what was paid, a note, Save. Styled by
// ../buy.css (root `.jf-buy`); the server page renders the frame. A closed order (delivered, canceled) reads only.

import { useState } from "react";
import { buyerSave } from "@/actions/projectBuying";
import type { BuyerView } from "@/lib/projectBuying/server";

export function BuyForm({ token, view }: { token: string; view: BuyerView }) {
  const [bought, setBought] = useState<Set<string>>(() => new Set(view.lines.filter((l) => l.bought).map((l) => l.id)));
  const [paid, setPaid] = useState(view.paidTotal != null ? String(view.paidTotal) : "");
  const [note, setNote] = useState(view.buyerNote ?? "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const readOnly = view.done;
  const total = view.lines.length;
  const got = view.lines.filter((l) => bought.has(l.id)).length;

  const toggle = (id: string) => {
    if (readOnly) return;
    setSaved(false);
    setBought((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const n = paid.trim() ? Number(paid.replace(/[^\d.]/g, "")) : null;
      if (n != null && !Number.isFinite(n)) throw new Error("Check the amount — numbers only.");
      const r = await buyerSave(token, { bought: [...bought], paidTotal: n, note: note.trim() || null });
      if (!r.ok) throw new Error(r.error);
      setSaved(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "That didn't save — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="by-card" data-buy-page>
      <div className="by-head">
        <p className="by-kicker">{view.company} · {view.project}</p>
        <h1 className="by-title">{view.buyerName ? `${view.buyerName}, please buy these` : "Please buy these"}</h1>
        <p className="by-sub">
          {view.needBy ? `Needed on site by ${new Date(`${view.needBy}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" })}. ` : ""}
          Tick each one as you buy it, then press Save. No sign-in needed.
        </p>
        {view.note ? <p className="by-note">{view.note}</p> : null}
      </div>

      <div className="by-lines" role="list">
        {view.lines.map((l) => (
          <label key={l.id} className={`by-line${bought.has(l.id) ? " is-on" : ""}`} role="listitem" data-buy-line>
            <input type="checkbox" checked={bought.has(l.id)} onChange={() => toggle(l.id)} disabled={readOnly} />
            <span className="by-line-name">
              {l.name}
              {l.store || l.productUrl ? (
                <span className="by-line-sub">
                  {l.store ? l.store : null}
                  {l.productUrl ? (
                    <>
                      {l.store ? " · " : ""}
                      <a href={l.productUrl} target="_blank" rel="noreferrer">
                        open the product
                      </a>
                    </>
                  ) : null}
                </span>
              ) : null}
            </span>
            <span className="by-line-qty">{l.qty}</span>
          </label>
        ))}
      </div>

      <p className="by-count">
        {got} of {total} bought
      </p>

      {readOnly ? (
        <p className="by-closed">This order is closed — the office has marked what arrived. Thank you.</p>
      ) : (
        <>
          <label className="by-field">
            <span className="by-lab">What you paid, all in ($)</span>
            <input inputMode="decimal" value={paid} onChange={(e) => { setPaid(e.target.value); setSaved(false); }} placeholder="0" data-buy-paid />
          </label>
          <label className="by-field">
            <span className="by-lab">A note for the office (optional)</span>
            <textarea value={note} onChange={(e) => { setNote(e.target.value); setSaved(false); }} rows={3} maxLength={1000} placeholder="The yard only had 10 of the joists — the rest come Thursday." />
          </label>
          {err ? <p className="by-err">{err}</p> : null}
          <button type="button" className="by-btn" onClick={() => void save()} disabled={busy} data-buy-save>
            {busy ? "Saving…" : saved ? "Saved — thank you" : "Save"}
          </button>
          <p className="by-foot">The office sees this on the project the moment you save. Keep the receipt.</p>
        </>
      )}
    </div>
  );
}
