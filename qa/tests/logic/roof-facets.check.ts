// The roof facet engine (2026-11-11, owner: "show all facets, ridges … on admin side for testing"), held to roofs whose
// answer is known because they are made here: a height map is computed for a gable, a hip and an L-shaped cross-gable
// roof, and the engine (lib/roofFacets) has to hand back the same facets, ridges, hips, valleys, eaves and rakes — the
// count, the kinds, the lengths, the area — with no cracks between facets. It runs with no help from Google's
// segments (the height map alone) and with them, with the outline placed where it belongs and placed a few feet off
// (as EagleView's is against Google's), and on a roof under a tree. Then the page's side: letters by size, feet, the
// comparison with EagleView's figures, the confidence in plain words, and the map coordinates there and back.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/roof-facets.check.ts
import { buildFacets, type EngineResult, type FacetEdgeType } from "../../../src/lib/roofFacets/engine";
import { fromUtm, latLngToPixel, pixelToUtm, toUtm, type RasterFrame } from "../../../src/lib/roofFacets/geo";
import { facetLetter, facingWord, pitchLabel, toFacetModel } from "../../../src/lib/roofFacets/model";

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
  check("gable: one 12 m ridge, 24 m of eave, four rakes of a sloped 4 m", near(f.RIDGE, 12, 0.15) && near(f.EAVE, 24, 0.15) && near(f.RAKE, 4 * 4 * SL, 0.2) && !f.HIP && !f.VALLEY && !f.STEP && !f.BREAK, JSON.stringify(f));
  check("gable: the area is the plan area stretched by the slope", near(area(r), 96 * SL, 0.6), String(area(r)));
  check("gable: no cracks — the facets fill the outline and every edge has a facet", watertight(r, 96));
  check("gable: the outline was where it belongs, so it is not moved", r.shift.dx === 0 && r.shift.dy === 0);
  check("gable: the roof sits on the planes drawn", r.quality.agree > 0.97 && r.quality.rmsM < 0.04, JSON.stringify(r.quality));
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
  check("L: nothing unsure — no wall steps, no pitch changes, no hips", !f.STEP && !f.BREAK && !f.HIP);
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

// ── nothing to draw ──
check("an outline of two points draws nothing", buildFacets({ ...raster(gable), outline: [{ x: 1, y: 1 }, { x: 5, y: 5 }], priors: [] }) === null);
{
  const flat = { width: W, height: H, data: new Float32Array(W * H).fill(GROUND), pixelSizeM: PX };
  const r = buildFacets({ dsm: flat, mask: null, outline: toPx(gable.outline), priors: [], register: false });
  check("bare ground inside the outline is one flat facet, not a crash", r !== null && r.facets.length === 1 && r.facets[0].slope < 0.02);
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

console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);
