// THE PROMISE TRACKER'S PURE RULES (Smart CRM part 4, 2026-11-10) — lib/promises/shared on made-up values. No database.
//   NODE_PATH="" npx tsx --tsconfig tsconfig.json qa/tests/logic/promises.check.ts

import { bucketOf, closesItself, dayKey, dueInstant, dueWords, evidenceFor, guessKind, mayPromise, parseCaught, parseKind, promiseLine, reminderDue, reminderWords, trackerOf, type EvidenceEvent, type TrackedPromise } from "@/lib/promises/shared";

let bad = 0;
function check(label: string, ok: boolean, extra?: unknown) {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${!ok && extra !== undefined ? ` :: ${JSON.stringify(extra)}` : ""}`);
}

const TZ = "America/Los_Angeles";
// Tuesday, 10:00 in the morning in Seattle.
const now = new Date("2026-11-10T18:00:00Z");
const TODAY = "2026-11-10";
const at = (day: string) => dueInstant(day).getTime();

// ── is it worth a read? ──
check("'I'll send the revised quote Friday' may hold a promise", mayPromise("I'll send the revised quote Friday."));
check("'we will', 'let me', 'get back to you' too", mayPromise("We will have the crew there Monday.") && mayPromise("Let me check with the inspector.") && mayPromise("Thanks — I'll get back to you tomorrow."));
check("a curly apostrophe is read the same", mayPromise("I’ll call you after lunch."));
check("a plain answer is not read", !mayPromise("The deck is 12 by 16 and the stairs face the yard.") && !mayPromise("Thanks!") && !mayPromise(null) && !mayPromise(""));

// ── the kind, from the words ──
check("ours: quote → PROPOSAL, invoice → INVOICE, call → CALL", guessKind("Send the revised quote", "OURS") === "PROPOSAL" && guessKind("Email the invoice", "OURS") === "INVOICE" && guessKind("Call them back", "OURS") === "CALL");
check("ours: a visit → SCHEDULE, finding out → INFO, anything else → OTHER", guessKind("Stop by Thursday to measure", "OURS") === "SCHEDULE" && guessKind("Check with the inspector", "OURS") === "INFO" && guessKind("Bring the dog a treat", "OURS") === "OTHER");
check("theirs: deposit → PAY, sign → SIGN, let you know → DECIDE", guessKind("Send the deposit Monday", "THEIRS") === "PAY" && guessKind("Sign it tonight", "THEIRS") === "SIGN" && guessKind("Let you know after talking to my wife", "THEIRS") === "DECIDE");
check("a client's 'check' is a payment, ours is finding out", guessKind("Mail the check", "THEIRS") === "PAY" && guessKind("Check the permit", "OURS") === "INFO");
check("a stored kind nobody knows is OTHER", parseKind("proposal") === "PROPOSAL" && parseKind("MAYBE") === "OTHER" && parseKind(null) === "OTHER");

// ── what a read may contain ──
check("a clean read is kept, the kind upper-cased", JSON.stringify(parseCaught({ promises: [{ text: "Send the revised quote", due: "2026-11-13", kind: "proposal" }] }, TODAY)) === JSON.stringify([{ text: "Send the revised quote", due: "2026-11-13", kind: "PROPOSAL" }]));
check("a day in the past gets no day, not a wrong one", parseCaught({ promises: [{ text: "Send the revised quote", due: "2026-11-06", kind: "PROPOSAL" }] }, TODAY)[0]?.due === null);
check("a day more than a year out gets no day", parseCaught({ promises: [{ text: "Send the revised quote", due: "2099-01-01" }] }, TODAY)[0]?.due === null);
check("today and a year from today are allowed", parseCaught({ promises: [{ text: "Call them back", due: TODAY }, { text: "Check the warranty", due: "2027-11-10" }] }, TODAY).every((p) => p.due !== null));
check("a day that is not a day gets no day", parseCaught({ promises: [{ text: "Call them back", due: "Friday" }, { text: "Send the invoice", due: "2026-13-45" }] }, TODAY).every((p) => p.due === null));
check("a missing kind is read from the words", parseCaught({ promises: [{ text: "Call them back", due: null }] }, TODAY)[0]?.kind === "CALL");
check("three at most, repeats dropped, junk skipped", (() => {
  const got = parseCaught({ promises: [{ text: "Call them back" }, { text: "call them back" }, null, { text: "ok" }, { text: "x".repeat(201) }, { text: "Send the invoice" }, { text: "Check the permit" }, { text: "Book the crew" }] }, TODAY);
  return got.length === 3 && got[0].text === "Call them back" && got[1].text === "Send the invoice" && got[2].text === "Check the permit";
})());
check("no list, or no answer → nothing", parseCaught({}, TODAY).length === 0 && parseCaught(null, TODAY).length === 0 && parseCaught({ promises: "none" }, TODAY).length === 0);

// ── the day ──
check("a caught day stays that day on the west coast and the east", dayKey(dueInstant("2026-11-13"), TZ) === "2026-11-13" && dayKey(dueInstant("2026-11-13"), "America/New_York") === "2026-11-13");
check("due today / tomorrow / a named day", dueWords(at(TODAY), now, TZ) === "due today" && dueWords(at("2026-11-11"), now, TZ) === "due tomorrow" && dueWords(at("2026-11-13"), now, TZ) === "due Fri, Nov 13", dueWords(at("2026-11-13"), now, TZ));
check("late by days; no date", dueWords(at("2026-11-09"), now, TZ) === "1 day late" && dueWords(at("2026-11-06"), now, TZ) === "4 days late" && dueWords(null, now, TZ) === "no date");
check("the day follows the company's clock, not UTC's", dueWords(at("2026-11-10"), new Date("2026-11-11T05:00:00Z"), TZ) === "due today");

// ── the five lists ──
const P = (over: Partial<TrackedPromise>): TrackedPromise => ({ id: "p", clientId: "c1", client: "Olga Petrova", direction: "OURS", text: "Send the revised quote", kind: "PROPOSAL", ownerId: "u1", owner: "Dana", dueAt: at(TODAY), status: "OPEN", keptAt: null, evidence: null, createdAt: at("2026-11-08"), threadId: null, sourceKind: "EMAIL", ...over });
check("ours, due today → Due today", bucketOf(P({}), now, TZ) === "today");
check("ours, due yesterday → Overdue", bucketOf(P({ dueAt: at("2026-11-09") }), now, TZ) === "overdue");
check("ours, due later or no day → Open", bucketOf(P({ dueAt: at("2026-11-13") }), now, TZ) === "open" && bucketOf(P({ dueAt: null }), now, TZ) === "open");
check("theirs → Waiting on client, even when late", bucketOf(P({ direction: "THEIRS", dueAt: at("2026-11-01") }), now, TZ) === "waiting");
check("kept → Kept; canceled or broken → no list", bucketOf(P({ status: "KEPT" }), now, TZ) === "kept" && bucketOf(P({ status: "CANCELED" }), now, TZ) === null && bucketOf(P({ status: "BROKEN" }), now, TZ) === null);
check("the tracker sorts: the oldest due first, the newest kept first", (() => {
  const t = trackerOf([
    P({ id: "a", dueAt: at("2026-11-09") }),
    P({ id: "b", dueAt: at("2026-11-05") }),
    P({ id: "c", dueAt: null }),
    P({ id: "d", dueAt: at("2026-11-20") }),
    P({ id: "e", status: "KEPT", keptAt: 100 }),
    P({ id: "f", status: "KEPT", keptAt: 200 }),
    P({ id: "g", status: "CANCELED" }),
    P({ id: "h", direction: "THEIRS" }),
  ], now, TZ);
  return t.overdue.map((x) => x.id).join() === "b,a" && t.open.map((x) => x.id).join() === "d,c" && t.kept.map((x) => x.id).join() === "f,e" && t.waiting.length === 1 && t.today.length === 0;
})());

// ── proof it was kept ──
const made = Date.parse("2026-11-08T20:00:00Z");
const ev = (kind: EvidenceEvent["kind"], when: string, label: string): EvidenceEvent => ({ kind, at: Date.parse(when), label });
check("'send the quote' is kept when a proposal goes out later — the row says which and when", (() => {
  const e = evidenceFor({ kind: "PROPOSAL", direction: "OURS", since: made }, [ev("PROPOSAL_SENT", "2026-11-09T19:00:00Z", "Proposal sent — Rear deck")], TZ);
  return e?.words === "Proposal sent — Rear deck · Nov 9" && e.at === Date.parse("2026-11-09T19:00:00Z");
})());
check("a proposal sent before the promise proves nothing", evidenceFor({ kind: "PROPOSAL", direction: "OURS", since: made }, [ev("PROPOSAL_SENT", "2026-11-07T19:00:00Z", "x")], TZ) === null);
check("…nor does one in the same minute (the message that carried the promise)", evidenceFor({ kind: "PROPOSAL", direction: "OURS", since: made }, [ev("PROPOSAL_SENT", "2026-11-08T20:00:30Z", "x")], TZ) === null);
check("the first proof wins", evidenceFor({ kind: "CALL", direction: "OURS", since: made }, [ev("CALL_OUT", "2026-11-10T01:00:00Z", "Second call"), ev("CALL_OUT", "2026-11-09T01:00:00Z", "Called them")], TZ)?.words.startsWith("Called them") === true);
check("the wrong kind of event proves nothing", evidenceFor({ kind: "INVOICE", direction: "OURS", since: made }, [ev("PROPOSAL_SENT", "2026-11-09T19:00:00Z", "x")], TZ) === null);
check("their 'I'll pay Monday' is kept by a payment; 'I'll sign' by a signature", evidenceFor({ kind: "PAY", direction: "THEIRS", since: made }, [ev("PAYMENT", "2026-11-09T19:00:00Z", "Paid $2,000")], TZ) !== null && evidenceFor({ kind: "SIGN", direction: "THEIRS", since: made }, [ev("SIGNED", "2026-11-09T19:00:00Z", "Signed")], TZ) !== null);
check("their 'I'll let you know' is kept when they write or sign", evidenceFor({ kind: "DECIDE", direction: "THEIRS", since: made }, [ev("INBOUND", "2026-11-09T19:00:00Z", "They wrote back")], TZ) !== null);
check("OUR promise is never proved by the client's payment", evidenceFor({ kind: "PAY", direction: "OURS", since: made }, [ev("PAYMENT", "2026-11-09T19:00:00Z", "x")], TZ) === null);
check("'find out' and 'other' are ticked by a person", evidenceFor({ kind: "INFO", direction: "OURS", since: made }, [ev("INBOUND", "2026-11-09T19:00:00Z", "x")], TZ) === null && !closesItself("INFO", "OURS") && !closesItself("OTHER", "THEIRS"));
check("which kinds close on their own", closesItself("PROPOSAL", "OURS") && closesItself("PAY", "THEIRS") && !closesItself("PROPOSAL", "THEIRS"));

// ── reminders ──
const R = (over: Partial<{ direction: string; status: string; dueAt: Date | null; createdAt: Date; remindedAt: Date | null }>) => ({ direction: "OURS", status: "OPEN", dueAt: dueInstant(TODAY), createdAt: new Date("2026-11-08T20:00:00Z"), remindedAt: null, ...over });
check("due today, 10 AM → remind", reminderDue(R({}), now, TZ) === "due");
check("due today, 7 AM → not yet", reminderDue(R({}), new Date("2026-11-10T15:30:00Z"), TZ) === null);
check("made this morning for today → only from 3 PM", reminderDue(R({ createdAt: new Date("2026-11-10T17:00:00Z") }), now, TZ) === null && reminderDue(R({ createdAt: new Date("2026-11-10T17:00:00Z") }), new Date("2026-11-10T23:05:00Z"), TZ) === "due");
check("reminded already today → not again", reminderDue(R({ remindedAt: new Date("2026-11-10T16:05:00Z") }), now, TZ) === null);
check("due tomorrow → nothing today", reminderDue(R({ dueAt: dueInstant("2026-11-11") }), now, TZ) === null);
check("a day late, 10 AM → the late reminder, even after the due one", reminderDue(R({ dueAt: dueInstant("2026-11-09"), remindedAt: new Date("2026-11-09T16:05:00Z") }), now, TZ) === "late");
check("…once: reminded late already → never a third", reminderDue(R({ dueAt: dueInstant("2026-11-06"), remindedAt: new Date("2026-11-07T17:05:00Z") }), now, TZ) === null);
check("a day late at 8 AM → not before 9", reminderDue(R({ dueAt: dueInstant("2026-11-09") }), new Date("2026-11-10T16:30:00Z"), TZ) === null);
check("no day, the client's, kept or canceled → never", reminderDue(R({ dueAt: null }), now, TZ) === null && reminderDue(R({ direction: "THEIRS" }), now, TZ) === null && reminderDue(R({ status: "KEPT" }), now, TZ) === null && reminderDue(R({ status: "CANCELED" }), now, TZ) === null);

const said = { client: "Olga Petrova", text: "Send the revised quote", dueAt: dueInstant(TODAY), owner: "Dana" };
check("to the person who promised: their words back, and how to close it", reminderWords("due", said, true, now, TZ) === 'Due today — you told Olga Petrova: "Send the revised quote". Tell me "kept my promise to Olga" when it\'s done.', reminderWords("due", said, true, now, TZ));
check("to the office: whose promise it is", reminderWords("due", said, false, now, TZ) === 'A promise to Olga Petrova is due today (Dana\'s): "Send the revised quote".');
check("late, to them: how late", reminderWords("late", { ...said, dueAt: dueInstant("2026-11-08") }, true, now, TZ).includes("(2 days late)"));
check("late, to the office: whose and how late", reminderWords("late", { ...said, dueAt: dueInstant("2026-11-09") }, false, now, TZ) === 'Dana\'s promise to Olga Petrova is 1 day late: "Send the revised quote".');

// ── the line the Operator reads ──
check("an open promise of ours names its owner", promiseLine(P({}), now, TZ) === "Olga Petrova — Send the revised quote (due today, Dana)");
check("the client's promise names nobody", promiseLine(P({ direction: "THEIRS", text: "Send the deposit", dueAt: at("2026-11-11"), owner: null }), now, TZ) === "Olga Petrova — Send the deposit (due tomorrow)");
check("a kept one says what proved it", promiseLine(P({ status: "KEPT", evidence: "Proposal sent — Rear deck · Nov 9" }), now, TZ) === "Olga Petrova — Send the revised quote (kept — Proposal sent — Rear deck · Nov 9, Dana)");

console.log(bad ? `\n${bad} FAILED` : "\nall ok");
process.exit(bad ? 1 : 0);
