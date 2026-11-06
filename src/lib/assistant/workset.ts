import "server-only";
// THE RECORDS IN THIS CONVERSATION, KEPT (2026-11-06, spec §4): the clients, leads, proposals, jobs, visits and crew
// the last turns touched (lib/assistant/shared workItemsFrom), under the person for three hours in SyncState
// `assistant:workset:<org>:<user>` — what "him", "it", "that job" mean, listed in the prompt with their ids. And the
// chain (spec §11): several changes planned in one turn, one yes for all, kept as their ids in order in
// `assistant:chain:<org>:<user>` until answered.
import { db } from "@/lib/db";
import type { AssistantActor } from "@/lib/assistant/actor";
import { mergeWorkItems, type WorkItem } from "@/lib/assistant/shared";

const WORKSET_TTL_MS = 3 * 60 * 60_000;
const worksetKey = (a: AssistantActor) => `assistant:workset:${a.organizationId}:${a.userId}`;
const chainKey = (a: AssistantActor) => `assistant:chain:${a.organizationId}:${a.userId}`;

async function readItems(actor: AssistantActor): Promise<WorkItem[]> {
  const row = await db.syncState.findUnique({ where: { key: worksetKey(actor) }, select: { cursor: true } }).catch(() => null);
  if (!row?.cursor) return [];
  try {
    const v = JSON.parse(row.cursor) as { items?: WorkItem[] };
    const cut = Date.now() - WORKSET_TTL_MS;
    return (v.items ?? []).filter((it) => it && typeof it.id === "string" && Date.parse(it.at) > cut);
  } catch {
    return [];
  }
}

/** Note what a turn touched. Nothing to note is a no-op; a failure never reaches the conversation. */
export async function noteWorkset(actor: AssistantActor, items: readonly WorkItem[]): Promise<void> {
  if (!items.length) return;
  try {
    const merged = mergeWorkItems(await readItems(actor), items);
    const cursor = JSON.stringify({ items: merged });
    const key = worksetKey(actor);
    await db.syncState.upsert({ where: { key }, create: { key, cursor }, update: { cursor } });
  } catch {
    /* the conversation goes on without it */
  }
}

/** The records of the last three hours, newest first, every one with its name (an id seen alone is named here). */
export async function recallWorkset(actor: AssistantActor): Promise<WorkItem[]> {
  const items = await readItems(actor);
  const org = actor.organizationId;
  const unnamed = (kind: WorkItem["kind"]) => items.filter((it) => it.kind === kind && !it.label).map((it) => it.id);
  const name = new Map<string, string>();
  try {
    const [clients, leads, proposals, jobs, visits, workers] = await Promise.all([
      unnamed("client").length ? db.client.findMany({ where: { id: { in: unnamed("client") }, organizationId: org }, select: { id: true, name: true } }) : [],
      unnamed("lead").length ? db.lead.findMany({ where: { id: { in: unnamed("lead") }, organizationId: org }, select: { id: true, name: true } }) : [],
      unnamed("proposal").length ? db.proposal.findMany({ where: { id: { in: unnamed("proposal") }, organizationId: org }, select: { id: true, title: true } }) : [],
      unnamed("job").length ? db.job.findMany({ where: { id: { in: unnamed("job") }, organizationId: org }, select: { id: true, title: true } }) : [],
      unnamed("visit").length ? db.appointment.findMany({ where: { id: { in: unnamed("visit") }, organizationId: org }, select: { id: true, title: true } }) : [],
      unnamed("worker").length ? db.workerProfile.findMany({ where: { id: { in: unnamed("worker") }, organizationId: org }, select: { id: true, displayName: true } }) : [],
    ]);
    for (const c of clients) name.set(`client:${c.id}`, c.name);
    for (const l of leads) name.set(`lead:${l.id}`, l.name);
    for (const p of proposals) name.set(`proposal:${p.id}`, p.title);
    for (const j of jobs) name.set(`job:${j.id}`, j.title);
    for (const v of visits) name.set(`visit:${v.id}`, v.title);
    for (const w of workers) name.set(`worker:${w.id}`, w.displayName);
  } catch {
    /* unnamed ones stay out of the prompt */
  }
  return items.map((it) => (it.label ? it : { ...it, label: name.get(`${it.kind}:${it.id}`) ?? "" }));
}

// ── the chain: several changes, one yes ───────────────────────────────────────

export async function setChain(actor: AssistantActor, ids: readonly string[]): Promise<void> {
  const key = chainKey(actor);
  const cursor = JSON.stringify({ ids, at: new Date().toISOString() });
  await db.syncState.upsert({ where: { key }, create: { key, cursor }, update: { cursor } }).catch(() => null);
}

/** The chain this action belongs to, in order — null when it stands alone. */
export async function chainOf(actor: AssistantActor, actionId: string): Promise<string[] | null> {
  const row = await db.syncState.findUnique({ where: { key: chainKey(actor) }, select: { cursor: true } }).catch(() => null);
  if (!row?.cursor) return null;
  try {
    const v = JSON.parse(row.cursor) as { ids?: string[] };
    return Array.isArray(v.ids) && v.ids.includes(actionId) ? v.ids : null;
  } catch {
    return null;
  }
}

export async function clearChain(actor: AssistantActor): Promise<void> {
  await db.syncState.deleteMany({ where: { key: chainKey(actor) } }).catch(() => null);
}
