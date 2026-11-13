// Admin · Roof facets (test) — /admin/roof-lab (2026-11-11, owner: "build the model … show all facets … only on admin
// side for testing, not for the working contractors").
//
// The platform's test bench for the roof facet engine (lib/roofFacets): pick any saved roof measurement and see its
// facets, ridges, hips and valleys drawn on the aerial photograph, beside EagleView's own figures for the same roof.
// It reads what the measurement already saved — nothing is ordered, and contractors see none of it.
//
// The (admin) layout guards the route group; this page guards itself too.

import type { Metadata } from "next";
import { drawRoofLab, listRoofLab } from "@/actions/adminRoofLab";
import { requirePlatformAdmin } from "@/lib/orgContext";
import { AdminRoofLabContent } from "@/components/v3/admin-roof-lab/roof-lab-content";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const metadata: Metadata = {
  title: "JobFlex Admin · Roof facets (test)",
  description: "The roof facet engine's test bench: facets, ridges, hips and valleys drawn on a saved roof.",
};

export default async function AdminRoofLabPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  await requirePlatformAdmin();
  const { m } = await searchParams;
  const rows = await listRoofLab();
  const openId = typeof m === "string" && m ? m : null;
  const first = openId ? await drawRoofLab(openId) : null;
  return <AdminRoofLabContent rows={rows} openId={openId} first={first} />;
}
