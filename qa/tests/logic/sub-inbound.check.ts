// SUBCONTRACTORS, PART 2 — quotes by email, the pure rules (2026-11-08): the reply address and its token, the subject
// tag, which attachments are documents, the first bytes, the sender on file, the office's words for a held letter,
// the switch, and the webhook signature (the Standard Webhooks check the support inbound already has).
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/sub-inbound.check.ts
import "../_lib/_server-only";
import { createHmac } from "node:crypto";
import { INBOUND_STATE_LABEL, MIN_INLINE_PICTURE_BYTES, excerptOf, inboundAddress, inboundLine, inboundStateOf, pickDocuments, requestNumberFromSubject, senderMatches, sniffType, subjectTag, tokenFromAddress, tokenFromAddresses, whyWords } from "../../../src/lib/subInbound/shared";
import { inboundConfig, inboundReplyTo } from "../../../src/lib/subInbound/config";
import { verifyWebhook, webhookHeaders } from "../../../src/lib/supportInbound";

let bad = 0;
function check(name: string, ok: boolean, extra?: unknown) {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && extra !== undefined ? `  ${JSON.stringify(extra)}` : ""}`);
}

const TOKEN = "cmw7c6s4h00497qv15h37dybj";
const DOMAIN = "quotes.jobflex.app";

// ── the address ──
check("the reply address is rfq-<token>@<domain>, the domain lower-cased", inboundAddress(TOKEN, "Quotes.JobFlex.app ") === `rfq-${TOKEN}@${DOMAIN}`);
check("the token comes out of a display-name address", tokenFromAddress(`Dana Ruiz <rfq-${TOKEN}@${DOMAIN}>`, DOMAIN) === TOKEN);
check("…and out of the bare address, whatever the case of the host", tokenFromAddress(`rfq-${TOKEN}@QUOTES.jobflex.app`, DOMAIN) === TOKEN);
check("another domain is not ours when a domain is given", tokenFromAddress(`rfq-${TOKEN}@evil.example`, DOMAIN) === null);
check("with no domain configured any host is read", tokenFromAddress(`rfq-${TOKEN}@anything.example`, null) === TOKEN);
check("a sub's own address is not a token; a too-short local part is not either", tokenFromAddress("bids@xyzelectric.example", DOMAIN) === null && tokenFromAddress(`rfq-abc@${DOMAIN}`, DOMAIN) === null);
check("the first of our addresses among To, Cc and the envelope wins", tokenFromAddresses(["office@acme.test", null, undefined, `rfq-${TOKEN}@${DOMAIN}`, `rfq-zzzzzzzzzzzz@${DOMAIN}`], DOMAIN) === TOKEN);

// ── the subject ──
check("the subject tag and its fallback", subjectTag(1007) === "[RFQ-1007]" && requestNumberFromSubject("Re: Quote request — QA Co — Subs house [RFQ-1007]") === 1007 && requestNumberFromSubject("Re: your quote") === null && requestNumberFromSubject("rfq-1007 attached") === 1007);

// ── the attachments ──
const picked = pickDocuments([
  { id: "logo", filename: "logo.png", contentType: "image/png", size: 8_000, disposition: "inline", contentId: "<logo@x>" },
  { id: "photo", filename: "page1.jpg", contentType: "image/jpeg", size: 480_000, disposition: "inline", contentId: "<p1@x>" },
  { id: "doc", filename: "Proposal 2041.pdf", contentType: "application/pdf", size: 65_000, disposition: "attachment" },
  { id: "word", filename: "terms.docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: 20_000 },
  { id: "huge", filename: "plans.pdf", contentType: "application/pdf", size: 30 * 1024 * 1024 },
  { id: "byname", filename: "scan.PDF", contentType: "application/octet-stream", size: 1000 },
]);
check("PDFs and real pictures are kept, PDFs first; the logo, the Word file and the 30 MB file are left aside with the reason", picked.docs.map((d) => d.id).join() === "doc,byname,photo" && picked.skipped.map((s) => `${s.name}:${s.why}`).join("|") === "logo.png:an inline picture (a logo)|terms.docx:not a PDF or a picture|plans.pdf:larger than 25 MB", picked);
check("a PDF named by its extension alone is typed as a PDF", picked.docs.find((d) => d.id === "byname")?.type === "application/pdf" && MIN_INLINE_PICTURE_BYTES === 20_000);
check("an attachment without a name gets one", pickDocuments([{ id: "x", filename: null, contentType: "image/jpeg", size: 100_000 }]).docs[0]?.name === "page.jpg");

// ── the first bytes ──
const bytes = (...xs: Array<number | string>) => new Uint8Array(xs.flatMap((x) => (typeof x === "string" ? [...x].map((c) => c.charCodeAt(0)) : [x])).concat(new Array(16).fill(0)));
check("the first bytes name a PDF, a JPEG, a PNG, a WEBP, a HEIC — and nothing else", sniffType(bytes("%PDF-1.4")) === "application/pdf" && sniffType(bytes(0xff, 0xd8, 0xff, 0xe0)) === "image/jpeg" && sniffType(bytes(0x89, "PNG")) === "image/png" && sniffType(bytes("RIFF", 0, 0, 0, 0, "WEBP")) === "image/webp" && sniffType(bytes(0, 0, 0, 0x18, "ftypheic")) === "image/heic" && sniffType(bytes("hello world, this is text")) === null && sniffType(new Uint8Array(3)) === null);

// ── the sender ──
check("the same address, in any case, is the sub", senderMatches("Dana <Bids@XYZElectric.example>", "bids@xyzelectric.example") === "match");
check("another box at the company's own domain is the sub too", senderMatches("dana@xyzelectric.example", "bids@xyzelectric.example") === "match");
check("another box at a public mail domain is a stranger", senderMatches("someone@gmail.com", "xyz@gmail.com") === "other");
check("no address on file: unknown; no sender: other", senderMatches("x@y.example", null) === "unknown" && senderMatches(null, "a@b.example") === "other");

// ── the words ──
check("the excerpt drops the quoted letter and the HTML, and is cut at the length", excerptOf("Our proposal is attached.\n\nDana\n\nOn Nov 7, 2026 at 9:14 AM JobFlex <app@jobflex.app> wrote:\n> old letter", null) === "Our proposal is attached.\n\nDana" && excerptOf(null, "<p>Hello <b>there</b></p>") === "Hello there" && excerptOf("a".repeat(50), null, 10).length === 10);
check("the states and their words", inboundStateOf("nope") === "REVIEW" && INBOUND_STATE_LABEL.REVIEW === "To match" && /match it/.test(whyWords("no-address")) && /closed/.test(whyWords("request-closed")) && /another address/.test(whyWords("stranger")) && whyWords("matched") === "");
check("the office's line with a document, with words, with nothing", /estimate\.pdf attached; the figures are being read/.test(inboundLine("XYZ", "Framing", "Subs house", "estimate.pdf", "")) && /: “Here is our price”/.test(inboundLine("XYZ", "Framing", "Subs house", null, "Here is our price")) && /no words, no file/.test(inboundLine("XYZ", "Framing", "Subs house", null, "")));

// ── the switch ──
const on = { SUBS_INBOUND_ENABLED: "true", SUBS_INBOUND_DOMAIN: "Quotes.JobFlex.app", SUBS_INBOUND_WEBHOOK_SECRET: "whsec_abc" } as NodeJS.ProcessEnv;
check("off without the flag and the domain; on with both, the domain lower-cased", !inboundConfig({} as NodeJS.ProcessEnv).enabled && !inboundConfig({ SUBS_INBOUND_ENABLED: "true" } as NodeJS.ProcessEnv).enabled && inboundConfig(on).enabled && inboundConfig(on).domain === DOMAIN && inboundConfig(on).secret === "whsec_abc");
check("the Reply-To follows the switch", inboundReplyTo(TOKEN, on) === `rfq-${TOKEN}@${DOMAIN}` && inboundReplyTo(TOKEN, {} as NodeJS.ProcessEnv) === null);

// ── the signature (Standard Webhooks, the way Resend signs) ──
const secret = "whsec_" + Buffer.from("a-32-byte-test-secret-for-hmac-00").toString("base64");
const payload = JSON.stringify({ type: "email.received", data: { email_id: "em_1" } });
const now = 1_800_000_000;
const sign = (id: string, ts: number, s = secret) => `v1,${createHmac("sha256", Buffer.from(s.slice(6), "base64")).update(`${id}.${ts}.${payload}`).digest("base64")}`;
const headers = (sig: string, ts = now) => webhookHeaders((n) => ({ "svix-id": "msg_1", "svix-timestamp": String(ts), "svix-signature": sig })[n] ?? null);
check("a letter signed with the secret verifies through the svix-* headers", verifyWebhook(headers(sign("msg_1", now)), payload, secret, now));
check("a wrong secret, a changed body, or a stale timestamp does not", !verifyWebhook(headers(sign("msg_1", now, "whsec_" + Buffer.from("another-secret-another-secret-00").toString("base64"))), payload, secret, now) && !verifyWebhook(headers(sign("msg_1", now)), payload + " ", secret, now) && !verifyWebhook(headers(sign("msg_1", now - 600), now - 600), payload, secret, now));

console.log(bad ? `\n${bad} FAILED` : "\nall ok");
process.exit(bad ? 1 : 0);
