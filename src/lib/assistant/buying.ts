import "server-only";
// BUYING FOR THE AI OPERATOR (the buying build, 2026-11-05) — "Order materials for Smith's framing", "Where's the
// railing kit?". One read and one write, thin calls into lib/projectBuying: the Operator never invents a line, a
// price or a date, and an order is read back for a yes like every other change (lib/assistant/tools).

import { z } from "zod";
import { db } from "@/lib/db";
import type { ReadTool, WriteTool } from "@/lib/assistant/tools";
import { buyingOf, placeOrder } from "@/lib/projectBuying/server";
import { DEFAULT_LEAD_DAYS, STATE_LABEL, STATUS_LABEL, dueWords, materialState, orderByDate, qtyWords, toBuyQty, type OrderHow } from "@/lib/projectBuying/shared";

const ID = z.string().min(1).max(64);

async function projectNamed(organizationId: string, projectId: string) {
  return db.project.findFirst({ where: { id: projectId, organizationId }, select: { id: true, name: true, number: true } });
}

const whereIs: ReadTool<{ projectId: string; query: string | null }> = {
  kind: "read",
  name: "where_is",
  need: "projects.read",
  card: {
    "label": "Where's the order",
    "purpose": "What a project has to buy and where each order stands — to buy, ordered, in; the carrier and tracking.",
    "when": "'Where's the railing kit', 'what still has to be bought for the Smith deck', 'is the lumber in': where_is with the project id (find, kind project), words for one line or null for the whole list.",
    "objects": [
      "project"
    ],
    "effect": "read",
    "group": "projects",
    "version": 1,
    "since": "2026-11-06",
    "samples": [
      {
        "say": "where's the railing kit for the Smith deck?",
        "args": {
          "projectId": "proj_1",
          "query": "railing kit"
        }
      },
      {
        "say": "what still has to be bought for the Smith deck?",
        "args": {
          "projectId": "proj_1",
          "query": null
        }
      }
    ]
  },
  description:
    "What a project has to buy and where each order stands. With words ('railing kit', 'joists') it answers for those lines: to buy / ordered / in, and each order's status, who it came from, when it is expected, the carrier and tracking. Without words: the to-buy list by stage, what is on the way, what came in short. Use for: where's the railing kit, did the lumber come, what still needs ordering for the kitchen.",
  params: z.object({ projectId: ID, query: z.string().max(80).nullable() }),
  async run({ actor }, args) {
    const p = await projectNamed(actor.organizationId, args.projectId);
    if (!p) return { error: "I couldn't find that project." };
    const b = await buyingOf(actor.organizationId, p.id);
    const today = new Date();
    const orderWords = (id: string) =>
      b.orders
        .filter((o) => o.status !== "CANCELED" && o.lines.some((l) => l.materialId === id))
        .map((o) => ({
          order: o.number,
          from: o.how === "SUPPLIER" ? (o.supplier?.name ?? "supplier") : o.how === "BUYER" ? (o.buyerName ?? "a buyer") : "our stock",
          status: STATUS_LABEL[o.status as keyof typeof STATUS_LABEL] ?? o.status,
          expected: o.expectedAt ? dueWords(o.expectedAt, today) : null,
          carrier: o.carrier,
          tracking: o.trackingNumber,
          trackingUrl: o.trackingUrl,
          line: (() => {
            const l = o.lines.find((x) => x.materialId === id)!;
            return l.status === "MISSING" ? `${qtyWords(l.quantity - l.receivedQty, l.unit)} missing` : l.status.toLowerCase();
          })(),
        }));
    if (args.query) {
      const words = args.query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
      const hits = b.materials.filter((m) => words.some((w) => m.name.toLowerCase().includes(w)));
      if (!hits.length) return { project: p.name, found: [], note: "No line on the list matches those words.", toBuy: b.materials.filter((m) => toBuyQty(m) > 0).slice(0, 8).map((m) => m.name) };
      return { project: p.name, found: hits.slice(0, 8).map((m) => ({ name: m.name, qty: qtyWords(m.quantity, m.unit), state: STATE_LABEL[materialState(m)], stillToBuy: toBuyQty(m) > 0 ? qtyWords(toBuyQty(m), m.unit) : null, stage: m.stageName, orders: orderWords(m.id) })) };
    }
    const byStage = new Map<string, string[]>();
    for (const m of b.materials) {
      if (toBuyQty(m) <= 0) continue;
      const k = m.stageName ?? "no stage";
      byStage.set(k, [...(byStage.get(k) ?? []), `${m.name} (${qtyWords(toBuyQty(m), m.unit)})`]);
    }
    return {
      project: p.name,
      number: p.number,
      toBuy: [...byStage.entries()].map(([stage, lines]) => ({ stage, lines: lines.slice(0, 12), count: lines.length })),
      onTheWay: b.orders.filter((o) => o.status === "ORDERED" || o.status === "SHIPPED").map((o) => ({ order: o.number, from: o.how === "SUPPLIER" ? (o.supplier?.name ?? "supplier") : o.how === "BUYER" ? (o.buyerName ?? "a buyer") : "stock", status: STATUS_LABEL[o.status as keyof typeof STATUS_LABEL], expected: o.expectedAt ? dueWords(o.expectedAt, today) : null, lines: o.lines.length, carrier: o.carrier, tracking: o.trackingNumber })),
      short: b.orders.filter((o) => o.status === "PARTIAL").map((o) => ({ order: o.number, missing: o.lines.filter((l) => l.status === "MISSING").map((l) => `${l.name} (${qtyWords(l.quantity - l.receivedQty, l.unit)} short)`) })),
      suppliers: b.suppliers.map((s) => s.name),
    };
  },
};

type OrderArgs = { projectId: string; stage: string | null; how: "supplier" | "me" | "stock"; supplierName: string | null };
type OrderPayload = { projectId: string; how: OrderHow; lines: Array<{ materialId: string; quantity: number }>; supplierId: string | null; buyer: { name: string; email: string | null } | null; stageId: string | null; words: string };

const orderMaterials: WriteTool<OrderArgs, OrderPayload> = {
  kind: "write",
  name: "order_materials",
  need: "projects.write",
  card: {
    "label": "Order materials",
    "purpose": "Order what a project still has to buy — from a supplier, through the person's own buy link, or from the company's stock.",
    "when": "'Order the framing for the Smith deck from ABC Supply', 'I'll buy the cabinets myself', 'take the deck boards from stock': order_materials with the project id, the stage or null for everything, how (supplier / me / stock) and the supplier's name when said.",
    "objects": [
      "project",
      "money"
    ],
    "effect": "message",
    "group": "projects",
    "version": 1,
    "since": "2026-11-06",
    "samples": [
      {
        "say": "order the framing for the Smith deck from ABC Supply",
        "args": {
          "projectId": "proj_1",
          "stage": "framing",
          "how": "supplier",
          "supplierName": "ABC Supply"
        }
      }
    ]
  },
  description:
    "Order what a project still has to buy — for one stage ('framing', 'the kitchen cabinets' stage) or the whole list — one way: 'supplier' (the purchase order is emailed to a supplier the company has; give supplierName when they say which), 'me' (the person themselves gets the buy link), or 'stock' (taken from the company's own stock). Give the project id (find, kind project). Use for: order the framing materials, order everything for the deck from ABC Lumber, I'll buy the tile myself.",
  params: z.object({ projectId: ID, stage: z.string().max(80).nullable(), how: z.enum(["supplier", "me", "stock"]), supplierName: z.string().max(80).nullable() }),
  payload: z.object({
    projectId: ID,
    how: z.enum(["SUPPLIER", "BUYER", "STOCK"]),
    lines: z.array(z.object({ materialId: ID, quantity: z.number().positive() })).min(1),
    supplierId: ID.nullable(),
    buyer: z.object({ name: z.string(), email: z.string().nullable() }).nullable(),
    stageId: ID.nullable(),
    words: z.string(),
  }),
  async plan({ actor }, args) {
    const p = await projectNamed(actor.organizationId, args.projectId);
    if (!p) return { ok: false, say: "I couldn't find that project." };
    const b = await buyingOf(actor.organizationId, p.id);
    if (!b.materials.length) return { ok: false, say: `${p.name} has nothing on its to-buy list yet — on the project page, press From the proposals on the Buying card first.` };
    let lines = b.materials.filter((m) => toBuyQty(m) > 0);
    let stageId: string | null = null;
    let stageName: string | null = null;
    if (args.stage) {
      const q = args.stage.toLowerCase();
      const stages = [...new Map(b.materials.filter((m) => m.stageId).map((m) => [m.stageId!, m.stageName!])).entries()];
      const hit = stages.find(([, name]) => name.toLowerCase().includes(q) || q.split(/\s+/).some((w) => w.length > 3 && name.toLowerCase().includes(w)));
      if (!hit) return { ok: false, say: `Which stage? The list has lines for: ${stages.map(([, n]) => n).join(", ")}.` };
      stageId = hit[0];
      stageName = hit[1];
      lines = lines.filter((m) => m.stageId === stageId);
    }
    if (!lines.length) return { ok: false, say: `Nothing left to buy${stageName ? ` for ${stageName}` : ""} on ${p.name} — it is all ordered or in.` };
    const project = `${p.name}${p.number ? ` (#${p.number})` : ""}`;
    const list = `${lines.slice(0, 5).map((m) => `${m.name} (${qtyWords(toBuyQty(m), m.unit)})`).join(", ")}${lines.length > 5 ? ` and ${lines.length - 5} more` : ""}`;
    const payloadLines = lines.map((m) => ({ materialId: m.id, quantity: toBuyQty(m) }));
    if (args.how === "supplier") {
      let supplier = null as (typeof b.suppliers)[number] | null;
      if (args.supplierName) {
        const q = args.supplierName.toLowerCase();
        const hits = b.suppliers.filter((s) => s.name.toLowerCase().includes(q));
        if (hits.length !== 1) return { ok: false, say: hits.length ? `Which supplier? ${hits.map((s) => s.name).join(", ")}.` : `No supplier called "${args.supplierName}". Yours: ${b.suppliers.map((s) => s.name).join(", ") || "none yet — add one on the project page's Buying card"}.` };
        supplier = hits[0];
      } else if (b.suppliers.length === 1) supplier = b.suppliers[0];
      else return { ok: false, say: b.suppliers.length ? `From which supplier? ${b.suppliers.map((s) => s.name).join(", ")}.` : "There is no supplier on file yet — add one on the project page's Buying card, or say you'll buy it yourself." };
      const start = lines.find((m) => m.stageStart)?.stageStart ?? null;
      const by = orderByDate(start, supplier.leadDays ?? DEFAULT_LEAD_DAYS);
      const words = `Order ${lines.length} line${lines.length === 1 ? "" : "s"}${stageName ? ` for ${stageName}` : ""} on ${project} from ${supplier.name}`;
      return {
        ok: true,
        payload: { projectId: p.id, how: "SUPPLIER", lines: payloadLines, supplierId: supplier.id, buyer: null, stageId, words },
        readback: `${words}${supplier.email ? ` — the purchase order goes to ${supplier.email}` : " — they have no email on file, so you'd send it yourself"}${by ? `; order by ${dueWords(by, new Date())}` : ""}? Lines: ${list}.`,
      };
    }
    if (args.how === "me") {
      const me = await db.user.findUnique({ where: { id: actor.userId }, select: { name: true, email: true } });
      const words = `Put ${lines.length} line${lines.length === 1 ? "" : "s"}${stageName ? ` for ${stageName}` : ""} on ${project} on a buy list for you`;
      return { ok: true, payload: { projectId: p.id, how: "BUYER", lines: payloadLines, supplierId: null, buyer: { name: me?.name?.trim() || actor.userName, email: me?.email ?? null }, stageId, words }, readback: `${words}${me?.email ? ` (the link goes to ${me.email})` : ""}? Lines: ${list}.` };
    }
    const words = `Take ${lines.length} line${lines.length === 1 ? "" : "s"}${stageName ? ` for ${stageName}` : ""} on ${project} from stock`;
    return { ok: true, payload: { projectId: p.id, how: "STOCK", lines: payloadLines, supplierId: null, buyer: null, stageId, words }, readback: `${words}? They are marked in at once. Lines: ${list}.` };
  },
  async execute({ actor }, payload) {
    const r = await placeOrder(actor.organizationId, actor.userId, { projectId: payload.projectId, how: payload.how, lines: payload.lines, supplierId: payload.supplierId, buyer: payload.buyer ? { name: payload.buyer.name, email: payload.buyer.email } : null, stageId: payload.stageId });
    const tail = payload.how === "SUPPLIER" ? (r.email === "sent" ? " The purchase order was emailed." : r.email === "failed" ? " The email didn't go — send the order yourself from the project page." : " The supplier has no email — send the order yourself.") : payload.how === "BUYER" ? (r.email === "sent" ? ` The link was emailed to you; it is also on the project page: ${r.link}` : ` Your buy list: ${r.link}`) : "";
    return { say: `Done — order ${r.number}: ${payload.words.replace(/^(Order|Put|Take) /, (m) => m.toLowerCase())}.${tail}`, result: r };
  },
};

export const BUYING_TOOLS = [whereIs, orderMaterials] as const;
