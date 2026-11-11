// SERVICE PLANS — THE BOOK (2026-09-22), server only. The rules live in
// lib/servicePlans; this is what touches the database: a plan goes out,
// is accepted, puts its visits on the calendar, bills on schedule, reminds
// before a visit, warns before it ends, renews or expires, and lends the
// member's discount to every new proposal. Every notice is an ActivityEvent
// the bell already reads (kind PLAN_*, meta.href), and an email to the
// client through the shop's own sender when the client has an address.

import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { nextInvoiceNumber } from "@/lib/payments/invoiceRecord";
import { sendOrgEmail } from "@/lib/email/orgSend";
import { renderEmail } from "@/lib/email/renderEmail";
import type { EmailDoc } from "@/lib/email/doc";
import { appBaseUrl } from "@/lib/appUrl";
import {
  advanceBilling,
  atLocalHour,
  billingPeriodLabel,
  money,
  parseBenefits,
  planEndsAt,
  planPhase,
  planTermsLine,
  tuneUpChecklist,
  visitSchedule,
  type Billing,
  type PlanPhase,
} from "@/lib/servicePlans";
import { SERVICE_DESK_PATH } from "@/lib/serviceDesk";
import { lawnSlots } from "@/lib/lawn/calendar";
import { readLawnSchedule } from "@/lib/lawn/planStore";

type Tx = Prisma.TransactionClient;
const ORG_SELECT = { id: true, name: true, timezone: true, logoUrl: true, gmailSettingsJson: true, gmailTokensJson: true, billingEmail: true } as const;
type OrgRow = { id: string; name: string | null; timezone: string; logoUrl: string | null; gmailSettingsJson: string | null; gmailTokensJson: string | null; billingEmail: string | null };

const DAY = 86400000;
const fmtDay = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** One email to the client, in the shop's name. Never throws; false when it could not go. */
type PlanMail = Omit<EmailDoc, "lockup" | "footer">;
async function emailClient(org: OrgRow, to: string | null | undefined, doc: PlanMail): Promise<boolean> {
  if (!to) return false;
  try {
    const name = org.name ?? "Your contractor";
    const { subject, html } = renderEmail({ ...doc, lockup: { kind: "org", name, logoUrl: org.logoUrl, orgId: org.id }, footer: { name, contact: org.billingEmail ?? undefined } });
    const r = await sendOrgEmail(org, { mailClass: "transactional", to, subject, html });
    return !!r && (r as { ok?: boolean }).ok !== false;
  } catch (err) {
    console.warn(`[servicePlans] email not sent: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/** `actorId`: the member whose action this is; null for the daily run and the client's own accept. */
async function notice(tx: Tx | typeof db, organizationId: string, kind: string, summary: string, meta: Record<string, unknown>, clientId?: string | null, actorId?: string | null) {
  // The bell opens the HVAC services desk (2026-10-18), where plans, visits and bills now live together.
  await tx.activityEvent.create({ data: { organizationId, actorId: actorId ?? null, kind, summary, meta: JSON.stringify({ href: SERVICE_DESK_PATH, ...meta }), clientId: clientId ?? null } });
}

// ── invoices ────────────────────────────────────────────────────────────────

/** The bill for one period, once: a second call for the same due date is a no-op. */
/** The term's visits: a lawn plan books its own season (lib/lawn — dated visits, their length and checklist); every
 *  other plan the engine's spread of tune-ups, two hours each. */
async function termSlots(plan: { id: string; trade: string; termMonths: number; visitsPerYear: number }, startsAt: Date): Promise<Array<{ seq: number; label: string; dueAt: Date; minutes: number; notes: string }>> {
  if (plan.trade === "lawn") {
    const sched = await readLawnSchedule(plan.id);
    if (sched) return lawnSlots(sched, startsAt, plan.termMonths).map((x) => ({ seq: x.seq, label: x.label, dueAt: x.dueAt, minutes: x.minutes, notes: [`${x.label} — lawn plan visit.`, ...x.checklist.map((c) => `• ${c}`)].join("\n") }));
  }
  return visitSchedule(startsAt, plan.termMonths, plan.visitsPerYear, plan.trade).map((x) => ({ ...x, minutes: 120, notes: tuneUpChecklist(x.label, plan.trade) }));
}

export async function createPlanInvoice(tx: Tx, plan: { id: string; organizationId: string; clientId: string; priceCents: number; billing: string; name: string }, periodStart: Date): Promise<{ id: string; number: string; amount: number; created: boolean }> {
  const dueDate = new Date(periodStart.getTime() + 7 * DAY);
  const had = await tx.invoice.findFirst({ where: { servicePlanId: plan.id, dueDate }, select: { id: true, number: true, amount: true } });
  if (had) return { ...had, created: false };
  const number = await nextInvoiceNumber(plan.organizationId, tx);
  const inv = await tx.invoice.create({
    data: { organizationId: plan.organizationId, clientId: plan.clientId, servicePlanId: plan.id, number, amount: Math.round(plan.priceCents) / 100, status: "PENDING", provider: "MANUAL", dueDate },
    select: { id: true, number: true, amount: true },
  });
  return { ...inv, created: true };
}

function invoiceDoc(org: OrgRow, plan: { name: string; billing: string; priceCents: number; visitsPerYear: number; termMonths: number; discountPct: number }, clientName: string, number: string, periodStart: Date): PlanMail {
  const period = billingPeriodLabel(periodStart, plan.billing as Billing);
  return {
    subject: `${plan.name}: ${money(plan.priceCents)} for ${period}`,
    kicker: { text: "Service plan" },
    headline: `Your ${plan.name} bill`,
    prose: [`Hi ${clientName.split(" ")[0]}, here is the ${plan.billing === "YEARLY" ? "yearly" : "monthly"} bill for your ${plan.name} with ${org.name ?? "us"}.`],
    box: [
      { type: "field", label: "Plan", value: planTermsLine(plan) },
      { type: "item", name: `Invoice ${number} · ${period}`, amount: money(plan.priceCents) },
    ],
    after: ["Pay the way you usually do with us — card, check or bank — or reply to this email and we will send a payment link."],
  };
}

// ── activation, renewal, cancellation ───────────────────────────────────────

/**
 * A plan goes live: the term is set, the visits land on the calendar (9:00
 * in the shop's own time zone, two hours, the crew's checklist in the
 * notes), the first bill is written, and the client gets a welcome. A plan
 * already active or canceled is left alone.
 */
export async function activatePlan(planId: string, opts: { acceptedName?: string | null; startsAt?: Date; actorId?: string | null } = {}): Promise<{ ok: boolean; visits: number }> {
  const plan = await db.servicePlan.findUnique({ where: { id: planId }, include: { client: true, organization: { select: ORG_SELECT }, visits: { select: { seq: true } } } });
  if (!plan || plan.status === "ACTIVE" || plan.status === "CANCELED") return { ok: false, visits: 0 };
  const startsAt = opts.startsAt ?? new Date();
  const endsAt = planEndsAt(startsAt, plan.termMonths);
  const slots = await termSlots(plan, startsAt);
  const tz = plan.organization.timezone || "America/New_York";
  const seq0 = plan.visits.reduce((a, v) => Math.max(a, v.seq), 0);
  const appUrl = await appBaseUrl();
  let invoiceNumber = "";
  await db.$transaction(async (tx) => {
    await tx.servicePlan.update({
      where: { id: plan.id },
      data: { status: "ACTIVE", startsAt, endsAt, acceptedAt: new Date(), acceptedName: opts.acceptedName ?? plan.acceptedName, nextBillingAt: advanceBilling(startsAt, plan.billing as Billing), expiringNoticedAt: null },
    });
    for (const s of slots) {
      const start = atLocalHour(s.dueAt, 9, tz);
      const appt = await tx.appointment.create({
        data: { organizationId: plan.organizationId, clientId: plan.clientId, title: `${s.label} · ${plan.name}`, startsAt: start, endsAt: new Date(start.getTime() + s.minutes * 60000), notes: s.notes, status: "SCHEDULED" },
      });
      // The crew's report form for this visit (2026-09-23), first line of the notes.
      await tx.appointment.update({ where: { id: appt.id }, data: { notes: `Report form: ${appUrl}/dashboard/visits/${appt.id}\n\n${s.notes}` } });
      await tx.servicePlanVisit.create({ data: { organizationId: plan.organizationId, planId: plan.id, seq: seq0 + s.seq, label: s.label, dueAt: s.dueAt, status: "SCHEDULED", appointmentId: appt.id } });
    }
    const inv = await createPlanInvoice(tx, plan, startsAt);
    invoiceNumber = inv.number;
    await notice(tx, plan.organizationId, "PLAN_ACTIVATED", `${plan.client.name} joined the ${plan.name} — ${slots.length} visit${slots.length === 1 ? "" : "s"} on the calendar, invoice ${inv.number} written`, { planId: plan.id }, plan.clientId, opts.actorId);
  });
  const first = slots[0];
  await emailClient(plan.organization, plan.client.email, {
    subject: `Welcome to the ${plan.name}`,
    kicker: { text: "Service plan", tone: "ok" },
    headline: `You're in: the ${plan.name}`,
    prose: [
      `Thank you, ${plan.client.name.split(" ")[0]}. Your plan with ${plan.organization.name ?? "us"} runs ${fmtDay(startsAt)} – ${fmtDay(endsAt)}.`,
      first ? `Your first visit, the ${first.label.toLowerCase()}, is set for ${fmtDay(first.dueAt)} — we will confirm the time a couple of weeks before.` : "We will be in touch to set your first visit.",
    ],
    box: [{ type: "field", label: "Plan", value: planTermsLine(plan) }, ...parseBenefits(plan.benefitsJson).map((b) => ({ type: "field" as const, label: "Includes", value: b })), { type: "item", name: `Invoice ${invoiceNumber}`, amount: money(plan.priceCents) }],
    after: [plan.trade === "lawn" ? "Every visit of the season is on our calendar; anything extra is quoted before we do it." : "Repairs and services are billed at your member discount for as long as the plan runs."],
  });
  return { ok: true, visits: slots.length };
}

/** The plan is sent to the client: status SENT and the email with the accept link. */
export async function sendPlan(planId: string, actorId?: string | null): Promise<{ ok: boolean; emailed: boolean; href: string }> {
  const plan = await db.servicePlan.findUnique({ where: { id: planId }, include: { client: true, organization: { select: ORG_SELECT } } });
  if (!plan || (plan.status !== "DRAFT" && plan.status !== "SENT")) return { ok: false, emailed: false, href: "" };
  const href = `${await appBaseUrl()}/plan/${plan.acceptToken}`;
  await db.servicePlan.update({ where: { id: plan.id }, data: { status: "SENT", sentAt: new Date() } });
  const emailed = await emailClient(plan.organization, plan.client.email, {
    subject: `${plan.organization.name ?? "Your contractor"}: the ${plan.name}`,
    kicker: { text: "Service plan" },
    headline: plan.name,
    prose: [plan.description ?? `A maintenance plan for your home from ${plan.organization.name ?? "us"}.`, planTermsLine(plan)],
    box: parseBenefits(plan.benefitsJson).map((b) => ({ type: "field" as const, label: "Includes", value: b })),
    cta: { label: "Accept the plan", href },
    after: ["Accepting starts the plan today: the visits go on our calendar and the first bill follows by email."],
  });
  await notice(db, plan.organizationId, "PLAN_SENT", `${plan.name} sent to ${plan.client.name}${emailed ? "" : " (no email on file — share the link)"}`, { planId: plan.id, acceptHref: href }, plan.clientId, actorId);
  return { ok: true, emailed, href };
}

/** Another term: from the old end (or today), new visits, a new bill. */
export async function renewPlan(planId: string, actorId?: string | null): Promise<{ ok: boolean }> {
  const plan = await db.servicePlan.findUnique({ where: { id: planId }, include: { client: true, organization: { select: ORG_SELECT }, visits: { select: { seq: true } } } });
  if (!plan || (plan.status !== "ACTIVE" && plan.status !== "EXPIRED")) return { ok: false };
  const now = new Date();
  const startsAt = plan.endsAt && plan.endsAt.getTime() > now.getTime() - 60 * DAY ? plan.endsAt : now;
  const endsAt = planEndsAt(startsAt, plan.termMonths);
  const slots = await termSlots(plan, startsAt);
  const tz = plan.organization.timezone || "America/New_York";
  const seq0 = plan.visits.reduce((a, v) => Math.max(a, v.seq), 0);
  const appUrl = await appBaseUrl();
  await db.$transaction(async (tx) => {
    await tx.servicePlan.update({ where: { id: plan.id }, data: { status: "ACTIVE", startsAt, endsAt, nextBillingAt: advanceBilling(startsAt, plan.billing as Billing), expiringNoticedAt: null } });
    for (const s of slots) {
      const start = atLocalHour(s.dueAt, 9, tz);
      const appt = await tx.appointment.create({ data: { organizationId: plan.organizationId, clientId: plan.clientId, title: `${s.label} · ${plan.name}`, startsAt: start, endsAt: new Date(start.getTime() + s.minutes * 60000), notes: s.notes, status: "SCHEDULED" } });
      await tx.appointment.update({ where: { id: appt.id }, data: { notes: `Report form: ${appUrl}/dashboard/visits/${appt.id}\n\n${s.notes}` } });
      await tx.servicePlanVisit.create({ data: { organizationId: plan.organizationId, planId: plan.id, seq: seq0 + s.seq, label: s.label, dueAt: s.dueAt, status: "SCHEDULED", appointmentId: appt.id } });
    }
    const inv = await createPlanInvoice(tx, plan, startsAt);
    await notice(tx, plan.organizationId, "PLAN_RENEWED", `${plan.client.name}'s ${plan.name} renewed to ${fmtDay(endsAt)} — invoice ${inv.number}`, { planId: plan.id }, plan.clientId, actorId);
  });
  await emailClient(plan.organization, plan.client.email, {
    subject: `Your ${plan.name} is renewed`,
    kicker: { text: "Service plan", tone: "ok" },
    headline: `Renewed to ${fmtDay(endsAt)}`,
    prose: [`Your ${plan.name} with ${plan.organization.name ?? "us"} runs another ${plan.termMonths} months. The visits are on our calendar; the bill follows by email.`],
    box: [{ type: "field", label: "Plan", value: planTermsLine(plan) }],
  });
  return { ok: true };
}

/** Canceled: the visits still ahead leave the calendar, unpaid plan bills are voided. */
export async function cancelPlan(planId: string, actorId?: string | null): Promise<{ ok: boolean }> {
  const plan = await db.servicePlan.findUnique({ where: { id: planId }, include: { client: { select: { name: true } }, visits: { where: { status: "SCHEDULED" }, select: { id: true, appointmentId: true, dueAt: true } } } });
  if (!plan || plan.status === "CANCELED") return { ok: false };
  const now = new Date();
  await db.$transaction(async (tx) => {
    await tx.servicePlan.update({ where: { id: plan.id }, data: { status: "CANCELED", canceledAt: now, nextBillingAt: null } });
    const ahead = plan.visits.filter((v) => v.dueAt.getTime() > now.getTime());
    if (ahead.length) {
      await tx.servicePlanVisit.updateMany({ where: { id: { in: ahead.map((v) => v.id) } }, data: { status: "SKIPPED" } });
      const appts = ahead.map((v) => v.appointmentId).filter((x): x is string => !!x);
      if (appts.length) await tx.appointment.updateMany({ where: { id: { in: appts } }, data: { status: "CANCELED" } });
    }
    await tx.invoice.updateMany({ where: { servicePlanId: plan.id, status: "PENDING" }, data: { status: "VOID" } });
    await notice(tx, plan.organizationId, "PLAN_CANCELED", `${plan.client.name}'s ${plan.name} canceled — ${ahead.length} visit${ahead.length === 1 ? "" : "s"} taken off the calendar`, { planId: plan.id }, plan.clientId, actorId);
  });
  return { ok: true };
}

export async function markVisitDone(visitId: string, organizationId: string, actorId?: string | null): Promise<boolean> {
  const v = await db.servicePlanVisit.findFirst({ where: { id: visitId, organizationId }, select: { id: true, appointmentId: true, label: true, planId: true, plan: { select: { name: true, clientId: true, client: { select: { name: true } } } } } });
  if (!v) return false;
  await db.$transaction(async (tx) => {
    await tx.servicePlanVisit.update({ where: { id: v.id }, data: { status: "DONE", doneAt: new Date() } });
    if (v.appointmentId) await tx.appointment.updateMany({ where: { id: v.appointmentId }, data: { status: "COMPLETED" } });
    await notice(tx, organizationId, "PLAN_VISIT_DONE", `${v.plan.client.name}: ${v.label.toLowerCase()} done (${v.plan.name})`, { planId: v.planId, visitId: v.id }, v.plan.clientId, actorId);
  });
  return true;
}

/** A plan bill paid by hand: the invoice closes and a payment row lands in the books (Financials reads payments). */
export async function markPlanInvoicePaid(invoiceId: string, organizationId: string, method = "CHECK", actorId?: string | null): Promise<boolean> {
  const inv = await db.invoice.findFirst({ where: { id: invoiceId, organizationId, servicePlanId: { not: null }, status: "PENDING" }, select: { id: true, amount: true, clientId: true, number: true, servicePlanId: true, servicePlan: { select: { name: true, client: { select: { name: true } } } } } });
  if (!inv) return false;
  const now = new Date();
  await db.$transaction(async (tx) => {
    await tx.invoice.update({ where: { id: inv.id }, data: { status: "PAID", paidAt: now } });
    const payment = await tx.payment.create({ data: { organizationId, invoiceId: inv.id, clientId: inv.clientId, amount: inv.amount, provider: "MANUAL", status: "PAID", method, paidAt: now, netAmount: inv.amount, livemode: true } });
    await notice(tx, organizationId, "PLAN_INVOICE_PAID", `${inv.servicePlan?.client.name ?? "Client"}: ${inv.servicePlan?.name ?? "plan"} invoice ${inv.number} paid by ${method.toLowerCase()} — ${money(Math.round(inv.amount * 100))}`, { planId: inv.servicePlanId, invoiceId: inv.id, paymentId: payment.id, amount: inv.amount, method }, inv.clientId, actorId);
  });
  return true;
}

// ── the daily run ───────────────────────────────────────────────────────────

export interface PlanRunReport { billed: number; reminded: number; expiringNoticed: number; renewed: number; expired: number; errors: number }

/** Everything the plans do on their own, once a day (api/cron/service-plans). */
export async function runServicePlans(now = new Date()): Promise<PlanRunReport> {
  const report: PlanRunReport = { billed: 0, reminded: 0, expiringNoticed: 0, renewed: 0, expired: 0, errors: 0 };

  // 1) Bills due.
  const due = await db.servicePlan.findMany({ where: { status: "ACTIVE", nextBillingAt: { lte: now } }, include: { client: true, organization: { select: ORG_SELECT } } });
  for (const plan of due) {
    try {
      if (!plan.nextBillingAt || (plan.endsAt && plan.nextBillingAt.getTime() >= plan.endsAt.getTime())) {
        await db.servicePlan.update({ where: { id: plan.id }, data: { nextBillingAt: null } });
        continue;
      }
      const periodStart = plan.nextBillingAt;
      let created = { created: false, number: "" };
      await db.$transaction(async (tx) => {
        const inv = await createPlanInvoice(tx, plan, periodStart);
        created = inv;
        await tx.servicePlan.update({ where: { id: plan.id }, data: { nextBillingAt: advanceBilling(periodStart, plan.billing as Billing) } });
        if (inv.created) await notice(tx, plan.organizationId, "PLAN_INVOICE", `${plan.client.name}: ${plan.name} invoice ${inv.number} for ${money(plan.priceCents)} is out`, { planId: plan.id, invoiceId: inv.id }, plan.clientId);
      });
      if (created.created) {
        await emailClient(plan.organization, plan.client.email, invoiceDoc(plan.organization, plan, plan.client.name, created.number, periodStart));
        report.billed++;
      }
    } catch (err) {
      report.errors++;
      console.error(`[servicePlans] bill ${plan.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 2) Visits two weeks out: the office hears, the client hears.
  const soon = new Date(now.getTime() + 14 * DAY);
  const visits = await db.servicePlanVisit.findMany({ where: { status: "SCHEDULED", remindedAt: null, dueAt: { lte: soon, gte: new Date(now.getTime() - 2 * DAY) }, plan: { status: "ACTIVE" } }, include: { plan: { include: { client: true, organization: { select: ORG_SELECT } } }, appointment: { select: { startsAt: true } } } });
  for (const v of visits) {
    try {
      // A lawn plan's routine mowing isn't announced each week: marked, not mailed.
      if (v.plan.trade === "lawn" && /^mow/i.test(v.label)) {
        await db.servicePlanVisit.update({ where: { id: v.id }, data: { remindedAt: now } });
        continue;
      }
      const when = v.appointment?.startsAt ?? v.dueAt;
      const whenText = v.appointment ? when.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: v.plan.organization.timezone || "America/New_York" }) : fmtDay(v.dueAt);
      await db.servicePlanVisit.update({ where: { id: v.id }, data: { remindedAt: now } });
      await notice(db, v.organizationId, "PLAN_VISIT_DUE", `${v.plan.client.name}: ${v.label.toLowerCase()} ${whenText} — on the calendar (${v.plan.name}); confirm the time with them`, { planId: v.planId, visitId: v.id, href: "/dashboard/calendar" }, v.plan.clientId);
      await emailClient(v.plan.organization, v.plan.client.email, {
        subject: `Your ${v.label.toLowerCase()} is coming up`,
        kicker: { text: "Service plan" },
        headline: `${v.label}: ${whenText}`,
        prose: [`Part of your ${v.plan.name}. We have it on our calendar for ${whenText}; if another day suits you better, reply to this email and we will move it.`],
        after: [v.plan.trade === "lawn" ? "Please leave the gates unlocked and keep pets inside while we're there." : "Please leave clear access to the indoor and outdoor units."],
      });
      report.reminded++;
    } catch (err) {
      report.errors++;
      console.error(`[servicePlans] remind ${v.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 3) Ending within 30 days: one warning, then renew or expire at the end.
  const ending = await db.servicePlan.findMany({ where: { status: "ACTIVE", endsAt: { lte: new Date(now.getTime() + 30 * DAY) } }, include: { client: true, organization: { select: ORG_SELECT } } });
  for (const plan of ending) {
    try {
      if (plan.endsAt && plan.endsAt.getTime() <= now.getTime()) {
        if (plan.autoRenew) {
          await renewPlan(plan.id);
          report.renewed++;
        } else {
          await db.servicePlan.update({ where: { id: plan.id }, data: { status: "EXPIRED", nextBillingAt: null } });
          await notice(db, plan.organizationId, "PLAN_EXPIRED", `${plan.client.name}'s ${plan.name} has ended — call to renew`, { planId: plan.id }, plan.clientId);
          report.expired++;
        }
        continue;
      }
      if (!plan.expiringNoticedAt) {
        await db.servicePlan.update({ where: { id: plan.id }, data: { expiringNoticedAt: now } });
        await notice(db, plan.organizationId, "PLAN_EXPIRING", `${plan.client.name}'s ${plan.name} ends ${fmtDay(plan.endsAt!)} — ${plan.autoRenew ? "it renews on its own; a call keeps them" : "call to renew"}`, { planId: plan.id }, plan.clientId);
        await emailClient(plan.organization, plan.client.email, {
          subject: `Your ${plan.name} ${plan.autoRenew ? "renews" : "ends"} on ${fmtDay(plan.endsAt!)}`,
          kicker: { text: "Service plan" },
          headline: plan.autoRenew ? `Renewing on ${fmtDay(plan.endsAt!)}` : `Ending on ${fmtDay(plan.endsAt!)}`,
          prose: [plan.autoRenew ? `Your ${plan.name} with ${plan.organization.name ?? "us"} renews for another ${plan.termMonths} months on ${fmtDay(plan.endsAt!)}; nothing to do. Reply to this email if you want to change or stop it.` : `Your ${plan.name} with ${plan.organization.name ?? "us"} ends on ${fmtDay(plan.endsAt!)}. Reply to this email or call us to keep the visits and your ${plan.discountPct}% discount going.`],
          box: [{ type: "field", label: "Plan", value: planTermsLine(plan) }],
        });
        report.expiringNoticed++;
      }
    } catch (err) {
      report.errors++;
      console.error(`[servicePlans] ending ${plan.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return report;
}

// ── the member's discount on proposals ──────────────────────────────────────

export async function memberDiscountFor(organizationId: string, clientId: string | null | undefined): Promise<{ pct: number; planName: string } | null> {
  if (!clientId) return null;
  const plans = await db.servicePlan.findMany({ where: { organizationId, clientId, status: "ACTIVE", discountPct: { gt: 0 } }, select: { discountPct: true, name: true }, orderBy: { discountPct: "desc" }, take: 1 });
  return plans[0] ? { pct: plans[0].discountPct, planName: plans[0].name } : null;
}

/**
 * A new proposal for a member gets the plan's discount as its discount
 * line, priced the way actions/proposals prices one (off before tax). A
 * proposal that already carries a discount keeps the contractor's own.
 */
export async function applyMemberDiscount(proposalId: string): Promise<boolean> {
  const p = await db.proposal.findUnique({ where: { id: proposalId }, select: { id: true, organizationId: true, clientId: true, subtotal: true, taxRate: true, discounts: { select: { id: true } } } });
  if (!p || !p.clientId || p.discounts.length) return false;
  const member = await memberDiscountFor(p.organizationId, p.clientId);
  if (!member) return false;
  const subtotal = p.subtotal;
  const discountTotal = Math.min((subtotal * Math.min(member.pct, 100)) / 100, subtotal);
  const taxable = subtotal - discountTotal;
  const taxTotal = taxable * p.taxRate;
  await db.$transaction([
    db.discount.create({ data: { proposalId: p.id, label: `Member discount · ${member.planName} (${member.pct}%)`, amount: member.pct, isPercent: true } }),
    db.proposal.update({ where: { id: p.id }, data: { discountTotal, taxTotal, total: taxable + taxTotal } }),
  ]);
  return true;
}

// ── the dashboard ───────────────────────────────────────────────────────────

export interface PlanRow {
  id: string;
  clientId: string;
  clientName: string;
  clientEmail: string | null;
  name: string;
  status: string;
  phase: PlanPhase;
  terms: string;
  discountPct: number;
  priceCents: number;
  billing: string;
  startsAt: Date | null;
  endsAt: Date | null;
  nextBillingAt: Date | null;
  autoRenew: boolean;
  acceptToken: string;
  nextVisit: { id: string; label: string; dueAt: Date } | null;
  visitsDone: number;
  visitsTotal: number;
  openInvoices: { id: string; number: string; amount: number; dueDate: Date | null }[];
}

export interface PlansDashboard {
  templates: { id: string; name: string; description: string | null; visitsPerYear: number; termMonths: number; priceCents: number; billing: string; discountPct: number; benefits: string[]; priorityScheduling: boolean; waivedDiagnostic: boolean; terms: string; members: number }[];
  plans: PlanRow[];
  clients: { id: string; name: string }[];
  stats: { active: number; expiring: number; drafts: number; mrrCents: number; dueCents: number; dueCount: number; visitsDue: number };
  visitsDue: { id: string; planId: string; label: string; dueAt: Date; clientName: string; planName: string; startsAt: Date | null; appointmentId: string | null }[];
}

export async function loadPlansDashboard(organizationId: string, now = new Date()): Promise<PlansDashboard> {
  const [templates, plans, clients] = await Promise.all([
    db.servicePlanTemplate.findMany({ where: { organizationId, active: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], include: { _count: { select: { plans: { where: { status: "ACTIVE" } } } } } }),
    db.servicePlan.findMany({
      where: { organizationId },
      orderBy: [{ createdAt: "desc" }],
      include: { client: { select: { id: true, name: true, email: true } }, visits: { orderBy: { seq: "asc" }, include: { appointment: { select: { startsAt: true } } } }, invoices: { where: { status: "PENDING" }, select: { id: true, number: true, amount: true, dueDate: true } } },
      take: 500,
    }),
    db.client.findMany({ where: { organizationId, deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true }, take: 400 }),
  ]);
  const rows: PlanRow[] = plans.map((p) => {
    const nextVisit = p.visits.find((v) => v.status === "SCHEDULED" && v.dueAt.getTime() >= now.getTime() - 2 * DAY) ?? null;
    return {
      id: p.id,
      clientId: p.client.id,
      clientName: p.client.name,
      clientEmail: p.client.email,
      name: p.name,
      status: p.status,
      phase: planPhase(p, now),
      terms: planTermsLine(p),
      discountPct: p.discountPct,
      priceCents: p.priceCents,
      billing: p.billing,
      startsAt: p.startsAt,
      endsAt: p.endsAt,
      nextBillingAt: p.nextBillingAt,
      autoRenew: p.autoRenew,
      acceptToken: p.acceptToken,
      nextVisit: nextVisit ? { id: nextVisit.id, label: nextVisit.label, dueAt: nextVisit.appointment?.startsAt ?? nextVisit.dueAt } : null,
      visitsDone: p.visits.filter((v) => v.status === "DONE").length,
      visitsTotal: p.visits.filter((v) => v.status !== "SKIPPED").length,
      openInvoices: p.invoices,
    };
  });
  const active = rows.filter((r) => r.status === "ACTIVE");
  const visitsDue = plans
    .flatMap((p) => p.visits.filter((v) => v.status === "SCHEDULED" && p.status === "ACTIVE" && v.dueAt.getTime() <= now.getTime() + 30 * DAY).map((v) => ({ id: v.id, planId: p.id, label: v.label, dueAt: v.dueAt, clientName: p.client.name, planName: p.name, startsAt: v.appointment?.startsAt ?? null, appointmentId: v.appointmentId })))
    .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
  const open = rows.flatMap((r) => r.openInvoices);
  return {
    templates: templates.map((t) => ({ id: t.id, name: t.name, description: t.description, visitsPerYear: t.visitsPerYear, termMonths: t.termMonths, priceCents: t.priceCents, billing: t.billing, discountPct: t.discountPct, benefits: parseBenefits(t.benefitsJson), priorityScheduling: t.priorityScheduling, waivedDiagnostic: t.waivedDiagnostic, terms: planTermsLine(t), members: t._count.plans })),
    plans: rows,
    clients,
    stats: {
      active: active.length,
      expiring: rows.filter((r) => r.phase === "expiring" || r.phase === "lapsed").length,
      drafts: rows.filter((r) => r.status === "DRAFT" || r.status === "SENT").length,
      mrrCents: active.reduce((a, r) => a + (r.billing === "YEARLY" ? Math.round(r.priceCents / 12) : r.priceCents), 0),
      dueCents: Math.round(open.reduce((a, i) => a + i.amount, 0) * 100),
      dueCount: open.length,
      visitsDue: visitsDue.length,
    },
    visitsDue,
  };
}
