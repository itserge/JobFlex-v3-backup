// The roof facet engine (2026-11-11, owner: "show all facets, ridges … on admin side for testing"), held to roofs whose
// answer is known because they are made here: a height map is computed for a gable, a hip and an L-shaped cross-gable
// roof, and the engine (lib/roofFacets) has to hand back the same facets, ridges, hips, valleys, eaves and rakes — the
// count, the kinds, the lengths, the area — with no cracks between facets. It runs with no help from Google's
// segments (the height map alone) and with them, with the outline placed where it belongs and placed a few feet off
// (as EagleView's is against Google's), and on a roof under a tree. Then the page's side: letters by size, feet, the
// comparison with EagleView's figures, the confidence in plain words, and the map coordinates there and back.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/roof-facets.check.ts
import { buildGraph, collapseShort } from "../../../src/lib/roofFacets/arrange";
import { buildFacets, type EngineResult, type FacetEdgeType } from "../../../src/lib/roofFacets/engine";
import { fromUtm, latLngToPixel, pixelToUtm, toUtm, type RasterFrame } from "../../../src/lib/roofFacets/geo";
import { facetLetter, facingWord, pitchLabel, toFacetModel } from "../../../src/lib/roofFacets/model";
import { sharpenCorners } from "../../../src/lib/roofFacets/raster";
import { roofOutline } from "../../../src/lib/roofFacets/roofOutline";
import { snapToPhoto } from "../../../src/lib/roofFacets/photoSnap";
import { findCones } from "../../../src/lib/roofFacets/round";
import { buildStructureFootprints } from "../../../src/lib/roofRecon/footprint";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

// ── roofs made here: 0.1 m a pixel, 30 m x 30 m, ground at 100 m, eaves 3 m up, every pitch 6/12 ──
const PX = 0.1, W = 300, H = 300, GROUND = 100, EAVE = 3, S = 0.5;
type Roof = { name: string; outline: Array<{ x: number; y: number }>; height: (x: number, y: number) => number | null };
const inRect = (x: number, y: number, r: [number, number, number, number]) => x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3];
// metres, x east, y SOUTH (as the raster runs)
const gable: Roof = {
  name: "gable",
  outline: [{ x: 9, y: 11 }, { x: 21, y: 11 }, { x: 21, y: 19 }, { x: 9, y: 19 }],
  height: (x, y) => (inRect(x, y, [9, 11, 21, 19]) ? EAVE + S * (4 - Math.abs(y - 15)) : null),
};
const hip: Roof = {
  name: "hip",
  outline: gable.outline,
  height: (x, y) => (inRect(x, y, [9, 11, 21, 19]) ? EAVE + S * Math.min(x - 9, 21 - x, y - 11, 19 - y) : null),
};
// an L: wing A runs east-west (ridge at y = 16), wing B runs north from A's ridge (ridge at x = 12)
const A: [number, number, number, number] = [9, 13, 21, 19], B: [number, number, number, number] = [9, 4, 15, 16];
const ell: Roof = {
  name: "L",
  outline: [{ x: 9, y: 4 }, { x: 15, y: 4 }, { x: 15, y: 13 }, { x: 21, y: 13 }, { x: 21, y: 19 }, { x: 9, y: 19 }],
  height: (x, y) => {
    const a = inRect(x, y, A) ? EAVE + S * (3 - Math.abs(y - 16)) : null;
    const b = inRect(x, y, B) ? EAVE + S * (3 - Math.abs(x - 12)) : null;
    return a == null ? b : b == null ? a : Math.max(a, b);
  },
};
function raster(roof: Roof, opts: { tree?: boolean } = {}) {
  const data = new Float32Array(W * H), mask = new Float32Array(W * H);
  let seed = 7;
  const noise = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5) * 0.02;
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const x = (c + 0.5) * PX, y = (r + 0.5) * PX;
    let z = roof.height(x, y);
    if (z != null) mask[r * W + c] = 1;
    // a tree over the north-east corner: a bumpy dome 2 m across standing above the roof
    if (opts.tree && Math.hypot(x - 20.2, y - 11.8) < 1.6) z = (z ?? 0) + 1.2 + 0.6 * Math.sin(x * 9) * Math.cos(y * 7);
    data[r * W + c] = GROUND + (z ?? 0) + noise();
  }
  return { dsm: { width: W, height: H, data, pixelSizeM: PX }, mask: { width: W, height: H, data: mask } };
}
const toPx = (o: Roof["outline"], dx = 0, dy = 0) => o.map((p) => ({ x: p.x / PX + dx, y: p.y / PX + dy }));
const feetOf = (r: EngineResult) => {
  const m: Record<string, number> = {};
  for (const e of r.edges) m[e.type] = (m[e.type] ?? 0) + e.lengthM;
  return m as Record<FacetEdgeType, number>;
};
const planOf = (r: EngineResult, t: FacetEdgeType) => r.edges.filter((e) => e.type === t).reduce((s, e) => s + e.planM, 0);
const area = (r: EngineResult) => r.facets.reduce((s, f) => s + f.areaM2, 0);
const watertight = (r: EngineResult, outlineM2: number) =>
  near(r.facets.reduce((s, f) => s + f.planM2, 0), outlineM2, outlineM2 * 0.005) && r.edges.every((e) => (e.left >= 0 || e.right >= 0) && e.left !== e.right);
const SL = Math.sqrt(1 + S * S); // a 6/12 slope's stretch

// ── the gable, from the height map alone ──
{
  const { dsm, mask } = raster(gable);
  const r = buildFacets({ dsm, mask, outline: toPx(gable.outline), priors: [] })!;
  const f = feetOf(r);
  check("gable: two facets, both 6/12, facing north and south", r.facets.length === 2 && r.facets.every((x) => near(x.slope * 12, 6, 0.05)) && r.facets.map((x) => Math.round(x.azimuthDeg ?? -1)).sort((a, b) => a - b).join() === "0,180", JSON.stringify(r.facets.map((x) => [x.slope * 12, x.azimuthDeg])));
  check("gable: one 12 m ridge, 24 m of eave, four rakes of a sloped 4 m", near(f.RIDGE, 12, 0.15) && near(f.EAVE, 24, 0.15) && near(f.RAKE, 4 * 4 * SL, 0.2) && !f.HIP && !f.VALLEY && !f.STEP && !f.WALL && !f.BREAK, JSON.stringify(f));
  check("gable: the area is the plan area stretched by the slope", near(area(r), 96 * SL, 0.6), String(area(r)));
  check("gable: no cracks — the facets fill the outline and every edge has a facet", watertight(r, 96));
  check("gable: the outline was where it belongs, so it is not moved", r.shift.dx === 0 && r.shift.dy === 0);
  check("gable: the roof sits on the planes drawn", r.quality.agree > 0.97 && r.quality.rmsM < 0.04, JSON.stringify(r.quality));
  check("gable: the height map shows a building under the whole outline", r.quality.buildingShare > 0.97, String(r.quality.buildingShare));
}

// ── the hip ──
{
  const { dsm, mask } = raster(hip);
  const r = buildFacets({ dsm, mask, outline: toPx(hip.outline), priors: [] })!;
  const f = feetOf(r);
  check("hip: four facets facing the four sides", r.facets.length === 4 && r.facets.map((x) => Math.round(x.azimuthDeg ?? -1)).sort((a, b) => a - b).join() === "0,90,180,270");
  // ridge 12 - 8 = 4 m; each hip covers 4 m east and 4 m north and climbs 2 m
  check("hip: a 4 m ridge, four hips of 6 m, eaves all round, no rakes", near(f.RIDGE, 4, 0.2) && near(f.HIP, 4 * Math.sqrt(16 + 16 + 4), 0.3) && near(f.EAVE, 40, 0.2) && !f.RAKE && !f.VALLEY, JSON.stringify(f));
  check("hip: the area is the plan area stretched by the slope", near(area(r), 96 * SL, 0.6), String(area(r)));
  check("hip: no cracks", watertight(r, 96));
  const hips = r.edges.filter((e) => e.type === "HIP");
  check("hip: the hips run at 45 degrees and meet the ridge's ends", hips.length === 4 && hips.every((e) => { const a = r.vertices[e.a], b = r.vertices[e.b]; return near(Math.abs(a.x - b.x), Math.abs(a.y - b.y), 1.5); }));
}

// ── the L: two ridges, two valleys, five facets (the wing cuts the main roof's north face in two) ──
{
  const { dsm, mask } = raster(ell);
  const r = buildFacets({ dsm, mask, outline: toPx(ell.outline), priors: [] })!;
  const f = feetOf(r);
  check("L: five facets", r.facets.length === 5, String(r.facets.length));
  check("L: ridges of 12 m and 12 m", near(f.RIDGE, 24, 0.4), String(f.RIDGE));
  // each valley covers 3 m east and 3 m south and falls 1.5 m
  check("L: two valleys of 4.5 m", near(f.VALLEY, 2 * Math.sqrt(9 + 9 + 2.25), 0.3) && r.edges.filter((e) => e.type === "VALLEY").length === 2, String(f.VALLEY));
  // eaves: the wing's two long sides (9 m each), the main roof's south side (12 m) and what is left of its north (6 m)
  check("L: 36 m of eave and six rakes of a sloped 3 m", near(planOf(r, "EAVE"), 36, 0.3) && near(f.RAKE, 6 * 3 * SL, 0.3), JSON.stringify(f));
  check("L: nothing unsure — no wall or step flashing, no pitch changes, no hips", !f.STEP && !f.WALL && !f.BREAK && !f.HIP);
  check("L: the area is the plan area stretched by the slope", near(area(r), 126 * SL, 0.9), String(area(r)));
  check("L: no cracks", watertight(r, 126));
}

// ── with Google's segments, and with the outline a few feet off ──
{
  const { dsm, mask } = raster(hip);
  const seg = (az: number, cx: number, cy: number) => ({ pitchDeg: (Math.atan(S) * 180) / Math.PI, azimuthDeg: az, cx: cx / PX, cy: cy / PX, zc: GROUND + (hip.height(cx, cy) ?? 0), areaM2: 20 });
  const priors = [seg(0, 15, 12.5), seg(180, 15, 17.5), seg(270, 10.5, 15), seg(90, 19.5, 15)];
  const r = buildFacets({ dsm, mask, outline: toPx(hip.outline, 14, -9), priors })!;
  check("an outline 1.4 m east and 0.9 m north of the building is slid back onto it", r.shift.dx === -14 && r.shift.dy === 9, JSON.stringify(r.shift));
  check("…and the drawing is the same hip roof, every plane one of Google's", r.facets.length === 4 && r.facets.every((x) => x.google) && near(feetOf(r).RIDGE, 4, 0.2) && near(area(r), 96 * SL, 0.6));
  const still = buildFacets({ dsm, mask, outline: toPx(hip.outline, 14, -9), priors, register: false })!;
  check("an outline that is the raster's own is never moved", still.shift.dx === 0 && still.shift.dy === 0);
}

// ── a tree over one corner: the planes run on under it ──
{
  const { dsm, mask } = raster(hip, { tree: true });
  const r = buildFacets({ dsm, mask, outline: toPx(hip.outline), priors: [] })!;
  check("a tree over a corner adds no facet and moves no line by much", r.facets.length === 4 && near(feetOf(r).RIDGE, 4, 0.3) && near(area(r), 96 * SL, 1.2), `${r.facets.length} facets, ridge ${feetOf(r).RIDGE}`);
  check("…and the drawing says the roof does not all sit on its planes", r.quality.agree < 0.97 && r.quality.agree > 0.85, String(r.quality.agree));
}

// ── the outline's clipped corners ──
{
  // a 12 x 8 rectangle whose north-east corner the tracing cut with a 0.5 m stub, and a real 0.6 m jog in the south wall
  const clipped = [{ x: 0, y: 0 }, { x: 11.6, y: 0 }, { x: 12, y: 0.3 }, { x: 12, y: 8 }, { x: 7, y: 8 }, { x: 7, y: 7.4 }, { x: 0, y: 7.4 }];
  const sharp = sharpenCorners(clipped, 0.9, 2);
  check("a corner clipped by a short stub is squared off", sharp.length === 6 && sharp.some((p) => near(p.x, 12, 1e-6) && near(p.y, 0, 1e-6)), JSON.stringify(sharp));
  check("a jog between two parallel walls is left alone", sharp.some((p) => near(p.x, 7, 1e-9) && near(p.y, 8, 1e-9)) && sharp.some((p) => near(p.x, 7, 1e-9) && near(p.y, 7.4, 1e-9)));
  const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  check("an outline with no stubs comes back as it was", JSON.stringify(sharpenCorners(square, 0.9, 2)) === JSON.stringify(square));
}

// ── nothing to draw ──
check("an outline of two points draws nothing", buildFacets({ ...raster(gable), outline: [{ x: 1, y: 1 }, { x: 5, y: 5 }], priors: [] }) === null);
{
  const flat = { width: W, height: H, data: new Float32Array(W * H).fill(GROUND), pixelSizeM: PX };
  const r = buildFacets({ dsm: flat, mask: null, outline: toPx(gable.outline), priors: [], register: false });
  check("bare ground inside the outline is one flat facet, not a crash", r !== null && r.facets.length === 1 && r.facets[0].slope < 0.02);
  check("…and the engine says there is no building there (a house newer than the height map)", r !== null && r.quality.buildingShare === 0);
  // an outline 12 m east of the house: mostly ground, a sliver of roof
  const off = buildFacets({ ...raster(gable), outline: toPx(gable.outline, 110, 0), priors: [], register: false });
  check("an outline that sits mostly off the building shows a small share of building", off !== null && off.quality.buildingShare < 0.2, String(off?.quality.buildingShare));
}

// ── the page's side ──
{
  const { dsm, mask } = raster(ell);
  const result = buildFacets({ dsm, mask, outline: toPx(ell.outline), priors: [] })!;
  // Kirkland, WA sits in UTM zone 10 north
  const origin = toUtm(47.69, -122.17, 32610);
  const frame: RasterFrame = { originX: origin.e, originY: origin.n, pixelSizeM: PX, epsg: 32610 };
  const sqft = 126 * SL * 10.7639;
  const m = toFacetModel({ result, frame, eagleView: { areaSqft: Math.round(sqft), facetCount: 5, pitch: "6/12" }, notes: ["a note"] });
  check("facets are lettered A, B, C… largest first", m.facets.map((f) => f.letter).join("") === "ABCDE" && m.facets.every((f, i) => i === 0 || f.areaSqft <= m.facets[i - 1].areaSqft));
  check("each facet says its pitch and which way it faces", m.facets.every((f) => f.pitchLabel === "6/12" && ["N", "E", "S", "W"].includes(f.facing ?? "")));
  check("the totals are in feet and square feet", near(m.totals.areaSqft, sqft, 12) && near(m.totals.feet.RIDGE, 24 * 3.28084, 1.5) && m.totals.facets === 5 && m.totals.predominantPitch === "6/12", JSON.stringify(m.totals));
  check("a roof with no wall between levels is one part, and every kind of line is counted", m.facets.every((f) => f.part === "Main roof") && m.totals.count.RIDGE === 3 && m.totals.count.VALLEY === 2 && m.totals.count.RAKE === 6 && m.totals.count.STEP === 0, JSON.stringify(m.totals.count));
  check("edges keep their facets by the new letters", m.edges.every((e) => e.left < m.facets.length && e.right < m.facets.length && (e.left >= 0 || e.right >= 0)));
  check("against EagleView: within a percent, high confidence, the reason said", m.compare.areaDeltaPct != null && Math.abs(m.compare.areaDeltaPct) <= 1 && m.confidence.level === "high" && /within .*% of EagleView/.test(m.confidence.reasons[0] ?? ""), JSON.stringify(m.confidence));
  const off = toFacetModel({ result, frame, eagleView: { areaSqft: Math.round(sqft * 1.3), facetCount: 12, pitch: "6/12" } });
  check("a drawing far from EagleView's area and count is not called sure, and says why", off.confidence.level !== "high" && off.confidence.reasons.some((x) => /less than EagleView/.test(x)) && off.confidence.reasons.some((x) => /counts 12 facets/.test(x)), JSON.stringify(off.confidence));
  const none = toFacetModel({ result, frame, eagleView: { areaSqft: null, facetCount: null, pitch: null } });
  check("no EagleView area: nothing to check against, and it says so", none.compare.areaDeltaPct === null && none.confidence.reasons.some((x) => /nothing to be checked against/.test(x)));
  const v = m.vertices[0];
  const back = latLngToPixel(frame, v.lat, v.lng), there = pixelToUtm(frame, back.x, back.y);
  check("a corner's lat/lng leads back to the same spot within a millimetre", near(there.e, v.e, 0.001) && near(there.n, v.n, 0.001));
}
{
  const u = toUtm(47.69, -122.17, 32610), b = fromUtm(u.e, u.n, 32610);
  check("map coordinates: Kirkland lands in zone 10 where it should, and comes back", near(u.e, 562290, 60) && near(u.n, 5282200, 200) && near(b.lat, 47.69, 1e-8) && near(b.lng, -122.17, 1e-8), JSON.stringify(u));
  const s = toUtm(-33.87, 151.21, 32756), sb = fromUtm(s.e, s.n, 32756);
  check("…and south of the equator too", near(sb.lat, -33.87, 1e-8) && near(sb.lng, 151.21, 1e-8) && s.n > 6_000_000);
  check("letters run past Z", facetLetter(0) === "A" && facetLetter(25) === "Z" && facetLetter(26) === "AA" && facetLetter(27) === "AB");
  check("a facing is a compass word, a pitch a rise over 12", facingWord(0) === "N" && facingWord(135) === "SE" && facingWord(350) === "N" && facingWord(null) === null && pitchLabel(6.2) === "6/12" && pitchLabel(0.1) === "flat" && pitchLabel(0.4) === "low slope");
}

// ── a roof measured from Google alone: the outline is read off the height map (owner, 2026-11-12: "should draw only
//    roof … no garden on the side of the house … angles not 90"). Google's building mask is generous here on purpose:
//    it takes in a deck a storey under the eave, a driveway at ground level, and a strip of ground past the east wall;
//    and the height map is blurred the way a real one is, so every wall is a ramp. The house is a 12 m x 8 m gable.
{
  type Part = { box: [number, number, number, number]; height: (u: number, v: number) => number };
  const scene = (parts: Part[], maskOnly: Array<[number, number, number, number]>, turnDeg: number) => {
    const t = (turnDeg * Math.PI) / 180, cos = Math.cos(t), sin = Math.sin(t);
    const sharp = new Float32Array(W * H), mask = new Float32Array(W * H);
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
      // the building's own coordinates: the picture turned back about its middle
      const x = (c + 0.5) * PX - 15, y = (r + 0.5) * PX - 15;
      const u = x * cos + y * sin + 15, v = -x * sin + y * cos + 15;
      let z = 0;
      for (const p of parts) if (inRect(u, v, p.box)) { z = Math.max(z, p.height(u, v)); mask[r * W + c] = 1; }
      for (const b of maskOnly) if (inRect(u, v, b)) mask[r * W + c] = 1;
      sharp[r * W + c] = GROUND + z;
    }
    // a 0.5 m blur: what photogrammetry does to a wall
    const data = new Float32Array(W * H);
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
      let sum = 0, n = 0;
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= H || cc >= W) continue;
        sum += sharp[rr * W + cc]; n++;
      }
      data[r * W + c] = sum / n;
    }
    const found = buildStructureFootprints({ width: W, height: H, data: mask, pixelSizeM: PX, originX: 0, originY: 0, epsg: null }, { rawFallback: true }).structures.filter((x) => x.ring);
    const pick = found.find((x) => x.onParcel) ?? found[0];
    const stepFt = PX * 3.28084;
    const seed = (pick?.ring ?? []).map((p) => ({ x: p.x / stepFt + W / 2, y: H / 2 - p.y / stepFt }));
    return { dsm: { width: W, height: H, data, pixelSizeM: PX }, mask: { width: W, height: H, data: mask }, seed, turnDeg };
  };
  const ringM2 = (ring: Array<{ x: number; y: number }>) => Math.abs(ring.reduce((a, p, i) => { const q = ring[(i + 1) % ring.length]; return a + p.x * q.y - q.x * p.y; }, 0) / 2) * PX * PX;
  /** the furthest any wall of the ring turns from the building's two directions, degrees */
  const offSquare = (ring: Array<{ x: number; y: number }>, turnDeg: number) => Math.max(...ring.map((p, i) => {
    const q = ring[(i + 1) % ring.length];
    const d = ((((Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI - turnDeg) % 90) + 90) % 90;
    return Math.min(d, 90 - d);
  }));
  const tall = (u: number, v: number) => 5.5 + S * (4 - Math.abs(v - 15)); // eaves 5.5 m up: two storeys
  const house: Part = { box: [9, 11, 21, 19], height: tall };
  const deck: Part = { box: [12, 19, 17, 22], height: () => 2.8 };
  const driveway: Part = { box: [3, 13, 9, 17], height: () => 0.05 };
  const strip: [number, number, number, number] = [21, 11, 22.2, 19];
  for (const turn of [0, 20]) {
    const sc = scene([house, deck, driveway], [strip], turn);
    const notes: string[] = [];
    const out = roofOutline({ dsm: sc.dsm, mask: sc.mask, seed: sc.seed, priors: [], trace: notes });
    const tag = turn ? `turned ${turn} degrees` : "square to the map";
    check(`Google-only, ${tag}: Google's outline takes in the deck, the driveway and the strip`, ringM2(sc.seed) > 96 + 15 + 24, `${ringM2(sc.seed).toFixed(1)} m2`);
    check(`Google-only, ${tag}: the roof's outline is the house and nothing else`, out != null && near(ringM2(out.ring), 96, 5), out ? `${ringM2(out.ring).toFixed(1)} m2` : "no outline");
    check(`Google-only, ${tag}: four corners, every wall along the building`, out != null && out.ring.length === 4 && offSquare(out.ring, turn) < 1, out ? `${out.ring.length} corners, ${offSquare(out.ring, turn).toFixed(2)} degrees off` : "");
    check(`Google-only, ${tag}: the deck is left out as a deck, the driveway as too low`, out != null && near(out.leftOut.deck, 15, 4) && out.leftOut.ground >= 24 * 0.8 && out.leftOut.ground <= 24 + 9.6 + 4, out ? JSON.stringify(out.leftOut) : "");
    check(`Google-only, ${tag}: and the notes say so in feet`, notes.some((x) => /deck/.test(x) && /sq ft/.test(x)) && notes.some((x) => /lower than 5 ft/.test(x)), notes.join(" | "));
    if (out) {
      const res = buildFacets({ dsm: sc.dsm, mask: sc.mask, outline: out.ring, priors: [], register: false });
      check(`Google-only, ${tag}: the facets drawn inside are the gable's two`, res != null && res.facets.length === 2 && near(area(res), 96 * SL, 96 * SL * 0.06), res ? `${res.facets.length} facets, ${area(res).toFixed(1)} m2` : "nothing");
    }
  }
  {
    // a flat patio cover hanging just under the eave of a one-storey house is a roof, and stays
    const low = (u: number, v: number) => EAVE + S * (4 - Math.abs(v - 15));
    const sc = scene([{ box: [9, 11, 21, 19], height: low }, { box: [12, 19, 17, 22], height: () => EAVE - 0.5 }], [], 0);
    const out = roofOutline({ dsm: sc.dsm, mask: sc.mask, seed: sc.seed, priors: [] });
    check("Google-only: a flat cover just under the eave is kept as roof", out != null && near(ringM2(out.ring), 96 + 15, 6) && out.leftOut.deck < 1, out ? `${ringM2(out.ring).toFixed(1)} m2 ${JSON.stringify(out.leftOut)}` : "no outline");
  }
  {
    // a two-foot jog in the north wall is a jog, not noise; a half-foot one is the height map's wobble
    const jog = (d: number) => scene([{ box: [9, 11, 15, 19], height: tall }, { box: [15, 11 + d, 21, 19], height: tall }], [], 0);
    const two = roofOutline({ ...jog(0.7), priors: [] }), half = roofOutline({ ...jog(0.15), priors: [] });
    check("Google-only: a two-foot jog in a wall stays (six corners, all square)", two != null && two.ring.length === 6 && offSquare(two.ring, 0) < 1 && near(ringM2(two.ring), 96 - 6 * 0.7, 5), two ? `${two.ring.length} corners ${ringM2(two.ring).toFixed(1)} m2 ${offSquare(two.ring, 0).toFixed(2)} off ${two.ring.map((p) => `${p.x.toFixed(0)},${p.y.toFixed(0)}`).join(" ")}` : "");
    check("Google-only: a half-foot wobble is one straight wall (four corners)", half != null && half.ring.length === 4, half ? `${half.ring.length} corners` : "");
  }
  {
    // a wing set at 45 degrees keeps its slanted walls
    const t = Math.SQRT1_2;
    const wing: Part = { box: [-99, -99, 99, 99], height: (u, v) => { const a = (u - 21) * t + (v - 19) * t, b = -(u - 21) * t + (v - 19) * t; return a >= -1 && a <= 7 && Math.abs(b) <= 3 ? 5.5 + S * (3 - Math.abs(b)) : 0; } };
    const sc = scene([house, { box: [14, 12, 29, 27], height: (u, v) => wing.height(u, v) }], [], 0);
    // the wing's box is generous: only where it stands does the mask count
    for (let i = 0; i < sc.mask.data.length; i++) if (sc.dsm.data[i] < GROUND + 1.5) sc.mask.data[i] = 0;
    const out = roofOutline({ dsm: sc.dsm, mask: sc.mask, seed: sc.seed, priors: [] });
    const slants = out ? out.ring.filter((p, i) => { const q = out.ring[(i + 1) % out.ring.length]; const d = ((((Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI) % 90) + 90) % 90; return Math.abs(d - 45) < 4 && Math.hypot(q.x - p.x, q.y - p.y) * PX > 2; }).length : 0;
    check("Google-only: a wing set at 45 degrees keeps its slanted walls", out != null && slants >= 2, out ? `${out.ring.length} corners, ${slants} slanted walls` : "no outline");
  }
  {
    // "If it's not visible, logically we have to run the straight line" (owner, 2026-11-12): a small notch in the
    // north wall, 2.2 m wide and 1.1 m deep. Where open ground shows in it, it is a notch and stays. Where something
    // stands in it that is neither ground nor roof (a gap in shadow between two parts of a roof: high, rough, off the
    // plane), the wall runs on straight across it.
    const notch: [number, number, number, number] = [14, 11, 16.2, 12.1];
    const withNotch = (inside: (u: number, v: number) => number): Part => ({ box: house.box, height: (u, v) => (inRect(u, v, notch) ? inside(u, v) : tall(u, v)) });
    const open = scene([withNotch(() => 0)], [], 0);
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (inRect((c + 0.5) * PX, (r + 0.5) * PX, notch)) open.mask.data[r * W + c] = 0;
    const openSeed = buildStructureFootprints({ width: W, height: H, data: open.mask.data, pixelSizeM: PX, originX: 0, originY: 0, epsg: null }, { rawFallback: true }).structures.find((x) => x.onParcel)?.ring ?? [];
    const stepFt = PX * 3.28084;
    const seen = roofOutline({ dsm: open.dsm, mask: open.mask, seed: openSeed.map((p) => ({ x: p.x / stepFt + W / 2, y: H / 2 - p.y / stepFt })), priors: [] });
    check("Google-only: a notch with open ground in it is a notch (eight corners)", seen != null && seen.ring.length === 8 && offSquare(seen.ring, 0) < 1, seen ? `${seen.ring.length} corners ${ringM2(seen.ring).toFixed(1)} m2` : "no outline");
    const shade = scene([withNotch((u, v) => tall(u, v) - 2 + 0.7 * Math.sin(u * 23) * Math.cos(v * 19))], [], 0);
    const hid = roofOutline({ dsm: shade.dsm, mask: shade.mask, seed: shade.seed, priors: [] });
    check("Google-only: the same notch with nothing plain to see in it is closed, the wall runs on straight (four corners)", hid != null && hid.ring.length === 4 && near(ringM2(hid.ring), 96, 5), hid ? `${hid.ring.length} corners ${ringM2(hid.ring).toFixed(1)} m2` : "no outline");
  }
}

// ── "logically it should be straight … assume it's a continuation" (owner, 2026-11-12, of a wall line drawn at a slant
//    inside the roof). A lower roof stands against the east wall of a two-storey house and starts 2 m south of the
//    house's corner, so the wall between the two roofs is the outside wall running on. It has to be drawn on that line.
{
  const upper = (x: number, y: number) => 5.5 + S * (4 - Math.abs(y - 15));
  const two: Roof = {
    name: "upper and lower",
    outline: [{ x: 9, y: 11 }, { x: 17, y: 11 }, { x: 17, y: 13 }, { x: 21, y: 13 }, { x: 21, y: 19 }, { x: 9, y: 19 }],
    height: (x, y) => (inRect(x, y, [9, 11, 17, 19]) ? upper(x, y) : inRect(x, y, [17, 13, 21, 19]) ? 3.4 - 0.3 * (x - 17) : null),
  };
  const { dsm, mask } = raster(two);
  // blur it as a real height map is blurred: the wall becomes a ramp half a metre wide
  const sharp = dsm.data.slice();
  for (let r = 2; r < H - 2; r++) for (let c = 2; c < W - 2; c++) {
    let sum = 0;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) sum += sharp[(r + dr) * W + c + dc];
    dsm.data[r * W + c] = sum / 25;
  }
  const res = buildFacets({ dsm, mask, outline: toPx(two.outline), priors: [], register: false });
  const wall = res ? res.edges.filter((e) => (e.type === "STEP" || e.type === "WALL") && e.planM > 0.5) : [];
  const offLine = Math.max(0, ...wall.flatMap((e) => [res!.vertices[e.a].x, res!.vertices[e.b].x]).map((x) => Math.abs(x - 170)));
  // exactly on it: a fitted line lands a fraction of a pixel to a foot beside the wall's line, and any of that shows as a kink
  check("a wall between two roof levels that continues an outside wall is drawn on that wall's line", res != null && res.facets.length === 3 && wall.length >= 1 && near(wall.reduce((a, e) => a + e.planM, 0), 6, 0.7) && offLine <= 0.05, res ? `${res.facets.length} facets, ${wall.length} wall edge(s) ${wall.reduce((a, e) => a + e.planM, 0).toFixed(1)} m, ${offLine.toFixed(2)} px off the line` : "nothing");
}
{
  // a line that meets a wall three pixels from the wall's corner meets it at the corner (and the outline is not touched)
  const ring = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 60 }, { x: 60, y: 60 }, { x: 60, y: 100 }, { x: 0, y: 100 }];
  const segs = ring.map((p, i) => ({ a: p, b: ring[(i + 1) % ring.length], outline: true, tag: -1 }));
  const g = collapseShort(buildGraph([...segs, { a: { x: 20, y: 20 }, b: { x: 60, y: 63 }, outline: false, tag: 1 }, { a: { x: 20, y: 20 }, b: { x: 0, y: 20 }, outline: false, tag: 2 }], 1.2), 5);
  const ends = g.edges.filter((e) => !e.outline).flatMap((e) => [g.verts[e.a], g.verts[e.b]]);
  const corners = ring.every((c) => g.edges.some((e) => e.outline && [g.verts[e.a], g.verts[e.b]].some((v) => near(v.x, c.x, 1e-6) && near(v.y, c.y, 1e-6))));
  check("a line that meets a wall just short of its corner meets it at the corner", ends.some((v) => near(v.x, 60, 1e-6) && near(v.y, 60, 1e-6)) && !g.verts.some((v, i) => near(v.x, 60, 1e-6) && near(v.y, 63, 1e-6) && g.edges.some((e) => e.a === i || e.b === i)) && corners, JSON.stringify(ends));
}

// ── EagleView's outline comes with corners a few degrees off square, and was used as it came (owner, 2026-11-12, of two
//    EagleView roofs: "find what to fix to make right"). Their outline now goes through the same squaring as a roof
//    read off Google's data: still their roof, its walls along the building.
{
  const { dsm, mask } = raster(gable);
  // the gable's outline as EagleView might hand it over: every corner off by up to half a metre, one wall in two pieces
  const crooked = [{ x: 9.2, y: 11.3 }, { x: 15, y: 10.8 }, { x: 21.1, y: 11.2 }, { x: 20.7, y: 19.2 }, { x: 8.8, y: 18.7 }];
  const res = buildFacets({ dsm, mask, outline: toPx(crooked), priors: [] });
  const outer = res ? res.edges.filter((e) => e.left < 0 || e.right < 0) : [];
  const worst = Math.max(0, ...outer.filter((e) => e.planM > 0.5).map((e) => {
    const a = res!.vertices[e.a], b = res!.vertices[e.b];
    const d = ((((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI) % 90) + 90) % 90;
    return Math.min(d, 90 - d);
  }));
  const plan = res ? res.facets.reduce((t, f) => t + f.planM2, 0) : 0;
  check("EagleView's outline with crooked corners is squared to the building, and stays their roof", res != null && res.facets.length === 2 && worst < 1 && near(plan, 96, 5), res ? `${res.facets.length} facets, worst wall ${worst.toFixed(2)} degrees off, ${plan.toFixed(1)} m2` : "nothing");
  const asIs = buildFacets({ dsm, mask, outline: toPx(crooked), priors: [], squareOutline: false });
  const worstAsIs = asIs ? Math.max(0, ...asIs.edges.filter((e) => (e.left < 0 || e.right < 0) && e.planM > 0.5).map((e) => {
    const a = asIs.vertices[e.a], b = asIs.vertices[e.b];
    const d = ((((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI) % 90) + 90) % 90;
    return Math.min(d, 90 - d);
  })) : 0;
  check("…and it is the squaring that does it (left off, the walls keep their slant)", worstAsIs > 2, `${worstAsIs.toFixed(2)} degrees`);
}
{
  // A 14/12 gable, blurred as a height map is: the ridge must come out a ridge. (On the real roof this went wrong —
  // the seam between the two faces lay two pixels off the true ridge, which on a roof this steep reads as a step of
  // a foot and more, and the ridge was drawn as a wall. A made-up roof this clean puts the seam on the ridge, so
  // this check holds the steep case in place without reproducing that fault; the fix itself was checked on the real
  // roof.)
  const steep: Roof = { name: "steep gable", outline: gable.outline, height: (x, y) => (inRect(x, y, [9, 11, 21, 19]) ? EAVE + (14 / 12) * (4 - Math.abs(y - 15.15)) : null) };
  const { dsm, mask } = raster(steep);
  const sharp = dsm.data.slice();
  for (let r = 2; r < H - 2; r++) for (let c = 2; c < W - 2; c++) {
    let sum = 0;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) sum += sharp[(r + dr) * W + c + dc];
    dsm.data[r * W + c] = sum / 25;
  }
  const res = buildFacets({ dsm, mask, outline: toPx(steep.outline), priors: [], squareOutline: false });
  const f = res ? feetOf(res) : ({} as Record<FacetEdgeType, number>);
  check("a very steep ridge is a ridge, not a wall between two roofs", res != null && res.facets.length === 2 && near(planOf(res, "RIDGE"), 12, 0.6) && !(f.WALL > 0) && !(f.STEP > 0), res ? `${res.facets.length} facets ${JSON.stringify(Object.fromEntries(Object.entries(f).map(([k, v]) => [k, Math.round(v as number)])))}` : "nothing");
}

// ── a round roof (owner, 2026-11-13, of a house with a turret: "looks like it doesn't read the round roofs") ──
{
  // the gable house with a turret on its west wall: a cone 2.5 m in radius, 4.8/12, its peak 1.5 m out from the wall
  const CX = 7.5, CY = 15, R = 2.5, K = 0.4;
  const turret: Roof = {
    name: "turret",
    // the outline as an aerial vendor traces it: the circle cut into a few straight walls
    outline: [{ x: 9, y: 11 }, { x: 21, y: 11 }, { x: 21, y: 19 }, { x: 9, y: 19 }, { x: 9, y: 17 }, { x: 7.5, y: 17.6 }, { x: 5.6, y: 16.5 }, { x: 4.9, y: 15 }, { x: 5.6, y: 13.5 }, { x: 7.5, y: 12.4 }, { x: 9, y: 13 }],
    height: (x, y) => {
      const house = gable.height(x, y), d = Math.hypot(x - CX, y - CY);
      const cone = d <= R ? EAVE + K * (R - d) : null;
      return house == null ? cone : cone == null ? house : Math.max(house, cone);
    },
  };
  const { dsm, mask } = raster(turret);
  const res = buildFacets({ dsm, mask, outline: toPx(turret.outline), priors: [], register: false, squareOutline: false });
  const round = res?.facets.filter((f) => f.round) ?? [];
  // the cone's plan: its disc less the part the house's roof stands over (beyond the wall, 1.5 m from the peak)
  const plan = Math.PI * R * R - (R * R * Math.acos(1.5 / R) - 1.5 * Math.sqrt(R * R - 1.5 * 1.5));
  check("a turret's cone is one round facet beside the house's two", res != null && round.length === 1 && res.facets.length === 3, res ? `${res.facets.length} facets, ${round.length} round` : "no result");
  check("the round facet's size and pitch are the cone's", round.length === 1 && near(round[0].planM2, plan, plan * 0.25) && near(round[0].slope, K, 0.05) && round[0].azimuthDeg === null, round[0] ? `${round[0].planM2.toFixed(1)} m2 (the cone ${plan.toFixed(1)}), ${(round[0].slope * 12).toFixed(1)}/12` : "");
  const ri = res ? res.facets.indexOf(round[0]) : -1;
  const eaves = res ? res.edges.filter((e) => e.type === "EAVE" && (e.left === ri || e.right === ri)) : [];
  const off = res ? Math.max(0, ...eaves.flatMap((e) => [e.a, e.b]).map((v) => Math.abs(Math.hypot(res.vertices[v].x * PX - CX, res.vertices[v].y * PX - CY) - R))) : 9;
  // (the eave is drawn a little inside where the height map ends it: a real height map reads a roof's edge fat, and
  // the allowance was set on the first real turret, held against its photograph)
  check("its eave is drawn as the curve it is, on the circle", eaves.length >= 6 && off < 0.45, `${eaves.length} chords, ${off.toFixed(2)} m off the circle at the worst`);
  // a hip roof's peak is not a round roof
  const flat = raster(hip);
  const all = new Uint8Array(W * H).fill(1);
  check("a hip roof is not taken for a round one", findCones(flat.dsm.data, W, H, all, PX).length === 0 && (buildFacets({ ...flat, outline: toPx(hip.outline), priors: [] })?.facets.every((f) => !f.round) ?? false));
}

// ── the lines set on the photograph (owner, 2026-11-13: "it's offset — not following the roof") ──
{
  // the gable, and a photograph in which the roof's edge lies 0.3 m inside where the soft height map reads it, and
  // the ridge 0.2 m south of the planes' crossing
  const { dsm, mask } = raster(gable);
  const res = buildFacets({ dsm, mask, outline: toPx(gable.outline), priors: [], register: false, squareOutline: false })!;
  const rgb = new Uint8Array(W * H * 3);
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const x = (c + 0.5) * PX, y = (r + 0.5) * PX;
    const on = inRect(x, y, [9.3, 11.3, 20.7, 18.7]);
    const v = !on ? 60 : y < 15.2 ? 150 : 200;
    rgb[(r * W + c) * 3] = rgb[(r * W + c) * 3 + 1] = rgb[(r * W + c) * 3 + 2] = v;
  }
  const before = area(res);
  const rep = snapToPhoto(res, { width: W, height: H, data: rgb, toPhoto: (q) => q, scale: 1 }, dsm);
  const xs = res.vertices.map((v) => v.x * PX), ys = res.vertices.map((v) => v.y * PX);
  const ridgeY = res.edges.filter((e) => e.type === "RIDGE").flatMap((e) => [res.vertices[e.a].y * PX, res.vertices[e.b].y * PX]);
  check("the walls are set on the roof's edge in the photograph", rep.moved >= 4 && near(Math.min(...xs), 9.3, 0.08) && near(Math.max(...xs), 20.7, 0.08) && near(Math.min(...ys), 11.3, 0.08) && near(Math.max(...ys), 18.7, 0.08), `${rep.moved} of ${rep.lines} lines moved; x ${Math.min(...xs).toFixed(2)}..${Math.max(...xs).toFixed(2)}, y ${Math.min(...ys).toFixed(2)}..${Math.max(...ys).toFixed(2)}`);
  check("the ridge is set on the ridge in the photograph", ridgeY.length > 0 && ridgeY.every((y) => near(y, 15.2, 0.1)), ridgeY.map((y) => y.toFixed(2)).join(" "));
  const box = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
  check("the drawing is measured again and still has no cracks", watertight(res, box) && area(res) < before && near(area(res), 11.4 * 7.4 * SL, 1.5), `${area(res).toFixed(1)} m2 (was ${before.toFixed(1)})`);
  // a photograph with nothing to see moves nothing
  const res2 = buildFacets({ dsm, mask, outline: toPx(gable.outline), priors: [], register: false, squareOutline: false })!;
  const blank = new Uint8Array(W * H * 3).fill(128);
  check("a photograph that shows no edge moves nothing", snapToPhoto(res2, { width: W, height: H, data: blank, toPhoto: (q) => q, scale: 1 }, dsm).moved === 0 && near(area(res2), before, 1e-6));
}

console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);
