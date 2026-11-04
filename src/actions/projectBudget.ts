"use server";

// PROJECT BUDGET — the writes behind a project's Budget card (2026-09-18).
//
//   setProjectBudget     the budget by category, or as one figure; replaces the
//                        category lines and keeps Project.budget (what the
//                        project list reads) equal to the whole budget. A
//                        change order's cost line (labelled) is never touched.
//   addChangeOrderCost   an approved change order's cost, as its own labelled
//                        line (2026-11-04) — the card stops counting it at the
//                        project's cost share once it is in.
//   removeBudgetLine     takes such a line back out.
//   addProjectExpense    a cost logged straight to the project.
//   deleteProjectExpense takes one back out.
//
// Spending logged on the project's JOBS (JobExpense) is read alongside these
// and is managed where it always was, on the job.
//
// Guard: estimators and managers — the same door every other project write
// uses (actions/projects.ts). Every id is checked against the caller's org.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireEstimatorOrManager } from "@/lib/orgContext";
import { db } from "@/lib/db";
import { BUDGET_CATEGORIES, changeLineLabel } from "@/lib/projectBudget";

const money = z.number().finite().min(0).max(100_000_000);
const category = z.enum(BUDGET_CATEGORIES);

async function projectInOrg(projectId: string, organizationId: string) {
  const p = await db.project.findFirst({ where: { id: projectId, organizationId }, select: { id: true } });
  if (!p) throw new Error("Project not found");
  return p.id;
}

function refresh(projectId: string) {
  revalidatePath(`/dashboard/projects/${projectId}`);
  revalidatePath("/dashboard/projects");
}

const budgetInput = z.object({
  projectId: z.string().min(1),
  /** By category… */
  lines: z.array(z.object({ category, amount: money })).max(BUDGET_CATEGORIES.length).optional(),
  /** …or one figure, not split (2026-11-04: the editor opened blank on a one-figure budget and saving it wiped it). */
  total: money.optional(),
});

const r2 = (n: number) => Math.round(n * 100) / 100;

/** The change orders' cost lines on a project, summed. */
async function extrasOf(projectId: string): Promise<number> {
  const rows = await db.projectBudgetLine.findMany({ where: { projectId, NOT: { label: null } }, select: { amount: true } });
  return rows.reduce((n, l) => n + l.amount, 0);
}

/** The project's budget, one amount per category or one figure. Zero amounts are dropped. */
export async function setProjectBudget(raw: unknown): Promise<{ budget: number }> {
  const { organizationId } = await requireEstimatorOrManager();
  const data = budgetInput.parse(raw);
  const projectId = await projectInOrg(data.projectId, organizationId);
  const seen = new Set<string>();
  const lines = (data.lines ?? []).filter((l) => l.amount > 0 && !seen.has(l.category) && seen.add(l.category));
  const base = data.lines ? lines.reduce((n, l) => n + l.amount, 0) : (data.total ?? 0);
  const budget = r2(base + (await extrasOf(projectId)));

  await db.$transaction([
    // Only the category lines: a change order's cost line stays (it carries a label).
    db.projectBudgetLine.deleteMany({ where: { projectId, label: null } }),
    ...lines.map((l) =>
      db.projectBudgetLine.create({
        data: { projectId, category: l.category, amount: r2(l.amount), position: BUDGET_CATEGORIES.indexOf(l.category) },
      }),
    ),
    db.project.update({ where: { id: projectId }, data: { budget } }),
  ]);
  refresh(projectId);
  return { budget };
}

const coCostInput = z.object({ projectId: z.string().min(1), changeOrderId: z.string().min(1), category, amount: money.refine((n) => n > 0, "Enter what it costs you") });

/** An approved change order's cost into the budget, as its own line under the order's label. */
export async function addChangeOrderCost(raw: unknown): Promise<{ budget: number }> {
  const { organizationId } = await requireEstimatorOrManager();
  const data = coCostInput.parse(raw);
  const projectId = await projectInOrg(data.projectId, organizationId);
  const co = await db.changeOrder.findFirst({
    where: { id: data.changeOrderId, organizationId, status: "APPROVED", proposal: { projectId } },
    select: { number: true, title: true },
  });
  if (!co) throw new Error("That change order isn't an approved one on this project.");
  const label = changeLineLabel(co.number, co.title);
  const project = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { budget: true, budgetLines: { select: { id: true } } } });
  await db.$transaction([
    db.projectBudgetLine.deleteMany({ where: { projectId, label } }),
    db.projectBudgetLine.create({ data: { projectId, category: data.category, label, amount: r2(data.amount), position: 100 } }),
    db.project.update({ where: { id: projectId }, data: { budget: r2(project.budget + data.amount) } }),
  ]);
  refresh(projectId);
  return { budget: r2(project.budget + data.amount) };
}

/** A change order's cost line taken back out of the budget. */
export async function removeBudgetLine(raw: unknown): Promise<void> {
  const { organizationId } = await requireEstimatorOrManager();
  const data = z.object({ projectId: z.string().min(1), lineId: z.string().min(1) }).parse(raw);
  const projectId = await projectInOrg(data.projectId, organizationId);
  const line = await db.projectBudgetLine.findFirst({ where: { id: data.lineId, projectId, NOT: { label: null } }, select: { id: true, amount: true } });
  if (!line) throw new Error("That line is no longer in the budget.");
  const project = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { budget: true } });
  await db.$transaction([
    db.projectBudgetLine.delete({ where: { id: line.id } }),
    db.project.update({ where: { id: projectId }, data: { budget: r2(Math.max(0, project.budget - line.amount)) } }),
  ]);
  refresh(projectId);
}

const expenseInput = z.object({
  projectId: z.string().min(1),
  category,
  amount: money.refine((n) => n > 0, "Enter an amount"),
  vendor: z.string().trim().max(120).optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
  /** "YYYY-MM-DD"; absent means today. */
  spentAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
});

export async function addProjectExpense(raw: unknown): Promise<{ id: string }> {
  const { organizationId, user } = await requireEstimatorOrManager();
  const data = expenseInput.parse(raw);
  const projectId = await projectInOrg(data.projectId, organizationId);
  const row = await db.projectExpense.create({
    data: {
      projectId,
      category: data.category,
      amount: Math.round(data.amount * 100) / 100,
      vendor: data.vendor || null,
      note: data.note || null,
      // Noon UTC, so the day it was logged for reads the same in every US timezone.
      spentAt: data.spentAt ? new Date(`${data.spentAt}T12:00:00Z`) : new Date(),
      createdById: user.id,
    },
    select: { id: true },
  });
  refresh(projectId);
  return { id: row.id };
}

export async function deleteProjectExpense(id: string): Promise<void> {
  const { organizationId } = await requireEstimatorOrManager();
  const row = await db.projectExpense.findFirst({
    where: { id, project: { organizationId } },
    select: { id: true, projectId: true },
  });
  if (!row) throw new Error("Expense not found");
  await db.projectExpense.delete({ where: { id: row.id } });
  refresh(row.projectId);
}
