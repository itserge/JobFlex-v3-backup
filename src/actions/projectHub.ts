"use server";
// THE PROJECTS HUB (owner, 2026-11-04: "make it really a smart projects hub where you run all of it"). Two writes the
// project page makes that no other page did:
//
//   combineProjectProposals — the project's open proposals as ONE proposal for the client ("all separated estimates
//                             … combined in one big proposal"). A new draft through saveProposal, the builder's own
//                             create, with every line at the exact price the client was quoted; the originals are
//                             archived so the pipeline never counts the work twice.
//   scheduleProjectJob      — a job's work days and its crew in one step ("send the crew who's gonna be doing this …
//                             and put it on a schedule"). The days go on first, so the crew's notice carries them; the
//                             assignments are the job page's own actions (assignWorker / unassignAssignment).
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireEstimatorOrManager, requireManager } from "@/lib/orgContext";
import { enforcePlanLimit } from "@/lib/limitsEngine";
import { afterResponse } from "@/lib/server-events";
import { textJobScheduled } from "@/lib/sms/schedule";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { saveProposal } from "@/actions/proposals";
import { assignWorker, unassignAssignment } from "@/actions/workers";
import { withFeature } from "@/lib/customPageAccess";

const OPEN = ["DRAFT", "SENT", "VIEWED"];
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const combineInput = z.object({
  projectId: z.string().min(1),
  proposalIds: z.array(z.string().min(1)).min(2).max(20),
  title: z.string().trim().min(1).max(160),
});

/** The project's open proposals as one new draft; returns its id for the builder. */
export async function combineProjectProposals(raw: unknown): Promise<{ id: string }> {
  const { organizationId, user } = await withFeature(requireEstimatorOrManager(), "project-tools");
  const data = combineInput.parse(raw);
  const project = await db.project.findFirst({ where: { id: data.projectId, organizationId }, select: { id: true, name: true, clientId: true } });
  if (!project) throw new Error("Not found");
  const sources = await db.proposal.findMany({
    where: { id: { in: data.proposalIds }, organizationId, projectId: project.id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      title: true,
      status: true,
      clientId: true,
      address: true,
      description: true,
      scopeOfWork: true,
      subtotal: true,
      discountTotal: true,
      taxRate: true,
      taxTotal: true,
      total: true,
      lineItems: { orderBy: { position: "asc" } },
    },
  });
  if (sources.length !== new Set(data.proposalIds).size) throw new Error("A proposal is no longer in this project");
  const sold = sources.find((p) => !OPEN.includes(p.status));
  if (sold) throw new Error(`"${sold.title}" is already ${sold.status.toLowerCase()} — only open proposals are combined`);
  const clients = new Set(sources.map((p) => p.clientId ?? project.clientId ?? ""));
  if (clients.size > 1) throw new Error("These proposals are for different clients");

  // Every line at the price the client saw. A stored line carries its SELL price, and its material / labor columns are
  // the split before the source's markup — so the split is scaled to that price and the new draft is written at 0%
  // markup: the same unit price, the same total, to the cent (lib/pricing/markup sellUnitPrice).
  const lineItems = sources.flatMap((p) =>
    p.lineItems.map((l) => {
      const split = (l.materialCost ?? 0) + (l.laborCost ?? 0);
      const materialCost = split > 0 ? r2((l.materialCost * l.unitPrice) / split) : 0;
      return {
        name: `${p.title} — ${l.name}`.slice(0, 200),
        description: l.description ?? undefined,
        measurementType: l.measurementType as never,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        materialCost,
        laborCost: split > 0 ? r2(l.unitPrice - materialCost) : 0,
        store: l.store,
        productUrl: l.productUrl,
        imageUrl: l.imageUrl,
        dimensions: l.dimensions,
      };
    }),
  );
  if (!lineItems.length) throw new Error("These proposals have no lines to combine");

  // One tax rate when they share it; else the rate that charges the same tax on the same taxable amount.
  const rates = new Set(sources.map((p) => p.taxRate));
  const taxable = sources.reduce((n, p) => n + Math.max(0, p.subtotal - p.discountTotal), 0);
  const taxRate = rates.size === 1 ? sources[0].taxRate : taxable > 0 ? Math.round((sources.reduce((n, p) => n + p.taxTotal, 0) / taxable) * 1e6) / 1e6 : 0;
  const discount = r2(sources.reduce((n, p) => n + p.discountTotal, 0));
  const scope = sources
    .filter((p) => p.scopeOfWork?.trim())
    .map((p) => `${p.title}\n${p.scopeOfWork!.trim()}`)
    .join("\n\n");

  const made = await saveProposal({
    title: data.title,
    clientId: [...clients][0] || null,
    projectId: project.id,
    description: `One proposal for ${sources.map((p) => p.title).join(", ")}.`,
    scopeOfWork: scope || undefined,
    address: sources.find((p) => p.address)?.address ?? undefined,
    taxRate,
    lineItems,
    installments: [],
    discount: discount > 0 ? { label: "Discount", amount: discount, isPercent: false } : null,
    materialMarkupPct: 0,
    laborMarkupPct: 0,
    overheadPct: 0,
    profitPct: 0,
  });

  await db.proposal.updateMany({ where: { id: { in: sources.map((p) => p.id) }, organizationId, status: { in: OPEN } }, data: { status: "ARCHIVED" } });
  await logActivity({
    organizationId,
    actorId: user.id,
    kind: TRAIL_KINDS.PROJECT,
    summary: `Combined ${sources.length} proposals into "${data.title}" (${project.name}) — the originals are archived`,
    proposalId: made.id,
    clientId: [...clients][0] || null,
    meta: { projectId: project.id, from: sources.map((p) => p.id) },
  });
  revalidatePath(`/dashboard/projects/${project.id}`);
  revalidatePath("/dashboard/proposals");
  return { id: made.id };
}

const scheduleInput = z.object({
  jobId: z.string().min(1),
  /** One block per work day, as ISO moments made in the office's own browser (its time zone and its work week). */
  days: z
    .array(z.object({ startsAt: z.string().datetime(), endsAt: z.string().datetime() }))
    .min(1)
    .max(120),
  workerIds: z.array(z.string().min(1)).max(40),
});

/** The note on a calendar visit this sheet laid out — how the next save knows which visits are its own to replace. */
const PLAN_NOTE = "Project schedule";

/** A project's empty start and end, as days (UTC midnight of the company's own day — how Edit project stores them). */
async function fillProjectWindow(organizationId: string, projectId: string, first: Date, last: Date): Promise<void> {
  const p = await db.project.findFirst({ where: { id: projectId, organizationId }, select: { startsAt: true, endsAt: true, organization: { select: { timezone: true } } } });
  if (!p || (p.startsAt && p.endsAt)) return;
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: p.organization.timezone || "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
  const dayOf = (d: Date) => new Date(`${fmt.format(d)}T00:00:00.000Z`);
  await db.project.update({ where: { id: projectId }, data: { ...(p.startsAt ? {} : { startsAt: dayOf(first) }), ...(p.endsAt ? {} : { endsAt: dayOf(last) }) } });
}

/** A project job's work days and crew in one step. */
export async function scheduleProjectJob(raw: unknown): Promise<{ added: number; removed: number; kept: string[]; days: number; others: number }> {
  const { organizationId, user } = await withFeature(withFeature(requireManager(), "project-tools"), "calendar");
  const data = scheduleInput.parse(raw);
  const days = data.days
    .map((d) => ({ startsAt: new Date(d.startsAt), endsAt: new Date(d.endsAt) }))
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  if (days.some((d) => d.endsAt.getTime() <= d.startsAt.getTime())) throw new Error("A work day ends before it starts");
  const startsAt = days[0].startsAt;
  const endsAt = days[days.length - 1].endsAt;
  const job = await db.job.findFirst({
    where: { id: data.jobId, organizationId },
    select: {
      id: true,
      title: true,
      status: true,
      projectId: true,
      proposalId: true,
      clientId: true,
      startsAt: true,
      endsAt: true,
      events: { orderBy: { startsAt: "asc" }, select: { id: true, startsAt: true, endsAt: true, notes: true } },
      assignments: { select: { id: true, workerId: true, pay: true, paidAt: true, worker: { select: { displayName: true } } } },
    },
  });
  if (!job) throw new Error("Not found");
  const workers = data.workerIds.length
    ? await db.workerProfile.findMany({ where: { id: { in: data.workerIds }, organizationId }, select: { id: true } })
    : [];
  if (workers.length !== new Set(data.workerIds).size) throw new Error("A worker is no longer on the team");

  // THE CALENDAR SHOWS A JOB BY ITS VISITS, one block a day — a single visit stretched over two weeks is drawn on its
  // first day only. So the job's span goes on the job, and each work day becomes its own visit. This sheet's visits
  // (PLAN_NOTE), and a lone visit that is simply the job's old span, are replaced; any other visit someone put on the
  // calendar by hand stays as it is.
  const span = (e: { startsAt: Date; endsAt: Date }) =>
    !!job.startsAt && !!job.endsAt && e.startsAt.getTime() === job.startsAt.getTime() && e.endsAt.getTime() === job.endsAt.getTime();
  const mine = job.events.filter((e) => e.notes === PLAN_NOTE || (job.events.length === 1 && span(e)));
  const others = job.events.length - mine.length;
  const same =
    mine.length === days.length &&
    mine.every((e, i) => e.startsAt.getTime() === days[i].startsAt.getTime() && e.endsAt.getTime() === days[i].endsAt.getTime());
  const moved = job.startsAt?.getTime() !== startsAt.getTime() || job.endsAt?.getTime() !== endsAt.getTime();

  if (!same) {
    if (days.length > mine.length) await enforcePlanLimit(organizationId, "calendarEvents", days.length - mine.length);
    if (mine.length) await db.jobEvent.deleteMany({ where: { id: { in: mine.map((e) => e.id) }, organizationId } });
    await db.jobEvent.createMany({
      data: days.map((d) => ({ organizationId, jobId: job.id, createdById: user.id, title: job.title, startsAt: d.startsAt, endsAt: d.endsAt, notes: PLAN_NOTE })),
    });
  }
  if (moved) {
    await db.job.update({
      where: { id: job.id },
      data: { startsAt, endsAt, status: job.status === "CANCELED" ? "SCHEDULED" : job.status },
    });
    afterResponse(() => textJobScheduled(job.id, startsAt, endsAt, user.id));
  }
  // The project's window, when it has none yet, from the first and last work day (2026-11-06: an automatic project
  // read "—" under Window on the Projects list until someone typed its dates into Edit project).
  if (job.projectId) await fillProjectWindow(organizationId, job.projectId, startsAt, endsAt).catch(() => null);

  const want = new Set(data.workerIds);
  const have = new Set(job.assignments.map((a) => a.workerId));
  const add = [...want].filter((id) => !have.has(id));
  // Taking someone off deletes their assignment, and their pay on the job with it: anyone with pay set or paid stays
  // on, and the page says so — the job page's crew card is where pay is settled first.
  const off = job.assignments.filter((a) => !want.has(a.workerId));
  const hasPay = (a: (typeof off)[number]) => a.pay > 0 || !!a.paidAt;
  const drop = off.filter((a) => !hasPay(a));
  const kept = off.filter(hasPay).map((a) => a.worker.displayName);
  for (const id of add) await assignWorker(job.id, id);
  for (const a of drop) await unassignAssignment(a.id);

  if (moved || !same) {
    await logActivity({
      organizationId,
      actorId: user.id,
      kind: TRAIL_KINDS.JOB,
      summary: `Scheduled ${job.title} from its project — ${days.length} work day${days.length === 1 ? "" : "s"}`,
      proposalId: job.proposalId,
      clientId: job.clientId,
      meta: { jobId: job.id, projectId: job.projectId ?? undefined, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() },
    });
  }
  if (job.projectId) revalidatePath(`/dashboard/projects/${job.projectId}`);
  revalidatePath(`/dashboard/jobs/${job.id}`);
  revalidatePath("/dashboard/jobs");
  revalidatePath("/dashboard/calendar");
  return { added: add.length, removed: drop.length, kept, days: days.length, others };
}
