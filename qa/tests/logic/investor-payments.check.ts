// What came in for the investor page (lib/investorPayments), against the Stripe MOCK: the paid subscription
// invoices of the accounts counted, each with what of it went back — refunds done or on the way, chargebacks lost
// (owner, 2026-11-02: "after a week they got refunded — do you track those from Stripe?"). No Stripe call.
//
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/investor-payments.check.ts
import "../_lib/_server-only"; // `server-only` outside Next — see the file
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const MOCK = path.join(os.tmpdir(), `jobflex-qa-investor-payments-${process.pid}.json`);
process.env.STRIPE_MOCK_FILE = MOCK;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_SECRET_KEY_TEST;

import { emptyMockStore, readMockStore, writeMockStore, type MockInvoice, type MockMoneyBack } from "../../../src/lib/sdk/stripeMock";
import { readSubscriptionPayments } from "../../../src/lib/investorPayments";

let bad = 0;
const check = (name: string, ok: boolean, detail: unknown = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail !== "" ? ` — ${JSON.stringify(detail)}` : ""}`);
};

const SINCE = Date.UTC(2026, 9, 1) / 1000;
const DAY = 86_400;
// The mock speaks the old invoice shape (`charge`, `subscription`); a clover one names its payments instead.
const inv = (id: string, customer: string, cents: number, day: number, extra: Partial<MockInvoice> & Record<string, unknown> = {}): MockInvoice =>
  ({ id, customer, subscription: `sub_${customer}`, status: "paid", paid: true, amount_paid: cents, amount_due: cents, subtotal: cents, total: cents, currency: "usd", created: SINCE + day * DAY, billing_reason: "subscription_cycle", charge: `ch_${id}`, number: null, hosted_invoice_url: null, invoice_pdf: null, lines: { data: [] }, ...extra }) as MockInvoice;
const back = (id: string, amount: number, status: string, charge: string | null, pi: string | null = null, day = 20): MockMoneyBack => ({ id, amount, status, charge, payment_intent: pi, created: SINCE + day * DAY });

const store = emptyMockStore();
store.invoices = [
  inv("in_full", "cus_a", 9900, 8), // refunded in full a week on
  inv("in_part", "cus_b", 9900, 9), // $20 back as a goodwill credit
  inv("in_kept", "cus_c", 4900, 9), // a refund that failed: nothing went back
  inv("in_clover", "cus_d", 14900, 10, { charge: undefined as unknown as null, payments: { object: "list", data: [{ id: "inpay_1", status: "paid", payment: { type: "payment_intent", payment_intent: "pi_d" } }] } }),
  inv("in_lost", "cus_e", 9900, 10), // a chargeback lost
  inv("in_won", "cus_f", 9900, 10), // a chargeback won: the money stayed
  inv("in_over", "cus_g", 5000, 11), // a refund and a lost chargeback past the amount: capped at it
  inv("in_twice", "cus_h", 9900, 11, { payment_intent: "pi_h" }), // one refund named by its charge and its PaymentIntent: once
  inv("in_other", "cus_zz", 9900, 12), // not an account the page counts
  inv("in_old", "cus_a", 9900, -5), // before the start day
  inv("in_lead", "cus_b", 2500, 12, { subscription: null }), // a lead bought on the card: not a subscription
];
store.refunds = [
  back("re_full", 9900, "succeeded", "ch_in_full"),
  back("re_part", 2000, "pending", "ch_in_part"),
  back("re_failed", 4900, "failed", "ch_in_kept"),
  back("re_clover", 14900, "succeeded", "ch_d", "pi_d"),
  back("re_over", 3000, "succeeded", "ch_in_over"),
  back("re_twice", 9900, "succeeded", "ch_in_twice", "pi_h"),
  back("re_lead", 2500, "succeeded", "ch_in_lead"),
  back("re_other", 9900, "succeeded", "ch_in_other"),
];
store.disputes = [
  back("dp_lost", 9900, "lost", "ch_in_lost"),
  back("dp_won", 9900, "won", "ch_in_won"),
  back("dp_over", 5000, "lost", "ch_in_over"),
];
writeMockStore(MOCK, store);

(async () => {
  const customers = new Set(["cus_a", "cus_b", "cus_c", "cus_d", "cus_e", "cus_f", "cus_g", "cus_h"]);
  const read = await readSubscriptionPayments(SINCE * 1000, customers, (ms) => new Date(ms).toISOString().slice(0, 10));
  check("Stripe read", read.ok, read.ok ? "" : read.error);
  if (!read.ok) process.exit(1);
  const of = (customer: string) => read.payments.filter((p) => p.customer === customer);
  const one = (customer: string) => of(customer)[0];
  check("the counted accounts' subscription invoices since the start day only — no lead, no other account, nothing older", read.payments.length === 8 && of("cus_a").length === 1 && of("cus_b").length === 1, read.payments.map((p) => p.customer));
  check("refunded in full: all of it went back", one("cus_a")?.cents === 9900 && one("cus_a")?.refundedCents === 9900, one("cus_a"));
  check("a partial refund on the way: that part went back", one("cus_b")?.refundedCents === 2000, one("cus_b"));
  check("a refund that failed: nothing went back", one("cus_c")?.refundedCents === 0, one("cus_c"));
  check("an invoice in the new shape, matched on its payment's PaymentIntent", one("cus_d")?.refundedCents === 14900, one("cus_d"));
  check("a chargeback lost went back; one won did not", one("cus_e")?.refundedCents === 9900 && one("cus_f")?.refundedCents === 0, [one("cus_e"), one("cus_f")]);
  check("a refund and a lost chargeback together: never more than was paid", one("cus_g")?.refundedCents === 5000, one("cus_g"));
  check("one refund named by both its charge and its PaymentIntent counts once", one("cus_h")?.refundedCents === 9900, one("cus_h"));
  check("the day each was paid", one("cus_a")?.date === "2026-10-09", one("cus_a")?.date);
  const calls = readMockStore(MOCK).calls;
  const asked = (m: string) => calls.find((c) => c.method === m)?.args[0] as { expand?: string[]; created?: { gte?: number } } | undefined;
  check("the invoices are asked with their payments", !!asked("invoices.list")?.expand?.includes("data.payments"), asked("invoices.list"));
  check("refunds and disputes are asked from the start day", asked("refunds.list")?.created?.gte === SINCE && asked("disputes.list")?.created?.gte === SINCE);
  fs.rmSync(MOCK, { force: true });
  console.log(bad === 0 ? "\nAll investor payment checks passed." : `\n${bad} investor payment check(s) FAILED.`);
  process.exit(bad === 0 ? 0 : 1);
})();
