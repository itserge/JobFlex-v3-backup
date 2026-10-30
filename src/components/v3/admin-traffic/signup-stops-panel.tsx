"use client";
/**
 * WHERE SIGN-UPS STOP (owner, 2026-10-14: "at which point they're leaving … and whether the problem is on our side,
 * so we need a smart approach to track where they stop and what's wrong"). Under the analyst: the week's or the
 * month's sign-up visits read as one verdict (of those who stopped — a fault of ours, refused by the form, or their
 * own choice), how far each screen gets them, the box they stop in, every problem with its side, and which phones
 * and browsers finish. Reads on mount, on the switch, and every ten minutes while the tab is open (lib/signup-dropoff).
 */
import { useCallback, useEffect, useState } from "react";
import { Info, RefreshCw, Route } from "lucide-react";
import { getSignupDropoff, type SignupDropoffResult } from "@/actions/trafficDashboard";
import { DROPOFF_DAYS, pctWords, secsWords, visitsWords, type DropoffDays, type DropoffReport } from "@/lib/signup-dropoff";
import { screenName } from "@/lib/signup-watch-shared";
import s from "./traffic.module.css";

const READ_EVERY_MS = 10 * 60_000;
const clock = (iso: string, timezone: string) => { try { return new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(new Date(iso)); } catch { return ""; } };
const bar = (n: number, of: number) => `${of > 0 ? Math.max(2, Math.round((n / of) * 100)) : 0}%`;

function Verdict({ r }: { r: DropoffReport }) {
  const v = r.verdict;
  const parts = [
    { key: "ours", label: "A fault of ours", n: v.ours },
    { key: "theirs", label: "Refused by the form", n: v.theirs },
    { key: "choice", label: "Left without an error", n: v.choice },
  ];
  return (
    <div className={s.stopsVerdict} data-tone={v.tone} data-testid="stops-verdict">
      <p><b>{v.headline}</b><span>{v.detail}</span></p>
      {v.counted > 0 && <>
        <div className={s.stopsSplit} aria-hidden="true">{parts.map((p) => p.n > 0 && <i key={p.key} data-part={p.key} style={{ flexGrow: p.n }}/>)}</div>
        <ul className={s.stopsSplitKey} aria-label={`Of ${v.counted} watched visits that stopped`}>
          {parts.map((p) => <li key={p.key} data-part={p.key} data-testid={`stops-${p.key}`}><i aria-hidden="true"/>{p.label} <b>{p.n}</b> <em>{pctWords(p.n, v.counted)}</em></li>)}
        </ul>
      </>}
    </div>
  );
}

export function SignupStopsPanel({ timezone }: { timezone: string }) {
  const [days, setDays] = useState<DropoffDays>(7);
  const [result, setResult] = useState<SignupDropoffResult | null>(null);
  const [kept, setKept] = useState<{ report: DropoffReport; readAt: string } | null>(null);
  const [pending, setPending] = useState(false);
  const load = useCallback(async (span: DropoffDays, force = false) => {
    setPending(true);
    try {
      const next = await getSignupDropoff({ days: span, force });
      setResult(next);
      // PostHog down with a reading on screen: the reading stays, dated.
      if (next.status === "ok") setKept({ report: next.report, readAt: next.readAt });
    } catch (err) {
      setResult({ status: "error", message: err instanceof Error ? err.message : "The report could not read." });
    } finally {
      setPending(false);
    }
  }, []);
  useEffect(() => {
    const first = window.setTimeout(() => void load(days), 0);
    const every = window.setInterval(() => { if (document.visibilityState === "visible") void load(days); }, READ_EVERY_MS);
    return () => { window.clearTimeout(first); window.clearInterval(every); };
  }, [load, days]);

  const r = kept?.report.days === days ? kept.report : null;
  const problem = result && result.status !== "ok" ? result.message : "";
  return (
    <section className={`${s.card} ${s.stops}`} id="signup-stops" aria-label="Where sign-ups stop" data-testid="signup-stops">
      <div className={s.cardHead}>
        <div>
          <h2><Route size={18} aria-hidden="true"/> Where sign-ups stop</h2>
          <span className={s.micro}>Every visit to the sign-up form · last {days} days · which screen and box they stop in, and whose fault it was{kept ? ` · read at ${clock(kept.readAt, timezone)}` : ""}</span>
        </div>
        <div className={s.headerActions}>
          <div className={s.segment} role="group" aria-label="Span">{DROPOFF_DAYS.map((d) => <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)} disabled={pending && days !== d}>{d}D</button>)}</div>
          <button type="button" className={s.iconButton} aria-label="Read again now" title="Read again now" onClick={() => void load(days, true)} disabled={pending}><RefreshCw size={16} className={pending ? s.spin : ""}/></button>
        </div>
      </div>

      {!r && !problem && <div className={s.analystEmpty}>Reading the sign-up visits…</div>}
      {problem && <div className={s.notice} role="status"><Info size={16}/><div><strong>{problem}</strong>{r ? <p>Showing the reading from {clock(kept!.readAt, timezone)}.</p> : null}</div></div>}

      {r && r.visits === 0 && <div className={s.analystEmpty}>No one opened the sign-up form in the last {days} days.</div>}
      {r && r.visits > 0 && <>
        <Verdict r={r}/>
        <div className={s.analystSample} data-testid="stops-sample">
          <span><b>{r.visits}</b> opened the form</span>
          <span><b>{r.finished}</b> finished</span>
          {r.finishedLater > 0 && <span><b>{r.finishedLater}</b> stopped, then finished on another visit</span>}
          <span><b>{r.stopped}</b> stopped</span>
          {r.stillOnForm > 0 && <span><b>{r.stillOnForm}</b> still on the form</span>}
          {r.wentToGoogle > 0 && <span>went to Google and never came back <b>{r.wentToGoogle}</b></span>}
          {r.wentToCheckout > 0 && <span>opened the checkout and didn&apos;t pay <b>{r.wentToCheckout}</b></span>}
          <span>watched box by box <b>{r.watched}</b></span>
        </div>

        <div className={s.analystGrid}>
          <div>
            <span className={s.micro}>How far each screen gets them · median time to the next</span>
            <ol className={s.analystFunnel} data-testid="stops-screens">
              {r.screens.map((sc) => <li key={sc.key} data-screen={sc.key}><span>{sc.label}{sc.medianSecs != null ? <small> · {secsWords(sc.medianSecs)}</small> : null}</span><i style={{ width: bar(sc.reached, r.visits) }}/><b>{sc.reached}</b><em>{sc.stoppedHere ? `−${sc.stoppedHere}` : ""}</em></li>)}
              <li data-screen="done"><span>Finished</span><i style={{ width: bar(r.finished + r.finishedLater, r.visits) }}/><b>{r.finished + r.finishedLater}</b><em>{pctWords(r.finished + r.finishedLater, r.visits)}</em></li>
            </ol>
          </div>
          <div>
            <span className={s.micro}>Where they stopped · the screen and the last box · {visitsWords(r.stopped)}</span>
            {r.stopPlaces.length ? <ol className={s.analystFunnel} data-testid="stops-places">
              {r.stopPlaces.map((p) => <li key={p.place}><span>{p.place}</span><i style={{ width: bar(p.visits, r.stopped) }}/><b>{p.visits}</b><em>{pctWords(p.visits, r.stopped)}</em></li>)}
            </ol> : <div className={s.analystEmpty}>Nobody has stopped yet.</div>}
          </div>
        </div>

        {r.problems.length > 0 && <div className={s.tableScroll}>
          <table className={`${s.table} ${s.analystTable}`} data-testid="stops-problems">
            <thead><tr><th>What happened</th><th>Whose side</th><th>Visitors</th><th>Times</th><th>Finished anyway</th><th>Screen</th><th>What they saw</th></tr></thead>
            <tbody>{r.problems.map((p) => <tr key={p.reason} data-side={p.side}><td>{p.words}</td><td><span className={s.sideChip} data-side={p.side}>{p.side === "ours" ? "Ours" : p.side === "outside" ? "Not ours" : "Theirs"}</span></td><td>{p.visits}</td><td>{p.times}</td><td>{p.finishedAnyway}</td><td>{p.screen ? screenName(p.screen) : ""}</td><td className={s.stopsMessage}>{p.message}</td></tr>)}</tbody>
          </table>
        </div>}

        {r.boxes.length > 0 && <div className={s.tableScroll}>
          <table className={`${s.table} ${s.analystTable}`} data-testid="stops-boxes">
            <thead><tr><th>Box</th><th>Screen</th><th>Visitors in it</th><th>Median time</th><th>Left empty</th><th>Not valid</th><th>Last box before leaving</th></tr></thead>
            <tbody>{r.boxes.map((b) => <tr key={b.field}><td>{b.field}</td><td>{b.screen ? screenName(b.screen) : ""}</td><td>{b.visits}</td><td>{secsWords(b.medianSecs)}</td><td>{b.leftEmpty || ""}</td><td>{b.invalid || ""}</td><td>{b.lastBox ? <b>{b.lastBox}</b> : ""}</td></tr>)}</tbody>
          </table>
        </div>}

        {r.devices.length > 0 && <div className={s.tableScroll}>
          <table className={`${s.table} ${s.analystTable}`} data-testid="stops-devices">
            <thead><tr><th>Phone or computer</th><th>Visits</th><th>Finished</th><th>Finish rate</th></tr></thead>
            <tbody>{r.devices.map((d) => <tr key={d.label}><td>{d.label}</td><td>{d.visits}</td><td>{d.finished}</td><td>{pctWords(d.finished, d.visits)}</td></tr>)}</tbody>
          </table>
        </div>}

        <p className={s.footnote}>A visit is one browser session that opened /auth/register on www.jobflex.app, bots and previews out. &ldquo;Stopped&rdquo; means it ended without a sign-up and the same visitor did not finish on a later visit; a visit still active in the last 30 minutes is &ldquo;still on the form&rdquo;. Box-by-box detail, problems and the verdict come from the form&apos;s watcher, live from Oct 14 — earlier visits count in the screens only. A fault of ours is anything the visitor did not cause: our server, the code email, a limit of ours, the page breaking or loading slowly. The browser&apos;s own failures — a Facebook or Instagram in-app browser&apos;s bridge (&ldquo;Java object is gone&rdquo;), a bare &ldquo;Script error.&rdquo; or a file from another site — are &ldquo;Not ours&rdquo; and never count in the verdict. No typed value ever leaves the browser — only the box&apos;s name, how long, filled or not.</p>
      </>}
    </section>
  );
}
