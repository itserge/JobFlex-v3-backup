"use server";
// THE ASSISTANT PANEL'S ACTIONS (2026-11-04): ask, answer a read-back, read the
// conversation. Each resolves the signed-in person itself (lib/assistant/actor
// → requireOrg) — the page gate of every tool is asked again inside the engine,
// per tool, so a crafted call is never wider than the person's own buttons.
import { z } from "zod";
import { actorForSession } from "@/lib/assistant/actor";
import { approve, callOff, handleTurn, readFeed } from "@/lib/assistant/engine";
import type { AssistantFeed } from "@/lib/assistant/shared";
import { db } from "@/lib/db";

export type AskResult = { ok: true; reply: string; feed: AssistantFeed } | { ok: false; error: string };

const askInput = z.object({ text: z.string().trim().min(1).max(1200) });
const answerInput = z.object({ actionId: z.string().min(1).max(64), answer: z.enum(["yes", "no"]) });

export async function askAssistant(raw: unknown): Promise<AskResult> {
  const parsed = askInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Say or type what you need." };
  const actor = await actorForSession();
  const turn = await handleTurn({ actor, text: parsed.data.text });
  return { ok: true, reply: turn.reply, feed: await readFeed(actor) };
}

/** "Do it" / "Cancel" on a read-back in the panel. The answer is kept in the
 *  conversation as if typed, so the log reads the same on every channel; the
 *  read-back card itself carries the action (its stamp turns Done / Cancelled),
 *  so these two lines are plain ones. */
export async function answerAssistant(raw: unknown): Promise<AskResult> {
  const parsed = answerInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "That answer couldn't be read." };
  const actor = await actorForSession();
  const { actionId, answer } = parsed.data;
  const keep = (direction: "IN" | "OUT", body: string) =>
    db.assistantMessage.create({ data: { organizationId: actor.organizationId, userId: actor.userId, channel: actor.channel, direction, body } });
  await keep("IN", answer === "yes" ? "Do it" : "Cancel");
  const reply = answer === "yes" ? await approve(actor, actionId) : (await callOff(actor, actionId)) ? "OK — I won't do it." : "That's no longer waiting.";
  await keep("OUT", reply);
  return { ok: true, reply, feed: await readFeed(actor) };
}

export async function loadAssistantFeed(): Promise<AssistantFeed> {
  const actor = await actorForSession();
  return readFeed(actor);
}
