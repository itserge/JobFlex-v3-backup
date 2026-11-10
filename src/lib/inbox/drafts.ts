import "server-only";
// THREE REPLY DRAFTS (Smart CRM part 2, 2026-11-08): written from the thread and the client's memory, in the
// contractor's voice, on the Drafts button — never automatically, and nothing sends without a tap. The model call
// follows lib/smartbook/understand; on the stand, qa/fixtures/assistant-fake-openai answers the INBOX DRAFTS prompt.

import { db } from "@/lib/db";
import { getOpenAI, isOpenAIEnabled, resolveOpenAIModel, samplingOptions } from "@/lib/sdk/openai";
import { takeTrialCap } from "@/lib/trialMeter";
import { clip } from "@/lib/clientTimeline/shared";
import { readThreadMessages } from "./server";

export interface ReplyDraft {
  label: string;
  text: string;
}

export async function draftReplies(threadId: string, organizationId: string): Promise<ReplyDraft[] | null> {
  if (!isOpenAIEnabled()) return null;
  const thread = await db.clientThread.findUnique({ where: { id: threadId }, include: { client: { select: { id: true, name: true } }, organization: { select: { name: true } } } });
  if (!thread || thread.organizationId !== organizationId) return null;
  const trial = await takeTrialCap(organizationId, "aiCalls");
  if (!trial.ok) return null;

  const [messages, facts] = await Promise.all([
    readThreadMessages({ id: thread.id, organizationId, email: thread.email ?? null, phone: thread.phone ?? null }, 12),
    thread.clientId
      ? db.clientFact.findMany({ where: { organizationId, clientId: thread.clientId, status: "CURRENT" }, select: { category: true, fact: true }, take: 12 })
      : Promise.resolve([]),
  ]);

  const system = [
    "INBOX DRAFTS. You write reply drafts for a small contracting business answering a client. Answer JSON only:",
    '{"drafts": [{"label": string, "text": string}]}',
    "Rules:",
    "- Exactly 3 drafts, different in approach (answer and move forward · ask the one missing thing · offer a call or visit). label: 2–4 words.",
    "- Each text under 80 words, plain words, warm and direct, first person, no greeting lines like 'I hope this finds you well', no sign-off block.",
    "- Only facts from the conversation and the memory. Never invent a price, a date or a commitment. If a price or date is needed but unknown, the draft says it will follow.",
  ].join("\n");
  const user = [
    `COMPANY: ${thread.organization.name} · CLIENT: ${thread.client?.name ?? thread.name}`,
    facts.length ? `MEMORY:\n${facts.map((f) => `- (${f.category}) ${f.fact}`).join("\n")}` : "MEMORY: none",
    `CONVERSATION (oldest first):\n${messages.map((m) => `${m.direction === "IN" ? "THEM" : "US"} (${m.channel.toLowerCase()}): ${clip(m.body, 300)}`).join("\n")}`,
  ].join("\n\n");

  try {
    const completion = await getOpenAI().chat.completions.create({
      model: await resolveOpenAIModel(),
      ...(await samplingOptions(0.4)),
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
    });
    const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as { drafts?: unknown };
    const drafts = Array.isArray(parsed.drafts) ? parsed.drafts : [];
    const out = drafts
      .map((d) => {
        const r = (d && typeof d === "object" ? d : {}) as Record<string, unknown>;
        const label = typeof r.label === "string" ? clip(r.label, 40) : "";
        const text = typeof r.text === "string" ? clip(r.text, 700) : "";
        return label && text ? { label, text } : null;
      })
      .filter((d): d is ReplyDraft => d !== null)
      .slice(0, 3);
    return out.length ? out : null;
  } catch (err) {
    if (typeof (err as { status?: unknown })?.status === "number") await trial.refund();
    console.warn("[inbox-drafts] not written:", threadId, err instanceof Error ? err.message : err);
    return null;
  }
}
