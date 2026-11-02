// Mobile leads (mobile-leads-v2) — shape, vocabulary and pure helpers.
//
// This module holds NO records. The pipeline and the live Lead Center offers
// are read from the database in `leads-source.ts` (the desktop sheet's own
// query, org-scoped, sales-slice aware) and every write goes through the shared
// lead server actions. What stays here is the stuff that is not data: the row
// shape, the stage list, the status vocabulary, the source labels and the
// formatters the handheld cards use.
//
// (It previously carried the donor's 13-lead demo fixture, two demo offers and
// three demo CSV rows. Those were removed when the surface was wired to the
// data layer — a mock row on a page that also renders real ones is a lie.)

// The Incoming test is imported rather than restated: the two editions of this
// page must agree on what "incoming" means, and a duplicated predicate is how
// they stop agreeing.
import { isPlatformIncoming } from "@/components/v3/leads-blueprint/leads-data";

import { detectEmailSource, leadSourceOf } from "@/lib/leads/sources";

export type Lead = {
  /** Prisma cuid — the id every lead server action takes. */
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  city: string;
  project: string;
  spec: string | null;
  conf: number;
  status: string;
  source: string;
  assignee: string | null;
  /** Assigned to, or claimed by, the signed-in user. Drives "Already yours". */
  mine: boolean;
  age: string;
  desc: string;
  /** Where SmartBook stands with this lead (2026-10-31, lib/smartbook/status): "Needs you", "Booked" … */
  smart?: { label: string; tone: "accent" | "amber" | "emerald" | "muted" } | null;
};

export type Offer = {
  id: string;
  name: string;
  // No email, phone or street (2026-10-02): an offer carries the city and the
  // scope, and the homeowner's contacts arrive with the Lead row that
  // acceptLeadOffer writes. Leaving them off the type keeps every surface that
  // renders an offer from showing them by accident.
  city: string;
  project: string;
  spec: string;
  conf: number;
  attempt: number;
  mins: number;
  age: string;
  desc: string;
  /** The lead's price in cents when an admin set one; the contacts open on payment. */
  priceCents: number | null;
};

export type StagedRow = {
  name: string;
  email: string | null;
  phone: string | null;
  project: string | null;
  /** Carried through to importLeads, which stores it on the created row. */
  description: string | null;
  source: string;
};

/** All seven pipeline stages — the destinations offered by the move sheet. */
export const STAGES: Array<{ key: string; label: string }> = [
  { key: 'NEW', label: 'New' }, { key: 'ROUTED', label: 'Routed' },
  { key: 'CLAIMED', label: 'Claimed' }, { key: 'CONTACTED', label: 'Contacted' },
  { key: 'QUOTED', label: 'Quoted' }, { key: 'WON', label: 'Won' }, { key: 'LOST', label: 'Lost' }
];

/**
 * The five stages the Pipeline tab draws as sections. Won and Lost are
 * OUTCOMES, not work: on a phone the board is a queue of leads you still owe
 * something, so the two terminal stages stay off it. Nothing is hidden — they
 * are still destinations in the move sheet, still rows in All leads behind the
 * status filter, and their totals are drawn on the board's own foot.
 */
export const WORKING_STAGES = STAGES.filter((s) => s.key !== 'WON' && s.key !== 'LOST');

export const LEAD_STATUSES = ['ALL', 'NEW', 'ROUTED', 'CLAIMED', 'CONTACTED', 'QUOTED', 'WON', 'LOST', 'ARCHIVED'];

export const SRC: Record<string, string> = { MANUAL: 'Manual entry', EMAIL: 'Email paste', FACEBOOK: 'Facebook', IMPORT: 'Imported', FORM: 'Homeowner form', LEAD_CENTER: 'Lead center' };

/**
 * The desktop sheet pages 20 at a time. A handheld row is three lines tall, so
 * 8 — the same reasoning that took the clients book from 12 to 8 and the
 * proposals ledger from 8 to 6.
 */
export const PAGE_SIZE = 8;

export type TabKey = 'all' | 'pipeline' | 'incoming';

export const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'all', label: 'My leads' },
  { key: 'pipeline', label: 'Pipeline' },
  { key: 'incoming', label: 'Incoming' }
];

export type MethodKey = 'manual' | 'email' | 'file';

export const METHODS: Array<{ key: MethodKey; label: string; icon: string }> = [
  { key: 'manual', label: 'By hand', icon: 'i-userplus' },
  { key: 'email', label: 'Paste', icon: 'i-msg' },
  { key: 'file', label: 'CSV', icon: 'i-file' }
];

/** Where a lead came from, as a contractor says it (lib/leads/sources — the
 *  desk sheet reads the same vocabulary). */
export function srcLabel(v: string | null): string {
  return leadSourceOf(v).label;
}

/**
 * PASTE AN EMAIL → ONE LEAD.
 *
 * On a phone the paste tab is used the way its name says: you are looking at an
 * enquiry in your mail app, you copy it, you paste it. That is one lead, not a
 * list — so this reads the WHOLE blob for a contact and keeps the text as the
 * note, exactly as the classic import bench does
 * (app/(dashboard)/dashboard/leads/import-leads.tsx). The desktop sheet's
 * line-per-lead split stays where it belongs: on a desk, next to a spreadsheet.
 *
 * Returns null for an empty paste — there is nothing to add and nothing to say.
 */
export function parsePastedEmail(raw: string): StagedRow | null {
  const t = raw.trim();
  if (!t) return null;
  const email = t.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0] ?? null;
  // `\(?` before the first digit, which the classic bench's pattern omits: US
  // numbers are written "(206) 555-0455" more often than not, and without it the
  // match starts one character late and the area code lands as "206)".
  const phone = t.match(/\+?\(?\d[\d\s().-]{7,}\d/)?.[0]?.trim() ?? null;
  return {
    name: guessSenderName(t, email),
    email,
    phone,
    // Project type is a guess nobody can make from prose. It is left blank and
    // the lead lands as a general enquiry, ready to sort on the board.
    project: null,
    // The email itself is the most valuable thing in the paste; keep it.
    description: t.length > 320 ? t.slice(0, 320) + '…' : t,
    // Angi, Thumbtack, Yelp, Google… notifications are that source, not "Email".
    source: detectEmailSource(t),
  };
}

/**
 * "From: Dana Whitfield" wins; failing that the first line, if it looks like a
 * name rather than a header; failing that the local part of the address,
 * title-cased. The classic bench's ladder, verbatim.
 */
function guessSenderName(text: string, email: string | null): string {
  const fromLine = text.match(/^\s*(?:from|name)\s*:\s*([^<\n]+)/im);
  if (fromLine) return fromLine[1].trim();
  const firstLine = text.split('\n').map((l) => l.trim()).find(Boolean);
  if (firstLine && !firstLine.includes('@') && firstLine.length <= 60) return firstLine;
  if (email) {
    return email
      .split('@')[0]
      .replace(/[._-]+/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return 'Unknown sender';
}

/** ROUTED -> "Routed", ALL -> "All statuses". Status keys are SCREAMING_CASE. */
export function statusLabel(st: string): string {
  if (st === 'ALL') return 'All statuses';
  return st.charAt(0) + st.slice(1).toLowerCase();
}

export function pct(c: number): string {
  return Math.round(c * 100) + '%';
}

/** Offer window, counted down: "22h 14m left" / "41m left". */
export function clock(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? h + 'h ' + m + 'm left' : m + 'm left';
}

/**
 * Two letters, so a screenful of rows is scannable: "M. Alvarez" → MA,
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
 * The Incoming tab: the LEAD CENTER triage queue — platform offers and the
 * leads the platform routed here. Leads the shop entered itself (by hand,
 * pasted, imported) are not something to accept or decline; they go straight to
 * the pipeline. The rule and its history live with the desktop sheet, and both
 * editions call the same function so they cannot drift.
 */
export function isIncoming(l: Lead): boolean {
  return isPlatformIncoming(l);
}

/** Still moving — everything the Pipeline board draws. */
export function isInPlay(l: Lead): boolean {
  return l.status !== 'WON' && l.status !== 'LOST' && l.status !== 'ARCHIVED';
}

/**
 * The search box answers for the two filter dimensions the phone cannot afford
 * as their own controls: type "Facebook" or "Roofing" and the source / trade
 * chip rows of the desktop popover are covered. City is in the haystack too,
 * because the row card shows it.
 */
export function matchesQuery(l: Lead, query: string): boolean {
  if (!query) return true;
  const q = query.trim().toLowerCase();
  return (
    [
      l.name,
      l.email ?? '',
      l.phone ?? '',
      l.city,
      l.project,
      l.spec ?? '',
      l.assignee ?? '',
      srcLabel(l.source),
      l.desc,
    ]
      .join(' ')
      .toLowerCase()
      .indexOf(q) !== -1
  );
}

/**
 * Server-action failures are written for the user ("You can only update your
 * own leads", "That lead is already claimed by someone else"). Surface that
 * text; fall back to a generic line for anything unrecognisable. Same rule as
 * the desktop sheet's `actionError`.
 */
export function actionError(err: unknown): string {
  const msg = err instanceof Error ? err.message.trim() : '';
  if (!msg || msg.toLowerCase().includes('fetch failed')) {
    return 'Something went wrong. Check your connection and try again.';
  }
  return msg;
}
