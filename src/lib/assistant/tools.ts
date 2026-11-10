import "server-only";
// WHAT THE ASSISTANT CAN DO (2026-11-04). Every tool is a thin call into code
// the dashboard already runs — the CRM brief, the money rollups, the send
// core, the calendar core, the crew texts, the payment reminder, and (slice 3,
// lib/assistant/build) the Deck Studio and Smart Proposal — so the Assistant
// never computes a number or a price of its own.
//   · A READ tool answers at once with data (the model words it).
//   · A WRITE tool never acts when the model calls it: `plan` checks it, works
//     out exactly what would happen and writes the read-back sentence; the
//     person says YES; only then `execute` runs, with the payload `plan` stored
//     (re-validated), and says what really happened.
// Parameters are zod objects the model fills (strict function calling: every
// field present, `null` for "not given").
import { z } from "zod";
import { db } from "@/lib/db";
import { type AssistantActor, type Capability, proposalScope } from "@/lib/assistant/actor";
import { andList, dayRange, dayWords, money, spanWords, timeOf, wallInstant, dayOf } from "@/lib/assistant/shared";
import { crewOf, findClients, findJobs, findLeads, findProjects, findProposals, findVisits } from "@/lib/assistant/find";
import { readCrmBrief } from "@/lib/crm/briefServer";
import { getFinancialsRollup, getMonthlyRollup } from "@/actions/financials";
import { sendProposalAs } from "@/lib/proposals/sendCore";
import { crewConflicts, scheduleJobAs } from "@/lib/jobs/scheduleCore";
import { createJobFromProposalInternal } from "@/lib/jobFromProposal";
import { textWorker } from "@/lib/sms/send";
import { sendPaymentReminder } from "@/lib/payments/reminders";
import { fromMinor, resolveSchedule } from "@/lib/paymentSchedule";
import { contractSchedule } from "@/lib/contractTotal";
import { BUILDERS } from "@/lib/assistant/build";
import { PEOPLE_TOOLS } from "@/lib/assistant/people";
import { VISIT_TOOLS } from "@/lib/assistant/visits";
import { REMIND_TOOLS } from "@/lib/assistant/remind";
import { MONEY_TOOLS } from "@/lib/assistant/money";
import { FENCE_TOOLS } from "@/lib/assistant/fence";
import { ROOF_TOOLS } from "@/lib/assistant/roof";
import { HVAC_TOOLS } from "@/lib/assistant/hvac";
import { LAWN_TOOLS } from "@/lib/assistant/lawn";
import { PROJECT_TOOLS } from "@/lib/assistant/projects";
import { OVERVIEW_TOOLS } from "@/lib/assistant/overview";
import { SELECTION_TOOLS } from "@/lib/assistant/selections";
import { PHASE_TOOLS } from "@/lib/assistant/phases";
import { MONEY_PLAN_TOOLS } from "@/lib/assistant/moneyPlan";
import { DRAW_TOOLS } from "@/lib/assistant/draws";
import { BUYING_TOOLS } from "@/lib/assistant/buying";
import { FIELD_TOOLS } from "@/lib/assistant/field";
import { TIMELINE_TOOLS } from "@/lib/assistant/timeline";
import { CLIENT_TOOLS } from "@/lib/assistant/client";
import { BUSINESS_TOOLS } from "@/lib/assistant/business";
import { CLIENT_360_TOOLS } from "@/lib/assistant/clients360";
import { INBOX_TOOLS } from "@/lib/assistant/inbox";
import { PIPELINE_TOOLS } from "@/lib/assistant/pipeline";
import { OPEN_TIME_TOOLS } from "@/lib/assistant/openTimes";
// Repairs and come-backs (2026-11-09, the ProSmart gaps plan, part 2): book a repair, and the come-back counts.
import { REPAIR_TOOLS } from "@/lib/assistant/repairs";
// Sales commission (2026-11-10, the ProSmart gaps plan, part 4).
import { COMMISSION_TOOLS } from "@/lib/assistant/commission";
import { CONTRACTOR_TOOLS } from "@/lib/assistant/contractors";
// The subcontractors plan, part 6 (2026-11-09): find, requests, compare, the subs budget, invoices, documents, reminders,
// approving and paying a sub's invoice.
import { SUB_TOOLS } from "@/lib/assistant/subs";

export interface ToolContext {
  actor: AssistantActor;
  now: Date;
  /** The running change's id, and a way to say where a build is (shared BUILD_STEPS) — set by the executor only. */
  actionId?: string;
  report?: (step: string) => Promise<void>;
}

// ── the capability registry's vocabulary (2026-11-06, lib/assistant/registry) ──
// Every tool carries its own card: what it is for, when the model should reach for it, what it works on and what it
// changes, its version, what outside service it needs, and what a person says to get it — the one place a feature is
// described. The registry, the prompt's "what you can do", the phone's labels and the selection tests are all read
// from these cards; adding a tool is adding one object here, nothing else to edit.

/** The business objects a tool works on. */
export type BusinessObject = "client" | "lead" | "proposal" | "estimate" | "job" | "visit" | "worker" | "invoice" | "payment" | "reminder" | "property" | "money" | "calendar" | "project";
/** What a tool changes: nothing (a read), a record inside JobFlex, a draft estimate, the company's schedule, a message that leaves JobFlex, money. */
export type ToolEffect = "read" | "record" | "draft" | "schedule" | "message" | "money";
/** The prompt's sections, in the order they are shown. */
export type ToolGroup = "lookups" | "people" | "visits" | "schedule" | "crew" | "proposals" | "money" | "reminders" | "estimates" | "projects";
export const TOOL_GROUPS: readonly ToolGroup[] = ["lookups", "people", "visits", "schedule", "crew", "proposals", "money", "reminders", "estimates", "projects"];
/** An outside service a tool cannot do without; with its key missing the tool is unavailable everywhere. */
export type ToolDependency = "openai" | "twilio" | "maps" | "solar" | "parcels" | "eagleview";

export interface ToolCard<A> {
  /** The short name lists and cards show ("Roof estimate"). */
  label: string;
  /** One line for the registry: what it does for the business. */
  purpose: string;
  /** When the model should call it — its line in the prompt, written for the model. */
  when: string;
  objects: readonly BusinessObject[];
  effect: ToolEffect;
  group: ToolGroup;
  /** Bumped when the arguments change shape; a change planned on an older version is read back again, never guessed. */
  version: number;
  /** YYYY-MM-DD it first shipped. */
  since: string;
  /** Set when it is on the way out: what was already planned still runs; the model no longer sees it. */
  deprecated?: string;
  deps?: readonly ToolDependency[];
  /** A build's steps in order, as its trace names them (the sheet's trace, lib/assistant/progress). */
  steps?: readonly string[];
  /** What a person says, with the arguments the model should hand it — the selection tests' fixture and the schema check's sample. */
  samples: ReadonlyArray<{ say: string; args: A }>;
}

interface ToolBase<A> {
  name: string;
  description: string;
  params: z.ZodType<A>;
  need: Capability;
  card: ToolCard<A>;
}

export interface ReadTool<A> extends ToolBase<A> {
  kind: "read";
  run(ctx: ToolContext, args: A): Promise<unknown>;
}

/** `runAt`: a `scheduled` tool's own time (a reminder) — the action is queued for then, with no yes. */
export type Plan<P> = { ok: true; payload: P; readback: string; runAt?: Date } | { ok: false; say: string };

/** What a build offers next — send what it made — planned like any write and read back for a yes. */
export type Offer = { tool: string; args: unknown };

export interface WriteTool<A, P> extends ToolBase<A> {
  kind: "write";
  /** A change that runs without a yes because nothing leaves JobFlex — a build makes a DRAFT (lib/assistant/build):
   *  "now" in the turn, "background" after the reply (a minute's AI estimate). Absent: read back, then a yes. */
  instant?: "now" | "background";
  /** A change that reaches nobody but the person and runs at its own time (plan's `runAt`): a reminder to oneself
   *  (lib/assistant/remind). Queued without a yes; the minute job runs it when it is due. */
  scheduled?: true;
  payload: z.ZodType<P>;
  plan(ctx: ToolContext, args: A): Promise<Plan<P>>;
  execute(ctx: ToolContext, payload: P): Promise<{ say: string; result?: unknown; offer?: Offer }>;
}

export type AnyTool = ReadTool<unknown> | WriteTool<unknown, unknown>;

const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const TIME = z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/, "HH:MM");
const ID = z.string().min(1).max(64);

function opened(viewCount: number, viewedAt: Date | null, tz: string): string {
  if (!viewCount || !viewedAt) return "not opened yet";
  return `opened ${viewCount === 1 ? "once" : `${viewCount} times`}, last ${dayWords(viewedAt, tz)}`;
}

// ── READ ─────────────────────────────────────────────────────────────────────

const today: ReadTool<Record<string, never>> = {
  kind: "read",
  name: "today",
  need: "today",
  card: {
    "label": "Today",
    "purpose": "What needs attention today, from the CRM's Today list.",
    "when": "'What's on today', 'what should I do', 'who owes me money', 'any new leads', 'how are we doing': today — every number on it is the CRM's own.",
    "objects": [
      "calendar",
      "payment",
      "proposal",
      "lead",
      "job"
    ],
    "effect": "read",
    "group": "lookups",
    "version": 1,
    "since": "2026-11-04",
    "samples": [
      {
        "say": "what needs attention today?",
        "args": {}
      },
      {
        "say": "who owes us money?",
        "args": {}
      }
    ]
  },
  description:
    "What needs attention today — the CRM's Today list: overdue and due payments, money owed, proposals waiting or being read, new leads, visits and jobs today, who is on site. Use for: what's on today, what should I do, who owes me money, any new leads, how are we doing today.",
  params: z.object({}).strict() as unknown as z.ZodType<Record<string, never>>,
  async run({ actor }) {
    const b = await readCrmBrief({ organizationId: actor.organizationId, userId: actor.userId, role: actor.role });
    return {
      heading: b.today.heading,
      line: b.today.line,
      checks: b.today.checks
        .filter((c) => !c.done)
        .slice(0, 8)
        .map((c) => ({ title: c.title, why: c.why, count: c.count, amount: c.amount, items: c.items.slice(0, 5).map((i) => ({ label: i.label, detail: i.sub, amount: i.amount })), more: c.more })),
      owed: b.office ? { total: b.office.cash.total, overdue: b.office.cash.overdue } : null,
      onSiteNow: b.office ? b.office.now.onSite.map((j) => ({ title: j.title, client: j.client, crew: j.crew })) : [],
      paidToday: b.office ? b.office.now.paidToday : null,
    };
  },
};

const schedule: ReadTool<{ from: string; to: string | null }> = {
  kind: "read",
  name: "schedule",
  need: "schedule.read",
  card: {
    "label": "Schedule",
    "purpose": "The calendar between two days: jobs with their crew, and visits.",
    "when": "'What's on tomorrow', 'what's Thursday look like', 'is Mike busy Friday': schedule(from, to) on the company's clock, at most 14 days; it gives the visit ids move_visit and cancel_visit need.",
    "objects": [
      "calendar",
      "job",
      "visit",
      "worker"
    ],
    "effect": "read",
    "group": "lookups",
    "version": 1,
    "since": "2026-11-04",
    "samples": [
      {
        "say": "what's on tomorrow?",
        "args": {
          "from": "2026-11-07",
          "to": null
        }
      },
      {
        "say": "what does next week look like?",
        "args": {
          "from": "2026-11-09",
          "to": "2026-11-13"
        }
      }
    ]
  },
  description:
    "The calendar between two days on the company's clock (inclusive; at most 14 days): job entries with their client and crew, and visits/appointments (with visitId for move_visit / cancel_visit). Use for: what's on tomorrow, what's Thursday look like, is Mike busy Friday.",
  params: z.object({ from: DAY.describe("first day, YYYY-MM-DD"), to: DAY.nullable().describe("last day, YYYY-MM-DD; null = the same day") }),
  async run({ actor }, args) {
    const tz = actor.timezone;
    const a = dayRange(args.from, tz);
    const b = dayRange(args.to ?? args.from, tz);
    if (!a || !b) return { error: "Bad date." };
    const from = a.from;
    const to = new Date(Math.min(b.to.getTime(), from.getTime() + 14 * 86_400_000));
    const [events, visits] = await Promise.all([
      db.jobEvent.findMany({
        where: { organizationId: actor.organizationId, startsAt: { lt: to }, endsAt: { gt: from }, OR: [{ jobId: null }, { job: { status: { not: "CANCELED" } } }] },
        select: { title: true, startsAt: true, endsAt: true, job: { select: { id: true, client: { select: { name: true } }, assignments: { select: { worker: { select: { displayName: true } } } } } } },
        orderBy: { startsAt: "asc" },
        take: 60,
      }),
      db.appointment.findMany({
        where: { organizationId: actor.organizationId, startsAt: { lt: to }, endsAt: { gt: from }, status: { notIn: ["CANCELED", "NO_SHOW"] } },
        select: { id: true, title: true, startsAt: true, endsAt: true, status: true, client: { select: { name: true } }, lead: { select: { name: true } }, assignments: { select: { worker: { select: { displayName: true } } } } },
        orderBy: { startsAt: "asc" },
        take: 60,
      }),
    ]);
    const rows = [
      ...events.map((e) => ({ at: e.startsAt, item: { kind: "job", when: spanWords(e.startsAt, e.endsAt, tz), title: e.title, client: e.job?.client?.name ?? null, crew: e.job?.assignments.map((x) => x.worker.displayName) ?? [], jobId: e.job?.id ?? null, visitId: null as string | null } })),
      ...visits.map((v) => ({ at: v.startsAt, item: { kind: "visit", when: spanWords(v.startsAt, v.endsAt, tz), title: v.title, client: v.client?.name ?? v.lead?.name ?? null, crew: v.assignments.map((x) => x.worker.displayName), jobId: null, visitId: v.id as string | null } })),
    ].sort((x, y) => x.at.getTime() - y.at.getTime());
    return { from: dayWords(from, tz), to: dayWords(new Date(to.getTime() - 1), tz), items: rows.map((r) => r.item) };
  },
};

const find: ReadTool<{ query: string; kind: "any" | "proposal" | "client" | "job" | "lead" | "worker" | "visit" | "project" }> = {
  kind: "read",
  name: "find",
  need: "proposals.read",
  card: {
    "label": "Find",
    "purpose": "A client, lead, proposal, job, visit or crew member by name, title or address — the ids every change needs.",
    "when": "Before any change that names a person, a client, a proposal, a job, a visit or a worker: find its id here. Several matches: list them numbered with one short detail each and ask which one.",
    "objects": [
      "client",
      "lead",
      "proposal",
      "job",
      "visit",
      "worker"
    ],
    "effect": "read",
    "group": "lookups",
    "version": 1,
    "since": "2026-11-04",
    "samples": [
      {
        "say": "find the Smith roof proposal",
        "args": {
          "query": "Smith roof",
          "kind": "proposal"
        }
      },
      {
        "say": "do we have a client named Lee?",
        "args": {
          "query": "Lee",
          "kind": "client"
        }
      }
    ]
  },
  description:
    "Find proposals, clients, jobs, leads, visits (appointments), projects or crew members by name, title, number or address. Returns ids to use in other tools. Use before any change that names a client, a proposal, a job, a visit, a project or a worker.",
  params: z.object({
    query: z.string().min(2).max(80).describe("the words to look for, e.g. 'Smith roof', 'Mike' or '#1042'"),
    kind: z.enum(["any", "proposal", "client", "job", "lead", "worker", "visit", "project"]),
  }),
  async run({ actor, now }, args) {
    const org = actor.organizationId;
    const tz = actor.timezone;
    const want = (k: string) => args.kind === "any" || args.kind === k;
    const [proposals, clients, jobs, leads, crew, visits, projects] = await Promise.all([
      want("proposal") ? findProposals(org, args.query, proposalScope(actor)) : Promise.resolve([]),
      want("client") ? findClients(org, args.query) : Promise.resolve([]),
      want("job") ? findJobs(org, args.query) : Promise.resolve([]),
      want("lead") ? findLeads(org, args.query) : Promise.resolve([]),
      want("worker") ? crewOf(org) : Promise.resolve([]),
      want("visit") ? findVisits(org, args.query, now) : Promise.resolve([]),
      want("project") ? findProjects(org, args.query) : Promise.resolve([]),
    ]);
    const q = args.query.toLowerCase();
    return {
      projects: projects.map((p) => ({ id: p.id, number: p.number, name: p.name, client: p.client?.name ?? null, status: p.status })),
      visits: visits.map((v) => ({ id: v.id, title: v.title, with: v.client?.name ?? v.lead?.name ?? null, when: spanWords(v.startsAt, v.endsAt, tz), crew: v.assignments.map((a) => a.worker.displayName) })),
      proposals: proposals.map((p) => ({ id: p.id, title: p.title, client: p.client?.name ?? null, clientEmail: p.client?.email ?? null, status: p.status, total: money(p.total, p.currency), address: p.address, created: dayWords(p.createdAt, tz), sent: p.sentAt ? dayWords(p.sentAt, tz) : null, opened: opened(p.viewCount, p.viewedAt, tz) })),
      clients: clients.map((c) => ({ id: c.id, name: c.name, email: c.email, phone: c.phone, address: [c.address, c.city].filter(Boolean).join(", ") || null })),
      jobs: jobs.map((j) => ({ id: j.id, title: j.title, client: j.client?.name ?? null, status: j.status, scheduled: j.events[0] ? spanWords(j.events[0].startsAt, j.events[0].endsAt, tz) : null, crew: j.assignments.map((a) => a.worker.displayName), proposalId: j.proposalId })),
      leads: leads.map((l) => ({ id: l.id, name: l.name, status: l.status, source: l.source, address: l.address, came: dayWords(l.createdAt, tz) })),
      workers: crew.filter((w) => w.displayName.toLowerCase().includes(q) || q.split(/\s+/).some((t) => t.length > 1 && w.displayName.toLowerCase().includes(t))).map((w) => ({ id: w.id, name: w.displayName, texts: Boolean(w.phone && w.smsOptIn) })),
    };
  },
};

const openProposals: ReadTool<Record<string, never>> = {
  kind: "read",
  name: "open_proposals",
  need: "proposals.read",
  card: {
    "label": "Unsigned proposals",
    "purpose": "Proposals sent but not signed, with whether the client opened them.",
    "when": "'Which proposals aren't signed', 'who should I follow up with', 'did Smith open it': open_proposals.",
    "objects": [
      "proposal",
      "client"
    ],
    "effect": "read",
    "group": "lookups",
    "version": 1,
    "since": "2026-11-04",
    "samples": [
      {
        "say": "which proposals aren't signed yet?",
        "args": {}
      }
    ]
  },
  description: "Proposals sent but not signed yet, oldest first, with whether and when the client opened them. Use for: which proposals aren't signed, who should I follow up with, did Smith open it.",
  params: z.object({}).strict() as unknown as z.ZodType<Record<string, never>>,
  async run({ actor }) {
    const tz = actor.timezone;
    const rows = await db.proposal.findMany({
      where: { organizationId: actor.organizationId, ...proposalScope(actor), status: { in: ["SENT", "VIEWED"] } },
      select: { id: true, title: true, total: true, currency: true, sentAt: true, viewedAt: true, viewCount: true, client: { select: { name: true } } },
      orderBy: { sentAt: "asc" },
      take: 15,
    });
    return { proposals: rows.map((p) => ({ id: p.id, title: p.title, client: p.client?.name ?? null, total: money(p.total, p.currency), sent: p.sentAt ? dayWords(p.sentAt, tz) : null, opened: opened(p.viewCount, p.viewedAt, tz) })) };
  },
};

const moneyTool: ReadTool<{ period: "this_month" | "last_month" | "last_30_days" }> = {
  kind: "read",
  name: "money",
  need: "money.read",
  card: {
    "label": "Money",
    "purpose": "Collected, expenses and profit for a month or the last 30 days, with the open pipeline and invoices.",
    "when": "'How much did we make', 'what's our profit', 'are we better than last month': money(period).",
    "objects": [
      "money",
      "invoice"
    ],
    "effect": "read",
    "group": "lookups",
    "version": 1,
    "since": "2026-11-04",
    "samples": [
      {
        "say": "how much did we make last month?",
        "args": {
          "period": "last_month"
        }
      }
    ]
  },
  description:
    "Money collected, expenses and profit for this calendar month, last month, or the last 30 days (with open pipeline and invoices). Use for: how much did we make, what's our profit, are we doing better than last month.",
  params: z.object({ period: z.enum(["this_month", "last_month", "last_30_days"]) }),
  async run({ actor }, args) {
    if (args.period === "last_30_days") {
      const r = await getFinancialsRollup(actor.organizationId);
      return {
        period: "the last 30 days",
        collected: money(r.revenue30d),
        expenses: money(r.expenses30d),
        profit: money(r.profit30d),
        marginPct: r.marginPct,
        openPipeline: money(r.pipelineValue),
        invoicesPending: r.invoicesPending,
        invoicesOverdue: r.invoicesOverdue,
        source: "payments marked paid, and approved expenses and crew pay, in the last 30 days (the Financials page)",
      };
    }
    const months = await getMonthlyRollup(actor.organizationId, 2);
    const m = args.period === "this_month" ? months[months.length - 1] : months[months.length - 2];
    const other = args.period === "this_month" ? months[months.length - 2] : null;
    if (!m) return { error: "No figures for that month." };
    return {
      period: m.label,
      collected: money(m.revenue),
      expenses: money(m.expenses),
      profit: money(m.profit),
      lastMonth: other ? { period: other.label, collected: money(other.revenue), profit: money(other.profit) } : null,
      source: "payments marked paid, and approved expenses and crew pay, by month (the Financials page)",
    };
  },
};

const crew: ReadTool<Record<string, never>> = {
  kind: "read",
  name: "crew",
  need: "crew.read",
  card: {
    "label": "Crew",
    "purpose": "Everyone on the crew, with whether crew texts reach them.",
    "when": "To resolve 'Mike' or 'the roofing guys' before scheduling or texting: crew.",
    "objects": [
      "worker"
    ],
    "effect": "read",
    "group": "lookups",
    "version": 1,
    "since": "2026-11-04",
    "samples": [
      {
        "say": "who's on the crew?",
        "args": {}
      }
    ]
  },
  description: "Everyone on the crew with their id and whether crew texts reach them. Use to resolve names like 'Mike' or 'the roofing guys' before scheduling or texting.",
  params: z.object({}).strict() as unknown as z.ZodType<Record<string, never>>,
  async run({ actor }) {
    const rows = await crewOf(actor.organizationId);
    return { workers: rows.map((w) => ({ id: w.id, name: w.displayName, texts: Boolean(w.phone && w.smsOptIn), specialties: safeList(w.specialties) })) };
  },
};

function safeList(json: string | null): string[] {
  try {
    const v = JSON.parse(json ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 6) : [];
  } catch {
    return [];
  }
}

// ── WRITE ────────────────────────────────────────────────────────────────────

const sendProposal: WriteTool<{ proposalId: string; email: string | null; clientName: string | null }, { proposalId: string; email: string | null; clientName: string | null }> = {
  kind: "write",
  name: "send_proposal",
  need: "proposals.send",
  card: {
    "label": "Send a proposal",
    "purpose": "Email (and text) a proposal to its client.",
    "when": "'Send the Smith proposal', 'send it' (the newest one built): find the proposal first; pass an email only when they gave one, a client name only when the proposal has no client.",
    "objects": [
      "proposal",
      "client"
    ],
    "effect": "message",
    "group": "proposals",
    "version": 1,
    "since": "2026-11-04",
    "samples": [
      {
        "say": "send the Smith proposal",
        "args": {
          "proposalId": "p_1",
          "email": null,
          "clientName": null
        }
      },
      {
        "say": "send it to sarah@example.com",
        "args": {
          "proposalId": "p_1",
          "email": "sarah@example.com",
          "clientName": null
        }
      }
    ]
  },
  description:
    "Send a proposal to the client by email (and text, when the company texts clients). Find the proposal first. Pass an email only when the person gave one; pass a client name only when the proposal has no client.",
  params: z.object({ proposalId: ID, email: z.string().max(200).nullable(), clientName: z.string().max(120).nullable() }),
  payload: z.object({ proposalId: ID, email: z.string().max(200).nullable(), clientName: z.string().max(120).nullable() }),
  async plan({ actor }, args) {
    const p = await db.proposal.findFirst({
      where: { id: args.proposalId, organizationId: actor.organizationId, ...proposalScope(actor) },
      select: { id: true, title: true, total: true, currency: true, status: true, client: { select: { name: true, email: true, deletedAt: true } } },
    });
    if (!p) return { ok: false, say: "I couldn't find that proposal." };
    const typed = args.email?.trim() || null;
    if (typed && !z.string().email().safeParse(typed).success) return { ok: false, say: `"${typed}" doesn't look like an email address.` };
    const client = p.client && !p.client.deletedAt ? p.client : null;
    const email = typed ?? client?.email ?? null;
    if (!email) return { ok: false, say: `"${p.title}" has no client email on file. Tell me the email to send it to.` };
    if (!client && !args.clientName?.trim()) return { ok: false, say: `"${p.title}" has no client yet. Tell me the client's name to file it under.` };
    const who = client?.name ?? args.clientName?.trim() ?? "the client";
    const saves = typed && client && (client.email ?? "").toLowerCase() !== typed.toLowerCase() ? ` (I'll save ${typed} as ${who}'s email)` : "";
    const signed = ["ACCEPTED", "COMPLETED", "PAID"].includes(p.status) ? " It's already signed, so this sends them a copy." : "";
    return {
      ok: true,
      payload: { proposalId: p.id, email: typed, clientName: client ? null : (args.clientName?.trim() ?? null) },
      readback: `Send "${p.title}" (${money(p.total, p.currency)}) to ${who} at ${email}${saves}.${signed}`,
    };
  },
  async execute({ actor }, payload) {
    const p = await db.proposal.findFirst({ where: { id: payload.proposalId, organizationId: actor.organizationId }, select: { title: true } });
    const r = await sendProposalAs(
      { organizationId: actor.organizationId, userId: actor.userId, proposalScope: proposalScope(actor) },
      payload.proposalId,
      payload.email ? { email: payload.email, name: payload.clientName ?? "" } : undefined,
    );
    const title = p?.title ?? "the proposal";
    return {
      say: r.to ? `Sent "${title}" to ${r.client ?? r.to} (${r.to}). Ask me any time whether they've opened it.` : `Marked "${title}" as sent, but no email went out: there's no email on file.`,
      result: r,
    };
  },
};

type ScheduleArgs = { jobId: string | null; proposalId: string | null; date: string; start: string | null; end: string | null; workerIds: string[] | null };
type SchedulePayload = { jobId: string | null; proposalId: string | null; startsAt: string; endsAt: string; workerIds: string[]; title: string };

const scheduleJob: WriteTool<ScheduleArgs, SchedulePayload> = {
  kind: "write",
  name: "schedule_job",
  need: "schedule.write",
  card: {
    "label": "Schedule",
    "purpose": "Put a job on the calendar or move it, and add crew.",
    "when": "'Put the Lee fence on Thursday with Mike', 'move the Smith job to Monday': the job id from find (or a signed proposal's id when it has no job yet), crew ids from crew. A job is the crew's work; an appointment with a client or a lead is book_visit.",
    "objects": [
      "job",
      "calendar",
      "worker",
      "proposal"
    ],
    "effect": "schedule",
    "group": "schedule",
    "version": 1,
    "since": "2026-11-04",
    "samples": [
      {
        "say": "put the Lee fence on Thursday with Mike's crew",
        "args": {
          "jobId": "job_1",
          "proposalId": null,
          "date": "2026-11-12",
          "start": null,
          "end": null,
          "workerIds": [
            "w_1"
          ]
        }
      }
    ]
  },
  description:
    "Put a job on the calendar or move it, and optionally add crew. Give the job id (from find), or the id of a signed proposal that has no job yet. Date and times are on the company's clock; leave start/end null to keep the job's current hours (or 9:00–14:00 for a new entry).",
  params: z.object({
    jobId: ID.nullable(),
    proposalId: ID.nullable(),
    date: DAY,
    start: TIME.nullable(),
    end: TIME.nullable(),
    workerIds: z.array(ID).max(12).nullable().describe("workers to ADD to the job (ids from crew or find); null = no change"),
  }),
  payload: z.object({ jobId: ID.nullable(), proposalId: ID.nullable(), startsAt: z.string(), endsAt: z.string(), workerIds: z.array(ID).max(12), title: z.string() }),
  async plan({ actor, now }, args) {
    const org = actor.organizationId;
    const tz = actor.timezone;
    let job: { id: string; title: string; client: { name: string } | null; events: { startsAt: Date; endsAt: Date }[]; assignments: { workerId: string; worker: { displayName: string } }[] } | null = null;
    let proposalId: string | null = null;
    let title = "";
    let clientName: string | null = null;
    const jobSelect = { id: true, title: true, client: { select: { name: true } }, events: { select: { startsAt: true, endsAt: true }, orderBy: { startsAt: "asc" as const }, take: 1 }, assignments: { select: { workerId: true, worker: { select: { displayName: true } } } } };
    if (args.jobId) {
      job = await db.job.findFirst({ where: { id: args.jobId, organizationId: org }, select: jobSelect });
      if (!job) return { ok: false, say: "I couldn't find that job." };
    } else if (args.proposalId) {
      job = await db.job.findFirst({ where: { proposalId: args.proposalId, organizationId: org }, select: jobSelect });
      if (!job) {
        const p = await db.proposal.findFirst({ where: { id: args.proposalId, organizationId: org }, select: { id: true, title: true, status: true, client: { select: { name: true } } } });
        if (!p) return { ok: false, say: "I couldn't find that proposal." };
        if (!["ACCEPTED", "COMPLETED", "PAID"].includes(p.status)) return { ok: false, say: `"${p.title}" isn't signed yet, so there's no job to schedule.` };
        proposalId = p.id;
        title = p.title;
        clientName = p.client?.name ?? null;
      }
    } else {
      return { ok: false, say: "Which job? Tell me the client or the job's name." };
    }
    if (job) {
      title = job.title;
      clientName = job.client?.name ?? null;
    }
    const existing = job?.events[0] ?? null;
    const start = args.start ?? (existing ? timeOf(existing.startsAt, tz) : "09:00");
    const startsAt = wallInstant(args.date, start, tz);
    if (!startsAt) return { ok: false, say: "I couldn't read that date or time." };
    // The end: as said; else the entry's own length; else the tray's 9:00–14:00 (five hours from a given start).
    const endsAt = args.end
      ? wallInstant(args.date, args.end, tz)
      : existing
        ? new Date(startsAt.getTime() + (existing.endsAt.getTime() - existing.startsAt.getTime()))
        : wallInstant(args.date, args.start ? addHours(args.start, 5) : "14:00", tz);
    if (!endsAt || endsAt.getTime() <= startsAt.getTime()) return { ok: false, say: "The end time has to be after the start." };
    if (dayOf(startsAt, tz) < dayOf(now, tz)) return { ok: false, say: `${dayWords(startsAt, tz)} is in the past. Which day did you mean?` };

    const wanted = [...new Set(args.workerIds ?? [])];
    const workers = wanted.length ? await db.workerProfile.findMany({ where: { organizationId: org, id: { in: wanted } }, select: { id: true, displayName: true } }) : [];
    if (workers.length !== wanted.length) return { ok: false, say: "One of those crew members isn't on your crew." };
    const already = new Set(job?.assignments.map((a) => a.workerId) ?? []);
    const adding = workers.filter((w) => !already.has(w.id));
    const crewIds = [...already, ...adding.map((w) => w.id)];
    const conflicts = await crewConflicts(org, crewIds, startsAt, endsAt, job?.id ?? null);

    const what = `"${title}"${clientName && !title.toLowerCase().includes(clientName.toLowerCase().split(" ")[0]) ? ` (${clientName})` : ""}`;
    const crewWords = adding.length
      ? ` and add ${andList(adding.map((w) => w.displayName))}`
      : job?.assignments.length
        ? ` — crew: ${andList(job.assignments.map((a) => a.worker.displayName))}`
        : " — no crew on it yet";
    const heads = conflicts.slice(0, 3).map((c) => ` Heads-up: ${c.name} is on "${c.what}" ${spanWords(c.startsAt, c.endsAt, tz)}.`).join("");
    return {
      ok: true,
      payload: { jobId: job?.id ?? null, proposalId, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), workerIds: adding.map((w) => w.id), title },
      readback: `${existing ? "Move" : "Put"} ${what} ${existing ? "to" : "on"} ${spanWords(startsAt, endsAt, tz)}${crewWords}. The crew gets a text.${heads}`,
    };
  },
  async execute({ actor }, payload) {
    const org = actor.organizationId;
    let jobId = payload.jobId;
    if (!jobId) {
      if (!payload.proposalId) throw new Error("No job to schedule.");
      const p = await db.proposal.findFirst({ where: { id: payload.proposalId, organizationId: org }, select: { id: true } });
      if (!p) throw new Error("Not found");
      jobId = (await createJobFromProposalInternal(p.id)).id;
    }
    const startsAt = new Date(payload.startsAt);
    const endsAt = new Date(payload.endsAt);
    const r = await scheduleJobAs({ organizationId: org, userId: actor.userId }, { jobId, startsAt, endsAt, workerIds: payload.workerIds });
    const crewLine = r.added.length ? ` ${andList(r.added)} ${r.added.length > 1 ? "are" : "is"} on it.` : "";
    return { say: `Done — "${payload.title}" is on ${spanWords(startsAt, endsAt, actor.timezone)}.${crewLine}`, result: r };
  },
};

function addHours(hhmm: string, h: number): string {
  const [a, b] = hhmm.split(":").map(Number);
  return `${String(Math.min(23, a + h)).padStart(2, "0")}:${String(b).padStart(2, "0")}`;
}

/** What became of one crew text, in words the person can act on: sent (or held for the morning), or why not. */
function textOutcome(r: Awaited<ReturnType<typeof textWorker>>): { sent: boolean; why: string | null } {
  if (!r) return { sent: false, why: "they have no phone or crew texts on" };
  if (r.ok && (r.status === "SENT" || r.status === "HELD")) return { sent: true, why: null };
  if (r.ok && r.status === "SKIPPED") {
    if (r.why === "no-number") return { sent: false, why: "your company has no texting number yet (Settings → Texting)" };
    if (r.why === "not-configured") return { sent: false, why: "texting isn't set up here" };
    if (r.why === "test-environment") return { sent: false, why: "texting is in test mode on this server" };
    return { sent: false, why: `texting is off (${r.why})` };
  }
  if (!r.ok) return { sent: false, why: r.reason === "cap" ? "today's text limit was reached" : r.reason === "opted-out" ? "they replied STOP" : null };
  return { sent: false, why: null };
}

const textCrew: WriteTool<{ workerIds: string[] | null; message: string }, { workerIds: string[]; body: string }> = {
  kind: "write",
  name: "text_crew",
  need: "crew.text",
  card: {
    "label": "Text the crew",
    "purpose": "Text one or more crew members from the company's number.",
    "when": "'Tell everybody …', 'text Mike …': one message to one or many (workerIds null = everyone with texts on); write it the way the person said it.",
    "objects": [
      "worker"
    ],
    "effect": "message",
    "group": "crew",
    "version": 1,
    "since": "2026-11-04",
    "samples": [
      {
        "say": "tell everybody we start at 7 tomorrow",
        "args": {
          "workerIds": null,
          "message": "We start at 7 tomorrow."
        }
      }
    ]
  },
  description:
    "Text one or more crew members from the company's number. workerIds = the people (ids from crew or find); null = everyone on the crew with texts on. Write the message the way the person said it, short and clear.",
  params: z.object({ workerIds: z.array(ID).max(60).nullable(), message: z.string().min(1).max(480) }),
  payload: z.object({ workerIds: z.array(ID).max(60), body: z.string().min(1).max(560) }),
  async plan({ actor }, args) {
    const all = await crewOf(actor.organizationId);
    const targets = args.workerIds ? all.filter((w) => args.workerIds!.includes(w.id)) : all;
    if (args.workerIds && targets.length !== new Set(args.workerIds).size) return { ok: false, say: "One of those people isn't on your crew." };
    const reach = targets.filter((w) => w.phone && w.smsOptIn);
    const off = targets.filter((w) => !(w.phone && w.smsOptIn));
    if (!reach.length) return { ok: false, say: `${targets.length === 1 ? `${targets[0].displayName} doesn't` : "None of them"} have crew texts on. Turn them on in Workers → their card.` };
    const first = actor.userName.split(/\s+/)[0] || actor.orgName;
    const body = `${first}: ${args.message.trim()}`;
    const who = !args.workerIds && off.length === 0 ? `everyone on your crew (${reach.length})` : andList(reach.map((w) => w.displayName));
    const offLine = off.length ? ` ${andList(off.map((w) => w.displayName))} ${off.length > 1 ? "have" : "has"} texts off and won't get it.` : "";
    return { ok: true, payload: { workerIds: reach.map((w) => w.id), body }, readback: `Text ${who}: "${body}"${offLine}` };
  },
  async execute({ actor }, payload) {
    const workers = await db.workerProfile.findMany({
      where: { organizationId: actor.organizationId, id: { in: payload.workerIds } },
      select: { displayName: true, phone: true, smsOptIn: true, organizationId: true, user: { select: { notificationPrefsJson: true } } },
    });
    let sent = 0;
    const missed: string[] = [];
    let why: string | null = null;
    for (const w of workers) {
      const r = await textWorker(w, payload.body, "assistant-crew");
      const o = textOutcome(r);
      if (o.sent) sent += 1;
      else {
        missed.push(w.displayName);
        why = o.why ?? why;
      }
    }
    const head = sent ? `Texted ${sent === workers.length ? andList(workers.map((w) => w.displayName)) : `${sent} of ${workers.length}`}.` : "No text went out.";
    const tail = missed.length ? ` Not sent to ${andList(missed)}${why ? `: ${why}` : ""}.` : "";
    return { say: `${head}${tail}`, result: { sent, missed } };
  },
};

const paymentReminder: WriteTool<{ proposalId: string; installmentId: string | null }, { proposalId: string; installmentId: string | null }> = {
  kind: "write",
  name: "payment_reminder",
  need: "payments.remind",
  card: {
    "label": "Payment reminder",
    "purpose": "Remind a client to pay what they owe on a signed proposal.",
    "when": "'Remind Johnson to pay', 'ask Lee for the balance': find the proposal first; a stage id only when one was named. A reminder to oneself is remind_me.",
    "objects": [
      "client",
      "payment",
      "proposal"
    ],
    "effect": "message",
    "group": "money",
    "version": 1,
    "since": "2026-11-04",
    "samples": [
      {
        "say": "ask Johnson for the remaining payment",
        "args": {
          "proposalId": "p_1",
          "installmentId": null
        }
      }
    ]
  },
  description: "Send the client a payment reminder (email, and a text when the company texts clients) for what they owe on a signed proposal. installmentId = a specific payment stage, or null for the next one due.",
  params: z.object({ proposalId: ID, installmentId: ID.nullable() }),
  payload: z.object({ proposalId: ID, installmentId: ID.nullable() }),
  async plan({ actor }, args) {
    const p = await db.proposal.findFirst({
      where: { id: args.proposalId, organizationId: actor.organizationId },
      select: {
        id: true,
        title: true,
        total: true,
        currency: true,
        client: { select: { name: true, email: true, phone: true } },
        installments: { orderBy: { position: "asc" } },
        changeOrders: { where: { status: "APPROVED" }, select: { status: true, total: true } },
      },
    });
    if (!p) return { ok: false, say: "I couldn't find that proposal." };
    if (!p.client?.email && !p.client?.phone) return { ok: false, say: `${p.client?.name ?? "That client"} has no email or phone on file.` };
    const s = resolveSchedule({ ...contractSchedule(p.total, p.changeOrders), currency: p.currency, installments: p.installments });
    if (s.remainingMinor <= 0) return { ok: false, say: `Nothing is owed on "${p.title}".` };
    const row = args.installmentId ? p.installments.find((i) => i.id === args.installmentId) ?? null : null;
    if (args.installmentId && !row) return { ok: false, say: "That payment stage isn't on this proposal." };
    const stage = row ? s.stages.find((x) => x.id === row.id) ?? null : null;
    const amount = stage ? fromMinor(stage.amountMinor) : fromMinor(s.remainingMinor);
    const label = row?.label ?? (s.unpaidCount > 1 ? "the remaining balance" : "the payment");
    const by = [p.client?.email ? "email" : null, p.client?.phone ? "text (if client texts are on)" : null].filter(Boolean).join(" and ");
    return {
      ok: true,
      payload: { proposalId: p.id, installmentId: row?.id ?? null },
      readback: `Remind ${p.client?.name ?? "the client"} about ${label} on "${p.title}" — ${money(amount, p.currency)} — by ${by}.`,
    };
  },
  async execute({ actor }, payload) {
    const r = await sendPaymentReminder({ proposalId: payload.proposalId, installmentId: payload.installmentId, source: "manual", organizationId: actor.organizationId, actorId: actor.userId });
    if (r.skipped === "nothing-owed") return { say: "Nothing is owed anymore, so no reminder went out.", result: r };
    if (r.skipped) return { say: "The reminder didn't go out: the client has no email or phone on file.", result: r };
    const via = [r.email === "sent" ? "email" : null, r.sms === "sent" ? "text" : null].filter(Boolean);
    return {
      say: via.length ? `Reminder sent by ${andList(via as string[])}: ${r.stageLabel}, ${money(r.amount)}.` : "The reminder didn't go out — the email failed and texting is off for clients.",
      result: r,
    };
  },
};

/** Different words to different people in one go (batch 1, 2026-11-05): "tell Mike to start at the Lee house and Ana
 *  to pick up the shingles" — one read-back naming each, one yes. */
const textCrewEach: WriteTool<{ items: { workerId: string; message: string }[] }, { items: { workerId: string; body: string }[] }> = {
  kind: "write",
  name: "text_crew_each",
  need: "crew.text",
  card: {
    "label": "Text the crew",
    "purpose": "Different messages to different crew members in one go.",
    "when": "'Tell Mike to bring the ladder and Jose to pick up the shingles': text_crew_each — one yes for all of them.",
    "objects": [
      "worker"
    ],
    "effect": "message",
    "group": "crew",
    "version": 1,
    "since": "2026-11-05",
    "samples": [
      {
        "say": "tell Mike to bring the ladder and Jose to pick up the shingles",
        "args": {
          "items": [
            {
              "workerId": "w_1",
              "message": "Bring the ladder."
            },
            {
              "workerId": "w_2",
              "message": "Pick up the shingles."
            }
          ]
        }
      }
    ]
  },
  description:
    "Text several crew members DIFFERENT messages in one go (ids from crew or find). Use when each person gets their own instruction; for one message to everyone use text_crew. Write each message the way the person said it.",
  params: z.object({ items: z.array(z.object({ workerId: ID, message: z.string().min(1).max(480) })).min(1).max(20) }),
  payload: z.object({ items: z.array(z.object({ workerId: ID, body: z.string().min(1).max(560) })).min(1).max(20) }),
  async plan({ actor }, args) {
    const all = await crewOf(actor.organizationId);
    const byId = new Map(all.map((w) => [w.id, w]));
    const first = actor.userName.split(/\s+/)[0] || actor.orgName;
    const items: { workerId: string; body: string }[] = [];
    const lines: string[] = [];
    const off: string[] = [];
    for (const it of args.items) {
      const w = byId.get(it.workerId);
      if (!w) return { ok: false, say: "One of those people isn't on your crew." };
      if (!(w.phone && w.smsOptIn)) {
        off.push(w.displayName);
        continue;
      }
      const body = `${first}: ${it.message.trim()}`;
      items.push({ workerId: w.id, body });
      lines.push(`${w.displayName} — "${body}"`);
    }
    if (!items.length) return { ok: false, say: `${andList(off)} ${off.length > 1 ? "don't" : "doesn't"} have crew texts on. Turn them on in Workers → their card.` };
    const offLine = off.length ? ` ${andList(off)} ${off.length > 1 ? "have" : "has"} texts off and won't get one.` : "";
    return { ok: true, payload: { items }, readback: `Text each: ${lines.join("; ")}.${offLine}` };
  },
  async execute({ actor }, payload) {
    const workers = await db.workerProfile.findMany({
      where: { organizationId: actor.organizationId, id: { in: payload.items.map((i) => i.workerId) } },
      select: { id: true, displayName: true, phone: true, smsOptIn: true, organizationId: true, user: { select: { notificationPrefsJson: true } } },
    });
    const byId = new Map(workers.map((w) => [w.id, w]));
    let sent = 0;
    const missed: string[] = [];
    const names: string[] = [];
    let why: string | null = null;
    for (const it of payload.items) {
      const w = byId.get(it.workerId);
      if (!w) continue;
      names.push(w.displayName);
      const o = textOutcome(await textWorker(w, it.body, "assistant-crew"));
      if (o.sent) sent += 1;
      else {
        missed.push(w.displayName);
        why = o.why ?? why;
      }
    }
    const head = sent ? `Texted ${sent === names.length ? andList(names) : `${sent} of ${names.length}`}.` : "No text went out.";
    return { say: `${head}${missed.length ? ` Not sent to ${andList(missed)}${why ? `: ${why}` : ""}.` : ""}`, result: { sent, missed } };
  },
};

/** The CRM's own overdue list (lib/crm/brief money.overdue), one row per proposal, largest first — the morning briefing
 *  and remind_overdue read it. The Today list shows five rows; `more` counts the rest. */
export async function overduePayments(actor: AssistantActor): Promise<{ proposalId: string; who: string; amount: number; late: string; more: number }[]> {
  const b = await readCrmBrief({ organizationId: actor.organizationId, userId: actor.userId, role: actor.role });
  const check = b.today.checks.find((c) => c.key === "money.overdue" && !c.done);
  const seen = new Set<string>();
  const out: { proposalId: string; who: string; amount: number; late: string; more: number }[] = [];
  for (const it of check?.items ?? []) {
    const id = /\/dashboard\/proposals\/([^/?#]+)/.exec(it.href ?? "")?.[1];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ proposalId: id, who: it.label.split(" · ")[0], amount: it.amount ?? 0, late: it.sub.split(" · ")[0], more: check?.more ?? 0 });
  }
  return out;
}

/** Every overdue payment reminded in one go (batch 3, 2026-11-05): the morning briefing offers it, and "remind everyone
 *  who's overdue" asks for it. One reminder per proposal, the next stage due, through the same send as payment_reminder. */
const remindOverdue: WriteTool<Record<string, never>, { proposalIds: string[]; names: string[] }> = {
  kind: "write",
  name: "remind_overdue",
  need: "payments.remind",
  card: {
    "label": "Payment reminders",
    "purpose": "A payment reminder to every client with an overdue payment, in one go.",
    "when": "'Remind everyone who hasn't paid', 'send reminders to everyone overdue': remind_overdue (one yes). For one client: payment_reminder.",
    "objects": [
      "client",
      "payment"
    ],
    "effect": "message",
    "group": "money",
    "version": 1,
    "since": "2026-11-05",
    "samples": [
      {
        "say": "send payment reminders to everyone overdue",
        "args": {}
      }
    ]
  },
  description: "Send a payment reminder to EVERY client with an overdue payment, in one go (one yes). For one client use payment_reminder.",
  params: z.object({}).strict() as unknown as z.ZodType<Record<string, never>>,
  payload: z.object({ proposalIds: z.array(ID).max(40), names: z.array(z.string()).max(40) }),
  async plan({ actor }) {
    const due = await overduePayments(actor);
    if (!due.length) return { ok: false, say: "Nothing is overdue right now." };
    const more = due[0].more > 0 ? ` (+${due[0].more} more on the Today list)` : "";
    return {
      ok: true,
      payload: { proposalIds: due.map((d) => d.proposalId), names: due.map((d) => d.who) },
      readback: `Send payment reminders to ${andList(due.map((d) => `${d.who} (${money(d.amount)}, ${d.late})`))}${more}.`,
    };
  },
  async execute({ actor }, p) {
    const went: string[] = [];
    const not: string[] = [];
    for (let i = 0; i < p.proposalIds.length; i++) {
      const r = await sendPaymentReminder({ proposalId: p.proposalIds[i], installmentId: null, source: "manual", organizationId: actor.organizationId, actorId: actor.userId }).catch(() => null);
      const ok = Boolean(r && !r.skipped && (r.email === "sent" || r.sms === "sent"));
      (ok ? went : not).push(p.names[i] ?? "a client");
    }
    return {
      say: `${went.length ? `Reminders sent to ${andList(went)}.` : "No reminder went out."}${not.length ? ` Not sent to ${andList(not)} — no email or phone on file, or the send failed.` : ""}`,
      result: { went, not },
    };
  },
};

/** Every tool, in the order the model is shown them. */
export const TOOLS: readonly AnyTool[] = [
  today,
  schedule,
  find,
  openProposals,
  moneyTool,
  ...BUSINESS_TOOLS, ...CONTRACTOR_TOOLS, ...SUB_TOOLS,
  crew,
  ...BUILDERS,
  ...FENCE_TOOLS,
  ...ROOF_TOOLS,
  ...HVAC_TOOLS,
  ...LAWN_TOOLS,
  sendProposal,
  scheduleJob,
  textCrew,
  textCrewEach,
  paymentReminder,
  remindOverdue,
  ...PEOPLE_TOOLS, ...CLIENT_360_TOOLS, ...INBOX_TOOLS, ...PIPELINE_TOOLS,
  ...VISIT_TOOLS,
  ...OPEN_TIME_TOOLS,
  ...REPAIR_TOOLS,
  ...COMMISSION_TOOLS,
  ...REMIND_TOOLS,
  ...MONEY_TOOLS,
  ...PROJECT_TOOLS,
  ...OVERVIEW_TOOLS,
  ...SELECTION_TOOLS,
  ...PHASE_TOOLS,
  ...MONEY_PLAN_TOOLS,
  ...DRAW_TOOLS,
  ...BUYING_TOOLS,
  ...FIELD_TOOLS,
  ...TIMELINE_TOOLS,
  ...CLIENT_TOOLS,
] as unknown as AnyTool[];

export function toolNamed(name: string): AnyTool | null {
  return TOOLS.find((t) => t.name === name) ?? null;
}
