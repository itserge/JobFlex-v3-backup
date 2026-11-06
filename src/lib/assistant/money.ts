import "server-only";
// MONEY BY VOICE OR TEXT (2026-11-05, the AI Operator's batch 2): an invoice
// for a payment stage, and the monthly-payments (Wisetack) link — through the
// Proposals page's own sends (lib/payments/invoices sendInvoice,
// lib/financing/service sendFinancingLinkFor). Read back and waiting for the
// yes AND the person's PIN (lib/assistant/pin; the tools named in shared
// PIN_TOOLS), as the owner asked for anything that moves money.
import { z } from "zod";
import { db } from "@/lib/db";
import type { WriteTool } from "@/lib/assistant/tools";
import { andList, money } from "@/lib/assistant/shared";
import { hasPin } from "@/lib/assistant/pin";
import { invoiceOptionsFor, sendInvoice } from "@/lib/payments/invoices";
import { orgFinancingView, sendFinancingLinkFor } from "@/lib/financing/service";
import { fromMinor, resolveSchedule } from "@/lib/paymentSchedule";
import { contractSchedule } from "@/lib/contractTotal";

const ID = z.string().min(1).max(64);
const NO_PIN = "That needs your 4-digit PIN as well as a yes. Set it in Settings → AI Operator → PIN for money, then ask me again.";
const SIGNED = ["ACCEPTED", "COMPLETED", "PAID"];

type InvoiceArgs = { proposalId: string; installmentId: string | null; method: "card" | "bank" | "any" };
type InvoicePayload = InvoiceArgs & { client: string; amount: number; label: string; title: string };

const invoiceTool: WriteTool<InvoiceArgs, InvoicePayload> = {
  kind: "write",
  name: "send_invoice",
  need: "invoices.send",
  card: {
    "label": "Invoice",
    "purpose": "Invoice the client for a payment stage of a signed proposal.",
    "when": "'Invoice Lee', 'bill the deposit': find the proposal first; ask which stage only when there are several. Asks the person for their PIN with the yes.",
    "objects": [
      "invoice",
      "proposal",
      "client"
    ],
    "effect": "money",
    "group": "money",
    "version": 1,
    "since": "2026-11-05",
    "samples": [
      {
        "say": "invoice Lee for the deposit",
        "args": {
          "proposalId": "p_1",
          "installmentId": null,
          "method": "any"
        }
      }
    ]
  },
  description:
    "Invoice the client for a payment stage of a signed proposal (email, and a text when the company texts clients). Find the proposal first. installmentId = a stage; null = the next one due. method: 'card' = the hosted card checkout, 'bank' = the company's transfer instructions, 'any' = the client picks — use 'any' unless they said. Asks the person for their PIN with the yes.",
  params: z.object({ proposalId: ID, installmentId: ID.nullable(), method: z.enum(["card", "bank", "any"]) }),
  payload: z.object({ proposalId: ID, installmentId: ID.nullable(), method: z.enum(["card", "bank", "any"]), client: z.string(), amount: z.number(), label: z.string(), title: z.string() }),
  async plan({ actor }, a) {
    const org = actor.organizationId;
    if (!(await hasPin(org, actor.userId))) return { ok: false, say: NO_PIN };
    const p = await db.proposal.findFirst({
      where: { id: a.proposalId, organizationId: org },
      select: {
        id: true,
        title: true,
        status: true,
        total: true,
        currency: true,
        client: { select: { name: true, email: true, phone: true } },
        installments: { orderBy: { position: "asc" } },
        changeOrders: { where: { status: "APPROVED" }, select: { status: true, total: true } },
      },
    });
    if (!p) return { ok: false, say: "I couldn't find that proposal." };
    if (!SIGNED.includes(p.status)) return { ok: false, say: `"${p.title}" isn't signed yet — an invoice comes after the signature. Send the proposal first.` };
    if (!p.client) return { ok: false, say: `"${p.title}" has no client on it yet.` };
    if (!p.client.email && !p.client.phone) return { ok: false, say: `${p.client.name} has no email or phone on file.` };
    const opts = await invoiceOptionsFor(org, p.currency);
    if (a.method === "card" && !opts.card) return { ok: false, say: "No card processor is connected (Settings → Integrations / Payments)." };
    if (a.method === "bank" && !opts.bank) return { ok: false, say: "Bank-transfer instructions aren't set (Settings → Integrations / Payments)." };
    if (a.method === "any" && !opts.card && !opts.bank) return { ok: false, say: "Payments aren't set up yet (Settings → Integrations / Payments)." };
    const s = resolveSchedule({ ...contractSchedule(p.total, p.changeOrders), currency: p.currency, installments: p.installments });
    if (s.remainingMinor <= 0) return { ok: false, say: `Nothing is owed on "${p.title}".` };
    const row = a.installmentId ? (p.installments.find((i) => i.id === a.installmentId) ?? null) : null;
    if (a.installmentId && !row) return { ok: false, say: "That payment stage isn't on this proposal." };
    const stage = row ? (s.stages.find((x) => x.id === row.id) ?? null) : null;
    const amount = stage ? fromMinor(stage.amountMinor) : fromMinor(s.remainingMinor);
    const label = row?.label ?? (s.unpaidCount > 1 ? "the remaining balance" : "the payment");
    const pay = a.method === "card" ? `by card (${opts.cardVia.join(" / ")})` : a.method === "bank" ? "by bank transfer" : "by card or bank, their choice";
    return {
      ok: true,
      payload: { proposalId: p.id, installmentId: row?.id ?? null, method: a.method, client: p.client.name, amount, label, title: p.title },
      readback: `Invoice ${p.client.name} ${money(amount, p.currency)} for ${label} on "${p.title}" — ${pay}, by email${p.client.phone ? " and text" : ""}.`,
    };
  },
  async execute({ actor }, p) {
    const r = await sendInvoice({ proposalId: p.proposalId, installmentId: p.installmentId, method: p.method, organizationId: actor.organizationId, actorId: actor.userId });
    if (!r.ok) throw new Error(r.error || "The invoice didn't go out.");
    const via = [r.email === "sent" ? "email" : null, r.sms === "sent" ? "text" : null].filter((v): v is string => Boolean(v));
    return {
      say: via.length
        ? `Invoice${r.number ? ` ${r.number}` : ""} for ${money(r.amount)} (${r.label}) sent to ${p.client} by ${andList(via)}.`
        : "The invoice was written up, but neither the email nor the text went out. Check the client's contact details.",
      result: { number: r.number ?? null, amount: r.amount, email: r.email, sms: r.sms },
    };
  },
};

type FinArgs = { proposalId: string; via: "auto" | "text" | "email" };

const financingLink: WriteTool<FinArgs, FinArgs & { client: string; title: string }> = {
  kind: "write",
  name: "financing_link",
  need: "financing.send",
  card: {
    "label": "Financing link",
    "purpose": "Send the client the monthly-payments (Wisetack) link for a sent proposal.",
    "when": "'Send Smith the financing link', 'monthly payments for the roof': find the proposal first; it must have been sent. Asks the person for their PIN with the yes.",
    "objects": [
      "proposal",
      "client",
      "payment"
    ],
    "effect": "money",
    "group": "money",
    "version": 1,
    "since": "2026-11-05",
    "samples": [
      {
        "say": "send Smith the financing link",
        "args": {
          "proposalId": "p_1",
          "via": "auto"
        }
      }
    ]
  },
  description:
    "Send the client the monthly-payments (Wisetack financing) link for a proposal — by text, by email, or 'auto' (text when they have a mobile, else email). Find the proposal first; it must have been sent. Asks the person for their PIN with the yes.",
  params: z.object({ proposalId: ID, via: z.enum(["auto", "text", "email"]) }),
  payload: z.object({ proposalId: ID, via: z.enum(["auto", "text", "email"]), client: z.string(), title: z.string() }),
  async plan({ actor }, a) {
    const org = actor.organizationId;
    if (!(await hasPin(org, actor.userId))) return { ok: false, say: NO_PIN };
    const view = await orgFinancingView(org);
    if (!view.available || !view.letIn) return { ok: false, say: "Monthly payments (Wisetack) aren't on for your company yet — Settings → Financing." };
    const p = await db.proposal.findFirst({ where: { id: a.proposalId, organizationId: org }, select: { id: true, title: true, status: true, client: { select: { name: true } } } });
    if (!p) return { ok: false, say: "I couldn't find that proposal." };
    if (!p.client) return { ok: false, say: `"${p.title}" has no client on it yet.` };
    if (p.status === "DRAFT") return { ok: false, say: `"${p.title}" hasn't been sent yet — the financing link opens the proposal. Send it first.` };
    const how = a.via === "auto" ? "text, or email if they have no mobile" : a.via;
    return { ok: true, payload: { proposalId: p.id, via: a.via, client: p.client.name, title: p.title }, readback: `Send ${p.client.name} the monthly-payments (Wisetack) link for "${p.title}" by ${how}.` };
  },
  async execute({ actor }, p) {
    const r = await sendFinancingLinkFor(actor.organizationId, p.proposalId, p.via, actor.userId);
    if (!r.ok) throw new Error(r.error);
    return { say: `Sent ${p.client} the financing link for "${p.title}" by ${r.via}.`, result: { via: r.via } };
  },
};

export const MONEY_TOOLS = [invoiceTool, financingLink];
