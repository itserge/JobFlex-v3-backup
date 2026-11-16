// Bring your clients (owner, 2026-11-16: "move contractors' CRM base with clients to JobFlex from other platforms
// like Housecall Pro") — the files another program exports become this company's clients, their open invoices,
// upcoming jobs and history (components/v3/client-import, actions/dataImport, lib/import). The owner, an admin or a
// manager brings a book over; the limited roles go back to the clients list.

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isLimitedRole, NoOrgError, requireOrg, UnauthorizedError } from "@/lib/orgContext";
import { listImports } from "@/lib/import/server";
import { ClientImportPage } from "@/components/v3/client-import/import-page";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "JobFlex · Bring your clients", description: "Bring your clients, open invoices, upcoming jobs and history over from Housecall Pro, Jobber, ServiceTitan or a spreadsheet." };

export default async function Page() {
  let organizationId: string;
  try {
    const ctx = await requireOrg();
    if (isLimitedRole(ctx.role)) redirect("/dashboard/clients");
    organizationId = ctx.organizationId;
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login?next=%2Fdashboard%2Fclients%2Fimport");
    if (err instanceof NoOrgError) redirect("/dashboard?error=forbidden");
    throw err;
  }
  // A list that cannot be read leaves the page working: the person can still bring files in.
  const imports = await listImports(organizationId).catch((err) => {
    console.error("[import] list", err instanceof Error ? err.message : err);
    return [];
  });
  return <ClientImportPage imports={imports} />;
}
