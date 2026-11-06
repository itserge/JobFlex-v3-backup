// Admin · AI Operator — /admin/assistant (2026-11-06, the owner's capability-registry spec §14–17).
//
// The registry as the Operator reads it this minute: every tool's card (what it is for, how it runs, the permission,
// the version), its state — live, switched off, missing a service, retired — its runs and failures in the last day
// and week with the last error, the services the registry leans on, and the hourly check's last record. The kill
// switch is here: a tool switched off is never chosen for new work from the next turn; what was planned still runs.
//
// The (admin) layout guards the route group; this page guards itself too.

import type { Metadata } from "next";
import { requirePlatformAdmin } from "@/lib/orgContext";
import { lastReadiness, operatorReadiness } from "@/lib/assistant/health";
import { AdminAssistantContent } from "@/components/v3/admin-assistant/assistant-content";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "JobFlex Admin · AI Operator",
  description: "The AI Operator's capability registry — every tool's state, use and failures, and the kill switch.",
};

export default async function AdminAssistantPage() {
  await requirePlatformAdmin();
  const [readiness, last] = await Promise.all([operatorReadiness(), lastReadiness()]);
  return <AdminAssistantContent data={readiness} last={last} />;
}
