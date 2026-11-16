import "server-only";

// ROOF TRACE · SAVED (2026-11-16) — one hand-traced drawing per roof measurement, kept in SyncState under
// `roofTrace:<measurementId>` (the trace as JSON in `cursor`), so no table is added for an admin-only test. The
// callers check who is asking (requirePlatformAdmin); nothing here does.

import { db } from "@/lib/db";
import { cleanTrace, type RoofTrace, type RoofTraceBody } from "./trace";

export const ROOF_TRACE_PREFIX = "roofTrace:";
const keyOf = (measurementId: string) => `${ROOF_TRACE_PREFIX}${measurementId}`;

/** The saved trace of a measurement, or null (none saved, or what is saved no longer reads as a drawing). */
export async function loadRoofTrace(measurementId: string): Promise<RoofTrace | null> {
  const row = await db.syncState.findUnique({ where: { key: keyOf(measurementId) }, select: { cursor: true } });
  if (!row) return null;
  try {
    const raw = JSON.parse(row.cursor) as Partial<RoofTrace>;
    const cleaned = cleanTrace(raw);
    if (!cleaned.ok || !cleaned.body.lines.length) return null;
    return { v: 1, ...cleaned.body, savedAt: typeof raw.savedAt === "string" ? raw.savedAt : new Date(0).toISOString(), savedBy: typeof raw.savedBy === "string" ? raw.savedBy : null };
  } catch {
    return null;
  }
}

export async function saveRoofTrace(measurementId: string, body: RoofTraceBody, savedBy: string | null): Promise<RoofTrace> {
  const trace: RoofTrace = { v: 1, ...body, savedAt: new Date().toISOString(), savedBy };
  const cursor = JSON.stringify(trace);
  await db.syncState.upsert({ where: { key: keyOf(measurementId) }, create: { key: keyOf(measurementId), cursor }, update: { cursor } });
  return trace;
}

export async function clearRoofTrace(measurementId: string): Promise<void> {
  await db.syncState.deleteMany({ where: { key: keyOf(measurementId) } });
}
