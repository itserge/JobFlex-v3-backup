"use server";
// THE CLIENT'S PAGE, PART 1 OF THE SMART CRM (2026-11-08): rebuild the brief, correct the memory, keep a promise
// by hand, and fold a duplicate record in. Thin over lib/clientMemory and lib/clientMerge — the AI Operator's tools
// run the same cores.

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSalesOrManager } from "@/lib/orgContext";
import { db } from "@/lib/db";
import { readClientTimeline } from "@/lib/clientTimeline/server";
import { addClientFact, rebuildClientBrief, retractClientFact } from "@/lib/clientMemory";
import { FACT_CATEGORIES } from "@/lib/clientTimeline/shared";
import { mergeClients } from "@/lib/clientMerge";

async function clientOf(organizationId: string, id: string) {
  const client = await db.client.findUnique({ where: { id }, select: { id: true, organizationId: true, name: true, email: true, phone: true, deletedAt: true } });
  if (!client || client.organizationId !== organizationId || client.deletedAt) throw new Error("Client not found");
  return client;
}

/** Rebuild "where they stand" now (the page's refresh button; the page itself rebuilds only when stale). */
export async function rebuildBriefNow(clientId: string): Promise<{ ok: boolean }> {
  const { organizationId } = await requireSalesOrManager();
  const client = await clientOf(organizationId, String(clientId));
  const timeline = await readClientTimeline(client);
  const brief = await rebuildClientBrief(client, timeline);
  revalidatePath("/dashboard/client-detail");
  return { ok: brief !== null };
}

const factInput = z.object({ clientId: z.string().min(1), category: z.enum(FACT_CATEGORIES), fact: z.string().min(3).max(180) });

export async function addFact(raw: unknown): Promise<{ ok: boolean }> {
  const { organizationId } = await requireSalesOrManager();
  const input = factInput.parse(raw);
  await clientOf(organizationId, input.clientId);
  await addClientFact(organizationId, input.clientId, input.category, input.fact);
  revalidatePath("/dashboard/client-detail");
  return { ok: true };
}

export async function removeFact(factId: string): Promise<{ ok: boolean }> {
  const { organizationId } = await requireSalesOrManager();
  const ok = await retractClientFact(organizationId, String(factId));
  revalidatePath("/dashboard/client-detail");
  return { ok };
}

const promiseInput = z.object({
  clientId: z.string().min(1),
  text: z.string().min(3).max(240),
  direction: z.enum(["OURS", "THEIRS"]).default("OURS"),
  dueAt: z.string().datetime().nullable().optional(),
});

export async function addPromise(raw: unknown): Promise<{ ok: boolean }> {
  const { organizationId, user } = await requireSalesOrManager();
  const input = promiseInput.parse(raw);
  await clientOf(organizationId, input.clientId);
  const { addPromise: add } = await import("@/lib/promises/server");
  await add({ organizationId, clientId: input.clientId, text: input.text, direction: input.direction, dueAt: input.dueAt ? new Date(input.dueAt) : null, userId: user.id });
  revalidatePath("/dashboard/client-detail");
  revalidatePath("/dashboard/crm");
  return { ok: true };
}

export async function settlePromise(promiseId: string, outcome: "KEPT" | "CANCELED"): Promise<{ ok: boolean }> {
  const { organizationId } = await requireSalesOrManager();
  const { settlePromise: settle } = await import("@/lib/promises/server");
  const ok = await settle(organizationId, String(promiseId), outcome === "CANCELED" ? "CANCELED" : "KEPT");
  revalidatePath("/dashboard/client-detail");
  revalidatePath("/dashboard/crm");
  return { ok };
}

/** A new day for an open promise — the reminders start over. */
export async function movePromiseDay(promiseId: string, day: string | null): Promise<{ ok: boolean }> {
  const { organizationId } = await requireSalesOrManager();
  if (day !== null && !/^\d{4}-\d{2}-\d{2}$/.test(String(day))) return { ok: false };
  const { movePromise } = await import("@/lib/promises/server");
  const { dueInstant } = await import("@/lib/promises/shared");
  const ok = await movePromise(organizationId, String(promiseId), day ? dueInstant(day) : null);
  revalidatePath("/dashboard/client-detail");
  revalidatePath("/dashboard/crm");
  return { ok };
}

/** Fold the duplicate into this record. The page always asks the person first. */
export async function mergeDuplicate(keptId: string, mergedId: string): Promise<{ ok: boolean; error?: string }> {
  const { organizationId, user } = await requireSalesOrManager();
  const r = await mergeClients(organizationId, String(keptId), String(mergedId), user.id);
  revalidatePath("/dashboard/client-detail");
  revalidatePath("/dashboard/clients");
  return { ok: r.ok, error: r.error };
}
