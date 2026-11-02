// RAMP CARDS ON JOBFLEX — the pure rules (lib/ramp/shared, 2026-10-29): what a transaction says, the job it names,
// the category, the text that asks the tech, the reply that answers, the webhook signature.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/ramp.check.ts
import { createHmac } from "node:crypto";
import {
  BILL_STATE_WORDS, RAMP_FIELD_ID, RAMP_FIELD_NAME, RAMP_STOCK_OPTION_ID, askText, billInputError, cardLimitError, confirmText, jobOptionValue, parseAddressLine, parseJobReply, rampAmount, rampBillState, rampCategory, rampEventTransactionId, rampExpenseNote, rampJobTag, rampLineParts, rampMerchant, rampMoneyObject, rampSignatureMatches, rampSpentAt, rampTxState, splitPlanError, toCents,
  type JobOption, type RampTransaction,
} from "../../../src/lib/ramp/shared";
import { RAMP_SCOPES } from "../../../src/lib/ramp/client";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const tx: RampTransaction = {
  id: "tx_1",
  state: "CLEARED",
  amount: 212.4,
  entity_amount: { value: 212.4, currency: "USD" },
  merchant_name: "The Home Depot #4512",
  sk_category_name: "Hardware Stores",
  user_transaction_time: "2026-10-28T17:12:00Z",
  receipts: ["rc_1"],
  card_holder: { user_id: "u_mike", first_name: "Mike", last_name: "Rivera" },
  accounting_field_selections: [{ id: "opt_ramp_9", external_id: "job_smith", name: "Smith roof · Smith", category_info: { id: "fld_ramp_1", external_id: RAMP_FIELD_ID, name: RAMP_FIELD_NAME, type: "OTHER" } }],
};

console.log("── what a transaction says");
check("state, signed amount, merchant, who, when", rampTxState(tx) === "cleared" && rampAmount(tx) === 212.4 && rampMerchant(tx) === "The Home Depot #4512" && rampSpentAt(tx)?.toISOString() === "2026-10-28T17:12:00.000Z");
check("a refund is negative; a pending one with only the old amount still reads", rampAmount({ entity_amount: { value: -40 } }) === -40 && rampAmount({ amount: 12.345, entity_amount: null }) === 12.35 && rampTxState({ state: "PENDING" }) === "pending" && rampTxState({ state: "DECLINED" }) === "declined" && rampTxState({}) === "pending");
check("the job tag from our field, by the field's Ramp id or by its own id", rampJobTag(tx, "fld_ramp_1")?.kind === "job" && (rampJobTag(tx, "fld_ramp_1") as { jobId: string }).jobId === "job_smith" && (rampJobTag(tx, null) as { jobId: string }).jobId === "job_smith");
check("another field's selection is not a job; the stock option is stock; a memo we wrote counts", rampJobTag({ accounting_field_selections: [{ external_id: "job_x", category_info: { id: "other", name: "Department" } }] }, "fld_ramp_1") === null && rampJobTag({ accounting_field_selections: [{ external_id: RAMP_STOCK_OPTION_ID, category_info: { id: "fld_ramp_1" } }] }, "fld_ramp_1")?.kind === "stock" && (rampJobTag({ memo: "JobFlex: cmv123456789 (Lopez deck)" }, null) as { jobId: string }).jobId === "cmv123456789" && rampJobTag({ memo: "JobFlex: stock" }, null)?.kind === "stock");
check("categories from Ramp's words and the merchant", rampCategory(tx) === "Materials" && rampCategory({ sk_category_name: "Gas Stations", merchant_name: "Chevron" }) === "Fuel" && rampCategory({ merchant_name: "Sunbelt Rentals" }) === "Equipment rental" && rampCategory({ merchant_name: "City of Sacramento Permit Center" }) === "Permits" && rampCategory({ sk_category_name: "Restaurants" }) === "Meals" && rampCategory({ merchant_name: "Harbor Freight" }) === "Tools" && rampCategory({ merchant_name: "Mystery Co" }) === "Materials");
check("the expense note", rampExpenseNote(tx) === "Ramp card · The Home Depot #4512 · Mike Rivera · Hardware Stores");

console.log("── the text and the reply");
const options: JobOption[] = [
  { jobId: "job_smith", title: "Smith roof", value: "Smith roof · Smith" },
  { jobId: "job_lopez", title: "Lopez deck", value: "Lopez deck · Maria Lopez" },
  { jobId: "job_oak", title: "12 Oak St fence", value: "12 Oak St fence · Nguyen" },
];
check("the option's words: title, then the client when the title does not say it", jobOptionValue({ title: "Smith roof", clientName: "Smith" }) === "Smith roof" && jobOptionValue({ title: "Lopez deck", clientName: "Maria Lopez" }) === "Lopez deck · Maria Lopez" && jobOptionValue({ title: "Deck", clientName: null, address: "12 Oak St" }) === "Deck · 12 Oak St");
const ask = askText("Ridgeview Roofing", tx, options);
check("the ask names the company, the money, the merchant and the numbered jobs", ask === "Ridgeview Roofing: $212.40 at The Home Depot #4512 on the Ramp card — which job? Reply 1 Smith roof · 2 Lopez deck · 3 12 Oak St fence · S stock. Or the job's name.", ask);
check("a number answers", (parseJobReply("2", options) as { jobId: string }).jobId === "job_lopez" && (parseJobReply(" #1 ", options) as { jobId: string }).jobId === "job_smith" && parseJobReply("9", options) === null);
check("S or stock is the warehouse; none leaves it", parseJobReply("s", options)?.kind === "stock" && parseJobReply("Stock", options)?.kind === "stock" && parseJobReply("none", options)?.kind === "none" && parseJobReply("skip", options)?.kind === "none");
check("the job's name answers when it is one job's", (parseJobReply("lopez", options) as { jobId: string }).jobId === "job_lopez" && (parseJobReply("the oak st fence", options) as { jobId: string }).jobId === "job_oak" && (parseJobReply("Smith roof job", options) as { jobId: string }).jobId === "job_smith");
check("words that fit nothing, or two jobs, do not answer", parseJobReply("roof deck", options) === null && parseJobReply("thanks", options) === null && parseJobReply("", options) === null);
check("the confirmation", confirmText(tx, "Smith roof") === "Got it — $212.40 at The Home Depot #4512 is on Smith roof. Snap the receipt to Ramp if you haven't.");

console.log("── the webhook");
const raw = JSON.stringify({ id: "evt_1", type: "transactions.cleared", business_id: "biz_1", object: { id: "tx_1" } });
const hex = (s: string, r: string) => createHmac("sha256", s).update(r).digest("hex");
const b64 = (s: string, r: string) => createHmac("sha256", s).update(r).digest("base64");
check("the signature holds in hex or base64, with or without a prefix, and fails otherwise", rampSignatureMatches(raw, "sec", hex("sec", raw), hex, b64) && rampSignatureMatches(raw, "sec", b64("sec", raw), hex, b64) && rampSignatureMatches(raw, "sec", `sha256=${hex("sec", raw)}`, hex, b64) && !rampSignatureMatches(raw, "sec", hex("other", raw), hex, b64) && !rampSignatureMatches(raw, "sec", null, hex, b64) && !rampSignatureMatches(raw + " ", "sec", hex("sec", raw), hex, b64));
check("the event's transaction id, wherever it sits", rampEventTransactionId(JSON.parse(raw)) === "tx_1" && rampEventTransactionId({ object: { transaction_id: "tx_2" } }) === "tx_2" && rampEventTransactionId({ data: { id: "tx_3" } }) === "tx_3" && rampEventTransactionId({}) === null);

console.log("── splits (round 2)");
const fld = { id: "fld_ramp_1", external_id: RAMP_FIELD_ID, name: RAMP_FIELD_NAME };
const splitTx: RampTransaction = {
  ...tx,
  accounting_field_selections: [],
  line_items: [
    { amount: { amount: 15000, currency_code: "USD", minor_unit_conversion_rate: 100 }, memo: "shingles", accounting_field_selections: [{ external_id: "job_smith", category_info: fld }] },
    { amount: { amount: 6240, currency_code: "USD", minor_unit_conversion_rate: 100 }, memo: "screws", accounting_field_selections: [{ external_id: "job_lopez", category_info: fld }] },
  ],
};
const parts = rampLineParts(splitTx, "fld_ramp_1");
check("two lines in cents read as $150.00 + $62.40, each with its job", parts.length === 2 && parts[0].amount === 150 && parts[1].amount === 62.4 && (parts[0].tag as { jobId: string }).jobId === "job_smith" && (parts[1].tag as { jobId: string }).jobId === "job_lopez" && parts[0].memo === "shingles");
check("lines without a rate: cents when they sum to the swipe that way, dollars when they sum that way", rampLineParts({ ...splitTx, line_items: [{ amount: { amount: 15000 } }, { amount: { amount: 6240 } }] }, null).map((p) => p.amount).join() === "150,62.4" && rampLineParts({ ...splitTx, line_items: [{ amount: { amount: 150 } }, { amount: { amount: 62.4 } }] }, null).map((p) => p.amount).join() === "150,62.4");
check("one line is no split; lines that do not add up are no split; an untagged line is a part with no job", rampLineParts({ ...splitTx, line_items: [splitTx.line_items![0]] }, null).length === 0 && rampLineParts({ ...splitTx, line_items: [{ amount: { amount: 100 } }, { amount: { amount: 5 } }] }, null).length === 0 && rampLineParts({ ...splitTx, line_items: [splitTx.line_items![0], { amount: { amount: 6240, minor_unit_conversion_rate: 100 } }] }, "fld_ramp_1")[1].tag === null);
check("a stock line is stock", rampLineParts({ ...splitTx, line_items: [splitTx.line_items![0], { amount: { amount: 6240, minor_unit_conversion_rate: 100 }, accounting_field_selections: [{ external_id: RAMP_STOCK_OPTION_ID, category_info: fld }] }] }, "fld_ramp_1")[1].tag?.kind === "stock");
check("the office's split must have two parts that add up, each over zero, no job twice", splitPlanError(212.4, [{ to: { kind: "job", jobId: "a" }, amount: 150 }, { to: { kind: "job", jobId: "b" }, amount: 62.4 }]) === null && splitPlanError(212.4, [{ to: { kind: "job", jobId: "a" }, amount: 212.4 }]) !== null && splitPlanError(212.4, [{ to: { kind: "job", jobId: "a" }, amount: 150 }, { to: { kind: "job", jobId: "b" }, amount: 60 }])?.startsWith("The parts add up to $210.00") === true && splitPlanError(212.4, [{ to: { kind: "job", jobId: "a" }, amount: 150 }, { to: { kind: "job", jobId: "a" }, amount: 62.4 }]) === "The same job twice — merge the two amounts." && splitPlanError(-40, [{ to: { kind: "job", jobId: "a" }, amount: -30 }, { to: { kind: "stock" }, amount: -10 }]) === null && splitPlanError(100, [{ to: { kind: "job", jobId: "a" }, amount: 100 }, { to: { kind: "stock" }, amount: 0 }]) === "Every part needs an amount.");
check("cents, without float drift", toCents(62.4) === 6240 && toCents(0.1 + 0.2) === 30 && toCents(212.4) === 21240);

console.log("── addresses, bills, cards (round 2)");
const addr = parseAddressLine("100 Main St, Kirkland, WA 98033");
check("the company's one-line address becomes street, city, state, ZIP", addr?.address1 === "100 Main St" && addr?.city === "Kirkland" && addr?.state === "WA" && addr?.postal_code === "98033" && addr?.country === "US");
check("a suite, a lower-case state, a trailing USA, a ZIP+4; a line that is not an address is null", parseAddressLine("4120 Folsom Blvd, Suite 200, Sacramento, ca 95819-1234, USA")?.address2 === "Suite 200" && parseAddressLine("4120 Folsom Blvd, Suite 200, Sacramento, ca 95819-1234, USA")?.state === "CA" && parseAddressLine("Kirkland WA") === null && parseAddressLine("") === null);
check("a bill's state from Ramp's words", rampBillState({ status: "PAID", paid_at: "2026-11-02" }) === "paid" && rampBillState({ status: "OPEN", status_summary: "PAYMENT_COMPLETED" }) === "paid" && rampBillState({ status: "OPEN", status_summary: "APPROVAL_PENDING", approval_status: "PENDING" }) === "pending" && rampBillState({ status: "OPEN", status_summary: "PAYMENT_SCHEDULED", approval_status: "APPROVED" }) === "scheduled" && rampBillState({ status: "OPEN", status_summary: "PAYMENT_DETAILS_MISSING", approval_status: "APPROVED" }) === "needs-details" && rampBillState({ status: "OPEN", approval_status: "APPROVED" }) === "approved" && rampBillState({ approval_status: "REJECTED" }) === "rejected" && rampBillState({ archived_at: "2026-11-02" }) === "archived" && rampBillState({ status_summary: "PAYMENT_ERROR" }) === "error" && rampBillState(null) === "pending");
check("every state has its words", (Object.keys(BILL_STATE_WORDS).length === 9) && BILL_STATE_WORDS.paid === "Paid" && BILL_STATE_WORDS["needs-details"].includes("payment details"));
check("Ramp's amount objects in dollars", rampMoneyObject({ amount: 125000, minor_unit_conversion_rate: 100 }) === 1250 && rampMoneyObject({ amount: 125000, minor_unit_conversion_rate: null }) === 1250 && rampMoneyObject(null) === 0);
check("what the office types for a bill, checked", billInputError({ vendorId: "v1", invoiceNumber: "INV-1", amount: 1250, issuedAt: "2026-10-29", dueAt: "2026-11-28" }) === null && billInputError({ vendorId: null, vendorName: "ABC Lumber", vendorEmail: "ar@abc.com", invoiceNumber: "1", amount: 10, issuedAt: "2026-10-29", dueAt: "2026-10-29" }) === null && billInputError({ vendorId: null, vendorName: "", invoiceNumber: "1", amount: 10, issuedAt: "2026-10-29", dueAt: "2026-11-01" }) === "Name the vendor." && billInputError({ vendorId: null, vendorName: "ABC", vendorEmail: "nope", invoiceNumber: "1", amount: 10, issuedAt: "2026-10-29", dueAt: "2026-11-01" })?.includes("email") === true && billInputError({ vendorId: "v1", invoiceNumber: " ", amount: 10, issuedAt: "2026-10-29", dueAt: "2026-11-01" }) === "Type the invoice number." && billInputError({ vendorId: "v1", invoiceNumber: "1", amount: 0, issuedAt: "2026-10-29", dueAt: "2026-11-01" }) === "Type the amount." && billInputError({ vendorId: "v1", invoiceNumber: "1", amount: 10, issuedAt: "2026-11-02", dueAt: "2026-11-01" }) === "The due date is before the invoice date." && billInputError({ vendorId: "v1", invoiceNumber: "1", amount: 10, issuedAt: "soon", dueAt: "2026-11-01" })?.startsWith("Pick") === true);
check("card limits: $50 to $100,000 a month; a per-purchase limit under the monthly one", cardLimitError(2000, null) === null && cardLimitError(2000, 500) === null && cardLimitError(20, null) !== null && cardLimitError(200_000, null) !== null && cardLimitError(2000, 2500) === "The per-purchase limit is over the monthly limit." && cardLimitError(2000, 0) !== null);
const APP_SCOPES = "accounting:read accounting:write bills:read bills:write business:read cards:read cards:write entities:read funds:write memos:write receipts:read transactions:read transactions:write users:read users:write vendors:read vendors:write";
check("the authorize asks for exactly the app's 17 allowed scopes (none for webhooks)", [...RAMP_SCOPES].sort().join(" ") === APP_SCOPES && RAMP_SCOPES.every((s) => !s.startsWith("webhooks:")));

console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);
