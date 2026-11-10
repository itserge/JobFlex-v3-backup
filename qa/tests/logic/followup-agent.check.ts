// THE FOLLOW-UP AGENT'S PURE RULES (Smart CRM part 4, 2026-11-10) — lib/followUps/agent on made-up values. No database.
//   NODE_PATH="" npx tsx --tsconfig tsconfig.json qa/tests/logic/followup-agent.check.ts

import { BETWEEN_FOLLOW_UPS_MS, decide, draftOk, draftParagraphs, modeLabel, numbersIn, parseMode, parseWords, stillCurrent, textWithLink, waitingLine, type AgentFacts, type WaitingFollowUp } from "@/lib/followUps/agent";

let bad = 0;
function check(label: string, ok: boolean, extra?: unknown) {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${!ok && extra !== undefined ? ` :: ${JSON.stringify(extra)}` : ""}`);
}

const TZ = "America/Los_Angeles";
// 10:00 in the morning in Seattle.
const now = new Date("2026-11-10T18:00:00Z");
const ago = (hours: number) => new Date(now.getTime() - hours * 3_600_000);

const base: AgentFacts = { now, tz: TZ, trigger: "SENT", proposalStatus: "SENT", mode: "AUTO", state: "QUEUED", readyAt: null, since: ago(72), lastInboundAt: null, dealLost: false, lastHandWrittenAt: null, lastFollowUpAt: null, ourPromise: null };
const d = (over: Partial<AgentFacts>) => decide({ ...base, ...over });

// ── what is stored ──
check("an unknown mode is 'send on its own'; ASK and SUGGEST are kept", parseMode(null) === "AUTO" && parseMode("whatever") === "AUTO" && parseMode("ASK") === "ASK" && parseMode("SUGGEST") === "SUGGEST");
check("an unknown words setting is the standard words", parseWords(undefined) === "STANDARD" && parseWords("AI") === "AI" && parseWords("ai") === "STANDARD");
check("the three modes read differently", new Set([modeLabel("AUTO"), modeLabel("ASK"), modeLabel("SUGGEST")]).size === 3);

// ── still worth sending? ──
check("a 'sent' follow-up is still current when the client only opened it", stillCurrent("SENT", "SENT") && stillCurrent("SENT", "VIEWED"));
check("…and not once it is signed, declined or paid", !stillCurrent("SENT", "ACCEPTED") && !stillCurrent("SENT", "DECLINED") && !stillCurrent("SENT", "PAID"));
check("a 'paid' thank-you survives 'completed'", stillCurrent("PAID", "COMPLETED") && !stillCurrent("PAID", "SENT"));

// ── it stops by itself ──
check("signed → stop, with the status as the reason", JSON.stringify(d({ proposalStatus: "ACCEPTED" })) === JSON.stringify({ do: "stop", why: "ACCEPTED" }));
check("paid → stop", d({ proposalStatus: "PAID" }).do === "stop");
check("the deal was marked lost → stop", (() => { const r = d({ dealLost: true }); return r.do === "stop" && r.why === "deal marked lost"; })());
check("the client wrote back after it was sent → stop, with the day", (() => { const r = d({ lastInboundAt: ago(20) }); return r.do === "stop" && /^client replied /.test(r.why); })(), d({ lastInboundAt: ago(20) }));
check("a message from before it was sent does not stop it", d({ lastInboundAt: ago(100) }).do === "send");
check("a thank-you is not stopped by a reply", d({ trigger: "ACCEPTED", proposalStatus: "ACCEPTED", lastInboundAt: ago(2) }).do === "send");
check("a thank-you is not stopped by 'deal lost' either", d({ trigger: "PAID", proposalStatus: "PAID", dealLost: true }).do === "send");
check("a waiting draft is closed too when the client replies", d({ state: "READY", readyAt: ago(5), lastInboundAt: ago(1) }).do === "stop");

// ── in a person's hands ──
check("a waiting draft stays waiting", d({ state: "READY", readyAt: ago(24), mode: "ASK" }).do === "keep");
check("…for 7 days, then it is closed", (() => { const r = d({ state: "READY", readyAt: ago(24 * 7 + 1), mode: "ASK" }); return r.do === "stop" && r.why === "nobody sent it in 7 days"; })());

// ── it waits ──
check("a person wrote to them yesterday → wait until 2 days after", (() => {
  const r = d({ lastHandWrittenAt: ago(24) });
  return r.do === "wait" && r.until.getTime() === ago(24).getTime() + 48 * 3_600_000 && /waiting 2 days/.test(r.why);
})());
check("a person wrote 3 days ago → it goes", d({ lastHandWrittenAt: ago(72) }).do === "send");
check("we still owe them something → wait, and the row says what", (() => {
  const r = d({ ourPromise: { text: "Send the revised quote", dueAt: new Date(now.getTime() + 86_400_000), createdAt: ago(48) } });
  return r.do === "wait" && r.why === "We still owe them: Send the revised quote" && r.until.getTime() === now.getTime() + 86_400_000;
})());
check("a promise 4 days past its day no longer holds the follow-up", d({ ourPromise: { text: "x", dueAt: ago(24 * 4), createdAt: ago(24 * 9) } }).do === "send");
check("a promise with no day holds it 3 days from when it was made", d({ ourPromise: { text: "x", dueAt: null, createdAt: ago(24) } }).do === "wait" && d({ ourPromise: { text: "x", dueAt: null, createdAt: ago(24 * 4) } }).do === "send");
check("a thank-you is not held by a promise or a hand-written message", d({ trigger: "ACCEPTED", proposalStatus: "ACCEPTED", lastHandWrittenAt: ago(1), ourPromise: { text: "x", dueAt: null, createdAt: ago(1) } }).do === "send");
check("another follow-up went 5 hours ago → wait to 20 hours after it", (() => {
  const r = d({ lastFollowUpAt: ago(5) });
  return r.do === "wait" && r.until.getTime() === ago(5).getTime() + BETWEEN_FOLLOW_UPS_MS;
})());
check("…a thank-you waits for that too", d({ trigger: "ACCEPTED", proposalStatus: "ACCEPTED", lastFollowUpAt: ago(5) }).do === "wait");

// ── who sends it ──
check("'send on its own' by day → send", d({}).do === "send");
check("'ask me first' → to a person", d({ mode: "ASK" }).do === "ready");
check("'just remind me' → to a person", d({ mode: "SUGGEST" }).do === "ready");
check("at 11 PM it waits for 8 in the morning", (() => {
  const night = new Date("2026-11-11T07:20:00Z"); // 23:20 in Seattle
  const r = decide({ ...base, now: night });
  return r.do === "wait" && r.until.toISOString() === "2026-11-11T16:00:00.000Z" && r.why === "Night — it goes in the morning";
})());
check("at 5 AM it waits for 8 too", (() => {
  const early = new Date("2026-11-10T13:40:00Z"); // 05:40 in Seattle
  const r = decide({ ...base, now: early });
  return r.do === "wait" && r.until.toISOString() === "2026-11-10T16:00:00.000Z";
})());
check("at night a person is still asked at once", decide({ ...base, now: new Date("2026-11-11T07:20:00Z"), mode: "ASK" }).do === "ready");
check("7:59 PM still sends; 8:00 PM waits", decide({ ...base, now: new Date("2026-11-11T03:59:00Z") }).do === "send" && decide({ ...base, now: new Date("2026-11-11T04:00:00Z") }).do === "wait");

// ── AI words: what may go out unread ──
const FACTS = "- THE PROPOSAL: Rear deck, $14,850, sent 3 days ago\n- THEY ASKED: composite decking";
const good = "Hi Olga — I wanted to check in on the rear deck, $14,850 with the composite decking you asked about. Happy to walk through it.";
check("numbers are read without commas", JSON.stringify(numbersIn("$14,850 in 3 days, 2.5%")) === JSON.stringify(["14850", "3", "2.5"]));
check("a draft that states only the facts' numbers is used", draftOk(good, "EMAIL", FACTS));
check("a made-up number is refused", !draftOk("Hi Olga — I can take $999 off the rear deck if you sign this week.", "EMAIL", FACTS));
check("a link of its own is refused", !draftOk("Hi Olga — see the rear deck at https://example.com/p/1 when you can.", "EMAIL", FACTS) && !draftOk("Hi Olga — the rear deck is on jobflex.app, take a look when you can.", "EMAIL", FACTS));
check("a placeholder is refused", !draftOk("Hi [Client Name] — checking in on the rear deck proposal.", "EMAIL", FACTS) && !draftOk("Hi Olga — the deck total is TBD until we talk again.", "EMAIL", FACTS));
check("an email address is refused", !draftOk("Hi Olga — write me at dana@acme.test about the rear deck.", "EMAIL", FACTS));
check("too short or too long is refused", !draftOk("Hi Olga.", "EMAIL", FACTS) && !draftOk("a".repeat(901), "EMAIL", FACTS) && !draftOk("word ".repeat(70), "TEXT", FACTS));
check("a text may be 300 characters, an email 900", draftOk("word ".repeat(59), "TEXT", FACTS) && draftOk("word ".repeat(170), "EMAIL", FACTS));
check("paragraphs: blank lines and single breaks split; six at most", draftParagraphs("One.\n\nTwo.\nThree.\n\n\n").length === 3 && draftParagraphs("a\nb\nc\nd\ne\nf\ng\nh").length === 6);

// ── the link the code adds ──
const href = "https://www.jobflex.app/p/abc";
check("a chasing text gets the proposal link", textWithLink("Hi Olga — any questions?", "SENT", href) === `Hi Olga — any questions? ${href}`);
check("…once", textWithLink(`Hi Olga ${href}`, "SENT", href) === `Hi Olga ${href}`);
check("a thank-you text gets no link", textWithLink("Thank you, Olga!", "ACCEPTED", href) === "Thank you, Olga!" && textWithLink("Thank you!", "PAID", href) === "Thank you!");

// ── the line the Operator reads ──
const w: WaitingFollowUp = { id: "f1", clientId: "c1", client: "Olga Petrova", proposalId: "p1", title: "Rear deck", total: 14850, trigger: "SENT", channel: "EMAIL", mode: "ASK", draftBy: "ai", draftSubject: "About Rear deck", draftBody: "Hi Olga", rule: "Sent · day 2", readyAt: now.getTime() };
const money = (n: number) => `$${n.toLocaleString("en-US")}`;
check("a prepared email reads 'email ready'", waitingLine(w, money) === "Olga Petrova — Rear deck ($14,850), email ready", waitingLine(w, money));
check("a prepared text reads 'text ready'", waitingLine({ ...w, channel: "TEXT" }, money).endsWith("text ready"));
check("a reminder with nothing written reads 'follow up yourself'", waitingLine({ ...w, mode: "SUGGEST", draftBody: null, draftBy: null }, money).endsWith("follow up yourself"));
check("a reminder someone had written for them reads as ready", waitingLine({ ...w, mode: "SUGGEST" }, money).endsWith("email ready"));

console.log(bad ? `\n${bad} FAILED` : "\nall ok");
process.exit(bad ? 1 : 0);
