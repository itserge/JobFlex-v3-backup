// SUPPORT WIDGET · THE COMPOSER'S PURE HALF (2026-10-30) — no React, no server: support-widget.tsx draws it and
// qa/tests/logic/support-composer.check.ts runs it. The categories the composer offers, its message limit, and
// SmartHelp's hand-off ("Ask a person"): what an opening starts from, the mark it keeps for the send, and the ticket
// the send files (actions/support submitSupportTicket) — the support AI only drafts for a ticket with the mark.

/** The model's own taxonomy — `SupportTicket.category`, the same five values
 *  the /dashboard/support form writes and the admin triage filters on. Four of
 *  them, in the words the owner used: a bug, a billing problem, an account
 *  problem, a question. Nothing new is invented here; "feature" is the one
 *  value left out, because an idea is not a call for help. */
export const CATEGORIES = [
  { value: "technical", label: "Bug" },
  { value: "billing", label: "Billing" },
  { value: "account", label: "Account" },
  { value: "general", label: "Question" },
] as const;

export type ComposerCategory = (typeof CATEGORIES)[number]["value"];

/** `SupportTicket.body` is capped at 5000 by the action's validator. */
export const BODY_MAX = 5000;

/** The action's validator caps `smartHelpLogId` at 80: a longer one is no id of SmartHelp's (theirs run to about 41),
 *  and sending it would refuse the whole ticket. */
const LOG_ID_MAX = 80;

/** SmartHelp's "Ask a person": the words and category the composer starts from, and the mark that files the ticket as
 *  SmartHelp's hand-off (`origin`, with the SmartHelp question's `logId`) — the support AI then only drafts for it,
 *  and a person sends. */
export type SupportPrefill = {
  message: string;
  category?: "technical" | "billing" | "account" | "general";
  origin?: "smarthelp";
  logId?: string;
};

/** The mark an opening keeps for the send: SmartHelp's, with its question's id — or null. */
export type HandoffMark = { origin: "smarthelp"; logId?: string } | null;

/** What one opening of the composer does. `mark`: SmartHelp's, or null — so an opening without it clears a mark an
 *  earlier hand-off left. `start`: from a prefill, the message (clipped to BODY_MAX) and the category to begin with —
 *  the default chip when it names none, never the one picked before; no prefill, null: both stay as they were. */
export function composerOpening(prefill: SupportPrefill | null | undefined): {
  mark: HandoffMark;
  start: { message: string; category: ComposerCategory } | null;
} {
  if (!prefill) return { mark: null, start: null };
  return {
    mark: prefill.origin === "smarthelp" ? { origin: "smarthelp", ...(prefill.logId ? { logId: prefill.logId } : {}) } : null,
    start: { message: prefill.message.slice(0, BODY_MAX), category: prefill.category ?? CATEGORIES[0].value },
  };
}

/** The ticket the send files: its words and category — exactly those without a mark — plus SmartHelp's mark when the
 *  opening kept one. A logId too long for the action's validator is left out, so the ticket still files. */
export function composerTicket(
  body: string,
  category: string,
  mark: HandoffMark,
): { body: string; category: string; origin?: "smarthelp"; smartHelpLogId?: string } {
  if (!mark) return { body, category };
  return { body, category, origin: mark.origin, ...(mark.logId && mark.logId.length <= LOG_ID_MAX ? { smartHelpLogId: mark.logId } : {}) };
}
