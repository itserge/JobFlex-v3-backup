import "server-only";
// THE CREW IN THE FIELD — the database half (the crew build, 2026-11-05). The rules are ./shared.ts.
//
//   · logHours      — the hours a crew member worked on a job on a day (typed when they close the day, or by the
//                     office), at the worker's rate that day; Labor on the job and the project (lib/jobCost).
//   · raiseFlag     — a problem from site: a note, whether the work stopped; the office is texted at once and
//                     emailed; the project reads red until resolveFlag.
//   · noteWeather   — the weather on a day on site, from the job's address, best effort (lib/weather).
//   · fieldOf       — what the job page shows the crew and the office: the project's tasks, the deliveries due,
//                     the open problems, today's hours and weather.
//   · crewHome      — the crew's own day: tasks today, who is with them, the week's hours.
//   · projectField  — the project page's: open problems, hours this week by worker, the subs' bills.

import { db } from "@/lib/db";
import { appBaseUrl } from "@/lib/appUrl";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import type { EmailDoc } from "@/lib/email/doc";
import { sendToMembersByPref } from "@/lib/notificationPrefs";
import { textOfficeNow } from "@/lib/sms/send";
import { localDayKey } from "@/lib/jobProgressShared";
import { geocode, weatherLine } from "@/lib/weather";
import { markTask } from "@/lib/projectStages/server";
import { stageForDay } from "@/lib/projectStages/shared";
import { qtyWords } from "@/lib/projectBuying/shared";
import { punchForJob } from "@/lib/projectFinish/server";
import { filesForCrew } from "@/lib/projectClient/server";
import { flagWords, hoursCost, tidyHours, weekOf } from "./shared";

const r2 = (n: number) => Math.round(n * 100) / 100;

async function tzOf(organizationId: string): Promise<string> {
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } });
  return org?.timezone || "America/New_York";
}

// ── hours ────────────────────────────────────────────────────────────────────

/** The hours a worker put in on a job on a day — typed once, corrected by typing again. */
export async function logHours(input: { organizationId: string; jobId: string; workerId: string; date?: string | null; hours: number | string; note?: string | null; workDayId?: string | null; actorId: string | null }): Promise<{ hours: number; rate: number | null; date: string }> {
  const hours = tidyHours(input.hours);
  if (hours == null) throw new Error("How many hours?");
  const [worker, job] = await Promise.all([
    db.workerProfile.findFirst({ where: { id: input.workerId, organizationId: input.organizationId }, select: { id: true, hourlyRate: true, displayName: true } }),
    db.job.findFirst({ where: { id: input.jobId, organizationId: input.organizationId }, select: { id: true, title: true, clientId: true } }),
  ]);
  if (!worker || !job) throw new Error("Not found");
  const date = input.date && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : localDayKey(new Date(), await tzOf(input.organizationId));
  const workDayId = input.workDayId ?? (await db.workDay.findUnique({ where: { jobId_date: { jobId: job.id, date } }, select: { id: true } }))?.id ?? null;
  const rate = worker.hourlyRate && worker.hourlyRate > 0 ? worker.hourlyRate : null;
  await db.crewHours.upsert({
    where: { jobId_workerId_date: { jobId: job.id, workerId: worker.id, date } },
    create: { organizationId: input.organizationId, jobId: job.id, workerId: worker.id, workDayId, date, hours, rate, note: input.note?.trim().slice(0, 300) || null, createdById: input.actorId },
    // The rate stays what it was the first time: a raise never re-prices an old day.
    update: { hours, workDayId: workDayId ?? undefined, note: input.note?.trim().slice(0, 300) || null },
  });
  await logActivity({ organizationId: input.organizationId, actorId: input.actorId, kind: TRAIL_KINDS.JOB, summary: `${worker.displayName} — ${hours} h on ${job.title} (${date})`, clientId: job.clientId, meta: { jobId: job.id, workerId: worker.id, date, hours } });
  return { hours, rate, date };
}

/** Labor from hours, per job, for lib/jobCost. */
export async function hoursCostByJob(organizationId: string, jobIds?: string[]): Promise<Map<string, number>> {
  const rows = await db.crewHours.findMany({ where: { organizationId, ...(jobIds ? { jobId: { in: jobIds } } : {}) }, select: { jobId: true, hours: true, rate: true } });
  const out = new Map<string, number>();
  for (const r of rows) out.set(r.jobId, r2((out.get(r.jobId) ?? 0) + hoursCost([r])));
  return out;
}

// ── problems from site ───────────────────────────────────────────────────────

export async function raiseFlag(input: { organizationId: string; jobId: string; workerId: string | null; raisedById: string | null; raisedByName: string; note: string; blocking: boolean }): Promise<{ id: string }> {
  const note = input.note.trim().slice(0, 1000);
  if (note.length < 3) throw new Error("Say what the problem is");
  const job = await db.job.findFirst({ where: { id: input.jobId, organizationId: input.organizationId }, select: { id: true, title: true, projectId: true, clientId: true, organization: { select: { name: true, logoUrl: true, phone: true } } } });
  if (!job) throw new Error("Job not found");
  const flag = await db.jobFlag.create({ data: { organizationId: input.organizationId, jobId: job.id, projectId: job.projectId, workerId: input.workerId, raisedById: input.raisedById, note, blocking: input.blocking }, select: { id: true } });
  const words = flagWords({ note, blocking: input.blocking, jobTitle: job.title });
  await logActivity({ organizationId: input.organizationId, actorId: input.raisedById, kind: TRAIL_KINDS.JOB, summary: `${input.raisedByName} flagged from site — ${words}`.slice(0, 500), clientId: job.clientId, meta: { jobId: job.id, flagId: flag.id, blocking: input.blocking, projectId: job.projectId } });
  // The office, now: a text to every office phone whatever the hour (work stopped waits for nobody), and an email.
  try {
    const base = await appBaseUrl();
    const href = job.projectId ? `${base}/dashboard/projects/${job.projectId}` : `${base}/dashboard/jobs/${job.id}`;
    await textOfficeNow(input.organizationId, `${input.raisedByName}: ${words} ${href}`, { kind: "job-flag" });
    const doc: EmailDoc = {
      subject: words.slice(0, 120),
      lockup: { kind: "org", name: job.organization.name, logoUrl: job.organization.logoUrl },
      kicker: { text: input.blocking ? "Work stopped" : "Problem on site", tone: input.blocking ? "bad" : "warn" },
      headline: `${input.raisedByName} flagged a problem on ${job.title}`,
      prose: [note],
      cta: { label: job.projectId ? "Open the project" : "Open the job", href },
      footer: { name: job.organization.name, contact: job.organization.phone ?? undefined },
    };
    await sendToMembersByPref(input.organizationId, "job-started", doc);
  } catch (err) {
    console.warn(`[crewField] could not tell the office about a flag: ${err instanceof Error ? err.message : String(err)}`);
  }
  return { id: flag.id };
}

export async function resolveFlag(organizationId: string, flagId: string, resolution: string | null, actorId: string | null): Promise<void> {
  const f = await db.jobFlag.findFirst({ where: { id: flagId, organizationId }, select: { id: true, note: true, status: true, job: { select: { title: true, clientId: true } }, projectId: true, jobId: true } });
  if (!f) throw new Error("Not found");
  if (f.status === "RESOLVED") return;
  await db.jobFlag.update({ where: { id: f.id }, data: { status: "RESOLVED", resolution: resolution?.trim().slice(0, 500) || null, resolvedAt: new Date(), resolvedById: actorId } });
  await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.JOB, summary: `Resolved on ${f.job.title}: ${f.note.slice(0, 80)}${resolution ? ` — ${resolution.slice(0, 120)}` : ""}`.slice(0, 500), clientId: f.job.clientId, meta: { jobId: f.jobId, flagId: f.id, projectId: f.projectId } });
}

// ── the weather ──────────────────────────────────────────────────────────────

/** The weather on a day on site, noted once, best effort; nothing waits on it. */
export async function noteWeather(organizationId: string, workDayId: string): Promise<string | null> {
  try {
    const d = await db.workDay.findFirst({ where: { id: workDayId, organizationId }, select: { id: true, date: true, weather: true, job: { select: { client: { select: { city: true, state: true, zip: true } } } }, organization: { select: { timezone: true, lat: true, lng: true } } } });
    if (!d || d.weather) return d?.weather ?? null;
    const c = d.job.client;
    const place = (c && (c.city || c.zip) ? await geocode({ city: c.city, state: c.state, zip: c.zip }) : null) ?? (d.organization.lat != null && d.organization.lng != null ? { lat: d.organization.lat, lng: d.organization.lng } : null);
    if (!place) return null;
    const line = await weatherLine(place.lat, place.lng, d.date, d.organization.timezone || "America/New_York");
    if (line) await db.workDay.update({ where: { id: d.id }, data: { weather: line } });
    return line;
  } catch {
    return null;
  }
}

// ── the job page's field block ───────────────────────────────────────────────

export type FieldTask = { id: string; title: string; done: boolean; photoNeeded: boolean };
export type FieldStage = { id: string; name: string; status: string; current: boolean; tasks: FieldTask[] };
export type FieldOrder = { id: string; number: number; from: string; status: string; expected: string | null; lines: Array<{ id: string; name: string; qty: string }> };
export type FieldProblem = { id: string; note: string; blocking: boolean; by: string | null; when: string; status: string; resolution: string | null };
export type FieldData = {
  project: { id: string; name: string } | null;
  stages: FieldStage[];
  orders: FieldOrder[];
  problems: FieldProblem[];
  /** The project's punch list, the items for this job or for no job in particular (the timeline build, 2026-11-06). */
  punch: Array<{ id: string; note: string; done: boolean }>;
  /** The project's files — the permit, the plans — read-only (the client build, 2026-11-06). */
  files: Array<{ id: string; name: string; kindLabel: string; href: string }>;
  /** The reader's own hours typed today, or null. */
  hoursToday: number | null;
  /** Hours on this job this week, everyone (the office's view; the crew sees their own). */
  weekHours: number;
  weatherToday: string | null;
  today: string;
};

const when = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

export async function fieldOf(organizationId: string, jobId: string, reader: { workerId: string | null; office: boolean }): Promise<FieldData> {
  const tz = await tzOf(organizationId);
  const today = localDayKey(new Date(), tz);
  const job = await db.job.findFirst({ where: { id: jobId, organizationId }, select: { id: true, projectId: true, project: { select: { id: true, name: true } } } });
  if (!job) throw new Error("Job not found");
  const { from, to } = weekOf(today);
  const [stages, orders, flags, mine, weekRows, day, punch, files] = await Promise.all([
    job.projectId
      ? db.projectStage.findMany({ where: { projectId: job.projectId, status: { not: "DONE" } }, orderBy: { position: "asc" }, select: { id: true, name: true, status: true, startsAt: true, endsAt: true, tasks: { orderBy: { position: "asc" }, select: { id: true, title: true, doneAt: true, photoNeeded: true } } } })
      : Promise.resolve([]),
    job.projectId
      ? db.projectOrder.findMany({ where: { projectId: job.projectId, status: { in: ["ORDERED", "SHIPPED"] } }, orderBy: { number: "asc" }, select: { id: true, number: true, how: true, status: true, expectedAt: true, buyerName: true, supplier: { select: { name: true } }, lines: { select: { id: true, quantity: true, material: { select: { name: true, unit: true } } } } } })
      : Promise.resolve([]),
    db.jobFlag.findMany({ where: { jobId: job.id }, orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: 12, select: { id: true, note: true, blocking: true, status: true, resolution: true, createdAt: true, raisedById: true } }),
    reader.workerId ? db.crewHours.findUnique({ where: { jobId_workerId_date: { jobId: job.id, workerId: reader.workerId, date: today } }, select: { hours: true } }) : Promise.resolve(null),
    db.crewHours.findMany({ where: { jobId: job.id, date: { gte: from, lte: to }, ...(reader.office ? {} : { workerId: reader.workerId ?? "__none__" }) }, select: { hours: true } }),
    db.workDay.findUnique({ where: { jobId_date: { jobId: job.id, date: today } }, select: { weather: true } }),
    job.projectId ? punchForJob(job.projectId, job.id) : Promise.resolve([]),
    job.projectId ? filesForCrew(job.projectId) : Promise.resolve([]),
  ]);
  const users = flags.length ? await db.user.findMany({ where: { id: { in: flags.map((f) => f.raisedById).filter(Boolean) as string[] } }, select: { id: true, name: true } }) : [];
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  const stageRows = stages.map((s) => ({ id: s.id, name: s.name, status: s.status, current: false, tasks: s.tasks.map((t) => ({ id: t.id, title: t.title, done: Boolean(t.doneAt), photoNeeded: t.photoNeeded })) }));
  const now = stageForDay(stages.map((s, i) => ({ ...stageRows[i], startsAt: s.startsAt, endsAt: s.endsAt, weight: 1 })), today);
  for (const s of stageRows) s.current = now?.id === s.id;
  return {
    project: job.project,
    stages: stageRows,
    orders: orders.map((o) => ({
      id: o.id,
      number: o.number,
      from: o.how === "SUPPLIER" ? (o.supplier?.name ?? "supplier") : o.how === "BUYER" ? (o.buyerName ?? "a buyer") : "stock",
      status: o.status,
      expected: o.expectedAt ? o.expectedAt.toISOString().slice(0, 10) : null,
      lines: o.lines.map((l) => ({ id: l.id, name: l.material.name, qty: qtyWords(l.quantity, l.material.unit) })),
    })),
    problems: flags.map((f) => ({ id: f.id, note: f.note, blocking: f.blocking, by: f.raisedById ? (nameOf.get(f.raisedById) ?? null) : null, when: when(f.createdAt), status: f.status, resolution: f.resolution })),
    punch,
    files,
    hoursToday: mine?.hours ?? null,
    weekHours: r2(weekRows.reduce((n, r) => n + r.hours, 0)),
    weatherToday: day?.weather ?? null,
    today,
  };
}

/** A crew member ticks a task on the job's project (through either door). */
export async function crewTickTask(organizationId: string, jobId: string, taskId: string, done: boolean, actorId: string | null): Promise<void> {
  const job = await db.job.findFirst({ where: { id: jobId, organizationId }, select: { projectId: true } });
  if (!job?.projectId) throw new Error("This job is not on a project");
  const t = await db.projectTask.findFirst({ where: { id: taskId, projectId: job.projectId }, select: { id: true } });
  if (!t) throw new Error("That task is not on this project");
  await markTask(organizationId, t.id, done, actorId);
}

// ── the crew's own day ───────────────────────────────────────────────────────

export type CrewHome = {
  today: string;
  tasks: Array<{ jobId: string; assignmentId: string; jobTitle: string; stage: string; tasks: FieldTask[] }>;
  /** Who else is on each of today's jobs. */
  withMe: Record<string, string[]>;
  week: { hours: number; days: number; from: string; to: string };
  problemsOpen: number;
};

export async function crewHome(organizationId: string, workerId: string, todayJobIds: Array<{ jobId: string; assignmentId: string; title: string }>): Promise<CrewHome> {
  const tz = await tzOf(organizationId);
  const today = localDayKey(new Date(), tz);
  const { from, to } = weekOf(today);
  const ids = todayJobIds.map((j) => j.jobId);
  const [jobs, mates, weekRows, flags] = await Promise.all([
    ids.length ? db.job.findMany({ where: { id: { in: ids } }, select: { id: true, projectId: true } }) : Promise.resolve([]),
    ids.length ? db.jobAssignment.findMany({ where: { jobId: { in: ids }, status: { in: ["ACCEPTED", "COMPLETED"] }, workerId: { not: workerId } }, select: { jobId: true, worker: { select: { displayName: true } } } }) : Promise.resolve([]),
    db.crewHours.findMany({ where: { workerId, date: { gte: from, lte: to } }, select: { hours: true, date: true } }),
    db.jobFlag.count({ where: { workerId, status: "OPEN" } }),
  ]);
  const projectIds = [...new Set(jobs.map((j) => j.projectId).filter(Boolean) as string[])];
  const stages = projectIds.length
    ? await db.projectStage.findMany({ where: { projectId: { in: projectIds }, status: { not: "DONE" } }, orderBy: { position: "asc" }, select: { id: true, projectId: true, name: true, status: true, startsAt: true, endsAt: true, tasks: { orderBy: { position: "asc" }, select: { id: true, title: true, doneAt: true, photoNeeded: true } } } })
    : [];
  const tasks: CrewHome["tasks"] = [];
  for (const j of todayJobIds) {
    const projectId = jobs.find((x) => x.id === j.jobId)?.projectId;
    if (!projectId) continue;
    const mine = stages.filter((s) => s.projectId === projectId).map((s) => ({ id: s.id, name: s.name, status: s.status, startsAt: s.startsAt, endsAt: s.endsAt, weight: 1, tasks: s.tasks.map((t) => ({ id: t.id, title: t.title, done: Boolean(t.doneAt), photoNeeded: t.photoNeeded })) }));
    const now = stageForDay(mine, today);
    if (!now) continue;
    tasks.push({ jobId: j.jobId, assignmentId: j.assignmentId, jobTitle: j.title, stage: now.name, tasks: now.tasks.filter((t) => !t.done).slice(0, 8) });
  }
  const withMe: Record<string, string[]> = {};
  for (const m of mates) withMe[m.jobId] = [...(withMe[m.jobId] ?? []), m.worker.displayName];
  return {
    today,
    tasks,
    withMe,
    week: { hours: r2(weekRows.reduce((n, r) => n + r.hours, 0)), days: new Set(weekRows.map((r) => r.date)).size, from, to },
    problemsOpen: flags,
  };
}

// ── the project page ─────────────────────────────────────────────────────────

export type ProjectFieldRead = {
  problems: Array<FieldProblem & { jobId: string; jobTitle: string }>;
  hoursWeek: Array<{ workerId: string; name: string; hours: number; cost: number }>;
  hoursAll: { hours: number; cost: number };
  subs: Array<{ id: string; vendor: string | null; amount: number; note: string | null; spentAt: string; paidAt: string | null }>;
  week: { from: string; to: string };
};

export async function projectField(organizationId: string, projectId: string): Promise<ProjectFieldRead> {
  const tz = await tzOf(organizationId);
  const today = localDayKey(new Date(), tz);
  const { from, to } = weekOf(today);
  const jobs = await db.job.findMany({ where: { projectId, organizationId }, select: { id: true, title: true } });
  const jobIds = jobs.map((j) => j.id);
  const [flags, hours, subs] = await Promise.all([
    jobIds.length ? db.jobFlag.findMany({ where: { jobId: { in: jobIds } }, orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: 20, select: { id: true, jobId: true, note: true, blocking: true, status: true, resolution: true, createdAt: true, raisedById: true } }) : Promise.resolve([]),
    jobIds.length ? db.crewHours.findMany({ where: { jobId: { in: jobIds } }, select: { workerId: true, date: true, hours: true, rate: true, worker: { select: { displayName: true } } } }) : Promise.resolve([]),
    db.projectExpense.findMany({ where: { projectId, category: "SUBCONTRACTORS" }, orderBy: { spentAt: "desc" }, take: 40, select: { id: true, vendor: true, amount: true, note: true, spentAt: true, paidAt: true } }),
  ]);
  const users = flags.length ? await db.user.findMany({ where: { id: { in: flags.map((f) => f.raisedById).filter(Boolean) as string[] } }, select: { id: true, name: true } }) : [];
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  const titleOf = new Map(jobs.map((j) => [j.id, j.title]));
  const byWorker = new Map<string, { name: string; hours: number; cost: number }>();
  for (const h of hours.filter((x) => x.date >= from && x.date <= to)) {
    const w = byWorker.get(h.workerId) ?? { name: h.worker.displayName, hours: 0, cost: 0 };
    w.hours = r2(w.hours + h.hours);
    w.cost = r2(w.cost + hoursCost([h]));
    byWorker.set(h.workerId, w);
  }
  return {
    problems: flags.map((f) => ({ id: f.id, jobId: f.jobId, jobTitle: titleOf.get(f.jobId) ?? "job", note: f.note, blocking: f.blocking, by: f.raisedById ? (nameOf.get(f.raisedById) ?? null) : null, when: when(f.createdAt), status: f.status, resolution: f.resolution })),
    hoursWeek: [...byWorker.entries()].map(([workerId, w]) => ({ workerId, ...w })).sort((a, b) => b.hours - a.hours),
    hoursAll: { hours: r2(hours.reduce((n, h) => n + h.hours, 0)), cost: hoursCost(hours) },
    subs: subs.map((s) => ({ id: s.id, vendor: s.vendor, amount: s.amount, note: s.note, spentAt: s.spentAt.toISOString(), paidAt: s.paidAt ? s.paidAt.toISOString() : null })),
    week: { from, to },
  };
}
