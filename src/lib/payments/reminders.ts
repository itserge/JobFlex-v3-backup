// Payment reminders — the one sender behind the Remind / Request payment
// buttons (manual) and the daily cron (auto). Plain module.
//
// What a reminder is: the branded "X is due" email with the pay link, and a
// short text with the same link when the client has a phone Twilio can dial.
// Both are best-effort and reported, never thrown. The stage is stamped
// (remindedAt, reminderCount) so the ladder knows what has gone out.
//
// THE LADDER (auto mode): rung 1 the day after the stage is due, rung 2 on
// day 3, rung 3 on day 7 — never more, never twice in a day. "Due" is the
// stage's due date, or, when it has none, the proposal's acceptance. The
// company chooses auto / manual / off in Settings → Payments; a proposal can
// override with remindersOn.
import { db } from "@/lib/db";
import { appBaseUrl } from "@/lib/appUrl";
import { renderEmail } from "@/lib/email/renderEmail";
import { buildPaymentReminder } from "@/lib/email/build/client";
import { sendOrgEmail } from "@/lib/email/orgSend";
import { isTwilioEnabled } from "@/lib/sdk/twilio";
import { sendText } from "@/lib/sms/send";
import { toE164 } from "@/lib/phone";
import { fromMinor, resolveSchedule } from "@/lib/paymentSchedule";
import { contractSchedule, contractTotal } from "@/lib/contractTotal";
import { ensureSchedule } from "@/lib/payments/settle";
import { parsePaymentSettings } from "@/lib/settings";
import { trialBlocksText } from "@/lib/trialMeter";

export const REMINDER_DAYS = [1, 3, 7] as const;
export const MAX_REMINDERS = REMINDER_DAYS.length;
const DAY_MS = 86_400_000;

export type ReminderSource = "auto" | "manual";
export interface ReminderReport {
  sent: boolean;
  email: "sent" | "no-email" | "failed";
  sms: "sent" | "no-phone" | "failed" | "disabled";
  stageLabel: string;
  amount: number;
  skipped?: "not-found" | "nothing-owed" | "no-client";
}

/** Which rung is due now for a stage, or null when none is. */
export function dueRung(input: { anchor: Date | null; reminderCount: number; remindedAt: Date | null; now: Date }): number | null {
  const { anchor, reminderCount, remindedAt, now } = input;
  if (!anchor) return null;
  if (reminderCount >= MAX_REMINDERS) return null;
  const rung = reminderCount + 1;
  const dueAt = anchor.getTime() + REMINDER_DAYS[reminderCount] * DAY_MS;
  if (now.getTime() < dueAt) return null;
  // Never twice in a day, whoever pressed the last one.
  if (remindedAt && now.getTime() - remindedAt.getTime() < DAY_MS) return null;
  return rung;
}

/** `actorId`: the member behind a manual reminder; the auto ladder leaves it null. */
export async function sendPaymentReminder(input: { proposalId: string; installmentId: string | null; source: ReminderSource; organizationId?: string; actorId?: string | null }): Promise<ReminderReport> {
  const proposal = await db.proposal.findUnique({
    where: { id: input.proposalId },
    include: {
      client: true,
      organization: { select: { id: true, name: true, billingEmail: true, gmailSettingsJson: true, gmailTokensJson: true, logoUrl: true, phone: true } },
      installments: { orderBy: { position: "asc" } },
      changeOrders: { where: { status: "APPROVED" }, select: { status: true, total: true } },
    },
  });
  const none: ReminderReport = { sent: false, email: "no-email", sms: "no-phone", stageLabel: "", amount: 0 };
  if (!proposal || (input.organizationId && proposal.organizationId !== input.organizationId)) return { ...none, skipped: "not-found" };
  if (!proposal.client?.email && !toE164(proposal.client?.phone)) return { ...none, skipped: "no-client" };

  const installments = proposal.installments.length ? proposal.installments : await ensureSchedule(proposal.id);
  const schedule = resolveSchedule({ ...contractSchedule(proposal.total, proposal.changeOrders), currency: proposal.currency, installments });
  if (schedule.remainingMinor <= 0) return { ...none, skipped: "nothing-owed" };

  const stageRow = input.installmentId ? installments.find((i) => i.id === input.installmentId) ?? null : null;
  const stage = stageRow ? schedule.stages.find((s) => s.id === stageRow.id) ?? null : null;
  const amount = stage ? fromMinor(stage.amountMinor) : fromMinor(schedule.remainingMinor);
  const label = stageRow?.label ?? (schedule.unpaidCount > 1 ? "Remaining balance" : "Payment");
  const appUrl = await appBaseUrl();
  const href = `${appUrl}/portal/q/${proposal.publicId}`;
  const org = proposal.organization;
  const report: ReminderReport = { sent: false, email: "no-email", sms: "no-phone", stageLabel: label, amount };

  if (proposal.client?.email) {
    try {
      const { subject, html } = renderEmail(
        buildPaymentReminder({
          org: { id: proposal.organizationId, name: org.name, logoUrl: org.logoUrl, phone: org.phone },
          clientName: proposal.client.name,
          title: proposal.title,
          agreedTotal: contractTotal(proposal.total, proposal.changeOrders),
          paidToDate: fromMinor(schedule.paidMinor),
          dueNow: amount,
          dueLabel: label,
          dueDate: stageRow?.dueDate ?? null,
          href,
        }),
      );
      await sendOrgEmail(org, { to: proposal.client.email, subject, html });
      report.email = "sent";
    } catch (err) {
      console.warn("[reminders] email failed:", err);
      report.email = "failed";
    }
  }
  const phone = toE164(proposal.client?.phone);
  if (phone) {
    if (!await isTwilioEnabled()) report.sms = "disabled";
    // The card-less trial sends no texts (lib/trialMeter); the email went.
    else if (await trialBlocksText(proposal.organizationId, "payment-reminder")) report.sms = "disabled";
    else {
      try {
        // From the company's own number to a client who said yes (lib/sms/send, 2026-10-02).
        const sent = await sendText({ organizationId: proposal.organizationId, to: phone, body: `${org.name}: ${label.toLowerCase()} of $${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })} on ${proposal.title} is due. Pay online or see the details: ${href}`, kind: "payment-reminder" });
        report.sms = !sent.ok ? "failed" : sent.status === "SKIPPED" ? "disabled" : "sent";
      } catch (err) {
        console.warn("[reminders] sms failed:", err);
        report.sms = "failed";
      }
    }
  }
  report.sent = report.email === "sent" || report.sms === "sent";

  if (report.sent) {
    // Stamp the stage the ladder is about: the one asked for, else the next payable.
    const stampId = stageRow?.id ?? schedule.nextPayableId;
    if (stampId && installments.some((i) => i.id === stampId)) {
      await db.installment.update({ where: { id: stampId }, data: { remindedAt: new Date(), reminderCount: { increment: 1 } } }).catch(() => {});
    }
    await db.activityEvent.create({
      data: {
        organizationId: proposal.organizationId,
        actorId: input.actorId ?? null,
        proposalId: proposal.id,
        clientId: proposal.clientId ?? null,
        kind: "EMAIL",
        summary: `Payment reminder (${input.source}) · ${label} · $${amount.toFixed(2)} — email ${report.email}, text ${report.sms}`,
        meta: JSON.stringify({ amount, source: input.source, installmentId: stageRow?.id ?? null }),
      },
    });
  }
  return report;
}

/** The daily sweep: every org in auto mode, every open proposal, the next payable stage, one rung when due. */
export async function runReminderLadder(now = new Date(), limit = 200): Promise<{ orgs: number; considered: number; sent: number; skipped: number }> {
  const orgs = await db.organization.findMany({ where: { deletedAt: null }, select: { id: true, paymentSettingsJson: true } });
  const auto = orgs.filter((o) => parsePaymentSettings(o.paymentSettingsJson).reminderMode === "auto");
  let considered = 0;
  let sent = 0;
  let skipped = 0;
  for (const org of auto) {
    const proposals = await db.proposal.findMany({
      where: { organizationId: org.id, status: { in: ["ACCEPTED", "COMPLETED"] }, remindersOn: { not: false }, client: { isNot: null } },
      select: {
        id: true,
        total: true,
        currency: true,
        acceptedAt: true,
        sentAt: true,
        createdAt: true,
        installments: { orderBy: { position: "asc" } },
        changeOrders: { where: { status: "APPROVED" }, select: { status: true, total: true } },
      },
      take: 500,
    });
    for (const p of proposals) {
      if (sent >= limit) break;
      considered += 1;
      const installments = p.installments.length ? p.installments : await ensureSchedule(p.id);
      const schedule = resolveSchedule({ ...contractSchedule(p.total, p.changeOrders), currency: p.currency, installments });
      if (schedule.remainingMinor <= 0 || !schedule.nextPayableId) continue;
      const next = installments.find((i) => i.id === schedule.nextPayableId);
      if (!next) continue;
      const anchor = next.dueDate ?? p.acceptedAt ?? p.sentAt ?? p.createdAt;
      const rung = dueRung({ anchor, reminderCount: next.reminderCount, remindedAt: next.remindedAt, now });
      if (!rung) {
        skipped += 1;
        continue;
      }
      const r = await sendPaymentReminder({ proposalId: p.id, installmentId: next.id, source: "auto", organizationId: org.id });
      if (r.sent) sent += 1;
      else skipped += 1;
    }
  }
  return { orgs: auto.length, considered, sent, skipped };
}
