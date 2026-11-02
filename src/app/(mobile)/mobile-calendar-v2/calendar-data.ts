// Mobile calendar (mobile-calendar-v2) — types, live book and formatters.
//
// This module USED TO BE a Seattle-area demo fixture carried over verbatim from
// the desktop donor. It is not any more. `ResponsiveDashboardShell` maps
// /dashboard/calendar → `MobileCalendar`, so every one of those hardcoded
// events was what a real contractor saw on a real phone on their real
// calendar. The fixture rows are gone; what is left is the SHAPE they had, and
// a book that the org's actual calendar is installed into.
//
// Two mechanical adaptations survive from the port, both forced by the mobile
// shell:
//  · KIND_IC.blocked points at `i-calendar-ban` instead of `i-ban`. The shared
//    mobile sprite carries 48 symbols and `i-ban` is not one of them, so the
//    page ships that one symbol itself under the collision-proof prefix.
//  · The desktop week-grid geometry (WG_START / WG_END / WG_ROW) is not
//    carried: there is no 8-column × 14-hour time grid on a phone, so the
//    constants that drove its pixel maths have nothing to drive. SNAP_MIN
//    stays — the create form still snaps its times.
//
// ── Why the book is module state and not a prop ───────────────────────────
// `TODAY`, `workersData`, `OWNER` and `LINK_OPTIONS` are read from MODULE
// SCOPE by helpers that are themselves module scope on purpose — `EventRow`
// and `metaRowsFor` are declared outside the component so a keystroke in the
// search box cannot remount (and re-animate) every row. Threading a book
// through them would mean a prop on every row and a parameter on every
// formatter. Instead the four bindings are `let`/mutable and
// `installCalendarBook()` writes them once, synchronously, before the view's
// first render reads them. ES module named imports are LIVE bindings, so every
// importer sees the installed values with no call-site change.
//
// The calendar is a singleton surface — one mount, one org, one session — so a
// module-level book has no second writer to race with. `installCalendarBook`
// is identity-guarded, so re-renders are free.

import { VISIT_VIA } from "@/lib/calendar/visitVia";

/** "desk": hours reserved for the AI desk to book into (2026-10-16). */
export type CalKind = "job" | "appointment" | "blocked" | "desk";

export type CalEvent = {
  /** DOM identity. On real data it carries a KIND PREFIX (`apt:…`, `block:…`,
   *  bare for a JobEvent) because the three tables have independent id spaces
   *  and one array holds all three. `rid` below is the un-prefixed key the
   *  server actions want. */
  id: string;
  /** Database primary key, present on every row the server read produced and on
   *  every row a wired create pushes back. Absent only on a purely local row. */
  rid?: string;
  /** JobEvent only: the Job that owns the status and the crew roster. This is
   *  what "Open job" navigates to; a jobless event (appointment, blocked time,
   *  or the optional-job path in createJobEvent) has none. */
  jobId?: string | null;
  kind: CalKind;
  title: string;
  start: Date;
  end: Date;
  status: string;
  workers: string[];
  client?: string;
  phone?: string;
  addr?: string;
  scope?: string;
  notes?: string;
  /** JobAssignment id per worker id, for the crew this event's job already has.
   *  Written by the server read (calendar-query.ts) and needed to REMOVE
   *  someone: `unassignWorker` takes the assignment row, not the worker. The
   *  handheld type simply never declared it, though the data was always there.
   *  Absent for a worker added in this session and not yet read back. */
  assignmentIds?: Record<string, string>;
  /** Per-worker JobAssignment response (PENDING | ACCEPTED | DECLINED |
   *  COMPLETED), keyed by workerId — the detail sheet's crew chips. */
  assignmentStatus?: Record<string, string>;
  /** Blocked time created with no crew picked — the block belongs to the owner. */
  selfOnly?: boolean;
  /** Blocked time with no owner: it holds the whole company (2026-10-23 — it used to read "Just me"). */
  orgWide?: boolean;
  /** Spans whole days: it has a date but no clock span, so it has no duration. */
  allDay?: boolean;
  /** "desk" only — hours reserved for the AI desk (lib/deskHours): whose (none = anyone), and whether every week. `rid` is the reservation. */
  deskUserId?: string;
  deskWeekly?: boolean;
  /** Appointment only — how the visit was booked (lib/calendar/visitVia):
   *  the AI desk on a call, the customer online, a service plan, or the team.
   *  The card wears it as a tag; the sheet says it in words. */
  via?: "ai-desk" | "online" | "plan" | "team" | "smartbook";
  /** "By the AI desk, on a phone call · Oct 16". */
  booked?: string;
  /** What the visit is for: the booked service, the plan visit, the lead's project. */
  visitFor?: string;
  /** Booked at the member price (an active service plan). */
  member?: boolean;
  leadId?: string;
  clientId?: string;
  /** The AI desk call that booked it. */
  callSid?: string;
};

export type CalWorker = { id: string; name: string; role: string; userId?: string };
export type TrayJob = { id: string; title: string; client: string; city: string; duration: string };
export type InboxItem = {
  id: string;
  title: string;
  worker: string;
  when: string;
  /** JobAssignment response state; absent reads as PENDING (stale seeds). */
  status?: "PENDING" | "ACCEPTED" | "DECLINED";
};
export type JobStatus = { value: string; label: string };

/**
 * The day the calendar opens on and measures "today" against.
 *
 * A `let`, not a `const`: it is the server's real date once
 * `installCalendarBook` has run. Midnight-normalised, which is what `sameDay`
 * and the `atMins` defaults assume. Until then it is the client's own midnight,
 * so a render that somehow beats the install still shows a real month rather
 * than a fixture's frozen July.
 */
export let TODAY: Date = midnight(new Date());

export const JOB_STATUSES: JobStatus[] = [
  { value: "SCHEDULED", label: "Scheduled" }, { value: "IN_PROGRESS", label: "In progress" },
  { value: "COMPLETED", label: "Completed" }, { value: "CANCELED", label: "Canceled" },
];

/** Team-view rows and the crew picker. WorkerProfile ids once installed —
 *  the id space the assignment actions accept. Mutated IN PLACE by
 *  `installCalendarBook` so importers keep their reference. */
export const workersData: CalWorker[] = [];

/** Whoever owns the shop — an empty crew on a blocked event means "my time".
 *  A `let` for the same reason as TODAY: it is derived from the installed
 *  roster, and the roster is not known at module-evaluation time. */
export let OWNER: CalWorker = { id: "", name: "You", role: "Owner" };

function midnight(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * The org's calendar, as the page's server read hands it over. Structurally the
 * desktop `CalendarSeed` — the handheld build consumes the same object rather
 * than a second, drifting shape.
 */
export type CalendarBook = {
  /** ISO. The server's real "today". */
  today: string;
  events: CalEvent[];
  workers: CalWorker[];
  tray: TrayJob[];
  inbox: InboxItem[];
  /** Unseen crew answers since the inbox was last opened (see desktop seed). */
  inboxUnseen?: number;
  links: LinkOption[];
  createKinds: CalKind[];
  canManage: boolean;
  /** SmartBook's Requests card (see the desktop seed). */
  canSmartBook?: boolean;
  /** The AI desk's reserved hours (see the desktop seed). */
  desk?: { mode: "open-hours" | "reserved"; timeZone: string; me: string; people: Array<{ userId: string; name: string }> };
};

/** The book last installed — the identity guard, so a re-render is a no-op. */
let installed: CalendarBook | null = null;

/**
 * Point the module-scope bindings at a real org's calendar.
 *
 * Called from the view's render, BEFORE any hook or module helper reads them.
 * Idempotent on object identity: React can render the same book as often as it
 * likes for the cost of one comparison.
 */
export function installCalendarBook(book: CalendarBook): void {
  if (installed === book) return;
  installed = book;
  TODAY = midnight(new Date(book.today));
  workersData.splice(0, workersData.length, ...book.workers);
  OWNER =
    book.workers.find((w) => /owner/i.test(w.role)) ??
    book.workers[book.workers.length - 1] ??
    { id: "", name: "You", role: "Owner" };
  LINK_OPTIONS.splice(0, LINK_OPTIONS.length, ...book.links);
}

/** Create-form times snap to this many minutes. */
export const SNAP_MIN = 15;
export const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DOW1 = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
export const KIND_IC: Record<CalKind, string> = {
  job: 'i-hardhat', appointment: 'i-cal', blocked: 'i-calendar-ban', desk: 'i-phone',
};
export const KIND_LABEL: Record<CalKind, string> = {
  job: 'Job event', appointment: 'Appointment', blocked: 'Blocked time', desk: 'AI desk hours',
};

/** Link targets for the "link a record" picker. The seed carries all four
 *  kinds; which of them a given event kind may actually reach is `LINK_TABS`. */
export type LinkKind = "job" | "proposal" | "lead" | "client";
export type LinkOption = {
  /** Prefixed on real data (`job:…`, `lead:…`) for the same reason
   *  `CalEvent.id` is: four tables, one picker. */
  id: string;
  /** Database primary key — what the create actions take. */
  rid?: string;
  kind: LinkKind;
  title: string;
  client: string;
  status: string;
  meta: string;
};

/**
 * Which record kinds each event kind may link to — the DESKTOP's sets,
 * restored 2026-08-22 (owner request: "everything you can schedule linked on
 * desktop, I should be able to schedule linked on mobile"). This reverses the
 * 2026-08-15 one-kind-each narrowing; the proposal path's create-a-job side
 * effect is accepted as the same deliberate act it is on the desktop picker.
 * Blocked time still links nothing; it is not about a record.
 */
export const LINK_TABS: Record<string, LinkKind[]> = {
  job: ["job", "proposal"],
  appointment: ["lead", "client", "proposal"],
};

/** The field label per event kind — "Linked record" said nothing about which. */
export const LINK_FIELD_LABEL: Record<string, string> = {
  job: "Linked job or proposal",
  appointment: "Linked lead, client or proposal",
};

export const LINK_LABEL: Record<LinkKind, string> = {
  job: "Job", proposal: "Proposal", lead: "Lead", client: "Client",
};

/**
 * The un-prefixed database key an action wants, split by kind.
 *
 * The desktop's `linkPayload` verbatim, so a phone and a laptop cannot send two
 * different shapes for the same picked row.
 */
export function linkPayload(opt: LinkOption | null | undefined) {
  const rid = opt ? opt.rid ?? opt.id : null;
  return {
    jobId: opt?.kind === "job" ? rid : null,
    proposalId: opt?.kind === "proposal" ? rid : null,
    leadId: opt?.kind === "lead" ? rid : null,
    clientId: opt?.kind === "client" ? rid : null,
  };
}

/** The org's linkable records. Mutated in place by `installCalendarBook` for
 *  the same reason as `workersData`: importers hold the array, not a copy. */
export const LINK_OPTIONS: LinkOption[] = [];

/* ============================================================
   VIEWS AND FILTERING
   ============================================================ */

export type ViewKey = "month" | "week" | "team";
export const VIEWS: { key: ViewKey; label: string }[] = [
  { key: "month", label: "Month" }, { key: "week", label: "Week" }, { key: "team", label: "Team" },
];

/** Not a real filter value — the "no filter" sentinel. */
export const ALL = "ALL";
export type FilterOpt = { key: string; label: string };

/**
 * The desktop bar carries a multi-select worker dropdown AND a four-button
 * status set side by side. Neither survives 320px, and the house rule is ONE
 * dropdown, so both collapse into a single option list: All, the four
 * statuses, then the four crew members. Nine cells is exactly the 3×3 the
 * menu grid wants.
 */
export function filterOptions(): FilterOpt[] {
  return [
    { key: ALL, label: "All" },
    ...JOB_STATUSES.map((s) => ({ key: `S:${s.value}`, label: s.label })),
    ...workersData.map((w) => ({ key: `W:${w.id}`, label: w.name })),
  ];
}

export function matchesFilter(e: CalEvent, key: string): boolean {
  if (key === ALL) return true;
  if (key.startsWith("S:")) return e.status === key.slice(2);
  if (key.startsWith("W:")) return e.workers.includes(key.slice(2));
  return true;
}

/** Title, client and address answer the search box — the desktop's own set. */
export function matchesQuery(e: CalEvent, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return `${e.title} ${e.client ?? ""} ${e.addr ?? ""}`.toLowerCase().includes(q);
}

export function filterCount(list: CalEvent[], key: string): number {
  return list.filter((e) => matchesFilter(e, key)).length;
}

/* ============================================================
   DATE / FORMAT HELPERS — the donor's formulas and format strings
   ============================================================ */

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
export function sameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}
export function startOfWeek(d: Date): Date {
  const x = new Date(d);
  x.setDate(x.getDate() - x.getDay());
  x.setHours(0, 0, 0, 0);
  return x;
}
export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
export function addMin(d: Date, m: number): Date {
  return new Date(d.getTime() + m * 60000);
}
/** Same calendar day as `day`, at `mins` minutes past midnight. */
export function atMins(day: Date, mins: number): Date {
  const x = new Date(day);
  x.setHours(0, 0, 0, 0);
  return new Date(x.getTime() + mins * 60000);
}
export function snapMins(mins: number): number {
  return Math.round(mins / SNAP_MIN) * SNAP_MIN;
}
export function fmtTime(d: Date): string {
  let h = d.getHours();
  const m = d.getMinutes();
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}${m ? ":" + String(m).padStart(2, "0") : ""} ${ap}`;
}
/** The clock half of the row's time plate: "7:00" / "11:30". */
export function fmtClock(d: Date): string {
  const h = d.getHours() % 12 || 12;
  return `${h}:${String(d.getMinutes()).padStart(2, "0")}`;
}
export function fmtMeridiem(d: Date): string {
  return d.getHours() >= 12 ? "PM" : "AM";
}
export function fmtDate(d: Date): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(d);
}
export function fmtDayShort(d: Date): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(d);
}
export function fmtMonthYear(d: Date): string {
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(d);
}
/** "Jul 19–25, 2026" — the week label, collapsed when the month is shared. */
export function fmtWeekRange(start: Date): string {
  const end = addDays(start, 6);
  const sMo = new Intl.DateTimeFormat("en-US", { month: "short" }).format(start);
  const eMo = new Intl.DateTimeFormat("en-US", { month: "short" }).format(end);
  return start.getMonth() === end.getMonth()
    ? `${sMo} ${start.getDate()}–${end.getDate()}, ${end.getFullYear()}`
    : `${sMo} ${start.getDate()} – ${eMo} ${end.getDate()}, ${end.getFullYear()}`;
}
export function fmtRange(a: Date, b: Date): string {
  return `${fmtTime(a)} – ${fmtTime(b)}`;
}
export function durLabel(ms: number): string {
  const total = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}
/**
 * Hours the masthead counts. A timed event contributes its clock span; an
 * all-day event has no clock span, so it contributes one 8-hour working day
 * per day it covers — otherwise blocking out a whole week would read as zero
 * booked hours.
 */
export function eventHours(e: CalEvent): number {
  if (e.allDay) {
    const days = Math.round((atMins(e.end, 0).getTime() - atMins(e.start, 0).getTime()) / 86400000) + 1;
    return Math.max(1, days) * 8;
  }
  return Math.max(0, e.end.getTime() - e.start.getTime()) / 3600000;
}

/**
 * Two letters, so a list of rows is scannable: "M. Henderson" → MH,
 * "Cascade PM" → CP, a single word → its first two letters. Punctuation is
 * stripped first, which is what keeps the "M." initial from becoming ".".
 */
export function initials(name: string): string {
  const parts = name.replace(/[^A-Za-z ]/g, " ").split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function workerName(id: string): string {
  return workersData.find((w) => w.id === id)?.name ?? id;
}

/** "Marcus B. +1" — the whole crew never fits on a 320px row. */
export function crewLabel(e: CalEvent): string {
  if (e.kind === "blocked" && e.orgWide) return "Everyone";
  if (e.kind === "blocked" && (e.selfOnly || !e.workers.length)) return "Just me";
  if (!e.workers.length) return "Unassigned";
  const first = workerName(e.workers[0]);
  return e.workers.length > 1 ? `${first} +${e.workers.length - 1}` : first;
}

/** Who / where, in the row's mono line. Blocked time has neither, so it falls
 *  back to naming what it is. */
export function whoWhere(e: CalEvent): string {
  const who = e.client ?? KIND_LABEL[e.kind];
  return e.addr ? `${who} · ${e.addr}` : who;
}

/**
 * The tone key for a status badge or a month-grid dot. Kind is NOT a status,
 * so appointments and blocked time get their own keys (sky / ink plate) and
 * only job events reach the four status tones — the same split the desktop's
 * `statusCls()` makes.
 */
export function toneKey(e: CalEvent): string {
  if (e.kind === "appointment") return "appt";
  if (e.kind === "blocked") return "blocked";
  if (e.kind === "desk") return "desk";
  return e.status.toLowerCase();
}

export function toneLabel(e: CalEvent): string {
  // Who booked the visit, in words (lib/calendar/visitVia): "AI desk booked",
  // "Booked online", "Plan visit" — an office-made one stays "Appointment".
  if (e.kind === "appointment") return VISIT_VIA[e.via || "team"].badge;
  if (e.kind === "blocked") return "Blocked";
  if (e.kind === "desk") return e.deskWeekly ? "AI desk · every week" : "AI desk hours";
  return JOB_STATUSES.find((s) => s.value === e.status)?.label ?? e.status;
}

export function byStart(a: CalEvent, b: CalEvent): number {
  return a.start.getTime() - b.start.getTime();
}

/** How many day chips a month cell shows before it prints "+N". */
export const MG_CAP = 3;

/**
 * Wire format for the two form fields: "YYYY-MM-DD" and "HH:MM", 24-hour.
 *
 * The native `<input type="date">` / `<input type="time">` controls that used to
 * own these strings are gone (see the `.dpk` / `.tpk` blocks in the stylesheet),
 * but the STRINGS did not change — the house panels write exactly what the
 * native controls wrote, so `fromInputs` and the save path never learned that
 * the control underneath them was replaced.
 */
export function toDateInput(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function toTimeInput(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
/** Inverse of `toDateInput`. Null for anything that is not a real day —
 *  `new Date(2026, 1, 31)` rolls forward to March, so the fields are
 *  round-tripped rather than trusted. */
export function fromDateInput(v: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const day = Number(m[3]);
  const d = new Date(y, mo, day);
  return d.getFullYear() === y && d.getMonth() === mo && d.getDate() === day ? d : null;
}
/** Inverse of `toTimeInput`, as minutes past midnight. Null when unparseable. */
export function fromTimeInput(v: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}
export function minsToTimeInput(mins: number): string {
  const m = ((mins % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
/** "7:00 AM" — how a time reads on the field face and in the panel's foot. */
export function fmtMins(mins: number): string {
  const m = ((mins % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const h = h24 % 12 || 12;
  return `${h}:${String(m % 60).padStart(2, "0")} ${h24 >= 12 ? "PM" : "AM"}`;
}
/** Rebuilds a Date from the two native inputs. Invalid text falls back to the
 *  day it was opened on, so a half-typed date can never produce Invalid Date. */
export function fromInputs(dateStr: string, timeStr: string, fallback: Date): Date {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  const tm = /^(\d{1,2}):(\d{2})$/.exec(timeStr);
  if (!dm) return new Date(fallback);
  const day = new Date(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]));
  const mins = tm ? snapMins(Number(tm[1]) * 60 + Number(tm[2])) : 8 * 60;
  return atMins(day, mins);
}
