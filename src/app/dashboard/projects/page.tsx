// Main projects — Blueprint edition. Pixel-identical port of the projects
// donor (jobflex-projects-blueprint_2.html).
//
// The sidebar, topbar and sprite come from the shared shell mounted in
// ../layout.tsx, so this page renders only the donor's `.content` children.
// /[id] is now a blueprint page too and sits right here in ./[id] — it
// REPLACED the classic record page rather than standing beside it, which
// reverses the side-by-side convention the earlier ports recorded. Only /new
// still lives under the (dashboard) route group on the classic layout; a
// static segment outranks a dynamic one, so it is unaffected by ./[id].
//
// The grid is NOT a fixture: the project book is read from the database here
// and the create dialog calls the real `createProject` server action (see
// projects-behavior.ts). The query is the archived classic page's — same
// where-clause (ARCHIVED hidden), same ordering, same job roll-up — so both
// editions describe the same book.

import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { isEstimatorRole, isWorkerRole, requireOrg, NoOrgError, UnauthorizedError } from "@/lib/orgContext";
import { db } from "@/lib/db";
import { ProjectsContent } from "@/components/v3/projects-blueprint/projects-content";
import { loadProjectBook } from "@/components/v3/projects-blueprint/project-book-load";
import { ProjectSpacesHome } from "@/components/v3/projects-blueprint/project-spaces";
import { spaceOfRow } from "@/components/v3/projects-blueprint/project-spaces-data";
import { parseSpace } from "@/lib/projectSpaces";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "JobFlex · Projects",
  description: "Projects — status filters and the full project book on one sheet.",
};

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // The workspace (2026-11-09, lib/projectSpaces): none chosen opens the three cards.
  const sp = await searchParams;
  const space = parseSpace(typeof sp.space === "string" ? sp.space : null);
  let organizationId: string;
  let role: string;
  try {
    const ctx = await requireOrg();
    organizationId = ctx.organizationId;
    role = ctx.role;
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login?next=%2Fdashboard%2Fprojects");
    if (err instanceof NoOrgError) redirect("/dashboard?error=forbidden");
    throw err;
  }

  if (!space) return <ProjectSpacesHome rows={await loadProjectBook(organizationId)} />;

  const [rows, clientRows] = await Promise.all([
    loadProjectBook(organizationId),
    // For the New Project dialog's client field (2026-09-18).
    db.client.findMany({
      where: { organizationId, deletedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true, address: true },
      take: 1000,
    }),
  ]);
  const clients = clientRows.map((c) => ({ id: c.id, name: c.name, street: (c.address ?? "").split("\n")[0]?.trim() ?? "" }));

  // "+ New client…" is createClient's door: sales and managers (an estimator is refused there).
  return <ProjectsContent key={space} space={space} allProjects={rows} projects={rows.filter((p) => spaceOfRow(p) === space)} clients={clients} canAddClient={!isEstimatorRole(role) && !isWorkerRole(role)} />;
}
