// A CEILING ON CARD-LESS TRIALS PER DAY (owner, 2026-10-02) — server only.
//
// The per-person brakes (lib/trialGuard: per IP, per mailbox, per company
// domain, a confirmed address, no throwaway inbox) stop one person taking the
// trial twice. They do not stop a hundred people — or one script with a
// hundred mailboxes — taking it once each. So at most CARDLESS_TRIALS_PER_DAY
// card-less trials start in any 24 hours (default 100). Past it the signup
// goes on as before, but the trial asks for a card: the plan step opens
// Stripe Checkout (the TRIAL_REQUIRES_CARD flow) for the rest of the window.
// When the count crosses 80% of the ceiling, support hears about it once.
//
// THE COUNT is one SyncState row per started trial, `trial-start:<orgId>`,
// written when the confirmation link creates the account and never changed;
// the window is the last 24 hours of those rows (updatedAt is their birth).
import { db } from "@/lib/db";

const DAY_MS = 24 * 60 * 60 * 1000;
const START_PREFIX = "trial-start:";
const ALERT_KEY = "trial-daily-alert";
/** The share of the ceiling at which support is told. */
export const TRIAL_ALERT_SHARE = 0.8;
/** Where the alert goes when SUPPORT_NOTIFY_EMAIL is not set. */
const SUPPORT_FALLBACK = "support@jobflex.app";

/** CARDLESS_TRIALS_PER_DAY, default 100; 0 pauses card-less trials outright. */
export function cardlessTrialsPerDay(): number {
  const raw = process.env.CARDLESS_TRIALS_PER_DAY?.trim();
  if (!raw) return 100;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 100;
}

/** Card-less trials started in the last 24 hours. */
export async function cardlessStartsInLastDay(now = new Date()): Promise<number> {
  return db.syncState
    .count({ where: { key: { startsWith: START_PREFIX }, updatedAt: { gte: new Date(now.getTime() - DAY_MS) } } })
    .catch(() => 0);
}

/** The ceiling's rule, given the count: 0 pauses outright. */
export function cardlessCeilingReached(startsLastDay: number, perDay = cardlessTrialsPerDay()): boolean {
  return perDay === 0 || startsLastDay >= perDay;
}

/** True when the 24-hour ceiling is reached: new trials take a card. */
export async function cardlessTrialsPaused(now = new Date()): Promise<boolean> {
  const cap = cardlessTrialsPerDay();
  if (cap === 0) return true;
  return cardlessCeilingReached(await cardlessStartsInLastDay(now), cap);
}

/** What the plan step says when the ceiling sends a signup to the card. */
export const TRIALS_PAUSED_MESSAGE =
  "Free trials without a card are full for today. Your trial still starts free — it just needs a card on file, and nothing is charged until it ends.";

/**
 * Count a trial that has just started, and tell support the first time in a
 * day the count reaches 80% of the ceiling. Never throws — a started trial is
 * never undone by its bookkeeping.
 */
export async function noteCardlessTrialStarted(orgId: string, now = new Date()): Promise<{ count: number; alerted: boolean }> {
  try {
    await db.syncState.upsert({ where: { key: START_PREFIX + orgId }, update: {}, create: { key: START_PREFIX + orgId, cursor: now.toISOString() } });
  } catch (err) {
    console.warn("[trial-daily] start not counted:", err);
  }
  const count = await cardlessStartsInLastDay(now);
  const cap = cardlessTrialsPerDay();
  const alerted = cap > 0 && count >= Math.ceil(cap * TRIAL_ALERT_SHARE) ? await alertSupportOnce(count, cap, now) : false;
  return { count, alerted };
}

/** One email per 24 hours: the stamp is taken with a compare-and-swap, so two
 *  trials crossing the line together send one. */
async function alertSupportOnce(count: number, cap: number, now: Date): Promise<boolean> {
  try {
    const row = await db.syncState.findUnique({ where: { key: ALERT_KEY } });
    const last = row ? Date.parse(row.cursor) : NaN;
    if (Number.isFinite(last) && now.getTime() - last < DAY_MS) return false;
    const stamp = now.toISOString();
    if (row) {
      const { count: won } = await db.syncState.updateMany({ where: { key: ALERT_KEY, cursor: row.cursor }, data: { cursor: stamp } });
      if (won !== 1) return false;
    } else {
      try {
        await db.syncState.create({ data: { key: ALERT_KEY, cursor: stamp } });
      } catch {
        return false; // another instance took it first
      }
    }
    const to = (process.env.SUPPORT_NOTIFY_EMAIL?.trim() || SUPPORT_FALLBACK)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const { sendEmail } = await import("@/lib/sdk/resend");
    const pct = Math.round((count / cap) * 100);
    await sendEmail({ mailClass: "transactional",
      to,
      subject: `JobFlex — ${count} of ${cap} card-less trials used in the last 24 hours`,
      html:
        `<p>${count} card-less trials have started in the last 24 hours — ${pct}% of today's ceiling of ${cap} (CARDLESS_TRIALS_PER_DAY).</p>` +
        `<p>At ${cap} the signup keeps working, but the trial asks for a card until the 24-hour count drops below the ceiling again.</p>` +
        `<p style="color:#555">If this is a campaign working, raise CARDLESS_TRIALS_PER_DAY. If it is not, Admin → Trials shows who signed up and what their trials have cost.</p>`,
    });
    return true;
  } catch (err) {
    console.warn("[trial-daily] support alert failed:", err);
    return false;
  }
}
