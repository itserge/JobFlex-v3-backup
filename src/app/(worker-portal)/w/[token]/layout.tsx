import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { touchWorkerActivity } from "@/lib/workerActivity";
import { publicLinkPaused } from "@/lib/publicLinks";
import { LinkPaused } from "@/components/v3/upgrade-gate/link-paused";

export default async function WorkerPortalLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const worker = await db.workerProfile.findUnique({ where: { token }, select: { id: true } });
  if (!worker) return notFound();
  // The crew's link is paused while the company is on the Free plan (owner, 2026-11-09; lib/publicLinks): no
  // job, no address, no client — the job pages under it inherit this layout.
  if (await publicLinkPaused("crew", token)) return <LinkPaused />;

  // Worker opened their portal — record activity for the 6-month inactivity cron.
  await touchWorkerActivity(worker.id);

  // The layout draws no chrome (stage C, 2026-09-30). Each page brings its
  // own: the invite gate owns the whole viewport (worker-invite-blueprint),
  // the job list keeps the portal header and its 720px column (./page.tsx),
  // and a job is the dashboard's blueprint job page with the portal's bar
  // (./jobs/[assignmentId]) — a 720px column would crop its desk edition.
  return <>{children}</>;
}
