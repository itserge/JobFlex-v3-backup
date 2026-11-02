// SmartBook pure core: the settings, which times are offered and how they spread, holds, the short replies, the
// customer's proposed time on the company's clock, the words and their length, the clock, Facebook's consent boxes,
// the model's answer contract. Pure: no model, no database.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/smartbook.check.ts
import "../_lib/_server-only";
import { DEFAULT_SMARTBOOK, parseSmartBookSettings, sourceAllowed, sourceGroup } from "../../../src/lib/smartbook/settings";
import { matchesPreference, partOf, pickOffers, proposalInstant, quickRead, quickTime, slotAt } from "../../../src/lib/smartbook/offers";
import { emailProse, emailWords, firstNameOf, firstText, replyNumbers, say, tell, timesList, whenWords } from "../../../src/lib/smartbook/words";
import { businessAfter, isQuiet, nextMorning } from "../../../src/lib/smartbook/clock";
import { contractorReadSchema, customerReadSchema, customerSystemPrompt, knowledgeOf } from "../../../src/lib/smartbook/understand";
import { consentKeysOf, metaLeadSchema, tickedBoxes } from "../../../src/lib/meta/graph";
import { availableSlots, defaultBookingSettings, zonedInstant, zonedParts, type Slot } from "../../../src/lib/booking";
import { clip, SMS_MAX } from "../../../src/lib/sms/format";

let bad = 0;
function check(name: string, ok: boolean, extra?: unknown) {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && extra !== undefined ? ` :: ${JSON.stringify(extra)}` : ""}`);
}

const TZ = "America/Los_Angeles";
const at = (y: number, m: number, d: number, h: number, min = 0) => zonedInstant(y, m, d, h, min, TZ);

// ── settings ────────────────────────────────────────────────────────────────
{
  const d = parseSmartBookSettings(null);
  check("settings: off by default", d.on === false && d.call === false && d.text && d.email);
  check("settings: own time asks the company by default", d.ownTime === "ask");
  check("settings: hand-added leads off, Facebook on", d.sources.other === false && d.sources.facebook && d.sources.website && d.sources.jobflex && d.sources.desk);
  const healed = parseSmartBookSettings(JSON.stringify({ on: true, offers: 9, ownTime: "auto", sources: { other: true }, firstMessage: "x".repeat(900), onSince: "nope" }));
  check("settings: offers clamped to 4", healed.offers === 4, healed.offers);
  check("settings: first message capped", (healed.firstMessage ?? "").length === 400);
  check("settings: bad onSince dropped", healed.onSince === null);
  check("settings: partial sources keep the rest", healed.sources.other && healed.sources.facebook);
  check("settings: garbage → defaults", JSON.stringify(parseSmartBookSettings("{oops")) === JSON.stringify(DEFAULT_SMARTBOOK));
  check("source: FACEBOOK → facebook", sourceGroup("FACEBOOK") === "facebook");
  check("source: LEAD_CENTER → jobflex", sourceGroup("LEAD_CENTER") === "jobflex");
  check("source: WEBSITE → website", sourceGroup("WEBSITE") === "website");
  check("source: BOOKING never", sourceGroup("BOOKING") === null);
  check("source: allowed follows the switch", sourceAllowed(d, "facebook") && !sourceAllowed(d, "other") && !sourceAllowed(d, null));
}

// ── offers ──────────────────────────────────────────────────────────────────
// Mon 2026-11-02 … : hourly slots 8–17, every weekday.
const settings = { ...defaultBookingSettings(["roofing"]), leadHours: 0 };
const service = settings.services.find((s) => s.kind === "estimate")!;
const now = at(2026, 11, 2, 7, 0); // Monday 7:00 AM
const slots: Slot[] = availableSlots({ settings, service, busy: [], timeZone: TZ, now }).flatMap((d) => d.slots);
{
  check("slots: there are open times", slots.length > 20, slots.length);
  const picks = pickOffers({ slots, count: 3, timeZone: TZ });
  const days = new Set(picks.map((s) => zonedParts(s.startsAt, TZ).d));
  check("offers: three", picks.length === 3);
  check("offers: the soonest first", picks[0].startsAt.getTime() === slots[0].startsAt.getTime());
  check("offers: three different days", days.size === 3, [...days]);
  const parts = picks.map((s) => partOf(s.startsAt, TZ));
  check("offers: the other half of the day comes in", parts.includes("morning") && parts.includes("afternoon"), parts);
  check("offers: in time order", picks.every((s, i) => i === 0 || s.startsAt > picks[i - 1].startsAt));
  const held = new Set([slots[0].startsAt.getTime()]);
  const picks2 = pickOffers({ slots, count: 3, timeZone: TZ, held });
  check("offers: a held time is never offered", picks2.every((s) => !held.has(s.startsAt.getTime())));
  const mornings = pickOffers({ slots, count: 3, timeZone: TZ, prefer: { part: "morning" } });
  check("offers: 'mornings' → mornings only", mornings.length === 3 && mornings.every((s) => partOf(s.startsAt, TZ) === "morning"));
  const after3 = pickOffers({ slots, count: 2, timeZone: TZ, prefer: { after: "15:00" } });
  check("offers: 'after 3' → 3 PM or later", after3.length === 2 && after3.every((s) => zonedParts(s.startsAt, TZ).h >= 15), after3.map((s) => zonedParts(s.startsAt, TZ).h));
  const friday = pickOffers({ slots, count: 3, timeZone: TZ, prefer: { days: [5] } });
  check("offers: 'Friday' → Fridays", friday.length >= 1 && friday.every((s) => zonedParts(s.startsAt, TZ).dow === 5));
  check("offers: a Sunday nobody works → none", pickOffers({ slots, count: 3, timeZone: TZ, prefer: { days: [0] } }).length === 0);
  check("offers: exclude works", pickOffers({ slots, count: 3, timeZone: TZ, exclude: new Set(slots.map((s) => s.startsAt.getTime())) }).length === 0);
  check("preference: none matches all", matchesPreference(slots[0], null, TZ));
}

// ── short replies ───────────────────────────────────────────────────────────
{
  check("quick: '2' → pick 2", JSON.stringify(quickRead("2", 3)) === JSON.stringify({ kind: "pick", n: 2 }));
  check("quick: '#3.' → pick 3", JSON.stringify(quickRead(" #3. ", 3)) === JSON.stringify({ kind: "pick", n: 3 }));
  check("quick: '4' of 3 → not a pick", quickRead("4", 3) === null);
  check("quick: 'Yes!' → yes", quickRead("Yes!", 0)?.kind === "yes");
  check("quick: 'yes 12' → yes #12", JSON.stringify(quickRead("yes 12", 0)) === JSON.stringify({ kind: "yes", ref: 12 }));
  check("quick: 'YES #4' → yes #4", JSON.stringify(quickRead("YES #4", 0)) === JSON.stringify({ kind: "yes", ref: 4 }));
  check("quick: 'no 2' → no #2, not a pick", JSON.stringify(quickRead("no 2", 3)) === JSON.stringify({ kind: "no", ref: 2 }));
  check("quick: 'sí' → yes", quickRead("sí", 0)?.kind === "yes");
  check("quick: a sentence → the model's", quickRead("can you do saturday morning?", 3) === null);
  check("time: '9am' → 09:00", quickTime("9am")?.time === "09:00");
  check("time: '2:30 pm' → 14:30", quickTime("2:30 pm")?.time === "14:30");
  check("time: '3' → 15:00", quickTime("3")?.time === "15:00");
  check("time: '10' → 10:00", quickTime("10")?.time === "10:00");
  check("time: '12am' → 00:00", quickTime("12am")?.time === "00:00");
  check("time: '9am #3' → ref 3", quickTime("9am #3")?.ref === 3);
  check("time: '13pm' → none", quickTime("13pm") === null);
  check("time: words → none", quickTime("monday at 2") === null);
}

// ── the clock ───────────────────────────────────────────────────────────────
{
  const p = proposalInstant("2026-11-07", "09:00", TZ)!;
  const z = zonedParts(p, TZ);
  check("proposal: Sat Nov 7 9:00 on the company's clock", z.d === 7 && z.h === 9 && z.min === 0 && z.dow === 6, z);
  check("proposal: bad input → null", proposalInstant("11/7", "9", TZ) === null && proposalInstant("2026-11-07", "25:00", TZ) === null);
  check("slotAt: exact start only", slotAt(slots, slots[3].startsAt) === slots[3] && slotAt(slots, new Date(slots[3].startsAt.getTime() + 60000)) === null);
  check("quiet: 10 PM yes, 9 AM no, 7:59 AM yes", isQuiet(at(2026, 11, 2, 22), TZ) && !isQuiet(at(2026, 11, 2, 9), TZ) && isQuiet(at(2026, 11, 2, 7, 59), TZ));
  const m1 = nextMorning(at(2026, 11, 2, 22), TZ);
  check("morning: after 10 PM → 8 AM tomorrow", zonedParts(m1, TZ).d === 3 && zonedParts(m1, TZ).h === 8);
  const m2 = nextMorning(at(2026, 11, 2, 6), TZ);
  check("morning: at 6 AM → 8 AM today", zonedParts(m2, TZ).d === 2 && zonedParts(m2, TZ).h === 8);
  const b1 = businessAfter(at(2026, 11, 2, 10), 4, TZ);
  check("business: 10 AM + 4h → 2 PM", zonedParts(b1, TZ).h === 14 && zonedParts(b1, TZ).d === 2);
  const b2 = businessAfter(at(2026, 11, 2, 19), 4, TZ);
  check("business: 7 PM + 4h → 11 AM next day", zonedParts(b2, TZ).d === 3 && zonedParts(b2, TZ).h === 11, zonedParts(b2, TZ));
  const b3 = businessAfter(at(2026, 11, 2, 23), 1, TZ);
  check("business: 11 PM + 1h → 9 AM", zonedParts(b3, TZ).d === 3 && zonedParts(b3, TZ).h === 9);
  // Across the DST change (Nov 1 2026 in the US): the hours stay on the wall clock.
  const dst = businessAfter(at(2026, 10, 31, 19), 2, TZ);
  check("business: across DST", zonedParts(dst, TZ).d === 1 && zonedParts(dst, TZ).h === 9, zonedParts(dst, TZ));
}

// ── the words ───────────────────────────────────────────────────────────────
{
  const s = at(2026, 11, 3, 10);
  check("when: arrival window", whenWords(s, TZ, 120) === "Tue Nov 3, 10am–12pm", whenWords(s, TZ, 120));
  check("when: same half folds", whenWords(at(2026, 11, 3, 13), TZ, 120) === "Tue Nov 3, 1–3pm", whenWords(at(2026, 11, 3, 13), TZ, 120));
  check("when: exact time", whenWords(at(2026, 11, 7, 9, 30), TZ, 0) === "Sat Nov 7, 9:30am", whenWords(at(2026, 11, 7, 9, 30), TZ, 0));
  check("reply numbers", replyNumbers(3) === "Reply 1, 2 or 3" && replyNumbers(2) === "Reply 1 or 2" && replyNumbers(1) === "Reply 1");
  check("first name: placeholder → none", firstNameOf("Meta lead") === "" && firstNameOf("sarah lee") === "Sarah");
  const picks = pickOffers({ slots, count: 3, timeZone: TZ });
  const times = timesList(picks, TZ, 120);
  const link = "https://www.jobflex.app/b/AbCdEfGhIjKl";
  const vars = { first: "Sarah", company: "Ridgeline Roofing Co.", project: "roof replacement", visit: "estimate", free: true, times, count: 3, link };
  const text = firstText(vars, null);
  check("first text: fits one text after the sender's clip", clip(text, SMS_MAX) === text.replace(/\s+/g, " ").trim(), text.length);
  check("first text: STOP line and the link", /Reply STOP to opt out\.$/.test(text) && text.includes(link));
  check("first text: three numbered times", /1\) .*; 2\) .*; 3\) /.test(text));
  check("first text: free visit said once", text.includes("a free estimate") && text.split("free").length === 2);
  check("first text: the project named", text.includes("about roof replacement"));
  const own = firstText(vars, "Hey {first name}! {company} here about your {service}.");
  check("first text: the owner's words + times appended", own.startsWith("Hey Sarah! Ridgeline Roofing Co. here about your roof replacement.") && own.includes("1) "));
  const ownLong = firstText(vars, "x ".repeat(300));
  check("first text: the owner's long words keep the link and STOP", ownLong.length <= SMS_MAX && ownLong.endsWith("Reply STOP to opt out.") && ownLong.includes(link), ownLong.length);
  const long = firstText({ ...vars, company: "A".repeat(60), project: "b".repeat(60) }, null);
  check("first text: a long company still fits", long.length <= SMS_MAX && long.endsWith("Reply STOP to opt out."), long.length);
  // The DST day itself (Sun Nov 1 2026): 8 AM is 8 AM.
  const dstMorning = zonedParts(zonedInstant(2026, 11, 1, 8, 0, TZ), TZ);
  check("zonedInstant: 8 AM on the day the clocks change", dstMorning.h === 8 && dstMorning.d === 1, dstMorning);
  const springMorning = zonedParts(zonedInstant(2026, 3, 8, 8, 0, TZ), TZ);
  check("zonedInstant: 8 AM on the spring change", springMorning.h === 8 && springMorning.d === 8, springMorning);
  const w = { first: "Sarah", company: "Ridgeline" };
  check("say: checking at night says morning", say.checking(w, "Sat Nov 7, 9am", true).includes("first thing in the morning"));
  check("say: never a price", !/\$\d/.test(Object.values(say).map((f) => (f as (...a: unknown[]) => string)(w, "x", "y", 2)).join(" ")));
  const req = { name: "Sarah Lee", source: "Facebook", project: "roof replacement", asked: "Sat Nov 7, 9am", calendar: "Your calendar is free then", n: 4, phone: "+14255550142" };
  check("tell: request names the number when several", tell.request(req).includes("Reply YES 4") && tell.request(req).includes("(#4)"));
  check("tell: request without a number", !tell.request({ ...req, n: null }).includes("#"));
  check("tell: request fits a text", tell.request(req).length <= SMS_MAX, tell.request(req).length);
}

// ── the same lines in an email ──────────────────────────────────────────────
{
  const t = "Hi Lisa, it's Ridgeline — thanks! We can come out for a free estimate: 1) Tue Nov 3, 10am–12pm; 2) Wed Nov 4, 1–3pm. Reply 1 or 2, or name a time that suits you better. More: https://x.test/b/abc Reply STOP to opt out.";
  const e = emailWords(t);
  check("email: no 'Reply 1 or 2', no STOP, no bare link", !/Reply \d/.test(e) && !/STOP/.test(e) && !e.includes("https://x.test"), e);
  check("email: points at the button", e.includes("Choose one with the button below"));
  check("email: a counter says yes with the button", emailWords("…we could come Mon Nov 9, 2–4pm. Does that work? Reply YES, or tell me another time.").includes("Say yes with the button below"));
  check("email: 'reply here' is the inbox", emailWords("You're all set. Reply here if anything changes.").endsWith("Reply to this email if anything changes."));
  const run = "1) Mon Nov 2, 8–10am; 2) Tue Nov 3, 12–2pm";
  const w2 = { first: "Lisa", company: "Ridgeline" };
  const cases: Array<[string, string, string]> = [
    ["first", `We can come out for a free estimate: ${run}. Reply 1 or 2, or name a time that suits you better. More: https://x.test/b/abc Reply STOP to opt out.`, "We can come out for a free estimate. Choose one with the button below"],
    ["nudge", say.nudge(w2, run, 2), "would any of these work? Choose one with the button below"],
    ["declined", say.declined(w2, "Sat Nov 7, 9am", run, 2), "We could do one of the times below. Choose one"],
    ["taken", say.taken(w2, "Mon Nov 2, 8–10am", run, 2), "How about one of the times below? Choose one"],
    ["fresh", say.nudgeFresh(w2, run, 2), "Here are the next open times. Choose one"],
  ];
  for (const [name, text, want] of cases) {
    const e = emailProse(text, run);
    check(`email prose (${name}): the times leave the sentence`, !e.includes("1) Mon") && e.includes(want), e);
  }
  check("email: a fresh nudge loses 'and you're booked' with the numbers", !/Reply 1/.test(emailWords(say.nudgeFresh({ first: "Dan", company: "R" }, "1) a; 2) b", 2))));
}

// ── Facebook's consent boxes ────────────────────────────────────────────────
{
  const keys = consentKeysOf({ legal_content: { custom_disclaimer: { checkboxes: [{ key: "privacy", text: "I agree to the privacy policy" }, { key: "sms", text: "I agree to receive <b>text messages</b> and calls from Ridgeline about my request" }] } } });
  check("consent: the texts box", keys.text === "sms");
  check("consent: the same box covers calls", keys.call === "sms");
  check("consent: no boxes → none", JSON.stringify(consentKeysOf({})) === JSON.stringify({ text: null, call: null }));
  const lead = metaLeadSchema.parse({ id: "123", field_data: [], custom_disclaimer_responses: [{ checkbox_key: "sms", is_checked: "1" }, { checkbox_key: "privacy", is_checked: "0" }] });
  const ticked = tickedBoxes(lead);
  check("consent: '1' is ticked, '0' is not", ticked.has("sms") && !ticked.has("privacy"));
  check("consent: a lead without the field parses", metaLeadSchema.safeParse({ id: "9", field_data: [] }).success);
}

// ── the model's contract ────────────────────────────────────────────────────
{
  const r = customerReadSchema.parse({ intent: "propose", proposal: { day: "2026-11-07", time: "09:00" }, lang: "es" });
  check("read: a proposal parses", r.intent === "propose" && r.proposal?.time === "09:00" && r.lang === "es");
  const junk = customerReadSchema.parse({ intent: "book-it-now", pick: 99, proposal: { day: "Saturday" }, angry: "very" });
  check("read: junk is caught, not thrown", junk.intent === "other" && junk.pick === null && junk.proposal === null && junk.angry === false);
  check("read: contractor junk → unclear", contractorReadSchema.parse({ decision: "maybe" }).decision === "unclear");
  const prompt = customerSystemPrompt({ company: "Ridgeline", nowWords: "Monday", timeZone: TZ, offered: ["Tue Nov 3, 10am–12pm"], booked: null, asked: null, knowledge: "" });
  check("prompt: no facts → never answer", prompt.includes("answer is always null"));
  check("prompt: never invent a price", /Never invent a price/.test(prompt));
  const k = knowledgeOf({ greeting: "", about: "Family roofers", knowledge: "", services: ["Roofs"], serviceArea: "Bothell", hours: "", pricing: "Inspections are free", credentials: "", faqs: [{ q: "Do you do metal?", a: "Yes" }], intake: [], emergencies: "", neverSay: ["discounts"], transfer: "", languages: [] });
  check("knowledge: the desk's facts, prices only in its words", k.includes("Prices (only these words): Inspections are free") && k.includes("Q: Do you do metal? A: Yes") && k.includes("Never say: discounts"));
}

console.log(bad ? `\n${bad} FAILED` : "\nall smartbook checks passed");
process.exit(bad ? 1 : 0);
