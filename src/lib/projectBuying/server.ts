import "server-only";
// BUYING AND DELIVERIES ON A PROJECT — the database half (the buying build, 2026-11-05). The rules are ./shared.ts.
//
//   · seedMaterials      — the to-buy list from what was sold: each sold proposal's material lines and each approved
//                          change order's material lines, once (lineItemId / changeOrderId + name), each guessed
//                          onto a stage by its words. Re-run any time: only new lines are added.
//   · addDeckTakeoff     — a Deck Studio proposal's takeoff (the lengths a yard sells) onto the list, by its build
//                          step (footings → Footings, framing → Framing…).
//   · placeOrder         — part of the list bought one way: SUPPLIER (the purchase order is emailed), BUYER (anyone
//                          gets a link, no login; a crew member is texted too), STOCK (in at once).
//   · updateOrder / receiveOrder / cancelOrder — the delivery: shipped, delivered, what was missing (back on the
//                          list, the office told), canceled (back on the list).
//   · logOrderExpense    — what it cost, as a Materials expense on the project (lib/projectBudget reads it).
//   · buyerView / buyerUpdate — the buyer's page, by its token.
//   · buyingOf           — the project page's read.

import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { appBaseUrl } from "@/lib/appUrl";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { sendOrgEmail } from "@/lib/email/orgSend";
import { sendToMembersByPref } from "@/lib/notificationPrefs";
import type { EmailDoc } from "@/lib/email/doc";
import { textOffice, textWorker } from "@/lib/sms/send";
import { parseCoLines } from "@/lib/changeOrders/parse";
import { carrierOf, DEFAULT_LEAD_DAYS, isMaterialLine, orderByDate, orderCoversTask, orderLabel, qtyWords, stageForLine, toBuyQty, unitOf, type OrderHow } from "./shared";
import { markTask } from "@/lib/projectStages/server";

const r2 = (n: number) => Math.round(n * 100) / 100;
const SOLD = ["ACCEPTED", "COMPLETED", "PAID"];

// ── the list ─────────────────────────────────────────────────────────────────

/** The project's stages, for guessing a line's stage. */
async function stagesFor(projectId: string) {
  return db.projectStage.findMany({ where: { projectId }, orderBy: { position: "asc" }, select: { id: true, name: true, startsAt: true } });
}

/** The to-buy list from the sold proposals and approved change orders — only lines not on it yet. */
export async function seedMaterials(organizationId: string, projectId: string): Promise<number> {
  const [project, have, stages] = await Promise.all([
    db.project.findFirst({
      where: { id: projectId, organizationId },
      select: {
        id: true,
        proposals: {
          where: { status: { in: SOLD } },
          select: {
            id: true,
            title: true,
            lineItems: { orderBy: { position: "asc" }, select: { id: true, name: true, quantity: true, measurementType: true, materialCost: true, laborCost: true, store: true, productUrl: true } },
            changeOrders: { where: { status: "APPROVED" }, select: { id: true, title: true, linesJson: true } },
          },
        },
      },
    }),
    db.projectMaterial.findMany({ where: { projectId }, select: { lineItemId: true, changeOrderId: true, name: true } }),
    stagesFor(projectId),
  ]);
  if (!project) throw new Error("Project not found");
  const seenLine = new Set(have.map((m) => m.lineItemId).filter(Boolean) as string[]);
  const seenCo = new Set(have.filter((m) => m.changeOrderId).map((m) => `${m.changeOrderId}|${m.name.toLowerCase()}`));
  const rows: Prisma.ProjectMaterialCreateManyInput[] = [];
  for (const p of project.proposals) {
    for (const l of p.lineItems) {
      if (seenLine.has(l.id) || !isMaterialLine(l)) continue;
      const q = l.quantity > 0 ? l.quantity : 1;
      rows.push({
        organizationId,
        projectId,
        proposalId: p.id,
        lineItemId: l.id,
        name: l.name.slice(0, 200),
        quantity: q,
        unit: unitOf(l.measurementType),
        unitCost: l.materialCost > 0 ? r2(l.materialCost / q) : null,
        source: "PROPOSAL",
        store: l.store,
        productUrl: l.productUrl,
        stageId: stageForLine(l.name, stages)?.id ?? null,
      });
    }
    for (const co of p.changeOrders) {
      for (const l of parseCoLines(co.linesJson)) {
        if (l.kind === "labor" || !(l.quantity > 0)) continue;
        const key = `${co.id}|${l.name.toLowerCase()}`;
        if (seenCo.has(key)) continue;
        seenCo.add(key);
        rows.push({ organizationId, projectId, proposalId: p.id, changeOrderId: co.id, name: l.name.slice(0, 200), quantity: l.quantity, unit: l.unit || "each", unitCost: null, source: "CHANGE_ORDER", stageId: stageForLine(l.name, stages)?.id ?? null });
      }
    }
  }
  if (rows.length) await db.projectMaterial.createMany({ data: rows });
  return rows.length;
}

/** A Deck Studio proposal's takeoff onto the list (owner, 2026-10-11: "a list of all materials … to send to the lumber yard"). */
export async function addDeckTakeoff(organizationId: string, projectId: string): Promise<{ added: number; from: string | null }> {
  const project = await db.project.findFirst({ where: { id: projectId, organizationId }, select: { id: true, proposals: { where: { status: { in: SOLD } }, select: { id: true, title: true } } } });
  if (!project) throw new Error("Project not found");
  const { loadDeckFromProposal } = await import("@/actions/deckEstimator");
  const { priceDeck } = await import("@/lib/deck/pricing");
  const { materialList } = await import("@/lib/deck/materialList");
  const { readDeckRateBook } = await import("@/lib/deck/rateBookStore");
  const { resolveMarket } = await import("@/lib/fence/market");
  const stages = await stagesFor(project.id);
  const have = new Set((await db.projectMaterial.findMany({ where: { projectId, source: "TAKEOFF" }, select: { name: true } })).map((m) => m.name.toLowerCase()));
  for (const p of project.proposals) {
    const res = await loadDeckFromProposal(p.id);
    if (!res.ok) continue;
    const book = await readDeckRateBook(organizationId);
    const list = materialList(priceDeck(res.design, { rates: book, market: resolveMarket({ address: res.address }) }));
    const rows: Prisma.ProjectMaterialCreateManyInput[] = [];
    for (const g of list.groups) {
      // The takeoff's build step names the stage: footings → Footings, ledger/framing → Framing, the rest → Decking and railings.
      const stage = stageForLine(g.label, stages) ?? stageForLine(g.step === "footings" ? "footings" : g.step === "ledger" || g.step === "framing" ? "framing" : "decking railing", stages);
      for (const l of g.lines) {
        if (l.byClient || !(l.qty > 0)) continue;
        const name = l.note ? `${l.label} — ${l.note}` : l.label;
        if (have.has(name.toLowerCase())) continue;
        have.add(name.toLowerCase());
        rows.push({ organizationId, projectId, proposalId: p.id, name: name.slice(0, 200), quantity: l.qty, unit: l.unit || "each", unitCost: l.unitPrice > 0 ? r2(l.unitPrice) : null, source: "TAKEOFF", stageId: stage?.id ?? null });
      }
    }
    if (rows.length) await db.projectMaterial.createMany({ data: rows });
    return { added: rows.length, from: p.title };
  }
  return { added: 0, from: null };
}

// ── orders ───────────────────────────────────────────────────────────────────

export type PlaceOrderInput = {
  projectId: string;
  how: OrderHow;
  /** Which lines and how much of each (at most what is still to buy). */
  lines: Array<{ materialId: string; quantity: number }>;
  stageId?: string | null;
  supplierId?: string | null;
  buyer?: { name: string; email?: string | null; phone?: string | null; workerId?: string | null } | null;
  orderBy?: string | null;
  expectedAt?: string | null;
  note?: string | null;
  quotedTotal?: number | null;
};

export type PlaceOrderResult = { id: string; number: number; link: string; email: "sent" | "none" | "failed"; text: "sent" | "none" | "failed"; lines: number };

const day = (s: string | null | undefined) => (s ? new Date(`${s}T00:00:00.000Z`) : null);

/** Part of the list, bought one way. */
export async function placeOrder(organizationId: string, actorId: string | null, input: PlaceOrderInput): Promise<PlaceOrderResult> {
  const project = await db.project.findFirst({ where: { id: input.projectId, organizationId }, select: { id: true, name: true, number: true, clientId: true, organization: { select: { name: true, gmailSettingsJson: true, gmailTokensJson: true, billingEmail: true, phone: true } } } });
  if (!project) throw new Error("Project not found");
  const wanted = new Map(input.lines.filter((l) => l.quantity > 0).map((l) => [l.materialId, l.quantity]));
  if (!wanted.size) throw new Error("Nothing to order");
  const materials = await db.projectMaterial.findMany({ where: { id: { in: [...wanted.keys()] }, projectId: project.id }, select: { id: true, name: true, unit: true, quantity: true, orderedQty: true, receivedQty: true, stageId: true, unitCost: true } });
  if (materials.length !== wanted.size) throw new Error("A line is not on this project");
  const supplier = input.how === "SUPPLIER" && input.supplierId ? await db.supplier.findFirst({ where: { id: input.supplierId, organizationId }, select: { id: true, name: true, email: true, leadDays: true } }) : null;
  if (input.how === "SUPPLIER" && !supplier) throw new Error("Pick the supplier");
  if (input.how === "BUYER" && !input.buyer?.name?.trim()) throw new Error("Who is buying it?");
  const worker = input.how === "BUYER" && input.buyer?.workerId ? await db.workerProfile.findFirst({ where: { id: input.buyer.workerId, organizationId }, select: { id: true, displayName: true, phone: true, smsOptIn: true, organizationId: true, user: { select: { email: true, notificationPrefsJson: true } } } }) : null;

  // The stage: as given, else the one most lines belong to; the order-by day from its first day and the lead time.
  const stageId = input.stageId ?? mode(materials.map((m) => m.stageId).filter(Boolean) as string[]) ?? null;
  const stage = stageId ? await db.projectStage.findFirst({ where: { id: stageId, projectId: project.id }, select: { id: true, name: true, startsAt: true } }) : null;
  const lead = input.how === "STOCK" ? 0 : (supplier?.leadDays ?? DEFAULT_LEAD_DAYS);
  const orderBy = day(input.orderBy) ?? orderByDate(stage?.startsAt, lead);
  const expectedAt = day(input.expectedAt) ?? (input.how === "STOCK" ? new Date() : stage?.startsAt ?? null);
  const top = await db.projectOrder.aggregate({ where: { projectId: project.id }, _max: { number: true } });
  const now = new Date();
  const stock = input.how === "STOCK";

  const order = await db.projectOrder.create({
    data: {
      organizationId,
      projectId: project.id,
      number: (top._max.number ?? 0) + 1,
      how: input.how,
      status: stock ? "DELIVERED" : "ORDERED",
      stageId: stage?.id ?? null,
      supplierId: supplier?.id ?? null,
      buyerName: input.how === "BUYER" ? (worker?.displayName ?? input.buyer!.name.trim().slice(0, 120)) : null,
      buyerEmail: input.how === "BUYER" ? (worker?.user?.email ?? input.buyer?.email?.trim() ?? null) : null,
      buyerPhone: input.how === "BUYER" ? (worker?.phone ?? input.buyer?.phone?.trim() ?? null) : null,
      buyerWorkerId: worker?.id ?? null,
      orderBy,
      expectedAt,
      orderedAt: now,
      deliveredAt: stock ? now : null,
      note: input.note?.trim().slice(0, 1000) || null,
      quotedTotal: input.quotedTotal != null && input.quotedTotal >= 0 ? r2(input.quotedTotal) : stock ? null : quoted(materials, wanted),
      createdById: actorId,
      lines: {
        create: materials.map((m) => {
          const q = Math.min(wanted.get(m.id)!, Math.max(toBuyQty(m), wanted.get(m.id)!));
          return { materialId: m.id, quantity: q, receivedQty: stock ? q : 0, status: stock ? "RECEIVED" : "OPEN" };
        }),
      },
    },
    select: { id: true, number: true, publicToken: true, lines: { select: { materialId: true, quantity: true } } },
  });
  // The list keeps count of what is ordered (and, from stock, in).
  for (const l of order.lines) {
    await db.projectMaterial.update({ where: { id: l.materialId }, data: { orderedQty: { increment: l.quantity }, ...(stock ? { receivedQty: { increment: l.quantity } } : {}) } });
  }

  const base = await appBaseUrl();
  const link = `${base}/buy/${order.publicToken}`;
  let email: PlaceOrderResult["email"] = "none";
  let text: PlaceOrderResult["text"] = "none";
  const label = `${project.name}${project.number ? ` (#${project.number})` : ""}`;
  const lineRows = materials.map((m) => ({ name: m.name, qty: qtyWords(order.lines.find((l) => l.materialId === m.id)?.quantity ?? 0, m.unit) }));

  if (input.how === "SUPPLIER" && supplier) {
    if (supplier.email) {
      try {
        await sendOrgEmail(project.organization, {
          to: supplier.email,
          subject: `Purchase order ${order.number} — ${project.organization.name ?? "our company"} — ${project.name}`,
          html: poHtml({ company: project.organization.name ?? "Our company", to: supplier.name, project: label, lines: lineRows, note: input.note, needBy: stage?.startsAt ? `Needed on site by ${stage.startsAt.toISOString().slice(0, 10)}${stage ? ` (${stage.name})` : ""}.` : null, phone: project.organization.phone }),
        });
        email = "sent";
      } catch (err) {
        console.warn(`[projectBuying] PO email to ${supplier.name} failed: ${err instanceof Error ? err.message : String(err)}`);
        email = "failed";
      }
    }
  }
  if (input.how === "BUYER") {
    const to = worker?.user?.email ?? input.buyer?.email?.trim();
    if (to) {
      try {
        await sendOrgEmail(project.organization, {
          to,
          subject: `Please buy these for ${project.name} — ${project.organization.name ?? "our company"}`,
          html: buyerHtml({ company: project.organization.name ?? "Our company", name: order.lines.length ? (worker?.displayName ?? input.buyer!.name) : "", project: label, lines: lineRows, link, note: input.note, needBy: stage?.startsAt ? stage.startsAt.toISOString().slice(0, 10) : null }),
        });
        email = "sent";
      } catch (err) {
        console.warn(`[projectBuying] buyer email failed: ${err instanceof Error ? err.message : String(err)}`);
        email = "failed";
      }
    }
    if (worker) {
      const r = await textWorker(worker, `${project.organization.name ?? "The office"}: please buy ${order.lines.length} item${order.lines.length === 1 ? "" : "s"} for ${project.name}${stage?.startsAt ? ` by ${stage.startsAt.toISOString().slice(0, 10)}` : ""}. The list: ${link}`, "project-buy").catch(() => null);
      text = r && r.ok && (r.status === "SENT" || r.status === "HELD") ? "sent" : r ? "failed" : "none";
    }
  }

  await logActivity({
    organizationId,
    actorId,
    kind: TRAIL_KINDS.PROJECT,
    summary: `Order ${order.number} on ${project.name} — ${order.lines.length} line${order.lines.length === 1 ? "" : "s"} ${input.how === "SUPPLIER" ? `to ${supplier?.name}` : input.how === "BUYER" ? `for ${worker?.displayName ?? input.buyer?.name} to buy` : "from stock"}${stage ? ` (${stage.name})` : ""}`,
    clientId: project.clientId,
    meta: { projectId: project.id, orderId: order.id, how: input.how },
  });
  // The stages' "Order …" tasks this order covers are done now ("Order cabinets" when the cabinets went out).
  const open = await db.projectTask.findMany({ where: { projectId: project.id, doneAt: null, title: { startsWith: "Order" } }, select: { id: true, title: true } }).catch(() => []);
  for (const t of open) {
    if (orderCoversTask(t.title, materials.map((m) => m.name))) await markTask(organizationId, t.id, true, actorId).catch(() => null);
  }
  return { id: order.id, number: order.number, link, email, text, lines: order.lines.length };
}

function mode(ids: string[]): string | null {
  const n = new Map<string, number>();
  for (const id of ids) n.set(id, (n.get(id) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

function quoted(materials: Array<{ id: string; unitCost: number | null }>, wanted: Map<string, number>): number | null {
  let total = 0;
  let any = false;
  for (const m of materials) {
    if (m.unitCost == null) continue;
    any = true;
    total += m.unitCost * (wanted.get(m.id) ?? 0);
  }
  return any ? r2(total) : null;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
}

function rowsHtml(lines: Array<{ name: string; qty: string }>): string {
  return `<table style="border-collapse:collapse;font-family:sans-serif;font-size:14px">${lines
    .map((l) => `<tr><td style="padding:6px 10px;border-bottom:1px solid #e5e5e5">${esc(l.name)}</td><td style="padding:6px 10px;border-bottom:1px solid #e5e5e5;text-align:right;white-space:nowrap">${esc(l.qty)}</td></tr>`)
    .join("")}</table>`;
}

function poHtml(i: { company: string; to: string; project: string; lines: Array<{ name: string; qty: string }>; note?: string | null; needBy: string | null; phone: string | null }): string {
  return `<p>Hello ${esc(i.to)},</p><p>Please supply the following for ${esc(i.company)} — ${esc(i.project)}:</p>${rowsHtml(i.lines)}${i.needBy ? `<p>${esc(i.needBy)}</p>` : ""}${i.note ? `<p>${esc(i.note)}</p>` : ""}<p>Please reply with the price and the delivery date.</p><p>Thank you,<br>${esc(i.company)}${i.phone ? `<br>${esc(i.phone)}` : ""}</p>`;
}

function buyerHtml(i: { company: string; name: string; project: string; lines: Array<{ name: string; qty: string }>; link: string; note?: string | null; needBy: string | null }): string {
  return `<p>Hi ${esc(i.name)},</p><p>${esc(i.company)} asks you to buy these for ${esc(i.project)}${i.needBy ? `, needed on site by ${esc(i.needBy)}` : ""}:</p>${rowsHtml(i.lines)}${i.note ? `<p>${esc(i.note)}</p>` : ""}<p>Tick each item as you buy it and type what you paid here (no sign-in):<br><a href="${esc(i.link)}">${esc(i.link)}</a></p><p>Thank you,<br>${esc(i.company)}</p>`;
}

// ── the delivery ─────────────────────────────────────────────────────────────

export type OrderPatch = {
  status?: "ORDERED" | "SHIPPED" | "DELIVERED";
  carrier?: string | null;
  trackingNumber?: string | null;
  expectedAt?: string | null;
  orderBy?: string | null;
  note?: string | null;
  quotedTotal?: number | null;
  paidTotal?: number | null;
};

async function orderOf(organizationId: string, orderId: string) {
  const o = await db.projectOrder.findFirst({
    where: { id: orderId, organizationId },
    select: { id: true, number: true, how: true, status: true, projectId: true, supplierId: true, buyerName: true, paidTotal: true, expenseId: true, supplier: { select: { name: true } }, project: { select: { name: true, number: true, clientId: true } }, lines: { select: { id: true, materialId: true, quantity: true, receivedQty: true, status: true, material: { select: { name: true, unit: true } } } } },
  });
  if (!o) throw new Error("Order not found");
  return o;
}

/** Shipped, delivered (every line in full), the tracking number, the days, the note, the money. */
export async function updateOrder(organizationId: string, orderId: string, patch: OrderPatch, actorId: string | null): Promise<void> {
  const o = await orderOf(organizationId, orderId);
  if (o.status === "CANCELED") throw new Error("That order was canceled");
  const now = new Date();
  const data: Prisma.ProjectOrderUpdateInput = {};
  if (patch.trackingNumber !== undefined) {
    const t = patch.trackingNumber?.trim() || null;
    data.trackingNumber = t;
    data.carrier = patch.carrier?.trim() || (t ? (carrierOf(t)?.carrier ?? null) : null);
    // A tracking number pasted on an ordered order means it shipped.
    if (t && o.status === "ORDERED" && !patch.status) {
      data.status = "SHIPPED";
      data.shippedAt = now;
    }
  } else if (patch.carrier !== undefined) data.carrier = patch.carrier?.trim() || null;
  if (patch.expectedAt !== undefined) data.expectedAt = day(patch.expectedAt);
  if (patch.orderBy !== undefined) data.orderBy = day(patch.orderBy);
  if (patch.note !== undefined) data.note = patch.note?.trim().slice(0, 1000) || null;
  if (patch.quotedTotal !== undefined) data.quotedTotal = patch.quotedTotal != null ? r2(patch.quotedTotal) : null;
  if (patch.paidTotal !== undefined) data.paidTotal = patch.paidTotal != null ? r2(patch.paidTotal) : null;
  if (patch.status === "SHIPPED") {
    data.status = "SHIPPED";
    data.shippedAt = now;
  }
  if (patch.status === "ORDERED") {
    data.status = "ORDERED";
    data.shippedAt = null;
  }
  await db.projectOrder.update({ where: { id: o.id }, data });
  if (patch.status === "DELIVERED") {
    await receiveOrder(organizationId, orderId, o.lines.map((l) => ({ lineId: l.id, receivedQty: l.quantity })), actorId);
  }
}

/**
 * What arrived, line by line. A line short of its quantity is MISSING and the shortfall goes back on the to-buy
 * list; the office is told. The order is DELIVERED when every line came in full, PARTIAL otherwise.
 */
export async function receiveOrder(organizationId: string, orderId: string, lines: Array<{ lineId: string; receivedQty: number }>, actorId: string | null): Promise<{ missing: Array<{ name: string; short: number; unit: string }> }> {
  const o = await orderOf(organizationId, orderId);
  if (o.status === "CANCELED") throw new Error("That order was canceled");
  const got = new Map(lines.map((l) => [l.lineId, Math.max(0, l.receivedQty)]));
  const missing: Array<{ name: string; short: number; unit: string }> = [];
  const now = new Date();
  for (const l of o.lines) {
    if (!got.has(l.id)) continue;
    const received = r2(Math.min(l.quantity, got.get(l.id)!));
    const short = r2(l.quantity - received);
    const wasShort = r2(l.quantity - l.receivedQty);
    await db.projectOrderLine.update({ where: { id: l.id }, data: { receivedQty: received, status: short > 0 ? "MISSING" : "RECEIVED" } });
    // The list: what came in counts as in; what did not come goes back to buy (the order no longer covers it).
    await db.projectMaterial.update({
      where: { id: l.materialId },
      data: { receivedQty: { increment: r2(received - l.receivedQty) }, orderedQty: { decrement: r2(short - (l.status === "MISSING" ? wasShort : 0)) } },
    });
    if (short > 0) missing.push({ name: l.material.name, short, unit: l.material.unit });
  }
  const all = await db.projectOrderLine.findMany({ where: { orderId: o.id }, select: { status: true, quantity: true, receivedQty: true } });
  const complete = all.every((l) => l.receivedQty >= l.quantity);
  await db.projectOrder.update({ where: { id: o.id }, data: { status: complete ? "DELIVERED" : "PARTIAL", deliveredAt: now } });
  const label = orderLabel({ number: o.number, how: o.how, supplierName: o.supplier?.name, buyerName: o.buyerName, lineCount: o.lines.length });
  await logActivity({
    organizationId,
    actorId,
    kind: TRAIL_KINDS.PROJECT,
    summary: complete ? `${label} delivered on ${o.project.name}` : `${label} delivered on ${o.project.name} — ${missing.length} line${missing.length === 1 ? "" : "s"} missing: ${missing.map((m) => `${m.name} (${qtyWords(m.short, m.unit)} short)`).join(", ")}`.slice(0, 500),
    clientId: o.project.clientId,
    meta: { projectId: o.projectId, orderId: o.id, missing },
  });
  if (missing.length) await tellOffice(organizationId, o.projectId, `${o.project.name}: ${label} came in short — ${missing.map((m) => `${m.name} (${qtyWords(m.short, m.unit)} short)`).join(", ")}. Those lines are back on the to-buy list.`);
  return { missing };
}

/** An order that will not come: every line back on the list. */
export async function cancelOrder(organizationId: string, orderId: string, actorId: string | null): Promise<void> {
  const o = await orderOf(organizationId, orderId);
  if (o.status === "CANCELED") return;
  for (const l of o.lines) {
    await db.projectMaterial.update({ where: { id: l.materialId }, data: { orderedQty: { decrement: r2(l.quantity - l.receivedQty) } } });
  }
  await db.projectOrder.update({ where: { id: o.id }, data: { status: "CANCELED" } });
  await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.PROJECT, summary: `Canceled order ${o.number} on ${o.project.name}`, clientId: o.project.clientId, meta: { projectId: o.projectId, orderId: o.id } });
}

/** What it cost, as a Materials expense on the project — once per order (a second call updates the amount). */
export async function logOrderExpense(organizationId: string, orderId: string, amount: number, actorId: string | null): Promise<{ expenseId: string }> {
  const o = await orderOf(organizationId, orderId);
  const vendor = o.how === "SUPPLIER" ? (o.supplier?.name ?? "Supplier") : o.how === "BUYER" ? (o.buyerName ?? "Buyer") : "Stock";
  const note = `Order ${o.number} · ${o.lines.length} line${o.lines.length === 1 ? "" : "s"}`;
  const amt = r2(Math.max(0, amount));
  let expenseId = o.expenseId;
  if (expenseId && (await db.projectExpense.findFirst({ where: { id: expenseId, projectId: o.projectId }, select: { id: true } }))) {
    await db.projectExpense.update({ where: { id: expenseId }, data: { amount: amt, vendor, note } });
  } else {
    expenseId = (await db.projectExpense.create({ data: { projectId: o.projectId, category: "MATERIALS", amount: amt, vendor, note, createdById: actorId }, select: { id: true } })).id;
  }
  await db.projectOrder.update({ where: { id: o.id }, data: { expenseId, paidTotal: amt } });
  return { expenseId };
}

/** The office's email: one line, one button to the project (lib/email/renderEmail owns the markup). */
function officeDoc(i: { org: { name: string; logoUrl: string | null; phone: string | null }; line: string; href: string }): EmailDoc {
  return {
    subject: i.line.slice(0, 120),
    lockup: { kind: "org", name: i.org.name, logoUrl: i.org.logoUrl },
    kicker: { text: "Project buying" },
    headline: i.line.slice(0, 200),
    cta: { label: "Open the project", href: i.href },
    footer: { name: i.org.name, contact: i.org.phone ?? undefined },
  };
}

/** The office, by email (everyone whose pref is on) and by text (those who ticked Text). */
async function tellOffice(organizationId: string, projectId: string, line: string): Promise<void> {
  try {
    const base = await appBaseUrl();
    const href = `${base}/dashboard/projects/${projectId}`;
    await textOffice(organizationId, "proposal-accepted", `${line} ${href}`);
    const org = await db.organization.findUnique({ where: { id: organizationId }, select: { name: true, logoUrl: true, phone: true } });
    await sendToMembersByPref(organizationId, "proposal-accepted", officeDoc({ org: { name: org?.name ?? "JobFlex", logoUrl: org?.logoUrl ?? null, phone: org?.phone ?? null }, line, href }));
  } catch (err) {
    console.warn(`[projectBuying] could not tell the office: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ── the buyer's page ─────────────────────────────────────────────────────────

export type BuyerView = {
  company: string;
  project: string;
  buyerName: string | null;
  status: string;
  needBy: string | null;
  note: string | null;
  buyerNote: string | null;
  paidTotal: number | null;
  lines: Array<{ id: string; name: string; qty: string; store: string | null; productUrl: string | null; bought: boolean }>;
  done: boolean;
};

export async function buyerView(token: string): Promise<BuyerView | null> {
  const o = await db.projectOrder.findUnique({
    where: { publicToken: token },
    select: {
      id: true,
      how: true,
      status: true,
      buyerName: true,
      note: true,
      buyerNote: true,
      paidTotal: true,
      expectedAt: true,
      project: { select: { name: true, number: true, organization: { select: { name: true, deletedAt: true } } } },
      stage: { select: { name: true, startsAt: true } },
      lines: { orderBy: { createdAt: "asc" }, select: { id: true, quantity: true, status: true, material: { select: { name: true, unit: true, store: true, productUrl: true } } } },
    },
  });
  if (!o || o.project.organization.deletedAt) return null;
  await db.projectOrder.update({ where: { id: o.id }, data: { buyerSeenAt: new Date() } }).catch(() => null);
  return {
    company: o.project.organization.name,
    project: `${o.project.name}${o.project.number ? ` (#${o.project.number})` : ""}`,
    buyerName: o.buyerName,
    status: o.status,
    needBy: o.stage?.startsAt ? o.stage.startsAt.toISOString().slice(0, 10) : o.expectedAt ? o.expectedAt.toISOString().slice(0, 10) : null,
    note: o.note,
    buyerNote: o.buyerNote,
    paidTotal: o.paidTotal,
    lines: o.lines.map((l) => ({ id: l.id, name: l.material.name, qty: qtyWords(l.quantity, l.material.unit), store: l.material.store, productUrl: l.material.productUrl, bought: l.status === "BOUGHT" || l.status === "RECEIVED" })),
    done: o.status === "DELIVERED" || o.status === "PARTIAL" || o.status === "CANCELED",
  };
}

/** The buyer ticks what they bought and says what they paid. The office is told once everything is ticked. */
export async function buyerUpdate(token: string, input: { bought: string[]; paidTotal: number | null; note: string | null }): Promise<{ ok: true } | { ok: false; error: string }> {
  const o = await db.projectOrder.findUnique({ where: { publicToken: token }, select: { id: true, organizationId: true, projectId: true, number: true, how: true, status: true, buyerName: true, project: { select: { name: true, organization: { select: { deletedAt: true } } } }, lines: { select: { id: true, status: true } } } });
  if (!o || o.project.organization.deletedAt) return { ok: false, error: "This link is no longer valid." };
  if (o.status === "CANCELED") return { ok: false, error: "This order was canceled." };
  const bought = new Set(input.bought);
  for (const l of o.lines) {
    if (l.status === "RECEIVED" || l.status === "MISSING") continue;
    const next = bought.has(l.id) ? "BOUGHT" : "OPEN";
    if (next !== l.status) await db.projectOrderLine.update({ where: { id: l.id }, data: { status: next } });
  }
  const paid = input.paidTotal != null && Number.isFinite(input.paidTotal) && input.paidTotal >= 0 ? r2(input.paidTotal) : null;
  await db.projectOrder.update({ where: { id: o.id }, data: { paidTotal: paid ?? undefined, buyerNote: input.note?.trim().slice(0, 1000) || null, buyerSeenAt: new Date() } });
  const open = o.lines.filter((l) => l.status !== "RECEIVED" && l.status !== "MISSING");
  if (open.length && open.every((l) => bought.has(l.id)) && !o.lines.every((l) => l.status === "BOUGHT")) {
    await tellOffice(o.organizationId, o.projectId, `${o.buyerName ?? "The buyer"} bought everything on order ${o.number} for ${o.project.name}${paid != null ? ` — $${paid.toLocaleString("en-US")} paid` : ""}.`);
  }
  return { ok: true };
}

// ── the read ─────────────────────────────────────────────────────────────────

export type BuyingMaterial = {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  unitCost: number | null;
  source: string;
  store: string | null;
  productUrl: string | null;
  orderedQty: number;
  receivedQty: number;
  stageId: string | null;
  stageName: string | null;
  /** The stage's first day, ISO, for the order-by words. */
  stageStart: string | null;
  /** The stage is done: its lines no longer have an order-by day to miss. */
  stageDone: boolean;
};

export type BuyingOrder = {
  id: string;
  number: number;
  how: string;
  status: string;
  stageName: string | null;
  supplier: { id: string; name: string; email: string | null } | null;
  buyerName: string | null;
  buyerEmail: string | null;
  buyerPhone: string | null;
  buyerWorkerId: string | null;
  link: string;
  orderBy: string | null;
  expectedAt: string | null;
  orderedAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  carrier: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  note: string | null;
  buyerNote: string | null;
  buyerSeenAt: string | null;
  quotedTotal: number | null;
  paidTotal: number | null;
  expenseId: string | null;
  lines: Array<{ id: string; materialId: string; name: string; unit: string; quantity: number; receivedQty: number; status: string }>;
};

export type BuyingRead = {
  materials: BuyingMaterial[];
  orders: BuyingOrder[];
  suppliers: Array<{ id: string; name: string; email: string | null; leadDays: number | null }>;
  crew: Array<{ id: string; name: string; texts: boolean; email: string | null }>;
  /** A sold Deck Studio proposal is on the project: its takeoff can be added. */
  deckTakeoff: boolean;
  /** Sold proposals whose lines are not on the list yet (the list was never seeded, or a sale came after). */
  unseeded: number;
};

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export async function buyingOf(organizationId: string, projectId: string): Promise<BuyingRead> {
  const [materials, orders, suppliers, crew, project, base] = await Promise.all([
    db.projectMaterial.findMany({ where: { projectId }, orderBy: [{ stage: { position: "asc" } }, { createdAt: "asc" }], include: { stage: { select: { name: true, startsAt: true, status: true } } } }),
    db.projectOrder.findMany({ where: { projectId }, orderBy: { number: "desc" }, include: { supplier: { select: { id: true, name: true, email: true } }, stage: { select: { name: true } }, lines: { orderBy: { createdAt: "asc" }, include: { material: { select: { name: true, unit: true } } } } } }),
    db.supplier.findMany({ where: { organizationId }, orderBy: { name: "asc" }, select: { id: true, name: true, email: true, leadDays: true } }),
    db.workerProfile.findMany({ where: { organizationId, inviteStatus: { not: "DECLINED" } }, orderBy: { displayName: "asc" }, select: { id: true, displayName: true, phone: true, smsOptIn: true, user: { select: { email: true } } } }),
    db.project.findFirst({ where: { id: projectId, organizationId }, select: { proposals: { where: { status: { in: SOLD } }, select: { id: true, lineItems: { select: { id: true } }, activities: { where: { kind: "DECK_PLAN" }, select: { id: true }, take: 1 } } } } }),
    appBaseUrl(),
  ]);
  const seeded = new Set(materials.map((m) => m.lineItemId).filter(Boolean) as string[]);
  const unseeded = (project?.proposals ?? []).filter((p) => p.lineItems.length && !p.lineItems.some((l) => seeded.has(l.id))).length;
  return {
    materials: materials.map((m) => ({
      id: m.id,
      name: m.name,
      quantity: m.quantity,
      unit: m.unit,
      unitCost: m.unitCost,
      source: m.source,
      store: m.store,
      productUrl: m.productUrl,
      orderedQty: m.orderedQty,
      receivedQty: m.receivedQty,
      stageId: m.stageId,
      stageName: m.stage?.name ?? null,
      stageStart: iso(m.stage?.startsAt ?? null),
      stageDone: m.stage?.status === "DONE",
    })),
    orders: orders.map((o) => ({
      id: o.id,
      number: o.number,
      how: o.how,
      status: o.status,
      stageName: o.stage?.name ?? null,
      supplier: o.supplier,
      buyerName: o.buyerName,
      buyerEmail: o.buyerEmail,
      buyerPhone: o.buyerPhone,
      buyerWorkerId: o.buyerWorkerId,
      link: `${base}/buy/${o.publicToken}`,
      orderBy: iso(o.orderBy),
      expectedAt: iso(o.expectedAt),
      orderedAt: iso(o.orderedAt),
      shippedAt: iso(o.shippedAt),
      deliveredAt: iso(o.deliveredAt),
      carrier: o.carrier,
      trackingNumber: o.trackingNumber,
      trackingUrl: o.trackingNumber ? (carrierOf(o.trackingNumber)?.url ?? null) : null,
      note: o.note,
      buyerNote: o.buyerNote,
      buyerSeenAt: iso(o.buyerSeenAt),
      quotedTotal: o.quotedTotal,
      paidTotal: o.paidTotal,
      expenseId: o.expenseId,
      lines: o.lines.map((l) => ({ id: l.id, materialId: l.materialId, name: l.material.name, unit: l.material.unit, quantity: l.quantity, receivedQty: l.receivedQty, status: l.status })),
    })),
    suppliers,
    crew: crew.map((w) => ({ id: w.id, name: w.displayName, texts: Boolean(w.phone && w.smsOptIn), email: w.user?.email ?? null })),
    deckTakeoff: (project?.proposals ?? []).some((p) => p.activities.length > 0),
    unseeded,
  };
}
