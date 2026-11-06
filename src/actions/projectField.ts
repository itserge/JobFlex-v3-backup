"use server";
// THE FIELD, FROM THE OFFICE (the crew build, 2026-11-05): resolve a problem flagged from site, type a crew
// member's hours, the subs' bills (a Materials-card expense under SUBCONTRACTORS, paid or still owed). Estimators
// and managers, as every project write (actions/projects).

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireEstimatorOrManager } from "@/lib/orgContext";
import { logHours, resolveFlag } from "@/lib/crewField/server";

const ID = z.string().min(1).max(64);

function touched(projectId: string | null, jobId?: string | null) {
  revalidatePath("/dashboard/projects");
  if (projectId) {
    revalidatePath(`/dashboard/projects/${projectId}`);
    revalidatePath(`/mobile-project-detail-v2/${projectId}`);
  }
  if (jobId) revalidatePath(`/dashboard/jobs/${jobId}`);
}

export async function resolveProblem(flagId: string, resolution: string | null): Promise<void> {
  const { organizationId, user } = await requireEstimatorOrManager();
  const f = await db.jobFlag.findFirst({ where: { id: flagId, organizationId }, select: { projectId: true, jobId: true } });
  if (!f) throw new Error("Not found");
  await resolveFlag(organizationId, flagId, resolution, user.id);
  touched(f.projectId, f.jobId);
}

/** The office types a crew member's hours on a job for a day. */
export async function logCrewHours(raw: unknown): Promise<{ hours: number }> {
  const { organizationId, user } = await requireEstimatorOrManager();
  const d = z.object({ jobId: ID, workerId: ID, date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), hours: z.number().min(0).max(24), note: z.string().max(300).nullable().optional() }).parse(raw);
  const r = await logHours({ organizationId, jobId: d.jobId, workerId: d.workerId, date: d.date, hours: d.hours, note: d.note ?? null, actorId: user.id });
  const job = await db.job.findFirst({ where: { id: d.jobId, organizationId }, select: { projectId: true } });
  touched(job?.projectId ?? null, d.jobId);
  return { hours: r.hours };
}

// ── the subs' bills ──────────────────────────────────────────────────────────

const subInput = z.object({ projectId: ID, vendor: z.string().trim().min(1).max(120), amount: z.number().min(0).max(100_000_000), note: z.string().trim().max(500).nullable().optional(), spentAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), paid: z.boolean().optional() });

export async function addSubBill(raw: unknown): Promise<{ id: string }> {
  const { organizationId, user } = await requireEstimatorOrManager();
  const d = subInput.parse(raw);
  const p = await db.project.findFirst({ where: { id: d.projectId, organizationId }, select: { id: true } });
  if (!p) throw new Error("Project not found");
  const row = await db.projectExpense.create({
    data: {
      projectId: p.id,
      category: "SUBCONTRACTORS",
      amount: Math.round(d.amount * 100) / 100,
      vendor: d.vendor,
      note: d.note || null,
      spentAt: d.spentAt ? new Date(`${d.spentAt}T12:00:00Z`) : new Date(),
      paidAt: d.paid ? new Date() : null,
      createdById: user.id,
    },
    select: { id: true },
  });
  touched(p.id);
  return { id: row.id };
}

export async function setSubBillPaid(expenseId: string, paid: boolean): Promise<void> {
  const { organizationId } = await requireEstimatorOrManager();
  const e = await db.projectExpense.findFirst({ where: { id: expenseId, project: { organizationId } }, select: { id: true, projectId: true } });
  if (!e) throw new Error("Not found");
  await db.projectExpense.update({ where: { id: e.id }, data: { paidAt: paid ? new Date() : null } });
  touched(e.projectId);
}
