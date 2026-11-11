// MOBILE TEXTING — /mobile-texting-v1
//
// The direct-review entry point for the handheld build of /dashboard/texting:
// always the phone design, at any width, so the composition can be opened on a
// desktop browser without resizing. The live /dashboard/texting serves the same
// build at ≤768px through its own viewport switch (texting-responsive.tsx) and
// the desk page above that; this route stands beside it.
//
// REAL DATA, NOT A FIXTURE. Both call the SAME read — loadTextingWorkspace in
// src/lib/settings/loadSettingsData.ts, with the org context each page resolved
// for itself — so the two URLs describe the same records and cannot drift.
// Every write is an existing action (@/actions/sms, @/actions/textRules).
//
// Gates: the (mobile) group layout maps this URL to /dashboard/texting and
// applies the same limited-role gate the dashboard layout does (INSTALLER /
// SALES / ESTIMATOR go home). Middleware only matches /dashboard and /admin, so
// the redirect-to-login is this page's own, like every other (mobile) route.

import { redirect } from "next/navigation";
import type { Metadata, Viewport } from "next";
import { NoOrgError, UnauthorizedError, requireOrg } from "@/lib/orgContext";
import { customPageGate } from "@/components/v3/upgrade-gate/custom-page-gate";
import { loadTextingWorkspace } from "@/lib/settings/loadSettingsData";
import { MobileTexting } from "@/components/v3/mobile-texting/mobile-texting";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Texting · JobFlex Mobile",
  description: "Texting — your texting number, who on the team gets texts, texts to clients and texts you write yourself.",
};

// Handheld build: lock the scale so the layout is read at true device width,
// and pay out the notch / home-indicator insets.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#0a0a0a",
};

export default async function MobileTextingV1Page() {
  // Text messaging is a tool on the new plans; open on every Classic plan (lib/customPlan).
  const gate = await customPageGate("texting", { handheld: true });
  if (gate) return gate;
  let ctx;
  try {
    ctx = await requireOrg();
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      redirect(`/auth/login?next=${encodeURIComponent("/mobile-texting-v1")}`);
    }
    if (err instanceof NoOrgError) redirect("/dashboard?error=forbidden");
    throw err;
  }

  const sms = await loadTextingWorkspace(ctx);
  if (!sms) redirect("/dashboard?error=forbidden");

  return <MobileTexting sms={sms} />;
}
