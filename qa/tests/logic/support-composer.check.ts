// The Help composer's pure half (components/v3/support-widget/composer, 2026-10-30): what an opening starts from, the
// SmartHelp mark it keeps ("Ask a person"), and the ticket the send files. Pure: no React, no server.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/support-composer.check.ts
import { BODY_MAX, CATEGORIES, composerOpening, composerTicket } from "../../../src/components/v3/support-widget/composer";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};

const LOG_ID = "2026-10-30T10:15:00.000Z-1a2b3c4d";
const keys = (o: object) => Object.keys(o).join(",");

// ── A plain opening: the composer as it always was ──────────────────────────
const plain = composerOpening(null);
check("a plain opening keeps no mark and leaves the message and category as they were", plain.mark === null && plain.start === null && composerOpening(undefined).mark === null);
const plainTicket = composerTicket("The logo won't upload", "technical", plain.mark);
check("…and files exactly { body, category } — no origin, no logId", keys(plainTicket) === "body,category" && plainTicket.body === "The logo won't upload" && plainTicket.category === "technical");

// ── SmartHelp's hand-off ────────────────────────────────────────────────────
const handed = composerOpening({ message: "How do I connect Stripe?", category: "billing", origin: "smarthelp", logId: LOG_ID });
check("a SmartHelp prefill starts from its words and category", handed.start?.message === "How do I connect Stripe?" && handed.start.category === "billing");
const handedTicket = composerTicket("How do I connect Stripe? It says pending.", "billing", handed.mark);
check(
  "…and files origin + smartHelpLogId with whatever the person sends",
  keys(handedTicket) === "body,category,origin,smartHelpLogId" && handedTicket.origin === "smarthelp" && handedTicket.smartHelpLogId === LOG_ID && handedTicket.body === "How do I connect Stripe? It says pending.",
);
check("a hand-off without a logId files origin alone", keys(composerTicket("m", "general", composerOpening({ message: "m", origin: "smarthelp" }).mark)) === "body,category,origin");
const overlong = composerTicket("m", "general", composerOpening({ message: "m", origin: "smarthelp", logId: "x".repeat(81) }).mark);
check("a logId over 80 is dropped: the ticket still files as SmartHelp's, without it, instead of failing the action's check", overlong.origin === "smarthelp" && !("smartHelpLogId" in overlong));
check("…one of exactly 80 is kept", composerTicket("m", "general", composerOpening({ message: "m", origin: "smarthelp", logId: "x".repeat(80) }).mark).smartHelpLogId?.length === 80);
check("a prefill without a category starts on the default chip, never the one picked before", composerOpening({ message: "m", origin: "smarthelp" }).start?.category === CATEGORIES[0].value && CATEGORIES[0].value === "technical");
check("a prefill without the SmartHelp mark fills the words and keeps no mark", (() => { const o = composerOpening({ message: "m", category: "account" }); return o.mark === null && o.start?.message === "m" && o.start.category === "account"; })());
check(`the message is clipped to the composer's own ${BODY_MAX}`, composerOpening({ message: "a".repeat(BODY_MAX + 500) }).start?.message.length === BODY_MAX);

console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);
