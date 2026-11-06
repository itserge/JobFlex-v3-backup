import "server-only";
// THE GOOGLE AERIAL ROOF MEASUREMENT, WITHOUT A SESSION (2026-11-05): the Solar read of the roof under a pin, kept
// as a RoofMeasurement row (source "solar") the way actions/roofMeasurement always kept it — the row the proposal's
// site photo and the roof estimator's reopening go by. Pulled out of the action so the AI Operator (lib/assistant/
// roof) measures the same way the Measure button does: the action is a wrapper over solarMeasure (session, page,
// then this). The trial allowance is taken here ("take") or waived by the caller ("covered") when its click already
// spent one on an aerial answer that held no roof.
import { db } from "@/lib/db";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { instantCompleteAddress, type EvOrderInput, type InstantRoofData } from "@/lib/eagleview";
import { getBuildingInsights, isSolarEnabled, SolarUnavailableError } from "@/lib/solar";
import { estimateSolarRoof, type SolarRoofEstimate } from "@/lib/roofSolarEstimate";
import { geocode } from "@/lib/maps";
import { enforceRateLimit, HOUR, RateLimitError } from "@/lib/rateLimit";
import { rowFigures } from "@/lib/roofDiagram/instantTotals";
import { toDTO, type StoredProvenance } from "@/lib/roofDiagram/dto";
import type { MeasurementProvenance, MeasurementSource, RoofMeasurementDTO } from "@/lib/roofDiagram/types";
import { takeTrialCap } from "@/lib/trialMeter";
import type { LimitKey } from "@/lib/planLimits";

interface LatLng {
  lat: number;
  lng: number;
}

export type SolarMeasureResult =
  | { ok: true; measurement: RoofMeasurementDTO }
  | { ok: false; error: string; code?: "PLAN_LIMIT_REACHED"; resource?: LimitKey };

/** One RoofMeasurement row from what a provider answered — the figures the Recent list and the hero read. */
export async function persistRoofMeasurement(p: {
  organizationId: string;
  createdById: string;
  source: MeasurementSource;
  input: EvOrderInput;
  origin: LatLng | null;
  instant: InstantRoofData | null;
  provenance: MeasurementProvenance;
}): Promise<RoofMeasurementDTO> {
  // The row's figures are the MAIN structure's, and the pitch column is the
  // pitch the page shows (measured families when there are any), so the
  // Recent list and the hero cannot disagree (audit 2026-09-08).
  const fig = rowFigures({
    instant: p.instant,
    provenance: p.provenance as Record<string, unknown>,
    columns: { areaSqft: null, squares: null, lat: p.origin?.lat ?? null, lng: p.origin?.lng ?? null },
  });
  const stored: StoredProvenance = { calibration: null, provenance: p.provenance };
  const row = await db.roofMeasurement.create({
    data: {
      organizationId: p.organizationId,
      createdById: p.createdById,
      source: p.source,
      address: p.input.address ?? p.instant?.address ?? null,
      city: p.input.city ?? null,
      state: p.input.state ?? null,
      zip: p.input.zip ?? null,
      lat: p.origin?.lat ?? p.instant?.lat ?? null,
      lng: p.origin?.lng ?? p.instant?.lng ?? null,
      areaSqft: fig.areaSqft,
      squares: fig.squares,
      predominantPitch: fig.predominantPitch,
      facetCount: fig.facetCount,
      instantRequestId: p.source === "solar" ? null : p.instant?.requestId ?? null,
      instantJson: p.instant ? JSON.stringify(p.instant) : null,
      // движок удалён: геометрия не пишется, поле схемы не тронуто
      modelJson: "{}",
      chimneyJson: "[]",
      provenanceJson: JSON.stringify(stored),
    },
  });
  return toDTO(row);
}

export function solarRoofData(estimate: SolarRoofEstimate, input: EvOrderInput): InstantRoofData {
  const structure = {
    areaSqft: estimate.areaSqft, squares: estimate.areaSqft / 100,
    pitch: estimate.pitchLabel, footprintSqft: estimate.footprintSqft,
    eaveHeightFt: null, outline: null, facetCount: null, shape: null,
    material: null, conditionRating: null, roofAgeYears: null, chimney: null,
    solarPanels: null, rooftopAcCount: null, occlusion: null, treeOverhang: null,
    confidence: null, materialRings: null,
  };
  return {
    requestId: "", address: instantCompleteAddress(input),
    lat: estimate.center.lat, lng: estimate.center.lng,
    structures: [structure], imagery: [],
    totals: {
      areaSqft: estimate.areaSqft, squares: estimate.areaSqft / 100,
      predominantPitch: estimate.predominantPitch12, pitchLabel: estimate.pitchLabel,
      maxEaveFt: null, facetCount: null, footprintSqft: estimate.footprintSqft,
    },
  };
}


/**
 * The Google measurement itself. Module-private, so the trial allowance can
 * only be waived from the server: "covered" when this click already spent its
 * allowance on an EagleView answer that held no roof.
 */
export async function solarMeasure(input: EvOrderInput, organizationId: string, userId: string, trialMode: "take" | "covered"): Promise<SolarMeasureResult> {
  if (!isSolarEnabled()) return { ok: false, error: "Google aerial measurement is not configured for this account." };
  if (!input || typeof input.address !== "string" || input.address.length > 500 ||
      [input.city, input.state, input.zip].some(v => typeof v !== "string" || v.length > 200)) {
    return { ok: false, error: "Choose a valid street address first." };
  }
  const validPin = (lat: unknown, lng: unknown): boolean =>
    typeof lat === "number" && Number.isFinite(lat) && Math.abs(lat) <= 90 &&
    typeof lng === "number" && Number.isFinite(lng) && Math.abs(lng) <= 180;
  if ((input.lat != null || input.lng != null) && !validPin(input.lat, input.lng)) {
    return { ok: false, error: "The map pin is invalid. Select the address again." };
  }
  if (!input.address.trim() && input.lat == null) return { ok: false, error: "Choose an address first." };
  try {
    await enforceRateLimit(`roof-solar:${organizationId}`, 30, HOUR, "aerial roof estimates");
    // Reopening the same estimate should not buy another Google lookup. Match
    // both the address and supplied pin, never another organization's row.
    const prior = await db.roofMeasurement.findFirst({
      where: {
        organizationId, source: "solar", address: input.address,
        city: input.city, state: input.state, zip: input.zip,
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60_000) },
      },
      orderBy: { createdAt: "desc" },
    });
    if (prior) {
      const measurement = toDTO(prior);
      const requestedPin = measurement.provenance.solarRequestedPin;
      const samePin = input.lat == null || input.lng == null || (requestedPin &&
        Math.abs(requestedPin.lat - input.lat) <= 0.00001 && Math.abs(requestedPin.lng - input.lng) <= 0.00001);
      if (measurement.provenance.solar && samePin) return { ok: true, measurement };
    }
    if (trialMode === "take") {
      const trial = await takeTrialCap(organizationId, "roofMeasurements");
      if (!trial.ok) return trial.failure;
    }
    const pin = input.lat != null && input.lng != null
      ? { lat: input.lat, lng: input.lng }
      : await geocode(instantCompleteAddress(input));
    if (!pin || !validPin(pin.lat, pin.lng)) return { ok: false, error: "Couldn't locate that house. Select a complete street address." };
    const result = estimateSolarRoof(await getBuildingInsights(pin.lat, pin.lng), pin);
    if (!result.ok) return result;
    const estimate = result.estimate;
    const measurement = await persistRoofMeasurement({
      organizationId, createdById: userId, source: "solar", input,
      // Every downstream photo (including proposal/PDF) uses the selected
      // building, while the original request pin stays available for reuse.
      origin: estimate.center, instant: solarRoofData(estimate, input),
      provenance: { solar: estimate, solarRequestedPin: pin, imageryQuality: estimate.imageryQuality, ...(estimate.imageryDate ? { imageryDate: estimate.imageryDate } : {}) },
    });
    // A logging failure must not report a successfully saved estimate as failed.
    await logActivity({ organizationId, actorId: userId, kind: TRAIL_KINDS.ESTIMATE,
      summary: `Created a Google aerial roof estimate at ${instantCompleteAddress(input)}`,
      meta: { trade: "roof", measurementId: measurement.id, source: "solar" },
    }).catch(() => console.warn("[roofMeasurement] solar activity log unavailable"));
    return { ok: true, measurement };
  } catch (err) {
    if (err instanceof RateLimitError) return { ok: false, error: err.message };
    if (err instanceof SolarUnavailableError) {
      return { ok: false, error: err.kind === "no-coverage"
        ? "Google has no high-resolution roof data for this address. Open an existing saved measurement or use verified site measurements."
        : err.kind === "config" ? "Google Solar access needs attention in the API account. Try an existing saved measurement."
        : "Google aerial data is temporarily unavailable. Please try again." };
    }
    // Avoid echoing provider URLs, API keys, or database diagnostics to clients.
    console.warn("[roofMeasurement] solar estimate failed", { name: err instanceof Error ? err.name : "unknown" });
    return { ok: false, error: "The aerial estimate could not be completed or saved. Please try again." };
  }
}
