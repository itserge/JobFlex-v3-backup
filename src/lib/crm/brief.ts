// THE CRM BRIEF — pure rules, no database.
//
// Two sheets the CRM opens on (owner, 2026-10-13: "help contractors see what
// is going on with client proposals, schedule, payments and more; show daily
// what to check; an office view of how the company is doing and what is
// currently going on"):
//
//   buildToday()  — TODAY: the checks a contractor walks through each morning,
//                   grouped Money → Sales → Schedule → Clients → Team. Every
//                   check names its rows, says what to do, and goes where the
//                   doing happens. Ticks are per person per day (the server
//                   keeps them; this module only reads them).
//   buildOffice() — OFFICE: how the company is doing (money, pipeline, win
//                   rate, week load, team, clients, reviews) and what is going
//                   on right now (crews on site, visits in progress, proposals
//                   being read, money that landed today).
//
// Everything here takes plain rows the server already fetched
// (lib/crm/briefServer) and returns plain figures the sheet draws
// (components/v3/crm-blueprint/crm-brief). scripts/qa/crm-brief.check.ts runs
// the rules on fixtures with hand-checked answers.
//
// Time: every "today" boundary is the VIEWER's day (the `tz` cookie the
// calendar sets, else the org's timezone) — lib/viewerTz. The server passes the
// zone; nothing here reads the machine clock except through `input.now`.

// ─────────────────────────────────────────────────────────────────────────────
// ROWS (what the server hands in)
// ─────────────────────────────────────────────────────────────────────────────

export type ProposalRow = {
  id: string;
  title: string;
  status: string;
  total: number;
  /** Approved change orders on top of the total (lib/contractTotal). */
  extras: number;
  clientId: string | null;
  clientName: string | null;
  ownerId: string | null;
  createdAt: Date;
  sentAt: Date | null;
  viewedAt: Date | null;
  acceptedAt: Date | null;
  declinedAt: Date | null;
  paidAt: Date | null;
  validUntil: Date | null;
  /** A job exists for this proposal (scheduled or not). */
  hasJob: boolean;
};

export type InstallmentRow = {
  id: string;
  proposalId: string;
  label: string;
  amount: number;
  isPercent: boolean;
  position: number;
  status: string;
  dueDate: Date | null;
  paidAt: Date | null;
  paidAmount: number | null;
};

export type PaymentRow = {
  id: string;
  amount: number;
  paidAt: Date | null;
  clientId: string | null;
  clientName: string | null;
  proposalId: string | null;
  method: string | null;
};

export type InvoiceRow = {
  id: string;
  number: string;
  amount: number;
  status: string;
  dueDate: Date | null;
  clientName: string | null;
  proposalId: string | null;
};

export type LeadRow = {
  id: string;
  name: string;
  status: string;
  projectType: string | null;
  createdAt: Date;
  contactedAt: Date | null;
  assignedToId: string | null;
  claimedById: string | null;
  assigneeName: string | null;
};

export type FollowUpRow = { id: string; runAt: Date; proposalId: string | null; clientName: string | null; title: string | null };

export type ChangeOrderRow = {
  id: string;
  title: string;
  total: number;
  sentAt: Date | null;
  proposalId: string | null;
  jobId: string | null;
  clientName: string | null;
};

export type CallRow = {
  id: string;
  direction: string;
  status: string;
  startedAt: Date;
  summary: string | null;
  leadId: string | null;
  leadName: string | null;
  fromNumber: string;
  /** The AI desk's own call to a lead (2026-10-31, lib/aiDesk/leadCalls): how it went — read from the call's state,
   *  since the transcript's summary replaces the words the desk wrote during the call. */
  desk?: "booked" | "reached" | "missed" | "calling" | null;
};

export type BookingRow = { id: string; name: string; serviceLabel: string; startsAt: Date; status: string; createdAt: Date; appointmentId: string | null };

/** A visit on the calendar for a lead (2026-10-31) — any day, so "reached, no visit booked" can tell. */
export type LeadVisitRow = { leadId: string; startsAt: Date; status: string };

export type AppointmentRow = {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  status: string;
  /** The client's or the lead's name. */
  who: string | null;
  clientId: string | null;
  leadId: string | null;
  proposalId: string | null;
  crew: string[];
};

export type JobRow = {
  id: string;
  title: string;
  status: string;
  startsAt: Date | null;
  endsAt: Date | null;
  clientId: string | null;
  clientName: string | null;
  proposalId: string | null;
  updatedAt: Date;
  assignments: { status: string; workerName: string }[];
  hasReviewRequest: boolean;
  hasEvent: boolean;
};

export type JobEventRow = { id: string; jobId: string | null; title: string; startsAt: Date; endsAt: Date };

export type WorkDayRow = { id: string; jobId: string; date: string; status: string; dayNumber: number };

export type PlanVisitRow = { id: string; label: string; dueAt: Date; appointmentId: string | null; clientName: string | null; planName: string };

export type ReviewRow = {
  id: string;
  status: string;
  rating: number | null;
  sentAt: Date | null;
  completedAt: Date | null;
  clientName: string | null;
  jobId: string | null;
};

export type TextRow = { id: string; direction: string; from: string | null; to: string; createdAt: Date; body: string };

export type MemberRow = { userId: string; name: string; role: string };

export type WorkerRow = { id: string; userId: string; name: string };

export type ActivityRow = { id: string; kind: string; summary: string; createdAt: Date; actorId: string | null; clientId: string | null };

export type ClientRow = { id: string; name: string; createdAt: Date };

/** Who is reading: the office sees everything; a sales rep sees the pipeline
 *  and the calendar, never the money; an estimator sees proposals only. */
export type ViewerKind = "office" | "sales" | "estimator";

export type BriefInput = {
  now: Date;
  tz: string;
  viewer: ViewerKind;
  userId: string;
  proposals: ProposalRow[];
  installments: InstallmentRow[];
  /** PAID payments, the last 90 days. */
  payments: PaymentRow[];
  /** Invoices still open. */
  invoices: InvoiceRow[];
  /** Leads still in motion (not WON / LOST). */
  leads: LeadRow[];
  /** Follow-ups not completed. */
  followUps: FollowUpRow[];
  /** Change orders SENT and unanswered. */
  changeOrders: ChangeOrderRow[];
  /** Calls, the last 2 days — the desk's own calls to leads (direction OUTBOUND) among them. */
  calls: CallRow[];
  /** Visits booked for leads, the last 180 days and ahead, canceled ones left out (2026-10-31). */
  leadVisits?: LeadVisitRow[];
  /** Bookings made in the last 2 days or still ahead. */
  bookings: BookingRow[];
  /** From yesterday to eight days out. */
  appointments: AppointmentRow[];
  /** SCHEDULED / IN_PROGRESS, plus COMPLETED in the last 14 days. */
  jobs: JobRow[];
  /** From yesterday to eight days out. */
  jobEvents: JobEventRow[];
  /** Days still OPEN. */
  workDays: WorkDayRow[];
  /** Plan visits still SCHEDULED, due within 14 days. */
  planVisits: PlanVisitRow[];
  /** Review requests, the last 90 days. */
  reviews: ReviewRow[];
  receiptsToReview: number;
  /** Texts, the last 24 hours, both directions. */
  texts: TextRow[];
  members: MemberRow[];
  workers: WorkerRow[];
  /** The trail, newest first, the last 7 days. */
  activity: ActivityRow[];
  clients: ClientRow[];
  /** Check keys this person ticked today. */
  done: string[];
};

// ─────────────────────────────────────────────────────────────────────────────
// WHAT THE SHEET DRAWS
// ─────────────────────────────────────────────────────────────────────────────

export type Tone = "danger" | "warn" | "ok" | "info";
export type CheckGroup = "money" | "sales" | "schedule" | "clients" | "team";

export const GROUP_LABEL: Record<CheckGroup, string> = {
  money: "Money",
  sales: "Sales",
  schedule: "Schedule",
  clients: "Clients",
  team: "Team",
};
export const GROUP_ORDER: CheckGroup[] = ["money", "sales", "schedule", "clients", "team"];

export type CheckItem = {
  label: string;
  sub: string;
  href: string | null;
  amount: number | null;
};

export type TodayCheck = {
  /** Stable across the day — the tick is stored by it. */
  key: string;
  group: CheckGroup;
  tone: Tone;
  /** "3 payments overdue" */
  title: string;
  /** What to do about it, one sentence. */
  why: string;
  count: number;
  amount: number | null;
  /** The button: "Collect", "Call back", "Assign a crew"… */
  cta: string;
  href: string | null;
  /** A tab on the CRM sheet instead of a page. */
  goto: "queue" | "workflows" | "customers" | null;
  items: CheckItem[];
  /** Rows past the first five. */
  more: number;
  done: boolean;
};

export type TodayBrief = {
  dayKey: string;
  heading: string;
  checks: TodayCheck[];
  groups: { key: CheckGroup; label: string; count: number; done: number }[];
  score: { total: number; done: number; open: number };
  /** The one line under the heading. */
  line: string;
};

export type Stat = {
  key: string;
  label: string;
  value: string;
  raw: number;
  sub: string;
  tone: Tone | null;
  /** Against the comparable earlier window, when there is one. */
  delta: { pct: number | null; words: string; tone: Tone } | null;
};

export type NowJob = { id: string; title: string; client: string | null; crew: string[]; started: boolean; day: number | null; href: string };
export type NowVisit = { id: string; title: string; who: string | null; at: string; state: "now" | "next" | "later" | "done"; crew: string[] };

export type OfficeBrief = {
  health: Stat[];
  now: {
    line: string;
    onSite: NowJob[];
    visits: NowVisit[];
    reading: { proposalId: string; title: string; client: string | null; when: string; href: string }[];
    paidToday: { count: number; amount: number };
    crewOut: number;
  };
  funnel: { label: string; steps: { key: string; label: string; count: number; value: number | null }[] };
  cash: { buckets: { key: string; label: string; amount: number; tone: Tone }[]; total: number; undated: number; overdue: number };
  week: { days: { key: string; label: string; num: number; today: boolean; visits: number; jobs: number; hours: number }[]; booked: number; hours: number };
  team: { userId: string; name: string; role: string; sent: number; won: number; wonValue: number; onSite: boolean; leads: number }[];
  clients: { total: number; newThisMonth: number; repeat: number; top: { id: string; name: string; ltv: number; href: string }[]; quiet: number };
  reviews: { avg: number | null; count: number; latest: { client: string | null; rating: number | null; when: string }[] };
  pulse: { id: string; summary: string; when: string; actorId: string | null }[];
};

export type CrmBrief = { today: TodayBrief; office: OfficeBrief | null; viewer: ViewerKind; tz: string };

// ─────────────────────────────────────────────────────────────────────────────
// TIME, IN THE VIEWER'S ZONE
// ─────────────────────────────────────────────────────────────────────────────

const DAY = 86_400_000;

function partsIn(d: Date, tz: string): { y: number; m: number; d: number; h: number; min: number; wd: number } {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
    weekday: "short",
  });
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(d)) p[x.type] = x.value;
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, min: +p.minute, wd: wd < 0 ? 0 : wd };
}

/** "2026-10-14" — the viewer's calendar day of an instant. */
export function dayKeyTz(d: Date, tz: string): string {
  const p = partsIn(d, tz);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

/** The instant the viewer's day began. Found by walking the UTC guess back by
 *  the zone's offset at that moment (DST-safe to the minute). */
export function startOfDayTz(d: Date, tz: string): Date {
  const p = partsIn(d, tz);
  const guess = Date.UTC(p.y, p.m - 1, p.d, 0, 0, 0);
  // Offset at the guess: what the zone says the wall clock is, minus UTC.
  const q = partsIn(new Date(guess), tz);
  const wall = Date.UTC(q.y, q.m - 1, q.d, q.h, q.min);
  const offset = wall - guess;
  return new Date(guess - offset);
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY);
}

export function fmtTime(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(d);
}

export function fmtDay(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric" }).format(d);
}

export function fmtWeekday(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(d);
}

function fmtHeading(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric" }).format(d);
}

/** "2h ago" / "3d ago" / "just now", against `now` rather than the clock. */
export function ago(d: Date, now: Date): string {
  const s = Math.max(0, (now.getTime() - d.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / DAY);
}

/** Whole calendar days from a to b in the viewer's zone: a payment due last
 *  night is "1 day late" this morning, not "0". */
export function calDays(a: Date, b: Date, tz: string): number {
  return Math.round((startOfDayTz(b, tz).getTime() - startOfDayTz(a, tz).getTime()) / DAY);
}

export function money(n: number): string {
  const abs = Math.abs(n);
  const s = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: abs % 1 === 0 ? 0 : 2 }).format(abs);
  return n < 0 ? `−${s}` : s;
}

/** "$12.4K" for the tiles. */
export function moneyShort(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 10_000) return `${sign}$${(abs / 1000).toFixed(abs >= 100_000 ? 0 : 1)}K`;
  return `${sign}${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(abs)}`;
}

const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

// ─────────────────────────────────────────────────────────────────────────────
// LINKS — one place for every route the brief opens
// ─────────────────────────────────────────────────────────────────────────────

export const HREF = {
  proposal: (id: string) => `/dashboard/proposals/${encodeURIComponent(id)}`,
  client: (id: string) => `/dashboard/client-detail?client=${encodeURIComponent(id)}`,
  lead: (id: string) => `/dashboard/leads/${encodeURIComponent(id)}`,
  job: (id: string) => `/dashboard/jobs/${encodeURIComponent(id)}`,
  proposals: "/dashboard/proposals",
  leads: "/dashboard/leads",
  calendar: "/dashboard/calendar",
  jobs: "/dashboard/jobs",
  financials: "/dashboard/financials",
  reviews: "/dashboard/reviews",
  servicePlans: "/dashboard/hvac-estimator/service-desk",
  messages: "/dashboard/messages",
  phone: "/dashboard/phone",
  workers: "/dashboard/workers",
};

// ─────────────────────────────────────────────────────────────────────────────
// MONEY ON A PROPOSAL — the stages, resolved the way lib/paymentSchedule does
// for display: a percent stage is a share of the ORIGINAL total, a fixed stage
// is itself, and a proposal with no stages is one undated stage for the whole.
// ─────────────────────────────────────────────────────────────────────────────

export type Stage = { id: string; proposalId: string; label: string; due: number; dueDate: Date | null; status: string; position: number };

/** An appointment that is (or was) a real stop — not a canceled or no-show one. */
const isVisit = (a: { status: string }) => a.status !== "CANCELED" && a.status !== "NO_SHOW";
const OPEN_STAGE = new Set(["UNPAID", "PENDING"]);
/** A proposal the client has agreed to — money can be owed on it. */
const OWING = new Set(["ACCEPTED", "COMPLETED"]);

export function stagesOf(p: ProposalRow, installments: InstallmentRow[], paidOnProposal: number): Stage[] {
  const own = installments.filter((i) => i.proposalId === p.id).sort((a, b) => a.position - b.position);
  if (own.length === 0) {
    const due = Math.max(0, p.total + p.extras - paidOnProposal);
    return due > 0.005 ? [{ id: `${p.id}:whole`, proposalId: p.id, label: "Full payment", due, dueDate: null, status: "UNPAID", position: 0 }] : [];
  }
  return own.map((i) => {
    const gross = i.isPercent ? (p.total * i.amount) / 100 : i.amount;
    const paid = i.status === "PAID" || i.status === "WAIVED" ? gross : (i.paidAmount ?? 0);
    return { id: i.id, proposalId: p.id, label: i.label, due: Math.max(0, gross - paid), dueDate: i.dueDate, status: i.status, position: i.position };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// TODAY
// ─────────────────────────────────────────────────────────────────────────────

type Draft = Omit<TodayCheck, "done" | "items" | "more"> & { items: CheckItem[] };

function finish(d: Draft, done: Set<string>): TodayCheck {
  const items = d.items.slice(0, 5);
  return { ...d, items, more: Math.max(0, d.items.length - 5), done: done.has(d.key) };
}

export function buildToday(input: BriefInput): TodayBrief {
  const { now, tz, viewer } = input;
  const today = startOfDayTz(now, tz);
  const tomorrow = addDays(today, 1);
  const yesterday = addDays(today, -1);
  const todayKey = dayKeyTz(now, tz);
  const office = viewer === "office";
  const sales = viewer === "sales";
  const done = new Set(input.done);
  const drafts: Draft[] = [];
  const byId = new Map(input.proposals.map((p) => [p.id, p]));
  const nameOf = (p: ProposalRow | undefined) => p?.clientName ?? p?.title ?? "A client";

  // A sales rep or an estimator reads their own book: proposals they own,
  // leads on their desk or still in the shared pool (the leads page's rule).
  const mine = (p: ProposalRow) => office || p.ownerId === input.userId || p.ownerId == null;
  const myLead = (l: LeadRow) => office || !sales || l.assignedToId === input.userId || l.claimedById === input.userId || l.status === "NEW";

  // ── MONEY ────────────────────────────────────────────────────────────────
  if (office) {
    const paidByProposal = new Map<string, number>();
    for (const pay of input.payments) if (pay.proposalId) paidByProposal.set(pay.proposalId, (paidByProposal.get(pay.proposalId) ?? 0) + pay.amount);

    const overdue: CheckItem[] = [];
    const soon: CheckItem[] = [];
    const noDeposit: CheckItem[] = [];
    let overdueSum = 0;
    let soonSum = 0;
    let noDepositSum = 0;
    const in3 = addDays(today, 4); // today + 3 days, exclusive

    for (const p of input.proposals) {
      if (!OWING.has(p.status)) continue;
      const stages = stagesOf(p, input.installments, paidByProposal.get(p.id) ?? 0).filter((s) => OPEN_STAGE.has(s.status) && s.due > 0.005);
      for (const s of stages) {
        if (!s.dueDate) continue;
        if (s.dueDate < today) {
          const late = calDays(s.dueDate, today, tz);
          overdue.push({ label: `${nameOf(p)} · ${s.label}`, sub: `${plural(late, "day")} late · ${p.title}`, href: HREF.proposal(p.id), amount: s.due });
          overdueSum += s.due;
        } else if (s.dueDate < in3) {
          const inDays = calDays(today, s.dueDate, tz);
          soon.push({ label: `${nameOf(p)} · ${s.label}`, sub: `${inDays === 0 ? "due today" : inDays === 1 ? "due tomorrow" : `due in ${inDays} days`} · ${p.title}`, href: HREF.proposal(p.id), amount: s.due });
          soonSum += s.due;
        }
      }
      // Agreed to, nothing paid, and it has sat two days: the deposit is the
      // thing to collect before anyone is scheduled.
      const paid = paidByProposal.get(p.id) ?? 0;
      if (p.status === "ACCEPTED" && paid <= 0.005 && p.acceptedAt && daysBetween(p.acceptedAt, now) >= 2) {
        const first = stagesOf(p, input.installments, 0)[0];
        const ask = first ? first.due : p.total;
        if (first?.dueDate && first.dueDate >= tomorrow) continue;
        noDeposit.push({ label: nameOf(p), sub: `accepted ${ago(p.acceptedAt, now)} · ${first ? first.label : "full payment"} · ${p.title}`, href: HREF.proposal(p.id), amount: ask });
        noDepositSum += ask;
      }
    }
    overdue.sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0));
    soon.sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0));

    const lateInvoices = input.invoices.filter((i) => !["PAID", "VOID", "CANCELED"].includes(i.status) && i.dueDate && i.dueDate < today);
    if (overdue.length || lateInvoices.length) {
      const items = [...overdue, ...lateInvoices.map((i) => ({ label: `${i.clientName ?? "A client"} · invoice ${i.number}`, sub: `${plural(calDays(i.dueDate as Date, today, tz), "day")} late`, href: i.proposalId ? HREF.proposal(i.proposalId) : HREF.financials, amount: i.amount }))];
      const sum = overdueSum + lateInvoices.reduce((a, i) => a + i.amount, 0);
      drafts.push({
        key: "money.overdue",
        group: "money",
        tone: "danger",
        title: `${plural(items.length, "payment")} overdue`,
        why: "Past the date on the schedule. Send the reminder or call — a late balance only gets later.",
        count: items.length,
        amount: sum,
        cta: "Collect",
        href: items.length === 1 ? items[0].href : HREF.proposals,
        goto: null,
        items,
      });
    }
    if (soon.length) {
      drafts.push({
        key: "money.due-soon",
        group: "money",
        tone: "warn",
        title: `${plural(soon.length, "payment")} due in the next 3 days`,
        why: "A heads-up text today is what makes these land on time.",
        count: soon.length,
        amount: soonSum,
        cta: "See the schedule",
        href: soon.length === 1 ? soon[0].href : HREF.proposals,
        goto: null,
        items: soon,
      });
    }
    if (noDeposit.length) {
      drafts.push({
        key: "money.no-deposit",
        group: "money",
        tone: "warn",
        title: `${plural(noDeposit.length, "accepted proposal")} with nothing paid`,
        why: "Accepted two or more days ago and not a dollar on file. Collect the deposit before the crew is booked.",
        count: noDeposit.length,
        amount: noDepositSum,
        cta: "Ask for the deposit",
        href: noDeposit.length === 1 ? noDeposit[0].href : HREF.proposals,
        goto: null,
        items: noDeposit,
      });
    }
    const landed = input.payments.filter((p) => p.paidAt && p.paidAt >= yesterday);
    if (landed.length) {
      const sum = landed.reduce((a, p) => a + p.amount, 0);
      drafts.push({
        key: "money.received",
        group: "money",
        tone: "ok",
        title: `${money(sum)} received since yesterday`,
        why: "Already in. Worth a thank-you text — it is the cheapest review you will ever earn.",
        count: landed.length,
        amount: sum,
        cta: "See payments",
        href: HREF.financials,
        goto: null,
        items: landed
          .slice()
          .sort((a, b) => (b.paidAt?.getTime() ?? 0) - (a.paidAt?.getTime() ?? 0))
          .map((p) => ({ label: p.clientName ?? nameOf(p.proposalId ? byId.get(p.proposalId) : undefined), sub: `${p.paidAt ? ago(p.paidAt, now) : ""}${p.method ? ` · ${p.method.toLowerCase()}` : ""}`, href: p.proposalId ? HREF.proposal(p.proposalId) : HREF.financials, amount: p.amount })),
      });
    }
    if (input.receiptsToReview > 0) {
      drafts.push({
        key: "money.receipts",
        group: "money",
        tone: "info",
        title: `${plural(input.receiptsToReview, "crew receipt")} waiting for review`,
        why: "Approve or bounce them so the job costs stay true and nobody waits on a reimbursement.",
        count: input.receiptsToReview,
        amount: null,
        cta: "Review receipts",
        href: HREF.financials,
        goto: null,
        items: [],
      });
    }
  }

  // ── SALES ────────────────────────────────────────────────────────────────
  if (viewer !== "estimator") {
    // The AI desk's own calls to leads (lib/aiDesk/leadCalls), newest first: what it tried shows on the lead's line.
    const deskCalls = input.calls.filter((c) => c.direction === "OUTBOUND" && c.leadId).sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
    const deskTried = new Map<string, CallRow>();
    for (const c of deskCalls) if (!deskTried.has(c.leadId!)) deskTried.set(c.leadId!, c);

    const uncontacted = input.leads
      .filter((l) => myLead(l) && !l.contactedAt && ["NEW", "ROUTED", "CLAIMED"].includes(l.status) && now.getTime() - l.createdAt.getTime() >= 3_600_000)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    if (uncontacted.length) {
      const oldest = daysBetween(uncontacted[0].createdAt, now);
      drafts.push({
        key: "sales.call-back",
        group: "sales",
        tone: oldest >= 1 ? "danger" : "warn",
        title: `${plural(uncontacted.length, "lead")} not called back`,
        why: "Nobody has reached them yet. The first contractor to call usually gets the job — be that call.",
        count: uncontacted.length,
        amount: null,
        cta: "Call back",
        href: uncontacted.length === 1 ? HREF.lead(uncontacted[0].id) : HREF.leads,
        goto: null,
        items: uncontacted.map((l) => {
          const tried = deskTried.get(l.id);
          return { label: l.name, sub: `${l.projectType ?? "enquiry"} · waiting ${ago(l.createdAt, now).replace(" ago", "")}${tried ? ` · AI desk tried ${ago(tried.startedAt, now)}` : ""}${l.assigneeName ? ` · ${l.assigneeName}` : ""}`, href: HREF.lead(l.id), amount: null };
        }),
      });
    }

    // Reached, but nothing on the calendar (2026-10-31): the step between the first call and a price. A day after
    // the contact, so the call that is booking it right now is not nagged.
    const visited = new Set((input.leadVisits ?? []).filter((v) => v.status !== "CANCELED").map((v) => v.leadId));
    const noVisit = input.leads
      .filter((l) => myLead(l) && (l.contactedAt || l.status === "CONTACTED") && !["QUOTED", "WON", "LOST", "ARCHIVED"].includes(l.status) && !visited.has(l.id) && now.getTime() - (l.contactedAt ?? l.createdAt).getTime() >= 86_400_000)
      .sort((a, b) => (a.contactedAt ?? a.createdAt).getTime() - (b.contactedAt ?? b.createdAt).getTime());
    if (noVisit.length) {
      drafts.push({
        key: "sales.no-visit",
        group: "sales",
        tone: "warn",
        title: `${plural(noVisit.length, "lead")} reached, no visit booked`,
        why: "You've talked — now get on their calendar. Book the visit from the lead's page while the call is fresh.",
        count: noVisit.length,
        amount: null,
        cta: "Book the visit",
        href: noVisit.length === 1 ? HREF.lead(noVisit[0].id) : HREF.leads,
        goto: null,
        items: noVisit.map((l) => ({ label: l.name, sub: `${l.projectType ?? "enquiry"} · reached ${ago(l.contactedAt ?? l.createdAt, now)}${l.assigneeName ? ` · ${l.assigneeName}` : ""}`, href: HREF.lead(l.id), amount: null })),
      });
    }

    // What the AI desk did with new leads since yesterday: the visits it booked, and the people it didn't reach — a
    // person calls those back.
    const deskSince = Array.from(deskTried.values()).filter((c) => c.startedAt >= yesterday && (office || !sales || input.leads.some((l) => l.id === c.leadId && myLead(l))));
    if (deskSince.length) {
      const booked = deskSince.filter((c) => c.desk === "booked");
      const missed = deskSince.filter((c) => c.desk === "missed");
      const how = (c: CallRow) => (c.desk === "booked" ? "booked a visit" : c.desk === "reached" ? "talked with them" : c.desk === "missed" ? "didn't reach them" : c.desk === "calling" ? "calling now" : (c.summary ?? c.status.toLowerCase()));
      drafts.push({
        key: "sales.desk-calls",
        group: "sales",
        tone: missed.length ? "warn" : "ok",
        title: `The AI desk called ${plural(deskSince.length, "lead")}${booked.length ? ` · ${booked.length} booked` : ""}`,
        why: missed.length ? "The ones it didn't reach still need a person — a call from you is the next try." : "Check the visits it booked and the notes it took.",
        count: deskSince.length,
        amount: null,
        cta: missed.length ? "Call them back" : "See the calls",
        href: HREF.phone,
        goto: null,
        items: deskSince.map((c) => ({ label: c.leadName ?? c.fromNumber, sub: `${how(c)} · ${ago(c.startedAt, now)}`, href: HREF.lead(c.leadId!), amount: null })),
      });
    }

    const due = input.followUps.filter((f) => f.runAt <= now).sort((a, b) => a.runAt.getTime() - b.runAt.getTime());
    if (due.length) {
      drafts.push({
        key: "sales.follow-ups",
        group: "sales",
        tone: "danger",
        title: `${plural(due.length, "follow-up")} due`,
        why: "Your own rules scheduled these. Send them or mark them done — a queue that grows stops being read.",
        count: due.length,
        amount: null,
        cta: "Open the queue",
        href: null,
        goto: "queue",
        items: due.map((f) => ({ label: f.clientName ?? "A client", sub: `${f.title ?? "follow-up"} · ${ago(f.runAt, now)}`, href: f.proposalId ? HREF.proposal(f.proposalId) : null, amount: null })),
      });
    }
  }

  const expiring = input.proposals
    .filter((p) => mine(p) && ["SENT", "VIEWED"].includes(p.status) && p.validUntil && p.validUntil >= today && p.validUntil < addDays(today, 4))
    .sort((a, b) => (a.validUntil as Date).getTime() - (b.validUntil as Date).getTime());
  if (expiring.length) {
    drafts.push({
      key: "sales.expiring",
      group: "sales",
      tone: "danger",
      title: `${plural(expiring.length, "proposal")} expiring within 3 days`,
      why: "The price is about to lapse. A call now closes it or extends it — silence lets it die.",
      count: expiring.length,
      amount: expiring.reduce((a, p) => a + p.total, 0),
      cta: "Close or extend",
      href: expiring.length === 1 ? HREF.proposal(expiring[0].id) : HREF.proposals,
      goto: null,
      items: expiring.map((p) => ({ label: nameOf(p), sub: `expires ${fmtDay(p.validUntil as Date, tz)} · ${p.title}`, href: HREF.proposal(p.id), amount: p.total })),
    });
  }

  const expiringIds = new Set(expiring.map((p) => p.id));
  const viewedSilent = input.proposals
    .filter((p) => mine(p) && p.status === "VIEWED" && p.viewedAt && !expiringIds.has(p.id) && daysBetween(p.viewedAt, now) >= 3 && daysBetween(p.viewedAt, now) < 14)
    .sort((a, b) => (a.viewedAt as Date).getTime() - (b.viewedAt as Date).getTime());
  if (viewedSilent.length) {
    drafts.push({
      key: "sales.viewed-silent",
      group: "sales",
      tone: "warn",
      title: `${plural(viewedSilent.length, "proposal")} read, no answer in 3+ days`,
      why: "They opened it and went quiet. That is the moment to call and ask what is holding them.",
      count: viewedSilent.length,
      amount: viewedSilent.reduce((a, p) => a + p.total, 0),
      cta: "Call them",
      href: viewedSilent.length === 1 ? HREF.proposal(viewedSilent[0].id) : HREF.proposals,
      goto: null,
      items: viewedSilent.map((p) => ({ label: nameOf(p), sub: `opened ${ago(p.viewedAt as Date, now)} · ${p.title}`, href: HREF.proposal(p.id), amount: p.total })),
    });
  }

  const sentUnseen = input.proposals
    .filter((p) => mine(p) && p.status === "SENT" && p.sentAt && !expiringIds.has(p.id) && daysBetween(p.sentAt, now) >= 2 && daysBetween(p.sentAt, now) < 14)
    .sort((a, b) => (a.sentAt as Date).getTime() - (b.sentAt as Date).getTime());
  if (sentUnseen.length) {
    drafts.push({
      key: "sales.sent-unseen",
      group: "sales",
      tone: "warn",
      title: `${plural(sentUnseen.length, "proposal")} sent, not opened in 2+ days`,
      why: "It may be sitting in a spam folder. A text with the link gets it opened.",
      count: sentUnseen.length,
      amount: sentUnseen.reduce((a, p) => a + p.total, 0),
      cta: "Nudge",
      href: sentUnseen.length === 1 ? HREF.proposal(sentUnseen[0].id) : HREF.proposals,
      goto: null,
      items: sentUnseen.map((p) => ({ label: nameOf(p), sub: `sent ${ago(p.sentAt as Date, now)} · ${p.title}`, href: HREF.proposal(p.id), amount: p.total })),
    });
  }

  if (office) {
    const cos = input.changeOrders.filter((c) => c.sentAt && daysBetween(c.sentAt, now) >= 2).sort((a, b) => (a.sentAt as Date).getTime() - (b.sentAt as Date).getTime());
    if (cos.length) {
      drafts.push({
        key: "sales.change-orders",
        group: "sales",
        tone: "warn",
        title: `${plural(cos.length, "change order")} waiting on the client`,
        why: "Sent two or more days ago and not signed. The crew cannot do the extra work until it is.",
        count: cos.length,
        amount: cos.reduce((a, c) => a + c.total, 0),
        cta: "Chase it",
        href: cos.length === 1 && cos[0].jobId ? HREF.job(cos[0].jobId) : HREF.jobs,
        goto: null,
        items: cos.map((c) => ({ label: `${c.clientName ?? "A client"} · ${c.title}`, sub: `sent ${ago(c.sentAt as Date, now)}`, href: c.jobId ? HREF.job(c.jobId) : c.proposalId ? HREF.proposal(c.proposalId) : HREF.jobs, amount: c.total })),
      });
    }
  }

  if (viewer !== "estimator") {
    // The rows say INBOUND (lib/aiPhoneCalls); "IN" was never written, so this check never fired before 2026-10-31.
    const missed = input.calls
      .filter((c) => (c.direction === "INBOUND" || c.direction === "IN") && c.startedAt >= yesterday && !c.leadId)
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
    if (missed.length) {
      drafts.push({
        key: "sales.calls",
        group: "sales",
        tone: "warn",
        title: `${plural(missed.length, "call")} since yesterday with no lead on file`,
        why: "The phone answered them; nobody has. Read the summary and ring back.",
        count: missed.length,
        amount: null,
        cta: "Return the call",
        href: HREF.phone,
        goto: null,
        items: missed.map((c) => ({ label: c.leadName ?? c.fromNumber, sub: `${c.summary ?? c.status.toLowerCase()} · ${ago(c.startedAt, now)}`, href: HREF.phone, amount: null })),
      });
    }

    const newBookings = input.bookings
      .filter((b) => ["BOOKED", "RESCHEDULED"].includes(b.status) && b.createdAt >= yesterday)
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    if (newBookings.length) {
      drafts.push({
        key: "sales.bookings",
        group: "sales",
        tone: "info",
        title: `${plural(newBookings.length, "new booking")} from the website`,
        why: "They picked a slot themselves. A one-line confirmation text makes it real for them.",
        count: newBookings.length,
        amount: null,
        cta: "Confirm",
        href: HREF.calendar,
        goto: null,
        items: newBookings.map((b) => ({ label: b.name, sub: `${b.serviceLabel} · ${fmtWeekday(b.startsAt, tz)} ${fmtDay(b.startsAt, tz)} ${fmtTime(b.startsAt, tz)}`, href: HREF.calendar, amount: null })),
      });
    }
  }

  const staleDrafts = input.proposals.filter((p) => mine(p) && p.status === "DRAFT" && daysBetween(p.createdAt, now) >= 7);
  if (staleDrafts.length) {
    drafts.push({
      key: "sales.stale-drafts",
      group: "sales",
      tone: "info",
      title: `${plural(staleDrafts.length, "draft")} older than a week`,
      why: "Finish and send, or archive — a draft nobody sends is a lead nobody priced.",
      count: staleDrafts.length,
      amount: staleDrafts.reduce((a, p) => a + p.total, 0),
      cta: "Finish or archive",
      href: staleDrafts.length === 1 ? HREF.proposal(staleDrafts[0].id) : HREF.proposals,
      goto: null,
      items: staleDrafts.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).map((p) => ({ label: nameOf(p), sub: `started ${ago(p.createdAt, now)} · ${p.title}`, href: HREF.proposal(p.id), amount: p.total || null })),
    });
  }

  // ── SCHEDULE ─────────────────────────────────────────────────────────────
  if (viewer !== "estimator") {
    const visitsToday = input.appointments
      .filter((a) => isVisit(a) && a.startsAt >= today && a.startsAt < tomorrow)
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    if (visitsToday.length) {
      drafts.push({
        key: "schedule.visits-today",
        group: "schedule",
        tone: "info",
        title: `${plural(visitsToday.length, "visit")} today`,
        why: "Who is where. Confirm the first one by text before you leave.",
        count: visitsToday.length,
        amount: null,
        cta: "Open the calendar",
        href: HREF.calendar,
        goto: null,
        items: visitsToday.map((a) => ({ label: `${fmtTime(a.startsAt, tz)} · ${a.who ?? a.title}`, sub: `${a.title}${a.crew.length ? ` · ${a.crew.join(", ")}` : ""}`, href: a.proposalId ? HREF.proposal(a.proposalId) : a.leadId ? HREF.lead(a.leadId) : a.clientId ? HREF.client(a.clientId) : HREF.calendar, amount: null })),
      });
    }
  }

  if (office) {
    const eventsToday = input.jobEvents.filter((e) => e.startsAt >= today && e.startsAt < tomorrow);
    const jobsToday = new Map<string, JobRow>();
    for (const e of eventsToday) {
      const j = e.jobId ? input.jobs.find((x) => x.id === e.jobId) : undefined;
      if (j) jobsToday.set(j.id, j);
    }
    for (const j of input.jobs) if (j.status === "IN_PROGRESS") jobsToday.set(j.id, j);
    const openToday = new Set(input.workDays.filter((w) => w.status === "OPEN" && w.date === todayKey).map((w) => w.jobId));
    const jobsOn = [...jobsToday.values()];
    if (jobsOn.length) {
      const unconfirmed = jobsOn.filter((j) => j.assignments.length === 0 || j.assignments.some((a) => a.status === "PENDING"));
      drafts.push({
        key: "schedule.jobs-today",
        group: "schedule",
        tone: unconfirmed.length ? "warn" : "info",
        title: `${plural(jobsOn.length, "job")} on site today${unconfirmed.length ? ` · ${unconfirmed.length} crew unconfirmed` : ""}`,
        why: unconfirmed.length ? "A crew that never accepted the invite may not show. Ping them before the morning is gone." : "Crews are confirmed. Check in when the first day opens.",
        count: jobsOn.length,
        amount: null,
        cta: unconfirmed.length ? "Ping the crew" : "Open the jobs",
        href: jobsOn.length === 1 ? HREF.job(jobsOn[0].id) : HREF.jobs,
        goto: null,
        items: jobsOn.map((j) => {
          const acc = j.assignments.filter((a) => a.status === "ACCEPTED" || a.status === "COMPLETED").map((a) => a.workerName);
          const pend = j.assignments.filter((a) => a.status === "PENDING").map((a) => a.workerName);
          return { label: `${j.title}${j.clientName ? ` · ${j.clientName}` : ""}`, sub: `${openToday.has(j.id) ? "on site now" : "not started"}${acc.length ? ` · ${acc.join(", ")}` : ""}${pend.length ? ` · waiting on ${pend.join(", ")}` : j.assignments.length === 0 ? " · no crew" : ""}`, href: HREF.job(j.id), amount: null };
        }),
      });
    }

    const in7 = addDays(today, 8);
    const unstaffed = input.jobs
      .filter((j) => j.status === "SCHEDULED" && j.startsAt && j.startsAt >= today && j.startsAt < in7 && !j.assignments.some((a) => a.status === "ACCEPTED"))
      .sort((a, b) => (a.startsAt as Date).getTime() - (b.startsAt as Date).getTime());
    if (unstaffed.length) {
      drafts.push({
        key: "schedule.unstaffed",
        group: "schedule",
        tone: "danger",
        title: `${plural(unstaffed.length, "job")} this week with no crew confirmed`,
        why: "Starts within seven days and nobody has accepted it. Assign a crew today, not the night before.",
        count: unstaffed.length,
        amount: null,
        cta: "Assign a crew",
        href: unstaffed.length === 1 ? HREF.job(unstaffed[0].id) : HREF.calendar,
        goto: null,
        items: unstaffed.map((j) => ({ label: `${j.title}${j.clientName ? ` · ${j.clientName}` : ""}`, sub: `${fmtWeekday(j.startsAt as Date, tz)} ${fmtDay(j.startsAt as Date, tz)} · ${j.assignments.some((a) => a.status === "PENDING") ? "invite not answered" : "no crew yet"}`, href: HREF.job(j.id), amount: null })),
      });
    }

    const unscheduled = input.proposals
      .filter((p) => p.status === "ACCEPTED" && !p.hasJob && p.acceptedAt && daysBetween(p.acceptedAt, now) >= 3)
      .sort((a, b) => (a.acceptedAt as Date).getTime() - (b.acceptedAt as Date).getTime());
    if (unscheduled.length) {
      drafts.push({
        key: "schedule.unscheduled",
        group: "schedule",
        tone: "warn",
        title: `${plural(unscheduled.length, "accepted proposal")} not on the calendar`,
        why: "Signed three or more days ago and no job made. Put a start date on it while the client is still excited.",
        count: unscheduled.length,
        amount: unscheduled.reduce((a, p) => a + p.total, 0),
        cta: "Schedule it",
        href: unscheduled.length === 1 ? HREF.proposal(unscheduled[0].id) : HREF.proposals,
        goto: null,
        items: unscheduled.map((p) => ({ label: nameOf(p), sub: `accepted ${ago(p.acceptedAt as Date, now)} · ${p.title}`, href: HREF.proposal(p.id), amount: p.total })),
      });
    }

    const visitsDue = input.planVisits
      .filter((v) => !v.appointmentId && v.dueAt < addDays(today, 8))
      .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
    if (visitsDue.length) {
      drafts.push({
        key: "schedule.plan-visits",
        group: "schedule",
        tone: "warn",
        title: `${plural(visitsDue.length, "service visit")} due with no appointment`,
        why: "Members paid for these visits. Book them before the due date passes.",
        count: visitsDue.length,
        amount: null,
        cta: "Book the visit",
        href: HREF.servicePlans,
        goto: null,
        items: visitsDue.map((v) => ({ label: `${v.clientName ?? "A member"} · ${v.label}`, sub: `${v.planName} · due ${v.dueAt < today ? `${plural(calDays(v.dueAt, today, tz), "day")} ago` : fmtDay(v.dueAt, tz)}`, href: HREF.servicePlans, amount: null })),
      });
    }

    const dayAfter = addDays(today, 2);
    const tmrw = [
      ...input.appointments.filter((a) => a.status === "SCHEDULED" && a.startsAt >= tomorrow && a.startsAt < dayAfter).map((a) => ({ at: a.startsAt, label: a.who ?? a.title })),
      ...input.jobEvents.filter((e) => e.startsAt >= tomorrow && e.startsAt < dayAfter).map((e) => ({ at: e.startsAt, label: e.title })),
    ].sort((a, b) => a.at.getTime() - b.at.getTime());
    if (tmrw.length) {
      drafts.push({
        key: "schedule.tomorrow",
        group: "schedule",
        tone: "info",
        title: `Tomorrow: ${plural(tmrw.length, "stop")}, first at ${fmtTime(tmrw[0].at, tz)}`,
        why: "Send tonight's reminders and load the truck for the first stop.",
        count: tmrw.length,
        amount: null,
        cta: "See tomorrow",
        href: HREF.calendar,
        goto: null,
        items: tmrw.map((t) => ({ label: `${fmtTime(t.at, tz)} · ${t.label}`, sub: "", href: HREF.calendar, amount: null })),
      });
    }
  }

  // ── CLIENTS ──────────────────────────────────────────────────────────────
  if (office) {
    const since14 = addDays(today, -14);
    const noReview = input.jobs
      .filter((j) => j.status === "COMPLETED" && j.updatedAt >= since14 && !j.hasReviewRequest)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    if (noReview.length) {
      drafts.push({
        key: "clients.ask-review",
        group: "clients",
        tone: "warn",
        title: `${plural(noReview.length, "finished job")} with no review asked`,
        why: "Finished in the last two weeks. Ask while the new work is still what they see every day.",
        count: noReview.length,
        amount: null,
        cta: "Ask for a review",
        href: noReview.length === 1 ? HREF.job(noReview[0].id) : HREF.reviews,
        goto: null,
        items: noReview.map((j) => ({ label: `${j.clientName ?? "A client"} · ${j.title}`, sub: `finished ${ago(j.updatedAt, now)}`, href: HREF.job(j.id), amount: null })),
      });
    }

    const fresh = input.reviews.filter((r) => r.status === "COMPLETED" && r.completedAt && r.completedAt >= yesterday).sort((a, b) => (b.completedAt as Date).getTime() - (a.completedAt as Date).getTime());
    if (fresh.length) {
      const rated = fresh.filter((r) => r.rating != null);
      const avg = rated.length ? rated.reduce((a, r) => a + (r.rating as number), 0) / rated.length : null;
      drafts.push({
        key: "clients.reviews-in",
        group: "clients",
        tone: avg != null && avg < 4 ? "warn" : "ok",
        title: `${plural(fresh.length, "new review")}${avg != null ? ` · ${avg.toFixed(1)} ★` : ""}`,
        why: avg != null && avg < 4 ? "One of them is not happy. Call before it goes public." : "Say thank you and share the good ones.",
        count: fresh.length,
        amount: null,
        cta: "Read them",
        href: HREF.reviews,
        goto: null,
        items: fresh.map((r) => ({ label: r.clientName ?? "A client", sub: `${r.rating != null ? `${r.rating} ★ · ` : ""}${ago(r.completedAt as Date, now)}`, href: r.jobId ? HREF.job(r.jobId) : HREF.reviews, amount: null })),
      });
    }

    const inbound = input.texts.filter((t) => t.direction === "IN" && t.createdAt >= addDays(now, -1));
    const unanswered = inbound.filter((t) => !input.texts.some((o) => o.direction === "OUT" && o.to === t.from && o.createdAt > t.createdAt));
    if (unanswered.length) {
      drafts.push({
        key: "clients.texts",
        group: "clients",
        tone: "warn",
        title: `${plural(unanswered.length, "text")} with no reply`,
        why: "A client wrote and nobody wrote back. Answer before lunch.",
        count: unanswered.length,
        amount: null,
        cta: "Reply",
        href: HREF.messages,
        goto: null,
        items: unanswered.map((t) => ({ label: t.from ?? "Unknown number", sub: `${t.body.slice(0, 70)}${t.body.length > 70 ? "…" : ""} · ${ago(t.createdAt, now)}`, href: HREF.messages, amount: null })),
      });
    }

    const lastTouch = new Map<string, Date>();
    for (const a of input.activity) if (a.clientId && !lastTouch.has(a.clientId)) lastTouch.set(a.clientId, a.createdAt);
    const quiet = input.proposals
      .filter((p) => ["SENT", "VIEWED"].includes(p.status) && p.clientId)
      .filter((p) => {
        const t = lastTouch.get(p.clientId as string) ?? p.viewedAt ?? p.sentAt ?? p.createdAt;
        return daysBetween(t, now) >= 14;
      });
    if (quiet.length) {
      drafts.push({
        key: "clients.quiet",
        group: "clients",
        tone: "info",
        title: `${plural(quiet.length, "open proposal")} gone quiet for 2+ weeks`,
        why: "No touch either way in two weeks. Close it out or win it back — an open book that is not open is a lie to yourself.",
        count: quiet.length,
        amount: quiet.reduce((a, p) => a + p.total, 0),
        cta: "Decide",
        href: HREF.proposals,
        goto: "customers",
        items: quiet.map((p) => ({ label: nameOf(p), sub: `${p.title} · ${p.status.toLowerCase()}`, href: HREF.proposal(p.id), amount: p.total })),
      });
    }
  }

  // ── TEAM ─────────────────────────────────────────────────────────────────
  if (office) {
    const stale = input.jobs.flatMap((j) => j.assignments.filter((a) => a.status === "PENDING").map((a) => ({ job: j, worker: a.workerName })));
    const staleJobs = stale.filter((s) => s.job.status !== "COMPLETED" && s.job.status !== "CANCELED");
    if (staleJobs.length) {
      drafts.push({
        key: "team.invites",
        group: "team",
        tone: "warn",
        title: `${plural(staleJobs.length, "crew invite")} not answered`,
        why: "The worker has not accepted. A text beats waiting on the app.",
        count: staleJobs.length,
        amount: null,
        cta: "Ping them",
        href: HREF.workers,
        goto: null,
        items: staleJobs.map((s) => ({ label: s.worker, sub: `${s.job.title}${s.job.startsAt ? ` · ${fmtWeekday(s.job.startsAt, tz)} ${fmtDay(s.job.startsAt, tz)}` : ""}`, href: HREF.job(s.job.id), amount: null })),
      });
    }

    const openOld = input.workDays.filter((w) => w.status === "OPEN" && w.date < todayKey);
    if (openOld.length) {
      drafts.push({
        key: "team.open-days",
        group: "team",
        tone: "warn",
        title: `${plural(openOld.length, "work day")} never closed`,
        why: "Opened on site and left open. Close it with a note so the day's photos file to the right day.",
        count: openOld.length,
        amount: null,
        cta: "Close the day",
        href: openOld.length === 1 ? HREF.job(openOld[0].jobId) : HREF.jobs,
        goto: null,
        items: openOld.map((w) => {
          const j = input.jobs.find((x) => x.id === w.jobId);
          return { label: j?.title ?? "A job", sub: `day ${w.dayNumber} · ${w.date}`, href: HREF.job(w.jobId), amount: null };
        }),
      });
    }
  }

  // ── ASSEMBLE ─────────────────────────────────────────────────────────────
  const toneRank: Record<Tone, number> = { danger: 0, warn: 1, info: 2, ok: 3 };
  const checks = drafts
    .map((d) => finish(d, done))
    .sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) || toneRank[a.tone] - toneRank[b.tone]);
  const groups = GROUP_ORDER.map((g) => ({ key: g, label: GROUP_LABEL[g], count: checks.filter((c) => c.group === g).length, done: checks.filter((c) => c.group === g && c.done).length })).filter((g) => g.count > 0);
  const total = checks.length;
  const doneN = checks.filter((c) => c.done).length;
  const urgent = checks.filter((c) => c.tone === "danger" && !c.done).length;
  const line =
    total === 0
      ? "Nothing waiting on you. Go build something."
      : doneN === total
        ? `All ${total} checked. Desk is clear.`
        : urgent
          ? `${plural(total - doneN, "thing")} to check · ${urgent} can't wait`
          : `${plural(total - doneN, "thing")} to check · nothing on fire`;

  return { dayKey: todayKey, heading: fmtHeading(now, tz), checks, groups, score: { total, done: doneN, open: total - doneN }, line };
}

// ─────────────────────────────────────────────────────────────────────────────
// OFFICE
// ─────────────────────────────────────────────────────────────────────────────

const WON = new Set(["ACCEPTED", "COMPLETED", "PAID"]);
const LOST = new Set(["DECLINED", "EXPIRED"]);

function delta(cur: number, prev: number, goodUp = true): Stat["delta"] {
  if (prev <= 0 && cur <= 0) return null;
  if (prev <= 0) return { pct: null, words: "new this period", tone: "info" };
  const pct = Math.round(((cur - prev) / prev) * 100);
  const up = pct >= 0;
  const flat = Math.abs(pct) < 3;
  return { pct, words: flat ? "about the same" : `${up ? "up" : "down"} ${Math.abs(pct)}%`, tone: flat ? "info" : up === goodUp ? "ok" : "danger" };
}

export function buildOffice(input: BriefInput): OfficeBrief {
  const { now, tz } = input;
  const today = startOfDayTz(now, tz);
  const tomorrow = addDays(today, 1);
  const todayKey = dayKeyTz(now, tz);
  const p = partsIn(now, tz);
  const monthStart = startOfDayTz(new Date(Date.UTC(p.y, p.m - 1, 1, 12)), tz);
  const lastMonthStart = startOfDayTz(new Date(Date.UTC(p.y, p.m - 2, 1, 12)), tz);
  const dayOfMonth = p.d;
  const lastMonthSameDay = addDays(lastMonthStart, dayOfMonth); // exclusive end of the comparable slice
  const d30 = addDays(now, -30);
  const d60 = addDays(now, -60);
  const d90 = addDays(now, -90);
  const d7 = addDays(now, -7);

  const paid = input.payments.filter((x) => x.paidAt) as (PaymentRow & { paidAt: Date })[];
  const sum = (rows: { amount: number }[]) => rows.reduce((a, r) => a + r.amount, 0);
  const mtd = sum(paid.filter((x) => x.paidAt >= monthStart));
  const lastMtd = sum(paid.filter((x) => x.paidAt >= lastMonthStart && x.paidAt < lastMonthSameDay));
  const week = sum(paid.filter((x) => x.paidAt >= d7));
  const prevWeek = sum(paid.filter((x) => x.paidAt >= addDays(now, -14) && x.paidAt < d7));

  // What is still owed on every agreed proposal, and how much of it is late.
  const paidByProposal = new Map<string, number>();
  for (const x of input.payments) if (x.proposalId) paidByProposal.set(x.proposalId, (paidByProposal.get(x.proposalId) ?? 0) + x.amount);
  let outstanding = 0;
  let overdue = 0;
  let undated = 0;
  const weekBuckets = [0, 0, 0, 0, 0, 0];
  for (const pr of input.proposals) {
    if (!OWING.has(pr.status)) continue;
    for (const s of stagesOf(pr, input.installments, paidByProposal.get(pr.id) ?? 0)) {
      if (!OPEN_STAGE.has(s.status) || s.due <= 0.005) continue;
      outstanding += s.due;
      if (!s.dueDate) undated += s.due;
      else if (s.dueDate < today) overdue += s.due;
      else {
        const w = Math.min(5, Math.floor(daysBetween(today, s.dueDate) / 7));
        weekBuckets[w] += s.due;
      }
    }
  }

  const openPipe = input.proposals.filter((x) => ["SENT", "VIEWED"].includes(x.status));
  const pipeline = sum(openPipe.map((x) => ({ amount: x.total })));

  const decided90 = input.proposals.filter((x) => (WON.has(x.status) && x.acceptedAt && x.acceptedAt >= d90) || (LOST.has(x.status) && (x.declinedAt ?? x.validUntil ?? x.createdAt) >= d90));
  const won90 = decided90.filter((x) => WON.has(x.status));
  const winRate = decided90.length ? Math.round((won90.length / decided90.length) * 100) : null;
  const decidedPrev = input.proposals.filter((x) => (WON.has(x.status) && x.acceptedAt && x.acceptedAt >= addDays(now, -180) && x.acceptedAt < d90) || (LOST.has(x.status) && (x.declinedAt ?? x.createdAt) >= addDays(now, -180) && (x.declinedAt ?? x.createdAt) < d90));
  const winPrev = decidedPrev.length ? Math.round((decidedPrev.filter((x) => WON.has(x.status)).length / decidedPrev.length) * 100) : 0;

  const accepted90 = input.proposals.filter((x) => x.acceptedAt && x.sentAt && x.acceptedAt >= d90);
  const daysToYes = accepted90.length ? accepted90.reduce((a, x) => a + ((x.acceptedAt as Date).getTime() - (x.sentAt as Date).getTime()) / DAY, 0) / accepted90.length : null;

  const inProgress = input.jobs.filter((j) => j.status === "IN_PROGRESS").length;
  const scheduled = input.jobs.filter((j) => j.status === "SCHEDULED").length;

  const leads30 = input.leads.filter((l) => l.createdAt >= d30).length;
  const leadsPrev = input.leads.filter((l) => l.createdAt >= d60 && l.createdAt < d30).length;

  const in7 = addDays(today, 7);
  const weekVisits = input.appointments.filter((a) => isVisit(a) && a.startsAt >= today && a.startsAt < in7);
  const weekEvents = input.jobEvents.filter((e) => e.startsAt >= today && e.startsAt < in7);
  const hoursOf = (rows: { startsAt: Date; endsAt: Date }[]) => rows.reduce((a, r) => a + Math.max(0, r.endsAt.getTime() - r.startsAt.getTime()) / 3_600_000, 0);
  const weekHours = hoursOf(weekVisits) + hoursOf(weekEvents);

  const health: Stat[] = [
    { key: "mtd", label: "Collected this month", value: moneyShort(mtd), raw: mtd, sub: `${money(lastMtd)} by this day last month`, tone: null, delta: delta(mtd, lastMtd) },
    { key: "week", label: "Collected, 7 days", value: moneyShort(week), raw: week, sub: `${money(prevWeek)} the week before`, tone: null, delta: delta(week, prevWeek) },
    { key: "outstanding", label: "Still owed", value: moneyShort(outstanding), raw: outstanding, sub: overdue > 0 ? `${money(overdue)} of it overdue` : undated > 0 ? `${money(undated)} with no due date` : "on schedule", tone: overdue > 0 ? "danger" : null, delta: null },
    { key: "pipeline", label: "Out for decision", value: moneyShort(pipeline), raw: pipeline, sub: `${plural(openPipe.length, "proposal")} sent or opened`, tone: null, delta: null },
    { key: "win", label: "Win rate, 90 days", value: winRate == null ? "—" : `${winRate}%`, raw: winRate ?? 0, sub: decided90.length ? `${won90.length} won of ${decided90.length} decided` : "nothing decided yet", tone: null, delta: decided90.length && decidedPrev.length ? delta(winRate ?? 0, winPrev) : null },
    { key: "yes", label: "Days to a yes", value: daysToYes == null ? "—" : daysToYes < 1 ? "<1" : daysToYes.toFixed(daysToYes < 10 ? 1 : 0), raw: daysToYes ?? 0, sub: accepted90.length ? `across ${plural(accepted90.length, "accepted proposal")}` : "no accepted proposals yet", tone: null, delta: null },
    { key: "jobs", label: "Jobs in motion", value: String(inProgress + scheduled), raw: inProgress + scheduled, sub: `${inProgress} in progress · ${scheduled} scheduled`, tone: null, delta: null },
    { key: "leads", label: "New leads, 30 days", value: String(leads30), raw: leads30, sub: `${leadsPrev} the 30 days before`, tone: null, delta: delta(leads30, leadsPrev) },
  ];

  // ── Right now ──────────────────────────────────────────────────────────
  const openDays = input.workDays.filter((w) => w.status === "OPEN" && w.date === todayKey);
  const openByJob = new Map(openDays.map((w) => [w.jobId, w]));
  const eventsToday = input.jobEvents.filter((e) => e.startsAt >= today && e.startsAt < tomorrow);
  const onSiteIds = new Set<string>([...openDays.map((w) => w.jobId), ...eventsToday.map((e) => e.jobId).filter((x): x is string => !!x), ...input.jobs.filter((j) => j.status === "IN_PROGRESS").map((j) => j.id)]);
  const onSite: NowJob[] = [...onSiteIds]
    .map((id) => input.jobs.find((j) => j.id === id))
    .filter((j): j is JobRow => !!j)
    .map((j) => ({ id: j.id, title: j.title, client: j.clientName, crew: j.assignments.filter((a) => a.status === "ACCEPTED" || a.status === "COMPLETED").map((a) => a.workerName), started: openByJob.has(j.id), day: openByJob.get(j.id)?.dayNumber ?? null, href: HREF.job(j.id) }))
    .sort((a, b) => Number(b.started) - Number(a.started));
  const crewOut = new Set(onSite.filter((j) => j.started).flatMap((j) => j.crew)).size;

  const visits: NowVisit[] = input.appointments
    .filter((a) => isVisit(a) && a.startsAt >= today && a.startsAt < tomorrow)
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
    .map((a) => {
      const state: NowVisit["state"] = a.status === "COMPLETED" || a.endsAt <= now ? "done" : a.startsAt <= now ? "now" : "later";
      return { id: a.id, title: a.title, who: a.who, at: fmtTime(a.startsAt, tz), state, crew: a.crew };
    });
  const firstLater = visits.find((v) => v.state === "later");
  if (firstLater) firstLater.state = "next";

  const reading = input.proposals
    .filter((x) => x.viewedAt && x.viewedAt >= today && ["SENT", "VIEWED"].includes(x.status))
    .sort((a, b) => (b.viewedAt as Date).getTime() - (a.viewedAt as Date).getTime())
    .slice(0, 5)
    .map((x) => ({ proposalId: x.id, title: x.title, client: x.clientName, when: ago(x.viewedAt as Date, now), href: HREF.proposal(x.id) }));

  const paidTodayRows = paid.filter((x) => x.paidAt >= today);
  const paidToday = { count: paidTodayRows.length, amount: sum(paidTodayRows) };

  const nowVisits = visits.filter((v) => v.state === "now").length;
  const nowLine = [
    onSite.filter((j) => j.started).length ? `${plural(onSite.filter((j) => j.started).length, "crew")} on site` : onSite.length ? `${plural(onSite.length, "job")} today, none started` : "no crews out",
    nowVisits ? `${plural(nowVisits, "visit")} in progress` : firstLater ? `next visit ${firstLater.at}` : visits.length ? "visits done" : "no visits today",
    paidToday.count ? `${money(paidToday.amount)} in today` : null,
    reading.length ? `${plural(reading.length, "proposal")} being read` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  // ── Funnel, 30 days ────────────────────────────────────────────────────
  const leadsIn = input.leads.filter((l) => l.createdAt >= d30);
  const contacted = leadsIn.filter((l) => l.contactedAt || !["NEW", "ROUTED", "CLAIMED"].includes(l.status));
  const visitedIds = new Set((input.leadVisits ?? []).filter((v) => v.status !== "CANCELED").map((v) => v.leadId));
  const visited = leadsIn.filter((l) => visitedIds.has(l.id));
  const sent30 = input.proposals.filter((x) => x.sentAt && x.sentAt >= d30);
  const won30 = input.proposals.filter((x) => x.acceptedAt && x.acceptedAt >= d30);
  const paid30 = paid.filter((x) => x.paidAt >= d30);
  const funnel = {
    label: "Last 30 days",
    steps: [
      { key: "leads", label: "Leads in", count: leadsIn.length, value: null },
      { key: "contacted", label: "Contacted", count: contacted.length, value: null },
      { key: "visited", label: "Visit booked", count: visited.length, value: null },
      { key: "sent", label: "Proposals sent", count: sent30.length, value: sum(sent30.map((x) => ({ amount: x.total }))) },
      { key: "won", label: "Won", count: won30.length, value: sum(won30.map((x) => ({ amount: x.total }))) },
      { key: "paid", label: "Paid", count: new Set(paid30.map((x) => x.proposalId ?? x.id)).size, value: sum(paid30) },
    ],
  };

  // ── Cash ahead ─────────────────────────────────────────────────────────
  const cash = {
    buckets: [
      { key: "overdue", label: "Overdue", amount: overdue, tone: (overdue > 0 ? "danger" : "info") as Tone },
      ...weekBuckets.map((amt, i) => ({ key: `w${i}`, label: i === 0 ? "This week" : i === 1 ? "Next week" : i === 5 ? "6+ weeks" : `In ${i + 1} weeks`, amount: amt, tone: "info" as Tone })),
      { key: "undated", label: "No date", amount: undated, tone: "info" as Tone },
    ],
    total: outstanding,
    undated,
    overdue,
  };

  // ── Week strip ─────────────────────────────────────────────────────────
  const days = Array.from({ length: 7 }, (_, i) => {
    const d0 = addDays(today, i);
    const d1 = addDays(today, i + 1);
    const v = input.appointments.filter((a) => isVisit(a) && a.startsAt >= d0 && a.startsAt < d1);
    const e = input.jobEvents.filter((x) => x.startsAt >= d0 && x.startsAt < d1);
    const mid = new Date(d0.getTime() + 12 * 3_600_000);
    return { key: dayKeyTz(mid, tz), label: fmtWeekday(mid, tz), num: partsIn(mid, tz).d, today: i === 0, visits: v.length, jobs: e.length, hours: Math.round(hoursOf(v) + hoursOf(e)) };
  });
  const weekOut = { days, booked: weekVisits.length + weekEvents.length, hours: Math.round(weekHours) };

  // ── Team ───────────────────────────────────────────────────────────────
  const workerByUser = new Map(input.workers.map((w) => [w.userId, w]));
  const onSiteNames = new Set(onSite.filter((j) => j.started).flatMap((j) => j.crew));
  const team = input.members
    .map((m) => {
      const sent = input.proposals.filter((x) => x.ownerId === m.userId && x.sentAt && x.sentAt >= d30).length;
      const wonRows = input.proposals.filter((x) => x.ownerId === m.userId && x.acceptedAt && x.acceptedAt >= d30);
      const leads = input.leads.filter((l) => (l.assignedToId === m.userId || l.claimedById === m.userId) && l.createdAt >= d30).length;
      const w = workerByUser.get(m.userId);
      return { userId: m.userId, name: m.name, role: m.role, sent, won: wonRows.length, wonValue: sum(wonRows.map((x) => ({ amount: x.total }))), onSite: !!w && onSiteNames.has(w.name), leads };
    })
    .sort((a, b) => b.wonValue - a.wonValue || b.sent - a.sent || a.name.localeCompare(b.name));

  // ── Clients ────────────────────────────────────────────────────────────
  const ltv = new Map<string, number>();
  for (const x of input.payments) if (x.clientId) ltv.set(x.clientId, (ltv.get(x.clientId) ?? 0) + x.amount);
  const paidProposalsByClient = new Map<string, Set<string>>();
  for (const x of input.payments) if (x.clientId && x.proposalId) (paidProposalsByClient.get(x.clientId) ?? paidProposalsByClient.set(x.clientId, new Set()).get(x.clientId))!.add(x.proposalId);
  const nameById = new Map(input.clients.map((c) => [c.id, c.name]));
  const top = [...ltv.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, v]) => ({ id, name: nameById.get(id) ?? "A client", ltv: v, href: HREF.client(id) }));
  const lastTouch = new Map<string, Date>();
  for (const a of input.activity) if (a.clientId && !lastTouch.has(a.clientId)) lastTouch.set(a.clientId, a.createdAt);
  const quiet = input.proposals.filter((x) => ["SENT", "VIEWED"].includes(x.status) && x.clientId && daysBetween(lastTouch.get(x.clientId) ?? x.viewedAt ?? x.sentAt ?? x.createdAt, now) >= 14).length;
  const clients = {
    total: input.clients.length,
    newThisMonth: input.clients.filter((c) => c.createdAt >= monthStart).length,
    repeat: [...paidProposalsByClient.values()].filter((s) => s.size >= 2).length,
    top,
    quiet,
  };

  // ── Reviews ────────────────────────────────────────────────────────────
  const rated = input.reviews.filter((r) => r.status === "COMPLETED" && r.rating != null && r.completedAt && r.completedAt >= d90);
  const reviews = {
    avg: rated.length ? Math.round((rated.reduce((a, r) => a + (r.rating as number), 0) / rated.length) * 10) / 10 : null,
    count: rated.length,
    latest: rated
      .sort((a, b) => (b.completedAt as Date).getTime() - (a.completedAt as Date).getTime())
      .slice(0, 3)
      .map((r) => ({ client: r.clientName, rating: r.rating, when: ago(r.completedAt as Date, now) })),
  };

  // ── Pulse: the last day's trail ────────────────────────────────────────
  const pulse = input.activity
    .filter((a) => a.createdAt >= addDays(now, -1))
    .slice(0, 8)
    .map((a) => ({ id: a.id, summary: a.summary, when: ago(a.createdAt, now), actorId: a.actorId }));

  return { health, now: { line: nowLine, onSite, visits, reading, paidToday, crewOut }, funnel, cash, week: weekOut, team, clients, reviews, pulse };
}

/** The whole brief for one viewer. The office sheet is only for the office. */
export function buildBrief(input: BriefInput): CrmBrief {
  return { today: buildToday(input), office: input.viewer === "office" ? buildOffice(input) : null, viewer: input.viewer, tz: input.tz };
}
