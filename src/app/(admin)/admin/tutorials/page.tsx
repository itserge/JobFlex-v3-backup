// ADMIN → TUTORIALS (owner, 2026-11-11: "add to admin statistics how many times the tutorials were watched and by
// who"). Platform admin only; read-only. The counts come from the Tutorials page's player (lib/tutorials/views).
import type { Metadata } from "next";
import { requirePlatformAdmin } from "@/lib/orgContext";
import { readTutorialViews } from "@/lib/tutorials/views";
import { TUTORIALS } from "@/lib/tutorials/catalog";
import { AdminTutorialsContent, type ViewRowDTO } from "@/components/v3/admin-tutorials/admin-tutorials-content";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "JobFlex Admin · Tutorials", description: "How many times each tutorial was watched, and by who." };

export default async function AdminTutorialsPage() {
  await requirePlatformAdmin();
  const rows: ViewRowDTO[] | null = await readTutorialViews()
    .then((list) => list.map((r) => ({ userId: r.userId, organizationId: r.organizationId, slug: r.slug, plays: r.plays, maxSec: r.maxSec, done: r.done, firstAt: r.firstAt, lastAt: r.lastAt, name: r.name, email: r.email, staff: r.staff, company: r.company })))
    .catch((err) => {
      console.error("[admin/tutorials]", err instanceof Error ? err.message : err);
      return null;
    });
  return <AdminTutorialsContent rows={rows} films={TUTORIALS.map((t) => ({ slug: t.slug, title: t.title, duration: t.duration }))} />;
}
