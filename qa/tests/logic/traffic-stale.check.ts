// PostHog down (2026-10-03, production showed "PostHog query failed (HTTP
// 503)"): a query is asked once more after a pause, waits eight seconds at
// most, and when it still fails the page gets the last answer PostHog did
// give, dated — an error only where there is nothing to show. PostHog is a
// stubbed fetch here; nothing leaves the machine. Takes ~15 s (one real
// eight-second timeout). Static imports only (tsx has no top-level await).
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/traffic-stale.check.ts
import { getLiveTraffic, getMapHistory, getTrafficReport, runTrafficQuery } from "../../../src/lib/traffic-server";
import { resetPosthogAnswers } from "../../../src/lib/posthog-cache";
import { buildTrafficQueries, parseTrafficFilters } from "../../../src/lib/traffic-query";
import { staleLabel } from "../../../src/lib/traffic-contract";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};

process.env.POSTHOG_PERSONAL_API_KEY = "phx_check";
process.env.POSTHOG_PROJECT_ID = "1";
delete process.env.POSTHOG_HOST;

// The clock, moved forward between scenes so the server's caches have aged out.
const realNow = Date.now;
let skew = 0;
Date.now = () => realNow() + skew;
const later = (minutes: number) => { skew += minutes * 60_000; };

// PostHog, stubbed: each query is answered by its name; `down` names fail with `status`.
type Plan = { down: (name: string) => boolean; status: number; hang: (name: string) => boolean };
const plan: Plan = { down: () => false, status: 503, hang: () => false };
const calls: Array<{ name: string; at: number }> = [];
const liveRow = (person: string) => [person, "d-" + person, "$pageview", Date.now() - 60_000, "/", "https://jobflex.app/", "s-" + person, "jobflex.app", "production", "facebook", "paid", "camp", "", "l.facebook.com", "Mobile", "Mobile Safari", "iOS", "United States", "Texas", "Dallas", "", "", "", "", 32.78, -96.8, "US", "TX", "", "", "", "", "",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1", ""];
const answers: Record<string, () => unknown[][]> = {
  live: () => [liveRow("0192aa00-1111-2222-3333-444455556666")],
  converted: () => [],
  "live totals": () => [[900, 700, 120, 90, 100, 80, 450, 400, 61, 50, 310, 240]],
  overview: () => [["current", 40, 30, 10, 5, 55, 80], ["previous", 20, 15, 5, 2, 25, 40]],
  pages: () => [["/", 40, 30, 10, 5, 55, 80]],
};
globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
  const name = String(JSON.parse(String(init?.body)).name).replace("JobFlex traffic / ", "");
  calls.push({ name, at: realNow() });
  if (plan.hang(name)) {
    // Never answers: the caller's own eight-second signal ends it.
    return new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)));
  }
  if (plan.down(name)) return new Response(JSON.stringify({ detail: "Queries are a little too busy right now." }), { status: plan.status });
  return new Response(JSON.stringify({ results: (answers[name] ?? (() => []))() }), { status: 200 });
}) as typeof fetch;
const quiet = console.warn;
const warned: string[] = [];
console.warn = (...a: unknown[]) => { warned.push(a.join(" ")); };
const failing = async (p: Promise<unknown>) => { try { await p; return ""; } catch (e) { return e instanceof Error ? e.message : String(e); } };

async function main() {
  // AbortSignal.timeout does not hold the process open; the hung query below needs something that does.
  const alive = setInterval(() => {}, 1_000);
  // The answers live in this process only (lib/posthog-cache): no database here.
  resetPosthogAnswers({ store: null });
  // ── one query: the retry
  let n = 0;
  plan.down = () => ++n === 1;
  let rows = await runTrafficQuery("SELECT 1", "live totals");
  check("a 503 is asked once more, after a pause, and the second answer is the answer",
    rows.length === 1 && calls.length === 2 && calls[1].at - calls[0].at >= 600, `${calls.length} calls, ${calls[1]?.at - calls[0]?.at} ms apart`);
  check("the failed attempt is in the server log: the query, the status, the time, PostHog's own words",
    warned.some((w) => /PostHog live totals: HTTP 503 after \d+ ms \(attempt 1\): Queries are a little too busy/.test(w)), warned.join(" | "));

  calls.length = 0; plan.down = () => true;
  const twice = await failing(runTrafficQuery("SELECT 1", "live"));
  check("a 503 both times is an error, after exactly two attempts", twice === "PostHog query failed (HTTP 503)." && calls.length === 2, `${twice} · ${calls.length}`);

  for (const [status, words] of [[400, /HTTP 400/], [401, /denied access/], [429, /query limit/]] as const) {
    calls.length = 0; plan.status = status;
    const said = await failing(runTrafficQuery("SELECT 1", "live"));
    check(`HTTP ${status} is ours to fix or wait out — not asked again`, words.test(said) && calls.length === 1, `${said} · ${calls.length}`);
  }
  plan.status = 503;

  calls.length = 0; n = 0; plan.down = () => false; plan.hang = () => ++n === 1;
  const t0 = realNow();
  rows = await runTrafficQuery("SELECT 1", "live totals");
  const took = realNow() - t0;
  check("a query that does not answer is dropped at eight seconds and asked once more", rows.length === 1 && calls.length === 2 && took >= 8_000 && took < 11_000, `${took} ms`);
  plan.hang = () => false;

  // ── the live view
  later(10);
  const first = await getLiveTraffic([]);
  check("PostHog up: the live view reads, with its totals, nothing stale",
    first.status === "ok" && first.visitors.length === 1 && first.totals?.allTime === 700 && !first.stale, `${first.status} · ${first.visitors.length} · ${first.message ?? ""}`);

  later(10); plan.down = (name) => name === "live totals";
  const noTotals = await getLiveTraffic([]);
  check("the totals query down: the window is fresh, the totals are the last ones read, and only the totals say how old",
    noTotals.status === "ok" && noTotals.visitors.length === 1 && noTotals.totals?.allTime === 700 && !noTotals.stale && noTotals.totalsStale?.since === first.fetchedAt && noTotals.fetchedAt !== first.fetchedAt,
    JSON.stringify({ stale: noTotals.stale ?? null, totalsStale: noTotals.totalsStale ?? null }));

  later(10); plan.down = () => true;
  const down = await getLiveTraffic([]);
  check("PostHog down: the last report is shown, whole, dated to when it was read",
    down.status === "ok" && down.visitors.length === 1 && down.totals?.allTime === 700 && down.stale?.since === noTotals.fetchedAt && down.fetchedAt === noTotals.fetchedAt && !down.stale?.scope && /503/.test(down.stale?.reason ?? "") && !!down.totalsStale,
    JSON.stringify(down.stale ?? null));
  check("the note reads the way the page prints it", /^PostHog unavailable, showing data from \d{1,2}:\d\d [AP]M$/.test(staleLabel({ since: new Date().toISOString(), reason: "" }, "America/Los_Angeles"))
    && /^PostHog unavailable for the totals, showing data from /.test(staleLabel({ since: new Date().toISOString(), reason: "", scope: "the totals" }, "UTC"))
    && /showing data from [A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d\d [AP]M$/.test(staleLabel({ since: "2026-09-30T19:00:00Z", reason: "" }, "UTC")), staleLabel({ since: "2026-09-30T19:00:00Z", reason: "" }, "UTC"));

  // A cold instance with nothing stored: no answer anywhere to fall back on.
  resetPosthogAnswers();
  const cold = await getLiveTraffic([], { includeDevelopment: true });
  check("a reading that was never answered is the error, in words — the banner is for an empty cache only",
    cold.status === "error" && /503/.test(cold.message ?? "") && !cold.stale && cold.visitors.length === 0, `${cold.status} · ${cold.message}`);

  later(10); plan.down = () => false;
  const back = await getLiveTraffic([]);
  check("PostHog back: a fresh report, the note gone", back.status === "ok" && !back.stale && back.fetchedAt !== down.fetchedAt);

  // ── the map's longer span
  const span = await getMapHistory(60, []);
  later(10); plan.down = () => true;
  const spanDown = await getMapHistory(60, []);
  const spanCold = await getMapHistory(240, []);
  check("the map's span: the last rows with a note when PostHog is down, an error only for a span never read",
    span.status === "ok" && !span.stale && spanDown.status === "ok" && !!spanDown.stale && spanCold.status === "error" && /503/.test(spanCold.message ?? ""), `${spanDown.status} · ${spanCold.message}`);

  // ── the report: one query's failure is that query's alone
  later(40); plan.down = () => false;
  const filters = parseTrafficFilters({ from: "2026-10-01", to: "2026-10-03", timezone: "America/Los_Angeles" });
  const report = await getTrafficReport(filters);
  check("PostHog up: the report reads", report.status === "ok" && report.totals?.visitors === 40 && report.pages.length === 1 && !report.stale && !report.errors.length, JSON.stringify(report.errors));

  later(40); plan.down = (name) => name === "pages";
  const partial = await getTrafficReport(filters);
  check("one query down: its table keeps the rows it last had, the rest is fresh, and no error is raised",
    partial.status === "ok" && partial.pages.length === 1 && partial.totals?.visitors === 40 && partial.stale?.scope === "pages" && !partial.errors.length, JSON.stringify({ stale: partial.stale, errors: partial.errors }));

  later(40); plan.down = () => true;
  const dark = await getTrafficReport(filters);
  check("every query down: the whole report is the last one read, dated, still no error",
    dark.status === "ok" && dark.totals?.visitors === 40 && dark.lifetime === 700 && !!dark.stale && !dark.stale.scope && !dark.errors.length, JSON.stringify({ stale: dark.stale, errors: dark.errors }));

  const other = await getTrafficReport(parseTrafficFilters({ from: "2026-09-30", to: "2026-10-02", timezone: "America/Los_Angeles" }));
  check("a range never read has nothing to fall back on: the error, with each query named",
    other.status === "error" && /503/.test(other.message ?? "") && other.errors.length === Object.keys(buildTrafficQueries(filters)).length && !other.stale, `${other.status} · ${other.errors.length}`);

  clearInterval(alive);
  console.warn = quiet;
  console.log(bad ? `\n${bad} failing` : "\nall green");
  process.exit(bad ? 1 : 0);
}
void main();
