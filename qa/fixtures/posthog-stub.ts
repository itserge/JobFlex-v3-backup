// A stand-in for PostHog's query endpoint on a local stand (2026-11-02): counts every HogQL call by the name
// lib/traffic-server gives it, answers "Live now" with three visitors and the totals with a row, everything else
// with no rows. Point the app at it (lib/traffic-server allows a localhost POSTHOG_HOST outside production):
//   POSTHOG_HOST=http://127.0.0.1:4610 POSTHOG_PERSONAL_API_KEY=phx_stub POSTHOG_PROJECT_ID=1
//   npx tsx qa/fixtures/posthog-stub.ts            (PORT=4610 by default)
//   curl 127.0.0.1:4610/__calls                    the count so far, by query, with the first and last call's time
//   curl 127.0.0.1:4610/__limit?on=1               answer 429 "query limit" (Retry-After 60) until ?on=0
//   curl 127.0.0.1:4610/__reset                    the count back to zero
import { createServer } from "node:http";

const PORT = Number(process.env.PORT || 4610);
const calls: Record<string, number> = {};
const log: Array<{ at: string; name: string; status: number }> = [];
let limited = false;

const ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
// The live columns, in liveSelectSql's order (lib/traffic-live): enough of them for a pin, a source and a stage.
const visit = (person: string, minutesAgo: number, path: string, utm: string, city: [string, string, number, number]) =>
  [person, "d-" + person, "$pageview", Date.now() - minutesAgo * 60_000, path, `https://www.jobflex.app${path}`, "s-" + person, "www.jobflex.app", "production",
    utm, utm ? "paid" : "", utm ? "roofing-oct" : "", "", utm ? "l.facebook.com" : "$direct", "Mobile", "Mobile Safari", "iOS",
    "United States", city[0], city[1], "", "", "", "", city[2], city[3], "US", "", utm ? "fbclid" : "", "", "", "", "", ua, ""];
const answer = (name: string): unknown[][] => {
  if (name === "live") return [
    visit("0192aa00-0000-4000-8000-000000000001", 1, "/", "facebook", ["Texas", "Dallas", 32.78, -96.8]),
    visit("0192aa00-0000-4000-8000-000000000002", 2, "/auth/register", "facebook", ["Arizona", "Phoenix", 33.45, -112.07]),
    visit("0192aa00-0000-4000-8000-000000000003", 4, "/pricing", "", ["Florida", "Tampa", 27.95, -82.46]),
  ];
  if (name === "live totals") return [[1480, 1212, 64, 51, 58, 47, 133, 118, 402, 371, 190, 160]];
  // The report under the live view (lib/traffic-server getTrafficReport), in each query's column order.
  if (name === "overview") return [["current", 1212, 1050, 162, 140, 1490, 3920], ["previous", 0, 0, 0, 0, 0, 0], ["people", 1180, 610, 590, 0, 0, 0], ["coverage", 1790000000, 1790000000, 0, 0, 0, 0]];
  if (name === "trend") return Array.from({ length: 30 }, (_, i) => {
    const day = new Date(Date.now() - (29 - i) * 86_400_000).toISOString().slice(0, 10);
    const v = 20 + ((i * 7) % 31);
    return [day, v, v - 4, 4, 3, v + 6, v * 3, v - 1, Math.round(v / 2), Math.round(v / 2) - 1, Math.round(v / 3), 2, 0, Math.round(v / 3), Math.round(v / 2)];
  });
  if (name === "pages") return [["/", 900, 820, 80, 70, 1010, 2100], ["/auth/register", 260, 200, 60, 40, 300, 640], ["/pricing", 140, 110, 30, 20, 160, 280]];
  if (name === "breakdowns") return [["sources", "facebook", 610, 700, 9], ["sources", "(direct)", 420, 480, 3], ["devices", "Mobile", 880, 990, 8], ["devices", "Desktop", 330, 400, 4]];
  return [];
};

createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  const json = (status: number, body: unknown, headers: Record<string, string> = {}) => { res.writeHead(status, { "Content-Type": "application/json", ...headers }); res.end(JSON.stringify(body)); };
  if (url.pathname === "/__calls") return json(200, { total: Object.values(calls).reduce((a, b) => a + b, 0), calls, first: log[0]?.at ?? null, last: log.at(-1)?.at ?? null, limited, log: log.slice(-40) });
  if (url.pathname === "/__reset") { for (const k of Object.keys(calls)) delete calls[k]; log.length = 0; return json(200, { ok: true }); }
  if (url.pathname === "/__limit") { limited = url.searchParams.get("on") === "1"; return json(200, { limited }); }
  if (req.method !== "POST" || !/^\/api\/projects\/\d+\/query\/?$/.test(url.pathname)) return json(404, { detail: "Not a query." });
  let raw = "";
  req.on("data", (c) => { raw += c; });
  req.on("end", () => {
    let name = "?";
    try { name = String(JSON.parse(raw).name ?? "?").replace(/^JobFlex traffic \/ /, ""); } catch { /* counted as "?" */ }
    calls[name] = (calls[name] ?? 0) + 1;
    const status = limited ? 429 : 200;
    log.push({ at: new Date().toISOString(), name, status });
    if (limited) return json(429, { type: "throttled_error", detail: "Request was throttled. Expected available in 60 seconds." }, { "Retry-After": "60" });
    json(200, { columns: [], results: answer(name) });
  });
}).listen(PORT, "127.0.0.1", () => console.log(`PostHog stub on http://127.0.0.1:${PORT} — /__calls, /__limit?on=1, /__reset`));
