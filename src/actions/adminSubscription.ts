"use server";
// THE ADMIN'S SUBSCRIPTION EDITOR — the actions the sheet calls. The logic is
// lib/subscriptionEditor (two modes: change the billed plan on the Stripe
// subscription, or grant a complimentary plan with a term); this file adds the
// platform-admin gate and the cache revalidation.

import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/orgContext";
import { revalidatePlanSurfaces } from "@/lib/planCatalogServer";
import type { GrantFallback } from "@/lib/planGrant";
import {
  applySubscriptionChange,
  endGrantNow,
  previewSubscriptionChange,
  verifySubscriptionSync,
  type AdminSubscriptionApplyResult,
  type AdminSubscriptionPreviewResult,
  type VerifySyncResult,
} from "@/lib/subscriptionEditor";
import { cancelAsAdmin, readAdminCancelState, undoCancelAsAdmin, type AdminCancelMode, type AdminCancelResult, type AdminCancelState } from "@/lib/adminCancel";

export type { AdminCancelMode, AdminCancelResult, AdminCancelState } from "@/lib/adminCancel";
export type {
  AdminSubscriptionApplyResult,
  AdminSubscriptionChangeInput,
  AdminSubscriptionPreview,
  AdminSubscriptionPreviewResult,
  SubscriptionFacts,
} from "@/lib/subscriptionEditor";

function afterWrite() {
  revalidatePath("/admin");
  revalidatePath("/admin/users");
  revalidatePath("/admin/subscribers");
  revalidatePlanSurfaces();
  revalidatePath("/dashboard/subscription");
}

/* Cancel a live Stripe subscription from the organization's card (lib/adminCancel):
   at the end of the paid period, or now. The owner's own cancel stays in
   Settings → Billing only. */
export async function adminCancelSubscription(orgId: string, mode: AdminCancelMode, reason: string, notify: boolean): Promise<AdminCancelResult> {
  const admin = await requirePlatformAdmin();
  const r = await cancelAsAdmin({ organizationId: orgId, mode, reason, notify }, admin);
  if (r.ok) {
    afterWrite();
    revalidatePath("/admin/cancellations");
  }
  return r;
}

/** What the card's cancel strip shows: status, period end, a booked cancel and who made it. */
export async function adminCancelState(orgId: string): Promise<AdminCancelState> {
  await requirePlatformAdmin();
  return readAdminCancelState(orgId);
}

/** Undo a booked cancel at the period end — the owner's or an admin's. */
export async function adminUndoCancellation(orgId: string): Promise<AdminCancelResult> {
  const admin = await requirePlatformAdmin();
  const r = await undoCancelAsAdmin(orgId, admin);
  if (r.ok) afterWrite();
  return r;
}

export async function previewAdminSubscriptionChange(raw: unknown): Promise<AdminSubscriptionPreviewResult> {
  await requirePlatformAdmin();
  return previewSubscriptionChange(raw);
}

export async function applyAdminSubscriptionChange(raw: unknown): Promise<AdminSubscriptionApplyResult> {
  const admin = await requirePlatformAdmin();
  const r = await applySubscriptionChange(raw, { id: admin.id, email: admin.email });
  if (r.ok) afterWrite();
  return r;
}

export async function verifyAdminSubscriptionSync(organizationId: string): Promise<VerifySyncResult> {
  await requirePlatformAdmin();
  const r = await verifySubscriptionSync(organizationId);
  if (r.ok) afterWrite();
  return r;
}

export async function endPlanGrantNow(
  organizationId: string,
  fallback: GrantFallback,
  reason: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = await requirePlatformAdmin();
  const r = await endGrantNow(organizationId, fallback, reason, { id: admin.id, email: admin.email });
  if (r.ok) afterWrite();
  return r;
}
