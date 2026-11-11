// The fence takeoffs kept beside proposals at convert (lib/fence/savedTakeoff), read in bulk — the newest per
// proposal wins, as the inventory link is read (lib/inventoryPick inventoryLinkOf).

import { db } from "@/lib/db";
import { FENCE_TAKEOFF_EVENT, parseSavedTakeoff, type SavedFenceTakeoff } from "./savedTakeoff";

export async function savedTakeoffsFor(organizationId: string, proposalIds: ReadonlyArray<string | null | undefined>): Promise<Map<string, SavedFenceTakeoff>> {
  const out = new Map<string, SavedFenceTakeoff>();
  const ids = [...new Set(proposalIds.filter((x): x is string => !!x))];
  if (!ids.length) return out;
  const events = await db.activityEvent.findMany({
    where: { organizationId, kind: FENCE_TAKEOFF_EVENT, proposalId: { in: ids } },
    orderBy: { createdAt: "desc" },
    select: { proposalId: true, meta: true },
  });
  for (const e of events) {
    if (!e.proposalId || out.has(e.proposalId)) continue;
    const s = parseSavedTakeoff(e.meta);
    if (s) out.set(e.proposalId, s);
  }
  return out;
}
