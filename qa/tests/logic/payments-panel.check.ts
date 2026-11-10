// THE PAYMENTS PANEL'S RULES (2026-11-09, the ProSmart gaps plan, part 3) — late days, the next reminder, the
// "do the payments add up" line, what may be done to a payment, a new payment's amount, how money came in, and the
// two letters (a receipt, "order placed"). No database.
//   NODE_PATH="" npx tsx --tsconfig tsconfig.json qa/tests/logic/payments-panel.check.ts

import "../_lib/_server-only";
import { cleanStageAmount, coverageWords, daysLate, lateChip, lateWords, LADDER_DAYS, nextReminder, paidHow, stageRights } from "@/lib/paymentsPanel/shared";
import { REMINDER_DAYS } from "@/lib/payments/reminders";
import { buildOrderNotice, buildPaymentReceipt } from "@/lib/email/build/client";
import { renderEmail } from "@/lib/email/renderEmail";

let bad = 0;
function check(label: string, ok: boolean, extra?: unknown) {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${!ok && extra !== undefined ? ` :: ${JSON.stringify(extra)}` : ""}`);
}
const D = (m: number, d: number, h = 0) => new Date(2026, m - 1, d, h);
const today = D(11, 10);
const usd = (n: number) => `$${n.toLocaleString("en-US")}`;

// ── late ──
check("due yesterday and open: 1 day late", daysLate(D(11, 9), "UNPAID", today) === 1 && lateWords(1) === "1 day late");
check("due a week ago, a checkout open: 7 days late", daysLate(D(11, 3), "PENDING", today) === 7 && lateWords(7) === "7 days late");
check("due today is not late", daysLate(D(11, 10, 18), "UNPAID", today) === 0 && lateWords(0) === null);
check("paid or closed is never late", daysLate(D(10, 1), "PAID", today) === 0 && daysLate(D(10, 1), "WAIVED", today) === 0);
check("no due date is never late", daysLate(null, "UNPAID", today) === 0);
check("the card's chip counts the late ones", lateChip([{ late: 3, amount: 1000 }, { late: 0, amount: 500 }, { late: 1, amount: 200 }]) === "2 late" && lateChip([{ late: 0, amount: 1 }]) === null);

// ── the next reminder ──
check("the panel's ladder is the sender's ladder", JSON.stringify(LADDER_DAYS) === JSON.stringify(REMINDER_DAYS));
const base = { mode: "auto" as const, proposalOn: null, anchor: D(11, 5), reminderCount: 0, remindedAt: null, owed: true };
const r1 = nextReminder(base);
check("first reminder: the day after it was due", "at" in r1 && r1.round === 1 && r1.at.getDate() === 6, r1);
const r2 = nextReminder({ ...base, reminderCount: 1, remindedAt: D(11, 6, 9) });
check("second: three days after due", "at" in r2 && r2.round === 2 && r2.at.getDate() === 8, r2);
const r2b = nextReminder({ ...base, anchor: D(11, 1), reminderCount: 1, remindedAt: D(11, 9, 9) });
check("never two in a day: a day after the last one, even when the rung is overdue", "at" in r2b && r2b.at.getTime() === D(11, 10, 9).getTime(), r2b);
check("after three: call the client", "stopped" in nextReminder({ ...base, reminderCount: 3 }));
check("company on 'by hand': said so", "stopped" in nextReminder({ ...base, mode: "manual" }) && /press Remind/.test((nextReminder({ ...base, mode: "manual" }) as { stopped: string }).stopped));
check("switched off on this proposal wins", /off for this proposal/.test((nextReminder({ ...base, proposalOn: false }) as { stopped: string }).stopped));
check("nothing owed: no reminders", /Nothing is owed/.test((nextReminder({ ...base, owed: false }) as { stopped: string }).stopped));

// ── do the payments add up ──
check("exact", coverageWords(0, usd).tone === "ok");
check("over by $500: the last ones are capped", /\$500 more than the contract/.test(coverageWords(50000, usd).words) && coverageWords(50000, usd).tone === "warn");
check("short by $1,200: shows as Balance", /\$1,200 isn't in any payment/.test(coverageWords(-120000, usd).words));

// ── what may be done ──
check("an open payment: remove, due date; no undo", JSON.stringify(stageRights({ status: "UNPAID", changeOrder: false, synthetic: false, manualPayment: false })) === JSON.stringify({ remove: true, editDue: true, undo: false }));
check("a checkout open: due date only", JSON.stringify(stageRights({ status: "PENDING", changeOrder: false, synthetic: false, manualPayment: false })) === JSON.stringify({ remove: false, editDue: true, undo: false }));
check("a change order's payment can't be removed", !stageRights({ status: "UNPAID", changeOrder: true, synthetic: false, manualPayment: false }).remove);
check("the Balance row is no stage of its own", !stageRights({ status: "UNPAID", changeOrder: false, synthetic: true, manualPayment: false }).remove);
check("paid by hand: undo; paid by card: no", stageRights({ status: "PAID", changeOrder: false, synthetic: false, manualPayment: true }).undo && !stageRights({ status: "PAID", changeOrder: false, synthetic: false, manualPayment: false }).undo);

// ── a new payment ──
check("dollars to the cent", cleanStageAmount(1499.999, false) === 1500);
check("a percent from 1 to 100", cleanStageAmount(30, true) === 30 && cleanStageAmount(120, true) === null);
check("nothing or less is refused", cleanStageAmount(0, false) === null && cleanStageAmount(-5, true) === null && cleanStageAmount(Number.NaN, false) === null);

// ── how it came in ──
check("money words", paidHow("MANUAL", "CHECK") === "Check" && paidHow("STRIPE", "card") === "Card (Stripe)" && paidHow("STRIPE", "us_bank_account") === "Bank debit (Stripe)" && paidHow("MANUAL", null) === "Recorded by hand");

// ── the letters ──
const org = { id: "org1", name: "Bell Roofing", logoUrl: null, phone: "(425) 555-0141" };
const receipt = renderEmail(buildPaymentReceipt({ org, clientName: "Lee Walk", title: "Gutters Walk", stageLabel: "Deposit", amount: 960, method: "check", paidAt: D(11, 9), paidToDate: 960, remaining: 2240, href: "https://x.test/portal/q/1", ref: "AB12CD34" }));
check("the receipt: subject, amount, what's left", receipt.subject === "Receipt — $960 for Gutters Walk" && receipt.html.includes("$2,240") && receipt.html.includes("check"), receipt.subject);
const order = renderEmail(buildOrderNotice({ org, clientName: "Lee Walk", title: "Gutters Walk", note: "Delivery is about three weeks out.", paidToDate: 960, remaining: 2240, href: "https://x.test/portal/q/1", ref: "AB12CD34" }));
check("order placed: subject, the office's line, paid and left", order.subject === "Your order is placed — Gutters Walk" && order.html.includes("Delivery is about three weeks out.") && order.html.includes("$960") && order.html.includes("Good news, Lee"), order.subject);
const bare = renderEmail(buildOrderNotice({ org, clientName: "", title: "Deck", note: "   ", paidToDate: 0, remaining: 100, href: "https://x.test", ref: "X" }));
check("order placed with no name and a blank line: still reads", bare.html.includes("Good news, there") && !bare.html.includes("<p>   </p>"));

console.log(bad ? `\n${bad} FAILED` : "\nall ok");
process.exit(bad ? 1 : 0);
