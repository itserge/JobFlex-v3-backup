import "server-only";
// REPAIRS AND COME-BACKS, ON THE SERVER (2026-11-09, the ProSmart gaps plan, part 2). One module for the repair
// sheet's actions (actions/repairs), the Operator (lib/assistant/repairs), the job page and the Workers page.
//
//   repairSheetData — what the sheet opens on: which job came back (a job, a sold proposal's job, a project's or a
//                     client's jobs to pick from), its trade, the crew with what each was last paid for a repair,
//                     and the repairs already booked on each job ("didn't we already send someone?").
//   bookRepair      — books it: a Job of kind REPAIR at the client's house, its calendar entry (or none — it waits on
//                     the calendar's To place list), the installer on it with their pay and a text, a change order to
//                     the client when it is billable. A same-person clash is refused unless the office says go.
//   repairFactsFor  — the job page: what this repair is, or this job's come-backs and what they cost.
//   crewComebacks   — the Workers page and the Operator: come-backs per crew member (only "our work" counts).

import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { afterResponse } from "@/lib/server-events";
import { enforcePlanLimit } from "@/lib/limitsEngine";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { textAssignmentCreated } from "@/lib/sms/crew";
import { textJobScheduled } from "@/lib/sms/schedule";
import { crewConflicts, type Conflict } from "@/lib/jobs/scheduleCore";
import { jobCosts } from "@/lib/jobCost";
import { sendChangeOrderToClient } from "@/lib/changeOrders/send";
import { CO_STATUS, normalizeTaxRate, totalsForLines } from "@/lib/changeOrders/types";
import { wallInstant, dayWords, clockWords } from "@/lib/assistant/shared";
import { openTimesFor, type OpenTimeOffer } from "@/lib/calendar/openTimesServer";
import {
  causeLabel,
  cleanReasons,
  crewComebacks as countComebacks,
  isCause,
  parseReasons,
  reasonOf,
  repairFamilyOf,
  repairScope,
  repairTitle,
  whoPaysWords,
  type RepairCause,
  type RepairFamily,
} from "@/lib/repairs/shared";

const SOLD = ["ACCEPTED", "COMPLETED", "PAID"];

export type RepairRef = { jobId?: string | null; proposalId?: string | null; projectId?: string | null; clientId?: string | null };

export type RepairHistoryRow = { id: string; title: string; when: string; who: string | null; status: string; cause: string };

export type RepairJobOption = {
  id: string;
  title: string;
  status: string;
  /** "done Oct 12", "in progress", "scheduled Nov 14", "no date". */
  state: string;
  client: string | null;
  address: string | null;
  crew: Array<{ id: string; name: string }>;
  family: RepairFamily;
  /** A change order can carry a charge to the client (the job has its contract). */
  hasContract: boolean;
  history: RepairHistoryRow[];
};

export type RepairSheetData = {
  /** The client's name, for the sheet's title. */
  client: string | null;
  jobs: RepairJobOption[];
  picked: string | null;
  /** A sold proposal with no job on file: booking files the original work as a done job first. */
  proposalOnly: { id: string; title: string; client: string | null; address: string | null; family: RepairFamily } | null;
  crew: Array<{ id: string; name: string; role: string; usualPay: number | null; phone: boolean }>;
  tz: string;
  /** Today on the company's clock (YYYY-MM-DD), for the date box. */
  today: string;
  /** Why nothing can be booked from here, when that is so. */
  why: string | null;
};

type JobRow = {
  id: string;
  title: string;
  status: string;
  kind: string;
  repairOfId: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  updatedAt: Date;
  proposalId: string | null;
  projectId: string | null;
  clientId: string | null;
  scopeOfWork: string | null;
  client: { name: string; address: string | null; city: string | null } | null;
  proposal: { title: string; trade: string | null; address: string | null } | null;
  assignments: Array<{ workerId: string; worker: { displayName: string } }>;
};

const JOB_SELECT = {
  id: true,
  title: true,
  status: true,
  kind: true,
  repairOfId: true,
  startsAt: true,
  endsAt: true,
  updatedAt: true,
  proposalId: true,
  projectId: true,
  clientId: true,
  scopeOfWork: true,
  client: { select: { name: true, address: true, city: true } },
  proposal: { select: { title: true, trade: true, address: true } },
  assignments: { select: { workerId: true, worker: { select: { displayName: true } } } },
} as const;

async function tzOf(organizationId: string): Promise<string> {
  return (await db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } }))?.timezone || "America/New_York";
}

function dayKey(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
const shortDay = (d: Date, tz: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric" }).format(d);

function stateOf(j: Pick<JobRow, "status" | "startsAt" | "endsAt" | "updatedAt">, tz: string): string {
  if (j.status === "COMPLETED") return `done ${shortDay(j.endsAt ?? j.updatedAt, tz)}`;
  if (j.status === "IN_PROGRESS") return "in progress";
  if (j.status === "CANCELED") return "cancelled";
  return j.startsAt ? `scheduled ${shortDay(j.startsAt, tz)}` : "no date yet";
}

function addressOf(j: Pick<JobRow, "client" | "proposal">): string | null {
  const c = j.client;
  const line = [c?.address, c?.city].filter(Boolean).join(", ");
  return line || j.proposal?.address || null;
}

/** The job a repair is FOR: a repair's own original when it is one, else the job itself. */
async function originalOf(organizationId: string, jobId: string): Promise<JobRow | null> {
  const j = await db.job.findFirst({ where: { id: jobId, organizationId }, select: JOB_SELECT });
  if (!j) return null;
  if (j.kind === "REPAIR" && j.repairOfId) return db.job.findFirst({ where: { id: j.repairOfId, organizationId }, select: JOB_SELECT });
  return j;
}

async function historyOf(organizationId: string, jobIds: string[], tz: string): Promise<Map<string, RepairHistoryRow[]>> {
  const out = new Map<string, RepairHistoryRow[]>();
  if (!jobIds.length) return out;
  const rows = await db.job.findMany({
    where: { organizationId, repairOfId: { in: jobIds } },
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true, status: true, repairOfId: true, repairCause: true, startsAt: true, events: { orderBy: { startsAt: "asc" }, take: 1, select: { startsAt: true } }, assignments: { select: { worker: { select: { displayName: true } } } } },
  });
  for (const r of rows) {
    const at = r.events[0]?.startsAt ?? r.startsAt;
    const row: RepairHistoryRow = {
      id: r.id,
      title: r.title,
      when: at ? `${dayWords(at, tz)} at ${clockWords(at, tz)}` : "not on the calendar yet",
      who: r.assignments.map((a) => a.worker.displayName).join(", ") || null,
      status: r.status,
      cause: causeLabel(r.repairCause),
    };
    const list = out.get(r.repairOfId!) ?? [];
    list.push(row);
    out.set(r.repairOfId!, list);
  }
  return out;
}

/** Everything the repair sheet opens on, from wherever it was opened. Office only (the caller checks the role). */
export async function repairSheetData(organizationId: string, ref: RepairRef): Promise<RepairSheetData> {
  const tz = await tzOf(organizationId);
  const today = dayKey(new Date(), tz);
  let jobs: JobRow[] = [];
  let picked: string | null = null;
  let proposalOnly: RepairSheetData["proposalOnly"] = null;
  let why: string | null = null;

  if (ref.jobId) {
    const j = await originalOf(organizationId, ref.jobId);
    if (j) {
      jobs = [j];
      picked = j.id;
    } else why = "That job isn't in this company.";
  } else if (ref.proposalId) {
    const p = await db.proposal.findFirst({ where: { id: ref.proposalId, organizationId }, select: { id: true, title: true, status: true, trade: true, address: true, client: { select: { name: true, address: true, city: true } } } });
    if (!p) why = "That proposal isn't in this company.";
    else {
      jobs = await db.job.findMany({ where: { organizationId, proposalId: p.id, kind: { not: "REPAIR" } }, orderBy: { createdAt: "desc" }, select: JOB_SELECT });
      if (!jobs.length) {
        if (SOLD.includes(p.status)) proposalOnly = { id: p.id, title: p.title, client: p.client?.name ?? null, address: [p.client?.address, p.client?.city].filter(Boolean).join(", ") || p.address || null, family: repairFamilyOf(p.trade, p.title) };
        else why = "This proposal isn't sold yet — a repair goes back to work that was done.";
      }
    }
  } else if (ref.projectId || ref.clientId) {
    jobs = await db.job.findMany({
      where: { organizationId, kind: { not: "REPAIR" }, status: { not: "CANCELED" }, ...(ref.projectId ? { projectId: ref.projectId } : { clientId: ref.clientId! }) },
      orderBy: [{ updatedAt: "desc" }],
      take: 20,
      select: JOB_SELECT,
    });
    if (!jobs.length) why = ref.projectId ? "This project has no jobs yet — a repair goes back to work that was done." : "This client has no jobs yet — a repair goes back to work that was done.";
  } else why = "Open a repair from a job, a sold proposal, a project or a client.";

  // The job that came back is most likely the last one finished; else the newest.
  if (!picked && jobs.length) picked = (jobs.find((j) => j.status === "COMPLETED") ?? jobs[0]).id;

  const [workers, members, lastRepairPay, history] = await Promise.all([
    db.workerProfile.findMany({ where: { organizationId, inviteStatus: { not: "DECLINED" } }, orderBy: { displayName: "asc" }, select: { id: true, userId: true, displayName: true, phone: true, smsOptIn: true } }),
    db.membership.findMany({ where: { organizationId }, select: { userId: true, role: true } }),
    db.jobAssignment.findMany({ where: { job: { organizationId, kind: "REPAIR" }, pay: { gt: 0 } }, orderBy: { assignedAt: "desc" }, take: 80, select: { workerId: true, pay: true } }),
    historyOf(organizationId, jobs.map((j) => j.id), tz),
  ]);
  const roleOf = new Map(members.map((m) => [m.userId, m.role]));
  const usual = new Map<string, number>();
  for (const a of lastRepairPay) if (!usual.has(a.workerId)) usual.set(a.workerId, a.pay);
  // Installers first — they're who goes back; the office after, by name.
  const crew = workers
    .map((w) => ({ id: w.id, name: w.displayName, role: roleOf.get(w.userId) ?? "INSTALLER", usualPay: usual.get(w.id) ?? null, phone: !!(w.phone && w.smsOptIn) }))
    .sort((a, b) => Number(b.role === "INSTALLER") - Number(a.role === "INSTALLER") || a.name.localeCompare(b.name));

  return {
    client: jobs.find((j) => j.id === picked)?.client?.name ?? proposalOnly?.client ?? null,
    jobs: jobs.map((j) => ({
      id: j.id,
      title: j.title,
      status: j.status,
      state: stateOf(j, tz),
      client: j.client?.name ?? null,
      address: addressOf(j),
      crew: j.assignments.map((a) => ({ id: a.workerId, name: a.worker.displayName })),
      family: repairFamilyOf(j.proposal?.trade, j.title, j.proposal?.title, j.scopeOfWork),
      hasContract: !!j.proposalId,
      history: history.get(j.id) ?? [],
    })),
    picked,
    proposalOnly,
    crew,
    tz,
    today,
    why,
  };
}

/** The first open times for the repair, on one person or the installers. */
export async function repairOpenTimes(organizationId: string, input: { workerId: string | null; hours: number }): Promise<OpenTimeOffer[]> {
  const tz = await tzOf(organizationId);
  const [workers, members] = await Promise.all([
    db.workerProfile.findMany({ where: { organizationId, inviteStatus: { not: "DECLINED" } }, select: { id: true, userId: true, displayName: true } }),
    db.membership.findMany({ where: { organizationId }, select: { userId: true, role: true } }),
  ]);
  const roleOf = new Map(members.map((m) => [m.userId, m.role]));
  let people = workers.map((w) => ({ id: w.id, name: w.displayName, role: roleOf.get(w.userId) ?? "INSTALLER" }));
  if (input.workerId) people = people.filter((p) => p.id === input.workerId);
  else {
    const crew = people.filter((p) => p.role === "INSTALLER");
    if (crew.length) people = crew;
  }
  const durMin = Math.round(Math.min(12, Math.max(0.5, input.hours || 2)) * 60);
  return openTimesFor({ organizationId, tz, now: new Date(), people, durMin, count: 3 });
}

export type BookRepairInput = {
  /** The job that came back (a repair's id is read as its original). */
  jobId: string | null;
  /** A sold proposal with no job yet — its work is filed as a done job first. */
  proposalId: string | null;
  reasons: string[];
  note: string | null;
  cause: RepairCause | null;
  billable: boolean;
  /** What the client pays, before tax, when billable. */
  charge: number | null;
  /** Billable: send the change order to the client now (else it waits as a draft on the job). */
  sendChangeOrder: boolean;
  workerId: string | null;
  pay: number | null;
  /** On the company's clock; both null = no time yet (it waits on the calendar's To place list). */
  day: string | null;
  time: string | null;
  hours: number;
  /** Book even though the installer has something else then. */
  force: boolean;
  via: "sheet" | "assistant";
};

export type BookRepairResult =
  | {
      ok: true;
      jobId: string;
      title: string;
      original: { id: string; title: string };
      when: string | null;
      worker: string | null;
      /** The worker gets a text (a phone and texts switched on). */
      texted: boolean;
      changeOrder: { id: string; number: number; total: number; sent: boolean; email: string; sms: string } | null;
      /** A billable repair with no contract on the job to carry the charge. */
      chargeNote: string | null;
    }
  | { ok: false; say: string; conflicts?: Array<{ name: string; what: string; when: string }> };

/** Book a repair. The caller has checked the role (an office role); every id is checked against the company here. */
export async function bookRepair(actor: { organizationId: string; userId: string }, input: BookRepairInput): Promise<BookRepairResult> {
  const org = actor.organizationId;
  const tz = await tzOf(org);
  const reasons = cleanReasons(input.reasons);
  const note = input.note?.trim().slice(0, 1500) || null;
  if (!reasons.length && !note) return { ok: false, say: "Tick what the repair is for, or write a note — the installer has to know why they're going." };
  const cause = isCause(input.cause) ? input.cause : null;
  const charge = input.billable && input.charge != null && Number.isFinite(input.charge) && input.charge > 0 ? Math.round(input.charge * 100) / 100 : null;
  const pay = input.pay != null && Number.isFinite(input.pay) && input.pay > 0 ? Math.round(input.pay * 100) / 100 : 0;

  // The time, on the company's clock.
  let startsAt: Date | null = null;
  let endsAt: Date | null = null;
  if (input.day || input.time) {
    if (!input.day || !input.time) return { ok: false, say: "Pick both the day and the time — or leave both empty to place it on the calendar later." };
    startsAt = wallInstant(input.day, input.time, tz);
    if (!startsAt) return { ok: false, say: "I couldn't read that day or time." };
    if (startsAt.getTime() < Date.now() - 60 * 60_000) return { ok: false, say: "That time has already passed — pick a later one." };
    const hours = Math.min(12, Math.max(0.5, input.hours || 2));
    endsAt = new Date(startsAt.getTime() + hours * 3_600_000);
  }

  // Who goes.
  const worker = input.workerId ? await db.workerProfile.findFirst({ where: { id: input.workerId, organizationId: org }, select: { id: true, displayName: true, phone: true, smsOptIn: true } }) : null;
  if (input.workerId && !worker) return { ok: false, say: "That person isn't on your team." };

  // The job that came back.
  let original: JobRow | null = null;
  if (input.jobId) {
    original = await originalOf(org, input.jobId);
    if (!original) return { ok: false, say: "That job isn't in this company." };
  } else if (input.proposalId) {
    const p = await db.proposal.findFirst({ where: { id: input.proposalId, organizationId: org }, select: { id: true, title: true, status: true, clientId: true, projectId: true, scopeOfWork: true } });
    if (!p) return { ok: false, say: "That proposal isn't in this company." };
    original = await db.job.findFirst({ where: { organizationId: org, proposalId: p.id, kind: { not: "REPAIR" } }, orderBy: { createdAt: "desc" }, select: JOB_SELECT });
    if (!original) {
      if (!SOLD.includes(p.status)) return { ok: false, say: "This proposal isn't sold yet — a repair goes back to work that was done." };
      // Sold but never put in as a job (marked sold by hand): file the work as done, so the repair has its job.
      await enforcePlanLimit(org, "jobs", 1, { actorId: actor.userId });
      const made = await db.job.create({ data: { organizationId: org, title: p.title, clientId: p.clientId, proposalId: p.id, projectId: p.projectId, status: "COMPLETED", scopeOfWork: p.scopeOfWork } });
      original = await db.job.findFirst({ where: { id: made.id }, select: JOB_SELECT });
    }
  } else return { ok: false, say: "Which job came back? Open the repair from the job, the proposal, the project or the client." };
  if (!original) return { ok: false, say: "That job isn't in this company." };

  if (worker && startsAt && endsAt && !input.force) {
    const clash: Conflict[] = await crewConflicts(org, [worker.id], startsAt, endsAt, null);
    if (clash.length) {
      return {
        ok: false,
        say: `${worker.displayName} already has something then.`,
        conflicts: clash.slice(0, 4).map((c) => ({ name: c.name, what: c.what, when: `${dayWords(c.startsAt, tz)} ${clockWords(c.startsAt, tz)}–${clockWords(c.endsAt, tz)}` })),
      };
    }
  }

  await enforcePlanLimit(org, "jobs", 1, { actorId: actor.userId });
  if (startsAt) await enforcePlanLimit(org, "calendarEvents", 1, { actorId: actor.userId });

  const clientName = original.client?.name ?? null;
  const title = repairTitle(reasons, clientName).slice(0, 160);
  const scope = repairScope(reasons, note, {
    title: original.title,
    done: original.status === "COMPLETED" ? shortDay(original.endsAt ?? original.updatedAt, tz) : null,
    crew: original.assignments.map((a) => a.worker.displayName),
  });

  const repair = await db.job.create({
    data: {
      organizationId: org,
      title,
      clientId: original.clientId,
      // The contract stays the original's: a repair never carries the proposal, or the money would count twice.
      proposalId: null,
      projectId: original.projectId,
      status: "SCHEDULED",
      scopeOfWork: scope,
      startsAt,
      endsAt,
      kind: "REPAIR",
      repairOfId: original.id,
      repairReasons: JSON.stringify(reasons),
      repairCause: cause,
      repairBillable: input.billable,
      repairCharge: charge,
    },
  });

  if (startsAt && endsAt) {
    await db.jobEvent.create({ data: { organizationId: org, jobId: repair.id, createdById: actor.userId, title, startsAt, endsAt, notes: note } });
    await db.activityEvent.create({ data: { organizationId: org, actorId: actor.userId, clientId: original.clientId, kind: "SCHEDULED", summary: `Scheduled "${title}" for ${dayWords(startsAt, tz)} at ${clockWords(startsAt, tz)}` } });
    const s = startsAt;
    const e = endsAt;
    afterResponse(() => textJobScheduled(repair.id, s, e, actor.userId));
  }

  let texted = false;
  if (worker) {
    const a = await db.jobAssignment.create({ data: { jobId: repair.id, workerId: worker.id, status: "PENDING", pay } });
    texted = !!(worker.phone && worker.smsOptIn);
    afterResponse(() => textAssignmentCreated(a.id));
  }

  // Billable: the charge goes on the original contract as a change order — the client approves it and pays through
  // the same link as the rest of the job. With no contract on the job there is nothing to amend; the charge stays on
  // the repair and the office invoices it from Financials.
  let changeOrder: Extract<BookRepairResult, { ok: true }>["changeOrder"] = null;
  let chargeNote: string | null = null;
  if (input.billable && charge) {
    if (original.proposalId) {
      changeOrder = await repairChangeOrder(org, actor.userId, { jobId: original.id, proposalId: original.proposalId, repairJobId: repair.id, charge, reasons, note, send: input.sendChangeOrder });
      await db.job.update({ where: { id: repair.id }, data: { repairChangeOrderId: changeOrder.id } });
    } else chargeNote = "This job has no contract to add the charge to — the charge is noted on the repair; invoice it from Financials.";
  }

  await logActivity({
    organizationId: org,
    actorId: actor.userId,
    kind: TRAIL_KINDS.JOB,
    clientId: original.clientId,
    summary: `Booked a repair on ${original.title}: ${title}${worker ? ` — ${worker.displayName}` : ""}${startsAt ? `, ${dayWords(startsAt, tz)} at ${clockWords(startsAt, tz)}` : ", time to set"} (${causeLabel(cause).toLowerCase()}, ${input.billable ? "billable" : "warranty"})`,
    meta: { jobId: original.id, repairJobId: repair.id, via: input.via },
  });

  return {
    ok: true,
    jobId: repair.id,
    title,
    original: { id: original.id, title: original.title },
    when: startsAt ? `${dayWords(startsAt, tz)} at ${clockWords(startsAt, tz)}` : null,
    worker: worker?.displayName ?? null,
    texted,
    changeOrder,
    chargeNote,
  };
}

async function repairChangeOrder(
  org: string,
  actorId: string,
  input: { jobId: string; proposalId: string; repairJobId: string; charge: number; reasons: string[]; note: string | null; send: boolean },
): Promise<NonNullable<Extract<BookRepairResult, { ok: true }>["changeOrder"]>> {
  const proposal = await db.proposal.findFirst({ where: { id: input.proposalId, organizationId: org }, select: { taxRate: true } });
  const taxRate = normalizeTaxRate(proposal?.taxRate);
  const what = input.reasons.map((k) => reasonOf(k)?.label).filter(Boolean).join(", ") || "Repair visit";
  const lines = [{ key: "repair_visit", name: `Repair visit — ${what}`.slice(0, 160), quantity: 1, unit: "lot" as const, unitPrice: input.charge, kind: "labor" as const }];
  const totals = totalsForLines(lines, taxRate, true);
  const agg = await db.changeOrder.aggregate({ where: { proposalId: input.proposalId }, _max: { number: true }, _count: { _all: true } });
  const number = Math.max(agg._max.number ?? 0, agg._count._all) + 1;
  const reason = [`A return visit to fix: ${what}.`, input.note].filter(Boolean).join(" ").slice(0, 2000);
  const co = await db.changeOrder.create({
    data: {
      organizationId: org,
      publicToken: randomUUID(),
      jobId: input.jobId,
      proposalId: input.proposalId,
      number,
      kind: "custom",
      title: "Repair visit",
      description: reason,
      reason,
      linesJson: JSON.stringify(lines),
      photosJson: "[]",
      amount: totals.subtotal,
      taxable: true,
      taxRate: totals.taxRate,
      taxTotal: totals.taxTotal,
      total: totals.total,
      status: CO_STATUS.DRAFT,
      createdByUserId: actorId,
    },
  });
  await db.activityEvent.create({ data: { organizationId: org, actorId, proposalId: input.proposalId, kind: "CREATED", summary: `Drafted change order #${number} "Repair visit" for the repair` } });
  let sent = false;
  let email = "skipped";
  let sms = "skipped";
  if (input.send) {
    await db.changeOrder.update({ where: { id: co.id }, data: { status: CO_STATUS.SENT, sentAt: new Date() } });
    try {
      const report = await sendChangeOrderToClient(co.id);
      email = report.email;
      sms = report.sms;
      sent = true;
    } catch {
      email = "failed";
      sms = "failed";
    }
    await db.activityEvent.create({ data: { organizationId: org, actorId, proposalId: input.proposalId, kind: "SENT", summary: `Sent change order "Repair visit" — email ${email}, text ${sms}` } });
  }
  return { id: co.id, number, total: totals.total, sent, email, sms };
}

/** Change why a repair came back (the counts read it). */
export async function setRepairCause(organizationId: string, actorId: string, jobId: string, cause: RepairCause | null): Promise<{ cause: string | null }> {
  const j = await db.job.findFirst({ where: { id: jobId, organizationId, kind: "REPAIR" }, select: { id: true, title: true, repairCause: true } });
  if (!j) throw new Error("Not found");
  const next = isCause(cause) ? cause : null;
  await db.job.update({ where: { id: j.id }, data: { repairCause: next } });
  await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.JOB, summary: `Marked why ${j.title} came back: ${causeLabel(next).toLowerCase()}`, meta: { jobId: j.id } });
  return { cause: next };
}

// ── the job page ────────────────────────────────────────────────────────────

export type RepairFacts = {
  /** This job is a repair: of what, why, who pays. */
  repair: {
    of: { id: string; title: string } | null;
    reasons: string[];
    cause: string | null;
    causeLabel: string;
    billable: boolean;
    whoPays: string;
    changeOrder: { number: number | null; status: string } | null;
  } | null;
  /** This job's come-backs, newest first, and what they have cost. */
  comebacks: Array<{ id: string; title: string; when: string; who: string | null; status: string; cause: string; billable: boolean; cost: number }>;
};

export async function repairFactsFor(organizationId: string, jobId: string): Promise<RepairFacts> {
  const tz = await tzOf(organizationId);
  const j = await db.job.findFirst({
    where: { id: jobId, organizationId },
    select: { kind: true, repairReasons: true, repairCause: true, repairBillable: true, repairCharge: true, repairChangeOrderId: true, repairOf: { select: { id: true, title: true } } },
  });
  if (!j) return { repair: null, comebacks: [] };
  let repair: RepairFacts["repair"] = null;
  if (j.kind === "REPAIR") {
    const co = j.repairChangeOrderId ? await db.changeOrder.findFirst({ where: { id: j.repairChangeOrderId, organizationId }, select: { number: true, status: true } }) : null;
    repair = {
      of: j.repairOf,
      reasons: parseReasons(j.repairReasons).map((k) => reasonOf(k)!.label),
      cause: j.repairCause,
      causeLabel: causeLabel(j.repairCause),
      billable: j.repairBillable,
      whoPays: whoPaysWords(j.repairBillable, j.repairCharge),
      changeOrder: co,
    };
  }
  const rows = await db.job.findMany({
    where: { organizationId, repairOfId: jobId },
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true, status: true, repairCause: true, repairBillable: true, startsAt: true, events: { orderBy: { startsAt: "asc" }, take: 1, select: { startsAt: true } }, assignments: { select: { worker: { select: { displayName: true } } } } },
  });
  const costs = rows.length ? await jobCosts(organizationId, rows.map((r) => r.id)) : new Map();
  return {
    repair,
    comebacks: rows.map((r) => {
      const at = r.events[0]?.startsAt ?? r.startsAt;
      return {
        id: r.id,
        title: r.title,
        when: at ? `${dayWords(at, tz)} at ${clockWords(at, tz)}` : "not on the calendar yet",
        who: r.assignments.map((a) => a.worker.displayName).join(", ") || null,
        status: r.status,
        cause: causeLabel(r.repairCause),
        billable: r.repairBillable,
        cost: costs.get(r.id)?.total ?? 0,
      };
    }),
  };
}

// ── the crew's come-backs ───────────────────────────────────────────────────

export type CrewComebackStats = { comebacks: number; cost: number; sentOn: number };

/** Per worker over the last `days`: come-backs on their work ("our work" only), what those cost, repairs they were sent on. */
export async function crewComebackStats(organizationId: string, days = 365): Promise<Map<string, CrewComebackStats>> {
  const since = new Date(Date.now() - days * 86_400_000);
  const repairs = await db.job.findMany({
    where: { organizationId, kind: "REPAIR", createdAt: { gte: since } },
    select: { id: true, repairOfId: true, repairCause: true, assignments: { select: { workerId: true } }, repairOf: { select: { assignments: { select: { workerId: true } } } } },
  });
  const out = new Map<string, CrewComebackStats>();
  if (!repairs.length) return out;
  const costs = await jobCosts(organizationId, repairs.map((r) => r.id));
  const counted = countComebacks(
    repairs.map((r) => ({ repairId: r.id, repairOfId: r.repairOfId, cause: r.repairCause, originalCrew: r.repairOf?.assignments.map((a) => a.workerId) ?? [], cost: costs.get(r.id)?.total ?? 0 })),
  );
  const get = (w: string) => {
    let s = out.get(w);
    if (!s) out.set(w, (s = { comebacks: 0, cost: 0, sentOn: 0 }));
    return s;
  };
  for (const [w, c] of counted) Object.assign(get(w), c);
  for (const r of repairs) for (const a of r.assignments) get(a.workerId).sentOn += 1;
  return out;
}
