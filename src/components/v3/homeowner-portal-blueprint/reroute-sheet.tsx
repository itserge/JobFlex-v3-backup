"use client";

// "Ask for a different contractor", in Blueprint (2026-10-30) — the same ask
// as the request page's (actions/homeownerPortal requestAnotherContractor,
// which re-checks the match), drawn as a bottom sheet on a phone and a
// centred box on a desk. The reason is optional and skippable.

import * as React from "react";
import { useRouter } from "next/navigation";
import { requestAnotherContractor } from "@/actions/homeownerPortal";
import { lockScroll } from "@/lib/scrollLock";
import s from "./portal.module.css";

const REASONS = ["Never heard from them", "Couldn't agree on price", "Scheduling didn't work out"];

export function RerouteSheet({ token, orgName, accepted }: { token: string; orgName: string; accepted: boolean }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState<string | null>(null);
  const [other, setOther] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<string | null>(null);
  const firstRef = React.useRef<HTMLInputElement | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);

  const close = React.useCallback(() => {
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  React.useEffect(() => {
    if (!open) return;
    firstRef.current?.focus();
    const unlock = lockScroll();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) close();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      unlock();
      window.removeEventListener("keydown", onKey);
    };
  }, [open, busy, close]);

  async function submit(withReason: string | null) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await requestAnotherContractor({ token, reason: withReason ?? undefined });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
      setDone("Done — we're finding you a different contractor now. This page updates when one takes your project.");
      router.refresh();
    } catch {
      setError("That didn't go through — check the connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) return <p className={s.ok} role="status">{done}</p>;

  return (
    <>
      <button ref={triggerRef} type="button" className={s.btn} onClick={() => setOpen(true)} disabled={busy}>
        Ask for a different contractor
      </button>
      {error && !open && <p className={s.err} role="alert">{error}</p>}

      {open && (
        <div className={s.scrim} onClick={() => !busy && close()}>
          <div className={s.sheet} role="dialog" aria-modal="true" aria-labelledby="reroute-title" onClick={(e) => e.stopPropagation()}>
            <div className={s.sheetHead}>
              <h2 id="reroute-title" className={s.h2}>Ask for a different contractor?</h2>
              <p className={s.text}>
                {accepted
                  ? `You approved ${orgName}'s quote — if you're cancelling it, tell them directly too. We'll let them know and find another local contractor for your project.`
                  : `We'll let ${orgName} know and find another local contractor. Your project and its details carry over.`}
              </p>
            </div>
            <div className={s.sheetBody}>
              <p className={s.kicker} style={{ marginBottom: 8 }}>What went wrong? (optional)</p>
              <div role="radiogroup" aria-label="What went wrong">
                {REASONS.map((r, i) => (
                  <label key={r} className={s.radio}>
                    <input ref={i === 0 ? firstRef : undefined} type="radio" name="reroute-reason" checked={reason === r} onChange={() => setReason(r)} />
                    <span>{r}</span>
                  </label>
                ))}
                <label className={s.radio}>
                  <input type="radio" name="reroute-reason" checked={reason === "__other"} onChange={() => setReason("__other")} />
                  <span>Something else</span>
                </label>
              </div>
              {reason === "__other" && (
                <label className={s.field} style={{ marginTop: 10 }}>
                  <span>In a sentence</span>
                  <textarea value={other} onChange={(e) => setOther(e.target.value)} maxLength={500} rows={2} />
                </label>
              )}
              {error && <p className={s.err} role="alert" style={{ marginTop: 10 }}>{error}</p>}
            </div>
            <div className={s.sheetFoot}>
              <button type="button" className={`${s.btnPrimary} ${s.btnWide}`} disabled={busy} onClick={() => void submit(reason === "__other" ? other.trim() || null : reason)}>
                {busy ? "Sending…" : "Find a different contractor"}
              </button>
              <div className={s.actions} style={{ justifyContent: "space-between" }}>
                <button type="button" className={s.btnText} disabled={busy} onClick={() => void submit(null)}>Skip the reason</button>
                <button type="button" className={s.btnText} disabled={busy} onClick={close}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
