// PostHog's query budget (2026-11-02, after /admin/traffic hit "query limit
// reached" 10–15 minutes into Live mode): the team gets 120 HogQL queries an
// hour, and one open /admin/traffic tab must stay under 80 of them. An hour of
// the page is played on a fast clock against a stubbed PostHog that counts
// every call; then several tabs at once, a cold start, a 429 and the Refresh
// button. Nothing leaves the machine; no database (an in-memory store stands
// in for SyncState).
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/posthog-budget.check.ts
import { fetchAnalystSessions, fetchLiveEvents, fetchSignupDropoff, getLiveTraffic, getTrafficReport, runTrafficQuery } from "../../../src/lib/traffic-server";
import { parseTrafficFilters } from "../../../src/lib/traffic-query";
import { TRAFFIC_EVENTS } from "../../../src/lib/traffic-contract";
import { POSTHOG_TTL, resetPosthogAnswers, type PosthogAnswerStore } from "../../../src/lib/posthog-cache";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};

process.env.POSTHOG_PERSONAL_API_KEY = "phx_check";
process.env.POSTHOG_PROJECT_ID = "1";
delete process.env.POSTHOG_HOST;

const realNow = Date.now;
let clock = 0;
Date.now = () => realNow() + clock;
const at = (seconds: number) => { clock = seconds * 1000; };

// PostHog, stubbed: every call counted by the query's name; `limited` answers 429 with a Retry-After.
let calls: Record<string, number> = {};
let limited: { retryAfter: number } | null = null;
const total = () => Object.values(calls).reduce((a, b) => a + b, 0);
const liveRow = (person: string, ago: number, event = "$pageview") => [person, "d-" + person, event, Date.now() - ago, "/", "https://jobflex.app/", "s-" + person, "jobflex.app", "production", "facebook", "paid", "camp", "", "l.facebook.com", "Mobile", "Mobile Safari", "iOS", "United States", "Texas", "Dallas", "", "", "", "true", 32.78, -96.8, "US", "TX", "", "", "", "", "",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1", ""];
const answers: Record<string, () => unknown[][]> = {
  // Someone on the site now, and a convert from three hours ago — one query brings both.
  live: () => [liveRow("0192aa00-1111-2222-3333-444455556666", 60_000), liveRow("0192bb00-1111-2222-3333-444455556666", 3 * 3_600_000, TRAFFIC_EVENTS.completed), liveRow("0192bb00-1111-2222-3333-444455556666", 3 * 3_600_000 + 60_000)],
  "live totals": () => [[900, 700, 120, 90, 100, 80, 450, 400, 61, 50, 310, 240]],
  overview: () => [["current", 40, 30, 10, 5, 55, 80]],
};
globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
  const name = String(JSON.parse(String(init?.body)).name).replace("JobFlex traffic / ", "");
  calls[name] = (calls[name] ?? 0) + 1;
  if (limited) return new Response(JSON.stringify({ detail: "Request was throttled." }), { status: 429, headers: { "Retry-After": String(limited.retryAfter) } });
  return new Response(JSON.stringify({ results: (answers[name] ?? (() => []))() }), { status: 200 });
}) as typeof fetch;
console.warn = () => {};

// SyncState, in memory: what another instance (or the next cold start) would read.
const stored = new Map<string, { at: number; rows: unknown[][] }>();
const store: PosthogAnswerStore = { read: async (k) => stored.get(k) ?? null, write: async (k, e) => { stored.set(k, JSON.parse(JSON.stringify(e))); } };

/** One open tab from `from` to `to` seconds: Live on (the 15 s poll), the analyst and the stops panel every ten
 *  minutes, the report when the page opens — and the two crons that read PostHog, counted apart. */
async function playTab(from: number, to: number, cron: Record<string, number>, opens: boolean) {
  const filters = parseTrafficFilters({});
  for (let t = from; t < to; t += 15) {
    at(t);
    if (t === from && opens) await getTrafficReport(filters);
    if (t === from) await Promise.all([fetchAnalystSessions(), fetchSignupDropoff(7)]);
    await getLiveTraffic([]);
    if (t > from && (t - from) % 600 === 0) await Promise.all([fetchAnalystSessions(), fetchSignupDropoff(7)]);
    const before = { ...calls };
    if (t % 300 === 0) await fetchLiveEvents(2 * 60_000);
    if (t % 900 === 0) await runTrafficQuery("SELECT 1", "signup alerts");
    for (const [k, v] of Object.entries(calls)) if (v !== (before[k] ?? 0)) { cron[k] = (cron[k] ?? 0) + v - (before[k] ?? 0); calls[k] = before[k] ?? 0; }
  }
}

async function main() {
  resetPosthogAnswers({ store });

  // ── an hour of one open tab
  const cron: Record<string, number> = {};
  await playTab(0, 3600, cron, true);
  const first = { ...calls };
  const reportQueries = Object.entries(first).filter(([k]) => !["live", "live totals", "analyst", "signup dropoff"].includes(k)).reduce((a, [, v]) => a + v, 0);
  check("Live now: one PostHog query a minute (240 an hour before), the day's converts in the same query",
    first.live === 60 && !first.converted, JSON.stringify(first));
  check("the four counters: one query every five minutes", first["live totals"] === 12, String(first["live totals"]));
  check("the analyst and where sign-ups stop: every half hour", first.analyst === 2 && first["signup dropoff"] === 2, `${first.analyst} · ${first["signup dropoff"]}`);
  check("the report: its queries once, when the page opens", reportQueries === 7, String(reportQueries));
  check("the hour the tab opens: ≤ 83 (was 301)", total() <= 83, String(total()));
  check("the surge cron reads the minute the tab stored — no query of its own", !cron.live, JSON.stringify(cron));

  calls = {};
  const cron2: Record<string, number> = {};
  await playTab(3600, 7200, cron2, false);
  // The report is not asked again without a reload; the page goes on polling this server every 15 s.
  check("every hour after: ≤ 80 — the target, with 40 an hour left for the other pages and the crons", total() <= 80 && calls.live === 60, `${total()} · ${JSON.stringify(calls)}`);

  // ── several tabs, admins and instances
  calls = {};
  at(7200 + 120);
  const tabs = await Promise.all([getLiveTraffic([]), getLiveTraffic([]), getLiveTraffic([], { includeDevelopment: true }), fetchLiveEvents()]);
  check("three tabs and the cron at the same tick: one PostHog call, everyone waits on it", calls.live === 1 && tabs.every((r) => !("status" in r) || r.status === "ok"), JSON.stringify(calls));
  check("the day's convert comes out of the one query", tabs[0] && "converted" in tabs[0] && tabs[0].converted.length === 1 && tabs[0].visitors.length === 1, "converted" in tabs[0] ? `${tabs[0].converted.length} · ${tabs[0].visitors.length}` : "");

  calls = {};
  resetPosthogAnswers();
  const cold = await getLiveTraffic([]);
  check("a cold start (or another instance) reads the stored answer: no PostHog call", total() === 0 && cold.status === "ok" && !cold.stale, JSON.stringify(calls));

  // ── the Refresh button
  calls = {};
  at(7200 + 130);
  await getLiveTraffic([], { force: true });
  check("Refresh within 30 s of the last read: served from the cache", total() === 0, JSON.stringify(calls));
  at(7200 + 160);
  await getLiveTraffic([], { force: true });
  check("Refresh past 30 s: PostHog asked again, the window and the counters", calls.live === 1 && calls["live totals"] === 1, JSON.stringify(calls));

  // ── PostHog says "enough"
  calls = {};
  limited = { retryAfter: 120 };
  at(7200 + 600);
  const limitedRead = await getLiveTraffic([]);
  check("429 with an answer kept: the figures stay, each with its own 'as of', no banner",
    limitedRead.status === "ok" && !limitedRead.message && !!limitedRead.stale && !!limitedRead.totalsStale && /query limit/.test(limitedRead.stale?.reason ?? "") && limitedRead.visitors.length === 1 && limitedRead.totals?.today === 90,
    JSON.stringify({ stale: limitedRead.stale, totalsStale: limitedRead.totalsStale }));
  const asked = total();
  for (let t = 615; t < 720; t += 15) { at(7200 + t); await getLiveTraffic([]); }
  check("after a 429 nobody asks again until PostHog's Retry-After has passed", total() === asked, `${asked} → ${total()}`);
  limited = null;
  at(7200 + 735);
  const back = await getLiveTraffic([]);
  check("Retry-After over: asked again, the 'as of' gone", total() > asked && back.status === "ok" && !back.stale, JSON.stringify(calls));

  limited = { retryAfter: 60 };
  resetPosthogAnswers({ store: null });
  const empty = await getLiveTraffic([]);
  check("429 with nothing kept anywhere: the one case for the 'query limit reached' banner",
    empty.status === "error" && /PostHog query limit reached/.test(empty.message ?? ""), `${empty.status} · ${empty.message}`);

  check("the TTLs are the owner's", POSTHOG_TTL.live === 60_000 && POSTHOG_TTL.today === 300_000 && POSTHOG_TTL.history === 1_800_000);

  console.log(bad ? `\n${bad} failing` : "\nall green");
  process.exit(bad ? 1 : 0);
}
void main();
