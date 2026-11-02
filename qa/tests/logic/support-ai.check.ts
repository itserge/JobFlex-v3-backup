// The support AI (2026-10-15, lib/support/aiReply): the answer it must return, what may go out on its own and what
// waits for a person, the notes around an answer, the copy to the support inbox, the fix brief, the row badges —
// and the handbook it reads. Pure: no model, no database, no mail.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/support-ai.check.ts
import { createHash } from "node:crypto";
import {
  DEFAULT_SUPPORT_AI_MODE,
  SEND_CONFIDENCE_MIN,
  SUPPORT_AI_RULES,
  badgeFor,
  commitsMoneyOrData,
  deliveryFor,
  extensionOfferFact,
  failedRecord,
  firstNameOf,
  fixApprovedEmail,
  fixBrief,
  fixedReplyTemplate,
  holdingReply,
  parseSupportAiRecord,
  recordFor,
  supportAiAnswerSchema,
  supportAiMode,
  supportOriginOf,
  supportSystemPrompt,
  supportUserPrompt,
  teamCopyEmail,
  waitingForPerson,
} from "../../../src/lib/support/aiReply";
import { AI_MESSAGES_MAX, aiMayAnswer, answerParts, liveStateOf, needsPersonSince } from "../../../src/lib/support/aiState";
import { stillStuckEmail } from "../../../src/lib/support/aiReply";
import type { ThreadMessage } from "../../../src/lib/supportReply";
import { SUPPORT_HANDBOOK } from "../../../src/lib/support/handbook";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};

const howTo = supportAiAnswerSchema.parse({
  language: "en",
  category: "how-to",
  summary: "How to change the card on file",
  confidence: 91,
  needsHuman: false,
  humanReason: null,
  reply: "Hi Dana,\n\nYou can change the card in a minute:\n\n1. Open https://jobflex.app/dashboard/subscription\n2. Press Manage billing.\n\nIf anything looks off, just reply.",
  internalNotes: "Plan Professional, active.",
  factsUsed: ["Plan Professional, status active"],
  bug: null,
});

// ── The answer contract ─────────────────────────────────────────────────────
check("a clean answer parses with its fields", howTo.category === "how-to" && howTo.confidence === 91 && howTo.bug === null && howTo.factsUsed.length === 1);
const messy = supportAiAnswerSchema.parse({ category: "nonsense", summary: "x".repeat(500), confidence: 140, needsHuman: "yes", reply: "  r  ", bug: { title: "", symptoms: "s", likelyCause: "c", proposedFix: "f" } });
check("a messy answer is mended, not refused: unknown category → other, long summary clipped, confidence capped, a bug with no title dropped", messy.category === "other" && messy.summary.length === 200 && messy.confidence === 100 && messy.needsHuman === false && messy.reply === "r" && messy.bug === null);
const bugAnswer = supportAiAnswerSchema.parse({
  category: "bug",
  summary: "Roof estimate fails for a valid address",
  confidence: 80,
  needsHuman: false,
  reply: "Hi Sam,\n\nThank you for the detail — I've passed this to our engineers and they're on it. We'll email you as soon as it's fixed.\n\nIn the meantime you can draw the roof by hand.",
  bug: { title: "Roof estimator: address lookup fails", symptoms: "Error after Measure", likelyCause: "Geocoder returns no match", proposedFix: "Fall back to the typed coordinates", areas: ["src/lib/roofPackage/x.ts", ""], severity: "urgent", workaround: "Draw by hand" },
});
check("a bug keeps its fix fields, drops empty areas, an unknown severity becomes normal", !!bugAnswer.bug && bugAnswer.bug.areas.length === 1 && bugAnswer.bug.severity === "normal" && bugAnswer.bug.workaround === "Draw by hand");

// ── What goes out on its own ────────────────────────────────────────────────
check("the default is to answer on its own (the owner's ask)", DEFAULT_SUPPORT_AI_MODE === "auto" && supportAiMode("bogus") === "auto" && supportAiMode("draft") === "draft" && supportAiMode("off") === "off");
check("a sure, clean how-to answer goes out", deliveryFor(howTo, "auto").send === true);
check("drafts-only never sends", deliveryFor(howTo, "draft").send === false);
check("asked for a person: held, with its reason", (() => { const d = deliveryFor({ ...howTo, needsHuman: true, humanReason: "Refund request" }, "auto"); return !d.send && d.reason === "Refund request"; })());
check(`under ${SEND_CONFIDENCE_MIN}% sure: held`, deliveryFor({ ...howTo, confidence: SEND_CONFIDENCE_MIN - 1 }, "auto").send === false && deliveryFor({ ...howTo, confidence: SEND_CONFIDENCE_MIN }, "auto").send === true);
check("too short to be an answer: held", deliveryFor({ ...howTo, reply: "Hi! Done." }, "auto").send === false);
check("money back or deleted data in the words: held, whatever the model said", deliveryFor({ ...howTo, reply: `${howTo.reply}\n\nWe've issued a refund for last month.` }, "auto").send === false && deliveryFor({ ...howTo, reply: `${howTo.reply}\n\nWe'll delete your account today.` }, "auto").send === false);
check("the money words: refund, reimburse, credit to your account, a free month, waive", ["We will refund it", "we'll reimburse you", "a credit to your account", "enjoy a free month", "we can waive the fee", "account credit applied"].every(commitsMoneyOrData));
check("…but a card, a proposal's discount or deleting a line item are features, not commitments", !commitsMoneyOrData("Update your credit card under Subscription") && !commitsMoneyOrData("Add a discount line to the proposal") && !commitsMoneyOrData("Delete the line item with the trash icon") && !commitsMoneyOrData("Your credit card was declined"));

// ── The record and the badges ───────────────────────────────────────────────
const sent = recordFor(howTo, { at: "2026-10-15T10:00:00.000Z", model: "gpt-4.1", outcome: "sent" });
const bugRec = recordFor(bugAnswer, { at: "2026-10-15T10:00:00.000Z", model: "gpt-4.1", outcome: "sent" });
check("a record keeps what the admin needs", sent.v === 1 && sent.outcome === "sent" && sent.reply === howTo.reply && sent.fix === null && sent.model === "gpt-4.1");
check("a bug's record carries the fix, waiting for an OK", bugRec.fix?.status === "awaiting" && bugRec.fix.title.startsWith("Roof estimator"));
check("a record survives the store", JSON.stringify(parseSupportAiRecord(JSON.stringify(bugRec))) === JSON.stringify(bugRec) && parseSupportAiRecord("{bad") === null && parseSupportAiRecord(JSON.stringify({ v: 2 })) === null);
check("badges: answered, needs you, draft, failed", badgeFor(sent)?.label === "AI answered" && badgeFor({ ...sent, outcome: "held" })?.label === "Needs you" && badgeFor({ ...sent, outcome: "drafted" })?.label === "AI draft" && badgeFor(failedRecord("t", "-", "no key"))?.label === "AI couldn't answer" && badgeFor(null) === null);
check("a fix outranks the answer: waiting / approved / fixed", badgeFor(bugRec)?.label === "Fix waiting for OK" && badgeFor({ ...bugRec, fix: { ...bugRec.fix!, status: "approved" } })?.label === "Fix approved" && badgeFor({ ...bugRec, fix: { ...bugRec.fix!, status: "done" } })?.label === "Fixed");
check("a held answer someone has since replied to is answered, and no longer waiting", badgeFor({ ...sent, outcome: "held" }, true)?.label === "Answered" && waitingForPerson({ ...sent, outcome: "held" }, false) && !waitingForPerson({ ...sent, outcome: "held" }, true) && !waitingForPerson(sent, false));

// ── The words around an answer ──────────────────────────────────────────────
check("first names: from the name, else a personal email, never a role mailbox", firstNameOf("dana smith") === "Dana" && firstNameOf(null, "mike.jones@x.com") === "Mike" && firstNameOf(null, "office@x.com") === null && firstNameOf("", "j@x.com") === null && firstNameOf("Zoë", null) === "Zoë");
const hold = holdingReply("Dana", "My invoice is wrong");
check("the holding note greets, names their topic, promises a person, invites more detail — and promises no time", hold.startsWith("Hi Dana,") && hold.includes("“My invoice is wrong”") && /member of our team/.test(hold) && !/\b(hour|today|tomorrow|business day)\b/i.test(hold));
check("…and stays polite without a name", holdingReply(null, "").startsWith("Hi there,"));
check("the plain 'it's fixed' note", /has been fixed/.test(fixedReplyTemplate("Sam", "Roof error")) && fixedReplyTemplate(null, "x").startsWith("Hi there,"));

// ── The copy to the support inbox ───────────────────────────────────────────
const ticket = { ref: "J7RCFS", subject: "Roof estimate <fails>", body: "It says error & stops", orgName: "Acme Roofing", customerEmail: "sam@acme.test" };
const copy = teamCopyEmail({ ticket, record: bugRec, sentBody: bugAnswer.reply, facts: ["Plan Professional"], link: "https://jobflex.app/admin/support?ticket=abc" });
check("a bug's copy says the fix needs your OK, in the subject", copy.subject.startsWith("[Fix needs your OK] J7RCFS · Roof estimate <fails>"));
check("the copy carries their words, what was sent, the facts and the fix brief — escaped", copy.html.includes("Roof estimate &lt;fails&gt;") && copy.html.includes("error &amp; stops") && copy.html.includes("Sent to the customer") && copy.html.includes("Plan Professional") && copy.html.includes("Proposed fix") && !copy.html.includes("<fails>"));
check("…with a button to approve and the text twin", copy.html.includes("Approve or decline the fix") && copy.text.includes("Approve or decline the fix: https://jobflex.app/admin/support?ticket=abc"));
const heldCopy = teamCopyEmail({ ticket, record: { ...sent, outcome: "held", reason: "Refund request", ackSent: true }, sentBody: hold, facts: [], link: "L" });
check("a held answer's copy: Needs you, why, the note that went out, and the answer waiting", heldCopy.subject.startsWith("[Needs you]") && heldCopy.text.includes("Why: Refund request") && heldCopy.text.includes("Sent to the customer:\nHi Dana,") && heldCopy.text.includes("The AI's answer, waiting for you:"));
check("a failure's copy says it couldn't answer, and why", teamCopyEmail({ ticket, record: failedRecord("t", "-", "No OpenAI key"), sentBody: null, facts: [], link: "L" }).subject.startsWith("[AI couldn't answer]"));
const brief = fixBrief(ticket, bugAnswer.bug!);
check("the fix brief a developer works from: title, report, symptoms, cause, fix, where, workaround", ["FIX — Roof estimator", "What the customer reported", "Symptoms:", "Likely cause:", "Proposed fix:", "Where to look:\n- src/lib/roofPackage/x.ts", "Workaround told to the customer"].every((k) => brief.includes(k)));
const approved = fixApprovedEmail({ ticket, fix: { ...bugRec.fix!, status: "approved", note: "do it" }, by: "Dmitriy", link: "L" });
check("approval mail: who approved, the note, the brief, and what to press when it's live", approved.subject.startsWith("[Fix approved] J7RCFS") && approved.text.includes("Approved by Dmitriy. Note: do it") && approved.text.includes("Mark fixed — tell the customer"));

// ── What the model reads ────────────────────────────────────────────────────
check("the rules: never refunds, never passwords or card numbers, never change an account, bugs get a fix for the team, JSON only", /refunds, credits/.test(SUPPORT_AI_RULES) && /passwords, full card numbers/.test(SUPPORT_AI_RULES) && /you cannot change anything/.test(SUPPORT_AI_RULES) && /proposedFix/.test(SUPPORT_AI_RULES) && /JSON only/.test(SUPPORT_AI_RULES));
check("the rules: the customer's language, exact names and links, nothing invented, never 'it's fixed'", /customer's language/.test(SUPPORT_AI_RULES) && /https:\/\/jobflex\.app/.test(SUPPORT_AI_RULES) && /Never invent/.test(SUPPORT_AI_RULES) && /Never say it's fixed/.test(SUPPORT_AI_RULES));
const user = supportUserPrompt({ ticket: { ref: "J7RCFS", subject: "S", body: "B", category: "technical", priority: "high", filedAt: "2026-10-15" }, facts: ["Plan Professional"], thread: [{ by: "JobFlex support", at: "t", body: "earlier" }], errors: [], appUrl: "https://jobflex.app/" });
check("the ticket as the model reads it: ref, words, facts, the thread, errors, links", user.includes("TICKET J7RCFS") && user.includes("Message:\nB") && user.includes("- Plan Professional") && user.includes("ALREADY ANSWERED") && user.includes("- none recorded") && user.includes("Links go to https://jobflex.app."));
check("the system message is the rules then the handbook", supportSystemPrompt().startsWith(SUPPORT_AI_RULES) && supportSystemPrompt().includes("HANDBOOK"));
// SmartHelp moved the NEVER topics into PERSON_ONLY_TOPICS and interpolated them back (2026-10-29): the rules must read
// byte for byte as at origin/main 646ab9eb — length + sha256 taken before that edit. A deliberate change to the rules
// updates this pin.
check(
  "the rules read exactly as before PERSON_ONLY_TOPICS was moved out",
  SUPPORT_AI_RULES.length === 6809 && createHash("sha256").update(SUPPORT_AI_RULES, "utf8").digest("hex") === "0014eadd6ebcbfc8bcd117c130a30e3c455e8843b87f0fd89743661ff61e135a",
);

// ── The answer in the Help window ───────────────────────────────────────────
const thread: ThreadMessage[] = [
  { id: "1", at: "2026-10-15T10:00:01.000Z", from: "ai", by: "JobFlex support", to: "dana@x.test", body: "Hi Dana,\n\nHere's how.", channel: "app", kind: "answer" },
];
check("no record yet: the window waits while the AI answers on its own; not when it's off or has no key", liveStateOf(null, [], { mode: "auto", aiOn: true }).state === "pending" && liveStateOf(null, [], { mode: "off", aiOn: true }).state === "none" && liveStateOf(null, [], { mode: "auto", aiOn: false }).state === "none" && liveStateOf(null, [], { mode: "draft", aiOn: true }).state === "none");
const liveAnswer = liveStateOf(sent, thread, { mode: "auto", aiOn: true });
check("an answer that went out: the window shows exactly what was emailed", liveAnswer.state === "answer" && liveAnswer.body === "Hi Dana,\n\nHere's how." && !("verdict" in liveAnswer));
const rated = liveStateOf({ ...sent, customer: { verdict: "solved", at: "t" } }, thread, { mode: "auto", aiOn: true });
check("…with the customer's word on it, once given", rated.state === "answer" && rated.verdict === "solved");
check("held with the note sent: 'we're on it'; held without it, drafted or failed: nothing coming", liveStateOf({ ...sent, outcome: "held", ackSent: true }, [], { mode: "auto", aiOn: true }).state === "held" && liveStateOf({ ...sent, outcome: "held" }, [], { mode: "auto", aiOn: true }).state === "none" && liveStateOf({ ...sent, outcome: "drafted" }, [], { mode: "auto", aiOn: true }).state === "none" && liveStateOf(failedRecord("t", "-", "x"), [], { mode: "auto", aiOn: true }).state === "none");
// ── The conversation (2026-10-17): the AI answers the customer's next message while no person leads ──
const convo = supportUserPrompt({ ticket: { ref: "J7RCFS", subject: "S", body: "B", category: "technical", priority: "high", filedAt: "2026-10-15" }, facts: [], thread: [{ by: "JobFlex support", at: "t1", body: "Try this.", from: "ai" }, { by: "Dana", at: "t2", body: "Didn't work.", from: "customer" }], errors: [], appUrl: "https://jobflex.app" });
check("the model reads the whole conversation by role, and is told to answer the customer's last message", convo.includes("[t2 · THE CUSTOMER]\nDidn't work.") && convo.includes("JobFlex support (you, earlier)") && convo.includes("The customer's last message is the one to answer now"));
check("the AI may answer while only the customer and the AI wrote", aiMayAnswer([{ from: "ai" }, { from: "customer" }], sent).ok);
check("…not once a person on the team wrote", !aiMayAnswer([{ from: "customer" }, { from: "team" }, { from: "customer" }], sent).ok);
check("…not once it handed the ticket over, or the customer asked for a person", !aiMayAnswer([], { ...sent, outcome: "held" }).ok && !aiMayAnswer([], { ...sent, customer: { verdict: "needs-person", at: "t" } }).ok);
check(`…and not past ${AI_MESSAGES_MAX} messages of its own`, !aiMayAnswer(Array.from({ length: AI_MESSAGES_MAX }, () => ({ from: "ai" })), sent).ok);
const parts = answerParts("Hi Dana,\n\n1. Open https://jobflex.app/dashboard/company.\n2. Press Upload — or see https://www.jobflex.app/pricing, not https://evil.example/login\n\nIf anything is unclear, just reply to this email.");
check("the answer's paragraphs; the closing 'reply to this email' line is dropped in the window", parts.length === 2);
check("JobFlex's own links become paths, the sentence's full stop stays outside the link", JSON.stringify(parts[1].filter((x) => "path" in x)) === JSON.stringify([{ path: "/dashboard/company", label: "https://jobflex.app/dashboard/company" }, { path: "/pricing", label: "https://www.jobflex.app/pricing" }]) && parts[1].some((x) => "text" in x && x.text === "."));
check("…any other address stays plain text, and a line break stays a line break", parts[1].some((x) => "text" in x && x.text.includes("https://evil.example/login")) && parts[1].some((x) => "br" in x));
check("a one-paragraph answer keeps its only paragraph even if it says 'reply to this email'", answerParts("Just reply to this email with a screenshot.").length === 1);
const stuck = { ...sent, customer: { verdict: "needs-person" as const, note: "Still no logo", at: "2026-10-15T11:00:00.000Z" } };
check("still stuck: the row says so first, until a person answers after the customer's word", badgeFor(stuck, false)?.label === "Needs you — still stuck" && waitingForPerson(stuck, false) && badgeFor(stuck, true)?.label !== "Needs you — still stuck" && !waitingForPerson(stuck, true));
check("…and 'since' is the customer's word, not the AI's reading", needsPersonSince(stuck) === "2026-10-15T11:00:00.000Z" && needsPersonSince(sent) === sent.at);
check("solved: 'Solved by AI' — though a fix still waiting outranks it", badgeFor({ ...sent, customer: { verdict: "solved", at: "t" } })?.label === "Solved by AI" && badgeFor({ ...bugRec, customer: { verdict: "solved", at: "t" } })?.label === "Fix waiting for OK");
const stuckMail = stillStuckEmail({ ticket, answer: "The answer <b>", note: "Still <no> logo", link: "https://jobflex.app/admin/support?ticket=abc" });
check("the still-stuck copy to the inbox: Needs you, what they added, the answer they saw — escaped", stuckMail.subject.startsWith("[Needs you] J7RCFS · still stuck") && stuckMail.html.includes("Still &lt;no&gt; logo") && stuckMail.html.includes("The answer &lt;b&gt;") && stuckMail.text.includes("What they added:\nStill <no> logo") && stuckMail.text.includes("Open the ticket: https://jobflex.app/admin/support?ticket=abc"));

// ── The handbook ────────────────────────────────────────────────────────────
check("the handbook is there and substantial", SUPPORT_HANDBOOK.length > 30_000, `${SUPPORT_HANDBOOK.length.toLocaleString()} chars`);
check("…covers the areas tickets are about", ["Plans", "Stripe", "password", "Smart Proposal", "Roof", "Video", "proposal", "AI desk", "Internal"].every((k) => SUPPORT_HANDBOOK.includes(k)));
check("…carries no secrets (keys, tokens, webhook secrets)", !/\b(sk-[A-Za-z0-9]{10,}|sk_live_|rk_live_|whsec_[A-Za-z0-9]|re_[A-Za-z0-9]{20,}|AC[0-9a-f]{32}|pk_live_)/.test(SUPPORT_HANDBOOK));
check("…and no personal addresses — only JobFlex's own", (SUPPORT_HANDBOOK.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/gi) ?? []).every((e) => /@(jobflex\.app|platform\.jobflex\.local|example\.com)$/i.test(e)), (SUPPORT_HANDBOOK.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/gi) ?? []).filter((e) => !/@(jobflex\.app|platform\.jobflex\.local|example\.com)$/i.test(e)).slice(0, 5).join(", "));

// ── Cancellations and the offer (owner, 2026-10-26) ───────────────────────────
check(
  "the rules on a cancellation (2026-10-29): the offer card first, the price-for-life card, then the steps, the question last; a person sends it",
  /CANCELLATIONS/.test(SUPPORT_AI_RULES) && /starts with \[offer\] or \[note\]/.test(SUPPORT_AI_RULES) && /Two more weeks, free/.test(SUPPORT_AI_RULES) &&
    /When the ACCOUNT FACTS say "TRIAL EXTENSION: AVAILABLE"/.test(SUPPORT_AI_RULES) && /Today's price — yours for life/.test(SUPPORT_AI_RULES) &&
    /nobody should feel trapped/.test(SUPPORT_AI_RULES) && /Someone is leaving — a person sends this one/.test(SUPPORT_AI_RULES) && /never pushy/.test(SUPPORT_AI_RULES) &&
    SUPPORT_AI_RULES.indexOf("The [offer] card, first") < SUPPORT_AI_RULES.indexOf("The [note] card") &&
    SUPPORT_AI_RULES.indexOf("The [note] card") < SUPPORT_AI_RULES.indexOf("If you'd still like to cancel") &&
    SUPPORT_AI_RULES.indexOf("If you'd still like to cancel") < SUPPORT_AI_RULES.indexOf("One short honest question"),
);
check("the bug report's bullets sit under BUGS again, not under CANCELLATIONS", SUPPORT_AI_RULES.indexOf('Fill "bug" for the team') > SUPPORT_AI_RULES.indexOf("BUGS —") && SUPPORT_AI_RULES.indexOf('Fill "bug" for the team') < SUPPORT_AI_RULES.indexOf("CANCELLATIONS —"));
check("the rules on a bug: double-check with the team, fix as soon as we can; a doubted figure is a bug and asks for the exact case", /double-check it with our team/.test(SUPPORT_AI_RULES) && /SOMETHING LOOKS WRONG/.test(SUPPORT_AI_RULES) && /exact address, proposal or screen/.test(SUPPORT_AI_RULES) && /Never say it's fixed, never give a date/.test(SUPPORT_AI_RULES));
const d = (daysFromNow: number) => new Date(Date.now() + daysFromNow * 86_400_000);
const onTrial = extensionOfferFact({ status: "TRIALING", trialEndsAt: d(5), provider: "STRIPE", plan: "professional" }, null);
check("on a trial: the offer is available and says when the trial ends", onTrial.eligible && /AVAILABLE/.test(onTrial.fact) && /on their trial/.test(onTrial.fact) && /two more weeks/.test(onTrial.fact), onTrial.fact);
const justEnded = extensionOfferFact({ status: "ACTIVE", trialEndsAt: d(-6), provider: "STRIPE", plan: "starter" }, null);
check("a trial that ended six days ago: still available (the 14-day window)", justEnded.eligible && /ended/.test(justEnded.fact) && /within the last 14 days/.test(justEnded.fact), justEnded.fact);
const longPaying = extensionOfferFact({ status: "ACTIVE", trialEndsAt: d(-40), provider: "STRIPE", plan: "starter" }, null);
check("a plan paying for weeks: not available — offer help, never money", !longPaying.eligible && /they pay for the starter/.test(longPaying.fact) && /never money/.test(longPaying.fact), longPaying.fact);
check("no subscription, or a plan granted by hand: not available", !extensionOfferFact(null, null).eligible && !extensionOfferFact({ status: "TRIALING", trialEndsAt: d(5), provider: "MANUAL" }, null).eligible);
const pending = extensionOfferFact({ status: "TRIALING", trialEndsAt: d(5), provider: "STRIPE" }, { days: 14 });
check("a request already pending: say we're on it, don't offer again", pending.eligible && /PENDING/.test(pending.fact) && /don't offer again/.test(pending.fact));
check("the offer's words never trip the money regex, so a draft in auto mode isn't held for that reason", !commitsMoneyOrData("If you simply haven't had time to explore it properly, we'll gladly add two more weeks, free — just reply yes and we'll set it up."));

// ── SmartHelp's "Ask a person" (2026-10-30): the hand-off waits for a person ──
const SMARTHELP_HELD = "Came from SmartHelp — a person sends this one.";
check("a SmartHelp hand-off is never sent on its own: when nothing else holds it, held with its reason", (() => { const d = deliveryFor(howTo, "auto", "smarthelp"); return !d.send && d.reason === SMARTHELP_HELD; })());
check("…the same sure answer without the mark still goes out", deliveryFor(howTo, "auto").send === true);
check("…drafts-only and off keep their own reason", [deliveryFor(howTo, "draft", "smarthelp"), deliveryFor(howTo, "off", "smarthelp")].every((x) => !x.send && x.reason === "The AI is set to draft for you."));
check("…and an answer the model held for a person keeps the model's own reason", (() => { const x = deliveryFor({ ...howTo, needsHuman: true, humanReason: "Refund request" }, "auto", "smarthelp"); return !x.send && x.reason === "Refund request"; })());
check(
  "the mark is read from the ticket's row; no row, a broken one or another origin is none",
  supportOriginOf('{"origin":"smarthelp","logId":"2026-10-30T10:15:00.000Z-1a2b3c4d"}') === "smarthelp" && supportOriginOf('{"origin":"smarthelp","logId":null}') === "smarthelp" &&
    [null, undefined, "", "{bad", "null", "[]", '"smarthelp"', '{"origin":"email","logId":null}', '{"logId":"x"}'].every((raw) => supportOriginOf(raw) === undefined),
);

console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);
