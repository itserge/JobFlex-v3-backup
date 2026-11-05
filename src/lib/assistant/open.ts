import "server-only";
// WHO HAS THE ASSISTANT YET (owner, 2026-11-04: just me first — the same rule as the
// website estimators' "do not publish to all users till I tested it in admin
// account", lib/webEstimatorServer). Until the owner opens it, only platform admins
// see and use the Assistant: the rows, the panel, the page, Settings → Assistant,
// texts and calls. One switch, in Settings → Assistant (platform admins only),
// opens it to every account. Asked by lib/assistant/actor refusal(), so every path
// is closed the same way.
import { db } from "@/lib/db";

const OPEN_KEY = "assistant:open";

/** True once the owner opened the Assistant to every account. */
export async function assistantOpenToAll(): Promise<boolean> {
  const row = await db.syncState.findUnique({ where: { key: OPEN_KEY }, select: { cursor: true } }).catch(() => null);
  return row?.cursor === "1";
}

export async function setAssistantOpenToAll(on: boolean): Promise<void> {
  if (on) await db.syncState.upsert({ where: { key: OPEN_KEY }, create: { key: OPEN_KEY, cursor: "1" }, update: { cursor: "1" } });
  else await db.syncState.deleteMany({ where: { key: OPEN_KEY } });
}

/** May this person use the Assistant now: everyone once it's open, platform admins before. */
export async function assistantOpenFor(userId: string): Promise<boolean> {
  if (await assistantOpenToAll()) return true;
  const u = await db.user.findUnique({ where: { id: userId }, select: { isPlatformAdmin: true } }).catch(() => null);
  return Boolean(u?.isPlatformAdmin);
}
