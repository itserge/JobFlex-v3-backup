// THE INBOX'S PURE RULES (Smart CRM part 2, 2026-11-08) — lib/inbox/shared on made-up values. No database.
//   NODE_PATH="" npx tsx --tsconfig tsconfig.json qa/tests/logic/inbox.check.ts

import { parseMessageRead, preview, statusAfter, threadAddress, threadTokenFromAddress, threadTokenFromAddresses, INBOX_FILTERS } from "@/lib/inbox/shared";

let bad = 0;
function check(label: string, ok: boolean, extra?: unknown) {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${!ok && extra !== undefined ? ` :: ${JSON.stringify(extra)}` : ""}`);
}

const D = "quotes.jobflex.app";
const tok = "cmw7mww7p00012gfkib36";

// ── the thread address ──
check("address: c-<token>@domain, lower-cased", threadAddress(tok, "Quotes.JobFlex.app") === `c-${tok}@quotes.jobflex.app`);
check("token read back from the bare address", threadTokenFromAddress(`c-${tok}@${D}`, D) === tok);
check("token read back from 'Name <address>'", threadTokenFromAddress(`JobFlex <c-${tok}@${D}>`, D) === tok);
check("host case doesn't matter", threadTokenFromAddress(`c-${tok}@QUOTES.jobflex.APP`, D) === tok);
check("another domain is not ours", threadTokenFromAddress(`c-${tok}@evil.example`, D) === null);
check("an rfq- address is never a client thread", threadTokenFromAddress(`rfq-${tok}@${D}`, D) === null);
check("a short token is refused", threadTokenFromAddress(`c-abc@${D}`, D) === null);
check("the first of ours among several", threadTokenFromAddresses(["someone@else.com", `rfq-${tok}@${D}`, `c-${tok}@${D}`], D) === tok);
check("none of ours = null", threadTokenFromAddresses(["a@b.com", null, undefined], D) === null);

// ── where the thread stands ──
check("an inbound message needs an answer", statusAfter("WAITING", "IN") === "NEEDS_REPLY");
check("an inbound message reopens a closed thread", statusAfter("CLOSED", "IN") === "NEEDS_REPLY");
check("our answer means waiting on them", statusAfter("NEEDS_REPLY", "OUT") === "WAITING");
check("our note on a closed thread keeps it closed", statusAfter("CLOSED", "OUT") === "CLOSED");

// ── the list line ──
check("preview flattens and clips", preview("  a\n\n b  ", 10) === "a b" && preview("x".repeat(200), 20).length === 20);

// ── the reader's answer, checked ──
const good = parseMessageRead({
  intent: "ready to proceed",
  urgent: false,
  needsReply: true,
  summary: "Likes it, wants composite.",
  requests: ["Update the proposal", "", 7],
  changes: ["Deck: composite instead of cedar"],
  deadlines: [{ what: "Finished before Thanksgiving", date: "2026-11-26T00:00:00Z" }, { what: "", date: "2026-01-01" }, { what: "Soon", date: "next week" }],
  promises: [{ text: "Pay the deposit Friday", due: "2026-11-13" }],
  suggested: "Send the updated proposal",
});
check("reader: strings kept, junk dropped from lists", good.requests.length === 1 && good.requests[0] === "Update the proposal");
check("reader: a deadline's date cut to the day", good.deadlines[0]?.date === "2026-11-26");
check("reader: a deadline with no words is dropped", good.deadlines.length === 2);
check("reader: a date that isn't a date becomes null", good.deadlines[1]?.date === null);
check("reader: promises carry their due day", good.promises[0]?.text === "Pay the deposit Friday" && good.promises[0]?.due === "2026-11-13");
const junk = parseMessageRead("not an object");
check("reader: garbage becomes the empty reading", junk.intent === null && junk.requests.length === 0 && junk.urgent === false && junk.needsReply === true);
check("reader: needsReply only false when said so", parseMessageRead({ needsReply: false }).needsReply === false && parseMessageRead({}).needsReply === true);
check("reader: urgent only when exactly true", parseMessageRead({ urgent: "yes" }).urgent === false);

// ── the filters ──
check("filters: the plan's seven, All first", INBOX_FILTERS.length === 7 && INBOX_FILTERS[0].key === "all");

console.log(bad ? `\n${bad} FAILED` : "\nall ok");
process.exit(bad ? 1 : 0);
