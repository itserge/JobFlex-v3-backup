"use server";
// THE LOT — the writes (2026-11-07, part 4 of the plan "Projects: Remodel and New construction"). Projects are
// estimators' and managers' (actions/projects), so every write is requireEstimatorOrManager and checked against
// the caller's company; the record lives on the project (lib/projectPhases/server saveLot). The parcel lookup reads
// the county's parcel map the way the deck's site plan does (lib/parcelLookup, cached and quota-floored), under the
// same hourly rate limit as the fence's lookups.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireEstimatorOrManager } from "@/lib/orgContext";
import { enforceRateLimit, HOUR } from "@/lib/rateLimit";
import { censusGeocode } from "@/lib/hvac/publicGeo";
import { geocode, isMapsEnabled } from "@/lib/maps";
import { lookupParcelByPoint } from "@/lib/parcelLookup";
import { logServerError } from "@/lib/server-events";
import { saveLot, type LotRecord } from "@/lib/projectPhases/server";

const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function touched(projectId: string) {
  revalidatePath(`/dashboard/projects/${projectId}`);
  revalidatePath(`/mobile-project-detail-v2/${projectId}`);
}

const lotInput = z.object({
  parcel: z
    .object({
      number: z.string().trim().max(60).nullable().optional(),
      zoning: z.string().trim().max(80).nullable().optional(),
      setbacks: z.string().trim().max(200).nullable().optional(),
      acres: z.number().min(0).max(100_000).nullable().optional(),
      floodZone: z.string().trim().max(80).nullable().optional(),
      address: z.string().trim().max(200).nullable().optional(),
    })
    .optional(),
  utilities: z
    .object({
      sewer: z.string().trim().max(80).nullable().optional(),
      water: z.string().trim().max(80).nullable().optional(),
      power: z.string().trim().max(80).nullable().optional(),
      gas: z.string().trim().max(80).nullable().optional(),
      fiber: z.string().trim().max(80).nullable().optional(),
    })
    .optional(),
  permits: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        number: z.string().trim().max(60).nullable().optional(),
        issued: DAY.nullable().optional(),
        expires: DAY.nullable().optional(),
        status: z.string().trim().max(40).nullable().optional(),
      }),
    )
    .max(40)
    .optional(),
  note: z.string().trim().max(2000).nullable().optional(),
});

export async function saveProjectLot(projectId: string, raw: unknown): Promise<LotRecord> {
  const { organizationId, user } = await requireEstimatorOrManager();
  const d = lotInput.parse(raw);
  const r = await saveLot(organizationId, projectId, d as LotRecord, user.id);
  touched(projectId);
  return r;
}

/**
 * The parcel from the county's map at the address: its number, acreage, owner and address land on the lot's
 * record. Zoning, setbacks and the flood zone are not in that record — the office types them. Never throws over the
 * lookup itself; the words say what to do.
 */
export async function lookupProjectLot(projectId: string, address: string): Promise<{ ok: true; lot: LotRecord; said: string } | { ok: false; error: string }> {
  const { organizationId, user } = await requireEstimatorOrManager();
  await enforceRateLimit(`parcels:${organizationId}`, 30, HOUR, "property lookups");
  const text = (address ?? "").trim().slice(0, 300);
  if (text.length < 8) return { ok: false, error: "Type the lot's street address first." };
  try {
    const census = await censusGeocode(text);
    const rooftop = isMapsEnabled() ? await geocode(text).catch(() => null) : null;
    const at = rooftop ?? (census ? { lat: census.lat, lng: census.lng } : null);
    if (!at) return { ok: false, error: "The address could not be found on the map — check it, or type the parcel number yourself." };
    const found = await lookupParcelByPoint(at.lat, at.lng, { withRecord: true });
    if (!found.ok) {
      if (found.reason === "not-found") return { ok: false, error: "The county's parcel map has no lot at this address — type the parcel number yourself." };
      if (found.error) logServerError("project-lot", new Error(found.error), { kind: "action", organizationId });
      return { ok: false, error: found.reason === "disabled" ? "Reading the county's parcel map isn't set up on this account — type the parcel number yourself." : "The county's parcel map did not answer just now — try again later, or type the parcel number yourself." };
    }
    const p = found.parcel;
    const lot = await saveLot(
      organizationId,
      projectId,
      {
        parcel: {
          number: p.parcelId ?? null,
          acres: p.acreage ?? null,
          address: [p.address, p.city, p.zip].filter(Boolean).join(", ") || text,
          owner: p.owner ?? null,
          source: p.cached ? "cache" : "reportall",
          lookedUpAt: new Date().toISOString().slice(0, 10),
        },
      },
      user.id,
    );
    touched(projectId);
    const said = `The county's parcel record${p.cached ? " (already on file)" : ""}: ${p.parcelId ? `parcel ${p.parcelId}` : "no parcel number"}${p.acreage ? `, ${p.acreage} acres` : ""}${p.owner ? `, owner ${p.owner}` : ""}. Zoning, setbacks and the flood zone are not in it — type them from the county's site.`;
    return { ok: true, lot, said };
  } catch (err) {
    logServerError("project-lot", err instanceof Error ? err : new Error(String(err)), { kind: "action", organizationId });
    return { ok: false, error: "The lookup did not go through — try again, or type the parcel number yourself." };
  }
}
