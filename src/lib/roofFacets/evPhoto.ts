// ROOF FACETS — EAGLEVIEW'S PICTURE ON THE ROOF'S OWN GRID (2026-11-13, owner: "check that now EagleView is showing
// their aerial picture and see if you can get a better diagram"; then "do it").
//
// EagleView's ortho of a parcel is twice as sharp as Google's photograph (2 in a pixel against 4) and newer. It comes
// with the corners of the ground it covers (latitude and longitude), and placed by those it sits a few feet from
// Google's height map (0.3 m west and 1.1 m south on the first roof looked at) — every aerial source has its own
// idea of where the ground is. EagleView's own roof outline is no help in finding the difference: on that same roof
// the outline had to be moved 0.8 m further than the picture (their picture leans a little; the outline does not).
//
// So the picture is lined up against the photograph that IS on the height map's grid — Google's: both are turned
// into "how strong is the edge here", and EagleView's is slid over Google's, across the building, to where the edges
// agree best. Only a clear best is believed. The picture is then laid on the grid with that slide taken out, at two
// of its pixels to one of the height map's, and it is this picture the lines are set on (./photoSnap) and the lab
// shows.
//
// Pure: numbers in, numbers out. A point of the grid is in the engine's raster pixels (x east, y south, continuous).

import { fromUtm, pixelToUtm, type RasterFrame } from "./geo";

/** A photograph on the engine's grid: `scale` of its pixels to one raster pixel, its top-left corner at (x0, y0). */
export interface GridPhoto {
  width: number;
  height: number;
  /** RGB, three bytes a pixel, rows from the top */
  data: Uint8Array;
  scale: number;
  x0: number;
  y0: number;
}

/** A piece of the raster, in its pixels: [x0, x1) by [y0, y1). */
export interface GridArea {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface OrthoImage {
  width: number;
  height: number;
  /** RGB, three bytes a pixel */
  data: Uint8Array;
  /** [minLon, minLat, maxLon, maxLat] of the ground the picture covers, north up */
  bbox: [number, number, number, number];
}

/**
 * EagleView's picture over `area`, at `scale` pixels to one raster pixel. `slide` is how far the picture sits from
 * the grid, in raster pixels: a point of the grid at (x, y) shows what the picture has at (x + dx, y + dy).
 * Ground the picture does not cover stays black.
 */
export function orthoOnGrid(img: OrthoImage, frame: RasterFrame, area: GridArea, scale: number, slide: { dx: number; dy: number } = { dx: 0, dy: 0 }): GridPhoto {
  const W = Math.max(1, Math.round((area.x1 - area.x0) * scale)), H = Math.max(1, Math.round((area.y1 - area.y0) * scale));
  const data = new Uint8Array(W * H * 3);
  // Latitude and longitude run all but straight across a house lot: they are worked out at the area's four corners
  // and read off between them (a centimetre's fraction of error; the grid's north is not true north, so the picture
  // is laid on turned by that much, as it should be).
  const corner = (x: number, y: number) => { const u = pixelToUtm(frame, x + slide.dx, y + slide.dy); return fromUtm(u.e, u.n, frame.epsg); };
  const c00 = corner(area.x0, area.y0), c10 = corner(area.x1, area.y0), c01 = corner(area.x0, area.y1), c11 = corner(area.x1, area.y1);
  const [lon0, lat0, lon1, lat1] = img.bbox;
  const kx = img.width / (lon1 - lon0), ky = img.height / (lat1 - lat0);
  for (let y = 0; y < H; y++) {
    const v = (y + 0.5) / H;
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W;
      const lng = c00.lng * (1 - u) * (1 - v) + c10.lng * u * (1 - v) + c01.lng * (1 - u) * v + c11.lng * u * v;
      const lat = c00.lat * (1 - u) * (1 - v) + c10.lat * u * (1 - v) + c01.lat * (1 - u) * v + c11.lat * u * v;
      const fx = (lng - lon0) * kx - 0.5, fy = (lat1 - lat) * ky - 0.5;
      const ix = Math.floor(fx), iy = Math.floor(fy);
      if (ix < 0 || iy < 0 || ix >= img.width - 1 || iy >= img.height - 1) continue;
      const ax = fx - ix, ay = fy - iy, i = (iy * img.width + ix) * 3, o = (y * W + x) * 3;
      for (let k = 0; k < 3; k++) {
        data[o + k] = img.data[i + k] * (1 - ax) * (1 - ay) + img.data[i + 3 + k] * ax * (1 - ay) + img.data[i + img.width * 3 + k] * (1 - ax) * ay + img.data[i + img.width * 3 + 3 + k] * ax * ay;
      }
    }
  }
  return { width: W, height: H, data, scale, x0: area.x0, y0: area.y0 };
}

/** A photograph that already lies on a grid of its own (Google's tile: `px` metres a pixel from a UTM corner) cut to `area` of the engine's grid. */
export function tileOnGrid(tile: { width: number; height: number; data: Uint8Array; pixelSizeM: number; originX: number; originY: number }, frame: RasterFrame, area: GridArea): GridPhoto {
  const scale = frame.pixelSizeM / tile.pixelSizeM;
  const W = Math.max(1, Math.round((area.x1 - area.x0) * scale)), H = Math.max(1, Math.round((area.y1 - area.y0) * scale));
  const data = new Uint8Array(W * H * 3);
  const tx0 = Math.round((frame.originX + area.x0 * frame.pixelSizeM - tile.originX) / tile.pixelSizeM), ty0 = Math.round((tile.originY - (frame.originY - area.y0 * frame.pixelSizeM)) / tile.pixelSizeM);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const sx = tx0 + x, sy = ty0 + y;
    if (sx < 0 || sy < 0 || sx >= tile.width || sy >= tile.height) continue;
    const i = (sy * tile.width + sx) * 3, o = (y * W + x) * 3;
    data[o] = tile.data[i]; data[o + 1] = tile.data[i + 1]; data[o + 2] = tile.data[i + 2];
  }
  return { width: W, height: H, data, scale, x0: area.x0, y0: area.y0 };
}

/** How strong the edge is at every pixel: the photograph's brightness, lightly blurred, and the size of its change. */
function edges(p: GridPhoto): Float32Array {
  const { width: w, height: h } = p;
  const g = new Float32Array(w * h), b = new Float32Array(w * h), e = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = 0.299 * p.data[i * 3] + 0.587 * p.data[i * 3 + 1] + 0.114 * p.data[i * 3 + 2];
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    let s = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += g[(y + dy) * w + x + dx];
    b[y * w + x] = s / 9;
  }
  for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) e[y * w + x] = Math.hypot(b[y * w + x + 1] - b[y * w + x - 1], b[(y + 1) * w + x] - b[(y - 1) * w + x]);
  return e;
}

/**
 * How far picture `b` sits from picture `a` — both on one grid, one pixel to a raster pixel, over one area — where
 * `on` marks the building: `a` at (x, y) shows what `b` has at (x + dx, y + dy). `clear` is false when no slide
 * stands out from the rest (different seasons, a roof under trees): the answer is then not to be used.
 */
export function photoSlide(a: GridPhoto, b: GridPhoto, on: Uint8Array, reachPx = 30): { dx: number; dy: number; clear: boolean; peak: number } {
  const w = a.width, h = a.height;
  if (b.width !== w || b.height !== h || on.length !== w * h || w < 2 * reachPx + 12 || h < 2 * reachPx + 12) return { dx: 0, dy: 0, clear: false, peak: 0 };
  const ea = edges(a), eb = edges(b);
  // the building's own pixels, where `a` shows an edge worth the name
  const at: number[] = [];
  let sum = 0, n = 0;
  for (let y = reachPx + 2; y < h - reachPx - 2; y++) for (let x = reachPx + 2; x < w - reachPx - 2; x++) if (on[y * w + x]) { sum += ea[y * w + x]; n++; }
  if (n < 400) return { dx: 0, dy: 0, clear: false, peak: 0 };
  const floor = (sum / n) * 0.8;
  for (let y = reachPx + 2; y < h - reachPx - 2; y++) for (let x = reachPx + 2; x < w - reachPx - 2; x++) if (on[y * w + x] && ea[y * w + x] > floor) at.push(y * w + x);
  const side = 2 * reachPx + 1;
  const score = new Float64Array(side * side);
  let best = 0;
  for (let dy = -reachPx; dy <= reachPx; dy++) for (let dx = -reachPx; dx <= reachPx; dx++) {
    let s = 0;
    const off = dy * w + dx;
    for (const i of at) s += ea[i] * eb[i + off];
    const k = (dy + reachPx) * side + dx + reachPx;
    score[k] = s;
    if (s > score[best]) best = k;
  }
  const sorted = Array.from(score).sort((p, q) => p - q);
  const median = sorted[sorted.length >> 1] || 1e-9;
  const bx = (best % side) - reachPx, by = Math.floor(best / side) - reachPx;
  const peak = score[best] / median;
  // at the edge of the reach the true best may lie beyond it
  if (Math.abs(bx) >= reachPx || Math.abs(by) >= reachPx) return { dx: bx, dy: by, clear: false, peak };
  // to a part of a pixel: the top of a parabola through the best and its neighbours
  const sub = (m: number, c: number, p: number) => { const den = m - 2 * c + p; return den < 0 ? (0.5 * (m - p)) / den : 0; };
  const dx = bx + sub(score[best - 1], score[best], score[best + 1]), dy = by + sub(score[best - side], score[best], score[best + side]);
  // Clear: the best stands at twice the run of the rest. (Seen so far: 3.0 on a low roof photographed from straight
  // above; 1.2 to 1.5, at a slide that was not the true one, on a steep roof whose picture leans.)
  return { dx, dy, clear: peak >= 2, peak };
}

/** A photograph on the grid, cut to a window of it and written out as RGB at the photograph's own resolution. */
export function cutPhoto(p: GridPhoto, win: GridArea): { width: number; height: number; data: Uint8Array } {
  const W = Math.max(1, Math.round((win.x1 - win.x0) * p.scale)), H = Math.max(1, Math.round((win.y1 - win.y0) * p.scale));
  const ox = Math.round((win.x0 - p.x0) * p.scale), oy = Math.round((win.y0 - p.y0) * p.scale);
  const data = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const sx = ox + x, sy = oy + y;
    if (sx < 0 || sy < 0 || sx >= p.width || sy >= p.height) continue;
    const i = (sy * p.width + sx) * 3, o = (y * W + x) * 3;
    data[o] = p.data[i]; data[o + 1] = p.data[i + 1]; data[o + 2] = p.data[i + 2];
  }
  return { width: W, height: H, data };
}
