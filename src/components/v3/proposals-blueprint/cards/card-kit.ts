// THE ALL-LIST CARD (2026-10-30): the All tab's proposal cards are drawn by a card renderer — the dossier
// (card-c.ts), which the owner picked from six candidates.
//
// A renderer is a function that returns the HTML for ONE proposal, as `<tr>` rows (the list is a
// `<tbody id="propTableBody">`, so everything sits in `<tr><td colspan="6">…</td></tr>` or in real cells).
// The page's behavior finds a proposal by `[data-id]` and acts on `[data-act]` buttons, so every row a
// renderer draws carries `data-id`, and the first one carries the class `prow` (the list counts, opens and
// staggers `.prow`). Chained proposals (same project) get `chain` — " prow--chain" / " prow--chain-end" —
// and `data-grp` on every row, exactly like the classic row.
//
// The kit hands over the page's own helpers (they close over its state), so the card prints the same
// figures, links and buttons as the classic card and every button keeps working.

import type { ProposalRow, Installment } from "../proposals-data";

export type CardKit = {
  esc: (v: string) => string;
  fmtMoney: (n: number) => string;
  /** The editor route for a proposal. */
  proposalHref: (id: string) => string;
  /** "Client · City", empty parts dropped. */
  subLine: (p: ProposalRow) => string;
  /** The kind square + one word ("Roof"). */
  kindHtml: (p: ProposalRow) => string;
  /** The client's deck design line, or "". */
  clientDesignHtml: (p: ProposalRow) => string;
  /** True the first time this stamp is drawn in this browser — add `pstatus--fresh` to bloom it. */
  bloomOnce: (id: string, kind: string, at: string | undefined) => boolean;
  /** Views count + last opened. */
  viewsCellHtml: (p: ProposalRow) => string;
  /** Paid amount + bar under the total, for signed work. */
  paidCellHtml: (p: ProposalRow) => string;
  /** "Paid $X ▬▬ due $Y" line; withTotal adds the contract. */
  payBarHtml: (p: ProposalRow, withTotal?: boolean) => string;
  /** The send button / sent stamp for the row (carries data-act="send"/"resend"). */
  sendCellHtml: (p: ProposalRow) => string;
  /** Mark paid / Send invoice / Remind for the next stage (data-act markpaid|paidfull|invoice|remind). */
  payActsHtml: (p: ProposalRow, next: Installment | null) => string;
  /** Wisetack line + Send financing link (data-act fin-send), or "". */
  finHtml: (p: ProposalRow) => string;
  instDollars: (p: ProposalRow, it: Installment) => number;
  /** The classic Payments row (`tr.prow-pay`), or "" when the proposal has nothing to collect. */
  payRowHtml: (p: ProposalRow, chain: string) => string;
  /** The classic action bar (`tr.prow-bar`) + the gap row after it. */
  barRowHtml: (p: ProposalRow, chain: string) => string;
  /** The whole classic card — a renderer can fall back to it. */
  classicHtml: (p: ProposalRow, chain: string) => string;
};

export type CardRenderer = (p: ProposalRow, chain: string, kit: CardKit) => string;
