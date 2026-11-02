// Calendar blueprint — demo data, hardcoded exactly as the donor's <script>
// declares it (jobflex-calendar-blueprint_5.html). Every id, title, date,
// status, phone number and address is verbatim; nothing is derived, sorted or
// reformatted here. The behavior module clones these seeds per mount so the
// runtime mutations (drag-to-reschedule, create, delete, confirm) start from
// the same state on every navigation.

/** "desk": hours reserved for the AI desk to book into (2026-10-16). */
export type CalKind = "job" | "appointment" | "blocked" | "desk";

export type CalEvent = {
  /**
   * DOM identity. On real data this carries a KIND PREFIX (`apt:…`, `block:…`,
   * bare for a JobEvent) because the three tables have independent id spaces
   * and one array holds all three — the same scheme the classic calendar page
   * used. `rid` below is the un-prefixed database key the server actions want.
   */
  id: string;
  /** Database primary key. Absent on the donor fixture, which has no records —
   *  every write path checks for it and refuses rather than pretending. */
  rid?: string;
  /** JobEvent only: the Job that owns the status and the crew roster. A jobless
   *  event (the optional-job path in createJobEvent) has null here. */
  jobId?: string | null;
  /** JobAssignment row id per worker id. Removing crew needs the ASSIGNMENT id
   *  (unassignWorker takes that, not the worker), so the mapping ships with the
   *  event instead of being re-queried on save. */
  assignmentIds?: Record<string, string>;
  assignmentStatus?: Record<string, string>;
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
  /** Blocked time created with no crew picked — the block belongs to the owner. */
  selfOnly?: boolean;
  /** Blocked time with no owner: it holds the whole company (2026-10-23 — it used to read "Just me"). */
  orgWide?: boolean;
  /** Spans whole days: rendered in the week's all-day band, never in the time grid. */
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
  /**
   * Lane this block last occupied in the week grid.
   *
   * A drop writes the lane its PREVIEW showed. Without it, `layoutDay` re-lays
   * the whole day from scratch on the next render and assigns lanes greedily in
   * start order — so dragging the right-hand card of a pair to an earlier time
   * made the two swap sides the instant the drop committed, under the cursor.
   * Ignored whenever the day no longer splits into that many lanes, which is
   * what keeps a stale hint harmless.
   */
  lane?: number;
};

/** `userId`: the login behind the crew profile — reserved AI desk hours are kept by user (lib/deskHours). */
export type CalWorker = { id: string; name: string; role: string; userId?: string };
/** Per-worker JobAssignment response for a job event's crew, keyed by
 *  workerId — PENDING | ACCEPTED | DECLINED | COMPLETED. Absent on fixture
 *  rows and non-job events. */
export type CalAssignmentStatus = Record<string, string>;
export type TrayJob = { id: string; title: string; client: string; city: string; duration: string };
export type InboxItem = {
  id: string;
  title: string;
  worker: string;
  when: string;
  /** JobAssignment response state. Optional so the fixture rows (all pending)
   *  and any stale seed keep rendering; absent reads as "PENDING". */
  status?: "PENDING" | "ACCEPTED" | "DECLINED";
};
export type JobStatus = { value: string; label: string };

/** Wednesday, 22 July 2026 — the donor's frozen "today". */
export const TODAY = new Date(2026, 6, 22);

export const JOB_STATUSES: JobStatus[] = [
  { value: "SCHEDULED", label: "Scheduled" }, { value: "IN_PROGRESS", label: "In progress" },
  { value: "COMPLETED", label: "Completed" }, { value: "CANCELED", label: "Canceled" },
];

export const workersData: CalWorker[] = [
  { id: "w1", name: "Marcus B.", role: "Lead installer" },
  { id: "w2", name: "Sofia R.",  role: "Estimator" },
  { id: "w3", name: "Dan K.",    role: "Installer" },
  { id: "w4", name: "Ivan",      role: "Owner" },
];

function iso(y: number, m: number, d: number, h: number, min?: number) {
  return new Date(y, m, d, h, min || 0);
}

/** Event = jobEvent | appointment | blocked (CalendarEvent from EventChip). */
export const EVENTS_SEED: CalEvent[] = [
  { id: 'e1',  kind: 'job',         title: 'Roof tear-off — 4812 Maple Ave', start: iso(2026, 6, 22, 7, 0),  end: iso(2026, 6, 22, 15, 0), status: 'IN_PROGRESS', workers: ['w1', 'w3'], client: 'M. Henderson', phone: '(425) 555-0132', addr: '4812 Maple Ave, Bothell', scope: 'Tear off two layers, install synthetic underlayment and architectural shingles.', notes: 'Dumpster drops at 7:00.' },
  { id: 'e2',  kind: 'appointment', title: 'Estimate visit — S. Rao',        start: iso(2026, 6, 22, 16, 0), end: iso(2026, 6, 22, 17, 0), status: 'SCHEDULED',   workers: ['w2'], client: 'S. Rao', phone: '(425) 555-0116', addr: 'Sammamish, WA', notes: 'Corner lot, wants privacy panels.' },
  { id: 'e3',  kind: 'job',         title: 'Dumpster swap — Maple Ave',      start: iso(2026, 6, 22, 13, 0), end: iso(2026, 6, 22, 14, 0), status: 'SCHEDULED',   workers: ['w3'], client: 'M. Henderson', addr: '4812 Maple Ave, Bothell' },
  { id: 'e4',  kind: 'job',         title: 'Fence repair — 1409 Fern St',    start: iso(2026, 6, 23, 8, 0),  end: iso(2026, 6, 23, 12, 0), status: 'SCHEDULED',   workers: ['w1'], client: 'K. Nguyen', phone: '(425) 555-0170', addr: '1409 Fern St, Bothell' },
  { id: 'e5',  kind: 'blocked',     title: 'Shop maintenance',               start: iso(2026, 6, 23, 15, 0), end: iso(2026, 6, 23, 17, 0), status: 'SCHEDULED',   workers: ['w3'] },
  { id: 'e6',  kind: 'job',         title: 'Asphalt reroof — Henderson',     start: iso(2026, 6, 24, 7, 0),  end: iso(2026, 6, 24, 16, 0), status: 'SCHEDULED',   workers: ['w1', 'w3'], client: 'M. Henderson', addr: '4812 Maple Ave, Bothell' },
  { id: 'e7',  kind: 'appointment', title: 'Walkthrough — A. Kim',           start: iso(2026, 6, 24, 11, 0), end: iso(2026, 6, 24, 12, 0), status: 'SCHEDULED',   workers: ['w2'], client: 'A. Kim', addr: 'Bellevue, WA' },
  { id: 'e8',  kind: 'job',         title: 'Cedar fence — 902 Alder Ct',     start: iso(2026, 6, 25, 8, 0),  end: iso(2026, 6, 25, 17, 0), status: 'SCHEDULED',   workers: ['w1'], client: 'D. Reyes', phone: '(425) 555-0148', addr: '902 Alder Ct, Kirkland' },
  { id: 'e9',  kind: 'job',         title: 'Deck power wash — 55 Cedar Loop', start: iso(2026, 6, 20, 9, 0), end: iso(2026, 6, 20, 13, 0), status: 'COMPLETED',   workers: ['w3'], client: 'R. Tran', addr: '55 Cedar Loop, Bothell' },
  { id: 'e10', kind: 'job',         title: 'Gutter guards — Redmond',        start: iso(2026, 6, 17, 9, 0),  end: iso(2026, 6, 17, 14, 0), status: 'COMPLETED',   workers: ['w1'], client: 'D. Pham', addr: 'Redmond, WA' },
  { id: 'e11', kind: 'job',         title: 'Skylight install — 210 Fir St',  start: iso(2026, 6, 28, 8, 0),  end: iso(2026, 6, 28, 12, 0), status: 'SCHEDULED',   workers: ['w3'], client: 'K. Marsh', addr: '210 Fir St, Woodinville' },
  { id: 'e12', kind: 'appointment', title: 'Site check — Cascade PM',        start: iso(2026, 6, 29, 10, 0), end: iso(2026, 6, 29, 11, 0), status: 'SCHEDULED',   workers: ['w2'], client: 'Cascade PM', addr: 'Redmond, WA' },
  { id: 'e13', kind: 'job',         title: 'Siding patch — Mill Creek',      start: iso(2026, 6, 30, 8, 0),  end: iso(2026, 6, 30, 15, 0), status: 'SCHEDULED',   workers: ['w1', 'w3'], client: 'S. Patel', addr: 'Mill Creek, WA' },
  { id: 'e14', kind: 'job',         title: 'Punch list — Cypress Ln',        start: iso(2026, 6, 14, 9, 0),  end: iso(2026, 6, 14, 12, 0), status: 'CANCELED',    workers: ['w1'], client: 'C. Ferreira', addr: '61 Cypress Ln, Bothell' },
];

/** Unscheduled work for the tray (DispatchableJob). */
export const TRAY_SEED: TrayJob[] = [
  { id: 'u1', title: 'Gutter replacement', client: 'R. Okafor', city: 'Redmond', duration: '4h' },
  { id: 'u2', title: 'Pergola build',      client: 'L. Wong',   city: 'Sammamish', duration: '2d' },
  { id: 'u3', title: 'Chain-link fence',   client: 'N. Ivanov', city: 'Lynnwood', duration: '1d' },
  { id: 'u4', title: 'Roof inspection',    client: 'T. Ortiz',  city: 'Bothell',  duration: '2h' },
];

/** Crew assignments awaiting confirmation (AppointmentAssignment). */
export const INBOX_SEED: InboxItem[] = [
  { id: 'a1', title: 'Asphalt reroof — Henderson', worker: 'Marcus B.', when: 'Jul 24 · 7:00 AM' },
  { id: 'a2', title: 'Cedar fence — 902 Alder Ct', worker: 'Dan K.',    when: 'Jul 25 · 8:00 AM' },
  { id: 'a3', title: 'Siding patch — Mill Creek',  worker: 'Marcus B.', when: 'Jul 30 · 8:00 AM' },
];

/** Week view window: 6:00–20:00. */
export const WG_START = 6;
export const WG_END = 20;
/** Height of one hour row in the week grid. Mirrored by `--wg-row` in the CSS
 *  module — the drag-to-create geometry and the event blocks are computed from
 *  this number, so the two must stay in sync. */
export const WG_ROW = 54;
/** Drag-to-create and the time list snap to this many minutes. */
export const SNAP_MIN = 15;
export const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DOW1 = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
export const KIND_IC: Record<string, string> = { job: 'i-hardhat', appointment: 'i-cal', blocked: 'i-ban', desk: 'i-phone' };

/** Link targets for the "link a record" picker. A job event links to work
 *  (jobs, proposals); an appointment is a meeting, so it also links to the
 *  people it can be about — leads and clients. Rows carry a status so the badge
 *  can use the shared `.pstatus--*` tones. */
export type LinkKind = "job" | "proposal" | "lead" | "client";
export type LinkOption = {
  /** Prefixed on real data (`job:…`, `prop:…`) for the same reason `CalEvent.id`
   *  is: four tables, one picker. */
  id: string;
  /** Database primary key. Absent on the fixture, where `id` already is one. */
  rid?: string;
  kind: LinkKind;
  title: string;
  client: string;
  status: string;
  meta: string;
};

/**
 * Everything the page's server component reads for one mount. Passed straight
 * into `initCalendarContent` and never replaced — the behavior module owns the
 * state from then on and keeps itself in step with the database through the
 * calendar server actions.
 */
export type CalendarSeed = {
  /** The server's "today", ISO. The fixture's frozen 22 Jul 2026 is a fixture
   *  detail; a live calendar has to open on the real month. */
  today: string;
  events: CalEvent[];
  /** Team-view rows AND the crew picker — WorkerProfile ids, which is the id
   *  space `assignWorker` / `syncAssignments` accept. */
  workers: CalWorker[];
  /** Unscheduled jobs. `id` is the Job id `scheduleJobFromTray` takes. */
  tray: TrayJob[];
  /** Pending JobAssignments. `id` is the assignment id `markAssignmentAccepted`
   *  takes. */
  inbox: InboxItem[];
  /** Crew answers (accept / decline) the office has not looked at since it
   *  last opened the inbox sheet — the bell's "things to see" count on top of
   *  the pending workload. Optional: fixtures and stale seeds read as 0. */
  inboxUnseen?: number;
  links: LinkOption[];
  /**
   * Which kinds this role may actually create, in tab order. The three create
   * actions have three different guards — `createJobEvent` refuses SALES and
   * ESTIMATOR, `createAppointment` / `createBlockedTime` refuse INSTALLER and
   * ESTIMATOR — so the tab strip is built from this rather than offering all
   * three and letting two of them fail on submit.
   */
  createKinds: CalKind[];
  /**
   * Manager-level membership. The dispatch surfaces (tray, crew inbox, team
   * re-assignment) go through `requireManager()` actions, so a sales rep or a
   * field worker gets them read-only rather than a server rejection per click.
   */
  canManage: boolean;
  /** SmartBook's Requests card (2026-10-31): the office and the sales reps answer customers' own times. */
  canSmartBook?: boolean;
  /** The AI desk's reserved hours: where it books from, the shop's clock, who I am, who hours can be reserved for. */
  desk?: { mode: "open-hours" | "reserved"; timeZone: string; me: string; people: Array<{ userId: string; name: string }> };
};

/** Which tabs each event kind offers, in order. `all` is prepended by the UI. */
export const LINK_TABS: Record<string, LinkKind[]> = {
  job: ["job", "proposal"],
  appointment: ["lead", "client", "proposal"],
};

export const LINK_LABEL: Record<LinkKind, string> = {
  job: "Job", proposal: "Proposal", lead: "Lead", client: "Client",
};

export const LINK_OPTIONS: LinkOption[] = [
  { id: 'u1', kind: 'job',      title: 'Gutter replacement',    client: 'R. Okafor',   status: 'scheduled', meta: 'Redmond · 4h' },
  { id: 'u2', kind: 'job',      title: 'Pergola build',         client: 'L. Wong',     status: 'scheduled', meta: 'Sammamish · 2d' },
  { id: 'u3', kind: 'job',      title: 'Chain-link fence',      client: 'N. Ivanov',   status: 'scheduled', meta: 'Lynnwood · 1d' },
  { id: 'u4', kind: 'job',      title: 'Roof inspection',       client: 'T. Ortiz',    status: 'scheduled', meta: 'Bothell · 2h' },
  { id: 'p1', kind: 'proposal', title: 'Cedar privacy fence',   client: 'D. Reyes',    status: 'sent',      meta: 'Kirkland · $8,400' },
  { id: 'p2', kind: 'proposal', title: 'Full reroof — GAF HDZ', client: 'A. Kim',      status: 'viewed',    meta: 'Bellevue · $24,600' },
  { id: 'p3', kind: 'proposal', title: 'Deck rebuild',          client: 'S. Patel',    status: 'draft',     meta: 'Mill Creek · $11,200' },
  { id: 'p4', kind: 'proposal', title: 'Gutter guards',         client: 'D. Pham',     status: 'accepted',  meta: 'Redmond · $1,600' },
  { id: 'l1', kind: 'lead',     title: 'S. Rao',                client: 'S. Rao',      status: 'new',       meta: 'Sammamish · privacy panels' },
  { id: 'l2', kind: 'lead',     title: 'B. Whitaker',           client: 'B. Whitaker', status: 'contacted', meta: 'Kenmore · gutter quote' },
  { id: 'l3', kind: 'lead',     title: 'Northgate Rentals',     client: 'Northgate Rentals', status: 'qualified', meta: 'Everett · 4 units' },
  { id: 'c1', kind: 'client',   title: 'M. Henderson',          client: 'M. Henderson', status: 'active',   meta: '4812 Maple Ave, Bothell' },
  { id: 'c2', kind: 'client',   title: 'K. Nguyen',             client: 'K. Nguyen',   status: 'active',    meta: '1409 Fern St, Bothell' },
  { id: 'c3', kind: 'client',   title: 'Cascade PM',            client: 'Cascade PM',  status: 'active',    meta: 'Redmond · property mgr' },
  { id: 'c4', kind: 'client',   title: 'R. Tran',               client: 'R. Tran',     status: 'active',    meta: '55 Cedar Loop, Bothell' },
];
