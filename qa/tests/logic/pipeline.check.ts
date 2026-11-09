// THE PIPELINE'S PURE RULES (Smart CRM part 3, 2026-11-08) — lib/pipeline/shared on made-up values. No database.
//   NODE_PATH="" npx tsx --tsconfig tsconfig.json qa/tests/logic/pipeline.check.ts

import { buildWord, effectiveStage, isStage, leadStage, nextStepOf, paidWord, PRICE_WORRY, proposalStage, riskOf, STAGE_KEYS, type NextInput, type RiskInput } from "@/lib/pipeline/shared";

let bad = 0;
function check(label: string, ok: boolean, extra?: unknown) {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${!ok && extra !== undefined ? ` :: ${JSON.stringify(extra)}` : ""}`);
}

const now = new Date("2026-11-08T18:00:00Z");
const ago = (days: number) => new Date(now.getTime() - days * 86_400_000);

// ── the stages ──
check("eight stages, New lead first, Lost last", STAGE_KEYS.length === 8 && STAGE_KEYS[0] === "NEW" && STAGE_KEYS[7] === "LOST");
check("isStage refuses a made-up stage", isStage("SENT") && !isStage("MAYBE") && !isStage(null));

// ── a lead's stage comes from what happened ──
check("a fresh lead is New", leadStage({ status: "NEW", contactedAt: null }, null) === "NEW");
check("a lead someone called is Contacted", leadStage({ status: "NEW", contactedAt: ago(1) }, null) === "CONTACTED");
check("a lead with a visit coming is Visit booked", leadStage({ status: "CONTACTED", contactedAt: ago(2) }, { at: ago(-2), done: false }) === "VISIT");
check("after the visit it's Estimate in progress", leadStage({ status: "CONTACTED", contactedAt: ago(5) }, { at: ago(1), done: true }) === "ESTIMATING");
check("a won lead is Won, a lost or archived one Lost", leadStage({ status: "WON", contactedAt: null }, null) === "WON" && leadStage({ status: "LOST", contactedAt: null }, null) === "LOST" && leadStage({ status: "ARCHIVED", contactedAt: null }, null) === "LOST");

// ── a proposal's stage is its status ──
check("draft = Estimate in progress", proposalStage("DRAFT") === "ESTIMATING");
check("sent or viewed = Estimate sent", proposalStage("SENT") === "SENT" && proposalStage("VIEWED") === "SENT");
check("signed, completed or paid = Won", ["ACCEPTED", "COMPLETED", "PAID"].every((s) => proposalStage(s) === "WON"));
check("declined or expired = Lost", proposalStage("DECLINED") === "LOST" && proposalStage("EXPIRED") === "LOST");

// ── a person's move stands until something real happens after it ──
check("no move: the event's stage", JSON.stringify(effectiveStage({ stage: "SENT", at: ago(3) }, null)) === JSON.stringify({ stage: "SENT", byHand: false }));
check("moved to Negotiation after it was sent: Negotiation, by hand", JSON.stringify(effectiveStage({ stage: "SENT", at: ago(3) }, { stage: "NEGOTIATION", at: ago(1) })) === JSON.stringify({ stage: "NEGOTIATION", byHand: true }));
check("signed after the move: Won wins", effectiveStage({ stage: "WON", at: ago(0.5) }, { stage: "NEGOTIATION", at: ago(1) }).stage === "WON");
check("a junk stage in the hand is ignored", effectiveStage({ stage: "SENT", at: ago(3) }, { stage: "MAYBE", at: ago(1) }).stage === "SENT");
check("moved onto the same stage is not 'by hand'", effectiveStage({ stage: "SENT", at: ago(3) }, { stage: "SENT", at: ago(1) }).byHand === false);

// ── risk, with its reasons ──
const base: RiskInput = { stage: "SENT", now, lastTouch: ago(1), awaitingUsSince: null, urgent: false, overduePromises: 0, visitDoneAt: null, estimateSentAt: ago(2), reschedules: 0, priceWorry: false, expectedClose: null };
check("a quiet fresh deal is low risk", riskOf(base).level === "LOW");
check("won and lost are never at risk", riskOf({ ...base, stage: "WON", urgent: true }).level === "LOW" && riskOf({ ...base, stage: "LOST", overduePromises: 3 }).level === "LOW");
check("7 days no contact = medium", riskOf({ ...base, lastTouch: ago(8) }).level === "MEDIUM");
check("14 days no contact = high, with the days", (() => {
  const r = riskOf({ ...base, lastTouch: ago(15) });
  return r.level === "HIGH" && r.reasons[0] === "No contact in 15 days";
})());
check("their message waiting 1 day = medium; 3 days = high", riskOf({ ...base, awaitingUsSince: ago(1.2) }).level === "MEDIUM" && riskOf({ ...base, awaitingUsSince: ago(3.5) }).level === "HIGH");
check("an overdue promise = high", riskOf({ ...base, overduePromises: 1 }).reasons.includes("A promise to them is overdue"));
check("two overdue promises say two", riskOf({ ...base, overduePromises: 2 }).reasons.includes("2 promises to them are overdue"));
check("a complaint = high", riskOf({ ...base, urgent: true }).level === "HIGH");
check("visit 4 days ago, no estimate = medium", riskOf({ ...base, stage: "ESTIMATING", visitDoneAt: ago(4), estimateSentAt: null }).level === "MEDIUM");
check("visit 8 days ago, no estimate = high", riskOf({ ...base, stage: "ESTIMATING", visitDoneAt: ago(8), estimateSentAt: null }).level === "HIGH");
check("an estimate sent after the visit clears that reason", riskOf({ ...base, visitDoneAt: ago(8), estimateSentAt: ago(6) }).level === "LOW");
check("moved twice = medium", riskOf({ ...base, reschedules: 2 }).reasons.some((x) => x.includes("2 times")));
check("they raised the price = medium", riskOf({ ...base, priceWorry: true }).reasons.includes("They raised the price"));
check("past its expected close = medium", riskOf({ ...base, expectedClose: ago(1) }).reasons.includes("Past its expected close date"));
check("high lists the medium reasons after", (() => {
  const r = riskOf({ ...base, urgent: true, priceWorry: true });
  return r.level === "HIGH" && r.reasons.length === 2 && r.reasons[1] === "They raised the price";
})());

// ── the money-worry words ──
check("'too expensive' and 'over our budget' are a price worry", PRICE_WORRY.test("It's too expensive for us") && PRICE_WORRY.test("That's over our budget"));
check("'the price includes tax' is not", !PRICE_WORRY.test("the price includes tax"));

// ── one next step with its evidence ──
const words = (d: Date) => d.toISOString().slice(5, 10);
const nx: NextInput = { stage: "NEW", now, first: "Dana", createdAt: ago(0.25), contacted: false, awaitingUs: false, overduePromise: null, upcomingVisit: null, visitDoneAt: null, draft: false, sentAt: null, viewCount: 0, viewedAt: null, paidShare: null, buildStatus: null, dayWords: words };
check("a new lead: call, with how long ago", nextStepOf(nx) === "Call Dana — came in 6 h ago, no contact yet");
check("an overdue promise comes before anything", nextStepOf({ ...nx, overduePromise: "Send the deck colors" }) === "Keep your promise: Send the deck colors");
check("their waiting message comes next", nextStepOf({ ...nx, awaitingUs: true }) === "Answer Dana — their message is waiting");
check("contacted: book the visit", nextStepOf({ ...nx, stage: "CONTACTED" }) === "Book a visit with Dana");
check("visit booked: when it is", nextStepOf({ ...nx, stage: "VISIT", upcomingVisit: new Date("2026-11-10T16:00:00Z") }) === "Visit 11-10");
check("a draft: finish and send it", nextStepOf({ ...nx, stage: "ESTIMATING", draft: true }) === "Finish and send the estimate");
check("sent 3 days, never opened: check they got it", nextStepOf({ ...nx, stage: "SENT", sentAt: ago(3) })?.startsWith("Check Dana got it") === true);
check("opened 3 times: follow up, with the count", nextStepOf({ ...nx, stage: "SENT", sentAt: ago(3), viewCount: 3, viewedAt: ago(1) })?.startsWith("Follow up — opened 3×") === true);
check("won, nothing paid: collect the deposit", nextStepOf({ ...nx, stage: "WON", paidShare: 0, buildStatus: null }) === "Collect the deposit");
check("won, built, part paid: collect the final payment", nextStepOf({ ...nx, stage: "WON", paidShare: 0.5, buildStatus: "COMPLETED" }) === "Collect the final payment");
check("won, deposit in, no job: schedule it", nextStepOf({ ...nx, stage: "WON", paidShare: 0.3, buildStatus: null }) === "Schedule the job");
check("lost: no next step", nextStepOf({ ...nx, stage: "LOST" }) === null);

// ── won is not built is not paid ──
check("build words", buildWord(null) === "Not scheduled" && buildWord("COMPLETED") === "Built" && buildWord("IN_PROGRESS") === "In progress" && buildWord("SCHEDULED") === "Scheduled");
check("paid words", paidWord(null) === null && paidWord(0) === "Unpaid" && paidWord(0.4) === "Paid 40%" && paidWord(1) === "Paid");

console.log(bad ? `\n${bad} FAILED` : "\nall ok");
process.exit(bad ? 1 : 0);
