"use server";
// RAMP CARDS — the shop's door (2026-10-29): disconnect, sync now, the switches, the office placing a swipe on a job.
// Round 2: splitting a swipe across jobs, paying a vendor's bill through Ramp, giving a crew member a card.
import { requireManager } from "@/lib/orgContext";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { clearRampConnection, patchRampConnection, rampConnectionView, readRampConnection, type RampView } from "@/lib/ramp/connection";
import { assignRampTransaction, ensureRampField, rampCardSpend, splitRampTransaction, syncRamp, type RampTxRecord } from "@/lib/ramp/sync";
import { createRampBill, rampBillPaySetup, rampBills, refreshOpenRampBills, type RampBillInput, type RampBillPaySetup, type RampBillRecord } from "@/lib/ramp/bills";
import { orderRampCard, rampCards, rampTeam, setRampCardSuspended, type RampCardOrder, type RampCardsView, type RampTeamMember } from "@/lib/ramp/cards";
import type { PostalAddress, SplitPart } from "@/lib/ramp/shared";

const who = (user: { id: string; name?: string | null; email?: string | null }) => ({ userId: user.id, name: user.name?.trim() || user.email || "" });

export async function disconnectRamp(): Promise<{ ok: true }> {
  const { organizationId, user } = await requireManager();
  const conn = await readRampConnection(organizationId);
  await clearRampConnection(organizationId);
  await logActivity({ organizationId, actorId: user.id, kind: TRAIL_KINDS.SETTINGS, summary: `Disconnected Ramp${conn?.businessName ? ` (${conn.businessName})` : ""}`, meta: { area: "ramp" } });
  return { ok: true };
}

export async function syncRampNow(): Promise<{ ok: true; booked: number; needsJob: number; updated: number; read: number; billsPaid: number; view: RampView } | { ok: false; error: string }> {
  const { organizationId } = await requireManager();
  const r = await syncRamp(organizationId);
  if (!r.ok) return r;
  return { ...r, view: await rampConnectionView(organizationId) };
}

export async function setRampSwitches(input: { askByText?: boolean; requireJob?: boolean; billsApproved?: boolean }): Promise<{ ok: true; view: RampView } | { ok: false; error: string }> {
  const { organizationId, user } = await requireManager();
  const patch = {
    ...(typeof input.askByText === "boolean" ? { askByText: input.askByText } : {}),
    ...(typeof input.requireJob === "boolean" ? { requireJob: input.requireJob } : {}),
    ...(typeof input.billsApproved === "boolean" ? { billsApproved: input.billsApproved } : {}),
  };
  const conn = await patchRampConnection(organizationId, patch);
  if (!conn) return { ok: false, error: "Ramp is not connected." };
  if (typeof input.requireJob === "boolean") await ensureRampField(organizationId).catch(() => null);
  const words = [
    typeof input.askByText === "boolean" ? `ask the job by text ${input.askByText ? "on" : "off"}` : "",
    typeof input.requireJob === "boolean" ? `the job required on every swipe ${input.requireJob ? "on" : "off"}` : "",
    typeof input.billsApproved === "boolean" ? (input.billsApproved ? "bills from JobFlex go in approved — Ramp pays them" : "bills from JobFlex go to Ramp's inbox for approval") : "",
  ].filter(Boolean);
  await logActivity({ organizationId, actorId: user.id, kind: TRAIL_KINDS.SETTINGS, summary: `Ramp: ${words.join(", ")}`, meta: { area: "ramp" } });
  return { ok: true, view: await rampConnectionView(organizationId) };
}

export async function placeRampTransaction(input: { txId: string; jobId: string | null; stock?: boolean; none?: boolean }): Promise<{ ok: true; where: string } | { ok: false; error: string }> {
  const { organizationId, user } = await requireManager();
  const txId = (input.txId ?? "").trim().slice(0, 80);
  if (!txId) return { ok: false, error: "No transaction." };
  const to = input.none ? ({ kind: "none" } as const) : input.stock ? ({ kind: "stock" } as const) : input.jobId ? ({ kind: "job", jobId: input.jobId.trim().slice(0, 60) } as const) : null;
  if (!to) return { ok: false, error: "Pick a job, stock, or leave it." };
  return assignRampTransaction(organizationId, txId, to, who(user));
}

/** The office splits one swipe across jobs (and the warehouse): the parts must add up to the swipe. */
export async function splitRampTransactionAction(input: { txId: string; parts: Array<{ jobId: string | null; stock?: boolean; amount: number }> }): Promise<{ ok: true; where: string; rampTook: boolean } | { ok: false; error: string }> {
  const { organizationId, user } = await requireManager();
  const txId = (input.txId ?? "").trim().slice(0, 80);
  if (!txId) return { ok: false, error: "No transaction." };
  const parts: SplitPart[] = [];
  for (const p of (input.parts ?? []).slice(0, 12)) {
    const amount = Math.round(Number(p.amount) * 100) / 100;
    if (p.stock) parts.push({ to: { kind: "stock" }, amount });
    else if (p.jobId) parts.push({ to: { kind: "job", jobId: String(p.jobId).trim().slice(0, 60) }, amount });
    else return { ok: false, error: "Every part needs a job (or stock)." };
  }
  return splitRampTransaction(organizationId, txId, parts, who(user));
}

export async function readRampCardSpend(): Promise<{ connected: boolean; needsJob: RampTxRecord[]; recent: RampTxRecord[]; bills: RampBillRecord[]; billsApproved: boolean }> {
  const { organizationId } = await requireManager();
  const conn = await readRampConnection(organizationId);
  if (!conn) return { connected: false, needsJob: [], recent: [], bills: [], billsApproved: false };
  const [spend, bills] = await Promise.all([rampCardSpend(organizationId), rampBills(organizationId)]);
  return { connected: true, ...spend, bills, billsApproved: conn.billsApproved };
}

/* ── bills ─────────────────────────────────────────────────────────────── */

export async function readRampBillPaySetup(): Promise<RampBillPaySetup> {
  const { organizationId } = await requireManager();
  return rampBillPaySetup(organizationId);
}

export async function createRampBillAction(input: { vendorId: string | null; vendorName: string | null; vendorEmail: string | null; invoiceNumber: string; amount: number; issuedAt: string; dueAt: string; memo: string; category: string; jobId: string | null; stock?: boolean; invoice: { dataUrl: string; filename: string } | null }): Promise<{ ok: true; bill: RampBillRecord; warning: string | null } | { ok: false; error: string }> {
  const { organizationId, user } = await requireManager();
  const to: RampBillInput["to"] = input.stock ? { kind: "stock" } : input.jobId ? { kind: "job", jobId: String(input.jobId).trim().slice(0, 60) } : { kind: "none" };
  const bill: RampBillInput = {
    vendorId: input.vendorId ? String(input.vendorId).trim().slice(0, 80) : null,
    vendorName: input.vendorName ? String(input.vendorName).trim().slice(0, 120) : null,
    vendorEmail: input.vendorEmail ? String(input.vendorEmail).trim().slice(0, 160) : null,
    invoiceNumber: String(input.invoiceNumber ?? "").trim().slice(0, 60),
    amount: Math.round(Number(input.amount) * 100) / 100,
    issuedAt: String(input.issuedAt ?? "").slice(0, 10),
    dueAt: String(input.dueAt ?? "").slice(0, 10),
    memo: String(input.memo ?? "").slice(0, 300),
    category: String(input.category ?? "Materials").slice(0, 40),
    to,
    invoice: input.invoice && typeof input.invoice.dataUrl === "string" && input.invoice.dataUrl.length < 14_000_000 ? { dataUrl: input.invoice.dataUrl, filename: String(input.invoice.filename ?? "invoice").slice(0, 120) } : null,
  };
  return createRampBill(organizationId, bill, who(user));
}

export async function refreshRampBillsAction(): Promise<{ ok: true; bills: RampBillRecord[]; paid: number }> {
  const { organizationId } = await requireManager();
  const paid = await refreshOpenRampBills(organizationId);
  return { ok: true, bills: await rampBills(organizationId), paid };
}

/* ── cards ─────────────────────────────────────────────────────────────── */

export async function readRampCards(): Promise<RampCardsView & { team: RampTeamMember[] }> {
  const { organizationId } = await requireManager();
  const [cards, team] = await Promise.all([rampCards(organizationId), rampTeam(organizationId)]);
  return { ...cards, team };
}

export async function orderRampCardAction(input: { userId: string | null; email: string; name: string; monthlyLimit: number; perPurchaseLimit: number | null; ship: PostalAddress }): Promise<{ ok: true; order: RampCardOrder } | { ok: false; error: string }> {
  const { organizationId, user } = await requireManager();
  const ship: PostalAddress = {
    address1: String(input.ship?.address1 ?? "").trim().slice(0, 120),
    address2: input.ship?.address2 ? String(input.ship.address2).trim().slice(0, 120) : null,
    city: String(input.ship?.city ?? "").trim().slice(0, 80),
    state: String(input.ship?.state ?? "").trim().toUpperCase().slice(0, 2),
    postal_code: String(input.ship?.postal_code ?? "").trim().slice(0, 10),
    country: "US",
  };
  return orderRampCard(organizationId, { userId: input.userId ? String(input.userId).slice(0, 60) : null, email: String(input.email ?? "").slice(0, 160), name: String(input.name ?? "").slice(0, 80), monthlyLimit: Number(input.monthlyLimit), perPurchaseLimit: input.perPurchaseLimit === null || input.perPurchaseLimit === undefined || Number(input.perPurchaseLimit) === 0 ? null : Number(input.perPurchaseLimit), ship }, who(user));
}

export async function setRampCardSuspendedAction(input: { cardId: string; suspended: boolean; holder: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const { organizationId, user } = await requireManager();
  const cardId = String(input.cardId ?? "").trim().slice(0, 80);
  if (!cardId) return { ok: false, error: "No card." };
  return setRampCardSuspended(organizationId, cardId, !!input.suspended, who(user), String(input.holder ?? "").slice(0, 80));
}
