// SUBCONTRACTORS, PART 5a — invoices and payments, the pure rules (2026-11-09): the statuses, numbers and words; the
// rules' checks on an invoice (no amount, a duplicate by number, amount or file, above the payment of the schedule or
// the contract's balance, a change order not yet approved, the stage over its share, a typed amount the read does not
// show); the invoice read's own checks; the payment arithmetic (cash, retainage held and released, settled, the form's
// suggestion, the refusals); a contract's money; and the commitment, which recorded payments now draw down.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/sub-invoices.check.ts
import "../_lib/_server-only";
import {
  INVOICE_LABEL,
  InvoiceRead,
  METHOD_LABEL,
  cashOf,
  contractMoney,
  heldOf,
  invoiceChecks,
  invoiceInLine,
  invoiceNo,
  invoiceReadChecks,
  invoiceReadSummary,
  nextMilestone,
  parseFlags,
  paymentCheck,
  paymentSuggestion,
  paymentWords,
  settledOf,
  subInvoiceInput,
  usd,
  waiverKindFor,
  type InvoiceCheckIn,
  type PaymentLike,
} from "../../../src/lib/subInvoices/shared";
import { agreementSections, defaultTerms } from "../../../src/lib/subContracts/shared";
import { budgetRows, committedOf, paidOf } from "../../../src/lib/subQuotes/shared";

let bad = 0;
function check(name: string, ok: boolean, extra?: unknown) {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && extra !== undefined ? `  ${JSON.stringify(extra)}` : ""}`);
}

// ── words ──
check("invoices number SI-1001 and up; the states and the methods read in words", invoiceNo(1001) === "SI-1001" && INVOICE_LABEL.APPROVED === "Approved — to pay" && METHOD_LABEL.RAMP === "Ramp Bill Pay" && usd(8400) === "$8,400" && usd(933.33) === "$933.33");
check("the waiver a payment asks for: unconditional, final with the last", waiverKindFor(false) === "UNCONDITIONAL_PROGRESS" && waiverKindFor(true) === "UNCONDITIONAL_FINAL");

// ── the rules' checks ──
const contract = { amount: 42000, total: 42000, milestones: [{ name: "Deposit, at signing", pct: 20, due: null }, { name: "Rough-in", pct: 40, due: null }, { name: "On completion", pct: 40, due: null }], pendingChanges: [] as Array<{ number: number; amount: number }> };
const base: InvoiceCheckIn = { amount: 8400, invoiceNumber: "R-207", sha256: "aaa", receivedAt: "2026-11-09T10:00:00.000Z", milestone: 0, others: [], contract, quoteAmount: 42000, billedBefore: 0, stage: { name: "Framing", line: 44000, usedElsewhere: 0 }, readAmount: 8400 };
check("a clean deposit invoice has nothing to check", invoiceChecks(base).length === 0, invoiceChecks(base));
check("no amount yet is the first thing to check", invoiceChecks({ ...base, amount: null })[0]?.kind === "no-amount");
const other = { id: "i1", number: 1001, invoiceNumber: "R-207", amount: 5000, sha256: "bbb", receivedAt: "2026-11-01T10:00:00.000Z", status: "PAID" };
const byNo = invoiceChecks({ ...base, others: [other] });
check("the same invoice number as another is a duplicate, named", byNo.some((f) => f.kind === "duplicate" && f.text === "The same invoice number as SI-1001 (Nov 1)." && f.of === "i1"), byNo);
check("the number matches with or without the # and spaces, in any case", invoiceChecks({ ...base, invoiceNumber: "# r-207", others: [other] }).some((f) => f.kind === "duplicate"));
const byAmount = invoiceChecks({ ...base, invoiceNumber: "R-300", others: [{ ...other, invoiceNumber: "R-100", amount: 8400 }] });
check("the same amount from the same sub within 90 days is a likely duplicate", byAmount.some((f) => f.kind === "duplicate" && /same amount as SI-1001 from Nov 1/.test(f.text)), byAmount);
check("the same amount more than 90 days apart is not", !invoiceChecks({ ...base, invoiceNumber: "R-300", others: [{ ...other, invoiceNumber: "R-100", amount: 8400, receivedAt: "2026-07-01T10:00:00.000Z" }] }).some((f) => f.kind === "duplicate"));
check("a void invoice never makes a duplicate", invoiceChecks({ ...base, others: [{ ...other, status: "VOID" }] }).length === 0);
check("the same file is flagged on its own", invoiceChecks({ ...base, invoiceNumber: "R-301", others: [{ ...other, invoiceNumber: "R-1", amount: 1, sha256: "aaa" }] }).some((f) => f.kind === "same-file" && f.text === "The same file as SI-1001."));
const overMs = invoiceChecks({ ...base, amount: 9000 });
check("an amount above the payment it bills says by how much", overMs.some((f) => f.kind === "over-milestone" && f.text === '$600 above the "Deposit, at signing" payment ($8,400).'), overMs);
const overBal = invoiceChecks({ ...base, amount: 40000, milestone: null, billedBefore: 8400 });
check("an amount above what is left of the contract to bill says so", overBal.some((f) => f.kind === "over-balance" && f.text === "$6,400 more than the contract's $33,600 left to bill."), overBal);
const withCo = invoiceChecks({ ...base, amount: 40000, milestone: null, billedBefore: 8400, contract: { ...contract, pendingChanges: [{ number: 2, amount: 900 }, { number: 3, amount: -500 }] } });
check("over the balance with a change order not yet approved, it names the change order (credits left out)", withCo.some((f) => f.kind === "change-order" && f.text === "CO #2 (+$900) is not approved yet — this invoice may include it."), withCo);
check("without a contract the awarded price is the ceiling", invoiceChecks({ ...base, contract: null, milestone: null, quoteAmount: 20000, billedBefore: 15000, amount: 6000 }).some((f) => f.kind === "over-balance" && /\$1,000 more than the \$5,000 left of the awarded price/.test(f.text)));
const overShare = invoiceChecks({ ...base, stage: { name: "Framing", line: 20000, usedElsewhere: 15000 } });
check("the stage's share counts what other quotes on it hold", overShare.some((f) => f.kind === "over-share" && f.text === "Puts Framing $3,400 over its $20,000 share."), overShare);
check("a typed amount the invoice does not show is flagged", invoiceChecks({ ...base, readAmount: 8000 }).some((f) => f.kind === "read-differs" && f.text === "The invoice reads $8,000; $8,400 is entered."));
check("flags are read back defensively", parseFlags("nope").length === 0 && parseFlags(JSON.stringify([{ kind: "duplicate", text: "x" }, { nope: 1 }])).length === 1);

// ── the read ──
const fig = (value: number | null, source: string | null = null) => ({ value, source, confidence: "high" as const });
const read = InvoiceRead.parse({ contractor: "Ridge Framing LLC", invoiceNumber: "R-207", date: "November 9, 2026", dueDate: "November 24, 2026", amountDue: fig(8400, "Amount due $8,400"), subtotal: fig(null), retainage: fig(null), taxes: fig(null), previouslyPaid: fig(null), period: "Deposit, at signing", reference: null, remitTo: null, lines: [{ description: "Deposit", amount: 8400 }], flags: [], about: "An invoice." });
check("a clean read has no checks of its own", invoiceReadChecks(read, "Invoice #R-207 Amount due $8,400", "2026-11-10").length === 0, invoiceReadChecks(read, "Invoice #R-207 Amount due $8,400", "2026-11-10"));
check("a read with no amount due, lines that do not add up, a figure not in the words, a due day passed", (() => {
  const r = invoiceReadChecks({ ...read, amountDue: fig(8000), lines: [{ description: "a", amount: 5000 }, { description: "b", amount: 2000 }] }, "Amount due $8,400", "2026-11-30");
  return r.includes("The lines add to $7,000; the invoice says $8,000.") && r.includes("Not in the document as written: amount due $8,000.") && r.includes("Due 2026-11-24 — already passed.");
})());
check("the read's line names the number, the amount, the period and the due day", invoiceReadSummary(read) === "#R-207 · due $8,400 · Deposit, at signing · by November 24, 2026");

// ── payments ──
const ps: PaymentLike[] = [
  { amount: 7560, retainageHeld: 840, retainageRelease: false, status: "RECORDED", invoiceId: "a" },
  { amount: 100, retainageHeld: 0, retainageRelease: false, status: "VOID", invoiceId: "a" },
  { amount: 15120, retainageHeld: 1680, retainageRelease: false, status: "RECORDED", invoiceId: "b" },
  { amount: 1000, retainageHeld: 0, retainageRelease: true, status: "RECORDED", invoiceId: null },
];
check("cash counts recorded payments, releases too; void ones never", cashOf(ps) === 23680);
check("retainage held is what was kept less what was released", heldOf(ps) === 1520);
check("an invoice is settled by its cash and the retainage kept from it", JSON.stringify(settledOf("a", ps)) === JSON.stringify({ paid: 7560, held: 840, settled: 8400 }));
const sug = paymentSuggestion({ invoiceAmount: 8400, settledSoFar: 0, retainagePct: 10 });
check("the payment form starts with what is left, the contract's retainage kept from it", sug.amount === 7560 && sug.held === 840 && sug.left === 8400, sug);
check("without retainage the whole is paid; a part already settled comes off", (() => {
  const a = paymentSuggestion({ invoiceAmount: 8400, settledSoFar: 0, retainagePct: null });
  const b = paymentSuggestion({ invoiceAmount: 8400, settledSoFar: 4000, retainagePct: 10 });
  return a.amount === 8400 && a.held === 0 && b.left === 4400 && b.held === 440 && b.amount === 3960;
})());
check("a payment above what is left on the invoice is refused, with the difference", paymentCheck({ amount: 8000, held: 840, release: false, left: 8400, heldNow: 0 }) === "That is $440 more than is left on the invoice ($8,400).");
check("a release pays out held retainage only, and keeps nothing back", paymentCheck({ amount: 2000, held: 0, release: true, left: null, heldNow: 1520 }) === "Only $1,520 of retainage is held." && paymentCheck({ amount: 100, held: 10, release: true, left: null, heldNow: 1520 }) === "A release keeps nothing back." && paymentCheck({ amount: 1520, held: 0, release: true, left: null, heldNow: 1520 }) === null);
check("nothing typed, or a negative, is refused", paymentCheck({ amount: 0, held: 0, release: false, left: 100, heldNow: 0 }) === "Type what was paid." && paymentCheck({ amount: -1, held: 0, release: false, left: 100, heldNow: 0 }) !== null);
check("a payment reads as a sentence", paymentWords({ amount: 7560, retainageHeld: 840, retainageRelease: false, method: "CHECK", reference: "1043", paidAt: "2026-11-10T00:00:00.000Z", status: "RECORDED" }) === "Paid $7,560 by check #1043 on Nov 10 · $840 retainage held" && paymentWords({ amount: 1520, retainageHeld: 0, retainageRelease: true, method: "ACH", reference: null, paidAt: "2026-12-20T00:00:00.000Z", status: "RECORDED" }) === "Retainage released: $1,520 by ACH on Dec 20" && paymentWords({ amount: 15120, retainageHeld: 1680, retainageRelease: false, method: "RAMP", reference: "R-230", paidAt: "2026-11-09T00:00:00.000Z", status: "RECORDED" }) === "Paid $15,120 by Ramp Bill Pay R-230 on Nov 9 · $1,680 retainage held");
const cm = contractMoney(42000, [{ id: "a", amount: 8400, status: "PAID" }, { id: "b", amount: 16800, status: "APPROVED" }, { id: "c", amount: 999, status: "DISPUTED" }, { id: "d", amount: 5000, status: "RECEIVED" }], ps);
check("a contract's money: billed counts received, approved and paid (never disputed); owed is approved less settled", cm.billed === 30200 && cm.approved === 25200 && cm.paid === 23680 && cm.held === 1520 && cm.owed === 0 && cm.left === 11800, cm);
check("the next payment to bill is the first not billed in full", nextMilestone(42000, contract.milestones, new Map([[0, 8400]])) === 1 && nextMilestone(42000, contract.milestones, new Map([[0, 8400], [1, 16800], [2, 16800]])) === null);

// ── the sub's form, the office's line, the agreement ──
check("the sub's invoice needs an amount above zero; the rest may be empty", subInvoiceInput.safeParse({ amount: 8400, invoiceNumber: null, milestone: 0, issuedAt: null, note: null, file: null }).success && !subInvoiceInput.safeParse({ amount: 0, invoiceNumber: null, milestone: null, issuedAt: null, note: null, file: null }).success);
check("the office's line names the sub, the number, the amount, what it bills and the checks", invoiceInLine({ sub: "Ridge Framing", number: 1001, amount: 8400, what: "Deposit, at signing", project: "Lee house", flags: 1 }) === "Ridge Framing sent invoice SI-1001 for $8,400 (Deposit, at signing) on Lee house — 1 thing to check.");
const secs = agreementSections({ number: 1001, title: "Framing", company: "Acme", companyPhone: null, sub: "Ridge", subCompany: null, subLicense: null, project: "Lee house", projectAddress: null, amount: 42000, scope: "Framing", startsAt: null, endsAt: null, milestones: contract.milestones, retainagePct: 10, terms: defaultTerms({ company: "Acme", sub: "Ridge" }), attachments: [], changes: [] });
check("the agreement says the retainage under the payment schedule", secs.find((x) => x.key === "payments")!.lines.at(-1) === "Retainage: 10% of each payment is held back and paid with the final payment, once the work is accepted and the final lien waiver is given.");

// ── the commitment ──
const signed = { stageId: "f", status: "INVOICED", amount: 42000, invoiceAmount: 42000, contract: { status: "EXECUTED", amount: 42000, changes: 0 } };
check("payments recorded on a signed contract come off what is committed (retainage held stays in)", committedOf({ ...signed, paidOut: 7560 }) === 34440 && committedOf({ ...signed, paidOut: 0 }) === 42000);
check("committed never goes below zero; paid in full is spent, not committed", committedOf({ ...signed, paidOut: 50000 }) === 0 && committedOf({ ...signed, status: "PAID", paidOut: 42000 }) === 0);
check("paid is the recorded cash; a quote marked paid before counts its invoice", paidOf({ ...signed, paidOut: 7560 }) === 7560 && paidOf({ stageId: "f", status: "PAID", amount: 9800, invoiceAmount: 9900 }) === 9900 && paidOf({ stageId: "f", status: "AWARDED", amount: 9800 }) === 0);
const rows = budgetRows([{ id: "f", name: "Framing" }], [{ ...signed, paidOut: 7560, line: 44000 }]);
check("the Budget tab: committed less paid, paid on its own, left unchanged by paying", rows[0].committed === 34440 && rows[0].paid === 7560 && rows[0].left === 2000, rows[0]);

console.log(bad ? `\n${bad} FAILED` : "\nall ok");
process.exit(bad ? 1 : 0);
