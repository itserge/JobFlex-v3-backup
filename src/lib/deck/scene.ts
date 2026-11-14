// THE DECK IN 3D, AS DATA (2026-10-04; roofs 2026-10-10; version 3 M3 2026-10-10) — pure, no three.js.
//
// Owner: "it starts building in actual kind of a 3D … show it as it is made
// in real, show the bolts, the hangers and the rest, zoom in any part." The
// whole structure (structure.ts) becomes a list of boxes and polygons in
// feet, each filed under the layer it belongs to, in the order a crew builds
// them — and, since version 3, each box carries a TAG into a legend that
// says what the piece is, its size, its length, how it is cut and what
// fastens it, so the 3D can name any part a finger lands on and fly to it.
// CALLOUTS mark the connections worth looking at: the ledger on the house,
// a hanger, a post on its footing, the beam on its post, the roof's ledger,
// a hurricane tie, the stair's connectors, a rail post's bolts.
//
// The same list rides with the proposal (lib/deck/convertSchema), so the
// client's page shows the deck that was priced — frozen, like the fence's
// scene: a later change to the engine never redraws a deck a client has
// already seen. Nothing is uploaded for it.
//
// VERSION 3: eight more layers (stairs, rails, glass, screen, walls,
// hardware, lights, wires), the ground's fall, the legend and tags, the
// callouts, the glowing fixtures for the night view, boards cut to a shaped
// front. Versions 1 and 2 still read: their layers are the first ten and
// twenty of these, in order.

import type { DeckFrame } from "./frame";
import type { DeckSurface } from "./surface";
import { FLASH_LEG_IN, type RoofMember, type RoofPlane } from "./roof";
import { POST_ACTUAL_IN, ftIn } from "./codeTables";
import { deckGrips } from "./byHand";
import { ROOFING_LABEL, hasDeck, shapeOutline, sizeWords, structureWords, type DeckDesign, spaRectIn } from "./design";
import { outsideRunOn, ringEdges } from "./ringEdges";
import type { DeckStructure } from "./structure";
import { BETWEEN_LEVELS_STAIR_ID, structureLevels } from "./structure";
import type { StairMember } from "./stairs";
import type { RailMember } from "./rails";
import { BASE_PLATE_IN, BASE_PLATE_THICK_IN, railMountCallout, railPostWords, railWords } from "./rails";
import { electricalWords } from "./electrical";
import { SKIRT_BOARD_IN, SKIRT_BORDER_IN, SKIRT_CLEAR_IN, SKIRT_GAP_IN, SKIRT_THICK_IN } from "./skirt";
import { HOUSE_MATERIALS, HOUSE_ROOFS, houseHandles, houseScene, settleSceneOpenings, type HouseMaterial, type HouseRoof } from "./house";
import { railColorOf, speciesWords } from "./catalog";

export const DECK_SCENE_VERSION = 3;

/** The layers. A box's first number is its index here; the first ten are version 1's, the first twenty version 2's, in their order. */
export const SCENE_LAYERS = [
  "footing",
  "post",
  "beam",
  "ledger",
  "joist",
  "rim",
  "blocking",
  "brace",
  "decking",
  "fascia",
  "slab",
  "roof-post",
  "header",
  "ridge",
  "rafter",
  "sheathing",
  "roofing",
  "trim",
  "gutter",
  "ceiling",
  "stair",
  "rail",
  "glass",
  "screen",
  "wall",
  "hardware",
  "light",
  "wire",
  "spa",
] as const;
export type SceneLayer = (typeof SCENE_LAYERS)[number];
export const SCENE_LAYER_LABEL: Record<SceneLayer, string> = {
  footing: "Footings",
  post: "Posts",
  beam: "Beams",
  ledger: "Ledger",
  joist: "Joists",
  rim: "Rim",
  blocking: "Blocking",
  brace: "Braces",
  decking: "Decking",
  fascia: "Fascia",
  slab: "Slab",
  "roof-post": "Roof posts",
  header: "Headers",
  ridge: "Ridge and hips",
  rafter: "Rafters",
  sheathing: "Sheathing",
  roofing: "Roofing",
  trim: "Fascia and soffit",
  gutter: "Gutters",
  ceiling: "Ceiling",
  stair: "Stairs",
  rail: "Railing",
  glass: "Glass panels",
  screen: "Screens",
  wall: "Walls",
  hardware: "Bolts and hangers",
  light: "Lights and fixtures",
  wire: "Wiring",
  spa: "Hot tub",
};
/** The order the build-up slider stands the layers up in (a slab goes down first; the hardware goes on with the frame). */
export const SCENE_BUILD_ORDER: readonly SceneLayer[] = ["slab", "footing", "post", "beam", "ledger", "joist", "rim", "blocking", "brace", "hardware", "decking", "fascia", "stair", "rail", "glass", "spa", "roof-post", "header", "ridge", "rafter", "sheathing", "roofing", "trim", "gutter", "ceiling", "wall", "screen", "wire", "light"];
/** A layer's step in the build-up. */
export const buildRank = (layer: SceneLayer) => SCENE_BUILD_ORDER.indexOf(layer);
/** The layers a scene actually has, in build order — the slider runs over these. */
export function sceneBuildLayers(scene: DeckScene): SceneLayer[] {
  const present = new Set<number>();
  for (const b of scene.boxes) present.add(b[0]);
  for (const p of scene.polys) present.add(p[0]);
  if (scene.footings.length) present.add(SCENE_LAYERS.indexOf("footing"));
  if (scene.diagonal?.boards.length) present.add(SCENE_LAYERS.indexOf("decking"));
  return SCENE_BUILD_ORDER.filter((l) => present.has(SCENE_LAYERS.indexOf(l)));
}

/** The most a stored scene may carry. */
export const SCENE_MAX_BOXES = 12000;
export const SCENE_MAX_FOOTINGS = 400;
export const SCENE_MAX_DIAGONALS = 1500;
export const SCENE_MAX_POLYS = 600;
export const SCENE_MAX_LEGEND = 400;
export const SCENE_MAX_CALLOUTS = 40;
export const SCENE_MAX_GLOWS = 120;

/** A handle: dragging it along `axis` (scene feet) changes `kind` from `value` by the distance dragged. */
export interface SceneHandle {
  kind: "width" | "depth" | "height" | "eave" | "stair" | "stair-width" | "lower-depth" | "roof-width" | "roof-depth" | "pitch" | "jog" | "house-left" | "house-right" | "post" | "beam" | "roof-post";
  id: string;
  x: number;
  y: number;
  z: number;
  axis: "x" | "y" | "z";
  /** The design's number the handle moves: feet for sizes, inches for heights. */
  value: number;
  /** Feet of drag per unit of value (12 for an inches value). */
  perUnit: number;
  /** The handle's own travel per unit of value where a change grows both ways about a centre (0.5 for a stair's
   *  width); the drag is divided by it so the knob stays under the pointer. 1 when absent. */
  follow?: number;
  label: string;
  /**
   * BY HAND (2026-11-13; lib/deck/byHand): a post or a beam is taken hold of by the part itself — this is its box
   * (x0, y0, z0, x1, y1, z1, feet), and it has no knob. Its value is inches along its line.
   */
  grab?: [number, number, number, number, number, number];
  /** How a builder reads that value: `sign × (value − origin)` inches `from` ("from the deck's left end"). */
  shown?: { origin: number; sign: 1 | -1; from: string };
}

/** One kind of part: what it is, how it is cut, what fastens it. The 3D shows this when a part is touched. */
export interface SceneLegend {
  /** "rafter", "joist hanger", "connection"… */
  role: string;
  /** "2x8", "LUS28", "½-in. lag"… */
  nominal: string;
  /** The length of this part, ft (0 for hardware). */
  lengthFt: number;
  /** How many of them. */
  count: number;
  /** One or two sentences: the cut angles, the fasteners, the rule. */
  note: string;
}

export interface DeckScene {
  v: typeof DECK_SCENE_VERSION;
  /** The outline's bounding size and the walking surface's height, ft; the roof's peak when there is one. */
  widthFt: number;
  depthFt: number;
  heightFt: number;
  peakFt: number;
  /**
   * Boxes: [layer, cx, cy, cz, sx, sy, sz, lean] or, with a direction,
   * [layer, cx, cy, cz, sx, sy, sz, lean, yaw, tilt]. Feet; x along the
   * house, y out from it, z up. `lean`: 0 for a square box; 1–4 for a knee
   * brace drawn as the diagonal of its box (1 = rising toward +x, 2 = toward
   * −x, 3 = toward +y, 4 = toward −y). With a yaw and a tilt (radians) the
   * box is `sx` long along an axis that points `yaw` from +x in plan and
   * rises `tilt`; `sy` is its width across, `sz` its depth.
   */
  boxes: number[][];
  /** Per box, its legend entry (−1 for none). Same length as `boxes`, or empty. */
  tags: number[];
  legend: SceneLegend[];
  /** Connections worth a look: [x, y, z, legend index], ft. */
  callouts: number[][];
  /** Footings: [x, y, pad diameter, pad thickness, pier diameter, depth below the house-line ground, top above it], ft. */
  footings: number[][];
  /** Boards laid on the diagonal or cut to a shaped front: each a flat ring [x0, y0, x1, y1, …] at the walking surface (version 3: `z` per ring in `diagonal.zs`). */
  diagonal: { thickFt: number; boards: number[][]; zs?: number[]; /** The rings that are a border in a second colour (2026-11-10). */ border?: number[] } | null;
  /** Flat polygons in space: [layer, x, y, z, x, y, z, …], ft — the roof's faces, the ceiling, the soffit, a slab, glass, screens, walls. */
  polys: number[][];
  /** Per poly, its legend entry (−1 for none). Same length as `polys`, or empty. */
  polyTags: number[];
  /** The outline as a flat ring, ft (the deck's, or the roof's posts when there is no deck). */
  outline: number[];
  /** The house, where the deck touches one: blocks [x0, y0, x1, y1], its height, and a door on the main wall [centre x, width, height]. */
  house: { blocks: number[][]; heightFt: number; door: number[] | null; storeys?: 1 | 2; roof?: HouseRoof; windows?: number[][]; siding?: string; roofColour?: string; doors?: number[][]; material?: HouseMaterial; roofs?: number[][] } | null;
  /** The ground's fall across the deck, ft: out from the house over its depth, left to right over its width (null = flat). */
  ground: { outDropFt: number; acrossDropFt: number } | null;
  /** Fixtures that glow in the night view: [x, y, z, colour as 0xRRGGBB, sample (1 = the client's own fixture)], ft. */
  glows: number[][];
  /** Handles the 3D's edit mode drags (M3): what each one changes, where it sits (ft), along which axis, and the value it starts from. */
  handles: SceneHandle[];
  /** `decking2`: the second tone of a streaked board (2026-11-09) — the 3D lays the boards in both. `railInfill`: the
   *  rail's infill where it is not the frame's colour — stainless cable, black metal balusters, a wire mesh. `border`
   *  (and `border2`): a picture-frame border in a second colour. `railCap`: a deck board on a kit rail, in the deck's colour. */
  colors: { frame: string; decking: string; fascia: string; roofing: string; rail: string; decking2?: string; railInfill?: string; border?: string; border2?: string; railCap?: string; roofFrame?: string };
  /** What the client reads under the picture. */
  facts: string;
}

const r3 = (inches: number) => Math.round((inches / 12) * 1000) / 1000;

/** A saved handle's box and reading (SceneHandle.grab, .shown), where they are whole. */
function handleGrab(o: Record<string, unknown>): Pick<SceneHandle, "grab" | "shown"> {
  const g = o.grab;
  if (!Array.isArray(g) || g.length !== 6 || !g.every((v) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 500)) return {};
  const sh = (o.shown && typeof o.shown === "object" ? o.shown : null) as Record<string, unknown> | null;
  const shown = sh && typeof sh.origin === "number" && Number.isFinite(sh.origin) && (sh.sign === 1 || sh.sign === -1) && typeof sh.from === "string" ? { origin: sh.origin, sign: sh.sign as 1 | -1, from: sh.from.slice(0, 60) } : undefined;
  return { grab: g as [number, number, number, number, number, number], ...(shown ? { shown } : {}) };
}
const r4 = (rad: number) => Math.round(rad * 10000) / 10000;
const LEAN: Record<string, number> = { "x:1": 1, "x:-1": 2, "y:1": 3, "y:-1": 4 };
const deg = (rad: number) => `${Math.round(Math.abs(rad) * (180 / Math.PI) * 10) / 10}°`;

/** Treated lumber's green-brown, or the heartwood's own colour — OC Lumber's standard black (2026-11-12). */
function frameColor(speciesId: string, group: string): string {
  if (speciesId === "oc-lumber") return "#2b2b2a";
  if (speciesId === "redwood") return "#a4573e";
  if (speciesId === "western-cedar") return "#b5764a";
  return group === "SP" ? "#a59863" : "#9d8c62";
}

/** The roofing's colour in the 3D. */
export function roofingColor(roofing: DeckDesign["roof"]["roofing"]): string {
  switch (roofing) {
    case "3tab-shingle":
      return "#5b5651";
    case "designer-shingle":
      return "#4a4642";
    case "cedar-shake":
      return "#9a7a52";
    case "metal-panel":
      return "#6f7478";
    case "standing-seam":
      return "#3f4a55";
    case "none":
      return "#9d8c62";
    default:
      return "#565250";
  }
}

/** The rail's colour by system. */
export function railColor(type: DeckDesign["rail"]["type"], deckColor: string, frame: string, colorId: string | null = null): string {
  // A kit system in the colour picked, or its usual one (lib/deck/catalog RAIL_COLORS). A composite rail is white,
  // black or brown — never the deck board's colour: no maker sells one (2026-11-09).
  const stock = railColorOf(type, colorId);
  if (stock) return stock.hex;
  void deckColor;
  return type === "cedar" ? "#b5764a" : frame;
}

/** A convex ring clipped to a rectangle (Sutherland–Hodgman). */
function clipToRect(ring: Array<[number, number]>, x0: number, y0: number, x1: number, y1: number): Array<[number, number]> {
  const edges: Array<{ inside: (p: [number, number]) => boolean; cross: (a: [number, number], b: [number, number]) => [number, number] }> = [
    { inside: (p) => p[0] >= x0, cross: (a, b) => [x0, a[1] + ((b[1] - a[1]) * (x0 - a[0])) / (b[0] - a[0])] },
    { inside: (p) => p[0] <= x1, cross: (a, b) => [x1, a[1] + ((b[1] - a[1]) * (x1 - a[0])) / (b[0] - a[0])] },
    { inside: (p) => p[1] >= y0, cross: (a, b) => [a[0] + ((b[0] - a[0]) * (y0 - a[1])) / (b[1] - a[1]), y0] },
    { inside: (p) => p[1] <= y1, cross: (a, b) => [a[0] + ((b[0] - a[0]) * (y1 - a[1])) / (b[1] - a[1]), y1] },
  ];
  let out = ring;
  for (const e of edges) {
    const src = out;
    out = [];
    for (let i = 0; i < src.length; i++) {
      const a = src[i];
      const b = src[(i + 1) % src.length];
      const ain = e.inside(a);
      const bin = e.inside(b);
      if (ain && bin) out.push(b);
      else if (ain && !bin) out.push(e.cross(a, b));
      else if (!ain && bin) out.push(e.cross(a, b), b);
    }
    if (out.length === 0) break;
  }
  return out;
}

const ringArea = (ring: Array<[number, number]>) => Math.abs(ring.reduce((a, p, i) => a + p[0] * ring[(i + 1) % ring.length][1] - ring[(i + 1) % ring.length][0] * p[1], 0)) / 2;

/** Boards at 45° across the deck (a herringbone: each half its own way), each clipped to the rectangles of the outline. Inches in, feet out. */
function diagonalBoards(frame: DeckFrame, surface: DeckSurface, offX: number, offY: number): number[][] {
  const zones = frame.zones.map((z) => z.zone);
  const width = Math.max(...zones.map((z) => z.x1));
  const depth = Math.max(...zones.map((z) => z.y1));
  const w = surface.product.widthIn;
  const pitch = w + surface.product.gapIn;
  const out: number[][] = [];
  const step = pitch * Math.SQRT2;
  const band = w * Math.SQRT2;
  const far = width + depth;
  // Cut to the field inside the border (2026-11-13: the surface's own rectangles — the border's bands left out on every
  // open edge of any outline; it was a rectangle's three sides, whatever stood there, and ran under a back border).
  const halves: Array<{ x0: number; x1: number; dir: 1 | -1 }> = surface.pattern === "herringbone" ? [{ x0: 0, x1: width / 2, dir: 1 }, { x0: width / 2, x1: width, dir: -1 }] : [{ x0: 0, x1: width, dir: 1 }];
  for (const h of halves) {
    for (let c = -depth - width; c < width + depth && out.length < SCENE_MAX_DIAGONALS; c += step) {
      // A board is the strip between two lines x − dir·y = c.
      const strip: Array<[number, number]> = h.dir === 1 ? [[c - far, -far], [c + band - far, -far], [c + band + far, far], [c + far, far]] : [[c + far, -far], [c + band + far, -far], [c + band - far, far], [c - far, far]];
      for (const z of surface.field) {
        if (Math.min(z.x1, h.x1) - Math.max(z.x0, h.x0) < 0.01) continue;
        const ring = clipToRect(strip, Math.max(z.x0, h.x0), z.y0, Math.min(z.x1, h.x1), z.y1);
        if (ring.length >= 3 && ringArea(ring) > 2) out.push(ring.flatMap((p) => [r3(p[0] + offX), r3(p[1] + offY)]));
      }
    }
  }
  return out;
}

/** Which layer a roof member is drawn in. */
export const ROOF_MEMBER_LAYER: Record<RoofMember["role"], SceneLayer> = {
  "roof-post": "roof-post",
  header: "header",
  "roof-ledger": "header",
  "roof-brace": "header",
  rafter: "rafter",
  jack: "rafter",
  fly: "rafter",
  tie: "rafter",
  truss: "rafter",
  purlin: "rafter",
  slat: "rafter",
  hip: "ridge",
  ridge: "ridge",
  king: "ridge",
  ring: "ridge",
  "tier-post": "ridge",
  subfascia: "trim",
  "fascia-eave": "trim",
  "fascia-rake": "trim",
  cupola: "trim",
  gutter: "gutter",
  downspout: "gutter",
  kneewall: "wall",
  stud: "wall",
  door: "wall",
  fixture: "light",
};
const ROOF_PLANE_LAYER: Record<RoofPlane["kind"], SceneLayer> = { sheathing: "sheathing", roofing: "roofing", ceiling: "ceiling", soffit: "trim", slab: "slab", wall: "wall", screen: "screen", louver: "roofing", fixture: "light" };
const STAIR_LAYER: Record<StairMember["role"], SceneLayer> = { stringer: "stair", tread: "stair", riser: "stair", kicker: "stair", "stair-post": "stair", "stair-beam": "stair", "landing-frame": "stair", "landing-tread": "stair", "box-frame": "stair", "box-tread": "stair", "stair-rail": "rail", "stair-rail-post": "rail", "stair-baluster": "rail", pad: "slab" };
const RAIL_LAYER: Record<RailMember["role"], SceneLayer> = { "rail-post": "rail", "rail-top": "rail", "rail-bottom": "rail", "rail-cap": "rail", baluster: "rail", cable: "rail", "rail-panel": "glass", mesh: "rail" };
/** The rail parts a scene's `railInfill` colour is for: the infill, not the frame. */
export const RAIL_INFILL_ROLE = /^(?:lower level )?(?:baluster|stair baluster|cable|mesh)$/;
/** A rail's cap (a kit rail's deck-board drink rail is drawn in the scene's `railCap` colour), and a border board. */
export const RAIL_CAP_ROLE = /^(?:lower level )?rail cap$/;
export const BORDER_BOARD_ROLE = /^(?:lower level )?border board$/;
/**
 * A picture-frame border in the deck's OWN colour (2026-11-13 — a deck builder: "turning the border on changes nothing
 * in the 3D"): the same boards, laid along the edges, were drawn in the same colour with seams under a pixel wide —
 * nothing to see. It is drawn a shade deeper, the way a drafter tones a border, and the legend says so.
 */
export const BORDER_SAME_COLOUR_SHADE = 0.82;
/** A hex colour's channels scaled (k < 1 darker): the border's shade. Plain sRGB — it is a drafting tone, not a paint match. */
const shadeHex = (hex: string, k: number): string => {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  return `#${[1, 2, 3].map((i) => Math.max(0, Math.min(255, Math.round(parseInt(m[i], 16) * k))).toString(16).padStart(2, "0")).join("")}`;
};

/** The scene the whole structure stands up. */
export function deckScene(s: DeckStructure): DeckScene {
  const { design, frame, roof } = s;
  const layer = (name: SceneLayer) => SCENE_LAYERS.indexOf(name);
  const boxes: number[][] = [];
  const tags: number[] = [];
  const polys: number[][] = [];
  const polyTags: number[] = [];
  const legend: SceneLegend[] = [];
  const legendIndex = new Map<string, number>();
  const callouts: number[][] = [];
  const glows: number[][] = [];
  const footings: number[][] = [];

  /** The legend entry for a kind of part (one per role + stock + length to the half foot). */
  const tagFor = (role: string, nominal: string, lengthIn: number, note: string): number => {
    const lengthFt = Math.round((lengthIn / 12) * 2) / 2;
    const key = `${role}|${nominal}|${lengthFt}|${note.slice(0, 40)}`;
    const found = legendIndex.get(key);
    if (found !== undefined) {
      legend[found].count += 1;
      return found;
    }
    if (legend.length >= SCENE_MAX_LEGEND) return -1;
    legend.push({ role, nominal, lengthFt, count: 1, note: note.slice(0, 240) });
    legendIndex.set(key, legend.length - 1);
    return legend.length - 1;
  };
  const callout = (x: number, y: number, z: number, role: string, nominal: string, note: string) => {
    if (callouts.length >= SCENE_MAX_CALLOUTS) return;
    legend.push({ role, nominal, lengthFt: 0, count: 1, note: note.slice(0, 240) });
    callouts.push([r3(x), r3(y), r3(z), legend.length - 1]);
  };
  const box = (name: SceneLayer, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, tag: number, lean = 0, yaw = 0, tilt = 0, mA = 0, mB = 0) => {
    if (boxes.length >= SCENE_MAX_BOXES) return;
    // A part with no size (a ridge of no length on a square hip, a strip along a degenerate header) would make the
    // whole scene unreadable — parseDeckScene wants every size above zero — so such a part is simply not drawn.
    const [ax, ay, az] = [r3(sx), r3(sy), r3(sz)];
    if (!(ax > 0 && ay > 0 && az > 0) || ![cx, cy, cz].every(Number.isFinite)) return;
    const yw = r4(yaw);
    const tl = r4(tilt);
    const ma = r4(mA);
    const mb = r4(mB);
    // A 12-number row carries the plan mitres of a trim run's two ends —
    // how a fascia board is actually sawn where two eaves meet at a
    // corner, instead of two square ends shoved past each other.
    if (ma !== 0 || mb !== 0) boxes.push([layer(name), r3(cx), r3(cy), r3(cz), ax, ay, az, lean, yw, tl, ma, mb]);
    else if (yw === 0 && tl === 0) boxes.push([layer(name), r3(cx), r3(cy), r3(cz), ax, ay, az, lean]);
    else boxes.push([layer(name), r3(cx), r3(cy), r3(cz), ax, ay, az, lean, yw, tl]);
    tags.push(tag);
  };
  const poly = (name: SceneLayer, ring: number[], tag = -1) => {
    if (polys.length >= SCENE_MAX_POLYS) return;
    polys.push([layer(name), ...ring.map((v) => r3(v))]);
    polyTags.push(tag);
  };

  const levels = structureLevels(s);
  let width = 0;
  let depth = 0;
  let heightIn = 0;
  const shapedBoards: number[][] = [];
  const shapedZs: number[] = [];
  const borderRings: number[] = [];

  /* ── The deck, level by level ──────────────────────────────────────── */
  for (const level of levels) {
    const f = level.frame;
    const surface = level.surface;
    const ox = level.offsetXIn;
    const oy = level.offsetYIn;
    const zones = f.zones.map((z) => z.zone);
    width = Math.max(width, Math.max(...zones.map((z) => z.x1)) + ox);
    depth = Math.max(depth, Math.max(...zones.map((z) => z.y1)) + oy);
    if (level.id === "upper") heightIn = f.surfaceIn;
    const lvl = level.id === "lower" ? "lower level " : "";
    const noteFor = (st: typeof f.sticks[number]): string => {
      switch (st.role) {
        case "joist":
          return `${lvl}${st.nominal} joist, ${f.spacingIn} in. on centre, ${speciesWords(f.species)}. Square-cut both ends; ${f.beamStyle === "flush" ? "hung in a hanger at each beam" : f.design.placement === "attached" ? "a hanger at the ledger, a hurricane tie at each beam" : "a hurricane tie at each beam"}.`;
        case "rim":
          return st.curved ? `${lvl}Curved rim: three plies of ½-in. treated plywood bent to the arc, glued and screwed to every joist end.` : `${lvl}${st.nominal} rim across the joist ends${st.yaw ? ", mitred at the clipped corner (22.5° each face)" : ""}: three structural screws into each joist.`;
        case "ledger":
          return `${lvl}${st.nominal} ledger on the house: ${f.ledgers[0] ? `${f.ledgers[0].fasteners} ${f.design.ledger.fastener === "lag" ? "½-in. lags" : f.design.ledger.fastener === "bolt" || f.design.ledger.fastener === "bolt-gap" ? "½-in. through-bolts" : "structural screws"} every ${f.ledgers[0].spacingIn} in. in two staggered rows` : "fastened by the table"}, flashed over, membrane behind.`;
        case "beam":
          return `${lvl}${st.nominal}${f.beams.find((b) => b.id === st.of)?.spec.plies && (f.beams.find((b) => b.id === st.of)?.spec.plies ?? 1) > 1 ? ` ply of a ${f.beams.find((b) => b.id === st.of)?.spec.size} beam` : " beam"}, ${f.beamStyle === "flush" ? "flush with the joists, which hang on it" : "under the joists on post caps"}; plies nailed 16d at 16 in., staggered.`;
        case "post":
          return `${lvl}${st.nominal} post on a stand-off base, ${f.beamStyle === "dropped" ? "notched or capped for the beam (two ½-in. bolts)" : "capped for the beam"}; cut square to length.`;
        case "blocking":
          return `${lvl}${st.nominal} blocking between the joists, square-cut to the bay, toe-nailed.`;
        case "brace":
          return `${lvl}${st.nominal} knee brace cut at 45° both ends, a ½-in. lag at each end.`;
        default:
          return st.role;
      }
    };
    for (const st of f.sticks) box(st.role, st.cx + ox, st.cy + oy, st.cz, st.sx, st.sy, st.sz, tagFor(`${lvl}${st.role}`, st.nominal, st.lengthIn, noteFor(st)), st.lean ? LEAN[`${st.lean.axis}:${st.lean.dir}`] ?? 0 : 0, st.yaw ?? 0, 0);

    // Hardware: lag heads along the ledger, hangers at the joists, ties over the beams, bases and caps at the posts, hold-downs, flashing.
    const hwTag = (role: string, nominal: string, note: string) => tagFor(role, nominal, 0, note);
    for (const l of f.ledgers) {
      const n = Math.max(2, l.fasteners);
      const perRow = Math.ceil(n / 2);
      const lagTag = hwTag("ledger fastener", f.design.ledger.fastener === "lag" ? "½-in. lag with washer" : f.design.ledger.fastener === "bolt" || f.design.ledger.fastener === "bolt-gap" ? "½-in. through-bolt" : "structural screw", `Every ${l.spacingIn} in., two staggered rows, 2 in. from the ledger's top, ¾ in. from its bottom, 2 in. from its ends (IRC R507.9.1.3).`);
      for (let k = 0; k < perRow; k++) {
        const t = (k + 0.5) / perRow;
        const x = l.x0 + (l.x1 - l.x0) * t;
        const zTop = f.joistTopIn - 2.25;
        const zBot = f.joistBottomIn + 2;
        box("hardware", x + ox, l.y + oy + 1.9, k % 2 === 0 ? zTop : zBot, 1.2, 0.8, 1.2, lagTag);
        box("hardware", x + ox + 0.5 * l.spacingIn * 0.5, l.y + oy + 1.9, k % 2 === 0 ? zBot : zTop, 1.2, 0.8, 1.2, lagTag);
      }
      // Flashing over the ledger's top, up behind the siding — set 0.1 in. into the ledger so its underside is not in the
      // plane of the boards' undersides beside it (the two flickered from below, 2026-10-11).
      box("hardware", (l.x0 + l.x1) / 2 + ox, l.y + oy + 0.75, f.joistTopIn + 0.05, l.lengthIn + 8, 2.2, 0.3, hwTag("ledger flashing", "metal cap flashing", "Cap flashing over the ledger, 4 in. past each end, tucked behind the siding; self-adhered membrane behind the ledger and over its top. No aluminum against copper-treated lumber."));
      // Hold-downs at each end.
      const hdTag = hwTag("hold-down", f.hardware.lateralTies === 4 ? "750-lb tension tie" : "1,500-lb hold-down with ½-in. rod", f.hardware.lateralTies === 4 ? "Four 750-lb tension ties, screwed to the joists and the house framing (IRC R507.9.2)." : "Two 1,500-lb hold-downs within 2 ft of each end of the ledger, a ½-in. rod through to the house's floor joists (IRC R507.9.2).");
      for (const x of [l.x0 + 18, l.x1 - 18]) box("hardware", x + ox, l.y + oy + 6, f.joistBottomIn + f.joistTopIn > 0 ? (f.joistBottomIn + f.joistTopIn) / 2 : 0, 2.5, 9, 3, hdTag);
      callout(((l.x0 + l.x1) / 2 + ox) / 1, l.y + oy, (f.joistTopIn + f.joistBottomIn) / 2, "connection", "Ledger to the house", `${l.fasteners} ${f.design.ledger.fastener === "lag" ? "½-in. lags" : f.design.ledger.fastener.startsWith("bolt") ? "½-in. through-bolts" : "structural screws"} every ${l.spacingIn} in. in two staggered rows, cap flashing over, membrane behind, ${f.hardware.lateralTies} hold-downs to the house. The joists hang on it in hangers.`);
    }
    const joistDepth = f.joistTopIn - f.joistBottomIn;
    const hangerTag = hwTag("joist hanger", `LUS-type ${f.joistSize}`, `Galvanized face-mount hanger, ${joistDepth > 9 ? "ten" : "eight"} 10d nails into the ledger or beam, 10d×1½ into the joist. Hangers at least 60% of the joist's depth (AWC DCA 6).`);
    const tieTag = hwTag("hurricane tie", "H2.5A", "Galvanized tie, joist to beam, five 8d nails each leg — keeps the joists from lifting or rolling (IRC R507.6.2).");
    // A hanger as the real thing (owner, 2026-11-06: "hangers, bolts … better quality"): a seat under the joist, a flange
    // up each side of it, and the plate nailed to the ledger or beam behind — four thin boxes, not one block. `back` is
    // which way the ledger or beam lies from the hanger's centre.
    // Every face a hair off the joist's own faces (0.03 in.), never in their plane — two faces in one plane flicker.
    // An outside joist's outer flange would sit where the fascia is; the fascia hides it, so it is not drawn.
    const hanger = (x: number, y: number, back: 1 | -1, flanges: { left: boolean; right: boolean }) => {
      const h = joistDepth * 0.75;
      box("hardware", x, y, f.joistBottomIn - 0.09, 1.9, 1.8, 0.12, hangerTag);
      if (flanges.left) box("hardware", x - 0.85, y, f.joistBottomIn + h / 2, 0.14, 1.8, h, hangerTag);
      if (flanges.right) box("hardware", x + 0.85, y, f.joistBottomIn + h / 2, 0.14, 1.8, h, hangerTag);
      box("hardware", x, y - back * 0.85, f.joistBottomIn + h / 2, 3.6, 0.12, h, hangerTag);
    };
    for (const j of f.joists) {
      if (j.sister) continue;
      const zf = f.zones.find((z) => z.zone.id === j.zoneId);
      if (!zf) continue;
      const flanges = { left: j.x - 0.76 > zf.zone.x0 + 0.05, right: j.x + 0.76 < zf.zone.x1 - 0.05 };
      if (zf.back === "ledger") hanger(j.x + ox, zf.zone.y0 + oy + 1.5 + 0.9, 1, flanges);
      for (const by of zf.beamYs) {
        const b = f.beams.find((bb) => Math.abs(bb.lineY - by) < 0.6 && bb.zoneIds.includes(j.zoneId));
        if (!b) continue;
        if (b.style === "flush") {
          hanger(j.x + ox, b.y + oy - b.spec.thickIn / 2 - 0.9, -1, flanges);
          if (b.role === "middle") hanger(j.x + ox, b.y + oy + b.spec.thickIn / 2 + 0.9, 1, flanges);
        } else box("hardware", j.x + ox + 1.2, b.y + oy, f.joistBottomIn - 0.1, 1.2, 2.5, 3, tieTag);
      }
    }
    if (f.joists.length && f.beams.length) {
      const j0 = f.joists[Math.floor(f.joists.length / 2)];
      const zf = f.zones.find((z) => z.zone.id === j0.zoneId);
      if (zf && zf.back === "ledger") callout(j0.x + ox, zf.zone.y0 + oy + 3, f.joistBottomIn + joistDepth / 2, "connection", "Joist hanger at the ledger", `Each ${f.joistSize} joist sits in a galvanized face-mount hanger nailed to the ledger: ${joistDepth > 9 ? "ten" : "eight"} 10d nails into the ledger, 10d×1½ into the joist.`);
      const b = f.beams[f.beams.length - 1];
      callout(j0.x + ox, b.y + oy, f.joistBottomIn, "connection", b.style === "flush" ? "Joists hung on the flush beam" : "Joists over the beam", b.style === "flush" ? `The joists hang on the ${b.spec.size} beam in hangers; the beam is the deck's rim.` : `The joists bear on the ${b.spec.size} beam and run ${Math.round((zf?.frontCantIn ?? 0) / 12 * 10) / 10} ft past it; an H2.5A tie at every joist, blocking over the beam.`);
    }
    const baseTag = hwTag("post base", `ABU-type ${f.design.framing.post}`, "Galvanized stand-off base on a ½-in. anchor bolt set in the footing; it holds the post 1 in. off the concrete so its end stays dry.");
    const capTag = hwTag("post cap", `BC/PC-type ${f.design.framing.post}`, "Galvanized cap, post to beam, nailed both ways; a three-ply beam needs the wide cap (AWC DCA 6).");
    const boltTag = hwTag("anchor bolt", "½-in.", "½-in. anchor bolt set in the wet concrete, nut and washer over the base plate.");
    for (const p of f.posts) {
      const bottom = p.footing.groundIn + p.footing.topIn;
      // The base as the real thing: the plate on the concrete, a strap up two faces of the post, the anchor's nut beside
      // it — each a hair off the faces around it, never in their plane (two faces in one plane flicker).
      box("hardware", p.x + ox, p.y + oy, bottom + 0.22, 7, 7, 0.4, baseTag);
      // The straps stop short of the beam: a ground-hugging deck's post is only inches tall.
      const strapH = Math.min(6, p.heightIn - 1);
      if (strapH >= 1.5) {
        box("hardware", p.x + ox - 2.95, p.y + oy, bottom + 0.2 + strapH / 2, 0.14, 6.2, strapH, baseTag);
        box("hardware", p.x + ox + 2.95, p.y + oy, bottom + 0.2 + strapH / 2, 0.14, 6.2, strapH, baseTag);
      }
      box("hardware", p.x + ox, p.y + oy - 3.1, bottom + 0.99, 0.9, 0.9, 1.1, boltTag);
      if (!p.roof && p.heightIn >= 1) box("hardware", p.x + ox, p.y + oy, bottom + p.heightIn - 0.5, 6.5, 6.5, 2.2, capTag);
    }
    if (f.posts.length) {
      const p = f.posts.find((pp) => !pp.roof) ?? f.posts[0];
      callout(p.x + ox, p.y + oy, p.footing.groundIn + p.footing.topIn + 2, "connection", "Post on its footing", `${p.size} post on a galvanized stand-off base, ½-in. anchor bolt into a ${p.footing.padIn}-in. footing ${p.footing.depthIn} in. deep (${Math.round(p.tributarySqFt)} sq ft of deck on it).`);
      if (p.heightIn >= 1 && f.beamStyle === "dropped") callout(p.x + ox, p.y + oy, p.footing.groundIn + p.footing.topIn + p.heightIn, "connection", "Beam on the post", `The ${f.beams.find((b) => b.id === p.beamId)?.spec.size ?? "beam"} sits in a galvanized post cap on the ${p.size} post (or in a notch with two ½-in. through-bolts); never bolted to the side of an un-notched post.`);
    }
    if (f.hardware.rimScrews) {
      const rimStick = f.sticks.find((st) => st.role === "rim");
      if (rimStick) callout(rimStick.cx + ox, rimStick.cy + oy, rimStick.cz, "connection", "Rim to the joists", `Three structural screws (#10 × 3 in.) through the rim into every joist end${f.design.framing.doubleRim ? "; the rim doubled on the open sides" : ""}.`);
    }

    // The boards on top.
    const boardZ = f.surfaceIn - surface.product.thickIn / 2;
    const boardTag = tagFor(`${lvl}deck board`, surface.product.nominal, 0, `${surface.product.label}, ${surface.product.gapIn}-in. gaps, ${surface.fastening === "hidden" ? "hidden clips in the grooves" : "two coated screws at every joist"}${surface.pattern !== "straight" ? `, laid ${surface.pattern === "diagonal" ? "on the diagonal" : "in a herringbone"}` : ""}.`);
    const borderTag = tagFor(`${lvl}border board`, surface.product.nominal, 0, `Picture-frame border${surface.product.border ? ` in ${surface.product.border.name}` : ""}, ${surface.border === 2 ? "two boards" : "one board"} wide along every open edge: mitred 45° at the corners, two screws or plugs at every joist, blocking under its inner edge where it runs with the joists.${surface.product.border ? "" : " In the deck's own colour — drawn a shade deeper so the frame reads."}`);
    for (const p of surface.pieces) box("decking", p.cx + ox, p.cy + oy, boardZ, p.sx, p.sy, surface.product.thickIn, p.border ? borderTag : boardTag, 0, p.yaw ?? 0, 0);
    surface.shaped.forEach((ring, ri) => {
      // The border's own cut pieces, in a second colour: the 3D is told which rings they are.
      if (surface.border > 0 && ri >= surface.shapedBorderFrom) borderRings.push(shapedBoards.length);
      shapedBoards.push(ring.map((v, i) => r3(v + (i % 2 === 0 ? ox : oy))));
      shapedZs.push(r3(f.surfaceIn));
    });
    if (surface.pattern !== "straight") {
      for (const ring of diagonalBoards(f, surface, ox, oy)) {
        shapedBoards.push(ring);
        shapedZs.push(r3(f.surfaceIn));
      }
    }
    if (surface.fascia.on) {
      const t = 0.75;
      const h = surface.fascia.heightIn;
      const z = f.joistBottomIn + h / 2;
      const fasciaTag = tagFor(`${lvl}fascia`, surface.fascia.kind === "composite" ? "composite 1x" : "wood 1x", 0, "Fascia over the rim, mitred at the corners, screwed every 16 in.");
      // OUTSIDE the rim (owner, 2026-10-11: "fix flickering on the 3D around the rim joist fascia"). It was laid on the
      // deck's side of each edge — inside the rim, its face in the rim's own plane, and the 3D flickered between the
      // two. Now on the yard's side (lib/deck/ringEdges), 1/32 in. clear of the rim so no face shares a plane with it.
      // At a corner the board coming in runs on to close the corner (or stops short of an inside one); the next
      // board starts at the corner, so no two boards overlap either.
      const clear = 1 / 32;
      const edges = ringEdges(shapeOutline(f.design.shape));
      const isHouse = (A: { x: number; y: number }, B: { x: number; y: number }) => f.edges.some((e) => e.house && Math.abs((A.x + B.x) / 2 - (e.x0 + e.x1) / 2) < 0.6 && Math.abs((A.y + B.y) / 2 - (e.y0 + e.y1) / 2) < 0.6) || (A.y < 0.5 && B.y < 0.5 && f.design.placement !== "detached") || (level.id === "lower" && A.y < 0.5 && B.y < 0.5);
      const on = edges.map((e) => e.length >= 1 && !isHouse(e.A, e.B));
      edges.forEach((e, i) => {
        if (!on[i]) return;
        const runOn = on[(i + 1) % edges.length] ? outsideRunOn(e.turnAtB, t + clear) : 0;
        const len = e.length + runOn;
        const off = clear + t / 2;
        box("fascia", e.A.x + e.ux * (len / 2) + e.outX * off + ox, e.A.y + e.uy * (len / 2) + e.outY * off + oy, z, len, t, h, fasciaTag, 0, e.yaw, 0);
      });
    }
    for (const p of f.posts) footings.push([r3(p.x + ox), r3(p.y + oy), r3(p.footing.padIn), r3(p.footing.padThickIn), r3(p.footing.pierIn), r3(p.footing.depthIn - p.footing.groundIn), r3(p.footing.topIn + p.footing.groundIn)]);
  }

  /* ── Skirting under the deck (2026-11-14; lib/deck/skirt) ───────────── */
  if (s.skirt) {
    const sk = s.skirt;
    const T = SKIRT_THICK_IN;
    const boardTag = tagFor("skirt board", "deck board", 0, `Skirting: the deck's own boards laid level under the rim, ${SKIRT_GAP_IN}-in. gaps so the frame behind breathes, on a treated 2x4 frame with an upright every 2 ft; a hand clear of the ground. One bay hangs on hinges, to get under the deck.`);
    const borderTag = tagFor("skirt frame", "1x4", 0, "Skirting: lattice in a 1x4 border, bay by bay (8 ft at most), on a treated 2x4 frame hung under the rim; a hand clear of the ground. One bay hangs on hinges, to get under the deck.");
    const slatTag = tagFor("skirt lattice", "lattice", 0, "Lattice: it lets the air through, so the frame under the deck stays dry.");
    // (Drawn a little coarser than the sheet is woven: the look, without thousands of slats on a big deck.)
    const slatPitch = sk.sqFt > 400 ? 7 : 4.5;
    const R2 = Math.SQRT2;
    for (const p of sk.panels) {
      const len = p.lengthIn;
      const ux = (p.x1 - p.x0) / len;
      const uy = (p.y1 - p.y0) / len;
      const h = p.topIn - p.bottomIn;
      /** A point of the bay: `a` along it, `d` out from the rim's face. */
      const at = (a: number, d: number): [number, number] => [p.x0 + ux * a + p.outX * (SKIRT_CLEAR_IN + d), p.y0 + uy * a + p.outY * (SKIRT_CLEAR_IN + d)];
      const [mx, my] = at(len / 2, T / 2);
      if (sk.kind === "boards") {
        // From the rim down, the last board ripped to stop a hand above the ground.
        const pitch = SKIRT_BOARD_IN + SKIRT_GAP_IN;
        for (let z = p.topIn; z - p.bottomIn > 1; z -= pitch) {
          const bh = Math.min(SKIRT_BOARD_IN, z - p.bottomIn);
          box("fascia", mx, my, z - bh / 2, len, T, bh, boardTag, 0, p.yaw, 0);
        }
        continue;
      }
      // The border: a rail top and bottom, a stile at each end between them.
      const B = SKIRT_BORDER_IN;
      box("fascia", mx, my, p.topIn - B / 2, len, T, B, borderTag, 0, p.yaw, 0);
      box("fascia", mx, my, p.bottomIn + B / 2, len, T, B, borderTag, 0, p.yaw, 0);
      if (!(h > 2 * B + 1 && len > 2 * B + 1)) continue;
      for (const a of [B / 2, len - B / 2]) {
        const [sx, sy] = at(a, T / 2);
        box("fascia", sx, sy, (p.topIn + p.bottomIn) / 2, B, T, h - 2 * B, borderTag, 0, p.yaw, 0);
      }
      // The slats: two layers crossing at 45°, inside the border's thickness, their ends tucked an inch behind it.
      const tuck = 1;
      const w0 = len - 2 * B + 2 * tuck;
      const h0 = h - 2 * B + 2 * tuck;
      const step = slatPitch * R2;
      const count = Math.max(1, Math.floor((w0 + h0) / step));
      const first = (w0 + h0 - (count - 1) * step) / 2;
      for (let k = 0; k < count; k++) {
        const c = first + k * step;
        for (const rising of [true, false]) {
          // Rising: s − t = c − h0. Falling: s + t = c. (s along the bay, t up, both inside the tucked opening.)
          const sA = rising ? Math.max(0, c - h0) : Math.max(0, c - h0);
          const sB = rising ? Math.min(w0, c) : Math.min(w0, c);
          if (!(sB - sA > 2)) continue;
          const tA = rising ? sA - (c - h0) : c - sA;
          const tB = rising ? sB - (c - h0) : c - sB;
          const [cx, cy] = at(B - tuck + (sA + sB) / 2, rising ? 0.25 : 0.5);
          box("fascia", cx, cy, p.bottomIn + B - tuck + (tA + tB) / 2, (sB - sA) * R2, 0.2, 1.5, slatTag, 0, p.yaw, rising ? Math.PI / 4 : -Math.PI / 4);
        }
      }
    }
  }

  /* ── The stairs ───────────────────────────────────────────────────── */
  for (const st of s.stairs) {
    const slopeDeg = st.risers ? deg(Math.atan2(st.riserIn, st.runIn)) : "";
    const noteFor = (m: StairMember): string => {
      switch (m.role) {
        case "stringer":
          return `2x12 cut stringer: ${st.risers} risers of ${st.riserIn.toFixed(2)} in. and treads of ${st.runIn} in. sawn out (${slopeDeg} to the ground), a plumb cut at the top, a level cut at the kicker; at least 5 in. of throat left. Hung on a stringer connector at the rim.`;
        case "tread":
          return `Tread of two deck boards, ${st.runIn + 1} in. deep with a 1-in. nosing, two screws into each stringer.`;
        case "riser":
          return "1x8 riser board behind the nosing, screwed to the stringers.";
        case "kicker":
          return "Treated 2x4 kicker across the stringers' feet, two anchors into the pad.";
        case "stair-post":
          return "4x4 post on a base and its own footing, carrying the landing or the mid-flight beam.";
        case "stair-beam":
          return "2x8 beam under the stringers midway: a cut stringer spans 6 ft at most.";
        case "landing-frame":
          return "2x8 landing frame on four posts, 36 in. deep.";
        case "landing-tread":
          return "The landing's boards.";
        case "box-frame":
          return `2x6 box frame, ${st.runIn} in. deep, joists at 16 in., mitred 45° at the corners and double-blocked; the level below carries it.`;
        case "box-tread":
          return "Treads of the deck's boards over the box frame, a 1-in. nosing.";
        case "stair-rail":
          return `2x4 stair rail at ${slopeDeg}, 36 in. above the nosings, on brackets to the posts.`;
        case "stair-rail-post":
          // As the stair's rail is mounted (2026-11-13): on the treads, or on the stringer.
          return st.rail.mount === "top" ? (s.rails.postKind === "wood" ? "4x4 stair rail post, top-mounted: on the tread in a rated post base, its screws into solid blocking between the stringers." : `${s.rails.label} stair rail post, top-mounted: its base plate on the tread, four structural screws into solid blocking between the stringers.`) : s.rails.postKind === "metal" ? `${s.rails.label} stair rail post, side-mounted: on the maker's bracket on the stringer's face, through-bolted.` : "4x4 stair rail post bolted to the stringer, two ½-in. carriage bolts.";
        case "stair-baluster":
          return "2x2 baluster, cut plumb top and bottom to the rail's slope, 5 in. on centre.";
        case "pad":
          return `Concrete pad ${st.pad ? `${st.pad.widthIn} × ${st.pad.lengthIn} in., ${st.pad.thickIn} in. thick` : "of pavers on sand"} at the foot of the stairs.`;
        default:
          return m.role;
      }
    };
    for (const m of st.members) box(STAIR_LAYER[m.role], m.cx, m.cy, m.cz, m.sx, m.sy, m.sz, tagFor(m.role.replace(/-/g, " "), m.nominal, m.lengthIn, noteFor(m)), 0, m.yaw, m.tilt);
    // Steps that follow the deck's outline (2026-11-14): their tread boards, each a flat ring at its own height, mitred
    // where two edges meet — drawn as the deck's cut boards are.
    for (const t of st.treadRings ?? []) {
      shapedBoards.push(t.ring.map((v) => r3(v)));
      shapedZs.push(r3(t.z));
    }
    for (const ft of st.footings) footings.push([r3(ft.x), r3(ft.y), r3(ft.padIn), r3(ft.padThickIn), r3(ft.pierIn), r3(ft.depthIn - ft.groundIn), r3(ft.topIn + ft.groundIn)]);
    const top = st.members.find((m) => m.role === "stringer");
    if (top && st.kind === "flight") {
      const connTag = tagFor("stringer connector", "LSC-type", 0, "Galvanized stringer connector at the top of each stringer, nailed to the rim; the stringers never hang on screws alone.");
      for (const m of st.members.filter((mm) => mm.role === "stringer")) {
        const dx = Math.cos(m.yaw) * (m.sx / 2) * Math.cos(m.tilt);
        const dy = Math.sin(m.yaw) * (m.sx / 2) * Math.cos(m.tilt);
        const dz = Math.sin(m.tilt) * (m.sx / 2);
        box("hardware", m.cx - dx, m.cy - dy, m.cz - dz + 2, 2, 2.5, 6, connTag);
      }
      callout(top.cx - Math.cos(top.yaw) * (top.sx / 2) * Math.cos(top.tilt), top.cy - Math.sin(top.yaw) * (top.sx / 2) * Math.cos(top.tilt), top.cz - Math.sin(top.tilt) * (top.sx / 2) + 2, "connection", "Stair stringers at the rim", `${st.stringers.count} 2x12 stringers on galvanized stringer connectors at the rim (never on screws alone), cut ${st.risers} × ${st.riserIn.toFixed(2)} in. rise over ${st.runIn} in. run — ${slopeDeg}; a treated kicker at the foot, ${st.pad ? "bolted to the pad" : "on the landing"}.`);
    }
  }

  /* ── The rails ────────────────────────────────────────────────────── */
  const rails = s.rails;
  if (rails.on) {
    const noteFor = (m: RailMember): string => {
      switch (m.role) {
        case "rail-post":
          return railPostWords(rails, m.mount ?? rails.mount);
        case "rail-top":
          return rails.system === "wood" ? "2x4 top rail on edge between the posts, on rail brackets or toe-screwed." : `${rails.label} top rail in its brackets.`;
        case "rail-bottom":
          return "Bottom rail 3½ in. above the boards (a 4-in. gap at most).";
        case "rail-cap":
          return rails.drinkLf ? "A deck board laid flat over the top rail and the post tops as a drink rail, on the rail maker's adapter or screwed up through the rail, mitred at the corners." : "Flat 2x6 drink cap over the posts and the top rail, mitred at the corners.";
        case "baluster":
          return rails.baluster === "metal" && rails.type !== "aluminum" ? "Round black aluminum baluster, ¾ in., about 4½ in. on centre (a gap under 4 in.), in connectors screwed to the rails." : rails.system === "wood" ? "2x2 baluster, 5 in. on centre (a 4-in. gap), two screws each end." : "Picket in the rail's own slots.";
        case "mesh":
          return "Welded wire mesh panel, 4 x 4 in. openings, its edges in a groove of the top and bottom rails: one panel a bay.";
        case "cable":
          return "Stainless cable, 3 in. on centre, tensioned at the end posts so a 4-in. sphere cannot pass.";
        default:
          return m.role;
      }
    };
    for (const m of rails.members) box(RAIL_LAYER[m.role], m.cx, m.cy, m.cz, m.sx, m.sy, m.sz, tagFor(m.role.replace(/-/g, " "), m.nominal, m.lengthIn, noteFor(m)), 0, m.yaw, m.tilt);
    for (const p of rails.panelsOut) poly(p.kind === "glass" ? "glass" : "wall", p.ring, tagFor(p.kind === "glass" ? "glass panel" : "rail panel", p.kind === "glass" ? "tempered glass" : "panel", 0, p.kind === "glass" ? "Tempered glass panel in the rail's channels." : "Solid panel in the rail's frame."));
    // WHAT HOLDS EACH POST, DRAWN (2026-11-13): a top-mounted post's base plate on the boards; a side-mounted wood post's
    // tension ties at its foot, a side-mounted metal post's bracket on the rim's face. Each as its own section says.
    const tieTag = tagFor("rail post tie", "DTT1Z pair", 0, "Two tension ties at the base of each rail post, ½-in. through-bolts into the joist and blocking: the 200-lb rail load goes into the frame, not just the rim.");
    const plateTag = tagFor("rail post base", rails.postKind === "wood" ? "post base" : "base plate", 0, rails.postKind === "wood" ? "A rated guard-post base under the 4x4, its screws through the boards into solid blocking between the joists." : "The post's base plate on the deck boards: four structural screws through the boards into solid blocking between the joists.");
    const bracketTag = tagFor("rail post bracket", "fascia bracket", 0, "The maker's fascia-mount bracket: through-bolted to the rim, with blocking behind the rim so the 200-lb rail load goes into the frame.");
    for (const m of rails.members.filter((mm) => mm.role === "rail-post")) {
      const foot = m.cz - m.sz / 2;
      const mount = m.mount ?? rails.mount;
      // The plate lies on the boards, under the post's foot.
      if (mount === "top") box("hardware", m.cx, m.cy, foot - BASE_PLATE_THICK_IN / 2, BASE_PLATE_IN, BASE_PLATE_IN, BASE_PLATE_THICK_IN, plateTag);
      else if (rails.postKind === "metal") box("hardware", m.cx, m.cy, foot + 4.5, 4.5, 4.5, 7, bracketTag);
      else box("hardware", m.cx, m.cy, foot + 4, 3, 3, 6, tieTag);
    }
    const firstPost = rails.members.find((m) => m.role === "rail-post");
    if (firstPost) callout(firstPost.cx, firstPost.cy, firstPost.cz - firstPost.sz / 2 + 6, "connection", "Rail post to the frame", railMountCallout(rails, firstPost.mount ?? rails.mount));
  }

  /* ── The roof ─────────────────────────────────────────────────────── */
  let peakIn = heightIn;
  if (roof) {
    const r = roof.roof;
    const pitchDeg = deg(roof.pitchAngle);
    const noteFor = (m: RoofMember): string => {
      switch (m.role) {
        case "rafter":
          return roof.kind === "pergola" ? `${m.nominal} pergola rafter, square-cut, notched over the headers, a hurricane tie each end.` : `${m.nominal} common rafter: plumb cut at the ridge and the tail (${pitchDeg} from vertical), a birdsmouth seat cut over the header (level ${pitchDeg} / plumb ${deg(Math.PI / 2 - roof.pitchAngle)}), ${r.rafterSpacingIn} in. on centre, a hurricane tie at the header${roof.ridge?.kind === "beam" ? ", a hanger at the ridge beam" : ""}.`;
        case "jack":
          return `${m.nominal} jack rafter: the ridge-end cut is a compound cut — plumb ${pitchDeg} and bevelled 45° to lie on the hip; seat cut over the header like a common.`;
        case "fly":
          return `${m.nominal} fly rafter at the rake overhang, on the lookouts; carries the rake board.`;
        case "hip":
          return `${m.nominal} hip rafter, one size deeper than the commons (IRC R802.3): plumb cut at the peak at ${deg(m.tilt)} (the hip's own pitch), a double side bevel where it meets the ridge, backing bevels along its top edges.`;
        case "ridge":
          return roof.ridge?.kind === "beam" ? `${m.nominal} ridge BEAM: the rafters bear on it in hangers; it carries the roof to the king posts or the wall, so the ceiling can stay open.` : `${m.nominal} ridge board, one size deeper than the rafters: the pairs nail through it, the ties take their thrust.`;
        case "king":
          return "4x4 king post under the ridge beam, in a post bracket on the gable-end header.";
        case "tie":
          return roof.kind === "gambrel" ? "2x6 tie across at the gambrel's break, through-bolted to the rafter pair with plywood gussets." : "2x6 rafter tie at the header line, every 4 ft, three 16d nails each end — it takes the rafters' thrust (IRC R802.5.2).";
        case "truss":
          return m.of === "truss-bc"
            ? `${m.nominal} of a manufactured truss, bearing on the headers 24 in. on center: the truss carries its own thrust — no ridge beam, no ties, nothing in the middle.`
            : m.of === "truss-web"
              ? "2x4 web of a manufactured truss, plated at both ends by the truss maker."
              : `${m.nominal} of a manufactured truss, designed and stamped by the truss maker for this roof's loads (IRC R802.10); a hurricane tie at each bearing.`;
        case "header":
          return m.nominal.startsWith("LVL") ? `Engineered LVL header post to post: the sawn tables did not reach, so a ${m.nominal.replace("LVL1.75x", "1¾ × ")}-in. ply beam is sized by the usual LVL figures; on post caps, plies bolted.` : `${m.nominal} header (beam) on the posts, in post caps${roof.ring.length > 4 ? `, mitred ${Math.round(180 / roof.ring.length)}° where two meet at a corner post` : ", square-cut"}${roof.headers.find((h) => h.id === m.of)?.idle ? "" : roof.headers.find((h) => h.id === m.of)?.cross ? "; it carries a king post under the ridge" : "; the rafters bear on it"}.`;
        case "roof-ledger":
          return `${m.nominal} roof ledger on the house, two structural screws every 16 in. into the studs or the rim; the rafters hang on it in hangers; step flashing over.`;
        case "roof-post":
          return `${m.nominal} roof post, ${roof.floor === "deck" ? "from its own footing up through the deck" : roof.floor === "slab" ? "on a base anchored to the slab" : "on its footing"}, capped for the header.`;
        case "roof-brace":
          return `${m.nominal} knee brace, 45° cuts both ends, a ½-in. lag each end — holds the roof square.`;
        case "purlin":
          return "2x4 purlin across the rafters at 24 in., the metal panels screwed to it.";
        case "slat":
          return `${m.nominal} slat, ${r.slats.spacingIn} in. apart, two screws at every rafter.`;
        case "ring":
          return roof.kind === "dutch-gable" ? "2x6 cap beam where the hips stop; the gablet's studs stand on it." : "2x8 ring beam at the lower tier's top, between the hips.";
        case "tier-post":
          return "4x4 tier post, 2 ft, carrying the upper roof over the open band.";
        case "subfascia":
          return `${m.nominal} sub-fascia across the rafter tails, each tail cut plumb; mitred at the corners.`;
        case "fascia-eave":
          return `${m.nominal} fascia board over the sub-fascia${r.fascia.finish === "aluminum-wrap" ? ", aluminum wrap over it" : ""}, mitred at the corners.`;
        case "fascia-rake":
          return `${m.nominal} rake board on the fly rafter, cut plumb at the ridge (${pitchDeg}) and square at the eave.`;
        case "gutter":
          return `${r.gutters.kind === "k6" ? "6" : "5"}-in. gutter on hidden hangers every ${roof.roofLoad >= 30 ? 18 : 24} in., ⅛ in. per 10 ft of fall to the downspout.`;
        case "downspout":
          return "Downspout to a splash block, three elbows, strapped to the post.";
        case "stud":
          return "2x4 gablet stud at 16 in., cut to the roof's angle at the top.";
        case "kneewall":
          return "2x4 plate for the wall panels between the posts.";
        case "door":
          return "Screen door, hung on a 2x4 jamb.";
        default:
          return m.role;
      }
    };
    // A truss's parts all lie in one plane, lapping at the plates: the bottom chord is drawn a little thinner than the
    // top chords and the webs thinner still, so no two of their faces share a plane where they lap (they flickered,
    // 2026-10-11). Named by part, so the 3D cuts the top chords plumb at the peak as it does rafters.
    const TRUSS_PART: Record<string, { role: string; lessIn: number }> = { "truss-tc": { role: "truss top chord", lessIn: 0 }, "truss-bc": { role: "truss bottom chord", lessIn: 0.2 }, "truss-web": { role: "truss web", lessIn: 0.4 } };
    // Two webs meeting at a panel point lap there too: every second web is drawn a tenth thinner again.
    let webs = 0;
    // A roof post standing through a deck is drawn in two, under the boards and above them: through them, its sides
    // and the boards' edges could lie in one plane (a 6x6 is a deck board wide) and flicker (2026-10-11).
    const deckAt = (x: number, y: number, z0: number, z1: number): { under: number; over: number } | null => {
      for (const lv of levels) {
        if (!lv.surface) continue;
        const top = lv.frame.surfaceIn;
        if (!(top > z0 + 1 && top < z1 - 1)) continue;
        const ring = shapeOutline(lv.frame.design.shape).map((q) => ({ x: q.x + lv.offsetXIn, y: q.y + lv.offsetYIn }));
        let inside = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const a = ring[i];
          const b = ring[j];
          if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
        }
        if (inside) return { under: top - lv.surface.product.thickIn, over: top };
      }
      return null;
    };
    for (const m of roof.members) {
      const part = m.role === "truss" ? TRUSS_PART[m.of ?? ""] : undefined;
      const less = (part?.lessIn ?? 0) + (m.of === "truss-web" && webs++ % 2 === 1 ? 0.2 : 0);
      // A roof post is drawn a quarter inch slimmer than the lumber: a 6x6 is as wide as a deck board, and where one
      // stands through the boards their sides lay in one plane (2026-10-11).
      const slim = m.role === "roof-post" ? 0.25 : 0;
      const tag = tagFor(part?.role ?? m.role.replace(/-/g, " "), m.nominal, m.lengthIn, noteFor(m));
      const cut = m.role === "roof-post" ? deckAt(m.cx, m.cy, m.cz - m.sz / 2, m.cz + m.sz / 2) : null;
      if (cut) {
        const bottom = m.cz - m.sz / 2;
        const top = m.cz + m.sz / 2;
        box(ROOF_MEMBER_LAYER[m.role], m.cx, m.cy, (bottom + cut.under) / 2, m.sx - slim, m.sy - slim, cut.under - bottom, tag, 0, m.yaw, m.tilt);
        box(ROOF_MEMBER_LAYER[m.role], m.cx, m.cy, (cut.over + top) / 2, m.sx - slim, m.sy - slim, top - cut.over, tag, 0, m.yaw, m.tilt);
        continue;
      }
      box(ROOF_MEMBER_LAYER[m.role], m.cx, m.cy, m.cz, m.sx - slim, m.sy - less - slim, m.sz, tag, 0, m.yaw, m.tilt, m.mA ?? 0, m.mB ?? 0);
    }
    const existingSlab = roof.floor === "existing";
    for (const p of roof.planes) poly(ROOF_PLANE_LAYER[p.kind], p.ring, tagFor(p.kind, p.kind === "roofing" ? ROOFING_LABEL[r.roofing] : p.kind === "sheathing" ? "½-in. sheathing" : p.kind === "ceiling" ? "ceiling boards" : p.kind === "soffit" ? "vented soffit" : p.kind === "slab" ? (existingSlab ? "existing concrete" : "4-in. concrete") : p.kind === "screen" ? "screen" : p.kind === "louver" ? "louver blade" : "wall panel", 0, p.kind === "roofing" ? `${ROOFING_LABEL[r.roofing]} over synthetic underlayment, drip edge at the eaves and rakes.` : p.kind === "sheathing" ? "½-in. sheathing, H-clips between the rafters, 8d nails at 6 in. edges / 12 in. field." : p.kind === "ceiling" ? "Ceiling boards nailed to the undersides of the rafters." : p.kind === "soffit" ? "Vented soffit panels in J-channel under the eaves." : p.kind === "slab" ? (existingSlab ? "The slab or patio already there: the posts sit on bases anchored into it. No concrete in the price." : "4-in. slab on a gravel base with wire mesh.") : p.kind === "screen" ? "Fiberglass screen in a spline-framed panel." : p.kind === "louver" ? "Aluminum louver blade on a pivot bar; the set turns together." : p.kind === "wall" ? "Framed panel between the posts." : p.kind));
    // THE SLAB'S JOINTS (2026-11-06): saw-cut control joints about every 10 ft each way, so a slab cracks along a line
    // and not across the middle. Thin dark boxes on the slab's layer; the 3D paints them as grooves.
    for (const p of roof.planes) {
      if (p.kind !== "slab" || p.ring.length !== 12) continue;
      const [x0, y0, z, , , , x1, y1] = p.ring;
      const w = x1 - x0;
      const d = y1 - y0;
      const jt = tagFor("control joint", "saw cut", 0, existingSlab ? "A joint in the existing slab." : "Saw-cut control joint, a quarter of the slab's thickness deep, cut the day after the pour so the slab cracks along it and not across the middle.");
      const nx = Math.max(0, Math.ceil(w / 120) - 1);
      const ny = Math.max(0, Math.ceil(d / 120) - 1);
      for (let i = 1; i <= nx; i++) box("slab", x0 + (w * i) / (nx + 1), (y0 + y1) / 2, z + 0.03, 0.3, d, 0.1, jt);
      for (let i = 1; i <= ny; i++) box("slab", (x0 + x1) / 2, y0 + (d * i) / (ny + 1), z + 0.03, w, 0.3, 0.1, jt);
    }
    // Hardware: hurricane ties at every rafter over the header, caps on the posts, hangers at the ridge beam, step flashing on the house.
    const hTie = tagFor("hurricane tie", "H2.5A", 0, "Galvanized tie, rafter to header, five 8d nails each leg — against wind uplift (IRC R802.11).");
    for (const m of roof.members.filter((mm) => mm.role === "rafter" || mm.role === "jack")) {
      // The seat sits over the header, one overhang in from the tail.
      const t = Math.min(0.9, (r.overhangIn + 2) / Math.max(1, m.sx * Math.cos(m.tilt)));
      const x = m.x0 + (m.x1 - m.x0) * t;
      const y = m.y0 + (m.y1 - m.y0) * t;
      // On the rafter's side, as an H2.5A is nailed: centred in the rafter it was as wide as the rafter, both its sides
      // in the rafter's own faces, and flickered (2026-10-11).
      const across = { x: -Math.sin(m.yaw), y: Math.cos(m.yaw) };
      const sheet = 0.12;
      box("hardware", x + across.x * (m.sy / 2 + sheet / 2), y + across.y * (m.sy / 2 + sheet / 2), roof.headerTopIn + 1.5, 2.5, sheet, 3, hTie, 0, m.yaw, 0);
    }
    const rcap = tagFor("post cap", `${r.post} cap`, 0, "Galvanized post cap, header to post, nailed both ways.");
    for (const p of roof.posts) box("hardware", p.x, p.y, p.topIn - 0.6, 6, 6, 2, rcap);
    // THE FEET (owner, 2026-11-06: "hangers, bolts and other things — better quality"): a galvanized stand-off base under
    // every post that stands on concrete or its own footing — the plate, a strap up two faces, the anchors' nuts — so the
    // 3D shows what the price carries. A post through a deck has its base at the deck's footing (drawn with the frame).
    if (roof.floor !== "deck") {
      const onSlab = roof.floor === "slab" || roof.floor === "existing";
      const baseTag = tagFor("post base", `ABU-type ${r.post}`, 0, onSlab ? "Galvanized stand-off base on two ½-in. wedge anchors into the slab; it holds the post 1 in. off the concrete so its end stays dry." : "Galvanized stand-off base on a ½-in. anchor bolt set in the footing; it holds the post 1 in. off the concrete so its end stays dry.");
      const anchorTag = tagFor(onSlab ? "wedge anchor" : "anchor bolt", "½-in.", 0, onSlab ? "½-in. wedge anchor, 4 in. into the slab, nut and washer over the base plate." : "½-in. anchor bolt set in the wet concrete, nut and washer over the base plate.");
      for (const p of roof.posts) {
        const m = roof.members.find((mm) => mm.role === "roof-post" && Math.abs(mm.cx - p.x) < 0.5 && Math.abs(mm.cy - p.y) < 0.5);
        const pw = m?.sx ?? 5.5;
        const pd = m?.sy ?? 5.5;
        const z0 = p.bottomIn;
        // Each piece a hair off the post's and the slab's faces, never in their plane (two faces in one plane flicker).
        box("hardware", p.x, p.y, z0 + 0.22, pw + 2, pd + 2, 0.4, baseTag);
        const strapH = Math.min(6, p.heightIn - 1);
        if (strapH >= 1.5) {
          box("hardware", p.x - (pw / 2 + 0.1), p.y, z0 + 0.2 + strapH / 2, 0.14, pd + 0.6, strapH, baseTag);
          box("hardware", p.x + (pw / 2 + 0.1), p.y, z0 + 0.2 + strapH / 2, 0.14, pd + 0.6, strapH, baseTag);
        }
        box("hardware", p.x, p.y - (pd / 2 + 0.6), z0 + 0.99, 0.9, 0.9, 1.1, anchorTag);
        if (onSlab) box("hardware", p.x, p.y + (pd / 2 + 0.6), z0 + 0.99, 0.9, 0.9, 1.1, anchorTag);
      }
      const p0 = roof.posts[0];
      if (p0) callout(p0.x, p0.y, p0.bottomIn + 3, "connection", onSlab ? "Post on the slab" : "Post on its footing", onSlab ? `${r.post} post in a galvanized stand-off base, two ½-in. wedge anchors into the ${roof.floor === "existing" ? "existing" : "new 4-in."} slab; the base keeps the post's end 1 in. off the concrete.` : `${r.post} post in a galvanized stand-off base on a ½-in. anchor bolt set in its poured footing${p0.footing ? ` (${p0.footing.padIn} in. across, ${p0.footing.depthIn} in. deep)` : ""}.`);
    }
    if (roof.ledger) {
      const led = roof.members.find((m) => m.role === "roof-ledger");
      if (led) {
        const scr = tagFor("roof ledger screw", "SDWS-type", 0, "Two structural screws every 16 in., into the studs or the rim behind the siding.");
        for (let x = led.x0 + 8; x < led.x1 - 4; x += 16) {
          box("hardware", x, led.cy + 0.9, led.cz + 2.5, 1, 0.8, 1, scr);
          box("hardware", x + 2, led.cy + 0.9, led.cz - 2.5, 1, 0.8, 1, scr);
        }
        callout(led.cx, led.cy, led.cz, "connection", "Roof ledger on the house", `${roof.ledger.nominal} ledger, ${roof.ledger.fasteners} structural screws (two every 16 in.) into the house framing; the rafters hang on it in hangers; flashed above where the roofing meets the siding.`);
      }
    }
    // AT THE HOUSE WALL (owner, 2026-11-07: "if it's a freestanding there is a gap for gutters and if it's attached then
    // the proper flashing gets there"). On the wall: the flashing where the roofing meets the siding, in aluminum like
    // the gutters — an L along a level top edge, step flashing up a sloped one, a kickout at its foot turning the water
    // into the gutter. Standing free beside the house: a note at the gap the back gutter hangs in.
    if (roof.wallFlashing.length) {
      const FL = FLASH_LEG_IN;
      const t = 0.14;
      const apronTag = tagFor("apron flashing", "L-flashing 4 × 4 in.", 0, "Apron (L) flashing where the roof's top edge meets the house: 4 in. up the wall behind the house wrap, counter-flashed by the siding, and 4 in. over the roofing. Water at the wall is turned down the roof and off to the sides, to the gutters.");
      const stepTag = tagFor("step flashing", "step flashing 4 × 4 in.", 0, "Step flashing up the sloped edge where the roof meets the house: an L-piece woven in with every course of roofing, 4 in. up the wall under the siding (counter-flashed) and 4 in. over the roofing. The water runs down along the wall to the eave — never behind the siding.");
      const kickTag = tagFor("kickout flashing", "kickout diverter", 0, "Kickout flashing where the eave meets the wall: it turns the water running down the step flashing off the wall and into the gutter, instead of down the siding (IRC R903.2.1).");
      for (const w of roof.wallFlashing) {
        const dx = w.x1 - w.x0;
        const dy = w.y1 - w.y0;
        const plan = Math.hypot(dx, dy) || 1;
        const yaw = Math.atan2(dy, dx);
        const mx = (w.x0 + w.x1) / 2;
        const my = (w.y0 + w.y1) / 2;
        const mz = (w.z0 + w.z1) / 2;
        if (w.kind === "kickout") {
          // A fin on the wall from the eave out past it over the gutter, turned a little away from the wall.
          const k = { x: (dx / plan) * 0.94 + w.ox * 0.34, y: (dy / plan) * 0.94 + w.oy * 0.34 };
          box("gutter", w.x0 + k.x * 3.5 + w.ox * 0.3, w.y0 + k.y * 3.5 + w.oy * 0.3, w.z0 + 0.5, 7, t, 5, kickTag, 0, Math.atan2(k.y, k.x));
          continue;
        }
        const tilt = Math.atan2(w.z1 - w.z0, plan);
        // The leg up the wall, in the wall's plane along the line.
        box("gutter", mx + w.ox * (t / 2 + 0.06), my + w.oy * (t / 2 + 0.06), mz + FL / 2, w.lengthIn + (w.kind === "apron" ? 4 : 0), t, FL, w.kind === "apron" ? apronTag : stepTag, 0, yaw, tilt);
        if (w.kind === "step") {
          // The leg over the roofing: level across the slope, so it lies on the shingles all the way up.
          box("gutter", mx + (w.ox * FL) / 2, my + (w.oy * FL) / 2, mz + 0.12, w.lengthIn, FL, t, stepTag, 0, yaw, tilt);
        } else {
          // The apron's leg runs down the roof away from the wall.
          const fall = Math.atan(roof.slope);
          box("gutter", mx + (w.ox * FL) / 2, my + (w.oy * FL) / 2, mz - (FL / 2) * Math.tan(fall) + 0.12, FL / Math.cos(fall), w.lengthIn + 4, t, apronTag, 0, Math.atan2(w.oy, w.ox), -fall);
        }
      }
      const steps = roof.wallFlashing.filter((w) => w.kind === "step").length;
      const kicks = roof.wallFlashing.filter((w) => w.kind === "kickout").length;
      const w0 = roof.wallFlashing.find((w) => w.kind === "kickout") ?? roof.wallFlashing[0];
      callout(w0.x0, w0.y0, w0.z0 + 3, "connection", "Roof to the house wall", `Flashed where the roof meets the siding: ${[roof.wallFlashing.some((w) => w.kind === "apron") ? "apron (L) flashing along the top" : "", steps ? `step flashing up ${steps === 1 ? "the slope" : `both slopes`}` : ""].filter(Boolean).join(", ")}, counter-flashed by the siding${kicks ? `, and ${kicks === 1 ? "a kickout" : `${kicks} kickouts`} at the eave turning the water into the gutter` : ""}. Water at the wall runs off to the sides and down to the gutters.`);
    }
    if (roof.houseGap) {
      const g = roof.houseGap;
      const xs0 = roof.eaveRing.map((p) => p.x);
      callout((Math.min(...xs0) + Math.max(...xs0)) / 2, g.eaveIn / 2, roof.headerTopIn, "connection", "The gap at the house", g.gutter ? `Free-standing on its own posts, ${ftIn(g.postsIn)} off the house: the back eave stops ${g.eaveIn < 12 ? `${g.eaveIn} in.` : ftIn(g.eaveIn)} from the wall and its gutter hangs in the gap, ${g.clearIn} in. clear of the siding. The back slope's water goes to that gutter and the downspouts — never down the wall.` : `Free-standing on its own posts, ${ftIn(g.postsIn)} off the house: the back eave stops ${g.eaveIn < 12 ? `${g.eaveIn} in.` : ftIn(g.eaveIn)} from the wall. With no gutter its water drips into that gap, beside the foundation — add gutters, or hang the roof on the house.`);
    }
    if (roof.headers[0] && roof.posts[0]) {
      const h = roof.headers[0];
      callout(h.x0 + (h.x1 - h.x0) * 0.5, h.y0 + (h.y1 - h.y0) * 0.5, roof.headerTopIn + 1, "connection", "Rafters on the header", `Each rafter is seat-cut over the ${h.spec.size} header and held with a hurricane tie (five 8d nails a leg); the header sits in post caps on the ${r.post} posts${roof.hardware.braces ? ", knee braces at the posts" : ""}.`);
    }
    if (roof.ridge) {
      const rm = roof.members.find((m) => m.role === "ridge");
      if (rm) callout(rm.cx, rm.cy, rm.cz, "connection", roof.ridge.kind === "beam" ? "Rafters on the ridge beam" : "Rafters at the ridge board", roof.ridge.kind === "beam" ? `The rafters bear on the ${roof.ridge.spec?.size ?? roof.ridge.nominal} ridge beam in hangers; the beam rests ${roof.kingPosts ? `on ${roof.kingPosts === 2 ? "two 4x4 king posts in post brackets on the gable-end headers" : "a 4x4 king post and a bracket on the house wall"}` : "on the hips' meeting points"}.` : `Each rafter pair meets through the ${roof.ridge.nominal} ridge board, nailed 16d; ${roof.ties ? `${roof.ties} 2x6 ties at the header line take the thrust` : "the hips take the thrust to the corners"}.`);
    }
    peakIn = Math.max(peakIn, roof.peakIn);
    const xs = roof.eaveRing.map((p) => p.x);
    const ys = roof.eaveRing.map((p) => p.y);
    width = Math.max(width, Math.max(...xs));
    depth = Math.max(depth, Math.max(...ys));
    if (!frame) heightIn = roof.floorIn;
    for (const p of roof.posts) if (p.footing) footings.push([r3(p.x), r3(p.y), r3(p.footing.padIn), r3(p.footing.padThickIn), r3(p.footing.pierIn), r3(p.footing.depthIn - p.footing.groundIn), r3(p.footing.topIn + p.footing.groundIn)]);
  }

  /* ── The electrical ───────────────────────────────────────────────── */
  const el = s.electrical;
  if (el.on) {
    for (const fx of el.fixtures) {
      const note = `${fx.label}${fx.supply === "client" ? " — the client's own, shown as a sample, to be determined" : ""}: ${fx.lv ? "low voltage, 16/2 from the transformer" : fx.kind === "heater" ? `hard-wired on its own ${fx.volts240 ? "30-A two-pole" : "20-A"} circuit, weatherproof box` : "on a 20-A GFCI circuit, weatherproof box with an in-use cover"}${fx.placed ? ", placed by hand" : ""}.`;
      box("light", fx.x, fx.y, fx.z, fx.sx, fx.sy, fx.sz, tagFor(fx.supply === "client" ? `${fx.kind.replace(/-/g, " ")} (client's)` : fx.kind.replace(/-/g, " "), fx.kind === "led-strip" ? `${Math.round(fx.runFt)} ft strip` : fx.kind === "heater" ? (fx.volts240 ? "4 kW 240 V" : "1.5 kW 120 V") : "fixture", 0, note), 0, fx.yaw, 0);
      if (glows.length < SCENE_MAX_GLOWS) glows.push([r3(fx.x), r3(fx.y), r3(fx.z), parseInt(fx.glow.slice(1), 16), fx.supply === "client" ? 1 : 0]);
    }
    const wireTag = (k: string) => tagFor("wire", k, 0, k === "lv" ? "16/2 low-voltage wire, stapled along the frame to each fixture." : `${k} UF-B wire in conduit along the frame, into a weatherproof box at each device.`);
    for (const w of el.wires) {
      for (let i = 0; i + 1 < w.path.length; i++) {
        const [ax, ay, az] = w.path[i];
        const [bx, by, bz] = w.path[i + 1];
        const L = Math.hypot(bx - ax, by - ay, bz - az);
        if (L < 1) continue;
        const yaw = Math.atan2(by - ay, bx - ax);
        const tilt = Math.atan2(bz - az, Math.hypot(bx - ax, by - ay));
        box("wire", (ax + bx) / 2, (ay + by) / 2, (az + bz) / 2, L, w.kind === "lv" ? 0.4 : 0.9, w.kind === "lv" ? 0.4 : 0.9, wireTag(w.kind), 0, Math.abs(bx - ax) + Math.abs(by - ay) < 0.01 ? 0 : yaw, Math.abs(bx - ax) + Math.abs(by - ay) < 0.01 ? Math.PI / 2 : tilt);
      }
    }
    box("light", el.feedAt[0], el.feedAt[1] + 2, el.feedAt[2], 6, 3.5, 8, tagFor("feed", "panel feed", 0, `The feed from the house's panel, ${el.feedFt} ft; ${el.circuits.length} ${el.circuits.length === 1 ? "circuit" : "circuits"} in a weatherproof junction box here.`));
    callout(el.feedAt[0], el.feedAt[1], el.feedAt[2], "connection", "Feed from the panel", `${el.circuits.map((c) => `${c.amps}-A ${c.kind === "lights-outlets" ? "GFCI circuit" : "heater circuit"}`).join(", ")} from the house's panel, ${el.feedFt} ft; ${el.trenchFt ? `${el.trenchFt} ft underground in conduit; ` : ""}weatherproof boxes with in-use covers at every device.`);
    if (el.transformerAt) box("light", el.transformerAt[0], el.transformerAt[1], el.transformerAt[2], 7, 4, 10, tagFor("transformer", "150 W, 12 V", 0, `Low-voltage transformer with a timer and photocell, plugged into a GFCI receptacle, feeding ${el.lv?.watts ?? 0} W of lights.`));
  }

  /* ── The house ────────────────────────────────────────────────────── */
  let house: DeckScene["house"] = null;
  const onWall = frame ? design.placement !== "detached" : roof?.attach === "wall";
  if (onWall) {
    // Drawn from the design's house (lib/deck/house): its back wall's parts, the door on the deck's main back edge,
    // windows per storey — the shape of a gazebo on its own floor stands in for a deck's.
    const main = frame ? frame.edges.filter((e) => e.house && e.side === "back" && Math.abs(e.y0) < 0.01).sort((a, b) => b.lengthIn - a.lengthIn)[0] : null;
    const hShape = frame ? design.shape : { kind: "rect" as const, widthFt: Math.max(4, width / 12), depthFt: Math.max(4, depth / 12) };
    const hs = houseScene(hShape, design.house, { deckHeightFt: heightIn / 12, peakFt: peakIn / 12, mainEdge: main ? { x0: main.x0 / 12, x1: main.x1 / 12 } : null });
    house = { blocks: hs.blocks, heightFt: hs.heightFt, door: hs.door, storeys: hs.storeys, roof: hs.roof, windows: hs.windows, siding: hs.siding, roofColour: hs.roofColour };
    // A house built from its photo (2026-10-23): its doors where they are, what it is clad in.
    if (hs.doors) house.doors = hs.doors;
    if (hs.material) house.material = hs.material;
    if (hs.roofs) house.roofs = hs.roofs;
  }

  // THE HOT TUB SPOT — the tub (by others) standing where the doubled
  // joists are, so the office and the client both see what the frame
  // under it is for.
  const spaR = frame ? spaRectIn(design) : null;
  if (spaR && frame) {
    // All INCHES — box() and poly() take the frame's units.
    const surface = design.heightIn;
    const shellTag = tagFor("hot tub", "owner's tub", 0, "The tub is by others — the frame under it is doubled (sistered joists) for the filled weight, near 100 psf.");
    const { x0, x1, y0, y1 } = spaR;
    const h = 36;
    const t = 5.5;
    // Four shell walls, then the top rim, then the water as a glossy pane.
    box("spa", (x0 + x1) / 2, y0 + t / 2, surface + h / 2, x1 - x0, t, h, shellTag);
    box("spa", (x0 + x1) / 2, y1 - t / 2, surface + h / 2, x1 - x0, t, h, shellTag);
    box("spa", x0 + t / 2, (y0 + y1) / 2, surface + h / 2, t, y1 - y0 - 2 * t, h, shellTag);
    box("spa", x1 - t / 2, (y0 + y1) / 2, surface + h / 2, t, y1 - y0 - 2 * t, h, shellTag);
    box("spa", (x0 + x1) / 2, (y0 + y1) / 2, surface + h + 0.75, x1 - x0, y1 - y0, 1.5, shellTag);
    const waterTag = tagFor("spa water", "", 0, "Water level a hand below the rim.");
    poly("spa", [x0 + t, y0 + t, surface + h - 4, x1 - t, y0 + t, surface + h - 4, x1 - t, y1 - t, surface + h - 4, x0 + t, y1 - t, surface + h - 4], waterTag);
    callout((x0 + x1) / 2, (y0 + y1) / 2, surface + h + 2, "connection", "Spa framing", "Every joist under the tub is doubled (a sister nailed alongside); the beams and footings below carry the filled weight. Said plainly in the checks.");
  }

  const outline = frame ? shapeOutline(design.shape).flatMap((p) => [r3(p.x), r3(p.y)]) : (roof?.ring ?? []).flatMap((p) => [r3(p.x), r3(p.y)]);
  const height = heightIn >= 24 ? `${Math.floor(heightIn / 12)} ft${heightIn % 12 ? ` ${Math.round(heightIn % 12)} in.` : ""}` : `${heightIn} in.`;
  const factParts = [structureWords(design)];
  if (frame) factParts.push(`${Math.round(levels.reduce((a, l) => a + l.frame.areaSqFt, 0))} sq ft`, `${height} high`, frame.decking.label);
  if (roof) {
    if (roof.kind === "pergola") factParts.push(`${roof.rafters.size} rafters, ${roof.louvers ? "louvers" : `${design.roof.slats.size} slats`}`);
    else factParts.push(`${roof.kind === "double-tier" ? "double-tier" : roof.kind === "dutch-gable" ? "Dutch gable" : roof.kind} roof ${design.roof.pitch}:12`, ROOFING_LABEL[design.roof.roofing].toLowerCase());
  }
  if (s.stairs.length) factParts.push(`${s.stairs.length === 1 ? "stairs" : `${s.stairs.length} stairs`}`);
  if (rails.on) factParts.push(railWords(rails).split(",")[0].toLowerCase());
  if (el.on) factParts.push(electricalWords(el).split(" · ")[0]);
  const deckColor = s.surface?.product.color ?? "#a58a5c";
  const frameC = frameColor(design.framing.species, frame?.group ?? roof?.group ?? "SP");
  // Over an OC frame the roof and a wood railing are sawn wood: they keep wood's colour.
  const woodC = design.framing.species === "oc-lumber" ? frameColor(roof?.species.id ?? "hem-fir", roof?.group ?? "DF") : frameC;
  const deckColor2 = s.surface?.product.color2;
  const borderLook = s.surface?.border ? s.surface.product.border : undefined;
  const colors: DeckScene["colors"] = { frame: frameC, decking: deckColor, fascia: deckColor, roofing: roofingColor(design.roof.roofing), rail: railColor(design.rail.type, deckColor, woodC, design.rail.color), ...(woodC !== frameC ? { roofFrame: woodC } : {}), ...(deckColor2 ? { decking2: deckColor2 } : {}), ...(rails.on && rails.infillColor ? { railInfill: rails.infillColor } : {}), ...(borderLook ? { border: borderLook.color, ...(borderLook.color2 ? { border2: borderLook.color2 } : {}) } : s.surface?.border ? { border: shadeHex(deckColor, BORDER_SAME_COLOUR_SHADE), ...(deckColor2 ? { border2: shadeHex(deckColor2, BORDER_SAME_COLOUR_SHADE) } : {}) } : {}), ...(rails.on && rails.drinkLf ? { railCap: deckColor } : {}) };
  const slope = design.site.slope;
  const ground = slope.outDropIn || slope.acrossDropIn ? { outDropFt: r3(slope.outDropIn), acrossDropFt: r3(slope.acrossDropIn) } : null;
  // The handles (edit mode): the deck's width, depth and height at its front-right corner, the roof's eave, each stair along its edge, the lower level's depth.
  const handles: SceneHandle[] = [];
  if (frame) {
    const Wd = Math.max(...frame.zones.map((z) => z.zone.x1));
    const Dd = Math.max(...frame.zones.map((z) => z.zone.y1));
    handles.push({ kind: "width", id: "width", x: r3(Wd), y: r3(Dd / 2), z: r3(frame.surfaceIn + 1), axis: "x", value: design.shape.widthFt, perUnit: 1, label: "Width along the house" });
    handles.push({ kind: "depth", id: "depth", x: r3(Wd / 2), y: r3(Dd), z: r3(frame.surfaceIn + 1), axis: "y", value: design.shape.depthFt, perUnit: 1, label: "Depth out from the house" });
    handles.push({ kind: "height", id: "height", x: r3(Wd), y: r3(Dd), z: r3(frame.surfaceIn), axis: "z", value: design.heightIn, perUnit: 1 / 12, label: "Deck height" });
    if (s.lower && s.lower.place === "front") handles.push({ kind: "lower-depth", id: "lower-depth", x: r3(s.lower.offsetXIn + (design.lower.widthFt * 12) / 2), y: r3(s.lower.offsetYIn + design.lower.depthFt * 12), z: r3(s.lower.frame.surfaceIn + 1), axis: "y", value: design.lower.depthFt, perUnit: 1, label: "Lower level depth" });
  }
  if (roof) {
    const corner = roof.posts.find((p) => p.corner) ?? roof.posts[0];
    if (corner) handles.push({ kind: "eave", id: "eave", x: r3(corner.x), y: r3(corner.y), z: r3(roof.headerBottomIn), axis: "z", value: design.roof.eaveHeightIn, perUnit: 1 / 12, label: "Height to the headers" });
    // The pitch: a knob at the peak that rides up and down (owner, 2026-10-10: "make the roof pitch draggable"). The rise is
    // the run times the pitch over 12, so a unit of pitch is the run's twelfth in feet — read off the roof as it stands.
    if (roof.kind !== "pergola" && design.roof.pitch > 0 && roof.peakIn - roof.headerTopIn > 1) {
      handles.push({ kind: "pitch", id: "pitch", x: r3(roof.centreX), y: r3(roof.centreY), z: r3(roof.peakIn), axis: "z", value: design.roof.pitch, perUnit: Math.round(((roof.peakIn - roof.headerTopIn) / 12 / design.roof.pitch) * 1000) / 1000, label: "Roof pitch" });
    }
    if (!frame) {
      const xs = roof.ring.map((p) => p.x);
      const ys = roof.ring.map((p) => p.y);
      handles.push({ kind: "roof-width", id: "roof-width", x: r3(Math.max(...xs)), y: r3((Math.min(...ys) + Math.max(...ys)) / 2), z: r3(roof.floorIn + 1), axis: "x", value: design.roof.plan.shape === "hexagon" || design.roof.plan.shape === "octagon" || design.roof.plan.shape === "round" ? design.roof.plan.acrossFt : design.roof.plan.widthFt, perUnit: 1, label: "Roof width" });
      if (design.roof.plan.shape === "rect") handles.push({ kind: "roof-depth", id: "roof-depth", x: r3((Math.min(...xs) + Math.max(...xs)) / 2), y: r3(Math.max(...ys)), z: r3(roof.floorIn + 1), axis: "y", value: design.roof.plan.depthFt, perUnit: 1, label: "Roof depth" });
    }
  }
  for (const st of s.stairs) {
    const [a, b] = st.footprint;
    if (!a || !b) continue;
    // The engine's steps between the levels are not the design's: no knob (the checks' fix makes them editable).
    if (st.design.id === BETWEEN_LEVELS_STAIR_ID) continue;
    const top = (st.level === "lower" && s.lower ? s.lower.frame.surfaceIn : frame?.surfaceIn ?? 0) + 2;
    handles.push({ kind: "stair", id: st.design.id, x: r3((a.x + b.x) / 2), y: r3((a.y + b.y) / 2), z: r3(top), axis: st.design.side === "front" ? "x" : "y", value: st.design.atFt, perUnit: 1, label: `Stairs along the ${st.design.side}` });
    // The width: a knob on the flight's far side, half-way down — drag it along the edge and the stairs widen that way
    // (the stringers, treads, risers, rail and the pad all re-count from the width).
    const c = st.footprint[2];
    if (st.kind === "flight" && c) handles.push({ kind: "stair-width", id: st.design.id, x: r3((b.x + c.x) / 2), y: r3((b.y + c.y) / 2), z: r3(top - st.riseIn / 2), axis: st.design.side === "front" ? "x" : "y", value: st.design.widthFt, perUnit: 1, follow: 0.5, label: "Stair width" });
  }
  if (house && frame) for (const h of houseHandles(design.shape, design.house, (frame.surfaceIn + 2) / 12)) handles.push(h);
  // BY HAND (2026-11-13; lib/deck/byHand): every post and beam that can be moved is a handle of its own, taken hold of
  // by the part itself and slid along its beam, its side or the joists an inch at a time. Last in the list: they have
  // no knob, and the knobs' lists run beside the handles' from the start.
  for (const g of deckGrips(s)) {
    if (g.fixed) continue;
    let b: [number, number, number, number, number, number] | null = null;
    if (g.kind === "post" && frame) {
      const p = frame.posts.find((q) => q.id === g.part);
      const [w, dp] = p ? POST_ACTUAL_IN[p.size] ?? [5.5, 5.5] : [0, 0];
      if (p) b = [p.x - w / 2, p.y - dp / 2, p.footing.groundIn + p.footing.topIn, p.x + w / 2, p.y + dp / 2, p.footing.groundIn + p.footing.topIn + p.heightIn];
    } else if (g.kind === "beam" && frame) {
      const m = frame.beams.find((q) => q.id === g.part);
      if (m) b = [m.x0, m.y - m.spec.thickIn / 2, m.bottomIn, m.x1, m.y + m.spec.thickIn / 2, m.bottomIn + m.spec.depthIn];
    } else if (g.kind === "roof-post" && roof) {
      const p = roof.posts.find((q) => q.id === g.part);
      const [w, dp] = p ? POST_ACTUAL_IN[p.size] ?? [5.5, 5.5] : [0, 0];
      if (p) b = [p.x - w / 2, p.y - dp / 2, p.bottomIn, p.x + w / 2, p.y + dp / 2, p.topIn];
    }
    if (!b) continue;
    handles.push({ kind: g.kind, id: g.id, x: r3((b[0] + b[3]) / 2), y: r3((b[1] + b[4]) / 2), z: r3((b[2] + b[5]) / 2), axis: g.axis, value: g.at, perUnit: 1 / 12, label: g.label, grab: [r3(b[0]), r3(b[1]), r3(b[2]), r3(b[3]), r3(b[4]), r3(b[5])], shown: { origin: g.origin, sign: g.sign, from: g.from } });
  }
  return {
    v: DECK_SCENE_VERSION,
    widthFt: r3(Math.max(width, 48)),
    depthFt: r3(Math.max(depth, 48)),
    heightFt: r3(heightIn),
    peakFt: r3(peakIn),
    boxes,
    tags,
    legend,
    callouts,
    footings: footings.slice(0, SCENE_MAX_FOOTINGS),
    diagonal: shapedBoards.length ? { thickFt: r3(s.surface?.product.thickIn ?? 1), boards: shapedBoards.slice(0, SCENE_MAX_DIAGONALS), zs: shapedZs.slice(0, SCENE_MAX_DIAGONALS), ...(borderRings.some((i) => i < SCENE_MAX_DIAGONALS) ? { border: borderRings.filter((i) => i < SCENE_MAX_DIAGONALS) } : {}) } : null,
    polys,
    polyTags,
    outline,
    house,
    ground,
    glows,
    handles,
    colors,
    facts: factParts.join(" · "),
  };
}

/** The words the figure's caption uses when there is no deck under it. */
export const sceneSizeWords = sizeWords;
export const sceneHasDeck = hasDeck;

/* ------------------------------------------------------------------ */
/*  Reading a stored scene back                                        */
/* ------------------------------------------------------------------ */

const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const HEX = /^#[0-9a-f]{6}$/i;
const inside = (n: number, min: number, max: number) => n >= min && n <= max;
/** Nothing in a deck scene is farther than this from its origin, ft. */
const REACH = 400;
/** Version 1 knew only the first ten layers, version 2 the first twenty. */
const V1_LAYERS = 10;
const V2_LAYERS = 20;

const numbers = (raw: unknown, length: number, min = -REACH, max = REACH): number[] | null => {
  if (!Array.isArray(raw) || raw.length !== length) return null;
  const out: number[] = [];
  for (const v of raw) {
    if (!fin(v) || !inside(v, min, max)) return null;
    out.push(v);
  }
  return out;
};

/** A stored scene, read back defensively: a bad shape is no scene, never a crash. Reads versions 1, 2 and 3. */
export function parseDeckScene(raw: unknown): DeckScene | null {
  const r = (raw && typeof raw === "object" ? raw : null) as Record<string, unknown> | null;
  if (!r || (r.v !== 1 && r.v !== 2 && r.v !== DECK_SCENE_VERSION)) return null;
  const v = r.v as 1 | 2 | 3;
  const maxLayer = (v === 1 ? V1_LAYERS : v === 2 ? V2_LAYERS : SCENE_LAYERS.length) - 1;
  if (!fin(r.widthFt) || !fin(r.depthFt) || !fin(r.heightFt)) return null;
  if (!inside(r.widthFt, 1, REACH) || !inside(r.depthFt, 1, REACH) || !inside(r.heightFt, 0, 60)) return null;
  const peakFt = fin(r.peakFt) && inside(r.peakFt, 0, 120) ? r.peakFt : r.heightFt;
  if (!Array.isArray(r.boxes) || r.boxes.length > SCENE_MAX_BOXES) return null;
  const boxes: number[][] = [];
  for (const b of r.boxes) {
    const cols = Array.isArray(b) ? b.length : 0;
    // 8 = an axis box; 10 adds a yaw and a tilt; 12 adds the two ends'
    // plan mitres (a fascia sawn where two eaves meet).
    const long = (cols === 10 || cols === 12) && v !== 1;
    const n = numbers(b, long ? cols : 8);
    if (!n || !Number.isInteger(n[0]) || !inside(n[0], 0, maxLayer) || !Number.isInteger(n[7]) || !inside(n[7], 0, 4)) return null;
    if (n[4] <= 0 || n[5] <= 0 || n[6] <= 0) return null;
    if (long && (!inside(n[8], -7, 7) || !inside(n[9], -1.6, 1.6))) return null;
    if (n.length === 12 && (!inside(n[10], -4, 4) || !inside(n[11], -4, 4))) return null;
    boxes.push(n);
  }
  if (!Array.isArray(r.footings) || r.footings.length > SCENE_MAX_FOOTINGS) return null;
  const footings: number[][] = [];
  for (const f of r.footings) {
    const n = numbers(f, 7);
    if (!n || n[2] <= 0 || n[4] <= 0) return null;
    footings.push(n);
  }
  let diagonal: DeckScene["diagonal"] = null;
  const d = (r.diagonal && typeof r.diagonal === "object" ? r.diagonal : null) as Record<string, unknown> | null;
  if (d) {
    if (!fin(d.thickFt) || !inside(d.thickFt, 0.01, 1) || !Array.isArray(d.boards) || d.boards.length > SCENE_MAX_DIAGONALS) return null;
    const boards: number[][] = [];
    for (const ring of d.boards) {
      if (!Array.isArray(ring) || ring.length < 6 || ring.length > 40 || ring.length % 2 !== 0) return null;
      const n = numbers(ring, ring.length);
      if (!n) return null;
      boards.push(n);
    }
    const zs = Array.isArray(d.zs) && d.zs.length === boards.length ? numbers(d.zs, boards.length, -10, 120) ?? undefined : undefined;
    // The rings that are a border in a second colour: whole numbers inside the list, each once.
    const border = Array.isArray(d.border) ? [...new Set(d.border.filter((i): i is number => Number.isInteger(i) && (i as number) >= 0 && (i as number) < boards.length))] : [];
    diagonal = { thickFt: d.thickFt, boards, zs, ...(border.length ? { border } : {}) };
  }
  const polys: number[][] = [];
  if (v !== 1) {
    if (r.polys !== undefined && (!Array.isArray(r.polys) || r.polys.length > SCENE_MAX_POLYS)) return null;
    for (const p of (r.polys as unknown[]) ?? []) {
      if (!Array.isArray(p) || p.length < 10 || p.length > 1 + 3 * 16 || (p.length - 1) % 3 !== 0) return null;
      const n = numbers(p, p.length);
      if (!n || !Number.isInteger(n[0]) || !inside(n[0], 0, maxLayer)) return null;
      polys.push(n);
    }
  }
  // (Up to 80 corners — 2026-11-14: a deck in parts, its back stepping with the wall and its front part by part, has more than the 20 a rectangle, an L or a bowed front ever had.)
  const outline = Array.isArray(r.outline) && r.outline.length >= 6 && r.outline.length <= 160 && r.outline.length % 2 === 0 ? numbers(r.outline, r.outline.length) : null;
  if (!outline) return null;
  let house: DeckScene["house"] = null;
  const h = (r.house && typeof r.house === "object" ? r.house : null) as Record<string, unknown> | null;
  if (h) {
    if (!fin(h.heightFt) || !inside(h.heightFt, 1, 120) || !Array.isArray(h.blocks) || h.blocks.length > 16) return null;
    const blocks: number[][] = [];
    for (const b of h.blocks) {
      const n = numbers(b, Array.isArray(b) && b.length === 5 ? 5 : 4);
      if (!n) return null;
      blocks.push(n);
    }
    const door = h.door === null || h.door === undefined ? null : numbers(h.door, Array.isArray(h.door) && h.door.length === 4 ? 4 : 3);
    if (h.door !== null && h.door !== undefined && !door) return null;
    house = { blocks, heightFt: h.heightFt, door };
    // The drawn house's look (2026-10-11): storeys, the roof, the windows — malformed ones are dropped, not fatal.
    if (h.storeys === 1 || h.storeys === 2) house.storeys = h.storeys;
    if ((HOUSE_ROOFS as readonly unknown[]).includes(h.roof)) house.roof = h.roof as HouseRoof;
    if (Array.isArray(h.windows)) house.windows = h.windows.map((w) => numbers(w, 5)).filter((w): w is number[] => !!w).slice(0, 60);
    if (typeof h.siding === "string" && /^#[0-9a-f]{6}$/i.test(h.siding)) house.siding = h.siding;
    if (typeof h.roofColour === "string" && /^#[0-9a-f]{6}$/i.test(h.roofColour)) house.roofColour = h.roofColour;
    // Built from a photo (2026-10-23): the doors and the cladding — malformed ones dropped.
    if (Array.isArray(h.doors)) house.doors = h.doors.map((d) => numbers(d, 6)).filter((d): d is number[] => !!d).slice(0, 8);
    if (typeof h.material === "string" && (HOUSE_MATERIALS as readonly string[]).includes(h.material)) house.material = h.material as HouseMaterial;
    // A scene saved before 2026-11-13 can hold a window inside a door: none on another's spot (lib/deck/house).
    if (house.windows || house.doors) {
      const clear = settleSceneOpenings(house.windows, house.doors);
      if (clear.windows) house.windows = clear.windows;
      if (clear.doors) house.doors = clear.doors;
    }
    // The roofs over the body and its bump-outs (2026-10-23): all of them or none (a roof per block, as before).
    if (Array.isArray(h.roofs) && h.roofs.length <= 16) {
      const roofs = h.roofs.map((x) => numbers(x, 7)).filter((x): x is number[] => !!x && Number.isInteger(x[0]) && x[0] >= 0 && x[0] <= 9);
      if (roofs.length && roofs.length === h.roofs.length) house.roofs = roofs;
    }
  }
  // Version 3: the legend, the tags, the callouts, the ground, the glows. Anything malformed is dropped, not fatal.
  let legend: SceneLegend[] = [];
  let tags: number[] = [];
  let polyTags: number[] = [];
  let callouts: number[][] = [];
  let glows: number[][] = [];
  let ground: DeckScene["ground"] = null;
  const handles: SceneHandle[] = [];
  if (v === 3) {
    if (Array.isArray(r.legend) && r.legend.length <= SCENE_MAX_LEGEND) {
      for (const e of r.legend) {
        const o = (e && typeof e === "object" ? e : null) as Record<string, unknown> | null;
        if (!o || typeof o.role !== "string" || typeof o.nominal !== "string" || typeof o.note !== "string" || !fin(o.lengthFt) || !fin(o.count)) {
          legend = [];
          break;
        }
        legend.push({ role: o.role.slice(0, 60), nominal: o.nominal.slice(0, 60), lengthFt: o.lengthFt, count: o.count, note: o.note.slice(0, 240) });
      }
    }
    if (Array.isArray(r.tags) && r.tags.length === boxes.length && r.tags.every((t) => Number.isInteger(t) && (t as number) >= -1 && (t as number) < legend.length)) tags = r.tags as number[];
    if (Array.isArray(r.polyTags) && r.polyTags.length === polys.length && r.polyTags.every((t) => Number.isInteger(t) && (t as number) >= -1 && (t as number) < legend.length)) polyTags = r.polyTags as number[];
    if (Array.isArray(r.callouts) && r.callouts.length <= SCENE_MAX_CALLOUTS) {
      for (const c of r.callouts) {
        const n = numbers(c, 4);
        if (!n || !Number.isInteger(n[3]) || n[3] < 0 || n[3] >= legend.length) {
          callouts = [];
          break;
        }
        callouts.push(n);
      }
    }
    if (Array.isArray(r.glows) && r.glows.length <= SCENE_MAX_GLOWS) {
      for (const g of r.glows) {
        const n = numbers(g, 5, -REACH, 16777215);
        if (!n) {
          glows = [];
          break;
        }
        glows.push(n);
      }
    }
    const gr = (r.ground && typeof r.ground === "object" ? r.ground : null) as Record<string, unknown> | null;
    if (gr && fin(gr.outDropFt) && fin(gr.acrossDropFt) && inside(gr.outDropFt, -10, 10) && inside(gr.acrossDropFt, -10, 10)) ground = { outDropFt: gr.outDropFt, acrossDropFt: gr.acrossDropFt };
    if (Array.isArray(r.handles) && r.handles.length <= 240) {
      for (const h of r.handles) {
        const o = (h && typeof h === "object" ? h : null) as Record<string, unknown> | null;
        if (!o || typeof o.kind !== "string" || typeof o.id !== "string" || !fin(o.x) || !fin(o.y) || !fin(o.z) || !fin(o.value) || !fin(o.perUnit) || (o.axis !== "x" && o.axis !== "y" && o.axis !== "z")) continue;
        handles.push({ kind: o.kind as SceneHandle["kind"], id: o.id.slice(0, 20), x: o.x, y: o.y, z: o.z, axis: o.axis, value: o.value, perUnit: o.perUnit, ...(fin(o.follow) && o.follow > 0 && o.follow <= 1 ? { follow: o.follow } : {}), label: typeof o.label === "string" ? o.label.slice(0, 60) : "", ...handleGrab(o) });
      }
    }
  }
  const c = (r.colors && typeof r.colors === "object" ? r.colors : {}) as Record<string, unknown>;
  const color = (x: unknown, fallback: string) => (typeof x === "string" && HEX.test(x) ? x : fallback);
  return {
    v: DECK_SCENE_VERSION,
    widthFt: r.widthFt,
    depthFt: r.depthFt,
    heightFt: r.heightFt,
    peakFt,
    boxes,
    tags,
    legend,
    callouts,
    footings,
    diagonal,
    polys,
    polyTags,
    outline,
    house,
    ground,
    glows,
    handles,
    colors: { frame: color(c.frame, "#9d8c62"), decking: color(c.decking, "#a58a5c"), fascia: color(c.fascia, "#a58a5c"), roofing: color(c.roofing, "#565250"), rail: color(c.rail, "#9d8c62"), ...(typeof c.decking2 === "string" && HEX.test(c.decking2) ? { decking2: c.decking2 } : {}), ...(typeof c.railInfill === "string" && HEX.test(c.railInfill) ? { railInfill: c.railInfill } : {}), ...(typeof c.border === "string" && HEX.test(c.border) ? { border: c.border } : {}), ...(typeof c.border2 === "string" && HEX.test(c.border2) ? { border2: c.border2 } : {}), ...(typeof c.railCap === "string" && HEX.test(c.railCap) ? { railCap: c.railCap } : {}), ...(typeof c.roofFrame === "string" && HEX.test(c.roofFrame) ? { roofFrame: c.roofFrame } : {}) },
    facts: typeof r.facts === "string" ? r.facts.slice(0, 200) : "",
  };
}

/* ------------------------------------------------------------------ */
/*  Member geometry — the one truth both renderers draw from           */
/* ------------------------------------------------------------------ */

/** A point in scene feet. */
export type ScenePoint = [number, number, number];

/**
 * Corner order for `memberBoxCorners`: the box about its centre along unit
 * axes u (length), v (width), w (depth) — minus/plus per axis, w last:
 * [mmm, pmm, ppm, mpm, mmp, pmp, ppp, mpp]. `MEMBER_BOX_FACES` winds each
 * of the six faces outward (right-hand rule) over those indexes.
 */
export const MEMBER_BOX_FACES: readonly number[][] = [
  [4, 5, 6, 7], // +w
  [0, 3, 2, 1], // −w
  [1, 2, 6, 5], // +u
  [0, 4, 7, 3], // −u
  [3, 7, 6, 2], // +v
  [0, 1, 5, 4], // −v
];

/** Roles whose sloped ends are plumb cuts (dashes read as spaces). */
const PLUMB_ROLES = /^(?:upper |lower )?(rafter|jack|fly|hip|valley|fascia rake|stringer|stair rail|ridge|truss(?: top chord)?)$/;
/** Roles that are knee braces: plumb against the post, LEVEL against what they hold up. */
const BRACE_ROLES = /^(?:upper |lower )?(roof brace|brace|knee brace)$/;

/**
 * The eight corners of a scene box whose geometry is more than an axis
 * box — a turned member with sawn ends, or a `lean` knee brace drawn as
 * the true diagonal of its box. Null for an ordinary box: the renderer
 * keeps its cheap path.
 *
 * The saw cuts are the real ones. A rafter's ends are PLUMB (the tail
 * at the eave, the cut at the ridge — before this the square ends stuck
 * through the roofing as teeth). A knee brace is plumb where it lags to
 * the post and LEVEL where it lags under the beam — both renderers used
 * to leave both ends square or both plumb, so every brace poked through
 * its beam ("braces connections not cut at right angle", the owner,
 * 2026-10-13).
 */
/**
 * Does this box need REAL sawn geometry rather than a sheared unit box?
 * True for the lean knee braces, the turned braces (plumb at the post,
 * level under the beam — a single shear cannot do both ends), and any
 * member carrying plan mitres. Plumb-cut rafters stay on the renderers'
 * cheap sheared-instance path, which matches `memberBoxCorners` exactly.
 */
export function memberIsSawn(b: readonly number[], role: string | null): boolean {
  const lean = b[7] ?? 0;
  if (lean >= 1 && lean <= 4) return true;
  if (b.length >= 12 && ((b[10] ?? 0) !== 0 || (b[11] ?? 0) !== 0)) return true;
  const turned = b.length >= 10 && ((b[8] ?? 0) !== 0 || (b[9] ?? 0) !== 0);
  return turned && BRACE_ROLES.test((role ?? "").replace(/-/g, " ").trim());
}

export function memberBoxCorners(b: readonly number[], role: string | null): ScenePoint[] | null {
  const [, cx, cy, cz, sx, sy, sz, lean = 0, yawRaw, tiltRaw, mitreA = 0, mitreB = 0] = b;
  const r = (role ?? "").replace(/-/g, " ").trim();
  const turned = typeof yawRaw === "number" && typeof tiltRaw === "number" && (yawRaw !== 0 || tiltRaw !== 0);
  const mitred = mitreA !== 0 || mitreB !== 0;

  let u: ScenePoint, v: ScenePoint, w: ScenePoint;
  let su = sx, sv = sy, sw = sz;
  let tilt = 0;
  let isBrace = false;

  if (turned || (mitred && lean === 0)) {
    const yaw = (turned ? yawRaw : 0) as number;
    tilt = (turned ? tiltRaw : 0) as number;
    u = [Math.cos(yaw) * Math.cos(tilt), Math.sin(yaw) * Math.cos(tilt), Math.sin(tilt)];
    v = [-Math.sin(yaw), Math.cos(yaw), 0];
    w = [-Math.sin(tilt) * Math.cos(yaw), -Math.sin(tilt) * Math.sin(yaw), Math.cos(tilt)];
    isBrace = BRACE_ROLES.test(r);
    if (!isBrace && !mitred && !PLUMB_ROLES.test(r)) return null; // square-cut turned member — the plain oriented box is right
  } else if (lean >= 1 && lean <= 4) {
    // The brace drawn as the diagonal of its axis-aligned box.
    const alongX = lean <= 2;
    const sign = lean === 1 || lean === 3 ? 1 : -1;
    const run = alongX ? sx : sy;
    const L = Math.hypot(run, sz);
    if (L < 0.01) return null;
    const ux = alongX ? (sign * run) / L : 0;
    const uy = alongX ? 0 : (sign * run) / L;
    u = [ux, uy, sz / L];
    v = alongX ? [0, 1, 0] : [1, 0, 0];
    // w = u × v, flipped if need be so depth points up out of the brace's top face.
    w = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    if (w[2] < 0) w = [-w[0], -w[1], -w[2]];
    su = L;
    // Its two faces: a 2x4 is its thickness by 3 1/2 in., as it always was; a heavier brace (2026-11-14) is square.
    const thick = alongX ? sy : sx;
    sv = thick > 0.31 ? Math.min(thick, 0.7) : Math.min(thick, 0.3);
    sw = thick > 0.31 ? sv : 0.3;
    tilt = Math.atan2(sz, Math.abs(run));
    isBrace = true;
  } else {
    return null;
  }

  // How far each end's corners slide along the length, per unit of their
  // depth coordinate: tan(tilt) makes the end face PLUMB, −cot(tilt)
  // makes it LEVEL. Guarded — a nearly flat or nearly plumb member keeps
  // square ends rather than exploding.
  const t = Math.abs(tilt);
  const plumbK = t > 0.02 && t < 1.45 ? Math.tan(tilt) : 0;
  const levelK = t > 0.25 && t < 1.35 ? -1 / Math.tan(tilt) : 0;
  // With tilt > 0 the +u end is the high end; with tilt < 0 the −u end is.
  const highAtPlus = tilt >= 0;
  const kMinus = isBrace ? (highAtPlus ? plumbK : levelK) : plumbK;
  const kPlus = isBrace ? (highAtPlus ? levelK : plumbK) : plumbK;

  const c: ScenePoint = [cx, cy, cz];
  const corner = (a: number, bb: number, d: number): ScenePoint => {
    const k = a < 0 ? kMinus : kPlus;
    // The end's plan mitre slides the corner along the length by its
    // width coordinate — how the saw actually crosses the board.
    const m = a < 0 ? mitreA : mitreB;
    const along = (a * su) / 2 + ((d * sw) / 2) * k + ((bb * sv) / 2) * m;
    return [
      c[0] + u[0] * along + v[0] * ((bb * sv) / 2) + w[0] * ((d * sw) / 2),
      c[1] + u[1] * along + v[1] * ((bb * sv) / 2) + w[1] * ((d * sw) / 2),
      c[2] + u[2] * along + v[2] * ((bb * sv) / 2) + w[2] * ((d * sw) / 2),
    ];
  };
  return [
    corner(-1, -1, -1), corner(1, -1, -1), corner(1, 1, -1), corner(-1, 1, -1),
    corner(-1, -1, 1), corner(1, -1, 1), corner(1, 1, 1), corner(-1, 1, 1),
  ];
}
