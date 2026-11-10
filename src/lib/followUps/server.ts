import "server-only";

// THE FOLLOW-UPS WAITING FOR A PERSON (Smart CRM part 4, 2026-11-10) — the rows the agent handed over: a prepared
// draft that needs a yes (ASK), or a plain reminder to follow up (SUGGEST). One reader for the CRM's Today tab, the
// phone CRM, the Operator and the morning briefing, so they can never disagree about what is waiting.

import { db } from "@/lib/db";
import { parseDispatch } from "@/lib/followUps/copy";
import { parseMode, type WaitingFollowUp } from "@/lib/followUps/agent";
import { SKIPPED_MARK } from "@/lib/followUps/engine";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";

export interface WaitingViewer {
  userId: string;
  /** SALES / ESTIMATOR: only the follow-ups on their own proposals. */
  ownOnly: boolean;
}

/** The rule's name is the start of the row's note ("Sent · day 2 · SENT + 2880m"). */
export function ruleNameOf(note: string | null): string {
  if (!note) return "Follow-up";
  const m = /^(.*) · [A-Z_]+ \+ \d+m\b/.exec(note);
  return (m ? m[1] : note).trim().slice(0, 80) || "Follow-up";
}

export async function readWaitingFollowUps(organizationId: string, viewer: WaitingViewer, take = 40): Promise<WaitingFollowUp[]> {
  const rows = await db.followUp.findMany({
    where: { organizationId, completedAt: null, state: "READY", proposalId: { not: null } },
    orderBy: { readyAt: "asc" },
    take: 120,
  });
  if (!rows.length) return [];
  const ids = [...new Set(rows.map((r) => r.proposalId).filter((x): x is string => Boolean(x)))];
  const proposals = await db.proposal.findMany({
    where: { id: { in: ids }, organizationId, ...(viewer.ownOnly ? { ownerId: viewer.userId } : {}) },
    select: { id: true, title: true, total: true, clientId: true, client: { select: { name: true } } },
  });
  const byId = new Map(proposals.map((p) => [p.id, p]));
  const out: WaitingFollowUp[] = [];
  for (const r of rows) {
    const p = r.proposalId ? byId.get(r.proposalId) : null;
    if (!p) continue;
    const { channel, trigger } = parseDispatch(r.templateId);
    out.push({
      id: r.id,
      clientId: p.clientId,
      client: p.client?.name ?? "Unknown client",
      proposalId: p.id,
      title: p.title,
      total: p.total,
      trigger: trigger ?? "SENT",
      channel: r.draftChannel === "TEXT" || r.draftChannel === "EMAIL" ? r.draftChannel : channel,
      mode: parseMode(r.mode),
      draftBy: r.draftBody ? r.draftBy : null,
      draftSubject: r.draftBody ? r.draftSubject : null,
      draftBody: r.draftBody,
      rule: ruleNameOf(r.note),
      readyAt: (r.readyAt ?? r.runAt).getTime(),
    });
    if (out.length >= take) break;
  }
  return out;
}

/**
 * "Not this one": closed unsent, with who said so — the Today tab's Skip and the Operator's. "gone" = no such row in
 * this company; "closed" = it was already sent or closed.
 */
export async function skipFollowUpAs(organizationId: string, id: string, by: { userId: string | null; name: string | null }): Promise<"gone" | "closed" | "skipped"> {
  const fu = await db.followUp.findUnique({ where: { id } });
  if (!fu || fu.organizationId !== organizationId) return "gone";
  if (fu.completedAt) return "closed";
  await db.followUp.update({ where: { id: fu.id }, data: { completedAt: new Date(), state: "QUEUED", reason: null, note: `${fu.note ?? ""}${SKIPPED_MARK}by ${by.name ?? "a person"}` } });
  const proposal = fu.proposalId ? await db.proposal.findUnique({ where: { id: fu.proposalId }, select: { title: true, clientId: true } }) : null;
  await logActivity({
    organizationId,
    actorId: by.userId,
    kind: TRAIL_KINDS.FOLLOW_UP,
    summary: proposal ? `Skipped the follow-up on ${proposal.title}` : "Skipped a follow-up",
    clientId: proposal?.clientId ?? null,
    proposalId: fu.proposalId ?? null,
    meta: { followUpId: id },
  });
  return "skipped";
}
