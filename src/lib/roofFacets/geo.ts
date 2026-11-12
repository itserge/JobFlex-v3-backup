// ROOF FACETS — WHERE THE RASTER SITS ON THE EARTH (2026-11-11). Google's height maps come projected (UTM, metres),
// EagleView's outline comes as lat/lng. These two functions go between them exactly (Krüger series, good to well
// under a centimetre) — the old reconstruction used a flat-earth shortcut about the tile centre, which leaves the
// grid's tilt (up to a few degrees) in every converted ring. Pure.

const A = 6378137;
const F = 1 / 298.257223563;
const K0 = 0.9996;
const N = F / (2 - F);
const A_BAR = (A / (1 + N)) * (1 + N ** 2 / 4 + N ** 4 / 64);

const zoneOf = (epsg: number) => ({ zone: epsg % 100, south: Math.floor(epsg / 100) === 327 });

/** True when the code is a WGS84 UTM zone (EPSG:326xx north, 327xx south). */
export const isUtm = (epsg: number | null | undefined): epsg is number => typeof epsg === "number" && (Math.floor(epsg / 100) === 326 || Math.floor(epsg / 100) === 327) && epsg % 100 >= 1 && epsg % 100 <= 60;

export function toUtm(lat: number, lng: number, epsg: number): { e: number; n: number } {
  const { zone, south } = zoneOf(epsg);
  const al = [N / 2 - (2 / 3) * N ** 2 + (5 / 16) * N ** 3, (13 / 48) * N ** 2 - (3 / 5) * N ** 3, (61 / 240) * N ** 3];
  const phi = (lat * Math.PI) / 180, lam = ((lng - (zone * 6 - 183)) * Math.PI) / 180;
  const c = (2 * Math.sqrt(N)) / (1 + N);
  const t = Math.sinh(Math.atanh(Math.sin(phi)) - c * Math.atanh(c * Math.sin(phi)));
  const xi = Math.atan2(t, Math.cos(lam)), eta = Math.atanh(Math.sin(lam) / Math.sqrt(1 + t * t));
  let e = eta, n = xi;
  for (let j = 1; j <= 3; j++) {
    e += al[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
    n += al[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
  }
  return { e: 500000 + K0 * A_BAR * e, n: (south ? 10000000 : 0) + K0 * A_BAR * n };
}

export function fromUtm(e: number, n: number, epsg: number): { lat: number; lng: number } {
  const { zone, south } = zoneOf(epsg);
  const be = [N / 2 - (2 / 3) * N ** 2 + (37 / 96) * N ** 3, (1 / 48) * N ** 2 + (1 / 15) * N ** 3, (17 / 480) * N ** 3];
  const de = [2 * N - (2 / 3) * N ** 2 - 2 * N ** 3, (7 / 3) * N ** 2 - (8 / 5) * N ** 3, (56 / 15) * N ** 3];
  const xi = (n - (south ? 10000000 : 0)) / (K0 * A_BAR), eta = (e - 500000) / (K0 * A_BAR);
  let xi1 = xi, eta1 = eta;
  for (let j = 1; j <= 3; j++) {
    xi1 -= be[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    eta1 -= be[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
  }
  const chi = Math.asin(Math.sin(xi1) / Math.cosh(eta1));
  let phi = chi;
  for (let j = 1; j <= 3; j++) phi += de[j - 1] * Math.sin(2 * j * chi);
  const lam = Math.atan2(Math.sinh(eta1), Math.cos(xi1));
  return { lat: (phi * 180) / Math.PI, lng: zone * 6 - 183 + (lam * 180) / Math.PI };
}

/** What places a raster: the projected corner of its top-left pixel, the pixel size, the UTM zone. */
export interface RasterFrame {
  originX: number;
  originY: number;
  pixelSizeM: number;
  epsg: number;
}

/** lat/lng → raster pixels, continuous (x east, y south; pixel (c, r) covers [c, c+1) x [r, r+1)). */
export function latLngToPixel(f: RasterFrame, lat: number, lng: number): { x: number; y: number } {
  const u = toUtm(lat, lng, f.epsg);
  return { x: (u.e - f.originX) / f.pixelSizeM, y: (f.originY - u.n) / f.pixelSizeM };
}

export function pixelToUtm(f: RasterFrame, x: number, y: number): { e: number; n: number } {
  return { e: f.originX + x * f.pixelSizeM, n: f.originY - y * f.pixelSizeM };
}
