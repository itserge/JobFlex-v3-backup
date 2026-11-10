import "server-only";
// THE COMPANY PULSE, READ (Smart CRM part 7, 2026-11-10). One read for the Office sheet's scorecard, the Operator's
// company_pulse tool, the morning briefing's line and the Monday report — the arithmetic is lib/pulse/shared.
//
// The Monday report: the hourly follow-ups job calls runWeeklyReports. A company whose clock says Monday morning
// gets last week's numbers once (claimed in SyncState before anything is sent, so two overlapping runs send one
// mail), to its owners and admins who left "Weekly company report" on. A week with nothing in it sends nothing.

import { db } from "@/lib/db";
import { appBaseUrl } from "@/lib/appUrl";
import { dayKeyTz } from "@/lib/crm/brief";
import { buildWeeklyReport } from "@/lib/email/build/operator";
import { sendToMembersByPref } from "@/lib/notificationPrefs";
import { readSourceReport } from "@/lib/pipeline/server";
import { isTrialWriteLocked } from "@/lib/trialState";
import { isPageLocked } from "@/lib/customPageAccess";
import { buildPulse, defaultPeriod, pulseWindow, weeklyReportDue, type Pulse, type PulsePeriod } from "@/lib/pulse/shared";

const DAY = 86_400_000;
const FALLBACK_TZ = "America/New_York";

export interface PulseRead extends Pulse {
  tz: string;
  /** True when a list was cut at its cap — a very large company; the numbers are then a floor. */
  capped: boolean;
}

const CAP = 5000;

export async function readPulse(organizationId: string, opts: { period?: PulsePeriod; now?: Date; tz?: string | null } = {}): Promise<PulseRead> {
  const now = opts.now ?? new Date();
  const org = opts.tz ? null : await db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } });
  const tz = opts.tz || org?.timezone || FALLBACK_TZ;
  const w = pulseWindow(opts.period ?? defaultPeriod(now, tz), now, tz);
  const since = w.prevFrom;

  const [leads, proposals, payments, members, sources] = await Promise.all([
    db.lead.findMany({
      where: { organizationId, createdAt: { gte: since, lt: w.to } },
      select: { id: true, name: true, createdAt: true, claimedAt: true, contactedAt: true, status: true, source: true, claimedById: true, assignedToId: true },
      orderBy: { createdAt: "desc" },
      take: CAP,
    }),
    // Anything sent or decided since the earlier period began. A lost proposal is dated by the first of: cancelled,
    // declined, ran out, made (lib/pulse/shared lostAt) — so each of those days is asked for.
    db.proposal.findMany({
      where: {
        organizationId,
        status: { notIn: ["DRAFT", "ARCHIVED"] },
        OR: [{ sentAt: { gte: since } }, { acceptedAt: { gte: since } }, { declinedAt: { gte: since } }, { canceledAt: { gte: since } }, { validUntil: { gte: since } }, { createdAt: { gte: since } }],
      },
      select: { id: true, ownerId: true, status: true, total: true, sentAt: true, acceptedAt: true, declinedAt: true, canceledAt: true, validUntil: true, createdAt: true },
      orderBy: { updatedAt: "desc" },
      take: CAP,
    }),
    db.payment.findMany({ where: { organizationId, status: "PAID", paidAt: { gte: since, lt: w.to } }, select: { amount: true, paidAt: true }, take: CAP * 2 }),
    db.membership.findMany({ where: { organizationId }, select: { userId: true, role: true, user: { select: { name: true, email: true } } } }),
    readSourceReport(organizationId, Math.max(1 / 24, (w.to.getTime() - w.from.getTime()) / DAY), w.to).catch(() => []),
  ]);

  const pulse = buildPulse({
    window: w,
    now,
    leads: leads.map((l) => ({ id: l.id, name: l.name, createdAt: l.createdAt, claimedAt: l.claimedAt, contactedAt: l.contactedAt, status: l.status, source: l.source, ownerId: l.claimedById ?? l.assignedToId })),
    proposals,
    payments: payments.flatMap((p) => (p.paidAt ? [{ amount: p.amount, paidAt: p.paidAt }] : [])),
    members: members.map((m) => ({ id: m.userId, name: m.user.name?.trim() || m.user.email?.split("@")[0] || "Teammate", role: m.role })),
    sources,
  });
  return { ...pulse, tz, capped: leads.length === CAP || proposals.length === CAP };
}

// ─────────────────────────────────────────────────────────────────────────────
// THE MONDAY REPORT
// ─────────────────────────────────────────────────────────────────────────────

const weeklyKey = (organizationId: string) => `pulse:weekly:${organizationId}`;

/** This Monday is this company's: exactly one of two overlapping runs wins. The row is moved to today first (one
 *  statement, so only one run can move it); it is made only for a company that never had one — a second try at
 *  making it loses on the key. */
async function claimWeek(organizationId: string, day: string): Promise<boolean> {
  const key = weeklyKey(organizationId);
  const moved = await db.syncState.updateMany({ where: { key, cursor: { not: day } }, data: { cursor: day } });
  if (moved.count === 1) return true;
  if (await db.syncState.findUnique({ where: { key }, select: { key: true } })) return false;
  return db.syncState.create({ data: { key, cursor: day } }).then(() => true).catch(() => false);
}

export interface WeeklyRun {
  /** Companies whose Monday morning it is and whose report had not gone yet (this run took them). */
  due: number;
  /** Mails that went. */
  sent: number;
  /** Companies left out because nothing happened last week. */
  quiet: number;
}

export async function runWeeklyReports(now = new Date()): Promise<WeeklyRun> {
  const out: WeeklyRun = { due: 0, sent: 0, quiet: 0 };
  const orgs = await db.organization.findMany({ where: { deletedAt: null }, select: { id: true, timezone: true } });
  const due = orgs.filter((o) => weeklyReportDue(now, o.timezone || FALLBACK_TZ));
  if (!due.length) return out;
  const base = await appBaseUrl();
  for (const o of due) {
    const tz = o.timezone || FALLBACK_TZ;
    try {
      if (await isTrialWriteLocked(o.id)) continue;
      // The pulse is Smart CRM — a paid feature (owner, 2026-11-09): on the Free plan no report is counted or sent.
      if (await isPageLocked(o.id, "smart-crm", { as: null })) continue;
      if (!(await claimWeek(o.id, dayKeyTz(now, tz)))) continue;
      out.due += 1;
      const pulse = await readPulse(o.id, { period: "last-week", now, tz });
      if (pulse.quiet) {
        out.quiet += 1;
        continue;
      }
      const org = await db.organization.findUnique({ where: { id: o.id }, select: { name: true, logoUrl: true, phone: true } });
      if (!org) continue;
      const doc = buildWeeklyReport({ org: { id: o.id, name: org.name, logoUrl: org.logoUrl, phone: org.phone }, pulse, href: `${base}/dashboard/crm?tab=office#pulse` });
      const r = await sendToMembersByPref(o.id, "weekly-report", doc, { roles: ["OWNER", "ADMIN"] });
      out.sent += r.sent;
    } catch (err) {
      console.warn(`[pulse] weekly …${o.id.slice(-4)}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return out;
}
