// A MEASUREMENT'S FACTS FOR THE PACKAGE (2026-11-06): what the roof page reads off an EagleView measurement before it
// builds the package (roof-estimator-data-form's roofFacts), for the AI Operator's roof by voice — the main structure
// as the row recorded it (lib/roofDiagram/instantTotals), its squares as measured, the pitch families the elevation
// data measured (else EagleView's published pitch), the outline's perimeter and the footprint read, the classifiers
// (chimney, rooftop units, shape, facets, what is on the roof now), and the storeys from the eave heights. No ticked
// outbuildings (a voice estimate is the house's roof), no delivered full report (Instant's packs carry none).
import type { RoofMeasurementDTO } from "@/lib/roofDiagram/types";
import { footprintRead, mainStructureOf, pitchFamilyShares, type PitchFamily } from "@/lib/roofDiagram/instantTotals";
import { ringPerimeterFt, type RoofFacts } from "@/lib/roofPackage/takeoff";

const r1 = (n: number) => Math.round(n * 10) / 10;

export function roofFactsFromMeasurement(m: RoofMeasurementDTO, opts: { state: string | null; storeys: 1 | 2 | 3; existingSaid: string | null }): RoofFacts | null {
  const inst = m.instant;
  if (!inst || !inst.structures.length) return null;
  const prov = (m.provenance ?? {}) as unknown as Record<string, unknown>;
  const pick = mainStructureOf({ structures: inst.structures, provenance: prov, origin: { lat: m.lat, lng: m.lng } });
  const s = pick.index != null ? inst.structures[pick.index] : null;
  if (!s) return null;
  const squares = s.squares ?? (s.areaSqft != null ? s.areaSqft / 100 : null) ?? m.squares;
  if (!squares || squares <= 0) return null;
  // The pitch: the families the elevation data measured, else EagleView's published rise/12 for the structure.
  const rep = prov.pitchMeasurement as { source?: string; families?: PitchFamily[] } | undefined;
  const measured = rep?.source === "measured" && rep.families?.length ? pitchFamilyShares(rep.families) : null;
  const published = s.pitch ? Number(String(s.pitch).split("/")[0]) : NaN;
  const pitchFamilies = (measured ?? (Number.isFinite(published) ? [{ pitch12: published, share: 1 }] : [])).filter((f) => Number.isFinite(f.pitch12));
  const eaves = s.eaveHeightFt ? Object.values(s.eaveHeightFt).filter((n): n is number => typeof n === "number" && Number.isFinite(n) && n > 0) : [];
  const storeys = eaves.length ? (Math.max(1, Math.min(3, Math.round(Math.max(...eaves) / 10))) as 1 | 2 | 3) : opts.storeys;
  return {
    squares: r1(squares),
    squaresBasis: "measured",
    pitchFamilies,
    pitchBasis: pitchFamilies.length ? "measured" : null,
    perimeterFt: ringPerimeterFt(s.outline),
    footprintSqft: footprintRead(s).sqft,
    chimney: s.chimney ?? null,
    rooftopAcCount: s.rooftopAcCount ?? null,
    shape: s.shape ?? null,
    facetCount: s.facetCount ?? null,
    measured: null,
    // What the person said is on the roof wins over the classifier's read.
    existingMaterial: opts.existingSaid ?? s.material ?? null,
    state: opts.state,
    facetConfidence: s.confidence?.facetCount ?? null,
    outlines: s.outline && s.outline.length >= 4 ? [s.outline] : null,
    buildingUse: "residential",
    storeys,
  };
}

/** The measurement in words for the Operator: "measured from the air (EagleView): 7/12 pitch, 12 facets". */
export function measurementWords(m: RoofMeasurementDTO, reused: boolean): string {
  const inst = m.instant;
  const prov = (m.provenance ?? {}) as unknown as Record<string, unknown>;
  const pick = inst ? mainStructureOf({ structures: inst.structures, provenance: prov, origin: { lat: m.lat, lng: m.lng } }) : { index: null };
  const s = inst && pick.index != null ? inst.structures[pick.index] : null;
  const bits = [m.predominantPitch ? `${m.predominantPitch} pitch` : s?.pitch ? `${s.pitch} pitch` : "", s?.facetCount ? `${s.facetCount} facets` : "", s?.material ? `${s.material.toLowerCase()} on it now` : ""].filter(Boolean);
  return `measured from the air (EagleView${reused ? ", the measurement on file" : ""})${bits.length ? `: ${bits.join(", ")}` : ""}`;
}
