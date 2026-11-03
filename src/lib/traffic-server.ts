import type { ExperimentResult, StaleNote, StageVisitor, StageVisitorsReport, TrafficBreakdown, TrafficDaily, TrafficFilters, TrafficReport, TrafficTotals } from "./traffic-contract";
import { experimentResultFromRow } from "./traffic-contract";
import { buildExperimentsQuery, buildStageVisitorsQuery, buildTrafficQueries, funnelStages, shiftDate } from "./traffic-query";
import { CONVERTED_HOURS, MAP_HISTORY_LIMIT, buildLiveQuery, buildInvestorVisitorsQuery, buildLiveTotalsQuery, buildMapHistoryQuery, convertedOf, liveEventFromRow, liveHeadline, liveTotalsFromRow, mapHistoryEventsFromRow, minutesIntoDay, shapeLive, shortId, type FreshSignup, type LiveEvent, type LiveReport, type LiveTotalsPair, type MapHistory, type MapSpan } from "./traffic-live";
import { analystSessionFromRow, buildAnalystQuery, type LandingSession } from "./traffic-analyst";
import { buildDropoffQuery, buildDropoffReport, dropoffVisitFromRow, type DropoffReport, type DropoffVisit } from "./signup-dropoff";
import { TRAFFIC_TZ } from "./traffic-visitor";
import { POSTHOG_TTL, cachedRows, type CachedRows, type Rows } from "./posthog-cache";

// Every answer below is PostHog's, kept by lib/posthog-cache (2026-11-02): one
// query per answer per TTL, whoever asks — tabs, admins, instances, crons — and
// the last answer, dated, when PostHog does not give a new one.

/** "Live now": the window's events and the day's converts, one query
 *  (lib/traffic-live buildLiveQuery), at most once a minute — the page still
 *  asks this server every 15 s and gets the minute's answer. */
const liveRead = (force = false, maxAgeMs: number = POSTHOG_TTL.live) => cachedRows("live", maxAgeMs, () => runTrafficQuery(buildLiveQuery(), "live"), { force });
const eventsOf = (rows: Rows) => rows.map(liveEventFromRow).filter((e): e is LiveEvent => !!e);
/** The live rows as events. A caller content with an older answer (the surge cron) says how old — it then reads
 *  the minute an open /admin/traffic stored instead of asking PostHog itself. */
export async function fetchLiveEvents(maxAgeMs: number = POSTHOG_TTL.live): Promise<LiveEvent[]> {
  return eventsOf((await liveRead(false, maxAgeMs)).rows);
}

/** THE ANALYST's sessions (2026-10-02): the last week of landing visits,
 *  one row each — the reading does not change by the minute, and the query
 *  walks a week of events. */
/** The sessions and when PostHog answered for them (2026-10-04): a cached
 *  week is up to half an hour old, and "read at" must say so. */
export interface AnalystRead { sessions: LandingSession[]; readAt: string; stale: StaleNote | null }
export async function fetchAnalystSessions(force = false): Promise<AnalystRead> {
  const read = await cachedRows("analyst", POSTHOG_TTL.history, () => runTrafficQuery(buildAnalystQuery(), "analyst"), { force });
  return { sessions: read.rows.map(analystSessionFromRow).filter((s): s is LandingSession => !!s), readAt: new Date(read.at).toISOString(), stale: read.stale };
}

/** WHERE SIGN-UPS STOP (2026-10-14): the week's or the month's sign-up visits, one row each, read into the report
 *  under the live map — the form's numbers do not move while someone reads them. */
export interface DropoffRead { report: DropoffReport; readAt: string; stale: StaleNote | null }
export async function fetchSignupDropoff(days: number, force = false): Promise<DropoffRead> {
  const scope = process.env.NODE_ENV === "production" ? "production" : "with-local";
  const read = await cachedRows(`signup dropoff|${days}|${scope}`, POSTHOG_TTL.history, () => runTrafficQuery(buildDropoffQuery(days, scope), "signup dropoff"), { force });
  return { report: buildDropoffReport(read.rows.map(dropoffVisitFromRow).filter((v): v is DropoffVisit => !!v), days, read.at), readAt: new Date(read.at).toISOString(), stale: read.stale };
}

/** The site-wide totals (all-time, today, this time yesterday, seven days) —
 *  one query for all four figures. Five minutes, not the live minute: the
 *  query reads every event in the project, and an all-time count does not
 *  move while someone watches a 15-second ticker. Keyed by timezone, because
 *  "today" is; the office screen reads the same answer. */
async function totalsRead(timezone: string, fullHistory = false, force = false): Promise<{ value: LiveTotalsPair; stale: StaleNote | null }> {
  const tz = timezone || "UTC";
  const read = await cachedRows(`live totals|${tz}|${fullHistory ? "full" : "since"}`, POSTHOG_TTL.today, () => runTrafficQuery(buildLiveTotalsQuery(tz, fullHistory), "live totals"), { force });
  return { value: liveTotalsFromRow(Array.isArray(read.rows[0]) ? read.rows[0] : []), stale: read.stale };
}
export async function fetchLiveTotals(timezone: string, fullHistory = false): Promise<LiveTotalsPair> {
  return (await totalsRead(timezone, fullHistory)).value;
}

/** THE INVESTORS' VISITORS (2026-10-06): unique visitors from the owner's
 *  chosen start day, and the first day a visitor came from an ad — the hint
 *  beside the "Counting from" field. Cached like the totals, per day asked. */
export interface InvestorVisitors { visitors: number; firstAdDay: string | null }
export async function fetchInvestorVisitors(sinceDate: string, timezone = TRAFFIC_TZ): Promise<InvestorVisitors> {
  const read = await cachedRows(`investor visitors|${sinceDate}|${timezone}`, POSTHOG_TTL.today, () => runTrafficQuery(buildInvestorVisitorsQuery(timezone, sinceDate), "investor visitors"));
  const row: unknown[] = Array.isArray(read.rows[0]) ? read.rows[0] : [];
  const v = Number(row[0]);
  const d = typeof row[1] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row[1]) && row[1] >= "2020-01-01" ? row[1] : null;
  return { visitors: Number.isFinite(v) && v > 0 ? Math.round(v) : 0, firstAdDay: d };
}

/** The map over a longer span (2026-10-03, lib/traffic-live buildMapHistoryQuery):
 *  one row per person, cached per span — a month's query reads every event,
 *  so a span up to a day is asked at most every five minutes, a longer one
 *  every half hour, whoever is watching. Each answer shapes the rows with its
 *  own signups, as of the read. */
const mapHistoryTtl = (minutes: number) => (minutes <= 1440 ? POSTHOG_TTL.today : POSTHOG_TTL.history);
export async function getMapHistory(minutes: MapSpan, signups: FreshSignup[], opts: { includeDevelopment?: boolean; fullHistory?: boolean } = {}): Promise<Omit<MapHistory, "adNames">> {
  const fetchedAt = new Date().toISOString();
  const empty = { minutes, visitors: [], truncated: false, fetchedAt };
  try {
    if (!posthogApiConfig()) return { ...empty, status: "disabled", message: "Connect a PostHog personal key with query:read and a numeric project ID." };
  } catch (err) { return { ...empty, status: "error", message: (err as Error).message }; }
  const key = `${minutes}|${opts.includeDevelopment ? 1 : 0}|${opts.fullHistory ? 1 : 0}`;
  try {
    // PostHog down: the span as it last read, and from when.
    const read = await cachedRows(`map history|${key}`, mapHistoryTtl(minutes), () => runTrafficQuery(buildMapHistoryQuery(minutes, opts), "map history"));
    const events: LiveEvent[] = [];
    const views = new Map<string, number>();
    for (const row of read.rows) {
      const h = Array.isArray(row) ? mapHistoryEventsFromRow(row) : null;
      if (!h) continue;
      events.push(...h.events);
      views.set(shortId(h.person), h.views);
    }
    // PostHog already held the rows to the span; the slack keeps a first
    // touch at its edge (and its ad tag) while the rows sit in the cache.
    const shaped = shapeLive(events, signups, read.at, { ...opts, windowMinutes: minutes + 10 });
    // The row's own pageview count; the events stand in for the visit, not for every page.
    const visitors = shaped.visitors.map((v) => ({ ...v, views: views.get(v.id) ?? v.views }));
    return { ...empty, status: "ok", visitors, truncated: read.rows.length >= MAP_HISTORY_LIMIT, fetchedAt: new Date(read.at).toISOString(), ...(read.stale ? { stale: read.stale } : {}) };
  } catch (err) {
    const msg = err instanceof Error && err.name === "TimeoutError" ? "PostHog took too long. Try a shorter span." : err instanceof Error ? err.message : "The map is unavailable.";
    return { ...empty, status: "error", message: msg };
  }
}

/** The live report: the window's visitors shaped with the day's signups.
 *  `force` is the Refresh button: PostHog is asked again unless it was in the last 30 s. */
export async function getLiveTraffic(signups: FreshSignup[], opts: { includeDevelopment?: boolean; fullHistory?: boolean; force?: boolean } = {}): Promise<LiveReport> {
  const fetchedAt = new Date().toISOString();
  try {
    if (!posthogApiConfig()) return { ...shapeLive([], signups, Date.now(), opts), status: "disabled", message: "Connect a PostHog personal key with query:read and a numeric project ID.", fetchedAt };
  } catch (err) { return { ...shapeLive([], signups, Date.now(), opts), status: "error", message: (err as Error).message, fetchedAt }; }
  // The totals must never take the live view down with them: a failure
  // there leaves the window intact with the totals it last read, or — with
  // none to fall back on — the panel simply prints no totals.
  const totalsP = totalsRead(TRAFFIC_TZ, !!opts.fullHistory, opts.force).catch(() => null);
  let live: CachedRows;
  try {
    live = await liveRead(opts.force);
  } catch (err) {
    await totalsP;
    // Nothing ever read: the one case for the banner.
    const msg = err instanceof Error && err.name === "TimeoutError" ? "PostHog took too long. Try again shortly." : err instanceof Error ? err.message : "Live view unavailable.";
    return { ...shapeLive([], signups, Date.now(), opts), status: "error", message: msg, fetchedAt };
  }
  const totalsAnswer = await totalsP;
  const pair = totalsAnswer?.value ?? null;
  const totals = pair ? (opts.includeDevelopment ? pair.all : pair.production) : null;
  // An old answer is shaped as of its read, so the window is the one PostHog
  // last showed — not one emptied by the time that has passed since.
  const now = live.stale ? live.at : Date.now();
  const events = eventsOf(live.rows);
  const shaped = shapeLive(events, signups, now, opts);
  // The day's converts, shaped the same way over a day-long window and kept
  // only where the signup is on the record; the prospects map merges them.
  const converted = shapeLive(convertedOf(events), signups, now, { ...opts, windowMinutes: CONVERTED_HOURS * 60 }).visitors.filter((v) => v.stage === "signed-up");
  const dayAgeMinutes = minutesIntoDay(TRAFFIC_TZ);
  // The busiest platform of the window, for the sentence.
  const top = [...shaped.platforms].sort((a, b) => b.visitors - a.visitors)[0];
  const headline = liveHeadline({
    onSite: shaped.counts.onSite,
    fromAds: shaped.counts.fromAds,
    signingUp: shaped.counts.signingUp,
    windowVisitors: shaped.visitors.length,
    windowMinutes: shaped.windowMinutes,
    todayVisitors: totals ? totals.today : null,
    todaySignups: shaped.today.signups,
    yesterdaySoFar: totals ? totals.yesterdaySoFar : null,
    yesterdayTotal: totals ? totals.yesterday : null,
    dayAgeMinutes,
    topPlatform: top && top.visitors > 0 ? { name: top.name, visitors: top.visitors } : null,
  });
  // The session replays (2026-10-14): PostHog's own player for the visit, one click from its line.
  const cfg = posthogApiConfig();
  const replayBase = cfg ? `${cfg.host}/project/${cfg.id}/replay/` : null;
  // "Updated" is when PostHog answered, not when this server was asked.
  return {
    ...shaped, converted, totals, dayAgeMinutes, headline, status: "ok", fetchedAt: new Date(live.at).toISOString(), replayBase,
    ...(live.stale ? { stale: live.stale } : {}),
    ...(totalsAnswer?.stale ? { totalsStale: totalsAnswer.stale } : {}),
  };
}

const numeric = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0;
const daily = (r: unknown[]): TrafficDaily => ({ people: numeric(r[0]), inAppVisitors: numeric(r[1]), inAppPeople: numeric(r[2]), adsFb: numeric(r[3]), adsIg: numeric(r[4]), adsAn: numeric(r[5]), adsFbclid: numeric(r[6]), adsAny: numeric(r[7]) });
const totals = (r: unknown[]): TrafficTotals => ({ visitors: numeric(r[0]), newVisitors: numeric(r[1]), returningVisitors: numeric(r[2]), repeatVisitors: numeric(r[3]), sessions: numeric(r[4]), pageviews: numeric(r[5]) });

export function posthogApiConfig() {
  const host = (process.env.POSTHOG_HOST || "https://us.posthog.com").trim().replace(/\/+$/, "");
  // A local stand may answer as PostHog (a fixture server) — never production.
  const local = process.env.NODE_ENV !== "production" && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(host);
  if (!local && !["https://us.posthog.com", "https://eu.posthog.com"].includes(host)) throw new Error("POSTHOG_HOST must be https://us.posthog.com or https://eu.posthog.com.");
  const key = process.env.POSTHOG_PERSONAL_API_KEY;
  const id = process.env.POSTHOG_PROJECT_ID?.trim();
  if (!key || !id) return null;
  if (!/^\d+$/.test(id)) throw new Error("POSTHOG_PROJECT_ID must be numeric.");
  return { host, key, id };
}

/** ONE QUERY'S BUDGET (2026-10-03, after production showed "HTTP 503"): a
 *  query waits eight seconds, and one that timed out, could not connect or
 *  came back 502 / 503 / 504 — PostHog's side, not our SQL — is asked once
 *  more after a pause. Every failed attempt goes to the server log with its
 *  name, status, time and the body's first line: the 503 left no trace at
 *  all, so nobody could say which query it was. A 429 carries PostHog's
 *  Retry-After, which lib/posthog-cache waits out before anyone asks again. */
const QUERY_TIMEOUT_MS = 8_000;
const RETRY_PAUSE_MS = 700;
const RETRY_STATUS = new Set([502, 503, 504]);
class PosthogQueryError extends Error {
  constructor(message: string, readonly retry: boolean, readonly status = 0, readonly retryAfterMs = 0) { super(message); }
}

async function askPosthog(config: { host: string; key: string; id: string }, sql: string, name: string, attempt: number): Promise<Rows> {
  const started = Date.now();
  let response: Response;
  try {
    response = await fetch(`${config.host}/api/projects/${config.id}/query/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.key}` },
      body: JSON.stringify({ name: `JobFlex traffic / ${name}`, query: { kind: "HogQLQuery", query: sql }, refresh: "blocking" }),
      cache: "no-store", signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    console.warn(`[traffic] PostHog ${name}: ${timedOut ? "no answer" : "no connection"} after ${Date.now() - started} ms (attempt ${attempt})`);
    // The callers word a timeout themselves, by the error's name.
    if (timedOut) throw err;
    throw new PosthogQueryError("PostHog could not be reached. Try again shortly.", true);
  }
  if (!response.ok) {
    // Upstream bodies may contain SQL, identifiers or credentials. Keep them
    // server-side — except the one line that says WHY a query was refused
    // (HTTP 400 is HogQL rejecting our own SQL): that goes to the server log
    // in full and to the admin, trimmed, so a broken query names itself
    // (2026-10-02: the analyst's first query failed as a bare "HTTP 400").
    let why = "";
    let raw = "";
    try { raw = (await response.text()).replace(/\s+/g, " ").trim(); } catch { /* no body */ }
    try { const b = JSON.parse(raw); why = String(b?.detail ?? b?.error ?? b?.message ?? "").replace(/\s+/g, " ").trim(); } catch { /* not JSON: a gateway's page */ }
    if (response.status === 400) console.warn(`[traffic] PostHog refused the ${name} query: ${why || "no detail"}`);
    else console.warn(`[traffic] PostHog ${name}: HTTP ${response.status} after ${Date.now() - started} ms (attempt ${attempt}): ${(why || raw).slice(0, 300) || "no body"}`);
    const retryAfter = Number(response.headers.get("retry-after"));
    throw new PosthogQueryError(response.status === 401 || response.status === 403 ? "PostHog denied access. Check the project ID and query:read permission."
      : response.status === 429 ? "PostHog query limit reached. Try again shortly."
      : `PostHog query failed (HTTP ${response.status})${response.status === 400 && why ? `: ${why.slice(0, 220)}` : "."}`, RETRY_STATUS.has(response.status),
      response.status, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 0);
  }
  const body = await response.json();
  if (!Array.isArray(body.results)) throw new Error("PostHog has not returned a completed result yet.");
  return body.results;
}

/** One HogQL query, asked now — uncached. The pages read through lib/posthog-cache; only a cron that runs less
 *  often than any cache would keep its answer (the sign-up alarm) asks directly. */
export async function runTrafficQuery(sql: string, name: string): Promise<Rows> {
  const config = posthogApiConfig();
  if (!config) throw new Error("Set POSTHOG_PERSONAL_API_KEY and POSTHOG_PROJECT_ID.");
  try { return await askPosthog(config, sql, name, 1); }
  catch (err) {
    const again = err instanceof PosthogQueryError ? err.retry : err instanceof Error && err.name === "TimeoutError";
    if (!again) throw err;
  }
  await new Promise((r) => setTimeout(r, RETRY_PAUSE_MS));
  return askPosthog(config, sql, name, 2);
}

export function emptyTrafficReport(filters: TrafficFilters): TrafficReport {
  return { filters, fetchedAt: new Date().toISOString(), status: "ok", errors: [], totals: null, previous: null,
    lifetime: null, today: null, firstTrackedAt: null, firstStepAt: null, people: null, points: [], pages: [], sources: [],
    referrers: [], campaigns: [], devices: [], browsers: [], countries: [], terms: [], hosts: [], funnel: [], funnelOutcomes: null, experiments: [], variants: [], modes: [] };
}

/** Bound concurrency to avoid saturating the upstream project's query slots.
 *  Two at a time: the live panel's queries run beside these on a page load,
 *  and at three PostHog queued one of them for nine seconds (measured
 *  2026-10-01). */
const QUERY_CONCURRENCY = 2;
const reportKey = (filters: TrafficFilters) => JSON.stringify([process.env.POSTHOG_HOST, filters]);

/** THE REPORT under the live view: the date range's queries, each kept half an
 *  hour (lib/posthog-cache) — a range's figures do not move while someone
 *  reads them, and the page's Refresh asks again (30 s apart at most). The page
 *  load and the browser's deferred ask share the same in-flight queries. */
export async function getTrafficReport(filters: TrafficFilters, opts: { force?: boolean } = {}): Promise<TrafficReport> {
  const report = emptyTrafficReport(filters);
  try {
    if (!posthogApiConfig()) return { ...report, status: "disabled", message: "Connect a PostHog personal key with query:read and a numeric project ID." };
  } catch (err) { return { ...report, status: "error", message: (err as Error).message }; }
  const cacheKey = reportKey(filters);
  const queries = Object.entries(buildTrafficQueries(filters));
  const results: Record<string, Rows> = {};
  // A query PostHog did not answer keeps the rows it last answered with
  // (same filters); only one that never answered is an error.
  const old: StaleNote[] = [];
  const oldNames: string[] = [];
  const reads: number[] = [];
  for (let i = 0; i < queries.length; i += QUERY_CONCURRENCY) {
    await Promise.all(queries.slice(i, i + QUERY_CONCURRENCY).map(async ([name, sql]) => {
      try {
        const read = await cachedRows(`report|${cacheKey}|${name}`, POSTHOG_TTL.history, () => runTrafficQuery(sql, name), opts);
        results[name] = read.rows;
        reads.push(read.at);
        if (read.stale) { old.push(read.stale); oldNames.push(name); }
      } catch (err) {
        const msg = err instanceof Error && err.name === "TimeoutError" ? "Query timed out. Narrow the date range." : err instanceof Error ? err.message : "Query unavailable.";
        report.errors.push(`${name}: ${msg}`);
      }
    }));
  }
  // "Updated" is the oldest answer on the page.
  if (reads.length) report.fetchedAt = new Date(Math.min(...reads)).toISOString();
  if (results.overview) {
    const current = results.overview.find(r => r[0] === "current");
    const previous = results.overview.find(r => r[0] === "previous");
    report.totals = current ? totals(current.slice(1)) : null;
    report.previous = previous ? totals(previous.slice(1)) : null;
    const people = results.overview.find(r => r[0] === "people");
    report.people = people ? { people: numeric(people[1]), inAppVisitors: numeric(people[2]), inAppPeople: numeric(people[3]) } : null;
    // Coverage: the first pageview and the first registration step, as Unix seconds (0 = none).
    const coverage = results.overview.find(r => r[0] === "coverage");
    const iso = (v: unknown) => (numeric(v) > 0 ? new Date(numeric(v) * 1000).toISOString() : null);
    report.firstTrackedAt = coverage ? iso(coverage[1]) : null;
    report.firstStepAt = coverage ? iso(coverage[2]) : null;
  }
  // ONE ALL-TIME FIGURE (2026-10-01). The header's "All-time visitors" and
  // "Today" are the live panel's totals — the same query, the same cached
  // answer — so the two can no longer print 11,706 and 11,702 side by side
  // (two queries, two rules, two cache ages). The localhost-only scope keeps
  // its own count; the pair has no column for it.
  if (filters.environment !== "development") {
    try {
      const read = await totalsRead(TRAFFIC_TZ, filters.fullHistory);
      const t = filters.environment === "all" ? read.value.all : read.value.production;
      report.lifetime = t.allTime; report.today = t.today;
      if (read.stale) { old.push(read.stale); oldNames.push("all-time"); }
    } catch { /* the report's own count stands */ }
  }
  if (results.trend) {
    const days = new Map(results.trend.map(r => [String(r[0]), { ...totals(r.slice(1)), ...daily(r.slice(7)) }]));
    for (let date = filters.from; date <= filters.to; date = shiftDate(date, 1)) report.points.push({ date, ...(days.get(date) || { ...totals([]), ...daily([]) }) });
  }
  report.pages = (results.pages || []).map(r => ({ page: String(r[0]), ...totals(r.slice(1)) }));
  for (const r of results.breakdowns || []) {
    const key = String(r[0]);
    if (["sources", "referrers", "campaigns", "devices", "browsers", "countries", "terms", "hosts"].includes(key)) {
      (report[key as "sources"] as TrafficBreakdown[]).push({ name: String(r[1]), visitors: numeric(r[2]), sessions: numeric(r[3]), conversions: numeric(r[4]) });
    }
  }
  const stages = funnelStages(filters);
  report.funnel = results.funnel?.[0] ? stages.map(({ id, label }, i) => ({ id, label, visitors: numeric(results.funnel[0][i]) })) : [];
  if (results.funnel?.[0]) {
    const row = results.funnel[0].slice(stages.length);
    report.funnelOutcomes = { trials: numeric(row[0]), purchases: numeric(row[1]), other: numeric(row[2]), trialAttempts: numeric(row[3]), purchaseAttempts: numeric(row[4]) };
  }
  report.variants = (results.variants || []).map(r => ({ variant: String(r[0]) === "e" ? "e" as const : "d" as const, started: numeric(r[1]), completed: numeric(r[2]) }));
  {
    const byMode = new Map<string, { mode: string; started: number; completed: number; recorded: number }>();
    for (const r of results.modes || []) {
      const mode = String(r[1] || "unknown");
      const m = byMode.get(mode) ?? { mode, started: 0, completed: 0, recorded: 0 };
      if (String(r[0]) === "start") { m.started += numeric(r[2]); m.completed += numeric(r[3]); } else m.recorded += numeric(r[3]);
      byMode.set(mode, m);
    }
    const order = ["3-step", "2-step", "passwordless", "unknown"];
    report.modes = [...byMode.values()].sort((a, b) => (order.indexOf(a.mode) + 1 || 9) - (order.indexOf(b.mode) + 1 || 9));
  }
  report.experiments = (results.experiments || []).map(experimentResultFromRow);
  if (!report.totals) { report.status = "error"; report.message = report.errors[0] || "Traffic is unavailable."; }
  // The oldest answer on the page dates the note; a scope only when some of it is fresh.
  else if (old.length) {
    const oldest = old.reduce((a, b) => (a.since <= b.since ? a : b));
    const whole = queries.every(([name]) => oldNames.includes(name));
    report.stale = { since: oldest.since, reason: oldest.reason, ...(whole ? {} : { scope: oldNames.join(", ") }) };
  }
  return report;
}

/** The A/B bench, asked for when its tab opens — not on every page load. */
export async function getTrafficExperiments(filters: TrafficFilters): Promise<ExperimentResult[]> {
  if (!posthogApiConfig()) throw new Error("Experiment results are unavailable because PostHog is not connected.");
  const read = await cachedRows(`experiments|${reportKey(filters)}`, POSTHOG_TTL.history, () => runTrafficQuery(buildExperimentsQuery(filters), "experiments"));
  return read.rows.map(experimentResultFromRow);
}

const text = (v: unknown) => v == null ? "" : String(v);
// HogQL returns UTC datetimes as "YYYY-MM-DD HH:MM:SS[.ffffff]" or ISO strings; both become ISO.
const stamp = (v: unknown) => { const raw = text(v).trim(); if (!raw) return ""; const iso = raw.replace(" ", "T") + (/[Zz]$|[+-]\d\d:?\d\d$/.test(raw) ? "" : "Z"); const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : d.toISOString(); };

/** Everyone who reached one funnel stage under the current filters, newest first. */
export async function getStageVisitors(filters: TrafficFilters, stageId: string): Promise<StageVisitorsReport> {
  const stage = funnelStages(filters).find(s => s.id === stageId);
  if (!stage) throw new Error("Choose a funnel stage.");
  const config = posthogApiConfig();
  if (!config) throw new Error("Connect PostHog to inspect visitors.");
  const sql = buildStageVisitorsQuery(filters, stageId);
  if (!sql) throw new Error("Choose a funnel stage.");
  const read = await cachedRows(`stage visitors|${reportKey(filters)}|${stageId}`, POSTHOG_TTL.today, () => runTrafficQuery(sql, `stage visitors / ${stageId}`));
  const rows = read.rows;
  const visitors: StageVisitor[] = rows.map(r => ({
    id: text(r[0]), reachedAt: stamp(r[2]), lastSeen: stamp(r[3]),
    device: text(r[4]), browser: text(r[5]), os: text(r[6]),
    country: text(r[7]), region: text(r[8]), city: text(r[9]),
    source: text(r[10]), referrer: text(r[11]), campaign: text(r[12]).trim() === "/  /" ? "" : text(r[12]),
    sessions: numeric(r[13]), views: numeric(r[14]), furthest: text(r[15]),
    personUrl: r[1] ? `${config.host}/project/${config.id}/person/${encodeURIComponent(text(r[1]))}` : null,
  }));
  return { stage: { id: stage.id, label: stage.label }, filters, total: numeric(rows[0]?.[16]) || visitors.length, visitors, fetchedAt: new Date(read.at).toISOString() };
}
