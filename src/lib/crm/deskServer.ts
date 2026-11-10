import "server-only";

// The CRM desk's reader — one call for the desktop page, the phone's action, and anything else that wants the
// same two lists the Today tab shows.

import { ownProposalsOnly } from "@/lib/assistant/roles";
import { readWaitingFollowUps } from "@/lib/followUps/server";
import { readPromiseTracker } from "@/lib/promises/server";
import type { CrmDesk } from "@/lib/crm/desk";

export async function readCrmDesk(input: { organizationId: string; userId: string; role: string; now?: Date }): Promise<CrmDesk> {
  const now = input.now ?? new Date();
  const viewer = { userId: input.userId, ownOnly: ownProposalsOnly(input.role) };
  const [waiting, tracker] = await Promise.all([readWaitingFollowUps(input.organizationId, viewer), readPromiseTracker(input.organizationId, viewer, now)]);
  const { tz, ...promises } = tracker;
  return { waiting, promises, tz, now: now.getTime(), me: input.userId, ownOnly: viewer.ownOnly };
}
