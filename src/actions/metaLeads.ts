"use server";

import { revalidatePath } from "next/cache";
import { requireManager } from "@/lib/orgContext";
import { metaAllowed, MetaApiError } from "@/lib/meta/graph";
import { disconnectMetaPage, importMetaBatch, selectMetaPage } from "@/lib/meta/connections";
import { setMetaAutoImport } from "@/lib/meta/autoImport";
import { requirePage } from "@/lib/customPageAccess";

function message(error: unknown) {
  if (error instanceof MetaApiError) return error.message;
  // Deliberate user-facing errors only. Never expose Prisma/Zod payloads.
  if (error instanceof Error && error.constructor === Error) return error.message;
  return "Could not finish the Meta request. Please retry or reconnect your Page.";
}
function refresh() {
  revalidatePath("/dashboard/settings");
  revalidatePath("/mobile-settings-v1");
  revalidatePath("/dashboard/leads");
  revalidatePath("/mobile-leads-v2");
}
export async function chooseMetaPage(pageId: string) {
  try {
    const { organizationId, user } = await requireManager();
    if (!metaAllowed(user.email)) return { ok: false as const, error: "Meta is not enabled for this account yet." };
    await selectMetaPage(organizationId, user.id, pageId);
    refresh();
    return { ok: true as const };
  } catch (error) { return { ok: false as const, error: message(error) }; }
}
export async function disconnectMeta() {
  try {
    const { organizationId } = await requireManager();
    await disconnectMetaPage(organizationId);
    refresh();
    return { ok: true as const };
  } catch (error) { return { ok: false as const, error: message(error) }; }
}
export async function importMetaLeads(restart: boolean = false) {
  try {
    const { organizationId, user } = await requireManager();
    await requirePage(organizationId, "leads");
    if (!metaAllowed(user.email)) return { ok: false as const, error: "Meta is not enabled for this account yet." };
    const result = await importMetaBatch(organizationId, user.id, restart === true);
    refresh();
    return { ok: true as const, ...result };
  } catch (error) { return { ok: false as const, error: message(error) }; }
}
/** The Settings switch: new Facebook leads come into Leads by themselves (the cron, every 5 minutes). */
export async function setMetaLeadsAuto(on: boolean) {
  try {
    const { organizationId, user } = await requireManager();
    await requirePage(organizationId, "leads");
    if (!metaAllowed(user.email)) return { ok: false as const, error: "Meta is not enabled for this account yet." };
    await setMetaAutoImport(organizationId, on === true);
    refresh();
    return { ok: true as const };
  } catch (error) { return { ok: false as const, error: message(error) }; }
}
