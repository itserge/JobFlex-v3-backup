import "server-only";
// THE LEAD FOLLOW-UP SWEEP (owner, 2026-11-07, after lead #LD-7AFU sat accepted with nothing sent: "make a reminder to
// the contractor to create the proposal and send it, or contact the client"). Run every hour by api/cron/follow-ups.
//
// For every Lead Center lead a shop accepted in the last three weeks and has not quoted, won or lost:
//   · contact   — a day in, no sign of contact (no visit, no call / note / email / text logged, the lead still CLAIMED):
//                 "call them or send the proposal";
//   · proposal  — three days in, or a day after the visit, no proposal sent: "send the proposal";
//   · final     — a week in, still no proposal: the last one.
// Each stage goes once — the record is one SyncState row per lead, `leadNudge:<leadId>` = { contact, proposal, final }
// (ISO times) — by email to the office (the "lead-assigned" preference, like the offer itself) and by text to the
// owner and whoever claimed the lead, during the company's own daytime (8 AM – 7 PM in its time zone). A proposal
// sent to the homeowner (the shop's client with their email or phone, not a draft, made after the claim) ends it.

import { db } from "@/lib/db";
import { appBaseUrl } from "@/lib/appUrl";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { buildLeadFollowUp, leadFollowUpLine, type LeadFollowUpStage } from "@/lib/email/build/leadFollowUp";
import { sendToMembersByPref } from "@/lib/notificationPrefs";
import { textOffice } from "@/lib/sms/send";

const PREFIX = "leadNudge:";
const HOUR = 3_600_000;
const CONTACT_AFTER_MS = 24 * HOUR;
const PROPOSAL_AFTER_MS = 72 * HOUR;
const AFTER_VISIT_MS = 24 * HOUR;
const FINAL_AFTER_MS = 7 * 24 * HOUR;
const WINDOW_MS = 21 * 24 * HOUR;
/** The company's own daytime: a nudge never lands at 3 AM. */
const DAY_FROM = 8;
const DAY_TO = 19;
/** What counts as the shop having reached out: anything logged on the lead after the claim. */
const CONTACT_KINDS = ["CALL", "EMAIL", "SMS", "NOTE", "SCHEDULED", "SENT"];

type NudgeRecord = Partial<Record<LeadFollowUpStage, string>>;

function localHour(d: Date, tz: string): number {
  try {
    return Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(d));
  } catch {
    return d.getUTCHours();
  }
}

const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "").slice(-10);

export type LeadFollowUpResult = { scanned: number; nudged: number; later: number; done: number; failed: number };

export async function runLeadFollowUpSweep(now = new Date()): Promise<LeadFollowUpResult> {
  const out: LeadFollowUpResult = { scanned: 0, nudged: 0, later: 0, done: 0, failed: 0 };
  const leads = await db.lead.findMany({
    where: {
      source: "LEAD_CENTER",
      status: { in: ["CLAIMED", "CONTACTED"] },
      claimedAt: { gte: new Date(now.getTime() - WINDOW_MS), lte: new Date(now.getTime() - CONTACT_AFTER_MS) },
      organization: { deletedAt: null },
    },
    select: { id: true, organizationId: true, name: true, phone: true, email: true, projectType: true, aiCategory: true, city: true, state: true, status: true, claimedAt: true, contactedAt: true, claimedById: true, organization: { select: { timezone: true } } },
    take: 500,
  });
  out.scanned = leads.length;
  if (!leads.length) return out;
  const base = await appBaseUrl();

  for (const lead of leads) {
    const claimedAt = lead.claimedAt!;
    const age = now.getTime() - claimedAt.getTime();
    const tz = lead.organization.timezone || "America/New_York";
    const hour = localHour(now, tz);
    try {
      const row = await db.syncState.findUnique({ where: { key: PREFIX + lead.id }, select: { cursor: true } });
      const rec: NudgeRecord = row?.cursor ? (JSON.parse(row.cursor) as NudgeRecord) : {};

      // The shop's client for this homeowner, and any proposal sent to them since the claim.
      const email = lead.email?.trim().toLowerCase() || null;
      const phone = digits(lead.phone);
      const clients = await db.client.findMany({
        where: { organizationId: lead.organizationId, OR: [...(email ? [{ email: { in: [email, lead.email!.trim()] } }] : []), ...(phone.length >= 7 ? [{ phone: { contains: phone.slice(-7) } }] : [])] },
        select: { id: true },
      });
      const [proposalSent, visit, touched] = await Promise.all([
        clients.length ? db.proposal.count({ where: { organizationId: lead.organizationId, clientId: { in: clients.map((c) => c.id) }, status: { not: "DRAFT" }, createdAt: { gte: claimedAt } } }) : Promise.resolve(0),
        db.appointment.findFirst({ where: { leadId: lead.id, status: { not: "CANCELED" } }, orderBy: { startsAt: "desc" }, select: { startsAt: true, endsAt: true } }),
        db.activityEvent.count({ where: { leadId: lead.id, kind: { in: CONTACT_KINDS }, createdAt: { gt: new Date(claimedAt.getTime() + 60_000) } } }),
      ]);
      if (proposalSent > 0) {
        out.done++;
        continue;
      }
      const contacted = lead.status === "CONTACTED" || !!lead.contactedAt || !!visit || touched > 0;
      const visitOver = !!visit && visit.endsAt.getTime() < now.getTime() - AFTER_VISIT_MS;

      let stage: LeadFollowUpStage | null = null;
      if (!contacted && !rec.contact && age >= CONTACT_AFTER_MS) stage = "contact";
      else if (!rec.proposal && (age >= PROPOSAL_AFTER_MS || visitOver)) stage = "proposal";
      else if (!rec.final && age >= FINAL_AFTER_MS) stage = "final";
      if (!stage) continue;
      if (hour < DAY_FROM || hour >= DAY_TO) {
        out.later++;
        continue;
      }

      const project = lead.projectType || lead.aiCategory || "project";
      const where = [lead.city, lead.state].filter(Boolean).join(", ") || "their area";
      const input = {
        stage,
        homeowner: lead.name,
        phone: lead.phone,
        email: lead.email,
        project: project.charAt(0).toUpperCase() + project.slice(1),
        where,
        acceptedAt: claimedAt,
        daysSince: Math.max(1, Math.round(age / (24 * HOUR))),
        visitAt: visit?.startsAt ?? null,
        href: `${base}/dashboard/leads/${lead.id}`,
      };
      await sendToMembersByPref(lead.organizationId, "lead-assigned", buildLeadFollowUp(input), { now });
      await textOffice(lead.organizationId, "lead-assigned", leadFollowUpLine(input), { roles: ["OWNER"], alsoUserIds: lead.claimedById ? [lead.claimedById] : [], now }).catch(() => null);
      rec[stage] = now.toISOString();
      const cursor = JSON.stringify(rec);
      await db.syncState.upsert({ where: { key: PREFIX + lead.id }, create: { key: PREFIX + lead.id, cursor }, update: { cursor } });
      await logActivity({
        organizationId: lead.organizationId,
        actorId: null,
        kind: TRAIL_KINDS.FOLLOW_UP,
        leadId: lead.id,
        summary: stage === "contact" ? `Reminder sent: ${lead.name} has not been contacted since the lead was accepted` : stage === "proposal" ? `Reminder sent: no proposal to ${lead.name} yet` : `Last reminder sent: a week with no proposal to ${lead.name}`,
        meta: { leadId: lead.id, nudge: stage },
      });
      out.nudged++;
    } catch (err) {
      out.failed++;
      console.warn("[lead-follow-ups] not sent:", lead.id, err instanceof Error ? err.message : err);
    }
  }
  return out;
}

/** The reminders sent on these leads, for the admin's sheet: how many, and the last one. */
export async function leadNudgesFor(leadIds: readonly string[]): Promise<Map<string, { count: number; lastAt: string | null; stage: LeadFollowUpStage | null }>> {
  const out = new Map<string, { count: number; lastAt: string | null; stage: LeadFollowUpStage | null }>();
  if (!leadIds.length) return out;
  const rows = await db.syncState.findMany({ where: { key: { in: leadIds.map((id) => PREFIX + id) } }, select: { key: true, cursor: true } }).catch(() => []);
  for (const r of rows) {
    try {
      const rec = JSON.parse(r.cursor) as NudgeRecord;
      const stages = (["contact", "proposal", "final"] as const).filter((s) => rec[s]);
      const last = stages[stages.length - 1] ?? null;
      out.set(r.key.slice(PREFIX.length), { count: stages.length, lastAt: last ? rec[last]! : null, stage: last });
    } catch {
      /* an unreadable row counts as none */
    }
  }
  return out;
}
