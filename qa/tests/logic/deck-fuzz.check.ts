// A randomized fuzz of the deck engine (2026-10-10, written for the error hunt after M3 shipped): thousands of designs
// inside the rails and thousands of junk mutations go through normalize → build → price → scene → parse → checks →
// elevation → the exact convert payload the studio sends. It found convert refused over long line descriptions,
// zero-size parts that made a scene unreadable, and a normalize drift — all fixed the same day.
//   NODE_PATH="" npx tsx --tsconfig tsconfig.json qa/tests/logic/deck-fuzz.check.ts [nInRails] [nJunk]
//   NODE_PATH="" npx tsx --tsconfig tsconfig.json qa/tests/logic/deck-fuzz.check.ts --repro A40 B5293 [--json]
import { defaultDeckDesign, normalizeDeckDesign, structureWords, sizeWords, FIXTURE_KINDS, STRUCTURES, FLOORS, ROOF_KINDS, ROOF_PLAN_SHAPES, ROOFINGS, GUTTER_KINDS, PLACEMENTS, NOTCH_CORNERS, type DeckDesign } from "../../../src/lib/deck/design";
import { priceDeck, deckScope, deckNotes } from "../../../src/lib/deck/pricing";
import { deckChecks } from "../../../src/lib/deck/checks";
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
  return { kind: "wall", widthFt, depthFt, back };
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

function exercise(d: DeckDesign, tag: string, out: string[]) {
  const t0 = Date.now();
  const d2 = normalizeDeckDesign(JSON.parse(JSON.stringify(d)));
  const drift = diffPath(d, d2);
  if (drift) out.push(`normalize drifts: ${drift}  [${tag}]`);
  const pkg = priceDeck(d);
  if (!(Number.isFinite(pkg.subtotal) && pkg.subtotal >= 0)) out.push(`subtotal bad: ${pkg.subtotal}  [${tag}]`);
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
    const d = normalizeDeckDesign(raw);
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
  let d: DeckDesign;
  try { d = normalizeDeckDesign(raw); } catch (e) { trouble.push(`normalize THREW: ${e instanceof Error ? e.message : String(e)}  [${tag}]`); return; }
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
