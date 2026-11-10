import "server-only";
// THE FOLLOW-UP AGENT — the writing half (Smart CRM part 4, 2026-11-10). One follow-up, written for this client
// from what the CRM knows: where they stand (ClientBrief), what was learned (ClientFact), what the AI read in their
// last message, what is promised. The model only words it; the code decides whether the words may go
// (lib/followUps/agent draftOk — length, no link of its own, every number one of the facts'). Null = the standard
// words go instead. The call follows lib/inbox/drafts; on the stand, qa/fixtures/assistant-fake-openai answers the
// FOLLOW-UP DRAFT prompt.

import { db } from "@/lib/db";
import { getOpenAI, isOpenAIEnabled, resolveOpenAIModel, samplingOptions } from "@/lib/sdk/openai";
import { takeTrialCap } from "@/lib/trialMeter";
import { formatUSD } from "@/lib/email/build/client";
import { clip } from "@/lib/clientTimeline/shared";
import { draftOk, numbersIn } from "./agent";
import { voiceFor, type FollowUpChannel, type FollowUpContext } from "./copy";

export interface WriterInput {
  organizationId: string;
  clientId: string | null;
  channel: FollowUpChannel;
  trigger: string;
  ctx: FollowUpContext;
  proposal: { status: string; viewCount: number; sentAt: Date | null };
  /** How many follow-ups already went for this proposal. */
  earlier: number;
  now?: Date;
}

export interface WrittenFollowUp {
  subject: string | null;
  body: string;
}

const PURPOSE: Record<string, string> = {
  SENT: "They got the proposal and have not answered. A light nudge: make it easy to say yes, ask a question, or ask for a change.",
  VIEWED: "They opened the proposal and have not decided. Offer to go through whatever is holding them back.",
  ACCEPTED: "They accepted. Thank them and say what happens next, without naming a date.",
  PAID: "They paid. Thank them; ask for a short review if the work went well.",
  DECLINED: "They declined. No pressure: one honest offer to look at a version that fits, and thanks either way.",
};

export async function writeFollowUp(input: WriterInput): Promise<WrittenFollowUp | null> {
  if (!isOpenAIEnabled()) return null;
  const trial = await takeTrialCap(input.organizationId, "aiCalls");
  if (!trial.ok) return null;
  const now = input.now ?? new Date();
  const trigger = (input.trigger || "SENT").toUpperCase();

  const [brief, facts, thread, promises] = input.clientId
    ? await Promise.all([
        db.clientBrief.findUnique({ where: { clientId: input.clientId }, select: { summary: true } }),
        db.clientFact.findMany({ where: { organizationId: input.organizationId, clientId: input.clientId, status: "CURRENT" }, select: { category: true, fact: true }, orderBy: { createdAt: "desc" }, take: 10 }),
        db.clientThread.findFirst({ where: { organizationId: input.organizationId, clientId: input.clientId }, select: { aiReadJson: true } }),
        db.clientPromise.findMany({ where: { organizationId: input.organizationId, clientId: input.clientId, status: "OPEN" }, select: { direction: true, text: true }, take: 4 }),
      ])
    : [null, [], null, []];

  let lastRead: string | null = null;
  try {
    const r = thread?.aiReadJson ? (JSON.parse(thread.aiReadJson) as { summary?: unknown }) : null;
    lastRead = typeof r?.summary === "string" ? r.summary : null;
  } catch {
    lastRead = null;
  }
  const days = input.proposal.sentAt ? Math.max(0, Math.round((now.getTime() - input.proposal.sentAt.getTime()) / 86_400_000)) : null;

  const system = [
    "FOLLOW-UP DRAFT. You write ONE follow-up message from a small contracting business to a homeowner about a proposal. Answer JSON only:",
    '{"subject": string|null, "body": string}',
    "Rules:",
    input.channel === "TEXT"
      ? "- This is a TEXT MESSAGE: one message under 240 characters, subject null."
      : "- This is an EMAIL: two or three short paragraphs separated by a blank line, under 110 words in all; subject under 60 characters.",
    "- Plain, warm, direct, first person — the contractor's own voice. Open with 'Hi <first name> —'. No 'I hope this finds you well', no sign-off block, no company name at the end.",
    "- Use what the history says: what they asked for, what matters to them, their deadline. One specific detail beats three.",
    "- Never invent a price, a discount, a date, a deadline or a promise. The only numbers you may write are numbers in FACTS.",
    "- Never write a link, a web address, an email address or a placeholder — the proposal button or link is added for you.",
    "- If we still owe them something (WE PROMISED), do not chase: say it is coming.",
  ].join("\n");
  const user = [
    `MOMENT: ${voiceFor(trigger).moment}. ${PURPOSE[trigger] ?? PURPOSE.SENT}`,
    "FACTS:",
    `- Company: ${input.ctx.orgName}`,
    `- Client: ${input.ctx.clientName}`,
    `- Proposal: ${input.ctx.title} — ${formatUSD(input.ctx.total)}`,
    days !== null ? `- Sent ${days} day${days === 1 ? "" : "s"} ago; opened ${input.proposal.viewCount} time${input.proposal.viewCount === 1 ? "" : "s"}` : `- Opened ${input.proposal.viewCount} time${input.proposal.viewCount === 1 ? "" : "s"}`,
    input.earlier ? `- Follow-ups already sent about it: ${input.earlier}` : "- This is the first follow-up about it",
    brief?.summary ? `- Where they stand: ${clip(brief.summary, 400)}` : "",
    lastRead ? `- Their last message, as read: ${clip(lastRead, 240)}` : "",
    facts.length ? `- Remembered:\n${facts.map((f) => `  · (${f.category}) ${clip(f.fact, 160)}`).join("\n")}` : "",
    promises.filter((p) => p.direction === "OURS").length ? `- WE PROMISED: ${promises.filter((p) => p.direction === "OURS").map((p) => clip(p.text, 120)).join("; ")}` : "",
    promises.filter((p) => p.direction === "THEIRS").length ? `- They said they would: ${promises.filter((p) => p.direction === "THEIRS").map((p) => clip(p.text, 120)).join("; ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

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
    const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as { subject?: unknown; body?: unknown };
    const body = typeof parsed.body === "string" ? parsed.body.trim() : "";
    if (!draftOk(body, input.channel, user)) {
      console.warn("[follow-up-writer] draft refused by the guard:", input.ctx.title);
      return null;
    }
    let subject = input.channel === "EMAIL" && typeof parsed.subject === "string" ? parsed.subject.replace(/\s+/g, " ").trim() : null;
    // A subject with a number the facts never gave, or one too long: the standard subject stands.
    if (subject) {
      const allowed = new Set(numbersIn(user));
      if (subject.length > 90 || !numbersIn(subject).every((n) => allowed.has(n))) subject = null;
    }
    return { subject, body };
  } catch (err) {
    if (typeof (err as { status?: unknown })?.status === "number") await trial.refund();
    console.warn("[follow-up-writer] not written:", err instanceof Error ? err.message : err);
    return null;
  }
}
