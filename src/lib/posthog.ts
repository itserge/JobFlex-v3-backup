// PostHog — the ONLY source of visitor numbers on the admin surfaces.
//
// There is no analytics model in the database. Every "visitors" / "pageviews"
// figure the admin sees comes from a HogQL query against the PostHog project
// configured in env, and when that is not configured the figure does not
// exist — the pages say "Not connected" and show what IS known locally
// (signups, promo-link clicks). Nothing here ever invents a number.
//
// Configuration (all server-side, never NEXT_PUBLIC):
//   POSTHOG_PERSONAL_API_KEY  a personal API key with query:read
//   POSTHOG_PROJECT_ID        the numeric project id
//   POSTHOG_HOST              optional, defaults to https://us.posthog.com
//
// Endpoint: POST {host}/api/projects/{id}/query
//   body: { query: { kind: "HogQLQuery", query: "<sql>" } }
//   reply: { columns: string[], results: unknown[][] }
//
// Results are cached in memory for TTL_MS so an admin refreshing the page
// does not burn the project's query budget; a failed call is cached for a
// shorter window so a flapping upstream does not hammer either. Underneath,
// each query's answer is kept by lib/posthog-cache (2026-11-02): five minutes,
// shared with every instance through SyncState, and the last answer when
// PostHog says its query limit is reached — the team's 120 an hour is shared
// with /admin/traffic.

import { POSTHOG_TTL, cachedRows } from "./posthog-cache";
import { BROWSER_TYPE_SQL, HOST_SQL, TRAFFIC_SINCE, UA_SQL, sinceSql, visitorRuleSql } from "./traffic-visitor";

export const POSTHOG_ENV = {
  key: "POSTHOG_PERSONAL_API_KEY",
  project: "POSTHOG_PROJECT_ID",
  host: "POSTHOG_HOST",
} as const;

export const POSTHOG_DEFAULT_HOST = "https://us.posthog.com";

const TTL_MS = 300_000; // 5 minutes
const ERROR_TTL_MS = 60_000;

export interface TrafficDay {
  /** YYYY-MM-DD, in the PostHog project's timezone. */
  date: string;
  visitors: number;
  pageviews: number;
}

export interface TrafficPath {
  path: string;
  pageviews: number;
  visitors: number;
}

export interface TrafficSnapshot {
  /** Last 30 days since the live map started (TRAFFIC_SINCE), oldest first. Days with no events are filled with zeros. */
  daily: TrafficDay[];
  /** Top 10 pathnames by pageviews, last 30 days. */
  topPaths: TrafficPath[];
  visitors24h: number;
  visitors7d: number;
  visitors30d: number;
  pageviews30d: number;
  /** When the snapshot was fetched. */
  fetchedAt: string;
}

export type TrafficResult =
  | { status: "disabled" }
  | { status: "ok"; data: TrafficSnapshot }
  | { status: "error"; message: string };

export function isPostHogEnabled(): boolean {
  return Boolean(process.env.POSTHOG_PERSONAL_API_KEY && process.env.POSTHOG_PROJECT_ID);
}

function hostUrl(): string {
  const raw = process.env.POSTHOG_HOST?.trim() || POSTHOG_DEFAULT_HOST;
  return raw.replace(/\/+$/, "");
}

interface HogQLResponse {
  columns?: string[];
  results?: unknown[][];
  error?: string;
  detail?: string;
}

async function hogql(query: string): Promise<unknown[][]> {
  const res = await fetch(`${hostUrl()}/api/projects/${process.env.POSTHOG_PROJECT_ID}/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.POSTHOG_PERSONAL_API_KEY}`,
    },
    body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as HogQLResponse;
  if (!res.ok) {
    // The status and Retry-After ride along: a 429 pauses every PostHog read (lib/posthog-cache).
    const retryAfter = Number(res.headers.get("retry-after"));
    throw Object.assign(new Error(res.status === 429 ? "PostHog query limit reached. Try again shortly." : body.detail || body.error || `PostHog replied ${res.status}`),
      { status: res.status, retryAfterMs: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 0 });
  }
  return Array.isArray(body.results) ? body.results : [];
}

/**
 * The server errors logged for one organization in the last `days` days, newest
 * first, as short lines ("2026-10-14 18:02 UTC · proposals.sendProposal · 500 ·
 * where") — what the support AI reads before it calls something a bug
 * (lib/support/aiSupport). [] without PostHog. The id must look like a cuid
 * before it goes anywhere near the query.
 */
export async function recentServerErrors(organizationId: string, days = 7): Promise<string[]> {
  if (!isPostHogEnabled() || !/^[a-z0-9]{8,40}$/i.test(organizationId)) return [];
  const span = Math.max(1, Math.min(30, Math.round(days)));
  const { rows } = await cachedRows(`server errors|${organizationId}|${span}`, POSTHOG_TTL.today, () => hogql(
    `SELECT timestamp, properties.scope, properties.code, properties.where FROM events WHERE event = 'server_error' AND properties.organizationId = '${organizationId}' AND timestamp > now() - INTERVAL ${span} DAY ORDER BY timestamp DESC LIMIT 12`,
  ));
  return rows.map((r) => {
    const at = r[0] instanceof Date ? r[0].toISOString() : String(r[0] ?? "");
    const where = r[3] ? ` · ${String(r[3]).slice(0, 140)}` : "";
    return `${at.slice(0, 16).replace("T", " ")} UTC · ${String(r[1] ?? "?")} · ${String(r[2] ?? "")}${where}`;
  });
}

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** YYYY-MM-DD from a HogQL date/datetime cell (string or Date). */
function dayKey(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v ?? "").slice(0, 10);
}

// WHO COUNTS (2026-10-05, owner: "count visitors from when we started the
// live map"): the /admin/traffic rule — www.jobflex.app only, no bots, no
// previews, no admin screens — and nothing before TRAFFIC_SINCE. These
// figures used to count every pageview PostHog held for 30 days.
const COUNTED = `event = '$pageview' AND timestamp >= now() - INTERVAL 30 DAY AND ${sinceSql(false)}
    AND ${visitorRuleSql({ host: HOST_SQL, ua: UA_SQL, browserType: BROWSER_TYPE_SQL, event: "event" }, "production")}
    AND NOT startsWith(ifNull(toString(properties.$pathname), ''), '/admin')`;

const DAILY_SQL = `
  SELECT toDate(timestamp) AS day,
         uniq(person_id) AS visitors,
         count() AS pageviews
  FROM events
  WHERE ${COUNTED}
  GROUP BY day
  ORDER BY day`;

const PATHS_SQL = `
  SELECT properties.$pathname AS path,
         count() AS pageviews,
         uniq(person_id) AS visitors
  FROM events
  WHERE ${COUNTED}
    AND properties.$pathname IS NOT NULL
  GROUP BY path
  ORDER BY pageviews DESC
  LIMIT 10`;

const WINDOWS_SQL = `
  SELECT uniqIf(person_id, timestamp >= now() - INTERVAL 1 DAY) AS v24h,
         uniqIf(person_id, timestamp >= now() - INTERVAL 7 DAY) AS v7d,
         uniq(person_id) AS v30d,
         count() AS pv30d
  FROM events
  WHERE ${COUNTED}`;

async function fetchSnapshot(): Promise<TrafficSnapshot> {
  const [dailyRead, pathRead, windowRead] = await Promise.all([
    cachedRows("snapshot|daily", POSTHOG_TTL.today, () => hogql(DAILY_SQL)),
    cachedRows("snapshot|paths", POSTHOG_TTL.today, () => hogql(PATHS_SQL)),
    cachedRows("snapshot|windows", POSTHOG_TTL.today, () => hogql(WINDOWS_SQL)),
  ]);
  const [dailyRows, pathRows, windowRows] = [dailyRead.rows, pathRead.rows, windowRead.rows];

  const byDay = new Map<string, TrafficDay>();
  for (const r of dailyRows) {
    const date = dayKey(r[0]);
    if (date) byDay.set(date, { date, visitors: num(r[1]), pageviews: num(r[2]) });
  }
  // Zero-fill the 30-day window so the chart has a bar slot for every day.
  const daily: TrafficDay[] = [];
  const today = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
    const date = d.toISOString().slice(0, 10);
    // Days before the live map started are not part of the count, not zeros in it.
    if (date < TRAFFIC_SINCE) continue;
    daily.push(byDay.get(date) ?? { date, visitors: 0, pageviews: 0 });
  }

  const topPaths: TrafficPath[] = pathRows.map((r) => ({
    path: String(r[0] ?? "/"),
    pageviews: num(r[1]),
    visitors: num(r[2]),
  }));

  const w = windowRows[0] ?? [];
  return {
    daily,
    topPaths,
    visitors24h: num(w[0]),
    visitors7d: num(w[1]),
    visitors30d: num(w[2]),
    pageviews30d: num(w[3]),
    // When PostHog answered: the oldest of the three, a cached one included.
    fetchedAt: new Date(Math.min(dailyRead.at, pathRead.at, windowRead.at)).toISOString(),
  };
}

// ── In-memory TTL cache ───────────────────────────────────────────────
// Module-level, so it survives across requests on a warm server process.
// `globalThis` keeps it alive across Next's dev-mode module reloads.
type CacheEntry = { at: number; result: TrafficResult };
const g = globalThis as unknown as { __jfPosthogCache?: CacheEntry; __jfPosthogInflight?: Promise<TrafficResult> };

export async function getTrafficSnapshot(): Promise<TrafficResult> {
  if (!isPostHogEnabled()) return { status: "disabled" };

  const cached = g.__jfPosthogCache;
  const now = Date.now();
  if (cached) {
    const ttl = cached.result.status === "ok" ? TTL_MS : ERROR_TTL_MS;
    if (now - cached.at < ttl) return cached.result;
  }
  if (g.__jfPosthogInflight) return g.__jfPosthogInflight;

  g.__jfPosthogInflight = (async (): Promise<TrafficResult> => {
    try {
      const data = await fetchSnapshot();
      const result: TrafficResult = { status: "ok", data };
      g.__jfPosthogCache = { at: Date.now(), result };
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : "PostHog query failed";
      console.error("[posthog] traffic snapshot failed:", err);
      const result: TrafficResult = { status: "error", message };
      g.__jfPosthogCache = { at: Date.now(), result };
      return result;
    } finally {
      g.__jfPosthogInflight = undefined;
    }
  })();
  return g.__jfPosthogInflight;
}
