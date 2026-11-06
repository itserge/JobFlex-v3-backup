// Mobile projects (mobile-projects-v2) — row shape, statuses and the pure
// helpers the handheld book derives its labels from.
//
// The eight-record demo fixture that used to live here is GONE. The book is
// read from the database through `listProjects()` in @/actions/projects — the
// same org-scoped query, ARCHIVED exclusion, ordering and job roll-up the
// desktop page's server component runs — and every write goes through
// `createProject` / `updateProject` / `archiveProject`. Nothing below is
// record-shaped: types, the status vocabulary, the filter option list and four
// pure functions.

// One row shape for both editions (2026-09-20): the desktop ledger's, which
// carries the sold / spent / open facts this list prints too.
import { progressOf, type Project } from "@/components/v3/projects-blueprint/projects-data";
export type { Project };

/** The desktop statuses, verbatim and in the desktop's order. */
export const STATUSES = ['ACTIVE', 'ON_HOLD', 'COMPLETED'];

/**
 * The desktop grid shows all eight cards at once. A handheld project row is
 * three text lines plus a drawn progress rule, so six — the same reasoning that
 * took the clients book from 12 to 8 and the proposals ledger from 8 to 6.
 */
export const PAGE_SIZE = 6;

export type FilterKey =
  | 'ALL'
  | 'ACTIVE'
  | 'ON_HOLD'
  | 'COMPLETED'
  | 'UNSCHEDULED'
  | 'NOTSTARTED';

/**
 * The desktop chip rail is All + the three statuses. Two more are added here,
 * on the same grounds the clients page added VIP and Untagged: both are states
 * the book actually holds, both are things you go looking for on a phone, and
 * both fill the 3-column menu to exact rows instead of leaving an orphan cell.
 *  · Unscheduled — no dates on the record. It is also what disables the row
 *    sheet's schedule action, so the filter and the sheet agree.
 *  · Not started — nothing closed out yet.
 */
export const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: 'ALL', label: 'All projects' },
  { key: 'ACTIVE', label: 'Active' },
  { key: 'ON_HOLD', label: 'On hold' },
  { key: 'COMPLETED', label: 'Completed' },
  { key: 'UNSCHEDULED', label: 'Unscheduled' },
  { key: 'NOTSTARTED', label: 'Not started' },
];

/** "ON_HOLD" → "on hold" — the desktop's own label transform, verbatim. */
export function statusLabel(s: string): string {
  return s.toLowerCase().replace('_', ' ');
}

/** The stages' % done when the project has stages (2026-11-05), else the whole percent of jobs closed out. */
export function progress(p: Project): number {
  return progressOf(p);
}

export function matchesFilter(p: Project, key: FilterKey): boolean {
  if (key === 'ALL') return true;
  if (key === 'UNSCHEDULED') return !p.startsAt && !p.endsAt;
  if (key === 'NOTSTARTED') return p.completedJobs === 0;
  return p.status === key;
}

/** Name, scope and status label all answer the search box. */
export function matchesQuery(p: Project, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    p.name.toLowerCase().includes(q) ||
    (p.description ?? '').toLowerCase().includes(q) ||
    statusLabel(p.status).includes(q)
  );
}

export function filterCount(list: Project[], key: FilterKey): number {
  return list.filter((p) => matchesFilter(p, key)).length;
}

/**
 * The row's mono annotation line: the delivery window and the job tally in one
 * drawing-annotation string. Both halves degrade on their own: a project can
 * carry no window, and a freshly created one has no jobs attached yet.
 */
export function windowLabel(p: Project): string {
  const dates = p.startsAt && p.endsAt ? `${p.startsAt} → ${p.endsAt}` : 'No dates set';
  // With stages (2026-11-05) the tally is the project's own: "65% · Framing".
  const jobs = p.done != null ? `${p.done}%${p.stageNow ? ` · ${p.stageNow}` : ''}` : p.jobCount > 0 ? `${p.completedJobs}/${p.jobCount} done` : 'No jobs yet';
  return `${p.number ? `#${p.number} · ` : ''}${dates} · ${jobs}`;
}

/** The shape the two schedule fields hand to `createProject`. Anything else is
 *  sent as null rather than guessed at. */
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/* ── the schedule fields' wire format ──────────────────────────────────────
   The same pair components/v3/shared/date-popover.ts publishes for the desktop
   dialog's date control, restated here rather than imported: that module's entry
   point pulls in a 9KB global stylesheet anchored under `.jf-blueprint .content`
   — chrome this page is not inside — and dragging it into the handheld chunk to
   reach two three-line functions is not a trade worth making. The FORMAT is the
   contract, and it is the one `createProject`'s zod coercion reads. */

function pad2(n: number): string {
  return n < 10 ? '0' + n : String(n);
}

/**
 * "YYYY-MM-DD" built from LOCAL calendar fields. `toISOString()` would be wrong
 * for the same reason `new Date("2026-07-30")` is wrong on the way back in: it
 * goes through UTC, and in every negative-offset timezone that shifts the date
 * by a day.
 */
export function toISODate(d: Date): string {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

/** Inverse of `toISODate`. Returns null for anything that is not a real day. */
export function fromISODate(v: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const day = Number(m[3]);
  const d = new Date(y, mo, day);
  // `new Date(2026, 1, 31)` silently rolls forward to March 3 — round-tripping
  // the fields is what rejects an impossible date instead of moving it.
  return d.getFullYear() === y && d.getMonth() === mo && d.getDate() === day ? d : null;
}
