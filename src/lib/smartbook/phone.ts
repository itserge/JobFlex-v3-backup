// SMARTBOOK · ON THE PHONE (owner, 2026-10-31: "offer availability by text or email or calling from AI desk"; decision
// 1: one AI call when a lead hasn't answered in 2 business hours, off until switched on, only to leads who agreed to
// calls, on the plan's desk minutes) — server only.
//
//   A lead SmartBook is talking with calls the company's number:
//     leadCalling / deskCallExtras  the desk's brief (lib/aiDesk/liveCall callBrief) learns who it is — the times they
//                                   were sent, the time they asked for, the visit they booked — and brings the desk's
//                                   tools plus request_time and not_interested
//   The AI desk calls a lead SmartBook is scheduling (lib/aiDesk/leadCalls — SmartBook's one call is the desk's
//   automatic call, engine step "call"; the desk's own "Call new leads" and the lead page's button are the same call):
//     leadCallExtras                what SmartBook sent them for the brief, request_time and not_interested beside the
//                                   desk's tools, and the voicemail that points at those times
//     smartBookStop                 "don't call" on that call stops SmartBook too
//   Either way:
//     leadForToken                  which lead a call is about (the desk's tools act on it, never a second lead)
//     smartBookTool                 request_time and not_interested (/api/desk/tool)
//
// No change to the voice server: it sends open_times / book_visit / take_message to the desk's own routes, which ask
// leadForToken first, and any other tool a brief brings to /api/desk/tool (voice/README "A brief's own tools").
import { db } from "@/lib/db";
import { toE164 } from "@/lib/phone";
import type { CallToken } from "@/lib/aiDesk/voiceToken";
import { callContext, notInterestedOnCall, requestOnCall } from "./engine";
import { convByPhone, readConv, type Conversation } from "./store";

// ── the tools ───────────────────────────────────────────────────────────────

type Tool = { type: "function"; name: string; description: string; parameters: { type: "object"; properties: Record<string, unknown>; required: string[] } };
const tool = (name: string, description: string, properties: Record<string, unknown> = {}, required: string[] = []): Tool => ({ type: "function", name, description, parameters: { type: "object", properties, required } });

const REQUEST_TIME = tool(
  "request_time",
  "The customer wants a day or time that open_times doesn't have. The team is asked to confirm it, and the customer hears back by text or email. Use a day (and a time, or a part of the day) on the company's calendar.",
  {
    day: { type: "string", description: "YYYY-MM-DD" },
    time: { type: "string", description: "HH:MM, 24-hour, when they named an hour" },
    part: { type: "string", enum: ["morning", "afternoon", "evening"], description: "When they named only a part of the day" },
    words: { type: "string", description: "What they said, briefly" },
  },
  ["day"],
);
const NOT_INTERESTED = tool("not_interested", "The customer isn't interested any more, or asks not to be contacted. SmartBook stops and the company is told.", { said: { type: "string", description: "Their words, briefly" } });

/**
 * What the desk may do when a SmartBook lead calls in. The first two keep the desk's own names, so the voice server
 * sends them to the desk's routes (which act on this lead); the voice server runs transfer_call and end_call itself.
 */
export function smartBookTools(): Tool[] {
  return [
    tool("open_times", "The open times for this customer: the ones already sent to them first, then the next open ones. Call it before offering any time. Each has an id.", { days: { type: "integer", description: "How many days ahead (default 7)" } }),
    tool(
      "book_visit",
      "Book one of the open times for this customer once they chose it. Their name, phone and address are already on file.",
      { time_id: { type: "string", description: "The id of the chosen time from open_times" }, name: { type: "string" }, phone: { type: "string" }, notes: { type: "string", description: "Anything new for the team, as short labelled lines" } },
      ["time_id"],
    ),
    REQUEST_TIME,
    NOT_INTERESTED,
    tool("take_message", "A message for the company — a question you can't answer, a call back they want. It goes onto their request.", { name: { type: "string" }, phone: { type: "string" }, about: { type: "string" } }, ["about"]),
    tool("transfer_call", "Hand the call to a person at the company (their phone rings). Only when the customer asks for a person and the instructions allow it. Say you are transferring first.", { reason: { type: "string" } }),
    tool("end_call", "End the call after the goodbye."),
  ];
}

// ── which lead a call is about ──────────────────────────────────────────────

/** A lead SmartBook is talking with, calling from this number (a test never counts). */
export async function leadCalling(organizationId: string, from: string): Promise<Conversation | null> {
  const phone = toE164(from);
  if (!phone) return null;
  const conv = await convByPhone(organizationId, phone);
  if (!conv || conv.test) return null;
  return conv.status !== "closed" || conv.why === "no-reply" ? conv : null;
}

/** SmartBook is scheduling this lead now — times out, a time asked for, or a visit booked (a test never counts). */
async function scheduling(organizationId: string, leadId: string): Promise<Conversation | null> {
  const conv = await readConv(organizationId, leadId);
  return conv && !conv.test && conv.status !== "closed" ? conv : null;
}

/** The lead a call's tools act on: the desk's call to a lead SmartBook is scheduling names it; a desk call has one when
 *  the caller is a SmartBook lead. */
export async function leadForToken(t: CallToken): Promise<string | null> {
  if (t.kind === "lead") return t.ref && (await scheduling(t.organizationId, t.ref)) ? t.ref : null;
  if (t.kind) return null;
  return (await leadCalling(t.organizationId, t.from))?.leadId ?? null;
}

const ago = (iso: string, now: Date) => {
  const m = Math.max(1, Math.round((now.getTime() - Date.parse(iso)) / 60000));
  return m < 90 ? `${m} minutes ago` : m < 36 * 60 ? `${Math.round(m / 60)} hours ago` : `${Math.round(m / 1440)} days ago`;
};

type CallFacts = NonNullable<Awaited<ReturnType<typeof callContext>>>;

/** Where SmartBook stands with this lead, as lines for the desk's instructions. */
function standing(c: CallFacts, conv: Conversation, now: Date): string[] {
  const who = c.first || c.name;
  return [
    `${c.name} asked ${c.company} about ${c.project || "a visit"}; SmartBook, the company's scheduling assistant, has been finding them a time by ${c.channel ?? "text and email"} (started ${ago(conv.createdAt, now)}).`,
    c.status === "offered" && c.offers.length ? `Times already sent to ${who}: ${c.offers.map((o) => `${o.label} (id ${o.id})`).join("; ")}. open_times returns these first.` : "",
    c.status === "asked" && c.asked ? `${who} asked for ${c.asked}; the team hasn't confirmed it yet. Say they'll hear back shortly — or, if another time works, book it from open_times.` : "",
    c.status === "countered" && c.counter ? `The company offered ${who} ${c.counter} instead of their time; a yes books it (book_visit with that time from open_times).` : "",
    c.status === "booked" && c.booked ? `${who} is booked for ${c.booked}. To move it, offer open_times and book the new one with book_visit (that moves the visit); to cancel, take_message.` : "",
    `The visit: ${c.visit} — ${c.price}.`,
  ].filter(Boolean);
}

/**
 * The desk's brief for a caller SmartBook is talking with: what it knows, and the tools that act on their lead. Null
 * when the caller isn't one (the desk's own brief stands as it is).
 */
export async function deskCallExtras(organizationId: string, from: string, now = new Date()): Promise<{ lines: string; tools: Tool[] } | null> {
  const conv = await leadCalling(organizationId, from);
  const c = conv ? await callContext(organizationId, conv.leadId, now) : null;
  if (!conv || !c) return null;
  return {
    lines: [
      "THIS CALLER IS A LEAD SMARTBOOK IS SCHEDULING — greet them by name once they confirm it is them:",
      ...standing(c, conv, now).map((l) => `- ${l}`),
      "- Help them pick a time: open_times, then book_visit. A day or time that isn't open: request_time. Not interested any more: not_interested. A question you can't answer: take_message. Their details are on file — don't ask again for what you know.",
    ].join("\n"),
    tools: smartBookTools(),
  };
}

// ── the AI desk calls a lead SmartBook is scheduling ────────────────────────

/** "an estimate visit", "a free estimate", "a repair visit". */
const withArticle = (words: string) => `${/^[aeiou]/i.test(words) ? "an" : "a"} ${words}`;

/** The short voicemail: who, why, and where the times are — nothing booked. */
export function voicemailWords(v: { first: string; company: string; visit: string; channel: "text" | "email" | null }): string {
  const where = v.channel === "email" ? "an email" : "a text";
  return `Hi${v.first ? ` ${v.first}` : ""}, this is the virtual assistant for ${v.company}, calling about your request for ${withArticle(v.visit.toLowerCase())}. We sent you ${where} with a few open times — just reply or tap the link to pick one. Thanks, and talk soon.`;
}

/**
 * For the desk's call to a lead (lib/aiDesk/leadCalls): what SmartBook has said to them, its two tools beside the
 * desk's own, and the voicemail when times are out. Null when SmartBook isn't scheduling them.
 */
export async function leadCallExtras(organizationId: string, leadId: string, now = new Date()): Promise<{ lines: string; tools: Tool[]; voicemail: string | null } | null> {
  const conv = await scheduling(organizationId, leadId);
  const c = conv ? await callContext(organizationId, leadId, now) : null;
  if (!conv || !c) return null;
  return {
    lines: [
      "SMARTBOOK IS SCHEDULING THIS LEAD — the company's scheduling assistant has been writing to them:",
      ...standing(c, conv, now).map((l) => `- ${l}`),
      "- Offer the times already sent first (open_times returns them first) and book the one they pick with book_visit. A day or time that isn't open: request_time — the team confirms it and they hear back shortly. Not interested any more: not_interested.",
    ].join("\n"),
    tools: [REQUEST_TIME, NOT_INTERESTED],
    voicemail: c.status === "offered" && c.offers.length ? voicemailWords(c) : null,
  };
}

/** They asked the desk not to call again (lib/aiDesk/leadCalls do_not_call): SmartBook stops writing to them too. */
export async function smartBookStop(organizationId: string, leadId: string, said: string): Promise<void> {
  if (await scheduling(organizationId, leadId)) await notInterestedOnCall(organizationId, leadId, said);
}

const PARTS = new Set(["morning", "afternoon", "evening"]);

/** request_time and not_interested — for the desk's call to a SmartBook lead and for a desk call from one. */
export async function smartBookTool(t: CallToken, name: string, args: Record<string, unknown>): Promise<{ ok: true; outcome?: "done"; output: Record<string, unknown> } | { ok: false; error: string }> {
  const leadId = await leadForToken(t);
  if (!leadId) return { ok: false, error: `no such tool on this call: ${name}` };
  const words = typeof args.words === "string" ? args.words.trim().slice(0, 300) : "";
  if (name === "request_time") {
    const day = typeof args.day === "string" ? args.day.trim() : "";
    const time = typeof args.time === "string" && /^\d{1,2}:\d{2}$/.test(args.time.trim()) ? args.time.trim().padStart(5, "0") : null;
    const part = typeof args.part === "string" && PARTS.has(args.part) ? (args.part as "morning" | "afternoon" | "evening") : null;
    const r = await requestOnCall(t.organizationId, leadId, { day, time, part }, words);
    if (!r.ok) return r;
    await db.aiPhoneCall.updateMany({ where: { callSid: t.callSid }, data: { leadId } }).catch(() => null);
    return { ok: true, outcome: "done", output: { outcome: r.outcome, say: r.say, ...(r.times ? { times: r.times } : {}) } };
  }
  if (name === "not_interested") {
    const said = typeof args.said === "string" ? args.said.trim().slice(0, 300) : "";
    await notInterestedOnCall(t.organizationId, leadId, said);
    await db.aiPhoneCall.updateMany({ where: { callSid: t.callSid }, data: { leadId } }).catch(() => null);
    return { ok: true, outcome: "done", output: { done: true, say: "Thank them, say goodbye and call end_call." } };
  }
  return { ok: false, error: `no such tool on this call: ${name}` };
}
