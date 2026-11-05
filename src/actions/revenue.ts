"use server";
import { requirePlatformAdmin } from "@/lib/orgContext";
import { startRevenueRead } from "@/lib/revenueSaved";

/** Admin → Revenue's Refresh: a new Stripe read behind the saved figures (lib/revenueSaved), unless one is running. */
export async function refreshRevenue(): Promise<void> {
  await requirePlatformAdmin();
  await startRevenueRead();
}
