import "server-only";
// THE OPERATOR'S NEW EARS AND BRAIN — THE SERVER PART (2026-11-13; the pure part and the why are in ./words).
// Which engine this person talks to (platform admins the new one while it is tested, unless they switched back),
// and the company's own words the ears are given. The person's own switch and words are read again every few
// seconds, so a change in Settings is heard on the next sentence; the company's records (crew, clients, leads)
// are kept a few minutes, so a conversation's turns don't each ask the database for them again.
import { db } from "@/lib/db";
import { readPrefs } from "@/lib/assistant/prefs";
import { engineFor, keywordsFrom, type OperatorEngine, type WordSources } from "@/lib/assistant/words";

const MINE_MS = 5_000;
const RECORDS_MS = 5 * 60_000;
type Mine = { at: number; engine: OperatorEngine; words: string[] };
type Records = { at: number; src: Omit<WordSources, "mine"> };
const mine = new Map<string, Mine>();
const records = new Map<string, Records>();
const trim = <T>(m: Map<string, T>, max = 500) => {
  while (m.size > max) m.delete(m.keys().next().value as string);
};

async function readMine(organizationId: string, userId: string): Promise<Mine> {
  const key = `${organizationId}:${userId}`;
  const hit = mine.get(key);
  if (hit && Date.now() - hit.at < MINE_MS) return hit;
  const [user, prefs] = await Promise.all([db.user.findUnique({ where: { id: userId }, select: { isPlatformAdmin: true } }), readPrefs(organizationId, userId)]);
  const fresh: Mine = { at: Date.now(), engine: engineFor(Boolean(user?.isPlatformAdmin), prefs.engine), words: prefs.words };
  mine.set(key, fresh);
  trim(mine);
  return fresh;
}

/** The engine this person talks to now. Never throws: anything unreadable is the engine before. */
export async function operatorEngine(organizationId: string, userId: string): Promise<OperatorEngine> {
  try {
    return (await readMine(organizationId, userId)).engine;
  } catch {
    return "classic";
  }
}

/** The switch or the words changed here: the next turn reads them again. */
export function forgetOperatorSpeed(organizationId: string, userId: string): void {
  mine.delete(`${organizationId}:${userId}`);
}

async function readRecords(organizationId: string): Promise<Omit<WordSources, "mine">> {
  const hit = records.get(organizationId);
  if (hit && Date.now() - hit.at < RECORDS_MS) return hit.src;
  const [crew, clients, leads] = await Promise.all([
    db.membership.findMany({ where: { organizationId }, select: { user: { select: { name: true } } }, take: 40 }),
    db.client.findMany({ where: { organizationId, deletedAt: null }, orderBy: { updatedAt: "desc" }, take: 60, select: { name: true, address: true, city: true } }),
    db.lead.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 20, select: { name: true, address: true, city: true } }).catch(() => []),
  ]);
  const src = { crew: crew.map((c) => c.user?.name ?? "").filter(Boolean), clients, leads };
  records.set(organizationId, { at: Date.now(), src });
  trim(records, 200);
  return src;
}

/** The words the ears are given for this person: their own, the crew, the newest clients and leads, their places. */
export async function operatorKeywords(organizationId: string, userId: string): Promise<string[]> {
  try {
    const [me, src] = await Promise.all([readMine(organizationId, userId), readRecords(organizationId)]);
    return keywordsFrom({ mine: me.words, ...src });
  } catch (err) {
    console.warn(`[assistant] keywords could not be read: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}
