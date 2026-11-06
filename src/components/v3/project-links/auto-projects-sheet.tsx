"use client";

// AUTOMATIC PROJECTS (the owner's default, 2026-11-05: "by trade — deck, roof and remodel make a project; a
// service call stays a job — a switch, and a 'Make it a project' button on any job"). The switch and its trades,
// opened from the Projects page's head on the desk and the handheld list alike; read and saved by
// actions/projectStages (estimators and managers), kept on Organization.projectSettingsJson.

import { useEffect, useState } from "react";
import { readProjectSettings, saveProjectSettings } from "@/actions/projectStages";
import { BlueprintSheet } from "@/components/ui/BlueprintSheet";
import s from "./project-hub.module.css";

type State = { auto: boolean; trades: string[]; allTrades: readonly string[]; defaults: readonly string[] };

export function AutoProjectsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // The settings are read when the sheet opens (the read's own callbacks set the state, not the effect).
  useEffect(() => {
    if (!open) return;
    let live = true;
    readProjectSettings()
      .then((r) => live && setState({ auto: r.auto, trades: [...r.trades], allTrades: r.allTrades, defaults: r.defaults }))
      .catch((e) => live && setErr(e instanceof Error ? e.message : "Could not read the settings"));
    return () => {
      live = false;
    };
  }, [open]);

  const toggle = (t: string) =>
    setState((cur) => (cur ? { ...cur, trades: cur.trades.includes(t) ? cur.trades.filter((x) => x !== t) : [...cur.trades, t] } : cur));

  async function save() {
    if (!state) return;
    setBusy(true);
    setErr(null);
    try {
      await saveProjectSettings({ auto: state.auto, trades: state.trades });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <BlueprintSheet
      open={open}
      onClose={() => !busy && onClose()}
      title="Automatic projects"
      description="When a proposal is sold, JobFlex makes a project for it — numbered, with the stages for the trade — and files the proposal and its job in it. A service call stays a job; any job can still become a project from its page."
      footer={
        <>
          <button type="button" className="bps-btn bps-btn--ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="bps-btn bps-btn--primary" onClick={() => void save()} disabled={busy || !state} data-auto-projects-save>
            {busy ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      {state ? (
        <div className="bps-form">
          <label className={`bps-fld bps-fld--wide ${s.check}`}>
            <input type="checkbox" checked={state.auto} onChange={(e) => setState({ ...state, auto: e.target.checked })} data-auto-projects-on />
            <span className="bps-lbl" style={{ margin: 0 }}>
              Make a project when a proposal is sold
            </span>
          </label>
          <div className="bps-fld bps-fld--wide">
            <span className="bps-lbl">For these trades</span>
            <div className="bps-plate">
              {state.allTrades.map((t) => (
                <label key={t} className={`${s.check} ${s.pick}`}>
                  <input type="checkbox" checked={state.trades.includes(t)} disabled={!state.auto} onChange={() => toggle(t)} />
                  <span className={s.pickName}>{t}</span>
                  <span className={s.pickMeta}>{state.defaults.includes(t) ? "usual" : "service call"}</span>
                </label>
              ))}
            </div>
            <button type="button" className="bps-btn bps-btn--ghost" style={{ marginTop: 8 }} onClick={() => setState({ ...state, trades: [...state.defaults] })} disabled={!state.auto}>
              Back to the usual trades
            </button>
          </div>
          <p className="bps-hint bps-fld--wide">
            The trade is the estimator that priced it (roof, fence, HVAC), else the proposal&apos;s own words (deck, kitchen, bath…), else your company&apos;s first trade.
          </p>
          {err ? <div className="bps-err bps-fld--wide">{err}</div> : null}
        </div>
      ) : err ? (
        <div className="bps-err">{err}</div>
      ) : (
        <p className="bps-hint">Loading…</p>
      )}
    </BlueprintSheet>
  );
}
