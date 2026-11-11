// THE DAILY DIGEST (2026-10-04): at 8:00 AM Los Angeles the cron
// (/api/cron/traffic-digest) reads the analyst fresh, keeps the reading as
// that day's history row (SyncState analyst:<YYYY-MM-DD>, one per day) and
// emails it — Markdown and all — to SUPPORT_NOTIFY_EMAIL, else
// support@jobflex.app, unless an admin switched the email off. Idempotent: a
// day that has its row is left alone (a second run, a retry at 9:00), unless
// forced. Server only.

import { Prisma } from "@prisma/client";
import { db } from "./db";
import { buildTrafficDigest } from "./email/build/traffic";
import { renderEmail } from "./email/renderEmail";
import { sendEmail } from "./sdk/resend";
import { readAnalyst } from "./traffic-analyst-read";
import { analystToMarkdown } from "./traffic-export";
import { changesBetween, parseSnapshot, snapshotKey, type AnalystSnapshot } from "./traffic-history";
import { dateInZone, shiftDate } from "./traffic-query";
import { TRAFFIC_TZ } from "./traffic-visitor";

/** The admins' switch for the email: "on" | "off"; on unless switched off. */
export const DIGEST_EMAIL_KEY = "traffic-digest:email";
/** The local hours the cron may save in (8:00, and 9:00 as the retry). */
export const DIGEST_HOURS = [8, 9] as const;

export function digestRecipients(): string[] {
  return (process.env.SUPPORT_NOTIFY_EMAIL?.trim() || "support@jobflex.app").split(",").map((s) => s.trim()).filter(Boolean);
}
export async function digestEmailOn(): Promise<boolean> {
  const row = await db.syncState.findUnique({ where: { key: DIGEST_EMAIL_KEY } }).catch(() => null);
  return row?.cursor !== "off";
}
export async function setDigestEmail(on: boolean): Promise<void> {
  await db.syncState.upsert({ where: { key: DIGEST_EMAIL_KEY }, create: { key: DIGEST_EMAIL_KEY, cursor: on ? "on" : "off" }, update: { cursor: on ? "on" : "off" } });
}

/** The saved readings for these days (missing days are simply absent). */
export async function readSnapshots(days: readonly string[]): Promise<AnalystSnapshot[]> {
  if (!days.length) return [];
  const rows = await db.syncState.findMany({ where: { key: { in: days.map(snapshotKey) } }, select: { cursor: true } });
  return rows.map((r) => parseSnapshot(r.cursor)).filter((s): s is AnalystSnapshot => !!s);
}

/** The last saved reading before `day`, looking back up to two weeks. */
async function previousSnapshot(day: string): Promise<AnalystSnapshot | null> {
  const days = Array.from({ length: 14 }, (_, i) => shiftDate(day, -(i + 1)));
  const found = await readSnapshots(days);
  return found.sort((a, b) => b.day.localeCompare(a.day))[0] ?? null;
}

const localHour = (now: Date) => Number(new Intl.DateTimeFormat("en-US", { timeZone: TRAFFIC_TZ, hour: "numeric", hour12: false }).format(now)) % 24;

export interface DigestRun {
  status: "saved" | "already" | "not-now" | "failed";
  day: string;
  message?: string;
  email?: AnalystSnapshot["email"];
}

/** One day's digest. `hours` limits it to those local hours (the cron's
 *  guard: its UTC schedule covers both daylight-saving offsets); `force`
 *  rewrites the day's row and sends again. */
export async function runTrafficDigest(opts: { now?: Date; force?: boolean; hours?: readonly number[] | null; origin?: string } = {}): Promise<DigestRun> {
  const now = opts.now ?? new Date();
  const day = dateInZone(now, TRAFFIC_TZ);
  if (opts.hours && !opts.force && !opts.hours.includes(localHour(now))) return { status: "not-now", day, message: `Saves at ${opts.hours.map((h) => `${h}:00`).join(" or ")} Los Angeles.` };
  const key = snapshotKey(day);
  if (!opts.force && (await db.syncState.findUnique({ where: { key }, select: { key: true } }))) return { status: "already", day };

  const { result } = await readAnalyst({ timezone: TRAFFIC_TZ, force: true });
  if (result.status !== "ok" || result.stale) return { status: "failed", day, message: result.stale ? `PostHog unavailable: ${result.stale.reason}` : result.message };
  const snapshot: AnalystSnapshot = { day, savedAt: new Date().toISOString(), fetchedAt: result.fetchedAt, window: result.window, report: result.report, ...(result.money ? { money: result.money } : {}) };
  try {
    if (opts.force) await db.syncState.upsert({ where: { key }, create: { key, cursor: JSON.stringify(snapshot) }, update: { cursor: JSON.stringify(snapshot) } });
    else await db.syncState.create({ data: { key, cursor: JSON.stringify(snapshot) } });
  } catch (err) {
    // Two runs at once: the other one saved the day.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return { status: "already", day };
    throw err;
  }

  const to = digestRecipients();
  let email: AnalystSnapshot["email"];
  if (!(await digestEmailOn())) email = { to, skipped: "switched off" };
  else {
    try {
      const prev = await previousSnapshot(day);
      const doc = buildTrafficDigest({
        snapshot, changes: prev ? changesBetween(prev, snapshot) : null,
        markdown: analystToMarkdown({ ...result }, { timezone: TRAFFIC_TZ }),
        href: `${opts.origin ?? "https://www.jobflex.app"}/admin/traffic`, timezone: TRAFFIC_TZ,
      });
      const { subject, html } = renderEmail(doc);
      const sent = await sendEmail({ mailClass: "transactional", to, subject, html });
      email = sent.skipped && sent.id === "disabled" ? { to, skipped: "no email transport configured" } : { to, sentAt: new Date().toISOString() };
    } catch (err) {
      email = { to, error: err instanceof Error ? err.message.slice(0, 200) : "The email failed." };
    }
  }
  await db.syncState.update({ where: { key }, data: { cursor: JSON.stringify({ ...snapshot, email }) } }).catch(() => undefined);
  return { status: "saved", day, email };
}
