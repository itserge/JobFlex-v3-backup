// Google Solar API client — building insights + the DSM/mask raster layers used
// to reconstruct a roof without ordering an EagleView report.
//
// SERVER-ONLY: reads GOOGLE_MAPS_API_KEY. Import it only from "use server"
// action files (mirrors how src/lib/maps.ts and src/lib/eagleview.ts are used).
//
// Gotchas, all verified against live responses for 419 Prairie Ridge Ln:
//
//  1. Solar API is a SEPARATELY enabled and separately billed Maps Platform
//     product. A key that geocodes fine still 403s here until "Solar API" is
//     enabled on its Cloud project.
//  2. The dataLayers response returns bare GCS-style URLs with NO credentials.
//     Each one must have `key=` appended before fetching — see fetchRaster().
//  3. The rasters are NOT lat/lng. They come back projected — UTM (EPSG:326xx /
//     327xx), units METRES, 0.1 m/px at HIGH quality. Treating getResolution()
//     as degrees is off by ~83000x. We stay in the raster's own metre grid and
//     never need a UTM→WGS84 inverse, because RoofModel is in local feet
//     relative to the building itself.
//  4. maskUrl covers EVERY building in the tile, not just the subject. At this
//     address the mask is 67k px (~7200 sqft) against a ~3300 sqft plan-view
//     roof — i.e. it includes neighbours. Callers MUST isolate the connected
//     component containing the tile centre (roofRecon.ts does this).
//  5. imageryDate can be years stale (2023-07 here). Surface it to the user;
//     a recent addition or re-roof will not exist in the data.

import { fromArrayBuffer } from "geotiff";
import { ExternalCallError, externalFetch } from "@/lib/externalCall";

// Outside production a stand may point this at a fake (SOLAR_BASE), as the static map does — the website estimator's
// walk and the home portal's price walk measure a roof without Google (2026-10-27).
const SOLAR_BASE = process.env.NODE_ENV !== "production" && process.env.SOLAR_BASE ? process.env.SOLAR_BASE.replace(/\/+$/, "") : "https://solar.googleapis.com/v1";

export function isSolarEnabled(): boolean {
  return Boolean(process.env.GOOGLE_MAPS_API_KEY);
}

// ── retry ────────────────────────────────────────────────────────────────────
// Measured, 2026-08-28: a single 15 s abort on ONE of these three calls threw
// away a whole reconstruction of 12629 NE 100th Pl — an address that had built
// 16 facets two days earlier and builds them now. There was no retry anywhere,
// the whole measurement gave up after 15.8 s of a 25 s budget, and the user saw
// a drawing captioned "no usable aerial elevation data for this address", which
// was false.
//
// The per-attempt ceiling stays at 15 s: it is the right answer to "this one
// request has hung". What was missing is a second ask.

/** How long ONE attempt may take. Unchanged — this was never the wrong number. */
export const SOLAR_TIMEOUT_MS = 15_000;
/** One try plus two retries. */
export const SOLAR_ATTEMPTS = 3;
/** First pause before retrying; doubles each time (1 s, 2 s). */
const SOLAR_BACKOFF_MS = 1_000;

/**
 * The worst case ONE Solar call can take under this policy. Exported because
 * the reconstruction deadline is derived from it rather than guessed: a caller
 * that allows less than this is cancelling its own retries.
 */
export const SOLAR_CALL_BUDGET_MS =
  SOLAR_ATTEMPTS * SOLAR_TIMEOUT_MS +
  Array.from({ length: SOLAR_ATTEMPTS - 1 }, (_, i) => SOLAR_BACKOFF_MS << i).reduce((a, b) => a + b, 0);

/** Why the Solar side could not answer — kept typed so the UI can tell the user. */
export type SolarFailureKind =
  /** The request hung or the network broke. Trying again is the right move. */
  | "timeout"
  /** Google says it has no high-resolution data here. Trying again changes nothing. */
  | "no-coverage"
  /** The key or its project is misconfigured. Ours to fix, not the user's. */
  | "config"
  /** Anything else Google returned. */
  | "error";

export class SolarUnavailableError extends Error {
  constructor(
    message: string,
    readonly kind: SolarFailureKind,
    readonly op: string,
  ) {
    super(message);
    this.name = "SolarUnavailableError";
  }
}

/**
 * One Solar request, with retries. Returns the successful Response; the caller
 * reads the body. Every throw out of here is a SolarUnavailableError carrying
 * the kind, so callers never have to pattern-match on message text.
 */
async function solarFetch(url: string, op: string): Promise<Response> {
  try {
    return await externalFetch("solar", op, url, {}, {
      timeoutMs: SOLAR_TIMEOUT_MS,
      attempts: SOLAR_ATTEMPTS,
      backoffMs: SOLAR_BACKOFF_MS,
    });
  } catch (err) {
    if (!(err instanceof ExternalCallError)) throw err;
    // Solar's public kind vocabulary predates the shared wrapper and is baked
    // into stored provenance (reconUnavailable.kind) and the UI's stamps, so it
    // is kept and mapped rather than renamed.
    if (err.kind === "auth") {
      throw new SolarUnavailableError(
        `Google Solar API rejected this key (${err.httpStatus}). Enable "Solar API" for this key's Cloud project. ${err.message}`,
        "config",
        op,
      );
    }
    if (err.kind === "no-data") {
      throw new SolarUnavailableError(
        "Google has no high-resolution solar/roof data for this address. Use Instant measure to measure it.",
        "no-coverage",
        op,
      );
    }
    throw new SolarUnavailableError(err.message, err.kind === "unreachable" ? "timeout" : "error", op);
  }
}

// ── Building insights ────────────────────────────────────────────────────────
// Google's own per-segment roof stats. We use these as a CROSS-CHECK and as a
// prior for plane clustering — not as geometry. Each segment carries only an
// axis-aligned boundingBox, which cannot draw a roof (the facets would be
// overlapping rectangles with no shared ridges).

export interface SolarDate {
  year?: number;
  month?: number;
  day?: number;
}

export interface SolarRoofSegment {
  pitchDegrees: number;
  azimuthDegrees: number;
  areaMeters2: number;
  groundAreaMeters2?: number;
  centerLat: number;
  centerLng: number;
  planeHeightAtCenterMeters: number;
}

export interface BuildingInsights {
  imageryQuality: "HIGH" | "MEDIUM" | "LOW" | string;
  imageryDate: SolarDate | null;
  center: { lat: number; lng: number } | null;
  segments: SolarRoofSegment[];
  wholeRoofAreaM2: number | null;
  wholeRoofGroundAreaM2?: number | null;
  buildingGroundAreaM2?: number | null;
  boundingBox?: {
    sw: { lat: number; lng: number };
    ne: { lat: number; lng: number };
  } | null;
  name?: string | null;
  /** Malformed source segments must not silently become a complete estimate. */
  invalidSegmentCount?: number;
}

// These JSON fields are numbers. Do not turn missing pitch into a flat roof,
// accept a numeric prefix ("23junk"), or coerce null/booleans into zero.
// Google declares pitch, azimuth, and plane height as proto3 `optional float`,
// so they have explicit presence: a measured zero is serialized, absence is
// unset. This differs from implicit-presence scalars whose zero can be omitted.
// https://github.com/googleapis/googleapis/blob/master/google/maps/solar/v1/solar_service.proto
// https://protobuf.dev/programming-guides/json/#presence-and-default-values
const finiteNumber = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

// Defensive read of an unknown JSON tree — the Solar schema is stable but we
// never want a shape change to throw inside a server action.
type Json = Record<string, unknown>;
const obj = (v: unknown): Json =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function parseLocation(raw: unknown): { lat: number; lng: number } | null {
  const location = obj(raw);
  const lat = finiteNumber(location.latitude);
  const lng = finiteNumber(location.longitude);
  return lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
    ? { lat, lng }
    : null;
}

function parseSolarDate(raw: unknown): SolarDate | null {
  const date = obj(raw);
  const year = finiteNumber(date.year);
  const month = finiteNumber(date.month);
  const day = finiteNumber(date.day);
  if (year === null || !Number.isInteger(year) || year < 1 || year > 9999) return null;
  if ((date.month !== undefined && month === null) || (date.day !== undefined && day === null)) return null;
  if (month !== null && (!Number.isInteger(month) || month < 0 || month > 12)) return null;
  if (day !== null && (!Number.isInteger(day) || day < 0 || day > 31)) return null;
  if (day && !month) return null;
  if (month && day) {
    const parsed = new Date(`${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T00:00:00Z`);
    if (parsed.getUTCMonth() + 1 !== month || parsed.getUTCDate() !== day) return null;
  }
  return { year, ...(month ? { month } : {}), ...(day ? { day } : {}) };
}

/** Parse the API payload without I/O, retaining the statistics needed for coverage checks. */
export function parseBuildingInsights(raw: unknown): BuildingInsights {
  const b = obj(raw);
  const sp = obj(b.solarPotential);
  const rawSegments = arr(sp.roofSegmentStats);
  const segments: SolarRoofSegment[] = rawSegments
    .map((raw) => {
      const s = obj(raw);
      const stats = obj(s.stats);
      const centre = parseLocation(s.center);
      const pitchDegrees = finiteNumber(s.pitchDegrees);
      const azimuthDegrees = finiteNumber(s.azimuthDegrees);
      const areaMeters2 = finiteNumber(stats.areaMeters2);
      const planeHeightAtCenterMeters = finiteNumber(s.planeHeightAtCenterMeters);
      const groundAreaMeters2 = finiteNumber(stats.groundAreaMeters2);
      if (
        pitchDegrees === null || pitchDegrees < 0 || pitchDegrees >= 90 ||
        azimuthDegrees === null || azimuthDegrees < 0 || azimuthDegrees > 360 ||
        areaMeters2 === null || areaMeters2 <= 0 || !centre ||
        planeHeightAtCenterMeters === null ||
        (stats.groundAreaMeters2 !== undefined && (groundAreaMeters2 === null || groundAreaMeters2 <= 0))
      ) return null;
      return {
        pitchDegrees,
        azimuthDegrees,
        areaMeters2,
        ...(groundAreaMeters2 !== null ? { groundAreaMeters2 } : {}),
        centerLat: centre.lat,
        centerLng: centre.lng,
        planeHeightAtCenterMeters,
      };
    })
    .filter((s): s is SolarRoofSegment => s !== null);

  const wholeRoof = obj(sp.wholeRoofStats);
  const building = obj(sp.buildingStats);
  const box = obj(b.boundingBox);
  const sw = parseLocation(box.sw);
  const ne = parseLocation(box.ne);
  return {
    imageryQuality: typeof b.imageryQuality === "string" ? b.imageryQuality : "UNKNOWN",
    imageryDate: parseSolarDate(b.imageryDate),
    center: parseLocation(b.center),
    segments,
    wholeRoofAreaM2: finiteNumber(wholeRoof.areaMeters2),
    wholeRoofGroundAreaM2: finiteNumber(wholeRoof.groundAreaMeters2),
    buildingGroundAreaM2: finiteNumber(building.groundAreaMeters2),
    boundingBox: sw && ne && sw.lat < ne.lat && sw.lng < ne.lng ? { sw, ne } : null,
    name: typeof b.name === "string" && b.name.trim() ? b.name : null,
    invalidSegmentCount: rawSegments.length - segments.length,
  };
}

export async function getBuildingInsights(
  lat: number,
  lng: number,
  /** The lowest imagery quality to accept. HIGH everywhere a contractor measures; the homeowner's rough range asks
   *  MEDIUM when HIGH has none (2026-10-28). */
  requiredQuality: "HIGH" | "MEDIUM" = "HIGH",
): Promise<BuildingInsights> {
  if (!isSolarEnabled()) throw new Error("Google Maps key is not configured");
  const url =
    `${SOLAR_BASE}/buildingInsights:findClosest` +
    `?location.latitude=${lat}&location.longitude=${lng}` +
    `&requiredQuality=${requiredQuality}&key=${process.env.GOOGLE_MAPS_API_KEY}`;
  const res = await solarFetch(url, "buildingInsights");
  return parseBuildingInsights(await res.json());
}

// ── Data layers ──────────────────────────────────────────────────────────────

export interface DataLayerUrls {
  imageryQuality: string;
  imageryDate: SolarDate | null;
  dsmUrl: string | null;
  maskUrl: string | null;
  rgbUrl: string | null;
}

/**
 * The largest tile Google will serve. MEASURED, not from the docs: 95 and 100
 * return HIGH imagery with layer URLs, 105 and everything above return
 * `400 Request contains an invalid argument`. A property that needs more than
 * this cannot be covered by one Solar tile at all.
 */
export const SOLAR_MAX_RADIUS_M = 100;
/**
 * Radii are quantised to this. Two reasons, and the second is the interesting
 * one: (a) a house's contour does not need metre precision in its tile, and
 * (b) every distinct (lat, lng, radius, quality) is a distinct request to
 * Google, and the failure measurement of 2026-08-28 found that REPEATING one
 * tuple never failed (0 of 30) while walking many failed a third of the time.
 * Snapping the radius makes repeat measurements of an address land on the same
 * tuple instead of a near-miss, which is a reliability argument, not a tidiness
 * one.
 */
export const SOLAR_RADIUS_STEP_M = 5;
/**
 * What to ask for when nothing is known about the building — the recon-only
 * path, where no Instant contour exists to size the tile from. Unchanged from
 * when it was the only behaviour.
 */
export const SOLAR_DEFAULT_RADIUS_M = 40;

/** Snap up to a servable radius. */
export function quantiseRadiusM(metres: number): number {
  const stepped = Math.ceil(metres / SOLAR_RADIUS_STEP_M) * SOLAR_RADIUS_STEP_M;
  return Math.min(SOLAR_MAX_RADIUS_M, Math.max(SOLAR_RADIUS_STEP_M, stepped));
}

// radiusMeters was a fixed 40 — "comfortably larger than any residential roof".
// Measured on the six field addresses, that was 6-7x too many PIXELS for a
// suburban house (they need 15-20 m, and pixels go as the square of the radius)
// and too SMALL for a 20-building farm, which needs 105 m and so cannot be
// fully covered at all. Callers now size it from the contour; the default is
// kept for callers that have none.
export async function getDataLayers(
  lat: number,
  lng: number,
  radiusMeters: number = SOLAR_DEFAULT_RADIUS_M,
): Promise<DataLayerUrls> {
  if (!isSolarEnabled()) throw new Error("Google Maps key is not configured");
  const url =
    `${SOLAR_BASE}/dataLayers:get` +
    `?location.latitude=${lat}&location.longitude=${lng}` +
    `&radiusMeters=${radiusMeters}&view=FULL_LAYERS&requiredQuality=HIGH` +
    `&pixelSizeMeters=0.1&key=${process.env.GOOGLE_MAPS_API_KEY}`;
  const res = await solarFetch(url, "dataLayers");
  const d = obj(await res.json());
  const asUrl = (v: unknown) => (typeof v === "string" && v ? v : null);
  return {
    imageryQuality: String(d.imageryQuality ?? "UNKNOWN"),
    imageryDate: (d.imageryDate as SolarDate | undefined) ?? null,
    dsmUrl: asUrl(d.dsmUrl),
    maskUrl: asUrl(d.maskUrl),
    rgbUrl: asUrl(d.rgbUrl),
  };
}

// ── Raster fetch + decode ────────────────────────────────────────────────────

export interface Raster {
  width: number;
  height: number;
  data: Float32Array; //   row-major, length = width * height
  pixelSizeM: number; //   metres per pixel (square pixels in practice)
  originX: number; //      projected easting of the top-left pixel corner
  originY: number; //      projected northing of the top-left pixel corner
  epsg: number | null; //  projected CRS code (e.g. 32616 = UTM 16N)
}

export async function fetchRaster(url: string): Promise<Raster> {
  if (!isSolarEnabled()) throw new Error("Google Maps key is not configured");
  // The layer URLs carry no credentials of their own (gotcha 2).
  const sep = url.includes("?") ? "&" : "?";
  const res = await solarFetch(`${url}${sep}key=${process.env.GOOGLE_MAPS_API_KEY}`, "raster");
  const buf = await res.arrayBuffer();
  const tiff = await fromArrayBuffer(buf);
  const img = await tiff.getImage();
  const [resX] = img.getResolution();
  const [originX, originY] = img.getOrigin();
  const bands = await img.readRasters();
  const first = (Array.isArray(bands) ? bands[0] : bands) as ArrayLike<number>;
  const geoKeys = (img.getGeoKeys?.() ?? {}) as Record<string, number>;

  // Copy into a Float32Array so downstream maths is uniform regardless of the
  // source sample format (DSM is float32, mask is uint8).
  const data = new Float32Array(first.length);
  for (let i = 0; i < first.length; i++) data[i] = first[i];

  return {
    width: img.getWidth(),
    height: img.getHeight(),
    data,
    pixelSizeM: Math.abs(resX),
    originX,
    originY,
    epsg: geoKeys.ProjectedCSTypeGeoKey ?? null,
  };
}

/** The aerial photograph of a tile (the dataLayers `rgbUrl`): three bytes a pixel, on the same grid as the DSM. */
export interface RgbRaster {
  width: number;
  height: number;
  /** red, green, blue per pixel, row-major */
  data: Uint8Array;
  pixelSizeM: number;
  originX: number;
  originY: number;
  epsg: number | null;
}

/**
 * The tile's aerial photograph (2026-11-11, the roof facet lab). Same fetch as fetchRaster — the bare layer URL plus
 * the key — but all three colour bands are kept. The photograph and the DSM of one dataLayers answer share a flight
 * and a grid, which is what lets lines read off the height map be drawn on the picture without lining anything up.
 */
export async function fetchRgbRaster(url: string): Promise<RgbRaster> {
  if (!isSolarEnabled()) throw new Error("Google Maps key is not configured");
  const sep = url.includes("?") ? "&" : "?";
  const res = await solarFetch(`${url}${sep}key=${process.env.GOOGLE_MAPS_API_KEY}`, "rgb");
  const tiff = await fromArrayBuffer(await res.arrayBuffer());
  const img = await tiff.getImage();
  const [resX] = img.getResolution();
  const [originX, originY] = img.getOrigin();
  const bands = await img.readRasters();
  const list = (Array.isArray(bands) ? bands : [bands]) as ArrayLike<number>[];
  const width = img.getWidth(), height = img.getHeight();
  const data = new Uint8Array(width * height * 3);
  // a one-band answer (it has happened with masks) is shown grey rather than refused
  const r = list[0], g = list[1] ?? list[0], b = list[2] ?? list[0];
  for (let i = 0; i < width * height; i++) {
    data[i * 3] = r[i];
    data[i * 3 + 1] = g[i];
    data[i * 3 + 2] = b[i];
  }
  const geoKeys = (img.getGeoKeys?.() ?? {}) as Record<string, number>;
  return { width, height, data, pixelSizeM: Math.abs(resX), originX, originY, epsg: geoKeys.ProjectedCSTypeGeoKey ?? null };
}

