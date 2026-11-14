// A randomized fuzz of the deck engine (2026-10-10, written for the error hunt after M3 shipped): thousands of designs
// inside the rails and thousands of junk mutations go through normalize → build → price → scene → parse → checks →
// elevation → the exact convert payload the studio sends. It found convert refused over long line descriptions,
// zero-size parts that made a scene unreadable, and a normalize drift — all fixed the same day.
//   NODE_PATH="" npx tsx --tsconfig tsconfig.json qa/tests/logic/deck-fuzz.check.ts [nInRails] [nJunk]
//   NODE_PATH="" npx tsx --tsconfig tsconfig.json qa/tests/logic/deck-fuzz.check.ts --repro A40 B5293 [--json]
import { defaultDeckDesign, frontClips, normalizeDeckDesign, shapeOutline, shapeZones, structureWords, sizeWords, FIXTURE_KINDS, STRUCTURES, FLOORS, ROOF_KINDS, ROOF_PLAN_SHAPES, ROOFINGS, GUTTER_KINDS, PLACEMENTS, NOTCH_CORNERS, type DeckDesign } from "../../../src/lib/deck/design";
import { priceDeck, deckScope, deckNotes } from "../../../src/lib/deck/pricing";
import { writeFileSync } from "node:fs";
import { applyDeckPatch, deckChecks } from "../../../src/lib/deck/checks";
import { deckGrips, moveGrip } from "../../../src/lib/deck/byHand";
import { buildStructure, structureLevels } from "../../../src/lib/deck/structure";
import { POST_ACTUAL_IN } from "../../../src/lib/deck/codeTables";
import { SKIRT_BAY_MAX_IN, SKIRT_CLEAR_IN, SKIRT_GROUND_CLEAR_IN, SKIRT_MIN_IN, SKIRT_THICK_IN, type SkirtPanel } from "../../../src/lib/deck/skirt";
import { deckScene, parseDeckScene, sceneBuildLayers, SCENE_LAYERS, SCENE_MAX_BOXES, SCENE_MAX_FOOTINGS, SCENE_MAX_DIAGONALS, SCENE_MAX_POLYS } from "../../../src/lib/deck/scene";
import { deckElevation, elevationOverlay, defaultPlacement } from "../../../src/lib/deck/elevation";
import { deckConvertSchema } from "../../../src/lib/deck/convertSchema";
import { DECK_RATES } from "../../../src/lib/deck/rates";
import { FRAMING_SPECIES, DECKING, WALL_TYPES, RAIL_TYPES } from "../../../src/lib/deck/catalog";

/* eslint-disable @typescript-eslint/no-explicit-any */
const nA = Number(process.argv[2] ?? 3000), nB = Number(process.argv[3] ?? 3000);
const nW = Number(process.argv[4] ?? 1500);
function rngOf(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
type Rng = () => number;
const pick = <T,>(r: Rng, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
const int = (r: Rng, a: number, b: number) => a + Math.floor(r() * (b - a + 1));
const half = (r: Rng, a: number, b: number) => Math.round((a + r() * (b - a)) * 2) / 2;
const odd = (r: Rng, a: number, b: number) => (r() < 0.2 ? Math.round((a + r() * (b - a)) * 100) / 100 : half(r, a, b));
const bool = (r: Rng) => r() < 0.5;
const rateKeys = new Set(DECK_RATES.map((x: any) => x.key));
const MOUNTS = ["post", "header", "rail", "deck", "ceiling", "wall", "stair", "peak"];
const ids = (xs: readonly any[]) => xs.map((x) => x.id as string);

/** A deck that follows a stepped house wall (2026-10-19): 2–5 parts across it, set back as far as 16 ft or out to its
 *  front less 3 ft — and now and then past those limits, which the reader must hold. */
function randomWall(r: Rng, depthHint: number): unknown {
  const widthFt = odd(r, 8, 60);
  const depthFt = Math.max(4, depthHint);
  const n = int(r, 2, 5);
  const cuts = Array.from({ length: n - 1 }, () => odd(r, 1, widthFt - 1)).sort((a, b) => a - b);
  const xs = [0, ...cuts, widthFt];
  const back = xs.slice(0, -1).map((x0, i) => ({ x0Ft: x0, x1Ft: xs[i + 1], yFt: r() < 0.3 ? 0 : r() < 0.5 ? -odd(r, 0, r() < 0.1 ? 30 : 16) : odd(r, 0, r() < 0.1 ? depthFt + 4 : Math.max(0, depthFt - 3)) }));
  // (Parts said to be past the house's corner — 2026-11-14 — anywhere at all: the house decides, and the reader holds them to it.)
  if (r() < 0.2) for (const b of back as Array<Record<string, unknown>>) if (r() < 0.4) b.open = pick(r, [true, true, "yes", 1]);
  // …and a front set part by part (2026-11-14), its cuts and its distances as random as the back's.
  if (r() < 0.35) return { kind: "wall", widthFt, depthFt, back, front: randomFront(r, widthFt, depthFt) };
  return { kind: "wall", widthFt, depthFt, back };
}

/** A front in 1–9 parts: widths from a sliver up, standing from under the wall to past the deck's depth. */
function randomFront(r: Rng, widthFt: number, depthFt: number): unknown {
  const n = int(r, 1, 9);
  const cuts = Array.from({ length: n - 1 }, () => odd(r, 0, widthFt)).sort((a, b) => a - b);
  const xs = [0, ...cuts, r() < 0.9 ? widthFt : widthFt + 5];
  // …its corners cut at an angle now and then (2026-11-14): any size, on any part, whether the corner stands out or not.
  return xs.slice(0, -1).map((x0, i) => ({ x0Ft: x0, x1Ft: xs[i + 1], yFt: r() < 0.1 ? pick(r, [-3, 0, 99, "x"]) : odd(r, 2, depthFt + 6), ...(r() < 0.3 ? { clipLeftFt: pick(r, [odd(r, 0, 14), 2, 4, -1, "x"]) } : {}), ...(r() < 0.3 ? { clipRightFt: pick(r, [odd(r, 0, 14), 3, 6, 99]) } : {}) }));
}

/** A whole random design whose deck follows a stepped house wall. */
function wallDesign(i: number): unknown {
  const r = rngOf(90000 + i);
  const d = randomDesign(r) as { shape: { depthFt: number } };
  return { ...d, shape: randomWall(r, Math.round(d.shape.depthFt)) };
}

function randomDesign(r: Rng): unknown {
  const d: any = JSON.parse(JSON.stringify(defaultDeckDesign({ state: pick(r, ["NY", "TX", "CA", "MN", "FL", "WA", null]) })));
  const w = odd(r, 4, 60), dep = odd(r, 4, 40);
  d.shape = r() < 0.7
    ? { kind: "rect", widthFt: w, depthFt: dep, front: r() < 0.5 ? undefined : { kind: pick(r, ["straight", "curve", "clipped"]), bulgeFt: odd(r, 1, 8), clipFt: odd(r, 1, 6) } }
    : { kind: "L", widthFt: Math.max(w, 8), depthFt: Math.max(dep, 8), notch: { corner: pick(r, NOTCH_CORNERS), widthFt: odd(r, 2, Math.max(2, w - 3)), depthFt: odd(r, 2, Math.max(2, dep - 3)) } };
  d.placement = pick(r, PLACEMENTS); d.wall = pick(r, ids(WALL_TYPES)); d.heightIn = r() < 0.3 ? int(r, 4, 30) : int(r, 4, 360);
  d.loadPsf = pick(r, [40, 50, 60, 70]); d.soilPsf = pick(r, [1500, 2000, 3000]); d.frostIn = int(r, 0, 96);
  d.framing = { species: pick(r, ids(FRAMING_SPECIES)), joist: pick(r, ["auto", "2x6", "2x8", "2x10", "2x12"]), spacingIn: pick(r, ["auto", 12, 16, 24]), beamStyle: pick(r, ["auto", "dropped", "flush"]), beamKind: pick(r, ["solid", "built-up"]), beam: pick(r, ["auto", "4x6", "4x8", "4x10", "4x12", "2-2x6", "2-2x8", "2-2x10", "2-2x12", "3-2x8", "3-2x10", "3-2x12"]), post: pick(r, ["4x4", "4x6", "6x6", "8x8"]), overhangFt: r() < 0.5 ? "auto" : odd(r, 0, 4), doubleRim: bool(r), joistTape: bool(r), blocking: pick(r, ["auto", "mid-span"]), braces: bool(r) };
  d.ledger = { fastener: pick(r, ["lag", "bolt", "bolt-gap", "ledgerlok", "sdws", "anchor"]), lateral: pick(r, ["two", "four"]) };
  d.footing = { type: pick(r, ["poured", "pier-block"]), aboveGradeIn: int(r, 0, 12), frostAlways: bool(r) };
  d.decking = { product: pick(r, ids(DECKING)), diagonal: bool(r), pattern: pick(r, ["straight", "diagonal", "herringbone"]), border: pick(r, [0, 1, 2]), fastening: pick(r, ["auto", "screws", "hidden"]), fascia: pick(r, ["auto", "none", "match"]), wastePct: int(r, 0, 30) };
  d.extras = { railFt: r() < 0.7 ? "auto" : odd(r, 0, 400), demoSqFt: r() < 0.7 ? 0 : int(r, 0, 4000), stainless: bool(r), underDeckDrain: bool(r) };
  d.rail = { type: pick(r, ids(RAIL_TYPES)), heightIn: pick(r, [36, 42]), infill: pick(r, ["auto", "balusters", "cable", "glass", "panel", "horizontal"]), postSpacingFt: pick(r, [4, 6, 8]), cap: bool(r), lighting: pick(r, ["none", "post-caps", "post-caps-risers"]), customPerFt: odd(r, 0, 1000), lowerLevel: bool(r) };
  const nStairs = r() < 0.3 ? 0 : int(r, 1, 6);
  d.stairs = Array.from({ length: nStairs }, (_, i) => ({ id: `s${i + 1}`, side: pick(r, ["front", "left", "right"]), atFt: odd(r, 0, 60), widthFt: odd(r, 3, 12), level: pick(r, ["upper", "lower"]), wrap: r() < 0.25, wrapSides: pick(r, [1, 3, 4]), landing: pick(r, ["pad", "patio", "grade"]), handrail: pick(r, ["auto", "both", "one", "none"]) }));
  d.lower = { on: r() < 0.4, widthFt: odd(r, 4, 60), depthFt: odd(r, 4, 30), dropIn: odd(r, 4, 96), align: pick(r, ["left", "centre", "right"]) };
  d.site = { groundSnowPsf: r() < 0.5 ? 0 : int(r, 0, 300), slope: { outDropIn: r() < 0.5 ? 0 : odd(r, -30, 60), acrossDropIn: r() < 0.6 ? 0 : odd(r, -30, 30) }, termite: pick(r, [null, "very-heavy", "moderate-heavy", "slight-moderate", "none-slight"]), state: pick(r, [null, "CA", "NJ", "TX", "WI", "UT", "va", "XX", "", 5]) };
  const nFix = r() < 0.3 ? 0 : int(r, 1, 40);
  d.electrical = { fixtures: Array.from({ length: nFix }, (_, i) => ({ id: `e${i + 1}`, kind: pick(r, FIXTURE_KINDS), supply: pick(r, ["we", "client"]), qty: r() < 0.7 ? 1 : int(r, 1, 40), at: r() < 0.5 ? null : { x: odd(r, -60, (w + 5) * 12), y: odd(r, -60, (dep + 5) * 12), z: odd(r, -12, 240), on: pick(r, MOUNTS) }, volts240: bool(r) })), feedFt: int(r, 5, 300), panelSide: pick(r, ["left", "right"]), timer: bool(r) };
  d.structure = pick(r, STRUCTURES); d.floor = pick(r, FLOORS);
  d.roof = { kind: pick(r, ROOF_KINDS), attach: pick(r, ["wall", "free"]), plan: { shape: pick(r, ROOF_PLAN_SHAPES), widthFt: odd(r, 6, 40), depthFt: odd(r, 6, 40), acrossFt: odd(r, 8, 30), offsetFt: odd(r, -30, 30) }, pitch: odd(r, 2, 12), eaveHeightIn: int(r, 84, 144), overhangIn: int(r, 0, 36), load: pick(r, ["auto", 20, 30, 50, 70]), post: pick(r, ["4x4", "6x6", "8x8"]), rafter: pick(r, ["auto", "2x6", "2x8", "2x10", "2x12"]), rafterSpacingIn: pick(r, [12, 16, 24]), header: pick(r, ["auto", "lvl", "4x8", "4x12", "2-2x10", "3-2x12"]), ridge: pick(r, ["auto", "beam", "board", "none", "trusses"]), crossBeams: pick(r, [0, 0, 1, 2, 3, 4, -1, 2.6]), roofing: pick(r, ROOFINGS), roofDeck: pick(r, ["sheathing", "purlins"]), ceiling: pick(r, ["none", "tongue-groove", "beadboard"]), cupola: bool(r), fascia: { eave: bool(r), rake: bool(r), finish: pick(r, ["wood", "pvc", "aluminum-wrap"]) }, soffit: bool(r), gutters: { kind: pick(r, GUTTER_KINDS), guards: bool(r) }, braces: bool(r), slats: { size: pick(r, ["2x2", "2x4", "2x6"]), spacingIn: int(r, 3, 24) }, pergolaStyle: pick(r, ["flat", "louvered", "arched"]), walls: { fill: pick(r, ["none", "screen", "lattice", "solid"]), sides: int(r, 1, 16) }, extras: { fan: bool(r), lights: int(r, 0, 12) } };
  // 2026-11-13: how the rail's posts are mounted (the deck's, and any side's own); posts and openings set by hand on the roof.
  d.rail.mount = pick(r, ["auto", "top", "side"]);
  // …and the deck's own posts set by hand, with the widest spacing.
  if (r() < 0.35) {
    d.framing.pins = Array.from({ length: int(r, 1, 26) }, (_, i) => ({ id: `k${i + 1}`, beam: pick(r, ["front", "middle", "back", "side"]), atFt: odd(r, -3, 64) }));
    d.framing.postSpacingFt = pick(r, ["auto", 3, 4, 6, 8, 14, 1, 40]);
  }
  // …and the beams by hand (2026-11-13): middle beams at places of their own, posts tied to them, the back beam's overhang.
  if (r() < 0.35) {
    d.framing.beamLines = Array.from({ length: int(r, 1, 7) }, (_, i) => ({ id: `l${i + 1}`, atFt: odd(r, -2, dep + 3), zones: pick(r, [[], ["a"], ["b"], ["a", "b"], ["q"], "x"]) }));
    d.framing.backOverhangFt = pick(r, ["auto", 0, 0.5, 1, 2.25, 4, 9, -1]);
    if (r() < 0.5) d.framing.pins = [...(Array.isArray(d.framing.pins) ? d.framing.pins : []), ...Array.from({ length: int(r, 1, 4) }, (_, i) => ({ id: `t${i + 1}`, beam: "middle", line: pick(r, ["l1", "l2", "l9"]), atFt: odd(r, 0, w) }))];
  }
  // …and a double deck (2026-11-13): a second deck under this one, a storey down — or not quite a storey.
  if (r() < 0.2) {
    d.lower = { ...d.lower, on: true, place: pick(r, ["under", "under", "under", "front", "sideways"]), heightIn: odd(r, 0, 150) };
    if (r() < 0.7) d.heightIn = Math.round(Number(d.lower.heightIn)) + int(r, 70, 170);
  }
  // …stairs with landings at any heights, turning any way (2026-11-14), and the braces' timber.
  if (Array.isArray(d.stairs) && r() < 0.45) for (const st of d.stairs as any[]) st.landings = Array.from({ length: int(r, 1, 7) }, (_, i) => ({ id: `t${i + 1}`, heightIn: odd(r, 0, Math.max(40, Number(d.heightIn) + 20)), turn: pick(r, ["straight", "left", "right", "back-left", "back-right", "up"]) }));
  d.framing.braceSize = pick(r, ["auto", "auto", "2x4", "4x4", "6x6", "8x8", "x"]);
  d.roof.braceSize = pick(r, ["auto", "auto", "4x4", "6x6", "8x8", 3]);
  d.rail.mountBy = r() < 0.6 ? {} : Object.fromEntries(["upper-front", "upper-left", "upper-right", "upper-back", "lower-front", "lower-left"].filter(() => r() < 0.4).map((k) => [k, pick(r, ["top", "side"])]));
  if (r() < 0.45) {
    d.roof.openings = Array.from({ length: int(r, 1, 7) }, (_, i) => ({ id: `o${i + 1}`, side: pick(r, ["front", "left", "right", "back"]), atFt: odd(r, -2, 62), widthFt: odd(r, 1, 20), door: bool(r) }));
    d.roof.pins = Array.from({ length: int(r, 0, 14) }, (_, i) => ({ id: `p${i + 1}`, side: pick(r, ["front", "left", "right", "back"]), atFt: odd(r, -2, 62) }));
    d.roof.postSpacingFt = pick(r, ["auto", 4, 6, 8, 12, 16, 3, 40]);
  }
  d.photo = r() < 0.8 ? null : { url: "inline:abc", w: 640, h: 480, placed: { x: 0.1, y: 0.9, w: 0.8 }, fit: null };
  // Products of the shop's own (2026-10-12): any slot now and then, long and odd names and prices included.
  const NAMES = ["Trex Transcend Lineage Rainier", "TimberTech AZEK Vintage Weathered Teak", "  Fiberon   Concordia  ", "x".repeat(120), "Ü-Deck ½″ ⌀ ‘quoted’ & <b>", "", "   "];
  d.custom = {};
  for (const slot of ["decking", "fastening", "fascia", "roofing", "ceiling", "roofFascia", "gutters", "walls", "species", "bogus"]) if (r() < 0.2) d.custom[slot] = { name: pick(r, NAMES), price: odd(r, -5, 2000) };
  d.extras.items = r() < 0.7 ? [] : Array.from({ length: int(r, 1, 45) }, (_, i) => ({ id: r() < 0.9 ? `o${i}` : pick(r, ["", "BAD ID", "o1"]), name: pick(r, NAMES), qty: odd(r, -1, 500), unit: pick(r, ["ea", "pcs", "ft", "sq ft", "bags", "yd"]), price: odd(r, -1, 5000) }));
  d.rail.customName = r() < 0.3 ? pick(r, NAMES) : "";
  for (const f of d.electrical.fixtures) if (r() < 0.2) f.custom = { name: pick(r, NAMES), price: odd(r, 0, 3000) };
  // …and a front set part by part over a straight wall (2026-11-14): any deck, now and then.
  if (r() < 0.15) d.shape = { kind: "wall", widthFt: d.shape.widthFt, depthFt: d.shape.depthFt, back: [{ x0Ft: 0, x1Ft: d.shape.widthFt, yFt: 0 }], front: randomFront(r, Number(d.shape.widthFt), Number(d.shape.depthFt)) };
  // …and the deck run past a corner of the house and back along its side (2026-11-14) — in the rails and well out of
  // them. (Last, so every design before this draws the numbers it always drew.)
  if (r() < 0.3) {
    d.house = { ...d.house, leftFt: r() < 0.5 ? odd(r, -40, 10) : d.house.leftFt, rightFt: r() < 0.6 ? odd(r, -40, 10) : d.house.rightFt, wrapLeftFt: pick(r, [undefined, 0, odd(r, -2, 30), "x"]), wrapRightFt: pick(r, [undefined, 0, odd(r, -2, 30)]) };
    if (r() < 0.4) d.house.jogs = Array.from({ length: int(r, 1, 4) }, (_, i) => ({ id: `j${i + 1}`, atFt: odd(r, -6, 64), dir: pick(r, ["toward", "away"]), depthFt: odd(r, 0, 14) }));
  }
  return d;
}

const JUNK = [null, undefined, "", "junk", -1, -1e9, 1e9, 0, NaN, Infinity, -Infinity, true, false, {}, [], 1e-9, "12", [1, 2], { kind: "x" }, 1e308, -0];
function leaves(o: any, p: string[] = [], out: string[][] = []): string[][] { if (o && typeof o === "object") { for (const k of Object.keys(o)) leaves(o[k], [...p, k], out); if (!Object.keys(o).length) out.push(p); } else out.push(p); return out; }
function setAt(o: any, p: string[], v: any, del = false) { let c = o; for (const k of p.slice(0, -1)) { if (c == null || typeof c !== "object") return; c = c[k]; } if (c && typeof c === "object") { if (del) delete c[p[p.length - 1]]; else c[p[p.length - 1]] = v; } }
function mutate(r: Rng, valid: DeckDesign): unknown {
  const raw: any = JSON.parse(JSON.stringify(valid));
  const paths = leaves(raw);
  for (let i = 0, n = int(r, 1, 6); i < n; i++) {
    const p = pick(r, paths);
    const mode = r();
    if (mode < 0.15) setAt(raw, p, null, true);
    else if (mode < 0.3 && p.length > 1) setAt(raw, p.slice(0, -1), pick(r, JUNK));
    else setAt(raw, p, pick(r, JUNK));
  }
  if (r() < 0.1) raw.v = pick(r, [1, 2, 99, "3", null]);
  return raw;
}

function diffPath(a: any, b: any, p = ""): string | null {
  if (a === b || (typeof a === "number" && typeof b === "number" && Number.isNaN(a) && Number.isNaN(b))) return null;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return `${p || "/"}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { const d = diffPath(a[k], b[k], `${p}/${k}`); if (d) return d; }
  return null;
}
const fin = (xs: unknown[]) => xs.every((x) => typeof x === "number" && Number.isFinite(x));
const stats = { maxBoxes: 0, maxBytes: 0, maxLines: 0, maxScope: 0, maxNotes: 0, maxMs: 0, maxBoxesTag: "", maxSubtotal: 0 };

/** A shop's own product's key points at something the design holds (lib/deck/pricing ownRate). */
const ownKey = (k: string, d: DeckDesign) =>
  k.startsWith("custom.fixture.") ? !!d.electrical.fixtures.find((f) => f.id === k.slice("custom.fixture.".length))?.custom : k.startsWith("custom.") ? !!(d.custom as any)[k.slice("custom.".length)] : k.startsWith("own.") ? d.extras.items.some((it) => it.id === k.slice("own.".length)) : false;

/** SKIRTING (2026-11-14): asked for on two designs in five (and as junk on a few) — by the design's own number, so the random stream every other option is drawn from stays what it was. */
function skirtFor(tag: string, raw: unknown): unknown {
  const i = Number(tag.slice(1));
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !Number.isFinite(i)) return raw;
  const o = raw as Record<string, unknown>;
  const skirt = i % 97 === 0 ? "brick" : i % 5 === 1 ? "lattice" : i % 5 === 3 ? "boards" : undefined;
  if (!skirt || (o.extras !== undefined && (typeof o.extras !== "object" || o.extras === null))) return raw;
  return { ...o, extras: { ...((o.extras as object) ?? {}), skirt } };
}
type Pt = { x: number; y: number };
/** A skirt bay as it lies in plan: a thin rectangle outside the deck's edge. */
const skirtQuad = (p: SkirtPanel): Pt[] => [SKIRT_CLEAR_IN, SKIRT_CLEAR_IN + SKIRT_THICK_IN].flatMap((o, k) => { const a = { x: p.x0 + p.outX * o, y: p.y0 + p.outY * o }, b = { x: p.x1 + p.outX * o, y: p.y1 + p.outY * o }; return k === 0 ? [a, b] : [b, a]; });
/** Do two convex shapes overlap by more than a hair (separating axes)? */
const quadsOverlap = (A: Pt[], B: Pt[], eps = 0.01) => {
  for (const poly of [A, B]) for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const nx = q.y - p.y, ny = p.x - q.x, len = Math.hypot(nx, ny) || 1;
    const pa = A.map((v) => (v.x * nx + v.y * ny) / len), pb = B.map((v) => (v.x * nx + v.y * ny) / len);
    if (Math.max(...pa) <= Math.min(...pb) + eps || Math.max(...pb) <= Math.min(...pa) + eps) return false;
  }
  return true;
};

/** Does an outline cross itself? (A junk wall can make one: a corner cut through a sliver of the wall. Nothing laid along its edges can be told apart there.) */
const ringCrossesItself = (ring: Pt[]) => {
  const side = (a: Pt, b: Pt, c: Pt) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  for (let i = 0; i < ring.length; i++) for (let j = i + 2; j < ring.length; j++) {
    if (i === 0 && j === ring.length - 1) continue;
    const a = ring[i], b = ring[(i + 1) % ring.length], c = ring[j], e = ring[(j + 1) % ring.length];
    if (side(a, b, c) * side(a, b, e) < 0 && side(c, e, a) * side(c, e, b) < 0) return true;
  }
  return false;
};

function exercise(d: DeckDesign, tag: string, out: string[]) {
  const t0 = Date.now();
  const d2 = normalizeDeckDesign(JSON.parse(JSON.stringify(d)));
  const drift = diffPath(d, d2);
  if (drift) out.push(`normalize drifts: ${drift}  [${tag}]`);
  const pkg = priceDeck(d);
  if (!(Number.isFinite(pkg.subtotal) && pkg.subtotal >= 0)) out.push(`subtotal bad: ${pkg.subtotal}  [${tag}]`);
  // SKIRTING (2026-11-14; lib/deck/skirt): where it hangs it is priced; every bay is 8 ft at most and a foot or more
  // high, a hand above the ground under it, through no post, across no other bay; where none could hang, that is said.
  {
    const s0 = pkg.structure;
    const sk = s0.skirt;
    if (d.extras.skirt && s0.frame && !sk && !deckChecks(s0).some((c) => c.id === "deck-skirt-none")) out.push(`skirting asked for, none built, nothing said  [${tag}]`);
    if (sk && !d.extras.skirt) out.push(`skirting built that was not asked for  [${tag}]`);
    if (sk) {
      if (!pkg.lines.some((l) => l.id === "deck-skirt" && l.quantity > 0 && l.unitPrice > 0)) out.push(`skirting built but not priced  [${tag}]`);
      if (!(sk.sqFt > 0 && sk.lf > 0 && sk.frameLf > 0 && (sk.kind === "boards") === (sk.boardLf > 0))) out.push(`skirting's figures are off: ${sk.sqFt} sq ft, ${sk.lf} ft, frame ${sk.frameLf}, boards ${sk.boardLf}  [${tag}]`);
      const posts = structureLevels(s0).flatMap((l) => l.frame.posts.map((q) => { const h = Math.max(...(POST_ACTUAL_IN[q.size] ?? [5.5, 5.5])) / 2; const x = q.x + l.offsetXIn, y = q.y + l.offsetYIn; return [{ x: x - h, y: y - h }, { x: x + h, y: y - h }, { x: x + h, y: y + h }, { x: x - h, y: y + h }]; }));
      const quads = sk.panels.map(skirtQuad);
      const tangled = ringCrossesItself(shapeOutline(d.shape));
      for (const [k, p] of sk.panels.entries()) {
        const h = p.topIn - p.bottomIn;
        if (!(p.lengthIn > 6 && p.lengthIn <= SKIRT_BAY_MAX_IN + 0.01)) { out.push(`a skirt bay ${p.lengthIn.toFixed(1)} in. long  [${tag}]`); break; }
        if (!(h >= SKIRT_MIN_IN - 0.01)) { out.push(`a skirt bay ${h.toFixed(1)} in. high  [${tag}]`); break; }
        if ([0, 0.5, 1].some((t) => p.bottomIn < s0.groundAt(p.x0 + (p.x1 - p.x0) * t, p.y0 + (p.y1 - p.y0) * t) + SKIRT_GROUND_CLEAR_IN - 0.01)) { out.push(`a skirt bay in the ground  [${tag}]`); break; }
        if (posts.some((q) => quadsOverlap(quads[k], q))) { out.push(`a skirt bay through a post  [${tag}]`); break; }
        if (!tangled && quads.some((q, j) => j > k && sk.panels[j].bottomIn < p.topIn && p.bottomIn < sk.panels[j].topIn && quadsOverlap(quads[k], q))) { out.push(`two skirt bays cross  [${tag}]`); break; }
      }
    }
  }
  // PAST THE HOUSE'S CORNER (2026-11-14): the deck's shape and the house agree — a part past a corner is an open one,
  // exactly as far as the house says — and no ledger hangs where no wall stands.
  {
    const W = d.shape.widthFt;
    const back = d.shape.kind === "wall" ? d.shape.back : [];
    const openL = back[0]?.open ? back[0].x1Ft : 0;
    const openR = back.length && back[back.length - 1].open ? W - back[back.length - 1].x0Ft : 0;
    if (Math.abs(openL - Math.max(0, -d.house.leftFt)) > 0.05 || Math.abs(openR - Math.max(0, -d.house.rightFt)) > 0.05) out.push(`the deck's open ends (${openL}, ${openR}) are not the house's (${d.house.leftFt}, ${d.house.rightFt})  [${tag}]`);
    if (back.some((b, i) => b.open && i > 0 && i < back.length - 1)) out.push(`an open part in the middle of the deck  [${tag}]`);
    if (back.some((b) => b.open && b.yFt > 0)) out.push(`an open part in front of the house line  [${tag}]`);
    // A FRONT IN PARTS (2026-11-14): every rectangle of the deck has 3 ft of deck in it front to back and is no
    // narrower than a part may be; the deck is as deep as its deepest part; the parts tile its width.
    if (d.shape.kind === "wall" && d.shape.front) {
      const fr = d.shape.front;
      if (Math.abs(Math.max(...fr.map((q) => q.yFt)) - d.shape.depthFt) > 0.01) out.push(`the deck's depth ${d.shape.depthFt} is not its deepest part's  [${tag}]`);
      if (fr[0].x0Ft !== 0 || Math.abs(fr[fr.length - 1].x1Ft - W) > 0.01 || fr.some((q, i) => i > 0 && Math.abs(q.x0Ft - fr[i - 1].x1Ft) > 0.01)) out.push(`the front's parts do not tile the deck's width  [${tag}]`);
      for (const z of shapeZones(d.shape)) {
        if (z.y1 - z.y0 < 36 - 0.6) out.push(`a part of the deck ${z.y1 - z.y0} in. front to back  [${tag}]`);
        // (A sliver of the WALL — a chimney, a pilaster — is stepped around as it always was; the front never cuts one.)
        if (z.x1 - z.x0 < 6 && !back.some((b) => Math.abs(b.x0Ft * 12 - z.x0) < 0.6 && Math.abs(b.x1Ft * 12 - z.x1) < 0.6)) out.push(`a part of the deck ${z.x1 - z.x0} in. wide  [${tag}]`);
      }
    }
    const f0 = pkg.structure.frame;
    // CORNERS CUT AT AN ANGLE (2026-11-14): with the beams under the joists, no post of the deck stands outside the
    // deck's own outline — a beam stops inside a cut, an angled beam carries a deep one.
    if (f0 && f0.beamStyle === "dropped" && d.shape.kind === "wall" && d.shape.front && d.framing.pins.length === 0) {
      const ring = shapeOutline(d.shape);
      const inRing = (x: number, y: number) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i], b = ring[j]; if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) c = !c; } return c; };
      // (Under a corner that is cut away; and an angled beam's own posts anywhere but on the deck.)
      const cutAway = frontClips(d.shape);
      const outP = f0.posts.filter((q) => !q.roof && (cutAway.some((k) => k.dir * (q.x - k.x) >= 0 && k.y - q.y >= 0 && k.dir * (q.x - k.x) + (k.y - q.y) < k.c - 1) || (/^c\d+p/.test(q.id) && !inRing(q.x, q.y))));
      if (outP.length) out.push(`a post stands outside the deck: ${outP[0].id} (${Math.round(outP[0].x)}, ${Math.round(outP[0].y)})  [${tag}]`);
      for (const q of d.shape.front) if ((q.clipLeftFt ?? 0) + (q.clipRightFt ?? 0) > q.x1Ft - q.x0Ft + 0.01 || (q.clipLeftFt ?? 0) < 0 || (q.clipRightFt ?? 0) < 0) out.push(`a part's cuts are more than the part  [${tag}]`);
    }
    if (f0) {
      const x0 = -d.house.leftFt * 12 - 0.6;
      const x1 = (W + d.house.rightFt) * 12 + 0.6;
      for (const l of f0.ledgers) if (l.x0 < x0 || l.x1 > x1) out.push(`a ledger ${l.x0}..${l.x1} runs past the house (${x0}..${x1})  [${tag}]`);
      for (const z of f0.zones) if (z.zone.open && z.back !== "beam") out.push(`a part past the house's corner hangs on a ledger  [${tag}]`);
    }
  }
  // BY HAND (2026-11-13; lib/deck/byHand): a post or a beam taken hold of and moved — to its line's ends and a few
  // inches along — is still in the hand afterwards (the same name), where it was put, and the deck still builds.
  if (Number(tag.replace(/\D/g, "")) % 4 === 0) {
    const grips = deckGrips(pkg.structure).filter((g) => !g.fixed);
    const tried = [grips[0], grips[Math.floor(grips.length / 2)], grips[grips.length - 1]].filter((g, i, a) => g && a.indexOf(g) === i);
    for (const g of tried) {
      for (const at of [g.min, g.at + 7, g.max]) {
        const p = moveGrip(pkg.structure, g.kind, g.id, at, grips);
        if (!p) continue;
        const d3 = normalizeDeckDesign(applyDeckPatch(d, p));
        const s3 = buildStructure(d3);
        // (The front and the house-side beam go by the part of the deck they run under: on a deck whose beams met on one line before the move, that part can be another after it.)
        const g3 = deckGrips(s3).find((q) => q.kind === g.kind && (q.id === g.id || (g.id.includes(":") && !g.id.startsWith("open:") && q.id.startsWith(`${g.id.split(":")[0]}:`))));
        const want = Math.min(g.max, Math.max(g.min, at));
        if (!g3) out.push(`moved by hand, then not in the hand: a ${g.kind} ${g.id.replace(/[-\d.]+/g, "#")} of ${g.label}  [${tag}]`);
        else if (!g.id.includes(":") && g.kind !== "roof-post" && Math.abs(g3.at - want) > (g.kind === "post" ? 9 : 0.6)) out.push(`moved by hand, not where it was put: a ${g.kind} of ${g.label} asked ${want} stands ${g3.at}  [${tag}]`);
        deckScene(s3);
      }
    }
  }
  if (Math.abs(pkg.materialSubtotal + pkg.laborSubtotal - pkg.subtotal) > 1) out.push(`halves ≠ total: ${pkg.materialSubtotal} + ${pkg.laborSubtotal} vs ${pkg.subtotal}  [${tag}]`);
  if (pkg.lines.length < 1 || pkg.lines.length > 60) out.push(`lines count ${pkg.lines.length}  [${tag}]`);
  for (const l of pkg.lines) {
    if (!(l.name.length >= 1 && l.name.length <= 200) || (l.description ?? "").length > 400) { out.push(`line text out of the schema: ${l.id} name ${l.name.length} desc ${(l.description ?? "").length}  [${tag}]`); break; }
    if (!fin([l.quantity, l.materialCost, l.laborCost, l.unitPrice]) || l.quantity < 0 || l.materialCost < 0 || l.laborCost < 0) { out.push(`line numbers bad: ${l.id} ${JSON.stringify([l.quantity, l.materialCost, l.laborCost, l.unitPrice])}  [${tag}]`); break; }
    if (Math.abs(l.unitPrice - (l.materialCost + l.laborCost)) > 0.011) { out.push(`unitPrice ≠ material + labor: ${l.id} ${l.unitPrice} vs ${l.materialCost}+${l.laborCost}  [${tag}]`); break; }
    if (l.tbd && l.materialCost !== 0) { out.push(`tbd line charges material: ${l.id} ${l.materialCost}  [${tag}]`); break; }
  }
  for (const b of pkg.bom) {
    if (!fin([b.qty, b.cost, b.unitPrice]) || !(b.qty > 0) || b.cost < 0) { out.push(`bom numbers bad: ${b.id} qty ${b.qty} cost ${b.cost}  [${tag}]`); break; }
    if (!(b as any).byClient && !rateKeys.has(b.rateKey) && b.rateKey !== "rail.custom.material" && !ownKey(b.rateKey, d)) { out.push(`bom off the book: ${b.id} → ${b.rateKey}  [${tag}]`); break; }
  }
  if (!fin([pkg.areaSqFt, pkg.pricePerSqFt, pkg.exampleShare, pkg.railFt, pkg.stairSteps]) || pkg.areaSqFt < 0 || pkg.exampleShare < 0 || pkg.exampleShare > 1 || pkg.railFt < 0 || pkg.stairSteps < 0 || pkg.stairSteps !== Math.round(pkg.stairSteps)) out.push(`package figures bad: area ${pkg.areaSqFt} $/sf ${pkg.pricePerSqFt} share ${pkg.exampleShare} rail ${pkg.railFt} steps ${pkg.stairSteps}  [${tag}]`);
  if (priceDeck(d).subtotal !== pkg.subtotal) out.push(`not deterministic: ${pkg.subtotal} vs ${priceDeck(d).subtotal}  [${tag}]`);
  const s = pkg.structure;
  const scene = deckScene(s);
  if (scene.boxes.length > SCENE_MAX_BOXES || scene.footings.length > SCENE_MAX_FOOTINGS || (scene.diagonal?.boards.length ?? 0) > SCENE_MAX_DIAGONALS || scene.polys.length > SCENE_MAX_POLYS) out.push(`scene over its limits: ${scene.boxes.length} boxes ${scene.footings.length} footings ${scene.diagonal?.boards.length ?? 0} diagonals ${scene.polys.length} polys  [${tag}]`);
  for (let i = 0; i < scene.boxes.length; i++) { const b = scene.boxes[i]; if (!(b.length === 8 || b.length === 10 || b.length === 12) || !fin(b) || !(b[4] > 0 && b[5] > 0 && b[6] > 0) || b[0] < 0 || b[0] >= SCENE_LAYERS.length || b[0] !== Math.round(b[0])) { out.push(`scene box ${i} bad: ${JSON.stringify(b)}  [${tag}]`); break; } if (b.length === 12 && (Math.abs(b[10]) > 4 || Math.abs(b[11]) > 4)) { out.push(`scene box ${i} bad mitre: ${JSON.stringify(b)}  [${tag}]`); break; } if (Math.max(b[4], b[5], b[6]) > (SCENE_LAYERS[b[0]] === "wire" ? 260 : 120) || Math.abs(b[1]) > 250 || Math.abs(b[2]) > 250 || b[3] < -60 || b[3] > 120) { out.push(`scene box ${i} absurd (${SCENE_LAYERS[b[0]]}): ${JSON.stringify(b.map((x) => Math.round(x * 100) / 100))}  [${tag}]`); break; } }
  if (scene.tags.length && scene.tags.length !== scene.boxes.length) out.push(`tags ${scene.tags.length} vs boxes ${scene.boxes.length}  [${tag}]`);
  if (scene.polyTags.length && scene.polyTags.length !== scene.polys.length) out.push(`polyTags ${scene.polyTags.length} vs polys ${scene.polys.length}  [${tag}]`);
  for (const t of scene.tags) if (t !== -1 && !(t >= 0 && t < scene.legend.length)) { out.push(`tag ${t} outside the legend (${scene.legend.length})  [${tag}]`); break; }
  for (let i = 0; i < scene.polys.length; i++) { const p = scene.polys[i]; if (!fin(p) || (p.length - 1) % 3 !== 0 || p.length < 10) { out.push(`scene poly ${i} bad: len ${p.length}  [${tag}]`); break; } }
  if (!fin(scene.outline) || scene.outline.length < 6 || scene.outline.length % 2) out.push(`outline bad: ${scene.outline.length}  [${tag}]`);
  if (!scene.footings.every((f) => fin(f)) || !scene.callouts.every((c) => fin(c) && c.length === 4) || !scene.glows.every((g) => fin(g) && g.length === 5)) out.push(`footings/callouts/glows have bad numbers  [${tag}]`);
  for (const h of scene.handles) if (!fin([h.x, h.y, h.z, h.value, h.perUnit]) || !(h.perUnit > 0)) { out.push(`handle bad: ${JSON.stringify(h)}  [${tag}]`); break; }
  if (!fin([scene.widthFt, scene.depthFt, scene.heightFt, scene.peakFt]) || scene.widthFt < 0 || scene.depthFt < 0) out.push(`scene size bad  [${tag}]`);
  const json = JSON.stringify(scene);
  const back = parseDeckScene(JSON.parse(json));
  if (!back) out.push(`scene does not read back  [${tag}]`);
  else if (back.boxes.length !== scene.boxes.length || back.polys.length !== scene.polys.length || back.handles.length !== scene.handles.length || back.glows.length !== scene.glows.length || back.footings.length !== scene.footings.length || back.callouts.length !== scene.callouts.length || back.legend.length !== scene.legend.length) out.push(`scene reads back short: boxes ${back.boxes.length}/${scene.boxes.length} polys ${back.polys.length}/${scene.polys.length} handles ${back.handles.length}/${scene.handles.length} glows ${back.glows.length}/${scene.glows.length} footings ${back.footings.length}/${scene.footings.length} callouts ${back.callouts.length}/${scene.callouts.length}  [${tag}]`);
  sceneBuildLayers(scene);
  const checks = deckChecks(s);
  const seen = new Set<string>();
  for (const c of checks) { if (seen.has(c.id)) { out.push(`duplicate check id ${c.id}  [${tag}]`); break; } seen.add(c.id); if (!["pass", "info", "warn", "fail"].includes(c.level) || !c.text || !c.part) { out.push(`check ${c.id} malformed  [${tag}]`); break; } if (/NaN|undefined|Infinity/.test(c.text)) { out.push(`check ${c.id} prints NaN/undefined: ${c.text.slice(0, 120)}  [${tag}]`); break; } }
  const elev = deckElevation(scene);
  if (!(elev.polys.length > 0)) out.push(`elevation empty  [${tag}]`);
  else if (elevationOverlay(elev, defaultPlacement(), 1600, 1200).some((o) => !/^[-\d.]+,[-\d.]+( [-\d.]+,[-\d.]+)+$/.test(o.points))) out.push(`elevation overlay has bad points  [${tag}]`);
  const words = structureWords(d) + " " + sizeWords(d);
  if (/NaN|undefined|Infinity/.test(words)) out.push(`words print NaN/undefined: ${words}  [${tag}]`);
  const scope = deckScope(pkg, "123 Main St, Austin, TX 78701").join("\n");
  const notes = deckNotes(pkg);
  if (/NaN|undefined|Infinity/.test(scope + notes.join(" "))) out.push(`scope/notes print NaN/undefined  [${tag}]`);
  for (const l of pkg.lines) if (/NaN|undefined|Infinity/.test(l.name + (l.description ?? ""))) { out.push(`line text prints NaN/undefined: ${l.id} ${l.name} ${l.description ?? ""}  [${tag}]`); break; }
  const payload = { title: (structureWords(d) || "Deck").slice(0, 200), scope, assumptions: notes, lines: pkg.lines.map((l) => ({ name: l.name, description: l.description, quantity: l.quantity, unit: l.unit, materialCost: l.materialCost, laborCost: l.laborCost })), address: "123 Main St, Austin, TX 78701", plan: { design: d, scene } };
  const parsed = deckConvertSchema.safeParse(payload);
  if (!parsed.success) out.push(`convert refuses: ${parsed.error.issues.slice(0, 2).map((i) => i.path.join(".") + " " + i.message).join("; ")}  [${tag}]`);
  const ms = Date.now() - t0;
  if (scene.boxes.length > stats.maxBoxes) { stats.maxBoxes = scene.boxes.length; stats.maxBoxesTag = tag; }
  stats.maxBytes = Math.max(stats.maxBytes, json.length); stats.maxLines = Math.max(stats.maxLines, pkg.lines.length); stats.maxScope = Math.max(stats.maxScope, scope.length); stats.maxNotes = Math.max(stats.maxNotes, notes.length); stats.maxMs = Math.max(stats.maxMs, ms); stats.maxSubtotal = Math.max(stats.maxSubtotal, pkg.subtotal);
}

if (process.argv[2] === "--repro") {
  for (const tag of process.argv.slice(3)) {
    const i = Number(tag.slice(1));
    const raw = tag[0] === "A" ? randomDesign(rngOf(1000 + i)) : tag[0] === "W" ? wallDesign(i) : (() => { const r = rngOf(50000 + i); return mutate(r, normalizeDeckDesign(randomDesign(r))); })();
    const d = normalizeDeckDesign(skirtFor(tag, raw));
    // --dump: the design alone, before anything is built from it (for one that kills the process when built).
    if (process.argv.includes("--dump")) { console.log(JSON.stringify(d)); continue; }
    console.log(`\n=== ${tag}: ${structureWords(d)} · ${sizeWords(d)} · h ${d.heightIn} in · placement ${d.placement} · floor ${d.floor} · roof ${d.roof.kind}/${d.roof.plan.shape} · stairs ${d.stairs.length} · rail ${d.rail.type} · lower ${d.lower.on} · fixtures ${d.electrical.fixtures.length} · front ${d.shape.kind === "rect" ? d.shape.front?.kind : "L"}`);
    const pkg = priceDeck(d);
    const scene = deckScene(pkg.structure);
    const byLayer = new Map<string, number>();
    for (const b of scene.boxes) byLayer.set(SCENE_LAYERS[b[0]], (byLayer.get(SCENE_LAYERS[b[0]]) ?? 0) + 1);
    console.log(`  ${scene.boxes.length} boxes · ${(JSON.stringify(scene).length / 1024).toFixed(0)} KB · ${[...byLayer.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ")}`);
    console.log(`  joists ${d.framing.joist}/${d.framing.spacingIn} blocking ${d.framing.blocking} · decking ${d.decking.product} ${d.decking.pattern} border ${d.decking.border} · rail ${d.rail.type} ${d.rail.infill} posts ${d.rail.postSpacingFt} ft · lower ${d.lower.on ? `${d.lower.widthFt}x${d.lower.depthFt}` : "no"} · stairs ${d.stairs.map((st) => `${st.side}${st.wrap ? "-wrap" + st.wrapSides : ""}:${st.widthFt}`).join(" ")} · roof ${d.roof.kind} ${d.roof.plan.shape} ${d.roof.rafterSpacingIn} in. walls ${d.roof.walls.fill}/${d.roof.walls.sides}`);
    scene.boxes.forEach((b, k) => { if (!(b[4] > 0 && b[5] > 0 && b[6] > 0)) console.log(`  zero box ${k}: layer ${SCENE_LAYERS[b[0]]} tag ${scene.legend[scene.tags[k]]?.role ?? scene.tags[k]} → ${JSON.stringify(b.map((x) => Math.round(x * 1000) / 1000))}`); });
    for (const l of pkg.lines) if ((l.description ?? "").length > 400) console.log(`  long line ${l.id} (${l.description!.length}): ${l.description!.slice(0, 160)}…`);
    if (process.argv.includes("--json")) console.log(JSON.stringify(d));
  }
  process.exit(0);
}

const trouble: string[] = [];
const run = (tag: string, raw: unknown) => {
  // A design that kills the process outright (an array grown past what V8 holds) leaves its name here: FUZZ_TRACE=<file>.
  if (process.env.FUZZ_TRACE) writeFileSync(process.env.FUZZ_TRACE, tag);
  let d: DeckDesign;
  try { d = normalizeDeckDesign(skirtFor(tag, raw)); } catch (e) { trouble.push(`normalize THREW: ${e instanceof Error ? e.message : String(e)}  [${tag}]`); return; }
  try { exercise(d, tag, trouble); } catch (e) { trouble.push(`THREW: ${e instanceof Error ? (e.stack ?? e.message).split("\n").slice(0, 3).join(" | ") : String(e)}  [${tag}]`); }
};
const started = Date.now();
for (let i = 0; i < nA; i++) run(`A${i}`, randomDesign(rngOf(1000 + i)));
const tA = Date.now() - started;
for (const [i, junk] of [null, 1, "x", [], {}, { v: 99 }, { shape: "x" }, { shape: { kind: "L" } }, { stairs: "x" }, { electrical: { fixtures: [null, 1, {}] } }, { roof: 5 }, { lower: { on: true } }, { photo: {} }, { site: { slope: "x" } }].entries()) run(`root${i}`, junk);
for (let i = 0; i < nB; i++) { const r = rngOf(50000 + i); run(`B${i}`, mutate(r, normalizeDeckDesign(randomDesign(r)))); }
// Decks that follow the house wall, every option around them as random as the rest.
let walls = 0;
for (let i = 0; i < nW; i++) {
  const raw = wallDesign(i);
  if (normalizeDeckDesign(raw).shape.kind === "wall") walls++;
  run(`W${i}`, raw);
}
if (walls < nW * 0.8) trouble.push(`only ${walls} of ${nW} wall designs read back as decks that follow the wall  [W]`);
for (const [i, junk] of [{ kind: "wall" }, { kind: "wall", back: "x" }, { kind: "wall", widthFt: 10, back: [null, 1, { x0Ft: "a" }, { x0Ft: 4, x1Ft: 2, yFt: 3 }] }, { kind: "wall", widthFt: 10, depthFt: 6, back: [{ x0Ft: 0, x1Ft: 5, yFt: -999 }, { x0Ft: 5, x1Ft: 99, yFt: 999 }] }].entries()) run(`WJ${i}`, { shape: junk });
const tB = Date.now() - started - tA;

const groups = new Map<string, string[]>();
for (const t of trouble) { const k = t.replace(/\s+\[.*$/, "").replace(/[-\d.]+/g, "#").slice(0, 90); (groups.get(k) ?? groups.set(k, []).get(k)!).push(t); }
console.log(`fuzz: ${nA} designs in the rails (${(tA / 1000).toFixed(1)} s) + ${nB} junk mutations (${(tB / 1000).toFixed(1)} s) + ${nW} following the house wall (${walls} kept that shape) → ${trouble.length} findings in ${groups.size} groups`);
console.log(`stats: max ${stats.maxBoxes} boxes (${stats.maxBoxesTag}), ${(stats.maxBytes / 1024).toFixed(0)} KB scene, ${stats.maxLines} lines, scope ${stats.maxScope} chars, ${stats.maxNotes} notes, slowest ${stats.maxMs} ms, biggest $${Math.round(stats.maxSubtotal).toLocaleString()}`);
for (const [k, v] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) { console.log(`\n${String(v.length).padStart(5)}×  ${k}`); for (const ex of v.slice(0, 3)) console.log(`        ${ex.slice(0, 400)}`); }
process.exit(trouble.length ? 1 : 0);
