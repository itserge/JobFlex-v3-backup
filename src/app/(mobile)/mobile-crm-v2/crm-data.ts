// Mobile CRM (mobile-crm-v2) — shapes + pure presentation helpers.
//
// NOTHING here is data. The rows this page renders are read from the database
// in `crm-snapshot.ts` (`getCrmSnapshot()`), which runs the SAME org-scoped
// Prisma queries the desktop CRM sheet runs — see
// `src/app/dashboard/crm/page.tsx`. The former donor fixture (15 leads, 13
// customers, 4 rules, 8 follow-ups) has been deleted; this module now holds
// only types, enum option lists, class maps, page sizes and formatters.
//
// Mutations go through the existing server actions:
//   rules   src/actions/followUps.ts — upsert / setEnabled / delete
//   queue   src/actions/followUps.ts — runFollowUpNow / markFollowUpDone
//   leads   src/actions/leads.ts     — claimLead / deleteLead

import type { FollowUpChannel } from "@/lib/followUps/copy";
import type { FollowUpMode, FollowUpWords } from "@/lib/followUps/agent";
import type { WhoLike } from "@/lib/team/who";

/** A pipeline lead. `id` is the real Lead row id — every action needs it. */
export type CrmLead = {
  id: string;
  name: string;
  project: string;
  status: string;
  assignee: string | null;
  age: string;
};

export type ActivityItem = { id: string; summary: string; age: string; who: WhoLike | null };

export type Customer = {
  id: string;
  name: string;
  email: string;
  quotes: number;
  quoted: number;
  ltv: number;
  last: string;
  top: string;
};

export type Trigger = { value: string; label: string };

/** A rule has no template any more: the wording is derived from its trigger in
 *  src/lib/followUps/copy.ts — the same module the preview card renders and
 *  `dispatchOne()` sends. The one per-rule choice left is the channel. */
export type FollowUpRule = {
  id: string;
  name: string;
  triggerStatus: string;
  delayMinutes: number;
  enabled: boolean;
  channel: FollowUpChannel;
  /** A starter rule (lib/followUps/defaults): deleting it turns it off, and
   *  the row stays, reading "Turned off". */
  isDefault?: boolean;
  /** Who sends it — on its own, after a yes, or a person (lib/followUps/agent). */
  mode?: FollowUpMode;
  /** The standard words, or written for each client. */
  words?: FollowUpWords;
};

/** The sender the preview renders as — the org's own lockup and footer. */
export type PreviewOrg = { name: string; phone: string | null; logoUrl: string | null };

export type QueueItem = {
  id: string;
  /** The proposal the follow-up hangs off, when there is one — the sheet's
   *  "Open proposal" row navigates by it. */
  proposalId: string | null;
  client: string;
  title: string | null;
  date: string;
  rel: string;
  overdue: boolean;
  days: number;
  /** When it goes (epoch ms) — the Workflows status line's "next send". */
  runAt: number;
  /** Handed to a person: its draft (or reminder) is on the Today tab. */
  waiting?: boolean;
  /** Why the agent is holding it, in words. */
  reason?: string | null;
};

export type CrmStats = {
  won: number;
  lost: number;
  active: number;
  conversations: number;
};

/** The whole live payload, exactly what `getCrmSnapshot()` returns. */
export type CrmSnapshot = {
  stats: CrmStats;
  /** The five newest NEW / ROUTED / CLAIMED leads — the Overview's list. */
  leads: CrmLead[];
  activity: ActivityItem[];
  customers: Customer[];
  rules: FollowUpRule[];
  queue: QueueItem[];
  org: PreviewOrg;
  /** A configured Twilio number. Without one the TEXT channel is offered
   *  disabled, with the same note the client message dialog shows. */
  smsEnabled: boolean;
  /** The server's clock when the snapshot was read — "next send in 5 h". */
  renderedAt: number;
};

export const STATUS_ORDER = ['PAID', 'ACCEPTED', 'VIEWED', 'SENT', 'DRAFT', 'DECLINED', 'EXPIRED', 'ARCHIVED'];

/** Status → badge class in mobile-crm.module.css. Three tones each: base
 *  border, soft fill, base text. Draft/Archived stay neutral, as on the
 *  desktop. Looked up as `styles[STATUS_CLS[top]]`. */
export const STATUS_CLS: Record<string, string> = {
  PAID: 'pstatusPaid', ACCEPTED: 'pstatusAccepted', VIEWED: 'pstatusViewed',
  SENT: 'pstatusSent', DRAFT: '', DECLINED: 'pstatusDeclined',
  EXPIRED: 'pstatusExpired', ARCHIVED: ''
};

/** Lead stage → badge class. The desktop painted all three fresh stages with
 *  the same sky badge; here they take the three distinct tones its own
 *  STATUS_DOT map already assigns them, so a five-row list is scannable
 *  without reading the words. */
export const LEAD_CLS: Record<string, string> = {
  NEW: 'pstatusSent', ROUTED: 'pstatusViewed', CLAIMED: 'pstatusAccepted'
};

/** The proposal statuses a follow-up rule can fire on. Matches TRIGGER_OPTIONS
 *  in the classic editor (src/components/crm/FollowUpRulesEditor.tsx). */
export const TRIGGERS: Trigger[] = [
  { value: 'SENT', label: 'Proposal sent' }, { value: 'VIEWED', label: 'Proposal viewed' },
  { value: 'ACCEPTED', label: 'Proposal accepted' }, { value: 'PAID', label: 'Proposal paid' },
  { value: 'DECLINED', label: 'Proposal declined' }
];

/** Lead stages that belong in the Overview's "Fresh leads" list. */
export const FRESH_STATUSES = ['NEW', 'ROUTED', 'CLAIMED'];

/** Lead stages that still count as in-play (the Active-leads figure). */
export const ACTIVE_STATUSES = ['NEW', 'ROUTED', 'CLAIMED', 'CONTACTED', 'QUOTED'];

/**
 * The desktop's four panels, one strip. Labels are short on purpose: four
 * columns of a 320px screen leave ~72px each, and "Customer book" /
 * "Workflows" / "Follow-up queue" cannot survive that at 13px. "Due" also
 * carries the desktop's one tab count (overdue follow-ups), which is why it is
 * the shortest of the four.
 */
export const TABS = [
  { key: 'today', label: 'Today' },
  { key: 'office', label: 'Office' },
  { key: 'back', label: 'Win back' },
  { key: 'overview', label: 'Overview' },
  { key: 'book', label: 'Book' },
  { key: 'rules', label: 'Rules' },
  { key: 'queue', label: 'Due' },
] as const;

export type TabKey = (typeof TABS)[number]['key'];

/** The desktop queue's own All / Due now / Scheduled sub-tabs. Nesting a
 *  second strip inside the first is unreadable on a phone, so they become the
 *  Due tab's filter dropdown — three options, exactly one grid row. */
export const QUEUE_FILTERS = [
  { key: 'ALL', label: 'All' },
  { key: 'DUE', label: 'Due now' },
  { key: 'SCHEDULED', label: 'Scheduled' },
] as const;

export type QueueFilterKey = (typeof QUEUE_FILTERS)[number]['key'];

/** Page sizes drop against the desktop (13-row book unpaged, Q_PAGE 20): a
 *  handheld record card is three lines tall. Both pagers become reachable. */
export const PAGE_BOOK = 8;
export const PAGE_QUEUE = 6;

export const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

export function titleCase(s: string) {
  return s.charAt(0) + s.slice(1).toLowerCase();
}

/** Donor formula, unchanged: minutes → "45m" / "6h" / "2d". */
export function humanDelay(min: number) {
  if (min < 60) return `${min}m`;
  if (min < 60 * 24) return `${Math.round(min / 60)}h`;
  return `${Math.round(min / 60 / 24)}d`;
}

/**
 * Two letters, so a page of records is scannable: "M. Henderson" → MH,
 * "Cascade PM" → CP, a single word → its first two letters. Punctuation is
 * stripped first, which is what keeps the "M." initial from becoming ".".
 */
export function initials(name: string): string {
  const parts = name.replace(/[^A-Za-z ]/g, ' ').split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * A company account, so its avatar can take the ink plate instead of the
 * outlined one. A private client is written "X. Surname", so anything that
 * does not open with a personal initial is read as a firm.
 */
export function isCompany(name: string): boolean {
  return !/^[A-Za-z]\.\s/.test(name);
}

export function triggerLabel(value: string): string {
  return TRIGGERS.find((t) => t.value === value)?.label ?? value;
}

/**
 * Donor severity ladder, unchanged. `late` and `vlate` share one soft badge
 * treatment: a solid danger block read louder than the rest of the status
 * vocabulary and was removed on the desktop for the same reason.
 */
export function severity(q: QueueItem): { cls: string; label: string } {
  // The agent prepared it and is holding it for a yes (the rule says "ask me first").
  if (q.waiting) return { cls: 'sevSoon', label: 'waiting for you' };
  if (!q.overdue) return { cls: 'sevSched', label: q.rel };
  if (q.days <= 0) return { cls: 'sevSoon', label: 'due today' };
  if (q.days >= 7) return { cls: 'sevVlate', label: `${q.days}d late` };
  if (q.days >= 3) return { cls: 'sevLate', label: `${q.days}d late` };
  return { cls: 'sevSoon', label: `${q.days}d late` };
}

/** Name, email and top status all answer the book's search box. */
export function matchesCustomer(c: Customer, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    c.name.toLowerCase().includes(q) ||
    c.email.toLowerCase().includes(q) ||
    c.top.toLowerCase().includes(q)
  );
}
