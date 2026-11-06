// MOBILE ASSISTANT — /mobile-assistant-v1 (2026-11-04)
//
// The JobFlex Assistant on a phone: where the handheld drawers' and the More
// sheet's Assistant row go (on a desk the row opens the side panel instead —
// components/v3/assistant). Always the phone design, at any width.
//
// No server read: the conversation is the person's own, loaded by the page
// through actions/assistant, which resolves the session itself; every tool is
// gated again inside the engine (lib/assistant/actor).
//
// Gates: the (mobile) group layout maps this URL to /dashboard/proposals — the
// page every office and pipeline role holds and the field crew does not — and
// applies the same role gate the dashboard layout does. Middleware only matches
// /dashboard and /admin, so the redirect-to-login is this page's own.

import { redirect } from "next/navigation";
import type { Metadata, Viewport } from "next";
import { NoOrgError, UnauthorizedError, requireOrg } from "@/lib/orgContext";
import { MobileAssistant } from "@/components/v3/assistant/mobile-assistant";
import { assistantOpenFor } from "@/lib/assistant/open";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "AI Operator · JobFlex Mobile",
  description: "The JobFlex AI Operator — ask about your day, or tell it to price a job, send, schedule or text.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#0a0a0a",
  // The box stays above the on-screen keyboard where the browser supports it.
  interactiveWidget: "resizes-content",
};

export default async function MobileAssistantV1Page() {
  let userId: string;
  try {
    userId = (await requireOrg()).user.id;
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      redirect(`/auth/login?next=${encodeURIComponent("/mobile-assistant-v1")}`);
    }
    if (err instanceof NoOrgError) redirect("/dashboard?error=forbidden");
    throw err;
  }
  // Platform admins only until the owner opens it (lib/assistant/open).
  if (!(await assistantOpenFor(userId))) redirect("/mobile-v2");
  return <MobileAssistant />;
}
