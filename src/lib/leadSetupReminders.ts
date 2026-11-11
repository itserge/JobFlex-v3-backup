import "server-only";
// THE LEAD SET-UP REMINDER (owner, 2026-10-07; cut to three on 2026-11-11) — server only, run by
// api/cron/lead-setup-reminders every morning. A shop from its first ten days that still lacks an address or
// specialties (lib/leadSetup) hears it from JobFlex at most three times: on day 1, day 3 and day 7 of its life. A
// shop found late gets the furthest letter that is due, never a backlog; nothing once both are set.
//
// Only a shop that is really on a plan: nothing when the subscription has ended or is set to end (the Free plan,
// lib/freePlan), when its plan has lapsed (lib/planStatus), when the owner unsubscribed from JobFlex's letters
// (lib/adminMail/optout) or the address is on the do-not-email list (lib/mailBlock). Every letter carries the
// Unsubscribe link, the one-click headers and JobFlex's postal address (lib/email/optOutFooter) — without that
// address (JOBFLEX_POSTAL_ADDRESS) nothing is sent.
//
// The record is one SyncState row per shop, `leadSetupReminder:<orgId>` = { count, lastAt } — `count` the letters
// counted so far (a row from the old daily reminder, up to 14, reads as done). A failed send never stops the sweep.
import { db } from "@/lib/db";
import { leadSetupNeedOf } from "@/lib/leadSetup";
import { buildLeadSetupReminder } from "@/lib/email/build/leadSetup";
import { renderEmail } from "@/lib/email/renderEmail";
import { orgNameUnsetKey } from "@/lib/orgName";
import { freeSwitchBooked, onFreePlan } from "@/lib/freePlan";
import { planLapsed } from "@/lib/planStatus";
import { readOptOut } from "@/lib/adminMail/optout";
import { readMailBlock } from "@/lib/mailBlock";
import { jobflexOptOut, withOptOut } from "@/lib/email/optOutFooter";

const PREFIX = "leadSetupReminder:";
const DAY_MS = 86_400_000;
/** The day of the shop's life each letter is due on. */
export const LEAD_SETUP_DAYS = [1, 3, 7] as const;
/** Shops younger than this are looked at (a missed cron still reaches day 7). */
const WINDOW_DAYS = 10;
const MIN_GAP_MS = 22 * 60 * 60 * 1000;

type SubRow = { status: string; canceledAt: Date | null; currentPeriodEnd: Date | null; trialEndsAt: Date | null; plan: string };

/** May a shop on this subscription hear the reminder at all? (Pure.) */
export function leadSetupMayMail(sub: SubRow | null | undefined, now: Date): boolean {
  if (!sub) return false;
  if (onFreePlan(sub) || freeSwitchBooked(sub) || planLapsed(sub, now)) return false;
  return sub.plan.toLowerCase() !== "free";
}

/** Which letter is due: the index into LEAD_SETUP_DAYS of the furthest one not yet counted, or null. (Pure.) */
export function leadSetupStageDue(ageDays: number, count: number): number | null {
  let due: number | null = null;
  LEAD_SETUP_DAYS.forEach((d, i) => {
    if (i >= count && ageDays >= d) due = i;
  });
  return due;
}

export async function runLeadSetupReminderSweep(now = new Date()): Promise<{ scanned: number; needing: number; sent: number; skipped: number; failed: number }> {
  const since = new Date(now.getTime() - WINDOW_DAYS * DAY_MS);
  const orgs = await db.organization.findMany({
    where: { createdAt: { gte: since } },
    select: {
      id: true, name: true, address: true, lat: true, lng: true, tradeTypesJson: true, createdAt: true,
      subscription: { select: { status: true, canceledAt: true, currentPeriodEnd: true, trialEndsAt: true, plan: true } },
      memberships: { where: { role: "OWNER" }, take: 1, select: { user: { select: { email: true, name: true } } } },
    },
    take: 2000,
  });
  const out = { scanned: orgs.length, needing: 0, sent: 0, skipped: 0, failed: 0 };
  const { appBaseUrl } = await import("@/lib/appUrl");
  const { sendEmail } = await import("@/lib/sdk/resend");
  const base = await appBaseUrl();
  // The passwordless sign-up's shops still named after their owner (lib/orgName).
  const unnamed = new Set(
    (await db.syncState.findMany({ where: { key: { in: orgs.map((o) => orgNameUnsetKey(o.id)) } }, select: { key: true } }).catch(() => [])).map((r) => r.key),
  );
  for (const org of orgs) {
    const need = leadSetupNeedOf(org, unnamed.has(orgNameUnsetKey(org.id)));
    if (!need.needs) continue;
    out.needing++;
    const to = org.memberships[0]?.user;
    if (!to?.email || !leadSetupMayMail(org.subscription, now)) { out.skipped++; continue; }
    const key = PREFIX + org.id;
    try {
      const row = await db.syncState.findUnique({ where: { key }, select: { cursor: true } });
      const rec = row?.cursor ? (JSON.parse(row.cursor) as { count?: number; lastAt?: string }) : {};
      const count = typeof rec.count === "number" ? rec.count : 0;
      const lastAt = typeof rec.lastAt === "string" ? Date.parse(rec.lastAt) : NaN;
      const stage = leadSetupStageDue(Math.floor((now.getTime() - org.createdAt.getTime()) / DAY_MS), count);
      if (stage === null || (Number.isFinite(lastAt) && now.getTime() - lastAt < MIN_GAP_MS)) { out.skipped++; continue; }
      if ((await readOptOut(org.id)) || (await readMailBlock(to.email))) { out.skipped++; continue; }
      const foot = jobflexOptOut(base, org.id, to.email, `You're getting this because ${org.name} signed up for JobFlex.`);
      if (!foot.postal) {
        out.skipped++;
        console.warn("[lead-setup] not sent: set JOBFLEX_POSTAL_ADDRESS — the email law asks for a postal address in this letter");
        continue;
      }
      const doc = withOptOut(
        buildLeadSetupReminder({ name: to.name, business: org.name, needsAddress: need.needsAddress, needsTrades: need.needsTrades, needsName: need.needsName, href: `${base}/dashboard/company${need.needsName ? "#company-name" : ""}`, nth: stage + 1 }),
        foot,
      );
      const { subject, html, text } = renderEmail(doc);
      const sent = await sendEmail({ mailClass: "marketing", to: to.email, subject, html, text, headers: foot.headers, organizationId: org.id });
      if (sent.skipped && sent.id.startsWith("mail-block")) { out.skipped++; continue; }
      const cursor = JSON.stringify({ count: stage + 1, lastAt: now.toISOString() });
      await db.syncState.upsert({ where: { key }, create: { key, cursor }, update: { cursor } });
      out.sent++;
    } catch (err) {
      out.failed++;
      console.warn("[lead-setup] reminder not sent:", org.id, err instanceof Error ? err.message : err);
    }
  }
  return out;
}
