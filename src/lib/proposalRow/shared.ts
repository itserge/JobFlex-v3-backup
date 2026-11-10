// THE PROPOSAL ROW AND SALES COMMISSION (2026-11-10, the ProSmart gaps plan, part 4) — pure, shared by the proposal
// book (the card's chips), the "More" sheet, the Workers page and the checks (qa/tests/logic/proposal-row.check.ts).
//
// The owner's call: a sales rep's commission is EARNED WHEN COLLECTED — their percent of what the client has paid,
// before sales tax (the tax is the state's). A deal keeps the percent it was sold at: changing a rep's percent stamps
// the old one onto their sold deals first (Proposal.commissionPct), so only new work moves.

export const SOLD_STATUSES = ["ACCEPTED", "COMPLETED", "PAID"] as const;
export const isSold = (status: string) => (SOLD_STATUSES as readonly string[]).includes(status);

/** The percent a deal pays: its own frozen one, else the owner's. Null = no commission. */
export function effectivePct(dealPct: number | null | undefined, repPct: number | null | undefined): number | null {
  const v = dealPct ?? repPct ?? null;
  return v != null && Number.isFinite(v) && v > 0 ? v : null;
}

/** A percent the office typed: 0 or blank clears it; 0–100, two decimals. Throws words for anything else. */
export function cleanPct(v: number | null | undefined): number | null {
  if (v == null || v === 0) return null;
  if (!Number.isFinite(v) || v < 0 || v > 100) throw new Error("A commission is a percent from 0 to 100.");
  return Math.round(v * 100) / 100;
}

const cents = (n: number) => Math.round(n * 100) / 100;

/**
 * What the rep has earned on one deal: the percent of what was collected, before tax. `revenue` is the contract
 * before tax (lib/contractTotal contractRevenue); the collected money is scaled by revenue ÷ contract so a deal with
 * 10% tax pays commission on the 100, not the 110.
 */
export function commissionOf(input: { pct: number | null; collected: number; contract: number; revenue: number }): { earned: number; full: number } {
  const pct = input.pct ?? 0;
  if (pct <= 0 || input.contract <= 0) return { earned: 0, full: 0 };
  const share = Math.min(1, Math.max(0, input.revenue / input.contract));
  const collected = Math.min(input.contract, Math.max(0, input.collected));
  return { earned: cents((collected * share * pct) / 100), full: cents((input.revenue * pct) / 100) };
}

/** "8% · $77 earned of $256" — the chip's words. */
export function commissionWords(pct: number | null, c: { earned: number; full: number }, fmt: (n: number) => string): string | null {
  if (!pct) return null;
  return `${pct}% · ${fmt(c.earned)} earned of ${fmt(c.full)}`;
}

/** What cancelling a sold job will do, said before the office presses it. */
export function cancelWarnings(input: { collected: number; openInvoices: number; installDays: number; fmt: (n: number) => string }): string[] {
  const out: string[] = ["It leaves sold work and money to collect; the open payments are closed."];
  if (input.openInvoices) out.push(`${input.openInvoices} invoice${input.openInvoices === 1 ? " is" : "s are"} out with the client — ${input.openInvoices === 1 ? "it is" : "they are"} voided so nobody can pay ${input.openInvoices === 1 ? "it" : "them"}.`);
  if (input.installDays) out.push(`${input.installDays} install day${input.installDays === 1 ? " is" : "s are"} on the calendar — the job is cancelled and the crew gets a text.`);
  if (input.collected > 0) out.push(`${input.fmt(input.collected)} was already collected — refund it in Payments (or where it was paid) if it goes back.`);
  return out;
}

/** The reasons offered, plus the office's own words. */
export const CANCEL_REASONS = ["Client changed their mind", "Financing fell through", "Went with another company", "Price", "Couldn't get a permit", "Duplicate"] as const;

export function cleanReason(v: string | null | undefined): string | null {
  const t = (v ?? "").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, 300) : null;
}

/** "Call Nelly first" — the crew's line, with the rep's phone when there is one. */
export function callFirstWords(rep: { name: string | null; phone: string | null } | null): string | null {
  if (!rep?.name) return null;
  const first = rep.name.split(" ")[0];
  return rep.phone ? `Call ${first} first · ${rep.phone}` : `Call ${first} first`;
}
