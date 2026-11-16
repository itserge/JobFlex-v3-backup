// Admin · Imports (2026-11-16, CRM migration plan part 4 — "Do it for me", free for everyone, within 2 business
// days). Contractors who sent the files their old program exported, newest first, the late ones in red. ?request=<id>
// opens one (the admins' email links there): the company, who asked, the note, the files (15-minute download links),
// and the workbench — read the files, check each column, see what comes in, Bring them in for the company
// (actions/importRequests). Cancel with a reason emails the company; both delete the files from storage.

import type { Metadata } from "next";
import { requirePlatformAdmin } from "@/lib/orgContext";
import { adminRequest, adminRequests } from "@/lib/import/requestServer";
import { AdminImportsContent } from "@/components/v3/client-import/admin-imports";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "JobFlex Admin · Imports",
  description: "Contractors' “Do it for me” imports: their exported files, brought in for them within 2 business days.",
};

export default async function AdminImportsPage({ searchParams }: { searchParams: Promise<{ request?: string | string[] }> }) {
  await requirePlatformAdmin();
  const sp = await searchParams;
  const openId = typeof sp.request === "string" ? sp.request.slice(0, 40) : null;
  const [rows, detail] = await Promise.all([
    // The table is not in this database yet (prisma/sql/prod-2026-11-16-import-requests.sql) → the page says so.
    adminRequests().catch(() => null),
    openId ? adminRequest(openId).catch(() => null) : Promise.resolve(null),
  ]);
  return <AdminImportsContent rows={rows} detail={detail} openId={openId} />;
}
