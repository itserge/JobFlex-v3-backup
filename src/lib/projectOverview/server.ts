import "server-only";
// THE OVERVIEW'S "NOT NOW" (2026-11-09): the rows one person hid on one project, kept as JSON in SyncState under the
// person and the project (no schema change, like the Operator's switches in lib/assistant/prefs). Read by the
// project page for the signed-in person; written by the card's "Not now".
import { db } from "@/lib/db";
import { parseSnoozes, snoozeUntil, type OvTone, type Snoozes } from "./shared";

const keyOf = (organizationId: string, userId: string, projectId: string) => `overview:snooze:${organizationId}:${userId}:${projectId}`;

/** Today on the company's clock (ISO day). */
export async function companyToday(organizationId: string): Promise<string> {
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } });
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: org?.timezone || "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export async function readSnoozes(organizationId: string, userId: string, projectId: string): Promise<Snoozes> {
  const [row, today] = await Promise.all([db.syncState.findUnique({ where: { key: keyOf(organizationId, userId, projectId) } }), companyToday(organizationId)]);
  return parseSnoozes(row?.cursor, today);
}

/** Hide one row for SNOOZE_DAYS; the expired ones are dropped as it is written. */
export async function snooze(organizationId: string, userId: string, projectId: string, itemKey: string, tone: OvTone): Promise<Snoozes> {
  const key = keyOf(organizationId, userId, projectId);
  const [row, today] = await Promise.all([db.syncState.findUnique({ where: { key } }), companyToday(organizationId)]);
  const next: Snoozes = { ...parseSnoozes(row?.cursor, today), [itemKey.slice(0, 120)]: { until: snoozeUntil(today), tone } };
  const cursor = JSON.stringify(next);
  await db.syncState.upsert({ where: { key }, create: { key, cursor }, update: { cursor } });
  return next;
}

/** Bring every hidden row back. */
export async function clearSnoozes(organizationId: string, userId: string, projectId: string): Promise<void> {
  await db.syncState.deleteMany({ where: { key: keyOf(organizationId, userId, projectId) } });
}
