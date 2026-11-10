import "server-only";
// "PAUSED ON FREE" FOR THE OWNER, NEVER FOR THE CUSTOMER (owner, 2026-11-09). A paid feature that runs with no page —
// SmartBook answering a lead's text, the cron's next step, the AI Operator's alerts — stays quiet on the Free plan:
// nothing is sent to the customer, no half-answer, no error to Twilio. What was held back is logged, and the company
// hears it once a day per feature on its bell ("SmartBook is paused on the Free plan — …").
import { db } from "@/lib/db";
import { logActivity } from "@/lib/activityLog";
import { PAID_FEATURES, type PaidFeatureId } from "@/lib/customPlan";

/** The bell's kind for it (not a trail kind, so it rings). */
export const PLAN_PAUSED_KIND = "PLAN_PAUSED";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Log what a paused feature held back; ring the company's bell at most once a day per feature. Never throws. */
export async function notePausedOnFree(organizationId: string, feature: PaidFeatureId, what: string, now = new Date()): Promise<void> {
  try {
    console.info(`[paused-on-free] ${feature} · ${organizationId} · ${what}`);
    const key = `pausedNotice:${feature}:${organizationId}`;
    const row = await db.syncState.findUnique({ where: { key }, select: { cursor: true } });
    if (row && now.getTime() - Date.parse(row.cursor) < DAY_MS) return;
    await db.syncState.upsert({ where: { key }, create: { key, cursor: now.toISOString() }, update: { cursor: now.toISOString() } });
    const label = PAID_FEATURES.find((f) => f.id === feature)?.label ?? "This feature";
    await logActivity({
      organizationId,
      actorId: null,
      kind: PLAN_PAUSED_KIND,
      summary: `${label} is paused on the Free plan — ${what}. Choose a plan on Subscription to turn it back on.`,
      meta: { feature },
    });
  } catch {
    /* a notice never fails the caller */
  }
}
