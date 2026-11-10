// SUBCONTRACTORS, PART 2 — the estimate read, the comparison and the budget's pending line, the pure rules
// (2026-11-08): the read's schema (a missing figure is null with a flag, never a guess), the arithmetic, the
// "not in the document as written" and expiry checks, the summary line, the comparison table and its fallback
// words, pending that never counts as committed, the award warning's words.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/sub-read.check.ts
import "../_lib/_server-only";
import {
  COMPARE_FIELDS,
  QuoteRead,
  REVIEW_LABEL,
  amountsInText,
  awardWarning,
  budgetRows,
  budgetTotals,
  compareFallbackWords,
  compareTable,
  compareWordsInput,
  figureChecks,
  isoDayOf,
  parseStoredCompare,
  parseStoredRead,
  pendingOf,
  readIsSparse,
  readSummary,
  reviewStatusOf,
  type CompareIn,
  type QuoteRead as Read,
} from "../../../src/lib/subQuotes/shared";

let bad = 0;
function check(name: string, ok: boolean, extra?: unknown) {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && extra !== undefined ? `  ${JSON.stringify(extra)}` : ""}`);
}

const fig = (value: number | null, source: string | null = null, confidence: "high" | "medium" | "low" = "high") => ({ value, source, confidence });
const xyz: Read = {
  contractor: "XYZ Electric LLC",
  proposalNumber: "2041",
  date: "November 8, 2026",
  total: fig(23500, "Total $23,500"),
  labor: fig(14000, "Labor … $14,000"),
  materials: fig(8200, "Materials … $8,200"),
  taxes: fig(850, "Sales tax … $850"),
  permits: fig(450, "Permit and inspections … $450"),
  deposit: fig(7050, "Deposit 30% ($7,050)", "medium"),
  paymentSchedule: "30% on signing · 40% at rough-in · 30% on final",
  scope: "Rough-in wiring for the kitchen and the new bathroom.",
  exclusions: ["Decorative fixtures", "Drywall patching"],
  duration: "about 5 working days",
  start: "within two weeks of signing",
  warranty: "Two years on labor",
  validUntil: "December 8, 2026",
  conditions: ["Price holds 30 days"],
  flags: [],
  about: "A two-page electrical proposal, $23,500.",
};
const TEXT = "XYZ Electric LLC Proposal #2041 Labor $14,000 Materials $8,200 Permit and inspections $450 Sales tax $850 Total $23,500 Deposit 30% ($7,050) Valid until: December 8, 2026";

// ── the schema ──
check("a full read fits the schema", QuoteRead.safeParse(xyz).success);
check("a figure as words, or a field left out, does not", !QuoteRead.safeParse({ ...xyz, total: { value: "23,500", source: null, confidence: "high" } }).success && !QuoteRead.safeParse({ ...xyz, flags: undefined }).success);
check("a missing figure is null with its source null — the shape the reader must keep", QuoteRead.safeParse({ ...xyz, deposit: fig(null) }).success);

// ── the rules' checks ──
check("a read that adds up, with every figure in the words and a future expiry, gets no flag", figureChecks(xyz, TEXT, "2026-11-08").length === 0, figureChecks(xyz, TEXT, "2026-11-08"));
check("no total: flagged", figureChecks({ ...xyz, total: fig(null) }, TEXT, "2026-11-08").some((f) => /No total found/.test(f)));
check("parts that do not add to the total: flagged with the difference", figureChecks({ ...xyz, total: fig(24000, "Total $24,000") }, null, "2026-11-08").some((f) => /parts add to \$23,500; the total says \$24,000 \(a \$500 difference\)/.test(f)));
check("a figure not in the document as written: flagged, by name", figureChecks({ ...xyz, materials: fig(8300, "x") }, TEXT, "2026-11-08").some((f) => f === "Not in the document as written: materials $8,300."));
check("an expired price: flagged with the day", figureChecks(xyz, TEXT, "2026-12-09").some((f) => f === "The price expired on 2026-12-08."));
check("a shaky total: flagged", figureChecks({ ...xyz, total: fig(23500, "Total $23,500", "low") }, TEXT, "2026-11-08").some((f) => /Low confidence on the total/.test(f)));
check("no words (a scan): the in-the-document check is skipped", figureChecks({ ...xyz, materials: fig(8300, "x") }, null, "2026-11-08").every((f) => !/as written/.test(f)));

// ── helpers ──
check("days are read from the document's ways of writing them", isoDayOf("December 8, 2026") === "2026-12-08" && isoDayOf("12/08/2026") === "2026-12-08" && isoDayOf("2026-12-08") === "2026-12-08" && isoDayOf("30 days from the date above") === null && isoDayOf(null) === null);
check("every dollar figure in a text is found, cents and thousands included", amountsInText("Total $23,500.00; deposit 7,050 and $450").join() === "23500,7050,450");
check("the summary line leads with the total", readSummary(xyz).startsWith("Total $23,500 · labor $14,000 · materials $8,200 · deposit $7,050") && /valid until December 8, 2026/.test(readSummary(xyz)));
check("a page with no letters, or no digit, is a scan", readIsSparse("", 1) && readIsSparse("just words and more words ".repeat(20), 1) && !readIsSparse(TEXT.repeat(2), 1));
const stored = JSON.stringify({ read: xyz, model: "gpt-4o", from: "pdf", chars: null, pages: 2, at: "2026-11-08T05:00:00.000Z" });
check("a stored read comes back whole; a broken one is null", parseStoredRead(stored)?.from === "pdf" && parseStoredRead(stored)?.pages === 2 && parseStoredRead(stored)?.read.total.value === 23500 && parseStoredRead("{") === null && parseStoredRead(JSON.stringify({ read: { nope: 1 } })) === null && parseStoredRead(null) === null);
check("the review states and their words", reviewStatusOf("READ") === "READ" && reviewStatusOf("zzz") === "NONE" && REVIEW_LABEL.READ === "Needs review" && REVIEW_LABEL.PENDING === "Reading…" && REVIEW_LABEL.FAILED === "Could not read");

// ── the comparison ──
const row = (id: string, name: string, status: string, amount: number | null, read: Read | null = null, reviewStatus = "NONE"): CompareIn => ({ quoteId: id, contractorName: name, status, amount, read, reviewStatus, versionId: amount != null ? `v-${id}` : null, version: amount != null ? 1 : null, documentName: read ? "estimate.pdf" : null });
const rows = compareTable([row("a", "ABC Electrical", "QUOTED", 18500, { ...xyz, exclusions: ["Decorative fixtures"] }, "REVIEWED"), row("x", "XYZ Electric", "QUOTED", 23500, xyz, "READ"), row("d", "DEF", "ASKED", null), row("g", "GHI", "DECLINED", 15000)], 20000);
check("the lowest priced quote still in leads; a declined cheaper one does not", rows.find((r) => r.quoteId === "a")?.lowest === true && rows.filter((r) => r.lowest).length === 1);
check("over the share is marked with how far; the others are not", rows.find((r) => r.quoteId === "x")?.over === true && rows.find((r) => r.quoteId === "x")?.overBy === 3500 && rows.find((r) => r.quoteId === "a")?.over === false && rows.find((r) => r.quoteId === "d")?.over === false);
check("an awarded quote leads whatever its price", compareTable([row("a", "ABC", "QUOTED", 18500), row("x", "XYZ", "AWARDED", 23500)], null).find((r) => r.quoteId === "x")?.lowest === true);
const field = (key: string) => COMPARE_FIELDS.find((f) => f.key === key)!;
check("the budget cell's words", field("budget").of(rows[0], 20000) === "within the $20,000 share" && field("budget").of(rows[1], 20000) === "$3,500 over the $20,000 share" && field("budget").of(rows[0], null) === "no share to compare" && field("budget").of(rows[2], 20000) === "—");
check("the field cells read from the read, or a dash", field("labor").of(rows[1], null) === "$14,000" && field("taxes").of(rows[1], null) === "$1,300" && field("exclusions").of(rows[0], null) === "Decorative fixtures" && field("labor").of(rows[2], null) === "—" && field("timeline").of(rows[1], null) === "about 5 working days · start within two weeks of signing");
const fallback = compareFallbackWords(rows, 20000);
check("the rules' own two sentences: the lowest, the others by how much, the exclusions, who is over", /^ABC Electrical is lowest at \$18,500; XYZ Electric at \$23,500 \(\$5,000 more\)\./.test(fallback) && /ABC Electrical excludes Decorative fixtures/.test(fallback) && /XYZ Electric is over the \$20,000 share/.test(fallback), fallback);
check("one priced quote: one sentence; none: a plain line", /One priced quote so far: ABC at \$18,500, within the \$20,000 share\./.test(compareFallbackWords(compareTable([row("a", "ABC", "QUOTED", 18500)], 20000), 20000)) && compareFallbackWords([], null) === "No priced quotes to compare yet.");
const input = compareWordsInput(rows, 20000);
check("the model sees fields only — the priced quotes still in, never a document's text", input.quotes.length === 2 && input.budgetShare === 20000 && input.quotes.every((q) => !("text" in q)) && input.quotes.find((q) => q.sub === "ABC Electrical")?.readReviewed === true && input.quotes.find((q) => q.sub === "XYZ Electric")?.overBudgetBy === 3500);
check("a stored comparison comes back; a broken one is null", parseStoredCompare(JSON.stringify({ words: "A. B.", at: "2026-11-08T05:00:00.000Z", versionIds: ["v1"], by: "model" }))?.by === "model" && parseStoredCompare("nope") === null && parseStoredCompare(JSON.stringify({ at: "x" })) === null);

// ── the budget ──
const money = [
  { stageId: "s1", status: "AWARDED", amount: 12000, invoiceAmount: null, line: 15000 },
  { stageId: "s1", status: "QUOTED", amount: 9000, invoiceAmount: null, line: 15000 },
  { stageId: "s2", status: "INVOICED", amount: 22000, invoiceAmount: 23000, line: 20000 },
  { stageId: "s2", status: "PAID", amount: 5000, invoiceAmount: null, line: 20000 },
  { stageId: "s2", status: "REVISION", amount: 6000, invoiceAmount: null, line: 20000 },
  { stageId: null, status: "QUOTED", amount: 4000, invoiceAmount: null, line: null },
  { stageId: "s1", status: "DECLINED", amount: 30000, invoiceAmount: null, line: 15000 },
];
check("pending is quoted and revision-asked, never awarded, invoiced, paid or declined", pendingOf(money) === 19000);
const b = budgetRows([{ id: "s1", name: "Framing" }, { id: "s2", name: "Electrical" }, { id: "s3", name: "Roofing" }], money);
check("one row per stage with quotes, plus the no-stage row; a stage without quotes has none", b.map((r) => r.stageName).join() === "Framing,Electrical,No stage");
const framing = b[0];
const electrical = b[1];
check("Framing: share $15,000, pending $9,000, committed $12,000, left $3,000 — pending not counted", framing.line === 15000 && framing.pending === 9000 && framing.committed === 12000 && framing.paid === 0 && framing.left === 3000 && !framing.over && framing.quotes === 3);
check("Electrical: invoiced counts at the invoice's amount, paid draws down, over the share", electrical.committed === 23000 && electrical.paid === 5000 && electrical.pending === 6000 && electrical.left === -8000 && electrical.over);
check("the totals", JSON.stringify(budgetTotals(b)) === JSON.stringify({ line: 35000, pending: 19000, committed: 35000, paid: 5000, left: -5000 }), budgetTotals(b));

// ── the award warning ──
check("over the share: the warning names the stage, the overage, the share and the percent", awardWarning(23500, 20000, "Electrical") === "Awarding puts Electrical $3,500 over its $20,000 share (17.5%).");
check("within the share, no share, or no price: no warning", awardWarning(18500, 20000, "Electrical") === null && awardWarning(18500, null, "Electrical") === null && awardWarning(null, 20000, "Electrical") === null && awardWarning(20000, 20000, "Electrical") === null);

console.log(bad ? `\n${bad} FAILED` : "\nall ok");
process.exit(bad ? 1 : 0);
