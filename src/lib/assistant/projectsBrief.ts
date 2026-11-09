import "server-only";
// THE PROJECTS IN THE MORNING BRIEFING (Project Overview part 2, 2026-11-09): the reads behind the paragraph
// (lib/projectOverview/brief) and the numbered replies it offers. Each open project's Overview is the project page's
// own (loadProjectDetail), so the text says what the screen says; the person's "Not now" rows stay hidden here too.
// The replies are kept as JSON in SyncState under the person, for the company's day: a digit reply runs one
// (lib/assistant/engine), until the model answers something else and its own "1 or 2?" may follow.
import { db } from "@/lib/db";
import { refusal, type AssistantActor } from "@/lib/assistant/actor";
import { dayOf } from "@/lib/assistant/shared";
import { loadProjectDetail } from "@/components/v3/project-detail-blueprint/project-detail-load";
import { readSnoozesFor } from "@/lib/projectOverview/server";
import { parsePicks, projectsBrief, type BriefPick, type ProjectsBrief } from "@/lib/projectOverview/brief";
import type { Overview } from "@/lib/projectOverview/shared";

/** The newest open projects read; a company with more gets these (the rest are on the Projects page). */
const MAX_PROJECTS = 20;
/** Projects read side by side. */
const AT_ONCE = 4;

export type OrgOverviews = { id: string; name: string; overview: Overview }[];

/** Every open project's Overview in a company. The minute job reads it once per company, for everyone briefed. */
export async function orgOverviews(organizationId: string): Promise<OrgOverviews> {
  const rows = await db.project.findMany({ where: { organizationId, status: "ACTIVE" }, orderBy: { updatedAt: "desc" }, take: MAX_PROJECTS, select: { id: true, name: true } });
  const out: OrgOverviews = [];
  for (let i = 0; i < rows.length; i += AT_ONCE) {
    const part = await Promise.all(
      rows.slice(i, i + AT_ONCE).map(async (p) => {
        const d = await loadProjectDetail(p.id, organizationId).catch(() => null);
        return d ? { id: p.id, name: p.name, overview: d.overview } : null;
      }),
    );
    for (const x of part) if (x) out.push(x);
  }
  return out;
}

/** The paragraph for one person, or null when they don't see projects or there are none open. */
export async function readProjectsBrief(actor: AssistantActor, now: Date, cache?: Map<string, Promise<OrgOverviews>>): Promise<ProjectsBrief | null> {
  if (await refusal(actor, "projects.read", false)) return null;
  const org = actor.organizationId;
  let read = cache?.get(org);
  if (!read) {
    read = orgOverviews(org);
    cache?.set(org, read);
  }
  const list = await read;
  if (!list.length) return null;
  const snoozes = await readSnoozesFor(org, actor.userId, list.map((x) => x.id), dayOf(now, actor.timezone)).catch(() => new Map());
  return projectsBrief(list.map((x) => ({ ...x, snoozes: snoozes.get(x.id) ?? {} })));
}

const picksKey = (organizationId: string, userId: string) => `assistant:brief-picks:${organizationId}:${userId}`;

/** Keep this morning's numbered replies (none: forget yesterday's). */
export async function savePicks(organizationId: string, userId: string, day: string, picks: readonly BriefPick[]): Promise<void> {
  const key = picksKey(organizationId, userId);
  if (!picks.length) {
    await db.syncState.deleteMany({ where: { key } });
    return;
  }
  const cursor = JSON.stringify({ day, picks });
  await db.syncState.upsert({ where: { key }, create: { key, cursor }, update: { cursor } });
}

/** Today's numbered replies, or [] (another day's, none, or forgotten). */
export async function readPicks(actor: AssistantActor, now: Date): Promise<BriefPick[]> {
  const row = await db.syncState.findUnique({ where: { key: picksKey(actor.organizationId, actor.userId) }, select: { cursor: true } }).catch(() => null);
  return parsePicks(row?.cursor, dayOf(now, actor.timezone));
}

/** The model answered something: a digit from now on may answer its own "1 or 2?", so the numbers are forgotten. */
export async function forgetPicks(organizationId: string, userId: string): Promise<void> {
  await db.syncState.deleteMany({ where: { key: picksKey(organizationId, userId) } });
}
