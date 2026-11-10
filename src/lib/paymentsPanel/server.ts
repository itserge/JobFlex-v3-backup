import "server-only";
// THE PAYMENTS PANEL, ON THE SERVER (2026-11-09, the ProSmart gaps plan, part 3). One read for the sheet — the
// contract, what is paid and left, every payment with its state, who paid how, its receipt, its due date and how
// late it is, the reminders that went out and the next one, the order notice — and the schedule edits the panel adds
// (a new payment, removing one, its due date). Marking paid, undo, invoices and reminders stay where they were
// (actions/installments, actions/notify): the sheet calls them as the proposal card does.

import { db } from "@/lib/db";
import { contractSchedule } from "@/lib/contractTotal";
import { diffUnpaid, fromMinor, resolveSchedule } from "@/lib/paymentSchedule";
import { ensureSchedule } from "@/lib/payments/settle";
import { repriceOpenInvoices } from "@/lib/payments/invoiceRecord";
import { parsePaymentSettings } from "@/lib/settings";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { dayOf, dayWords, clockWords, wallInstant } from "@/lib/assistant/shared";
import { orderNoticeSentAt } from "@/lib/payments/clientMail";
import { cleanStageAmount, coverageWords, daysLate, lateWords, nextReminder, paidHow, stageRights } from "@/lib/paymentsPanel/shared";

const SOLD = ["ACCEPTED", "COMPLETED", "PAID"];
const money = (n: number) => `$${(Math.round(n * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

export type PanelStage = {
  id: string;
  label: string;
  synthetic: boolean;
  amount: number;
  pct: number | null;
  status: "UNPAID" | "PENDING" | "PAID" | "WAIVED";
  /** YYYY-MM-DD on the company's clock, or null. */
  due: string | null;
  dueWords: string | null;
  late: number;
  lateWords: string | null;
  /** The earliest open one — what Mark paid / Invoice / Remind act on first. */
  next: boolean;
  changeOrder: boolean;
  paid: { amount: number; on: string; how: string; paymentId: string; manual: boolean; receiptSent: string | null } | null;
  invoiced: string | null;
  reminders: number;
  rights: { remove: boolean; editDue: boolean; undo: boolean };
};

export type PanelLogRow = { at: string; when: string; what: string; who: string | null };

export type PaymentsPanel = {
  proposalId: string;
  title: string;
  client: { name: string | null; email: string | null; phone: boolean };
  sold: boolean;
  contract: number;
  paid: number;
  left: number;
  late: { count: number; amount: number };
  coverage: { tone: "ok" | "warn"; words: string };
  stages: PanelStage[];
  reminders: { words: string; mode: "auto" | "manual" | "off"; proposalOn: boolean | null };
  log: PanelLogRow[];
  orderNotice: { sent: string | null; auto: boolean };
  receiptsAuto: boolean;
  today: string;
  tz: string;
};

async function tzOf(organizationId: string): Promise<string> {
  return (await db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } }))?.timezone || "America/New_York";
}

/** Midnight today on the company's clock, as a local Date the pure rules compare against. */
function wallToday(tz: string, now = new Date()): Date {
  const [y, m, d] = dayOf(now, tz).split("-").map(Number);
  return new Date(y, m - 1, d);
}
function wallDay(at: Date, tz: string): Date {
  const [y, m, d] = dayOf(at, tz).split("-").map(Number);
  return new Date(y, m - 1, d);
}
const shortDay = (d: Date, tz: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric" }).format(d);

export async function paymentsPanel(organizationId: string, proposalId: string): Promise<PaymentsPanel | null> {
  const tz = await tzOf(organizationId);
  const p = await db.proposal.findFirst({
    where: { id: proposalId, organizationId },
    select: {
      id: true,
      title: true,
      status: true,
      total: true,
      currency: true,
      remindersOn: true,
      acceptedAt: true,
      sentAt: true,
      createdAt: true,
      client: { select: { name: true, email: true, phone: true } },
      installments: { orderBy: { position: "asc" }, include: { payment: { select: { id: true, amount: true, provider: true, method: true, paidAt: true, createdAt: true, status: true } } } },
      changeOrders: { where: { status: "APPROVED" }, select: { status: true, total: true } },
      organization: { select: { paymentSettingsJson: true } },
    },
  });
  if (!p) return null;
  const settings = parsePaymentSettings(p.organization.paymentSettingsJson);
  const schedule = resolveSchedule({ ...contractSchedule(p.total, p.changeOrders), currency: p.currency, installments: p.installments });
  const today = wallToday(tz);
  const rows = new Map(p.installments.map((i) => [i.id, i]));

  // The trail: receipts, reminders, invoices and notices for this proposal, newest first.
  const events = await db.activityEvent.findMany({
    where: { organizationId, proposalId: p.id, kind: { in: ["EMAIL", "PAYMENT_RECEIVED", "PAYMENT_MARKED", "PAYMENT_UNMARKED", "PAYMENT_REFUNDED"] } },
    orderBy: { createdAt: "desc" },
    take: 40,
    select: { createdAt: true, summary: true, meta: true, actor: { select: { name: true } } },
  });
  const receiptAt = new Map<string, Date>();
  for (const e of events) {
    try {
      const m = e.meta ? (JSON.parse(e.meta) as { receipt?: string }) : null;
      if (m?.receipt && !receiptAt.has(m.receipt)) receiptAt.set(m.receipt, e.createdAt);
    } catch {
      /* a trail row with no meta */
    }
  }

  const stages: PanelStage[] = schedule.stages.map((s) => {
    const row = rows.get(s.id);
    const pay = row?.payment && row.payment.status !== "VOID" ? row.payment : null;
    const due = row?.dueDate ?? null;
    const late = daysLate(due ? wallDay(due, tz) : null, s.status, today);
    const manual = pay?.provider === "MANUAL";
    return {
      id: s.id,
      label: s.label,
      synthetic: s.synthetic,
      amount: fromMinor(s.amountMinor),
      pct: s.pct,
      status: s.status,
      due: due ? dayOf(due, tz) : null,
      dueWords: due ? shortDay(due, tz) : null,
      late,
      lateWords: lateWords(late),
      next: s.id === schedule.nextPayableId,
      changeOrder: !!row?.changeOrderId,
      paid:
        s.status === "PAID" && pay
          ? {
              amount: fromMinor(s.paidAmountMinor) || pay.amount,
              on: shortDay(pay.paidAt ?? row?.paidAt ?? pay.createdAt, tz),
              how: paidHow(pay.provider, pay.method),
              paymentId: pay.id,
              manual,
              receiptSent: receiptAt.has(pay.id) ? `${dayWords(receiptAt.get(pay.id)!, tz)} ${clockWords(receiptAt.get(pay.id)!, tz)}` : null,
            }
          : null,
      invoiced: row?.invoiceSentAt ? shortDay(row.invoiceSentAt, tz) : null,
      reminders: row?.reminderCount ?? 0,
      rights: stageRights({ status: s.status, changeOrder: !!row?.changeOrderId, synthetic: s.synthetic, manualPayment: manual }),
    };
  });

  const chased = schedule.nextPayableId ? rows.get(schedule.nextPayableId) : undefined;
  const nr = nextReminder({
    mode: settings.reminderMode,
    proposalOn: p.remindersOn,
    anchor: chased ? (chased.dueDate ?? p.acceptedAt ?? p.sentAt ?? p.createdAt) : null,
    reminderCount: chased?.reminderCount ?? 0,
    remindedAt: chased?.remindedAt ?? null,
    owed: schedule.remainingMinor > 0 && SOLD.includes(p.status),
  });
  const sentReminders = events.filter((e) => e.summary.startsWith("Payment reminder")).length;
  const remWords =
    "stopped" in nr
      ? `${sentReminders ? `${sentReminders} sent. ` : ""}${nr.stopped}`
      : `${sentReminders ? `${sentReminders} sent · ` : ""}next: reminder ${nr.round} of 3, ${nr.at.getTime() <= Date.now() ? "goes out today" : dayWords(nr.at, tz)}${chased ? ` (${chased.label})` : ""}.`;

  const lateStages = stages.filter((s) => s.late > 0);
  const noticeAt = await orderNoticeSentAt(p.id);
  return {
    proposalId: p.id,
    title: p.title,
    client: { name: p.client?.name ?? null, email: p.client?.email ?? null, phone: !!p.client?.phone },
    sold: SOLD.includes(p.status),
    contract: fromMinor(schedule.totalMinor),
    paid: fromMinor(schedule.paidMinor),
    left: fromMinor(schedule.remainingMinor),
    late: { count: lateStages.length, amount: Math.round(lateStages.reduce((a, s) => a + s.amount, 0) * 100) / 100 },
    coverage: coverageWords(schedule.mismatchMinor, money),
    stages,
    reminders: { words: remWords, mode: settings.reminderMode, proposalOn: p.remindersOn },
    log: events.slice(0, 25).map((e) => ({
      at: e.createdAt.toISOString(),
      when: `${dayWords(e.createdAt, tz)} ${clockWords(e.createdAt, tz)}`,
      what: e.summary,
      who: e.actor?.name ?? (/\(auto\)/.test(e.summary) ? "JobFlex" : null),
    })),
    orderNotice: { sent: noticeAt ? `${dayWords(noticeAt, tz)} ${clockWords(noticeAt, tz)}` : null, auto: settings.orderNoticeAuto },
    receiptsAuto: settings.receiptsOnPayment,
    today: dayOf(new Date(), tz),
    tz,
  };
}

/** After a schedule edit: reprice the open invoices, and void any checkout minted for money that changed. */
async function afterEdit(organizationId: string, proposalId: string, before: ReturnType<typeof resolveSchedule>) {
  const p = await db.proposal.findUnique({
    where: { id: proposalId },
    select: { total: true, currency: true, installments: { orderBy: { position: "asc" } }, changeOrders: { where: { status: "APPROVED" }, select: { status: true, total: true } } },
  });
  if (!p) return;
  const after = resolveSchedule({ ...contractSchedule(p.total, p.changeOrders), currency: p.currency, installments: p.installments });
  await repriceOpenInvoices(db, { organizationId, proposalId, stages: after.stages }).catch((err) => console.warn("[paymentsPanel] reprice failed", err));
  if (diffUnpaid(before, after)) await db.proposal.update({ where: { id: proposalId }, data: { scheduleVersion: { increment: 1 } } });
}

async function scheduleOf(proposalId: string) {
  const p = await db.proposal.findUnique({
    where: { id: proposalId },
    select: { total: true, currency: true, installments: { orderBy: { position: "asc" } }, changeOrders: { where: { status: "APPROVED" }, select: { status: true, total: true } } },
  });
  return p ? resolveSchedule({ ...contractSchedule(p.total, p.changeOrders), currency: p.currency, installments: p.installments }) : null;
}

/** A new payment at the end of the schedule: a label, dollars or a percent of the contract, and a due date. */
export async function addPanelStage(organizationId: string, actorId: string, input: { proposalId: string; label: string; amount: number; isPercent: boolean; due: string | null }): Promise<{ id: string }> {
  const p = await db.proposal.findFirst({ where: { id: input.proposalId, organizationId }, select: { id: true, title: true, clientId: true } });
  if (!p) throw new Error("Not found");
  const amount = cleanStageAmount(input.amount, input.isPercent);
  if (amount === null) throw new Error(input.isPercent ? "A percent is between 1 and 100." : "Enter the amount.");
  const label = input.label.trim().slice(0, 80) || "Payment";
  const tz = await tzOf(organizationId);
  const dueDate = input.due ? wallInstant(input.due, "12:00", tz) : null;
  // A proposal with no rows of its own has the implicit "Full payment" — made real first, so the new one sits after it.
  const existing = await ensureSchedule(p.id);
  const before = (await scheduleOf(p.id))!;
  const row = await db.installment.create({
    data: { proposalId: p.id, label, amount, isPercent: input.isPercent, dueDate, position: Math.max(-1, ...existing.map((i) => i.position)) + 1 },
  });
  await afterEdit(organizationId, p.id, before);
  await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.ESTIMATE, proposalId: p.id, clientId: p.clientId, summary: `Added a payment to ${p.title}: ${label} ${input.isPercent ? `${amount}%` : money(amount)}${input.due ? `, due ${input.due}` : ""}` });
  return { id: row.id };
}

/** Remove an open payment (not paid, not closed, no checkout open, not a change order's). */
export async function removePanelStage(organizationId: string, actorId: string, installmentId: string): Promise<void> {
  const row = await db.installment.findFirst({ where: { id: installmentId, proposal: { organizationId } }, select: { id: true, label: true, status: true, changeOrderId: true, proposalId: true, proposal: { select: { title: true, clientId: true } } } });
  if (!row) throw new Error("Not found");
  const rights = stageRights({ status: row.status, changeOrder: !!row.changeOrderId, synthetic: false, manualPayment: false });
  if (!rights.remove) {
    throw new Error(row.status === "PAID" ? "That payment is paid — undo it first." : row.status === "PENDING" ? "The client has that payment open to pay right now." : row.changeOrderId ? "That payment is a change order's — withdraw the change order instead." : "That payment can't be removed.");
  }
  const before = (await scheduleOf(row.proposalId))!;
  await db.installment.delete({ where: { id: row.id } });
  await afterEdit(organizationId, row.proposalId, before);
  await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.ESTIMATE, proposalId: row.proposalId, clientId: row.proposal.clientId, summary: `Removed the payment "${row.label}" from ${row.proposal.title}` });
}

/** Set or clear an open payment's due date (the reminders count from it). */
export async function setPanelStageDue(organizationId: string, actorId: string, installmentId: string, due: string | null): Promise<void> {
  const row = await db.installment.findFirst({ where: { id: installmentId, proposal: { organizationId } }, select: { id: true, label: true, status: true, changeOrderId: true, proposalId: true, proposal: { select: { title: true, clientId: true } } } });
  if (!row) throw new Error("Not found");
  if (!stageRights({ status: row.status, changeOrder: !!row.changeOrderId, synthetic: false, manualPayment: false }).editDue) throw new Error("That payment is settled — its due date stays.");
  const tz = await tzOf(organizationId);
  const dueDate = due ? wallInstant(due, "12:00", tz) : null;
  if (due && !dueDate) throw new Error("I couldn't read that date.");
  // A new due date restarts the ladder for this payment.
  await db.installment.update({ where: { id: row.id }, data: { dueDate, reminderCount: 0, remindedAt: null } });
  await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.ESTIMATE, proposalId: row.proposalId, clientId: row.proposal.clientId, summary: `${due ? `Set "${row.label}" due ${due}` : `Cleared the due date of "${row.label}"`} on ${row.proposal.title}` });
}

/** The company's switch: send "order placed" by itself when the first payment lands. */
export async function setOrderNoticeAuto(organizationId: string, actorId: string, on: boolean): Promise<void> {
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { paymentSettingsJson: true } });
  const current = parsePaymentSettings(org?.paymentSettingsJson);
  await db.organization.update({ where: { id: organizationId }, data: { paymentSettingsJson: JSON.stringify({ ...current, orderNoticeAuto: on }) } });
  await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.SETTINGS, summary: `${on ? "Turned on" : "Turned off"} the order-placed notice on the first payment`, meta: { area: "payment", orderNoticeAuto: on } });
}
