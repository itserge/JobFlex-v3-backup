import "server-only";
// THE SENTENCE AT THE TOP OF THE OVERVIEW (Project Overview part 3, 2026-11-09): one line on where the project
// stands. The AI is handed only the rules' results (summaryFacts) and writes one sentence; it is kept only when every
// number in it is one of the project's (sentenceOk) — otherwise the rules' own sentence (summaryFallback) stands. Kept
// in SyncState per project for the company's day and the facts it stood on (overviewSig): written again when the day
// or the facts change, so it costs one short call a day per project opened, at most a few.
import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import { db } from "@/lib/db";
import { getOpenAI, isOpenAIEnabled, isReasoningModelName, resolveOpenAIModel, samplingOptions } from "@/lib/sdk/openai";
import { noteRequestOrg } from "@/lib/trialMeter";
import { overviewSig, sentenceOk, summaryFacts, summaryFallback } from "./operator";
import type { Overview } from "./shared";

const keyOf = (projectId: string) => `overview:summary:${projectId}`;
type Stored = { day: string; sig: string; text: string; by: "ai" | "rules" };

export const SUMMARY_SCHEMA_NAME = "overview_line";
const Line = z.object({ sentence: z.string() });
const SYSTEM =
  "You write the one sentence at the top of a construction project's overview, for the contractor. Plain words, the way a site super would say it: where it stands and the one thing that matters most. One sentence, under 30 words. Use only the facts given; every number you write must appear in them, written the same way. No greeting, no advice beyond the facts.";

export type Summary = { text: string; by: "ai" | "rules"; fresh: boolean };

/** Today's sentence when it still stands on today's facts; the rules' sentence (not fresh) otherwise. */
export async function readSummary(projectId: string, day: string, name: string, ov: Overview): Promise<Summary> {
  const row = await db.syncState.findUnique({ where: { key: keyOf(projectId) }, select: { cursor: true } }).catch(() => null);
  try {
    const v = row ? (JSON.parse(row.cursor) as Partial<Stored>) : null;
    if (v && v.day === day && v.sig === overviewSig(ov) && typeof v.text === "string" && v.text) return { text: v.text, by: v.by === "ai" ? "ai" : "rules", fresh: true };
  } catch {
    // an unreadable row is written again
  }
  return { text: summaryFallback(name, ov), by: "rules", fresh: false };
}

/** Write today's sentence: the AI's when it passes the check, the rules' otherwise. Never throws. */
export async function writeSummary(organizationId: string, projectId: string, day: string, name: string, ov: Overview): Promise<Summary> {
  let text: string | null = null;
  if (isOpenAIEnabled()) {
    try {
      await noteRequestOrg(organizationId);
      const client = getOpenAI();
      const model = await resolveOpenAIModel();
      const res = await client.chat.completions.create({
        model,
        ...(isReasoningModelName(model) ? { reasoning_effort: "low" as const } : await samplingOptions(0.2)),
        max_completion_tokens: 400,
        response_format: zodResponseFormat(Line, SUMMARY_SCHEMA_NAME),
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: `The project's facts:\n${JSON.stringify(summaryFacts(name, ov), null, 1)}` },
        ],
      });
      const raw = res.choices[0]?.message?.content;
      const parsed = raw ? Line.safeParse(JSON.parse(raw)) : null;
      const said = parsed?.success ? parsed.data.sentence.trim() : "";
      if (said && sentenceOk(said, name, ov)) text = said;
      else if (said) console.warn(`[overview-summary] …${projectId.slice(-4)}: the AI's sentence failed the number check; the rules' sentence stands`);
    } catch (err) {
      console.warn(`[overview-summary] …${projectId.slice(-4)}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const stored: Stored = { day, sig: overviewSig(ov), text: text ?? summaryFallback(name, ov), by: text ? "ai" : "rules" };
  const cursor = JSON.stringify(stored);
  await db.syncState.upsert({ where: { key: keyOf(projectId) }, create: { key: keyOf(projectId), cursor }, update: { cursor } }).catch(() => undefined);
  return { text: stored.text, by: stored.by, fresh: true };
}
