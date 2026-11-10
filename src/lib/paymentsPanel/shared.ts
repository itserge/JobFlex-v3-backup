// THE PAYMENTS PANEL'S RULES (2026-11-09, the ProSmart gaps plan, part 3) — pure, shared by the panel's server read
// (lib/paymentsPanel/server), the sheet and the checks (qa/tests/logic/payments-panel.check.ts).
//
// ProSmart's Payments drawer, adopted: one place per sold proposal for what was paid and what is left — mark paid,
// invoice, remind, a receipt per payment (preview, send, resend), undo a payment entered by mistake, add or remove a
// stage, the reminders that went out and the next one, and the "order placed" notice.

const DAY = 86_400_000;

/** The automatic ladder's days after the due date (lib/payments/reminders REMINDER_DAYS — the check holds them equal). */
export const LADDER_DAYS = [1, 3, 7] as const;

/** Whole days a stage is late: due before today and still open. 0 when it isn't late. */
export function daysLate(due: Date | null, status: string, todayStart: Date): number {
  if (!due || (status !== "UNPAID" && status !== "PENDING")) return 0;
  const d = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  if (d.getTime() >= todayStart.getTime()) return 0;
  return Math.max(1, Math.round((todayStart.getTime() - d.getTime()) / DAY));
}

export function lateWords(days: number): string | null {
  if (days <= 0) return null;
  return days === 1 ? "1 day late" : `${days} days late`;
}

/** The chip a card shows: "1 late" / "2 late · $4,300". */
export function lateChip(stages: ReadonlyArray<{ late: number; amount: number }>): string | null {
  const late = stages.filter((s) => s.late > 0);
  if (!late.length) return null;
  return `${late.length} late`;
}

export type NextReminder = { at: Date; round: number } | { stopped: string };

/**
 * When the next automatic reminder goes for the stage being chased. The ladder runs only when the company is on
 * automatic reminders and the proposal isn't switched off; it sends at most three, never two in a day.
 */
export function nextReminder(input: {
  mode: "auto" | "manual" | "off";
  proposalOn: boolean | null;
  anchor: Date | null;
  reminderCount: number;
  remindedAt: Date | null;
  owed: boolean;
}): NextReminder {
  if (!input.owed) return { stopped: "Nothing is owed — no reminders." };
  if (input.proposalOn === false) return { stopped: "Reminders are off for this proposal." };
  if (input.mode !== "auto") return { stopped: input.mode === "off" ? "Reminders are off (Settings → Payments)." : "Reminders go out when you press Remind (Settings → Payments: by hand)." };
  if (input.reminderCount >= LADDER_DAYS.length) return { stopped: `All ${LADDER_DAYS.length} reminders have gone out — call the client.` };
  if (!input.anchor) return { stopped: "No due date yet — the first reminder waits for one." };
  let at = input.anchor.getTime() + LADDER_DAYS[input.reminderCount] * DAY;
  if (input.remindedAt) at = Math.max(at, input.remindedAt.getTime() + DAY);
  return { at: new Date(at), round: input.reminderCount + 1 };
}

/** Do the stages add up to the contract? (lib/paymentSchedule mismatchMinor: >0 over, <0 short, in cents.) */
export function coverageWords(mismatchMinor: number, fmt: (dollars: number) => string): { tone: "ok" | "warn"; words: string } {
  if (mismatchMinor === 0) return { tone: "ok", words: "The payments add up to the contract." };
  const d = fmt(Math.abs(mismatchMinor) / 100);
  return mismatchMinor > 0
    ? { tone: "warn", words: `The payments add up to ${d} more than the contract — the last ones are capped at what's left.` }
    : { tone: "warn", words: `${d} isn't in any payment — it shows as Balance.` };
}

/** What the office may do to one stage. A settled, closed, open-checkout or change-order stage can't be removed. */
export function stageRights(s: { status: string; changeOrder: boolean; synthetic: boolean; manualPayment: boolean }): { remove: boolean; editDue: boolean; undo: boolean } {
  const open = s.status === "UNPAID";
  return {
    remove: open && !s.changeOrder && !s.synthetic,
    editDue: (open || s.status === "PENDING") && !s.synthetic,
    undo: s.status === "PAID" && s.manualPayment,
  };
}

/** A new stage's amount: dollars, or a percent of the contract (1–100). */
export function cleanStageAmount(amount: number, isPercent: boolean): number | null {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (isPercent) return amount > 100 ? null : Math.round(amount * 100) / 100;
  return Math.round(amount * 100) / 100;
}

/** How money came in, in the office's words. */
export function paidHow(provider: string, method: string | null): string {
  if (provider === "STRIPE") return method === "us_bank_account" ? "Bank debit (Stripe)" : "Card (Stripe)";
  if (provider === "SQUARE") return "Card (Square)";
  if (provider === "STAX") return method === "us_bank_account" ? "Bank (Stax)" : "Card (Stax)";
  if (provider === "WISETACK") return "Wisetack financing";
  if (method === "BANK_TRANSFER") return "Bank transfer";
  if (method === "CASH") return "Cash";
  if (method === "CHECK") return "Check";
  return "Recorded by hand";
}
