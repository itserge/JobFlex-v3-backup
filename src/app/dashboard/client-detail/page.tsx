// Client detail — house blueprint skin (route: /dashboard/client-detail).
//
// The old record page at /dashboard/clients/[id] is deliberately NOT replaced.
// The two stand side by side so the composition can be judged before anything
// is migrated: this one is a stack of five differently-shaped bands, that one
// is a three-column grid of four same-weight cards.
//
// Top-level route under /dashboard on purpose: blueprint-shell's pageKey()
// reads the first path segment, so a child route would inherit its parent's
// page key and stylesheet. "client-detail" is deliberately absent from the
// shell's PAGE_STYLES map — this page carries its own self-scoped module
// instead (see the scoping note at the top of client-detail.module.css).
//
// NO LONGER A FIXTURE. `?client=<id>` — the param the clients list has been
// putting in the URL since the record became this page's destination — is read
// here and the row behind it is loaded by ./client-detail-load. The fixture
// survives as the FALLBACK for the bare route and for an id that resolves to
// nothing, so the composition stays reviewable without a database row to point
// at, and a stale link shows a page rather than a 404.
//
// The id is a query param and not a path segment because the route has no [id]
// dynamic segment: adding one would make this a child route, and a child route
// inherits its parent's page key, which is the one thing the placement note
// above exists to avoid.

import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { NoOrgError, UnauthorizedError, isLimitedRole, requireOrg } from "@/lib/orgContext";
import { ClientDetailViewportSwitch } from "@/components/v3/client-detail-blueprint/client-detail-viewport-switch";
import { loadClientDetail } from "@/components/v3/client-detail-blueprint/client-detail-load";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "JobFlex · Client",
  description: "One client record — particulars, figures, proposals, payments and activity.",
};

export default async function ClientDetailPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string }>;
}) {
  const { client: id } = await searchParams;

  let organizationId: string;
  let role = "";
  try {
    // requireOrg rather than a bare auth() check: the load is org-scoped, and a
    // signed-in user with no membership has no org to scope it to.
    ({ organizationId, role } = await requireOrg());
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      redirect("/auth/login?next=%2Fdashboard%2Fclient-detail");
    }
    if (err instanceof NoOrgError) redirect("/dashboard?error=forbidden");
    throw err;
  }

  // The office books repairs from a client (2026-11-09): the loader counts the jobs a repair could go back to.
  const view = await loadClientDetail(id, organizationId, { office: !isLimitedRole(role), role });
  // The PAGE owns the viewport switch (see the switch component's header): the
  // record is reached from the handheld clients book, so it needs the fleet's
  // mobile nav below 768px, and the loaded view cannot reach a props-less
  // component mounted by the layout. Above 768px this is exactly the desktop
  // page it has always been.
  return <ClientDetailViewportSwitch view={view} />;
}
