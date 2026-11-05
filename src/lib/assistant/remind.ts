import "server-only";
// REMINDERS TO YOURSELF (2026-11-05, the AI Operator's batch 1): "remind me at
// 3 to call the inspector". Nothing leaves JobFlex but a line to the person,
// so there is no yes to wait for: the reminder is a queued action with its own
// time (engine callTool, a `scheduled` tool), run by the minute job
// (lib/assistant/runner) when it is due — the line lands in the conversation,
// and in a text when the ask came by text (the runner's) or the person's phone
// is linked (sent here).
import { z } from "zod";
import { db } from "@/lib/db";
import type { ReadTool, WriteTool } from "@/lib/assistant/tools";
import { clockWords, dayWords, wallInstant } from "@/lib/assistant/shared";
import { linkOf } from "@/lib/assistant/phone";
import { sendAssistantText } from "@/lib/assistant/sms";

export const REMIND_TOOL = "remind_me";
const ID = z.string().min(1).max(64);
const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const TIME = z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/, "HH:MM");
const MAX_AHEAD_MS = 90 * 86_400_000;

export function reminderWhen(at: Date, tz: string): string {
  return `${dayWords(at, tz)} at ${clockWords(at, tz)}`;
}

const remindMe: WriteTool<{ what: string; date: string; time: string }, { what: string; at: string }> = {
  kind: "write",
  name: REMIND_TOOL,
  need: "reminders",
  scheduled: true,
  description:
    "Set a reminder for the person themselves (never for a client or the crew): what, and when on the company's clock. Use for: remind me at 3 to call John, remind me tomorrow morning about the permit. A client's payment is payment_reminder.",
  params: z.object({ what: z.string().min(2).max(300).describe("what to remind them of, in their words"), date: DAY, time: TIME }),
  payload: z.object({ what: z.string(), at: z.string() }),
  async plan({ actor, now }, a) {
    const tz = actor.timezone;
    const at = wallInstant(a.date, a.time, tz);
    if (!at) return { ok: false, say: "I couldn't read that date or time." };
    if (at.getTime() <= now.getTime() + 30_000) return { ok: false, say: `${reminderWhen(at, tz)} has passed. When should I remind you?` };
    if (at.getTime() > now.getTime() + MAX_AHEAD_MS) return { ok: false, say: "I can set reminders up to 90 days out." };
    const what = a.what.trim();
    return { ok: true, payload: { what, at: at.toISOString() }, readback: `OK — I'll remind you ${reminderWhen(at, tz)}: ${what}.`, runAt: at };
  },
  async execute({ actor }, p) {
    const line = `Reminder: ${p.what}`;
    // A text to the linked phone when the ask came in the app or by voice; a text asked by text is the runner's.
    if (actor.channel !== "sms") {
      const link = await linkOf(actor.organizationId, actor.userId).catch(() => null);
      if (link?.active) await sendAssistantText(link.phone, line, "jobflex-assistant-reminder").catch(() => false);
    }
    return { say: line };
  },
};

const reminders: ReadTool<Record<string, never>> = {
  kind: "read",
  name: "reminders",
  need: "reminders",
  description: "The person's own reminders still to come, with ids. Use for: what reminders do I have; before cancel_reminder.",
  params: z.object({}).strict() as unknown as z.ZodType<Record<string, never>>,
  async run({ actor }) {
    const rows = await db.assistantAction.findMany({
      where: { organizationId: actor.organizationId, userId: actor.userId, tool: REMIND_TOOL, status: "QUEUED" },
      orderBy: { executeAfter: "asc" },
      take: 20,
      select: { id: true, argsJson: true, executeAfter: true },
    });
    return {
      reminders: rows.map((r) => {
        let what = "";
        try {
          what = String((JSON.parse(r.argsJson) as { what?: unknown }).what ?? "");
        } catch {
          what = "";
        }
        return { id: r.id, what, when: r.executeAfter ? reminderWhen(r.executeAfter, actor.timezone) : null };
      }),
    };
  },
};

/** Calling off one's own reminder reaches nobody and is undone by setting it again, so it is a read-shaped tool: no
 *  read-back, no yes — the one write a read tool makes. */
const cancelReminder: ReadTool<{ reminderId: string }> = {
  kind: "read",
  name: "cancel_reminder",
  need: "reminders",
  description: "Call off one of the person's own reminders (the id from reminders). Nothing to confirm.",
  params: z.object({ reminderId: ID }),
  async run({ actor }, a) {
    const r = await db.assistantAction.updateMany({
      where: { id: a.reminderId, organizationId: actor.organizationId, userId: actor.userId, tool: REMIND_TOOL, status: "QUEUED" },
      data: { status: "CANCELED" },
    });
    return r.count ? { cancelled: true } : { error: "That reminder isn't set anymore." };
  },
};

export const REMIND_TOOLS = [remindMe, reminders, cancelReminder];
