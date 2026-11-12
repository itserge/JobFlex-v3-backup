import "server-only";

// ROOF FACETS — FROM A SAVED MEASUREMENT (2026-11-11). The roof facet lab (/admin/roof-lab, platform admins only)
// runs the engine on what a measurement already left behind — nothing is ordered and, for the drawing itself, nothing
// is fetched: EagleView's outline and figures come off the RoofMeasurement row, Google's height map, mask and roof
// segments off the SolarCache row of the same address. Two pictures can be cut for the drawing to sit on: the height
// map shaded as a relief (always there), and Google's aerial photograph of the same tile (one GeoTIFF fetch; the
// stored link is tried first, a fresh dataLayers answer second). Both share the height map's grid, so the lines land
// on the roof without lining anything up.
//
// The callers gate on requirePlatformAdmin; nothing here checks who is asking.

import { gunzipSync } from "node:zlib";
import { db } from "@/lib/db";
import { instantAddressKey, type InstantRoofData } from "@/lib/eagleview";
import { mainStructureOf } from "@/lib/roofDiagram/instantTotals";
import { fetchRgbRaster, getDataLayers, isSolarEnabled, type BuildingInsights, type DataLayerUrls, type Raster, type RgbRaster } from "@/lib/solar";
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
    select: { id: true, address: true, city: true, state: true, zip: true, lat: true, lng: true, instantJson: true, provenanceJson: true },
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
  if (!instant?.structures?.length) return { ok: false, reason: "This measurement has no EagleView data to draw from." };
  const pick = mainStructureOf({ structures: instant.structures, provenance, origin: { lat: row.lat, lng: row.lng } });
  const structure = pick.index != null ? instant.structures[pick.index] : null;
  if (!structure?.outline || structure.outline.length < 3) return { ok: false, reason: "EagleView gave no roof outline for this address, so there is nothing to draw inside." };

  // The height map: the SolarCache row(s) of the same address, else the nearest one to the pin.
  const place = instantAddressKey(row);
  let candidates = place.replace(/\|/g, "")
    ? await db.solarCache.findMany({ where: { addressKey: { startsWith: `${place}#r` } }, select: { id: true, addressKey: true, dsmMetaJson: true } })
    : [];
  if (!candidates.length && row.lat != null && row.lng != null) {
    candidates = await db.solarCache.findMany({
      where: { lat: { gte: row.lat - 0.0005, lte: row.lat + 0.0005 }, lng: { gte: row.lng - 0.0007, lte: row.lng + 0.0007 } },
      select: { id: true, addressKey: true, dsmMetaJson: true },
      take: 8,
    });
  }
  if (!candidates.length) return { ok: false, reason: "No height map was saved for this roof (it was measured before they were kept, or Google has none here)." };
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

  const notes: string[] = [];
  const result = buildFacets({
    dsm,
    mask: mask.width === dsm.width && mask.height === dsm.height ? mask : null,
    outline: structure.outline.map((p) => latLngToPixel(frame, p.lat, p.lng)),
    priors: (insights?.segments ?? []).map((s) => {
      const c = latLngToPixel(frame, s.centerLat, s.centerLng);
      return { pitchDeg: s.pitchDegrees, azimuthDeg: s.azimuthDegrees, cx: c.x, cy: c.y, zc: s.planeHeightAtCenterMeters, areaM2: s.areaMeters2 };
    }),
    trace: notes,
  });
  if (!result || !result.facets.length) return { ok: false, reason: "The height map shows no roof planes inside EagleView's outline here (the outline may fall off the saved tile)." };
  const model = toFacetModel({ result, frame, eagleView: { areaSqft: structure.areaSqft, facetCount: structure.facetCount, pitch: structure.pitch }, notes });

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
