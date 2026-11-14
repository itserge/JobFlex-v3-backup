// GET /api/admin/roof-report/pdf?id=<measurementId>&copy=contractor|homeowner
//
// The roof report as a PDF (2026-11-13, owner: "lets do … but show it only for admin for testing"): one saved roof
// measurement, its facet drawing and its aerial photo, laid out as the sample report (lib/roofReport,
// lib/pdf/RoofReportPdf). Platform admins only while it is tested: 401 without a session, 403 for anyone else. Nothing
// is ordered — the report reads what the measurement and its height map already left behind.

import { createElement } from "react";
import { renderToStream } from "@react-pdf/renderer";
import { requirePlatformAdmin } from "@/lib/orgContext";
import { loadRoofReport } from "@/lib/roofReport/server";
import { RoofReportPdfDocument } from "@/lib/pdf/RoofReportPdf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

const NO_STORE = { "Cache-Control": "private, no-store" };

export async function GET(req: Request) {
  try {
    await requirePlatformAdmin();
  } catch (err) {
    const forbidden = err instanceof Error && err.message === "Platform admin only";
    return Response.json({ error: forbidden ? "Platform admins only." : "Sign in to the admin console." }, { status: forbidden ? 403 : 401, headers: NO_STORE });
  }
  const url = new URL(req.url);
  const id = url.searchParams.get("id") ?? "";
  const copy = url.searchParams.get("copy") === "homeowner" ? "homeowner" : "contractor";
  if (!id || id.length > 64) return Response.json({ error: "Which roof?" }, { status: 400, headers: NO_STORE });
  try {
    const r = await loadRoofReport(id, copy);
    if (!r.ok) return Response.json({ error: r.reason }, { status: 404, headers: NO_STORE });
    const stream = await renderToStream(createElement(RoofReportPdfDocument, { data: r.report.data, pictureSrc: r.report.pictureSrc }) as unknown as Parameters<typeof renderToStream>[0]);
    const name = `roof-report-${(r.report.data.address.line1 || "roof").replace(/[^a-z0-9]+/gi, "-").toLowerCase().replace(/^-|-$/g, "")}-${copy}.pdf`;
    return new Response(stream as unknown as ReadableStream, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${name}"`, ...NO_STORE } });
  } catch (err) {
    console.error("[roof-report] pdf failed:", err);
    return Response.json({ error: "The report could not be made. The error is in the server log." }, { status: 500, headers: NO_STORE });
  }
}
