// PROJECT BOOK — the one read behind both editions of /dashboard/projects
// (the desktop page's server component and the handheld build's
// `listProjects` action), so the two can never describe the book differently.
//
// The figures are the project page's own — one read, lib/projectMoney: sold = accepted, completed and paid proposals
// with their approved change orders, before sales tax; open = drafts, sent and viewed, before tax; spent = costs logged
// on the project plus its jobs' receipts, crew pay and stock.

import { db } from "@/lib/db";
import { projectMoney } from "@/lib/projectMoney";
import { CATEGORY_LABEL } from "@/lib/projectBudget";
import { currentStage, percentDone, stageFlags } from "@/lib/projectStages/shared";
import { buyingFlags } from "@/lib/projectBuying/shared";
import { problemFlags } from "@/lib/crewField/shared";
import type { Project } from "./projects-data";

/** "Jul 08" in UTC — project dates are stored as UTC midnight (the action
 *  coerces a "YYYY-MM-DD" string), and a local format renders the previous
 *  day in every negative-offset timezone. */
function shortPlate(d: Date | null): string | null {
  if (!d) return null;
  return d.toLocaleDateString("en-US", { month: "short", day: "2-digit", timeZone: "UTC" });
}

function ago(d: Date): string {
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const OPEN = new Set(["DRAFT", "SENT", "VIEWED"]);
const r2 = (n: number) => Math.round(n * 100) / 100;

export async function loadProjectBook(organizationId: string): Promise<Project[]> {
  const projects = await db.project.findMany({
    where: { organizationId, status: { not: "ARCHIVED" } },
    orderBy: { updatedAt: "desc" },
    include: {
      client: { select: { name: true } },
      jobs: { select: { status: true, updatedAt: true, expenses: { where: { status: { in: ["APPROVED", "REIMBURSED"] } }, select: { amount: true } } } },
      proposals: {
        where: { status: { not: "ARCHIVED" } },
        select: { status: true, total: true, updatedAt: true, changeOrders: { where: { status: "APPROVED" }, select: { status: true, total: true } } },
      },
      expenses: { select: { amount: true, createdAt: true } },
      // The stages (2026-11-05): % done, the stage it is on, and what is late.
      stages: { orderBy: { position: "asc" }, select: { name: true, status: true, weight: true, endsAt: true, tasks: { select: { doneAt: true } } } },
      // Buying (2026-11-05): materials not ordered by their stage's order-by day, deliveries past their day.
      materials: { select: { quantity: true, orderedQty: true, receivedQty: true, stage: { select: { name: true, startsAt: true } } } },
      orders: { where: { status: { in: ["ORDERED", "SHIPPED"] } }, select: { number: true, how: true, status: true, expectedAt: true, buyerName: true, supplier: { select: { name: true } } } },
      // Problems flagged from site (2026-11-05): the project reads red until the office resolves them.
      flags: { where: { status: "OPEN" }, select: { note: true, blocking: true, status: true, job: { select: { title: true } } } },
    },
  });
  const money = await projectMoney(organizationId, projects.map((p) => p.id));
  const today = new Date();
  return projects.map((p) => {
    const m = money.get(p.id);
    const openOnes = p.proposals.filter((x) => OPEN.has(x.status));
    const stages = p.stages.map((s) => ({ name: s.name, status: s.status, weight: s.weight, endsAt: s.endsAt, tasks: s.tasks.map((t) => ({ done: Boolean(t.doneAt) })) }));
    const now = currentStage(stages);
    // "Updated" is the newest thing on the project, not just the row itself.
    const last = [p.updatedAt, ...p.jobs.map((j) => j.updatedAt), ...p.proposals.map((x) => x.updatedAt), ...p.expenses.map((e) => e.createdAt)].reduce((a, b) => (b > a ? b : a));
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      status: p.status,
      startsAt: shortPlate(p.startsAt),
      endsAt: shortPlate(p.endsAt),
      budget: p.budget,
      jobCount: p.jobs.length,
      completedJobs: p.jobs.filter((j) => j.status === "COMPLETED").length,
      inProgressJobs: p.jobs.filter((j) => j.status === "IN_PROGRESS").length,
      clientName: p.client?.name ?? null,
      proposalCount: p.proposals.length,
      sold: r2(m?.contract ?? 0),
      open: r2(m?.pipeline ?? 0),
      openCount: openOnes.length,
      spent: r2(m?.spent ?? 0),
      margin: m?.margin ?? null,
      marginState: m?.marginState ?? "none",
      overCategories: (m?.overCategories ?? []).map((c) => CATEGORY_LABEL[c]),
      owed: m?.owed ?? 0,
      updatedAgo: ago(last),
      number: p.number,
      done: percentDone(stages),
      stageNow: now?.name ?? null,
      stageCount: stages.length,
      attention: [
        ...problemFlags(p.flags.map((f) => ({ note: f.note, blocking: f.blocking, status: f.status, jobTitle: f.job.title }))),
        ...stageFlags({ stages, sold: r2(m?.contract ?? 0), status: p.status, draftedByAi: Boolean(p.stagesDraftedAt) }, today),
        ...(p.status === "COMPLETED" || p.status === "ARCHIVED"
          ? []
          : buyingFlags(
              {
                materials: p.materials.map((x) => ({ quantity: x.quantity, orderedQty: x.orderedQty, receivedQty: x.receivedQty, stageName: x.stage?.name ?? null, stageStart: x.stage?.startsAt ?? null })),
                orders: p.orders.map((o) => ({ status: o.status, expectedAt: o.expectedAt, label: `Order ${o.number} (${o.how === "SUPPLIER" ? (o.supplier?.name ?? "supplier") : o.how === "BUYER" ? (o.buyerName ?? "buyer") : "stock"})` })),
              },
              today,
            )),
      ],
    };
  });
}
