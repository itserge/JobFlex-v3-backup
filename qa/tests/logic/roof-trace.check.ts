// THE HAND-TRACED ROOF LINES (2026-11-16, owner: "imagine that you're an artist … just draw the lines … the hips,
// valleys, edges", then "make this auto draw tool … for admin only"): a trace is cleaned before it is saved, its lines
// get their lengths along the roof at the main pitch, the editor's steps (snap to a point, split a line, join two
// points, move, retype, delete, tidy) do what they say, the facet engine's lines can be taken as a start, and the roof
// report draws a saved trace — on the photo, in the lines drawing, in the lines table and the order list — while a
// roof without one reads exactly as before. Pure, on a made-up hip house.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/roof-trace.check.ts
// ROOF_TRACE_OUT=<folder> also writes the contractor PDF with the traced lines there to look at.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import type { FacetModel } from "../../../src/lib/roofFacets/model";
import type { InstantRoofData } from "../../../src/lib/eagleview";
import { cleanTrace, pitchRise, slopeFactor, traceFromEngine, traceLengthsFt, traceTotals, toWindow, fromWindow } from "../../../src/lib/roofTrace/trace";
import { EMPTY_EDIT, addPoint, compact, connect, deleteLine, editFromTrace, looseEnds, mergePoints, movePoint, nearestLine, nearestPoint, setType, splitLine, traceFromEdit } from "../../../src/lib/roofTrace/edit";
import { roofReportData } from "../../../src/lib/roofReport/report";
import { RoofReportPdfDocument } from "../../../src/lib/pdf/RoofReportPdf";

let bad = 0;
const check = (name: string, ok: boolean, extra: unknown = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || extra === "" ? "" : ` — ${typeof extra === "string" ? extra : JSON.stringify(extra)}`}`);
};
const near = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol;
const FT = 3.28084;

// ── Cleaning a trace before it is saved ─────────────────────────────────────────────────────────────────────────────
const E0 = 500000, N0 = 5280000;
const P = (e: number, n: number) => ({ e: E0 + e, n: N0 + n });
check("junk is refused: no points or lines", !cleanTrace(null).ok && !cleanTrace({ points: [] }).ok && !cleanTrace("x").ok);
check("a point with no place, a line to nowhere, an unknown kind are refused",
  !cleanTrace({ points: [{ e: "a", n: 1 }], lines: [] }).ok &&
  !cleanTrace({ points: [P(0, 0)], lines: [{ a: 0, b: 3, type: "EAVE" }] }).ok &&
  !cleanTrace({ points: [P(0, 0), P(5, 0)], lines: [{ a: 0, b: 1, type: "GUTTER" }] }).ok);
const messy = cleanTrace({ points: [P(0, 0), P(9, 9), P(10, 0), P(10, 0.01), P(0, 0)], lines: [{ a: 0, b: 2, type: "EAVE" }, { a: 2, b: 0, type: "EAVE" }, { a: 2, b: 3, type: "RAKE" }, { a: 0, b: 0, type: "HIP" }], source: "weird" });
check("a line twice, a line of no length and a line from a point to itself go; unused points go; points renumbered",
  messy.ok && messy.body.lines.length === 1 && messy.body.points.length === 2 && messy.body.lines[0].a === 0 && messy.body.lines[0].b === 1 && messy.body.source === "hand", messy);
check("a drawing spread wider than one lot is refused", !cleanTrace({ points: [P(0, 0), P(900, 0)], lines: [{ a: 0, b: 1, type: "EAVE" }] }).ok);
check("too many lines is refused", !cleanTrace({ points: [P(0, 0), P(1, 0)], lines: Array.from({ length: 3001 }, () => ({ a: 0, b: 1, type: "EAVE" })) }).ok);

// ── Lengths along the roof ──────────────────────────────────────────────────────────────────────────────────────────
check("pitch words to rise: 6/12 → 6, flat → 0, 6.5/12 → 6.5, nonsense → null", pitchRise("6/12") === 6 && pitchRise("flat") === 0 && pitchRise(" 6.5 / 12 ") === 6.5 && pitchRise("steep") === null && pitchRise(null) === null);
check("level lines keep their plan length; rakes climb the slope; hips and valleys half as steeply",
  slopeFactor("EAVE", 6) === 1 && slopeFactor("RIDGE", 12) === 1 && near(slopeFactor("RAKE", 12), Math.SQRT2) && near(slopeFactor("HIP", 12), Math.sqrt(1.5)) && near(slopeFactor("VALLEY", 6), Math.sqrt(1 + 0.125)) && slopeFactor("RAKE", null) === 1);
// a hip house traced: eaves round a 17 × 10 m box, ridge, four hips — the eave on the south drawn in three clicks
const house = {
  points: [P(0, 0), P(6, 0), P(11, 0), P(17, 0), P(17, 10), P(0, 10), P(5, 5), P(12, 5)],
  lines: [
    { a: 0, b: 1, type: "EAVE" as const }, { a: 1, b: 2, type: "EAVE" as const }, { a: 2, b: 3, type: "EAVE" as const },
    { a: 3, b: 4, type: "EAVE" as const }, { a: 4, b: 5, type: "EAVE" as const }, { a: 5, b: 0, type: "EAVE" as const },
    { a: 6, b: 7, type: "RIDGE" as const },
    { a: 0, b: 6, type: "HIP" as const }, { a: 3, b: 7, type: "HIP" as const }, { a: 4, b: 7, type: "HIP" as const }, { a: 5, b: 6, type: "HIP" as const },
  ],
};
const tt = traceTotals(house, 6);
check("feet: eaves round the box, the ridge, four hips at 6/12", near(tt.feet.EAVE, (17 * 2 + 10 * 2) * FT, 1e-6) && near(tt.feet.RIDGE, 7 * FT, 1e-6) && near(tt.feet.HIP, 4 * Math.hypot(5, 5) * FT * Math.sqrt(1 + 0.125), 1e-6), tt.feet);
check("runs: the south eave drawn in three clicks counts once — four eaves, one ridge, four hips", tt.count.EAVE === 4 && tt.count.RIDGE === 1 && tt.count.HIP === 4, tt.count);
check("each line's length in the trace's order", traceLengthsFt(house, 6).length === house.lines.length && near(traceLengthsFt(house, 6)[0], 6 * FT, 1e-9));

// ── The editor's steps ─────────────────────────────────────────────────────────────────────────────────────────────
const W = { e0: E0 - 5, n0: N0 + 15 };
check("photo metres and map metres there and back", (() => { const q = toWindow(P(3, 4), W); const b = fromWindow(q, W); return near(q.x, 8) && near(q.y, 11) && near(b.e, E0 + 3) && near(b.n, N0 + 4); })());
let st = EMPTY_EDIT;
const step = <T,>(r: [typeof st, T]): T => { st = r[0]; return r[1]; };
const k0 = step(addPoint(st, { x: 0, y: 0 }));
const k1 = step(addPoint(st, { x: 10, y: 0 }));
st = connect(st, k0, k1, "EAVE");
check("a line between two points; the same line again, or a point to itself, adds nothing", st.lines.length === 1 && connect(st, k1, k0, "RAKE") === st && connect(st, k0, k0, "EAVE") === st);
check("a click near a point lands on it; far away lands on nothing; points no line uses are not found",
  nearestPoint(st, 0.2, 0.1, 0.5) === k0 && nearestPoint(st, 5, 5, 0.5) === -1 && (() => { const [s2, k] = addPoint(st, { x: 3, y: 3 }); return nearestPoint(s2, 3, 3, 0.5) === -1 && k === 2; })());
const hit = nearestLine(st, 4, 0.3, 0.5);
check("a click near a line finds it and the foot of the click on it", !!hit && hit.i === 0 && near(hit.at.x, 4) && near(hit.at.y, 0) && nearestLine(st, 4, 3, 0.5) === null);
const k2 = step(splitLine(st, 0, { x: 4, y: 0.2 }));
check("a line split where a new one meets it: two lines of its kind, the new point on the line", st.lines.length === 2 && st.lines.every((l) => l.type === "EAVE") && near(st.pts[k2].y, 0) && near(st.pts[k2].x, 4));
const k3 = step(addPoint(st, { x: 4, y: 5 }));
st = connect(st, k2, k3, "VALLEY");
check("a loose end is counted until it is joined", looseEnds(st) === 3);
st = movePoint(st, k3, { x: 4.1, y: 5.2 });
check("a point moved; its line follows", near(st.pts[st.lines[2].b].x, 4.1));
st = setType(st, 2, "HIP");
check("a line retyped", st.lines[2].type === "HIP" && setType(st, 2, "HIP") === st);
const k4 = step(addPoint(st, { x: 10, y: 5 }));
const merged = mergePoints(st, k3, k4);
check("a point dropped on another joins it: its lines now end there", merged.lines.length === 3 && merged.lines[2].a === k2 && merged.lines[2].b === k4);
check("…a line between the two goes; a line that would be drawn twice goes", mergePoints(merged, k2, k1).lines.length === 2 && mergePoints(st, k3, k1).lines.length === 2);
const deleted = deleteLine(st, 2);
check("a line deleted", deleted.lines.length === 2 && compact(deleted).pts.length === 3);
const tidy = compact({ pts: [{ x: 9, y: 9 }, ...st.pts], lines: st.lines.map((l) => ({ ...l, a: l.a + 1, b: l.b + 1 })) });
check("tidy: points no line uses go, the rest renumbered", tidy.pts.length === 4 && tidy.lines.every((l) => l.a < 4 && l.b < 4));
const body = traceFromEdit(st, W, "hand");
const back = editFromTrace(body, W);
check("the editor's drawing to a trace and back: same lines, same places", body.lines.length === 3 && back.lines.length === 3 && near(back.pts[back.lines[2].b].x, 4.1, 1e-6));

// ── Starting from the facet engine's lines ─────────────────────────────────────────────────────────────────────────
const V: Array<[number, number]> = [[0, 0], [17, 0], [17, 10], [0, 10], [5, 5], [12, 5]];
const engineEdges: FacetModel["edges"] = [
  { a: 0, b: 1, type: "EAVE", lengthFt: 17 * FT, left: 0, right: -1 }, { a: 1, b: 2, type: "EAVE", lengthFt: 10 * FT, left: 3, right: -1 },
  { a: 2, b: 3, type: "EAVE", lengthFt: 17 * FT, left: 1, right: -1 }, { a: 3, b: 0, type: "EAVE", lengthFt: 10 * FT, left: 2, right: -1 },
  { a: 4, b: 5, type: "RIDGE", lengthFt: 7 * FT, left: 0, right: 1 },
  { a: 0, b: 4, type: "HIP", lengthFt: 25, left: 0, right: 2 }, { a: 1, b: 5, type: "HIP", lengthFt: 25, left: 0, right: 3 },
  { a: 2, b: 5, type: "HIP", lengthFt: 25, left: 1, right: 3 }, { a: 3, b: 4, type: "HIP", lengthFt: 25, left: 1, right: 2 },
];
const fromEngine = traceFromEngine({ vertices: V.map(([e, n]) => P(e, n)), edges: engineEdges });
check("the engine's lines as a start: every edge, its kind kept, marked as the engine's", fromEngine.lines.length === 9 && fromEngine.lines.filter((l) => l.type === "HIP").length === 4 && fromEngine.source === "engine");

// ── The roof report with and without a trace ───────────────────────────────────────────────────────────────────────
const slope = (rise: number) => Math.sqrt(1 + (rise / 12) ** 2);
const SQ = 10.7639;
const facet = (letter: string, outer: number[], planM2: number, facing: string, az: number) => ({ letter, part: "Main roof", outer, holes: [], pitch12: 6, pitchLabel: "6/12", azimuthDeg: az, facing, planSqft: planM2 * SQ, areaSqft: planM2 * slope(6) * SQ, google: true });
const facets = [facet("A", [0, 1, 5, 4], 60, "S", 180), facet("B", [2, 3, 4, 5], 60, "N", 0), facet("C", [3, 0, 4], 25, "W", 270), facet("D", [1, 2, 5], 25, "E", 90)];
const kinds = ["EAVE", "RAKE", "RIDGE", "HIP", "VALLEY", "STEP", "WALL", "BREAK"] as const;
const feet = Object.fromEntries(kinds.map((t) => [t, engineEdges.filter((e) => e.type === t).reduce((a, e) => a + e.lengthFt, 0)])) as FacetModel["totals"]["feet"];
const count = Object.fromEntries(kinds.map((t) => [t, engineEdges.filter((e) => e.type === t).length])) as FacetModel["totals"]["count"];
const area = facets.reduce((a, f) => a + f.areaSqft, 0);
const model: FacetModel = {
  vertices: V.map(([e, n]) => ({ ...P(e, n), lat: 47.6, lng: -122.3 })), epsg: 32610, facets, edges: engineEdges,
  totals: { areaSqft: area, squares: area / 100, facets: 4, predominantPitch: "6/12", feet, count },
  outlineFrom: "eagleview", leftOut: null,
  compare: { reference: "EagleView", eagleViewSqft: 2050, eagleViewFacets: 4, eagleViewPitch: "6/12", googleSegments: 4, areaDeltaPct: 0 },
  confidence: { level: "high", score: 0.9, reasons: [] }, shiftFt: { east: 0, north: 0 }, quality: { agree: 0.9, rmsFt: 0.4 }, notes: [],
};
const instant = { requestId: "t", address: "1 Test Way", lat: 47.6, lng: -122.3, structures: [{ areaSqft: 2050, squares: 20.5, pitch: "6/12", eaveHeightFt: { N: 10 }, footprintSqft: 1800, outline: null, facetCount: 4, shape: null, material: null, conditionRating: null, roofAgeYears: null, chimney: false, solarPanels: null, rooftopAcCount: null, occlusion: null, treeOverhang: null, confidence: null, materialRings: null }], imagery: [], totals: { areaSqft: 2050, squares: 20.5, predominantPitch: 6, pitchLabel: "6/12", maxEaveFt: 10, facetCount: 4, footprintSqft: 1800 } } as unknown as InstantRoofData;
const input = (trace: { points: typeof house.points; lines: typeof house.lines } | null) => ({
  copy: "contractor" as const,
  measurement: { id: "cm0test0000trace1", address: "1 Test Way", city: "Spokane", state: "WA", zip: "99208", measuredAt: new Date("2026-11-16T18:00:00Z"), areaSqft: 2050, predominantPitch: "6/12" },
  instant, model, window: { e0: E0 - 5, n0: N0 + 15, widthM: 28, heightM: 22 }, imagery: { date: "2024-06-14", quality: "HIGH" },
  company: { name: "Test Roofing", phone: null, website: null, address: null, logoSrc: null }, now: new Date("2026-11-16T12:00:00Z"), trace,
});
const plain = roofReportData(input(null));
check("no trace: the report reads as before — engine lines, outline on the photo, not marked traced", !plain.traced && plain.photo.lines === null && plain.plan.edges.length === engineEdges.length && plain.lines.find((l) => l.type === "HIP")?.feet === 100);
const withTrace = roofReportData(input({ points: house.points, lines: house.lines }));
check("with a trace: marked traced, its lines on the photo inside the picture's frame", withTrace.traced && withTrace.photo.lines?.length === house.lines.length && withTrace.photo.lines!.every((l) => l.a.x >= 0 && l.a.x <= 28 && l.a.y >= 0 && l.a.y <= 22));
check("…the lines drawing is the trace's (eleven lines), the faces stay the engine's (four)", withTrace.plan.edges.length === house.lines.length && withTrace.plan.facets.length === 4);
check("…the lines table is the trace's: four eave runs, one ridge, four hips, feet at 6/12",
  withTrace.lines.find((l) => l.type === "EAVE")?.count === 4 && withTrace.lines.find((l) => l.type === "HIP")?.feet === Math.round(tt.feet.HIP) && withTrace.lines.find((l) => l.type === "RIDGE")?.feet === Math.round(7 * FT));
check("…and How it was measured says the lines were traced by hand", withTrace.howMeasured.some((h) => /traced by hand/i.test(h)) && !plain.howMeasured.some((h) => /traced by hand/i.test(h)));
check("…the headline and the faces do not change", withTrace.headline.areaSqft === plain.headline.areaSqft && withTrace.facetsTable.length === plain.facetsTable.length);
const steppy = roofReportData(input({ points: [...house.points, P(17, 4)], lines: [...house.lines, { a: 4, b: 8, type: "STEP" as const }] }));
check("…step flashing pieces counted off the traced step lines", (steppy.order.find((o) => o.item === "Step flashing")?.qty ?? 0) === Math.ceil((6 * FT * slopeFactor("STEP", 6) * 12) / 5 - 1e-9) + 2);

// ── The PDF with the traced lines ──────────────────────────────────────────────────────────────────────────────────
const tinyPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
(async () => {
  const pdf = await renderToBuffer(createElement(RoofReportPdfDocument, { data: withTrace, pictureSrc: tinyPng }) as Parameters<typeof renderToBuffer>[0]);
  check("the report renders as a PDF with the traced lines on the photo", pdf.length > 3000 && pdf.subarray(0, 4).toString() === "%PDF", pdf.length);
  if (process.env.ROOF_TRACE_OUT) writeFileSync(path.join(process.env.ROOF_TRACE_OUT, "roof-report-traced.pdf"), pdf);
  console.log(bad ? `\n${bad} FAILED` : "\nall ok");
  process.exit(bad ? 1 : 0);
})();
