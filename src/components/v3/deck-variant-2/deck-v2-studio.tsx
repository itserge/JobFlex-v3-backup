"use client";
// DECK ESTIMATOR — VARIANT 2: "THE DECK IS THE INTERFACE" (2026-10-18). One of five competing designs of the deck
// estimator (the Deck Lab, /dashboard/deck-lab); the live studio is deck-estimator-blueprint/deck-studio.tsx.
//
// The bet: no long form. The plan (or the 3D) fills the page like a drafting table and you work on the drawing —
// drag the deck's blue handles to size it, press a part (the house wall, the boards, the frame, a stair, the rail,
// the roof, a light, the height tag) and that part's settings open in ONE inspector docked at the right. Nothing is
// shown for what is not selected; with nothing selected the inspector says what to press and lists the parts with
// what each is set to now. A slim toolbar carries what is built, the three materials a contractor changes most and
// the view; a bar along the foot always shows the live price, the code-check verdict (count and the worst issue —
// pressed, the list opens in the inspector) and the actions: Material package, Save draft, Make proposal (the one
// blue primary) and Send to client.
//
// The state, the engine calls and the server actions are the live studio's (copied from deck-studio.tsx, comments'
// intent kept): every change re-frames, re-counts and re-prices in the browser (lib/deck is pure), the work saves
// itself as a draft, a proposal is made or updated in place, a client's design comes back through their link. The
// photo of the house stays out, as in the live studio (PHOTO_ENABLED = false there, owner 2026-10-11).

import * as React from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { resolveMarket, parseStateZip, type MarketSnapshot } from "@/lib/fence/market";
import { leftEndPatch } from "@/lib/deck/frontByHand";
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
  defaultDeckDesign,
  defaultFixture,
  defaultRoofDesign,
  defaultStair,
  hasDeck,
  hasRoof,
  sizeWords,
  structureWords,
  type DeckDesign,
  type Fixture,
  type FixtureKind,
  type Floor,
  type FrontKind,
  type NotchCorner,
  type Placement,
  type RoofDesign,
  type RoofKind,
  type RoofPlanShape,
  type StairDesign,
  type Structure,
  type CustomProduct,
  type CustomSlot,
  type OwnItem,
  type OwnUnit,
  normalizeDeckDesign,
  SPA_LIMITS,
} from "@/lib/deck/design";
import { priceDeck, deckNotes, deckScope } from "@/lib/deck/pricing";
import { roofWords } from "@/lib/deck/roof";
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
import { HOUSE_LIMITS, HOUSE_ROOF_LABEL, HOUSE_ROOFS, QUICK_WALLS, QUICK_WALL_LABEL, ROOF_COLOURS, SIDINGS, deckShapeForHouse, houseForShape, houseNotes, houseWords, nextJogId, quickWall, quickWallOf, stepWords, wallWords, type HouseDesign, type HouseJog, type HouseRoof, wallHighlight, type WallFocus } from "@/lib/deck/house";
import { HouseWallPlan } from "@/components/v3/deck-estimator-blueprint/house-wall-plan";
import { DeckKindPicker } from "@/components/v3/deck-estimator-blueprint/deck-kind-picker";
import type { OpenedDesign } from "@/components/v3/deck-estimator-blueprint/deck-studio";
import { DECK_LOCK_WORDS, PROPOSAL_STATUS_WORDS, type LinkedDeckProposal } from "@/lib/deck/proposalEdit";
import type { DeckSample } from "@/lib/deck/samples";
import { reportPlanLimitResult } from "@/stores/usePlanLimitStore";
import { autoFixDesign, autoFixable, resizes, roofResizes, settleDesign } from "@/lib/deck/settle";
import type { DeckEdit, DeckPick, SceneHighlight } from "@/components/estimator/deck/DeckModel3D";
import { fieldLight, type FieldFocus } from "@/lib/deck/fieldParts";
import type { PlanEdgeHit } from "@/components/v3/deck-estimator-blueprint/deck-plan";
import { nearestStairEdge } from "@/components/v3/deck-estimator-blueprint/deck-plan";
import { CUSTOM, CUSTOM_LABEL, CustomBox, Field, FieldScope, Fold, NameInput, NumberInput, Scope, Seg, Toggle, ago, cx, feetText, intText, money, parseFeet, parseInches, priceShow, priceText, type FieldScopeValue } from "./deck-v2-controls";
import { DeckV2Plan, type Part, type PartHit } from "./deck-v2-plan";
import { DeckV2ClientLinks } from "./deck-v2-client";
import "./deck-variant-2.css";

const DeckModel3D = dynamic(() => import("@/components/estimator/deck/DeckModel3D").then((m) => m.DeckModel3D), {
  ssr: false,
  loading: () => <div className="v2-wait">Setting up the 3D view…</div>,
});

/* ------------------------------------------------------------------ */
/*  Fixed lists (copied from deck-studio.tsx)                          */
/* ------------------------------------------------------------------ */

const LEVEL_LABEL: Record<DeckCheck["level"], string> = { fail: "Fix", warn: "Check", info: "Note", pass: "Pass" };
const HEIGHT_PRESETS: ReadonlyArray<{ label: string; inches: number }> = [
  { label: "Near the ground", inches: 14 },
  { label: "Two steps", inches: 24 },
  { label: "First floor", inches: 36 },
  { label: "Walk-out", inches: 96 },
  { label: "Second storey", inches: 120 },
];
const CORNER_LABEL: Record<NotchCorner, string> = { "front-left": "Front left", "front-right": "Front right", "back-left": "Back left", "back-right": "Back right" };
/** The roof shapes each structure offers. */
const KINDS_FOR: Record<Structure, RoofKind[]> = {
  deck: [],
  "covered-deck": ["shed", "gable", "hip"],
  gazebo: ["gable", "hip", "pyramid", "double-tier", "gambrel", "dutch-gable"],
  pergola: ["pergola"],
};
const EAVE_PRESETS: ReadonlyArray<{ label: string; inches: number }> = [
  { label: "8 ft", inches: 96 },
  { label: "9 ft", inches: 108 },
  { label: "10 ft", inches: 120 },
];
const PITCHES = [2, 3, 4, 5, 6, 7, 8, 9, 10, 12];
const OVERHANGS = [0, 6, 12, 16, 18, 24, 30, 36];
const FIXTURE_CHIPS: FixtureKind[] = ["led-strip", "post-cap", "step-light", "string-light", "sconce", "ceiling-light", "chandelier", "fan", "outlet", "heater", "flood"];
const FIXTURE_SHORT: Record<FixtureKind, string> = { "led-strip": "LED strip", "post-cap": "Post caps", "step-light": "Step lights", "string-light": "String lights", sconce: "Sconce", "ceiling-light": "Ceiling light", chandelier: "Chandelier", fan: "Fan", outlet: "Outlet", heater: "Heater", flood: "Security light" };
/** Good / Better / Best: the boards and the rail each tier stands on. */
const TIERS: ReadonlyArray<{ id: "good" | "better" | "best"; name: string; decking: (state: string | null) => string; rail: DeckDesign["rail"]["type"]; words: string }> = [
  { id: "good", name: "Good", decking: (st) => treatedDecking(st), rail: "treated", words: "Treated wood boards and rail." },
  { id: "better", name: "Better", decking: () => "composite-better", rail: "composite", words: "Capped composite boards, composite rail." },
  { id: "best", name: "Best", decking: () => "composite-best", rail: "aluminum", words: "Premium composite, aluminum rail." },
];

type Placing = null | { kind: "stair" } | { kind: "fixture"; id: string };
type View = "plan" | "3d" | "wall";
/** What the inspector shows: a part of the drawing, or one of the bar's lists. */
type Panel = Part | "checks" | "price" | "package" | "drafts" | "client";

/** What a 3D layer is, as a part of the inspector. */
const LAYER_PART: Record<string, Part> = {
  footing: "frame", post: "frame", beam: "frame", ledger: "frame", joist: "frame", rim: "frame", blocking: "frame", brace: "frame", hardware: "frame",
  decking: "boards", fascia: "boards", slab: "site", ground: "site", house: "house", spa: "deck",
  "roof-post": "roof", header: "roof", ridge: "roof", rafter: "roof", sheathing: "roof", roofing: "roof", trim: "roof", gutter: "roof", ceiling: "roof", wall: "roof", screen: "roof",
  stair: "stairs", rail: "rails", glass: "rails", light: "lights", wire: "lights",
};

const VIEW_KEY = "jf-deck-v2-view";
/** A new stair's or fixture's id, as the live studio makes them. */
const freshId = (prefix: string, n: number) => `${prefix}${n}-${Date.now().toString(36).slice(-3)}`;

export function DeckV2Studio({ initialBook, homeState, initialAddress, clientId, adminPreview = false, opened = null }: { initialBook: DeckRateBook; homeState: string | null; initialAddress?: string; clientId?: string; adminPreview?: boolean; opened?: OpenedDesign | null }) {
  const router = useRouter();
  const [address, setAddress] = React.useState(initialAddress ?? "");
  const [addressDraft, setAddressDraft] = React.useState(initialAddress ?? "");
  const market: MarketSnapshot = React.useMemo(() => {
    const parsed = parseStateZip(address);
    return parsed.state || parsed.zip ? resolveMarket({ address }) : resolveMarket({ state: homeState });
  }, [address, homeState]);
  const site = React.useMemo(() => siteFromAddress(address, homeState), [address, homeState]);
  const [design, setDesign] = React.useState<DeckDesign>(() => {
    // A reopened design from before the state codes takes the job's state; one that has its own keeps it.
    if (opened) {
      // A design from before the drawn house: a back notch gets its step in the wall once, here, so the two agree.
      const d0 = normalizeDeckDesign(opened.design, { state: market.state || homeState });
      const h0 = houseForShape(d0.house, d0.shape, { drop: false });
      return h0 === d0.house ? d0 : applyDeckPatch(d0, { house: h0 });
    }
    const d = defaultDeckDesign({ state: market.state || homeState, frostIn: market.frostIn });
    // The site's snow and termites go in from the start; the design load follows the snow.
    return applyDeckPatch(d, { loadPsf: site.deckLoad, frostIn: site.frostIn, site: { ...d.site, groundSnowPsf: site.groundSnowPsf, termite: site.termite } });
  });
  const [book, setBook] = React.useState<DeckRateBook>(initialBook);
  /** What the contractor chose by hand; a new address does not overwrite those. */
  const touched = React.useRef(new Set<string>());
  /** The design changed since it was opened: the auto-save starts. */
  const dirty = React.useRef(false);

  // SETTLING (owner, 2026-10-10): a size change re-runs the tables (lib/deck/settle) and applies the member-sizing
  // fixes the checks would offer, so what stands on screen is never a frame the tables refuse.
  const bookRef = React.useRef(book);
  const marketRef = React.useRef(market);
  React.useEffect(() => {
    bookRef.current = book;
    marketRef.current = market;
  }, [book, market]);
  const [autoNotes, setAutoNotes] = React.useState<string[]>([]);
  const settle = React.useCallback((next: DeckDesign): DeckDesign => {
    const settled = settleDesign(next, { rates: bookRef.current, market: marketRef.current });
    queueMicrotask(() => setAutoNotes(settled.fixes));
    return settled.design;
  }, []);
  const patch = React.useCallback(
    (p: DeckPatch, keys: string[] = []) => {
      for (const k of keys) touched.current.add(k);
      dirty.current = true;
      setDesign((d) => {
        let next = applyDeckPatch(d, p);
        // THE HOUSE AND THE DECK AGREE (lib/deck/house): a step in the wall at the deck's end notches the deck; a notch
        // picked in the deck's shape puts its step in the wall; a rectangle takes that step away.
        if (p.house) {
          const fit = deckShapeForHouse(next.shape, next.house);
          if (JSON.stringify(fit.shape) !== JSON.stringify(next.shape)) next = applyDeckPatch(next, { shape: fit.shape });
        } else if (p.shape) {
          const resized = p.shape.widthFt !== d.shape.widthFt || p.shape.depthFt !== d.shape.depthFt;
          if (resized) {
            const fit = deckShapeForHouse(next.shape, next.house);
            if (JSON.stringify(fit.shape) !== JSON.stringify(next.shape)) next = applyDeckPatch(next, { shape: fit.shape });
          } else {
            const h2 = houseForShape(next.house, next.shape);
            if (h2 !== next.house) next = applyDeckPatch(next, { house: h2 });
          }
        }
        return resizes(p) ? settle(next) : next;
      });
    },
    [settle],
  );
  const setHouse = React.useCallback((p: Partial<HouseDesign>) => patch({ house: p }), [patch]);
  /** A change to the roof: the whole roof object goes in, so nothing nested is lost. */
  const rp = React.useCallback(
    (p: Partial<RoofDesign>) => {
      dirty.current = true;
      setDesign((d) => {
        const next = applyDeckPatch(d, { roof: { ...d.roof, ...p } });
        return roofResizes(p) ? settle(next) : next;
      });
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
  /** The items of the shop's own on the material list (2026-10-12). */
  const setOwnItems = React.useCallback((fn: (list: OwnItem[]) => OwnItem[]) => {
    dirty.current = true;
    setDesign((d) => applyDeckPatch(d, { extras: { items: fn(d.extras.items) } }));
  }, []);
  const [ownDraft, setOwnDraft] = React.useState<{ name: string; qty: string; unit: OwnUnit; price: string }>({ name: "", qty: "1", unit: "ea", price: "" });
  /** The custom product picked a moment ago: its name field takes the cursor. */
  const [freshCustom, setFreshCustom] = React.useState<string | null>(null);
  /** The material package's groups that are open (they start folded, their subtotals in view). */
  const [bomOpen, setBomOpen] = React.useState<ReadonlySet<BomStep>>(() => new Set());
  const toggleBom = (step: BomStep) =>
    setBomOpen((prev) => {
      const next = new Set(prev);
      if (next.has(step)) next.delete(step);
      else next.add(step);
      return next;
    });

  const commitAddress = (text: string) => {
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
    // The state's own code (lib/deck/stateCodes): the guard's height it asks for, unless the contractor chose one.
    if (!touched.current.has("railHeight")) p.rail = { heightIn: st.code.guardIn };
    dirty.current = true;
    setDesign((d) => applyDeckPatch(d, { ...p, site: { ...d.site, groundSnowPsf: st.groundSnowPsf, termite: st.termite, state: st.state || null } }));
  };

  /** Switching what is built: a different kind of roof starts from its own defaults; deck ↔ covered deck keeps the roof as set. */
  const setStructure = (next: Structure) => {
    dirty.current = true;
    setDesign((d) => {
      const family = (st: Structure) => (st === "deck" || st === "covered-deck" ? "cover" : st);
      const roof = family(next) === family(d.structure) && d.structure !== "deck" ? d.roof : next === "covered-deck" && d.structure === "deck" && KINDS_FOR["covered-deck"].includes(d.roof.kind) ? d.roof : defaultRoofDesign(next);
      return applyDeckPatch(d, { structure: next, roof, floor: next === "deck" || next === "covered-deck" ? "deck" : d.floor });
    });
  };
  // A SAMPLE TO START FROM (owner, 2026-10-11, lib/deck/samples): laid over the contractor's own address, site, house
  // and lumber, settled to the tables like any resize; marked "In use" while the design is the one the sample made.
  const [applied, setApplied] = React.useState<{ id: string; design: DeckDesign } | null>(null);
  const applySample = (sample: DeckSample) => {
    dirty.current = true;
    let next = applyDeckPatch(design, sample.patch);
    const h2 = houseForShape(next.house, next.shape);
    if (h2 !== next.house) next = applyDeckPatch(next, { house: h2 });
    next = settle(next);
    setDesign(next);
    setApplied({ id: sample.id, design: next });
  };

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
  // THE FIELD, SHOWN IN 3D (owner, 2026-10-12): the field being typed in — or the one the pointer is over — lights its part.
  const [wallFocus, setWallFocus] = React.useState<WallFocus | null>(null);
  const [wallHover, setWallHover] = React.useState<WallFocus | null>(null);
  const [fieldFocus, setFieldFocus] = React.useState<FieldFocus | null>(null);
  const [fieldHover, setFieldHover] = React.useState<FieldFocus | null>(null);
  const rootScope = React.useMemo<FieldScopeValue>(() => {
    const same = (a: FieldFocus | null, b: FieldFocus) => !!a && JSON.stringify(a) === JSON.stringify(b);
    return {
      where: {},
      light: (f, how) => (how === "focus" ? setFieldFocus(f) : setFieldHover(f)),
      unlight: (f, how) => (how === "focus" ? setFieldFocus((x) => (same(x, f) ? null : x)) : setFieldHover((x) => (same(x, f) ? null : x))),
    };
  }, []);
  const lightsFor = (f: WallFocus) => ({
    on: (how: "focus" | "hover") => (how === "focus" ? setWallFocus(f) : setWallHover(f)),
    off: (how: "focus" | "hover") => (how === "focus" ? setWallFocus((x) => (x && JSON.stringify(x) === JSON.stringify(f) ? null : x)) : setWallHover((x) => (x && JSON.stringify(x) === JSON.stringify(f) ? null : x))),
  });
  // WORKING IN THE SHAPE IS QUIET (owner, 2026-10-12): the drawing of the wall lights nothing, and a press in it puts out
  // whatever light is still on (a box typed in a moment ago is let go of first — its number is committed on the way out).
  const quiet = (e: React.PointerEvent<HTMLElement>) => {
    const a = document.activeElement;
    if (a instanceof HTMLElement && a.matches("input, textarea, select") && !e.currentTarget.contains(a) && !a.closest("[data-deck-wall-full]")) a.blur();
    setFieldFocus(null);
    setFieldHover(null);
    setWallFocus(null);
    setWallHover(null);
  };
  const scene = React.useMemo(() => deckScene(structure), [structure]);
  const fieldLit = React.useMemo<SceneHighlight | null>(() => {
    const f = fieldFocus ?? fieldHover;
    return f ? fieldLight(scene, structure, f) : null;
  }, [fieldFocus, fieldHover, scene, structure]);
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
  const tiers = React.useMemo(() => {
    if (!withDeck) return null;
    const st = market.state || homeState;
    return TIERS.map((t) => {
      // The tier's own railing: none where none is needed and none is drawn, else the tier's.
      const railT = design.rail.type === "none" && !structure.rails.required ? "none" : t.rail;
      const variant = applyDeckPatch(design, { decking: { product: t.decking(st) }, rail: { type: railT }, custom: { decking: undefined } });
      const p = priceDeck(variant, { rates: book, market });
      return { ...t, product: t.decking(st), subtotal: p.subtotal, perSqFt: p.pricePerSqFt, current: !design.custom.decking && design.decking.product === t.decking(st) && design.rail.type === railT };
    });
  }, [design, book, market, homeState, withDeck, structure.rails.required]);

  /* ── the canvas: view, selection, the 3D's build-up, night, connections, picking ── */
  const [view, setViewRaw] = React.useState<View>("plan");
  React.useEffect(() => {
    try {
      const v = localStorage.getItem(VIEW_KEY);
      // Read once after mount (the server paints the plan); a remembered view is a per-viewer convenience.
      if (v === "3d" || v === "plan") queueMicrotask(() => setViewRaw(v));
    } catch {
      /* no storage */
    }
  }, []);
  const setView = React.useCallback((v: View) => {
    setViewRaw(v);
    try {
      if (v !== "wall") localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* no storage */
    }
  }, []);
  const [panel, setPanel] = React.useState<Panel | null>(null);
  const [panelId, setPanelId] = React.useState<string | null>(null);
  const [hoverHit, setHoverHit] = React.useState<PartHit | null>(null);
  const inspectorRef = React.useRef<HTMLElement>(null);
  const open = (p: Panel | null, id: string | null = null) => {
    setPanel(p);
    setPanelId(id);
    if (p === "drafts") {
      setDrafts(null);
      void listDeckDrafts()
        .then((res) => setDrafts(res.ok ? res.drafts : []))
        .catch(() => setDrafts([]));
    }
    // On a phone the inspector is under the drawing: bring it up.
    if (p && typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches) {
      requestAnimationFrame(() => inspectorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
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
  const [focus, setFocus] = React.useState<[number, number, number] | null>(null);
  const [placing, setPlacing] = React.useState<Placing>(null);
  /** The 3D's blue knobs: on, so the deck is sized on the drawing in the 3D too. */
  const [editing, setEditing] = React.useState(true);
  const polygon = design.roof.plan.shape === "hexagon" || design.roof.plan.shape === "octagon" || design.roof.plan.shape === "round";
  /** A handle dragged (in the plan or the 3D): the design number it stands for takes the dragged value, inside its rails. */
  const onEdit = React.useCallback(
    (e: DeckEdit) => {
      const toHalfFt = (v: number) => Math.round(v * 2) / 2;
      const toIn = (v: number) => Math.round(v);
      switch (e.kind) {
        case "width":
          patch({ shape: { ...design.shape, widthFt: Math.min(DECK_LIMITS.widthFt.max, Math.max(DECK_LIMITS.widthFt.min, toHalfFt(e.value))) } });
          break;
        case "width-left": {
          // (2026-11-14) The deck's LEFT end: the house stays put, the left part of a front in parts takes the change.
          const moved = leftEndPatch(design, e.value);
          if (moved) patch(moved);
          break;
        }
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
          // The knob sits on the far side: the near side stays put, so the stairs grow (or shrink) under the knob.
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
      const t = Math.min(1, (now - start) / (seconds * 1000));
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

  const addStairAt = (hit: PlanEdgeHit) => {
    const id = freshId("s", design.stairs.length + 1);
    setStairs((list) => [...list, { ...defaultStair(id, hit.side, hit.atFt), level: hit.level }]);
    setPlacing(null);
    open("stairs", id);
  };
  const onPick = (pick: DeckPick | null, kind: "hover" | "click") => {
    if (kind === "hover") {
      setHoverPick(pick);
      return;
    }
    if (placing?.kind === "stair") {
      // A click anywhere on the deck takes its nearest open edge (owner, 2026-10-11).
      if (!pick) return;
      const hit = nearestStairEdge(structure, pick.point[0] * 12, pick.point[1] * 12, Number.POSITIVE_INFINITY);
      if (hit) addStairAt(hit);
      return;
    }
    if (placing?.kind === "fixture") {
      if (!pick) return;
      const id = placing.id;
      setFixtures((list) => list.map((f) => (f.id === id ? { ...f, at: { x: Math.round(pick.point[0] * 12), y: Math.round(pick.point[1] * 12), z: Math.round(pick.point[2] * 12), on: pick.mount } } : f)));
      setPlacing(null);
      return;
    }
    // A part pressed in the 3D opens its settings, with its own name and note at the top of them.
    const part = pick?.layer ? LAYER_PART[pick.layer] : undefined;
    if (pick?.legend) setPicked({ legend: pick.legend, point: pick.point });
    else setPicked(null);
    if (part) open(part);
  };

  /* ── drafts: the work saves itself ── */
  const [draftId, setDraftId] = React.useState<string | null>(opened?.draftId ?? null);
  const [draftTitle, setDraftTitle] = React.useState<string>(opened ? (opened.from === "draft" && opened.title === structureWords(opened.design) ? "" : opened.title) : "");
  const [saveState, setSaveState] = React.useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [savedAt, setSavedAt] = React.useState<string | null>(null);
  const [drafts, setDrafts] = React.useState<DeckDraftRow[] | null>(null);
  // THE PROPOSAL IT WAS OPENED FROM (owner, 2026-10-12): "Update the proposal" re-prices that one rather than making a second.
  const [linked, setLinked] = React.useState<LinkedDeckProposal | null>(opened?.proposal ?? null);
  const linkedId = linked?.id ?? null;
  const designSig = React.useMemo(() => JSON.stringify([design, address]), [design, address]);
  const [proposalSig, setProposalSig] = React.useState<string | null>(() => (opened?.from === "proposal" ? designSig : null));
  const [updated, setUpdated] = React.useState<{ at: string; kept: number; titleKept: boolean; scopeKept: boolean } | null>(null);
  const [confirming, setConfirming] = React.useState(false);
  const behind = !!linked && designSig !== proposalSig;
  // THE CLIENT'S RETURN (owner, 2026-10-13): the design on screen may be one a client sent back, and the studio asks
  // every half minute for returns nobody has opened yet — those bloom until opened.
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
    setSaveState("saving");
    try {
      localStorage.setItem("jf-deck-draft", JSON.stringify({ design, address, at: Date.now() }));
    } catch {
      /* the server copy is the one that counts */
    }
    const res = await saveDeckDraft({ id: draftId, title: draftTitle || null, design, address, proposalId: linkedId, clientToken }).catch(() => ({ ok: false as const }));
    if (res.ok) {
      setDraftId(res.id);
      setSavedAt(res.updatedAt);
      setSaveState("saved");
    } else setSaveState("failed");
  }, [design, address, draftId, draftTitle, linkedId, clientToken]);
  React.useEffect(() => {
    if (!dirty.current) return;
    const t = setTimeout(() => void saveNow(), 1500);
    return () => clearTimeout(t);
  }, [saveNow]);
  const refreshDrafts = async () => {
    const res = await listDeckDrafts().catch(() => ({ ok: false as const }));
    setDrafts(res.ok ? res.drafts : []);
  };
  const openDraft = async (id: string) => {
    const res = await loadDeckDraft(id);
    if (!res.ok) return;
    dirty.current = false;
    setDesign(res.draft.design);
    setDraftId(res.draft.id);
    setDraftTitle(res.draft.title);
    setAddress(res.draft.address ?? "");
    setAddressDraft(res.draft.address ?? "");
    setSavedAt(res.draft.updatedAt);
    setSaveState("saved");
    setLinked(res.proposal);
    setProposalSig(null);
    setUpdated(null);
    setConfirming(false);
    setFromClient(res.client);
    if (res.client) setInbox((list) => list.filter((l) => l.token !== res.client?.token));
    open(null);
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
    setDesign(defaultDeckDesign({ state: market.state || homeState, frostIn: market.frostIn }));
    setDraftId(null);
    setDraftTitle("");
    setSaveState("idle");
    setSavedAt(null);
    touched.current.clear();
    setLinked(null);
    setUpdated(null);
    setConfirming(false);
    setFromClient(null);
    open(null);
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
  // Every text inside the proposal's caps (lib/deck/convertSchema): a big design never fails convert over a long sentence.
  const proposalPayload = () => ({
    title: title.slice(0, 200),
    scope: deckScope(pkg, address || null).join("\n").slice(0, 6000),
    assumptions: deckNotes(pkg).slice(0, 20).map((n) => n.slice(0, 600)),
    lines: pkg.lines.map((l) => ({ name: l.name.slice(0, 200), description: l.description?.slice(0, 400), quantity: l.quantity, unit: l.unit, materialCost: l.materialCost, laborCost: l.laborCost })),
    address: address || null,
    plan: { design, scene },
    clientToken,
  });
  const convert = async () => {
    setBusy("convert");
    setError(null);
    setConfirming(false);
    try {
      const res = await convertDeckEstimateToProposal({ ...proposalPayload(), clientId: clientId ?? null });
      if (res.ok) {
        router.push(`/dashboard/manual-blueprint?proposal=${res.id}` as Route);
        return;
      }
      if (res.code === "PLAN_LIMIT_REACHED") reportPlanLimitResult(res);
      setError(res.error);
    } catch {
      setError("The proposal could not be saved. Check the connection and try again.");
    }
    setBusy(false);
  };
  /** Re-price the proposal it was opened from with this design; the studio stays open on it. */
  const update = async () => {
    if (!linked) return;
    setBusy("update");
    setError(null);
    setConfirming(false);
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
  const askUpdate = () => {
    setError(null);
    if (linked?.seen) setConfirming(true);
    else void update();
  };
  const updatedWords = updated
    ? [
        updated.kept ? `${updated.kept === 1 ? "The line" : `The ${updated.kept} lines`} you added in the proposal stayed.` : "",
        updated.titleKept ? "Your own title stayed." : "",
        updated.scopeKept ? "Your own scope of work stayed — check it still describes this design." : "",
      ].filter(Boolean).join(" ")
    : "";
  // THE MATERIAL LIST (owner, 2026-10-11): the takeoff for the lumber yard's quote or the installer's purchase, on its own page.
  const materialsHref = React.useCallback(
    (forWhom: "yard" | "installer") => {
      try {
        const payload = btoa(unescape(encodeURIComponent(JSON.stringify({ design, address, title: draftTitle.trim() || undefined }))));
        return `/deck-materials?d=${encodeURIComponent(payload)}&for=${forWhom}`;
      } catch {
        return null;
      }
    },
    [design, address, draftTitle],
  );
  const permitHref = React.useMemo(() => {
    try {
      const payload = btoa(unescape(encodeURIComponent(JSON.stringify({ design, address }))));
      return `/deck-permit?d=${encodeURIComponent(payload)}`;
    } catch {
      return null;
    }
  }, [design, address]);

  /* ── the shop's prices ── */
  const [drafts2, setDrafts2] = React.useState<Record<string, string>>(() => Object.fromEntries(Object.entries(initialBook).map(([k, v]) => [k, String(v)])));
  const [saving, setSaving] = React.useState<"idle" | "saving" | "saved" | "failed">("idle");
  const draftBook = React.useMemo(() => sanitizeDeckRateBook(Object.fromEntries(Object.entries(drafts2).filter(([, v]) => v.trim() !== "").map(([k, v]) => [k, Number(v)]))), [drafts2]);
  const unsaved = JSON.stringify(draftBook) !== JSON.stringify(book);
  const saveBook = async () => {
    setSaving("saving");
    const res = await saveDeckRateBook(draftBook).catch(() => ({ ok: false as const, error: "" }));
    if (res.ok) {
      setBook(res.book);
      setDrafts2(Object.fromEntries(Object.entries(res.book).map(([k, v]) => [k, String(v)])));
      setSaving("saved");
    } else setSaving("failed");
  };

  const exampleShare = Math.round(pkg.exampleShare * 100);
  const r = design.roof;
  const structureSummary = `${what}${withRoof && design.structure !== "covered-deck" ? ` · ${FLOOR_LABEL[design.floor].toLowerCase()}` : ""}`;
  const shapeSummary = `${sizeWords(design)} · ${Math.round(pkg.areaSqFt)} sq ft`;
  const heightSummary = withDeck ? `${design.heightIn >= 24 ? ftIn(design.heightIn) : `${design.heightIn} in.`} high${structure.gradePct >= 2 ? ` · ${structure.gradePct}% fall` : ""} · frost ${design.frostIn} in.` : `${design.loadPsf} psf · frost ${design.frostIn} in.`;
  const houseSummary = withDeck ? `${design.placement === "attached" ? "On a ledger" : design.placement === "beside" ? "Own posts by the house" : "Free-standing"}${scene.house ? ` · ${houseWords(design.house)}` : ""}` : r.attach === "wall" ? "Hung on the house wall" : "Stands on its own";
  const frameSummary = frame ? `${frame.joistSize} @ ${frame.spacingIn}" · ${[...new Set(frame.beams.map((b) => b.spec.size))].join(", ")} ${frame.beamStyle === "flush" ? "flush" : "beam"}` : "";
  const surfaceSummary = frame ? `${frame.decking.label}${design.decking.pattern !== "straight" ? ` · ${design.decking.pattern}` : ""}${design.decking.border ? " · border" : ""}` : "";
  const roofSummary = roof ? roofWords(roof) : "";
  const railSummary = structure.rails.on ? railWords(structure.rails).split(" — ")[0] : structure.rails.required ? "None — a guard is required" : "No railing";
  const stairSummary = structure.stairs.length ? `${structure.stairs.length} ${structure.stairs.length === 1 ? "stair" : "stairs"}` : "None yet";
  const electricSummary = structure.electrical.on ? electricalWords(structure.electrical) : "None";

  const bomByStep = React.useMemo(() => {
    const out = new Map<BomStep, typeof pkg.bom>();
    for (const l of pkg.bom) out.set(l.step, [...(out.get(l.step) ?? []), l]);
    return out;
  }, [pkg]);

  // ── PRODUCTS OF THE SHOP'S OWN (2026-10-12, owner: "always an option custom"): the list's choice stays as what it is
  // built like, and the typed name and price stand in for it on the material list and the proposal.
  const setCustom = (slot: CustomSlot, p: CustomProduct | undefined) => patch({ custom: { [slot]: p } as DeckDesign["custom"] });
  const dropCustom = (slot: CustomSlot) => {
    if (design.custom[slot]) setCustom(slot, undefined);
  };
  /** What the list's choice costs now, in the slot's unit: where the shop's own product starts. */
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
  /** The list's own name for what is chosen now: typed over in a moment. */
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
    // The list's line has to be there for the shop's product to stand in for it.
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
  const speciesOptions = (
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
  );
  // THE BOARD LIST (2026-10-12): the boards most used in the job's region first, then the woods, the brands' own lines,
  // and the generic composite, PVC, mineral-based and aluminum boards — any brand. Custom closes it.
  const regional = regionalPicks(market.state || homeState);
  const boardOption = (d: DeckingProduct, key = d.id) => (
    <option key={key} value={d.id}>{d.label}</option>
  );
  const woodFamily = (fam: DeckingFamily) => fam === "treated" || fam === "softwood" || fam === "hardwood" || fam === "modified";
  const deckingOptions = (
    <>
      {regional ? (
        <optgroup label={`Most used in ${regional.name}`}>
          {regional.decking.flatMap((id) => DECKING.filter((d) => d.id === id)).map((d) => boardOption(d, `most-${d.id}`))}
        </optgroup>
      ) : null}
      {DECKING_FAMILY_ORDER.filter(woodFamily).map((fam) => (
        <optgroup key={fam} label={DECKING_FAMILY_LABEL[fam]}>
          {DECKING.filter((d) => d.family === fam && !d.brand).map((d) => boardOption(d))}
        </optgroup>
      ))}
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
    </>
  );
  const roofingOptions = ROOFINGS.filter((x) => x !== "none").map((x) => (
    <option key={x} value={x}>{ROOFING_LABEL[x]}</option>
  ));
  const fixtureOptions = FIXTURE_KINDS.map((k) => (
    <option key={k} value={k}>{FIXTURE_LABEL[k]}</option>
  ));
  const freshDone = () => setFreshCustom(null);
  const onDecking = (v: string) => (v === CUSTOM ? pickCustom("decking") : patch({ decking: { product: v }, custom: { decking: undefined } }, ["decking"]));
  const onSpecies = (v: string) => (v === CUSTOM ? pickCustom("species") : patch({ framing: { species: v as DeckDesign["framing"]["species"] }, custom: { species: undefined } }, ["species"]));
  const onRail = (v: string) => patch({ rail: { type: v as DeckDesign["rail"]["type"], infill: "auto" } });

  const ordered = [...checks].sort((a, b) => ["fail", "warn", "info", "pass"].indexOf(a.level) - ["fail", "warn", "info", "pass"].indexOf(b.level));
  const worst = ordered.find((c) => c.level === "fail") ?? ordered.find((c) => c.level === "warn") ?? null;
  /** What the folded framing choices are now, in a line. */
  const frameMoreWords = frame
    ? [
        frame.beamStyle === "flush" ? "flush beams" : "beams under the joists",
        frame.beamKind === "solid" ? "solid 4x" : "built up from 2x",
        `${ftIn(frame.zones[0]?.frontCantIn ?? 0)} past the beam`,
        design.framing.doubleRim ? "doubled rim" : "",
        design.framing.joistTape ? "joist tape" : "",
        design.framing.blocking === "mid-span" ? "mid-span blocking" : "",
        design.placement === "attached" ? `ledger: ${LEDGER_FASTENER_LABEL[design.ledger.fastener].toLowerCase()}` : "",
      ]
        .filter(Boolean)
        .join(" · ")
    : "";
  /** A check that needs the contractor: a failure, one to check, or a note with something to tap. */
  const loud = (c: DeckCheck) => c.level === "fail" || c.level === "warn" || (c.level === "info" && (!!c.fix || !!c.alts?.length));
  const checkRow = (c: DeckCheck) => (
    <li key={c.id} className={cx("v2-check", `is-${c.level}`)} data-check={c.id}>
      <span className="v2-check-level">{LEVEL_LABEL[c.level]}</span>
      <div className="v2-check-body">
        <div className="v2-check-text">
          <b>{c.part}.</b> {c.text}
        </div>
        {c.rule ? <div className="v2-check-rule">{c.rule}</div> : null}
        {c.fix || c.alts?.length ? (
          <div className="v2-acts">
            {c.fix ? (
              <button type="button" className="v2-btn v2-btn-sm" onClick={() => patch(c.fix!.patch)} data-check-fix="primary">
                {c.fix.label}
              </button>
            ) : null}
            {(c.alts ?? []).map((a) => (
              <button key={a.label} type="button" className="v2-btn v2-btn-sm v2-btn-quiet" onClick={() => patch(a.patch)} data-check-fix="alt">
                {a.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </li>
  );

  const kinds = KINDS_FOR[design.structure];
  const planShapes: RoofPlanShape[] = design.structure === "pergola" ? (withDeck ? ["follows-deck", "square", "rect"] : ["square", "rect"]) : design.structure === "covered-deck" ? ["follows-deck", "square", "rect"] : withDeck ? ["follows-deck", "square", "rect", "hexagon", "octagon", "round"] : ["square", "rect", "hexagon", "octagon", "round"];
  const canAttach = (withDeck ? design.placement !== "detached" : true) && !polygon && r.kind !== "pyramid" && r.kind !== "double-tier" && r.kind !== "gambrel" && r.kind !== "dutch-gable" && r.kind !== "pergola";
  const metalRoof = r.roofing === "metal-panel" || r.roofing === "standing-seam";
  const front = design.shape.kind === "rect" ? design.shape.front : undefined;
  const woodRail = design.rail.type === "treated" || design.rail.type === "cedar";
  const infills = design.rail.type === "cable" ? (["auto", "cable"] as const) : design.rail.type === "glass" ? (["auto", "glass"] as const) : design.rail.type === "aluminum" ? (["auto", "balusters", "cable", "glass", "horizontal"] as const) : woodRail ? (["auto", "balusters", "horizontal"] as const) : (["auto", "balusters", "panel"] as const);
  const placingFixture = placing?.kind === "fixture" ? design.electrical.fixtures.find((f) => f.id === placing.id) : null;
  const [kindOpen, setKindOpen] = React.useState(false);

  // Esc closes what is open: the kind sheet, a placing, then the inspector.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const t = e.target as HTMLElement | null;
      if (t && t.matches("input, textarea, select")) return;
      if (kindOpen) setKindOpen(false);
      else if (placing) setPlacing(null);
      else if (confirming) setConfirming(false);
      else setPanel(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [kindOpen, placing, confirming]);

  /* ------------------------------------------------------------------ */
  /*  The parts' settings                                                */
  /* ------------------------------------------------------------------ */

  // The roof's outline and size — in the Roof part over a deck; the footprint itself for a gazebo or pergola on its own floor.
  const outlineBlock = (
    <>
      <Field label="Outline" wide>
        <Seg small label="Roof outline" value={r.plan.shape} onChange={(sh: RoofPlanShape) => rp({ plan: { ...r.plan, shape: sh } })} options={planShapes.map((sh) => ({ value: sh, label: ROOF_PLAN_LABEL[sh] }))} />
      </Field>
      {r.plan.shape !== "follows-deck" ? (
        <div className="v2-grid2">
          {polygon ? (
            <Field label="Across the flats" aside="ft">
              <NumberInput label="Across the flats, feet" value={r.plan.acrossFt} parse={parseFeet} format={feetText} min={ROOF_LIMITS.acrossFt.min} max={ROOF_LIMITS.acrossFt.max} onCommit={(n2) => rp({ plan: { ...r.plan, acrossFt: n2 } })} />
            </Field>
          ) : (
            <>
              <Field label={r.plan.shape === "square" ? "Across" : "Along the house"} aside="ft">
                <NumberInput label="Roof width, feet" value={r.plan.widthFt} parse={parseFeet} format={feetText} min={ROOF_LIMITS.planFt.min} max={ROOF_LIMITS.planFt.max} onCommit={(n2) => rp({ plan: { ...r.plan, widthFt: n2, depthFt: r.plan.shape === "square" ? n2 : r.plan.depthFt } })} />
              </Field>
              {r.plan.shape === "rect" ? (
                <Field label="Out from the house" aside="ft">
                  <NumberInput label="Roof depth, feet" value={r.plan.depthFt} parse={parseFeet} format={feetText} min={ROOF_LIMITS.planFt.min} max={ROOF_LIMITS.planFt.max} onCommit={(n2) => rp({ plan: { ...r.plan, depthFt: n2 } })} />
                </Field>
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
        <p className="v2-hint">
          {Math.round(roof.footprintSqFt)} sq ft under the eaves · {roof.posts.length} posts{roof.attach === "wall" ? " and the house wall" : ""}
          {roof.kind !== "pergola" ? ` · ${Math.round(roof.roofAreaSqFt)} sq ft of roof, ${roof.squares} squares` : ""}
          {roof.engineered ? " · engineered beam where the sawn tables stop" : ""}
        </p>
      ) : null}
    </>
  );

  const deckPanel = withDeck ? (
    <Scope step="step-shape">
      <Field label="Shape" wide>
        <Seg label="Shape" value={design.shape.kind} onChange={(k) => patch({ shape: k === "rect" ? { kind: "rect", widthFt: design.shape.widthFt, depthFt: design.shape.depthFt } : { kind: "L", widthFt: design.shape.widthFt, depthFt: design.shape.depthFt, notch: { corner: "front-right", widthFt: Math.max(2, Math.round(design.shape.widthFt / 2)), depthFt: Math.max(2, Math.round(design.shape.depthFt / 2)) } } })} options={[{ value: "rect", label: "Rectangle" }, { value: "L", label: "L-shaped" }]} />
      </Field>
      <div className="v2-grid2">
        <Field label="Along the house" aside="ft">
          <NumberInput label="Width along the house, feet" value={design.shape.widthFt} parse={parseFeet} format={feetText} min={DECK_LIMITS.widthFt.min} max={DECK_LIMITS.widthFt.max} onCommit={(n2) => patch({ shape: { ...design.shape, widthFt: n2 } })} />
        </Field>
        <Field label="Out from the house" aside="ft">
          <NumberInput label="Depth out from the house, feet" value={design.shape.depthFt} parse={parseFeet} format={feetText} min={DECK_LIMITS.depthFt.min} max={DECK_LIMITS.depthFt.max} onCommit={(n2) => patch({ shape: { ...design.shape, depthFt: n2 } })} />
        </Field>
      </div>
      {design.shape.kind === "L" ? (
        <>
          <Field label="Corner cut away" wide>
            <Seg small label="Corner cut away" value={design.shape.notch.corner} onChange={(c) => design.shape.kind === "L" && patch({ shape: { ...design.shape, notch: { ...design.shape.notch, corner: c } } })} options={NOTCH_CORNERS.map((c) => ({ value: c, label: CORNER_LABEL[c] }))} />
          </Field>
          <div className="v2-grid2">
            <Field label="Cut along the house" aside="ft">
              <NumberInput label="Corner cut along the house, feet" value={design.shape.notch.widthFt} parse={parseFeet} format={feetText} min={2} max={design.shape.widthFt - 3} onCommit={(n2) => design.shape.kind === "L" && patch({ shape: { ...design.shape, notch: { ...design.shape.notch, widthFt: n2 } } })} />
            </Field>
            <Field label="Cut out from the house" aside="ft">
              <NumberInput label="Corner cut out from the house, feet" value={design.shape.notch.depthFt} parse={parseFeet} format={feetText} min={2} max={design.shape.depthFt - 3} onCommit={(n2) => design.shape.kind === "L" && patch({ shape: { ...design.shape, notch: { ...design.shape.notch, depthFt: n2 } } })} />
            </Field>
          </div>
          <p className="v2-hint">A back corner is where the house steps out into the deck — a bump-out or a bay.</p>
        </>
      ) : (
        <>
          <Field label="The front edge" wide>
            <Seg small label="The front edge" value={front?.kind ?? "straight"} onChange={(k: FrontKind) => patch({ shape: { kind: "rect", widthFt: design.shape.widthFt, depthFt: design.shape.depthFt, front: k === "straight" ? undefined : { kind: k, bulgeFt: front?.bulgeFt ?? 2, clipFt: front?.clipFt ?? 2 } } })} options={(["straight", "curve", "clipped"] as const).map((k) => ({ value: k, label: FRONT_LABEL[k] }))} />
          </Field>
          {front?.kind === "curve" ? (
            <Field label="The bow at the middle" aside="ft · laminated rim" wide>
              <NumberInput label="How far the front bows out at the middle, feet" value={front.bulgeFt} parse={parseFeet} format={feetText} min={DECK_LIMITS.bulgeFt.min} max={Math.min(DECK_LIMITS.bulgeFt.max, design.shape.widthFt / 3)} onCommit={(n2) => patch({ shape: { kind: "rect", widthFt: design.shape.widthFt, depthFt: design.shape.depthFt, front: { ...front, bulgeFt: n2 } } })} />
            </Field>
          ) : front?.kind === "clipped" ? (
            <Field label="Each corner clipped" aside="ft at 45°" wide>
              <NumberInput label="How much each front corner is clipped, feet" value={front.clipFt} parse={parseFeet} format={feetText} min={DECK_LIMITS.clipFt.min} max={Math.min(DECK_LIMITS.clipFt.max, (design.shape.widthFt - 2) / 2, design.shape.depthFt - 2)} onCommit={(n2) => patch({ shape: { kind: "rect", widthFt: design.shape.widthFt, depthFt: design.shape.depthFt, front: { ...front, clipFt: n2 } } })} />
            </Field>
          ) : null}
          <div className="v2-group">
            {/* (A double deck — a deck UNDER this one, design.lower.place "under", 2026-11-13 — is set in the main studio: this tick is the level in front.) */}
            <Toggle checked={design.lower.on && design.lower.place === "front"} onChange={(v) => patch({ lower: { on: v, place: "front" } })}>A lower level in front, a step down</Toggle>
            {design.lower.on && design.lower.place === "front" ? (
              <Scope level="lower">
                <div className="v2-grid2">
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
                    <Seg small label="Where the lower level sits" value={design.lower.align} onChange={(a) => patch({ lower: { align: a } })} options={[{ value: "left", label: "Left" }, { value: "centre", label: "Centre" }, { value: "right", label: "Right" }]} />
                  </Field>
                </div>
                <p className="v2-hint">One riser (up to 7¾ in.) is a step the lower deck makes; more wants a stair between the levels — the checks offer one.</p>
              </Scope>
            ) : null}
          </div>
          {design.shape.kind === "rect" ? (
            <div className="v2-group">
              <Toggle checked={design.spa.on} onChange={(v) => patch({ spa: { on: v } })}>A hot-tub spot — the frame under it doubled</Toggle>
              {design.spa.on ? (
                <>
                  <div className="v2-grid2">
                    <Field label="Tub, along the house" aside="ft">
                      <NumberInput label="Hot tub width, feet" value={design.spa.widthFt} parse={parseFeet} format={feetText} min={SPA_LIMITS.widthFt.min} max={Math.min(SPA_LIMITS.widthFt.max, design.shape.widthFt - 1)} onCommit={(n2) => patch({ spa: { widthFt: n2 } })} />
                    </Field>
                    <Field label="Tub, out from the house" aside="ft">
                      <NumberInput label="Hot tub depth, feet" value={design.spa.depthFt} parse={parseFeet} format={feetText} min={SPA_LIMITS.depthFt.min} max={Math.min(SPA_LIMITS.depthFt.max, design.shape.depthFt - 1)} onCommit={(n2) => patch({ spa: { depthFt: n2 } })} />
                    </Field>
                    <Field label="Set">
                      <Seg small label="Where the tub stands" value={design.spa.align} onChange={(a) => patch({ spa: { align: a } })} options={[{ value: "left", label: "Left" }, { value: "centre", label: "Centre" }, { value: "right", label: "Right" }]} />
                    </Field>
                  </div>
                  <p className="v2-hint">Every joist under the tub is doubled and the checks read the frame at the filled weight (≈100 psf). The tub is by others.</p>
                </>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </Scope>
  ) : (
    <Scope step="step-footprint">{outlineBlock}</Scope>
  );

  const sitePanel = (
    <Scope step="step-site">
      <form
        className="v2-field v2-field-wide"
        onSubmit={(e) => {
          e.preventDefault();
          commitAddress(addressDraft);
        }}
      >
        <span className="v2-lbl">
          <span>Job address</span>
          <span className="v2-lbl-aside">{site.label}</span>
        </span>
        <input className="v2-in" value={addressDraft} placeholder="Street, city, state ZIP" autoComplete="street-address" aria-label="Job address" onChange={(e) => setAddressDraft(e.target.value)} onBlur={() => addressDraft.trim() !== address && commitAddress(addressDraft)} />
      </form>
      <div className="v2-facts">
        <span className="v2-mono">{(frame ?? roof)?.species.region} lumber: {(frame ?? roof)?.species.short}</span>
        <span className="v2-mono">frost {design.frostIn} in. · snow {design.site.groundSnowPsf} psf</span>
      </div>
      {withDeck ? (
        <>
          <div className="v2-grid2">
            <Field label="Deck height" aside={`in. · ${ftIn(design.heightIn)}`}>
              <NumberInput label="Height of the deck surface above the ground, inches" value={design.heightIn} parse={parseInches} format={(n2) => String(Math.round(n2 * 4) / 4)} min={DECK_LIMITS.heightIn.min} max={DECK_LIMITS.heightIn.max} onCommit={(n2) => patch({ heightIn: n2 })} />
            </Field>
            <Field label="Frost depth" aside="in.">
              <NumberInput label="Frost depth, inches" value={design.frostIn} parse={intText} format={String} min={0} max={96} onCommit={(n2) => patch({ frostIn: n2 }, ["frost"])} />
            </Field>
          </div>
          <div className="v2-chips" role="group" aria-label="Height presets">
            {HEIGHT_PRESETS.map((h) => (
              <button key={h.label} type="button" className={cx("v2-chip", design.heightIn === h.inches && "is-on")} aria-pressed={design.heightIn === h.inches} onClick={() => patch({ heightIn: h.inches })}>
                {h.label} <span>{ftIn(h.inches)}</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="v2-grid2">
          <Field label="Frost depth" aside="in.">
            <NumberInput label="Frost depth, inches" value={design.frostIn} parse={intText} format={String} min={0} max={96} onCommit={(n2) => patch({ frostIn: n2 }, ["frost"])} />
          </Field>
          <Field label="Footings stand above grade" aside="in.">
            <NumberInput label="Top of the footings above the ground, inches" value={design.footing.aboveGradeIn} parse={intText} format={String} min={DECK_LIMITS.aboveGradeIn.min} max={DECK_LIMITS.aboveGradeIn.max} onCommit={(n2) => patch({ footing: { aboveGradeIn: n2 } })} />
          </Field>
        </div>
      )}
      <div className="v2-grid2">
        <Field label="Design load" aside={design.site.groundSnowPsf > 40 ? `snow here ${design.site.groundSnowPsf} psf` : "live or snow"}>
          <select className="v2-sel" value={design.loadPsf} onChange={(e) => patch({ loadPsf: Number(e.target.value) as LoadPsf }, ["load"])}>
            {LOADS.map((l) => (
              <option key={l} value={l}>
                {l === 40 ? "40 psf — live load" : `${l} psf ground snow`}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Soil bears">
          <select className="v2-sel" value={design.soilPsf} onChange={(e) => patch({ soilPsf: Number(e.target.value) as SoilPsf })}>
            <option value={1500}>1,500 psf (code default)</option>
            <option value={2000}>2,000 psf</option>
            <option value={3000}>3,000 psf or more</option>
          </select>
        </Field>
      </div>
      <div className="v2-group" data-deck-site>
        <div className="v2-sub-title">The ground</div>
        <div className="v2-grid2">
          <Field label="Falls away from the house" aside={`in. over ${design.shape.depthFt} ft`}>
            <NumberInput label="How far the ground falls away from the house across the deck, inches" value={design.site.slope.outDropIn} parse={intText} format={String} min={SLOPE_LIMITS.dropIn.min} max={SLOPE_LIMITS.dropIn.max} onCommit={(n2) => patch({ site: { ...design.site, slope: { ...design.site.slope, outDropIn: n2 } } })} />
          </Field>
          <Field label="Falls left to right" aside={`in. over ${design.shape.widthFt} ft`}>
            <NumberInput label="How far the ground falls left to right across the deck, inches" value={design.site.slope.acrossDropIn} parse={intText} format={String} min={SLOPE_LIMITS.dropIn.min} max={SLOPE_LIMITS.dropIn.max} onCommit={(n2) => patch({ site: { ...design.site, slope: { ...design.site.slope, acrossDropIn: n2 } } })} />
          </Field>
        </div>
        <div className="v2-acts">
          <button type="button" className="v2-btn v2-btn-sm" onClick={() => void readGround()} disabled={siteBusy || address.trim().length < 8} data-deck-read-ground>
            {siteBusy ? "Reading the lidar…" : "Read the ground from the address"}
          </button>
          {design.site.slope.outDropIn || design.site.slope.acrossDropIn ? (
            <button type="button" className="v2-btn v2-btn-sm" onClick={() => patch({ site: { ...design.site, slope: { outDropIn: 0, acrossDropIn: 0 } } })}>
              Level
            </button>
          ) : null}
        </div>
        {siteNote ? <p className="v2-hint">{siteNote}</p> : null}
      </div>
      {!withDeck && design.floor === "ground" && r.attach !== "wall" ? <Toggle checked={design.footing.frostAlways} onChange={(v) => patch({ footing: { frostAlways: v } })}>Dig to the frost line anyway</Toggle> : null}
      {withDeck ? (
        <Field label="Tear out an old deck" aside="sq ft">
          <NumberInput label="Old deck to tear out, square feet" value={design.extras.demoSqFt} parse={intText} format={String} min={0} max={4000} onCommit={(n2) => patch({ extras: { demoSqFt: n2 } })} />
        </Field>
      ) : null}
      <Fold title="What the code and the site say here" id="facts">
        <ul className="v2-list" data-deck-facts>
          <li data-deck-code>{site.codeLine}</li>
          {site.basis.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
          {design.site.termite ? <li>Termite hazard here: {TERMITE_LABEL[design.site.termite]}.</li> : null}
        </ul>
      </Fold>
    </Scope>
  );

  const housePanel = (
    <Scope step="step-house">
      {withDeck ? (
        <>
          <Field label="How it meets the house" wide>
            <Seg small label="How it meets the house" value={design.placement} onChange={(p: Placement) => patch({ placement: p })} options={(["attached", "beside", "detached"] as const).map((p) => ({ value: p, label: PLACEMENT_LABEL[p].split(" — ")[0] }))} />
          </Field>
          {design.placement !== "detached" ? (
            <Field label="The house wall there" wide>
              <select className="v2-sel" value={design.wall} onChange={(e) => patch({ wall: e.target.value as DeckDesign["wall"] })}>
                {WALL_TYPES.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.label}
                    {w.ledger ? "" : " — no ledger"}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          {design.placement !== "detached" && !wall.ledger ? <p className="v2-call is-warn">{wall.why}</p> : null}
        </>
      ) : withRoof && canAttach ? (
        <Field label="It stands" wide>
          <Seg small label="On the house or free" value={r.attach} onChange={(a) => rp({ attach: a })} options={[{ value: "wall", label: "On the house wall" }, { value: "free", label: "Free-standing" }]} />
        </Field>
      ) : null}
      {scene.house ? (
        <>
          <div className="v2-grid2">
            <Field label="Storeys">
              <Seg small label="Storeys" value={String(design.house.storeys)} onChange={(v) => setHouse({ storeys: v === "2" ? 2 : 1 })} options={[{ value: "1", label: "One" }, { value: "2", label: "Two" }]} />
            </Field>
            <Field label="Roof">
              <Seg small label="Roof" value={design.house.roof} onChange={(v: HouseRoof) => setHouse({ roof: v })} options={HOUSE_ROOFS.map((hr) => ({ value: hr, label: HOUSE_ROOF_LABEL[hr] }))} />
            </Field>
          </div>
          <Field label="The back wall and the deck, seen from above — drag anything" wide lights={null}>
            <div className="v2-wallbox" onPointerDownCapture={quiet} data-deck-wall-quiet>
              <HouseWallPlan shape={design.shape} house={design.house} onChange={(n2) => patch({ ...(n2.shape ? { shape: n2.shape } : {}), ...(n2.house ? { house: n2.house } : {}) })} onOpenLarge={() => setView("wall")} />
            </div>
          </Field>
          <p className={houseNotes(design.shape, design.house).length ? "v2-call is-bad" : "v2-hint"} data-deck-wall-words>
            {wallWords(design.shape, design.house)}
          </p>
          <Field label="The wall's shape" wide>
            <div className="v2-chips" role="group" aria-label="The wall's shape">
              {QUICK_WALLS.map((k) => (
                <button key={k} type="button" className={cx("v2-chip", quickWallOf(design.shape, design.house) === k && "is-on")} aria-pressed={quickWallOf(design.shape, design.house) === k} onClick={() => setHouse(quickWall(k, design.shape, design.house))} data-deck-wall-quick={k}>
                  {QUICK_WALL_LABEL[k]}
                </button>
              ))}
            </div>
          </Field>
          <div className="v2-grid2">
            <Field label="Wall past the deck's left end" aside="ft" lights={lightsFor({ kind: "left" })}>
              <NumberInput label="Wall past the left end, feet" value={design.house.leftFt} parse={parseFeet} format={feetText} min={HOUSE_LIMITS.extendFt.min} max={HOUSE_LIMITS.extendFt.max} onCommit={(n2) => setHouse({ leftFt: n2 })} />
            </Field>
            <Field label="Wall past the deck's right end" aside="ft" lights={lightsFor({ kind: "right" })}>
              <NumberInput label="Wall past the right end, feet" value={design.house.rightFt} parse={parseFeet} format={feetText} min={HOUSE_LIMITS.extendFt.min} max={HOUSE_LIMITS.extendFt.max} onCommit={(n2) => setHouse({ rightFt: n2 })} />
            </Field>
          </div>
          <div className="v2-rows" data-deck-house-jogs>
            {design.house.jogs.map((j, i) => (
              <div key={j.id} className="v2-row v2-row-card" data-deck-house-jog={j.id}>
                <div className="v2-row-head">
                  <span className="v2-row-title">Step {i + 1} — {stepWords(j, design.shape)}</span>
                  <button type="button" className="v2-btn v2-btn-sm v2-btn-quiet" onClick={() => setHouse({ jogs: design.house.jogs.filter((x) => x.id !== j.id) })} data-deck-house-jog-remove>Remove</button>
                </div>
                <div className="v2-grid2">
                  <Field label="Where, from the deck's left end" aside="ft" lights={lightsFor({ kind: "step", id: j.id })}>
                    <NumberInput label="Step at, feet from the deck's left end" value={j.atFt} parse={parseFeet} format={feetText} min={-design.house.leftFt + 1} max={design.shape.widthFt + design.house.rightFt - 1} onCommit={(n2) => setHouse({ jogs: design.house.jogs.map((x) => (x.id === j.id ? { ...x, atFt: n2 } : x)) })} />
                  </Field>
                  <Field label="The wall to its right" lights={lightsFor({ kind: "part", id: j.id })}>
                    <Seg small label="The wall to its right" value={j.dir} onChange={(v: HouseJog["dir"]) => setHouse({ jogs: design.house.jogs.map((x) => (x.id === j.id ? { ...x, dir: v } : x)) })} options={[{ value: "toward", label: "Comes out" }, { value: "away", label: "Steps back" }]} />
                  </Field>
                  <Field label="By" aside="ft" lights={lightsFor({ kind: "part", id: j.id })}>
                    <NumberInput label="By, feet" value={j.depthFt} parse={parseFeet} format={feetText} min={HOUSE_LIMITS.depthFt.min} max={HOUSE_LIMITS.depthFt.max} onCommit={(n2) => setHouse({ jogs: design.house.jogs.map((x) => (x.id === j.id ? { ...x, depthFt: n2 } : x)) })} />
                  </Field>
                </div>
              </div>
            ))}
          </div>
          <button type="button" className="v2-btn v2-btn-sm" disabled={design.house.jogs.length >= HOUSE_LIMITS.jogs} onClick={() => setHouse({ jogs: [...design.house.jogs, { id: nextJogId(design.house.jogs), atFt: Math.max(2, design.shape.widthFt - 4), dir: "toward", depthFt: 3 }] })} data-deck-house-add-jog>
            + Add a step in the wall
          </button>
          <Fold title="Siding and roof colour" sub={`${SIDINGS.find((c) => c.id === design.house.siding)?.label ?? ""} · ${ROOF_COLOURS.find((c) => c.id === design.house.roofColour)?.label ?? ""}`} id="house-look">
            <Field label="Siding">
              <div className="v2-chips" role="group" aria-label="Siding">
                {SIDINGS.map((c) => (
                  <button key={c.id} type="button" className={cx("v2-chip", "v2-swatch-chip", design.house.siding === c.id && "is-on")} aria-pressed={design.house.siding === c.id} onClick={() => setHouse({ siding: c.id })} data-deck-house-siding={c.id}>
                    <span className="v2-swatch" style={{ background: c.hex }} aria-hidden />
                    {c.label}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Roof colour">
              <div className="v2-chips" role="group" aria-label="Roof colour">
                {ROOF_COLOURS.map((c) => (
                  <button key={c.id} type="button" className={cx("v2-chip", "v2-swatch-chip", design.house.roofColour === c.id && "is-on")} aria-pressed={design.house.roofColour === c.id} onClick={() => setHouse({ roofColour: c.id })} data-deck-house-roof-colour={c.id}>
                    <span className="v2-swatch" style={{ background: c.hex }} aria-hidden />
                    {c.label}
                  </button>
                ))}
              </div>
            </Field>
          </Fold>
        </>
      ) : (
        <p className="v2-hint">No house is drawn: the {what.toLowerCase()} stands on its own.</p>
      )}
    </Scope>
  );

  const framePanel = frame ? (
    <Scope step="Frame">
      <Field label="Framing lumber" wide>
        <select className="v2-sel" value={design.custom.species ? CUSTOM : design.framing.species} onChange={(e) => onSpecies(e.target.value)} data-deck-pick="species">
          {speciesOptions}
          <option value={CUSTOM}>{CUSTOM_LABEL}</option>
        </select>
      </Field>
      {design.custom.species ? (
        <CustomBox slot="species" title="Framing lumber" product={design.custom.species} unit={null} fresh={freshCustom === "species"} onDone={freshDone} onChange={(p) => setCustom("species", p)} onBack={() => setCustom("species", undefined)} note={`Named as typed on the plans and the material list. It spans by the code's tables for ${(FRAMING_SPECIES.find((f) => f.id === design.framing.species)?.label ?? "the lumber below").toLowerCase()} and is priced as that.`}>
          <Field label="Spans and prices as" wide>
            <select className="v2-sel" value={design.framing.species} onChange={(e) => patch({ framing: { species: e.target.value as DeckDesign["framing"]["species"] } }, ["species"])} data-deck-like="species">
              {speciesOptions}
            </select>
          </Field>
        </CustomBox>
      ) : (
        <p className="v2-hint">{frame.species.note}</p>
      )}
      <Field label="Joists" aside={design.framing.joist === "auto" ? `picked: ${frame.joistSize}` : undefined} wide>
        <Seg small label="Joists" value={design.framing.joist} onChange={(v) => patch({ framing: { joist: v } })} options={[{ value: "auto", label: "Auto" }, ...(["2x6", "2x8", "2x10", "2x12"] as const).map((j) => ({ value: j, label: j }))]} />
      </Field>
      <Field label="Joist spacing" aside={design.framing.spacingIn === "auto" ? `${frame.spacingIn} in. on center` : "on center"} wide>
        <Seg small label="Joist spacing" value={design.framing.spacingIn} onChange={(v) => patch({ framing: { spacingIn: v } })} options={[{ value: "auto", label: "Auto" }, { value: 12, label: '12"' }, { value: 16, label: '16"' }, { value: 24, label: '24"' }]} />
      </Field>
      <div className="v2-grid2">
        <Field label="Beam size" aside={design.framing.beam === "auto" ? `picked: ${[...new Set(frame.beams.map((b) => b.spec.size))].join(", ")}` : undefined}>
          <select className="v2-sel" value={design.framing.beam} onChange={(e) => patch({ framing: { beam: e.target.value as DeckDesign["framing"]["beam"] } })}>
            <option value="auto">Auto — least cost</option>
            {(frame.beamKind === "solid" ? SOLID_BEAMS : BUILT_UP_CHOICES).map((b) => (
              <option key={b} value={b}>{b.includes("-") ? `${b[0]}-ply ${b.slice(2)}` : b}</option>
            ))}
          </select>
        </Field>
        <Field label="Posts">
          <select className="v2-sel" value={design.framing.post} onChange={(e) => patch({ framing: { post: e.target.value as DeckDesign["framing"]["post"] } })}>
            {POST_SIZES.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Footings" wide>
        <Seg small label="Footings" value={design.footing.type} onChange={(v) => patch({ footing: { type: v } })} options={[{ value: "poured", label: "Poured concrete" }, { value: "pier-block", label: "Precast pier blocks" }]} />
      </Field>
      <Fold title="More framing choices" sub={frameMoreWords} id="frame-more">
        <Field label="Beams" aside={design.framing.beamStyle === "auto" ? (frame.beamStyle === "flush" ? "picked: flush" : "picked: under the joists") : undefined} wide>
          <Seg small label="Beams" value={design.framing.beamStyle} onChange={(v) => patch({ framing: { beamStyle: v } })} options={[{ value: "auto", label: "Auto" }, { value: "dropped", label: "Under the joists" }, { value: "flush", label: "Flush" }]} />
        </Field>
        <div className="v2-grid2">
          <Field label="Beam made of">
            <select className="v2-sel" value={frame.beamKind} onChange={(e) => patch({ framing: { beamKind: e.target.value as DeckDesign["framing"]["beamKind"], beam: "auto" } })} data-deck-beam-kind={frame.beamKind}>
              <option value="solid" disabled={!solidBeamTabulated(frame.load, frame.group)}>{solidBeamTabulated(frame.load, frame.group) ? "Solid 4x" : "Solid 4x — not in the tables here"}</option>
              <option value="built-up">Built up from 2x</option>
            </select>
          </Field>
          <Field label="Joists past the beam" aside={design.framing.overhangFt === "auto" ? `auto: ${ftIn(frame.zones[0].frontCantIn)}` : "ft"}>
            <select className="v2-sel" value={String(design.framing.overhangFt)} onChange={(e) => patch({ framing: { overhangFt: e.target.value === "auto" ? "auto" : Number(e.target.value) } })}>
              <option value="auto">Auto — up to 2 ft</option>
              {[0, 0.5, 1, 1.5, 2, 2.5, 3].map((v) => (
                <option key={v} value={v}>{v === 0 ? "None" : feetText(v).replace(/^(\d+)$/, "$1 ft")}</option>
              ))}
            </select>
          </Field>
        </div>
        {frame.beamKindNote ? <p className="v2-call is-warn" data-deck-beam-note>{frame.beamKindNote}</p> : null}
        <div className="v2-toggles">
          <Toggle checked={design.framing.doubleRim} onChange={(v) => patch({ framing: { doubleRim: v } })}>Doubled rim and outside joists</Toggle>
          <Toggle checked={design.framing.joistTape} onChange={(v) => patch({ framing: { joistTape: v } })}>Joist tape on every top</Toggle>
          <Toggle checked={design.framing.braces} onChange={(v) => patch({ framing: { braces: v } })}>Knee braces at corner posts over 2 ft</Toggle>
          <Toggle checked={design.framing.blocking === "mid-span"} onChange={(v) => patch({ framing: { blocking: v ? "mid-span" : "auto" } })}>Mid-span blocking on spans over 8 ft</Toggle>
          {design.heightIn >= 84 ? <Toggle checked={design.extras.underDeckDrain} onChange={(v) => patch({ extras: { underDeckDrain: v } })}>Under-deck drainage — a dry room below</Toggle> : null}
          <Toggle checked={design.extras.stainless} onChange={(v) => patch({ extras: { stainless: v } })}>Stainless connectors — within 300 ft of salt water</Toggle>
          {design.placement !== "attached" ? <Toggle checked={design.footing.frostAlways} onChange={(v) => patch({ footing: { frostAlways: v } })}>Dig to the frost line anyway</Toggle> : null}
        </div>
        {design.placement === "attached" ? (
          <div className="v2-grid2">
            <Field label="Ledger fastened with">
              <select className="v2-sel" value={design.ledger.fastener} onChange={(e) => patch({ ledger: { fastener: e.target.value as DeckDesign["ledger"]["fastener"] } })}>
                {wall.fasteners.map((f) => (
                  <option key={f} value={f}>{LEDGER_FASTENER_LABEL[f]}</option>
                ))}
              </select>
            </Field>
            <Field label="Ties to the house">
              <select className="v2-sel" value={design.ledger.lateral} onChange={(e) => patch({ ledger: { lateral: e.target.value as "two" | "four" } })}>
                <option value="two">Two 1,500-lb hold-downs</option>
                <option value="four">Four 750-lb ties</option>
              </select>
            </Field>
          </div>
        ) : null}
      </Fold>
    </Scope>
  ) : (
    <p className="v2-hint">No deck frame here — the {what.toLowerCase()} {design.floor === "slab" ? "stands on a slab" : "stands on its own footings"}. Its posts and beams are under the roof.</p>
  );

  const boardsPanel = frame && pkg.takeoff.surface ? (
    <Scope step="Surface">
      <Field label="Deck boards" wide>
        <select className="v2-sel" value={design.custom.decking ? CUSTOM : design.decking.product} onChange={(e) => onDecking(e.target.value)} data-deck-pick="decking">
          {deckingOptions}
          <option value={CUSTOM}>{CUSTOM_LABEL}</option>
        </select>
      </Field>
      {design.custom.decking ? (
        <CustomBox slot="decking" title="Deck boards" product={design.custom.decking} unit="ft of board" fresh={freshCustom === "decking"} onDone={freshDone} onChange={(p) => setCustom("decking", p)} onBack={() => setCustom("decking", undefined)} note="Priced at your number per foot of board, the stair treads too. The joist spacing, the gaps and the clips follow the board it is laid like.">
          <Field label="Laid like" wide>
            <select className="v2-sel" value={design.decking.product} onChange={(e) => patch({ decking: { product: e.target.value } }, ["decking"])} data-deck-like="decking">
              {deckingOptions}
            </select>
          </Field>
        </CustomBox>
      ) : null}
      <p className="v2-hint">
        Joists no more than {frame.decking.maxSpacingIn.square} in. apart ({frame.decking.maxSpacingIn.diagonal} in. on the diagonal) — {frame.decking.sourceNote}.
      </p>
      {tiers ? (
        <div className="v2-tiers" data-deck-tiers role="group" aria-label="Good, better, best">
          {tiers.map((t) => (
            <button
              key={t.id}
              type="button"
              className={cx("v2-tier", t.current && "is-on")}
              aria-pressed={t.current}
              disabled={t.current}
              onClick={() => patch({ decking: { product: t.product }, rail: { type: design.rail.type === "none" && !structure.rails.required ? "none" : t.rail }, custom: { decking: undefined } }, ["decking"])}
            >
              <span className="v2-tier-name">{t.name}{t.current ? " · this one" : ""}</span>
              <span className="v2-tier-v">{money(t.subtotal)}</span>
              <span className="v2-tier-h">{t.words}</span>
            </button>
          ))}
        </div>
      ) : null}
      <Field label="Pattern" wide>
        <Seg small label="Pattern" value={design.decking.pattern} onChange={(v) => patch({ decking: { pattern: v, diagonal: v !== "straight" } })} options={(["straight", "diagonal", "herringbone"] as const).map((v) => ({ value: v, label: PATTERN_LABEL[v] }))} />
      </Field>
      <Field label="Picture-frame border" wide>
        <Seg small label="Picture-frame border" value={design.decking.border} onChange={(v) => patch({ decking: { border: v } })} options={[{ value: 0, label: "None" }, { value: 1, label: "One board" }, { value: 2, label: "Two boards" }]} />
      </Field>
      <div className="v2-grid2">
        <Field label="Fastened with">
          <select className="v2-sel" value={design.custom.fastening ? CUSTOM : design.decking.fastening} onChange={(e) => (e.target.value === CUSTOM ? pickCustom("fastening") : patch({ decking: { fastening: e.target.value as DeckDesign["decking"]["fastening"] }, custom: { fastening: undefined } }))} data-deck-pick="fastening">
            <option value="auto">Auto — {pkg.takeoff.surface.fastening === "hidden" ? "hidden clips" : "screws"}</option>
            <option value="screws">Deck screws</option>
            {frame.decking.hiddenFasteners ? <option value="hidden">Hidden clips</option> : null}
            <option value={CUSTOM}>{CUSTOM_LABEL}</option>
          </select>
        </Field>
        <Field label="Fascia">
          <select className="v2-sel" value={design.custom.fascia && pkg.takeoff.surface.fascia.on ? CUSTOM : design.decking.fascia} onChange={(e) => (e.target.value === CUSTOM ? pickCustom("fascia") : patch({ decking: { fascia: e.target.value as DeckDesign["decking"]["fascia"] }, custom: { fascia: undefined } }))} data-deck-pick="fascia">
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
              <Seg small label="Fastening counted as" value={pkg.takeoff.surface.fastening} onChange={(v) => patch({ decking: { fastening: v } })} options={[{ value: "screws", label: "Face screws" }, { value: "hidden", label: "Hidden clips" }]} />
            </Field>
          ) : null}
        </CustomBox>
      ) : null}
      {design.custom.fascia && pkg.takeoff.surface.fascia.on ? (
        <CustomBox slot="fascia" title="Fascia" product={design.custom.fascia} unit="ft" fresh={freshCustom === "fascia"} onDone={freshDone} onChange={(p) => setCustom("fascia", p)} onBack={() => setCustom("fascia", undefined)} note="Priced per foot of fascia board, the stair risers too, bought in 12-ft lengths." />
      ) : null}
      {regional ? (
        <p className="v2-hint" data-deck-regional={regional.region}>
          {regionalWords(regional)} Builder surveys by region; remodels still lean on wood.
        </p>
      ) : null}
    </Scope>
  ) : (
    <p className="v2-hint">No deck boards — the {what.toLowerCase()} {design.floor === "slab" ? "stands on a slab" : "stands on the ground"}.</p>
  );

  const railsPanel = withDeck ? (
    <Scope step="step-stairs">
      <div className="v2-grid2">
        <Field label="Railing" aside={structure.rails.required && design.rail.type === "none" ? "a guard is required" : undefined}>
          <select className="v2-sel" value={design.rail.type} onChange={(e) => onRail(e.target.value)} data-deck-rail>
            {RAIL_TYPES.map((rt) => (
              <option key={rt.id} value={rt.id}>{rt.id === "none" ? "No railing" : rt.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Height">
          <Seg small label="Rail height" value={design.rail.heightIn} onChange={(v) => { touched.current.add("railHeight"); patch({ rail: { heightIn: v } }); }} options={[{ value: 36, label: "36 in." }, { value: 42, label: "42 in." }]} />
        </Field>
        {design.rail.type !== "none" ? (
          <>
            <Field label="Infill" aside={design.rail.infill === "auto" ? `picked: ${RAIL_INFILL_LABEL[structure.rails.infill].toLowerCase()}` : undefined}>
              <select className="v2-sel" value={design.rail.infill} onChange={(e) => patch({ rail: { infill: e.target.value as DeckDesign["rail"]["infill"] } })}>
                {infills.map((v) => (
                  <option key={v} value={v}>{v === "auto" ? "Auto" : RAIL_INFILL_LABEL[v]}</option>
                ))}
              </select>
            </Field>
            <Field label="Posts apart" aside="ft">
              <Seg small label="Rail posts apart" value={design.rail.postSpacingFt} onChange={(v) => patch({ rail: { postSpacingFt: v } })} options={[{ value: 4, label: "4" }, { value: 6, label: "6" }, { value: 8, label: "8" }]} />
            </Field>
            {design.rail.type === "custom" ? (
              <>
                <Field label="Your railing" wide>
                  <NameInput label="Your railing's name" value={design.rail.customName} placeholder="Brand, line, colour" allowEmpty onCommit={(name) => patch({ rail: { customName: name } })} />
                </Field>
                <Field label="Your rail price, installed" aside="$/ft">
                  <NumberInput label="Custom rail price per foot, installed" value={design.rail.customPerFt} parse={intText} format={String} min={0} max={1000} onCommit={(n2) => patch({ rail: { customPerFt: n2 } })} />
                </Field>
              </>
            ) : null}
          </>
        ) : null}
      </div>
      {design.rail.type !== "none" ? (
        <div className="v2-toggles">
          {woodRail ? <Toggle checked={design.rail.cap} onChange={(v) => patch({ rail: { cap: v } })}>A flat 2x6 drink cap</Toggle> : null}
          {design.lower.on ? <Toggle checked={design.rail.lowerLevel} onChange={(v) => patch({ rail: { lowerLevel: v } })}>Rail on the lower level too</Toggle> : null}
        </div>
      ) : null}
      {structure.rails.on ? <p className="v2-hint">{railWords(structure.rails)}. Lit post caps and step lights are under Lights.</p> : null}
    </Scope>
  ) : (
    <p className="v2-hint">No deck, so no railing.</p>
  );

  const stairsPanel = withDeck ? (
    <Scope step="step-stairs">
      <div className="v2-acts">
        <button type="button" className={cx("v2-btn", "v2-btn-sm", placing?.kind === "stair" && "is-on")} aria-pressed={placing?.kind === "stair"} disabled={design.stairs.length >= STAIR_LIMITS.count} onClick={() => { setPlacing(placing?.kind === "stair" ? null : { kind: "stair" }); if (view === "wall") setView("plan"); }} data-deck-place-stair>
          {placing?.kind === "stair" ? "Press the deck's edge…" : "Place by pressing the deck"}
        </button>
        <button type="button" className="v2-btn v2-btn-sm" disabled={design.stairs.length >= STAIR_LIMITS.count} onClick={() => { const id = freshId("s", design.stairs.length + 1); setStairs((list) => [...list, defaultStair(id, "front", design.shape.widthFt / 2)]); setPanelId(id); }} data-deck-add-stair>
          Add stairs down the front
        </button>
      </div>
      {design.stairs.length === 0 ? <p className="v2-empty">No stairs yet. Press the deck&apos;s open edge where they go, or add one down the front.</p> : null}
      <div className="v2-rows" data-deck-stairs>
        {design.stairs.map((st, i) => {
          const builtSt = structure.stairs.find((b) => b.design.id === st.id);
          const sideLen = st.level === "lower" ? (st.side === "front" ? design.lower.widthFt : design.lower.depthFt) : st.side === "front" ? design.shape.widthFt : design.shape.depthFt;
          const isOpen = panelId === st.id || (design.stairs.length === 1 && !panelId);
          const name = `${st.wrap ? "Box steps" : `Stair ${i + 1}`}${builtSt ? ` · ${builtSt.risers} risers of ${builtSt.riserIn.toFixed(2)} in.${builtSt.lands === "lower-deck" ? " to the lower level" : ""}` : ""}`;
          return (
            <Scope key={st.id} stair={st.id}>
              <div className={cx("v2-row", "v2-row-card", isOpen && "is-open")} data-deck-stair={st.id}>
                <div className="v2-row-head">
                  <button type="button" className="v2-row-toggle" aria-expanded={isOpen} onClick={() => setPanelId(isOpen ? "__none" : st.id)}>
                    <span className="v2-row-title">{name}</span>
                    <span className="v2-row-meta">{STAIR_SIDE_LABEL[st.side]} · {feetText(st.widthFt)} ft wide</span>
                  </button>
                  <button type="button" className="v2-btn v2-btn-sm v2-btn-quiet" onClick={() => setStairs((list) => list.filter((x) => x.id !== st.id))}>Remove</button>
                </div>
                {isOpen ? (
                  <>
                    <div className="v2-grid2">
                      <Field label="Down the">
                        <Seg small label="Which side" value={st.side} onChange={(v) => setStairs((list) => list.map((x) => (x.id === st.id ? { ...x, side: v, wrap: v === "front" && x.wrap } : x)))} options={(["front", "left", "right"] as const).map((v) => ({ value: v, label: STAIR_SIDE_LABEL[v] }))} />
                      </Field>
                      <Field label="Centred at" aside={`ft from the ${st.side === "front" ? "left end" : "house"}`}>
                        <NumberInput label="Where the stair's middle sits along the side, feet" value={st.atFt} parse={parseFeet} format={feetText} min={st.widthFt / 2} max={Math.max(st.widthFt / 2, sideLen - st.widthFt / 2)} onCommit={(n2) => setStairs((list) => list.map((x) => (x.id === st.id ? { ...x, atFt: n2 } : x)))} />
                      </Field>
                      <Field label="Width" aside="ft">
                        <NumberInput label="Stair width, feet" value={st.widthFt} parse={parseFeet} format={feetText} min={STAIR_LIMITS.widthFt.min} max={STAIR_LIMITS.widthFt.max} onCommit={(n2) => setStairs((list) => list.map((x) => (x.id === st.id ? { ...x, widthFt: n2 } : x)))} />
                      </Field>
                      <Field label="Lands on">
                        <select className="v2-sel" value={st.landing} onChange={(e) => setStairs((list) => list.map((x) => (x.id === st.id ? { ...x, landing: e.target.value as StairDesign["landing"] } : x)))}>
                          {(["pad", "patio", "grade"] as const).map((v) => (
                            <option key={v} value={v}>{STAIR_LANDING_LABEL[v]}</option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Handrail">
                        <select className="v2-sel" value={st.handrail} onChange={(e) => setStairs((list) => list.map((x) => (x.id === st.id ? { ...x, handrail: e.target.value as StairDesign["handrail"] } : x)))}>
                          <option value="auto">Auto — as the code asks</option>
                          <option value="both">Both sides</option>
                          <option value="one">One side</option>
                          <option value="none">None</option>
                        </select>
                      </Field>
                      {design.lower.on ? (
                        <Field label="From">
                          <Seg small label="From which level" value={st.level} onChange={(v) => setStairs((list) => list.map((x) => (x.id === st.id ? { ...x, level: v } : x)))} options={[{ value: "upper", label: "The deck" }, { value: "lower", label: "Lower level" }]} />
                        </Field>
                      ) : null}
                    </div>
                    {st.side === "front" ? (
                      <div className="v2-toggles">
                        <Toggle checked={st.wrap} onChange={(v) => setStairs((list) => list.map((x) => (x.id === st.id ? { ...x, wrap: v } : x)))}>Wide steps wrapping the deck (seven risers at most)</Toggle>
                        {st.wrap ? <Seg small label="Wrap how many sides" value={st.wrapSides} onChange={(v) => setStairs((list) => list.map((x) => (x.id === st.id ? { ...x, wrapSides: v } : x)))} options={[{ value: 1, label: "Front" }, { value: 3, label: "Three sides" }, ...(design.placement === "detached" ? [{ value: 4 as const, label: "All four" }] : [])]} /> : null}
                      </div>
                    ) : null}
                  </>
                ) : null}
              </div>
            </Scope>
          );
        })}
      </div>
    </Scope>
  ) : (
    <p className="v2-hint">No deck, so no stairs.</p>
  );

  const roofPanel = withRoof && roof ? (
    <Scope step="step-roof">
      {kinds.length > 1 ? (
        <Field label="Roof shape" wide>
          <Seg small label="Roof shape" value={r.kind} onChange={(k: RoofKind) => rp({ kind: k })} options={kinds.map((k) => ({ value: k, label: ROOF_KIND_LABEL[k].split(" — ")[0] }))} />
        </Field>
      ) : null}
      {roof.kindNote ? <p className="v2-call is-warn">{roof.kindNote}</p> : null}
      {canAttach ? (
        <Field label="It stands" wide>
          <Seg small label="On the house or free" value={r.attach} onChange={(a) => rp({ attach: a })} options={[{ value: "wall", label: "On the house wall" }, { value: "free", label: "Free-standing" }]} />
        </Field>
      ) : null}
      {withDeck ? outlineBlock : null}
      <Fold title="Posts and headers" sub={`${ftIn(r.eaveHeightIn)} to the headers · ${r.post} posts`} open id="roof-posts">
        <div className="v2-grid2">
          <Field label="Height to the headers" aside={`in. · ${ftIn(r.eaveHeightIn)}`}>
            <NumberInput label="Height from the floor to the underside of the headers, inches" value={r.eaveHeightIn} parse={parseInches} format={String} min={ROOF_LIMITS.eaveHeightIn.min} max={ROOF_LIMITS.eaveHeightIn.max} onCommit={(n2) => rp({ eaveHeightIn: n2 })} />
          </Field>
          <Field label="Posts">
            <Seg small label="Roof posts" value={r.post} onChange={(p) => rp({ post: p })} options={(["4x4", "6x6", "8x8"] as const).map((p) => ({ value: p, label: p }))} />
          </Field>
        </div>
        <div className="v2-chips">
          {EAVE_PRESETS.map((h) => (
            <button key={h.label} type="button" className={cx("v2-chip", r.eaveHeightIn === h.inches && "is-on")} aria-pressed={r.eaveHeightIn === h.inches} onClick={() => rp({ eaveHeightIn: h.inches })}>
              {h.label} <span>to the headers</span>
            </button>
          ))}
        </div>
        <div className="v2-grid2">
          <Field label="Headers (beams on the posts)" aside={r.header === "auto" ? `picked: ${[...new Set(roof.headers.map((h) => h.spec.size))].join(", ") || "—"}` : undefined}>
            <select className="v2-sel" value={r.header} onChange={(e) => rp({ header: e.target.value as RoofDesign["header"] })}>
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
            <select className="v2-sel" value={r.overhangIn} onChange={(e) => rp({ overhangIn: Number(e.target.value) })}>
              {OVERHANGS.map((o) => (
                <option key={o} value={o}>{o === 0 ? "None" : `${o} in.`}</option>
              ))}
            </select>
          </Field>
        </div>
        <Toggle checked={r.braces} onChange={(v) => rp({ braces: v })}>Knee braces at the posts</Toggle>
        <Field label="Walls between the posts" wide>
          <Seg
            small
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
              <Seg small label="Walls built like" value={r.walls.fill} onChange={(v) => rp({ walls: { ...r.walls, fill: v } })} options={(["screen", "lattice", "solid"] as const).map((v) => ({ value: v, label: WALL_FILL_LABEL[v].split(",")[0] }))} />
            </Field>
          </CustomBox>
        ) : null}
        {r.walls.fill !== "none" ? (
          <Field label="On how many sides" aside={`of ${roof.ring.length - (roof.attach === "wall" ? 1 : 0)} open`} wide>
            <NumberInput label="How many sides get walls" value={r.walls.sides} parse={intText} format={String} min={1} max={Math.max(1, roof.ring.length - (roof.attach === "wall" ? 1 : 0))} onCommit={(n2) => rp({ walls: { ...r.walls, sides: n2 } })} />
          </Field>
        ) : null}
      </Fold>
      <Fold title={design.structure === "pergola" ? "Rafters and slats" : "Rafters and ridge"} sub={design.structure === "pergola" ? PERGOLA_STYLE_LABEL[r.pergolaStyle] : `${r.pitch}:12 · ${roof.trusses ? "trusses" : `${roof.rafters.size} rafters`}`} id="roof-rafters">
        {design.structure !== "pergola" ? (
          <Field label="Pitch" aside={`${r.pitch}:12 · ${Math.round(Math.atan(r.pitch / 12) * (180 / Math.PI))}°`} wide>
            <Seg small label="Pitch" value={r.pitch} onChange={(p) => rp({ pitch: p })} options={PITCHES.map((p) => ({ value: p, label: `${p}:12` }))} />
          </Field>
        ) : (
          <Field label="The top" wide>
            <Seg small label="Pergola top" value={r.pergolaStyle} onChange={(v) => rp({ pergolaStyle: v })} options={(["flat", "louvered", "arched"] as const).map((v) => ({ value: v, label: PERGOLA_STYLE_LABEL[v] }))} />
          </Field>
        )}
        <Field label="Rafters" aside={roof.trusses ? "trusses frame this roof" : r.rafter === "auto" ? `picked: ${roof.rafters.size}` : undefined} wide>
          <Seg small label="Rafters" value={r.rafter} onChange={(v) => rp({ rafter: v })} options={[{ value: "auto", label: "Auto" }, ...(["2x6", "2x8", "2x10", "2x12"] as const).map((j) => ({ value: j, label: j }))]} />
        </Field>
        <Field label="Rafter spacing" aside="on center" wide>
          <Seg small label="Rafter spacing" value={r.rafterSpacingIn} onChange={(v) => rp({ rafterSpacingIn: v })} options={[{ value: 12, label: '12"' }, { value: 16, label: '16"' }, { value: 24, label: '24"' }]} />
        </Field>
        {r.kind === "gable" || r.kind === "hip" || r.kind === "gambrel" ? (
          <Field label="At the ridge" aside={r.ridge === "auto" ? (roof.trusses ? "picked: trusses" : roof.ridge ? `picked: ${roof.ridge.kind === "beam" ? "ridge beam" : "ridge board"}` : undefined) : undefined} wide>
            <Seg small label="At the ridge" value={r.ridge} onChange={(v) => rp({ ridge: v })} options={[{ value: "auto", label: "Auto" }, { value: "beam", label: "Ridge beam", title: r.kind === "hip" ? "A beam on two king posts, each on a cross beam; the ceiling stays open" : "The rafters bear on a beam; the ceiling stays open" }, { value: "board", label: "Ridge board + ties", title: "A board between the rafters, with rafter ties every 4 ft" }, ...(r.kind === "gable" ? [{ value: "trusses" as const, label: "Trusses", title: "Manufactured trusses 24 in. on center, designed and stamped by the truss maker" }] : [])]} />
          </Field>
        ) : null}
        {/* CROSS BEAMS (2026-10-12): under a gable's ridge beam, each from eave header to eave header with a king post. */}
        {roof.kind === "gable" && roof.ridge?.kind === "beam" && !roof.trusses ? (
          <Field label="Cross beams under the ridge" aside={roof.crossBeams ? `the ridge spans ${ftIn(roof.ridge.spanIn)} between king posts` : "the ridge spans end to end"} wide>
            <Seg small label="Cross beams under the ridge" value={r.crossBeams} onChange={(v) => rp({ crossBeams: v })} options={[0, 1, 2, 3].map((v) => ({ value: v, label: v === 0 ? "None" : String(v) }))} />
          </Field>
        ) : null}
        {roof.kind === "hip" && roof.attach === "free" && roof.ridge?.kind === "beam" ? <p className="v2-hint" data-deck-hip-cross>The ridge beam stands on two king posts, each on a cross beam from eave header to eave header. Nothing pushes the headers apart, so no ties.</p> : null}
        {roof.ringTensionLb > 0 ? <p className="v2-hint" data-deck-ring>The hips push the corners out — about {roof.ringTensionLb.toLocaleString("en-US")} lb at each header joint. A tension strap across every joint holds the headers as a ring; they are in the material list.</p> : null}
        {design.structure === "pergola" && r.pergolaStyle !== "louvered" ? (
          <div className="v2-grid2">
            <Field label="Slats">
              <Seg small label="Slats" value={r.slats.size} onChange={(v) => rp({ slats: { ...r.slats, size: v } })} options={(["2x2", "2x4", "2x6"] as const).map((v) => ({ value: v, label: v }))} />
            </Field>
            <Field label="Slat spacing" aside="in. apart">
              <NumberInput label="Slat spacing, inches" value={r.slats.spacingIn} parse={intText} format={String} min={ROOF_LIMITS.slatSpacingIn.min} max={ROOF_LIMITS.slatSpacingIn.max} onCommit={(n2) => rp({ slats: { ...r.slats, spacingIn: n2 } })} />
            </Field>
          </div>
        ) : null}
        <Field label="Roof load" aside={r.load === "auto" ? `from the site: ${roof.roofLoad} psf` : undefined} wide>
          <select className="v2-sel" value={String(r.load)} onChange={(e) => rp({ load: e.target.value === "auto" ? "auto" : (Number(e.target.value) as RoofDesign["load"]) })}>
            <option value="auto">Auto — follows the ground snow here</option>
            <option value="20">20 psf roof live load</option>
            <option value="30">30 psf ground snow</option>
            <option value="50">50 psf ground snow</option>
            <option value="70">70 psf ground snow</option>
          </select>
        </Field>
      </Fold>
      {design.structure !== "pergola" ? (
        <>
          <Fold title="Roofing and ceiling" sub={`${design.custom.roofing ? design.custom.roofing.name : ROOFING_LABEL[r.roofing]} · ${CEILING_LABEL[r.ceiling]}`} id="roof-roofing">
            <div className="v2-grid2">
              <Field label="Roofing">
                <select
                  className="v2-sel"
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
              {metalRoof ? (
                <Field label="Metal goes on">
                  <Seg small label="Metal goes on" value={r.roofDeck} onChange={(v) => rp({ roofDeck: v })} options={[{ value: "sheathing", label: "Sheathing" }, { value: "purlins", label: "Purlins" }]} />
                </Field>
              ) : null}
              <Field label="Ceiling">
                <select
                  className="v2-sel"
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
            </div>
            {design.custom.roofing ? (
              <CustomBox slot="roofing" title="Roofing" product={design.custom.roofing} unit="square" fresh={freshCustom === "roofing"} onDone={freshDone} onChange={(p) => setCustom("roofing", p)} onBack={() => setCustom("roofing", undefined)} note={`Priced per square — 100 sq ft of roof; this roof is ${roof.squares} squares.`}>
                <Field label="Goes on like" wide>
                  <select className="v2-sel" value={r.roofing} onChange={(e) => rp({ roofing: e.target.value as RoofDesign["roofing"] })} data-deck-like="roofing">
                    {roofingOptions}
                  </select>
                </Field>
              </CustomBox>
            ) : null}
            {design.custom.ceiling && r.ceiling !== "none" ? (
              <CustomBox slot="ceiling" title="Ceiling" product={design.custom.ceiling} unit="sq ft of ceiling" fresh={freshCustom === "ceiling"} onDone={freshDone} onChange={(p) => setCustom("ceiling", p)} onBack={() => setCustom("ceiling", undefined)} note="Priced per square foot of ceiling, 10% waste on top.">
                <Field label="Looks like" wide>
                  <Seg small label="Ceiling looks like" value={r.ceiling} onChange={(v) => rp({ ceiling: v })} options={(["tongue-groove", "beadboard"] as const).map((c) => ({ value: c, label: CEILING_LABEL[c] }))} />
                </Field>
              </CustomBox>
            ) : null}
            {r.kind !== "shed" ? <Toggle checked={r.cupola} onChange={(v) => rp({ cupola: v })}>Cupola at the peak</Toggle> : null}
          </Fold>
          <Fold title="Fascia, soffit and gutters" sub={`${FASCIA_FINISH_LABEL[r.fascia.finish]} · ${GUTTER_LABEL[r.gutters.kind]}`} id="roof-trim">
            <div className="v2-toggles">
              <Toggle checked={r.fascia.eave} onChange={(v) => rp({ fascia: { ...r.fascia, eave: v } })}>Fascia on the eaves ({Math.round(roof.eaveFt)} ft)</Toggle>
              {roof.rakeFt > 0 ? <Toggle checked={r.fascia.rake} onChange={(v) => rp({ fascia: { ...r.fascia, rake: v } })}>Rake boards on the gable ends ({Math.round(roof.rakeFt)} ft)</Toggle> : null}
              <Toggle checked={r.soffit} onChange={(v) => rp({ soffit: v })}>Vented soffit under the overhang</Toggle>
            </div>
            <div className="v2-grid2">
              <Field label="Fascia finish">
                <select
                  className="v2-sel"
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
                  className="v2-sel"
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
            {design.custom.roofFascia && (r.fascia.eave || r.fascia.rake) ? (
              <CustomBox slot="roofFascia" title="Fascia finish" product={design.custom.roofFascia} unit="ft" fresh={freshCustom === "roofFascia"} onDone={freshDone} onChange={(p) => setCustom("roofFascia", p)} onBack={() => setCustom("roofFascia", undefined)} note="Priced per foot of fascia and rake board." />
            ) : null}
            {design.custom.gutters && r.gutters.kind !== "none" ? (
              <CustomBox slot="gutters" title="Gutters" product={design.custom.gutters} unit="ft of gutter" fresh={freshCustom === "gutters"} onDone={freshDone} onChange={(p) => setCustom("gutters", p)} onBack={() => setCustom("gutters", undefined)} note="Priced per foot of gutter. The downspouts and their elbows stay as the kind it hangs like.">
                <Field label="Hangs like" wide>
                  <select className="v2-sel" value={r.gutters.kind} onChange={(e) => rp({ gutters: { ...r.gutters, kind: e.target.value as RoofDesign["gutters"]["kind"] } })} data-deck-like="gutters">
                    {GUTTER_KINDS.filter((g) => g !== "none").map((g) => (
                      <option key={g} value={g}>{GUTTER_LABEL[g]}</option>
                    ))}
                  </select>
                </Field>
              </CustomBox>
            ) : null}
            {r.gutters.kind !== "none" ? <Toggle checked={r.gutters.guards} onChange={(v) => rp({ gutters: { ...r.gutters, guards: v } })}>Gutter guards</Toggle> : null}
          </Fold>
        </>
      ) : null}
    </Scope>
  ) : (
    <div className="v2-stack">
      <p className="v2-hint">No roof on a plain deck. A covered deck, a gazebo or a pergola carries one.</p>
      <div className="v2-acts">
        <button type="button" className="v2-btn v2-btn-sm" onClick={() => setStructure("covered-deck")} data-v2-add-roof>
          Make it a covered deck
        </button>
        <button type="button" className="v2-btn v2-btn-sm" onClick={() => setKindOpen(true)}>
          Other kinds…
        </button>
      </div>
    </div>
  );

  const lightsPanel = (
    <Scope step="step-electrical">
      <div className="v2-sub-title">Add</div>
      <div className="v2-chips" role="group" aria-label="Add a light or an outlet">
        {FIXTURE_CHIPS.map((k) => (
          <button key={k} type="button" className="v2-chip" disabled={design.electrical.fixtures.length >= ELECTRICAL_LIMITS.fixtures} onClick={() => { const id = freshId("e", design.electrical.fixtures.length + 1); setFixtures((list) => [...list, defaultFixture(id, k)]); setPanelId(id); }} data-deck-add-fixture={k}>
            + {FIXTURE_SHORT[k]}
          </button>
        ))}
      </div>
      <div className="v2-rows">
        {design.electrical.fixtures.map((f) => {
          const placedOnes = structure.electrical.fixtures.filter((pf) => pf.id === f.id || pf.id.startsWith(`${f.id}-`));
          const isOpen = panelId === f.id || (design.electrical.fixtures.length === 1 && !panelId);
          return (
            <Scope key={f.id} fixture={f.id}>
              <div className={cx("v2-row", "v2-row-card", isOpen && "is-open")} data-deck-fixture={f.id}>
                <div className="v2-row-head">
                  <button type="button" className="v2-row-toggle" aria-expanded={isOpen} onClick={() => setPanelId(isOpen ? "__none" : f.id)}>
                    <span className="v2-row-title">{f.custom ? f.custom.name : FIXTURE_SHORT[f.kind]}</span>
                    <span className="v2-row-meta">{f.supply === "client" ? "by the client · TBD" : "we supply"}{f.at ? ` · on the ${f.at.on}` : placedOnes.length ? " · usual spot" : ""}</span>
                  </button>
                  <button type="button" className="v2-btn v2-btn-sm v2-btn-quiet" onClick={() => setFixtures((list) => list.filter((x) => x.id !== f.id))}>Remove</button>
                </div>
                {isOpen ? (
                  <>
                    <div className="v2-grid2">
                      <Field label="What">
                        <select
                          className="v2-sel"
                          value={f.custom ? CUSTOM : f.kind}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v === CUSTOM) {
                              setFreshCustom(`fx:${f.id}`);
                              return setFixtureCustom(f.id, { name: FIXTURE_LABEL[f.kind], price: fixturePrice(f) });
                            }
                            setFixtures((list) => list.map((x) => (x.id === f.id ? { ...x, kind: v as FixtureKind, at: x.kind === v ? x.at : null, custom: null } : x)));
                          }}
                          data-deck-pick="fixture"
                        >
                          {fixtureOptions}
                          <option value={CUSTOM}>Custom — a fixture of your own…</option>
                        </select>
                      </Field>
                      <Field label="Who buys the fixture" aside={f.supply === "client" ? "wiring stays in the price" : undefined}>
                        <Seg small label="Who buys the fixture" value={f.supply} onChange={(v) => setFixtures((list) => list.map((x) => (x.id === f.id ? { ...x, supply: v } : x)))} options={[{ value: "we", label: "We do" }, { value: "client", label: "The client" }]} />
                      </Field>
                      {f.kind !== "led-strip" && f.kind !== "post-cap" && f.kind !== "step-light" && f.kind !== "string-light" ? (
                        <Field label="How many">
                          <NumberInput label="How many" value={f.qty} parse={intText} format={String} min={1} max={ELECTRICAL_LIMITS.qty.max} onCommit={(n2) => setFixtures((list) => list.map((x) => (x.id === f.id ? { ...x, qty: n2 } : x)))} />
                        </Field>
                      ) : null}
                      {f.kind === "heater" ? (
                        <Field label="Heater">
                          <Seg small label="Heater voltage" value={f.volts240 ? "240" : "120"} onChange={(v) => setFixtures((list) => list.map((x) => (x.id === f.id ? { ...x, volts240: v === "240" } : x)))} options={[{ value: "120", label: "1.5 kW, 120 V" }, { value: "240", label: "4 kW, 240 V" }]} />
                        </Field>
                      ) : null}
                    </div>
                    {f.custom ? (
                      <CustomBox
                        slot={`fixture-${f.id}`}
                        title="Fixture"
                        product={f.custom}
                        unit={f.supply === "client" ? null : f.kind === "led-strip" ? "ft" : f.kind === "string-light" ? "48-ft strand" : "fixture"}
                        fresh={freshCustom === `fx:${f.id}`}
                        onDone={freshDone}
                        onChange={(p) => setFixtureCustom(f.id, p)}
                        onBack={() => setFixtureCustom(f.id, null)}
                        note={f.supply === "client" ? "The client buys it: named on the list, not priced. Its box, its wire and the hanging are." : "Priced at your number. The box, the wire, the switch and the circuit follow what it is wired like."}
                      >
                        <Field label="Wired like" wide>
                          <select className="v2-sel" value={f.kind} onChange={(e) => setFixtures((list) => list.map((x) => (x.id === f.id ? { ...x, kind: e.target.value as FixtureKind, at: null } : x)))} data-deck-like="fixture">
                            {fixtureOptions}
                          </select>
                        </Field>
                      </CustomBox>
                    ) : null}
                    <div className="v2-acts">
                      <button type="button" className={cx("v2-btn", "v2-btn-sm", placing?.kind === "fixture" && placing.id === f.id && "is-on")} onClick={() => { setPlacing(placing?.kind === "fixture" && placing.id === f.id ? null : { kind: "fixture", id: f.id }); setView("3d"); }} data-deck-place-fixture={f.id}>
                        {placing?.kind === "fixture" && placing.id === f.id ? "Press the 3D…" : f.at ? "Move it in 3D" : "Place in 3D"}
                      </button>
                      {f.at ? <button type="button" className="v2-btn v2-btn-sm" onClick={() => setFixtures((list) => list.map((x) => (x.id === f.id ? { ...x, at: null } : x)))}>Back to the usual spot</button> : null}
                    </div>
                  </>
                ) : null}
              </div>
            </Scope>
          );
        })}
      </div>
      {design.electrical.fixtures.length === 0 ? <p className="v2-empty">No lights or outlets yet. Each goes where it usually does; Place in 3D puts it on the spot you press.</p> : null}
      {structure.electrical.on ? (
        <>
          <div className="v2-grid2">
            <Field label="Panel to the structure" aside="ft of feed">
              <NumberInput label="Feet from the house's panel to the structure" value={design.electrical.feedFt} parse={intText} format={String} min={ELECTRICAL_LIMITS.feedFt.min} max={ELECTRICAL_LIMITS.feedFt.max} onCommit={(n2) => patch({ electrical: { ...design.electrical, feedFt: n2 } })} />
            </Field>
            <Field label="The feed comes from the">
              <Seg small label="Panel side" value={design.electrical.panelSide} onChange={(v) => patch({ electrical: { ...design.electrical, panelSide: v } })} options={[{ value: "left", label: "Left end" }, { value: "right", label: "Right end" }]} />
            </Field>
          </div>
          <Toggle checked={design.electrical.timer} onChange={(v) => patch({ electrical: { ...design.electrical, timer: v } })}>A timer or photocell on the lights</Toggle>
          <p className="v2-hint">
            {electricalWords(structure.electrical)} · {structure.electrical.boxes} boxes · {structure.electrical.switches} switches
            {structure.electrical.lv ? ` · ${structure.electrical.lv.transformers} transformer${structure.electrical.lv.transformers > 1 ? "s" : ""}` : ""}
            {structure.electrical.trenchFt ? ` · ${structure.electrical.trenchFt} ft of trench` : ""}. Turn on Night over the 3D to see them lit.
          </p>
        </>
      ) : null}
    </Scope>
  );

  const checksPanel = (
    <div className="v2-stack" id="deck-checks">
      <div className="v2-stamps">
        {summary.fail ? <span className="v2-stamp is-bad">{summary.fail} to fix</span> : null}
        {summary.warn ? <span className="v2-stamp is-warn">{summary.warn} to check</span> : null}
        <span className="v2-stamp is-pass">{summary.pass} pass</span>
      </div>
      {fixableCount ? (
        <button type="button" className="v2-btn v2-btn-primary v2-btn-block" onClick={runAutoFix} data-deck-autofix>
          Auto-fix {fixableCount === 1 ? "1 item" : `${fixableCount} items`}
        </button>
      ) : null}
      {fixReport ? (
        <div className={cx("v2-call", fixReport.left.length ? "is-warn" : "is-pass")} role="status" data-deck-fix-report>
          {fixReport.fixed.length ? <p><b>Fixed:</b> {fixReport.fixed.join(" · ")}.</p> : <p><b>Nothing the studio can change on its own.</b></p>}
          {fixReport.left.length ? (
            <>
              <p><b>Still for you, an engineer or the building office:</b></p>
              <ul>{fixReport.left.slice(0, 8).map((l, i) => <li key={i}>{l}</li>)}</ul>
            </>
          ) : (
            <p>Every check passes or is a note.</p>
          )}
          <button type="button" className="v2-btn v2-btn-sm" onClick={() => setFixReport(null)}>Close</button>
        </div>
      ) : null}
      {autoNotes.length ? <p className="v2-hint" data-deck-autofix-notes>Re-sized to the tables on the last change: {autoNotes.join(" · ")}.</p> : null}
      <ul className="v2-checks">{ordered.filter(loud).map((c) => checkRow(c))}</ul>
      {ordered.some((c) => !loud(c)) ? (
        <Fold
          title={(() => {
            const notes = ordered.filter((c) => !loud(c) && c.level === "info").length;
            const passes = ordered.filter((c) => c.level === "pass").length;
            return [notes ? `${notes} ${notes === 1 ? "note" : "notes"}` : "", passes ? `${passes} passed` : ""].filter(Boolean).join(" and ");
          })()}
          id="checks-more"
        >
          <ul className="v2-checks">{ordered.filter((c) => !loud(c)).map((c) => checkRow(c))}</ul>
        </Fold>
      ) : null}
      <p className="v2-hint">Each part against the table it is sized from. Estimating grade — the building department decides.</p>
    </div>
  );

  const pricePanel = (
    <div className="v2-stack">
      <div className="v2-figures">
        <div>
          <div className="v2-fig-l">Per square foot</div>
          <div className="v2-fig-v">{money(pkg.pricePerSqFt, true)}</div>
          <div className="v2-fig-h">{Math.round(pkg.areaSqFt)} sq ft{withDeck ? " of deck" : " of floor"}</div>
        </div>
        <div>
          <div className="v2-fig-l">Material</div>
          <div className="v2-fig-v">{money(pkg.materialSubtotal)}</div>
          <div className="v2-fig-h">{pkg.bom.length} lines</div>
        </div>
        <div>
          <div className="v2-fig-l">Labor</div>
          <div className="v2-fig-v">{money(pkg.laborSubtotal)}</div>
          <div className="v2-fig-h">by the measure</div>
        </div>
      </div>
      <div className="v2-stamps">
        {exampleShare > 0 ? <span className="v2-stamp is-warn">{exampleShare}% example prices</span> : <span className="v2-stamp is-pass">Your prices</span>}
        {pkg.storeShare > 0 ? <span className="v2-stamp is-info" title={`Materials at ${STORE_SURVEY.store}'s listed prices, surveyed once (${STORE_SURVEY.asOf}) — your own prices win`} data-deck-store-share>Materials: {STORE_SURVEY.store}, {new Date(STORE_SURVEY.asOf + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", year: "numeric" })}</span> : null}
      </div>
      {exampleShare > 0 ? <p className="v2-call is-warn"><b>{exampleShare}% of this price stands on example prices.</b> Set your own under Your prices below before it goes to a client.</p> : null}
      {summary.fail ? <p className="v2-call is-bad"><b>{summary.fail === 1 ? "One check fails" : `${summary.fail} checks fail`}.</b> The proposal can be made, but fix the frame before the client sees it.</p> : null}
      <table className="v2-table">
        <thead>
          <tr>
            <th>On the proposal</th>
            <th className="v2-r">Total</th>
          </tr>
        </thead>
        <tbody>
          {pkg.lines.map((l) => (
            <tr key={l.id} data-line={l.id}>
              <td>
                <div className="v2-line-name">{l.name}{l.tbd ? <span className="v2-tbd">to be determined</span> : null}</div>
                <div className="v2-line-desc">
                  {l.quantity.toLocaleString("en-US")} {l.unit} · material {money(l.materialCost, true)} · labor {money(l.laborCost, true)}
                </div>
              </td>
              <td className="v2-r v2-nums v2-strong">{money(l.quantity * l.unitPrice, true)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td>Subtotal, before tax</td>
            <td className="v2-r v2-nums v2-strong">{money(pkg.subtotal, true)}</td>
          </tr>
        </tfoot>
      </table>
      <div className="v2-acts">
        {permitHref ? (
          <a className="v2-btn v2-btn-sm" href={permitHref} target="_blank" rel="noopener" data-deck-permit>
            Permit &amp; build set
          </a>
        ) : null}
        {linked && !linked.lock ? (
          <button type="button" className="v2-btn v2-btn-sm" disabled={!!busy} onClick={() => void convert()} data-deck-convert-new>
            {busy === "convert" ? "Making the proposal…" : "Save as a new proposal"}
          </button>
        ) : null}
      </div>
      <Fold title="Your prices" sub={`Examples scaled to ${market.label} · ${Object.keys(draftBook).length} set`} id="rates">
        <p className="v2-hint">Type your own and save: your number is charged as typed, on every deck from then on. Blank goes back to the example. The same book is on the <a href="/dashboard/deck-estimator/inventory">deck inventory page</a>.</p>
        <div className="v2-acts">
          <button type="button" className="v2-btn v2-btn-sm v2-btn-primary" disabled={!unsaved || saving === "saving"} onClick={() => void saveBook()} data-v2-save-prices>
            {saving === "saving" ? "Saving…" : "Save my prices"}
          </button>
          {saving === "saved" && !unsaved ? <span className="v2-stamp is-pass">Saved</span> : null}
          {saving === "failed" ? <span className="v2-stamp is-bad">Not saved</span> : null}
        </div>
        {(Object.keys(DECK_RATE_GROUP_LABEL) as DeckRateGroup[]).map((group) => (
          <details key={group} className="v2-rate-group">
            <summary>
              {DECK_RATE_GROUP_LABEL[group]}
              <span className="v2-mono">{DECK_RATES.filter((rt) => rt.group === group && draftBook[rt.key] !== undefined).length || "no"} set</span>
            </summary>
            <div className="v2-rate-rows">
              {DECK_RATES.filter((rt) => rt.group === group).map((rt) => {
                const example = deckRate(rt.key, undefined, market).price;
                return (
                  <label key={rt.key} className="v2-rate-row">
                    <span className="v2-rate-label">{rt.label}</span>
                    <span className="v2-rate-unit">per {rt.unit}{rt.basis !== "labor" && storePrice(rt.key) ? ` · ${STORE_SURVEY.short} ${STORE_SURVEY.asOf.slice(0, 7)}` : ""}</span>
                    <input className="v2-in v2-num v2-rate-in" inputMode="decimal" placeholder={example.toFixed(2)} value={drafts2[rt.key] ?? ""} onChange={(e) => setDrafts2((d) => ({ ...d, [rt.key]: e.target.value }))} aria-label={`${rt.label}, per ${rt.unit}`} />
                  </label>
                );
              })}
            </div>
          </details>
        ))}
      </Fold>
    </div>
  );

  const packagePanel = (
    <div className="v2-stack">
      <div className="v2-acts">
        {materialsHref("yard") ? <a className="v2-btn v2-btn-sm v2-btn-primary" href={materialsHref("yard")!} target="_blank" rel="noopener" data-deck-materials="yard">List for the lumber yard</a> : null}
        {materialsHref("installer") ? <a className="v2-btn v2-btn-sm" href={materialsHref("installer")!} target="_blank" rel="noopener" data-deck-materials="installer">For the installer to buy</a> : null}
      </div>
      <p className="v2-mono">
        {Math.round(pkg.takeoff.framingLf)} ft of framing · {pkg.takeoff.concreteBags} bags · {pkg.takeoff.footings} footings
        {pkg.takeoff.roofSquares ? ` · ${pkg.takeoff.roofSquares} squares of roof` : ""}
        {pkg.takeoff.stairRisers ? ` · ${pkg.takeoff.stairRisers} risers` : ""}
        {pkg.takeoff.railLf ? ` · ${Math.round(pkg.takeoff.railLf)} ft of rail` : ""}
      </p>
      {bomByStep.size ? (
        <button type="button" className="v2-btn v2-btn-sm v2-self-start" onClick={() => setBomOpen((prev) => ([...bomByStep.keys()].every((k) => prev.has(k)) ? new Set() : new Set(bomByStep.keys())))} data-bom-all>
          {[...bomByStep.keys()].every((k) => bomOpen.has(k)) ? "Close all lines" : "Open all lines"}
        </button>
      ) : null}
      <div className="v2-bom">
        {[...bomByStep].map(([step, rows]) => (
          <div key={step} className="v2-bom-group" data-bom-step={step}>
            <button type="button" className="v2-bom-toggle" aria-expanded={bomOpen.has(step)} onClick={() => toggleBom(step)} data-bom-toggle={step}>
              <span className="v2-caret" aria-hidden="true" />
              <span className="v2-bom-name">{BOM_STEP_LABEL[step]}</span>
              <span className="v2-bom-count">{rows.length === 1 ? "1 line" : `${rows.length} lines`}</span>
              <span className="v2-bom-sum v2-nums">{money(rows.reduce((a, l) => a + l.cost, 0), true)}</span>
            </button>
            {bomOpen.has(step) ? (
              <ul className="v2-bom-lines">
                {rows.map((l) => (
                  <li key={l.id}>
                    <span className="v2-bom-qty v2-nums">{l.qty.toLocaleString("en-US")} <span>{l.unit}</span></span>
                    <span className="v2-bom-item">
                      {l.label}
                      {l.byClient ? <span className="v2-tbd">by the client</span> : null}
                      {l.note ? <span className="v2-line-desc">{l.note}</span> : null}
                    </span>
                    <span className="v2-bom-cost v2-nums">
                      {l.byClient ? "TBD" : money(l.cost, true)}
                      {l.source === "store" && !l.byClient ? <span className="v2-src" title={`${STORE_SURVEY.label} — set yours under Your prices`} data-price-source="store">{STORE_SURVEY.short}</span> : l.source !== "book" && !l.byClient ? <span className="v2-src" title="An example price — set yours under Your prices" data-price-source="example">ex</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ))}
      </div>
      {/* Anything no list carries (owner, 2026-10-12: "always an option custom"): on the material list and in the price as typed. */}
      <div className="v2-group" data-deck-own-items>
        <div className="v2-sub-title">Not on the list? Add your own{design.extras.items.length ? ` · ${design.extras.items.length} of ${CUSTOM_LIMITS.items}` : ""}</div>
        {design.extras.items.map((it) => (
          <div key={it.id} className="v2-own" data-deck-own={it.id}>
            <Field label="Item" wide>
              <NameInput label="Item name" value={it.name} onCommit={(name) => setOwnItem(it.id, { name })} />
            </Field>
            <Field label="Qty">
              <NumberInput label={`${it.name}: quantity`} value={it.qty} parse={priceText} format={priceShow} min={CUSTOM_LIMITS.qty.min} max={CUSTOM_LIMITS.qty.max} onCommit={(qty) => setOwnItem(it.id, { qty })} />
            </Field>
            <Field label="Unit">
              <select className="v2-sel" value={it.unit} onChange={(e) => setOwnItem(it.id, { unit: e.target.value as OwnUnit })} aria-label={`${it.name}: unit`}>
                {OWN_UNITS.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
            </Field>
            <Field label="Price" aside={`$ per ${it.unit}`}>
              <NumberInput label={`${it.name}: price per ${it.unit}`} value={it.price} parse={priceText} format={priceShow} min={CUSTOM_LIMITS.price.min} max={CUSTOM_LIMITS.price.max} onCommit={(price) => setOwnItem(it.id, { price })} />
            </Field>
            <button type="button" className="v2-btn v2-btn-sm v2-btn-quiet" onClick={() => setOwnItems((list) => list.filter((x) => x.id !== it.id))} aria-label={`Remove ${it.name}`}>
              Remove
            </button>
          </div>
        ))}
        {design.extras.items.length < CUSTOM_LIMITS.items ? (
          <form
            className="v2-own"
            onSubmit={(e) => {
              e.preventDefault();
              addOwnItem();
            }}
            data-deck-own-new
          >
            <Field label="Item" wide>
              <input className="v2-in" placeholder="A brand or a part no list carries" maxLength={CUSTOM_LIMITS.name} value={ownDraft.name} onChange={(e) => setOwnDraft((d) => ({ ...d, name: e.target.value }))} aria-label="New item's name" />
            </Field>
            <Field label="Qty">
              <input className="v2-in v2-num" inputMode="decimal" value={ownDraft.qty} onChange={(e) => setOwnDraft((d) => ({ ...d, qty: e.target.value }))} aria-label="New item's quantity" />
            </Field>
            <Field label="Unit">
              <select className="v2-sel" value={ownDraft.unit} onChange={(e) => setOwnDraft((d) => ({ ...d, unit: e.target.value as OwnUnit }))} aria-label="New item's unit">
                {OWN_UNITS.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
            </Field>
            <Field label="Price" aside={`$ per ${ownDraft.unit}`}>
              <input className="v2-in v2-num" inputMode="decimal" placeholder="0.00" value={ownDraft.price} onChange={(e) => setOwnDraft((d) => ({ ...d, price: e.target.value }))} aria-label="New item's price per unit" />
            </Field>
            <button type="submit" className="v2-btn v2-btn-sm v2-btn-primary" disabled={!ownDraft.name.trim()}>
              Add
            </button>
          </form>
        ) : null}
      </div>
    </div>
  );

  const draftsPanel = (
    <div className="v2-stack" data-deck-drafts>
      <div className="v2-save-line" data-deck-save={saveState}>
        {saveState === "saving" ? "Saving…" : saveState === "saved" && savedAt ? `${linked ? "Draft saved" : "Saved"} ${ago(savedAt)}` : saveState === "failed" ? "Not saved — will retry" : linked ? `Opened from ${linked.ref}` : "Saves as you go"}
      </div>
      <Field label="Name this draft" wide>
        <input className="v2-in" value={draftTitle} placeholder={structureWords(design)} aria-label="Name this draft" onChange={(e) => { dirty.current = true; setDraftTitle(e.target.value); }} />
      </Field>
      <div className="v2-acts">
        <button type="button" className="v2-btn v2-btn-sm" onClick={startFresh}>Start a new deck</button>
      </div>
      <div className="v2-sub-title">Saved drafts</div>
      {drafts === null ? <p className="v2-empty">Reading…</p> : drafts.length === 0 ? <p className="v2-empty">No saved drafts yet. The one on screen appears here a moment after your first change.</p> : null}
      <div className="v2-rows">
        {(drafts ?? []).map((d) => (
          <div key={d.id} className="v2-row" data-deck-draft={d.id}>
            <div className="v2-row-main">
              <div className="v2-row-name">{d.title}{d.id === draftId ? " · open" : ""}</div>
              <div className="v2-row-meta">{ago(d.updatedAt)}{d.fromClient ? ` · from ${d.fromClient}` : ""}{d.proposalId ? " · changes to a saved proposal" : ""}{d.address ? ` · ${d.address}` : ""}{d.by && !d.fromClient ? ` · ${d.by}` : ""}</div>
            </div>
            <div className="v2-row-acts">
              <button type="button" className="v2-btn v2-btn-sm" onClick={() => void openDraft(d.id)} disabled={d.id === draftId}>Open</button>
              <button type="button" className="v2-btn v2-btn-sm v2-btn-quiet" onClick={() => void removeDraft(d.id)} aria-label={`Delete the draft ${d.title}`}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const clientPanel = (
    <DeckV2ClientLinks design={design} address={address} title={draftTitle.trim()} clientId={clientId} proposalId={linkedId} onOpened={(token) => setInbox((list) => list.filter((l) => l.token !== token))} onOpenDraft={(id) => void openDraft(id)} />
  );

  /* ── the inspector ── */
  const PARTS: ReadonlyArray<{ id: Part; title: string; summary: string; show: boolean }> = [
    { id: "deck", title: withDeck ? (design.structure === "gazebo" || design.structure === "pergola" ? "The deck under it" : "Deck size and shape") : "Footprint", summary: withDeck ? shapeSummary : sizeWords(design), show: true },
    { id: "site", title: withDeck ? "Job, height and ground" : "Job and ground", summary: `${address || "No address yet"} · ${heightSummary}`, show: true },
    { id: "house", title: "House wall", summary: houseSummary, show: withDeck || !!scene.house || (withRoof && canAttach) },
    { id: "frame", title: "Frame", summary: frameSummary, show: !!frame },
    { id: "boards", title: "Deck boards", summary: surfaceSummary, show: !!frame },
    { id: "rails", title: "Railing", summary: railSummary, show: withDeck },
    { id: "stairs", title: "Stairs", summary: stairSummary, show: withDeck },
    { id: "roof", title: design.structure === "pergola" ? "Pergola" : "Roof", summary: withRoof ? roofSummary : "None — add one", show: true },
    { id: "lights", title: "Lights and outlets", summary: electricSummary, show: true },
  ];
  const PANEL_TITLE: Record<Panel, string> = {
    ...(Object.fromEntries(PARTS.map((p) => [p.id, p.title])) as Record<Part, string>),
    checks: "Code checks",
    price: `${what} price`,
    package: "Material package",
    drafts: "Drafts",
    client: "Send to client",
  };
  const panelBody: Record<Panel, React.ReactNode> = {
    deck: deckPanel,
    site: sitePanel,
    house: housePanel,
    frame: framePanel,
    boards: boardsPanel,
    rails: railsPanel,
    stairs: stairsPanel,
    roof: roofPanel,
    lights: lightsPanel,
    checks: checksPanel,
    price: pricePanel,
    package: packagePanel,
    drafts: draftsPanel,
    client: clientPanel,
  };
  const panelSub: Partial<Record<Panel, string>> = {
    ...(Object.fromEntries(PARTS.map((p) => [p.id, p.summary])) as Record<Part, string>),
    price: `${money(pkg.subtotal)} before tax`,
    checks: summary.fail ? `${summary.fail} to fix${summary.warn ? ` · ${summary.warn} to check` : ""}` : summary.warn ? `${summary.warn} to check` : "Inside the tables",
    package: `${pkg.bom.length} lines · ${money(pkg.materialSubtotal)} material`,
  };

  const saveWords = saveState === "saving" ? "Saving…" : saveState === "saved" && savedAt ? `Saved ${ago(savedAt)}` : saveState === "failed" ? "Not saved" : "Not saved yet";
  const emptyInspector = (
    <div className="v2-empty-state" data-v2-empty>
      <div className="v2-empty-title">Nothing selected</div>
      <p className="v2-empty-text">Press a part of the drawing to set it up, or drag a blue handle to size the {what.toLowerCase()}.</p>
      <ul className="v2-partlist" aria-label="Parts of the design">
        {PARTS.filter((p) => p.show).map((p) => (
          <li key={p.id}>
            <button type="button" className="v2-partrow" onClick={() => open(p.id)} onMouseEnter={() => setHoverHit({ part: p.id, name: p.title })} onMouseLeave={() => setHoverHit(null)} data-v2-part-row={p.id}>
              <span className="v2-partrow-name">{p.title}</span>
              <span className="v2-partrow-sum">{p.summary}</span>
              <span className="v2-chev" aria-hidden="true" />
            </button>
          </li>
        ))}
        <li className="v2-only-phone">
          <button type="button" className="v2-partrow" onClick={() => open("drafts")} data-v2-part-row="drafts">
            <span className="v2-partrow-name">Drafts</span>
            <span className="v2-partrow-sum">{saveWords}</span>
            <span className="v2-chev" aria-hidden="true" />
          </button>
        </li>
      </ul>
    </div>
  );

  /* ── the canvas ── */
  const hoverName = hoverHit?.name ?? null;
  const hoverLegend = view === "3d" && hoverPick?.legend && !placing ? hoverPick.legend : null;
  const viewOptions = [
    { value: "plan" as const, label: "Plan" },
    { value: "3d" as const, label: "3D" },
    ...(scene.house ? [{ value: "wall" as const, label: "House wall" }] : []),
  ];

  const primaryLabel = busy === "convert" ? "Making the proposal…" : busy === "update" ? "Updating…" : linked && !linked.lock ? (!behind ? `${linked.ref} is up to date` : summary.fail ? `Update ${linked.ref} anyway` : `Update ${linked.ref}`) : summary.fail ? "Make proposal anyway" : "Make proposal";
  const primaryAct = () => (linked && !linked.lock ? askUpdate() : void convert());
  const primaryDisabled = !!busy || (!!linked && !linked.lock && !behind);

  return (
    <div className="jf-deck-v2" data-nest data-v2-view={view}>
      {/* ── the toolbar: what it is, what it is built with, how it is seen ── */}
      <header className="v2-top" aria-label="Deck estimator">
        <h1 className="v2-title">Deck estimator</h1>
        {adminPreview ? (
          <span className="v2-stamp is-warn" title="Customers without the Deck Studio plan see its offer here. You can work and test it because you are an admin.">
            Coming soon · admin
          </span>
        ) : null}
        <button type="button" className={cx("v2-kind", kindOpen && "is-on")} aria-expanded={kindOpen} onClick={() => setKindOpen((v) => !v)} data-v2-kind>
          <span className="v2-kind-l">Build</span>
          <span className="v2-kind-v">{structureSummary}</span>
          <span className={cx("v2-chev", kindOpen && "is-up")} aria-hidden="true" />
        </button>
        <div className="v2-mats" role="group" aria-label="Materials">
          {frame ? (
            <label className="v2-mat">
              <span className="v2-mat-l">Boards</span>
              <select className="v2-sel v2-sel-tool" value={design.custom.decking ? CUSTOM : design.decking.product} onChange={(e) => { onDecking(e.target.value); if (e.target.value === CUSTOM) open("boards"); }} data-v2-tool="decking">
                {deckingOptions}
                <option value={CUSTOM}>{CUSTOM_LABEL}</option>
              </select>
            </label>
          ) : null}
          {withDeck ? (
            <label className="v2-mat">
              <span className="v2-mat-l">Railing</span>
              <select className="v2-sel v2-sel-tool" value={design.rail.type} onChange={(e) => onRail(e.target.value)} data-v2-tool="rail">
                {RAIL_TYPES.map((rt) => (
                  <option key={rt.id} value={rt.id}>{rt.id === "none" ? "No railing" : rt.label}</option>
                ))}
              </select>
            </label>
          ) : null}
          {frame ? (
            <label className="v2-mat">
              <span className="v2-mat-l">Lumber</span>
              <select className="v2-sel v2-sel-tool" value={design.custom.species ? CUSTOM : design.framing.species} onChange={(e) => { onSpecies(e.target.value); if (e.target.value === CUSTOM) open("frame"); }} data-v2-tool="species">
                {speciesOptions}
                <option value={CUSTOM}>{CUSTOM_LABEL}</option>
              </select>
            </label>
          ) : withRoof && design.structure !== "pergola" ? (
            <label className="v2-mat">
              <span className="v2-mat-l">Roofing</span>
              <select className="v2-sel v2-sel-tool" value={design.custom.roofing ? CUSTOM : r.roofing} onChange={(e) => { if (e.target.value === CUSTOM) { pickCustom("roofing"); open("roof"); return; } rp({ roofing: e.target.value as RoofDesign["roofing"] }); dropCustom("roofing"); }} data-v2-tool="roofing">
                {roofingOptions}
                <option value={CUSTOM}>{CUSTOM_LABEL}</option>
              </select>
            </label>
          ) : null}
        </div>
        <div className="v2-view">
          <Seg label="View" value={view} onChange={(v: View) => { setView(v); setPlacing(null); }} options={viewOptions} />
        </div>
      </header>

      {/* What to build: the four kinds as pictures and the samples, over the drawing until one is picked. */}
      {kindOpen ? (
        <div className="v2-kind-sheet" role="dialog" aria-label="What to build" data-v2-kind-sheet>
          <div className="v2-kind-sheet-head">
            <span className="v2-panel-title">What to build</span>
            <button type="button" className="v2-btn v2-btn-sm" onClick={() => setKindOpen(false)}>Done</button>
          </div>
          <FieldScope.Provider value={rootScope}>
            <Scope step="step-structure">
              <DeckKindPicker structure={design.structure} onPickKind={setStructure} onPickSample={(sm) => { applySample(sm); setKindOpen(false); }} appliedSampleId={applied && applied.design === design ? applied.id : null} />
              {design.structure === "gazebo" || design.structure === "pergola" ? (
                <div className="v2-kind-floor">
                  <Field label="It stands" wide>
                    <Seg small label="It stands" value={design.floor} onChange={(f: Floor) => patch({ floor: f })} options={(["deck", "slab", "ground"] as const).map((f) => ({ value: f, label: FLOOR_LABEL[f] }))} />
                  </Field>
                  {!withDeck ? <p className="v2-hint">{design.floor === "slab" ? "A new 4-in. slab a foot wider than the posts goes in the price; the posts sit on anchored bases." : "Each post gets its own poured footing, sized for what it carries."}</p> : null}
                </div>
              ) : null}
            </Scope>
          </FieldScope.Provider>
        </div>
      ) : null}

      {/* Notices that need the contractor: a client's return, the client's own words, the proposal this is on. */}
      {inboxNew.length || fromClient || linked ? (
        <div className="v2-notices" aria-live="polite">
          {inboxNew.slice(0, 2).map((l) => (
            <div key={l.token} className="v2-notice is-new" data-deck-inbox-row={l.token}>
              <span className="v2-notice-text">
                <b>{l.clientName}</b> sent back a deck design{l.sentAt ? ` · ${ago(l.sentAt)}` : ""} · for {jobLine(l)}
                {l.note ? <span className="v2-notice-quote"> “{l.note.length > 90 ? `${l.note.slice(0, 90)}…` : l.note}”</span> : null}
              </span>
              <span className="v2-notice-acts">
                {l.draftId ? <button type="button" className="v2-btn v2-btn-sm v2-btn-primary" onClick={() => void openDraft(l.draftId!)} data-deck-inbox-open>Open it</button> : null}
                <button type="button" className="v2-btn v2-btn-sm" onClick={() => putAside(l)} aria-label={`Put ${l.clientName}'s design aside until they send again`}>Later</button>
              </span>
            </div>
          ))}
          {inboxNew.length > 2 ? <div className="v2-notice"><span className="v2-notice-text">and {inboxNew.length - 2} more under Send to client</span></div> : null}
          {fromClient ? (
            <div className="v2-notice" data-deck-from-client>
              <span className="v2-notice-text">
                <b>{fromClient.name}&apos;s design</b>
                {fromClient.sends > 1 ? ` · sent ${fromClient.sends} times` : ""}
                {fromClient.sentAt ? ` · ${ago(fromClient.sentAt)}` : ""}
                {!linked && fromClient.address ? ` · ${fromClient.address}` : ""}
                {" — "}
                {fromClient.note ? `“${fromClient.note}” ` : "No note with it. "}
                {fromClient.unsure.includes("height") ? <b>Not sure of the height — measure it on site. </b> : null}
              </span>
              <span className="v2-notice-acts">
                {fromClient.phone ? <a className="v2-btn v2-btn-sm" href={`tel:${fromClient.phone}`}>Call {fromClient.name.split(/\s+/)[0]}</a> : null}
                <a className="v2-btn v2-btn-sm" href={fromClient.url} target="_blank" rel="noopener">Their page</a>
              </span>
            </div>
          ) : null}
          {linked ? (
            <div className="v2-notice" data-deck-linked={linked.lock ? "locked" : behind ? "behind" : "even"}>
              <span className="v2-notice-text">
                <b>{linked.ref}</b> {linked.title} <span className={cx("v2-stamp", linked.lock ? "is-warn" : linked.seen ? "is-info" : "is-pass")} data-deck-linked-status>{PROPOSAL_STATUS_WORDS[linked.status] ?? linked.status}</span>{" "}
                {linked.lock
                  ? `This proposal is ${DECK_LOCK_WORDS[linked.lock]}, so its price stays — a new design goes on a new proposal.`
                  : behind
                    ? updated
                      ? "Changed since the last update."
                      : "Your changes save as a draft; the proposal keeps its price until you update it."
                    : updated
                      ? `Updated ${ago(updated.at)}.${updatedWords ? ` ${updatedWords}` : ""}`
                      : "The proposal has this design."}
              </span>
              <span className="v2-notice-acts">
                <a className="v2-btn v2-btn-sm" href={`/dashboard/manual-blueprint?proposal=${encodeURIComponent(linked.id)}`} onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); router.push(`/dashboard/manual-blueprint?proposal=${encodeURIComponent(linked.id)}` as Route); }} data-deck-linked-back>
                  Back to the proposal
                </a>
              </span>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ── the drafting table and its inspector ── */}
      <div className="v2-work">
        <section className={cx("v2-canvas", placing && "is-placing")} aria-label={`The ${what.toLowerCase()}`} data-deck-viewer>
          <FieldScope.Provider value={rootScope}>
            {view === "plan" ? (
              <DeckV2Plan
                structure={structure}
                design={design}
                selected={panel && PARTS.some((p) => p.id === panel) ? (panel as Part) : null}
                selectedId={panelId}
                hovered={hoverHit}
                onSelect={(hit) => (hit ? open(hit.part, hit.id ?? null) : open(null))}
                onHover={setHoverHit}
                onEdit={onEdit}
                placing={placing?.kind === "stair"}
                onPlaceStair={addStairAt}
              />
            ) : view === "3d" ? (
              <DeckModel3D scene={scene} built={built} xray={xray} night={night} connections={connections} placing={placing?.kind === "fixture" || placing?.kind === "stair"} edit={editing} onEdit={onEdit} resetToken={resetToken} focus={focus} onPick={onPick} highlight={wallLit ?? fieldLit} className="v2-3d" label={`The ${what.toLowerCase()} in 3D: ${scene.facts}`} />
            ) : (
              <div className="v2-wall-view" onPointerDownCapture={quiet} data-deck-wall-large-view>
                <HouseWallPlan size="large" shape={design.shape} house={design.house} onChange={(n2) => patch({ ...(n2.shape ? { shape: n2.shape } : {}), ...(n2.house ? { house: n2.house } : {}) })} />
              </div>
            )}
          </FieldScope.Provider>

          {/* What the pointer is over, named. */}
          {view === "plan" && hoverName && !placing ? (
            <div className="v2-tagline" data-v2-hover>
              <b>{hoverName}</b> <span>press to set it up</span>
            </div>
          ) : null}
          {hoverLegend ? (
            <div className="v2-tagline" data-deck-hover>
              <b>
                {hoverLegend.role}
                {hoverLegend.nominal ? ` · ${hoverLegend.nominal}` : ""}
                {hoverLegend.lengthFt ? ` · ${ftIn(hoverLegend.lengthFt * 12)}` : ""}
              </b>{" "}
              <span>press to set it up</span>
            </div>
          ) : null}

          {/* Placing: a stair on an edge, a fixture on the spot. */}
          {placing?.kind === "stair" ? (
            <div className="v2-banner" data-deck-placing="stair">
              <span>{view === "3d" ? "Press the deck where the stairs go — they take the nearest open edge." : "Press an open edge of the deck where the stairs go."}</span>
              <button type="button" className="v2-btn v2-btn-sm" onClick={() => setPlacing(null)}>Cancel</button>
            </div>
          ) : null}
          {placingFixture ? (
            <div className="v2-banner" data-deck-placing="fixture">
              <span>Press the {what.toLowerCase()} where the {FIXTURE_SHORT[placingFixture.kind].toLowerCase()} goes — a post, a header, the rail, the ceiling, the house wall.</span>
              <button type="button" className="v2-btn v2-btn-sm" onClick={() => setPlacing(null)}>Cancel</button>
            </div>
          ) : null}

          {/* The canvas tools: the build-up and the looks of the 3D; stairs by pressing, in either view. */}
          <div className="v2-tools" role="toolbar" aria-label="Drawing tools">
            {structure.frame && view !== "wall" ? (
              <button type="button" className={cx("v2-tool", placing?.kind === "stair" && "is-on")} aria-pressed={placing?.kind === "stair"} disabled={design.stairs.length >= STAIR_LIMITS.count} onClick={() => setPlacing(placing?.kind === "stair" ? null : { kind: "stair" })} data-deck-3d-add-stair>
                + Stairs
              </button>
            ) : null}
            {view === "3d" ? (
              <>
                <button type="button" className={cx("v2-tool", editing && "is-on")} aria-pressed={editing} title="Drag the blue knobs: width, depth, height, the roof, the stairs, the house" onClick={() => setEditing((x) => !x)} data-deck-edit>
                  Size handles
                </button>
                <button type="button" className={cx("v2-tool", xray && "is-on")} aria-pressed={xray} onClick={() => setXray((x) => !x)}>X-ray</button>
                <button type="button" className={cx("v2-tool", connections && "is-on")} aria-pressed={connections} onClick={() => setConnections((c) => !c)} data-deck-connections>Connections</button>
                <button type="button" className={cx("v2-tool", night && "is-on")} aria-pressed={night} onClick={() => setNight((x) => !x)} data-deck-night>Night</button>
                <button type="button" className="v2-tool" onClick={() => { setResetToken((t) => t + 1); setPicked(null); }}>Reset view</button>
              </>
            ) : null}
          </div>
          {view === "3d" ? (
            <div className="v2-build">
              <button type="button" className={cx("v2-tool", playing && "is-on")} onClick={() => (playing ? setPlaying(false) : play())}>
                {playing ? "Pause" : "Build it"}
              </button>
              <label className="v2-build-slider">
                <span className="v2-mono">{layerNow}</span>
                <input type="range" min={0} max={LAYERS} step={0.01} value={sliderValue} aria-label="How much is standing" onChange={(e) => { setPlaying(false); setBuilt(Number(e.target.value)); }} />
              </label>
            </div>
          ) : null}

          {/* The drawing's title block: the job, pressed to change it. */}
          {view !== "wall" ? (
            <button type="button" className="v2-titleblock" onClick={() => open("site")} data-v2-titleblock>
              <span className="v2-tb-l">Job</span>
              <span className="v2-tb-v">{address || "No address yet — add one"}</span>
              <span className="v2-tb-s">{(frame ?? roof)?.species.short} · frost {design.frostIn} in. · snow {design.site.groundSnowPsf} psf</span>
            </button>
          ) : null}

          {autoNotes.length && !placing ? (
            <p className="v2-toast" role="status" data-deck-autofix>
              Re-sized to the tables: {autoNotes.join(" · ")}.
            </p>
          ) : null}
        </section>

        <aside ref={inspectorRef} className="v2-inspector" aria-label="Settings" data-v2-panel={panel ?? "none"}>
          {panel ? (
            <>
              <div className="v2-panel-head">
                <div className="v2-panel-titles">
                  <h2 className="v2-panel-title">{PANEL_TITLE[panel]}</h2>
                  {panelSub[panel] ? <div className="v2-panel-sub">{panelSub[panel]}</div> : null}
                </div>
                <button type="button" className="v2-btn v2-btn-sm" onClick={() => open(null)} aria-label="Close the settings">Done</button>
              </div>
              {picked && PARTS.some((p) => p.id === panel) && view === "3d" ? (
                <div className="v2-picked" data-deck-picked>
                  <div className="v2-picked-head">
                    {picked.legend.role}
                    <span>
                      {picked.legend.nominal}
                      {picked.legend.lengthFt ? ` · ${ftIn(picked.legend.lengthFt * 12)}` : ""}
                      {picked.legend.count > 1 ? ` · ${picked.legend.count} of them` : ""}
                    </span>
                  </div>
                  <p className="v2-picked-note">{picked.legend.note}</p>
                  <div className="v2-acts">
                    <button type="button" className="v2-btn v2-btn-sm" onClick={() => setFocus([...picked.point] as [number, number, number])}>Zoom to it</button>
                    <button type="button" className="v2-btn v2-btn-sm" onClick={() => setPicked(null)}>Hide</button>
                  </div>
                </div>
              ) : null}
              <div className="v2-panel-body" key={panel}>
                <FieldScope.Provider value={rootScope}>{panelBody[panel]}</FieldScope.Provider>
              </div>
            </>
          ) : (
            emptyInspector
          )}
        </aside>
      </div>

      {/* ── the bar along the foot: the price, the verdict, the actions ── */}
      <footer className="v2-foot" aria-label="Price and actions">
        <button type="button" className={cx("v2-price", panel === "price" && "is-on")} onClick={() => open(panel === "price" ? null : "price")} data-v2-price>
          <span className="v2-price-l">{what} price</span>
          <span className="v2-price-v" data-v2-total>{money(pkg.subtotal)}</span>
          <span className="v2-price-s">{money(pkg.pricePerSqFt, true)} / sq ft · {Math.round(pkg.areaSqFt)} sq ft{exampleShare > 0 ? ` · ${exampleShare}% example prices` : ""}</span>
        </button>
        <button type="button" className={cx("v2-verdict", summary.fail ? "is-bad" : summary.warn ? "is-warn" : "is-pass", panel === "checks" && "is-on")} onClick={() => open(panel === "checks" ? null : "checks")} data-v2-verdict>
          <span className={cx("v2-stamp", summary.fail ? "is-bad" : summary.warn ? "is-warn" : "is-pass")}>
            <span className="v2-long">{summary.fail ? `${summary.fail} to fix` : summary.warn ? `${summary.warn} to check` : "Inside the tables"}</span>
            <span className="v2-short" aria-hidden="true">{summary.fail ? `${summary.fail} fix` : summary.warn ? `${summary.warn} check` : "Code OK"}</span>
          </span>
          <span className="v2-verdict-text">{worst ? `${worst.part}: ${worst.text}` : `${summary.pass} checks pass — every number names its table.`}</span>
        </button>
        <div className="v2-actions">
          <button type="button" className={cx("v2-btn", panel === "package" && "is-on")} onClick={() => open(panel === "package" ? null : "package")} data-v2-act="package">
            <span className="v2-long">Material package</span>
            <span className="v2-short" aria-hidden="true">Materials</span>
          </button>
          <span className="v2-save">
            <button type="button" className="v2-btn" onClick={() => void saveNow()} disabled={saveState === "saving"} data-v2-act="save">
              <span className="v2-long">Save draft</span>
              <span className="v2-short" aria-hidden="true">{saveState === "saving" ? "Saving" : saveState === "saved" ? "Saved" : "Save"}</span>
            </button>
            <button type="button" className={cx("v2-save-state", panel === "drafts" && "is-on")} onClick={() => open(panel === "drafts" ? null : "drafts")} data-deck-save={saveState} title="Your drafts">
              {saveWords} · Drafts
            </button>
          </span>
          <button type="button" className="v2-btn v2-btn-primary v2-btn-main" disabled={primaryDisabled} onClick={primaryAct} data-deck-convert={linked ? undefined : ""} data-deck-update={linked ? "bottom" : undefined}>
            {primaryLabel}
          </button>
          <button type="button" className={cx("v2-btn", panel === "client" && "is-on", inbox.length > 0 && "is-bloom")} onClick={() => open(panel === "client" ? null : "client")} data-v2-act="client" data-deck-client-count={inbox.length}>
            <span className="v2-long">Send to client</span>
            <span className="v2-short" aria-hidden="true">Client</span>
            {inbox.length ? <span className="v2-count" aria-label={`${inbox.length} sent back, not opened yet`}>{inbox.length}</span> : null}
          </button>
        </div>
        {confirming && linked ? (
          <div className="v2-confirm" role="alertdialog" aria-label="Update a proposal the client has" data-deck-update-confirm>
            <p>
              <b>The client already has this proposal{linked.status === "VIEWED" ? " and has opened it" : ""}.</b> Updating it changes the price and the 3D on their link.
            </p>
            <div className="v2-acts">
              <button type="button" className="v2-btn v2-btn-sm v2-btn-primary" onClick={() => void update()} data-deck-update-yes>Update it</button>
              <button type="button" className="v2-btn v2-btn-sm" onClick={() => setConfirming(false)}>Cancel</button>
            </div>
          </div>
        ) : null}
        {error ? (
          <p className="v2-foot-error" role="alert">
            {error} <button type="button" className="v2-link" onClick={() => setError(null)}>Dismiss</button>
          </p>
        ) : linked && updated && !behind ? (
          <p className="v2-foot-ok" role="status" data-deck-updated>
            <b>{linked.ref} updated {ago(updated.at)}.</b> {updatedWords}
          </p>
        ) : null}
      </footer>
    </div>
  );
}
