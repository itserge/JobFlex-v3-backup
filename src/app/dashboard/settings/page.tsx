// Settings — Blueprint edition. Port of the canonical settings donor
// (jobflex-settings-blueprint (6).html), with the owner's fix list applied on
// top (F1-F18: the three-column security row, the flush danger row, the
// processor cleanup, the custom dropdowns, the add-payout modal, the icon-less
// toggles, the notification event icons and column toggles).
//
// The sidebar, topbar, graph-paper field and shared sprite come from the shell
// mounted in ../layout.tsx, so this page renders only the donor's `.content`
// children. The classic settings index that used to serve this URL — a bare
// redirect to /dashboard/settings/account — was archived to
// old-design-pages/dashboard/settings/page.tsx.
//
// Its CHILD routes are untouched: /dashboard/settings/account, /billing,
// /team, /gmail, /meta and the rest still live under the (dashboard) route
// group and keep the classic layout.
//
// THE READ NOW LIVES IN src/lib/settings/loadSettingsData.ts. It was lifted out
// of this file unchanged when the handheld build (/mobile-settings-v1) arrived,
// so both surfaces fold one `SettingsData` object from one set of queries. It
// is a plain module, NOT "use server": an exported async function in an action
// file is a public RPC endpoint, so a read keyed by a caller-supplied org id
// would be a data leak. It takes the org context THIS page already resolved.
//
// Writes reuse what already existed wherever possible —
// `updatePaymentSettings` / `updateGmailSettings` / `updateMetaSettings` /
// `disconnectGmail` from src/actions/settings.ts — plus the three new
// account-scoped writes in src/actions/accountSettings.ts.

import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { NoOrgError, UnauthorizedError, requireOrg } from "@/lib/orgContext";
import { loadSettingsData } from "@/lib/settings/loadSettingsData";
import { SettingsResponsive } from "./settings-responsive";
import { railKeyFor } from "@/components/v3/settings-blueprint/settings-data";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "JobFlex · Settings",
  description:
    "Settings — account, billing, integrations and payments, and notifications on one sheet.",
};


export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // ?pane= deep-link: the legacy /dashboard/settings/* child routes redirect
  // here and land on their pane. An unknown value falls back to the default.
  const params = await searchParams;
  const paneValue = params.tab ?? params.pane;
  const rawPane = Array.isArray(paneValue) ? paneValue[0] : paneValue;
  if (rawPane === "desk") {
    const destination = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (key === "pane" || key === "tab" || value == null) continue;
      for (const item of Array.isArray(value) ? value : [value]) destination.append(key, item);
    }
    destination.set("tab", "settings");
    redirect(`/dashboard/phone?${destination.toString()}`);
  }
  // Texting is its own page since 2026-10-16: old ?pane=texting / ?tab=texting links land there, other params kept.
  // (A #texting-own-number fragment never reaches the server; the browser carries it across the redirect.)
  if (rawPane === "texting") {
    const destination = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (key === "pane" || key === "tab" || value == null) continue;
      for (const item of Array.isArray(value) ? value : [value]) destination.append(key, item);
    }
    const query = destination.toString();
    redirect(`/dashboard/texting${query ? `?${query}` : ""}`);
  }
  // ?pane=payments (the section's old name) opens Integrations / Payments.
  const initialPane = railKeyFor(rawPane);
  let ctx;
  try {
    ctx = await requireOrg();
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login?next=%2Fdashboard%2Fsettings");
    if (err instanceof NoOrgError) redirect("/dashboard?error=forbidden");
    throw err;
  }

  const data = await loadSettingsData(ctx, { billingLive: initialPane === "billing" });
  if (!data) redirect("/dashboard?error=forbidden");

  // One URL, two designs — the switch picks by media query on the client; see
  // ./settings-responsive.tsx. Both halves get this same server read.
  return <SettingsResponsive data={data} initialPane={initialPane} />;
}
