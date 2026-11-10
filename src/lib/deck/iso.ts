// THE SMALL PICTURE (2026-10-11; made real 2026-10-13) — pure. A scene the
// engine built (lib/deck/scene: boxes, flat polygons, the house) drawn as an
// SVG: no WebGL, no three.js, a few thousand paths. The kind picker shows
// every kind of project and every sample this way, and the faces come
// grouped by the build order so the picture can stand itself up layer by
// layer.
//
// Owner, 2026-10-13: "more high resolution and quality and more realistic,
// more detailed, realistic colours, go deep into the details, modern, maybe
// more glassy." So the picture is lit like a render — a sun from the front
// left, a blue sky above and a green bounce below, a highlight where a glossy
// surface catches the sun — and drawn in its materials: every board its own
// shade with the grain running along it, a sheen across composite and PVC,
// shingles in courses and metal in standing seams, glass that reflects the
// sky, soft shadows pooling under the deck and the roof, the house in its
// siding with windows and a roof, and a hint of perspective. The camera is
// the same as before: the world turned `yaw` about the up axis, seen from
// `pitch` above the horizon, the viewer in front of the deck.
//
// Faces are painted far to near. The order is worked out pair by pair from
// the faces' own planes (lib/deck/isoOrder) — a face's middle alone put the
// near end of a beam on top of the deck board over it — and falls back to
// the middle's depth where two members are drawn through each other. The
// house is painted first, block by block from the far one, with its own
// windows and roof.

import { paintOrder, type OrderFace } from "./isoOrder";
import { BORDER_BOARD_ROLE, RAIL_CAP_ROLE, RAIL_INFILL_ROLE, SCENE_LAYERS, buildRank, memberBoxCorners, MEMBER_BOX_FACES, type DeckScene, type SceneLayer } from "./scene";

export type IsoDeckingFinish = "wood" | "hardwood" | "composite" | "pvc" | "mineral" | "aluminum";
export type IsoRoofing = "arch-shingle" | "3tab-shingle" | "designer-shingle" | "cedar-shake" | "metal-panel" | "standing-seam" | "none";
/** What the design is made of, for the finish of each surface (the scene carries only the colours). */
export interface IsoMaterials {
  decking?: IsoDeckingFinish;
  roofing?: IsoRoofing;
  rail?: string;
}

export interface IsoFace {
  /** SVG path data, already rounded. */
  d: string;
  /** A colour, or `url(#id)` into the drawing's defs (the id without the figure's prefix); "none" for lines only
   *  (the edges of a long member drawn over its strips). */
  fill: string;
  opacity?: number;
  stroke?: string;
  strokeOpacity?: number;
  layer: SceneLayer | "ground" | "house" | "shadow";
  /** The build step (SCENE_BUILD_ORDER's index), −1 for the ground, the shadows and the house. */
  rank: number;
}

export type IsoDef =
  | { kind: "linear"; id: string; x1: number; y1: number; x2: number; y2: number; stops: Array<[number, string, number]> }
  | { kind: "radial"; id: string; cx: number; cy: number; r: number; stops: Array<[number, string, number]> }
  | { kind: "grain"; id: string; width: number; height: number; angle: number; lines: Array<[number, number, string, number]> }
  | { kind: "blur"; id: string; sd: number }
  | { kind: "noise"; id: string; freq: number; gain: number; lift: number };

export interface IsoDrawing {
  viewBox: string;
  faces: IsoFace[];
  /** The ranks present, ascending — the picture stands up in this order. */
  ranks: number[];
  /** How many boxes and polygons went in. */
  solids: number;
  /** Gradients, patterns and filters the faces refer to. */
  defs: IsoDef[];
}

export interface IsoOptions {
  yawDeg?: number;
  pitchDeg?: number;
  /** Layers left out of the picture (the wiring and the hardware are noise at this size). */
  skip?: readonly SceneLayer[];
  /** Beyond this many solids the thin layers go first (blocking, hardware, then joists). */
  maxSolids?: number;
  /** The eye's distance, ft: nearer things a little bigger. 0 = a true isometric. */
  perspectiveFt?: number;
  materials?: IsoMaterials;
  /** "quick": no grain, no courses, no siding lines — for the frames of a turn. */
  detail?: "full" | "quick";
}

const DEFAULT_SKIP: readonly SceneLayer[] = ["wire", "hardware", "blocking", "footing"];

export type V3 = [number, number, number];
type RGB = [number, number, number];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/* ── colour ─────────────────────────────────────────────────────────── */

function parseHex(hex: string): RGB | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const toHex = (c: RGB) => `#${c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;
const toLin = (v: number) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};
const toSrgb = (v: number) => {
  const c = clamp01(v);
  return 255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
};

/** A hex colour darkened or lightened: k < 1 darker. */
export function shadeHex(hex: string, k: number): string {
  const c = parseHex(hex);
  if (!c) return hex;
  return toHex([c[0] * k, c[1] * k, c[2] * k]);
}

/** A stable 0…1 from a few numbers, so a board keeps its own shade whichever way the picture is turned. */
function hash01(...xs: number[]): number {
  let h = 2166136261;
  for (const x of xs) {
    const v = Math.round(x * 100);
    h ^= v & 0xffff;
    h = Math.imul(h, 16777619);
    h ^= v >>> 16;
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10007) / 10007;
}

/* ── materials ──────────────────────────────────────────────────────── */

interface Finish {
  base: string;
  /** How much of the sun it throws back (0 matte … 1 chrome). */
  gloss: number;
  /** How tight that highlight is. */
  shine: number;
  opacity?: number;
}

const FRAME_LAYERS = new Set<SceneLayer>(["post", "beam", "ledger", "joist", "rim", "blocking", "brace", "roof-post", "header", "ridge", "rafter"]);

function deckingGloss(finish: IsoDeckingFinish | undefined): { gloss: number; shine: number } {
  switch (finish) {
    case "composite": return { gloss: 0.3, shine: 22 };
    case "pvc": return { gloss: 0.4, shine: 26 };
    case "mineral": return { gloss: 0.24, shine: 20 };
    case "aluminum": return { gloss: 0.62, shine: 40 };
    case "hardwood": return { gloss: 0.18, shine: 16 };
    default: return { gloss: 0.14, shine: 14 };
  }
}

function railGloss(type: string | undefined): { gloss: number; shine: number } {
  switch (type) {
    case "aluminum": case "cable": case "glass": return { gloss: 0.55, shine: 36 };
    case "vinyl": return { gloss: 0.34, shine: 24 };
    case "composite": return { gloss: 0.28, shine: 20 };
    default: return { gloss: 0.08, shine: 12 };
  }
}

function roofingGloss(r: IsoRoofing | undefined): { gloss: number; shine: number } {
  switch (r) {
    case "standing-seam": return { gloss: 0.5, shine: 34 };
    case "metal-panel": return { gloss: 0.42, shine: 30 };
    case "cedar-shake": return { gloss: 0.08, shine: 12 };
    case "none": return { gloss: 0.12, shine: 12 };
    default: return { gloss: 0.06, shine: 10 };
  }
}

/** What a part is painted with: the scene's own colours for what the contractor chose, fixed ones for the rest. */
function finishOf(layer: SceneLayer, role: string, colors: DeckScene["colors"], mats: IsoMaterials): Finish {
  if (FRAME_LAYERS.has(layer)) return { base: colors.frame, gloss: 0.06, shine: 10 };
  switch (layer) {
    case "decking": case "stair": return { base: layer === "decking" && colors.border && BORDER_BOARD_ROLE.test(role) ? colors.border : colors.decking, ...deckingGloss(mats.decking) };
    case "fascia": return { base: colors.fascia, ...deckingGloss(mats.decking) };
    case "rail":
      if (role === "cable") return { base: "#c9ced4", gloss: 0.75, shine: 60 };
      // Black metal balusters or a wire mesh in a rail of another colour (2026-11-09).
      if (colors.railInfill && RAIL_INFILL_ROLE.test(role)) return { base: colors.railInfill, gloss: 0.55, shine: 36 };
      // A kit rail's drink rail is the deck's own board (2026-11-10).
      if (colors.railCap && RAIL_CAP_ROLE.test(role)) return { base: colors.railCap, ...deckingGloss(mats.decking) };
      return { base: colors.rail, ...railGloss(mats.rail) };
    case "roofing": return { base: colors.roofing, ...roofingGloss(mats.roofing) };
    case "sheathing": return { base: "#d6bf90", gloss: 0.05, shine: 10 };
    case "trim": return { base: "#f3f1ea", gloss: 0.3, shine: 20 };
    case "gutter": return { base: "#dcd9d2", gloss: 0.5, shine: 30 };
    case "ceiling": return { base: "#e6d5b2", gloss: 0.12, shine: 14 };
    case "glass": return { base: "#cfe4f0", gloss: 0, shine: 1, opacity: 0.42 };
    case "screen": return { base: "#6f7a80", gloss: 0, shine: 1, opacity: 0.38 };
    case "wall": return { base: "#e3dccd", gloss: 0.1, shine: 12 };
    case "slab": return { base: "#c9c6bd", gloss: 0.04, shine: 8 };
    case "footing": return { base: "#b9b6ad", gloss: 0.04, shine: 8 };
    case "hardware": return { base: "#9a9ea3", gloss: 0.5, shine: 30 };
    case "light": return { base: "#fff2cc", gloss: 0.6, shine: 30 };
    case "wire": return { base: "#3a3a3f", gloss: 0.1, shine: 10 };
    case "spa":
      // The water pane glossy and blue; the shell a dark acrylic cabinet.
      return role === "spa water"
        ? { base: "#6fb3cb", gloss: 0.5, shine: 40, opacity: 0.94 }
        : { base: "#4c4a45", gloss: 0.3, shine: 24 };
    default: return { base: colors.frame, gloss: 0.06, shine: 10 };
  }
}

/* ── geometry ───────────────────────────────────────────────────────── */

interface Solid {
  layer: SceneLayer | "ground" | "house";
  rank: number;
  finish: Finish;
  /** Convex faces, each a ring of world points. */
  faces: V3[][];
  /** Painted before everything, in this order (the ground, the house). */
  first?: number;
  /** A board: its own shade, the grain along its long axis. */
  board?: { axis: "x" | "y" | "diag"; seed: number };
  /** Lines drawn on the face: shingle courses, siding laps, metal seams. */
  lines?: "courses" | "shakes" | "seams" | "ribs" | "siding";
  /** A flat fill, lit as it is (the ground). */
  flat?: string;
  /** The sheen gradient over a glossy top. */
  sheen?: boolean;
  /** Casts a soft shadow on the ground. */
  shadow?: boolean;
  /** Only the top face is drawn (a window pane, a door). */
  pane?: "window" | "door";
  /** Per face, for a strip of a long member: is its far end a cut (not the member's own end), and its near end? */
  seams?: Array<[boolean, boolean] | null>;
}

/** The eight corners of a box about `c` along the unit axes u (length), v (width), w (depth). */
function orientedBox(c: V3, u: V3, v: V3, w: V3, su: number, sv: number, sw: number): V3[][] {
  const p = (a: number, b: number, d: number): V3 => add(add(add(c, scale(u, (a * su) / 2)), scale(v, (b * sv) / 2)), scale(w, (d * sw) / 2));
  const P = {
    mmm: p(-1, -1, -1), pmm: p(1, -1, -1), ppm: p(1, 1, -1), mpm: p(-1, 1, -1),
    mmp: p(-1, -1, 1), pmp: p(1, -1, 1), ppp: p(1, 1, 1), mpp: p(-1, 1, 1),
  };
  // Six faces, each wound so its normal points outward (right-hand rule).
  return [
    [P.mmp, P.pmp, P.ppp, P.mpp], // +w
    [P.mmm, P.mpm, P.ppm, P.pmm], // −w
    [P.pmm, P.ppm, P.ppp, P.pmp], // +u
    [P.mmm, P.mmp, P.mpp, P.mpm], // −u
    [P.mpm, P.mpp, P.ppp, P.ppm], // +v
    [P.mmm, P.pmm, P.pmp, P.mmp], // −v
  ];
}

const Z: V3 = [0, 0, 1];
const X: V3 = [1, 0, 0];
const Y: V3 = [0, 1, 0];

/** A scene's box row → its solid: axis-aligned, leaning (a knee brace), or turned and tilted (a rafter).
 *  Sloped members and braces come from the shared `memberBoxCorners`, so their ends are SAWN — plumb
 *  rafter tails that tuck under the roofing instead of poking through it as teeth, braces plumb at the
 *  post and level under the beam — and the WebGL viewer cuts them from the same corners. */
export function boxSolid(b: number[], role: string | null): V3[][] {
  const cut = memberBoxCorners(b, role);
  if (cut) return MEMBER_BOX_FACES.map((f) => f.map((i) => cut[i] as V3));
  const [, cx, cy, cz, sx, sy, sz, , yaw, tilt] = b;
  const c: V3 = [cx, cy, cz];
  if (typeof yaw === "number" && typeof tilt === "number") {
    const u: V3 = [Math.cos(yaw) * Math.cos(tilt), Math.sin(yaw) * Math.cos(tilt), Math.sin(tilt)];
    const v: V3 = [-Math.sin(yaw), Math.cos(yaw), 0];
    const w = norm(cross(u, v));
    return orientedBox(c, u, v, w, sx, sy, sz);
  }
  return orientedBox(c, X, Y, Z, sx, sy, sz);
}

/** Quads longer than this get painted in strips, not as one face. */
const SPLIT_FT = 4;
/** The layers whose members run long past other things — a receding
 *  fascia sorted by its middle fanned out OVER the roof at the corners. */
const SPLIT_LAYERS = new Set<SceneLayer>(["trim", "gutter", "header", "beam", "ledger", "rim", "fascia"]);
function splitLongFaces(faces: V3[][]): { faces: V3[][]; seams: Array<[boolean, boolean] | null> } {
  const out: V3[][] = [];
  // A strip's ring runs: a long edge, the cut at its far end, the other long edge, the cut at its near end.
  const seams: Array<[boolean, boolean] | null> = [];
  for (const f of faces) {
    if (f.length !== 4) { out.push(f); seams.push(null); continue; }
    const e01 = Math.hypot(f[1][0] - f[0][0], f[1][1] - f[0][1], f[1][2] - f[0][2]);
    const e12 = Math.hypot(f[2][0] - f[1][0], f[2][1] - f[1][1], f[2][2] - f[1][2]);
    const L = Math.max(e01, e12);
    if (L <= SPLIT_FT) { out.push(f); seams.push(null); continue; }
    const n = Math.min(6, Math.ceil(L / SPLIT_FT));
    const lerp = (A: V3, B: V3, t: number): V3 => [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t];
    for (let k = 0; k < n; k++) {
      const t0 = k / n, t1 = (k + 1) / n;
      // Split along the longer pair of edges, keeping the winding.
      out.push(
        e01 >= e12
          ? [lerp(f[0], f[1], t0), lerp(f[0], f[1], t1), lerp(f[3], f[2], t1), lerp(f[3], f[2], t0)]
          : [lerp(f[1], f[2], t0), lerp(f[1], f[2], t1), lerp(f[0], f[3], t1), lerp(f[0], f[3], t0)],
      );
      seams.push([k < n - 1, k > 0]);
    }
  }
  return { faces: out, seams };
}

function newell(ring: V3[]): V3 {
  let n: V3 = [0, 0, 0];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    n = [n[0] + (a[1] - b[1]) * (a[2] + b[2]), n[1] + (a[2] - b[2]) * (a[0] + b[0]), n[2] + (a[0] - b[0]) * (a[1] + b[1])];
  }
  return norm(n);
}

/** The ring kept where lo ≤ f(p) ≤ hi (f linear in p): a band across a face, for a course of shingles or a lap of siding. */
function clipBand(ring: V3[], f: (p: V3) => number, lo: number, hi: number): V3[] {
  const cut = (poly: V3[], inside: (v: number) => boolean, at: number): V3[] => {
    const out: V3[] = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const fa = f(a), fb = f(b);
      const ia = inside(fa), ib = inside(fb);
      if (ia) out.push(a);
      if (ia !== ib) {
        const t = (at - fa) / (fb - fa || 1e-9);
        out.push(add(a, scale(add(b, scale(a, -1)), t)));
      }
    }
    return out;
  };
  const a = cut(ring, (v) => v >= lo, lo);
  if (a.length < 3) return [];
  const b = cut(a, (v) => v <= hi, hi);
  return b.length >= 3 ? b : [];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/* ── the drawing ────────────────────────────────────────────────────── */

/**
 * The drawing. `yawDeg` turns the deck (positive brings its right end
 * toward the viewer); `pitchDeg` is the eye's height above the horizon.
 */
export function isoDrawing(scene: DeckScene, opts: IsoOptions = {}): IsoDrawing {
  const yaw = ((opts.yawDeg ?? 34) * Math.PI) / 180;
  const pitch = ((opts.pitchDeg ?? 28) * Math.PI) / 180;
  const skip = new Set<SceneLayer>(opts.skip ?? DEFAULT_SKIP);
  const maxSolids = opts.maxSolids ?? 2400;
  const persp = opts.perspectiveFt ?? 130;
  const mats = opts.materials ?? {};
  const full = opts.detail !== "quick";
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  /** How near a point is to the eye, before perspective. */
  const depth = (p: V3) => (p[0] * sy + p[1] * cy) * cp + p[2] * sp;
  /** The scene's middle: the eye's distance counts from here. */
  const mid: V3 = [scene.widthFt / 2, scene.depthFt / 2, scene.heightFt / 2];
  const midDepth = depth(mid);
  // World → screen. x' runs right, y' down; the eye `persp` feet in front of the middle.
  const project = (p: V3): [number, number] => {
    const x1 = p[0] * cy - p[1] * sy;
    const y1 = (p[0] * sy + p[1] * cy) * sp - p[2] * cp;
    const mx = mid[0] * cy - mid[1] * sy;
    const my = (mid[0] * sy + mid[1] * cy) * sp - mid[2] * cp;
    const s = persp > 0 ? persp / Math.max(persp * 0.4, persp - (depth(p) - midDepth)) : 1;
    return [mx + (x1 - mx) * s, my + (y1 - my) * s];
  };
  /** The direction toward the viewer, in world terms. */
  const toViewer: V3 = norm([sy * cp, cy * cp, sp]);
  /** The sun: high, from the front and the left. */
  const light: V3 = norm([-0.46, 0.4, 0.79]);
  const halfway = norm(add(light, toViewer));
  const skyTint: RGB = [0.93, 0.97, 1.08];
  const sunTint: RGB = [1.05, 1.0, 0.94];

  /** A face's colour under the sun, the sky and the ground's bounce, with a highlight when it is glossy. */
  const lit = (base: RGB, n: V3, f: Finish, k = 1): string => {
    const diff = Math.max(0, dot(n, light));
    const hemi = 0.5 + 0.5 * n[2];
    let I = (0.27 + 0.2 * hemi + 0.6 * diff) * k;
    if (n[2] < -0.3) I *= 0.84;
    const spec = f.gloss * 0.62 * Math.pow(Math.max(0, dot(n, halfway)), f.shine);
    const out: RGB = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      const tint = skyTint[i] + (sunTint[i] - skyTint[i]) * diff;
      out[i] = toSrgb(toLin(base[i]) * I * tint + spec);
    }
    return toHex(out);
  };

  const defs: IsoDef[] = [];
  const defIds = new Set<string>();
  const def = (d: IsoDef) => {
    if (!defIds.has(d.id)) { defIds.add(d.id); defs.push(d); }
    return `url(#${d.id})`;
  };
  /** The screen angle of a world direction, degrees, for the grain pattern. */
  const screenAngle = (dir: V3): number => {
    const [ax, ay] = project(mid);
    const [bx, by] = project(add(mid, dir));
    return Math.round((Math.atan2(by - ay, bx - ax) * 180) / Math.PI);
  };
  const grainFor = (axis: "x" | "y" | "diag", fine: boolean): string => {
    const dir: V3 = axis === "x" ? X : axis === "y" ? Y : norm([1, 1, 0]);
    const angle = screenAngle(dir);
    const id = `grain-${axis}-${fine ? "f" : "c"}`;
    return def(fine
      ? { kind: "grain", id, width: 3.2, height: 0.3, angle, lines: [[0.05, 0.025, "#000000", 0.07], [0.16, 0.02, "#000000", 0.05], [0.24, 0.02, "#ffffff", 0.07]] }
      : { kind: "grain", id, width: 4.6, height: 0.46, angle, lines: [[0.07, 0.03, "#000000", 0.12], [0.2, 0.025, "#000000", 0.07], [0.31, 0.02, "#ffffff", 0.09], [0.4, 0.03, "#000000", 0.08]] });
  };

  const solids: Solid[] = [];
  const layerOf = (i: number): SceneLayer | null => SCENE_LAYERS[i] ?? null;
  const roleOf = (tag: number | undefined): string => (tag != null && tag >= 0 ? scene.legend[tag]?.role ?? "" : "");

  /* ── the ground: a pad under everything, fading out at its edges ── */
  const ring = scene.outline.length >= 6 ? scene.outline : [0, 0, scene.widthFt, 0, scene.widthFt, scene.depthFt, 0, scene.depthFt];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < ring.length; i += 2) {
    minX = Math.min(minX, ring[i]); maxX = Math.max(maxX, ring[i]);
    minY = Math.min(minY, ring[i + 1]); maxY = Math.max(maxY, ring[i + 1]);
  }
  for (const f of scene.footings) {
    minX = Math.min(minX, f[0] - 1); maxX = Math.max(maxX, f[0] + 1);
    minY = Math.min(minY, f[1] - 1); maxY = Math.max(maxY, f[1] + 1);
  }
  const groundDrop = scene.ground ? Math.max(scene.ground.outDropFt, scene.ground.acrossDropFt, 0) : 0;
  const gz = -groundDrop;
  const house = scene.house && scene.house.blocks.length ? scene.house : null;
  const HOUSE_DEEP = 5.5;
  if (house) for (const blk of house.blocks) { minX = Math.min(minX, blk[0]); maxX = Math.max(maxX, blk[2]); }
  // The lawn runs well past the picture's edge at the sides and the front; behind the house it stops at the sky.
  const padX = Math.max(10, (maxX - minX) * 0.7);
  const padFront = Math.max(10, (maxY - minY) * 0.9);
  const padBack = house ? HOUSE_DEEP + 4 : Math.max(6, (maxY - minY) * 0.4);
  const groundRing: V3[] = [[minX - padX, Math.min(minY, 0) - padBack, gz], [maxX + padX, Math.min(minY, 0) - padBack, gz], [maxX + padX, maxY + padFront, gz], [minX - padX, maxY + padFront, gz]];
  const groundFill = def({ kind: "radial", id: "ground", cx: 0.5, cy: 0.45, r: 0.6, stops: [[0, "#cddbbb", 1], [0.5, "#c3d2af", 1], [1, "#b6c7a2", 1]] });
  def({ kind: "blur", id: "ground-soft", sd: 1.6 });
  solids.push({ layer: "ground", rank: -1, finish: { base: "#c3d2af", gloss: 0, shine: 1 }, first: -3, faces: [groundRing], flat: `${groundFill}|url(#ground-soft)` });
  if (full) {
    // The grass: a speckle of darker blades over the pad, fading before its edge.
    const inset = 2.2;
    const speckRing: V3[] = [[minX - padX + inset, Math.min(minY, 0) - padBack + inset, gz], [maxX + padX - inset, Math.min(minY, 0) - padBack + inset, gz], [maxX + padX - inset, maxY + padFront - inset, gz], [minX - padX + inset, maxY + padFront - inset, gz]];
    const speck = def({ kind: "noise", id: "grass", freq: 2.6, gain: 0.42, lift: -0.25 });
    const fade = def({ kind: "radial", id: "ground-fade", cx: 0.5, cy: 0.5, r: 0.5, stops: [[0, "#000000", 1], [0.6, "#000000", 0.9], [1, "#000000", 0]] });
    solids.push({ layer: "ground", rank: -1, finish: { base: "#000000", gloss: 0, shine: 1 }, first: -2, faces: [speckRing], flat: `${fade}|${speck}` });
  }

  /* ── the house: its back wall, in blocks, with windows, the door and a roof ── */
  if (house) {
    const doorH = house.door ? house.door[2] : 6.7;
    const top = Math.min(house.heightFt, scene.heightFt + doorH + 1.7);
    const siding = house.siding ?? "#e9e5db";
    const roofC = house.roofColour ?? "#55524c";
    const gable = house.roof === "gable";
    const blocks = house.blocks.map((blk, i) => ({ blk, i, d: depth([(blk[0] + blk[2]) / 2, blk[3] - HOUSE_DEEP / 2, top / 2]) })).sort((a, b) => a.d - b.d);
    const leftMost = Math.min(...house.blocks.map((b) => b[0]));
    const rightMost = Math.max(...house.blocks.map((b) => b[2]));
    const wallFinish: Finish = { base: siding, gloss: 0.08, shine: 12 };
    for (const { blk } of blocks) {
      const [x0, , x1, y1] = blk;
      const k0 = blocks.findIndex((b) => b.blk === blk) * 10;
      const c: V3 = [(x0 + x1) / 2, y1 - HOUSE_DEEP / 2, top / 2];
      solids.push({ layer: "house", rank: -1, finish: wallFinish, first: k0, faces: orientedBox(c, X, Y, Z, x1 - x0, HOUSE_DEEP, top), lines: full ? "siding" : undefined });
      // Windows and the door on this block's face, a hair in front of it.
      const yf = y1 + 0.03;
      const pane = (xc: number, w: number, z0: number, z1: number, kind: "window" | "door") => {
        if (z0 >= top - 0.4) return;
        const zt = Math.min(z1, top - 0.3);
        const frame = 0.17;
        solids.push({ layer: "house", rank: -1, finish: { base: "#f6f4ee", gloss: 0.3, shine: 20 }, first: k0 + 1, faces: [[[xc - w / 2 - frame, yf, z0 - frame], [xc + w / 2 + frame, yf, z0 - frame], [xc + w / 2 + frame, yf, zt + frame], [xc - w / 2 - frame, yf, zt + frame]]] });
        solids.push({ layer: "house", rank: -1, finish: { base: "#3a4a58", gloss: 0, shine: 1 }, first: k0 + 2, faces: [[[xc - w / 2, yf + 0.01, z0], [xc + w / 2, yf + 0.01, z0], [xc + w / 2, yf + 0.01, zt], [xc - w / 2, yf + 0.01, zt]]], pane: kind });
        // The mullion: a window's cross, a door's meeting stile.
        const bar = 0.07;
        solids.push({ layer: "house", rank: -1, finish: { base: "#f6f4ee", gloss: 0.3, shine: 20 }, first: k0 + 3, faces: [[[xc - bar, yf + 0.02, z0], [xc + bar, yf + 0.02, z0], [xc + bar, yf + 0.02, zt], [xc - bar, yf + 0.02, zt]]] });
        if (kind === "window") solids.push({ layer: "house", rank: -1, finish: { base: "#f6f4ee", gloss: 0.3, shine: 20 }, first: k0 + 3, faces: [[[xc - w / 2, yf + 0.02, (z0 + zt) / 2 - bar], [xc + w / 2, yf + 0.02, (z0 + zt) / 2 - bar], [xc + w / 2, yf + 0.02, (z0 + zt) / 2 + bar], [xc - w / 2, yf + 0.02, (z0 + zt) / 2 + bar]]] });
      };
      for (const w of house.windows ?? []) {
        if (Math.abs(w[1] - y1) > 0.05 || w[0] < x0 || w[0] > x1) continue;
        pane(w[0], w[2], w[4], w[4] + w[3], "window");
      }
      if (house.door && Math.abs((house.door[3] ?? 0) - y1) < 0.05 && house.door[0] >= x0 && house.door[0] <= x1) pane(house.door[0], house.door[1], scene.heightFt, scene.heightFt + house.door[2], "door");
      // The roof over this block: the front slope up to a ridge over the slab's middle, the eave out past the wall.
      const over = 1.0;
      const rise = 2.1;
      const leftEnd = Math.abs(x0 - leftMost) < 0.05;
      const rightEnd = Math.abs(x1 - rightMost) < 0.05;
      const ex0 = x0 - (leftEnd ? over : 0), ex1 = x1 + (rightEnd ? over : 0);
      const hipIn = gable ? 0 : 2.8;
      const rx0 = x0 + (leftEnd ? hipIn - over : 0), rx1 = x1 - (rightEnd ? hipIn - over : 0);
      const eaveZ = top + 0.12, ridgeZ = top + rise;
      const yE = y1 + over, yR = y1 - HOUSE_DEEP / 2;
      solids.push({ layer: "house", rank: -1, finish: { base: roofC, gloss: 0.06, shine: 10 }, first: k0 + 4, faces: [[[ex0, yE, eaveZ], [ex1, yE, eaveZ], [rx1, yR, ridgeZ], [rx0, yR, ridgeZ]]], lines: full ? "courses" : undefined });
      const yB = y1 - HOUSE_DEEP - over;
      solids.push({ layer: "house", rank: -1, finish: { base: roofC, gloss: 0.06, shine: 10 }, first: k0 + 4, faces: [[[rx0, yR, ridgeZ], [rx1, yR, ridgeZ], [ex1, yB, eaveZ], [ex0, yB, eaveZ]]], lines: full ? "courses" : undefined });
      if (!gable) {
        if (rightEnd) solids.push({ layer: "house", rank: -1, finish: { base: roofC, gloss: 0.06, shine: 10 }, first: k0 + 4, faces: [[[ex1, yE, eaveZ], [ex1, y1 - HOUSE_DEEP - over, eaveZ], [rx1, yR, ridgeZ]]], lines: full ? "courses" : undefined });
        if (leftEnd) solids.push({ layer: "house", rank: -1, finish: { base: roofC, gloss: 0.06, shine: 10 }, first: k0 + 4, faces: [[[ex0, y1 - HOUSE_DEEP - over, eaveZ], [ex0, yE, eaveZ], [rx0, yR, ridgeZ]]], lines: full ? "courses" : undefined });
      } else {
        // A gable's end: the wall carries on up to the ridge.
        if (rightEnd) solids.push({ layer: "house", rank: -1, finish: wallFinish, first: k0 + 4, faces: [[[x1, y1, top], [x1, y1 - HOUSE_DEEP, top], [x1, yR, ridgeZ]]] });
        if (leftEnd) solids.push({ layer: "house", rank: -1, finish: wallFinish, first: k0 + 4, faces: [[[x0, y1 - HOUSE_DEEP, top], [x0, y1, top], [x0, yR, ridgeZ]]] });
      }
      // The fascia along the eave.
      solids.push({ layer: "house", rank: -1, finish: { base: "#f3f1ea", gloss: 0.25, shine: 18 }, first: k0 + 5, faces: orientedBox([(ex0 + ex1) / 2, yE, top - 0.2], X, Y, Z, ex1 - ex0, 0.18, 0.55) });
    }
  }

  /* ── the boxes ── */
  const counts = new Map<SceneLayer, number>();
  for (const b of scene.boxes) {
    const layer = layerOf(b[0]);
    if (!layer || skip.has(layer)) continue;
    counts.set(layer, (counts.get(layer) ?? 0) + 1);
  }
  const thinFirst: SceneLayer[] = ["light", "gutter", "trim", "brace", "joist", "rafter"];
  for (const l of thinFirst) {
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    if (total <= maxSolids) break;
    const n = counts.get(l) ?? 0;
    if (n) { skip.add(l); counts.delete(l); }
  }
  const glossy = deckingGloss(mats.decking).gloss >= 0.22;
  const fineGrain = mats.decking === "composite" || mats.decking === "pvc" || mats.decking === "mineral";
  scene.boxes.forEach((b, i) => {
    const layer = layerOf(b[0]);
    if (!layer || skip.has(layer)) return;
    if (!(b[4] > 0.005 && b[5] > 0.005 && b[6] > 0.005)) return;
    const role = roleOf(scene.tags[i]);
    let finish = finishOf(layer, role, scene.colors, mats);
    // An eave board lives in the roof's own shadow. Painted at full
    // trim-white it glowed wherever a sliver of the far eave shows over
    // the near slope — bright fins on every gazebo corner.
    if (layer === "trim" && /fascia|subfascia|gutter/i.test(role)) {
      finish = { ...finish, base: shadeHex(finish.base, 0.72) };
    }
    // A LONG member sorted by its middle paints half of itself in the
    // wrong order — a receding fascia fanned out OVER the roof at every
    // gazebo corner. Long faces are split into strips so each strip
    // sorts by where it actually is.
    // Only the long thin members split; a strip is painted without a line
    // across the member at its cuts (a beam in strips read as spliced).
    const strips = SPLIT_LAYERS.has(layer) ? splitLongFaces(boxSolid(b, role)) : null;
    const s: Solid = { layer, rank: buildRank(layer), finish, faces: strips ? strips.faces : boxSolid(b, role) };
    if (strips) s.seams = strips.seams;
    if ((layer === "decking" || layer === "stair") && mats.decking !== "aluminum" && b[9] === undefined) {
      const alongX = b[4] >= b[5];
      s.board = { axis: alongX ? "x" : "y", seed: hash01(b[1], b[2], b[3]) };
      s.sheen = glossy && layer === "decking";
      s.shadow = layer === "decking";
    }
    solids.push(s);
  });
  /* ── the flat polygons: the roof's faces, the ceiling, the slab, glass, screens, walls ── */
  scene.polys.forEach((p, i) => {
    const layer = layerOf(p[0]);
    if (!layer || skip.has(layer) || p.length < 10) return;
    const ringP: V3[] = [];
    for (let k = 1; k + 2 < p.length; k += 3) ringP.push([p[k], p[k + 1], p[k + 2]]);
    const role = roleOf(scene.polyTags[i]);
    const finish = finishOf(layer, role, scene.colors, mats);
    const s: Solid = { layer, rank: buildRank(layer), finish, faces: [ringP] };
    // The floor underfoot paints with the ground: a slab sorted by its
    // nearest point painted LATE and erased the posts standing on it —
    // the octagon gazebo drew with its right half floating.
    if (layer === "slab") s.first = -1.5;
    if (layer === "roofing") {
      s.shadow = true;
      if (full && role !== "louver blade") {
        const r = mats.roofing;
        s.lines = r === "standing-seam" ? "seams" : r === "metal-panel" ? "ribs" : r === "cedar-shake" ? "shakes" : r === "none" ? undefined : "courses";
        s.sheen = r === "standing-seam" || r === "metal-panel";
      }
    }
    solids.push(s);
  });
  // Boards laid on the diagonal or cut to a shaped front: flat rings at the walking surface.
  if (scene.diagonal && !skip.has("decking")) {
    const { boards, zs, thickFt } = scene.diagonal;
    boards.forEach((ring2, i) => {
      if (ring2.length < 6) return;
      const z = (zs?.[i] ?? scene.heightFt) + thickFt / 2;
      const ringP: V3[] = [];
      for (let k = 0; k + 1 < ring2.length; k += 2) ringP.push([ring2[k], ring2[k + 1], z]);
      // The board's run: its longest edge.
      let best = 0, axis: "x" | "y" | "diag" = "diag";
      for (let k = 0; k < ringP.length; k++) {
        const a = ringP[k], c = ringP[(k + 1) % ringP.length];
        const dx = c[0] - a[0], dy = c[1] - a[1], l = Math.hypot(dx, dy);
        if (l > best) { best = l; axis = Math.abs(dx) > 5 * Math.abs(dy) ? "x" : Math.abs(dy) > 5 * Math.abs(dx) ? "y" : "diag"; }
      }
      solids.push({ layer: "decking", rank: buildRank("decking"), finish: finishOf("decking", scene.diagonal?.border?.includes(i) ? "border board" : "", scene.colors, mats), faces: [ringP], board: { axis, seed: hash01(ringP[0][0], ringP[0][1], z) }, sheen: glossy, shadow: true });
    });
  }

  /* ── the shadows: what stands above the ground, pooled softly beneath it ── */
  const shadowRings: V3[][] = [];
  const SX = 0.2, SY = 0.04;
  for (const s of solids) {
    if (!s.shadow) continue;
    const topFace = s.faces.length === 1 ? s.faces[0] : s.faces[0];
    shadowRings.push(topFace.map((p) => [p[0] + SX * (p[2] - gz), p[1] + SY * (p[2] - gz), gz]));
  }
  def({ kind: "blur", id: "soft", sd: 0.55 });

  /* ── faces: those turned toward the viewer (both sides of a lone polygon), lit, sorted far to near ── */
  // `node`: the face a painted piece belongs to (its own fill, then its grain, sheen and lines), −1 for the shadows.
  type Painted = { d: string; fill: string; opacity?: number; stroke?: string; strokeOpacity?: number; layer: IsoFace["layer"]; rank: number; depth: number; first: number; sub: number; node?: number };
  const all: Painted[] = [];
  /** The faces that are ordered by their geometry (everything but the ground, the house and the shadows). */
  const nodes: OrderFace[] = [];
  let node = -1;
  const painted = { push: (p: Painted) => { p.node = node; all.push(p); } };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const pathOf = (face: V3[], track = true): string => {
    const pts: string[] = [];
    for (const p of face) {
      const [Xp, Yp] = project(p);
      pts.push(`${r2(Xp)},${r2(Yp)}`);
      if (track) { x0 = Math.min(x0, Xp); x1 = Math.max(x1, Xp); y0 = Math.min(y0, Yp); y1 = Math.max(y1, Yp); }
    }
    return `M${pts.join("L")}Z`;
  };
  /** The face's area on the page (viewBox units) — tiny means edge-on. */
  const projArea = (face: V3[]): number => {
    let a2 = 0;
    let px = 0, py = 0, qx = 0, qy = 0;
    for (let i = 0; i < face.length; i++) {
      const [ax, ay] = project(face[i]);
      const [bx, by] = project(face[(i + 1) % face.length]);
      if (i === 0) { px = ax; py = ay; }
      qx = bx; qy = by;
      a2 += ax * by - bx * ay;
    }
    void px; void py; void qx; void qy;
    return Math.abs(a2) / 2;
  };
  const centre = (face: V3[]): V3 => {
    let cxp = 0, cyp = 0, czp = 0;
    for (const p of face) { cxp += p[0]; cyp += p[1]; czp += p[2]; }
    return [cxp / face.length, cyp / face.length, czp / face.length];
  };
  const sheenFill = (axis: "x" | "y" | "diag") => def({ kind: "linear", id: `sheen-${axis}`, x1: axis === "y" ? 0.5 : 0, y1: axis === "y" ? 0 : 0.5, x2: axis === "y" ? 0.5 : 1, y2: axis === "y" ? 1 : 0.5, stops: [[0, "#ffffff", 0.26], [0.42, "#ffffff", 0.03], [0.8, "#ffffff", 0.0], [1, "#ffffff", 0.12]] });
  const roofSheen = () => def({ kind: "linear", id: "sheen-roof", x1: 0.5, y1: 0, x2: 0.5, y2: 1, stops: [[0, "#ffffff", 0.3], [0.55, "#ffffff", 0.04], [1, "#ffffff", 0.14]] });
  const glassFill = () => def({ kind: "linear", id: "glass", x1: 0.5, y1: 0, x2: 0.5, y2: 1, stops: [[0, "#ffffff", 0.62], [0.34, "#dcedf6", 0.4], [0.35, "#c1dcea", 0.26], [1, "#a7c7d8", 0.34]] });
  const windowFill = () => def({ kind: "linear", id: "window", x1: 0, y1: 0, x2: 1, y2: 1, stops: [[0, "#6e8aa0", 1], [0.45, "#3d5063", 1], [0.46, "#2f4151", 1], [1, "#56738b", 1]] });

  for (const s of solids) {
    const lone = s.faces.length === 1;
    const base = parseHex(s.finish.base) ?? [160, 150, 130];
    let faceAt = -1;
    for (const face of s.faces) {
      faceAt++;
      if (face.length < 3) continue;
      let n = newell(face);
      const facing = dot(n, toViewer);
      if (!lone && facing <= 0.02) continue;
      // A lone plane is lit by the side the viewer sees — except the roof
      // shell, which is lit by its TOP whichever way the ring winds: the
      // far slopes of a shallow pyramid are genuinely visible over the
      // near hips, and winding-flipped lighting painted that area in
      // underside grey — the "teeth" at every corner of a gazebo roof.
      if (lone && (s.layer === "roofing" || s.layer === "sheathing")) {
        if (n[2] < 0) n = scale(n, -1);
        // A far slope seen past a corner is a sliver a fraction of a
        // foot wide on the page — and with its normal forced up it
        // catches the full highlight, a pale fin against the silhouette.
        // Thinner than readable, it is simply not painted.
        if (projArea(face) < 0.35) continue;
      } else if (lone && facing < 0) n = scale(n, -1);
      // A box sorts by its centre; a lone plane (a roof face, a ceiling, a slab, a pane of glass) by its nearest point,
      // so a rafter under the near end of a roof is painted before the roof, never through it.
      const dep = lone ? Math.max(...face.map(depth)) : depth(centre(face));
      const first = s.first ?? Number.POSITIVE_INFINITY;
      const top = n[2] > 0.5;
      // The picture is fitted to what is built and the house: the lawn runs on past its edge.
      const d = pathOf(face, s.layer !== "ground");
      if (s.first == null) {
        node = nodes.length;
        nodes.push({ pts: face, scr: face.map(project), depth: dep, rank: s.rank });
      } else node = -1;
      if (s.flat) {
        painted.push({ d, fill: s.flat, layer: s.layer, rank: s.rank, depth: dep, first, sub: 0 });
        continue;
      }
      if (s.pane) {
        painted.push({ d, fill: windowFill(), layer: s.layer, rank: s.rank, depth: dep, first, sub: 0, stroke: "#1f2b36", strokeOpacity: 0.5 });
        continue;
      }
      if (s.layer === "glass") {
        painted.push({ d, fill: glassFill(), layer: s.layer, rank: s.rank, depth: dep, first, sub: 0, stroke: "#ffffff", strokeOpacity: 0.75 });
        continue;
      }
      // A board's own shade: a touch lighter or darker, a touch warmer or cooler than its neighbours.
      let b: RGB = base;
      if (s.board) {
        const u = s.board.seed, v = hash01(s.board.seed * 7.1, 3);
        const lum = 0.93 + 0.13 * u;
        const warm = (v - 0.5) * 0.06;
        b = [base[0] * lum * (1 + warm), base[1] * lum, base[2] * lum * (1 - warm)];
      }
      const fill = lit(b, n, s.finish);
      const edge = s.layer === "screen" ? undefined : shadeHex(fill, s.layer === "trim" || s.layer === "house" ? 0.86 : 0.76);
      const seam = s.seams?.[faceAt] ?? null;
      if (seam && edge && (seam[0] || seam[1]) && face.length === 4) {
        // A strip of a long member: filled to its cuts in its own colour (no line across the member), then the
        // member's own edges drawn along it.
        painted.push({ d, fill, opacity: s.finish.opacity, stroke: fill, strokeOpacity: 1, layer: s.layer, rank: s.rank, depth: dep, first, sub: 0 });
        const q = face.map((p) => { const [Xp, Yp] = project(p); return `${r2(Xp)},${r2(Yp)}`; });
        const lines = `M${q[0]}L${q[1]}${seam[0] ? "M" : "L"}${q[2]}L${q[3]}${seam[1] ? "" : `L${q[0]}`}`;
        painted.push({ d: lines, fill: "none", stroke: edge, strokeOpacity: 0.9, layer: s.layer, rank: s.rank, depth: dep, first, sub: 0 });
      } else
      painted.push({ d, fill, opacity: s.finish.opacity, stroke: edge, strokeOpacity: edge ? 0.9 : undefined, layer: s.layer, rank: s.rank, depth: dep, first, sub: 0 });
      // Decorations go on faces the viewer can actually read. A face seen
      // nearly edge-on — the far slopes' slivers past a corner — wore the
      // sheen gradient's white end and stood out as pale fins against the
      // silhouette of every gazebo roof.
      const readable = projArea(face) > 1.2;
      // The grain along a board, and a sheen across a glossy one.
      if (s.board && top && full && readable) painted.push({ d, fill: grainFor(s.board.axis, fineGrain), layer: s.layer, rank: s.rank, depth: dep, first, sub: 1 });
      if (s.sheen && top && s.board && readable) painted.push({ d, fill: sheenFill(s.board.axis), layer: s.layer, rank: s.rank, depth: dep, first, sub: 2 });
      if (s.sheen && s.layer === "roofing" && readable) painted.push({ d, fill: roofSheen(), layer: s.layer, rank: s.rank, depth: dep, first, sub: 2 });
      // Lines on the face: courses of shingles or shakes, standing seams, ribs, the laps of siding.
      if (s.lines && (lone || s.layer === "house") && projArea(face) > 1.2) {
        const zs = face.map((p) => p[2]);
        const zLo = Math.min(...zs), zHi = Math.max(...zs);
        if (s.lines === "courses" || s.lines === "shakes" || s.lines === "siding") {
          if (s.lines === "siding" && !(Math.abs(n[2]) < 0.3)) continue;
          const step = s.lines === "courses" ? 0.47 : s.lines === "shakes" ? 0.85 : 0.58;
          const thick = s.lines === "siding" ? 0.05 : 0.075;
          const alpha = s.lines === "siding" ? 0.11 : s.lines === "shakes" ? 0.24 : 0.28;
          const from = s.lines === "siding" ? zLo + step : zLo + step;
          let k = 0;
          for (let z = from; z < zHi - 0.08 && k < 60; z += step, k++) {
            const band = clipBand(face, (p) => p[2], z - thick, z);
            if (band.length) painted.push({ d: pathOf(band, false), fill: "#000000", opacity: alpha, layer: s.layer, rank: s.rank, depth: dep, first, sub: 1 });
            if (s.lines === "shakes") {
              // A shake course sits a little proud: a light line over the shadow line.
              const lip = clipBand(face, (p) => p[2], z, z + 0.04);
              if (lip.length) painted.push({ d: pathOf(lip, false), fill: "#ffffff", opacity: 0.12, layer: s.layer, rank: s.rank, depth: dep, first, sub: 1 });
            }
          }
        } else {
          // Seams run from the eave to the ridge: lines of constant position along the eave.
          const e = norm([-n[1], n[0], 0]);
          const f = (p: V3) => dot(p, e);
          const fs = face.map(f);
          const fLo = Math.min(...fs), fHi = Math.max(...fs);
          const step = s.lines === "seams" ? 1.33 : 0.75;
          let k = 0;
          for (let t = fLo + step; t < fHi - 0.1 && k < 80; t += step, k++) {
            const hi = clipBand(face, f, t - 0.05, t);
            if (hi.length) painted.push({ d: pathOf(hi, false), fill: "#ffffff", opacity: s.lines === "seams" ? 0.42 : 0.3, layer: s.layer, rank: s.rank, depth: dep, first, sub: 1 });
            const lo = clipBand(face, f, t, t + 0.05);
            if (lo.length) painted.push({ d: pathOf(lo, false), fill: "#000000", opacity: s.lines === "seams" ? 0.2 : 0.12, layer: s.layer, rank: s.rank, depth: dep, first, sub: 1 });
          }
        }
      }
    }
  }
  // The shadows go right after the ground, before the house.
  node = -1;
  for (const sr of shadowRings) painted.push({ d: pathOf(sr, false), fill: "#1d2a16", layer: "shadow", rank: -1, depth: 0, first: -1, sub: 0 });
  // The ground, the shadows and the house in their fixed order; then what is built, each face after every face it
  // can cover (isoOrder) with its own grain, sheen and lines right behind it.
  const early = all.filter((p) => p.node === -1).sort((a, b) => (a.first - b.first) || (a.depth - b.depth) || (a.rank - b.rank) || (a.sub - b.sub));
  // What each face paints (its fill, its own edges, the lines on it) stays together, in the order it was drawn.
  const drawn: Painted[][] = nodes.map(() => []);
  for (const p of all) if (p.node !== undefined && p.node >= 0) drawn[p.node].push(p);
  const paintedAll = early;
  for (const f of paintOrder(nodes, { dir: toViewer, eye: persp > 0 ? add(mid, scale(toViewer, persp)) : null })) for (const p of drawn[f]) paintedAll.push(p);
  if (!Number.isFinite(x0)) { x0 = 0; y0 = 0; x1 = 1; y1 = 1; }
  const m = 1.0;
  const faces: IsoFace[] = paintedAll.map((p) => {
    const f: IsoFace = { d: p.d, fill: p.fill, layer: p.layer, rank: p.rank };
    if (p.opacity != null) f.opacity = p.opacity;
    if (p.stroke) { f.stroke = p.stroke; f.strokeOpacity = p.strokeOpacity; }
    return f;
  });
  const ranks = [...new Set(faces.map((f) => f.rank))].sort((a, b) => a - b);
  return { viewBox: `${r2(x0 - m)} ${r2(y0 - m)} ${r2(x1 - x0 + 2 * m)} ${r2(y1 - y0 + 2 * m)}`, faces, ranks, solids: solids.length, defs };
}

/* ── the markup ─────────────────────────────────────────────────────── */

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

/**
 * The drawing's SVG inside: its defs (every id under `prefix`, so several
 * pictures share a page) and the faces grouped by build step, each group
 * `layerClass` with `--i` counting up — the stylesheet stands them up one
 * after the other. The shadows sit in their own soft group.
 */
export function isoMarkup(d: IsoDrawing, o: { prefix: string; layerClass: string }): string {
  const id = (s: string) => `${o.prefix}-${s}`;
  const ref = (fill: string) => fill.replace(/url\(#([^)]+)\)/, (_, s: string) => `url(#${id(s)})`);
  const out: string[] = ["<defs>"];
  for (const def of d.defs) {
    if (def.kind === "linear" || def.kind === "radial") {
      const stops = def.stops.map(([at, c, a]) => `<stop offset="${at}" stop-color="${c}" stop-opacity="${a}"/>`).join("");
      out.push(def.kind === "linear"
        ? `<linearGradient id="${id(def.id)}" x1="${def.x1}" y1="${def.y1}" x2="${def.x2}" y2="${def.y2}">${stops}</linearGradient>`
        : `<radialGradient id="${id(def.id)}" cx="${def.cx}" cy="${def.cy}" r="${def.r}">${stops}</radialGradient>`);
    } else if (def.kind === "grain") {
      const lines = def.lines.map(([y, h, c, a]) => `<rect x="0" y="${y}" width="${def.width}" height="${h}" fill="${c}" fill-opacity="${a}"/>`).join("");
      out.push(`<pattern id="${id(def.id)}" patternUnits="userSpaceOnUse" width="${def.width}" height="${def.height}" patternTransform="rotate(${def.angle})">${lines}</pattern>`);
    } else if (def.kind === "blur") {
      out.push(`<filter id="${id(def.id)}" x="-15%" y="-15%" width="130%" height="130%"><feGaussianBlur stdDeviation="${def.sd}"/></filter>`);
    } else if (def.kind === "noise") {
      out.push(`<filter id="${id(def.id)}" x="0" y="0" width="1" height="1"><feTurbulence type="fractalNoise" baseFrequency="${def.freq}" numOctaves="2" seed="7" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0.08  0 0 0 0 0.16  0 0 0 0 0.05  ${def.gain} ${def.gain} ${def.gain} 0 ${def.lift}" result="s"/><feComposite in="s" in2="SourceGraphic" operator="in"/></filter>`);
    }
  }
  out.push("</defs>");
  // Paint order is depth order: a run of faces of one build step is one group, and every group of a step shares the
  // step's delay in the build-up (a ceiling under a roof is painted before it, whatever step it belongs to).
  const stepIndex = new Map<number, number>();
  d.ranks.forEach((r, i) => stepIndex.set(r, i));
  const face = (f: IsoFace): string => {
    // A fill of "gradient|filter" paints the gradient through the filter (the grass over the ground).
    const [fill, filter] = f.fill.split("|");
    const attrs = [`d="${f.d}"`, `fill="${esc(ref(fill))}"`];
    if (filter) attrs.push(`filter="${esc(ref(filter))}"`);
    if (f.opacity != null) attrs.push(`fill-opacity="${f.opacity}"`);
    if (f.stroke) attrs.push(`stroke="${f.stroke}"`, `stroke-opacity="${f.strokeOpacity ?? 1}"`);
    return `<path ${attrs.join(" ")}/>`;
  };
  let open: number | null = null;
  let inShadow = false;
  for (const f of d.faces) {
    if (open !== f.rank) {
      if (inShadow) { out.push("</g>"); inShadow = false; }
      if (open !== null) out.push("</g>");
      out.push(`<g class="${o.layerClass}" style="--i:${stepIndex.get(f.rank) ?? 0}" data-rank="${f.rank}">`);
      open = f.rank;
    }
    if (f.layer === "shadow" && !inShadow) { out.push(`<g filter="url(#${id("soft")})" opacity="0.34">`); inShadow = true; }
    else if (f.layer !== "shadow" && inShadow) { out.push("</g>"); inShadow = false; }
    out.push(face(f));
  }
  if (inShadow) out.push("</g>");
  if (open !== null) out.push("</g>");
  return out.join("");
}
