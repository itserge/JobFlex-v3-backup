// Proposals blueprint — the row shape the page renders.
//
// There is NO fixture in this module any more. Every row the page draws is read
// from the database in src/app/dashboard/proposals/page.tsx and handed to
// `ProposalsContent`, which passes it to the behavior module (same
// write-once-useRef pattern as Workers). The donor's embedded demo array — 16
// invented proposals that used to render whenever `options.rows` was omitted —
// was deleted on 2026-08-13: a fallback that prints invented records is worse
// than an empty book, and the only caller always supplies real rows.
//
// Every field the row menu needs to reach a REAL implementation lives on the
// row: `id` is the proposal's cuid (the editor route and every server action
// key off it), `publicId` builds the portal link, `zillow` is the prebuilt
// search URL (null = the client has no address, which is what disables that
// menu item), `materials` is the line-item set the materials sheet shops, and
// `before` / `after` are the persisted completion photos.

import type { ProposalKind } from "@/lib/proposalKind";
import type { MaterialLine } from "@/components/proposal/MaterialsSheet";
import type { ProposalPhoto } from "@/components/v3/proposals-c/types";

export type Installment = {
  /** PaymentInstallment.id — what notifyPaymentReminder() keys its email off. */
  id: string;
  label: string;
  /** Short plate — "JUL 20" — or null for "no due date". */
  due: string | null;
  /** The raw column: dollars, or a PERCENT when `pct`. */
  amount: number;
  pct: boolean;
  /** What the RESOLVER says this stage is worth right now, to the cent
   *  (lib/paymentSchedule). The figure every write uses. */
  owed: number;
  /** Installment.status — UNPAID | PENDING | PAID | WAIVED. */
  status: string;
  /** Dollars that actually landed when PAID. */
  paidAmt: number | null;
  /** STRIPE | SQUARE | MANUAL for a PAID stage. */
  paidVia: string | null;
  /** When it was paid, as a plate ("OCT 08"), or null. */
  paidOn?: string | null;
  /** Past its due date and still open. */
  overdue?: boolean;
  /** When this stage's invoice last went out ("2d ago") and on which rail — card | bank | any — or null. */
  invoiced?: string | null;
  invoiceVia?: string | null;
  /** When the automatic reminders last wrote to the client about this stage, or null. */
  reminded?: string | null;
};

/** What a stage is worth right now: what landed if it is paid, else the
 *  resolver's figure — never a percent re-derived on the client, which rounded
 *  to whole dollars and made every prefill ask for the wrong cents. */
export function instDollars(p: { total: number }, it: Installment): number {
  if (it.status === "PAID" && it.paidAmt != null) return it.paidAmt;
  if (typeof it.owed === "number") return it.owed;
  return it.pct ? Math.round((p.total * it.amount)) / 100 : it.amount;
}

export type ProposalRow = {
  /** THE ROW, PART 4 (2026-11-10): the sales commission on this sold deal — its percent and what the rep has earned
   *  of the whole (earned as collected, before tax). The office and the rep themself; null when none. */
  sale?: { pct: number; earned: number; full: number } | null;
  /** "Call Nelly first · (425) 555-0101" — the crew calls the rep before starting; null when not set. */
  callFirst?: string | null;
  /** A sold job the office cancelled: when (plate) and why. Its status reads DECLINED. */
  canceled?: { at: string; reason: string | null } | null;
  /** Proposal.id — the cuid every server action and the editor route take. */
  id: string;
  /** Proposal.publicId — /portal/q/<publicId> is the client-facing page. */
  publicId: string;
  title: string;
  client: string;
  /** Proposal.clientId, or null. */
  clientId?: string | null;
  /** The project the proposal is filed under (2026-09-18), or null. */
  projectId?: string | null;
  projectName?: string | null;
  clientEmail: string | null;
  city: string;
  status: string;
  total: number;
  /** Ready-to-print relative label, e.g. "25m ago". */
  updated: string;
  views: number;
  /** When the client last opened it ("2h ago"), or null if never. */
  lastViewed?: string | null;
  /** When it was sent ("3d ago"), or null for a draft. */
  sentAgo?: string | null;
  owner: string;
  /** The member who made it, for the mark (lib/team/who): id, full name and
   *  their role on the org. Null when the owner is gone. `owner` above stays
   *  the donor's given-name plate for the code that still prints it. */
  ownerWho?: { id: string; name: string; role: string | null } | null;
  /** True when the signed-in member owns it — no owner mark is drawn then. */
  mine?: boolean;
  /** Count of shoppable material lines — the menu's "N items" hint. */
  mat: number;
  /** Prebuilt Zillow search URL, or null when the client has no address. */
  zillow: string | null;
  /** Prebuilt directions URL, or null when the client has no address. The
   *  handheld sheet's "Get directions" row; the desktop menu has no equivalent. */
  maps: string | null;
  accepted?: string;
  paid?: string;
  /** Dollars still owed on the schedule — 0 once settled. A COMPLETED job can
   *  carry a balance (completion is about the work), so the tear-sheet reads
   *  this rather than assuming "paid in full". */
  owed: number;
  /** Dollars paid to date on the schedule. */
  paidAmt?: number;
  /** The contract value: the proposal's total plus every approved change order. */
  contract?: number;
  /** Change orders on this proposal, by state — for the chips and the sheet button. */
  co?: { count: number; drafts: number; pending: number; approvedTotal: number; pendingTotal: number };
  /** Automatic payment reminders for this proposal: true / false, or null = the company's mode. */
  remindersOn?: boolean | null;
  /** The reader may bill — Mark paid, Send invoice and Remind are office actions, refused to a sales rep or an
   *  estimator — so the row offers them only when this is true. */
  canBill?: boolean;
  inst?: Installment[];
  materials: MaterialLine[];
  /** Proposal.beforePhotos / afterPhotos, already parsed. */
  before: ProposalPhoto[];
  after: ProposalPhoto[];
  /** A deck design link sent to the client for this proposal (2026-10-13, lib/deck/clientDesign): where it
   *  stands, in one line, and the studio draft to open when it came back. Null when none was sent. */
  clientDesign?: ClientDesignState | null;
  /** What happened lately, stamped (ISO): an acceptance or a decline in the last two weeks, a returned design
   *  nobody has opened. The row blooms once per stamp in a browser (proposals-behavior bloomOnce) — a stamp,
   *  not a "seen" flag, because the page refreshes itself after it clears its nav badge and a flag would be
   *  gone before the eye caught it. */
  fresh?: { accepted?: string; declined?: string; design?: boolean } | null;
  /** "accepted Sep 20" / "declined Sep 21" for the row's sub line. */
  decided?: string | null;
  /** What kind of job and which tool made it (2026-10-17, lib/proposalKind): "Deck · Deck Studio",
   *  "Kitchen remodel · Smart Proposal". The list marks every row and filters by `kind.family`. */
  kind?: ProposalKind;
  /** Wisetack financing (lib/financing): the client's loan in one line, and whether the office may send the link. */
  fin?: { line: string | null; canSend: boolean } | null;
};

export type ClientDesignState = {
  /** The client's first name, for the line. */
  name: string;
  standing: "waiting" | "opened" | "designing" | "returned" | "closed";
  /** "Jane sent back a design · 2 h ago". */
  line: string;
  /** The studio draft the design came back into, or null before it comes back. */
  draftId: string | null;
  /** Sent back and nobody has opened it. */
  unseen: boolean;
};

/** How far the client has paid, for the hue of the paid bar. */
export type PaidTier = "low" | "part" | "full";

/**
 * HOW FAR THE CLIENT HAS PAID (owner, 2026-09-26: the paid bar should show
 * whether the client paid little, is on track, or paid it all). "low" until
 * the payments cover the schedule's first stage — the deposit — "part" once
 * they do, "full" when nothing is owed. A schedule of one stage or none is
 * measured against 30%, the default deposit. Shared by the desk cards and
 * the handheld sheet so the two bars never disagree.
 */
export function paidTier(p: Pick<ProposalRow, "total" | "owed" | "paidAmt" | "contract" | "inst">): PaidTier {
  const contract = p.contract ?? p.total;
  if (contract > 0 && p.owed <= 0) return "full";
  const paid = p.paidAmt ?? 0;
  if (contract <= 0 || paid <= 0) return "low";
  const insts = p.inst ?? [];
  const firstStage = insts.length >= 2 ? instDollars(p, insts[0]) : contract * 0.3;
  // A cent of slack: a deposit settled to the cent is covered.
  return paid + 0.005 >= firstStage ? "part" : "low";
}

/* ── SEND AND PAY ON THE ROW (owner, 2026-10-23: "add a button in the main row — Send proposal, or it's been
   sent — and get the payment options visible at the main proposal row") ──────────────────────────────────
   Shared by the desk table and the handheld cards so the two never disagree about what a row offers. */

/** A sent proposal still waiting on the client can go again; a signed or declined one only says when it went.
 *  "send" — never sent and still open; "resend" — out and waiting; "sent" — settled, the stamp alone; "none" —
 *  settled without ever being sent (signed at the table): nothing to say. */
export type SendState = "send" | "resend" | "sent" | "none";
export function sendState(p: Pick<ProposalRow, "status" | "sentAgo">): SendState {
  if (p.status === "DRAFT") return "send";
  if (p.status === "SENT" || p.status === "VIEWED" || p.status === "EXPIRED") return p.sentAgo ? "resend" : "send";
  return p.sentAgo ? "sent" : "none";
}

/** What a send leaves the status at — the rule sendProposal writes: a draft, an expired or a declined proposal
 *  goes out again as SENT; one the client has opened stays VIEWED; a signed contract keeps its status. */
export function statusAfterSend(status: string): string {
  return status === "VIEWED" || status === "ACCEPTED" || status === "COMPLETED" || status === "PAID" ? status : "SENT";
}

/** "plan" — the schedule the client will pay by, before they accept; "collect" — signed and money still owed;
 *  "paid" — nothing owed; null — no line (declined, archived, or no schedule before acceptance). */
export type PayState = "plan" | "collect" | "paid" | null;
export function payState(p: Pick<ProposalRow, "status" | "total" | "owed" | "contract" | "inst">): PayState {
  const signed = p.status === "ACCEPTED" || p.status === "COMPLETED" || p.status === "PAID";
  if (signed) return (p.contract ?? p.total) > 0 && p.owed <= 0 ? "paid" : "collect";
  if (p.status === "DRAFT" || p.status === "SENT" || p.status === "VIEWED" || p.status === "EXPIRED") return p.inst?.length ? "plan" : null;
  return null;
}

/** The stage the next payment is for: the first one still open. */
export function nextStage(p: Pick<ProposalRow, "inst">): Installment | null {
  return (p.inst ?? []).find((i) => i.status === "UNPAID" || i.status === "PENDING") ?? null;
}

/** The facts under the next stage: when it is due, whether the invoice went, when the client was last
 *  reminded — what a contractor checks before chasing the money. */
export function stageFacts(it: Installment): string[] {
  const out: string[] = [];
  if (it.status === "PENDING") out.push("payment in progress");
  else if (it.overdue && it.due) out.push("overdue since " + it.due);
  else if (it.due) out.push("due " + it.due);
  if (it.invoiced) out.push("invoice sent " + it.invoiced + (it.invoiceVia === "card" ? " · card" : it.invoiceVia === "bank" ? " · bank" : ""));
  if (it.reminded) out.push("reminded " + it.reminded);
  return out;
}

/** Deep-enough clone so a mount's runtime edits never leak into the next one. */
export function cloneRows(rows: ProposalRow[]): ProposalRow[] {
  return rows.map((p) => ({
    ...p,
    inst: p.inst ? p.inst.map((i) => ({ ...i })) : undefined,
    materials: p.materials.map((m) => ({ ...m })),
    before: p.before.map((x) => ({ ...x })),
    after: p.after.map((x) => ({ ...x })),
  }));
}

export const PSTATUS: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: "Draft", cls: "" },
  SENT: { label: "Sent", cls: "pstatus--sent" },
  VIEWED: { label: "Viewed", cls: "pstatus--viewed" },
  ACCEPTED: { label: "Accepted", cls: "pstatus--accepted" },
  DECLINED: { label: "Declined", cls: "pstatus--declined" },
  EXPIRED: { label: "Expired", cls: "pstatus--expired" },
  // COMPLETED = the linked job finished (stamped by updateJob); PAID = money
  // collected. Both wear the green plate; the words carry the difference.
  COMPLETED: { label: "Completed", cls: "pstatus--paid" },
  PAID: { label: "Paid", cls: "pstatus--paid" },
  // Not a donor status, but a real one in the schema — a row carrying it must
  // still render a plate instead of crashing the row builder.
  ARCHIVED: { label: "Archived", cls: "" },
};

/** The plate a status renders as, with a safe fallback for unknown values. */
export function statusPlate(status: string): { label: string; cls: string } {
  return PSTATUS[status] ?? { label: status, cls: "" };
}

export const PAGE_ALL = 8;
export const PAGE_ACC = 3;
export const PAGE_DONE = 2;

/* ── PROJECT CHAINS (2026-09-18) ──────────────────────────────────────────
   Shared by the desktop Proposals page and its handheld build: proposals
   filed under the same project sit together, under the project's name and
   money, where the project's most recently touched proposal would have been. */
/** A project's proposals in view: who it is for and what it is worth. */
export type Chain = { id: string; name: string; client: string; count: number; contract: number; sold: number; open: number };
export function chainsOf(rows: ProposalRow[]): Map<string, Chain> {
  const m = new Map<string, Chain>();
  for (const p of rows) {
    if (!p.projectId) continue;
    const c = m.get(p.projectId) ?? { id: p.projectId, name: p.projectName ?? "Project", client: p.client, count: 0, contract: 0, sold: 0, open: 0 };
    c.count += 1;
    const value = p.contract ?? p.total;
    c.contract += value;
    if (p.status === "ACCEPTED" || p.status === "COMPLETED" || p.status === "PAID") c.sold += value;
    else if (p.status === "DRAFT" || p.status === "SENT" || p.status === "VIEWED") c.open += p.total;
    if (c.client !== p.client) c.client = "";
    m.set(p.projectId, c);
  }
  return m;
}
/** Each project's proposals together, the group where its newest member was. */
export function chained(rows: ProposalRow[]): ProposalRow[] {
  const chains = chainsOf(rows);
  const placed = new Set<string>();
  const out: ProposalRow[] = [];
  for (const p of rows) {
    const c = p.projectId ? chains.get(p.projectId) : undefined;
    if (!c || c.count < 2) {
      out.push(p);
      continue;
    }
    if (placed.has(c.id)) continue;
    placed.add(c.id);
    for (const q of rows) if (q.projectId === c.id) out.push(q);
  }
  return out;
}
