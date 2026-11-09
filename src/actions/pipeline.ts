"use server";
// THE PIPELINE'S ACTIONS (Smart CRM part 3, 2026-11-08): move a card, set its owner or expected close, and the
// monthly spend per source the report divides by. Thin over lib/pipeline — the Operator runs the same cores.

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireManager, requireSalesOrManager } from "@/lib/orgContext";
import { db } from "@/lib/db";
import { cardRefusal, moveDeal, setDealDetails, setSpend } from "@/lib/pipeline/server";
import { STAGE_KEYS, type Stage } from "@/lib/pipeline/shared";

const moveInput = z.object({ key: z.string().regex(/^(lead|proposal):[A-Za-z0-9_-]+$/), stage: z.enum(STAGE_KEYS as unknown as [Stage, ...Stage[]]), lostReason: z.string().max(200).nullable().optional() });

export async function moveDealCard(raw: unknown): Promise<{ ok: boolean; error?: string }> {
  const { organizationId, user, role } = await requireSalesOrManager();
  const input = moveInput.parse(raw);
  // A rep moves their own proposals and their own or unclaimed leads; a manager any card.
  const no = await cardRefusal(organizationId, input.key, { userId: user.id, role });
  if (no) return { ok: false, error: no };
  const r = await moveDeal(organizationId, input.key, input.stage, user.id, input.lostReason ?? null);
  revalidatePath("/dashboard/pipeline");
  return r;
}

const detailInput = z.object({
  key: z.string().regex(/^(lead|proposal):[A-Za-z0-9_-]+$/),
  ownerId: z.string().max(64).nullable().optional(),
  expectedClose: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

export async function setDealCardDetails(raw: unknown): Promise<{ ok: boolean; error?: string }> {
  const { organizationId, user, role } = await requireSalesOrManager();
  const input = detailInput.parse(raw);
  const no = await cardRefusal(organizationId, input.key, { userId: user.id, role });
  if (no) return { ok: false, error: no };
  if (input.ownerId) {
    const m = await db.membership.findFirst({ where: { organizationId, userId: input.ownerId }, select: { userId: true } });
    if (!m) return { ok: false };
  }
  await setDealDetails(organizationId, input.key, {
    ...(input.ownerId !== undefined ? { ownerId: input.ownerId } : {}),
    ...(input.expectedClose !== undefined ? { expectedClose: input.expectedClose ? new Date(`${input.expectedClose}T17:00:00`) : null } : {}),
  });
  revalidatePath("/dashboard/pipeline");
  return { ok: true };
}

// The source report is the company's money by source — the office's, never a limited role's (the page hides it too).
export async function setSourceSpend(sourceKey: string, monthly: number | null): Promise<{ ok: boolean }> {
  const { organizationId } = await requireManager();
  await setSpend(organizationId, String(sourceKey).slice(0, 40), monthly === null ? null : Number(monthly));
  revalidatePath("/dashboard/pipeline");
  return { ok: true };
}
