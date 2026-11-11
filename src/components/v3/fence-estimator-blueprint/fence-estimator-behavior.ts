// Fence estimator blueprint — runtime behaviors, ported verbatim from the donor
// file's <script> (jobflex-fence-estimator-blueprint_7.html). Every duration,
// easing, stagger, formula, price and rendered string is the donor's exact
// value. Adaptations are mechanical only:
// - `document.getElementById(...)` becomes a query against the mounted
//   `.content` root, which the shared shell owns and re-fills on navigation;
// - the delegated click/input/change listeners stay on `document` (that is what
//   makes a click anywhere dismiss the Gate/Door popovers) but are tracked for
//   unmount cleanup, together with every timer and observer;
// - the donor's chrome modules (matchMedia polyfill, mobile nav drawer, FLUID
//   SCALE, the sidebar entry cascade, the sliding active indicator and the
//   graph-paper parallax) are NOT ported here — the shared shell
//   (components/v3/blueprint-shell/shell-behavior.ts) already owns all of them;
// - the donor's `safe(name, fn)` try/catch wrapper is dropped: the modules it
//   guarded are either shell-owned or replaced by strict null checks below.

import { BOARD_GRADES, POST_SYSTEMS, POST_SYSTEM_ORDER } from "@/lib/fence/pricing";
import type { BoardGrade, PostSystem } from "@/lib/fence/takeoff";
import { isMapsBrowserEnabled, loadMapsLibrary } from "@/lib/googleMaps";
import { leaveRow, staggerIn } from "@/components/v3/blueprint-shell/list-motion";
import { attachPlacesSuggest, type PickedPlace } from "@/components/v3/blueprint-shell/places-suggest";
import type { WebFenceSeed } from "@/lib/webHandoff";
import { mountIsland, type Island } from "@/components/v3/blueprint-shell/react-island";
import {
  FenceDrawMap,
  type DraftState,
  type FenceDrawMapApi,
  type FenceDrawMapProps,
  type TerrainSegView,
} from "@/components/estimator/fence/FenceDrawMap";
import {
  mergeBuildings,
  ringAreaSqFt,
  wallMountsFor,
  type DrawnHouse,
} from "@/components/estimator/fence/fenceHouse";
import type { BayClass } from "@/components/estimator/fence/fenceGeometry";
import {
  sampleFencePath,
  terrainFromProfile,
  terrainAssumption,
  MIN_PROFILED_SEG_FT,
  type FenceTerrainReport,
  type SegTerrain,
} from "@/components/estimator/fence/fenceTerrain";
import {
  boxContains,
  boxOf,
  buildLotTopo,
  gridFromSamples,
  lineGradeOnGrid,
  padBox,
  planBox,
  planTopoGrid,
  topoSamplePoints,
  unionBox,
  type LotTopo,
  type TopoBox,
  type TopoGridPlan,
} from "@/components/estimator/fence/fenceTopo";
import { fetchElevationProfile, type ElevationProfileResult, type ElevationSource } from "@/actions/fenceTerrain";
import {
  buildingsToFootprints,
  latLngToLocalFeet,
  localFeetToLatLng,
  pointInRingFt,
} from "@/components/estimator/fence/mapProjection";
import type {
  BuildingFootprint,
  GateSpec,
  OpeningKind,
  PathPoint,
} from "@/components/estimator/fence/fenceTypes";
// Type-only: the component itself arrives through a dynamic import so Three.js
// stays off the initial bundle of a page whose primary surface is a map.
import type { FenceModel3D, FenceTerrain3D } from "@/components/estimator/fence/FenceModel3D";
import type { FencePlan } from "@/lib/fence/planSvg";
import { capTerrain, familySwatch, type FencePlanScene } from "@/lib/fence/scene";
import {
  CATEGORY_LABEL,
  DEFAULT_FENCE_TYPE,
  FENCE_TYPES,
  effectiveSpacingFt,
  nearestHeight,
  spacingOptions,
  takesCedarGrade,
  TERRAIN_FACTOR,
  TERRAIN_LABEL,
  TERRAINS,
  type FenceType,
  type FenceTypeId,
  type Terrain,
} from "@/lib/fence/catalog";
import { resolveMarket, type MarketSnapshot } from "@/lib/fence/market";
import { RATE_LIMITS, sanitizeRateBook, standardRate, type RateBook } from "@/lib/fence/rates";
import { segmentSteps, summarizeSlope, type SlopeSummary } from "@/lib/fence/slope";
import { fenceBuildFor, type FenceBuild } from "@/lib/fence/build";
import type { FenceLayoutInput, FenceOpeningInput, FenceRunInput } from "@/lib/fence/takeoff";
import { polylinesToRuns, typedRuns } from "@/lib/fence/layout";
import {
  fenceChecks,
  fenceScope,
  fenceTiers,
  jobRates,
  openingEach,
  priceFencePackage,
  resolveFenceType,
  type CustomFenceType,
  type FencePackage,
} from "@/lib/fence/pricing";
import { getFenceCatalog, saveFenceCatalog } from "@/actions/fenceCatalog";
import type { ArmedOpening } from "@/stores/useFenceStudioStore";
import { fetchHouseFootprints, fetchPropertyBoundary } from "@/actions/fenceBoundary";
import {
  groupSides,
  detectFrontSides,
  bearingLabel,
  type FrontSideMatch,
  type ParcelSide,
  type RingPoint,
  type RoadLine,
} from "@/lib/parcels";
import { pointInRing } from "@/lib/parcel";
import { stateFromAddress, stateTaxRate } from "@/lib/pricing/salesTax";
import { convertFenceEstimateToProposal } from "@/actions/fenceEstimator";
import { isPlanLimitError, isPlanLimitFailure, PLAN_LIMIT_MESSAGE } from "@/lib/planLimits";
import { reportPlanLimitResult } from "@/stores/usePlanLimitStore";
import { DEFAULT_REMOVAL_PER_LF, OPENINGS, type OpeningType } from "./fence-estimator-data";

/** Where a created proposal opens: the BLUEPRINT manual builder, loaded with
 *  the record that was just written (`?proposal=<id>`). A fence estimate that
 *  converted into the old classic-shell editor left the blueprint fleet at the
 *  exact moment the contractor starts editing — the estimate is a draft of a
 *  proposal, and the builder is where a proposal is drafted. */
const PROPOSAL_ROUTE = "/dashboard/manual-blueprint?proposal=";

/** Supplied by the page component, which is the only thing on this route that
 *  can hold a Next router. */
export type FenceEstimatorOptions = {
  navigate: (href: string) => void;
  /** A lead's address (lib/estimateSeed): typed into the search bar on init, and Find pressed when a map key is configured. */
  initialAddress?: string;
  /** A website or house lead's fence as the homeowner drew it (lib/webHandoff, 2026-10-28): the site from its pin, the
   *  style, the height, the gates and the path, applied once the shop's book has loaded. */
  initialFence?: WebFenceSeed | null;
};

/** The two fields of a Geocoder result this page reads. */
type GeoResult = {
  formatted_address?: string;
  geometry?: { location?: { lat: () => number; lng: () => number } };
};

type FenceRun = { id: string; ft: number };
/**
 * A ledger opening. `seg`/`t`/`x`/`y` are its PLACEMENT on the traced map
 * surface and are absent for an opening added straight from the Gate/Door
 * popover with nothing drawn: `seg` is the index of the traced segment it rides
 * and `t` its 0..1 position along it, or `x`/`y` are free local-feet coords when
 * it was dropped away from any run. `run` is the ledger ordinal that placement
 * resolves to ("Run 3"), which is the only one of them the row renders.
 */
type FenceOpening = {
  id: string;
  type: string;
  run: number | null;
  seg?: number;
  t?: number;
  x?: number;
  y?: number;
};
type FenceState = {
  mode: string;
  /** The fence TYPE — a catalog id (lib/fence/catalog) or one of the shop's own. */
  material: string;
  height: number;
  demo: boolean;
  /** The shop's tear-out rate, $/lf. */
  removalPerLf: number;
  /** Stain & seal after install (wood types only). */
  stain: boolean;
  /** Post system upgrade (wood types only) — lib/fence/pricing POST_SYSTEMS. */
  postUpgrade: PostSystem | null;
  /** Cedar board grade, fasteners, gate hardware, steel gate posts, site prep (2026-09-23). */
  boardGrade: BoardGrade;
  fasteners: "galvanized" | "stainless";
  gateHardware: "standard" | "heavy-duty";
  steelGatePosts: boolean;
  clearLine: boolean;
  haulSoil: boolean;
  /** Line-post spacing override, ft o.c.; null = the type's standard. */
  spacing: number | null;
  /** Ground difficulty: measured from the profile ("auto") or the contractor's pick. */
  terrain: Terrain | "auto";
  /** Waste on cut goods, percent. */
  wastePct: number;
  /** The type picked from the list — what the tier ladder is built on. A
   *  tier click prices its own type without moving the ladder, so Better
   *  always brings the designed fence back. */
  tierBase: string;
  /** Which of Good / Better / Best is picked — by its ID. It used to be worked
   *  out from "does this tier's type and stain match what is being priced",
   *  and two tiers can match at once: Better had no stain test, so with stain
   *  on it lit beside Best; and where Best (or Good) is the SAME type as the
   *  base — composite, black chain-link, steel, 3-rail — every such tier lit
   *  together (2026-09-21). One id, one tier. */
  tier: 'good' | 'better' | 'best';
  /** The shop's price book: what it charges per type, where it differs from the catalog. */
  rates: RateBook;
  /** The shop's own fence types, each built like a catalog type. */
  customs: CustomFenceType[];
  runs: FenceRun[];
  openings: FenceOpening[];
};

export function initFenceEstimatorContent(
  content: HTMLElement,
  opts: FenceEstimatorOptions,
): () => void {
  // Scoped to `.content`, which the shared shell owns and re-fills on every
  // navigation. `.main` lives in the shell, above this element.
  const root = content;
  const main = content.closest<HTMLElement>(".main");
  const disposers: Array<() => void> = [];
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const on = (
    target: EventTarget,
    ev: string,
    fn: EventListener,
    opts?: AddEventListenerOptions,
  ) => {
    target.addEventListener(ev, fn, opts);
    disposers.push(() => target.removeEventListener(ev, fn, opts));
  };
  /** setTimeout that survives nothing: every pending id is cleared on unmount. */
  const after = (fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
  };
  const $ = (sel: string) => root.querySelector<HTMLElement>(sel);
  const $$ = (sel: string) => Array.from(root.querySelectorAll<HTMLElement>(sel));

  // Dismiss Lead Center banners (smooth height + gap collapse) — inert on this
  // page (no banner in the markup), kept for donor parity with shared shells.
  $$(".banner-close").forEach((btn) => {
    btn.addEventListener("click", () => {
      const b = btn.closest<HTMLElement>(".banner");
      if (!b || b.classList.contains("closing")) return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        b.classList.add("hidden");
        return;
      }
      b.style.height = b.offsetHeight + "px";
      b.style.transitionDelay = "0ms";
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          b.classList.add("closing");
          b.style.height = "0px";
        }),
      );
      b.addEventListener("transitionend", function te(e) {
        if (e.propertyName !== "height") return;
        b.classList.add("hidden");
        b.removeEventListener("transitionend", te);
      });
    });
  });

  // ================= FENCE STUDIO: STATE =================
  // The fence TYPES, their build specs, heights and rates live in lib/fence —
  // the FenceScan engine (ported 2026-09-18). The page holds the shop's
  // price book on top of it, the openings it offers (./fence-estimator-data)
  // and this property's geometry.
  //
  // The donor opened on nine runs and one gate. That fixture is GONE. The page
  // opens empty, `#runsEmpty` says so, and every foot on the ticket got there
  // by being traced on the map or typed into a run row.
  //
  // The sequence counters are per-mount; ids only have to be unique within one
  // visit, and a navigation away rebuilds the module's whole closure.
  let runSeq = 0,
    opSeq = 0,
    matSeq = 0;
  const fs: FenceState = {
    mode: 'draw', material: DEFAULT_FENCE_TYPE, height: 6, demo: false,
    removalPerLf: DEFAULT_REMOVAL_PER_LF,
    stain: false,
    postUpgrade: null,
    boardGrade: 'standard',
    fasteners: 'galvanized',
    gateHardware: 'standard',
    steelGatePosts: true,
    clearLine: false,
    haulSoil: false,
    spacing: null,
    terrain: 'auto',
    wastePct: 10,
    tierBase: DEFAULT_FENCE_TYPE,
    tier: 'better',
    rates: {},
    customs: [],
    runs: [],
    openings: []
  };
  /** The height the contractor ASKED for (a height button, a reset, a hand-off). fs.height is what the picked type
   *  allows, snapped from this — so a trip through a type that only comes in 3–4 ft (a picket, a ranch rail) does
   *  not leave the next privacy fence at 4 ft: the height asked for comes back as soon as the type offers it
   *  (2026-11-10, found walking the studio: cedar 6 ft → classic picket → cedar again read 4 ft). */
  let heightAsked = fs.height;

  /** The shop's book, per tab: the organization's saved book loads on top of
   *  the catalog at mount, and every edit is kept here until "Save as company
   *  defaults" writes it back for everyone. */
  const RATE_KEY = 'jf.fence.book.v2';
  /** The colour a new type's swatch takes until the palette is exhausted —
   *  a custom type still has to READ as a material in the row and in 3D. */
  const CUSTOM_COLORS = ['#5f7d4f', '#8a5a3c', '#4a5b6b', '#9b8557', '#6b5b7d'];

  function money(n: number) { return '$' + Math.round(n).toLocaleString('en-US'); }

  // ── Types and rates ────────────────────────────────────────────────────
  /** One row of the type list: a catalog type or one of the shop's own. */
  type TypeRow = { id: string; label: string; color: string; type: FenceType; custom: CustomFenceType | null; category: string };
  function typeRows(): TypeRow[] {
    const rows: TypeRow[] = FENCE_TYPES.map(function (t) { return { id: t.id, label: t.label, color: t.color, type: t, custom: null, category: t.category }; });
    fs.customs.forEach(function (c) {
      const r = resolveFenceType(c.id, fs.customs);
      rows.push({ id: c.id, label: c.label, color: c.color || r.type.color, type: r.type, custom: c, category: 'custom' });
    });
    return rows;
  }
  function typeRow(id: string): TypeRow {
    return typeRows().find(function (r) { return r.id === id; }) || typeRows()[0];
  }
  /** The picked type, resolved (custom → its base). */
  function currentType() { return resolveFenceType(fs.material, fs.customs); }
  function opType(id: string): OpeningType { return OPENINGS.find(function (o) { return o.id === id; }) || OPENINGS[0]; }
  function totalFt() { return fs.runs.reduce(function (a, r) { return a + (r.ft || 0); }, 0); }

  /** The job's market — the site's state + ZIP (national until an address resolves). */
  let marketMemo: { key: string; market: MarketSnapshot | undefined } | null = null;
  function market(): MarketSnapshot | undefined {
    const p = sitePlace;
    const key = p ? [p.state, p.zip, p.formatted || p.address].join('|') : '';
    if (marketMemo && marketMemo.key === key) return marketMemo.market;
    const m = p ? resolveMarket({ state: p.state || null, zip: p.zip || null, address: p.formatted || p.address || null }) : undefined;
    marketMemo = { key: key, market: m };
    return m;
  }
  function priceOpts() {
    return { rates: fs.rates, customs: fs.customs, market: market(), removalPerLf: fs.removalPerLf };
  }
  /** What one opening of this kind costs on the picked type at the picked height. */
  function openingPrice(o: OpeningType): number {
    return openingEach(currentType(), priceOpts(), { widthFt: o.width, kind: o.kind, label: o.label, variant: o.variant }, fs.height);
  }
  /** The all-in $/lf a type row shows: material + labor at ITS default height, this shop's rates. */
  function rowPerLf(r: TypeRow): number {
    const jr = jobRates(resolveFenceType(r.id, fs.customs), priceOpts());
    return jr.materialPerLf + jr.laborPerLf;
  }
  function rowEdited(r: TypeRow): boolean {
    if (r.custom) return true;
    const b = fs.rates[r.type.id];
    return !!b && (b.materialPerLf !== undefined || b.laborPerLf !== undefined || b.gateSingle !== undefined);
  }

  // ── The layout the engine prices ─────────────────────────────────────
  /** The measured ground as the slope rules read it. */
  function slope(): SlopeSummary | null {
    const t = usableTerrain();
    if (!t || !t.segs.length) return null;
    return summarizeSlope(
      t.segs.map(function (sg) { return { planFt: sg.planFt, gradeFt: sg.gradeFt, riseFt: sg.riseFt, thetaDeg: sg.thetaDeg, cls: sg.cls, steps: sg.steps, stepDropFt: sg.stepDropFt, planned: sg.planned }; }),
      fs.height,
      effectiveSpacingFt(currentType().type, fs.spacing),
      market()?.frostIn ?? 0,
    );
  }
  /** The steps one stepped segment is priced with — the ticket's count, which
   *  the map's badge, the run's grade tag and the 3D all show. */
  function pricedSteps(sg: { planFt: number; riseFt: number; cls: 'level' | 'racked' | 'stepped'; steps?: number; stepDropFt?: number; planned?: boolean }): number {
    return segmentSteps(sg, effectiveSpacingFt(currentType().type, fs.spacing)).steps;
  }
  /** The ground difficulty the labor is priced at. */
  function effTerrain(): Terrain {
    if (fs.terrain !== 'auto') return fs.terrain;
    return slope()?.suggestedTerrain ?? 'flat';
  }
  /**
   * The runs as the takeoff counts them: the traced polylines (corners inside,
   * ends where they stop, none on a ring) with each segment's ledger length
   * along the ground; or, typed by hand, ONE fence whose runs meet at corners
   * — three typed runs are a fence with two corners, not three loose pieces.
   * The grouping rule lives in lib/fence/layout so it has its own checks.
   */
  /** Which run and side each traced segment became in the last layoutRuns() — to seat a gate on its side. */
  let segLegs = new Map<number, { run: number; leg: number; ft: number }>();
  function runLength(r: FenceRun) { return (r.ft || 0) * segFactor(r); }
  function layoutRuns(): FenceRunInput[] {
    segLegs = new Map();
    if (!mapOwnsRuns || mapPoints.length < 2) return typedRuns(fs.runs.map(runLength));
    return polylinesToRuns(mapPoints, function (i) {
      const r = fs.runs.find(function (x) { return x.id === 'm' + i; });
      return r ? runLength(r) : null;
    }, function (seg, run, leg, ft) { segLegs.set(seg, { run: run, leg: leg, ft: ft }); });
  }
  /** The openings, each seated on its side where the page knows it (lib/fence/takeoff counts the bays either side
   *  of it): a traced gate where it was dropped on its segment; a gate on a typed run in the middle of that run. */
  function layoutOpenings(): FenceOpeningInput[] {
    const typed = !mapOwnsRuns || mapPoints.length < 2;
    const typedSides: number[] = [];
    if (typed) fs.runs.forEach(function (r, i) { if (runLength(r) > 0) typedSides.push(i); });
    return fs.openings.map(function (o) {
      const t = opType(o.type);
      const base: FenceOpeningInput = { widthFt: t.width, kind: t.kind, label: t.label, variant: t.variant };
      if (typed) {
        const leg = typedSides.indexOf((o.run ?? 0) - 1);
        if (leg >= 0) base.at = { run: 0, leg: leg, ft: runLength(fs.runs[typedSides[leg]]) / 2 };
      } else if (typeof o.seg === 'number' && segLegs.has(o.seg)) {
        const l = segLegs.get(o.seg) as { run: number; leg: number; ft: number };
        base.at = { run: l.run, leg: l.leg, ft: Math.min(1, Math.max(0, o.t ?? 0.5)) * l.ft };
      }
      return base;
    });
  }
  function layoutInput(): FenceLayoutInput {
    const sl = slope();
    const runs = layoutRuns(); // first: it seats the segments the openings are read against
    return {
      type: fs.material,
      heightFt: fs.height,
      runs: runs,
      openings: layoutOpenings(),
      terrain: effTerrain(),
      wastePct: fs.wastePct,
      removalLf: fs.demo ? Math.round(billFt()) : 0,
      stain: fs.stain,
      steppedSections: sl ? sl.steppedSections : 0,
      postUpgrade: fs.postUpgrade,
      boardGrade: fs.boardGrade,
      fasteners: fs.fasteners,
      gateHardware: fs.gateHardware,
      steelGatePosts: fs.steelGatePosts,
      clearLine: fs.clearLine,
      haulSoil: fs.haulSoil,
      postSpacingFt: fs.spacing,
      frostIn: market()?.frostIn,
    };
  }
  /** The priced package for the page's current state — one computation per state. */
  let pkgMemo: { key: string; pkg: FencePackage; layout: FenceLayoutInput } | null = null;
  function pkg(): FencePackage {
    const layout = layoutInput();
    const key = JSON.stringify([layout, fs.rates, fs.customs, fs.removalPerLf, market()?.label ?? '']);
    if (pkgMemo && pkgMemo.key === key) return pkgMemo.pkg;
    const built = priceFencePackage(layout, priceOpts());
    pkgMemo = { key: key, pkg: built, layout: layout };
    return built;
  }
  function saveRate() {
    try {
      window.sessionStorage.setItem(
        RATE_KEY,
        JSON.stringify({ rates: fs.rates, customs: fs.customs, removalPerLf: fs.removalPerLf, wastePct: fs.wastePct }),
      );
    } catch {
      // Storage denied (private windows) — the edits still hold for this mount.
    }
  }
  /** Read a saved book (the browser's or the organization's) into the state. */
  function applyBook(data: { rates?: unknown; customs?: unknown; custom?: unknown; removalPerLf?: unknown; wastePct?: unknown } | null | undefined) {
    if (!data || typeof data !== 'object') return;
    fs.rates = sanitizeRateBook(data.rates);
    const customs = Array.isArray(data.customs) ? data.customs : Array.isArray(data.custom) ? data.custom : [];
    fs.customs = (customs as CustomFenceType[]).filter(function (c) {
      return c && typeof c.id === 'string' && typeof c.label === 'string' && typeof c.like === 'string' && Number.isFinite(c.materialPerLf) && Number.isFinite(c.laborPerLf);
    });
    fs.customs.forEach(function (c) {
      const n = parseInt(c.id.replace(/^custom-/, ''), 10);
      if (Number.isFinite(n) && n > matSeq) matSeq = n;
    });
    const rem = Number(data.removalPerLf);
    if (Number.isFinite(rem) && rem >= 0) fs.removalPerLf = rem;
    const w = Number(data.wastePct);
    if (Number.isFinite(w) && w >= 0 && w <= 30) fs.wastePct = w;
  }
  // The picked tier (with the type the ladder stands on) survives a reload and
  // the round trip to the proposal: this tab's storage, like the rate book.
  const TIER_KEY = 'jf.fence.tier';
  function rememberTier() {
    try {
      window.sessionStorage.setItem(TIER_KEY, JSON.stringify({ tier: fs.tier, base: fs.tierBase, stain: fs.stain }));
    } catch { /* no storage: the pick lives for the visit */ }
  }
  function restoreTier() {
    try {
      const raw = window.sessionStorage.getItem(TIER_KEY);
      const v = raw ? JSON.parse(raw) : null;
      if (!v || !['good', 'better', 'best'].includes(v.tier)) return;
      if (!typeRows().some(function (r) { return r.id === v.base; })) return;
      const base = resolveFenceType(v.base, fs.customs);
      if (base.custom) return;
      const picked = fenceTiers(base.type.id, fs.height).find(function (t) { return t.id === v.tier; });
      if (!picked) return;
      fs.tierBase = v.base;
      fs.tier = picked.id;
      fs.material = picked.type;
      fs.stain = base.type.stainable || picked.stain ? picked.stain : !!v.stain;
    } catch { /* a corrupt value: the defaults stand */ }
  }
  function restoreRate() {
    try {
      const raw = window.sessionStorage.getItem(RATE_KEY);
      if (raw) applyBook(JSON.parse(raw));
    } catch {
      // No storage or a corrupt value: no restore.
    }
  }
  /** The organization's saved book, when the table exists and holds one. The
   *  browser's own edits win over it for this tab (they are newer). */
  async function loadOrgBook() {
    try {
      const doc = await getFenceCatalog();
      if (!doc) return;
      const hasLocal = !!window.sessionStorage.getItem(RATE_KEY);
      if (!hasLocal) {
        applyBook(doc);
        if (!typeRows().some(function (r) { return r.id === fs.material; })) { fs.material = DEFAULT_FENCE_TYPE; fs.tierBase = DEFAULT_FENCE_TYPE; fs.tier = 'better'; }
        renderStudio();
      }
    } catch {
      /* the table is not there yet, or the request failed: the catalog's rates it is */
    }
  }
  /** Billed footage: each run's (possibly hand-edited) plan feet times its
   *  segment's measured grade factor. Runs without measured ground bill flat —
   *  the honest fallback the assumptions then own up to. */
  function billFt() {
    return fs.runs.reduce(function (a, r) { return a + (r.ft || 0) * segFactor(r); }, 0);
  }
  /** Billed footage of one slope class (racked / stepped), for the assumptions. */
  function classFt(cls: string) {
    return fs.runs.reduce(function (a, r) {
      const s = terrainSegForRun(r);
      return a + (s && s.cls === cls ? (r.ft || 0) * segFactor(r) : 0);
    }, 0);
  }
  /** The figures the ticket reads. */
  function price() {
    const p = pkg();
    return { ft: totalFt(), gradeFt: billFt(), total: p.subtotal, perAll: p.pricePerLf, pkg: p };
  }

  /** The donor rebuilt this strip in two places — the markup is identical.
   *  With measured non-flat ground the Total cell carries a second line: the
   *  along-grade footage, which is the one the ticket bills. */
  function statStripHtml() {
    const plan = Math.round(totalFt());
    const grade = Math.round(billFt());
    const gradeLine = grade !== plan
      ? '<div class="stat-sub">' + grade + ' ft along grade</div>'
      : '';
    return '<div class="stat-cell"><div class="kpi-lbl">Total</div><div class="stat-v accent">' + plan + ' ft</div>' + gradeLine + '</div>' +
      '<div class="stat-cell"><div class="kpi-lbl">Runs</div><div class="stat-v">' + fs.runs.length + '</div></div>' +
      '<div class="stat-cell"><div class="kpi-lbl">Openings</div><div class="stat-v">' + fs.openings.length + '</div></div>';
  }

  // ================= RENDER =================
  function renderTicket() {
    const p = price();
    const tkTotal = $('#tkTotal');
    const tkSub = $('#tkSub');
    const tkLines = $('#tkLines');
    if (!tkTotal || !tkSub || !tkLines) return;
    // Nothing measured is not "$0" — a zero total reads like a priced job that
    // came to nothing. The em-dash is the honest resting state.
    const tkTax = $('#tkTax');
    if (p.ft <= 0 && !fs.openings.length) {
      tkTotal.textContent = '—';
      tkSub.textContent = 'Nothing measured yet';
      tkTax?.classList.add('is-hidden');
      tkLines.innerHTML = '';
      renderTiers();
      renderNotes();
      return;
    }
    tkTotal.textContent = money(p.total);
    // The per-foot figure is the package's: the whole price ÷ the FENCE footage (gates and doors are not fence —
    // lib/fence/pricing pricePerLf). So the footage beside it is that same fence footage, along grade, with the
    // openings named after it: "488 lf of fence + 1 gate · $47/lf" multiplies back to the total, where the old
    // "492 lf · $47/lf" (gates in the feet, not in the rate) did not — 150 lf with an 8-ft gate read "$44/lf" on
    // a $6,289 job (2026-11-10).
    const netLf = Math.round(p.pkg.netFenceLf);
    const gateN = fs.openings.filter(function (o) { return opType(o.type).kind === 'gate'; }).length;
    const doorN = fs.openings.length - gateN;
    const opens = [gateN ? gateN + (gateN === 1 ? ' gate' : ' gates') : '', doorN ? doorN + (doorN === 1 ? ' door' : ' doors') : ''].filter(Boolean).join(' + ');
    tkSub.textContent = (netLf > 0 ? netLf + ' lf of fence' + (opens ? ' + ' + opens : '') + ' · ' + money(p.perAll) + '/lf' : opens) +
      (p.pkg.market && p.pkg.market.resolution !== 'national' ? ' · ' + esc(p.pkg.market.label) + ' rates' : '');
    // Before tax — and what the proposal adds. Convert writes the job state's sales tax on the whole job (else the
    // company's default rate), so a $23,107 estimate became a $24,609 proposal with nothing here saying why.
    if (tkTax) {
      const where = sitePlace ? (sitePlace.formatted || sitePlace.address || '') : '';
      const st = stateFromAddress(where);
      const rate = stateTaxRate(st);
      tkTax.classList.remove('is-hidden');
      tkTax.textContent = rate && st
        ? 'Before tax · the proposal adds ' + st + ' sales tax ' + (Math.round(rate * 10000) / 100) + '% (' + money(p.total * rate) + ') = ' + money(p.total * (1 + rate))
        : 'Before tax · the proposal adds your sales tax';
    }
    tkLines.innerHTML = p.pkg.lines.map(function (l) {
      const qty = l.unit === 'lot' ? '' : ' × ' + (l.unit === 'ln ft' ? Math.round(l.quantity) + ' lf' : l.unit === 'sqft' ? Math.round(l.quantity) + ' sq ft' : String(l.quantity));
      return '<li><span>' + esc(l.name) + qty + '</span><span>' + money(l.quantity * l.unitPrice) + '</span></li>';
    }).join('');
    renderTiers();
    renderNotes();
  }

  /** Good / Better / Best for the picked type: three totals, the picked one marked. */
  function renderTiers() {
    const box = $('#tkTiers');
    if (!box) return;
    const p = price();
    const base = resolveFenceType(fs.tierBase, fs.customs);
    if (p.ft <= 0 || base.custom || currentType().custom) { box.innerHTML = ''; box.classList.add('is-hidden'); return; }
    const layout = layoutInput();
    const tiers = fenceTiers(base.type.id, fs.height);
    // The ladder drops a tier that would quote the same fence as Better; a
    // lone card is no choice, so the strip goes.
    if (tiers.length < 2) { box.innerHTML = ''; box.classList.add('is-hidden'); return; }
    const html = tiers.map(function (tier) {
      // The card shows what a click on it will price — the click sets stain to
      // the tier's own on a stainable base (or a stained tier) and leaves it be
      // otherwise. Better used to carry the stain switch's price while a click
      // on it took the stain off: two cards, one number, a different total.
      const stainFor = base.type.stainable || tier.stain ? tier.stain : layout.stain;
      const total = priceFencePackage({ ...layout, type: tier.type, stain: stainFor }, priceOpts()).subtotal;
      const on = tier.id === fs.tier;
      const t = typeRow(tier.type);
      return '<button class="tier' + (on ? ' on' : '') + '" type="button" data-tier="' + tier.id + '" aria-pressed="' + String(on) + '" title="' + esc(tier.tagline) + '">' +
        '<span class="tier-n">' + tier.name + '</span>' +
        '<span class="tier-t">' + esc(t.label) + (tier.stain ? ' · stained' : '') + '</span>' +
        '<span class="tier-v">' + money(total) + '</span></button>';
    }).join('');
    box.innerHTML = html;
    box.classList.remove('is-hidden');
  }

  /** The contractor's notes under the ticket: what the package assumed and what to check. */
  function renderNotes() {
    const box = $('#tkNotes');
    if (!box) return;
    const p = price();
    const checks = p.ft > 0 ? fenceChecks(p.pkg, layoutInput(), slope()) : [];
    if (!checks.length) { box.innerHTML = ''; box.classList.add('is-hidden'); return; }
    box.innerHTML = checks.map(function (c) {
      return '<li class="note ' + c.level + '"><span class="note-dot"></span><span>' + esc(c.text) + '</span></li>';
    }).join('');
    box.classList.remove('is-hidden');
  }

  /** The material takeoff card: posts by kind, every part, crew time. Built
   *  by the same engine the ticket bills, so the two can never disagree. */
  function renderTakeoff() {
    const card = $('#takeoffCard');
    const list = $('#bomList');
    const meta = $('#takeoffMeta');
    const foot = $('#takeoffFoot');
    if (!card || !list || !meta || !foot) return;
    const p = price();
    if (p.ft <= 0) { card.classList.add('is-hidden'); return; }
    const tk = p.pkg.takeoff;
    card.classList.remove('is-hidden');
    meta.textContent = Math.round(tk.netFenceLf) + ' lf of fence · ' + tk.sections + ' sections at ' + tk.spacingFt + "' o.c. · " + tk.posts.total + ' posts';
    list.innerHTML = tk.bom.map(function (b) {
      const unit = b.unit === 'ea' ? '' : b.unit === 'lf' ? ' lf' : b.unit === 'bag' ? (b.qty === 1 ? ' bag' : ' bags') : b.unit === 'box' ? (b.qty === 1 ? ' box' : ' boxes') : b.unit === 'gal' ? ' gal' : ' ' + b.unit;
      return '<li><span>' + esc(b.label) + '</span><span>' + b.qty.toLocaleString('en-US') + unit + '</span></li>';
    }).join('');
    const posts = [tk.posts.line ? tk.posts.line + ' line' : '', tk.posts.corner ? tk.posts.corner + ' corner' : '', tk.posts.end ? tk.posts.end + ' end' : '', tk.posts.gate ? tk.posts.gate + ' gate' : ''].filter(Boolean).join(' · ');
    // "10' stock (10' at steps)" said nothing: name the step length only when it differs.
    const stepLen = tk.bom.some(function (b) { return b.key === 'step-posts'; }) && tk.postLengthFt.step > tk.postLengthFt.base;
    foot.innerHTML = '<span>Posts: ' + esc(posts) + ' · ' + tk.postLengthFt.base + "' stock" + (stepLen ? ' (' + tk.postLengthFt.step + "' at steps)" : '') + '</span>' +
      '<span>Crew time ≈ ' + tk.laborHours + ' hrs</span>';
  }
  // ---- one row's markup, so a row can be ADDED or PATCHED without rebuilding
  // the list it lives in. Every edit on this page used to call renderStudio(),
  // which replaced the innerHTML of all four lists — and the observer on the
  // runs and materials lists then replayed the entrance cascade. Adding a run,
  // deleting a line or picking a material therefore looked like the whole rail
  // reloading. ----
  function runRowHtml(r: FenceRun, i: number) {
    return '<li data-run="' + r.id + '"><span class="run-n">Run ' + (i + 1) + '</span>' +
      '<span class="run-grade is-hidden" data-run-grade></span>' +
      '<input class="run-in" type="number" min="1" step="1" value="' + r.ft + '" data-run-ft>' +
      '<span class="run-u">ft</span>' +
      '<button class="row-x" type="button" data-del-run aria-label="Remove run">×</button></li>';
  }
  /** One type row. The RATE IS THE CONTROL: `.mat-rate` is a button, and
   *  clicking it opens the row's rate strip (material / labor per lf and the
   *  walk gate — see `editRate`). A type the shop added also carries a delete. */
  function matRowHtml(r: TypeRow) {
    const on = fs.material === r.id;
    return '<li class="' + (on ? 'on' : '') + '" data-mat="' + esc(r.id) +
      '" role="option" tabindex="0" aria-selected="' + (on ? 'true' : 'false') + '">' +
      '<span class="mat-sw" style="background:' + esc(r.color) + '"></span>' +
      '<span class="mat-name">' + esc(r.label) + '<span class="mat-sub">' + esc(r.custom ? 'built like ' + r.type.label.toLowerCase() : r.type.blurb) + '</span></span>' +
      '<button class="mat-rate' + (rowEdited(r) ? ' is-custom' : '') + '" type="button" data-rate="' +
      esc(r.id) + '" aria-label="Edit the ' + esc(r.label) + ' rates">' + money(rowPerLf(r)) + '/lf</button>' +
      (r.custom
        ? '<button class="row-x" type="button" data-del-mat="' + esc(r.id) + '" aria-label="Remove ' + esc(r.label) + '">×</button>'
        : '') +
      '</li>';
  }
  /** The list, grouped by family with a small header per group. */
  function matListHtml() {
    const rows = typeRows();
    const groups: Array<{ key: string; label: string; rows: TypeRow[] }> = [];
    rows.forEach(function (r) {
      const key = r.category;
      let g = groups.find(function (x) { return x.key === key; });
      if (!g) {
        g = { key: key, label: key === 'custom' ? 'Your own' : CATEGORY_LABEL[key as keyof typeof CATEGORY_LABEL] || key, rows: [] };
        groups.push(g);
      }
      g.rows.push(r);
    });
    return groups.map(function (g) {
      return '<li class="mat-cat" aria-hidden="true">' + esc(g.label) + '</li>' + g.rows.map(matRowHtml).join('');
    }).join('');
  }

  /** Repaint one type row's rate cell after an edit — the list is not
   *  rebuilt, so the row the user just typed in keeps its place. */
  function paintMatRate(id: string) {
    const r = typeRows().find(function (x) { return x.id === id; });
    const cell = $('#matList [data-rate="' + id + '"]');
    if (!r || !cell) return;
    cell.textContent = money(rowPerLf(r)) + '/lf';
    cell.classList.toggle('is-custom', rowEdited(r));
  }

  /** Grouped by kind, so the native menu shows a labelled rule between the gates
   *  and the doors instead of one flat list of seven look-alike entries. */
  function openOptionsHtml(selected: string) {
    return (['gate', 'door'] as const).map(function (kind) {
      const items = OPENINGS.filter(function (x) { return x.kind === kind; });
      if (!items.length) return '';
      return '<optgroup label="' + (kind === 'gate' ? 'Gates' : 'Doors') + '">' +
        items.map(function (x) {
          return '<option value="' + x.id + '"' + (x.id === selected ? ' selected' : '') + '>' +
            x.label + ' · ' + x.width + ' ft</option>';
        }).join('') +
        '</optgroup>';
    }).join('');
  }
  function openRowHtml(o: FenceOpening) {
    const t = opType(o.type);
    return '<li data-op="' + o.id + '"><span class="op-ic"><svg class="ic"><use href="#' +
      (t.kind === 'gate' ? 'i-door-open' : 'i-door-closed') + '"/></svg></span>' +
      // The shared blueprint select. `.op-sel` moves onto the `.bp-sel`
      // WRAPPER, not the control: the wrapper is what the grid now places at
      // `1 / 2`, and a select cannot carry the pseudo-element that draws the
      // chevron. `.bp-sel-in` (blueprint-global.css) owns the appearance
      // reset; the row's height and inset stay in fence-estimator.module.css.
      // `data-op-type` stays on the <select> — the document-level 'change'
      // delegate matches it there and walks up to `[data-op]`.
      '<span class="bp-sel op-sel"><select class="bp-sel-in" data-op-type aria-label="Opening type">' +
      openOptionsHtml(o.type) + '</select></span>' +
      '<span class="op-price">' + money(openingPrice(t)) + '</span>' +
      '<button class="row-x" type="button" data-del-op aria-label="Remove opening">×</button>' +
      '<span class="op-sub">' + t.width + ' ft · ' + (o.run ? 'Run ' + o.run : 'Free') + '</span></li>';
  }
  /** Re-read one opening row's derived cells after its type changed. */
  function paintOpenRow(li: HTMLElement, o: FenceOpening) {
    const t = opType(o.type);
    const use = li.querySelector<SVGUseElement>('.op-ic use');
    use?.setAttribute('href', t.kind === 'gate' ? '#i-door-open' : '#i-door-closed');
    const price = li.querySelector<HTMLElement>('.op-price');
    if (price) price.textContent = money(openingPrice(t));
    const sub = li.querySelector<HTMLElement>('.op-sub');
    if (sub) sub.textContent = t.width + ' ft · ' + (o.run ? 'Run ' + o.run : 'Free');
  }
  /** After a run is deleted the survivors' ordinals shift. */
  function renumberRuns() {
    $$('#runsList [data-run]').forEach(function (li, i) {
      const n = li.querySelector<HTMLElement>('.run-n');
      if (n) n.textContent = 'Run ' + (i + 1);
    });
  }
  function renderStrip() {
    const strip = $('#statStrip');
    if (strip) strip.innerHTML = statStripHtml();
  }
  /** The ground rules (post spacing | rack limit) the map and the 3D note were
   *  last painted under. */
  let paintedRules = '';
  /** The figures every edit touches: the ticket and the stat strip. Text only —
   *  no list is rebuilt, so nothing re-animates. */
  function renderFigures() {
    renderTicket();
    renderTakeoff();
    renderStrip();
    syncRunsEmpty();
    paintRunGrades();
    // Opening prices follow the type and the height.
    $$('#openList [data-op]').forEach(function (li) {
      const o = fs.openings.find(function (x) { return x.id === li.dataset.op; });
      if (o) paintOpenRow(li, o);
    });
    // And so do the Gate and Door menus' — they were built once per studio
    // render, so a rate typed in the book (or an address that moved the
    // market) left the menu on the old figure: $744 there, $736 on the row.
    $$('.tool-pop [data-add-open]').forEach(function (b) {
      const t = OPENINGS.find(function (x) { return x.id === b.dataset.addOpen; });
      const cell = b.querySelector<HTMLElement>('.tp-p');
      if (t && cell) cell.textContent = money(openingPrice(t));
    });
    // Material, height and openings are the 3D scene's inputs too. No-op until
    // the scene is mounted, and `modelGates()` keeps the array identity stable
    // so a keystroke in a run-length box does not rebuild it.
    pushModel();
    // A new type or post spacing re-reads the same ground under ITS rules (a
    // prefab vinyl panel racks 4°, cedar 20°): the map's slope badges and the
    // 3D note follow, or they keep the last type's racked runs.
    const rb = currentBuild();
    const rules = rb.spacingFt + '|' + rb.rackMaxDeg;
    if (rules !== paintedRules) {
      paintedRules = rules;
      pushMap();
      renderModelNote();
    }
  }
  function syncOpenEmpty() {
    $('#openEmpty')?.classList.toggle('is-hidden', fs.openings.length !== 0);
  }
  /** Counts the rows ON SCREEN, not the ones in `fs.runs`: a row that is
   *  mid-`leaveRow` has already left the model but is still fading, and
   *  printing "No runs yet" underneath it would flash. `leaveRow` calls its
   *  commit AFTER removing the node, so the last exit re-runs this and the
   *  empty line arrives exactly when the row does leave. */
  function syncRunsEmpty() {
    const showing = $$('#runsList [data-run]').length > 0 || fs.runs.length > 0;
    $('#runsEmpty')?.classList.toggle('is-hidden', showing);
  }
  function renderLedger() {
    const runs = $('#runsList');
    const list = $('#openList');
    if (!runs || !list) return;
    renderStrip();
    runs.innerHTML = fs.runs.map(runRowHtml).join('');
    list.innerHTML = fs.openings.map(openRowHtml).join('');
    syncOpenEmpty();
    syncRunsEmpty();
  }
  function renderControls() {
    const matList = $('#matList');
    const heights = $('#heights');
    const demoTgl = $('#demoTgl');
    if (!matList || !heights || !demoTgl) return;
    matList.innerHTML = matListHtml();
    renderHeights();
    demoTgl.classList.toggle('on', fs.demo);
    renderSite();
  }
  /** The heights THIS type comes in; the picked one snaps to the nearest offered. */
  function renderHeights() {
    const heights = $('#heights');
    if (!heights) return;
    const t = currentType().type;
    fs.height = t.heightsFt.includes(heightAsked) ? heightAsked : nearestHeight(t, heightAsked);
    heights.innerHTML = t.heightsFt.map(function (h) {
      return '<button class="seg-btn' + (fs.height === h ? ' on' : '') + '" type="button" data-h="' + h + '">' + h + ' ft</button>';
    }).join('');
  }
  /** The Site rows that depend on the type: stain (wood), post upgrade
   *  (wood), post spacing (stick and mesh), the ground, the tear-out rate. */
  function renderSite() {
    const t = currentType().type;
    const stainRow = $('#stainRow');
    if (stainRow) {
      stainRow.classList.toggle('is-hidden', !t.stainable);
      $('#stainTgl')?.classList.toggle('on', fs.stain && t.stainable);
    }
    const upRow = $('#upgradeRow');
    if (upRow) {
      const can = t.category === 'wood';
      upRow.classList.toggle('is-hidden', !can);
      const six = t.spec.postWidthIn >= 5.5;
      const seg = upRow.querySelector<HTMLElement>('.site-seg');
      if (seg) {
        const opts: Array<[string, string]> = [['', 'Standard 4×4']];
        POST_SYSTEM_ORDER.forEach(function (id) { if (!(id === '6x6' && six)) opts.push([id, POST_SYSTEMS[id].short]); });
        seg.innerHTML = opts.map(function (o) {
          const on = (fs.postUpgrade || '') === o[0];
          return '<button class="seg-btn' + (on ? ' on' : '') + '" type="button" data-upgrade="' + o[0] + '">' + o[1] + '</button>';
        }).join('');
      }
      const hint = upRow.querySelector<HTMLElement>('.tg-h');
      if (hint) {
        const sys = fs.postUpgrade ? POST_SYSTEMS[fs.postUpgrade] : null;
        hint.textContent = sys ? sys.blurb.charAt(0).toUpperCase() + sys.blurb.slice(1) + '. ' + (sys.warranty ? sys.warranty + '.' : '4-year workmanship warranty.') : 'Standard 4×4 pressure-treated carries the 4-year workmanship warranty; steel and post-on-pipe systems add 10-year to lifetime structural.';
      }
    }
    // Wood-only rows (2026-09-23): the board grade, the fasteners, steel gate posts.
    const wood = t.category === 'wood';
    $('#woodCard')?.classList.toggle('is-hidden', !wood);
    // The cedar grade only where the boards are cedar (not pressure-treated pine).
    $('#gradeRow')?.classList.toggle('is-hidden', !takesCedarGrade(t));
    const gradeSeg = $('#gradeRow .site-seg');
    if (gradeSeg) gradeSeg.innerHTML = (['standard', 'tight-knot-1', 'clear'] as BoardGrade[]).map(function (g) {
      return '<button class="seg-btn' + (fs.boardGrade === g ? ' on' : '') + '" type="button" data-grade="' + g + '">' + BOARD_GRADES[g].label + '</button>';
    }).join('');
    const fastenSeg = $('#fastenRow .site-seg');
    if (fastenSeg) fastenSeg.innerHTML = ([['galvanized', 'Galvanized'], ['stainless', 'Stainless']] as Array<[string, string]>).map(function (o) {
      return '<button class="seg-btn' + (fs.fasteners === o[0] ? ' on' : '') + '" type="button" data-fasten="' + o[0] + '">' + o[1] + '</button>';
    }).join('');
    const gpRow = $('#gatePostsRow');
    if (gpRow) {
      const applies = wood && fs.postUpgrade !== 'steel' && fs.postUpgrade !== 'black-steel';
      gpRow.classList.toggle('is-hidden', !applies);
      $('#gatePostsTgl')?.classList.toggle('on', fs.steelGatePosts && applies);
    }
    const hwSeg = $('#gateHwRow .site-seg');
    if (hwSeg) hwSeg.innerHTML = ([['standard', 'Standard'], ['heavy-duty', 'Heavy-duty']] as Array<[string, string]>).map(function (o) {
      return '<button class="seg-btn' + (fs.gateHardware === o[0] ? ' on' : '') + '" type="button" data-gatehw="' + o[0] + '">' + o[1] + '</button>';
    }).join('');
    $('#clearTgl')?.classList.toggle('on', fs.clearLine);
    $('#haulTgl')?.classList.toggle('on', fs.haulSoil);
    const spRow = $('#spacingRow');
    if (spRow) {
      const opts = spacingOptions(t);
      const seg = spRow.querySelector<HTMLElement>('.site-seg');
      const hint = spRow.querySelector<HTMLElement>('.tg-h');
      if (opts && seg) {
        seg.innerHTML = [null as number | null].concat(opts).map(function (o) {
          const on = (fs.spacing ?? null) === o;
          return '<button class="seg-btn' + (on ? ' on' : '') + '" type="button" data-spacing="' + (o === null ? '' : o) + '">' + (o === null ? 'Std ' + t.postSpacingFt + "'" : o + "'") + '</button>';
        }).join('');
        if (hint) hint.textContent = 'Line posts on center. ' + (t.build === 'stick' ? "A 2×4 rail spans 8' at most." : "Chain link runs out to 12'.");
      } else if (seg) {
        seg.innerHTML = '';
        if (hint) hint.textContent = t.build === 'panel' ? t.label + " installs as prefab " + t.postSpacingFt + "' panels — spacing is fixed by the section width." : t.label + " spacing is set by the rail stock itself — the " + t.postSpacingFt + "' rails span post to post.";
      }
    }
    const grRow = $('#groundRow');
    if (grRow) {
      const seg = grRow.querySelector<HTMLElement>('.site-seg');
      const hint = grRow.querySelector<HTMLElement>('.tg-h');
      const sl = slope();
      if (seg) {
        seg.innerHTML = (['auto'] as Array<Terrain | 'auto'>).concat(TERRAINS).map(function (k) {
          const on = fs.terrain === k;
          const label = k === 'auto' ? 'Auto' : k === 'flat' ? 'Flat' : k === 'sloped' ? 'Gentle' : k === 'steep' ? 'Steep' : 'Rocky';
          return '<button class="seg-btn' + (on ? ' on' : '') + '" type="button" data-terrain="' + k + '">' + label + '</button>';
        }).join('');
      }
      if (hint) {
        const eff = effTerrain();
        hint.textContent = (fs.terrain === 'auto'
          ? (sl ? 'Measured: grade ' + sl.avgGradePct + '% avg, ' + sl.maxGradePct + '% max → ' + TERRAIN_LABEL[eff].toLowerCase() : 'Reads the traced line\u2019s elevation profile; flat until measured')
          : TERRAIN_LABEL[eff]) + ' · labor ×' + TERRAIN_FACTOR[eff] + '.';
      }
    }
    const rem = $('#removalRate');
    if (rem instanceof HTMLInputElement && document.activeElement !== rem) rem.value = String(fs.removalPerLf);
  }
  function renderPops() {
    ['gate', 'door'].forEach(function (kind) {
      const box = $(kind === 'gate' ? '#popGate' : '#popDoor');
      if (!box) return;
      // Each entry carries its own icon and the list is ruled between items, so
      // "Single gate / Double gate / Triple gate" stop reading as one block of
      // near-identical text. The price is the picked type's, at the picked height.
      box.innerHTML = OPENINGS.filter(function (o) { return o.kind === kind; }).map(function (o) {
        return '<button class="tp-item" type="button" data-add-open="' + o.id + '">' +
          '<span class="tp-ic"><svg class="ic"><use href="#' +
            (o.kind === 'gate' ? 'i-door-open' : 'i-door-closed') + '"/></svg></span>' +
          '<span class="tp-t"><span class="tp-n">' + o.label + '</span>' +
          '<span class="tp-w">' + o.width + ' ft wide</span></span>' +
          '<span class="tp-p">' + money(openingPrice(o)) + '</span></button>';
      }).join('');
    });
  }
  function closePops() {
    $$('.tool-pop').forEach(function (p) { p.classList.remove('open'); });
  }
  function renderStudio() { renderTicket(); renderLedger(); renderControls(); renderPops(); }

  /** Installed by the motion module below; null under reduced motion. Called
   *  ONLY where a list genuinely re-lists (Clear, Reset, first paint). */
  let playStagger: (() => void) | null = null;

  /**
   * Append one row and let just that row arrive. The rest of the list is not
   * touched, so nothing else moves.
   */
  function appendRow(list: HTMLElement | null, html: string) {
    if (!list) return;
    const tmp = document.createElement('ul');
    tmp.innerHTML = html;
    const row = tmp.firstElementChild as HTMLElement | null;
    if (!row) return;
    list.appendChild(row);
    staggerIn([row]);
  }

  /** `leaveRow` takes `(ms, fn)`; this module's tracked timeout is `(fn, ms)`. */
  const afterMs = (ms: number, fn: () => void) => after(fn, ms);
  /** One row leaves: it fades out on its own and the rows below close the gap. */
  function leave(row: HTMLElement, commit: () => void) {
    leaveRow(row, commit, afterMs, { leaveClass: 'row--leaving' });
  }

  /** One pick path for mouse and keyboard. The list is patched in place (no
   *  re-render), so `aria-selected` must move with the `on` class. */
  function pickMaterial(m: HTMLElement) {
    fs.material = m.dataset.mat || '';
    fs.tierBase = fs.material;
    // A type picked from the list is "the fence as designed": Better — or Best,
    // when the stain that makes it Best is already switched on.
    fs.tier = fs.stain && resolveFenceType(fs.material, fs.customs).type.stainable ? 'best' : 'better';
    rememberTier();
    $$('#matList [data-mat]').forEach(function (li) {
      const picked = li === m;
      li.classList.toggle('on', picked);
      li.setAttribute('aria-selected', picked ? 'true' : 'false');
    });
    // The heights, the site options and the opening prices are the type's.
    renderHeights();
    renderSite();
    renderPops();
    renderFigures();
  }

  // ── The rate IS the row ────────────────────────────────────────────────
  // Clicking the figure on a type row opens a strip under it with the three
  // numbers the engine charges for that type: material per lf, labor per lf
  // and the walk gate. A blank field means "the catalog's number" — the
  // strip says what that is — and a value equal to it is not stored.

  function closeRateStrip() {
    $$('#matList .mat-edit').forEach(function (el) { el.remove(); });
  }
  function editRate(cell: HTMLElement) {
    const id = cell.dataset.rate || '';
    const r = typeRows().find(function (x) { return x.id === id; });
    const li = cell.closest<HTMLElement>('[data-mat]');
    if (!r || !li) return;
    const open = li.nextElementSibling instanceof HTMLElement && li.nextElementSibling.classList.contains('mat-edit') && li.nextElementSibling.dataset.for === id;
    closeRateStrip();
    if (open) return;
    const std = standardRate(r.type.id);
    const jr = jobRates(resolveFenceType(r.id, fs.customs), priceOpts());
    const book = r.custom ? { materialPerLf: r.custom.materialPerLf, laborPerLf: r.custom.laborPerLf, gateSingle: r.custom.gateSingle } : (fs.rates[r.type.id] || {});
    const field = function (key: 'materialPerLf' | 'laborPerLf' | 'gateSingle', label: string, unit: string) {
      const v = book[key];
      return '<label class="mat-edit-f"><span class="mat-edit-l">' + label + '</span>' +
        '<span class="mat-new-rate"><span class="mat-cur">$</span>' +
        '<input class="mat-new-in" type="number" min="' + RATE_LIMITS[key].min + '" max="' + RATE_LIMITS[key].max + '" step="0.5" inputmode="decimal" data-rate-field="' + key + '" value="' + (Number.isFinite(v) ? v : '') + '" placeholder="' + Math.round(jr[key] * 100) / 100 + '" aria-label="' + esc(r.label) + ' ' + label.toLowerCase() + '"></span>' +
        '<span class="mat-edit-u">' + unit + '</span></label>';
    };
    const strip = document.createElement('li');
    strip.className = 'mat-edit';
    strip.dataset.for = id;
    strip.innerHTML =
      field('materialPerLf', 'Material', '/lf') + field('laborPerLf', 'Labor', '/lf') + field('gateSingle', 'Walk gate', 'each') +
      '<span class="mat-edit-note">' + (r.custom
        ? 'Your own type — its rates as typed.'
        : 'Blank = the catalog\u2019s $' + std.materialPerLf + ' / $' + std.laborPerLf + ' / $' + std.gateSingle + (jr.source.materialPerLf === 'market' || jr.source.laborPerLf === 'market' ? ', scaled to ' + esc(market()!.label) : '') + '. A typed rate is what you charge.') + '</span>' +
      '<span class="mat-edit-acts"><button class="btn btn-primary btn--sm" type="button" data-rate-save="' + esc(id) + '">Apply</button>' +
      (r.custom ? '' : '<button class="btn btn-ghost btn--sm" type="button" data-rate-reset="' + esc(id) + '">Catalog</button>') +
      '<button class="row-x" type="button" data-rate-cancel aria-label="Cancel">×</button></span>';
    li.after(strip);
    staggerIn([strip]);
    strip.querySelector<HTMLInputElement>('input')?.focus();
  }
  function saveRateStrip(id: string) {
    const strip = $('#matList .mat-edit[data-for="' + id + '"]');
    const r = typeRows().find(function (x) { return x.id === id; });
    if (!strip || !r) return;
    const read = function (key: string): number | undefined {
      const el = strip.querySelector<HTMLInputElement>('[data-rate-field="' + key + '"]');
      const n = parseFloat(el?.value || '');
      return Number.isFinite(n) && n > 0 ? n : undefined;
    };
    if (r.custom) {
      const m = read('materialPerLf');
      const l = read('laborPerLf');
      if (m === undefined || l === undefined) { sayHint('A type of your own needs both a material and a labor rate.'); return; }
      r.custom.materialPerLf = m;
      r.custom.laborPerLf = l;
      r.custom.gateSingle = read('gateSingle');
    } else {
      fs.rates = sanitizeRateBook({ ...fs.rates, [r.type.id]: { materialPerLf: read('materialPerLf'), laborPerLf: read('laborPerLf'), gateSingle: read('gateSingle') } });
    }
    saveRate();
    closeRateStrip();
    paintMatRate(id);
    renderPops();
    renderFigures();
  }
  function resetRateStrip(id: string) {
    const r = typeRows().find(function (x) { return x.id === id; });
    if (!r || r.custom) return;
    const next = { ...fs.rates };
    delete next[r.type.id];
    fs.rates = next;
    saveRate();
    closeRateStrip();
    paintMatRate(id);
    renderPops();
    renderFigures();
  }

  /** The add-type row: a name, what it is built like, and its two rates.
   *  Appended to the list rather than opened as a dialog — it belongs among
   *  the types it is joining. */
  function openMatAdd() {
    const list = $('#matList');
    if (!list || list.querySelector('.mat-new')) {
      list?.querySelector<HTMLInputElement>('.mat-new-name')?.focus();
      return;
    }
    const color = CUSTOM_COLORS[fs.customs.length % CUSTOM_COLORS.length];
    const li = document.createElement('li');
    li.className = 'mat-new';
    li.innerHTML =
      '<span class="mat-sw" style="background:' + color + '"></span>' +
      '<input class="mat-new-name" type="text" placeholder="Type name (e.g. Redwood privacy)" aria-label="Type name" maxlength="40">' +
      '<span class="bp-sel mat-new-like"><select class="bp-sel-in" data-mat-like aria-label="Built like">' +
        FENCE_TYPES.map(function (t) { return '<option value="' + t.id + '"' + (t.id === currentType().type.id ? ' selected' : '') + '>Built like ' + esc(t.label.toLowerCase()) + '</option>'; }).join('') +
      '</select></span>' +
      '<span class="mat-new-rate"><span class="mat-cur">$</span>' +
      '<input class="mat-new-in" type="number" min="1" step="0.5" inputmode="decimal" placeholder="mat" aria-label="Material, dollars per linear foot" data-mat-new-mat></span>' +
      '<span class="mat-new-rate"><span class="mat-cur">$</span>' +
      '<input class="mat-new-in" type="number" min="1" step="0.5" inputmode="decimal" placeholder="labor" aria-label="Labor, dollars per linear foot" data-mat-new-lab></span>' +
      '<button class="btn btn-primary btn--sm" type="button" data-mat-save>Add</button>' +
      '<button class="row-x" type="button" data-mat-cancel aria-label="Cancel">×</button>';
    list.appendChild(li);
    staggerIn([li]);
    li.querySelector<HTMLInputElement>('.mat-new-name')?.focus();
  }

  function closeMatAdd() {
    $('#matList .mat-new')?.remove();
  }

  /** Commit the add row. A type with no name or no rates is not a type, so
   *  the row stays open and says which field is missing. */
  function saveMatAdd() {
    const li = $('#matList .mat-new');
    if (!li) return;
    const nameEl = li.querySelector<HTMLInputElement>('.mat-new-name');
    const likeEl = li.querySelector<HTMLSelectElement>('[data-mat-like]');
    const matEl = li.querySelector<HTMLInputElement>('[data-mat-new-mat]');
    const labEl = li.querySelector<HTMLInputElement>('[data-mat-new-lab]');
    const name = (nameEl?.value || '').trim();
    const mat = parseFloat(matEl?.value || '');
    const lab = parseFloat(labEl?.value || '');
    if (!name) { nameEl?.focus(); sayHint('Give the type a name before adding it.'); return; }
    if (!Number.isFinite(mat) || mat <= 0) { matEl?.focus(); sayHint('Give the type a material price per linear foot.'); return; }
    if (!Number.isFinite(lab) || lab <= 0) { labEl?.focus(); sayHint('Give the type a labor price per linear foot.'); return; }
    matSeq += 1;
    const like = (likeEl?.value || DEFAULT_FENCE_TYPE) as FenceTypeId;
    const c: CustomFenceType = {
      id: 'custom-' + matSeq,
      label: name,
      like: like,
      materialPerLf: mat,
      laborPerLf: lab,
      color: CUSTOM_COLORS[(matSeq - 1) % CUSTOM_COLORS.length],
    };
    fs.customs.push(c);
    saveRate();
    li.remove();
    const list = $('#matList');
    if (list && !list.querySelector('.mat-cat[data-custom]')) {
      const head = document.createElement('li');
      head.className = 'mat-cat';
      head.dataset.custom = '1';
      head.setAttribute('aria-hidden', 'true');
      head.textContent = 'Your own';
      list.appendChild(head);
    }
    appendRow(list, matRowHtml(typeRow(c.id)));
    // Added means chosen: a contractor typing in their own fence type is
    // pricing THIS job with it.
    const row = $('#matList [data-mat="' + c.id + '"]');
    if (row) pickMaterial(row);
    else renderFigures();
  }

  /** Remove a type the shop added. Built-ins have no delete. */
  function deleteMaterial(id: string) {
    const li = $('#matList [data-mat="' + id + '"]');
    fs.customs = fs.customs.filter(function (c) { return c.id !== id; });
    saveRate();
    const fallback = () => {
      if (!fs.customs.length) $('#matList .mat-cat[data-custom]')?.remove();
      // The deleted type cannot stay picked; the catalog's first entry is the
      // page's own default and is always present.
      if (fs.material === id) {
        fs.material = DEFAULT_FENCE_TYPE;
        const next = $('#matList [data-mat="' + fs.material + '"]');
        if (next) pickMaterial(next);
      }
      renderFigures();
    };
    if (li) leave(li, fallback);
    else fallback();
  }

  /** "Save as company defaults": the book, the shop's types and the site
   *  rates go to the organization, for every estimator in it. */
  async function saveOrgBook(btn: HTMLElement) {
    if (btn.dataset.busy) return;
    btn.dataset.busy = '1';
    const old = btn.innerHTML;
    btn.innerHTML = '<svg class="ic"><use href="#i-check"/></svg>Saving…';
    try {
      const res = await saveFenceCatalog({ version: 1, rates: fs.rates, custom: fs.customs, removalPerLf: fs.removalPerLf, wastePct: fs.wastePct });
      if (res.ok) {
        btn.innerHTML = '<svg class="ic"><use href="#i-check"/></svg>Saved for the company';
        sayHint('Your rates and types are now the company defaults — every estimator on this account prices with them.');
      } else {
        btn.innerHTML = old;
        sayHint(res.error);
      }
    } catch (err) {
      btn.innerHTML = old;
      sayHint(err instanceof Error && err.message.length <= 160 ? err.message : 'The price book could not be saved. Try again.');
    }
    after(function () { btn.innerHTML = old; delete btn.dataset.busy; }, 2400);
  }

  // ================= FULL-SCREEN STAGE =================
  // While tracing, the map (or the 3D view) can take the whole screen: the
  // stage card goes to the browser's full screen where the browser allows it
  // (desktop, Android), and everywhere else — iOS Safari has no element full
  // screen — it becomes a fixed overlay over the page, which is the same
  // thing to the eye. The `is-full` class carries the layout in both cases;
  // the same button, or Escape, leaves. The map surface is told to re-lay
  // its tiles once the new size has settled.
  let stageFull = false;
  function stageEl(): HTMLElement | null { return $('.fs-stage'); }
  function paintFullBtn() {
    const btn = $('#fullBtn');
    if (!btn) return;
    btn.setAttribute('aria-pressed', stageFull ? 'true' : 'false');
    btn.setAttribute('aria-label', stageFull ? 'Leave full screen' : 'Full screen');
    btn.title = stageFull ? 'Leave full screen — Esc' : 'Full screen map — Esc to leave';
    btn.querySelector('use')?.setAttribute('href', stageFull ? '#i-collapse' : '#i-expand');
    btn.classList.toggle('on', stageFull);
  }
  /** Once the layout has settled (two frames), the surfaces read their new size. */
  function afterStageResize() {
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        mapApi?.resized();
        pushMap();
        pushModel();
      });
    });
    after(function () { mapApi?.resized(); }, 380);
  }
  function setStageFull(on: boolean) {
    const stage = stageEl();
    if (!stage || stageFull === on) return;
    stageFull = on;
    stage.classList.toggle('is-full', on);
    root.classList.toggle('is-stage-full', on);
    document.documentElement.classList.toggle('jf-stage-full', on);
    paintFullBtn();
    // The browser's own full screen, where it exists. A refusal (a browser
    // that has none, or one that wants a gesture it did not get) leaves the
    // overlay, which already fills the viewport.
    const doc = document as Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => Promise<void> | void };
    const el = stage as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };
    if (on) {
      const req = el.requestFullscreen ?? el.webkitRequestFullscreen;
      if (req) {
        try { void Promise.resolve(req.call(el)).catch(function () {}); } catch { /* overlay it is */ }
      }
      // Anything armed or aligning stays; the trace continues on the bigger surface.
    } else {
      const active = document.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
      if (active === stage) {
        const exit = document.exitFullscreen ?? doc.webkitExitFullscreen;
        if (exit) { try { void Promise.resolve(exit.call(document)).catch(function () {}); } catch { /* already out */ } }
      }
    }
    afterStageResize();
  }
  // The browser left full screen on its own (Escape, a system gesture, a tab
  // switch): the overlay must follow, or the page would stay pinned.
  const onFullscreenChange = function () {
    const doc = document as Document & { webkitFullscreenElement?: Element | null };
    const active = document.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
    if (stageFull && !active) setStageFull(false);
  };
  on(document, 'fullscreenchange', onFullscreenChange);
  on(document, 'webkitfullscreenchange', onFullscreenChange);
  disposers.push(function () {
    // A navigation away must not leave the page pinned or the browser full screen.
    if (stageFull) setStageFull(false);
  });

  // ================= EVENTS =================
  on(document, 'click', function (e) {
    if (!(e.target instanceof Element)) return;
    const target = e.target;
    if (target.closest('#fullBtn')) {
      setStageFull(!stageFull);
      return;
    }
    // Before `[data-mat]`: these controls live INSIDE a material row, and the
    // row's own handler would otherwise swallow the click.
    const rateCell = target.closest<HTMLElement>('[data-rate]');
    if (rateCell) {
      editRate(rateCell);
      return;
    }
    const delMat = target.closest<HTMLElement>('[data-del-mat]');
    if (delMat) {
      deleteMaterial(delMat.dataset.delMat || '');
      return;
    }
    const rateSave = target.closest<HTMLElement>('[data-rate-save]');
    if (rateSave) { saveRateStrip(rateSave.dataset.rateSave || ''); return; }
    const rateReset = target.closest<HTMLElement>('[data-rate-reset]');
    if (rateReset) { resetRateStrip(rateReset.dataset.rateReset || ''); return; }
    if (target.closest('[data-rate-cancel]')) { closeRateStrip(); return; }
    if (target.closest('.mat-edit')) return;
    if (target.closest('[data-mat-save]')) { saveMatAdd(); return; }
    if (target.closest('[data-mat-cancel]')) { closeMatAdd(); return; }
    if (target.closest('.mat-new')) return;
    if (target.closest('#matAdd')) { openMatAdd(); return; }
    const saveBook = target.closest<HTMLElement>('#saveBook');
    if (saveBook) { void saveOrgBook(saveBook); return; }
    const tier = target.closest<HTMLElement>('[data-tier]');
    if (tier) {
      const base = resolveFenceType(fs.tierBase, fs.customs);
      const picked = fenceTiers(base.type.id, fs.height).find(function (t) { return t.id === tier.dataset.tier; });
      if (!picked) return;
      // Price the tier's type; the ladder stays on the designed fence.
      fs.tier = picked.id;
      fs.material = picked.type;
      if (base.type.stainable || picked.stain) fs.stain = picked.stain;
      rememberTier();
      $$('#matList [data-mat]').forEach(function (li) {
        const on = li.dataset.mat === fs.material;
        li.classList.toggle('on', on);
        li.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      renderHeights();
      renderSite();
      renderPops();
      renderFigures();
      return;
    }
    const md = target.closest<HTMLElement>('[data-mode]');
    if (md) {
      setStageMode(md.dataset.mode || '');
      return;
    }
    // Material / height / demo change the PRICE, not the lists. Mark the picked
    // option in place and repaint the figures — rebuilding `#matList` here is
    // what made choosing a material re-cascade the whole material list.
    const m = target.closest<HTMLElement>('[data-mat]');
    if (m) {
      pickMaterial(m);
      return;
    }
    const h = target.closest<HTMLElement>('[data-h]');
    if (h) {
      fs.height = Number(h.dataset.h);
      heightAsked = fs.height;
      $$('#heights [data-h]').forEach(function (b) { b.classList.toggle('on', b === h); });
      renderSite();
      renderPops();
      renderFigures();
      return;
    }
    if (target.closest('#demoTgl')) {
      fs.demo = !fs.demo;
      $('#demoTgl')?.classList.toggle('on', fs.demo);
      renderFigures();
      return;
    }
    if (target.closest('#stainTgl')) {
      fs.stain = !fs.stain;
      $('#stainTgl')?.classList.toggle('on', fs.stain);
      // Stain IS the difference between Better and Best on a wood fence.
      if (fs.material === fs.tierBase && resolveFenceType(fs.tierBase, fs.customs).type.stainable) fs.tier = fs.stain ? 'best' : 'better';
      rememberTier();
      renderFigures();
      return;
    }
    const up = target.closest<HTMLElement>('[data-upgrade]');
    if (up) {
      const v = up.dataset.upgrade || '';
      fs.postUpgrade = (POST_SYSTEM_ORDER as string[]).includes(v) ? (v as PostSystem) : null;
      renderSite();
      renderFigures();
      return;
    }
    const grade = target.closest<HTMLElement>('[data-grade]');
    if (grade) {
      const v = grade.dataset.grade;
      fs.boardGrade = v === 'tight-knot-1' || v === 'clear' ? v : 'standard';
      $$('#gradeRow [data-grade]').forEach(function (b) { b.classList.toggle('on', b === grade); });
      renderFigures();
      return;
    }
    const fasten = target.closest<HTMLElement>('[data-fasten]');
    if (fasten) {
      fs.fasteners = fasten.dataset.fasten === 'stainless' ? 'stainless' : 'galvanized';
      $$('#fastenRow [data-fasten]').forEach(function (b) { b.classList.toggle('on', b === fasten); });
      renderFigures();
      return;
    }
    const hw = target.closest<HTMLElement>('[data-gatehw]');
    if (hw) {
      fs.gateHardware = hw.dataset.gatehw === 'heavy-duty' ? 'heavy-duty' : 'standard';
      $$('#gateHwRow [data-gatehw]').forEach(function (b) { b.classList.toggle('on', b === hw); });
      renderFigures();
      return;
    }
    if (target.closest('#gatePostsTgl')) {
      fs.steelGatePosts = !fs.steelGatePosts;
      $('#gatePostsTgl')?.classList.toggle('on', fs.steelGatePosts);
      renderFigures();
      return;
    }
    if (target.closest('#clearTgl')) {
      fs.clearLine = !fs.clearLine;
      $('#clearTgl')?.classList.toggle('on', fs.clearLine);
      renderFigures();
      return;
    }
    if (target.closest('#haulTgl')) {
      fs.haulSoil = !fs.haulSoil;
      $('#haulTgl')?.classList.toggle('on', fs.haulSoil);
      renderFigures();
      return;
    }
    const sp = target.closest<HTMLElement>('[data-spacing]');
    if (sp) {
      const v = Number(sp.dataset.spacing);
      fs.spacing = sp.dataset.spacing && Number.isFinite(v) ? v : null;
      $$('#spacingRow [data-spacing]').forEach(function (b) { b.classList.toggle('on', b === sp); });
      renderFigures();
      return;
    }
    const gr = target.closest<HTMLElement>('[data-terrain]');
    if (gr) {
      const v = gr.dataset.terrain;
      fs.terrain = v === 'auto' ? 'auto' : (TERRAINS.find(function (k) { return k === v; }) || 'auto');
      renderSite();
      renderFigures();
      return;
    }

    const menuBtn = target.closest<HTMLElement>('[data-menu]');
    if (menuBtn) {
      const box = $(menuBtn.dataset.menu === 'gate' ? '#popGate' : '#popDoor');
      if (!box) return;
      const wasOpen = box.classList.contains('open');
      closePops();
      if (!wasOpen) box.classList.add('open');
      return;
    }
    const addOpen = target.closest<HTMLElement>('[data-add-open]');
    if (addOpen) {
      const pick = addOpen.dataset.addOpen || '';
      closePops();
      // With a live surface and something traced, picking a type ARMS the map:
      // the next click seats the opening on a run, which is what makes the row's
      // "Run 3" mean anything. With no key, or nothing drawn yet, it still drops
      // straight into the ledger the way it always did.
      if (mapApi && mapPoints.length >= 2) {
        const t = opType(pick);
        setArmed({
          kind: (t.kind === 'door' ? 'door' : 'gate') as OpeningKind,
          variant: pick,
          widthFt: t.width,
        });
        return;
      }
      opSeq += 1;
      const o: FenceOpening = {
        id: 'o' + opSeq,
        type: pick,
        run: fs.runs.length ? 1 : null,
      };
      fs.openings.push(o);
      appendRow($('#openList'), openRowHtml(o));
      syncOpenEmpty();
      renderFigures();
      return;
    }
    if (!target.closest('.tool-pop')) closePops();

    const act = target.closest<HTMLElement>('[data-act]');
    if (act) {
      const kind = act.dataset.act;
      // Add run APPENDS one row. It used to rebuild the list, so every existing
      // run faded out and cascaded back in just to make room for the new one.
      if (kind === 'add-run') {
        runSeq += 1;
        const r: FenceRun = { id: 'r' + runSeq, ft: 20 };
        fs.runs.push(r);
        appendRow($('#runsList'), runRowHtml(r, fs.runs.length - 1));
        renderFigures();
        return;
      }
      // Once a trace owns the ledger these three drive the MAP, and the ledger
      // follows from the path it commits. Driving `fs.runs` directly here would
      // make the two disagree the moment the next vertex landed.
      if (kind === 'close-loop') {
        if (mapOwnsRuns && mapApi) { mapApi.closeLoop(); return; }
        if (fs.runs.length) {
          runSeq += 1;
          const r: FenceRun = { id: 'r' + runSeq, ft: Math.round(totalFt() * 0.12) || 12 };
          fs.runs.push(r);
          appendRow($('#runsList'), runRowHtml(r, fs.runs.length - 1));
        }
        renderFigures();
        return;
      }
      // Undo takes back the LAST thing done on the map, whatever it was
      // (2026-09-28, owner: "when I outline the house I want to go back or
      // delete the outline"): a corner of the house being traced, then the
      // outline that just closed (its corners come back as the draft), a
      // house just removed, or the last fence dot — whichever is newest.
      if (kind === 'undo') {
        if (mapApi && draftState.houseCorners > 0) { mapApi.undoDraft(); return; }
        const entry = houseUndo[houseUndo.length - 1];
        if (entry && mapApi && (entry.seq > fenceSeq || !mapPoints.length)) { undoHouse(); return; }
        if (mapOwnsRuns && mapApi) { holdStamp(); mapApi.undo(); return; }
        // The donor stopped at one run because an empty ledger was not a state
        // it could render. It is now (`#runsEmpty`), so undo goes all the way.
        if (!fs.runs.length) return;
        const last = $$('#runsList [data-run]').pop();
        if (!last) return;
        leave(last, function () {
          fs.runs.pop();
          renumberRuns();
          renderFigures();
        });
        return;
      }
      // Clear and Reset genuinely re-list everything, so those DO cascade.
      // While a house is being traced, Clear drops THAT outline and nothing
      // else — the fence is not what the hand was on.
      if (kind === 'clear') {
        if (mapApi && draftState.houseCorners > 0) {
          mapApi.cancelDraft();
          sayHint('Outline dropped · House starts another · Clear again clears the fence');
          return;
        }
        fs.runs = []; fs.openings = []; renderStudio(); playStagger?.();
        setArmed(null);
        mapApi?.clear();
        return;
      }
      // Align is a MODE on the surface, so the button rests in an active state
      // instead of flashing a confirmation. Without a surface it falls through
      // to the donor's [data-flash] tick below.
      if (kind === 'align' && mapApi) {
        aligning = !aligning;
        mapApi.setAlign(aligning);
        if (aligning) { setArmed(null); setHouseMode(false); }
        act.classList.toggle('on', aligning);
        syncHint();
        return;
      }
      // The ReportAll boundary raster — a MODE like Align, so the button rests
      // active. Tiles ride an ALLTIME quota; the layer mounts only on demand.
      if (kind === 'lot-lines') {
        lotLines = !lotLines;
        act.classList.toggle('on', lotLines);
        act.setAttribute('aria-pressed', String(lotLines));
        pushMap();
        return;
      }
      // Contours on the land — on by default, a MODE like Lot lines. Turning it
      // off hides the lines, labels, legend and side grades; turning it back on
      // reads the ground if it has not been read for this lot yet.
      // House — with no house drawn yet it DRAWS the house: the layer shows
      // and the outline tool is armed, so the next clicks on the map are the
      // house's corners. (2026-09-27: a contractor pressed House, clicked round
      // the roof, and got a fence — the button only showed the layer, and the
      // tool lived in the panel under the map.) Pressed again while tracing it
      // puts the tool down. With a house drawn it shows and hides the layer
      // (outline, tint, area label); a click on the outline picks it up, and
      // "Trace outline" in the Buildings panel adds another.
      if (kind === 'house') {
        if (houseMode) { setHouseMode(false); return; }
        if (!houses.length && mapOrigin) {
          // The corners are clicked on the photo: the 3D view gives way to the map.
          if (fs.mode === '3d') showDrawView();
          setHouseLayer(true, true);
          setHouseMode(true);
          return;
        }
        setHouseLayer(!houseLayer, true);
        return;
      }
      if (kind === 'topo') {
        topoOn = !topoOn;
        act.classList.toggle('on', topoOn);
        act.setAttribute('aria-pressed', String(topoOn));
        if (topoOn) ensureTopo();
        else paintTopo();
        return;
      }
    }
    const draftBtn = target.closest<HTMLElement>('[data-draft]');
    if (draftBtn && mapApi) {
      const what = draftBtn.dataset.draft;
      if (what === 'undo') mapApi.undoDraft();
      else if (what === 'finish') mapApi.finishDraft();
      else if (what === 'cancel') mapApi.cancelDraft();
      return;
    }
    const delHouse = target.closest<HTMLElement>('[data-del-house]');
    if (delHouse) {
      removeHouse(delHouse.dataset.delHouse ?? '');
      return;
    }
    // Redraw: the outline goes and the tool is back in hand for a fresh one.
    const redrawHouse = target.closest<HTMLElement>('[data-redraw-house]');
    if (redrawHouse) {
      removeHouse(redrawHouse.dataset.redrawHouse ?? '');
      if (fs.mode === '3d') showDrawView();
      setHouseLayer(true, true);
      setHouseMode(true);
      sayHint('Outline removed — click each corner of the house again · Undo brings the old one back');
      return;
    }
    if (target.closest('[data-house-trace]')) {
      setHouseMode(!houseMode);
      return;
    }
    if (target.closest('[data-house-shift-reset]')) {
      setSiteShift({ x: 0, y: 0 });
      return;
    }
    if (target.closest('[data-house-detect]')) {
      const b = pickSubject();
      if (b) {
        houseFromFootprint(b, true);
        afterHousesChanged();
      }
      return;
    }
    const editHouse = target.closest<HTMLElement>('[data-edit-house]');
    if (editHouse) {
      onHouseSelect(houseSel === editHouse.dataset.editHouse ? null : editHouse.dataset.editHouse ?? null);
      return;
    }
    if (target.closest('[data-house-done]')) {
      onHouseSelect(null);
      return;
    }
    if (target.closest('[data-topo-retry]')) {
      topoAsked = null;
      const legend = $('#topoLegend');
      if (legend) { legend.tabIndex = -1; legend.focus({ preventScroll: true }); }
      ensureTopo();
      return;
    }
    const delRun = target.closest<HTMLElement>('[data-del-run]');
    if (delRun) {
      const li = delRun.closest<HTMLElement>('[data-run]');
      if (!li) return;
      // A traced run IS a piece of the line on the map, and the price measures the line: dropping only its row
      // left the run drawn, in 3D and in the price (a 50+100+50 U read 100 ft on the strip and priced 200 lf —
      // 2026-11-10). So the piece comes off the map: the line breaks there (the point after it starts a new
      // stretch), and every other run keeps its number.
      const id = li.dataset.run || '';
      const seg = mapOwnsRuns && /^m\d+$/.test(id) ? Number(id.slice(1)) : -1;
      leave(li, function () {
        if (seg >= 0 && seg + 1 < mapPoints.length) {
          const pts = mapPoints.map(function (pt) { return Object.assign({}, pt); });
          pts[seg + 1].gap = true;
          applyTracedPath(pts);
          return;
        }
        fs.runs = fs.runs.filter(function (r) { return r.id !== li.dataset.run; });
        renumberRuns();
        renderFigures();
      });
      return;
    }
    const delOp = target.closest<HTMLElement>('[data-del-op]');
    if (delOp) {
      const li = delOp.closest<HTMLElement>('[data-op]');
      if (!li) return;
      leave(li, function () {
        fs.openings = fs.openings.filter(function (o) { return o.id !== li.dataset.op; });
        syncOpenEmpty();
        renderFigures();
      });
      return;
    }
    if (target.closest('#resetBtn')) {
      // Reset used to reinstate a 3-run demo fixture. With the ledger backed by
      // a real trace there is nothing to reinstate: reset is "start this
      // property over", so the geometry goes and the SPEC (material, height,
      // teardown) returns to the page's defaults.
      fs.runs = [];
      fs.openings = [];
      fs.demo = false;
      fs.stain = false;
      fs.postUpgrade = null;
      fs.boardGrade = 'standard';
      fs.fasteners = 'galvanized';
      fs.gateHardware = 'standard';
      fs.steelGatePosts = true;
      fs.clearLine = false;
      fs.haulSoil = false;
      fs.spacing = null;
      fs.terrain = 'auto';
      fs.material = DEFAULT_FENCE_TYPE;
      fs.tierBase = DEFAULT_FENCE_TYPE;
      fs.tier = 'better';
      rememberTier();
      fs.height = 6;
      heightAsked = 6;
      clearFenceDone();
      // The rate card and any materials the shop added SURVIVE: they are the
      // shop's prices, not this property's geometry.
      renderStudio();
      playStagger?.();
      mapOwnsRuns = false;
      mapPoints = [];
      setSiteBuildings([]);
      houses = [];
      houseUndo.length = 0;
      resetHouseLookup();
      setHouseMode(false);
      houseLayerTouched = false;
      setHouseLayer(false);
      renderHousePanel();
      // Takes the 3D scene down with it — there is no longer a fence to show.
      syncStage();
      setArmed(null);
      if (aligning && mapApi) {
        aligning = false;
        mapApi.setAlign(false);
        $$('[data-act="align"]').forEach(function (b) { b.classList.remove('on'); });
        syncHint();
      }
      mapApi?.clear();
      return;
    }
    // Drives the map, then falls through so the button still flashes its tick.
    const zoomBtn = target.closest<HTMLElement>('[data-zoom]');
    if (zoomBtn) mapApi?.zoomBy(Number(zoomBtn.dataset.zoom));
    const flashIcon = target.closest<HTMLElement>('[data-flash-icon]');
    if (flashIcon && !flashIcon.dataset.busy) {
      flashIcon.dataset.busy = '1';
      flashIcon.classList.add('done');
      after(function () { flashIcon.classList.remove('done'); delete flashIcon.dataset.busy; }, 500);
      return;
    }
    const fl = target.closest<HTMLElement>('[data-flash]');
    if (fl && !fl.dataset.busy) {
      fl.dataset.busy = '1';
      const old = fl.innerHTML;
      fl.innerHTML = '<svg class="ic"><use href="#i-check"/></svg>' + fl.dataset.flash;
      after(function () { fl.innerHTML = old; delete fl.dataset.busy; }, 1400);
      return;
    }
    if (target.closest('#findBtn')) {
      const btn = target.closest<HTMLElement>('#findBtn');
      if (!btn || btn.dataset.busy) return;
      // With a browser key configured, Find geocodes whatever is typed — so a
      // full address resolves even when the user never picks a suggestion.
      if (isMapsBrowserEnabled()) { void geocodeTyped(btn); return; }
      btn.dataset.busy = '1';
      const old = btn.innerHTML;
      btn.innerHTML = '<svg class="ic"><use href="#i-check"/></svg>No map key';
      after(function () { btn.innerHTML = old; delete btn.dataset.busy; }, 1600);
      return;
    }
    if (target.closest('#fenceBtn')) {
      const btn = target.closest<HTMLElement>('#fenceBtn');
      if (!btn || btn.dataset.busy) return;
      putDownTheFence(btn);
      return;
    }
    const conv = target.closest<HTMLElement>('#convertBtn');
    if (conv && !conv.dataset.busy) {
      void convertToProposal(conv);
    }
  });
  // Enter/Space on a material row selects it exactly like a click — the rows
  // are focusable options, not buttons, so the key path is wired by hand.
  on(document, 'keydown', function (e) {
    const ev = e as KeyboardEvent;
    if (!(ev.target instanceof Element)) return;
    // Escape leaves the full-screen overlay — unless a run or a house is
    // being traced, when the surface's own Escape (cancel the draft) wins.
    // In the browser's real full screen the browser handles Escape itself.
    if (ev.key === 'Escape' && stageFull && !document.fullscreenElement && !draftState.fence && draftState.houseCorners === 0 && !armed) {
      ev.preventDefault();
      setStageFull(false);
      return;
    }
    // The add-type row is a small form: Enter adds it, Esc drops it. Same for
    // the rate strip under a type row.
    if (ev.target.closest('.mat-new')) {
      if (ev.key === 'Enter') { ev.preventDefault(); saveMatAdd(); }
      else if (ev.key === 'Escape') { ev.preventDefault(); closeMatAdd(); }
      return;
    }
    const strip = ev.target.closest<HTMLElement>('.mat-edit');
    if (strip) {
      if (ev.key === 'Enter') { ev.preventDefault(); saveRateStrip(strip.dataset.for || ''); }
      else if (ev.key === 'Escape') { ev.preventDefault(); closeRateStrip(); }
      return;
    }
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    // Enter/Space on the rate cell opens the editor — it is a button inside the
    // row, so the row's own key handler must not answer for it.
    const rate = ev.target.closest<HTMLElement>('[data-rate]');
    if (rate) {
      ev.preventDefault();
      editRate(rate);
      return;
    }
    const m = ev.target.closest<HTMLElement>('[data-mat]');
    if (m) {
      ev.preventDefault(); // Space must select, not scroll the page.
      pickMaterial(m);
    }
  });

  on(document, 'input', function (e) {
    const t = e.target;
    if (!(t instanceof HTMLInputElement)) return;
    if (t.matches('#removalRate')) {
      const n = parseFloat(t.value);
      fs.removalPerLf = Number.isFinite(n) && n >= 0 ? n : DEFAULT_REMOVAL_PER_LF;
      saveRate();
      renderFigures();
      return;
    }
    if (t.matches('[data-run-ft]')) {
      const li = t.closest<HTMLElement>('[data-run]');
      if (!li) return;
      const r = fs.runs.find(function (x) { return x.id === li.dataset.run; });
      if (r) { r.ft = Math.max(0, parseInt(t.value, 10) || 0); }
      // A run can't be negative: the field said "-20" while the price counted 0.
      if (parseInt(t.value, 10) < 0) t.value = '0';
      renderTicket();
      renderTakeoff();
      const strip = $('#statStrip');
      if (strip) strip.innerHTML = statStripHtml();
      return;
    }
  });
  on(document, 'change', function (e) {
    const t = e.target;
    if (!(t instanceof HTMLSelectElement)) return;
    if (t.matches('[data-house-stories]')) {
      const li = t.closest<HTMLElement>('[data-house]');
      const id = li?.dataset.house;
      const n = Number(t.value);
      houses = houses.map(function (h) {
        return h.id === id ? { id: h.id, ring: h.ring, stories: (n === 3 ? 3 : n === 2 ? 2 : 1) as 1 | 2 | 3 } : h;
      });
      afterHousesChanged(true);
      return;
    }
    if (t.matches('[data-op-type]')) {
      const li = t.closest<HTMLElement>('[data-op]');
      if (!li) return;
      const o = fs.openings.find(function (x) { return x.id === li.dataset.op; });
      if (!o) return;
      o.type = t.value;
      // Patch this row's icon, width and price. Re-rendering the list here
      // destroyed the <select> the user had just used — which also stole focus
      // from it — and re-cascaded every other opening.
      paintOpenRow(li, o);
      renderFigures();
      return;
    }
  });

  // ================= MAP SURFACE (React island) =================
  // The draw surface is the studio's existing React component,
  // components/estimator/fence/FenceDrawMap, mounted here through the island
  // bridge rather than re-derived as imperative DOM. It carries the editable
  // google.maps.Polyline plumbing, the pixel-radius vertex magnets, the armed-
  // opening ghost and the marker-drag maths — none of which is design, and all
  // of which would otherwise exist twice.
  //
  // The page keeps its own chrome: `.stage-tools`, `.stage-zoom` and
  // `.stage-hint` are the blueprint design, so the surface mounts with
  // `chrome: false` and this module drives it through the api it hands back.
  //
  // THE TWO VOCABULARIES
  //   surface → `points: PathPoint[]`, LOCAL FEET about the searched address.
  //             Fence exists between points[i] and points[i+1] UNLESS
  //             points[i+1].gap marks a run break (a second, disconnected fence).
  //   ledger  → `fs.runs`, a flat list of lengths.
  // One traced SEGMENT is one ledger run — the same numbering the old studio's
  // ledger used — so the mapping is: every non-gap segment, in trace order,
  // becomes one `fs.runs` row carrying its length in feet.

  let mapIsland: Island<FenceDrawMapProps> | null = null;
  let mapApi: FenceDrawMapApi | null = null;
  /** The traced path in local feet. The surface owns it; this is the mirror. */
  let mapPoints: PathPoint[] = [];
  /**
   * Bumped whenever THIS module produces the path instead of the surface (the
   * parcel ring). It is the only thing that makes the surface re-seed its
   * polylines from `points` — during a trace the surface is the owner and
   * ignores the prop, which is what stops a commit from feeding back into it.
   */
  let mapRev = 0;
  let mapOrigin: { lat: number; lng: number } | null = null;
  let armed: ArmedOpening | null = null;
  let aligning = false;
  // ── Cadastral parcel (ReportAll via /api/parcels) ──
  /**
   * The PROPERTY, lot by lot. A point query answers with the lot the pin is in,
   * but a house bought as two adjoining deeds is two lots and the fence goes
   * round both — so every lot the lookup returned is held here and every one of
   * them is drawn. There is no "which lot" picker any more: the land is the
   * land, and a deed boundary running through the middle of it is not a choice
   * the contractor has to make.
   */
  interface ParcelLot {
    choice: ParcelChoiceApi;
    /** The lot's outer ring as surveyed, [lat, lng] — full resolution. */
    ringPts: RingPoint[];
    /** The same ring in the map's vocabulary — a polygon overlay path. */
    ring: Array<{ lat: number; lng: number }>;
    /** Readable walls: consecutive collinear segments merged (lib/parcels
     *  groupSides), so a 22-segment survey lists as 4–8 rows. */
    sides: ParcelSide[];
    /** Which sides the fence is laid along — the street side defaults to off,
     *  but only when the geometry singles one out (see detectFrontSides). */
    checked: boolean[];
    /** The sides this lot's frontage matched, for the row's street tag. */
    fronts: FrontSideMatch[];
  }
  let parcelLots: ParcelLot[] = [];
  /** Hovered row in the sides list — highlighted on the map. */
  let parcelHover: { lot: number; side: number } | null = null;
  /** Whether the answer cost quota — shown in the panel meta line. */
  let parcelWasCached = false;
  /** OSM street centrelines from the same load, kept so a re-render can decide
   *  frontage again without a second Overpass round trip. */
  let parcelRoads: RoadLine[] = [];
  /** ReportAll raster boundary tiles (the "Lot lines" tool). */
  let lotLines = false;
  let parcelBusy = false;
  /**
   * True once a trace has produced at least one segment. Until then the donor's
   * demo ledger stands: the first click on the map lays ONE vertex and no
   * segment, and taking that literally would blank the ledger and the price
   * before anything had been drawn.
   */
  let mapOwnsRuns = false;

  // ================= TERRAIN (Google Elevation profile) =================
  // Every settled change of the traced line re-profiles the ground under it:
  // samples ~every 10 ft → the fetchElevationProfile action (disk-cached,
  // GOOGLE_MAPS_API_KEY) → fenceTerrain turns the answer into per-segment
  // slope facts. Debounced so a vertex drag costs ONE request, not sixty.
  // Failure is a state, not a throw: the price falls back to plan footage and
  // the proposal's assumptions say so.
  /** The ground as the Elevation API answered it — re-read under the type's
   *  own rules by `classifiedTerrain`. */
  let terrainRaw: { segs: ReturnType<typeof sampleFencePath>['segs']; elevFt: number[] } | null = null;
  let terrainReport: FenceTerrainReport | null = null;
  let terrainStatus: 'idle' | 'busy' | 'ok' | 'failed' = 'idle';
  /** Bumped on every trace commit; an answer for an older stamp is dropped. */
  let terrainStamp = 0;
  let terrainTimer: ReturnType<typeof setTimeout> | null = null;
  const TERRAIN_DEBOUNCE_MS = 700;

  function scheduleTerrain() {
    terrainStamp += 1;
    if (terrainTimer) { clearTimeout(terrainTimer); timers.delete(terrainTimer); }
    const id = setTimeout(function () {
      timers.delete(id);
      terrainTimer = null;
      void refreshTerrain();
    }, TERRAIN_DEBOUNCE_MS);
    timers.add(id);
    terrainTimer = id;
  }

  async function refreshTerrain() {
    const stamp = terrainStamp;
    const o = mapOrigin;
    if (!o || !tracedSegments(mapPoints).length) {
      terrainRaw = null;
      terrainReport = null;
      terrainStatus = 'idle';
      paintTerrain();
      return;
    }
    terrainStatus = 'busy';
    const sampling = sampleFencePath(mapPoints, o);
    try {
      const res = await fetchElevationProfile(sampling.samples);
      if (stamp !== terrainStamp) return; // the line moved on — a newer request is queued
      if (res.ok) {
        terrainRaw = { segs: sampling.segs, elevFt: res.elevFt };
        terrainReport = null;
        terrainStatus = 'ok';
      } else {
        terrainRaw = null;
        terrainReport = null;
        terrainStatus = 'failed';
        console.warn('[fence-estimator] elevation profile failed:', res.error);
      }
    } catch (err) {
      if (stamp !== terrainStamp) return;
      terrainRaw = null;
      terrainReport = null;
      terrainStatus = 'failed';
      console.warn('[fence-estimator] elevation profile failed:', err);
    }
    paintTerrain();
  }

  /** The profile read under the CURRENT type's rules — its post spacing
   *  (steps are one per bay) and how steep its build can rack — so a change
   *  of type, height or spacing re-reads the same ground without another
   *  Elevation call. */
  let terrainRulesKey = '';
  function classifiedTerrain(): FenceTerrainReport | null {
    if (!terrainRaw) return null;
    const b = currentBuild();
    const key = b.spacingFt + '|' + b.rackMaxDeg;
    if (terrainReport && terrainRulesKey === key) return terrainReport;
    terrainRulesKey = key;
    terrainReport = terrainFromProfile(terrainRaw.segs, terrainRaw.elevFt, { sectionFt: b.spacingFt, rackMaxDeg: b.rackMaxDeg });
    return terrainReport;
  }

  /** Everything the measured ground repaints: the figures (billed footage),
   *  and the map's slope overlay. */
  function paintTerrain() {
    // The Ground card reads the same profile as the price ("Measured: grade 6% avg … labor ×1.18"); it was only
    // redrawn on a click, so it kept saying "flat until measured · labor ×1" beside a price that already carried
    // the slope (2026-11-10).
    renderSite();
    renderFigures();
    pushMap();
    renderModelNote();
  }

  // ================= TOPOGRAPHY (contours on the land) =================
  // One elevation lattice per property — the lot's bounding box plus a margin,
  // or the ground around the address when no lot came back — through the same
  // elevation action as the fence profile (USGS lidar first). fenceTopo turns
  // it into contour lines, labels and HIGH / LOW marks the map draws, the
  // legend over the map, and a grade on every property side before a fence is
  // down. The PRICE still reads only the traced line's own profile.
  let topoOn = true;
  const TOPO_FIT_PADDING = { top: 112, right: 48, bottom: 48, left: 48 };
  let topoStatus: 'idle' | 'busy' | 'ok' | 'failed' = 'idle';
  let topoError = '';
  let topoGrid: {
    origin: { lat: number; lng: number };
    plan: TopoGridPlan;
    grid: number[][];
    source: ElevationSource;
    resM?: number;
    rev: number;
  } | null = null;
  /** The lattice last ASKED for (answered, in flight or failed) — what decides
   *  whether a new lot or a longer trace needs another request. */
  let topoAsked: { lat: number; lng: number; box: TopoBox } | null = null;
  let topoStamp = 0;
  let topoRev = 0;
  let topoTimer: ReturnType<typeof setTimeout> | null = null;
  /** Memo of the drawn overlay: the map effect rebuilds only on a new object. */
  let topoView: { key: string; lot: LotTopo } | null = null;
  /** The origin the current `parcelLots` were loaded for. */
  let parcelOrigin: { lat: number; lng: number } | null = null;
  let ringsMemo: { lots: ParcelLot[]; origin: { lat: number; lng: number }; rings: PathPoint[][] } | null = null;

  function sameOrigin(a: { lat: number; lng: number } | null, b: { lat: number; lng: number } | null) {
    return !!a && !!b && a.lat === b.lat && a.lng === b.lng;
  }

  /** The lot's rings in local feet — only while they belong to this origin. */
  function lotRingsFt(o: { lat: number; lng: number }): PathPoint[][] {
    if (!parcelLots.length || !sameOrigin(parcelOrigin, o)) return [];
    if (ringsMemo && ringsMemo.lots === parcelLots && sameOrigin(ringsMemo.origin, o)) return ringsMemo.rings;
    const rings = parcelLots.map(function (l) {
      return l.ringPts.map(function (p) { return latLngToLocalFeet(o, { lat: p[0], lng: p[1] }); });
    });
    ringsMemo = { lots: parcelLots, origin: o, rings: rings };
    return rings;
  }

  /** What must be on the lattice: the lot and the traced fence. */
  function topoCore(o: { lat: number; lng: number }): TopoBox | null {
    const lot = boxOf(lotRingsFt(o).flat());
    const trace = boxOf(mapPoints);
    return unionBox(lot, trace);
  }

  function resetTopo() {
    topoStamp += 1;
    if (topoTimer) { clearTimeout(topoTimer); timers.delete(topoTimer); topoTimer = null; }
    topoGrid = null;
    topoAsked = null;
    topoView = null;
    topoStatus = 'idle';
    topoError = '';
  }

  function scheduleTopo(delayMs: number) {
    if (topoTimer) { clearTimeout(topoTimer); timers.delete(topoTimer); }
    const id = setTimeout(function () {
      timers.delete(id);
      topoTimer = null;
      ensureTopo();
    }, delayMs);
    timers.add(id);
    topoTimer = id;
  }

  /** Ask for a lattice when the one already asked for does not cover the lot
   *  and the fence. A failure is not retried on its own — the legend offers a
   *  retry — so a lookup that is down is not hammered on every trace edit. */
  function ensureTopo() {
    const o = mapOrigin;
    // Read even with the overlay switched off: the 3D view stands the fence on
    // the same lattice. The toggle only hides lines, labels and legend.
    if (!o) { paintTopo(); return; }
    const core = topoCore(o);
    if (topoAsked && sameOrigin(topoAsked, o) && (!core || boxContains(topoAsked.box, core))) {
      paintTopo();
      return;
    }
    void refreshTopo(o, core);
  }

  async function refreshTopo(o: { lat: number; lng: number }, core: TopoBox | null) {
    topoStamp += 1;
    const stamp = topoStamp;
    // Context past the lot so its lines visibly continue, proportional to the
    // lot, never less than 40 ft; with nothing known, 150 ft round the pin.
    let box: TopoBox = { x0: -150, y0: -150, x1: 150, y1: 150 };
    if (core) {
      const span = Math.max(core.x1 - core.x0, core.y1 - core.y0);
      box = padBox(core, Math.max(40, span * 0.2));
      if (!lotRingsFt(o).length) box = unionBox(box, { x0: -150, y0: -150, x1: 150, y1: 150 }) as TopoBox;
    }
    const plan = planTopoGrid(box);
    topoAsked = { lat: o.lat, lng: o.lng, box: planBox(plan) };
    topoStatus = 'busy';
    renderTopoLegend();
    try {
      // A plain fetch, NOT the server action: actions run one at a time, and
      // this picture of the lot must never queue in front of the fence's own
      // profile (the price) or Convert (see lib/elevationProfile).
      const http = await fetch('/api/fence/elevation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ points: topoSamplePoints(plan, o) }),
      });
      const res = (await http.json().catch(function () {
        return { ok: false, error: 'Ground lookup failed (' + http.status + ')' };
      })) as ElevationProfileResult;
      if (stamp !== topoStamp) return;
      const grid = res.ok ? gridFromSamples(plan, res.elevFt) : null;
      if (res.ok && grid) {
        topoRev += 1;
        topoGrid = { origin: o, plan: plan, grid: grid, source: res.source, resM: res.resM, rev: topoRev };
        topoStatus = 'ok';
        topoError = '';
      } else {
        topoStatus = 'failed';
        topoError = res.ok ? 'The ground data came back incomplete' : res.error;
      }
    } catch (err) {
      if (stamp !== topoStamp) return;
      topoStatus = 'failed';
      topoError = err instanceof Error ? err.message : 'Ground lookup failed';
    }
    paintTopo();
  }

  /** The lot's topography for THIS origin and lot, memoised by the lattice
   *  revision and the ring geometry. */
  function currentLotTopo(): LotTopo | null {
    const o = mapOrigin;
    const g = topoGrid;
    if (!o || !g || !sameOrigin(g.origin, o)) return null;
    const rings = lotRingsFt(o);
    const key = g.rev + '|' + rings.map(function (r) {
      return r.length + ':' + (r[0] ? r[0].x.toFixed(1) + ',' + r[0].y.toFixed(1) : '');
    }).join(';');
    if (topoView && topoView.key === key) return topoView.lot;
    const lot = buildLotTopo({
      grid: g.grid,
      plan: g.plan,
      origin: o,
      rings: rings,
      fine: g.source === 'usgs-3dep' && (g.resM ?? 99) <= 3,
    });
    topoView = { key: key, lot: lot };
    return lot;
  }

  /** The property line's look (owner's pick, 2026-09-20, over a white
   *  "geodetic" line): a sky core on a thin ink edge — the map sets the
   *  widths by zoom, 3 px at the most; paper corner squares; the active side and the corner under the cursor
   *  in blueprint. Every colour is a token off `.content`; the map only ever
   *  sees the resolved string. */
  /** A candidate switch on the URL while the owner is choosing: ?line=2 is
   *  the white property line, ?house=2 the hatched house (2026-09-20). */
  function candidate(name: string): 1 | 2 {
    try {
      return new URLSearchParams(window.location.search).get(name) === '2' ? 2 : 1;
    } catch {
      return 1;
    }
  }
  function parcelPalette(): FenceDrawMapProps['parcelPalette'] {
    const white = candidate('line') === 2;
    const out: Record<string, string> = {};
    const pick: Array<[string, string]> = [
      ['line', white ? '--parcel-line-2' : '--parcel-line'],
      ['casing', '--parcel-casing'],
      ['dot', '--parcel-vertex'],
      ['active', '--parcel-active'],
    ];
    pick.forEach(function (p) { const c = token(p[1]); if (c) out[p[0]] = c; });
    return out as FenceDrawMapProps['parcelPalette'];
  }

  /** The house outline: its own colour on a paper edge, with a light tint
   *  inside (owner, 2026-09-27: "whatever I draw on the picture, fence or
   *  house outline, show it in colour" — the fence is blueprint blue, the lot
   *  line sky, so the house takes a hue neither of them has); the snapped wall
   *  in blueprint; ?house=2 hatches the inside. Tokens off `.content`. */
  /** The drawn fence: its core on a casing, and the corner dots (owner,
   *  2026-09-28: "show the fence lines in a different colour — it's hard to
   *  see if it's been drawn or not"). Tokens off `.content`, memoised: the
   *  surface rebuilds nothing for an equal object, and `pushMap` runs on
   *  every hover. */
  let fencePaletteMemo: FenceDrawMapProps['fencePalette'] | null = null;
  function fencePalette(): FenceDrawMapProps['fencePalette'] {
    if (fencePaletteMemo) return fencePaletteMemo;
    const out: Record<string, string> = {};
    const pick: Array<[string, string]> = [
      ['line', '--fence-line'],
      ['casing', '--fence-casing'],
      ['dot', '--fence-dot'],
      ['dotRing', '--fence-dot-ring'],
    ];
    pick.forEach(function (p) { const c = token(p[1]); if (c) out[p[0]] = c; });
    fencePaletteMemo = out as FenceDrawMapProps['fencePalette'];
    return fencePaletteMemo;
  }

  function housePalette(): FenceDrawMapProps['housePalette'] {
    const out: Record<string, string | boolean | number> = { hatched: candidate('house') === 2 };
    const pick: Array<[string, string]> = [
      ['line', '--house-line'],
      ['edge', '--house-edge'],
      ['active', '--house-active'],
      ['fill', '--house-fill'],
    ];
    pick.forEach(function (p) { const c = token(p[1]); if (c) out[p[0]] = c; });
    const op = parseFloat(token('--house-fill-opacity') || '');
    if (isFinite(op)) out.fillOpacity = op;
    return out as FenceDrawMapProps['housePalette'];
  }

  function topoPalette(): FenceDrawMapProps['topoPalette'] {
    const out: Record<string, string> = {};
    const pick: Array<[string, string]> = [
      ['line', '--topo-line'], ['major', '--topo-major'], ['casing', '--topo-casing'],
      ['ink', '--ink'], ['paper', '--topo-paper'], ['font', '--font-mono'],
    ];
    pick.forEach(function (p) { const v = token(p[1]); if (v) out[p[0]] = v; });
    return out;
  }

  function paintTopo() {
    renderTopoLegend();
    paintSideGrades();
    pushMap();
    pushModel();
    renderModelNote();
  }

  /** The key over the map: interval, fall, direction, grade and source — or
   *  the honest state while it is reading, flat, or unavailable. */
  function renderTopoLegend() {
    const box = $('#topoLegend');
    if (!box) return;
    if (!mapOrigin || !mapIsland || !topoOn || topoStatus === 'idle') {
      box.classList.add('is-hidden');
      box.innerHTML = '';
      return;
    }
    const hadFocus = box.contains(document.activeElement);
    const retry = '<button class="tl-retry" type="button" data-topo-retry title="' + esc(topoError) + '">Retry</button>';
    // A grid already drawn for this address is what the map shows, so it is
    // what the legend describes — even while a wider one is being read or has
    // just failed. Only with nothing drawn does the legend speak for the lookup.
    const lot = topoGrid && sameOrigin(topoGrid.origin, mapOrigin) ? currentLotTopo() : null;
    let html = '';
    if (lot && topoGrid) {
      const onLot = lotRingsFt(mapOrigin).length > 0;
      const where = onLot ? 'across the lot' : 'around the address';
      const fall = Math.round(lot.reliefFt * 10) / 10;
      const fallTxt = (fall >= 10 ? Math.round(fall) : fall) + ' ft';
      const iv = lot.intervalFt;
      html = '<div class="tl-k"><span class="tl-sw" aria-hidden="true"></span>Topo' +
        (iv ? ' · contours every ' + iv + ' ft' : '') + '</div>';
      html += lot.overlay
        ? '<div class="tl-l">' + fallTxt + ' of fall ' + where +
          (lot.fallsToward ? ' · falls toward ' + lot.fallsToward : '') +
          ' · avg grade ' + Math.round(lot.gradePct) + '%</div>'
        : '<div class="tl-l">Level ' + (onLot ? 'lot' : 'ground') + ' · under 1 ft of fall</div>';
      html += '<div class="tl-s">' + sourceLabel(topoGrid) + (onLot ? '' : ' · lot lines not found') +
        (topoStatus === 'busy' ? ' · widening…' : '') + '</div>';
      if (topoStatus === 'failed') html += retry;
    } else if (topoStatus === 'busy') {
      html = '<div class="tl-k">Topo</div><div class="tl-l">Reading the ground…</div>';
    } else if (topoStatus === 'failed') {
      html = '<div class="tl-k">Topo</div><div class="tl-l">Ground data unavailable</div>' + retry;
    } else {
      box.classList.add('is-hidden');
      box.innerHTML = '';
      return;
    }
    box.innerHTML = html;
    box.classList.remove('is-hidden');
    // Re-rendering replaces the button a keyboard user just pressed; keep
    // their place instead of dropping focus to <body>.
    if (hadFocus) {
      const next = box.querySelector<HTMLElement>('[data-topo-retry]');
      if (next) next.focus({ preventScroll: true });
      else { box.tabIndex = -1; box.focus({ preventScroll: true }); }
    }
  }

  /** A grade on every listed property side, from the lattice — the slope a
   *  fence along that side will meet, before any fence is down. */
  function paintSideGrades() {
    const o = mapOrigin;
    const g = topoGrid && o && sameOrigin(topoGrid.origin, o) ? topoGrid : null;
    $$('#parcelSides [data-grade-side]').forEach(function (tag) {
      const lot = parcelLots[Number(tag.dataset.gradeLot)];
      const side = lot?.sides[Number(tag.dataset.gradeSide)];
      const grade = g && o && side
        ? lineGradeOnGrid(
            g.grid,
            g.plan,
            latLngToLocalFeet(o, { lat: side.from[0], lng: side.from[1] }),
            latLngToLocalFeet(o, { lat: side.to[0], lng: side.to[1] }),
          )
        : null;
      if (!grade || !topoOn) {
        tag.classList.add('is-hidden');
        tag.textContent = '';
        tag.removeAttribute('title');
        return;
      }
      tag.textContent = Math.round(grade.pct) + '%';
      tag.className = 'ps-grade is-' + grade.cls;
      tag.title = (grade.riseFt >= 0 ? 'Rises ' : 'Falls ') + Math.abs(grade.riseFt).toFixed(1) +
        ' ft end to end · ' + grade.thetaDeg.toFixed(0) + '° · steepest stretch ' + Math.round(grade.maxPct) + '% · ' +
        (grade.cls === 'stepped' ? 'panels would step' : grade.cls === 'racked' ? 'panels would rack' : 'level for panels');
    });
  }

  /** The report, but only while it still DESCRIBES the trace on screen: after
   *  an add/remove of a segment (and until the refetch lands) the per-segment
   *  indices no longer line up, and pricing off them would be a lie. */
  function usableTerrain(): FenceTerrainReport | null {
    if (terrainStatus !== 'ok' || !mapOwnsRuns) return null;
    const report = classifiedTerrain();
    if (!report) return null;
    // Compared against the segments the sampler actually profiles (it skips
    // slivers under MIN_PROFILED_SEG_FT, which the ledger keeps), segment by
    // segment — a vertex inserted mid-line shifts every index after it while
    // leaving counts that could still happen to agree.
    const profiled = tracedSegments(mapPoints).filter(function (s) { return s.ft >= MIN_PROFILED_SEG_FT; });
    if (report.segs.length !== profiled.length) return null;
    for (let i = 0; i < profiled.length; i++) {
      if (report.segs[i].seg !== profiled[i].seg) return null;
    }
    return report;
  }

  /** The measured segment behind a ledger run — by the run's own identity
   *  (`m<seg>`), not its row position: deleting a row used to hand every
   *  later run the grade of the segment after its own. Hand-typed runs have
   *  no segment and bill flat. */
  function terrainSegForRun(r: FenceRun): SegTerrain | null {
    const t = usableTerrain();
    const m = /^m(\d+)$/.exec(r.id);
    if (!t || !m) return null;
    const seg = Number(m[1]);
    return t.segs.find(function (s) { return s.seg === seg; }) || null;
  }

  /** Grade factor (along-ground / plan, ≥ 1) for one ledger run. */
  function segFactor(r: FenceRun): number {
    const s = terrainSegForRun(r);
    if (!s || s.planFt <= 0) return 1;
    return s.gradeFt / s.planFt;
  }

  /** Human name for an elevation source, for the strip and the legend. */
  function sourceLabel(src: { source: ElevationSource; resM?: number } | null): string {
    if (!src) return '';
    if (src.source === 'google') return 'Google elevation';
    const m = Math.max(1, Math.round(src.resM ?? 10));
    return m <= 3 ? 'USGS lidar ' + m + ' m' : 'USGS ' + m + ' m';
  }

  /** The measured grade on each ledger row: muted on level ground, amber where
   *  the panels rack, red where they step. Patched in place, never rebuilt. */
  function paintRunGrades() {
    $$('#runsList [data-run]').forEach(function (li) {
      const tag = li.querySelector<HTMLElement>('[data-run-grade]');
      if (!tag) return;
      const r = fs.runs.find(function (x) { return x.id === li.dataset.run; });
      const s = r ? terrainSegForRun(r) : null;
      if (!s) {
        tag.classList.add('is-hidden');
        tag.textContent = '';
        tag.removeAttribute('title');
        return;
      }
      const pct = Math.round(Math.tan((s.thetaDeg * Math.PI) / 180) * 100);
      tag.textContent = pct + '%';
      tag.className = 'run-grade is-' + s.cls;
      tag.title =
        (s.riseFt >= 0 ? 'Rises ' : 'Falls ') + Math.abs(s.riseFt).toFixed(1) + ' ft over ' + Math.round(s.planFt) +
        ' ft · ' + s.thetaDeg.toFixed(0) + '° · ' +
        (s.cls === 'stepped'
          ? 'stepped, ' + pricedSteps(s) + ' steps' + (s.rolling ? ' — the ground rolls under it, a racked panel would not sit' : '')
          : s.cls === 'racked' ? 'racked — one line following the grade' : 'level');
    });
  }

  /** The last overlay handed to the map, kept so its IDENTITY changes only
   *  when the measured report does — the map rebuilds its label layer on a new
   *  array, and `pushMap` runs on every hover and arm. */
  let terrainViewMemo: { report: FenceTerrainReport; out: TerrainSegView[] | null } | null = null;

  /** Non-level segments for the map overlay, in the surface's vocabulary. */
  function terrainOverlay(): TerrainSegView[] | null {
    const t = usableTerrain();
    if (!t) return null;
    if (terrainViewMemo && terrainViewMemo.report === t) return terrainViewMemo.out;
    const out: TerrainSegView[] = [];
    t.segs.forEach(function (s) {
      if (s.cls === 'level') return;
      out.push({
        seg: s.seg,
        cls: s.cls,
        thetaDeg: s.thetaDeg,
        riseFt: s.riseFt,
        gradeFt: s.gradeFt,
        // The ticket's count (bays re-split at 1-ft code steps), not the bays.
        steps: s.cls === 'stepped' ? pricedSteps(s) : s.steps,
        stepDropFt: s.cls === 'stepped' ? segmentSteps(s, effectiveSpacingFt(currentType().type, fs.spacing)).dropFt : s.stepDropFt,
      });
    });
    terrainViewMemo = { report: t, out: out.length ? out : null };
    return terrainViewMemo.out;
  }

  const hintEl = $('.stage-hint');
  const hintMouse = hintEl?.textContent ?? '';
  // A phone has no double-click, Enter or right-click to be told about.
  const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  const hintIdle = coarse
    ? 'Tap to place a dot · drag to move the map, pinch to zoom · hold a moment, then drag to aim — it snaps to corners, lot lines and house walls · double-tap or Finish to end'
    : hintMouse;
  // The aiming tip, once: shown in place of the idle line on a touch screen
  // until the first dot is placed with the reticle; never again after a visit
  // that showed it.
  const AIM_TIP = 'Drag to move the map · hold a moment, then drag to aim — the dot snaps to corners and lines';
  const AIM_TIP_KEY = 'jf.fence.aimTip';
  let aimTip = false;
  if (coarse) {
    try { aimTip = window.localStorage.getItem(AIM_TIP_KEY) !== '1'; } catch { aimTip = true; }
  }
  function onTouchAim() {
    if (!aimTip) return;
    aimTip = false;
    syncHint();
  }

  /** Resolve a design token off `.content`, where the page declares them —
   *  the Maps SDK needs a concrete colour string and must not be handed a
   *  literal that would drift from the token.
   *
   *  Resolved ONCE per name: `mapProps()` runs on every committed drag frame,
   *  and `getComputedStyle` there would force a style recalc 60×/second for two
   *  values that cannot change while the page is mounted. */
  const tokenCache = new Map<string, string | undefined>();
  function token(name: string): string | undefined {
    if (!tokenCache.has(name)) {
      tokenCache.set(name, getComputedStyle(root).getPropertyValue(name).trim() || undefined);
    }
    return tokenCache.get(name);
  }

  /** Every non-gap segment of the trace, in order. `seg` indexes `mapPoints`. */
  function tracedSegments(pts: PathPoint[]): Array<{ seg: number; ft: number }> {
    const out: Array<{ seg: number; ft: number }> = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      if (b.gap) continue; // run break — no fence across the connector
      const ft = Math.hypot(b.x - a.x, b.y - a.y);
      if (ft > 0.05) out.push({ seg: i, ft });
    }
    return out;
  }

  /** Ledger ordinal ("Run 3") for a segment index, or null when it isn't one. */
  function runOrdinal(seg: number): number | null {
    const k = tracedSegments(mapPoints).findIndex(function (s) { return s.seg === seg; });
    return k >= 0 ? k + 1 : null;
  }

  /** One traced segment → one ledger run. Whole feet: the row's input is
   *  `step="1"` and the ticket rounds, so the number in the box is the number
   *  the estimate charges for. */
  function toRun(s: { seg: number; ft: number }): FenceRun {
    return { id: 'm' + s.seg, ft: Math.max(0, Math.round(s.ft)) };
  }

  function isPlaced(o: FenceOpening): boolean {
    return typeof o.seg === 'number' || (typeof o.x === 'number' && typeof o.y === 'number');
  }

  /** A ledger opening → the surface's GateSpec. The two share one vocabulary
   *  for the type ('single' … 'slatted' are both the OPENINGS ids and the
   *  surface's built-in variants), and the WIDTH comes from this page's rate
   *  card, because that is the width the ticket charges for. */
  function toGateSpec(o: FenceOpening): GateSpec {
    const t = opType(o.type);
    return {
      id: o.id,
      segmentIndex: typeof o.seg === 'number' ? o.seg : -1,
      t: typeof o.t === 'number' ? o.t : 0.5,
      widthFt: t.width,
      kind: (t.kind === 'door' ? 'door' : 'gate') as OpeningKind,
      variant: o.type,
      x: o.x,
      y: o.y,
    };
  }

  // ================= HOUSES (House tool) =================
  // Outlines the contractor traces over the photo. They stand up in 3D as the
  // subject building (replacing any detected footprint they cover), fence dots
  // snap to their corners and walls, and a run that ends on a wall is a WALL
  // MOUNT — labelled on the map, built as a ledger board and brackets in 3D.
  let houseMode = false;
  let houses: DrawnHouse[] = [];
  let houseSeq = 0;
  let draftState: DraftState = { fence: false, houseCorners: 0 };
  // What Undo can take back on the houses, newest last: an outline that
  // closed (reopened as the draft, corners and all) or a house removed (put
  // back where it was). Ordered against the fence by `seq`: the toolbar's
  // Undo goes for whichever is newer, the last house action or the last
  // fence edit. An undo of the fence commits a trace change of its own, so
  // the stamp is held through it — that change is not a new action.
  type HouseUndo =
    | { kind: 'closed'; id: string; seq: number }
    | { kind: 'removed'; house: DrawnHouse; index: number; seq: number };
  const houseUndo: HouseUndo[] = [];
  let actionSeq = 0;
  let fenceSeq = 0;
  let stampHeldUntil = 0;
  function holdStamp() { stampHeldUntil = performance.now() + 400; }
  function pushHouseUndo(entry: HouseUndo) {
    houseUndo.push(entry);
    if (houseUndo.length > 20) houseUndo.shift();
    syncUndoButton();
  }
  function undoHouse() {
    const entry = houseUndo.pop();
    if (!entry || !mapApi) return;
    if (entry.kind === 'closed') {
      const h = houses.find(function (x) { return x.id === entry.id; });
      if (!h) { undoHouse(); return; } // already gone by hand — the one before it
      if (houseSel === h.id) houseSel = null;
      houses = houses.filter(function (x) { return x.id !== entry.id; });
      if (fs.mode === '3d') showDrawView();
      afterHousesChanged();
      setHouseLayer(true, true);
      // The corners come back as the draft with the tool in hand: Undo again
      // takes back a corner, the first corner or Close outline finishes it.
      houseMode = true;
      syncHouseButton();
      mapApi.openHouseDraft(h.ring);
      pushMap();
      sayHint('Outline reopened — Undo takes back a corner · click the first corner or Close outline to finish · Clear drops it');
      return;
    }
    const at = Math.min(entry.index, houses.length);
    houses = houses.slice(0, at).concat([entry.house], houses.slice(at));
    afterHousesChanged();
    sayHint('House put back');
  }
  /** Remove a traced house — the row's ×, Redraw, or Backspace on the one
   *  being edited. Undo brings it back. */
  function removeHouse(id: string) {
    const index = houses.findIndex(function (h) { return h.id === id; });
    if (index < 0) return;
    const house = houses[index];
    if (houseSel === id) houseSel = null;
    houses = houses.filter(function (h) { return h.id !== id; });
    pushHouseUndo({ kind: 'removed', house: house, index: index, seq: ++actionSeq });
    afterHousesChanged();
    renderDraftControls();
    syncHint();
  }
  /** The toolbar's Undo says what it will take back. */
  function syncUndoButton() {
    const entry = houseUndo[houseUndo.length - 1];
    const what = draftState.houseCorners > 0
      ? 'corner'
      : entry && (entry.seq > fenceSeq || !mapPoints.length)
        ? entry.kind === 'closed' ? 'outline' : 'removed-house'
        : mapPoints.length ? 'dot' : 'none';
    $$('[data-act="undo"]').forEach(function (b) {
      b.dataset.undo = what;
      b.title = what === 'corner'
        ? 'Undo — takes back the last corner of the house'
        : what === 'outline'
          ? 'Undo — reopens the house outline that just closed'
          : what === 'removed-house'
            ? 'Undo — puts the removed house back'
            : what === 'dot'
              ? 'Undo — takes back the last fence dot'
              : 'Undo';
    });
  }
  // The house LAYER (the House button): outline, hatch and area label on the
  // map, and the walls a fence dot snaps to. On by itself as soon as the site
  // has an outline — until the contractor has used the button, after which it
  // is theirs. Hiding it changes nothing that is already measured or priced.
  let houseLayer = false;
  let houseLayerTouched = false;
  /** The outline picked up on the map (a traced house's id, or "det:<n>"). */
  let houseSel: string | null = null;
  const NO_RINGS: Array<Array<{ lat: number; lng: number }>> = [];
  const NO_HOUSES: NonNullable<FenceDrawMapProps['houses']> = [];

  // The house outline finds itself (owner, 2026-09-20: "on the phone the
  // outline never appears" — it sat behind a "Use detected outline" button in
  // a panel under the map, and the House button, tapped to reveal it, turned
  // the layer it had just switched on back OFF). Now: the footprint the
  // address sits in becomes the house the moment it arrives, however late;
  // the House button only shows and hides the layer, and says what the lookup
  // is doing while there is nothing to show.
  type HouseLookup = 'idle' | 'loading' | 'found' | 'none' | 'failed' | 'manual';
  /** Owner, 2026-09-24: "let's not use this feature for outlining the house —
   *  when we request an address for a fence, don't outline the house; we'll
   *  draw it by hand." The lookups stay in the code (OpenStreetMap through
   *  fetchPropertyBoundary, Google's aerial mask through fetchHouseFootprints)
   *  for the day that changes; with this off no outline is adopted, nothing
   *  is drawn as context, and the aerial call is never made. The Align button
   *  went with it — there is nothing to align. */
  const DETECT_OUTLINES = false;
  let houseLookup: HouseLookup = 'idle';
  /** The lookup's raw answer, kept so the subject can be re-picked when the
   *  lot arrives after the buildings did. */
  let osmRaw: Array<{ ring: Array<{ lat: number; lng: number }>; heightFt: number }> | null = null;
  type SiteRing = { ring: Array<{ lat: number; lng: number }>; heightFt: number; heightTagged?: boolean };
  /** The two answers behind `osmRaw` (2026-09-24): OpenStreetMap's, and
   *  Google's aerial building mask when it has this address — the same photo
   *  the map shows, so its outlines land on the roof without dragging
   *  (lib/solarHouses). The aerial outlines win; OSM lends them its heights. */
  let osmBuildings: SiteRing[] | null = null;
  let solarBuildings: SiteRing[] | null = null;
  let houseSource: 'osm' | 'solar' = 'osm';
  let houseRefine: 'idle' | 'loading' | 'done' | 'none' = 'idle';
  let houseImagery: string | null = null;
  /** Each automatic house's ring as adopted — an untouched one makes way for
   *  the aerial outline when that lands; a moved or redrawn one stays. */
  const autoHouseRings = new Map<string, PathPoint[]>();
  function ringCentroidLL(r: Array<{ lat: number; lng: number }>) {
    let lat = 0, lng = 0;
    r.forEach(function (q) { lat += q.lat; lng += q.lng; });
    return { lat: lat / r.length, lng: lng / r.length };
  }
  function metresLL(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
    const d2r = Math.PI / 180;
    return Math.hypot((b.lng - a.lng) * d2r * Math.cos(a.lat * d2r) * 6378137, (b.lat - a.lat) * d2r * 6378137);
  }
  function llInRing(p: { lat: number; lng: number }, ring: Array<{ lat: number; lng: number }>): boolean {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a.lat > p.lat) !== (b.lat > p.lat) && p.lng < ((b.lng - a.lng) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lng) inside = !inside;
    }
    return inside;
  }
  /** OSM's heights on the aerial outlines: the OSM ring under the outline's centroid, else the nearest within 10 m. */
  function withHeights(solar: SiteRing[], osm: SiteRing[]): SiteRing[] {
    return solar.map(function (h) {
      const c = ringCentroidLL(h.ring);
      let best: SiteRing | null = null;
      let bestM = 10;
      for (const o of osm) {
        if (o.ring.length >= 3 && llInRing(c, o.ring)) { best = o; break; }
        const m = o.ring.length ? metresLL(c, ringCentroidLL(o.ring)) : Infinity;
        if (m < bestM) { bestM = m; best = o; }
      }
      return best ? { ring: h.ring, heightFt: best.heightFt, heightTagged: best.heightTagged } : h;
    });
  }
  function composeRaw() {
    osmRaw = solarBuildings ? withHeights(solarBuildings, osmBuildings || []) : osmBuildings;
  }
  function sameRing(a: PathPoint[], b: PathPoint[]): boolean {
    return a.length === b.length && a.every(function (q, i) { return Math.abs(q.x - b[i].x) < 0.05 && Math.abs(q.y - b[i].y) < 0.05; });
  }
  /** The address the automatic house was made for — once per address, so a
   *  house the contractor removed stays removed. */
  let autoHouseFor: string | null = null;
  /** Houses that came from the lookup (not traced by hand): moved whole, they
   *  carry the site's footprints with them and the offset is remembered. */
  const autoHouseIds = new Set<string>();
  const HOUSE_STATE_TEXT: Record<HouseLookup, string> = {
    idle: 'House layer',
    loading: 'House layer — looking for the house outline…',
    found: 'House layer',
    none: 'No outline found · draw it',
    failed: 'Outline lookup failed · draw it',
    manual: 'House layer — draw the house outline',
  };
  function syncHouseButton() {
    $$('[data-act="house"]').forEach(function (b) {
      b.classList.toggle('on', houseLayer);
      b.setAttribute('aria-pressed', String(houseLayer));
      b.dataset.state = houseLookup;
      b.dataset.tracing = String(houseMode);
      if (houseLookup === 'loading') b.setAttribute('aria-busy', 'true');
      else b.removeAttribute('aria-busy');
      b.title = houseMode
        ? 'Drawing the house — click each corner on the map · press again to stop'
        : !houses.length && mapOrigin
          ? 'Draw the house — press, then click each corner on the map'
          : HOUSE_STATE_TEXT[houseLookup];
    });
  }
  function setHouseLookup(next: HouseLookup) {
    if (houseLookup === next) return;
    houseLookup = next;
    syncHouseButton();
    renderHousePanel();
  }
  function setHouseLayer(on: boolean, byHand?: boolean) {
    if (byHand) houseLayerTouched = true;
    if (houseLayer === on) return;
    houseLayer = on;
    if (!on && houseMode) setHouseMode(false);
    if (!on && houseSel) { houseSel = null; renderDraftControls(); }
    syncHouseButton();
    syncHint();
    renderHousePanel();
    pushMap();
  }
  /** The site has an outline now: show the layer unless the button was used. */
  function autoShowHouseLayer() {
    if (!houseLayerTouched && !houseLayer && (houses.length || siteBuildings.length)) setHouseLayer(true);
  }

  // The detected footprints come from OpenStreetMap / Regrid, traced off a
  // different aerial than the one on screen, and sit a few feet off the roof —
  // a different few feet at every address (measured 2026-09-20: 2–5 ft, no
  // common direction), so there is nothing to correct in code and nothing to
  // guess. The contractor drags a footprint onto the roof; every footprint of
  // the site moves with it, the snapping follows, and the offset is remembered
  // for the address in this browser.
  let siteBuildingsRaw: BuildingFootprint[] = [];
  let siteShift: PathPoint = { x: 0, y: 0 };
  function shiftKey(): string | null {
    // The aerial outlines and the OSM ones sit differently on the photo: each source keeps its own remembered drag.
    return mapOrigin ? 'jf.fence.houseShift:' + (houseSource === 'solar' ? 'solar:' : '') + mapOrigin.lat.toFixed(5) + ',' + mapOrigin.lng.toFixed(5) : null;
  }
  function savedShift(): PathPoint {
    try {
      const k = shiftKey();
      const raw = k ? window.localStorage.getItem(k) : null;
      const v = raw ? JSON.parse(raw) : null;
      if (v && Number.isFinite(v.x) && Number.isFinite(v.y) && Math.hypot(v.x, v.y) <= 200) return { x: v.x, y: v.y };
    } catch { /* private window, blocked storage: the offset lives for the visit */ }
    return { x: 0, y: 0 };
  }
  function applySiteShift() {
    const d = siteShift;
    siteBuildings = d.x || d.y
      ? siteBuildingsRaw.map(function (b) {
          return { ring: b.ring.map(function (q) { return { x: q.x + d.x, y: q.y + d.y }; }), heightFt: b.heightFt, role: b.role };
        })
      : siteBuildingsRaw;
  }
  function setSiteBuildings(raw: BuildingFootprint[]) {
    siteBuildingsRaw = raw;
    siteShift = raw.length ? savedShift() : { x: 0, y: 0 };
    applySiteShift();
  }
  function setSiteShift(next: PathPoint, housesAlreadyMoved?: boolean) {
    const dx = next.x - siteShift.x;
    const dy = next.y - siteShift.y;
    if (!housesAlreadyMoved && (dx || dy) && autoHouseIds.size) {
      houses = houses.map(function (h) {
        return autoHouseIds.has(h.id)
          ? { id: h.id, ring: h.ring.map(function (q) { return { x: q.x + dx, y: q.y + dy }; }), stories: h.stories }
          : h;
      });
    }
    siteShift = next;
    try {
      const k = shiftKey();
      if (k) {
        if (next.x || next.y) window.localStorage.setItem(k, JSON.stringify(next));
        else window.localStorage.removeItem(k);
      }
    } catch { /* see savedShift */ }
    applySiteShift();
    afterHousesChanged();
  }
  function onDetectedShift(dx: number, dy: number) {
    setSiteShift({ x: siteShift.x + dx, y: siteShift.y + dy });
  }
  /** The outline being edited — set by "Edit house" or a long press on the
   *  outline, cleared by Done (or Escape). Never by a plain tap. */
  function onHouseSelect(key: string | null) {
    if (houseSel === key) return;
    houseSel = key;
    if (key && !houseLayer) setHouseLayer(true, true);
    if (key && houseMode) setHouseMode(false);
    if (key && armed) setArmed(null);
    // A passing notice ("House outlined · Undo reopens it…") gives way to
    // the editing instruction the moment the outline is picked up.
    if (key && hintNote && !held) hintNote = null;
    syncHint();
    renderDraftControls();
    renderHousePanel();
    pushMap();
  }

  /** Which footprint is THE house: the one the address point falls in, else
   *  the largest on the lot. Everything else stays faint context. */
  function pickSubject(): BuildingFootprint | null {
    const free = mergeBuildings(houses, siteBuildings).slice(houses.length);
    const at = { x: siteShift.x, y: siteShift.y }; // the address point, in the shifted frame
    let best: BuildingFootprint | null = null;
    let bestA = 0;
    for (const b of free) {
      if (pointInRingFt(at, b.ring)) return b;
      if (b.role !== 'subject') continue;
      const a = ringAreaSqFt(b.ring);
      if (a > bestA) { best = b; bestA = a; }
    }
    return best;
  }
  function houseFromFootprint(b: BuildingFootprint, auto: boolean) {
    houseSeq += 1;
    const id = 'h' + houseSeq;
    houses = houses.concat([{
      id: id,
      ring: b.ring
        .filter(function (q, i, arr) {
          return !(i === arr.length - 1 && arr.length > 3 && Math.hypot(q.x - arr[0].x, q.y - arr[0].y) < 0.01);
        })
        .map(function (q) { return { x: q.x, y: q.y }; }),
      stories: b.heightFt >= 30 ? 3 : b.heightFt >= 20 ? 2 : 1,
    }]);
    if (auto) {
      autoHouseIds.add(id);
      autoHouseRings.set(id, houses[houses.length - 1].ring.slice());
    }
  }
  /** The lookup's answer (or the lot) just landed: roles, the automatic house,
   *  the button's state. Safe to call again — it adopts once per address. */
  function settleHouseLookup(o: { lat: number; lng: number }) {
    if (!osmRaw || !sameOrigin(mapOrigin, o)) return;
    const ringPts = parcelLots.length && sameOrigin(parcelOrigin, o)
      ? parcelLots[0].ring.map(function (ll) { return latLngToLocalFeet(o, ll); })
      : null;
    setSiteBuildings(buildingsToFootprints(osmRaw, o, ringPts));
    const key = o.lat.toFixed(6) + ',' + o.lng.toFixed(6);
    if (autoHouseFor !== key && !houses.length) {
      const b = pickSubject();
      if (b) {
        autoHouseFor = key;
        houseFromFootprint(b, true);
      }
    }
    const found = houses.length > 0 || !!pickSubject();
    houseLookup = found ? 'found' : 'none';
    if (found) autoShowHouseLayer();
    else if (!houseLayerTouched && !houseLayer) setHouseLayer(true); // the panel is where "draw it" lives
    syncHouseButton();
    afterHousesChanged();
    if (!found) sayHint('No house outline found for this address · draw it: Trace outline, in Buildings under the map.');
  }
  /** Ask for the footprints. Buildings and streets come from ONE Overpass
   *  query, and the server swallows its failure into two empty lists (one host,
   *  a 10 s timeout, no retry — measured 2026-09-20: answers take 1–14 s and a
   *  fair share time out). So an answer with no building AND no street is a
   *  lookup that did not happen, and is asked again (twice, spaced out); an
   *  answer with streets and no building is a real "no outline here" and is
   *  not — every ask spends the organisation's hourly lookup allowance. */
  function lookupHouse(
    o: { lat: number; lng: number },
    first: Promise<{ buildings: Array<{ ring: Array<{ lat: number; lng: number }>; heightFt: number }>; roads: unknown[] }>,
  ) {
    if (!DETECT_OUTLINES) {
      // The address is in: the house is the contractor's to draw. The panel
      // with Trace outline opens by itself unless the button was used.
      setHouseLookup('manual');
      if (!houseLayerTouched && !houseLayer) setHouseLayer(true);
      renderHousePanel();
      sayHint('Draw the house: Trace outline in Buildings under the map, then ' + (coarse ? 'tap' : 'click') + ' each corner of the house.');
      return;
    }
    setHouseLookup('loading');
    refineHouses(o);
    const giveUp = function () {
      // The aerial outline is here already: OSM only lent heights, and it lent none.
      if (solarBuildings && solarBuildings.length) { settleHouseLookup(o); return; }
      setHouseLookup('failed');
      if (!houseLayerTouched && !houseLayer) setHouseLayer(true); // the panel is where "draw it" lives
      sayHint('The house outline could not be loaded · draw it: Trace outline, in Buildings under the map.');
    };
    const again = function (attempt: number, p: typeof first) {
      const retry = function () {
        after(function () {
          if (sameOrigin(mapOrigin, o)) again(attempt + 1, fetchPropertyBoundary(o.lat, o.lng));
        }, attempt === 0 ? 4000 : 9000);
      };
      p.then(function (res) {
        if (!sameOrigin(mapOrigin, o)) return;
        const dead = !res.buildings.length && !res.roads.length;
        if (dead && attempt < 2) return retry();
        if (dead) return giveUp();
        osmBuildings = res.buildings;
        composeRaw();
        settleHouseLookup(o);
      }).catch(function () {
        if (!sameOrigin(mapOrigin, o)) return;
        if (attempt === 0) return retry();
        giveUp();
      });
    };
    again(0, first);
  }
  /** Google's aerial building mask for the pin (actions/fenceBoundary
   *  fetchHouseFootprints): asked beside the OSM lookup, and when it answers
   *  its outlines replace OSM's — the automatic house too, unless the
   *  contractor has already moved or redrawn it. Fails quietly: no key, no
   *  coverage or a failed call leaves the OSM outline exactly as it was. */
  function refineHouses(o: { lat: number; lng: number }) {
    houseRefine = 'loading';
    renderHousePanel();
    fetchHouseFootprints(o.lat, o.lng).then(function (res) {
      if (!sameOrigin(mapOrigin, o)) return;
      if (!res.ok || !res.buildings.length) { houseRefine = 'none'; renderHousePanel(); return; }
      solarBuildings = res.buildings;
      houseSource = 'solar';
      houseImagery = res.imageryDate;
      houseRefine = 'done';
      composeRaw();
      // The automatic house adopted from OSM, if untouched, makes way for the aerial one.
      const key = o.lat.toFixed(6) + ',' + o.lng.toFixed(6);
      if (autoHouseFor === key) {
        const stale = houses.filter(function (h) { const orig = autoHouseRings.get(h.id); return !!orig && sameRing(orig, h.ring); }).map(function (h) { return h.id; });
        if (stale.length) {
          houses = houses.filter(function (h) { return stale.indexOf(h.id) < 0; });
          stale.forEach(function (id) { autoHouseIds.delete(id); autoHouseRings.delete(id); });
          autoHouseFor = null;
        }
      }
      settleHouseLookup(o);
    }).catch(function () {
      if (!sameOrigin(mapOrigin, o)) return;
      houseRefine = 'none';
      renderHousePanel();
    });
  }
  function resetHouseLookup() {
    osmRaw = null;
    osmBuildings = null;
    solarBuildings = null;
    houseSource = 'osm';
    houseRefine = 'idle';
    houseImagery = null;
    autoHouseRings.clear();
    autoHouseFor = null;
    autoHouseIds.clear();
    houseSel = null;
    houseLookup = 'idle';
    syncHouseButton();
  }

  function setHouseMode(on: boolean) {
    if (houseMode === on) return;
    houseMode = on;
    // A passing notice (six seconds, not a held failure) gives way to the
    // tool's own instruction: the contractor just picked the tool up and
    // needs to read what it does now.
    if (on && hintNote && !held) hintNote = null;
    syncHouseButton();
    if (on && !houseLayer) setHouseLayer(true, true);
    if (on) {
      if (armed) setArmed(null);
      if (aligning && mapApi) {
        aligning = false;
        mapApi.setAlign(false);
        $$('[data-act="align"]').forEach(function (b) { b.classList.remove('on'); });
      }
    }
    syncHint();
    renderHousePanel();
    pushMap();
  }

  function onHouseAdd(ring: PathPoint[]) {
    houseSeq += 1;
    const id = 'h' + houseSeq;
    houses = houses.concat([{ id: id, ring: ring, stories: 1 }]);
    // The outline is drawn: the tool goes back in the drawer, the house stays.
    houseMode = false;
    pushHouseUndo({ kind: 'closed', id: id, seq: ++actionSeq });
    afterHousesChanged();
    syncHint();
    // A closed outline is not the end of the road: say how to get back —
    // and a triangle is almost never a house (the third click landed on the
    // first corner and closed it early).
    sayHint(ring.length <= 3
      ? 'Closed with 3 corners — Undo reopens it if the house has more · Edit house drags a corner'
      : 'House outlined · Undo reopens it corner by corner · Edit house drags a corner · × removes it');
  }
  function onHouseChange(id: string, ring: PathPoint[]) {
    const was = houses.find(function (h) { return h.id === id; });
    houses = houses.map(function (h) { return h.id === id ? { id: h.id, ring: ring, stories: h.stories } : h; });
    // An automatic house dragged WHOLE (every corner moved by the same amount)
    // is the contractor lining the source data up with the photo: the other
    // footprints go with it and the offset is remembered for the address.
    if (was && autoHouseIds.has(id) && was.ring.length === ring.length && ring.length) {
      const dx = ring[0].x - was.ring[0].x;
      const dy = ring[0].y - was.ring[0].y;
      const rigid = Math.hypot(dx, dy) > 0.05 && ring.every(function (q, i) {
        return Math.abs(q.x - was.ring[i].x - dx) < 0.05 && Math.abs(q.y - was.ring[i].y - dy) < 0.05;
      });
      if (rigid) {
        setSiteShift({ x: siteShift.x + dx, y: siteShift.y + dy }, true);
        return;
      }
    }
    afterHousesChanged(true);
  }
  /** `quiet`: an in-place edit (a dragged corner, a storey change) — the
   *  panel rows are patched, not re-listed. */
  function afterHousesChanged(quiet?: boolean) {
    autoShowHouseLayer();
    syncHouseButton();
    if (quiet) paintHouseRows();
    else renderHousePanel();
    pushMap();
    pushModel();
    renderModelNote();
  }
  function onDraftChange(state: DraftState) {
    draftState = state;
    renderDraftControls();
    syncUndoButton();
  }

  /** The largest detected footprint on the lot, if the page has one that no
   *  traced house already covers — offered as a starting outline. */
  function detectedSubject(): BuildingFootprint | null {
    return pickSubject();
  }

  // Identity-stable views: the map and the scene rebuild on a NEW object, and
  // `pushMap` runs on every hover and trace commit.
  let parcelMemo: { lots: ParcelLot[]; hover: string; view: FenceDrawMapProps['parcel'] } | null = null;
  function parcelView(): FenceDrawMapProps['parcel'] {
    const hover = parcelHover ? parcelHover.lot + ':' + parcelHover.side : '';
    if (parcelMemo && parcelMemo.lots === parcelLots && parcelMemo.hover === hover) return parcelMemo.view;
    const view = parcelLots.length
      ? {
          ring: parcelLots[0].ring,
          rings: parcelLots.map(function (l) { return l.ring; }),
          highlight: hoveredSidePath(),
        }
      : null;
    parcelMemo = { lots: parcelLots, hover: hover, view: view };
    return view;
  }
  let buildingsMemo: { houses: DrawnHouse[]; site: BuildingFootprint[]; merged: BuildingFootprint[] } | null = null;
  function modelBuildings(): BuildingFootprint[] {
    if (buildingsMemo && buildingsMemo.houses === houses && buildingsMemo.site === siteBuildings) return buildingsMemo.merged;
    buildingsMemo = { houses: houses, site: siteBuildings, merged: mergeBuildings(houses, siteBuildings) };
    return buildingsMemo.merged;
  }
  let detectedMemo: { src: BuildingFootprint[]; origin: { lat: number; lng: number } | null; view: Array<Array<{ lat: number; lng: number }>> } | null = null;
  function detectedView(): Array<Array<{ lat: number; lng: number }>> {
    const src = modelBuildings();
    if (detectedMemo && detectedMemo.src === src && sameOrigin(detectedMemo.origin, mapOrigin)) return detectedMemo.view;
    const o = mapOrigin;
    const view = o
      ? src.slice(houses.length).map(function (b) { return b.ring.map(function (q) { return localFeetToLatLng(o, q); }); })
      : [];
    detectedMemo = { src: src, origin: o, view: view };
    return view;
  }
  let houseViewMemo: { houses: DrawnHouse[]; origin: { lat: number; lng: number } | null; view: NonNullable<FenceDrawMapProps['houses']> } | null = null;
  function houseView(): NonNullable<FenceDrawMapProps['houses']> {
    if (houseViewMemo && houseViewMemo.houses === houses && sameOrigin(houseViewMemo.origin, mapOrigin)) return houseViewMemo.view;
    const o = mapOrigin;
    const view = o
      ? houses.map(function (h, i) {
          return { id: h.id, ring: h.ring.map(function (q) { return localFeetToLatLng(o, q); }), label: houses.length > 1 ? 'House ' + (i + 1) : 'House' };
        })
      : [];
    houseViewMemo = { houses: houses, origin: o, view: view };
    return view;
  }
  let mountsMemo: { pts: PathPoint[]; buildings: BuildingFootprint[]; ft: PathPoint[]; ll: Array<{ lat: number; lng: number }> } | null = null;
  function wallMounts(): { ft: PathPoint[]; ll: Array<{ lat: number; lng: number }> } {
    const bs = modelBuildings();
    if (mountsMemo && mountsMemo.pts === mapPoints && mountsMemo.buildings === bs) return mountsMemo;
    const ft = wallMountsFor(mapPoints, bs.map(function (b) { return b.ring; }));
    const o = mapOrigin;
    mountsMemo = { pts: mapPoints, buildings: bs, ft: ft, ll: o ? ft.map(function (q) { return localFeetToLatLng(o, q); }) : [] };
    return mountsMemo;
  }
  function wallMountView() { return wallMounts().ll; }

  function renderDraftControls() {
    const box = $('#drawCtl');
    if (!box) return;
    const focused = (document.activeElement as HTMLElement | null)?.closest?.('[data-draft]') as HTMLElement | null;
    const refocus = focused && box.contains(focused) ? focused.dataset.draft : null;
    const house = draftState.houseCorners > 0;
    if (houseSel && !draftState.fence && !house) {
      // Editing an outline: Done, or the two ways back — draw it again, or
      // take it off the map (Undo returns it either way).
      const own = !houseSel.startsWith('det:');
      box.classList.remove('is-hidden');
      box.innerHTML = '<button class="tool tool-primary" type="button" data-house-done><svg class="ic"><use href="#i-check"/></svg>Done</button>' +
        (own
          ? '<button class="tool" type="button" data-redraw-house="' + houseSel + '"><svg class="ic"><use href="#i-undo"/></svg>Redraw outline</button>' +
            '<button class="tool tool-remove" type="button" data-del-house="' + houseSel + '"><svg class="ic"><use href="#i-trash"/></svg>Remove</button>'
          : '');
      return;
    }
    if (!draftState.fence && !house) {
      box.classList.add('is-hidden');
      box.innerHTML = '';
      return;
    }
    box.innerHTML = house
      ? '<button class="tool" type="button" data-draft="undo"><svg class="ic"><use href="#i-undo"/></svg>Undo corner</button>' +
        '<button class="tool tool-primary" type="button" data-draft="finish"' + (draftState.houseCorners < 3 ? ' disabled' : '') +
        '><svg class="ic"><use href="#i-check"/></svg>Close outline</button>' +
        '<button class="tool" type="button" data-draft="cancel"><svg class="ic"><use href="#i-x"/></svg>Cancel</button>'
      : '<button class="tool" type="button" data-draft="undo"><svg class="ic"><use href="#i-undo"/></svg>Undo point</button>' +
        '<button class="tool tool-primary" type="button" data-draft="finish"><svg class="ic"><use href="#i-check"/></svg>Finish run</button>';
    box.classList.remove('is-hidden');
    if (refocus) box.querySelector<HTMLElement>('[data-draft="' + refocus + '"]:not([disabled])')?.focus({ preventScroll: true });
  }

  function houseRowHtml(h: DrawnHouse, i: number): string {
    const name = houses.length > 1 ? 'House ' + (i + 1) : 'House';
    return '<li class="hs-row" data-house="' + h.id + '">' +
      '<span class="hs-name">' + name + '</span>' +
      '<span class="hs-ft">' + Math.round(ringAreaSqFt(h.ring)).toLocaleString('en-US') + ' sq ft</span>' +
      '<span class="bp-sel hs-sel"><select class="bp-sel-in" data-house-stories aria-label="Stories">' +
      [1, 2, 3].map(function (n) {
        return '<option value="' + n + '"' + (h.stories === n ? ' selected' : '') + '>' + n + (n === 1 ? ' story' : ' stories') + '</option>';
      }).join('') +
      '</select></span>' +
      '<button class="tool hs-edit' + (houseSel === h.id ? ' on' : '') + '" type="button" data-edit-house="' + h.id + '" aria-pressed="' + String(houseSel === h.id) + '">' +
      (houseSel === h.id ? 'Done' : 'Edit house') + '</button>' +
      '<button class="row-x" type="button" data-del-house="' + h.id + '" aria-label="Remove ' + name + '">×</button></li>';
  }
  function paintHouseRows() {
    houses.forEach(function (h) {
      const ft = $('#houseList [data-house="' + h.id + '"] .hs-ft');
      if (ft) ft.textContent = Math.round(ringAreaSqFt(h.ring)).toLocaleString('en-US') + ' sq ft';
    });
    const mounts = $('#houseMounts');
    if (mounts) mounts.textContent = mountsText();
  }
  function mountsText(): string {
    const n = wallMounts().ft.length;
    return n ? n + (n === 1 ? ' run ends on a wall — wall mount' : ' run ends on a wall — wall mounts') : '';
  }
  function renderHousePanel() {
    const panel = $('#housePanel');
    const list = $('#houseList');
    if (!panel || !list) return;
    const detected = detectedSubject();
    if (!houseLayer) {
      panel.classList.add('is-hidden');
      list.innerHTML = '';
      return;
    }
    let html = houses.map(houseRowHtml).join('');
    if (!houses.length) {
      html = houseMode
        ? '<li class="hs-empty">' + (coarse ? 'Tap' : 'Click') + ' each corner of the house on the map, then ' + (coarse ? 'tap' : 'click') + ' the first corner again to close the outline.</li>'
        : houseLookup === 'manual'
          ? '<li class="hs-empty">Draw the house — Trace outline, then ' + (coarse ? 'tap' : 'click') + ' each corner of the house on the map.</li>'
          : houseLookup === 'loading'
            ? '<li class="hs-empty">Looking for the house outline…</li>'
          : detected
            ? '<li class="hs-empty">A footprint was found for this lot — Use detected outline puts it back as the house.</li>'
            : houseLookup === 'failed'
              ? '<li class="hs-empty">Outline lookup failed · draw it — Trace outline, then tap each corner of the house.</li>'
              : '<li class="hs-empty">No outline found · draw it — Trace outline, then tap each corner of the house.</li>';
    }
    list.innerHTML = html;
    const tools = $('#houseTools');
    if (tools) {
      const moved = Math.hypot(siteShift.x, siteShift.y);
      tools.innerHTML =
        '<button class="tool' + (houseMode ? ' on' : '') + '" type="button" data-house-trace aria-pressed="' + String(houseMode) + '"><svg class="ic"><use href="#i-building"/></svg>Trace outline</button>' +
        (detected
          ? '<button class="tool" type="button" data-house-detect><svg class="ic"><use href="#i-building"/></svg>Use detected outline</button>'
          : '') +
        (moved >= 0.05
          ? '<button class="tool" type="button" data-house-shift-reset>Detected outline moved ' + (moved < 10 ? moved.toFixed(1) : String(Math.round(moved))) + ' ft — reset</button>'
          : '') +
        (function () {
          // Where the outline came from — the aerial photo's own building mask
          // needs no dragging; an OSM outline may (2026-09-24).
          const when = houseImagery ? new Date(houseImagery + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '';
          const note = houseSource === 'solar'
            ? 'Outline from Google aerial imagery' + (when ? ' · ' + when : '')
            : houseRefine === 'loading'
              ? 'Checking the aerial imagery for a better outline…'
              : siteBuildingsRaw.length
                ? 'Outline from OpenStreetMap · drag it onto the roof if it sits off'
                : '';
          return note ? '<span class="tool-note" data-house-source="' + houseSource + '">' + note + '</span>' : '';
        })();
    }
    const mounts = $('#houseMounts');
    if (mounts) mounts.textContent = mountsText();
    panel.classList.remove('is-hidden');
  }

  function mapProps(): FenceDrawMapProps {
    return {
      lat: mapOrigin?.lat,
      lng: mapOrigin?.lng,
      points: mapPoints,
      revision: mapRev,
      onChange: onTraceChange,
      className: 'map-live-in',
      gates: fs.openings.filter(isPlaced).map(toGateSpec),
      armed: armed,
      // The custom catalog belongs to the old studio's store; this page's types
      // are the fixed OPENINGS rate card, so there are none to offer.
      customOpenings: [],
      // Arming is the page's job — the Gate/Door popovers in `.stage-tools` do
      // it. The surface's own pickers are not rendered (chrome: false).
      onArm: function () {},
      onDropOpening: onDropOpening,
      onUpdateGate: onUpdateGate,
      onDisarm: function () { setArmed(null); },
      chrome: false,
      onApi: function (api) { mapApi = api; },
      accentColor: token('--blueprint'),
      doorColor: token('--muted'),
      parcel: parcelView(),
      parcelTiles: lotLines,
      // A hidden layer is not drawn and is not snapped to; the 3D model, the
      // wall mounts and every saved length keep using the same houses.
      detectedBuildings: houseLayer ? detectedView() : NO_RINGS,
      houses: houseLayer ? houseView() : NO_HOUSES,
      houseMode: houseMode,
      onHouseAdd: onHouseAdd,
      onHouseChange: onHouseChange,
      onDetectedShift: onDetectedShift,
      houseEdit: houseLayer ? houseSel : null,
      onHouseSelect: onHouseSelect,
      onHouseRemove: removeHouse,
      wallMounts: wallMountView(),
      onDraftChange: onDraftChange,
      onTouchAim: onTouchAim,
      parcelPalette: parcelPalette(),
      housePalette: housePalette(),
      fencePalette: fencePalette(),
      terrain: terrainOverlay(),
      topo: topoOn ? currentLotTopo()?.overlay ?? null : null,
      topoPalette: topoPalette(),
      // The topo legend is a plate over the map's top-left corner; the lot's
      // auto-fit leaves room under it so the north line and its corners are
      // not hidden behind the key.
      fitPadding: TOPO_FIT_PADDING,
    };
  }

  function pushMap() { mapIsland?.update(mapProps()); }

  function setArmed(next: ArmedOpening | null) {
    armed = next;
    if (next && houseMode) setHouseMode(false);
    syncHint();
    pushMap();
  }

  /** `.stage-hint` is the page's instruction line; while a tool is armed or the
   *  outline is being aligned it says what THAT mode does, then returns to the
   *  donor's tracing copy. A transient note (a parcel result) outranks both. */
  let hintNote: string | null = null;
  /** Draw or 3D: marks the switch, drops a tool the hidden map could not
   *  serve, and swaps the panels (the first 3D open with a trace loads the
   *  scene). */
  function setStageMode(m: string) {
    fs.mode = m;
    $$('#modeSwitch .vsw-btn').forEach(function (b) { b.classList.toggle('active', (b as HTMLElement).dataset.mode === m); });
    // An armed tool with the map hidden has nothing to click on.
    if (fs.mode === '3d' && armed) setArmed(null);
    syncStage();
  }
  function showDrawView() { setStageMode('draw'); }

  function syncHint() {
    if (!hintEl) return;
    const tip = aimTip && !!mapOrigin && !hintNote && !armed && !aligning && !houseMode && !houseSel;
    hintEl.classList.toggle('is-tip', tip);
    if (tip) {
      try { window.localStorage.setItem(AIM_TIP_KEY, '1'); } catch { /* shown for this visit only */ }
      hintEl.textContent = AIM_TIP;
      return;
    }
    if (hintNote && hintLink) {
      hintEl.textContent = hintNote + ' ';
      const a = document.createElement('a');
      a.href = hintLink.href;
      a.textContent = hintLink.label;
      hintEl.appendChild(a);
      return;
    }
    hintEl.textContent = hintNote
      ? hintNote
      : armed
        ? 'Placing a ' + opType(armed.variant).label.toLowerCase() +
          ' — click a fence line to snap it on, or open ground to drop it free · Esc to cancel'
        : aligning
          ? 'Drag the whole outline to line it up with the lot — shape and size stay locked'
          : houseMode
            ? (coarse
                ? 'Trace the house: tap each corner — tap the first corner or Finish to close · drag to move the map · hold, then drag to aim · Cancel drops it'
                : 'Trace the house: click each corner — click the first corner, double-click or press Enter to close · drag a corner to adjust · Esc cancels')
            : houseSel
              ? (coarse
                  ? 'Editing the house: drag it onto the roof, drag a corner to reshape it · Redraw or Remove below · Done when finished'
                  : 'Editing the house: drag it onto the roof, drag a corner to reshape it, right-click a corner to remove it · Backspace removes the outline · Done when finished')

              : !houseLayer && (houses.length || siteBuildings.length)
                ? hintIdle + ' · House layer is hidden — dots do not snap to house walls'
                : hintIdle;
  }
  /** Say something sentence-length under the stage. A button label cannot carry
   *  "Regrid rejected the key — the token is likely expired", and swallowing it
   *  would leave a failure with no explanation anywhere on screen. */
  function sayHint(msg: string) {
    hintNote = msg;
    hintLink = null;
    syncHint();
    after(function () {
      if (hintNote !== msg) return; // a newer note replaced it
      hintNote = null;
      syncHint();
    }, 6000);
  }
  /** A failure the contractor has to act on stays until the next action —
   *  the next hint, or another go at the button — instead of fading at 6 s
   *  while they are still reading it (2026-09-22). `link` is rendered as an
   *  anchor after the sentence: the plan cap points at the upgrade page. */
  let hintLink: { href: string; label: string } | null = null;
  function holdHint(msg: string, link?: { href: string; label: string }) {
    hintNote = msg;
    hintLink = link ?? null;
    held = true;
    syncHint();
  }
  /** The next action — another go at the button, or a change to the trace — takes the held line down. */
  let held = false;
  function dropHeldHint() {
    if (!held) return;
    held = false;
    hintNote = null;
    hintLink = null;
    syncHint();
  }

  /** Rebuild `#runsList` wholesale. Only for the moment the demo fixture is
   *  replaced by a real trace, and only there: a genuine re-list, so it plays
   *  the entrance cascade. */
  function relistRuns() {
    const list = $('#runsList');
    if (!list) return;
    list.innerHTML = fs.runs.map(runRowHtml).join('');
    staggerIn(Array.from(list.querySelectorAll<HTMLElement>('li')));
  }

  /** Patch `#runsList` to match `fs.runs` WITHOUT rebuilding it: surviving rows
   *  are re-labelled and re-valued in place, an added segment arrives as one
   *  row, a removed one leaves as one row. A rebuild here would replay the whole
   *  entrance cascade on every committed drag frame. */
  function syncRunRows() {
    const list = $('#runsList');
    if (!list) return;
    const rows = $$('#runsList [data-run]').filter(function (li) { return !li.dataset.leaving; });
    fs.runs.forEach(function (r, i) {
      const li = rows[i];
      if (!li) { appendRow(list, runRowHtml(r, i)); return; }
      li.dataset.run = r.id;
      const n = li.querySelector<HTMLElement>('.run-n');
      if (n) n.textContent = 'Run ' + (i + 1);
      const input = li.querySelector<HTMLInputElement>('[data-run-ft]');
      // Never overwrite the field the user is typing in.
      if (input && document.activeElement !== input) input.value = String(r.ft);
    });
    // The data is already correct; these rows only have to leave the DOM. The
    // commit still re-checks the empty line — erasing the last traced segment
    // is exactly when it has to come back.
    for (let i = fs.runs.length; i < rows.length; i++) leave(rows[i], syncRunsEmpty);
  }

  /** After the geometry changes an opening's segment can shift, split or vanish.
   *  Re-resolve the ordinal each row shows; an opening whose segment is gone
   *  keeps its price and becomes a free-standing opening, which is exactly what
   *  the row's "Free" label already means. */
  function reseatOpenings() {
    const segs = tracedSegments(mapPoints);
    fs.openings.forEach(function (o) {
      if (typeof o.seg !== 'number') return;
      const k = segs.findIndex(function (s) { return s.seg === o.seg; });
      if (k < 0) { o.seg = undefined; o.t = undefined; o.run = null; }
      else o.run = k + 1;
      const li = $('#openList [data-op="' + o.id + '"]');
      if (li) paintOpenRow(li, o);
    });
  }

  /** The surface committed a new path. This is the one place the trace becomes
   *  the ledger — and therefore the price. */
  function onTraceChange(pts: PathPoint[]) {
    mapPoints = pts;
    // A fence edit is the newest action — unless it is Undo's own commit.
    if (performance.now() > stampHeldUntil) fenceSeq = ++actionSeq;
    syncUndoButton();
    dropHeldHint();
    const segs = tracedSegments(pts);
    if (!mapOwnsRuns) {
      if (!segs.length) { pushMap(); return; }
      mapOwnsRuns = true;
      fs.runs = segs.map(toRun);
      relistRuns();
    } else {
      fs.runs = segs.map(toRun);
      syncRunRows();
    }
    reseatOpenings();
    renderFigures();
    pushMap();
    // A run that now ends on (or left) a house wall changes the wall mounts.
    if (houses.length || siteBuildings.length) paintHouseRows();
    // The ground under the new line: one debounced Elevation profile per
    // settled edit. Stale per-segment factors stop applying immediately
    // (usableTerrain checks the segments) and refresh when this lands.
    scheduleTerrain();
    // A fence traced past the lattice's edge (no lot came back, or the fence
    // leaves the lot) widens it — debounced harder than the profile.
    if (topoAsked && mapOrigin && sameOrigin(topoAsked, mapOrigin)) {
      const core = topoCore(mapOrigin);
      if (core && !boxContains(topoAsked.box, core)) scheduleTopo(1500);
    }
    // The 3D scene reads the same `mapPoints`, so it follows the trace — and
    // mounts here if the user is already sitting on the 3D panel.
    syncStage();
  }

  /** Seed the surface AND the ledger from a path THIS module produced (the
   *  parcel ring). The revision bump is what re-seeds the polylines; from there
   *  it is an ordinary trace and the surface owns it again. */
  function applyTracedPath(pts: PathPoint[]) {
    mapRev += 1;
    onTraceChange(pts); // updates the ledger, then pushes the bumped revision
  }

  /** A website or house lead's fence (lib/webHandoff, 2026-10-28), applied once: the style when the shop's list has
   *  it (loadOrgBook resets one it does not), the height (snapped to the type's), the path as the homeowner drew it —
   *  or the typed runs — then the gates on the first run. Priced in the shop's own book from here on. */
  let initialFenceApplied = false;
  let disposed = false;
  function applyInitialFence() {
    const f = opts.initialFence;
    if (!f || initialFenceApplied || disposed) return;
    initialFenceApplied = true;
    if (f.type && typeRows().some(function (r) { return r.id === f.type; })) { fs.material = f.type; fs.tierBase = f.type; fs.tier = 'better'; }
    fs.height = f.heightFt;
    heightAsked = f.heightFt;
    renderHeights();
    if (f.points.length >= 2) {
      applyTracedPath(f.points);
    } else {
      fs.runs = f.runsFt.map(function (ft, i) { return { id: 'web-' + (i + 1), ft: ft }; });
      relistRuns();
    }
    for (let i = 0; i < f.gates + f.doubles; i++) {
      opSeq += 1;
      const o: FenceOpening = { id: 'o' + opSeq, type: i < f.gates ? 'single' : 'double', run: fs.runs.length ? 1 : null };
      fs.openings.push(o);
      appendRow($('#openList'), openRowHtml(o));
    }
    syncOpenEmpty();
    renderStudio();
  }

  /** A click placed the armed opening: on a run when it landed close enough to
   *  magnet, otherwise free at the clicked spot. */
  function onDropOpening(segmentIndex: number, t: number, x?: number, y?: number) {
    const a = armed;
    if (!a) return;
    opSeq += 1;
    const attached = segmentIndex >= 0;
    const o: FenceOpening = {
      id: 'o' + opSeq,
      type: a.variant,
      run: attached ? runOrdinal(segmentIndex) : null,
      seg: attached ? segmentIndex : undefined,
      t: attached ? t : undefined,
      x: x,
      y: y,
    };
    fs.openings.push(o);
    appendRow($('#openList'), openRowHtml(o));
    syncOpenEmpty();
    renderFigures();
    setArmed(null);
  }

  /** A marker was dragged. POSITION ONLY: this page's rate card owns an
   *  opening's width (a Single gate is 4 ft at $350), so the surface's edge
   *  handles cannot resize it — a dragged width would disagree with the price
   *  on the row right next to it. */
  function onUpdateGate(id: string, patch: Partial<GateSpec>) {
    const o = fs.openings.find(function (x) { return x.id === id; });
    if (!o) return;
    if (typeof patch.segmentIndex === 'number') {
      const attached = patch.segmentIndex >= 0;
      o.seg = attached ? patch.segmentIndex : undefined;
      o.run = attached ? runOrdinal(patch.segmentIndex) : null;
    }
    if (typeof patch.t === 'number') o.t = patch.t;
    if ('x' in patch) o.x = patch.x;
    if ('y' in patch) o.y = patch.y;
    const li = $('#openList [data-op="' + o.id + '"]');
    if (li) paintOpenRow(li, o);
    renderFigures();
    pushMap();
  }

  /**
   * Mount the surface into `#mapSlot`. Called only once an address has
   * RESOLVED: the surface opens on a default lot in Texas when it is given no
   * origin, and a page that greets every visitor with a stranger's house is
   * showing a fixture. Until then `#mapSlot` keeps its "Enter the address"
   * prompt, which is the true state of the page.
   *
   * Without a browser key nothing mounts at all and the prompt is rewritten to
   * say so — that is still the honest state, just a different one.
   */
  function mountMap() {
    if (mapIsland) return;
    if (!isMapsBrowserEnabled()) {
      const t = $('.map-slot-in .ms-t');
      const h = $('.map-slot-in .ms-h');
      if (t) t.textContent = 'Map surface unavailable';
      if (h) {
        h.textContent =
          'Tracing needs a Google Maps browser key (NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY). ' +
          'The ledger and the price still work from run lengths typed by hand.';
      }
      return;
    }
    const slot = $('#mapSlot');
    if (!slot) return;
    // The island needs a node this module never writes to again. `.map-slot-in`
    // is the placeholder `showSite` fills, so the surface gets its OWN empty
    // sibling and the placeholder is taken out of the flow behind it.
    slot.querySelector<HTMLElement>('.map-slot-in')?.classList.add('is-hidden');
    const host = document.createElement('div');
    host.className = 'map-live';
    slot.appendChild(host);
    mapIsland = mountIsland(host, FenceDrawMap, mapProps());
    disposers.push(function () {
      mapIsland?.destroy();
      mapIsland = null;
      mapApi = null;
      // The host is this module's node, so this module takes it back out — and
      // the placeholder underneath returns, which is what an unmounted surface
      // honestly looks like. AFTER React's unmount: `destroy()` defers that to a
      // microtask, and microtasks run in order, so this one lands second.
      queueMicrotask(function () {
        host.remove();
        slot.querySelector<HTMLElement>('.map-slot-in')?.classList.remove('is-hidden');
      });
    });
  }

  // ================= 3D PREVIEW (React island, loaded on demand) =============
  // The "3D" switch used to swap one placeholder for another whose copy promised
  // a scene that "renders live from the ledger". Nothing rendered.
  //
  // It now mounts the studio's existing components/estimator/fence/FenceModel3D
  // — instanced posts / pickets / rails, gate leaves, chain-link infill and real
  // neighbouring buildings — driven by THE SAME `mapPoints` the ledger is
  // derived from. It is not a second source of truth: no geometry, no scene.
  //
  // Loaded with a dynamic import, so a visitor who never opens 3D never
  // downloads Three.js on a page whose primary job is a map.

  type ModelProps = Parameters<typeof FenceModel3D>[0];

  let modelIsland: Island<ModelProps> | null = null;
  let modelHost: HTMLElement | null = null;
  let modelLoading = false;
  let torndown = false;
  /** Real nearby footprints, in the same local-feet frame as the trace. Filled
   *  by "Load property lines"; the parcel lookup already returns them. */
  let siteBuildings: BuildingFootprint[] = [];

  // FenceModel3D re-applies its whole scene whenever a prop CHANGES IDENTITY, so
  // the gate array has to stay the same array until an opening actually moves.
  // Rebuilt from a signature rather than on every push: `renderFigures` runs on
  // each keystroke in a run-length box, and a fresh `[]` there would tear down
  // and rebuild the scene per character.
  let gatesSig = '';
  let gatesArr: GateSpec[] = [];
  function modelGates(): GateSpec[] {
    const placed = fs.openings.filter(isPlaced);
    const sig = placed
      .map(function (o) { return [o.id, o.type, o.seg, o.t, o.x, o.y].join(':'); })
      .join('|');
    if (sig !== gatesSig) {
      gatesSig = sig;
      gatesArr = placed.map(toGateSpec);
    }
    return gatesArr;
  }

  function modelProps(): ModelProps {
    return {
      points: mapPoints,
      height: fs.height,
      // The scene knows five looks; every type renders as one of them.
      material: currentType().type.family,
      // This page's swatch, so the 3D fence is the colour of the type chip
      // the user picked in the rail.
      materialColor: typeRow(fs.material).color,
      gates: modelGates(),
      // No segment-selection UI on this page, so nothing is ever highlighted.
      selectedSegment: null,
      // The houses drawn by hand, and only those: no building is ever shown
      // that the contractor did not outline (owner, 2026-09-27).
      buildings: modelHouses(),
      terrain: modelTerrain(),
      segClasses: modelClasses(),
      segSteps: modelSteps(),
      wallMounts: wallMounts().ft,
      // The property line on the land, in the map's lot colour.
      lots: modelLots(),
      lotColor: token('--parcel-line'),
      // The parts the type is really built from, at this height and spacing.
      build: currentBuild(),
      active: fs.mode === '3d',
      className: 'model-live-in',
    };
  }

  /** What the fence is built from — the picked type at the picked height
   *  and post spacing; one object per distinct answer, so the scene and the
   *  ground rules see a change only when there is one. */
  let buildMemo: { key: string; build: FenceBuild } | null = null;
  function currentBuild(): FenceBuild {
    const t = currentType().type;
    const key = t.id + '|' + fs.height + '|' + (fs.spacing ?? '');
    if (buildMemo && buildMemo.key === key) return buildMemo.build;
    buildMemo = { key: key, build: fenceBuildFor(t, fs.height, fs.spacing) };
    return buildMemo.build;
  }

  function pushModel() {
    if (!modelIsland) return;
    modelIsland.update(modelProps());
  }

  /** The buildings the scene stands up: the traced houses — identity-stable,
   *  so a push that changed nothing rebuilds nothing. Detected footprints stay
   *  map context and never reach the 3D. */
  let housesMemo: { houses: DrawnHouse[]; view: BuildingFootprint[] } | null = null;
  function modelHouses(): BuildingFootprint[] {
    if (housesMemo && housesMemo.houses === houses) return housesMemo.view;
    housesMemo = { houses: houses, view: mergeBuildings(houses, []) };
    return housesMemo.view;
  }
  /** This address's lot rings in local feet; one empty list when there is no
   *  lot, so the scene is not re-laid for a fresh `[]` on every push. */
  const NO_LOT_RINGS: PathPoint[][] = [];
  function modelLots(): PathPoint[][] {
    const rings = mapOrigin ? lotRingsFt(mapOrigin) : NO_LOT_RINGS;
    return rings.length ? rings : NO_LOT_RINGS;
  }

  /** The lot's lattice for the scene — this address's, identity-stable. */
  let terrain3dMemo: { rev: number; view: FenceTerrain3D } | null = null;
  function modelTerrain(): FenceTerrain3D | null {
    const g = topoGrid;
    if (!g || !sameOrigin(g.origin, mapOrigin)) return null;
    if (terrain3dMemo && terrain3dMemo.rev === g.rev) return terrain3dMemo.view;
    terrain3dMemo = { rev: g.rev, view: { plan: g.plan, grid: g.grid } };
    return terrain3dMemo.view;
  }

  /** Slope class per traced segment: the PRICED classes when the fence's own
   *  profile is in, so the 3D steps exactly where the ticket charges steps;
   *  until then (or if it failed) read off the lot lattice with the same
   *  thresholds. */
  let classesMemo: { key: unknown[]; view: Record<number, BayClass> | null; steps: Record<number, number> | null } | null = null;
  function modelClasses(): Record<number, BayClass> | null {
    return modelSlope().view;
  }
  /** The ticket's step count per stepped segment, for the 3D to draw exactly
   *  that many (null while the lattice speaks for the ground). */
  function modelSteps(): Record<number, number> | null {
    return modelSlope().steps;
  }
  function modelSlope(): { view: Record<number, BayClass> | null; steps: Record<number, number> | null } {
    const report = usableTerrain();
    const g = topoGrid && sameOrigin(topoGrid.origin, mapOrigin) ? topoGrid : null;
    const key = [report, g ? g.rev : -1, mapPoints, effectiveSpacingFt(currentType().type, fs.spacing)];
    if (classesMemo && classesMemo.key.every(function (k, i) { return k === key[i]; })) return classesMemo;
    let view: Record<number, BayClass> | null = null;
    let steps: Record<number, number> | null = null;
    // A dragged dot keeps every segment index, so the old report still reads
    // as "usable" until the new profile lands. The price can live with the old
    // grade FACTOR for that moment; the 3D must not stand the moved segment up
    // with its old CLASS — so the report counts only while its plan lengths
    // still match the trace, and the lattice speaks for the ground meanwhile.
    const fresh = !!report && report.segs.every(function (sg) {
      const a = mapPoints[sg.seg];
      const b = mapPoints[sg.seg + 1];
      return !!a && !!b && Math.abs(Math.hypot(b.x - a.x, b.y - a.y) - sg.planFt) < 0.5;
    });
    if (report && fresh) {
      view = {};
      steps = {};
      const out = view;
      const counts = steps;
      report.segs.forEach(function (sg) {
        out[sg.seg] = sg.cls;
        const n = pricedSteps(sg);
        if (n > 0) counts[sg.seg] = n;
      });
    } else if (g) {
      view = {};
      for (let i = 0; i + 1 < mapPoints.length; i++) {
        const a = mapPoints[i];
        const b = mapPoints[i + 1];
        if (b.gap) continue;
        const lg = lineGradeOnGrid(g.grid, g.plan, a, b);
        if (lg) view[i] = lg.cls;
      }
    }
    classesMemo = { key: key, view: view, steps: steps };
    return classesMemo;
  }

  /** The note in the 3D corner: what the ground in the scene is, what the lot
   *  line looks like, and — when no house is drawn — why there is none and
   *  how to add it. Under the "Live · 3D" stamp, clear of the walking hint. */
  function renderModelNote() {
    const note = $('#modelNote');
    if (!note) return;
    if (!modelIsland) { note.classList.add('is-hidden'); return; }
    const g = modelTerrain();
    const mounts = wallMounts().ft.length;
    const ground: string[] = [];
    if (!g || !topoGrid) {
      ground.push('Terrain not shown — ground rendered flat');
    } else {
      const report = usableTerrain();
      // The ticket's count: a bay dropping more than a code step is split.
      const steps = report ? slope()?.steppedSections ?? 0 : 0;
      const racked = report ? report.segs.filter(function (sg) { return sg.cls === 'racked'; }).length : 0;
      const rolling = report ? report.segs.filter(function (sg) { return sg.cls === 'stepped' && sg.rolling; }).length : 0;
      ground.push('Real ground · ' + sourceLabel(topoGrid));
      if (steps) ground.push(steps + ' steps' + (rolling ? ' (' + rolling + (rolling === 1 ? ' run' : ' runs') + ' on rolling ground)' : ''));
      if (racked) ground.push(racked + (racked === 1 ? ' run racked' : ' runs racked'));
    }
    if (mounts) ground.push(mounts + (mounts === 1 ? ' wall mount' : ' wall mounts'));
    const rows: HTMLElement[] = [];
    const row = function (text: string, cls: string) {
      const el = document.createElement('span');
      el.className = 'mn-row ' + cls;
      el.textContent = text;
      rows.push(el);
      return el;
    };
    row(ground.join(' · '), 'mn-ground');
    if (modelLots().length) {
      const lot = row('Lot line', 'mn-lot');
      const sw = document.createElement('i');
      sw.className = 'mn-sw';
      sw.setAttribute('aria-hidden', 'true');
      lot.prepend(sw);
    }
    if (!houses.length) row('No house drawn · press House, then click its corners', 'mn-house');
    note.replaceChildren(...rows);
    note.classList.remove('is-hidden');
  }

  /** Mount the scene, once, the first time it is both wanted and possible. */
  async function ensureModel() {
    if (modelIsland || modelLoading) return;
    const slot = $('#stage3d');
    if (!slot) return;
    modelLoading = true;
    try {
      const mod = await import("@/components/estimator/fence/FenceModel3D");
      // The page can be navigated away from while the chunk is in flight.
      if (torndown) return;
      const host = document.createElement('div');
      host.className = 'model-live';
      slot.appendChild(host);
      modelHost = host;
      modelIsland = mountIsland(host, mod.FenceModel3D, modelProps());
      // The scene is opaque and covers the slot, so the placeholder underneath
      // it goes. `unmountModel` puts it back.
      slot.querySelector<HTMLElement>('.map-slot-in')?.classList.add('is-hidden');
      // The note says what ground the scene stands on: the real lattice, or a
      // flat plane when there is none — never a silent lie either way.
      renderModelNote();
    } catch (err) {
      console.error('[fence-estimator] 3D preview failed to load:', err);
      sayHint('The 3D preview could not be loaded. The map, the ledger and the price are unaffected.');
    } finally {
      modelLoading = false;
    }
  }

  /** Take the scene back down and return the panel to its "nothing traced yet"
   *  copy. Cheaper than it looks: the dynamic import is memoised, so a remount
   *  after the next trace does not re-fetch Three.js.
   *
   *  Unmounting rather than hiding is deliberate — `.is-hidden` is
   *  `display: none`, and a WebGL canvas measured at 0×0 comes back wrong. */
  function unmountModel() {
    if (!modelIsland) return;
    modelIsland.destroy();
    modelIsland = null;
    const host = modelHost;
    modelHost = null;
    // AFTER React's unmount — `destroy()` defers that to a microtask, and
    // microtasks run in order, so this one lands second.
    if (host) queueMicrotask(function () { host.remove(); });
    $('#stage3d .map-slot-in')?.classList.remove('is-hidden');
    $('#modelNote')?.classList.add('is-hidden');
  }

  /** Which stage panel is showing, and whether the scene should exist at all.
   *  Two points is the minimum that makes a fence: below that the panel keeps
   *  its "nothing traced yet" copy instead of showing an empty field, because a
   *  3D view of nothing is the kind of thing that reads as broken. */
  function syncStage() {
    const show3d = fs.mode === '3d';
    $('#mapSlot')?.classList.toggle('is-hidden', show3d);
    $('#stage3d')?.classList.toggle('is-hidden', !show3d);
    if (mapPoints.length < 2) unmountModel();
    else if (show3d) void ensureModel();
    pushModel();
  }

  /** The PNG the proposal carries. `FenceModel3D` builds its renderer with
   *  `preserveDrawingBuffer`, so its canvas can be read directly and this page
   *  does not need an imperative handle across the island boundary. Null until
   *  the user has opened the 3D view — the proposal simply goes without. */
  function captureModel(): string | null {
    const canvas = modelHost?.querySelector<HTMLCanvasElement>('canvas');
    if (!canvas) return null;
    try {
      // A retina canvas as PNG runs to megabytes, and Vercel refuses a
      // request over 4.5 MB before the action ever runs (2026-09-22). The
      // snapshot goes as a JPEG no longer than 1600 px, and if that is still
      // over 1 MB the quality steps down; if nothing fits, no picture — the
      // proposal never fails for its snapshot.
      const MAX_SIDE = 1600;
      const scale = Math.min(1, MAX_SIDE / Math.max(canvas.width, canvas.height, 1));
      const w = Math.max(1, Math.round(canvas.width * scale));
      const h = Math.max(1, Math.round(canvas.height * scale));
      const off = document.createElement('canvas');
      off.width = w; off.height = h;
      const cx = off.getContext('2d');
      if (!cx) return null;
      cx.fillStyle = '#ffffff';
      cx.fillRect(0, 0, w, h);
      cx.drawImage(canvas, 0, 0, w, h);
      for (const q of [0.85, 0.7, 0.55, 0.4]) {
        const url = off.toDataURL('image/jpeg', q);
        if (url.length <= 1_000_000) return url;
      }
      return null;
    } catch {
      return null;
    }
  }

  /** The snapshot for the proposal, whether or not the 3D view was ever
   *  opened (owner, 2026-09-23: the client was not getting the picture).
   *  When no scene is up, the 3D panel is shown for a moment, the scene
   *  mounted and given time to draw, the canvas read, and the map put back.
   *  Any failure means no picture, never a failed proposal. */
  async function captureModelForProposal(): Promise<string | null> {
    const direct = captureModel();
    if (direct) return direct;
    if (mapPoints.length < 2 || torndown) return null;
    const was = fs.mode;
    const setMode = function (m: string) {
      fs.mode = m;
      $$('#modeSwitch .vsw-btn').forEach(function (b) { b.classList.toggle('active', (b as HTMLElement).dataset.mode === m); });
    };
    try {
      setMode('3d');
      if (armed) setArmed(null);
      $('#mapSlot')?.classList.add('is-hidden');
      $('#stage3d')?.classList.remove('is-hidden');
      await ensureModel();
      pushModel();
      const t0 = Date.now();
      while (Date.now() - t0 < 2200) {
        await new Promise<void>(function (r) { requestAnimationFrame(function () { r(); }); });
        const c = modelHost?.querySelector<HTMLCanvasElement>('canvas');
        if (c && c.width > 0 && c.height > 0 && Date.now() - t0 >= 900) break;
      }
      return captureModel();
    } catch {
      return null;
    } finally {
      setMode(was);
      syncStage();
    }
  }

  /** The traced layout for the client's drawing (lib/fence/planSvg): the
   *  runs, the gates where they sit, the houses and the lot, in local feet.
   *  Nothing when the runs were typed rather than traced. */
  function fencePlanForProposal(pk: FencePackage, lf: number, where: string): FencePlan | null {
    if (!mapOwnsRuns || mapPoints.length < 2) return null;
    const r1 = function (n: number) { return Math.round(n * 10) / 10; };
    const pt = function (p: PathPoint) { return p.gap ? { x: r1(p.x), y: r1(p.y), gap: true } : { x: r1(p.x), y: r1(p.y) }; };
    const o = mapOrigin;
    return {
      points: mapPoints.slice(0, 600).map(pt),
      gates: modelGates().slice(0, 40).map(function (g) {
        const op = fs.openings.find(function (x) { return x.id === g.id; });
        return { segmentIndex: g.segmentIndex, t: g.t, widthFt: g.widthFt, kind: g.kind, label: op ? opType(op.type).label : undefined, x: g.x, y: g.y };
      }),
      buildings: modelBuildings().slice(0, 40).map(function (b) { return { ring: b.ring.slice(0, 300).map(pt), role: b.role, heightFt: Math.min(80, Math.max(6, Math.round(b.heightFt))) }; }),
      lots: (o ? lotRingsFt(o) : []).slice(0, 10).map(function (r) { return r.slice(0, 400).map(pt); }),
      origin: o,
      heightFt: pk.builtHeightFt,
      typeLabel: pk.resolved.label,
      totalLf: lf,
      address: where || null,
      scene: sceneForProposal(),
    };
  }

  /** The studio's 3D beyond the plan (lib/fence/scene, 2026-09-27): what the
   *  client's page and the saved proposal stand up — the look and colour,
   *  the gates with their variants, the priced slope class per run, the wall
   *  mounts, the land's lattice (thinned to the stored cap) and the lot
   *  line's colour. No picture is uploaded: the scene is rebuilt from this. */
  function sceneForProposal(): FencePlanScene {
    const r1 = function (n: number) { return Math.round(n * 10) / 10; };
    const r2 = function (n: number) { return Math.round(n * 100) / 100; };
    const t = modelTerrain();
    const terrain = t ? capTerrain({ plan: t.plan, grid: t.grid.map(function (row) { return row.map(r2); }) }) : null;
    const classes = modelClasses();
    const seg: Record<number, BayClass> = {};
    if (classes) Object.keys(classes).forEach(function (k) { seg[Number(k)] = classes[Number(k)]; });
    const counts = modelSteps();
    const segSteps: Record<number, number> = {};
    if (counts) Object.keys(counts).forEach(function (k) { segSteps[Number(k)] = counts[Number(k)]; });
    const family = currentType().type.family;
    const swatch = typeRow(fs.material).color;
    const hex6 = /^#[0-9a-f]{6}$/i;
    const hex3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i;
    const m3 = hex3.exec(swatch || '');
    const color = hex6.test(swatch || '') ? swatch : m3 ? '#' + m3[1] + m3[1] + m3[2] + m3[2] + m3[3] + m3[3] : familySwatch(family);
    const lot = token('--parcel-line');
    return {
      family: family,
      color: color,
      gates: modelGates().slice(0, 40).map(function (g) { return { id: g.id, segmentIndex: g.segmentIndex, t: g.t, widthFt: g.widthFt, kind: g.kind, variant: g.variant, x: g.x, y: g.y }; }),
      segClasses: seg,
      segSteps: segSteps,
      wallMounts: wallMounts().ft.slice(0, 40).map(function (q) { return { x: r1(q.x), y: r1(q.y) }; }),
      terrain: terrain,
      lotColor: lot && hex6.test(lot) ? lot : null,
      build: currentBuild(),
    };
  }

  disposers.push(function () {
    // Set BEFORE the unmount: it is also what stops an in-flight `import()`
    // from mounting a scene into a page that has already gone.
    torndown = true;
    unmountModel();
  });

  // The support launcher sits in the corner the map's zoom buttons use. While
  // the stage is on screen the page says so on <html>; the stylesheet hides
  // the launcher there on a phone (it is back by the time the price is).
  const stageCanvasEl = root.querySelector<HTMLElement>("#stageCanvas");
  if (stageCanvasEl && typeof IntersectionObserver === 'function') {
    const io = new IntersectionObserver(function (entries) {
      const on = entries.some(function (e) { return e.isIntersecting && e.intersectionRatio >= 0.2; });
      document.documentElement.classList.toggle('jf-fence-stage-onscreen', on);
    }, { threshold: [0, 0.2, 0.5] });
    io.observe(stageCanvasEl);
    disposers.push(function () {
      io.disconnect();
      document.documentElement.classList.remove('jf-fence-stage-onscreen');
    });
  }

  // ================= ADDRESS SEARCH =================
  // Real Places suggestions on the studio's address bar. The browser key
  // (NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY) was already configured and already in
  // use by the React roof form; this field was plain text and ignored it. The
  // picked place is held here so the map layer can consume it once the Google
  // Maps surface is mounted in `#mapSlot`.
  let sitePlace: PickedPlace | null = null;

  const addrInput = root.querySelector<HTMLInputElement>('#addrInput');
  if (addrInput) {
    disposers.push(
      attachPlacesSuggest(addrInput, {
        onPick(p) {
          // Free typing reports `typed`; only a resolved place is a site.
          if (p.typed) return;
          setSite(p);
        },
        // Google refused to suggest (browser key not entitled to Places (New),
        // referrer not allowed, SDK failed to load). The bar still works as a
        // plain field — Find geocodes whatever was typed — so say that, with
        // Google's own reason, instead of a list that silently never opens.
        onError(message) {
          sayHint('Address suggestions are unavailable (' + message + '). Type the full address and press Find.');
        },
      }),
    );
    if (opts.initialFence?.pin && !addrInput.value) {
      // A website or house lead (lib/webHandoff): the site is the pin the homeowner's page priced at, so the local-feet
      // points line up — no Find, no second geocode. The fence itself lands once the shop's book is in (applyInitialFence).
      const address = opts.initialAddress ?? '';
      addrInput.value = address;
      setSite({ address, city: '', state: '', zip: '', lat: opts.initialFence.pin.lat, lng: opts.initialFence.pin.lng, formatted: address, typed: true });
    } else if (opts.initialAddress && !addrInput.value) {
      // A lead handed over from its page: the address is already typed, and
      // Find geocodes it at once when the browser key allows.
      addrInput.value = opts.initialAddress;
      const fb = root.querySelector<HTMLElement>('#findBtn');
      if (fb && isMapsBrowserEnabled()) window.setTimeout(function () { fb.click(); }, 300);
    }
  }

  /** Moves the draw surface to the resolved address, and keeps the placeholder
   *  underneath it in step — that placeholder is the only feedback there is when
   *  no browser key is configured and no surface mounted. */
  /**
   * THE ONE WAY A SITE ARRIVES (a picked suggestion or Find). The site is the
   * job's market (market() → priceOpts() → pkg()), so the studio re-renders
   * from the same package at once: the ticket, the type rows and the convert
   * all read pkg(), whatever order the runs and the address came in.
   */
  function setSite(p: PickedPlace) {
    sitePlace = p;
    showSite(p);
    renderStudio();
  }
  function showSite(p: PickedPlace) {
    const t = $('.map-slot-in .ms-t');
    const h = $('.map-slot-in .ms-h');
    if (t) t.textContent = p.formatted || p.address;
    if (h) {
      h.textContent = [p.city, p.state, p.zip].filter(Boolean).join(", ") ||
        "Address resolved — trace the run on this layer.";
    }
    if (typeof p.lat === 'number' && typeof p.lng === 'number') {
      // The local-feet frame is defined by this origin, so the surface rebuilds
      // its map on it (its own effect depends on lat/lng).
      mapOrigin = { lat: p.lat, lng: p.lng };
      // Traced houses and detected buildings belong to the old address.
      houses = [];
      setSiteBuildings([]);
      resetHouseLookup();
      setHouseMode(false);
      houseLayerTouched = false;
      setHouseLayer(false);
      renderHousePanel();
      // First resolved address is what brings the surface into existence.
      mountMap();
      pushMap();
      pushModel();
      renderModelNote();
      // The parcel lookup keys off the same point. Fired here — not from a
      // button — so the boundary and the sides list are already waiting by the
      // time the contractor looks down from the address field. Cache-first on
      // the server, so a repeat search costs no quota.
      void loadParcelForOrigin();
      // The land's contours belong to this address. The lattice is sized from
      // the lot, so it waits for the parcel answer — with a fallback in case
      // that lookup is slow — rather than spending two requests per address.
      resetTopo();
      renderTopoLegend();
      scheduleTopo(2500);
      // A new origin re-frames the local-feet trace: whatever profile was
      // measured belongs to the old ground, so it re-measures here.
      if (mapPoints.length >= 2) scheduleTerrain();
    }
  }

  /** The Find button: geocode the typed text directly. */
  async function geocodeTyped(btn: HTMLElement) {
    const q = (addrInput?.value || '').trim();
    if (!q || btn.dataset.busy) return;
    btn.dataset.busy = '1';
    const old = btn.innerHTML;
    btn.innerHTML = '<svg class="ic"><use href="#i-search"/></svg>Finding…';
    try {
      const g = await loadMapsLibrary<{ Geocoder: new () => { geocode: (r: unknown) => Promise<{ results: GeoResult[] }> } }>("geocoding");
      const { results } = await new g.Geocoder().geocode({ address: q, region: 'us' });
      const r = results?.[0];
      if (r) {
        const formatted = String(r.formatted_address ?? q).replace(/,\s*USA$/, '');
        const loc = r.geometry?.location;
        const place: PickedPlace = {
          address: formatted.split(',')[0] || formatted,
          city: '', state: '', zip: '', formatted,
          // Without these the Find button would resolve an address the map
          // never moved to.
          lat: loc ? loc.lat() : undefined,
          lng: loc ? loc.lng() : undefined,
        };
        if (addrInput) addrInput.value = formatted;
        setSite(place);
        btn.innerHTML = '<svg class="ic"><use href="#i-check"/></svg>Found';
      } else {
        btn.innerHTML = '<svg class="ic"><use href="#i-search"/></svg>No match';
      }
    } catch (err) {
      console.error('[fence-estimator] geocode failed:', err);
      btn.innerHTML = '<svg class="ic"><use href="#i-search"/></svg>Lookup failed';
    }
    after(function () { btn.innerHTML = old; delete btn.dataset.busy; }, 1600);
  }

  // ================= PROPERTY LINES (ReportAll) =================
  // The parcel comes from /api/parcels — ReportAll USA cadastral polygons behind
  // a permanent server-side cache (the account quota is ALLTIME, so a repeat
  // address costs nothing). It is NOT dumped into the trace: every lot renders
  // as a display-only polygon overlay, and every side of every lot becomes a
  // checkbox row in `#parcelPanel`. The checked sides — the frontage is
  // unchecked by default — are what "Put down the fence" lays fence along.
  //
  // IT LOADS ITSELF. There is no "Load property lines" button any more: the
  // lookup fires the moment an address resolves, because a contractor who has
  // typed the address has already said which property this is.
  //
  // Building footprints still come from the OLD `fetchPropertyBoundary` action
  // (Regrid may be dead, but its OSM half fails soft and still returns the
  // neighbourhood): they are the 3D view's spatial context, fetched in parallel
  // and never allowed to block or fail the parcel.

  /** One lot of the property. `/api/parcels` returns these grouped per parcel —
   *  the lots the point itself hit, plus the same owner's adjoining lots, which
   *  is what makes a two-deed property drawable at all (the flat `rings` array
   *  cannot say where one lot ends and the next begins). */
  interface ParcelChoiceApi {
    robustId: string;
    owner: string | null;
    address: string | null;
    acreage: number | null;
    rings: RingPoint[][];
  }
  interface ParcelApiHit {
    found: true;
    cached: boolean;
    parcel: {
      robustId: string;
      owner: string | null;
      address: string | null;
      acreage: number | null;
    };
    rings: RingPoint[][];
    /** Every lot of the property, SUBJECT FIRST. Older responses omit it. */
    parcels?: ParcelChoiceApi[];
  }

  /** The ring that contains the origin, else the longest one — a MULTIPOLYGON
   *  parcel (a lot split by a road) returns several. */
  function pickRing(rings: RingPoint[][], o: { lat: number; lng: number }): RingPoint[] | null {
    let best: RingPoint[] | null = null;
    for (const r of rings) {
      if (r.length < 3) continue;
      if (pointInRing(o.lat, o.lng, r.map(function (p) { return { lat: p[0], lng: p[1] }; }))) return r;
      if (!best || r.length > best.length) best = r;
    }
    return best;
  }

  /** The surveyed vertices a listed side actually runs through — one listed
   *  side can span several segments, so the hover highlight is a PATH. */
  function sidePath(lotIndex: number, i: number): Array<{ lat: number; lng: number }> | null {
    const lot = parcelLots[lotIndex];
    const s = lot?.sides[i];
    if (!lot || !s) return null;
    const out: Array<{ lat: number; lng: number }> = [];
    for (let k = 0; k <= s.span; k++) {
      const p = lot.ringPts[(s.start + k) % lot.ringPts.length];
      out.push({ lat: p[0], lng: p[1] });
    }
    return out;
  }

  function hoveredSidePath(): Array<{ lat: number; lng: number }> | null {
    return parcelHover === null ? null : sidePath(parcelHover.lot, parcelHover.side);
  }

  function hideParcelPanel() {
    clearFenceDone();
    parcelLots = [];
    parcelOrigin = null;
    parcelHover = null;
    parcelRoads = [];
    $('#parcelPanel')?.classList.add('is-hidden');
    syncFenceBtn();
    pushModel();
    renderModelNote();
  }

  /** "Put down the fence" is only an offer while there is a property line to lay
   *  it along and at least one side is checked. */
  function syncFenceBtn() {
    const btn = $('#fenceBtn') as HTMLButtonElement | null;
    if (!btn) return;
    btn.disabled = checkedParcelFt() <= 0;
  }
  /** Back to the offer face — a new property, a lost parcel, or a reset. */
  function clearFenceDone() {
    const btn = $('#fenceBtn');
    if (!btn) return;
    btn.classList.remove('is-done');
    btn.removeAttribute('aria-label');
  }

  /** Turn one API lot into panel/map state. Returns null when the lot came back
   *  without usable geometry — a lot with no ring is not a lot to fence. */
  function toLot(choice: ParcelChoiceApi, o: { lat: number; lng: number }, roads: RoadLine[]): ParcelLot | null {
    const ringPts = pickRing(choice.rings, o);
    if (!ringPts || ringPts.length < 3) return null;
    const sides = groupSides(ringPts);
    const checked = sides.map(function () { return true; });
    const fronts = roads.length ? detectFrontSides(sides, roads) : [];
    // A contractor does not fence the frontage. A corner lot faces two streets
    // and loses both.
    fronts.forEach(function (f) { checked[f.index] = false; });
    return {
      choice: choice,
      ringPts: ringPts,
      ring: ringPts.map(function (p) { return { lat: p[0], lng: p[1] }; }),
      sides: sides,
      checked: checked,
      fronts: fronts,
    };
  }

  async function loadParcelForOrigin() {
    const o = mapOrigin;
    if (!o || parcelBusy) return;
    parcelBusy = true;
    try {
      // ONE call, started first and awaited last: it carries the 3D view's
      // building footprints AND the OSM street centrelines the front-side
      // decision reads. Fail-soft on both counts.
      const osmPromise = fetchPropertyBoundary(o.lat, o.lng);
      lookupHouse(o, osmPromise);

      const res = await fetch(
        '/api/parcels?lat=' + encodeURIComponent(o.lat) + '&lon=' + encodeURIComponent(o.lng),
      );
      if (res.status === 404) {
        const body = (await res.json().catch(function () { return {}; })) as {
          nearest?: { address: string | null; city: string | null } | null;
        };
        hideParcelPanel();
        pushMap();
        if (sameOrigin(mapOrigin, o)) scheduleTopo(0);
        const near = body.nearest?.address
          ? ' Nearest lot on record: ' + body.nearest.address +
            (body.nearest.city ? ', ' + body.nearest.city : '') + '.'
          : '';
        sayHint('Parcel not found at this point.' + near + ' Trace the fence manually on the map.');
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(function () { return {}; })) as { error?: string; code?: string; trialCap?: string };
        // The card-less trial's fence ceiling: the dialog asks for a card.
        if (body.code === 'PLAN_LIMIT_REACHED') reportPlanLimitResult({ ok: false, ...body });
        hideParcelPanel();
        pushMap();
        if (sameOrigin(mapOrigin, o)) scheduleTopo(0);
        sayHint(body.error || 'Parcel lookup failed — trace the fence manually.');
        return;
      }
      const data = (await res.json()) as ParcelApiHit;
      // One lot or several, the rest of this function works off the same list.
      const choices: ParcelChoiceApi[] = data.parcels && data.parcels.length
        ? data.parcels
        : [{ robustId: data.parcel.robustId, owner: data.parcel.owner, address: data.parcel.address, acreage: data.parcel.acreage, rings: data.rings }];
      parcelWasCached = data.cached;

      // The lots draw immediately; the sides list waits for the streets, which
      // are already in flight. Doing it the other way round would show a panel
      // whose checkboxes change under the contractor's cursor a second later.
      const build = (roads: RoadLine[]) =>
        choices
          .map(function (c) { return toLot(c, o, roads); })
          .filter(function (l): l is ParcelLot { return l !== null; });
      parcelLots = build([]);
      parcelOrigin = o;
      parcelHover = null;
      if (!parcelLots.length) {
        hideParcelPanel();
        pushMap();
        if (sameOrigin(mapOrigin, o)) scheduleTopo(0);
        sayHint('Parcel geometry was empty — trace the fence manually.');
        return;
      }
      pushMap();
      pushModel();
      renderModelNote();
      // The buildings may have beaten the lot here: which one is "on the lot"
      // can only be said now.
      settleHouseLookup(o);
      // The lot is known: size the contour lattice to it now, without waiting
      // for the street data below.
      if (sameOrigin(mapOrigin, o)) scheduleTopo(0);

      const osm = await osmPromise.catch(function () { return null; });
      parcelRoads = osm ? osm.roads : [];
      parcelLots = build(parcelRoads);
      parcelOrigin = o;
      renderParcelPanel();
      pushMap();
      pushModel();
      if (parcelLots.length > 1) {
        sayHint('This property is recorded as ' + parcelLots.length +
          ' lots — every one of them is drawn, and every side is listed below.');
      }
      const anyFront = parcelLots.some(function (l) { return l.fronts.length > 0; });
      if (!anyFront) {
        sayHint(
          osm && osm.roads.length
            ? 'No street runs close enough to call a frontage here — check the sides yourself before laying the fence.'
            : 'Street data was unavailable, so no side was marked as frontage — uncheck the street side manually.',
        );
      }
    } catch (err) {
      console.error('[fence-estimator] parcel lookup failed:', err);
      if (sameOrigin(mapOrigin, o)) scheduleTopo(0);
      sayHint('Parcel lookup failed — trace the fence manually.');
    } finally {
      parcelBusy = false;
    }
  }

  /** Indices of one lot's stubs — real boundary, too small to be worth a row. */
  function shortSideIndices(lot: ParcelLot): number[] {
    const out: number[] = [];
    lot.sides.forEach(function (s, i) { if (s.short) out.push(i); });
    return out;
  }

  /** Escape a value that came from OSM or a deed record before it goes into
   *  innerHTML — an owner or a street name is third-party text, not a literal. */
  function esc(s: string): string {
    return s.replace(/[&<>"]/g, function (c) {
      return c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;';
    });
  }

  /** Every lot's sides, in one list. With more than one lot each gets a heading
   *  row naming the deed, so a side belongs to a lot the contractor can see. */
  function renderParcelPanel() {
    const panel = $('#parcelPanel');
    const meta = $('#parcelMeta');
    const list = $('#parcelSides');
    if (!panel || !meta || !list || !parcelLots.length) return;
    clearFenceDone(); // a freshly loaded property has no fence down yet
    const subject = parcelLots[0].choice;
    const bits: string[] = [];
    if (subject.owner) bits.push(subject.owner);
    const acres = parcelLots.reduce(function (a, l) { return a + (l.choice.acreage ?? 0); }, 0);
    if (acres > 0) bits.push(acres.toFixed(2) + ' ac');
    if (parcelLots.length > 1) bits.push(parcelLots.length + ' lots');
    if (parcelWasCached) bits.push('cached');
    meta.textContent = bits.join(' · ') || '—';

    let html = '';
    parcelLots.forEach(function (lot, li) {
      if (parcelLots.length > 1) {
        const name = lot.choice.address || lot.choice.owner || 'Lot ' + (li + 1);
        const ac = typeof lot.choice.acreage === 'number' ? ' · ' + lot.choice.acreage.toFixed(2) + ' ac' : '';
        html += '<li class="ps-lot"><span class="ps-lot-n">Lot ' + (li + 1) + '</span>' +
          '<span class="ps-lot-a">' + esc(name + ac) + '</span></li>';
      }
      const frontBy = new Map<number, FrontSideMatch>();
      lot.fronts.forEach(function (f) { frontBy.set(f.index, f); });

      // Only the walls get rows, numbered as they read (1..N), not by their
      // index in the surveyed ring.
      let n = 0;
      lot.sides.forEach(function (s, i) {
        if (s.short) return;
        n += 1;
        const front = frontBy.get(i);
        // The street's own name is the contractor's confirmation that the right
        // side was dropped; the compass bearing is the fallback when OSM has no
        // name for it (common on service roads).
        const trailing = front && front.streetName
          ? '<span class="ps-street">' + esc(front.streetName) + '</span>'
          : '<span class="ps-dir">' + bearingLabel(s.bearing) + '</span>';
        html +=
          '<li class="ps-row" data-lot="' + li + '" data-side="' + i + '">' +
          '<label class="ps-label">' +
          '<input type="checkbox" data-side-check="' + i + '"' + (lot.checked[i] ? ' checked' : '') + ' />' +
          '<span class="ps-name">Side ' + n + '</span>' +
          (front ? '<span class="ps-tag">street</span>' : '') +
          '<span class="ps-ft">' + Math.round(s.feet) + ' ft</span>' +
          '<span class="ps-grade is-hidden" data-grade-lot="' + li + '" data-grade-side="' + i + '"></span>' +
          trailing +
          '</label></li>';
      });

      // The stubs, as ONE row per lot. They stay in the geometry (dropping them
      // would open gaps at the corners they connect) and default to included.
      const shorts = shortSideIndices(lot);
      if (shorts.length) {
        const ft = shorts.reduce(function (sum, i) { return sum + lot.sides[i].feet; }, 0);
        const on = shorts.every(function (i) { return lot.checked[i]; });
        html +=
          '<li class="ps-row ps-row--short" data-lot="' + li + '" data-side-short="1">' +
          '<label class="ps-label">' +
          '<input type="checkbox" data-side-short-check="1"' + (on ? ' checked' : '') + ' />' +
          '<span class="ps-name">+' + shorts.length + ' short segments</span>' +
          '<span class="ps-ft">' + Math.round(ft) + ' ft</span>' +
          '<span class="ps-dir">—</span>' +
          '</label></li>';
      }
    });

    list.innerHTML = html;
    panel.classList.remove('is-hidden');
    staggerIn(Array.from(list.querySelectorAll<HTMLElement>('li')));
    paintSideGrades();
    updateParcelSum();
  }

  /** Checked footage across the WHOLE property, every lot included. */
  function checkedParcelFt(): number {
    return parcelLots.reduce(function (total, lot) {
      return total + lot.sides.reduce(function (sum, s, i) {
        return sum + (lot.checked[i] ? s.feet : 0);
      }, 0);
    }, 0);
  }

  function updateParcelSum() {
    const sum = $('#parcelSum');
    const ft = Math.round(checkedParcelFt());
    if (sum) sum.textContent = ft + ' ft checked';
    syncFenceBtn();
  }

  /** One lot's checked sides → a list of polylines in local feet. Consecutive
   *  checked sides share vertices, so they come out as one line; an unchecked
   *  side between two checked ones splits the lot into two lines. Wrap-around is
   *  honoured: side n-1 flowing into side 0 is one continuous run when both are
   *  checked. */
  function lotFenceLines(lot: ParcelLot, o: { lat: number; lng: number }): PathPoint[][] {
    const n = lot.sides.length;
    if (!n || !lot.checked.some(Boolean)) return [];

    let groups: number[][] = [];
    let current: number[] = [];
    for (let i = 0; i < n; i++) {
      if (lot.checked[i]) {
        current.push(i);
      } else if (current.length) {
        groups.push(current);
        current = [];
      }
    }
    if (current.length) groups.push(current);
    // Wrap: last group ends at n-1 AND first begins at 0 → one run (unless it
    // is the same group, i.e. every side is checked — a closed loop).
    if (
      groups.length > 1 &&
      groups[0][0] === 0 &&
      groups[groups.length - 1][groups[groups.length - 1].length - 1] === n - 1
    ) {
      groups = [groups.pop()!.concat(groups.shift()!)].concat(groups);
    }

    // One vertex per listed side — the merged wall's END POINTS, not every
    // surveyed kink between them. That is both what gets built (a fence runs
    // straight between its end posts) and what keeps the ledger legible: one
    // ledger run per row in the panel.
    //
    // NOTE: when every side is checked the last vertex coincides with the
    // first. It STAYS — that duplicate is what closes the loop and what makes
    // the final side exist.
    return groups.map(function (g) {
      const start = lot.sides[g[0]].from;
      const line: PathPoint[] = [latLngToLocalFeet(o, { lat: start[0], lng: start[1] })];
      g.forEach(function (i) {
        const to = lot.sides[i].to;
        line.push(latLngToLocalFeet(o, { lat: to[0], lng: to[1] }));
      });
      return line;
    });
  }

  /**
   * "Put down the fence": lay fence along the checked sides of every lot.
   *
   * ADDITIVE, on purpose. Anything already traced on the map stays exactly where
   * it is and the property lines arrive as further runs — a `gap` on each new
   * line's first point is the same encoding a hand-drawn multi-run trace uses,
   * so the two are one trace from here on and the ledger numbers them together.
   */
  function putDownTheFence(btn: HTMLElement) {
    const o = mapOrigin;
    if (!o || !parcelLots.length) {
      sayHint('Search the property address first — the fence is laid along the lot lines that loads.');
      return;
    }
    const lines: PathPoint[][] = [];
    parcelLots.forEach(function (lot) {
      lotFenceLines(lot, o).forEach(function (line) { if (line.length >= 2) lines.push(line); });
    });
    if (!lines.length) {
      sayHint('No sides are checked — tick the property sides you are fencing, then put the fence down.');
      return;
    }

    const pts: PathPoint[] = mapPoints.slice();
    lines.forEach(function (line) {
      line.forEach(function (p, i) {
        // The first point of every appended line breaks the run, so no fence is
        // drawn across the connector back to whatever was traced before it.
        pts.push(i === 0 && pts.length ? { ...p, gap: true } : p);
      });
    });
    applyTracedPath(pts);

    // Sticky done face (owner's call, 2026-09-08): the button rests on "Fence
    // down" until the property changes or the studio is reset; hovering shows
    // the offer again (CSS), and a second click lays the checked sides again.
    btn.classList.add('is-done');
    btn.setAttribute('aria-label', 'Fence down — click to lay the checked sides again');
    sayHint(
      Math.round(checkedParcelFt()) + ' ft of fence laid along the property line' +
      (parcelLots.length > 1 ? ' across ' + parcelLots.length + ' lots' : '') +
      ' — drag the dots to fine-tune, or add gates and doors.',
    );
  }

  // Panel wiring — delegated, registered once (the panel node is in the initial
  // markup; only its LIST is rebuilt per property).
  const parcelPanelEl = $('#parcelPanel');
  if (parcelPanelEl) {
    on(parcelPanelEl, 'change', function (e) {
      const el = e.target as HTMLElement;
      const row = el.closest<HTMLElement>('[data-lot]');
      const lot = parcelLots[Number(row?.dataset.lot ?? -1)];
      if (!lot) return;
      const box = el.closest<HTMLInputElement>('[data-side-check]');
      if (box) {
        lot.checked[Number(box.dataset.sideCheck)] = box.checked;
        updateParcelSum();
        return;
      }
      // The stubs move together — they are one row, so they are one decision.
      const shortBox = el.closest<HTMLInputElement>('[data-side-short-check]');
      if (shortBox) {
        shortSideIndices(lot).forEach(function (i) { lot.checked[i] = shortBox.checked; });
        updateParcelSum();
      }
    });
    on(parcelPanelEl, 'mouseover', function (e) {
      const row = (e.target as HTMLElement).closest<HTMLElement>('[data-side]');
      const next = row
        ? { lot: Number(row.dataset.lot ?? 0), side: Number(row.dataset.side) }
        : null;
      const same =
        (next === null && parcelHover === null) ||
        (next !== null &&
          parcelHover !== null &&
          next.lot === parcelHover.lot &&
          next.side === parcelHover.side);
      if (!same) { parcelHover = next; pushMap(); }
    });
    on(parcelPanelEl, 'mouseleave', function () {
      if (parcelHover !== null) { parcelHover = null; pushMap(); }
    });
  }


  // ================= CONVERT TO PROPOSAL =================
  // The last leg of the flow, and the only one that writes. The proposal's
  // lines are the SAME package the ticket bills (lib/fence/pricing), each
  // with its material and labor halves, so the proposal's subtotal is the
  // ticket total to the cent — no company markup on top, the rates are the
  // installed price (2026-10-01); the state's sales tax is added on the
  // server. The scope of work is the engine's own sentences about THIS fence — the posts, the sections, the
  // gates — and the assumptions carry the takeoff summary and every check.

  /** `n gate(s)` / `n door(s)`, or nothing when there are none of that kind. */
  function countPhrase(n: number, word: string) {
    return n + ' ' + word + (n === 1 ? '' : 's');
  }

  async function convertToProposal(btn: HTMLElement) {
    const old = btn.innerHTML;
    const say = (icon: string, label: string) => {
      btn.innerHTML = '<svg class="ic"><use href="#' + icon + '"/></svg>' + label;
    };
    const restore = () => {
      after(function () { btn.innerHTML = old; delete btn.dataset.busy; }, 2200);
    };
    btn.dataset.busy = '1';
    dropHeldHint();

    const p = price();
    if (p.ft <= 0) {
      say('i-file', 'Nothing to convert');
      sayHint('Trace the fence on the map, or add a run and type its length, before converting.');
      restore();
      return;
    }

    // The picture first: the 3D scene may need a moment to draw (see
    // captureModelForProposal); the button says so.
    say('i-file', 'Preparing the picture…');
    const previewDataUrl = await captureModelForProposal();
    say('i-file', 'Creating…');
    try {
      const layout = layoutInput();
      const pk = p.pkg;
      const tk = pk.takeoff;
      const where = sitePlace ? (sitePlace.formatted || sitePlace.address) : '';
      const lf = Math.round(pk.netFenceLf);
      const gateN = fs.openings.filter(function (o) { return opType(o.type).kind === 'gate'; }).length;
      const doorN = fs.openings.length - gateN;
      const openingNote = [
        gateN > 0 ? countPhrase(gateN, 'gate') : '',
        doorN > 0 ? countPhrase(doorN, 'door') : '',
      ].filter(Boolean).join(', ');
      const rackedFt = classFt('racked');
      const steppedFt = classFt('stepped');
      const checks = fenceChecks(pk, layout, slope());
      const runsNote = layout.runs.length + ' ' + (layout.runs.length === 1 ? 'run' : 'runs') + ', ' + layout.runs.reduce(function (a, r) { return a + r.corners; }, 0) + ' corners';

      const res = await convertFenceEstimateToProposal({
        title: pk.resolved.label + ' fence · ' + lf + ' lf',
        // The package's notes (warranty, wood, site prep, soil, utilities)
        // follow the scope so the client reads them on the proposal.
        scope: fenceScope(pk, layout, where || null).concat(['', 'Please note:'], pk.notes.map(function (n) { return '• ' + n; })).join('\n'),
        lines: pk.lines.map(function (l) {
          return { name: l.name, description: l.description, quantity: l.quantity, unit: l.unit, materialCost: l.materialCost, laborCost: l.laborCost };
        }),
        // The material list as the takeoff card shows it — the crew's pick list (lib/fence/savedTakeoff).
        takeoff: tk.bom.slice(0, 80).map(function (b) { return { label: b.label.slice(0, 240), qty: b.qty, unit: b.unit }; }),
        materials: [],
        labor: [],
        assumptions: [
          pk.resolved.label + ', ' + pk.builtHeightFt + ' ft tall' + (fs.height !== pk.builtHeightFt ? ' (' + fs.height + ' ft asked; not offered in this type)' : ''),
          lf + ' linear ft of fence across ' + runsNote + (Math.round(pk.totalLf) !== lf ? '; ' + Math.round(pk.totalLf) + ' ft drawn, gate openings taken out' : ''),
          'Takeoff: ' + tk.sections + ' sections at ' + tk.spacingFt + "' o.c., " + tk.posts.total + ' posts (' + tk.posts.line + ' line, ' + tk.posts.corner + ' corner, ' + tk.posts.end + ' end, ' + tk.posts.gate + ' gate), ' + tk.postLengthFt.base + "' post stock, " + (tk.bom.find(function (b) { return b.key === 'concrete'; })?.qty ?? 0) + ' bags of concrete, ' + fs.wastePct + '% waste on cut goods, ≈' + tk.laborHours + ' crew-hours',
          // The one honest line about the ground: measured (with the plan →
          // grade split), failed, or never traced.
          terrainAssumption(
            usableTerrain(),
            terrainStatus === 'failed' ? 'failed' : usableTerrain() ? 'ok' : mapOwnsRuns ? 'failed' : 'idle',
            { billedPlanFt: p.ft, billedGradeFt: p.gradeFt, billedRackedFt: rackedFt, billedSteppedFt: steppedFt },
          ) + ' · ' + TERRAIN_LABEL[layout.terrain].toLowerCase() + ' labor rate',
          openingNote || 'No gates or doors',
          fs.demo
            ? 'Includes removal and haul-away of the existing fence (' + Math.round(layout.removalLf || 0) + ' lf at $' + fs.removalPerLf + '/lf)'
            : 'No demolition included',
          'Rates: ' + (pk.rates.source.materialPerLf === 'book' || pk.rates.source.laborPerLf === 'book' ? 'this shop\u2019s price book' : pk.market && pk.market.resolution !== 'national' ? 'catalog rates calibrated to ' + pk.market.label : 'catalog national rates'),
        ]
          .concat(checks.filter(function (c) { return c.level === 'warn'; }).map(function (c) { return 'Check: ' + c.text; }))
          .concat(where ? ['Site: ' + where] : []),
        address: where || undefined,
        // The 3D scene renders with `preserveDrawingBuffer`, so its canvas can be
        // read straight off the island host. Only present once the user has
        // actually opened the 3D view.
        previewDataUrl: previewDataUrl ?? undefined,
        plan: fencePlanForProposal(pk, lf, where) ?? undefined,
      });

      // A refusal comes back as a result, never a throw (production redacts
      // a thrown message, so the page could not tell a plan cap from a bug).
      // The line under the stage keeps it until the next action.
      if (!res.ok) {
        if (isPlanLimitFailure(res)) {
          say('i-file', 'Plan limit');
          holdHint('This organization is at its proposal cap for the period — the next proposal needs a bigger plan.', { href: '/dashboard/upgrade', label: 'See plans' });
        } else if (res.code === 'FORBIDDEN') {
          say('i-file', 'Not allowed');
          holdHint(res.error);
        } else if (res.code === 'INVALID') {
          say('i-file', "Couldn't convert");
          holdHint('The estimate has a line the proposal cannot take — ' + res.error);
        } else {
          say('i-file', "Couldn't convert");
          holdHint(res.error);
        }
        restore();
        return;
      }
      // No `restore()`: the router is about to unmount this page, and the
      // teardown clears every pending timer anyway.
      say('i-check', 'Proposal created');
      opts.navigate(PROPOSAL_ROUTE + res.id);
    } catch (err) {
      console.error('[fence-estimator] convert failed:', err);
      say('i-file', "Couldn't convert");
      if (isPlanLimitError(err)) {
        holdHint(PLAN_LIMIT_MESSAGE + ' — this organization is at its proposal cap for the period.', { href: '/dashboard/upgrade', label: 'See plans' });
      } else if (/unexpected response/i.test(err instanceof Error ? err.message : '')) {
        // The middleware answered instead of the action: the session is gone.
        holdHint('The session has ended — reload the page and sign in again.');
      } else {
        // A network drop or a request the platform refused (too large) never reaches the action.
        holdHint('The request did not reach the server — check the connection and try again.');
      }
      restore();
    }
  }

  // ================= INITIALIZATION =================
  // The rate override is read BEFORE the first paint: restoring it afterwards
  // would render the card price and then swap it, which reads as a glitch.
  restoreRate();
  restoreTier();
  renderStudio();
  // The organization's saved book lands after the first paint; a tab with
  // its own edits keeps them (they are newer than the saved copy). A website or house lead's fence lands after it.
  void loadOrgBook().then(applyInitialFence);
  // The map is NOT mounted here: it mounts when an address resolves (showSite).
  // Without a browser key there is no surface to wait for, so the slot is told
  // that now rather than leaving a prompt that can never be satisfied.
  if (!isMapsBrowserEnabled()) mountMap();

  // The matchMedia polyfill, mobile nav drawer and FLUID SCALE belong to the
  // persistent chrome and live in
  // components/v3/blueprint-shell/shell-behavior.ts.

  // ================= MOTION SYSTEM — BALANCED (package 02) =================
  (function () {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    // The row cascade's curve now lives in blueprint-shell/list-motion.

    // Reveal: load + scroll.
    // Reveal adapts to scroll speed: a slow scroll gets the full 420ms
    // animation, a fast one a shorter pass (down to 200ms) — never lagging,
    // still visible.
    const vpH = window.innerHeight;
    const scrollHost = main;
    let velLastY = scrollHost ? scrollHost.scrollTop : 0;
    let velLastT = performance.now();
    let scrollVel = 0; // px/ms
    if (scrollHost)
      on(
        scrollHost,
        'scroll',
        () => {
          const now = performance.now();
          scrollVel = Math.abs(scrollHost.scrollTop - velLastY) / Math.max(1, now - velLastT);
          velLastY = scrollHost.scrollTop;
          velLastT = now;
        },
        { passive: true },
      );
    // The local <Sprite /> is skipped: it is a `.content` child only because the
    // port moved the donor's <body>-level sprite inside the mounted root, and it
    // is not one of the donor's four reveal blocks. Leaving it in would hand a
    // 0×0 `position: absolute` <svg> an `opacity: 0` it can never intersect its
    // way out of.
    const blocks = $$('.content > *').filter((el) => !(el instanceof SVGElement));
    blocks.forEach((el, i) => {
      el.classList.add('rv');
      const initial = el.getBoundingClientRect().top < vpH;
      if (!initial) el.dataset.rvScroll = '1';
      el.style.transitionDelay = initial ? i * 60 + 'ms' : '200ms';
    });
    // The donor's second reveal layer targets `.kpi`, which this page does not
    // use — the layer was silently absent there too. Kept verbatim so it stays
    // absent here.
    const cells = $$('.kpi');
    cells.forEach((el, i) => {
      el.classList.add('rv-cell');
      const initial = el.getBoundingClientRect().top < vpH;
      if (!initial) el.dataset.rvScroll = '1';
      el.style.transitionDelay = initial ? 160 + (i % 8) * 45 + 'ms' : '200ms';
    });
    const io = new IntersectionObserver(
      (es) => {
        es.forEach((en) => {
          if (!en.isIntersecting) return;
          const el = en.target as HTMLElement;
          if (el.dataset.rvScroll) {
            // below the fold: duration follows the current scroll speed
            const dur = Math.round(Math.max(550, 900 - scrollVel * 160));
            el.style.transitionDuration = dur + 'ms';
          }
          el.classList.add('rv-in');
          io.unobserve(el);
          el.addEventListener('transitionend', function te() {
            el.style.transitionDelay = '';
            el.style.transitionDuration = '';
            el.removeEventListener('transitionend', te);
          });
        });
      },
      { threshold: 0, rootMargin: '0px 0px 60px 0px' },
    );
    blocks.concat(cells).forEach((el) => io.observe(el));
    disposers.push(() => io.disconnect());

    // (Sidebar cascade lives in the shell — it plays once, on first load.)

    // Entrance cascade — first paint, plus Clear and Reset, which really do
    // re-list the studio. It used to hang off a MutationObserver on the runs and
    // materials lists, which is why adding a run, deleting a line or picking a
    // material replayed it. See blueprint-shell/list-motion for the reasoning.
    playStagger = () => {
      ['runsList', 'matList'].forEach((id) => {
        const list = $('#' + id);
        if (!list) return;
        staggerIn(Array.from(list.querySelectorAll<HTMLElement>('li')));
      });
    };
    playStagger();

    // Numeral count-up — the donor aims this at `.kpi-val`, a class this page
    // does not render (its headline figure is `.tk-total`, which the ticket
    // rewrites on every edit). Kept verbatim, therefore inert, exactly as in
    // the donor.
    $$('.kpi-val').forEach((el) => {
      const raw = (el.textContent || '').trim();
      const isMoney = raw.charAt(0) === '$';
      const target = parseInt(raw.replace(/[^0-9]/g, ''), 10);
      if (!isFinite(target)) return;
      let t0: number | null = null;
      function frame(t: number) {
        if (!t0) t0 = t;
        const pr = Math.min(1, (t - t0) / 750);
        const e = 1 - Math.pow(1 - pr, 3);
        el.textContent = (isMoney ? '$' : '') + Math.round(target * e).toLocaleString('en-US');
        if (pr < 1) requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });

    // Press effects — delegated to `root` so nodes injected after init
    // (menu items, JS-rendered buttons, innerHTML re-renders) still press.
    function pressify(sel: string, cls: string) {
      on(root, 'click', (e) => {
        const el = (e.target as Element).closest<HTMLElement>(sel);
        if (!el || !root.contains(el)) return;
        el.classList.remove(cls);
        void el.offsetWidth;
        el.classList.add(cls);
      });
      on(root, 'animationend', (e) => {
        const el = e.target as HTMLElement;
        if (el.matches && el.matches(sel)) el.classList.remove(cls);
      });
    }
    // Shell controls (.icon-btn, .sb-foot-*) press from the shell module.
    pressify('.btn, .card-foot-btn, .ptab, .pchip, .pager-btn, .pmenu-item, .photo-box, .pt-open, .tool, .zoom-btn, .seg-btn, .vsw-btn, .fs-find, .tp-item, .row-x', 'pressed');
    pressify('.week-strip .day', 'day-pressed');

    // (Graph-paper parallax lives in the shell — it owns .main.)
  })();

  // The sliding sidebar indicator lives in the shell — it survives navigation
  // and re-points at whichever item React marks `active`.

  return () => {
    disposed = true;
    timers.forEach((id) => clearTimeout(id));
    timers.clear();
    disposers.forEach((d) => d());
  };
}
