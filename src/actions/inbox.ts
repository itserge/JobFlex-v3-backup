"use server";
// THE INBOX'S ACTIONS (Smart CRM part 2, 2026-11-08): answer by email or text, ask for three drafts, close or
// reopen, flag urgent, take the thread. Thin over lib/inbox — the AI Operator's tools run the same cores.

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSalesOrManager } from "@/lib/orgContext";
import { db } from "@/lib/db";
import { replyByEmail, replyByText, setThreadStatus, setThreadUrgent } from "@/lib/inbox/server";
import { draftReplies, type ReplyDraft } from "@/lib/inbox/drafts";
import { withFeature } from "@/lib/customPageAccess";

const replyInput = z.object({
  threadId: z.string().min(1),
  channel: z.enum(["EMAIL", "SMS"]),
  body: z.string().min(1).max(4000),
  subject: z.string().max(200).nullable().optional(),
});

export async function sendInboxReply(raw: unknown): Promise<{ ok: boolean; error?: string; note?: string }> {
  const { organizationId, user } = await withFeature(requireSalesOrManager(), "smart-crm");
  const input = replyInput.parse(raw);
  if (input.channel === "EMAIL") {
    const r = await replyByEmail(input.threadId, organizationId, user.id, { body: input.body, subject: input.subject ?? null });
    revalidatePath("/dashboard/inbox");
    return r.ok ? { ok: true, note: r.via === "gmail" ? "Sent from your Gmail." : undefined } : { ok: false, error: r.error };
  }
  const r = await replyByText(input.threadId, organizationId, { body: input.body, userId: user.id });
  revalidatePath("/dashboard/inbox");
  if (!r.ok) {
    const why: Record<string, string> = {
      "invalid-number": "This thread has no phone number that can take a text.",
      "opted-out": "They texted STOP — texts to them are off.",
      cap: "Today's text limit is reached.",
      allowance: "The plan's text allowance is used up.",
      trial: "Texting opens when the trial becomes a plan.",
    };
    return { ok: false, error: why[r.reason] ?? "The text didn't go through." };
  }
  if (r.status === "SKIPPED") return { ok: false, error: r.why === "no-number" ? "Your company has no texting number yet — answer by email, or set one up in Settings." : "Texts can't go out from here right now." };
  return { ok: true, note: r.status === "HELD" ? "Held for the morning (quiet hours) — it goes out on its own." : undefined };
}

export async function inboxDrafts(threadId: string): Promise<{ ok: boolean; drafts: ReplyDraft[] }> {
  const { organizationId } = await withFeature(requireSalesOrManager(), "smart-crm");
  const drafts = await draftReplies(String(threadId), organizationId);
  return { ok: !!drafts, drafts: drafts ?? [] };
}

export async function setInboxStatus(threadId: string, status: "OPEN" | "CLOSED"): Promise<{ ok: boolean }> {
  const { organizationId } = await withFeature(requireSalesOrManager(), "smart-crm");
  await setThreadStatus(String(threadId), organizationId, status === "CLOSED" ? "CLOSED" : "OPEN");
  revalidatePath("/dashboard/inbox");
  return { ok: true };
}

export async function setInboxUrgent(threadId: string, urgent: boolean): Promise<{ ok: boolean }> {
  const { organizationId } = await withFeature(requireSalesOrManager(), "smart-crm");
  await setThreadUrgent(String(threadId), organizationId, !!urgent);
  revalidatePath("/dashboard/inbox");
  return { ok: true };
}

export async function takeInboxThread(threadId: string): Promise<{ ok: boolean }> {
  const { organizationId, user } = await withFeature(requireSalesOrManager(), "smart-crm");
  await db.clientThread.updateMany({ where: { id: String(threadId), organizationId }, data: { assignedToId: user.id } });
  revalidatePath("/dashboard/inbox");
  return { ok: true };
}
