"use client";
// DECK ESTIMATOR — VARIANT 1, "ONE DECISION AT A TIME" (2026-10-18).
//
// A continuous form on the left, with a pinned live scene and price on the right.
// Every section is available by scrolling. Rare options remain in their existing
// disclosures; code-check links scroll to the relevant section.
//
// Same engine, same actions, same functions as the live studio (deck-estimator-blueprint/deck-studio.tsx): the state
// and handlers below are COPIED FROM deck-studio.tsx with their comments' intent kept; the presentation is this
// variant's own. The photo of the house is out (owner, 2026-10-11): its whole flow sits in deck-v1-photo.tsx behind the
// same PHOTO_ENABLED = false the old studio had, so turning the flag on brings it back here; with it off, a reopened
// design that carries a photo keeps it untouched in what it saves.
//
// Since 2026-10-18 this is THE deck estimator: /dashboard/deck-estimator renders it (the old studio, deck-studio.tsx,
// is retired but kept), and /dashboard/deck-v1 redirects there.

import * as React from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { createWheelMotion, wheelPixels } from "@/lib/smooth-wheel";
import { AlertTriangle, Check, ChevronDown, ChevronRight, ExternalLink, FileText, Lock, Maximize2, Mic, Minimize2, Plus, RotateCcw, Send, X, ZoomIn, ZoomOut } from "lucide-react";
import { resolveMarket, parseStateZip, type MarketSnapshot } from "@/lib/fence/market";
import { DECKING, DECKING_BRAND_LABEL, DECKING_BRAND_ORDER, DECKING_FAMILY_LABEL, DECKING_FAMILY_ORDER, FRAMING_SPECIES, RAIL_TYPES, WALL_TYPES, defaultDecking, defaultFramingSpecies, treatedDecking, wallType, type DeckingFamily, type DeckingProduct } from "@/lib/deck/catalog";
import { regionalPicks, regionalWords } from "@/lib/deck/regional";
import { LEDGER_FASTENER_LABEL, LOADS, POST_SIZES, SOLID_BEAMS, ftIn, solidBeamTabulated, type LoadPsf, type SoilPsf } from "@/lib/deck/codeTables";
import {
  BUILT_UP_CHOICES,
  CEILING_LABEL,
  CUSTOM_LIMITS,
  OWN_UNITS,
  DECK_LIMITS,
  ELECTRICAL_LIMITS,
  FASCIA_FINISH_LABEL,
  FIXTURE_KINDS,
  FIXTURE_LABEL,
  FLOOR_LABEL,
  FRONT_LABEL,
  GUTTER_KINDS,
  GUTTER_LABEL,
  LOWER_LIMITS,
  NOTCH_CORNERS,
  PATTERN_LABEL,
  PERGOLA_STYLE_LABEL,
  PLACEMENT_LABEL,
  RAIL_INFILL_LABEL,
  ROOFING_LABEL,
  ROOFINGS,
  ROOF_KIND_LABEL,
  ROOF_LIMITS,
  ROOF_PLAN_LABEL,
  STAIR_LANDING_LABEL,
  STAIR_LIMITS,
  STAIR_SIDE_LABEL,
  STRUCTURE_LABEL,
  WALL_FILL_LABEL,
  SPA_LIMITS,
  defaultDeckDesign,
  defaultFixture,
  defaultStair,
  hasDeck,
  hasRoof,
  normalizeDeckDesign,
  sizeWords,
  structureWords,
  type CustomProduct,
  type CustomSlot,
  type DeckDesign,
  type Fixture,
  type FixtureKind,
  type Floor,
  type FrontKind,
  type NotchCorner,
  type OwnItem,
  type OwnUnit,
  type Placement,
  type RoofDesign,
  type RoofKind,
  type RoofPlanShape,
  type StairDesign,
  type Structure,
} from "@/lib/deck/design";
import { priceDeck, deckNotes, deckScope } from "@/lib/deck/pricing";
import { railWords } from "@/lib/deck/rails";
import { electricalWords } from "@/lib/deck/electrical";
import { siteFromAddress, SLOPE_LIMITS, TERMITE_LABEL } from "@/lib/deck/site";
import { applyDeckPatch, checkSummary, deckChecks, type DeckCheck, type DeckPatch } from "@/lib/deck/checks";
import { deckScene, sceneBuildLayers, SCENE_LAYER_LABEL, type SceneLegend } from "@/lib/deck/scene";
import { BOM_STEP_LABEL, FIXTURE_RATE, type BomStep } from "@/lib/deck/takeoff";
import { STORE_SURVEY, storePrice } from "@/lib/deck/storePrices";
import { DECK_RATES, DECK_RATE_GROUP_LABEL, deckRate, sanitizeDeckRateBook, type DeckRateBook, type DeckRateGroup } from "@/lib/deck/rates";
import { convertDeckEstimateToProposal, updateDeckProposal, deleteDeckDraft, listDeckDrafts, loadDeckDraft, readDeckSite, saveDeckDraft, saveDeckRateBook, type DeckDraftRow, type ReturnedClientDesign } from "@/actions/deckEstimator";
import { deckClientInbox } from "@/actions/deckClientDesign";
import { jobLine, type ClientLinkRow } from "@/lib/deck/clientDesign";
import { HOUSE_LIMITS, HOUSE_MATERIALS, HOUSE_MATERIAL_LABEL, HOUSE_PITCH_LIMITS, HOUSE_ROOF_LABEL, HOUSE_ROOFS, roofPitch, QUICK_WALLS, QUICK_WALL_LABEL, ROOF_COLOURS, SIDINGS, isHouseHex, levelUnderDeck, wallDeckWords, houseForShape, houseNotes, houseWords, nextJogId, quickWall, quickWallOf, stepWords, wallWords, type HouseDesign, type HouseJog, type HouseMaterial, type HouseRoof, wallHighlight, type WallFocus } from "@/lib/deck/house";
import { DECK_LOCK_WORDS, PROPOSAL_STATUS_WORDS, type LinkedDeckProposal } from "@/lib/deck/proposalEdit";
import type { DeckSample } from "@/lib/deck/samples";
import { reportPlanLimitResult } from "@/stores/usePlanLimitStore";
import { autoFixDesign, autoFixable, settleDesign } from "@/lib/deck/settle";
import type { DeckEdit, DeckLook, DeckPick, SceneHighlight } from "@/components/estimator/deck/DeckModel3D";
import { KINDS_FOR, patchDesign, patchRoof, switchStructure } from "@/lib/deck/edit";
import type { Flash } from "@/lib/deck/voice/run";
import type { DeckVoiceHost } from "@/components/v3/deck-voice/deck-voice";
import { fieldLight, type FieldFocus } from "@/lib/deck/fieldParts";
import { HouseWallPlan } from "@/components/v3/deck-estimator-blueprint/house-wall-plan";
import { DeckKindPicker } from "@/components/v3/deck-estimator-blueprint/deck-kind-picker";
import { DeckPlan, type PlanEdgeHit, nearestStairEdge } from "@/components/v3/deck-estimator-blueprint/deck-plan";
import { Answers, CUSTOM, CUSTOM_LABEL, CustomBox, Field, FieldScope, More, NameInput, NumberInput, Scope, Seg, Stepper, Toggle, ago, cx, feetText, intText, money, parseFeet, parseInches, priceShow, priceText, type FieldScopeValue } from "./deck-v1-parts";
import { DeckV1Send, type SendPrefill } from "./deck-v1-send";
import { DeckAddonDialog, DeckPreviewBanner } from "@/components/v3/deck-addon/deck-addon";
import type { AddonInterval } from "@/lib/deckAddon";
import { PHOTO_ENABLED, PhotoFileInput, PhotoSection, PhotoTools, PhotoViewBox, PhotoWhere, useDeckPhoto, type V1View } from "./deck-v1-photo";
import { HousePhotoCard, HousePhotoReview, useHousePhoto } from "./deck-v1-house-photo";
import "./deck-variant-1.css";
// The Talk button and the panel's styles load with the studio (the panel itself loads when first opened).
import "@/components/v3/deck-voice/deck-voice.css";

const DeckModel3D = dynamic(() => import("@/components/estimator/deck/DeckModel3D").then((m) => m.DeckModel3D), {
  ssr: false,
  loading: () => <div className="v1-view-wait">Setting up the 3D view…</div>,
});
/** The 3D re-renders only when what it shows changes (its callbacks are stable, below), not on every render of the studio. */
const DeckModel3DView = React.memo(DeckModel3D);
/** Talk to Deck Studio (components/v3/deck-voice): loaded the first time the panel opens. */
const DeckVoice = dynamic(() => import("@/components/v3/deck-voice/deck-voice").then((m) => m.DeckVoice), { ssr: false, loading: () => null });

/* THE HOVER LIGHT, OUTSIDE THE STUDIO'S STATE (2026-10-19, perf). The field under the pointer lights its part in 3D.
   As studio state, every field the mouse crossed re-rendered the whole studio — 60–150ms a hover, the "lag" of moving
   the mouse down the form. The light is a small store now; Lit3D, the 3D's own wrapper, is the one thing that
   subscribes, so a hover re-renders the 3D and nothing else. */
interface HoverStore { get: () => FieldFocus | null; set: (f: FieldFocus | null) => void; subscribe: (s: () => void) => () => void }
function hoverStore(): HoverStore {
  let value: FieldFocus | null = null;
  const subs = new Set<() => void>();
  return {
    get: () => value,
    set: (f) => {
      value = f;
      subs.forEach((s) => s());
    },
    subscribe: (s) => {
      subs.add(s);
      return () => {
        subs.delete(s);
      };
    },
  };
}
const nothingLit = () => null;
type Model3DProps = React.ComponentProps<typeof DeckModel3DView>;
/** The 3D with its highlight: the wall being drawn, else the focused field, else the field under the pointer. */
const Lit3D = React.memo(function Lit3D({ hover, structure, focusLit, wallLit, voiceLit, ...rest }: Omit<Model3DProps, "highlight"> & { hover: HoverStore; structure: Parameters<typeof fieldLight>[1]; focusLit: SceneHighlight | null; wallLit: SceneHighlight | null; voiceLit: SceneHighlight | null }) {
  const hovered = React.useSyncExternalStore(hover.subscribe, hover.get, nothingLit);
  const hoverLit = React.useMemo<SceneHighlight | null>(() => (hovered ? fieldLight(rest.scene, structure, hovered) : null), [hovered, rest.scene, structure]);
  return <DeckModel3DView {...rest} highlight={wallLit ?? focusLit ?? voiceLit ?? hoverLit} />;
});

/** A field of the form by its label: a stepper or a group of answers by its name, a labelled box by its words. */
function findField(scope: ParentNode, label: string): HTMLElement | null {
  const named = Array.from(scope.querySelectorAll<HTMLElement>("[aria-label]")).find((el) => el.getAttribute("aria-label") === label);
  if (named) return named.closest<HTMLElement>(".v1-stepper, .v1-field") ?? named;
  for (const span of Array.from(scope.querySelectorAll<HTMLElement>(".v1-lbl > span:first-child"))) if (span.textContent?.trim() === label) return span.closest<HTMLElement>(".v1-field, .v1-stepper") ?? span;
  return null;
}
/** The hover tag shows a part's legend: the same legend under the pointer is the same tag (no re-render per pointer move). */
const sameLegend = (a: SceneLegend | null | undefined, b: SceneLegend | null | undefined) => a === b || (!!a && !!b && a.role === b.role && a.nominal === b.nominal && a.lengthFt === b.lengthFt && a.note === b.note);

/* ── Copied from deck-studio.tsx: presets and option lists ─────────────────────────────────────────────────────── */
const HEIGHT_PRESETS: ReadonlyArray<{ label: string; inches: number }> = [
  { label: "Near the ground", inches: 14 },
  { label: "Two steps", inches: 24 },
  { label: "First floor", inches: 36 },
  { label: "Walk-out", inches: 96 },
  { label: "Second storey", inches: 120 },
];
const CORNER_LABEL: Record<NotchCorner, string> = { "front-left": "Front left", "front-right": "Front right", "back-left": "Back left", "back-right": "Back right" };
const EAVE_PRESETS: ReadonlyArray<{ label: string; inches: number }> = [
  { label: "8 ft", inches: 96 },
  { label: "9 ft", inches: 108 },
  { label: "10 ft", inches: 120 },
];
const PITCHES = [2, 3, 4, 5, 6, 7, 8, 9, 10, 12];
const OVERHANGS = [0, 6, 12, 16, 18, 24, 30, 36];
const FIXTURE_CHIPS: FixtureKind[] = ["led-strip", "post-cap", "step-light", "string-light", "sconce", "ceiling-light", "chandelier", "fan", "outlet", "heater", "flood"];
const FIXTURE_SHORT: Record<FixtureKind, string> = { "led-strip": "LED strip", "post-cap": "Post caps", "step-light": "Step lights", "string-light": "String lights", sconce: "Sconce", "ceiling-light": "Ceiling light", chandelier: "Chandelier", fan: "Fan", outlet: "Outlet", heater: "Heater", flood: "Security light" };
const TIERS: ReadonlyArray<{ id: "good" | "better" | "best"; name: string; decking: (state: string | null) => string; rail: DeckDesign["rail"]["type"]; words: string }> = [
  { id: "good", name: "Good", decking: (st) => treatedDecking(st), rail: "treated", words: "Treated wood boards and rail" },
  { id: "better", name: "Better", decking: () => "composite-better", rail: "composite", words: "Capped composite boards, composite rail" },
  { id: "best", name: "Best", decking: () => "composite-best", rail: "aluminum", words: "Premium composite, aluminum rail" },
];
const LEVEL_LABEL: Record<DeckCheck["level"], string> = { fail: "Fix", warn: "Check", info: "Note", pass: "Pass" };

type Placing = null | { kind: "stair" } | { kind: "fixture"; id: string };

/* ── The steps ───────────────────────────────────────────────────────────────────────────────────────────────── */
type StepId = "size" | "kind" | "house" | "materials" | "stairs" | "roof" | "extras" | "checks" | "package";
/** Where each code check belongs: its part, as the engine heads it (lib/deck/checks). */
const PART_STEP: Record<string, StepId> = {
  Front: "size",
  "Lower level": "size",
  "Hot tub spot": "size",
  Height: "size",
  Ledger: "house",
  "On the house": "house",
  "Doors and windows": "house",
  "Standing free": "house",
  Site: "house",
  Load: "house",
  Footings: "house",
  Code: "house",
  Joists: "materials",
  Beams: "materials",
  Posts: "materials",
  Decking: "materials",
  Lumber: "materials",
  Trim: "materials",
  "Guard and stairs": "stairs",
  Headers: "roof",
  Rafters: "roof",
  Ridge: "roof",
  "Roof posts": "roof",
  Roof: "roof",
  Roofing: "roof",
  Gutters: "roof",
  Trusses: "roof",
  Walls: "roof",
  Pergola: "roof",
  Electrical: "extras",
};
const stepOfCheck = (c: DeckCheck): StepId | null => {
  const part = c.part.replace(/^Lower level — /, "");
  return PART_STEP[part] ?? PART_STEP[c.part] ?? null;
};

export interface OpenedDesign {
  design: DeckDesign;
  address: string | null;
  title: string;
  draftId: string | null;
  from: "draft" | "proposal";
  proposal?: LinkedDeckProposal | null;
  client?: ReturnedClientDesign | null;
}

const DeckKindPickerView = React.memo(DeckKindPicker);

export function DeckV1Studio({ initialBook, homeState, initialAddress, clientId, clientContact = null, opened = null, preview = false, trialEndsAt = null, addonInterval = "MONTH" }: { initialBook: DeckRateBook; homeState: string | null; initialAddress?: string; clientId?: string; /** The client the page was opened for (the filing cookie's, a client record's): Send to client starts filled. */ clientContact?: SendPrefill | null; adminPreview?: boolean; opened?: OpenedDesign | null; preview?: boolean; trialEndsAt?: string | null; addonInterval?: AddonInterval }) {
  const router = useRouter();
  // THE PREVIEW (owner, 2026-10-19): an account whose plan runs without Deck Studio designs here freely; every save,
  // send and print opens the add-on's dialog instead (components/v3/deck-addon; the server refuses them too —
  // actions/deckEstimator gate). Nothing is saved to the server; the design keeps a copy in this browser.
  const [addonAsk, setAddonAsk] = React.useState<string | null>(null);
  const askAddon = React.useCallback((why: string) => setAddonAsk(why), []);
  const [address, setAddress] = React.useState(initialAddress ?? "");
  const [addressDraft, setAddressDraft] = React.useState(initialAddress ?? "");
  const market: MarketSnapshot = React.useMemo(() => {
    const parsed = parseStateZip(address);
    return parsed.state || parsed.zip ? resolveMarket({ address }) : resolveMarket({ state: homeState });
  }, [address, homeState]);
  const site = React.useMemo(() => siteFromAddress(address, homeState), [address, homeState]);
  const [liveDesign, setDesign] = React.useState<DeckDesign>(() => {
    if (opened) {
      const d0 = normalizeDeckDesign(opened.design, { state: market.state || homeState });
      const h0 = houseForShape(d0.house, d0.shape, { drop: false });
      return h0 === d0.house ? d0 : applyDeckPatch(d0, { house: h0 });
    }
    const d = defaultDeckDesign({ state: market.state || homeState, frostIn: market.frostIn });
    return applyDeckPatch(d, { loadPsf: site.deckLoad, frostIn: site.frostIn, site: { ...d.site, groundSnowPsf: site.groundSnowPsf, termite: site.termite } });
  });
  // A SAVED DECK IN THE PREVIEW (owner, 2026-10-20): it opens to look at and to print, never to change — the studio
  // shows the deck as saved, whatever the controls are asked; a new deck (Start over) designs freely again.
  const [frozen, setFrozen] = React.useState<DeckDesign | null>(() => (preview && opened ? liveDesign : null));
  const design = frozen ?? liveDesign;
  const viewOnly = frozen !== null;
  const [book, setBook] = React.useState<DeckRateBook>(initialBook);
  /** What the contractor chose by hand; a new address does not overwrite those. */
  const touched = React.useRef(new Set<string>());
  /** The design changed since it was opened: the auto-save starts. */
  const dirty = React.useRef(false);

  // SETTLING: a size change re-runs the tables (lib/deck/settle) and applies the member-sizing fixes the checks would
  // offer, so what stands on screen is never a frame the tables refuse. The fixes' labels show under the price.
  const bookRef = React.useRef(book);
  const marketRef = React.useRef(market);
  React.useEffect(() => {
    bookRef.current = book;
    marketRef.current = market;
  }, [book, market]);
  const [autoNotes, setAutoNotes] = React.useState<string[]>([]);
  const settle = React.useCallback((next: DeckDesign): DeckDesign => {
    const settled = settleDesign(next, { rates: bookRef.current, market: marketRef.current });
    // The same notes again keep the same array: no second render of the studio for every size change.
    queueMicrotask(() => setAutoNotes((prev) => (prev.length === settled.fixes.length && prev.every((x, i) => x === settled.fixes[i]) ? prev : settled.fixes)));
    return settled.design;
  }, []);
  // THE HOUSE AND THE DECK AGREE, THE FRAME SETTLES (lib/deck/edit — the one door every change goes through, the
  // voice's too).
  const patch = React.useCallback(
    (p: DeckPatch, keys: string[] = []) => {
      for (const k of keys) touched.current.add(k);
      dirty.current = true;
      setDesign((d) => patchDesign(d, p, settle));
    },
    [settle],
  );
  const setHouse = React.useCallback((p: Partial<HouseDesign>) => patch({ house: p }), [patch]);
  const rp = React.useCallback(
    (p: Partial<RoofDesign>) => {
      dirty.current = true;
      setDesign((d) => patchRoof(d, p, settle));
    },
    [settle],
  );
  const setStairs = React.useCallback((fn: (list: StairDesign[]) => StairDesign[]) => {
    dirty.current = true;
    setDesign((d) => applyDeckPatch(d, { stairs: fn(d.stairs) }));
  }, []);
  const setFixtures = React.useCallback((fn: (list: Fixture[]) => Fixture[]) => {
    dirty.current = true;
    setDesign((d) => applyDeckPatch(d, { electrical: { ...d.electrical, fixtures: fn(d.electrical.fixtures) } }));
  }, []);
  const setOwnItems = React.useCallback((fn: (list: OwnItem[]) => OwnItem[]) => {
    dirty.current = true;
    setDesign((d) => applyDeckPatch(d, { extras: { items: fn(d.extras.items) } }));
  }, []);
  const [ownDraft, setOwnDraft] = React.useState<{ name: string; qty: string; unit: OwnUnit; price: string }>({ name: "", qty: "1", unit: "ea", price: "" });
  const [freshCustom, setFreshCustom] = React.useState<string | null>(null);
  const studioRef = React.useRef<HTMLDivElement>(null);
  const viewerRef = React.useRef<HTMLElement>(null);
  const qScrollRef = React.useRef<HTMLDivElement>(null);
  /** Glides the desktop form to a section on the wheel's own motion; false on a phone, where the page scrolls natively. */
  const glideRef = React.useRef<((section: HTMLElement) => boolean) | null>(null);
  React.useEffect(() => {
    const studio = studioRef.current;
    const shell = studio?.closest<HTMLElement>(".jf-blueprint");
    const main = studio?.closest<HTMLElement>(".main");
    const scroller = qScrollRef.current;
    const header = studio?.querySelector<HTMLElement>(".v1-top");
    const work = studio?.querySelector<HTMLElement>(".v1-work");
    if (!studio || !main || !shell || !scroller || !header || !work) return;
    const desktop = window.matchMedia("(min-width: 769px)");
    let headerRange = 0;
    let baseHeight = 0;
    let appliedScroll = -1;
    let scale = 1;
    let childCount = studio.children.length;
    const fit = () => {
      if (!desktop.matches || appliedScroll === main.scrollTop) return;
      appliedScroll = main.scrollTop;
      studio.style.setProperty("--deck-workspace-height", `${Math.max(0, baseHeight + appliedScroll)}px`);
      studio.style.setProperty("--deck-scroll-space", `${Math.max(0, headerRange - appliedScroll)}px`);
    };
    const measure = () => {
      // A resize or scroll can land after the studio left the page (opening a client's design navigates).
      if (!studio.isConnected || !studio.parentElement) return;
      if (!desktop.matches) {
        studio.style.removeProperty("--deck-workspace-height");
        studio.style.removeProperty("--deck-scroll-space");
        studio.style.removeProperty("--deck-scrollbar-width");
        studio.style.removeProperty("--deck-scene-height");
        return;
      }
      scale = Number.parseFloat(getComputedStyle(shell).zoom) || 1;
      const mainBox = main.getBoundingClientRect();
      const top = studio.getBoundingClientRect().top;
      const bottomSpace = Number.parseFloat(getComputedStyle(studio.parentElement!).paddingBottom) || 0;
      headerRange = Math.max(0, (work.getBoundingClientRect().top - mainBox.top) / scale + main.scrollTop);
      baseHeight = (mainBox.bottom - top) / scale - bottomSpace - main.scrollTop;
      studio.style.setProperty("--deck-scrollbar-width", `${scroller.offsetWidth - scroller.clientWidth}px`);
      appliedScroll = -1;
      fit();
      // Allocate the scene for the fully expanded panel once. Scrolling reveals
      // this fixed surface from the bottom instead of resizing WebGL or its camera.
      const viewBox = studio.querySelector<HTMLElement>(".v1-view-box");
      if (viewBox) {
        const sceneHeight = viewBox.getBoundingClientRect().height / scale + Math.max(0, headerRange - main.scrollTop);
        studio.style.setProperty("--deck-scene-height", `${Math.ceil(sceneHeight)}px`);
      }
    };
    measure();
    const motion = createWheelMotion(
      () => main.scrollTop + scroller.scrollTop,
      (value) => {
        // Both scroll positions first, the variables last (2026-10-18, perf): a scroll write needs a clean layout,
        // so a variable set between the two forced a full layout of the page every frame.
        main.scrollTop = Math.min(headerRange, value);
        scroller.scrollTop = Math.max(0, value - headerRange);
        fit();
      },
      () => Math.max(headerRange, main.scrollTop + scroller.scrollHeight - scroller.clientHeight),
      studio,
    );
    const mobileScroller = main.closest<HTMLElement>(".layout") ?? main;
    const mobileMotion = createWheelMotion(() => mobileScroller.scrollTop, (value) => { mobileScroller.scrollTop = value; }, () => mobileScroller.scrollHeight - mobileScroller.clientHeight, studio);
    const wheelRoot = desktop.matches ? main : mobileScroller;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('.v1-pop, [role="dialog"], textarea, select, [contenteditable="true"], input[type="range"], input[type="number"]')) return;
      // In full view there is no form to scroll: the wheel zooms the scene, and nowhere else moves the page under it.
      if (studio.classList.contains("is-full-view")) {
        if (!target?.closest("canvas")) event.preventDefault();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (desktop.matches) {
        if (childCount !== studio.children.length) { childCount = studio.children.length; measure(); }
        motion.move(wheelPixels(event, main.clientHeight) / scale);
      } else mobileMotion.move(wheelPixels(event, mobileScroller.clientHeight));
    };
    // "Package & price" and the other go-tos (2026-10-19): a native smooth scroll moved the header and the form as two
    // scrollers at once and stuttered; the glide drives the one combined position the wheel does.
    glideRef.current = (section) => {
      if (!desktop.matches) return false;
      if (childCount !== studio.children.length) { childCount = studio.children.length; measure(); }
      motion.glideTo(() => headerRange + Math.max(0, (section.getBoundingClientRect().top - scroller.getBoundingClientRect().top) / scale + scroller.scrollTop));
      return true;
    };
    const onScroll = () => fit();
    const stop = () => { motion.stop(); mobileMotion.stop(); };
    const onKey = (event: KeyboardEvent) => {
      stop();
      if (event.key === "Escape" && desktop.matches) { scroller.scrollTop = 0; main.scrollTop = 0; fit(); }
    };
    const observer = new ResizeObserver(measure);
    observer.observe(main);
    for (const child of Array.from(studio.children)) if (child !== work) observer.observe(child);
    for (const chrome of studio.querySelectorAll(".v1-view-head, .v1-tools")) observer.observe(chrome);
    window.addEventListener("resize", measure);
    wheelRoot.addEventListener("wheel", onWheel, { capture: true, passive: false });
    main.addEventListener("scroll", onScroll, { passive: true });
    wheelRoot.addEventListener("pointerdown", stop, true);
    studio.addEventListener("keydown", onKey);
    return () => {
      stop();
      glideRef.current = null;
      observer.disconnect();
      window.removeEventListener("resize", measure);
      wheelRoot.removeEventListener("wheel", onWheel, true);
      main.removeEventListener("scroll", onScroll);
      wheelRoot.removeEventListener("pointerdown", stop, true);
      studio.removeEventListener("keydown", onKey);
    };
  }, []);
  const [bomOpen, setBomOpen] = React.useState<ReadonlySet<BomStep>>(() => new Set());
  const toggleBom = (step: BomStep) =>
    setBomOpen((prev) => {
      const next = new Set(prev);
      if (next.has(step)) next.delete(step);
      else next.add(step);
      return next;
    });

  const commitAddress = (text: string) => {
    if (viewOnly) return;
    const next = text.trim();
    setAddress(next);
    const parsed = parseStateZip(next);
    const m = parsed.state || parsed.zip ? resolveMarket({ address: next }) : resolveMarket({ state: homeState });
    const st = siteFromAddress(next, homeState);
    const p: DeckPatch = {};
    if (!touched.current.has("frost")) p.frostIn = st.frostIn;
    if (!touched.current.has("load")) p.loadPsf = st.deckLoad;
    if (!touched.current.has("species")) p.framing = { species: defaultFramingSpecies(m.state || homeState) };
    if (!touched.current.has("decking")) p.decking = { product: defaultDecking(m.state || homeState) };
    if (!touched.current.has("railHeight")) p.rail = { heightIn: st.code.guardIn };
    dirty.current = true;
    setDesign((d) => applyDeckPatch(d, { ...p, site: { ...d.site, groundSnowPsf: st.groundSnowPsf, termite: st.termite, state: st.state || null } }));
  };

  /** Switching what is built: a different kind of roof starts from its own defaults; deck ↔ covered deck keeps the roof as set. */
  const setStructure = React.useCallback((next: Structure) => {
    dirty.current = true;
    setDesign((d) => switchStructure(d, next));
  }, []);
  // A SAMPLE TO START FROM (lib/deck/samples), laid over the contractor's own address, site, house and lumber.
  const [applied, setApplied] = React.useState<{ id: string; design: DeckDesign } | null>(null);
  const applySample = React.useCallback((sample: DeckSample) => {
    dirty.current = true;
    let next = applyDeckPatch(design, sample.patch);
    const h2 = houseForShape(next.house, next.shape);
    if (h2 !== next.house) next = applyDeckPatch(next, { house: h2 });
    next = settle(next);
    setDesign(next);
    setApplied({ id: sample.id, design: next });
  }, [design, settle]);

  const pkg = React.useMemo(() => priceDeck(design, { rates: book, market }), [design, book, market]);
  const structure = pkg.structure;
  const frame = pkg.frame;
  const roof = pkg.roof;
  const checks = React.useMemo(() => deckChecks(structure), [structure]);
  const summary = checkSummary(checks);
  const fixableCount = React.useMemo(() => autoFixable(checks), [checks]);
  const [fixReport, setFixReport] = React.useState<{ fixed: string[]; left: string[] } | null>(null);
  const runAutoFix = () => {
    const r = autoFixDesign(design, { rates: book, market });
    if (r.design !== design) {
      dirty.current = true;
      setDesign(r.design);
    }
    setFixReport({ fixed: r.fixes, left: r.left.map((c) => `${c.part}: ${c.text.split(/(?<=\.)\s/)[0]}`) });
  };
  // THE FIELD, SHOWN IN 3D: the field being typed in — or the one under the pointer — lights its part.
  const [wallFocus, setWallFocus] = React.useState<WallFocus | null>(null);
  const [wallHover, setWallHover] = React.useState<WallFocus | null>(null);
  const [fieldFocus, setFieldFocus] = React.useState<FieldFocus | null>(null);
  // The hover light lives outside the studio's state (2026-10-19, perf): see hoverStore.
  const [hover] = React.useState(hoverStore);
  // NOT WHILE SCROLLING (2026-10-18, perf): a still pointer over a scrolling form gets a mouseenter for every field
  // that slides under it, and each one re-rendered the whole studio and redrew the 3D — the lag as the header scrolls
  // away. A hover light is dropped until the page has been still for a moment; a focus light always applies.
  const scrollingUntil = React.useRef(0);
  React.useEffect(() => {
    const onScroll = () => { scrollingUntil.current = performance.now() + 160; };
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => document.removeEventListener("scroll", onScroll, true);
  }, []);
  const rootScope = React.useMemo<FieldScopeValue>(() => {
    const same = (a: FieldFocus | null, b: FieldFocus) => !!a && JSON.stringify(a) === JSON.stringify(b);
    return {
      where: {},
      light: (f, how) => {
        if (how === "focus") setFieldFocus(f);
        else if (performance.now() >= scrollingUntil.current && !same(hover.get(), f)) hover.set(f);
      },
      unlight: (f, how) => {
        if (how === "focus") setFieldFocus((x) => (same(x, f) ? null : x));
        else if (same(hover.get(), f)) hover.set(null);
      },
    };
  }, [hover]);
  const lightsFor = (f: WallFocus) => ({
    on: (how: "focus" | "hover") => (how === "focus" ? setWallFocus(f) : setWallHover(f)),
    off: (how: "focus" | "hover") => (how === "focus" ? setWallFocus((x) => (x && JSON.stringify(x) === JSON.stringify(f) ? null : x)) : setWallHover((x) => (x && JSON.stringify(x) === JSON.stringify(f) ? null : x))),
  });
  // WORKING IN THE SHAPE IS QUIET: the drawing of the wall lights nothing, and a press in it puts out every light.
  const quiet = (e: React.PointerEvent<HTMLElement>) => {
    const a = document.activeElement;
    if (a instanceof HTMLElement && a.matches("input, textarea, select") && !e.currentTarget.contains(a) && !a.closest("[data-deck-wall-full]")) a.blur();
    setFieldFocus(null);
    hover.set(null);
    setWallFocus(null);
    setWallHover(null);
  };
  const scene = React.useMemo(() => deckScene(structure), [structure]);
  // The focused field's light; the hovered field's is computed in Lit3D, from the store.
  const focusLit = React.useMemo<SceneHighlight | null>(() => (fieldFocus ? fieldLight(scene, structure, fieldFocus) : null), [fieldFocus, scene, structure]);
  const wallLit = React.useMemo<SceneHighlight | null>(() => {
    const f = wallFocus ?? wallHover;
    const hs = scene.house;
    if (!f || !hs) return null;
    const heightOf = (x0: number, x1: number) => hs.blocks.find((b) => Math.abs(b[0] - x0) < 0.01 && Math.abs(b[2] - x1) < 0.01)?.[4] ?? hs.heightFt;
    return wallHighlight(design.shape, design.house, f, heightOf);
  }, [wallFocus, wallHover, scene, design.shape, design.house]);
  const wall = wallType(design.wall);
  const withDeck = hasDeck(design);
  const withRoof = hasRoof(design);
  const what = STRUCTURE_LABEL[design.structure];

  /* ── the 3D's build-up, night, connections, picking ── */
  const [view, setView] = React.useState<V1View>("3d");
  /* ── the photo of the house (dormant: PHOTO_ENABLED is false, as in the old studio) ── */
  const ph = useDeckPhoto({ design, patch, scene, view, setView });
  /* ── the house built from its photo (2026-10-23): the wall, its windows and doors ── */
  const hp = useHousePhoto({ design, patch, clientId, onBuilt: () => setView("3d") });
  const openWallLarge = () => {
    setView("wall");
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches) viewerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const buildLayers = React.useMemo(() => sceneBuildLayers(scene), [scene]);
  const LAYERS = buildLayers.length;
  const [built, setBuilt] = React.useState<number>(Number.POSITIVE_INFINITY);
  const [xray, setXray] = React.useState(false);
  const [night, setNight] = React.useState(false);
  const [connections, setConnections] = React.useState(false);
  const [playing, setPlaying] = React.useState(false);
  const [resetToken, setResetToken] = React.useState(0);
  const [hoverPick, setHoverPick] = React.useState<DeckPick | null>(null);
  const [picked, setPicked] = React.useState<{ legend: SceneLegend; point: [number, number, number] } | null>(null);
  const [focus, setFocus] = React.useState<[number, number, number] | [number, number, number, number] | null>(null);
  const [placing, setPlacing] = React.useState<Placing>(null);
  const [editing, setEditing] = React.useState(false);
  // THE PHONE (owner, 2026-10-18: the deck estimator's own handheld design). The structure rides at the top of the
  // screen, compact, while the steps scroll under it, so every change is seen as it is made; "Full view" opens the
  // whole viewer with its tools. FULL VIEW (owner, 2026-10-19: "Full view doesn't do anything") — on every width the
  // viewer then fills the window by itself, the form and the header hidden under it; Exit full view or Escape closes it.
  const [fullView, setFullView] = React.useState(false);
  React.useEffect(() => {
    if (!fullView) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFullView(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullView]);
  // Zoom in flies to the part named below the scene; Zoom out, on the same part, goes back to the whole structure.
  const [zoomedAt, setZoomedAt] = React.useState<string | null>(null);
  // TALK TO DECK STUDIO (2026-10-21; components/v3/deck-voice): the panel over the 3D, the part it lights (a few
  // seconds, under a field being typed in), and the side the camera is asked to look from.
  const [voiceOpen, setVoiceOpen] = React.useState(false);
  const [voiceFocus, setVoiceFocus] = React.useState<FieldFocus | null>(null);
  const [look, setLook] = React.useState<{ token: number; from: DeckLook } | null>(null);
  React.useEffect(() => {
    if (!voiceFocus) return;
    const t = window.setTimeout(() => setVoiceFocus(null), 7000);
    return () => window.clearTimeout(t);
  }, [voiceFocus]);
  const openVoice = (on: boolean) => {
    setVoiceOpen(on);
    // On a phone the talking happens over the full view: the 3D fills the screen above the panel.
    if (on && typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches) setFullView(true);
  };
  const voiceLit = React.useMemo<SceneHighlight | null>(() => (voiceFocus ? fieldLight(scene, structure, voiceFocus) : null), [voiceFocus, scene, structure]);
  const r = design.roof;
  const polygon = r.plan.shape === "hexagon" || r.plan.shape === "octagon" || r.plan.shape === "round";
  /** A handle dragged in the 3D: the design number it stands for takes the dragged value, inside its rails. */
  const onEdit = React.useCallback(
    (e: DeckEdit) => {
      const toHalfFt = (v: number) => Math.round(v * 2) / 2;
      const toIn = (v: number) => Math.round(v);
      switch (e.kind) {
        case "width":
          patch({ shape: { ...design.shape, widthFt: Math.min(DECK_LIMITS.widthFt.max, Math.max(DECK_LIMITS.widthFt.min, toHalfFt(e.value))) } });
          break;
        case "depth":
          patch({ shape: { ...design.shape, depthFt: Math.min(DECK_LIMITS.depthFt.max, Math.max(DECK_LIMITS.depthFt.min, toHalfFt(e.value))) } });
          break;
        case "height":
          patch({ heightIn: Math.min(DECK_LIMITS.heightIn.max, Math.max(DECK_LIMITS.heightIn.min, toIn(e.value))) });
          break;
        case "eave":
          rp({ eaveHeightIn: Math.min(ROOF_LIMITS.eaveHeightIn.max, Math.max(ROOF_LIMITS.eaveHeightIn.min, toIn(e.value))) });
          break;
        case "lower-depth":
          patch({ lower: { depthFt: Math.min(LOWER_LIMITS.depthFt.max, Math.max(LOWER_LIMITS.depthFt.min, toHalfFt(e.value))) } });
          break;
        case "roof-width":
          if (polygon) rp({ plan: { ...design.roof.plan, acrossFt: Math.min(ROOF_LIMITS.acrossFt.max, Math.max(ROOF_LIMITS.acrossFt.min, toHalfFt(e.value))) } });
          else rp({ plan: { ...design.roof.plan, widthFt: Math.min(ROOF_LIMITS.planFt.max, Math.max(ROOF_LIMITS.planFt.min, toHalfFt(e.value))), depthFt: design.roof.plan.shape === "square" ? Math.min(ROOF_LIMITS.planFt.max, Math.max(ROOF_LIMITS.planFt.min, toHalfFt(e.value))) : design.roof.plan.depthFt } });
          break;
        case "roof-depth":
          rp({ plan: { ...design.roof.plan, depthFt: Math.min(ROOF_LIMITS.planFt.max, Math.max(ROOF_LIMITS.planFt.min, toHalfFt(e.value))) } });
          break;
        case "stair":
          setStairs((list) => list.map((st) => (st.id === e.id ? { ...st, atFt: Math.max(st.widthFt / 2, toHalfFt(e.value)) } : st)));
          break;
        case "jog":
          patch({ house: { jogs: design.house.jogs.map((j) => (j.id === e.id ? { ...j, atFt: toHalfFt(e.value) } : j)) } });
          break;
        case "house-left":
          setHouse({ leftFt: Math.min(HOUSE_LIMITS.extendFt.max, Math.max(HOUSE_LIMITS.extendFt.min, -toHalfFt(e.value))) });
          break;
        case "house-right":
          setHouse({ rightFt: Math.min(HOUSE_LIMITS.extendFt.max, Math.max(HOUSE_LIMITS.extendFt.min, toHalfFt(e.value) - design.shape.widthFt)) });
          break;
        case "stair-width": {
          const w2 = Math.min(STAIR_LIMITS.widthFt.max, Math.max(STAIR_LIMITS.widthFt.min, toHalfFt(e.value)));
          setStairs((list) => list.map((st) => (st.id === e.id ? { ...st, widthFt: w2, atFt: Math.max(w2 / 2, Math.round((st.atFt + (w2 - st.widthFt) / 2) * 4) / 4) } : st)));
          break;
        }
        case "pitch": {
          const v = Math.min(ROOF_LIMITS.pitch.max, Math.max(ROOF_LIMITS.pitch.min, Math.round(e.value)));
          rp({ pitch: PITCHES.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a)) });
          break;
        }
      }
    },
    [design, patch, rp, setStairs, setHouse, polygon],
  );
  React.useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const start = performance.now();
    const seconds = LAYERS > 12 ? 10 : 7;
    const step = (now: number) => {
      const t = Math.max(0, Math.min(1, (now - start) / (seconds * 1000)));
      setBuilt(t * LAYERS);
      if (t < 1) raf = requestAnimationFrame(step);
      else setPlaying(false);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, LAYERS]);
  const play = () => {
    let reduced = false;
    try {
      reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      reduced = false;
    }
    setView("3d");
    if (reduced) {
      setBuilt(Number.POSITIVE_INFINITY);
      return;
    }
    setBuilt(0);
    setPlaying(true);
  };
  const sliderValue = Math.min(LAYERS, built);
  const layerNow = sliderValue >= LAYERS ? `Finished ${what.toLowerCase()}` : `Building: ${SCENE_LAYER_LABEL[buildLayers[Math.min(LAYERS - 1, Math.floor(sliderValue))]]}`;

  // The 3D keeps its callbacks in refs, so a fresh function each render is fine.
  const onPick = (pick: DeckPick | null, kind: "hover" | "click") => {
      if (kind === "hover") {
        setHoverPick((prev) => {
          const next = pick?.legend ? pick : null;
          return sameLegend(prev?.legend, next?.legend) ? prev : next;
        });
        return;
      }
      if (placing?.kind === "stair") {
        if (!pick) return;
        const hit = nearestStairEdge(structure, pick.point[0] * 12, pick.point[1] * 12, Number.POSITIVE_INFINITY);
        if (!hit) return;
        setStairs((list) => [...list, { ...defaultStair(`s${list.length + 1}-${Date.now().toString(36).slice(-3)}`, hit.side, hit.atFt), level: hit.level }]);
        setPlacing(null);
        return;
      }
      if (placing?.kind === "fixture") {
        if (!pick) return;
        const id = placing.id;
        setFixtures((list) => list.map((f) => (f.id === id ? { ...f, at: { x: Math.round(pick.point[0] * 12), y: Math.round(pick.point[1] * 12), z: Math.round(pick.point[2] * 12), on: pick.mount } } : f)));
        setPlacing(null);
        return;
      }
      if (pick?.legend) setPicked({ legend: pick.legend, point: pick.point });
      else setPicked(null);
  };
  const pickRef = React.useRef(onPick);
  const editRef = React.useRef(onEdit);
  React.useEffect(() => {
    pickRef.current = onPick;
    editRef.current = onEdit;
  });
  const onPickStable = React.useCallback((pick: DeckPick | null, kind: "hover" | "click") => pickRef.current(pick, kind), []);
  const onEditStable = React.useCallback((e: DeckEdit) => editRef.current(e), []);
  const placeStair = (hit: PlanEdgeHit) => {
    setStairs((list) => [...list, { ...defaultStair(`s${list.length + 1}-${Date.now().toString(36).slice(-3)}`, hit.side, hit.atFt), level: hit.level }]);
    setPlacing(null);
  };

  /* ── drafts: the work saves itself ── */
  const [draftId, setDraftId] = React.useState<string | null>(opened?.draftId ?? null);
  const [draftTitle, setDraftTitle] = React.useState<string>(opened ? (opened.from === "draft" && opened.title === structureWords(opened.design) ? "" : opened.title) : "");
  const [saveState, setSaveState] = React.useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [savedAt, setSavedAt] = React.useState<string | null>(null);
  const [drafts, setDrafts] = React.useState<DeckDraftRow[] | null>(null);
  // PICK UP WHERE YOU LEFT OFF (2026-10-24 — owner, going through the studio: a reload opened a fresh default deck
  // and the work sat under Drafts where nobody looks). Opened plain — no draft, no proposal — the studio offers the
  // draft last worked on, when it is less than two days old: one tap opens it, one dismisses it for this tab.
  const [resume, setResume] = React.useState<DeckDraftRow | null>(null);
  React.useEffect(() => {
    if (opened || preview) return;
    try {
      if (sessionStorage.getItem("jf-deck-resume-off")) return;
    } catch {
      /* no storage: offer it anyway */
    }
    let gone = false;
    void listDeckDrafts().then((res) => {
      if (gone || !res.ok || !res.drafts.length) return;
      const last = [...res.drafts].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
      if (Date.now() - Date.parse(last.updatedAt) < 48 * 3600_000 && !dirty.current) setResume(last);
    });
    return () => {
      gone = true;
    };
    // Once, when the studio opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const dismissResume = () => {
    setResume(null);
    try {
      sessionStorage.setItem("jf-deck-resume-off", "1");
    } catch {
      /* fine */
    }
  };
  const [draftsOpen, setDraftsOpen] = React.useState(false);
  const [linked, setLinked] = React.useState<LinkedDeckProposal | null>(opened?.proposal ?? null);
  const linkedId = linked?.id ?? null;
  // "Changed since the proposal": the design's signature, needed only while a proposal is linked (or opened from one).
  const wantSig = !!linked || opened?.from === "proposal";
  const designSig = React.useMemo(() => (wantSig ? JSON.stringify([design, address]) : ""), [wantSig, design, address]);
  const [proposalSig, setProposalSig] = React.useState<string | null>(() => (opened?.from === "proposal" ? designSig : null));
  const [updated, setUpdated] = React.useState<{ at: string; kept: number; titleKept: boolean; scopeKept: boolean } | null>(null);
  const [confirmAt, setConfirmAt] = React.useState<"top" | "bottom" | null>(null);
  const [actAt, setActAt] = React.useState<"top" | "bottom">("bottom");
  const behind = !!linked && designSig !== proposalSig;
  /** The save's state in words, as the old studio said it (a draft of a saved proposal says so). */
  const saveWords = viewOnly ? "View only — saved deck" : preview ? "Preview — not saved" : saveState === "saving" ? "Saving…" : saveState === "saved" && savedAt ? `${linked ? "Draft saved" : "Saved"} ${ago(savedAt)}` : saveState === "failed" ? "Not saved — will retry" : linked ? `Opened from ${linked.ref}` : "";
  // THE CLIENT'S RETURN: a design a client sent back (their words ride over it), and returns nobody has opened yet.
  const [fromClient, setFromClient] = React.useState<ReturnedClientDesign | null>(opened?.client ?? null);
  const clientToken = fromClient?.token ?? null;
  const [inbox, setInbox] = React.useState<Array<ClientLinkRow & { url: string }>>([]);
  const LATER_KEY = "jf-deck-later";
  const [inboxSeen, setInboxSeen] = React.useState<Set<string>>(() => {
    try {
      return new Set(typeof localStorage === "undefined" ? [] : (JSON.parse(localStorage.getItem(LATER_KEY) ?? "[]") as string[]));
    } catch {
      return new Set();
    }
  });
  const putAside = (l: ClientLinkRow) => {
    const key = `${l.token}:${l.sentAt ?? ""}`;
    setInboxSeen((set) => {
      const next = new Set(set).add(key);
      try {
        localStorage.setItem(LATER_KEY, JSON.stringify([...next].slice(-100)));
      } catch {
        /* no storage */
      }
      return next;
    });
  };
  React.useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const ask = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const res = await deckClientInbox();
        if (alive && res.ok) setInbox(res.unseen);
      } catch {
        /* the next tick asks again */
      }
    };
    const tick = () => {
      timer = setTimeout(() => {
        void ask().finally(tick);
      }, 30000);
    };
    void ask().finally(tick);
    const onShow = () => document.visibilityState === "visible" && void ask();
    document.addEventListener("visibilitychange", onShow);
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, []);
  const inboxNew = inbox.filter((l) => l.token !== clientToken && !inboxSeen.has(`${l.token}:${l.sentAt ?? ""}`));
  const saveNow = React.useCallback(async () => {
    if (preview) {
      // The preview keeps this browser's copy only: the server copy is Deck Studio's.
      try {
        localStorage.setItem("jf-deck-draft", JSON.stringify({ design, address, at: Date.now() }));
      } catch {
        /* nothing else to keep it in */
      }
      return;
    }
    setSaveState("saving");
    try {
      localStorage.setItem("jf-deck-draft", JSON.stringify({ design, address, at: Date.now() }));
    } catch {
      /* the server copy is the one that counts */
    }
    try {
      const res = await saveDeckDraft({ id: draftId, title: draftTitle || null, design, address, proposalId: linkedId, clientToken });
      if (res.ok) {
        setDraftId(res.id);
        setSavedAt(res.updatedAt);
        setSaveState("saved");
      } else setSaveState("failed");
    } catch {
      // No connection: the next change tries again.
      setSaveState("failed");
    }
  }, [design, address, draftId, draftTitle, linkedId, clientToken, preview]);
  React.useEffect(() => {
    if (!dirty.current) return;
    const t = setTimeout(() => void saveNow(), 1500);
    return () => clearTimeout(t);
  }, [saveNow]);
  const refreshDrafts = async () => {
    const res = await listDeckDrafts();
    setDrafts(res.ok ? res.drafts : []);
  };
  const openDraft = async (id: string) => {
    const res = await loadDeckDraft(id);
    if (!res.ok) return;
    dirty.current = false;
    setDesign(res.draft.design);
    if (preview) setFrozen(res.draft.design);
    setDraftId(res.draft.id);
    setDraftTitle(res.draft.title);
    setAddress(res.draft.address ?? "");
    setAddressDraft(res.draft.address ?? "");
    setSavedAt(res.draft.updatedAt);
    setSaveState("saved");
    setLinked(res.proposal);
    setProposalSig(null);
    setUpdated(null);
    setConfirmAt(null);
    setFromClient(res.client);
    if (res.client) setInbox((list) => list.filter((l) => l.token !== res.client?.token));
    setDraftsOpen(false);
    go("size");
  };
  const removeDraft = async (id: string) => {
    await deleteDeckDraft(id);
    if (id === draftId) {
      setDraftId(null);
      setSaveState("idle");
    }
    void refreshDrafts();
  };
  const startFresh = () => {
    dirty.current = false;
    setFrozen(null);
    setDesign(defaultDeckDesign({ state: market.state || homeState, frostIn: market.frostIn }));
    setDraftId(null);
    setDraftTitle("");
    setSaveState("idle");
    setSavedAt(null);
    touched.current.clear();
    setLinked(null);
    setUpdated(null);
    setConfirmAt(null);
    setFromClient(null);
    setDraftsOpen(false);
    go("size");
  };

  /* ── the site: reading the ground ── */
  const [siteBusy, setSiteBusy] = React.useState(false);
  const [siteNote, setSiteNote] = React.useState<string | null>(null);
  const readGround = async () => {
    setSiteBusy(true);
    setSiteNote(null);
    try {
      const res = await readDeckSite(address);
      if (!res.ok) {
        setSiteNote(res.error);
        return;
      }
      const depthIn = Math.round(design.shape.depthFt * 12);
      const drop = Math.round(((res.gradePct / 100) * depthIn) * 2) / 2;
      patch({ site: { ...design.site, slope: { outDropIn: drop, acrossDropIn: 0 } } });
      setSiteNote(`USGS lidar reads the ground falling about ${res.gradePct}% here, toward ${["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"][Math.round(res.downhillDeg / 45) % 8]}. Set as ${drop} in. of fall away from the house across the deck — change it if the yard falls the other way.`);
    } finally {
      setSiteBusy(false);
    }
  };

  /* ── the proposal ── */
  const [busy, setBusy] = React.useState<false | "convert" | "update">(false);
  const [error, setError] = React.useState<string | null>(null);
  const title = `${structureWords(design)} — ${frame ? frame.decking.label : ROOFING_LABEL[design.roof.roofing]}`;
  const proposalPayload = () => ({
    title: title.slice(0, 200),
    scope: deckScope(pkg, address || null).join("\n").slice(0, 6000),
    assumptions: deckNotes(pkg).slice(0, 20).map((n) => n.slice(0, 600)),
    lines: pkg.lines.map((l) => ({ name: l.name.slice(0, 200), description: l.description?.slice(0, 400), quantity: l.quantity, unit: l.unit, materialCost: l.materialCost, laborCost: l.laborCost })),
    address: address || null,
    plan: { design, scene },
    clientToken,
  });
  /** Makes the proposal and opens it; false when it could not (the error shows in the package section). */
  const convert = async (): Promise<boolean> => {
    if (preview) {
      askAddon("Make the proposal with Deck Studio");
      return true;
    }
    setActAt("bottom");
    setBusy("convert");
    setError(null);
    setConfirmAt(null);
    try {
      const res = await convertDeckEstimateToProposal({ ...proposalPayload(), clientId: clientId ?? null });
      if (res.ok) {
        router.push(`/dashboard/manual-blueprint?proposal=${res.id}` as Route);
        return true;
      }
      if (res.code === "PLAN_LIMIT_REACHED") reportPlanLimitResult(res);
      setError(res.error);
    } catch {
      setError("The proposal could not be saved. Check the connection and try again.");
    }
    setBusy(false);
    return false;
  };
  const update = async () => {
    if (!linked) return;
    if (preview) {
      askAddon("Update the proposal with Deck Studio");
      return;
    }
    setBusy("update");
    setError(null);
    setConfirmAt(null);
    const sent = designSig;
    try {
      const res = await updateDeckProposal({ ...proposalPayload(), proposalId: linked.id });
      if (res.ok) {
        setProposalSig(sent);
        setUpdated({ at: new Date().toISOString(), kept: res.kept, titleKept: res.titleKept, scopeKept: res.scopeKept });
      } else {
        if (res.code === "LOCKED") setLinked((l) => (l ? { ...l, lock: res.lock } : l));
        if (res.code === "MISSING") setLinked(null);
        setError(res.error);
      }
    } catch {
      setError("The proposal could not be updated. Check the connection and try again.");
    }
    setBusy(false);
  };
  const askUpdate = (where: "top" | "bottom") => {
    if (preview) {
      askAddon("Update the proposal with Deck Studio");
      return;
    }
    setActAt(where);
    setError(null);
    if (linked?.seen) setConfirmAt(where);
    else void update();
  };
  const updatedWords = updated
    ? [
        updated.kept ? `${updated.kept === 1 ? "The line" : `The ${updated.kept} lines`} you added in the proposal stayed.` : "",
        updated.titleKept ? "Your own title stayed." : "",
        updated.scopeKept ? "Your own scope of work stayed — check it still describes this design." : "",
      ].filter(Boolean).join(" ")
    : "";
  const confirmBox = linked ? (
    <div className="v1-call v1-call-warn v1-confirm" role="alertdialog" aria-label="Update a proposal the client has" data-deck-update-confirm>
      <p>
        <b>The client already has this proposal{linked.status === "VIEWED" ? " and has opened it" : ""}.</b> Updating it changes the price and the 3D on their link.
      </p>
      <div className="v1-row-acts">
        <button type="button" className="v1-btn v1-btn-sm v1-btn-primary" onClick={() => void update()} data-deck-update-yes>
          Update it
        </button>
        <button type="button" className="v1-btn v1-btn-sm" onClick={() => setConfirmAt(null)}>
          Cancel
        </button>
      </div>
    </div>
  ) : null;
  // A saved deck in the preview prints from what was saved (`?draft=` / `?proposal=`), never from the page's copy.
  const savedRef = viewOnly ? (draftId ? `draft=${encodeURIComponent(draftId)}` : linked ? `proposal=${encodeURIComponent(linked.id)}` : null) : null;
  const materialsHref = React.useCallback((forWhom: "yard" | "installer") => {
    if (savedRef) return `/deck-materials?${savedRef}&for=${forWhom}`;
    try {
      const payload = btoa(unescape(encodeURIComponent(JSON.stringify({ design, address, title: draftTitle.trim() || undefined }))));
      return `/deck-materials?d=${encodeURIComponent(payload)}&for=${forWhom}`;
    } catch {
      return null;
    }
  }, [design, address, draftTitle, savedRef]);

  /* ── the shop's prices ── */
  const [drafts2, setDrafts2] = React.useState<Record<string, string>>(() => Object.fromEntries(Object.entries(initialBook).map(([k, v]) => [k, String(v)])));
  const [saving, setSaving] = React.useState<"idle" | "saving" | "saved" | "failed">("idle");
  const draftBook = React.useMemo(() => sanitizeDeckRateBook(Object.fromEntries(Object.entries(drafts2).filter(([, v]) => v.trim() !== "").map(([k, v]) => [k, Number(v)]))), [drafts2]);
  const unsaved = JSON.stringify(draftBook) !== JSON.stringify(book);
  const saveBook = async () => {
    if (preview) {
      askAddon("Save your prices with Deck Studio");
      return;
    }
    setSaving("saving");
    const res = await saveDeckRateBook(draftBook).catch(() => ({ ok: false as const, error: "" }));
    if (res.ok) {
      setBook(res.book);
      setDrafts2(Object.fromEntries(Object.entries(res.book).map(([k, v]) => [k, String(v)])));
      setSaving("saved");
    } else setSaving("failed");
  };

  const exampleShare = Math.round(pkg.exampleShare * 100);
  const bomByStep = React.useMemo(() => {
    const out = new Map<BomStep, typeof pkg.bom>();
    for (const l of pkg.bom) out.set(l.step, [...(out.get(l.step) ?? []), l]);
    return out;
  }, [pkg]);

  // ── PRODUCTS OF THE SHOP'S OWN: every material list ends with Custom (lib/deck/takeoff, lib/deck/pricing).
  const setCustom = (slot: CustomSlot, p: CustomProduct | undefined) => patch({ custom: { [slot]: p } as DeckDesign["custom"] });
  const dropCustom = (slot: CustomSlot) => {
    if (design.custom[slot]) setCustom(slot, undefined);
  };
  const slotPrice = (slot: CustomSlot): number => {
    const ids: Record<CustomSlot, (id: string, step: BomStep) => boolean> = {
      decking: (id, step) => (step === "decking" && id.startsWith("boards-")) || (step === "stairs" && id.startsWith("tread-boards-")),
      fastening: (id) => id === "deck-fasteners",
      fascia: (id) => id === "fascia" || id === "riser-boards",
      roofing: (id) => id === "shingles" || id === "shakes" || id === "metal-panels",
      ceiling: (id) => id === "ceiling",
      roofFascia: (id) => id === "fascia-boards" || id === "fascia-wrap",
      gutters: (id) => id === "gutter",
      walls: (id) => id === "screen-panels" || id === "wall-panels",
      species: () => false,
    };
    const lines = pkg.bom.filter((l) => !l.byClient && ids[slot](l.id, l.step));
    const cost = lines.reduce((a, l) => a + l.cost, 0);
    const per = slot === "roofing" ? (roof?.squares ?? 0) : lines.reduce((a, l) => a + l.rateQty, 0);
    if (lines.length && per > 0) return Math.round((cost / per) * 100) / 100;
    const fallback: Record<CustomSlot, string> = { decking: `deck.${design.decking.product}`, fastening: "fast.screws", fascia: "fascia.wood", roofing: "roof.shingle.arch", ceiling: "trim.ceiling.tg", roofFascia: "trim.fascia.wood", gutters: "gut.k5", walls: "trim.screen", species: "" };
    return fallback[slot] ? deckRate(fallback[slot], book, market).price : 0;
  };
  const slotName = (slot: CustomSlot): string => {
    switch (slot) {
      case "species":
        return FRAMING_SPECIES.find((f) => f.id === design.framing.species)?.label ?? "Framing lumber";
      case "decking":
        return DECKING.find((d) => d.id === design.decking.product)?.label ?? "Deck boards";
      case "fastening":
        return pkg.takeoff.surface?.fastening === "hidden" ? "Hidden clips and screws" : "Deck screws";
      case "fascia":
        return pkg.takeoff.surface?.fascia.kind === "composite" ? "Composite fascia" : "Wood fascia";
      case "roofing":
        return ROOFING_LABEL[r.roofing];
      case "ceiling":
        return CEILING_LABEL[r.ceiling === "none" ? "tongue-groove" : r.ceiling];
      case "roofFascia":
        return FASCIA_FINISH_LABEL[r.fascia.finish];
      case "gutters":
        return GUTTER_LABEL[r.gutters.kind === "none" ? "k5" : r.gutters.kind];
      case "walls":
        return WALL_FILL_LABEL[r.walls.fill === "none" ? "screen" : r.walls.fill].split(",")[0];
    }
  };
  const pickCustom = (slot: CustomSlot) => {
    const surface = pkg.takeoff.surface;
    const make: DeckPatch =
      slot === "fascia" && !surface?.fascia.on
        ? { decking: { fascia: "match" } }
        : slot === "ceiling" && r.ceiling === "none"
          ? { roof: { ceiling: "tongue-groove" } }
          : slot === "roofFascia" && !r.fascia.eave && !r.fascia.rake
            ? { roof: { fascia: { ...r.fascia, eave: true } } }
            : slot === "gutters" && r.gutters.kind === "none"
              ? { roof: { gutters: { ...r.gutters, kind: "k5" } } }
              : slot === "walls" && r.walls.fill === "none"
                ? { roof: { walls: { ...r.walls, fill: "screen" } } }
                : {};
    setFreshCustom(slot);
    patch({ ...make, custom: { [slot]: { name: slotName(slot), price: slotPrice(slot) } } as DeckDesign["custom"] }, slot === "species" || slot === "decking" ? [slot] : []);
  };
  const fixturePrice = (f: Fixture) => deckRate(f.kind === "heater" && f.volts240 ? "elec.heater240" : FIXTURE_RATE[f.kind], book, market).price;
  const setFixtureCustom = (id: string, c: CustomProduct | null) => setFixtures((list) => list.map((x) => (x.id === id ? { ...x, custom: c } : x)));
  const addOwnItem = () => {
    const name = ownDraft.name.replace(/\s+/g, " ").trim();
    if (!name) return;
    const qty = priceText(ownDraft.qty);
    const price = priceText(ownDraft.price);
    const id = `o${Date.now().toString(36).slice(-6)}`;
    setOwnItems((list) => [...list, { id, name, qty: qty !== null && qty > 0 ? qty : 1, unit: ownDraft.unit, price: price !== null && price > 0 ? price : 0 }]);
    setOwnDraft((d) => ({ name: "", qty: "1", unit: d.unit, price: "" }));
  };
  const setOwnItem = (id: string, p: Partial<OwnItem>) => setOwnItems((list) => list.map((it) => (it.id === id ? { ...it, ...p } : it)));
  const speciesOptions = React.useMemo(() => (
    <>
      <optgroup label="Pressure-treated">
        {FRAMING_SPECIES.filter((f) => f.treated).map((f) => (
          <option key={f.id} value={f.id}>{f.label}</option>
        ))}
      </optgroup>
      <optgroup label="Naturally durable, not treated">
        {FRAMING_SPECIES.filter((f) => !f.treated).map((f) => (
          <option key={f.id} value={f.id}>{f.label}</option>
        ))}
      </optgroup>
    </>
  ), []);
  const pickState = market.state || homeState;
  const regional = React.useMemo(() => regionalPicks(pickState), [pickState]);
  const deckingOptions = React.useMemo(() => {
    const boardOption = (d: DeckingProduct, key = d.id) => (
      <option key={key} value={d.id}>{d.label}</option>
    );
    const woodFamily = (fam: DeckingFamily) => fam === "treated" || fam === "softwood" || fam === "hardwood" || fam === "modified";
    return (
    <>
      {regional ? (
        <optgroup label={`Most used in ${regional.name}`}>
          {regional.decking.flatMap((id) => DECKING.filter((d) => d.id === id)).map((d) => boardOption(d, `most-${d.id}`))}
        </optgroup>
      ) : null}
      {/* The makers' lines and the other man-made boards first (2026-10-24 — owner: "there is a lot of wood decking, add Trex, TimberTech and the other popular ones"), the wood after. */}
      {DECKING_BRAND_ORDER.map((b) => (
        <optgroup key={b} label={DECKING_BRAND_LABEL[b]}>
          {DECKING.filter((d) => d.brand === b).map((d) => boardOption(d))}
        </optgroup>
      ))}
      {DECKING_FAMILY_ORDER.filter((fam) => !woodFamily(fam)).map((fam) => (
        <optgroup key={fam} label={fam === "aluminum" ? DECKING_FAMILY_LABEL[fam] : `${DECKING_FAMILY_LABEL[fam]} — any brand`}>
          {DECKING.filter((d) => d.family === fam && !d.brand).map((d) => boardOption(d))}
        </optgroup>
      ))}
      {DECKING_FAMILY_ORDER.filter(woodFamily).map((fam) => (
        <optgroup key={fam} label={DECKING_FAMILY_LABEL[fam]}>
          {DECKING.filter((d) => d.family === fam && !d.brand).map((d) => boardOption(d))}
        </optgroup>
      ))}
    </>
    );
  }, [regional]);
  const roofingOptions = React.useMemo(() => ROOFINGS.filter((x) => x !== "none").map((x) => (
    <option key={x} value={x}>{ROOFING_LABEL[x]}</option>
  )), []);
  const fixtureOptions = React.useMemo(() => FIXTURE_KINDS.map((k) => (
    <option key={k} value={k}>{FIXTURE_LABEL[k]}</option>
  )), []);
  const freshDone = () => setFreshCustom(null);

  const ordered = React.useMemo(() => [...checks].sort((a, b) => ["fail", "warn", "info", "pass"].indexOf(a.level) - ["fail", "warn", "info", "pass"].indexOf(b.level)), [checks]);
  const loud = (c: DeckCheck) => c.level === "fail" || c.level === "warn" || (c.level === "info" && (!!c.fix || !!c.alts?.length));
  const kinds = KINDS_FOR[design.structure];
  const planShapes: RoofPlanShape[] = design.structure === "pergola" ? (withDeck ? ["follows-deck", "square", "rect"] : ["square", "rect"]) : design.structure === "covered-deck" ? ["follows-deck", "square", "rect"] : withDeck ? ["follows-deck", "square", "rect", "hexagon", "octagon", "round"] : ["square", "rect", "hexagon", "octagon", "round"];
  const canAttach = (withDeck ? design.placement !== "detached" : true) && !polygon && r.kind !== "pyramid" && r.kind !== "double-tier" && r.kind !== "gambrel" && r.kind !== "dutch-gable" && r.kind !== "pergola";
  const metalRoof = r.roofing === "metal-panel" || r.roofing === "standing-seam";
  const front = design.shape.kind === "rect" ? design.shape.front : undefined;
  const woodRail = design.rail.type === "treated" || design.rail.type === "cedar";
  const infills = design.rail.type === "cable" ? (["auto", "cable"] as const) : design.rail.type === "glass" ? (["auto", "glass"] as const) : design.rail.type === "aluminum" ? (["auto", "balusters", "cable", "glass", "horizontal"] as const) : woodRail ? (["auto", "balusters", "horizontal"] as const) : (["auto", "balusters", "panel"] as const);
  const placingFixture = placing?.kind === "fixture" ? design.electrical.fixtures.find((f) => f.id === placing.id) : null;

  /* ── The continuous form ── */
  const stepList = React.useMemo(() => {
    const list: Array<{ id: StepId; name: string; question: string }> = [
      { id: "kind", name: "Type", question: "What are you building?" },
      { id: "size", name: "Size & house", question: withDeck ? "Deck size & house placement" : "Size & placement" },
    ];
    if (withDeck && frame) list.push({ id: "materials", name: "Materials", question: "What is it built with?" });
    if (withDeck) list.push({ id: "stairs", name: "Stairs & rails", question: "Stairs and railing" });
    if (withRoof && roof) list.push({ id: "roof", name: design.structure === "pergola" ? "Pergola top" : "Roof", question: design.structure === "pergola" ? "The pergola's top" : "The roof over it" });
    list.push({ id: "extras", name: "Lights & extras", question: "Lights, outlets and extras" });
    list.push({ id: "checks", name: "Code checks", question: "Does it pass the code?" });
    list.push({ id: "package", name: "Package & price", question: "The package and the price" });
    return list;
  }, [withDeck, withRoof, frame, roof, design.structure]);
  /** Where a step's fields sit, by the OLD studio's step names: lib/deck/fieldParts lights the 3D by them ("step-shape"
   *  for the deck's size, "step-roof" for the roof…). A step that holds two of the old ones scopes its parts inside. */
  const scopeOf = (id: StepId): string => {
    switch (id) {
      case "size":
        return withDeck ? "step-shape" : "step-footprint";
      case "kind":
        return "step-structure";
      case "house":
        return "step-site";
      case "materials":
        return "Surface";
      case "stairs":
        return "step-stairs";
      case "roof":
        return "step-roof";
      case "extras":
        return "step-electrical";
      default:
        return id;
    }
  };
  const [sendOpen, setSendOpen] = React.useState(false);
  const [visibleSections, setVisibleSections] = React.useState<Set<StepId>>(() => new Set(["kind"]));
  const go = React.useCallback((to: StepId) => {
    const heading = studioRef.current?.querySelector<HTMLElement>(`[data-deck-section="${to === "house" ? "size" : to}"] h2`);
    if (!heading) return;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    heading.focus({ preventScroll: true });
    const section = heading.closest<HTMLElement>("[data-deck-section]") ?? heading;
    if (!glideRef.current?.(section)) heading.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "start" });
    setPlacing((p) => (p?.kind === "fixture" ? null : p));
  }, [setPlacing]);
  /** Send to client from anywhere in the form (owner, 2026-10-22: "I don't see the option in the Deck Studio to send the
   *  design to the client"): the panel opens at the finish, under the package, and is brought into view. */
  const openSend = () => {
    if (preview) return askAddon("Send the design to your client with Deck Studio");
    setSendOpen(true);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const el = document.querySelector<HTMLElement>("[data-deck-client-link]");
        if (!el) return go("package");
        const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        el.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "start" });
      }),
    );
  };
  // Every section laid out once before the off-screen ones are skipped (deck-variant-1.css `data-sized`), so each is
  // skipped at its own height and the form never grows under the wheel. Again when the sections change.
  const sectionKey = stepList.map((x) => x.id).join(" ");
  React.useEffect(() => {
    const scroller = qScrollRef.current;
    if (!scroller) return;
    scroller.removeAttribute("data-sized");
    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => scroller.setAttribute("data-sized", ""));
    });
    return () => cancelAnimationFrame(raf);
  }, [sectionKey]);
  React.useEffect(() => {
    const scroller = qScrollRef.current;
    if (!scroller) return;
    // The sections in view only switch what is computed for them (the tier prices, the package links), so they are
    // read once the scroll has settled and committed at low priority (2026-10-18, perf): each change re-rendered the
    // whole studio (~110ms) while the header was still scrolling away.
    const pending = new Map<StepId, boolean>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    // …and never while the page is still scrolling: the header's easing runs on for a second after the wheel
    // stops, and a flush in that tail re-rendered the studio several times over one gesture.
    let scrolledAt = 0;
    const onScrolled = () => { scrolledAt = performance.now(); };
    const main = scroller.closest<HTMLElement>(".main");
    scroller.addEventListener("scroll", onScrolled, { passive: true });
    main?.addEventListener("scroll", onScrolled, { passive: true });
    const QUIET = 200;
    const flush = () => {
      timer = null;
      const since = performance.now() - scrolledAt;
      if (since < QUIET) {
        timer = setTimeout(flush, QUIET - since);
        return;
      }
      const changes = new Map(pending);
      pending.clear();
      React.startTransition(() => {
        setVisibleSections((previous) => {
          const next = new Set(previous);
          for (const [id, on] of changes) {
            if (on) next.add(id);
            else next.delete(id);
          }
          return next.size === previous.size && [...next].every((id) => previous.has(id)) ? previous : next;
        });
      });
    };
    // Only the two sections anything is computed for are watched (2026-10-19, perf): every section's coming and going
    // used to flush, and each flush rendered the studio (60–150ms) — several times over one scroll down the form.
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) pending.set((entry.target as HTMLElement).dataset.deckSection as StepId, entry.isIntersecting);
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, QUIET);
    }, { root: window.matchMedia("(min-width: 769px)").matches ? scroller : null });
    scroller.querySelectorAll('[data-deck-section="materials"], [data-deck-section="package"]').forEach((section) => observer.observe(section));
    return () => {
      observer.disconnect();
      scroller.removeEventListener("scroll", onScrolled);
      main?.removeEventListener("scroll", onScrolled);
      if (timer) clearTimeout(timer);
    };
  }, [design.structure]);

  // Group the relevant checks with each form section.
  const loudByStep = React.useMemo(() => {
    const m = new Map<StepId, DeckCheck[]>();
    for (const c of checks) {
      if (c.level !== "fail" && c.level !== "warn") continue;
      const s = stepOfCheck(c);
      if (s) m.set(s, [...(m.get(s) ?? []), c]);
    }
    return m;
  }, [checks]);
  const checksFor = (id: StepId): DeckCheck[] => loudByStep.get(id) ?? [];

  // GOOD / BETTER / BEST: price these only while the Materials section is visible, from a
  // deferred copy of the design, so a change paints first and the three prices follow.
  const onMaterials = visibleSections.has("materials") && withDeck;
  const deferredTierDesign = React.useDeferredValue(onMaterials ? design : null);
  // Arriving on the step prices them at once (no tiles popping in a frame later); a change made there is deferred.
  const tierDesign = onMaterials ? (deferredTierDesign ?? design) : null;
  const railsRequired = structure.rails.required;
  const tierPrices = React.useMemo(() => {
    if (!tierDesign) return null;
    const st = market.state || homeState;
    return TIERS.map((t) => {
      const railT = tierDesign.rail.type === "none" && !railsRequired ? "none" : t.rail;
      const variant = applyDeckPatch(tierDesign, { decking: { product: t.decking(st) }, rail: { type: railT }, custom: { decking: undefined } });
      const p = priceDeck(variant, { rates: book, market });
      return { subtotal: p.subtotal, perSqFt: p.pricePerSqFt };
    });
  }, [tierDesign, book, market, homeState, railsRequired]);
  const tiers =
    onMaterials && tierPrices
      ? TIERS.map((t, i) => {
          const st = market.state || homeState;
          const railT = design.rail.type === "none" && !railsRequired ? "none" : t.rail;
          return { ...t, product: t.decking(st), railT, subtotal: tierPrices[i].subtotal, perSqFt: tierPrices[i].perSqFt, current: !design.custom.decking && design.decking.product === t.decking(st) && design.rail.type === railT };
        })
      : null;

  // Encode export links only while their section is visible in the form.
  const onPackage = visibleSections.has("package");
  const permitHref = React.useMemo(() => {
    if (savedRef) return `/deck-permit?${savedRef}`;
    if (!onPackage) return null;
    try {
      const payload = btoa(unescape(encodeURIComponent(JSON.stringify({ design, address }))));
      return `/deck-permit?d=${encodeURIComponent(payload)}`;
    } catch {
      return null;
    }
  }, [onPackage, design, address, savedRef]);
  /** The permit & build set from the header, at any step (owner, 2026-10-23: "don't see where permits plans") — the
   *  link built when it is asked for, not on every change. */
  const openPermit = () => {
    if (preview && !viewOnly) {
      askAddon("Print the lists and the permit sheet with Deck Studio");
      return;
    }
    let href: string | null = savedRef ? `/deck-permit?${savedRef}` : null;
    if (!href)
      try {
        href = `/deck-permit?d=${encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify({ design, address })))))}`;
      } catch {
        href = null;
      }
    if (href) window.open(href, "_blank", "noopener");
  };
  const yardHref = React.useMemo(() => (onPackage || savedRef ? materialsHref("yard") : null), [onPackage, savedRef, materialsHref]);
  const installerHref = React.useMemo(() => (onPackage || savedRef ? materialsHref("installer") : null), [onPackage, savedRef, materialsHref]);
  /* ── a check row ── */
  const checkRow = (c: DeckCheck) => (
    <li key={c.id} className={cx("v1-check", `is-${c.level}`)} data-check={c.id}>
      <span className="v1-check-level">{LEVEL_LABEL[c.level]}</span>
      <div className="v1-check-body">
        <p className="v1-check-text">
          <b>{c.part}.</b> {c.text}
        </p>
        {c.rule ? <p className="v1-check-rule">{c.rule}</p> : null}
        {c.fix || c.alts?.length ? (
          <div className="v1-row-acts">
            {c.fix ? (
              <button type="button" className="v1-btn v1-btn-sm" onClick={() => patch(c.fix!.patch)} data-check-fix="primary">
                {c.fix.label}
              </button>
            ) : null}
            {(c.alts ?? []).map((a) => (
              <button key={a.label} type="button" className="v1-btn v1-btn-sm v1-btn-quiet" onClick={() => patch(a.patch)} data-check-fix="alt">
                {a.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </li>
  );
  const stepChecks = (id: StepId) => {
    const list = checksFor(id);
    if (!list.length) return null;
    return (
      <section className="v1-step-checks" aria-label="Code checks for this section" data-v1-step-checks={id}>
        <h3 className="v1-h4">
          <AlertTriangle size={16} strokeWidth={2.5} aria-hidden="true" /> Code checks
        </h3>
        <ul className="v1-checks">{list.map(checkRow)}</ul>
      </section>
    );
  };

  /* ── the roof's outline (Size for a gazebo or pergola on its own floor; folded in the Roof step over a deck) ── */
  const outlineBlock = () => (
    <>
      <Field label="Outline" wide>
        <Seg label="Roof outline" value={r.plan.shape} onChange={(sh: RoofPlanShape) => rp({ plan: { ...r.plan, shape: sh } })} options={planShapes.map((sh) => ({ value: sh, label: ROOF_PLAN_LABEL[sh] }))} />
      </Field>
      {r.plan.shape !== "follows-deck" ? (
        <div className="v1-grid2">
          {polygon ? (
            <Stepper label="Across the flats" unit="ft" value={r.plan.acrossFt} step={1} parse={parseFeet} format={feetText} min={ROOF_LIMITS.acrossFt.min} max={ROOF_LIMITS.acrossFt.max} onCommit={(n2) => rp({ plan: { ...r.plan, acrossFt: n2 } })} />
          ) : (
            <>
              <Stepper label={r.plan.shape === "square" ? "Across" : "Along the house"} unit="ft" value={r.plan.widthFt} step={1} parse={parseFeet} format={feetText} min={ROOF_LIMITS.planFt.min} max={ROOF_LIMITS.planFt.max} onCommit={(n2) => rp({ plan: { ...r.plan, widthFt: n2, depthFt: r.plan.shape === "square" ? n2 : r.plan.depthFt } })} />
              {r.plan.shape === "rect" ? (
                <Stepper label="Out from the house" unit="ft" value={r.plan.depthFt} step={1} parse={parseFeet} format={feetText} min={ROOF_LIMITS.planFt.min} max={ROOF_LIMITS.planFt.max} onCommit={(n2) => rp({ plan: { ...r.plan, depthFt: n2 } })} />
              ) : null}
            </>
          )}
          {withDeck ? (
            <Field label="Shift along the house" aside="ft · 0 = centred">
              <NumberInput label="Shift along the house, feet" value={r.plan.offsetFt} parse={(t) => (t.trim() === "" ? null : Number(t))} format={(n2) => String(Math.round(n2 * 10) / 10)} min={ROOF_LIMITS.offsetFt.min} max={ROOF_LIMITS.offsetFt.max} onCommit={(n2) => rp({ plan: { ...r.plan, offsetFt: n2 } })} />
            </Field>
          ) : null}
        </div>
      ) : null}
      {roof ? (
        <p className="v1-hint">
          {Math.round(roof.footprintSqFt)} sq ft under the eaves · {roof.posts.length} posts{roof.attach === "wall" ? " and the house wall" : ""}
          {roof.kind !== "pergola" ? ` · ${Math.round(roof.roofAreaSqFt)} sq ft of roof, ${roof.squares} squares` : ""}
          {roof.engineered ? " · engineered beam where the sawn tables stop" : ""}
        </p>
      ) : null}
    </>
  );

  /* ── the steps' contents ── */
  const sizeStep = () => withDeck ? (
    <>
      <div className="v1-size-group" role="group" aria-label="Deck footprint">
        <Answers
          label="Shape"
          value={design.shape.kind}
          onChange={(k) => {
            if (k === design.shape.kind || k === "wall") return;
            // A rectangle asked for while the deck follows the wall: the wall under it goes straight, and the deck with it.
            if (k === "rect" && design.shape.kind === "wall") return patch({ house: levelUnderDeck(design.house, design.shape) });
            patch({ shape: k === "rect" ? { kind: "rect", widthFt: design.shape.widthFt, depthFt: design.shape.depthFt } : { kind: "L", widthFt: design.shape.widthFt, depthFt: design.shape.depthFt, notch: { corner: "front-right", widthFt: Math.max(2, Math.round(design.shape.widthFt / 2)), depthFt: Math.max(2, Math.round(design.shape.depthFt / 2)) } } });
          }}
          options={[
            { value: "rect", label: "Rectangle", sub: "Four straight sides" },
            { value: "L", label: "L-shaped", sub: "One corner cut away" },
            ...(design.shape.kind === "wall" ? [{ value: "wall" as const, label: "Follows the wall", sub: "Its back steps with the house" }] : []),
          ]}
        />
        <div className="v1-grid2">
          <Stepper label="Along the house" unit="ft" value={design.shape.widthFt} step={1} parse={parseFeet} format={feetText} min={DECK_LIMITS.widthFt.min} max={DECK_LIMITS.widthFt.max} onCommit={(n2) => patch({ shape: { ...design.shape, widthFt: n2 } })} />
          <Stepper label="Out from the house" unit="ft" value={design.shape.depthFt} step={1} parse={parseFeet} format={feetText} min={DECK_LIMITS.depthFt.min} max={DECK_LIMITS.depthFt.max} onCommit={(n2) => patch({ shape: { ...design.shape, depthFt: n2 } })} />
        </div>
        <p className="v1-readout">
          <b>{Math.round(pkg.areaSqFt)}</b> sq ft of deck
        </p>
        {design.shape.kind === "L" ? (
          <div className="v1-sub">
            <Field label="Corner cut away" wide>
              <Seg label="Corner cut away" value={design.shape.notch.corner} onChange={(c) => design.shape.kind === "L" && patch({ shape: { ...design.shape, notch: { ...design.shape.notch, corner: c } } })} options={NOTCH_CORNERS.map((c) => ({ value: c, label: CORNER_LABEL[c] }))} />
            </Field>
            <div className="v1-grid2">
              <Field label="Cut along the house" aside="ft">
                <NumberInput label="Corner cut along the house, feet" value={design.shape.notch.widthFt} parse={parseFeet} format={feetText} min={2} max={design.shape.widthFt - 3} onCommit={(n2) => design.shape.kind === "L" && patch({ shape: { ...design.shape, notch: { ...design.shape.notch, widthFt: n2 } } })} />
              </Field>
              <Field label="Cut out from the house" aside="ft">
                <NumberInput label="Corner cut out from the house, feet" value={design.shape.notch.depthFt} parse={parseFeet} format={feetText} min={2} max={design.shape.depthFt - 3} onCommit={(n2) => design.shape.kind === "L" && patch({ shape: { ...design.shape, notch: { ...design.shape.notch, depthFt: n2 } } })} />
              </Field>
            </div>
            <p className="v1-hint">A back corner is where the house steps out into the deck — a bump-out or a bay.</p>
          </div>
        ) : design.shape.kind === "wall" ? (
          <div className="v1-sub" data-deck-follows-wall>
            <p className="v1-hint">
              <b>The back follows the house wall</b> — {wallDeckWords(design.shape)}. It reaches into a set-back, its ledger on that wall, and steps around a bump-out. Move the wall in the drawing and the deck follows.
            </p>
            <button type="button" className="v1-btn v1-btn-sm" onClick={() => patch({ house: levelUnderDeck(design.house, design.shape) })} data-deck-straighten-wall>
              Straighten the wall under the deck
            </button>
          </div>
        ) : null}
      </div>
      <div className="v1-size-group v1-size-height" role="group" aria-labelledby="v1-height-title">
        <h3 className="v1-h3" id="v1-height-title">How high off the ground?</h3>
        <Answers label="Deck height" cols={2} value={HEIGHT_PRESETS.some((h) => h.inches === design.heightIn) ? design.heightIn : -1} onChange={(v) => patch({ heightIn: v })} options={HEIGHT_PRESETS.map((h) => ({ value: h.inches, label: h.label, sub: ftIn(h.inches) }))} />
        <Stepper label="Deck height" unit="in." aside={ftIn(design.heightIn)} value={design.heightIn} step={1} parse={parseInches} format={(n2) => String(Math.round(n2 * 4) / 4)} min={DECK_LIMITS.heightIn.min} max={DECK_LIMITS.heightIn.max} onCommit={(n2) => patch({ heightIn: n2 })} />
      </div>
      {design.shape.kind === "rect" || design.shape.kind === "wall" ? (
        <More title={design.shape.kind === "wall" ? "Lower level, hot tub" : "Front edge, lower level, hot tub"} now={[front ? FRONT_LABEL[front.kind] : "", design.lower.on ? "lower level" : "", design.spa.on ? "hot tub" : ""].filter(Boolean).join(" · ") || "Straight front, one level"} open={!!front || design.lower.on || design.spa.on} id="size-more">
          {design.shape.kind === "rect" ? (
          <Field label="The front edge" wide>
            <Seg label="The front edge" value={front?.kind ?? "straight"} onChange={(k: FrontKind) => patch({ shape: { kind: "rect", widthFt: design.shape.widthFt, depthFt: design.shape.depthFt, front: k === "straight" ? undefined : { kind: k, bulgeFt: front?.bulgeFt ?? 2, clipFt: front?.clipFt ?? 2 } } })} options={(["straight", "curve", "clipped"] as const).map((k) => ({ value: k, label: FRONT_LABEL[k] }))} />
          </Field>
          ) : null}
          {front?.kind === "curve" ? (
            <Field label="The bow at the middle" aside="ft · laminated rim" wide>
              <NumberInput label="How far the front bows out at the middle, feet" value={front.bulgeFt} parse={parseFeet} format={feetText} min={DECK_LIMITS.bulgeFt.min} max={Math.min(DECK_LIMITS.bulgeFt.max, design.shape.widthFt / 3)} onCommit={(n2) => patch({ shape: { kind: "rect", widthFt: design.shape.widthFt, depthFt: design.shape.depthFt, front: { ...front, bulgeFt: n2 } } })} />
            </Field>
          ) : front?.kind === "clipped" ? (
            <Field label="Each corner clipped" aside="ft at 45°" wide>
              <NumberInput label="How much each front corner is clipped, feet" value={front.clipFt} parse={parseFeet} format={feetText} min={DECK_LIMITS.clipFt.min} max={Math.min(DECK_LIMITS.clipFt.max, (design.shape.widthFt - 2) / 2, design.shape.depthFt - 2)} onCommit={(n2) => patch({ shape: { kind: "rect", widthFt: design.shape.widthFt, depthFt: design.shape.depthFt, front: { ...front, clipFt: n2 } } })} />
            </Field>
          ) : null}
          <Toggle checked={design.lower.on} onChange={(v) => patch({ lower: { on: v } })}>A lower level in front, a step down</Toggle>
          {design.lower.on ? (
            <Scope level="lower">
              <div className="v1-grid2">
                <Field label="Along the house" aside="ft">
                  <NumberInput label="Lower level width, feet" value={design.lower.widthFt} parse={parseFeet} format={feetText} min={LOWER_LIMITS.widthFt.min} max={design.shape.widthFt} onCommit={(n2) => patch({ lower: { widthFt: n2 } })} />
                </Field>
                <Field label="Out from the deck" aside="ft">
                  <NumberInput label="Lower level depth, feet" value={design.lower.depthFt} parse={parseFeet} format={feetText} min={LOWER_LIMITS.depthFt.min} max={LOWER_LIMITS.depthFt.max} onCommit={(n2) => patch({ lower: { depthFt: n2 } })} />
                </Field>
                <Field label="Step down" aside={`in. · ${ftIn(design.lower.dropIn)}`}>
                  <NumberInput label="How far down the lower level sits, inches" value={design.lower.dropIn} parse={parseInches} format={(v) => String(Math.round(v * 4) / 4)} min={LOWER_LIMITS.dropIn.min} max={Math.max(LOWER_LIMITS.dropIn.min, design.heightIn - 4)} onCommit={(n2) => patch({ lower: { dropIn: n2 } })} />
                </Field>
                <Field label="Set">
                  <Seg label="Where the lower level sits" value={design.lower.align} onChange={(a) => patch({ lower: { align: a } })} options={[{ value: "left", label: "Left" }, { value: "centre", label: "Centre" }, { value: "right", label: "Right" }]} />
                </Field>
              </div>
              <p className="v1-hint">One riser (up to 7¾ in.) is a step the lower deck makes; more wants a stair between the levels — the checks offer one.</p>
            </Scope>
          ) : null}
          <Toggle checked={design.spa.on} onChange={(v) => patch({ spa: { on: v } })}>A hot-tub spot — the frame under it doubled</Toggle>
          {design.spa.on ? (
            <>
              <div className="v1-grid2">
                <Field label="Tub, along the house" aside="ft">
                  <NumberInput label="Hot tub width, feet" value={design.spa.widthFt} parse={parseFeet} format={feetText} min={SPA_LIMITS.widthFt.min} max={Math.min(SPA_LIMITS.widthFt.max, design.shape.widthFt - 1)} onCommit={(n2) => patch({ spa: { widthFt: n2 } })} />
                </Field>
                <Field label="Tub, out from the house" aside="ft">
                  <NumberInput label="Hot tub depth, feet" value={design.spa.depthFt} parse={parseFeet} format={feetText} min={SPA_LIMITS.depthFt.min} max={Math.min(SPA_LIMITS.depthFt.max, design.shape.depthFt - 1)} onCommit={(n2) => patch({ spa: { depthFt: n2 } })} />
                </Field>
                <Field label="Set" wide>
                  <Seg label="Where the tub stands" value={design.spa.align} onChange={(a) => patch({ spa: { align: a } })} options={[{ value: "left", label: "Left" }, { value: "centre", label: "Centre" }, { value: "right", label: "Right" }]} />
                </Field>
              </div>
              <p className="v1-hint">Every joist under the tub is doubled and the checks read the frame at the filled weight (≈100 psf). The tub is by others.</p>
            </>
          ) : null}
        </More>
      ) : null}
    </>
  ) : (
    outlineBlock()
  );

  const kindStep = () => (
    <>
      {/* The pictures are live again (owner, 2026-10-18): they stand up when picked, turn under the mouse and by
          their ↻ on a touch screen, as the old studio's did. Sections off the screen are not rendered at all now
          (content-visibility), so the still images they were swapped for are no longer needed. */}
      <DeckKindPickerView foldSamples structure={design.structure} onPickKind={setStructure} onPickSample={applySample} appliedSampleId={applied && applied.design === design ? applied.id : null} />
      <PhotoWhere ph={ph} design={design} what={what} setView={setView} />
      {design.structure === "gazebo" || design.structure === "pergola" ? (
        <>
          <h3 className="v1-h3">It stands on</h3>
          {/* Labelled "It stands", the field the 3D lights by (lib/deck/fieldParts). */}
          <Answers label="It stands" cols={3} value={design.floor} onChange={(f: Floor) => patch({ floor: f })} options={(["deck", "slab", "ground"] as const).map((f) => ({ value: f, label: FLOOR_LABEL[f] }))} />
        </>
      ) : null}
      {!withDeck ? (
        <p className="v1-hint">
          {design.floor === "slab" ? "A new 4-in. slab a foot wider than the posts goes in the price; the posts sit on anchored bases." : "Each post gets its own poured footing, sized for what it carries."}{" "}
          Its footprint is {sizeWords(design)} —{" "}
          <button type="button" className="v1-link" onClick={() => go("size")}>
            change it in Size
          </button>
          .
        </p>
      ) : null}
    </>
  );

  const groundBlock = () => (
    <>
      {!withDeck ? (
        <div className="v1-grid2">
          <Field label="Footings stand above grade" aside="in.">
            <NumberInput label="Top of the footings above the ground, inches" value={design.footing.aboveGradeIn} parse={intText} format={String} min={DECK_LIMITS.aboveGradeIn.min} max={DECK_LIMITS.aboveGradeIn.max} onCommit={(n2) => patch({ footing: { aboveGradeIn: n2 } })} />
          </Field>
        </div>
      ) : (
        <Field label="Footings" wide>
          <Seg label="Footings" value={design.footing.type} onChange={(v) => patch({ footing: { type: v } })} options={[{ value: "poured", label: "Poured concrete" }, { value: "pier-block", label: "Precast pier blocks" }]} />
        </Field>
      )}
      <div className="v1-grid2">
        <Field label="Frost depth" aside="in.">
          <NumberInput label="Frost depth, inches" value={design.frostIn} parse={intText} format={String} min={0} max={96} onCommit={(n2) => patch({ frostIn: n2 }, ["frost"])} />
        </Field>
        <Field label="Design load" aside={design.site.groundSnowPsf > 40 ? `snow ${design.site.groundSnowPsf} psf` : "live or snow"}>
          <select className="v1-sel" value={design.loadPsf} onChange={(e) => patch({ loadPsf: Number(e.target.value) as LoadPsf }, ["load"])}>
            {LOADS.map((l) => (
              <option key={l} value={l}>
                {l === 40 ? "40 psf — live load" : `${l} psf ground snow`}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Soil bears">
          <select className="v1-sel" value={design.soilPsf} onChange={(e) => patch({ soilPsf: Number(e.target.value) as SoilPsf })}>
            <option value={1500}>1,500 psf (code default)</option>
            <option value={2000}>2,000 psf</option>
            <option value={3000}>3,000 psf or more</option>
          </select>
        </Field>
      </div>
      <div className="v1-grid2" data-deck-site>
        <Field label="Falls away from the house" aside={`in. over ${design.shape.depthFt} ft`}>
          <NumberInput label="How far the ground falls away from the house across the deck, inches" value={design.site.slope.outDropIn} parse={intText} format={String} min={SLOPE_LIMITS.dropIn.min} max={SLOPE_LIMITS.dropIn.max} onCommit={(n2) => patch({ site: { ...design.site, slope: { ...design.site.slope, outDropIn: n2 } } })} />
        </Field>
        <Field label="Falls left to right" aside={`in. over ${design.shape.widthFt} ft`}>
          <NumberInput label="How far the ground falls left to right across the deck, inches" value={design.site.slope.acrossDropIn} parse={intText} format={String} min={SLOPE_LIMITS.dropIn.min} max={SLOPE_LIMITS.dropIn.max} onCommit={(n2) => patch({ site: { ...design.site, slope: { ...design.site.slope, acrossDropIn: n2 } } })} />
        </Field>
      </div>
      <div className="v1-row-acts">
        <button type="button" className="v1-btn v1-btn-sm" onClick={() => void readGround()} disabled={siteBusy || address.trim().length < 8} data-deck-read-ground>
          {siteBusy ? "Reading the lidar…" : "Read the ground from the address"}
        </button>
        {design.site.slope.outDropIn || design.site.slope.acrossDropIn ? (
          <button type="button" className="v1-btn v1-btn-sm v1-btn-quiet" onClick={() => patch({ site: { ...design.site, slope: { outDropIn: 0, acrossDropIn: 0 } } })}>
            Level
          </button>
        ) : null}
      </div>
      {siteNote ? <p className="v1-hint">{siteNote}</p> : null}
      {(!withDeck && design.floor === "ground" && r.attach !== "wall") || (withDeck && design.placement !== "attached") ? <Toggle checked={design.footing.frostAlways} onChange={(v) => patch({ footing: { frostAlways: v } })}>Dig to the frost line anyway</Toggle> : null}
      <ul className="v1-facts" data-deck-facts>
        <li data-deck-code>{site.codeLine}</li>
        {site.basis.map((b, i) => (
          <li key={i}>{b}</li>
        ))}
        {design.site.termite ? <li>Termite hazard here: {TERMITE_LABEL[design.site.termite]}.</li> : null}
      </ul>
    </>
  );

  const houseBlock = () => scene.house ? (
    <>
      <HousePhotoCard hp={hp} design={design} />
      <Field label="The back wall and the deck, seen from above — drag anything" wide lights={null}>
        <div className="v1-wall-small" onPointerDownCapture={quiet} data-deck-wall-quiet>
          <HouseWallPlan shape={design.shape} house={design.house} onChange={(n2) => patch({ ...(n2.shape ? { shape: n2.shape } : {}), ...(n2.house ? { house: n2.house } : {}) })} onOpenLarge={openWallLarge} />
        </div>
      </Field>
      <p className={houseNotes(design.shape, design.house).length ? "v1-call v1-call-bad" : "v1-hint"} data-deck-wall-words>
        {wallWords(design.shape, design.house)}
      </p>
      <More title="The house and its wall" now={houseWords(design.house)} id="house-more">
        <div className="v1-grid2">
          <Field label="Storeys">
            <Seg label="Storeys" value={String(design.house.storeys)} onChange={(v) => setHouse({ storeys: v === "2" ? 2 : 1 })} options={[{ value: "1", label: "One" }, { value: "2", label: "Two" }]} />
          </Field>
          <Field label="Roof">
            <select className="v1-sel" value={design.house.roof} onChange={(e) => setHouse({ roof: e.target.value as HouseRoof })} data-deck-house-roof>
              {HOUSE_ROOFS.map((x) => (
                <option key={x} value={x}>
                  {HOUSE_ROOF_LABEL[x]}
                </option>
              ))}
            </select>
          </Field>
          {design.house.roof !== "flat" ? (
            <Field label="Roof pitch" aside="in. per ft">
              <NumberInput label="Roof pitch, inches of rise per foot" value={roofPitch(design.house)} parse={(t) => (t.trim() === "" ? null : Number(t.replace(/\/12$/, "")))} format={(n2) => `${n2}/12`} min={HOUSE_PITCH_LIMITS.min} max={HOUSE_PITCH_LIMITS.max} onCommit={(n2) => setHouse({ pitch: n2 })} />
            </Field>
          ) : null}
        </div>
        <Field label="Siding" wide>
          <div className="v1-chips" role="group" aria-label="Siding">
            {isHouseHex(design.house.siding) ? (
              <button type="button" className="v1-chip is-on" aria-pressed="true" data-deck-house-siding="photo">
                <span className="v1-swatch" style={{ background: design.house.siding }} aria-hidden />
                From the photo
              </button>
            ) : null}
            {SIDINGS.map((c) => (
              <button key={c.id} type="button" className={cx("v1-chip", design.house.siding === c.id && "is-on")} aria-pressed={design.house.siding === c.id} onClick={() => setHouse({ siding: c.id })} data-deck-house-siding={c.id}>
                <span className="v1-swatch" style={{ background: c.hex }} aria-hidden />
                {c.label}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Roof colour" wide>
          <div className="v1-chips" role="group" aria-label="Roof colour">
            {isHouseHex(design.house.roofColour) ? (
              <button type="button" className="v1-chip is-on" aria-pressed="true" data-deck-house-roof-colour="photo">
                <span className="v1-swatch" style={{ background: design.house.roofColour }} aria-hidden />
                From the photo
              </button>
            ) : null}
            {ROOF_COLOURS.map((c) => (
              <button key={c.id} type="button" className={cx("v1-chip", design.house.roofColour === c.id && "is-on")} aria-pressed={design.house.roofColour === c.id} onClick={() => setHouse({ roofColour: c.id })} data-deck-house-roof-colour={c.id}>
                <span className="v1-swatch" style={{ background: c.hex }} aria-hidden />
                {c.label}
              </button>
            ))}
          </div>
        </Field>
        <div className="v1-grid2">
          <Field label="The wall is clad in">
            <select className="v1-sel" value={design.house.material ?? "lap"} onChange={(e) => setHouse({ material: e.target.value as HouseMaterial })} data-deck-house-material>
              {HOUSE_MATERIALS.map((m) => (
                <option key={m} value={m}>
                  {HOUSE_MATERIAL_LABEL[m]}
                </option>
              ))}
            </select>
          </Field>
          {design.house.storeys === 2 && design.house.jogs.length ? (
            <Field label="Bump-outs">
              <Seg label="Bump-outs" value={design.house.bumpOuts ?? "low"} onChange={(v: "low" | "full") => setHouse({ bumpOuts: v })} options={[{ value: "low", label: "One storey" }, { value: "full", label: "Full height" }]} />
            </Field>
          ) : null}
        </div>
        {design.house.openings ? (
          <div className="v1-row-acts" data-deck-house-openings>
            <span className="v1-meta">The windows and doors stand where the photo showed them.</span>
            <button type="button" className="v1-btn v1-btn-sm v1-btn-quiet" onClick={() => setHouse({ openings: null })}>
              Draw them by rule instead
            </button>
          </div>
        ) : null}
        <Field label="The wall's shape" wide>
          <div className="v1-chips" role="group" aria-label="The wall's shape">
            {QUICK_WALLS.map((k) => (
              <button key={k} type="button" className={cx("v1-chip", quickWallOf(design.shape, design.house) === k && "is-on")} aria-pressed={quickWallOf(design.shape, design.house) === k} onClick={() => setHouse(quickWall(k, design.shape, design.house))} data-deck-wall-quick={k}>
                {QUICK_WALL_LABEL[k]}
              </button>
            ))}
          </div>
        </Field>
        <div className="v1-grid2">
          <Field label="Wall past the left end" aside="ft" lights={lightsFor({ kind: "left" })}>
            <NumberInput label="Wall past the left end, feet" value={design.house.leftFt} parse={parseFeet} format={feetText} min={HOUSE_LIMITS.extendFt.min} max={HOUSE_LIMITS.extendFt.max} onCommit={(n2) => setHouse({ leftFt: n2 })} />
          </Field>
          <Field label="Wall past the right end" aside="ft" lights={lightsFor({ kind: "right" })}>
            <NumberInput label="Wall past the right end, feet" value={design.house.rightFt} parse={parseFeet} format={feetText} min={HOUSE_LIMITS.extendFt.min} max={HOUSE_LIMITS.extendFt.max} onCommit={(n2) => setHouse({ rightFt: n2 })} />
          </Field>
        </div>
        <div className="v1-rows" data-deck-house-jogs>
          {design.house.jogs.map((j, i) => (
            <div key={j.id} className="v1-item" data-deck-house-jog={j.id}>
              <div className="v1-item-head">
                <span className="v1-item-title">Step {i + 1} — {stepWords(j, design.shape)}</span>
                <button type="button" className="v1-btn v1-btn-sm v1-btn-danger" onClick={() => setHouse({ jogs: design.house.jogs.filter((x) => x.id !== j.id) })} data-deck-house-jog-remove>
                  Remove
                </button>
              </div>
              <div className="v1-grid3">
                <Field label="From the left end" aside="ft" lights={lightsFor({ kind: "step", id: j.id })}>
                  <NumberInput label="Step at, feet from the deck's left end" value={j.atFt} parse={parseFeet} format={feetText} min={-design.house.leftFt + 1} max={design.shape.widthFt + design.house.rightFt - 1} onCommit={(n2) => setHouse({ jogs: design.house.jogs.map((x) => (x.id === j.id ? { ...x, atFt: n2 } : x)) })} />
                </Field>
                <Field label="The wall to its right" lights={lightsFor({ kind: "part", id: j.id })}>
                  <select className="v1-sel" value={j.dir} onChange={(e) => setHouse({ jogs: design.house.jogs.map((x) => (x.id === j.id ? { ...x, dir: e.target.value as HouseJog["dir"] } : x)) })}>
                    <option value="toward">Comes out</option>
                    <option value="away">Steps back</option>
                  </select>
                </Field>
                <Field label="By" aside="ft" lights={lightsFor({ kind: "part", id: j.id })}>
                  <NumberInput label="By, feet" value={j.depthFt} parse={parseFeet} format={feetText} min={HOUSE_LIMITS.depthFt.min} max={HOUSE_LIMITS.depthFt.max} onCommit={(n2) => setHouse({ jogs: design.house.jogs.map((x) => (x.id === j.id ? { ...x, depthFt: n2 } : x)) })} />
                </Field>
              </div>
            </div>
          ))}
        </div>
        <div className="v1-row-acts">
          <button type="button" className="v1-btn v1-btn-sm" disabled={design.house.jogs.length >= HOUSE_LIMITS.jogs} onClick={() => setHouse({ jogs: [...design.house.jogs, { id: nextJogId(design.house.jogs), atFt: Math.max(2, design.shape.widthFt - 4), dir: "toward", depthFt: 3 }] })} data-deck-house-add-jog>
            <Plus size={15} strokeWidth={2.5} aria-hidden="true" /> Add a step in the wall
          </button>
        </div>
      </More>
    </>
  ) : null;

  const houseStep = () => (
    <>
      {withDeck ? (
        <>
          <Answers label="How it meets the house" cols={1} value={design.placement} onChange={(p: Placement) => patch({ placement: p })} options={(["attached", "beside", "detached"] as const).map((p) => ({ value: p, label: PLACEMENT_LABEL[p].split(" — ")[0], sub: PLACEMENT_LABEL[p].split(" — ")[1] }))} />
          {design.placement !== "detached" ? (
            <Field label="The house wall there" wide>
              <select className="v1-sel" value={design.wall} onChange={(e) => patch({ wall: e.target.value as DeckDesign["wall"] })}>
                {WALL_TYPES.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.label}
                    {w.ledger ? "" : " — no ledger"}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          {design.placement !== "detached" && !wall.ledger ? <p className="v1-call v1-call-warn">{wall.why}</p> : null}
        </>
      ) : null}
      {scene.house ? <Scope step="step-house">{houseBlock()}</Scope> : null}
      {withDeck ? (
        <More title="The ground, the footings and the code" now={`${design.footing.type === "poured" ? "Poured footings" : "Pier blocks"} · frost ${design.frostIn} in. · ${design.loadPsf} psf${structure.gradePct >= 2 ? ` · ${structure.gradePct}% fall` : ""}`} id="ground-more">
          {groundBlock()}
        </More>
      ) : (
        groundBlock()
      )}
      <PhotoSection ph={ph} design={design} what={what} setView={setView} />
    </>
  );

  const materialsStep = () =>
    withDeck && frame && pkg.takeoff.surface ? (
      <>
        {/* The fields light the 3D by the old studio's step names — "Surface" for the boards, "Frame" for the framing
            (lib/deck/fieldParts reads them). */}
        <Scope step="Surface">
        {tiers ? (
          <div className="v1-answers v1-answers-1" role="radiogroup" aria-label="Boards and railing" data-deck-tiers>
            {tiers.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={t.current}
                className={cx("v1-answer", "v1-tier", t.current && "is-on")}
                onClick={() => patch({ decking: { product: t.product }, rail: { type: t.railT }, custom: { decking: undefined } }, ["decking"])}
              >
                <span className="v1-answer-text">
                  <span className="v1-answer-name">{t.name}</span>
                  <span className="v1-answer-sub">{t.words}</span>
                </span>
                <span className="v1-tier-price">
                  <b>{money(t.subtotal)}</b>
                  <span>{money(t.perSqFt, true)} / sq ft</span>
                </span>
                <span className="v1-answer-tick" aria-hidden="true">{t.current ? <Check size={14} strokeWidth={3} /> : null}</span>
              </button>
            ))}
          </div>
        ) : null}
        <Field label="Deck boards" wide>
          <select className="v1-sel" value={design.custom.decking ? CUSTOM : design.decking.product} onChange={(e) => (e.target.value === CUSTOM ? pickCustom("decking") : patch({ decking: { product: e.target.value }, custom: { decking: undefined } }, ["decking"]))} data-deck-pick="decking">
            {deckingOptions}
            <option value={CUSTOM}>{CUSTOM_LABEL}</option>
          </select>
        </Field>
        {design.custom.decking ? (
          <CustomBox slot="decking" title="Deck boards" product={design.custom.decking} unit="ft of board" fresh={freshCustom === "decking"} onDone={freshDone} onChange={(p) => setCustom("decking", p)} onBack={() => setCustom("decking", undefined)} note="Priced at your number per foot of board, the stair treads too. The joist spacing, the gaps and the clips follow the board it is laid like.">
            <Field label="Laid like" wide>
              <select className="v1-sel" value={design.decking.product} onChange={(e) => patch({ decking: { product: e.target.value } }, ["decking"])} data-deck-like="decking">
                {deckingOptions}
              </select>
            </Field>
          </CustomBox>
        ) : null}
        {regional ? (
          <p className="v1-hint" data-deck-regional={regional.region}>
            {regionalWords(regional)}
          </p>
        ) : null}
        </Scope>
        <Scope step="Frame">
        <Field label="Framing lumber" wide>
          <select className="v1-sel" value={design.custom.species ? CUSTOM : design.framing.species} onChange={(e) => (e.target.value === CUSTOM ? pickCustom("species") : patch({ framing: { species: e.target.value as DeckDesign["framing"]["species"] }, custom: { species: undefined } }, ["species"]))} data-deck-pick="species">
            {speciesOptions}
            <option value={CUSTOM}>{CUSTOM_LABEL}</option>
          </select>
        </Field>
        {design.custom.species ? (
          <CustomBox slot="species" title="Framing lumber" product={design.custom.species} unit={null} fresh={freshCustom === "species"} onDone={freshDone} onChange={(p) => setCustom("species", p)} onBack={() => setCustom("species", undefined)} note={`Named as typed on the plans and the material list. It spans by the code's tables for ${(FRAMING_SPECIES.find((f) => f.id === design.framing.species)?.label ?? "the lumber below").toLowerCase()} and is priced as that.`}>
            <Field label="Spans and prices as" wide>
              <select className="v1-sel" value={design.framing.species} onChange={(e) => patch({ framing: { species: e.target.value as DeckDesign["framing"]["species"] } }, ["species"])} data-deck-like="species">
                {speciesOptions}
              </select>
            </Field>
          </CustomBox>
        ) : (
          <p className="v1-hint">{frame.species.note}</p>
        )}
        </Scope>
        <Scope step="Surface">
        <More title="Pattern, border, fastening, fascia" now={[PATTERN_LABEL[design.decking.pattern], design.decking.border ? `${design.decking.border}-board border` : "", pkg.takeoff.surface.fastening === "hidden" ? "hidden clips" : "screws", `${design.decking.wastePct}% waste`].filter(Boolean).join(" · ")} id="surface-more">
          <Field label="Pattern" wide>
            <Seg label="Pattern" value={design.decking.pattern} onChange={(v) => patch({ decking: { pattern: v, diagonal: v !== "straight" } })} options={(["straight", "diagonal", "herringbone"] as const).map((v) => ({ value: v, label: PATTERN_LABEL[v] }))} />
          </Field>
          <Field label="Picture-frame border" wide>
            <Seg label="Picture-frame border" value={design.decking.border} onChange={(v) => patch({ decking: { border: v } })} options={[{ value: 0, label: "None" }, { value: 1, label: "One board" }, { value: 2, label: "Two boards" }]} />
          </Field>
          <div className="v1-grid2">
            <Field label="Fastened with">
              <select className="v1-sel" value={design.custom.fastening ? CUSTOM : design.decking.fastening} onChange={(e) => (e.target.value === CUSTOM ? pickCustom("fastening") : patch({ decking: { fastening: e.target.value as DeckDesign["decking"]["fastening"] }, custom: { fastening: undefined } }))} data-deck-pick="fastening">
                <option value="auto">Auto — {pkg.takeoff.surface.fastening === "hidden" ? "hidden clips" : "screws"}</option>
                <option value="screws">Deck screws</option>
                {frame.decking.hiddenFasteners ? <option value="hidden">Hidden clips</option> : null}
                <option value={CUSTOM}>{CUSTOM_LABEL}</option>
              </select>
            </Field>
            <Field label="Fascia">
              <select className="v1-sel" value={design.custom.fascia && pkg.takeoff.surface.fascia.on ? CUSTOM : design.decking.fascia} onChange={(e) => (e.target.value === CUSTOM ? pickCustom("fascia") : patch({ decking: { fascia: e.target.value as DeckDesign["decking"]["fascia"] }, custom: { fascia: undefined } }))} data-deck-pick="fascia">
                <option value="auto">Auto — {pkg.takeoff.surface.fascia.on ? "on" : "none"}</option>
                <option value="match">Fascia on the open edges</option>
                <option value="none">No fascia</option>
                <option value={CUSTOM}>{CUSTOM_LABEL}</option>
              </select>
            </Field>
            <Field label="Waste" aside="%">
              <NumberInput label="Waste allowance on the boards, percent" value={design.decking.wastePct} parse={intText} format={String} min={0} max={30} onCommit={(n2) => patch({ decking: { wastePct: n2 } })} />
            </Field>
          </div>
          {design.custom.fastening ? (
            <CustomBox slot="fastening" title="Fastening" product={design.custom.fastening} unit="sq ft of deck" fresh={freshCustom === "fastening"} onDone={freshDone} onChange={(p) => setCustom("fastening", p)} onBack={() => setCustom("fastening", undefined)} note="Priced per square foot of deck — screws or clips and their bits, all in.">
              {frame.decking.hiddenFasteners ? (
                <Field label="Counted as" wide>
                  <Seg label="Fastening counted as" value={pkg.takeoff.surface.fastening} onChange={(v) => patch({ decking: { fastening: v } })} options={[{ value: "screws", label: "Face screws" }, { value: "hidden", label: "Hidden clips" }]} />
                </Field>
              ) : null}
            </CustomBox>
          ) : null}
          {design.custom.fascia && pkg.takeoff.surface.fascia.on ? (
            <CustomBox slot="fascia" title="Fascia" product={design.custom.fascia} unit="ft" fresh={freshCustom === "fascia"} onDone={freshDone} onChange={(p) => setCustom("fascia", p)} onBack={() => setCustom("fascia", undefined)} note="Priced per foot of fascia board, the stair risers too, bought in 12-ft lengths." />
          ) : null}
          <p className="v1-hint">
            Joists no more than {frame.decking.maxSpacingIn.square} in. apart ({frame.decking.maxSpacingIn.diagonal} in. on the diagonal) — {frame.decking.sourceNote}.
          </p>
        </More>
        </Scope>
        <Scope step="Frame">
        <More title="The frame — the code tables pick it" now={`${frame.joistSize} @ ${frame.spacingIn}" · ${[...new Set(frame.beams.map((b) => b.spec.size))].join(", ")} ${frame.beamStyle === "flush" ? "flush beam" : "beam"} · ${design.framing.post} posts`} id="frame-more">
          <Field label="Joists" aside={design.framing.joist === "auto" ? `picked: ${frame.joistSize}` : undefined} wide>
            <Seg label="Joists" value={design.framing.joist} onChange={(v) => patch({ framing: { joist: v } })} options={[{ value: "auto", label: "Auto" }, ...(["2x6", "2x8", "2x10", "2x12"] as const).map((j) => ({ value: j, label: j }))]} />
          </Field>
          <Field label="Joist spacing" aside={design.framing.spacingIn === "auto" ? `${frame.spacingIn} in. on center` : "on center"} wide>
            <Seg label="Joist spacing" value={design.framing.spacingIn} onChange={(v) => patch({ framing: { spacingIn: v } })} options={[{ value: "auto", label: "Auto" }, { value: 12, label: '12"' }, { value: 16, label: '16"' }, { value: 24, label: '24"' }]} />
          </Field>
          <div className="v1-grid2">
            <Field label="Beam size" aside={design.framing.beam === "auto" ? `picked: ${[...new Set(frame.beams.map((b) => b.spec.size))].join(", ")}` : undefined}>
              <select className="v1-sel" value={design.framing.beam} onChange={(e) => patch({ framing: { beam: e.target.value as DeckDesign["framing"]["beam"] } })}>
                <option value="auto">Auto — least cost</option>
                {(frame.beamKind === "solid" ? SOLID_BEAMS : BUILT_UP_CHOICES).map((b) => (
                  <option key={b} value={b}>{b.includes("-") ? `${b[0]}-ply ${b.slice(2)}` : b}</option>
                ))}
              </select>
            </Field>
            <Field label="Posts">
              <select className="v1-sel" value={design.framing.post} onChange={(e) => patch({ framing: { post: e.target.value as DeckDesign["framing"]["post"] } })}>
                {POST_SIZES.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Beams" aside={design.framing.beamStyle === "auto" ? (frame.beamStyle === "flush" ? "picked: flush" : "picked: under the joists") : undefined} wide>
            <Seg label="Beams" value={design.framing.beamStyle} onChange={(v) => patch({ framing: { beamStyle: v } })} options={[{ value: "auto", label: "Auto" }, { value: "dropped", label: "Under the joists" }, { value: "flush", label: "Flush" }]} />
          </Field>
          <div className="v1-grid2">
            <Field label="Beam made of">
              <select className="v1-sel" value={frame.beamKind} onChange={(e) => patch({ framing: { beamKind: e.target.value as DeckDesign["framing"]["beamKind"], beam: "auto" } })} data-deck-beam-kind={frame.beamKind}>
                <option value="solid" disabled={!solidBeamTabulated(frame.load, frame.group)}>{solidBeamTabulated(frame.load, frame.group) ? "Solid 4x" : "Solid 4x — not in the tables here"}</option>
                <option value="built-up">Built up from 2x</option>
              </select>
            </Field>
            <Field label="Joists past the beam" aside={design.framing.overhangFt === "auto" ? `auto: ${ftIn(frame.zones[0].frontCantIn)}` : "ft"}>
              <select className="v1-sel" value={String(design.framing.overhangFt)} onChange={(e) => patch({ framing: { overhangFt: e.target.value === "auto" ? "auto" : Number(e.target.value) } })}>
                <option value="auto">Auto — up to 2 ft</option>
                {[0, 0.5, 1, 1.5, 2, 2.5, 3].map((v) => (
                  <option key={v} value={v}>{v === 0 ? "None" : feetText(v).replace(/^(\d+)$/, "$1 ft")}</option>
                ))}
              </select>
            </Field>
          </div>
          {frame.beamKindNote ? <p className="v1-call v1-call-warn" data-deck-beam-note>{frame.beamKindNote}</p> : null}
          <div className="v1-toggles">
            <Toggle checked={design.framing.doubleRim} onChange={(v) => patch({ framing: { doubleRim: v } })}>Doubled rim and outside joists</Toggle>
            <Toggle checked={design.framing.joistTape} onChange={(v) => patch({ framing: { joistTape: v } })}>Joist tape on every top</Toggle>
            <Toggle checked={design.framing.braces} onChange={(v) => patch({ framing: { braces: v } })}>Knee braces at corner posts over 2 ft</Toggle>
            <Toggle checked={design.framing.blocking === "mid-span"} onChange={(v) => patch({ framing: { blocking: v ? "mid-span" : "auto" } })}>Mid-span blocking on spans over 8 ft</Toggle>
            {design.heightIn >= 84 ? <Toggle checked={design.extras.underDeckDrain} onChange={(v) => patch({ extras: { underDeckDrain: v } })}>Under-deck drainage — a dry room below</Toggle> : null}
          </div>
          {design.placement === "attached" ? (
            <div className="v1-grid2">
              <Field label="Ledger fastened with">
                <select className="v1-sel" value={design.ledger.fastener} onChange={(e) => patch({ ledger: { fastener: e.target.value as DeckDesign["ledger"]["fastener"] } })}>
                  {wall.fasteners.map((f) => (
                    <option key={f} value={f}>{LEDGER_FASTENER_LABEL[f]}</option>
                  ))}
                </select>
              </Field>
              <Field label="Ties to the house">
                <select className="v1-sel" value={design.ledger.lateral} onChange={(e) => patch({ ledger: { lateral: e.target.value as "two" | "four" } })}>
                  <option value="two">Two 1,500-lb hold-downs</option>
                  <option value="four">Four 750-lb ties</option>
                </select>
              </Field>
            </div>
          ) : null}
        </More>
        </Scope>
      </>
    ) : null;

  const stairsStep = () => withDeck ? (
    <>
      <h3 className="v1-h3">Railing{structure.rails.required && design.rail.type === "none" ? <span className="v1-stamp is-bad">A guard is required</span> : null}</h3>
      <Answers label="Railing" value={design.rail.type} onChange={(v) => patch({ rail: { type: v, infill: "auto" } })} options={RAIL_TYPES.map((rt) => ({ value: rt.id, label: rt.id === "none" ? "No railing" : rt.label.replace(" — your price", "") }))} />
      <Field label="Rail height" wide>
        <Seg
          label="Rail height"
          value={design.rail.heightIn}
          onChange={(v) => {
            touched.current.add("railHeight");
            patch({ rail: { heightIn: v } });
          }}
          options={[{ value: 36, label: "36 in." }, { value: 42, label: "42 in." }]}
        />
      </Field>
      {design.rail.type === "custom" ? (
        <div className="v1-grid2">
          <Field label="Your railing">
            <NameInput label="Your railing's name" value={design.rail.customName} placeholder="Brand, line, colour" allowEmpty onCommit={(name) => patch({ rail: { customName: name } })} />
          </Field>
          <Field label="Price, installed" aside="$/ft">
            <NumberInput label="Custom rail price per foot, installed" value={design.rail.customPerFt} parse={intText} format={String} min={0} max={1000} onCommit={(n2) => patch({ rail: { customPerFt: n2 } })} />
          </Field>
        </div>
      ) : null}
      {design.rail.type !== "none" ? (
        <More title="Infill, posts and cap" now={[RAIL_INFILL_LABEL[structure.rails.infill], `posts ${design.rail.postSpacingFt} ft apart`, woodRail && design.rail.cap ? "drink cap" : ""].filter(Boolean).join(" · ")} id="rail-more">
          <div className="v1-grid2">
            <Field label="Infill" aside={design.rail.infill === "auto" ? `picked: ${RAIL_INFILL_LABEL[structure.rails.infill].toLowerCase()}` : undefined}>
              <select className="v1-sel" value={design.rail.infill} onChange={(e) => patch({ rail: { infill: e.target.value as DeckDesign["rail"]["infill"] } })}>
                {infills.map((v) => (
                  <option key={v} value={v}>{v === "auto" ? "Auto" : RAIL_INFILL_LABEL[v]}</option>
                ))}
              </select>
            </Field>
            <Field label="Posts apart" aside="ft">
              <Seg label="Rail posts apart" value={design.rail.postSpacingFt} onChange={(v) => patch({ rail: { postSpacingFt: v } })} options={[{ value: 4, label: "4" }, { value: 6, label: "6" }, { value: 8, label: "8" }]} />
            </Field>
          </div>
          <div className="v1-toggles">
            {woodRail ? <Toggle checked={design.rail.cap} onChange={(v) => patch({ rail: { cap: v } })}>A flat 2x6 drink cap</Toggle> : null}
            {design.lower.on ? <Toggle checked={design.rail.lowerLevel} onChange={(v) => patch({ rail: { lowerLevel: v } })}>Rail on the lower level too</Toggle> : null}
          </div>
        </More>
      ) : null}
      {structure.rails.on ? <p className="v1-hint">{railWords(structure.rails)}.</p> : null}

      <h3 className="v1-h3">Stairs</h3>
      <div className="v1-rows" data-deck-stairs>
        {design.stairs.map((st, i) => {
          const b = structure.stairs.find((x) => x.design.id === st.id);
          const sideLen = st.level === "lower" ? (st.side === "front" ? design.lower.widthFt : design.lower.depthFt) : st.side === "front" ? design.shape.widthFt : design.shape.depthFt;
          const set = (p: Partial<StairDesign>) => setStairs((list) => list.map((x) => (x.id === st.id ? { ...x, ...p } : x)));
          return (
            <Scope key={st.id} stair={st.id}>
              <div className="v1-item" data-deck-stair={st.id}>
                <div className="v1-item-head">
                  <span className="v1-item-title">
                    {st.wrap ? "Box steps" : `Stair ${i + 1}`}
                    {b ? <span className="v1-item-sub">{b.risers} risers of {b.riserIn.toFixed(2)} in.{b.lands === "lower-deck" ? " to the lower level" : ""}</span> : null}
                  </span>
                  <button type="button" className="v1-btn v1-btn-sm v1-btn-danger" onClick={() => setStairs((list) => list.filter((x) => x.id !== st.id))}>
                    Remove
                  </button>
                </div>
                <Field label="Down the" wide>
                  <Seg label="Which side" value={st.side} onChange={(v) => set({ side: v, wrap: v === "front" && st.wrap })} options={(["front", "left", "right"] as const).map((v) => ({ value: v, label: STAIR_SIDE_LABEL[v] }))} />
                </Field>
                <div className="v1-grid2">
                  <Field label="Centred at" aside={`ft from the ${st.side === "front" ? "left end" : "house"}`}>
                    <NumberInput label="Where the stair's middle sits along the side, feet" value={st.atFt} parse={parseFeet} format={feetText} min={st.widthFt / 2} max={Math.max(st.widthFt / 2, sideLen - st.widthFt / 2)} onCommit={(n2) => set({ atFt: n2 })} />
                  </Field>
                  <Field label="Width" aside="ft">
                    <NumberInput label="Stair width, feet" value={st.widthFt} parse={parseFeet} format={feetText} min={STAIR_LIMITS.widthFt.min} max={STAIR_LIMITS.widthFt.max} onCommit={(n2) => set({ widthFt: n2 })} />
                  </Field>
                  <Field label="Lands on">
                    <select className="v1-sel" value={st.landing} onChange={(e) => set({ landing: e.target.value as StairDesign["landing"] })}>
                      {(["pad", "patio", "grade"] as const).map((v) => (
                        <option key={v} value={v}>{STAIR_LANDING_LABEL[v]}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Handrail">
                    <select className="v1-sel" value={st.handrail} onChange={(e) => set({ handrail: e.target.value as StairDesign["handrail"] })}>
                      <option value="auto">Auto — as the code asks</option>
                      <option value="both">Both sides</option>
                      <option value="one">One side</option>
                      <option value="none">None</option>
                    </select>
                  </Field>
                </div>
                {design.lower.on ? (
                  <Field label="From" wide>
                    <Seg label="From which level" value={st.level} onChange={(v) => set({ level: v })} options={[{ value: "upper", label: "The deck" }, { value: "lower", label: "The lower level" }]} />
                  </Field>
                ) : null}
                {st.side === "front" ? (
                  <>
                    <Toggle checked={st.wrap} onChange={(v) => set({ wrap: v })}>Box steps wrapping the deck (three risers at most)</Toggle>
                    {st.wrap ? <Seg label="Wrap how many sides" value={st.wrapSides} onChange={(v) => set({ wrapSides: v })} options={[{ value: 1, label: "Front" }, { value: 3, label: "Three sides" }, ...(design.placement === "detached" ? [{ value: 4 as const, label: "All four" }] : [])]} /> : null}
                  </>
                ) : null}
              </div>
            </Scope>
          );
        })}
      </div>
      <div className="v1-add-row">
        <button type="button" className="v1-add" disabled={design.stairs.length >= STAIR_LIMITS.count} onClick={() => setStairs((list) => [...list, defaultStair(`s${list.length + 1}-${Date.now().toString(36).slice(-3)}`, "front", design.shape.widthFt / 2)])} data-deck-add-stair>
          <Plus size={18} strokeWidth={2.5} aria-hidden="true" />
          <span>Stairs down the front</span>
        </button>
        <button
          type="button"
          className={cx("v1-add", placing?.kind === "stair" && "is-on")}
          disabled={design.stairs.length >= STAIR_LIMITS.count}
          aria-pressed={placing?.kind === "stair"}
          onClick={() => {
            setPlacing(placing?.kind === "stair" ? null : { kind: "stair" });
            if (view !== "3d" && view !== "plan") setView("3d");
          }}
          data-deck-place-stair
        >
          <Plus size={18} strokeWidth={2.5} aria-hidden="true" />
          <span>{placing?.kind === "stair" ? (view === "plan" ? "Click the plan…" : "Click the deck…") : "Place them on the deck"}</span>
        </button>
      </div>
    </>
  ) : null;

  const roofStep = () =>
    withRoof && roof ? (
      <>
        {kinds.length > 1 ? (
          <>
            <h3 className="v1-h3">Its shape</h3>
            <Answers label="Roof shape" value={r.kind} onChange={(k: RoofKind) => rp({ kind: k })} options={kinds.map((k) => ({ value: k, label: ROOF_KIND_LABEL[k].split(" — ")[0], sub: ROOF_KIND_LABEL[k].split(" — ")[1] }))} />
          </>
        ) : null}
        {roof.kindNote ? <p className="v1-call v1-call-warn">{roof.kindNote}</p> : null}
        {canAttach ? (
          <Field label="It stands" wide>
            <Seg label="On the house or free" value={r.attach} onChange={(a) => rp({ attach: a })} options={[{ value: "wall", label: "On the house wall" }, { value: "free", label: "Free-standing" }]} />
          </Field>
        ) : null}
        <h3 className="v1-h3">Height to the headers</h3>
        <Answers label="Height to the headers" cols={3} value={EAVE_PRESETS.some((h) => h.inches === r.eaveHeightIn) ? r.eaveHeightIn : -1} onChange={(v) => rp({ eaveHeightIn: v })} options={EAVE_PRESETS.map((h) => ({ value: h.inches, label: h.label }))} />
        <Stepper label="Height to the headers" unit="in." aside={ftIn(r.eaveHeightIn)} value={r.eaveHeightIn} step={1} parse={parseInches} format={String} min={ROOF_LIMITS.eaveHeightIn.min} max={ROOF_LIMITS.eaveHeightIn.max} onCommit={(n2) => rp({ eaveHeightIn: n2 })} />
        {design.structure !== "pergola" ? (
          <Field label="Pitch" aside={`${r.pitch}:12 · ${Math.round(Math.atan(r.pitch / 12) * (180 / Math.PI))}°`} wide>
            <Seg label="Pitch" value={r.pitch} onChange={(p) => rp({ pitch: p })} options={PITCHES.map((p) => ({ value: p, label: `${p}:12` }))} />
          </Field>
        ) : (
          <Field label="The top" wide>
            <Seg label="Pergola top" value={r.pergolaStyle} onChange={(v) => rp({ pergolaStyle: v })} options={(["flat", "louvered", "arched"] as const).map((v) => ({ value: v, label: PERGOLA_STYLE_LABEL[v] }))} />
          </Field>
        )}
        {design.structure !== "pergola" ? (
          <>
            <Field label="Roofing" wide>
              <select
                className="v1-sel"
                value={design.custom.roofing ? CUSTOM : r.roofing}
                onChange={(e) => {
                  if (e.target.value === CUSTOM) return pickCustom("roofing");
                  rp({ roofing: e.target.value as RoofDesign["roofing"] });
                  dropCustom("roofing");
                }}
                data-deck-pick="roofing"
              >
                {roofingOptions}
                <option value={CUSTOM}>{CUSTOM_LABEL}</option>
              </select>
            </Field>
            {design.custom.roofing ? (
              <CustomBox slot="roofing" title="Roofing" product={design.custom.roofing} unit="square" fresh={freshCustom === "roofing"} onDone={freshDone} onChange={(p) => setCustom("roofing", p)} onBack={() => setCustom("roofing", undefined)} note={`Priced per square — 100 sq ft of roof; this roof is ${roof.squares} squares.`}>
                <Field label="Goes on like" wide>
                  <select className="v1-sel" value={r.roofing} onChange={(e) => rp({ roofing: e.target.value as RoofDesign["roofing"] })} data-deck-like="roofing">
                    {roofingOptions}
                  </select>
                </Field>
              </CustomBox>
            ) : null}
          </>
        ) : null}
        {withDeck ? (
          <More title="The roof's outline and size" now={`${ROOF_PLAN_LABEL[r.plan.shape]} · ${Math.round(roof.footprintSqFt)} sq ft`} id="roof-outline">
            {outlineBlock()}
          </More>
        ) : null}
        <More title="Posts, headers and walls" now={`${r.post} posts · ${r.header === "auto" ? [...new Set(roof.headers.map((h) => h.spec.size))].join(", ") || "auto" : r.header} headers · ${r.overhangIn ? `${r.overhangIn} in. overhang` : "no overhang"}${r.walls.fill !== "none" ? ` · ${WALL_FILL_LABEL[r.walls.fill].split(",")[0].toLowerCase()}` : ""}`} id="roof-posts">
          <Field label="Posts" wide>
            <Seg label="Roof posts" value={r.post} onChange={(p) => rp({ post: p })} options={(["4x4", "6x6", "8x8"] as const).map((p) => ({ value: p, label: p }))} />
          </Field>
          <div className="v1-grid2">
            <Field label="Headers" aside={r.header === "auto" ? `picked: ${[...new Set(roof.headers.map((h) => h.spec.size))].join(", ") || "—"}` : undefined}>
              <select className="v1-sel" value={r.header} onChange={(e) => rp({ header: e.target.value as RoofDesign["header"] })}>
                <option value="auto">Auto — least cost</option>
                <option value="lvl">Engineered LVL throughout</option>
                <optgroup label="Built up from 2x">
                  {BUILT_UP_CHOICES.map((b) => (
                    <option key={b} value={b}>{`${b[0]}-ply ${b.slice(2)}`}</option>
                  ))}
                </optgroup>
                <optgroup label="Solid 4x">
                  {SOLID_BEAMS.map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </optgroup>
              </select>
            </Field>
            <Field label="Overhang past the posts" aside="in.">
              <select className="v1-sel" value={r.overhangIn} onChange={(e) => rp({ overhangIn: Number(e.target.value) })}>
                {OVERHANGS.map((o) => (
                  <option key={o} value={o}>{o === 0 ? "None" : `${o} in.`}</option>
                ))}
              </select>
            </Field>
          </div>
          <Toggle checked={r.braces} onChange={(v) => rp({ braces: v })}>Knee braces at the posts</Toggle>
          <Field label="Walls between the posts" wide>
            <Seg
              label="Walls between the posts"
              value={design.custom.walls && r.walls.fill !== "none" ? "custom" : r.walls.fill}
              onChange={(v) => {
                if (v === "custom") return pickCustom("walls");
                rp({ walls: { ...r.walls, fill: v } });
                dropCustom("walls");
              }}
              options={[...(["none", "screen", "lattice", "solid"] as const).map((v) => ({ value: v, label: WALL_FILL_LABEL[v].split(",")[0] })), { value: "custom" as const, label: "Custom" }]}
            />
          </Field>
          {design.custom.walls && r.walls.fill !== "none" ? (
            <CustomBox slot="walls" title="Walls" product={design.custom.walls} unit="sq ft of wall" fresh={freshCustom === "walls"} onDone={freshDone} onChange={(p) => setCustom("walls", p)} onBack={() => setCustom("walls", undefined)} note="Priced per square foot of wall, framed, as the list's panels are.">
              <Field label="Built like" wide>
                <Seg label="Walls built like" value={r.walls.fill} onChange={(v) => rp({ walls: { ...r.walls, fill: v } })} options={(["screen", "lattice", "solid"] as const).map((v) => ({ value: v, label: WALL_FILL_LABEL[v].split(",")[0] }))} />
              </Field>
            </CustomBox>
          ) : null}
          {r.walls.fill !== "none" ? (
            <Field label="On how many sides" aside={`of ${roof.ring.length - (roof.attach === "wall" ? 1 : 0)} open`} wide>
              <NumberInput label="How many sides get walls" value={r.walls.sides} parse={intText} format={String} min={1} max={Math.max(1, roof.ring.length - (roof.attach === "wall" ? 1 : 0))} onCommit={(n2) => rp({ walls: { ...r.walls, sides: n2 } })} />
            </Field>
          ) : null}
        </More>
        <More title={design.structure === "pergola" ? "Rafters and slats" : "Rafters and ridge"} now={`${roof.trusses ? "trusses" : `${roof.rafters.size} rafters`} @ ${r.rafterSpacingIn}" · ${roof.roofLoad} psf`} id="roof-rafters">
          <Field label="Rafters" aside={roof.trusses ? "trusses frame this roof" : r.rafter === "auto" ? `picked: ${roof.rafters.size}` : undefined} wide>
            <Seg label="Rafters" value={r.rafter} onChange={(v) => rp({ rafter: v })} options={[{ value: "auto", label: "Auto" }, ...(["2x6", "2x8", "2x10", "2x12"] as const).map((j) => ({ value: j, label: j }))]} />
          </Field>
          <Field label="Rafter spacing" aside="on center" wide>
            <Seg label="Rafter spacing" value={r.rafterSpacingIn} onChange={(v) => rp({ rafterSpacingIn: v })} options={[{ value: 12, label: '12"' }, { value: 16, label: '16"' }, { value: 24, label: '24"' }]} />
          </Field>
          {r.kind === "gable" || r.kind === "hip" || r.kind === "gambrel" ? (
            <Field label="At the ridge" aside={r.ridge === "auto" ? (roof.trusses ? "picked: trusses" : roof.ridge ? `picked: ${roof.ridge.kind === "beam" ? "ridge beam" : "ridge board"}` : undefined) : undefined} wide>
              <Seg label="At the ridge" value={r.ridge} onChange={(v) => rp({ ridge: v })} options={[{ value: "auto", label: "Auto" }, { value: "beam", label: "Ridge beam", title: r.kind === "hip" ? "A beam on two king posts, each standing on a cross beam from eave header to eave header; the ceiling stays open" : "The rafters bear on a beam; the ceiling stays open" }, { value: "board", label: "Board + ties", title: "A board between the rafters, with rafter ties every 4 ft" }, ...(r.kind === "gable" ? [{ value: "trusses" as const, label: "Trusses", title: "Manufactured trusses 24 in. on center, one piece header to header — designed and stamped by the truss maker" }] : [])]} />
            </Field>
          ) : null}
          {roof.kind === "gable" && roof.ridge?.kind === "beam" && !roof.trusses ? (
            <Field label="Cross beams under the ridge" aside={roof.crossBeams ? `the ridge spans ${ftIn(roof.ridge.spanIn)} between king posts` : "the ridge spans end to end"} wide>
              <Seg label="Cross beams under the ridge" value={r.crossBeams} onChange={(v) => rp({ crossBeams: v })} options={[0, 1, 2, 3].map((v) => ({ value: v, label: v === 0 ? "None" : String(v), title: v === 0 ? "The ridge beam spans from one end to the other on king posts" : `${v} cross beam${v > 1 ? "s" : ""} from eave to eave, each with a king post under the ridge and a post under each end` }))} />
            </Field>
          ) : null}
          {roof.kind === "hip" && roof.attach === "free" && roof.ridge?.kind === "beam" ? <p className="v1-hint" data-deck-hip-cross>The ridge beam stands on two king posts, each on a cross beam from eave header to eave header. Nothing pushes the headers apart, so no ties.</p> : null}
          {roof.ringTensionLb > 0 ? <p className="v1-hint" data-deck-ring>The hips push the corners out — about {roof.ringTensionLb.toLocaleString("en-US")} lb at each header joint. A tension strap across every joint is in the material list.</p> : null}
          {design.structure === "pergola" && r.pergolaStyle !== "louvered" ? (
            <div className="v1-grid2">
              <Field label="Slats">
                <Seg label="Slats" value={r.slats.size} onChange={(v) => rp({ slats: { ...r.slats, size: v } })} options={(["2x2", "2x4", "2x6"] as const).map((v) => ({ value: v, label: v }))} />
              </Field>
              <Field label="Slat spacing" aside="in. apart">
                <NumberInput label="Slat spacing, inches" value={r.slats.spacingIn} parse={intText} format={String} min={ROOF_LIMITS.slatSpacingIn.min} max={ROOF_LIMITS.slatSpacingIn.max} onCommit={(n2) => rp({ slats: { ...r.slats, spacingIn: n2 } })} />
              </Field>
            </div>
          ) : null}
          <Field label="Roof load" aside={r.load === "auto" ? `from the site: ${roof.roofLoad} psf` : undefined} wide>
            <select className="v1-sel" value={String(r.load)} onChange={(e) => rp({ load: e.target.value === "auto" ? "auto" : (Number(e.target.value) as RoofDesign["load"]) })}>
              <option value="auto">Auto — follows the ground snow here</option>
              <option value="20">20 psf roof live load</option>
              <option value="30">30 psf ground snow</option>
              <option value="50">50 psf ground snow</option>
              <option value="70">70 psf ground snow</option>
            </select>
          </Field>
        </More>
        {design.structure !== "pergola" ? (
          <More title="Ceiling, fascia and gutters" now={[CEILING_LABEL[r.ceiling], r.gutters.kind !== "none" ? GUTTER_LABEL[r.gutters.kind] : "no gutters"].join(" · ")} id="roof-trim">
            <div className="v1-grid2">
              <Field label="Ceiling">
                <select
                  className="v1-sel"
                  value={design.custom.ceiling && r.ceiling !== "none" ? CUSTOM : r.ceiling}
                  onChange={(e) => {
                    if (e.target.value === CUSTOM) return pickCustom("ceiling");
                    rp({ ceiling: e.target.value as RoofDesign["ceiling"] });
                    dropCustom("ceiling");
                  }}
                  data-deck-pick="ceiling"
                >
                  {(["none", "tongue-groove", "beadboard"] as const).map((c) => (
                    <option key={c} value={c}>{CEILING_LABEL[c]}</option>
                  ))}
                  <option value={CUSTOM}>{CUSTOM_LABEL}</option>
                </select>
              </Field>
              {metalRoof ? (
                <Field label="Metal goes on">
                  <Seg label="Metal goes on" value={r.roofDeck} onChange={(v) => rp({ roofDeck: v })} options={[{ value: "sheathing", label: "Sheathing" }, { value: "purlins", label: "Purlins" }]} />
                </Field>
              ) : null}
              <Field label="Fascia finish">
                <select
                  className="v1-sel"
                  value={design.custom.roofFascia && (r.fascia.eave || r.fascia.rake) ? CUSTOM : r.fascia.finish}
                  onChange={(e) => {
                    if (e.target.value === CUSTOM) return pickCustom("roofFascia");
                    rp({ fascia: { ...r.fascia, finish: e.target.value as RoofDesign["fascia"]["finish"] } });
                    dropCustom("roofFascia");
                  }}
                  data-deck-pick="roofFascia"
                >
                  {(["wood", "pvc", "aluminum-wrap"] as const).map((f) => (
                    <option key={f} value={f}>{FASCIA_FINISH_LABEL[f]}</option>
                  ))}
                  <option value={CUSTOM}>{CUSTOM_LABEL}</option>
                </select>
              </Field>
              <Field label="Gutters" aside={roof.gutters ? `${Math.round(roof.gutters.lf)} ft · ${roof.gutters.downspouts} downspouts` : undefined}>
                <select
                  className="v1-sel"
                  value={design.custom.gutters && r.gutters.kind !== "none" ? CUSTOM : r.gutters.kind}
                  onChange={(e) => {
                    if (e.target.value === CUSTOM) return pickCustom("gutters");
                    rp({ gutters: { ...r.gutters, kind: e.target.value as RoofDesign["gutters"]["kind"] } });
                    dropCustom("gutters");
                  }}
                  data-deck-pick="gutters"
                >
                  {GUTTER_KINDS.map((g) => (
                    <option key={g} value={g}>{GUTTER_LABEL[g]}</option>
                  ))}
                  <option value={CUSTOM}>{CUSTOM_LABEL}</option>
                </select>
              </Field>
            </div>
            {design.custom.ceiling && r.ceiling !== "none" ? (
              <CustomBox slot="ceiling" title="Ceiling" product={design.custom.ceiling} unit="sq ft of ceiling" fresh={freshCustom === "ceiling"} onDone={freshDone} onChange={(p) => setCustom("ceiling", p)} onBack={() => setCustom("ceiling", undefined)} note="Priced per square foot of ceiling, 10% waste on top.">
                <Field label="Looks like" wide>
                  <Seg label="Ceiling looks like" value={r.ceiling} onChange={(v) => rp({ ceiling: v })} options={(["tongue-groove", "beadboard"] as const).map((c) => ({ value: c, label: CEILING_LABEL[c] }))} />
                </Field>
              </CustomBox>
            ) : null}
            {design.custom.roofFascia && (r.fascia.eave || r.fascia.rake) ? <CustomBox slot="roofFascia" title="Fascia finish" product={design.custom.roofFascia} unit="ft" fresh={freshCustom === "roofFascia"} onDone={freshDone} onChange={(p) => setCustom("roofFascia", p)} onBack={() => setCustom("roofFascia", undefined)} note="Priced per foot of fascia and rake board." /> : null}
            {design.custom.gutters && r.gutters.kind !== "none" ? (
              <CustomBox slot="gutters" title="Gutters" product={design.custom.gutters} unit="ft of gutter" fresh={freshCustom === "gutters"} onDone={freshDone} onChange={(p) => setCustom("gutters", p)} onBack={() => setCustom("gutters", undefined)} note="Priced per foot of gutter. The downspouts and their elbows stay as the kind it hangs like.">
                <Field label="Hangs like" wide>
                  <select className="v1-sel" value={r.gutters.kind} onChange={(e) => rp({ gutters: { ...r.gutters, kind: e.target.value as RoofDesign["gutters"]["kind"] } })} data-deck-like="gutters">
                    {GUTTER_KINDS.filter((g) => g !== "none").map((g) => (
                      <option key={g} value={g}>{GUTTER_LABEL[g]}</option>
                    ))}
                  </select>
                </Field>
              </CustomBox>
            ) : null}
            <div className="v1-toggles">
              {r.kind !== "shed" ? <Toggle checked={r.cupola} onChange={(v) => rp({ cupola: v })}>Cupola at the peak</Toggle> : null}
              <Toggle checked={r.fascia.eave} onChange={(v) => rp({ fascia: { ...r.fascia, eave: v } })}>Fascia on the eaves ({Math.round(roof.eaveFt)} ft)</Toggle>
              {roof.rakeFt > 0 ? <Toggle checked={r.fascia.rake} onChange={(v) => rp({ fascia: { ...r.fascia, rake: v } })}>Rake boards on the gable ends ({Math.round(roof.rakeFt)} ft)</Toggle> : null}
              <Toggle checked={r.soffit} onChange={(v) => rp({ soffit: v })}>Vented soffit under the overhang</Toggle>
              {r.gutters.kind !== "none" ? <Toggle checked={r.gutters.guards} onChange={(v) => rp({ gutters: { ...r.gutters, guards: v } })}>Gutter guards</Toggle> : null}
            </div>
          </More>
        ) : null}
      </>
    ) : null;

  const extrasStep = () => (
    <>
      <p className="v1-lead">Tap what it gets. Each goes where it usually does — or place it in the 3D.</p>
      <div className="v1-fix-grid">
        {FIXTURE_CHIPS.map((k) => (
          <button key={k} type="button" className="v1-add v1-add-small" disabled={design.electrical.fixtures.length >= ELECTRICAL_LIMITS.fixtures} onClick={() => setFixtures((list) => [...list, defaultFixture(`e${list.length + 1}-${Date.now().toString(36).slice(-3)}`, k)])} data-deck-add-fixture={k}>
            <Plus size={16} strokeWidth={2.5} aria-hidden="true" />
            <span>{FIXTURE_SHORT[k]}</span>
          </button>
        ))}
      </div>
      <div className="v1-rows">
        {design.electrical.fixtures.map((f) => {
          const placedOnes = structure.electrical.fixtures.filter((pf) => pf.id === f.id || pf.id.startsWith(`${f.id}-`));
          const setF = (p: Partial<Fixture>) => setFixtures((list) => list.map((x) => (x.id === f.id ? { ...x, ...p } : x)));
          const placingThis = placing?.kind === "fixture" && placing.id === f.id;
          return (
            <Scope key={f.id} fixture={f.id}>
              <div className="v1-item" data-deck-fixture={f.id}>
                <div className="v1-item-head">
                  <span className="v1-item-title">
                    {f.custom ? f.custom.name : FIXTURE_SHORT[f.kind]}
                    {f.supply === "client" ? <span className="v1-stamp">By the client · TBD</span> : null}
                  </span>
                  <button type="button" className="v1-btn v1-btn-sm v1-btn-danger" onClick={() => setFixtures((list) => list.filter((x) => x.id !== f.id))}>
                    Remove
                  </button>
                </div>
                <div className="v1-grid2">
                  <Field label="What">
                    <select
                      className="v1-sel"
                      value={f.custom ? CUSTOM : f.kind}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === CUSTOM) {
                          setFreshCustom(`fx:${f.id}`);
                          return setFixtureCustom(f.id, { name: FIXTURE_LABEL[f.kind], price: fixturePrice(f) });
                        }
                        setF({ kind: v as FixtureKind, at: f.kind === v ? f.at : null, custom: null });
                      }}
                      data-deck-pick="fixture"
                    >
                      {fixtureOptions}
                      <option value={CUSTOM}>Custom — a fixture of your own…</option>
                    </select>
                  </Field>
                  {f.kind !== "led-strip" && f.kind !== "post-cap" && f.kind !== "step-light" && f.kind !== "string-light" ? (
                    <Field label="How many">
                      <NumberInput label="How many" value={f.qty} parse={intText} format={String} min={1} max={ELECTRICAL_LIMITS.qty.max} onCommit={(n2) => setF({ qty: n2 })} />
                    </Field>
                  ) : null}
                </div>
                <Field label="Who buys the fixture" aside={f.supply === "client" ? "wiring and hanging stay in the price" : undefined} wide>
                  <Seg label="Who buys the fixture" value={f.supply} onChange={(v) => setF({ supply: v })} options={[{ value: "we", label: "We supply it" }, { value: "client", label: "The client" }]} />
                </Field>
                {f.kind === "heater" ? (
                  <Field label="Heater" wide>
                    <Seg label="Heater voltage" value={f.volts240 ? "240" : "120"} onChange={(v) => setF({ volts240: v === "240" })} options={[{ value: "120", label: "1.5 kW, 120 V" }, { value: "240", label: "4 kW, 240 V" }]} />
                  </Field>
                ) : null}
                {f.custom ? (
                  <CustomBox slot={`fixture-${f.id}`} title="Fixture" product={f.custom} unit={f.supply === "client" ? null : f.kind === "led-strip" ? "ft" : f.kind === "string-light" ? "48-ft strand" : "fixture"} fresh={freshCustom === `fx:${f.id}`} onDone={freshDone} onChange={(p) => setFixtureCustom(f.id, p)} onBack={() => setFixtureCustom(f.id, null)} note={f.supply === "client" ? "The client buys it: named on the list, not priced. Its box, its wire and the hanging are." : "Priced at your number. The box, the wire, the switch and the circuit follow what it is wired like."}>
                    <Field label="Wired like" wide>
                      <select className="v1-sel" value={f.kind} onChange={(e) => setF({ kind: e.target.value as FixtureKind, at: null })} data-deck-like="fixture">
                        {fixtureOptions}
                      </select>
                    </Field>
                  </CustomBox>
                ) : null}
                <div className="v1-row-acts">
                  <button
                    type="button"
                    className={cx("v1-btn", "v1-btn-sm", placingThis && "is-on")}
                    aria-pressed={placingThis}
                    onClick={() => {
                      setPlacing(placingThis ? null : { kind: "fixture", id: f.id });
                      setView("3d");
                    }}
                    data-deck-place-fixture={f.id}
                  >
                    {placingThis ? "Click the 3D…" : f.at ? "Move it in 3D" : "Place in 3D"}
                  </button>
                  {f.at ? (
                    <button type="button" className="v1-btn v1-btn-sm v1-btn-quiet" onClick={() => setF({ at: null })}>
                      Back to the usual spot
                    </button>
                  ) : null}
                  <span className="v1-meta">{f.at ? `on the ${f.at.on}` : placedOnes.length ? `${placedOnes.length === 1 ? "placed" : `${placedOnes.length} placed`} where it usually goes` : ""}</span>
                </div>
              </div>
            </Scope>
          );
        })}
      </div>
      {structure.electrical.on ? (
        <div className="v1-sub">
          <div className="v1-grid2">
            <Field label="Panel to the structure" aside="ft of feed">
              <NumberInput label="Feet from the house's panel to the structure" value={design.electrical.feedFt} parse={intText} format={String} min={ELECTRICAL_LIMITS.feedFt.min} max={ELECTRICAL_LIMITS.feedFt.max} onCommit={(n2) => patch({ electrical: { ...design.electrical, feedFt: n2 } })} />
            </Field>
            <Field label="The feed comes from the">
              <Seg label="Panel side" value={design.electrical.panelSide} onChange={(v) => patch({ electrical: { ...design.electrical, panelSide: v } })} options={[{ value: "left", label: "Left end" }, { value: "right", label: "Right end" }]} />
            </Field>
          </div>
          <Toggle checked={design.electrical.timer} onChange={(v) => patch({ electrical: { ...design.electrical, timer: v } })}>A timer or photocell on the lights</Toggle>
          <p className="v1-hint">
            {electricalWords(structure.electrical)} · {structure.electrical.boxes} boxes · {structure.electrical.switches} switches
            {structure.electrical.lv ? ` · ${structure.electrical.lv.transformers} transformer${structure.electrical.lv.transformers > 1 ? "s" : ""}` : ""}
            {structure.electrical.trenchFt ? ` · ${structure.electrical.trenchFt} ft of trench` : ""}. Turn on Night under the 3D to see them lit.
          </p>
        </div>
      ) : null}
      {withDeck ? (
        <Scope step="step-stairs">
          <h3 className="v1-h3">The old deck and the hardware</h3>
          <div className="v1-grid2" data-deck-extras>
            <Field label="Tear out an old deck" aside="sq ft">
              <NumberInput label="Old deck to tear out, square feet" value={design.extras.demoSqFt} parse={intText} format={String} min={0} max={4000} onCommit={(n2) => patch({ extras: { demoSqFt: n2 } })} />
            </Field>
          </div>
          <Toggle checked={design.extras.stainless} onChange={(v) => patch({ extras: { stainless: v } })}>Stainless connectors — within 300 ft of salt water</Toggle>
        </Scope>
      ) : null}
    </>
  );

  const checksStep = () => (
    <>
      <div className="v1-verdict-row">
        {summary.fail ? <span className="v1-stamp is-bad">{summary.fail} to fix</span> : null}
        {summary.warn ? <span className="v1-stamp is-warn">{summary.warn} to check</span> : null}
        <span className="v1-stamp is-pass">{summary.pass} pass</span>
        {fixableCount ? (
          <button type="button" className="v1-btn v1-btn-sm" onClick={runAutoFix} data-deck-autofix>
            <RotateCcw size={15} strokeWidth={2.5} aria-hidden="true" /> Auto-fix {fixableCount === 1 ? "1 item" : `${fixableCount} items`}
          </button>
        ) : null}
      </div>
      <p className="v1-hint">Each part against the table it is sized from. Estimating grade — the building department decides.</p>
      {fixReport ? (
        <div className={cx("v1-call", fixReport.left.length ? "v1-call-warn" : "v1-call-pass", "v1-fix-report")} role="status" data-deck-fix-report>
          <button type="button" className="v1-icon-btn v1-fix-close" onClick={() => setFixReport(null)} aria-label="Close">
            <X size={16} strokeWidth={2.5} aria-hidden="true" />
          </button>
          {fixReport.fixed.length ? (
            <p>
              <b>Fixed:</b> {fixReport.fixed.join(" · ")}.
            </p>
          ) : (
            <p>
              <b>Nothing the studio can change on its own.</b>
            </p>
          )}
          {fixReport.left.length ? (
            <>
              <p>
                <b>Still for you, an engineer or the building office:</b>
              </p>
              <ul>{fixReport.left.slice(0, 8).map((l, i) => <li key={i}>{l}</li>)}</ul>
            </>
          ) : (
            <p>Every check passes or is a note.</p>
          )}
        </div>
      ) : null}
      {ordered.some(loud) ? <ul className="v1-checks">{ordered.filter(loud).map(checkRow)}</ul> : <p className="v1-call v1-call-pass"><b>Inside the tables.</b> Every number names its table.</p>}
      {ordered.some((c) => !loud(c)) ? (
        <More
          title={(() => {
            const notes = ordered.filter((c) => !loud(c) && c.level === "info").length;
            const passes = ordered.filter((c) => c.level === "pass").length;
            return [notes ? `${notes} ${notes === 1 ? "note" : "notes"}` : "", passes ? `${passes} passed` : ""].filter(Boolean).join(" and ");
          })()}
          id="checks-more"
        >
          <ul className="v1-checks">{ordered.filter((c) => !loud(c)).map(checkRow)}</ul>
        </More>
      ) : null}
    </>
  );

  const packageStep = () => (
    <>
      <div className="v1-total" aria-label="Price">
        <div className="v1-total-main">
          <span className="v1-total-label">{what} price, before tax</span>
          <span className="v1-total-v">{money(pkg.subtotal)}</span>
        </div>
        <dl className="v1-total-facts">
          <div>
            <dt>Per sq ft</dt>
            <dd>{money(pkg.pricePerSqFt, true)}</dd>
          </div>
          <div>
            <dt>Material</dt>
            <dd>{money(pkg.materialSubtotal)}</dd>
          </div>
          <div>
            <dt>Labor</dt>
            <dd>{money(pkg.laborSubtotal)}</dd>
          </div>
          <div>
            <dt>Area</dt>
            <dd>{Math.round(pkg.areaSqFt)} sq ft</dd>
          </div>
        </dl>
      </div>
      {summary.fail ? (
        <p className="v1-call v1-call-bad">
          <b>{summary.fail === 1 ? "One check fails" : `${summary.fail} checks fail`}.</b> The proposal can be made, but fix the frame before the client sees it —{" "}
          <button type="button" className="v1-link" onClick={() => go("checks")}>
            see the checks
          </button>
          .
        </p>
      ) : null}
      {exampleShare > 0 ? (
        <p className="v1-call v1-call-warn">
          <b>{exampleShare}% of this price stands on example prices.</b> Set your own under Your prices below before it goes to a client.
        </p>
      ) : null}

      <div className="v1-finish" data-v1-finish>
        <label className="v1-field v1-field-wide">
          <span className="v1-lbl">
            <span>Draft name</span>
            <span className="v1-lbl-aside" data-deck-save={saveState}>
              {saveWords}
            </span>
          </span>
          <input
            className="v1-in"
            value={draftTitle}
            placeholder={structureWords(design)}
            onChange={(e) => {
              dirty.current = true;
              setDraftTitle(e.target.value);
            }}
          />
        </label>
        {error && actAt === "bottom" ? <p className="v1-call v1-call-bad" role="alert">{error}</p> : null}
        <div className="v1-finish-acts">
          <button type="button" className="v1-btn" onClick={() => (preview ? askAddon("Save drafts with Deck Studio") : void saveNow())} disabled={saveState === "saving"} data-v1-save-draft>
            {preview ? <Lock size={15} strokeWidth={2.5} aria-hidden="true" /> : <FileText size={16} strokeWidth={2.5} aria-hidden="true" />}
            {saveState === "saving" ? "Saving…" : "Save draft"}
          </button>
          <button type="button" className={cx("v1-btn", sendOpen && "is-on")} aria-expanded={sendOpen} onClick={() => (preview ? askAddon("Send the design to your client with Deck Studio") : setSendOpen((v) => !v))} data-v1-send data-tour="deck:send">
            {preview ? <Lock size={15} strokeWidth={2.5} aria-hidden="true" /> : <Send size={16} strokeWidth={2.5} aria-hidden="true" />}
            Send to client{inbox.length ? <span className="v1-count">{inbox.length}</span> : null}
          </button>
          {linked && !linked.lock ? (
            <>
              <button type="button" className="v1-btn" disabled={!!busy} onClick={convert} data-deck-convert-new>
                {busy === "convert" ? "Making the proposal…" : "Save as a new proposal"}
              </button>
              <button type="button" className="v1-btn v1-btn-primary v1-btn-big" disabled={!!busy || !behind} onClick={() => askUpdate("bottom")} data-deck-update="bottom">
                {busy === "update" ? "Updating…" : !behind ? `${linked.ref} is up to date` : summary.fail ? "Update anyway" : `Update ${linked.ref}`}
              </button>
            </>
          ) : (
            <button type="button" className="v1-btn v1-btn-primary v1-btn-big" disabled={!!busy} onClick={convert} data-deck-convert>
              {preview ? <Lock size={16} strokeWidth={2.5} aria-hidden="true" /> : null}
              {busy === "convert" ? "Making the proposal…" : linked ? "Save as a new proposal" : summary.fail ? "Make proposal anyway" : "Make proposal"}
            </button>
          )}
        </div>
        {confirmAt === "bottom" ? confirmBox : null}
        {linked && updated && !behind ? (
          <p className="v1-call v1-call-pass" role="status" data-deck-updated>
            <b>{linked.ref} updated {ago(updated.at)}.</b> {updatedWords}{" "}
            <Link href={`/dashboard/manual-blueprint?proposal=${encodeURIComponent(linked.id)}` as Route}>Open the proposal</Link>
          </p>
        ) : null}
        {sendOpen ? <DeckV1Send design={design} address={address} title={draftTitle.trim()} clientId={clientId} proposalId={linkedId} prefill={opened?.client ? { name: opened.client.name, phone: opened.client.phone, email: opened.client.email ?? clientContact?.email ?? null } : clientContact} onOpened={(token) => setInbox((list) => list.filter((l) => l.token !== token))} onClose={() => setSendOpen(false)} /> : null}
      </div>

      <section className="v1-pack" aria-label="On the proposal">
        <h3 className="v1-h3">On the proposal</h3>
        <div className="v1-table-wrap">
          <table className="v1-table">
            <thead>
              <tr>
                <th>Line</th>
                <th className="v1-r">Qty</th>
                <th className="v1-r v1-hide-s">Material</th>
                <th className="v1-r v1-hide-s">Labor</th>
                <th className="v1-r">Total</th>
              </tr>
            </thead>
            <tbody>
              {pkg.lines.map((l) => (
                <tr key={l.id} data-line={l.id}>
                  <td>
                    <div className="v1-line-name">
                      {l.name}
                      {l.tbd ? <span className="v1-stamp">To be determined</span> : null}
                    </div>
                    {l.description ? <div className="v1-line-desc">{l.description}</div> : null}
                  </td>
                  <td className="v1-r v1-nums">
                    {l.quantity.toLocaleString("en-US")} <span className="v1-unit">{l.unit}</span>
                  </td>
                  <td className="v1-r v1-nums v1-hide-s">{money(l.materialCost, true)}</td>
                  <td className="v1-r v1-nums v1-hide-s">{money(l.laborCost, true)}</td>
                  <td className="v1-r v1-nums v1-strong">{money(l.quantity * l.unitPrice, true)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Subtotal, before tax</td>
                <td />
                <td className="v1-hide-s" />
                <td className="v1-hide-s" />
                <td className="v1-r v1-nums v1-strong">{money(pkg.subtotal, true)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <section className="v1-pack" aria-label="Material package">
        <div className="v1-pack-head">
          <h3 className="v1-h3">Material package</h3>
          <span className="v1-meta">
            {Math.round(pkg.takeoff.framingLf)} ft of framing · {pkg.takeoff.concreteBags} bags · {pkg.takeoff.footings} footings
            {pkg.takeoff.roofSquares ? ` · ${pkg.takeoff.roofSquares} squares` : ""}
            {pkg.takeoff.stairRisers ? ` · ${pkg.takeoff.stairRisers} risers` : ""}
            {pkg.takeoff.railLf ? ` · ${Math.round(pkg.takeoff.railLf)} ft of rail` : ""}
          </span>
        </div>
        <div className="v1-row-acts">
          {yardHref ? (
            <a className="v1-btn v1-btn-sm" href={yardHref} target="_blank" rel="noopener" onClick={(e) => { if (preview && !viewOnly) { e.preventDefault(); askAddon("Print the lists and the permit sheet with Deck Studio"); } }} data-deck-materials="yard">
              List for the lumber yard <ExternalLink size={14} aria-hidden="true" />
            </a>
          ) : null}
          {installerHref ? (
            <a className="v1-btn v1-btn-sm" href={installerHref} target="_blank" rel="noopener" onClick={(e) => { if (preview && !viewOnly) { e.preventDefault(); askAddon("Print the lists and the permit sheet with Deck Studio"); } }} data-deck-materials="installer">
              For the installer to buy <ExternalLink size={14} aria-hidden="true" />
            </a>
          ) : null}
          {permitHref ? (
            <a className="v1-btn v1-btn-sm" href={permitHref} target="_blank" rel="noopener" onClick={(e) => { if (preview && !viewOnly) { e.preventDefault(); askAddon("Print the lists and the permit sheet with Deck Studio"); } }} data-deck-permit>
              Permit &amp; build set <ExternalLink size={14} aria-hidden="true" />
            </a>
          ) : null}
          {bomByStep.size ? (
            <button type="button" className="v1-btn v1-btn-sm v1-btn-quiet" onClick={() => setBomOpen((prev) => ([...bomByStep.keys()].every((k) => prev.has(k)) ? new Set() : new Set(bomByStep.keys())))} data-bom-all>
              {[...bomByStep.keys()].every((k) => bomOpen.has(k)) ? "Close all lines" : "Open all lines"}
            </button>
          ) : null}
        </div>
        <div className="v1-table-wrap">
          <table className="v1-table v1-bom">
            <thead>
              <tr>
                <th className="v1-r">Qty</th>
                <th>Item</th>
                <th className="v1-r v1-hide-s">Each</th>
                <th className="v1-r">Cost</th>
              </tr>
            </thead>
            {[...bomByStep].map(([step, rows]) => (
              <tbody key={step} data-bom-step={step}>
                <tr className="v1-group-row">
                  <td colSpan={2}>
                    <button type="button" className="v1-group-toggle" aria-expanded={bomOpen.has(step)} onClick={() => toggleBom(step)} data-bom-toggle={step}>
                      <ChevronRight size={16} strokeWidth={2.5} className="v1-caret" aria-hidden="true" />
                      {BOM_STEP_LABEL[step]}
                      <span className="v1-meta">{rows.length === 1 ? "1 line" : `${rows.length} lines`}</span>
                    </button>
                  </td>
                  <td className="v1-hide-s" />
                  <td className="v1-r v1-nums v1-strong">{money(rows.reduce((a, l) => a + l.cost, 0), true)}</td>
                </tr>
                {bomOpen.has(step)
                  ? rows.map((l) => (
                      <tr key={l.id}>
                        <td className="v1-r v1-nums">
                          {l.qty.toLocaleString("en-US")} <span className="v1-unit">{l.unit}</span>
                        </td>
                        <td>
                          <div className="v1-line-name">
                            {l.label}
                            {l.byClient ? <span className="v1-stamp">By the client</span> : null}
                          </div>
                          {l.note ? <div className="v1-line-desc">{l.note}</div> : null}
                        </td>
                        <td className="v1-r v1-nums v1-hide-s">
                          {l.byClient ? "—" : money(l.unitPrice, true)}
                          {l.source === "store" && !l.byClient ? (
                            <span className="v1-src" title={`${STORE_SURVEY.label} — set yours under Your prices`} data-price-source="store">
                              {STORE_SURVEY.short}
                            </span>
                          ) : l.source !== "book" && !l.byClient ? (
                            <span className="v1-src" title="An example price — set yours under Your prices" data-price-source="example">
                              ex
                            </span>
                          ) : null}
                        </td>
                        <td className="v1-r v1-nums">{l.byClient ? "TBD" : money(l.cost, true)}</td>
                      </tr>
                    ))
                  : null}
              </tbody>
            ))}
          </table>
        </div>
        <More title="Not on the list? Add your own" now={design.extras.items.length ? `${design.extras.items.length} of ${CUSTOM_LIMITS.items}` : "Nothing added"} open={design.extras.items.length > 0} id="own-items">
          <div data-deck-own-items>
            {design.extras.items.map((it) => (
              <div key={it.id} className="v1-own-row" data-deck-own={it.id}>
                <Field label="Item">
                  <NameInput label="Item name" value={it.name} onCommit={(name) => setOwnItem(it.id, { name })} />
                </Field>
                <Field label="Qty">
                  <NumberInput label={`${it.name}: quantity`} value={it.qty} parse={priceText} format={priceShow} min={CUSTOM_LIMITS.qty.min} max={CUSTOM_LIMITS.qty.max} onCommit={(qty) => setOwnItem(it.id, { qty })} />
                </Field>
                <Field label="Unit">
                  <select className="v1-sel" value={it.unit} onChange={(e) => setOwnItem(it.id, { unit: e.target.value as OwnUnit })} aria-label={`${it.name}: unit`}>
                    {OWN_UNITS.map((u) => (
                      <option key={u} value={u}>{u}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Price" aside={`$/${it.unit}`}>
                  <NumberInput label={`${it.name}: price per ${it.unit}`} value={it.price} parse={priceText} format={priceShow} min={CUSTOM_LIMITS.price.min} max={CUSTOM_LIMITS.price.max} onCommit={(price) => setOwnItem(it.id, { price })} />
                </Field>
                <button type="button" className="v1-icon-btn v1-icon-danger" onClick={() => setOwnItems((list) => list.filter((x) => x.id !== it.id))} aria-label={`Remove ${it.name}`}>
                  <X size={16} strokeWidth={2.5} aria-hidden="true" />
                </button>
              </div>
            ))}
            {design.extras.items.length < CUSTOM_LIMITS.items ? (
              <form
                className="v1-own-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  addOwnItem();
                }}
                data-deck-own-new
              >
                <Field label="Item">
                  <input className="v1-in" placeholder="A brand or a part" maxLength={CUSTOM_LIMITS.name} value={ownDraft.name} onChange={(e) => setOwnDraft((d) => ({ ...d, name: e.target.value }))} />
                </Field>
                <Field label="Qty">
                  <input className="v1-in v1-num" inputMode="decimal" value={ownDraft.qty} onChange={(e) => setOwnDraft((d) => ({ ...d, qty: e.target.value }))} />
                </Field>
                <Field label="Unit">
                  <select className="v1-sel" value={ownDraft.unit} onChange={(e) => setOwnDraft((d) => ({ ...d, unit: e.target.value as OwnUnit }))}>
                    {OWN_UNITS.map((u) => (
                      <option key={u} value={u}>{u}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Price" aside={`$/${ownDraft.unit}`}>
                  <input className="v1-in v1-num" inputMode="decimal" placeholder="0.00" value={ownDraft.price} onChange={(e) => setOwnDraft((d) => ({ ...d, price: e.target.value }))} />
                </Field>
                <button type="submit" className="v1-btn v1-btn-sm" disabled={!ownDraft.name.trim()}>
                  <Plus size={15} strokeWidth={2.5} aria-hidden="true" /> Add
                </button>
              </form>
            ) : null}
            <p className="v1-hint">Goes on the material list under Your own items and into the price as typed.</p>
          </div>
        </More>
      </section>

      <More title="Your prices" now={saving === "saved" && !unsaved ? "Saved" : unsaved ? "Changed — not saved" : `${Object.keys(book).length} set · the rest are examples for ${market.label}`} id="rates">
        <div className="v1-rates-head" id="deck-rates">
          <p className="v1-hint">
            Every default is an example, scaled to {market.label}. Type your own and save: your number is charged as typed on every deck from then on. Blank goes back to the example. The same book is on the{" "}
            <Link href={"/dashboard/deck-estimator/inventory" as Route}>deck inventory page</Link>.
          </p>
          <div className="v1-row-acts">
            {saving === "failed" ? <span className="v1-stamp is-bad">Not saved</span> : null}
            <button type="button" className="v1-btn v1-btn-sm" disabled={!unsaved || saving === "saving"} onClick={saveBook}>
              {saving === "saving" ? "Saving…" : "Save my prices"}
            </button>
          </div>
        </div>
        <RateGroups drafts={drafts2} draftBook={draftBook} market={market} setDrafts={setDrafts2} />
      </More>
    </>
  );

  const stepBody: Record<StepId, () => React.ReactNode> = { size: sizeStep, kind: kindStep, house: houseStep, materials: materialsStep, stairs: stairsStep, roof: roofStep, extras: extrasStep, checks: checksStep, package: packageStep };

  /* ── Talk to Deck Studio: what the panel may do, through the studio's own doors ── */
  const voiceEnv = React.useMemo(() => ({ rates: book, market, homeState }), [book, market, homeState]);
  const permitLink = () => {
    if (savedRef) return `/deck-permit?${savedRef}`;
    try {
      return `/deck-permit?d=${encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify({ design, address })))))}`;
    } catch {
      return null;
    }
  };
  /** The fields a spoken change set, glowing where they sit (a closed disclosure opened), the form glided to the first. */
  const flashFields = (fields: Flash[], priceChanged: boolean) => {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const root = studioRef.current;
        if (!root) return;
        const hits: HTMLElement[] = [];
        for (const f of fields) {
          const scope = f.section ? root.querySelector<HTMLElement>(`[data-deck-section="${f.section === "house" ? "size" : f.section}"]`) : root.querySelector<HTMLElement>(".v1-q-scroll");
          const el = scope ? findField(scope, f.label) : null;
          if (el && !hits.includes(el)) hits.push(el);
        }
        const fieldsHit = hits.length;
        if (priceChanged) {
          const price = root.querySelector<HTMLElement>("[data-v1-price]");
          if (price) hits.push(price);
        }
        for (const el of hits) {
          const box = el.closest("details");
          if (box && !box.open) box.open = true;
          el.classList.remove("v1-voice-flash");
          void el.offsetWidth;
          el.classList.add("v1-voice-flash");
          window.setTimeout(() => el.classList.remove("v1-voice-flash"), 2300);
        }
        if (fieldsHit && !fullView && window.matchMedia("(min-width: 769px)").matches) glideRef.current?.(hits[0]);
      }),
    );
  };
  const voiceHost: DeckVoiceHost = {
    design,
    readOnly: viewOnly,
    env: voiceEnv,
    apply: (next, keys) => {
      for (const k of keys) touched.current.add(k);
      dirty.current = true;
      setDesign(next);
    },
    view: (v) => {
      if (v.tab) setView(v.tab);
      if (v.xray !== undefined) setXray(v.xray);
      if (v.night !== undefined) setNight(v.night);
      if (v.connections !== undefined) setConnections(v.connections);
      if (v.full !== undefined) setFullView(v.full);
      if (v.edit !== undefined) setEditing(v.edit);
      if (v.build === "play") play();
      else if (v.build === "stop") setPlaying(false);
      else if (v.build === "done") {
        setPlaying(false);
        setBuilt(Number.POSITIVE_INFINITY);
      }
      if (v.reset) {
        setResetToken((t) => t + 1);
        setPicked(null);
        setZoomedAt(null);
      }
      const from = v.look;
      if (from) setLook((l) => ({ token: (l?.token ?? 0) + 1, from }));
    },
    light: (f, flyThere) => {
      setVoiceFocus(f);
      if (f && flyThere) {
        const lit = fieldLight(scene, structure, f);
        // Framed wide enough to see the part in the deck around it, not a close-up of one board.
        if (lit?.tag) setFocus([lit.tag.x, lit.tag.y, Math.max(0.5, lit.tag.z - 1.4), 9]);
      }
    },
    fly: (p) => setFocus([p[0], p[1], p[2], 11]),
    flash: flashFields,
    link: (what) => {
      if (preview && !viewOnly) {
        askAddon(what === "permit" ? "Print the permit set with Deck Studio" : "Print the material lists with Deck Studio");
        return null;
      }
      return what === "permit" ? permitLink() : materialsHref(what);
    },
    go: (step) => go(step),
    name: (title) => {
      dirty.current = true;
      setDraftTitle(title);
    },
    address: (text) => {
      setAddressDraft(text);
      commitAddress(text);
    },
    save: () => void convert(),
    reset: () => startFresh(),
  };

  const viewTabs: Array<{ value: V1View; label: string }> = [
    { value: "3d", label: "3D" },
    { value: "plan", label: "Framing plan" },
    { value: "wall", label: "House & deck" },
    ...(PHOTO_ENABLED ? [{ value: "photo" as const, label: "Photo" }] : []),
  ];

  return (
    <div className={cx("jf-deck-v1", fullView && "is-full-view")} ref={studioRef} data-nest>
      <header className="v1-top">
        <div className="v1-title-row">
          <h1 className="v1-title">Deck Studio</h1>
          <div className="v1-job-side">
            {saveState === "failed" ? <span className="v1-save-error" role="alert">Could not save</span> : null}
            <div className="v1-pop-wrap">
              <button
                type="button"
                className={cx("v1-btn", "v1-drafts-btn", draftsOpen && "is-on")}
                aria-expanded={draftsOpen}
                onClick={() => {
                  setDraftsOpen((v) => !v);
                  if (!draftsOpen) void refreshDrafts();
                }}
                data-deck-drafts
              >
                <FileText size={16} aria-hidden="true" /> Drafts <ChevronDown size={15} strokeWidth={2.5} aria-hidden="true" />
              </button>
              {draftsOpen ? (
                <div className="v1-pop" role="dialog" aria-label="Drafts">
                  <div className="v1-pop-head">
                    <span className="v1-h4">Drafts</span>
                    <button type="button" className="v1-btn v1-btn-sm" onClick={startFresh}>
                      <Plus size={15} strokeWidth={2.5} aria-hidden="true" /> New deck
                    </button>
                  </div>
                  {drafts === null ? <p className="v1-meta">Reading…</p> : drafts.length === 0 ? <p className="v1-meta">No saved drafts yet. This one appears a moment after your first change.</p> : null}
                  {(drafts ?? []).map((d) => (
                    <div key={d.id} className="v1-pop-row" data-deck-draft={d.id}>
                      <div className="v1-pop-text">
                        <span className="v1-send-name">
                          {d.title}
                          {d.id === draftId ? " · open" : ""}
                        </span>
                        <span className="v1-meta">
                          {ago(d.updatedAt)}
                          {d.fromClient ? ` · from ${d.fromClient}` : ""}
                          {d.proposalId ? " · changes to a saved proposal" : ""}
                          {d.address ? ` · ${d.address}` : ""}
                          {d.by && !d.fromClient ? ` · ${d.by}` : ""}
                        </span>
                      </div>
                      <button type="button" className="v1-btn v1-btn-sm" onClick={() => void openDraft(d.id)} disabled={d.id === draftId}>
                        Open
                      </button>
                      {preview ? null : (
                        <button type="button" className="v1-icon-btn v1-icon-danger" onClick={() => void removeDraft(d.id)} aria-label={`Delete the draft ${d.title}`}>
                          <X size={16} strokeWidth={2.5} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>
        <form className="v1-job-addr" aria-label="Job address" onSubmit={(event) => {
          event.preventDefault();
          if (addressDraft.trim() !== address) commitAddress(addressDraft);
        }}>
          <label className="v1-field"><span className="v1-lbl">Job address</span><input className="v1-in" value={addressDraft} readOnly={viewOnly} placeholder="Street, city, state ZIP" autoComplete="street-address" onChange={(event) => setAddressDraft(event.target.value)} onBlur={() => { if (addressDraft.trim() !== address) commitAddress(addressDraft); }} /></label>
          {/* 2026-10-21: what the address drives, said where it is typed (the permit set's site plan starts from it). */}
          <p className="v1-hint" data-deck-address-hint>The address sets the state&apos;s and the county&apos;s codes, and the lot on the permit set&apos;s site plan — where you also say which side of the house the deck is on.</p>
        </form>
        {preview ? (
          <DeckPreviewBanner mode="preview" saved={viewOnly} interval={addonInterval} onAdd={() => askAddon(viewOnly ? "Change saved decks with Deck Studio" : "Add Deck Studio to your plan")}>
            {viewOnly ? (
              <>
                {permitHref ? <a href={permitHref} target="_blank" rel="noopener" data-deck-saved-print="permit">Permit &amp; build set</a> : null}
                {yardHref ? <a href={yardHref} target="_blank" rel="noopener" data-deck-saved-print="yard">List for the lumber yard</a> : null}
                {installerHref ? <a href={installerHref} target="_blank" rel="noopener" data-deck-saved-print="installer">For the installer</a> : null}
              </>
            ) : null}
          </DeckPreviewBanner>
        ) : trialEndsAt !== null ? (
          <DeckPreviewBanner mode="trial" trialEndsAt={trialEndsAt || null} interval={addonInterval} />
        ) : null}
      </header>

      {inboxNew.length ? (
        <section className="v1-band v1-band-new" aria-live="polite" aria-label="Designs sent back by clients" data-deck-inbox={inboxNew.length}>
          {inboxNew.slice(0, 3).map((l) => (
            <div key={l.token} className="v1-band-row" data-deck-inbox-row={l.token}>
              <div className="v1-band-text">
                <b>{l.clientName}</b> sent back a deck design{l.sentAt ? ` · ${ago(l.sentAt)}` : ""} <span className="v1-meta">for {jobLine(l)}</span>
                {l.words && (l.proposal || l.words !== l.title) ? <span className="v1-meta"> · {l.words}</span> : null}
                {l.note ? <span className="v1-band-note">“{l.note.length > 120 ? `${l.note.slice(0, 120)}…` : l.note}”</span> : null}
              </div>
              <div className="v1-row-acts">
                {l.draftId ? (
                  <Link className="v1-btn v1-btn-sm" href={`/dashboard/deck-estimator?draft=${l.draftId}` as Route} data-deck-inbox-open>
                    Open it
                  </Link>
                ) : null}
                <button type="button" className="v1-btn v1-btn-sm v1-btn-quiet" onClick={() => putAside(l)} aria-label={`Put ${l.clientName}'s design aside until they send again`}>
                  Later
                </button>
              </div>
            </div>
          ))}
          {inboxNew.length > 3 ? <p className="v1-meta">and {inboxNew.length - 3} more under Send to client</p> : null}
        </section>
      ) : null}

      {fromClient ? (
        <section className="v1-band" aria-label="What the client sent" data-deck-from-client>
          <div className="v1-band-text">
            <b>{fromClient.name}&apos;s design</b>
            {fromClient.sends > 1 ? ` · sent ${fromClient.sends} times` : ""}
            {fromClient.sentAt ? ` · ${ago(fromClient.sentAt)}` : ""}
            {!linked ? <span className="v1-meta"> · {fromClient.title}{fromClient.address ? ` · ${fromClient.address}` : ""}</span> : null}
            <span className="v1-band-note">
              {fromClient.note ? <>“{fromClient.note}” </> : <>No note with it. </>}
              {fromClient.unsure.includes("height") ? <b>Not sure of the height — measure it on site. </b> : null}
              {linked ? "Price it, then update the proposal." : "Price it, then make the proposal — the client's link follows it."}
            </span>
          </div>
          <div className="v1-row-acts">
            {fromClient.phone ? (
              <a className="v1-btn v1-btn-sm" href={`tel:${fromClient.phone}`}>
                Call {fromClient.name.split(/\s+/)[0]}
              </a>
            ) : null}
            <a className="v1-btn v1-btn-sm v1-btn-quiet" href={fromClient.url} target="_blank" rel="noopener">
              Their page <ExternalLink size={14} aria-hidden="true" />
            </a>
          </div>
        </section>
      ) : null}

      {linked ? (
        <section className="v1-band" aria-label="The proposal this design is on" data-deck-linked={linked.lock ? "locked" : behind ? "behind" : "even"}>
          <div className="v1-band-text">
            <b>{linked.ref}</b> {linked.title}{" "}
            <span className={cx("v1-stamp", linked.lock ? "is-warn" : linked.seen ? "is-info" : "is-pass")} data-deck-linked-status>
              {PROPOSAL_STATUS_WORDS[linked.status] ?? linked.status}
            </span>
            <span className="v1-band-note">
              {linked.lock
                ? `This proposal is ${DECK_LOCK_WORDS[linked.lock]}, so its price stays as it is — a new design goes on a new proposal.`
                : behind
                  ? updated
                    ? "Changed since the last update — the proposal still has the earlier design."
                    : "Your changes save here as a draft. The proposal keeps its price until you update it."
                  : updated
                    ? `Updated ${ago(updated.at)} — the proposal has this design.${updatedWords ? ` ${updatedWords}` : ""}`
                    : "The proposal has this design. Change it here, then update the proposal."}
            </span>
          </div>
          <div className="v1-row-acts">
            <Link className="v1-btn v1-btn-sm" href={`/dashboard/manual-blueprint?proposal=${encodeURIComponent(linked.id)}` as Route} data-deck-linked-back>
              Back to the proposal
            </Link>
            {!linked.lock && behind ? (
              <button type="button" className="v1-btn v1-btn-sm" disabled={!!busy} onClick={() => askUpdate("top")} data-deck-update="top">
                {busy === "update" ? "Updating…" : "Update the proposal"}
              </button>
            ) : null}
          </div>
          {confirmAt === "top" ? confirmBox : null}
          {error && actAt === "top" ? <p className="v1-call v1-call-bad" role="alert">{error}</p> : null}
        </section>
      ) : null}

      {resume && !draftId ? (
        <div className="v1-resume" role="status" data-deck-resume={resume.id}>
          <span className="v1-resume-text">
            <b>Pick up where you left off?</b> {resume.title}
            {resume.address ? ` · ${resume.address}` : ""} · {ago(resume.updatedAt)}
            {resume.fromClient ? ` · from ${resume.fromClient}` : ""}
          </span>
          <span className="v1-resume-acts">
            <button type="button" className="v1-btn v1-btn-primary v1-btn-sm" onClick={() => { setResume(null); void openDraft(resume.id); }} data-deck-resume-open>
              Continue
            </button>
            <button type="button" className="v1-btn v1-btn-sm" onClick={dismissResume} data-deck-resume-dismiss>
              Start fresh
            </button>
          </span>
        </div>
      ) : null}
      <div className="v1-work">
        <FieldScope.Provider value={rootScope}>
          <div className="v1-q" role="region" aria-label="Design the deck">
            <div className="v1-q-scroll" ref={qScrollRef}>
              {stepList.map((section, index) => (
                <section className="v1-form-section" key={section.id} data-deck-section={section.id} data-tour={`deck-${section.id}`} aria-labelledby={`v1-section-${section.id}`}>
                  <div className="v1-form-heading"><span className="v1-section-number" aria-hidden="true">{index + 1}</span><h2 className="v1-question" id={`v1-section-${section.id}`} tabIndex={-1}>{section.question}</h2></div>
                  <Scope step={scopeOf(section.id)}>
                    {/* A saved deck in the preview: shown as answered, not to be changed; its print links are in the band above. */}
                    <div className="v1-q-body" inert={viewOnly} data-v1-view-only={viewOnly || undefined}>{stepBody[section.id]()}</div>
                    {section.id === "size" ? <Scope step={scopeOf("house")}><h3 className="v1-h3">{withDeck ? "House & ground" : "Ground"}</h3><div className="v1-q-body" inert={viewOnly} data-v1-view-only={viewOnly || undefined}>{houseStep()}</div>{stepChecks("house")}</Scope> : null}
                    {section.id !== "checks" && section.id !== "package" ? stepChecks(section.id) : null}
                  </Scope>
                </section>
              ))}
            </div>
            <footer className="v1-q-foot" data-tour="deck-price">
              <span className="v1-foot-sum">
                <span className="v1-foot-price" aria-label="Deck price before tax" aria-live="polite" data-v1-price>{money(pkg.subtotal)}</span>
                <span className="v1-foot-note" aria-hidden="true">before tax</span>
              </span>
              {/* The proposal from anywhere in the form (owner, 2026-10-19: "add second button save as proposal"); a
                  failure glides to the package section, where its error is shown. */}
              <button type="button" className="v1-btn v1-foot-save" disabled={!!busy} onClick={async () => { if (!(await convert())) go("package"); }} data-v1-foot-convert>
                {preview ? <Lock size={15} strokeWidth={2.5} aria-hidden="true" /> : <FileText size={16} strokeWidth={2.5} aria-hidden="true" />}
                {busy === "convert" ? "Saving…" : linked ? "Save as new proposal" : "Save as proposal"}
              </button>
              <button type="button" className="v1-btn v1-btn-primary" onClick={() => go("package")}>
                Package &amp; price <ChevronRight size={16} aria-hidden="true" />
              </button>
            </footer>
          </div>
        </FieldScope.Provider>

        {/* ── the structure, pinned ── */}
        <aside className={cx("v1-stage", !fullView && "is-docked", fullView && "is-full")} ref={viewerRef} aria-label={`The ${what.toLowerCase()}`} data-deck-viewer>
          <div className="v1-viewer">
            <div className="v1-view-head">
              <h2 className="v1-h3 v1-view-title">The {what.toLowerCase()}</h2>
              <div className="v1-view-acts">
                {/* The design to the client, in sight from the first step (owner, 2026-10-22: "I don't see the option to send
                    the design to the client") — with the count of designs that came back. The panel opens at the finish. */}
                <button type="button" className={cx("v1-btn", "v1-btn-sm", "v1-dock-btn", "v1-send-btn", sendOpen && "is-on")} onClick={openSend} aria-label={inbox.length ? `Send to client — ${inbox.length} came back` : "Send to client"} data-v1-view-send data-tour="deck:send">
                  {preview ? <Lock size={14} strokeWidth={2.5} aria-hidden="true" /> : <Send size={16} aria-hidden="true" />}
                  <span aria-hidden="true">
                    Send<span className="v1-hide-s"> to client</span>
                  </span>
                  {inbox.length ? <span className="v1-count" aria-hidden="true">{inbox.length}</span> : null}
                </button>
                <button type="button" className="v1-btn v1-btn-sm v1-dock-btn" onClick={openPermit} aria-label="Permit plans — the drawings for the county, in a new tab" data-deck-permit-head>
                  {preview && !viewOnly ? <Lock size={14} strokeWidth={2.5} aria-hidden="true" /> : <FileText size={16} aria-hidden="true" />}
                  <span className="v1-hide-s" aria-hidden="true">
                    Permit plans
                  </span>
                </button>
                <button type="button" className={cx("v1-btn", "v1-btn-sm", "v1-dock-btn", "v1-talk-btn", voiceOpen && "is-on")} aria-pressed={voiceOpen} onClick={() => openVoice(!voiceOpen)} data-deck-talk>
                  <Mic size={16} aria-hidden="true" /> Talk
                </button>
                <button type="button" className="v1-btn v1-btn-sm v1-dock-btn" aria-pressed={fullView} aria-label={fullView ? "Exit full view" : "Full view"} onClick={() => setFullView((f) => !f)} data-deck-dock>
                  {fullView ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}
                  {/* On a phone the expand arrows alone (2026-10-22): the header keeps room for Send to client and Talk. */}
                  <span className="v1-hide-s" aria-hidden="true">{fullView ? "Exit full view" : "Full view"}</span>
                </button>
              </div>
              <span className="v1-meta v1-view-facts" title={scene.facts}>{scene.facts}</span>
              <Seg label="View" value={view} onChange={setView} options={viewTabs} />
            </div>
            <div className={cx("v1-view-box", view === "wall" && "is-wall")}>
              {view === "wall" ? (
                <div className="v1-wall-large" onPointerDownCapture={quiet} data-deck-wall-large-view>
                  <HouseWallPlan size="large" shape={design.shape} house={design.house} onChange={(n2) => patch({ ...(n2.shape ? { shape: n2.shape } : {}), ...(n2.house ? { house: n2.house } : {}) })} />
                </div>
              ) : view === "3d" ? (
                <>
                  <Lit3D hover={hover} structure={structure} focusLit={focusLit} wallLit={wallLit} voiceLit={voiceLit} look={look} viewControls="top-right" scene={scene} built={built} xray={xray} backdrop={ph.backdrop} night={night} connections={connections} placing={placing?.kind === "fixture" || placing?.kind === "stair"} edit={editing} onEdit={onEditStable} resetToken={resetToken} focus={focus} onPick={onPickStable} className="v1-canvas" label={`The ${what.toLowerCase()} in 3D: ${scene.facts}`} />
                  {hoverPick?.legend && !placing ? (
                    <div className="v1-tag" data-deck-hover>
                      <b>
                        {hoverPick.legend.role}
                        {hoverPick.legend.nominal ? ` · ${hoverPick.legend.nominal}` : ""}
                        {hoverPick.legend.lengthFt ? ` · ${ftIn(hoverPick.legend.lengthFt * 12)}` : ""}
                      </b>
                      <span>{hoverPick.legend.note.split(/(?<=\.)\s/)[0]}</span>
                    </div>
                  ) : null}
                  {placing?.kind === "stair" ? (
                    <div className="v1-banner" data-deck-placing="stair-3d">
                      <span>Click the deck where the stairs go — they take the nearest open edge.</span>
                      <button type="button" className="v1-btn v1-btn-sm" onClick={() => setPlacing(null)}>
                        Cancel
                      </button>
                    </div>
                  ) : null}
                  {placingFixture ? (
                    <div className="v1-banner" data-deck-placing="fixture">
                      <span>Click where the {FIXTURE_SHORT[placingFixture.kind].toLowerCase()} goes — a post, a header, the rail, the ceiling, the house wall.</span>
                      <button type="button" className="v1-btn v1-btn-sm" onClick={() => setPlacing(null)}>
                        Cancel
                      </button>
                    </div>
                  ) : null}
                </>
              ) : view === "photo" ? (
                <PhotoViewBox ph={ph} design={design} patch={patch} what={what} />
              ) : (
                <div className="v1-plan-wrap">
                  <DeckPlan structure={structure} placing={placing?.kind === "stair" ? "stair" : null} onPlaceStair={placeStair} />
                  {placing?.kind === "stair" ? (
                    <div className="v1-banner" data-deck-placing="stair">
                      <span>Click an open edge of the deck where the stairs go.</span>
                      <button type="button" className="v1-btn v1-btn-sm" onClick={() => setPlacing(null)}>
                        Cancel
                      </button>
                    </div>
                  ) : null}
                </div>
              )}
              {/* Talk to Deck Studio: the panel over the picture, or its round mic when closed. */}
              {voiceOpen ? (
                <DeckVoice host={voiceHost} onClose={() => setVoiceOpen(false)} />
              ) : !editing && !placing ? (
                <button type="button" className="dv-fab" onClick={() => openVoice(true)} aria-label="Talk to Deck Studio" data-deck-talk-fab>
                  <Mic size={18} aria-hidden="true" /> Talk
                </button>
              ) : null}
            </div>
            {view === "3d" ? (
              <div className="v1-tools">
                <div className="v1-tools-primary">
                  <button type="button" className={cx("v1-btn", "v1-btn-primary", "v1-edit3d", editing && "is-on")} aria-pressed={editing} onClick={() => { setEditing((x) => !x); setHoverPick(null); }} data-deck-edit>
                    {editing ? <><Check size={16} strokeWidth={2.5} aria-hidden="true" /> Done</> : "Edit in 3D"}
                  </button>
                  {structure.frame && !editing ? (
                    <button type="button" className={cx("v1-btn", placing?.kind === "stair" && "is-on")} aria-pressed={placing?.kind === "stair"} disabled={design.stairs.length >= STAIR_LIMITS.count} onClick={() => setPlacing(placing?.kind === "stair" ? null : { kind: "stair" })} data-deck-3d-add-stair>
                      {placing?.kind === "stair" ? "Click the deck…" : "Add stairs"}
                    </button>
                  ) : null}
                </div>
                {/* The edit hint sits in the tool row, not over the scene, so it never hides a knob. */}
                {editing && !placing ? (
                  <p className="v1-edit-hint" data-deck-editing>
                    <span className="v1-edit-hint-knob" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 12h16M8 7.5 3.5 12 8 16.5M16 7.5l4.5 4.5-4.5 4.5" /></svg></span>
                    <span>Drag a knob the way its arrow points. The price follows.</span>
                  </p>
                ) : null}
                <div className="v1-playback" hidden={editing && !placing}>
                  <button type="button" className={cx("v1-btn", "v1-btn-sm", playing && "is-on")} onClick={() => (playing ? setPlaying(false) : play())}>
                    {playing ? "Pause" : "Build it"}
                  </button>
                  <label className="v1-build">
                    <span className="v1-meta">{layerNow}</span>
                    <input
                      type="range"
                      min={0}
                      max={LAYERS}
                      step={0.01}
                      value={sliderValue}
                      aria-label="How much is standing"
                      onChange={(e) => {
                        setPlaying(false);
                        setBuilt(Number(e.target.value));
                      }}
                    />
                  </label>
                </div>
                {/* The view buttons, always in sight (owner, 2026-10-21: "keep all those buttons… with no foldable"). */}
                <div className="v1-tools-quiet" data-deck-view-tools>
                  <button type="button" className={cx("v1-btn", "v1-btn-sm", "v1-btn-quiet", xray && "is-on")} aria-pressed={xray} onClick={() => setXray((x) => !x)}>
                    X-ray
                  </button>
                  {PHOTO_ENABLED && design.photo?.placed ? (
                    <button type="button" className={cx("v1-btn", "v1-btn-sm", "v1-btn-quiet", ph.showHouse && "is-on")} aria-pressed={ph.showHouse} onClick={() => ph.setShowHouse((v) => !v)} data-deck-house-toggle>
                      House photo
                    </button>
                  ) : null}
                  <button type="button" className={cx("v1-btn", "v1-btn-sm", "v1-btn-quiet", connections && "is-on")} aria-pressed={connections} onClick={() => setConnections((c) => !c)} data-deck-connections>
                    Connections
                  </button>
                  <button type="button" className={cx("v1-btn", "v1-btn-sm", "v1-btn-quiet", night && "is-on")} aria-pressed={night} onClick={() => setNight((x) => !x)} data-deck-night>
                    Night
                  </button>
                  <button
                    type="button"
                    className="v1-btn v1-btn-sm v1-btn-quiet"
                    onClick={() => {
                      setResetToken((t) => t + 1);
                      setPicked(null);
                      setZoomedAt(null);
                    }}
                  >
                    Reset view
                  </button>
                </div>
              </div>
            ) : null}
            {autoNotes.length ? (
              <p className="v1-auto" role="status" data-deck-autofix>
                Re-sized to the tables: {autoNotes.join(" · ")}.
              </p>
            ) : null}
            {view === "3d" && picked ? (
              <div className="v1-pick" data-deck-picked>
                <div className="v1-pick-head">
                  <b>{picked.legend.role}</b>
                  <span className="v1-meta">
                    {picked.legend.nominal}
                    {picked.legend.lengthFt ? ` · ${ftIn(picked.legend.lengthFt * 12)}` : ""}
                    {picked.legend.count > 1 ? ` · ${picked.legend.count} of them` : ""}
                  </span>
                </div>
                <p className="v1-pick-body">{picked.legend.note}</p>
                <div className="v1-row-acts">
                  {zoomedAt === picked.point.join(",") ? (
                    <button type="button" className="v1-btn v1-btn-sm" onClick={() => { setResetToken((t) => t + 1); setZoomedAt(null); }} data-deck-zoom="out">
                      <ZoomOut size={16} strokeWidth={2.5} aria-hidden="true" /> Zoom out
                    </button>
                  ) : (
                    <button type="button" className="v1-btn v1-btn-sm" onClick={() => { setFocus([...picked.point] as [number, number, number]); setZoomedAt(picked.point.join(",")); }} data-deck-zoom="in">
                      <ZoomIn size={16} strokeWidth={2.5} aria-hidden="true" /> Zoom in
                    </button>
                  )}
                  <button type="button" className="v1-btn v1-btn-sm v1-btn-quiet" onClick={() => setPicked(null)}>
                    Close
                  </button>
                </div>
              </div>
            ) : view === "3d" && connections ? (
              <p className="v1-pick v1-pick-body">Numbered tags mark the connections: click one to read how it is made and fly to it. Click any part to name it.</p>
            ) : null}
            {view === "photo" ? <PhotoTools ph={ph} design={design} patch={patch} /> : null}
            <PhotoFileInput inputRef={ph.setFileInput} onFile={ph.onPhotoFile} />
          </div>
        </aside>
      </div>
      <DeckAddonDialog open={addonAsk !== null} why={addonAsk} onClose={() => setAddonAsk(null)} />
      <HousePhotoReview hp={hp} design={design} />
    </div>
  );
}

/** The shop's own prices, every row of the rate book with its example (≈185 rows): re-rendered only when a price is typed
 *  or the market changes, not with every change to the deck (2026-10-18, perf; the markup is the studio's own, moved). */
const RateGroups = React.memo(function RateGroups({ drafts, draftBook, market, setDrafts }: { drafts: Record<string, string>; draftBook: DeckRateBook; market: MarketSnapshot; setDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>> }) {
  return (
    <>
      {(Object.keys(DECK_RATE_GROUP_LABEL) as DeckRateGroup[]).map((group) => (
        <details key={group} className="v1-rate-group">
          <summary>
            <span>{DECK_RATE_GROUP_LABEL[group]}</span>
            <span className="v1-meta">{DECK_RATES.filter((rt) => rt.group === group && draftBook[rt.key] !== undefined).length || "none"} set</span>
          </summary>
          <div className="v1-rate-rows">
            {DECK_RATES.filter((rt) => rt.group === group).map((rt) => {
              const example = deckRate(rt.key, undefined, market).price;
              return (
                <label key={rt.key} className="v1-rate-row">
                  <span className="v1-rate-label">{rt.label}</span>
                  <span className="v1-meta">
                    per {rt.unit}
                    {rt.basis !== "labor" && storePrice(rt.key) ? ` · ${STORE_SURVEY.short} ${STORE_SURVEY.asOf.slice(0, 7)}` : ""}
                  </span>
                  <input className="v1-in v1-num v1-rate-in" inputMode="decimal" placeholder={example.toFixed(2)} value={drafts[rt.key] ?? ""} onChange={(e) => setDrafts((d) => ({ ...d, [rt.key]: e.target.value }))} />
                </label>
              );
            })}
          </div>
        </details>
      ))}
    </>
  );
});
