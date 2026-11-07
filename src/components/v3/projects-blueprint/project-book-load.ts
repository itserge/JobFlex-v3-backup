// PROJECT BOOK — the one read behind both editions of /dashboard/projects
// (the desktop page's server component and the handheld build's
// `listProjects` action), so the two can never describe the book differently.
//
// The figures are the project page's own — one read, lib/projectMoney: sold = accepted, completed and paid proposals
// with their approved change orders, before sales tax; open = drafts, sent and viewed, before tax; spent = costs logged
// on the project plus its jobs' receipts, crew pay and stock.

import { db } from "@/lib/db";
import { quoteFlags } from "@/lib/projectSubs/shared";
import { selectionFlags } from "@/lib/projectSelections/shared";
import { projectMoney } from "@/lib/projectMoney";
import { categoryLabel } from "@/lib/projectBudget";
import { currentStage, percentDone, stageFlags } from "@/lib/projectStages/shared";
import { buyingFlags } from "@/lib/projectBuying/shared";
import { problemFlags } from "@/lib/crewField/shared";
import { inspectionFlags, isoDay } from "@/lib/projectTimeline/shared";
import { buildFactsFrom, finishFlags } from "@/lib/projectFinish/shared";
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
      stages: { orderBy: { position: "asc" }, select: { name: true, status: true, weight: true, endsAt: true, tasks: { select: { id: true, title: true, doneAt: true } } } },
      // The quotes still moving (2026-11-07): overdue, in, invoiced — the list's flags (lib/projectSubs/shared quoteFlags).
      subQuotes: { where: { status: { in: ["ASKED", "QUOTED", "INVOICED"] } }, select: { id: true, status: true, amount: true, dueBy: true, stageId: true, contractor: { select: { name: true } } } },
      // Selections (2026-11-07): a choice not made by its day, or due in the next days (lib/projectSelections/shared selectionFlags).
      selections: { where: { chosenAt: null }, select: { name: true, leadDays: true, dueBy: true, chosenAt: true, stage: { select: { name: true, startsAt: true, status: true } } } },
      // Buying (2026-11-05): materials not ordered by their stage's order-by day, deliveries past their day.
      materials: { select: { quantity: true, orderedQty: true, receivedQty: true, stage: { select: { name: true, startsAt: true, status: true } } } },
      orders: { where: { status: { in: ["ORDERED", "SHIPPED"] } }, select: { number: true, how: true, status: true, expectedAt: true, buyerName: true, supplier: { select: { name: true } }, stage: { select: { status: true } } } },
      // Problems flagged from site (2026-11-05): the project reads red until the office resolves them.
      flags: { where: { status: "OPEN" }, select: { note: true, blocking: true, status: true, job: { select: { title: true } } } },
      // The timeline and the finish line (2026-11-06): an inspection coming up, failed or passed by; punch items
      // open; the finish-line steps left once the work is over.
      inspections: { select: { id: true, name: true, date: true, result: true, resultAt: true, readyNote: true, isFinal: true } },
      punchItems: { select: { doneAt: true, photoId: true } },
    },
  });
  const money = await projectMoney(organizationId, projects.map((p) => p.id));
  const today = new Date();
  const todayKey = today.toISOString().slice(0, 10);
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
      kind: p.kind,
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
      overCategories: (m?.overCategories ?? []).map(categoryLabel),
      owed: m?.owed ?? 0,
      updatedAgo: ago(last),
      number: p.number,
      done: percentDone(stages),
      stageNow: now?.name ?? null,
      stageCount: stages.length,
      attention: [
        ...problemFlags(p.flags.map((f) => ({ note: f.note, blocking: f.blocking, status: f.status, jobTitle: f.job.title }))),
        ...(p.status === "COMPLETED" || p.status === "ARCHIVED" ? [] : quoteFlags(p.subQuotes.map((q) => ({ id: q.id, status: q.status, amount: q.amount, dueBy: isoDay(q.dueBy), stageId: q.stageId, contractorName: q.contractor.name })), todayKey)),
        ...(p.status === "COMPLETED" || p.status === "ARCHIVED" ? [] : inspectionFlags(p.inspections.map((i) => ({ name: i.name, date: isoDay(i.date), result: i.result })), todayKey)),
        ...(p.status === "COMPLETED" || p.status === "ARCHIVED" ? [] : selectionFlags(p.selections.map((x) => ({ name: x.name, leadDays: x.leadDays, dueBy: isoDay(x.dueBy), chosenAt: x.chosenAt ? x.chosenAt.toISOString() : null, stageStart: isoDay(x.stage?.startsAt), stageDone: x.stage?.status === "DONE", stageName: x.stage?.name ?? null })), todayKey)),
        ...stageFlags({ stages, sold: r2(m?.contract ?? 0), status: p.status, draftedByAi: Boolean(p.stagesDraftedAt) }, today),
        ...finishFlags({
          status: p.status,
          stageCount: stages.length,
          stagesDone: stages.every((s) => s.status === "DONE"),
          jobsOpen: p.jobs.filter((j) => j.status !== "COMPLETED" && j.status !== "CANCELED").length,
          punch: { open: p.punchItems.filter((x) => !x.doneAt).length, total: p.punchItems.length, withPhoto: p.punchItems.filter((x) => x.photoId).length },
          finalInspection: (() => {
            const fi = p.inspections.find((i) => i.isFinal);
            return fi ? { id: fi.id, name: fi.name, date: isoDay(fi.date), result: fi.result, resultAt: fi.resultAt ? fi.resultAt.toISOString() : null, readyNote: fi.readyNote } : null;
          })(),
          signedOffAt: p.signedOffAt ? p.signedOffAt.toISOString() : null,
          signedOffBy: p.signedOffBy,
          payment: { proposals: p.proposals.filter((x) => ["ACCEPTED", "COMPLETED", "PAID"].includes(x.status)).length, billed: (m?.collected ?? 0) + (m?.owed ?? 0), paid: m?.collected ?? 0, owed: m?.owed ?? 0 },
          review: null,
          clientEmail: null,
          warrantyUntil: p.warrantyUntil ? p.warrantyUntil.toISOString() : null,
          finishedAt: p.finishedAt ? p.finishedAt.toISOString() : null,
          kind: p.kind,
          build: p.kind === "NEW_BUILD" ? buildFactsFrom(p.stages.flatMap((s) => s.tasks.map((t) => ({ id: t.id, title: t.title, done: Boolean(t.doneAt) })))) : null,
        }),
        ...(p.status === "COMPLETED" || p.status === "ARCHIVED"
          ? []
          : buyingFlags(
              {
                materials: p.materials.map((x) => ({ quantity: x.quantity, orderedQty: x.orderedQty, receivedQty: x.receivedQty, stageName: x.stage?.name ?? null, stageStart: x.stage?.startsAt ?? null, stageDone: x.stage?.status === "DONE" })),
                orders: p.orders.map((o) => ({ status: o.status, expectedAt: o.expectedAt, stageDone: o.stage?.status === "DONE", label: `Order ${o.number} (${o.how === "SUPPLIER" ? (o.supplier?.name ?? "supplier") : o.how === "BUYER" ? (o.buyerName ?? "buyer") : "stock"})` })),
              },
              today,
            )),
      ],
    };
  });
}
