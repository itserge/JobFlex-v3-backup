// DISPUTE TEXTS — the words (owner, 2026-10-29: "send this SMS when a dispute from a user comes to Stripe — when they
// call their bank and try to get their money back through a dispute"). A company that pays JobFlex disputes a charge with
// its bank: the team hears it at once — who, how much, why, whether it is an inquiry or a real chargeback, and the date
// the evidence is due — and again when the dispute closes. Pure: lib/adminAlertsPayments sends them; the check reads them.

export type DisputeInfo = {
  id: string;
  orgName: string;
  plan: string | null;
  cents: number;
  currency: string;
  reason: string;
  /** Stripe's dispute status: warning_* = an inquiry (no money taken yet), else a chargeback. */
  status: string;
  /** evidence_details.due_by (unix seconds), or null. */
  dueBy: number | null;
  livemode: boolean;
  adminUrl: string;
};

const REASONS: Record<string, string> = {
  fraudulent: "says it wasn't them (fraud)",
  unrecognized: "doesn't recognize the charge",
  subscription_canceled: "says the plan was canceled",
  duplicate: "says they were charged twice",
  product_not_received: "says they didn't get the service",
  product_unacceptable: "says the service wasn't as described",
  credit_not_processed: "says a refund was promised",
  general: "no reason given",
  bank_cannot_process: "the bank could not process it",
  debit_not_authorized: "says the debit wasn't authorized",
  customer_initiated: "the customer started it",
  incorrect_account_details: "says the account details were wrong",
  insufficient_funds: "insufficient funds",
  check_returned: "the check was returned",
};

export function disputeReasonWords(reason: string): string {
  return REASONS[reason] ?? reason.replace(/_/g, " ");
}

export function stripeDisputeUrl(id: string, livemode: boolean): string {
  return `https://dashboard.stripe.com/${livemode ? "" : "test/"}disputes/${id}`;
}

function money(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
  } catch {
    return `$${(cents / 100).toFixed(2)}`;
  }
}

const day = (unix: number) => new Date(unix * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Los_Angeles" });
const isInquiry = (status: string) => status.startsWith("warning_");
const mode = (live: boolean) => (live ? "" : " [TEST MODE]");
const CLOSED = new Set(["won", "lost", "warning_closed", "prevented"]);

/** The once-key of the "opened" text: one per stage. An inquiry that escalates stays the same dispute (Stripe sends
 *  charge.dispute.funds_withdrawn, not a second created), so its chargeback is a new stage and a new text; an ordinary
 *  chargeback sends both created and funds_withdrawn and texts once. Null once it's closed — that text is the other one. */
export function disputeOpenedKey(id: string, status: string): string | null {
  if (CLOSED.has(status)) return null;
  return `dispute:${isInquiry(status) ? "inquiry" : "chargeback"}:${id}`;
}

/** charge.dispute.created */
export function disputeOpenedText(d: DisputeInfo): string {
  const amount = money(d.cents, d.currency);
  const plan = d.plan ? ` (${d.plan})` : "";
  const why = disputeReasonWords(d.reason);
  const due = d.dueBy ? ` by ${day(d.dueBy)}` : "";
  const head = isInquiry(d.status)
    ? `JobFlex: dispute INQUIRY (not a chargeback yet) — ${d.orgName} asked their bank about ${amount}${plan}: ${why}. Answer in Stripe${due} so it doesn't become a chargeback.`
    : `JobFlex: CHARGEBACK — ${d.orgName} disputed ${amount}${plan} with their bank: ${why}. Stripe took it from our balance; answer with evidence${due} to win it back.`;
  return `${head}${mode(d.livemode)} ${stripeDisputeUrl(d.id, d.livemode)} ${d.adminUrl}`;
}

/** charge.dispute.closed — won, lost, or an inquiry closed. */
export function disputeClosedText(d: DisputeInfo & { feeCents: number }): string {
  const amount = money(d.cents, d.currency);
  const fee = d.feeCents > 0 ? `; Stripe keeps its ${money(d.feeCents, d.currency)} dispute fee` : "";
  const body =
    d.status === "won"
      ? `JobFlex: dispute WON — ${d.orgName}'s ${amount} chargeback; Stripe returns the money.`
      : d.status === "lost"
        ? `JobFlex: dispute LOST — ${d.orgName}'s ${amount} won't come back${fee}.`
        : d.status === "warning_closed"
          ? `JobFlex: dispute inquiry closed — ${d.orgName}, ${amount}; no chargeback.`
          : `JobFlex: dispute closed (${d.status.replace(/_/g, " ")}) — ${d.orgName}, ${amount}.`;
  return `${body}${mode(d.livemode)} ${stripeDisputeUrl(d.id, d.livemode)}`;
}
