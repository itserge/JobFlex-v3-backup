import { requirePlatformAdmin } from "@/lib/orgContext";
import { getTrafficSnapshot } from "@/lib/posthog";
import { checkStripeReachable, getIntegrationStatuses } from "@/lib/sdk/integrations";
import { getStripeMode, stripeKeyFor } from "@/lib/stripeMode";
import { packRows } from "@/lib/eagleviewEntitlements";
import {
  AdminIntegrationsContent,
  type LiveMap,
} from "@/components/v3/admin-integrations/integrations-content";

export default async function AdminIntegrationsPage() {
  await requirePlatformAdmin();

  const items = await getIntegrationStatuses();

  // The only two services with a live check. Both are real round trips:
  // Stripe reads its balance, PostHog runs a HogQL query (cached 5 min in
  // lib/posthog, so this page does not re-issue it on every visit).
  const [stripe, traffic, stripeMode, evPacks] = await Promise.all([
    checkStripeReachable(),
    getTrafficSnapshot(),
    getStripeMode(),
    // What EagleView last said about each Property Data pack — the account's
    // entitlement table, read; nothing is ordered or probed by this page.
    packRows().catch(() => null),
  ]);
  const live: LiveMap = {
    stripe: stripe.state,
    posthog: traffic.status === "ok" ? "ok" : traffic.status === "error" ? "error" : "off",
  };

  return (
    <AdminIntegrationsContent
      items={items}
      live={live}
      stripeMode={stripeMode}
      stripeModes={{ live: Boolean(stripeKeyFor("live")), test: Boolean(stripeKeyFor("test")) }}
      evPacks={evPacks}
    />
  );
}
