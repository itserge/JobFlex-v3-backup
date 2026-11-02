// Leads blueprint — the row shapes, the CSV staging parser and the page's
// vocabulary. Kept in its own module (same pattern as proposals-data.ts) so the
// behavior file stays readable.
//
// It holds NO records. The pipeline and the live Lead Center offers are read
// from the database in src/app/dashboard/leads/page.tsx and handed to the
// behavior module; the donor's 13-lead demo fixture and its two demo offers
// were removed when that landed, so there is nothing here for an un-fed mount
// to fall back to — it paints the sheet's own empty states instead.
//
// Lead shape, mirroring the Prisma row: name, email, phone, city/state,
// projectType, description, status, source, aiCategory (specialty),
// aiConfidence, assignee, createdAt.

import { sourceFromCell } from "@/lib/leads/sources";

export type Lead = {
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
  description: string | null;
  source: string;
};

// ---------------------------------------------------------------------------
// CSV staging. Lifted verbatim from the classic import bench
// (src/app/(dashboard)/dashboard/leads/import-leads.tsx) — same quote handling,
// same header sniffing, same column guesses, same "Unnamed lead" fallback — so
// a file that staged five rows there stages the same five rows here. It lives
// in this pure module because the classic version is welded to a React
// component and a toast import.
// ---------------------------------------------------------------------------

/** Split a CSV line respecting simple double-quoted fields. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else q = !q;
    } else if (ch === "," && !q) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

export function parseCsvRows(text: string): StagedRow[] {
  // A "source" / "channel" column (2026-10-16) tags each row with where it came
  // from (lib/leads/sources sourceFromCell); without one a row is "Imported list".
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return [];
  const first = splitCsvLine(lines[0]).map((c) => c.toLowerCase());
  const hasHeader = first.some((c) => /name|email|phone|project|description/.test(c));
  const idx = {
    name: hasHeader ? first.findIndex((c) => c.includes("name")) : 0,
    email: hasHeader ? first.findIndex((c) => c.includes("email")) : 1,
    phone: hasHeader ? first.findIndex((c) => c.includes("phone")) : 2,
    project: hasHeader ? first.findIndex((c) => c.includes("project")) : 3,
    description: hasHeader ? first.findIndex((c) => c.includes("desc")) : 4,
    source: hasHeader ? first.findIndex((c) => c.includes("source") || c.includes("channel") || c === "from" || c.includes("lead from")) : -1,
  };
  const rows = hasHeader ? lines.slice(1) : lines;
  const pick = (cells: string[], i: number) => (i >= 0 && cells[i] ? cells[i] : null);
  return rows
    .map((line) => splitCsvLine(line))
    .filter((cells) => cells.some(Boolean))
    .map((cells) => ({
      name: pick(cells, idx.name) ?? "Unnamed lead",
      email: pick(cells, idx.email),
      phone: pick(cells, idx.phone),
      project: pick(cells, idx.project),
      description: pick(cells, idx.description),
      source: sourceFromCell(pick(cells, idx.source)),
    }));
}

export const STAGES: Array<{ key: string; label: string }> = [
  { key: 'NEW', label: 'New' }, { key: 'ROUTED', label: 'Routed' },
  { key: 'CLAIMED', label: 'Claimed' }, { key: 'CONTACTED', label: 'Contacted' },
  { key: 'QUOTED', label: 'Quoted' }, { key: 'WON', label: 'Won' }, { key: 'LOST', label: 'Lost' }
];

export const LEAD_STATUSES = ['ALL', 'NEW', 'ROUTED', 'CLAIMED', 'CONTACTED', 'QUOTED', 'WON', 'LOST', 'ARCHIVED'];

export const SRC: Record<string, string> = { MANUAL: 'Manual entry', EMAIL: 'Email paste', FACEBOOK: 'Facebook', IMPORT: 'Imported', FORM: 'Homeowner form', LEAD_CENTER: 'Lead center' };

/**
 * THE INCOMING RULE — shared by the desktop sheet and mobile-leads-v2 so the two
 * editions cannot drift.
 *
 * Incoming is the Lead Center triage queue: work the PLATFORM handed this shop
 * and is still waiting on an answer for. It is NOT "everything new".
 *
 * Until 2026-08-15 the test was `status === NEW || status === ROUTED`, which
 * swept up every lead the contractor entered themselves — a CSV import, a
 * pasted email, a by-hand row all land as NEW (see importLeads) and so appeared
 * in a queue asking them to accept or decline their own typing. Source is what
 * separates the two: only leadOffers.ts (an accepted offer, CLAIMED) and
 * adminLeadCenter.ts (a manual admin assign, ROUTED) ever write LEAD_CENTER.
 *
 * Live LeadOffer rows are rendered alongside these and are platform-only by
 * construction, so they need no test of their own.
 */
export function isPlatformIncoming(l: { source: string; status: string }): boolean {
  return l.source === 'LEAD_CENTER' && (l.status === 'NEW' || l.status === 'ROUTED');
}

/**
 * The shop's OWN book: every lead except the platform hand-offs it has not
 * answered yet. Those belong to the Incoming tab until they are accepted or
 * passed on — counting them in the pipeline shows work nobody has agreed to
 * take as though it were already the shop's.
 *
 * ONE function for both editions, on purpose. The desk sheet filtered them out
 * and the handheld build did not, so the same shop, the same second, read
 * "All leads 2" on a laptop and "All leads 3 · Pipeline 3" on a phone
 * (2026-09-17). Counts that disagree across viewports are not a rounding
 * difference — one of them is telling the owner they have a job they do not.
 */
export function ownLeads<T extends { source: string; status: string }>(rows: T[]): T[] {
  return rows.filter((l) => !isPlatformIncoming(l));
}

export const PAGE_SIZE = 20;

/** Meta imports have deterministic IDs; manually tagged Facebook leads do not. */
export function isMetaImportedLead(lead: { id: string; source: string }): boolean {
  return lead.source === "FACEBOOK" && /^meta_[a-f0-9]{40}$/.test(lead.id);
}
