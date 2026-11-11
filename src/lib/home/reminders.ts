// PLAN REMINDERS (2026-10-03) — server only. The time the homeowner chose
// for a plan has come (lib/home/dates reminderFor): one email, "ready? submit
// it", with the intake prefilled from the plan; if nothing happens, one
// follow-up two weeks later, then quiet. `remindAt` is the next send,
// `remindedAt` the last one — a row is due when remindAt has passed and is
// later than remindedAt. From the daily cron (/api/cron/home-plans); a moved
// plan starts over.
//
// 2026-11-11: each reminder carries the Unsubscribe link, the one-click headers and JobFlex's postal address
// (lib/email/optOutFooter, account `home_<id>`); a homeowner who unsubscribed (mailOptOut `home_<id>`) or whose
// address is on the do-not-email list (lib/mailBlock) gets none, and the plan stays quiet.
import { db } from "@/lib/db";
import { appBaseUrl } from "@/lib/appUrl";
import { sendEmail } from "@/lib/sdk/resend";
import { renderEmail } from "@/lib/email/renderEmail";
import { buildHomePlanReminder } from "@/lib/email/build/platform";
import { homeUrl } from "./portal";
import { readOptOut } from "@/lib/adminMail/optout";
import { jobflexOptOut, withOptOut } from "@/lib/email/optOutFooter";
import { FOLLOW_UP_MS, planWhen } from "./dates";
import { parsePlanEstimate, planNudgesOnce, planRangeWords } from "@/lib/leadCenter/estimate";

export async function sendPlanReminders(now = new Date()): Promise<{ reminded: number; failed: number }> {
  const rows = await db.homePlan.findMany({
    where: { status: "PLANNED", remindAt: { lte: now } },
    orderBy: { remindAt: "asc" },
    take: 300,
    include: { home: { select: { id: true, name: true, email: true, accessToken: true } } },
  });
  const due = rows.filter((p) => p.remindAt && (!p.remindedAt || p.remindedAt.getTime() < p.remindAt.getTime()));
  let reminded = 0;
  let failed = 0;
  const appUrl = await appBaseUrl();
  for (const plan of due) {
    const followUp = Boolean(plan.remindedAt);
    // Claimed first: an overlapping run never sends the same reminder twice.
    // The first reminder books the follow-up; the follow-up ends the series.
    const claimed = await db.homePlan.updateMany({
      where: { id: plan.id, remindAt: plan.remindAt, ...(plan.remindedAt ? { remindedAt: plan.remindedAt } : { remindedAt: null }) },
      // A saved range (2026-10-27) is nudged once: its two-day note, no follow-up.
      data: { remindedAt: now, remindAt: followUp || planNudgesOnce(plan.notes) ? null : new Date(now.getTime() + FOLLOW_UP_MS) },
    });
    if (claimed.count === 0) continue;
    if (await readOptOut(`home_${plan.home.id}`)) continue;
    try {
      const url = await homeUrl(plan.home.accessToken);
      const daysAway = Math.round((plan.plannedFor.getTime() - now.getTime()) / (24 * 60 * 60_000));
      const foot = jobflexOptOut(appUrl, `home_${plan.home.id}`, plan.home.email, "You're getting this because you asked JobFlex to remind you about this project.");
      const { subject, html, text } = renderEmail(
        withOptOut(buildHomePlanReminder({
          name: plan.home.name,
          title: plan.title,
          when: planWhen(plan.plannedFor, plan.wholeMonth),
          daysAway: daysAway > 0 ? daysAway : 0,
          followUp,
          // A range saved in the portal (2026-10-27): its words, and "Get quotes" picks the flow up at the form.
          notes: parsePlanEstimate(plan.notes) ? planRangeWords(parsePlanEstimate(plan.notes)!) : plan.notes,
          submitUrl: parsePlanEstimate(plan.notes)
            ? `${appUrl}/homeowner/price/roof?home=${encodeURIComponent(plan.home.accessToken)}&plan=${encodeURIComponent(plan.id)}`
            : `${appUrl}/homeowner?home=${encodeURIComponent(plan.home.accessToken)}&plan=${encodeURIComponent(plan.id)}`,
          homeUrl: url,
        }), foot),
      );
      const left = await sendEmail({ to: plan.home.email, subject, html, text, headers: foot.headers });
      if (!(left.skipped && left.id.startsWith("mail-block"))) reminded += 1;
    } catch (err) {
      failed += 1;
      console.error(`[home] plan reminder ${plan.id} failed:`, err instanceof Error ? err.message : err);
    }
  }
  return { reminded, failed };
}
