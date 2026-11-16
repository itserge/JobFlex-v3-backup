// The roof drawing's own line colours — a roof report's legend (owner, 2026-11-12, with a sample report: "may be show
// like this"): eaves blue, rakes green, ridges red, hips gold, valleys purple, step flashing a black dashed line, wall
// flashing a grey dotted one. The same on the photograph, on the two diagrams and in the hand-tracing tool; they do
// not follow the page's theme (they sit on a photograph). lib/pdf/RoofReportPdf keeps the same values.

import type { FacetEdgeType } from "@/lib/roofFacets/model";

export const EDGE_COLOR: Record<FacetEdgeType, string> = {
  EAVE: "#2f55a4",
  RAKE: "#3f7d44",
  RIDGE: "#b23a3a",
  HIP: "#b8872b",
  VALLEY: "#5b3a8c",
  STEP: "#111111",
  WALL: "#555555",
  BREAK: "#0f7f86",
};
export const EDGE_DASH: Partial<Record<FacetEdgeType, string>> = { STEP: "7 5", WALL: "1.5 5" };
