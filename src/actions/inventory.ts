"use server";

// WAREHOUSE STOCK — the writes (2026-09-20). The reads live in
// lib/inventoryBoard (server module); the arithmetic in lib/inventory.
//
// Office writes (manager or owner): items, suppliers, stock received or
// counted, the purchase order. One crew write: "loaded" on a job's pick
// list, which takes the materials out of the warehouse and frees the
// reservation — allowed to the office and to a worker ON that job.
//
// What the company keeps in stock (2026-09-23, lib/inventoryPolicy): the
// "What we stock" checklist is saved by saveStockList; a single item's choice
// rides on upsertInventoryItem (`stocked`); the standard items added in one
// go get the suggested choice (lib/inventoryStockDefaults). A purchase order
// may be for one job's per-job materials (`jobId`).

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { sendOrgEmail } from "@/lib/email/orgSend";
import { INVENTORY_PATHS, inventoryHref, isTradeId, issueFromShelf, pickList, purchaseOrderText, stockKey, type TradeId } from "@/lib/inventory";
import { presetItems } from "@/lib/inventoryPresets";
import { explodeLines } from "@/lib/inventoryBom";
import { savedTakeoffsFor } from "@/lib/fence/savedTakeoffServer";
import { recordStockPolicy, stockItemsOf, stockPolicyOf } from "@/lib/inventoryPolicy";
import { defaultStocked } from "@/lib/inventoryStockDefaults";
import { NoOrgError, requireManager, requireRouteAccess, UnauthorizedError, isWorkerRole } from "@/lib/orgContext";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";

type Fail = { ok: false; error: string };
const fail = (err: unknown): Fail =>
  err instanceof UnauthorizedError
    ? { ok: false, error: "Manager access required" }
    : err instanceof NoOrgError
      ? { ok: false, error: "No organization" }
      : { ok: false, error: err instanceof Error ? err.message : "Could not save" };

// Each trade's inventory is its own page under its estimator (2026-10-10):
// refresh them all, link into the trade's stock tab.
const refreshBoards = () => {
  for (const p of INVENTORY_PATHS) revalidatePath(p);
};
const boardHref = (trade: string) => (isTradeId(trade) ? inventoryHref(trade, "stock") : "/dashboard/inventory?tab=stock");
const money = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100;
const LABEL: Record<TradeId, string> = { fence: "Fence", roof: "Roofing", hvac: "HVAC", deck: "Deck" };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Add or edit a stock item. An existing item of the same trade and name is updated. */
export async function upsertInventoryItem(input: {
  trade: string;
  name: string;
  unit?: string;
  onHand?: number;
  reorderPoint?: number | null;
  supplierId?: string | null;
  supplierSku?: string | null;
  lastCost?: number | null;
  /** Kept in stock (true) or bought per job (false); undefined leaves the choice alone. */
  stocked?: boolean;
}): Promise<{ ok: true; id: string } | Fail> {
  try {
    const { organizationId, user } = await requireManager();
    if (!isTradeId(input.trade)) return { ok: false, error: "Unknown trade" };
    const name = input.name.trim().slice(0, 120);
    const key = stockKey(name);
    if (!key) return { ok: false, error: "Give the item a name" };
    if (input.supplierId) {
      const sup = await db.supplier.findFirst({ where: { id: input.supplierId, organizationId }, select: { id: true } });
      if (!sup) return { ok: false, error: "That supplier is not on this company" };
    }
    const data = {
      name,
      unit: (input.unit ?? "each").trim().slice(0, 24) || "each",
      reorderPoint: input.reorderPoint == null || input.reorderPoint === undefined ? null : Math.max(0, money(input.reorderPoint)),
      supplierId: input.supplierId ?? null,
      supplierSku: input.supplierSku?.trim() || null,
      lastCost: input.lastCost == null ? null : Math.max(0, money(input.lastCost)),
    };
    const before = await db.inventoryItem.findUnique({
      where: { organizationId_trade_key: { organizationId, trade: input.trade, key } },
      select: { id: true },
    });
    const row = await db.inventoryItem.upsert({
      where: { organizationId_trade_key: { organizationId, trade: input.trade, key } },
      create: { organizationId, trade: input.trade, key, onHand: Math.max(0, money(input.onHand ?? 0)), ...data },
      update: data,
      select: { id: true },
    });
    if (!before) {
      const onHand = Math.max(0, money(input.onHand ?? 0));
      await logActivity({
        organizationId,
        actorId: user.id,
        kind: TRAIL_KINDS.STOCK,
        summary: `Added ${name} to the ${LABEL[input.trade]} stock list${onHand ? ` — ${onHand} ${data.unit} on hand` : ""}`,
        meta: { itemId: row.id, trade: input.trade, onHand, unit: data.unit },
      });
    }
    if (typeof input.stocked === "boolean") {
      const policy = await stockPolicyOf(organizationId, input.trade);
      if (policy.perJob.has(key) === input.stocked) {
        const perJob = new Set(policy.perJob);
        if (input.stocked) perJob.delete(key);
        else perJob.add(key);
        await recordStockPolicy(organizationId, input.trade, perJob, user.id, input.stocked ? `${name} is kept in stock from now on` : `${name} is bought per job from now on — not counted as shelf stock`);
      }
    }
    refreshBoards();
    revalidatePath("/dashboard/jobs");
    return { ok: true, id: row.id };
  } catch (err) {
    return fail(err);
  }
}

/** Stock arrived (positive) or left outside a job (negative). */
export async function receiveStock(itemId: string, quantity: number, note?: string): Promise<{ ok: true; onHand: number } | Fail> {
  try {
    const { organizationId, user } = await requireManager();
    const qty = money(quantity);
    if (!qty) return { ok: false, error: "Enter a quantity" };
    const item = await db.inventoryItem.findFirst({ where: { id: itemId, organizationId }, select: { id: true, trade: true, onHand: true, name: true, unit: true } });
    if (!item) return { ok: false, error: "That item is not on this company" };
    // Taking off the shelf stops at what is there — the count never goes below zero.
    if (qty < 0 && item.onHand + qty < 0) return { ok: false, error: `Only ${Math.max(0, item.onHand)} ${item.unit} of ${item.name} on hand` };
    const [, updated] = await db.$transaction([
      db.inventoryMovement.create({ data: { itemId: item.id, kind: qty > 0 ? "RECEIVED" : "ADJUST", quantity: qty, note: note?.trim() || null, actorId: user.id } }),
      db.inventoryItem.update({ where: { id: item.id }, data: { onHand: { increment: qty } }, select: { onHand: true } }),
    ]);
    refreshBoards();
    await logActivity({
      organizationId,
      actorId: user.id,
      kind: TRAIL_KINDS.STOCK,
      summary: qty > 0
        ? `Received ${qty} ${item.unit} of ${item.name}${note?.trim() ? ` — ${note.trim()}` : ""}`
        : `Took ${Math.abs(qty)} ${item.unit} of ${item.name} off the shelf${note?.trim() ? ` — ${note.trim()}` : ""}`,
      meta: { itemId: item.id, trade: item.trade, quantity: qty, onHand: updated.onHand },
    });
    return { ok: true, onHand: updated.onHand };
  } catch (err) {
    return fail(err);
  }
}

/** A physical count: set what is on the shelf; the difference is booked as an adjustment. */
export async function countStock(itemId: string, onHand: number): Promise<{ ok: true; onHand: number } | Fail> {
  try {
    const { organizationId, user } = await requireManager();
    const target = Math.max(0, money(onHand));
    const item = await db.inventoryItem.findFirst({ where: { id: itemId, organizationId }, select: { id: true, trade: true, onHand: true, name: true, unit: true } });
    if (!item) return { ok: false, error: "That item is not on this company" };
    const diff = money(target - item.onHand);
    if (diff !== 0) {
      await db.$transaction([
        db.inventoryMovement.create({ data: { itemId: item.id, kind: "ADJUST", quantity: diff, note: "Counted", actorId: user.id } }),
        db.inventoryItem.update({ where: { id: item.id }, data: { onHand: target } }),
      ]);
      await logActivity({
        organizationId,
        actorId: user.id,
        kind: TRAIL_KINDS.STOCK,
        summary: `Counted ${target} ${item.unit} of ${item.name} (was ${item.onHand}, ${diff > 0 ? "+" : ""}${diff})`,
        meta: { itemId: item.id, trade: item.trade, onHand: target, previous: item.onHand, diff },
      });
    }
    refreshBoards();
    return { ok: true, onHand: target };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteInventoryItem(itemId: string): Promise<{ ok: true } | Fail> {
  try {
    const { organizationId, user } = await requireManager();
    const item = await db.inventoryItem.findFirst({ where: { id: itemId, organizationId }, select: { id: true, trade: true, name: true, onHand: true, unit: true } });
    if (!item) return { ok: false, error: "That item is not on this company" };
    await db.inventoryItem.delete({ where: { id: item.id } });
    refreshBoards();
    await logActivity({
      organizationId,
      actorId: user.id,
      kind: TRAIL_KINDS.STOCK,
      summary: `Removed ${item.name} from the ${LABEL[item.trade as TradeId] ?? item.trade} stock list${item.onHand ? ` (${item.onHand} ${item.unit} were on hand)` : ""}`,
      meta: { itemId, trade: item.trade, onHand: item.onHand, deleted: true },
    });
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function upsertSupplier(input: { id?: string | null; name: string; email?: string | null; phone?: string | null; website?: string | null; notes?: string | null }): Promise<{ ok: true; id: string } | Fail> {
  try {
    const { organizationId } = await requireManager();
    const name = input.name.trim().slice(0, 120);
    if (!name) return { ok: false, error: "Give the supplier a name" };
    const email = input.email?.trim().toLowerCase() || null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "That email does not look right" };
    const data = { name, email, phone: input.phone?.trim() || null, website: input.website?.trim() || null, notes: input.notes?.trim() || null };
    let id: string;
    if (input.id) {
      const existing = await db.supplier.findFirst({ where: { id: input.id, organizationId }, select: { id: true } });
      if (!existing) return { ok: false, error: "That supplier is not on this company" };
      id = (await db.supplier.update({ where: { id: existing.id }, data, select: { id: true } })).id;
    } else {
      id = (await db.supplier.create({ data: { organizationId, ...data }, select: { id: true } })).id;
    }
    refreshBoards();
    return { ok: true, id };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Email a purchase order to a supplier for the given items and quantities.
 * The company's own mail (Gmail when connected, else the platform sender).
 */
export async function sendPurchaseOrder(input: { trade: string; supplierId: string; lines: Array<{ itemId: string; quantity: number }>; note?: string; /** The job these per-job materials are for, when they are. */ jobId?: string | null }): Promise<{ ok: true; to: string; count: number } | Fail> {
  try {
    const { organizationId, user } = await requireManager();
    if (!isTradeId(input.trade)) return { ok: false, error: "Unknown trade" };
    const [org, supplier, job] = await Promise.all([
      db.organization.findUnique({ where: { id: organizationId }, select: { name: true, gmailSettingsJson: true, gmailTokensJson: true, billingEmail: true } }),
      db.supplier.findFirst({ where: { id: input.supplierId, organizationId } }),
      input.jobId ? db.job.findFirst({ where: { id: input.jobId, organizationId }, select: { id: true, title: true } }) : Promise.resolve(null),
    ]);
    if (!org) return { ok: false, error: "No organization" };
    if (!supplier) return { ok: false, error: "That supplier is not on this company" };
    if (input.jobId && !job) return { ok: false, error: "That job is not on this company" };
    if (!supplier.email) return { ok: false, error: `${supplier.name} has no email yet — add one on the Suppliers card` };
    const wanted = new Map(input.lines.filter((l) => l.quantity > 0).map((l) => [l.itemId, Math.ceil(l.quantity)]));
    if (!wanted.size) return { ok: false, error: "Nothing to order" };
    const items = await db.inventoryItem.findMany({ where: { id: { in: [...wanted.keys()] }, organizationId, trade: input.trade } });
    if (!items.length) return { ok: false, error: "Those items are not on this company" };
    const text = purchaseOrderText({
      company: org.name ?? "Our company",
      supplier: supplier.name,
      trade: input.trade,
      note: input.note ?? (job ? `For the job: ${job.title}.` : undefined),
      lines: items.map((it) => ({ name: it.name, sku: it.supplierSku, unit: it.unit, quantity: wanted.get(it.id) ?? 0 })),
    });
    await sendOrgEmail(org, { mailClass: "transactional", to: supplier.email, subject: text.subject, html: text.html });
    await db.activityEvent.create({
      data: {
        organizationId,
        actorId: user.id,
        kind: "PURCHASE_ORDER_SENT",
        summary: `Purchase order emailed to ${supplier.name} — ${items.length} ${input.trade} item(s)${job ? ` for ${job.title}` : ""}`,
        meta: JSON.stringify({ supplierId: supplier.id, trade: input.trade, jobId: job?.id ?? null, href: boardHref(input.trade), lines: items.map((it) => ({ id: it.id, name: it.name, quantity: wanted.get(it.id) ?? 0 })) }),
      },
    });
    refreshBoards();
    return { ok: true, to: supplier.email, count: items.length };
  } catch (err) {
    return fail(err);
  }
}

/**
 * The crew loaded the truck: every tracked line on the job's pick list leaves
 * the warehouse, the job is stamped, and the sold proposal's reservation is
 * released by that stamp. The office may do it too. Done once per job.
 */
export async function loadJobMaterials(jobId: string): Promise<{ ok: true; taken: number; untracked: number } | Fail> {
  try {
    const ctx = await requireRouteAccess("/dashboard/jobs");
    const { organizationId } = ctx;
    const job = await db.job.findFirst({
      where: { id: jobId, organizationId },
      select: {
        id: true,
        title: true,
        clientId: true,
        materialsLoadedAt: true,
        proposal: { select: { id: true, trade: true, lineItems: { where: { materialCost: { gt: 0 } }, select: { name: true, quantity: true, measurementType: true } } } },
        assignments: { select: { worker: { select: { userId: true } } } },
      },
    });
    if (!job) return { ok: false, error: "Job not found" };
    if (isWorkerRole(ctx.role) && !job.assignments.some((a) => a.worker.userId === ctx.user.id)) return { ok: false, error: "You are not on this job" };
    if (job.materialsLoadedAt) return { ok: false, error: "Already loaded" };
    if (!job.proposal || !isTradeId(job.proposal.trade)) {
      await db.job.update({ where: { id: job.id }, data: { materialsLoadedAt: new Date() } });
      await logActivity({
        organizationId,
        actorId: ctx.user.id,
        kind: TRAIL_KINDS.MATERIALS,
        summary: `Marked materials loaded for ${job.title}`,
        proposalId: job.proposal?.id ?? null,
        clientId: job.clientId,
        meta: { jobId: job.id, taken: 0, untracked: job.proposal?.lineItems.length ?? 0 },
      });
      return { ok: true, taken: 0, untracked: job.proposal?.lineItems.length ?? 0 };
    }
    const stock = await stockItemsOf(organizationId, job.proposal.trade);
    // A fence's own material list, kept at convert (lib/fence/savedTakeoff), while the proposal still fits it.
    const saved = job.proposal.trade === "fence" ? (await savedTakeoffsFor(organizationId, [job.proposal.id])).get(job.proposal.id) : null;
    const rows = pickList(stock, explodeLines(job.proposal.trade, job.proposal.lineItems.map((l) => ({ name: l.name, quantity: l.quantity, unit: l.measurementType })), saved));
    const tracked = rows.filter((r) => r.itemId);
    // Every item leaves the warehouse only as far as it was there (lib/inventory
    // issueFromShelf): the count never goes below zero, the rest is bought.
    const { taken, short } = issueFromShelf(rows);
    // The price the stock leaves at (stage D): the item's last cost today,
    // stamped on the movement so the job's cost does not move when the price
    // does later (lib/jobCost).
    const priceOf = new Map((await db.inventoryItem.findMany({ where: { id: { in: taken.map((r) => r.itemId) }, organizationId }, select: { id: true, lastCost: true } })).map((i) => [i.id, i.lastCost]));
    await db.$transaction([
      ...taken.flatMap((r) => [
        db.inventoryMovement.create({ data: { itemId: r.itemId!, kind: "PICKED", quantity: -r.take, jobId: job.id, proposalId: job.proposal!.id, actorId: ctx.user.id, unitCost: priceOf.get(r.itemId!) ?? null } }),
        db.inventoryItem.update({ where: { id: r.itemId! }, data: { onHand: { decrement: r.take } } }),
      ]),
      db.job.update({ where: { id: job.id }, data: { materialsLoadedAt: new Date() } }),
    ]);
    revalidatePath(`/dashboard/jobs/${job.id}`);
    refreshBoards();
    await logActivity({
      organizationId,
      actorId: ctx.user.id,
      kind: TRAIL_KINDS.MATERIALS,
      summary: `Loaded ${tracked.length} of ${rows.length} materials for ${job.title}${short ? ` — ${plural(short, "line")} short on the shelf, the rest to buy` : ""}`,
      proposalId: job.proposal.id,
      clientId: job.clientId,
      meta: { jobId: job.id, taken: tracked.length, untracked: rows.length - tracked.length, short, trade: job.proposal.trade, lines: taken.map((r) => ({ itemId: r.itemId, quantity: r.take })) },
    });
    return { ok: true, taken: tracked.length, untracked: rows.length - tracked.length };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Leftovers back on the shelf after the job: each line is what came back,
 * never more than was taken. The crew on the job or the office.
 */
export async function returnJobMaterials(jobId: string, lines: Array<{ itemId: string; quantity: number }>): Promise<{ ok: true; returned: number } | Fail> {
  try {
    const ctx = await requireRouteAccess("/dashboard/jobs");
    const job = await db.job.findFirst({ where: { id: jobId, organizationId: ctx.organizationId }, select: { id: true, title: true, proposalId: true, clientId: true, materialsLoadedAt: true, assignments: { select: { worker: { select: { userId: true } } } } } });
    if (!job) return { ok: false, error: "Job not found" };
    if (isWorkerRole(ctx.role) && !job.assignments.some((a) => a.worker.userId === ctx.user.id)) return { ok: false, error: "You are not on this job" };
    if (!job.materialsLoadedAt) return { ok: false, error: "Nothing was loaded for this job yet" };
    const moves = await db.inventoryMovement.findMany({ where: { jobId: job.id, kind: { in: ["PICKED", "USED", "RETURNED"] } }, orderBy: { createdAt: "asc" }, select: { itemId: true, kind: true, quantity: true, unitCost: true } });
    const taken = new Map<string, number>();
    // What left for the job left at a price; leftovers come back at the same
    // one, so a return takes off the job exactly what the issue put on.
    const issuedAt = new Map<string, number | null>();
    // PICKED rows are stored negative and RETURNED rows positive, so negating
    // both gives what is still out on the job.
    for (const m of moves) {
      taken.set(m.itemId, (taken.get(m.itemId) ?? 0) - m.quantity);
      if (m.kind !== "RETURNED" && m.unitCost != null) issuedAt.set(m.itemId, m.unitCost);
    }
    const writes = [];
    let returned = 0;
    for (const l of lines) {
      const room = taken.get(l.itemId) ?? 0;
      const qty = Math.min(Math.max(0, money(l.quantity)), Math.max(0, room));
      if (!qty) continue;
      writes.push(
        db.inventoryMovement.create({ data: { itemId: l.itemId, kind: "RETURNED", quantity: qty, jobId: job.id, actorId: ctx.user.id, note: "Leftovers back", unitCost: issuedAt.get(l.itemId) ?? null } }),
        db.inventoryItem.update({ where: { id: l.itemId }, data: { onHand: { increment: qty } } }),
      );
      returned++;
    }
    if (writes.length) await db.$transaction(writes);
    revalidatePath(`/dashboard/jobs/${job.id}`);
    refreshBoards();
    if (returned) {
      await logActivity({
        organizationId: ctx.organizationId,
        actorId: ctx.user.id,
        kind: TRAIL_KINDS.MATERIALS,
        summary: `Returned leftovers from ${job.title} — ${plural(returned, "material")} back on the shelf`,
        proposalId: job.proposalId,
        clientId: job.clientId,
        meta: { jobId: job.id, returned },
      });
    }
    return { ok: true, returned };
  } catch (err) {
    return fail(err);
  }
}

/** The order arrived: every line of a sent purchase order is received, and the order is marked. */
export async function receivePurchaseOrder(eventId: string): Promise<{ ok: true; received: number } | Fail> {
  try {
    const { organizationId, user } = await requireManager();
    const ev = await db.activityEvent.findFirst({ where: { id: eventId, organizationId, kind: "PURCHASE_ORDER_SENT" } });
    if (!ev) return { ok: false, error: "That order is not on this company" };
    const meta = JSON.parse(ev.meta ?? "{}") as { trade?: string; supplierId?: string; jobId?: string | null; lines?: Array<{ id: string; quantity: number }>; receivedAt?: string };
    if (meta.receivedAt) return { ok: false, error: "Already received" };
    const lines = (meta.lines ?? []).filter((l) => l.quantity > 0);
    const items = await db.inventoryItem.findMany({ where: { id: { in: lines.map((l) => l.id) }, organizationId }, select: { id: true } });
    const known = new Set(items.map((i) => i.id));
    const writes = lines
      .filter((l) => known.has(l.id))
      .flatMap((l) => [
        db.inventoryMovement.create({ data: { itemId: l.id, kind: "RECEIVED", quantity: l.quantity, note: "Purchase order received", actorId: user.id } }),
        db.inventoryItem.update({ where: { id: l.id }, data: { onHand: { increment: l.quantity } } }),
      ]);
    await db.$transaction([...writes, db.activityEvent.update({ where: { id: ev.id }, data: { meta: JSON.stringify({ ...meta, receivedAt: new Date().toISOString() }) } })]);
    if (meta.trade) refreshBoards();
    const received = writes.length / 2;
    const supplier = meta.supplierId ? await db.supplier.findFirst({ where: { id: meta.supplierId, organizationId }, select: { name: true } }) : null;
    await logActivity({
      organizationId,
      actorId: user.id,
      kind: TRAIL_KINDS.STOCK,
      summary: `Received the purchase order${supplier ? ` from ${supplier.name}` : ""} — ${plural(received, "item")} on the shelf`,
      meta: { purchaseOrderEventId: ev.id, trade: meta.trade, jobId: meta.jobId ?? undefined, received, lines: lines.filter((l) => known.has(l.id)) },
    });
    return { ok: true, received };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Put the trade's standard items on the shelf list: every material its
 * estimator prices, read off the estimator itself (lib/inventoryPresets).
 * Items already there are left alone; the rest start at zero on hand.
 */
export async function seedTradeItems(trade: string): Promise<{ ok: true; added: number; total: number } | Fail> {
  try {
    const { organizationId, user } = await requireManager();
    if (!isTradeId(trade)) return { ok: false, error: "Unknown trade" };
    const presets = presetItems(trade);
    const have = new Set((await db.inventoryItem.findMany({ where: { organizationId, trade }, select: { key: true } })).map((i) => i.key));
    const missing = presets.filter((p) => !have.has(stockKey(p.name)));
    if (missing.length) {
      await db.inventoryItem.createMany({ data: missing.map((p) => ({ organizationId, trade, name: p.name, key: stockKey(p.name), unit: p.unit })) });
      // The new items take the suggested choice; the checklist is there to change it.
      const policy = await stockPolicyOf(organizationId, trade);
      const perJob = new Set(policy.perJob);
      let suggestedPerJob = 0;
      for (const p of missing) {
        if (defaultStocked(trade, p.name)) continue;
        perJob.add(stockKey(p.name));
        suggestedPerJob++;
      }
      if (suggestedPerJob) await recordStockPolicy(organizationId, trade, perJob, user.id, `${LABEL[trade]} standard items added — ${plural(missing.length - suggestedPerJob, "item")} kept in stock, ${suggestedPerJob} bought per job (suggested; change any on the board)`);
    }
    refreshBoards();
    return { ok: true, added: missing.length, total: presets.length };
  } catch (err) {
    return fail(err);
  }
}

/**
 * The "What we stock" checklist, saved (2026-09-23). Each key named is a
 * standard item or one already on the list: a standard item not on the list
 * yet is added (at zero on hand), and the trade's choice is rewritten so the
 * keys in `stocked` are kept in stock and the keys in `perJob` are bought
 * per job. Keys not named keep their choice; a key nothing knows is ignored.
 */
export async function saveStockList(input: { trade: string; stocked: string[]; perJob: string[] }): Promise<{ ok: true; added: number; stocked: number; perJob: number } | Fail> {
  try {
    const { organizationId, user } = await requireManager();
    if (!isTradeId(input.trade)) return { ok: false, error: "Unknown trade" };
    const trade = input.trade;
    const clean = (list: unknown) => new Set((Array.isArray(list) ? list : []).filter((k): k is string => typeof k === "string").map((k) => k.trim()).filter(Boolean));
    const stockedKeys = clean(input.stocked);
    const perJobKeys = clean(input.perJob);
    for (const k of stockedKeys) perJobKeys.delete(k); // named twice: kept in stock wins
    const presets = new Map(presetItems(trade).map((p) => [stockKey(p.name), p]));
    const have = new Set((await db.inventoryItem.findMany({ where: { organizationId, trade }, select: { key: true } })).map((i) => i.key));
    const toCreate = [...stockedKeys, ...perJobKeys].filter((k) => !have.has(k) && presets.has(k)).map((k) => ({ organizationId, trade, name: presets.get(k)!.name, key: k, unit: presets.get(k)!.unit }));
    if (toCreate.length) await db.inventoryItem.createMany({ data: toCreate });
    for (const c of toCreate) have.add(c.key);
    const policy = await stockPolicyOf(organizationId, trade);
    const perJob = new Set(policy.perJob);
    for (const k of stockedKeys) perJob.delete(k);
    for (const k of perJobKeys) if (have.has(k)) perJob.add(k);
    const perJobCount = [...perJob].filter((k) => have.has(k)).length;
    await recordStockPolicy(organizationId, trade, perJob, user.id, `${LABEL[trade]} stock list saved — ${plural(have.size - perJobCount, "item")} kept in stock, ${perJobCount} bought per job`);
    refreshBoards();
    revalidatePath("/dashboard/jobs");
    return { ok: true, added: toCreate.length, stocked: have.size - perJobCount, perJob: perJobCount };
  } catch (err) {
    return fail(err);
  }
}
