// THE ROOF REPORT (2026-11-13, owner: "lets do … but show it only for admin for testing"): a measured roof turned into
// the report — the headline from EagleView, the faces and lines from the facet drawing, the waste and the order list
// by their written rules — and laid out as a PDF of five pages for the contractor, four for the homeowner. Pure, on a
// made-up roof: a hip-roofed house (four faces) and a gable garage beside it whose house side is step-flashed.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/roof-report.check.ts
// ROOF_REPORT_OUT=<folder> also writes the two PDFs there to look at.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import type { FacetModel } from "../../../src/lib/roofFacets/model";
import type { InstantRoofData } from "../../../src/lib/eagleview";
import { orderList, roofReportData, squaresToThird, squaresWords, storiesFromEave, suggestedWaste, wasteTable } from "../../../src/lib/roofReport/report";
import { RoofReportPdfDocument } from "../../../src/lib/pdf/RoofReportPdf";
import { encodePng } from "../../../src/lib/roofFacets/png";

let bad = 0;
const check = (name: string, ok: boolean, extra: unknown = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || extra === "" ? "" : ` — ${typeof extra === "string" ? extra : JSON.stringify(extra)}`}`);
};

// ── A made-up roof, in UTM metres ──────────────────────────────────────────────────────────────────────────────────
const E0 = 500000, N0 = 5280000, FT = 3.28084, SQ = 10.7639;
const V: Array<[number, number]> = [
  [0, 0], [17, 0], [17, 10], [0, 10], [5, 5], [12, 5], // house: corners, ridge ends
  [19, 1], [26, 1], [26, 8], [19, 8], [19, 4.5], [26, 4.5], // garage: corners, ridge ends
];
const slope = (rise: number) => Math.sqrt(1 + (rise / 12) ** 2);
const facet = (letter: string, part: string, outer: number[], rise: number, planM2: number, facing: string, az: number) => ({ letter, part, outer, holes: [], pitch12: rise, pitchLabel: `${rise}/12`, azimuthDeg: az, facing, planSqft: planM2 * SQ, areaSqft: planM2 * slope(rise) * SQ, google: true });
const facets = [
  facet("A", "Main roof", [0, 1, 5, 4], 6, 60, "S", 180),
  facet("B", "Main roof", [2, 3, 4, 5], 6, 60, "N", 0),
  facet("C", "Main roof", [3, 0, 4], 6, 25, "W", 270),
  facet("D", "Main roof", [1, 2, 5], 6, 25, "E", 90),
  facet("E", "Section 2", [6, 7, 11, 10], 4, 24.5, "S", 180),
  facet("F", "Section 2", [8, 9, 10, 11], 4, 24.5, "N", 0),
];
const len = (a: number, b: number, rise = 0) => Math.hypot(V[a][0] - V[b][0], V[a][1] - V[b][1], rise) * FT;
const hip = Math.hypot(5, 5, 2.5) * FT;
const edges: FacetModel["edges"] = [
  { a: 0, b: 1, type: "EAVE", lengthFt: len(0, 1), left: 0, right: -1 },
  { a: 1, b: 2, type: "EAVE", lengthFt: len(1, 2), left: 3, right: -1 },
  { a: 2, b: 3, type: "EAVE", lengthFt: len(2, 3), left: 1, right: -1 },
  { a: 3, b: 0, type: "EAVE", lengthFt: len(3, 0), left: 2, right: -1 },
  { a: 4, b: 5, type: "RIDGE", lengthFt: len(4, 5), left: 0, right: 1 },
  { a: 0, b: 4, type: "HIP", lengthFt: hip, left: 0, right: 2 },
  { a: 1, b: 5, type: "HIP", lengthFt: hip, left: 0, right: 3 },
  { a: 2, b: 5, type: "HIP", lengthFt: hip, left: 1, right: 3 },
  { a: 3, b: 4, type: "HIP", lengthFt: hip, left: 1, right: 2 },
  { a: 6, b: 7, type: "EAVE", lengthFt: len(6, 7), left: 4, right: -1 },
  { a: 8, b: 9, type: "EAVE", lengthFt: len(8, 9), left: 5, right: -1 },
  { a: 7, b: 11, type: "RAKE", lengthFt: 3.5 * slope(4) * FT, left: 4, right: -1 },
  { a: 11, b: 8, type: "RAKE", lengthFt: 3.5 * slope(4) * FT, left: 5, right: -1 },
  { a: 9, b: 10, type: "STEP", lengthFt: 3.5 * slope(4) * FT, left: 5, right: -1 },
  { a: 10, b: 6, type: "STEP", lengthFt: 3.5 * slope(4) * FT, left: 4, right: -1 },
  { a: 10, b: 11, type: "RIDGE", lengthFt: len(10, 11), left: 4, right: 5 },
];
const kinds = ["EAVE", "RAKE", "RIDGE", "HIP", "VALLEY", "STEP", "WALL", "BREAK"] as const;
const feet = Object.fromEntries(kinds.map((k) => [k, edges.filter((e) => e.type === k).reduce((a, e) => a + e.lengthFt, 0)])) as FacetModel["totals"]["feet"];
const count = Object.fromEntries(kinds.map((k) => [k, edges.filter((e) => e.type === k).length])) as FacetModel["totals"]["count"];
const area = facets.reduce((a, f) => a + f.areaSqft, 0);
const model: FacetModel = {
  vertices: V.map(([e, n]) => ({ e: E0 + e, n: N0 + n, lat: 47.6, lng: -122.3 })),
  epsg: 32610,
  facets,
  edges,
  totals: { areaSqft: area, squares: area / 100, facets: facets.length, predominantPitch: "6/12", feet, count },
  outlineFrom: "eagleview",
  leftOut: null,
  compare: { reference: "EagleView", eagleViewSqft: 2650, eagleViewFacets: 6, eagleViewPitch: "6/12", googleSegments: 6, areaDeltaPct: Math.round(((area - 2650) / 2650) * 1000) / 10 },
  confidence: { level: "high", score: 0.86, reasons: ["Google's planes agree with the drawing", "EagleView's area within 3%"] },
  shiftFt: { east: 0.4, north: -0.2 },
  quality: { agree: 0.9, rmsFt: 0.5 },
  notes: [],
};
const structure = { areaSqft: 2650, squares: 26.5, pitch: "6/12", eaveHeightFt: { N: 18.5, E: 18.2, S: 18.6, W: 18.4 }, footprintSqft: 2100, outline: null, facetCount: 6, shape: "roof_shape_hip", material: "roof_material_asphalt_shingle", conditionRating: "roof_condition_good", roofAgeYears: 12, chimney: true, solarPanels: false, rooftopAcCount: 0, occlusion: "roof_occlusion_none", treeOverhang: "tree_overhang_minor", confidence: null, materialRings: null };
const instant = { requestId: "test", address: "1742 Harlow Pine Ct", lat: 47.6, lng: -122.3, structures: [structure], imagery: [], totals: { areaSqft: 2650, squares: 26.5, predominantPitch: 6, pitchLabel: "6/12", maxEaveFt: 18.6, facetCount: 6, footprintSqft: 2100 } } as unknown as InstantRoofData;
const window = { e0: E0 - 5, n0: N0 + 13, widthM: 36, heightM: 23 };
const input = (copy: "contractor" | "homeowner") => ({
  copy,
  measurement: { id: "cm0test0000roof42", address: "1742 Harlow Pine Ct", city: "Spokane", state: "WA", zip: "99208", measuredAt: new Date("2026-11-12T18:00:00Z"), areaSqft: 2650, predominantPitch: "6/12" },
  instant,
  model,
  window,
  imagery: { date: "2024-06-14", quality: "HIGH" },
  company: { name: "Summit Ridge Roofing", phone: "(509) 555-0148", website: "summitridgeroofing.example", address: null, logoSrc: null },
  now: new Date("2026-11-13T12:00:00Z"),
});

// ── The arithmetic ─────────────────────────────────────────────────────────────────────────────────────────────────
check("squares round up to a third", squaresToThird(2700) === 27 && Math.abs(squaresToThird(2650) - 26 - 2 / 3) < 1e-9 && Math.abs(squaresToThird(2610) - 26 - 1 / 3) < 1e-9 && squaresWords(26 + 1 / 3) === "26 1/3");
check("suggested waste: 8% plain, + 2/3 point a hip or valley line, 20% at most", suggestedWaste(model) === 11 && suggestedWaste({ totals: { ...model.totals, count: { ...count, HIP: 30 } } }) === 20);
const table = wasteTable(2650, 11);
check("the waste table runs 0–22% with the suggestion marked", table.map((w) => w.pct).join() === "0,5,10,11,15,17,20,22" && table.filter((w) => w.suggested).length === 1);
const ord = orderList(2650, 30, feet, 12);
const q = (item: string) => ord.find((o) => o.item.startsWith(item))?.qty;
check("shingles: three bundles a square", q("Architectural shingles") === 90);
check("starter: eaves + rakes ÷ 120 ft", q("Starter") === Math.ceil((feet.EAVE + feet.RAKE) / 120));
check("ridge cap: ridges + hips ÷ 25 ft", q("Hip and ridge") === Math.ceil((feet.RIDGE + feet.HIP) / 25));
check("ice and water: eaves + valleys ÷ 65 ft", q("Ice and water") === Math.ceil(feet.EAVE / 65));
check("no valley metal on a roof with no valleys; step flashing where it has step lines", !ord.some((o) => o.item.startsWith("Valley")) && q("Step flashing") === 12);
check("stories from the eave: 18 ft is two", storiesFromEave(18.6) === 2 && storiesFromEave(10) === 1 && storiesFromEave(null) === null);

// ── The report's content ───────────────────────────────────────────────────────────────────────────────────────────
const dc = roofReportData(input("contractor"));
const dh = roofReportData(input("homeowner"));
check("the headline is EagleView's area and pitch", dc.headline.areaSqft === 2650 && dc.headline.pitch === "6/12" && dc.headline.areaFrom === "eagleview");
check("…with the drawing's own total beside it", Math.abs(dc.compare.drawingSqft - Math.round(area)) <= 1);
check("to order: the squares at the suggested waste", dc.orderSquares === squaresToThird(2650 * 1.11) && dc.suggestedWastePct === 11);
check("report number and date", dc.number === "RR-26-ROOF42" && dc.dateWords === "November 13, 2026", `${dc.number} ${dc.dateWords}`);
check("six faces in the table, lettered A–F with their facing", dc.facetsTable.map((f) => f.letter).join("") === "ABCDEF" && dc.facetsTable[0].facing === "South");
check("lines listed with their feet: eaves, rakes, ridges, hips, step flashing", dc.lines.map((l) => l.type).join() === "EAVE,RAKE,RIDGE,HIP,STEP");
check("facts in words: shingle, good, 12 years, chimney", dc.facts.some((f) => f.label === "Roofing" && /Asphalt shingle/i.test(f.value)) && dc.facts.some((f) => f.label === "Roof age" && /12/.test(f.value)) && dc.facts.some((f) => f.label === "Chimney" && f.value === "Yes"), dc.facts);
check("eave heights by side", dc.eaves.length === 4 && dc.eaves.some((e) => e.side === "North" && e.feet === 18.5));
check("check on site names the chimney and the walls", dc.checkOnSite.some((c) => /chimney/i.test(c)) && dc.checkOnSite.some((c) => /wall/i.test(c)));
check("the plan drawing keeps every face and edge, north up", dc.plan.facets.length === 6 && dc.plan.edges.length === edges.length && dc.plan.facets[0].label.y > dc.plan.facets[1].label.y);
check("the photo outline sits inside the picture's frame", dc.photo.outline.flat().every((p) => p.x >= 0 && p.x <= window.widthM && p.y >= 0 && p.y <= window.heightM));

// ── The PDF ────────────────────────────────────────────────────────────────────────────────────────────────────────
async function pdf(data: typeof dc, pictureSrc: string | null) {
  return renderToBuffer(createElement(RoofReportPdfDocument, { data, pictureSrc }) as unknown as Parameters<typeof renderToBuffer>[0]);
}
const pages = (b: Buffer) => (b.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
(async () => {
  // a stand-in aerial picture: the frame's size at 10 px a metre, grey with a darker roof-ish block
  const W = window.widthM * 10, H = window.heightM * 10;
  const rgb = new Uint8Array(W * H * 3).fill(150);
  for (let y = 40; y < 140; y++) for (let x = 50; x < 220; x++) rgb.set([96, 92, 88], (y * W + x) * 3);
  const pic = `data:image/png;base64,${encodePng(rgb, W, H).toString("base64")}`;
  const bc = await pdf(dc, pic);
  const bh = await pdf(dh, pic);
  const bn = await pdf(dc, null);
  check("the contractor's copy is a PDF of five pages", bc.subarray(0, 4).toString() === "%PDF" && pages(bc) === 5, pages(bc));
  check("the homeowner's copy has four (no order list)", pages(bh) === 4, pages(bh));
  check("with no picture the cover draws the faces instead, still five pages", pages(bn) === 5);
  const out = process.env.ROOF_REPORT_OUT;
  if (out) {
    writeFileSync(path.join(out, "roof-report-contractor.pdf"), bc);
    writeFileSync(path.join(out, "roof-report-homeowner.pdf"), bh);
    console.log(`wrote ${out}`);
  }
  console.log(bad ? `\n${bad} FAILED` : "\nall passed");
  process.exit(bad ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
