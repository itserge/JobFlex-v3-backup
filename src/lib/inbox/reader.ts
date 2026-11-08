import "server-only";
// THE READING ENGINE (Smart CRM part 2, 2026-11-08; the owner's spec §5): an inbound message becomes structured
// CRM intelligence — what they want, what changed, the deadline, the money talk, a complaint, a promise — shown in
// the inbox's "what this means" panel (ClientThread.aiReadJson), folded into the client's memory (lib/clientMemory
// foldClientFacts) and, for a promise of theirs, written as an open ClientPromise. Rules the spec sets: never a
// contract, never a changed amount, never an invented preference; the original message stays linked; AI words are
// marked AI everywhere they show. The model call follows lib/smartbook/understand (json_object, temperature 0);
// on the stand, qa/fixtures/assistant-fake-openai answers the CLIENT MESSAGE READ prompt.

import { db } from "@/lib/db";
import { getOpenAI, isOpenAIEnabled, resolveOpenAIModel, samplingOptions } from "@/lib/sdk/openai";
import { takeTrialCap } from "@/lib/trialMeter";
import { foldClientFacts, type RawFact } from "@/lib/clientMemory";
import { clip } from "@/lib/clientTimeline/shared";
import { parseMessageRead, type MessageRead } from "./shared";

export interface ReadInput {
  threadId: string;
  organizationId: string;
  clientId: string | null;
  channel: "EMAIL" | "SMS" | "PORTAL";
  subject: string | null;
  body: string;
  /** The ClientMessage id (email) or SmsMessage id (text) the read points back at. */
  sourceId?: string | null;
}

/** Read one inbound message. Returns the read, or null when the AI is off or the allowance is spent — the message
 *  is already filed either way; the panel just shows nothing new. */
export async function readInboundMessage(input: ReadInput): Promise<MessageRead | null> {
  if (!isOpenAIEnabled() || !input.body.trim()) return null;
  const trial = await takeTrialCap(input.organizationId, "aiCalls");
  if (!trial.ok) return null;

  const known = input.clientId
    ? await db.clientFact.findMany({ where: { organizationId: input.organizationId, clientId: input.clientId, status: "CURRENT" }, select: { id: true, category: true, fact: true }, take: 25 })
    : [];
  const system = [
    "CLIENT MESSAGE READ. You are the reading engine of a small contracting business's CRM. A client (homeowner) just wrote in. Answer JSON only:",
    '{"intent": string|null, "urgent": boolean, "needsReply": boolean, "summary": string|null, "requests": string[], "changes": string[], "deadlines": [{"what": string, "date": "YYYY-MM-DD"|null}], "questions": string[], "money": string[], "complaints": string[], "promises": [{"text": string, "due": "YYYY-MM-DD"|null}], "facts": [{"category": string, "fact": string, "supersedesId": string|null}], "suggested": string|null}',
    "Rules:",
    "- Only what the message says. Never invent a number, a date or a preference; unsure = leave it out. An informal message is never a contract and never changes an approved amount.",
    "- intent: one short phrase (ready to proceed · asking a question · complaint · scheduling · payment …). urgent: true only for a real problem or a hard time pressure. needsReply: false only for a plain thanks or acknowledgement.",
    "- summary: one or two sentences, at most 40 words.",
    "- deadlines: resolve relative words to a date only when the message pins it; else date null.",
    "- promises: only what the CLIENT commits to do ('I'll pay Friday'). What they ask US to do goes in requests.",
    "- facts: at most 3, worth remembering next month, category CONTACT | PROJECT | DECISION | COMMITMENT | MONEY | PREFERENCE | HOUSE. Skip anything KNOWN FACTS already say; a fact that replaces a known one carries its id as supersedesId.",
    "- suggested: ONE short imperative for the contractor, or null.",
  ].join("\n");
  const user = [
    `CHANNEL: ${input.channel}${input.subject ? ` · SUBJECT: ${input.subject}` : ""}`,
    known.length ? `KNOWN FACTS:\n${known.map((f) => `- [${f.id}] (${f.category}) ${f.fact}`).join("\n")}` : "KNOWN FACTS: none",
    `MESSAGE:\n${clip(input.body, 4000)}`,
  ].join("\n\n");

  let read: MessageRead;
  let rawFacts: RawFact[] = [];
  try {
    const completion = await getOpenAI().chat.completions.create({
      model: await resolveOpenAIModel(),
      ...(await samplingOptions(0)),
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
    });
    const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as Record<string, unknown>;
    read = parseMessageRead(parsed);
    rawFacts = Array.isArray(parsed.facts) ? (parsed.facts as RawFact[]) : [];
  } catch (err) {
    if (typeof (err as { status?: unknown })?.status === "number") await trial.refund();
    console.warn("[inbox-read] not read:", input.threadId, err instanceof Error ? err.message : err);
    return null;
  }

  // The panel's copy on the thread, with where it came from.
  await db.clientThread.updateMany({
    where: { id: input.threadId, organizationId: input.organizationId },
    data: {
      aiReadJson: JSON.stringify({ ...read, at: new Date().toISOString(), channel: input.channel, sourceId: input.sourceId ?? null }),
      ...(read.urgent ? { urgent: true } : {}),
      // A message that needs no answer leaves the thread as it was before the bump said NEEDS_REPLY.
      ...(read.needsReply ? {} : { status: "OPEN" }),
    },
  });

  if (input.clientId) {
    await foldClientFacts(input.organizationId, input.clientId, rawFacts, { sourceKind: input.channel, sourceId: input.sourceId ?? null, sourceAt: new Date() });
    for (const p of read.promises) {
      const open = await db.clientPromise.findFirst({ where: { organizationId: input.organizationId, clientId: input.clientId, status: "OPEN", direction: "THEIRS", text: p.text }, select: { id: true } });
      if (open) continue;
      await db.clientPromise.create({
        data: {
          organizationId: input.organizationId,
          clientId: input.clientId,
          direction: "THEIRS",
          text: p.text,
          dueAt: p.due ? new Date(`${p.due}T17:00:00`) : null,
          sourceKind: input.channel,
          sourceId: input.sourceId ?? null,
          sourceAt: new Date(),
        },
      });
    }
  }
  return read;
}
