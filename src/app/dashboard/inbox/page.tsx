// THE INBOX (Smart CRM part 2, 2026-11-08; route /dashboard/inbox). One thread per client: their texts, email
// replies, desk calls and portal notes together, the AI's reading of what they just said beside it, three reply
// drafts on request, and the answer sent from here. The CRM's Inbox tab lands here.
//
// Top-level under /dashboard for the same reason as client-detail: blueprint-shell's pageKey() reads the first path
// segment. `?f=` is the filter, `?t=` the open thread — query params, not segments, so the page key stays "inbox".

import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { NoOrgError, UnauthorizedError, requireOrg } from "@/lib/orgContext";
import { loadInbox } from "@/components/v3/inbox-blueprint/inbox-load";
import { InboxViewportSwitch } from "@/components/v3/inbox-blueprint/inbox-viewport-switch";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "JobFlex · Inbox",
  description: "Every client conversation in one place — texts, email replies, calls and portal messages.",
};

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ f?: string; t?: string }> }) {
  const { f, t } = await searchParams;
  let organizationId: string;
  let userId: string;
  try {
    const ctx = await requireOrg();
    organizationId = ctx.organizationId;
    userId = ctx.user.id;
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login?next=%2Fdashboard%2Finbox");
    if (err instanceof NoOrgError) redirect("/dashboard?error=forbidden");
    throw err;
  }
  const view = await loadInbox(organizationId, userId, f, t);
  return <InboxViewportSwitch view={view} />;
}
