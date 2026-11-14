import "server-only";

// THE ROOF REPORT — FROM A SAVED MEASUREMENT (2026-11-13). Everything the report reads, loaded once: the measurement
// row (EagleView's figures and facts), the company that measured it (its name, phone, logo), the facet drawing the
// admin roof lab makes of it (lib/roofFacets/server — nothing is ordered for that) and the aerial photo cut to the
// same patch of ground (one Google fetch at most, else the height map's relief). Then ./report says what the report
// says and lib/pdf/RoofReportPdf lays it out.
//
// Admins only while it is tested (owner, 2026-11-13: "show it only for admin for testing"): the callers gate on
// requirePlatformAdmin; nothing here checks who is asking.

import { db } from "@/lib/db";
import type { InstantRoofData } from "@/lib/eagleview";
import { pdfLogoSrc } from "@/lib/orgLogoServer";
import { roofLabDrawing, roofLabPicture } from "@/lib/roofFacets/server";
import { roofReportData, type RoofReportCopy, type RoofReportData } from "./report";

export interface LoadedRoofReport {
  data: RoofReportData;
  /** the aerial photo (or, failing it, the height map shaded) as a PNG data URL; null when neither could be cut */
  pictureSrc: string | null;
  pictureKind: "photo" | "relief" | null;
}

export async function loadRoofReport(measurementId: string, copy: RoofReportCopy): Promise<{ ok: true; report: LoadedRoofReport } | { ok: false; reason: string }> {
  const row = await db.roofMeasurement.findUnique({
    where: { id: measurementId },
    select: { id: true, address: true, city: true, state: true, zip: true, createdAt: true, areaSqft: true, predominantPitch: true, instantJson: true, organization: { select: { name: true, phone: true, website: true, address: true, logoUrl: true } } },
  });
  if (!row) return { ok: false, reason: "That roof measurement is not on file." };
  const drawing = await roofLabDrawing(measurementId);
  if (!drawing.ok) return { ok: false, reason: drawing.reason };
  let instant: InstantRoofData | null = null;
  try {
    instant = row.instantJson ? (JSON.parse(row.instantJson) as InstantRoofData) : null;
  } catch {
    instant = null;
  }
  let pictureSrc: string | null = null;
  let pictureKind: LoadedRoofReport["pictureKind"] = null;
  for (const kind of drawing.photo ? (["photo", "relief"] as const) : (["relief"] as const)) {
    try {
      const pic = await roofLabPicture(measurementId, kind);
      if (pic.ok) {
        pictureSrc = `data:image/png;base64,${pic.png.toString("base64")}`;
        pictureKind = kind;
        break;
      }
    } catch (err) {
      console.warn("[roof-report] picture failed:", kind, err instanceof Error ? err.message : err);
    }
  }
  const org = row.organization;
  const data = roofReportData({
    copy,
    measurement: { id: row.id, address: row.address, city: row.city, state: row.state, zip: row.zip, measuredAt: row.createdAt, areaSqft: row.areaSqft, predominantPitch: row.predominantPitch },
    instant,
    model: drawing.model,
    window: drawing.window,
    imagery: { date: drawing.imagery.date, quality: drawing.imagery.quality },
    company: { name: org?.name ?? "JobFlex", phone: org?.phone ?? null, website: org?.website ?? null, address: org?.address ?? null, logoSrc: await pdfLogoSrc(org?.logoUrl ?? null) },
    now: new Date(),
  });
  return { ok: true, report: { data, pictureSrc, pictureKind } };
}
