// `/` — the landing. landing-e, promoted (owner call, 2026-09-16).
//
// landing-d carried the root from 2026-08-25; landing-e was its test copy at
// /landing-e (2026-09-10) with the honest trial copy, the three-field
// register, the first-estimate card, the welcome email and Google One Tap.
// The owner kept e and dropped d: this renders <LandingE /> from
// components/v3/landing-e, /landing-e redirects here, and landing-d is gone.
// Signed-in visitors are sent to work instead of to a pitch.
//
// TRADE VARIANT (2026-09-06). `?industry=fencing` (alias `?trade=`) swaps the
// hero for the fence estimator's; see landing-e/landing-variants.ts. Resolved
// HERE, on the server, from the query ONLY, so the first byte already carries
// the right hero — no client-side detection, no swap after paint. The
// jf_industry cookie is never consulted for the landing (owner, 2026-09-10):
// no parameter is always the default page; the cookie only pre-selects the
// trade on /auth/register. An unknown value is the default page too.

import type { Metadata, Viewport } from "next";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { detectInAppBrowser } from "@/lib/inAppBrowser";
import { LandingE } from "@/components/v3/landing-e/landing-e-page";
import { readLandingVariant } from "@/components/v3/landing-e/landing-variant-server";
import { SPOTLIGHT_COOKIE, SPOTLIGHT_VISIT_COOKIE } from "@/lib/planSpotlight";

export const dynamic = "force-dynamic";

const DEFAULT_METADATA: Metadata = {
  title: "JobFlex — Turn your trade into a business",
  description:
    "The operating system for small-shop contractors — estimating, proposals, scheduling, jobs, and invoicing in one workspace.",
};

// The HVAC page's own title, description and share card (2026-10-01): the
// link an HVAC ad or a shortcut (/hvac) carries unfurls as the HVAC page,
// not the general one. Every other variant keeps the default metadata.
const HVAC_METADATA: Metadata = {
  title: "JobFlex for HVAC — the whole system, priced from the address",
  description:
    "Design load, the heat pump that fits it, Good / Better / Best, the year's bill and the rebates — before the first site visit. Then the service plans, the seasonal visits, the units on file and the menu, in one app.",
  alternates: { canonical: "/?industry=hvac" },
  openGraph: {
    type: "website",
    url: "/?industry=hvac",
    siteName: "JobFlex",
    title: "JobFlex for HVAC — the whole system, priced from the address",
    description: "Load, heat pump, Good / Better / Best, the year's bill and the rebates before the first visit; service plans and visit reports after the install.",
  },
  twitter: { card: "summary", title: "JobFlex for HVAC", description: "The whole system, priced from the address. Service plans and visit reports after the install." },
};

export async function generateMetadata({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }): Promise<Metadata> {
  const { variant } = readLandingVariant(await searchParams);
  return variant === "hvac" ? HVAC_METADATA : DEFAULT_METADATA;
}

// Read at true device width — the page carries its own handheld build.
// `maximumScale` is deliberately NOT set: pinning it suppresses pinch-zoom and
// fails WCAG 2.2 SC 1.4.4 on a public marketing page.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Signed-in users have no use for the marketing landing — send them to work.
  const session = await auth();
  if (session?.user?.id) redirect("/dashboard");
  const landing = readLandingVariant(await searchParams);
  /* Instagram / Facebook / LINE / TikTok webview, read from the request (the
     page is dynamic already): the hero's buttons are on screen from the first
     paint now (2026-10-04), so the Google button — which Google refuses in a
     webview — has to be left out by the server, not taken away by the script
     seconds later (lib/inAppBrowser, as /auth/register does). */
  const inAppBrowser = detectInAppBrowser((await headers()).get("user-agent"));
  /* The plan cards only (lib/planSpotlight, owner 2026-11-07): the tool an earlier ad visit marked keeps its pinned
     row for 30 days, and the visit's session cookie keeps the other trades hidden until the browser closes. The hero
     never reads a cookie — no parameter is always the default page. */
  const jar = await cookies();
  return <LandingE {...landing} inAppBrowser={inAppBrowser} rememberedTool={jar.get(SPOTLIGHT_COOKIE)?.value} visitTool={jar.get(SPOTLIGHT_VISIT_COOKIE)?.value} />;
}
