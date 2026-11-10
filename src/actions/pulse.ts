"use server";
// THE COMPANY PULSE'S ACTION (Smart CRM part 7, 2026-11-10): the Office sheet's scorecard asks for a period when
// it scrolls into view and when the period is switched. Managers and up — the same people who see the Office sheet.

import { db } from "@/lib/db";
import { requireManager } from "@/lib/orgContext";
import { readPulse, type PulseRead } from "@/lib/pulse/server";
import { isPulsePeriod } from "@/lib/pulse/shared";
import { viewerTimeZone } from "@/lib/viewerTz";

export type PulseAnswer = { ok: true; pulse: PulseRead } | { ok: false; error: string };

export async function getCompanyPulse(period?: unknown): Promise<PulseAnswer> {
  let organizationId: string;
  try {
    ({ organizationId } = await requireManager());
  } catch {
    return { ok: false, error: "The company pulse is for the office." };
  }
  try {
    const org = await db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } });
    // The viewer's own clock, as the rest of the sheet uses: "this week" starts on their Monday.
    const tz = await viewerTimeZone(org?.timezone);
    return { ok: true, pulse: await readPulse(organizationId, { period: isPulsePeriod(period) ? period : undefined, tz }) };
  } catch (err) {
    console.warn("[pulse] read failed:", err instanceof Error ? err.message : err);
    return { ok: false, error: "Couldn't count the numbers. Try again." };
  }
}
