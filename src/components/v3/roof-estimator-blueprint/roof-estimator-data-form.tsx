"use client";

// Roof estimator — the ea9ad01 design, restored one-to-one (owner confirmed
// that commit's look as THE reference), with exactly two differences while the
// drawing engine is reworked (ROOF_DRAWING_ENABLED=false):
//
//   · the 2D | 3D tabs are the same vsw switch, relabelled SATELLITE | ORTHO —
//     SATELLITE (default) is a clean Google Maps satellite photo, ORTHO is the
//     EagleView clear ortho from the measurement (tab hidden when the
//     measurement carries no imagery); no outlines, no lines on either;
//   · everything derived from the drawn MODEL is honestly absent, not zeroed:
//     the layer toggles, PNG/PDF export, LINEAR FOOTAGE and the pitch-mix
//     panel are gone with the drawing. EagleView totals retain their details;
//     Aerial estimates retain estimated labels and can be priced directly.
//
// Actions: measureRoof / measureRoofInstant / listRoofMeasurements / getRoofMeasurement
// (src/actions/roofMeasurement.ts, data-only) + getMeasurementPhoto (Google
// Static Maps, disk-cached) + getMeasurementOrtho (EagleView clear).
import { WorkSquare } from "@/components/v3/estimators-blueprint/work-square";
import * as React from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { nanoid } from "nanoid";
import type { InstantRoofData, InstantStructure } from "@/lib/eagleview";
import { toast } from "@/components/ui/Toast";
import type { EstimateLine } from "@/components/estimator/EstimatorBreakdown";
import type { MeasurementSource, RoofMeasurementDTO, RoofMeasurementSummary } from "@/lib/roofDiagram/types";
import {
  collectPendingInstant,
  getMeasurementOrtho,
  getMeasurementPhoto,
  getRoofMeasurement,
  listRoofMeasurements,
  locateRoofAddress,
  measureRoof,
  measureRoofInstant,
  saveIncludedStructures,
  setMainStructure,
} from "@/actions/roofMeasurement";
import { estimateRoof, convertRoofEstimateToProposal, loadRoofFromProposal, openRoofLeadEstimate, updateRoofProposal } from "@/actions/roofEstimator";
import { DECK_LOCK_WORDS, PROPOSAL_STATUS_WORDS, type LinkedDeckProposal } from "@/lib/deck/proposalEdit";
// The card's own key for "this roof" (it counts the existing material and storeys too).
import { factsKey } from "./roof-package-builder";
import type { WebRoofSeed } from "@/lib/webHandoff";
import {
  reportPlanLimit,
  reportPlanLimitResult,
  ensureWithinLimit,
} from "@/stores/usePlanLimitStore";
import { attachPlacesSuggest, type PickedPlace } from "@/components/v3/blueprint-shell/places-suggest";
import { AddressPinPreview } from "./address-pin-preview";
import { PIN_PATH, blueprintPinIcon, type PointCtor } from "./pin";
import { BuildEstimateCardSwitch } from "./build-estimate-card-switch";
import { EstimateLinesTable, type EditableLine } from "./estimate-lines-table";
import { estimateEdges, likeForLikeFamily, ringPerimeterFt, type MeasuredFootage, type RoofFacts, type RoofPackage, type RoofPackageSpec } from "@/lib/roofPackage/takeoff";
import { evOrderRoof, evPriceRoof, evReportFootages, evReportStatus, evRoofModel } from "@/actions/eagleview";
import { isMapsBrowserEnabled, loadMapsLibrary } from "@/lib/googleMaps";
import { displayedPitchLabel, footprintRead, foreignIndices, includedIndicesOf, instantTotalsOf, mainStructureOf, otherStructuresOf, pitchFamilyShares, pointOnRing, userPinOf } from "@/lib/roofDiagram/instantTotals";
import { AERIAL } from "@/lib/vendorLabels";
import { familyOfMaterial, WASTE_OPTIONS } from "@/lib/roofPackage/catalog";
import { isFlatRoof } from "@/lib/roofPackage/flatRule";
import { joinClauses, readBuilding } from "@/lib/roofPackage/commercial";
import { InventoryLinkChoice } from "@/components/v3/inventory-link/inventory-link-choice";
import { RoofDiagramPreview } from "@/components/v3/admin-roof-lab/roof-diagram-preview";

/** How the contractor said each measured building is used, by measurement id.
 *  Browser-local on purpose: it is a pricing choice for this contractor, it
 *  needs no table, and a new browser simply asks again. */
const USE_KEY = "jf.roof.buildingUse.v1";
type BuildingUse = "residential" | "commercial";
function readUseAnswer(measurementId: string | null | undefined): BuildingUse | null {
  if (!measurementId || typeof window === "undefined") return null;
  try {
    const all = JSON.parse(window.localStorage.getItem(USE_KEY) ?? "{}") as Record<string, unknown>;
    const v = all[measurementId];
    return v === "residential" || v === "commercial" ? v : null;
  } catch {
    return null;
  }
}
function writeUseAnswer(measurementId: string, use: BuildingUse | null) {
  try {
    const all = JSON.parse(window.localStorage.getItem(USE_KEY) ?? "{}") as Record<string, unknown>;
    if (use) all[measurementId] = use;
    else delete all[measurementId];
    window.localStorage.setItem(USE_KEY, JSON.stringify(all));
  } catch {
    /* blocked storage — the answer lasts for this page only */
  }
}

const STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA",
  "ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
];
const FACADE: Record<string, string> = { N: "North", E: "East", S: "South", W: "West" };
// The measuring screen's progress (owner's call 2026-09-18: a percentage and
// a step list that say what the estimator is doing — never how, or through
// whom). The measure is one awaited call, so the percentage is timed against
// how long a measurement usually takes: it climbs quickly through the first
// steps, slows through the wait and creeps under 96 until the answer lands;
// only the answer itself makes it 100. Each waypoint names the step under
// way from that moment; the step list ticks the ones before it.
const MS_STEPS = ["Locate the property", "Confirm the roof outline", "Measure the roof area", "Read the pitch, edges and details", "Finish the report"] as const;
/** "5/12 on 60% · 11/12 on 40%" — how much of the roof is at each measured pitch, largest first. */
function pitchSharesWords(families: ReadonlyArray<{ pitch12: number; planSqft: number }>): string {
  const byPitch = new Map<number, number>();
  for (const s of pitchFamilyShares(families)) {
    const p = Math.round(s.pitch12);
    byPitch.set(p, (byPitch.get(p) ?? 0) + s.share);
  }
  const rows = [...byPitch.entries()].sort((a, b) => b[1] - a[1]);
  if (rows.length <= 1) return "measured · the whole roof";
  return rows.map(([p, share]) => `${p}/12 on ${Math.round(share * 100)}%`).join(" · ");
}
const MS_WAYPOINTS: ReadonlyArray<{ atMs: number; pct: number; step: number }> = [
  { atMs: 0, pct: 0, step: 0 },
  { atMs: 1_500, pct: 8, step: 1 },
  { atMs: 6_000, pct: 24, step: 2 },
  { atMs: 20_000, pct: 55, step: 3 },
  { atMs: 45_000, pct: 80, step: 4 },
  { atMs: 90_000, pct: 90, step: 4 },
  { atMs: 180_000, pct: 94, step: 4 },
  { atMs: 300_000, pct: 96, step: 4 },
];
const MS_TICK_MS = 250;
type MsProgress = { pct: number; step: number; done: boolean };
/**
 * When the measurement comes back with details still on the way (the area
 * is in, the pitch and facets are being read), the report is HELD: the
 * measuring screen stays on the "Read the pitch, edges and details" step
 * while the details are collected, and the report opens once, complete
 * (owner, 2026-09-18: a half-filled report with a "still collecting" banner
 * that fills in fifteen seconds later reads as broken). A provider slower
 * than this cap opens the report anyway, with the collecting note.
 */
const HOLD_MAX_MS = 120_000;
/** While held, the percent creeps a point at a time from where the answer landed toward 96. */
const HOLD_STEP = 3;
const HOLD_CREEP_MS = 2_500;
/** The wall clock, read only from timers and click handlers. */
const nowMs = () => Date.now();

/**
 * THE WAY BACK FROM "MANAGE ROOF TYPES" (owner, 2026-10-16: "there is no way to come back to the estimate builder").
 * Following that link keeps, for this tab, the measurement on screen and what was built on it; the roof-types page
 * offers "Back to the estimate", and the estimator reopens it all — with the roof types just edited, because the
 * builder reads them fresh.
 */
const RETURN_KEY = "jf-roof-return";
/** How long a kept estimate waits to be reopened. */
const RETURN_TTL_MS = 2 * 60 * 60 * 1000;
type RoofReturn = {
  id: string;
  at: number;
  extra: number[];
  pitchEntered: string | null;
  spec: RoofPackageSpec | null;
  factsKey: string | null;
  materials: Array<{ name: string; quantity: number; unitPrice: number; unit: string }>;
  labor: Array<{ name: string; quantity: number; unitPrice: number; unit: string }>;
  title: string;
  scope: string;
  assumptions: string[];
  tablesEdited: boolean;
};
function readReturn(): RoofReturn | null {
  try {
    const v = JSON.parse(window.sessionStorage.getItem(RETURN_KEY) ?? "null") as RoofReturn | null;
    return v && typeof v.id === "string" && typeof v.at === "number" ? v : null;
  } catch {
    return null;
  }
}
/** Where the timed progress stands `elapsedMs` into a measurement. */
function msProgressAt(elapsedMs: number): MsProgress {
  const w = MS_WAYPOINTS;
  const last = w[w.length - 1];
  if (elapsedMs >= last.atMs) return { pct: last.pct, step: last.step, done: false };
  let i = 0;
  while (i + 1 < w.length && w[i + 1].atMs <= elapsedMs) i += 1;
  const a = w[i];
  const b = w[i + 1];
  const t = (elapsedMs - a.atMs) / (b.atMs - a.atMs);
  return { pct: Math.round(a.pct + (b.pct - a.pct) * t), step: a.step, done: false };
}
const RECENT_LIMIT = 12;

// `instant-outline` is a FAILED measurement wearing the totals of a successful
// one: EagleView's numbers are there, the roof is not. "Outline" in a warning
// tone read as a variety of result rather than a shortfall, so the row invited
// no second look — and on 2026-08-28 a retry was all it needed.
const SOURCE_CHIP: Record<MeasurementSource, { label: string; tone: "ok" | "wait" | "bad" }> = {
  "instant+recon": { label: "Instant", tone: "ok" },
  "instant-outline": { label: "No facets", tone: "bad" },
  recon: { label: "Estimate", tone: "wait" },
  solar: { label: "Roof estimate", tone: "wait" },
};

/** Sum of the known values; null when none is known. */
const sumOrNull = (xs: Array<number | null | undefined>): number | null => {
  const known = xs.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  return known.length ? known.reduce((a, b) => a + b, 0) : null;
};
/** True when any is true, false when all known are false, null when none is known. */
const anyOrNull = (xs: Array<boolean | null | undefined>): boolean | null => {
  const known = xs.filter((x): x is boolean => typeof x === "boolean");
  return known.length ? known.some(Boolean) : null;
};
/** Storeys from the reported eave heights (10 ft steps): the high side counts —
 *  the crew works from it. Null when no height was reported. */
const storeysFromEaves = (eaves: Array<{ ft: number }>): number | null => {
  if (!eaves.length) return null;
  const maxFt = Math.max(...eaves.map((e) => e.ft));
  return Math.max(1, Math.min(3, Math.round(maxFt / 10)));
};
/** Pack ids → what they carry, for the contractor. */
const PACK_WORDS: Record<string, string> = {
  property_data_id_001: "roof area",
  property_data_id_002: "pitch and eave height",
  property_data_id_003: "material, condition and facets",
  property_data_id_004: "roof age",
  property_data_id_005: "property details",
  property_data_id_007: "the building outline",
  property_data_id_008: "imagery",
};
const packNames = (ids: readonly string[]): string => {
  const words = [...new Set(ids.map((id) => PACK_WORDS[id] ?? id))];
  return words.length > 1 ? words.slice(0, -1).join(", ") + " and " + words[words.length - 1] : words[0] ?? "";
};

const num = (n: number, d = 0) =>
  Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const dateShort = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const yesNo = (v: boolean | null | undefined) => (v == null ? "—" : v ? "Yes" : "No");

type Panel = "intake" | "measuring" | "report";
type PhotoView = "satellite" | "ortho";

// A takeoff the contractor typed in — squares and pitch, nothing measured.
// This is the path that exists because EagleView Property Data is refusing
// the account (403 "missing or incomplete entitlement", 2026-09-05): until the
// entitlement lands, Instant measure fails for every address and nothing on
// this page could ever reach a proposal. Hand-entered figures are the
// contractor's own, so they price and convert like measured ones; they are
// NOT the aerial "recon" estimate, which stays unpriceable on purpose.
type ManualTakeoff = { squares: number; pitchLabel: string; address: string | null };
const PITCHES = ["2/12", "3/12", "4/12", "5/12", "6/12", "7/12", "8/12", "9/12", "10/12", "12/12"];

/** The report reads one `totals` shape; a hand takeoff fills the same fields. */
function manualTotals(m: ManualTakeoff): InstantRoofData["totals"] {
  const rise = Number(m.pitchLabel.split("/")[0]);
  return {
    areaSqft: m.squares * 100,
    squares: m.squares,
    predominantPitch: Number.isFinite(rise) ? rise : null,
    pitchLabel: m.pitchLabel,
    maxEaveFt: null,
    facetCount: null,
    footprintSqft: null,
  };
}

// Live Google map on the SATELLITE tab (owner's call: pan + zoom). Minimal
// structural types for the JS SDK — the repo carries no @types/google.maps,
// same approach as lead-map.tsx. Initial zoom matches the static photo's z20.
const LIVE_MAP_ZOOM = 20;
interface LiveGoogleMap {
  setCenter(c: { lat: number; lng: number }): void;
  setZoom(z: number): void;
}
interface LiveMapMarker {
  setPosition(c: { lat: number; lng: number }): void;
}
type GMapsLib = { Map: new (el: HTMLElement, opts: Record<string, unknown>) => LiveGoogleMap };
type MarkerCtor = new (opts: Record<string, unknown>) => LiveMapMarker;
/** What the building markers need of the SDK: a marker that can be taken off the map, bounds to frame a building. */
interface MapOverlay {
  setMap(map: unknown): void;
  setAnimation?(a: unknown): void;
  addListener?(ev: string, fn: () => void): { remove(): void };
}
interface MapBounds {
  extend(p: { lat: number; lng: number }): MapBounds;
  contains(p: { lat: number; lng: number }): boolean;
}
type OverlayCtor = new (opts: Record<string, unknown>) => MapOverlay;
type OutlineSdk = {
  Marker?: OverlayCtor;
  LatLngBounds?: new () => MapBounds;
  Point?: PointCtor;
  Animation?: { BOUNCE: unknown };
};
/** Other buildings shown before the rest fold away (owner, 2026-10-16). */
const BUILDINGS_SHOWN = 3;
/** "Measure this one" on a building row (a2b54fb6): hidden: duplicates Make main, owner decision 2026-10-26. */
const SHOW_MEASURE_THIS = false;

/** What a failed measurement says on the intake, and which way out it offers. */
type IntakeErrorKind = "no-roof" | "processing" | "failed" | "not-found" | "expired";
/** The intake map's pin: where the address resolved, or where the person moved it; `key` = the address it is for. */
type IntakePin = { lat: number; lng: number; label: string; key: string; moved: boolean };
/** One address, however it was typed — the key a pin belongs to. */
const pinKey = (address: string, city: string, state: string, zip: string) =>
  [address, city, state, zip].map((v) => v.trim().replace(/\s+/g, " ").toUpperCase()).join("|");
/**
 * One colour per other building, the same on its row's dot and its pin on
 * the map — bright enough to read on a satellite roof (sky, amber, violet, mint).
 */
const BUILDING_COLORS = ["#4a9eff", "#f0b03c", "#b394ff", "#5fd3a2"] as const;
const buildingColor = (k: number) => BUILDING_COLORS[((k % BUILDING_COLORS.length) + BUILDING_COLORS.length) % BUILDING_COLORS.length];
/** The main building's colour on the map and its row: the blueprint of the house pin. */
const MAIN_COLOR = "#1854a0";
/** Why this building is the main one, under the Structures title. */
const MAIN_HOW_WORDS: Record<string, string> = {
  "user-pin": "The building under your pin",
  "near-user-pin": "The building nearest your pin",
  chosen: "The building you chose to measure",
  "at-pin": "Picked as the building at the address pin",
  "nearest-pin": "Picked as nearest the pin",
  "area+parcel": "Picked as largest on the parcel",
};

/**
 * Where the report's map stands and where its pin goes (2026-10-26): centred on the main building's outline, the
 * pin on the point the person placed before ordering — else the point the measurement read.
 */
function reportHome(m: RoofMeasurementDTO | null): { center: { lat: number; lng: number }; pin: { lat: number; lng: number } | null; pinIsUsers: boolean } | null {
  const inst = m?.instant;
  if (!m || !inst || inst.lat == null || inst.lng == null) return null;
  const read = { lat: inst.lat, lng: inst.lng };
  const userPin = userPinOf(m.provenance as Record<string, unknown>);
  const main = mainStructureOf({ structures: inst.structures, provenance: m.provenance as Record<string, unknown>, origin: { lat: m.lat, lng: m.lng } }).index;
  const ring = main != null ? inst.structures[main]?.outline : null;
  const center = ring && ring.length >= 3 ? ringCenter(ring) : userPin ?? read;
  return { center, pin: userPin ?? read, pinIsUsers: !!userPin };
}

/** Where a building's pin stands: the middle of its outline. */
function ringCenter(ring: ReadonlyArray<{ lat: number; lng: number }>): { lat: number; lng: number } {
  const n = ring.length;
  return { lat: ring.reduce((a, p) => a + p.lat, 0) / n, lng: ring.reduce((a, p) => a + p.lng, 0) / n };
}
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const stripId = ({ id: _id, ...rest }: EstimateLine) => rest;


/** "2025-07-11" → "Jul 2025" for the photo caption; unparsable input passes through. */
function shotDateLabel(v: string | undefined): string | null {
  if (!v) return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

/** One other building in the Structures list: its tick, its number when it is in the estimate, "Make main", "Show
 *  on map" and its figures. Stateless — the page hands in every value and handler. */
function StructureRow(p: {
  o: { i: number; s: InstantStructure; offLot: boolean; feet: number | null };
  n: number | null;
  total: number;
  ticked: boolean;
  focus: boolean;
  canMakeMain: boolean;
  makeMainBusy: boolean;
  makeMainDisabled: boolean;
  showOnMapButton: boolean;
  noLocationNote: boolean;
  measureThis: boolean;
  busy: boolean;
  onTick: (i: number, on: boolean) => void;
  onMakeMain: (i: number) => void;
  onShowOnMap: (i: number) => void;
  onMeasureThis: (ring: ReadonlyArray<{ lat: number; lng: number }>) => void;
}) {
  const { o, n } = p;
  const { s, i } = o;
  const name = n != null ? `Building ${n} of ${p.total}` : "Building";
  return (
    <div
      className={"rf-details-row" + (o.offLot ? " is-offlot" : "") + (p.focus ? " is-focus" : "")}
      data-structure={i}
      data-building={n ?? undefined}
    >
      <dt>
        <label className={"rf-attach" + (p.ticked ? "" : " is-off")}>
          <input
            type="checkbox"
            checked={p.ticked}
            aria-label={`Include this building (${s.areaSqft != null ? num(s.areaSqft) + " sq ft" : "no area"}) in the estimate`}
            onChange={(e) => p.onTick(i, e.target.checked)}
          />
          <span className={"rf-swatch" + (n == null ? " is-empty" : "")} style={n != null ? { background: buildingColor(n - 2) } : undefined} aria-hidden="true" />
          {name}
        </label>
        {p.canMakeMain && (
          <button type="button" className="rf-make-main" disabled={p.makeMainDisabled} aria-busy={p.makeMainBusy || undefined} onClick={() => p.onMakeMain(i)} data-rf-make-main={i}>
            {p.makeMainBusy ? "Switching…" : "Make main"}
          </button>
        )}
        {p.showOnMapButton ? (
          <button type="button" className={"rf-locate" + (p.focus ? " is-on" : "")} onClick={() => p.onShowOnMap(i)} aria-label={`Show ${name} on the map`}>
            Show on map
          </button>
        ) : null}
        {p.measureThis ? (
          // The wrong building measured (a contractor's ticket, 2026-10-26: "the apartment building needs to be
          // measured, not the garage"): this one becomes the roof the report and the estimate are about. The
          // address's stored order answers it, so it is not billed again.
          <button
            type="button"
            className="rf-locate rf-measure-this"
            disabled={p.busy}
            onClick={() => p.onMeasureThis(s.outline!)}
            aria-label={`Measure ${name} instead`}
            data-rf-measure-this={i}
          >
            Measure this one
          </button>
        ) : null}
        {o.offLot && <span className="rf-attach-note">outside the lot</span>}
        {p.noLocationNote && <span className="rf-attach-note">no location in the report — not drawn on the map</span>}
      </dt>
      <dd>
        {s.areaSqft != null ? num(s.areaSqft) : "—"}
        <span>sq ft</span>
        {s.pitch && <span>· {s.pitch}</span>}
        {s.footprintSqft != null && <span>· footprint {num(s.footprintSqft)}</span>}
        {o.feet != null && <span>· {num(Math.max(10, Math.round(o.feet / 10) * 10))} ft away</span>}
      </dd>
    </div>
  );
}

export function RoofEstimatorDataForm({ aiEnabled = true, evEnabled = true, measurementEnabled = false, initialAddress, leadEstimateId, webRoof, proposalId, homeState = null, roofDiagramPreview = false }: { aiEnabled?: boolean; evEnabled?: boolean; measurementEnabled?: boolean; initialAddress?: string; leadEstimateId?: string; webRoof?: WebRoofSeed; proposalId?: string; homeState?: string | null; /** A platform admin is looking (page.tsx): the roof diagram card is shown under a saved measurement. */ roofDiagramPreview?: boolean } = {}) {
  const router = useRouter();

  // ── Screen ──
  const [panel, setPanel] = React.useState<Panel>("intake");
  const [ms, setMs] = React.useState<MsProgress>({ pct: 0, step: 0, done: false });
  // The measurement whose report is held on the measuring screen while its
  // details are collected (see HOLD_MAX_MS), and when the hold began.
  const holdRef = React.useRef<{ id: string; startedAt: number } | null>(null);
  const [holding, setHolding] = React.useState(false);
  const holdTimerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  // The latest measurement the page holds, for the toast at the reveal.
  const latestRef = React.useRef<RoofMeasurementDTO | null>(null);
  // The reveal, reachable from the collect loop below without re-running it.
  const revealRef = React.useRef<() => void>(() => {});
  const [msReport, setMsReport] = React.useState<string>("—");

  // ── Measurement / photo viewer ──
  const [measurement, setMeasurement] = React.useState<RoofMeasurementDTO | null>(null);
  // Set when the action measured (and, for Instant, billed) but could not save.
  const [unsaved, setUnsaved] = React.useState(false);
  const [instantBusy, setInstantBusy] = React.useState(false);
  const [measurementBusy, setMeasurementBusy] = React.useState(false);
  const isSolar = measurement?.source === "solar";
  const solar = isSolar ? measurement.provenance.solar : null;
  // Only display the accepted model's real plane count. Missing/invalid saved
  // values stay unknown; this estimate must not become a measured takeoff fact.
  const solarFacetCount = solar && Number.isSafeInteger(solar.segmentCount) && solar.segmentCount > 0
    ? solar.segmentCount
    : null;
  // A measured report can come back with structure_roof_facet_count simply
  // absent (657 Queen Ave NE, 2026-10-16: every other figure landed, facets
  // "—" forever). Google's segment count — kept by the witnesses, or healed
  // in by one building-insights call — stands in as an ESTIMATE, marked so.
  const segmentFacetEstimate = !isSolar
    && measurement?.provenance?.googleSegmentCount != null && measurement.provenance.googleSegmentCount > 0
    ? measurement.provenance.googleSegmentCount
    : null;
  // Pricing allocates sloped roofing squares, so weight families by surface
  // area rather than footprint; otherwise steep facets are underpriced.
  const solarSurfaceTotal = solar?.pitchFamilies.reduce((sum, family) => sum + family.surfaceSqft, 0) ?? 0;
  const solarPitchShares = solarSurfaceTotal > 0
    ? solar!.pitchFamilies.map(family => ({ pitch12: family.pitch12, share: family.surfaceSqft / solarSurfaceTotal }))
    : [];
  // Set when the shown measurement reused an already-paid EagleView answer —
  // the explicit paid re-measure button renders only then.
  const [reusedInstant, setReusedInstant] = React.useState<"stored" | "recovered" | null>(null);
  const [view, setView] = React.useState<PhotoView>("satellite");
  /** The measurement whose first tab was chosen — see showMeasurement. */
  const openedRef = React.useRef<string | null>(null);
  const [satPhoto, setSatPhoto] = React.useState<string | null>(null);
  const [satErr, setSatErr] = React.useState<string | null>(null);
  const [orthoPhoto, setOrthoPhoto] = React.useState<string | null>(null);
  // The roof visualizer (2026-10-25) starts on the estimate's own roof type once a package is applied.
  const [orthoErr, setOrthoErr] = React.useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = React.useState(false);
  // Live satellite map. `mapDown` flips once when the JS SDK refuses to load —
  // the cached static photo then takes over for the rest of the session.
  const mapHostRef = React.useRef<HTMLDivElement | null>(null);
  const liveMapRef = React.useRef<{ host: HTMLDivElement; map: LiveGoogleMap; marker: LiveMapMarker | null } | null>(null);
  const [mapDown, setMapDown] = React.useState(false);
  // Which measurement the live map is centred on — the building markers below
  // draw only once the map exists for it.
  const [mapReadyFor, setMapReadyFor] = React.useState<string | null>(null);
  // "Show on map": the building asked for — its pin shown and framed with the house, ticked or not (a phone has no hover).
  const [focusBuilding, setFocusBuilding] = React.useState<number | null>(null);
  const [allBuildings, setAllBuildings] = React.useState(false);

  /**
   * Built by the OLD calibrated pipeline. Only that path stores a calibration
   * report, so this is the reliable discriminator — and a saved row always
   * shows its own stored numbers, never rebuilt ones.
   */
  const builtByOldPipeline = !!measurement?.calibration;

  // ── Packs still coming from the aerial provider ──
  // The first click returns with the area alone (2026-09-18: the detail packs
  // are ordered the moment the area lands and never waited for), so a fresh
  // save shows zero facets and no pitch. Ask the server to collect the pending
  // orders every few seconds for about two minutes and swap the fuller
  // measurement in as it lands.
  const instantPacks = measurement && measurement.source !== "recon" && !isSolar && measurement.instant ? measurement.provenance?.instantPacks ?? null : null;
  // Placed and paid, not delivered when the row was saved: the server
  // collects these for free, and nothing is priced until they land.
  const packsPendingList = React.useMemo(() => instantPacks?.pending ?? [], [instantPacks]);
  // What the ledger may still hold for this address: the pending packs, and
  // — on rows saved before `pending` existed (2026-09-17) — packs counted as
  // failed or missing while a slow order was in fact still processing.
  const facetHealWanted = !!measurement && measurement.source !== "recon" && !isSolar && !!measurement.instant
    && measurement.instant.totals?.facetCount == null && measurement.provenance?.googleSegmentCount == null;
  const packsToCollect = packsPendingList.length > 0 || (!!instantPacks && (instantPacks.failed.length > 0 || instantPacks.missing.length > 0)) || facetHealWanted;
  // Keyed by measurement id, so a swap to another row never inherits a verdict.
  const [collecting, setCollecting] = React.useState<{ id: string; state: "checking" | "gave-up" | "done" } | null>(null);
  const collectFor = measurement && packsToCollect && measurement.id !== "unsaved" ? measurement.id : null;
  // "checking" from the first paint: the loop starts with the panel, and the
  // page must not read as final while it runs (review 2026-09-17: the chip
  // used to appear only after the first check resolved, 20 s in).
  const collectingShown: "checking" | "gave-up" | "done" | null = collectFor ? (collecting?.id === collectFor ? collecting.state : "checking") : null;
  // Pricing waits for the packs on the way (the pitch, the details). Once the
  // loop gives up, the contractor prices on what is there — an entered pitch.
  const packsPending = packsPendingList.length > 0 && collectingShown === "checking";
  // Packs the address lacks for good (refused, failed, never attempted) —
  // the explicit paid order buys just these, nothing already bought.
  const packsMissing = !!instantPacks && !packsPending && collectingShown !== "checking" && (instantPacks.failed.length > 0 || instantPacks.missing.length > 0);
  React.useEffect(() => {
    if (!collectFor) return;
    let cancelled = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      if (cancelled) return;
      attempts += 1;
      let more = true;
      try {
        const res = await collectPendingInstant(collectFor);
        if (cancelled) return;
        if (res.ok && res.updated) {
          setMeasurement(res.measurement);
          latestRef.current = res.measurement;
          // While the report is held nothing is on screen to announce; the
          // reveal says it all at once.
          if (holdRef.current?.id !== collectFor) {
            toast.success(
              res.pending > 0 ? "More roof details arrived" : "All roof details are in",
              res.pending > 0 ? "Part of the measurement landed; the rest is still being read." : "Pitch, facets and details filled in from the part of the measurement that was still being read.",
            );
          }
          more = res.pending > 0;
        } else if (res.ok && res.pending === 0) {
          // Nothing pending in the ledger — the packs are simply not there (refused, or failed for good).
          more = false;
        } else if (!res.ok) {
          // "Not found" / not authorised: asking again changes nothing.
          more = false;
        }
      } catch {
        /* a failed check is retried on the next tick */
      }
      if (cancelled) return;
      if (!more) {
        setCollecting({ id: collectFor, state: "done" });
        // Everything is in (or nothing more is coming): the held report opens now, complete.
        if (holdRef.current?.id === collectFor) revealRef.current();
        return;
      }
      if (attempts >= 20) {
        setCollecting({ id: collectFor, state: "gave-up" });
        if (holdRef.current?.id === collectFor) revealRef.current();
        return;
      }
      setCollecting({ id: collectFor, state: "checking" });
      // A provider slower than the cap: open the report with what is in and
      // keep collecting behind it (the report's own note says so).
      if (holdRef.current?.id === collectFor && nowMs() - holdRef.current.startedAt > HOLD_MAX_MS) revealRef.current();
      timer = setTimeout(() => void tick(), 6_000);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [collectFor]);

  // ── Recent measurements ──
  const [recent, setRecent] = React.useState<RoofMeasurementSummary[]>([]);
  const [recentBusy, setRecentBusy] = React.useState(true);
  const [recentError, setRecentError] = React.useState<string | null>(null);
  const [openingId, setOpeningId] = React.useState<string | null>(null);

  const loadRecent = React.useCallback(
    () =>
      listRoofMeasurements(RECENT_LIMIT).then(
        (rows) => {
          setRecent(rows);
          setRecentError(null);
          setRecentBusy(false);
        },
        (err: unknown) => {
          setRecentError(errMsg(err));
          setRecentBusy(false);
        },
      ),
    [],
  );
  React.useEffect(() => {
    void loadRecent();
  }, [loadRecent]);

  // ── Address ──
  const addrRef = React.useRef<HTMLInputElement>(null);
  const [picked, setPicked] = React.useState<PickedPlace | null>(null);
  const [city, setCity] = React.useState("");
  const [stateCode, setStateCode] = React.useState("");
  const [zip, setZip] = React.useState("");
  const [addressLoading, setAddressLoading] = React.useState(false);
  // What the intake shows when a measurement fails: one plain sentence, and
  // the one action that fits (a free re-check for an order still processing,
  // a billed new lookup when the paid answer holds no roof).
  const [intakeError, setIntakeError] = React.useState<{ text: string; kind: IntakeErrorKind; target: OrderInput; reorder?: boolean } | null>(null);
  // The previous pick, for the retype rule below (the effect's closure cannot read state).
  const lastPickRef = React.useRef<PickedPlace | null>(null);
  // THE PIN ON THE INTAKE MAP (2026-10-26, ticket 8KETUL: an apartment complex was measured at its garage, the
  // building EagleView's own point stood on). Where the picked suggestion — or, for an address typed out in full,
  // the server's geocoder — puts the address; dragged by the person onto the building to measure. `key` is the
  // address it belongs to: change the address and the pin goes with it. The order carries it as `userPin`.
  const [pin, setPin] = React.useState<IntakePin | null>(null);
  const [locating, setLocating] = React.useState(false);

  // Google Places on the donor's plain <input>, the same module the Fence
  // studio uses. Uncontrolled on purpose: the module writes the field itself.
  // A lead's address arrives already typed (lib/estimateSeed); the contractor
  // presses Find. Uncontrolled field, so it is written once, on the intake.
  React.useEffect(() => {
    if (panel !== "intake" || !initialAddress) return;
    const input = addrRef.current;
    if (input && !input.value) input.value = initialAddress;
  }, [panel, initialAddress]);

  React.useEffect(() => {
    if (panel !== "intake") return;
    const input = addrRef.current;
    if (!input) return;
    return attachPlacesSuggest(input, {
      autoComplete: "new-password",
      onResolving: setAddressLoading,
      onPick(p) {
        const prev = lastPickRef.current;
        lastPickRef.current = p;
        setPicked(p);
        if (!p.typed && p.lat != null && p.lng != null) {
          setPin({ lat: p.lat, lng: p.lng, label: p.formatted, key: pinKey(p.address, p.city, p.state, p.zip), moved: false });
        }
        if (p.typed) {
          // City, state and ZIP filled in by a picked suggestion belong to
          // THAT address and go when it is typed over; ones typed by hand
          // stay (review 2026-09-17: fixing a typo used to wipe all three).
          if (prev && !prev.typed) {
            setCity("");
            setStateCode("");
            setZip("");
          }
          return;
        }
        input.value = p.address;
        setCity(p.city);
        setStateCode(p.state);
        setZip(p.zip);
      },
      // The field still works typed out in full; say so, with Google's reason,
      // rather than leave a list that never opens.
      onError(message) {
        toast.error("Address suggestions are unavailable", `${message}. Fill in the address, city, state and ZIP by hand.`);
      },
    });
  }, [panel]);

  // An address typed out in full (no suggestion picked) gets its pin from the server's geocoder once it reads as
  // an address — a street number and name, and a city with a state or a ZIP — so the person sees, and can move,
  // where it lands before anything is ordered. Asked once per address, after typing settles.
  const typedAddress = picked?.typed ? picked.address.trim() : "";
  const typedKey = typedAddress ? pinKey(typedAddress, city, stateCode, zip) : "";
  const locatedRef = React.useRef(new Map<string, { lat: number; lng: number; label: string } | null>());
  React.useEffect(() => {
    if (panel !== "intake" || !typedKey || !isMapsBrowserEnabled()) return;
    const looksLikeAddress = /\d/.test(typedAddress) && /[a-z]{2}/i.test(typedAddress) && (/^\d{5}/.test(zip.trim()) || (city.trim().length > 1 && !!stateCode));
    if (!looksLikeAddress) return;
    if (pin?.key === typedKey) return;
    const known = locatedRef.current.get(typedKey);
    if (known !== undefined) {
      setPin(known ? { ...known, key: typedKey, moved: false } : null);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(() => {
      setLocating(true);
      void locateRoofAddress({ address: typedAddress, city, state: stateCode, zip })
        .then((r) => {
          const hit = r.ok ? { lat: r.lat, lng: r.lng, label: r.formatted } : null;
          locatedRef.current.set(typedKey, hit);
          if (!cancelled) setPin(hit ? { ...hit, key: typedKey, moved: false } : null);
        })
        .catch(() => {
          /* no pin — the address still measures as typed */
        })
        .finally(() => {
          if (!cancelled) setLocating(false);
        });
    }, 900);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
      setLocating(false);
    };
    // `pin` is read for its key only; a moved pin must not ask again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel, typedKey, typedAddress, city, stateCode, zip]);

  // ── Estimate ──
  const [waste, setWaste] = React.useState(12);
  const [genBusy, setGenBusy] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [materials, setMaterials] = React.useState<EditableLine[]>([]);
  const [labor, setLabor] = React.useState<EditableLine[]>([]);
  // How the estimate gets built: the roof package builder (default since
  // 2026-09-12) or the one-shot AI draft. Both fill the same tables.
  const [buildMode, setBuildMode] = React.useState<"package" | "ai">("package");
  // The FULL aerial report for this address — the one with ridge / hip /
  // valley / eave / rake feet. Looked up whenever a measurement opens; its
  // lengths feed the package builder and the AI draft as MEASURED figures.
  type ReportState = { state: "loading" | "none" | "pending" | "measured"; reportId?: number | null; status?: string | null; footage?: MeasuredFootage | null };
  const [report, setReport] = React.useState<ReportState>({ state: "none" });
  const [reportBusy, setReportBusy] = React.useState(false);
  React.useEffect(() => {
    const m = measurement;
    if (!m?.address || m.source === "recon" || m.source === "solar") return;
    let cancelled = false;
    void evReportFootages({ address: m.address, city: m.city, state: m.state, zip: m.zip, lat: m.lat, lng: m.lng })
      .then((r) => {
        if (cancelled) return;
        if (!r.ok) {
          // The offer to order a report still stands; the check simply could not run.
          setReport({ state: "none" });
          return;
        }
        if (r.state === "measured") {
          const f = r.footage;
          setReport({ state: "measured", reportId: r.reportId, footage: { reportId: r.reportId, eaveFt: f.EAVE, rakeFt: f.RAKE, ridgeFt: f.RIDGE, hipFt: f.HIP, valleyFt: f.VALLEY, stepFlashFt: f.STEPFLASH } });
        } else if (r.state === "pending") {
          setReport({ state: "pending", reportId: r.reportId, status: r.status });
        } else {
          setReport({ state: "none" });
        }
      })
      .catch(() => {
        if (!cancelled) setReport({ state: "none" });
      });
    return () => {
      cancelled = true;
    };
  }, [measurement]);
  const [assumptions, setAssumptions] = React.useState<string[]>([]);
  // What the CLIENT reads as the proposal's scope of work: the work, in plain
  // sentences. The assumptions are the contractor's notes (where a number came
  // from, what to confirm) and never reach the client (owner, 2026-09-14).
  const [scopeText, setScopeText] = React.useState("");
  const [convertBusy, setConvertBusy] = React.useState(false);
  // Connected to the warehouse or an estimate only — null until the choice decides its default (2026-09-20).
  const [invLink, setInvLink] = React.useState<boolean | null>(null);
  // The tables hold the SAMPLE the server returns when no AI key is set: it
  // looks like an estimate and is not one, so it never becomes a proposal.
  const [sampleEstimate, setSampleEstimate] = React.useState(false);
  // The contractor changed lines in the tables since the package filled
  // them: those edits win over a rebuild, and a rebuild asks first.
  const [tablesEdited, setTablesEdited] = React.useState(false);
  // Hand-entered takeoff (runManual). Cleared by resetResult, so it never
  // coexists with a measurement.
  const [manual, setManual] = React.useState<ManualTakeoff | null>(null);
  // Other structures on the parcel the contractor has ticked INTO the figures
  // (indices into instant.structures). Empty by default: the page is about the
  // main structure; a barn joins the total only when someone says so.
  const [extra, setExtra] = React.useState<ReadonlySet<number>>(() => new Set());
  // The pitch the contractor typed when EagleView had none (pack 002 not
  // bought). Nothing is priced on a pitch nobody stated.
  const [pitchEntered, setPitchEntered] = React.useState<string | null>(null);
  // ── A saved roof proposal opened again (owner, 2026-10-13: "get back to the
  // roofing edit to rebuild it") — ?proposal=<id> from the builder's "Edit the
  // roof estimate". The page comes back with its measurement, choices and
  // lines; Convert becomes "Update PRO-XXXX" and re-prices THAT proposal.
  const [linked, setLinked] = React.useState<LinkedDeckProposal | null>(null);
  const [linkInfo, setLinkInfo] = React.useState<{ others: number; older: boolean; missing: boolean; loading: boolean } | null>(proposalId ? { others: 0, older: false, missing: false, loading: true } : null);
  const [seedSpec, setSeedSpec] = React.useState<{ spec: RoofPackageSpec; key: string } | null>(null);
  // A sent proposal asks once before its client's copy changes.
  const [askUpdate, setAskUpdate] = React.useState<{ go: () => void } | null>(null);
  // The package choices the lines came from — kept with the proposal.
  const lastSpecRef = React.useRef<RoofPackageSpec | null>(null);

  // Legacy recon rows remain unpriceable. Google estimates have a separate
  // source and require the contractor's review before pricing.
  const isRecon = measurement?.source === "recon";
  const savedId = measurement && !unsaved && measurement.id !== "unsaved" ? measurement.id : null;
  const hasEstimate = materials.length > 0 || labor.length > 0;
  const materialsTotal = materials.reduce((a, l) => a + l.quantity * l.unitPrice, 0);
  const laborTotal = labor.reduce((a, l) => a + l.quantity * l.unitPrice, 0);
  const busy = instantBusy || measurementBusy || openingId != null;

  function resetResult() {
    setMeasurement(null);
    setReport({ state: "none" });
    setManual(null);
    setExtra(new Set());
    setPitchEntered(null);
    setUnsaved(false);
    setMaterials([]);
    setLabor([]);
    setSampleEstimate(false);
    setTablesEdited(false);
    setAssumptions([]);
    setScopeText("");
    setView("satellite");
    openedRef.current = null;
    setSatPhoto(null);
    setSatErr(null);
    setOrthoPhoto(null);
    setOrthoErr(null);
  }

  // The action is one awaited call; until it resolves the screen shows the
  // timed progress (MS_WAYPOINTS), ticking a few times a second. The answer
  // — not the clock — is what completes it.
  function runProgress(): () => void {
    const startedAt = nowMs();
    setMs(msProgressAt(0));
    const timer = setInterval(() => setMs(msProgressAt(nowMs() - startedAt)), MS_TICK_MS);
    return () => clearInterval(timer);
  }

  type OrderInput = { address: string; city: string; state: string; zip: string; lat?: number; lng?: number; userPin?: { lat: number; lng: number } | null };
  // The pin on the intake map, when it belongs to the address as it stands now.
  const currentPinKey = picked ? pinKey(picked.address, city, stateCode, zip) : "";
  const intakePin = pin && pin.key === currentPinKey ? pin : null;
  function orderInput(): OrderInput {
    const address = addrRef.current ? addrRef.current.value.trim() : picked?.address ?? "";
    const matchingPick = picked?.address === address ? picked : null;
    // The pin the person saw — and may have moved — goes with the order and decides the building (user-pin).
    const shown = intakePin && intakePin.key === pinKey(address, city, stateCode, zip) && isMapsBrowserEnabled() ? intakePin : null;
    return {
      address,
      city,
      state: stateCode,
      zip,
      lat: shown?.lat ?? matchingPick?.lat,
      lng: shown?.lng ?? matchingPick?.lng,
      userPin: shown ? { lat: shown.lat, lng: shown.lng } : null,
    };
  }

  // ── Photos ──
  // The EagleView clear ortho exists only when the paid answer carried imagery;
  // without it the ORTHO tab is hidden (not disabled) per the owner's call.
  // An ortho EagleView will not serve (an old order's image answers 410, or
  // any failure) is the same as none (2026-10-19): the tab goes and the Map —
  // Google's satellite with the pin — is the picture.
  const orthoOf = (m: RoofMeasurementDTO | null | undefined) =>
    !!m && m.source !== "solar" && !!m.instant?.imagery?.some((im) => im.view === "ortho" && im.masked === false && !!im.token && !!im.bbox);
  const hasOrtho = orthoOf(measurement) && !orthoErr;
  const orthoShotDate = shotDateLabel(
    measurement?.instant?.imagery?.find((im) => im.view === "ortho" && im.masked === false)?.shotDate ??
      measurement?.provenance?.instantImageryDate,
  );

  const loadSatellite = React.useCallback((id: string) => {
    setSatPhoto(null);
    setSatErr(null);
    if (id === "unsaved") return;
    setPhotoBusy(true);
    void getMeasurementPhoto(id)
      .then((res) => {
        if (res.ok) setSatPhoto(res.dataUrl);
        else setSatErr(res.error);
      })
      .catch((err: unknown) => setSatErr(errMsg(err)))
      .finally(() => setPhotoBusy(false));
  }, []);

  // If the photo cannot be read, the map takes its place and the tab goes (hasOrtho).
  const loadOrtho = React.useCallback((id: string) => {
    setOrthoPhoto(null);
    setOrthoErr(null);
    if (id === "unsaved") return;
    setPhotoBusy(true);
    const failed = (msg: string) => {
      setOrthoErr(msg);
      setView("satellite");
    };
    void getMeasurementOrtho(id)
      .then((res) => {
        if (res.ok) setOrthoPhoto(res.dataUrl);
        else failed(res.error);
      })
      .catch((err: unknown) => failed(errMsg(err)))
      .finally(() => setPhotoBusy(false));
  }, []);

  // Ortho is fetched lazily, on the first switch to the tab; the choice and
  // both fetched photos then stick for the life of the open measurement.
  function switchView(v: PhotoView) {
    setView(v);
    if (v === "ortho" && savedId && !orthoPhoto && !orthoErr && !photoBusy) loadOrtho(savedId);
  }

  // Live SATELLITE map (owner's call: drag to pan, scroll to zoom). Needs the
  // browser key and the measurement's pin; either missing → the cached static
  // photo (getMeasurementPhoto) serves exactly as before.
  // The map stands on the MAIN building (2026-10-26: on a lot of many buildings EagleView's point can stand on
  // another one); the pin marks the point the person placed, else the one the measurement read.
  const home = React.useMemo(() => reportHome(measurement), [measurement]);
  const mapLat = home?.center.lat ?? null;
  const mapLng = home?.center.lng ?? null;
  const liveMap = isMapsBrowserEnabled() && !mapDown && mapLat != null && mapLng != null;

  // The map is built only while the SATELLITE tab is visible (the SDK lays
  // out broken tiles inside display:none), and recentred only when the OPEN
  // MEASUREMENT changes — a mere tab flip keeps the user's pan/zoom.
  const centeredOnRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!liveMap || panel !== "report" || view !== "satellite" || mapLat == null || mapLng == null) return;
    let cancelled = false;
    void loadMapsLibrary<GMapsLib>("maps")
      .then(async ({ Map: GMap }) => {
        // Classic Marker comes off the global namespace once the marker
        // library is up (AdvancedMarkerElement needs a Map ID) — the same way
        // lead-map.tsx and the intake's pin preview read it. A failed marker
        // library costs only the pin, never the map.
        await loadMapsLibrary("marker").catch(() => null);
        const gmaps = (window as unknown as { google?: { maps?: { Marker?: MarkerCtor; Point?: PointCtor } } }).google?.maps;
        const Marker = gmaps?.Marker ?? null;
        const host = mapHostRef.current;
        if (cancelled || !host) return;
        const center = { lat: mapLat, lng: mapLng };
        const pinAt = home?.pin ?? center;
        const key = `${mapLat},${mapLng}`;
        if (liveMapRef.current?.host === host) {
          if (centeredOnRef.current !== key) {
            liveMapRef.current.map.setCenter(center);
            liveMapRef.current.map.setZoom(LIVE_MAP_ZOOM);
          }
          liveMapRef.current.marker?.setPosition(pinAt);
        } else {
          const map = new GMap(host, {
            center,
            zoom: LIVE_MAP_ZOOM,
            mapTypeId: "satellite",
            tilt: 0,
            disableDefaultUI: true,
            zoomControl: true,
            gestureHandling: "greedy",
            clickableIcons: false,
          });
          // The map's whole reason to exist on this panel is "which house was
          // measured" — mark the point the measurement read.
          const marker = Marker
            ? new Marker({ map, position: pinAt, title: home?.pinIsUsers ? "Your pin" : "The point the measurement read", icon: blueprintPinIcon(gmaps?.Point), zIndex: 8 })
            : null;
          liveMapRef.current = { host, map, marker };
        }
        centeredOnRef.current = key;
        setMapReadyFor(key);
      })
      .catch(() => {
        if (cancelled) return;
        setMapDown(true);
        if (savedId) loadSatellite(savedId);
      });
    return () => {
      cancelled = true;
    };
    // `home` is read for its pin, which moves only with the measurement (mapLat/mapLng stand for it).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveMap, panel, view, mapLat, mapLng, savedId, loadSatellite]);

  // The "back to the house" button: the live map's escape hatch after a wander.
  function recenterMap() {
    const m = liveMapRef.current?.map;
    if (!m || mapLat == null || mapLng == null) return;
    m.setCenter({ lat: mapLat, lng: mapLng });
    m.setZoom(LIVE_MAP_ZOOM);
  }

  function showMeasurement(m: RoofMeasurementDTO, wasUnsaved: boolean, reveal = true) {
    setMeasurement(m);
    latestRef.current = m;
    setReport({ state: m.source === "solar" || m.source === "recon" ? "none" : "loading" });
    // The buildings ticked in when this measurement was last open (kept on the row since 2026-10-26).
    const savedMain = m.instant ? mainStructureOf({ structures: m.instant.structures, provenance: m.provenance as Record<string, unknown>, origin: { lat: m.lat, lng: m.lng } }).index : null;
    setExtra(new Set(includedIndicesOf(m.provenance as Record<string, unknown>, m.instant?.structures.length ?? 0, savedMain)));
    setPitchEntered(null);
    setUnsaved(wasUnsaved);
    if (reveal) setPanel("report");
    const willLiveMap = isMapsBrowserEnabled() && !mapDown && m.instant?.lat != null && m.instant?.lng != null;
    if (!wasUnsaved && m.id !== "unsaved" && !willLiveMap) loadSatellite(m.id);
    // THE REPORT'S OWN PHOTO FIRST (owner, 2026-10-12: "Satellite view" over a map made contractors think the sizes
    // came off Google Maps). A measurement from the aerial report opens on that report's photo; the map of the address
    // is the second tab. Once per measurement — a later update of the same one leaves the tab the user chose.
    if (openedRef.current !== m.id) {
      openedRef.current = m.id;
      const first = !wasUnsaved && m.id !== "unsaved" && orthoOf(m);
      setView(first ? "ortho" : "satellite");
      if (first) loadOrtho(m.id);
    }
  }

  /** A step's label: while the report is held, the details step names what
   *  is still being read — the pitch and eave height, the facets and details,
   *  the outline — and shortens as each part lands (owner, 2026-09-18). */
  function stepLabel(i: number, label: string = MS_STEPS[Math.min(i, MS_STEPS.length - 1)]): string {
    if (holding && i === HOLD_STEP && packsPendingList.length) return "Reading " + packNames(packsPendingList);
    return label;
  }
  /** "Roof measured" with the row's own figures — the main structure's, not the parcel's. */
  function measuredToast(m: RoofMeasurementDTO, wasUnsaved: boolean, reused: "stored" | "recovered" | null) {
    toast.success(
      wasUnsaved ? "Roof measured — not saved" : "Roof measured",
      `${m.facetCount ?? "—"} facets · ${m.squares != null ? m.squares.toFixed(1) : "—"} squares` +
        (reused === "recovered" ? " · collected the earlier paid order — nothing new was billed" : reused === "stored" ? " · reused the already-paid measurement — nothing new was billed" : ""),
    );
  }
  /** While the report is held, the percent creeps toward 96 on the details step. */
  function startHoldProgress() {
    stopHoldProgress();
    setMs((prev) => ({ pct: Math.max(Math.round(prev.pct), 80), step: HOLD_STEP, done: false }));
    holdTimerRef.current = setInterval(() => {
      setMs((prev) => (prev.done ? prev : { pct: Math.min(96, Math.round(prev.pct) + 1), step: HOLD_STEP, done: false }));
    }, HOLD_CREEP_MS);
  }
  function stopHoldProgress() {
    if (holdTimerRef.current) clearInterval(holdTimerRef.current);
    holdTimerRef.current = null;
  }
  /** Open the held report: 100 %, the report panel, one toast with the final figures. */
  function revealHeld() {
    if (!holdRef.current) return;
    holdRef.current = null;
    setHolding(false);
    stopHoldProgress();
    setMs({ pct: 100, step: MS_STEPS.length, done: true });
    setPanel("report");
    const m = latestRef.current;
    if (m) measuredToast(m, false, reusedInstant);
  }
  React.useEffect(() => {
    revealRef.current = revealHeld;
  });
  React.useEffect(() => () => stopHoldProgress(), []);

  /** A failed measurement, said on the intake with the one way out that fits. An address EagleView could not place
   *  goes back to the address field (2026-10-26): nothing more is ordered for those words. */
  function failIntake(
    res: { error: string; noRoof?: boolean; stillProcessing?: boolean; canReorder?: boolean; addressNotFound?: boolean; expired?: boolean },
    input: OrderInput,
  ) {
    const kind: IntakeErrorKind = res.addressNotFound ? "not-found" : res.expired ? "expired" : res.noRoof ? "no-roof" : res.stillProcessing ? "processing" : "failed";
    setIntakeError({ text: res.error, kind, target: input, reorder: res.canReorder === true });
    if (kind === "not-found") {
      window.requestAnimationFrame(() => {
        const field = addrRef.current;
        if (!field) return;
        field.scrollIntoView({ behavior: "smooth", block: "center" });
        field.focus({ preventScroll: true });
        field.select();
      });
    }
  }

  async function runMeasurement() {
    if (busy || addressLoading || !measurementEnabled) return;
    const input = orderInput();
    if (!input.address) {
      addrRef.current?.focus();
      toast.info("Enter the address first", "Type the street address or pick it from the suggestions, then measure.");
      return;
    }
    if (zip && !/^\d{5}(?:-\d{4})?$/.test(zip.trim())) {
      toast.error("Check the ZIP code", "Enter all 5 digits, or a ZIP+4 code.");
      return;
    }
    resetResult();
    holdRef.current = null;
    setHolding(false);
    stopHoldProgress();
    setIntakeError(null);
    setReusedInstant(null);
    setMeasurementBusy(true);
    setMs({ pct: 0, step: 0, done: false });
    setMsReport(input.address);
    setPanel("measuring");
    try {
      const res = await measureRoof(input);
      if (!res.ok) {
        setPanel("intake");
        failIntake(res, input);
        if (!reportPlanLimitResult(res)) toast.error("Couldn't measure this roof", res.error);
        return;
      }
      const solarResult = res.measurement.source === "solar";
      const pendingNow = solarResult ? 0 : res.measurement.provenance.instantPacks?.pending?.length ?? 0;
      setReusedInstant(solarResult ? null : res.reusedInstant?.how ?? null);
      if (!res.unsaved) void loadRecent();
      if (pendingNow > 0 && !res.unsaved && res.measurement.id !== "unsaved") {
        showMeasurement(res.measurement, false, false);
        holdRef.current = { id: res.measurement.id, startedAt: nowMs() };
        setHolding(true);
        startHoldProgress();
        return;
      }
      showMeasurement(res.measurement, !!res.unsaved);
      if (solarResult) {
        toast.success(res.unsaved ? "Roof estimate ready — not saved" : "Roof estimate ready", "Review the roof and measurements before pricing.");
      } else {
        measuredToast(res.measurement, !!res.unsaved, res.reusedInstant?.how ?? null);
      }
    } catch (err) {
      setPanel("intake");
      const text = "The measurement request did not complete. Check the connection and try again.";
      setIntakeError({ text, kind: "failed", target: input });
      toast.error("Couldn't measure this roof", text);
      console.warn("[roof] Measurement failed", err);
    } finally {
      setMeasurementBusy(false);
    }
  }

  // Measure. A repeat of an address the org already paid for REUSES the
  // stored EagleView answer (no new bill); `forceNewOrder` is the explicit
  // "re-measure at a new cost" gesture and is never set by a plain click.
  // `target` is the address to measure when it is not the intake's — the
  // report's own retry buttons pass the open measurement's address (review
  // 2026-09-17: on a row opened from Recent they measured nothing at all).
  // `building` is a point on the roof the contractor chose from the lot's
  // list ("Measure this building instead", 2026-10-26) — same address, same
  // stored order, only which building the report is about changes.
  // `pick` is "Make main": the building by its index, and the ticks to keep on the new measurement.
  async function runInstant(forceNewOrder = false, target?: OrderInput, building?: { lat: number; lng: number }, pick?: { mainIndex: number; included: number[] }) {
    if (busy || addressLoading || !evEnabled) return;
    const input = target ?? orderInput();
    if (!input.address) {
      if (target) {
        toast.error("No address on this measurement");
      } else {
        addrRef.current?.focus();
        toast.info("Enter the address first", "Type the street address or pick it from the suggestions, then measure.");
      }
      return;
    }
    if (!target && zip && !/^\d{5}(?:-\d{4})?$/.test(zip.trim())) {
      toast.error("Check the ZIP code", "Enter all 5 digits, or a ZIP+4 code.");
      return;
    }
    if (forceNewOrder && !window.confirm(`Order a new measurement for ${input.address}? This is billed; details the address already has are not bought again.`)) {
      return;
    }
    resetResult();
    holdRef.current = null;
    setHolding(false);
    stopHoldProgress();
    setIntakeError(null);
    setInstantBusy(true);
    setReusedInstant(null);
    setMsReport(input.address);
    setPanel("measuring");
    const stop = runProgress();
    try {
      const res = await measureRoofInstant(
        input,
        forceNewOrder || building || pick ? { ...(forceNewOrder ? { forceNewOrder } : {}), ...(building ? { building } : {}), ...(pick ? pick : {}) } : undefined,
      );
      // DEBUG (2026-09-08, owner's call — on until told otherwise): the whole
      // EagleView story for this click, in the browser console.
      console.info(
        "[roof:debug] Instant measure",
        res.ok
          ? {
              ok: true,
              requestId: res.measurement.instant?.requestId ?? null,
              packs: res.debug?.packs ?? null,
              reused: res.reusedInstant ?? null,
              totals: res.measurement.instant?.totals ?? null,
              structures: res.measurement.instant?.structures.length ?? 0,
              source: res.measurement.source,
              identity: res.debug,
            }
          : res,
      );
      if (!res.ok) {
        stop();
        setPanel("intake");
        failIntake(res, input);
        // The card-less trial's ceiling: the dialog asks for a card instead.
        if (reportPlanLimitResult(res)) return;
        toast.error("Couldn't measure this roof", res.error);
        return;
      }
      stop();
      const pendingNow = res.measurement.provenance?.instantPacks?.pending?.length ?? 0;
      setReusedInstant(res.reusedInstant?.how ?? null);
      if (!res.unsaved) void loadRecent();
      if (pendingNow > 0 && !res.unsaved && res.measurement.id !== "unsaved") {
        // The area is in; the pitch, facets and details are still being read.
        // Hold the report on the measuring screen — the collect loop (keyed on
        // the measurement below) brings the rest, and the reveal shows the
        // finished report once.
        showMeasurement(res.measurement, false, false);
        holdRef.current = { id: res.measurement.id, startedAt: nowMs() };
        setHolding(true);
        startHoldProgress();
        return;
      }
      setMs({ pct: 100, step: MS_STEPS.length, done: true });
      showMeasurement(res.measurement, !!res.unsaved);
      measuredToast(res.measurement, !!res.unsaved, res.reusedInstant?.how ?? null);
    } catch (err) {
      stop();
      setPanel("intake");
      // A thrown error is the network or the server, never the provider's
      // verdict: keep it plain and keep the detail in the console.
      console.warn("[roof:debug] measure threw", err);
      const text = "The measurement request did not complete. Check the connection and measure again; a placed order is collected without a new charge.";
      setIntakeError({ text, kind: "failed", target: input });
      toast.error("Couldn't measure this roof", text);
      void errMsg(err);
    } finally {
      setInstantBusy(false);
    }
  }

  // Hand-entered takeoff: no lookup, nothing billed, nothing saved to history.
  // A hand-entered takeoff, pre-filled by the page itself (the "price from
  // Google's figure" way out of a wrong-building answer). The intake's own
  // squares + pitch form was retired on 2026-09-13 at the owner's request.
  function runManual(preset: ManualTakeoff) {
    resetResult();
    setReusedInstant(null);
    setManual({ ...preset, squares: Math.round(preset.squares * 10) / 10 });
    setPanel("report");
  }

  // Reopen a saved measurement — no lookup, nothing billed.
  async function openRecent(id: string): Promise<boolean> {
    setOpeningId(id);
    try {
      const m = await getRoofMeasurement(id);
      if (!m) throw new Error("This measurement is no longer available.");
      resetResult();
      showMeasurement(m, false);
      // A saved row IS a stored answer: the paid re-order is offered the same way.
      setReusedInstant(m.instant && m.source !== "solar" ? "stored" : null);
      return true;
    } catch (err) {
      toast.error("Couldn't open measurement", errMsg(err));
      return false;
    } finally {
      setOpeningId(null);
    }
  }

  // The proposal's roof, opened once on arrival: nothing is measured or
  // Back from Manage roof types: the same measurement, the buildings ticked, the pitch, the builder's choices and
  // any lines already built — once, then the note is spent.
  const returnedRef = React.useRef(false);
  React.useEffect(() => {
    if (returnedRef.current || proposalId || initialAddress) return;
    returnedRef.current = true;
    const back = readReturn();
    try {
      window.sessionStorage.removeItem(RETURN_KEY);
    } catch {}
    const url = new URL(window.location.href);
    if (url.searchParams.has("reopen")) {
      url.searchParams.delete("reopen");
      window.history.replaceState(window.history.state, "", url.pathname + (url.search ? url.search : "") + url.hash);
    }
    if (!back || nowMs() - back.at > RETURN_TTL_MS) return;
    void (async () => {
      if (!(await openRecent(back.id))) return;
      setExtra(new Set(back.extra));
      setPitchEntered(back.pitchEntered);
      const toLine = (l: { name: string; quantity: number; unitPrice: number; unit: string }): EditableLine => ({ id: nanoid(6), name: l.name, quantity: l.quantity, unitPrice: l.unitPrice, unit: l.unit });
      if (back.materials.length || back.labor.length) {
        setMaterials(back.materials.map(toLine));
        setLabor(back.labor.map(toLine));
        setTitle(back.title);
        setScopeText(back.scope);
        setAssumptions(back.assumptions);
        setTablesEdited(back.tablesEdited);
      }
      if (back.spec && back.factsKey) {
        lastSpecRef.current = back.spec;
        setSeedSpec({ spec: back.spec, key: back.factsKey });
      }
    })();
    // openRecent is this render's handler; the return is read once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // billed — the stored measurement (or hand takeoff) comes back, then the
  // proposal's own lines and the package choices they were built with.
  const openedProposalRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!proposalId || openedProposalRef.current === proposalId) return;
    openedProposalRef.current = proposalId;
    void (async () => {
      const r = await loadRoofFromProposal(proposalId).catch((err: unknown) => ({ ok: false as const, error: errMsg(err) }));
      if (!r.ok) {
        setLinkInfo(null);
        toast.error("Couldn't open that proposal here", r.error);
        return;
      }
      setLinked(r.proposal);
      let opened = false;
      if (r.manual) {
        runManual(r.manual);
        opened = true;
      } else if (r.measurementId) {
        opened = await openRecent(r.measurementId);
        // The proposal was made about one main building: if it was changed since, the measurement goes back to the
        // proposal's (free — nothing is ordered), so the figures match the lines it is about to show.
        const m = latestRef.current;
        const nowMain = m?.instant ? mainStructureOf({ structures: m.instant.structures, provenance: m.provenance as Record<string, unknown>, origin: { lat: m.lat, lng: m.lng } }).index : null;
        if (opened && m && r.mainIndex != null && nowMain !== r.mainIndex && m.instant?.structures[r.mainIndex]) {
          const back = await setMainStructure(m.id, r.mainIndex).catch(() => null);
          if (back?.ok) {
            setMeasurement(back.measurement);
            latestRef.current = back.measurement;
          }
        }
      }
      if (opened) {
        const m = latestRef.current;
        const main = m?.instant ? mainStructureOf({ structures: m.instant.structures, provenance: m.provenance as Record<string, unknown>, origin: { lat: m.lat, lng: m.lng } }).index : null;
        setExtra(new Set(r.extra.filter((i) => i !== main)));
        setPitchEntered(r.pitchEntered);
        const toLine = (l: { name: string; quantity: number; unitPrice: number; unit: string }): EditableLine => ({ id: nanoid(6), name: l.name, quantity: l.quantity, unitPrice: l.unitPrice, unit: l.unit });
        setMaterials(r.materials.map(toLine));
        setLabor(r.labor.map(toLine));
        setTitle(r.title);
        setScopeText(r.scope);
        setAssumptions(r.assumptions);
        setTablesEdited(false);
        setSampleEstimate(false);
        if (r.spec && r.factsKey) {
          lastSpecRef.current = r.spec;
          setSeedSpec({ spec: r.spec, key: r.factsKey });
        }
      }
      setLinkInfo({ others: r.others, older: r.older, missing: !opened, loading: false });
    })();
    // openRecent/runManual are this render's handlers; the proposal opens once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposalId]);

  // A LEAD CENTER LEAD THE HOMEOWNER PRICED (2026-10-27): the whole hidden estimate opens here the way a proposal
  // reopens — a hand takeoff (the squares and the pitch), the package's choices, every line, the scope — once, on
  // arrival from the lead page. Its pin becomes the search's point, so a Measure click reads that building. The
  // spec is seeded once the takeoff's facts exist (the card keys a seed to the facts it was built on).
  const openedLeadRef = React.useRef<string | null>(null);
  const leadSpecRef = React.useRef<RoofPackageSpec | null>(null);
  React.useEffect(() => {
    if (!leadEstimateId || openedLeadRef.current === leadEstimateId) return;
    openedLeadRef.current = leadEstimateId;
    void (async () => {
      const r = await openRoofLeadEstimate(leadEstimateId).catch((err: unknown) => ({ ok: false as const, error: errMsg(err) }));
      if (!r.ok) {
        if (!("none" in r && r.none)) toast.error("Couldn't open the lead's estimate", r.error);
        return;
      }
      runManual({ squares: r.manual.squares, pitchLabel: r.manual.pitchLabel, address: r.manual.address });
      if (r.pin && r.manual.address) setPicked({ address: r.manual.address, city: "", state: "", zip: "", lat: r.pin.lat, lng: r.pin.lng, formatted: r.manual.address });
      const toLine = (l: { name: string; quantity: number; unitPrice: number; unit: string }): EditableLine => ({ id: nanoid(6), name: l.name, quantity: l.quantity, unitPrice: l.unitPrice, unit: l.unit });
      setMaterials(r.materials.map(toLine));
      setLabor(r.labor.map(toLine));
      setTitle(r.title);
      setScopeText(r.scope);
      setAssumptions(r.assumptions);
      setTablesEdited(false);
      setSampleEstimate(false);
      lastSpecRef.current = r.spec;
      leadSpecRef.current = r.spec;
      toast.success("The homeowner's estimate is open", r.basis === "solar" ? "Priced on JobFlex from an aerial read — measure before you sign." : "Priced on JobFlex from the home's square footage — measure before you sign.");
    })();
    // runManual is this render's handler; the lead opens once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadEstimateId]);

  // A WEBSITE ESTIMATOR'S ROOF LEAD (2026-11-01): the aerial measurement the website read opens (stored — nothing is
  // ordered), the package the website priced is seeded into the build card once the facts exist (leadSpecRef, above),
  // and its lines are the estimate — the contractor sees the number the homeowner saw.
  const openedWebRef = React.useRef(false);
  React.useEffect(() => {
    if (!webRoof || openedWebRef.current) return;
    openedWebRef.current = true;
    void (async () => {
      leadSpecRef.current = webRoof.spec;
      if (!(await openRecent(webRoof.measurementId))) {
        leadSpecRef.current = null;
        return;
      }
      const toLine = (l: { name: string; quantity: number; unitPrice: number; unit: string }): EditableLine => ({ id: nanoid(6), name: l.name, quantity: l.quantity, unitPrice: l.unitPrice, unit: l.unit });
      lastSpecRef.current = webRoof.spec;
      setMaterials(webRoof.materials.map(toLine));
      setLabor(webRoof.labor.map(toLine));
      setTitle(`${webRoof.spec.systemName?.trim() || "Roof"} · ${webRoof.address || "site"}`);
      setScopeText(webRoof.scope);
      const shown = webRoof.shown.low === webRoof.shown.high ? `$${webRoof.shown.low.toLocaleString("en-US")}` : `$${webRoof.shown.low.toLocaleString("en-US")} – $${webRoof.shown.high.toLocaleString("en-US")}`;
      setAssumptions([`From your website estimator: the homeowner chose ${webRoof.choice} and saw ${shown} before tax. Priced from an aerial read — measure before you sign.`, ...webRoof.assumptions]);
      setTablesEdited(false);
      setSampleEstimate(false);
      toast.success("The homeowner's estimate is open", `${webRoof.choice} — the lines below are the price they saw.`);
      revealTables();
    })();
    // openRecent / revealTables are this render's handlers; the lead opens once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webRoof]);

  async function generate() {
    const t = totals;
    if (t?.squares == null) return;
    if (isRecon) {
      toast.error(
        "Estimated measurements can’t be priced",
        "Use Measure this roof on this address to build a priced estimate.",
      );
      return;
    }
    if (packsPending) {
      toast.info("Still reading the details", "The pitch and details are on their way; the estimate prices once they land.");
      return;
    }
    // No pitch, no price: the button is disabled in this state, this is the belt.
    if (!pitchForEstimate || !pitchKind) {
      toast.error("Enter the pitch first", "The measurement has no pitch for this roof; pick one to price it.");
      return;
    }
    setGenBusy(true);
    try {
      const families = isSolar ? solarPitchShares : pitchMeasured ? pitchFamilyShares(pitchRep!.families) : [];
      const pitchNote =
        pitchKind === "measured"
          ? families.length > 1
            ? `two-pitch roof: ${families.map((f) => `${Math.round(f.pitch12)}/12 (${Math.round(f.share * 100)}% of the roof)`).join(" + ")} — measured from aerial elevation data (${Math.round((pitchRep!.trustedShare ?? 0) * 100)}% of the roof read cleanly)`
            : `pitch ${pitchForEstimate} over the whole roof — measured from aerial elevation data (${Math.round((pitchRep!.trustedShare ?? 0) * 100)}% of the roof read cleanly; that is the measurement's coverage, not a share of the roof at this pitch)`
          : pitchKind === "solar"
            ? `pitch ${pitchForEstimate} estimated from Google aerial data — preliminary, not field verified`
          : pitchKind === "eagleview"
            ? `pitch ${pitchForEstimate} (${AERIAL.reported} figure)`
            : `pitch ${pitchForEstimate} entered by user — not measured`;
      const est = roofFacts && !roofFacts.measured ? estimateEdges(roofFacts) : null;
      const mf = roofFacts?.measured ?? null;
      const flatRoof = !!roofFacts && isFlatRoof(roofFacts);
      const edgesNote = mf
        ? flatRoof
          ? `MEASURED perimeter from the aerial report #${mf.reportId}: ${Math.round(mf.eaveFt + mf.rakeFt)} ft, and ${Math.round(mf.stepFlashFt)} ft where the roof meets a wall — use these for coping, edge metal, base flashing and termination bar`
          : `MEASURED lengths from the aerial report #${mf.reportId}: eave ${Math.round(mf.eaveFt)} ft, rake ${Math.round(mf.rakeFt)} ft, ridge ${Math.round(mf.ridgeFt)} ft, hip ${Math.round(mf.hipFt)} ft, valley ${Math.round(mf.valleyFt)} ft, step flashing ${Math.round(mf.stepFlashFt)} ft — use these for drip edge, starter, cap, ridge vent, valley metal and step flashing`
          : est
          ? isSolar
            ? `linear quantities ESTIMATED from building footprint and assumed roof shape: eave ${Math.round(est.eaveFt)} ft, rake ${Math.round(est.rakeFt)} ft, ridge ${Math.round(est.ridgeFt)} ft, hip ${Math.round(est.hipFt)} ft${est.valleyFt != null && est.valleyFt > 0 ? `, valley ${Math.round(est.valleyFt)} ft` : ""} — verify every run on site`
          : roofFacts && isFlatRoof(roofFacts)
            ? `flat roof perimeter ESTIMATED from the outline: ${Math.round(est.eaveFt)} ft — split it between parapet (coping) and open edge (edge metal) from the photo`
            : `edge lengths ESTIMATED from the outline and shape: eave ${Math.round(est.eaveFt)} ft, rake ${Math.round(est.rakeFt)} ft, ridge ${Math.round(est.ridgeFt)} ft, hip ${Math.round(est.hipFt)} ft${est.valleyFt != null && est.valleyFt > 0 ? `, valley ${Math.round(est.valleyFt)} ft (from the facet count)` : ""} — use these unless the photo says otherwise`
          : null;
      const factsNote = roofFacts
        ? [
            roofFacts.perimeterFt != null ? `building perimeter ${Math.round(roofFacts.perimeterFt)} ft (${isFlatRoof(roofFacts) ? "coping and edge metal" : "drip edge and starter run"})` : null,
            roofFacts.shape ? `roof shape ${roofFacts.shape}` : null,
            roofFacts.facetCount != null ? `${roofFacts.facetCount} facets` : null,
            roofFacts.chimney != null ? `chimney: ${roofFacts.chimney ? "yes — include chimney flashing" : "no"}` : null,
            roofFacts.rooftopAcCount ? `${roofFacts.rooftopAcCount} rooftop unit(s) — curb flashing` : null,
            roofFacts.existingMaterial
              ? likeForLikeFamily(roofFacts) === "metal" && isFlatRoof(roofFacts)
                ? `existing roof: ${roofFacts.existingMaterial} on a low-slope building — price low-slope standing-seam metal (1:12) like-for-like, not a membrane`
                : likeForLikeFamily(roofFacts)
                  ? `existing roof: ${roofFacts.existingMaterial} — price a like-for-like replacement in the same material`
                  : isFlatRoof(roofFacts) && familyOfMaterial(roofFacts.existingMaterial)
                    ? `existing surface: ${roofFacts.existingMaterial} on a flat roof — replace it with a low-slope system`
                    : null
              : null,
            eaveHeights.length ? `eave heights above ground ${eaveHeights.map((e) => `${e.facade} ${e.ft} ft`).join(", ")} (10 ft classes)` : null,
            edgesNote,
          ]
            .filter(Boolean)
            .join("; ")
        : "";
      const extrasNote =
        !manual && extra.size
          ? ` Includes ${extra.size} other structure(s) on the parcel the contractor ticked in (${num(
              otherStructures.filter(({ i }) => extra.has(i)).reduce((a, { s }) => a + (s.areaSqft ?? 0), 0),
            )} sq ft); the main structure alone is ${num(structure?.areaSqft ?? 0)} sq ft.`
          : "";
      const res = await estimateRoof({
        address: siteAddress || undefined,
        lat: measurement?.lat ?? undefined,
        lng: measurement?.lng ?? undefined,
        pitch: pitchForEstimate,
        pitchSource: pitchKind,
        pitchFamilies: families.length > 1 ? families : undefined,
        squares: Number(t.squares.toFixed(1)),
        wastePct: waste,
        existingMaterial: roofFacts && roofFacts.existingMaterial && likeForLikeFamily(roofFacts) ? roofFacts.existingMaterial : undefined,
        // A flat metal building is priced as low-slope standing seam, which the
        // builder handles as metal — not as a membrane assembly.
        roofKind: roofFacts && isFlatRoof(roofFacts) && likeForLikeFamily(roofFacts) !== "metal" ? "low-slope" : "steep",
        buildingUse: manual ? null : buildingUse,
        measurementNotes: isSolar
          ? `${solarEstimateNote} ${t.squares.toFixed(1)} squares (${num(t.areaSqft ?? 0)} sq ft), ${pitchNote}. Footprint ${footprint.sqft != null ? num(footprint.sqft) + " sq ft" : "unavailable"}. ${factsNote} All linear quantities are estimates, not measured lengths. Itemize flashing and vent quantities and record the assumptions.`
          : manual
          ? `Contractor-entered takeoff: ${t.squares.toFixed(1)} squares (${num(t.areaSqft ?? 0)} sq ft), ${pitchNote}. No facet or linear-footage breakdown; allow for ridge, valley and flashing.`
          : `${AERIAL.vendor} (calibrated): ${t.squares.toFixed(1)} squares (${num(t.areaSqft ?? 0)} sq ft) for the main structure, ${pitchNote}, footprint ${
              footprint.sqft != null
                ? `${num(footprint.sqft)} sq ft${footprint.source === "outline" ? " (from the building outline — the reported figure disagreed)" : ""}`
                : "not purchased"
            }.${extrasNote}${factsNote ? ` Also known: ${factsNote}.` : ""} ${
              flatRoof
                ? "Flat roof: itemize the membrane assembly, perimeter metal, drains and penetrations with a count or length, and say in the assumptions which figures are estimates."
                : mf
                  ? "Valley and sidewall lengths are measured; wall counts are not — assume one run each unless the photo shows more."
                  : "Ridge, hip, valley and wall lengths are NOT measured — use the estimates above, itemize every flashing and vent with a count or length, and say in the assumptions which figures are estimates."
            }`,
      });
      if (!res.ok) {
        if (reportPlanLimitResult(res)) return;
        throw new Error(res.error);
      }
      if (res.disabled) toast.info("AI is off on this server — sample lines loaded", "They show the shape of an estimate and can't become a proposal. Build the package instead.");
      setSampleEstimate(!!res.disabled);
      setTablesEdited(false);
      setTitle(res.data.title);
      setAssumptions(isSolar ? [solarEstimateNote, ...res.data.assumptions] : res.data.assumptions);
      setScopeText(res.data.scope ?? "");
      setMaterials(res.data.materials.map((m) => ({ id: nanoid(6), ...m })));
      setLabor(res.data.labor.map((m) => ({ id: nanoid(6), ...m })));
      if (!res.disabled) toast.success("Estimate ready");
      revealTables();
    } catch (err) {
      toast.error("Generation failed", errMsg(err));
    } finally {
      setGenBusy(false);
    }
  }

  // The package builder's output becomes the estimate: the same two tables the
  // AI fills, with the basis of every quantity carried on the line.
  // The tables sit under the card: bring them into view and hand focus to
  // them, so "Review N lines" is seen to do something (review 2026-09-17).
  function revealTables() {
    window.requestAnimationFrame(() => {
      const out = document.getElementById("buildOut");
      if (!out) return;
      out.scrollIntoView({ behavior: "smooth", block: "start" });
      out.querySelector<HTMLElement>("[data-lines-heading]")?.focus({ preventScroll: true });
    });
  }
  function applyPackage(pkg: RoofPackage, spec: RoofPackageSpec, quiet = false) {
    lastSpecRef.current = spec;
    if (!pitchForEstimate) {
      toast.error("Enter the roof pitch first");
      return null;
    }
    if (packsPending) {
      toast.info("Still reading the details", "The pitch and details are on their way; the package prices once they land.");
      return null;
    }
    if (tablesEdited && !window.confirm("Replace the lines you edited with the package as it is configured now?")) return null;
    const toLine = (l: RoofPackage["materials"][number]): EditableLine => ({
      id: nanoid(6),
      name: l.name,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      unit: l.unit,
      basis: l.basis,
    });
    const next = {
      title: `${spec.systemName.trim() || "Roof"} · ${siteAddress || "site"}`,
      materials: pkg.materials.map(toLine),
      labor: pkg.labor.map(toLine),
      assumptions: isSolar ? [solarEstimateNote, ...pkg.assumptions] : pkg.assumptions,
      scope: pkg.scope.join("\n"),
    };
    setMaterials(next.materials);
    setLabor(next.labor);
    setSampleEstimate(false);
    setTablesEdited(false);
    setAssumptions(next.assumptions);
    setScopeText(next.scope);
    setTitle(next.title);
    if (!quiet) {
      toast.success("Estimate built", `${pkg.materials.length} material and ${pkg.labor.length} labor lines — adjust anything below, then convert.`);
      revealTables();
    }
    return next;
  }
  // "Convert as is": the package straight to a proposal, no review stop —
  // unless the contractor already reviewed and edited lines below, in which
  // case THOSE lines are the estimate and the card's button converts them
  // (review 2026-09-17: a qty edited 15 → 99 was silently dropped).
  function convertPackage(pkg: RoofPackage, spec: RoofPackageSpec) {
    lastSpecRef.current = spec;
    if (hasEstimate && tablesEdited) {
      void convert();
      return;
    }
    const estimate = applyPackage(pkg, spec, true);
    if (estimate) void convertWith(estimate);
  }

  // EagleView's price object has no fixed shape in the docs; read the usual
  // fields and fall back to "see the confirmation".
  function priceText(price: unknown): string | null {
    if (typeof price === "number") return `$${price.toFixed(2)}`;
    const o = (price ?? {}) as Record<string, unknown>;
    const n = [o.totalCost, o.TotalCost, o.price, o.Price, o.amount].find((v) => typeof v === "number") as number | undefined;
    return n != null ? `$${n.toFixed(2)}` : null;
  }
  function reportInput() {
    const m = measurement;
    // A re-measure keeps the pin the person placed for this measurement, so the same building stays main.
    const userPin = userPinOf(m?.provenance as Record<string, unknown> | undefined);
    return {
      address: m?.address ?? "",
      city: m?.city ?? "",
      state: m?.state ?? "",
      zip: m?.zip ?? "",
      lat: m?.lat ?? undefined,
      lng: m?.lng ?? undefined,
      userPin,
    };
  }
  // Price, confirm, order. The order is BILLED and takes about 48 hours; the
  // lookup effect above picks the lengths up whenever the measurement is
  // opened again, and "Check" collects them on demand.
  async function orderFullReport() {
    const input = reportInput();
    if (!input.address) {
      toast.error("No address on this measurement");
      return;
    }
    setReportBusy(true);
    try {
      const priced = await evPriceRoof(input);
      const p = priced.ok ? priceText(priced.price) : null;
      const ok = window.confirm(
        `Order the full aerial measurement report for ${input.address}?${p ? ` Price: ${p}.` : ""} It is billed and usually arrives within 48 hours; its measured ridge, hip, valley, eave and rake lengths then load into the package by themselves.`,
      );
      if (!ok) return;
      const res = await evOrderRoof(input);
      if (!res.ok) throw new Error(res.error);
      setReport({ state: "pending", reportId: res.reportId, status: "In Process" });
      toast.success("Full report ordered", `#${res.reportId} — check back in a day or two.`);
    } catch (err) {
      toast.error("Couldn't order the report", errMsg(err));
    } finally {
      setReportBusy(false);
    }
  }
  async function checkReport() {
    if (report.state !== "pending" || !report.reportId) return;
    const id = report.reportId;
    setReportBusy(true);
    try {
      const st = await evReportStatus(id);
      if (!st.ok) throw new Error(st.error);
      if (!st.completed) {
        toast.info(`Report #${id} · ${st.displayStatus}`);
        return;
      }
      const model = await evRoofModel(id);
      if (!model.ok) throw new Error(model.error);
      const f = model.model.totals.footageByType;
      setReport({ state: "measured", reportId: id, footage: { reportId: id, eaveFt: f.EAVE ?? 0, rakeFt: f.RAKE ?? 0, ridgeFt: f.RIDGE ?? 0, hipFt: f.HIP ?? 0, valleyFt: f.VALLEY ?? 0, stepFlashFt: f.STEPFLASH ?? 0 } });
      toast.success("Measured lengths loaded", "Ridge, hip, valley, eave and rake now come from the aerial report.");
    } catch (err) {
      toast.error("Couldn't check the report", errMsg(err));
    } finally {
      setReportBusy(false);
    }
  }

  // Convert THESE lines — the tables' state, or a package just built, which
  // React would not have committed to state yet ("convert as is").
  /** What the estimator was looking at, kept with the proposal so it opens here again (ROOF_PLAN). */
  function planNow(assumptionsNow: string[]) {
    return {
      spec: (lastSpecRef.current as unknown as Record<string, unknown> | null) ?? null,
      factsKey: roofFacts ? factsKey(roofFacts) : null,
      manual: manual ? { squares: manual.squares, pitchLabel: manual.pitchLabel, address: manual.address } : null,
      extra: [...extra],
      mainIndex: manual ? null : mainPick.index,
      pitchEntered,
      assumptions: assumptionsNow,
    };
  }
  async function convertWith(input: { title: string; materials: EditableLine[]; labor: EditableLine[]; assumptions: string[]; scope: string }, opts: { asNew?: boolean; confirmed?: boolean } = {}) {
    if (!measurement && !manual) return;
    if (isRecon) {
      toast.error("Estimated measurements can’t become a proposal", "Use Measure this roof on this address first.");
      return;
    }
    if (sampleEstimate) {
      toast.error("Sample lines can’t become a proposal", "AI is off on this server, so these are placeholder figures. Build the package for a priced estimate.");
      return;
    }
    if (!input.materials.length && !input.labor.length) {
      toast.error("Nothing to convert", "Build the estimate first.");
      return;
    }
    // Working on a saved proposal: THAT one is re-priced, unless it is signed
    // or paid (then a new proposal), or the contractor chose a new one.
    if (linked && !linked.lock && !opts.asNew) {
      if (linked.seen && !opts.confirmed) {
        setAskUpdate({ go: () => void convertWith(input, { confirmed: true }) });
        document.querySelector("[data-roof-linked]")?.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      setAskUpdate(null);
      setConvertBusy(true);
      try {
        const r = await updateRoofProposal({
          proposalId: linked.id,
          title: input.title || `Roof · ${siteAddress || "site"}`,
          scope: input.scope,
          materials: input.materials.map(stripId),
          labor: input.labor.map(stripId),
          measurementId: savedId,
          address: siteAddress ?? null,
          plan: planNow(input.assumptions),
        });
        if (!r.ok) {
          setConvertBusy(false);
          if (r.code === "LOCKED") setLinked({ ...linked, lock: r.lock });
          toast.error(`Couldn't update ${linked.ref}`, r.error);
          return;
        }
        const kept = [r.kept ? `${r.kept} line${r.kept === 1 ? "" : "s"} you added in the proposal stayed` : "", r.titleKept ? "your title stayed" : "", r.scopeKept ? "your scope stayed" : ""].filter(Boolean).join(" · ");
        toast.success(`${linked.ref} updated`, kept || "The proposal now carries this estimate.");
        router.push(`/dashboard/proposals/${r.id}` as Parameters<typeof router.push>[0]);
      } catch (err) {
        setConvertBusy(false);
        toast.error(`Couldn't update ${linked.ref}`, errMsg(err));
      }
      return;
    }
    if (!(await ensureWithinLimit("proposalsCreated"))) return;
    setConvertBusy(true);
    try {
      const res = await convertRoofEstimateToProposal({
        title: input.title || `Roof · ${siteAddress || "site"}`,
        scope: input.scope,
        materials: input.materials.map(stripId),
        labor: input.labor.map(stripId),
        assumptions: input.assumptions,
        measurementId: savedId,
        inventoryLinked: invLink,
        // The job address rides with the proposal (and sets the state's sales
        // tax); the server prefers the saved measurement's own when there is one.
        address: siteAddress ?? undefined,
        plan: planNow(input.assumptions),
      });
      toast.success("Proposal created");
      router.push(`/dashboard/proposals/${res.id}` as Parameters<typeof router.push>[0]);
    } catch (err) {
      setConvertBusy(false);
      if (reportPlanLimit(err)) return;
      toast.error("Couldn't convert", errMsg(err));
    }
  }
  function convert() {
    return convertWith({ title, materials, labor, assumptions, scope: scopeText });
  }

  // ── Derived report figures: the MAIN structure, plus whatever the contractor ticked ──
  // EagleView answers with every structure on the parcel (12117: the house and
  // nineteen outbuildings). The page is about one of them — the one the
  // server chose and recorded (provenance.mainStructure), or, for rows saved
  // before that existed, the same rule applied here — and the rest are listed
  // with checkboxes. A ticked structure joins the total and the estimate.
  const inst = measurement?.instant ?? null;
  const prov = measurement?.provenance;
  const mainPick: { index: number | null; how: string } = !inst
    ? { index: null, how: "none" }
    : mainStructureOf({
        structures: inst.structures,
        provenance: prov as Record<string, unknown> | null | undefined,
        origin: { lat: measurement?.lat, lng: measurement?.lng },
      });
  const structure: InstantStructure | null = inst && mainPick.index != null ? (inst.structures[mainPick.index] ?? null) : null;
  // The rest: this lot's buildings first, then the ones the parcel check put outside it (a neighbour's), nearest the
  // house first — numbered in this order on the rows and the pins (lib/roofDiagram/instantTotals.otherStructuresOf).
  const parcelVeto = (prov as Record<string, unknown> | null | undefined)?.parcelVeto as { foreignStructures?: string[] } | undefined;
  const otherStructures = inst
    ? otherStructuresOf({
        structures: inst.structures,
        mainIndex: mainPick.index,
        foreign: foreignIndices(parcelVeto?.foreignStructures),
        origin: measurement?.lat != null && measurement?.lng != null ? { lat: measurement.lat, lng: measurement.lng } : null,
      })
    : [];

  // THE BUILDINGS IN THE ESTIMATE, NUMBERED (2026-10-26, ticket 8KETUL: the list numbered every building on the
  // lot nearest-first, and a contractor read "1, 2, 3" as sections of one roof spread over three buildings). Only
  // the buildings in the estimate carry a number — the main one is always 1, then the ticked ones in list order —
  // the same number on the row and on the map ("Building 2 of 3").
  const includedOrder: number[] = mainPick.index != null ? [mainPick.index, ...otherStructures.filter(({ i }) => extra.has(i)).map(({ i }) => i)] : [];
  const numberOf = (i: number): number | null => {
    const n = includedOrder.indexOf(i);
    return n < 0 ? null : n + 1;
  };

  // The buildings on the map (owner, 2026-10-10: "when I tick a box, show on the map which one that is"). Outlines
  // REMOVED 2026-11-03 (owner: no building outlines on the aerial map): only the buildings in the estimate show, as
  // a numbered circle at the middle of their outline (main in blueprint, a ticked one in its colour). A building is
  // chosen on the map by a click on its marker — its row is brought into view. What was just ticked, or asked for
  // with "Show on map", is framed with the main building once (the outline still gives the bounds).
  const overlaysRef = React.useRef<MapOverlay[]>([]);
  const framedRef = React.useRef<{ on: string | null; ticked: ReadonlySet<number>; focus: number | null }>({ on: null, ticked: new Set(), focus: null });
  const outlineKey = (inst?.structures ?? []).map((s, i) => `${i}:${s.outline?.length ?? 0}`).join(",");
  const includedKey = includedOrder.join(",");
  const pickRef = React.useRef<(i: number) => void>(() => {});
  React.useEffect(() => {
    const live = liveMapRef.current;
    const sdk = (window as unknown as { google?: { maps?: OutlineSdk } }).google?.maps;
    const clear = () => {
      for (const o of overlaysRef.current) o.setMap(null);
      overlaysRef.current = [];
    };
    clear();
    if (!live || !inst || !sdk || !mapReadyFor || view !== "satellite" || panel !== "report") return clear;
    const map = live.map as LiveGoogleMap & {
      fitBounds?: (b: MapBounds, pad?: number) => void;
      getZoom?: () => number;
      addListener?: (ev: string, fn: () => void) => { remove(): void };
    };
    inst.structures.forEach((s, i) => {
      const ring = s.outline ?? [];
      if (ring.length < 3) return;
      const n = numberOf(i);
      if (n == null || !sdk.Marker) return;
      const isMain = i === mainPick.index;
      const colour = isMain ? MAIN_COLOR : buildingColor(n - 2);
      const tag = new sdk.Marker({
        map,
        position: ringCenter(ring),
        clickable: true,
        zIndex: 7,
        title: `Building ${n} of ${includedOrder.length}`,
        label: { text: String(n), color: isMain ? "#ffffff" : "#0a0a0a", fontSize: "12px", fontWeight: "800" },
        // Beside the building's middle, not on it: the person's pin often stands there.
        icon: { path: 0, scale: 11, fillColor: colour, fillOpacity: 1, strokeColor: "#0a0a0a", strokeWeight: 1.5, ...(sdk.Point ? { anchor: new sdk.Point(-1.7, 0) } : {}) },
      });
      tag.addListener?.("click", () => pickRef.current(i));
      overlaysRef.current.push(tag);
    });
    const ticked = otherStructures.filter(({ i }) => extra.has(i)).map(({ i }) => i);
    // A measurement opened with buildings already ticked (kept on the row) opens on its main building: only a tick
    // made now is framed.
    const before = framedRef.current.on === mapReadyFor ? framedRef.current : { on: mapReadyFor, ticked: new Set<number>(ticked), focus: null };
    const fresh = ticked.filter((i) => !before.ticked.has(i));
    const asked = focusBuilding != null && focusBuilding !== before.focus ? focusBuilding : null;
    const target = asked ?? fresh[fresh.length - 1] ?? null;
    framedRef.current = { on: mapReadyFor, ticked: new Set(ticked), focus: focusBuilding };
    const targetRing = target != null ? inst.structures[target]?.outline : null;
    if (targetRing && targetRing.length >= 3 && sdk.LatLngBounds && map.fitBounds) {
      const bounds = new sdk.LatLngBounds();
      if (mapLat != null && mapLng != null) bounds.extend({ lat: mapLat, lng: mapLng });
      for (const p of targetRing) bounds.extend(p);
      map.fitBounds(bounds, 60);
      // Two buildings a few yards apart would zoom past the imagery; stop at the house's own zoom.
      const once = map.addListener?.("idle", () => {
        once?.remove();
        if ((map.getZoom?.() ?? 0) > LIVE_MAP_ZOOM) map.setZoom(LIVE_MAP_ZOOM);
      });
    }
    return clear;
    // outlineKey / includedKey stand for the outlines and the numbering; the arrays are rebuilt every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReadyFor, view, panel, extra, focusBuilding, outlineKey, includedKey, mapLat, mapLng]);
  /** "Show on map": the satellite view, the map in sight on a phone, and the building framed with the house. */
  const showOnMap = (i: number) => {
    if (view !== "satellite") setView("satellite");
    setFocusBuilding(i);
    const host = liveMapRef.current?.host;
    if (host) {
      const r = host.getBoundingClientRect();
      if (r.bottom < 60 || r.top > window.innerHeight - 60) host.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };
  /** A building clicked on the map: its row in the list, unfolded and brought into view. */
  React.useEffect(() => {
    pickRef.current = (i: number) => {
      setFocusBuilding(i);
      window.requestAnimationFrame(() => {
        const row = document.querySelector<HTMLElement>(`[data-structure="${i}"]`);
        if (!row) return;
        row.scrollIntoView({ behavior: "smooth", block: "center" });
        row.querySelector<HTMLElement>("input, button")?.focus({ preventScroll: true });
      });
    };
  }, []);

  // The ticks are kept on the row (2026-10-26): reopened from Recent, a proposal or another device, the same
  // buildings are in. Written once the ticking settles; the page never waits for it.
  const saveTicksRef = React.useRef<number | null>(null);
  function tickBuildings(next: ReadonlySet<number>) {
    setExtra(next);
    if (!savedId) return;
    const id = savedId;
    if (saveTicksRef.current) window.clearTimeout(saveTicksRef.current);
    saveTicksRef.current = window.setTimeout(() => {
      saveTicksRef.current = null;
      void saveIncludedStructures(id, [...next]).then(
        (r) => {
          if (!r.ok) toast.error("Couldn't keep the buildings", r.error);
        },
        () => toast.error("Couldn't keep the buildings", "Check the connection; the estimate on this page is unchanged."),
      );
    }, 500);
  }

  // "Make main" (2026-10-26, ticket 8KETUL): the building the figures are about, chosen by the person. The server
  // works the measurement out again from what it already holds — nothing is ordered — and the figures, the hero
  // and the estimate follow at once; the building that was main joins the list unticked.
  const [mainBusy, setMainBusy] = React.useState<number | null>(null);
  async function makeMain(i: number) {
    if (!savedId || mainBusy != null) return;
    const id = savedId;
    const n = numberOf(i);
    if (saveTicksRef.current) {
      window.clearTimeout(saveTicksRef.current);
      saveTicksRef.current = null;
      await saveIncludedStructures(id, [...extra]).catch(() => null);
    }
    // THE FULL MEASUREMENT OF THAT BUILDING (owner, 2026-10-26): the other developer's "Measure this one" path
    // (a2b54fb6) — the address's stored order measured again about the chosen building, the elevation pass, pitch
    // and package with it, nothing bought from EagleView — named by its index, with the ticks carried over (the old
    // main one unticked). The page opens the new measurement; Recent gets its row.
    const ring = inst?.structures[i]?.outline;
    if (evEnabled) {
      setMainBusy(i);
      try {
        await runInstant(false, reportInput(), ring && ring.length >= 3 ? pointOnRing(ring) : undefined, { mainIndex: i, included: [...extra].filter((x) => x !== i) });
      } finally {
        setMainBusy(null);
      }
      return;
    }
    // Without the aerial service on this server: the figures switch on the saved measurement (setMainStructure).
    setMainBusy(i);
    try {
      const r = await setMainStructure(id, i);
      if (!r.ok) {
        toast.error("Couldn't change the main building", r.error);
        return;
      }
      setMeasurement(r.measurement);
      latestRef.current = r.measurement;
      const nowMain = r.measurement.instant ? mainStructureOf({ structures: r.measurement.instant.structures, provenance: r.measurement.provenance as Record<string, unknown>, origin: { lat: r.measurement.lat, lng: r.measurement.lng } }).index : null;
      setExtra(new Set(includedIndicesOf(r.measurement.provenance as Record<string, unknown>, r.measurement.instant?.structures.length ?? 0, nowMain)));
      setFocusBuilding(null);
      const area = r.measurement.instant?.structures[i]?.areaSqft;
      toast.success("Main building changed", `${n != null ? `Building ${n}` : "The building you chose"}${area != null ? ` · ${num(area)} sq ft` : ""} is now Building 1; the estimate follows it.`);
      window.requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-structure-main]")?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
    } catch {
      toast.error("Couldn't change the main building", "Check the connection and try again.");
    } finally {
      setMainBusy(null);
    }
  }
  const includedStructures: InstantStructure[] = structure
    ? [structure, ...otherStructures.filter(({ i }) => extra.has(i)).map(({ s }) => s)]
    : [];
  /** A building ticked in or out of the estimate; the row moves between the two groups, the keyboard stays on it. */
  function onTickBuilding(i: number, on: boolean) {
    const next = new Set(extra);
    if (on) next.add(i);
    else next.delete(i);
    tickBuildings(next);
    window.requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`[data-structure="${i}"] input[type=checkbox]`)?.focus({ preventScroll: true }));
  }
  function onMakeMain(i: number) {
    void makeMain(i);
  }
  /** "Measure this one" (a2b54fb6): this building measured from the address's stored order — no new charge. */
  function onMeasureThis(ring: ReadonlyArray<{ lat: number; lng: number }>) {
    void runInstant(false, reportInput(), pointOnRing(ring));
  }
  // The footprint the estimate prices on: EagleView's figure unless it
  // disagrees with the building's own outline by more than a tenth, in which
  // case the outline wins (lib/roofDiagram/instantTotals.footprintRead).
  const footprint = isSolar && solar ? { ...footprintRead(structure), sqft: solar.footprintSqft } : footprintRead(structure);
  const totals = inst
    ? !isSolar && includedStructures.length
      ? instantTotalsOf(includedStructures)
      : inst.totals
    : manual
      ? manualTotals(manual)
      : null;
  const siteAddress = measurement?.address ?? manual?.address ?? null;
  const solarEstimateNote = "Preliminary roof estimate. Area, pitch and linear quantities are estimated. Verify measurements on site before ordering materials.";
  // A large difference needs an area check. A ratio alone cannot establish
  // which provider selected the intended structure, so retain both sources.
  const googleSqft = measurement?.provenance?.googleAreaSqft ?? null;
  const evUndercount =
    !manual && !isSolar && totals?.areaSqft != null && googleSqft != null && googleSqft >= 400 && totals.areaSqft < googleSqft * 0.5
      ? { evSqft: totals.areaSqft, googleSqft, structures: measurement?.instant?.structures.length ?? 0 }
      : null;

  // Measured pitch (provenance.pitchMeasurement — the retired line's DSM
  // measurement, saved by the data path). Families are rounded to whole /12
  // for display, largest area first; the exact figures stay in provenance.
  const pitchRep = (measurement?.provenance as Record<string, unknown> | undefined)?.pitchMeasurement as
    | {
        source: "measured" | "instant";
        families: Array<{ pitch12: number; planSqft: number }>;
        trustedShare: number;
        instantPitch12?: number | null;
        disagrees?: boolean;
        reason?: string;
      }
    | undefined;
  const pitchMeasured = !isSolar && pitchRep?.source === "measured" && pitchRep.families.length > 0;
  // EagleView's published pitch for the MAIN structure (null without pack 002).
  const evPitch = manual || isSolar ? null : structure?.pitch ?? null;
  const solarPitch = solar?.pitchLabel ?? (isSolar ? inst?.totals.pitchLabel : null);
  // Where the pitch the page shows (and prices) comes from — never a default.
  const pitchKind: "measured" | "eagleview" | "solar" | "entered" | null = manual
    ? (manual.pitchLabel || pitchEntered ? "entered" : null)
    : solarPitch
      ? "solar"
    : pitchMeasured
      ? "measured"
      : evPitch
        ? "eagleview"
        : pitchEntered
          ? "entered"
          : null;
  const pitchLabelShown = manual
    ? manual.pitchLabel || pitchEntered || "—"
    : solar ? `${solar.predominantPitch12}/12` : solarPitch ?? displayedPitchLabel(pitchRep, evPitch) ?? pitchEntered ?? "—";
  const pitchHint =
    pitchKind === "solar"
      ? `rise / 12 · estimated${solar && solar.pitchFamilies.length > 1 ? " · mixed pitches" : ""}`
    : pitchKind === "measured"
      ? // How much of the roof is at each pitch (owner, 2026-10-13: "what does 60% mean?" — it was the share of the
        // roof the elevation data read cleanly, and it read like the share at that pitch).
        pitchSharesWords(pitchRep!.families)
      : pitchKind === "entered"
        ? "rise / 12 · entered by hand"
        : pitchKind === "eagleview"
          ? `rise / 12 · ${AERIAL.reported}`
          : measurement && !inst
            ? "drawing pipeline (legacy) · no source"
            : "pitch not available — enter pitch to price";
  // The pitch the estimate will be priced on, or null: no pitch, no estimate.
  const pitchForEstimate = pitchKind === "solar" ? solarPitch : pitchKind === "measured" ? `${Math.round(pitchRep!.families[0].pitch12)}/12` : pitchKind === "eagleview" ? evPitch : pitchKind === "entered" ? (manual ? manual.pitchLabel || pitchEntered : pitchEntered) : null;
  const eaveHeights = structure?.eaveHeightFt
    ? Object.entries(structure.eaveHeightFt).map(([facade, ft]) => ({ facade, ft }))
    : [];
  // Residential or commercial, as the contractor answered for this measurement.
  const useKey = manual ? null : measurement?.id && measurement.id !== "unsaved" ? measurement.id : null;
  // The answer given on this page wins (it also covers blocked storage);
  // otherwise the one saved for this measurement in this browser.
  const [pageUse, setPageUse] = React.useState<{ id: string | null; use: BuildingUse | null } | null>(null);
  const buildingUse: BuildingUse | null = pageUse && pageUse.id === useKey ? pageUse.use : readUseAnswer(useKey);
  const answerUse = (use: BuildingUse | null) => {
    if (useKey) writeUseAnswer(useKey, use);
    setPageUse({ id: useKey, use });
  };
  // What the package builder (and the AI draft) know about THIS roof. Pitch
  // families come from the measured elevation data when there is one, else
  // the single stated pitch; everything else is the main structure's own.
  const roofFacts: RoofFacts | null =
    totals?.squares != null
      ? {
          squares: totals.squares,
          squaresBasis: isSolar ? "estimated" : manual ? "entered" : "measured",
          pitchFamilies: (isSolar && solar
            ? solarPitchShares
          : pitchMeasured
            ? pitchFamilyShares(pitchRep!.families)
            : pitchForEstimate
              ? [{ pitch12: Number(pitchForEstimate.split("/")[0]), share: 1 }]
              : []
          ).filter((f) => Number.isFinite(f.pitch12)),
          pitchBasis: pitchKind === "entered" ? "entered" : pitchKind === "solar" ? "estimated" : pitchKind ? "measured" : null,
          // A ticked outbuilding joins the edges and the flashing counts, not
          // only the squares (review 2026-09-17: the barn's drip edge, starter
          // and vents were priced on the house's outline alone).
          perimeterFt: manual || isSolar ? null : sumOrNull(includedStructures.map((s) => ringPerimeterFt(s.outline))),
          // …and the MAIN structure still contributes the footprint the
          // provenance read settled on — EagleView's figure unless the
          // building's own outline disagrees by more than a tenth
          // (footprintRead). An outbuilding adds its own reported figure.
          footprintSqft: isSolar ? footprint.sqft : manual
            ? null
            : sumOrNull(
                includedStructures.map((s) => (s === structure ? footprint.sqft : s.footprintSqft ?? null)),
              ),
          chimney: manual || isSolar ? null : anyOrNull(includedStructures.map((s) => s.chimney ?? null)),
          rooftopAcCount: manual || isSolar ? null : sumOrNull(includedStructures.map((s) => s.rooftopAcCount ?? null)),
          shape: manual || isSolar ? null : structure?.shape ?? null,
          facetCount: manual || isSolar ? null : sumOrNull(includedStructures.map((s) => s.facetCount ?? null)),
          storeys: manual || isSolar ? null : storeysFromEaves(eaveHeights),
          measured: manual || isSolar ? null : report.state === "measured" ? report.footage ?? null : null,
          existingMaterial: manual || isSolar ? null : structure?.material ?? null,
          // The job's state for the brand picker: the roof's address, the intake's state, else the shop's own.
          state: (measurement?.state || stateCode || homeState || null)?.toUpperCase() ?? null,
          facetConfidence: manual || isSolar ? null : structure?.confidence?.facetCount ?? null,
          // The footprints the valleys are read off (every inside corner is one, 2026-10-13); the fallback's roof-plane
          // count stands in for a facet count there — an estimate, never a measured fact.
          outlines: manual || isSolar ? null : includedStructures.map((s) => s.outline).filter((r): r is Array<{ lat: number; lng: number }> => !!r && r.length >= 4),
          facetCountEstimated: isSolar ? solarFacetCount : null,
          buildingUse: manual ? null : buildingUse,
        }
      : null;
  // The lead's spec (above) is seeded once the hand takeoff's facts exist — the card keys a seed to its facts.
  const leadFactsKey = roofFacts ? factsKey(roofFacts) : null;
  React.useEffect(() => {
    if (!leadSpecRef.current || !leadFactsKey) return;
    setSeedSpec({ spec: leadSpecRef.current, key: leadFactsKey });
    leadSpecRef.current = null;
  }, [leadFactsKey]);
  // Does this roof read commercial? A weighted read of the roof, never a claim
  // about the building — the aerial data has no occupancy field — and the
  // contractor's answer is what prices anything (commercial.ts).
  const buildingRead =
    roofFacts && !manual
      ? readBuilding({
          facts: roofFacts,
          mainSquares: structure?.squares ?? (structure?.areaSqft != null ? structure.areaSqft / 100 : null),
          minEaveFt: eaveHeights.length ? Math.min(...eaveHeights.map((e) => e.ft)) : null,
          confidence: structure?.confidence ?? null,
          occlusion: structure?.occlusion ?? null,
          hasStructure: !!structure,
        })
      : null;
  const roofReadsFlat = !!roofFacts && isFlatRoof(roofFacts);
  // Lineal feet for the hero. The Instant packs carry no lengths at all:
  // these are MEASURED only when the full aerial report exists for the
  // address (ridge, hip, valley, eave and rake as flown); otherwise eave,
  // rake, ridge and hip are ESTIMATED from the outline and the roof shape,
  // and the valleys from the outline's inside corners (2026-10-13) — a dash
  // only when there is nothing to read them from.
  // The hero says the figure and its unit — nothing else. The first cut wrote
  // the provenance under each number ("estimated from outline", "not in
  // instant data"), and a contractor turning the screen to a client was
  // handing them a disclaimer (owner, 2026-09-14). Where every quantity came
  // from is still recorded where it is acted on: the Basis column on every
  // estimate line and the package's own assumptions.
  const edgeTiles = (() => {
    const mf = !isSolar && report.state === "measured" ? report.footage ?? null : null;
    if (mf) {
      return {
        edges: `${num(mf.eaveFt + mf.rakeFt)} ft`,
        ridge: `${num(mf.ridgeFt + mf.hipFt)} ft`,
        valley: `${num(mf.valleyFt)} ft`,
      };
    }
    const est = roofFacts && !manual ? estimateEdges(roofFacts) : null;
    if (est) {
      return {
        edges: `${num(est.eaveFt + est.rakeFt)} ft`,
        ridge: `${num(est.ridgeFt + est.hipFt)} ft`,
        valley: est.valleyFt != null ? `${num(est.valleyFt)} ft` : "—",
      };
    }
    return { edges: "—", ridge: "—", valley: "—" };
  })();
  // The provider's own score for the eave figure (one score for the whole
  // field, 0..1; "not scored" was dropped at parse). Identical classes on all
  // four sides read as suspicious — this says how much the provider itself
  // stands behind them.
  const propertyDetails = [
    { label: "Roof", value: roofReadsFlat ? "Flat / low slope" : null },
    { label: "Material", value: structure?.material },
    { label: "Condition", value: structure?.conditionRating },
    { label: "Roof age", value: structure?.roofAgeYears != null ? num(structure.roofAgeYears) + " yrs" : null },
    { label: "Chimney", value: structure?.chimney != null ? yesNo(structure.chimney) : null },
    { label: "Solar panels", value: structure?.solarPanels != null ? yesNo(structure.solarPanels) : null },
    { label: "Rooftop AC", value: structure?.rooftopAcCount },
  ].filter((detail) => detail.value != null && detail.value !== "");

  const hasDetails = !isSolar && (eaveHeights.length > 0 || !!structure || (measurement?.chimneys.length ?? 0) > 0);
  const reconDown = measurement?.provenance?.reconUnavailable ?? null;
  const partialCoverage = measurement?.provenance?.partialCoverage ?? null;
  const photoShown = view === "satellite" ? satPhoto : orthoPhoto;
  const photoError = view === "satellite" ? satErr : orthoErr;

  // The strip over the page while it works on a saved proposal.
  const linkedStrip = linked ? (
    <div className={"rf-linked" + (linked.lock ? " is-locked" : "")} data-roof-linked={linked.lock ? "locked" : "open"}>
      <div className="rf-linked-main">
        <span className="rf-linked-k">Editing</span>
        <b>{linked.ref}</b>
        <span className="rf-linked-t">{linked.title}</span>
        <span className="rf-linked-st">{PROPOSAL_STATUS_WORDS[linked.status] ?? linked.status}</span>
      </div>
      <p className="rf-linked-say">
        {linked.lock
          ? `This proposal is ${DECK_LOCK_WORDS[linked.lock]}, so its price stays as it is. Change anything here and Convert makes a new proposal.`
          : linkInfo?.loading
            ? "Opening its roof…"
            : linkInfo?.missing
              ? "Its measurement couldn't be opened — measure the address again (or open one from Recent), then Update puts the new lines on this proposal."
              : `Change anything — the roof, the choices, the lines — then Update ${linked.ref} re-prices this proposal.${linkInfo?.others ? ` ${linkInfo.others} line${linkInfo.others === 1 ? "" : "s"} you added in the proposal stay${linkInfo.others === 1 ? "s" : ""}.` : ""}${linkInfo?.older ? " It was made before choices were kept, so the builder starts from your usual ones; the lines are the proposal's." : ""}`}
      </p>
      {askUpdate ? (
        <div className="rf-linked-ask" role="alert" data-roof-update-confirm>
          <span>The client already has this proposal{linked.status === "VIEWED" ? " and opened it" : ""}. Updating changes what they see.</span>
          <button type="button" className="btn btn-primary btn--sm" data-roof-update-yes onClick={() => askUpdate.go()} disabled={convertBusy}>
            {convertBusy ? "Updating…" : `Update ${linked.ref}`}
          </button>
          <button type="button" className="btn btn-ghost btn--sm" onClick={() => setAskUpdate(null)} disabled={convertBusy}>
            Not now
          </button>
        </div>
      ) : null}
      <div className="rf-linked-acts">
        <a className="btn btn-ghost btn--sm" href={`/dashboard/proposals/${encodeURIComponent(linked.id)}`} data-roof-linked-back>
          Back to the proposal
        </a>
        {!linked.lock && hasEstimate ? (
          <button type="button" className="btn btn-ghost btn--sm" data-roof-convert-new disabled={convertBusy || isRecon || sampleEstimate} onClick={() => void convertWith({ title, materials, labor, assumptions, scope: scopeText }, { asNew: true })}>
            Save as a new proposal
          </button>
        ) : null}
      </div>
    </div>
  ) : null;

  // Leaving for Manage roof types: keep where this estimate stands (see RETURN_KEY). Read at the click, from the
  // latest render — the ref is refreshed after every render.
  const keepReturnRef = React.useRef<() => void>(() => {});
  React.useEffect(() => {
    keepReturnRef.current = () => {
      if (!measurement || measurement.id === "unsaved" || manual) return;
      const plain = (l: EditableLine) => ({ name: l.name, quantity: l.quantity, unitPrice: l.unitPrice, unit: l.unit ?? "" });
      const keep: RoofReturn = {
        id: measurement.id,
        at: nowMs(),
        extra: [...extra],
        pitchEntered,
        spec: lastSpecRef.current,
        factsKey: roofFacts ? factsKey(roofFacts) : null,
        materials: materials.map(plain),
        labor: labor.map(plain),
        title,
        scope: scopeText,
        assumptions,
        tablesEdited,
      };
      try {
        window.sessionStorage.setItem(RETURN_KEY, JSON.stringify(keep));
      } catch {}
    };
  });
  React.useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.('a[href*="/roof-estimator/inventory"]');
      if (a) keepReturnRef.current();
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  return (
    <>
      {linkedStrip}
      {/* ===== INTAKE: measure a roof ===== */}
      <section className={"ppanel" + (panel === "intake" ? "" : " is-hidden")} data-panel="intake" data-tour="roof-intake">
        <div className="card rf-card">
          <div className="rf-head rf-head--bar">
            <div>
              <div className="card-title">Measure a roof</div>
              <div className="card-sub">
                Enter an address to measure the roof and build an estimate.
              </div>
            </div>
          </div>

          <form
            className="rf-body"
            onSubmit={(e) => {
              e.preventDefault();
              void runMeasurement();
            }}
          >
            <div className="addr-grid">
              <label className="est-field addr-wide" data-tour="roof-address">
                <span className="est-lbl">Address</span>
                <input ref={addrRef} className="est-in" id="addr" name="roof-location-query" type="search" placeholder="4812 Maple Ave" autoComplete="new-password" aria-describedby="rf-address-status" />
              </label>
              <label className="est-field">
                <span className="est-lbl">City</span>
                <input className="est-in" id="city" placeholder="Bothell" value={city} onChange={(e) => setCity(e.target.value)} />
              </label>
              <label className="est-field est-field--sm">
                <span className="est-lbl">State</span>
                <span className="bp-sel">
                  <select
                    className="bp-sel-in est-in"
                    id="state"
                    value={stateCode}
                    data-empty={stateCode ? undefined : "1"}
                    onChange={(e) => setStateCode(e.target.value)}
                  >
                    <option value="">State…</option>
                    {STATES.map((st) => (
                      <option key={st}>{st}</option>
                    ))}
                  </select>
                </span>
              </label>
              <label className="est-field est-field--sm">
                <span className="est-lbl">ZIP</span>
                <input className="est-in" id="zip" placeholder="98011" inputMode="numeric" autoComplete="off" value={zip} onChange={(e) => setZip(e.target.value)} />
              </label>
            </div>
            <div id="rf-address-status" className="rf-address-status" role="status" aria-live="polite">
              {addressLoading ? (
                <><span className="rf-status-dot" />Loading address details and roof pin…</>
              ) : locating ? (
                <><span className="rf-status-dot" />Finding the address on the map…</>
              ) : null}
            </div>
            {/* Typed out, not picked (2026-10-26): the suggestion carries the exact point; say so under the field. */}
            {picked?.typed && picked.address.trim().length > 2 && !addressLoading && (
              <p className="rf-note rf-typed-hint" data-rf-typed-hint>
                Pick the address from the list so we measure the right building.
              </p>
            )}
            {intakeError && (
              <div className="call warn rf-intake-error" role="alert" data-intake-error={intakeError.kind}>
                <div>
                  <span className="rf-stamp">
                    {intakeError.kind === "no-roof"
                      ? "NO ROOF IN THE ANSWER"
                      : intakeError.kind === "processing"
                        ? "STILL PROCESSING"
                        : intakeError.kind === "not-found"
                          ? "CHECK THE ADDRESS"
                          : intakeError.kind === "expired"
                            ? "ORDER NEVER ARRIVED"
                            : "COULDN’T MEASURE"}
                  </span>
                  {intakeError.text}
                  {intakeError.kind !== "failed" && intakeError.kind !== "not-found" && (
                    <span className="rf-use-acts">
                      <button
                        type="button"
                        className="btn btn-primary btn--sm"
                        disabled={busy}
                        onClick={() => void runInstant(intakeError.kind === "no-roof" || intakeError.kind === "expired", intakeError.target)}
                      >
                        {intakeError.kind === "no-roof" || intakeError.kind === "expired" ? "Order a new lookup — billed" : "Check again — free"}
                      </button>
                      {intakeError.kind === "processing" && intakeError.reorder && (
                        <button type="button" className="btn btn-ghost btn--sm" disabled={busy} onClick={() => void runInstant(true, intakeError.target)}>
                          Order a new lookup — billed
                        </button>
                      )}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Pin-on-the-roof check before measurement: the picked suggestion's rooftop point, or the geocoded
                point of an address typed out in full — dragged onto the building to measure (2026-10-26). */}
            {intakePin && (
              <AddressPinPreview
                lat={intakePin.lat}
                lng={intakePin.lng}
                label={intakePin.label}
                moved={intakePin.moved}
                onMove={(p) => setPin((cur) => (cur && cur.key === intakePin.key ? { ...cur, ...p, moved: true } : cur))}
              />
            )}

            <div className="rf-actions">
              <button className="btn btn-primary btn--sm" type="submit" id="instantBtn" data-tour="roof-measure" disabled={busy || addressLoading || !measurementEnabled}>
                <svg className="ic" aria-hidden="true"><use href="#i-roof" /></svg>
                {measurementBusy || instantBusy ? "Measuring…" : "Measure this roof"}
              </button>
            </div>
          </form>
        </div>

        {/* Recent measurements — reopen a saved measurement without paying again. */}
        <div className="card rf-card rf-recent-card">
          <div className="rf-head rf-head--bar">
            <div>
              <div className="card-title">Recent measurements</div>
            </div>
            {recent.length > 0 && <span className="chip">{recent.length} saved</span>}
          </div>
          {recent.length > 0 ? (
            <ul className="lf-list rf-recent" id="rfRecent">
              {recent.map((r) => {
                const chip = SOURCE_CHIP[r.source];
                const addr = [r.address, [r.city, r.state].filter(Boolean).join(", ")].filter(Boolean).join(", ");
                return (
                  <li key={r.id}>
                    <button
                      className="rf-recent-row"
                      type="button"
                      disabled={busy}
                      aria-busy={openingId === r.id || undefined}
                      onClick={() => openRecent(r.id)}
                    >
                      <span className="rf-recent-main">
                        <span className="rf-recent-addr">{addr || "Unnamed site"}</span>
                        <span className="rf-recent-meta">
                          {dateShort(r.createdAt)}
                          {r.predominantPitch ? ` · ${r.predominantPitch}` : ""}
                          {r.source !== "solar" && r.facetCount != null ? ` · ${r.facetCount} facets` : ""}
                          {r.source === "solar" ? " · preliminary" : ""}
                          {r.pitchKind === "legacy" ? " · drawing pipeline (legacy)" : ""}
                        </span>
                      </span>
                      <span className={"chip rf-recent-src " + chip.tone}>{chip.label}</span>
                      <span className="rf-recent-fig">
                        {r.squares != null ? num(r.squares, 1) : r.areaSqft != null ? num(r.areaSqft) : "—"}
                        <span>{r.squares != null ? "sq" : r.areaSqft != null ? "sq ft" : ""}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="rf-recent-empty">
              {recentBusy ? "Loading…" : recentError ? `Couldn’t load history — ${recentError}` : "No measurements yet — the first one lands here"}
            </div>
          )}
        </div>
      </section>

      {/* ===== MEASUREMENT IN PROGRESS ===== */}
      <section className={"ppanel" + (panel === "measuring" ? "" : " is-hidden")} data-panel="measuring" data-tour="roof-measuring">
        <div className="card rf-card measuring">
          <div className="ms-body">
            <div className="ms-num">{msReport}</div>
            <div className="ms-head">
              <div className="ms-stage" role="status" aria-live="polite">
                {measurementBusy ? "Measuring the roof…" : ms.done ? "Report ready" : `${stepLabel(Math.min(ms.step, MS_STEPS.length - 1))}…`}
              </div>
              {!measurementBusy && <div className="ms-pct">{ms.pct}%</div>}
            </div>
            {!measurementBusy && <>
            <div className="ms-track" role="progressbar" aria-label="Measurement progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={ms.pct}>
              <span className="ms-fill" style={{ width: `${ms.pct}%` }} />
            </div>
            <ol className="ms-steps" aria-label="Measurement steps">
              {MS_STEPS.map((label, i) => (
                <li key={label} className={"ms-step" + (ms.done || i < ms.step ? " is-done" : i === ms.step ? " is-active" : "")}>
                  <WorkSquare state={ms.done || i < ms.step ? "done" : i === ms.step ? "now" : "wait"} />
                  <span>{stepLabel(i, label)}</span>
                  <span className="ms-step-state">{ms.done || i < ms.step ? "done" : i === ms.step ? "in progress" : ""}</span>
                </li>
              ))}
            </ol>
            </>}
            {/* No description lines under the bars (owner, 2026-10-20). */}
            {holding && (
              <div className="ms-acts">
                <button type="button" className="btn btn-ghost btn--sm" id="msOpenNow" onClick={revealHeld}>
                  Open the report now
                </button>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ===== RESULT ===== */}
      <section className={"ppanel" + (panel === "report" && (measurement || manual) ? "" : " is-hidden")} data-panel="report" data-tour="roof-report">
        {(measurement || manual) && (
          <>
            {manual && (
              <div className="rf-notice">
                <div className="call info">
                  <div>
                    <span className="rf-stamp">GOOGLE AREA</span>
                    {num(manual.squares, 1)} squares from Google imagery. Confirm the area and enter the roof pitch below.
                  </div>
                </div>
              </div>
            )}
            {collectingShown && collectingShown !== "done" && !manual && (
              <div className="rf-notice">
                <div className={"call " + (collectingShown === "checking" ? "info" : "warn")} data-collecting={collectingShown}>
                  <div>
                    <span className="rf-stamp">{collectingShown === "checking" ? "STILL COLLECTING" : "NOT ALL IN YET"}</span>
                    {collectingShown === "checking"
                      ? `Part of this measurement is still being read${packsPendingList.length ? ` (${packNames(packsPendingList)})` : ""} — it loads here by itself as it lands, and the estimate prices once it is in. No need to measure again; nothing extra is charged.`
                      : "The rest of this measurement is taking longer than usual. Reopen it from Recent measurements later and it collects the rest without a new charge — or price on what is here with a pitch you enter."}
                  </div>
                </div>
              </div>
            )}
            {packsMissing && !manual && instantPacks && (
              <div className="rf-notice">
                <div className="call warn" data-packs-missing="1">
                  <div>
                    <span className="rf-stamp">NOT EVERYTHING WAS BOUGHT</span>
                    This answer is missing {packNames([...instantPacks.failed, ...instantPacks.missing])}
                    {instantPacks.denied.length ? `; the account is not entitled to ${packNames(instantPacks.denied)}` : ""}. The figures shown are
                    real; the missing packs can be ordered on their own — nothing already bought is bought again.
                    <span className="rf-use-acts">
                      <button type="button" className="btn btn-primary btn--sm" disabled={busy} onClick={() => void runInstant(true, reportInput())}>
                        Order the missing packs (billed)
                      </button>
                    </span>
                  </div>
                </div>
              </div>
            )}
            {buildingRead?.level && !buildingUse && (
              <div className="rf-notice">
                <div className="call info">
                  <div>
                    <span className="rf-stamp">{buildingRead.level === "confirm" ? "READS COMMERCIAL" : "COULD BE COMMERCIAL"}</span>
                    {buildingRead.level === "confirm"
                      ? `This roof reads like a commercial building: ${joinClauses(buildingRead.clauses)}. `
                      : `This could be a commercial building — ${joinClauses(buildingRead.clauses.slice(0, 2))}. `}
                    The aerial data doesn’t record how a building is used, so choose how to price it. Commercial adds
                    mobilization, a safety plan, a permit on the job value and general conditions, lowers field labor
                    per square on a big deck, and starts a flat roof from commercial defaults (R-25 insulation, parapet
                    coping, overflow drains, crane, a manufacturer’s warranty) — every row stays editable.
                    <span className="rf-use-acts">
                      <button type="button" className="btn btn-primary btn--sm" onClick={() => answerUse("commercial")}>
                        Price as commercial
                      </button>
                      <button type="button" className="btn btn-ghost btn--sm" onClick={() => answerUse("residential")}>
                        Price as residential
                      </button>
                    </span>
                  </div>
                </div>
              </div>
            )}
            {(builtByOldPipeline || unsaved || reconDown || partialCoverage || pitchRep?.disagrees) && (
              <div className="rf-notice">
                {builtByOldPipeline && (
                  <div className="call warn">
                    <div>
                      <span className="rf-stamp">MEASURED BY THE PREVIOUS PIPELINE</span>
                      This measurement was saved by the earlier drawing pipeline and is shown exactly as it was
                      recorded — reopening a measurement never re-measures it. Its figures are the aerial data’s
                      calibrated totals and remain valid.
                    </div>
                  </div>
                )}
                {reconDown && (
                  <div className="call warn">
                    <div>
                      <span className="rf-stamp">{reconDown.kind === "no-coverage" ? "NO ELEVATION DATA HERE" : "ELEVATION DATA NOT RECEIVED"}</span>
                      {reconDown.kind === "no-coverage"
                        ? "Google has no high-resolution elevation data for this address, so the elevation checks (coverage, measured pitch) are not available here. The measured totals above are unaffected."
                        : reconDown.kind === "config"
                          ? "The imagery service rejected our request — a setup problem on our side, not the address. The source-status figures (coverage, registration) are absent; the measured totals above are unaffected."
                          : "The elevation check for this address did not finish in time, so the source-status figures (coverage, registration) are absent. This is not a statement about the address — the measured totals above are unaffected. Measure again: the paid answer is reused, so the retry costs nothing."}
                      {reconDown.message && reconDown.kind !== "no-coverage" && <span className="rf-why">{reconDown.message}</span>}
                      {reconDown.kind !== "no-coverage" && reconDown.kind !== "config" && (
                        <button
                          type="button"
                          className="btn btn-primary btn--sm"
                          onClick={() => void runInstant(false, reportInput())}
                          disabled={instantBusy}
                        >
                          {instantBusy ? "Measuring…" : "Measure again — free"}
                        </button>
                      )}
                    </div>
                  </div>
                )}
                {partialCoverage && (
                  <div className="call warn">
                    <div>
                      <b>Part of the property was not measured.</b> {partialCoverage.reason} Only{" "}
                      {partialCoverage.measuredStructures}{" "}
                      {partialCoverage.measuredStructures === 1 ? "building is" : "buildings are"} included in the
                      figures below — check the aerial view and add anything missing by hand.
                    </div>
                  </div>
                )}
                {pitchRep?.disagrees && (
                  <div className="call info">
                    <div>
                      <b>Measured pitch differs from the reported figure.</b> The elevation data measures{" "}
                      {pitchRep.families[0].pitch12.toFixed(1)}/12 on this roof; the reported figure is{" "}
                      {pitchRep.instantPitch12}/12. The measured figure is shown; both are recorded.
                    </div>
                  </div>
                )}
                {unsaved && (
                  <div className="call warn">
                    <div>
                      <b>{isSolar ? "Estimated but not saved." : "Measured but not saved."}</b> The record could not be
                      written, so this measurement will not appear in Recent measurements.
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="card rf-hero" id="rfHero" data-tour="roof-hero">
              <HeroCell l="Total area" v={totals?.areaSqft != null ? num(totals.areaSqft) : "—"} h={isSolar ? "sq ft · estimated" : "sq ft"} />
              <HeroCell l="Roofing squares" v={totals?.squares != null ? num(totals.squares, 1) : "—"} h="× 100 sq ft" accent />
              <HeroCell l="Roof pitch" v={pitchLabelShown} h={pitchHint} />
              <HeroCell
                l="Roof facets"
                v={isSolar
                  ? (solarFacetCount != null ? `≈${solarFacetCount}` : "—")
                  : totals?.facetCount != null
                    ? String(totals.facetCount)
                    : segmentFacetEstimate != null
                      ? `≈${segmentFacetEstimate}`
                      : "—"}
                h={isSolar
                  ? (solarFacetCount != null ? "estimated planes" : "unavailable")
                  : totals?.facetCount != null
                    ? "planes"
                    : segmentFacetEstimate != null
                      ? "estimated planes"
                      : "not in this data"}
              />
              <HeroCell l="Eaves + rakes" v={edgeTiles.edges} h={isSolar ? "linear ft · estimated" : "linear ft"} />
              <HeroCell l="Ridge + hips" v={edgeTiles.ridge} h={isSolar ? "linear ft · estimated" : "linear ft"} />
              <HeroCell l="Valleys" v={edgeTiles.valley} h={isSolar ? "linear ft · estimated" : "linear ft"} />
            </div>
            {measurement && (
            <div className="rf-grid">
              <div className="card rf-card rf-viewer">
                <div className="rf-head rf-head--bar">
                  <div>
                    {/* What the card holds, not where the picture comes from (owner, 2026-10-12): the aerial report's
                        measurement, or — when the roof was read from free elevation data — an estimate. */}
                    <div className="card-title" id="vwTitle">{isSolar || measurement.source === "recon" ? "Roof estimate" : "Aerial measurement"}</div>
                    <div className="card-sub" id="vwSub">
                      {[measurement.address, [measurement.city, measurement.state].filter(Boolean).join(" ")].filter(Boolean).join(", ") || "Roof"}
                      {savedId ? ` · ${isSolar ? "ESTIMATE" : "DRAWING"} № RM-${savedId.slice(-6).toUpperCase()}` : ""}
                    </div>
                  </div>
                  <div className="vw-controls">
                    {/* The 2D|3D switch, verbatim — only the labels changed. */}
                    <div className="vsw" id="viewSwitch" role="radiogroup" aria-label="Photo source">
                      {([...(hasOrtho ? (["ortho"] as const) : []), "satellite"] as PhotoView[]).map((v) => (
                        <button
                          key={v}
                          className={"vsw-btn" + (view === v ? " active" : "")}
                          type="button"
                          role="radio"
                          aria-checked={view === v}
                          onClick={() => switchView(v)}
                        >
                          {v === "satellite" ? "Map" : AERIAL.ortho}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="rf-canvas rf-canvas--live" id="rfCanvas">
                  {/* `.rfx` exempts the viewer from the donor reset; `.rf-stage`
                      gives the photo the same fixed box the drawing had. */}
                  <div className="rfx rf-stage">
                    {/* The live map stays mounted across the tab switch so the
                        user's pan/zoom survives a look at the ortho. */}
                    {liveMap && <div ref={mapHostRef} className="rf-map" hidden={view !== "satellite"} aria-label="Map of the address" />}
                    {liveMap && view === "satellite" && (
                      <button
                        type="button"
                        className="rf-home"
                        onClick={recenterMap}
                        title="Back to the house"
                        aria-label="Back to the house"
                      >
                        <svg className="ic"><use href="#i-roof" /></svg>
                      </button>
                    )}
                    {(view === "ortho" || !liveMap) && (photoShown ? (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element -- data: URL from the server-side photo cache; next/image adds nothing here */}
                        <img
                          src={photoShown}
                          alt={view === "satellite" ? "Map of the address" : AERIAL.ortho}
                          className="rf-photo"
                        />
                        {/* The static photo is CENTERED on the measured point
                            (getMeasurementPhoto: center=lat,lng), so a pin
                            anchored to the stage's centre is exact. Ortho is
                            EagleView's own crop — no such guarantee, no pin. */}
                        {view === "satellite" && (
                          <div className="rf-pin-center" aria-hidden="true">
                            <svg viewBox="0 0 24 24">
                              <path d={PIN_PATH} fill="currentColor" stroke="#0a0a0a" strokeWidth="1.5" strokeLinejoin="round" />
                              <circle cx="12" cy="9" r="2.6" fill="#fff" stroke="#0a0a0a" strokeWidth="1" />
                            </svg>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="rf-3d-loading">
                        {photoBusy ? "Loading photo…" : photoError ? `Photo unavailable — ${photoError}` : " "}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rf-legend" id="rfLegend">
                  <span className="lg">
                    {view === "satellite"
                      ? `Map of the address · the pin marks ${isSolar ? "the selected building" : "the measured roof"}${liveMap ? " · drag to pan · scroll to zoom" : ""}`
                      : `${AERIAL.ortho}${orthoShotDate ? ` · ${orthoShotDate}` : ""} · the photo the measurement was taken from`}
                  </span>
                </div>
              </div>

              <div className="rf-side">
                {isSolar && (
                  <details key={measurement.id} className="card rf-card rf-measurement-details" data-solar-estimate="1">
                    <summary className="rf-head"><span className="card-title">Measurement details</span></summary>
                    <div className="rf-details">
                      <dl>
                        <div className="rf-details-row"><dt>Imagery date</dt><dd>{solar?.imageryDate ?? "Unavailable"}</dd></div>
                        <div className="rf-details-row"><dt>Imagery quality</dt><dd>{solar?.imageryQuality ?? "Unavailable"}</dd></div>
                        <div className="rf-details-row"><dt>Building footprint</dt><dd>{footprint.sqft != null ? `${num(footprint.sqft)} sq ft` : "Unavailable"}</dd></div>
                        <div className="rf-details-row"><dt>Roof facets (estimated)</dt><dd>{solarFacetCount != null ? `≈${solarFacetCount}` : "Unavailable"}</dd></div>
                        {solar && <div className="rf-details-row"><dt>Area method</dt><dd>{solar.areaMethod === "google-ground-area-ratio" ? "Adjusted for building footprint" : "Modeled roof area"}</dd></div>}
                      </dl>
                    </div>
                  </details>
                )}
                {hasDetails && (
                  <div className="card rf-card">
                    <div className="rf-head">
                      <div className="card-title">Details</div>
                    </div>
                    <div className="rf-details" id="rfDetails">
                      {eaveHeights.length > 0 && (
                        <section className="rf-detail-section" aria-label="Eave height">
                          <div className="rf-detail-heading">
                            <h3>Eave height</h3>
                          </div>
                          <p className="rf-details-note">Ground to roof edge · reported in 10 ft steps.</p>
                          <dl className="rf-eave-grid">
                            {eaveHeights.map((e) => (
                              <div key={e.facade}>
                                <dt>{FACADE[e.facade] ?? e.facade}</dt>
                                <dd>{num(e.ft)} <span>ft</span></dd>
                              </div>
                            ))}
                          </dl>
                        </section>
                      )}
                      {propertyDetails.length > 0 && (
                        <section className="rf-detail-section" aria-label="Roof details">
                          <h3 className="rf-detail-heading">Roof details</h3>
                          <dl>
                            {propertyDetails.map((detail) => (
                              <div className="rf-details-row" key={detail.label}>
                                <dt>{detail.label}</dt><dd>{detail.value}</dd>
                              </div>
                            ))}
                          </dl>
                        </section>
                      )}
                      {!eaveHeights.length && !propertyDetails.length && <p className="rf-details-note">Property details unavailable for this roof.</p>}
                      {buildingUse && (
                        <div className="rf-detail-section rf-detail-use">
                          <span>{buildingUse === "commercial" ? "Commercial" : "Residential"} pricing</span>
                          <button type="button" className="rf-dd-link" onClick={() => answerUse(buildingUse === "commercial" ? "residential" : "commercial")}>Change</button>
                        </div>
                      )}
                      {measurement.chimneys.length > 0 && (
                        <section className="rf-detail-section" aria-label="Detected penetrations">
                          <h3 className="rf-detail-heading">Detected penetrations</h3>
                          <dl>
                            {measurement.chimneys.map((c, i) => (
                              <div className="rf-details-row" key={i}>
                                <dt>{c.kind.charAt(0).toUpperCase() + c.kind.slice(1)}</dt>
                                <dd>Detected</dd>
                              </div>
                            ))}
                          </dl>
                        </section>
                      )}
                    </div>
                  </div>
                )}
                {!isSolar && <div className="card rf-card rf-structures">
                  <div className="rf-head">
                    <div className="card-title">Structures</div>
                    <div className="card-sub">
                      {structure
                        ? includedOrder.length > 1
                          ? `${includedOrder.length} buildings in the estimate · ${num(totals?.areaSqft ?? 0)} sq ft`
                          : `Main building ${structure.areaSqft != null ? num(structure.areaSqft) + " sq ft" : "— no area"}${footprint.sqft != null ? ` · footprint ${num(footprint.sqft)} sq ft${footprint.source === "outline" ? " (outline)" : ""}` : ""}`
                        : `${measurement.instant?.structures.length ?? 0} on the property`}
                    </div>
                    {structure && MAIN_HOW_WORDS[mainPick.how] && <div className="rf-pick" data-rf-pick={mainPick.how}>{MAIN_HOW_WORDS[mainPick.how]}</div>}
                  </div>
                  {structure && mainPick.index != null && (() => {
                    // Folded when there are many (owner, 2026-10-16): the first few of this lot's buildings, anything
                    // ticked, and the rest behind one button. A building the parcel check put outside the lot is a
                    // neighbour's — said so on its row and counted apart, never as "on the parcel".
                    const mainAt = mainPick.index;
                    // The buildings in the estimate stand together under the main one, numbered in turn; the rest
                    // follow under their own heading — a tick moves a row up, an untick moves it back.
                    const inEst = otherStructures.filter((o) => extra.has(o.i));
                    const rest = otherStructures.filter((o) => !extra.has(o.i));
                    const onLot = rest.filter((o) => !o.offLot);
                    const offLot = rest.filter((o) => o.offLot);
                    const folds = rest.length > BUILDINGS_SHOWN + 1;
                    const visible = (o: (typeof otherStructures)[number], k: number) => allBuildings || !folds || o.i === focusBuilding || (!o.offLot && k < BUILDINGS_SHOWN);
                    const hidden = rest.filter((o, k) => !visible(o, k)).length;
                    const mapOn = liveMap && !!mapReadyFor;
                    const total = includedOrder.length;
                    // One row of the list (StructureRow below), the page's handlers handed in.
                    const otherRow = (o: (typeof otherStructures)[number]) => (
                      <StructureRow
                        o={o}
                        n={numberOf(o.i)}
                        total={total}
                        ticked={extra.has(o.i)}
                        focus={focusBuilding === o.i}
                        canMakeMain={!!savedId}
                        makeMainBusy={mainBusy === o.i}
                        makeMainDisabled={mainBusy != null || busy}
                        showOnMapButton={mapOn && (o.s.outline?.length ?? 0) >= 3}
                        noLocationNote={extra.has(o.i) && liveMap && view === "satellite" && (o.s.outline?.length ?? 0) < 3}
                        measureThis={SHOW_MEASURE_THIS && !o.offLot && evEnabled && (o.s.outline?.length ?? 0) >= 3}
                        busy={busy}
                        onTick={onTickBuilding}
                        onMakeMain={onMakeMain}
                        onShowOnMap={showOnMap}
                        onMeasureThis={onMeasureThis}
                      />
                    );
                    return (
                      /* The Details card's own <dl> rhythm: the main building first, numbered 1, and the ticked ones after
                         it; then the others, each a drawn checkbox with "Make main" beside it. */
                      <dl className="rf-details rf-others" data-rf-others data-folded={folds && !allBuildings ? "1" : "0"}>
                        <div className="rf-details-sec">In the estimate{total > 1 ? ` · ${total}` : ""}</div>
                        <div
                          className={"rf-details-row rf-main-row" + (focusBuilding === mainAt ? " is-focus" : "")}
                          data-structure={mainAt}
                          data-structure-main
                          data-building={1}
                        >
                          <dt>
                            <span className="rf-main-name">
                              <span className="rf-swatch" style={{ background: MAIN_COLOR }} aria-hidden="true" />
                              Main · Building 1 of {total}
                            </span>
                            {mapOn && (structure.outline?.length ?? 0) >= 3 ? (
                              <button type="button" className={"rf-locate" + (focusBuilding === mainAt ? " is-on" : "")} onClick={() => showOnMap(mainAt)} aria-label="Show the main building on the map" data-rf-locate={1}>
                                Show on map
                              </button>
                            ) : null}
                          </dt>
                          <dd>
                            {structure.areaSqft != null ? num(structure.areaSqft) : "—"}
                            <span>sq ft</span>
                            {structure.pitch && <span>· {structure.pitch}</span>}
                          </dd>
                        </div>
                        {inEst.map((o) => (
                          <React.Fragment key={o.i}>{otherRow(o)}</React.Fragment>
                        ))}
                        {rest.length > 0 && (
                          <>
                            <div className="rf-details-sec">
                              {onLot.length
                                ? <>Other structures on the parcel · {onLot.length} · {num(onLot.reduce((a, { s }) => a + (s.areaSqft ?? 0), 0))} sq ft</>
                                : <>No other structures on this lot</>}
                            </div>
                            {offLot.length > 0 && (
                              <div className="rf-note rf-offlot-note" data-rf-offlot>
                                {offLot.length} nearby {offLot.length === 1 ? "building is" : "buildings are"} outside this lot — a neighbour&rsquo;s, not part of this property, and not in the estimate.
                              </div>
                            )}
                            <div className="rf-note">
                              Tick a building to add it to the estimate{savedId ? ", or make it the main building" : ""}{mapOn ? " — or click it on the map" : ""}.
                            </div>
                            {rest.map((o, k) => {
                              if (!visible(o, k)) return null;
                              const firstOff = o.offLot && rest.findIndex((x) => x.offLot) === k;
                              return (
                                <React.Fragment key={o.i}>
                                  {firstOff && onLot.length > 0 && <div className="rf-details-sec rf-offlot-sec">Outside this lot · {offLot.length}</div>}
                                  {otherRow(o)}
                                </React.Fragment>
                              );
                            })}
                            {folds && (hidden > 0 || allBuildings) && (
                              <div className="rf-fold">
                                <button type="button" className="rf-fold-btn" onClick={() => setAllBuildings((v) => !v)} aria-expanded={allBuildings} data-rf-fold>
                                  {allBuildings ? "Show fewer" : `Show ${hidden} more building${hidden === 1 ? "" : "s"}${offLot.length && onLot.length <= BUILDINGS_SHOWN ? " — outside this lot" : ""}`}
                                </button>
                              </div>
                            )}
                          </>
                        )}
                      </dl>
                    );
                  })()}
                </div>}
              </div>
            </div>
            )}

            {/* Admin preview (owner, 2026-11-12: "add to roof estimator diagram … only at admin account"): the roof's
                facets and lines as lib/roofFacets draws them. Platform admins only — a contractor gets no card. */}
            {roofDiagramPreview && measurement && savedId ? <RoofDiagramPreview key={savedId} measurementId={savedId} /> : null}

            <BuildEstimateCardSwitch
              isRecon={isRecon}
              squares={totals?.squares ?? null}
              manual={manual ? { squares: manual.squares, pitchLabel: manual.pitchLabel } : null}
              buildMode={buildMode}
              onBuildMode={setBuildMode}
              waste={waste}
              onWaste={setWaste}
              wasteOptions={WASTE_OPTIONS}
              aiEnabled={aiEnabled}
              waiting={packsPending ? "Still reading the pitch and details — the estimate prices once they land." : null}
              pitchEntry={
                /* EagleView supplied no pitch (pack 002 not bought): the
                   contractor states one, and the estimate says so. Not while
                   the pitch pack is still on its way. */
                !(manual?.pitchLabel) && !pitchMeasured && !evPitch && !solarPitch && totals?.squares != null && !packsPending
                  ? { value: pitchEntered, onChange: setPitchEntered, options: PITCHES }
                  : null
              }
              generate={{
                busy: genBusy,
                disabled: isRecon || genBusy || totals?.squares == null || !pitchForEstimate || packsPending,
                reason: packsPending
                  ? "Still reading the pitch and details."
                  : !pitchForEstimate
                    ? "Enter the pitch first — the measurement has none for this roof."
                    : undefined,
                onClick: () => void generate(),
              }}
              caution={
                /* Doubtful figures warn on the card; they no longer freeze the
                   builder, Generate or Convert (owner, 2026-09-12). The full
                   account stays in the notice above. */
                evUndercount
                  ? {
                      stamp: "Check roof area",
                      text: `Aerial report: ${num(evUndercount.evSqft)} sq ft · Google: ${num(evUndercount.googleSqft)} sq ft. Confirm the roof before pricing.`,
                      action: {
                        label: "Use Google area & enter pitch",
                        onClick: () =>
                          runManual({
                            squares: evUndercount.googleSqft / 100,
                            pitchLabel: "",
                            address: siteAddress,
                          }),
                      },
                    }
                  : null
              }
              facts={roofFacts}
              onBuildingUse={manual ? undefined : answerUse}
              report={
                measurement && !manual && !isRecon && !isSolar
                  ? { state: report.state, reportId: report.reportId ?? null, status: report.status ?? null, busy: reportBusy, onOrder: () => void orderFullReport(), onCheck: () => void checkReport() }
                  : null
              }
              builderDisabled={convertBusy}
              converting={convertBusy}
              onBuild={applyPackage}
              onConvert={convertPackage}
              seedSpec={seedSpec}
              convertLabel={linked && !linked.lock ? `Update ${linked.ref}` : undefined}
              hasEstimate={hasEstimate}
              output={
                <div className={"build-out" + (hasEstimate ? "" : " is-hidden")} id="buildOut">
                  {hasEstimate && (
                    <>
                      <EstimateLinesTable title="Materials" rows={materials} onChange={(rows) => { setMaterials(rows); setTablesEdited(true); }} disabled={convertBusy} addLabel="Add material" />
                      <EstimateLinesTable title="Labor" rows={labor} onChange={(rows) => { setLabor(rows); setTablesEdited(true); }} disabled={convertBusy} addLabel="Add labor" />
                      <InventoryLinkChoice trade="roof" value={invLink} onChange={setInvLink} />
                      {sampleEstimate && (
                        <p className="bo-sample" role="note">
                          Sample lines — AI is off on this server, so these are placeholder figures. Build the package above for a priced estimate; sample lines can’t become a proposal.
                        </p>
                      )}
                      {assumptions.length > 0 && (
                        <div className="bo-assume">
                          <span className="kpi-lbl">Assumptions</span>
                          <ul>
                            {assumptions.map((a, i) => (
                              <li key={i}>{a}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      <div className="bo-total">
                        <span className="kpi-lbl">Estimate total</span>
                        <span className="bo-total-v">{money(materialsTotal + laborTotal)}</span>
                        <span className="bo-total-acts">
                          <button
                            className="btn btn-primary btn--sm"
                            type="button"
                            id="convertBtn"
                            data-tour="roof-convert-lines"
                            disabled={convertBusy || isRecon || sampleEstimate}
                            title={sampleEstimate ? "Sample lines (AI is off) can’t become a proposal — build the package instead." : linked && !linked.lock ? `Put these lines on ${linked.ref}` : "Create a draft proposal from these lines"}
                            onClick={() => void convert()}
                          >
                            <svg className="ic"><use href="#i-file" /></svg>
                            {linked && !linked.lock ? (convertBusy ? "Updating…" : `Update ${linked.ref}`) : convertBusy ? "Creating…" : "Convert to proposal"}
                          </button>
                        </span>
                      </div>
                    </>
                  )}
                </div>
              }
            />
          </>
        )}
      </section>

      <AgainPortal
        show={panel === "report"}
        disabled={busy}
        onClick={() => {
          setPanel("intake");
          window.requestAnimationFrame(() => addrRef.current?.focus());
        }}
        showRemeasure={panel === "report" && !manual && !isSolar && evEnabled && reusedInstant != null}
        remeasureLabel={packsMissing ? "Order the missing packs (billed)" : "Re-measure (new paid lookup)"}
        onRemeasure={() => void runInstant(true, reportInput())}
      />
      {/* The photo CARD is square (owner's call): the card hugs the square
          stage, head and caption ride above/below it, and DETAILS/STRUCTURES
          move up beside it in the same grid row — no black bars, no holes.
          A non-square ortho is centre-cropped to fill (cover), never
          letterboxed. On handheld the square goes full-width, details under.
          --sq sizes the square: bigger than the old 460px viewer (owner's
          call), scaling with the window so DETAILS keeps a real column. */}
      <style jsx global>{`
        .jf-blueprint .content .rf-grid {
          grid-template-columns: auto minmax(0, 1fr);
        }
        .jf-blueprint .content .rf-viewer {
          --sq: clamp(460px, 42vw, 680px);
          width: calc(var(--sq) + 3px);
          max-width: 100%;
        }
        .jf-blueprint .content .rf-viewer .card-sub {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 100%;
        }
        .jf-blueprint .content .rf-canvas--live .rf-stage {
          width: var(--sq);
          height: var(--sq);
          max-width: 100%;
        }
        .jf-blueprint .content .rf-stage .rf-photo {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }
        .jf-blueprint .content .rf-stage .rf-map {
          width: 100%;
          height: 100%;
        }
        .jf-blueprint .content .rf-stage .rf-map[hidden] {
          display: none;
        }
        /* Back-to-the-house: top-right of the stage, clear of Google's
           bottom-right zoom control; the vsw's own hairline language. */
        .jf-blueprint .content .rf-stage .rf-home {
          position: absolute;
          top: 12px;
          right: 12px;
          z-index: 5;
          width: 44px;
          height: 44px;
          display: grid;
          place-items: center;
          padding: 0;
          background: #fff;
          border: 1.5px solid var(--hair-soft);
          border-radius: var(--radius);
          color: var(--ink);
          cursor: pointer;
          box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
          transition: background 0.12s;
        }
        .jf-blueprint .content .rf-stage .rf-home:hover {
          background: var(--paper-deep);
        }
        /* Centre-anchored pin over the STATIC satellite photo (the photo is
           centred on the measured point). Tip of the pin sits on the exact
           centre. Drawn in the house colours — blueprint fill, ink frame —
           the same marker the live map and the intake preview use. */
        .jf-blueprint .content .rf-stage .rf-pin-center {
          position: absolute;
          left: 50%;
          top: 50%;
          transform: translate(-50%, -100%);
          z-index: 4;
          pointer-events: none;
          color: var(--blueprint);
          filter: drop-shadow(1px 2px 2px rgba(10, 10, 10, 0.45));
        }
        .jf-blueprint .content .rf-stage .rf-pin-center svg {
          display: block;
          width: 30px;
          height: 30px;
        }
        .jf-blueprint .content .rf-stage .rf-home .ic {
          width: 19px;
          height: 19px;
        }
        @media (max-width: 1100px) {
          .jf-blueprint .content .rf-grid {
            grid-template-columns: minmax(0, 1fr);
          }
          .jf-blueprint .content .rf-viewer {
            width: auto;
          }
          .jf-blueprint .content .rf-canvas--live .rf-stage {
            width: 100%;
            height: auto;
            aspect-ratio: 1 / 1;
          }
        }
      `}</style>
    </>
  );
}

function HeroCell({ l, v, h, accent }: { l: string; v: string; h: string; accent?: boolean }) {
  return (
    <div className="hero-cell">
      <div className="kpi-lbl">{l}</div>
      <div className={"hero-v" + (accent ? " accent" : "")}>{v}</div>
      <div className="hero-h">{h}</div>
    </div>
  );
}

// The donor's "Measure another" button sits in `.page-actions` inside
// `.page-head`, which content.tsx renders above this component. Rendering it
// there from here keeps one source of truth for the panel state.
function AgainPortal({
  show,
  disabled,
  onClick,
  showRemeasure,
  remeasureLabel,
  onRemeasure,
}: {
  show: boolean;
  disabled?: boolean;
  onClick: () => void;
  /** The shown result reused an already-paid answer — offer the explicit paid re-order. */
  showRemeasure?: boolean;
  remeasureLabel?: string;
  onRemeasure?: () => void;
}) {
  // The host is a sibling in the same React tree, so it exists by the time this
  // commits; the store only exists to defer the lookup past SSR/hydration.
  const host = React.useSyncExternalStore(
    () => () => {},
    () => document.querySelector<HTMLElement>(".jf-blueprint .content #rfAgainHost"),
    () => null,
  );
  if (!host) return null;
  return createPortal(
    <>
      {showRemeasure && onRemeasure && (
        <button
          className={"btn btn-ghost" + (show ? "" : " is-hidden")}
          type="button"
          id="remeasureBtn"
          disabled={disabled}
          onClick={onRemeasure}
          title="This result reused already-paid aerial data. A new order is billed; packs the address already has are not bought again."
        >
          <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M20 7v5h-5M20 12a8 8 0 1 0-2 6" /></svg>
          {remeasureLabel ?? "Re-measure (new paid lookup)"}
        </button>
      )}
      <button className={"btn btn-ghost" + (show ? "" : " is-hidden")} type="button" id="againBtn" disabled={disabled} onClick={onClick}>
        <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="10" cy="10" r="6" /><path d="m15 15 6 6" /></svg>
        Measure another
      </button>
    </>,
    host,
  );
}
