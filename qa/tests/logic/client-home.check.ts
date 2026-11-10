// THE CLIENT'S HOME PAGE — the rules (2026-11-10, Smart CRM part 5), on made-up values. No database.
//   NODE_PATH="" npx tsx --tsconfig tsconfig.json qa/tests/logic/client-home.check.ts

import { cleanMessage, greeting, isHomeToken, MESSAGE_MAX, openedWords, pageInvite, proposalWords } from "@/lib/clientHome/shared";

let bad = 0;
function check(label: string, ok: boolean, extra?: unknown) {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${!ok && extra !== undefined ? ` :: ${JSON.stringify(extra)}` : ""}`);
}

// ── the link ──
check("a real token: 24+ URL-safe characters", isHomeToken("aB3_dE5-fG7hJ9kL1mN2pQ4r") && isHomeToken("x".repeat(64)));
check("anything else is never looked up", !isHomeToken("short") && !isHomeToken("has space in it 123456789012") && !isHomeToken("../../etc/passwd/abcdefghijk") && !isHomeToken(null) && !isHomeToken("x".repeat(65)));

// ── what the client sees a proposal as ──
check("sent or opened: waiting for their OK", proposalWords("SENT")?.label === "Waiting for your OK" && proposalWords("VIEWED")?.tone === "wait");
check("signed, done, paid", proposalWords("ACCEPTED")?.label === "Signed" && proposalWords("COMPLETED")?.label === "Work done" && proposalWords("PAID")?.label === "Paid in full");
check("declined and expired are shown, muted", proposalWords("DECLINED")?.tone === "off" && proposalWords("EXPIRED")?.tone === "off");
check("a draft or an archived one is NEVER shown", proposalWords("DRAFT") === null && proposalWords("ARCHIVED") === null && proposalWords("SOMETHING_NEW") === null);

// ── the client's message ──
check("trimmed, line breaks kept, at most two blank", cleanMessage("  Hi\r\n\r\n\r\n\r\nCan you come Friday?  ") === "Hi\n\nCan you come Friday?");
check("nothing, or one letter, is no message", cleanMessage("   ") === null && cleanMessage("k") === null && cleanMessage(null) === null);
check("capped at the limit", (cleanMessage("x".repeat(5000)) ?? "").length === MESSAGE_MAX);

// ── the office's words ──
const now = new Date(2026, 10, 10, 12);
check("opened words", openedWords(null, now) === "never opened" && openedWords(new Date(2026, 10, 10, 8), now) === "opened today" && openedWords(new Date(2026, 10, 9, 8), now) === "opened yesterday" && openedWords(new Date(2026, 10, 3, 8), now) === "opened 7d ago");
check("a month or more: the date", /^opened [A-Z][a-z]{2} \d+$/.test(openedWords(new Date(2026, 8, 1), now)));
check("greeting: the first name, or a plain hello", greeting("Lee Walk") === "Hi Lee" && greeting("  ") === "Hello" && greeting(null) === "Hello");
const invite = pageInvite("Bell Roofing", "https://jobflex.app/c/abc");
check("the invite names the company and carries the link, and fits one text", invite.startsWith("Bell Roofing:") && invite.endsWith("https://jobflex.app/c/abc") && invite.length <= 160, invite.length);

console.log(bad ? `\n${bad} FAILED` : "\nall ok");
process.exit(bad ? 1 : 0);
