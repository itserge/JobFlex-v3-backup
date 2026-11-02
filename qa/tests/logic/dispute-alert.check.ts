// Dispute texts (owner, 2026-10-29: "send this SMS when a dispute from a user comes to Stripe — when they call their
// bank and try to get their money back through a dispute"). The words of the two texts — opened and closed — as the
// team reads them; lib/adminAlertsPayments sends them through the team's alert texts ("Disputes").
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/dispute-alert.check.ts
import { disputeClosedText, disputeOpenedKey, disputeOpenedText, disputeReasonWords, stripeDisputeUrl } from "../../../src/lib/disputeWords";
import { ALERT_KEYS, ALERT_WORDS } from "../../../src/lib/adminTasks/teamShared";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && extra ? `\n     ${extra}` : ""}`);
};

const base = { id: "dp_1QabcXYZ", orgName: "Summit Ridge Roofing", plan: "Professional", cents: 9500, currency: "usd", reason: "unrecognized", status: "needs_response", dueBy: Date.UTC(2026, 10, 8, 23, 59) / 1000, livemode: true, adminUrl: "https://www.jobflex.app/admin/subscribers" };

const t1 = disputeOpenedText(base);
check("opened: who, how much, the plan, the bank's reason in plain words", t1.includes("Summit Ridge Roofing") && t1.includes("$95.00") && t1.includes("Professional") && t1.includes("doesn't recognize the charge"), t1);
check("opened: a chargeback says so — the money is already out of the balance — with the deadline to answer", /CHARGEBACK/.test(t1) && /took it/.test(t1) && t1.includes("Nov 8"), t1);
check("opened: the dispute's own Stripe page and the admin page", t1.includes("https://dashboard.stripe.com/disputes/dp_1QabcXYZ") && t1.includes("/admin/subscribers"), t1);
check("opened: one text, under two SMS segments of plain words", t1.length <= 320, String(t1.length));
const inquiry = disputeOpenedText({ ...base, status: "warning_needs_response" });
check("an inquiry says it is not a chargeback yet", /INQUIRY/.test(inquiry) && /not a chargeback yet/i.test(inquiry), inquiry);
const test = disputeOpenedText({ ...base, livemode: false });
check("test mode: says so, and links Stripe's test page", test.includes("[TEST MODE]") && test.includes("https://dashboard.stripe.com/test/disputes/dp_1QabcXYZ"), test);
const noPlan = disputeOpenedText({ ...base, plan: null, dueBy: null });
check("no plan, no deadline → still a whole sentence", !noPlan.includes("null") && !noPlan.includes("undefined") && noPlan.includes("$95.00"), noPlan);

check("reasons in plain words", disputeReasonWords("fraudulent") === "says it wasn't them (fraud)" && disputeReasonWords("subscription_canceled") === "says the plan was canceled" && disputeReasonWords("duplicate") === "says they were charged twice" && disputeReasonWords("something_new") === "something new");

const won = disputeClosedText({ ...base, status: "won", feeCents: 0 });
const lost = disputeClosedText({ ...base, status: "lost", feeCents: 1500 });
const closedInquiry = disputeClosedText({ ...base, status: "warning_closed", feeCents: 0 });
check("closed: won — Stripe returns the money", /WON/.test(won) && won.includes("$95.00") && /returns/.test(won), won);
check("closed: lost — the money and Stripe's fee are gone", /LOST/.test(lost) && lost.includes("$95.00") && /won't come back/.test(lost) && lost.includes("$15.00"), lost);
check("closed: an inquiry closed without a chargeback", /no chargeback/i.test(closedInquiry), closedInquiry);
// An inquiry that escalates stays the same dispute: Stripe sends charge.dispute.funds_withdrawn, not a second
// created. One text per stage — an ordinary chargeback (created + funds_withdrawn) texts once; a closed one, never.
check("once per stage: an inquiry, then the chargeback it became", disputeOpenedKey("dp_1", "warning_needs_response") === "dispute:inquiry:dp_1" && disputeOpenedKey("dp_1", "warning_under_review") === "dispute:inquiry:dp_1" && disputeOpenedKey("dp_1", "needs_response") === "dispute:chargeback:dp_1" && disputeOpenedKey("dp_1", "under_review") === "dispute:chargeback:dp_1");
check("a closed dispute is not 'opened' again", ["won", "lost", "warning_closed", "prevented"].every((s) => disputeOpenedKey("dp_1", s) === null));

check("stripe links by mode",stripeDisputeUrl("dp_x", true) === "https://dashboard.stripe.com/disputes/dp_x" && stripeDisputeUrl("dp_x", false) === "https://dashboard.stripe.com/test/disputes/dp_x");

check("the team can tick 'Disputes'", (ALERT_KEYS as readonly string[]).includes("dispute") && ALERT_WORDS.dispute.label === "Disputes");

console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);
