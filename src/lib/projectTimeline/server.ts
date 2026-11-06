import "server-only";
// THE PROJECT TIMELINE — the database half (the timeline build, 2026-11-06). The rules are ./shared.ts.
//
//   · timelineOf   — what the Timeline card draws: the stages with their days, the deliveries and inspections
//                    on them, the crew's days on the calendar, today in the company's time zone.
//   · shiftRest    — "Shift the rest" applied: the stage ends later, the stages after it, the crew's future
//                    visits and the pending inspections move by N work days (shared shiftPlan decides what).
//   · layoutStages — days for the stages that have none, back to back from a day (shared layoutPlan).
//   · crewBusy     — who of the crew is already somewhere else on the days the office is about to book (the
//                    Schedule & crew sheet's warning; the Operator's heads-up).

import { db } from "@/lib/db";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { localDayKey } from "@/lib/jobProgressShared";
import { stagesOf, type StageRow } from "@/lib/projectStages/server";
import { dayKeyIn, isoDay, layoutPlan, shiftPlan, type ShiftPlan } from "./shared";

async function tzOf(organizationId: string): Promise<string> {
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } });
  return org?.timezone || "America/New_York";
}

const dayOf = (s: string | null) => (s ? new Date(`${s}T00:00:00.000Z`) : null);

// ── the read ─────────────────────────────────────────────────────────────────

export type TimelineInspection = { id: string; name: string; date: string | null; readyNote: string | null; isFinal: boolean; result: string; resultNote: string | null; resultAt: string | null; stageId: string | null; stageName: string | null };
export type TimelineDelivery = { id: string; number: number; stageId: string | null; day: string; status: string; from: string };
export type TimelineRead = {
  today: string;
  tz: string;
  stages: StageRow[];
  inspections: TimelineInspection[];
  /** Orders with a day to draw: expected, or delivered. */
  deliveries: TimelineDelivery[];
  /** The crew's days on the calendar, by day key, with who is on each. */
  crewDays: Array<{ day: string; jobId: string; jobTitle: string }>;
  jobs: Array<{ id: string; title: string; status: string; startsAt: string | null; endsAt: string | null }>;
};

export async function timelineOf(organizationId: string, projectId: string): Promise<TimelineRead> {
  const tz = await tzOf(organizationId);
  const today = localDayKey(new Date(), tz);
  const [read, inspections, orders, jobs] = await Promise.all([
    stagesOf(projectId),
    db.projectInspection.findMany({ where: { projectId }, orderBy: [{ date: "asc" }, { createdAt: "asc" }], select: { id: true, name: true, date: true, readyNote: true, isFinal: true, result: true, resultNote: true, resultAt: true, stageId: true, stage: { select: { name: true } } } }),
    db.projectOrder.findMany({ where: { projectId, status: { not: "CANCELED" } }, select: { id: true, number: true, stageId: true, status: true, expectedAt: true, deliveredAt: true, how: true, buyerName: true, supplier: { select: { name: true } } } }),
    db.job.findMany({ where: { projectId, organizationId, status: { not: "CANCELED" } }, select: { id: true, title: true, status: true, startsAt: true, endsAt: true, events: { select: { startsAt: true } } } }),
  ]);
  const crewDays = new Map<string, { day: string; jobId: string; jobTitle: string }>();
  for (const j of jobs) for (const e of j.events) {
    const day = dayKeyIn(e.startsAt, tz);
    crewDays.set(`${day}:${j.id}`, { day, jobId: j.id, jobTitle: j.title });
  }
  return {
    today,
    tz,
    stages: read.stages,
    inspections: inspections.map((i) => ({ id: i.id, name: i.name, date: isoDay(i.date), readyNote: i.readyNote, isFinal: i.isFinal, result: i.result, resultNote: i.resultNote, resultAt: i.resultAt ? i.resultAt.toISOString() : null, stageId: i.stageId, stageName: i.stage?.name ?? null })),
    deliveries: orders
      .map((o) => ({ id: o.id, number: o.number, stageId: o.stageId, day: isoDay(o.deliveredAt ?? o.expectedAt), status: o.status, from: o.how === "SUPPLIER" ? (o.supplier?.name ?? "supplier") : o.how === "BUYER" ? (o.buyerName ?? "a buyer") : "stock" }))
      .filter((o): o is TimelineDelivery => !!o.day),
    crewDays: [...crewDays.values()].sort((a, b) => a.day.localeCompare(b.day)),
    jobs: jobs.map((j) => ({ id: j.id, title: j.title, status: j.status, startsAt: j.startsAt ? dayKeyIn(j.startsAt, tz) : null, endsAt: j.endsAt ? dayKeyIn(j.endsAt, tz) : null })),
  };
}

// ── shift the rest ───────────────────────────────────────────────────────────

/** The plan for a slip, read back before it is applied. */
export async function planShift(organizationId: string, projectId: string, stageId: string, days: number): Promise<ShiftPlan | { error: string }> {
  const tz = await tzOf(organizationId);
  const today = localDayKey(new Date(), tz);
  const [stages, jobs, inspections] = await Promise.all([
    db.projectStage.findMany({ where: { projectId }, orderBy: { position: "asc" }, select: { id: true, name: true, position: true, status: true, startsAt: true, endsAt: true } }),
    db.job.findMany({ where: { projectId, organizationId }, select: { id: true, title: true, status: true, startsAt: true, endsAt: true, events: { select: { id: true, startsAt: true, endsAt: true } } } }),
    db.projectInspection.findMany({ where: { projectId }, select: { id: true, name: true, date: true, result: true } }),
  ]);
  return shiftPlan({
    stages: stages.map((s) => ({ ...s, startsAt: isoDay(s.startsAt), endsAt: isoDay(s.endsAt) })),
    jobs,
    inspections: inspections.map((i) => ({ ...i, date: isoDay(i.date) })),
    stageId,
    days,
    today,
    tz,
  });
}

/** The plan applied, in one transaction. Returns what moved, in words. */
export async function shiftRest(organizationId: string, projectId: string, stageId: string, days: number, actorId: string | null): Promise<{ words: string[]; stages: number; visits: number; inspections: number }> {
  const plan = await planShift(organizationId, projectId, stageId, days);
  if ("error" in plan) throw new Error(plan.error);
  const project = await db.project.findFirst({ where: { id: projectId, organizationId }, select: { name: true, clientId: true } });
  if (!project) throw new Error("Project not found");
  await db.$transaction(async (tx) => {
    await tx.projectStage.update({ where: { id: plan.stage.id }, data: { endsAt: dayOf(plan.stage.newEndsAt) } });
    for (const s of plan.stages) await tx.projectStage.update({ where: { id: s.id }, data: { startsAt: dayOf(s.newStartsAt), endsAt: dayOf(s.newEndsAt) } });
    for (const j of plan.jobs) {
      for (const e of j.events) await tx.jobEvent.update({ where: { id: e.id }, data: { startsAt: e.newStartsAt, endsAt: e.newEndsAt } });
      if (j.newStartsAt || j.newEndsAt) await tx.job.update({ where: { id: j.id }, data: { ...(j.newStartsAt ? { startsAt: j.newStartsAt } : {}), ...(j.newEndsAt ? { endsAt: j.newEndsAt } : {}) } });
    }
    for (const i of plan.inspections) await tx.projectInspection.update({ where: { id: i.id }, data: { date: dayOf(i.newDate) } });
  });
  const visits = plan.jobs.reduce((n, j) => n + j.events.length, 0);
  await logActivity({
    organizationId,
    actorId,
    kind: TRAIL_KINDS.PROJECT,
    summary: `Shifted the rest of ${project.name} by ${plan.days} work day${plan.days === 1 ? "" : "s"} after ${plan.stage.name} — ${plan.stages.length} stage${plan.stages.length === 1 ? "" : "s"}, ${visits} crew day${visits === 1 ? "" : "s"}, ${plan.inspections.length} inspection${plan.inspections.length === 1 ? "" : "s"}`,
    clientId: project.clientId,
    meta: { projectId, stageId, days: plan.days },
  });
  return { words: plan.words, stages: plan.stages.length, visits, inspections: plan.inspections.length };
}

// ── lay out the days ─────────────────────────────────────────────────────────

/** Days for the undated stages from `from` ("2026-11-10"), each as long as its weight says — or the lot inside
 *  `workDays`. Returns the stages dated. */
export async function layoutStages(organizationId: string, projectId: string, from: string, opts: { workDays?: number | null; perWeight?: number | null }, actorId: string | null): Promise<Array<{ id: string; name: string; startsAt: string; endsAt: string }>> {
  const project = await db.project.findFirst({ where: { id: projectId, organizationId }, select: { name: true, clientId: true } });
  if (!project) throw new Error("Project not found");
  const stages = await db.projectStage.findMany({ where: { projectId }, orderBy: { position: "asc" }, select: { id: true, name: true, position: true, status: true, startsAt: true, endsAt: true, weight: true } });
  const plan = layoutPlan(
    stages.map((s) => ({ ...s, startsAt: isoDay(s.startsAt), endsAt: isoDay(s.endsAt) })),
    from,
    { workDays: opts.workDays ?? undefined, perWeight: opts.perWeight ?? undefined },
  );
  if (!plan.length) return [];
  await db.$transaction(plan.map((p) => db.projectStage.update({ where: { id: p.id }, data: { startsAt: dayOf(p.startsAt), endsAt: dayOf(p.endsAt) } })));
  await db.project.updateMany({ where: { id: projectId, stagesDraftedAt: { not: null } }, data: { stagesDraftedAt: null } });
  await logActivity({
    organizationId,
    actorId,
    kind: TRAIL_KINDS.PROJECT,
    summary: `Laid out ${plan.length} stage${plan.length === 1 ? "" : "s"} of ${project.name} from ${plan[0].startsAt} to ${plan[plan.length - 1].endsAt}`,
    clientId: project.clientId,
    meta: { projectId, from, stages: plan.length },
  });
  return plan;
}

// ── who is already booked ────────────────────────────────────────────────────

export type BusyDay = { workerId: string; name: string; day: string; what: string };

/**
 * Of these workers, who is already on another job's calendar (or on time off) on any of these days. One query
 * for the whole span, then day by day — a Saturday visit on another job does not flag a Mon–Fri crew.
 */
export async function crewBusy(organizationId: string, workerIds: string[], days: Array<{ startsAt: Date; endsAt: Date }>, exceptJobId: string | null): Promise<BusyDay[]> {
  if (!workerIds.length || !days.length) return [];
  const tz = await tzOf(organizationId);
  const from = new Date(Math.min(...days.map((d) => d.startsAt.getTime())));
  const to = new Date(Math.max(...days.map((d) => d.endsAt.getTime())));
  const workers = await db.workerProfile.findMany({ where: { organizationId, id: { in: workerIds } }, select: { id: true, userId: true, displayName: true } });
  if (!workers.length) return [];
  const [events, blocks] = await Promise.all([
    db.jobEvent.findMany({
      where: {
        organizationId,
        startsAt: { lt: to },
        endsAt: { gt: from },
        ...(exceptJobId ? { NOT: { jobId: exceptJobId } } : {}),
        job: { status: { not: "CANCELED" }, assignments: { some: { workerId: { in: workers.map((w) => w.id) }, status: { not: "DECLINED" } } } },
      },
      select: { title: true, startsAt: true, endsAt: true, job: { select: { assignments: { select: { workerId: true, status: true } } } } },
      take: 400,
    }),
    db.blockedTime.findMany({
      where: { organizationId, startsAt: { lt: to }, endsAt: { gt: from }, OR: [{ ownerId: null }, { ownerId: { in: workers.map((w) => w.userId).filter((x): x is string => !!x) } }] },
      select: { ownerId: true, reason: true, startsAt: true, endsAt: true },
      take: 100,
    }),
  ]);
  const out: BusyDay[] = [];
  const seen = new Set<string>();
  const overlaps = (a: { startsAt: Date; endsAt: Date }, b: { startsAt: Date; endsAt: Date }) => a.startsAt < b.endsAt && a.endsAt > b.startsAt;
  for (const w of workers) {
    for (const d of days) {
      const day = dayKeyIn(d.startsAt, tz);
      const e = events.find((x) => overlaps(x, d) && x.job?.assignments.some((a) => a.workerId === w.id && a.status !== "DECLINED"));
      const b = e ? null : blocks.find((x) => overlaps(x, d) && (x.ownerId === null || x.ownerId === w.userId));
      const what = e ? e.title : b ? b.reason || "Time off" : null;
      if (!what) continue;
      const key = `${w.id}:${day}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ workerId: w.id, name: w.displayName, day, what });
    }
  }
  return out;
}

/** "Marco is on Hall bath remodel Tue 12, Wed 13" — one line per worker. */
export function busyWords(rows: BusyDay[]): string[] {
  const by = new Map<string, { name: string; days: string[]; what: string }>();
  for (const r of rows) {
    const w = by.get(r.workerId) ?? { name: r.name, days: [], what: r.what };
    w.days.push(r.day);
    by.set(r.workerId, w);
  }
  const label = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  return [...by.values()].map((w) => `${w.name} is on ${w.what} ${w.days.slice(0, 4).map(label).join(", ")}${w.days.length > 4 ? ` +${w.days.length - 4}` : ""}`);
}
