// The website estimators (2026-10-27, lib/webEstimator): the four trades and their prices, a shop's settings as
// stored, the slug, the price band, the embed snippets, the domain rule, the lead's source and words. Pure.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/web-estimator.check.ts
import {
  DEFAULT_MONTHLY_CAP,
  WEB_TRADE,
  WEB_TRADES,
  bandWords,
  PROJECT_TYPE,
  WEB_LEAD_SOURCE,
  cleanHost,
  embedSnippets,
  embedButtonInk,
  homeownerEmail,
  hostAllowed,
  splitTypedAddress,
  leadDescription,
  monthKey,
  normalizeWebEstimatorSettings,
  priceBand,
  roundDollars,
  webCountsKey,
  webLeadKey,
  webSettingsKey,
} from "../../../src/lib/webEstimator";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || !extra ? "" : ` — ${extra}`}`);
};

// the trades and the owner's prices (fence $99 confirmed 2026-10-27)
check("five trades", WEB_TRADES.join() === "roof,hvac,fence,deck,smart");
check("roof $179, HVAC $79, deck $150 a month", WEB_TRADE.roof.cents === 17900 && WEB_TRADE.hvac.cents === 7900 && WEB_TRADE.deck.cents === 15000);
check("every trade has its own Stripe kind", new Set(WEB_TRADES.map((t) => WEB_TRADE[t].kind)).size === 5 && WEB_TRADES.every((t) => WEB_TRADE[t].kind.startsWith("web-")));

// the band
check("rounding by size", roundDollars(4_975) === 5_000 && roundDollars(12_340) === 12_300 && roundDollars(27_692) === 27_500);
const b = priceBand(1_769_200, "range", 0.12);
check("a ±12 % band around $17,692", b.low === 15_600 && b.high === 19_800, JSON.stringify(b));
check("exact shows one rounded figure", JSON.stringify(priceBand(1_769_200, "exact", 0.12)) === JSON.stringify({ low: 17_700, high: 17_700 }));
check("the spread is clamped", priceBand(1_000_000, "range", 0.9).low === roundDollars(7000) && priceBand(1_000_000, "range", 0).high === roundDollars(10_500));
check("band words", bandWords(b) === "$15,600 – $19,800" && bandWords({ low: 500, high: 500 }) === "$500");

// settings as stored
const s = normalizeWebEstimatorSettings({ domains: ["https://www.RidgelineRoofing.com/path", "bad", "shop.example.co.uk"], monthlyCap: "99999", trades: { roof: { on: true, show: "exact", spread: 2, materials: ["asphalt", 5], note: " x ".repeat(100) }, nope: { on: true } } });
check("domains cleaned, bad ones dropped", s.domains.join() === "ridgelineroofing.com,shop.example.co.uk");
check("cap clamped", s.monthlyCap === 5000 && normalizeWebEstimatorSettings({}).monthlyCap === DEFAULT_MONTHLY_CAP);
check("roof settings read, spread clamped, materials strings only, note cut", s.trades.roof.on && s.trades.roof.show === "exact" && s.trades.roof.spread === 0.3 && s.trades.roof.materials.join() === "asphalt" && s.trades.roof.note.length === 200);
check("the other trades default off", !s.trades.hvac.on && !s.trades.fence.on && !s.trades.deck.on && s.trades.deck.show === "range");

// the embed
const e = embedSnippets("https://www.jobflex.app/", "ridgeline-roofing", "roof");
check("the link", e.link === "https://www.jobflex.app/estimate/ridgeline-roofing/roof");
check("the button tag names the shop and trade, the trade's words, the blue when no colour", /estimator\.js" data-shop="ridgeline-roofing" data-trade="roof" data-label="Get my roof price" data-color="#1854a0" async/.test(e.button));
check("the button carries the shop's brand colour; junk falls back", /data-color="#111113"/.test(embedSnippets("https://x.app", "s", "fence", "#111113").button) && /data-color="#1854a0"/.test(embedSnippets("https://x.app", "s", "fence", "red;x:y").button));
check("ink on a light colour, white on a dark one", embedButtonInk("#ffeb3b") === "#0b0d12" && embedButtonInk("#111113") === "#ffffff");
check("the iframe points at the embed view", /src="https:\/\/www\.jobflex\.app\/estimate\/ridgeline-roofing\/roof\?embed=1"/.test(e.iframe));

// the domain rule
check("hosts cleaned", cleanHost("https://WWW.Ridgeline.com:443/x?y") === "ridgeline.com" && cleanHost("localhost:3000") === "localhost" && cleanHost("192.168.1.20") === "192.168.1.20" && cleanHost("") === null && cleanHost("nodots") === null);
{
  const t = splitTypedAddress({ address: "4312 Lakeview Dr, Kirkland, WA 98033", city: "", state: "", zip: "" });
  check("a typed address splits", t.address === "4312 Lakeview Dr" && t.city === "Kirkland" && t.state === "WA" && t.zip === "98033");
  const u = splitTypedAddress({ address: "12 Elm St, St. Paul, mn", city: "", state: "", zip: "" });
  check("no zip, dotted city, lower-case state", u.address === "12 Elm St" && u.city === "St. Paul" && u.state === "MN" && u.zip === "");
  const v = splitTypedAddress({ address: "4312 Lakeview Dr, Kirkland, WA 98033, USA", city: "", state: "", zip: "" });
  check("a trailing USA is dropped", v.city === "Kirkland" && v.zip === "98033");
  const w = splitTypedAddress({ address: "the blue house by the lake", city: "", state: "", zip: "" });
  check("an odd shape stays whole", w.address === "the blue house by the lake" && w.city === "" && w.state === "");
  const x = splitTypedAddress({ address: "4312 Lakeview Dr", city: "Kirkland", state: "WA", zip: "98033" });
  check("a picked address is left alone", x.address === "4312 Lakeview Dr" && x.city === "Kirkland");
}
check("no list = anywhere", hostAllowed([], "anything.com"));
check("a listed domain and its subdomains", hostAllowed(["ridgeline.com"], "ridgeline.com") && hostAllowed(["ridgeline.com"], "www.ridgeline.com") && hostAllowed(["ridgeline.com"], "shop.ridgeline.com") && !hostAllowed(["ridgeline.com"], "notridgeline.com") && !hostAllowed(["ridgeline.com"], "ridgeline.com.evil.io"));
check("the app itself always", hostAllowed(["ridgeline.com"], "www.jobflex.app", "www.jobflex.app") && !hostAllowed(["ridgeline.com"], null));

// the lead
check("the lead's source is the shop's own Website source, the trade its project type", WEB_LEAD_SOURCE === "WEBSITE" && PROJECT_TYPE.hvac === "HVAC" && PROJECT_TYPE.deck === "Deck");
check("the keys", webSettingsKey("o1") === "webEstimator:o1" && webCountsKey("o1", "2026-10") === "webEstimatorCounts:o1:2026-10" && webLeadKey("l1") === "webLead:l1");
check("the month key", monthKey(new Date(Date.UTC(2026, 9, 27))) === "2026-10");
const d = leadDescription("roof", { summary: "26 squares, 6:12, 3 facets at 1420 Oak Ridge Dr.", choice: "GAF Timberline HDZ, Charcoal", band: b, show: "range" });
check("the lead's words", /roof estimator on your website/.test(d) && /26 squares/.test(d) && /Chose: GAF Timberline HDZ, Charcoal\./.test(d) && /Shown \$15,600 – \$19,800 \(before tax\)\./.test(d), d);
const m = homeownerEmail({ shop: "Ridgeline Roofing", trade: "roof", band: b, show: "range", summary: "Your roof measures about 26 squares at a 6:12 pitch.", choice: "GAF Timberline HDZ in Charcoal", phone: "(555) 010-2030" });
check("the homeowner's email", m.subject === "Your roof, priced — $15,600 – $19,800 — Ridgeline Roofing" && /will be in touch to confirm the details at \(555\) 010-2030/.test(m.text) && /aerial imagery/.test(m.text), m.subject);

// ── THE HOUSE (2026-10-28): the same email in JobFlex's words — a local JobFlex pro will call, the request page's link ──
const hm = homeownerEmail({ shop: "JobFlex", trade: "fence", band: { low: 7200, high: 9400 }, show: "range", summary: "180 ft of fence in 3 runs, 1 walk gate.", choice: "Cedar privacy, 6 ft", phone: "(716) 555-0100", house: { url: "https://www.jobflex.app/request/abc" } });
check(
  "the house's email: JobFlex in the subject, a local JobFlex pro will call (and what that means), the request page's link, no 'website'",
  hm.subject === "Your fence, priced — $7,200 – $9,400 — JobFlex" && /Thanks for pricing your fence on JobFlex\./.test(hm.text) && /JobFlex is sending it to a local JobFlex pro, who will be in touch to confirm the details at \(716\) 555-0100\. JobFlex pros are local contractors who run their business on JobFlex — what you priced here opens in their estimator just as you left it\./.test(hm.text) && /Follow your request: https:\/\/www\.jobflex\.app\/request\/abc/.test(hm.text) && !/website/.test(hm.text),
  hm.text,
);

console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);
