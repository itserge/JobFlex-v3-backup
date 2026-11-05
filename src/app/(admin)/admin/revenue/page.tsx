import { requirePlatformAdmin } from "@/lib/orgContext";
import { readRevenueView } from "@/lib/revenueSaved";
import { RevenueContent } from "@/components/v3/admin-revenue/revenue-content";
import { RevenueReading } from "@/components/v3/admin-revenue/revenue-reading";

// The saved read opens at once; a new one runs after the response (lib/revenueSaved) — this is its time.
export const maxDuration = 300;
export default async function RevenuePage() {
  await requirePlatformAdmin();
  let view;
  try { view = await readRevenueView(); }
  catch (error) {
    console.error("[revenue] report unavailable", error instanceof Error ? error.name : "UnknownError");
    view = { kind: "failed" } as const;
  }
  if (view.kind === "reading") return <RevenueReading />;
  if (view.kind === "failed") return <main style={{ padding: 32 }}><h1>Revenue unavailable</h1><p>We couldn’t complete the Stripe read. No estimated totals are shown.</p><a href="/admin/revenue">Try again</a></main>;
  return <RevenueContent data={view.report} />;
}
