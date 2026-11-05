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
  money,
  quickReply,
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
import { forSpeech } from "../../../src/components/v3/assistant/use-assistant";

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
  const all: Capability[] = ["today", "proposals.read", "proposals.send", "schedule.read", "schedule.write", "crew.read", "crew.text", "money.read", "payments.remind", "estimates.build"];
  for (const role of ["OWNER", "ADMIN", "MANAGER"]) check(`roles: ${role} may do everything`, all.every((c) => roleAllows(role, c)), all.filter((c) => !roleAllows(role, c)));
  check("roles: a field worker is refused everything (the crew portal is theirs)", all.every((c) => !roleAllows("INSTALLER", c)));
  check("roles: SALES sends proposals", roleAllows("SALES", "proposals.send"));
  check("roles: SALES never schedules, texts the crew, reads money or sends reminders", !roleAllows("SALES", "schedule.write") && !roleAllows("SALES", "crew.text") && !roleAllows("SALES", "money.read") && !roleAllows("SALES", "payments.remind"));
  check("roles: ESTIMATOR sends proposals but never schedules or texts the crew", roleAllows("ESTIMATOR", "proposals.send") && !roleAllows("ESTIMATOR", "schedule.write") && !roleAllows("ESTIMATOR", "crew.text"));
  // Slice 3 (2026-11-05): pricing a job is requireEstimatorOrManager's — estimators and managers, never SALES or the crew.
  check("roles: ESTIMATOR builds estimates", roleAllows("ESTIMATOR", "estimates.build"));
  check("roles: SALES never builds an estimate (it sends what an estimator priced)", !roleAllows("SALES", "estimates.build"));
  check("roles: SALES and ESTIMATOR see only their own proposals", ownProposalsOnly("SALES") && ownProposalsOnly("ESTIMATOR") && !ownProposalsOnly("OWNER") && !ownProposalsOnly("MANAGER"));
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

console.log(bad ? `\n${bad} FAILED` : "\nall ok");
process.exit(bad ? 1 : 0);
