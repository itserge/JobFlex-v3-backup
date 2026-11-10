// WORKER PORTAL · ONE JOB (stage C, 2026-09-30).
//
// The crew's magic-link door onto a job is now the SAME page the dashboard
// shows an installer at /dashboard/jobs/<id>: the blueprint job detail
// (job-detail-blueprint), desk and handheld editions, with the days on site,
// the photos and videos by day and the receipts (components/v3/crew-board).
// Two doors, one set of capabilities — the owner's rule. What differs is how
// a write is authenticated: here the record carries the portal's token and
// every crew write goes to the /api/crew routes that take it
// (lib/crewActor); on the dashboard it is the session.
//
// The old Tailwind work-order page (command hero, WorkerJobPanel with its own
// status buttons, photo grid and receipt form) is retired with this file.
// Accept / Decline moved onto the job's "Your assignment" block. The pick
// list is the blueprint's; "Loaded" stays an office-session action.

import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { loadJobDetailForPortal } from "@/components/v3/job-detail-blueprint/job-detail-load";
import { PortalJobFrame } from "@/components/v3/job-detail-blueprint/portal-job-frame";
import { publicLinkPaused } from "@/lib/publicLinks";
import { LinkPaused } from "@/components/v3/upgrade-gate/link-paused";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "JobFlex · Job",
  description: "Your job — where, what, the days on site, photos and receipts.",
};

export default async function WorkerAssignmentPage({
  params,
}: {
  params: Promise<{ token: string; assignmentId: string }>;
}) {
  const { token, assignmentId } = await params;
  if (await publicLinkPaused("crew", token)) return <LinkPaused />;
  const record = await loadJobDetailForPortal(token, assignmentId);
  if (!record) notFound();
  return <PortalJobFrame key={record.id} record={record} />;
}
