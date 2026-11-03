"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { ArrowDownToLine, ArrowUpRight, ChevronRight, FileText, RefreshCw, SlidersHorizontal, Info, Users } from "lucide-react";
import { getSignupAttribution, getTrafficDashboard, getTrafficExperimentsAction, getTrafficStageVisitors } from "@/actions/trafficDashboard";
import { getTrafficExportMarkdown } from "@/actions/trafficExport";
import { getAdsManagerClicks } from "@/actions/trafficClicks";
import { downloadText, reportToCsv } from "@/lib/traffic-export";
import { toast } from "@/components/ui/toast-store";
import { asOfLabel, pageLabel, percent, type SignupAttribution, type StageVisitor, type StageVisitorsReport, type TrafficFilters, type TrafficReport } from "@/lib/traffic-contract";
import { AdsReconciliation, DailyPeople } from "./daily-tables";
import { dateInZone, shiftDate } from "@/lib/traffic-query";
import { Sheet, useMdl } from "@/components/v3/admin-influencers/admin-ui";
import { TrafficChart } from "./traffic-chart";
import { TrafficDatePicker } from "./traffic-date-picker";
import { TRAFFIC_SINCE, TRAFFIC_SINCE_LABEL, TRAFFIC_SINCE_SHORT, TRAFFIC_SINCE_WHY } from "@/lib/traffic-visitor";
import { LivePanel } from "./live-panel";
import { AnalystPanel } from "./analyst-panel";
import { SignupStopsPanel } from "./signup-stops-panel";
import { AnalystTrend } from "./analyst-trend";
import { DigestToggle } from "./digest-toggle";
import { AdLinks } from "./ad-links";
import type { LiveReport, SignupLedger } from "@/lib/traffic-live";
import s from "./traffic.module.css";

const n = (v: number | null | undefined) => v == null ? "--" : v.toLocaleString("en-US");
const rate = (v: number | null) => v == null ? "--" : `${v.toFixed(1)}%`;
const pageKeys = ["/", "/auth/login", "/auth/register", "registration:1", "registration:2", "registration:3"];
const dimensions = { sources: "Sources", referrers: "Referrers", campaigns: "Campaigns", devices: "Devices", browsers: "Browsers", countries: "Countries", terms: "Campaign terms" } as const;
type Dimension = keyof typeof dimensions;
function delta(current: number | undefined, previous: number | undefined) {
  if (current == null || previous == null) return "Comparison unavailable";
  if (!previous) return current ? "No previous baseline" : "No change";
  const d = (current - previous) / previous * 100;
  return `${d > 0 ? "+" : ""}${d.toFixed(1)}% vs previous period`;
}
function Select({ label, value, onChange, children }: { label: string; value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  // `bp-sel-in` is load-bearing: the wrapper draws the chevron, and only that class removes the native one.
  return <label className={s.filterLabel}><span>{label}</span><div className={`bp-sel ${s.selectWrap}`}><select className="bp-sel-in" value={value} onChange={e => onChange(e.target.value)}>{children}</select></div></label>;
}
/** Top values of one visitor attribute, for the drill-down summary. */
function tally(rows: StageVisitor[], pick: (v: StageVisitor) => string, limit = 4) {
  const counts = new Map<string, number>();
  for (const row of rows) { const key = pick(row) || "Unknown"; counts.set(key, (counts.get(key) || 0) + 1); }
  return Array.from(counts, ([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, limit);
}
/** The header's CSV: every column the report holds, Ads Manager's clicks and the signups list (lib/traffic-export). */
async function exportReport(report: TrafficReport, ledger: SignupLedger | null) {
  try {
    const [clicks, experiments] = await Promise.all([
      getAdsManagerClicks({ days: report.points.map((p) => p.date) }).catch(() => ({})),
      getTrafficExperimentsAction({ ...report.filters }),
    ]);
    downloadText(`jobflex-traffic-${report.filters.from}-${report.filters.to}.csv`, reportToCsv({ ...report, experiments }, ledger, clicks), "text/csv;charset=utf-8;");
  } catch {
    toast.error("Could not export", "Experiment results are unavailable. Retry when analytics reconnects.");
  }
}

/** How often the report is asked again while it shows an old answer. */
const STALE_RETRY_MS = 30_000;
const signupDimensions = { landingIndustry: "Landing trade", signupVariant: "Landing variant", utmSource: "utm_source", utmMedium: "utm_medium", utmCampaign: "utm_campaign", utmContent: "utm_content" } as const;
type SignupDimension = keyof typeof signupDimensions;

export function AdminTrafficContent({ data, deferred = false, signups: initialSignups = null, live = null, ledger = null }: { data: TrafficReport; deferred?: boolean; signups?: SignupAttribution | null; live?: LiveReport | null; ledger?: SignupLedger | null }) {
  const [report, setReport] = useState(data);
  const [signups, setSignups] = useState(initialSignups);
  const [signupDimension, setSignupDimension] = useState<SignupDimension>("landingIndustry");
  const [draft, setDraft] = useState(data.filters);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const request = useRef(0);
  const [tab, setTab] = useState<"pages" | "acquisition">("pages");
  const [dimension, setDimension] = useState<Dimension>("sources");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"visitors" | "pageviews" | "returningVisitors">("visitors");
  const [pageIndex, setPageIndex] = useState(0);
  const shown = useRef(report);
  useEffect(() => { shown.current = report; }, [report]);
  const filters = report.filters;
  const t = report.totals;
  const update = (changes: Partial<TrafficFilters>) => setDraft(d => ({ ...d, ...changes }));
  // What was last asked for — the retry below asks for it again.
  const wanted = useRef(data.filters);
  // `force` is the Refresh button: PostHog asked again past the server's half-hour cache, 30 s apart at most.
  function load(next: TrafficFilters, force = false) {
    const id = ++request.current;
    wanted.current = next;
    setError("");
    startTransition(async () => {
      try {
        const [result, attributed] = await Promise.all([getTrafficDashboard({ ...next, force }), getSignupAttribution({ ...next }).catch(() => null)]);
        if (id !== request.current) return;
        // PostHog down (2026-10-03) and figures on screen: they stay, dated,
        // and the page asks again — the banner alone is for a page with
        // nothing to show. The server does the same per query from its own
        // memory; this covers the instance that has none.
        if (result.status === "error" && shown.current.totals) { setReport(prev => ({ ...prev, stale: { since: prev.stale?.since ?? prev.fetchedAt, reason: result.message ?? "" } })); return; }
        setReport(result); setDraft(result.filters); setSignups(attributed);
      } catch (err) { if (id === request.current) setError(err instanceof Error ? err.message : "Could not refresh traffic."); }
    });
  }
  // The page painted before the PostHog report was ready (page.tsx): ask for
  // it now — the server's in-flight queries answer, nothing runs twice.
  const asked = useRef(false);
  useEffect(() => {
    if (!deferred || asked.current) return;
    asked.current = true;
    load(data.filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, []);
  // While the figures are old the page keeps asking, as the live view does.
  const stale = report.stale;
  const isStale = !!stale;
  useEffect(() => {
    if (!isStale) return;
    const retry = window.setInterval(() => { if (document.visibilityState === "visible") load(wanted.current); }, STALE_RETRY_MS);
    return () => window.clearInterval(retry);
    // Armed by the note alone: load is a new function every render.
  }, [isStale]);
  function apply(changes: Partial<TrafficFilters>) {
    const next = { ...filters, ...changes };
    setDraft(next); load(next);
  }
  const changed = JSON.stringify(draft) !== JSON.stringify(filters);
  const options = <K extends "pages" | "sources" | "devices" | "hosts">(key: K) => Array.from(new Set([...data[key], ...report[key]].map(p => "page" in p ? p.page : p.name)));
  const availablePages = Array.from(new Set([...pageKeys, ...options("pages"), filters.page].filter(Boolean)));
  const rows = report.pages.filter(p => (p.page + " " + pageLabel(p.page)).toLowerCase().includes(search.toLowerCase())).sort((a, b) => b[sort] - a[sort]);
  const pageCount = Math.max(1, Math.ceil(rows.length / 20));
  const visiblePage = Math.min(pageIndex, pageCount - 1);
  const acquisition = report[dimension];
  const funnelEnd = report.funnel.at(-1);
  const stepCoverageDate = report.firstStepAt ? dateInZone(new Date(report.firstStepAt), filters.timezone) : null;
  const coverageIncomplete = !stepCoverageDate || filters.from <= stepCoverageDate;
  const failed = (name: string) => report.errors.some(e => e.startsWith(name + ":"));
  const today = dateInZone(new Date(), draft.timezone);

  // Stage drill-down: who reached a funnel stage, with device, place and source.
  const [drill, setDrill] = useState<{ id: string; label: string } | null>(null);
  const [drillReport, setDrillReport] = useState<StageVisitorsReport | null>(null);
  const [drillError, setDrillError] = useState("");
  const [drillPending, setDrillPending] = useState(false);
  const drillRequest = useRef(0);
  const sheet = useMdl();
  function inspect(stage: { id: string; label: string }) {
    const id = ++drillRequest.current;
    setDrill(stage); setDrillReport(null); setDrillError(""); setDrillPending(true);
    sheet.open();
    getTrafficStageVisitors({ ...filters }, stage.id)
      .then(result => { if (id === drillRequest.current) setDrillReport(result); })
      .catch(err => { if (id === drillRequest.current) setDrillError(err instanceof Error ? err.message : "Could not load visitors."); })
      .finally(() => { if (id === drillRequest.current) setDrillPending(false); });
  }
  // EXPORT EVERYTHING (2026-10-04): the page as one Markdown file, built on
  // the server from the same reads, under the filters on screen.
  const [exporting, setExporting] = useState(false);
  async function exportEverything() {
    setExporting(true);
    try {
      const { markdown, name } = await getTrafficExportMarkdown({ ...filters });
      downloadText(name, markdown, "text/markdown;charset=utf-8;");
      toast.success("Markdown downloaded", "Every block of the page, under the filters on screen.");
    } catch (err) { toast.error("Could not export", err instanceof Error ? err.message : undefined); }
    finally { setExporting(false); }
  }
  const when = (iso: string) => iso ? new Intl.DateTimeFormat("en-US", { timeZone: filters.timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso)) : "--";
  const stageLabel = (id: string) => report.funnel.find(stage => stage.id === id)?.label || id || "--";
  const visitors = drillReport?.visitors ?? [];
  const place = (v: StageVisitor) => [v.city, v.region, v.country].filter(Boolean).join(", ");

  return <div className={s.root} aria-busy={pending}>
    <header className={s.header}>
      <div><div className={s.eyebrow}>Platform intelligence / 01</div><h1>Traffic<span>.</span></h1></div>
      <div className={s.headerActions}><span className={s.status} data-state={report.status === "ok" && !report.errors.length && !stale ? "ok" : "warning"}><i/>{deferred && !report.totals && !error ? "Loading PostHog…" : report.status === "disabled" ? "Not connected" : report.status !== "ok" ? "Unavailable" : stale ? "PostHog unavailable" : report.errors.length ? "Partial data" : "PostHog connected"}</span>
        <button className={s.button} onClick={() => void exportEverything()} disabled={exporting} aria-busy={exporting}><FileText size={15} aria-hidden="true"/>{exporting ? "Preparing…" : "Export everything"}</button>
        <button className={s.button} onClick={() => void exportReport(report, ledger)} disabled={!t || pending}><ArrowDownToLine size={15}/>Export CSV</button>
        <button className={s.iconButton} aria-label="Refresh traffic" title="Ask PostHog again now (at most every 30 s)" onClick={() => load(filters, true)} disabled={pending}><RefreshCw size={17} className={pending ? s.spin : ""}/></button>
      </div>
    </header>

    <div className={s.lifetime}><span>Visitors since {TRAFFIC_SINCE_SHORT} <strong>{n(report.lifetime ?? live?.totals?.allTime)}</strong></span><span>Today <strong>{n(report.today ?? live?.totals?.today)}</strong></span><span className={s.scope}>{filters.environment === "all" ? "www.jobflex.app + localhost" : filters.environment === "development" ? "Localhost only" : "www.jobflex.app"} / no bots, no previews / counted from {TRAFFIC_SINCE_LABEL}, {TRAFFIC_SINCE_WHY}</span><span className={s.updated} data-as-of={stale ? "" : undefined} title={stale?.reason}>{pending ? "Querying PostHog..." : stale ? `${asOfLabel(stale, filters.timezone)}${stale.scope ? ` · ${stale.scope}` : ""}` : `Updated ${new Date(report.fetchedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: filters.timezone })}`}</span></div>

    {/* Who is on the site this minute, where from, how far they got (2026-09-28). */}
    {live && <LivePanel initial={live} timezone={filters.timezone} fullHistory={filters.fullHistory} ledger={ledger}/>}
    {/* The analyst (2026-10-02): the week's landing visits read as findings, under the live map. */}
    <AnalystPanel timezone={filters.timezone}/>
    <SignupStopsPanel timezone={filters.timezone}/>
    {/* One saved reading a day, and what changed (2026-10-04, lib/traffic-digest). */}
    <AnalystTrend/>
    {/* The signups have their own page under Traffic now (owner, 2026-10-12); here, their numbers and the door. */}
    {ledger && <SignupsMoved ledger={ledger}/>}
    {/* The tagged link for every ad and post, so the cards above tell them apart (2026-09-29). */}
    <AdLinks/>

    <section className={s.filterPanel} aria-label="Traffic filters">
      <div className={s.rangeRow}><div className={s.filterCaption}><SlidersHorizontal size={16}/><span>Report scope</span></div><TrafficDatePicker from={draft.from} to={draft.to} timezone={draft.timezone} min={draft.fullHistory ? undefined : TRAFFIC_SINCE} onChange={(from, to) => update({ from, to })}/>
        <div className={s.segment}>{[1, 7, 14, 30, 90].map(days => <button key={days} aria-pressed={draft.from === shiftDate(today, 1 - days) && draft.to === today} onClick={() => update({ from: shiftDate(today, 1 - days), to: today })}>{days === 1 ? "Today" : `${days}D`}</button>)}</div>
      </div>
      <details className={s.filtersDisclosure}><summary>Page, audience &amp; source filters<span>{[draft.page, draft.source, draft.device, draft.host, draft.audience !== "all", draft.environment !== "production"].filter(Boolean).length || "All traffic"}</span></summary><div className={s.filters}>
        <Select label="Page / screen" value={draft.page} onChange={page => update({ page })}><option value="">All pages</option>{availablePages.map(p => <option key={p} value={p}>{pageLabel(p)}</option>)}</Select>
        <Select label="Audience" value={draft.audience} onChange={audience => update({ audience: audience as TrafficFilters["audience"] })}><option value="all">All visitors</option><option value="new">New visitors</option><option value="returning">Returning visitors</option></Select>
        <Select label="Source" value={draft.source} onChange={source => update({ source })}><option value="">All sources</option>{options("sources").map(name => <option key={name}>{name}</option>)}</Select>
        <Select label="Device" value={draft.device} onChange={device => update({ device })}><option value="">All devices</option>{options("devices").map(name => <option key={name} value={name === "Unknown" ? "__unknown__" : name}>{name}</option>)}</Select>
        <Select label="Environment" value={draft.environment} onChange={environment => update({ environment: environment as TrafficFilters["environment"] })}><option value="production">www.jobflex.app</option><option value="all">www.jobflex.app + localhost</option><option value="development">Localhost only</option></Select>
        <Select label="Hostname" value={draft.host} onChange={host => update({ host })}><option value="">All hostnames</option>{options("hosts").filter(Boolean).map(name => <option key={name} value={name === "Unknown" ? "__unknown__" : name}>{name}</option>)}</Select>
      </div><label className={s.timezone}>Timezone<select aria-label="Report timezone" value={draft.timezone} onChange={e => update({ timezone: e.target.value })}>{Array.from(new Set([draft.timezone, "America/Los_Angeles", "America/New_York", "Europe/London", "UTC"])).map(z => <option key={z}>{z}</option>)}</select></label></details>
      <div className={s.filterFooter}><span className={s.activeTimezone}>{filters.timezone}</span><span className={s.unsaved}>{changed ? "Filters changed. Apply to update." : `${filters.from} to ${filters.to} / inclusive`}</span><button className={s.textButton} onClick={() => { const next = { ...data.filters, from: shiftDate(today, -29), to: today }; setDraft(next); load(next); }} disabled={pending}>Reset</button><button className={s.primary} onClick={() => load(draft)} disabled={pending}>{pending ? "Updating..." : "Apply filters"}<ArrowUpRight size={16}/></button></div>
    </section>

    {(error || (report.message && !stale) || report.errors.length > 0) && <div className={s.notice} role="alert"><Info size={18}/><div><strong>{error || report.message || "Some reports are unavailable."}</strong>{report.errors.length > 0 && <details><summary>Query details</summary>{report.errors.map(e => <p key={e}>{e}</p>)}</details>}</div></div>}

    <div className={s.sectionLabel}><span>01 / Audience</span><span>{filters.page ? pageLabel(filters.page) : "All pages"}{filters.audience !== "all" ? ` / ${filters.audience}` : ""}</span></div>
    <section className={s.metrics} aria-label="Audience summary">
      <div className={s.metricLead}><span>Visitors in range</span><strong>{n(t?.visitors)}</strong><small>{delta(t?.visitors, report.previous?.visitors)}</small></div>
      <div><span>People (est.)</span><strong>{n(report.people?.people)}</strong><small>{report.people && t?.visitors ? `${rate(percent(report.people.inAppVisitors, t.visitors))} in FB / IG in-app · ${n(report.people.inAppVisitors)} clicks → ${n(report.people.inAppPeople)} people` : "address + browser"}</small></div>
      <div><span>New visitors</span><strong>{n(t?.newVisitors)}</strong><small>{rate(t ? percent(t.newVisitors, t.visitors) : null)} of visitors</small></div>
      <div><span>Returning visitors</span><strong>{n(t?.returningVisitors)}</strong><small>{rate(t ? percent(t.returningVisitors, t.visitors) : null)} of visitors</small></div>
      <div><span>Repeat visitors</span><strong>{n(t?.repeatVisitors)}</strong><small>2+ sessions in this range</small></div>
      <div><span>Sessions</span><strong>{n(t?.sessions)}</strong><small>{t?.visitors ? (t.sessions / t.visitors).toFixed(2) : "--"} per visitor</small></div>
      <div><span>{filters.page.startsWith("registration:") ? "Screen views" : "Pageviews"}</span><strong>{n(t?.pageviews)}</strong><small>{delta(t?.pageviews, report.previous?.pageviews)}</small></div>
    </section>

    <section className={s.card}>
      <div className={s.cardHead}><div><h2>Traffic over time</h2><span className={s.micro}>{filters.from} / {filters.to}</span></div><span className={s.stamp}>Daily resolution</span></div>
      <TrafficChart points={report.points}/>
      <div className={s.composition}><div className={s.compositionBar} data-empty={!t?.visitors} aria-label={`${rate(t ? percent(t.newVisitors, t.visitors) : null)} new visitors`}><span style={{ width: `${t ? percent(t.newVisitors, t.visitors) ?? 0 : 0}%` }}/></div><span><b>{rate(t ? percent(t.newVisitors, t.visitors) : null)}</b> new</span><span><b>{rate(t ? percent(t.returningVisitors, t.visitors) : null)}</b> returning</span></div>
    </section>

    {report.points.length > 0 && <DailyPeople points={report.points}/>}
    {report.points.length > 0 && <AdsReconciliation points={report.points}/>}

    <div className={s.sectionLabel}><span>02 / Conversion</span><span>Ordered, unique visitors</span></div>
    <section className={s.card}>
      <div className={s.cardHead}><div><h2>From visit to signup</h2><span className={s.micro}>Landing entrants in the selected dates</span></div><div className={s.funnelControls}><Select label="Registration flow" value={filters.flow} onChange={flow => apply({ flow: flow as TrafficFilters["flow"] })}><option value="all">All flows</option><option value="standard">Email signup</option><option value="google">Google signup</option><option value="otp">Email code signup</option></Select><Select label="Conversion window" value={String(filters.windowDays)} onChange={v => apply({ windowDays: Number(v) })}>{[1, 7, 14].map(d => <option key={d} value={d}>{d} day{d > 1 ? "s" : ""}</option>)}</Select><Select label="Billing data" value={filters.billingMode} onChange={v => apply({ billingMode: v as TrafficFilters["billingMode"] })}><option value="live">Live only</option><option value="test">Test only</option><option value="all">Live + test</option></Select></div></div>
      <div className={s.inlineNote}><Info size={16}/><span><b>New organizations: {n(signups?.total)}</b> / {filters.from} to {filters.to}. Database count across all signup flows, billing modes and traffic sources; deleted organizations excluded. This is separate from the tracked visitor funnel below.</span></div>
      {filters.flow === "all" && <p className={s.inlineNote}>Email and Google combined, counted once per visitor. The email-only Account step is omitted because Google skips it.</p>}
      {!report.firstStepAt && !failed("overview") && <div className={s.inlineNote}><Info size={16}/><span>Step tracking starts with this release. Earlier step conversions are not available.</span></div>}
      {stepCoverageDate && coverageIncomplete && <div className={s.inlineNote}><Info size={16}/><span>Partial step coverage from {stepCoverageDate}. Entry-to-step and overall rates are hidden for this range.</span></div>}
      {filters.page && <p className={s.inlineNote}>The page filter affects audience reports, not the landing-to-signup funnel.</p>}
      <div className={s.funnelLayout}>
        <div className={s.funnelTable}><div className={s.funnelHeading}><span>Stage <em>/ select a stage to see who reached it</em></span><span>Visitors</span><span>Step rate</span><span>From landing</span></div>
          {report.funnel.map((stage, i) => {
            const untracked = !report.firstStepAt && i >= 2;
            const base = report.funnel[0]?.visitors || 0;
            const prev = report.funnel[i - 1]?.visitors || 0;
            return <button type="button" className={s.funnelRow} key={stage.id} disabled={untracked || pending} aria-pressed={drill?.id === stage.id && sheet.isOpen} aria-label={`${stage.label}: ${untracked ? "not tracked" : n(stage.visitors) + " visitors"}. Show who reached this stage.`} onClick={() => inspect(stage)}><span className={s.stage}><span className={s.stageNumber}>{String(i + 1).padStart(2, "0")}</span><span className={s.stageBody}><b>{stage.label}<ChevronRight size={15} aria-hidden="true"/></b><span className={s.funnelBar}><span style={{ width: `${untracked ? 0 : percent(stage.visitors, base) ?? 0}%` }}/></span>{i > 0 && !untracked && !(i === 2 && coverageIncomplete) && <small>{n(Math.max(0, prev - stage.visitors))} did not reach this step</small>}</span></span><strong>{untracked ? "--" : n(stage.visitors)}</strong><span>{untracked || !i || (i === 2 && coverageIncomplete) ? "--" : rate(percent(stage.visitors, prev))}</span><span>{untracked || (i >= 2 && coverageIncomplete) ? "--" : rate(percent(stage.visitors, base))}</span></button>;
          })}
          {!report.funnel.length && <div className={s.empty}>Funnel unavailable. Retry the report.</div>}
        </div>
        <aside className={s.conversionPlate}><div className={s.eyebrow}>End-to-end conversion</div><strong>{!coverageIncomplete && funnelEnd ? rate(percent(funnelEnd.visitors, report.funnel[0]?.visitors || 0)) : "--"}</strong><span>{report.firstStepAt && funnelEnd ? `${n(funnelEnd.visitors)} signups with every funnel step tracked` : "Awaiting step tracking"}</span><dl className={s.outcomes}>{([['Trial attempts', 'trialAttempts'], ['Purchase attempts', 'purchaseAttempts'], ['Trials started', 'trials'], ['Subscriptions purchased', 'purchases'], ['Other activations', 'other']] as const).map(([label, key]) => <div key={key}><dt>{label}</dt><dd>{report.firstStepAt ? n(report.funnelOutcomes?.[key]) : "--"}</dd></div>)}</dl><p>Attempt = button clicked. Verified = Stripe confirmed and account created. Missing tracking steps can exclude a real signup from this funnel.</p><p>{filters.billingMode === "live" ? "Test checkouts excluded." : filters.billingMode === "test" ? "Test checkout outcomes only." : "Live and test outcomes included."} Attempts cannot know the billing mode yet.</p><p>{filters.windowDays}-day window from the first eligible landing. Recent cohorts may still convert.</p></aside>
      </div>
      {/* Landing variant d vs e (landing-e pass A): signup starts → verified signups, per arm. */}
      {!!report.variants.length && <div className={s.tableScroll} style={{ marginTop: 18 }}><table className={s.table}><thead><tr><th>Landing variant</th><th>Signup starts</th><th>Verified signups</th><th>Start → complete</th></tr></thead><tbody>{report.variants.map(v => <tr key={v.variant}><td><b>{v.variant === "e" ? "e / landing-e" : "d / landing"}</b></td><td><b>{n(v.started)}</b></td><td>{n(v.completed)}</td><td>{coverageIncomplete ? "--" : rate(percent(v.completed, v.started))}</td></tr>)}</tbody></table></div>}
      {!!report.modes?.length && <div className={s.tableScroll} style={{ marginTop: 18 }}><table className={s.table}><thead><tr><th>Sign-up mode</th><th>Signup starts</th><th>Verified signups</th><th>Start → complete</th><th>Completions recorded</th></tr></thead><tbody>{report.modes.map(m => <tr key={m.mode}><td><b>{m.mode === "unknown" ? "Not recorded" : m.mode === "passwordless" ? "Passwordless" : m.mode === "2-step" ? "2 steps" : "3 steps"}</b></td><td><b>{n(m.started)}</b></td><td>{n(m.completed)}</td><td>{coverageIncomplete ? "--" : rate(percent(m.completed, m.started))}</td><td>{n(m.recorded)}</td></tr>)}</tbody></table></div>}
    </section>

    <div className={s.sectionLabel}><span>03 / Explore</span><span>Same date &amp; audience filters</span></div>
    <section className={s.card}>
      <div className={s.exploreTabs} aria-label="Detailed reports">{(["pages", "acquisition"] as const).map(key => <button key={key} aria-pressed={tab === key} onClick={() => setTab(key)}>{key === "pages" ? "Pages & screens" : "Acquisition"}<span>{key === "pages" ? n(report.pages.length) : n(report.sources.length)}</span></button>)}<Link className={s.button} href="/admin/ab-testing">A/B testing <ArrowUpRight size={14}/></Link></div>
      {tab === "pages" && <div className={s.exploreBody}>
        <div className={s.exploreHead}><div><h2>Page explorer</h2><p className={s.micro}>Select a row to inspect its audience and daily traffic.</p></div><div className={s.pageTools}><input type="search" aria-label="Find a page" placeholder="Find a page or screen..." value={search} onChange={e => { setSearch(e.target.value); setPageIndex(0); }}/><Select label="Sort by" value={sort} onChange={v => { setSort(v as typeof sort); setPageIndex(0); }}><option value="visitors">Visitors</option><option value="pageviews">Views</option><option value="returningVisitors">Returning</option></Select></div></div>
        <div className={s.pageShortcuts}>{pageKeys.map(p => <button key={p} aria-pressed={filters.page === p} onClick={() => apply({ page: p })}>{pageLabel(p)}</button>)}{filters.page && <button onClick={() => apply({ page: "" })}>Clear page filter</button>}</div>
        <div className={s.tableScroll}><table className={s.table}><thead><tr><th>Page / screen</th><th>Visitors</th><th>New</th><th>Returning</th><th>Repeat</th><th>Sessions</th><th>Views</th></tr></thead><tbody>{rows.slice(visiblePage * 20, (visiblePage + 1) * 20).map(p => <tr key={p.page} data-selected={filters.page === p.page}><td><button className={s.pageLink} onClick={() => apply({ page: p.page })}><span>{pageLabel(p.page)}{pageLabel(p.page) !== p.page && <small>{p.page}</small>}</span><ArrowUpRight size={15}/></button></td><td><b>{n(p.visitors)}</b></td><td>{n(p.newVisitors)}</td><td>{n(p.returningVisitors)}<small>{rate(percent(p.returningVisitors, p.visitors))}</small></td><td>{n(p.repeatVisitors)}</td><td>{n(p.sessions)}</td><td>{n(p.pageviews)}</td></tr>)}</tbody></table></div>
        {rows.length > 20 && <div className={s.pagination}><span>{visiblePage * 20 + 1}-{Math.min(rows.length, (visiblePage + 1) * 20)} of {rows.length} pages</span><button className={s.button} disabled={visiblePage === 0} onClick={() => setPageIndex(visiblePage - 1)}>Previous</button><button className={s.button} disabled={visiblePage === pageCount - 1} onClick={() => setPageIndex(visiblePage + 1)}>Next</button></div>}
        {!rows.length && <div className={s.empty}>{failed("pages") ? "Page report unavailable." : "No matching page activity in this range."}</div>}
        <p className={s.footnote}>Top 200 pages. Screen views are explicit registration events. A visitor can appear on more than one page; rows do not add up to unique site visitors.</p>
      </div>}

      {tab === "acquisition" && <div className={s.exploreBody}>
        <div className={s.exploreHead}><div><h2>Where visitors come from</h2><p className={s.micro}>Session-entry attribution / top 20 per dimension</p></div><span className={s.stamp}>Sources, not guesses</span></div>
        <div className={s.dimensionTabs}>{Object.entries(dimensions).map(([key, label]) => <button key={key} aria-pressed={dimension === key} onClick={() => setDimension(key as Dimension)}>{label}</button>)}</div>
        <div className={s.acquisitionLayout}><div className={s.tableScroll}><table className={s.table}><thead><tr><th>{dimensions[dimension]}</th><th>Visitors</th><th>Sessions</th><th>Signups</th><th>Signup rate</th></tr></thead><tbody>{acquisition.map(row => <tr key={row.name}><td><div className={s.sourceName}>{dimension === "sources" ? <button onClick={() => apply({ source: row.name })}>{row.name}<ArrowUpRight size={14}/></button> : <b>{row.name === " /  / " ? "No UTM campaign" : row.name}</b>}<div className={s.sourceBar}><span style={{ width: `${percent(row.visitors, acquisition[0]?.visitors || 1) ?? 0}%` }}/></div></div></td><td><b>{n(row.visitors)}</b></td><td>{n(row.sessions)}</td><td>{report.firstStepAt ? n(row.conversions) : "--"}</td><td>{coverageIncomplete ? "--" : rate(percent(row.conversions, row.visitors))}</td></tr>)}</tbody></table>{!acquisition.length && <div className={s.empty}>{failed("breakdowns") ? "Acquisition report unavailable." : "No recorded data for this dimension."}</div>}</div>
          <aside className={s.acquisitionNotes}><h3>What we can see</h3><p>Google, Bing, Instagram and other referrers when the browser passes them. Tagged links also carry campaign and medium.</p><h3>What stays private</h3><p>Exact organic searches and browsing history are usually not shared. Missing referrers appear as direct / unknown.</p><h3>Search terms</h3><p>Campaign terms here come from <code>utm_term</code>, not organic search queries. Connect Search Console or Bing Webmaster Tools separately for aggregate search queries.</p><a href="https://search.google.com/search-console" target="_blank" rel="noreferrer">Google Search Console <ArrowUpRight size={14}/></a><a href="https://www.bing.com/webmasters" target="_blank" rel="noreferrer">Bing Webmaster Tools <ArrowUpRight size={14}/></a></aside>
        </div>
        {signups && <>
          <div className={s.exploreHead}><div><h2>Signups by landing trade and campaign</h2><p className={s.micro}>From the database: what the landing recorded on each organization at signup / {signups.from} to {signups.to} / {n(signups.total)} signups</p></div><span className={s.stamp}>Database, not PostHog</span></div>
          <div className={s.dimensionTabs}>{Object.entries(signupDimensions).map(([key, label]) => <button key={key} aria-pressed={signupDimension === key} onClick={() => setSignupDimension(key as SignupDimension)}>{label}</button>)}</div>
          <div className={s.tableScroll}><table className={s.table}><thead><tr><th>{signupDimensions[signupDimension]}</th><th>Signups</th><th>Share</th></tr></thead><tbody>{signups.dimensions[signupDimension].map(row => <tr key={row.name}><td><b>{row.name}</b></td><td><b>{n(row.signups)}</b></td><td>{rate(percent(row.signups, signups.total))}</td></tr>)}</tbody></table>{!signups.dimensions[signupDimension].length && <div className={s.empty}>No signups in this range.</div>}</div>
        </>}
        <p className={s.footnote}>Signups are verified outcomes within the conversion window after an eligible visit. {coverageIncomplete && "Signup rates are hidden until the selected range has full tracking coverage. "}One visitor can use multiple sources. Browser privacy, consent and blockers can reduce coverage.</p>
      </div>}

    </section>
    <Sheet mdlRef={sheet.ref} title={drill ? `${drill.label} / who reached it` : "Stage visitors"} titleId="trafficStageVisitors" size="drawer" onClose={sheet.close} error={drillError || null}>
      <div className={s.drill}>
        <div className={s.drillLead}><Users size={18}/><div><strong>{drillPending ? "Loading" : n(drillReport?.total)}</strong><span>{drillPending ? "Querying PostHog..." : `visitor${drillReport?.total === 1 ? "" : "s"} reached ${drill?.label ?? "this stage"} / ${filters.from} to ${filters.to}`}</span></div></div>
        {visitors.length > 0 && <div className={s.drillSummary}>
          {([["Devices", (v: StageVisitor) => v.device], ["Countries", (v: StageVisitor) => v.country], ["Sources", (v: StageVisitor) => v.source]] as const).map(([label, pick]) => <div key={label}><h3>{label}</h3><ul>{tally(visitors, pick).map(item => <li key={item.name}><span>{item.name}</span><b>{n(item.count)}</b><i style={{ width: `${percent(item.count, visitors.length) ?? 0}%` }}/></li>)}</ul></div>)}
        </div>}
        {drillPending && <div className={s.drillSkeleton} aria-hidden="true">{[0, 1, 2, 3].map(i => <span key={i}/>)}</div>}
        {!drillPending && !drillError && drillReport && !visitors.length && <div className={s.empty}>No visitors reached this stage in the selected range.</div>}
        {visitors.length > 0 && <ol className={s.drillList} aria-label="Visitors">
          {visitors.map(v => <li key={v.id}>
            <div className={s.drillWho}><b>{[v.device, v.browser, v.os].filter(Boolean).join(" / ") || "Unknown device"}</b><span>{place(v) || "Unknown location"}</span><span>{v.source || "Direct / unknown"}{v.referrer && v.referrer !== v.source ? ` / ${v.referrer}` : ""}{v.campaign ? ` / ${v.campaign}` : ""}</span></div>
            <div className={s.drillFacts}><span><em>Reached</em>{when(v.reachedAt)}</span><span><em>Got to</em>{stageLabel(v.furthest)}</span><span><em>Activity</em>{n(v.sessions)} session{v.sessions === 1 ? "" : "s"} / {n(v.views)} view{v.views === 1 ? "" : "s"}</span>{v.personUrl && <a href={v.personUrl} target="_blank" rel="noreferrer">PostHog profile <ArrowUpRight size={13}/></a>}</div>
          </li>)}
        </ol>}
        {drillReport && drillReport.total > visitors.length && <p className={s.footnote}>Showing the {n(visitors.length)} most recent of {n(drillReport.total)}. Narrow the date range for the rest.</p>}
        <p className={s.footnote}>Device and browser come from the visitor&apos;s own browser. Location is estimated from IP address and can be approximate. Source is the first thing recorded in the landing session. Activity counts inside the {filters.windowDays}-day conversion window.</p>
      </div>
    </Sheet>
    <details className={s.methodology}><summary><Info size={15}/>Measurement notes</summary><div><DigestToggle timezone={filters.timezone}/><p><b>Counting since {TRAFFIC_SINCE_LABEL}</b> — {TRAFFIC_SINCE_WHY} (and the ad launch), from midnight America/Los_Angeles. Every visitor figure on this page counts from that date: the cards, &ldquo;visitors since {TRAFFIC_SINCE_SHORT}&rdquo;, today, the funnel, the platform cards, the map and the signup lists; the date range works inside it.</p><p><b>In-app browsers.</b> In Facebook and Instagram&apos;s in-app browsers a visitor is a click: each ad tap can arrive with a fresh cookie, so one person counts again. <b>People (est.)</b> counts address + browser ($ip + $raw_user_agent) instead, unique per day — an estimate: a household on one Wi-Fi with the same phone model counts once, a phone that changes network counts twice.</p><p><b>Visitors</b> are distinct PostHog person IDs, not guaranteed distinct humans. Separate devices or cleared cookies can count again.</p><p><b>New</b> means first observed in the selected range. <b>Returning</b> means first observed before it. <b>Repeat</b> means 2+ recorded sessions within the range, and can include new visitors.</p><p><b>Coverage</b> begins {report.firstTrackedAt?.slice(0, 10) || "when the first event arrives"}. Admin pages are excluded. Visitors are counted on www.jobflex.app and jobflex.app only (localhost when chosen); Vercel previews, pages with no hostname and bots (PostHog&apos;s bot flag, an empty or known bot user agent) never count. &ldquo;From ads&rdquo; means the visit carried utm_source or fbclid. Google signup skips the account step. Filters never reconstruct unrecorded historical events.</p><p><b>Freshness</b> Reports are cached for up to 60 seconds; ingestion may take additional time. Today, in the header and the live view alike, is the day in America/Los_Angeles, visitors and signups both; the report&apos;s dates follow the displayed timezone. All-time and today ignore page, audience, source and device filters.</p></div></details>
  </div>;
}

/** Where the signups list stood (2026-10-12): the span's numbers and the door to /admin/traffic/signups, where the list,
 *  the trials in the order they end, the seven-day calendar and the payers now live. */
function SignupsMoved({ ledger }: { ledger: SignupLedger }) {
  const sum = ledger.summary;
  return (
    <section className={s.ledger} aria-label="Signups and trials" data-signups-moved>
      <div className={s.ledgerHead}>
        <div>
          <h2>Signups &amp; trials</h2>
          <span className={s.micro}>Every signup, the trials in the order they end — card or no card — who started paying and how, and what each trial did, on their own page now.</span>
        </div>
        <div className={s.ledgerTools}>
          <Link className={s.button} href="/admin/traffic/signups" data-signups-open>Open Signups &amp; trials<ChevronRight size={15}/></Link>
        </div>
      </div>
      <div className={s.ledgerSummary}>
        <div><span>Signups · {ledger.days === 1 ? "today" : `${ledger.days} days`}</span><strong>{sum.total.toLocaleString("en-US")}</strong><small>{sum.fromAds > 0 ? `${sum.fromAds} from ads` : "none from ads"}</small></div>
        <div data-state="trial"><span>On trial</span><strong>{sum.trial}</strong><small>still deciding</small></div>
        <div data-state="paying"><span>Paying</span><strong>{sum.paying}</strong><small>subscription active</small></div>
        <div data-state="lapsed"><span>Lapsed</span><strong>{sum.lapsed}</strong><small>canceled, expired or failed</small></div>
        <div data-state="free"><span>Free plan</span><strong>{sum.free + sum.unknown}</strong><small>never upgraded</small></div>
      </div>
    </section>
  );
}
