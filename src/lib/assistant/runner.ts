import "server-only";
// THE ASSISTANT'S MINUTE (2026-11-04) — what /api/cron/assistant runs every
// minute: a change approved by text or by voice waits out its two-minute undo
// window (lib/assistant/shared undoWindowMs) and is run here; the person hears
// what really happened where they asked — a text for a text. Read-backs nobody
// answered expire; a run that died half-way is marked failed, never retried (a
// send must not go out twice).
import { db } from "@/lib/db";
import { runAction } from "@/lib/assistant/engine";
import { sendAssistantText } from "@/lib/assistant/sms";
import { APPROVAL_TTL_MS, RUNNING_STALE_MS } from "@/lib/assistant/shared";

export async function runAssistantMinute(now = new Date()): Promise<{ ran: number; expired: number; stale: number }> {
  const expired = await db.assistantAction.updateMany({
    where: { status: "AWAITING", createdAt: { lt: new Date(now.getTime() - APPROVAL_TTL_MS) } },
    data: { status: "EXPIRED" },
  });
  const stale = await db.assistantAction.updateMany({
    where: { status: "RUNNING", updatedAt: { lt: new Date(now.getTime() - RUNNING_STALE_MS) } },
    data: { status: "FAILED", error: "It stopped part-way. Check whether it went through before trying again." },
  });
  const due = await db.assistantAction.findMany({
    where: { status: "QUEUED", executeAfter: { lte: now } },
    orderBy: { executeAfter: "asc" },
    take: 20,
    select: { id: true, organizationId: true, userId: true, channel: true },
  });
  let ran = 0;
  for (const a of due) {
    const say = await runAction(a.id, now);
    if (say === null) continue; // another run has it
    ran += 1;
    await db.assistantMessage.create({ data: { organizationId: a.organizationId, userId: a.userId, channel: a.channel, direction: "OUT", body: say.slice(0, 4000) } }).catch(() => null);
    if (a.channel === "sms") {
      const link = await db.assistantLink.findFirst({ where: { organizationId: a.organizationId, userId: a.userId, active: true, verifiedAt: { not: null } }, select: { phone: true } });
      if (link) await sendAssistantText(link.phone, say, "jobflex-assistant-done");
    }
  }
  return { ran, expired: expired.count, stale: stale.count };
}
