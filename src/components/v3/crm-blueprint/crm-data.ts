// CRM blueprint — shapes, enum option lists and class maps ONLY.
//
// The donor's embedded demo arrays (15 leads, 13 customers, 4 rules, 8
// follow-ups, a conversation count and a template list) used to live here as a
// fallback for a props-less render. They are gone: `src/app/dashboard/crm/
// page.tsx` reads the org's real rows out of Prisma and `CrmContentData` is now
// a REQUIRED prop, so the sheet has no path that paints a demo record.

import type { FollowUpChannel } from "@/lib/followUps/copy";
import type { FollowUpMode, FollowUpWords } from "@/lib/followUps/agent";
import type { SmartCrmAccess } from "@/lib/crm/smartAccess";
import type { WhoLike } from "@/lib/team/who";

export type CrmLead = {
  name: string;
  project: string;
  status: string;
  assignee: string | null;
  age: string;
};

/** One Recent-activity line. `who` is its author's mark (lib/team/who); null
 *  means the system did it and the row draws the System mark. */
export type ActivityItem = { summary: string; age: string; who: WhoLike | null };

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

export type FollowUpRule = {
  id: string;
  name: string;
  triggerStatus: string;
  delayMinutes: number;
  enabled: boolean;
  /** Email or text. A rule has no template any more — its wording is derived
   *  from the trigger in src/lib/followUps/copy.ts, which is the same module
   *  the preview card and the dispatcher read. */
  channel: FollowUpChannel;
  /** A starter rule (lib/followUps/defaults): deleting it turns it off, and
   *  the row stays, reading "Turned off". */
  isDefault?: boolean;
  /** Who sends it — on its own, after a yes, or a person (lib/followUps/agent). */
  mode?: FollowUpMode;
  /** The standard words, or written for each client. */
  words?: FollowUpWords;
};

export type QueueItem = {
  id: string;
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

export const STATUS_ORDER = ['PAID', 'COMPLETED', 'ACCEPTED', 'VIEWED', 'SENT', 'DRAFT', 'DECLINED', 'EXPIRED', 'ARCHIVED'];

export const STATUS_CLS: Record<string, string> = {
  PAID: 'pstatus--paid', COMPLETED: 'pstatus--paid', ACCEPTED: 'pstatus--accepted',
  VIEWED: 'pstatus--viewed', SENT: 'pstatus--sent', DRAFT: '',
  DECLINED: 'pstatus--declined', EXPIRED: 'pstatus--expired', ARCHIVED: ''
};

export const STATUS_DOT: Record<string, string> = {
  PAID: 'var(--success-dark)', COMPLETED: 'var(--success-dark)', ACCEPTED: 'var(--success)',
  VIEWED: 'var(--blueprint)', SENT: 'var(--sky)', DRAFT: 'var(--muted-faint)',
  DECLINED: 'var(--danger)', EXPIRED: 'var(--warning)', ARCHIVED: 'var(--muted-faint)'
};

// Workflows: FollowUpRule — name, triggerStatus, delayMinutes, enabled, template
export const TRIGGERS: Trigger[] = [
  { value: 'SENT', label: 'Proposal sent' }, { value: 'VIEWED', label: 'Proposal viewed' },
  { value: 'ACCEPTED', label: 'Proposal accepted' }, { value: 'PAID', label: 'Proposal paid' },
  { value: 'DECLINED', label: 'Proposal declined' }
];

export const Q_PAGE = 20;

// ─────────────────────────────────────────────
// LIVE DATA CONTRACT
//
// `src/app/dashboard/crm/page.tsx` reads the real rows out of Prisma — the SAME
// queries the classic CRM pages use
// (src/app/(dashboard)/dashboard/crm/{queue,workflows,customers}) — and hands
// them to `initCrmContent`, which then keeps itself in step with the database
// through the follow-up server actions in src/actions/followUps.ts.
// ─────────────────────────────────────────────

/** Overview counters. Derived server-side from Lead / FollowUp / Conversation. */
export type CrmStats = {
  won: number;
  lost: number;
  active: number;
  conversations: number;
};

/** The sender the preview card renders as — the org's own lockup and footer, so
 *  the contractor sees their letterhead, not a placeholder. */
export type PreviewOrg = { name: string; phone: string | null; logoUrl: string | null };

/** The whole live payload. Every field is required — the page always fills it
 *  from Prisma, and there is no fixture left to stand in for any of it. */
export type CrmContentData = {
  stats: CrmStats;
  fresh: CrmLead[];
  activity: ActivityItem[];
  customers: Customer[];
  rules: FollowUpRule[];
  queue: QueueItem[];
  org: PreviewOrg;
  /** A configured Twilio number. Without one the TEXT channel is offered
   *  disabled, with the same note the client message dialog shows. */
  smsEnabled: boolean;
  /** Smart CRM on this plan (lib/crm/smartAccess): without it the rule editor offers no agent choices, the Inbox and
   *  Pipeline tabs leave a new-plan shop's sheet, and Win back / the pulse show the Smart CRM card. */
  smartCrm: SmartCrmAccess;
  /** The server's clock at render, so "next send in 5 h" hydrates as rendered. */
  renderedAt: number;
};
