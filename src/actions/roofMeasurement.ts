"use server";

// Замер крыши — data-only (roofcore). Движок построения модели удалён:
// этот модуль ДОБЫВАЕТ и сохраняет данные — EagleView Instant (леджер
// покупок, идемпотентность, дозабор), Google Solar/DSM (бесплатно),
// регистрацию контура к растру, метрику покрытия, completeness по
// строениям, парсель-вето. modelJson остаётся полем схемы; новый код его
// НЕ пишет ("{}").
//
// THE FIRST CLICK GETS THE MEASUREMENT; THE DETAILS LAND BEHIND IT
// (2026-09-18). The area pack is ordered alone and waited for alone
// (lib/eagleviewOrder); the moment it lands the other packs are ordered and
// the click returns with them saved as `pending` — the page collects them
// without a new charge and prices nothing until they are in. Nothing pending
// is ever re-bought: a re-measure skips packs the address already has,
// complete or on the way. The one exception is an area order the provider
// has sat on for STALE_PENDING_MS: it no longer blocks the address, and the
// page offers a new, billed lookup over it. The whole action runs under one
// budget (ACTION_BUDGET_MS) below the page's maxDuration, and the elevation
// pass takes only what is left of it.

import { requireEstimatorOrManager } from "@/lib/orgContext";

import { db } from "@/lib/db";
import {
  isEagleViewEnabled,
  mergeInstantResults,
  instantAddressKey,
  PD_PACK,
  type EvOrderInput,
  type InstantRoofData,
} from "@/lib/eagleview";
import { satellitePhotoPng } from "@/lib/staticMapPhoto";
import { orthoImage } from "@/lib/roofPictureFetch";
import {
  collectPlacedOrders,
  packReport,
  packsFromContent,
} from "@/lib/eagleviewOrder";

import { getBuildingInsights, isSolarEnabled } from "@/lib/solar";
// The Google measurement itself and the row it is kept as live in lib/roofSolarMeasure (2026-11-05), shared with the AI Operator.
import { solarMeasure } from "@/lib/roofSolarMeasure";
import { geocodePlace } from "@/lib/maps";

import { enforceRateLimit, HOUR } from "@/lib/rateLimit";
import { roofMeasurementProvider } from "@/lib/roofMeasurementProvider";









import { includedIndicesOf, mainStructureOf, rowFigures, userPinOf } from "@/lib/roofDiagram/instantTotals";
import { toDTO, toSummary, type StoredProvenance } from "@/lib/roofDiagram/dto";
import type { MeasurementProvenance, RoofMeasurementDTO, RoofMeasurementSummary } from "@/lib/roofDiagram/types";




import { requirePage } from "@/lib/customPageAccess";

// The measurement itself and its helpers live in lib/roofInstantMeasure (2026-11-06), shared with the AI Operator.
import {
  BACKGROUND_COLLECT_BUDGET_MS,
  LATE_RECON_DEADLINE_MS,
  type LatLng,
  type MeasureResult,
  type RoofOrderInput,
  areaFirst,
  cleanPin,
  completeOrdersFor,
  deniedNow,
  errorMessage,
  instantMeasure,
  orderDeps,
  pendingOrdersFor,
  witnessInstant,
} from "@/lib/roofInstantMeasure";

export async function collectPendingInstant(measurementId: string): Promise<
  | { ok: true; pending: number; updated: false }
  | { ok: true; pending: number; updated: true; measurement: RoofMeasurementDTO }
  | { ok: false; error: string }
> {
  let organizationId: string;
  try {
    organizationId = (await requireEstimatorOrManager()).organizationId;
    await requirePage(organizationId, "roof-estimator");
  } catch (err) {
    return { ok: false, error: errorMessage(err, "Not authorised") };
  }
  const row = await db.roofMeasurement.findFirst({ where: { id: measurementId, organizationId } });
  if (!row) return { ok: false, error: "Measurement not found" };
  // A Google result must never be merged with an unrelated EagleView order.
  if (row.source === "solar") return { ok: true, pending: 0, updated: false };
  const input: EvOrderInput = {
    address: row.address ?? "",
    city: row.city ?? "",
    state: row.state ?? "",
    zip: row.zip ?? "",
    lat: row.lat ?? undefined,
    lng: row.lng ?? undefined,
  };
  const addressKey = instantAddressKey(input);
  if (addressKey === "|||") return { ok: true, pending: 0, updated: false };
  // SELF-HEAL THE FACET COUNT (2026-10-16): the measured data sometimes
  // comes back without structure_roof_facet_count at all — the tile sat
  // on "—" forever. When the row has no measured count and the witnesses
  // never kept Google's segment count, one building-insights call fills
  // the ESTIMATE the page then shows as "≈N". Once per row (0 = Google
  // saw none — tried, nothing there); an API failure leaves null so a
  // later open may try again. Never touches the measured column.
  let healed: typeof row | null = null;
  if (row.facetCount == null && row.lat != null && row.lng != null && isSolarEnabled()) {
    try {
      const storedP = row.provenanceJson ? (JSON.parse(row.provenanceJson) as Partial<StoredProvenance>) : null;
      const prov = (storedP?.provenance ?? {}) as MeasurementProvenance;
      if (prov.googleSegmentCount == null) {
        const insights = await getBuildingInsights(row.lat, row.lng);
        prov.googleSegmentCount = insights?.segments?.length ?? 0;
        healed = await db.roofMeasurement.update({
          where: { id: row.id },
          data: { provenanceJson: JSON.stringify({ calibration: storedP?.calibration ?? null, provenance: prov }) },
        });
      }
    } catch (err) {
      console.warn("[roofMeasurement] facet-estimate heal skipped:", errorMessage(err, String(err)));
    }
  }
  const open = await pendingOrdersFor(organizationId, addressKey, input);
  if (!open.length) {
    // Nothing on order — but a healed estimate is still news the page
    // should swap in rather than keep its "—".
    if (healed) return { ok: true, pending: 0, updated: true, measurement: toDTO(healed) };
    return { ok: true, pending: 0, updated: false };
  }

  const deps = orderDeps(organizationId, addressKey, input);
  const c = await collectPlacedOrders(open, input, deps, BACKGROUND_COLLECT_BUDGET_MS);
  const stillPending = c.pending.flatMap((o) => o.packs);
  if (!c.landed.length && !c.failed.length) return { ok: true, pending: c.pending.length, updated: false };

  // Merge what landed into the saved answer — the stored answer is the base,
  // every null field takes the first later part's value (mergeInstantResults).
  let stored: InstantRoofData | null = null;
  try {
    stored = row.instantJson ? (JSON.parse(row.instantJson) as InstantRoofData) : null;
  } catch {
    stored = null;
  }
  const landed = c.landed.map((l) => l.instant);
  const merged = landed.length ? mergeInstantResults(stored ? [stored, ...landed] : areaFirst(landed)) : stored;
  if (!merged) return { ok: true, pending: c.pending.length, updated: false };

  let storedProv: StoredProvenance = { calibration: null, provenance: {} as MeasurementProvenance };
  try {
    const parsed = row.provenanceJson ? (JSON.parse(row.provenanceJson) as Partial<StoredProvenance>) : null;
    if (parsed && typeof parsed === "object") storedProv = { calibration: parsed.calibration ?? null, provenance: (parsed.provenance ?? {}) as MeasurementProvenance };
  } catch {
    /* unreadable provenance — rebuilt below with what is known */
  }
  const owned = await completeOrdersFor(organizationId, addressKey);
  const prior = storedProv.provenance.instantPacks;
  const packs = packReport(owned.have, await deniedNow(), [...(prior?.failed ?? []), ...c.failed.flatMap((o) => o.packs)], prior?.unknown ?? [], stillPending);

  // A late outline, pitch or details pack changes what the witnesses see:
  // re-run them, keeping what only the first click knew (the reuse note).
  const landedPacks = new Set(c.landed.flatMap((l) => l.order.packs));
  const witnessed = [PD_PACK.OUTLINES, PD_PACK.PITCH_EAVE, PD_PACK.PROPERTY_DETAILS, PD_PACK.ORTHO].some((p) => landedPacks.has(p));
  let provenance = storedProv.provenance;
  let origin: LatLng | null = row.lat != null && row.lng != null ? { lat: row.lat, lng: row.lng } : null;
  if (witnessed) {
    try {
      // The person's word survives a late pack: their pin, their "Make main" / "Measure this one", their ticks.
      const chose = storedProv.provenance.mainStructure;
      const was = storedProv.provenance as Record<string, unknown>;
      const userPin = userPinOf(was);
      const w = await witnessInstant({
        instant: merged,
        input: userPin ? { ...input, lat: userPin.lat, lng: userPin.lng } : input,
        packs,
        refreshSolar: false,
        reconDeadlineMs: LATE_RECON_DEADLINE_MS,
        pickPin: chose?.pin ?? null,
        chosen: chose?.how === "chosen",
        userPin,
        forceMain: chose?.how === "chosen" ? chose.index : null,
        included: includedIndicesOf(was, merged.structures.length, null),
      });
      provenance = { ...w.provenance, ...(storedProv.provenance.instantReuse ? { instantReuse: storedProv.provenance.instantReuse } : {}) };
      origin = w.origin ?? origin;
    } catch (err) {
      console.warn("[roofMeasurement] late witnesses failed, keeping the saved ones:", errorMessage(err, String(err)));
      provenance = { ...storedProv.provenance, instantPacks: packs };
    }
  } else {
    provenance = { ...storedProv.provenance, instantPacks: packs };
  }
  storedProv = { calibration: storedProv.calibration, provenance };

  const fig = rowFigures({
    instant: merged,
    provenance: provenance as unknown as Record<string, unknown>,
    columns: { areaSqft: row.areaSqft, squares: row.squares, lat: row.lat, lng: row.lng },
  });
  const updated = await db.roofMeasurement.update({
    where: { id: row.id },
    data: {
      areaSqft: fig.areaSqft,
      squares: fig.squares,
      predominantPitch: fig.predominantPitch,
      facetCount: fig.facetCount,
      lat: row.lat ?? origin?.lat ?? merged.lat ?? null,
      lng: row.lng ?? origin?.lng ?? merged.lng ?? null,
      instantJson: JSON.stringify(merged),
      provenanceJson: JSON.stringify(storedProv),
    },
  });
  return { ok: true, pending: c.pending.length, updated: true, measurement: toDTO(updated) };
}

// ── actions ──────────────────────────────────────────────────────────────────

/**
 * Instant measure: one billed EagleView Instant lookup + the free reconstruction,
 * run together, calibrated, chimney-scanned and saved.
 */


export async function measureRoofInstant(
  input: RoofOrderInput,
  opts?: { forceNewOrder?: boolean; building?: LatLng; mainIndex?: number; included?: number[] },
): Promise<MeasureResult> {
  let organizationId: string;
  let userId: string;
  try {
    const ctx = await requireEstimatorOrManager();
    await requirePage(ctx.organizationId, "roof-estimator");
    organizationId = ctx.organizationId;
    userId = ctx.user.id;
  } catch (err) {
    return { ok: false, error: errorMessage(err, "Not authorised") };
  }
  return instantMeasure(input, organizationId, userId, opts);
}


/** Numeric adapter for the existing takeoff contract, explicitly attributed by source/provenance. */

/** Google-only preliminary estimate. No EagleView orders, schema changes or AI dimensions. */
export async function measureRoofSolar(input: EvOrderInput): Promise<MeasureResult> {
  const { organizationId, user } = await requireEstimatorOrManager();
  await requirePage(organizationId, "roof-estimator");
  return solarMeasure(input, organizationId, user.id, "take");
}

/** One UI action; the active engine is controlled on the server. */
export async function measureRoof(input: RoofOrderInput): Promise<MeasureResult> {
  // Authenticate before deciding on any provider, including fallback paths.
  const { organizationId, user } = await requireEstimatorOrManager();
  await requirePage(organizationId, "roof-estimator");
  if (roofMeasurementProvider() === "google" || !isEagleViewEnabled()) {
    return solarMeasure(input, organizationId, user.id, "take");
  }
  const result = await measureRoofInstant(input);
  if (result.ok || !isSolarEnabled()) return result;
  // EagleView answered and its answer holds no roof (2026-10-10: a Seattle
  // house under a solar array). That answer is paid and kept, so a click
  // never re-bills it — and Google's aerial model measures the house in the
  // same click instead of leaving the contractor at a dead end. The click
  // already spent its trial allowance on the EagleView order.
  if (result.noRoof) {
    const google = await solarMeasure(input, organizationId, user.id, "covered");
    if (google.ok) return google;
    return { ...result, error: `${result.error} Google's aerial data could not measure it either: ${google.error}` };
  }
  // Only an explicit provider access failure permits automatic fallback.
  // Pending paid orders, plan limits and save failures keep their own state.
  if (result.providerAccessDenied !== true || result.stillProcessing) return result;
  return solarMeasure(input, organizationId, user.id, "take");
}

/** Бесплатная реконструкция строила модель — движок удалён. */
export async function measureRoofFree(): Promise<MeasureResult> {
  return { ok: false, error: "Free reconstruction was removed with the drawing engine (roofcore): use Instant measure." };
}

export async function listRoofMeasurements(limit = 20): Promise<RoofMeasurementSummary[]> {
  const ctx = await requireEstimatorOrManager();
  await requirePage(ctx.organizationId, "roof-estimator");
  const rows = await db.roofMeasurement.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: { createdAt: "desc" },
    take: Math.max(1, Math.min(100, limit)),
    select: {
      id: true, source: true, address: true, city: true, state: true,
      areaSqft: true, squares: true, predominantPitch: true, facetCount: true,
      pngUrl: true, createdAt: true, lat: true, lng: true,
      instantJson: true, provenanceJson: true,
    },
  });
  // The list shows the same figures the page it opens shows — the one rule
  // in lib/roofDiagram/instantTotals.rowFigures, not the columns as saved by
  // whichever pipeline wrote them (audit 2026-09-09).
  return rows.map((row) => {
    let instant: InstantRoofData | null = null;
    let provenance: Record<string, unknown> | null = null;
    try { instant = row.instantJson ? (JSON.parse(row.instantJson) as InstantRoofData) : null; } catch { instant = null; }
    try { provenance = row.provenanceJson ? ((JSON.parse(row.provenanceJson) as { provenance?: Record<string, unknown> }).provenance ?? null) : null; } catch { provenance = null; }
    const fig = rowFigures({ instant, provenance, columns: { areaSqft: row.areaSqft, squares: row.squares, lat: row.lat, lng: row.lng } });
    return {
      ...toSummary(row),
      areaSqft: fig.areaSqft,
      squares: fig.squares,
      predominantPitch: fig.predominantPitch,
      facetCount: fig.facetCount,
      pitchKind: fig.pitchKind,
    };
  });
}

export async function getRoofMeasurement(id: string): Promise<RoofMeasurementDTO | null> {
  const ctx = await requireEstimatorOrManager();
  await requirePage(ctx.organizationId, "roof-estimator");
  const row = await db.roofMeasurement.findFirst({ where: { id, organizationId: ctx.organizationId } });
  return row ? toDTO(row) : null;
}

/** A saved row's stored answer and provenance, read once for the "the person decides" actions below. */
function readSaved(row: { instantJson: string | null; provenanceJson: string | null }): { instant: InstantRoofData | null; stored: StoredProvenance } {
  let instant: InstantRoofData | null = null;
  try {
    instant = row.instantJson ? (JSON.parse(row.instantJson) as InstantRoofData) : null;
  } catch {
    instant = null;
  }
  let stored: StoredProvenance = { calibration: null, provenance: {} as MeasurementProvenance };
  try {
    const parsed = row.provenanceJson ? (JSON.parse(row.provenanceJson) as Partial<StoredProvenance>) : null;
    if (parsed && typeof parsed === "object") stored = { calibration: parsed.calibration ?? null, provenance: (parsed.provenance ?? {}) as MeasurementProvenance };
  } catch {
    /* unreadable provenance — the action starts it again from what is known */
  }
  return { instant, stored };
}

/**
 * "Make main" (2026-10-26, ticket 8KETUL: EagleView's point for an apartment
 * complex stood on its garage, and the contractor could tick other buildings in
 * but never take the garage out). The chosen building becomes the one the
 * figures, the hero and the estimate are about; the measurement is worked out
 * again from what the row already holds — the stored answer, the saved lot
 * check, the cached elevation tile — the same witnesses a re-measure of the
 * address runs (measureRoofInstant's reuse path), and nothing is asked of
 * EagleView. The building that was main joins the list unticked; the other
 * ticks stay. Every key a new measurement writes is written here too.
 */
export async function setMainStructure(
  measurementId: string,
  structureIndex: number,
): Promise<{ ok: true; measurement: RoofMeasurementDTO } | { ok: false; error: string }> {
  let organizationId: string;
  try {
    organizationId = (await requireEstimatorOrManager()).organizationId;
    await requirePage(organizationId, "roof-estimator");
    await enforceRateLimit(`roof-main:${organizationId}`, 60, HOUR, "building changes");
  } catch (err) {
    return { ok: false, error: errorMessage(err, "Not authorised") };
  }
  if (typeof measurementId !== "string" || !Number.isInteger(structureIndex) || structureIndex < 0) return { ok: false, error: "Pick a building from the list." };
  const row = await db.roofMeasurement.findFirst({ where: { id: measurementId, organizationId } });
  if (!row) return { ok: false, error: "Measurement not found" };
  if (row.source === "solar") return { ok: false, error: "This estimate is of one building." };
  const { instant, stored } = readSaved(row);
  if (!instant?.structures?.[structureIndex]) return { ok: false, error: "That building is not in this measurement." };
  const prov = stored.provenance;
  const was = mainStructureOf({ structures: instant.structures, provenance: prov as Record<string, unknown>, origin: { lat: row.lat, lng: row.lng } }).index;
  if (was === structureIndex && prov.mainStructure?.how === "chosen") return { ok: true, measurement: toDTO(row) };

  const userPin = userPinOf(prov as Record<string, unknown>);
  const input: EvOrderInput = {
    address: row.address ?? "",
    city: row.city ?? "",
    state: row.state ?? "",
    zip: row.zip ?? "",
    // The tile the row was measured on was fetched around the person's pin when there was one.
    lat: userPin?.lat ?? row.lat ?? undefined,
    lng: userPin?.lng ?? row.lng ?? undefined,
  };
  const evident = packsFromContent(instant);
  const packs = prov.instantPacks ?? packReport(evident.have, [], [], evident.unknown);
  let provenance: MeasurementProvenance;
  try {
    const w = await witnessInstant({
      instant,
      input,
      packs,
      refreshSolar: false,
      reconDeadlineMs: LATE_RECON_DEADLINE_MS,
      userPin,
      forceMain: structureIndex,
      included: includedIndicesOf(prov as Record<string, unknown>, instant.structures.length, structureIndex),
      lot: { parcelSource: prov.parcelSource, parcelVeto: (prov as Record<string, unknown>).parcelVeto ?? null },
    });
    provenance = { ...w.provenance, ...(prov.instantReuse ? { instantReuse: prov.instantReuse } : {}) };
  } catch (err) {
    console.warn("[roofMeasurement] make-main witnesses failed:", errorMessage(err, String(err)));
    return { ok: false, error: "The building could not be switched. Try again." };
  }
  const fig = rowFigures({
    instant,
    provenance: provenance as unknown as Record<string, unknown>,
    columns: { areaSqft: row.areaSqft, squares: row.squares, lat: row.lat, lng: row.lng },
  });
  const next: StoredProvenance = { calibration: stored.calibration, provenance };
  const updated = await db.roofMeasurement.update({
    where: { id: row.id },
    data: {
      areaSqft: fig.areaSqft,
      squares: fig.squares,
      predominantPitch: fig.predominantPitch,
      facetCount: fig.facetCount,
      provenanceJson: JSON.stringify(next),
    },
  });
  return { ok: true, measurement: toDTO(updated) };
}

/**
 * The buildings ticked into the estimate, kept on the row (2026-10-26) so a
 * measurement opened again — from Recent, a proposal, another device — shows
 * the same ones. Indices into the stored answer; the main one and anything
 * that is not a building of this answer are dropped. Nothing is recomputed:
 * the row's figures are the main building's.
 */
export async function saveIncludedStructures(
  measurementId: string,
  indices: number[],
): Promise<{ ok: true; included: number[] } | { ok: false; error: string }> {
  let organizationId: string;
  try {
    organizationId = (await requireEstimatorOrManager()).organizationId;
    await requirePage(organizationId, "roof-estimator");
    await enforceRateLimit(`roof-included:${organizationId}`, 600, HOUR, "changes to the buildings");
  } catch (err) {
    return { ok: false, error: errorMessage(err, "Not authorised") };
  }
  if (typeof measurementId !== "string" || !Array.isArray(indices) || indices.length > 500) return { ok: false, error: "Nothing to save." };
  const row = await db.roofMeasurement.findFirst({ where: { id: measurementId, organizationId } });
  if (!row) return { ok: false, error: "Measurement not found" };
  const { instant, stored } = readSaved(row);
  const n = instant?.structures?.length ?? 0;
  const main = instant ? mainStructureOf({ structures: instant.structures, provenance: stored.provenance as Record<string, unknown>, origin: { lat: row.lat, lng: row.lng } }).index : null;
  const included = includedIndicesOf({ included: indices }, n, main);
  const next: StoredProvenance = { calibration: stored.calibration, provenance: { ...stored.provenance, included } };
  await db.roofMeasurement.update({ where: { id: row.id }, data: { provenanceJson: JSON.stringify(next) } });
  return { ok: true, included };
}

/**
 * Where a typed address is, for the pin on the intake map (2026-10-26): a
 * picked suggestion carries its own point; an address typed out in full gets
 * one from the server's geocoder, so the person sees — and can move — the pin
 * before anything is ordered. One Geocoding call; nothing is ordered.
 */
export async function locateRoofAddress(input: {
  address: string;
  city?: string;
  state?: string;
  zip?: string;
}): Promise<{ ok: true; lat: number; lng: number; formatted: string } | { ok: false; error: string }> {
  try {
    const { organizationId } = await requireEstimatorOrManager();
    await requirePage(organizationId, "roof-estimator");
    await enforceRateLimit(`roof-locate:${organizationId}`, 120, HOUR, "address lookups");
  } catch (err) {
    return { ok: false, error: errorMessage(err, "Not authorised") };
  }
  const parts = [input?.address, input?.city, input?.state, input?.zip].map((v) => (typeof v === "string" ? v.trim().slice(0, 200) : "")).filter(Boolean);
  if (!parts[0] || !/\d/.test(parts[0])) return { ok: false, error: "Type the street number and name." };
  const hit = await geocodePlace(parts.join(", "));
  const pin = cleanPin(hit);
  if (!hit || !pin) return { ok: false, error: "Address not found — pick it from the suggestions" };
  return { ok: true, lat: pin.lat, lng: pin.lng, formatted: hit.formatted ?? parts.join(", ") };
}

/**
 * Google Maps satellite photo for the measurement — what the data view shows
 * in place of the drawing (owner's call 2026-09-02: the familiar Google Maps
 * look, clean, no outlines; EagleView ortho deliberately NOT used).
 *
 * Centre = the measurement's pin; zoom fitted to the Instant outlines' bbox
 * (the whole lot plus a little surroundings), default 20 for a house when
 * there is nothing to fit to. scale=2 for crispness. Cached on disk by
 * address+zoom (.cache/staticmap) so reopening the page costs no API call.
 */

/** One fixed zoom for every address — the standard Google Maps address view
 *  (owner's call: no per-lot fitting at all; the pin centres the house). */

export async function getMeasurementPhoto(
  id: string,
): Promise<{ ok: true; dataUrl: string; zoom: number } | { ok: false; error: string }> {
  const ctx = await requireEstimatorOrManager();
  await requirePage(ctx.organizationId, "roof-estimator");
  const row = await db.roofMeasurement.findFirst({
    where: { id, organizationId: ctx.organizationId },
    select: { source: true, address: true, city: true, state: true, zip: true, lat: true, lng: true, instantJson: true },
  });
  if (!row) return { ok: false, error: "Measurement not found" };
  // The fetch + disk cache live in lib/staticMapPhoto, shared with the
  // client's public proposal page (its site-photo route).
  if (row.source === "solar" && row.instantJson) {
    try {
      const data = JSON.parse(row.instantJson) as InstantRoofData;
      if (typeof data.lat === "number" && Number.isFinite(data.lat) && typeof data.lng === "number" && Number.isFinite(data.lng)) {
        row.lat = data.lat;
        row.lng = data.lng;
      }
    } catch { return { ok: false, error: "The selected building location could not be read." }; }
  }
  const photo = await satellitePhotoPng(row);
  if (!photo.ok) return photo;
  return { ok: true, dataUrl: "data:image/png;base64," + photo.bytes.toString("base64"), zoom: photo.zoom };
}

/** Орто EagleView (данные, без чертежа) — the report's ORTHO tab, shown only
 *  when the paid answer carried imagery; the default view is the Google Maps
 *  photo (getMeasurementPhoto above). */
export async function getMeasurementOrtho(id: string): Promise<
  | { ok: true; dataUrl: string; bbox: [number, number, number, number]; rings: Array<Array<{ lat: number; lng: number }>> }
  | { ok: false; error: string }
> {
  const ctx = await requireEstimatorOrManager();
  await requirePage(ctx.organizationId, "roof-estimator");
  const row = await db.roofMeasurement.findFirst({ where: { id, organizationId: ctx.organizationId }, select: { instantJson: true } });
  if (!row?.instantJson) return { ok: false, error: "No Instant data on this measurement" };
  let instant: InstantRoofData;
  try {
    instant = JSON.parse(row.instantJson) as InstantRoofData;
  } catch {
    return { ok: false, error: "Stored Instant data is unreadable" };
  }
  const wide = instant.imagery
    .filter((im) => im.view === "ortho" && im.bbox && im.masked === false)
    .sort((a, b) => (b.bbox![2] - b.bbox![0]) * (b.bbox![3] - b.bbox![1]) - (a.bbox![2] - a.bbox![0]) * (a.bbox![3] - a.bbox![1]))[0];
  if (!wide?.token || !wide.bbox) return { ok: false, error: "No ortho imagery on this measurement" };
  try {
    // The same kept, one-attempt read as the client's picture (lib/roofPictureFetch): an old order's image EagleView
    // refuses (410) is refused at once on the next ask, and the page falls back to the map.
    const img = await orthoImage(wide.token);
    const b64 = Buffer.from(img.bytes).toString("base64");
    const mime = img.contentType || "image/png";
    return {
      ok: true,
      dataUrl: "data:" + mime + ";base64," + b64,
      bbox: wide.bbox as [number, number, number, number],
      rings: instant.structures.map((st) => st.outline ?? []).filter((r) => r.length >= 3),
    };
  } catch (err) {
    return { ok: false, error: errorMessage(err, "Ortho image unavailable") };
  }
}
