"use server";

// ADMIN · ROOF TRACE — read, save and clear the hand-traced roof lines of one measurement (2026-11-16, owner: "for
// admin only"). Platform admins only, like the roof lab and the estimator's roof diagram card these sit behind.

import { db } from "@/lib/db";
import { requirePlatformAdmin } from "@/lib/orgContext";
import { clearRoofTrace, loadRoofTrace, saveRoofTrace } from "@/lib/roofTrace/server";
import { cleanTrace, type RoofTrace } from "@/lib/roofTrace/trace";

type Fail = { ok: false; error: string };
const badId = (id: unknown) => typeof id !== "string" || !id || id.length > 64;

export async function getRoofTrace(measurementId: string): Promise<{ ok: true; trace: RoofTrace | null } | Fail> {
  await requirePlatformAdmin();
  if (badId(measurementId)) return { ok: false, error: "Pick a roof first." };
  try {
    return { ok: true, trace: await loadRoofTrace(measurementId) };
  } catch (err) {
    console.error("[roof-trace] read failed:", err);
    return { ok: false, error: "The saved drawing could not be read just now. Try again." };
  }
}

export async function saveRoofTraceAction(measurementId: string, drawing: unknown): Promise<{ ok: true; trace: RoofTrace } | Fail> {
  const admin = await requirePlatformAdmin();
  if (badId(measurementId)) return { ok: false, error: "Pick a roof first." };
  const cleaned = cleanTrace(drawing);
  if (!cleaned.ok) return { ok: false, error: cleaned.reason };
  if (!cleaned.body.lines.length) return { ok: false, error: "There are no lines to save. Draw at least one, or use Clear to remove the saved drawing." };
  try {
    const exists = await db.roofMeasurement.findUnique({ where: { id: measurementId }, select: { id: true } });
    if (!exists) return { ok: false, error: "That roof measurement is not on file." };
    const by = (admin as { email?: string | null; name?: string | null }).name || (admin as { email?: string | null }).email || null;
    return { ok: true, trace: await saveRoofTrace(measurementId, cleaned.body, by) };
  } catch (err) {
    console.error("[roof-trace] save failed:", err);
    return { ok: false, error: "The drawing could not be saved just now. Your lines are still here — try Save again." };
  }
}

export async function clearRoofTraceAction(measurementId: string): Promise<{ ok: true } | Fail> {
  await requirePlatformAdmin();
  if (badId(measurementId)) return { ok: false, error: "Pick a roof first." };
  try {
    await clearRoofTrace(measurementId);
    return { ok: true };
  } catch (err) {
    console.error("[roof-trace] clear failed:", err);
    return { ok: false, error: "The saved drawing could not be removed just now. Try again." };
  }
}
