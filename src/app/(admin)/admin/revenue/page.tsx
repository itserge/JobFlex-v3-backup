import { requirePlatformAdmin } from "@/lib/orgContext";
import { readRevenueView } from "@/lib/revenueSaved";
import { RevenueContent } from "@/components/v3/admin-revenue/revenue-content";
import { RevenueReading } from "@/components/v3/admin-revenue/revenue-reading";
import { RevenueUnavailable } from "@/components/v3/admin-revenue/revenue-unavailable";
import { isStripeEnabled } from "@/lib/sdk/stripe";
import { readSubscribersData } from "@/lib/subscribersRead";
import { readToolPlansNumbers } from "@/lib/toolPlans/numbersServer";

/** With no Stripe set up at all (a dev stand), the new plans' numbers from the platform's own record — a database
 *  read, never Stripe — beside the "unavailable" line. Wherever Stripe is set up the page is exactly as before. */
async function recordNumbers() {
  if (isStripeEnabled()) return null;
  try {
    const billing = await readSubscribersData();
    return { tools: await readToolPlansNumbers(billing.rows, "record"), currency: billing.metrics.currency };
  } catch (error) {
    console.error("[revenue] new plans' numbers unavailable", error instanceof Error ? error.name : "UnknownError");
    return null;
  }
}

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
  const fromRecord = view.kind === "failed" ? await recordNumbers() : null;
  if (fromRecord) return <RevenueUnavailable tools={fromRecord.tools} currency={fromRecord.currency} />;
  if (view.kind === "failed") return <main style={{ padding: 32 }}><h1>Revenue unavailable</h1><p>We couldn’t complete the Stripe read. No estimated totals are shown.</p><a href="/admin/revenue">Try again</a></main>;
  return <RevenueContent data={view.report} />;
}
