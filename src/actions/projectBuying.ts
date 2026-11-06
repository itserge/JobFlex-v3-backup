"use server";
// BUYING AND DELIVERIES ON A PROJECT — the writes (the buying build, 2026-11-05). Projects are estimators' and
// managers' (actions/projects), so every write is requireEstimatorOrManager; the database work is
// lib/projectBuying/server, the rules lib/projectBuying/shared. The buyer's own page writes through
// `buyerSave` with its token alone (no session): it ticks lines and says what was paid, nothing else.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireEstimatorOrManager } from "@/lib/orgContext";
import {
  addDeckTakeoff,
  buyerUpdate,
  cancelOrder,
  logOrderExpense,
  placeOrder,
  receiveOrder,
  seedMaterials,
  updateOrder,
  type PlaceOrderResult,
} from "@/lib/projectBuying/server";

const ID = z.string().min(1).max(64);
const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();

function touched(projectId: string) {
  revalidatePath("/dashboard/projects");
  revalidatePath(`/dashboard/projects/${projectId}`);
  revalidatePath(`/mobile-project-detail-v2/${projectId}`);
}

async function projectOf(organizationId: string, projectId: string) {
  const p = await db.project.findFirst({ where: { id: projectId, organizationId }, select: { id: true } });
  if (!p) throw new Error("Project not found");
  return p;
}

// ── the list ─────────────────────────────────────────────────────────────────

/** The to-buy list from what was sold (only lines not on it yet). */
export async function refreshMaterials(projectId: string): Promise<{ added: number }> {
  const { organizationId } = await requireEstimatorOrManager();
  await projectOf(organizationId, projectId);
  const added = await seedMaterials(organizationId, projectId);
  touched(projectId);
  return { added };
}

export async function addDeckMaterials(projectId: string): Promise<{ added: number; from: string | null }> {
  const { organizationId } = await requireEstimatorOrManager();
  await projectOf(organizationId, projectId);
  const r = await addDeckTakeoff(organizationId, projectId);
  touched(projectId);
  return r;
}

const materialInput = z.object({
  name: z.string().trim().min(1).max(200),
  quantity: z.number().positive().max(1_000_000),
  unit: z.string().trim().min(1).max(20).optional(),
  unitCost: z.number().min(0).max(10_000_000).nullable().optional(),
  stageId: ID.nullable().optional(),
  store: z.string().trim().max(120).nullable().optional(),
  productUrl: z.string().trim().url().max(500).nullable().optional(),
});

export async function addMaterial(projectId: string, raw: unknown): Promise<{ id: string }> {
  const { organizationId } = await requireEstimatorOrManager();
  await projectOf(organizationId, projectId);
  const d = materialInput.parse(raw);
  if (d.stageId && !(await db.projectStage.findFirst({ where: { id: d.stageId, projectId }, select: { id: true } }))) throw new Error("That stage is not on this project");
  const m = await db.projectMaterial.create({
    data: { organizationId, projectId, name: d.name, quantity: d.quantity, unit: d.unit || "each", unitCost: d.unitCost ?? null, stageId: d.stageId ?? null, store: d.store || null, productUrl: d.productUrl || null, source: "HAND" },
    select: { id: true },
  });
  touched(projectId);
  return { id: m.id };
}

export async function updateMaterial(materialId: string, raw: unknown): Promise<void> {
  const { organizationId } = await requireEstimatorOrManager();
  const m = await db.projectMaterial.findFirst({ where: { id: materialId, organizationId }, select: { id: true, projectId: true, orderedQty: true } });
  if (!m) throw new Error("Line not found");
  const d = materialInput.partial().parse(raw);
  if (d.quantity != null && d.quantity < m.orderedQty) throw new Error(`${m.orderedQty} of it is ordered already — cancel the order first`);
  if (d.stageId && !(await db.projectStage.findFirst({ where: { id: d.stageId, projectId: m.projectId }, select: { id: true } }))) throw new Error("That stage is not on this project");
  await db.projectMaterial.update({
    where: { id: m.id },
    data: {
      ...(d.name !== undefined && { name: d.name }),
      ...(d.quantity !== undefined && { quantity: d.quantity }),
      ...(d.unit !== undefined && { unit: d.unit || "each" }),
      ...(d.unitCost !== undefined && { unitCost: d.unitCost }),
      ...(d.stageId !== undefined && { stageId: d.stageId }),
      ...(d.store !== undefined && { store: d.store || null }),
      ...(d.productUrl !== undefined && { productUrl: d.productUrl || null }),
    },
  });
  touched(m.projectId);
}

export async function deleteMaterial(materialId: string): Promise<void> {
  const { organizationId } = await requireEstimatorOrManager();
  const m = await db.projectMaterial.findFirst({ where: { id: materialId, organizationId }, select: { id: true, projectId: true, orderedQty: true } });
  if (!m) throw new Error("Line not found");
  if (m.orderedQty > 0) throw new Error("It is on an order — cancel the order first");
  await db.projectMaterial.delete({ where: { id: m.id } });
  touched(m.projectId);
}

// ── orders ───────────────────────────────────────────────────────────────────

const orderInput = z.object({
  projectId: ID,
  how: z.enum(["SUPPLIER", "BUYER", "STOCK"]),
  lines: z.array(z.object({ materialId: ID, quantity: z.number().positive().max(1_000_000) })).min(1).max(200),
  stageId: ID.nullable().optional(),
  supplierId: ID.nullable().optional(),
  buyer: z.object({ name: z.string().trim().max(120), email: z.string().trim().email().max(200).nullable().optional(), phone: z.string().trim().max(40).nullable().optional(), workerId: ID.nullable().optional() }).nullable().optional(),
  orderBy: DAY.optional(),
  expectedAt: DAY.optional(),
  note: z.string().trim().max(1000).nullable().optional(),
  quotedTotal: z.number().min(0).max(100_000_000).nullable().optional(),
});

export async function placeProjectOrder(raw: unknown): Promise<PlaceOrderResult> {
  const { organizationId, user } = await requireEstimatorOrManager();
  const d = orderInput.parse(raw);
  const r = await placeOrder(organizationId, user.id, d);
  touched(d.projectId);
  return r;
}

const patchInput = z.object({
  status: z.enum(["ORDERED", "SHIPPED", "DELIVERED"]).optional(),
  carrier: z.string().trim().max(40).nullable().optional(),
  trackingNumber: z.string().trim().max(200).nullable().optional(),
  expectedAt: DAY.optional(),
  orderBy: DAY.optional(),
  note: z.string().trim().max(1000).nullable().optional(),
  quotedTotal: z.number().min(0).max(100_000_000).nullable().optional(),
  paidTotal: z.number().min(0).max(100_000_000).nullable().optional(),
});

async function orderProject(organizationId: string, orderId: string): Promise<string> {
  const o = await db.projectOrder.findFirst({ where: { id: orderId, organizationId }, select: { projectId: true } });
  if (!o) throw new Error("Order not found");
  return o.projectId;
}

export async function patchProjectOrder(orderId: string, raw: unknown): Promise<void> {
  const { organizationId, user } = await requireEstimatorOrManager();
  const projectId = await orderProject(organizationId, orderId);
  await updateOrder(organizationId, orderId, patchInput.parse(raw), user.id);
  touched(projectId);
}

/** What arrived, line by line — the rest goes back on the list. */
export async function receiveProjectOrder(orderId: string, raw: unknown): Promise<{ missing: Array<{ name: string; short: number; unit: string }> }> {
  const { organizationId, user } = await requireEstimatorOrManager();
  const projectId = await orderProject(organizationId, orderId);
  const lines = z.array(z.object({ lineId: ID, receivedQty: z.number().min(0).max(1_000_000) })).min(1).parse(raw);
  const r = await receiveOrder(organizationId, orderId, lines, user.id);
  touched(projectId);
  return r;
}

export async function cancelProjectOrder(orderId: string): Promise<void> {
  const { organizationId, user } = await requireEstimatorOrManager();
  const projectId = await orderProject(organizationId, orderId);
  await cancelOrder(organizationId, orderId, user.id);
  touched(projectId);
}

export async function logProjectOrderExpense(orderId: string, amount: number): Promise<{ expenseId: string }> {
  const { organizationId, user } = await requireEstimatorOrManager();
  const projectId = await orderProject(organizationId, orderId);
  const amt = z.number().min(0).max(100_000_000).parse(amount);
  const r = await logOrderExpense(organizationId, orderId, amt, user.id);
  touched(projectId);
  return r;
}

// ── suppliers (the sheet adds one in place) ──────────────────────────────────

export async function addSupplierQuick(raw: unknown): Promise<{ id: string; name: string; email: string | null; leadDays: number | null }> {
  const { organizationId } = await requireEstimatorOrManager();
  const d = z.object({ name: z.string().trim().min(1).max(120), email: z.string().trim().email().max(200).nullable().optional(), leadDays: z.number().int().min(0).max(120).nullable().optional() }).parse(raw);
  const s = await db.supplier.create({ data: { organizationId, name: d.name, email: d.email || null, leadDays: d.leadDays ?? null }, select: { id: true, name: true, email: true, leadDays: true } });
  return s;
}

// ── the buyer's page (no session: the token is the key) ─────────────────────

export async function buyerSave(token: string, raw: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const d = z.object({ bought: z.array(ID).max(200), paidTotal: z.number().min(0).max(100_000_000).nullable(), note: z.string().trim().max(1000).nullable() }).safeParse(raw);
  if (!d.success) return { ok: false, error: "Check the amount — numbers only." };
  if (!/^[A-Za-z0-9_-]{10,80}$/.test(token)) return { ok: false, error: "This link is not valid." };
  return buyerUpdate(token, d.data);
}
