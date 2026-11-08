// SUBCONTRACTORS, PART 1 — the pure rules (2026-11-08): the ten quote statuses and their sets, the request's number
// and title, the link's expiry and closing, overdue with the new states, comparison that skips expired and cancelled
// quotes, the directory's insurance and license words and flags, the trades list, the documents' types and sizes.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/sub-requests.check.ts
import "../_lib/_server-only";
import {
  LICENSE_LABEL,
  QUOTE_LABEL,
  QUOTE_OPEN,
  QUOTE_OUT,
  QUOTE_STATUSES,
  REQUEST_FIRST_NUMBER,
  WAITING_ON_SUB,
  compareQuotes,
  contractorFlags,
  insuranceState,
  insuranceWords,
  linkClosed,
  linkExpiry,
  overdue,
  quoteFlags,
  quoteStatusOf,
  requestNo,
  requestTitleFor,
  revisionText,
  tradesOf,
  type QuoteLike,
} from "../../../src/lib/projectSubs/shared";
import { DOC_TYPES, MAX_DOC_BYTES, docKindOf, docPathname, docSize, docTypeOf, docWords, safeDocName, versionLabel } from "../../../src/lib/subDocs/shared";

let bad = 0;
function check(name: string, ok: boolean, extra?: unknown) {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && extra !== undefined ? `  ${JSON.stringify(extra)}` : ""}`);
}
const q = (id: string, status: string, amount: number | null, more: Partial<QuoteLike> = {}): QuoteLike => ({ id, status, amount, dueBy: null, stageId: "s1", contractorName: `C${id}`, ...more });

// ── statuses ──
check("ten statuses, each labelled; an odd one reads as sent", QUOTE_STATUSES.length === 10 && QUOTE_STATUSES.every((s) => QUOTE_LABEL[s]) && quoteStatusOf("REVISION") === "REVISION" && quoteStatusOf("nope") === "ASKED" && QUOTE_LABEL.ASKED === "Sent");
check("the sets: open, with the sub, out of the running", QUOTE_OPEN.includes("VIEWED") && QUOTE_OPEN.includes("REVISION") && !QUOTE_OPEN.includes("EXPIRED") && WAITING_ON_SUB.join() === "ASKED,VIEWED,REVISION" && QUOTE_OUT.join() === "DECLINED,EXPIRED,CANCELLED");

// ── the request ──
check("requests count from 1001 and read RFQ-1042", REQUEST_FIRST_NUMBER === 1001 && requestNo(1042) === "RFQ-1042");
check("the title: the stage, else the trade, else the project", requestTitleFor("Framing and dry-in", "Carpentry", "Lee house") === "Framing and dry-in" && requestTitleFor(null, "Plumbing", "Lee house") === "Plumbing" && requestTitleFor(null, null, "Lee house") === "Lee house");

// ── the link's life ──
check("a link closes 30 days after the deadline, or after the send with none", linkExpiry("2026-11-13", "2026-11-08T10:00:00.000Z") === "2026-12-13" && linkExpiry(null, "2026-11-08T10:00:00.000Z") === "2026-12-08");
check("closed: finished states, and a sent one past its expiry; open otherwise", linkClosed("PAID", null, "2026-11-10") && linkClosed("DECLINED", null, "2026-11-10") && linkClosed("ASKED", "2026-12-13", "2026-12-14") && !linkClosed("ASKED", "2026-12-13", "2026-12-13") && !linkClosed("QUOTED", null, "2026-11-10") && !linkClosed("AWARDED", "2026-01-01", "2026-11-10"));

// ── overdue and the flags with the new states ──
{
  const today = "2026-11-10";
  check("overdue: sent, viewed or a revision asked, past the reply-by day", overdue(q("a", "ASKED", null, { dueBy: "2026-11-07" }), today) && overdue(q("b", "VIEWED", null, { dueBy: "2026-11-07" }), today) && overdue(q("c", "REVISION", 100, { dueBy: "2026-11-07" }), today) && !overdue(q("d", "QUOTED", 100, { dueBy: "2026-11-07" }), today) && !overdue(q("e", "VIEWED", null, { dueBy: "2026-11-12" }), today));
  const flags = quoteFlags([q("l", "VIEWED", null, { dueBy: "2026-11-07", contractorName: "Ridge" }), q("i", "QUOTED", 5000, { contractorName: "Lee" })], today);
  check("flags: a viewed-and-late one is overdue, a quoted one is in", flags.length === 2 && flags[0].kind === "quote-overdue" && /Ridge/.test(flags[0].text) && flags[1].kind === "quote-in", flags);
}

// ── comparing skips the out-of-the-running ──
{
  const cmp = compareQuotes([q("a", "QUOTED", 12_000), q("b", "EXPIRED", 8_000), q("c", "CANCELLED", 7_000), q("d", "DECLINED", 6_000)], 10_000);
  const by = (id: string) => cmp.find((c) => c.quote.id === id)!;
  check("an expired, cancelled or declined price never wins; the quoted one does", by("a").best && !by("b").best && !by("c").best && !by("d").best && by("a").over && by("a").overBy === 2_000);
}

// ── the directory ──
{
  const today = "2026-11-08";
  check("insurance: none, fine, within 30 days, expired", insuranceState(null, today) === "none" && insuranceState("2027-03-04", today) === "ok" && insuranceState("2026-11-20", today) === "soon" && insuranceState("2026-10-01", today) === "expired" && insuranceState("2026-12-08", today) === "soon" && insuranceState("2026-12-09", today) === "ok");
  check("insurance words", insuranceWords("2027-03-04", today) === "insured to Mar 4, 2027" && insuranceWords("2026-11-20", today) === "insurance expires Nov 20, 2026" && insuranceWords("2026-10-01", today) === "insurance expired Oct 1, 2026" && insuranceWords(null, today) === "no insurance on file", insuranceWords("2027-03-04", today));
  const flags = contractorFlags({ insuranceUntil: "2026-10-01", licenseStatus: "EXPIRED", w9Status: "NONE" }, today);
  check("flags: expired insurance (late), license expired (late), no W-9", flags.length === 3 && flags[0].kind === "insurance" && flags[0].late && flags[1].kind === "license" && flags[1].late && /expired/.test(flags[1].text) && flags[2].kind === "w9" && !flags[2].late, flags);
  check("a sub in good standing has no flags; one expiring soon has a soft one", contractorFlags({ insuranceUntil: "2027-03-04", licenseStatus: "ACTIVE", w9Status: "ON_FILE" }, today).length === 0 && contractorFlags({ insuranceUntil: "2026-11-20", licenseStatus: "ACTIVE", w9Status: "ON_FILE" }, today).every((f) => !f.late));
  check("license labels", LICENSE_LABEL.UNKNOWN === "Not checked" && LICENSE_LABEL.ACTIVE === "Active");
  check("trades: the main one first, the others once, blanks dropped", tradesOf("Electrical", JSON.stringify(["Siding", "Electrical", " ", "Windows"])).join(",") === "Electrical,Siding,Windows" && tradesOf(null, "not json").length === 0 && tradesOf("Roofing", null).join() === "Roofing");
}

// ── documents ──
check("a PDF or a picture, 25 MB, by type or by name", DOC_TYPES.includes("application/pdf") && MAX_DOC_BYTES === 25 * 1024 * 1024 && docTypeOf("application/pdf; charset=binary", null) === "application/pdf" && docTypeOf("application/octet-stream", "Estimate.PDF") === "application/pdf" && docTypeOf("image/jpeg", "x.jpg") === "image/jpeg" && docTypeOf("text/html", "page.html") === null && docTypeOf(null, "scan.heic") === "image/heic");
check("sizes, names, paths", docSize(640 * 1024) === "640 KB" && docSize(2.4 * 1024 * 1024) === "2.4 MB" && docSize(0) === null && safeDocName('bad/name:"x".pdf') === "bad-name-x-.pdf" && safeDocName("  ", "document.pdf") === "document.pdf" && /^subs\/org1\/proj1\/\d+-Estimate\.pdf$/.test(docPathname("org1", "proj1", "Estimate.pdf")) && /^subs\/org1\/company\//.test(docPathname("org1", null, "w9.pdf")));
check("kinds and words", docKindOf("invoice") === "INVOICE" && docKindOf("nope") === "OTHER" && versionLabel(3) === "V3" && docWords({ name: "Electrical_Proposal.pdf", bytes: 2.4 * 1024 * 1024, contentType: "application/pdf" }) === "Electrical_Proposal.pdf · 2.4 MB · PDF");

// ── texts ──
check("the revision text carries the note and the link", /^Ridge Builders: could you revise your quote on Lee house\? Fixtures out\. A new price here: https:\/\/x\/q\/t1$/.test(revisionText("Ridge Builders", "Lee house", "Fixtures out.", "https://x/q/t1")));

console.log(bad ? `\n${bad} FAILED` : "\nall ok");
process.exit(bad ? 1 : 0);
