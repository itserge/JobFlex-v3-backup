// JOB DETAIL — BLUEPRINT · the shapes both editions read, and nothing else.
import type { RepairFacts } from "@/lib/repairs/server";
import type { CrewBoardData, CrewDoor } from "@/components/v3/crew-board/crew-board-data";
import type { TradeId } from "@/lib/inventory";
//
// ── THIS FILE USED TO BE THE DONOR'S FIXTURE ───────────────────────────────
// It held the demo job ("Roof tear-off & reroof — 4812 Maple Ave"), its crew,
// change orders, photos and expenses, and BOTH editions rendered it for every
// `[id]`. That is gone: the page reads the real Job row now (see
// ./job-detail-load.ts) and this module keeps only what a fixture never was —
// the type of a record, the status vocabulary, and the money formatter.
//
// Nothing here touches the database, so it is safe to import from a client
// component; the load module is the server half and imports these types back.
//
// DATES ARE STRINGS ON PURPOSE. Every field below that reads like a date is
// pre-formatted on the server (same rule as client-detail-data.ts): a `Date`
// formatted inside a client component is formatted twice, once per
// environment, and the first machine whose clock or locale disagreed would
// produce a hydration mismatch.

/** The donor's four status keys. They are the UI vocabulary — the database
 *  column is `Job.status` ("SCHEDULED" | "IN_PROGRESS" | "COMPLETED" |
 *  "CANCELED") and the two maps below are the only place they meet. */
export type StatusKey = "sch" | "prog" | "done" | "can";

/** Donor: `const ST = { … }` — label + status-badge modifier per state. */
export const ST = {
  sch: { l: "Scheduled", cls: "jd-st--sch" },
  prog: { l: "In progress", cls: "" },
  done: { l: "Completed", cls: "jd-st--done" },
  can: { l: "Canceled", cls: "jd-st--can" },
} as const;

/** Donor: the four status buttons, in order. */
export const STATUS_BUTTONS: Array<[StatusKey, string]> = [
  ["sch", "Scheduled"],
  ["prog", "In progress"],
  ["done", "Completed"],
  ["can", "Canceled"],
];

/** `Job.status` values, exactly as `updateJob`'s zod schema accepts them. */
export type JobStatusValue = "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "CANCELED";

export const STATUS_TO_KEY: Record<string, StatusKey> = {
  SCHEDULED: "sch",
  IN_PROGRESS: "prog",
  COMPLETED: "done",
  CANCELED: "can",
};

export const KEY_TO_STATUS: Record<StatusKey, JobStatusValue> = {
  sch: "SCHEDULED",
  prog: "IN_PROGRESS",
  done: "COMPLETED",
  can: "CANCELED",
};

/** Donor: `const fmt = n => '$' + n.toLocaleString('en-US')`. */
export const fmt = (n: number): string => "$" + Math.round(n).toLocaleString("en-US");

/** One JobEvent row — the job's real calendar entries, ascending. */
export type JdEvent = {
  id: string;
  /** JobEvent.title. */
  title: string;
  /** "Aug 11 · 7:00 AM" — pre-formatted (see the header). */
  when: string;
  /** JobEvent.notes, or the span, or null. */
  meta: string | null;
};

/** One JobAssignment row. `state` is the donor's badge vocabulary; DECLINED
 *  gets its own value rather than being folded into "wait" — a crew list that
 *  prints a decline as "Pending" is a crew list that gets someone stood up. */
export type JdCrew = {
  assignmentId: string;
  workerId: string;
  name: string;
  /** What this worker is paid for this job. The office sees every row; a
   *  field worker sees their own figure and 0 on everyone else's (the
   *  loader never selects the others). */
  pay: number;
  /** ISO time the office marked the pay handed over, else null. */
  paidAt: string | null;
  /** "Crew · (425) 555-0134" — role/specialty and phone where known. On the
   *  worker edition the phone is dropped: specialty only (see the loader). */
  meta: string;
  state: "ok" | "wait" | "no";
  /** True on the reader's OWN row. Always false for the office — the crew list
   *  is one of the few places a field worker can check that the office put the
   *  right person on the job. */
  me: boolean;
};

// ── WHO IS READING ────────────────────────────────────────────────────────
// The record is read by two audiences through the SAME components. `canWrite`
// (below) already withheld every control a `requireManager` action would
// reject; `viewer` is the second axis — not "may I write this?" but "may I see
// it at all?". A field worker's record is a NARROWER set of facts: no money
// anywhere (no expenses, no change orders, no proposal total), no roster, and a
// client contact reduced to the name on the door and the address to drive to.
//
// The withholding is done in the LOADER — a worker's record carries empty
// arrays and nulls because those columns were never selected, not because the
// markup hid them — and `viewer` is what the two editions read to drop the tabs
// that would otherwise show an empty Change orders card, and to add the one
// thing only a worker needs: their own standing on the job.

export type JdViewer = "manager" | "worker";

/** The reader's own `JobAssignment.status`. Wider than `JdCrew["state"]` by
 *  one: to a crew "wrapped" and "confirmed" are not the same news, even though
 *  the office's crew list draws both as Confirmed. */
export type JdAssignState = "ok" | "wait" | "no" | "done";

/** The assignment plate's copy. `tone` is the badge modifier WITHOUT its
 *  edition prefix — desktop renders `jd-b--<tone>`, handheld `mjd-b--<tone>` —
 *  so one table serves both stylesheets. */
export const JD_ASSIGN: Record<
  JdAssignState,
  { stamp: string; tone: "ok" | "wait" | "no"; line: string }
> = {
  ok: {
    stamp: "Confirmed",
    tone: "ok",
    line: "You're on this job. Everything the office has on it is on this sheet.",
  },
  wait: {
    stamp: "Pending",
    tone: "wait",
    // There is no accept/decline control on this sheet because there is no
    // session-scoped action to bind one to: every assignment mutation in
    // src/actions/workers.ts goes through requireManager(), and the worker's
    // own path — POST /api/worker/assignment/[assignmentId] — authenticates by
    // `WorkerProfile.token`, which a dashboard session does not carry. So the
    // line says where to confirm rather than offering a button that can only
    // fail. Wiring one would be data-layer work, which needs approval.
    line:
      "The office is waiting on your answer. Open the crew link from your invite " +
      "text or email and tap Accept or Decline there.",
  },
  no: {
    stamp: "Declined",
    tone: "no",
    line: "You declined this job. Message your manager if that wasn't intentional.",
  },
  done: {
    stamp: "Complete",
    tone: "ok",
    line: "This job is wrapped up. Nothing left on it for the crew.",
  },
};

/** One ChangeOrder row. `state` mirrors ChangeOrder.status. */
export type JdChange = {
  id: string;
  /** "CO-1" — positional, the way the donor numbered them. */
  ref: string;
  title: string;
  meta: string;
  amount: number;
  state: "draft" | "sent" | "ok" | "no" | "void";
  /** The client-facing approval token — /co/<token>. */
  publicToken: string;
};

/** One JobPhoto row. `url` may be a data: URL — uploadJobPhoto persists the
 *  data URL inline when Vercel Blob isn't configured. */
export type JdPhoto = {
  id: string;
  url: string;
  /** "Before" / "Progress" / "After", title-cased for the plate. */
  kind: string;
  /** A picture, or a video the crew shot (2026-09-27, lib/jobMediaShared). */
  media: "photo" | "video";
  caption: string;
  /** Who added it, when a trail row names this photo (meta.photoId); else null. */
  by: JdWho | null;
};

/** The member behind a trail row — lib/team/who draws the mark. Null is the system. */
export type JdWho = { id: string; name: string; role: string | null };

/** One ActivityEvent on this job (lib/activityLog): what was done and by whom (2026-09-24). */
export type JdTrailRow = {
  id: string;
  /** TRAIL_KINDS — "PHOTO", "EXPENSE", "JOB", … */
  kind: string;
  /** The one sentence the action wrote. */
  summary: string;
  /** "Aug 11 · 7:00 AM" — pre-formatted (see the header). */
  at: string;
  who: JdWho | null;
};

/** One JobExpense row. */
/**
 * THE JOB'S OWN MONEY (2026-09-20) — office editions only, null for a field
 * worker. Worked out by lib/jobCosting from figures the app already holds:
 * the contract (proposal + approved change orders), what has been collected,
 * the plan (a project job's share of the project's cost budget), the crew's
 * pay and the booked receipts.
 */
export type JdMoney = {
  contract: number;
  /** The contract before sales tax — the profit is worked from it. */
  revenue: number;
  salesTax: number;
  /** Where the plan comes from: the project's cost budget, or none (a lone job has no cost plan). */
  planFrom: "project" | null;
  collected: number;
  outstanding: number;
  plannedCost: number;
  crew: number;
  crewUnpaid: number;
  /** Receipts on review — apart from the cost (stage A, 2026-09-30). */
  expensesPending: number;
  expenses: number;
  /** Warehouse materials issued to the job, at the movements' prices (lib/jobCost). */
  stock: number;
  /** Stock lines with no price anywhere — counted at $0, named so the page can say so. */
  stockUnpriced: string[];
  /** What its come-backs (repairs) cost, and how many there are (lib/jobCost, 2026-11-09). */
  repairs: number;
  repairsCount: number;
  cost: number;
  costIsPlanned: boolean;
  /** False while nothing is booked and there is no plan — the profit is not known yet. */
  costKnown: boolean;
  profit: number;
  marginPct: number;
  plannedProfit: number;
  costVariance: number;
};

/** A warehouse item out on this job: taken when the truck was loaded, and what came back. */
export type JdPicked = { itemId: string; name: string; unit: string; taken: number; returned: number };

export type JdPick = { name: string; unit: string; quantity: number; tracked: boolean; enough: boolean; onHand: number | null; /** Bought per job, not kept on the shelf (lib/inventoryPolicy). */ perJob: boolean };

export type JdExpense = {
  id: string;
  vendor: string;
  meta: string;
  amount: number;
  /** SUBMITTED | APPROVED | REJECTED | REIMBURSED (stage A); only APPROVED and REIMBURSED are in the money card. */
  status: string;
  paidBy: string;
  /** Set when the row was edited after submission. */
  editedAt: string | null;
  /** Who logged it, when a trail row names this expense (meta.expenseId); else null. */
  by: JdWho | null;
};

/** A WorkerProfile the org can still put on this job. */
export type JdWorkerOption = {
  id: string;
  name: string;
  meta: string | null;
};

/** The window "Add to schedule" would book, decided on the server so the
 *  button can name it without a clock read during render. */
export type JdBooking = {
  startsAtISO: string;
  endsAtISO: string;
  /** "Aug 18 · 9:00 AM – 2:00 PM". */
  label: string;
};

export type JobDetailRecord = {
  id: string;
  title: string;
  /** REPAIRS (2026-11-09, lib/repairs/server repairFactsFor): what this repair is (of which job, why, who pays),
   *  and this job's own come-backs. The office's record only. */
  repair?: RepairFacts["repair"];
  comebacks?: RepairFacts["comebacks"];
  /** "Call Nelly first · (425) 555-0101" — the office set it on the proposal (2026-11-10, part 4). */
  callFirst?: string | null;
  status: StatusKey;
  /** Page head: "Aug 11 → Aug 14, 2026", or "No dates yet". */
  dates: string;
  /** No start and no end: a "Scheduled" job is waiting for its dates, and the head says so. */
  undated: boolean;
  /** Overview's Dates cell — the same span, terser. */
  fieldDates: string;
  clientName: string | null;
  scopeOfWork: string | null;
  notes: string | null;
  /** Phone and email are null on the worker edition — the crew gets the name on
   *  the door and the address to drive to, and the office keeps the rest. */
  contact: {
    name: string;
    phone: string | null;
    phoneHref: string | null;
    email: string | null;
    address: string | null;
  } | null;
  /** Google Maps for `contact.address`. Worker edition only: the office is at a
   *  desk, the crew is in a truck. Null when there is no address. */
  directionsUrl: string | null;
  /** Google Calendar template for the job's own span. Worker edition only —
   *  the office books the crew through "Add to schedule", the crew puts the
   *  window in their own phone. Null when the job has no start. */
  calendarUrl: string | null;
  /** Null unless `Job.proposalId` resolves. The proposal section renders ONLY
   *  when this is set — no linked proposal, no section. */
  proposal: { id: string; title: string; total: number } | null;
  /** The project the job belongs to — the head links back to it. Null off a project and on the worker edition. */
  project: { id: string; name: string } | null;
  events: JdEvent[];
  crew: JdCrew[];
  changes: JdChange[];
  photos: JdPhoto[];
  expenses: JdExpense[];
  /** Where the job stands for the crew's buttons (lib/jobProgress, 2026-09-27):
   *  the day a press lands on, whether today is on the clock, days so far. */
  /** The day count (lib/jobProgress); since stage A also the day open today and the days that passed unclosed. */
  progress: { day: number; startedToday: boolean; daysSoFar: number; openDay?: { id?: string; date: string; dayNumber: number; status: string; note?: string | null } | null; pendingDays?: { id?: string; date: string; dayNumber: number; status: string }[] };
  /** The company's file store is on: videos and big photos go straight to it. */
  blobEnabled: boolean;
  /** Who did what on this job, newest first, at most 40 rows — the org's
   *  ActivityEvents whose meta names this job or whose proposal is the job's.
   *  A field worker's record carries no EXPENSE / PAY rows (they name money). */
  trail: JdTrailRow[];
  /** The job's own money — null on a field worker's record. */
  money: JdMoney | null;
  /** What to take from the warehouse for this job (lib/inventory pickList):
   *  every material line of the proposal in whole units, with whether the
   *  shelf has it. Both audiences see it — the crew is who loads the truck. */
  pick: JdPick[];
  /** The trade whose shelf the pick list reads (the Inventory link), else null. */
  pickTrade: TradeId | null;
  /** ISO time the truck was marked loaded, else null. */
  loadedAt: string | null;
  /** The warehouse items out on this job once loaded (for leftovers back). */
  picked: JdPicked[];
  /** Roster minus the workers already on the job. */
  roster: JdWorkerOption[];
  booking: JdBooking;
  /** False for the SALES / ESTIMATOR roles, which requireManager rejects, and
   *  for INSTALLER: the page renders as a record and hides the controls rather
   *  than offering buttons that can only fail. */
  canWrite: boolean;
  /** Photos are crew-writable (2026-08-21): true for the office AND for an
   *  assigned worker, whose edition is otherwise read-only. Gates only the
   *  Photos tab's upload controls; uploadJobPhoto enforces the same rule
   *  server-side. */
  canPhotos: boolean;
  /** Which audience this record was read for — see the block above `JdViewer`.
   *  It decides which SECTIONS exist, where `canWrite` decides which CONTROLS
   *  do; the two are independent (a sales rep is a manager-viewer who cannot
   *  write, a worker is neither). */
  viewer: JdViewer;
  /** The reader's own standing on this job. Set on the worker edition only;
   *  null for the office, which has no assignment of its own to report. */
  assignment: JdAssignState | null;
  /** The reader's own assignment row (worker edition), for Accept / Decline in the portal. */
  myAssignmentId: string | null;
  /** Days on site, the photos and videos by day, the receipts (stage C, 2026-09-30). */
  board: CrewBoardData;
  /** How writes are authenticated: the dashboard session, or the portal's token. */
  door: CrewDoor;
  /** Which frame the page is in: the dashboard (MobileNav on a phone) or the worker portal. */
  chrome: "dashboard" | "portal";
  /** The portal's own bar: whose portal, which company, where "All jobs" is. */
  portal: { workerName: string; orgName: string | null; backHref: string } | null;
  /** On site (the crew build, 2026-11-05): the project's tasks for this stage, the deliveries due, the problems
   *  flagged, the reader's hours today and the weather — lib/crewField fieldOf. Null on the Free plan (owner,
   *  2026-11-09): the crew field tools are a paid feature and are not read. */
  field: import("@/lib/crewField/server").FieldData | null;
};
