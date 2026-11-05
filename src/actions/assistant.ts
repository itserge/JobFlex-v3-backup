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

/** `running`: a build left to run after the reply (a minute's AI estimate) — the panel runs it next (/api/assistant/run). */
export type AskResult = { ok: true; reply: string; feed: AssistantFeed; running?: string | null } | { ok: false; error: string };

const askInput = z.object({ text: z.string().trim().min(1).max(1200) });
const answerInput = z.object({ actionId: z.string().min(1).max(64), answer: z.enum(["yes", "no"]) });

export async function askAssistant(raw: unknown): Promise<AskResult> {
  const parsed = askInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Say or type what you need." };
  const actor = await actorForSession();
  const turn = await handleTurn({ actor, text: parsed.data.text });
  return { ok: true, reply: turn.reply, feed: await readFeed(actor), running: turn.running ?? null };
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

// ── Settings → Assistant: the phone that texts it (2026-11-04) ───────────────

export interface AssistantPhoneView {
  /** Why this person has no Assistant (the field crew), or null. */
  closed: string | null;
  /** The Assistant's number, E.164 and as it reads; null until it is set up. */
  number: string | null;
  numberWords: string | null;
  link: { phone: string; phoneWords: string; active: boolean; linkedAt: string | null } | null;
  contactUrl: string | null;
  usage: { used: number; limit: number | null };
  /** Platform admins only: whether the Assistant is open to every account yet (lib/assistant/open). */
  preview: { openToAll: boolean } | null;
}

/** Should this person see the Assistant's rows: it is open to them, and their role has it. Never throws. */
export async function assistantVisible(): Promise<boolean> {
  try {
    const actor = await actorForSession();
    const { refusal } = await import("@/lib/assistant/actor");
    return (await refusal(actor, "today", false)) === null;
  } catch {
    return false;
  }
}

/** Open the Assistant to every account (true), or back to platform admins only (false). */
export async function setAssistantOpen(raw: unknown): Promise<AssistantPhoneView> {
  const on = z.boolean().parse(raw);
  const { requirePlatformAdmin } = await import("@/lib/orgContext");
  await requirePlatformAdmin();
  const { setAssistantOpenToAll } = await import("@/lib/assistant/open");
  await setAssistantOpenToAll(on);
  return loadAssistantPhone();
}

export async function loadAssistantPhone(): Promise<AssistantPhoneView> {
  const actor = await actorForSession();
  const { refusal } = await import("@/lib/assistant/actor");
  const { assistantNumber, linkOf, phoneWords } = await import("@/lib/assistant/phone");
  const closed = await refusal(actor, "today", false);
  const number = await assistantNumber();
  const link = closed ? null : await linkOf(actor.organizationId, actor.userId);
  const feed = closed ? null : await readFeed(actor);
  const { assistantOpenToAll } = await import("@/lib/assistant/open");
  const admin = await db.user.findUnique({ where: { id: actor.userId }, select: { isPlatformAdmin: true } });
  const preview = admin?.isPlatformAdmin ? { openToAll: await assistantOpenToAll() } : null;
  return {
    closed,
    number,
    numberWords: number ? phoneWords(number) : null,
    link: link ? { ...link, phoneWords: phoneWords(link.phone) } : null,
    contactUrl: number ? "/api/assistant/contact" : null,
    usage: feed?.usage ?? { used: 0, limit: null },
    preview,
  };
}

/** A fresh six-digit code to text from the phone being linked. */
export async function startAssistantLink(): Promise<{ ok: true; code: string; expiresAt: string } | { ok: false; error: string }> {
  const actor = await actorForSession();
  const { refusal } = await import("@/lib/assistant/actor");
  const { assistantNumber, startLink } = await import("@/lib/assistant/phone");
  const closed = await refusal(actor, "today", false);
  if (closed) return { ok: false, error: closed };
  if (!(await assistantNumber())) return { ok: false, error: "Texting the AI Operator isn't set up yet." };
  return startLink(actor.organizationId, actor.userId);
}

/** Pause (false) or turn back on (true) texting from the linked phone. */
export async function setAssistantPhoneOn(raw: unknown): Promise<AssistantPhoneView> {
  const on = z.boolean().parse(raw);
  const actor = await actorForSession();
  const { setMyPhoneActive } = await import("@/lib/assistant/phone");
  await setMyPhoneActive(actor.organizationId, actor.userId, on);
  return loadAssistantPhone();
}

export async function unlinkAssistantPhone(): Promise<AssistantPhoneView> {
  const actor = await actorForSession();
  const { unlinkMine } = await import("@/lib/assistant/phone");
  await unlinkMine(actor.organizationId, actor.userId);
  return loadAssistantPhone();
}
