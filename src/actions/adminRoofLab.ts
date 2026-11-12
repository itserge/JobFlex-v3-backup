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
  /**
   * What the measurement itself recorded about Google's height map of this roof — the engine reads the facets off it:
   * "good" (the building is all there), "partial" (trees, or part of it missing), "none" (no height map, or it shows
   * no building: the house is newer than Google's data), "unknown" (measured before this was recorded).
   */
  heightMap: "good" | "partial" | "none" | "unknown";
}

function heightMapOf(provenanceJson: string | null): RoofLabRow["heightMap"] {
  try {
    const p = ((JSON.parse(provenanceJson ?? "{}") as { provenance?: Record<string, unknown> }).provenance ?? {}) as { reconUnavailable?: unknown; coverage?: { share?: number } };
    if (p.reconUnavailable) return "none";
    const share = p.coverage?.share;
    if (typeof share !== "number") return "unknown";
    return share < 0.45 ? "none" : share < 0.85 ? "partial" : "good";
  } catch {
    return "unknown";
  }
}

export async function listRoofLab(query?: string): Promise<RoofLabRow[]> {
  await requirePlatformAdmin();
  // "12103 202nd St SE, Snohomish, WA" is typed as one line but kept as street, city, state and zip — and on older rows
  // the whole line sits in the street column. So every word has to be found somewhere, not the line in one place.
  const words = (query ?? "").replace(/[,;]+/g, " ").split(/\s+/).map((w) => w.trim()).filter(Boolean).slice(0, 8).map((w) => w.slice(0, 40));
  // Google-only estimates are listed too (2026-11-12): they are drawn inside Google's own outline of the building.
  const base = { instantJson: { not: null } };
  const read = (insensitive: boolean) => {
    const has = (w: string) => (insensitive ? { contains: w, mode: "insensitive" as const } : { contains: w });
    return db.roofMeasurement.findMany({
      where: words.length ? { ...base, AND: words.map((w) => ({ OR: [{ address: has(w) }, { city: has(w) }, { state: has(w) }, { zip: has(w) }] })) } : base,
      orderBy: { createdAt: "desc" },
      take: 80,
      select: { id: true, address: true, city: true, state: true, createdAt: true, areaSqft: true, facetCount: true, predominantPitch: true, provenanceJson: true, organization: { select: { name: true } } },
    });
  };
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
    heightMap: heightMapOf(r.provenanceJson),
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
