import "server-only";

// ROOF FACETS — FROM A SAVED MEASUREMENT (2026-11-11). The roof facet lab (/admin/roof-lab, platform admins only)
// runs the engine on what a measurement already left behind — nothing is ordered and, for the drawing itself, nothing
// is fetched: EagleView's outline and figures come off the RoofMeasurement row, Google's height map, mask and roof
// segments off the SolarCache row of the same address. Two pictures can be cut for the drawing to sit on: the height
// map shaded as a relief (always there), and Google's aerial photograph of the same tile (one GeoTIFF fetch; the
// stored link is tried first, a fresh dataLayers answer second). Both share the height map's grid, so the lines land
// on the roof without lining anything up.
//
// A roof measured from Google alone (no EagleView answer — the account's roof-area pack was being refused when this
// was written, 2026-11-12) has no EagleView outline and no saved height map. For those the height map is fetched once
// (one dataLayers answer and two rasters, then frozen in SolarCache like every other) and the outline is Google's own:
// the building under the pin in its mask (lib/roofRecon/footprint), which needs no sliding onto the height map.
//
// The callers gate on requirePlatformAdmin; nothing here checks who is asking.

import { gunzipSync } from "node:zlib";
import { db } from "@/lib/db";
import { instantAddressKey, type InstantRoofData } from "@/lib/eagleview";
import { mainStructureOf } from "@/lib/roofDiagram/instantTotals";
import { buildStructureFootprints } from "@/lib/roofRecon/footprint";
import { SOLAR_DEFAULT_RADIUS_M, fetchRaster, fetchRgbRaster, getBuildingInsights, getDataLayers, isSolarEnabled, type BuildingInsights, type DataLayerUrls, type Raster, type RgbRaster } from "@/lib/solar";
import { solarCacheKey, writeSolarCache } from "@/lib/solarCache";
import { buildFacets } from "./engine";
import { isUtm, latLngToPixel, type RasterFrame } from "./geo";
import { toFacetModel, type FacetModel } from "./model";
import { encodePng } from "./png";

/** The patch of ground a lab picture shows: the UTM corner of its top-left pixel and its size. East grows right, north falls. */
export interface PictureWindow {
  e0: number;
  n0: number;
  widthM: number;
  heightM: number;
}

export interface RoofLabDrawing {
  model: FacetModel;
  window: PictureWindow;
  imagery: { quality: string | null; date: string | null; pixelSizeM: number };
  /** whether an aerial photograph can be asked for (a link on file and a Google key) */
  photo: boolean;
}

interface Loaded {
  at: number;
  dsm: Raster;
  layers: DataLayerUrls;
  solar: { id: string; lat: number; lng: number; radiusM: number };
  drawing: RoofLabDrawing;
  rgb?: RgbRaster | null;
}

/** Under this share of the outline showing a building in the height map, there is no roof there to read. */
const NO_BUILDING_SHARE = 0.45;

// What one look at a roof needs three times over (the drawing, then two pictures). Small and short-lived on purpose.
const KEEP_MS = 10 * 60_000;
const kept = new Map<string, Loaded>();
function remember(id: string, v: Loaded) {
  kept.delete(id);
  kept.set(id, v);
  while (kept.size > 6) kept.delete(kept.keys().next().value as string);
}

const unpackRaster = (meta: string, data: Uint8Array): Raster => {
  const m = JSON.parse(meta) as Omit<Raster, "data">;
  const raw = gunzipSync(Buffer.from(data));
  const out = new Float32Array(m.width * m.height);
  Buffer.from(out.buffer).set(raw.subarray(0, out.byteLength));
  return { ...m, data: out };
};

type Fail = { ok: false; reason: string };

async function load(measurementId: string): Promise<{ ok: true; v: Loaded } | Fail> {
  const hit = kept.get(measurementId);
  if (hit && Date.now() - hit.at < KEEP_MS) return { ok: true, v: hit };

  const row = await db.roofMeasurement.findUnique({
    where: { id: measurementId },
    select: { id: true, source: true, address: true, city: true, state: true, zip: true, lat: true, lng: true, areaSqft: true, predominantPitch: true, instantJson: true, provenanceJson: true },
  });
  if (!row) return { ok: false, reason: "That measurement is gone." };
  let instant: InstantRoofData | null = null;
  let provenance: Record<string, unknown> = {};
  try {
    instant = row.instantJson ? (JSON.parse(row.instantJson) as InstantRoofData) : null;
    provenance = ((JSON.parse(row.provenanceJson ?? "{}") as { provenance?: Record<string, unknown> }).provenance ?? {}) as Record<string, unknown>;
  } catch {
    /* an unreadable row is treated as one without the data */
  }
  const mainOf = (inst: InstantRoofData | null, prov: Record<string, unknown>, origin: { lat: number | null; lng: number | null }) => {
    if (!inst?.structures?.length) return null;
    const pick = mainStructureOf({ structures: inst.structures, provenance: prov, origin });
    return pick.index != null ? (inst.structures[pick.index] ?? null) : null;
  };
  type Structure = InstantRoofData["structures"][number];
  type Outlined = Structure & { outline: NonNullable<Structure["outline"]> };
  const hasOutline = (st: Structure | null): st is Outlined => Boolean(st?.outline && st.outline.length >= 3);
  let structure: Structure | null = mainOf(instant, provenance, { lat: row.lat, lng: row.lng });
  const notes: string[] = [];
  if (!hasOutline(structure) && row.lat != null && row.lng != null) {
    // This measurement came without an outline (the outlines pack was not on that day, or the order failed). The same
    // house measured another day has one — EagleView's outline of a building does not change between orders.
    const others = await db.roofMeasurement.findMany({
      where: { id: { not: row.id }, instantJson: { not: null }, lat: { gte: row.lat - 0.0003, lte: row.lat + 0.0003 }, lng: { gte: row.lng - 0.0004, lte: row.lng + 0.0004 } },
      orderBy: { createdAt: "desc" },
      take: 12,
      select: { createdAt: true, lat: true, lng: true, instantJson: true, provenanceJson: true },
    });
    for (const o of others) {
      try {
        const inst = JSON.parse(o.instantJson ?? "null") as InstantRoofData | null;
        const prov = ((JSON.parse(o.provenanceJson ?? "{}") as { provenance?: Record<string, unknown> }).provenance ?? {}) as Record<string, unknown>;
        const st = mainOf(inst, prov, { lat: o.lat, lng: o.lng });
        if (hasOutline(st)) {
          structure = st;
          notes.push(`this measurement came without an outline; the outline and figures of the same address measured on ${o.createdAt.toISOString().slice(0, 10)} were used`);
          break;
        }
      } catch {
        /* an unreadable sibling is skipped */
      }
    }
  }
  // No EagleView outline anywhere: the roof is drawn inside Google's own outline of the building instead.
  const fromGoogle = !hasOutline(structure);

  // The height map: the SolarCache row(s) of the same address, else the nearest one to the pin — else, fetched now.
  const place = instantAddressKey(row);
  const find = async () => {
    let c = place.replace(/\|/g, "")
      ? await db.solarCache.findMany({ where: { addressKey: { startsWith: `${place}#r` } }, select: { id: true, addressKey: true, dsmMetaJson: true } })
      : [];
    if (!c.length && row.lat != null && row.lng != null) {
      c = await db.solarCache.findMany({
        where: { lat: { gte: row.lat - 0.0005, lte: row.lat + 0.0005 }, lng: { gte: row.lng - 0.0007, lte: row.lng + 0.0007 } },
        select: { id: true, addressKey: true, dsmMetaJson: true },
        take: 8,
      });
    }
    return c;
  };
  let candidates = await find();
  if (!candidates.length && row.lat != null && row.lng != null && isSolarEnabled()) {
    // Never saved (a Google-only estimate keeps the segments, not the rasters): one dataLayers answer and its two
    // rasters, frozen for next time exactly as a measurement would have frozen them.
    try {
      const layers = await getDataLayers(row.lat, row.lng, SOLAR_DEFAULT_RADIUS_M);
      if (layers.dsmUrl && layers.maskUrl) {
        const [dsm0, mask0, insights0] = await Promise.all([fetchRaster(layers.dsmUrl), fetchRaster(layers.maskUrl), getBuildingInsights(row.lat, row.lng).catch(() => null)]);
        await writeSolarCache(solarCacheKey({ address: row.address ?? undefined, city: row.city ?? undefined, state: row.state ?? undefined, zip: row.zip ?? undefined, lat: row.lat, lng: row.lng }, SOLAR_DEFAULT_RADIUS_M), { lat: row.lat, lng: row.lng, layers, insights: insights0, dsm: dsm0, mask: mask0 });
        candidates = await find();
        if (candidates.length) notes.push("Google's height map of this roof was not saved with the measurement; it was fetched now and kept");
      }
    } catch (err) {
      console.warn("[roof-lab] height map fetch failed:", err instanceof Error ? err.message : err);
    }
  }
  if (!candidates.length) return { ok: false, reason: "Google has no height map of this roof (none was saved with the measurement, and none could be fetched now), so its facets cannot be read." };
  const widthOf = (c: { dsmMetaJson: string }) => { try { return (JSON.parse(c.dsmMetaJson) as { width?: number }).width ?? 0; } catch { return 0; } };
  const best = [...candidates].sort((a, b) => widthOf(b) - widthOf(a))[0];
  const solar = await db.solarCache.findUnique({ where: { id: best.id } });
  if (!solar) return { ok: false, reason: "The saved height map could not be read." };
  let dsm: Raster, mask: Raster, layers: DataLayerUrls, insights: BuildingInsights | null;
  try {
    dsm = unpackRaster(solar.dsmMetaJson, solar.dsmData);
    mask = unpackRaster(solar.maskMetaJson, solar.maskData);
    layers = JSON.parse(solar.layersJson) as DataLayerUrls;
    insights = solar.insightsJson ? (JSON.parse(solar.insightsJson) as BuildingInsights) : null;
  } catch {
    return { ok: false, reason: "The saved height map could not be read." };
  }
  if (!isUtm(dsm.epsg)) return { ok: false, reason: "The saved height map is in a projection the facet engine does not read." };
  const frame: RasterFrame = { originX: dsm.originX, originY: dsm.originY, pixelSizeM: dsm.pixelSizeM, epsg: dsm.epsg };

  const sameGrid = mask.width === dsm.width && mask.height === dsm.height;
  let outline: Array<{ x: number; y: number }>;
  if (hasOutline(structure)) {
    outline = structure.outline.map((p) => latLngToPixel(frame, p.lat, p.lng));
  } else {
    // Google's own outline: the building under the pin in its mask, squared up the way the fence map squares houses.
    if (!sameGrid) return { ok: false, reason: "Google's building mask does not line up with its height map here, so there is no outline to draw inside." };
    const found = buildStructureFootprints(mask, { rawFallback: true }).structures.filter((x) => x.ring && x.ring.length >= 3);
    const pick = found.find((x) => x.onParcel) ?? [...found].sort((a, b) => b.maskAreaSqft - a.maskAreaSqft)[0];
    if (!pick?.ring) return { ok: false, reason: "Google's mask shows no building at this measurement's pin, and EagleView gave no outline, so there is nothing to draw inside." };
    // the footprint's frame is feet from the tile's centre, north up
    const stepFt = mask.pixelSizeM * 3.28084;
    outline = pick.ring.map((p) => ({ x: p.x / stepFt + mask.width / 2, y: mask.height / 2 - p.y / stepFt }));
    notes.push("EagleView gave no outline for this roof; Google's own outline of the building is used");
  }

  const result = buildFacets({
    dsm,
    mask: sameGrid ? mask : null,
    outline,
    register: !fromGoogle,
    priors: (insights?.segments ?? []).map((s) => {
      const c = latLngToPixel(frame, s.centerLat, s.centerLng);
      return { pitchDeg: s.pitchDegrees, azimuthDeg: s.azimuthDegrees, cx: c.x, cy: c.y, zc: s.planeHeightAtCenterMeters, areaM2: s.areaMeters2 };
    }),
    trace: notes,
  });
  if (!result || !result.facets.length) return { ok: false, reason: "The height map shows no roof planes inside the roof's outline here (the outline may fall off the saved tile)." };
  // Google's elevation can be years older than the house. Where it shows no building under the outline there are no
  // facets to read, and a drawing made of the ground and the trees would be worse than none.
  if (!fromGoogle && result.quality.buildingShare < NO_BUILDING_SHARE) {
    const year = /^(\d{4})/.exec(solar.imageryDate ?? "")?.[1];
    return {
      ok: false,
      reason: `Google's height map of this spot${year ? ` is from ${year} and` : ""} shows a building under only ${Math.round(result.quality.buildingShare * 100)}% of EagleView's outline — the roof is newer than Google's data, or hidden from it. The facets are read off that height map, so this roof cannot be drawn yet.`,
    };
  }
  // What the drawing is held against: EagleView's figures for the structure, or — measured from Google alone —
  // Google's own estimate as the measurement saved it.
  const googleSegments = (provenance.solar as { segmentCount?: number } | undefined)?.segmentCount ?? null;
  const model = hasOutline(structure) && structure.areaSqft != null
    ? toFacetModel({ result, frame, eagleView: { areaSqft: structure.areaSqft, facetCount: structure.facetCount, pitch: structure.pitch }, reference: "EagleView", outlineFrom: fromGoogle ? "google" : "eagleview", notes })
    : toFacetModel({ result, frame, eagleView: { areaSqft: row.areaSqft, facetCount: googleSegments, pitch: row.predominantPitch?.split(" ")[0] ?? null }, reference: row.source === "solar" ? "Google" : "EagleView", outlineFrom: fromGoogle ? "google" : "eagleview", notes });

  // The picture: the drawing plus 5 m all round, on whole pixels, inside the tile.
  const px = dsm.pixelSizeM;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of result.vertices) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  const pad = Math.round(5 / px);
  x0 = Math.max(0, Math.floor(x0) - pad); y0 = Math.max(0, Math.floor(y0) - pad);
  x1 = Math.min(dsm.width, Math.ceil(x1) + pad); y1 = Math.min(dsm.height, Math.ceil(y1) + pad);
  const window: PictureWindow = { e0: dsm.originX + x0 * px, n0: dsm.originY - y0 * px, widthM: (x1 - x0) * px, heightM: (y1 - y0) * px };

  const radius = Number(/#r(\d+)$/.exec(solar.addressKey)?.[1]) || Math.round((dsm.width * px) / 2);
  const v: Loaded = {
    at: Date.now(),
    dsm,
    layers,
    solar: { id: solar.id, lat: solar.lat, lng: solar.lng, radiusM: radius },
    drawing: {
      model,
      window,
      imagery: { quality: insights?.imageryQuality ?? layers.imageryQuality ?? null, date: solar.imageryDate ?? null, pixelSizeM: px },
      photo: isSolarEnabled() && Boolean(layers.rgbUrl),
    },
  };
  remember(measurementId, v);
  return { ok: true, v };
}

/** The facet drawing of one saved measurement, and the patch of ground its pictures show. */
export async function roofLabDrawing(measurementId: string): Promise<({ ok: true } & RoofLabDrawing) | Fail> {
  const r = await load(measurementId);
  return r.ok ? { ok: true, ...r.v.drawing } : r;
}

/** The height map over `w`, shaded as a relief (light from the north-west), two picture pixels a raster pixel. */
function reliefPng(dsm: Raster, w: PictureWindow): Buffer {
  const px = dsm.pixelSizeM, S = 2;
  const x0 = (w.e0 - dsm.originX) / px, y0 = (dsm.originY - w.n0) / px;
  const W = Math.round((w.widthM / px) * S), H = Math.round((w.heightM / px) * S);
  const at = (x: number, y: number) => dsm.data[Math.min(dsm.height - 1, Math.max(0, y)) * dsm.width + Math.min(dsm.width - 1, Math.max(0, x))];
  const zAt = (fx: number, fy: number) => {
    const xi = Math.floor(fx), yi = Math.floor(fy), tx = fx - xi, ty = fy - yi;
    return (at(xi, yi) * (1 - tx) + at(xi + 1, yi) * tx) * (1 - ty) + (at(xi, yi + 1) * (1 - tx) + at(xi + 1, yi + 1) * tx) * ty;
  };
  const out = new Uint8Array(W * H * 3);
  for (let py = 0; py < H; py++) for (let qx = 0; qx < W; qx++) {
    const fx = x0 + (qx + 0.5) / S - 0.5, fy = y0 + (py + 0.5) / S - 0.5;
    const dzdx = (zAt(fx + 1, fy) - zAt(fx - 1, fy)) / (2 * px), dzdy = (zAt(fx, fy + 1) - zAt(fx, fy - 1)) / (2 * px);
    const shade = Math.max(0, (dzdx * 0.5 + dzdy * 0.5 + 0.707) / Math.hypot(dzdx, dzdy, 1));
    const v = 46 + 200 * Math.min(1, shade * 1.15);
    const i = (py * W + qx) * 3;
    out[i] = v * 0.96; out[i + 1] = v * 0.95; out[i + 2] = v;
  }
  return encodePng(out, W, H);
}

/** Google's aerial photograph over `w`, at the photograph's own resolution. */
function photoPng(rgb: RgbRaster, w: PictureWindow): Buffer {
  const px = rgb.pixelSizeM;
  const x0 = Math.round((w.e0 - rgb.originX) / px), y0 = Math.round((rgb.originY - w.n0) / px);
  const W = Math.round(w.widthM / px), H = Math.round(w.heightM / px);
  const out = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const sx = x0 + x, sy = y0 + y;
    if (sx < 0 || sy < 0 || sx >= rgb.width || sy >= rgb.height) continue;
    const i = (sy * rgb.width + sx) * 3, o = (y * W + x) * 3;
    out[o] = rgb.data[i]; out[o + 1] = rgb.data[i + 1]; out[o + 2] = rgb.data[i + 2];
  }
  return encodePng(out, W, H);
}

/** One of the lab's two pictures of a measurement's roof, as PNG bytes. */
export async function roofLabPicture(measurementId: string, kind: "photo" | "relief"): Promise<{ ok: true; png: Buffer } | Fail> {
  const r = await load(measurementId);
  if (!r.ok) return r;
  const v = r.v;
  if (kind === "relief") return { ok: true, png: reliefPng(v.dsm, v.drawing.window) };
  if (!isSolarEnabled()) return { ok: false, reason: "No Google key is set, so the aerial photograph cannot be fetched." };
  if (v.rgb === undefined) {
    v.rgb = null;
    // The link saved with the height map first; Google's links age, so a fresh answer for the same tile second.
    for (const url of [v.layers.rgbUrl, null]) {
      try {
        const link = url ?? (await getDataLayers(v.solar.lat, v.solar.lng, v.solar.radiusM)).rgbUrl;
        if (!link) continue;
        const rgb = await fetchRgbRaster(link);
        if (rgb.epsg != null && rgb.epsg !== v.dsm.epsg) continue;
        v.rgb = rgb;
        break;
      } catch (err) {
        console.warn("[roof-lab] aerial photograph fetch failed:", err instanceof Error ? err.message : err);
      }
    }
  }
  if (!v.rgb) return { ok: false, reason: "Google did not return the aerial photograph for this tile." };
  return { ok: true, png: photoPng(v.rgb, v.drawing.window) };
}
