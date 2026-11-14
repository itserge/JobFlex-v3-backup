// Live now (2026-09-28, lib/traffic-live): events of the last half hour →
// one line per visitor, where from (an ad or not), how far they got, the
// signups named after the organization the database made. Static imports
// only (tsx has no top-level await).
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/traffic-live.check.ts
import { MAP_HISTORY_LIMIT, MAP_SPANS, buildMapHistoryQuery, isMapSpan, mapHistoryEventsFromRow, mapSpanLabel } from "../../../src/lib/traffic-live";
import { PRESIDENTIAL_2024, partyOf } from "../../../src/lib/usPolitics";
import { TRAFFIC_SINCE_TZ, TRAFFIC_TZ, trafficDayStartMs } from "../../../src/lib/traffic-visitor";
import { AD_PLATFORM_KEYS, adTagsOf, buildLiveQuery, convertedOf, prospectsOf, isAdId, landingTradeOf, buildLiveTotalsQuery, classifySource, liveEventFromRow, liveTotalsFromRow, eventStage, liveHeadline, minutesIntoDay, signupLedgerSummary, signupPlanLabel, signupState, platformCards, screenLabel, shapeLive, shortId, visitSummary, type FreshSignup, type LiveEvent } from "../../../src/lib/traffic-live";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};

// After TRAFFIC_SINCE (2026-09-30, the ad launch): the live window counts nothing before it.
const NOW = Date.parse("2026-10-01T17:30:00Z");
const min = (m: number) => NOW - m * 60_000;
const ev = (p: Partial<LiveEvent> & { person: string; at: number }): LiveEvent => ({
  distinctId: p.person, event: "$pageview", pathname: "/", url: "https://jobflex.app/", sessionId: "s-" + p.person, hostname: "jobflex.app", environment: "production",
  utmSource: "", utmMedium: "", utmCampaign: "", utmContent: "", referrer: "$direct", device: "Desktop", browser: "Chrome", os: "Mac OS X",
  country: "United States", region: "Texas", city: "Dallas", step: "", outcome: "", plan: "", verified: "",
  lat: 32.78, lon: -96.8, countryCode: "US", regionCode: "TX", click: "",
  ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36", browserType: "", ...p,
});

// ── where a visit came from
check("a tagged paid medium is an ad", classifySource("facebook", "paid", "", "jobflex.app").fromAd && classifySource("facebook", "paid", "", "jobflex.app").label === "Facebook ad");
check("google / cpc is a Google ad", classifySource("google", "cpc", "", "").label === "Google ad" && classifySource("google", "cpc", "", "").kind === "ad");
check("an ad platform tagged without a medium is still counted as an ad, and says so", classifySource("fb", "", "", "").fromAd && /tagged, no medium/.test(classifySource("fb", "", "", "").label));
// From an ad = utm_source or fbclid, nothing else (owner, 2026-10-01).
check("an untagged Facebook referrer is Facebook's link, not an ad", !classifySource("", "", "l.facebook.com", "jobflex.app").fromAd && classifySource("", "", "l.facebook.com", "jobflex.app").platform === "facebook" && classifySource("", "", "l.facebook.com", "jobflex.app").kind === "social");
check("Instagram and TikTok referrers likewise", !classifySource("", "", "www.instagram.com", "").fromAd && !classifySource("", "", "www.tiktok.com", "").fromAd);
check("a Google referrer is search, not an ad", !classifySource("", "", "www.google.com", "").fromAd && classifySource("", "", "www.google.com", "").label === "Google search");
check("tagged organic social is a post, not an ad", !classifySource("facebook", "social", "", "").fromAd && /post/.test(classifySource("facebook", "social", "", "").label));
check("no referrer, or the site itself, is Direct", classifySource("", "", "$direct", "jobflex.app").kind === "direct" && classifySource("", "", "jobflex.app", "jobflex.app").kind === "direct" && classifySource("", "", "", "").kind === "direct");
check("another site is a referral by name", classifySource("", "", "www.yelp.com", "").label === "yelp.com" && classifySource("", "", "www.yelp.com", "").kind === "referral");
check("LinkedIn is social, not an ad", classifySource("", "", "www.linkedin.com", "").kind === "social" && !classifySource("", "", "www.linkedin.com", "").fromAd);
// ── the platforms, and the click ids the ad platforms add
check("Meta's own site_source_name fills fb / ig / msg: each credited to its platform", classifySource("fb", "paid", "", "").platform === "facebook" && classifySource("ig", "paid", "", "").platform === "instagram" && classifySource("msg", "paid", "", "").platform === "facebook" && classifySource("ig", "paid", "", "").label === "Instagram ad");
check("a Google click id with no utm tag is named Google, not counted as an ad", !classifySource("", "", "", "", "gclid").fromAd && classifySource("", "", "", "", "gclid").platform === "google" && /click id/.test(classifySource("", "", "", "", "gclid").label));
check("ttclid, twclid and msclkid name TikTok, X and Bing, none an ad without a tag", classifySource("", "", "", "", "ttclid").platform === "tiktok" && classifySource("", "", "", "", "twclid").platform === "x" && classifySource("", "", "", "", "msclkid").platform === "bing" && !classifySource("", "", "", "", "twclid").fromAd);
check("fbclid with no tag is a Facebook ad, referrer or not", classifySource("", "", "", "", "fbclid").platform === "facebook" && classifySource("", "", "", "", "fbclid").fromAd && classifySource("", "", "l.facebook.com", "", "fbclid").fromAd);
check("fbclid does not turn a tagged post into an ad", !classifySource("facebook", "social", "", "", "fbclid").fromAd);
check("search, direct and other sites have their own platform keys", classifySource("", "", "www.google.com", "").platform === "search" && classifySource("", "", "", "").platform === "direct" && classifySource("", "", "www.yelp.com", "").platform === "yelp" && classifySource("", "", "some-blog.com", "").platform === "other");

// ── the window's people
const events: LiveEvent[] = [
  // Ana: a Facebook ad → landing → register → checkout → signed up, 3 minutes ago; now in the dashboard
  ev({ person: "p-ana", at: min(12), utmSource: "facebook", utmMedium: "paid", utmCampaign: "fence-fall", referrer: "l.facebook.com", device: "Mobile", browser: "Mobile Safari" }),
  ev({ person: "p-ana", at: min(10), pathname: "/auth/register" }),
  ev({ person: "p-ana", at: min(9), event: "jf_registration_step_viewed", pathname: "/auth/register", step: "2" }),
  ev({ person: "p-ana", at: min(6), event: "jf_checkout_opened", pathname: "/auth/register" }),
  ev({ person: "p-ana", at: min(3), event: "jf_signup_completed", pathname: "/auth/register", outcome: "trial_started", plan: "pro", verified: "true" }),
  ev({ person: "p-ana", at: min(1), pathname: "/dashboard" }),
  // Ben: Google search, reading the landing 2 minutes ago
  ev({ person: "p-ben", at: min(4), referrer: "www.google.com" }),
  ev({ person: "p-ben", at: min(2), pathname: "/pricing" }),
  // Cal: an untagged Instagram click, on the sign-up form now
  ev({ person: "p-cal", at: min(8), referrer: "www.instagram.com" }),
  ev({ person: "p-cal", at: min(1), event: "jf_registration_step_viewed", pathname: "/auth/register", step: "1" }),
  // Dee: a member in the app, quiet for 20 minutes (left)
  ev({ person: "p-dee", at: min(20), pathname: "/dashboard/jobs" }),
  // Eli: on localhost — a developer, hidden by default
  ev({ person: "p-eli", at: min(1), hostname: "localhost", environment: "development", url: "http://localhost:3000/" }),
  // Fay: too old for the window
  ev({ person: "p-fay", at: min(45), utmSource: "google", utmMedium: "cpc" }),
  // Gus: two visits — an old direct one and a new Facebook-ad one; the source is the NEW visit's
  ev({ person: "p-gus", at: min(28), sessionId: "s-gus-1", referrer: "$direct" }),
  ev({ person: "p-gus", at: min(2), sessionId: "s-gus-2", utmSource: "facebook", utmMedium: "paid_social", utmCampaign: "fence-fall" }),
];
const signups: FreshSignup[] = [
  { orgId: "o1", orgName: "Ana Fence Co", ownerEmail: "ana@example.com", ownerName: "Ana Ruiz", createdAt: new Date(min(2.5)).toISOString(), utmSource: "facebook", utmMedium: "paid", utmCampaign: "fence-fall", landingIndustry: "fence" },
  { orgId: "o2", orgName: "Morning Roofing", ownerEmail: "m@example.com", ownerName: "", createdAt: new Date(min(300)).toISOString(), utmSource: "google", utmMedium: "cpc", utmCampaign: "roof", landingIndustry: "roofing" },
  { orgId: "o3", orgName: "Walk-in Decks", ownerEmail: "w@example.com", ownerName: "", createdAt: new Date(min(400)).toISOString(), utmSource: "", utmMedium: "", utmCampaign: "", landingIndustry: "" },
];
const r = shapeLive(events, signups, NOW);
const by = (id: string) => r.visitors.find((v) => v.id === shortId(id));
check("one line per person: the localhost developer and the visitor past the window are out", r.visitors.length === 5 && !by("p-eli") && !by("p-fay"), r.visitors.map((v) => v.id).join(","));
const ana = by("p-ana")!;
check("Ana signed up: the green stage, from a Facebook ad, named after the organization the database made", ana.stage === "signed-up" && ana.fromAd && ana.source === "Facebook ad" && ana.campaign === "fence-fall" && ana.signup?.orgName === "Ana Fence Co" && ana.signup?.ownerEmail === "ana@example.com" && ana.signup?.plan === "pro" && ana.signup?.outcome === "trial_started", JSON.stringify(ana.signup));
check("…and she is on the dashboard now, three pages in, the trail naming each step, the checkout and the signup", ana.active && ana.page === "/dashboard" && ana.pageLabel === "App · Dashboard" && ana.views === 3 && ana.trail.join(" → ") === "Landing page → Sign-up form → Step 2 / Company → Checkout → Signed up → App · Dashboard", `${ana.page} · ${ana.views} · ${ana.trail.join(" → ")}`);
check("signups sort to the top", r.visitors[0].id === ana.id);
const ben = by("p-ben")!;
check("Ben: Google search, looking around on /pricing, not from an ad", ben.stage === "browsing" && !ben.fromAd && ben.source === "Google search" && ben.page === "/pricing" && ben.active);
const cal = by("p-cal")!;
check("Cal: an untagged Instagram click, on the sign-up form now — Instagram, not counted as an ad", cal.stage === "registering" && !cal.fromAd && cal.sourceKind === "social" && cal.active && cal.pageLabel === "Sign-up form", `${cal.stage} · ${cal.source} · ${cal.pageLabel}`);
check("an app screen is named by its section", (() => { const m = shapeLive([ev({ person: "p-m", at: min(1), pathname: "/dashboard/jobs" })], [], NOW).visitors[0]; return m.pageLabel === "App · Jobs" && m.stage === "member"; })());
const dee = by("p-dee")!;
check("Dee: a member in the app, gone quiet — shown as left", dee.stage === "member" && !dee.active);
const gus = by("p-gus")!;
check("Gus: the source is his NEW visit's (the Facebook ad), not the old direct one", gus.fromAd && gus.source === "Facebook ad" && gus.views === 1 && gus.active);
check("the counts: 4 on now, 2 of them from ads, 1 signing up, 1 signed up, 0 members on now", r.counts.onSite === 4 && r.counts.fromAds === 2 && r.counts.signingUp === 1 && r.counts.signedUp === 1 && r.counts.members === 0, JSON.stringify(r.counts));
check("today: 3 signups, 2 from ads", r.today.signups === 3 && r.today.fromAds === 2, JSON.stringify(r.today));
// ── the platform cards
const cards = r.platforms;
const byKey = (k: string) => cards.find((c) => c.platform === k);
check("the five ad platforms always have a card, ad platforms first", AD_PLATFORM_KEYS.every((k) => byKey(k)) && cards.slice(0, AD_PLATFORM_KEYS.length).every((c) => c.ads), cards.map((c) => c.platform).join(","));
const fb = byKey("facebook")!;
check("Facebook: Ana and Gus, both from ads, Ana signed up, the fence-fall campaign counted twice with one signup", fb.visitors === 2 && fb.fromAds === 2 && fb.organic === 0 && fb.signedUp === 1 && fb.onSite === 2 && fb.campaigns[0]?.campaign === "fence-fall" && fb.campaigns[0]?.visitors === 2 && fb.campaigns[0]?.signedUp === 1, JSON.stringify(fb));
check("Facebook's signups today from the database: Ana's row (facebook / paid)", fb.signedUpToday === 1);
const ig = byKey("instagram")!;
check("Instagram: Cal, untagged, signing up, organic", ig.visitors === 1 && ig.fromAds === 0 && ig.signingUp === 1 && ig.campaigns.length === 0);
const goog = byKey("google")!;
check("Google Ads: nobody in the window, one signup today (Morning Roofing, google / cpc)", goog.visitors === 0 && goog.signedUpToday === 1 && goog.ads);
check("TikTok and X stand at zero, still shown", byKey("tiktok")?.visitors === 0 && byKey("x")?.visitors === 0);
check("Search and Direct come after the ad platforms: Ben on search, Dee direct", byKey("search")?.visitors === 1 && byKey("direct")?.visitors === 1 && cards.indexOf(byKey("search")!) > cards.indexOf(byKey("google")!));
check("a platform without visitors or signups today is left out", !byKey("yelp") && !byKey("linkedin"));
check("platformCards on nothing still lists the ad platforms at zero", platformCards([], []).length === AD_PLATFORM_KEYS.length);
check("the two signups no visitor could be tied to are listed apart, newest first, with their own source", r.otherSignups.length === 2 && r.otherSignups[0].orgName === "Morning Roofing" && r.otherSignups[0].source === "Google ad" && r.otherSignups[1].source === "Untagged", JSON.stringify(r.otherSignups));
const dev = shapeLive(events, signups, NOW, { includeDevelopment: true });
check("with localhost included the developer shows, marked development", dev.visitors.length === 6 && dev.visitors.find((v) => v.id === shortId("p-eli"))?.environment === "development");
// the page's one visitor rule (2026-10-01): a headless browser and a Vercel preview never count, even with localhost on
const outsiders = [
  ev({ person: "p-bot", at: min(1), ua: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 HeadlessChrome/131.0 Safari/537.36" }),
  ev({ person: "p-preview", at: min(1), hostname: "jobflex-v3.vercel.app", url: "https://jobflex-v3.vercel.app/" }),
  ev({ person: "p-noua", at: min(1), ua: "" }),
];
check("a headless browser, a preview deployment and a pageview with no user agent are not visitors", shapeLive([...events, ...outsiders], signups, NOW, { includeDevelopment: true }).visitors.length === 6);
// the counting window (TRAFFIC_SINCE, 2026-10-01): an event before the ad launch is out unless the full history is asked for
const before = ev({ person: "p-old", at: Date.parse("2026-09-29T23:00:00-07:00") });
check("before Sep 30 (Los Angeles) a visitor is not counted; with the full history he is",
  !shapeLive([before], [], Date.parse("2026-09-29T23:10:00-07:00")).visitors.length
  && shapeLive([before], [], Date.parse("2026-09-29T23:10:00-07:00"), { fullHistory: true }).visitors.length === 1);
check("the totals query counts from Sep 30 in Los Angeles, and not when the full history is asked for",
  /timestamp >= toDateTime\('2026-09-30 00:00:00', 'America\/Los_Angeles'\)/.test(buildLiveTotalsQuery("UTC"))
  && !/2026-09-30/.test(buildLiveTotalsQuery("UTC", true)));
// a signup whose campaign tag disagrees is not tied to the row
const wrongTag = shapeLive(events.map((e) => (e.person === "p-ana" ? { ...e, utmCampaign: "other-campaign" } : e)), signups, NOW);
check("a different campaign tag keeps the signup from being tied to the wrong row (still green, unnamed)", wrongTag.visitors[0].stage === "signed-up" && wrongTag.visitors[0].signup === null && wrongTag.otherSignups.length === 3);
check("an empty window is an empty report, not a crash", shapeLive([], [], NOW).visitors.length === 0 && shapeLive([], [], NOW).counts.onSite === 0);
// ── the map: where each one is
check("a visitor carries the place GeoIP gave the browser", ana.lat === 32.78 && ana.lon === -96.8 && ana.countryCode === "US" && ana.regionCode === "TX" && ana.city === "Dallas");
const unplaced = shapeLive([ev({ person: "p-u", at: min(1), lat: null, lon: null, countryCode: "", regionCode: "" })], [], NOW).visitors[0];
check("a visitor without a place is counted but has no pin", unplaced.lat === null && unplaced.lon === null && unplaced.active);
const moved = shapeLive([ev({ person: "p-m2", at: min(9), lat: 47.61, lon: -122.33, city: "Seattle", regionCode: "WA" }), ev({ person: "p-m2", at: min(1), lat: null, lon: null, city: "" })], [], NOW).visitors[0];
check("the place is the latest event that had one", moved.lat === 47.61 && moved.city === "Seattle" && moved.regionCode === "WA");

// ── the query and its rows
const sql = buildLiveQuery();
check("the live query reads the last 30 minutes of the events that matter", /INTERVAL 30 MINUTE/.test(sql) && /'\$pageview'/.test(sql) && /'jf_signup_completed'/.test(sql) && /toUnixTimestamp\(timestamp\) \* 1000/.test(sql) && /LIMIT 7000/.test(sql));
check("the window is clamped", /INTERVAL 5 MINUTE/.test(buildLiveQuery(1)) && /INTERVAL 120 MINUTE/.test(buildLiveQuery(999)));
const row = ["person-1", "anon-1", "$pageview", 1_790_000_000_000, "/", "https://jobflex.app/", "s1", "jobflex.app", "production", "facebook", "paid", "camp", "", "l.facebook.com", "Mobile", "Mobile Safari", "iOS", "United States", "Texas", "Dallas", "", "", "", ""];
const e1 = liveEventFromRow(row);
check("a query row becomes an event", !!e1 && e1.person === "person-1" && e1.at === 1_790_000_000_000 && e1.utmSource === "facebook" && e1.city === "Dallas" && e1.lat === null && e1.countryCode === "");
const e2 = liveEventFromRow([...row, 32.7767, -96.797, "us", "tx"]);
check("the GeoIP columns ride along: numbers for the place, codes upper-cased", !!e2 && e2.lat === 32.7767 && e2.lon === -96.797 && e2.countryCode === "US" && e2.regionCode === "TX");
const e3 = liveEventFromRow([...row, "0", "0", "", ""]);
check("0,0 is no place (GeoIP's nothing), and a lone latitude is dropped too", !!e3 && e3.lat === null && liveEventFromRow([...row, 32.7, null, "US", "TX"])?.lat === null);
check("the query asks for the GeoIP columns and the click ids", /\$geoip_latitude/.test(sql) && /\$geoip_longitude/.test(sql) && /\$geoip_country_code/.test(sql) && /gclid/.test(sql) && /fbclid/.test(sql) && /multiIf/.test(sql));
const e4 = liveEventFromRow([...row, 32.7767, -96.797, "us", "tx", "GCLID"]);
check("the click id column names the id, lower-cased, only when it is one we know", !!e4 && e4.click === "gclid" && liveEventFromRow([...row, 1, 1, "US", "TX", "zzz"])?.click === "");
check("a row without a time or an event is skipped", liveEventFromRow(["p", "d", "$pageview", "x"]) === null && liveEventFromRow(["p", "d", "", 1]) === null);
check("a short id is the tail of the person id", shortId("0192abcd-1234-5678-9abc-def012345678") === "345678" && shortId("abc") === "abc");

// ── the site-wide totals behind the live view (2026-09-30)
const totalsSql = buildLiveTotalsQuery("America/Chicago");
check("the totals query counts people today, yesterday to this hour, the week and all time",
  /uniqExactIf\(person, \(1 = 1\) AND/.test(totalsSql) && /day = today_local/.test(totalsSql)
  && /day = today_local - 1 AND secs <= now_secs/.test(totalsSql) && /INTERVAL 7 DAY/.test(totalsSql)
  && /countIf\(\(day = today_local\) AND/.test(totalsSql));
check("it counts each figure twice, so the localhost switch needs no second query",
  (totalsSql.match(/startsWith\(hostname, '192\.168\.'\)/g) || []).length === 6 && (totalsSql.match(/hostname IN \('www\.jobflex\.app', 'jobflex\.app'\)/g) || []).length === 12);
check("…by the page's one visitor rule: production hosts, no bots, no empty user agent",
  /match\(ua, '\(\?i\)headless/.test(totalsSql) && /browser_type = 'bot'/.test(totalsSql) && /ua = ''/.test(totalsSql));
check("it follows the report's own rules — pageviews, no /admin, localhost by domain when the tag is missing",
  /event = '\$pageview'/.test(totalsSql) && /pathname != '\/admin'/.test(totalsSql)
  && /NOT startsWith\(pathname, '\/admin\/'\)/.test(totalsSql) && /'localhost', '127\.0\.0\.1'/.test(totalsSql));
check("the timezone is the admin's, and only a real zone name reaches the query",
  /'America\/Chicago'/.test(totalsSql) && /'UTC'/.test(buildLiveTotalsQuery("'; DROP TABLE events --"))
  && !/DROP TABLE/.test(buildLiveTotalsQuery("'; DROP TABLE events --")) && /'UTC'/.test(buildLiveTotalsQuery("")));
const pair = liveTotalsFromRow([900, 700, 120, 90, 100, 80, 450, 400, 61, 50, 310, 240]);
check("the row reads as two sets: everyone, and everyone but localhost",
  pair.all.allTime === 900 && pair.production.allTime === 700
  && pair.all.today === 120 && pair.production.today === 90
  && pair.all.yesterdaySoFar === 100 && pair.production.yesterdaySoFar === 80
  && pair.all.yesterday === 450 && pair.production.yesterday === 400
  && pair.all.last7Days === 61 && pair.production.last7Days === 50
  && pair.all.viewsToday === 310 && pair.production.viewsToday === 240);
const empty = liveTotalsFromRow([]);
check("a missing or unreadable total is zero, never NaN",
  empty.all.allTime === 0 && empty.production.today === 0
  && liveTotalsFromRow(["12", null, "x", -4, undefined, "", 0, 0, 0, 0, 0, 0]).all.allTime === 12
  && liveTotalsFromRow(["12", null, "x", -4, undefined, "", 0, 0, 0, 0, 0, 0]).all.today === 0);
check("shapeLive leaves the totals to the server fetch that caches them",
  shapeLive([], [], NOW, {}).totals === null);

// ── what the visitor is doing, in words (2026-09-30)
check("the auth screens are named, not left as paths",
  screenLabel("/auth/login") === "Signing in" && screenLabel("/auth/reset") === "Setting a new password"
  && screenLabel("/auth/forgot") === "Forgot password" && screenLabel("/auth/register") === "Sign-up form"
  && screenLabel("/auth/verify") === "Verifying their email");
check("a trailing slash does not defeat the name", screenLabel("/auth/login/") === "Signing in");
check("the app's own screens and unknown paths are unchanged",
  screenLabel("/dashboard/jobs") === "App · Jobs" && screenLabel("/fencing") === "/fencing");

// Someone at the login screen is a customer coming back, not a stranger.
const signin = shapeLive([ev({ person: "rae", at: min(6), pathname: "/auth/login" })], [], NOW, {}).visitors[0];
check("a visitor at the login screen is signing in, not browsing",
  signin.stage === "signing-in" && !signin.lockedOut && /existing customer signing back in/i.test(signin.summary),
  `${signin.stage} — ${signin.summary}`);

// The locked-out corner of it.
const locked = shapeLive([
  ev({ person: "sam", at: min(9), pathname: "/auth/forgot" }),
  ev({ person: "sam", at: min(4), pathname: "/auth/reset" }),
], [], NOW, {}).visitors[0];
check("asking for a password reset is flagged locked out and said in words",
  locked.stage === "signing-in" && locked.lockedOut && /locked out/i.test(locked.summary),
  `${locked.stage} · lockedOut=${locked.lockedOut} — ${locked.summary}`);

// Getting back in outranks signing in: the dashboard wins the stage.
const recovered = shapeLive([
  ev({ person: "tom", at: min(12), pathname: "/auth/forgot" }),
  ev({ person: "tom", at: min(8), pathname: "/auth/reset" }),
  ev({ person: "tom", at: min(2), pathname: "/dashboard" }),
], [], NOW, {}).visitors[0];
check("a reset that ends in the app reads as a member who got back in",
  recovered.stage === "member" && recovered.lockedOut && /got back in/i.test(recovered.summary),
  `${recovered.stage} — ${recovered.summary}`);

// What they pressed rides along with the visit.
const clicked = shapeLive([
  ev({ person: "uma", at: min(10), pathname: "/" }),
  ev({ person: "uma", at: min(9), event: "cta_click", pathname: "/", placement: "hero", label: "Start free trial" }),
  ev({ person: "uma", at: min(8), pathname: "/pricing" }),
], [], NOW, {}).visitors[0];
check("the button they pressed is carried, newest first, with where it sits",
  clicked.clicks.length === 1 && clicked.clicks[0].label === "Start free trial" && clicked.clicks[0].placement === "hero"
  && /Start free trial/.test(clicked.summary) && /hero/.test(clicked.summary),
  clicked.summary);
check("a visit with no tracked click simply has none", signin.clicks.length === 0);
check("the query asks for the click's own words", /properties\.placement/.test(sql) && /properties\.label/.test(sql));
check("the row parser reads them", liveEventFromRow([...row, 1, 1, "US", "TX", "", "hero", "Start free trial"])?.label === "Start free trial");

// The sentence is written from what was seen, and never overclaims.
check("a one-page visit that left is called a bounce, and an ad click says so",
  /without opening a second page/i.test(visitSummary({ stage: "browsing", lockedOut: false, views: 1, trail: ["Landing page"], clicks: [], active: false, signup: null, step: 0, fromAd: true, source: "Facebook ad" }))
  && /an ad click that bounced/i.test(visitSummary({ stage: "browsing", lockedOut: false, views: 1, trail: ["Landing page"], clicks: [], active: false, signup: null, step: 0, fromAd: true, source: "Facebook ad" })));
check("a half-filled sign-up form names the step it stopped on",
  /step 2/i.test(visitSummary({ stage: "registering", lockedOut: false, views: 2, trail: [], clicks: [], active: false, signup: null, step: 2, fromAd: false, source: "Direct" })));
check("a signup names the account the database made",
  /Acme Roofing/.test(visitSummary({ stage: "signed-up", lockedOut: false, views: 4, trail: [], clicks: [], active: true, signup: { orgName: "Acme Roofing" }, step: 3, fromAd: false, source: "Direct" })));

// ── the section in one sentence (2026-10-01)
const base = { onSite: 0, fromAds: 0, signingUp: 0, windowVisitors: 0, windowMinutes: 30,
  todayVisitors: 0, todaySignups: 0, yesterdaySoFar: 0, yesterdayTotal: 0, dayAgeMinutes: 600,
  topPlatform: null as { name: string; visitors: number } | null };

check("the hour of the day is read in the admin's zone",
  minutesIntoDay("UTC", new Date("2026-10-01T00:12:00Z")) === 12
  && minutesIntoDay("UTC", new Date("2026-10-01T16:30:00Z")) === 990
  && minutesIntoDay("America/Los_Angeles", new Date("2026-10-01T07:00:00Z")) === 0);
check("an unreadable timezone does not throw, it reads midnight", minutesIntoDay("Not/AZone") === 0);

// The case that made the page look broken: just past midnight, everything 0.
const midnight = liveHeadline({ ...base, dayAgeMinutes: 12, todayVisitors: 0, yesterdayTotal: 62, yesterdaySoFar: 0 });
check("just after midnight it says the day is minutes old, not a bare zero",
  /Quiet/.test(midnight) && /No visitors yet today/.test(midnight) && /12 minutes old/.test(midnight) && /yesterday finished at 62/.test(midnight),
  midnight);
check("it never prints a percent against a yesterday that had nobody", !/%/.test(midnight));

const busy = liveHeadline({ ...base, onSite: 4, fromAds: 3, signingUp: 1, windowVisitors: 9,
  todayVisitors: 120, yesterdaySoFar: 90, yesterdayTotal: 300, todaySignups: 2,
  topPlatform: { name: "Facebook", visitors: 6 } });
check("a busy hour names who is here, who sent them, and how the day compares",
  /4 people are on the site right now/.test(busy) && /3 of them from an ad/.test(busy)
  && /1 is filling in the sign-up form/.test(busy) && /Facebook brought the most of them \(6\)/.test(busy)
  && /33% ahead of this time yesterday/.test(busy) && /2 signed up today/.test(busy),
  busy);

const lull = liveHeadline({ ...base, windowVisitors: 5, todayVisitors: 70, yesterdaySoFar: 70 });
check("nobody on now but people in the window reads as a lull, and a level day says level",
  /Nobody on the site this minute, but 5 came through in the last 30 minutes/.test(lull)
  && /level with this time yesterday/.test(lull) && /No signups yet today/.test(lull),
  lull);

const behind = liveHeadline({ ...base, windowVisitors: 1, todayVisitors: 50, yesterdaySoFar: 100 });
check("a day running behind says so", /50% behind this time yesterday/.test(behind), behind);
check("with no totals it simply says nothing about the day",
  !/today/i.test(liveHeadline({ ...base, todayVisitors: null, yesterdaySoFar: null, yesterdayTotal: null })));
check("one person reads as one person",
  /1 person is on the site right now/.test(liveHeadline({ ...base, onSite: 1, todayVisitors: 5, yesterdaySoFar: 5 })));

// ── "they signed up — but for what?" (2026-10-01)
const NOWMS = Date.parse("2026-10-01T12:00:00Z");
const sub = (plan: string, subStatus: string, trialEndsAt: string | null = null) => signupPlanLabel({ plan, subStatus, trialEndsAt }, NOWMS);
check("a free trial says so, and how long is left",
  sub("PROFESSIONAL", "TRIALING", "2026-10-13T12:00:00Z") === "Free trial · Professional · 12 days left"
  && sub("FREE", "TRIALING", "2026-10-02T12:00:00Z") === "Free trial · 1 day left"
  && sub("FREE", "TRIALING", "2026-10-01T18:00:00Z") === "Free trial · ends today",
  sub("PROFESSIONAL", "TRIALING", "2026-10-13T12:00:00Z"));
check("a trial whose date has passed is not called days left",
  sub("STARTER", "TRIALING", "2026-09-28T12:00:00Z") === "Free trial · Starter · trial expired");
check("a trial with no end date still reads as a trial", sub("STARTER", "TRIALING", null) === "Free trial · Starter");
check("a new plan is named by its size, never by the stored slug (owner, 2026-11-12)",
  sub("TOOLS-BASIC", "TRIALING", "2026-10-07T12:00:00Z") === "Free trial · Basic · 6 days left"
  && sub("tools-professional", "ACTIVE") === "Professional · paying"
  && sub("TOOLS-ADVANCED", "CANCELED") === "Advanced · canceled",
  sub("TOOLS-BASIC", "TRIALING", "2026-10-07T12:00:00Z"));
check("paying, failing, canceled and free each read as themselves",
  sub("PROFESSIONAL", "ACTIVE") === "Professional · paying"
  && sub("STARTER", "PAST_DUE") === "Starter · payment failed"
  && sub("STARTER", "CANCELED") === "Starter · canceled"
  && sub("STARTER", "EXPIRED") === "Starter · expired"
  && sub("FREE", "FREE") === "Free plan");
check("an account with no subscription row says so instead of being called free",
  sub("", "") === "no subscription row yet");
check("an unknown status is printed, not swallowed", sub("STARTER", "SOMETHING_NEW") === "Starter · something new");
check("the label rides along with a matched signup and with one that aged out",
  typeof shapeLive([], [], NOW, {}).otherSignups === "object");

// ── the signup ledger: the record that outlasts the window (2026-10-01)
check("a subscription status folds to the state its colour and count use",
  signupState("TRIALING") === "trial" && signupState("ACTIVE") === "paying"
  && signupState("PAST_DUE") === "lapsed" && signupState("CANCELED") === "lapsed" && signupState("EXPIRED") === "lapsed"
  && signupState("FREE") === "free" && signupState("") === "unknown" && signupState("whatever") === "unknown");
check("the state reading is not case- or space-sensitive", signupState("  trialing ") === "trial");

const rec = (state: ReturnType<typeof signupState>, fromAd = false) => ({
  orgId: Math.random().toString(36).slice(2), orgName: "Org", ownerName: "", ownerEmail: "",
  createdAt: "2026-10-01T00:00:00Z", source: "Direct", fromAd, platform: "direct",
  campaign: "", content: "", industry: "", planLabel: "", state,
});
const led = signupLedgerSummary([rec("trial", true), rec("trial"), rec("paying", true), rec("lapsed"), rec("free"), rec("unknown")]);
check("the ledger counts the span by state, and how many came from ads",
  led.total === 6 && led.trial === 2 && led.paying === 1 && led.lapsed === 1 && led.free === 1 && led.unknown === 1 && led.fromAds === 2,
  JSON.stringify(led));
check("an empty span counts zero of everything, not NaN",
  Object.values(signupLedgerSummary([])).every((v) => v === 0));

// ── names for ads, the trade they came for, the member in the app (2026-10-01)
check("the landing's ?industry= / ?trade= names the trade the ad sent them to",
  landingTradeOf(["https://jobflex.app/?industry=roofing&utm_source=fb"]) === "Roofing" && landingTradeOf(["https://jobflex.app/?trade=hvac"]) === "HVAC" &&
  landingTradeOf(["/", "https://jobflex.app/?industry=Kitchen%20%26%20Bath"]) === "Kitchen & Bath" && landingTradeOf(["https://jobflex.app/"]) === "" && landingTradeOf(["https://jobflex.app/?industry=nonsense"]) === "");
const fenceAd = shapeLive([ev({ person: "p-fence", at: min(2), url: "https://jobflex.app/?industry=fencing&utm_campaign=120248923877540280", utmSource: "fb", utmMedium: "paid", utmCampaign: "120248923877540280" })], [], NOW).visitors[0];
check("a visit off the fencing landing is labelled Fencing, its campaign id kept as it came", fenceAd.trade === "Fencing" && fenceAd.campaign === "120248923877540280" && fenceAd.fromAd);
const inApp = shapeLive([ev({ person: "p-mem", at: min(3), pathname: "/dashboard/jobs" }), ev({ person: "p-mem", at: min(1), pathname: "/dashboard/calendar", orgId: "org_1", userId: "user_1" })], [], NOW).visitors[0];
check("a member's visit carries the organization and user ids its events sent", inApp.stage === "member" && inApp.orgId === "org_1" && inApp.userId === "user_1");
check("a visitor with no ids is nobody's member", by("p-ana")!.orgId === "" && by("p-ana")!.userId === "");
const idRow = liveEventFromRow([...row, 32.7767, -96.797, "us", "tx", "", "", "", "org_9", "user_9"]);
check("the query asks for the member ids and the parser reads them", /jf_org_id/.test(sql) && /jf_user_id/.test(sql) && idRow?.orgId === "org_9" && idRow?.userId === "user_9");
check("a long run of digits is an ad id worth naming; a written name is not", isAdId("120248923877540280") && !isAdId("roof-40s-v1") && !isAdId("2026"));
check("the tags to look names up for are every campaign and ad the report shows", adTagsOf(r).includes(ana.campaign) && adTagsOf({ visitors: [fenceAd], platforms: [] }).includes("120248923877540280"));

// ── the journey: every step with its stage (2026-10-02)
const kinds = (v: { steps: Array<{ label: string; kind: string }> }) => v.steps.map((x) => `${x.label}:${x.kind}`).join(" > ");
check("Ana's journey carries a stage per step, from the landing to the app",
  kinds(ana) === "Landing page:browsing > Sign-up form:registering > Step 2 / Company:registering > Checkout:checkout > Signed up:signed-up > App · Dashboard:member", kinds(ana));
check("the locked-out customer's journey is cyan until the app turns it near-black",
  kinds(recovered) === "Forgot password:signing-in > Setting a new password:signing-in > App · Dashboard:member", kinds(recovered));
check("a bounce is one step", signin.steps.length === 1 && signin.steps[0].kind === "signing-in" && clicked.steps.length === 2);
check("a repeat screen folds into its neighbour, and the step keeps the later time",
  shapeLive([ev({ person: "x", at: min(9), pathname: "/" }), ev({ person: "x", at: min(8), pathname: "/" }), ev({ person: "x", at: min(7), pathname: "/pricing" })], [], NOW, {}).visitors[0].steps.map((x) => x.label).join(">") === "Landing page>Pricing");
check("eventStage reads one event the way the ranking does",
  eventStage(ev({ person: "e", at: NOW, pathname: "/auth/register" })) === "registering" && eventStage(ev({ person: "e", at: NOW, pathname: "/dashboard" })) === "member"
  && eventStage(ev({ person: "e", at: NOW, pathname: "/auth/reset" })) === "signing-in" && eventStage(ev({ person: "e", at: NOW, pathname: "/pricing" })) === "browsing");

console.log(bad ? `\n${bad} failing` : "\nall green");

// ── prospects (owner, 2026-10-02): new visitors trying to convert, no members; a convert stays a day
// One query since 2026-11-02: the window OR the last day of everyone who completed a signup in it.
check("the same query reads the last day of everyone who completed a signup in it, with the live columns", /INTERVAL 24 HOUR AND event IN/.test(sql) && /AND \(timestamp > now\(\) - INTERVAL 30 MINUTE\s+OR distinct_id IN \(SELECT distinct_id FROM events WHERE event = 'jf_signup_completed' AND timestamp > now\(\) - INTERVAL 24 HOUR\)\)/.test(sql) && /jf_org_id/.test(sql));
const rows = [ev({ person: "p-new", distinctId: "d-new", at: min(2) }), ev({ person: "p-conv", distinctId: "d-conv", at: min(180), pathname: "/auth/register" }), ev({ person: "p-conv", distinctId: "d-conv", at: min(178), event: "jf_signup_completed", verified: "true" })];
const conv = convertedOf(rows);
check("convertedOf takes the converts back out — every event of a distinct id that completed, nobody else", conv.length === 2 && conv.every((e) => e.distinctId === "d-conv") && convertedOf(rows.slice(0, 1)).length === 0);
check("the window's half is shaped by time: the convert's three-hour-old events stay out of it", shapeLive(rows, [], NOW).visitors.map((v) => v.id).join() === shapeLive(rows.slice(0, 1), [], NOW).visitors.map((v) => v.id).join());
const dayWin = shapeLive([ev({ person: "p-old", at: min(180), pathname: "/auth/register" }), ev({ person: "p-old", at: min(178), event: "jf_signup_completed", pathname: "/auth/register", outcome: "trial_started", plan: "pro", verified: "true", city: "Denver" })], [], NOW, { windowMinutes: 24 * 60 });
check("a day-long window shapes a three-hour-old signup as signed up, and says the window is a day", dayWin.visitors.length === 1 && dayWin.visitors[0].stage === "signed-up" && dayWin.windowMinutes === 1440 && dayWin.converted.length === 0);
check("the half-hour window does not hold it", shapeLive([ev({ person: "p-old", at: min(180) })], [], NOW).visitors.length === 0 && shapeLive([], [], NOW).windowMinutes === 30);
const member = shapeLive([ev({ person: "p-mem2", at: min(2), pathname: "/dashboard/jobs", orgId: "org_2", userId: "user_2" })], [], NOW).visitors[0];
const memberConv = shapeLive([ev({ person: "p-mem2", at: min(130), pathname: "/auth/register" }), ev({ person: "p-mem2", at: min(128), event: "jf_signup_completed", pathname: "/auth/register", verified: "true", plan: "starter" }), ev({ person: "p-mem2", at: min(2), pathname: "/dashboard/jobs", orgId: "org_2", userId: "user_2" })], [], NOW, { windowMinutes: 1440 }).visitors[0];
const signinV = shapeLive([ev({ person: "p-in", at: min(3), pathname: "/auth/login" })], [], NOW).visitors[0];
const looker = shapeLive([ev({ person: "p-look", at: min(1), pathname: "/pricing" })], [], NOW).visitors[0];
const pros = prospectsOf([member, signinV, looker], [dayWin.visitors[0], memberConv], NOW);
check("prospects: the looker stays, the customer signing in and the member go, the day's converts come", pros.length === 3 && pros.some((v) => v.id === looker.id) && !pros.some((v) => v.id === signinV.id) && pros.some((v) => v.id === dayWin.visitors[0].id), pros.map((v) => `${v.id}:${v.stage}`).join(" "));
const mergedMember = pros.find((v) => v.id === member.id);
check("a member who signed up two hours ago is on it as signed up, with the window's fresh page and the signup's time", !!mergedMember && mergedMember.stage === "signed-up" && mergedMember.page === "/dashboard/jobs" && mergedMember.signedUpAt === memberConv.signedUpAt && mergedMember.orgId === "org_2");
check("a convert older than a day is gone", prospectsOf([], [{ ...dayWin.visitors[0], signedUpAt: new Date(NOW - 25 * 3_600_000).toISOString() }], NOW).length === 0);
check("a convert is listed once, even when the window holds them too", prospectsOf([dayWin.visitors[0]], [dayWin.visitors[0]], NOW).length === 1);
check("the tags to name include the converts' ads", adTagsOf({ visitors: [], platforms: [], converted: [{ ...looker, campaign: "120248923877540999" }] }).includes("120248923877540999"));

// ── the map over longer spans (owner, 2026-10-03): 1 h to a month, one row per person
check("the spans run from 5 min to a month, labelled the way the buttons read",
  MAP_SPANS.map(mapSpanLabel).join("|") === "Now · 5 min|30 min|1 h|4 h|6 h|12 h|1 day|3 days|7 days|Month", MAP_SPANS.map(mapSpanLabel).join("|"));
check("isMapSpan takes a span and nothing else", isMapSpan(240) && isMapSpan("1440") && isMapSpan(43200) && !isMapSpan(61) && !isMapSpan(null) && !isMapSpan("month"));
const hq = buildMapHistoryQuery(1440);
const selectColumns = (sql: string) => {
  const body = sql.slice(sql.indexOf("SELECT") + 6, sql.indexOf("FROM events"));
  let depth = 0, quoted = false, n = 1;
  for (const ch of body) {
    if (ch === "'") quoted = !quoted;
    else if (!quoted && ch === "(") depth++;
    else if (!quoted && ch === ")") depth--;
    else if (!quoted && depth === 0 && ch === ",") n++;
  }
  return n;
};
// The visitor rule's \\b is the live query's own; the new columns carry no backslash.
check("the span query: one row per person, newest first, capped, its columns free of backslashes, balanced",
  /INTERVAL 1440 MINUTE/.test(hq) && new RegExp(`GROUP BY pid ORDER BY last_seen DESC LIMIT ${MAP_HISTORY_LIMIT}$`).test(hq) && !hq.slice(0, hq.indexOf("FROM events")).includes("\\") && hq.split("(").length === hq.split(")").length);
check("the span query returns the 39 columns the row reader reads", selectColumns(hq) === 39, String(selectColumns(hq)));
check("the span is held between the half hour and a month", /INTERVAL 43200 MINUTE/.test(buildMapHistoryQuery(99999)) && /INTERVAL 30 MINUTE/.test(buildMapHistoryQuery(1)));
check("the span query keeps the page's visitor rule and the ad-launch floor", hq.includes("jobflex.app") && /2026-09-30/.test(hq) && !/2026-09-30/.test(buildMapHistoryQuery(1440, { fullHistory: true })));
const hrow = (o: Record<number, unknown>) => {
  const r: unknown[] = Array(39).fill("");
  Object.assign(r, { 0: "0192aa00-1111-2222-3333-444455556666", 1: "d-ad", 2: NOW - 5 * 3_600_000, 3: NOW - 2 * 3_600_000, 4: 6, 22: "Desktop", 23: "Chrome", 24: "Mac OS X",
    25: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36", 27: "jobflex.app", 28: "production",
    31: 0, 34: 0, 35: 0, 36: 0, 15: null, 16: null });
  for (const [k, v] of Object.entries(o)) r[Number(k)] = v;
  return r;
};
const adRow = mapHistoryEventsFromRow(hrow({ 5: "/", 6: "https://jobflex.app/?utm_source=fb", 7: "l.facebook.com", 8: "fb", 9: "paid", 10: "120248923877540999", 11: "120248923877541000", 12: "fbclid",
  13: "/dashboard/jobs", 14: "https://jobflex.app/dashboard/jobs", 15: 32.78, 16: -96.8, 17: "Dallas", 18: "Texas", 19: "tx", 20: "United States", 21: "us",
  29: "org_9", 30: "user_9", 31: NOW - 3 * 3_600_000, 32: "pro", 33: "trial_started", 37: "/dashboard" }));
check("a row reads back as its events: first touch, the signup, the app, the last page — the last one carries the place",
  !!adRow && adRow.views === 6 && adRow.events.map((e) => e.event === "$pageview" ? e.pathname : e.event).join(" > ") === "/ > jf_signup_completed > /dashboard > /dashboard/jobs"
  && adRow.events[adRow.events.length - 1].regionCode === "TX" && adRow.events.slice(0, -1).every((e) => e.at < adRow.events[adRow.events.length - 1].at && e.lat === null),
  adRow?.events.map((e) => `${e.event}:${e.pathname}@${e.at}`).join(" "));
const adDay = shapeLive(adRow?.events ?? [], [], NOW, { windowMinutes: 1440 + 10 }).visitors;
check("…and shapes into one visitor from a Facebook ad who signed up, now in the app, pinned in Dallas",
  adDay.length === 1 && adDay[0].fromAd && adDay[0].platform === "facebook" && adDay[0].stage === "signed-up" && adDay[0].page === "/dashboard/jobs"
  && adDay[0].lat === 32.78 && adDay[0].regionCode === "TX" && adDay[0].campaign === "120248923877540999" && adDay[0].orgId === "org_9", JSON.stringify(adDay[0] ?? null).slice(0, 300));
const lostRow = mapHistoryEventsFromRow(hrow({ 0: "0192bb00-1111-2222-3333-444455557777", 5: "/auth/login", 13: "/auth/reset", 38: "/auth/reset", 15: 0, 16: 0 }));
const lost = shapeLive(lostRow?.events ?? [], [], NOW, { windowMinutes: 1440 + 10 }).visitors[0];
check("a customer locked out is signing in, and a 0,0 place is no place", !!lost && lost.stage === "signing-in" && lost.lockedOut && lost.lat === null && lost.lon === null, JSON.stringify(lost ?? null).slice(0, 200));
const stepRow = mapHistoryEventsFromRow(hrow({ 0: "0192cc00-1111-2222-3333-444455558888", 5: "/", 13: "/auth/register", 35: NOW - 2 * 3_600_000 - 5000, 36: 3 }));
const stepper = shapeLive(stepRow?.events ?? [], [], NOW, { windowMinutes: 1440 + 10 }).visitors[0];
check("a sign-up step reads as registering, with its number", !!stepper && stepper.stage === "registering" && stepper.steps.some((x) => x.kind === "registering" && /3/.test(x.label)), JSON.stringify(stepper?.steps ?? null));
check("a row without a person or a time is skipped", mapHistoryEventsFromRow(hrow({ 0: "" })) === null && mapHistoryEventsFromRow(hrow({ 3: 0 })) === null);
// ── the states in red and blue: the 2024 presidential vote
check("every state and DC is painted, 20 blue and 31 red", Object.keys(PRESIDENTIAL_2024).length === 51 && Object.values(PRESIDENTIAL_2024).filter((p) => p === "D").length === 20);
check("the swing states as they went in 2024, a territory unpainted", ["PA", "MI", "WI", "GA", "AZ", "NV", "NC"].every((c) => partyOf(c) === "R") && partyOf("mn") === "D" && partyOf("NH") === "D" && partyOf("VA") === "D" && partyOf("PR") === null && partyOf(null) === null);

// ── one day for the whole live view (2026-10-04): local midnight in America/Los_Angeles.
// "Signed up today" was the last 24 hours of rows while "Visitors today" was
// the LA day, so at midnight one card emptied and the other did not. The
// instants below are chosen so the UTC day and the LA day disagree.
const LA = (clock: string) => Date.parse(`2026-10-${clock}-07:00`); // PDT
const org = (id: string, at: number, utmSource = ""): FreshSignup => ({ orgId: id, orgName: id, ownerEmail: `${id}@example.com`, ownerName: "", createdAt: new Date(at).toISOString(), utmSource, utmMedium: utmSource ? "paid" : "", utmCampaign: "", landingIndustry: "" });
check("the page's zone is one constant, and the ad launch is read in it", TRAFFIC_TZ === "America/Los_Angeles" && TRAFFIC_SINCE_TZ === TRAFFIC_TZ);
check("the day starts at local midnight in Los Angeles, not at UTC midnight",
  trafficDayStartMs(LA("02T00:10:00")) === LA("02T00:00:00") && trafficDayStartMs(LA("01T23:50:00")) === LA("01T00:00:00")
  && new Date(trafficDayStartMs(LA("02T00:10:00"))).toISOString() === "2026-10-02T07:00:00.000Z");
check("…also on the days the clocks change: Nov 1 starts at midnight PDT and is 25 hours long, Mar 14 2027 at midnight PST",
  trafficDayStartMs(Date.parse("2026-11-01T22:00:00-08:00")) === Date.parse("2026-11-01T00:00:00-07:00")
  && trafficDayStartMs(Date.parse("2027-03-14T22:00:00-07:00")) === Date.parse("2027-03-14T00:00:00-08:00"));
// 23:50 LA on Oct 1 and 00:10 LA on Oct 2 are both Oct 2 in UTC (06:50Z, 07:10Z): a UTC day would count it.
const late = org("late", LA("01T23:50:00"), "facebook");
const atTen = shapeLive([], [late], LA("02T00:10:00"));
check("a signup at 23:50 LA is not counted at 00:10 LA — though both are the same UTC day and 20 minutes apart",
  late.createdAt.slice(0, 10) === new Date(LA("02T00:10:00")).toISOString().slice(0, 10)
  && atTen.today.signups === 0 && atTen.today.fromAds === 0 && atTen.otherSignups.length === 0 && atTen.platforms.every((p) => p.signedUpToday === 0),
  JSON.stringify(atTen.today));
const early = org("early", LA("02T00:05:00"), "facebook");
const both = shapeLive([], [late, early], LA("02T00:10:00"));
check("a signup at 00:05 LA is counted at 00:10 LA: the card, its \"from ads\", the platform card and the list under them",
  both.today.signups === 1 && both.today.fromAds === 1 && both.otherSignups.length === 1 && both.otherSignups[0].orgName === "early"
  && both.platforms.find((p) => p.platform === "facebook")?.signedUpToday === 1, JSON.stringify(both.today));
// 16:30 LA and 17:30 LA on Oct 1 straddle UTC midnight (23:30Z, 00:30Z): a UTC day would drop it.
check("a signup at 16:30 LA is still today at 17:30 LA, though UTC has turned the day in between",
  shapeLive([], [org("afternoon", LA("01T16:30:00"))], LA("01T17:30:00")).today.signups === 1
  && new Date(LA("01T16:30:00")).toISOString().slice(0, 10) !== new Date(LA("01T17:30:00")).toISOString().slice(0, 10));
check("the last minute of the day still counts everything since its midnight, 23 hours back",
  shapeLive([], [org("dawn", LA("01T00:00:30")), org("eve", LA("01T23:58:00"))], LA("01T23:59:00")).today.signups === 2);
// Yesterday's row is still used to NAME a visit that is on the list across midnight — only the count leaves it out.
const across = shapeLive([
  ev({ person: "p-mid", at: LA("01T23:45:00"), pathname: "/auth/register" }),
  ev({ person: "p-mid", at: LA("01T23:50:00"), event: "jf_signup_completed", pathname: "/auth/register", outcome: "trial_started", plan: "pro", verified: "true" }),
], [late], LA("02T00:10:00"));
check("a visit that signed up at 23:50 is still named after its account at 00:10; today's count stays at zero",
  across.visitors[0]?.signup?.orgName === "late" && across.today.signups === 0, JSON.stringify(across.today));
check("the sentence under the cards says today's count, and says nothing of signups on a day minutes old with none",
  /1 signed up today/.test(liveHeadline({ ...base, todayVisitors: 3, todaySignups: both.today.signups, dayAgeMinutes: 10 }))
  && !/signed up today/.test(liveHeadline({ ...base, todayVisitors: 0, todaySignups: atTen.today.signups, dayAgeMinutes: 10, yesterdayTotal: 62 })));
check("visitors today and yesterday-to-this-hour are cut by the same local day in the query",
  /toDate\(toTimeZone\(now\(\), 'America\/Los_Angeles'\)\) AS today_local/.test(buildLiveTotalsQuery(TRAFFIC_TZ)) && /toTimeZone\(timestamp, 'America\/Los_Angeles'\) AS lts/.test(buildLiveTotalsQuery(TRAFFIC_TZ)));

process.exit(bad ? 1 : 0);
