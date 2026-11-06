import "server-only";
// THE ASSISTANT'S MINUTE (2026-11-04) — what /api/cron/assistant runs every
// minute: a change approved by text or by voice waits out its two-minute undo
// window (lib/assistant/shared undoWindowMs) and is run here; the person hears
// what really happened where they asked — a text for a text. Read-backs nobody
// answered expire; a run that died half-way is marked failed, never retried (a
// send must not go out twice). A build left to run after its reply (slice 3, a
// minute's AI estimate) is run the same way — by the turn that started it
// (runAndReport), else here.
import { db } from "@/lib/db";
import { runAction } from "@/lib/assistant/engine";
import { sendAssistantText } from "@/lib/assistant/sms";
import { runBriefings } from "@/lib/assistant/briefing";
import { APPROVAL_TTL_MS, RUNNING_STALE_MS } from "@/lib/assistant/shared";

/** Run one queued action and say what happened where it was asked: the conversation, and a text for a text.
 *  False when another run already has it. `early`: a build run by the turn or the panel that started it, before
 *  the minute job's grace is up. */
export async function runAndReport(actionId: string, now = new Date(), opts: { early?: boolean } = {}): Promise<boolean> {
  const a = await db.assistantAction.findUnique({ where: { id: actionId }, select: { organizationId: true, userId: true, channel: true } });
  if (!a) return false;
  const r = await runAction(actionId, now, opts);
  if (r === null) return false;
  // The card it belongs to: the send it offers (Do it / Cancel), else the build itself; an approved change already has its own.
  const card = r.proposed?.id ?? (r.instant ? actionId : null);
  await db.assistantMessage.create({ data: { organizationId: a.organizationId, userId: a.userId, channel: a.channel, direction: "OUT", body: r.say.slice(0, 4000), actionId: card } }).catch(() => null);
  // A text for a text — and (2026-11-05) for a build asked in the app that nobody waited for: the minute job ran it,
  // so the person closed JobFlex; the linked phone hears it is ready.
  if (a.channel === "sms" || (a.channel === "app" && r.instant && !opts.early)) {
    const link = await db.assistantLink.findFirst({ where: { organizationId: a.organizationId, userId: a.userId, active: true, verifiedAt: { not: null } }, select: { phone: true } });
    if (link) await sendAssistantText(link.phone, r.say, r.instant ? "jobflex-assistant-built" : "jobflex-assistant-done");
  }
  return true;
}

const AT_ONCE = 4;

export async function runAssistantMinute(now = new Date()): Promise<{ ran: number; expired: number; stale: number; briefed: number }> {
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
    select: { id: true },
  });
  let ran = 0;
  // A few at a time: an estimate is a minute's work, and twenty in a row would outlast the job.
  for (let i = 0; i < due.length; i += AT_ONCE) {
    const done = await Promise.all(due.slice(i, i + AT_ONCE).map((a) => runAndReport(a.id, now).catch(() => false)));
    ran += done.filter(Boolean).length;
  }
  // The morning briefing (2026-11-05): whoever's time has come on their company's clock.
  const briefed = await runBriefings(now).catch((err) => {
    console.warn(`[assistant-brief] ${err instanceof Error ? err.message : String(err)}`);
    return 0;
  });
  return { ran, expired: expired.count, stale: stale.count, briefed };
}
