import "server-only";
// THE CLIENT'S MEMORY AND BRIEF (Smart CRM part 1, 2026-11-08; the plan doc "JobFlex Smart CRM — plan").
//
// MEMORY — ClientFact rows: structured, source-linked lines ("Decking: composite, was cedar"), each pointing at the
// message, call or note it came from. The AI adds facts when the brief is rebuilt; a person can add one by hand or
// remove one (status RETRACTED — never deleted, so the history stays). A new fact that replaces an old choice marks
// the old row SUPERSEDED instead of overwriting it: the contradiction stays readable, the newer choice wins.
//
// BRIEF — ClientBrief: the paragraph at the top of the client's page ("where they stand") and its one next step,
// rebuilt when the timeline has something newer than the last build. Built from the timeline and the known facts,
// never from thin air; the model is told to say only what the lines say. AI words are marked as AI on the page and
// never become a contract, a price or a confirmed record.
//
// The model call follows lib/smartbook/understand: resolveOpenAIModel + samplingOptions(0) + a json_object answer.
// On the stand, qa/fixtures/assistant-fake-openai answers the CLIENT BRIEF prompt with a canned brief.

import { db } from "@/lib/db";
import { getOpenAI, isOpenAIEnabled, resolveOpenAIModel, samplingOptions } from "@/lib/sdk/openai";
import { takeTrialCap } from "@/lib/trialMeter";
import type { ClientRef } from "@/lib/clientTimeline/server";
import { clip } from "@/lib/clientTimeline/shared";
export { briefCurrent, FACT_CATEGORIES, type FactCategory } from "@/lib/clientTimeline/shared";
import { FACT_CATEGORIES, type FactCategory } from "@/lib/clientTimeline/shared";
import type { TimelineEvent } from "@/lib/clientTimeline/shared";


const MAX_NEW_FACTS = 5;
const FACT_MAX = 180;

export interface ClientMemoryView {
  facts: Array<{ id: string; category: string; fact: string; sourceKind: string | null; sourceAt: Date | null; byAi: boolean; supersededText: string | null; supersededAt: Date | null }>;
  promises: Array<{ id: string; direction: string; text: string; status: string; dueAt: Date | null; keptAt: Date | null; sourceKind: string | null }>;
  brief: { summary: string; nextAction: string | null; builtAt: Date } | null;
}

/** What the client's page shows: current facts (each carrying the choice it replaced, if any), promises, the brief. */
export async function readClientMemory(organizationId: string, clientId: string): Promise<ClientMemoryView> {
  const [facts, olds, promises, brief] = await Promise.all([
    db.clientFact.findMany({ where: { organizationId, clientId, status: "CURRENT" }, orderBy: [{ category: "asc" }, { createdAt: "desc" }], take: 40 }),
    db.clientFact.findMany({ where: { organizationId, clientId, status: "SUPERSEDED" }, select: { fact: true, supersededById: true, sourceAt: true, createdAt: true }, take: 60 }),
    db.clientPromise.findMany({ where: { organizationId, clientId, status: { in: ["OPEN", "KEPT"] } }, orderBy: [{ status: "asc" }, { dueAt: "asc" }], take: 12 }),
    db.clientBrief.findUnique({ where: { clientId } }),
  ]);
  const replaced = new Map(olds.filter((o) => o.supersededById).map((o) => [o.supersededById!, o]));
  return {
    facts: facts.map((f) => {
      const old = replaced.get(f.id);
      return { id: f.id, category: f.category, fact: f.fact, sourceKind: f.sourceKind, sourceAt: f.sourceAt, byAi: f.byAi, supersededText: old?.fact ?? null, supersededAt: old ? (old.sourceAt ?? old.createdAt) : null };
    }),
    promises: promises.map((p) => ({ id: p.id, direction: p.direction, text: p.text, status: p.status, dueAt: p.dueAt, keptAt: p.keptAt, sourceKind: p.sourceKind })),
    brief: brief && brief.organizationId === organizationId ? { summary: brief.summary, nextAction: brief.nextAction, builtAt: brief.builtAt } : null,
  };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

interface BriefAnswer {
  summary?: unknown;
  nextAction?: unknown;
  newFacts?: unknown;
}

/** Rebuild the brief from the timeline the caller already read, and fold the model's new facts into the memory.
 *  Returns the saved brief, or null when the AI is off, the allowance is spent, or the model's answer was unusable —
 *  the page then shows the old brief or none, never an error. */
export async function rebuildClientBrief(client: ClientRef, timeline: readonly TimelineEvent[]): Promise<{ summary: string; nextAction: string | null; builtAt: Date } | null> {
  if (!isOpenAIEnabled()) return null;
  const { id: clientId, organizationId } = client;
  const known = await db.clientFact.findMany({ where: { organizationId, clientId, status: "CURRENT" }, select: { id: true, category: true, fact: true }, take: 40 });
  const trial = await takeTrialCap(organizationId, "aiCalls");
  if (!trial.ok) return null;

  const when = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ");
  const lines = timeline.slice(0, 45).map((e) => `- ${when(e.at)} [${e.kind} ${e.id}] ${e.title}${e.detail ? ` · ${e.detail}` : ""}`);
  const system = [
    "CLIENT BRIEF. You are the memory of a small contracting business's CRM. From the client's timeline and the known facts, answer JSON only:",
    '{"summary": string, "nextAction": string|null, "newFacts": [{"category": string, "fact": string, "sourceKind": string|null, "sourceId": string|null, "supersedesId": string|null}]}',
    "Rules:",
    "- Say only what the lines say. Never invent a name, a number, a date or a preference. Unsure = leave it out.",
    `- summary: where this client stands, at most 55 words, plain words, newest state first, end with what is being waited on. nextAction: ONE short imperative for the contractor, or null.`,
    `- newFacts: at most ${MAX_NEW_FACTS}, each under ${FACT_MAX} characters, category one of ${FACT_CATEGORIES.join(" | ")}. Only facts worth remembering next month (choices, preferences, constraints, money terms) — never a restating of one timeline event. Skip anything the KNOWN FACTS already say.`,
    "- A new fact that replaces a known one (they changed their mind) carries that fact's id as supersedesId.",
    "- sourceKind/sourceId: copy from the timeline line the fact came from (the [KIND id] tag), else null.",
  ].join("\n");
  const user = [
    `CLIENT: ${client.name}${client.email ? ` · ${client.email}` : ""}${client.phone ? ` · ${client.phone}` : ""}`,
    known.length ? `KNOWN FACTS:\n${known.map((f) => `- [${f.id}] (${f.category}) ${f.fact}`).join("\n")}` : "KNOWN FACTS: none yet",
    `TIMELINE (newest first):\n${lines.join("\n") || "- nothing yet"}`,
  ].join("\n\n");

  let parsed: BriefAnswer;
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
    parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as BriefAnswer;
  } catch (err) {
    if (typeof (err as { status?: unknown })?.status === "number") await trial.refund();
    console.warn("[client-brief] not built:", clientId, err instanceof Error ? err.message : err);
    return null;
  }

  const summary = typeof parsed.summary === "string" ? clip(parsed.summary, 460) : "";
  if (!summary) return null;
  const nextAction = typeof parsed.nextAction === "string" && parsed.nextAction.trim() ? clip(parsed.nextAction, 140) : null;

  // The new facts, checked: a real category, not a repeat, a real supersedes target. AI words stay marked byAi.
  const have = new Set(known.map((f) => norm(f.fact)));
  const byId = new Map(known.map((f) => [f.id, f]));
  const raw = Array.isArray(parsed.newFacts) ? parsed.newFacts.slice(0, MAX_NEW_FACTS) : [];
  for (const nf of raw) {
    const f = nf as { category?: unknown; fact?: unknown; sourceKind?: unknown; sourceId?: unknown; supersedesId?: unknown };
    const fact = typeof f.fact === "string" ? clip(f.fact, FACT_MAX) : "";
    const category = typeof f.category === "string" && (FACT_CATEGORIES as readonly string[]).includes(f.category) ? f.category : null;
    if (!fact || !category || have.has(norm(fact))) continue;
    have.add(norm(fact));
    const supersedesId = typeof f.supersedesId === "string" && byId.has(f.supersedesId) ? f.supersedesId : null;
    const made = await db.clientFact.create({
      data: {
        organizationId,
        clientId,
        category,
        fact,
        byAi: true,
        sourceKind: typeof f.sourceKind === "string" ? f.sourceKind.slice(0, 20).toUpperCase() : null,
        sourceId: typeof f.sourceId === "string" ? f.sourceId.slice(0, 120) : null,
        sourceAt: new Date(),
      },
    });
    if (supersedesId) {
      await db.clientFact.updateMany({ where: { id: supersedesId, organizationId, status: "CURRENT" }, data: { status: "SUPERSEDED", supersededById: made.id } });
    }
  }

  const builtAt = new Date();
  await db.clientBrief.upsert({
    where: { clientId },
    create: { clientId, organizationId, summary, nextAction, builtAt },
    update: { summary, nextAction, builtAt },
  });
  return { summary, nextAction, builtAt };
}

/** A fact a person typed in (byAi false), or removed — removal keeps the row as RETRACTED. */
export async function addClientFact(organizationId: string, clientId: string, category: FactCategory, fact: string): Promise<void> {
  await db.clientFact.create({ data: { organizationId, clientId, category, fact: clip(fact, FACT_MAX), byAi: false, sourceKind: "PERSON", sourceAt: new Date() } });
}

export async function retractClientFact(organizationId: string, factId: string): Promise<boolean> {
  const r = await db.clientFact.updateMany({ where: { id: factId, organizationId, status: { not: "RETRACTED" } }, data: { status: "RETRACTED" } });
  return r.count > 0;
}
