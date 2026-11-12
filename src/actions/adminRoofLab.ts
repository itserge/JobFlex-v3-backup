"use server";

// ADMIN · ROOF FACET LAB — the actions behind /admin/roof-lab (2026-11-11, owner: "only on admin side for testing,
// not for the working contractors"). Two reads, both platform-admin only: the saved roof measurements to choose from
// (every company's — it is the platform's own test bench), and the facet drawing of one of them (lib/roofFacets).
// Nothing is written and nothing is ordered.

import { db } from "@/lib/db";
import { requirePlatformAdmin } from "@/lib/orgContext";
import { roofLabDrawing, type RoofLabDrawing } from "@/lib/roofFacets/server";

export interface RoofLabRow {
  id: string;
  address: string;
  place: string;
  company: string;
  measuredAt: string;
  areaSqft: number | null;
  facetCount: number | null;
  pitch: string | null;
}

export async function listRoofLab(query?: string): Promise<RoofLabRow[]> {
  await requirePlatformAdmin();
  const q = (query ?? "").trim().slice(0, 80);
  const base = { instantJson: { not: null }, source: { not: "solar" } };
  const read = (insensitive: boolean) =>
    db.roofMeasurement.findMany({
      where: q
        ? { ...base, OR: [{ address: insensitive ? { contains: q, mode: "insensitive" as const } : { contains: q } }, { city: insensitive ? { contains: q, mode: "insensitive" as const } : { contains: q } }] }
        : base,
      orderBy: { createdAt: "desc" },
      take: 80,
      select: { id: true, address: true, city: true, state: true, createdAt: true, areaSqft: true, facetCount: true, predominantPitch: true, organization: { select: { name: true } } },
    });
  // SQLite (the stand) has no case-insensitive mode — and its LIKE ignores ASCII case anyway.
  const rows = await read(true).catch(() => read(false));
  return rows.map((r) => ({
    id: r.id,
    address: r.address?.trim() || "No address",
    place: [r.city, r.state].filter(Boolean).join(", "),
    company: r.organization?.name ?? "",
    measuredAt: r.createdAt.toISOString(),
    areaSqft: r.areaSqft,
    facetCount: r.facetCount,
    pitch: r.predominantPitch,
  }));
}

export async function drawRoofLab(id: string): Promise<{ ok: true; drawing: RoofLabDrawing } | { ok: false; error: string }> {
  await requirePlatformAdmin();
  if (typeof id !== "string" || !id || id.length > 64) return { ok: false, error: "Pick a roof from the list." };
  try {
    const r = await roofLabDrawing(id);
    if (!r.ok) return { ok: false, error: r.reason };
    const { ok: _ok, ...drawing } = r;
    void _ok;
    return { ok: true, drawing };
  } catch (err) {
    console.error("[roof-lab] drawing failed:", err);
    return { ok: false, error: "The facet engine stopped on this roof. The error is in the server log." };
  }
}
