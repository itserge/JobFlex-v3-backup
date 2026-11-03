"use client";
// LIVE NOW (2026-09-28): the people on the site this minute — where each one
// came from (an ad, tagged or not), what they are looking at, how far they
// got — and the ones who signed up, in their own colour, named after the
// account the database just made. Polls while the tab is visible; one shared
// PostHog query behind it (lib/traffic-server fetchLiveEvents).
import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { Building2, Info, KeyRound, Megaphone, MousePointerClick, PlayCircle, RefreshCw } from "lucide-react";
import { getLiveTraffic, getMapHistory, nameAdTag } from "@/actions/trafficDashboard";
import { MAP_HISTORY_LIMIT, MAP_SPANS, isAdId, mapSpanLabel, prospectsOf, type LiveReport, type LiveStage, type LiveVisitor, type MapHistory, type MapSpan, type SignupLedger } from "@/lib/traffic-live";
import { TRAFFIC_SINCE_LABEL, TRAFFIC_SINCE_MS, TRAFFIC_SINCE_SHORT } from "@/lib/traffic-visitor";
import { asOfLabel, staleLabel, type StaleNote } from "@/lib/traffic-contract";
import { dollars } from "@/lib/investorModel";
import { perAdSignupCents, type AdSpendToday } from "@/lib/adSpendTodayShared";
import { LivePlatforms } from "./live-platforms";
import { Ago, setClockPeriod } from "./ticker";
import { sameReport } from "./live-diff";
import { liveChimes, type ChimeMemory } from "@/lib/live-chimes";
import { armSound, playChime, readSoundOn, serverSoundOn, subscribeSoundOn, writeSoundOn } from "./live-sound";

/* The map is the heaviest part of the page (the world's shapes, a pin per
   visitor) and the last thing the eye reaches: it loads after the rest, in
   its own chunk (2026-10-01). */
const LiveMap = dynamic(() => import("./live-map").then((m) => m.LiveMap), { ssr: false, loading: () => <div className={s.mapLoading}>Loading the map…</div> });
import { JourneyLine } from "./journey-line";
import { FormWatchLine } from "./form-watch-line";
import { SignupRail } from "./signup-rail";
import rail from "./signup-rail.module.css";
import s from "./traffic.module.css";

/** Live mode (2026-09-30): the owner watches this while an ad runs, so the
 *  panel asks this server every 15 s instead of 45 — a switch, remembered per
 *  browser, ticking only while this tab is in front. PostHog is NOT on this
 *  clock (2026-11-02, after its query limit ran out in a quarter hour): the
 *  server asks it for the window at most once a minute and for the totals
 *  every five, whoever is watching (lib/posthog-cache), so a tick between
 *  reads brings the same answer and "updated" says when PostHog gave it. */
const LIVE_POLL_MS = 15_000;
const POLL_MS = 45_000;
const LIVE_MODE_KEY = "jf.traffic.liveMode";
const LIVE_MAP_VIEW_KEY = "jf.traffic.mapView";
type MapView = "everyone" | "prospects";
/* The map view is kept outside React (localStorage, with the page's own
   memory when storage is blocked) and read through useSyncExternalStore: the
   server paints "everyone", the browser's remembered choice takes over after
   hydration, no effect sets state. */
let viewInMemory: MapView = "everyone";
const viewListeners = new Set<() => void>();
const readMapView = (): MapView => { try { const v = window.localStorage.getItem(LIVE_MAP_VIEW_KEY); if (v === "prospects" || v === "everyone") return v; } catch { /* no storage: the page's own memory */ } return viewInMemory; };
const serverMapView = (): MapView => "everyone";
const subscribeMapView = (cb: () => void) => { viewListeners.add(cb); return () => { viewListeners.delete(cb); }; };
const writeMapView = (v: MapView) => { viewInMemory = v; try { window.localStorage.setItem(LIVE_MAP_VIEW_KEY, v); } catch { /* not worth a word to the user */ } for (const cb of viewListeners) cb(); };
const fmt = (n: number) => n.toLocaleString("en-US");
/** The window's stages in travel order; registering absorbs checkout, the
 *  same fold the map's pins use so a chip and a pin are the same colour. */
const FUNNEL: Array<[LiveStage, string]> = [
  ["browsing", "looking around"],
  ["signing-in", "signing in"],
  ["registering", "signing up"],
  ["signed-up", "signed up"],
  ["member", "members"],
];
const STAGE: Record<LiveStage, string> = { browsing: "Looking around", "signing-in": "Signing in", registering: "On the sign-up form", checkout: "At checkout · not signed up yet", "signed-up": "Signed up", member: "In the app · member" };

/** "Spent on ads today": Meta's figure (as of its last read), or what was booked, or the daily budget said as one. */
function AdSpendTile({ spend, adSignups, timezone }: { spend: AdSpendToday | null; adSignups: number; timezone: string }) {
  const per = perAdSignupCents(spend?.cents ?? null, adSignups);
  const asOf = spend?.asOf ? clock(spend.asOf, timezone) : "";
  const note = !spend ? "spend unavailable"
    : spend.source === "budget" ? "the daily budget — Meta isn't connected"
    : spend.source === "none" ? "nothing booked — add it on Investors"
    : spend.cents === null ? (spend.error ? `Meta didn't answer${asOf ? ` · last read ${asOf}` : ""}` : "reading Meta…")
    : [per !== null ? `${dollars(per)} per ad signup` : adSignups === 0 && spend.cents > 0 ? "no ad signup yet" : "",
       spend.source === "meta" ? `Meta${asOf ? `, as of ${asOf}` : ""}` : "booked on Investors"].filter(Boolean).join(" · ");
  return (
    <div data-tone="spend" data-spend-source={spend?.source ?? "none"} data-ad-spend>
      <span>{spend?.source === "budget" ? "Ad budget today" : "Spent on ads today"}</span>
      <strong>{spend && spend.cents !== null ? dollars(spend.cents) : "—"}</strong>
      <small>{note}</small>
    </div>
  );
}

/** "as of 9:41 PM" under a figure that is PostHog's last answer — why, on hover. */
function AsOf({ note, timezone }: { note?: StaleNote; timezone: string }) {
  return note ? <small data-as-of title={note.reason}>{asOfLabel(note, timezone)}</small> : null;
}

function clock(iso: string, timezone: string): string {
  try { return new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(new Date(iso)); } catch { return ""; }
}

export function LivePanel({ initial, timezone, fullHistory = false, ledger = null }: { initial: LiveReport; timezone: string; fullHistory?: boolean; ledger?: SignupLedger | null }) {
  const [report, setReport] = useState(initial);
  const [includeDev, setIncludeDev] = useState(false);
  const [adsOnly, setAdsOnly] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  /** Who the map shows (2026-10-03): the last 5 minutes (on the site now), the
   *  live half hour, or a longer span — 1 hour to a month — read as one row
   *  per person (getMapHistory) and asked again every two minutes while chosen.
   *  It opens on the 5 minutes (owner, 2026-10-14: "always open it on five
   *  minutes, not on 30") — who is here now, not who passed through. */
  const [span, setSpan] = useState<MapSpan>(5);
  const [history, setHistory] = useState<MapHistory | null>(null);
  // MAP VIEW (owner, 2026-10-02): everyone, or only the prospects — new
  // visitors trying to convert, members and customers signing in left off, a
  // signup kept for a day (lib/traffic-live prospectsOf). Remembered per
  // browser: it is a way of watching the map, not a filter on the list.
  const mapView = useSyncExternalStore(subscribeMapView, readMapView, serverMapView);
  const setMapView = writeMapView;
  /** Live mode: 15-second refresh. On unless this browser turned it off. */
  const [liveMode, setLiveMode] = useState(true);
  /** Sound (owner, 2026-10-23): a chime when a visitor reaches the checkout, a "ka-ching" on a sign-up. Remembered
   *  per browser; while it is on the poll goes on in a background tab, so the sound reaches a tab nobody is looking at. */
  const soundOn = useSyncExternalStore(subscribeSoundOn, readSoundOn, serverSoundOn);
  /** The visitor opened on the map — from a pin, or from a row of the list. */
  const [selected, setSelected] = useState<string | null>(null);
  /** A platform card pressed: the map and the list keep only its people. */
  const [platform, setPlatform] = useState<string | null>(null);
  /** Names given on this page since the last poll (2026-10-01): shown at once,
   *  and the next poll brings them back from the server anyway. "" = forgotten. */
  const [named, setNamed] = useState<Record<string, string>>({});
  // One object per change, not per render: the memoised map, cards and rows take it as a prop.
  const adNames = useMemo<Record<string, string>>(() => Object.fromEntries(Object.entries({ ...(report.adNames ?? {}), ...(history?.adNames ?? {}), ...named }).filter(([, n]) => n)), [report.adNames, history?.adNames, named]);
  const onName = useCallback(async (tag: string, name: string) => {
    const r = await nameAdTag({ tag, name });
    if (r.ok) setNamed((m) => ({ ...m, [tag]: name.trim() }));
    return r;
  }, []);
  const request = useRef(0);
  // Stable: it takes the one thing that changes as an argument, so the poll
  // below is armed once per setting, not once per tick of the clock.
  // `force` is the Refresh button: the server asks PostHog again unless it did in the last 30 s.
  const load = useCallback(async (dev: boolean, force = false) => {
    const id = ++request.current;
    setPending(true);
    try {
      const next = await getLiveTraffic({ includeDevelopment: dev, force, fullHistory });
      // Only what changed is handed down: an answer with the same visitors
      // keeps the same objects, so the map, the cards and the rows skip their
      // render (2026-10-01).
      // PostHog down (2026-10-03): the report on screen stays, dated, and the
      // poll goes on; an empty panel with a banner is for a page that has
      // nothing to show. The server does the same from its own memory — this
      // covers the instance that has none.
      if (id === request.current) { setReport((prev) => (next.status === "error" && prev.status === "ok" ? { ...prev, stale: prev.stale ?? { since: prev.fetchedAt, reason: next.message ?? "" }, totalsStale: prev.totalsStale ?? (prev.totals ? { since: prev.fetchedAt, reason: next.message ?? "" } : undefined) } : sameReport(prev, next))); setError(""); }
    } catch (err) {
      if (id === request.current) setError(err instanceof Error ? err.message : "Could not refresh the live view.");
    } finally {
      if (id === request.current) setPending(false);
    }
  }, [fullHistory]);
  // "Show full history" turned on or off above: the totals are counted again at once.
  const firstWindow = useRef(true);
  useEffect(() => {
    if (firstWindow.current) { firstWindow.current = false; return; }
    void load(includeDev);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the window switch reloads here
  }, [fullHistory]);

  // The switch is remembered per browser. Read after mount so the server and
  // the first client render agree.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(LIVE_MODE_KEY);
      if (saved === "off") setLiveMode(false);
    } catch { /* private browsing: live mode simply stays on */ }
  }, []);
  const toggleLiveMode = (on: boolean) => {
    setLiveMode(on);
    try { window.localStorage.setItem(LIVE_MODE_KEY, on ? "on" : "off"); } catch { /* not worth a word to the user */ }
    if (on) void load(includeDev);
  };
  // Poll while the tab is in front — paused behind it, unless the sound is on (owner, 2026-10-23: the chime is for
  // a tab nobody looks at); a tab brought back refreshes at once. Either way PostHog is asked on the server's
  // clock, not this one. The "n s ago" figures tick on their own, ten seconds at a time.
  useEffect(() => {
    const every = liveMode ? LIVE_POLL_MS : POLL_MS;
    const poll = window.setInterval(() => { if (document.visibilityState === "visible" || soundOn) void load(includeDev); }, every);
    // In live mode the "n s ago" figures keep up with the poll; the shared
    // clock (./ticker) moves only those labels, and stops in a hidden tab.
    setClockPeriod(liveMode ? 1_000 : 10_000);
    const onVisible = () => { if (document.visibilityState === "visible") void load(includeDev); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.clearInterval(poll); document.removeEventListener("visibilitychange", onVisible); };
  }, [includeDev, liveMode, load, soundOn]);

  // What each poll brings that is new — someone at the checkout, a sign-up (lib/live-chimes). Remembered whether
  // the sound is on or not, so switching it on never plays for people already on the page.
  const chimeMemory = useRef<ChimeMemory | null>(null);
  /** When this page opened: what happened before it never sounds, even when a cached first report missed it. */
  const openedAt = useRef(0);
  useEffect(() => {
    if (report.status !== "ok") return;
    if (!openedAt.current) openedAt.current = Date.now();
    const { memory, chimes } = liveChimes(chimeMemory.current, report, openedAt.current);
    chimeMemory.current = memory;
    if (!soundOn || !chimes.length) return;
    const signup = chimes.some((c) => c.kind === "signup");
    const card = chimes.some((c) => c.kind === "card");
    if (signup) playChime("signup");
    if (card) window.setTimeout(() => playChime("card"), signup ? 900 : 0);
  }, [report, soundOn]);
  // A browser plays nothing until the page is touched: after a reload with the sound on, the first tap or key arms it.
  useEffect(() => {
    if (!soundOn) return;
    armSound();
    window.addEventListener("pointerdown", armSound);
    window.addEventListener("keydown", armSound);
    return () => { window.removeEventListener("pointerdown", armSound); window.removeEventListener("keydown", armSound); };
  }, [soundOn]);
  const toggleSound = (on: boolean) => {
    writeSoundOn(on);
    if (on) { armSound(); playChime("signup"); }
  };

  // A longer span: its own query, cached on the server for minutes; asked when
  // the span is chosen and every two minutes while it stays chosen and in front.
  const historyRequest = useRef(0);
  const loadHistory = useCallback(async (minutes: MapSpan, dev: boolean) => {
    const id = ++historyRequest.current;
    try {
      const next = await getMapHistory({ minutes, includeDevelopment: dev, fullHistory });
      if (id === historyRequest.current) setHistory((prev) => (next.status === "error" && prev?.status === "ok" && prev.minutes === minutes ? { ...prev, stale: { since: prev.fetchedAt, reason: next.message ?? "" } } : next));
    } catch (err) {
      if (id === historyRequest.current) setHistory({ status: "error", message: err instanceof Error ? err.message : "Could not load the map.", minutes, visitors: [], truncated: false, adNames: {}, fetchedAt: new Date().toISOString() });
    }
  }, [fullHistory]);
  useEffect(() => {
    if (span < 60) return;
    const first = window.setTimeout(() => void loadHistory(span, includeDev), 0);
    const poll = window.setInterval(() => { if (document.visibilityState === "visible") void loadHistory(span, includeDev); }, 120_000);
    return () => { window.clearTimeout(first); window.clearInterval(poll); };
  }, [span, includeDev, loadHistory]);

  const c = report.counts;
  // Today against the same hour yesterday — the only honest comparison while
  // the day is still running. Null when yesterday had nobody to divide by.
  const t = report.totals;
  const trend = t && t.yesterdaySoFar > 0 ? Math.round(((t.today - t.yesterdaySoFar) / t.yesterdaySoFar) * 100) : null;
  // A day two hours old explains a small number better than any comparison.
  const youngDay = report.dayAgeMinutes < 120;
  const dayAge = report.dayAgeMinutes < 60 ? `${Math.max(1, report.dayAgeMinutes)} min` : `${Math.floor(report.dayAgeMinutes / 60)} h`;
  const rows = useMemo(() => report.visitors.filter((v) => (!adsOnly || v.fromAd || v.stage === "signed-up") && (!platform || v.platform === platform)), [report.visitors, adsOnly, platform]);
  const longSpan = span >= 60;
  const historyReady = longSpan && history?.minutes === span;
  // A span reaching back past the ad launch counts from it, as the whole page
  // does — so 7 days and a month read the same until the launch is that old.
  const spanFromLaunch = historyReady && !!history && !fullHistory && Date.parse(history.fetchedAt) - span * 60_000 < TRAFFIC_SINCE_MS;
  const onMap = useMemo(() => {
    if (longSpan) {
      // The span's people, through the same filters as the list; their own
      // converts are already among them, so nothing is merged in.
      const spanRows = (historyReady && history ? history.visitors : []).filter((v) => (!adsOnly || v.fromAd || v.stage === "signed-up") && (!platform || v.platform === platform));
      return mapView === "prospects" ? prospectsOf(spanRows, []) : spanRows;
    }
    const inWindow = rows.filter((v) => span === 30 || v.active);
    if (mapView !== "prospects") return inWindow;
    // The day's converts follow the platform card, never the span: they stay a day.
    return prospectsOf(inWindow, report.converted.filter((v) => !platform || v.platform === platform));
  }, [longSpan, historyReady, history, adsOnly, rows, span, mapView, report.converted, platform]);
  const converts = useMemo(() => onMap.filter((v) => v.stage === "signed-up").length, [onMap]);
  // The signups the live poll knows — the window's and the day's — for the
  // rail beside the map (2026-10-04): a new one there makes the rail re-read.
  const liveSignups = useMemo(() => {
    const seen = new Set<string>();
    const out: LiveVisitor[] = [];
    for (const v of [...report.visitors.filter((x) => x.stage === "signed-up"), ...report.converted]) {
      const k = v.signup?.ownerEmail?.toLowerCase() || v.id;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(v);
    }
    return out;
  }, [report.visitors, report.converted]);
  const toggleRow = useCallback((id: string) => setSelected((cur) => (cur === id ? null : id)), []);
  const live = report.status === "ok";
  return <section className={s.live} aria-label="Live now" data-state={report.status} aria-busy={pending}>
    <div className={s.liveHead}>
      <div className={s.liveTitle}><span className={s.livePulse} data-on={live && c.onSite > 0}/><h2>Live now</h2><span className={s.micro}>Last {report.activeMinutes} minutes on the site · seen within {report.windowMinutes} · {liveMode ? `live — every ${LIVE_POLL_MS / 1000} s` : `every ${POLL_MS / 1000} s`} {soundOn ? "— sound on, also in the background" : "while this tab is open"} · updated <Ago iso={report.fetchedAt}/></span></div>
      <div className={s.liveTools}>
        <label className={s.liveToggle} data-live={liveMode} title={`Refresh every ${LIVE_POLL_MS / 1000} seconds instead of ${POLL_MS / 1000} — PostHog itself is read once a minute`}><input type="checkbox" checked={liveMode} onChange={(e) => toggleLiveMode(e.target.checked)}/>Live · {LIVE_POLL_MS / 1000} s</label>
        <label className={s.liveToggle} data-live={soundOn} data-sound-toggle title="A chime when someone reaches the checkout (entering a card), a ka-ching when someone signs up — and it keeps checking while this tab is in the background"><input type="checkbox" checked={soundOn} onChange={(e) => toggleSound(e.target.checked)}/>Sound</label>
        <label className={s.liveToggle}><input type="checkbox" checked={adsOnly} onChange={(e) => setAdsOnly(e.target.checked)}/>From ads only</label>
        <label className={s.liveToggle}><input type="checkbox" checked={includeDev} onChange={(e) => { setIncludeDev(e.target.checked); void load(e.target.checked); }}/>Include localhost</label>
        <button type="button" className={s.iconButton} aria-label="Refresh live view" title="Ask PostHog again now (at most every 30 s)" onClick={() => void load(includeDev, true)} disabled={pending}><RefreshCw size={16} className={pending ? s.spin : ""}/></button>
      </div>
    </div>
    {/* ONE stat row (2026-10-01). It used to be two — four totals over six
        live counters — which on a quiet morning was ten zeros in a grid and
        read as a broken page. Four tiles now, each with the figure that
        gives it meaning underneath, and a sentence under the lot. */}
    <div className={s.liveTotals}>
      <div data-tone="now">
        <span>On the site now</span>
        <strong>{fmt(c.onSite)}</strong>
        <AsOf note={report.stale} timezone={timezone}/>
        <small>{c.fromAds > 0 ? `${fmt(c.fromAds)} from ads` : "none from ads"}{c.signingUp > 0 ? ` · ${fmt(c.signingUp)} signing up` : ""}</small>
      </div>
      <div data-tone="lead">
        <span>Visitors today</span>
        <strong>{t ? fmt(t.today) : "—"}</strong>
        <AsOf note={report.totalsStale} timezone={timezone}/>
        <small data-trend={trend === null ? "flat" : trend > 0 ? "up" : trend < 0 ? "down" : "flat"}>
          {!t ? "totals unavailable"
            : youngDay ? `the day is ${dayAge} old`
            : trend === null ? "nothing at this hour yesterday to compare"
            : trend === 0 ? "level with this time yesterday"
            : `${trend > 0 ? "+" : "−"}${Math.abs(trend)}% vs this time yesterday`}
        </small>
      </div>
      <div data-tone="ok">
        <span>Signed up today</span>
        <strong>{fmt(report.today.signups)}</strong>
        <small>{report.today.signups > 0 ? `${fmt(report.today.fromAds)} from ads` : t && t.today > 0 ? `${fmt(t.today)} visitors, none yet` : "none yet"}</small>
      </div>
      {/* Spent on ads today (owner, 2026-10-15), right after the signups it bought. */}
      <AdSpendTile spend={report.adSpend ?? null} adSignups={report.today.fromAds} timezone={timezone}/>
      <div data-tone="mute">
        <span>Visitors since {TRAFFIC_SINCE_SHORT}</span>
        <strong>{t ? fmt(t.allTime) : "—"}</strong>
        <AsOf note={report.totalsStale} timezone={timezone}/>
        <small>{t ? `${fmt(t.last7Days)} in the last 7 days · ${fmt(t.yesterday)} yesterday` : "totals unavailable"}</small>
      </div>
    </div>
    {/* What all of that actually means, in a sentence. */}
    {live && report.headline && <p className={s.liveHeadline}>{report.headline}</p>}
    {/* The window, as one coloured line instead of five tiles — the same
        colours the map's pins use. */}
    {live && <div className={s.liveFunnel} aria-label={`The last ${report.windowMinutes} minutes`}>
      <span className={s.liveFunnelLead}>Last {report.windowMinutes} min · {fmt(report.visitors.length)}</span>
      {FUNNEL.map(([stage, label]) => {
        const n = report.visitors.filter((v) => v.stage === stage || (stage === "registering" && v.stage === "checkout")).length;
        return <span key={stage} className={s.liveFunnelStep} data-stage={stage} data-zero={n === 0}><i aria-hidden="true"/>{label}<b>{fmt(n)}</b></span>;
      })}
    </div>}
    {(error || (report.message && !report.stale)) && <div className={s.notice} role="status"><Info size={16}/><div><strong>{error || report.message}</strong></div></div>}
    {live && <>
      {/* The platforms: a card each, the ad platforms always; pressed, a filter. */}
      <LivePlatforms platforms={report.platforms} selected={platform} onSelect={setPlatform} adNames={adNames}/>
      {/* The map: where everyone is, a pin per visitor in the stage colours. */}
      <div className={s.liveSpan} role="group" aria-label="Who the map shows">
        <div className={s.dimensionTabs} style={{ margin: 0 }} role="group" aria-label="Map view">
          <button type="button" aria-pressed={mapView === "everyone"} onClick={() => setMapView("everyone")}>Everyone</button>
          <button type="button" aria-pressed={mapView === "prospects"} onClick={() => setMapView("prospects")} title="New visitors trying to convert — no members, no one signing in; a signup stays on the map for a day">Prospects</button>
        </div>
        <div className={s.dimensionTabs} style={{ margin: 0 }} role="group" aria-label="How far back the map looks">
          {MAP_SPANS.map((m) => <button key={m} type="button" aria-pressed={span === m} onClick={() => setSpan(m)}>{mapSpanLabel(m)}</button>)}
        </div>
        <span>{mapView === "prospects"
          ? `${onMap.length} ${onMap.length === 1 ? "prospect" : "prospects"} on the map · ${converts} signed up in the last ${longSpan ? spanWords(span) : "24 h"}`
          : `${onMap.length} ${onMap.length === 1 ? "visitor" : "visitors"} on the map${longSpan ? ` · last ${spanWords(span)}` : ""}`}{platform ? ` · ${report.platforms.find((p) => p.platform === platform)?.name ?? platform} only` : ""}</span>
        {longSpan && (!historyReady ? <span data-map-span-state="loading">Loading the last {spanWords(span)}…</span>
          : history && history.status !== "ok" ? <span data-map-span-state="error">{history.message}</span>
          : history?.stale ? <span data-map-span-state="stale">{staleLabel(history.stale, timezone)}</span>
          : history?.truncated ? <span data-map-span-state="truncated">The newest {MAP_HISTORY_LIMIT.toLocaleString("en-US")} people</span> : null)}
        {spanFromLaunch && <span data-map-span-state="since">Counted from {TRAFFIC_SINCE_LABEL}, the day the live map started</span>}
        {platform && <button type="button" className={s.textButton} onClick={() => setPlatform(null)}>Show everyone</button>}
      </div>
      {/* The map across the whole width (owner, 2026-10-07: "the map more
          visual, the activity under it"); the signups rail that stood beside
          it (./signup-rail, 2026-10-04) now stands beside the visitor list. */}
      <div className={rail.mapRow}>
        <div className={rail.mapCol}>
          <LiveMap visitors={onMap} selected={selected} onSelect={setSelected} timezone={timezone} adNames={adNames} view={mapView}/>
        </div>
      </div>
    </>}
    <div className={rail.activityRow} data-activity>
    <div className={rail.listCol}>
    {live && <div className={s.activityHead}><h3>Who is on the site</h3><span className={s.micro}>{fmt(rows.length)} {rows.length === 1 ? "visitor" : "visitors"} in the last {report.windowMinutes} min · newest move first · click a line to see it on the map</span></div>}
    {live && !rows.length && <div className={s.liveEmpty}>{report.visitors.length ? (platform ? "Nobody from this platform in the last half hour — press the card again to see everyone." : "Nobody from an ad in the last half hour — turn off the ads filter to see everyone.") : `Nobody on the site in the last ${report.windowMinutes} minutes.`}</div>}
    {rows.length > 0 && <ol className={s.liveList} aria-label="Visitors on the site">
      {rows.map((v) => <LiveRow key={v.id + v.firstAt} v={v} timezone={timezone} selected={selected === v.id} onToggle={toggleRow} adNames={adNames} onName={onName} replayBase={report.replayBase ?? null}/>)}
    </ol>}
    {report.otherSignups.length > 0 && <div className={s.liveOthers}><span className={s.micro}>Signed up today, outside the last {report.windowMinutes} minutes or with analytics blocked — the live list above only holds the window, this holds the day:</span>{report.otherSignups.map((o) => <span key={o.orgName + o.at} className={s.liveOther}><b>{o.orgName}</b> · {o.ownerEmail || "no owner yet"} · {o.source} · {clock(o.at, timezone)} <b className={s.livePlan}>{o.planLabel}</b></span>)}</div>}
    </div>
    {live && <div className={rail.railCol}>
      <SignupRail initial={ledger} timezone={timezone} fullHistory={fullHistory} liveSignups={liveSignups} adNames={adNames}/>
    </div>}
    </div>
    <p className={s.footnote}>One line per browser (a PostHog person), newest move first, signups on top; a click on a line shows it on the map. Source is what the first page of the visit carried: it is from an ad only when it carried utm_source or fbclid — a Facebook, Instagram or TikTok link with neither is that platform&apos;s link, not an ad. Colour is how far they got, and each stage has its own: crimson looking around, cyan signing in, amber on the sign-up form or at checkout, green signed up, near-black already a member. A visitor at the login, forgot-password or reset screen is an existing customer, counted as signing in rather than browsing; "locked out" means they asked for a reset link. Places come from PostHog&apos;s GeoIP reading of the browser&apos;s address — the town is usually right, the street never known. A signup is named after the organization created within fifteen minutes of it with the same campaign tag.</p>
  </section>;
}

/** "hour", "4 hours", "day", "3 days", "month" — the span in a sentence. */
function spanWords(m: MapSpan): string {
  if (m === 60) return "hour";
  if (m < 1440) return m < 60 ? `${m} min` : `${m / 60} hours`;
  if (m === 1440) return "day";
  if (m === 43200) return "month";
  return `${m / 1440} days`;
}

/** An ad or campaign tag, by the owner's name when it has one (2026-10-01).
 *  Meta sends {{campaign.id}} / {{ad.id}} as long numbers; "Name it" turns
 *  one into "Roofing · 40 s v1" for every row, card and pin from then on. */
function AdTag({ tag, adNames, onName }: { tag: string; adNames: Record<string, string>; onName: (tag: string, name: string) => Promise<{ ok: boolean; error?: string }> }) {
  const name = adNames[tag] ?? "";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const save = async () => {
    setBusy(true); setErr("");
    const r = await onName(tag, draft);
    setBusy(false);
    if (r.ok) setEditing(false); else setErr(r.error ?? "Not saved");
  };
  if (editing) {
    return <span className={s.adNameEdit} onClick={(e) => e.stopPropagation()}>
      <input autoFocus value={draft} maxLength={60} placeholder="Roofing · 40 s v1" aria-label={`Name for ${tag}`} disabled={busy}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") void save(); if (e.key === "Escape") setEditing(false); }}/>
      <button type="button" onClick={() => void save()} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
      <button type="button" onClick={() => setEditing(false)} disabled={busy}>Cancel</button>
      {err && <i>{err}</i>}
    </span>;
  }
  return <span className={s.adTag}>
    {" · "}{name ? <><b>{name}</b><span className={s.adId}>{tag}</span></> : tag}
    {(name || isAdId(tag)) && <button type="button" className={s.adNameBtn} onClick={(e) => { e.stopPropagation(); setDraft(name); setEditing(true); }}>{name ? "Rename" : "Name it"}</button>}
  </span>;
}

/** One visitor. Memoised: between refreshes only its "n s ago" moves, and that is the shared clock's. */
const LiveRow = memo(function LiveRow({ v, timezone, selected, onToggle, adNames, onName, replayBase }: { v: LiveVisitor; timezone: string; selected: boolean; onToggle: (id: string) => void; adNames: Record<string, string>; onName: (tag: string, name: string) => Promise<{ ok: boolean; error?: string }>; replayBase: string | null }) {
  const replay = replayBase && v.session ? `${replayBase}${encodeURIComponent(v.session)}` : null;
  // A row is a click away from its pin on the map (and back).
  return <li className={s.liveRow} data-live-row data-stage={v.stage} data-active={v.active} data-ad={v.fromAd} data-selected={selected} onClick={() => onToggle(v.id)} title={v.lat !== null ? "Show on the map" : "No known place for this visitor"}>
    <div className={s.liveMark} aria-hidden="true"/>
    <div className={s.liveWho}>
      <b>{STAGE[v.stage]}{v.signup ? ` → ${v.signup.orgName}` : v.member ? ` → ${v.member.orgName}` : ""}</b>
      {/* A signed-in member: the company and the person (2026-10-01). */}
      {!v.signup && v.member && <span className={s.liveSignup}><Building2 size={11}/> {v.member.orgName}{v.member.userName ? ` · ${v.member.userName}` : ""}</span>}
      {v.signup && <span className={s.liveSignup}>
        {v.signup.ownerName ? `${v.signup.ownerName} · ` : ""}{v.signup.ownerEmail} · account made {clock(v.signup.at, timezone)}
        {/* What they signed up FOR, read from the subscription row — the
            event's own `plan` is only what the page offered. */}
        <b className={s.livePlan}>{v.signup.planLabel}</b>
      </span>}
      {!v.signup && v.stage === "signed-up" && v.signedUpAt && <span className={s.liveSignup}>Verified at {clock(v.signedUpAt, timezone)} · no organization row matched yet</span>}
      <span className={s.liveSource}>
        {v.fromAd && <em className={s.liveAd}><Megaphone size={11}/>Ad</em>}
        {/* Locked out is its own chip: the one state that wants a person,
            not a nudge. */}
        {v.lockedOut && <em className={s.liveLocked}><KeyRound size={11}/>Locked out</em>}
        {v.source}
        {/* The trade the ad sent them to (the landing's ?industry=). */}
        {v.trade && <em className={s.liveTrade}>{v.trade}</em>}
        {v.campaign && <AdTag tag={v.campaign} adNames={adNames} onName={onName}/>}
        {v.content && v.content !== v.campaign && <AdTag tag={v.content} adNames={adNames} onName={onName}/>}
      </span>
    </div>
    <div className={s.liveWhere}>
      <b>{v.pageLabel}</b>
      <span>{v.views} {v.views === 1 ? "page" : "pages"}</span>
      {/* The visit as a line: each step in its stage colour, running while they are on the site. */}
      <JourneyLine steps={v.steps} live={v.active}/>
      {/* What they pressed — only the landing's tagged buttons fire this, so
          an empty line means "nothing we track", not "they clicked nothing". */}
      {v.clicks.length > 0 && <span className={s.liveClicks}>
        <MousePointerClick size={11}/>
        {v.clicks.map((c) => `“${c.label}”${c.placement ? ` · ${c.placement.replace(/[-_]/g, " ")}` : ""}`).join("  ·  ")}
      </span>}
      {/* The visit in one sentence, so the trail above does not have to be
          decoded by eye. */}
      {v.summary && <span className={s.liveSummary}>{v.summary}</span>}
      {/* The sign-up form, as its watcher saw it (2026-10-14): the box, the problems and whose side, the leave. */}
      {v.form && <FormWatchLine f={v.form} active={v.active} timezone={timezone}/>}
      {replay && <a className={s.liveReplay} href={replay} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} data-replay><PlayCircle size={12}/>Watch the replay</a>}
    </div>
    <div className={s.liveWhen}>
      <b>{v.active ? (v.form?.away ? "Away from the tab" : "On the site now") : v.form?.left?.kind === "closed" ? "Closed the page" : "Left"}</b>
      <span><Ago iso={v.lastAt}/> · since {clock(v.firstAt, timezone)}</span>
      <span>{[v.device, v.browser].filter(Boolean).join(" / ") || "Unknown device"}{v.place ? ` · ${v.place}` : ""}{v.environment === "development" ? " · localhost" : ""}</span>
    </div>
  </li>;
});
