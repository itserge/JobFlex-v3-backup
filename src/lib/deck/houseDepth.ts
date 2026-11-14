// THE WALL'S DEPTH OFF ITS PHOTO (2026-10-26) — server only; the arithmetic (depthVerdicts) is pure. Owner: "in the
// 3D model we want not just a flat wall and roof … changes in walls if a certain part comes out or goes deeper". The
// vision model says what and where; the eave-shadow pass (lib/deck/wallSteps) says which way a part stands only when
// its shadow is plain, and the owner's photos kept coming back with a corner read the wrong way round. A depth map
// says it directly. One Depth Anything v2 run on fal (the key the roof segmentation uses) gives relative depth for
// every pixel — nearer brighter; checked against the ground below the wall, which is always nearer than the wall's
// base (nearIsBright). Then, inside the house's own silhouette and clear of its windows and doors:
//   · a plane is fitted to the MAIN wall's depth (the widest section — the camera looks at it at an angle, so its
//     depth is a slope across the picture, not one value);
//   · each other section's depth against that plane says out, back or level — the sign for the steps, the size left
//     to the model's word or the contractor's hand (lib/deck/houseDepthApply);
//   · what is left over inside a section — a chimney, a bay, a recessed entry — stands out of the plane as a blob:
//     the wall's relief, as boxes the 3D can raise or sink.
// The map is read at 160 px across: a 2-ft step across a yard is a few per cent of the depth, plain at that size.

import { getFal, isFalEnabled } from "@/lib/sdk/falAi";
import { logServerError } from "@/lib/server-events";
import { notePaidCall } from "@/lib/trialMeter";
import { mainSection, parseHouseRead, readSections, type HouseRead } from "./houseRead";
import { baseYAt } from "./photoFit";
import { inFrontAt } from "./houseInFront";
import { photoOf } from "./housePhotoServer";
import type { DepthRelief, DepthVerdict } from "./houseDepthApply";

export const DEPTH_ENDPOINT = "fal-ai/image-preprocessors/depth-anything/v2";
export const DEPTH_MODEL = "depth-anything-v2";
/** The map's width in cells (its height by the picture's shape). */
const MAP_W = 160;

export type HouseDepthResult = { ok: true; verdicts: DepthVerdict[]; relief: DepthRelief[]; nearIsBright: boolean; model: string } | { ok: false; error: string; configured: boolean };

/** A depth map: 0…1 per cell, row by row. */
export interface DepthMap {
  w: number;
  h: number;
  data: Float32Array;
}

/** The depth map runs with the fal key, unless DECK_PHOTO_DEPTH="0" turns it off with the key kept. */
export function isDepthEnabled(): boolean {
  return isFalEnabled() && process.env.DECK_PHOTO_DEPTH !== "0";
}

/**
 * The depth map of the house photo, and what it says about the wall. The form carries the picture (the one the review
 * shows, shrunk) and `read`, the house read in that picture's fractions (the sections to compare, the openings to skip,
 * the silhouette to stay inside).
 */
export async function readHouseDepthImage(form: FormData, logAs: { organizationId: string }): Promise<HouseDepthResult> {
  const p = photoOf(form);
  if (!p.ok) return { ...p, configured: true };
  const readRaw = form.get("read");
  let read: HouseRead | null = null;
  try {
    read = typeof readRaw === "string" && readRaw.length < 200_000 ? parseHouseRead(JSON.parse(readRaw)) : null;
  } catch {
    read = null;
  }
  if (!read) return { ok: false, error: "The wall's lines were not sent with the picture.", configured: true };
  if (!isDepthEnabled()) return { ok: false, error: "The depth map needs the fal.ai key on the server.", configured: false };
  try {
    const fal = await getFal();
    const bytes = Buffer.from(await p.file.arrayBuffer());
    const url = await fal.storage.upload(new Blob([bytes], { type: p.file.type }));
    const res = await fal.subscribe(DEPTH_ENDPOINT, { input: { image_url: url } });
    void notePaidCall("fal", "depth", { orgId: logAs.organizationId }).catch(() => {});
    const out = (res.data as { image?: { url?: string } } | undefined)?.image?.url;
    if (!out) return { ok: false, error: "The depth map did not come back.", configured: true };
    const png = Buffer.from(await (await fetch(out)).arrayBuffer());
    const map = await grayMap(png, MAP_W);
    return { ok: true, ...depthVerdicts(read, map), model: DEPTH_MODEL };
  } catch (err) {
    logServerError("deck-house-depth", err, { kind: "action", organizationId: logAs.organizationId });
    return { ok: false, error: "The wall's depth could not be read this time.", configured: true };
  }
}

/** The depth PNG as a small grey map (sharp, which Next already ships for its images). */
async function grayMap(png: Buffer, width: number): Promise<DepthMap> {
  const sharp = (await import("sharp")).default;
  const { data, info } = await sharp(png).resize({ width, fit: "inside" }).greyscale().raw().toBuffer({ resolveWithObject: true });
  const ch = Math.max(1, info.channels);
  const out = new Float32Array(info.width * info.height);
  for (let i = 0; i < out.length; i++) out[i] = data[i * ch] / 255;
  return { w: info.width, h: info.height, data: out };
}

/* ------------------------------------------------------------------ */
/*  The arithmetic (pure)                                               */
/* ------------------------------------------------------------------ */

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const r4 = (n: number) => Math.round(n * 10000) / 10000;
const lineY = (l: { left: { x: number; y: number }; right: { x: number; y: number } }, x: number) => l.left.y + ((l.right.y - l.left.y) * (x - l.left.x)) / Math.max(1e-6, l.right.x - l.left.x);
const median = (a: number[]) => {
  if (!a.length) return 0;
  const s = [...a].sort((p, q) => p - q);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
/** The median of the distances from the median — a spread the odd far-off cell (a drainpipe, a light) does not swing. */
const mad = (a: number[]) => {
  const m = median(a);
  return median(a.map((v) => Math.abs(v - m)));
};

/** Whether a point is inside a polygon (fractions), by the ray to the right. */
function insidePolygon(poly: Array<{ x: number; y: number }>): (x: number, y: number) => boolean {
  return (x, y) => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i];
      const b = poly[j];
      if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  };
}

interface Sample {
  x: number;
  y: number;
  d: number;
  sec: number;
  i: number;
}

/** The plane d ≈ a·(x − mx) + b·(y − my) + c through the samples, least squares. */
function fitPlane(s: Sample[]): { a: number; b: number; c: number; mx: number; my: number } {
  const n = s.length;
  const mx = s.reduce((t, p) => t + p.x, 0) / n;
  const my = s.reduce((t, p) => t + p.y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  let sxd = 0;
  let syd = 0;
  let sd = 0;
  for (const p of s) {
    const x = p.x - mx;
    const y = p.y - my;
    sxx += x * x;
    sxy += x * y;
    syy += y * y;
    sxd += x * p.d;
    syd += y * p.d;
    sd += p.d;
  }
  const det = sxx * syy - sxy * sxy;
  if (Math.abs(det) < 1e-9) return { a: 0, b: 0, c: sd / n, mx, my };
  const a = (sxd * syy - syd * sxy) / det;
  const b = (syd * sxx - sxd * sxy) / det;
  return { a, b, c: sd / n, mx, my };
}

/**
 * Which way is near: the ground at the bottom of the picture is nearer the camera than the ground at the wall's base.
 * When the picture runs well below the base, the two strips are compared; a brighter bottom strip means nearer is
 * brighter (how Depth Anything draws it); the other way round, the map is inverted. Too little ground: brighter is
 * taken as nearer.
 */
function nearSide(read: HouseRead, map: DepthMap): boolean {
  const { w, h, data } = map;
  const xL = Math.min(read.base.left.x, read.base.right.x);
  const xR = Math.max(read.base.left.x, read.base.right.x);
  const baseLow = Math.max(read.base.left.y, read.base.right.y);
  if (baseLow > 0.88) return true;
  const under: number[] = [];
  const bottom: number[] = [];
  for (let y = 0; y < h; y++) {
    const fy = (y + 0.5) / h;
    for (let x = 0; x < w; x++) {
      const fx = (x + 0.5) / w;
      if (fx < xL + (xR - xL) * 0.2 || fx > xR - (xR - xL) * 0.2) continue;
      const b = baseYAt(read, fx);
      if (fy > b + 0.01 && fy < b + 0.04) under.push(data[y * w + x]);
      else if (fy > 0.96) bottom.push(data[y * w + x]);
    }
  }
  if (under.length < 20 || bottom.length < 20) return true;
  const d = median(bottom) - median(under);
  return d >= -0.02;
}

/**
 * What the depth map says about the wall: each section out, back or level against the main wall's plane, and the
 * relief inside the sections. Nothing (empty lists) when the main wall gives too few cells to fit a plane to — a
 * tiny wall in the frame, or one all windows.
 */
export function depthVerdicts(read: HouseRead, map: DepthMap): { verdicts: DepthVerdict[]; relief: DepthRelief[]; nearIsBright: boolean } {
  const { w, h, data } = map;
  const none = { verdicts: [] as DepthVerdict[], relief: [] as DepthRelief[], nearIsBright: true };
  const secs = readSections(read);
  if (!secs.length || w < 16 || h < 16) return none;
  const xL = Math.min(read.base.left.x, read.base.right.x);
  const xR = Math.max(read.base.left.x, read.base.right.x);
  const eaveY = (fx: number) => (read.eave ? lineY(read.eave, fx) : baseYAt(read, fx) - 0.3);
  const holes = [
    ...read.windows.map((win) => ({ x0: win.x0, x1: win.x1, y0: win.head, y1: win.sill })),
    ...read.doors.map((d) => ({ x0: d.x0, x1: d.x1, y0: d.top, y1: d.bottom })),
  ];
  const inOutline = read.outline && read.outline.length >= 3 ? insidePolygon(read.outline) : null;
  // What stands in front of the wall is nearer than the wall: an old deck measured as a part that "comes out" (2026-11-13).
  const hidden = inFrontAt(read);
  const inset = (xR - xL) * 0.02;
  const inWall = (fx: number, fy: number) => {
    if (fx < xL + inset || fx > xR - inset) return false;
    const top = eaveY(fx);
    const bot = baseYAt(read, fx);
    const H = bot - top;
    if (H <= 0.02) return false;
    if (fy < top + H * 0.04 || fy > bot - H * 0.03) return false;
    if (holes.some((b) => fx > b.x0 - 0.008 && fx < b.x1 + 0.008 && fy > b.y0 - 0.008 && fy < b.y1 + 0.008)) return false;
    if (hidden(fx, fy)) return false;
    return !inOutline || inOutline(fx, fy);
  };
  const secOf = (fx: number) => {
    const i = secs.findIndex((s) => fx >= s.x0 && fx < s.x1);
    return i >= 0 ? i : fx >= secs[secs.length - 1].x1 ? secs.length - 1 : -1;
  };
  const samples: Sample[] = [];
  for (let y = 0; y < h; y++) {
    const fy = (y + 0.5) / h;
    for (let x = 0; x < w; x++) {
      const fx = (x + 0.5) / w;
      if (!inWall(fx, fy)) continue;
      const sec = secOf(fx);
      if (sec < 0) continue;
      samples.push({ x, y, d: data[y * w + x], sec, i: y * w + x });
    }
  }
  const main = mainSection(secs);
  const mainS = samples.filter((s) => s.sec === main);
  if (mainS.length < 40) return none;
  const plane = fitPlane(mainS);
  const resid = (s: Sample) => s.d - (plane.a * (s.x - plane.mx) + plane.b * (s.y - plane.my) + plane.c);
  const noise = mad(mainS.map(resid)) * 1.4826;
  // A step shows as a few per cent of the depth across a yard; the wall's own texture is read as noise and a step
  // has to stand well clear of it.
  const thr = Math.max(0.012, 2.5 * noise);
  const nearIsBright = nearSide(read, map);
  const toward = (r: number) => (nearIsBright ? r : -r);
  const shifts = secs.map((_, i) => {
    const r = samples.filter((s) => s.sec === i).map(resid);
    return r.length >= 20 ? median(r) : null;
  });
  const verdicts: DepthVerdict[] = [];
  secs.forEach((sec, i) => {
    const sh = shifts[i];
    if (sh === null) return;
    const near = toward(sh);
    const state: DepthVerdict["state"] = i === main || Math.abs(near) <= thr ? "level" : near > 0 ? "out" : "back";
    verdicts.push({ x0: r3(sec.x0), x1: r3(sec.x1), state, shift: r4(near), sure: i === main ? 1 : r2(clamp(Math.abs(near) / (2 * thr), 0, 1)) });
  });
  // THE RELIEF: what stands out of its own section's plane, as blobs.
  const rthr = Math.max(0.015, 3.5 * noise);
  const mask = new Int8Array(w * h);
  const local = new Float32Array(w * h);
  for (const s of samples) {
    const near = toward(resid(s) - (shifts[s.sec] ?? 0));
    local[s.i] = near;
    if (Math.abs(near) > rthr) mask[s.i] = near > 0 ? 1 : -1;
  }
  const relief = reliefBlobs(mask, local, w, h, samples.length, rthr, secs, (fx) => baseYAt(read, fx) - eaveY(fx));
  return { verdicts, relief, nearIsBright };
}

/** The blobs of the relief mask: each one's box, way and strength — the few largest, none a whole section. */
function reliefBlobs(mask: Int8Array, local: Float32Array, w: number, h: number, wallCells: number, rthr: number, secs: Array<{ x0: number; x1: number }>, wallH: (fx: number) => number): DepthRelief[] {
  const seen = new Uint8Array(w * h);
  const found: Array<DepthRelief & { area: number }> = [];
  const minArea = Math.max(12, Math.round(wallCells * 0.012));
  const stack: number[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    const sign = mask[start];
    let area = 0;
    let sum = 0;
    let bx0 = w;
    let bx1 = -1;
    let by0 = h;
    let by1 = -1;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % w;
      const y = (i - x) / w;
      area++;
      sum += Math.abs(local[i]);
      if (x < bx0) bx0 = x;
      if (x > bx1) bx1 = x;
      if (y < by0) by0 = y;
      if (y > by1) by1 = y;
      for (const j of [i - 1, i + 1, i - w, i + w]) {
        if (j < 0 || j >= mask.length || seen[j] || mask[j] !== sign) continue;
        if ((j === i - 1 && x === 0) || (j === i + 1 && x === w - 1)) continue;
        seen[j] = 1;
        stack.push(j);
      }
    }
    if (area < minArea) continue;
    const x0 = bx0 / w;
    const x1 = (bx1 + 1) / w;
    const y0 = by0 / h;
    const y1 = (by1 + 1) / h;
    // A blob as wide and as tall as its section is the section (its step is a verdict, not relief).
    const cx = (x0 + x1) / 2;
    const sec = secs.find((s) => cx >= s.x0 && cx <= s.x1) ?? secs[0];
    if (x1 - x0 > (sec.x1 - sec.x0) * 0.6 && y1 - y0 > wallH(cx) * 0.6) continue;
    found.push({ x0: r3(x0), y0: r3(y0), x1: r3(x1), y1: r3(y1), dir: sign > 0 ? "out" : "back", strength: r2(sum / area / rthr), area });
  }
  return found
    .sort((a, b) => b.area - a.area)
    .slice(0, 4)
    .map(({ area: _a, ...r }) => r);
}
