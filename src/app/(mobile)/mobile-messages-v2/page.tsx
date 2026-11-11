// Mobile messages — mobile-messages-v2. A handheld-first rebuild of the
// Messages surface in the Blueprint design system, sibling to /mobile-v2
// (Overview), /mobile-proposals-v2 and /mobile-clients-v2. Lives beside the
// desktop /dashboard/messages rather than replacing it, per the mobile route
// strategy.
//
// Built with the jobflex-page-styler skill (visual system: tokens, palette,
// type scale, Motion System "Balanced", FLUID SCALE) and the
// mobile-app-ui-design skill (structure: thumb zone, ≥44px targets, bottom
// sheets over modals, a full-screen thread instead of a second pane).
// Where the two disagree the house system wins — hard 3px offset shadows, 2px
// radii and Inter 900 caps stay, rather than the mobile skill's soft-shadow /
// rounded-3xl bubble defaults.
//
// Content is the ORG'S REAL INBOX (2026-08-21): the component mounts
// props-less and asks getMessagesSeed() for the same book the desktop
// /dashboard/messages page computes; writes go through the same server
// actions. See mobile-messages.tsx.
//
// Auth: middleware only matches /dashboard and /admin, so this page enforces
// its own redirect-to-login like the other design routes.

import type { Metadata, Viewport } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { customPageGate } from "@/components/v3/upgrade-gate/custom-page-gate";
import { MobileMessages } from "./mobile-messages";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Messages · JobFlex Mobile",
  description:
    "Blueprint-edition mobile messages: every crew thread in one rail, each opening full-screen with a docked composer.",
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

export default async function MobileMessagesV2Page() {
  const session = await auth();
  if (!session?.user?.id) {
    // Literal, not V3_PORTED_ROUTES.*: the key is added by the orchestrator
    // once every page in this batch has landed.
    redirect(`/auth/login?next=${encodeURIComponent("/mobile-messages-v2")}`);
  }
  // Team messages are a size's on the new plans (Professional and up); open on every Classic plan (lib/customPlan).
  const gate = await customPageGate("team-messages", { handheld: true });
  if (gate) return gate;

  return <MobileMessages />;
}
