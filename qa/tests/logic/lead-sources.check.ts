// Where a lead came from (2026-10-16, lib/leads/sources) and how a visit was
// booked (lib/calendar/visitVia): JobFlex's leads apart from the contractor's
// own, every old spelling of a source mapped to one key, a contractor never
// able to label a lead as JobFlex's, marketplace emails recognised, and the
// AI desk's visits told apart from online bookings, plan visits and the
// office's own. Pure: no database.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/lead-sources.check.ts
import {
  IMPORTABLE_SOURCES,
  LEAD_SOURCES,
  PICKABLE_SOURCES,
  detectEmailSource,
  leadSide,
  leadSourceKey,
  leadSourceOf,
  ownSourceCounts,
  sideCounts,
  sourceFromCell,
  storableSource,
} from "../../../src/lib/leads/sources";
import { bookingScope } from "../../../src/lib/booking";
import { VISIT_VIA, aptSourceKey, bookedLine, bookingNoteHead, parseAptSource, visitVia } from "../../../src/lib/calendar/visitVia";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};

// ── The two sides ───────────────────────────────────────────────────────────
check("LEAD_CENTER is JobFlex's", leadSide("LEAD_CENTER") === "jobflex");
check("…in any spelling", ["lead_center", "Lead Center", "LEADCENTER", "platform", "JobFlex"].every((v) => leadSide(v) === "jobflex"));
check("everything else is the contractor's own", ["FACEBOOK", "EMAIL", "BOOKING", "phone", "MANUAL", "IMPORT", "Craigslist", "", null].every((v) => leadSide(v as string | null) === "own"));
check("only one source is on the JobFlex side", LEAD_SOURCES.filter((s) => s.side === "jobflex").length === 1);
check("every key is distinct", new Set(LEAD_SOURCES.map((s) => s.key)).size === LEAD_SOURCES.length);
check("no alias means two sources", (() => { const seen = new Map<string, string>(); for (const s of LEAD_SOURCES) for (const a of s.aliases) { if (seen.has(a) && seen.get(a) !== s.key) return false; seen.set(a, s.key); } return true; })());

// ── Old spellings → one key ─────────────────────────────────────────────────
check("the AI desk's old \"phone\" is the AI desk", leadSourceKey("phone") === "ai-desk" && leadSourceKey("AI_DESK") === "ai-desk");
check("a call taken by hand is not the AI desk", leadSourceKey("PHONE_CALL") === "phone");
check("Meta lead ads are Facebook", ["FACEBOOK", "facebook", "META", "fb"].every((v) => leadSourceKey(v) === "facebook"));
check("the old homeowner form is Website", ["FORM", "HOMEOWNER", "website", "contact-form"].every((v) => leadSourceKey(v) === "website"));
check("a blank source reads as added by hand", leadSourceKey("") === "manual" && leadSourceKey(null) === "manual");
check("an unknown source keeps its own name under Other", leadSourceOf("craigslist").key === "other" && leadSourceOf("craigslist").label === "Craigslist");
check("…and a very long one does not flood the badge", leadSourceOf("x".repeat(80)).label === "Other");
check("HomeAdvisor is Angi", leadSourceKey("HomeAdvisor") === "angi");

// ── A contractor can never say "JobFlex sent this" ──────────────────────────
check("LEAD_CENTER is not importable", !IMPORTABLE_SOURCES.includes("LEAD_CENTER"));
check("storableSource refuses LEAD_CENTER", storableSource("LEAD_CENTER", "IMPORT") === "IMPORT" && storableSource("jobflex") === "MANUAL" && storableSource("Lead Center") === "MANUAL");
check("storableSource keeps a real own source", storableSource("facebook") === "FACEBOOK" && storableSource("Thumbtack") === "THUMBTACK" && storableSource("walk-in") === "WALK_IN");
check("storableSource maps an alias to the stored value", storableSource("phone") === "AI_DESK" && storableSource("META") === "FACEBOOK");
check("…and turns junk into the fallback", storableSource("<script>", "IMPORT") === "IMPORT" && storableSource("", "MANUAL") === "MANUAL");
check("the add-by-hand picker never offers JobFlex, the AI desk or online booking", PICKABLE_SOURCES.every((s) => s.side === "own" && s.key !== "ai-desk" && s.key !== "booking"));
check("…and every pickable value is storable as itself", PICKABLE_SOURCES.every((s) => storableSource(s.stored) === s.stored));

// ── Pasted emails ───────────────────────────────────────────────────────────
check("an Angi lead email is Angi", detectEmailSource("New lead from Angi Leads: Kitchen remodel, Lehi UT") === "ANGI");
check("a HomeAdvisor email is Angi", detectEmailSource("HomeAdvisor: a homeowner requested a quote") === "ANGI");
check("a Thumbtack email is Thumbtack", detectEmailSource("You have a new Thumbtack request from Dana") === "THUMBTACK");
check("a Facebook lead-ads email is Facebook", detectEmailSource("From: Facebook <notification@facebookmail.com> New lead ad form submission") === "FACEBOOK");
check("a Google local-services email is Google", detectEmailSource("Google Local Services: new lead — Google Guaranteed") === "GOOGLE");
check("a Yelp message is Yelp", detectEmailSource("New message on Yelp for Business") === "YELP");
check("a plain email stays Email", detectEmailSource("Hi, can you look at my fence next week? — Sam") === "EMAIL");
check("\"angina\" or \"Angie\" in a name is not Angi", detectEmailSource("My wife Angie wants a deck, and I have angina so I can't build it") === "EMAIL");

// ── Spreadsheet cells ───────────────────────────────────────────────────────
check("a blank cell is an import", sourceFromCell("") === "IMPORT" && sourceFromCell(null) === "IMPORT");
check("a known cell maps", sourceFromCell("Facebook") === "FACEBOOK" && sourceFromCell("referral") === "REFERRAL");
check("a JobFlex cell in a sheet is not taken at its word", sourceFromCell("LEAD_CENTER") === "IMPORT");
check("a marketplace named in a cell is found", sourceFromCell("Thumbtack Pro") === "THUMBTACK");
check("anything else is Other", sourceFromCell("county fair booth") === "OTHER");

// ── Counts ──────────────────────────────────────────────────────────────────
const rows = [{ source: "LEAD_CENTER" }, { source: "LEAD_CENTER" }, { source: "FACEBOOK" }, { source: "META" }, { source: "phone" }, { source: "AI_DESK" }, { source: "AI_DESK" }, { source: null }, { source: "EMAIL" }];
const sides = sideCounts(rows);
check("side counts add up", sides.all === 9 && sides.jobflex === 2 && sides.own === 7, JSON.stringify(sides));
const own = ownSourceCounts(rows);
check("own counts group old spellings", own.find((c) => c.key === "ai-desk")?.count === 3 && own.find((c) => c.key === "facebook")?.count === 2, JSON.stringify(own.map((c) => [c.key, c.count])));
check("…most first", own[0].key === "ai-desk");
check("…and never list JobFlex", !own.some((c) => c.key === "jobflex"));
check("…labels are the canonical ones, not a raw spelling", own.find((c) => c.key === "facebook")?.label === "Facebook");

// ── Visits: who booked them ─────────────────────────────────────────────────
const deskMarker = parseAptSource(JSON.stringify({ channel: "ai-desk", callSid: "CA123", at: "2026-10-16T15:00:00.000Z" }));
check("a desk marker reads back", deskMarker?.channel === "ai-desk" && deskMarker.callSid === "CA123");
check("a broken marker is ignored", parseAptSource("{nope") === null && parseAptSource(JSON.stringify({ channel: "fax" })) === null && parseAptSource(null) === null);
check("the marker key is per appointment", aptSourceKey("apt1") === "aptSource:apt1");
check("the marker wins", visitVia({ marker: deskMarker, booking: { notes: null } }) === "ai-desk");
check("a booking with no marker is online", visitVia({ booking: { notes: "Gate code 1234" } }) === "online");
check("a desk booking from before the marker is still the desk's", visitVia({ booking: { notes: "Booked by the AI desk on a call — furnace is loud" } }) === "ai-desk");
check("…found from the appointment's own first line too", visitVia({ booking: { notes: null }, notes: "Booked by phone · the AI desk · $89\nPhone +18015550100" }) === "ai-desk");
check("a plan visit is the plan's", visitVia({ planVisit: { label: "Spring tune-up" } }) === "plan");
check("anything else is the office's", visitVia({}) === "team");
check("every channel has its own colour", new Set(Object.values(VISIT_VIA).map((v) => v.tone)).size === Object.keys(VISIT_VIA).length);
check("every channel has a tag and a badge", Object.values(VISIT_VIA).every((v) => v.tag && v.badge && v.icon.startsWith("i-")));
check("the desk's note head no longer says online", bookingNoteHead("ai-desk", "$89", null) === "Booked by phone · the AI desk · $89" && !/online/i.test(bookingNoteHead("ai-desk", "$89", null)));
check("an online booking's note head is unchanged", bookingNoteHead("online", "$89", "Comfort Club") === "Booked online · $89 · member of the Comfort Club");
check("the desk's own head is recognised by the legacy reader", visitVia({ booking: { notes: null }, notes: bookingNoteHead("ai-desk", "$89", null) }) === "ai-desk");
const svc = { key: "repair", label: "Deck repair visit", kind: "diagnostic" as const, minutes: 60, priceText: "$89", trade: "deck" };
check("a desk visit's scope says it was booked by phone", bookingScope(svc, [], "Steps wobble", "ai-desk") === "Deck repair visit booked by phone with the AI desk.\nOn the call: Steps wobble");
check("an online visit's scope is unchanged", bookingScope(svc, [], "Gate code 12") === "Deck repair visit booked online.\nIn their words: Gate code 12");
const at = new Date("2026-10-16T15:00:00Z");
check("booked line: AI desk", bookedLine("ai-desk", { at }).startsWith("By the AI desk, on a phone call · Oct"));
check("booked line: online", bookedLine("online", { at }).startsWith("By the customer, on your booking page"));
check("booked line: plan names the plan", bookedLine("plan", { plan: "Comfort Club" }) === "From the service plan “Comfort Club”");
check("booked line: the office names the person", bookedLine("team", { by: "Casey Stone", at }).startsWith("By Casey Stone"));
check("booked line: no person known", bookedLine("team", {}) === "By your team");

console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);
