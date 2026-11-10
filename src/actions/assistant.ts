"use server";
// THE ASSISTANT PANEL'S ACTIONS (2026-11-04): ask, answer a read-back, read the
// conversation. Each resolves the signed-in person itself (lib/assistant/actor
// → requireOrg) — the page gate of every tool is asked again inside the engine,
// per tool, so a crafted call is never wider than the person's own buttons.
import { z } from "zod";
import { actorForSession } from "@/lib/assistant/actor";
import { approve, callOff, handleTurn, readFeed } from "@/lib/assistant/engine";
import { SPEECH_LANGS, type AssistantFeed, type FeedAction, type SpeechLang } from "@/lib/assistant/shared";
import type { AssistantPrefs } from "@/lib/assistant/prefs";
import { db } from "@/lib/db";

/** `running`: a build left to run after the reply (a minute's AI estimate) — the panel runs it next (/api/assistant/run). */
export type AskResult = { ok: true; reply: string; feed: AssistantFeed; running?: string | null } | { ok: false; error: string };

const askInput = z.object({ text: z.string().trim().min(1).max(1200), spoken: z.boolean().optional() });
const answerInput = z.object({ actionId: z.string().min(1).max(64), answer: z.enum(["yes", "no"]), pin: z.string().regex(/^\d{4}$/).optional() });

export async function askAssistant(raw: unknown): Promise<AskResult> {
  const parsed = askInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Say or type what you need." };
  const actor = await actorForSession();
  const turn = await handleTurn({ actor, text: parsed.data.text, spoken: parsed.data.spoken });
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
  const { actionId, answer, pin } = parsed.data;
  const keep = (direction: "IN" | "OUT", body: string) =>
    db.assistantMessage.create({ data: { organizationId: actor.organizationId, userId: actor.userId, channel: actor.channel, direction, body } });
  // The PIN itself is never kept in the conversation.
  await keep("IN", answer === "yes" ? (pin ? "Do it (with PIN)" : "Do it") : "Cancel");
  const stopped = answer === "yes" ? 0 : await callOff(actor, actionId);
  const reply = answer === "yes" ? await approve(actor, actionId, new Date(), pin ?? null) : stopped > 1 ? "OK — I won't do any of it." : stopped ? "OK — I won't do it." : "That's no longer waiting.";
  await keep("OUT", reply);
  return { ok: true, reply, feed: await readFeed(actor) };
}

export async function loadAssistantFeed(): Promise<AssistantFeed> {
  const actor = await actorForSession();
  return readFeed(actor);
}

/** The Tasks sheet (2026-11-05): the person's own changes of the last week, newest first. */
export async function loadAssistantTasks(): Promise<FeedAction[]> {
  const actor = await actorForSession();
  const { readTasks } = await import("@/lib/assistant/engine");
  return readTasks(actor);
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
  /** The 4-digit PIN that money (invoices, financing links) asks for with the yes (lib/assistant/pin): set or not. */
  pin: { set: boolean };
  /** The morning briefing and the alerts this person turned on (lib/assistant/prefs). */
  prefs: AssistantPrefs;
}

/** Should this person see the Assistant's rows: it is open to them, and their role has it. Never throws. */
export async function assistantVisible(): Promise<boolean> {
  try {
    const actor = await actorForSession();
    const { OPERATOR_PAUSED, refusal } = await import("@/lib/assistant/actor");
    // On the Free plan the row stays (owner, 2026-11-09): the panel opens and says the Operator is paused.
    const why = await refusal(actor, "today", false);
    return why === null || why === OPERATOR_PAUSED;
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
  const { hasPin } = await import("@/lib/assistant/pin");
  const { readPrefs, DEFAULT_PREFS } = await import("@/lib/assistant/prefs");
  return {
    closed,
    number,
    numberWords: number ? phoneWords(number) : null,
    link: link ? { ...link, phoneWords: phoneWords(link.phone) } : null,
    contactUrl: number ? "/api/assistant/contact" : null,
    usage: feed?.usage ?? { used: 0, limit: null },
    preview,
    pin: { set: closed ? false : await hasPin(actor.organizationId, actor.userId) },
    prefs: closed ? DEFAULT_PREFS : await readPrefs(actor.organizationId, actor.userId),
  };
}

/** The morning briefing and the alerts: the person's own switches (2026-11-05). Turning the briefing on after its time
 *  has passed today starts it tomorrow. */
export async function setAssistantPrefs(raw: unknown): Promise<AssistantPhoneView> {
  const { BRIEFING_TIMES, dayOf, timeOf } = await import("@/lib/assistant/shared");
  const input = z
    .object({
      briefing: z.object({ on: z.boolean(), time: z.string().refine((t) => BRIEFING_TIMES.includes(t), "Pick a time from the list."), projects: z.boolean().optional() }),
      alerts: z.object({ proposalOpened: z.boolean(), newLead: z.boolean() }),
      // The language they speak to it in (2026-11-06); a page that doesn't know the setting yet keeps what was set.
      lang: z.enum(SPEECH_LANGS.map((l) => l.code) as [SpeechLang, ...SpeechLang[]]).optional(),
    })
    .parse(raw);
  const actor = await actorForSession();
  const { requireOperator } = await import("@/lib/assistant/actor");
  await requireOperator(actor);
  const { readPrefs, writePrefs } = await import("@/lib/assistant/prefs");
  const before = await readPrefs(actor.organizationId, actor.userId);
  // A page that doesn't know the projects switch yet (part 2) keeps what was set.
  await writePrefs(actor.organizationId, actor.userId, { ...input, briefing: { ...input.briefing, projects: input.briefing.projects ?? before.briefing.projects }, lang: input.lang ?? before.lang });
  if (input.briefing.on && (!before.briefing.on || before.briefing.time !== input.briefing.time)) {
    const now = new Date();
    if (timeOf(now, actor.timezone) >= input.briefing.time) {
      const { markBriefed } = await import("@/lib/assistant/briefing");
      await markBriefed(actor.organizationId, actor.userId, dayOf(now, actor.timezone));
    }
  }
  return loadAssistantPhone();
}

/** Set (or change) the 4-digit PIN that money actions ask for with the yes (2026-11-05). */
export async function setAssistantPin(raw: unknown): Promise<{ ok: true; view: AssistantPhoneView } | { ok: false; error: string }> {
  const parsed = z.object({ pin: z.string().trim() }).safeParse(raw);
  const pin = parsed.success ? parsed.data.pin : "";
  const { PIN_RE, weakPin, setPin } = await import("@/lib/assistant/pin");
  if (!PIN_RE.test(pin)) return { ok: false, error: "A PIN is four digits." };
  if (weakPin(pin)) return { ok: false, error: "Too easy to guess — not one digit four times, and not a run like 1234." };
  const actor = await actorForSession();
  const { OPERATOR_PAUSED, operatorPaused } = await import("@/lib/assistant/actor");
  if (await operatorPaused(actor)) return { ok: false, error: OPERATOR_PAUSED };
  await setPin(actor.organizationId, actor.userId, pin);
  return { ok: true, view: await loadAssistantPhone() };
}

export async function clearAssistantPin(): Promise<AssistantPhoneView> {
  const actor = await actorForSession();
  const { clearPin } = await import("@/lib/assistant/pin");
  await clearPin(actor.organizationId, actor.userId);
  return loadAssistantPhone();
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
  if (on) {
    const { requireOperator } = await import("@/lib/assistant/actor");
    await requireOperator(actor);
  }
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
