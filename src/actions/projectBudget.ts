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
//   readProjectBudget    a budget the office already has — pasted, a file, a photo — read into rows
//                        (2026-11-07, lib/projectBudgetRead); nothing saved, the card fills its fields.
//   budgetStartPoints    the preset a project is offered first, and the shop's other budgets to start
//                        from (lib/projectBudgetPresets).
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
import { BUDGET_CATEGORIES, MAX_KINDS, changeLineLabel, isBudgetCategory, normalizeKind } from "@/lib/projectBudget";
import { suggestBudget, type BudgetSuggestion } from "@/lib/projectBudgetSuggest";
import type { BudgetRead } from "@/lib/projectBudgetImport";
import { readBudget } from "@/lib/projectBudgetRead";
import { presetByKey, presetForTrade } from "@/lib/projectBudgetPresets";
import { OfficeFileError, docxText, xlsxText } from "@/lib/officeText";
import { isOpenAIEnabled } from "@/lib/sdk/openai";
import { rateLimitShared } from "@/lib/rateLimit";
import { parseAnswers } from "@/lib/projectKind";
import { proposalTrade } from "@/lib/projectStages/shared";
import { parseTradeTypes } from "@/lib/tradeTypes";

const money = z.number().finite().min(0).max(100_000_000);
/** One of the six, or a kind of the project's own ("Tile", "Dumpster") — 2026-11-06. */
const category = z.string().trim().min(1).max(40).transform(normalizeKind);
/** A change order's cost line stays on the six. */
const sixOnly = z.enum(BUDGET_CATEGORIES);

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
  /** By category — the six and the project's own kinds… */
  lines: z.array(z.object({ category, amount: money })).max(BUDGET_CATEGORIES.length + MAX_KINDS).optional(),
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
  const lines = (data.lines ?? []).filter((l) => l.amount > 0 && !seen.has(l.category.toLowerCase()) && seen.add(l.category.toLowerCase()));
  const base = data.lines ? lines.reduce((n, l) => n + l.amount, 0) : (data.total ?? 0);
  const budget = r2(base + (await extrasOf(projectId)));

  await db.$transaction([
    // Only the category lines: a change order's cost line stays (it carries a label).
    db.projectBudgetLine.deleteMany({ where: { projectId, label: null } }),
    ...lines.map((l, i) =>
      db.projectBudgetLine.create({
        data: { projectId, category: l.category, amount: r2(l.amount), position: isBudgetCategory(l.category) ? BUDGET_CATEGORIES.indexOf(l.category) : 10 + i },
      }),
    ),
    db.project.update({ where: { id: projectId }, data: { budget } }),
  ]);
  refresh(projectId);
  return { budget };
}

const coCostInput = z.object({ projectId: z.string().min(1), changeOrderId: z.string().min(1), category: sixOnly, amount: money.refine((n) => n > 0, "Enter what it costs you") });

/** The budget read from the estimate, or a rule of thumb for the trade — nothing saved until the card's Save. */
export async function suggestProjectBudget(projectId: string): Promise<BudgetSuggestion> {
  const { organizationId } = await requireEstimatorOrManager();
  return suggestBudget(organizationId, projectId);
}

/** A budget's words, a file, or up to four pictures (a photo, a scanned PDF's pages) — read into rows. FormData:
 *  projectId, from (what the card calls it), text, file (.xlsx / .docx / .csv / .txt), image × 4 (JPEG). */
export async function readProjectBudget(form: FormData): Promise<BudgetRead> {
  const { organizationId } = await requireEstimatorOrManager();
  await projectInOrg(String(form.get("projectId") ?? ""), organizationId);
  const from = String(form.get("from") ?? "").trim().slice(0, 80) || "what you pasted";
  let text = String(form.get("text") ?? "").slice(0, 60_000);
  const file = form.get("file");
  if (file instanceof File && file.size > 0) {
    if (file.size > 8 * 1024 * 1024) return { rows: [], statedTotal: null, source: "none", words: "That file is over 8 MB. Save the budget page alone, or paste its words." };
    const name = file.name.toLowerCase();
    const buf = Buffer.from(await file.arrayBuffer());
    try {
      if (/\.(xlsx|xlsm)$/.test(name)) text = xlsxText(buf);
      else if (/\.docx$/.test(name)) text = docxText(buf);
      else if (/\.(csv|tsv|txt|text|md)$/.test(name)) text = buf.toString("utf8");
      else if (/\.(xls|doc)$/.test(name)) return { rows: [], statedTotal: null, source: "none", words: "That's the old Excel or Word format. Save it as .xlsx or .docx (or CSV), or paste the budget's words." };
      else if (/\.(numbers|pages)$/.test(name)) return { rows: [], statedTotal: null, source: "none", words: "Export it from Numbers or Pages as Excel, CSV or PDF first — or paste the budget's words." };
      else return { rows: [], statedTotal: null, source: "none", words: "JobFlex reads CSV, Excel, Word, PDF and photos. Paste the budget's words for anything else." };
    } catch (err) {
      return { rows: [], statedTotal: null, source: "none", words: err instanceof OfficeFileError ? err.message : "Couldn't open that file. Paste the budget's words instead." };
    }
  }
  const images: string[] = [];
  for (const img of form.getAll("image").slice(0, 4)) {
    if (!(img instanceof File) || img.size === 0 || img.size > 4 * 1024 * 1024 || !/^image\/(jpeg|png|webp)$/.test(img.type)) continue;
    images.push(`data:${img.type};base64,${Buffer.from(await img.arrayBuffer()).toString("base64")}`);
  }
  if (!text.trim() && !images.length) return { rows: [], statedTotal: null, source: "none", words: "Paste the budget, or pick a file or a photo." };
  // The model reads for every shop, 40 reads an hour; past that the rules still read words.
  const useModel = isOpenAIEnabled() && (await rateLimitShared(`budget-read:${organizationId}`, 40, 60 * 60 * 1000)).ok;
  return readBudget({ text, images, from }, { useModel });
}

export type BudgetStart = {
  /** The preset the project is offered first: its template's, its trade's, a new build's. */
  suggested: string | null;
  /** The shop's other projects with a budget split by kind, newest first — each one a preset of its own. */
  projects: Array<{ id: string; name: string; total: number; lines: Array<{ category: string; amount: number }> }>;
};

/** Where a budget can start from: the preset the project points at, and the shop's other budgets. */
export async function budgetStartPoints(projectId: string): Promise<BudgetStart> {
  const { organizationId } = await requireEstimatorOrManager();
  const p = await db.project.findFirst({
    where: { id: projectId, organizationId },
    select: {
      id: true,
      kind: true,
      answersJson: true,
      proposals: { where: { status: { not: "ARCHIVED" } }, orderBy: { total: "desc" }, take: 1, select: { title: true, trade: true, scopeOfWork: true } },
      organization: { select: { tradeTypesJson: true } },
    },
  });
  if (!p) throw new Error("Project not found");
  const template = parseAnswers(p.answersJson).template;
  const lead = p.proposals[0];
  const trade = lead ? proposalTrade({ estimator: lead.trade, title: lead.title, scope: lead.scopeOfWork, orgTrades: parseTradeTypes(p.organization.tradeTypesJson) }) : null;
  const suggested = presetByKey(template)?.key ?? (p.kind === "NEW_BUILD" ? "home" : presetForTrade(trade));
  const others = await db.project.findMany({
    where: { organizationId, id: { not: p.id }, status: { not: "ARCHIVED" }, budgetLines: { some: { label: null, amount: { gt: 0 } } } },
    orderBy: { updatedAt: "desc" },
    take: 20,
    select: { id: true, name: true, budgetLines: { where: { label: null, amount: { gt: 0 } }, orderBy: { position: "asc" }, select: { category: true, amount: true } } },
  });
  const projects = others
    .filter((o) => o.budgetLines.length >= 2)
    .slice(0, 12)
    .map((o) => ({ id: o.id, name: o.name, total: r2(o.budgetLines.reduce((n, l) => n + l.amount, 0)), lines: o.budgetLines.map((l) => ({ category: l.category, amount: r2(l.amount) })) }));
  return { suggested, projects };
}

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
