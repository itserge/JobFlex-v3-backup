// WISETACK FINANCING — every word a contractor or a client reads about it, in one place. Wisetack allows only its
// own financing language (marketing toolkit: "Don't use your own marketing language unless it's been explicitly
// approved by Wisetack"), and a rate, an APR or a monthly figure is a lending term only Wisetack states — none here.
// Wisetack's review of these words is part of going live (spec, Rollout 3).
//
// Pure: both portal trees, the editor, Settings and the checks import it.

import { coverMinor, fundedMinor, type Loan, type LockReason, type MerchantState, type ReadinessItem } from "./state";

type Money = (minor: number) => string;

export const FIN = {
  button: "Pay over time",
  buttonSub: "Check your rate — it won't affect your credit score.",
  /** Wisetack's own disclosure (wisetack.com), word for word. */
  disclosure: "All financing is subject to credit approval. Your terms may vary. Payment options through Wisetack are provided by our lending partners.",
  prequalLine: "Monthly payments are available.",
  prequalButton: "See what you qualify for",
  continueButton: "Continue on Wisetack",
  restLabel: (money: string) => `The rest: ${money}`,
  coveredLine: (money: string) => `Paying ${money} with monthly payments through Wisetack`,
  deskQ: "Do you offer financing?",
  deskA: "Yes — monthly payments through Wisetack, subject to credit approval. The team can send you a link to check your rate.",
  applyButton: "Apply with Wisetack",
  linkButton: "I already use Wisetack",
  readinessTitle: "What lenders usually look at",
  readinessSub: "A guide, not a promise — Wisetack decides.",
  defaultSwitch: "Offer monthly payments on every new proposal",
  proposalSwitch: "Offer monthly payments",
  proposalPreview: "Clients see: Pay over time — check your rate",
  sendLink: "Send financing link",
} as const;

export function merchantWords(s: MerchantState): { title: string; sub: string; tone: "ok" | "wait" | "warn" | "off" } {
  switch (s) {
    case "none":
      return { title: "Offer monthly payments", sub: "Let clients pay over time through Wisetack. You're paid in full when the job is done.", tone: "off" };
    case "started":
      return { title: "Application started", sub: "Finish your application on Wisetack — it takes a few minutes.", tone: "wait" };
    case "review":
      return { title: "Wisetack is reviewing your application", sub: "Usually 1–3 business days. JobFlex texts you when they decide.", tone: "wait" };
    case "needs_info":
      return { title: "Wisetack needs a little more", sub: "Finish the items below on Wisetack to keep going.", tone: "warn" };
    case "approved":
      return { title: "Approved — you can offer monthly payments", sub: "Turn it on for any proposal. Clients apply on their phone in about a minute.", tone: "ok" };
    case "declined":
      return { title: "Wisetack didn't approve this application", sub: "Wisetack's email says why and when you can apply again.", tone: "warn" };
    case "paused":
      return { title: "Financing is paused", sub: "Wisetack paused your account. Wisetack support can turn it back on.", tone: "warn" };
  }
}

export function lockWords(why: LockReason, limits: { minMinor: number | null; maxMinor: number | null }, money: Money): string {
  switch (why) {
    case "not_open":
      return "Financing isn't open for your account yet.";
    case "not_set_up":
      return "Set up financing first: Settings → Integrations / Payments → Financing.";
    case "waiting":
      return "Waiting for Wisetack to approve your account.";
    case "declined":
      return "Wisetack didn't approve your account.";
    case "paused":
      return "Financing is paused on your Wisetack account.";
    case "off":
      return "Off for this proposal.";
    case "under_min":
      return limits.minMinor !== null ? `Monthly payments start at ${money(limits.minMinor)}.` : "This job is too small for monthly payments.";
    case "over_max":
      return limits.maxMinor !== null ? `Monthly payments go up to ${money(limits.maxMinor)}.` : "This job is too large for monthly payments.";
    case "paid":
      return "This proposal is paid.";
    case "nothing_owed":
      return "Nothing is owed on this proposal.";
    case "plan_ended":
      return "Your JobFlex plan has ended.";
  }
}

/** The proposals row and the editor: where the client's loan stands. */
export function loanLine(l: Loan, money: Money): string {
  const funded = fundedMinor(l);
  const cover = coverMinor(l);
  if (l.state !== "paid" && funded > 0 && cover > 0) return `Paid ${money(funded)} of ${money(cover)}`;
  switch (l.state) {
    case "sent":
      return "Client opened financing";
    case "started":
      return "Client is applying";
    case "needs_action":
      return "Client's application needs a step";
    case "approved":
      return `Client approved for ${money(cover)}`;
    case "accepted":
      return `Loan accepted · ${money(cover)}`;
    case "done_asked":
      return "Asked the client to confirm the job is done";
    case "paid":
      return `Paid ${money(funded || cover)} through Wisetack`;
    case "declined":
      return "Client wasn't approved";
    case "expired":
      return "Approval expired";
    case "canceled":
      return "Financing canceled";
    case "refunded":
      return "Financing refunded";
  }
}

/** The client's page after Wisetack. */
export function clientLoanWords(l: Loan, money: Money): { title: string; sub: string } {
  const cover = coverMinor(l);
  switch (l.state) {
    case "sent":
    case "started":
    case "needs_action":
      return { title: "Your application is open", sub: "Finish it on Wisetack — it only takes a minute." };
    case "approved":
      return { title: `You're approved for ${money(cover)}`, sub: "Accept your loan terms on Wisetack to lock in monthly payments." };
    case "accepted":
    case "done_asked":
      return { title: "Monthly payments are set", sub: `Your loan covers ${money(cover)}. Wisetack asks you to confirm when the work is done.` };
    case "paid":
      return { title: "Paid through Wisetack", sub: "Thank you — your monthly payments are with Wisetack." };
    case "declined":
      return { title: "Not approved this time", sub: "You can still pay another way below." };
    case "expired":
      return { title: "Your approval expired", sub: "You can apply again." };
    case "canceled":
      return { title: "Financing was canceled", sub: "You can apply again or pay another way." };
    case "refunded":
      return { title: "Financing refunded", sub: "Your contractor can answer any questions." };
  }
}

export function readinessLabel(key: ReadinessItem["key"]): string {
  switch (key) {
    case "name":
      return "Business name";
    case "phone":
      return "Business phone";
    case "email":
      return "Business email";
    case "address":
      return "Business address";
    case "website":
      return "Website";
    case "trade":
      return "Your trade";
    case "year":
      return "Year your business started";
  }
}

/** Settings only (the contractor's own cost, not a client's term). */
export function feeLine(bps: number): string {
  return `Wisetack's fee: ${(bps / 100).toFixed(1)}% of each financed job`;
}

export function limitsLine(minMinor: number | null, maxMinor: number | null, money: Money): string | null {
  if (minMinor === null || maxMinor === null) return null;
  return `Jobs from ${money(minMinor)} to ${money(maxMinor)}`;
}
