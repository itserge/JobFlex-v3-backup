// THE JOBFLEX ASSISTANT · the pure core (2026-11-04): the short replies answered
// without the model, the life of a proposed change, the undo window, dates on
// the company's clock (DST too), money words, who may ask for what, and the
// prompt's hard rules. Pure: no model, no database.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/assistant.check.ts
import "../_lib/_server-only";
import {
  andList,
  canMove,
  confirmPrompt,
  dayOf,
  dayRange,
  briefingDue,
  clock12,
  factsOf,
  stepIndex,
  money,
  needsPin,
  quickReply,
  quietHours,
  smsPlain,
  spanWords,
  stillAwaiting,
  timeOf,
  undoWindowMs,
  wallInstant,
  APPROVAL_TTL_MS,
  type ActionStatus,
} from "../../../src/lib/assistant/shared";
import { ownProposalsOnly, roleAllows, type Capability } from "../../../src/lib/assistant/roles";
import { searchWords } from "../../../src/lib/assistant/find";
import { codeIn, phoneWords } from "../../../src/lib/assistant/phone";
import { SMS_WORDS, isCarrierStart, isCarrierStop } from "../../../src/lib/assistant/sms";
import { forSpeech, shownBody } from "../../../src/components/v3/assistant/use-assistant";
import { hashPin, pinMatches, weakPin } from "../../../src/lib/assistant/pin";
import { layoutFence, orient, pickHouse, siteWords, type FenceSite } from "../../../src/lib/fence/voiceLayout";
import { roofExistingFor, roofFamilyFor, roofSystemFor, yardFromSaid, HVAC_TIER_ID, LAWN_USUAL } from "../../../src/lib/assistant/estimatorWords";
import { BUILTIN_LISTS } from "../../../src/lib/roofPackage/catalog";
import { priceYard, DEFAULT_LAWN_SETTINGS, DEFAULT_OPTIONS } from "../../../src/lib/lawn/pricing";

let bad = 0;
function check(name: string, ok: boolean, extra?: unknown) {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && extra !== undefined ? ` :: ${JSON.stringify(extra)}` : ""}`);
}

// ── short replies ───────────────────────────────────────────────────────────
{
  const kind = (s: string) => quickReply(s)?.kind ?? null;
  for (const s of ["yes", "YES", "Yes.", "y", "ok", "OK thanks", "yes please", "do it", "send it", "go ahead", "Sí", "да"]) check(`quick: "${s}" is a yes`, kind(s) === "yes", kind(s));
  for (const s of ["no", "No!", "nope", "cancel", "never mind", "нет"]) check(`quick: "${s}" is a no`, kind(s) === "no", kind(s));
  check("quick: UNDO", kind("undo") === "undo" && kind("wait") === "undo");
  check("quick: STOP and HELP", kind("STOP") === "stop" && kind("help") === "help" && kind("?") === "help");
  const d = quickReply("2");
  check("quick: a single digit is a choice", d?.kind === "digit" && d.n === 2, d);
  check("quick: '#3' is a choice", quickReply("#3")?.kind === "digit");
  for (const s of ["no, make it Friday", "yes but Friday", "send the Smith proposal", "is it sent?", "12", "ok so what's on tomorrow", ""]) {
    check(`quick: "${s}" goes to the model`, quickReply(s) === null, quickReply(s));
  }
}

// ── the life of a proposed change ───────────────────────────────────────────
{
  const ok: Array<[ActionStatus, ActionStatus]> = [["AWAITING", "QUEUED"], ["AWAITING", "CANCELED"], ["AWAITING", "EXPIRED"], ["QUEUED", "RUNNING"], ["QUEUED", "CANCELED"], ["RUNNING", "DONE"], ["RUNNING", "FAILED"]];
  for (const [a, b] of ok) check(`status: ${a} → ${b}`, canMove(a, b));
  const no: Array<[ActionStatus, ActionStatus]> = [["AWAITING", "RUNNING"], ["AWAITING", "DONE"], ["QUEUED", "DONE"], ["RUNNING", "QUEUED"], ["RUNNING", "CANCELED"], ["DONE", "RUNNING"], ["FAILED", "QUEUED"], ["CANCELED", "QUEUED"], ["EXPIRED", "QUEUED"]];
  for (const [a, b] of no) check(`status: never ${a} → ${b}`, !canMove(a, b));
  const t0 = Date.parse("2026-11-04T18:00:00Z");
  check("awaiting: fresh read-back is open", stillAwaiting({ status: "AWAITING", createdAt: new Date(t0) }, t0 + 60_000));
  check("awaiting: expires after the TTL", !stillAwaiting({ status: "AWAITING", createdAt: new Date(t0) }, t0 + APPROVAL_TTL_MS + 1));
  check("awaiting: only AWAITING counts", !stillAwaiting({ status: "QUEUED", createdAt: new Date(t0) }, t0));
  check("undo: the app runs at once (the person tapped Do it on the read-back)", undoWindowMs("app") === 0);
  check("undo: a YES by text or voice waits two minutes", undoWindowMs("sms") === 120_000 && undoWindowMs("voice") === 120_000);
  check("confirm words by channel", /Do it/.test(confirmPrompt("app")) && /YES/.test(confirmPrompt("sms")));
}

// ── dates on the company's clock ────────────────────────────────────────────
{
  const LA = "America/Los_Angeles";
  const r = dayRange("2026-11-06", LA);
  check("day: Nov 6 in LA starts 08:00 UTC (PST)", r?.from.toISOString() === "2026-11-06T08:00:00.000Z", r?.from.toISOString());
  check("day: and ends 24 h later", r ? r.to.getTime() - r.from.getTime() === 86_400_000 : false);
  const dst = dayRange("2026-11-01", LA); // the fall-back day: 25 hours
  check("day: the DST fall-back day is 25 hours", dst ? dst.to.getTime() - dst.from.getTime() === 25 * 3_600_000 : false, dst);
  const nine = wallInstant("2026-11-06", "09:00", LA);
  check("wall: 9:00 AM Thursday in LA = 17:00 UTC — not 09:00 UTC (the server's clock)", nine?.toISOString() === "2026-11-06T17:00:00.000Z", nine?.toISOString());
  const ny = wallInstant("2026-07-15", "14:30", "America/New_York");
  check("wall: summer in New York (EDT)", ny?.toISOString() === "2026-07-15T18:30:00.000Z", ny?.toISOString());
  check("wall: bad input is refused", wallInstant("2026-13-01", "09:00", LA) === null || wallInstant("Thursday", "09:00", LA) === null);
  check("wall: bad time refused", wallInstant("2026-11-06", "25:00", LA) === null && wallInstant("2026-11-06", "9am", LA) === null);
  const late = new Date("2026-11-07T06:30:00Z"); // Nov 6, 10:30 PM in LA
  check("dayOf: late evening in LA is still the 6th", dayOf(late, LA) === "2026-11-06" && timeOf(late, LA) === "22:30", [dayOf(late, LA), timeOf(late, LA)]);
  const span = spanWords(nine!, wallInstant("2026-11-06", "14:00", LA)!, LA);
  check("span words: one day", span === "Fri, Nov 6, 9:00 AM–2:00 PM", span);
}

// ── money and lists ─────────────────────────────────────────────────────────
{
  check("money: whole dollars", money(16164) === "$16,164", money(16164));
  check("money: cents kept", money(2500.5) === "$2,500.50", money(2500.5));
  check("money: bad currency falls back", money(10, "??") === "$10");
  check("list: one", andList(["Mike"]) === "Mike");
  check("list: two", andList(["Mike", "Ana"]) === "Mike and Ana");
  check("list: three", andList(["Mike", "Ana", "Joe"]) === "Mike, Ana and Joe");
  check("search words drop the filler", JSON.stringify(searchWords("the Smith roof proposal from yesterday")) === JSON.stringify(["Smith", "roof"]), searchWords("the Smith roof proposal from yesterday"));
}

// ── who may ask for what ────────────────────────────────────────────────────
{
  const all: Capability[] = ["today", "proposals.read", "proposals.send", "schedule.read", "schedule.write", "crew.read", "crew.text", "money.read", "payments.remind", "estimates.build", "clients.write", "leads.write", "visits.write", "reminders", "invoices.send", "financing.send", "projects.read", "projects.write"];
  for (const role of ["OWNER", "ADMIN", "MANAGER"]) check(`roles: ${role} may do everything`, all.every((c) => roleAllows(role, c)), all.filter((c) => !roleAllows(role, c)));
  check("roles: a field worker is refused everything (the crew portal is theirs)", all.every((c) => !roleAllows("INSTALLER", c)));
  check("roles: SALES sends proposals", roleAllows("SALES", "proposals.send"));
  check("roles: SALES never schedules, texts the crew, reads money or sends reminders", !roleAllows("SALES", "schedule.write") && !roleAllows("SALES", "crew.text") && !roleAllows("SALES", "money.read") && !roleAllows("SALES", "payments.remind"));
  check("roles: ESTIMATOR sends proposals but never schedules or texts the crew", roleAllows("ESTIMATOR", "proposals.send") && !roleAllows("ESTIMATOR", "schedule.write") && !roleAllows("ESTIMATOR", "crew.text"));
  // Slice 3 (2026-11-05): pricing a job is requireEstimatorOrManager's — estimators and managers, never SALES or the crew.
  check("roles: ESTIMATOR builds estimates", roleAllows("ESTIMATOR", "estimates.build"));
  check("roles: SALES never builds an estimate (it sends what an estimator priced)", !roleAllows("SALES", "estimates.build"));
  check("roles: SALES and ESTIMATOR see only their own proposals", ownProposalsOnly("SALES") && ownProposalsOnly("ESTIMATOR") && !ownProposalsOnly("OWNER") && !ownProposalsOnly("MANAGER"));
  // The stages build (2026-11-05): projects are estimators' and managers' (requireEstimatorOrManager), never SALES'.
  check("roles: ESTIMATOR runs projects (stages, tasks)", roleAllows("ESTIMATOR", "projects.read") && roleAllows("ESTIMATOR", "projects.write"));
  check("roles: SALES never changes a project", !roleAllows("SALES", "projects.write"));
}


// ── by text ─────────────────────────────────────────────────────────────────
{
  check("code: six digits alone", codeIn("482913") === "482913" && codeIn(" 482913 ") === "482913" && codeIn("LINK 482913") === "482913");
  check("code: not a code", codeIn("48291") === null && codeIn("4829133") === null && codeIn("call 482913 now") === null && codeIn("$16,164") === null);
  for (const w of ["STOP", "stop", "Cancel", "END", "quit", "UNSUBSCRIBE", "stopall", "STOP."]) check(`carrier stop: "${w}"`, isCarrierStop(w));
  for (const w of ["stop sending the Lee proposal", "cancel the Lee job", "no", "don't stop"]) check(`carrier stop: not "${w}"`, !isCarrierStop(w));
  check("carrier start: START / UNSTOP / YES alone", isCarrierStart("START") && isCarrierStart("unstop") && isCarrierStart("yes"));
  check("carrier start: not a sentence", !isCarrierStart("yes send it") && !isCarrierStart("start the Lee job"));
  check("phone words", phoneWords("+18665551234") === "(866) 555-1234" && phoneWords("+15555550101") === "(555) 555-0101");
  const linked = SMS_WORDS.linked("Dmitriy", "Summit Ridge Roofing", "https://www.jobflex.app/api/assistant/contact");
  check("linked text: names the person, the company, STOP, HELP and rates", /Dmitriy at Summit Ridge Roofing/.test(linked) && /STOP/.test(linked) && /HELP/.test(linked) && /Msg & data rates/.test(linked), linked);
  check("linked text: under three segments' worth (459 chars)", linked.length <= 459, linked.length);
  check("help text: STOP, YES / NO and where to write", /STOP/.test(SMS_WORDS.help) && /YES/.test(SMS_WORDS.help) && /NO/.test(SMS_WORDS.help) && /support@jobflex\.app/.test(SMS_WORDS.help));
  check("no text tells anyone to reply CANCEL (a carrier stop word)", Object.values(SMS_WORDS).every((w) => typeof w !== "string" || !/reply cancel/i.test(w)));
  check("not-linked text: how to link, and STOP", /Settings → AI Operator/.test(SMS_WORDS.notLinked) && /STOP/.test(SMS_WORDS.notLinked));
}

// ── read out loud ───────────────────────────────────────────────────────────
{
  check("speech: the tap prompt becomes a spoken one", forSpeech('Send "X" ($16,164) to John. Tap Do it to go ahead, or Cancel.') === 'Send "X" ($16,164) to John. Say yes to do it, or no.');
  check("speech: a time range is read with 'to'", forSpeech("Fri, Nov 6, 9:00 AM–2:00 PM") === "Fri, Nov 6, 9:00 AM to 2:00 PM", forSpeech("Fri, Nov 6, 9:00 AM–2:00 PM"));
  check("speech: a dash becomes a pause", forSpeech("Done — on Friday") === "Done, on Friday");
  const built = 'Built "12 ft × 12 ft covered deck" for Sarah: $16,068. Open it: https://www.jobflex.app/dashboard/proposals/abc123';
  const facts = 'Built \u201c12 ft \u00d7 12 ft covered deck\u201d \u2014 12 ft \u00d7 12 ft covered deck \u00b7 144 sq ft \u00b7 Capped composite \u2014 mid line\u2026';
  check("texts: a build's reply is plain GSM (one \u00d7 or \u2014 would make every segment 70 characters)", smsPlain(facts) === 'Built "12 ft x 12 ft covered deck" - 12 ft x 12 ft covered deck, 144 sq ft, Capped composite - mid line...' && !/[^\x00-\x7F£¥èéùìòÇØøÅåÆæßÉÄÖÑÜ§¿äöñüà]/.test(smsPlain(facts)), smsPlain(facts));
  check("speech: a build's link is never read out", forSpeech(built) === 'Built "12 ft × 12 ft covered deck" for Sarah: $16,068. The link is on your screen.', forSpeech(built));
}

// ── batches 1–2 (2026-11-05): the PIN for money, and who may add people, book visits, set reminders ──
{
  const yp = quickReply("yes 1234");
  check("quick: 'yes 1234' is a yes with a PIN", yp?.kind === "yes" && yp.pin === "1234" && !yp.bare, yp);
  const bare = quickReply("1234");
  check("quick: four digits alone are a bare PIN (the engine takes them only when a read-back waits for one)", bare?.kind === "yes" && bare.pin === "1234" && bare.bare === true, bare);
  const comma = quickReply("YES, 2580");
  check("quick: 'YES, 2580' too", comma?.kind === "yes" && comma.pin === "2580");
  check("quick: five digits are not a PIN", quickReply("12345") === null);
  check("prompt: a money read-back asks for the PIN by text", confirmPrompt("sms", true) === "Reply YES and your PIN (like YES 1234), or NO.");
  check("prompt: and on the card in the app", confirmPrompt("app", true) === "Enter your PIN and tap Do it, or Cancel.");
  check("pin: invoices and financing links need it; a crew text and a proposal don't", needsPin("send_invoice") && needsPin("financing_link") && !needsPin("text_crew") && !needsPin("send_proposal"));
  const h = hashPin("2580");
  check("pin: hashed, never stored plain", h.startsWith("scrypt$") && !h.includes("2580"));
  check("pin: the right PIN matches, a wrong or short one doesn't", pinMatches("2580", h) && !pinMatches("2581", h) && !pinMatches("258", h));
  check("pin: two hashes of one PIN differ (a salt each)", hashPin("2580") !== h);
  check("pin: 0000, 1234 and 9876 are too easy; 2580 and 1357 are fine", weakPin("0000") && weakPin("1234") && weakPin("9876") && !weakPin("2580") && !weakPin("1357"));
  check("roles: SALES adds clients and books visits, never invoices", roleAllows("SALES", "clients.write") && roleAllows("SALES", "visits.write") && !roleAllows("SALES", "invoices.send") && !roleAllows("SALES", "financing.send"));
  check("roles: ESTIMATOR never adds clients or leads, nor books visits (requireSalesOrManager)", !roleAllows("ESTIMATOR", "clients.write") && !roleAllows("ESTIMATOR", "leads.write") && !roleAllows("ESTIMATOR", "visits.write"));
  check("roles: anyone with the Operator sets reminders; the field crew has no Operator", roleAllows("SALES", "reminders") && roleAllows("ESTIMATOR", "reminders") && !roleAllows("INSTALLER", "reminders"));
  check("speech: the PIN prompt points at the screen", forSpeech("Invoice X $1. Enter your PIN and tap Do it, or Cancel.") === "Invoice X $1. Enter your PIN on the screen, then tap Do it.");
  const line = { id: "m", direction: "OUT" as const, body: "Invoice X. Reply YES and your PIN (like YES 1234), or NO.", createdAt: "", action: { id: "a", tool: "send_invoice", status: "AWAITING" as const, readback: "", result: null, createdAt: "" } };
  check("shown: the PIN prompt line is the card's, not the bubble's", shownBody(line) === "Invoice X.", shownBody(line));
}

// ── batch 3 (2026-11-05): the morning briefing's clock and the alerts' quiet hours, on the company's clock ──
{
  const tz = "America/New_York";
  const at = (iso: string) => new Date(iso);
  check("briefing: due once the time has passed and it hasn't gone today", briefingDue("06:30", at("2026-11-06T11:31:00Z"), tz, null));
  check("briefing: not before its time", !briefingDue("06:30", at("2026-11-06T11:29:00Z"), tz, null));
  check("briefing: not twice in a day", !briefingDue("06:30", at("2026-11-06T13:00:00Z"), tz, "2026-11-06"));
  check("briefing: again the next day", briefingDue("06:30", at("2026-11-07T11:30:00Z"), tz, "2026-11-06"));
  check("briefing: a bad time never fires", !briefingDue("6:30", at("2026-11-06T12:00:00Z"), tz, null));
  check("quiet: 10 PM and 6:59 AM are quiet; noon and 7 AM are not", quietHours(at("2026-11-06T03:00:00Z"), tz) && quietHours(at("2026-11-06T11:59:00Z"), tz) && !quietHours(at("2026-11-06T17:00:00Z"), tz) && !quietHours(at("2026-11-06T12:00:00Z"), tz));
  check("clock: 06:30 reads 6:30 AM, 12:00 noon 12:00 PM, 00:00 12:00 AM", clock12("06:30") === "6:30 AM" && clock12("12:00") === "12:00 PM" && clock12("00:00") === "12:00 AM");
}

// ── batch 4 (2026-11-05): the sheet's facts and trace, and money as it is spoken ──
{
  const f = factsOf("build_deck", { widthFt: 20, depthFt: 16, heightFt: 3, cover: "roof", boards: "composite", rail: "aluminum", stairs: true, more: null });
  check("facts: a deck's size, height (rail required over 30 in), cover, boards, rail, stairs", JSON.stringify(f) === JSON.stringify([{ k: "Deck", v: "20 × 16 ft · 320 sq ft" }, { k: "Height", v: "3 ft · rail required" }, { k: "Cover", v: "Roof" }, { k: "Boards", v: "composite" }, { k: "Rail", v: "aluminum" }, { k: "Stairs", v: "Yes" }]), f);
  check("facts: a deck 2 ft up needs no rail line", factsOf("build_deck", { widthFt: 10, depthFt: 10, heightFt: 2, cover: "none", boards: null, rail: null, stairs: null, more: null }).some((x) => x.k === "Height" && x.v === "2 ft"));
  const e = factsOf("change_estimate", { projectType: "Roof replacement", description: "2,200 sq ft, one layer\nChange: add gutters", clientId: null, leadId: null, address: null });
  check("facts: a changed estimate shows the job and the change", JSON.stringify(e) === JSON.stringify([{ k: "Job", v: "Roof replacement" }, { k: "Change", v: "add gutters" }]), e);
  check("facts: a crew text has none", factsOf("text_crew", { workerIds: [], body: "x" }).length === 0);
  check("trace: a deck's steps", stepIndex("build_deck", "Priced") === 2 && stepIndex("build_deck", null) === -1 && stepIndex("build_estimate", "Saved") === 2 && stepIndex("send_proposal", "x") === -1);
  check("speech: money in whole dollars with the tax folded in", forSpeech('Built "12 ft × 12 ft covered deck" for John Smith: $14,968.83 ($14,121.54 + $847.29 tax). Open it: https://x/dashboard/proposals/a') === 'Built "12 ft × 12 ft covered deck" for John Smith: $14,969 with tax. The link is on your screen.', forSpeech('Built "12 ft × 12 ft covered deck" for John Smith: $14,968.83 ($14,121.54 + $847.29 tax). Open it: https://x/dashboard/proposals/a'));
  check("speech: a whole-dollar amount stays", forSpeech("Send it ($8,400) to Lee.") === "Send it ($8,400) to Lee.");
}

// ── the fence from words (2026-11-05): a 60 × 120 lot, the street on the south, a 32 × 44 house 30 ft back ──
{
  const lot = [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 120 }, { x: 0, y: 120 }];
  const house = [{ x: 14, y: 30 }, { x: 46, y: 30 }, { x: 46, y: 74 }, { x: 14, y: 74 }];
  const axes = orient(lot, { a: { x: 0, y: 0 }, b: { x: 60, y: 0 } });
  check("fence: facing the house from a street on the south, back is north and right is east", Math.abs(axes.back.y - 1) < 1e-9 && Math.abs(axes.right.x - 1) < 1e-9, axes);
  check("fence: the house is the building the pin is in", pickHouse([house, [{ x: 70, y: 30 }, { x: 90, y: 30 }, { x: 90, y: 60 }, { x: 70, y: 60 }]], { x: 30, y: 50 }) === house);
  const site: FenceSite = { address: "14 Oak St", origin: { lat: 47.25, lng: -122.44 }, lot, house, neighbors: [], right: axes.right, back: axes.back, street: "Oak St", frontKnown: true };
  const w = siteWords(site);
  check("fence: the site in words", w.lot === "60 × 120 ft" && w.house === "32 × 44 ft" && w.backyardFt === 46, w);
  const laid = layoutFence(site, { rear: { offsetFt: 20, onLotLine: false }, gates: [{ where: "right", widthFt: null }] });
  check("fence: a rear run 20 ft out, the sides on the lot lines: 14 + 20 + 60 + 20 + 14 = 128 ft, 4 corners", !("error" in laid) && laid.totalLf === 128 && laid.corners === 4, laid);
  if (!("error" in laid)) {
    check("fence: the line runs from the house's left rear corner around to its right rear corner", JSON.stringify(laid.points) === JSON.stringify([{ x: 14, y: 74 }, { x: 0, y: 74 }, { x: 0, y: 94 }, { x: 60, y: 94 }, { x: 60, y: 74 }, { x: 46, y: 74 }]), laid.points);
    check("fence: the gate sits on the right return, by the house, 4 ft", laid.gates.length === 1 && laid.gates[0].segmentIndex === 4 && laid.gates[0].widthFt === 4 && laid.gates[0].x === 53 && laid.gates[0].y === 74, laid.gates);
    check("fence: the words say where each piece is", laid.words[0] === "rear run 60 ft, 20 ft out from the back of the house" && /left side 34 ft and right side 34 ft/.test(laid.words[1]) && /4-ft gate, right side by the house/.test(laid.words[2]), laid.words);
  }
  const onLine = layoutFence(site, { rear: { offsetFt: null, onLotLine: true }, gates: [] });
  check("fence: on the rear lot line the rear run sits 46 ft out (the lot's end)", !("error" in onLine) && onLine.points[2].y === 120 && onLine.totalLf === 180, onLine);
  const tooFar = layoutFence(site, { rear: { offsetFt: 300, onLotLine: false }, gates: [] });
  check("fence: a rear run past the lot line is held at the lot line", !("error" in tooFar) && tooFar.points[2].y === 120);
  check("fence: no house, no layout — it asks for lengths", "error" in layoutFence({ ...site, house: null }, { rear: { offsetFt: 20, onLotLine: false }, gates: [] }));
  const f = factsOf("build_fence", { siteAddress: "14 Oak St", rearOffsetFt: 20, rearOnLotLine: false, gates: [{ where: "right", widthFt: null }], type: "cedar", heightFt: null, removeExisting: false });
  check("facts: a fence card says where, the rear, the sides, the gates and the fence", f.map((x) => x.k).join(",") === "Where,Rear,Sides,Gates,Fence" && f[1].v === "20 ft out from the house" && f[3].v === "4 ft on the right" && f[4].v === "6 ft cedar", f);
  check("trace: a fence's steps", stepIndex("build_fence", "Layout") === 1 && stepIndex("build_fence", "Saved") === 3);
}

// ── the roof, HVAC and the lawn from words (2026-11-05) ──────────────────────
{
  check("roof words: 'standing seam metal' is the metal family's standing-seam system", roofFamilyFor("standing seam metal") === "metal" && roofSystemFor("standing seam metal", "metal", BUILTIN_LISTS)?.id === "standing_seam");
  check("roof words: '3-tab shingles' is the asphalt three-tab", roofSystemFor("3-tab shingles", "asphalt", BUILTIN_LISTS)?.id === "three_tab");
  check("roof words: nothing said is architectural shingles", roofFamilyFor(null) === "asphalt" && roofSystemFor(null, "asphalt", BUILTIN_LISTS)?.id === "architectural");
  check("roof words: a flat roof takes a membrane whatever was asked", roofSystemFor("architectural shingles", "low-slope", BUILTIN_LISTS)?.id === "tpo");
  check("roof words: 'clay tile' / 'cedar shake' / 'impact resistant'", roofSystemFor("clay tile", "tile", BUILTIN_LISTS)?.id === "clay_tile" && roofSystemFor("cedar shake", "shake", BUILTIN_LISTS)?.id === "cedar_shake" && roofSystemFor("impact resistant", "asphalt", BUILTIN_LISTS)?.id === "impact_resistant");
  check("roof words: what's on it now", roofExistingFor(null) === "asphalt" && roofExistingFor("metal roof") === "metal" && roofExistingFor("tile") === "tile" && roofExistingFor("something") === "unsure");
  check("hvac words: good / better / best are the catalog's value / mid / premium", HVAC_TIER_ID.good === "value" && HVAC_TIER_ID.better === "mid" && HVAC_TIER_ID.best === "premium");
  const yard = yardFromSaid(8000, null);
  check("lawn said: 8,000 sq ft of lawn becomes a yard in the usual shares, a twelfth in beds, level", yard.lawnSqft === 8000 && yard.lawnByZone.front + yard.lawnByZone.back + yard.lawnByZone.side === 8000 && yard.bedSqft === 667 && yard.slope.flat === 1, yard);
  const q = priceYard({ measures: yard, settings: DEFAULT_LAWN_SETTINGS, options: DEFAULT_OPTIONS, locationFactor: 1, state: "WA", ownRate: false });
  const mow = q.services.find((x) => x.id === "mow");
  check("lawn said: the pricer takes it — a weekly mow priced above the minimum stop, the usual season on offer", Boolean(mow) && (mow?.unitPrice ?? 0) >= DEFAULT_LAWN_SETTINGS.minimumStop && LAWN_USUAL.every((id) => id === "mow" || id === "snow" || id === "shrubs" || id === "hedges" || id === "irrigationStart" || id === "irrigationBlowout" || q.services.some((x) => x.id === id)), q.services.map((x) => `${x.id} ${x.unitPrice}`));
  const r = factsOf("build_roof", { address: "14 Oak St, Tacoma, WA", material: "standing seam metal", existing: null, storeys: 2, homeSqft: 2400, tearOffLayers: 2, replaces: null });
  check("facts: a roof card says where, the roof, the house and the tear-off", r.map((x) => x.k).join(",") === "Where,Roof,House,Tear-off" && r[2].v === "2,400 sq ft · 2 floors" && r[3].v === "2 layers", r);
  check("facts: a roof measured from the air says so", factsOf("build_roof", { address: "x", material: null, homeSqft: null })[2].v === "Measured from the air");
  const h = factsOf("build_hvac", { address: "14 Oak St", job: "replace-system", sqft: 2000, storeys: 2, yearBuilt: 1990, outdoorKind: "heat-pump", tier: null });
  check("facts: an HVAC card says the house, the job, the outdoor unit and the tier", h.map((x) => x.k).join(",") === "Where,House,Job,Outdoor,Tier" && h[1].v === "2,000 sq ft · 2 floors · built 1990" && h[2].v === "Full system" && h[4].v === "Better", h);
  const l = factsOf("build_lawn", { address: "14 Oak St", lawnSqft: 8000, frequency: "weekly", services: ["mow", "fert", "fallCleanup"] });
  check("facts: a lawn card says the lawn, the mowing and the season", l.map((x) => x.k).join(",") === "Where,Lawn,Mowing,Season" && l[1].v === "8,000 sq ft · as said" && l[3].v === "mowing, fertilizer, fall cleanup", l);
  check("trace: the roof's, HVAC's and the lawn's steps", stepIndex("build_roof", "Rate book") === 1 && stepIndex("build_hvac", "Load") === 1 && stepIndex("build_lawn", "Saved") === 2);
}

console.log(bad ? `\n${bad} FAILED` : "\nall ok");
process.exit(bad ? 1 : 0);
