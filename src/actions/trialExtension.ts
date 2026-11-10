"use server";
// MORE TRIAL DAYS (owner, 2026-10-20) — the owner's ask from the cancel
// questions (screen C1 since 2026-11-09, lib/cancelTree)
// and the platform admin's decision in /admin/trial-requests. Every rule and
// every write is lib/trialExtensionServer; this file is the guards.
//   · requestTrialExtension — requireOwner (the cancel windows are the owner's).
//   · trialRequestUsage / approveTrialExtension / denyTrialExtension —
//     requirePlatformAdmin, the console's own guard.
import { z } from "zod";
import { requireOwner, requirePlatformAdmin } from "@/lib/orgContext";
import { db } from "@/lib/db";
import { DENY_REASON_MAX, NOTE_MAX, isExtensionDays } from "@/lib/trialExtension";
import { checkA1 } from "@/lib/cancelTree";
import {
  approveTrialRequest,
  askForTrialExtension,
  denyTrialRequest,
  trialUsage,
  type AskResult,
  type DecideResult,
  type TrialUsage,
} from "@/lib/trialExtensionServer";

const askInput = z.object({
  days: z.number().refine(isExtensionDays, "Pick 7 or 14 days."),
  note: z.string().trim().max(NOTE_MAX, `Keep it under ${NOTE_MAX} characters.`).optional().default(""),
});

export async function requestTrialExtension(raw: unknown): Promise<AskResult> {
  const { organizationId, user } = await requireOwner();
  const parsed = askInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  // What got in the way and what they want to try (screen B1): kept with the
  // request when it is whole, dropped (never a refused request) when it is not.
  const b1 = checkA1((raw as { answers?: unknown } | null)?.answers);
  return askForTrialExtension({ organizationId, userId: user.id, days: parsed.data.days, note: parsed.data.note || null, answers: b1.ok ? b1.value : null });
}

export async function trialRequestUsage(requestId: unknown): Promise<TrialUsage | null> {
  await requirePlatformAdmin();
  if (typeof requestId !== "string" || !requestId) return null;
  const req = await db.trialExtensionRequest.findUnique({ where: { id: requestId } });
  if (!req) return null;
  const sub = await db.subscription.findUnique({ where: { organizationId: req.organizationId }, select: { createdAt: true } });
  const start = req.trialStartedAt ?? sub?.createdAt ?? req.createdAt;
  return trialUsage(req.organizationId, { start, end: req.trialEndsAt });
}

const decideInput = z.object({ id: z.string().min(1) });

export async function approveTrialExtension(raw: unknown): Promise<DecideResult> {
  const admin = await requirePlatformAdmin();
  const parsed = decideInput.extend({ days: z.number().refine(isExtensionDays, "Pick 7 or 14 days.") }).safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  return approveTrialRequest(parsed.data.id, parsed.data.days, admin);
}

export async function denyTrialExtension(raw: unknown): Promise<DecideResult> {
  const admin = await requirePlatformAdmin();
  const parsed = decideInput
    .extend({ reason: z.string().trim().min(3, "Give a short reason — the owner reads it.").max(DENY_REASON_MAX, `Keep the reason under ${DENY_REASON_MAX} characters.`) })
    .safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  return denyTrialRequest(parsed.data.id, parsed.data.reason, admin);
}
