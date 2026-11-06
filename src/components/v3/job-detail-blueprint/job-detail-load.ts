// JOB DETAIL / BLUEPRINT — the server read.
//
// This is the file that turns the page from a design preview into a record.
// Both editions (desktop ./job-detail-content.tsx and handheld
// ../mobile-job-detail/mobile-job-detail.tsx) render whatever this returns, so
// they cannot describe two different jobs.
//
// THE QUERY IS THE ARCHIVED CLASSIC PAGE'S, in intent and in scope: the same
// `job.findUnique` with client / proposal / events / assignments / photos /
// expenses / changeOrders, the same `organizationId` check afterwards, and the
// same org-wide WorkerProfile roster for the assign control. Nothing new is
// read and nothing here writes — every mutation on this surface goes through
// the server actions that already existed (jobs.ts, workers.ts, jobMedia.ts,
// changeOrders.ts).
//
// DATES ARE FORMATTED HERE, ON THE SERVER, and travel as strings — see the
// header of ./job-detail-data.ts for why. The formatters are hand-rolled for
// the same reason the sibling client-detail loader hand-rolls its own: Intl
// depends on the runtime's ICU build, and the drawing style wants its own
// terse "Aug 11 → Aug 14, 2026".

import { db } from "@/lib/db";
import { isLimitedRole, isOwnerOrManager, isWorkerRole } from "@/lib/orgContext";
import { jobProgressInfo } from "@/lib/jobProgress";
import { mediaOf } from "@/lib/jobMediaShared";
import { storageMode } from "@/lib/media/privateStore";
import { mediaHref } from "@/lib/media/signedLink";
import { loadCrewBoard } from "@/components/v3/crew-board/crew-board-load";
import { contractRevenue, contractTotal } from "@/lib/contractTotal";
import { projectMoney } from "@/lib/projectMoney";
import { crewTotals, jobMoney } from "@/lib/jobCosting";
import { jobCostOf, type JobCost } from "@/lib/jobCost";
import { isTradeId, pickList } from "@/lib/inventory";
import { inventoryLinkOf, linkedTradeOf } from "@/lib/inventoryPick";
import { stockItemsOf } from "@/lib/inventoryPolicy";
import { explodeLines } from "@/lib/inventoryBom";
import { actorsOf } from "@/lib/activityLog";
import { fieldOf } from "@/lib/crewField/server";
import {
  STATUS_TO_KEY,
  type JdAssignState,
  type JdBooking,
  type JdChange,
  type JdCrew,
  type JdEvent,
  type JdExpense,
  type JdMoney,
  type JdPhoto,
  type JdPick,
  type JdPicked,
  type JdTrailRow,
  type JdWho,
  type JdWorkerOption,
  type JobDetailRecord,
} from "./job-detail-data";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "Aug 11" */
function day(d: Date): string {
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}
/** "Aug 11, 2026" */
function dayYear(d: Date): string {
  return `${day(d)}, ${d.getFullYear()}`;
}
/** "7:00 AM" */
function clock(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}
function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Page head: the job's own span. */
function headDates(startsAt: Date | null, endsAt: Date | null): string {
  if (!startsAt && !endsAt) return "No dates yet";
  if (startsAt && endsAt && !sameDay(startsAt, endsAt)) {
    return `${day(startsAt)} → ${dayYear(endsAt)}`;
  }
  const only = (startsAt ?? endsAt)!;
  return dayYear(only);
}

/** Overview's Dates cell — the same span, terser ("Aug 11 → 14"). */
function fieldDates(startsAt: Date | null, endsAt: Date | null): string {
  if (!startsAt && !endsAt) return "—";
  if (startsAt && endsAt && !sameDay(startsAt, endsAt)) {
    const tail =
      startsAt.getMonth() === endsAt.getMonth() ? String(endsAt.getDate()) : day(endsAt);
    return `${day(startsAt)} → ${tail}`;
  }
  return day((startsAt ?? endsAt)!);
}

/** WorkerProfile.specialties is a JSON array in a TEXT column. */
function firstSpecialty(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) && typeof v[0] === "string" && v[0].trim() ? v[0].trim() : null;
  } catch {
    return null;
  }
}

/** A dialable href, or null when the digits don't make a number. */
function telHref(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^\d+]/g, "");
  return digits.length >= 7 ? `tel:${digits}` : null;
}

/**
 * The window "Add to schedule" books.
 *
 * The job's OWN start is the honest default — that is the date the office
 * already agreed — but only while it is still ahead: booking a crew into last
 * month is never what the button means. Anything else falls back to tomorrow
 * 9:00–2:00, which is the span `scheduleJobFromTray` has always used for a job
 * dropped on the calendar with no time of its own.
 */
function bookingWindow(startsAt: Date | null, endsAt: Date | null): JdBooking {
  const now = new Date();
  let start: Date;
  let end: Date;
  if (startsAt && startsAt.getTime() > now.getTime()) {
    start = new Date(startsAt);
    end =
      endsAt && endsAt.getTime() > start.getTime()
        ? new Date(endsAt)
        : new Date(start.getTime() + 4 * 60 * 60 * 1000);
  } else {
    start = new Date(now);
    start.setDate(start.getDate() + 1);
    start.setHours(9, 0, 0, 0);
    end = new Date(start);
    end.setHours(14, 0, 0, 0);
  }
  const span = sameDay(start, end)
    ? `${day(start)} · ${clock(start)} – ${clock(end)}`
    : `${day(start)} ${clock(start)} → ${day(end)} ${clock(end)}`;
  return { startsAtISO: start.toISOString(), endsAtISO: end.toISOString(), label: span };
}

/** One event's date line — "Aug 11 · 7:00 AM". */
function eventWhen(startsAt: Date): string {
  return `${day(startsAt)} · ${clock(startsAt)}`;
}

/** Its second line: the author's note if there is one, else the span. */
function eventMeta(startsAt: Date, endsAt: Date, notes: string | null): string | null {
  const trimmed = notes?.trim();
  if (trimmed) return trimmed;
  return sameDay(startsAt, endsAt)
    ? `until ${clock(endsAt)}`
    : `until ${day(endsAt)} · ${clock(endsAt)}`;
}

/**
 * WHO DID WHAT ON THIS JOB (2026-09-24). ActivityEvent has no jobId column:
 * an action ties its row to a job through `meta.jobId` (lib/activityLog), so
 * the read is a substring match on the JSON — `"jobId":"<id>"` — plus every
 * row filed under the job's proposal. Newest first, forty at most. The
 * actors come from the org's memberships, so a row keeps its name and role
 * even after the member's WorkerProfile is gone.
 *
 * Also hands back who touched each photo / expense, when a row named one
 * (`meta.photoId` / `meta.expenseId`), so the lists can stamp "by <mark>".
 */
async function trailFor(
  organizationId: string,
  jobId: string,
  proposalId: string | null,
  opts: { noMoney: boolean },
): Promise<{ rows: JdTrailRow[]; photoBy: Map<string, JdWho>; expenseBy: Map<string, JdWho> }> {
  const photoBy = new Map<string, JdWho>();
  const expenseBy = new Map<string, JdWho>();
  try {
    const [events, actors] = await Promise.all([
      db.activityEvent.findMany({
        where: {
          organizationId,
          OR: [{ meta: { contains: `"jobId":"${jobId}"` } }, ...(proposalId ? [{ proposalId }] : [])],
          ...(opts.noMoney ? { kind: { notIn: ["EXPENSE", "PAY"] } } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: 40,
        select: { id: true, kind: true, summary: true, createdAt: true, actorId: true, meta: true },
      }),
      actorsOf(organizationId),
    ]);
    const rows: JdTrailRow[] = events.map((e) => {
      const who = e.actorId ? (actors.get(e.actorId) ?? { id: e.actorId, name: "Former member", role: null }) : null;
      if (who && e.meta) {
        try {
          const m = JSON.parse(e.meta) as { photoId?: unknown; expenseId?: unknown };
          if (typeof m.photoId === "string" && !photoBy.has(m.photoId)) photoBy.set(m.photoId, who);
          if (typeof m.expenseId === "string" && !expenseBy.has(m.expenseId)) expenseBy.set(m.expenseId, who);
        } catch {
          /* a row without readable meta is still a row */
        }
      }
      return { id: e.id, kind: e.kind, summary: e.summary, at: eventWhen(e.createdAt), who };
    });
    return { rows, photoBy, expenseBy };
  } catch {
    // The trail is a reading aid; a job page never fails on it.
    return { rows: [], photoBy, expenseBy };
  }
}

const ASSIGNMENT_STATE: Record<string, JdCrew["state"]> = {
  ACCEPTED: "ok",
  COMPLETED: "ok",
  PENDING: "wait",
  DECLINED: "no",
};

/** The reader's OWN assignment, which keeps COMPLETED apart from ACCEPTED —
 *  see the note on `JdAssignState`. */
const OWN_ASSIGNMENT_STATE: Record<string, JdAssignState> = {
  ACCEPTED: "ok",
  COMPLETED: "done",
  PENDING: "wait",
  DECLINED: "no",
};

function directionsUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

/**
 * A Google Calendar "add event" template for the job's own span. Ends four
 * hours after the start when the job has no end, which is the same default
 * length `bookingWindow` above falls back to.
 */
function calendarUrl(
  title: string,
  start: Date,
  end: Date | null,
  location: string | null,
): string {
  const stamp = (d: Date) =>
    new Date(d).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const finish = end ?? new Date(new Date(start).getTime() + 4 * 60 * 60 * 1000);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: title,
    dates: `${stamp(start)}/${stamp(finish)}`,
    ...(location ? { location } : {}),
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

const CHANGE_STATE: Record<string, JdChange["state"]> = {
  DRAFT: "draft",
  SENT: "sent",
  APPROVED: "ok",
  DECLINED: "no",
  VOID: "void",
};

/**
 * The job behind `[id]`, scoped to the caller's org, shaped for the page.
 * Returns null when the id resolves to nothing this org owns — the page turns
 * that into a 404 rather than inventing a job, which is the whole point of
 * deleting the fixture.
 *
 * A field worker takes ../job-detail-load.ts's OTHER read (below): a narrower
 * query, assignment-scoped, with the money columns never selected. One entry
 * point so the page cannot pick the wrong one, and `userId` is required to take
 * that branch — no user, no assignment, no record.
 */
export async function loadJobDetail(
  id: string,
  organizationId: string,
  role: string,
  userId?: string,
): Promise<JobDetailRecord | null> {
  if (isWorkerRole(role)) {
    return userId ? loadWorkerScoped(id, organizationId, userId) : null;
  }
  const job = await db.job.findUnique({
    where: { id },
    include: {
      client: true,
      project: { select: { id: true, name: true } },
      proposal: {
        select: {
          id: true,
          title: true,
          total: true,
          taxTotal: true,
          // The job's money card: the lines' material / labor split and what
          // the client has actually paid, less refunds (lib/jobCosting).
          trade: true,
          description: true,
          lineItems: { select: { name: true, measurementType: true, quantity: true, materialCost: true, laborCost: true } },
          payments: { where: { status: { in: ["PAID", "PARTIAL", "PARTIALLY_REFUNDED"] } }, select: { amount: true, refundedAmount: true } },
          changeOrders: { orderBy: { createdAt: "asc" } },
        },
      },
      events: { orderBy: { startsAt: "asc" } },
      assignments: {
        include: {
          worker: {
            select: { id: true, displayName: true, phone: true, specialties: true },
          },
        },
        orderBy: { assignedAt: "asc" },
      },
      photos: { orderBy: { createdAt: "desc" } },
      expenses: { orderBy: { createdAt: "desc" } },
      changeOrders: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!job || job.organizationId !== organizationId) return null;

  // The assign control's candidates: the org's roster minus whoever is already
  // on this job. A worker who DECLINED the org invite is not on the team, so
  // they are not offered either.
  const assignedIds = new Set(job.assignments.map((a) => a.workerId));
  const roster: JdWorkerOption[] = (
    await db.workerProfile.findMany({
      where: { organizationId, inviteStatus: { not: "DECLINED" } },
      select: { id: true, displayName: true, phone: true, specialties: true },
      orderBy: { displayName: "asc" },
    })
  )
    .filter((w) => !assignedIds.has(w.id))
    .map((w) => ({
      id: w.id,
      name: w.displayName,
      meta: [firstSpecialty(w.specialties), w.phone].filter(Boolean).join(" · ") || null,
    }));

  const events: JdEvent[] = job.events.map((e) => ({
    id: e.id,
    title: e.title,
    when: eventWhen(e.startsAt),
    meta: eventMeta(e.startsAt, e.endsAt, e.notes),
  }));

  const crew: JdCrew[] = job.assignments.map((a) => ({
    assignmentId: a.id,
    workerId: a.workerId,
    name: a.worker.displayName,
    pay: a.pay,
    paidAt: a.paidAt ? a.paidAt.toISOString() : null,
    meta:
      [firstSpecialty(a.worker.specialties) ?? "Crew", a.worker.phone]
        .filter(Boolean)
        .join(" · ") || "Crew",
    state: ASSIGNMENT_STATE[a.status] ?? "wait",
    // The office is not on the crew list; nothing to mark.
    me: false,
  }));

  // THE JOB'S OWN MONEY (2026-09-20). Every figure is already on this record:
  // the contract is the proposal plus its approved change orders, and the
  // actual cost is the crew's pay plus the booked receipts (lib/jobCosting).
  // The booked cost is lib/jobCost's — the ONE function Financials' "Cost by
  // job" reads too (stage D), so the two agree to the cent: crew pay, approved
  // receipts, and stock issued to the job at the movements' prices.
  // The profit is worked before sales tax, and the plan is NOT the lines'
  // material / labor columns — the builder splits the price there, not the
  // cost (2026-11-04). A project's job is planned at the project's own cost
  // share (its cost budget ÷ what its proposals price — lib/projectMoney), so
  // the job and its project tell one story; any other job has no plan.
  const cost = await jobCostOf(organizationId, job.id);
  const revenue = job.proposal ? contractRevenue(job.proposal.total, job.proposal.taxTotal, job.proposal.changeOrders) : 0;
  const share = job.projectId ? ((await projectMoney(organizationId, [job.projectId])).get(job.projectId)?.costShare ?? null) : null;
  const m = jobMoney({
    contract: job.proposal ? contractTotal(job.proposal.total, job.proposal.changeOrders) : 0,
    revenue,
    collected: job.proposal ? job.proposal.payments.reduce((a, p) => a + Math.max(0, p.amount - (p.refundedAmount ?? 0)), 0) : 0,
    lines: job.proposal?.lineItems ?? [],
    plannedCost: share != null ? revenue * share : 0,
    crewPay: [cost.crew],
    expenses: [cost.receipts],
    pendingExpenses: [cost.receiptsPending],
    stock: cost.stock,
  });
  const money: JdMoney = {
    contract: m.contract,
    revenue: m.revenue,
    salesTax: m.salesTax,
    planFrom: share != null ? "project" : null,
    collected: m.collected,
    outstanding: m.outstanding,
    plannedCost: m.planned.total,
    crew: m.crew,
    crewUnpaid: crewTotals(job.assignments.map((a) => ({ assignmentId: a.id, workerId: a.workerId, name: a.worker.displayName, pay: a.pay, paidAt: a.paidAt ? a.paidAt.toISOString() : null }))).unpaid,
    expenses: m.expenses,
    expensesPending: m.expensesPending,
    stock: m.stock,
    stockUnpriced: cost.unpriced,
    cost: m.cost,
    costIsPlanned: m.costIsPlanned,
    costKnown: m.costKnown,
    profit: m.profit,
    marginPct: m.marginPct,
    plannedProfit: m.plannedProfit,
    costVariance: m.costVariance,
  };
  // An estimate only (inventoryLinked false) has no pick list; an unstamped
  // proposal is placed by its materials or title (lib/inventoryPick).
  const linkChoice = job.proposalId ? ((await inventoryLinkOf(organizationId, [job.proposalId])).get(job.proposalId) ?? null) : null;
  const pickTrade = job.proposal ? linkedTradeOf({ ...job.proposal, inventoryLinked: linkChoice, lineItems: job.proposal.lineItems.filter((l) => l.materialCost > 0) }) : null;
  const pick = await pickFor(organizationId, pickTrade, job.proposal?.lineItems.filter((l) => l.materialCost > 0) ?? []);

  // A change order amends the proposal (the contract) or, legacy, the job
  // itself; the job page shows both sets as one list, oldest first.
  const seenCo = new Set<string>();
  const allCos = [...job.changeOrders, ...(job.proposal?.changeOrders ?? [])]
    .filter((c) => (seenCo.has(c.id) ? false : (seenCo.add(c.id), true)))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const changes: JdChange[] = allCos.map((c, i) => ({
    id: c.id,
    ref: `CO-${c.number ?? i + 1}`,
    title: c.title,
    meta:
      (c.reason ?? c.description)?.trim() ||
      (c.status === "APPROVED" && c.approvedName ? `approved by ${c.approvedName}` : `logged ${day(c.createdAt)}`),
    // Tax-inclusive when itemized; the legacy signed amount otherwise.
    amount: c.total ?? c.amount,
    state: CHANGE_STATE[c.status] ?? "draft",
    publicToken: c.publicToken,
  }));

  const trail = await trailFor(organizationId, job.id, job.proposalId, { noMoney: false });

  const photos: JdPhoto[] = job.photos.map((p) => ({
    id: p.id,
    // Private files are read through a short signed link (stage B).
    url: mediaHref(p.url) ?? p.url,
    kind: p.kind ? p.kind.charAt(0) + p.kind.slice(1).toLowerCase() : "Photo",
    media: mediaOf(p).media,
    caption: p.caption?.trim() || `Added ${day(p.createdAt)}`,
    by: trail.photoBy.get(p.id) ?? null,
  }));

  const expenses: JdExpense[] = job.expenses.map((e) => ({
    id: e.id,
    vendor: e.category,
    meta: e.note?.trim() || `logged ${day(e.createdAt)}`,
    amount: e.amount,
    status: e.status,
    paidBy: e.paidBy,
    editedAt: e.editedAt ? e.editedAt.toISOString() : null,
    by: trail.expenseBy.get(e.id) ?? null,
  }));

  const addressLine =
    [job.client?.address, job.client?.city, job.client?.state, job.client?.zip]
      .filter(Boolean)
      .join(", ")
      .trim() || null;

  return {
    id: job.id,
    title: job.title,
    status: STATUS_TO_KEY[job.status] ?? "sch",
    dates: headDates(job.startsAt, job.endsAt),
    undated: !job.startsAt && !job.endsAt,
    fieldDates: fieldDates(job.startsAt, job.endsAt),
    clientName: job.client?.name ?? null,
    scopeOfWork: job.scopeOfWork?.trim() || null,
    notes: job.notes?.trim() || null,
    contact: job.client
      ? {
          name: job.client.name,
          phone: job.client.phone,
          phoneHref: telHref(job.client.phone),
          email: job.client.email,
          address: addressLine,
        }
      : null,
    // `Job.proposalId` decides the whole proposal section. The include above
    // resolves it to a row; a dangling id (proposal deleted) reads as no
    // proposal, which is the honest answer — there is nothing to open.
    // The button shows what the client owes now — with the approved change
    // orders, as the money card does (2026-11-04).
    proposal: job.proposal
      ? { id: job.proposal.id, title: job.proposal.title, total: contractTotal(job.proposal.total, job.proposal.changeOrders) }
      : null,
    project: job.project ? { id: job.project.id, name: job.project.name } : null,
    // Both worker-edition affordances. The office record is unchanged: it has
    // "Add to schedule", which books the CREW, and a desk.
    directionsUrl: null,
    calendarUrl: null,
    events,
    crew,
    changes,
    photos,
    expenses,
    trail: trail.rows,
    progress: await jobProgressInfo(organizationId, job.id),
    blobEnabled: storageMode() !== "inline",
    money,
    pick,
    pickTrade,
    loadedAt: job.materialsLoadedAt ? job.materialsLoadedAt.toISOString() : null,
    picked: pickedRows(cost),
    roster,
    booking: bookingWindow(job.startsAt, job.endsAt),
    canWrite: isOwnerOrManager(role),
    canPhotos: isOwnerOrManager(role),
    viewer: "manager",
    assignment: null,
    myAssignmentId: null,
    // The office reads the board as the office; a sales or estimator seat reads
    // it and works nothing (the loader was opened to them read-only).
    board: await loadCrewBoard(organizationId, job.id, { userId: userId ?? "", office: !isLimitedRole(role), canWork: !isLimitedRole(role) }),
    door: { kind: "session" },
    chrome: "dashboard",
    portal: null,
    field: await fieldOf(organizationId, job.id, { workerId: null, office: !isLimitedRole(role) }),
  };
}

/**
 * THE FIELD WORKER'S READ — the same `JobDetailRecord`, narrower.
 *
 * ── THE ACCESS RULE IS THE WHERE CLAUSE ────────────────────────────────────
 * The job is found by `{ id, organizationId, assignments: { some: { workerId } } }`,
 * so a worker can never open a job they are not on: the rule cannot be dropped
 * by a later edit the way a check written after the query can. No WorkerProfile
 * for this user is the same answer as no job — null, which the page turns into
 * a 404. That is also the honest answer for a job that exists but belongs to
 * someone else's crew: a 403 would confirm it exists.
 *
 * ── WHAT IS NOT SELECTED IS THE DISCLOSURE RULE ────────────────────────────
 * No expenses, no change orders, no proposal, no roster, and a client reduced
 * to name + address — the columns the pre-blueprint worker view read, exactly.
 * The withholding is done HERE rather than in the markup: a record that never
 * carried the number cannot leak it through a component someone edits later.
 */
async function loadWorkerScoped(
  id: string,
  organizationId: string,
  userId: string,
): Promise<JobDetailRecord | null> {
  const wp = await db.workerProfile.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (!wp) return null;

  const job = await db.job.findFirst({
    where: { id, organizationId, assignments: { some: { workerId: wp.id } } },
    include: {
      // Name and address only — see the header's disclosure note.
      client: { select: { name: true, address: true, city: true, state: true, zip: true } },
      // The pick list only: material lines by name and count — no price
      // column is selected, so the worker's record still carries no money.
      proposal: { select: { trade: true, title: true, description: true, lineItems: { where: { materialCost: { gt: 0 } }, select: { name: true, measurementType: true, quantity: true } } } },
      events: { orderBy: { startsAt: "asc" } },
      photos: { orderBy: { createdAt: "desc" } },
      assignments: {
        // Specialty, not phone: a crewmate's number is the office's to give
        // out, and the pre-blueprint view never printed one.
        include: { worker: { select: { displayName: true, specialties: true } } },
        orderBy: { assignedAt: "asc" },
      },
    },
  });
  if (!job) return null;

  const addressLine =
    [job.client?.address, job.client?.city, job.client?.state, job.client?.zip]
      .filter(Boolean)
      .join(", ")
      .trim() || null;

  const events: JdEvent[] = job.events.map((e) => ({
    id: e.id,
    title: e.title,
    when: eventWhen(e.startsAt),
    meta: eventMeta(e.startsAt, e.endsAt, e.notes),
  }));

  const crew: JdCrew[] = job.assignments.map((a) => ({
    assignmentId: a.id,
    workerId: a.workerId,
    name: a.worker.displayName,
    // A worker sees their OWN pay and nobody else's — the one money fact
    // this record carries (2026-09-20).
    pay: a.workerId === wp.id ? a.pay : 0,
    paidAt: a.workerId === wp.id && a.paidAt ? a.paidAt.toISOString() : null,
    meta: firstSpecialty(a.worker.specialties) ?? "Crew",
    state: ASSIGNMENT_STATE[a.status] ?? "wait",
    me: a.workerId === wp.id,
  }));

  // The crew's trail: who did what on the job, minus the rows that name money.
  const trail = await trailFor(organizationId, job.id, job.proposalId, { noMoney: true });
  const pickTrade = job.proposal ? linkedTradeOf({ ...job.proposal, inventoryLinked: job.proposalId ? ((await inventoryLinkOf(organizationId, [job.proposalId])).get(job.proposalId) ?? null) : null }) : null;

  const photos: JdPhoto[] = job.photos.map((p) => ({
    id: p.id,
    // Private files are read through a short signed link (stage B).
    url: mediaHref(p.url) ?? p.url,
    kind: p.kind ? p.kind.charAt(0) + p.kind.slice(1).toLowerCase() : "Photo",
    media: mediaOf(p).media,
    caption: p.caption?.trim() || `Added ${day(p.createdAt)}`,
    by: trail.photoBy.get(p.id) ?? null,
  }));

  // The WHERE clause guarantees one, but `find` is still typed as optional.
  const own = job.assignments.find((a) => a.workerId === wp.id)?.status ?? "PENDING";

  return {
    id: job.id,
    title: job.title,
    status: STATUS_TO_KEY[job.status] ?? "sch",
    dates: headDates(job.startsAt, job.endsAt),
    undated: !job.startsAt && !job.endsAt,
    fieldDates: fieldDates(job.startsAt, job.endsAt),
    clientName: job.client?.name ?? null,
    scopeOfWork: job.scopeOfWork?.trim() || null,
    notes: job.notes?.trim() || null,
    contact: job.client
      ? {
          name: job.client.name,
          phone: null,
          phoneHref: null,
          email: null,
          address: addressLine,
        }
      : null,
    proposal: null,
    project: null,
    directionsUrl: addressLine ? directionsUrl(addressLine) : null,
    calendarUrl: job.startsAt
      ? calendarUrl(job.title, job.startsAt, job.endsAt, addressLine)
      : null,
    events,
    crew,
    changes: [],
    photos,
    expenses: [],
    trail: trail.rows,
    progress: await jobProgressInfo(organizationId, job.id),
    blobEnabled: storageMode() !== "inline",
    money: null,
    pick: await pickFor(organizationId, pickTrade, job.proposal?.lineItems ?? []),
    pickTrade,
    loadedAt: job.materialsLoadedAt ? job.materialsLoadedAt.toISOString() : null,
    picked: pickedRows(await jobCostOf(organizationId, job.id)),
    roster: [],
    // Never read — `canWrite` is false, so nothing on this edition books
    // anything — but the shape is the shape.
    booking: bookingWindow(job.startsAt, job.endsAt),
    canWrite: false,
    // A worker only reaches this loader through their own assignment, and the
    // crew documents the work: photos are theirs to add (upload re-checks the
    // assignment server-side).
    canPhotos: true,
    viewer: "worker",
    assignment: OWN_ASSIGNMENT_STATE[own] ?? "wait",
    myAssignmentId: job.assignments.find((a) => a.workerId === wp.id)?.id ?? null,
    // The crew reads the board as crew; a declined assignment reads it and works nothing.
    board: await loadCrewBoard(organizationId, job.id, { userId, office: false, canWork: own !== "DECLINED" }),
    door: { kind: "session" },
    chrome: "dashboard",
    portal: null,
    field: await fieldOf(organizationId, job.id, { workerId: wp.id, office: false }),
  };
}

/**
 * The worker's record for the PORTAL (stage C, 2026-09-30): the same read as
 * the dashboard's worker branch — the job found only through the worker's own
 * assignment, no money — keyed by the magic link instead of a session, and
 * framed for the portal. Null when the token or the assignment does not hold.
 */
export async function loadJobDetailForPortal(token: string, assignmentId: string): Promise<JobDetailRecord | null> {
  const worker = await db.workerProfile.findUnique({ where: { token }, select: { id: true, userId: true, organizationId: true, displayName: true, organization: { select: { name: true } } } });
  if (!worker) return null;
  const a = await db.jobAssignment.findUnique({ where: { id: assignmentId }, select: { workerId: true, jobId: true } });
  if (!a || a.workerId !== worker.id) return null;
  const record = await loadWorkerScoped(a.jobId, worker.organizationId, worker.userId);
  if (!record) return null;
  return {
    ...record,
    door: { kind: "token", token },
    chrome: "portal",
    portal: { workerName: worker.displayName, orgName: worker.organization?.name ?? null, backHref: `/w/${token}` },
  };
}

/**
 * The crew's pick list for a job: the proposal's material lines against the
 * warehouse's items for that trade. A job with no trade still lists its
 * materials — the crew still brings them — with nothing on the shelf to check.
 */
async function pickFor(organizationId: string, trade: string | null, lines: Array<{ name: string; measurementType: string; quantity: number }>): Promise<JdPick[]> {
  if (!lines.length) return [];
  // The stock policy rides along (lib/inventoryPolicy): a per-job item is "ordered for this job", not "short".
  const items = isTradeId(trade) ? await stockItemsOf(organizationId, trade) : [];
  return pickList(items, explodeLines(trade, lines.map((l) => ({ name: l.name, quantity: l.quantity, unit: l.measurementType.toLowerCase().replace("_", " ") })))).map((r) => ({
    name: r.name,
    unit: r.unit,
    quantity: r.quantity,
    tracked: r.itemId !== null,
    enough: r.enough,
    onHand: r.onHand,
    perJob: r.perJob,
  }));
}

/** What is out on the job from the warehouse — issued (PICKED + USED) and
 *  returned, per item — off the job's cost (lib/jobCost). */
function pickedRows(cost: JobCost): JdPicked[] {
  return cost.stockLines.map((l) => ({ itemId: l.itemId, name: l.name, unit: l.unit, taken: l.taken, returned: l.returned }));
}
