"use server";
// THE AI OPERATOR, from the platform admin's side (2026-11-06): the kill switch on /admin/assistant — a tool switched
// off is never chosen for new work from the next turn (lib/assistant/registry), what was already planned still runs
// — and the readiness check run by hand, the same one the minute job records every hour (lib/assistant/health).
import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/orgContext";
import { setToolDisabled } from "@/lib/assistant/registry";
import { recordReadiness } from "@/lib/assistant/health";

export async function setAssistantToolDisabled(name: string, off: boolean): Promise<{ ok: true; disabled: string[] } | { ok: false; error: string }> {
  const admin = await requirePlatformAdmin();
  try {
    const disabled = await setToolDisabled(name, off);
    console.info(`[assistant] ${name} switched ${off ? "off" : "on"} for everyone by ${admin.email ?? admin.id} (admin console)`);
    revalidatePath("/admin/assistant");
    return { ok: true, disabled: [...disabled].sort() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't change that." };
  }
}

export async function runAssistantReadiness(): Promise<{ ok: true; warnings: number } | { ok: false; error: string }> {
  await requirePlatformAdmin();
  try {
    const r = await recordReadiness();
    revalidatePath("/admin/assistant");
    return { ok: true, warnings: r.warnings };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "The check didn't run." };
  }
}
