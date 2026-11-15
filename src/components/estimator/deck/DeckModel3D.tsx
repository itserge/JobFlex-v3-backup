"use client";
// THE DECK STUDIO'S 3D (2026-10-04; roofs 2026-10-10; version 3 M3 2026-10-10).
// Vanilla Three.js, like FenceModel3D and RoofModel3D: the renderer, the sky,
// the lights and the ground are built ONCE; the structure itself is a group
// rebuilt whenever the scene's data changes, and the things that change many
// times a second — how much is standing, the x-ray, the night — only touch
// instance counts, material opacity and light intensity.
//
// Owner (M3): "show it as it is made in real — the cuts in degrees, the
// bolts, the hangers; zoom in on any part; the lights light up." So:
//   · every box is placed by its own matrix, and a sloped member (a rafter,
//     a hip, a rake board, a stringer) is SHEARED so its ends are plumb cuts,
//     the way a saw leaves them, instead of square to the slope;
//   · the hardware layer draws the lags, hangers, ties, bases, caps and
//     flashing where the engine put them, in galvanized grey;
//   · a touch on any part names it from the scene's legend (its stock, its
//     length, its cuts, its fasteners) and a click flies the camera to it;
//     the Connections toggle numbers the joints worth a look;
//   · the night view drops the sun, and the fixtures glow (a few of them
//     throw real light) — a fixture the client brings is drawn as a
//     see-through sample;
//   · when the studio is placing a fixture, a click reports the spot and
//     what it landed on, nothing more.
//
// The data is lib/deck/scene.ts's box list, in feet: x along the house, y
// out from it, z up. Here x stays X, z becomes Y (up) and y becomes Z, with
// the deck's middle at the origin, so the house is behind the deck and the
// camera stands in the yard.
import * as React from "react";
import * as THREE from "three";
import { boxPlace, placeSeeds, ringPlace } from "@/lib/deck/boardTone";
import { DOOR_CHOICES, WINDOW_CHOICES, openingChoiceOf } from "@/lib/deck/house";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { BORDER_BOARD_ROLE, RAIL_CAP_ROLE, RAIL_INFILL_ROLE, SCENE_LAYERS, sceneBuildLayers, memberBoxCorners, memberIsSawn, MEMBER_BOX_FACES, type DeckScene, type SceneHandle, type SceneLayer, type SceneLegend } from "@/lib/deck/scene";

/** Where the camera can be asked to look from. */
export type DeckLook = "yard" | "top" | "front" | "left" | "right" | "under" | "house" | "spin" | "in" | "out" | "turn-left" | "turn-right";

/** A drag on a handle: the design number it moves, and the value it should take now (feet for sizes, inches for heights). */
export interface DeckEdit {
  kind: SceneHandle["kind"];
  id: string;
  value: number;
  /** An "xy" handle's second number (an accessory dragged across the deck: out from the house, inches). */
  value2?: number;
  /** An accessory turned by its round handle (2026-11-15): its new turn, degrees — `value`/`value2` are then its middle as it was. */
  turn?: number;
  /**
   * A WINDOW OR A DOOR (kind "opening", 2026-11-15): `value` its middle along the house and `value2` its sill, ft. With
   * `w` or `h` it was sized by an edge (ft); with `choice` it is swapped for that kind (an OpeningChoice's key); with
   * `remove` it is taken off the wall.
   */
  w?: number;
  h?: number;
  choice?: string;
  remove?: boolean;
  /** The pointer came up: the last value of this drag. */
  done: boolean;
}

/** The short name beside each edit knob, and which names win a crowded spot (the deck's own size first, the house last). */
const KNOB_NAME: Record<SceneHandle["kind"], string> = { width: "Width", "width-left": "Width", depth: "Depth", bow: "Bow", height: "Height", eave: "Post height", pitch: "Pitch", "roof-width": "Roof width", "roof-depth": "Roof depth", "lower-depth": "Lower level", stair: "Move stairs", "stair-width": "Stair width", jog: "Wall step", "house-left": "House corner", "house-right": "House corner", post: "Move post", beam: "Move beam", "roof-post": "Move roof post" , builtin: "Accessory", opening: "Window or door" };
const KNOB_RANK: Record<SceneHandle["kind"], number> = { width: 0, "width-left": 0.5, depth: 1, bow: 1.5, height: 2, eave: 3, pitch: 4, "roof-width": 5, "roof-depth": 6, "lower-depth": 7, "stair-width": 8, stair: 9, "house-left": 10, "house-right": 11, jog: 12, post: 13, beam: 14, "roof-post": 15 , builtin: 20, opening: 21 };

/** What a touch landed on, for the studio's label and the fixture placer. */
export interface DeckPick {
  /** The part's legend entry (null for the ground, the house or a part with no tag). */
  legend: SceneLegend | null;
  layer: SceneLayer | "ground" | "house" | null;
  /** The point hit, in the scene's feet: x along the house, y out from it, z up. */
  point: [number, number, number];
  /** What a fixture placed here would be mounted on. */
  mount: "post" | "header" | "rail" | "deck" | "ceiling" | "wall" | "stair" | "peak";
  /** The scene's box that was touched (lib/deck/parts names the part from it); null for a flat face, the ground or the house. */
  boxIdx?: number | null;
  /** A board cut to a shape that was touched (2026-11-14): its ring in the scene's `diagonal` — a step that follows the deck's outline is named from it. */
  ringIdx?: number | null;
}

export interface DeckModel3DProps {
  scene: DeckScene;
  /** Layers standing, counted in build order over the layers this scene has (lib/deck/scene sceneBuildLayers): 0 … n. A fraction stands part of a layer, piece by piece. Left out: everything stands. */
  built?: number;
  /** Fade the boards, the roofing, the ceiling and the ground. */
  xray?: boolean;
  /** Evening: the sun down, the fixtures lit. */
  night?: boolean;
  /** Number the connections worth a look. */
  connections?: boolean;
  /** A click reports the spot (for placing a fixture) instead of flying to the part. */
  placing?: boolean;
  className?: string;
  /** Read out for the canvas. */
  label?: string;
  /** Change it to put the camera back on the three-quarter view from the yard. */
  resetToken?: number;
  /** A part touched or clicked (null when the touch left every part). */
  onPick?: (pick: DeckPick | null, kind: "hover" | "click") => void;
  /** Fly to this point in the scene's feet when it changes; a fourth number frames that many feet across (4 by default). */
  focus?: [number, number, number] | [number, number, number, number] | null;
  /**
   * Look at the structure from a side (2026-10-21, the studio's voice: "show me from the top", "from underneath", "spin it
   * around"): a new `token` moves the camera there — from the yard, above, the left or right, under the deck, from the
   * house looking out — or takes it once all the way round. A drag on the scene stops a spin.
   */
  look?: { token: number; from: DeckLook } | null;
  /** Show the handles and let them be dragged. */
  edit?: boolean;
  /** A handle moved: the design number it stands for, and its new value. */
  onEdit?: (edit: DeckEdit) => void;
  /** The house's own wall from the contractor's photo, standing where the house is (null: the drawn house). */
  backdrop?: DeckBackdrop | null;
  /** A part lit up for the contractor — the wall field being typed in (lib/deck/house wallHighlight). */
  highlight?: SceneHighlight | null;
  /**
   * THE VIEW BAR (owner, 2026-10-22: "the good option to turn around the deck and look underneath"): turn ⟲, zoom −,
   * Top, Under, 3D, zoom +, turn ⟳ — on the scene, in the corner the host keeps free. Under takes the camera below the
   * ground, looking up at the framing; any other view brings it back above.
   */
  viewControls?: "top-right" | "bottom-left" | false;
  /**
   * A click on a part flies the camera to it (the default). A host that opens a card on the part — to take it out or
   * swap it (2026-11-09) — passes false: the picture stays where it is, so the frame is seen re-framing around the
   * change, and the card's own Zoom flies in when asked.
   */
  flyOnClick?: boolean;
  /**
   * TAKE THIS ONE IN THE HAND (2026-11-15): a window or a door just put on the wall by a click (or an accessory) — a new
   * `token` takes it, as a click on it would, as soon as the picture shows it. So "click the wall where the window
   * goes" leaves the window in the hand, to move or size at once.
   */
  hold?: { token: number; kind: "builtin" | "opening"; id: string } | null;
}

/**
 * A PART LIT UP (owner, 2026-10-12: "when I click a box to type in, show in the 3D which one it is — make it smart"):
 * boxes in the scene's feet [x0, y0, z0, x1, y1, z1] drawn in blueprint blue through everything in front of them,
 * breathing while they stand, and a tag above them.
 */
export interface SceneHighlight {
  boxes: number[][];
  /** The scene's own parts lit (indexes into its boxes and its flat polygons), its footings, its shaped boards. */
  boxIdx?: number[];
  polyIdx?: number[];
  footings?: boolean;
  diagonal?: boolean;
  tag?: { x: number; y: number; z: number; text: string } | null;
}

/**
 * THE PHOTO AS THE WALL (2026-10-10). Owner: "make that picture turnable like
 * a 3D — on the 3D page, when the picture is adapted, let me work with this
 * wall when I'm building the deck." The photo the studio placed the
 * elevation on stands in the scene as the house: the same scale and ground
 * line the placement used (lib/deck/elevation elevationOverlay), so the deck
 * meets the wall exactly where the photo view shows it. Where the wall
 * steps (the read's jogs), the picture is cut at the step and each part
 * stands at its own depth, with a plain return wall between them.
 */
export interface DeckBackdrop {
  /** The picture's read link. */
  href: string;
  /** Its pixels. */
  w: number;
  h: number;
  /** Where the deck's elevation was placed on it: the ground line's left end and its width, as fractions of the picture. */
  placed: { x: number; y: number; w: number };
  /** The elevation that placement was made for: its width, and where the deck's x = 0 lands in it, ft. */
  elevWidthFt: number;
  elevLeftFt: number;
  /** Where the wall steps, as fractions of the picture's width; "toward" brings the part to the right nearer by `depthFt`. */
  jogs: Array<{ x: number; dir: "toward" | "away"; depthFt: number | null }>;
  /** How far behind the house line the wall stands, ft: 0 for a structure on the house, a yard's worth for a detached one kept as a backdrop. */
  standoffFt?: number;
  /** The wall's span on the picture (lib/deck/photoFit wallExtent): the base's ends across and the eave's height, fractions. The 3D cuts the picture to it and builds the house's body behind. */
  wall?: { x0: number; x1: number; top: number | null; storeys: 1 | 2 | null } | null;
}
/** A step in the wall the read could not size. */
const JOG_DEFAULT_FT = 2;

const LAYER_COUNT = SCENE_LAYERS.length;
const layerIndex = (name: SceneLayer) => SCENE_LAYERS.indexOf(name);
const DECKING = layerIndex("decking");
const RAIL = layerIndex("rail");
const FASCIA = layerIndex("fascia");
const FOOTING = layerIndex("footing");
const BRACE = layerIndex("brace");
const SHEATHING = layerIndex("sheathing");
const ROOFING = layerIndex("roofing");
const CEILING = layerIndex("ceiling");
const TRIM = layerIndex("trim");
const GUTTER = layerIndex("gutter");
const SLAB = layerIndex("slab");
const GLASS = layerIndex("glass");
const SCREEN = layerIndex("screen");
const WALL = layerIndex("wall");
const HARDWARE = layerIndex("hardware");
const LIGHT = layerIndex("light");
const WIRE = layerIndex("wire");
/** Layers the x-ray fades. */
const FADES = new Set([DECKING, FASCIA, SHEATHING, ROOFING, CEILING, TRIM, GLASS, SCREEN, WALL]);
const STAIR = layerIndex("stair");
/** The stair's skin — the boards a foot touches — fades in the x-ray like the deck's boards, so the stringers under it
 *  show (owner, 2026-10-11: "the X-ray doesn't x-ray the steps"). Legend roles, dashes as spaces. */
const STAIR_SKIN = /^(tread|riser|landing tread|box tread)$/;
/** Legend roles whose ends are plumb cuts (sheared boxes). */
const PLUMB_CUT = /^(rafter|jack|fly|hip|fascia rake|stringer|stair rail|roof brace|brace|truss top chord)$/;
/** Hardware drawn as a six-sided head or nut, not a plate (2026-11-06). */
const HEX_HEAD = /fastener|anchor|bolt|screw/i;
/** The slab's saw-cut control joints, drawn as dark grooves. */
const JOINT = /^control joint$/;
/** A slab's thickness in the 3D, ft (4 in.): the top face sits at the scene's slab height, the sides go down to the ground. */
const SLAB_THICK_FT = 4 / 12;

/**
 * A scene box's place in the 3D's world — shared by the parts and their highlight, so a lit part lies exactly on its
 * part. A turned member's axis points `yaw` from +x in plan and rises `tilt`; a sloped member's ends are plumb cuts
 * (the shear is written for the unit box — tan × depth ÷ length — so it goes on before the scale).
 */
const bmBasis = new THREE.Matrix4();
const bmShear = new THREE.Matrix4();
const bmScale = new THREE.Matrix4();
const bmTrans = new THREE.Matrix4();
const bmX = new THREE.Vector3();
const bmY = new THREE.Vector3();
const bmZ = new THREE.Vector3();
function boxMatrix(b: readonly number[], role: string | null, ox: number, oz: number, out: THREE.Matrix4): THREE.Matrix4 {
  const turned = b.length >= 10 && (b[8] !== 0 || b[9] !== 0);
  const yaw = turned ? b[8] : 0;
  const tilt = turned ? b[9] : 0;
  if (turned) {
    bmX.set(Math.cos(yaw) * Math.cos(tilt), Math.sin(tilt), Math.sin(yaw) * Math.cos(tilt));
    bmY.set(-Math.cos(yaw) * Math.sin(tilt), Math.cos(tilt), -Math.sin(yaw) * Math.sin(tilt));
    bmZ.set(-Math.sin(yaw), 0, Math.cos(yaw));
    bmBasis.makeBasis(bmX, bmY, bmZ);
  } else bmBasis.identity();
  const plumb = turned && Math.abs(tilt) > 0.02 && Math.abs(tilt) < 1.45 && !!role && PLUMB_CUT.test(role);
  bmShear.identity();
  if (plumb) bmShear.elements[4] = Math.tan(tilt) * (b[6] / b[4]);
  bmScale.makeScale(b[4], b[6], b[5]);
  bmTrans.makeTranslation(b[1] - ox, b[3], b[2] - oz);
  return out.copy(bmTrans).multiply(bmBasis).multiply(bmScale).multiply(bmShear);
}
/**
 * Real sawn geometry for the members a sheared unit box cannot draw: the
 * knee braces (plumb against the post, LEVEL under the beam — the owner:
 * "braces connections not cut at right angle") and mitred fascia runs.
 * Built from the same `memberBoxCorners` the blueprint pictures use, so
 * the two renderers can never disagree about a cut.
 */
function sawnGeometry(b: readonly number[], role: string | null, ox: number, oz: number): THREE.BufferGeometry | null {
  const c = memberBoxCorners(b, role);
  if (!c) return null;
  const pos: number[] = [];
  for (const f of MEMBER_BOX_FACES) {
    const q = f.map((i) => c[i]);
    // Scene (x, y, z-up) → three (x, z-up→y, y→z), offset to the model's centre.
    const v = (p: readonly number[]): [number, number, number] => [p[0] - ox, p[2], p[1] - oz];
    const [a0, a1, a2, a3] = [v(q[0]), v(q[1]), v(q[2]), v(q[3])];
    // The y/z swap mirrors handedness — wind the triangles back out.
    pos.push(...a0, ...a2, ...a1, ...a0, ...a3, ...a2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

const MOUNT_OF: Partial<Record<SceneLayer, DeckPick["mount"]>> = { post: "post", "roof-post": "post", header: "header", beam: "header", rail: "rail", glass: "rail", decking: "deck", fascia: "deck", rim: "deck", joist: "deck", ceiling: "ceiling", rafter: "ceiling", sheathing: "ceiling", roofing: "ceiling", ridge: "peak", stair: "stair", wall: "wall", screen: "wall", ledger: "wall", light: "deck", wire: "deck" };

const CONCRETE = 0xb9b6ad;
const GRASS = 0x8fa078;
const SIDING = 0xe9e5db;
const FOUNDATION = 0xa9a69d;
const ROOF = 0x55524c;
const TRIM_WHITE = 0xf7f5ef;
const OSB = 0xd6bf90;
const CEILING_WOOD = 0xe6d5b2;
const ALUMINUM = 0xd9d6cf;
const GALV = 0x9a9ea3;
const WIRE_C = 0x3a3a3f;
const LIGHT_C = 0xf4efe4;
const INK = 0x0f1419;

function webglSupported(): boolean {
  if (typeof document === "undefined") return true;
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

/** A little lighter or darker, the same for the same piece every time. */
function jitter(base: THREE.Color, i: number, amount: number): THREE.Color {
  const n = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  const t = (n - Math.floor(n) - 0.5) * 2 * amount;
  const hsl = { h: 0, s: 0, l: 0 };
  base.getHSL(hsl);
  return new THREE.Color().setHSL(hsl.h, hsl.s, Math.min(1, Math.max(0, hsl.l + t)));
}

/**
 * A STREAKED BOARD (2026-11-09): a line sold in a blended colour (Trex Transcend Lineage, TimberTech Legacy…) is laid
 * board by board somewhere between its two tones — most near the main one, a few well into the second — the way a
 * pallet of them looks on a deck. Steady per board, so a redraw never reshuffles the floor.
 */
function streaked(base: THREE.Color, second: THREE.Color | null, i: number, amount: number): THREE.Color {
  if (!second) return jitter(base, i, amount);
  const n = Math.sin(i * 78.233 + 12.9898) * 43758.5453;
  const t = n - Math.floor(n);
  return jitter(base.clone().lerp(second, t * t * 0.75), i, amount * 0.6);
}

/* ── Procedural textures: lap siding, wood grain, shingles, metal ribs, grass, concrete ── */
function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  if (g) draw(g);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
/**
 * The wall's own colour and the roof's, averaged off the picture: the wall's middle band between the base and the
 * eave, the roof in the strip above the eave (only when it is darker than the wall — sky or a pale soffit keeps the
 * default). Null when the picture cannot be read back (a cross-origin store without CORS).
 */
function sampleColours(img: HTMLImageElement, r: { x0: number; x1: number; y0: number; y1: number }): { wall: THREE.Color; roof: THREE.Color | null } | null {
  try {
    const N = 96;
    const c = document.createElement("canvas");
    c.width = N;
    c.height = N;
    const g = c.getContext("2d", { willReadFrequently: true });
    if (!g) return null;
    g.drawImage(img, 0, 0, N, N);
    const data = g.getImageData(0, 0, N, N).data;
    const avg = (x0: number, x1: number, y0: number, y1: number): THREE.Color | null => {
      let rr = 0;
      let gg = 0;
      let bb = 0;
      let n = 0;
      for (let y = Math.floor(y0 * N); y < Math.ceil(y1 * N); y++) {
        for (let x = Math.floor(x0 * N); x < Math.ceil(x1 * N); x++) {
          if (x < 0 || y < 0 || x >= N || y >= N) continue;
          const i = (y * N + x) * 4;
          rr += data[i];
          gg += data[i + 1];
          bb += data[i + 2];
          n++;
        }
      }
      return n ? new THREE.Color(rr / n / 255, gg / n / 255, bb / n / 255).convertSRGBToLinear() : null;
    };
    const wh = r.y1 - r.y0;
    const ww = r.x1 - r.x0;
    const wall = avg(r.x0 + ww * 0.1, r.x1 - ww * 0.1, r.y0 + wh * 0.25, r.y1 - wh * 0.2);
    if (!wall) return null;
    const roof = r.y0 > 0.04 ? avg(r.x0 + ww * 0.2, r.x1 - ww * 0.2, Math.max(0, r.y0 - 0.1), r.y0 - 0.01) : null;
    const lum = (k: THREE.Color) => 0.2126 * k.r + 0.7152 * k.g + 0.0722 * k.b;
    return { wall, roof: roof && lum(roof) < lum(wall) * 0.8 ? roof : null };
  } catch {
    return null;
  }
}
/** Triangles into a geometry with normals and a planar roofing UV (one tile per 3 ft). */
function trisGeometry(pts: number[][]): THREE.BufferGeometry {
  const pos = new Float32Array(pts.length * 3);
  const uv = new Float32Array(pts.length * 2);
  pts.forEach((pt, i) => {
    pos[i * 3] = pt[0];
    pos[i * 3 + 1] = pt[1];
    pos[i * 3 + 2] = pt[2];
    uv[i * 2] = pt[0] / 3;
    uv[i * 2 + 1] = (pt[2] + pt[1]) / 3;
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}
/** A hip roof over a w × d footprint centred at the origin: eaves at y = 0, the ridge along x at `rise`, the hips at 45°. */
function hipRoofGeometry(w: number, d: number, rise: number): { slopes: THREE.BufferGeometry; ends: THREE.BufferGeometry | null } {
  const hw = w / 2;
  const hd = d / 2;
  const hr = Math.max(0.3, hw - hd);
  const A = [-hw, 0, hd];
  const B = [hw, 0, hd];
  const C = [hw, 0, -hd];
  const D = [-hw, 0, -hd];
  const R1 = [-hr, rise, 0];
  const R2 = [hr, rise, 0];
  return { slopes: trisGeometry([A, B, R2, A, R2, R1, C, D, R1, C, R1, R2, B, C, R2, D, A, R1]), ends: null };
}
/** A gable roof: the ridge runs the whole length; its two ends are wall (siding), not roofing. */
function gableRoofGeometry(w: number, d: number, rise: number): { slopes: THREE.BufferGeometry; ends: THREE.BufferGeometry | null } {
  const hw = w / 2;
  const hd = d / 2;
  const A = [-hw, 0, hd];
  const B = [hw, 0, hd];
  const C = [hw, 0, -hd];
  const D = [-hw, 0, -hd];
  const R1 = [-hw, rise, 0];
  const R2 = [hw, rise, 0];
  return { slopes: trisGeometry([A, B, R2, A, R2, R1, C, D, R1, C, R1, R2]), ends: trisGeometry([B, C, R2, D, A, R1]) };
}
/**
 * THE HOUSE'S OTHER ROOFS (2026-10-23), each over a w × d footprint centred at the origin, its eave at y = 0, z toward
 * the yard: a gable whose end faces the yard (the ridge along z), a shed rising to the back, and a bump-out's roof whose
 * back (z = −d/2) stands against the body — a hip end, a gable end or a shed. `ends` is wall (siding), not roofing.
 */
function gableEndGeometry(w: number, d: number, rise: number): { slopes: THREE.BufferGeometry; ends: THREE.BufferGeometry | null } {
  const hw = w / 2;
  const hd = d / 2;
  const A = [-hw, 0, hd];
  const B = [hw, 0, hd];
  const C = [hw, 0, -hd];
  const D = [-hw, 0, -hd];
  const R1 = [0, rise, hd];
  const R2 = [0, rise, -hd];
  return { slopes: trisGeometry([D, A, R1, D, R1, R2, B, C, R2, B, R2, R1]), ends: trisGeometry([A, B, R1, C, D, R2]) };
}
function shedGeometry(w: number, d: number, rise: number): { slopes: THREE.BufferGeometry; ends: THREE.BufferGeometry | null } {
  const hw = w / 2;
  const hd = d / 2;
  const A = [-hw, 0, hd];
  const B = [hw, 0, hd];
  const C = [hw, rise, -hd];
  const D = [-hw, rise, -hd];
  const C0 = [hw, 0, -hd];
  const D0 = [-hw, 0, -hd];
  return { slopes: trisGeometry([A, B, C, A, C, D]), ends: trisGeometry([A, D, D0, B, C0, C, D0, D, C, D0, C, C0]) };
}
function bumpHipGeometry(w: number, d: number, rise: number): { slopes: THREE.BufferGeometry; ends: THREE.BufferGeometry | null } {
  const hw = w / 2;
  const hd = d / 2;
  const run = Math.min(d, hw);
  const FL = [-hw, 0, hd];
  const FR = [hw, 0, hd];
  const BL = [-hw, 0, -hd];
  const BR = [hw, 0, -hd];
  // The hips rise from the front corners at 45° in plan; a bump-out narrower than twice its depth comes to one point.
  const i = Math.min(hw, run);
  const top = hd - run;
  const PL = [-hw + i, rise, Math.max(-hd, top)];
  const PR = [hw - i, rise, Math.max(-hd, top)];
  const KL = [-hw + i, rise, -hd];
  const KR = [hw - i, rise, -hd];
  return { slopes: trisGeometry([FL, FR, PR, FL, PR, PL, FL, PL, KL, FL, KL, BL, FR, BR, KR, FR, KR, PR, PL, PR, KR, PL, KR, KL]), ends: null };
}
function bumpGableGeometry(w: number, d: number, rise: number): { slopes: THREE.BufferGeometry; ends: THREE.BufferGeometry | null } {
  const hw = w / 2;
  const hd = d / 2;
  const FL = [-hw, 0, hd];
  const FR = [hw, 0, hd];
  const BL = [-hw, 0, -hd];
  const BR = [hw, 0, -hd];
  const R1 = [0, rise, hd];
  const R2 = [0, rise, -hd];
  return { slopes: trisGeometry([BL, FL, R1, BL, R1, R2, FR, BR, R2, FR, R2, R1]), ends: trisGeometry([FL, FR, R1]) };
}

/** Lap siding, one course per tile (6 in. tall, the tile 4 ft wide): the board's bevel — lighter at its top, deeper
 *  toward the butt — the butt's shadow on the course below, a lip of light under it, faint grain along the board and
 *  a butt joint now and then. The same canvas is the wall's bump map (2026-10-27: "a bit more realistic … but
 *  optimized" — one small texture, drawn once). */
function sidingTexture() {
  return canvasTexture(256, 32, (g) => {
    const bevel = g.createLinearGradient(0, 0, 0, 32);
    bevel.addColorStop(0, "#ffffff");
    bevel.addColorStop(0.75, "#f1f1f1");
    bevel.addColorStop(1, "#e2e2e2");
    g.fillStyle = bevel;
    g.fillRect(0, 0, 256, 32);
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(60,45,30,${0.02 + Math.random() * 0.04})`;
      g.fillRect(Math.random() * 256, 2 + Math.random() * 27, 20 + Math.random() * 90, 1);
    }
    g.fillStyle = "rgba(0,0,0,0.22)";
    g.fillRect(0, 29, 256, 3);
    g.fillStyle = "rgba(0,0,0,0.08)";
    g.fillRect(0, 26, 256, 3);
    g.fillStyle = "rgba(255,255,255,0.35)";
    g.fillRect(0, 0, 256, 1);
    const joint = 40 + Math.random() * 176;
    g.fillStyle = "rgba(0,0,0,0.14)";
    g.fillRect(joint, 0, 1, 29);
  });
}
/** Wood grain: fine streaks along x, a pale base the instance colour tints. */
function grainTexture() {
  return canvasTexture(256, 64, (g) => {
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, 256, 64);
    for (let i = 0; i < 90; i++) {
      const y = Math.random() * 64;
      const a = 0.04 + Math.random() * 0.09;
      g.strokeStyle = `rgba(60,40,20,${a})`;
      g.lineWidth = 0.6 + Math.random() * 1.4;
      g.beginPath();
      g.moveTo(0, y);
      for (let x = 0; x <= 256; x += 32) g.lineTo(x, y + Math.sin(x / 40 + i) * 1.5);
      g.stroke();
    }
    for (let i = 0; i < 6; i++) {
      g.fillStyle = `rgba(80,55,30,${0.05 + Math.random() * 0.06})`;
      g.beginPath();
      g.ellipse(Math.random() * 256, Math.random() * 64, 6 + Math.random() * 10, 2 + Math.random() * 2, 0, 0, Math.PI * 2);
      g.fill();
    }
  });
}
/** Shingle courses: a shadow line under every course, tabs staggered. */
function shingleTexture() {
  return canvasTexture(128, 128, (g) => {
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, 128, 128);
    for (let row = 0; row < 4; row++) {
      const y = row * 32;
      g.fillStyle = "rgba(0,0,0,0.28)";
      g.fillRect(0, y + 29, 128, 3);
      g.fillStyle = "rgba(0,0,0,0.10)";
      g.fillRect(0, y + 24, 128, 5);
      const off = row % 2 ? 21 : 0;
      for (let x = -off; x < 128; x += 42) {
        g.fillStyle = "rgba(0,0,0,0.22)";
        g.fillRect(x + 40, y + 8, 2, 24);
      }
      for (let k = 0; k < 40; k++) {
        g.fillStyle = `rgba(0,0,0,${Math.random() * 0.08})`;
        g.fillRect(Math.random() * 128, y + Math.random() * 28, 3, 2);
      }
    }
  });
}
/** Standing seams / panel ribs every so often. */
function ribTexture() {
  return canvasTexture(128, 16, (g) => {
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, 128, 16);
    g.fillStyle = "rgba(0,0,0,0.22)";
    g.fillRect(0, 0, 3, 16);
    g.fillStyle = "rgba(255,255,255,0.35)";
    g.fillRect(3, 0, 2, 16);
    g.fillStyle = "rgba(0,0,0,0.06)";
    g.fillRect(64, 0, 1, 16);
  });
}
function grassTexture() {
  return canvasTexture(128, 128, (g) => {
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = `rgba(${20 + Math.random() * 40},${40 + Math.random() * 30},${10 + Math.random() * 20},${0.06 + Math.random() * 0.14})`;
      g.fillRect(Math.random() * 128, Math.random() * 128, 1 + Math.random() * 2, 1 + Math.random() * 3);
    }
  });
}
/** What a wall built from its photo is clad in (2026-10-23): a pale pattern the wall's own colour tints, one tile a
 *  known size (brick: two courses, 16 × 5⅓ in.; board and batten: one 16-in. bay; stone: 2 × 2 ft). */
function brickTexture() {
  return canvasTexture(128, 64, (g) => {
    g.fillStyle = "#f4f1ea";
    g.fillRect(0, 0, 128, 64);
    for (let row = 0; row < 4; row++) {
      const y = row * 16;
      const off = row % 2 ? 32 : 0;
      for (let x = -off; x < 128; x += 64) {
        const tone = 0.1 + Math.random() * 0.16;
        g.fillStyle = `rgba(0,0,0,${tone})`;
        g.fillRect(x + 2, y + 2, 60, 12);
        g.fillStyle = `rgba(255,255,255,${Math.random() * 0.08})`;
        g.fillRect(x + 2, y + 2, 60, 2);
        g.fillStyle = "rgba(0,0,0,0.18)";
        g.fillRect(x + 2, y + 12, 60, 2);
        for (let k = 0; k < 14; k++) {
          g.fillStyle = `rgba(0,0,0,${Math.random() * 0.1})`;
          g.fillRect(x + 2 + Math.random() * 60, y + 2 + Math.random() * 12, 2, 1);
        }
      }
    }
  });
}
function stuccoTexture() {
  return canvasTexture(128, 128, (g) => {
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 36; i++) {
      g.fillStyle = `rgba(0,0,0,${Math.random() * 0.035})`;
      g.beginPath();
      g.ellipse(Math.random() * 128, Math.random() * 128, 10 + Math.random() * 24, 8 + Math.random() * 18, Math.random() * 3, 0, Math.PI * 2);
      g.fill();
    }
    for (let i = 0; i < 5200; i++) {
      const dark = Math.random() < 0.6;
      g.fillStyle = dark ? `rgba(0,0,0,${Math.random() * 0.1})` : `rgba(255,255,255,${Math.random() * 0.25})`;
      g.fillRect(Math.random() * 128, Math.random() * 128, 1 + Math.random(), 1 + Math.random());
    }
  });
}
function battenTexture() {
  return canvasTexture(64, 256, (g) => {
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, 64, 256);
    for (let i = 0; i < 70; i++) {
      g.fillStyle = `rgba(60,45,30,${0.02 + Math.random() * 0.04})`;
      g.fillRect(2 + Math.random() * 48, Math.random() * 256, 1, 20 + Math.random() * 120);
    }
    g.fillStyle = "rgba(0,0,0,0.2)";
    g.fillRect(50, 0, 3, 256);
    g.fillStyle = "rgba(0,0,0,0.05)";
    g.fillRect(53, 0, 9, 256);
    g.fillStyle = "rgba(255,255,255,0.3)";
    g.fillRect(53, 0, 1, 256);
    g.fillStyle = "rgba(0,0,0,0.12)";
    g.fillRect(62, 0, 2, 256);
  });
}
function stoneTexture() {
  return canvasTexture(256, 256, (g) => {
    g.fillStyle = "#dedbd3";
    g.fillRect(0, 0, 256, 256);
    const rows = [0, 44, 80, 128, 166, 212, 256];
    for (let r = 0; r + 1 < rows.length; r++) {
      const y = rows[r];
      const h = rows[r + 1] - y;
      let x = -Math.random() * 30;
      while (x < 256) {
        const w = 30 + Math.random() * 50;
        const tone = 0.04 + Math.random() * 0.18;
        g.fillStyle = `rgba(0,0,0,${tone})`;
        g.beginPath();
        g.roundRect(x + 2, y + 2, w - 4, h - 4, 4);
        g.fill();
        g.fillStyle = `rgba(255,255,255,${0.1 + Math.random() * 0.15})`;
        g.fillRect(x + 3, y + 3, w - 6, 2);
        g.fillStyle = "rgba(0,0,0,0.16)";
        g.fillRect(x + 3, y + h - 5, w - 6, 2);
        for (let k = 0; k < 24; k++) {
          g.fillStyle = `rgba(0,0,0,${Math.random() * 0.08})`;
          g.fillRect(x + 3 + Math.random() * (w - 6), y + 3 + Math.random() * (h - 6), 2, 1);
        }
        x += w;
      }
    }
  });
}

/**
 * Concrete as it is (owner, 2026-11-06: "more realistic concrete slab"): a warm grey with soft lighter and darker
 * blotches, the aggregate as fine specks, and — on a new pour — the broom finish's fine parallel lines; an old slab
 * is a shade darker, blotchier, with a hairline crack or two. 512 px to a 6-ft repeat (the slab's uv scale), the
 * blotches drawn four times so the tile's seam does not show.
 */
function concreteTexture(kind: "new" | "existing" = "new") {
  const S = 512;
  return canvasTexture(S, S, (g) => {
    g.fillStyle = kind === "existing" ? "#d6d3ca" : "#e6e3dc";
    g.fillRect(0, 0, S, S);
    for (let i = 0; i < (kind === "existing" ? 36 : 20); i++) {
      const x = Math.random() * S;
      const y = Math.random() * S;
      const r = 40 + Math.random() * 130;
      const dark = Math.random() < 0.6;
      const tint = dark ? `rgba(40,38,34,${0.05 + Math.random() * 0.07})` : `rgba(255,255,255,${0.05 + Math.random() * 0.07})`;
      for (const dx of [0, S, -S]) {
        for (const dy of [0, S, -S]) {
          const grd = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
          grd.addColorStop(0, tint);
          grd.addColorStop(1, "rgba(0,0,0,0)");
          g.fillStyle = grd;
          g.fillRect(x + dx - r, y + dy - r, 2 * r, 2 * r);
        }
      }
    }
    if (kind === "new") {
      for (let y = 0; y < S; y += 2) {
        g.fillStyle = `rgba(0,0,0,${0.02 + Math.random() * 0.045})`;
        g.fillRect(0, y + (Math.random() < 0.5 ? 0 : 1), S, 1);
      }
    }
    for (let i = 0; i < 9000; i++) {
      g.fillStyle = Math.random() < 0.8 ? `rgba(0,0,0,${Math.random() * 0.14})` : `rgba(255,255,255,${Math.random() * 0.2})`;
      const sz = Math.random() < 0.85 ? 1 : 2;
      g.fillRect(Math.random() * S, Math.random() * S, sz, sz);
    }
    if (kind === "existing") {
      g.strokeStyle = "rgba(30,28,25,0.38)";
      g.lineWidth = 1;
      for (let c = 0; c < 3; c++) {
        let x = Math.random() * S;
        let y = Math.random() * S * 0.5;
        g.beginPath();
        g.moveTo(x, y);
        for (let k = 0; k < 14; k++) {
          x += (Math.random() - 0.5) * 40;
          y += 10 + Math.random() * 22;
          g.lineTo(x, y);
        }
        g.stroke();
      }
    }
  });
}

/** A dimension's figure, or a callout's number, on a small white tag. */
function tagSprite(text: string, accent = false): { sprite: THREE.Sprite; dispose: () => void } {
  const c = document.createElement("canvas");
  const g = c.getContext("2d");
  const pad = 14;
  const font = "700 44px ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";
  let w = 160;
  if (g) {
    g.font = font;
    w = Math.max(72, Math.ceil(g.measureText(text).width) + pad * 2);
  }
  c.width = w;
  c.height = 72;
  if (g) {
    g.fillStyle = accent ? "#1854a0" : "#ffffff";
    if (accent) {
      g.beginPath();
      g.roundRect(2, 2, w - 4, 68, 34);
      g.fill();
    } else g.fillRect(0, 0, w, 72);
    g.strokeStyle = accent ? "#ffffff" : "#0f1419";
    g.lineWidth = 4;
    if (accent) {
      g.beginPath();
      g.roundRect(2, 2, w - 4, 68, 34);
      g.stroke();
    } else g.strokeRect(2, 2, w - 4, 68);
    g.font = font;
    g.fillStyle = accent ? "#ffffff" : "#0f1419";
    g.textBaseline = "middle";
    g.textAlign = "center";
    g.fillText(text, w / 2, 38);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.renderOrder = 10;
  sprite.userData.aspect = w / 72;
  return { sprite, dispose: () => { tex.dispose(); mat.dispose(); } };
}

const feetInches = (ft: number) => {
  const inches = Math.round(ft * 12);
  return `${Math.floor(inches / 12)}'-${inches % 12}"`;
};

interface Built {
  group: THREE.Group;
  /** Per layer: the instanced meshes, how many pieces each holds, and which box each instance is. */
  layers: Array<Array<{ mesh: THREE.InstancedMesh; total: number; boxIdx: number[] }>>;
  /** Per layer: the flat polygons as one geometry, with the index end of each and the poly index of each range. */
  polys: Array<{ mesh: THREE.Mesh; ends: number[]; polyIdx: number[] } | null>;
  /** Braces, drawn one mesh each. */
  braces: THREE.Mesh[];
  /** Members with real sawn geometry (mitred fascia, turned braces):
   *  shown with their layer's share of the build-up, like instances. */
  sawn: THREE.Mesh[];
  /** Boards cut to a shape: one geometry, a range of it per board. */
  diagonal: { mesh: THREE.Mesh; ends: number[] } | null;
  /** Each layer's step in this scene's build-up (−1 = not in the scene). */
  rank: number[];
  fade: THREE.Material[];
  lightMat: THREE.MeshStandardMaterial | null;
  pointLights: THREE.PointLight[];
  callouts: THREE.Sprite[];
  /** The edit handles, one mesh each, with the handle they stand for. */
  handles: THREE.Mesh[];
  /** Each accessory's unseen box, turned with it (2026-11-15): taken in the hand by a click, in Edit in 3D or not. */
  liveBoxes: THREE.Mesh[];
  /** The DOM knob over each handle (same order). */
  knobs: HTMLButtonElement[];
  /** Each knob's short name, and the dashed leader back to its handle when the knob is pushed off it (same order). */
  knobLabels: HTMLSpanElement[];
  leaders: SVGGElement[];
  /** The world-space centre and size of every box (for the fly-to). */
  centres: Array<[THREE.Vector3, number]>;
  /** The scene this was built from (a newer one may be waiting for its rebuild). */
  scene: DeckScene;
  dispose: () => void;
}

export function DeckModel3D({ scene, built = Number.POSITIVE_INFINITY, xray = false, night = false, connections = false, placing = false, className, label, resetToken = 0, onPick, focus = null, look = null, edit = false, onEdit, backdrop = null , highlight = null, viewControls = false, flyOnClick = true, hold = null }: DeckModel3DProps) {
  const mountRef = React.useRef<HTMLDivElement>(null);
  /** Where the view bar sits, read when the scene is set up (a host keeps one place). */
  const viewControlsRef = React.useRef(viewControls);
  const [supported] = React.useState(webglSupported);
  const sceneRef = React.useRef(scene);
  const backdropRef = React.useRef(backdrop);
  const builtRef = React.useRef(built);
  const xrayRef = React.useRef(xray);
  const nightRef = React.useRef(night);
  const connRef = React.useRef(connections);
  const placingRef = React.useRef(placing);
  const flyRef = React.useRef(flyOnClick);
  const editRef = React.useRef(edit);
  const pickRef = React.useRef(onPick);
  const editCbRef = React.useRef(onEdit);
  React.useEffect(() => {
    pickRef.current = onPick;
    editCbRef.current = onEdit;
  }, [onPick, onEdit]);
  /** Set by the mount effect: rebuild from the scene, re-apply what is standing, go back to the first view, fly somewhere. */
  const api = React.useRef<{ rebuild: () => void; rebuildSoon: () => void; apply: () => void; reset: () => void; flyTo: (p: [number, number, number], size?: number) => void; lookFrom: (from: DeckLook) => void; highlight: () => void; hold: (key: string) => void } | null>(null);

  React.useEffect(() => {
    if (resetToken) api.current?.reset();
  }, [resetToken]);
  // Rebuilt when the picture, its placement or a step changes — by value, so a parent's fresh object alone does not.
  const backdropKey = backdrop ? JSON.stringify(backdrop) : "";
  React.useEffect(() => {
    backdropRef.current = backdrop;
    api.current?.rebuildSoon();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key is the backdrop's value
  }, [backdropKey]);
  React.useEffect(() => {
    if (focus) api.current?.flyTo([focus[0], focus[1], focus[2]], focus[3] ?? 4);
  }, [focus]);
  // A new token moves the camera; the side rides with it.
  const lookToken = look?.token ?? 0;
  const lookSide = look?.from ?? null;
  React.useEffect(() => {
    if (lookToken && lookSide) api.current?.lookFrom(lookSide);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new token moves the camera; the side alone does not
  }, [lookToken]);
  // A new token takes that window, door or accessory in the hand.
  const holdToken = hold?.token ?? 0;
  const holdKey = hold ? `${hold.kind}:${hold.id}` : "";
  React.useEffect(() => {
    if (holdToken && holdKey) api.current?.hold(holdKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new token takes it; the same one is not taken twice
  }, [holdToken]);
  // The lit part follows its value, not the parent's fresh object.
  const highlightRef = React.useRef(highlight);
  const highlightKey = highlight ? JSON.stringify(highlight) : "";
  React.useEffect(() => {
    highlightRef.current = highlight;
    api.current?.highlight();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key is the highlight's value
  }, [highlightKey]);
  // A new scene rebuilds after the page has painted the change that made it (2026-10-18, perf): the field, the price
  // and the steps show at once, the 3D follows a frame later, and changes within one frame (a drag, fast clicks) build once.
  React.useEffect(() => {
    sceneRef.current = scene;
    api.current?.rebuildSoon();
  }, [scene]);
  React.useEffect(() => {
    builtRef.current = built;
    xrayRef.current = xray;
    nightRef.current = night;
    connRef.current = connections;
    placingRef.current = placing;
    flyRef.current = flyOnClick;
    editRef.current = edit;
    api.current?.apply();
  }, [built, xray, night, connections, placing, edit, flyOnClick]);

  React.useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !supported) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      return;
    }
    let coarse = false;
    try {
      coarse = window.matchMedia("(pointer: coarse)").matches;
    } catch {
      coarse = false;
    }
    const w0 = mount.clientWidth || 800;
    const h0 = mount.clientHeight || 480;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w0, h0, false);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // The sun stands still, so its shadow map changes only when what casts a shadow does (a rebuild, the build-up, a
    // refit): it is redrawn then, not on every frame of an orbit or of a lit field's breathing (2026-10-18, perf).
    renderer.shadowMap.autoUpdate = false;
    let shadowsDirty = true;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.9;
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.touchAction = "none";
    mount.appendChild(renderer.domElement);
    // The edit knobs (M3): DOM buttons that follow the handles across the screen — a thumb's size, focusable, with the arrow keys as a second way to move them.
    if (getComputedStyle(mount).position === "static") mount.style.position = "relative";
    // (owner, 2026-10-19: "the arrows look weird, it's not clear how they're used, they overflow each other") — each
    // knob now carries its arrow turned along the way it really moves on the screen, a short name beside it, and the
    // knobs are spread apart every frame so no two ever sit on each other (a dashed leader runs back to the point a
    // pushed-away knob stands for). A name that would land on another knob or name is left off; the hovered knob's always shows.
    const knobSize = coarse ? 38 : 30;
    const knobLayer = document.createElement("div");
    knobLayer.style.cssText = `position:absolute;inset:0;pointer-events:none;overflow:hidden;--dk:${knobSize}px`;
    knobLayer.dataset.deckKnobs = "";
    knobLayer.innerHTML = `<style>
[data-deck-knobs] .dk-knob{position:absolute;left:0;top:0;width:var(--dk);height:var(--dk);margin:calc(var(--dk) / -2) 0 0 calc(var(--dk) / -2);box-sizing:border-box;border-radius:50%;border:2px solid #fff;background:#1854a0;color:#fff;display:none;place-items:center;padding:0;box-shadow:0 0 0 1px rgba(10,34,70,.45),0 2px 6px rgba(0,0,0,.32);pointer-events:auto;touch-action:none;cursor:grab;transition:background-color .12s,box-shadow .12s,opacity .12s}
[data-deck-knobs] .dk-knob svg{width:62%;height:62%;display:block;pointer-events:none}
[data-deck-knobs] .dk-knob:hover,[data-deck-knobs] .dk-knob:focus-visible,[data-deck-knobs] .dk-knob[data-active]{background:#0d3a73;box-shadow:0 0 0 4px rgba(24,84,160,.32),0 2px 8px rgba(0,0,0,.38)}
[data-deck-knobs] .dk-knob:focus-visible{outline:2px solid #f5a623;outline-offset:3px}
[data-deck-knobs] .dk-knob[data-active]{cursor:grabbing}
[data-deck-knobs][data-dragging] .dk-knob:not([data-active]){opacity:.3}
[data-deck-knobs] .dk-label{position:absolute;left:0;top:0;display:none;box-sizing:border-box;height:20px;padding:0 7px;border-radius:10px;background:rgba(255,255,255,.95);color:#0f2747;font:700 11px/20px system-ui,-apple-system,"Segoe UI",sans-serif;white-space:nowrap;box-shadow:0 0 0 1px rgba(15,39,71,.18),0 1px 3px rgba(0,0,0,.2);pointer-events:none}
[data-deck-knobs] .dk-label[data-hot]{background:#1854a0;color:#fff;box-shadow:0 1px 4px rgba(0,0,0,.3)}
[data-deck-knobs] .dk-leaders{position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none}
[data-deck-knobs] .dk-leaders line{stroke:#1854a0;stroke-width:1.75;stroke-dasharray:3 3}
[data-deck-knobs] .dk-leaders circle{fill:#1854a0;stroke:#fff;stroke-width:1.5}
.dk-views{position:absolute;z-index:4;display:flex;gap:4px;pointer-events:auto}
.dk-views[data-at="top-right"]{top:10px;right:10px}
.dk-views[data-at="bottom-left"]{left:10px;bottom:10px}
.dk-views button{display:grid;place-items:center;min-width:34px;height:34px;padding:0 9px;border:1.5px solid #0f2747;border-radius:2px;background:rgba(255,255,255,.96);color:#0f2747;font:800 11px/1 system-ui,-apple-system,"Segoe UI",sans-serif;letter-spacing:.06em;text-transform:uppercase;cursor:pointer;transition:background-color .15s,color .15s}
.dk-views button:hover{background:#e8eef7}
.dk-views button[aria-pressed="true"]{background:#1854a0;border-color:#1854a0;color:#fff}
.dk-views button:focus-visible{outline:2px solid #f5a623;outline-offset:2px}
.dk-views svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
@media (pointer:coarse){.dk-views button{min-width:44px;height:44px;padding:0 9px}.dk-views button[data-view^="turn-"]{display:none}}
@media (prefers-reduced-motion:reduce){.dk-views button{transition:none}}
[data-deck-knobs] .dk-turn{position:absolute;left:0;top:0;width:calc(var(--dk) + 4px);height:calc(var(--dk) + 4px);margin:calc((var(--dk) + 4px) / -2) 0 0 calc((var(--dk) + 4px) / -2);box-sizing:border-box;border-radius:50%;border:2px solid #fff;background:#f5a623;color:#0f2747;display:none;place-items:center;padding:0;box-shadow:0 0 0 1px rgba(10,34,70,.45),0 2px 6px rgba(0,0,0,.32);pointer-events:auto;touch-action:none;cursor:grab}
[data-deck-knobs] .dk-turn svg{width:62%;height:62%;display:block;pointer-events:none}
[data-deck-knobs] .dk-turn:hover,[data-deck-knobs] .dk-turn[data-active]{background:#ffbf47;box-shadow:0 0 0 4px rgba(245,166,35,.35),0 2px 8px rgba(0,0,0,.38)}
[data-deck-knobs] .dk-turn[data-active]{cursor:grabbing}
[data-deck-knobs] .dk-turn:focus-visible{outline:2px solid #1854a0;outline-offset:3px}
[data-deck-knobs] .dk-live{position:absolute;left:10px;bottom:10px;display:none;align-items:center;gap:8px;max-width:min(560px,calc(100% - 150px));box-sizing:border-box;padding:7px 7px 7px 12px;border-radius:2px;background:rgba(15,39,71,.95);color:#fff;font:600 12.5px/1.35 system-ui,-apple-system,"Segoe UI",sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.3);pointer-events:auto}
[data-deck-knobs] .dk-live span{min-width:0}
[data-deck-knobs] .dk-live b{font-weight:800}
[data-deck-knobs] .dk-live button{flex:none;height:32px;padding:0 14px;border:0;border-radius:2px;background:#fff;color:#0f2747;font:800 12px/1 system-ui,-apple-system,"Segoe UI",sans-serif;letter-spacing:.06em;text-transform:uppercase;cursor:pointer}
[data-deck-knobs] .dk-live{flex-wrap:wrap}
[data-deck-knobs] .dk-choices{display:none;flex-wrap:wrap;gap:4px;flex:1 1 100%}
[data-deck-knobs] .dk-live .dk-choices button{height:28px;padding:0 9px;background:transparent;color:#fff;box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.55);text-transform:none;letter-spacing:0;font-weight:700}
[data-deck-knobs] .dk-live .dk-choices button[aria-pressed="true"]{background:#f5a623;color:#0f2747;box-shadow:none}
[data-deck-knobs] .dk-live button[data-deck-live-remove]{background:transparent;color:#ffd0c8;box-shadow:inset 0 0 0 1.5px rgba(255,160,140,.8);padding:0 10px}
[data-deck-knobs] .dk-size{position:absolute;left:0;top:0;width:var(--dk);height:var(--dk);margin:calc(var(--dk) / -2) 0 0 calc(var(--dk) / -2);box-sizing:border-box;border-radius:50%;border:2px solid #fff;background:#f5a623;color:#0f2747;display:none;place-items:center;padding:0;box-shadow:0 0 0 1px rgba(10,34,70,.45),0 2px 6px rgba(0,0,0,.32);pointer-events:auto;touch-action:none}
[data-deck-knobs] .dk-size[data-deck-size="w"]{cursor:ew-resize}
[data-deck-knobs] .dk-size[data-deck-size="h"]{cursor:ns-resize}
[data-deck-knobs] .dk-size svg{width:62%;height:62%;display:block;pointer-events:none}
[data-deck-knobs] .dk-size:hover,[data-deck-knobs] .dk-size[data-active]{background:#ffbf47;box-shadow:0 0 0 4px rgba(245,166,35,.35),0 2px 8px rgba(0,0,0,.38)}
[data-deck-knobs] .dk-size:focus-visible{outline:2px solid #1854a0;outline-offset:3px}
@media (pointer:coarse){[data-deck-knobs] .dk-live .dk-choices button{height:38px}}
[data-deck-knobs] .dk-live button[data-deck-live-more]{background:transparent;color:#fff;box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.7);padding:0 10px}
[data-deck-knobs] .dk-live button:focus-visible{outline:2px solid #f5a623;outline-offset:2px}
@media (pointer:coarse){[data-deck-knobs] .dk-live button{height:44px}}
</style><svg class="dk-leaders" aria-hidden="true"></svg>`;
    const leaderLayer = knobLayer.querySelector("svg") as SVGSVGElement;
    // The accessory in the hand: its round turn handle, and the bar that names it with Done (2026-11-15).
    const turnKnob = document.createElement("button");
    turnKnob.type = "button";
    turnKnob.className = "dk-turn";
    turnKnob.dataset.deckTurn = "";
    turnKnob.setAttribute("aria-label", "Turn it — drag round, or press the arrow keys");
    turnKnob.title = "Drag round to turn it";
    turnKnob.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v4.5h-4.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    knobLayer.appendChild(turnKnob);
    const liveBar = document.createElement("div");
    liveBar.className = "dk-live";
    liveBar.dataset.deckLiveBar = "";
    liveBar.setAttribute("role", "status");
    const liveText = document.createElement("span");
    const liveMore = document.createElement("button");
    liveMore.type = "button";
    liveMore.textContent = "Options";
    liveMore.title = "Its boards, or remove it";
    liveMore.dataset.deckLiveMore = "";
    const liveDone = document.createElement("button");
    liveDone.type = "button";
    liveDone.textContent = "Done";
    liveDone.dataset.deckLiveDone = "";
    // A window or a door in the hand (2026-11-15): what it can be swapped for, Remove — and a handle on its side and
    // one on its top that size it.
    const liveChoices = document.createElement("div");
    liveChoices.className = "dk-choices";
    liveChoices.dataset.deckLiveChoices = "";
    const liveRemove = document.createElement("button");
    liveRemove.type = "button";
    liveRemove.textContent = "Remove";
    liveRemove.dataset.deckLiveRemove = "";
    liveRemove.style.display = "none";
    liveBar.append(liveText, liveMore, liveRemove, liveDone, liveChoices);
    knobLayer.appendChild(liveBar);
    const sizeKnob = (which: "w" | "h") => {
      const k = document.createElement("button");
      k.type = "button";
      k.className = "dk-size";
      k.dataset.deckSize = which;
      k.setAttribute("aria-label", which === "w" ? "Its width — drag, or press the left and right arrow keys" : "Its height — drag, or press the up and down arrow keys");
      k.title = which === "w" ? "Drag to make it wider or narrower" : "Drag to make it taller or shorter";
      k.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" style="transform:rotate(${which === "w" ? 0 : 90}deg)"><path d="M4 12h16M8 7.5 3.5 12 8 16.5M16 7.5l4.5 4.5-4.5 4.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      knobLayer.appendChild(k);
      return k;
    };
    const sizeW = sizeKnob("w");
    const sizeH = sizeKnob("h");
    mount.appendChild(knobLayer);
    // The canvas is the picture; with a view bar beside it the box is a group, so the buttons are read too.
    if (viewControlsRef.current) {
      renderer.domElement.setAttribute("role", "img");
      renderer.domElement.setAttribute("aria-label", mount.getAttribute("aria-label") ?? "The deck in 3D");
    }

    const world = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, w0 / h0, 0.1, 4000);

    // Sky and light: a warm sun over the yard by day; by night the sun goes under and the fixtures take over.
    const sunDay = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(52), THREE.MathUtils.degToRad(140));
    const sunNight = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(93), THREE.MathUtils.degToRad(140));
    const tuneSky = (s: Sky, nightTime: boolean) => {
      const u = (s.material as THREE.ShaderMaterial).uniforms;
      u.sunPosition.value.copy(nightTime ? sunNight : sunDay);
      u.turbidity.value = nightTime ? 2 : 5;
      u.rayleigh.value = nightTime ? 0.2 : 1.3;
      u.mieCoefficient.value = 0.005;
      u.mieDirectionalG.value = 0.8;
    };
    const sky = new Sky();
    sky.scale.setScalar(3000);
    tuneSky(sky, false);
    world.add(sky);
    const hemi = new THREE.HemisphereLight(0xcfe0ff, 0x8a8468, 0.75);
    world.add(hemi);
    const key = new THREE.DirectionalLight(0xfff4e6, 2.3);
    key.castShadow = true;
    key.shadow.mapSize.set(coarse ? 1024 : 2048, coarse ? 1024 : 2048);
    key.shadow.bias = -0.0004;
    world.add(key);
    world.add(key.target);
    let envTex: THREE.Texture | null = null;
    try {
      const pmrem = new THREE.PMREMGenerator(renderer);
      const envScene = new THREE.Scene();
      const envSky = new Sky();
      envSky.scale.setScalar(3000);
      tuneSky(envSky, false);
      envScene.add(envSky);
      envTex = pmrem.fromScene(envScene).texture;
      world.environment = envTex;
      world.environmentIntensity = 0.45;
      envSky.geometry.dispose();
      (envSky.material as THREE.Material).dispose();
      pmrem.dispose();
    } catch {
      /* the environment is optional */
    }

    const grass = grassTexture();
    const groundGeo = new THREE.PlaneGeometry(1, 1);
    const groundMat = new THREE.MeshStandardMaterial({ color: GRASS, roughness: 1, metalness: 0, transparent: true, opacity: 1, map: grass });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    world.add(ground);

    // THE YARD AROUND IT (owner, 2026-10-22, beside another studio's: "see if our 3D is better"): a haze that melts the
    // lawn's far edge into the sky, low hills on the horizon and a ring of trees behind and beside the house — far enough
    // out never to stand between the yard's view and the deck. Placed by the deck's size and the lawn's tilt (frame,
    // tiltGround); left out where a photo of the house stands in for it.
    const HAZE_DAY = new THREE.Color(0xdbe5ec);
    const HAZE_NIGHT = new THREE.Color(0x121a27);
    world.fog = new THREE.Fog(HAZE_DAY.getHex(), 60, 400);
    const scenery = new THREE.Group();
    world.add(scenery);
    const TREE_COUNT = coarse ? 12 : 22;
    const trunkGeo = new THREE.CylinderGeometry(0.28, 0.42, 1, 7);
    const crownGeo = new THREE.IcosahedronGeometry(1, coarse ? 0 : 1);
    const hillGeo = new THREE.SphereGeometry(1, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b5139, roughness: 1 });
    const crownMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true });
    const hillMat = new THREE.MeshStandardMaterial({ color: 0x8c9a72, roughness: 1 });
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, TREE_COUNT);
    const crowns = new THREE.InstancedMesh(crownGeo, crownMat, TREE_COUNT * 2);
    const hills = new THREE.InstancedMesh(hillGeo, hillMat, 7);
    for (const m of [trunks, crowns, hills]) {
      m.frustumCulled = false;
      scenery.add(m);
    }
    const CROWN_GREENS = [0x4f7a3a, 0x5b8743, 0x3f6b33, 0x6a8f49, 0x56803e].map((c) => new THREE.Color(c));
    /** The lawn's height at a point (the same plane tiltGround lays). */
    let groundAt: (x: number, z: number) => number = () => 0;
    const placeScenery = (span: number) => {
      // A fixed sequence, so the trees stand in the same places every time.
      let seed = 7;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
      const m4 = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const sc = new THREE.Vector3();
      const pos = new THREE.Vector3();
      for (let i = 0; i < TREE_COUNT; i++) {
        // Behind the house and to the sides (from straight behind to 115° round each way); a few far out front.
        const front = i % 7 === 6;
        const a = front ? Math.PI + (rnd() - 0.5) * 1.6 : (rnd() - 0.5) * 2 * 2.0;
        const r = front ? span * (4.6 + rnd() * 1.6) : span * (2.0 + rnd() * 1.9);
        const x = Math.sin(a) * r;
        const z = -Math.cos(a) * r;
        const h = 7 + rnd() * 5;
        const cr = 4.2 + rnd() * 3.2;
        const y0 = groundAt(x, z) - 0.3;
        m4.compose(pos.set(x, y0 + h / 2, z), q.identity(), sc.set(1 + h * 0.04, h, 1 + h * 0.04));
        trunks.setMatrixAt(i, m4);
        m4.compose(pos.set(x, y0 + h + cr * 0.55, z), q.identity(), sc.set(cr, cr * 0.95, cr));
        crowns.setMatrixAt(i * 2, m4);
        crowns.setColorAt(i * 2, CROWN_GREENS[i % CROWN_GREENS.length]);
        const cr2 = cr * (0.55 + rnd() * 0.2);
        m4.compose(pos.set(x + (rnd() - 0.5) * cr, y0 + h + cr * 1.25, z + (rnd() - 0.5) * cr), q.identity(), sc.set(cr2, cr2, cr2));
        crowns.setMatrixAt(i * 2 + 1, m4);
        crowns.setColorAt(i * 2 + 1, CROWN_GREENS[(i + 2) % CROWN_GREENS.length]);
      }
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2 + rnd() * 0.5;
        const r = span * (7.5 + rnd() * 2.5);
        const wide = span * (2.6 + rnd() * 1.8);
        m4.compose(pos.set(Math.sin(a) * r, groundAt(Math.sin(a) * r, -Math.cos(a) * r) - span * 0.05, -Math.cos(a) * r), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), a), sc.set(wide, span * (0.22 + rnd() * 0.25), wide * 0.6));
        hills.setMatrixAt(i, m4);
      }
      trunks.instanceMatrix.needsUpdate = true;
      crowns.instanceMatrix.needsUpdate = true;
      if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
      hills.instanceMatrix.needsUpdate = true;
    };
    let sceneSpan = 20;
    /** The house is out of the picture while the camera is under the lawn. */
    let houseHidden = false;

    // THE VIEW BAR (2026-10-22): the camera's moves on the scene itself, for every pointer and keyboard.
    let viewBar: HTMLDivElement | null = null;
    const viewAt = viewControlsRef.current;
    if (viewAt) {
      viewBar = document.createElement("div");
      viewBar.className = "dk-views";
      viewBar.dataset.at = viewAt;
      viewBar.setAttribute("role", "toolbar");
      viewBar.setAttribute("aria-label", "Camera");
      viewBar.dataset.deckViews = "";
      const turnL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4.5h4.5"/></svg>';
      const turnR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v4.5h-4.5"/></svg>';
      const views: Array<[DeckLook, string, string]> = [
        ["turn-left", turnL, "Turn left"],
        ["out", "−", "Zoom out"],
        ["top", "Top", "From above"],
        ["under", "Under", "From underneath"],
        ["yard", "3D", "From the yard"],
        ["in", "+", "Zoom in"],
        ["turn-right", turnR, "Turn right"],
      ];
      for (const [from, face, name] of views) {
        const b = document.createElement("button");
        b.type = "button";
        b.innerHTML = face;
        b.setAttribute("aria-label", name);
        b.title = name;
        b.dataset.view = from;
        if (from === "top" || from === "under" || from === "yard") b.setAttribute("aria-pressed", from === "yard" ? "true" : "false");
        b.addEventListener("click", () => api.current?.lookFrom(from));
        viewBar.appendChild(b);
      }
      mount.appendChild(viewBar);
    }
    /** The bar's Top / Under / 3D: the one the camera stands at is pressed. */
    const markView = (at: "top" | "under" | "yard" | null) => {
      viewBar?.querySelectorAll<HTMLButtonElement>("button[aria-pressed]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.view === at ? "true" : "false"));
    };
    /** Under the ground (Under): the orbit may go below it; any other view brings the camera back up. */
    const setBelow = (on: boolean) => {
      orbit.maxPolarAngle = on ? Math.PI * 0.97 : Math.PI * 0.495;
    };

    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = true;
    orbit.dampingFactor = 0.08;
    orbit.maxPolarAngle = Math.PI * 0.495;
    orbit.minDistance = 1.2;

    const unitBox = new THREE.BoxGeometry(1, 1, 1);
    const unitCyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 24);
    // A bolt's head and a nut are six-sided (2026-11-06): a hex prism in the box's place — its axis along the box's
    // depth for a head on a ledger's face, upright for an anchor's nut on a base plate.
    const unitHexZ = new THREE.CylinderGeometry(0.5, 0.5, 1, 6).rotateX(Math.PI / 2);
    const unitHexY = new THREE.CylinderGeometry(0.5, 0.5, 1, 6);
    const siding = sidingTexture();
    const grain = grainTexture();
    const shingles = shingleTexture();
    const ribs = ribTexture();
    const concrete = concreteTexture("new");
    const concreteOld = concreteTexture("existing");
    const cladding: Record<string, THREE.CanvasTexture> = { brick: brickTexture(), stucco: stuccoTexture(), "board-batten": battenTexture(), stone: stoneTexture() };
    let dirty = true;
    let requestFrame = () => {};
    const invalidate = () => { dirty = true; requestFrame(); };
    let content: Built | null = null;
    // A handle drag: the pointer's movement along the handle's axis, read on a plane through the handle; `last` is the value last sent.
    let drag: { handle: SceneHandle; plane: THREE.Plane; start: THREE.Vector3; last: number; last2?: number } | null = null;
    // A post or a beam the pointer went down on (SceneHandle.grab), not yet pulled: a pull moves it, letting go is a click.
    let grabDown: { mesh: THREE.Mesh; x: number; y: number } | null = null;
    // THE ACCESSORY IN THE HAND (2026-11-15 — the owner: "if I click on the accessory, everything gets frozen, and I just
    // drag it on the deck wherever I want it… when I unclick, everything starts working again"; no Turn buttons): its id
    // while it is held. The camera stands still; it is outlined, with a round turn handle on a ring round it; a press on
    // the deck moves it there and it follows the pointer; a click off the deck, Done or Esc lets it go.
    // (A WINDOW OR A DOOR too, 2026-11-15 — "double click on the window and move it anywhere I want it": named by its
    // kind and id, "builtin:b1" or "opening:w3". It is dragged along the wall and up it, sized by a handle on its side
    // and one on its top, swapped from the bar; a press on the wall sends it there.)
    let live: string | null = null;
    let sizing: { which: "w" | "h"; last: number } | null = null;
    // Pressed on an accessory, not yet pulled: a pull drags it at once; letting go leaves it in the hand. (No card opens
    // on that click: a card under the picture would re-size it, and the accessory would slip from under the pointer —
    // its card, with its boards and Remove, opens from Options on the bar.)
    let liveDown: { mesh: THREE.Mesh; x: number; y: number } | null = null;
    // Its round handle held: the turn the pointer gives now, and the one last sent (degrees).
    let turning: { id: string; angle: number; last: number } | null = null;
    // Set further down, once the picking is: outline the accessory in the hand after a rebuild (or let it go when it is gone).
    let showLive = () => {};
    // One the host asked to be taken in the hand (the `hold` prop): taken as soon as the picture shows it.
    let pendingHold: string | null = null;
    let tryHold = () => {};
    // THE GRABBED EDGE STAYS UNDER THE POINTER (owner, 2026-10-18). The scene stands on the deck's centre, so a wider
    // deck used to slide the house one way and the knob the other: the knob fell behind the pointer and the size ran
    // ahead of the hand. While a knob is held the origin is pinned where the drag began, so only the grabbed edge
    // moves — by exactly the drag; the rebuild after letting go re-centres (and re-frames) as before.
    let pinned: { ox: number; oz: number } | null = null;
    // (The deck's LEFT end, 2026-11-14: the scene is measured from that end, so while it is pulled the pinned origin
    // goes with it by as much as the deck has grown — the house stays where it was and the end stays under the hand.)
    const origin = (s: { widthFt: number; depthFt: number }) => (pinned ? { ox: pinned.ox + (drag && drag.handle.kind === "width-left" ? s.widthFt - drag.handle.value : 0), oz: pinned.oz } : { ox: s.widthFt / 2, oz: s.depthFt / 2 });
    // The knob that had the keyboard, so a rebuild hands it back.
    let focusedKnob: string | null = null;
    // The knob under the pointer, focused or held: its name shows first, with its size, in blue.
    let hotKnob: string | null = null;
    const textRuler = document.createElement("canvas").getContext("2d");
    const setKnobLabel = (tag: HTMLSpanElement, h: SceneHandle, hot: boolean) => {
      const sized = h.kind === "width" || h.kind === "width-left" || h.kind === "depth" || h.kind === "bow" || h.kind === "height" || h.kind === "eave" || h.kind === "pitch" || h.kind === "roof-width" || h.kind === "roof-depth" || h.kind === "lower-depth" || h.kind === "stair-width";
      const now = h.kind === "pitch" ? `${Math.round(h.value)}:12` : h.kind === "bow" ? `${Math.round(h.value * 4) / 4} ft` : h.perUnit === 1 ? `${Math.round(h.value * 2) / 2} ft` : `${Math.round(h.value)} in`;
      tag.textContent = hot && sized ? `${KNOB_NAME[h.kind]} · ${now}` : KNOB_NAME[h.kind];
      if (hot) tag.dataset.hot = "";
      else delete tag.dataset.hot;
      if (textRuler) textRuler.font = `700 11px system-ui, -apple-system, "Segoe UI", sans-serif`;
      tag.dataset.w = String(Math.ceil((textRuler?.measureText(tag.textContent).width ?? tag.textContent.length * 6.5) + 16));
    };
    const setHotKnob = (key: string | null) => {
      if (hotKnob === key) return;
      hotKnob = key;
      if (content) content.handles.forEach((m, i) => {
        const h = m.userData.handle as SceneHandle;
        const tag = content!.knobLabels[i];
        if (tag) setKnobLabel(tag, h, `${h.kind}:${h.id}` === key);
      });
      invalidate();
    };
    const setDragging = (key: string | null) => {
      if (key) knobLayer.dataset.dragging = "";
      else delete knobLayer.dataset.dragging;
      content?.knobs.forEach((k) => {
        if (key && `${k.dataset.deckHandle}:${k.dataset.deckHandleId}` === key) k.dataset.active = "";
        else delete k.dataset.active;
      });
      if (key) setHotKnob(key);
    };
    let span = 20;
    let fitted: { w: number; d: number; h: number } | null = null;

    // The photo of the house as a texture, loaded once per link; a failed load leaves the wall plain.
    const textures = new Map<string, THREE.Texture>();
    const photoMats: THREE.MeshBasicMaterial[] = [];
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");
    const photoLoads = new Map<string, Array<(img: HTMLImageElement) => void>>();
    const photoTexture = (href: string, onImage?: (img: HTMLImageElement) => void): THREE.Texture => {
      const hit = textures.get(href);
      if (hit) {
        if (onImage) {
          const img = hit.image as HTMLImageElement | undefined;
          if (img && img.complete && img.naturalWidth > 0) onImage(img);
          else photoLoads.get(href)?.push(onImage);
        }
        return hit;
      }
      photoLoads.set(href, onImage ? [onImage] : []);
      mount.dataset.deck3dBackdrop = "loading";
      const tex = loader.load(
        href,
        (t) => {
          mount.dataset.deck3dBackdrop = "loaded";
          const img = t.image as HTMLImageElement | undefined;
          const cbs = photoLoads.get(href) ?? [];
          photoLoads.delete(href);
          if (img) for (const cb of cbs) cb(img);
          invalidate();
        },
        undefined,
        () => {
          mount.dataset.deck3dBackdrop = "failed";
          photoLoads.delete(href);
          for (const m of photoMats) {
            if (m.map === tex) {
              m.map = null;
              m.color.set(SIDING);
              m.needsUpdate = true;
            }
          }
          invalidate();
        },
      );
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      textures.set(href, tex);
      return tex;
    };

    /** The camera's first view for this deck, or the same angle refitted to a new size. */
    const frame = (reset: boolean) => {
      const s = sceneRef.current;
      // The house behind the deck is part of the picture (2026-10-11): the first view stands back far enough for its eave.
      const peak = Math.max(s.heightFt, s.peakFt ?? s.heightFt, s.house && !backdropRef.current ? s.house.heightFt : 0);
      const next = Math.max(s.widthFt, s.depthFt, peak * 1.4, 10);
      const target = new THREE.Vector3(0, Math.max(1, peak * 0.45), 0);
      const narrow = Math.max(1, 1.4 / Math.max(0.3, camera.aspect));
      if (reset || !fitted) {
        setBelow(false);
        markView("yard");
        camera.position.set(target.x + next * 0.9 * narrow, target.y + (next * 0.5 + peak * 0.3) * narrow, target.z + next * 1.2 * narrow);
      } else {
        const offset = camera.position.clone().sub(orbit.target).multiplyScalar(next / span);
        camera.position.copy(target).add(offset);
      }
      span = next;
      orbit.target.copy(target);
      orbit.maxDistance = span * 6;
      camera.near = Math.max(0.05, span / 600);
      camera.far = span * 60 + 4000;
      camera.updateProjectionMatrix();
      // The lawn runs far past the haze (its edge span × 20 out), so no edge ever shows against the sky.
      ground.scale.set(span * 40, span * 40, 1);
      grass.repeat.set(span * 4, span * 4);
      // The haze: clear over the yard, the hills soft through it, gone by span × 12.
      const fog = world.fog as THREE.Fog;
      fog.near = span * 3.5;
      fog.far = span * 12;
      sceneSpan = span;
      placeScenery(span);
      key.position.set(span * 0.9, span * 1.6 + peak, span * 0.75);
      key.target.position.set(0, 0, 0);
      const sc = key.shadow.camera as THREE.OrthographicCamera;
      sc.left = -span * 1.5;
      sc.right = span * 1.5;
      sc.top = span * 1.5;
      sc.bottom = -span * 1.5;
      sc.near = 0.1;
      sc.far = span * 6 + peak * 4;
      sc.updateProjectionMatrix();
      key.shadow.normalBias = span * 0.0012;
      fitted = { w: s.widthFt, d: s.depthFt, h: peak };
      orbit.update();
      invalidate();
      shadowsDirty = true;
    };

    /** The ground's tilt: the lawn falls away from the house (and across) as the site says. */
    const tiltGround = () => {
      const s = sceneRef.current;
      const g = s.ground;
      const { ox, oz } = origin(s);
      const outPerFt = g ? g.outDropFt / Math.max(1, s.depthFt) : 0;
      const acrossPerFt = g ? g.acrossDropFt / Math.max(1, s.widthFt) : 0;
      // The plane z = −out·y − across·x in scene feet, zero at the house line's left corner.
      const n = new THREE.Vector3(acrossPerFt, 1, outPerFt).normalize();
      ground.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
      ground.position.set(0, -(outPerFt * oz + acrossPerFt * ox), 0);
      const y0 = -(outPerFt * oz + acrossPerFt * ox);
      groundAt = (x: number, z: number) => y0 - acrossPerFt * x - outPerFt * z;
      placeScenery(sceneSpan);
    };

    const build = (): Built => {
      const s = sceneRef.current;
      const group = new THREE.Group();
      const { ox, oz } = origin(s);
      const owned: Array<{ dispose: () => void }> = [];
      const fade: THREE.Material[] = [];
      const centres: Array<[THREE.Vector3, number]> = [];
      const frameColor = new THREE.Color(s.colors.frame);
      // A roof over an OC (black composite) frame is sawn wood: its own colour (2026-11-12).
      const roofFrameColor = s.colors.roofFrame ? new THREE.Color(s.colors.roofFrame) : frameColor;
      const deckColor = new THREE.Color(s.colors.decking);
      const deckColor2 = s.colors.decking2 ? new THREE.Color(s.colors.decking2) : null;
      // A picture-frame border in a second colour of the line (2026-11-10).
      const borderColor = s.colors.border ? new THREE.Color(s.colors.border) : null;
      const borderColor2 = s.colors.border2 ? new THREE.Color(s.colors.border2) : null;
      const borderRings = new Set(s.diagonal?.border ?? []);
      // BOARDS OF THEIR OWN (2026-11-14; lib/deck/finish): a stair's treads and risers, a built-in's boards, in the line
      // and colour picked for them — each board still a touch lighter or darker than the next, as the deck's are.
      const paintBox = new Map<number, { c: THREE.Color; c2: THREE.Color | null }>();
      const paintRing = new Map<number, { c: THREE.Color; c2: THREE.Color | null }>();
      for (const pt of s.paints ?? []) {
        const look = { c: new THREE.Color(pt.hex), c2: pt.hex2 ? new THREE.Color(pt.hex2) : null };
        for (const i of pt.boxes) paintBox.set(i, look);
        for (const i of pt.rings) paintRing.set(i, look);
      }
      /** A box's colour when it is a board of its own: the deck's boards streaked, a riser or an apron a shade under. */
      const ownPaint = (bi: number, L: number): THREE.Color | null => {
        const own = paintBox.get(bi);
        if (!own) return null;
        if (L === DECKING) return streaked(own.c, own.c2, boardSeed.get(bi) ?? bi + L * 97, 0.045);
        return jitter(tone(own.c, L === FASCIA ? -0.05 : -0.02), bi + L * 97, 0.03);
      };
      const roofColor = new THREE.Color(s.colors.roofing ?? "#565250");
      const railColor = new THREE.Color(s.colors.rail ?? s.colors.frame);
      const metalRoof = s.colors.roofing === "#6f7478" || s.colors.roofing === "#3f4a55";
      const tone = (c: THREE.Color, by: number) => jitter(c, 1, 0).offsetHSL(0, 0, by);
      const baseOf = (name: SceneLayer): THREE.Color => {
        switch (name) {
          case "decking":
            return deckColor;
          case "fascia":
            return tone(deckColor, -0.05);
          case "footing":
          case "slab":
            return new THREE.Color(CONCRETE);
          case "beam":
            return tone(frameColor, -0.05);
          case "header":
            return tone(roofFrameColor, -0.05);
          case "post":
            return tone(frameColor, -0.08);
          case "roof-post":
            return tone(roofFrameColor, -0.08);
          case "ridge":
            return tone(roofFrameColor, -0.03);
          case "rafter":
            return roofFrameColor;
          case "stair":
            return tone(deckColor, -0.02);
          case "rail":
            return railColor;
          case "glass":
            return new THREE.Color(0xbfe0ef);
          case "screen":
            return new THREE.Color(0x30343a);
          case "spa":
            return new THREE.Color(0x4c4a45);
          case "wall":
            return new THREE.Color(SIDING);
          case "hardware":
            return new THREE.Color(GALV);
          case "light":
            return new THREE.Color(LIGHT_C);
          case "wire":
            return new THREE.Color(WIRE_C);
          case "sheathing":
            return new THREE.Color(OSB);
          case "roofing":
            return roofColor;
          case "trim":
            return new THREE.Color(TRIM_WHITE);
          case "gutter":
            return new THREE.Color(ALUMINUM);
          case "ceiling":
            return new THREE.Color(CEILING_WOOD);
          default:
            return frameColor;
        }
      };
      const woodLayer = (i: number) => i !== FOOTING && i !== SLAB && i !== HARDWARE && i !== LIGHT && i !== WIRE && i !== GLASS && i !== SCREEN && i !== WALL && i !== GUTTER && i !== TRIM && i !== SHEATHING && i !== ROOFING && i !== CEILING;
      let lightMat: THREE.MeshStandardMaterial | null = null;
      const mats: THREE.MeshStandardMaterial[] = SCENE_LAYERS.map((name, i) => {
        const base = baseOf(name);
        const tinted = i !== FOOTING && i !== SLAB;
        const m = new THREE.MeshStandardMaterial({
          color: tinted ? 0xffffff : base,
          roughness: i === DECKING ? 0.72 : i === GUTTER ? 0.5 : i === HARDWARE ? 0.45 : i === ROOFING ? 0.85 : i === GLASS ? 0.1 : i === LIGHT ? 0.4 : 0.9,
          metalness: i === GUTTER ? 0.4 : i === HARDWARE ? 0.65 : i === GLASS ? 0.2 : 0,
          envMapIntensity: i === HARDWARE ? 1.6 : i === GUTTER ? 1.2 : 1,
          map: woodLayer(i) ? grain : i === FOOTING || i === SLAB ? concrete : null,
          transparent: i === GLASS || i === SCREEN,
          opacity: i === GLASS ? 0.35 : i === SCREEN ? 0.55 : 1,
          side: i === GLASS || i === SCREEN ? THREE.DoubleSide : THREE.FrontSide,
        });
        if (i === LIGHT) {
          m.emissive = new THREE.Color(0xffe2b0);
          m.emissiveIntensity = 0.15;
          lightMat = m;
        }
        m.userData.base = base;
        owned.push(m);
        if (FADES.has(i)) fade.push(m);
        return m;
      });

      const order = sceneBuildLayers(s);
      const rank = SCENE_LAYERS.map((name) => order.indexOf(name));
      const legendOf = (i: number): SceneLegend | null => (s.tags.length === s.boxes.length && s.tags[i] >= 0 ? s.legend[s.tags[i]] ?? null : null);

      // EVERY BOARD'S SHADE GOES WITH ITS PLACE (owner, 2026-11-14: "when moving the deck, reshaping and cutting the
      // corners, the decking on the 3D gets discoloured… keep the decking material steady in colour"). It went with the
      // board's number in this list — which changes whenever anything before it does (a joist more, a post moved, a
      // corner cut) — so every change dealt the floor a new hand of shades. Now: its row and which board of that row it
      // is (lib/deck/boardTone), the square boards and the cut ones worked out together.
      const deckBoxes: number[] = [];
      s.boxes.forEach((b, i) => {
        if (b[0] === DECKING) deckBoxes.push(i);
      });
      const cutBoards = (s.diagonal?.boards ?? []).map((ring, i) => ringPlace(ring, s.diagonal?.zs?.[i] ?? s.heightFt));
      const floorSeeds = placeSeeds([...deckBoxes.map((i) => boxPlace(s.boxes[i][1], s.boxes[i][2], s.boxes[i][4], s.boxes[i][5], s.boxes[i][3])), ...cutBoards.map((c) => c.place)]);
      const boardSeed = new Map<number, number>(deckBoxes.map((i, k) => [i, floorSeeds[k]]));
      const cutSeeds = floorSeeds.slice(deckBoxes.length);
      const layers: Built["layers"] = SCENE_LAYERS.map(() => []);
      const braces: THREE.Mesh[] = [];
      const m4 = new THREE.Matrix4();
      // The wiring is priced and listed, never drawn: a cable hanging through the frame reads as a mistake, not a feature
      // (owner, 2026-10-10: "don't show those wires — show the features and price it out").
      mount.dataset.deck3dWires = s.boxes.some((b) => b[0] === WIRE) ? "hidden" : "none";
      for (let L = 0; L < LAYER_COUNT; L++) {
        if (L === FOOTING || L === WIRE) continue;
        const idx: number[] = [];
        s.boxes.forEach((b, i) => {
          if (b[0] === L && b[7] === 0 && !memberIsSawn(b, legendOf(i)?.role ?? null)) idx.push(i);
        });
        // The stairs: the treads and risers on a material of their own that the x-ray fades, the framing on the layer's.
        // The hardware: bolt heads, nuts and screws as hex prisms, the rest as plates. The slab: its control joints as
        // dark grooves on a material of their own.
        const groups: Array<{ idx: number[]; mat: THREE.MeshStandardMaterial; geo?: THREE.BufferGeometry }> = [];
        if (L === STAIR && idx.some((bi) => STAIR_SKIN.test(legendOf(bi)?.role ?? ""))) {
          const skinMat = mats[L].clone();
          skinMat.userData.base = mats[L].userData.base;
          owned.push(skinMat);
          fade.push(skinMat);
          const skin = idx.filter((bi) => STAIR_SKIN.test(legendOf(bi)?.role ?? ""));
          const rest = idx.filter((bi) => !STAIR_SKIN.test(legendOf(bi)?.role ?? ""));
          if (rest.length) groups.push({ idx: rest, mat: mats[L] });
          groups.push({ idx: skin, mat: skinMat });
        } else if (L === RAIL && (s.colors.railInfill || s.colors.railCap) && idx.some((bi) => RAIL_INFILL_ROLE.test(legendOf(bi)?.role ?? "") || RAIL_CAP_ROLE.test(legendOf(bi)?.role ?? ""))) {
          // THE INFILL IN ITS OWN COLOUR (2026-11-09): stainless cable, black metal balusters or a wire mesh in a rail of
          // another colour — smooth metal, no wood grain. A DECK BOARD ON TOP (2026-11-10): a kit rail's drink rail is
          // the deck's own board, in the deck's colour.
          const isInfill = (bi: number) => !!s.colors.railInfill && RAIL_INFILL_ROLE.test(legendOf(bi)?.role ?? "");
          const isCap = (bi: number) => !!s.colors.railCap && RAIL_CAP_ROLE.test(legendOf(bi)?.role ?? "");
          const infill = idx.filter(isInfill);
          const caps = idx.filter(isCap);
          const rest = idx.filter((bi) => !isInfill(bi) && !isCap(bi));
          if (rest.length) groups.push({ idx: rest, mat: mats[L] });
          if (infill.length) {
            const infillMat = mats[L].clone();
            infillMat.map = null;
            infillMat.roughness = 0.42;
            infillMat.metalness = 0.55;
            infillMat.userData.base = new THREE.Color(s.colors.railInfill);
            owned.push(infillMat);
            groups.push({ idx: infill, mat: infillMat });
          }
          if (caps.length) {
            const capMat = mats[DECKING].clone();
            capMat.userData.base = new THREE.Color(s.colors.railCap);
            owned.push(capMat);
            groups.push({ idx: caps, mat: capMat });
          }
        } else if (L === HARDWARE && idx.some((bi) => HEX_HEAD.test(legendOf(bi)?.role ?? ""))) {
          const heads = idx.filter((bi) => HEX_HEAD.test(legendOf(bi)?.role ?? ""));
          const upright = heads.filter((bi) => s.boxes[bi][6] > s.boxes[bi][4]);
          const across = heads.filter((bi) => !(s.boxes[bi][6] > s.boxes[bi][4]));
          const rest = idx.filter((bi) => !HEX_HEAD.test(legendOf(bi)?.role ?? ""));
          if (rest.length) groups.push({ idx: rest, mat: mats[L] });
          if (across.length) groups.push({ idx: across, mat: mats[L], geo: unitHexZ });
          if (upright.length) groups.push({ idx: upright, mat: mats[L], geo: unitHexY });
        } else if (L === SLAB && idx.some((bi) => JOINT.test(legendOf(bi)?.role ?? ""))) {
          const jointMat = new THREE.MeshStandardMaterial({ color: 0x6b6862, roughness: 1, metalness: 0 });
          jointMat.userData.base = new THREE.Color(0x6b6862);
          owned.push(jointMat);
          const joints = idx.filter((bi) => JOINT.test(legendOf(bi)?.role ?? ""));
          const rest = idx.filter((bi) => !JOINT.test(legendOf(bi)?.role ?? ""));
          if (rest.length) groups.push({ idx: rest, mat: mats[L] });
          groups.push({ idx: joints, mat: jointMat });
        } else if (idx.length) groups.push({ idx, mat: mats[L] });
        for (const { idx, mat, geo } of groups) {
          const mesh = new THREE.InstancedMesh(geo ?? unitBox, mat, idx.length);
          mesh.castShadow = L !== HARDWARE && L !== WIRE && L !== LIGHT && L !== GLASS && L !== SCREEN;
          mesh.receiveShadow = true;
          const base = mat.userData.base as THREE.Color;
          idx.forEach((bi, k) => {
            const b = s.boxes[bi];
            // Placed by boxMatrix (plumb-cut ends; the shear before the scale — applied after it, as it once was, a cut
            // slid by depth²÷length and the ends stood square, so rafters met at the ridge overlapping, 2026-10-11).
            boxMatrix(b, legendOf(bi)?.role ?? null, ox, oz, m4);
            mesh.setMatrixAt(k, m4);
            mesh.setColorAt(k, ownPaint(bi, L) ?? (L === LIGHT && s.glows.some((g) => Math.abs(g[0] - b[1]) < 0.05 && Math.abs(g[1] - b[2]) < 0.05 && Math.abs(g[2] - b[3]) < 0.05) ? new THREE.Color(s.glows.find((g) => Math.abs(g[0] - b[1]) < 0.05 && Math.abs(g[1] - b[2]) < 0.05 && Math.abs(g[2] - b[3]) < 0.05)![3]).lerp(new THREE.Color(0xffffff), 0.45) : L === DECKING ? (borderColor && BORDER_BOARD_ROLE.test(legendOf(bi)?.role ?? "") ? streaked(borderColor, borderColor2, boardSeed.get(bi) ?? bi, 0.045) : streaked(base, deckColor2, boardSeed.get(bi) ?? bi, 0.045)) : jitter(base, bi + L * 97, L === TRIM || L === GUTTER || L === HARDWARE ? 0.01 : 0.03)));
            centres[bi] = [new THREE.Vector3(b[1] - ox, b[3], b[2] - oz), Math.max(b[4], b[5], b[6])];
          });
          mesh.instanceMatrix.needsUpdate = true;
          if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
          mesh.userData.layer = L;
          group.add(mesh);
          layers[L].push({ mesh, total: idx.length, boxIdx: idx });
        }
      }
      // Members with REAL sawn ends — knee braces cut plumb at the post
      // and level under the beam, fascia mitred where two eaves meet —
      // drawn from the same corners the blueprint pictures use. The old
      // path drew a brace as a rotated box with square ends shoved
      // through the beam.
      const braceMat = new THREE.MeshStandardMaterial({ color: tone(frameColor, -0.02), roughness: 0.9, map: grain });
      owned.push(braceMat);
      const sawn: THREE.Mesh[] = [];
      const sawnPerLayer = new Map<number, number>();
      s.boxes.forEach((b, bi) => {
        const role = legendOf(bi)?.role ?? null;
        if (!memberIsSawn(b, role)) return;
        const geo = sawnGeometry(b, role, ox, oz);
        if (!geo) return;
        const L = b[0];
        const mesh = new THREE.Mesh(geo, L === BRACE || /brace/i.test(role ?? "") ? braceMat : mats[L] ?? braceMat);
        mesh.castShadow = L !== HARDWARE && L !== GLASS;
        mesh.receiveShadow = true;
        mesh.userData.layer = L;
        mesh.userData.boxIdx = bi;
        const k = sawnPerLayer.get(L) ?? 0;
        sawnPerLayer.set(L, k + 1);
        mesh.userData.cohort = k;
        centres[bi] = [new THREE.Vector3(b[1] - ox, b[3], b[2] - oz), Math.max(b[4], b[5], b[6])];
        group.add(mesh);
        if (L === BRACE) braces.push(mesh);
        else sawn.push(mesh);
        owned.push(geo);
      });
      sawn.forEach((m) => (m.userData.cohortOf = sawnPerLayer.get(m.userData.layer as number) ?? 1));

      // Footings: the pad at the bottom of the hole, the pier up to its top.
      if (s.footings.length) {
        const mat = mats[FOOTING];
        const pads = new THREE.InstancedMesh(unitCyl, mat, s.footings.length);
        const piers = new THREE.InstancedMesh(unitCyl, mat, s.footings.length);
        const dummy = new THREE.Object3D();
        s.footings.forEach((f, i) => {
          const [x, y, pad, thick, pier, depth, top] = f;
          dummy.quaternion.identity();
          dummy.position.set(x - ox, -depth + thick / 2, y - oz);
          dummy.scale.set(pad, thick, pad);
          dummy.updateMatrix();
          pads.setMatrixAt(i, dummy.matrix);
          const pierHeight = Math.max(0.05, depth - thick + top);
          dummy.position.set(x - ox, top - pierHeight / 2, y - oz);
          dummy.scale.set(pier, pierHeight, pier);
          dummy.updateMatrix();
          piers.setMatrixAt(i, dummy.matrix);
        });
        pads.instanceMatrix.needsUpdate = true;
        piers.instanceMatrix.needsUpdate = true;
        piers.castShadow = true;
        piers.receiveShadow = true;
        pads.userData.layer = FOOTING;
        piers.userData.layer = FOOTING;
        group.add(pads, piers);
        layers[FOOTING].push({ mesh: pads, total: s.footings.length, boxIdx: [] }, { mesh: piers, total: s.footings.length, boxIdx: [] });
      }

      /** Flat rings into one geometry: a fan per ring, both faces, planar UVs, a range of the index per ring. */
      const fanGeometry = (rings: Array<{ pts: Array<[number, number, number]>; color: THREE.Color; depth?: number; sideColor?: THREE.Color }>, uvScale: number): { geo: THREE.BufferGeometry; ends: number[] } => {
        const positions: number[] = [];
        const colors: number[] = [];
        const uvs: number[] = [];
        const index: number[] = [];
        const ends: number[] = [];
        const e1 = new THREE.Vector3();
        const e2 = new THREE.Vector3();
        const nrm = new THREE.Vector3();
        const p0 = new THREE.Vector3();
        const pv = new THREE.Vector3();
        for (const ring of rings) {
          const start = positions.length / 3;
          // UVs on the ring's own plane: u along its first edge, v up the slope.
          p0.set(...ring.pts[0]);
          e1.set(...ring.pts[1]).sub(p0).normalize();
          e2.set(...ring.pts[Math.min(2, ring.pts.length - 1)]).sub(p0);
          nrm.crossVectors(e1, e2).normalize();
          e2.crossVectors(nrm, e1).normalize();
          for (const p of ring.pts) {
            positions.push(p[0], p[1], p[2]);
            colors.push(ring.color.r, ring.color.g, ring.color.b);
            pv.set(p[0], p[1], p[2]).sub(p0);
            uvs.push(pv.dot(e1) * uvScale, pv.dot(e2) * uvScale);
          }
          for (let k = 1; k + 1 < ring.pts.length; k++) index.push(start, start + k, start + k + 1);
          // A ring with depth is a slab, not a sheet (2026-11-06): a side face down from every edge, so it has an
          // edge to catch the light and a shadow to cast, the way 4 in. of concrete does.
          if (ring.depth && ring.depth > 0) {
            const side = ring.sideColor ?? ring.color;
            const n = ring.pts.length;
            for (let k = 0; k < n; k++) {
              const a = ring.pts[k];
              const b = ring.pts[(k + 1) % n];
              const s0 = positions.length / 3;
              const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
              const quad: Array<[number, number, number]> = [a, b, [b[0], b[1] - ring.depth, b[2]], [a[0], a[1] - ring.depth, a[2]]];
              quad.forEach((p, qi) => {
                positions.push(p[0], p[1], p[2]);
                colors.push(side.r, side.g, side.b);
                uvs.push((qi === 1 || qi === 2 ? len : 0) * uvScale, (qi >= 2 ? ring.depth! : 0) * uvScale);
              });
              index.push(s0, s0 + 2, s0 + 1, s0, s0 + 3, s0 + 2);
            }
          }
          ends.push(index.length);
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
        geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
        geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
        geo.setIndex(index);
        geo.computeVertexNormals();
        return { geo, ends };
      };

      // Boards cut to a shape (a bow, a clip, a diagonal): each ring a thin prism, all in one geometry.
      // THE SAME BOARD AS THE SQUARE ONES (owner, 2026-11-14: "when reshaping and cutting the corners the decking on the
      // 3D gets discoloured… keep the decking material steady in colour"). These were painted in the bare colour while
      // the square boards wear the grain — a pale, flat patch wherever the deck was cut. They take the boards' own
      // material now, the grain laid along each board (lib/deck/boardTone ringPlace), and a shade that goes with the
      // board's place on the deck, as a square board's does — not with its number in the list.
      let diagonal: Built["diagonal"] = null;
      if (s.diagonal && s.diagonal.boards.length) {
        const positions: number[] = [];
        const colors: number[] = [];
        const uvs: number[] = [];
        const index: number[] = [];
        const ends: number[] = [];
        s.diagonal.boards.forEach((ring, bi) => {
          const top = s.diagonal!.zs?.[bi] ?? s.heightFt;
          const bottom = top - s.diagonal!.thickFt;
          const n = ring.length / 2;
          const start = positions.length / 3;
          const place = cutBoards[bi];
          const seed = cutSeeds[bi] ?? bi;
          // (A step's own board — lib/deck/finish — before the border's and the deck's colour.)
          const ringOwn = paintRing.get(bi);
          const c = ringOwn ? streaked(ringOwn.c, ringOwn.c2, seed, 0.045) : borderColor && borderRings.has(bi) ? streaked(borderColor, borderColor2, seed, 0.045) : streaked(deckColor, deckColor2, seed, 0.045);
          for (const y of [top, bottom]) {
            for (let k = 0; k < n; k++) {
              positions.push(ring[k * 2] - ox, y, ring[k * 2 + 1] - oz);
              colors.push(c.r, c.g, c.b);
              uvs.push(place.uv[k * 2], place.uv[k * 2 + 1]);
            }
          }
          for (let k = 1; k + 1 < n; k++) {
            index.push(start, start + k + 1, start + k);
            index.push(start + n, start + n + k, start + n + k + 1);
          }
          for (let k = 0; k < n; k++) {
            const a = start + k;
            const b2 = start + ((k + 1) % n);
            index.push(a, b2, a + n, b2, b2 + n, a + n);
          }
          ends.push(index.length);
        });
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
        geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
        geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
        geo.setIndex(index);
        geo.computeVertexNormals();
        // The boards' material (white under the grain, as rough, as bright), told its colour corner by corner.
        const mat = mats[DECKING].clone();
        mat.vertexColors = true;
        mat.flatShading = true;
        mat.side = THREE.DoubleSide;
        mat.userData.base = mats[DECKING].userData.base;
        owned.push(geo, mat);
        fade.push(mat);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.layer = DECKING;
        group.add(mesh);
        diagonal = { mesh, ends };
        mount.dataset.deck3dCutBoards = `${s.diagonal.boards.length}:${mat.map ? "grain" : "plain"}`;
      } else delete mount.dataset.deck3dCutBoards;

      // The roof's faces, the ceiling, the soffit, a slab, glass, screens, walls: flat polygons, one geometry per layer.
      const polys: Built["polys"] = SCENE_LAYERS.map(() => null);
      for (let L = 0; L < LAYER_COUNT; L++) {
        const mine: number[] = [];
        s.polys.forEach((p, i) => {
          if (p[0] === L) mine.push(i);
        });
        if (!mine.length) continue;
        const base = mats[L].userData.base as THREE.Color;
        // An old slab (the "existing" floor) reads a shade darker and wears its own texture; a new pour is light and
        // broom-finished. Either stands 4 in. proud of the ground, with sides.
        const oldSlab = L === SLAB && mine.some((pi) => (s.polyTags?.[pi] ?? -1) >= 0 && s.legend[s.polyTags[pi]]?.nominal === "existing concrete");
        const slabBase = oldSlab ? new THREE.Color(0xaaa79e) : base;
        const rings = mine.map((pi, i) => {
          const p = s.polys[pi];
          const pts: Array<[number, number, number]> = [];
          for (let k = 1; k + 2 < p.length; k += 3) pts.push([p[k] - ox, p[k + 2], p[k + 1] - oz]);
          // The spa's water pane is the one poly that is not its layer's
          // colour: still, blue, a touch glossy.
          const water = SCENE_LAYERS[L] === "spa";
          if (L === SLAB) return { pts, color: jitter(slabBase, i + L * 31, 0.012), depth: SLAB_THICK_FT, sideColor: slabBase.clone().multiplyScalar(0.86) };
          return { pts, color: water ? new THREE.Color(0x6fb3cb) : jitter(base, i + L * 31, L === ROOFING ? 0.03 : 0.015) };
        });
        const { geo, ends } = fanGeometry(rings, L === ROOFING ? (metalRoof ? 1 / 3 : 1 / 2.7) : L === SLAB ? 1 / 6 : 0.25);
        const mat = new THREE.MeshStandardMaterial({
          vertexColors: true,
          roughness: L === ROOFING ? (metalRoof ? 0.45 : 0.9) : L === GLASS ? 0.1 : SCENE_LAYERS[L] === "spa" ? 0.15 : L === SLAB ? 0.95 : 0.9,
          metalness: L === ROOFING && metalRoof ? 0.4 : L === GLASS ? 0.2 : 0,
          flatShading: true,
          side: THREE.DoubleSide,
          map: L === ROOFING ? (metalRoof ? ribs : shingles) : L === SLAB ? (oldSlab ? concreteOld : concrete) : null,
          transparent: L === GLASS || L === SCREEN,
          opacity: L === GLASS ? 0.35 : L === SCREEN ? 0.5 : 1,
        });
        owned.push(geo, mat);
        if (FADES.has(L)) fade.push(mat);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = L !== GLASS && L !== SCREEN;
        mesh.receiveShadow = true;
        mesh.userData.layer = L;
        group.add(mesh);
        polys[L] = { mesh, ends, polyIdx: mine };
      }

      // THE HOUSE (owner, 2026-10-11: "make it look like a house, not a shed"): one block per part of its back wall on a
      // foundation band with corner boards and a frieze, the door onto the deck, windows per storey, a hip or gable roof
      // over it — a two-storey house keeps its bump-outs one storey tall under a hip of their own. Unless a photo stands
      // for it.
      const bd = backdropRef.current;
      if (!bd) {
        mount.dataset.deck3dBackdrop = "none";
        delete mount.dataset.deck3dWall;
      }
      if (s.house && !bd) {
        const H = s.house;
        // The cladding's tile repeats by the wall's size (brick 16 × 5⅓ in., a batten bay 16 in., stone 2 ft): one copy of
        // the pattern per block, so a narrow bump-out's bricks are the size of the main wall's.
        const clad = H.material && cladding[H.material] ? cladding[H.material] : siding;
        const material = H.material && cladding[H.material] ? H.material : "lap";
        // Lap: a 4-ft board 6 in. tall. Brick: four courses, 2 ft 8 in. × 1 ft 9 in. Stucco: 3 ft. Board and batten:
        // one 16-in. bay, the boards 8 ft tall. Stone: 4 × 4 ft.
        const TILE: Record<string, [number, number]> = { lap: [4, 0.5], brick: [2.667, 1.333], stucco: [3, 3], "board-batten": [1.333, 8], stone: [4, 4] };
        // The relief of each cladding, as the colour map read for height (a bump map costs one texture read, no geometry).
        const BUMP: Record<string, number> = { lap: 0.035, brick: 0.05, stucco: 0.012, "board-batten": 0.045, stone: 0.06 };
        const wallMat = new THREE.MeshStandardMaterial({ color: H.siding ? new THREE.Color(H.siding) : SIDING, roughness: 0.95, map: clad, bumpMap: clad, bumpScale: BUMP[material] });
        const wallMatFor = (w: number, h: number) => {
          const t = clad.clone();
          const [tw, th] = TILE[material];
          t.repeat.set(Math.max(1, w / tw), Math.max(1, h / th));
          t.needsUpdate = true;
          const m = wallMat.clone();
          m.map = t;
          m.bumpMap = t;
          owned.push(t, m);
          return m;
        };
        const baseMat = new THREE.MeshStandardMaterial({ color: FOUNDATION, roughness: 1, map: concrete, bumpMap: concrete, bumpScale: 0.02 });
        const roofMat = new THREE.MeshStandardMaterial({ color: H.roofColour ? new THREE.Color(H.roofColour) : ROOF, roughness: 0.95, map: shingles, side: THREE.DoubleSide });
        // The windows' glass as it looks from the yard by day (owner, 2026-10-24: "the windows are like mirrors, blooming"): a
        // dull dielectric, not a dark metal — the sky's light toward the top of the pane, the room's dark toward the sill, a
        // soft sheen rather than a mirror's image and the sun's flare.
        const glassTex = canvasTexture(8, 64, (g) => {
          const grad = g.createLinearGradient(0, 0, 0, 64);
          grad.addColorStop(0, "#93adc0");
          grad.addColorStop(0.42, "#5a6e7f");
          grad.addColorStop(1, "#2b3540");
          g.fillStyle = grad;
          g.fillRect(0, 0, 8, 64);
        });
        const glassMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: glassTex, roughness: 0.28, metalness: 0, envMapIntensity: 1.1 });
        // A knob, a sliding door's pull: dark metal, so it reads on a white door.
        const handleMat = new THREE.MeshStandardMaterial({ color: 0x2c2e33, roughness: 0.45, metalness: 0.55 });
        owned.push(glassTex);
        const trimMat = new THREE.MeshStandardMaterial({ color: TRIM_WHITE, roughness: 0.8 });
        const doorMat = new THREE.MeshStandardMaterial({ color: 0xf1eee6, roughness: 0.7 });
        // A garage door's rails: a shade under its panel, so the sections read without a lite (2026-10-26).
        const railMat = new THREE.MeshStandardMaterial({ color: 0xd9d5cc, roughness: 0.85 });
        owned.push(wallMat, baseMat, roofMat, glassMat, handleMat, trimMat, doorMat, railMat);
        const height = H.heightFt;
        const band = Math.min(1.5, Math.max(0.5, s.heightFt - 0.6));
        const blocks = H.blocks.map((b) => ({ x0: b[0], y0: b[1], x1: b[2], y1: b[3], h: b[4] ?? height }));
        mount.dataset.deck3dHouse = `${H.storeys ?? 1}:${H.roof ?? "hip"}:${blocks.length}:${H.windows?.length ?? 0}:${H.siding ?? ""}:${H.roofColour ?? ""}:${H.material ?? "lap"}:${H.doors?.length ?? "-"}:${H.roofs?.map((r) => r[0]).join("") ?? "-"}`;
        const part = (geo: THREE.BufferGeometry | null, mat: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number, shadow = false) => {
          const m = new THREE.Mesh(geo ?? unitBox, mat);
          if (!geo) m.scale.set(sx, sy, sz);
          m.position.set(x, y, z);
          m.castShadow = shadow;
          m.receiveShadow = true;
          m.userData.layer = -2;
          group.add(m);
          return m;
        };
        for (const b of blocks) {
          const w = b.x1 - b.x0;
          const d = b.y1 - b.y0;
          const cx = (b.x0 + b.x1) / 2 - ox;
          const cz = (b.y0 + b.y1) / 2 - oz;
          part(null, wallMatFor(w, b.h - band), w, b.h - band, d, cx, band + (b.h - band) / 2, cz, true);
          part(null, baseMat, w + 0.02, band, d + 0.02, cx, band / 2, cz);
          // Corner boards at the face's two ends — where the wall really turns a corner, not where two stretches of the
          // body's one wall meet — and a frieze under the eave.
          const seam = (x: number) => blocks.some((o) => o !== b && Math.abs(o.y1 - b.y1) < 0.01 && Math.abs(o.h - b.h) < 0.01 && (Math.abs(o.x1 - x) < 0.01 || Math.abs(o.x0 - x) < 0.01));
          for (const [x, edge] of [[b.x0 + 0.18, b.x0], [b.x1 - 0.18, b.x1]]) if (!seam(edge)) part(null, trimMat, 0.36, b.h - band, 0.36, x - ox, band + (b.h - band) / 2, b.y1 - oz + 0.06);
          part(null, trimMat, w + 0.3, 0.5, 0.16, cx, b.h - 0.25, b.y1 - oz + 0.1);
          if (H.roofs) continue;
          // An older scene: a roof per block — the main kind over the full-height blocks, a hip of its own over a lower bump-out.
          const ovh = 1.2;
          const low = b.h < height - 0.01;
          const kind = low ? "hip" : (H.roof ?? "hip");
          const rw = w + 2 * ovh;
          const rd = d + 2 * ovh;
          const rise = (rd / 2) * (low ? 0.35 : 0.5);
          const geo = kind === "gable" ? gableRoofGeometry(rw, rd, rise) : hipRoofGeometry(rw, rd, rise);
          owned.push(geo.slopes);
          part(geo.slopes, roofMat, 1, 1, 1, cx, b.h, cz, true);
          if (geo.ends) {
            owned.push(geo.ends);
            part(geo.ends, wallMat, 1, 1, 1, cx, b.h, cz);
          }
          // Fascia along the eaves.
          part(null, trimMat, rw, 0.55, 0.16, cx, b.h - 0.05, b.y1 - oz + ovh);
          part(null, trimMat, rw, 0.55, 0.16, cx, b.h - 0.05, b.y0 - oz - ovh);
          if (kind === "hip") {
            part(null, trimMat, 0.16, 0.55, rd, b.x0 - ox - ovh, b.h - 0.05, cz);
            part(null, trimMat, 0.16, 0.55, rd, b.x1 - ox + ovh, b.h - 0.05, cz);
          }
        }
        // THE ROOFS (2026-10-23): one over the body, one over each bump-out against it — at the pitch the house has.
        for (const [kind, x0, y0, x1, y1, eave, pitch] of H.roofs ?? []) {
          const ovh = 1.2;
          const bump = kind >= 5;
          const w = x1 - x0;
          const d = y1 - y0;
          const rw = w + 2 * ovh;
          const rd = d + (bump ? ovh : 2 * ovh);
          const cx = (x0 + x1) / 2 - ox;
          const cz = (bump ? y0 + rd / 2 : (y0 + y1) / 2) - oz;
          const p = pitch / 12;
          if (kind === 4 || kind === 8) {
            part(null, roofMat, rw, 0.5, rd, cx, eave + 0.25, cz, true);
            part(null, trimMat, rw + 0.05, 0.6, 0.16, cx, eave + 0.2, cz + rd / 2);
            for (const sx of [-1, 1]) part(null, trimMat, 0.16, 0.6, rd, cx + (sx * rw) / 2, eave + 0.2, cz);
            continue;
          }
          const geo =
            kind === 0 ? hipRoofGeometry(rw, rd, (rd / 2) * p)
            : kind === 1 ? gableRoofGeometry(rw, rd, (rd / 2) * p)
            : kind === 2 ? gableEndGeometry(rw, rd, (rw / 2) * p)
            : kind === 3 ? shedGeometry(rw, rd, rd * p)
            : kind === 5 ? bumpHipGeometry(rw, rd, Math.min(rd, rw / 2) * p)
            : kind === 6 ? bumpGableGeometry(rw, rd, (rw / 2) * p)
            : shedGeometry(rw, rd, rd * p);
          owned.push(geo.slopes);
          part(geo.slopes, roofMat, 1, 1, 1, cx, eave, cz, true);
          if (geo.ends) {
            owned.push(geo.ends);
            // an existing cover (9) is open at its ends: no wall under its slope
            if (kind !== 9) part(geo.ends, wallMat, 1, 1, 1, cx, eave, cz);
          }
          // AN EXISTING COVER (9, 2026-11-13 — a porch roof kept from the photo): its posts under the front edge, one
          // at each end and no more than 10 ft apart, and the beam they carry.
          if (kind === 9) {
            const n = Math.max(2, Math.ceil(w / 10) + 1);
            for (let i = 0; i < n; i++) part(null, trimMat, 0.5, eave - 0.7, 0.5, x0 + 0.25 + ((w - 0.5) * i) / (n - 1) - ox, (eave - 0.7) / 2, y1 - 0.25 - oz, true);
            part(null, trimMat, w, 0.7, 0.45, cx, eave - 0.35, y1 - 0.25 - oz, true);
          }
          // Fascia along the eaves: along the house where the slopes come down to it; along the sides of a hip, of a
          // gable to the yard and of a bump-out's gable.
          const along = kind === 0 || kind === 1 || kind === 3 || kind === 5 || kind === 7 || kind === 9;
          const sides = kind === 0 || kind === 2 || kind === 5 || kind === 6;
          if (along) part(null, trimMat, rw, 0.55, 0.16, cx, eave - 0.05, cz + rd / 2);
          if (along && !bump && kind !== 3) part(null, trimMat, rw, 0.55, 0.16, cx, eave - 0.05, cz - rd / 2);
          if (sides) for (const sx of [-1, 1]) part(null, trimMat, 0.16, 0.55, rd, cx + (sx * rw) / 2, eave - 0.05, cz);
        }
        // THE DOORS AND THE WINDOWS (drawn again 2026-11-13 — owner: "the glass and doors on the 3D are messy"). Every part
        // stands at a depth of its own off the wall, so no face lies on another and nothing flickers: the glass 0.06 ft
        // out, a sash's bars and a door leaf's frame 0.1, the casing 0.16, the head cap 0.2, the sill's nose 0.34. The
        // casing is a FRAME of boards round the glass, not a plate behind it: the pane sits back in it by real depth.
        const CASING = 0.25;
        /** A box on the wall whose face is at z0: centred on (x, y), w × h, from `back` to `front` off that face. */
        const onWall = (mat: THREE.Material, x: number, y: number, w: number, h: number, z0: number, back: number, front: number) => part(null, mat, w, h, front - back, x - ox, y, z0 + (back + front) / 2);
        /** The casing round an opening x wide from y0 up to y1: its two sides and its head board. */
        const casing = (x: number, w: number, y0: number, y1: number, z0: number) => {
          for (const side of [-1, 1]) onWall(trimMat, x + side * (w / 2 + CASING / 2), (y0 + y1 + CASING) / 2, CASING, y1 + CASING - y0, z0, -0.02, 0.16);
          onWall(trimMat, x, y1 + CASING / 2, w, CASING, z0, -0.02, 0.16);
        };
        /** A door's threshold, out over the deck's boards. */
        const threshold = (x: number, w: number, y: number, z0: number) => onWall(railMat, x, y + 0.04, w + 2 * CASING, 0.08, z0, -0.02, 0.24);
        /**
         * A window. Its bars: the meeting rail across when it is tall enough to be two sashes, one bar up the middle to
         * about 5 ft wide, then one every sash of about 3 ft (a long window read off a photo is one frame with its
         * sashes, 2026-10-27) — a small pane (a transom, a bath window) keeps its glass clear. `over` = it stands right
         * over another opening (a transom): a plain board under it, no sill and apron across that opening's head;
         * `under` = another stands right over it: no head cap.
         */
        const windowAt = (x: number, w: number, h: number, y: number, face: number, over = false, under = false, panels?: number) => {
          const z0 = face - oz;
          onWall(glassMat, x, y + h / 2, w, h, z0, -0.02, 0.06);
          const bar = (bx: number, by: number, bw: number, bh: number) => onWall(trimMat, bx, by, bw, bh, z0, 0.03, 0.1);
          // (Set by hand, 2026-11-15: a single, double or triple window shows that many sashes whatever its width.)
          const sashes = panels && panels >= 1 ? Math.min(4, Math.round(panels)) : Math.max(1, Math.round(w / 3.2));
          if (h >= 2.5) bar(x, y + h / 2, w, 0.08);
          if (sashes > 1) for (let i = 1; i < sashes; i++) bar(x - w / 2 + (w * i) / sashes, y + h / 2, 0.08, h);
          else if (w >= 2 && h >= 1.5) bar(x, y + h / 2, 0.08, h);
          if (over) {
            casing(x, w, y - 0.12, y + h, z0);
            onWall(trimMat, x, y - 0.06, w, 0.12, z0, -0.02, 0.16);
          } else {
            casing(x, w, y, y + h, z0);
            // The sill with its nose and horns, the apron under it.
            onWall(trimMat, x, y - 0.09, w + 0.66, 0.18, z0, -0.02, 0.34);
            onWall(trimMat, x, y - 0.33, w + 0.46, 0.3, z0, -0.02, 0.1);
          }
          if (!under) onWall(trimMat, x, y + h + 0.3, w + 0.62, 0.22, z0, -0.02, 0.2);
        };
        /** A sliding door: glass in leaves, each in its frame — a stile at both ends, a meeting stile between leaves, the top rail, the taller bottom rail — and the pull on the stile it closes on. */
        const sliderAt = (x: number, w: number, h: number, y: number, face: number, panels?: number) => {
          const z0 = face - oz;
          onWall(glassMat, x, y + h / 2, w, h, z0, -0.02, 0.06);
          // (Set by hand, 2026-11-15: a sliding door of 2, 3 or 4 panels shows that many leaves whatever its width.)
          const leaves = panels && panels >= 2 ? Math.min(4, Math.round(panels)) : Math.min(4, Math.max(2, Math.round(w / 3.5)));
          const stile = Math.min(0.2, w / 8);
          const frame = (bx: number, by: number, bw: number, bh: number) => onWall(trimMat, bx, by, bw, bh, z0, 0.03, 0.1);
          for (const side of [-1, 1]) frame(x + side * (w / 2 - stile / 2), y + h / 2, stile, h);
          for (let i = 1; i < leaves; i++) frame(x - w / 2 + (w * i) / leaves, y + h / 2, stile * 1.2, h);
          frame(x, y + h - stile / 2, w, stile);
          frame(x, y + 0.15, w, 0.3);
          if (h >= 4.5) onWall(handleMat, x + w / 2 - stile / 2, y + 3.1, 0.07, 0.6, z0, 0.08, 0.17);
          casing(x, w, y, y + h, z0);
          threshold(x, w, y, z0);
        };
        /** A door: a painted slab, a glass lite in its top half in a frame of its own, a panel under it, the knob on the latch side. */
        const doorAt = (x: number, w: number, h: number, y: number, face: number, panels?: number) => {
          const z0 = face - oz;
          onWall(doorMat, x, y + h / 2, w, h, z0, -0.02, 0.07);
          // A DOUBLE DOOR (2026-11-15, set by hand): two leaves, each with its lite and panel, their knobs where they
          // meet, a thin astragal between them.
          const leaves = panels === 2 && w >= 3.5 ? 2 : 1;
          const lw = w / leaves;
          for (let i = 0; i < leaves; i++) {
            const lx = x - w / 2 + lw * (i + 0.5);
            if (h >= 4.5) {
              onWall(trimMat, lx, y + h * 0.7, lw * 0.56 + 0.14, h * 0.36 + 0.14, z0, 0.03, 0.1);
              onWall(glassMat, lx, y + h * 0.7, lw * 0.56, h * 0.36, z0, 0.05, 0.13);
              onWall(railMat, lx, y + h * 0.26, lw * 0.62, h * 0.3, z0, 0.03, 0.1);
              onWall(handleMat, lx + (leaves === 2 ? (i === 0 ? 1 : -1) : 1) * lw * 0.39, y + 3, 0.1, 0.1, z0, 0.05, 0.19);
            }
          }
          if (leaves === 2) onWall(trimMat, x, y + h / 2, 0.06, h, z0, 0.07, 0.11);
          casing(x, w, y, y + h, z0);
          threshold(x, w, y, z0);
        };
        /** A garage door (2026-10-26): one flat panel the width of the opening, its rails as shaded lines, no lite. */
        const garageAt = (x: number, w: number, h: number, y: number, face: number) => {
          const z0 = face - oz;
          onWall(doorMat, x, y + h / 2, w, h, z0, -0.02, 0.07);
          const rails = Math.max(2, Math.round(h / 1.75));
          for (let i = 1; i < rails; i++) onWall(railMat, x, y + (h * i) / rails, w - 0.3, 0.07, z0, 0.03, 0.1);
          casing(x, w, y, y + h, z0);
        };
        // What stands in the wall: the doors where the photo showed them, on their own thresholds — or the one door onto
        // the deck, drawn by rule (a wide one slides, a narrow one swings) — and the windows.
        const openings: Array<{ kind: "window" | "door" | "slider" | "garage"; x: number; w: number; h: number; y: number; face: number; panels?: number }> = [];
        if (H.doors) for (const [dx, face, dw, dh, sill, kind, panels] of H.doors) openings.push({ kind: kind === 1 ? "slider" : kind === 2 ? "garage" : "door", x: dx, w: dw, h: dh, y: sill, face, panels });
        else if (H.door) {
          const [dx, dw, dh, face = 0] = H.door;
          openings.push({ kind: dw >= 5 ? "slider" : "door", x: dx, w: dw, h: dh, y: s.heightFt, face });
          if (!H.windows) {
            // An older scene: a window each side of the door.
            const main = H.blocks[0];
            for (const side of [-1, 1]) {
              const wx = dx + side * (dw / 2 + 4.5);
              if (wx - 1.5 > Math.max(main[0], 0) && wx + 1.5 < Math.min(main[2], s.widthFt)) openings.push({ kind: "window", x: wx, w: 3, h: 4, y: s.heightFt + 2.7, face: 0 });
            }
          }
        }
        for (const [wx, face, ww, wh, sill, panels] of H.windows ?? []) openings.push({ kind: "window", x: wx, w: ww, h: wh, y: sill, face, panels });
        /** Two openings in one column of the same face, the first right under the second. */
        const stacked = (lower: (typeof openings)[number], upper: (typeof openings)[number]) =>
          lower !== upper && Math.abs(lower.face - upper.face) < 0.05 && Math.min(lower.x + lower.w / 2, upper.x + upper.w / 2) - Math.max(lower.x - lower.w / 2, upper.x - upper.w / 2) > -CASING && upper.y >= lower.y + lower.h - 0.01 && upper.y - (lower.y + lower.h) < 0.6;
        for (const o of openings) {
          if (o.kind === "window") windowAt(o.x, o.w, o.h, o.y, o.face, openings.some((l) => stacked(l, o)), openings.some((u) => stacked(o, u)), o.panels);
          else if (o.kind === "slider") sliderAt(o.x, o.w, o.h, o.y, o.face, o.panels);
          else if (o.kind === "garage") garageAt(o.x, o.w, o.h, o.y, o.face);
          else doorAt(o.x, o.w, o.h, o.y, o.face, o.panels);
        }
        mount.dataset.deck3dOpenings = openings.map((o) => `${o.kind}${o.panels ? o.panels : ""}@${o.x}`).join(" ");
      }

      // The fixtures' light at night: a few real lights, the rest glow.
      const pointLights: THREE.PointLight[] = [];
      const lit = s.glows.filter((g) => g[4] === 0).slice(0, 6);
      for (const g of lit) {
        const pl = new THREE.PointLight(g[3], 0, 22, 2);
        pl.position.set(g[0] - ox, g[2] - 0.3, g[1] - oz);
        group.add(pl);
        pointLights.push(pl);
      }
      // A sample fixture (the client's own) reads see-through.
      if (s.glows.some((g) => g[4] === 1) && layers[LIGHT].length) {
        const sampleMat = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, roughness: 0.4, emissive: new THREE.Color(0xffe2b0), emissiveIntensity: 0.15 });
        owned.push(sampleMat);
        const { mesh, boxIdx } = layers[LIGHT][0];
        const samples = boxIdx.map((bi) => s.glows.some((g) => g[4] === 1 && Math.abs(g[0] - s.boxes[bi][1]) < 0.05 && Math.abs(g[1] - s.boxes[bi][2]) < 0.05));
        if (samples.some(Boolean)) {
          const sampleMesh = new THREE.InstancedMesh(unitBox, sampleMat, samples.filter(Boolean).length);
          let k = 0;
          const tmp = new THREE.Matrix4();
          samples.forEach((isSample, i) => {
            if (!isSample) return;
            mesh.getMatrixAt(i, tmp);
            sampleMesh.setMatrixAt(k++, tmp);
            // Hide the solid one.
            tmp.makeScale(0.0001, 0.0001, 0.0001);
            mesh.setMatrixAt(i, tmp);
          });
          mesh.instanceMatrix.needsUpdate = true;
          sampleMesh.instanceMatrix.needsUpdate = true;
          sampleMesh.userData.layer = LIGHT;
          group.add(sampleMesh);
          layers[LIGHT].push({ mesh: sampleMesh, total: k, boxIdx: [] });
        }
      }

      // The callouts: numbered tags at the connections.
      const callouts: THREE.Sprite[] = [];
      s.callouts.forEach((c, i) => {
        const tag = tagSprite(String(i + 1), true);
        owned.push(tag);
        tag.sprite.position.set(c[0] - ox, c[2], c[1] - oz);
        tag.sprite.userData.callout = i;
        tag.sprite.userData.legend = c[3];
        tag.sprite.userData.dim = true;
        tag.sprite.visible = false;
        group.add(tag.sprite);
        callouts.push(tag.sprite);
      });

      // The edit handles: a blueprint-blue knob at each thing a drag can change; shown only in edit mode.
      const handleGeo = new THREE.SphereGeometry(0.42, 18, 14);
      const handleMat = new THREE.MeshStandardMaterial({ color: 0x1854a0, roughness: 0.35, metalness: 0.1, emissive: new THREE.Color(0x1854a0), emissiveIntensity: 0.25 });
      owned.push(handleGeo, handleMat);
      const handles: THREE.Mesh[] = [];
      // A POST OR A BEAM IS ITS OWN HANDLE (2026-11-13; SceneHandle.grab): an unseen box around the part, a little
      // larger than it (a finger's width more on a touch screen), that the pointer takes hold of. No knob.
      const grabMat = new THREE.MeshBasicMaterial({ visible: false });
      owned.push(grabMat);
      const pad = coarse ? 0.3 : 0.06;
      for (const h of s.handles) {
        if (h.kind === "builtin" || h.kind === "opening") continue;
        let m: THREE.Mesh;
        if (h.grab) {
          const [x0, y0, z0, x1, y1, z1] = h.grab;
          const geo = new THREE.BoxGeometry(Math.max(0.05, x1 - x0) + 2 * pad, Math.max(0.05, z1 - z0) + 2 * pad, Math.max(0.05, y1 - y0) + 2 * pad);
          owned.push(geo);
          m = new THREE.Mesh(geo, grabMat);
          m.position.set((x0 + x1) / 2 - ox, (z0 + z1) / 2, (y0 + y1) / 2 - oz);
          m.userData.grab = true;
        } else {
          m = new THREE.Mesh(handleGeo, handleMat);
          m.position.set(h.x - ox, h.z + 0.3, h.y - oz);
        }
        m.userData.handle = h;
        m.userData.layer = -3;
        m.visible = false;
        m.renderOrder = 5;
        group.add(m);
        handles.push(m);
      }
      // AN ACCESSORY IS TAKEN IN THE HAND BY ITSELF (2026-11-15): an unseen box over its footprint, turned with it and as
      // high as it stands — the pointer takes hold of it there, in Edit in 3D or not.
      const liveBoxes: THREE.Mesh[] = [];
      for (const h of s.handles) {
        if (h.kind !== "builtin" || !h.grab) continue;
        const [gx0, gy0, z0, gx1, gy1, z1] = h.grab;
        const f = h.foot && h.foot.length === 8 ? h.foot : null;
        const len = f ? Math.hypot(f[2] - f[0], f[3] - f[1]) : gx1 - gx0;
        const dep = f ? Math.hypot(f[6] - f[0], f[7] - f[1]) : gy1 - gy0;
        const geo = new THREE.BoxGeometry(Math.max(0.2, len) + 2 * pad, Math.max(0.2, z1 - z0) + 2 * pad, Math.max(0.2, dep) + 2 * pad);
        owned.push(geo);
        const m = new THREE.Mesh(geo, grabMat);
        m.position.set((f ? (f[0] + f[4]) / 2 : (gx0 + gx1) / 2) - ox, (z0 + z1) / 2, (f ? (f[1] + f[5]) / 2 : (gy0 + gy1) / 2) - oz);
        m.rotation.y = f ? -Math.atan2(f[3] - f[1], f[2] - f[0]) : 0;
        m.userData.live = true;
        m.userData.handle = h;
        m.userData.layer = -3;
        m.userData.size = [len, dep, z0];
        group.add(m);
        liveBoxes.push(m);
      }
      // A WINDOW OR A DOOR likewise (2026-11-15): its box on the wall, from a little behind the wall's face to in front of its trim.
      for (const h of s.handles) {
        if (h.kind !== "opening" || !h.grab || !h.open) continue;
        const [gx0, gy0, z0, gx1, gy1, z1] = h.grab;
        const geo = new THREE.BoxGeometry(Math.max(0.2, gx1 - gx0) + 2 * pad, Math.max(0.2, z1 - z0) + 2 * pad, Math.max(0.2, gy1 - gy0));
        owned.push(geo);
        const m = new THREE.Mesh(geo, grabMat);
        m.position.set((gx0 + gx1) / 2 - ox, (z0 + z1) / 2, (gy0 + gy1) / 2 - oz);
        m.userData.live = true;
        m.userData.handle = h;
        m.userData.layer = -3;
        m.userData.size = [gx1 - gx0, gy1 - gy0, z0];
        group.add(m);
        liveBoxes.push(m);
      }
      const knobs: HTMLButtonElement[] = [];
      const knobLabels: HTMLSpanElement[] = [];
      const leaders: SVGGElement[] = [];
      // The post or beam in the hand, read again where it stands now: its place shows as it moves.
      const held = drag?.handle.grab && drag.handle.kind !== "builtin" && drag.handle.kind !== "opening" ? s.handles.find((q) => q.kind === drag?.handle.kind && q.id === drag?.handle.id) : undefined;
      if (held) queueMicrotask(() => hoverHandle(held));
      handles.forEach((m) => {
        const h = m.userData.handle as SceneHandle;
        if (h.grab) return;
        const key = `${h.kind}:${h.id}`;
        const leader = document.createElementNS("http://www.w3.org/2000/svg", "g");
        leader.innerHTML = `<line/><circle r="3.5"/>`;
        leader.style.display = "none";
        leaderLayer.appendChild(leader);
        leaders.push(leader);
        const knob = document.createElement("button");
        knob.type = "button";
        knob.className = "dk-knob";
        knob.dataset.deckHandle = h.kind;
        knob.dataset.deckHandleId = h.id;
        knob.setAttribute("aria-label", `${h.label} — drag, or press the arrow keys`);
        knob.title = h.label;
        // A double arrow, turned every frame to the direction the drag really moves on the screen.
        knob.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16M8 7.5 3.5 12 8 16.5M16 7.5l4.5 4.5-4.5 4.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
        if (drag && `${drag.handle.kind}:${drag.handle.id}` === key) knob.dataset.active = "";
        const tag = document.createElement("span");
        tag.className = "dk-label";
        tag.setAttribute("aria-hidden", "true");
        knobLabels.push(tag);
        setKnobLabel(tag, h, hotKnob === key);
        knob.addEventListener("pointerdown", (e) => knobDown(e, m, knob));
        knob.addEventListener("pointermove", (e) => dragMove(e.clientX, e.clientY, false));
        knob.addEventListener("pointerup", (e) => dragMove(e.clientX, e.clientY, true));
        knob.addEventListener("pointercancel", () => onCancel());
        knob.addEventListener("pointerenter", () => {
          setHotKnob(key);
          hoverHandle(h);
        });
        knob.addEventListener("pointerleave", () => {
          if (drag) return;
          if (focusedKnob !== key) setHotKnob(null);
          pickRef.current?.(null, "hover");
        });
        knob.addEventListener("focus", () => {
          focusedKnob = key;
          setHotKnob(key);
          hoverHandle(h);
        });
        knob.addEventListener("blur", () => {
          // A rebuild removes the focused knob and hands the focus back to its successor; only a real blur lets go.
          if (!knob.isConnected) return;
          if (focusedKnob === key) focusedKnob = null;
          if (hotKnob === key && !drag) setHotKnob(null);
        });
        knob.addEventListener("keydown", (e) => knobKey(e, h));
        knobLayer.appendChild(tag);
        knobLayer.appendChild(knob);
        knobs.push(knob);
        if (focusedKnob === key && editRef.current) queueMicrotask(() => knob.focus({ preventScroll: true }));
      });

      // THE PHOTO AS THE WALL: the picture the elevation was placed on, standing on the house line at the placement's
      // scale — cut to the wall the read found, with the house's body behind it in the picture's own colours: plain
      // return walls at the steps, plain side walls going back, a roof over it all (owner, 2026-10-11: "it looks like
      // a piece of paper — make a continuation behind the back wall so it looks like a house; where the picture does
      // not show what is beside a jog, keep a plain wall; keep the quality of the back wall").
      if (bd && bd.placed.w > 0 && bd.elevWidthFt > 0 && bd.w > 0 && bd.h > 0) {
        const pxPerFt = (bd.placed.w * bd.w) / bd.elevWidthFt;
        const wFt = bd.w / pxPerFt;
        const hFt = bd.h / pxPerFt;
        const leftX = -bd.placed.x * wFt - bd.elevLeftFt;
        const wall = bd.wall && bd.wall.x1 - bd.wall.x0 > 0.05 ? bd.wall : null;
        const uL = wall ? Math.min(1, Math.max(0, wall.x0)) : 0;
        const uR = wall ? Math.min(1, Math.max(0, wall.x1)) : 1;
        // The picture stops at the eave when the read found one — the roof is built, not pasted; else at the picture's top.
        const groundFrac = Math.min(1, Math.max(0, bd.placed.y));
        const topFrac = wall && wall.top !== null && wall.top > 0.01 && wall.top < groundFrac - 0.05 ? wall.top : 0;
        const zTop = (bd.placed.y - topFrac) * hFt;
        const zBottom = Math.max(0, (bd.placed.y - 1) * hFt);
        const v0 = 1 - groundFrac;
        const vTop = 1 - topFrac;
        if (zTop - zBottom > 0.2 && wFt > 0.5 && uR - uL > 0.02) {
          // The plain walls and the roof take the picture's own colours once it is in.
          const plainMat = new THREE.MeshStandardMaterial({ color: SIDING, roughness: 0.95, side: THREE.DoubleSide });
          const returnMat = new THREE.MeshStandardMaterial({ color: SIDING, roughness: 0.95, side: THREE.DoubleSide });
          const roofMat = new THREE.MeshStandardMaterial({ color: ROOF, roughness: 0.9 });
          const fasciaMat = new THREE.MeshStandardMaterial({ color: TRIM_WHITE, roughness: 0.8 });
          owned.push(plainMat, returnMat, roofMat, fasciaMat);
          const tex = photoTexture(bd.href, (img) => {
            const c = sampleColours(img, { x0: uL, x1: uR, y0: topFrac, y1: groundFrac });
            if (!c) return;
            plainMat.color.copy(c.wall);
            returnMat.color.copy(c.wall).multiplyScalar(0.82);
            if (c.roof) roofMat.color.copy(c.roof);
            invalidate();
          });
          const photoMat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, toneMapped: false });
          owned.push(photoMat);
          photoMats.push(photoMat);
          // The wall's parts between its steps, each at its depth; the part under the deck's middle stands on the house line.
          const jogs = [...bd.jogs].filter((j) => j.x > uL + 0.005 && j.x < uR - 0.005).sort((a, b) => a.x - b.x);
          const xs = [uL, ...jogs.map((j) => j.x), uR];
          const depths: number[] = [0];
          for (const j of jogs) depths.push(depths[depths.length - 1] + (j.dir === "toward" ? 1 : -1) * (j.depthFt ?? JOG_DEFAULT_FT));
          const centreFrac = (s.widthFt / 2 - leftX) / wFt;
          let mine = 0;
          for (let i = 0; i + 1 < xs.length; i++) if (centreFrac >= xs[i] && centreFrac <= xs[i + 1]) mine = i;
          const shift = depths[mine] + (bd.standoffFt ?? 0);
          const height = zTop - zBottom;
          const yMid = (zTop + zBottom) / 2;
          const zOf = (d: number) => d - shift - oz - 0.05;
          for (let i = 0; i + 1 < xs.length; i++) {
            const u0 = xs[i];
            const u1 = xs[i + 1];
            if (u1 - u0 < 0.002) continue;
            const geo = new THREE.PlaneGeometry((u1 - u0) * wFt, height);
            geo.setAttribute("uv", new THREE.Float32BufferAttribute([u0, vTop, u1, vTop, u0, v0, u1, v0], 2));
            owned.push(geo);
            const plane = new THREE.Mesh(geo, photoMat);
            plane.position.set(leftX + ((u0 + u1) / 2) * wFt - ox, yMid, zOf(depths[i]));
            group.add(plane);
            // A fascia along the top of each part when the picture stops at the eave.
            if (topFrac > 0) {
              const fascia = new THREE.Mesh(unitBox, fasciaMat);
              fascia.scale.set((u1 - u0) * wFt + 0.2, 0.6, 0.18);
              fascia.position.set(leftX + ((u0 + u1) / 2) * wFt - ox, zTop - 0.3, zOf(depths[i]) + 0.12);
              fascia.userData.layer = -2;
              group.add(fascia);
            }
          }
          // The return walls at each step: plain, in the wall's own colour — the picture does not show them.
          for (let i = 1; i + 1 < xs.length; i++) {
            const run = depths[i] - depths[i - 1];
            if (Math.abs(run) < 0.05) continue;
            const geo = new THREE.PlaneGeometry(Math.abs(run), height);
            owned.push(geo);
            const wallMesh = new THREE.Mesh(geo, returnMat);
            wallMesh.rotation.y = Math.PI / 2;
            wallMesh.position.set(leftX + xs[i] * wFt - ox, yMid, (depths[i] + depths[i - 1]) / 2 - shift - oz - 0.05);
            group.add(wallMesh);
          }
          // The house's body: plain side walls back from each end of the wall, a back wall, and a roof over it all.
          mount.dataset.deck3dWall = wall ? `${(leftX + uL * wFt).toFixed(1)}..${(leftX + uR * wFt).toFixed(1)}` : "whole";
          if (wall) {
            const bodyDepth = 26;
            const xL = leftX + uL * wFt - ox;
            const xR = leftX + uR * wFt - ox;
            const zBack = Math.min(...depths.map(zOf)) - bodyDepth;
            for (const [x, zFront] of [[xL, zOf(depths[0])], [xR, zOf(depths[depths.length - 1])]] as Array<[number, number]>) {
              const geo = new THREE.PlaneGeometry(zFront - zBack, height);
              owned.push(geo);
              const side = new THREE.Mesh(geo, plainMat);
              side.rotation.y = Math.PI / 2;
              side.position.set(x, yMid, (zFront + zBack) / 2);
              side.receiveShadow = true;
              group.add(side);
            }
            const backGeo = new THREE.PlaneGeometry(xR - xL, height);
            owned.push(backGeo);
            const back = new THREE.Mesh(backGeo, plainMat);
            back.position.set((xL + xR) / 2, yMid, zBack);
            group.add(back);
            const zFrontMax = Math.max(...depths.map(zOf));
            const roof = new THREE.Mesh(unitBox, roofMat);
            roof.scale.set(xR - xL + 2.4, 0.7, zFrontMax - zBack + 2.4);
            roof.position.set((xL + xR) / 2, zTop + 0.2, (zFrontMax + zBack) / 2);
            roof.castShadow = true;
            roof.userData.layer = -2;
            group.add(roof);
          }
        }
      }

      // The overall dimensions, drawn on the ground a little outside the deck, and the height at the corner.
      const lineMat = new THREE.LineBasicMaterial({ color: INK });
      owned.push(lineMat);
      const dims = new THREE.Group();
      const dim = (a: THREE.Vector3, b: THREE.Vector3, text: string, tick: THREE.Vector3) => {
        const pts = [a, b, a.clone().add(tick), a.clone().sub(tick), b.clone().add(tick), b.clone().sub(tick)];
        const geo = new THREE.BufferGeometry().setFromPoints([pts[0], pts[1], pts[2], pts[3], pts[4], pts[5]]);
        owned.push(geo);
        dims.add(new THREE.LineSegments(geo, lineMat));
        const tag = tagSprite(text);
        owned.push(tag);
        tag.sprite.position.copy(a).add(b).multiplyScalar(0.5);
        tag.sprite.userData.dim = true;
        dims.add(tag.sprite);
      };
      const out = 2.2;
      const tall = Math.max(s.heightFt, s.peakFt ?? 0);
      dim(new THREE.Vector3(-ox, 0.05, oz + out), new THREE.Vector3(ox, 0.05, oz + out), feetInches(s.widthFt), new THREE.Vector3(0, 0, 0.4));
      dim(new THREE.Vector3(ox + out, 0.05, -oz), new THREE.Vector3(ox + out, 0.05, oz), feetInches(s.depthFt), new THREE.Vector3(0.4, 0, 0));
      if (s.heightFt > 0.5) dim(new THREE.Vector3(ox + out, 0, oz + out), new THREE.Vector3(ox + out, s.heightFt, oz + out), feetInches(s.heightFt), new THREE.Vector3(0.3, 0, 0.3));
      if (tall > s.heightFt + 1) dim(new THREE.Vector3(-ox - out, 0, oz + out), new THREE.Vector3(-ox - out, tall, oz + out), feetInches(tall), new THREE.Vector3(0.3, 0, 0.3));
      dims.userData.dims = true;
      group.add(dims);

      return {
        group,
        layers,
        sawn,
        polys,
        braces,
        diagonal,
        rank,
        fade,
        lightMat,
        pointLights,
        callouts,
        handles,
        knobs,
        knobLabels,
        leaders,
        liveBoxes,
        centres,
        scene: s,
        dispose: () => {
          for (const k of knobs) k.remove();
          for (const t of knobLabels) t.remove();
          for (const l of leaders) l.remove();
          for (const o of owned) o.dispose();
          for (const l of layers) for (const { mesh } of l) mesh.dispose();
        },
      };
    };

    const apply = () => {
      if (!content) return;
      const b = builtRef.current;
      const x = xrayRef.current;
      const nightTime = nightRef.current;
      const share = (L: number) => (content!.rank[L] < 0 ? 1 : Math.min(1, Math.max(0, b - content!.rank[L])));
      content.layers.forEach((meshes, L) => {
        const f = share(L);
        for (const { mesh, total } of meshes) {
          mesh.count = Math.round(f * total);
          mesh.visible = mesh.count > 0;
        }
      });
      const braceShare = share(BRACE);
      content.braces.forEach((m, i) => (m.visible = i < Math.round(braceShare * content!.braces.length)));
      for (const m of content.sawn) {
        const f = share(m.userData.layer as number);
        const n = (m.userData.cohortOf as number) || 1;
        m.visible = Math.round(f * n) > (m.userData.cohort as number);
      }
      if (content.diagonal) {
        const f = share(DECKING);
        const boards = Math.round(f * content.diagonal.ends.length);
        content.diagonal.mesh.visible = boards > 0;
        content.diagonal.mesh.geometry.setDrawRange(0, boards > 0 ? content.diagonal.ends[boards - 1] : 0);
      }
      content.polys.forEach((p, L) => {
        if (!p) return;
        const f = share(L);
        const n = Math.round(f * p.ends.length);
        p.mesh.visible = n > 0;
        p.mesh.geometry.setDrawRange(0, n > 0 ? p.ends[n - 1] : 0);
      });
      for (const m of content.fade) {
        const mm = m as THREE.MeshStandardMaterial;
        const glassy = mm.userData.base && (mm.opacity === 0.35 || mm.opacity === 0.5 || mm.opacity === 0.55);
        if (glassy) continue;
        m.transparent = x;
        m.opacity = x ? 0.2 : 1;
        m.depthWrite = !x;
        m.needsUpdate = true;
      }
      groundMat.opacity = x ? 0.55 : 1;
      groundMat.depthWrite = !x;
      groundMat.needsUpdate = true;
      // Night: the sun under, the sky dark, the fixtures lit.
      tuneSky(sky, nightTime);
      (sky.material as THREE.ShaderMaterial).uniformsNeedUpdate = true;
      (world.fog as THREE.Fog).color.copy(nightTime ? HAZE_NIGHT : HAZE_DAY);
      hemi.intensity = nightTime ? 0.2 : 0.75;
      hemi.color.set(nightTime ? 0x3a4a6a : 0xcfe0ff);
      key.intensity = nightTime ? 0.08 : 2.3;
      key.color.set(nightTime ? 0x9fb4ff : 0xfff4e6);
      world.environmentIntensity = nightTime ? 0.06 : 0.45;
      renderer.toneMappingExposure = nightTime ? 0.95 : 0.9;
      if (content.lightMat) content.lightMat.emissiveIntensity = nightTime ? 3.2 : 0.15;
      const lightShare = share(LIGHT);
      for (const pl of content.pointLights) pl.intensity = nightTime && lightShare >= 1 ? 55 : 0;
      for (const c of content.callouts) c.visible = connRef.current;
      for (const h of content.handles) h.visible = editRef.current;
      for (const k of content.knobs) k.style.display = editRef.current ? "grid" : "none";
      if (!editRef.current) {
        for (const t of content.knobLabels) t.style.display = "none";
        for (const l of content.leaders) l.style.display = "none";
      }
      if (!editRef.current && drag && drag.handle.kind !== "builtin" && drag.handle.kind !== "opening") {
        setDragging(null);
        drag = null;
        orbit.enabled = !live;
        renderer.domElement.style.cursor = "";
      }
      renderer.domElement.style.cursor = placingRef.current ? "crosshair" : "";
      // The view bar steps aside while a part is being placed or a knob dragged — the host's banner has that corner then.
      if (viewBar) viewBar.style.display = placingRef.current || editRef.current ? "none" : "flex";
      invalidate();
      shadowsDirty = true;
    };

    /** Fly the camera to a point (scene feet), framing a part `size` ft across. */
    const flyTo = (p: [number, number, number], size = 4) => {
      const s = sceneRef.current;
      const target = new THREE.Vector3(p[0] - s.widthFt / 2, p[2], p[1] - s.depthFt / 2);
      const dir = camera.position.clone().sub(orbit.target).normalize();
      if (dir.lengthSq() < 0.01) dir.set(0.6, 0.4, 0.7).normalize();
      const dist = Math.max(2.5, size * 2.2);
      const from = camera.position.clone();
      const fromT = orbit.target.clone();
      const to = target.clone().add(dir.multiplyScalar(dist));
      const t0 = performance.now();
      const step = () => {
        const t = Math.min(1, (performance.now() - t0) / 650);
        const e = 1 - Math.pow(1 - t, 3);
        camera.position.lerpVectors(from, to, e);
        orbit.target.lerpVectors(fromT, target, e);
        orbit.update();
        invalidate();
        if (t < 1) requestAnimationFrame(step);
      };
      step();
    };

    /** The camera moved to a side of the structure, eased like a fly-to; "spin" takes it once around. A drag stops a spin. */
    let spinRaf = 0;
    const stopSpin = () => {
      if (spinRaf) cancelAnimationFrame(spinRaf);
      spinRaf = 0;
    };
    renderer.domElement.addEventListener("pointerdown", stopSpin);
    const calmMoves = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    /** Ease the camera (and what it looks at) to a new place, like a fly-to (at once, for reduced motion). */
    const glide = (to: THREE.Vector3, target: THREE.Vector3, ms = 700) => {
      const from0 = camera.position.clone();
      const fromT = orbit.target.clone();
      const t0 = performance.now();
      const step = () => {
        const t = calmMoves ? 1 : Math.min(1, (performance.now() - t0) / ms);
        const e = 1 - Math.pow(1 - t, 3);
        camera.position.lerpVectors(from0, to, e);
        orbit.target.lerpVectors(fromT, target, e);
        orbit.update();
        invalidate();
        spinRaf = t < 1 ? requestAnimationFrame(step) : 0;
      };
      step();
    };
    const lookFrom = (from: DeckLook) => {
      stopSpin();
      // Zoom and turn: around what the camera looks at now, from where it stands now.
      if (from === "in" || from === "out") {
        const off = camera.position.clone().sub(orbit.target);
        const dist = THREE.MathUtils.clamp(off.length() * (from === "in" ? 0.72 : 1.38), orbit.minDistance, orbit.maxDistance);
        glide(orbit.target.clone().add(off.setLength(dist)), orbit.target.clone(), 380);
        return;
      }
      if (from === "turn-left" || from === "turn-right") {
        const off = camera.position.clone().sub(orbit.target).applyAxisAngle(new THREE.Vector3(0, 1, 0), (from === "turn-left" ? -1 : 1) * (Math.PI / 6));
        glide(orbit.target.clone().add(off), orbit.target.clone(), 450);
        return;
      }
      setBelow(from === "under");
      markView(from === "top" || from === "under" ? from : from === "yard" || from === "front" ? "yard" : null);
      const s = sceneRef.current;
      const peak = Math.max(s.heightFt, s.peakFt ?? s.heightFt, s.house && !backdropRef.current ? s.house.heightFt : 0);
      const size = Math.max(s.widthFt, s.depthFt, peak * 1.4, 10);
      const narrow = Math.max(1, 1.4 / Math.max(0.3, camera.aspect));
      const target = new THREE.Vector3(0, Math.max(1, peak * 0.45), 0);
      if (from === "spin") {
        const t0 = performance.now();
        const center = orbit.target.clone();
        const start = camera.position.clone().sub(center);
        const turn = () => {
          const t = Math.min(1, (performance.now() - t0) / 9000);
          const a = t * Math.PI * 2;
          const off = start.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), a);
          camera.position.copy(center).add(off);
          orbit.update();
          invalidate();
          spinRaf = t < 1 ? requestAnimationFrame(turn) : 0;
        };
        spinRaf = requestAnimationFrame(turn);
        return;
      }
      let to: THREE.Vector3;
      switch (from) {
        case "top":
          // Straight down would leave the orbit without a "forward"; a hair toward the yard keeps the deck square on screen.
          to = new THREE.Vector3(0, size * 1.9 * narrow, size * 0.08);
          break;
        case "under":
          // UNDER THE DECK (2026-10-22): the camera below the ground — the lawn is seen from above only, so it falls away
          // — looking up and in at the framing: joists, beams, posts, footings, from the front corner toward the house.
          target.set(0, Math.max(0.6, s.heightFt * 0.7), -s.depthFt * 0.1);
          to = new THREE.Vector3(size * 0.32, -Math.max(2.5, size * 0.16), s.depthFt * 0.3 + size * 0.22);
          break;
        case "left":
          to = new THREE.Vector3(-size * 1.5 * narrow, size * 0.42 + peak * 0.2, size * 0.25);
          break;
        case "right":
          to = new THREE.Vector3(size * 1.5 * narrow, size * 0.42 + peak * 0.2, size * 0.25);
          break;
        case "house":
          // Standing at the back door, eye height on the deck, looking out to the yard.
          target.set(0, s.heightFt + 3.5, s.depthFt / 2 + 6);
          to = new THREE.Vector3(0, s.heightFt + 5.3, -s.depthFt / 2 + 0.8);
          break;
        default:
          to = new THREE.Vector3(size * 0.15, size * 0.42 + peak * 0.25, size * 1.55 * narrow);
      }
      const from0 = camera.position.clone();
      const fromT = orbit.target.clone();
      const t0 = performance.now();
      const step = () => {
        const t = Math.min(1, (performance.now() - t0) / 800);
        const e = 1 - Math.pow(1 - t, 3);
        camera.position.lerpVectors(from0, to, e);
        orbit.target.lerpVectors(fromT, target, e);
        orbit.update();
        invalidate();
        if (t < 1) spinRaf = requestAnimationFrame(step);
        else spinRaf = 0;
      };
      step();
    };

    // What a rebuild or a new light replaces is disposed after the next frame is drawn, not before: the new parts' materials
    // take over the old ones' compiled shaders instead of compiling them again (≈100 ms a rebuild).
    let rebuildRaf = 0;
    let rebuildTimer: ReturnType<typeof setTimeout> | null = null;
    let retired: Array<{ dispose: () => void }> = [];
    const retire = (old: { dispose: () => void }) => {
      retired.push(old);
      if (retired.length > 4) retired.shift()!.dispose();
    };
    const rebuild = () => {
      if (rebuildRaf) cancelAnimationFrame(rebuildRaf);
      if (rebuildTimer) clearTimeout(rebuildTimer);
      rebuildRaf = 0;
      rebuildTimer = null;
      if (content) {
        world.remove(content.group);
        for (const k of content.knobs) k.remove();
        retire(content);
      }
      content = build();
      world.add(content.group);
      shadowsDirty = true;
      houseHidden = false;
      scenery.visible = !backdropRef.current;
      tiltGround();
      const s = sceneRef.current;
      const peak = Math.max(s.heightFt, s.peakFt ?? s.heightFt);
      const resized = !fitted || fitted.w !== s.widthFt || fitted.d !== s.depthFt || fitted.h !== peak;
      if (resized && !drag) frame(false);
      apply();
      api.current?.highlight();
      showLive();
      tryHold();
    };
    /** Rebuild once the page has painted: after the next frame's paint, coalescing every call until then. */
    const rebuildSoon = () => {
      if (rebuildRaf || rebuildTimer) return;
      rebuildRaf = requestAnimationFrame(() => {
        rebuildRaf = 0;
        rebuildTimer = setTimeout(() => {
          rebuildTimer = null;
          rebuild();
        }, 0);
      });
    };

    // THE FIELD BEING TYPED IN, SHOWN (2026-10-12): its part of the house in blueprint blue, through whatever stands in
    // front of it, breathing (still, for reduced motion), with a tag that keeps its size on the screen.
    const calm = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let lit: { group: THREE.Group; fill: THREE.MeshBasicMaterial; dispose: () => void } | null = null;
    const highlight = () => {
      if (lit) {
        world.remove(lit.group);
        retire(lit);
        lit = null;
      }
      const h = highlightRef.current;
      const any = !!h && (h.boxes.length > 0 || !!h.boxIdx?.length || !!h.polyIdx?.length || !!h.footings || !!h.diagonal || !!h.tag);
      mount.dataset.deck3dHighlight = h && any ? h.tag?.text ?? "on" : "";
      if (!h || !any) {
        invalidate();
        return;
      }
      const s = sceneRef.current;
      const { ox, oz } = origin(s);
      const group = new THREE.Group();
      const fill = new THREE.MeshBasicMaterial({ color: 0x2a6fd6, transparent: true, opacity: 0.32, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
      const line = new THREE.LineBasicMaterial({ color: 0x1854a0, transparent: true, opacity: 0.95, depthTest: false });
      const edges: THREE.BufferGeometry[] = [];
      for (const b of h.boxes) {
        const [x0, y0, z0, x1, y1, z1] = b;
        const sx = Math.max(0.05, x1 - x0);
        const sy = Math.max(0.05, y1 - y0);
        const sz = Math.max(0.05, z1 - z0);
        const at = new THREE.Vector3((x0 + x1) / 2 - ox, (z0 + z1) / 2, (y0 + y1) / 2 - oz);
        const m = new THREE.Mesh(unitBox, fill);
        m.position.copy(at);
        m.scale.set(sx, sz, sy);
        m.renderOrder = 30;
        group.add(m);
        const solid = new THREE.BoxGeometry(sx, sz, sy);
        const eg = new THREE.EdgesGeometry(solid);
        solid.dispose();
        edges.push(eg);
        const e = new THREE.LineSegments(eg, line);
        e.position.copy(at);
        e.renderOrder = 31;
        group.add(e);
      }
      // The scene's own parts: the same matrices the parts stand on, filled through everything in front of them.
      const sc = sceneRef.current;
      const legendRole = (i: number) => (sc.tags.length === sc.boxes.length && sc.tags[i] >= 0 ? sc.legend[sc.tags[i]]?.role ?? null : null);
      const all = (h.boxIdx ?? []).filter((i) => i >= 0 && i < sc.boxes.length);
      const idx = all.filter((i) => sc.boxes[i][7] === 0 && !memberIsSawn(sc.boxes[i], legendRole(i)));
      const extraGeos: THREE.BufferGeometry[] = [];
      if (idx.length) {
        const inst = new THREE.InstancedMesh(unitBox, fill, idx.length);
        const mm = new THREE.Matrix4();
        idx.forEach((bi, k) => inst.setMatrixAt(k, boxMatrix(sc.boxes[bi], legendRole(bi), ox, oz, mm)));
        inst.instanceMatrix.needsUpdate = true;
        inst.renderOrder = 30;
        group.add(inst);
      }
      // Sawn members (braces, mitred trim) light up as the exact shapes
      // they are — the lit copy used to be a square-ended stand-in that
      // did not lie on its part.
      for (const bi of all.filter((i) => memberIsSawn(sc.boxes[i], legendRole(i)))) {
        const geo = sawnGeometry(sc.boxes[bi], legendRole(bi), ox, oz);
        if (!geo) continue;
        extraGeos.push(geo);
        const m = new THREE.Mesh(geo, fill);
        m.renderOrder = 30;
        group.add(m);
      }
      // Flat faces (the roofing, a ceiling, a slab, walls): fans, both sides.
      const rings: number[][] = (h.polyIdx ?? []).filter((i) => i >= 0 && i < sc.polys.length).map((i) => sc.polys[i]);
      const fan = (pts: Array<[number, number, number]>, out: number[]) => {
        for (let k = 1; k + 1 < pts.length; k++) out.push(...pts[0], ...pts[k], ...pts[k + 1]);
      };
      const flat: number[] = [];
      for (const r of rings) {
        const pts: Array<[number, number, number]> = [];
        for (let k = 1; k + 2 < r.length; k += 3) pts.push([r[k] - ox, r[k + 2] + 0.02, r[k + 1] - oz]);
        fan(pts, flat);
      }
      // Shaped and diagonal boards: their tops.
      if (h.diagonal && sc.diagonal) {
        sc.diagonal.boards.forEach((ring, bi) => {
          const top = (sc.diagonal!.zs?.[bi] ?? sc.heightFt) + 0.02;
          const pts: Array<[number, number, number]> = [];
          for (let k = 0; k + 1 < ring.length; k += 2) pts.push([ring[k] - ox, top, ring[k + 1] - oz]);
          fan(pts, flat);
        });
      }
      if (flat.length) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.Float32BufferAttribute(flat, 3));
        extraGeos.push(geo);
        const sheet = new THREE.Mesh(geo, fill);
        sheet.renderOrder = 30;
        group.add(sheet);
      }
      // The footings: their piers, from the pad up to the top.
      if (h.footings && sc.footings.length) {
        const piers = new THREE.InstancedMesh(unitCyl, fill, sc.footings.length);
        const dummy = new THREE.Object3D();
        sc.footings.forEach((f, i) => {
          const [x, y, pad, thick, pier, depth, top] = f;
          const hgt = Math.max(0.05, depth + top);
          dummy.position.set(x - ox, top - hgt / 2, y - oz);
          dummy.scale.set(Math.max(pier, pad * 0.8), hgt, Math.max(pier, pad * 0.8));
          dummy.updateMatrix();
          piers.setMatrixAt(i, dummy.matrix);
          void thick;
        });
        piers.instanceMatrix.needsUpdate = true;
        piers.renderOrder = 30;
        group.add(piers);
      }
      let tag: ReturnType<typeof tagSprite> | null = null;
      if (h.tag) {
        tag = tagSprite(h.tag.text, true);
        tag.sprite.position.set(h.tag.x - ox, h.tag.z, h.tag.y - oz);
        tag.sprite.userData.dim = true;
        // Read at a glance: half again the size of a dimension's tag.
        tag.sprite.userData.boost = 1.6;
        tag.sprite.renderOrder = 32;
        group.add(tag.sprite);
      }
      world.add(group);
      lit = {
        group,
        fill,
        dispose: () => {
          fill.dispose();
          line.dispose();
          for (const g of edges) g.dispose();
          for (const g of extraGeos) g.dispose();
          tag?.dispose();
        },
      };
      invalidate();
    };

    api.current = {
      rebuild,
      rebuildSoon,
      apply,
      reset: () => frame(true),
      flyTo,
      lookFrom,
      highlight,
      hold: (key) => {
        pendingHold = key;
        tryHold();
      },
    };
    rebuild();
    highlight();

    // Picking: a touch names the part, a click flies to it (or places a fixture there).
    const ray = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let hover: { mesh: THREE.InstancedMesh; id: number; color: THREE.Color } | null = null;
    let downAt: { x: number; y: number; t: number } | null = null;
    const pickAt = (clientX: number, clientY: number): { pick: DeckPick; boxIdx: number | null; mesh: THREE.InstancedMesh | null; instanceId: number | null; calloutLegend: number | null } | null => {
      if (!content) return null;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(pointer, camera);
      const s = content.scene;
      const { ox, oz } = origin(s);
      // Callout tags first.
      if (connRef.current) {
        const tagHits = ray.intersectObjects(content.callouts.filter((c) => c.visible), false);
        if (tagHits.length) {
          const sp = tagHits[0].object as THREE.Sprite;
          const lg = s.legend[sp.userData.legend as number] ?? null;
          return { pick: { legend: lg, layer: null, point: [sp.position.x + ox, sp.position.z + oz, sp.position.y], mount: "deck" }, boxIdx: null, mesh: null, instanceId: null, calloutLegend: sp.userData.legend as number };
        }
      }
      const hits = ray.intersectObjects(content.group.children.filter((o) => o.visible && !(o instanceof THREE.Sprite) && !(o instanceof THREE.LineSegments) && !o.userData.dims && !o.userData.grab && !o.userData.live), true);
      // X-RAY IS SEE-THROUGH TO THE FINGER TOO (2026-11-09): with the boards, the roofing, the trim and the ceiling faded,
      // a touch goes through them to the frame behind — the rafter tie under the shingles, the beam behind the fascia —
      // so a part of the frame can be picked (and taken out or swapped) without turning the picture inside out.
      const through = (o: THREE.Object3D) => xrayRef.current && typeof o.userData.layer === "number" && FADES.has(o.userData.layer as number);
      const hit = hits.find((h) => h.object.visible && (h.object as THREE.Mesh).isMesh && !through(h.object));
      if (!hit) {
        const g = ray.intersectObject(ground, false)[0];
        if (!g) return null;
        return { pick: { legend: null, layer: "ground", point: [g.point.x + ox, g.point.z + oz, g.point.y], mount: "deck" }, boxIdx: null, mesh: null, instanceId: null, calloutLegend: null };
      }
      const obj = hit.object as THREE.Mesh;
      const L = obj.userData.layer as number | undefined;
      const point: [number, number, number] = [hit.point.x + ox, hit.point.z + oz, hit.point.y];
      if (L === -2) return { pick: { legend: null, layer: "house", point, mount: "wall" }, boxIdx: null, mesh: null, instanceId: null, calloutLegend: null };
      if (L === undefined || L < 0) return null;
      const layerName = SCENE_LAYERS[L];
      let boxIdx: number | null = null;
      let legend: SceneLegend | null = null;
      if (obj instanceof THREE.InstancedMesh && hit.instanceId !== undefined) {
        const entry = content.layers[L]?.find((e) => e.mesh === obj);
        boxIdx = entry?.boxIdx[hit.instanceId] ?? null;
        if (boxIdx !== null && s.tags.length === s.boxes.length && s.tags[boxIdx] >= 0) legend = s.legend[s.tags[boxIdx]] ?? null;
        return { pick: { legend, layer: layerName, point, mount: MOUNT_OF[layerName] ?? "deck", boxIdx }, boxIdx, mesh: obj, instanceId: hit.instanceId, calloutLegend: null };
      }
      if (content.diagonal && obj === content.diagonal.mesh && hit.faceIndex !== undefined && hit.faceIndex !== null) {
        // A board cut to a shape: which ring, by the face index (2026-11-14 — a step round a shaped deck is one).
        const idxEnd = (hit.faceIndex + 1) * 3;
        const ringIdx = content.diagonal.ends.findIndex((e) => idxEnd <= e);
        return { pick: { legend, layer: layerName, point, mount: MOUNT_OF[layerName] ?? "deck", boxIdx: null, ringIdx: ringIdx >= 0 ? ringIdx : null }, boxIdx: null, mesh: null, instanceId: null, calloutLegend: null };
      }
      if (typeof obj.userData.boxIdx === "number") {
        boxIdx = obj.userData.boxIdx as number;
        if (s.tags.length === s.boxes.length && s.tags[boxIdx] >= 0) legend = s.legend[s.tags[boxIdx]] ?? null;
      } else {
        // A polygon: which ring was hit, by the face index.
        const p = content.polys[L];
        if (p && hit.faceIndex !== undefined && hit.faceIndex !== null) {
          const idxEnd = (hit.faceIndex + 1) * 3;
          const k = p.ends.findIndex((e) => idxEnd <= e);
          const pi = k >= 0 ? p.polyIdx[k] : -1;
          if (pi >= 0 && s.polyTags.length === s.polys.length && s.polyTags[pi] >= 0) legend = s.legend[s.polyTags[pi]] ?? null;
        }
      }
      return { pick: { legend, layer: layerName, point, mount: MOUNT_OF[layerName] ?? "deck", boxIdx }, boxIdx, mesh: null, instanceId: null, calloutLegend: null };
    };
    const planePoint = (clientX: number, clientY: number, plane: THREE.Plane): THREE.Vector3 | null => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(pointer, camera);
      const out = new THREE.Vector3();
      return ray.ray.intersectPlane(plane, out) ? out : null;
    };
    const handleAt = (clientX: number, clientY: number): THREE.Mesh | null => {
      if (!content || !editRef.current) return null;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(pointer, camera);
      const hits = ray.intersectObjects(content.handles.filter((h) => h.visible && !h.userData.grab), false);
      if (hits[0]) return hits[0].object as THREE.Mesh;
      // A post or a beam, taken hold of by itself — only where it is what the pointer really touches: nothing solid
      // in front of it (the boards over a post seen from above), X-ray's faded layers aside.
      const grabs = ray.intersectObjects(content.handles.filter((h) => h.visible && h.userData.grab), false);
      if (!grabs[0]) return null;
      const through = (o: THREE.Object3D) => xrayRef.current && typeof o.userData.layer === "number" && FADES.has(o.userData.layer as number);
      const solid = ray
        .intersectObjects(content.group.children.filter((o) => o.visible && !(o instanceof THREE.Sprite) && !(o instanceof THREE.LineSegments) && !o.userData.dims && !o.userData.grab && !o.userData.live && o.userData.layer !== -3), true)
        .find((h) => h.object.visible && (h.object as THREE.Mesh).isMesh && !through(h.object));
      if (!solid) return null;
      // The nearest grab whose part is the thing hit: the solid point lies inside its box.
      const box = new THREE.Box3();
      for (const g of grabs) {
        if (g.distance > solid.distance + 0.02) break;
        box.setFromObject(g.object);
        if (box.containsPoint(solid.point)) return g.object as THREE.Mesh;
      }
      return null;
    };
    // ── THE ACCESSORY IN THE HAND (2026-11-15) ────────────────────────────────────────────────────────────────────────
    const liveLine = new THREE.LineBasicMaterial({ color: 0x2f7bff, depthTest: false, transparent: true, opacity: 0.95 });
    const liveRing = new THREE.LineDashedMaterial({ color: 0xf5a623, depthTest: false, transparent: true, opacity: 0.95, dashSize: 0.32, gapSize: 0.2 });
    let liveViz: { group: THREE.Group; geos: THREE.BufferGeometry[]; radius: number; surface: number } | null = null;
    const liveKey = (h: SceneHandle) => `${h.kind}:${h.id}`;
    const liveBox = (): THREE.Mesh | null => (live && content ? (content.liveBoxes.find((m) => liveKey(m.userData.handle as SceneHandle) === live) ?? null) : null);
    const clearLiveViz = () => {
      if (!liveViz) return;
      liveViz.group.removeFromParent();
      for (const g of liveViz.geos) g.dispose();
      liveViz = null;
    };
    /** Let it go: the camera works again. */
    const dropLive = () => {
      if (!live) return;
      live = null;
      liveDown = null;
      turning = null;
      sizing = null;
      clearLiveViz();
      liveBar.style.display = "none";
      turnKnob.style.display = "none";
      sizeW.style.display = "none";
      sizeH.style.display = "none";
      delete turnKnob.dataset.active;
      delete mount.dataset.deckLive;
      delete mount.dataset.deckLiveKind;
      if (!drag) orbit.enabled = true;
      renderer.domElement.style.cursor = "";
      invalidate();
    };
    // Outlined through whatever stands in front of it, with a dashed ring on the deck round it (the turn handle rides
    // on that ring, at its front) and a bar that names it. Drawn again after every rebuild — it moved.
    showLive = () => {
      clearLiveViz();
      if (!live) return;
      const box = liveBox();
      if (!box || !content) {
        dropLive();
        return;
      }
      const h = box.userData.handle as SceneHandle;
      const [len, dep, z0] = box.userData.size as [number, number, number];
      const g = new THREE.Group();
      g.userData.live = true;
      const geos: THREE.BufferGeometry[] = [];
      const edges = new THREE.EdgesGeometry(box.geometry);
      geos.push(edges);
      const wire = new THREE.LineSegments(edges, liveLine);
      wire.position.copy(box.position);
      wire.rotation.copy(box.rotation);
      wire.renderOrder = 20;
      g.add(wire);
      const radius = Math.hypot(len, dep) / 2 + 0.7;
      const turns = h.kind === "builtin" && typeof h.turn === "number";
      if (turns) {
        const pts: THREE.Vector3[] = [];
        for (let k = 0; k < 72; k++) {
          const a = (k / 72) * Math.PI * 2;
          pts.push(new THREE.Vector3(box.position.x + Math.cos(a) * radius, z0 + 0.04, box.position.z + Math.sin(a) * radius));
        }
        const rg = new THREE.BufferGeometry().setFromPoints(pts);
        geos.push(rg);
        const ring = new THREE.LineLoop(rg, liveRing);
        ring.computeLineDistances();
        ring.renderOrder = 20;
        g.add(ring);
      }
      content.group.add(g);
      liveViz = { group: g, geos, radius, surface: z0 };
      const off = turns ? Math.round(h.turn as number) % 90 : 0;
      liveText.textContent = "";
      const name = document.createElement("b");
      const opening = h.kind === "opening" && h.open ? h.open : null;
      if (opening) {
        // A window or a door: what it is and its size; what it can become; Remove.
        const now = openingChoiceOf(opening);
        name.textContent = `${now ? now.label : h.label} · ${feetInches(opening.w)} × ${feetInches(opening.h)}`;
        liveText.append(name, opening.kind === "window" ? " — drag it along the wall or up it; pull the handles on its side and top to size it." : " — drag it along the wall, or to the other floor; pull the handles on its side and top to size it.");
        liveChoices.textContent = "";
        for (const c of opening.kind === "window" ? WINDOW_CHOICES : opening.kind === "garage" ? [] : DOOR_CHOICES) {
          const b = document.createElement("button");
          b.type = "button";
          b.textContent = c.short;
          b.title = c.label;
          b.dataset.deckOpeningChoice = c.key;
          b.setAttribute("aria-pressed", String(now?.key === c.key));
          b.addEventListener("click", () => {
            const hh = liveBox()?.userData.handle as SceneHandle | undefined;
            if (hh) editCbRef.current?.({ kind: hh.kind, id: hh.id, value: hh.value, value2: hh.value2 ?? 0, choice: c.key, done: true });
          });
          liveChoices.appendChild(b);
        }
      } else {
        name.textContent = `${h.label}${off ? ` · turned ${off}°` : ""}`;
        liveText.append(name, turns ? " — drag it anywhere on the deck. The round handle turns it." : " — drag it to any open edge of the deck.");
      }
      liveChoices.style.display = opening && liveChoices.childElementCount ? "flex" : "none";
      liveRemove.style.display = opening ? "" : "none";
      liveMore.style.display = opening ? "none" : "";
      liveBar.style.display = "flex";
      if (!turns) turnKnob.style.display = "none";
      if (!opening) {
        sizeW.style.display = "none";
        sizeH.style.display = "none";
      }
      mount.dataset.deckLive = h.id;
      mount.dataset.deckLiveKind = h.kind;
      invalidate();
    };
    /** Taken in the hand: the camera stands still until it is let go. */
    const takeLive = (key: string) => {
      live = key;
      turning = null;
      sizing = null;
      orbit.enabled = false;
      stopSpin();
      clearHover();
      pickRef.current?.(null, "hover");
      showLive();
    };
    // Asked for by the host (the `hold` prop): taken once the picture has it — a new one is there only after the rebuild.
    tryHold = () => {
      if (!pendingHold || !content) return;
      const key = pendingHold;
      if (!content.liveBoxes.some((m) => liveKey(m.userData.handle as SceneHandle) === key)) return;
      pendingHold = null;
      if (live !== key) takeLive(key);
    };
    /** The accessory under the pointer — where it is what the pointer really touches (nothing solid in front of it); the one already in the hand, anywhere over it. */
    const liveAt = (clientX: number, clientY: number): THREE.Mesh | null => {
      if (!content || !content.liveBoxes.length) return null;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(pointer, camera);
      const through = (o: THREE.Object3D) => xrayRef.current && typeof o.userData.layer === "number" && FADES.has(o.userData.layer as number);
      const solid = ray
        .intersectObjects(content.group.children.filter((o) => o.visible && !(o instanceof THREE.Sprite) && !(o instanceof THREE.LineSegments) && !o.userData.dims && !o.userData.grab && !o.userData.live && o.userData.layer !== -3), true)
        .find((h) => h.object.visible && (h.object as THREE.Mesh).isMesh && !through(h.object));
      if (solid) {
        // The thing touched is the accessory's when it lies over its footprint, from the deck's boards up to 3 ft above
        // its own top (what stands on it is it too — the grill on a kitchen island, a bench's back).
        const local = new THREE.Vector3();
        for (const m of content.liveBoxes) {
          const prm = (m.geometry as THREE.BoxGeometry).parameters;
          m.worldToLocal(local.copy(solid.point));
          // (A window or a door: its glass and its trim on the wall — its sill and apron under it, its head cap over it.)
          const wall = (m.userData.handle as SceneHandle).kind === "opening";
          if (Math.abs(local.x) <= prm.width / 2 + (wall ? 0.3 : 0.01) && local.y >= -prm.height / 2 - (wall ? 0.5 : 0.01) && local.y <= prm.height / 2 + (wall ? 0.45 : 3) && Math.abs(local.z) <= prm.depth / 2 + 0.01) return m;
        }
      }
      const boxes = ray.intersectObjects(content.liveBoxes, false);
      if (!solid) return boxes.length ? (boxes[0].object as THREE.Mesh) : null;
      const held = live ? boxes.find((g) => liveKey(g.object.userData.handle as SceneHandle) === live) : undefined;
      return held ? (held.object as THREE.Mesh) : null;
    };
    /** Where the pointer meets the deck's walking surface (scene feet), and that point in the picture — null off the deck's outline. */
    const deckPoint = (clientX: number, clientY: number, surface: number): { x: number; y: number; at: THREE.Vector3 } | null => {
      if (!content) return null;
      const at = planePoint(clientX, clientY, new THREE.Plane(new THREE.Vector3(0, 1, 0), -surface));
      if (!at) return null;
      const { ox, oz } = origin(content.scene);
      const x = at.x + ox;
      const y = at.z + oz;
      const ring = content.scene.outline;
      let inside = false;
      for (let i = 0, j = ring.length - 2; i + 1 < ring.length; j = i, i += 2) {
        if (ring[i + 1] > y !== ring[j + 1] > y && x < ((ring[j] - ring[i]) * (y - ring[i + 1])) / (ring[j + 1] - ring[i + 1]) + ring[i]) inside = !inside;
      }
      return inside ? { x, y, at } : null;
    };
    /** In the hand, a press on the deck itself: it goes there, and follows the pointer from there. */
    /** The wall's own plane through a window or a door in the hand. */
    const wallPlane = (box: THREE.Mesh) => new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 0, 1), box.position);
    /** In the hand, a window or a door: a press on the house's wall sends it there (its middle under the pointer), and it follows from there. */
    const wallJump = (e: PointerEvent): boolean => {
      const box = liveBox();
      const h = box?.userData.handle as SceneHandle | undefined;
      if (!box || !h || h.kind !== "opening" || !h.open || !content) return false;
      if (pickAt(e.clientX, e.clientY)?.pick.layer !== "house") return false;
      const plane = wallPlane(box);
      const at = planePoint(e.clientX, e.clientY, plane);
      if (!at) return false;
      const vx = Math.round((at.x + origin(content.scene).ox) * 12) / 12;
      const vy = Math.max(0, Math.round((at.y - h.open.h / 2) * 12) / 12);
      drag = { handle: { ...h, value: vx, value2: vy }, plane, start: at, last: vx, last2: vy };
      setDragging(`${h.kind}:${h.id}`);
      pinned = origin(sceneRef.current);
      orbit.enabled = false;
      renderer.domElement.style.cursor = "grabbing";
      try {
        renderer.domElement.setPointerCapture(e.pointerId);
      } catch {
        /* the drag still works while the pointer stays over the canvas */
      }
      editCbRef.current?.({ kind: h.kind, id: h.id, value: vx, value2: vy, done: false });
      return true;
    };
    const liveJump = (e: PointerEvent): boolean => {
      const box = liveBox();
      if (!box) return false;
      const h = box.userData.handle as SceneHandle;
      if (h.kind === "opening") return wallJump(e);
      const surface = (box.userData.size as number[])[2];
      const p = deckPoint(e.clientX, e.clientY, surface);
      if (!p) return false;
      const vx = Math.round(p.x * 24) / 2;
      const vy = Math.round(p.y * 24) / 2;
      drag = { handle: { ...h, value: vx, value2: vy }, plane: new THREE.Plane(new THREE.Vector3(0, 1, 0), -surface), start: p.at, last: vx, last2: vy };
      setDragging(`${h.kind}:${h.id}`);
      pinned = origin(sceneRef.current);
      orbit.enabled = false;
      renderer.domElement.style.cursor = "grabbing";
      try {
        renderer.domElement.setPointerCapture(e.pointerId);
      } catch {
        /* the drag still works while the pointer stays over the canvas */
      }
      editCbRef.current?.({ kind: h.kind, id: h.id, value: vx, value2: vy, done: false });
      return true;
    };
    // ITS ROUND HANDLE: dragged round its middle, it turns to face where the pointer is — any angle (the engine holds
    // it square to the deck's edges when near, lib/deck/accessories snapTurn); the arrow keys turn it 15° at a time.
    const wrap360 = (deg: number) => ((Math.round(deg) % 360) + 360) % 360;
    const turnApart = (a: number, b: number) => {
      const d = Math.abs(wrap360(a - b));
      return Math.min(d, 360 - d);
    };
    const sendTurn = (deg: number, done: boolean) => {
      const h = liveBox()?.userData.handle as SceneHandle | undefined;
      if (h) editCbRef.current?.({ kind: h.kind, id: h.id, value: h.value, value2: h.value2 ?? 0, turn: wrap360(deg), done });
    };
    const turnFromPointer = (clientX: number, clientY: number): number | null => {
      const box = liveBox();
      if (!box || !liveViz) return null;
      const p = planePoint(clientX, clientY, new THREE.Plane(new THREE.Vector3(0, 1, 0), -liveViz.surface));
      if (!p) return null;
      const dx = p.x - box.position.x;
      const dz = p.z - box.position.z;
      if (Math.hypot(dx, dz) < 0.15) return null;
      // The handle stands at its front — a quarter turn to the left of the way its length runs.
      return wrap360((Math.atan2(dz, dx) * 180) / Math.PI - 90);
    };
    const turnEnd = (send: boolean) => {
      if (!turning) return;
      const t = turning.angle;
      turning = null;
      delete turnKnob.dataset.active;
      if (send) sendTurn(t, true);
      invalidate();
    };
    turnKnob.addEventListener("pointerdown", (e) => {
      const h = liveBox()?.userData.handle as SceneHandle | undefined;
      if (!h || typeof h.turn !== "number") return;
      e.preventDefault();
      turning = { id: h.id, angle: h.turn, last: h.turn };
      turnKnob.dataset.active = "";
      try {
        turnKnob.setPointerCapture(e.pointerId);
      } catch {
        /* it still turns while the pointer stays over the handle */
      }
    });
    turnKnob.addEventListener("pointermove", (e) => {
      if (!turning) return;
      const t = turnFromPointer(e.clientX, e.clientY);
      if (t === null) return;
      turning.angle = t;
      invalidate();
      if (turnApart(t, turning.last) < 2) return;
      turning.last = t;
      sendTurn(t, false);
    });
    turnKnob.addEventListener("pointerup", () => turnEnd(true));
    turnKnob.addEventListener("pointercancel", () => turnEnd(false));
    turnKnob.addEventListener("keydown", (e) => {
      const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
      const h = liveBox()?.userData.handle as SceneHandle | undefined;
      if (!dir || !h || typeof h.turn !== "number") return;
      e.preventDefault();
      sendTurn(h.turn + dir * (e.shiftKey ? 45 : 15), true);
    });
    const liveLetGo = () => {
      if (!live) return;
      dropLive();
      pickRef.current?.(null, "click");
    };
    // A WINDOW'S OR A DOOR'S SIZE (2026-11-15): the handle on its side makes it wider or narrower (its other side
    // stays where it is), the one on its top taller or shorter — an inch at a time; the arrow keys too.
    const sendSize = (which: "w" | "h", to: number, done: boolean) => {
      const h = liveBox()?.userData.handle as SceneHandle | undefined;
      if (!h || !h.open) return;
      const v = Math.max(1, Math.round(to * 12) / 12);
      if (which === "w") editCbRef.current?.({ kind: h.kind, id: h.id, value: Math.round((h.value - h.open.w / 2 + v / 2) * 12) / 12, value2: h.value2 ?? 0, w: v, done });
      else editCbRef.current?.({ kind: h.kind, id: h.id, value: h.value, value2: h.value2 ?? 0, h: v, done });
    };
    const sizeFromPointer = (which: "w" | "h", clientX: number, clientY: number): number | null => {
      const box = liveBox();
      const h = box?.userData.handle as SceneHandle | undefined;
      if (!box || !h || !h.open || !content) return null;
      const p = planePoint(clientX, clientY, wallPlane(box));
      if (!p) return null;
      return which === "w" ? p.x + origin(content.scene).ox - (h.value - h.open.w / 2) : p.y - (h.value2 ?? 0);
    };
    for (const [which, knob] of [["w", sizeW], ["h", sizeH]] as const) {
      knob.addEventListener("pointerdown", (e) => {
        const h = liveBox()?.userData.handle as SceneHandle | undefined;
        if (!h || !h.open) return;
        e.preventDefault();
        sizing = { which, last: which === "w" ? h.open.w : h.open.h };
        knob.dataset.active = "";
        try {
          knob.setPointerCapture(e.pointerId);
        } catch {
          /* it still sizes while the pointer stays over the handle */
        }
      });
      knob.addEventListener("pointermove", (e) => {
        if (!sizing) return;
        const v = sizeFromPointer(which, e.clientX, e.clientY);
        if (v === null || Math.abs(v - sizing.last) < 1 / 12 - 1e-6) return;
        sizing.last = v;
        sendSize(which, v, false);
      });
      const end = (send: boolean) => {
        if (!sizing) return;
        const v = sizing.last;
        sizing = null;
        delete knob.dataset.active;
        if (send) sendSize(which, v, true);
      };
      knob.addEventListener("pointerup", () => end(true));
      knob.addEventListener("pointercancel", () => end(false));
      knob.addEventListener("keydown", (e) => {
        const dir = which === "w" ? (e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0) : e.key === "ArrowUp" ? 1 : e.key === "ArrowDown" ? -1 : 0;
        const h = liveBox()?.userData.handle as SceneHandle | undefined;
        if (!dir || !h || !h.open) return;
        e.preventDefault();
        sendSize(which, (which === "w" ? h.open.w : h.open.h) + (dir * (e.shiftKey ? 6 : 1)) / 12, true);
      });
    }
    liveRemove.addEventListener("click", () => {
      const h = liveBox()?.userData.handle as SceneHandle | undefined;
      if (h && h.kind === "opening") editCbRef.current?.({ kind: h.kind, id: h.id, value: h.value, value2: h.value2 ?? 0, remove: true, done: true });
    });
    liveDone.addEventListener("click", liveLetGo);
    /** The accessory in the hand as a part to open a card on: one of its own boxes, where it stands now (the host names the accessory from it). */
    const livePick = (): DeckPick | null => {
      const h = liveBox()?.userData.handle as SceneHandle | undefined;
      const f = h?.foot;
      if (!content || !h || !h.grab || !f || f.length !== 8) return null;
      const s = content.scene;
      const inFoot = (x: number, y: number) => {
        let c = false;
        for (let i = 0, j = 6; i < 8; j = i, i += 2) if (f[i + 1] > y !== f[j + 1] > y && x < ((f[j] - f[i]) * (y - f[i + 1])) / (f[j + 1] - f[i + 1]) + f[i]) c = !c;
        return c;
      };
      const [, , z0, , , z1] = h.grab;
      const i = s.tags.length === s.boxes.length ? s.boxes.findIndex((b, k) => s.tags[k] >= 0 && b[3] > z0 + 0.02 && b[3] < z1 + 0.5 && inFoot(b[1], b[2]) && /^(?:bench|planter|screen|kitchen|fire) /.test(s.legend[s.tags[k]]?.role ?? "")) : -1;
      if (i < 0) return null;
      const layerName = SCENE_LAYERS[s.boxes[i][0]];
      return { legend: s.legend[s.tags[i]] ?? null, layer: layerName, point: [s.boxes[i][1], s.boxes[i][2], s.boxes[i][3]], mount: MOUNT_OF[layerName] ?? "deck", boxIdx: i };
    };
    liveMore.addEventListener("click", () => {
      const pick = livePick();
      if (pick) pickRef.current?.(pick, "click");
    });
    const onLiveKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && live && !drag) liveLetGo();
    };
    window.addEventListener("keydown", onLiveKey);
    const liveV = new THREE.Vector3();
    /** The turn handle onto the screen: on the ring, at the accessory's front (where the pointer holds it, while it is turned). */
    const placeLive = () => {
      const box = liveBox();
      const h = box?.userData.handle as SceneHandle | undefined;
      if (box && h && h.kind === "opening" && h.open) {
        // A window's or a door's size handles: beside the middle of its right side and over the middle of its top —
        // OUTSIDE it by a handle's width on the screen, so a small window far off is still taken by its own glass
        // (on the stand the handles covered a 3-ft window, and a press on its middle pulled its width).
        turnKnob.style.display = "none";
        const depth = ((box.geometry as THREE.BoxGeometry).parameters.depth ?? 0.5) / 2;
        const cw = renderer.domElement.clientWidth;
        const ch = renderer.domElement.clientHeight;
        liveV.set(box.position.x, box.position.y, box.position.z + depth).project(camera);
        const mid = { x: ((liveV.x + 1) / 2) * cw, y: ((1 - liveV.y) / 2) * ch };
        for (const [knob, dx, dy, fx, fy] of [[sizeW, h.open.w / 2, 0, 1, 0], [sizeH, 0, h.open.h / 2, 0, -1]] as const) {
          liveV.set(box.position.x + dx, box.position.y + dy, box.position.z + depth).project(camera);
          if (liveV.z > 1 || Math.abs(liveV.x) > 1.05 || Math.abs(liveV.y) > 1.05) {
            knob.style.display = "none";
            continue;
          }
          const ex = ((liveV.x + 1) / 2) * cw;
          const ey = ((1 - liveV.y) / 2) * ch;
          const len = Math.hypot(ex - mid.x, ey - mid.y);
          const ux = len > 1 ? (ex - mid.x) / len : fx;
          const uy = len > 1 ? (ey - mid.y) / len : fy;
          const out = knobSize / 2 + 8;
          knob.style.display = "grid";
          knob.style.transform = `translate(${Math.min(cw - 6, Math.max(6, ex + ux * out)).toFixed(1)}px, ${Math.min(ch - 6, Math.max(6, ey + uy * out)).toFixed(1)}px)`;
        }
        return;
      }
      if (!box || !h || !liveViz || typeof h.turn !== "number") {
        turnKnob.style.display = "none";
        return;
      }
      const t = ((turning ? turning.angle : h.turn) * Math.PI) / 180;
      liveV.set(box.position.x - Math.sin(t) * liveViz.radius, liveViz.surface + 0.05, box.position.z + Math.cos(t) * liveViz.radius).project(camera);
      if (liveV.z > 1 || Math.abs(liveV.x) > 1.05 || Math.abs(liveV.y) > 1.05) {
        turnKnob.style.display = "none";
        return;
      }
      turnKnob.style.display = "grid";
      turnKnob.style.transform = `translate(${(((liveV.x + 1) / 2) * renderer.domElement.clientWidth).toFixed(1)}px, ${(((1 - liveV.y) / 2) * renderer.domElement.clientHeight).toFixed(1)}px)`;
    };

    const dragStart = (mesh: THREE.Mesh, clientX: number, clientY: number) => {
      const h = mesh.userData.handle as SceneHandle;
      const at = mesh.getWorldPosition(new THREE.Vector3());
      // Horizontal axes drag on the horizontal plane through the handle; a height drags on a vertical plane facing the camera.
      // (A window or a door, "xz": on the wall's own plane — along the house and up it.)
      const plane = h.axis === "xz" ? new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 0, 1), at) : h.axis === "z" ? new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(camera.position.x - at.x, 0, camera.position.z - at.z).normalize(), at) : new THREE.Plane(new THREE.Vector3(0, 1, 0), -at.y);
      const start = planePoint(clientX, clientY, plane);
      if (!start) return;
      drag = { handle: h, plane, start, last: h.value, ...(h.axis === "xy" || h.axis === "xz" ? { last2: h.value2 ?? 0 } : {}) };
      setDragging(`${h.kind}:${h.id}`);
      pinned = origin(sceneRef.current);
      orbit.enabled = false;
      renderer.domElement.style.cursor = h.grab ? "grabbing" : h.axis === "z" ? "ns-resize" : "move";
    };
    const dragMove = (clientX: number, clientY: number, done: boolean) => {
      if (!drag) return;
      const p = planePoint(clientX, clientY, drag.plane);
      if (!p) return;
      const h = drag.handle;
      // ALONG THE WALL AND UP IT (2026-11-15: a window or a door): its middle and its sill, an inch at a time.
      if (h.axis === "xz") {
        const vx = Math.round((h.value + (p.x - drag.start.x) / h.perUnit) * 12) / 12;
        const vy = Math.max(0, Math.round(((h.value2 ?? 0) + (p.y - drag.start.y) / h.perUnit) * 12) / 12);
        if (!done && Math.abs(vx - drag.last) < 1 / 12 - 1e-6 && Math.abs(vy - (drag.last2 ?? 0)) < 1 / 12 - 1e-6) return;
        drag.last = vx;
        drag.last2 = vy;
        editCbRef.current?.({ kind: h.kind, id: h.id, value: vx, value2: vy, done });
        if (done) {
          drag = null;
          setDragging(null);
          pinned = null;
          orbit.enabled = !live;
          renderer.domElement.style.cursor = "";
        }
        return;
      }
      // ACROSS THE DECK (2026-11-14: an accessory): both ways at once — along the house and out from it.
      if (h.axis === "xy") {
        const vx = h.value + (p.x - drag.start.x) / h.perUnit;
        const vy = (h.value2 ?? 0) + (p.z - drag.start.z) / h.perUnit;
        if (!done && Math.hypot(vx - drag.last, vy - (drag.last2 ?? h.value2 ?? 0)) < 2) return;
        drag.last = vx;
        drag.last2 = vy;
        editCbRef.current?.({ kind: h.kind, id: h.id, value: vx, value2: vy, done });
        if (done) {
          drag = null;
          setDragging(null);
          pinned = null;
          orbit.enabled = !live;
          renderer.domElement.style.cursor = "";
        }
        return;
      }
      const d = h.axis === "x" ? p.x - drag.start.x : h.axis === "y" ? p.z - drag.start.z : p.y - drag.start.y;
      // `follow`: a handle on something that grows both ways about its centre (a stair's width) travels half the
      // change, so the change is twice the drag to keep it under the pointer.
      const value = h.value + d / h.perUnit / (h.follow ?? 1);
      // Half a foot or an inch at a time: the deck re-frames on every value sent.
      if (!done && Math.abs(value - drag.last) < (h.perUnit === 1 ? 0.5 : 1)) return;
      drag.last = value;
      editCbRef.current?.({ kind: h.kind, id: h.id, value, done });
      if (done) {
        drag = null;
        setDragging(null);
        pinned = null;
        orbit.enabled = !live;
        renderer.domElement.style.cursor = "";
      }
    };
    const clearHover = () => {
      if (hover) {
        hover.mesh.setColorAt(hover.id, hover.color);
        if (hover.mesh.instanceColor) hover.mesh.instanceColor.needsUpdate = true;
        hover = null;
        invalidate();
      }
    };
    const knobDown = (e: PointerEvent, mesh: THREE.Mesh, knob: HTMLButtonElement) => {
      dragStart(mesh, e.clientX, e.clientY);
      try {
        knob.setPointerCapture(e.pointerId);
      } catch {
        /* the canvas picks the drag up */
      }
    };
    const hoverHandle = (h: SceneHandle) => {
      clearHover();
      const now = h.axis === "xy" ? "drag it across the deck" : h.shown ? `${feetInches(Math.max(0, h.shown.sign * (h.value - h.shown.origin)) / 12)} ${h.shown.from}` : h.kind === "pitch" ? `${Math.round(h.value)}:12` : h.perUnit === 1 ? `${Math.round(h.value * 2) / 2} ft` : `${Math.round(h.value)} in.`;
      pickRef.current?.({ legend: { role: h.label, nominal: now, lengthFt: 0, count: 1, note: h.axis === "xy" ? "Drag it anywhere on the deck; turn it by the round handle. Bring it to the railing and it turns and lines up there." : h.grab ? "Drag it to move it, an inch at a time — or click it to type its place." : "Drag the knob, or press the arrow keys." }, layer: null, point: [h.x, h.y, h.z], mount: "deck" }, "hover");
    };
    const knobKey = (e: KeyboardEvent, h: SceneHandle) => {
      const dir = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 0;
      if (!dir) return;
      e.preventDefault();
      // (A knob that travels against its value — the deck's left end — goes the way its arrow key points.)
      const step = (h.perUnit === 1 ? 0.5 : 1) * (e.shiftKey ? 4 : 1) * ((h.follow ?? 1) < 0 && h.axis === "x" ? -1 : 1);
      editCbRef.current?.({ kind: h.kind, id: h.id, value: h.value + dir * step, done: true });
    };
    const onMove = (e: PointerEvent) => {
      if (drag) {
        dragMove(e.clientX, e.clientY, false);
        return;
      }
      // An accessory held and now pulled: it goes with the pointer at once.
      if (liveDown) {
        if (Math.hypot(e.clientX - liveDown.x, e.clientY - liveDown.y) < 4) return;
        const g = liveDown;
        liveDown = null;
        downAt = null;
        dragStart(g.mesh, g.x, g.y);
        if (drag) {
          try {
            renderer.domElement.setPointerCapture(e.pointerId);
          } catch {
            /* the drag still works while the pointer stays over the canvas */
          }
          dragMove(e.clientX, e.clientY, false);
        }
        return;
      }
      // With one in the hand the picture is still: the pointer only says what a press would do.
      if (live) {
        if (!coarse && !downAt) {
          const box = liveBox();
          const wall = box && (box.userData.handle as SceneHandle).kind === "opening";
          renderer.domElement.style.cursor = liveAt(e.clientX, e.clientY) ? "grab" : box && (wall ? pickAt(e.clientX, e.clientY)?.pick.layer === "house" : deckPoint(e.clientX, e.clientY, (box.userData.size as number[])[2])) ? "move" : "default";
        }
        return;
      }
      // A post or a beam held and now pulled: the drag starts where the pointer went down. Let go without pulling and
      // it was a click — its card opens, with its place to type.
      if (grabDown) {
        if (Math.hypot(e.clientX - grabDown.x, e.clientY - grabDown.y) < 5) return;
        const g = grabDown;
        grabDown = null;
        downAt = null;
        dragStart(g.mesh, g.x, g.y);
        if (drag) {
          try {
            renderer.domElement.setPointerCapture(e.pointerId);
          } catch {
            /* the drag still works while the pointer stays over the canvas */
          }
          dragMove(e.clientX, e.clientY, false);
        } else orbit.enabled = !live;
        return;
      }
      if (editRef.current && !downAt) {
        const hm = handleAt(e.clientX, e.clientY);
        if (hm) {
          const h = hm.userData.handle as SceneHandle;
          renderer.domElement.style.cursor = h.grab ? "grab" : h.axis === "z" ? "ns-resize" : "move";
          hoverHandle(h);
          return;
        }
      }
      if (coarse || downAt) return;
      const r = pickAt(e.clientX, e.clientY);
      // A part with no colour of its own per piece cannot be tinted (reading its colour threw, 2026-11-09): it is still named.
      if (!r || !r.mesh || r.instanceId === null || !r.mesh.instanceColor) {
        clearHover();
        renderer.domElement.style.cursor = placingRef.current ? "crosshair" : r?.mesh ? "pointer" : "";
        pickRef.current?.(r?.pick ?? null, "hover");
        return;
      }
      if (hover && hover.mesh === r.mesh && hover.id === r.instanceId) return;
      clearHover();
      const c = new THREE.Color();
      r.mesh.getColorAt(r.instanceId, c);
      hover = { mesh: r.mesh, id: r.instanceId, color: c.clone() };
      r.mesh.setColorAt(r.instanceId, c.clone().lerp(new THREE.Color(0x4f8cff), 0.55));
      if (r.mesh.instanceColor) r.mesh.instanceColor.needsUpdate = true;
      renderer.domElement.style.cursor = placingRef.current ? "crosshair" : "pointer";
      invalidate();
      pickRef.current?.(r.pick, "hover");
    };
    const onDown = (e: PointerEvent) => {
      // AN ACCESSORY (2026-11-15): a press on one takes it in the hand — the picture holds still — and a pull drags it;
      // with one in the hand, a press on the deck sends it there; a click anywhere else lets it go.
      if (!placingRef.current) {
        const acc = liveAt(e.clientX, e.clientY);
        if (acc) {
          const key = liveKey(acc.userData.handle as SceneHandle);
          if (live !== key) takeLive(key);
          liveDown = { mesh: acc, x: e.clientX, y: e.clientY };
          orbit.enabled = false;
          downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
          return;
        }
        if (live) {
          if (!liveJump(e)) downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
          return;
        }
      } else if (live) dropLive();
      const hm = handleAt(e.clientX, e.clientY);
      if (hm && hm.userData.grab) {
        // Held, not yet pulled: the view stays still under it; a click still reaches the part.
        grabDown = { mesh: hm, x: e.clientX, y: e.clientY };
        orbit.enabled = false;
        downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
        return;
      }
      if (hm) {
        dragStart(hm, e.clientX, e.clientY);
        try {
          renderer.domElement.setPointerCapture(e.pointerId);
        } catch {
          /* the drag still works while the pointer stays over the canvas */
        }
        return;
      }
      downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
    };
    const onUp = (e: PointerEvent) => {
      if (drag) {
        dragMove(e.clientX, e.clientY, true);
        return;
      }
      if (grabDown) {
        grabDown = null;
        orbit.enabled = !live;
      }
      // The accessory pressed and let go without a pull: it stays in the hand.
      if (liveDown) {
        liveDown = null;
        downAt = null;
        return;
      }
      // With one in the hand, a click off the deck lets it go: the picture moves again.
      if (live) {
        const dn = downAt;
        downAt = null;
        if (dn && Math.hypot(e.clientX - dn.x, e.clientY - dn.y) <= 6) liveLetGo();
        return;
      }
      const d = downAt;
      downAt = null;
      if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 || performance.now() - d.t > 600) return;
      const r = pickAt(e.clientX, e.clientY);
      if (!r) {
        pickRef.current?.(null, "click");
        return;
      }
      if (!placingRef.current && content && flyRef.current) {
        if (r.boxIdx !== null && content.centres[r.boxIdx]) {
          const [c, size] = content.centres[r.boxIdx];
          const s = sceneRef.current;
          flyTo([c.x + s.widthFt / 2, c.z + s.depthFt / 2, c.y], Math.min(8, Math.max(1.5, size)));
        } else if (r.calloutLegend !== null) flyTo(r.pick.point, 3);
      }
      pickRef.current?.(r.pick, "click");
    };
    const onLeave = () => {
      if (drag || live) return;
      clearHover();
      pickRef.current?.(null, "hover");
    };
    const onCancel = () => {
      liveDown = null;
      if (grabDown) {
        grabDown = null;
        orbit.enabled = !live;
      }
      if (drag) {
        drag = null;
        setDragging(null);
        pinned = null;
        orbit.enabled = !live;
        renderer.domElement.style.cursor = "";
      }
    };
    renderer.domElement.addEventListener("pointermove", onMove);
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);
    renderer.domElement.addEventListener("pointerleave", onLeave);
    renderer.domElement.addEventListener("pointercancel", onCancel);

    const knobV = new THREE.Vector3();
    const knobT = new THREE.Vector3();
    const KNOB_AXIS = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 0, 1), z: new THREE.Vector3(0, 1, 0) } as const;
    /** Every knob onto the screen, then apart: no two knobs closer than a knob and a gap, the held one never moved
     *  (it stays under the pointer); a knob pushed off its point gets a dashed leader back to it. Then the names, the
     *  hot one first and the deck's own size before the rest, each beside its knob on the first side that is clear. */
    const placeKnobs = () => {
      const c = content;
      if (!c) return;
      const w = renderer.domElement.clientWidth;
      const hgt = renderer.domElement.clientHeight;
      const r = knobSize / 2;
      const apart = knobSize + 8;
      const edge = r + 4;
      const clampX = (x: number) => Math.min(w - edge, Math.max(edge, x));
      const clampY = (y: number) => Math.min(hgt - edge, Math.max(edge, y));
      const held = drag ? `${drag.handle.kind}:${drag.handle.id}` : null;
      const spots: Array<{ i: number; key: string; ax: number; ay: number; x: number; y: number; pin: boolean; rank: number }> = [];
      c.handles.forEach((m, i) => {
        const k = c.knobs[i];
        if (!k) return;
        const h = m.userData.handle as SceneHandle;
        m.getWorldPosition(knobV);
        knobT.copy(knobV).add(KNOB_AXIS[h.axis === "xy" || h.axis === "xz" ? "x" : h.axis]);
        knobV.project(camera);
        knobT.project(camera);
        const off = knobV.z > 1 || Math.abs(knobV.x) > 1.05 || Math.abs(knobV.y) > 1.05;
        if (off) {
          k.style.display = "none";
          c.knobLabels[i].style.display = "none";
          c.leaders[i].style.display = "none";
          return;
        }
        k.style.display = "grid";
        const ax = ((knobV.x + 1) / 2) * w;
        const ay = ((1 - knobV.y) / 2) * hgt;
        const dx = ((knobT.x + 1) / 2) * w - ax;
        const dy = ((1 - knobT.y) / 2) * hgt - ay;
        // Straight at the camera, the axis has no screen direction: the arrow keeps the one it had.
        if (Math.hypot(dx, dy) > 1) (k.firstElementChild as SVGElement | null)?.style.setProperty("transform", `rotate(${Math.atan2(dy, dx).toFixed(3)}rad)`);
        const key = `${h.kind}:${h.id}`;
        spots.push({ i, key, ax, ay, x: clampX(ax), y: clampY(ay), pin: key === held, rank: key === hotKnob ? -1 : KNOB_RANK[h.kind] });
      });
      // Push overlapping knobs apart until none overlap (crowded far out, a dozen settle in a few dozen cheap passes); a pair on the same point splits
      // the same way every frame, so nothing flickers.
      for (let pass = 0; pass < 40; pass++) {
        let moved = false;
        for (let a = 0; a < spots.length; a++) {
          for (let b = a + 1; b < spots.length; b++) {
            const A = spots[a];
            const B = spots[b];
            if (A.pin && B.pin) continue;
            let dx = B.x - A.x;
            let dy = B.y - A.y;
            let d = Math.hypot(dx, dy);
            if (d >= apart) continue;
            if (d < 0.5) {
              dx = Math.cos(B.i * 2.399 + 0.6);
              dy = Math.sin(B.i * 2.399 + 0.6);
              d = 1;
            }
            const push = apart - d + 1;
            const share = A.pin ? 0 : B.pin ? 1 : 0.5;
            A.x = clampX(A.x - (dx / d) * push * share);
            A.y = clampY(A.y - (dy / d) * push * share);
            B.x = clampX(B.x + (dx / d) * push * (1 - share));
            B.y = clampY(B.y + (dy / d) * push * (1 - share));
            moved = true;
          }
        }
        if (!moved) break;
      }
      const taken: Array<[number, number, number, number]> = spots.map((s) => [s.x - r - 3, s.y - r - 3, s.x + r + 3, s.y + r + 3]);
      const clear = (x0: number, y0: number, x1: number, y1: number) => x0 >= 2 && y0 >= 2 && x1 <= w - 2 && y1 <= hgt - 2 && taken.every(([a0, b0, a1, b1]) => x1 <= a0 || x0 >= a1 || y1 <= b0 || y0 >= b1);
      for (const s of spots) {
        const k = c.knobs[s.i];
        k.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px)`;
        const leader = c.leaders[s.i];
        if (Math.hypot(s.x - s.ax, s.y - s.ay) > r * 0.6) {
          const [line, dot] = leader.children as unknown as [SVGLineElement, SVGCircleElement];
          line.setAttribute("x1", s.ax.toFixed(1));
          line.setAttribute("y1", s.ay.toFixed(1));
          line.setAttribute("x2", s.x.toFixed(1));
          line.setAttribute("y2", s.y.toFixed(1));
          dot.setAttribute("cx", s.ax.toFixed(1));
          dot.setAttribute("cy", s.ay.toFixed(1));
          leader.style.display = "";
        } else leader.style.display = "none";
      }
      // The names: outward from the middle of the picture first, so they cover the yard rather than the deck.
      for (const s of [...spots].sort((p, q) => p.rank - q.rank)) {
        const tag = c.knobLabels[s.i];
        const lw = Number(tag.dataset.w) || 60;
        const lh = 20;
        const right: [number, number] = [s.x + r + 5, s.y - lh / 2];
        const left: [number, number] = [s.x - r - 5 - lw, s.y - lh / 2];
        const above: [number, number] = [s.x - lw / 2, s.y - r - 5 - lh];
        const below: [number, number] = [s.x - lw / 2, s.y + r + 5];
        const sides = s.x >= w / 2 ? [right, left, above, below] : [left, right, above, below];
        const spot = sides.find(([x, y]) => clear(x, y, x + lw, y + lh));
        if (spot) {
          tag.style.transform = `translate(${spot[0].toFixed(1)}px, ${spot[1].toFixed(1)}px)`;
          tag.style.display = "block";
          taken.push([spot[0] - 2, spot[1] - 2, spot[0] + lw + 2, spot[1] + lh + 2]);
        } else tag.style.display = "none";
      }
    };

    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    let resizePending = false;
    let bufferWidth = w0;
    let bufferHeight = h0;
    let viewWidth = w0;
    let viewHeight = h0;
    let raf = 0;
    let breathTimer: ReturnType<typeof setTimeout> | null = null;
    let visible = true;
    let stopped = false;
    let breathAt = 0;
    const tick = () => {
      raf = 0;
      if (stopped || !visible || document.hidden) return;
      if (resizePending) {
        resizePending = false;
        if (bufferWidth !== viewWidth || bufferHeight !== viewHeight) {
          camera.aspect = viewWidth / viewHeight;
          camera.updateProjectionMatrix();
          renderer.setSize(viewWidth, viewHeight, false);
          bufferWidth = viewWidth;
          bufferHeight = viewHeight;
          dirty = true;
        }
      }
      if (lit && !calm) {
        const now = performance.now();
        if (now - breathAt >= 32) {
          breathAt = now;
          lit.fill.opacity = 0.2 + 0.22 * (0.5 + 0.5 * Math.sin((now / 1600) * Math.PI * 2));
          dirty = true;
        }
      }
      const moved = orbit.update();
      if (moved || dirty) {
        dirty = false;
        if (shadowsDirty) {
          renderer.shadowMap.needsUpdate = true;
          shadowsDirty = false;
        }
        // A tag keeps its size on the screen's scale of the deck, wherever the camera stands.
        if (content || lit) {
          const dist = camera.position.distanceTo(orbit.target);
          const size = Math.max(0.3, Math.min(span * 0.035, dist * 0.045));
          const fit = (o: THREE.Object3D) => {
            const k = (o.userData.boost as number | undefined) ?? 1;
            if (o instanceof THREE.Sprite && o.userData.dim) o.scale.set(size * k * (o.userData.aspect as number), size * k, 1);
          };
          content?.group.traverse(fit);
          lit?.group.traverse(fit);
        }
        // From under the lawn (Under), the house is only its underside: it steps out of the picture (2026-10-22).
        const underLawn = camera.position.y < groundAt(camera.position.x, camera.position.z) - 0.05;
        if (content && underLawn !== houseHidden) {
          for (const c of content.group.children) if (c.userData.layer === -2) c.visible = !underLawn;
          houseHidden = underLawn;
        }
        renderer.render(world, camera);
        if (retired.length) {
          for (const r of retired) r.dispose();
          retired = [];
        }
        if (content && editRef.current) placeKnobs();
        if (live) placeLive();
      }
      if (moved) requestFrame();
      else if (lit && !calm && !raf) {
        breathTimer = setTimeout(() => { breathTimer = null; requestFrame(); }, 32);
      }
    };
    // Stop waking the main thread when the camera and scene are unchanged.
    requestFrame = () => {
      if (stopped || !visible || document.hidden || raf) return;
      if (breathTimer) { clearTimeout(breathTimer); breathTimer = null; }
      raf = requestAnimationFrame(tick);
    };
    orbit.addEventListener("change", invalidate);
    const pause = () => {
      cancelAnimationFrame(raf);
      raf = 0;
      if (breathTimer) { clearTimeout(breathTimer); breathTimer = null; }
    };
    const onVisibility = () => { if (document.hidden) pause(); else invalidate(); };
    document.addEventListener("visibilitychange", onVisibility);
    const visibilityObserver = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) invalidate(); else pause();
    });
    visibilityObserver.observe(mount);
    requestFrame();

    let measured = mount.clientWidth > 0 && mount.clientHeight > 0;
    const settleResize = () => { resizePending = true; invalidate(); };
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width) || w0;
      const h = Math.round(entry.contentRect.height) || h0;
      if (w === viewWidth && h === viewHeight && measured) return;
      viewWidth = w;
      viewHeight = h;
      // CSS follows the panel immediately. Keep its drawing buffer intact until
      // resizing settles, then resize and redraw together before the next paint.
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        resizeTimer = null;
        settleResize();
      }, 120);
      if (!measured && mount.clientWidth > 0 && mount.clientHeight > 0) {
        measured = true;
        resizePending = true;
        frame(true);
      }
    });
    ro.observe(mount);

    return () => {
      api.current = null;
      stopped = true;
      if (resizeTimer) clearTimeout(resizeTimer);
      pause();
      visibilityObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      orbit.removeEventListener("change", invalidate);
      if (rebuildRaf) cancelAnimationFrame(rebuildRaf);
      if (rebuildTimer) clearTimeout(rebuildTimer);
      for (const r of retired) r.dispose();
      retired = [];
      ro.disconnect();
      renderer.domElement.removeEventListener("pointermove", onMove);
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
      renderer.domElement.removeEventListener("pointerleave", onLeave);
      renderer.domElement.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onLiveKey);
      clearLiveViz();
      liveLine.dispose();
      liveRing.dispose();
      stopSpin();
      renderer.domElement.removeEventListener("pointerdown", stopSpin);
      orbit.dispose();
      if (content) {
        world.remove(content.group);
        content.dispose();
      }
      if (lit) {
        world.remove(lit.group);
        lit.dispose();
      }
      unitBox.dispose();
      unitCyl.dispose();
      unitHexZ.dispose();
      unitHexY.dispose();
      siding.dispose();
      for (const t of textures.values()) t.dispose();
      grain.dispose();
      shingles.dispose();
      ribs.dispose();
      grass.dispose();
      concrete.dispose();
      concreteOld.dispose();
      for (const t of Object.values(cladding)) t.dispose();
      groundGeo.dispose();
      groundMat.dispose();
      for (const g of [trunkGeo, crownGeo, hillGeo]) g.dispose();
      for (const m of [trunkMat, crownMat, hillMat]) m.dispose();
      for (const m of [trunks, crowns, hills]) m.dispose();
      viewBar?.remove();
      envTex?.dispose();
      (sky.material as THREE.Material).dispose();
      sky.geometry.dispose();
      key.shadow.map?.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
      knobLayer.remove();
    };
  }, [supported]);

  if (!supported) {
    return (
      <div className={className} data-deck3d="unsupported" style={{ display: "grid", placeItems: "center" }}>
        <span>The 3D view is not available on this device</span>
      </div>
    );
  }
  // The host's class places and sizes the box (an absolute fill, in every host so far); the canvas follows it.
  return <div ref={mountRef} className={className} data-deck3d="canvas" role={viewControls ? "group" : "img"} aria-label={label ?? "The deck in 3D"} style={{ overflow: "hidden" }} />;
}
