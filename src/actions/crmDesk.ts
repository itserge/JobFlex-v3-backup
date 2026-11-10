"use server";

// THE CRM DESK — the read action. The phone CRM is mounted props-less, and the band re-reads through this after
// every send, skip, tick or new day, so both editions always show what the database says.

import { NoOrgError, UnauthorizedError, requireOrg, roleMayOpen } from "@/lib/orgContext";
import { readCrmDesk } from "@/lib/crm/deskServer";
import type { CrmDesk } from "@/lib/crm/desk";
import { pageLockedResult } from "@/lib/customPageAccess";

export type CrmDeskResult = { ok: true; data: CrmDesk } | { ok: false; error: string };

export async function getCrmDesk(): Promise<CrmDeskResult> {
  let ctx: Awaited<ReturnType<typeof requireOrg>>;
  try {
    ctx = await requireOrg();
  } catch (err) {
    if (err instanceof UnauthorizedError) return { ok: false, error: "Sign in to see the CRM." };
    if (err instanceof NoOrgError) return { ok: false, error: "Sign in to an organization to see the CRM." };
    throw err;
  }
  if (!roleMayOpen(ctx.role, "/dashboard/crm")) return { ok: false, error: "Your role doesn't include the CRM." };
  // The band is Smart CRM (part 4) — a paid feature (owner, 2026-11-09).
  const paused = await pageLockedResult(ctx.organizationId, "smart-crm");
  if (paused) return { ok: false, error: paused.error };
  const data = await readCrmDesk({ organizationId: ctx.organizationId, userId: ctx.user.id, role: ctx.role });
  return { ok: true, data };
}
