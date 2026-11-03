"use client";
/**
 * THE ANALYST (owner, 2026-10-02): under the live map, what people do on the
 * landing and where the sign-up loses them — the last week read as
 * findings, each a line of evidence and one thing to try, with a headline
 * of what is going on. Reads once on mount and every ten minutes while the
 * tab is open; the server asks PostHog for the week every half hour
 * (lib/posthog-cache), and Refresh asks it now — 30 s apart at most. Quiet
 * until twenty visits from ads have landed.
 */
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, Lightbulb, RefreshCw, Sparkles } from "lucide-react";
import { getTrafficAnalyst, type AnalystResult } from "@/actions/trafficDashboard";
import { AnalystExport } from "./analyst-export";
import { AnalystMoney } from "./analyst-money";
import { pct, type AnalystFinding, type AnalystSectionReach } from "@/lib/traffic-analyst";
import { asOfLabel } from "@/lib/traffic-contract";
import s from "./traffic.module.css";

const READ_EVERY_MS = 10 * 60_000;
const TONE_ICON: Record<AnalystFinding["tone"], typeof Info> = { bad: AlertTriangle, warn: AlertTriangle, good: CheckCircle2, info: Info };
const TONE_WORD: Record<AnalystFinding["tone"], string> = { bad: "Fix", warn: "Watch", good: "Working", info: "Note" };
const clock = (iso: string, timezone: string) => { try { return new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(new Date(iso)); } catch { return ""; } };
const visits = (n: number) => `${n} measured ${n === 1 ? "visit" : "visits"}`;
/** How far down a page they get: one bar a section, in the order that page lays them out. */
function SectionReach({ sections }: { sections: AnalystSectionReach[] }) {
  return (
    <ol className={s.analystFunnel}>
      {sections.filter((sec) => sec.reach !== null && (sec.reach > 0 || sec.shown === "all")).map((sec) => <li key={sec.key}><span>{sec.label}{sec.shown === "some" ? " ·" : ""}{sec.shown === "some" ? <small> where shown</small> : null}</span><i style={{ width: `${Math.max(2, Math.round((sec.reach ?? 0) * 100))}%` }}/><b>{pct(sec.reach)}</b></li>)}
    </ol>
  );
}

export function AnalystPanel({ timezone }: { timezone: string }) {
  const [result, setResult] = useState<AnalystResult | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async (force = false) => {
    setPending(true);
    try {
      const next = await getTrafficAnalyst({ timezone, force });
      // PostHog down and a reading on screen: it stays, dated, and the next read tries again.
      setResult((prev) => (next.status === "error" && prev?.status === "ok" ? { ...prev, stale: { since: prev.fetchedAt, reason: next.message ?? "" } } : next));
      setError("");
    }
    catch (err) { setError(err instanceof Error ? err.message : "The analyst could not read."); }
    finally { setPending(false); }
  }, [timezone]);
  useEffect(() => {
    // The first read on the next tick (not in the effect itself), then every ten minutes while the tab is open.
    const first = window.setTimeout(() => void load(), 0);
    const every = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, READ_EVERY_MS);
    return () => { window.clearTimeout(first); window.clearInterval(every); };
  }, [load]);

  const r = result?.report ?? null;
  const ok = result?.status === "ok" && r;
  // A landing laid out in an order of its own (the roofing landing) is read
  // apart, under the usual order's table; the count beside each is its own.
  const ownOrder = r?.landings ?? [];
  const usualMeasured = r ? r.sample.measured - ownOrder.reduce((a, l) => a + l.measured, 0) : 0;
  return (
    <section className={`${s.card} ${s.analyst}`} aria-label="The analyst" data-testid="analyst">
      <div className={s.cardHead}>
        <div>
          <h2><Sparkles size={18} aria-hidden="true"/> The analyst</h2>
          <span className={s.micro}>What people do on the landing and where the sign-up loses them · {r?.period ?? "last 7 days"} · PostHog read every 30 minutes{result?.stale ? <span data-as-of title={result.stale.reason}> · {asOfLabel(result.stale, timezone)}</span> : result ? ` · read at ${clock(result.fetchedAt, timezone)}` : ""}</span>
        </div>
        <div className={s.headerActions}><AnalystExport result={result} timezone={timezone}/>
        <button type="button" className={s.iconButton} aria-label="Read again now" title="Read again now" onClick={() => void load(true)} disabled={pending}><RefreshCw size={16} className={pending ? s.spin : ""}/></button></div>
      </div>

      {!result && <div className={s.analystEmpty}>Reading the last week…</div>}
      {(error || (result && result.status !== "ok")) && <div className={s.notice} role="status"><Info size={16}/><div><strong>{error || result?.message}</strong></div></div>}

      {ok && <>
        <p className={s.analystHeadline} data-testid="analyst-headline">{r.headline}</p>
        <div className={s.analystSample}>
          <span><b>{r.sample.landed}</b> landed</span>
          <span><b>{r.sample.fromAds}</b> from ads</span>
          <span><b>{r.sample.last24h}</b> in the last 24 h</span>
          {r.stats.dwellMedian !== null && <span>median time on the landing <b>{r.stats.dwellMedian < 60 ? `${Math.round(r.stats.dwellMedian)} s` : `${Math.round(r.stats.dwellMedian / 60)} min`}</b></span>}
          {r.stats.scrollMedian !== null && <span>median scroll <b>{pct(r.stats.scrollMedian)}</b></span>}
          {r.stats.inApp !== null && r.sample.basis === "ads" && <span>in Facebook&apos;s browser <b>{pct(r.stats.inApp)}</b></span>}
          {r.stats.heroMedianPhone !== null && <span>headline on phones after <b>{(r.stats.heroMedianPhone / 1000).toFixed(1)} s</b></span>}
          {r.stats.formReadyMedian !== null && <span>sign-up form usable after <b>{(r.stats.formReadyMedian / 1000).toFixed(1)} s</b></span>}
        </div>

        <ol className={s.analystFindings} aria-label="Findings">
          {r.findings.map((f) => { const Icon = TONE_ICON[f.tone]; return (
            <li key={f.id} data-tone={f.tone} data-testid="analyst-finding">
              <div className={s.analystTone}><Icon size={15} aria-hidden="true"/><span>{TONE_WORD[f.tone]}</span></div>
              <div className={s.analystBody}>
                <b>{f.title}</b>
                <span className={s.analystEvidence}>{f.evidence}</span>
                <span className={s.analystAction}><Lightbulb size={13} aria-hidden="true"/>{f.action}</span>
                {f.steps && f.steps.length > 0 && <ol className={s.analystSteps} aria-label="The fix, step by step">{f.steps.map((t, i) => <li key={i}>{t}</li>)}</ol>}
                <small>{f.about ? `${f.about} · ` : ""}{f.n} {f.n === 1 ? "visit" : "visits"} · {f.confidence} confidence</small>
              </div>
            </li>
          ); })}
        </ol>

        {r.sample.enough && <div className={s.analystGrid}>
          <div>
            <span className={s.micro}>The funnel · {r.sample.basis === "ads" ? "visits from ads" : "all landing visits"}</span>
            <ol className={s.analystFunnel}>
              {r.funnel.map((step) => <li key={step.key}><span>{step.label}</span><i style={{ width: `${Math.max(2, Math.round((step.pct ?? 0) * 100))}%` }}/><b>{step.n}</b><em>{pct(step.pct)}</em></li>)}
            </ol>
          </div>
          <div>
            <span className={s.micro}>How far down the page they get · {visits(usualMeasured)}{ownOrder.length ? ` · ${ownOrder.map((l) => l.name).join(", ")} apart` : ""}</span>
            {usualMeasured ? <SectionReach sections={r.sections}/> : <div className={s.analystEmpty}>No section readings yet — they arrive with the next visits.</div>}
          </div>
          {ownOrder.map((l) => (
            <div key={l.key} data-testid={`analyst-landing-${l.key}`}>
              <span className={s.micro}>How far down {l.name} they get, in its own order · {visits(l.measured)}</span>
              <SectionReach sections={l.sections}/>
            </div>
          ))}
        </div>}

        {r.ads.length > 0 && <div className={s.tableScroll}>
          <table className={`${s.table} ${s.analystTable}`}>
            <thead><tr><th>Ad</th><th>Platform</th><th>Visits</th><th>Bounced</th><th>Pressed</th><th>Opened the form</th><th>Signed up</th></tr></thead>
            <tbody>{r.ads.slice(0, 12).map((a) => <tr key={a.key}><td>{a.name}</td><td>{a.platform ?? ""}</td><td>{a.n}</td><td>{pct(a.bounce)}</td><td>{pct(a.cta)}</td><td>{pct(a.form)}</td><td>{a.completed}</td></tr>)}</tbody>
          </table>
        </div>}
        <AnalystMoney money={result?.money} timezone={timezone}/>

        <p className={s.footnote}>One row per browser session on www.jobflex.app, bots and previews out. &ldquo;Left at once&rdquo; is one page, no button, no form. Time and scroll come from the browser as it leaves the landing (posthog-js $pageleave); sections from the landing&apos;s own tracker, so visits before it shipped have no section reading. The first screen&apos;s timing (when the headline really showed on the visitor&apos;s phone, how much was downloaded) and the sign-up form&apos;s readiness come from two beacons added 2026-10-04 — earlier visits carry neither. A finding needs its minimum sample — {r.sample.needed} ad visits for the page, 8 for an ad or a trade — and says how sure it is. Ads are named by the names given below the live list.</p>
      </>}
    </section>
  );
}
