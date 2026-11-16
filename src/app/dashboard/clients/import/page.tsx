// Bring your clients (owner, 2026-11-16: "move contractors' CRM base with clients to JobFlex from other platforms
// like Housecall Pro") — the files another program exports become this company's clients, their open invoices,
// upcoming jobs and history (components/v3/client-import, actions/dataImport, lib/import), or are sent to the team
// with "Do it for me" (actions/importRequests). The owner, an admin or a manager brings a book over; the limited roles
// go back to the clients list. ?from=<program> (a /switch page's slug, or its id) opens on that program.

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isLimitedRole, NoOrgError, requireOrg, UnauthorizedError } from "@/lib/orgContext";
import { listImports } from "@/lib/import/server";
import { requestsFor } from "@/lib/import/requestServer";
import { isImportSource, sourceBySlug, type ImportSource } from "@/lib/import/sources";
import { ClientImportPage } from "@/components/v3/client-import/import-page";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "JobFlex · Bring your clients", description: "Bring your clients, open invoices, upcoming jobs and history over from Housecall Pro, Jobber, ServiceTitan or a spreadsheet." };

function sourceFrom(v: string | string[] | undefined): ImportSource | null {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) return null;
  if (isImportSource(s.toUpperCase())) return s.toUpperCase() as ImportSource;
  return sourceBySlug(s.toLowerCase())?.id ?? null;
}

export default async function Page({ searchParams }: { searchParams: Promise<{ from?: string | string[] }> }) {
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
  const sp = await searchParams;
  // A list that cannot be read leaves the page working: the person can still bring files in.
  const [imports, requests] = await Promise.all([
    listImports(organizationId).catch((err) => {
      console.error("[import] list", err instanceof Error ? err.message : err);
      return [];
    }),
    requestsFor(organizationId).catch((err) => {
      console.error("[import] requests", err instanceof Error ? err.message : err);
      return [];
    }),
  ]);
  return <ClientImportPage imports={imports} requests={requests} initialSource={sourceFrom(sp.from)} />;
}
