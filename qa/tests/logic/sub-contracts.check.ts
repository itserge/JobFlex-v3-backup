// SUBCONTRACTORS, PART 4 — subcontracts, the pure rules (2026-11-08): the statuses and numbers, the payment schedule's
// arithmetic and checks, the draft from an awarded quote, the agreement as sections, the typed signature's schema and
// words, the row's words, the signed copy's name, the office's lines, and the commitment — an executed contract with
// its approved change orders replaces the awarded amount — with the change order's over-the-share warning.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/sub-contracts.check.ts
import "../_lib/_server-only";
import {
  CONTRACT_LABEL,
  agreementSections,
  canCancelContract,
  canEditContract,
  canSignContract,
  changeAnsweredLine,
  changeDecisionInput,
  changeNo,
  contractFileName,
  contractNo,
  contractStatusOf,
  contractTotal,
  contractWords,
  defaultMilestones,
  defaultTerms,
  draftFromQuote,
  milestoneAmounts,
  milestonesCheck,
  parseMilestones,
  signInput,
  signatureWords,
  signedLine,
  signedUsd,
  usd,
  type AgreementLike,
} from "../../../src/lib/subContracts/shared";
import { budgetRows, changeWarning, committedOf } from "../../../src/lib/subQuotes/shared";

let bad = 0;
function check(name: string, ok: boolean, extra?: unknown) {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && extra !== undefined ? `  ${JSON.stringify(extra)}` : ""}`);
}

// ── statuses and numbers ──
check("the numbers read SC-1001 and CO #2; unknown statuses read as a draft", contractNo(1001) === "SC-1001" && changeNo(2) === "CO #2" && contractStatusOf("EXECUTED") === "EXECUTED" && contractStatusOf("nonsense") === "DRAFT" && CONTRACT_LABEL.VIEWED === "Opened by the sub");
check("only a draft is edited; only a sent or opened one is signed; an executed one is never cancelled", canEditContract("DRAFT") && !canEditContract("SENT") && canSignContract("SENT") && canSignContract("VIEWED") && !canSignContract("DRAFT") && !canSignContract("EXECUTED") && canCancelContract("VIEWED") && !canCancelContract("EXECUTED") && !canCancelContract("CANCELLED"));
check("money reads with cents only when there are any; a change order carries its sign", usd(18500) === "$18,500" && usd(1234.5) === "$1,234.50" && signedUsd(3500) === "+$3,500" && signedUsd(-1200) === "−$1,200");

// ── the payment schedule ──
const d20 = defaultMilestones(20);
check("a deposit makes two payments, none makes one on completion", d20.length === 2 && d20[0].pct === 20 && d20[1].pct === 80 && /deposit/i.test(d20[0].name) && defaultMilestones(null).length === 1 && defaultMilestones(null)[0].pct === 100);
const thirds = milestoneAmounts(1000, [{ name: "A", pct: 33.3, due: null }, { name: "B", pct: 33.3, due: null }, { name: "C", pct: 33.4, due: null }]);
check("the payments' dollars add up to the price exactly, the last taking the rounding", Math.round(thirds.reduce((n, m) => n + m.amount, 0) * 100) === 100000 && thirds[0].amount === 333 && thirds[2].amount === 334, thirds);
const odd = milestoneAmounts(10000.01, [{ name: "A", pct: 50, due: null }, { name: "B", pct: 50, due: null }]);
check("odd cents land on the last payment", odd[0].amount === 5000.01 && odd[1].amount === 5000, odd);
check("a schedule that is not 100% says by how much", milestonesCheck([{ name: "Deposit", pct: 20, due: null }, { name: "Done", pct: 70, due: null }]) === "The payment schedule adds up to 90%, not 100%.");
check("a payment without a name or a share, or no payments at all, is refused", milestonesCheck([{ name: " ", pct: 100, due: null }]) === "Every payment needs a name." && milestonesCheck([{ name: "A", pct: 0, due: null }, { name: "B", pct: 100, due: null }]) === "Every payment needs a share above zero." && milestonesCheck([]) === "The payment schedule needs at least one payment." && milestonesCheck(defaultMilestones(25)) === null);
check("a stored schedule is read defensively: garbage is empty, a bad day is dropped, eight at most", parseMilestones("nope").length === 0 && parseMilestones('[{"name":"A","pct":"50","due":"tomorrow"},{"name":"B","pct":50,"due":"2026-12-01"}]')[0].due === null && parseMilestones('[{"name":"A","pct":"50"},{"name":"B","pct":50,"due":"2026-12-01"}]')[1].due === "2026-12-01" && parseMilestones(JSON.stringify(Array.from({ length: 12 }, (_, i) => ({ name: `P${i}`, pct: 1 })))).length === 8);

// ── the draft from the quote ──
const draft = draftFromQuote({ company: "Acme Builders", sub: "Ridge Framing LLC", project: "Lee house", stage: "Framing", trade: "Carpentry", amount: 42000.004, scope: "Framing\n- Walls and roof\n- Sheathing", description: "Two-story addition", materials: "Lumber by the GC", labor: null, startsAt: "2026-12-01", endsAt: "2026-12-20" });
check("the draft carries the stage and project as its title, the awarded price, the request's dates", draft.title === "Framing — Lee house" && draft.amount === 42000 && draft.startsAt === "2026-12-01" && draft.endsAt === "2026-12-20", draft);
check("the scope folds in the request's details and materials, never an empty labor line", draft.scope.startsWith("Framing\n- Walls and roof") && draft.scope.includes("Details: Two-story addition") && draft.scope.includes("Materials: Lumber by the GC") && !draft.scope.includes("Labor:"));
check("everything is due on completion until the office sets the schedule", draft.milestones.length === 1 && draft.milestones[0].pct === 100 && draft.depositPct === null);
const terms = defaultTerms({ company: "Acme Builders", sub: "Ridge Framing LLC" });
check("the standard terms are ten numbered paragraphs with both names and the e-signature clause", terms.split("\n\n").length === 10 && terms.startsWith("1. The work. Ridge Framing LLC") && terms.includes("Acme Builders") && terms.includes("ESIGN") && /^10\. Signatures\./m.test(terms));

// ── the agreement as sections ──
const agreement: AgreementLike = {
  number: 1001,
  title: "Framing — Lee house",
  company: "Acme Builders",
  companyPhone: "(425) 555-0100",
  sub: "Ridge Framing LLC",
  subCompany: null,
  subLicense: "RIDGEFL901AB",
  project: "Lee house",
  projectAddress: "1200 Example St, Kirkland, WA 98034",
  amount: 42000,
  scope: "Framing\n- Walls and roof",
  startsAt: "2026-12-01",
  endsAt: null,
  milestones: [{ name: "Deposit, at signing", pct: 20, due: null }, { name: "On completion", pct: 80, due: "2026-12-22" }],
  terms,
  attachments: ["ridge-estimate.pdf"],
  changes: [
    { number: 1, status: "APPROVED", amount: 3500, scope: "Dormer framing" },
    { number: 2, status: "PROPOSED", amount: 900, scope: "Blocking" },
    { number: 3, status: "DECLINED", amount: 4000, scope: "Deck" },
  ],
};
const secs = agreementSections(agreement);
check("the sections come in order: parties, scope, price, schedule, payments, terms, attachments", secs.map((x) => x.key).join() === "parties,scope,price,schedule,payments,terms,attachments", secs.map((x) => x.key));
check("the parties name both sides, the sub's license and the address", secs[0].lines[0].includes("Acme Builders (the Contractor)") && secs[0].lines[0].includes("Ridge Framing LLC, license RIDGEFL901AB (the Subcontractor)") && secs[0].lines[0].includes("1200 Example St"));
check("the scope is one line per item, the dashes gone", secs[1].lines.join("|") === "Framing|Walls and roof");
const price = secs.find((x) => x.key === "price")!.lines;
check("the price shows only the approved change order and the new total", price.length === 3 && price[1].startsWith("Approved CO #1: +$3,500") && price[2] === "The contract total is now $45,500." && !price.join().includes("Blocking"), price);
check("the schedule reads the start and leaves the end to the parties", secs.find((x) => x.key === "schedule")!.lines[0] === "Work starts on December 1, 2026 and is finished within the time the parties agree.");
check("the payments carry their dollars and due days", secs.find((x) => x.key === "payments")!.lines.join("|") === "Deposit, at signing: 20% — $8,400|On completion: 80% — $33,600, due December 22, 2026");
check("the terms are their paragraphs; no attachments means no section", secs.find((x) => x.key === "terms")!.lines.length === 10 && !agreementSections({ ...agreement, attachments: [] }).some((x) => x.key === "attachments"));
check("the total counts approved change orders only", contractTotal(42000, agreement.changes) === 45500 && contractTotal(42000, []) === 42000);

// ── the typed signature ──
check("a signature needs a name with letters and the box ticked", signInput.safeParse({ name: "Sam Ridge", agree: true }).success && !signInput.safeParse({ name: "S", agree: true }).success && !signInput.safeParse({ name: "12345", agree: true }).success && !signInput.safeParse({ name: "Sam Ridge", agree: false }).success);
const noBox = signInput.safeParse({ name: "Sam Ridge", agree: false });
check("without the box the message says to tick it", !noBox.success && noBox.error.issues[0].message === "Tick the box to agree.");
check("agreeing to a change takes a name; declining takes none", changeDecisionInput.safeParse({ changeId: "c1", agree: true, name: "Sam Ridge" }).success && !changeDecisionInput.safeParse({ changeId: "c1", agree: true }).success && changeDecisionInput.safeParse({ changeId: "c1", agree: false, reason: null }).success);
check("the signature's words carry the day and the address, never a placeholder address", signatureWords({ signedName: "Sam Ridge", signedAt: "2026-11-08T21:04:00.000Z", signedIp: "203.0.113.9" }) === "Signed by Sam Ridge on November 8, 2026 from 203.0.113.9" && signatureWords({ signedName: "Sam Ridge", signedAt: "2026-11-08T21:04:00.000Z", signedIp: "local" }) === "Signed by Sam Ridge on November 8, 2026" && signatureWords({ signedName: null, signedAt: null, signedIp: null }) === null);

// ── words ──
const base = { sentAt: "2026-11-08T10:00:00.000Z", viewedAt: "2026-11-09T10:00:00.000Z", signedName: "Sam Ridge", signedAt: "2026-11-10T10:00:00.000Z", cancelledAt: "2026-11-11T10:00:00.000Z", cancelReason: "Scope moved to another sub", changes: [{ status: "PROPOSED" }, { status: "APPROVED" }] };
check("each state reads in a few words", contractWords({ ...base, status: "DRAFT" }) === "Draft — not sent yet" && contractWords({ ...base, status: "SENT" }) === "Sent Nov 8 · waiting for the signature" && contractWords({ ...base, status: "VIEWED" }) === "Opened Nov 9 · not signed yet" && contractWords({ ...base, status: "EXECUTED" }) === "Signed by Sam Ridge Nov 10 · 1 change order waiting" && contractWords({ ...base, status: "CANCELLED" }) === "Cancelled Nov 11 — Scope moved to another sub");
check("the signed copy is named for the number and the sub", contractFileName(1001, "Ridge Framing, LLC") === "SC-1001-ridge-framing-llc-signed.pdf" && contractFileName(1002, "!!!") === "SC-1002-signed.pdf");
check("the office's lines name the sub, the contract, the work and the money", signedLine({ sub: "Ridge Framing LLC", number: 1001, what: "Framing", project: "Lee house", total: 42000 }) === "Ridge Framing LLC signed Subcontract SC-1001 for Framing on Lee house ($42,000)." && changeAnsweredLine({ sub: "Ridge", number: 2, contractNumber: 1001, agreed: false, amount: 900, project: "Lee house", reason: "Not in my scope" }) === "Ridge declined CO #2 (+$900) on Subcontract SC-1001, Lee house — Not in my scope." && changeAnsweredLine({ sub: "Ridge", number: 1, contractNumber: 1001, agreed: true, amount: -500, project: "Lee house", reason: null }) === "Ridge agreed to CO #1 (−$500) on Subcontract SC-1001, Lee house.");

// ── the commitment ──
check("before a contract is signed the awarded or invoiced amount is committed, as before", committedOf({ stageId: "s", status: "AWARDED", amount: 40000 }) === 40000 && committedOf({ stageId: "s", status: "INVOICED", amount: 40000, invoiceAmount: 41000 }) === 41000 && committedOf({ stageId: "s", status: "AWARDED", amount: 40000, contract: { status: "SENT", amount: 42000, changes: 0 } }) === 40000);
check("an executed contract commits its price plus approved changes, even with an invoice in", committedOf({ stageId: "s", status: "AWARDED", amount: 40000, contract: { status: "EXECUTED", amount: 42000, changes: 3500 } }) === 45500 && committedOf({ stageId: "s", status: "INVOICED", amount: 40000, invoiceAmount: 8400, contract: { status: "EXECUTED", amount: 42000, changes: 0 } }) === 42000);
check("quoted, declined and paid quotes commit nothing", committedOf({ stageId: "s", status: "QUOTED", amount: 9 }) === 0 && committedOf({ stageId: "s", status: "DECLINED", amount: 9 }) === 0 && committedOf({ stageId: "s", status: "PAID", amount: 9 }) === 0);
const rows = budgetRows([{ id: "f", name: "Framing" }], [
  { stageId: "f", status: "AWARDED", amount: 40000, line: 44000, contract: { status: "EXECUTED", amount: 42000, changes: 3500 } },
  { stageId: "f", status: "DECLINED", amount: 39000, line: 44000 },
  { stageId: "f", status: "QUOTED", amount: 41000, line: 44000 },
]);
check("the Budget tab's stage reads the contract: committed 45,500, 1,500 over the 44,000 share, pending apart", rows[0].committed === 45500 && rows[0].left === -1500 && rows[0].over && rows[0].pending === 41000, rows[0]);
check("a change order over the share warns with the amount and the percent; within it, nothing", changeWarning(3500, 44000, 42000, "Framing") === "Approving puts Framing $1,500 over its $44,000 share (3.4%)." && changeWarning(1000, 44000, 42000, "Framing") === null && changeWarning(1000, null, 42000, "Framing") === null);

console.log(bad ? `\n${bad} FAILED` : "\nall ok");
process.exit(bad ? 1 : 0);
