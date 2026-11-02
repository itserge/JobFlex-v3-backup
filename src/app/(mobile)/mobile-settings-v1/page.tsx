// MOBILE SETTINGS — /mobile-settings-v1
//
// The direct-review entry point for the handheld build of the settings hub:
// always the mobile design, at any width, so the composition can be opened on a
// desktop browser without resizing. The desktop hub at /dashboard/settings is
// untouched and keeps serving that URL at every viewport — this route stands
// beside it, per the mobile route strategy.
//
// REAL DATA, NOT A FIXTURE. Both surfaces call the SAME loader,
// src/lib/settings/loadSettingsData.ts, with the org context each page resolved
// for itself — so the preview URL and the live URL describe the same records
// and cannot drift. Every write reuses the actions the desktop panes already
// call (accountSettings / settings / paymentConnections / notifications).
//
// DEEP LINKS. The Stripe and Square OAuth callbacks come back with
// `?tab=payments&sub=stripe`; the legacy /dashboard/settings/* redirects use
// `?pane=`. All three are honoured here exactly as settings-content.tsx honours
// them — `tab` wins over `pane` — so a callback that lands on this URL opens
// the right section. There is no fourth parameter.
//
// Auth: middleware only matches /dashboard and /admin, so this route enforces
// its own redirect-to-login like every other (mobile) design route.

import { redirect } from "next/navigation";
import type { Metadata, Viewport } from "next";
import { NoOrgError, UnauthorizedError, requireOrg } from "@/lib/orgContext";
import { loadSettingsData } from "@/lib/settings/loadSettingsData";
import { MobileSettings } from "@/components/v3/mobile-settings/mobile-settings";
import { railKeyFor } from "@/components/v3/settings-blueprint/settings-data";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Settings · JobFlex Mobile",
  description:
    "Settings — account, payments, billing, integrations and notifications on one sheet.",
};

// Handheld build: lock the scale so the layout is read at true device width,
// and pay out the notch / home-indicator insets the shell reserves.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#0a0a0a",
};


export default async function MobileSettingsV1Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const value = params.tab ?? params.pane;
  const rawPane = Array.isArray(value) ? value[0] : value;
  // Texting left Settings for its own page (2026-10-16).
  if (rawPane === "texting") redirect("/dashboard/texting");
  if (rawPane === "desk") {
    const destination = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value == null) continue;
      for (const item of Array.isArray(value) ? value : [value]) destination.append(key, item);
    }
    redirect(`/dashboard/settings?${destination.toString()}`);
  }
  const initialPane = railKeyFor(rawPane);

  let ctx;
  try {
    ctx = await requireOrg();
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      redirect(`/auth/login?next=${encodeURIComponent("/mobile-settings-v1")}`);
    }
    if (err instanceof NoOrgError) redirect("/dashboard?error=forbidden");
    throw err;
  }

  const data = await loadSettingsData(ctx, { billingLive: initialPane === "billing" });
  if (!data) redirect("/dashboard?error=forbidden");

  return <MobileSettings data={data} initialPane={initialPane} />;
}
