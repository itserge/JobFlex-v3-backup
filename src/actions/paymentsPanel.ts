"use server";
// THE PAYMENTS PANEL'S ACTIONS (2026-11-09, the ProSmart gaps plan, part 3). The office's (owner, admin, manager):
// a sales rep reads what is left on the card, the crew sees no money. Marking paid, undo, invoices and reminders are
// the existing actions (actions/installments, actions/notify) — the sheet calls them directly.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireManager } from "@/lib/orgContext";
import { db } from "@/lib/db";
import { addPanelStage, paymentsPanel, removePanelStage, setOrderNoticeAuto, setPanelStageDue, type PaymentsPanel } from "@/lib/paymentsPanel/server";
import { orderNoticeLetter, receiptLetter, sendOrderNotice, sendReceipt, type LetterReport } from "@/lib/payments/clientMail";

const ID = z.string().min(1).max(64);
const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function refresh() {
  for (const p of ["/dashboard/proposals", "/dashboard/jobs", "/dashboard/financials", "/dashboard/projects"]) revalidatePath(p);
}

export async function getPaymentsPanel(proposalId: string): Promise<PaymentsPanel> {
  const { organizationId } = await requireManager();
  const panel = await paymentsPanel(organizationId, ID.parse(proposalId));
  if (!panel) throw new Error("Not found");
  return panel;
}

/** A job's proposal, for the job page's Payments button. */
export async function proposalOfJob(jobId: string): Promise<string | null> {
  const { organizationId } = await requireManager();
  const j = await db.job.findFirst({ where: { id: ID.parse(jobId), organizationId }, select: { proposalId: true } });
  return j?.proposalId ?? null;
}

export async function previewPaymentLetter(raw: unknown): Promise<{ subject: string; html: string; to: string | null }> {
  const { organizationId } = await requireManager();
  const d = z.union([z.object({ kind: z.literal("receipt"), paymentId: ID }), z.object({ kind: z.literal("order"), proposalId: ID, note: z.string().max(600).nullable() })]).parse(raw);
  const letter = d.kind === "receipt" ? await receiptLetter(d.paymentId, organizationId) : await orderNoticeLetter(d.proposalId, d.note, organizationId);
  if (!letter) throw new Error("Not found");
  return { subject: letter.subject, html: letter.html, to: letter.to };
}

export async function sendPaymentReceipt(paymentId: string): Promise<LetterReport> {
  const { organizationId, user } = await requireManager();
  const r = await sendReceipt(ID.parse(paymentId), { actorId: user.id, source: "manual", organizationId });
  refresh();
  return r;
}

export async function sendOrderPlacedNotice(raw: unknown): Promise<LetterReport> {
  const { organizationId, user } = await requireManager();
  const d = z.object({ proposalId: ID, note: z.string().max(600).nullable() }).parse(raw);
  const r = await sendOrderNotice(d.proposalId, { note: d.note, actorId: user.id, source: "manual", organizationId });
  refresh();
  return r;
}

export async function addPayment(raw: unknown): Promise<{ id: string }> {
  const { organizationId, user } = await requireManager();
  const d = z.object({ proposalId: ID, label: z.string().max(80), amount: z.number(), isPercent: z.boolean(), due: DAY.nullable() }).parse(raw);
  const r = await addPanelStage(organizationId, user.id, d);
  refresh();
  return r;
}

export async function removePayment(installmentId: string): Promise<void> {
  const { organizationId, user } = await requireManager();
  await removePanelStage(organizationId, user.id, ID.parse(installmentId));
  refresh();
}

export async function setPaymentDue(installmentId: string, due: string | null): Promise<void> {
  const { organizationId, user } = await requireManager();
  await setPanelStageDue(organizationId, user.id, ID.parse(installmentId), due === null ? null : DAY.parse(due));
  refresh();
}

export async function setOrderNoticeOnFirstPayment(on: boolean): Promise<void> {
  const { organizationId, user } = await requireManager();
  await setOrderNoticeAuto(organizationId, user.id, z.boolean().parse(on));
  revalidatePath("/dashboard/settings");
}
