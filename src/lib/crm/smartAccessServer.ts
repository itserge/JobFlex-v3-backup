import "server-only";
// SMART CRM ON THIS PLAN — the server's answer (lib/crm/smartAccess for what the screens do with it). The same gate
// every Smart CRM action asks (lib/customPageAccess pageLock), as the session's user: a platform admin in the
// company opens everything, as everywhere. Fails closed, as the gate does: an unreadable plan reads as closed.
import { pageLock } from "@/lib/customPageAccess";
import type { SmartCrmAccess } from "@/lib/crm/smartAccess";

export async function smartCrmAccess(organizationId: string, role: string | null | undefined): Promise<SmartCrmAccess> {
  const owner = role === "OWNER";
  const { reason, tools } = await pageLock(organizationId, "smart-crm").catch(() => ({ reason: "not-included" as const, tools: false }));
  return { open: reason === null, tools: reason !== null && tools, ended: reason === "ended", owner };
}
