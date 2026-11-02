// SmartHelp's server, its pure half (Task 5, lib/smarthelp/log): the question log's keys and record, the text of a
// reply, the guide counters, what the panel may send, and the answer given without asking the model. Pure: no model,
// no database.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/smarthelp-log.check.ts
import { readFileSync } from "node:fs";
import {
  HELD_QUESTION,
  LOG_PREFIX,
  QUESTION_MAX,
  REPLY_TEXT_MAX,
  bumpGuideCount,
  cleanHistory,
  cleanPage,
  guideKey,
  isLogId,
  logIdOf,
  logKey,
  parseGuideCounts,
  parseQuestionLog,
  personReply,
  questionLog,
  questionOf,
  replyText,
  replyWithoutModel,
  smartHelpSummary,
  withOutcome,
  type QuestionLog,
} from "../../../src/lib/smarthelp/log";
import { PERSON_REPLY, type PersonTopic } from "../../../src/lib/smarthelp/personTopic";
import type { SmartHelpReply } from "../../../src/lib/smarthelp/answer";

let bad = 0;
function check(name: string, ok: boolean, extra?: unknown) {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && extra !== undefined ? ` :: ${JSON.stringify(extra)}` : ""}`);
}

// ── Keys ─────────────────────────────────────────────────────────────────────

check(
  "logKey: smarthelp:q:<ISO time>-<rand>",
  logKey(new Date("2026-10-30T12:00:00.000Z"), "ab12cd34") === "smarthelp:q:2026-10-30T12:00:00.000Z-ab12cd34",
  logKey(new Date("2026-10-30T12:00:00.000Z"), "ab12cd34"),
);
// Across a millisecond, a second, a day, a month and a year — and with the older entries given the "larger" rand, so
// the order can only come from the time.
const times = [
  "2025-12-31T23:59:59.999Z",
  "2026-01-01T00:00:00.000Z",
  "2026-01-01T00:00:00.001Z",
  "2026-01-01T00:00:01.000Z",
  "2026-01-09T23:00:00.000Z",
  "2026-01-10T00:00:00.000Z",
  "2026-02-01T00:00:00.000Z",
  "2026-10-30T09:05:00.000Z",
  "2026-10-30T10:00:00.000Z",
  "2027-01-01T00:00:00.000Z",
];
const keys = times.map((t, i) => logKey(new Date(t), String(99_999_999 - i * 11_111_111).padStart(8, "0")));
const shuffled = [keys[7], keys[2], keys[9], keys[0], keys[5], keys[3], keys[8], keys[1], keys[6], keys[4]];
check("logKey sorts by time as strings", JSON.stringify([...shuffled].sort()) === JSON.stringify(keys), [...shuffled].sort());
check("logKey: every key starts with the log prefix", keys.every((k) => k.startsWith(LOG_PREFIX)) && LOG_PREFIX === "smarthelp:q:");
check("guideKey: smarthelp:g:<id>", guideKey("ai-desk") === "smarthelp:g:ai-desk", guideKey("ai-desk"));

const anId = keys[8].slice(LOG_PREFIX.length);
check("isLogId: the id of a log key", isLogId(anId), anId);
const notIds: unknown[] = [
  keys[8],
  "",
  "rl:smarthelp:u:user_1",
  "../smarthelp:g:ai-desk",
  "2026-10-30T10:00:00.000Z-",
  "2026-10-30T10:00:00.000Z-abc def1",
  "2026-10-30T10:00:00Z-ab12cd34",
  `${anId}x`.padEnd(90, "x"),
  42,
  null,
  { id: anId },
];
check("isLogId: not a key, not another row, not junk", notIds.every((v) => !isLogId(v)), notIds.filter((v) => isLogId(v)));
// The one place an id is made — questionLog and the server's log write both use it.
check(
  "logIdOf: <ISO time>-<rand>, exactly logKey's suffix, and a log id",
  typeof logIdOf === "function" &&
    times.every((t, i) => {
      const rand = `r${i}x9z8y7`;
      const id = logIdOf(new Date(t), rand);
      return id === `${new Date(t).toISOString()}-${rand}` && LOG_PREFIX + id === logKey(new Date(t), rand) && isLogId(id);
    }),
);

// ── The text of a reply ──────────────────────────────────────────────────────

const steps: SmartHelpReply = {
  kind: "steps",
  title: "Set up texting",
  steps: [
    { text: "Open Texting and press Get your number.", open: "/dashboard/texting", show: "texting:get-number" },
    { text: "Fill in your business details and press Register my number.", blocked: "role" },
    { text: "Wait for the approval email." },
  ],
  note: "The guide Set up texting in SmartHelp has them too.",
};
const text = replyText(steps);
check(
  "replyText: the title, the steps numbered 1. 2. 3., then the note",
  text ===
    "Set up texting\n\n1. Open Texting and press Get your number.\n2. Fill in your business details and press Register my number.\n3. Wait for the approval email.\n\nThe guide Set up texting in SmartHelp has them too.",
  text,
);
check("replyText: no Open / Show me — no page path, no target, no blocked mark", !/\/dashboard|texting:get-number|blocked/.test(text), text);
const noteOnly = replyText({ kind: "explain", title: "How the roof is measured", steps: [], note: "From the aerial pictures." });
check("replyText: an explanation is the title and the note", noteOnly === "How the roof is measured\n\nFrom the aerial pictures.", noteOnly);
const long = replyText({
  kind: "steps",
  title: "t".repeat(120),
  steps: Array.from({ length: 8 }, (_, i) => ({ text: `${i} ${"s".repeat(398)}` })),
  note: "n".repeat(600),
});
check("replyText clips at 2000 characters", long.length === REPLY_TEXT_MAX && REPLY_TEXT_MAX === 2000 && long.endsWith("…"), long.length);
check("replyText: a reply under the limit is whole", !text.endsWith("…") && text.length < REPLY_TEXT_MAX);

const topics = Object.keys(PERSON_REPLY) as PersonTopic[];
check(
  "personReply: kind person, the topic's PERSON_REPLY line as the title, no steps, no note",
  topics.length === 5 && topics.every((t) => {
    const r = personReply(t);
    return r.kind === "person" && r.title === PERSON_REPLY[t] && r.steps.length === 0 && r.note === null;
  }),
);
check("a person-topic reply's text is the PERSON_REPLY line", topics.every((t) => replyText(personReply(t)) === PERSON_REPLY[t]));

// ── The answer given without the model ───────────────────────────────────────

const SECRET_PASSWORD = "my password is Hunter22! why can't I sign in";
const SECRET_CARD = "charge 4242 4242 4242 4242 for the deposit";
const LEAVING = "how do I cancel my plan";
const BREAK_IN = "someone logged into my account";
const HOW_TO = "how do I send a proposal by text";
const isReply = (r: ReturnType<typeof replyWithoutModel>, title: string, canForce: boolean) =>
  r !== null && r.reply.kind === "person" && r.reply.title === title && r.reply.steps.length === 0 && r.canForce === canForce;
check(
  "without the model: a secret is security, and Answer it anyway can't skip it",
  [SECRET_PASSWORD, SECRET_CARD].every(
    (q) => isReply(replyWithoutModel(q, false), PERSON_REPLY.security, false) && isReply(replyWithoutModel(q, true), PERSON_REPLY.security, false),
  ),
  replyWithoutModel(SECRET_CARD, true),
);
check(
  "without the model: a person topic is that topic's reply, and it may be forced",
  isReply(replyWithoutModel(LEAVING, false), PERSON_REPLY.leaving, true),
  replyWithoutModel(LEAVING, false),
);
check(
  "without the model: a break-in said in words is security, and it may be forced (no secret in it)",
  isReply(replyWithoutModel(BREAK_IN, false), PERSON_REPLY.security, true),
  replyWithoutModel(BREAK_IN, false),
);
check(
  "Answer it anyway: a person topic goes to the model",
  replyWithoutModel(LEAVING, true) === null && replyWithoutModel(BREAK_IN, true) === null,
);
check("a how-to goes to the model, forced or not", replyWithoutModel(HOW_TO, false) === null && replyWithoutModel(HOW_TO, true) === null);

// ── The record ───────────────────────────────────────────────────────────────

const at = new Date("2026-10-30T15:04:05.678Z");
const who = {
  at,
  rand: "a1b2c3d4",
  orgId: "org_test",
  orgName: "Test Company",
  userId: "user_test",
  userName: "Test Person",
  role: "OWNER",
  plan: "Professional",
  page: "/dashboard/texting",
};
const rec = questionLog({ ...who, question: "  How do I text a client?  ", reply: steps });
check(
  "questionLog: id = the key's time-rand, the asker, the page, the question, SmartHelp's answer as text, outcome none",
  rec.id === "2026-10-30T15:04:05.678Z-a1b2c3d4" &&
    LOG_PREFIX + rec.id === logKey(at, "a1b2c3d4") &&
    isLogId(rec.id) &&
    rec.at === "2026-10-30T15:04:05.678Z" &&
    rec.orgId === "org_test" &&
    rec.orgName === "Test Company" &&
    rec.userId === "user_test" &&
    rec.userName === "Test Person" &&
    rec.role === "OWNER" &&
    rec.plan === "Professional" &&
    rec.page === "/dashboard/texting" &&
    rec.question === "How do I text a client?" &&
    rec.answer === replyText(steps) &&
    rec.kind === "steps" &&
    rec.outcome === "none",
  rec,
);
check("questionLog: its id is logIdOf(at, rand)", typeof logIdOf === "function" && rec.id === logIdOf(at, "a1b2c3d4"), rec.id);
check(
  "questionLog: the page keeps no query but its pane, and no hash",
  questionLog({ ...who, page: "/dashboard/clients?q=Test%20Person#notes", question: "where are my clients?", reply: steps }).page === "/dashboard/clients" &&
    questionLog({ ...who, page: "/dashboard/settings?pane=payments&code=123", question: "how do I get paid?", reply: steps }).page === "/dashboard/settings?pane=payments",
);
const heldPassword = questionLog({ ...who, question: SECRET_PASSWORD, reply: personReply("security") });
const heldCard = questionLog({ ...who, question: SECRET_CARD, reply: personReply("security") });
check(
  "questionLog: a question with a secret in it is never stored — the held line instead",
  heldPassword.question === HELD_QUESTION &&
    heldCard.question === HELD_QUESTION &&
    HELD_QUESTION === "(held: looked like a password, card or code)" &&
    !/Hunter22|4242/.test(JSON.stringify([heldPassword, heldCard])),
  [heldPassword.question, heldCard.question],
);
check(
  "questionLog: the question is clipped to 1000 characters",
  questionLog({ ...who, question: "q".repeat(1500), reply: steps }).question.length === QUESTION_MAX && QUESTION_MAX === 1000,
);
check(
  "questionLog: a person-topic reply is logged as kind person with its line",
  (() => {
    const r = questionLog({ ...who, question: LEAVING, reply: personReply("leaving") });
    return r.kind === "person" && r.answer === PERSON_REPLY.leaving && r.question === LEAVING;
  })(),
);

const back = parseQuestionLog(JSON.stringify(rec));
check("parseQuestionLog: what questionLog wrote comes back the same", JSON.stringify(back) === JSON.stringify(rec), back);
const junk = ["", "{", "null", "[]", "42", '"text"', JSON.stringify({ id: 1 }), JSON.stringify({ ...rec, userId: undefined })];
check("parseQuestionLog: junk, or a row with no id/time/org/asker, is null", junk.every((j) => parseQuestionLog(j) === null), junk.map(parseQuestionLog));
const mended = parseQuestionLog(JSON.stringify({ ...rec, kind: "nonsense", outcome: "maybe", userName: 7 }));
check(
  "parseQuestionLog: an unknown kind is unknown, an unknown outcome is none, a bad field is null",
  mended?.kind === "unknown" && mended.outcome === "none" && mended.userName === null,
  mended,
);

const up = withOutcome(rec, "up");
const down = withOutcome(up, "down");
const person = withOutcome(down, "person");
check(
  "withOutcome: a rating replaces a rating; asking a person stays",
  up.outcome === "up" && down.outcome === "down" && person.outcome === "person" && withOutcome(person, "up").outcome === "person" && rec.outcome === "none",
  [up.outcome, down.outcome, person.outcome, withOutcome(person, "up").outcome],
);

// ── Guide counters ───────────────────────────────────────────────────────────

const zero = { opens: 0, up: 0, down: 0 };
check(
  "parseGuideCounts: none yet, or junk, is all zero",
  [undefined, null, "", "{", "null", "[]", '{"opens":"x"}'].every((c) => JSON.stringify(parseGuideCounts(c)) === JSON.stringify(zero)),
);
const counts = parseGuideCounts('{"opens":3,"up":1,"down":-2,"extra":9}');
check("parseGuideCounts: the counts, never negative, nothing else", JSON.stringify(counts) === JSON.stringify({ opens: 3, up: 1, down: 0 }), counts);
const bumped = bumpGuideCount(counts, "opens");
check(
  "bumpGuideCount: one more of that kind, the rest as they were",
  JSON.stringify(bumped) === JSON.stringify({ opens: 4, up: 1, down: 0 }) && counts.opens === 3 && bumpGuideCount(zero, "down").down === 1,
  bumped,
);

// ── What the panel sends ─────────────────────────────────────────────────────

check(
  "questionOf: trimmed, 1 to 1000 characters",
  (() => {
    const ok = (raw: unknown, want: string) => {
      const r = questionOf(raw);
      return "question" in r && r.question === want;
    };
    const refused = (raw: unknown) => "error" in questionOf(raw);
    return (
      ok("  how do I send a proposal?  ", "how do I send a proposal?") &&
      ok("x".repeat(1000), "x".repeat(1000)) &&
      ok(` ${"x".repeat(1000)} `, "x".repeat(1000)) &&
      refused("") &&
      refused("   \n ") &&
      refused("x".repeat(1001)) &&
      refused(undefined) &&
      refused(42)
    );
  })(),
);

const pages: Array<[unknown, string]> = [
  ["/dashboard/texting", "/dashboard/texting"],
  ["/dashboard/settings?pane=payments", "/dashboard/settings?pane=payments"],
  [`/${"a".repeat(299)}`, `/${"a".repeat(299)}`],
  [`/${"a".repeat(300)}`, "/dashboard"],
  ["dashboard/texting", "/dashboard"],
  ["https://example.com/x", "/dashboard"],
  ["/dash board", "/dashboard"],
  ["/x\nTHE QUESTION: something else", "/dashboard"],
  ["", "/dashboard"],
  [42, "/dashboard"],
  [undefined, "/dashboard"],
];
check("cleanPage: an app path of up to 300 characters, else /dashboard", pages.every(([p, want]) => cleanPage(p) === want), pages.map(([p]) => cleanPage(p)));
// Only a settings pane survives: a sign-in code, a token or a search for a client never reaches the prompt or the log.
const panes: Array<[unknown, string]> = [
  ["/dashboard/settings?pane=payments", "/dashboard/settings?pane=payments"],
  ["/dashboard/x?code=123&state=abc", "/dashboard/x"],
  ["/dashboard#tok", "/dashboard"],
  ["/dashboard/settings?tab=billing&pane=payments#top", "/dashboard/settings?pane=payments"],
  ["/dashboard/settings?pane=Pay_Ments", "/dashboard/settings"],
  [`/dashboard/settings?pane=${"a".repeat(31)}`, "/dashboard/settings"],
  ["/dashboard/settings?pane=pay ments", "/dashboard/settings"],
  ["/dashboard/phone?tab=settings&step=business", "/dashboard/phone"],
  ["/dashboard/clients?q=Test%20Person", "/dashboard/clients"],
  ["/dashboard?", "/dashboard"],
  ["#/dashboard/x", "/dashboard"],
  [`/${"a".repeat(285)}?pane=${"b".repeat(30)}`, `/${"a".repeat(285)}`],
];
check(
  "cleanPage: the path and its settings pane only — any other query, and the hash, are dropped",
  panes.every(([p, want]) => cleanPage(p) === want),
  panes.map(([p]) => cleanPage(p)),
);
check("cleanPage: cleaning a clean page changes nothing", [...pages, ...panes].every(([p]) => cleanPage(cleanPage(p)) === cleanPage(p)));

const history = cleanHistory([
  { q: " how do I send a proposal? ", a: " Open Proposals. " },
  "junk",
  null,
  { q: 1, a: "x" },
  { q: "   ", a: "x" },
  { q: "where is the calendar?" },
  { q: SECRET_PASSWORD, a: PERSON_REPLY.security },
  { q: "is this my card?", a: "card 4242 4242 4242 4242" },
  { q: "and the deck tool?", a: "Open Deck Studio." },
]);
check(
  "cleanHistory: well-formed turns, trimmed — a turn with a secret in its question or answer never goes on",
  JSON.stringify(history) ===
    JSON.stringify([
      { q: "how do I send a proposal?", a: "Open Proposals." },
      { q: "and the deck tool?", a: "Open Deck Studio." },
    ]),
  history,
);
const many = cleanHistory(Array.from({ length: 30 }, (_, i) => ({ q: `question ${i}`, a: `answer ${i}` })));
check("cleanHistory: at most the last 20 turns", many.length === 20 && many[0].q === "question 10" && many[19].q === "question 29", many.length);
const clipped = cleanHistory([{ q: "q".repeat(1500), a: "a".repeat(3000) }]);
check("cleanHistory: a turn is clipped (question 1000, answer 2000)", clipped[0]?.q.length === 1000 && clipped[0]?.a.length === 2000);
check("cleanHistory: not a list is no history", [undefined, null, "x", { q: "a", a: "b" }].every((h) => cleanHistory(h).length === 0));

// ── What the owner sees (Task 9, /admin/support → SmartHelp) ─────────────────

const NOW = new Date("2026-10-30T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const logged = (id: string, at: string, kind: QuestionLog["kind"], outcome: QuestionLog["outcome"]): QuestionLog => ({
  id,
  at,
  orgId: "org-1",
  orgName: "QA Co",
  userId: "user-1",
  userName: null,
  role: "OWNER",
  plan: null,
  page: "/dashboard",
  question: `question ${id}`,
  answer: "answer",
  kind,
  outcome,
});
// Out of order on purpose: the summary sorts its own list.
const week = [
  logged("e", hoursAgo(5), "explain", "none"),
  logged("a", hoursAgo(1), "steps", "up"),
  logged("c", hoursAgo(3), "person", "person"),
  logged("b", hoursAgo(2), "steps", "down"),
  logged("d", hoursAgo(4), "unknown", "none"),
  logged("f", hoursAgo(24 * 7), "steps", "up"), // exactly seven days ago: in
  logged("g", hoursAgo(24 * 7 + 1), "unknown", "down"), // an hour older: out
  logged("h", "not a date", "unknown", "none"), // a row that can't say when: out
];
const sum = smartHelpSummary(week, NOW);
check("smartHelpSummary: the questions of the last 7 days, the edge counted", sum.week === 6, sum.week);
check("smartHelpSummary: 👍, 👎 and sent to a person, in those 7 days", sum.up === 2 && sum.down === 1 && sum.person === 1, sum);
check(
  "smartHelpSummary: not answered = an unknown or person answer, or a 👎 — newest first, older ones left out",
  sum.unanswered.map((q) => q.id).join(",") === "b,c,d",
  sum.unanswered.map((q) => q.id),
);
check(
  "smartHelpSummary: no questions → all zero",
  JSON.stringify(smartHelpSummary([], NOW)) === JSON.stringify({ week: 0, up: 0, down: 0, person: 0, unanswered: [] }),
);

// ── Safe to import in the browser (the panel's Ask a person uses replyText) ────

const source = readFileSync("src/lib/smarthelp/log.ts", "utf8");
check(
  "log.ts is client-safe: no server-only, no database, only types from answer.ts (the handbook stays on the server)",
  !/["']server-only["']/.test(source) && !/@\/lib\/db\b/.test(source) && !/^import (?!type )[^;]*from "\.\/answer"/m.test(source),
);

console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);
