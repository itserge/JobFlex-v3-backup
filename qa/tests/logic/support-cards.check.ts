// Cards in a support answer (lib/support/replyCards, 2026-10-29): "[offer] …" / "[note] …" paragraphs drawn as boxes in
// the email, the Help window, the support page and admin; plain text everywhere else.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/support-cards.check.ts
import { hasReplyCard, replyBlocks, replyPlainText } from "../../../src/lib/support/replyCards";
import { answerBlocks, answerParts } from "../../../src/lib/support/aiState";
import { conversationLetter } from "../../../src/lib/supportReply";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};

const ANSWER = [
  "Hi Dana,",
  "Sorry to hear you're thinking of leaving.",
  '[offer] Two more weeks, free\nHaven\'t had time to really try JobFlex? Reply "yes" and we add two weeks to your trial.',
  "[note] Today's price — yours for life\nJobFlex prices are going up. Stay, and today's price is yours for life — as long as your plan stays active.",
  "If you'd still like to cancel:\n1. Open https://jobflex.app/dashboard/settings?pane=billing\n2. Press Cancel subscription.",
  "What made you decide? Just reply to this email.",
].join("\n\n");

const b = replyBlocks(ANSWER);
check("six blocks: two paragraphs, the offer, the note, the steps, the close", b.length === 6 && b.map((x) => x.kind).join() === "text,text,offer,note,text,text", b.map((x) => x.kind).join());
check("a card's title is its first line, its text the rest", b[2].kind === "offer" && b[2].title === "Two more weeks, free" && /Reply "yes"/.test(b[2].text) && b[3].kind === "note" && b[3].title === "Today's price — yours for life");
check("the tag in any case, a card with only a title, an empty tag dropped", replyBlocks("[OFFER] Just a title").length === 1 && replyBlocks("[OFFER] Just a title")[0].kind === "offer" && replyBlocks("[note]").length === 0);
check("a tag inside a paragraph is plain text", replyBlocks("We said [offer] in the middle.")[0].kind === "text");
check("plain text: titles in capitals, no tags left", /TWO MORE WEEKS, FREE\nHaven't/.test(replyPlainText(ANSWER)) && !/\[(offer|note)\]/i.test(replyPlainText(ANSWER)));
check("the admin preview shows only for a draft with a card", hasReplyCard(ANSWER) && !hasReplyCard("Hi,\n\nJust words.") && !hasReplyCard("We said [offer] in the middle."));

const ab = answerBlocks(ANSWER);
check("the Help window: cards kept, links clickable, the 'reply to this email' close dropped", ab.length === 5 && ab[2].kind === "offer" && ab[3].kind === "note" && ab[4].parts.some((p) => "path" in p && p.path === "/dashboard/settings?pane=billing"), ab.map((x) => x.kind).join());
const flat = answerParts(ANSWER);
check("answerParts stays flat and tag-free (title, a break, the text)", flat.length === 5 && !JSON.stringify(flat).includes("[offer]") && "text" in flat[2][0] && flat[2][0].text === "Two more weeks, free" && "br" in flat[2][1]);

const toCustomer = conversationLetter({ to: "customer", message: { from: "team", by: "Dima", body: ANSWER, at: "2026-10-29T10:00:00Z" }, ticket: { subject: "How do I cancel?", ref: "T-1" }, history: [], link: "https://jobflex.app/dashboard/support" });
check("the email draws the offer as a blue box and the note as an ink box", /border:2px solid #1854a0;[^"]*background:#eef4fc/.test(toCustomer.html) && /border:2px solid #0a0a0a;[^"]*background:#f6f4ef/.test(toCustomer.html) && toCustomer.html.indexOf("Two more weeks, free") < toCustomer.html.indexOf("yours for life"));
check("the email carries no raw tag, html or text", !/\[(offer|note)\]/i.test(toCustomer.html) && !/\[(offer|note)\]/i.test(toCustomer.text) && /TODAY'S PRICE — YOURS FOR LIFE/.test(toCustomer.text));
const toTeam = conversationLetter({ to: "team", message: { from: "customer", by: "Dana", body: "I typed [offer] myself.\n\nThanks", at: "2026-10-29T10:00:00Z" }, ticket: { subject: "S", ref: "T-1", orgName: "Acme" }, history: [], link: null });
check("a customer's own words are never turned into cards", /I typed \[offer\] myself/.test(toTeam.text) && !/#eef4fc/.test(toTeam.html));

console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);
