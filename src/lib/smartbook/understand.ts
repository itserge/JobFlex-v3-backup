// SMARTBOOK · READING WHAT PEOPLE WRITE (2026-10-31) — server only.
//
// The model only understands and words; code decides. A customer's reply becomes one checked object — they picked
// time 2, they named Saturday at 9, they said "mornings", they asked a question, they're not interested — and the
// engine acts on it with times from the booking engine only. The company's answer to a request ("yes", "can't,
// monday 2pm?") the same way. An answer to a customer's question may come only from what the company wrote for its
// AI desk (lib/aiDesk/profile); anything else is passed to a person.
//
// The platform's client (lib/sdk/openai), JSON out, zod in. No model on this workspace, or a model that fails: null,
// and the engine falls back to the short replies it reads itself (offers.ts quickRead) or hands the message on.
import { z } from "zod";
import { getOpenAI, isOpenAIEnabled, resolveOpenAIModel, samplingOptions } from "@/lib/sdk/openai";
import type { DeskProfile } from "@/lib/aiDesk/profile";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const hhmm = z.string().regex(/^\d{1,2}:\d{2}$/);
const part = z.enum(["morning", "afternoon", "evening"]);
const opt = <T extends z.ZodTypeAny>(s: T) => s.nullish().catch(null);

export const customerReadSchema = z.object({
  intent: z.enum(["pick", "propose", "prefer", "question", "not-interested", "cancel", "reschedule", "thanks", "human", "other"]).catch("other"),
  pick: opt(z.number().int().min(1).max(9)),
  proposal: opt(z.object({ day, time: opt(hhmm), part: opt(part) })),
  prefer: opt(
    z.object({
      days: opt(z.array(z.number().int().min(0).max(6)).max(7)),
      part: opt(part),
      after: opt(hhmm),
      before: opt(hhmm),
      from: opt(day),
      to: opt(day),
    }),
  ),
  question: opt(z.string().max(300)),
  answer: opt(z.string().max(500)),
  lang: z.string().min(2).max(8).catch("en"),
  angry: z.boolean().catch(false),
});
export type CustomerRead = z.infer<typeof customerReadSchema>;

export const contractorReadSchema = z.object({
  decision: z.enum(["yes", "no", "other", "unclear"]).catch("unclear"),
  day: opt(day),
  time: opt(hhmm),
  ref: opt(z.number().int().min(1).max(9999)),
});
export type ContractorRead = z.infer<typeof contractorReadSchema>;

/** What the company wrote for its desk, as the only facts SmartBook may answer from. */
export function knowledgeOf(p: DeskProfile | null | undefined): string {
  if (!p) return "";
  const lines = [
    p.about && `About: ${p.about}`,
    p.services?.length ? `Services: ${p.services.join("; ")}` : "",
    p.serviceArea && `Service area: ${p.serviceArea}`,
    p.hours && `Hours: ${p.hours}`,
    p.pricing && `Prices (only these words): ${p.pricing}`,
    p.credentials && `Licensing / insurance / warranty: ${p.credentials}`,
    p.knowledge && `More: ${p.knowledge}`,
    ...(p.faqs ?? []).slice(0, 40).map((f) => `Q: ${f.q} A: ${f.a}`),
    p.neverSay?.length ? `Never say: ${p.neverSay.join("; ")}` : "",
  ].filter(Boolean);
  return lines.join("\n").slice(0, 8000);
}

export function customerSystemPrompt(input: { company: string; nowWords: string; timeZone: string; offered: string[]; booked: string | null; asked: string | null; knowledge: string }): string {
  return [
    `You read one text message a customer sent to ${input.company}'s scheduling assistant, and return JSON only.`,
    `Now: ${input.nowWords} (${input.timeZone}). Resolve "tomorrow", "next Tuesday", "this Saturday" from now, on that clock.`,
    input.offered.length ? `Times the customer was offered, numbered: ${input.offered.map((o, i) => `${i + 1}) ${o}`).join("; ")}.` : "No times are on offer right now.",
    input.booked ? `They are already booked: ${input.booked}.` : "",
    input.asked ? `They asked for ${input.asked} and are waiting for the company's answer.` : "",
    "Fields:",
    `- intent: "pick" (they chose one of the offered times — set pick to its number; "the Wednesday one", "the afternoon" count), "propose" (one specific day, with or without an hour, that is not an offered time — set proposal {day: YYYY-MM-DD, time: HH:MM 24h or null, part: morning|afternoon|evening or null}), "prefer" (a general wish, no single day: days of the week 0=Sunday, part of day, after/before HH:MM, from/to YYYY-MM-DD), "question" (they asked something — question is their question in a few words), "not-interested" (no thanks, wrong number, already hired someone, stop contacting), "cancel" (cancel their booked visit), "reschedule" (move their booked visit, no new time named), "thanks" (only thanks or ok), "human" (they want a person or a call), "other".`,
    "- answer: only when intent is question AND the company facts below answer it, in one or two short sentences in the customer's language. Otherwise null. Never invent a price, a date, a promise or a fact.",
    "- lang: the ISO 639-1 code of the language they wrote in.",
    "- angry: true when they are upset or complaining.",
    'Example: {"intent":"propose","pick":null,"proposal":{"day":"2026-11-08","time":"09:00","part":null},"prefer":null,"question":null,"answer":null,"lang":"en","angry":false}',
    input.knowledge ? `Company facts (the only facts you may answer from):\n${input.knowledge}` : "There are no company facts: answer is always null.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function contractorSystemPrompt(input: { nowWords: string; timeZone: string; open: Array<{ n: number; name: string; asked: string }> }): string {
  return [
    "A contractor answers their scheduling assistant by text about a customer's visit request. Return JSON only.",
    `Now: ${input.nowWords} (${input.timeZone}).`,
    `Open requests: ${input.open.map((o) => `#${o.n} ${o.name} asks for ${o.asked}`).join("; ")}.`,
    '- decision: "yes" (book what the customer asked), "no" (that time does not work — offer the customer other times), "other" (the contractor names another day and/or time instead — set day YYYY-MM-DD and time HH:MM 24h), "unclear".',
    "- A time with no day means the day the customer asked for. ref: the request number when they name one (#2, 2, or the customer's name), else null.",
    'Example: {"decision":"other","day":"2026-11-10","time":"14:00","ref":null}',
  ].join("\n");
}

/** The model's reply as an object: plain JSON, or the first {...} in a chatty one. */
function replyObject(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const a = text.indexOf("{");
    const b = text.lastIndexOf("}");
    if (a >= 0 && b > a) {
      try {
        return JSON.parse(text.slice(a, b + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

async function askJson(system: string, user: string): Promise<unknown | null> {
  if (!isOpenAIEnabled()) return null;
  try {
    const client = getOpenAI();
    const model = await resolveOpenAIModel();
    const completion = await client.chat.completions.create({
      model,
      ...(await samplingOptions(0)),
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
    });
    return replyObject(completion.choices[0]?.message?.content ?? "");
  } catch (err) {
    console.warn(`[smartbook] model read failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

export async function readCustomer(message: string, ctx: Parameters<typeof customerSystemPrompt>[0], history: string[]): Promise<CustomerRead | null> {
  const user = [history.length ? `Earlier in this conversation:\n${history.slice(-8).join("\n")}` : "", `THE MESSAGE:\n${message.slice(0, 1200)}`].filter(Boolean).join("\n\n");
  const raw = await askJson(customerSystemPrompt(ctx), user);
  const parsed = raw ? customerReadSchema.safeParse(raw) : null;
  return parsed?.success ? parsed.data : null;
}

export async function readContractor(message: string, ctx: Parameters<typeof contractorSystemPrompt>[0]): Promise<ContractorRead | null> {
  const raw = await askJson(contractorSystemPrompt(ctx), `THE REPLY:\n${message.slice(0, 600)}`);
  const parsed = raw ? contractorReadSchema.safeParse(raw) : null;
  return parsed?.success ? parsed.data : null;
}

/** A line SmartBook wrote, in the customer's language. English, or no model: the line as it is. */
export async function inLanguage(text: string, lang: string | null | undefined): Promise<string> {
  const code = (lang ?? "en").toLowerCase().slice(0, 2);
  if (code === "en" || !/^[a-z]{2}$/.test(code)) return text;
  const raw = await askJson(
    `Translate the text message into the language with ISO 639-1 code "${code}". Keep the meaning, the tone, every number, time, date, name, link and the word STOP exactly. Return JSON {"text": "..."} only.`,
    text,
  );
  const v = raw && typeof (raw as { text?: unknown }).text === "string" ? (raw as { text: string }).text.trim() : "";
  return v && v.length < text.length * 3 ? v : text;
}
