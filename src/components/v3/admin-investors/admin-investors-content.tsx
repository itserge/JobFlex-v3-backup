"use client";

// ADMIN — INVESTORS, /admin/investors (2026-10-06). The report (shared with
// the public link and the PDF) with the owner's controls between its numbers
// and its chart: the daily ad budget (all ads together, spent every day),
// days booked by hand or read from Meta, the start day and how far the chart
// looks, and the shared link. No assumptions to set (2026-10-24): the share of
// trials that stay is measured, the forward spend is the last full week's.

import { useState, type ReactNode } from "react";
import { Copy, ExternalLink, FileDown, Link as LinkIcon, RefreshCw, Trash2 } from "lucide-react";
import { addAdSpendAction, deleteAdSpendAction, getInvestorReport, investorLinkAction, pullMetaSpendAction, saveInvestorSettingsAction } from "@/actions/investors";
import type { InvestorReport } from "@/lib/investors";
import { dollars, longDate, PLATFORMS, PLATFORM_LABEL, type SpendPlatform } from "@/lib/investorModel";
import { InvestorReportView } from "./investor-report";
import { InvestorFilm } from "./investor-film";
import shared from "@/components/v3/admin-overview/admin-shared.module.css";
import s from "./admin-investors.module.css";

const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

export function AdminInvestorsContent({ initial, origin, audience, pitch, adjust = false, readersByLink = {} }: { initial: InvestorReport; origin: string; /** How many readers came through each link, by its making time (2026-11-04). */ readersByLink?: Record<string, number>; /** Who opened the link and their offers (2026-10-13), drawn by the page. */ audience?: ReactNode; /** The pitch deck's own words (2026-10-25), drawn by the page under the controls. */ pitch?: ReactNode; /** ?adjust=1 — the hand controls (budget, booked days, start/launch day, horizon), otherwise out of sight (owner, 2026-10-25: "remove this"). */ adjust?: boolean }) {
  const [report, setReport] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const f = report.figures;
  const a = report.settings;

  // The daily budget.
  const [budget, setBudget] = useState(a.dailyBudgetCents === null ? "" : String(a.dailyBudgetCents / 100));
  const [budgetFrom, setBudgetFrom] = useState(a.budgetFrom ?? "");
  const budgetChanged = (budget.trim() === "" ? null : Math.round(Number(budget) * 100)) !== a.dailyBudgetCents || (budgetFrom.trim() === "" ? null : budgetFrom) !== a.budgetFrom;
  // Days booked by hand.
  const [from, setFrom] = useState(todayLocal());
  const [to, setTo] = useState(todayLocal());
  const [perDay, setPerDay] = useState("");
  const [platform, setPlatform] = useState<SpendPlatform>("meta");
  // The start day and how far the chart looks.
  const [horizon, setHorizon] = useState(a.horizonDays);
  const [sinceDate, setSinceDate] = useState(a.sinceDate ?? "");
  const sinceOrNull = sinceDate.trim() === "" ? null : sinceDate;
  const [launchDate, setLaunchDate] = useState(a.launchDate ?? "");
  const launchOrNull = launchDate.trim() === "" ? null : launchDate;

  const run = async (call: () => Promise<{ ok: true; report: InvestorReport } | { ok: false; error: string }>) => {
    setPending(true);
    setError("");
    try {
      const res = await call();
      if (res.ok) setReport(res.report);
      else setError(res.error);
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setPending(false);
    }
  };
  // The live links, newest first (several since 2026-11-04); the newest one also feeds the PDF and the film's tabs.
  const live = a.links.filter((l) => l.enabled);
  const closedCount = a.links.length - live.length;
  const [closing, setClosing] = useState<string | null>(null);
  const copy = async (url: string, token: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(token);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setError("Copy did not work here — select the link and copy it.");
    }
  };
  const countingChanged = horizon !== a.horizonDays || sinceOrNull !== a.sinceDate || launchOrNull !== a.launchDate;
  const booked = report.spend.entries;
  const bookedTotal = booked.filter((e) => e.date >= f.since && e.date <= f.today).reduce((x, e) => x + e.cents, 0);

  // SETTLED BY ITSELF (owner, 2026-10-25: "we don't need it — make it smart"): Meta reads the spend, the start day is
  // the first ad visitor's, the launch day and the horizon were set once. One line says so; the two panels fold away
  // and open by themselves only when something needs a hand — Meta not connected, or a start day that differs from
  // the first ad visitor's.
  const startIsFirstAd = !report.firstAdDay || report.firstAdDay === report.startDay;
  const settled = (
    <section className={s.panel} aria-label="Settled by itself" data-settled>
      <div className={s.auto}>
        <span data-settled-spend>
          <b>Spend</b>{" "}
          {report.meta.configured
            ? <>read from Meta{report.meta.lastPulledAt ? <> · last read {when(report.meta.lastPulledAt)}, {report.meta.daysPulled} {report.meta.daysPulled === 1 ? "day" : "days"}</> : <> · not read yet</>}{report.meta.lastError ? <> · {report.meta.lastError}</> : null}</>
            : <>not read — Meta isn&apos;t connected</>}
          {f.spend.dailyBudgetCents !== null ? <> · plus a {dollars(f.spend.dailyBudgetCents)}/day budget on days with nothing read</> : null}
        </span>
        <span data-settled-since>
          <b>Counting from</b> {longDate(report.startDay)}{startIsFirstAd ? <> — the first visitor from an ad</> : report.firstAdDay ? <> · the first ad visitor came {longDate(report.firstAdDay)} — <button type="button" className={s.textBtn} disabled={pending} onClick={() => void run(() => saveInvestorSettingsAction({ horizonDays: a.horizonDays, sinceDate: report.firstAdDay, launchDate: a.launchDate }))}>count from that day</button></> : null}
        </span>
        <span data-settled-launch><b>Day {report.launch.day}</b> since {longDate(report.launch.date)}{report.launch.set ? "" : " (the start day, until a launch day is set)"}</span>
        <span data-settled-horizon><b>Chart</b> looks {a.horizonDays} days ahead</span>
        {report.meta.configured && <button type="button" className={`btn btn-ghost ${s.autoBtn}`} disabled={pending} onClick={() => void run(() => pullMetaSpendAction())}>Read from Meta now</button>}
      </div>
    </section>
  );

  const controls = (
    <div className={s.controls}>
      {settled}
      {adjust && <details className={`${s.fold} ${s.adjust}`} open data-adjust>
      <summary>Adjust by hand · the budget, booked days, the start day, the launch day, the horizon</summary>
      <div className={s.adjustGrid}>
      {/* The ad budget. */}
      <section className={s.panel} aria-label="Ad spend">
        <h2 className={s.panelTitle}>Ad spend</h2>
        <form
          className={s.form}
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => saveInvestorSettingsAction({ dailyBudgetDollars: budget.trim() === "" ? null : Number(budget), budgetFrom: budgetFrom.trim() === "" ? null : budgetFrom }));
          }}
        >
          <label className={s.field}><span>Daily budget, all ads together, $</span><input className={s.in} name="budget" type="number" inputMode="decimal" min={0} step="0.01" placeholder="e.g. 100" value={budget} onChange={(e) => setBudget(e.target.value)} /></label>
          <label className={s.field}><span>Spent every day since</span><input className={s.in} name="budgetFrom" type="date" value={budgetFrom} min="2025-01-01" max={todayLocal()} onChange={(e) => setBudgetFrom(e.target.value)} /></label>
          <button type="submit" className="btn btn-primary" disabled={pending || !budgetChanged}>Save budget</button>
        </form>
        <p className={s.hint}>
          {f.spend.dailyBudgetCents !== null && f.spend.budgetFrom
            ? <>Counted as spent every day from {longDate(f.spend.budgetFrom)} to today — {f.spend.budgetDays > 0 ? <><b>{dollars(f.spend.dailyBudgetCents * f.spend.budgetDays)} over {f.spend.budgetDays} {f.spend.budgetDays === 1 ? "day" : "days"}</b> so far</> : <>no day yet, every day since then has a booked figure</>} — and projected forward at {dollars(f.spend.perDayProjectedCents)} a day. A day booked below, or read from Meta, overrides the budget for that day.</>
            : <>Set what the ads cost per day — the total across all ads, not per ad. It counts as spent every day from that date, and is projected forward. Blank = only the days booked below.</>}
        </p>

        {/* Meta's own figures. */}
        <div className={s.metaRow} data-meta={report.meta.configured ? "on" : "off"}>
          <div>
            <b>Meta</b>{" "}
            {report.meta.configured
              ? <>connected{report.meta.lastPulledAt ? ` · last read ${when(report.meta.lastPulledAt)}, ${report.meta.daysPulled} ${report.meta.daysPulled === 1 ? "day" : "days"}` : " · not read yet"}{report.meta.lastError ? ` · ${report.meta.lastError}` : ""} · read again by itself when older than an hour, and every morning</>
              : <>not connected — add <code>META_ADS_ACCESS_TOKEN</code> and <code>META_AD_ACCOUNT_ID</code> to the deployment; then the exact spend per day is read every morning.</>}
          </div>
          {report.meta.configured && <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => void run(() => pullMetaSpendAction())}>Read from Meta now</button>}
        </div>

        {/* Days booked by hand. */}
        <details className={s.fold}>
          <summary>Book days by hand · {booked.length} {booked.length === 1 ? "day" : "days"}</summary>
          <form
            className={s.form}
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => addAdSpendAction({ from, to, perDayDollars: Number(perDay), platform }));
            }}
          >
            <label className={s.field}><span>From</span><input className={s.in} name="from" type="date" value={from} max={todayLocal()} onChange={(e) => { setFrom(e.target.value); if (to < e.target.value) setTo(e.target.value); }} required /></label>
            <label className={s.field}><span>To</span><input className={s.in} name="to" type="date" value={to} min={from} max={todayLocal()} onChange={(e) => setTo(e.target.value)} required /></label>
            <label className={s.field}><span>Spent per day, $</span><input className={s.in} name="perDay" type="number" inputMode="decimal" min={0} step="0.01" placeholder="e.g. 100" value={perDay} onChange={(e) => setPerDay(e.target.value)} required /></label>
            <label className={s.field}><span>Platform</span><select className={s.in} value={platform} onChange={(e) => setPlatform(e.target.value as SpendPlatform)}>{PLATFORMS.map((p) => <option key={p} value={p}>{PLATFORM_LABEL[p]}</option>)}</select></label>
            <button type="submit" className="btn btn-primary" disabled={pending}>Book spend</button>
          </form>
          <p className={s.hint}>{booked.length} {booked.length === 1 ? "day" : "days"} booked · {dollars(bookedTotal)} since the start day. A booked day replaces the budget for that day; a figure read from Meta replaces a hand-typed Meta day.</p>
          {booked.length > 0 && (
            <div className={s.entryList}>
              {booked.slice(0, 120).map((e) => (
                <div key={e.id} className={s.entry}>
                  <span className={s.entryDate}>{e.date}</span>
                  <span>{PLATFORM_LABEL[e.platform]}{e.source === "meta" ? " · from Meta" : ""}</span>
                  <b>{dollars(e.cents)}</b>
                  <button type="button" className={s.iconBtn} aria-label={`Remove ${e.date} ${PLATFORM_LABEL[e.platform]}`} disabled={pending} onClick={() => void run(() => deleteAdSpendAction({ id: e.id }))}><Trash2 size={13} aria-hidden="true" /></button>
                </div>
              ))}
              {booked.length > 120 && <p className={s.hint}>The newest 120 are listed.</p>}
            </div>
          )}
        </details>
      </section>

      {/* What is counted — nothing assumed (2026-10-24). */}
      <section className={s.panel} aria-label="Counting">
        <h2 className={s.panelTitle}>Counting</h2>
        <form
          className={s.form}
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => saveInvestorSettingsAction({ horizonDays: horizon, sinceDate: sinceOrNull, launchDate: launchOrNull }));
          }}
        >
          <label className={`${s.field} ${s.wide}`}>
            <span>Counting from · the day the first campaign went live</span>
            <input className={s.in} type="date" value={sinceDate} min="2025-01-01" max={todayLocal()} onChange={(e) => setSinceDate(e.target.value)} />
            <small>
              {report.firstAdDay ? (
                <>
                  First visitor from an ad seen on <b>{longDate(report.firstAdDay)}</b>
                  {report.firstAdDay !== sinceDate && <> · <button type="button" className={s.textBtn} onClick={() => setSinceDate(report.firstAdDay ?? "")}>use that day</button></>}.{" "}
                </>
              ) : (
                <>Blank counts from the live map&apos;s start, Sep 30, 2026. </>
              )}
              Signups, trials, paying accounts and spend before this day are left out.
            </small>
          </label>
          <label className={s.field}>
            <span>JobFlex launched on</span>
            <input className={s.in} type="date" name="launchDate" value={launchDate} min="2020-01-01" max={todayLocal()} onChange={(e) => setLaunchDate(e.target.value)} />
            <small>Today is day <b>{report.launch.day}</b>{report.launch.set ? "" : " — counted from the start day until a launch day is set"}.</small>
          </label>
          <label className={s.field}><span>Chart looks ahead, days</span><input className={s.in} type="number" min={30} max={730} step={30} value={horizon} onChange={(e) => setHorizon(Number(e.target.value))} /></label>
          <button type="submit" className="btn btn-primary" disabled={pending || !countingChanged}>Apply</button>
        </form>
        <p className={s.hint} data-measured>
          Nothing to assume: the share of trials that stay is measured — {f.rate.pct === null ? <>no trial has ended yet</> : <><b>{f.rate.pct}%</b>, {f.rate.paid} of the {f.rate.ended} trials that ended are paying</>} — and the running trials are expected to pay at that rate. Spend from tomorrow runs at the last full week&apos;s pace ({dollars(f.spend.perDayProjectedCents)} a day); a trial lasts {f.trials.lengthDays} days, as the running ones show.
        </p>
      </section>
      </div>
      </details>}

      {/* The shared links (several since 2026-11-04 — owner: "create two or three … send it to people"): each one keeps
          working until it is closed on its own; a new link closes none. */}
      <section className={s.panel} aria-label="Shared links" data-investor-links>
        <h2 className={s.panelTitle}>Share with investors</h2>
        <p className={s.hint}>Live pages with these figures and no admin controls, and the same as a PDF. Make as many links as you like — each keeps working until you close it, and everyone who opens one still waits for your approval.</p>
        {live.length ? (
          <div className={s.linkList}>
            {live.map((l, i) => {
              const url = `${origin}/investors/${l.token}`;
              const people = readersByLink[l.madeAt] ?? 0;
              return (
                <div key={l.token} className={s.linkRow} data-link-row>
                  <div className={s.linkName}>
                    <b>Link {live.length - i}</b> · made {l.madeAt ? when(l.madeAt) : "earlier"} · {people === 0 ? "nobody yet" : `${people} ${people === 1 ? "person" : "people"}`}
                  </div>
                  <code className={s.link}>{url}</code>
                  <button type="button" className="btn btn-ghost" onClick={() => void copy(url, l.token)}><Copy size={14} aria-hidden="true" />{copied === l.token ? "Copied" : "Copy"}</button>
                  <a className="btn btn-ghost" href={url} target="_blank" rel="noreferrer"><ExternalLink size={14} aria-hidden="true" />Open</a>
                  <button type="button" className="btn btn-ghost" disabled={pending || closing === l.token} onClick={() => setClosing(l.token)} aria-label={`Close link ${live.length - i}`} data-link-close>Close</button>
                  {closing === l.token ? (
                    <div className={s.linkSure} data-link-sure>
                      <p className={s.hint}>Close link {live.length - i}? Whoever has it will see &ldquo;This link is not active&rdquo;. The other links keep working.</p>
                      <button type="button" className="btn btn-danger" disabled={pending} onClick={() => void run(() => investorLinkAction({ token: l.token, enabled: false })).then(() => setClosing(null))} data-link-close-yes>Close it</button>
                      <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => setClosing(null)}>Keep it</button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <p className={s.hint}>No link is live.</p>
        )}
        <div className={s.linkActs}>
          <button type="button" className={live.length ? "btn btn-ghost" : "btn btn-primary"} disabled={pending} onClick={() => void run(() => investorLinkAction({ add: true }))} data-link-add><LinkIcon size={14} aria-hidden="true" />{live.length ? "Make another link" : "Make a link"}</button>
          <button type="button" className={s.iconBtn} aria-label="Read the figures again" disabled={pending} onClick={() => void run(async () => ({ ok: true as const, report: await getInvestorReport() }))}><RefreshCw size={14} className={pending ? s.spin : ""} aria-hidden="true" /></button>
        </div>
        {closedCount ? <p className={s.hint}>{closedCount} closed {closedCount === 1 ? "link shows" : "links show"} &ldquo;This link is not active&rdquo;.</p> : null}
      </section>

      {pitch}
    </div>
  );

  return (
    <>
      <div className="page-head">
        <div>
          <div className="kicker">Platform · Investors</div>
          <h1 className="page-title">Investors</h1>
        </div>
        <div className={shared.headSide}>
          {live.length ? <span className="chip ok">{live.length === 1 ? "1 link live" : `${live.length} links live`}</span> : <span className={`chip ${shared.chipMuted}`}>No link live</span>}
          {a.linkToken && (
            <a className="btn btn-ghost" href={`/api/investors/${a.linkToken}/pdf`} target="_blank" rel="noreferrer">
              <FileDown size={15} aria-hidden="true" />
              PDF
            </a>
          )}
        </div>
      </div>

      {error && <p className={`${shared.note} ${s.err}`} role="alert">{error}</p>}

      {audience}

      <InvestorFilm deckHref={a.linkToken ? `/investors/${a.linkToken}/pitch` : null} tourHref={a.linkToken ? `/investors/${a.linkToken}/tour` : null} />

      <InvestorReportView report={report} between={controls} />
    </>
  );
}
