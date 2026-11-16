"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireManager, requireSalesOrManager } from "@/lib/orgContext";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { db } from "@/lib/db";
import { dispatchOne, prepareDraft } from "@/lib/followUps/engine";
import { skipFollowUpAs } from "@/lib/followUps/server";
import { parseMode, parseWords, type FollowUpMode, type FollowUpWords } from "@/lib/followUps/agent";
import { ensureDefaultFollowUpRules } from "@/lib/followUps/defaults";
import { isTwilioEnabled } from "@/lib/sdk/twilio";
import { encodeChannel, MAX_DELAY_MINUTES, parseChannel, TEXT_NEEDS_TWILIO, type FollowUpChannel } from "@/lib/followUps/copy";
import { ProposalStatus } from "@/lib/prismaEnums";
import { refusal, refused, type ActionResult } from "@/lib/actionResult";
import { isPageLocked, withFeature } from "@/lib/customPageAccess";

// A rule fires when a proposal's status becomes `triggerStatus`
// (lib/followUps/engine scheduleFollowUpsFor), so the proposal statuses are the
// only values that can ever match. The editors offer a subset.
const TRIGGER_STATUSES = Object.values(ProposalStatus) as [ProposalStatus, ...ProposalStatus[]];

// Messages are the half after the label — `refusal` adds "Delay: " and the rest.
const ruleInput = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, "required.").max(120, "120 characters at most."),
  triggerStatus: z.enum(TRIGGER_STATUSES, { errorMap: () => ({ message: "pick one from the list." }) }),
  delayMinutes: z
    .number({ invalid_type_error: "enter a number." })
    .int("use whole minutes.")
    .min(1, "at least 1 minute.")
    .max(MAX_DELAY_MINUTES, "365 days at most."),
  enabled: z.boolean().default(true),
  /** EMAIL or TEXT. Stored in the `template` column — see
   *  src/lib/followUps/copy.ts for why that column carries the channel now. */
  channel: z.enum(["EMAIL", "TEXT"]).default("EMAIL"),
  /** Who sends and whose words (lib/followUps/agent). Optional: an editor that doesn't send them (an older
   *  bundle still open on a phone) leaves the rule's own untouched. */
  mode: z.enum(["AUTO", "ASK", "SUGGEST"]).optional(),
  words: z.enum(["STANDARD", "AI"]).optional(),
});

const RULE_LABELS = { name: "Rule name", triggerStatus: "Trigger", delayMinutes: "Delay", channel: "Send by" };

/** Every refusal is a value the editor prints (lib/actionResult) — a thrown
 *  one reached the page as a 500 with Prisma's own text in it. */
export async function upsertFollowUpRule(raw: unknown): Promise<ActionResult<{ id: string }>> {
  const { organizationId, user } = await requireManager();
  const parsed = ruleInput.safeParse(raw);
  if (!parsed.success) return refusal(parsed.error, RULE_LABELS);
  const data = parsed.data;
  // "Who sends it" and "Words" are Smart CRM's follow-up agent (owner, 2026-11-16 — lib/crm/smartAccess). Without it
  // a new rule is the basic timer (on its own, the standard words) and an edit keeps what the rule has: a rule set to
  // wait for a person never turns into one that sends by itself. Fails closed, as the gate does.
  if (await isPageLocked(organizationId, "smart-crm").catch(() => true)) {
    delete data.mode;
    delete data.words;
  }

  // A rule can only promise what this deployment can actually deliver. Offering
  // TEXT in the editor is gated on the same flag, but the server is the one that
  // has to refuse — otherwise a rule quietly stops sending the day the number
  // is removed.
  // A rule that already texts (a starter rule is written that way and falls
  // back to email in the engine) keeps TEXT through an edit of its delay.
  const existing = data.id ? await db.followUpRule.findUnique({ where: { id: data.id } }) : null;
  if (data.channel === "TEXT" && existing?.template !== "TEXT" && !await isTwilioEnabled()) {
    return refused(TEXT_NEEDS_TWILIO, "channel");
  }
  const channel = encodeChannel(data.channel);

  if (data.id) {
    if (!existing || existing.organizationId !== organizationId) return refused("This rule is gone — it was deleted. Reload the page.");
    const updated = await db.followUpRule.update({
      where: { id: data.id },
      data: {
        name: data.name,
        triggerStatus: data.triggerStatus,
        delayMinutes: data.delayMinutes,
        enabled: data.enabled,
        template: channel,
        ...(data.mode ? { mode: data.mode } : {}),
        ...(data.words ? { words: data.words } : {}),
      },
    });
    revalidatePath("/dashboard/crm");
    await logActivity({ organizationId, actorId: user.id, kind: TRAIL_KINDS.SETTINGS, summary: `Updated follow-up rule settings — edited "${data.name}"`, meta: { area: "follow-up rules", ruleId: updated.id, channel: data.channel, enabled: data.enabled, mode: updated.mode, words: updated.words } });
    return { ok: true, id: updated.id };
  }

  const created = await db.followUpRule.create({
    data: {
      organizationId,
      name: data.name,
      triggerStatus: data.triggerStatus,
      delayMinutes: data.delayMinutes,
      enabled: data.enabled,
      template: channel,
      mode: data.mode ?? "AUTO",
      words: data.words ?? "STANDARD",
    },
  });
  revalidatePath("/dashboard/crm");
  await logActivity({ organizationId, actorId: user.id, kind: TRAIL_KINDS.SETTINGS, summary: `Updated follow-up rule settings — added "${data.name}"`, meta: { area: "follow-up rules", ruleId: created.id, channel: data.channel, enabled: data.enabled } });
  return { ok: true, id: created.id };
}

export async function setFollowUpRuleEnabled(id: string, enabled: boolean) {
  const { organizationId, user } = await requireManager();
  const rule = await db.followUpRule.findUnique({ where: { id } });
  if (!rule || rule.organizationId !== organizationId) throw new Error("Not found");
  await db.followUpRule.update({ where: { id }, data: { enabled } });
  revalidatePath("/dashboard/crm");
  await logActivity({ organizationId, actorId: user.id, kind: TRAIL_KINDS.SETTINGS, summary: `Updated follow-up rule settings — turned "${rule.name}" ${enabled ? "on" : "off"}`, meta: { area: "follow-up rules", ruleId: id, enabled } });
}

/** A starter rule (lib/followUps/defaults) is turned off rather than deleted:
 *  ensureDefaultFollowUpRules writes any starter rule that has no row, so a
 *  deleted one would come back on the next visit to the page. */
export async function deleteFollowUpRule(id: string): Promise<{ turnedOff: boolean }> {
  const { organizationId, user } = await requireManager();
  const rule = await db.followUpRule.findUnique({ where: { id } });
  if (!rule || rule.organizationId !== organizationId) throw new Error("Not found");
  if (rule.isDefault) {
    await db.followUpRule.update({ where: { id }, data: { enabled: false } });
    revalidatePath("/dashboard/crm");
    await logActivity({ organizationId, actorId: user.id, kind: TRAIL_KINDS.SETTINGS, summary: `Updated follow-up rule settings — turned "${rule.name}" off`, meta: { area: "follow-up rules", ruleId: id, enabled: false } });
    return { turnedOff: true };
  }
  await db.followUpRule.delete({ where: { id } });
  revalidatePath("/dashboard/crm");
  await logActivity({ organizationId, actorId: user.id, kind: TRAIL_KINDS.SETTINGS, summary: `Updated follow-up rule settings — deleted "${rule.name}"`, meta: { area: "follow-up rules", ruleId: id, deleted: true } });
  return { turnedOff: false };
}

/** "Turn on defaults": the starter rules written (even beside the company's
 *  own) and every one of them switched on. The owner's own rules stay as they are. */
export async function turnOnDefaultFollowUps(): Promise<{
  created: number;
  enabled: number;
  /** The company's rules afterwards, in the CRM's order, so the desk sheet repaints from them. */
  rules: Array<{ id: string; name: string; triggerStatus: string; delayMinutes: number; enabled: boolean; channel: FollowUpChannel; isDefault: boolean; mode: FollowUpMode; words: FollowUpWords }>;
}> {
  const { organizationId, user } = await requireManager();
  const { created } = await ensureDefaultFollowUpRules(organizationId, { evenWithOwnRules: true });
  const { count } = await db.followUpRule.updateMany({ where: { organizationId, isDefault: true, enabled: false }, data: { enabled: true } });
  revalidatePath("/dashboard/crm");
  await logActivity({ organizationId, actorId: user.id, kind: TRAIL_KINDS.SETTINGS, summary: "Updated follow-up rule settings — turned the default rules on", meta: { area: "follow-up rules", created, enabled: count } });
  const rows = await db.followUpRule.findMany({ where: { organizationId }, orderBy: { name: "asc" } });
  const rules = rows.map((r) => ({ id: r.id, name: r.name, triggerStatus: r.triggerStatus, delayMinutes: r.delayMinutes, enabled: r.enabled, channel: parseChannel(r.template), isDefault: r.isDefault, mode: parseMode(r.mode), words: parseWords(r.words) }));
  return { created, enabled: count, rules };
}

export async function runFollowUpNow(id: string) {
  // Working the CRM queue is a sales activity; rule CRUD above stays manager-only.
  const { organizationId, user } = await requireSalesOrManager();
  const fu = await db.followUp.findUnique({ where: { id } });
  if (!fu || fu.organizationId !== organizationId) throw new Error("Not found");
  // False = closed unsent: the proposal moved on (accepted, declined, paid) since this was queued.
  const sent = await dispatchOne(fu.id, user.id);
  revalidatePath("/dashboard/crm");
  revalidatePath("/dashboard/crm/queue");
  return { sent };
}

// ── drafts waiting for a person (Smart CRM part 4, lib/followUps/agent) ──────

const draftInput = z.object({
  id: z.string().min(1),
  subject: z.string().trim().max(160).nullable().optional(),
  body: z.string().trim().min(2, "Write the message first.").max(2000, "2,000 characters at most."),
});

/** The person changed the words: they go exactly as typed (the proposal link is still added to a text). */
export async function saveFollowUpDraft(raw: unknown): Promise<ActionResult<{ id: string }>> {
  // The follow-up agent's drafts are Smart CRM (part 4) — a paid feature (owner, 2026-11-09).
  const { organizationId } = await withFeature(requireSalesOrManager(), "smart-crm");
  const parsed = draftInput.safeParse(raw);
  if (!parsed.success) return refused(parsed.error.issues[0]?.message ?? "Check the message.");
  const fu = await db.followUp.findUnique({ where: { id: parsed.data.id } });
  if (!fu || fu.organizationId !== organizationId || fu.completedAt) return refused("This follow-up is gone — it was sent or closed. Reload the page.");
  if ((fu.draftChannel ?? "EMAIL") === "TEXT" && parsed.data.body.length > 480) return refused("A text can be 480 characters at most.");
  await db.followUp.update({ where: { id: fu.id }, data: { draftBy: "person", draftSubject: parsed.data.subject || fu.draftSubject, draftBody: parsed.data.body } });
  revalidatePath("/dashboard/crm");
  return { ok: true, id: fu.id };
}

/** "Write it for me" on a reminder: the words are prepared and wait for a yes like any other draft. */
export async function writeFollowUpDraft(id: string): Promise<ActionResult<{ id: string }>> {
  // The follow-up agent's drafts are Smart CRM (part 4) — a paid feature (owner, 2026-11-09).
  const { organizationId } = await withFeature(requireSalesOrManager(), "smart-crm");
  const fu = await db.followUp.findUnique({ where: { id: String(id) } });
  if (!fu || fu.organizationId !== organizationId || fu.completedAt) return refused("This follow-up is gone — it was sent or closed. Reload the page.");
  const ok = await prepareDraft(fu.id);
  if (!ok) return refused("This client has no email or phone on file — there is nowhere to send it.");
  revalidatePath("/dashboard/crm");
  return { ok: true, id: fu.id };
}

/** Not this one: closed unsent, with who said so. */
export async function skipFollowUp(id: string): Promise<void> {
  const { organizationId, user } = await requireSalesOrManager();
  const r = await skipFollowUpAs(organizationId, String(id), { userId: user.id, name: user.name ?? null });
  if (r === "gone") throw new Error("Not found");
  revalidatePath("/dashboard/crm");
  revalidatePath("/dashboard/crm/queue");
}

export async function markFollowUpDone(id: string) {
  const { organizationId, user } = await requireSalesOrManager();
  const fu = await db.followUp.findUnique({ where: { id } });
  if (!fu || fu.organizationId !== organizationId) throw new Error("Not found");
  if (fu.completedAt) return;
  await db.followUp.update({ where: { id }, data: { completedAt: new Date(), state: "QUEUED", reason: null } });
  revalidatePath("/dashboard/crm");
  revalidatePath("/dashboard/crm/queue");
  const proposal = fu.proposalId
    ? await db.proposal.findUnique({ where: { id: fu.proposalId }, select: { title: true, clientId: true } })
    : null;
  await logActivity({
    organizationId,
    actorId: user.id,
    kind: TRAIL_KINDS.FOLLOW_UP,
    summary: proposal ? `Marked the follow-up on ${proposal.title} done` : "Marked a follow-up done",
    clientId: proposal?.clientId ?? null,
    proposalId: fu.proposalId ?? null,
    meta: { followUpId: id },
  });
}

